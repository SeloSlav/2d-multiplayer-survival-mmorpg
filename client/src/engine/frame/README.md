# Frame Assembly

Frame assembly produces the render-ready data consumed by GameCanvas each frame:
- Viewport-culled visible entities
- Y-sorted draw order
- Remote player interpolation
- Day/night mask and overlay

## Current State

- `EntityFilteringRuntime` (engine/runtime/): viewport culling + Y-sort
- `remotePlayerInterpolationRuntime` (engine/runtime/): remote player positions
- `DayNightCycleRuntime` (engine/runtime/): overlay RGBA, mask canvas
- `useRuntimeFrameBridge` (engine/react/): pushes frame data to runtime store
- `GameCanvasRuntimeHost.configureFrameAssemblyRuntime` (engine/runtime/): composes filtering + interpolation + lighting

## Extraction Strategy

1. **Stage 1 (done)**: Establish frame module boundary; GameCanvas remains consumer
2. **Stage 2 (done)**: Move entity filtering behind a runtime service
3. **Stage 3 (done)**: Compose EntityFilteringRuntime + remotePlayerInterpolationRuntime + DayNightCycleRuntime behind the host
4. **Stage 4**: Move table-backed scene snapshot production out of the React adapter

## Contract

- **FrameInput**: Entity maps, viewport, camera offset, local player, predicted position
- **FrameOutput**: visibleEntities, ySortedEntities, remotePlayerPositions, overlayRgba, maskCanvas
