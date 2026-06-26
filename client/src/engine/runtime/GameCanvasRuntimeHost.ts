import { gameConfig } from '../../config/gameConfig';
import { runtimeEngine } from '../runtimeEngine';
import { renderGameCanvasFrame } from '../frame/renderGameCanvasFrame';
import type { DbConnection } from '../../generated';
import type { FrameInfo, GameLoopMetrics, MutableRef, RuntimeFramePipeline, StateSetter } from '../types';
import type { Projectile as SpacetimeDBProjectile } from '../../generated/types';
import { FpsProfiler } from '../../utils/profiler';
import type { CampfireFireGpuEmitter } from '../../utils/renderers/campfireFireOverlayUtils';
import { addCameraSample, isProfilerRecording } from '../../utils/profilerRecording';
import type { ReconciliationProfilerSnapshot } from './movementPredictionRuntime';
import { GameCanvasAmbientEffectsRuntime } from './gameCanvasAmbientEffectsRuntime';
import {
  GameCanvasParticleRuntime,
  type GameCanvasParticleRuntimeOptions,
} from './gameCanvasParticleRuntime';
import {
  assembleGameCanvasRenderContext,
  type GameCanvasRenderRuntimeConfig,
} from './assembleGameCanvasRenderContext';
import {
  releaseAnimationCycleLoop,
  retainAnimationCycleLoop,
} from '../../hooks/useAnimationCycle';
import { AmbientSoundRuntime } from './ambientSoundRuntime';
import {
  GameCanvasPointerRuntime,
  type GameCanvasPointerRuntimeOptions,
  type GameCanvasPointerSnapshot,
} from './gameCanvasPointerRuntime';
import {
  EMPTY_GAME_CANVAS_BUILD_TARGETING_SNAPSHOT,
  GameCanvasBuildTargetingRuntime,
  type GameCanvasBuildTargetingSnapshot,
} from './gameCanvasBuildTargetingRuntime';
import {
  calculateInteractionTargetRuntimeResult,
  EMPTY_INTERACTION_TARGET_RUNTIME_RESULT,
  type InteractionTargetRuntimeResult,
} from './interactionTargetRuntime';
import {
  BuildingPlacementRuntime,
  type BuildingPlacementRuntimeOptions,
  type BuildingPlacementRuntimeSnapshot,
} from './buildingPlacementRuntime';
import {
  CloudInterpolationRuntime,
  type InterpolatedCloudData,
} from './cloudInterpolationRuntime';
import {
  GrassInterpolationRuntime,
  type InterpolatedGrassData,
} from './grassInterpolationRuntime';
import {
  FallingTreeAnimationRuntime,
  type FallingTreeAnimationRuntimeSnapshot,
} from './fallingTreeAnimationRuntime';
import { ProjectilePresentationRuntime } from './projectilePresentationRuntime';
import {
  WorldLookupRuntime,
  type WorldLookupRuntimeOptions,
  type WorldLookupRuntimeSnapshot,
} from './worldLookupRuntime';
import {
  DayNightCycleRuntime,
  type DayNightCycleRuntimeOptions,
  type DayNightCycleRuntimeSnapshot,
} from './dayNightCycleRuntime';
import {
  EntityFilteringRuntime,
  type EntityFilteringResult,
} from './entityFilteringRuntime';
import { remotePlayerInterpolationRuntime } from './remotePlayerInterpolator';
import type {
  Cloud as SpacetimeDBCloud,
  Grass as SpacetimeDBGrass,
  GrassState as SpacetimeDBGrassState,
  Tree as SpacetimeDBTree,
} from '../../generated/types';

const EMPTY_RUNTIME_MAP = new Map<string, any>();
const EMPTY_WORLD_MOUSE_POS = { x: null, y: null };
const NOOP_SHOW_ERROR = () => {};

export interface GameCanvasRuntimeRenderContext {
  [key: string]: unknown;
}

export interface GameCanvasRuntimeSceneSnapshot extends Record<string, any> {
  worldChunkDataMap: Map<string, any> | undefined;
  interpolatedClouds: Map<string, any>;
  interpolatedGrass: Map<string, any>;
  shipwreckPartsMap: Map<string, any>;
  isTreeFalling: (treeId: string) => boolean;
  getFallProgress: (treeId: string) => number;
  TREE_FALL_DURATION_MS: number;
  resolvedOverlayRgba: any;
  resolvedBuildingClusters: any;
  resolvedYSortedEntities: any[];
  resolvedSwimmingPlayersForBottomHalf: any[];
  resolvedMaskCanvas: HTMLCanvasElement | null;
}

export interface GameCanvasRuntimeFrameBindings {
  processInputsAndActions: () => void;
  stepPredictedMovement?: (dtMs: number) => void;
  fixedSimulationEnabled: boolean;
  connection: any | null;
  getCurrentPositionNow?: () => { x: number; y: number } | null;
  getReconciliationProfilerSnapshot?: () => ReconciliationProfilerSnapshot | null;
  predictedPositionRef: MutableRef<{ x: number; y: number } | null>;
  getCurrentFacingDirectionNow?: () => string | undefined;
  localFacingDirectionRef: MutableRef<string | undefined>;
  localPlayer: any;
  isAutoWalking: boolean;
  canvasWidth: number;
  canvasHeight: number;
  gameLoopMetricsRef: MutableRef<GameLoopMetrics | null>;
  deltaTimeRef: MutableRef<number>;
  interactionScanFrameSkipRef: MutableRef<number>;
  cameraOffsetRef: MutableRef<{ x: number; y: number }>;
}

export interface GameCanvasRuntimeFrameBindingControllerOptions {
  controllerSnapshot: GameCanvasRuntimeControllerSnapshot;
  stepPredictedMovement?: (dtMs: number) => void;
  fixedSimulationEnabled: boolean;
  connection: any | null;
  getCurrentPositionNow?: () => { x: number; y: number } | null;
  getReconciliationProfilerSnapshot?: () => ReconciliationProfilerSnapshot | null;
  getCurrentFacingDirectionNow?: () => string | undefined;
  localPlayer: any;
  isAutoWalking: boolean;
  canvasSize: { width: number; height: number };
  gameLoopMetricsRef: MutableRef<GameLoopMetrics | null>;
  deltaTimeRef: MutableRef<number>;
  interactionScanFrameSkipRef: MutableRef<number>;
}

export interface GameCanvasRuntimeControllerAdjunctOptions {
  showUpgradeRadialMenu: boolean;
  targetedFoundation: any | null;
  targetedWall: any | null;
  targetedFence: any | null;
  localPlayer: any;
  connection: any | null;
  isGameMenuOpen: boolean;
  placementInfo: any;
  deathMarkers: Map<string, any> | undefined;
  sleepingBags: Map<string, any>;
}

export interface GameCanvasRuntimeControllerAdjunctState {
  upgradeMenuFoundationRef: MutableRef<any | null>;
  upgradeMenuWallRef: MutableRef<any | null>;
  upgradeMenuFenceRef: MutableRef<any | null>;
  shouldShowDeathScreen: boolean;
  cursorStyle: string;
  localPlayerDeathMarker: any | null;
  sleepingBagsById: Map<number, any>;
}

export interface GameCanvasControllerBuildRuntimeOptions {
  connection: any | null;
  predictedPosition: { x: number; y: number } | null;
  localPlayer: any;
  activeEquipments: Map<string, any>;
  itemDefinitions: Map<string, any>;
  localPlayerId?: string;
  foundationCells?: Map<string, any>;
  fences?: Map<string, any>;
}

export interface GameCanvasControllerBuildRuntimeState {
  worldMousePos: { x: number | null; y: number | null };
  canvasMousePos: { x: number | null; y: number | null };
  buildingState: BuildingPlacementRuntimeSnapshot['buildingState'];
  buildingActions: BuildingPlacementRuntimeSnapshot['buildingActions'];
  hasRepairHammer: boolean;
  hasStoneTiller: boolean;
  targetedFoundation: any;
  targetTileX: number | null;
  targetTileY: number | null;
  targetedWall: any;
  targetWallTileX: number | null;
  targetWallTileY: number | null;
  targetedFence: any;
}

export interface GameCanvasSceneInterpolationRuntimeOptions {
  clouds: Map<string, SpacetimeDBCloud>;
  grass: Map<string, SpacetimeDBGrass>;
  grassState: Map<string, SpacetimeDBGrassState>;
}

