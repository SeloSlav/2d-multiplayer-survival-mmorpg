import { InternalError, SenderError } from 'spacetimedb';
import { gameConfig, getViewBounds } from '../../config/gameConfig';
import { spawnArrowBreakParticles } from '../../effects/arrowBreakEffect';
import { playImmediateSound } from '../../hooks/useSoundSystem';
import { isAnySovaAudioPlaying } from '../../hooks/useSovaSoundBox';
import { calculateChunkIndex } from '../../utils/chunkUtils';
import { logDebug, logReducer, trimErrorForDisplay } from '../../utils/gameDebugUtils';
import { handleServerThunderEvent } from '../../utils/renderers/rainRenderingUtils';

const VIEWPORT_UPDATE_INTERVAL_MS = 500;
const VIEWPORT_MOVE_THRESHOLD_SQ = 40000;
const VIEWPORT_PREFETCH_MARGIN_CHUNKS = 2;
const VIEWPORT_PREFETCH_MARGIN_PX = gameConfig.chunkSizePx * VIEWPORT_PREFETCH_MARGIN_CHUNKS;
const THUNDER_RANGE_CHUNKS = 4;

type Connection = {
  db?: Record<string, any>;
  reducers?: Record<string, any>;
} | null;

interface GameCanvasAmbientEffectsRuntimeOptions {
  connection: Connection;
  localPlayer: any;
  predictedPosition: { x: number; y: number } | null;
  worldMousePos: { x: number | null; y: number | null };
  localPlayerId?: string;
  activeConsumableEffects: Map<string, any>;
  isAutoAttacking: boolean;
  onAutoActionStatesChange?: (isAutoAttacking: boolean) => void;
  showError: (message: string) => void;
  cameraX: number;
  cameraY: number;
  canvasWidth: number;
  canvasHeight: number;
  chunkWeather: Map<string, any>;
}

type ReducerCleanup = () => void;

const PLACEMENT_LABELS: Record<string, string> = {
  placeCampfire: 'Campfire',
  placeFurnace: 'Furnace',
  placeLantern: 'Lantern',
  placeWoodenStorageBox: 'Wooden Storage Box',
  placeSleepingBag: 'Sleeping Bag',
  placeStash: 'Stash',
  placeShelter: 'Shelter',
  placeRainCollector: 'Rain Collector',
  placeHomesteadHearth: "Matron's Chest",
  placeBarbecue: 'Barbecue',
  placeTurret: 'Turret',
  placeExplosive: 'Explosive',
};

function rejectionMessage(err: unknown): string {
  if (err instanceof SenderError || err instanceof InternalError || err instanceof Error) {
    return err.message;
  }
  return String(err);
}

function wrapReducer(
  reducers: Record<string, unknown>,
  methodName: string,
  onFailure: (errorMsg: string, args: unknown[]) => void,
): ReducerCleanup | undefined {
  const original = reducers[methodName];
  if (typeof original !== 'function') {
    return undefined;
  }

  const bound = original.bind(reducers) as (...args: unknown[]) => Promise<unknown>;
  reducers[methodName] = (...args: unknown[]) => bound(...args).catch((err: unknown) => {
    onFailure(rejectionMessage(err), args);
    return Promise.reject(err);
  });

  return () => {
    reducers[methodName] = original;
  };
}

function isWithinThunderRange(playerChunkIndex: number, thunderChunkIndex: number): boolean {
  const { worldWidthChunks } = gameConfig;
  const playerChunkX = playerChunkIndex % worldWidthChunks;
  const playerChunkY = Math.floor(playerChunkIndex / worldWidthChunks);
  const thunderChunkX = thunderChunkIndex % worldWidthChunks;
  const thunderChunkY = Math.floor(thunderChunkIndex / worldWidthChunks);
  const dx = Math.abs(playerChunkX - thunderChunkX);
  const dy = Math.abs(playerChunkY - thunderChunkY);
  return Math.max(dx, dy) <= THUNDER_RANGE_CHUNKS;
}

