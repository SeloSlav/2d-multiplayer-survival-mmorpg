//! One definition of indoor cover for weather, wildlife and world spawns.
use spacetimedb::{ReducerContext, Table};
use crate::monument_part as MonumentPartTable;
use crate::shelter::shelter as ShelterTable;
use crate::building::foundation_cell as FoundationTable;

pub fn is_in_village(ctx: &ReducerContext, x: f32, y: f32) -> bool {
    ctx.db.monument_part().iter().any(|part| {
        let asset = part.image_path.rsplit(['/', '\\']).next().unwrap_or("");
        crate::collision_geometry::village_contains(asset, part.world_x, part.world_y, part.rotation_rad, x, y, 0.0)
    })
}

pub fn is_position_indoors(ctx: &ReducerContext, x: f32, y: f32) -> bool {
    is_in_village(ctx, x, y)
        || ctx.db.shelter().iter().any(|s| !s.is_destroyed && crate::shelter::is_player_inside_shelter(x, y, &s))
        || crate::building_enclosure::is_position_inside_building(ctx, x, y)
        || crate::shipwreck::is_position_protected_by_shipwreck(ctx, x, y)
}

/// Foundations block natural growth even before a room has enough walls.
/// This does not restrict deliberately placed storage or player-grown crops.
pub fn blocks_world_spawn(ctx: &ReducerContext, x: f32, y: f32) -> bool {
    let tile = crate::building::FOUNDATION_TILE_SIZE_PX as f32;
    ctx.db.foundation_cell().idx_cell_coords().filter(((x / tile).floor() as i32, (y / tile).floor() as i32)).any(|f| !f.is_destroyed)
        || ctx.db.shelter().iter().any(|s| !s.is_destroyed && crate::shelter::is_player_inside_shelter(x, y, &s))
        || ctx.db.monument_part().iter().any(|part| {
            let asset = part.image_path.rsplit(['/', '\\']).next().unwrap_or("");
            crate::collision_geometry::village_contains(asset, part.world_x, part.world_y, part.rotation_rad, x, y, 32.0)
        })
}