export interface GameCanvasSceneInterpolationRuntimeSnapshot {
  interpolatedClouds: Map<string, InterpolatedCloudData>;
  interpolatedGrass: Map<string, InterpolatedGrassData>;
}

export interface GameCanvasProjectilePresentationRuntimeOptions {
  connection: DbConnection | null;
  authoritativeProjectiles: Map<string, SpacetimeDBProjectile>;
}

export interface GameCanvasFrameAssemblyRuntimeOptions {
  connection: any | null;
  players: Map<string, any>;
  trees: Map<string, any>;
  stones: Map<string, any>;
  runeStones: Map<string, any>;
  cairns: Map<string, any>;
  campfires: Map<string, any>;
  furnaces: Map<string, any>;
  barbecues: Map<string, any>;
  lanterns: Map<string, any>;
  turrets: Map<string, any>;
  homesteadHearths: Map<string, any>;
  harvestableResources: Map<string, any>;
  droppedItems: Map<string, any>;
  woodenStorageBoxes: Map<string, any>;
  sleepingBags: Map<string, any>;
  playerCorpses: Map<string, any>;
  stashes: Map<string, any>;
  cameraOffsetX: number;
  cameraOffsetY: number;
  canvasWidth: number;
  canvasHeight: number;
  interpolatedGrass: Map<string, any>;
  projectiles: Map<string, any>;
  shelters: Map<string, any>;
  clouds: Map<string, any>;
  plantedSeeds: Map<string, any>;
  rainCollectors: Map<string, any>;
  brothPots: Map<string, any>;
  wildAnimals: Map<string, any>;
  animalCorpses: Map<string, any>;
  barrels: Map<string, any>;
  roadLampposts: Map<string, any>;
  fumaroles: Map<string, any>;
  basaltColumns: Map<string, any>;
  seaStacks: Map<string, any>;
  foundationCells: Map<string, any>;
  wallCells: Map<string, any>;
  doors: Map<string, any>;
  fences: Map<string, any>;
  localPlayerId?: string;
  isLocalPlayerSnorkeling: boolean;
  predictedPosition: { x: number; y: number } | null;
  isTreeFalling: (treeId: string) => boolean;
  worldChunkDataMap: Map<string, any> | null | undefined;
  alkStations: Map<string, any>;
  monumentParts: Map<string, any>;
  livingCorals: Map<string, any>;
  seaTransitionTileLookup: Map<string, boolean>;
  waterTileLookup: Map<string, boolean>;
  worldState: any;
  firePatches: Map<string, any>;
  activeEquipments: Map<string, any>;
  itemDefinitions: Map<string, any>;
  worldMouseX: number;
  worldMouseY: number;
  roadLamppostsAll: Map<string, any>;
  barrelsAll: Map<string, any>;
}

export interface GameCanvasRuntimeFrameStateOptions {
  worldMousePos: { x: number | null; y: number | null };
  cameraOffsetX: number;
  cameraOffsetY: number;
  predictedPosition: { x: number; y: number } | null;
  localFacingDirection: string | undefined;
  interpolatedClouds: Map<string, any>;
  cycleProgress: number;
  ySortedEntities: any[];
  swimmingPlayersForBottomHalf: any[];
  messages: any;
  renderableProjectiles: Map<string, SpacetimeDBProjectile>;
  holdInteractionProgress: { targetId: string | number | bigint | null; targetType: string; startTime: number } | null;
  isActivelyHolding: boolean;
  closestInteractableHarvestableResourceId: bigint | null;
  closestInteractableCampfireId: number | bigint | null;
  closestInteractableDroppedItemId: number | bigint | null;
  closestInteractableBoxId: number | bigint | null;
  isClosestInteractableBoxEmpty: boolean;
  closestInteractableWaterPosition: { x: number; y: number } | null;
  closestInteractableStashId: number | bigint | null;
  closestInteractableSleepingBagId: number | bigint | null;
  closestInteractableDoorId: number | bigint | null;
  closestInteractableTarget: any;
  unifiedInteractableTarget: any;
  closestInteractableKnockedOutPlayerId: string | null;
  closestInteractableCorpseId: number | bigint | null;
  closestInteractableAlkStationId: number | bigint | null;
  closestInteractableCairnId: number | bigint | null;
  closestInteractableMilkableAnimalId: number | bigint | null;
}

export interface GameCanvasRuntimeControllerRefs {
  worldMousePosRef: MutableRef<{ x: number | null; y: number | null }>;
  cameraOffsetRef: MutableRef<{ x: number; y: number }>;
  predictedPositionRef: MutableRef<{ x: number; y: number } | null>;
  localFacingDirectionRef: MutableRef<string | undefined>;
  localOptimisticDodgeRollStartMsRef: MutableRef<number>;
  /** Wall-clock ms when local player pressed jump; render + input merge with server like dodge roll. */
  localOptimisticJumpPressMsRef: MutableRef<number>;
  interpolatedCloudsRef: MutableRef<Map<string, any>>;
  cycleProgressRef: MutableRef<number>;
  ySortedEntitiesRef: MutableRef<any[]>;
  swimmingPlayersForBottomHalfRef: MutableRef<any[]>;
  renderGameDepsRef: MutableRef<{
    messages: Map<string, any>;
    projectiles: Map<string, SpacetimeDBProjectile>;
    holdInteractionProgress: { targetId: string | number | bigint | null; targetType: string; startTime: number } | null;
    isActivelyHolding: boolean;
    closestInteractableHarvestableResourceId: bigint | null;
    closestInteractableCampfireId: number | bigint | null;
    closestInteractableDroppedItemId: number | bigint | null;
    closestInteractableBoxId: number | bigint | null;
    isClosestInteractableBoxEmpty: boolean;
    closestInteractableWaterPosition: { x: number; y: number } | null;
    closestInteractableStashId: number | bigint | null;
    closestInteractableSleepingBagId: number | bigint | null;
    closestInteractableDoorId: number | bigint | null;
    closestInteractableTarget: any;
    unifiedInteractableTarget: any;
    closestInteractableKnockedOutPlayerId: string | null;
    closestInteractableCorpseId: number | bigint | null;
    closestInteractableAlkStationId: number | bigint | null;
    closestInteractableCairnId: number | bigint | null;
    closestInteractableMilkableAnimalId: number | bigint | null;
  }>;
}

export interface GameCanvasRuntimeControllerSnapshot
  extends Record<string, any>, GameCanvasRuntimeControllerRefs {
  worldMousePos: { x: number | null; y: number | null };
  canvasMousePos: { x: number | null; y: number | null };
  buildingState: any;
  buildingActions: any;
  hasRepairHammer: boolean;
  hasStoneTiller: boolean;
  targetedFoundation: any;
  targetedWall: any;
  targetedFence: any;
  isAutoAttacking: boolean;
  isCrouching: boolean;
  showBuildingRadialMenu: boolean;
  radialMenuMouseX: number;
  radialMenuMouseY: number;
  setShowBuildingRadialMenu: StateSetter<boolean>;
  showUpgradeRadialMenu: boolean;
  setShowUpgradeRadialMenu: StateSetter<boolean>;
  processInputsAndActions: () => void;
  upgradeMenuFoundationRef: MutableRef<any>;
  upgradeMenuWallRef: MutableRef<any>;
  upgradeMenuFenceRef: MutableRef<any>;
  cursorStyle: string;
  shouldShowDeathScreen: boolean;
  localPlayerDeathMarker: any | null;
  sleepingBagsById: Map<number, any>;
}

export interface GameCanvasRuntimeParticleSnapshot extends Record<string, any> {
  renderParticles: (ctx: CanvasRenderingContext2D, particles: any[]) => void;
  /** World-space GPU emitters for WebGL fire/smoke overlay (built each frame with nowMs). */
  computeCampfireFireOverlayEmitters: (nowMs: number) => readonly CampfireFireGpuEmitter[];
  campfireParticles: any;
  torchParticles: any;
  fireArrowParticles: any;
  furnaceParticles: any;
  barbecueParticles: any;
  firePatchParticles: any;
  wardParticles: any;
  resourceSparkleParticles: any;
  hostileDeathParticles: any;
  impactParticles: any;
  structureImpactParticles: any;
}

