import { Identity } from 'spacetimedb';
import type { DbConnection } from '../../generated';
import type { ActiveEquipment, ItemDefinition, Player, Projectile, RangedWeaponStats } from '../../generated/types';
import { HOLD_INTERACTION_DURATION_MS, JUMP_DURATION_MS, JUMP_HEIGHT_PX } from '../../config/gameConfig';
import { isAnySovaAudioPlaying } from '../../hooks/useSovaSoundBox';
import { previewSeaweedHarvestBlockedIfNeeded } from '../../hooks/useSoundSystem';
import {
  formatTargetForLogging,
  getHoldDuration,
  getSecondaryHoldDuration,
  hasSecondaryHoldAction,
  isTargetValid,
  type InteractableTarget,
  type InteractionTargetType,
} from '../../types/interactions';
import { logDebug } from '../../utils/gameDebugUtils';
import { isWaterContainer } from '../../utils/waterContainerHelpers';
import { runtimeEngine } from '../runtimeEngine';
import type { MutableRef, StateSetter, StateUpdater } from '../types';

export interface GameCanvasInputInteractionProgressState {
  targetId: number | bigint | string | null;
  targetType: InteractionTargetType;
  startTime: number;
}

export interface GameCanvasInputRuntimeState {
  interactionProgress: GameCanvasInputInteractionProgressState | null;
  isActivelyHolding: boolean;
  isAutoAttacking: boolean;
  isCrouching: boolean;
  showBuildingRadialMenu: boolean;
  showUpgradeRadialMenu: boolean;
  radialMenuMouseX: number;
  radialMenuMouseY: number;
  optimisticProjectiles: Map<string, Projectile>;
}

interface StartHoldTimerOptions {
  getCurrentTarget: () => InteractableTarget | null;
  getTurret: (targetId: string | number | bigint | null) => { ammoInstanceId?: unknown; isMonument?: boolean } | null | undefined;
}

interface JumpOffsetUpdateOptions {
  localPlayerId?: string;
  currentLocalPlayer: Player | null | undefined;
  optimisticJumpPressMsRef: MutableRef<number>;
}

interface MobileInteractTriggerOptions {
  isMobile?: boolean;
  mobileInteractTrigger?: number;
  target: InteractableTarget | null;
  connection: DbConnection | null | undefined;
  localPlayer: Player | null | undefined;
  showError: (message: string) => void;
  showSovaSoundBox?: (audio: HTMLAudioElement, label: string) => void;
}

interface MobileInteractionRuntimeOptions {
  isMobile?: boolean;
  mobileInteractTrigger?: number;
  connection: DbConnection | null | undefined;
  localPlayer: Player | null | undefined;
  showError: (message: string) => void;
  showSovaSoundBox?: (audio: HTMLAudioElement, label: string) => void;
  onMobileInteractInfoChange?: (info: { hasTarget: boolean; label?: string } | null) => void;
  getTargetLabel?: (target: InteractableTarget) => string;
}

export interface GameCanvasInputDomEventHandlers {
  onKeyDown: (event: KeyboardEvent) => void;
  onKeyUp: (event: KeyboardEvent) => void;
  onMouseDown: (event: MouseEvent) => void;
  onMouseUp: (event: MouseEvent) => void;
  onWheel: (event: WheelEvent) => void;
  onContextMenu: (event: MouseEvent) => void;
  onWindowBlur: () => void;
  onCanvasClick: (event: MouseEvent) => void;
}

interface BindGameCanvasInputDomEventsOptions {
  getCanvas: () => HTMLCanvasElement | null | undefined;
}

interface ProcessFrameActionsOptions {
  currentConnection: DbConnection | null | undefined;
  localPlayerId?: string;
  currentLocalPlayer: Player | null | undefined;
  currentActiveEquipments: Map<string, ActiveEquipment> | undefined;
  itemDefinitions: Map<string, ItemDefinition> | undefined;
  rangedWeaponStats: Map<string, RangedWeaponStats> | undefined;
  optimisticJumpPressMsRef: MutableRef<number>;
  placementInfo: unknown | null;
  isChatting: boolean;
  isSearchingCraftRecipes?: boolean;
  isAutoAttacking: boolean;
  isActivelyHolding: boolean;
  interactionProgress: GameCanvasInputInteractionProgressState | null;
  isFishing: boolean;
  attemptSwing: () => void;
  attemptRangedFire: () => void;
}

const MOBILE_TAP_BLOCKED_TARGET_TYPES = new Set<string>([
  'campfire',
  'furnace',
  'lantern',
  'box',
  'stash',
  'corpse',
  'sleeping_bag',
  'rain_collector',
  'homestead_hearth',
  'fumarole',
  'broth_pot',
  'alk_station',
  'door',
]);