function startRainSoundsForWeather(connection: Connection, weatherType: string): void {
  if (!connection?.reducers) {
    return;
  }

  try {
    switch (weatherType) {
      case 'HeavyRain':
      case 'HeavyStorm':
        connection.reducers.startHeavyStormRainSoundReducer?.();
        break;
      case 'LightRain':
      case 'ModerateRain':
        connection.reducers.startNormalRainSoundReducer?.();
        break;
    }
  } catch {
    // Ignore transient reducer errors during weather transitions.
  }
}

function stopRainSoundsForWeather(connection: Connection, weatherType: string): void {
  if (!connection?.reducers) {
    return;
  }

  try {
    switch (weatherType) {
      case 'HeavyRain':
      case 'HeavyStorm':
        connection.reducers.stopHeavyStormRainSoundReducer?.();
        break;
      case 'LightRain':
      case 'ModerateRain':
        connection.reducers.stopNormalRainSoundReducer?.();
        break;
      case 'Clear':
        break;
      default:
        console.warn(`[RainSounds] Unknown weather type to stop: ${weatherType}`);
    }
  } catch (error) {
    console.error('[RainSounds] Error stopping rain sound:', error);
  }
}

export class GameCanvasAmbientEffectsRuntime {
  private burnSoundPlayed = new Set<string>();
  private lastSentFlashlightAngle = 0;
  private lastFlashlightSyncTime = 0;
  private reducerConnection: Connection = null;
  private reducerShowError: ((message: string) => void) | null = null;
  private reducerCleanup: ReducerCleanup | null = null;
  private arrowBreakConnection: Connection = null;
  private arrowBreakListener: ((ctx: any, arrowBreakEvent: any) => void) | null = null;
  private thunderConnection: Connection = null;
  private thunderLocalPlayer: any = null;
  private thunderListener: ((ctx: any, thunderEvent: any) => void) | null = null;
  private processedThunderIds = new Set<string>();
  private lastViewportConnection: Connection = null;
  private lastViewportUpdate = 0;
  private lastViewportPos: { x: number; y: number } | null = null;
  private rainConnection: Connection = null;
  private currentRainWeatherType: string | null = null;
  private lastRainChunkIndex: number | null = null;
  private rainCrossfadeTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastAutoAttacking: boolean | null = null;
  private lastAutoActionCallback: ((isAutoAttacking: boolean) => void) | undefined;

  update(options: GameCanvasAmbientEffectsRuntimeOptions): void {
    this.syncBurnSound(options);
    this.syncFlashlightAim(options);
    this.syncReducerFeedback(options);
    this.syncArrowBreakEffects(options.connection);
    this.syncViewport(options);
    this.syncThunderEffects(options.connection, options.localPlayer);
    this.syncRainSounds(options);
    this.syncAutoActionCallback(options.isAutoAttacking, options.onAutoActionStatesChange);
  }

  stop(): void {
    this.burnSoundPlayed.clear();
    this.detachReducerFeedback();
    this.detachArrowBreakEffects();
    this.detachThunderEffects();
    this.stopRainSounds();
    this.lastViewportConnection = null;
    this.lastViewportUpdate = 0;
    this.lastViewportPos = null;
    this.lastAutoAttacking = null;
    this.lastAutoActionCallback = undefined;
  }