export interface GameCanvasRuntimeAmbientEffectsSnapshot extends Record<string, any> {
  connection: any | null;
  localPlayer: any;
  localPlayerId?: string;
  predictedPosition: { x: number; y: number } | null;
  cameraOffsetX: number;
  cameraOffsetY: number;
  canvasSize: { width: number; height: number };
  environmentalVolume: number;
  onAutoActionStatesChange?: (isAutoAttacking: boolean) => void;
  showError: (message: string) => void;
}

export class GameCanvasRuntimeHost {
  private renderContext: GameCanvasRuntimeRenderContext | null = null;
  private frameBindings: GameCanvasRuntimeFrameBindings | null = null;
  private sceneSnapshot: GameCanvasRuntimeSceneSnapshot | null = null;
  private controllerSnapshot: GameCanvasRuntimeControllerSnapshot | null = null;
  private particleSnapshot: GameCanvasRuntimeParticleSnapshot | null = null;
  private ambientEffectsSnapshot: GameCanvasRuntimeAmbientEffectsSnapshot | null = null;
  private readonly ambientEffectsRuntime = new GameCanvasAmbientEffectsRuntime();
  private readonly ambientSoundRuntime = new AmbientSoundRuntime();
  private readonly particleRuntime = new GameCanvasParticleRuntime();
  private readonly pointerRuntime = new GameCanvasPointerRuntime();
  private readonly buildingPlacementRuntime = new BuildingPlacementRuntime();
  private readonly buildTargetingRuntime = new GameCanvasBuildTargetingRuntime();
  private readonly cloudInterpolationRuntime = new CloudInterpolationRuntime();
  private readonly grassInterpolationRuntime = new GrassInterpolationRuntime();
  private readonly fallingTreeAnimationRuntime = new FallingTreeAnimationRuntime();
  private readonly projectilePresentationRuntime = new ProjectilePresentationRuntime();
  private readonly worldLookupRuntime = new WorldLookupRuntime();
  private readonly dayNightCycleRuntime = new DayNightCycleRuntime();
  private readonly entityFilteringRuntime = new EntityFilteringRuntime();
  private readonly buildTargetingRef: MutableRef<GameCanvasBuildTargetingSnapshot> = {
    current: EMPTY_GAME_CANVAS_BUILD_TARGETING_SNAPSHOT,
  };
  private readonly interactionTargetRef: MutableRef<InteractionTargetRuntimeResult> = {
    current: EMPTY_INTERACTION_TARGET_RUNTIME_RESULT,
  };
  private prevShowUpgradeRadialMenu = false;
  private readonly controllerAdjunctState: GameCanvasRuntimeControllerAdjunctState = {
    upgradeMenuFoundationRef: { current: null },
    upgradeMenuWallRef: { current: null },
    upgradeMenuFenceRef: { current: null },
    shouldShowDeathScreen: false,
    cursorStyle: 'crosshair',
    localPlayerDeathMarker: null,
    sleepingBagsById: new Map(),
  };
  private hostStateCache: {
    localPlayerIdentity: string | null;
    deathMarkers: Map<string, any> | undefined;
    localPlayerDeathMarker: any | null;
    sleepingBags: Map<string, any> | null;
    sleepingBagsById: Map<number, any>;
  } = {
    localPlayerIdentity: null,
    deathMarkers: undefined,
    localPlayerDeathMarker: null,
    sleepingBags: null,
    sleepingBagsById: new Map(),
  };
  private wasProfilerRecording = false;
  private readonly renderDiagnosticsState = {
    ySortDebugRef: {
      current: {
        lastLogTime: 0,
      },
    },
    perfProfilingRef: {
      current: {
        lastLogTime: Date.now(),
        frameCount: 0,
        totalFrameTime: 0,
        maxFrameTime: 0,
        slowFrames: 0,
        verySlowFrames: 0,
        lastServerUpdateTime: 0,
        serverUpdateCount: 0,
        maxServerLatency: 0,
        totalServerLatency: 0,
        renderCallCount: 0,
      },
    },
    fpsProfilerRef: {
      current: new FpsProfiler(),
    },
    lastFrameTimeRef: {
      current: 0,
    },
    lastKnownPlayerPosRef: {
      current: null as { x: number; y: number; timestamp: number } | null,
    },
  };
  private cameraProfilerState: {
    sampleIndex: number;
    lastSampleTime: number;
    lastPlayerX: number;
    lastPlayerY: number;
    lastCameraX: number;
    lastCameraY: number;
    lastCameraDx: number;
    lastCameraDy: number;
    lastPredictionError: number;
    lastReconciliationEventId: number;
  } | null = null;
  private readonly controllerRefsState: GameCanvasRuntimeControllerRefs = {
    worldMousePosRef: { current: { x: null, y: null } },
    cameraOffsetRef: { current: { x: 0, y: 0 } },
    predictedPositionRef: { current: null },
    localFacingDirectionRef: { current: undefined },
    localOptimisticDodgeRollStartMsRef: { current: 0 },
    localOptimisticJumpPressMsRef: { current: 0 },
    interpolatedCloudsRef: { current: new Map() },
    cycleProgressRef: { current: 0.375 },
    ySortedEntitiesRef: { current: [] },
    swimmingPlayersForBottomHalfRef: { current: [] },
    renderGameDepsRef: {
      current: {
        messages: new Map(),
        projectiles: new Map<string, SpacetimeDBProjectile>(),
        holdInteractionProgress: null,
        isActivelyHolding: false,
        closestInteractableHarvestableResourceId: null,
        closestInteractableCampfireId: null,
        closestInteractableDroppedItemId: null,
        closestInteractableBoxId: null,
        isClosestInteractableBoxEmpty: false,
        closestInteractableWaterPosition: null,
        closestInteractableStashId: null,
        closestInteractableSleepingBagId: null,
        closestInteractableDoorId: null,
        closestInteractableTarget: null,
        unifiedInteractableTarget: null,
        closestInteractableKnockedOutPlayerId: null,
        closestInteractableCorpseId: null,
        closestInteractableAlkStationId: null,
        closestInteractableCairnId: null,
        closestInteractableMilkableAnimalId: null,
      },
    },
  };

  private readonly framePipeline: RuntimeFramePipeline = {
    prepareFrame: (frameInfo: FrameInfo) => {
      const bindings = this.frameBindings;
      if (!bindings) {
        return;
      }

      bindings.deltaTimeRef.current =
        frameInfo.deltaTime > 0 && frameInfo.deltaTime < 100 ? frameInfo.deltaTime : 16.667;

      runtimeEngine.updateInputState('isAutoWalking', bindings.isAutoWalking);

      // Keep controller scans on the same pose source as rendering. We refresh
      // again immediately before render after movement simulation has advanced.
      this.refreshLiveFramePose(bindings);
      this.refreshPointerFromFrameCamera(bindings);
      this.updateSceneAnimationRuntimeServices();
      this.updateBuildingPlacementRuntimeServices(bindings);
      this.updateBuildTargetingRuntimeServices(bindings);

      this.updateParticleRuntimeServices();
      this.updateAmbientEffectsRuntimeServices();

      if (++bindings.interactionScanFrameSkipRef.current % 2 === 0) {
        this.updateInteractionTargetRuntimeServices(bindings);
      }

      const liveFacingDirection = bindings.getCurrentFacingDirectionNow?.() ?? bindings.localFacingDirectionRef.current;
      if (liveFacingDirection) {
        bindings.localFacingDirectionRef.current = liveFacingDirection;
        runtimeEngine.updateWorldState('facingDirection', liveFacingDirection);
      }
    },
    processInputs: () => {
      this.frameBindings?.processInputsAndActions();
    },
    stepSimulation: (dtMs: number) => {
      this.frameBindings?.stepPredictedMovement?.(dtMs);
    },
    renderFrame: (renderAlpha: number) => {
      this.renderFrame(renderAlpha);
    },
    getConfig: () => ({
      fixedSimulationEnabled: this.frameBindings?.fixedSimulationEnabled ?? false,
      fixedSimulationDtMs: gameConfig.fixedSimDtMs,
      maxSimulationStepsPerFrame: gameConfig.maxSimStepsPerFrame,
    }),
  };

  configureRenderContext(renderContext: GameCanvasRuntimeRenderContext): void {
    this.renderContext = renderContext;
  }

