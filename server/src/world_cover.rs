//! Natural combat cover uses the existing destructible-prop table and subscriptions.
use crate::barrel::{barrel as _, Barrel};
use crate::cover_geometry::{profile, CoverProfile, COVER};
use crate::environment::{
    calculate_chunk_index, CHUNK_SIZE_PX, WORLD_HEIGHT_CHUNKS, WORLD_WIDTH_CHUNKS,
};
use crate::projectile_geometry::{swept_chunks, Point3};
use crate::wild_animal_npc::wild_animal as _;
use crate::{monument_part as _, player as _, TileType};
use spacetimedb::{ReducerContext, Table, Timestamp};

fn variant_for_tile(tile: &TileType) -> Option<u8> {
    match tile {
        TileType::Grass | TileType::Forest | TileType::Dirt => Some(7),
        TileType::Beach | TileType::Sand => Some(8),
        TileType::Tundra | TileType::TundraGrass => Some(9),
        TileType::Alpine => Some(10),
        TileType::Quarry => Some(11),
        _ => None,
    }
}

/// One bounded chunk query serves movement, melee occlusion and apparition sight.
pub fn first_blocker(
    ctx: &ReducerContext,
    start: Point3,
    end: Point3,
    padding: f32,
    ignore: Option<u64>,
) -> Option<Barrel> {
    let mut closest: Option<(f32, Barrel)> = None;
    for chunk in swept_chunks(
        (start.x, start.y),
        (end.x, end.y),
        96.0 + padding,
        CHUNK_SIZE_PX,
        WORLD_WIDTH_CHUNKS,
        WORLD_HEIGHT_CHUNKS,
    ) {
        for prop in ctx.db.barrel().chunk_index().filter(chunk) {
            if prop.health <= 0.0 || ignore == Some(prop.id) {
                continue;
            }
            let Some(cover) = profile(prop.variant) else {
                continue;
            };
            if let Some(t) = cover.impact(start, end, prop.pos_x, prop.pos_y, padding) {
                if closest.as_ref().is_none_or(|(old, _)| t < *old) {
                    closest = Some((t, prop));
                }
            }
        }
    }
    closest.map(|(_, prop)| prop)
}

pub fn blocks_path(ctx: &ReducerContext, from: (f32, f32), to: (f32, f32), padding: f32) -> bool {
    first_blocker(
        ctx,
        Point3 {
            x: from.0,
            y: from.1,
            height: 1.0,
        },
        Point3 {
            x: to.0,
            y: to.1,
            height: 1.0,
        },
        padding,
        None,
    )
    .is_some()
}

/// Require the entire footprint and its approach space to remain free of buildings.
pub fn can_respawn(ctx: &ReducerContext, x: f32, y: f32, cover: &CoverProfile) -> bool {
    if crate::placeable_collision::check_placeable_overlap(
        ctx,
        x,
        y,
        cover.width / 2.0 + 16.0,
        cover.depth / 2.0 + 16.0,
        false,
    )
    .is_err()
    {
        return false;
    }
    if ctx.db.player().iter().any(|p| {
        p.is_online
            && !p.is_dead
            && (p.position_x - x).hypot(p.position_y - y) < COVER.respawn_player_clearance
    }) {
        return false;
    }
    for nearby in swept_chunks(
        (x, y),
        (x, y),
        150.0,
        CHUNK_SIZE_PX,
        WORLD_WIDTH_CHUNKS,
        WORLD_HEIGHT_CHUNKS,
    ) {
        if ctx
            .db
            .wild_animal()
            .chunk_index()
            .filter(nearby)
            .any(|a| a.health > 0.0 && (a.pos_x - x).hypot(a.pos_y - y) < 150.0)
        {
            return false;
        }
    }
    for dx in [-cover.width / 2.0 - 32.0, 0.0, cover.width / 2.0 + 32.0] {
        for dy in [-cover.depth / 2.0 - 32.0, 0.0, cover.depth / 2.0 + 32.0] {
            if crate::indoors::blocks_world_spawn(ctx, x + dx, y + dy)
                || crate::building::is_position_on_foundation(ctx, x + dx, y + dy)
                || crate::animal_collision::check_shelter_collision(ctx, x + dx, y + dy)
            {
                return false;
            }
        }
    }
    true
}

