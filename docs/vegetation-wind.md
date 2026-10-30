# Shared vegetation wind

`vegetationWind.ts` defines one weather profile and continuous phase per world
chunk. `VegetationWind3d` updates that shared field and all living vegetation
samples it at its world position. The root and petiole weights stay attached to
the authored geometry; instance transforms and collision positions stay fixed.

| Weather | Base cycle | Grass cycle | Relative force |
| --- | ---: | ---: | ---: |
| Clear | 10 s | 8.7 s | 0.16 |
| Light rain | 8 s | 7.0 s | 0.30 |
| Moderate rain | 6.25 s | 5.4 s | 0.55 |
| Heavy rain | 4.76 s | 4.1 s | 0.82 |
| Heavy storm | 3.57 s | 3.1 s | 1.15 |

Grass has a 1.15 cadence multiplier, shrubs 1.05, and tree/plant foliage 1.0.
All share gusts and direction. Cadence and force ease toward new weather values
and phase is integrated, so transitions never restart a sway. Individual legacy
grass speeds are used by the 2D renderer; they no longer become unrestricted 3D
frequencies.

Coverage includes grass clumps, beach grass, bushes/brambles, crops and forage,
tree crowns, kelp and seaweed, and attached ALK/village foliage. Rigid roofs,
snow, stones, shells, and dead ground litter retain zero wind weights. The
Vegetation Animation setting controls the whole field.

The 50 by 50 chunk field contains 40 KB of uniform data (Three.js may create
bindings per draw pipeline). Normal frames update field values without
rebuilding vegetation geometry or instance placement.

Validation: 143 world/animation tests and TypeScript compilation pass. An
isolated WebGPU scene containing grass, shrubs, a tree, forage and kelp renders
clear, light/moderate rain and storm conditions without runtime errors. Light
rain settles at 0.125 Hz; disabling vegetation animation produces identical
frames. Fixed-camera near/design/far views, wind-weight diagnostics and seeds
1, 42 and 999999 preserve the authored shapes. The validation scene has no
post-processing; its first recorded frame contains 7 draws and 8,683 triangles.
