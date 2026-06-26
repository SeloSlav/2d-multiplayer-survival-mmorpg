import { gameConfig } from '../../config/gameConfig';
import type {
  GameCanvasRuntimeControllerSnapshot,
  GameCanvasRuntimeParticleSnapshot,
  GameCanvasRuntimeRenderContext,
  GameCanvasRuntimeSceneSnapshot,
} from './GameCanvasRuntimeHost';
import type { MutableRef } from '../types';
import type { GameCanvasBuildTargetingSnapshot } from './gameCanvasBuildTargetingRuntime';

const EMPTY_MAP = new Map();

export interface GameCanvasRenderRuntimeConfig {
  localPlayerId?: string;
  localPlayer: any;
  predictedPosition: { x: number; y: number } | null;
  connection: any | null;
  gameCanvasRef: any;
  canvasSize: { width: number; height: number };
  placementInfo: any;
  placementError: string | null;
  placementActions: any;
  setPlacementWarning: (warning: string | null) => void;
  showFpsProfiler: boolean;
  isProfilerRecording: boolean;
  showAutotileDebug: boolean;
  showChunkBoundaries: boolean;
  showInteriorDebug: boolean;
  showCollisionDebug: boolean;
  showAttackRangeDebug: boolean;
  showYSortDebug: boolean;
  showShipwreckDebug: boolean;
  allShadowsEnabled: boolean;
  alwaysShowPlayerNames: boolean;
  waterSurfaceEffectsEnabled: boolean;
  footprintsEnabled: boolean;
  grassAnimationEnabled: boolean;
  worldParticlesQuality: number;
  cloudsEnabled: boolean;
  showPrecipitation: boolean;
  stormAtmosphereEnabled: boolean;
  showStatusOverlays: boolean;
  isSearchingCraftRecipes: boolean;
  showInventory: boolean;
  isMobile: boolean;
  tapAnimation: any;
  localPlayerIsCrouching: boolean;
  isAutoAttacking: boolean;
  isAutoWalking: boolean;
  hoveredPlayerIds: Set<string>;
  handlePlayerHover: (...args: any[]) => void;
  getCurrentDodgeRollVisualNow?: () => any;
  assets: {
    doodadImagesRef: any;
    heroImageRef: any;
    heroSprintImageRef: any;
    heroIdleImageRef: any;
    heroWaterImageRef: any;
    heroCrouchImageRef: any;
    heroDodgeImageRef: any;
    itemImagesRef: any;
    cloudImagesRef: any;
    droneImageRef: any;
    shelterImageRef: any;
    foundationTileImagesRef: any;
  };
  renderRefs: {
    deltaTimeRef: any;
    lastPositionsRef: any;
    localSwimTransitionRef: any;
    swimmingPlayerScratchRef: any;
    swimmingPlayerTopHalfScratchRef: any;
    localPlayerScratchRef: any;
    lastPlacementWarningRef: any;
  };
  diagnostics: {
    ySortDebugRef: any;
    perfProfilingRef: any;
    fpsProfilerRef: any;
    checkPerformance: (frameStartTime: number) => void;
  };
  animationRefs: {
    walkingAnimationFrameRef: any;
    sprintAnimationFrameRef: any;
    idleAnimationFrameRef: any;
  };
  damageRefs: {
    shakeOffsetXRef: any;
    shakeOffsetYRef: any;
    vignetteOpacityRef: any;
  };
  renderFunctions: {
    renderWorldPreparationPasses: any;
    renderEntityWorldPasses: any;
    renderScreenSpaceWorldEffects: any;
    renderLateFramePasses: any;
    renderWardParticles: any;
  };
}

export interface AssembleGameCanvasRenderContextOptions extends GameCanvasRenderRuntimeConfig {
  sceneRuntime: GameCanvasRuntimeSceneSnapshot | null;
  controllerRuntime: GameCanvasRuntimeControllerSnapshot | null;
  effectsRuntime: GameCanvasRuntimeParticleSnapshot | null;
  buildTargetingRef: MutableRef<GameCanvasBuildTargetingSnapshot>;
}