  configureRenderContextFromSnapshots(config: GameCanvasRenderRuntimeConfig): void {
    const renderContext = assembleGameCanvasRenderContext({
      ...config,
      sceneRuntime: this.sceneSnapshot,
      controllerRuntime: this.controllerSnapshot,
      effectsRuntime: this.particleSnapshot,
      buildTargetingRef: this.buildTargetingRef,
    });

    if (renderContext) {
      this.configureRenderContext(renderContext);
    }
  }

  getRenderDiagnostics({
    localPlayer,
    enabled,
  }: {
    localPlayer: { positionX: number; positionY: number } | null | undefined;
    enabled: boolean;
  }): GameCanvasRenderRuntimeConfig['diagnostics'] {
    const state = this.renderDiagnosticsState;
    if (enabled && localPlayer) {
      const now = performance.now();
      const lastKnown = state.lastKnownPlayerPosRef.current;
      if (lastKnown && (localPlayer.positionX !== lastKnown.x || localPlayer.positionY !== lastKnown.y)) {
        const timeSinceLastUpdate = now - lastKnown.timestamp;
        state.perfProfilingRef.current.serverUpdateCount++;
        state.perfProfilingRef.current.totalServerLatency += timeSinceLastUpdate;
        if (timeSinceLastUpdate > state.perfProfilingRef.current.maxServerLatency) {
          state.perfProfilingRef.current.maxServerLatency = timeSinceLastUpdate;
        }
        state.perfProfilingRef.current.lastServerUpdateTime = now;
      }

      state.lastKnownPlayerPosRef.current = {
        x: localPlayer.positionX,
        y: localPlayer.positionY,
        timestamp: now,
      };
    }

    return {
      ySortDebugRef: state.ySortDebugRef,
      perfProfilingRef: state.perfProfilingRef,
      fpsProfilerRef: state.fpsProfilerRef,
      checkPerformance: this.checkRenderPerformance,
    };
  }

  configureFrameBindings(frameBindings: GameCanvasRuntimeFrameBindings): void {
    this.frameBindings = frameBindings;
  }

  configurePointerRuntime(options: GameCanvasPointerRuntimeOptions): GameCanvasPointerSnapshot {
    const snapshot = this.pointerRuntime.configure(options);
    this.controllerRefsState.worldMousePosRef.current = snapshot.worldMousePos;
    return snapshot;
  }

  subscribeToBuildingPlacementRuntime = (listener: () => void): (() => void) => (
    this.buildingPlacementRuntime.subscribe(listener)
  );

  getBuildingPlacementRuntimeVersion = (): number => this.buildingPlacementRuntime.getVersion();

  getBuildingPlacementRuntimeSnapshot(): BuildingPlacementRuntimeSnapshot {
    return this.buildingPlacementRuntime.getSnapshot();
  }

  configureBuildingPlacementRuntime(options: BuildingPlacementRuntimeOptions): BuildingPlacementRuntimeSnapshot {
    return this.buildingPlacementRuntime.update(options, { emit: false });
  }

  configureControllerBuildRuntimeState({
    connection,
    predictedPosition,
    localPlayer,
    activeEquipments,
    itemDefinitions,
    localPlayerId,
    foundationCells,
    fences,
  }: GameCanvasControllerBuildRuntimeOptions): GameCanvasControllerBuildRuntimeState {
    const pointerSnapshot = this.getPointerSnapshot();
    const worldMousePos = pointerSnapshot.worldMousePos;
    const canvasMousePos = pointerSnapshot.canvasMousePos;
    const localPlayerX = predictedPosition?.x ?? localPlayer?.positionX ?? 0;
    const localPlayerY = predictedPosition?.y ?? localPlayer?.positionY ?? 0;
    const placementRuntime = this.configureBuildingPlacementRuntime({
      connection,
      localPlayerX,
      localPlayerY,
      activeEquipments,
      itemDefinitions,
      localPlayerId,
      worldMousePos,
      foundationCells,
      fences,
    });
    const buildTargeting = this.buildTargetingRef.current;

    return {
      worldMousePos,
      canvasMousePos,
      buildingState: placementRuntime.buildingState,
      buildingActions: placementRuntime.buildingActions,
      hasRepairHammer: placementRuntime.hasRepairHammer,
      hasStoneTiller: placementRuntime.hasStoneTiller,
      targetedFoundation: buildTargeting.targetedFoundation,
      targetTileX: buildTargeting.targetTileX,
      targetTileY: buildTargeting.targetTileY,
      targetedWall: buildTargeting.targetedWall,
      targetWallTileX: buildTargeting.targetWallTileX,
      targetWallTileY: buildTargeting.targetWallTileY,
      targetedFence: buildTargeting.targetedFence,
    };
  }

  getPointerSnapshot(): GameCanvasPointerSnapshot {
    return this.pointerRuntime.getSnapshot();
  }

  configureControllerAdjunctState({
    showUpgradeRadialMenu,
    targetedFoundation,
    targetedWall,
    targetedFence,
    localPlayer,
    connection,
    isGameMenuOpen,
    placementInfo,
    deathMarkers,
    sleepingBags,
  }: GameCanvasRuntimeControllerAdjunctOptions): GameCanvasRuntimeControllerAdjunctState {
    const state = this.controllerAdjunctState;
    const wasOpen = this.prevShowUpgradeRadialMenu;
    const isOpen = showUpgradeRadialMenu;

    if (!wasOpen && isOpen) {
      if (targetedWall) {
        state.upgradeMenuWallRef.current = targetedWall;
        state.upgradeMenuFoundationRef.current = null;
        state.upgradeMenuFenceRef.current = null;
      } else if (targetedFence) {
        state.upgradeMenuFenceRef.current = targetedFence;
        state.upgradeMenuFoundationRef.current = null;
        state.upgradeMenuWallRef.current = null;
      } else if (targetedFoundation) {
        state.upgradeMenuFoundationRef.current = targetedFoundation;
        state.upgradeMenuWallRef.current = null;
        state.upgradeMenuFenceRef.current = null;
      }
    } else if (!isOpen) {
      state.upgradeMenuFoundationRef.current = null;
      state.upgradeMenuWallRef.current = null;
      state.upgradeMenuFenceRef.current = null;
    }

    this.prevShowUpgradeRadialMenu = isOpen;
    state.shouldShowDeathScreen = !!(localPlayer?.isDead && connection);
    state.cursorStyle = isGameMenuOpen ? 'default' : (placementInfo ? 'cell' : 'crosshair');

    const localPlayerIdentity = localPlayer?.identity?.toHexString?.() ?? null;
    if (
      this.hostStateCache.localPlayerIdentity !== localPlayerIdentity
      || this.hostStateCache.deathMarkers !== deathMarkers
    ) {
      this.hostStateCache.localPlayerIdentity = localPlayerIdentity;
      this.hostStateCache.deathMarkers = deathMarkers;
      this.hostStateCache.localPlayerDeathMarker =
        localPlayerIdentity && deathMarkers ? deathMarkers.get(localPlayerIdentity) || null : null;
    }

    if (this.hostStateCache.sleepingBags !== sleepingBags) {
      const mapById = new Map<number, any>();
      sleepingBags.forEach((bag) => {
        mapById.set(bag.id, bag);
      });
      this.hostStateCache.sleepingBags = sleepingBags;
      this.hostStateCache.sleepingBagsById = mapById;
    }

    state.localPlayerDeathMarker = this.hostStateCache.localPlayerDeathMarker;
    state.sleepingBagsById = this.hostStateCache.sleepingBagsById;

    return state;
  }

