import { renderInteractionLabels, renderLocalPlayerStatusTags } from '../../utils/renderers/labelRenderingUtils';
import { renderPlacementPreview } from '../../utils/renderers/placementRenderingUtils';
import { renderCloudsDirectly } from '../../utils/renderers/cloudRenderingUtils';
import { getInterpolatedDrones, renderDronesDirectly } from '../../utils/renderers/droneRenderingUtils';
import {
  renderChunkBoundaries,
  renderInteriorDebug,
  renderCollisionDebug,
  renderYSortDebug,
  renderProjectileCollisionDebug,
} from '../../utils/renderers/debugOverlayUtils';
import { renderTillerPreview } from '../../utils/renderers/tillerPreviewRenderingUtils';
import { renderAttackRangeDebug } from '../../utils/renderers/attackRangeDebugUtils';
import { getCollisionShapesForDebug } from '../../utils/clientCollision';
import { gameConfig } from '../../config/gameConfig';

export interface RenderTranslatedWorldExtrasOptions {
  renderPlacementGeometry?: boolean;
  ctx: CanvasRenderingContext2D;
  visibleHarvestableResourcesMap: Map<string, any>;
  visibleCampfiresMap: Map<string, any>;
  visibleFurnacesMap: Map<string, any>;
  visibleBarbecuesMap: Map<string, any>;
  fumaroles: Map<string, any>;
  visibleDroppedItemsMap: Map<string, any>;
  visibleBoxesMap: Map<string, any>;
  visiblePlayerCorpsesMap: Map<string, any>;
  stashes: Map<string, any>;
  visibleSleepingBagsMap: Map<string, any>;
  players: Map<string, any>;
  itemDefinitions: Map<string, any>;
  unifiedInteractableTarget: any;
  visibleLanternsMap: Map<string, any>;
  visibleTurretsMap: Map<string, any>;
  rainCollectors: Map<string, any>;
  brothPots: Map<string, any>;
  visibleHomesteadHearthsMap: Map<string, any>;
  visibleDoorsMap: Map<string, any>;
  alkStations: Map<string, any> | undefined;
  emptyMap: Map<string, any>;
  localPlayer: any;
  currentPredictedPosition: { x: number; y: number } | null;
  isAutoAttacking: boolean;
  isAutoWalking: boolean;
  placementInfo: any;
  buildingState: any;
  itemImagesRef: any;
  shelterImageRef: any;
  currentWorldMouseX: number | null;
  currentWorldMouseY: number | null;
  isPlacementTooFarValue: boolean;
  placementError: string | null;
  clearPlacementError: () => void;
  connection: any;
  doodadImagesRef: any;
  currentCameraOffsetX: number;
  currentCameraOffsetY: number;
  localPlayerX: number;
  localPlayerY: number;
  inventoryItems: Map<string, any>;
  foundationTileImagesRef: any;
  lastPlacementWarningRef: { current: string | null };
  setPlacementWarning: (value: string | null) => void;
  cloudsEnabled: boolean;
  clouds: Map<string, any>;
  currentInterpolatedClouds: Map<string, any>;
  cloudImagesRef: any;
  droneEvents: Map<string, any>;
  droneImageRef: any;
  nowMs: number;
  showChunkBoundaries: boolean;
  worldState: any;
  currentCanvasWidth: number;
  currentCanvasHeight: number;
  showInteriorDebug: boolean;
  resolvedBuildingClusters: Map<string, any>;
  playerBuildingClusterId: any;
  showCollisionDebug: boolean;
  trees: Map<string, any> | undefined;
  stones: Map<string, any> | undefined;
  runeStones: Map<string, any> | undefined;
  cairns: Map<string, any> | undefined;
  woodenStorageBoxes: Map<string, any>;
  furnaces: Map<string, any>;
  barbecues: Map<string, any>;
  shelters: Map<string, any>;
  wildAnimals: Map<string, any> | undefined;
  visibleAnimalCorpsesMap: Map<string, any>;
  barrels: Map<string, any> | undefined;
  roadLampposts: Map<string, any> | undefined;
  seaStacks: Map<string, any> | undefined;
  wallCells: Map<string, any> | undefined;
  foundationCells: Map<string, any> | undefined;
  homesteadHearths: Map<string, any> | undefined;
  basaltColumns: Map<string, any> | undefined;
  doors: Map<string, any> | undefined;
  lanterns: Map<string, any> | undefined;
  turrets: Map<string, any> | undefined;
  monumentParts: Map<string, any> | undefined;
  isOnSeaTileForBarrels: (worldX: number, worldY: number) => boolean;
  projectiles: Map<string, any>;
  showYSortDebug: boolean;
  currentYSortedEntities: any[];
  viewBounds: { minX: number; maxX: number; minY: number; maxY: number };
  hasStoneTiller: boolean;
  currentLocalFacingDirection?: string;
  showAttackRangeDebug: boolean;
  activeEquipments: Map<string, any>;
  campfires: Map<string, any>;
  sleepingBags: Map<string, any>;
  interpolatedGrass: any;
}

