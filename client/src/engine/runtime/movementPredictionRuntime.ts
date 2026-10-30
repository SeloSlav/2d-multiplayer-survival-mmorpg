import type { DbConnection } from '../../generated';
import type { Player } from '../../generated/types';
import { resolveClientCollision, type GameEntities } from '../../utils/clientCollision';
import { gameConfig } from '../../config/gameConfig';
import { runtimeEngine } from '../runtimeEngine';
import { readLocalPlayerLife, recoverRejectedPlayerLife } from './localPlayerLifecycle';
import {
  DODGE_ROLL_COOLDOWN_MS,
  DODGE_ROLL_DISTANCE_PX,
  DODGE_ROLL_DURATION_MS,
  DODGE_ROLL_SPEED_PX_PER_SEC,
  EXHAUSTED_SPEED_PENALTY,
} from '../../config/combatConstants';

const POSITION_UPDATE_INTERVAL_MS = 50;
const REACT_MOVEMENT_PUBLISH_INTERVAL_MS = 100;
const PLAYER_SPEED = gameConfig.playerSpeed;
const SPRINT_MULTIPLIER = gameConfig.sprintMultiplier;
const WATER_SPEED_PENALTY = gameConfig.waterSpeedPenalty;
const MAX_WATER_SPEED_BONUS = 2.0;
const PERFORMANCE_LOG_INTERVAL = 10000;
const LAG_SPIKE_THRESHOLD = 20;
// Large RAF gaps should not become equally large camera jumps. The runtime
// already clamps frame deltas, and this keeps direct movement callers honest.
const MAX_CLIENT_MOVEMENT_DT_MS = 33;
const RECONCILIATION_PROFILER_VISIBLE_WINDOW_MS = 250;

export interface MovementInputState {
  direction: { x: number; y: number };
  sprinting: boolean;
}

export interface MovementPredictionRuntimeProps {
  connection: DbConnection | null;
  localPlayer: Player | undefined | null;
  inputState: MovementInputState;
  inputStateRef?: { current: MovementInputState | undefined | null };
  isUIFocused: boolean;
  entities: GameEntities;
  playerDodgeRollStates?: Map<string, any>;
  mobileSprintOverride?: boolean;
  waterSpeedBonus?: number;
  movementSpeedModifier?: number;
  isOnSeaTile?: (worldX: number, worldY: number) => boolean;
  fixedSimulationEnabled?: boolean;
  isAutoWalking: boolean;
  stopAutoWalk: () => void;
  isAutoAttacking: boolean;
}

export interface DodgeRollVisualState {
  isDodgeRolling: boolean;
  progress: number;
  direction: string;
}

export interface MovementPredictionSnapshot {
  predictedPosition: { x: number; y: number } | null;
  facingDirection: string;
  dodgeRollVisual: DodgeRollVisualState;
  isAutoWalking: boolean;
  isAutoAttacking: boolean;
}

export interface ReconciliationProfilerSnapshot {
  eventId: number;
  eventType: 'none' | 'ack' | 'respawn' | 'sequence_reset';
  eventAgeMs: number;
  eventTimeMs: number;
  receivedSequence: number;
  previousAckSequence: number;
  sequenceAdvance: number;
  errorX: number;
  errorY: number;
  errorDist: number;
}

const hasExhaustedEffect = (connection: DbConnection | null, playerId: string): boolean => {
  if (!connection) {
    return false;
  }

  for (const effect of connection.db.active_consumable_effect.iter()) {
    if (effect.playerId.toHexString() === playerId && effect.effectType.tag === 'Exhausted') {
      return true;
    }
  }
  return false;
};

class SimpleMovementMonitor {
  private updateTimings: number[] = [];
  private lastLogTime = 0;
  private lagSpikes = 0;
  private totalUpdates = 0;
  private sentUpdates = 0;
  private rejectedUpdates = 0;

  logUpdate(updateTime: number, wasSent: boolean, wasRejected = false) {
    this.totalUpdates++;
    if (wasSent) {
      this.sentUpdates++;
    }
    if (wasRejected) {
      this.rejectedUpdates++;
    }

    this.updateTimings.push(updateTime);

    if (updateTime > LAG_SPIKE_THRESHOLD) {
      this.lagSpikes++;
    }

    const now = Date.now();
    if (now - this.lastLogTime > PERFORMANCE_LOG_INTERVAL) {
      this.reportPerformance();
      this.reset();
      this.lastLogTime = now;
    }
  }