  private syncBurnSound({
    activeConsumableEffects,
    localPlayerId,
  }: GameCanvasAmbientEffectsRuntimeOptions): void {
    if (!localPlayerId || !activeConsumableEffects) {
      return;
    }

    const localPlayerBurnEffects: any[] = [];
    for (const effect of activeConsumableEffects.values()) {
      if (effect.playerId.toHexString() === localPlayerId && effect.effectType.tag === 'Burn') {
        localPlayerBurnEffects.push(effect);
      }
    }

    localPlayerBurnEffects.forEach((effect) => {
      const effectKey = `${effect.effectId}_${effect.endsAt.microsSinceUnixEpoch}`;
      if (!this.burnSoundPlayed.has(effectKey)) {
        logDebug('[BURN_SOUND] Playing burn sound for effect', effect.effectId, 'ending at', effect.endsAt.microsSinceUnixEpoch);
        playImmediateSound('player_burnt', 1.0);
        this.burnSoundPlayed.add(effectKey);
      }
    });

    const currentEffectKeys = new Set(
      localPlayerBurnEffects.map((effect) => `${effect.effectId}_${effect.endsAt.microsSinceUnixEpoch}`),
    );
    this.burnSoundPlayed.forEach((oldKey) => {
      if (!currentEffectKeys.has(oldKey)) {
        this.burnSoundPlayed.delete(oldKey);
      }
    });
  }

  private syncFlashlightAim({
    connection,
    localPlayer,
    predictedPosition,
    worldMousePos,
  }: GameCanvasAmbientEffectsRuntimeOptions): void {
    if (!connection || !localPlayer?.isFlashlightOn) {
      return;
    }
    if (worldMousePos.x === null || worldMousePos.y === null) {
      return;
    }

    const playerX = predictedPosition?.x ?? localPlayer.positionX;
    const playerY = predictedPosition?.y ?? localPlayer.positionY;
    const dx = worldMousePos.x - playerX;
    const dy = worldMousePos.y - playerY;
    const aimAngle = Math.atan2(dy, dx);
    const angleDiff = Math.abs(aimAngle - this.lastSentFlashlightAngle);
    const now = Date.now();
    const timeSinceLastSync = now - this.lastFlashlightSyncTime;

    if (angleDiff > 0.087 || timeSinceLastSync > 100) {
      this.lastSentFlashlightAngle = aimAngle;
      this.lastFlashlightSyncTime = now;

      try {
        connection.reducers?.updateFlashlightAim?.({ aimAngle });
      } catch {
        // Ignore reducer errors during hot reload / partial runtime init.
      }
    }
  }