/** Clouds, drones, debug overlays — draw before GPU campfire smoke so plume can sit above world layers. */
export function renderTranslatedWorldExtrasUnderCampfireOverlay(
  opts: RenderTranslatedWorldExtrasOptions,
): void {
  const {
    ctx,
    cloudsEnabled,
    clouds,
    currentInterpolatedClouds,
    cloudImagesRef,
    currentCameraOffsetX,
    currentCameraOffsetY,
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
    localPlayer,
    currentPredictedPosition,
    trees,
    stones,
    runeStones,
    cairns,
    woodenStorageBoxes,
    rainCollectors,
    furnaces,
    barbecues,
    shelters,
    players,
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
    alkStations,
    lanterns,
    turrets,
    monumentParts,
    emptyMap,
    isOnSeaTileForBarrels,
    projectiles,
    showYSortDebug,
    currentYSortedEntities,
    viewBounds,
    hasStoneTiller,
    connection,
    currentLocalFacingDirection,
    showAttackRangeDebug,
    activeEquipments,
    itemDefinitions,
    campfires,
    sleepingBags,
    stashes,
    interpolatedGrass,
  } = opts;

  if (cloudsEnabled && clouds && clouds.size > 0 && cloudImagesRef.current) {
    renderCloudsDirectly({
      ctx,
      clouds: currentInterpolatedClouds,
      cloudImages: cloudImagesRef.current,
      worldScale: 1,
      cameraOffsetX: currentCameraOffsetX,
      cameraOffsetY: currentCameraOffsetY,
    });
  }

  if (droneEvents && droneEvents.size > 0 && droneImageRef.current) {
    const interpolatedDrones = getInterpolatedDrones(droneEvents, droneImageRef.current, nowMs);
    if (interpolatedDrones.size > 0) {
      renderDronesDirectly({
        ctx,
        drones: interpolatedDrones,
        droneImage: droneImageRef.current,
        worldScale: 1,
        cameraOffsetX: currentCameraOffsetX,
        cameraOffsetY: currentCameraOffsetY,
      });
    }
  }

  if (showChunkBoundaries && worldState) {
    renderChunkBoundaries(ctx, {
      chunkSizePx: gameConfig.chunkSizePx,
      cameraOffsetX: currentCameraOffsetX,
      cameraOffsetY: currentCameraOffsetY,
      canvasWidth: currentCanvasWidth,
      canvasHeight: currentCanvasHeight,
    });
  }

  if (showInteriorDebug && resolvedBuildingClusters.size > 0) {
    renderInteriorDebug(ctx, {
      buildingClusters: resolvedBuildingClusters,
      playerBuildingClusterId,
      foundationTileSize: gameConfig.foundationTileSize,
    });
  }

  if (showCollisionDebug && localPlayer) {
    const playerX = currentPredictedPosition?.x ?? localPlayer.positionX;
    const playerY = currentPredictedPosition?.y ?? localPlayer.positionY;
    const gameEntitiesForDebug = {
      trees: trees || emptyMap,
      stones: stones || emptyMap,
      runeStones: runeStones || emptyMap,
      cairns: cairns || emptyMap,
      boxes: woodenStorageBoxes || emptyMap,
      rainCollectors: rainCollectors || emptyMap,
      furnaces: furnaces || emptyMap,
      barbecues: barbecues || emptyMap,
      shelters: shelters || emptyMap,
      players: players || emptyMap,
      wildAnimals: wildAnimals || emptyMap,
      animalCorpses: visibleAnimalCorpsesMap || emptyMap,
      barrels: barrels || emptyMap,
      roadLampposts: roadLampposts || emptyMap,
      seaStacks: seaStacks || emptyMap,
      wallCells: wallCells || emptyMap,
      foundationCells: foundationCells || emptyMap,
      homesteadHearths: homesteadHearths || emptyMap,
      basaltColumns: basaltColumns || emptyMap,
      doors: doors || emptyMap,
      alkStations: alkStations || emptyMap,
      lanterns: lanterns || emptyMap,
      turrets: turrets || emptyMap,
      monumentParts: monumentParts ?? emptyMap,
    };

    const collisionShapes = getCollisionShapesForDebug(
      gameEntitiesForDebug,
      playerX,
      playerY,
      localPlayer.identity.toHexString(),
      isOnSeaTileForBarrels,
      viewBounds,
    );

    renderCollisionDebug(ctx, {
      playerX,
      playerY,
      localPlayerId: localPlayer.identity.toHexString(),
      collisionShapes,
    });

    renderProjectileCollisionDebug(ctx, {
      projectiles,
      playerX,
      playerY,
      currentTimeMs: performance.now(),
      viewBounds,
    });
  }

  if (showYSortDebug && localPlayer) {
    const playerX = currentPredictedPosition?.x ?? localPlayer.positionX;
    const playerY = currentPredictedPosition?.y ?? localPlayer.positionY;
    renderYSortDebug(ctx, {
      playerX,
      playerY,
      ySortedEntities: currentYSortedEntities,
      viewMinX: viewBounds.minX,
      viewMaxX: viewBounds.maxX,
      localPlayerId: localPlayer.identity?.toHexString?.(),
    });
  }

  if (hasStoneTiller && localPlayer && connection) {
    const playerX = currentPredictedPosition?.x ?? localPlayer.positionX;
    const playerY = currentPredictedPosition?.y ?? localPlayer.positionY;
    const facingDir = currentLocalFacingDirection || localPlayer.direction;
    renderTillerPreview({
      ctx,
      connection,
      playerX,
      playerY,
      facingDirection: facingDir,
    });
  }

  if (showAttackRangeDebug && localPlayer) {
    const playerX = currentPredictedPosition?.x ?? localPlayer.positionX;
    const playerY = currentPredictedPosition?.y ?? localPlayer.positionY;
    const facingDir = currentLocalFacingDirection || localPlayer.direction;
    const playerId = localPlayer.identity.toHexString();
    const equipment = activeEquipments.get(playerId);
    let equippedItemDef: any = null;
    if (equipment?.equippedItemDefId) {
      equippedItemDef = itemDefinitions.get(equipment.equippedItemDefId.toString()) || null;
    }

    renderAttackRangeDebug(
      ctx,
      {
        playerX,
        playerY,
        facingDirection: facingDir,
        localPlayerId: playerId,
        equippedItemDef,
      },
      {
        woodenStorageBoxes,
        barbecues,
        furnaces,
        campfires,
        sleepingBags,
        stashes,
        trees,
        stones,
        wildAnimals,
        players,
        barrels,
        grass: interpolatedGrass,
      },
    );
  }
}