  private reportPerformance() {
    if (this.updateTimings.length === 0) {
      return;
    }

    const avg = this.updateTimings.reduce((a, b) => a + b, 0) / this.updateTimings.length;
    const max = Math.max(...this.updateTimings);
    void avg;
    void max;
  }

  private reset() {
    this.updateTimings = [];
    this.lagSpikes = 0;
    this.totalUpdates = 0;
    this.sentUpdates = 0;
    this.rejectedUpdates = 0;
  }
}

const movementMonitor = new SimpleMovementMonitor();

const DEFAULT_DODGE_VISUAL: DodgeRollVisualState = {
  isDodgeRolling: false,
  progress: 0,
  direction: 'down',
};

class MovementPredictionEngine {
  private config: MovementPredictionRuntimeProps | null = null;
  private clientPosition: { x: number; y: number } | null = null;
  private serverPosition: { x: number; y: number } | null = null;
  private lastSentTime = 0;
  private isMoving = false;
  private lastUpdateTime = 0;
  private pendingPosition: { x: number; y: number } | null = null;
  private lastFacingDirection = 'down';
  private wasDead = true;
  private clientDodgeRoll: {
    startX: number;
    startY: number;
    targetX: number;
    targetY: number;
    serverStartTime: number;
  } | null = null;
  private optimisticDodgeRollStartMs = 0;
  private lastOptimisticDodgeRollStartMs = 0;
  private visualRollStartMs = 0;
  private visualRollProgress = 0;
  private clientSequence = 0n;
  private lastAckedSequence = 0n;
  private lastReactPublishTime = 0;
  private lastReactPublishTileKey: string | null = null;
  private lastReactSnapshot: MovementPredictionSnapshot | null = null;
  private reconciliationProfilerState: Omit<ReconciliationProfilerSnapshot, 'eventAgeMs'> = {
    eventId: 0,
    eventType: 'none',
    eventTimeMs: 0,
    receivedSequence: 0,
    previousAckSequence: 0,
    sequenceAdvance: 0,
    errorX: 0,
    errorY: 0,
    errorDist: 0,
  };

  configure(config: MovementPredictionRuntimeProps): void {
    const localPlayer = readLocalPlayerLife(config.connection, config.localPlayer);
    this.config = { ...config, localPlayer };

    if (!localPlayer) {
      this.reset();
      return;
    }

    if (!this.clientPosition) {
      const serverPos = { x: localPlayer.positionX, y: localPlayer.positionY };
      this.clientPosition = serverPos;
      this.serverPosition = serverPos;
      this.pendingPosition = serverPos;
      this.lastFacingDirection = localPlayer.direction || 'down';
      this.wasDead = localPlayer.isDead;
      this.publishSnapshot(true);
      return;
    }

    this.syncServerPlayerState();
    this.publishSnapshot();
  }

  stepPredictedMovement(dtMs: number): void {
    const updateStartTime = performance.now();
    const dtSec = Math.min(dtMs, MAX_CLIENT_MOVEMENT_DT_MS) / 1000;
    this.applyMovementStep(dtSec, updateStartTime);
    this.publishSnapshot();
  }

  triggerOptimisticDodgeRoll = (moveX: number, moveY: number): boolean => {
    const localPlayer = readLocalPlayerLife(this.config?.connection, this.config?.localPlayer);
    if (!this.clientPosition || !localPlayer || localPlayer.isDead || localPlayer.isKnockedOut || localPlayer.isOnWater) {
      return false;
    }

    const nowMs = Date.now();
    const optimisticElapsed = nowMs - this.optimisticDodgeRollStartMs;
    const isOptimisticActive =
      this.optimisticDodgeRollStartMs > 0 && optimisticElapsed < DODGE_ROLL_DURATION_MS;
    const timeSinceLastStart = nowMs - this.lastOptimisticDodgeRollStartMs;
    if (isOptimisticActive || timeSinceLastStart < DODGE_ROLL_COOLDOWN_MS) {
      return false;
    }

    let dirX = moveX;
    let dirY = moveY;
    const mag = Math.sqrt(dirX * dirX + dirY * dirY);
    if (mag <= 0.001) {
      const fallbackDir = this.lastFacingDirection || localPlayer.direction || 'down';
      if (fallbackDir === 'left') {
        dirX = -1;
        dirY = 0;
      } else if (fallbackDir === 'right') {
        dirX = 1;
        dirY = 0;
      } else if (fallbackDir === 'up') {
        dirX = 0;
        dirY = -1;
      } else {
        dirX = 0;
        dirY = 1;
      }
    } else {
      dirX /= mag;
      dirY /= mag;
    }

    if (Math.abs(dirX) > 0.01 || Math.abs(dirY) > 0.01) {
      if (Math.abs(dirX) > 0.01 && Math.abs(dirY) > 0.01) {
        this.lastFacingDirection = dirX > 0
          ? (dirY < 0 ? 'up_right' : 'down_right')
          : (dirY < 0 ? 'up_left' : 'down_left');
      } else if (Math.abs(dirX) >= Math.abs(dirY)) {
        this.lastFacingDirection = dirX > 0 ? 'right' : 'left';
      } else {
        this.lastFacingDirection = dirY > 0 ? 'down' : 'up';
      }
    }

    this.clientDodgeRoll = {
      startX: this.clientPosition.x,
      startY: this.clientPosition.y,
      targetX: this.clientPosition.x + dirX * DODGE_ROLL_DISTANCE_PX,
      targetY: this.clientPosition.y + dirY * DODGE_ROLL_DISTANCE_PX,
      serverStartTime: -1,
    };
    this.optimisticDodgeRollStartMs = nowMs;
    this.lastOptimisticDodgeRollStartMs = nowMs;
    this.publishSnapshot(true);
    return true;
  };

