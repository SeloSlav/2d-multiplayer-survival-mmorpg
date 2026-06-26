# Engine Runtime Modules

Runtime modules own subscriptions, table bindings, and side effects. React hooks orchestrate; runtime modules execute.

## Game Canvas Runtime Host

`GameCanvasRuntimeHost` is the first non-React ownership boundary for the canvas game loop.

- React still gathers hook-bound scene/controller data in `GameCanvas`.
- The host now owns the imperative render context, frame bindings, and `RuntimeFramePipeline`.
- The host also owns typed scene/controller/particle/ambient-effects snapshots plus the mutable controller frame-state ref bag that render + frame code read from.
- `GameCanvas` now synchronizes those host-owned surfaces directly through host configuration methods.
- `useGameCanvasOverlayRuntime()` now owns hover and overlay prop shaping so `GameCanvas` stays closer to shell/view composition.
- The host assembles frame bindings directly from the controller snapshot, while `GameCanvas` reads the tiny view-facing controller fields it still needs.
- `configureGameCanvasRenderRuntime` configures render context in `engine/runtime/`; `useGameCanvasFramePipeline` remains the React lifecycle mount for the host frame pipeline.

### Current Migration Status

1. **render/frame ownership**: moved behind `GameCanvasRuntimeHost`
2. **scene assembly**: split into `useGameCanvasSceneRuntime()` data reads + pure `assembleGameCanvasSceneSnapshot()`, with a typed host scene snapshot
3. **controller state**: host owns the mutable frame-state refs, typed controller snapshot, and frame bindings, while build/interaction logic is still temporarily hook-bound
4. **effects runtime**: particle production, non-audio ambient effects, and ambient audio are host-owned services fed by typed host snapshots

## Current Architecture

| Module | Responsibility |
|--------|----------------|
| `gameplaySubscriptionsRuntime` | Spatial + non-spatial chunk subscriptions, viewport sync |
| `gameplayEventEffectsRuntime` | Grass cut effects, cairn unlock sounds |
| `uiSubscriptionsRuntime` | UI-only tables (messages, pins, quests, matronage) |
| `worldChunkDataRuntime` | Chunk data map for tile lookups |

## useSpacetimeTables Split Strategy

`useSpacetimeTables` (~2000 lines) is the monolithic subscription orchestrator. Target: reduce to <200 lines.

### Extraction Order

1. **Table binding handlers** → `engine/adapters/spacetime/gameplayTableBindingHandlers.ts`
   - Factory: `createGameplayTableBindings(ctx: GameplayTableBindingContext) => GameplayTableBindings`
   - Context: setters from `useEngineWorldTableState`, refs, connection, cancelPlacement
   - Domain groups already defined in `gameplayTableBindings.ts`: progression, structures, items, world, combat, social

2. **Effect triggers** → `gameplayEventEffectsRuntime` or `gameplayEventEffectsRuntime.ts`
   - Explosion, barrel destruction, animal corpse effects
   - Hostile encounter tutorial dispatch

3. **Thin hook** → `useSpacetimeTables` becomes:
   - `useEngineWorldTableState` for each table
   - Call `createGameplayTableBindings(ctx)` with context
   - Call `setupGameplayConnection({ connection, tableBindings })`
   - Delegate spatial sync to `gameplaySubscriptionsRuntime.sync()`

### Dead Code Removed

- `useUISubscriptions.ts` – deleted; UI tables handled by `uiSubscriptionsRuntime`

### Domain Slices (from gameplayTableBindings)

- **progression**: player_stats, achievements, notifications, ALK, plants
- **structures**: campfires, storage, shelters, placeables
- **items**: item_def, inventory, equipment, recipes
- **world**: trees, stones, grass, weather, monuments
- **combat**: players, projectiles, animals, fishing
- **social**: player_corpse