/** Interaction labels, status tags, placement preview — draw after GPU campfire smoke. */
export function renderTranslatedWorldExtrasOverCampfireOverlay(
  opts: RenderTranslatedWorldExtrasOptions,
): void {
  const {
    ctx,
    visibleHarvestableResourcesMap,
    visibleCampfiresMap,
    visibleFurnacesMap,
    visibleBarbecuesMap,
    fumaroles,
    visibleDroppedItemsMap,
    visibleBoxesMap,
    visiblePlayerCorpsesMap,
    stashes,
    visibleSleepingBagsMap,
    players,
    itemDefinitions,
    unifiedInteractableTarget,
    visibleLanternsMap,
    visibleTurretsMap,
    rainCollectors,
    brothPots,
    visibleHomesteadHearthsMap,
    visibleDoorsMap,
    alkStations,
    emptyMap,
    localPlayer,
    currentPredictedPosition,
    isAutoAttacking,
    isAutoWalking,
    placementInfo,
    buildingState,
    itemImagesRef,
    shelterImageRef,
    currentWorldMouseX,
    currentWorldMouseY,
    isPlacementTooFarValue,
    placementError,
    clearPlacementError,
    connection,
    doodadImagesRef,
    currentCameraOffsetX,
    currentCameraOffsetY,
    localPlayerX,
    localPlayerY,
    inventoryItems,
    foundationTileImagesRef,
    lastPlacementWarningRef,
    setPlacementWarning,
  } = opts;

  renderInteractionLabels({
    ctx,
    harvestableResources: visibleHarvestableResourcesMap,
    campfires: visibleCampfiresMap,
    furnaces: visibleFurnacesMap,
    barbecues: visibleBarbecuesMap,
    fumaroles,
    droppedItems: visibleDroppedItemsMap,
    woodenStorageBoxes: visibleBoxesMap,
    playerCorpses: visiblePlayerCorpsesMap,
    stashes,
    sleepingBags: visibleSleepingBagsMap,
    players,
    itemDefinitions,
    closestInteractableTarget: unifiedInteractableTarget,
    lanterns: visibleLanternsMap,
    turrets: visibleTurretsMap,
    rainCollectors,
    brothPots,
    homesteadHearths: visibleHomesteadHearthsMap,
    doors: visibleDoorsMap,
    alkStations: alkStations || emptyMap,
  });

  if (localPlayer && !localPlayer.isDead) {
    const localPlayerScreenX = currentPredictedPosition?.x ?? localPlayer.positionX;
    const localPlayerScreenY = currentPredictedPosition?.y ?? localPlayer.positionY;
    renderLocalPlayerStatusTags({
      ctx,
      playerX: localPlayerScreenX,
      playerY: localPlayerScreenY,
      isAutoAttacking,
      isAutoWalking,
    });
  }

  if (opts.renderPlacementGeometry === false) return;
  const placementWarningResult = renderPlacementPreview({
    ctx,
    placementInfo,
    buildingState,
    itemImagesRef,
    shelterImageRef,
    worldMouseX: currentWorldMouseX,
    worldMouseY: currentWorldMouseY,
    isPlacementTooFar: isPlacementTooFarValue,
    placementError,
    onClearPlacementError: clearPlacementError,
    connection,
    doodadImagesRef,
    worldScale: 1,
    viewOffsetX: -currentCameraOffsetX,
    viewOffsetY: -currentCameraOffsetY,
    localPlayerX,
    localPlayerY,
    inventoryItems,
    itemDefinitions,
    foundationTileImagesRef,
  });
  if (placementWarningResult !== lastPlacementWarningRef.current) {
    lastPlacementWarningRef.current = placementWarningResult;
    setPlacementWarning(placementWarningResult);
  }
}

/** Full pass in legacy order (labels under clouds). Prefer split under/over + campfire overlay in the frame. */
export function renderTranslatedWorldExtras(opts: RenderTranslatedWorldExtrasOptions): void {
  renderTranslatedWorldExtrasOverCampfireOverlay(opts);
  renderTranslatedWorldExtrasUnderCampfireOverlay(opts);
}