  getCurrentPositionNow = (): { x: number; y: number } | null => {
    const config = this.config;
    const localPlayer = config?.localPlayer;
    if (!this.clientPosition || !localPlayer || localPlayer.isDead) {
      return this.clientPosition;
    }

    const now = performance.now();
    const elapsedSinceSimulationMs = Math.max(0, now - this.lastUpdateTime);
    const deltaTime = Math.min(elapsedSinceSimulationMs, MAX_CLIENT_MOVEMENT_DT_MS) / 1000;
    const playerId = localPlayer.identity.toHexString();
    const optimisticElapsedMs = Date.now() - this.optimisticDodgeRollStartMs;
    const isOptimisticDodgeRolling =
      this.optimisticDodgeRollStartMs > 0 && optimisticElapsedMs < DODGE_ROLL_DURATION_MS;
    if (isOptimisticDodgeRolling && this.clientDodgeRoll) {
      return this.clientPosition;
    }

    const currentInput = this.getCurrentInputState();
    const { direction } = currentInput;
    const sprinting = config?.mobileSprintOverride ?? currentInput.sprinting;
    const isActuallyMoving = direction.x !== 0 || direction.y !== 0;
    if (!isActuallyMoving || deltaTime <= 0) {
      return this.clientPosition;
    }

    let speed = PLAYER_SPEED;
    if (sprinting) {
      speed *= SPRINT_MULTIPLIER;
    }
    if (localPlayer.isOnWater) {
      const cappedBonus = Math.min(config?.waterSpeedBonus ?? 0, MAX_WATER_SPEED_BONUS);
      const waterMultiplier = WATER_SPEED_PENALTY * (1.0 + cappedBonus);
      speed *= waterMultiplier;
    } else {
      speed *= 1.0 + (config?.movementSpeedModifier ?? 0);
    }
    if (hasExhaustedEffect(config?.connection ?? null, playerId)) {
      speed *= EXHAUSTED_SPEED_PENALTY;
    }

    const moveDistance = speed * deltaTime;
    return {
      x: this.clientPosition.x + direction.x * moveDistance,
      y: this.clientPosition.y + direction.y * moveDistance,
    };
  };

  getCurrentFacingDirectionNow = (): string => {
    return this.lastFacingDirection || this.config?.localPlayer?.direction || 'down';
  };