/// Repair existing worlds without destroying player storage, crops or loot.
/// Called on connection; normal spawn/respawn paths also reject indoor sites.
pub fn repair_world_spawns(ctx: &ReducerContext) {
    use crate::grass::{grass as GrassTable, grass_state as GrassStateTable};
    use crate::harvestable_resource::harvestable_resource as PlantTable;
    use crate::barrel::barrel as BarrelTable;
    use crate::wooden_storage_box::wooden_storage_box as BoxTable;
    // Take one footprint snapshot instead of scanning buildings per grass blade.
    let village: Vec<_> = ctx.db.monument_part().iter().filter(|p| {
        crate::collision_geometry::COLLISION_GEOMETRY.village.buildings.contains_key(p.image_path.rsplit(['/', '\\']).next().unwrap_or(""))
    }).collect();
    let shelters: Vec<_> = ctx.db.shelter().iter().filter(|s| !s.is_destroyed).collect();
    let floors: std::collections::HashSet<_> = ctx.db.foundation_cell().iter().filter(|f| !f.is_destroyed).map(|f| (f.cell_x, f.cell_y)).collect();
    // Only inspect chunks touched by a footprint. Connections and building
    // placement must not walk every grass/plant row across the whole world.
    let mut chunks = std::collections::BTreeSet::new();
    let mut bounds = |left:f32, top:f32, right:f32, bottom:f32| {
        let size=crate::environment::CHUNK_SIZE_PX;
        // Include bottom-anchored props whose visible center lies 48px north.
        let (left,top,right,bottom)=(left-64.0,top-64.0,right+64.0,bottom+64.0);
        for cy in ((top/size).floor() as i32).max(0)..=((bottom/size).floor() as i32).min(crate::environment::WORLD_HEIGHT_CHUNKS as i32-1) {
            for cx in ((left/size).floor() as i32).max(0)..=((right/size).floor() as i32).min(crate::environment::WORLD_WIDTH_CHUNKS as i32-1) {
                chunks.insert(cy as u32*crate::environment::WORLD_WIDTH_CHUNKS+cx as u32);
            }
        }
    };
    for p in &village {
        let g=&crate::collision_geometry::COLLISION_GEOMETRY.village;
        let plan=&g.buildings[p.image_path.rsplit(['/', '\\']).next().unwrap_or("")];
        let (s,c)=p.rotation_rad.sin_cos();let mut min_x=f32::INFINITY;let mut min_y=f32::INFINITY;let mut max_x=f32::NEG_INFINITY;let mut max_y=f32::NEG_INFINITY;
        for u in [-plan.width*g.tile_pixels/2.0-32.0,plan.width*g.tile_pixels/2.0+32.0] {for v in [-plan.depth*g.tile_pixels-32.0,32.0] {
            let (x,y)=(p.world_x+u*c-v*s,p.world_y+u*s+v*c);
            min_x=min_x.min(x);min_y=min_y.min(y);max_x=max_x.max(x);max_y=max_y.max(y);
        }}
        bounds(min_x,min_y,max_x,max_y);
    }
    for s in &shelters {
        let y=s.pos_y-crate::shelter::SHELTER_AABB_CENTER_Y_OFFSET_FROM_POS_Y;
        bounds(s.pos_x-crate::shelter::SHELTER_AABB_HALF_WIDTH,y-crate::shelter::SHELTER_AABB_HALF_HEIGHT,
            s.pos_x+crate::shelter::SHELTER_AABB_HALF_WIDTH,y+crate::shelter::SHELTER_AABB_HALF_HEIGHT);
    }
    for &(x,y) in &floors {let tile=crate::building::FOUNDATION_TILE_SIZE_PX as f32;bounds(x as f32*tile,y as f32*tile,(x+1) as f32*tile,(y+1) as f32*tile);}
    let blocked = |x: f32, y: f32| {
        let tile = crate::building::FOUNDATION_TILE_SIZE_PX as f32;
        floors.contains(&((x / tile).floor() as i32, (y / tile).floor() as i32))
            || shelters.iter().any(|s| crate::shelter::is_player_inside_shelter(x, y, s))
            || village.iter().any(|p| crate::collision_geometry::village_contains(p.image_path.rsplit(['/', '\\']).next().unwrap_or(""), p.world_x, p.world_y, p.rotation_rad, x, y, 32.0))
    };
    let mut grass=Vec::new();for &chunk in &chunks {grass.extend(ctx.db.grass().chunk_index().filter(chunk).filter(|g| blocked(g.pos_x,g.pos_y)).map(|g|g.id));}
    for id in grass { ctx.db.grass_state().grass_id().delete(id); ctx.db.grass().id().delete(id); }
    let mut plants=Vec::new();for &chunk in &chunks {plants.extend(ctx.db.harvestable_resource().chunk_index().filter(chunk).filter(|p| !p.is_player_planted&&blocked(p.pos_x,p.pos_y)).map(|p|p.id));}
    for id in plants { ctx.db.harvestable_resource().id().delete(id); }
    let relocate = |x: f32, y: f32, offset_y: f32| -> Option<(f32, f32)> {
        for ring in 1..=20 { for i in 0..16 {
            let angle = i as f32 * std::f32::consts::TAU / 16.0;
            let (nx, ny) = (x + angle.cos() * ring as f32 * 48.0, y + angle.sin() * ring as f32 * 48.0);
            if nx<64.0||ny<64.0||nx>crate::environment::WORLD_WIDTH_CHUNKS as f32*crate::environment::CHUNK_SIZE_PX-64.0||ny>crate::environment::WORLD_HEIGHT_CHUNKS as f32*crate::environment::CHUNK_SIZE_PX-64.0 {continue;}
            if !blocked(nx, ny) && !blocked(nx,ny+offset_y) && !crate::environment::is_position_on_water(ctx, nx, ny)
                && crate::utils::is_respawn_position_clear(ctx, nx, ny+offset_y, 64.0 * 64.0) { return Some((nx, ny)); }
        }}
        None
    };
    let mut barrels=Vec::new();for &chunk in &chunks {barrels.extend(ctx.db.barrel().chunk_index().filter(chunk).filter(|b|blocked(b.pos_x,b.pos_y)||blocked(b.pos_x,b.pos_y-crate::barrel::BARREL_COLLISION_Y_OFFSET)));}
    for mut b in barrels { if let Some((x, y)) = relocate(b.pos_x, b.pos_y,-crate::barrel::BARREL_COLLISION_Y_OFFSET) {
        b.pos_x = x; b.pos_y = y; b.chunk_index = crate::environment::calculate_chunk_index(x, y); ctx.db.barrel().id().update(b);
    }}
    let mut boxes=Vec::new();for &chunk in &chunks {boxes.extend(ctx.db.wooden_storage_box().chunk_index().filter(chunk).filter(|b|b.placed_by==ctx.identity()&&blocked(b.pos_x,b.pos_y)));}
    for mut b in boxes { if let Some((x, y)) = relocate(b.pos_x, b.pos_y,0.0) {
        b.pos_x = x; b.pos_y = y; b.chunk_index = crate::environment::calculate_chunk_index(x, y); ctx.db.wooden_storage_box().id().update(b);
    }}
    crate::spatial_grid::invalidate_static_grid();
}
