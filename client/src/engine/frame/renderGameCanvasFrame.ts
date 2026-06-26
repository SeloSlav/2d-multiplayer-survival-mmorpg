import { gameConfig, getViewBounds } from '../../config/gameConfig';
import { renderPlayerCorpse } from '../../utils/renderers/playerCorpseRenderingUtils';
import { renderAllFootprints } from '../../utils/renderers/terrainTrailUtils';
import { beginProjectileRenderPass } from '../../utils/renderers/projectileRenderingUtils';
import { worldPosToTileCoords } from '../../utils/renderers/placementRenderingUtils';
import { logLagDiagnostic } from '../../utils/gameDebugUtils';
import { mark } from '../../utils/profiler';
import { renderCutGrassEffects } from '../../effects/cutGrassEffect';
import { renderArrowBreakEffects } from '../../effects/arrowBreakEffect';
import { renderCampfireFireOverlay } from '../../utils/renderers/campfireFireOverlayUtils';
import { mergeCampfireFireEmittersWithYSort } from '../../utils/renderers/campfireFireEmittersMerge';
import {
  syncCampfireSmokePlumeBuild,
  buildCampfireBurningStateMap,
} from '../../utils/renderers/campfireSmokePlumeReach';
import { buildTorchFireGpuOverlayEmitters } from '../../utils/renderers/torchFireOverlayEmitters';
import {
  renderTranslatedWorldExtrasUnderCampfireOverlay,
  renderTranslatedWorldExtrasOverCampfireOverlay,
} from './renderTranslatedWorldExtras';

/**
 * Prep-pass bottom halves must match every `swimmingPlayerTopHalf` in the Y-sort list.
 * Merges with the ref list so a one-frame ref/sort mismatch still draws legs.
 */
function resolveSwimmingPlayersForBottomHalf(ySortedEntities: any[], refList: any[]): any[] {
  const map = new Map<string, any>();
  for (const item of ySortedEntities) {
    if (item?.type === 'swimmingPlayerTopHalf' && item.entity?.identity) {
      map.set(item.entity.identity.toHexString(), item.entity);
    }
  }
  for (const p of refList) {
    if (!p?.identity) continue;
    const id = p.identity.toHexString();
    if (!map.has(id)) map.set(id, p);
  }
  return Array.from(map.values());
}