  getCurrentDodgeRollVisualNow = (): DodgeRollVisualState => {
    const localPlayer = this.config?.localPlayer;
    if (!localPlayer || localPlayer.isDead) {
      return DEFAULT_DODGE_VISUAL;
    }

    const optimisticElapsedMs = Date.now() - this.optimisticDodgeRollStartMs;
    const isOptimisticDodgeRolling =
      this.optimisticDodgeRollStartMs > 0 && optimisticElapsedMs < DODGE_ROLL_DURATION_MS;
    if (!isOptimisticDodgeRolling) {
      this.visualRollStartMs = 0;
      this.visualRollProgress = 0;
      return {
        isDodgeRolling: false,
        progress: 0,
        direction: this.lastFacingDirection || localPlayer.direction || 'down',
      };
    }

    if (this.visualRollStartMs !== this.optimisticDodgeRollStartMs) {
      this.visualRollStartMs = this.optimisticDodgeRollStartMs;
      this.visualRollProgress = 0;
    }

    if (this.clientDodgeRoll && this.clientPosition) {
      const dodge = this.clientDodgeRoll;
      const totalDx = dodge.targetX - dodge.startX;
      const totalDy = dodge.targetY - dodge.startY;
      const totalDist = Math.sqrt(totalDx * totalDx + totalDy * totalDy);
      if (totalDist > 0.01) {
        const remDx = dodge.targetX - this.clientPosition.x;
        const remDy = dodge.targetY - this.clientPosition.y;
        const remDist = Math.sqrt(remDx * remDx + remDy * remDy);
        const rawProgress = Math.max(0, Math.min(1, 1 - remDist / totalDist));
        const progress = Math.max(rawProgress, this.visualRollProgress);
        this.visualRollProgress = progress;

        const moveDirX = totalDx / totalDist;
        const moveDirY = totalDy / totalDist;
        let direction = this.lastFacingDirection || localPlayer.direction || 'down';
        if (Math.abs(moveDirX) > 0.01 && Math.abs(moveDirY) > 0.01) {
          direction = moveDirX > 0
            ? (moveDirY < 0 ? 'up_right' : 'down_right')
            : (moveDirY < 0 ? 'up_left' : 'down_left');
        } else if (Math.abs(moveDirX) >= Math.abs(moveDirY)) {
          direction = moveDirX > 0 ? 'right' : 'left';
        } else {
          direction = moveDirY > 0 ? 'down' : 'up';
        }
        return { isDodgeRolling: true, progress, direction };
      }
    }

    const rawProgress = Math.max(0, Math.min(1, optimisticElapsedMs / DODGE_ROLL_DURATION_MS));
    const progress = Math.max(rawProgress, this.visualRollProgress);
    this.visualRollProgress = progress;
    return {
      isDodgeRolling: true,
      progress,
      direction: this.lastFacingDirection || localPlayer.direction || 'down',
    };
  };

  getSnapshot(): MovementPredictionSnapshot {
    return {
      predictedPosition: this.clientPosition,
      facingDirection: this.lastFacingDirection,
      dodgeRollVisual: this.getCurrentDodgeRollVisualNow(),
      isAutoWalking: this.config?.isAutoWalking ?? false,
      isAutoAttacking: this.config?.isAutoAttacking ?? false,
    };
  }

  getReconciliationProfilerSnapshot(): ReconciliationProfilerSnapshot | null {
    if (this.reconciliationProfilerState.eventType === 'none' || this.reconciliationProfilerState.eventTimeMs <= 0) {
      return null;
    }

    const eventAgeMs = Math.max(0, performance.now() - this.reconciliationProfilerState.eventTimeMs);
    if (eventAgeMs > RECONCILIATION_PROFILER_VISIBLE_WINDOW_MS) {
      return null;
    }

    return {
      ...this.reconciliationProfilerState,
      eventAgeMs,
    };
  }

  reset(): void {
    this.clientPosition = null;
    this.serverPosition = null;
    this.lastSentTime = 0;
    this.isMoving = false;
    this.lastUpdateTime = 0;
    this.pendingPosition = null;
    this.lastFacingDirection = 'down';
    this.wasDead = true;
    this.clientDodgeRoll = null;
    this.optimisticDodgeRollStartMs = 0;
    this.lastOptimisticDodgeRollStartMs = 0;
    this.visualRollStartMs = 0;
    this.visualRollProgress = 0;
    this.clientSequence = 0n;
    this.lastAckedSequence = 0n;
    this.lastReactPublishTime = 0;
    this.lastReactPublishTileKey = null;
    this.lastReactSnapshot = null;
    this.reconciliationProfilerState = {
      eventId: 0,
      eventType: 'none',
      eventTimeMs: 0,
      receivedSequence: 0,
      previousAckSequence: 0,
      sequenceAdvance: 0,
      errorX: 0,
      errorY: 0,
      errorDist: 0,
    };
    this.publishSnapshot(true);
  }