  configureControllerFrameRuntimeState({
    worldMousePos,
    cameraOffsetX,
    cameraOffsetY,
    predictedPosition,
    localFacingDirection,
    interpolatedClouds,
    cycleProgress,
    ySortedEntities,
    swimmingPlayersForBottomHalf,
    messages,
    renderableProjectiles,
    holdInteractionProgress,
    isActivelyHolding,
    closestInteractableHarvestableResourceId,
    closestInteractableCampfireId,
    closestInteractableDroppedItemId,
    closestInteractableBoxId,
    isClosestInteractableBoxEmpty,
    closestInteractableWaterPosition,
    closestInteractableStashId,
    closestInteractableSleepingBagId,
    closestInteractableDoorId,
    closestInteractableTarget,
    unifiedInteractableTarget,
    closestInteractableKnockedOutPlayerId,
    closestInteractableCorpseId,
    closestInteractableAlkStationId,
    closestInteractableCairnId,
    closestInteractableMilkableAnimalId,
  }: GameCanvasRuntimeFrameStateOptions): Pick<GameCanvasRuntimeControllerRefs, 'renderGameDepsRef'> {
    const refs = this.controllerRefsState;
    refs.worldMousePosRef.current = this.getLiveWorldMousePosition(worldMousePos);
    refs.cameraOffsetRef.current = { x: cameraOffsetX, y: cameraOffsetY };
    refs.predictedPositionRef.current = predictedPosition;
    refs.localFacingDirectionRef.current = localFacingDirection;
    refs.interpolatedCloudsRef.current = interpolatedClouds;
    refs.cycleProgressRef.current = cycleProgress;
    refs.ySortedEntitiesRef.current = ySortedEntities;
    refs.swimmingPlayersForBottomHalfRef.current = swimmingPlayersForBottomHalf;

    const renderDeps = refs.renderGameDepsRef.current;
    renderDeps.messages = messages;
    renderDeps.projectiles = renderableProjectiles;
    renderDeps.holdInteractionProgress = holdInteractionProgress;
    renderDeps.isActivelyHolding = isActivelyHolding;
    renderDeps.closestInteractableHarvestableResourceId = closestInteractableHarvestableResourceId;
    renderDeps.closestInteractableCampfireId = closestInteractableCampfireId;
    renderDeps.closestInteractableDroppedItemId = closestInteractableDroppedItemId;
    renderDeps.closestInteractableBoxId = closestInteractableBoxId;
    renderDeps.isClosestInteractableBoxEmpty = isClosestInteractableBoxEmpty;
    renderDeps.closestInteractableWaterPosition = closestInteractableWaterPosition;
    renderDeps.closestInteractableStashId = closestInteractableStashId;
    renderDeps.closestInteractableSleepingBagId = closestInteractableSleepingBagId;
    renderDeps.closestInteractableDoorId = closestInteractableDoorId;
    renderDeps.closestInteractableTarget = closestInteractableTarget;
    renderDeps.unifiedInteractableTarget = unifiedInteractableTarget;
    renderDeps.closestInteractableKnockedOutPlayerId = closestInteractableKnockedOutPlayerId;
    renderDeps.closestInteractableCorpseId = closestInteractableCorpseId;
    renderDeps.closestInteractableAlkStationId = closestInteractableAlkStationId;
    renderDeps.closestInteractableCairnId = closestInteractableCairnId;
    renderDeps.closestInteractableMilkableAnimalId = closestInteractableMilkableAnimalId;

    return { renderGameDepsRef: refs.renderGameDepsRef };
  }

  configureFrameBindingsFromController({
    controllerSnapshot,
    stepPredictedMovement,
    fixedSimulationEnabled,
    getCurrentPositionNow,
    getReconciliationProfilerSnapshot,
    getCurrentFacingDirectionNow,
    localPlayer,
    connection,
    isAutoWalking,
    canvasSize,
    gameLoopMetricsRef,
    deltaTimeRef,
    interactionScanFrameSkipRef,
  }: GameCanvasRuntimeFrameBindingControllerOptions): void {
    this.configureFrameBindings({
      processInputsAndActions: controllerSnapshot.processInputsAndActions,
      stepPredictedMovement,
      fixedSimulationEnabled,
      connection,
      getCurrentPositionNow,
      getReconciliationProfilerSnapshot,
      predictedPositionRef: controllerSnapshot.predictedPositionRef,
      getCurrentFacingDirectionNow,
      localFacingDirectionRef: controllerSnapshot.localFacingDirectionRef,
      localPlayer,
      isAutoWalking,
      canvasWidth: canvasSize.width,
      canvasHeight: canvasSize.height,
      gameLoopMetricsRef,
      deltaTimeRef,
      interactionScanFrameSkipRef,
      cameraOffsetRef: controllerSnapshot.cameraOffsetRef,
    });
  }

  getFrameBindings(): GameCanvasRuntimeFrameBindings | null {
    return this.frameBindings;
  }

  configureSceneSnapshot(sceneSnapshot: GameCanvasRuntimeSceneSnapshot): void {
    this.sceneSnapshot = sceneSnapshot;
  }

  configureSceneInterpolationRuntime({
    clouds,
    grass,
    grassState,
  }: GameCanvasSceneInterpolationRuntimeOptions): GameCanvasSceneInterpolationRuntimeSnapshot {
    const interpolatedClouds = this.cloudInterpolationRuntime.update({ serverClouds: clouds });
    const interpolatedGrass = this.grassInterpolationRuntime.update({
      serverGrass: grass,
      serverGrassState: grassState,
    });

    this.controllerRefsState.interpolatedCloudsRef.current = interpolatedClouds;

    return {
      interpolatedClouds,
      interpolatedGrass,
    };
  }

  configureFallingTreeAnimationRuntime(trees: Map<string, SpacetimeDBTree>): FallingTreeAnimationRuntimeSnapshot {
    return this.fallingTreeAnimationRuntime.update(trees);
  }

  configureProjectilePresentationRuntime({
    connection,
    authoritativeProjectiles,
  }: GameCanvasProjectilePresentationRuntimeOptions): Map<string, SpacetimeDBProjectile> {
    const renderableProjectiles = this.projectilePresentationRuntime.update({
      connection,
      authoritativeProjectiles,
      optimisticProjectiles: this.getOptimisticProjectiles(),
    });
    this.applyRenderableProjectiles(renderableProjectiles);
    return renderableProjectiles;
  }

  configureWorldLookupRuntime(options: WorldLookupRuntimeOptions): WorldLookupRuntimeSnapshot {
    return this.worldLookupRuntime.update(options);
  }

  configureDayNightCycleRuntime(options: DayNightCycleRuntimeOptions): DayNightCycleRuntimeSnapshot {
    return this.dayNightCycleRuntime.update(options);
  }

  configureEntityFilteringRuntime(...args: Parameters<EntityFilteringRuntime['update']>): EntityFilteringResult {
    return this.entityFilteringRuntime.update(...args);
  }

  configureFrameAssemblyRuntime(options: GameCanvasFrameAssemblyRuntimeOptions): Record<string, any> {
    const remotePlayerInterpolation = remotePlayerInterpolationRuntime;

    const filtering = this.configureEntityFilteringRuntime(
      options.players,
      options.trees,
      options.stones,
      options.runeStones,
      options.cairns,
      options.campfires,
      options.furnaces,
      options.barbecues,
      options.lanterns,
      options.turrets,
      options.homesteadHearths,
      options.harvestableResources,
      options.droppedItems,
      options.woodenStorageBoxes,
      options.sleepingBags,
      options.playerCorpses,
      options.stashes,
      options.cameraOffsetX,
      options.cameraOffsetY,
      options.canvasWidth,
      options.canvasHeight,
      options.interpolatedGrass,
      options.projectiles,
      options.shelters,
      options.clouds,
      options.plantedSeeds,
      options.rainCollectors,
      options.brothPots,
      options.wildAnimals,
      options.animalCorpses,
      options.barrels,
      options.roadLampposts,
      options.fumaroles,
      options.basaltColumns,
      options.seaStacks,
      options.foundationCells,
      options.wallCells,
      options.doors,
      options.fences,
      options.localPlayerId,
      options.isLocalPlayerSnorkeling,
      options.predictedPosition ? { x: options.predictedPosition.x, y: options.predictedPosition.y } : null,
      options.isTreeFalling,
      options.worldChunkDataMap ?? undefined,
      options.alkStations,
      options.monumentParts,
      options.livingCorals,
      options.seaTransitionTileLookup,
      options.waterTileLookup,
    );

    const { overlayRgba, maskCanvasRef, redrawMask } = this.configureDayNightCycleRuntime({
      worldState: options.worldState,
      droppedItems: filtering.visibleDroppedItemsMap,
      campfires: options.campfires,
      lanterns: options.lanterns,
      furnaces: options.furnaces,
      barbecues: options.barbecues,
      roadLampposts: options.roadLamppostsAll,
      barrels: options.barrelsAll,
      runeStones: options.runeStones,
      firePatches: options.firePatches,
      fumaroles: options.fumaroles,
      monumentParts: options.monumentParts,
      players: options.players,
      activeEquipments: options.activeEquipments,
      itemDefinitions: options.itemDefinitions,
      cameraOffsetX: options.cameraOffsetX,
      cameraOffsetY: options.cameraOffsetY,
      canvasSize: { width: options.canvasWidth, height: options.canvasHeight },
      localPlayerId: options.localPlayerId,
      predictedPosition: options.predictedPosition ? { x: options.predictedPosition.x, y: options.predictedPosition.y } : null,
      remotePlayerInterpolation,
      buildingClusters: filtering.buildingClusters,
      worldMouseX: options.worldMouseX,
      worldMouseY: options.worldMouseY,
    });

    const renderableProjectiles = this.configureProjectilePresentationRuntime({
      connection: options.connection,
      authoritativeProjectiles: options.projectiles,
    });

    const corpseSourceAnimalIds = new Set<string>();
    filtering.visibleAnimalCorpsesMap.forEach((corpse: any) => {
      corpseSourceAnimalIds.add(corpse.animalId.toString());
    });

    const withoutReplacedAnimals =
      corpseSourceAnimalIds.size === 0
        ? filtering.ySortedEntities
        : filtering.ySortedEntities.filter((entity: any) => {
            if (entity.type !== 'wild_animal') return true;
            return !corpseSourceAnimalIds.has(entity.entity.id.toString());
          });

    const finalizedYSortedEntities = withoutReplacedAnimals.filter((entity: any) => entity.type !== 'projectile');
    renderableProjectiles.forEach((projectile) => {
      finalizedYSortedEntities.push({ type: 'projectile', entity: projectile } as any);
    });

    return {
      ...filtering,
      ySortedEntities: finalizedYSortedEntities,
      overlayRgba,
      maskCanvasRef,
      redrawMask,
      renderableProjectiles,
      remotePlayerInterpolation,
    };
  }