  private syncReducerFeedback({
    connection,
    showError,
  }: GameCanvasAmbientEffectsRuntimeOptions): void {
    if (this.reducerConnection === connection && this.reducerShowError === showError) {
      return;
    }

    this.detachReducerFeedback();
    this.reducerConnection = connection;
    this.reducerShowError = showError;

    if (!connection?.reducers) {
      return;
    }

    const reducers = connection.reducers;
    const cleanups: ReducerCleanup[] = [];
    const add = (method: string, onFailure: (errorMsg: string, args: unknown[]) => void) => {
      const cleanup = wrapReducer(reducers, method, onFailure);
      if (cleanup) {
        cleanups.push(cleanup);
      }
    };

    add('consumeItem', (errorMsg, args) => {
      const params = args[0] as { itemInstanceId?: bigint } | undefined;
      logReducer('GameCanvas', 'consumeItem reject', params?.itemInstanceId?.toString?.() ?? '?', errorMsg);
      if (errorMsg === 'BREW_COOLDOWN') {
        if (isAnySovaAudioPlaying()) {
          showError('Brew cooldown active.');
        } else {
          const brewCooldownSounds = [
            '/sounds/sova_brew_cooldown.mp3',
            '/sounds/sova_brew_cooldown1.mp3',
            '/sounds/sova_brew_cooldown2.mp3',
            '/sounds/sova_brew_cooldown3.mp3',
          ];
          const randomSound = brewCooldownSounds[Math.floor(Math.random() * brewCooldownSounds.length)];
          try {
            const audio = new Audio(randomSound);
            audio.volume = 0.7;
            audio.play().catch(() => {});
          } catch {
            // Ignore audio startup failures.
          }
        }
      } else {
        showError(trimErrorForDisplay(errorMsg));
      }
    });

    add('applyFertilizer', (errorMsg, args) => {
      const params = args[0] as { fertilizerInstanceId?: bigint } | undefined;
      logReducer('GameCanvas', 'applyFertilizer reject', params?.fertilizerInstanceId?.toString?.() ?? '?', errorMsg);
      showError(trimErrorForDisplay(errorMsg || 'Unknown error'));
    });

    add('destroyFoundation', (errorMsg) => {
      logReducer('GameCanvas', 'destroyFoundation', errorMsg);
      showError(trimErrorForDisplay(errorMsg || 'Failed to destroy foundation'));
    });

    add('destroyWall', (errorMsg) => {
      logReducer('GameCanvas', 'destroyWall', errorMsg);
      showError(trimErrorForDisplay(errorMsg || 'Failed to destroy wall'));
    });

    add('fireProjectile', () => {});

    add('loadRangedWeapon', (errorMsg) => {
      if (errorMsg.includes('need at least 1 arrow')) {
        playImmediateSound('error_arrows', 1.0);
      }
      showError(errorMsg || 'Failed to load weapon');
    });

    const upgradeFoundationLike = (errorMsg: string) => {
      if (errorMsg.includes('Building privilege') || errorMsg.includes('building privilege')) {
        playImmediateSound('error_building_privilege', 1.0);
      } else if (
        errorMsg.includes('Cannot downgrade')
        || errorMsg.includes('Current tier')
        || errorMsg.includes('Target tier')
      ) {
        playImmediateSound('error_tier_upgrade', 1.0);
      } else if (
        errorMsg.includes('Not enough')
        || errorMsg.includes('wood')
        || errorMsg.includes('stone')
        || errorMsg.includes('metal fragments')
        || errorMsg.includes('Required:')
      ) {
        playImmediateSound('error_resources', 1.0);
      }
      showError(trimErrorForDisplay(errorMsg));
    };

    add('upgradeFoundation', (errorMsg) => upgradeFoundationLike(errorMsg));
    add('upgradeWall', (errorMsg) => {
      logReducer('GameCanvas', 'upgradeWall', errorMsg);
      upgradeFoundationLike(errorMsg || 'Failed to upgrade wall');
    });

    for (const [method, label] of Object.entries(PLACEMENT_LABELS)) {
      add(method, (errorMsg) => {
        playImmediateSound('error_placement_failed', 1.0);
        showError(trimErrorForDisplay(errorMsg || `${label} placement failed`));
      });
    }

    add('pickupDroppedItem', (errorMsg) => {
      const lower = errorMsg.toLowerCase();
      if (lower.includes('too far') || lower.includes('not found')) {
        return;
      }
      showError(trimErrorForDisplay(errorMsg || 'Cannot pick up item'));
    });

    add('interactDoor', (errorMsg) => {
      if (errorMsg.toLowerCase().includes('too far')) {
        return;
      }
      showError(trimErrorForDisplay(errorMsg || 'Cannot interact with door'));
    });

    add('interactWithCairn', (errorMsg) => {
      if (errorMsg.toLowerCase().includes('too far')) {
        return;
      }
      showError(trimErrorForDisplay(errorMsg || 'Cannot interact with cairn'));
    });

    add('milkAnimal', (errorMsg) => {
      if (errorMsg.toLowerCase().includes('too far')) {
        return;
      }
      showError(trimErrorForDisplay(errorMsg || 'Cannot milk animal'));
    });

    add('castFishingLine', (errorMsg) => {
      if (errorMsg.toLowerCase().includes('too far')) {
        return;
      }
      showError(trimErrorForDisplay(errorMsg || 'Cannot cast fishing line'));
    });

    add('finishFishing', (errorMsg) => {
      const lower = errorMsg.toLowerCase();
      if (lower.includes('no active') || lower.includes('session is not active')) {
        return;
      }
      showError(trimErrorForDisplay(errorMsg || 'Fishing failed'));
    });

    add('respawnRandomly', (errorMsg) => {
      showError(trimErrorForDisplay(errorMsg || 'Respawn failed'));
    });

    add('respawnAtSleepingBag', (errorMsg) => {
      showError(trimErrorForDisplay(errorMsg || 'Respawn at sleeping bag failed'));
    });

    this.reducerCleanup = () => {
      for (let i = cleanups.length - 1; i >= 0; i -= 1) {
        cleanups[i]();
      }
    };
  }