  private syncServerPlayerState(): void {
    const localPlayer = this.config?.localPlayer;
    if (!localPlayer || !this.clientPosition || !this.serverPosition) {
      return;
    }

    // Death takes priority over an optimistic dodge and movement acknowledgments.
    if (localPlayer.isDead) {
      this.clientPosition = { x: localPlayer.positionX, y: localPlayer.positionY };
      this.serverPosition = { ...this.clientPosition };
      this.pendingPosition = null;
      this.isMoving = false;
      this.clientDodgeRoll = null;
      this.optimisticDodgeRollStartMs = 0;
      this.visualRollStartMs = 0;
      this.visualRollProgress = 0;
      if (!this.wasDead && this.config?.isAutoWalking) this.config.stopAutoWalk();
      this.wasDead = true;
      return;
    }

    const optimisticElapsedMs = Date.now() - this.optimisticDodgeRollStartMs;
    const isOptimisticDodgeRolling =
      this.optimisticDodgeRollStartMs > 0 && optimisticElapsedMs < DODGE_ROLL_DURATION_MS;
    if (isOptimisticDodgeRolling) {
      return;
    }

    const hasRespawned = this.wasDead && !localPlayer.isDead;
    const receivedSequence = localPlayer.clientMovementSequence ?? 0n;
    const sequenceReset = receivedSequence === 0n && this.lastAckedSequence > 0n;
    const previousAckedSequence = this.lastAckedSequence;

    if (hasRespawned || sequenceReset) {
      const newServerPos = { x: localPlayer.positionX, y: localPlayer.positionY };
      const clientPositionBeforeReset = { ...this.clientPosition };
      this.clientPosition = { ...newServerPos };
      this.serverPosition = { ...newServerPos };
      this.pendingPosition = { ...newServerPos };
      this.lastFacingDirection = localPlayer.direction || 'down';
      this.clientSequence = 0n;
      this.lastAckedSequence = 0n;
      this.recordReconciliationEvent(
        hasRespawned ? 'respawn' : 'sequence_reset',
        clientPositionBeforeReset,
        newServerPos,
        receivedSequence,
        previousAckedSequence,
      );
    } else if (receivedSequence > this.lastAckedSequence) {
      const nextServerPosition = { x: localPlayer.positionX, y: localPlayer.positionY };
      this.recordReconciliationEvent(
        'ack',
        this.clientPosition,
        nextServerPosition,
        receivedSequence,
        previousAckedSequence,
      );
      this.lastAckedSequence = receivedSequence;
      this.serverPosition = nextServerPosition;
    }

    this.wasDead = localPlayer.isDead;
  }