const INITIAL_INPUT_RUNTIME_STATE: GameCanvasInputRuntimeState = {
  interactionProgress: null,
  isActivelyHolding: false,
  isAutoAttacking: false,
  isCrouching: false,
  showBuildingRadialMenu: false,
  showUpgradeRadialMenu: false,
  radialMenuMouseX: 0,
  radialMenuMouseY: 0,
  optimisticProjectiles: new Map(),
};

function resolveUpdater<T>(updater: StateUpdater<T>, current: T): T {
  return typeof updater === 'function'
    ? (updater as (current: T) => T)(current)
    : updater;
}

export class GameCanvasInputRuntime {
  private state: GameCanvasInputRuntimeState = {
    ...INITIAL_INPUT_RUNTIME_STATE,
    optimisticProjectiles: new Map(),
  };

  private readonly listeners = new Set<() => void>();
  private optimisticProjectileSeq = 0;
  private isEHeldDown = false;
  private eKeyDownTimestamp = 0;
  private eKeyHoldTimer: ReturnType<typeof setTimeout> | null = null;
  private tapActionTriggeredOnKeyDown = false;
  private readonly clientJumpStartTimes = new Map<string, number>();
  private readonly lastKnownServerJumpTimes = new Map<string, number>();
  private currentJumpOffsetY = 0;
  private lastSyncedJumpOffsetY = 0;
  private pendingCrouchToggle = false;
  private isMouseDown = false;
  private nextMeleeSwingAllowedPerf = 0;
  private lastMeleeCooldownKey = '';
  private lastRangedFireTime = 0;
  private suppressMeleeHeldTickAfterMouseDown = false;
  private spaceJumpNeedsRelease = false;
  private isRightMouseDown = false;
  private radialMenuTimeout: ReturnType<typeof setTimeout> | null = null;
  private radialMenuShown = false;
  private upgradeMenuFoundationId: bigint | null = null;
  private upgradeMenuWallId: bigint | null = null;
  private upgradeMenuFenceId: bigint | null = null;
  private hasMobileInteractTriggerBaseline = false;
  private lastMobileInteractTrigger = 0;
  private mobileInteractionOptions: MobileInteractionRuntimeOptions | null = null;
  private lastMobileInteractInfoKey: string | null = null;
  private domEventHandlers: GameCanvasInputDomEventHandlers | null = null;
  private domInputEventsCleanup: (() => void) | null = null;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): GameCanvasInputRuntimeState => this.state;

  configureDomEventHandlers(handlers: GameCanvasInputDomEventHandlers): void {
    this.domEventHandlers = handlers;
  }

  clearDomEventHandlers(handlers?: GameCanvasInputDomEventHandlers): void {
    if (!handlers || this.domEventHandlers === handlers) {
      this.domEventHandlers = null;
    }
  }

  bindDomInputEvents({ getCanvas }: BindGameCanvasInputDomEventsOptions): () => void {
    this.stopDomInputEvents();

    const currentHandlers = () => this.domEventHandlers;
    const handleKeyDown = (event: KeyboardEvent) => currentHandlers()?.onKeyDown(event);
    const handleKeyUp = (event: KeyboardEvent) => currentHandlers()?.onKeyUp(event);
    const handleMouseDown = (event: MouseEvent) => currentHandlers()?.onMouseDown(event);
    const handleMouseUp = (event: MouseEvent) => currentHandlers()?.onMouseUp(event);
    const handleWheel = (event: WheelEvent) => currentHandlers()?.onWheel(event);
    const handleContextMenu = (event: MouseEvent) => currentHandlers()?.onContextMenu(event);
    const handleWindowBlur = () => currentHandlers()?.onWindowBlur();
    const handleCanvasClick = (event: MouseEvent) => currentHandlers()?.onCanvasClick(event);
    const canvas = getCanvas() ?? null;

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('wheel', handleWheel, { passive: true });
    window.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('blur', handleWindowBlur);
    canvas?.addEventListener('click', handleCanvasClick);

    const cleanup = () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('wheel', handleWheel);
      window.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('blur', handleWindowBlur);
      canvas?.removeEventListener('click', handleCanvasClick);
      if (this.domInputEventsCleanup === cleanup) {
        this.domInputEventsCleanup = null;
      }
    };

    this.domInputEventsCleanup = cleanup;
    return cleanup;
  }

  stopDomInputEvents(): void {
    const cleanup = this.domInputEventsCleanup;
    this.domInputEventsCleanup = null;
    cleanup?.();
  }

  setInteractionProgress: StateSetter<GameCanvasInputInteractionProgressState | null> = (value) => {
    this.setField('interactionProgress', value);
  };

  setIsActivelyHolding: StateSetter<boolean> = (value) => {
    this.setField('isActivelyHolding', value);
  };

  setIsAutoAttacking: StateSetter<boolean> = (value) => {
    this.setField('isAutoAttacking', value);
  };

  setIsCrouching: StateSetter<boolean> = (value) => {
    this.setField('isCrouching', value);
  };

  setShowBuildingRadialMenu: StateSetter<boolean> = (value) => {
    this.setField('showBuildingRadialMenu', value);
  };

  setShowUpgradeRadialMenu: StateSetter<boolean> = (value) => {
    this.setField('showUpgradeRadialMenu', value);
  };

  setRadialMenuMouseX: StateSetter<number> = (value) => {
    this.setField('radialMenuMouseX', value);
  };

  setRadialMenuMouseY: StateSetter<number> = (value) => {
    this.setField('radialMenuMouseY', value);
  };

  setOptimisticProjectiles: StateSetter<Map<string, Projectile>> = (value) => {
    this.setField('optimisticProjectiles', value);
  };

  setCurrentJumpOffsetY(value: number): void {
    this.currentJumpOffsetY = value;
    if (this.lastSyncedJumpOffsetY === value) {
      return;
    }
    this.lastSyncedJumpOffsetY = value;
    runtimeEngine.updateInputState('currentJumpOffsetY', value);
  }

  getCurrentJumpOffsetY(): number {
    return this.currentJumpOffsetY;
  }

  clearCurrentJumpOffsetY(): number {
    this.setCurrentJumpOffsetY(0);
    return this.currentJumpOffsetY;
  }

  markLocalOptimisticJump(optimisticJumpPressMsRef: MutableRef<number>, now: number = Date.now()): void {
    optimisticJumpPressMsRef.current = now;
  }

  clearLocalOptimisticJump(optimisticJumpPressMsRef: MutableRef<number>): void {
    optimisticJumpPressMsRef.current = 0;
  }

  isCrouchTogglePending(): boolean {
    return this.pendingCrouchToggle;
  }

  setCrouchTogglePending(value: boolean): void {
    this.pendingCrouchToggle = value;
  }

  shouldIgnoreJumpUntilRelease(): boolean {
    return this.spaceJumpNeedsRelease;
  }

  setJumpNeedsRelease(value: boolean): void {
    this.spaceJumpNeedsRelease = value;
  }

  getIsMouseDown(): boolean {
    return this.isMouseDown;
  }

  setIsMouseDown(value: boolean): void {
    this.isMouseDown = value;
  }

  resetPointerAndJumpState(): void {
    this.isMouseDown = false;
    this.suppressMeleeHeldTickAfterMouseDown = false;
    this.spaceJumpNeedsRelease = false;
  }

  getIsRightMouseDown(): boolean {
    return this.isRightMouseDown;
  }

  setIsRightMouseDown(value: boolean): void {
    this.isRightMouseDown = value;
  }

  isRadialMenuShown(): boolean {
    return this.radialMenuShown;
  }

  setRadialMenuShown(value: boolean): void {
    this.radialMenuShown = value;
  }

  hasRadialMenuTimeout(): boolean {
    return this.radialMenuTimeout !== null;
  }

  setRadialMenuTimeout(callback: () => void, delayMs: number): void {
    this.clearRadialMenuTimeout();
    this.radialMenuTimeout = setTimeout(callback, delayMs);
  }

  clearRadialMenuTimeout(): void {
    if (this.radialMenuTimeout) {
      clearTimeout(this.radialMenuTimeout);
      this.radialMenuTimeout = null;
    }
  }

  getUpgradeMenuFoundationId(): bigint | null {
    return this.upgradeMenuFoundationId;
  }

  setUpgradeMenuFoundationId(value: bigint | null): void {
    this.upgradeMenuFoundationId = value;
  }

  getUpgradeMenuWallId(): bigint | null {
    return this.upgradeMenuWallId;
  }

  setUpgradeMenuWallId(value: bigint | null): void {
    this.upgradeMenuWallId = value;
  }

  getUpgradeMenuFenceId(): bigint | null {
    return this.upgradeMenuFenceId;
  }

  setUpgradeMenuFenceId(value: bigint | null): void {
    this.upgradeMenuFenceId = value;
  }

  clearUpgradeMenuTargetIds(): void {
    this.upgradeMenuFoundationId = null;
    this.upgradeMenuWallId = null;
    this.upgradeMenuFenceId = null;
  }

  clearPendingRadialMenu(): void {
    this.clearRadialMenuTimeout();
    this.clearUpgradeMenuTargetIds();
  }

  configureMobileInteractionState(options: MobileInteractionRuntimeOptions): void {
    this.mobileInteractionOptions = options;
  }

  processConfiguredMobileInteractionState(target: InteractableTarget | null): void {
    const options = this.mobileInteractionOptions;
    if (!options) {
      return;
    }

    if (!options.isMobile) {
      this.lastMobileInteractInfoKey = null;
    }

    if (options.onMobileInteractInfoChange && options.isMobile) {
      const info = target
        ? {
            hasTarget: true,
            label: options.getTargetLabel?.(target),
          }
        : null;
      const nextInfoKey = info ? `${info.hasTarget}:${info.label ?? ''}` : 'null';
      if (nextInfoKey !== this.lastMobileInteractInfoKey) {
        this.lastMobileInteractInfoKey = nextInfoKey;
        options.onMobileInteractInfoChange(info);
      }
    }

    this.processMobileInteractTrigger({
      isMobile: options.isMobile,
      mobileInteractTrigger: options.mobileInteractTrigger,
      target,
      connection: options.connection,
      localPlayer: options.localPlayer,
      showError: options.showError,
      showSovaSoundBox: options.showSovaSoundBox,
    });
  }

  processMobileInteractTrigger({
    isMobile,
    mobileInteractTrigger,
    target,
    connection,
    localPlayer,
    showError,
    showSovaSoundBox,
  }: MobileInteractTriggerOptions): void {
    const trigger = mobileInteractTrigger || 0;
    if (!this.hasMobileInteractTriggerBaseline) {
      this.hasMobileInteractTriggerBaseline = true;
      this.lastMobileInteractTrigger = trigger;
      return;
    }

    if (!isMobile || !trigger || trigger === this.lastMobileInteractTrigger) {
      return;
    }

    this.lastMobileInteractTrigger = trigger;
    if (!target) {
      return;
    }

    if (MOBILE_TAP_BLOCKED_TARGET_TYPES.has(target.type)) {
      if (isAnySovaAudioPlaying()) {
        showError('Not available on mobile.');
      } else if (showSovaSoundBox) {
        const audio = new Audio('/sounds/sova_error_mobile_capability.mp3');
        audio.volume = 0.8;
        showSovaSoundBox(audio, 'SOVA');
        audio.play().catch((error) => {
          console.warn('[Mobile] Failed to play capability error:', error);
        });
      }
      return;
    }

    if (!connection?.reducers) {
      return;
    }

    switch (target.type) {
      case 'harvestable_resource':
        previewSeaweedHarvestBlockedIfNeeded(
          connection,
          target.id as bigint,
          localPlayer?.isSnorkeling,
        );
        connection.reducers.interactWithHarvestableResource({ resourceId: target.id as bigint });
        break;
      case 'dropped_item':
        connection.reducers.pickupDroppedItem({ droppedItemId: target.id as bigint });
        break;
      case 'door':
        connection.reducers.interactDoor({ doorId: target.id as bigint });
        break;
      case 'water':
        logDebug('[Mobile] Water drinking requires hold action - not supported in tap');
        break;
      case 'knocked_out_player':
        logDebug('[Mobile] Reviving requires hold action - not supported in tap');
        break;
    }
  }

  ensureMeleeCooldownKey(cooldownKey: string): void {
    if (this.lastMeleeCooldownKey === cooldownKey) {
      return;
    }
    this.lastMeleeCooldownKey = cooldownKey;
    this.nextMeleeSwingAllowedPerf = 0;
  }

  canMeleeSwing(nowPerf: number = this.getPerformanceNow()): boolean {
    return nowPerf >= this.nextMeleeSwingAllowedPerf;
  }

  blockMeleeSwingFor(durationMs: number, nowPerf: number = this.getPerformanceNow()): void {
    this.nextMeleeSwingAllowedPerf = nowPerf + durationMs;
  }

  setNextMeleeSwingAllowedPerf(value: number): void {
    this.nextMeleeSwingAllowedPerf = value;
  }

  suppressNextMeleeHeldTick(): void {
    this.suppressMeleeHeldTickAfterMouseDown = true;
  }

  clearMeleeHeldTickSuppression(): void {
    this.suppressMeleeHeldTickAfterMouseDown = false;
  }

  consumeMeleeHeldTickSuppression(): boolean {
    const shouldSuppress = this.suppressMeleeHeldTickAfterMouseDown;
    this.suppressMeleeHeldTickAfterMouseDown = false;
    return shouldSuppress;
  }

  canFireRanged(fireIntervalMs: number, nowPerf: number = this.getPerformanceNow()): boolean {
    return nowPerf - this.lastRangedFireTime >= fireIntervalMs;
  }

  markRangedFire(nowPerf: number = this.getPerformanceNow()): void {
    this.lastRangedFireTime = nowPerf;
  }

  hasJumpAnimation({ localPlayerId, currentLocalPlayer, optimisticJumpPressMsRef }: JumpOffsetUpdateOptions): boolean {
    const isLocalPlayerForJump =
      !!localPlayerId &&
      !!currentLocalPlayer &&
      currentLocalPlayer.identity.toHexString() === localPlayerId;
    const hasOptimisticJump = isLocalPlayerForJump && optimisticJumpPressMsRef.current > 0;
    return (currentLocalPlayer?.jumpStartTimeMs ?? 0) > 0 || hasOptimisticJump;
  }

  updateCurrentJumpOffset({
    localPlayerId,
    currentLocalPlayer,
    optimisticJumpPressMsRef,
  }: JumpOffsetUpdateOptions): number {
    if (!currentLocalPlayer) {
      return this.clearCurrentJumpOffsetY();
    }

    const isLocal = localPlayerId === currentLocalPlayer.identity.toHexString();
    const hasOptimisticJump = isLocal && optimisticJumpPressMsRef.current > 0;

    if ((currentLocalPlayer.jumpStartTimeMs ?? 0) > 0 || hasOptimisticJump) {
      const jumpStartTime = Number(currentLocalPlayer.jumpStartTimeMs || 0);
      const playerId = currentLocalPlayer.identity.toHexString();

      if (jumpStartTime > 0) {
        const lastKnownServerTime = this.lastKnownServerJumpTimes.get(playerId) || 0;

        if (jumpStartTime !== lastKnownServerTime) {
          this.lastKnownServerJumpTimes.set(playerId, jumpStartTime);
          const optimisticStart = optimisticJumpPressMsRef.current;
          if (isLocal && optimisticStart > 0) {
            // Keep the optimistic start until render merges the server jump to avoid a double-hop visual.
            this.clientJumpStartTimes.set(playerId, optimisticStart);
          } else {
            this.clientJumpStartTimes.set(playerId, jumpStartTime);
          }
        }
      }

      let clientStartTime = this.clientJumpStartTimes.get(playerId);
      if (isLocal && optimisticJumpPressMsRef.current > 0) {
        const optimisticStart = optimisticJumpPressMsRef.current;
        const elapsedOptimistic = Date.now() - optimisticStart;
        if (elapsedOptimistic < JUMP_DURATION_MS) {
          clientStartTime = optimisticStart;
        } else {
          optimisticJumpPressMsRef.current = 0;
        }
      }

      if (clientStartTime) {
        const elapsedJumpTime = Date.now() - clientStartTime;

        if (elapsedJumpTime < JUMP_DURATION_MS) {
          const t = elapsedJumpTime / JUMP_DURATION_MS;
          this.setCurrentJumpOffsetY(Math.sin(t * Math.PI) * JUMP_HEIGHT_PX);
          return this.currentJumpOffsetY;
        }
      }

      return this.clearCurrentJumpOffsetY();
    }

    const playerId = currentLocalPlayer.identity.toHexString();
    this.clientJumpStartTimes.delete(playerId);
    this.lastKnownServerJumpTimes.delete(playerId);
    optimisticJumpPressMsRef.current = 0;
    return this.clearCurrentJumpOffsetY();
  }

  setProcessInputsAndActions(processInputsAndActions: (() => void) | null): void {
    runtimeEngine.updateInputState('processInputsAndActions', processInputsAndActions);
  }

  processFrameActions({
    currentConnection,
    localPlayerId,
    currentLocalPlayer,
    currentActiveEquipments,
    itemDefinitions,
    rangedWeaponStats,
    optimisticJumpPressMsRef,
    placementInfo,
    isChatting,
    isSearchingCraftRecipes,
    isAutoAttacking,
    isActivelyHolding,
    interactionProgress,
    isFishing,
    attemptSwing,
    attemptRangedFire,
  }: ProcessFrameActionsOptions): void {
    if (!currentConnection?.reducers || !localPlayerId || !currentLocalPlayer) {
      return;
    }

    const isInputDisabledState = currentLocalPlayer.isDead;
    if (isInputDisabledState) {
      this.clearCurrentJumpOffsetY();
      return;
    }

    if (currentLocalPlayer.isDead || isChatting || isSearchingCraftRecipes) {
      this.clearCurrentJumpOffsetY();

      if (isAutoAttacking && !currentLocalPlayer.isDead && !placementInfo && !isFishing) {
        attemptSwing();
      }
      return;
    }

    const hasJumpAnimation = this.hasJumpAnimation({
      localPlayerId,
      currentLocalPlayer,
      optimisticJumpPressMsRef,
    });
    const hasActiveInteraction =
      isActivelyHolding ||
      this.isEHoldActive() ||
      this.hasEHoldTimer() ||
      interactionProgress !== null;
    const hasCombatOrUseAction = this.getIsMouseDown() || isAutoAttacking;
    if (!hasJumpAnimation && !hasActiveInteraction && !hasCombatOrUseAction) {
      this.clearCurrentJumpOffsetY();
      return;
    }

    this.updateCurrentJumpOffset({
      localPlayerId,
      currentLocalPlayer,
      optimisticJumpPressMsRef,
    });

    if (this.getIsMouseDown() && !placementInfo && !isChatting && !isSearchingCraftRecipes) {
      if (!isFishing) {
        const heldMeleeSwingUnlessDuplicateOfMouseDown = () => {
          if (this.consumeMeleeHeldTickSuppression()) {
            return;
          }
          attemptSwing();
        };
        const localPlayerActiveEquipment = currentActiveEquipments?.get(localPlayerId);
        if (localPlayerActiveEquipment?.equippedItemDefId && itemDefinitions) {
          const equippedItemDef = itemDefinitions.get(String(localPlayerActiveEquipment.equippedItemDefId));
          const weaponStats = equippedItemDef ? rangedWeaponStats?.get(equippedItemDef.name || '') : undefined;
          if (equippedItemDef?.category?.tag === 'RangedWeapon' && weaponStats?.isAutomatic) {
            attemptRangedFire();
          } else if (equippedItemDef?.category?.tag === 'RangedWeapon') {
            // Semi-auto weapons fire on click/mousedown path only.
          } else if (equippedItemDef && isWaterContainer(equippedItemDef.name)) {
            // Water containers are handled as a one-shot watering action on mousedown.
          } else {
            heldMeleeSwingUnlessDuplicateOfMouseDown();
          }
        } else {
          heldMeleeSwingUnlessDuplicateOfMouseDown();
        }
      }
    } else if (isAutoAttacking && !placementInfo) {
      if (!isFishing) {
        attemptSwing();
      }
    }
  }

  createClientShotId(localPlayerId?: string): string {
    const seq = this.optimisticProjectileSeq++;
    return `${localPlayerId ?? 'local'}:${Date.now()}:${seq}`;
  }

  isEHoldActive(): boolean {
    return this.isEHeldDown;
  }

  hasEHoldTimer(): boolean {
    return this.eKeyHoldTimer !== null;
  }

  getEHoldTimerDebugValue(): ReturnType<typeof setTimeout> | null {
    return this.eKeyHoldTimer;
  }

  beginEHold(now: number = Date.now()): void {
    this.isEHeldDown = true;
    this.eKeyDownTimestamp = now;
  }

  canBeginEHold(): boolean {
    return !this.isEHeldDown;
  }

  getEHoldStartTime(): number {
    return this.eKeyDownTimestamp;
  }

  getEHoldDuration(now: number = Date.now()): number {
    return now - this.eKeyDownTimestamp;
  }

  markTapActionTriggeredOnKeyDown(): void {
    this.tapActionTriggeredOnKeyDown = true;
  }

  consumeTapActionTriggeredOnKeyDown(): boolean {
    const wasTriggered = this.tapActionTriggeredOnKeyDown;
    this.tapActionTriggeredOnKeyDown = false;
    return wasTriggered;
  }

  finishEHoldKeyPress(): void {
    this.isEHeldDown = false;
    this.eKeyDownTimestamp = 0;
  }

  clearEHoldTimer(): void {
    if (this.eKeyHoldTimer) {
      clearTimeout(this.eKeyHoldTimer);
      this.eKeyHoldTimer = null;
    }
  }

  cancelEHoldInteraction(): void {
    this.isEHeldDown = false;
    this.eKeyDownTimestamp = 0;
    this.tapActionTriggeredOnKeyDown = false;
    this.clearEHoldTimer();
    this.setInteractionProgress(null);
    this.setIsActivelyHolding(false);
  }

  startHoldTimer(
    holdTarget: GameCanvasInputInteractionProgressState,
    connection: DbConnection,
    { getCurrentTarget, getTurret }: StartHoldTimerOptions,
  ): void {
    const currentTarget = getCurrentTarget();
    const duration = currentTarget && holdTarget.targetType === 'knocked_out_player'
      ? getHoldDuration(currentTarget)
      : currentTarget && hasSecondaryHoldAction(currentTarget)
        ? getSecondaryHoldDuration(currentTarget)
        : HOLD_INTERACTION_DURATION_MS;

    console.log(`[E-Timer] Setting up timer for ${duration}ms - holdTarget:`, holdTarget);
    const timerId = setTimeout(() => {
      try {
        const latestTarget = getCurrentTarget();
        console.log(`[E-Timer] Current target check:`, latestTarget ? formatTargetForLogging(latestTarget) : 'null');

        const targetStillValid = latestTarget
          && latestTarget.type === holdTarget.targetType
          && latestTarget.id === holdTarget.targetId
          && isTargetValid(latestTarget);

        if (targetStillValid) {
          switch (holdTarget.targetType) {
            case 'knocked_out_player':
              console.log('[E-Hold ACTION] Attempting to revive player:', holdTarget.targetId);
              connection.reducers.reviveKnockedOutPlayer({ targetPlayerId: Identity.fromString(holdTarget.targetId as string) });
              break;
            case 'water':
              console.log('[E-Hold ACTION] Attempting to drink water');
              connection.reducers.drinkWater({});
              break;
            case 'campfire':
              console.log('[E-Hold ACTION] Attempting to toggle campfire burning:', holdTarget.targetId);
              connection.reducers.toggleCampfireBurning({ campfireId: Number(holdTarget.targetId) });
              break;
            case 'furnace':
              console.log('[E-Hold ACTION] Attempting to toggle furnace burning:', holdTarget.targetId);
              connection.reducers.toggleFurnaceBurning({ furnaceId: Number(holdTarget.targetId) });
              break;
            case 'barbecue':
              console.log('[E-Hold ACTION] Attempting to toggle barbecue burning:', holdTarget.targetId);
              connection.reducers.toggleBarbecueBurning({ barbecueId: Number(holdTarget.targetId) });
              break;
            case 'turret' as InteractionTargetType: {
              const turret = getTurret(holdTarget.targetId);
              if (turret && !turret.ammoInstanceId && !turret.isMonument) {
                console.log('[E-Hold ACTION] Attempting to pickup empty turret:', holdTarget.targetId);
                connection.reducers.pickupTurret({ turretId: Number(holdTarget.targetId) });
              }
              break;
            }
            case 'lantern':
              if (latestTarget.data?.isEmpty) {
                console.log('[E-Hold ACTION] Attempting to pickup empty lantern:', holdTarget.targetId);
                connection.reducers.pickupLantern({ lanternId: Number(holdTarget.targetId) });
              } else {
                console.log('[E-Hold ACTION] Attempting to toggle lantern burning:', holdTarget.targetId);
                connection.reducers.toggleLantern({ lanternId: Number(holdTarget.targetId) });
              }
              break;
            case 'box':
              if (latestTarget.data?.isEmpty) {
                console.log('[E-Hold ACTION] Attempting to pickup storage box:', holdTarget.targetId);
                connection.reducers.pickupStorageBox({ boxId: Number(holdTarget.targetId) });
              } else {
                console.log('[E-Hold FAILED] Storage box is no longer empty');
              }
              break;
            case 'stash':
              console.log('[E-Hold ACTION] Attempting to toggle stash visibility:', holdTarget.targetId);
              connection.reducers.toggleStashVisibility({ stashId: Number(holdTarget.targetId) });
              break;
            case 'homestead_hearth':
              console.log('[E-Hold ACTION] Attempting to grant building privilege from hearth:', holdTarget.targetId);
              connection.reducers.grantBuildingPrivilegeFromHearth({ hearthId: Number(holdTarget.targetId) });
              break;
            case 'door':
              console.log('[E-Hold ACTION] Attempting to pickup door:', holdTarget.targetId);
              connection.reducers.pickupDoor({ doorId: holdTarget.targetId as bigint });
              break;
            default:
              console.log('[E-Hold FAILED] Unknown target type:', holdTarget.targetType);
          }
        } else {
          console.log('[E-Hold FAILED] Target no longer valid. Expected:', holdTarget.targetType, holdTarget.targetId, 'Current:', latestTarget ? formatTargetForLogging(latestTarget) : 'null');
        }

        this.setInteractionProgress(null);
        this.setIsActivelyHolding(false);
        this.isEHeldDown = false;
        this.eKeyHoldTimer = null;
      } catch {
        this.setInteractionProgress(null);
        this.setIsActivelyHolding(false);
        this.isEHeldDown = false;
        this.eKeyHoldTimer = null;
      }
    }, duration);

    this.eKeyHoldTimer = timerId;
    setTimeout(() => {
      if (this.eKeyHoldTimer === null) {
        // console.log(`[E-Timer] *** TIMER REF WAS CLEARED *** Timer ${timerId} ref became null before 250ms!`);
      } else if (this.eKeyHoldTimer !== timerId) {
        // console.log(`[E-Timer] *** TIMER REF CHANGED *** Timer ${timerId} ref is now:`, this.eKeyHoldTimer);
      } else {
        // console.log(`[E-Timer] Timer ${timerId} ref still valid at 100ms checkpoint`);
      }
    }, 100);
  }

  reconcileAuthoritativeProjectiles(
    localPlayerId: string | undefined,
    serverProjectiles: Map<string, Projectile> | undefined,
  ): void {
    if (!localPlayerId || this.state.optimisticProjectiles.size === 0 || !serverProjectiles || serverProjectiles.size === 0) {
      return;
    }

    const authoritativeLocalShotIds = new Set<string>();
    serverProjectiles.forEach((projectile) => {
      const projectileOwner = (projectile as {
        ownerId?: string | { toHexString?: () => string } | null;
      }).ownerId;
      const ownerId =
        typeof projectileOwner === 'string'
          ? projectileOwner
          : projectileOwner?.toHexString?.();
      if (ownerId !== localPlayerId || projectile.sourceType !== 0) return;
      const clientShotId = projectile.clientShotId?.trim?.() ?? '';
      if (clientShotId) authoritativeLocalShotIds.add(clientShotId);
    });

    if (authoritativeLocalShotIds.size === 0) {
      return;
    }

    this.setOptimisticProjectiles((current) => {
      let changed = false;
      const next = new Map(current);
      authoritativeLocalShotIds.forEach((shotId) => {
        if (!next.has(shotId)) return;
        changed = true;
        next.delete(shotId);
      });
      return changed ? next : current;
    });
  }

  reset(): void {
    this.state = {
      ...INITIAL_INPUT_RUNTIME_STATE,
      optimisticProjectiles: new Map(),
    };
    this.optimisticProjectileSeq = 0;
    this.clientJumpStartTimes.clear();
    this.lastKnownServerJumpTimes.clear();
    this.pendingCrouchToggle = false;
    this.isMouseDown = false;
    this.nextMeleeSwingAllowedPerf = 0;
    this.lastMeleeCooldownKey = '';
    this.lastRangedFireTime = 0;
    this.suppressMeleeHeldTickAfterMouseDown = false;
    this.spaceJumpNeedsRelease = false;
    this.isRightMouseDown = false;
    this.clearRadialMenuTimeout();
    this.radialMenuShown = false;
    this.clearUpgradeMenuTargetIds();
    this.hasMobileInteractTriggerBaseline = false;
    this.lastMobileInteractTrigger = 0;
    this.mobileInteractionOptions = null;
    this.lastMobileInteractInfoKey = null;
    this.cancelEHoldInteraction();
    this.clearDomEventHandlers();
    this.stopDomInputEvents();
    this.syncInputState();
    this.syncUiState();
    this.setCurrentJumpOffsetY(0);
    this.setProcessInputsAndActions(null);
    this.emit();
  }

  private setField<K extends keyof GameCanvasInputRuntimeState>(
    field: K,
    value: StateUpdater<GameCanvasInputRuntimeState[K]>,
  ): void {
    const nextValue = resolveUpdater(value, this.state[field]);
    if (Object.is(nextValue, this.state[field])) {
      return;
    }

    this.state = {
      ...this.state,
      [field]: nextValue,
    };

    this.syncField(field);
    this.emit();
  }

  private syncField(field: keyof GameCanvasInputRuntimeState): void {
    switch (field) {
      case 'isAutoAttacking':
        runtimeEngine.updateInputState('isAutoAttacking', this.state.isAutoAttacking);
        return;
      case 'isCrouching':
        runtimeEngine.updateInputState('isCrouching', this.state.isCrouching);
        return;
      case 'interactionProgress':
        runtimeEngine.updateInputState('interactionProgress', this.state.interactionProgress);
        return;
      case 'isActivelyHolding':
        runtimeEngine.updateInputState('isActivelyHolding', this.state.isActivelyHolding);
        return;
      case 'optimisticProjectiles':
        runtimeEngine.updateInputState('optimisticProjectiles', this.state.optimisticProjectiles as Map<string, unknown>);
        return;
      case 'showBuildingRadialMenu':
      case 'showUpgradeRadialMenu':
      case 'radialMenuMouseX':
      case 'radialMenuMouseY':
        this.syncUiState();
        return;
    }
  }

  private syncInputState(): void {
    runtimeEngine.updateInputState('isAutoAttacking', this.state.isAutoAttacking);
    runtimeEngine.updateInputState('isCrouching', this.state.isCrouching);
    runtimeEngine.updateInputState('interactionProgress', this.state.interactionProgress);
    runtimeEngine.updateInputState('isActivelyHolding', this.state.isActivelyHolding);
    runtimeEngine.updateInputState('optimisticProjectiles', this.state.optimisticProjectiles as Map<string, unknown>);
  }

  private syncUiState(): void {
    runtimeEngine.updateUiState('showBuildingRadialMenu', this.state.showBuildingRadialMenu);
    runtimeEngine.updateUiState('showUpgradeRadialMenu', this.state.showUpgradeRadialMenu);
    runtimeEngine.updateUiState('radialMenuMouse', {
      x: this.state.radialMenuMouseX,
      y: this.state.radialMenuMouseY,
    });
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }

  private getPerformanceNow(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  }
}
