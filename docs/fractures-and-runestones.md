# 3D barrel fracture and runestone presentation

Destructible barrel variants 0–5 share a precut 18-cell Voronoi partition of
the actual model. Closed cut faces retain volume, while exterior faces keep
the original paint, metal bands and label. Variant 6 navigation buoys do not
fracture. Cells tumble, bounce once, settle on their rotated support and shrink
out over the final 400ms of a two-second lifetime. Floating containers start
from their visible bob/tilt and sink toward the seabed instead of bouncing on
the waterline. These are visual fragments; authoritative loot is unchanged.

The gameplay effect runtime binds live barrel updates/deletes for both
renderers. Dead subscription snapshots and subscribe/unsubscribe events do
not trigger breaks. A bounded event queue deduplicates update/delete delivery
while allowing the same barrel to break after respawning. The renderer
resolves the previous visual pose before removing the destroyed model and
rejects concealed, underwater-view and off-screen events.

Each cell has one instanced mesh serving up to 12 simultaneous bursts. Geometry,
motion storage and instance attributes are created once. Custom instance
buffers opt into per-object asynchronous pipeline preparation, preventing
17 sibling cells from compiling synchronously on the first break.

Runestones use twice their previous model scale. This approximates the painted
150px-wide silhouette inside the 2D renderer's 300px sprite. Glyph materials
remain separate through static compilation. The 2D green/red/blue palettes and
shared dusk/dawn thresholds drive emissive inscriptions, 18 slow rising motes,
a soft ground pool and an actual point light in the existing eight-light
budget. The light affects terrain, props, vegetation and actors. Dawn fades
continuously across the cycle boundary. Daytime inscriptions retain their
pigment with zero emission. The larger stone has a corresponding vertical
culling allowance; authoritative collision rules are unchanged.

Validation: `npm run test:world3d` covers volume conservation, Voronoi cell
membership, exterior pigments, pose reconstruction, deterministic motion,
floor contact, bounded/dense pools, disposal, live event delivery, all three
rune palettes, day/night continuity, compiled emission and culling. Isolated
WebGPU previews additionally exercise real materials, full renderer events,
land/floating origins, illumination and asynchronous fragment preparation.