  private applyMovementStep(dtSec: number, updateStartTime: number): void {
    const config = this.config;
    const connection = config?.connection ?? null;

    try {
      const localPlayer = readLocalPlayerLife(connection, config?.localPlayer);
      if (!connection || !localPlayer || !this.clientPosition) {
        movementMonitor.logUpdate(performance.now() - updateStartTime, false);
        return;
      }
      if (config && localPlayer !== config.localPlayer) {
        this.config = { ...config, localPlayer };
        this.syncServerPlayerState();
      }
      if (localPlayer.isDead) {
        movementMonitor.logUpdate(performance.now() - updateStartTime, false);
        return;
      }

      const now = performance.now();
      this.lastUpdateTime = now;

      const currentInput = this.getCurrentInputState();
      let { direction } = currentInput;
      const sprinting = config?.mobileSprintOverride ?? currentInput.sprinting;

      const playerId = localPlayer.identity.toHexString();
      const dodgeRollState = config?.playerDodgeRollStates?.get(playerId) as any;
      const dodgeRollStartTime =
        dodgeRollState?.clientReceptionTimeMs ??
        (dodgeRollState ? Number(dodgeRollState.startTimeMs) : 0);
      const dodgeRollElapsedMs = dodgeRollState ? Date.now() - dodgeRollStartTime : 0;
      const isServerDodgeRolling = !!(
        dodgeRollState &&
        dodgeRollElapsedMs >= 0 &&
        dodgeRollElapsedMs < DODGE_ROLL_DURATION_MS
      );
      const optimisticElapsedMs = Date.now() - this.optimisticDodgeRollStartMs;
      const isOptimisticDodgeRolling =
        this.optimisticDodgeRollStartMs > 0 && optimisticElapsedMs < DODGE_ROLL_DURATION_MS;

      if (isOptimisticDodgeRolling && this.clientDodgeRoll) {
        if (isServerDodgeRolling && dodgeRollState) {
          let shouldAdoptServerState = true;
          let localProgress = 0;

          const optimisticDx = this.clientDodgeRoll.targetX - this.clientDodgeRoll.startX;
          const optimisticDy = this.clientDodgeRoll.targetY - this.clientDodgeRoll.startY;
          const serverDx = dodgeRollState.targetX - dodgeRollState.startX;
          const serverDy = dodgeRollState.targetY - dodgeRollState.startY;
          const optimisticMag = Math.sqrt(optimisticDx * optimisticDx + optimisticDy * optimisticDy);
          const serverMag = Math.sqrt(serverDx * serverDx + serverDy * serverDy);
          if (optimisticMag > 0.01 && serverMag > 0.01) {
            const dot =
              (optimisticDx / optimisticMag) * (serverDx / serverMag) +
              (optimisticDy / optimisticMag) * (serverDy / serverMag);
            shouldAdoptServerState = dot >= 0.6;
          }

          const remainingDx = this.clientDodgeRoll.targetX - this.clientPosition.x;
          const remainingDy = this.clientDodgeRoll.targetY - this.clientPosition.y;
          const remainingDist = Math.sqrt(remainingDx * remainingDx + remainingDy * remainingDy);
          localProgress = optimisticMag > 0.01
            ? Math.max(0, Math.min(1, 1 - remainingDist / optimisticMag))
            : 0;

          if (localProgress > 0.35) {
            shouldAdoptServerState = false;
          }

          if (shouldAdoptServerState && typeof dodgeRollState.direction === 'string' && dodgeRollState.direction.length > 0) {
            this.lastFacingDirection = dodgeRollState.direction;
          }

          const serverDodgeStartTime = Number(dodgeRollState.startTimeMs);
          if (shouldAdoptServerState && this.clientDodgeRoll.serverStartTime !== serverDodgeStartTime) {
            const clientStartX = this.clientPosition.x;
            const clientStartY = this.clientPosition.y;
            const serverDodgeDx = dodgeRollState.targetX - dodgeRollState.startX;
            const serverDodgeDy = dodgeRollState.targetY - dodgeRollState.startY;
            this.clientDodgeRoll = {
              startX: clientStartX,
              startY: clientStartY,
              targetX: clientStartX + serverDodgeDx,
              targetY: clientStartY + serverDodgeDy,
              serverStartTime: serverDodgeStartTime,
            };
          }
        }

        const dodgeDx = this.clientDodgeRoll.targetX - this.clientDodgeRoll.startX;
        const dodgeDy = this.clientDodgeRoll.targetY - this.clientDodgeRoll.startY;
        const dodgeDistance = Math.sqrt(dodgeDx * dodgeDx + dodgeDy * dodgeDy);
        let targetX = this.clientPosition.x;
        let targetY = this.clientPosition.y;

        if (dodgeDistance > 0.01) {
          const dodgeDirX = dodgeDx / dodgeDistance;
          const dodgeDirY = dodgeDy / dodgeDistance;
          const moveDistance = DODGE_ROLL_SPEED_PX_PER_SEC * dtSec;
          const remainingDx = this.clientDodgeRoll.targetX - this.clientPosition.x;
          const remainingDy = this.clientDodgeRoll.targetY - this.clientPosition.y;
          const remainingDistance = Math.sqrt(remainingDx * remainingDx + remainingDy * remainingDy);
          if (remainingDistance > 1.0) {
            const actualMoveDistance = Math.min(moveDistance, remainingDistance);
            const moveDirX = remainingDistance > 0.01 ? remainingDx / remainingDistance : dodgeDirX;
            const moveDirY = remainingDistance > 0.01 ? remainingDy / remainingDistance : dodgeDirY;
            targetX = this.clientPosition.x + moveDirX * actualMoveDistance;
            targetY = this.clientPosition.y + moveDirY * actualMoveDistance;
          }
        }

        const collisionResult = resolveClientCollision(
          this.clientPosition.x,
          this.clientPosition.y,
          targetX,
          targetY,
          playerId,
          config!.entities,
          config?.isOnSeaTile,
        );
        this.clientPosition = { x: collisionResult.x, y: collisionResult.y };
        this.pendingPosition = { x: collisionResult.x, y: collisionResult.y };

        if (dodgeDistance > 0.01) {
          const dodgeRollDirX = dodgeDx / dodgeDistance;
          const dodgeRollDirY = dodgeDy / dodgeDistance;
          direction = { x: dodgeRollDirX, y: dodgeRollDirY };
          if (Math.abs(direction.x) > 0.1 || Math.abs(direction.y) > 0.1) {
            this.lastFacingDirection =
              Math.abs(direction.x) > 0.1
                ? (direction.x > 0 ? 'right' : 'left')
                : (direction.y > 0 ? 'down' : 'up');
          }
        }

        movementMonitor.logUpdate(performance.now() - updateStartTime, true);
        return;
      }

      if (this.clientDodgeRoll) {
        this.clientDodgeRoll = null;
      }
      this.optimisticDodgeRollStartMs = 0;

      this.isMoving = Math.abs(direction.x) > 0.01 || Math.abs(direction.y) > 0.01;
      if (this.isMoving && config?.isAutoWalking && !config.isUIFocused) {
        config.stopAutoWalk();
      }

      const hasDirectionalInput = Math.abs(direction.x) > 0.01 || Math.abs(direction.y) > 0.01;
      if (this.isMoving) {
        let speedMultiplier = 1.0;
        if (localPlayer.isKnockedOut) {
          speedMultiplier *= 0.05;
        } else if (sprinting) {
          speedMultiplier *= SPRINT_MULTIPLIER;
        }
        if (localPlayer.isCrouching) {
          speedMultiplier *= 0.5;
        }
        if (hasExhaustedEffect(connection, localPlayer.identity.toHexString())) {
          speedMultiplier *= EXHAUSTED_SPEED_PENALTY;
        }

        const isJumping =
          localPlayer.jumpStartTimeMs > 0 &&
          Date.now() - Number(localPlayer.jumpStartTimeMs) < 500;
        if (localPlayer.isOnWater && !isJumping) {
          const cappedBonus = Math.min(config?.waterSpeedBonus ?? 0, MAX_WATER_SPEED_BONUS);
          speedMultiplier *= WATER_SPEED_PENALTY * (1.0 + cappedBonus);
        } else {
          speedMultiplier *= 1.0 + (config?.movementSpeedModifier ?? 0);
        }

        const moveDistance = PLAYER_SPEED * speedMultiplier * dtSec;
        const targetPos = {
          x: this.clientPosition.x + direction.x * moveDistance,
          y: this.clientPosition.y + direction.y * moveDistance,
        };
        const collisionResult = resolveClientCollision(
          this.clientPosition.x,
          this.clientPosition.y,
          targetPos.x,
          targetPos.y,
          localPlayer.identity.toHexString(),
          config!.entities,
          config?.isOnSeaTile,
        );

        const movementThreshold = localPlayer.isKnockedOut ? 0.01 : 0.1;
        if (Math.abs(direction.x) > movementThreshold || Math.abs(direction.y) > movementThreshold) {
          this.lastFacingDirection =
            Math.abs(direction.x) > movementThreshold
              ? (direction.x > 0 ? 'right' : 'left')
              : (direction.y > 0 ? 'down' : 'up');
        }
        this.clientPosition = { x: collisionResult.x, y: collisionResult.y };
        this.pendingPosition = { x: collisionResult.x, y: collisionResult.y };
      } else if (localPlayer.isKnockedOut && hasDirectionalInput) {
        const movementThreshold = 0.01;
        const newFacingDirection =
          Math.abs(direction.x) > movementThreshold
            ? (direction.x > 0 ? 'right' : 'left')
            : (direction.y > 0 ? 'down' : 'up');

        if (newFacingDirection !== this.lastFacingDirection) {
          this.lastFacingDirection = newFacingDirection;
          const clientTimestamp = BigInt(Date.now());
          try {
            if (connection.reducers.updatePlayerPositionSimple && this.pendingPosition) {
              this.clientSequence += 1n;
              connection.reducers.updatePlayerPositionSimple({
                newX: this.pendingPosition.x,
                newY: this.pendingPosition.y,
                clientTimestampMs: clientTimestamp,
                isSprinting: false,
                facingDirection: this.lastFacingDirection,
                clientSequence: this.clientSequence,
              }).catch((error: any) => {
                if (recoverRejectedPlayerLife(error, connection, localPlayer)) return;
                console.error('❌ [KnockedOut] Failed to send facing direction update:', error);
              });
              this.lastSentTime = now;
            }
          } catch (error) {
            if (recoverRejectedPlayerLife(error, connection, localPlayer)) return;
            console.error('❌ [KnockedOut] Failed to send facing direction update:', error);
          }
        }
      }

      const shouldSendUpdate = now - this.lastSentTime >= POSITION_UPDATE_INTERVAL_MS;
      if (shouldSendUpdate && this.pendingPosition) {
        const clientTimestamp = BigInt(Date.now());
        try {
          if (!connection.reducers.updatePlayerPositionSimple) {
            movementMonitor.logUpdate(performance.now() - updateStartTime, false);
            return;
          }

          this.clientSequence += 1n;
          connection.reducers.updatePlayerPositionSimple({
            newX: this.pendingPosition.x,
            newY: this.pendingPosition.y,
            clientTimestampMs: clientTimestamp,
            isSprinting: sprinting && this.isMoving && !localPlayer.isKnockedOut,
            facingDirection: this.lastFacingDirection,
            clientSequence: this.clientSequence,
          }).catch((error: any) => {
            if (recoverRejectedPlayerLife(error, connection, localPlayer)) return;
            console.error('❌ [SimpleMovement] Failed to send position update:', error);
          });

          this.lastSentTime = now;
          movementMonitor.logUpdate(performance.now() - updateStartTime, true);
        } catch (error) {
          if (recoverRejectedPlayerLife(error, connection, localPlayer)) return;
          console.error('❌ [SimpleMovement] Failed to send position update:', error);
          movementMonitor.logUpdate(performance.now() - updateStartTime, false);
        }
      } else {
        movementMonitor.logUpdate(performance.now() - updateStartTime, false);
      }
    } catch (error) {
      console.error('❌ [SimpleMovement] Error in applyMovementStep:', error);
      movementMonitor.logUpdate(performance.now() - updateStartTime, false);
    }
  }

