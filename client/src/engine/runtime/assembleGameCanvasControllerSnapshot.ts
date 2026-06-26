import type { GameCanvasRuntimeControllerSnapshot, GameCanvasRuntimeHost } from './GameCanvasRuntimeHost';

interface AssembleGameCanvasControllerSnapshotOptions {
  host: GameCanvasRuntimeHost;
  buildState: Record<string, any>;
  interactionRuntime: Record<string, any>;
  controllerAdjunctState: Record<string, any>;
}

export function assembleGameCanvasControllerSnapshot({
  host,
  buildState,
  interactionRuntime,
  controllerAdjunctState,
}: AssembleGameCanvasControllerSnapshotOptions): GameCanvasRuntimeControllerSnapshot {
  return {
    ...buildState,
    ...interactionRuntime,
    ...controllerAdjunctState,
    ...host.getControllerRefs(),
  } as GameCanvasRuntimeControllerSnapshot;
}