  getControllerRefs(): GameCanvasRuntimeControllerRefs {
    return this.controllerRefsState;
  }

  getBuildTargetingRef(): MutableRef<GameCanvasBuildTargetingSnapshot> {
    return this.buildTargetingRef;
  }

  getInteractionTargetRef(): MutableRef<InteractionTargetRuntimeResult> {
    return this.interactionTargetRef;
  }

  getSceneSnapshot(): GameCanvasRuntimeSceneSnapshot | null {
    return this.sceneSnapshot;
  }

  configureControllerSnapshot(controllerSnapshot: GameCanvasRuntimeControllerSnapshot): void {
    this.controllerSnapshot = controllerSnapshot;
  }

  getControllerSnapshot(): GameCanvasRuntimeControllerSnapshot | null {
    return this.controllerSnapshot;
  }

  configureParticleSnapshot(particleSnapshot: GameCanvasRuntimeParticleSnapshot): void {
    this.particleSnapshot = particleSnapshot;
  }

  configureParticleRuntime(options: GameCanvasParticleRuntimeOptions): GameCanvasRuntimeParticleSnapshot {
    this.particleSnapshot = this.particleRuntime.configure(options);
    return this.particleSnapshot;
  }

  updateParticleRuntimeServices(): void {
    this.particleRuntime.update();
  }

  getParticleSnapshot(): GameCanvasRuntimeParticleSnapshot | null {
    return this.particleSnapshot;
  }

  configureAmbientEffectsSnapshot(ambientEffectsSnapshot: GameCanvasRuntimeAmbientEffectsSnapshot): void {
    this.ambientEffectsSnapshot = ambientEffectsSnapshot;
  }

  getAmbientEffectsSnapshot(): GameCanvasRuntimeAmbientEffectsSnapshot | null {
    return this.ambientEffectsSnapshot;
  }

  updateAmbientEffectsRuntimeServices(): void {
    const ambientEffectsSnapshot = this.ambientEffectsSnapshot;
    const sceneSnapshot = this.sceneSnapshot;
    const controllerSnapshot = this.controllerSnapshot;

    this.ambientEffectsRuntime.update({
      connection: ambientEffectsSnapshot?.connection ?? null,
      localPlayer: ambientEffectsSnapshot?.localPlayer ?? null,
      predictedPosition: ambientEffectsSnapshot?.predictedPosition ?? null,
      worldMousePos: this.controllerRefsState.worldMousePosRef.current ?? controllerSnapshot?.worldMousePos ?? EMPTY_WORLD_MOUSE_POS,
      localPlayerId: ambientEffectsSnapshot?.localPlayerId,
      activeConsumableEffects: sceneSnapshot?.activeConsumableEffects ?? EMPTY_RUNTIME_MAP,
      isAutoAttacking: controllerSnapshot?.isAutoAttacking ?? false,
      onAutoActionStatesChange: ambientEffectsSnapshot?.onAutoActionStatesChange,
      showError: ambientEffectsSnapshot?.showError ?? NOOP_SHOW_ERROR,
      cameraX: ambientEffectsSnapshot?.cameraOffsetX ?? 0,
      cameraY: ambientEffectsSnapshot?.cameraOffsetY ?? 0,
      canvasWidth: ambientEffectsSnapshot?.canvasSize.width ?? 0,
      canvasHeight: ambientEffectsSnapshot?.canvasSize.height ?? 0,
      chunkWeather: sceneSnapshot?.chunkWeather ?? EMPTY_RUNTIME_MAP,
    });

    this.ambientSoundRuntime.update({
      masterVolume: 1.0,
      environmentalVolume: ambientEffectsSnapshot?.environmentalVolume ?? 0.7,
      timeOfDay: sceneSnapshot?.worldState?.timeOfDay,
      weatherCondition: sceneSnapshot?.worldState?.currentWeather,
      chunkWeather: sceneSnapshot?.chunkWeather ?? EMPTY_RUNTIME_MAP,
      localPlayer: ambientEffectsSnapshot?.localPlayer ?? null,
      activeConsumableEffects: sceneSnapshot?.activeConsumableEffects ?? EMPTY_RUNTIME_MAP,
      localPlayerId: ambientEffectsSnapshot?.localPlayerId,
      isUnderwater: ambientEffectsSnapshot?.localPlayer?.isSnorkeling ?? false,
      currentSeason: sceneSnapshot?.worldState?.currentSeason,
      isIndoors: ambientEffectsSnapshot?.localPlayer?.isInsideBuilding ?? false,
      distanceToShore: sceneSnapshot?.distanceToShore ?? 0,
      distanceToMapEdge: sceneSnapshot?.distanceToMapEdge ?? Infinity,
      wildAnimals: sceneSnapshot?.visibleWildAnimalsMap ?? EMPTY_RUNTIME_MAP,
    });
  }

  updateSceneAnimationRuntimeServices(): void {
    const sceneSnapshot = this.sceneSnapshot;
    if (!sceneSnapshot) {
      return;
    }

    const interpolated = this.configureSceneInterpolationRuntime({
      clouds: sceneSnapshot.clouds ?? EMPTY_RUNTIME_MAP,
      grass: sceneSnapshot.grass ?? EMPTY_RUNTIME_MAP,
      grassState: sceneSnapshot.grassState ?? EMPTY_RUNTIME_MAP,
    });

    sceneSnapshot.interpolatedClouds = interpolated.interpolatedClouds;
    sceneSnapshot.interpolatedGrass = interpolated.interpolatedGrass;

    const fallingTrees = this.fallingTreeAnimationRuntime.update(sceneSnapshot.trees ?? EMPTY_RUNTIME_MAP);
    sceneSnapshot.isTreeFalling = fallingTrees.isTreeFalling;
    sceneSnapshot.getFallProgress = fallingTrees.getFallProgress;
    sceneSnapshot.TREE_FALL_DURATION_MS = fallingTrees.TREE_FALL_DURATION_MS;

    this.configureProjectilePresentationRuntime({
      connection: this.frameBindings?.connection ?? null,
      authoritativeProjectiles: sceneSnapshot.projectiles ?? EMPTY_RUNTIME_MAP,
    });
  }

  stopSceneAnimationRuntimeServices(): void {
    this.cloudInterpolationRuntime.stop();
    this.grassInterpolationRuntime.stop();
    this.fallingTreeAnimationRuntime.stop();
    this.projectilePresentationRuntime.stop();
    this.worldLookupRuntime.stop();
    this.dayNightCycleRuntime.stop();
    this.controllerRefsState.interpolatedCloudsRef.current = new Map();
  }