/// Deterministic sparse candidates, one per 18x18-tile cell. Existing worlds are
/// populated by the barrel scheduler; destroyed rows keep the seeding idempotent.
pub fn seed_if_missing(ctx: &ReducerContext) {
    if ctx.db.barrel().iter().any(|b| profile(b.variant).is_some()) {
        return;
    }
    use crate::stone::stone as _;
    use crate::tree::tree as _;
    let mut count = 0;
    // Sample the sparse grid through indexed compressed chunks instead of
    // scanning hundreds of thousands of individual world-tile rows.
    for (gx, gy) in (0..crate::WORLD_HEIGHT_TILES.div_ceil(18))
        .flat_map(|gy| (0..crate::WORLD_WIDTH_TILES.div_ceil(18)).map(move |gx| (gx, gy)))
    {
        let hash = gx.wrapping_mul(73856093) ^ gy.wrapping_mul(19349663) ^ 73021;
        let tx = gx * 18 + 4 + hash % 10;
        let ty = gy * 18 + 4 + (hash / 13) % 10;
        if tx >= crate::WORLD_WIDTH_TILES || ty >= crate::WORLD_HEIGHT_TILES {
            continue;
        }
        let Some(variant) = crate::get_tile_type_at_position(ctx, tx as i32, ty as i32)
            .as_ref()
            .and_then(variant_for_tile)
        else {
            continue;
        };
        let x = (tx as f32 + 0.5) * crate::TILE_SIZE_PX as f32;
        let y = (ty as f32 + 0.5) * crate::TILE_SIZE_PX as f32;
        let cover = profile(variant).unwrap();
        if !can_respawn(ctx, x, y, cover)
            || crate::environment::is_position_in_central_compound(x, y)
            || ctx
                .db
                .monument_part()
                .iter()
                .any(|p| (p.world_x - x).hypot(p.world_y - y) < 240.0)
        {
            continue;
        }
        // Keep the footprint on dry, open terrain and away from roads/landmarks.
        let mut clear = true;
        for dx in [-120.0, 0.0, 120.0] {
            for dy in [-100.0, 0.0, 100.0] {
                if crate::get_tile_type_at_position(
                    ctx,
                    ((x + dx) / crate::TILE_SIZE_PX as f32).floor() as i32,
                    ((y + dy) / crate::TILE_SIZE_PX as f32).floor() as i32,
                )
                .as_ref()
                .and_then(variant_for_tile)
                    != Some(variant)
                {
                    clear = false;
                }
            }
        }
        if !clear {
            continue;
        }
        for chunk in swept_chunks(
            (x, y),
            (x, y),
            180.0,
            CHUNK_SIZE_PX,
            WORLD_WIDTH_CHUNKS,
            WORLD_HEIGHT_CHUNKS,
        ) {
            if ctx
                .db
                .tree()
                .chunk_index()
                .filter(chunk)
                .any(|t| (t.pos_x - x).hypot(t.pos_y - 68.0 - y) < 180.0)
                || ctx
                    .db
                    .stone()
                    .chunk_index()
                    .filter(chunk)
                    .any(|s| (s.pos_x - x).hypot(s.pos_y - 36.0 - y) < 160.0)
                || ctx
                    .db
                    .barrel()
                    .chunk_index()
                    .filter(chunk)
                    .any(|b| (b.pos_x - x).hypot(b.pos_y - y) < 220.0)
            {
                clear = false;
                break;
            }
        }
        if !clear {
            continue;
        }
        if ctx
            .db
            .barrel()
            .try_insert(Barrel {
                id: 0,
                pos_x: x,
                pos_y: y,
                health: COVER.health,
                variant,
                chunk_index: calculate_chunk_index(x, y),
                last_hit_time: None,
                respawn_at: Timestamp::UNIX_EPOCH,
                cluster_id: 0,
                is_monument: false,
            })
            .is_ok()
        {
            count += 1;
        }
    }
    log::info!("Seeded {} natural combat barricades", count);
}
