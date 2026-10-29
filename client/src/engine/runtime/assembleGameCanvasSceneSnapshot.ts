import type { GameCanvasRuntimeSceneSnapshot } from './GameCanvasRuntimeHost';

const EMPTY_MAP = new Map();

interface AssembleGameCanvasSceneSnapshotOptions {
  tables: Record<string, any>;
  uiTables: {
    messages: Map<string, any>;
    playerPins: Map<string, any>;
    activeConnections: Map<string, any> | undefined;
    matronages: Map<string, any>;
    matronageMembers: Map<string, any>;
    matronageInvitations: Map<string, any>;
    matronageOwedShards: Map<string, any>;
    beaconDropEvents: Map<string, any>;
  };
  worldChunkDataMap: Map<string, any> | undefined;
  interpolatedClouds: Map<string, any>;
  interpolatedGrass: Map<string, any>;
  worldLookups: Record<string, any>;
  frameAssembly: Record<string, any>;
  treeAnimation: {
    fallingTrees: Map<string, import('./fallingTreeAnimationRuntime').FallingTreeState>;
    isTreeFalling: (treeId: string) => boolean;
    getFallProgress: (treeId: string) => number;
    TREE_FALL_DURATION_MS: number;
  };
}

function buildShipwreckPartsMap(monumentParts: Map<string, any> | undefined) {
  if (!monumentParts) {
    return EMPTY_MAP;
  }

  const filtered = new Map();
  monumentParts.forEach((part: any, id: string) => {
    if (part.monumentType?.tag === 'Shipwreck') {
      filtered.set(id, part);
    }
  });
  return filtered;
}

export function assembleGameCanvasSceneSnapshot({
  tables,
  uiTables,
  worldChunkDataMap,
  interpolatedClouds,
  interpolatedGrass,
  worldLookups,
  frameAssembly,
  treeAnimation,
}: AssembleGameCanvasSceneSnapshotOptions): GameCanvasRuntimeSceneSnapshot {
  return {
    ...tables,
    ...uiTables,
    worldChunkDataMap,
    interpolatedClouds,
    interpolatedGrass,
    shipwreckPartsMap: buildShipwreckPartsMap(tables.monumentParts),
    ...treeAnimation,
    ...worldLookups,
    ...frameAssembly,
    resolvedOverlayRgba: frameAssembly.overlayRgba,
    resolvedBuildingClusters: frameAssembly.buildingClusters,
    resolvedYSortedEntities: frameAssembly.ySortedEntities,
    resolvedSwimmingPlayersForBottomHalf: frameAssembly.swimmingPlayersForBottomHalf,
    resolvedMaskCanvas: frameAssembly.maskCanvasRef.current,
  };
}
