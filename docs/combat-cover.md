# Natural combat cover

Open terrain receives sparse, deterministic destructible barricades:

| Terrain | Cover |
| --- | --- |
| Grass, forest, dirt | Mossy fallen timber |
| Beach, sand | Bleached driftwood |
| Tundra, tundra grass | Lichen-covered rubble |
| Alpine | Snow-dusted scree |
| Quarry | Fractured basalt |

Balance and dimensions live in `shared/config/combatCover.json`. Each barricade
has 600 health and takes at most 150 damage per hit, including explosive damage.
That guarantees at least four heavy hits from full health. Weaker weapons apply
their ordinary damage. Natural cover produces no barrel loot or achievements.

The server uses the existing barrel table, variants 7–11, so no generated binding
or database schema migration is needed. Its existing 30-second scheduler seeds
older worlds automatically after the module is deployed. Candidates occur once
per 18×18-tile cell and reject water, roads, nearby trees/stones/props, buildings,
monuments, players and wildlife. Existing rows, including destroyed ones, prevent
duplicate seeding.

Destroyed cover is eligible to return at full health after ten minutes. The
existing scheduler activates respawns within 2,000 pixels of an online player;
cover waits if a player is within 200 pixels, wildlife is within 150 pixels, or
construction occupies its footprint. Clearing a barricade therefore permits
building over its site without later regrowth inside the structure.

Client movement and server projectiles use the same rectangular ground footprint.
Projectile collision includes height: torso shots hit cover, while shots over
the top or around either end can pass. Melee hits stop at the first barricade.
Ground wildlife routes around it. Crouched players behind it can break initial
apparition sight; an existing chase retains its target memory.

The five models compile their colors into vertex attributes for static batching.
Wood splinters and rock chips share a bounded 144-piece pool and expire after
2.4 seconds. The explicit legacy renderer has a matching fallback silhouette.

## Verification

- `cargo test --offline --manifest-path scripts/collision-contract/Cargo.toml`:
  durability, height-aware cover and existing collision contracts.
- `npm run test:world3d`: model dimensions, torso occlusion, predicted movement,
  destroy/respawn collision transitions, and bounded debris, alongside existing
  rendering tests.
- `cargo check --offline --target wasm32-unknown-unknown` from `server`.
- TypeScript compilation and Vite production bundle with `SKIP_PRERENDER=1`.
- `/engine-lab.html?scene=natural` shows all five production models. Reviewed at
  design/far scale in lit and unlit views, and near scale in geometry mode.
  Seed 73021 and stress seed 4294967295 are reproducible. These props add no
  render targets. Inspection CPU timing is not a GPU timing measurement.

The stock `npm run build` prebuild guard currently rejects unrelated entries in
the existing `.webgpu-ui-lock.local` snapshot. This change does not refresh or
weaken that lock. The optional Puppeteer prerender also cannot launch Chromium
in this environment; the game bundle is checked with the existing skip flag.
Server deployment and a live multiplayer playtest are separate
from the local compile, regression, and inspection checks.
