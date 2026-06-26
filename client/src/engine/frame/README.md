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
- `useFrameAssembly` (engine/react/): composes filtering + interpolation + lighting + runtime publication

## Extraction Strategy

1. **Stage 1 (done)**: Establish frame module boundary; GameCanvas remains consumer
2. **Stage 2 (done)**: Move entity filtering behind a runtime service
3. **Stage 3 (done)**: Compose EntityFilteringRuntime + remotePlayerInterpolationRuntime + DayNightCycleRuntime into single useFrameAssembly hook in engine/react
4. **Stage 4**: Produce frame snapshot in engine; GameCanvas becomes thin host over engine-prepared data

## Contract

- **FrameInput**: Entity maps, viewport, camera offset, local player, predicted position
- **FrameOutput**: visibleEntities, ySortedEntities, remotePlayerPositions, overlayRgba, maskCanvas
