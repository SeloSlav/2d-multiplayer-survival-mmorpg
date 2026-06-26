import { useSyncExternalStore, type MutableRefObject } from 'react';
import type {
  BuildingPlacementActions,
  BuildingPlacementState,
} from '../runtime/buildingPlacementRuntime';
import type { GameCanvasRuntimeHost } from '../runtime/GameCanvasRuntimeHost';
import type { GameCanvasPointerSnapshot } from '../runtime/gameCanvasPointerRuntime';
import type { GameCanvasBuildTargetingSnapshot } from '../runtime/gameCanvasBuildTargetingRuntime';

interface UseGameCanvasBuildStateOptions {
  host: GameCanvasRuntimeHost;
  connection: any | null;
  predictedPosition: { x: number; y: number } | null;
  localPlayer: any;
  activeEquipments: Map<string, any>;
  itemDefinitions: Map<string, any>;
  localPlayerId?: string;
  foundationCells?: Map<string, any>;
  fences?: Map<string, any>;
  pointerSnapshot: GameCanvasPointerSnapshot;
  buildTargetingRef: MutableRefObject<GameCanvasBuildTargetingSnapshot>;
}

interface UseGameCanvasBuildStateResult {
  worldMousePos: { x: number | null; y: number | null };
  canvasMousePos: { x: number | null; y: number | null };
  buildingState: BuildingPlacementState;
  buildingActions: BuildingPlacementActions;
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

export function useGameCanvasBuildState({
  host,
  connection,
  predictedPosition,
  localPlayer,
  activeEquipments,
  itemDefinitions,
  localPlayerId,
  foundationCells,
  fences,
  pointerSnapshot,
  buildTargetingRef,
}: UseGameCanvasBuildStateOptions): UseGameCanvasBuildStateResult {
  useSyncExternalStore(
    host.subscribeToBuildingPlacementRuntime,
    host.getBuildingPlacementRuntimeVersion,
    host.getBuildingPlacementRuntimeVersion,
  );

  const worldMousePos = pointerSnapshot.worldMousePos;
  const canvasMousePos = pointerSnapshot.canvasMousePos;

  const localPlayerX = predictedPosition?.x ?? localPlayer?.positionX ?? 0;
  const localPlayerY = predictedPosition?.y ?? localPlayer?.positionY ?? 0;

  const placementRuntime = host.configureBuildingPlacementRuntime({
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

  const buildTargeting = buildTargetingRef.current;

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
