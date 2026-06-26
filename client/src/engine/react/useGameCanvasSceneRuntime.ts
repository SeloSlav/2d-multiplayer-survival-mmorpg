import { useEngineSnapshot } from './useEngineSnapshot';
import { useUITable } from './selectors';
import { useGameScreenWorldTables } from './selectors/useGameScreenWorldTables';
import { assembleGameCanvasSceneSnapshot } from '../runtime/assembleGameCanvasSceneSnapshot';
import type { GameCanvasRuntimeHost, GameCanvasRuntimeSceneSnapshot } from '../runtime/GameCanvasRuntimeHost';
import type { GameCanvasPointerSnapshot } from '../runtime/gameCanvasPointerRuntime';

/**
 * Temporary React adapter for canvas scene state.
 *
 * This still owns hook-bound table subscriptions, world lookups, and frame
 * assembly, but host-owned services now produce cloud/grass/tree animation.
 * The next extraction step is to split this into a React data adapter plus a
 * pure scene snapshot assembler.
 */
const EMPTY_MAP = new Map();

interface UseGameCanvasSceneRuntimeOptions {
  host: GameCanvasRuntimeHost;
  connection: any | null;
  localPlayerId?: string;
  localPlayer: any;
  predictedPosition: { x: number; y: number } | null;
  cameraOffsetX: number;
  cameraOffsetY: number;
  canvasSize: { width: number; height: number };
  pointerSnapshot: GameCanvasPointerSnapshot;
}

export function useGameCanvasSceneRuntime({
  host,
  connection,
  localPlayerId,
  localPlayer,
  predictedPosition,
  cameraOffsetX,
  cameraOffsetY,
  canvasSize,
  pointerSnapshot,
}: UseGameCanvasSceneRuntimeOptions): GameCanvasRuntimeSceneSnapshot {
  const tables = useGameScreenWorldTables();
  const messages = useUITable<Map<string, any>>('messages');
  const playerPins = useUITable<Map<string, any>>('playerPins');
  const activeConnections = useUITable<Map<string, any> | undefined>('activeConnections');
  const matronages = useUITable<Map<string, any>>('matronages');
  const matronageMembers = useUITable<Map<string, any>>('matronageMembers');
  const matronageInvitations = useUITable<Map<string, any>>('matronageInvitations');
  const matronageOwedShards = useUITable<Map<string, any>>('matronageOwedShards');
  const beaconDropEvents = useUITable<Map<string, any>>('beaconDropEvents');
  const worldChunkDataMap = useEngineSnapshot(
    (snapshot) => snapshot.world.chunkDataMap as Map<string, any> | null,
  ) ?? undefined;

  const { interpolatedClouds, interpolatedGrass } = host.configureSceneInterpolationRuntime({
    clouds: tables.clouds,
    grass: tables.grass,
    grassState: tables.grassState,
  });

  const {
    isTreeFalling,
    getFallProgress,
    TREE_FALL_DURATION_MS,
  } = host.configureFallingTreeAnimationRuntime(tables.trees);

  const worldLookups = host.configureWorldLookupRuntime({
    worldChunkDataMap,
    cameraOffsetX,
    cameraOffsetY,
    canvasWidth: canvasSize.width,
    canvasHeight: canvasSize.height,
    localPlayer,
  });

  const frameAssembly = host.configureFrameAssemblyRuntime({
    connection,
    players: tables.players,
    trees: tables.trees,
    stones: tables.stones,
    runeStones: tables.runeStones,
    cairns: tables.cairns,
    campfires: tables.campfires,
    furnaces: tables.furnaces,
    barbecues: tables.barbecues,
    lanterns: tables.lanterns,
    turrets: tables.turrets,
    homesteadHearths: tables.homesteadHearths,
    harvestableResources: tables.harvestableResources,
    droppedItems: tables.droppedItems,
    woodenStorageBoxes: tables.woodenStorageBoxes,
    sleepingBags: tables.sleepingBags,
    playerCorpses: tables.playerCorpses,
    stashes: tables.stashes,
    cameraOffsetX,
    cameraOffsetY,
    canvasWidth: canvasSize.width,
    canvasHeight: canvasSize.height,
    interpolatedGrass,
    projectiles: tables.projectiles,
    shelters: tables.shelters,
    clouds: tables.clouds,
    plantedSeeds: tables.plantedSeeds,
    rainCollectors: tables.rainCollectors,
    brothPots: tables.brothPots,
    wildAnimals: tables.wildAnimals,
    animalCorpses: tables.animalCorpses,
    barrels: tables.barrels,
    roadLampposts: tables.roadLampposts ?? EMPTY_MAP,
    fumaroles: tables.fumaroles,
    basaltColumns: tables.basaltColumns,
    seaStacks: tables.seaStacks,
    foundationCells: tables.foundationCells,
    wallCells: tables.wallCells,
    doors: tables.doors,
    fences: tables.fences,
    localPlayerId,
    isLocalPlayerSnorkeling: localPlayer?.isSnorkeling ?? false,
    predictedPosition: predictedPosition ? { x: predictedPosition.x, y: predictedPosition.y } : null,
    isTreeFalling,
    worldChunkDataMap,
    alkStations: tables.alkStations ?? EMPTY_MAP,
    monumentParts: tables.monumentParts ?? EMPTY_MAP,
    livingCorals: tables.livingCorals,
    seaTransitionTileLookup: worldLookups.seaTransitionTileLookup,
    waterTileLookup: worldLookups.waterTileLookup,
    worldState: tables.worldState,
    firePatches: tables.firePatches,
    activeEquipments: tables.activeEquipments,
    itemDefinitions: tables.itemDefinitions,
    worldMouseX: pointerSnapshot.worldMousePos.x ?? 0,
    worldMouseY: pointerSnapshot.worldMousePos.y ?? 0,
    roadLamppostsAll: tables.roadLampposts ?? EMPTY_MAP,
    barrelsAll: tables.barrels ?? EMPTY_MAP,
  });

  return assembleGameCanvasSceneSnapshot({
    tables,
    uiTables: {
      messages,
      playerPins,
      activeConnections,
      matronages,
      matronageMembers,
      matronageInvitations,
      matronageOwedShards,
      beaconDropEvents,
    },
    worldChunkDataMap,
    interpolatedClouds,
    interpolatedGrass,
    worldLookups,
    frameAssembly,
    treeAnimation: {
      isTreeFalling,
      getFallProgress,
      TREE_FALL_DURATION_MS,
    },
  });
}