  private getCurrentInputState(): MovementInputState {
    if (!this.config) {
      return { direction: { x: 0, y: 0 }, sprinting: false };
    }
    return this.config.inputStateRef?.current ?? this.config.inputState;
  }

  private recordReconciliationEvent(
    eventType: ReconciliationProfilerSnapshot['eventType'],
    clientPosition: { x: number; y: number } | null,
    serverPosition: { x: number; y: number },
    receivedSequence: bigint,
    previousAckSequence: bigint,
  ): void {
    const errorX = clientPosition ? clientPosition.x - serverPosition.x : 0;
    const errorY = clientPosition ? clientPosition.y - serverPosition.y : 0;
    const sequenceAdvance = receivedSequence > previousAckSequence
      ? Number(receivedSequence - previousAckSequence)
      : 0;

    this.reconciliationProfilerState = {
      eventId: this.reconciliationProfilerState.eventId + 1,
      eventType,
      eventTimeMs: performance.now(),
      receivedSequence: Number(receivedSequence),
      previousAckSequence: Number(previousAckSequence),
      sequenceAdvance,
      errorX,
      errorY,
      errorDist: Math.hypot(errorX, errorY),
    };
  }

  private publishSnapshot(force = false): void {
    const snapshot = this.getSnapshot();
    if (!force && !this.shouldPublishReactSnapshot(snapshot)) {
      return;
    }

    this.lastReactPublishTime = performance.now();
    this.lastReactPublishTileKey = this.getReactPublishTileKey(snapshot.predictedPosition);
    this.lastReactSnapshot = snapshot;

    runtimeEngine.setPredictedPosition(snapshot.predictedPosition);
    runtimeEngine.updateWorldState('movementPrediction', snapshot);
  }