  private detachReducerFeedback(): void {
    this.reducerCleanup?.();
    this.reducerCleanup = null;
    this.reducerConnection = null;
    this.reducerShowError = null;
  }

  private syncArrowBreakEffects(connection: Connection): void {
    if (this.arrowBreakConnection === connection) {
      return;
    }

    this.detachArrowBreakEffects();
    this.arrowBreakConnection = connection;

    if (!connection?.db?.arrow_break_event) {
      return;
    }

    this.arrowBreakListener = (ctx: any, arrowBreakEvent: any) => {
      if (ctx && ctx.event && ctx.event.type !== 'SubscribeApplied') {
        console.log(`[ArrowBreak] Spawning particles at (${arrowBreakEvent.posX}, ${arrowBreakEvent.posY})`);
        spawnArrowBreakParticles(arrowBreakEvent.posX, arrowBreakEvent.posY);
      }
    };
    connection.db.arrow_break_event.onInsert(this.arrowBreakListener);
  }

  private detachArrowBreakEffects(): void {
    if (this.arrowBreakConnection?.db?.arrow_break_event && this.arrowBreakListener) {
      this.arrowBreakConnection.db.arrow_break_event.removeOnInsert?.(this.arrowBreakListener);
    }
    this.arrowBreakConnection = null;
    this.arrowBreakListener = null;
  }

  private syncViewport({
    connection,
    cameraX,
    cameraY,
    canvasWidth,
    canvasHeight,
  }: GameCanvasAmbientEffectsRuntimeOptions): void {
    if (!connection?.reducers) {
      return;
    }

    if (this.lastViewportConnection !== connection) {
      this.lastViewportConnection = connection;
      this.lastViewportUpdate = 0;
      this.lastViewportPos = null;
    }

    const now = Date.now();
    const timeDiff = now - this.lastViewportUpdate;

    let distSq = 0;
    if (this.lastViewportPos) {
      const dx = cameraX - this.lastViewportPos.x;
      const dy = cameraY - this.lastViewportPos.y;
      distSq = dx * dx + dy * dy;
    } else {
      distSq = Infinity;
    }

    if (timeDiff > VIEWPORT_UPDATE_INTERVAL_MS || distSq > VIEWPORT_MOVE_THRESHOLD_SQ) {
      this.lastViewportUpdate = now;
      this.lastViewportPos = { x: cameraX, y: cameraY };

      const viewBounds = getViewBounds(cameraX, cameraY, canvasWidth, canvasHeight);
      const expandedBounds = {
        minX: viewBounds.minX - VIEWPORT_PREFETCH_MARGIN_PX,
        minY: viewBounds.minY - VIEWPORT_PREFETCH_MARGIN_PX,
        maxX: viewBounds.maxX + VIEWPORT_PREFETCH_MARGIN_PX,
        maxY: viewBounds.maxY + VIEWPORT_PREFETCH_MARGIN_PX,
      };
      try {
        connection.reducers.updateViewport?.(expandedBounds);
      } catch (error) {
        console.error('[GameCanvasAmbientEffectsRuntime] Failed to update viewport on server:', error);
      }
    }
  }

