# Bird movement and facing

A local 14-second capture found a tern changing heading 127 times without any
position change. It remained Grounded throughout: the blocked walking recovery
picked a new random direction each AI tick. Another bird remained Fleeing without
moving near an ALK boundary. These were movement failures, not animation states
indicating meaningful travel.

The shared crow/tern/owl paths now:

- Take off when ground movement is blocked, keeping a reachable flight leg.
- Stop flight steps at their destination instead of overshooting and reversing.
- Use longer patrol legs, a minimum airborne interval and elapsed-time event rates.
- Retain an existing flee destination while it still leads away from the threat.
- Keep flee completion targets within the same world bounds used for movement.
- Choose flight segments outside ALK exclusions and take an outward escape leg
  when a pursuit is blocked by a compound boundary.

The 3D rig uses actual displayed travel direction for moving birds. Stationary
birds retain their body heading, allowing head/idle motion without spinning.
Hovering wings use a continuous 0.67 Hz cycle, easing up to about 1.9 Hz during
travel; changing speed does not restart the cycle. Flight and walking turn rates
are bounded separately. Bees and the other animal families retain their own rigs.

Regression checks cover close-destination overshoot, world-edge/compound goals,
time-based event rates, stationary intent changes, real-motion heading ownership,
turn limits and continuous wing cycles at 30/60 FPS. An isolated WebGPU fixture
captures both species hovering and travelling under changing AI heading inputs.

Validation: 149 world/animation tests, 10 Rust contracts, TypeScript and the WASM
build pass. Nine WebGPU frames retain stationary headings and follow real travel
without runtime errors. Published to the existing local database with data
preserved; localhost web/HMR checks pass. The post-publication live sample had no
active crows/terns: the closest was 4,314 world pixels from the online player,
outside their active simulation area, so it does not establish a live AI result.
