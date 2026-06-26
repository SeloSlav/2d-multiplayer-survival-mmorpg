/**
 * Frame assembly hook that composes filtering, interpolation, lighting,
 * projectile presentation, and runtime frame publication into one
 * engine-owned boundary.
 */
import { useMemo } from 'react';
import { remotePlayerInterpolationRuntime } from '../runtime/remotePlayerInterpolator';
import type { GameCanvasRuntimeHost } from '../runtime/GameCanvasRuntimeHost';

interface UseFrameAssemblyOptions {
  host: GameCanvasRuntimeHost;
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

export function useFrameAssembly(options: UseFrameAssemblyOptions) {
  const remotePlayerInterpolation = remotePlayerInterpolationRuntime;

  const filtering = options.host.configureEntityFilteringRuntime(
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
    options.waterTileLookup
  );

  const stablePredictedPosition = useMemo(() => {
    if (!options.predictedPosition) return null;
    return { x: options.predictedPosition.x, y: options.predictedPosition.y };
  }, [options.predictedPosition?.x, options.predictedPosition?.y]);

  const { overlayRgba, maskCanvasRef, redrawMask } = options.host.configureDayNightCycleRuntime({
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
    predictedPosition: stablePredictedPosition,
    remotePlayerInterpolation,
    buildingClusters: filtering.buildingClusters,
    worldMouseX: options.worldMouseX,
    worldMouseY: options.worldMouseY,
  });

  const renderableProjectiles = options.host.configureProjectilePresentationRuntime({
    connection: options.connection,
    authoritativeProjectiles: options.projectiles,
  });

  const corpseSourceAnimalIds = useMemo(() => {
    const ids = new Set<string>();
    filtering.visibleAnimalCorpsesMap.forEach((corpse: any) => {
      ids.add(corpse.animalId.toString());
    });
    return ids;
  }, [filtering.visibleAnimalCorpsesMap]);

  const finalizedYSortedEntities = useMemo(() => {
    const withoutReplacedAnimals =
      corpseSourceAnimalIds.size === 0
        ? filtering.ySortedEntities
        : filtering.ySortedEntities.filter((entity: any) => {
            if (entity.type !== 'wild_animal') return true;
            return !corpseSourceAnimalIds.has(entity.entity.id.toString());
          });

    const withProjectiles = withoutReplacedAnimals.filter((entity: any) => entity.type !== 'projectile');
    renderableProjectiles.forEach((projectile) => {
      withProjectiles.push({ type: 'projectile', entity: projectile } as any);
    });
    return withProjectiles;
  }, [corpseSourceAnimalIds, filtering.ySortedEntities, renderableProjectiles]);

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