export function assembleGameCanvasRenderContext({
  sceneRuntime,
  controllerRuntime,
  effectsRuntime,
  buildTargetingRef,
  localPlayerId,
  localPlayer,
  predictedPosition,
  connection,
  gameCanvasRef,
  canvasSize,
  placementInfo,
  placementError,
  placementActions,
  setPlacementWarning,
  showFpsProfiler,
  isProfilerRecording,
  showAutotileDebug,
  showChunkBoundaries,
  showInteriorDebug,
  showCollisionDebug,
  showAttackRangeDebug,
  showYSortDebug,
  showShipwreckDebug,
  allShadowsEnabled,
  alwaysShowPlayerNames,
  waterSurfaceEffectsEnabled,
  footprintsEnabled,
  grassAnimationEnabled,
  worldParticlesQuality,
  cloudsEnabled,
  showPrecipitation,
  stormAtmosphereEnabled,
  showStatusOverlays,
  isMobile,
  tapAnimation,
  localPlayerIsCrouching,
  isAutoAttacking,
  isAutoWalking,
  hoveredPlayerIds,
  handlePlayerHover,
  getCurrentDodgeRollVisualNow,
  assets,
  renderRefs,
  diagnostics,
  animationRefs,
  damageRefs,
  renderFunctions,
}: AssembleGameCanvasRenderContextOptions): GameCanvasRuntimeRenderContext | null {
  if (!sceneRuntime || !controllerRuntime || !effectsRuntime) {
    return null;
  }

  const shelterClippingData = sceneRuntime.shelters
    ? Array.from(sceneRuntime.shelters.values()).map((shelter: any) => ({
        posX: shelter.posX,
        posY: shelter.posY,
        isDestroyed: shelter.isDestroyed,
      }))
    : [];

  const localPlayerX = predictedPosition?.x ?? localPlayer?.positionX ?? 0;
  const localPlayerY = predictedPosition?.y ?? localPlayer?.positionY ?? 0;

  return {
    ENABLE_LAG_DIAGNOSTICS: false,
    ENABLE_YSORT_DEBUG: false,
    YSORT_DEBUG_INTERVAL_MS: 400,
    PLAYER_SORT_FEET_OFFSET_PX: gameConfig.tileSize,
    LAG_DIAGNOSTIC_INTERVAL_MS: 5000,
    perfProfilingRef: diagnostics.perfProfilingRef,
    gameCanvasRef,
    resolvedMaskCanvas: sceneRuntime.resolvedMaskCanvas,
    worldMousePosRef: controllerRuntime.worldMousePosRef,
    cameraOffsetRef: controllerRuntime.cameraOffsetRef,
    predictedPositionRef: controllerRuntime.predictedPositionRef,
    localFacingDirectionRef: controllerRuntime.localFacingDirectionRef,
    getCurrentDodgeRollVisualNow,
    interpolatedCloudsRef: controllerRuntime.interpolatedCloudsRef,
    cycleProgressRef: controllerRuntime.cycleProgressRef,
    ySortedEntitiesRef: controllerRuntime.ySortedEntitiesRef,
    swimmingPlayersForBottomHalfRef: controllerRuntime.swimmingPlayersForBottomHalfRef,
    localSwimTransitionRef: renderRefs.localSwimTransitionRef,
    ySortDebugRef: diagnostics.ySortDebugRef,
    localPlayerId,
    localPlayer,
    canvasSize,
    currentCanvasWidth: canvasSize.width,
    currentCanvasHeight: canvasSize.height,
    renderGameDepsRef: controllerRuntime.renderGameDepsRef,
    seaTransitionTileLookup: sceneRuntime.seaTransitionTileLookup,
    waterTileLookup: sceneRuntime.waterTileLookup,
    showFpsProfiler,
    allShadowsEnabled,
    shelterClippingData,
    visibleWorldTiles: sceneRuntime.visibleWorldTiles,
    showAutotileDebug,
    waterPatches: sceneRuntime.waterPatches,
    fertilizerPatches: sceneRuntime.fertilizerPatches,
    firePatches: sceneRuntime.firePatches,
    placedExplosives: sceneRuntime.placedExplosives,
    placementInfo,
    visibleCampfires: sceneRuntime.visibleCampfires,
    visibleBarbecues: sceneRuntime.visibleBarbecues,
    visibleSeaStacks: sceneRuntime.visibleSeaStacks,
    visibleBarrels: sceneRuntime.visibleBarrels,
    doodadImagesRef: assets.doodadImagesRef,
    deltaTimeRef: renderRefs.deltaTimeRef,
    players: sceneRuntime.players,
    remotePlayerInterpolation: sceneRuntime.remotePlayerInterpolation,
    lastPositionsRef: renderRefs.lastPositionsRef,
    swimmingPlayerScratchRef: renderRefs.swimmingPlayerScratchRef,
    localPlayerScratchRef: renderRefs.localPlayerScratchRef,
    heroImageRef: assets.heroImageRef,
    heroSprintImageRef: assets.heroSprintImageRef,
    heroIdleImageRef: assets.heroIdleImageRef,
    heroWaterImageRef: assets.heroWaterImageRef,
    heroCrouchImageRef: assets.heroCrouchImageRef,
    heroDodgeImageRef: assets.heroDodgeImageRef,
    activeConnections: sceneRuntime.activeConnections,
    worldMousePos: controllerRuntime.worldMousePos,
    activeConsumableEffects: sceneRuntime.activeConsumableEffects,
    alwaysShowPlayerNames,
    localPlayerIsCrouching,
    waterSurfaceEffectsEnabled,
    footprintsEnabled,
    grassAnimationEnabled,
    renderWorldPreparationPasses: renderFunctions.renderWorldPreparationPasses,
    renderEntityWorldPasses: renderFunctions.renderEntityWorldPasses,
    renderScreenSpaceWorldEffects: renderFunctions.renderScreenSpaceWorldEffects,
    renderLateFramePasses: renderFunctions.renderLateFramePasses,
    hoveredPlayerIds,
    handlePlayerHover,
    localOptimisticDodgeRollStartMsRef: controllerRuntime.localOptimisticDodgeRollStartMsRef,
    localOptimisticJumpPressMsRef: controllerRuntime.localOptimisticJumpPressMsRef,
    playerDodgeRollStates: sceneRuntime.playerDodgeRollStates,
    foundationTileImagesRef: assets.foundationTileImagesRef,
    wallCells: sceneRuntime.wallCells,
    foundationCells: sceneRuntime.foundationCells,
    visibleFences: sceneRuntime.visibleFences,
    resolvedBuildingClusters: sceneRuntime.resolvedBuildingClusters,
    playerBuildingClusterId: sceneRuntime.playerBuildingClusterId,
    connection,
    isTreeFalling: sceneRuntime.isTreeFalling,
    getFallProgress: sceneRuntime.getFallProgress,
    playerStats: sceneRuntime.playerStats,
    largeQuarries: sceneRuntime.largeQuarries,
    detectedHotSprings: sceneRuntime.detectedHotSprings,
    detectedQuarries: sceneRuntime.detectedQuarries,
    caribouBreedingData: sceneRuntime.caribouBreedingData,
    walrusBreedingData: sceneRuntime.walrusBreedingData,
    chunkWeather: sceneRuntime.chunkWeather,
    visibleTrees: sceneRuntime.visibleTrees,
    worldState: sceneRuntime.worldState,
    targetedFoundation: controllerRuntime.targetedFoundation,
    targetedWall: controllerRuntime.targetedWall,
    targetedFence: controllerRuntime.targetedFence,
    buildTargetingRef,
    hasRepairHammer: controllerRuntime.hasRepairHammer,
    worldParticlesQuality,
    renderParticles: effectsRuntime.renderParticles,
    renderWardParticles: renderFunctions.renderWardParticles,
    walkingAnimationFrameRef: animationRefs.walkingAnimationFrameRef,
    sprintAnimationFrameRef: animationRefs.sprintAnimationFrameRef,
    idleAnimationFrameRef: animationRefs.idleAnimationFrameRef,
    shakeOffsetXRef: damageRefs.shakeOffsetXRef,
    shakeOffsetYRef: damageRefs.shakeOffsetYRef,
    vignetteOpacityRef: damageRefs.vignetteOpacityRef,
    computeCampfireFireOverlayEmitters: effectsRuntime.computeCampfireFireOverlayEmitters,
    campfireParticles: effectsRuntime.campfireParticles,
    fireArrowParticles: effectsRuntime.fireArrowParticles,
    torchParticles: effectsRuntime.torchParticles,
    furnaceParticles: effectsRuntime.furnaceParticles,
    barbecueParticles: effectsRuntime.barbecueParticles,
    firePatchParticles: effectsRuntime.firePatchParticles,
    wardParticles: effectsRuntime.wardParticles,
    resourceSparkleParticles: effectsRuntime.resourceSparkleParticles,
    impactParticles: effectsRuntime.impactParticles,
    structureImpactParticles: effectsRuntime.structureImpactParticles,
    hostileDeathParticles: effectsRuntime.hostileDeathParticles,
    visibleHarvestableResourcesMap: sceneRuntime.visibleHarvestableResourcesMap,
    visibleCampfiresMap: sceneRuntime.visibleCampfiresMap,
    visibleFurnacesMap: sceneRuntime.visibleFurnacesMap,
    visibleBarbecuesMap: sceneRuntime.visibleBarbecuesMap,
    fumaroles: sceneRuntime.fumaroles,
    visibleDroppedItemsMap: sceneRuntime.visibleDroppedItemsMap,
    visibleBoxesMap: sceneRuntime.visibleBoxesMap,
    visiblePlayerCorpsesMap: sceneRuntime.visiblePlayerCorpsesMap,
    stashes: sceneRuntime.stashes,
    visibleSleepingBagsMap: sceneRuntime.visibleSleepingBagsMap,
    itemDefinitions: sceneRuntime.itemDefinitions,
    buildingState: controllerRuntime.buildingState,
    itemImagesRef: assets.itemImagesRef,
    shelterImageRef: assets.shelterImageRef,
    placementError,
    placementActions,
    localPlayerX,
    localPlayerY,
    inventoryItems: sceneRuntime.inventoryItems,
    lastPlacementWarningRef: renderRefs.lastPlacementWarningRef,
    setPlacementWarning,
    cloudsEnabled,
    clouds: sceneRuntime.clouds,
    cloudImagesRef: assets.cloudImagesRef,
    droneEvents: sceneRuntime.droneEvents,
    droneImageRef: assets.droneImageRef,
    showChunkBoundaries,
    showInteriorDebug,
    showCollisionDebug,
    trees: sceneRuntime.trees,
    stones: sceneRuntime.stones,
    runeStones: sceneRuntime.runeStones,
    cairns: sceneRuntime.cairns,
    woodenStorageBoxes: sceneRuntime.woodenStorageBoxes,
    furnaces: sceneRuntime.furnaces,
    barbecues: sceneRuntime.barbecues,
    shelters: sceneRuntime.shelters,
    wildAnimals: sceneRuntime.wildAnimals,
    visibleAnimalCorpsesMap: sceneRuntime.visibleAnimalCorpsesMap,
    barrels: sceneRuntime.barrels,
    roadLampposts: sceneRuntime.roadLampposts,
    seaStacks: sceneRuntime.seaStacks,
    homesteadHearths: sceneRuntime.homesteadHearths,
    basaltColumns: sceneRuntime.basaltColumns,
    doors: sceneRuntime.doors,
    lanterns: sceneRuntime.lanterns,
    turrets: sceneRuntime.turrets,
    monumentParts: sceneRuntime.monumentParts,
    showYSortDebug,
    hasStoneTiller: controllerRuntime.hasStoneTiller,
    showAttackRangeDebug,
    activeEquipments: sceneRuntime.activeEquipments,
    campfires: sceneRuntime.campfires,
    sleepingBags: sceneRuntime.sleepingBags,
    interpolatedGrass: sceneRuntime.interpolatedGrass,
    showPrecipitation,
    stormAtmosphereEnabled,
    resolvedOverlayRgba: sceneRuntime.resolvedOverlayRgba,
    redrawMask: sceneRuntime.redrawMask,
    visibleLanterns: sceneRuntime.visibleLanterns,
    showStatusOverlays,
    visibleRoadLamppostsMap: sceneRuntime.visibleRoadLamppostsMap,
    visibleBarrelsMap: sceneRuntime.visibleBarrelsMap,
    visibleRuneStonesMap: sceneRuntime.visibleRuneStonesMap,
    shipwreckPartsMap: sceneRuntime.shipwreckPartsMap,
    showShipwreckDebug,
    isMobile,
    tapAnimation,
    fpsProfilerRef: diagnostics.fpsProfilerRef,
    isProfilerRecording,
    visibleGrassMap: sceneRuntime.visibleGrassMap,
    visibleSeaStacksMap: sceneRuntime.visibleSeaStacksMap,
    visibleBoxesMapSizeSource: sceneRuntime.visibleBoxesMap,
    visibleLanternsMap: sceneRuntime.visibleLanternsMap,
    visibleTurretsMap: sceneRuntime.visibleTurretsMap,
    visibleHomesteadHearthsMap: sceneRuntime.visibleHomesteadHearthsMap,
    visibleDoorsMap: sceneRuntime.visibleDoorsMap,
    rainCollectors: sceneRuntime.rainCollectors,
    brothPots: sceneRuntime.brothPots,
    alkStations: sceneRuntime.alkStations,
    EMPTY_MAP,
    isAutoAttacking,
    isAutoWalking,
    swimmingPlayerTopHalfScratchRef: renderRefs.swimmingPlayerTopHalfScratchRef,
    checkPerformance: diagnostics.checkPerformance,
  };
}
