import type { Player } from '../../generated/types';
import { runtimeEngine } from '../runtimeEngine';

interface RemotePlayerState {
  lastServerPosition: { x: number; y: number };
  currentDisplayPosition: { x: number; y: number };
  targetPosition: { x: number; y: number };
  lastUpdateTime: number;
}

const INTERPOLATION_SPEED = 14.0;
const SNAP_THRESHOLD = 0.1;
const TELEPORT_THRESHOLD = 200;
const DELTA_TIME_CAP_SEC = 0.1;
const STALE_PLAYER_STATE_MS = 30_000;
const CLEANUP_INTERVAL_MS = 5_000;

class RemotePlayerInterpolator {
  private readonly remotePlayerStates = new Map<string, RemotePlayerState>();
  private lastCleanupTime = performance.now();

  updateAndGetSmoothedPosition(player: Player, localPlayerId?: string): { x: number; y: number } {
    const playerId = player.identity.toHexString();
    if (localPlayerId && playerId === localPlayerId) {
      return { x: player.positionX, y: player.positionY };
    }

    const currentTime = performance.now();
    const serverPosition = { x: player.positionX, y: player.positionY };
    let state = this.remotePlayerStates.get(playerId);

    if (!state) {
      state = {
        lastServerPosition: { ...serverPosition },
        currentDisplayPosition: { ...serverPosition },
        targetPosition: { ...serverPosition },
        lastUpdateTime: currentTime,
      };
      this.remotePlayerStates.set(playerId, state);
      this.commitSnapshot();
      return serverPosition;
    }

    if (currentTime - this.lastCleanupTime >= CLEANUP_INTERVAL_MS) {
      for (const [id, playerState] of this.remotePlayerStates) {
        if (currentTime - playerState.lastUpdateTime > STALE_PLAYER_STATE_MS) {
          this.remotePlayerStates.delete(id);
        }
      }
      this.lastCleanupTime = currentTime;
    }

    const deltaTime = Math.min((currentTime - state.lastUpdateTime) / 1000, DELTA_TIME_CAP_SEC);
    const dx = serverPosition.x - state.lastServerPosition.x;
    const dy = serverPosition.y - state.lastServerPosition.y;
    const positionChanged = Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01;

    if (positionChanged) {
      const teleportDist = Math.abs(dx) + Math.abs(dy);
      if (teleportDist > TELEPORT_THRESHOLD) {
        state.currentDisplayPosition.x = serverPosition.x;
        state.currentDisplayPosition.y = serverPosition.y;
      }

      state.lastServerPosition.x = serverPosition.x;
      state.lastServerPosition.y = serverPosition.y;
      state.targetPosition.x = serverPosition.x;
      state.targetPosition.y = serverPosition.y;
      state.lastUpdateTime = currentTime;
    }

    const interpolationFactor = 1 - Math.exp(-INTERPOLATION_SPEED * deltaTime);
    const remainingX = state.targetPosition.x - state.currentDisplayPosition.x;
    const remainingY = state.targetPosition.y - state.currentDisplayPosition.y;

    if (Math.abs(remainingX) < SNAP_THRESHOLD && Math.abs(remainingY) < SNAP_THRESHOLD) {
      state.currentDisplayPosition.x = state.targetPosition.x;
      state.currentDisplayPosition.y = state.targetPosition.y;
    } else {
      state.currentDisplayPosition.x += remainingX * interpolationFactor;
      state.currentDisplayPosition.y += remainingY * interpolationFactor;
    }

    state.lastUpdateTime = currentTime;
    this.commitSnapshot();
    return {
      x: state.currentDisplayPosition.x,
      y: state.currentDisplayPosition.y,
    };
  }

  cleanupPlayer(playerId: string): void {
    this.remotePlayerStates.delete(playerId);
    this.commitSnapshot();
  }

  private commitSnapshot(): void {
    const next = new Map<string, { x: number; y: number }>();
    for (const [playerId, state] of this.remotePlayerStates) {
      next.set(playerId, {
        x: state.currentDisplayPosition.x,
        y: state.currentDisplayPosition.y,
      });
    }
    runtimeEngine.updateFrameState('remotePlayerPositions', next);
  }
}

export const remotePlayerInterpolator = new RemotePlayerInterpolator();

export const remotePlayerInterpolationRuntime = {
  updateAndGetSmoothedPosition: remotePlayerInterpolator.updateAndGetSmoothedPosition.bind(remotePlayerInterpolator),
  cleanupPlayer: remotePlayerInterpolator.cleanupPlayer.bind(remotePlayerInterpolator),
};
