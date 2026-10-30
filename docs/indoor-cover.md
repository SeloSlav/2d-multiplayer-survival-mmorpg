# Indoor cover

`server/src/indoors.rs` owns indoor checks for the existing `Player.is_inside_building`
flag, rain protection, and wildlife damage. It includes living shelters, enclosed
player foundations, the 13 authored village/hermit/shack/station footprints, and
the existing shipwreck protection zones. Village checks use the shared 3D model
dimensions, front-sill anchors, rotation and elliptical round-hut footprints;
the old 450-pixel monument spawn exclusion radius does not grant indoor safety.

Indoor players keep the existing reduced cold drain and receive the Indoors UI
status. Both wetness/effect update paths use the same check. Wildlife drops
indoor targets; melee effects, NPC projectile impacts, proactive/retaliatory
ranged fire and jellyfish shocks independently reject indoor players. Player
versus player combat rules are unchanged.

Foundation enclosure uses actual square/triangle edges and edge-connected
clusters. Complementary triangles share their diagonal; rooms which touch only
at a corner stay separate. The existing 70% perimeter-wall threshold is retained.

Outdoor ambience fades to 18% gain with an 800 Hz low-pass over one second.
The audio parameter ramp is anchored to its current value on every doorway
transition. Newly created loops and random calls start with current acoustics;
underwater filtering takes precedence and restores indoor acoustics on surfacing.
Music/entrainment and underwater-specific ambience keep their own rules.

Village portals subtract intersecting wood, windows, braces and low roofing from
a 1.98-tile-high passage. Earthen sills and darker interior boards distinguish
the opening from a closed wooden panel. Existing cutaways continue to reveal
the room once entered.

Wild grass/plants and world loot spawn/respawn paths reject village interiors,
shelter footprints and active foundation cells. World-spawn clearance extends
32 pixels beyond village walls. On connection and shelter/foundation placement,
existing wild growth is removed and world barrels/containers are moved to clear
nearby land with their loot intact. Player-owned containers and planted crops
are preserved.

Validation covers all 13 entrances with ray casts through the player passage,
rotated/round inside/outside checks, square/triangle perimeter contracts, rain
suppression, reversible audio automation, WebGPU outside/cutaway captures and
measured OfflineAudioContext output (indoor/outdoor RMS ratio 0.18).

Local verification: 147 world/animation tests, 8 audio tests, 5 production Rust
geometry contracts, TypeScript and the WASM build pass. After publishing without
data deletion, a real game WebSocket connection triggered the repair. The local
audit covered all 13 village buildings and 16 active foundation cells across
40 chunks: 105 grass rows, 42 wild resources, 43 barrels and 10 world loot boxes
were checked, with zero indoor violations. No players were online during that
audit; it verifies world placement rather than a live player's status display.