  private syncThunderEffects(connection: Connection, localPlayer: any): void {
    this.thunderLocalPlayer = localPlayer;

    if (this.thunderConnection === connection) {
      return;
    }

    this.detachThunderEffects();
    this.thunderConnection = connection;

    if (!connection?.db?.thunder_event) {
      return;
    }

    this.thunderListener = (_ctx: any, thunderEvent: any) => {
      const thunderId = thunderEvent.id?.toString();
      if (!thunderId || this.processedThunderIds.has(thunderId)) {
        return;
      }

      const player = this.thunderLocalPlayer;
      const thunderChunkIndex = thunderEvent.chunkIndex ?? thunderEvent.chunk_index ?? 0;
      if (player?.positionX != null && player?.positionY != null) {
        const playerChunkIndex = calculateChunkIndex(player.positionX, player.positionY);
        if (!isWithinThunderRange(playerChunkIndex, thunderChunkIndex)) {
          return;
        }
      }

      this.processedThunderIds.add(thunderId);
      if (this.processedThunderIds.size > 100) {
        const idsArray = Array.from(this.processedThunderIds);
        this.processedThunderIds = new Set(idsArray.slice(-50));
      }

      handleServerThunderEvent(thunderEvent);
    };
    connection.db.thunder_event.onInsert(this.thunderListener);
  }

  private detachThunderEffects(): void {
    if (this.thunderConnection?.db?.thunder_event && this.thunderListener) {
      this.thunderConnection.db.thunder_event.removeOnInsert?.(this.thunderListener);
    }
    this.thunderConnection = null;
    this.thunderListener = null;
    this.processedThunderIds.clear();
  }

  private syncRainSounds({
    connection,
    localPlayer,
    chunkWeather,
  }: GameCanvasAmbientEffectsRuntimeOptions): void {
    if (this.rainConnection !== connection) {
      this.stopRainSounds();
      this.rainConnection = connection;
    }

    if (!connection || !localPlayer || !chunkWeather) {
      return;
    }

    const currentChunkIndex = calculateChunkIndex(localPlayer.positionX, localPlayer.positionY);
    const chunkWeatherData = chunkWeather.get(currentChunkIndex.toString());
    const currentWeatherType = chunkWeatherData?.currentWeather?.tag || 'Clear';
    const chunkChanged = this.lastRainChunkIndex !== currentChunkIndex;
    const weatherChanged = this.currentRainWeatherType !== currentWeatherType;

    if (!chunkChanged && !weatherChanged) {
      return;
    }

    const oldWeather = this.currentRainWeatherType;

    if (this.rainCrossfadeTimeout) {
      clearTimeout(this.rainCrossfadeTimeout);
      this.rainCrossfadeTimeout = null;
    }

    if (weatherChanged && oldWeather && oldWeather !== 'Clear' && currentWeatherType !== 'Clear') {
      startRainSoundsForWeather(connection, currentWeatherType);
      this.rainCrossfadeTimeout = setTimeout(() => {
        stopRainSoundsForWeather(connection, oldWeather);
        this.rainCrossfadeTimeout = null;
      }, 1000);
    } else {
      if (weatherChanged && oldWeather) {
        stopRainSoundsForWeather(connection, oldWeather);
      }
      startRainSoundsForWeather(connection, currentWeatherType);
    }

    this.currentRainWeatherType = currentWeatherType;
    this.lastRainChunkIndex = currentChunkIndex;
  }

  private stopRainSounds(): void {
    if (this.rainCrossfadeTimeout) {
      clearTimeout(this.rainCrossfadeTimeout);
      this.rainCrossfadeTimeout = null;
    }

    if (this.rainConnection && this.currentRainWeatherType) {
      stopRainSoundsForWeather(this.rainConnection, this.currentRainWeatherType);
    }

    this.rainConnection = null;
    this.currentRainWeatherType = null;
    this.lastRainChunkIndex = null;
  }

  private syncAutoActionCallback(
    isAutoAttacking: boolean,
    onAutoActionStatesChange?: (isAutoAttacking: boolean) => void,
  ): void {
    if (
      this.lastAutoAttacking === isAutoAttacking
      && this.lastAutoActionCallback === onAutoActionStatesChange
    ) {
      return;
    }

    this.lastAutoAttacking = isAutoAttacking;
    this.lastAutoActionCallback = onAutoActionStatesChange;
    onAutoActionStatesChange?.(isAutoAttacking);
  }
}