  updateBuildingPlacementRuntimeServices(bindings: GameCanvasRuntimeFrameBindings | null = this.frameBindings): void {
    const sceneSnapshot = this.sceneSnapshot;
    if (!bindings || !sceneSnapshot) {
      this.buildingPlacementRuntime.update({
        connection: null,
        localPlayerX: 0,
        localPlayerY: 0,
        worldMousePos: this.controllerRefsState.worldMousePosRef.current,
      });
      return;
    }

    const predictedPosition = bindings.predictedPositionRef.current;
    const localPlayerX = predictedPosition?.x ?? bindings.localPlayer?.positionX ?? 0;
    const localPlayerY = predictedPosition?.y ?? bindings.localPlayer?.positionY ?? 0;
    const localPlayerId = bindings.localPlayer?.identity?.toHexString?.();

    this.buildingPlacementRuntime.update({
      connection: bindings.connection,
      localPlayerX,
      localPlayerY,
      activeEquipments: sceneSnapshot.activeEquipments,
      itemDefinitions: sceneSnapshot.itemDefinitions,
      localPlayerId,
      worldMousePos: this.controllerRefsState.worldMousePosRef.current,
      foundationCells: sceneSnapshot.foundationCells,
      fences: sceneSnapshot.fences,
    });
  }

  updateBuildTargetingRuntimeServices(bindings: GameCanvasRuntimeFrameBindings | null = this.frameBindings): void {
    if (!bindings || !this.sceneSnapshot) {
      this.buildTargetingRef.current = EMPTY_GAME_CANVAS_BUILD_TARGETING_SNAPSHOT;
      return;
    }

    const predictedPosition = bindings.predictedPositionRef.current;
    const localPlayerX = predictedPosition?.x ?? bindings.localPlayer?.positionX ?? 0;
    const localPlayerY = predictedPosition?.y ?? bindings.localPlayer?.positionY ?? 0;
    this.buildTargetingRef.current = this.buildTargetingRuntime.update({
      foundationCells: this.sceneSnapshot.foundationCells,
      wallCells: this.sceneSnapshot.wallCells,
      fences: this.sceneSnapshot.fences,
      worldMousePos: this.controllerRefsState.worldMousePosRef.current,
      localPlayerX,
      localPlayerY,
      hasRepairHammer: this.buildingPlacementRuntime.getSnapshot().hasRepairHammer
        || this.controllerSnapshot?.hasRepairHammer
        || false,
    });
  }

  updateInteractionTargetRuntimeServices(bindings: GameCanvasRuntimeFrameBindings | null = this.frameBindings): void {
    const sceneSnapshot = this.sceneSnapshot;
    if (!bindings || !sceneSnapshot || !bindings.localPlayer) {
      this.interactionTargetRef.current = EMPTY_INTERACTION_TARGET_RUNTIME_RESULT;
      this.applyInteractionTargetRuntimeResult(EMPTY_INTERACTION_TARGET_RUNTIME_RESULT);
      return;
    }

    const result = calculateInteractionTargetRuntimeResult({
      localPlayer: bindings.localPlayer,
      playerPositionOverride: bindings.getCurrentPositionNow?.() ?? bindings.predictedPositionRef.current,
      getCurrentPlayerPosition: bindings.getCurrentPositionNow,
      campfires: sceneSnapshot.campfires ?? EMPTY_RUNTIME_MAP,
      furnaces: sceneSnapshot.furnaces ?? EMPTY_RUNTIME_MAP,
      barbecues: sceneSnapshot.barbecues ?? EMPTY_RUNTIME_MAP,
      fumaroles: sceneSnapshot.fumaroles ?? EMPTY_RUNTIME_MAP,
      lanterns: sceneSnapshot.lanterns ?? EMPTY_RUNTIME_MAP,
      turrets: sceneSnapshot.visibleTurretsMap ?? EMPTY_RUNTIME_MAP,
      homesteadHearths: sceneSnapshot.homesteadHearths ?? EMPTY_RUNTIME_MAP,
      droppedItems: sceneSnapshot.droppedItems ?? EMPTY_RUNTIME_MAP,
      woodenStorageBoxes: sceneSnapshot.woodenStorageBoxes ?? EMPTY_RUNTIME_MAP,
      playerCorpses: sceneSnapshot.playerCorpses ?? EMPTY_RUNTIME_MAP,
      stashes: sceneSnapshot.stashes ?? EMPTY_RUNTIME_MAP,
      rainCollectors: sceneSnapshot.rainCollectors ?? EMPTY_RUNTIME_MAP,
      brothPots: sceneSnapshot.brothPots ?? EMPTY_RUNTIME_MAP,
      doors: sceneSnapshot.doors ?? EMPTY_RUNTIME_MAP,
      alkStations: sceneSnapshot.visibleAlkStationsMap ?? EMPTY_RUNTIME_MAP,
      cairns: EMPTY_RUNTIME_MAP,
      sleepingBags: sceneSnapshot.sleepingBags ?? EMPTY_RUNTIME_MAP,
      players: sceneSnapshot.players ?? EMPTY_RUNTIME_MAP,
      shelters: sceneSnapshot.shelters ?? EMPTY_RUNTIME_MAP,
      harvestableResources: sceneSnapshot.harvestableResources ?? EMPTY_RUNTIME_MAP,
      inventoryItems: sceneSnapshot.inventoryItems ?? EMPTY_RUNTIME_MAP,
      itemDefinitions: sceneSnapshot.itemDefinitions ?? EMPTY_RUNTIME_MAP,
      connection: bindings.connection,
      playerDrinkingCooldowns: sceneSnapshot.playerDrinkingCooldowns ?? EMPTY_RUNTIME_MAP,
      worldTiles: sceneSnapshot.visibleWorldTiles ?? EMPTY_RUNTIME_MAP,
      wildAnimals: sceneSnapshot.wildAnimals ?? EMPTY_RUNTIME_MAP,
      caribouBreedingData: sceneSnapshot.caribouBreedingData ?? EMPTY_RUNTIME_MAP,
      walrusBreedingData: sceneSnapshot.walrusBreedingData ?? EMPTY_RUNTIME_MAP,
      worldState: sceneSnapshot.worldState,
    });

    this.interactionTargetRef.current = result;
    this.applyInteractionTargetRuntimeResult(result);
  }

  private applyInteractionTargetRuntimeResult(result: InteractionTargetRuntimeResult): void {
    const renderDeps = this.controllerRefsState.renderGameDepsRef.current;
    const unifiedInteractableTarget = result.closestInteractableTarget
      ?? (result.closestInteractableWaterPosition
        ? {
            type: 'water',
            id: 'water',
            position: {
              x: result.closestInteractableWaterPosition.x,
              y: result.closestInteractableWaterPosition.y,
            },
            distance: 0,
            data: undefined,
          }
        : null);

    renderDeps.closestInteractableHarvestableResourceId = result.closestInteractableHarvestableResourceId;
    renderDeps.closestInteractableCampfireId = result.closestInteractableCampfireId;
    renderDeps.closestInteractableDroppedItemId = result.closestInteractableDroppedItemId;
    renderDeps.closestInteractableBoxId = result.closestInteractableBoxId;
    renderDeps.isClosestInteractableBoxEmpty = result.isClosestInteractableBoxEmpty;
    renderDeps.closestInteractableWaterPosition = result.closestInteractableWaterPosition;
    renderDeps.closestInteractableStashId = result.closestInteractableStashId;
    renderDeps.closestInteractableSleepingBagId = result.closestInteractableSleepingBagId;
    renderDeps.closestInteractableDoorId = result.closestInteractableDoorId;
    renderDeps.closestInteractableTarget = result.closestInteractableTarget;
    renderDeps.unifiedInteractableTarget = unifiedInteractableTarget;
    renderDeps.closestInteractableKnockedOutPlayerId = result.closestInteractableKnockedOutPlayerId;
    renderDeps.closestInteractableCorpseId = result.closestInteractableCorpseId;
    renderDeps.closestInteractableAlkStationId = result.closestInteractableAlkStationId;
    renderDeps.closestInteractableCairnId = result.closestInteractableCairnId;
    renderDeps.closestInteractableMilkableAnimalId = result.closestInteractableMilkableAnimalId;
  }

  private getOptimisticProjectiles(): Map<string, SpacetimeDBProjectile> {
    return (runtimeEngine.getSnapshot().input.optimisticProjectiles as Map<string, SpacetimeDBProjectile> | undefined)
      ?? new Map<string, SpacetimeDBProjectile>();
  }