  private shouldPublishReactSnapshot(snapshot: MovementPredictionSnapshot): boolean {
    const previous = this.lastReactSnapshot;
    if (!previous) {
      return true;
    }

    if (Boolean(previous.predictedPosition) !== Boolean(snapshot.predictedPosition)) {
      return true;
    }

    if (
      previous.facingDirection !== snapshot.facingDirection ||
      previous.isAutoWalking !== snapshot.isAutoWalking ||
      previous.isAutoAttacking !== snapshot.isAutoAttacking ||
      previous.dodgeRollVisual.isDodgeRolling !== snapshot.dodgeRollVisual.isDodgeRolling
    ) {
      return true;
    }

    const nextTileKey = this.getReactPublishTileKey(snapshot.predictedPosition);
    if (nextTileKey !== this.lastReactPublishTileKey) {
      return true;
    }

    return performance.now() - this.lastReactPublishTime >= REACT_MOVEMENT_PUBLISH_INTERVAL_MS;
  }

  private getReactPublishTileKey(position: { x: number; y: number } | null): string | null {
    if (!position) {
      return null;
    }

    const tileX = Math.floor(position.x / gameConfig.tileSize);
    const tileY = Math.floor(position.y / gameConfig.tileSize);
    return `${tileX},${tileY}`;
  }
}

export const movementPredictionRuntime = new MovementPredictionEngine();