export function renderGameCanvasFrame(args: any): void {
  const frameStartTime = performance.now();
  const {
    ENABLE_LAG_DIAGNOSTICS,
    perfProfilingRef,
    gameCanvasRef,
    resolvedMaskCanvas,
    worldMousePosRef,
    cameraOffsetRef,
    predictedPositionRef,
    localFacingDirectionRef,
    getCurrentDodgeRollVisualNow,
    interpolatedCloudsRef,
    cycleProgressRef,
    ySortedEntitiesRef,
    canvasSize,
    renderGameDepsRef,
    seaTransitionTileLookup,
    waterTileLookup,
    localSwimTransitionRef,
    ySortDebugRef,
    localPlayerId,
    localPlayer,
    showFpsProfiler,
    allShadowsEnabled,
    shelterClippingData,
    visibleWorldTiles,
    showAutotileDebug,
    waterPatches,
    fertilizerPatches,
    firePatches,
    placedExplosives,
    placementInfo,
    visibleCampfires,
    visibleBarbecues,
    visibleSeaStacks,
    visibleBarrels,
    doodadImagesRef,
    deltaTimeRef,
    players,
    remotePlayerInterpolation,
    lastPositionsRef,
    swimmingPlayerScratchRef,
    localPlayerScratchRef,
    heroImageRef,
    heroSprintImageRef,
    heroIdleImageRef,
    heroWaterImageRef,
    heroCrouchImageRef,
    heroDodgeImageRef,
    activeConnections,
    worldMousePos,
    activeConsumableEffects,
    alwaysShowPlayerNames,
    localPlayerIsCrouching,
    waterSurfaceEffectsEnabled,
    footprintsEnabled,
    grassAnimationEnabled = true,
    renderEntityWorldPasses,
    renderWorldPreparationPasses,
    renderScreenSpaceWorldEffects,
    renderLateFramePasses,
    hoveredPlayerIds,
    handlePlayerHover,
    localOptimisticDodgeRollStartMsRef,
    localOptimisticJumpPressMsRef,
    playerDodgeRollStates,
    foundationTileImagesRef,
    wallCells,
    foundationCells,
    visibleFences,
    resolvedBuildingClusters,
    playerBuildingClusterId,
    connection,
    isTreeFalling,
    getFallProgress,
    playerStats,
    largeQuarries,
    detectedHotSprings,
    detectedQuarries,
    caribouBreedingData,
    walrusBreedingData,
    chunkWeather,
    visibleTrees,
    worldState,
    targetedFoundation,
    targetedWall,
    targetedFence,
    buildTargetingRef,
    hasRepairHammer,
    worldParticlesQuality,
    renderParticles,
    renderWardParticles,
    walkingAnimationFrameRef,
    sprintAnimationFrameRef,
    idleAnimationFrameRef,
    shakeOffsetXRef,
    shakeOffsetYRef,
    vignetteOpacityRef,
    computeCampfireFireOverlayEmitters,
    campfireParticles,
    fireArrowParticles,
    torchParticles,
    furnaceParticles,
    barbecueParticles,
    firePatchParticles,
    wardParticles,
    resourceSparkleParticles,
    impactParticles,
    structureImpactParticles,
    hostileDeathParticles,
    visibleHarvestableResourcesMap,
    visibleCampfiresMap,
    visibleFurnacesMap,
    fumaroles,
    visibleDroppedItemsMap,
    visibleBoxesMap,
    visiblePlayerCorpsesMap,
    stashes,
    visibleSleepingBagsMap,
    itemDefinitions,
    buildingState,
    itemImagesRef,
    shelterImageRef,
    placementError,
    placementActions,
    localPlayerX,
    localPlayerY,
    inventoryItems,
    lastPlacementWarningRef,
    setPlacementWarning,
    cloudsEnabled,
    clouds,
    cloudImagesRef,
    droneEvents,
    droneImageRef,
    showChunkBoundaries,
    currentCanvasWidth,
    currentCanvasHeight,
    showInteriorDebug,
    showCollisionDebug,
    trees,
    stones,
    runeStones,
    cairns,
    woodenStorageBoxes,
    furnaces,
    barbecues,
    shelters,
    wildAnimals,
    visibleAnimalCorpsesMap,
    barrels,
    roadLampposts,
    seaStacks,
    homesteadHearths,
    basaltColumns,
    doors,
    lanterns,
    turrets,
    monumentParts,
    showYSortDebug,
    hasStoneTiller,
    showAttackRangeDebug,
    campfires,
    interpolatedGrass,
    showPrecipitation,
    stormAtmosphereEnabled,
    resolvedOverlayRgba,
    redrawMask,
    visibleLanterns,
    showStatusOverlays,
    renderLateFramePassesArgs,
    visibleRoadLamppostsMap,
    visibleBarrelsMap,
    visibleRuneStonesMap,
    shipwreckPartsMap,
    showShipwreckDebug,
    tapAnimation,
    fpsProfilerRef,
    isProfilerRecording,
    LAG_DIAGNOSTIC_INTERVAL_MS,
    visibleBoxesMapSizeSource,
    visibleGrassMap,
    visibleSeaStacksMap,
    checkPerformance,
  } = args;

  if (ENABLE_LAG_DIAGNOSTICS) {
    perfProfilingRef.current.frameCount += 1;
  }

  const canvas = gameCanvasRef.current;
  const maskCanvas = resolvedMaskCanvas;
  if (!canvas || !maskCanvas) {
    return;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }

  beginProjectileRenderPass(frameStartTime);

  const nowMs = Date.now();
  const currentWorldMouseX = worldMousePosRef.current.x;
  const currentWorldMouseY = worldMousePosRef.current.y;
  const currentBuildTargeting = buildTargetingRef?.current;
  const currentCameraOffsetX = cameraOffsetRef.current.x + shakeOffsetXRef.current;
  const currentCameraOffsetY = cameraOffsetRef.current.y + shakeOffsetYRef.current;
  const currentPredictedPosition = predictedPositionRef.current;
  const currentLocalFacingDirection = localFacingDirectionRef.current;
  const localPredictedDodgeRollVisualState = getCurrentDodgeRollVisualNow?.() ?? null;
  const currentAnimationFrame = walkingAnimationFrameRef.current;
  const currentSprintAnimationFrame = sprintAnimationFrameRef.current;
  const currentIdleAnimationFrame = idleAnimationFrameRef.current;
  const currentInterpolatedClouds = interpolatedCloudsRef.current;
  const currentCycleProgress = cycleProgressRef.current;
  const currentYSortedEntities = ySortedEntitiesRef.current;
  const viewBounds = getViewBounds(currentCameraOffsetX, currentCameraOffsetY, currentCanvasWidth, currentCanvasHeight);
  const rd = renderGameDepsRef.current;
  const LOCAL_WATER_ENTRY_FULL_SPRITE_GRACE_MS = 250;

  let localIsSwimmingNow = false;
  if (currentPredictedPosition) {
    const localTileX = Math.floor(currentPredictedPosition.x / gameConfig.tileSize);
    const localTileY = Math.floor(currentPredictedPosition.y / gameConfig.tileSize);
    const localTileKey = `${localTileX},${localTileY}`;
    const onTransitionTile = seaTransitionTileLookup.get(localTileKey) ?? false;
    localIsSwimmingNow = (waterTileLookup.get(localTileKey) ?? false) && !onTransitionTile;
  }

  if (localIsSwimmingNow && !localSwimTransitionRef.current.wasSwimming) {
    localSwimTransitionRef.current.enteredWaterAtMs = nowMs;
  } else if (!localIsSwimmingNow && localSwimTransitionRef.current.wasSwimming) {
    localSwimTransitionRef.current.enteredWaterAtMs = 0;
  }
  localSwimTransitionRef.current.wasSwimming = localIsSwimmingNow;

  const localWaterEntryGraceActive =
    localIsSwimmingNow &&
    localSwimTransitionRef.current.enteredWaterAtMs > 0 &&
    (nowMs - localSwimTransitionRef.current.enteredWaterAtMs) < LOCAL_WATER_ENTRY_FULL_SPRITE_GRACE_MS;

  if (args.ENABLE_YSORT_DEBUG && localPlayerId) {
    const nowDebug = Date.now();
    if (nowDebug - ySortDebugRef.current.lastLogTime >= args.YSORT_DEBUG_INTERVAL_MS) {
      ySortDebugRef.current.lastLogTime = nowDebug;
      const localPosX = currentPredictedPosition?.x ?? localPlayer?.positionX ?? null;
      const localPosY = currentPredictedPosition?.y ?? localPlayer?.positionY ?? null;
      if (localPosX != null && localPosY != null) {
        const localFeetY = localPosY + args.PLAYER_SORT_FEET_OFFSET_PX;
        const playerIndex = currentYSortedEntities.findIndex((item: any) =>
          item?.type === 'player' && item?.entity?.identity?.toHexString?.() === localPlayerId,
        );
        let nearest: any = null;
        let nearestDistSq = Number.POSITIVE_INFINITY;
        for (const item of currentYSortedEntities as any[]) {
          if (!item || !item.entity) continue;
          if (item.type !== 'grass' && item.type !== 'harvestable_resource') continue;
          const ex = item.type === 'grass'
            ? Number(item.entity.serverPosX ?? item.entity.posX ?? 0)
            : Number(item.entity.posX ?? 0);
          const ey = item.type === 'grass'
            ? Number(item.entity.serverPosY ?? item.entity.posY ?? 0)
            : Number(item.entity.posY ?? 0);
          const dx = ex - localPosX;
          const dy = ey - localPosY;
          const distSq = dx * dx + dy * dy;
          if (distSq < nearestDistSq) {
            nearestDistSq = distSq;
            nearest = item;
          }
        }

        if (nearest) {
          const nearestIndex = currentYSortedEntities.indexOf(nearest);
          const entityBaseY = nearest.type === 'grass'
            ? Number(nearest.entity.serverPosY ?? 0) + 5
            : Number(nearest.entity.posY ?? 0);
          const expectedPlayerInFront = localFeetY >= entityBaseY;
          const actualPlayerInFront =
            playerIndex !== -1 && nearestIndex !== -1 ? playerIndex > nearestIndex : null;

          console.log('[YSORT_DEBUG]', {
            localPlayerId,
            localPosX,
            localPosY,
            localFeetY,
            nearestType: nearest.type,
            nearestId: nearest.entity?.id?.toString?.() ?? null,
            nearestTag: nearest.entity?.appearanceType?.tag ?? nearest.entity?.plantType?.tag ?? null,
            nearestX: nearest.type === 'grass' ? nearest.entity?.serverPosX : nearest.entity?.posX,
            nearestY: nearest.type === 'grass' ? nearest.entity?.serverPosY : nearest.entity?.posY,
            entityBaseY,
            expectedPlayerInFront,
            playerIndex,
            entityIndex: nearestIndex,
            actualPlayerInFront,
            orderMismatch: actualPlayerInFront != null ? actualPlayerInFront !== expectedPlayerInFront : null,
            distSq: Math.round(nearestDistSq),
          });
        }
      }
    }
  }

  const swimmingPlayersForBottomHalf = resolveSwimmingPlayersForBottomHalf(
    currentYSortedEntities as any[],
    args.swimmingPlayersForBottomHalfRef.current,
  );
  const {
    t0: _t0,
    t0a: _t0a,
    t1: _t1,
    t1a: _t1a,
    t1b: _t1b,
    t1c: _t1c,
    t1d: _t1d,
    t2: _t2,
    worldCacheUpdateMs: _worldCacheUpdateMs,
    worldBaseTilesMs: _worldBaseTilesMs,
    worldTransitionsMs: _worldTransitionsMs,
    worldDoodadsMs: _worldDoodadsMs,
    worldDoodadsTransitionChecksMs: _worldDoodadsTransitionChecksMs,
    worldDoodadsSpawnEvaluationMs: _worldDoodadsSpawnEvaluationMs,
    worldDoodadsBlurredDrawsMs: _worldDoodadsBlurredDrawsMs,
    worldDoodadsOpaqueDrawsMs: _worldDoodadsOpaqueDrawsMs,
    waterOverlayGridMs: _waterOverlayGridMs,
    waterOverlayShaderMs: _waterOverlayShaderMs,
    waterOverlayMaskMs: _waterOverlayMaskMs,
    waterOverlayCompositeMs: _waterOverlayCompositeMs,
    waterOverlayDrawMs: _waterOverlayDrawMs,
    isPlacementTooFarValue,
    isSnorkeling,
  } = renderWorldPreparationPasses({
    ctx,
    canvasWidth: currentCanvasWidth,
    canvasHeight: currentCanvasHeight,
    cameraOffsetX: currentCameraOffsetX,
    cameraOffsetY: currentCameraOffsetY,
    showFpsProfiler,
    allShadowsEnabled,
    shelterClippingData,
    localPlayer,
    visibleWorldTiles,
    showAutotileDebug,
    waterPatches,
    fertilizerPatches,
    firePatches,
    placedExplosives,
    nowMs,
    placementInfo,
    currentWorldMouseX,
    currentWorldMouseY,
    visibleCampfires,
    visibleBarbecues,
    visibleSeaStacks,
    visibleBarrels,
    currentCycleProgress,
    currentPredictedPosition,
    doodadImages: doodadImagesRef.current,
    deltaTimeMs: deltaTimeRef.current,
    waterTileLookup,
    seaTransitionTileLookup,
    swimmingPlayersForBottomHalf,
    players,
    localPlayerId,
    currentLocalFacingDirection,
    remotePlayerInterpolation,
    lastPositionsRef,
    swimmingPlayerScratchRef,
    localPlayerScratchRef,
    heroImage: heroImageRef.current,
    heroSprintImage: heroSprintImageRef.current,
    heroIdleImage: heroIdleImageRef.current,
    heroWaterImage: heroWaterImageRef.current,
    heroCrouchImage: heroCrouchImageRef.current,
    heroDodgeImage: heroDodgeImageRef.current,
    currentIdleAnimationFrame,
    currentWalkingAnimationFrame: currentAnimationFrame,
    activeConnections,
    worldMousePos,
    activeConsumableEffects,
    alwaysShowPlayerNames,
    localPlayerIsCrouching,
    localWaterEntryGraceActive,
    waterSurfaceEffectsEnabled,
    connection,
  });

  const isOnSeaTileForBarrels = (worldX: number, worldY: number): boolean => {
    const { tileX, tileY } = worldPosToTileCoords(worldX, worldY);
    return waterTileLookup.get(`${tileX},${tileY}`) ?? false;
  };

  if (!isSnorkeling && footprintsEnabled) {
    renderAllFootprints(ctx, viewBounds, nowMs);
  }
  const _t2a = mark(showFpsProfiler);

  const { t2b: _t2b, t2c: _t2c, t3: _t3, t3a: _t3a } = renderEntityWorldPasses({
    ctx,
    showFpsProfiler,
    ySortedEntities: currentYSortedEntities,
    heroImageRef,
    heroSprintImageRef,
    heroIdleImageRef,
    heroWaterImageRef,
    heroCrouchImageRef,
    heroDodgeImageRef,
    lastPositionsRef,
    activeConnections,
    activeEquipments: args.activeEquipments,
    activeConsumableEffects,
    itemDefinitions,
    inventoryItems,
    itemImagesRef,
    doodadImagesRef: args.doodadImagesRef,
    shelterImageRef,
    currentWorldMouseX,
    currentWorldMouseY,
    localPlayerId,
    currentAnimationFrame,
    currentSprintAnimationFrame,
    currentIdleAnimationFrame,
    nowMs,
    hoveredPlayerIds,
    handlePlayerHover,
    currentCycleProgress,
    localPredictedDodgeRollVisualState,
    localOptimisticDodgeRollStartMs: localOptimisticDodgeRollStartMsRef.current,
    localOptimisticJumpPressMsRef,
    renderPlayerCorpseFn: (props: any) => renderPlayerCorpse({ ...props, cycleProgress: currentCycleProgress, heroImageRef, heroWaterImageRef, heroCrouchImageRef }),
    localPlayer,
    currentPredictedPosition,
    playerDodgeRollStates,
    remotePlayerInterpolation,
    localPlayerIsCrouching,
    rd,
    shelterClippingData,
    currentLocalFacingDirection,
    allShadowsEnabled,
    isTreeFalling,
    getFallProgress,
    currentCameraOffsetX,
    currentCameraOffsetY,
    foundationTileImagesRef,
    wallCells,
    foundationCells,
    visibleFences,
    resolvedBuildingClusters,
    playerBuildingClusterId,
    connection,
    isSnorkeling,
    alwaysShowPlayerNames,
    playerStats,
    largeQuarries,
    detectedHotSprings,
    detectedQuarries,
    placementInfo,
    caribouBreedingData,
    walrusBreedingData,
    chunkWeather,
    grassAnimationEnabled,
    seaTransitionTileLookup,
    waterTileLookup,
    swimmingPlayersForBottomHalf,
    swimmingPlayerScratchRef,
    swimmingPlayerTopHalfScratchRef: args.swimmingPlayerTopHalfScratchRef,
    visibleTrees,
    worldTimeOfDay: worldState?.timeOfDay,
    visibleSeaStacks,
    wildAnimals,
    canvasWidth: currentCanvasWidth,
    canvasHeight: currentCanvasHeight,
    targetedFoundation: currentBuildTargeting?.targetedFoundation ?? targetedFoundation,
    targetedWall: currentBuildTargeting?.targetedWall ?? targetedWall,
    targetedFence: currentBuildTargeting?.targetedFence ?? targetedFence,
    hasRepairHammer,
  });
  const _t3b = mark(showFpsProfiler);

  // GPU fire only when isBurning (server: new campfires start unlit until fueled + lit).
  // Merge y-sorted campfires so emitters match the renderer even if visibleCampfiresMap is stale same frame.
  const fireOverlayTimeMs = performance.now();
  syncCampfireSmokePlumeBuild(
    buildCampfireBurningStateMap(campfires, currentYSortedEntities as any[]),
    fireOverlayTimeMs,
  );
  // Re-read ref here so torch fire anchor matches this frame’s facing (not server `player.direction`).
  const torchLocalFacingNow = localFacingDirectionRef.current ?? currentLocalFacingDirection;
  const torchEmitters = buildTorchFireGpuOverlayEmitters({
    players,
    activeEquipments: args.activeEquipments,
    itemDefinitions,
    localPlayerId,
    localFacingDirection: torchLocalFacingNow,
    localPredictedPosition: currentPredictedPosition,
    remotePlayerInterpolation,
    nowMs: fireOverlayTimeMs,
  });
  const hookEmitters =
    typeof computeCampfireFireOverlayEmitters === 'function'
      ? computeCampfireFireOverlayEmitters(fireOverlayTimeMs)
      : [];
  const fireEmitters = mergeCampfireFireEmittersWithYSort(
    [...torchEmitters, ...hookEmitters],
    currentYSortedEntities as any[],
    fireOverlayTimeMs,
  );

  if (worldParticlesQuality > 0) {
    renderParticles(ctx, campfireParticles);
    renderParticles(ctx, fireArrowParticles);
    if (worldParticlesQuality > 1) {
      renderParticles(ctx, torchParticles);
      renderParticles(ctx, furnaceParticles);
      renderParticles(ctx, barbecueParticles);
      renderParticles(ctx, firePatchParticles);
      renderWardParticles(ctx, wardParticles, 0, 0);
    }
  }

  renderCutGrassEffects(ctx, nowMs);
  renderArrowBreakEffects(ctx, nowMs);

  if (typeof window !== 'undefined' && (window as any).renderOtherPlayersFishing) {
    (window as any).renderOtherPlayersFishing(ctx);
  }
  const _t3c = mark(showFpsProfiler);

  const translatedWorldExtrasOpts = {
    ctx,
    visibleHarvestableResourcesMap,
    visibleCampfiresMap,
    visibleFurnacesMap,
    visibleBarbecuesMap: args.visibleBarbecuesMap,
    fumaroles,
    visibleDroppedItemsMap,
    visibleBoxesMap,
    visiblePlayerCorpsesMap,
    stashes,
    visibleSleepingBagsMap,
    players,
    itemDefinitions,
    unifiedInteractableTarget: rd.unifiedInteractableTarget as any,
    visibleLanternsMap: args.visibleLanternsMap,
    visibleTurretsMap: args.visibleTurretsMap,
    rainCollectors: args.rainCollectors,
    brothPots: args.brothPots,
    visibleHomesteadHearthsMap: args.visibleHomesteadHearthsMap,
    visibleDoorsMap: args.visibleDoorsMap,
    alkStations: args.alkStations,
    emptyMap: args.EMPTY_MAP,
    localPlayer,
    currentPredictedPosition,
    isAutoAttacking: args.isAutoAttacking,
    isAutoWalking: args.isAutoWalking,
    placementInfo,
    buildingState,
    itemImagesRef,
    shelterImageRef,
    currentWorldMouseX,
    currentWorldMouseY,
    isPlacementTooFarValue,
    placementError,
    clearPlacementError: placementActions.clearPlacementError,
    connection,
    doodadImagesRef: args.doodadImagesRef,
    currentCameraOffsetX,
    currentCameraOffsetY,
    localPlayerX,
    localPlayerY,
    inventoryItems,
    foundationTileImagesRef,
    lastPlacementWarningRef,
    setPlacementWarning,
    cloudsEnabled,
    clouds,
    currentInterpolatedClouds,
    cloudImagesRef,
    droneEvents,
    droneImageRef,
    nowMs,
    showChunkBoundaries,
    worldState,
    currentCanvasWidth,
    currentCanvasHeight,
    showInteriorDebug,
    resolvedBuildingClusters,
    playerBuildingClusterId,
    showCollisionDebug,
    trees,
    stones,
    runeStones,
    cairns,
    woodenStorageBoxes,
    furnaces,
    barbecues,
    shelters,
    wildAnimals,
    visibleAnimalCorpsesMap,
    barrels,
    roadLampposts,
    seaStacks,
    wallCells,
    foundationCells,
    homesteadHearths,
    basaltColumns,
    doors,
    lanterns,
    turrets,
    monumentParts: monumentParts ?? args.EMPTY_MAP,
    isOnSeaTileForBarrels,
    projectiles: rd.projectiles,
    showYSortDebug,
    currentYSortedEntities,
    viewBounds,
    hasStoneTiller,
    currentLocalFacingDirection,
    showAttackRangeDebug,
    activeEquipments: args.activeEquipments,
    campfires,
    sleepingBags: args.sleepingBags,
    interpolatedGrass,
  };

  renderTranslatedWorldExtrasUnderCampfireOverlay(translatedWorldExtrasOpts);
  const _t3d = mark(showFpsProfiler);

  // Between clouds/debug and interaction UI so E labels and placement preview stay on top.
  renderCampfireFireOverlay(
    ctx,
    currentCameraOffsetX,
    currentCameraOffsetY,
    currentCanvasWidth,
    currentCanvasHeight,
    fireOverlayTimeMs,
    fireEmitters,
  );
  const _t3e = mark(showFpsProfiler);

  renderTranslatedWorldExtrasOverCampfireOverlay(translatedWorldExtrasOpts);
  const _t3f = mark(showFpsProfiler);

  ctx.restore();

  renderScreenSpaceWorldEffects({
    ctx,
    localPlayer,
    chunkWeather,
    currentPredictedPosition,
    worldState,
    showPrecipitation,
    isSnorkeling,
    currentCameraOffsetX,
    currentCameraOffsetY,
    currentCanvasWidth,
    currentCanvasHeight,
    deltaTimeMs: deltaTimeRef.current,
    stormAtmosphereEnabled,
    currentCycleProgress,
    resolvedOverlayRgba,
    maskCanvas,
    redrawMask,
    currentWorldMouseX,
    currentWorldMouseY,
    visibleLanterns,
    worldParticlesQuality,
    renderParticles,
    resourceSparkleParticles,
    impactParticles,
    structureImpactParticles,
    hostileDeathParticles,
    showStatusOverlays,
    activeConsumableEffects,
    localPlayerId,
  });
  const _t3g = mark(showFpsProfiler);

  const { frameTime } = renderLateFramePasses({
    ctx,
    frameStartTime,
    showFpsProfiler,
    timingMarks: {
      t0: _t0,
      t0a: _t0a,
      t1: _t1,
      t1a: _t1a,
      t1b: _t1b,
      t1c: _t1c,
      t1d: _t1d,
      t2: _t2,
      t2a: _t2a,
      t2b: _t2b,
      t2c: _t2c,
      t3: _t3,
      t3a: _t3a,
      t3b: _t3b,
      t3c: _t3c,
      t3d: _t3d,
      t3e: _t3e,
      t3f: _t3f,
      t3g: _t3g,
      worldCacheUpdateMs: _worldCacheUpdateMs,
      worldBaseTilesMs: _worldBaseTilesMs,
      worldTransitionsMs: _worldTransitionsMs,
      worldDoodadsMs: _worldDoodadsMs,
      worldDoodadsTransitionChecksMs: _worldDoodadsTransitionChecksMs,
      worldDoodadsSpawnEvaluationMs: _worldDoodadsSpawnEvaluationMs,
      worldDoodadsBlurredDrawsMs: _worldDoodadsBlurredDrawsMs,
      worldDoodadsOpaqueDrawsMs: _worldDoodadsOpaqueDrawsMs,
      waterOverlayGridMs: _waterOverlayGridMs,
      waterOverlayShaderMs: _waterOverlayShaderMs,
      waterOverlayMaskMs: _waterOverlayMaskMs,
      waterOverlayCompositeMs: _waterOverlayCompositeMs,
      waterOverlayDrawMs: _waterOverlayDrawMs,
    },
    cameraOffsetX: currentCameraOffsetX,
    cameraOffsetY: currentCameraOffsetY,
    holdInteractionProgress: rd.holdInteractionProgress,
    isActivelyHolding: rd.isActivelyHolding,
    closestInteractableKnockedOutPlayerId: rd.closestInteractableKnockedOutPlayerId ?? null,
    closestInteractableWaterPosition: rd.closestInteractableWaterPosition,
    visibleCampfiresMap,
    visibleFurnacesMap,
    visibleBarbecuesMap: args.visibleBarbecuesMap,
    visibleLanternsMap: args.visibleLanternsMap,
    visibleBoxesMap,
    visibleDoorsMap: args.visibleDoorsMap,
    visibleHomesteadHearthsMap: args.visibleHomesteadHearthsMap,
    stashes,
    players,
    emptyMap: args.EMPTY_MAP,
    buildingClusters: resolvedBuildingClusters,
    monumentParts,
    cycleProgress: currentCycleProgress,
    visibleRoadLamppostsMap,
    visibleBarrelsMap,
    visibleRuneStonesMap,
    nowMs,
    shipwreckPartsMap,
    viewBounds,
    showShipwreckDebug,
    localPlayerId,
    currentPredictedPosition,
    remotePlayerInterpolation,
    activeEquipments: args.activeEquipments,
    itemDefinitions,
    currentWorldMouseX,
    currentWorldMouseY,
    isMobile: args.isMobile,
    tapAnimation,
    vignetteOpacity: vignetteOpacityRef.current,
    canvasWidth: currentCanvasWidth,
    canvasHeight: currentCanvasHeight,
    fpsProfilerRef,
    isProfilerRecording,
    ySortedEntityCount: currentYSortedEntities.length,
  });

  if (ENABLE_LAG_DIAGNOSTICS) {
    perfProfilingRef.current.totalFrameTime += frameTime;
    perfProfilingRef.current.renderCallCount += 1;
    if (frameTime > perfProfilingRef.current.maxFrameTime) {
      perfProfilingRef.current.maxFrameTime = frameTime;
    }
    if (frameTime > 16) {
      perfProfilingRef.current.slowFrames += 1;
    }
    if (frameTime > 33) {
      perfProfilingRef.current.verySlowFrames += 1;
    }
  }

  if (ENABLE_LAG_DIAGNOSTICS && Date.now() - perfProfilingRef.current.lastLogTime > LAG_DIAGNOSTIC_INTERVAL_MS) {
    const p = perfProfilingRef.current;
    logLagDiagnostic(p, {
      players: players.size,
      trees: trees?.size || 0,
      stones: stones?.size || 0,
      ySorted: currentYSortedEntities.length,
      campfires: visibleCampfiresMap.size,
      boxes: visibleBoxesMapSizeSource.size,
      resources: visibleHarvestableResourcesMap.size,
      items: visibleDroppedItemsMap.size,
      grass: visibleGrassMap?.size || 0,
      seaStacks: visibleSeaStacksMap.size,
    });
    perfProfilingRef.current = {
      lastLogTime: Date.now(),
      frameCount: 0,
      totalFrameTime: 0,
      maxFrameTime: 0,
      slowFrames: 0,
      verySlowFrames: 0,
      lastServerUpdateTime: p.lastServerUpdateTime,
      serverUpdateCount: 0,
      maxServerLatency: 0,
      totalServerLatency: 0,
      renderCallCount: 0,
    };
  }

  checkPerformance(frameStartTime);
}