  private applyRenderableProjectiles(renderableProjectiles: Map<string, SpacetimeDBProjectile>): void {
    const sceneSnapshot = this.sceneSnapshot;
    const refs = this.controllerRefsState;

    refs.renderGameDepsRef.current.projectiles = renderableProjectiles;

    if (!sceneSnapshot) {
      return;
    }

    sceneSnapshot.renderableProjectiles = renderableProjectiles;

    const sourceYSortedEntities = sceneSnapshot.resolvedYSortedEntities ?? sceneSnapshot.ySortedEntities;
    if (!Array.isArray(sourceYSortedEntities)) {
      return;
    }

    const finalizedYSortedEntities = sourceYSortedEntities.filter((entity: unknown) => {
      return (entity as { type?: string } | null | undefined)?.type !== 'projectile';
    });
    renderableProjectiles.forEach((projectile) => {
      finalizedYSortedEntities.push({ type: 'projectile', entity: projectile });
    });

    sceneSnapshot.ySortedEntities = finalizedYSortedEntities;
    sceneSnapshot.resolvedYSortedEntities = finalizedYSortedEntities;
    refs.ySortedEntitiesRef.current = finalizedYSortedEntities;
  }

  stopAmbientEffectsRuntimeServices(): void {
    this.ambientEffectsRuntime.stop();
    this.ambientSoundRuntime.stop();
  }

  stopParticleRuntimeServices(): void {
    this.particleRuntime.stop();
  }

  stopPointerRuntimeServices(): void {
    this.pointerRuntime.stop();
    this.controllerRefsState.worldMousePosRef.current = EMPTY_WORLD_MOUSE_POS;
  }

  stopBuildingPlacementRuntimeServices(): void {
    this.buildingPlacementRuntime.stop();
  }

  mount(): void {
    retainAnimationCycleLoop();
    runtimeEngine.setFramePipeline(this.framePipeline);
  }

  unmount(): void {
    this.stopAmbientEffectsRuntimeServices();
    this.stopParticleRuntimeServices();
    this.stopPointerRuntimeServices();
    this.stopBuildingPlacementRuntimeServices();
    this.stopSceneAnimationRuntimeServices();
    releaseAnimationCycleLoop();
    runtimeEngine.setFramePipeline(null);
  }

  renderFrame(renderAlpha: number = 1): void {
    if (!this.renderContext) {
      return;
    }

    if (this.frameBindings) {
      this.refreshLiveFramePose(this.frameBindings);
      this.refreshPointerFromFrameCamera(this.frameBindings);
      this.updateSceneAnimationRuntimeServices();
      this.updateBuildingPlacementRuntimeServices(this.frameBindings);
      this.updateBuildTargetingRuntimeServices(this.frameBindings);
      this.recordCameraProfilerSample(this.frameBindings);
    }

    renderGameCanvasFrame({
      ...this.renderContext,
      renderAlpha,
    });
  }

  private readonly checkRenderPerformance = (frameStartTime: number): void => {
    this.renderDiagnosticsState.lastFrameTimeRef.current = performance.now() - frameStartTime;
  };

  private refreshLiveFramePose(bindings: GameCanvasRuntimeFrameBindings): void {
    const livePredictedPosition = bindings.getCurrentPositionNow?.() ?? bindings.predictedPositionRef.current;
    if (livePredictedPosition) {
      bindings.predictedPositionRef.current = livePredictedPosition;
      bindings.cameraOffsetRef.current = {
        x: (bindings.canvasWidth / 2) - livePredictedPosition.x,
        y: (bindings.canvasHeight / 2) - livePredictedPosition.y,
      };
      return;
    }

    if (bindings.localPlayer) {
      bindings.cameraOffsetRef.current = {
        x: (bindings.canvasWidth / 2) - bindings.localPlayer.positionX,
        y: (bindings.canvasHeight / 2) - bindings.localPlayer.positionY,
      };
    }
  }

  private refreshPointerFromFrameCamera(bindings: GameCanvasRuntimeFrameBindings): void {
    const cameraOffset = bindings.cameraOffsetRef.current;
    this.pointerRuntime.refreshWorldPosition(cameraOffset.x, cameraOffset.y);
    this.controllerRefsState.worldMousePosRef.current = this.pointerRuntime.getSnapshot().worldMousePos;
  }

  private getLiveWorldMousePosition(fallback: { x: number | null; y: number | null }): { x: number | null; y: number | null } {
    const pointerWorldMousePos = this.pointerRuntime.getSnapshot().worldMousePos;
    return pointerWorldMousePos.x !== null && pointerWorldMousePos.y !== null
      ? pointerWorldMousePos
      : fallback;
  }

  private recordCameraProfilerSample(bindings: GameCanvasRuntimeFrameBindings): void {
    const recording = isProfilerRecording();
    if (!recording) {
      this.wasProfilerRecording = false;
      this.cameraProfilerState = null;
      return;
    }
    if (!this.wasProfilerRecording) {
      this.wasProfilerRecording = true;
      this.cameraProfilerState = null;
    }

    const predictedPosition = bindings.predictedPositionRef.current;
    const localPlayer = bindings.localPlayer;
    if (!predictedPosition || !localPlayer) {
      this.cameraProfilerState = null;
      return;
    }

    const now = performance.now();
    const camera = bindings.cameraOffsetRef.current;
    const previous = this.cameraProfilerState;
    const playerDx = previous ? predictedPosition.x - previous.lastPlayerX : 0;
    const playerDy = previous ? predictedPosition.y - previous.lastPlayerY : 0;
    const cameraDx = previous ? camera.x - previous.lastCameraX : 0;
    const cameraDy = previous ? camera.y - previous.lastCameraY : 0;
    const predictionErrorX = predictedPosition.x - localPlayer.positionX;
    const predictionErrorY = predictedPosition.y - localPlayer.positionY;
    const predictionError = Math.hypot(predictionErrorX, predictionErrorY);
    const reconciliation = bindings.getReconciliationProfilerSnapshot?.() ?? null;
    const reconciliationChanged = reconciliation != null
      && reconciliation.eventId !== (previous?.lastReconciliationEventId ?? 0);

    addCameraSample({
      sampleIndex: previous ? previous.sampleIndex + 1 : 0,
      dtMs: bindings.deltaTimeRef.current,
      frameGapMs: previous ? now - previous.lastSampleTime : 0,
      playerX: predictedPosition.x,
      playerY: predictedPosition.y,
      playerDx,
      playerDy,
      playerDist: Math.hypot(playerDx, playerDy),
      cameraX: camera.x,
      cameraY: camera.y,
      cameraDx,
      cameraDy,
      cameraDist: Math.hypot(cameraDx, cameraDy),
      cameraJerk: previous ? Math.hypot(cameraDx - previous.lastCameraDx, cameraDy - previous.lastCameraDy) : 0,
      serverX: localPlayer.positionX,
      serverY: localPlayer.positionY,
      predictedMinusServerX: predictionErrorX,
      predictedMinusServerY: predictionErrorY,
      predictedMinusServerDist: predictionError,
      correctionDelta: previous ? Math.abs(predictionError - previous.lastPredictionError) : 0,
      reconciliationChanged: reconciliationChanged ? 1 : 0,
      reconciliationEventType: reconciliation?.eventType ?? 'none',
      reconciliationEventAgeMs: reconciliation?.eventAgeMs ?? -1,
      reconciliationErrorDist: reconciliation?.errorDist ?? 0,
      reconciliationSequenceAdvance: reconciliation?.sequenceAdvance ?? 0,
      tileX: Math.floor(predictedPosition.x / gameConfig.tileSize),
      tileY: Math.floor(predictedPosition.y / gameConfig.tileSize),
    });

    this.cameraProfilerState = {
      sampleIndex: previous ? previous.sampleIndex + 1 : 0,
      lastSampleTime: now,
      lastPlayerX: predictedPosition.x,
      lastPlayerY: predictedPosition.y,
      lastCameraX: camera.x,
      lastCameraY: camera.y,
      lastCameraDx: cameraDx,
      lastCameraDy: cameraDy,
      lastPredictionError: predictionError,
      lastReconciliationEventId: reconciliation?.eventId ?? 0,
    };
  }
}
