import { evaluatePlacementPreview, isPlacementTooFar } from './placementValidation';
import type { PlacementEvaluationInput, PlacementPreviewPlan } from './placementValidation';
import type { GameCanvasRuntimeRenderContext } from '../runtime/GameCanvasRuntimeHost';

interface PlacementContext extends Pick<PlacementEvaluationInput, 'placementInfo' | 'buildingState' | 'connection' | 'placementError' | 'inventoryItems' | 'itemDefinitions'> {
  worldMousePosRef: { current: { x: number | null; y: number | null } };
  predictedPositionRef: { current: { x: number; y: number } | null };
  localPlayer?: { positionX: number; positionY: number };
  clearPlacementError?: () => void;
  placementActions?: { clearPlacementError: () => void };
  lastPlacementWarningRef?: { current: string | null };
  setPlacementWarning?: (warning: string | null) => void;
}

/** Feed the original placement feedback callbacks without drawing a 2D ghost. */
export function evaluateGameCanvasPlacement(context: GameCanvasRuntimeRenderContext): PlacementPreviewPlan | null {
  const args = context as unknown as PlacementContext;
  const pointer = args.worldMousePosRef.current;
  const playerX = args.predictedPositionRef.current?.x ?? args.localPlayer?.positionX ?? 0;
  const playerY = args.predictedPositionRef.current?.y ?? args.localPlayer?.positionY ?? 0;
  const plan = evaluatePlacementPreview({ ...args, worldMouseX: pointer.x, worldMouseY: pointer.y,
    localPlayerX: playerX, localPlayerY: playerY,
    isPlacementTooFar: pointer.x !== null && pointer.y !== null && isPlacementTooFar(args.placementInfo, playerX, playerY, pointer.x, pointer.y) });
  if (plan?.clearError) (args.placementActions?.clearPlacementError ?? args.clearPlacementError)?.();
  const warning = plan?.warning ?? null;
  if (args.lastPlacementWarningRef && args.lastPlacementWarningRef.current !== warning) {
    args.lastPlacementWarningRef.current = warning;
    args.setPlacementWarning?.(warning);
  }
  return plan;
}
