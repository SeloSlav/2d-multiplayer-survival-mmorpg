/*
 * server/src/environment.rs
 *
 * Purpose: Manages the static and dynamic elements of the game world environment,
 *          excluding player-specific state.
 *
 * Responsibilities:
 *   - `seed_environment`: Populates the world with initial resources (trees, stones, mushrooms)
 *                         on server startup if the environment is empty. Uses helpers from `utils.rs`.
 *   - `check_resource_respawns`: Checks periodically if any depleted resources (trees, stones,
 *                                mushrooms with `respawn_at` set) are ready to respawn.
 *                                Uses a macro from `utils.rs` for conciseness.
 *
 * Note: Resource definitions (structs, constants) are in their respective modules (e.g., `tree.rs`).
 */

// server/src/environment.rs
use spacetimedb::{ReducerContext, Table, Timestamp, Identity, ScheduleAt};
use crate::{
    tree::Tree,
    stone::Stone, 
    sea_stack::{SeaStack, SeaStackVariant},
    TileType, WorldTile,
    harvestable_resource::{self, HarvestableResource},
    grass::{Grass, GrassAppearanceType},
    wild_animal_npc::{AnimalSpecies, AnimalState, MovementPattern, WildAnimal, CaribouSex},
    cloud::{Cloud, CloudUpdateSchedule, CloudShapeType, CloudType},
    barrel,
    plants_database,
    items::ItemDefinition,
    rune_stone::{RuneStone, RuneStoneType},
    cairn::Cairn,
    // REMOVED: hot_spring::HotSpring, - No longer using hot spring entities
    whale_bone_graveyard,
    utils::*,
    WORLD_WIDTH_TILES, WORLD_HEIGHT_TILES, WORLD_WIDTH_PX, WORLD_HEIGHT_PX, TILE_SIZE_PX,
    PLAYER_RADIUS,
};
use log;

// Import table traits
use crate::tree::tree as TreeTableTrait;
use crate::stone::stone as StoneTableTrait;
use crate::harvestable_resource::harvestable_resource as HarvestableResourceTableTrait;
use crate::cloud::cloud as CloudTableTrait;
use crate::cloud::cloud_update_schedule as CloudUpdateScheduleTableTrait;
use crate::grass::grass as GrassTableTrait;
use crate::world_tile as WorldTileTableTrait;
use crate::wild_animal_npc::wild_animal as WildAnimalTableTrait;
use crate::wild_animal_npc::core::AnimalBehavior;
use crate::barrel::barrel as BarrelTableTrait;
use crate::world_state::world_state as WorldStateTableTrait;
use crate::monument; // Import monument module for clearance checks
use crate::sea_stack::sea_stack as SeaStackTableTrait;
use crate::rune_stone::rune_stone as RuneStoneTableTrait;
use crate::cairn::cairn as CairnTableTrait;
use crate::items::item_definition as ItemDefinitionTableTrait;
use crate::fumarole::fumarole as FumaroleTableTrait;
use crate::basalt_column::basalt_column as BasaltColumnTableTrait;
use crate::large_quarry as LargeQuarryTableTrait;
use crate::reed_marsh as ReedMarshTableTrait;
use crate::tide_pool as TidePoolTableTrait;
use crate::coral::living_coral as LivingCoralTableTrait;
// Monument table traits for cairn avoidance checks
use crate::alk::alk_station as AlkStationTableTrait;
use crate::monument_part as MonumentPartTableTrait;
use crate::MonumentType;
use crate::wooden_storage_box::wooden_storage_box as WoodenStorageBoxTableTrait;

// Import utils helpers and macro
use crate::utils::{calculate_tile_bounds, attempt_single_spawn};
use crate::check_and_respawn_resource;

use noise::{NoiseFn, Perlin, Fbm};
use rand::{Rng, SeedableRng};
use rand::rngs::StdRng;
use std::collections::HashSet;

pub use crate::shared_config::{CHUNK_SIZE_TILES, DEEP_SEA_OUTER_RING_TILES};

// --- Outer Deep Sea Ring (800x800 map) ---
/// Tiles from each edge that form the "empty deep sea" ring - no spawns for CPU performance.
/// Kept moderate (~70) so there's a clear band of normal sea between coast and deep ocean.
/// Island is fixed-size (doesn't scale with map), so sea zone stays large.

/// Returns true if position is in the outer deep sea ring (within DEEP_SEA_OUTER_RING_TILES of any edge).
/// Used to exclude sea stacks, barrels, coral, wild animals from the empty outer ocean.
pub fn is_position_in_outer_deep_sea_ring(pos_x: f32, pos_y: f32) -> bool {
    let tile_x = (pos_x / TILE_SIZE_PX as f32).floor() as i32;
    let tile_y = (pos_y / TILE_SIZE_PX as f32).floor() as i32;
    let ring = DEEP_SEA_OUTER_RING_TILES as i32;
    let max_x = WORLD_WIDTH_TILES as i32 - 1 - ring;
    let max_y = WORLD_HEIGHT_TILES as i32 - 1 - ring;
    tile_x < ring || tile_x > max_x || tile_y < ring || tile_y > max_y
}

// --- Sea Stack Constants ---
const SEA_STACK_DENSITY_PERCENT: f32 = 0.0012; // 0.12% of tiles - spawns on ocean water tiles
const MIN_SEA_STACK_DISTANCE_SQ: f32 = 360.0 * 360.0; // 360px = 7.5 tiles minimum between sea stacks (3x original)
const MIN_SEA_STACK_TREE_DISTANCE_SQ: f32 = 80.0 * 80.0; // 80px distance from trees (though they shouldn't overlap anyway)
const MIN_SEA_STACK_STONE_DISTANCE_SQ: f32 = 80.0 * 80.0; // 80px distance from stones
const SEA_STACK_SPAWN_NOISE_FREQUENCY: f64 = 0.008; // Noise frequency for clustering
const SEA_STACK_SPAWN_NOISE_THRESHOLD: f64 = 0.3; // Noise threshold for spawning

// --- Constants for Chunk Calculation ---
// Size of a chunk in tiles (16x16 tiles = 768px per chunk)
// OPTIMIZED: Changed from 5×5 to 16×16 based on performance testing
// Results: 60-70% reduction in subscriptions, eliminated performance spikes
// See CHUNK_SIZE_TESTING.md for detailed test results
// World dimensions in chunks
pub const WORLD_WIDTH_CHUNKS: u32 = (WORLD_WIDTH_TILES + CHUNK_SIZE_TILES - 1) / CHUNK_SIZE_TILES;
pub const WORLD_HEIGHT_CHUNKS: u32 = (WORLD_HEIGHT_TILES + CHUNK_SIZE_TILES - 1) / CHUNK_SIZE_TILES;
// Size of a chunk in pixels
pub const CHUNK_SIZE_PX: f32 = CHUNK_SIZE_TILES as f32 * TILE_SIZE_PX as f32;

// --- Tree Clustering Constants ---
// Create dense forest clusters for more interesting terrain
const DENSE_FOREST_NOISE_FREQUENCY: f64 = 0.003; // Large-scale forest regions
const DENSE_FOREST_THRESHOLD: f64 = 0.6; // Areas above this are dense forests
const DENSE_FOREST_MULTIPLIER: f32 = 3.0; // 3x tree density in dense forests

// --- Resource Scaling Constants ---
// Reference point for resource density calculations (600x600 map)
const BASE_AREA_TILES: f32 = 360_000.0; // 600x600 reference map

// Base counts for 600x600 map (optimized for competitive but not frustrating gameplay)
const BASE_TREE_COUNT_600X600: u32 = 900;   // ~0.25% density, ~480px avg spacing
const BASE_STONE_COUNT_600X600: u32 = 180;  // INCREASED: More stones, especially in south (~2s walk to find one)
const BASE_BARREL_CLUSTERS_600X600: u32 = 14; // Rare, contested PvP hotspots

/// Calculate resource count with sublinear scaling for any map size.
/// Uses 600x600 (360k tiles) as the reference point.
/// 
/// The 0.85 exponent creates sublinear scaling so that:
/// - Smaller maps (300x300) get proportionally MORE resources per area
/// - Larger maps (900x900) get proportionally FEWER resources per area
/// - This keeps gameplay balanced regardless of map size
/// 
/// Examples:
/// - 300x300 (0.25x area): scale=0.29, trees=261, stones=29
/// - 600x600 (1.00x area): scale=1.00, trees=900, stones=100
/// - 800x800 (1.78x area): scale=1.58, trees=1422, stones=158
fn scale_resource_count(base_count_at_600x600: u32, current_tiles: u32) -> u32 {
    let scale_factor = (current_tiles as f32 / BASE_AREA_TILES).powf(0.85);
    (base_count_at_600x600 as f32 * scale_factor).round().max(1.0) as u32
}

// --- Helper function to calculate chunk index ---
pub fn calculate_chunk_index(pos_x: f32, pos_y: f32) -> u32 {
    // Convert position to tile coordinates
    let tile_x = (pos_x / TILE_SIZE_PX as f32).floor() as u32;
    let tile_y = (pos_y / TILE_SIZE_PX as f32).floor() as u32;
    
    // Calculate chunk coordinates (which chunk the tile is in)
    let chunk_x = (tile_x / CHUNK_SIZE_TILES).min(WORLD_WIDTH_CHUNKS - 1);
    let chunk_y = (tile_y / CHUNK_SIZE_TILES).min(WORLD_HEIGHT_CHUNKS - 1);
    
    // Calculate 1D chunk index (row-major ordering)
    chunk_y * WORLD_WIDTH_CHUNKS + chunk_x
}

// --- Helper function to detect quarry clusters from tiles ---
// Removed detect_quarry_clusters function - using simple probability-based spawning instead

// --- Seasonal Wild Plant Respawn System ---

/// Calculate how far through the current season we are (0.0 = start, 1.0 = end)
/// Returns a value between 0.0 and 1.0 representing season progress
pub fn get_current_season_progress(ctx: &ReducerContext) -> Result<f32, String> {
    let world_state = ctx.db.world_state().iter().next().ok_or_else(|| {
        "WorldState singleton not found".to_string()
    })?;
    let season_duration_hours = crate::world_state::SEASON_DURATION_HOURS;
    
    // Calculate how many hours have passed since season start
    let season_start_day = match world_state.current_season {
        crate::world_state::Season::Spring => 1,
        crate::world_state::Season::Summer => 91,
        crate::world_state::Season::Autumn => 181,
        crate::world_state::Season::Winter => 271,
    };
    let days_into_season = world_state.day_of_year.saturating_sub(season_start_day - 1);
    let hours_since_season_start = days_into_season as f32 * 24.0;
    
    // Calculate progress as a fraction (0.0 to 1.0)
    let progress = hours_since_season_start / season_duration_hours;
    
    // Clamp to valid range (should always be 0.0-1.0, but safety first)
    Ok(progress.max(0.0).min(1.0))
}

/// Calculate the seasonal multiplier for wild plant respawn times
/// Uses an exponential curve that starts at 1.0x and increases to MAX_MULTIPLIER by season end
/// This creates scarcity pressure that encourages early collection and farming
pub fn calculate_seasonal_respawn_multiplier(season_progress: f32) -> f32 {
    // Configuration for the exponential curve
    const MAX_MULTIPLIER: f32 = 5.0; // At season end, respawn takes 5x longer
    const CURVE_STEEPNESS: f32 = 2.5; // Controls how quickly the curve accelerates
    
    // Exponential curve: starts near 1.0, accelerates towards MAX_MULTIPLIER
    // Formula: 1.0 + (MAX_MULTIPLIER - 1.0) * progress^CURVE_STEEPNESS
    let normalized_progress = season_progress.max(0.0).min(1.0);
    let exponential_factor = normalized_progress.powf(CURVE_STEEPNESS);
    let multiplier = 1.0 + (MAX_MULTIPLIER - 1.0) * exponential_factor;
    
    multiplier
}

/// Apply seasonal respawn multiplier to base respawn seconds for wild plants
/// This function should be called when calculating respawn times for wild harvestable resources
pub fn apply_seasonal_respawn_multiplier(ctx: &ReducerContext, base_respawn_secs: u64) -> u64 {
    match get_current_season_progress(ctx) {
        Ok(progress) => {
            let multiplier = calculate_seasonal_respawn_multiplier(progress);
            let modified_respawn_secs = (base_respawn_secs as f32 * multiplier) as u64;
            
            // Log for debugging (only occasionally to avoid spam)
            if ctx.rng().gen_range(0..100) < 5 { // 5% chance to log
                log::info!("🌱 Seasonal respawn: {:.1}% through season, {:.1}x multiplier, {}s base → {}s actual", 
                          progress * 100.0, multiplier, base_respawn_secs, modified_respawn_secs);
            }
            
            modified_respawn_secs
        }
        Err(e) => {
            log::warn!("Failed to get season progress for respawn multiplier: {}, using base time", e);
            base_respawn_secs
        }
    }
}

/// Checks if position is in the central compound area where trees and stones should not spawn
pub fn is_position_in_central_compound(pos_x: f32, pos_y: f32) -> bool {
    // Convert to tile coordinates
    let tile_x = (pos_x / crate::TILE_SIZE_PX as f32).floor() as i32;
    let tile_y = (pos_y / crate::TILE_SIZE_PX as f32).floor() as i32;
    
    // Calculate center of the world in tiles
    let center_x = (WORLD_WIDTH_TILES / 2) as i32;
    let center_y = (WORLD_HEIGHT_TILES / 2) as i32;
    
    // Central compound size + buffer zone (must match world_generation.rs compound_size=20)
    let compound_size = 20;
    let buffer = 15; // Extra buffer to keep trees and stones away from roads and compound
    
    // Check if position is within the exclusion zone
    let min_x = center_x - compound_size - buffer;
    let max_x = center_x + compound_size + buffer;
    let min_y = center_y - compound_size - buffer;
    let max_y = center_y + compound_size + buffer;
    
    tile_x >= min_x && tile_x <= max_x && tile_y >= min_y && tile_y <= max_y
}

/// Checks if position is on a beach tile
/// NEW: Uses compressed chunk data for better performance
pub fn is_position_on_beach_tile(ctx: &ReducerContext, pos_x: f32, pos_y: f32) -> bool {
    // Convert pixel position to tile coordinates
    let tile_x = (pos_x / crate::TILE_SIZE_PX as f32).floor() as i32;
    let tile_y = (pos_y / crate::TILE_SIZE_PX as f32).floor() as i32;
    
    // NEW: Try compressed lookup first for better performance
    if let Some(tile_type) = crate::get_tile_type_at_position(ctx, tile_x, tile_y) {
        return tile_type == crate::TileType::Beach;
    }
    
    // FALLBACK: Use original method if compressed data not available
    let world_tiles = ctx.db.world_tile();
    
    // Check if the position is on a beach tile
    for tile in world_tiles.idx_world_position().filter((tile_x, tile_y)) {
        return tile.tile_type == crate::TileType::Beach;
    }
    
    false
}

/// Checks if position is within any tide pool zone (coastal inlet - crabs, reeds, terns)
pub fn is_position_in_tide_pool(ctx: &ReducerContext, pos_x: f32, pos_y: f32) -> bool {
    for pool in ctx.db.tide_pool().iter() {
        let dx = pos_x - pool.world_x;
        let dy = pos_y - pool.world_y;
        if dx * dx + dy * dy <= pool.radius_px * pool.radius_px {
            return true;
        }
    }
    false
}

/// Checks if position is within any reed marsh zone
pub fn is_position_in_reed_marsh(ctx: &ReducerContext, pos_x: f32, pos_y: f32) -> bool {
    for marsh in ctx.db.reed_marsh().iter() {
        let dx = pos_x - marsh.world_x;
        let dy = pos_y - marsh.world_y;
        if dx * dx + dy * dy <= marsh.radius_px * marsh.radius_px {
            return true;
        }
    }
    false
}

/// Wolf den zone radius (matches respawn WOLF_DEN_ZONE_RADIUS_SQ = 250^2)
const WOLF_DEN_ZONE_RADIUS_PX: f32 = 250.0;

/// Checks if position is within any wolf den zone
pub fn is_position_in_wolf_den_zone(ctx: &ReducerContext, pos_x: f32, pos_y: f32) -> bool {
    let radius_sq = WOLF_DEN_ZONE_RADIUS_PX * WOLF_DEN_ZONE_RADIUS_PX;
    for part in ctx.db.monument_part().iter() {
        if part.monument_type != MonumentType::WolfDen || !part.is_center {
            continue;
        }
        let dx = pos_x - part.world_x;
        let dy = pos_y - part.world_y;
        if dx * dx + dy * dy <= radius_sq {
            return true;
        }
    }
    false
}

/// Find the wolf den center closest to the given spawn position (for wolves that spawn at dens)
pub fn find_nearest_wolf_den_center(ctx: &ReducerContext, spawn_x: f32, spawn_y: f32) -> Option<(f32, f32)> {
    let mut closest: Option<(f32, f32)> = None;
    let mut closest_dist_sq = f32::MAX;
    for part in ctx.db.monument_part().iter() {
        if part.monument_type != MonumentType::WolfDen || !part.is_center {
            continue;
        }
        let dx = spawn_x - part.world_x;
        let dy = spawn_y - part.world_y;
        let dist_sq = dx * dx + dy * dy;
        if dist_sq < closest_dist_sq {
            closest_dist_sq = dist_sq;
            closest = Some((part.world_x, part.world_y));
        }
    }
    closest
}

/// Checks if position is on a Forest tile (dense forested area)
/// Forest tiles have much higher tree density and darker ground texture
pub fn is_position_on_forest_tile(ctx: &ReducerContext, pos_x: f32, pos_y: f32) -> bool {
    // Convert pixel position to tile coordinates
    let tile_x = (pos_x / crate::TILE_SIZE_PX as f32).floor() as i32;
    let tile_y = (pos_y / crate::TILE_SIZE_PX as f32).floor() as i32;
    
    // Try compressed lookup first for better performance
    if let Some(tile_type) = crate::get_tile_type_at_position(ctx, tile_x, tile_y) {
        return tile_type == crate::TileType::Forest;
    }
    
    // FALLBACK: Use original method if compressed data not available
    let world_tiles = ctx.db.world_tile();
    
    // Check if the position is on a forest tile
    for tile in world_tiles.idx_world_position().filter((tile_x, tile_y)) {
        return tile.tile_type == crate::TileType::Forest;
    }
    
    false
}

/// Checks if position is on an arctic biome tile (Tundra or Alpine)
/// Arctic tiles are too cold/rocky for trees to grow
pub fn is_position_on_arctic_tile(ctx: &ReducerContext, pos_x: f32, pos_y: f32) -> bool {
    // Convert pixel position to tile coordinates
    let tile_x = (pos_x / crate::TILE_SIZE_PX as f32).floor() as i32;
    let tile_y = (pos_y / crate::TILE_SIZE_PX as f32).floor() as i32;
    
    // Try compressed lookup first for better performance
    if let Some(tile_type) = crate::get_tile_type_at_position(ctx, tile_x, tile_y) {
        return tile_type.is_arctic(); // Uses TileType::is_arctic() method
    }
    
    // FALLBACK: Use original method if compressed data not available
    let world_tiles = ctx.db.world_tile();
    
    // Check if the position is on an arctic tile
    for tile in world_tiles.idx_world_position().filter((tile_x, tile_y)) {
        return tile.tile_type.is_arctic();
    }
    
    false
}

/// Checks if position is on a Tundra or TundraGrass tile specifically
pub fn is_position_on_tundra_tile(ctx: &ReducerContext, pos_x: f32, pos_y: f32) -> bool {
    let tile_x = (pos_x / crate::TILE_SIZE_PX as f32).floor() as i32;
    let tile_y = (pos_y / crate::TILE_SIZE_PX as f32).floor() as i32;
    
    if let Some(tile_type) = crate::get_tile_type_at_position(ctx, tile_x, tile_y) {
        return tile_type.is_tundra(); // Uses TileType::is_tundra() which includes TundraGrass
    }
    
    let world_tiles = ctx.db.world_tile();
    for tile in world_tiles.idx_world_position().filter((tile_x, tile_y)) {
        return tile.tile_type.is_tundra(); // Uses TileType::is_tundra() which includes TundraGrass
    }
    
    false
}

/// Checks if position is on an Alpine tile specifically
pub fn is_position_on_alpine_tile(ctx: &ReducerContext, pos_x: f32, pos_y: f32) -> bool {
    let tile_x = (pos_x / crate::TILE_SIZE_PX as f32).floor() as i32;
    let tile_y = (pos_y / crate::TILE_SIZE_PX as f32).floor() as i32;
    
    if let Some(tile_type) = crate::get_tile_type_at_position(ctx, tile_x, tile_y) {
        return tile_type == crate::TileType::Alpine;
    }
    
    let world_tiles = ctx.db.world_tile();
    for tile in world_tiles.idx_world_position().filter((tile_x, tile_y)) {
        return tile.tile_type == crate::TileType::Alpine;
    }
    
    false
}

/// Checks if position is on an Asphalt tile (compound/paved area)
/// Asphalt tiles are used for the central compound and mini-compounds
pub fn is_position_on_asphalt_tile(ctx: &ReducerContext, pos_x: f32, pos_y: f32) -> bool {
    // Convert pixel position to tile coordinates
    let tile_x = (pos_x / crate::TILE_SIZE_PX as f32).floor() as i32;
    let tile_y = (pos_y / crate::TILE_SIZE_PX as f32).floor() as i32;
    
    // Try compressed lookup first for better performance
    if let Some(tile_type) = crate::get_tile_type_at_position(ctx, tile_x, tile_y) {
        return tile_type == crate::TileType::Asphalt;
    }
    
    // FALLBACK: Use original method if compressed data not available
    let world_tiles = ctx.db.world_tile();
    
    // Check if the position is on an asphalt tile
    for tile in world_tiles.idx_world_position().filter((tile_x, tile_y)) {
        return tile.tile_type == crate::TileType::Asphalt;
    }
    
    false
}

/// Checks if position is on or near a monument (hot spring or quarry)
/// Used to prevent foundations from being built on monuments
pub fn is_position_on_monument(ctx: &ReducerContext, pos_x: f32, pos_y: f32) -> bool {
    // Check if on hot spring
    if is_position_in_hot_spring_area(ctx, pos_x, pos_y) {
        return true;
    }
    
    // Check if on quarry
    let tile_x = (pos_x / crate::TILE_SIZE_PX as f32).floor() as i32;
    let tile_y = (pos_y / crate::TILE_SIZE_PX as f32).floor() as i32;
    
    // Check bounds
    if tile_x < 0 || tile_y < 0 || 
       tile_x >= WORLD_WIDTH_TILES as i32 || tile_y >= WORLD_HEIGHT_TILES as i32 {
        return false;
    }
    
    // Check if this tile is a quarry tile
    if let Some(tile_type) = crate::get_tile_type_at_position(ctx, tile_x, tile_y) {
        if tile_type == crate::TileType::Quarry {
            return true;
        }
    }
    
    false
}

/// Checks if position is in a hot spring area (HotSpringWater tile or nearby)
/// Used to prevent trees/stones from spawning in hot spring pools
pub fn is_position_in_hot_spring_area(ctx: &ReducerContext, pos_x: f32, pos_y: f32) -> bool {
    // Convert pixel position to tile coordinates
    let tile_x = (pos_x / crate::TILE_SIZE_PX as f32).floor() as i32;
    let tile_y = (pos_y / crate::TILE_SIZE_PX as f32).floor() as i32;
    
    // Check a radius around the position (hot springs are ~7-9 tiles radius, check up to 12 tiles away)
    let check_radius = 12; // Check 12 tiles in each direction to clear a nice area
    
    for dy in -check_radius..=check_radius {
        for dx in -check_radius..=check_radius {
            let check_x = tile_x + dx;
            let check_y = tile_y + dy;
            
            // Skip if out of bounds
            if check_x < 0 || check_y < 0 || 
               check_x >= WORLD_WIDTH_TILES as i32 || check_y >= WORLD_HEIGHT_TILES as i32 {
                continue;
            }
            
            // Check if this tile is HotSpringWater
            if let Some(tile_type) = crate::get_tile_type_at_position(ctx, check_x, check_y) {
                if tile_type == crate::TileType::HotSpringWater {
                    // Calculate distance from position to this hot spring tile
                    let dx_px = (check_x as f32 - tile_x as f32) * crate::TILE_SIZE_PX as f32;
                    let dy_px = (check_y as f32 - tile_y as f32) * crate::TILE_SIZE_PX as f32;
                    let dist_sq = dx_px * dx_px + dy_px * dy_px;
                    
                    // Block spawning within 600px of hot spring water (hot springs are ~336-432px diameter, so 600px gives nice clearance)
                    if dist_sq < (600.0 * 600.0) {
                        return true;
                    }
                }
            } else {
                // Fallback: Use database query if compressed data not available
                let world_tiles = ctx.db.world_tile();
                for tile in world_tiles.idx_world_position().filter((check_x, check_y)) {
                    if tile.tile_type == crate::TileType::HotSpringWater {
                        let dx_px = (check_x as f32 - tile_x as f32) * crate::TILE_SIZE_PX as f32;
                        let dy_px = (check_y as f32 - tile_y as f32) * crate::TILE_SIZE_PX as f32;
                        let dist_sq = dx_px * dx_px + dy_px * dy_px;
                        if dist_sq < (600.0 * 600.0) {
                            return true;
                        }
                    }
                    break;
                }
            }
        }
    }
    
    false
}

/// True if a cairn must not spawn here: near any monument part, large/small quarry, hot spring, reed marsh, or tide pool.
pub fn is_position_too_close_to_cairn_landmarks(ctx: &ReducerContext, pos_x: f32, pos_y: f32) -> bool {
    use crate::cairn::{
        MIN_CAIRN_LARGE_QUARRY_BUFFER_PX, MIN_CAIRN_MONUMENT_PART_DISTANCE_SQ,
        MIN_CAIRN_QUARRY_TILE_PROXIMITY_SQ, MIN_CAIRN_REED_MARSH_BUFFER_PX,
        MIN_CAIRN_TIDE_POOL_BUFFER_PX,
    };

    for part in ctx.db.monument_part().iter() {
        let dx = pos_x - part.world_x;
        let dy = pos_y - part.world_y;
        if dx * dx + dy * dy < MIN_CAIRN_MONUMENT_PART_DISTANCE_SQ {
            return true;
        }
    }

    for q in ctx.db.large_quarry().iter() {
        let radius_px = q.radius_tiles as f32 * TILE_SIZE_PX as f32;
        let min_dist = radius_px + MIN_CAIRN_LARGE_QUARRY_BUFFER_PX;
        let min_dist_sq = min_dist * min_dist;
        let dx = pos_x - q.world_x;
        let dy = pos_y - q.world_y;
        if dx * dx + dy * dy < min_dist_sq {
            return true;
        }
    }

    if is_position_in_hot_spring_area(ctx, pos_x, pos_y) {
        return true;
    }

    if is_position_near_quarry_tiles_for_cairn(ctx, pos_x, pos_y) {
        return true;
    }

    for marsh in ctx.db.reed_marsh().iter() {
        let min_dist = marsh.radius_px + MIN_CAIRN_REED_MARSH_BUFFER_PX;
        let min_dist_sq = min_dist * min_dist;
        let dx = pos_x - marsh.world_x;
        let dy = pos_y - marsh.world_y;
        if dx * dx + dy * dy < min_dist_sq {
            return true;
        }
    }

    for pool in ctx.db.tide_pool().iter() {
        let min_dist = pool.radius_px + MIN_CAIRN_TIDE_POOL_BUFFER_PX;
        let min_dist_sq = min_dist * min_dist;
        let dx = pos_x - pool.world_x;
        let dy = pos_y - pool.world_y;
        if dx * dx + dy * dy < min_dist_sq {
            return true;
        }
    }

    false
}

/// Small quarry pits use `TileType::Quarry`; stay outside a radius of any such tile near the candidate.
fn is_position_near_quarry_tiles_for_cairn(ctx: &ReducerContext, pos_x: f32, pos_y: f32) -> bool {
    use crate::cairn::MIN_CAIRN_QUARRY_TILE_PROXIMITY_SQ;

    let tile_x = (pos_x / TILE_SIZE_PX as f32).floor() as i32;
    let tile_y = (pos_y / TILE_SIZE_PX as f32).floor() as i32;
    let check_radius = 14;

    for dy in -check_radius..=check_radius {
        for dx in -check_radius..=check_radius {
            let check_x = tile_x + dx;
            let check_y = tile_y + dy;
            if check_x < 0
                || check_y < 0
                || check_x >= WORLD_WIDTH_TILES as i32
                || check_y >= WORLD_HEIGHT_TILES as i32
            {
                continue;
            }

            let tile_type = if let Some(t) = crate::get_tile_type_at_position(ctx, check_x, check_y) {
                t
            } else {
                let world_tiles = ctx.db.world_tile();
                let mut found = None;
                for tile in world_tiles.idx_world_position().filter((check_x, check_y)) {
                    found = Some(tile.tile_type);
                    break;
                }
                match found {
                    Some(t) => t,
                    None => continue,
                }
            };

            if tile_type != crate::TileType::Quarry {
                continue;
            }

            let tile_center_x = (check_x as f32 + 0.5) * TILE_SIZE_PX as f32;
            let tile_center_y = (check_y as f32 + 0.5) * TILE_SIZE_PX as f32;
            let dxp = pos_x - tile_center_x;
            let dyp = pos_y - tile_center_y;
            if dxp * dxp + dyp * dyp < MIN_CAIRN_QUARRY_TILE_PROXIMITY_SQ {
                return true;
            }
        }
    }
    false
}

/// Finds hot spring centers by clustering HotSpringWater tiles
/// Returns (center_x, center_y, tile_count) in world pixel coordinates.
/// Small clusters (tile_count < MIN_FULL_HOT_SPRING_TILES) are "tiny" springs with no shack/campfire/barrels.
pub fn find_hot_spring_centers(ctx: &ReducerContext) -> Vec<(f32, f32, usize)> {
    use std::collections::{HashSet, VecDeque};
    
    // Collect all HotSpringWater tiles
    let hot_spring_tiles: Vec<(i32, i32)> = ctx.db.world_tile()
        .iter()
        .filter(|tile| tile.tile_type == crate::TileType::HotSpringWater)
        .map(|tile| (tile.world_x, tile.world_y))
        .collect();
    
    if hot_spring_tiles.is_empty() {
        return Vec::new();
    }
    
    log::debug!("[HotSpringCenters] Found {} HotSpringWater tiles", hot_spring_tiles.len());
    
    // Build a set for fast lookup
    let tile_set: HashSet<(i32, i32)> = hot_spring_tiles.iter().cloned().collect();
    let mut visited: HashSet<(i32, i32)> = HashSet::new();
    let mut centers: Vec<(f32, f32, usize)> = Vec::new();
    
    // Flood-fill to find connected clusters (each cluster = one hot spring)
    for &start_tile in &hot_spring_tiles {
        if visited.contains(&start_tile) {
            continue;
        }
        
        // BFS to find all connected tiles in this cluster
        let mut cluster: Vec<(i32, i32)> = Vec::new();
        let mut queue: VecDeque<(i32, i32)> = VecDeque::new();
        queue.push_back(start_tile);
        visited.insert(start_tile);
        
        while let Some((tx, ty)) = queue.pop_front() {
            cluster.push((tx, ty));
            
            // Check 4-connected neighbors (up, down, left, right)
            for (dx, dy) in &[(0, 1), (0, -1), (1, 0), (-1, 0)] {
                let neighbor = (tx + dx, ty + dy);
                if tile_set.contains(&neighbor) && !visited.contains(&neighbor) {
                    visited.insert(neighbor);
                    queue.push_back(neighbor);
                }
            }
        }
        
        // Calculate the center of this cluster (average of all tile positions)
        if !cluster.is_empty() {
            let sum_x: i32 = cluster.iter().map(|(x, _)| x).sum();
            let sum_y: i32 = cluster.iter().map(|(_, y)| y).sum();
            let count = cluster.len() as f32;
            
            // Convert tile center to world pixels
            let center_tile_x = sum_x as f32 / count;
            let center_tile_y = sum_y as f32 / count;
            let center_world_x = (center_tile_x + 0.5) * crate::TILE_SIZE_PX as f32;
            let center_world_y = (center_tile_y + 0.5) * crate::TILE_SIZE_PX as f32;
            
            centers.push((center_world_x, center_world_y, cluster.len()));
            log::debug!(
                "[HotSpringCenters] Found hot spring cluster with {} tiles, center at ({:.0}, {:.0})",
                cluster.len(), center_world_x, center_world_y
            );
        }
    }
    
    log::info!("[HotSpringCenters] Detected {} hot springs from tile clusters", centers.len());
    centers
}

/// Helper function to check if a sea tile is too close to beach tiles
/// Sea stacks should only spawn in deep ocean water, not near shallow coastal areas
fn is_too_close_to_beach(ctx: &ReducerContext, tile_x: i32, tile_y: i32) -> bool {
    // Check a small radius around the current tile for beach tiles
    let beach_check_radius = 2; // Check 2 tiles in each direction (5x5 area)
    
    for dy in -beach_check_radius..=beach_check_radius {
        for dx in -beach_check_radius..=beach_check_radius {
            let check_x = tile_x + dx;
            let check_y = tile_y + dy;
            
            // Skip if out of bounds
            if check_x < 0 || check_y < 0 || 
               check_x >= WORLD_WIDTH_TILES as i32 || check_y >= WORLD_HEIGHT_TILES as i32 {
                continue;
            }
            
            // Check if this tile is a beach tile
            if let Some(tile_type) = crate::get_tile_type_at_position(ctx, check_x, check_y) {
                if tile_type == crate::TileType::Beach {
                    return true; // Too close to beach
                }
            } else {
                // Fallback to database query if compressed data not available
                let world_tiles = ctx.db.world_tile();
                for tile in world_tiles.idx_world_position().filter((check_x, check_y)) {
                    if tile.tile_type == crate::TileType::Beach {
                        return true; // Too close to beach
                    }
                    break; // Only check the first tile found at this position
                }
            }
        }
    }
    
    false // Not too close to any beach tiles
}

/// Returns true if the position is on a Sea↔DeepSea transition tile (boundary between inner ocean and outer deep sea).
/// Used for buoy spawning - buoys only spawn on this boundary.
pub fn is_position_on_sea_deepsea_transition(ctx: &ReducerContext, pos_x: f32, pos_y: f32) -> bool {
    let tile_x = (pos_x / TILE_SIZE_PX as f32).floor() as i32;
    let tile_y = (pos_y / TILE_SIZE_PX as f32).floor() as i32;
    
    if tile_x < 0 || tile_y < 0 ||
       tile_x >= WORLD_WIDTH_TILES as i32 || tile_y >= WORLD_HEIGHT_TILES as i32 {
        return false;
    }
    
    let lookup_tile_type = |x: i32, y: i32| -> Option<crate::TileType> {
        // Prefer compressed chunk lookup when available (fast path).
        if let Some(tile_type) = crate::get_tile_type_at_position(ctx, x, y) {
            return Some(tile_type);
        }

        // Fallback during early world init before compressed chunks are generated.
        let world_tiles = ctx.db.world_tile();
        for tile in world_tiles.idx_world_position().filter((x, y)) {
            return Some(tile.tile_type);
        }
        None
    };

    let center_type = match lookup_tile_type(tile_x, tile_y) {
        Some(t) => t,
        None => return false,
    };
    
    // Must be Sea or DeepSea
    if center_type != crate::TileType::Sea && center_type != crate::TileType::DeepSea {
        return false;
    }
    
    // Check if any adjacent tile is the OTHER type (Sea↔DeepSea boundary)
    let other_type = if center_type == crate::TileType::Sea {
        crate::TileType::DeepSea
    } else {
        crate::TileType::Sea
    };
    
    for (dx, dy) in [(-1, 0), (1, 0), (0, -1), (0, 1)] {
        let adj_x = tile_x + dx;
        let adj_y = tile_y + dy;
        if adj_x >= 0 && adj_y >= 0 &&
           adj_x < WORLD_WIDTH_TILES as i32 && adj_y < WORLD_HEIGHT_TILES as i32 {
            if let Some(adj_type) = lookup_tile_type(adj_x, adj_y) {
                if adj_type == other_type {
                    return true; // Found Sea↔DeepSea boundary
                }
            }
        }
    }
    
    false
}

/// Checks if the given world position is on ocean water (not inland water or beaches)
/// Returns true if the position is on deep ocean water suitable for sea stacks
/// Excludes rivers, lakes, beaches, and DeepSea (outer ring - no spawns)
pub fn is_position_on_ocean_water(ctx: &ReducerContext, pos_x: f32, pos_y: f32) -> bool {
    // Convert pixel position to tile coordinates
    let tile_x = (pos_x / TILE_SIZE_PX as f32).floor() as i32;
    let tile_y = (pos_y / TILE_SIZE_PX as f32).floor() as i32;
    
    // Check bounds
    if tile_x < 0 || tile_y < 0 || 
       tile_x >= WORLD_WIDTH_TILES as i32 || tile_y >= WORLD_HEIGHT_TILES as i32 {
        return false; // Treat out-of-bounds as not suitable
    }
    
    // NEW: Try compressed lookup first for better performance
    if let Some(tile_type) = crate::get_tile_type_at_position(ctx, tile_x, tile_y) {
        // Must be deep sea water (NOT beach, NOT inland water)
        if tile_type == crate::TileType::Sea {
            // Check if it's ocean water (not inland water like rivers/lakes)
            if !is_tile_inland_water(ctx, tile_x, tile_y) {
                // Also check that it's not too close to beach tiles
                return !is_too_close_to_beach(ctx, tile_x, tile_y);
            }
        }
        // Explicitly reject beach tiles and any other non-sea tiles
        return false;
    }
    
    // FALLBACK: Use original method if compressed data not available
    let world_tiles = ctx.db.world_tile();
    
    // Use the multi-column index to efficiently find the tile at (world_x, world_y)
    for tile in world_tiles.idx_world_position().filter((tile_x, tile_y)) {
        // Must be deep sea water (NOT hot springs, NOT beach, NOT inland water)
        if tile.tile_type == crate::TileType::Sea {
            // Check if it's ocean water (not inland water like rivers/lakes)
            if !is_tile_inland_water(ctx, tile_x, tile_y) {
                // Also check that it's not too close to beach tiles
                return !is_too_close_to_beach(ctx, tile_x, tile_y);
            }
        }
    }
    
    // If no tile found at these exact coordinates, default to not suitable
    false
}

/// Checks if the given world position is on a water tile (Sea or HotSpringWater)
/// Returns true if the position is on water and resources/placeables should NOT spawn there
/// NEW: Uses compressed chunk data for much better performance
pub fn is_position_on_water(ctx: &ReducerContext, pos_x: f32, pos_y: f32) -> bool {
    // Convert pixel position to tile coordinates
    let tile_x = (pos_x / TILE_SIZE_PX as f32).floor() as i32;
    let tile_y = (pos_y / TILE_SIZE_PX as f32).floor() as i32;
    
    // Check bounds
    if tile_x < 0 || tile_y < 0 || 
       tile_x >= WORLD_WIDTH_TILES as i32 || tile_y >= WORLD_HEIGHT_TILES as i32 {
        return true; // Treat out-of-bounds as water
    }
    
    // NEW: Try compressed lookup first for better performance
    if let Some(tile_type) = crate::get_tile_type_at_position(ctx, tile_x, tile_y) {
        return tile_type.is_water(); // Includes both Sea and HotSpringWater
    }
    
    // FALLBACK: Use original method if compressed data not available
    let world_tiles = ctx.db.world_tile();
    
    // Use the multi-column index to efficiently find the tile at (world_x, world_y)
    for tile in world_tiles.idx_world_position().filter((tile_x, tile_y)) {
        return tile.tile_type.is_water(); // Includes both Sea and HotSpringWater
    }
    
    // If no tile found at these exact coordinates, default to non-water
    return false;
}

/// DISABLED: Smart water check for grass spawning - grass spawning disabled for performance
/// This function is no longer used as grass spawning has been completely disabled
#[allow(dead_code)]
fn is_grass_water_check_blocked(ctx: &ReducerContext, pos_x: f32, pos_y: f32, _grass_type: &crate::grass::GrassAppearanceType) -> bool {
    let is_water_tile = is_position_on_water(ctx, pos_x, pos_y);
    // Land foliage should spawn on land tiles, so block if on water
    is_water_tile
}

/// Checks if the given position is on inland water (rivers/lakes) rather than ocean water
/// Returns true for rivers and lakes, false for ocean and land
pub fn is_position_on_inland_water(ctx: &ReducerContext, pos_x: f32, pos_y: f32) -> bool {
    // Convert pixel position to tile coordinates
    let tile_x = (pos_x / TILE_SIZE_PX as f32).floor() as i32;
    let tile_y = (pos_y / TILE_SIZE_PX as f32).floor() as i32;
    
    // Check bounds
    if tile_x < 0 || tile_y < 0 || 
       tile_x >= WORLD_WIDTH_TILES as i32 || tile_y >= WORLD_HEIGHT_TILES as i32 {
        return false; // Treat out-of-bounds as not inland water
    }
    
    // Find the tile at this position
    let world_tiles = ctx.db.world_tile();
    for tile in world_tiles.idx_world_position().filter((tile_x, tile_y)) {
        if tile.tile_type.is_water() { // Includes both Sea and HotSpringWater
            // It's a water tile, now determine if it's inland or ocean water
            return is_tile_inland_water(ctx, tile_x, tile_y);
        }
    }
    
    false // Not a water tile
}

/// Helper function to determine if a water tile is inland (river/lake) vs ocean
/// Uses aggressive coastal zone detection - most water is salty except deep inland areas
pub fn is_tile_inland_water(ctx: &ReducerContext, tile_x: i32, tile_y: i32) -> bool {
    // First, verify this is actually a water tile
    let world_tiles = ctx.db.world_tile();
    let mut is_water = false;
    for tile in world_tiles.idx_world_position().filter((tile_x, tile_y)) {
        is_water = tile.tile_type.is_water(); // Includes both Sea and HotSpringWater
        break;
    }
    
    if !is_water {
        return false; // Not water, so not inland water either
    }
    
    // BALANCED COASTAL ZONE: Make coastal water salty, keep inland lakes/rivers fresh
    // Use a reasonable percentage of map size for realistic coastal zones
    let map_width = WORLD_WIDTH_TILES as f32;
    let map_height = WORLD_HEIGHT_TILES as f32;
    
    // Coastal zone extends 20% into the map from each edge (40% total coastal coverage)
    let coastal_zone_x = (map_width * 0.2) as i32;
    let coastal_zone_y = (map_height * 0.2) as i32;
    
    // Calculate distance from each edge
    let distance_from_left = tile_x;
    let distance_from_right = (WORLD_WIDTH_TILES as i32) - 1 - tile_x;
    let distance_from_top = tile_y;
    let distance_from_bottom = (WORLD_HEIGHT_TILES as i32) - 1 - tile_y;
    
    // Check if we're in the coastal zone from any direction
    let in_coastal_zone = distance_from_left < coastal_zone_x ||
                         distance_from_right < coastal_zone_x ||
                         distance_from_top < coastal_zone_y ||
                         distance_from_bottom < coastal_zone_y;
    
    // If in coastal zone, water is salty (return false for "not inland")
    // Only the very center of large landmasses has fresh water
    !in_coastal_zone
}

/// Checks if a position is on shore (land tile adjacent to water)
/// Returns true if the position is NOT on water AND has at least one adjacent water tile.
/// Used for placing fish traps which must be on land but next to water.
pub fn is_position_on_shore(ctx: &ReducerContext, pos_x: f32, pos_y: f32) -> bool {
    // Must NOT be on water itself
    if is_position_on_water(ctx, pos_x, pos_y) {
        return false;
    }
    
    // Convert pixel position to tile coordinates
    let tile_x = (pos_x / TILE_SIZE_PX as f32).floor() as i32;
    let tile_y = (pos_y / TILE_SIZE_PX as f32).floor() as i32;
    
    // Check 8 neighboring tiles - at least one must be water
    for dy in -1..=1 {
        for dx in -1..=1 {
            // Skip the center tile (already checked above)
            if dx == 0 && dy == 0 {
                continue;
            }
            
            let check_x = tile_x + dx;
            let check_y = tile_y + dy;
            
            // Skip if out of bounds
            if check_x < 0 || check_y < 0 || 
               check_x >= WORLD_WIDTH_TILES as i32 || check_y >= WORLD_HEIGHT_TILES as i32 {
                continue;
            }
            
            // Check if neighboring tile is water
            if let Some(tile_type) = crate::get_tile_type_at_position(ctx, check_x, check_y) {
                if tile_type.is_water() {
                    return true; // Found adjacent water - this is a shore position
                }
            }
        }
    }
    
    false // No adjacent water tiles found
}

/// Checks if a position is within a certain distance of shore (land adjacent to water)
/// Returns true if the position is within max_distance_px pixels of any shore tile.
/// Used for placing fish traps which can be placed in water near shore.
/// 
/// OPTIMIZED: O(1) average case - early exits when shore found.
/// Instead of checking every tile for "is shore", we:
/// 1. Check if current position is directly on shore (common case) → O(8) neighbor checks
/// 2. Find nearest water/land boundary by checking if we're on water or land,
///    then searching outward in expanding rings until we find the opposite type
pub fn is_position_near_shore(ctx: &ReducerContext, pos_x: f32, pos_y: f32, max_distance_px: f32) -> bool {
    // Fast path: Check if we're directly on shore (most common valid placement)
    if is_position_on_shore(ctx, pos_x, pos_y) {
        return true;
    }
    
    // Determine if we're on water or land
    let on_water = is_position_on_water(ctx, pos_x, pos_y);
    
    // Convert to tile coordinates
    let center_tile_x = (pos_x / TILE_SIZE_PX as f32).floor() as i32;
    let center_tile_y = (pos_y / TILE_SIZE_PX as f32).floor() as i32;
    
    // Max search radius in tiles
    let max_radius_tiles = ((max_distance_px / TILE_SIZE_PX as f32).ceil() as i32) + 1;
    let max_dist_sq = max_distance_px * max_distance_px;
    
    // Expand outward in rings - find the nearest tile of opposite type
    // This is efficient because shore is at the boundary, so we'll find it quickly
    for ring in 1..=max_radius_tiles {
        // Check tiles on the perimeter of this ring
        for i in -ring..=ring {
            // Check 4 edges of the ring
            let checks = [
                (center_tile_x + i, center_tile_y - ring), // Top edge
                (center_tile_x + i, center_tile_y + ring), // Bottom edge
                (center_tile_x - ring, center_tile_y + i), // Left edge
                (center_tile_x + ring, center_tile_y + i), // Right edge
            ];
            
            for (check_x, check_y) in checks {
                // Skip if out of bounds
                if check_x < 0 || check_y < 0 || 
                   check_x >= WORLD_WIDTH_TILES as i32 || check_y >= WORLD_HEIGHT_TILES as i32 {
                    continue;
                }
                
                // Check tile type at this position
                if let Some(tile_type) = crate::get_tile_type_at_position(ctx, check_x, check_y) {
                    let tile_is_water = tile_type.is_water();
                    
                    // We found a boundary (water/land transition) = shore nearby
                    if tile_is_water != on_water {
                        // Calculate actual pixel distance to this tile
                        let tile_center_x = (check_x as f32 + 0.5) * TILE_SIZE_PX as f32;
                        let tile_center_y = (check_y as f32 + 0.5) * TILE_SIZE_PX as f32;
                        let dx = pos_x - tile_center_x;
                        let dy = pos_y - tile_center_y;
                        let dist_sq = dx * dx + dy * dy;
                        
                        if dist_sq <= max_dist_sq {
                            return true; // Found shore within range
                        }
                    }
                }
            }
        }
        
        // Early exit: if the minimum distance of this ring exceeds max_distance, stop
        let min_ring_dist = (ring - 1) as f32 * TILE_SIZE_PX as f32;
        if min_ring_dist * min_ring_dist > max_dist_sq {
            break;
        }
    }
    
    false // No shore found within range
}

/// Detects if a position is in a lake-like area (larger contiguous water body) vs a river
/// Checks if the given world position is in deep sea (far from shore)
/// Returns true if position is on Sea tile and at least min_distance_tiles from shore
pub fn is_position_in_deep_sea(ctx: &ReducerContext, pos_x: f32, pos_y: f32, min_distance_tiles: f32) -> bool {
    // Convert pixel position to tile coordinates
    let tile_x = (pos_x / TILE_SIZE_PX as f32).floor() as i32;
    let tile_y = (pos_y / TILE_SIZE_PX as f32).floor() as i32;
    
    // Check bounds
    if tile_x < 0 || tile_y < 0 || 
       tile_x >= WORLD_WIDTH_TILES as i32 || tile_y >= WORLD_HEIGHT_TILES as i32 {
        return false;
    }
    
    // Check if tile is Sea type
    let tile_type = if let Some(tile_type) = crate::get_tile_type_at_position(ctx, tile_x, tile_y) {
        tile_type
    } else {
        return false;
    };
    
    // DeepSea tiles are by definition in deep sea
    if tile_type == crate::TileType::DeepSea {
        return true;
    }
    if tile_type != crate::TileType::Sea {
        return false; // Must be sea water
    }
    
    // Check if it's inland water (rivers/lakes)
    if is_tile_inland_water(ctx, tile_x, tile_y) {
        return false;
    }
    
    // Check distance to nearest shore/beach tile
    let min_distance_px = min_distance_tiles * TILE_SIZE_PX as f32;
    let search_radius = (min_distance_tiles + 2.0) as i32; // Search slightly beyond minimum
    
    for dy in -search_radius..=search_radius {
        for dx in -search_radius..=search_radius {
            let check_x = tile_x + dx;
            let check_y = tile_y + dy;
            
            // Skip if out of bounds
            if check_x < 0 || check_y < 0 || 
               check_x >= WORLD_WIDTH_TILES as i32 || check_y >= WORLD_WIDTH_TILES as i32 {
                continue;
            }
            
            // Calculate distance
            let dist_px = ((dx as f32).powi(2) + (dy as f32).powi(2)).sqrt() * TILE_SIZE_PX as f32;
            if dist_px < min_distance_px {
                // Check if this nearby tile is beach/land (shore)
                if let Some(nearby_tile_type) = crate::get_tile_type_at_position(ctx, check_x, check_y) {
                    if matches!(nearby_tile_type, crate::TileType::Beach | crate::TileType::Sand | crate::TileType::Grass | crate::TileType::Dirt) {
                        return false; // Too close to shore
                    }
                }
            }
        }
    }
    
    true // Far enough from shore
}

/// Returns true for lake areas, false for rivers or smaller water bodies
fn is_position_in_lake_area(ctx: &ReducerContext, pos_x: f32, pos_y: f32) -> bool {
    // Convert pixel position to tile coordinates
    let center_tile_x = (pos_x / TILE_SIZE_PX as f32).floor() as i32;
    let center_tile_y = (pos_y / TILE_SIZE_PX as f32).floor() as i32;
    
    // Count water tiles in a larger area around this position
    let lake_detection_radius = 6; // Check 6 tiles in each direction (13x13 area)
    let mut water_tile_count = 0;
    let mut total_tiles_checked = 0;
    
    let world_tiles = ctx.db.world_tile();
    
    for dy in -lake_detection_radius..=lake_detection_radius {
        for dx in -lake_detection_radius..=lake_detection_radius {
            let check_x = center_tile_x + dx;
            let check_y = center_tile_y + dy;
            
            // Skip if out of bounds
            if check_x < 0 || check_y < 0 || 
               check_x >= WORLD_WIDTH_TILES as i32 || check_y >= WORLD_HEIGHT_TILES as i32 {
                continue;
            }
            
            total_tiles_checked += 1;
            
            // Check if this tile is water
            for tile in world_tiles.idx_world_position().filter((check_x, check_y)) {
                if tile.tile_type.is_water() { // Includes both Sea and HotSpringWater
                    water_tile_count += 1;
                }
                break; // Only check the first tile found at this position
            }
        }
    }
    
    // Calculate water density in the area
    let water_density = if total_tiles_checked > 0 {
        water_tile_count as f32 / total_tiles_checked as f32
    } else {
        0.0
    };
    
    // Lakes have high water density (lots of water tiles clustered together)
    // Rivers have lower water density (water tiles more spread out in linear patterns)
    let lake_water_density_threshold = 0.35; // At least 35% of area should be water for a lake
    
    water_density >= lake_water_density_threshold
}

/// Checks if position is suitable for wild animal spawning based on species preferences
/// Different animal species prefer different terrain types and locations
pub fn is_wild_animal_location_suitable(ctx: &ReducerContext, pos_x: f32, pos_y: f32, species: AnimalSpecies, tree_positions: &[(f32, f32)]) -> bool {
    if crate::wild_animal_npc::core::is_position_in_alk_wildlife_zone(ctx, pos_x, pos_y) {
        return false;
    }
    // Exclude outer deep sea ring - no spawns in the empty ocean perimeter
    if is_position_in_outer_deep_sea_ring(pos_x, pos_y) {
        return false;
    }
    
    // Convert pixel position to tile coordinates
    let tile_x = (pos_x / TILE_SIZE_PX as f32).floor() as i32;
    let tile_y = (pos_y / TILE_SIZE_PX as f32).floor() as i32;
    
    let world_tiles = ctx.db.world_tile();
    let mut tile_type = TileType::Grass; // Default
    
    // Get the tile type at this position
    for tile in world_tiles.idx_world_position().filter((tile_x, tile_y)) {
        tile_type = tile.tile_type;
        break;
    }
    
    // Block water tiles for NON-AQUATIC animals only.
    // SalmonShark and Jellyfish REQUIRE Sea tiles to spawn - they must reach their species-specific logic.
    // BeachCrab and Tern can spawn on water within tide pools (coastal inlets - they stick to these zones)
    let is_aquatic_species = matches!(species, AnimalSpecies::SalmonShark | AnimalSpecies::Jellyfish);
    let is_tide_pool_species = matches!(species, AnimalSpecies::BeachCrab | AnimalSpecies::Tern);
    let in_tide_pool = is_tide_pool_species && is_position_in_tide_pool(ctx, pos_x, pos_y);
    if tile_type.is_water() && !is_aquatic_species && !(is_tide_pool_species && in_tide_pool) {
        return false;
    }
    
    match species {
        AnimalSpecies::CinderFox => {
            // RELAXED: Tundra Wolf can spawn on any grassland or dirt - more flexible
            if !matches!(tile_type, TileType::Grass | TileType::Dirt | TileType::DirtRoad) {
                return false;
            }
            
            // REMOVED: Forest preference requirement - foxes can spawn anywhere suitable
            true // Accept any suitable land tile
        }
        
        AnimalSpecies::TundraWolf => {
            // RELAXED: Tundra Wolf can spawn on any grassland or dirt - more flexible
            if !matches!(tile_type, TileType::Grass | TileType::Dirt | TileType::DirtRoad) {
                return false;
            }
            
            // REMOVED: Open area preference requirement - wolves can spawn near trees too
            true // Accept any suitable land tile
        }
        
        AnimalSpecies::CableViper => {
            // REVERTED: Cable Viper can spawn on almost any land tile - much more permissive
            if !matches!(tile_type, TileType::Grass | TileType::Dirt | TileType::Beach | TileType::Sand | TileType::DirtRoad) {
                return false;
            }
            
            // REMOVED: Complex terrain preference logic - vipers can spawn anywhere suitable like before
            true // Accept any suitable land tile
        }
        
        AnimalSpecies::ArcticWalrus => {
            // 🦭 WALRUS BEACH REQUIREMENT: Must spawn on beach tiles or coastal areas
            if matches!(tile_type, TileType::Beach) {
                return true; // Perfect beach habitat
            }
            
            // Also allow coastal areas (grass/dirt adjacent to water)
            if matches!(tile_type, TileType::Grass | TileType::Dirt) {
                // Check if adjacent to water or beach (within 1 tile)
                for dy in -1..=1 {
                    for dx in -1..=1 {
                        if dx == 0 && dy == 0 { continue; }
                        
                        let check_x = tile_x + dx;
                        let check_y = tile_y + dy;
                        
                        // Check bounds
                        if check_x < 0 || check_y < 0 || 
                           check_x >= WORLD_WIDTH_TILES as i32 || check_y >= WORLD_HEIGHT_TILES as i32 {
                            continue;
                        }
                        
                        // Check if adjacent tile is water or beach (efficient chunk-based lookup)
                        if let Some(adj_tile_type) = crate::get_tile_type_at_position(ctx, check_x, check_y) {
                            if matches!(adj_tile_type, TileType::Sea | TileType::Beach) {
                                return true; // Coastal area suitable for walrus
                            }
                        }
                    }
                }
            }
            
            false // Not on beach or coastal area
        }
        
        AnimalSpecies::BeachCrab => {
            // 🦀 CRAB TIDE POOL: Spawn on beach OR water within tide pool (they can swim in the inlet)
            if in_tide_pool && tile_type.is_water() {
                return true; // Water in tide pool inlet - crabs swim here
            }
            if matches!(tile_type, TileType::Beach) {
                return true; // Perfect beach habitat for crabs
            }
            
            // Also allow sand tiles adjacent to beach or water
            if matches!(tile_type, TileType::Sand) {
                // Check if adjacent to water or beach (within 1 tile)
                for dy in -1..=1 {
                    for dx in -1..=1 {
                        if dx == 0 && dy == 0 { continue; }
                        
                        let check_x = tile_x + dx;
                        let check_y = tile_y + dy;
                        
                        // Check bounds
                        if check_x < 0 || check_y < 0 || 
                           check_x >= WORLD_WIDTH_TILES as i32 || check_y >= WORLD_HEIGHT_TILES as i32 {
                            continue;
                        }
                        
                        // Check if adjacent tile is water or beach (efficient chunk-based lookup)
                        if let Some(adj_tile_type) = crate::get_tile_type_at_position(ctx, check_x, check_y) {
                            if matches!(adj_tile_type, TileType::Sea | TileType::Beach) {
                                return true; // Coastal area suitable for crab
                            }
                        }
                    }
                }
            }
            
            false // Not on beach or sandy coastal area
        }
        
        AnimalSpecies::Tern => {
            // 🐦 TERN TIDE POOL: Spawn on beach OR water within tide pool (like crabs)
            if in_tide_pool && tile_type.is_water() {
                return true; // Water in tide pool - terns hunt here
            }
            if matches!(tile_type, TileType::Beach) {
                return true; // Perfect beach habitat for terns
            }
            
            // Also allow grass/sand adjacent to beach or water (coastal)
            if matches!(tile_type, TileType::Grass | TileType::Sand) {
                // Check if adjacent to water or beach (within 1 tile)
                for dy in -1..=1 {
                    for dx in -1..=1 {
                        if dx == 0 && dy == 0 { continue; }
                        
                        let check_x = tile_x + dx;
                        let check_y = tile_y + dy;
                        
                        // Check bounds
                        if check_x < 0 || check_y < 0 || 
                           check_x >= WORLD_WIDTH_TILES as i32 || check_y >= WORLD_HEIGHT_TILES as i32 {
                            continue;
                        }
                        
                        // Check if adjacent tile is water or beach (efficient chunk-based lookup)
                        if let Some(adj_tile_type) = crate::get_tile_type_at_position(ctx, check_x, check_y) {
                            if matches!(adj_tile_type, TileType::Sea | TileType::Beach) {
                                return true; // Coastal area suitable for tern
                            }
                        }
                    }
                }
            }
            
            false // Not on beach or coastal area
        }
        
        AnimalSpecies::Crow => {
            // 🐦‍⬛ CROW INLAND REQUIREMENT: Crows spawn inland on grass, dirt, and near trees
            // They explicitly avoid beaches and coastal areas
            if matches!(tile_type, TileType::Beach | TileType::Sand) {
                return false; // Crows don't like beaches
            }
            
            // Check if too close to water (avoid coastal, 2 tile radius)
            for dy in -2..=2 {
                for dx in -2..=2 {
                    if dx == 0 && dy == 0 { continue; }
                    
                    let check_x = tile_x + dx;
                    let check_y = tile_y + dy;
                    
                    // Check bounds
                    if check_x < 0 || check_y < 0 || 
                       check_x >= WORLD_WIDTH_TILES as i32 || check_y >= WORLD_HEIGHT_TILES as i32 {
                        continue;
                    }
                    
                    // Check if nearby tile is water or beach (efficient chunk-based lookup)
                    if let Some(adj_tile_type) = crate::get_tile_type_at_position(ctx, check_x, check_y) {
                        if matches!(adj_tile_type, TileType::Sea | TileType::Beach) {
                            return false; // Too close to coast for crow
                        }
                    }
                }
            }
            
            // Must be on grass, dirt, or road
            if !matches!(tile_type, TileType::Grass | TileType::Dirt | TileType::DirtRoad) {
                return false;
            }
            
            true // Inland area suitable for crow
        }
        
        AnimalSpecies::Vole => {
            // 🐹 VOLE HABITAT: Tundra, grassland, and forest areas - burrows in soft ground
            // Voles prefer grass, dirt, and forest floor tiles, away from beaches and water
            if matches!(tile_type, TileType::Beach | TileType::Sand | TileType::Asphalt) {
                return false; // Voles don't like beaches or hard surfaces
            }
            
            // Must be on grass, dirt, or forest - expanded habitat for better early-game availability
            if !matches!(tile_type, TileType::Grass | TileType::Dirt | TileType::DirtRoad | TileType::Tundra | TileType::Forest) {
                return false;
            }
            
            // Avoid water (check 1 tile around, efficient chunk-based lookup)
            for dy in -1..=1 {
                for dx in -1..=1 {
                    if dx == 0 && dy == 0 { continue; }
                    
                    let check_x = tile_x + dx;
                    let check_y = tile_y + dy;
                    
                    if check_x < 0 || check_y < 0 || 
                       check_x >= WORLD_WIDTH_TILES as i32 || check_y >= WORLD_HEIGHT_TILES as i32 {
                        continue;
                    }
                    
                    if let Some(adj_tile_type) = crate::get_tile_type_at_position(ctx, check_x, check_y) {
                        if matches!(adj_tile_type, TileType::Sea) {
                            return false; // Too close to water
                        }
                    }
                }
            }
            
            true // Suitable inland grassland/tundra for vole
        }
        
        AnimalSpecies::Wolverine => {
            // 🦡 WOLVERINE HABITAT: Tundra, alpine, and arctic regions
            // Wolverines prefer cold, northern terrain - they avoid beaches and coastal areas
            if matches!(tile_type, TileType::Beach | TileType::Sand) {
                return false; // Wolverines don't like beaches
            }
            
            // Prefer tundra/alpine tile types, but also accept grass/dirt in northern regions
            if matches!(tile_type, TileType::Tundra | TileType::Alpine | TileType::TundraGrass) {
                return true; // Perfect habitat
            }
            
            // Also accept grass/dirt if NOT near the coast (wolverines roam inland)
            if matches!(tile_type, TileType::Grass | TileType::Dirt | TileType::DirtRoad) {
                // Check if too close to water/beach (within 3 tiles, efficient chunk-based lookup)
                for dy in -3..=3 {
                    for dx in -3..=3 {
                        if dx == 0 && dy == 0 { continue; }
                        
                        let check_x = tile_x + dx;
                        let check_y = tile_y + dy;
                        
                        if check_x < 0 || check_y < 0 || 
                           check_x >= WORLD_WIDTH_TILES as i32 || check_y >= WORLD_HEIGHT_TILES as i32 {
                            continue;
                        }
                        
                        if let Some(adj_tile_type) = crate::get_tile_type_at_position(ctx, check_x, check_y) {
                            if matches!(adj_tile_type, TileType::Sea | TileType::Beach) {
                                return false; // Too close to coast for wolverine
                            }
                        }
                    }
                }
                return true; // Inland area suitable for wolverine
            }
            
            false // Not suitable terrain
        }
        
        AnimalSpecies::Caribou => {
            // 🦌 CARIBOU HABITAT: Tundra, alpine, and open grassland regions
            // Caribou are large herd animals that prefer open terrain for grazing
            // They avoid beaches, coastal areas, and dense forests
            if matches!(tile_type, TileType::Beach | TileType::Sand) {
                return false; // Caribou don't like beaches
            }
            
            // Perfect habitat: tundra and alpine areas
            if matches!(tile_type, TileType::Tundra | TileType::Alpine | TileType::TundraGrass) {
                return true; // Ideal habitat for caribou
            }
            
            // Also accept open grass/dirt areas (caribou graze on plains)
            if matches!(tile_type, TileType::Grass | TileType::Dirt | TileType::DirtRoad) {
                // Check if too close to water/beach (within 2 tiles, efficient chunk-based lookup)
                for dy in -2..=2 {
                    for dx in -2..=2 {
                        if dx == 0 && dy == 0 { continue; }
                        
                        let check_x = tile_x + dx;
                        let check_y = tile_y + dy;
                        
                        if check_x < 0 || check_y < 0 || 
                           check_x >= WORLD_WIDTH_TILES as i32 || check_y >= WORLD_HEIGHT_TILES as i32 {
                            continue;
                        }
                        
                        if let Some(adj_tile_type) = crate::get_tile_type_at_position(ctx, check_x, check_y) {
                            if matches!(adj_tile_type, TileType::Sea | TileType::Beach) {
                                return false; // Too close to coast for caribou
                            }
                        }
                    }
                }
                return true; // Open inland area suitable for caribou
            }
            
            false // Not suitable terrain
        }
        
        AnimalSpecies::SalmonShark => {
            // 🦈 SALMON SHARK HABITAT: Deep water only (Sea tiles)
            // Salmon Sharks are aquatic apex predators that live exclusively in open water
            // They never venture onto land - water-only entity
            if tile_type == TileType::Sea {
                return true; // Perfect habitat - open water
            }
            
            false // Sharks only spawn in Sea tiles
        }
        
        AnimalSpecies::Jellyfish => {
            // 🎐 JELLYFISH HABITAT: Deep water only (Sea tiles)
            // Jellyfish are passive aquatic creatures that drift through open water
            // They emit periodic electric shocks but don't actively chase players
            if tile_type == TileType::Sea {
                return true; // Perfect habitat - open water
            }
            
            false // Jellyfish only spawn in Sea tiles
        }
        
        // Night hostile NPCs - they use a different spawn system (player-relative)
        // These species should never go through normal animal spawning
        AnimalSpecies::Shorebound | AnimalSpecies::Shardkin | AnimalSpecies::DrownedWatch => {
            // Night hostiles don't use the normal spawn system
            // They spawn relative to player position at night only
            false
        }
        
        AnimalSpecies::Bee => {
            // Bees don't spawn in the wild - they spawn at beehives
            false
        }
        
        AnimalSpecies::PolarBear => {
            // 🐻‍❄️ POLAR BEAR HABITAT: Alpine-only apex predator
            // Polar bears are massive predators that live in the harshest alpine terrain
            // They ONLY spawn in alpine biome - true high-altitude hunters
            if matches!(tile_type, TileType::Alpine) {
                return true; // Perfect habitat - alpine regions only
            }
            
            false // Polar bears only spawn in alpine
        }
        
        AnimalSpecies::Hare => {
            // 🐰 HARE HABITAT: Alpine prey animal
            // Hares are fast, fleeing prey animals found in alpine regions
            // They prefer the cold alpine biome
            if matches!(tile_type, TileType::Alpine) {
                return true; // Perfect habitat - alpine regions
            }
            
            false // Hares only spawn in alpine
        }
        
        AnimalSpecies::SnowyOwl => {
            // 🦉 SNOWY OWL HABITAT: Alpine flying predator
            // Snowy owls are aggressive flying birds that hunt in alpine regions
            // They prefer high-altitude terrain
            if matches!(tile_type, TileType::Alpine) {
                return true; // Perfect habitat - alpine regions
            }
            
            false // Snowy owls only spawn in alpine
        }
    }
}

// --- NEW: Generic spawn location validation system ---

/// Generic spawn location validator that handles all plant spawn conditions
/// This eliminates code duplication from individual plant validation functions
pub fn validate_spawn_location(
    ctx: &ReducerContext,
    pos_x: f32,
    pos_y: f32,
    spawn_condition: &plants_database::SpawnCondition,
    tree_positions: &[(f32, f32)],
    stone_positions: &[(f32, f32)]
) -> bool {
    // Convert pixel position to tile coordinates (shared logic)
    let tile_x = (pos_x / TILE_SIZE_PX as f32).floor() as i32;
    let tile_y = (pos_y / TILE_SIZE_PX as f32).floor() as i32;
    let world_tiles = ctx.db.world_tile();
    
    // Get current tile type
    let current_tile_type = {
        let mut tile_type = None;
        for tile in world_tiles.idx_world_position().filter((tile_x, tile_y)) {
            tile_type = Some(tile.tile_type);
            break;
        }
        tile_type
    };
    
    match spawn_condition {
        plants_database::SpawnCondition::Forest => {
            // Mushrooms: Must be on grass/forest/tundra/tundragrass + near trees (within 150px)
            // OR on Forest tile type (which inherently has dense trees)
            // Tundra has arctic mushrooms that grow in mossy areas
            if !matches!(current_tile_type, Some(TileType::Grass | TileType::Forest | TileType::Tundra | TileType::TundraGrass)) {
                return false;
            }
            
            // If on Forest tile, mushrooms can spawn without being near existing trees
            // (the tile itself represents dense forest)
            if matches!(current_tile_type, Some(TileType::Forest)) {
                return true;
            }
            
            // Tundra mushrooms can spawn more freely (sparse trees, but lots of moss)
            if matches!(current_tile_type, Some(TileType::Tundra | TileType::TundraGrass)) {
                // Lower proximity requirement for tundra mushrooms (they grow in mossy areas)
                let tundra_proximity_sq = 300.0 * 300.0; // Larger search radius
                for &(tree_x, tree_y) in tree_positions {
                    let dx = pos_x - tree_x;
                    let dy = pos_y - tree_y;
                    if dx * dx + dy * dy <= tundra_proximity_sq {
                        return true;
                    }
                }
                // Tundra can also spawn mushrooms randomly (5% chance without tree proximity)
                // This simulates mushrooms growing in mossy, wet areas
                return pos_x as u32 % 20 == 0 && pos_y as u32 % 20 == 0;
            }
            
            // For grass tiles, still require proximity to trees
            let forest_distance_sq = 150.0 * 150.0;
            for &(tree_x, tree_y) in tree_positions {
                let dx = pos_x - tree_x;
                let dy = pos_y - tree_y;
                if dx * dx + dy * dy <= forest_distance_sq {
                    return true;
                }
            }
            false
        }
        
        plants_database::SpawnCondition::Plains => {
            // Hemp: Must be on grass/dirt + away from trees (>100px) + away from stones (>80px)
            // Forest tiles are too shaded for plains plants
            if !matches!(current_tile_type, Some(TileType::Grass | TileType::Dirt)) {
                return false;
            }
            
            // Check distance from trees
            let min_tree_distance_sq = 100.0 * 100.0;
            for &(tree_x, tree_y) in tree_positions {
                let dx = pos_x - tree_x;
                let dy = pos_y - tree_y;
                if dx * dx + dy * dy < min_tree_distance_sq {
                    return false;
                }
            }
            
            // Check distance from stones
            let min_stone_distance_sq = 80.0 * 80.0;
            for &(stone_x, stone_y) in stone_positions {
                let dx = pos_x - stone_x;
                let dy = pos_y - stone_y;
                if dx * dx + dy * dy < min_stone_distance_sq {
                    return false;
                }
            }
            
            true
        }
        
        plants_database::SpawnCondition::NearWater => {
            // Corn: Must have water/beach/sand nearby (within 3 tiles)
            let search_radius = 3;
            
            for dy in -search_radius..=search_radius {
                for dx in -search_radius..=search_radius {
                    let check_x = tile_x + dx;
                    let check_y = tile_y + dy;
                    
                    for tile in world_tiles.idx_world_position().filter((check_x, check_y)) {
                        if matches!(tile.tile_type, TileType::Sea | TileType::Beach | TileType::Sand) {
                            return true;
                        }
                    }
                }
            }
            false
        }
        
        plants_database::SpawnCondition::Clearings => {
            // Potato: Must be on dirt road OR (grass/dirt + away from trees >80px)
            if matches!(current_tile_type, Some(TileType::DirtRoad)) {
                return true; // Perfect for potatoes
            }
            
            if matches!(current_tile_type, Some(TileType::Dirt | TileType::Grass)) {
                // Check if it's a clearing (away from trees)
                let clearing_distance_sq = 80.0 * 80.0;
                for &(tree_x, tree_y) in tree_positions {
                    let dx = pos_x - tree_x;
                    let dy = pos_y - tree_y;
                    if dx * dx + dy * dy < clearing_distance_sq {
                        return false;
                    }
                }
                return true;
            }
            
            false
        }
        
        plants_database::SpawnCondition::Coastal => {
            // Pumpkin: Must be on beach/sand OR (grass/dirt/beach + near water within 2 tiles)
            if matches!(current_tile_type, Some(TileType::Beach | TileType::Sand)) {
                return true;
            }
            
            // Check if very close to water (riverside)
            let search_radius = 2;
            for dy in -search_radius..=search_radius {
                for dx in -search_radius..=search_radius {
                    let check_x = tile_x + dx;
                    let check_y = tile_y + dy;
                    
                    for tile in world_tiles.idx_world_position().filter((check_x, check_y)) {
                        if tile.tile_type.is_water() { // Includes both Sea and HotSpringWater
                            // Make sure we're on a reasonable tile ourselves
                            if matches!(current_tile_type, Some(TileType::Grass | TileType::Dirt | TileType::Beach)) {
                                return true;
                            }
                        }
                    }
                }
            }
            false
        }
        
        plants_database::SpawnCondition::InlandWater => {
            // Reed: Must spawn DIRECTLY IN inland water tiles (not on edges)
            // Check if the spawn position itself is an inland water tile
            for tile in world_tiles.idx_world_position().filter((tile_x, tile_y)) {
                // Must be a water tile (Sea or HotSpringWater) AND inland water (not ocean)
                if tile.tile_type.is_water() && is_tile_inland_water(ctx, tile_x, tile_y) {
                    return true;
                }
                break;
            }
            false
        }
        
        plants_database::SpawnCondition::Tundra => {
            // Tundra-specific plants: Must be on Tundra or TundraGrass tile type
            matches!(current_tile_type, Some(TileType::Tundra | TileType::TundraGrass))
        }
        
        plants_database::SpawnCondition::Alpine => {
            // Alpine-specific plants: Must be on Alpine tile type
            matches!(current_tile_type, Some(TileType::Alpine))
        }
        
        plants_database::SpawnCondition::Underwater => {
            // Underwater plants (seaweed): Must be in sea water
            // Seaweed can spawn in Sea tiles - just needs to be in ocean water
            if !matches!(current_tile_type, Some(TileType::Sea)) {
                return false;
            }
            
            // Check a large radius to ensure seaweed spawns well offshore - far from any shoreline
            // Seaweed beds grow in deeper water, not in shallow coastal areas
            const MIN_SHORE_DISTANCE_TILES: i32 = 8;
            
            for dy in -MIN_SHORE_DISTANCE_TILES..=MIN_SHORE_DISTANCE_TILES {
                for dx in -MIN_SHORE_DISTANCE_TILES..=MIN_SHORE_DISTANCE_TILES {
                    // Skip the center tile (already checked above)
                    if dx == 0 && dy == 0 {
                        continue;
                    }
                    
                    let check_x = tile_x + dx;
                    let check_y = tile_y + dy;
                    
                    // Bounds check
                    if check_x < 0 || check_y < 0 || 
                       check_x >= WORLD_WIDTH_TILES as i32 || check_y >= WORLD_WIDTH_TILES as i32 {
                        continue;
                    }
                    
                    if let Some(nearby_tile_type) = crate::get_tile_type_at_position(ctx, check_x, check_y) {
                        // If nearby tile is land/beach, this is too close to shore
                        if !nearby_tile_type.is_water() && nearby_tile_type != TileType::Quarry {
                            return false;
                        }
                    }
                }
            }
            true // Valid underwater spawn location - at least 8 tiles from shore (deep water only)
        }
    }
}

// --- Cairn Seeding ---

/// Seed all 14 cairns across the map in valid biomes
fn seed_cairns(ctx: &ReducerContext) -> Result<(), String> {
    use crate::cairn::cairn as CairnTableTrait;
    
    let cairns = ctx.db.cairn();
    
    // Check if cairns already exist
    if cairns.count() > 0 {
        log::info!("Cairns already seeded ({} existing), skipping", cairns.count());
        return Ok(());
    }
    
    // All 14 lore IDs matching CAIRN_LORE_TIDBITS
    let lore_ids = vec![
        "cairn_volcanic_spine",
        "cairn_shards_what_are_they",
        "cairn_alk_purpose",
        "cairn_ghost_network",
        "cairn_aleuts_original_inhabitants",
        "cairn_aleuts_under_alk",
        "cairn_directorate_origins",
        "cairn_the_freeze",
        "cairn_compound_purpose",
        "cairn_survival_loop",
        "cairn_the_trap",
        "cairn_my_adaptation",
        "cairn_encoded_markers",
        "cairn_shared_substrate",
    ];
    
    let target_cairn_count = lore_ids.len() as u32;
    log::info!("Seeding {} cairns across the map...", target_cairn_count);
    
    let mut rng = ctx.rng();
    let (min_tile_x, max_tile_x, min_tile_y, max_tile_y) = 
        calculate_tile_bounds(WORLD_WIDTH_TILES, WORLD_HEIGHT_TILES, 5); // 5 tile margin
    
    // Collect existing entity positions for distance checking
    let spawned_tree_positions: Vec<(f32, f32)> = ctx.db.tree().iter()
        .map(|tree| (tree.pos_x, tree.pos_y))
        .collect();
    let spawned_stone_positions: Vec<(f32, f32)> = ctx.db.stone().iter()
        .map(|stone| (stone.pos_x, stone.pos_y))
        .collect();
    let spawned_rune_stone_positions: Vec<(f32, f32)> = ctx.db.rune_stone().iter()
        .map(|rune_stone| (rune_stone.pos_x, rune_stone.pos_y))
        .collect();
    let mut spawned_cairn_positions: Vec<(f32, f32)> = Vec::new();
    
    let mut spawned_cairn_count = 0;
    let mut cairn_attempts = 0;
    let max_cairn_attempts = target_cairn_count * 120; // Extra attempts: many landmark exclusion zones
    
    // Shuffle lore IDs to randomize which cairn gets which lore
    use rand::seq::SliceRandom;
    let mut shuffled_lore_ids = lore_ids.clone();
    shuffled_lore_ids.shuffle(&mut rng);
    
    while spawned_cairn_count < target_cairn_count && cairn_attempts < max_cairn_attempts {
        cairn_attempts += 1;
        
        // Generate random position
        let tile_x = rng.gen_range(min_tile_x..max_tile_x);
        let tile_y = rng.gen_range(min_tile_y..max_tile_y);
        let pos_x = (tile_x as f32 + 0.5) * TILE_SIZE_PX as f32;
        let pos_y = (tile_y as f32 + 0.5) * TILE_SIZE_PX as f32;
        
        // Check biome - only spawn in Grass, Forest, Beach, Tundra, Alpine
        let world_tiles = ctx.db.world_tile();
        let mut valid_biome = false;
        for tile in world_tiles.idx_world_position().filter((tile_x as i32, tile_y as i32)) {
            match tile.tile_type {
                crate::TileType::Grass | 
                crate::TileType::Forest | 
                crate::TileType::Beach |
                crate::TileType::Tundra |
                crate::TileType::TundraGrass |
                crate::TileType::Alpine => {
                    valid_biome = true;
                }
                _ => {}
            }
            break;
        }
        
        if !valid_biome {
            continue; // Skip invalid biomes
        }
        
        // Check water
        if is_position_on_water(ctx, pos_x, pos_y) || 
           is_position_on_inland_water(ctx, pos_x, pos_y) ||
           is_position_in_central_compound(pos_x, pos_y) {
            continue;
        }
        
        // Check minimum distance from other cairns
        let too_close_to_cairn = spawned_cairn_positions.iter().any(|(other_x, other_y)| {
            let dx = pos_x - other_x;
            let dy = pos_y - other_y;
            dx * dx + dy * dy < crate::cairn::MIN_CAIRN_DISTANCE_SQ
        });
        
        if too_close_to_cairn {
            continue;
        }
        
        // Check minimum distance from trees
        let too_close_to_tree = spawned_tree_positions.iter().any(|(tree_x, tree_y)| {
            let dx = pos_x - tree_x;
            let dy = pos_y - tree_y;
            dx * dx + dy * dy < crate::cairn::MIN_CAIRN_TREE_DISTANCE_SQ
        });
        
        if too_close_to_tree {
            continue;
        }
        
        // Check minimum distance from stones
        let too_close_to_stone = spawned_stone_positions.iter().any(|(stone_x, stone_y)| {
            let dx = pos_x - stone_x;
            let dy = pos_y - stone_y;
            dx * dx + dy * dy < crate::cairn::MIN_CAIRN_STONE_DISTANCE_SQ
        });
        
        if too_close_to_stone {
            continue;
        }
        
        // Check minimum distance from rune stones
        let too_close_to_rune_stone = spawned_rune_stone_positions.iter().any(|(rune_x, rune_y)| {
            let dx = pos_x - rune_x;
            let dy = pos_y - rune_y;
            dx * dx + dy * dy < crate::cairn::MIN_CAIRN_RUNE_STONE_DISTANCE_SQ
        });
        
        if too_close_to_rune_stone {
            continue;
        }
        
        // Check minimum distance from ALK stations (central compound + substations)
        let too_close_to_alk = ctx.db.alk_station().iter().any(|station| {
            let dx = pos_x - station.world_pos_x;
            let dy = pos_y - station.world_pos_y;
            dx * dx + dy * dy < crate::cairn::MIN_CAIRN_ALK_STATION_DISTANCE_SQ
        });
        
        if too_close_to_alk {
            continue;
        }
        
        // Monuments, large/small quarries, hot springs, reed marshes, tide pools
        if is_position_too_close_to_cairn_landmarks(ctx, pos_x, pos_y) {
            continue;
        }

        // All checks passed - spawn the cairn
        let chunk_idx = calculate_chunk_index(pos_x, pos_y);
        let lore_id = shuffled_lore_ids[spawned_cairn_count as usize].clone();
        
        match cairns.try_insert(Cairn {
            id: 0,
            pos_x,
            pos_y,
            chunk_index: chunk_idx,
            lore_id: lore_id.to_string(),
        }) {
            Ok(_inserted) => {
                spawned_cairn_positions.push((pos_x, pos_y));
                spawned_cairn_count += 1;
                log::info!(
                    "Spawned cairn {} at ({:.1}, {:.1}) with lore_id: {}",
                    spawned_cairn_count, pos_x, pos_y, lore_id
                );
            }
            Err(e) => {
                log::warn!("Failed to insert cairn at ({:.1}, {:.1}): {}", pos_x, pos_y, e);
            }
        }
    }
    
    log::info!(
        "Finished seeding cairns - Total: {} (target: {}), Attempts: {}",
        spawned_cairn_count, target_cairn_count, cairn_attempts
    );
    
    Ok(())
}

// --- Environment Seeding ---

#[spacetimedb::reducer]
pub fn seed_environment(ctx: &ReducerContext) -> Result<(), String> {
    let trees = ctx.db.tree();
    let stones = ctx.db.stone();
    let harvestable_resources = ctx.db.harvestable_resource();
    let clouds = ctx.db.cloud();
    let grasses = ctx.db.grass();
    let wild_animals = ctx.db.wild_animal();
    let sea_stacks = ctx.db.sea_stack(); // Add sea stacks table
    let living_corals = ctx.db.living_coral(); // Add living coral table

    // --- Fix existing red rune stones with empty configs (race condition fix) ---
    // This runs BEFORE the early return check to fix rune stones even if environment is already seeded
    // Items must be seeded first (ensured by calling seed_items before seed_environment in identity_connected)
    let rune_stones_table = ctx.db.rune_stone();
    let mut craftable_item_ids_fix = Vec::new();
    for item_def in ctx.db.item_definition().iter() {
        if let Some(crafting_cost) = &item_def.crafting_cost {
            if !crafting_cost.is_empty() {
                // Include ALL craftable items regardless of category
                craftable_item_ids_fix.push(item_def.id);
            }
        }
    }
    
    // Fix any red rune stones with missing production configs
    if !craftable_item_ids_fix.is_empty() {
        let mut fixed_count = 0;
        
        for mut rune_stone in rune_stones_table.iter() {
            if rune_stone.rune_type == crate::rune_stone::RuneStoneType::Red {
                let needs_fix = rune_stone.production_config.is_none();
                
                if needs_fix {
                    let rune_stone_id = rune_stone.id; // Capture ID before move
                    // Create production config (no longer tracks specific items)
                    rune_stone.production_config = Some(crate::rune_stone::ProductionEffectConfig {
                        items_spawned_this_night: 0,
                        last_item_spawn_time: None,
                        night_start_time: None,
                    });
                    rune_stones_table.id().update(rune_stone);
                    fixed_count += 1;
                    log::info!("Fixed red rune stone {} with production config", rune_stone_id);
                }
            }
        }
        
        if fixed_count > 0 {
            log::info!("Fixed {} red rune stones with missing production configs", fixed_count);
        }
    }

    // Check which resources already exist (check each type individually to allow partial seeding)
    let trees_exist = trees.iter().next().is_some();
    let stones_exist = stones.iter().next().is_some();
    let harvestables_exist = harvestable_resources.iter().next().is_some();
    let clouds_exist = clouds.iter().next().is_some();
    
    if trees_exist && stones_exist && harvestables_exist && clouds_exist {
        log::info!("Environment already fully seeded. Skipping.");
        return Ok(());
    }
    
    // Log which resources will be seeded
    let mut resources_to_seed = Vec::new();
    if !trees_exist { resources_to_seed.push("trees"); }
    if !stones_exist { resources_to_seed.push("stones"); }
    if !harvestables_exist { resources_to_seed.push("harvestable resources"); }
    if !clouds_exist { resources_to_seed.push("clouds"); }
    log::info!("Seeding environment ({}). Existing: trees={}, stones={}, harvestables={}, clouds={}", 
        resources_to_seed.join(", "), trees_exist, stones_exist, harvestables_exist, clouds_exist);

    let fbm = Fbm::<Perlin>::new(ctx.rng().gen());
    let mut rng = StdRng::from_rng(ctx.rng()).map_err(|e| format!("Failed to seed RNG: {}", e))?;

    let total_tiles = crate::WORLD_WIDTH_TILES * crate::WORLD_HEIGHT_TILES;

    // Calculate targets and limits using sublinear scaling
    // Trees: 900 on 600x600 reference map, scales sublinearly to other sizes
    let target_tree_count = scale_resource_count(BASE_TREE_COUNT_600X600, total_tiles);
    let max_tree_attempts = target_tree_count * crate::tree::MAX_TREE_SEEDING_ATTEMPTS_FACTOR;
    
    // Stones: 100 on 600x600 reference map, scales sublinearly to other sizes
    let target_stone_count = scale_resource_count(BASE_STONE_COUNT_600X600, total_tiles);
    let max_stone_attempts = target_stone_count * crate::tree::MAX_TREE_SEEDING_ATTEMPTS_FACTOR;
    
    // Sea stacks: keep original density-based calculation
    let target_sea_stack_count = (total_tiles as f32 * SEA_STACK_DENSITY_PERCENT) as u32;
    let max_sea_stack_attempts = target_sea_stack_count * crate::tree::MAX_TREE_SEEDING_ATTEMPTS_FACTOR;
    
    // Living Coral: spawn in deep sea areas (coral reef zones)
    // Target 30-60 living coral nodes scaled by map size
    const BASE_LIVING_CORAL_COUNT_600X600: u32 = 45; // Base count for 600x600 map
    let target_living_coral_count = scale_resource_count(BASE_LIVING_CORAL_COUNT_600X600, total_tiles);
    let max_living_coral_attempts = target_living_coral_count * crate::tree::MAX_TREE_SEEDING_ATTEMPTS_FACTOR;

    // SEASONAL SEEDING: Calculate targets for harvestable resources based on current season
    let current_season = crate::world_state::get_current_season(ctx)
        .unwrap_or_else(|_| {
            log::warn!("Failed to get current season, defaulting to Spring for initial seeding");
            crate::world_state::Season::Spring
        });
    
    log::info!("🌱 Seeding plants for season: {:?}", current_season);
    
    // Log global plant density multiplier if not default
    if GLOBAL_PLANT_DENSITY_MULTIPLIER != 1.0 {
        log::info!("🌿 Using global plant density multiplier: {:.2}x", GLOBAL_PLANT_DENSITY_MULTIPLIER);
    }

    let mut plant_targets = std::collections::HashMap::new();
    let mut plant_attempts = std::collections::HashMap::new();
    for (plant_type, config) in plants_database::PLANT_CONFIGS.iter() {
        // SEASONAL CHECK: Only seed plants that can grow in the current season
        if plants_database::can_grow_in_season(plant_type, &current_season) {
            let target_count = (total_tiles as f32 * config.density_percent * GLOBAL_PLANT_DENSITY_MULTIPLIER) as u32;
            let max_attempts = target_count * crate::tree::MAX_TREE_SEEDING_ATTEMPTS_FACTOR;
            plant_targets.insert(plant_type.clone(), target_count);
            plant_attempts.insert(plant_type.clone(), max_attempts);
            log::debug!("🌿 {:?} can grow in {:?}: target {} plants", plant_type, current_season, target_count);
        } else {
            log::debug!("🚫 {:?} cannot grow in {:?}, skipping", plant_type, current_season);
        }
    }

    // Cloud seeding parameters
    const CLOUD_DENSITY_PERCENT: f32 = 0.005; // Example: 0.5% of tiles might have a cloud center
    const MAX_CLOUD_SEEDING_ATTEMPTS_FACTOR: u32 = 3;
    let target_cloud_count = (total_tiles as f32 * CLOUD_DENSITY_PERCENT) as u32;
    let max_cloud_attempts = target_cloud_count * MAX_CLOUD_SEEDING_ATTEMPTS_FACTOR;

    // Wild animal seeding parameters
    const WILD_ANIMAL_DENSITY_PERCENT: f32 = 0.0002;
    const MAX_WILD_ANIMAL_SEEDING_ATTEMPTS_FACTOR: u32 = 3;
    let target_wild_animal_count = (total_tiles as f32 * WILD_ANIMAL_DENSITY_PERCENT) as u32;
    let max_wild_animal_attempts = target_wild_animal_count * MAX_WILD_ANIMAL_SEEDING_ATTEMPTS_FACTOR;

    // Grass seeding parameters - OPTIMIZED: No O(n²) distance checks, so we can have more grass
    // Scale based on number of Grass/Forest tiles (biome-filtered spawning)
    let world_tiles = ctx.db.world_tile();
    let mut grass_forest_tile_count = 0u32;
    for tile in world_tiles.iter() {
        if matches!(tile.tile_type, TileType::Grass | TileType::Forest) {
            grass_forest_tile_count += 1;
        }
    }
    // Target ~12% of Grass/Forest tiles for dense "seas" of grass (scales with map size)
    // Increased from 8% to 12% to create massive contiguous grass regions
    const GRASS_DENSITY_PERCENT: f32 = 0.12; // 12% of valid tiles - creates massive grass "seas"
    let target_grass_count = (grass_forest_tile_count as f32 * GRASS_DENSITY_PERCENT) as u32;
    let max_grass_attempts = target_grass_count * crate::grass::MAX_GRASS_SEEDING_ATTEMPTS_FACTOR;

    // --- NEW: Region parameters for grass types ---
    const GRASS_REGION_SIZE_CHUNKS: u32 = 10; // Each region is 10x10 chunks
    const GRASS_REGION_SIZE_TILES: u32 = GRASS_REGION_SIZE_CHUNKS * CHUNK_SIZE_TILES;

    // Cloud drift parameters
    const CLOUD_BASE_DRIFT_X: f32 = 4.0; // Base speed in pixels per second (e.g., gentle eastward drift) - Doubled
    const CLOUD_BASE_DRIFT_Y: f32 = 1.0; // Doubled
    const CLOUD_DRIFT_VARIATION: f32 = 1.0; // Max variation from base speed

    log::info!("Target Trees: {}, Max Attempts: {}", target_tree_count, max_tree_attempts);
    log::info!("Target Stones: {}, Max Attempts: {}", target_stone_count, max_stone_attempts);
    log::info!("Target Sea Stacks: {}, Max Attempts: {}", target_sea_stack_count, max_sea_stack_attempts);
    log::info!("Target Living Coral: {}, Max Attempts: {}", target_living_coral_count, max_living_coral_attempts);
    log::info!("🌊 Hot Springs: Generated as HotSpringWater tiles during world generation (no entities)");
    
    // Log harvestable resource targets
    for (plant_type, target_count) in &plant_targets {
        let max_attempts = plant_attempts.get(plant_type).unwrap_or(&0);
        log::info!("Target {:?}: {}, Max Attempts: {}", plant_type, target_count, max_attempts);
    }
    
    log::info!("Target Clouds: {}, Max Attempts: {}", target_cloud_count, max_cloud_attempts);
    log::info!("Target Wild Animals: {}, Max Attempts: {}", target_wild_animal_count, max_wild_animal_attempts);
    log::info!("Target Grass: {} (from {} Grass/Forest tiles, {:.1}% density), Max Attempts: {}", 
        target_grass_count, grass_forest_tile_count, GRASS_DENSITY_PERCENT * 100.0, max_grass_attempts);
    // Calculate spawn bounds using helper
    let (min_tile_x, max_tile_x, min_tile_y, max_tile_y) = 
        calculate_tile_bounds(WORLD_WIDTH_TILES, WORLD_HEIGHT_TILES, crate::tree::TREE_SPAWN_WORLD_MARGIN_TILES);

    // Initialize tracking collections
    let mut occupied_tiles = HashSet::<(u32, u32)>::new();
    let mut spawned_tree_positions = Vec::<(f32, f32)>::new();
    let mut spawned_stone_positions = Vec::<(f32, f32)>::new();
    let mut spawned_sea_stack_positions = Vec::<(f32, f32)>::new();
    // REMOVED: let mut spawned_hot_spring_positions = Vec::<(f32, f32)>::new(); // No longer needed (using tile type)
    let mut spawned_harvestable_positions = Vec::<(f32, f32)>::new(); // Unified for all plants
    // REMOVED: spawned_grass_positions - no longer needed (removed O(n²) distance check for performance)
    let mut spawned_cloud_positions = Vec::<(f32, f32)>::new();
    let mut spawned_wild_animal_positions = Vec::<(f32, f32)>::new();

    let mut spawned_tree_count = 0;
    let mut tree_attempts = 0;
    let mut spawned_stone_count = 0;
    let mut stone_attempts = 0;
    let mut spawned_sea_stack_count = 0;
    let mut sea_stack_attempts = 0;
    let mut spawned_living_coral_count = 0;
    let mut living_coral_attempts = 0;
    // REMOVED: Hot spring entity counters (now using HotSpringWater tile type)
    // let mut spawned_hot_spring_count = 0;
    // let mut hot_spring_attempts = 0;
    
    // Unified tracking for harvestable resources
    let mut plant_spawned_counts = std::collections::HashMap::new();
    let mut plant_attempt_counts = std::collections::HashMap::new();
    for plant_type in plants_database::PLANT_CONFIGS.keys() {
        plant_spawned_counts.insert(plant_type.clone(), 0u32);
        plant_attempt_counts.insert(plant_type.clone(), 0u32);
    }
    
    let mut spawned_cloud_count = 0;
    let mut cloud_attempts = 0;
    let mut spawned_wild_animal_count = 0;
    let mut wild_animal_attempts = 0;
    let mut spawned_grass_count = 0;
    let mut grass_attempts = 0;

    // --- Seed Trees --- Use helper function with dense forest clustering ---
    if !trees_exist {
        log::info!("Seeding Trees with dense forest clusters (including Forest tile type)...");
        
        // Create a separate noise generator for dense forest regions
        let dense_forest_noise = Fbm::<Perlin>::new(ctx.rng().gen());
        
        while spawned_tree_count < target_tree_count && tree_attempts < max_tree_attempts {
        tree_attempts += 1;

        // Determine tree type roll and resource roll *before* calling attempt_single_spawn
        // Resource amount is computed inside closure from tree type + resource_roll
        let tree_type_roll_for_this_attempt: f64 = rng.gen_range(0.0..1.0);
        let resource_roll: f64 = rng.gen_range(0.0..1.0);

        // Create threshold function that checks position and returns appropriate threshold
        // This allows Forest tiles to have much denser tree spawning
        let threshold_fn = |pos_x: f32, pos_y: f32| -> f64 {
            // Check if this position is on a Forest tile type (new tile-based forest system)
            let is_forest_tile = is_position_on_forest_tile(ctx, pos_x, pos_y);
            
            // Check if this position is in a dense forest region (noise-based clustering)
            let dense_forest_value = dense_forest_noise.get([
                pos_x as f64 * DENSE_FOREST_NOISE_FREQUENCY,
                pos_y as f64 * DENSE_FOREST_NOISE_FREQUENCY
            ]);
            let is_noise_dense_forest = dense_forest_value > DENSE_FOREST_THRESHOLD;
            
            // Adjust spawn threshold for dense forests (lower threshold = easier to spawn)
            // Forest tiles get MUCH denser spawning - use negative threshold to always pass noise check
            // This ensures Forest tiles are truly dense with trees
            if is_forest_tile {
                -1.0 // Always pass noise check on Forest tiles (guaranteed dense forests)
            } else if is_noise_dense_forest {
                crate::tree::TREE_SPAWN_NOISE_THRESHOLD * 0.3 // Easier spawn in noise-based dense forests
            } else {
                crate::tree::TREE_SPAWN_NOISE_THRESHOLD
            }
        };
        
        // Create distance function that checks position and returns appropriate minimum distance
        let distance_fn = |pos_x: f32, pos_y: f32| -> f32 {
            // Check if this position is on a Forest tile type
            let is_forest_tile = is_position_on_forest_tile(ctx, pos_x, pos_y);
            
            // Check if this position is in a dense forest region (noise-based clustering)
            let dense_forest_value = dense_forest_noise.get([
                pos_x as f64 * DENSE_FOREST_NOISE_FREQUENCY,
                pos_y as f64 * DENSE_FOREST_NOISE_FREQUENCY
            ]);
            let is_noise_dense_forest = dense_forest_value > DENSE_FOREST_THRESHOLD;
            
            // Adjust minimum distance for dense forests (allow closer packing)
            // Forest tiles allow VERY close packing for true dense forest appearance
            if is_forest_tile {
                crate::tree::MIN_TREE_DISTANCE_SQ * 0.1 // Trees can be 90% closer on Forest tiles (very dense!)
            } else if is_noise_dense_forest {
                crate::tree::MIN_TREE_DISTANCE_SQ * 0.4 // Trees can be 60% closer in noise-based dense forests
            } else {
                crate::tree::MIN_TREE_DISTANCE_SQ
            }
        };
        
        match attempt_single_spawn(
            &mut rng,
            &mut occupied_tiles,
            &mut spawned_tree_positions,
            &[],
            &spawned_stone_positions,
            min_tile_x, max_tile_x, min_tile_y, max_tile_y,
            &fbm,
            crate::tree::TREE_SPAWN_NOISE_FREQUENCY,
            crate::tree::TREE_SPAWN_NOISE_THRESHOLD, // Base threshold (will be overridden by threshold_fn)
            crate::tree::MIN_TREE_DISTANCE_SQ, // Base distance (will be overridden by distance_fn)
            0.0,
            0.0,
            |pos_x, pos_y, (tree_type_roll, resource_roll): (f64, f64)| {
                // Calculate chunk index for the tree
                let chunk_idx = calculate_chunk_index(pos_x, pos_y);
                
                // Determine tree type based on biome and position
                let tree_type = if is_position_on_beach_tile(ctx, pos_x, pos_y) {
                    // Beach tiles: SitkaAlder variants (deciduous)
                    if tree_type_roll < 0.5 {
                        crate::tree::TreeType::SitkaAlder
                    } else {
                        crate::tree::TreeType::SitkaAlder2
                    }
                } else if is_position_on_alpine_tile(ctx, pos_x, pos_y) {
                    // Alpine biome: Mix of DwarfPine, ArcticWillow, and MountainHemlockSnow
                    if tree_type_roll < 0.45 {
                        crate::tree::TreeType::DwarfPine // 45% - common alpine conifer
                    } else if tree_type_roll < 0.80 {
                        crate::tree::TreeType::ArcticWillow // 35% - hardy deciduous shrub-tree
                    } else {
                        crate::tree::TreeType::MountainHemlockSnow // 20% - rare snow-covered conifer
                    }
                } else if is_position_on_tundra_tile(ctx, pos_x, pos_y) {
                    // Tundra biome: Mostly KrummholzSpruce (twisted wind-sculpted conifers)
                    if tree_type_roll < 0.70 {
                        crate::tree::TreeType::KrummholzSpruce // 70% - common twisted spruce
                    } else {
                        crate::tree::TreeType::DwarfPine // 30% - some dwarf pines in tundra edges
                    }
                } else if is_position_on_forest_tile(ctx, pos_x, pos_y) {
                    // Forest temperate tiles: slightly favor MountainHemlock2 (variant D)
                    // to reinforce it as a signature giant forest tree.
                    if tree_type_roll < 0.02 { // 2% chance for CrabAppleTree (rare fruit tree)
                        crate::tree::TreeType::CrabAppleTree
                    } else if tree_type_roll < 0.04 { // 2% chance for HazelnutTree (rare nut tree)
                        crate::tree::TreeType::HazelnutTree
                    } else if tree_type_roll < 0.06 { // 2% chance for RowanberryTree (rare mountain ash)
                        crate::tree::TreeType::RowanberryTree
                    } else if tree_type_roll < 0.56 { // 50% chance for SitkaSpruce (slightly reduced on forest tiles)
                        crate::tree::TreeType::SitkaSpruce
                    } else if tree_type_roll < 0.74 { // 18% chance for SiberianBirch (unchanged)
                        crate::tree::TreeType::SiberianBirch
                    } else if tree_type_roll < 0.82 { // 8% chance for MountainHemlock (variant c, unchanged)
                        crate::tree::TreeType::MountainHemlock
                    } else { // 18% chance for MountainHemlock2 (variant d, increased from 14%)
                        crate::tree::TreeType::MountainHemlock2
                    }
                } else {
                    // Temperate biome: standard tree types with weighted probability
                    // Includes rare fruit/nut trees (CrabAppleTree, HazelnutTree, RowanberryTree)
                    if tree_type_roll < 0.02 { // 2% chance for CrabAppleTree (rare fruit tree)
                        crate::tree::TreeType::CrabAppleTree
                    } else if tree_type_roll < 0.04 { // 2% chance for HazelnutTree (rare nut tree)
                        crate::tree::TreeType::HazelnutTree
                    } else if tree_type_roll < 0.06 { // 2% chance for RowanberryTree (rare mountain ash)
                        crate::tree::TreeType::RowanberryTree
                    } else if tree_type_roll < 0.60 { // 54% chance for SitkaSpruce (conifer)
                        crate::tree::TreeType::SitkaSpruce
                    } else if tree_type_roll < 0.78 { // 18% chance for SiberianBirch (deciduous)
                        crate::tree::TreeType::SiberianBirch
                    } else if tree_type_roll < 0.86 { // 8% chance for MountainHemlock (conifer - variant c)
                        crate::tree::TreeType::MountainHemlock
                    } else { // 14% chance for MountainHemlock2 (conifer - variant d)
                        crate::tree::TreeType::MountainHemlock2
                    }
                };
                
                let (health, min_wood, max_wood) = crate::tree::tree_type_stats(&tree_type);
                let range = (max_wood - min_wood) as f64;
                let resource_amount = min_wood + (resource_roll * range).round() as u32;
                
                crate::tree::Tree {
                    id: 0,
                    pos_x,
                    pos_y,
                    health,
                    resource_remaining: resource_amount,
                    tree_type,
                    chunk_index: chunk_idx, // Set the chunk index
                    last_hit_time: None,
                    respawn_at: Timestamp::UNIX_EPOCH, // 0 = not respawning
                    is_player_planted: false, // Wild trees respawn and yield full resources
                }
            },
            (tree_type_roll_for_this_attempt, resource_roll),
            |pos_x, pos_y| is_position_on_water(ctx, pos_x, pos_y) || is_position_in_central_compound(pos_x, pos_y) || is_position_in_hot_spring_area(ctx, pos_x, pos_y) || monument::is_position_near_monument(ctx, pos_x, pos_y), // Block water, central compound, hot springs, and monuments
            threshold_fn, // Position-based threshold function
            distance_fn, // Position-based distance function
            trees,
        ) {
            Ok(true) => spawned_tree_count += 1,
            Ok(false) => { /* Condition not met, continue */ }
            Err(_) => { /* Error already logged in helper, continue */ }
        }
        }
        log::info!(
            "Finished seeding {} trees (target: {}, attempts: {}).",
            spawned_tree_count, target_tree_count, tree_attempts
        );
    } else {
        log::info!("Trees already exist. Skipping tree seeding.");
    }

    // --- Seed Stones --- Use helper function ---
    if !stones_exist {
        log::info!("Seeding Stones...");
        while spawned_stone_count < target_stone_count && stone_attempts < max_stone_attempts {
        stone_attempts += 1;
        
        // Create threshold function for stones that increases density in Alpine/Tundra
        let stone_threshold_fn = |pos_x: f32, pos_y: f32| -> f64 {
            let is_alpine = is_position_on_alpine_tile(ctx, pos_x, pos_y);
            let is_tundra = is_position_on_tundra_tile(ctx, pos_x, pos_y);
            
            // Alpine: 3x density (exposed rock faces) - lower threshold = easier to spawn
            if is_alpine {
                crate::tree::TREE_SPAWN_NOISE_THRESHOLD * 0.2 // Much easier to spawn (3x density)
            } else if is_tundra {
                // Tundra: 2x density (permafrost exposure) - moderate threshold reduction
                crate::tree::TREE_SPAWN_NOISE_THRESHOLD * 0.4 // Easier to spawn (2x density)
            } else {
                crate::tree::TREE_SPAWN_NOISE_THRESHOLD // Normal density in temperate
            }
        };
        
         match attempt_single_spawn(
            &mut rng,
            &mut occupied_tiles,
            &mut spawned_stone_positions,
            &spawned_tree_positions,
            &[],
            min_tile_x, max_tile_x, min_tile_y, max_tile_y,
            &fbm,
            crate::tree::TREE_SPAWN_NOISE_FREQUENCY,
            crate::tree::TREE_SPAWN_NOISE_THRESHOLD, // Base threshold (overridden by threshold_fn)
            crate::stone::MIN_STONE_DISTANCE_SQ,
            crate::stone::MIN_STONE_TREE_DISTANCE_SQ,
            0.0,
            |pos_x, pos_y, _resource_amount: u32| {
                // Calculate chunk index for the stone
                let chunk_idx = calculate_chunk_index(pos_x, pos_y);
                
                // Determine if this position is in a quarry
                let is_in_quarry = is_position_on_monument(ctx, pos_x, pos_y);
                
                // Check biome for ore type probability adjustment
                let is_alpine = is_position_on_alpine_tile(ctx, pos_x, pos_y);
                let is_tundra = is_position_on_tundra_tile(ctx, pos_x, pos_y);
                
                // Create a deterministic RNG seeded from position for ore type selection
                // This ensures consistent ore type per position while appearing random
                let position_seed: u64 = ((pos_x as u64) << 32) ^ (pos_y as u64);
                let mut position_rng = StdRng::seed_from_u64(position_seed);
                
                // Determine ore type based on location FIRST (with biome-specific adjustments)
                let ore_type = crate::stone::OreType::random_for_location_with_biome(pos_x, pos_y, is_in_quarry, is_alpine, is_tundra, &mut position_rng);
                
                // Set resource amount based on ore type
                // Stone: Basic building material (500-1000)
                // Metal/Sulfur: Rarer materials (~50% of stone yield, 250-500)
                // Memory: Tech tree upgrades (120-180)
                let resource_amount = match ore_type {
                    crate::stone::OreType::Stone => {
                        position_rng.gen_range(crate::stone::STONE_MIN_RESOURCES..=crate::stone::STONE_MAX_RESOURCES)
                    },
                    crate::stone::OreType::Metal => {
                        position_rng.gen_range(crate::stone::METAL_ORE_MIN_RESOURCES..=crate::stone::METAL_ORE_MAX_RESOURCES)
                    },
                    crate::stone::OreType::Sulfur => {
                        position_rng.gen_range(crate::stone::SULFUR_ORE_MIN_RESOURCES..=crate::stone::SULFUR_ORE_MAX_RESOURCES)
                    },
                    crate::stone::OreType::Memory => {
                        position_rng.gen_range(crate::stone::MEMORY_SHARD_MIN_RESOURCES..=crate::stone::MEMORY_SHARD_MAX_RESOURCES)
                    },
                };
                
                crate::stone::Stone {
                    id: 0,
                    pos_x,
                    pos_y,
                    health: crate::stone::STONE_INITIAL_HEALTH,
                    resource_remaining: resource_amount, // Set based on ore type
                    ore_type, // Set the ore type based on location
                    chunk_index: chunk_idx, // Set the chunk index
                    last_hit_time: None,
                    respawn_at: Timestamp::UNIX_EPOCH, // 0 = not respawning
                }
            },
            0u32, // Dummy value - resource amount is now determined inside the closure
            |pos_x, pos_y| is_position_on_water(ctx, pos_x, pos_y) || is_position_in_central_compound(pos_x, pos_y) || is_position_in_hot_spring_area(ctx, pos_x, pos_y) || monument::is_position_near_monument(ctx, pos_x, pos_y), // Block water, central compound, hot springs, and monuments for stones
            stone_threshold_fn, // Biome-specific threshold for stones (Alpine 3x, Tundra 2x density)
            |_pos_x, _pos_y| crate::stone::MIN_STONE_DISTANCE_SQ, // Base distance for stones
            stones,
        ) {
            Ok(true) => spawned_stone_count += 1,
            Ok(false) => { /* Condition not met, continue */ }
            Err(_) => { /* Error already logged in helper, continue */ }
        }
        }
        log::info!(
            "Finished seeding {} stones (target: {}, attempts: {}).",
            spawned_stone_count, target_stone_count, stone_attempts
        );
    } else {
        log::info!("Stones already exist. Skipping stone seeding.");
    }


    // --- Seed Sea Stacks --- Use helper function ---
    log::info!("Seeding Sea Stacks...");
    while spawned_sea_stack_count < target_sea_stack_count && sea_stack_attempts < max_sea_stack_attempts {
        sea_stack_attempts += 1;
        
        // Generate random scale for visual variety
        let sea_stack_scale = rng.gen_range(1.0..1.8);
        
        // Generate random variant
        let variant_roll: f64 = rng.gen_range(0.0..1.0);
        let variant = if variant_roll < 0.33 {
            SeaStackVariant::Tall
        } else if variant_roll < 0.66 {
            SeaStackVariant::Medium  
        } else {
            SeaStackVariant::Wide
        };
        
        match attempt_single_spawn(
            &mut rng,
            &mut occupied_tiles,
            &mut spawned_sea_stack_positions,
            &spawned_tree_positions,
            &spawned_stone_positions,
            min_tile_x, max_tile_x, min_tile_y, max_tile_y,
            &fbm,
            SEA_STACK_SPAWN_NOISE_FREQUENCY,
            SEA_STACK_SPAWN_NOISE_THRESHOLD,
            MIN_SEA_STACK_DISTANCE_SQ,
            MIN_SEA_STACK_TREE_DISTANCE_SQ,
            MIN_SEA_STACK_STONE_DISTANCE_SQ,
            |pos_x, pos_y, (scale, variant): (f32, SeaStackVariant)| {
                // Calculate chunk index for the sea stack
                let chunk_idx = calculate_chunk_index(pos_x, pos_y);
                
                SeaStack {
                    id: 0, // Auto-incremented
                    pos_x,
                    pos_y,
                    chunk_index: chunk_idx,
                    scale,
                    rotation: 0.0, // Sea stacks don't rotate
                    opacity: 1.0,
                    variant,
                }
            },
            (sea_stack_scale, variant), // Pass scale and variant as extra_args
            |pos_x, pos_y| !is_position_on_ocean_water(ctx, pos_x, pos_y) || is_position_in_central_compound(pos_x, pos_y) || monument::is_position_near_monument(ctx, pos_x, pos_y) || is_position_in_outer_deep_sea_ring(pos_x, pos_y), // Only spawn on ocean water, exclude outer deep sea ring
            |_pos_x, _pos_y| SEA_STACK_SPAWN_NOISE_THRESHOLD, // Base threshold for sea stacks
            |_pos_x, _pos_y| MIN_SEA_STACK_DISTANCE_SQ, // Base distance for sea stacks
            ctx.db.sea_stack(),
        ) {
            Ok(true) => spawned_sea_stack_count += 1,
            Ok(false) => { /* Condition not met, continue */ }
            Err(_) => { /* Error already logged in helper, continue */ }
        }
    }
    log::info!(
        "Finished seeding {} sea stacks (target: {}, attempts: {}).",
        spawned_sea_stack_count, target_sea_stack_count, sea_stack_attempts
    );

    // --- Seed Living Coral (in ocean water areas) ---
    // Coral reefs grow in relatively shallow coastal waters, similar to sea stacks
    // Uses same ocean water check as sea stacks - just needs to be on Sea tile, not inland water
    // Corals spawn in CLUSTERS of 2-4 for a more natural reef appearance
    log::info!("Seeding Living Coral CLUSTERS in ocean water...");
    const MIN_LIVING_CORAL_CLUSTER_DISTANCE_SQ: f32 = 300.0 * 300.0; // 300px minimum distance between cluster centers
    const CLUSTER_CORAL_OFFSET_MIN: f32 = 80.0; // Minimum offset from cluster center for additional coral
    const CLUSTER_CORAL_OFFSET_MAX: f32 = 160.0; // Maximum offset from cluster center for additional coral
    
    // Track cluster centers to maintain spacing between clusters
    let mut coral_cluster_centers: Vec<(f32, f32)> = Vec::new();
    
    // Target is now cluster count (each cluster has 2-4 corals)
    let target_cluster_count = target_living_coral_count / 3; // Divide by avg cluster size
    let mut spawned_cluster_count = 0u32;
    
    while spawned_cluster_count < target_cluster_count && living_coral_attempts < max_living_coral_attempts {
        living_coral_attempts += 1;
        
        // Random position in world for cluster center
        let cluster_x = rng.gen_range(0.0..WORLD_WIDTH_PX);
        let cluster_y = rng.gen_range(0.0..WORLD_HEIGHT_PX);
        
        // Check if position is on ocean water (same check as sea stacks - not too strict)
        if !is_position_on_ocean_water(ctx, cluster_x, cluster_y) {
            continue;
        }
        
        // Skip positions in central compound, near monuments, or in outer deep sea ring
        if is_position_in_central_compound(cluster_x, cluster_y) || monument::is_position_near_monument(ctx, cluster_x, cluster_y) || is_position_in_outer_deep_sea_ring(cluster_x, cluster_y) {
            continue;
        }
        
        // Check minimum distance from existing cluster centers
        let mut too_close = false;
        for (cx, cy) in &coral_cluster_centers {
            let dx = cluster_x - cx;
            let dy = cluster_y - cy;
            let dist_sq = dx * dx + dy * dy;
            if dist_sq < MIN_LIVING_CORAL_CLUSTER_DISTANCE_SQ {
                too_close = true;
                break;
            }
        }
        
        if too_close {
            continue;
        }
        
        // Check distance from sea stacks (coral clusters shouldn't spawn too close to sea stacks)
        for (sx, sy) in &spawned_sea_stack_positions {
            let dx = cluster_x - sx;
            let dy = cluster_y - sy;
            let dist_sq = dx * dx + dy * dy;
            if dist_sq < MIN_SEA_STACK_DISTANCE_SQ {
                too_close = true;
                break;
            }
        }
        
        if too_close {
            continue;
        }
        
        // Spawn a cluster of 2-4 corals at this location
        let cluster_size = rng.gen_range(2..=4);
        coral_cluster_centers.push((cluster_x, cluster_y));
        spawned_cluster_count += 1;
        
        // Spawn first coral at cluster center
        let chunk_idx = calculate_chunk_index(cluster_x, cluster_y);
        let living_coral = crate::coral::create_living_coral(cluster_x, cluster_y, chunk_idx, &mut rng);
        ctx.db.living_coral().insert(living_coral);
        spawned_living_coral_count += 1;
        
        // Spawn additional corals around the cluster center
        for _ in 1..cluster_size {
            let angle = rng.gen_range(0.0..std::f32::consts::PI * 2.0);
            let offset_dist = rng.gen_range(CLUSTER_CORAL_OFFSET_MIN..CLUSTER_CORAL_OFFSET_MAX);
            let coral_x = cluster_x + angle.cos() * offset_dist;
            let coral_y = cluster_y + angle.sin() * offset_dist;
            
            // Verify still in ocean water
            if !is_position_on_ocean_water(ctx, coral_x, coral_y) {
                continue;
            }
            
            let coral_chunk_idx = calculate_chunk_index(coral_x, coral_y);
            let cluster_coral = crate::coral::create_living_coral(coral_x, coral_y, coral_chunk_idx, &mut rng);
            ctx.db.living_coral().insert(cluster_coral);
            spawned_living_coral_count += 1;
        }
    }
    
    log::info!(
        "Finished seeding {} living coral nodes in {} clusters (target clusters: {}, attempts: {}).",
        spawned_living_coral_count, spawned_cluster_count, target_cluster_count, living_coral_attempts
    );

    // --- Seed Underwater Fumaroles in Coral Reef Zones ---
    // Spawn submerged fumaroles near living coral for warmth during diving
    log::info!("Seeding underwater fumaroles in coral reef zones...");
    let mut spawned_underwater_fumarole_count = 0;
    let mut underwater_fumarole_attempts = 0;
    const UNDERWATER_FUMAROLE_SPAWN_CHANCE: f32 = 0.15; // 15% chance per living coral to spawn nearby fumarole
    const MAX_UNDERWATER_FUMAROLE_ATTEMPTS: u32 = 100;
    
    // Collect living coral positions for fumarole spawning
    let living_coral_positions: Vec<(f32, f32)> = living_corals.iter()
        .filter(|c| c.respawn_at == Timestamp::UNIX_EPOCH) // Only active coral (not respawning)
        .map(|c| (c.pos_x, c.pos_y))
        .collect();
    
    for (coral_x, coral_y) in &living_coral_positions {
        if underwater_fumarole_attempts >= MAX_UNDERWATER_FUMAROLE_ATTEMPTS {
            break;
        }
        
        if rng.gen::<f32>() < UNDERWATER_FUMAROLE_SPAWN_CHANCE {
            underwater_fumarole_attempts += 1;
            
            // Spawn fumarole near coral (within 200px)
            let offset_distance = rng.gen_range(80.0..200.0);
            let angle = rng.gen_range(0.0..std::f32::consts::PI * 2.0);
            let fumarole_x = coral_x + angle.cos() * offset_distance;
            let fumarole_y = coral_y + angle.sin() * offset_distance;
            
            // Ensure still in ocean water
            if !is_position_on_ocean_water(ctx, fumarole_x, fumarole_y) {
                continue;
            }
            
            // Check minimum distance from existing fumaroles
            let mut too_close = false;
            const MIN_FUMAROLE_DISTANCE_SQ: f32 = 150.0 * 150.0;
            
            for existing_fumarole in ctx.db.fumarole().iter() {
                let dx = fumarole_x - existing_fumarole.pos_x;
                let dy = fumarole_y - existing_fumarole.pos_y;
                let dist_sq = dx * dx + dy * dy;
                if dist_sq < MIN_FUMAROLE_DISTANCE_SQ {
                    too_close = true;
                    break;
                }
            }
            
            if !too_close {
                let chunk_idx = calculate_chunk_index(fumarole_x, fumarole_y);
                let underwater_fumarole = crate::fumarole::Fumarole::new_submerged(fumarole_x, fumarole_y, chunk_idx);
                if let Ok(_) = ctx.db.fumarole().try_insert(underwater_fumarole) {
                    spawned_underwater_fumarole_count += 1;
                    // Note: Global fumarole schedule processes all fumaroles (init in lib.rs)
                }
            }
        }
    }
    
    log::info!(
        "Finished seeding {} underwater fumaroles in coral reef zones (attempts: {}).",
        spawned_underwater_fumarole_count, underwater_fumarole_attempts
    );

    // --- Seed Sea Barrels (Flotsam/Cargo Crates) around Sea Stacks ---
    log::info!("Seeding Sea Barrels (flotsam/cargo crates) around sea stacks...");
    match barrel::spawn_sea_barrels_around_stacks(ctx, &spawned_sea_stack_positions) {
        Ok(_) => {
            let total_barrels = ctx.db.barrel().iter().count();
            let sea_barrels = ctx.db.barrel().iter()
                .filter(|b| b.variant >= barrel::SEA_BARREL_VARIANT_START && b.variant < barrel::SEA_BARREL_VARIANT_END)
                .count();
            log::info!("Successfully spawned {} sea barrels (total barrels: {})", sea_barrels, total_barrels);
        }
        Err(e) => {
            log::error!("Failed to spawn sea barrels: {}", e);
        }
    }

    // --- Seed Beach Barrels (Sea Variants 3-5) on Beach Tiles ---
    log::info!("Seeding Beach Barrels (sea variants 3-5) on beach tiles...");
    match barrel::spawn_beach_barrels(ctx) {
        Ok(_) => {
            let total_barrels = ctx.db.barrel().iter().count();
            let beach_barrels = ctx.db.barrel().iter()
                .filter(|b| {
                    // Count barrels on beach tiles (all sea variants 3-5)
                    b.variant >= barrel::SEA_BARREL_VARIANT_START && 
                    b.variant < barrel::SEA_BARREL_VARIANT_END &&
                    crate::environment::is_position_on_beach_tile(ctx, b.pos_x, b.pos_y)
                })
                .count();
            log::info!("Successfully spawned {} beach barrels (total barrels: {})", beach_barrels, total_barrels);
        }
        Err(e) => {
            log::error!("Failed to spawn beach barrels: {}", e);
        }
    }

    // --- Hot Spring Decorations (Barrels + Campfire) ---
    // Hot springs are tile-based (HotSpringWater tiles) - we add atmosphere with barrels and a campfire
    log::info!("🌊 Hot springs: Finding centers and spawning decorations...");
    
    // Find hot spring centers by clustering HotSpringWater tiles
    let hot_spring_centers = find_hot_spring_centers(ctx);
    log::info!("🌊 Found {} hot spring centers", hot_spring_centers.len());

    // Tiny hot springs (< 80 tiles) get water only - no shack, campfire, or barrels
    const MIN_FULL_HOT_SPRING_TILES: usize = 80;
    let full_hot_spring_centers: Vec<(f32, f32)> = hot_spring_centers
        .iter()
        .filter(|(_, _, n)| *n >= MIN_FULL_HOT_SPRING_TILES)
        .map(|(x, y, _)| (*x, *y))
        .collect();
    
    // Spawn beach barrels around full hot springs only (skip tiny alpine spring)
    match barrel::spawn_hot_spring_barrels(ctx, &full_hot_spring_centers) {
        Ok(count) => {
            log::info!("🛢️ Spawned {} barrels around hot springs", count);
        }
        Err(e) => {
            log::error!("Failed to spawn hot spring barrels: {}", e);
        }
    }

    // --- Seed Buoy Barrels (Variant 6) in Outer Ocean ---
    // Indestructible navigational buoys, ~1 per 4000px, deep water near map edges
    log::info!("Seeding Buoy Barrels (indestructible, outer ocean)...");
    match barrel::spawn_buoy_barrels(ctx) {
        Ok(_) => {
            let buoy_count = ctx.db.barrel().iter().filter(|b| b.variant == barrel::BUOY_VARIANT).count();
            log::info!("Successfully spawned {} buoys", buoy_count);
        }
        Err(e) => {
            log::error!("Failed to spawn buoy barrels: {}", e);
        }
    }
    
    // Spawn a campfire at each full hot spring (skip tiny alpine spring)
    let mut hot_spring_campfire_count = 0u32;
    for (center_x, center_y) in &full_hot_spring_centers {
        let placeables = monument::get_hot_spring_placeables();
        match monument::spawn_monument_placeables(
            ctx, 
            "Hot Spring", 
            *center_x, 
            *center_y, 
            &placeables
        ) {
            Ok(count) => {
                hot_spring_campfire_count += count;
            }
            Err(e) => {
                log::error!("Failed to spawn hot spring campfire at ({:.0}, {:.0}): {}", center_x, center_y, e);
            }
        }
    }
    log::info!("🔥 Spawned {} campfires at hot springs", hot_spring_campfire_count);
    
    // Spawn abandoned bath house shack at each full hot spring (skip tiny alpine spring - water only)
    // Position: offset from center to be on the beach, opposite side from campfire
    let mut hot_spring_shack_count = 0u32;
    let mut hot_spring_crate_count = 0u32;
    for (center_x, center_y) in &full_hot_spring_centers {
        // Shack position: southwest of center (opposite from campfire which is east)
        // Hot springs have ~7-9 tile radius (336-432px), offset further for beach placement
        // Pushed left by 300px to avoid overlapping with water
        let shack_offset_x = -680.0_f32;
        let shack_offset_y = 250.0_f32;
        let shack_x = center_x + shack_offset_x;
        let shack_y = center_y + shack_offset_y;
        
        // Insert the shack as a MonumentPart for client-side rendering
        ctx.db.monument_part().insert(crate::MonumentPart {
            id: 0, // auto_inc
            monument_type: crate::MonumentType::HotSpring,
            world_x: shack_x,
            world_y: shack_y,
            image_path: "hs_shack.png".to_string(),
            part_type: "shack".to_string(),
            is_center: false, // Not the center of the hot spring
            collision_radius: 0.0, // No collision for walkability
            rotation_rad: 0.0,
        });
        hot_spring_shack_count += 1;
        
        // Spawn loot near the shack: 2 barrels + 1 military ration
        let barrel_positions = [
            (shack_x + 80.0, shack_y + 30.0),   // Right side of shack
            (shack_x - 60.0, shack_y + 40.0),   // Left side of shack
        ];
        let ration_position = (shack_x + 20.0, shack_y + 60.0); // Front of shack

        for (barrel_x, barrel_y) in barrel_positions {
            let chunk_idx = calculate_chunk_index(barrel_x, barrel_y);
            use crate::barrel::{Barrel, BARREL_INITIAL_HEALTH};
            let variant = ctx.rng().gen_range(0..3u8); // Road barrel variants (0, 1, 2)
            match ctx.db.barrel().try_insert(Barrel {
                id: 0,
                pos_x: barrel_x,
                pos_y: barrel_y,
                chunk_index: chunk_idx,
                health: BARREL_INITIAL_HEALTH,
                variant,
                last_hit_time: None,
                respawn_at: Timestamp::UNIX_EPOCH,
                cluster_id: 0,
                is_monument: false,
            }) {
                Ok(_) => hot_spring_crate_count += 1,
                Err(e) => log::warn!("Failed to spawn hot spring barrel at ({:.0}, {:.0}): {}", barrel_x, barrel_y, e),
            }
        }

        if let Err(e) = crate::military_ration::spawn_military_ration_at_position(ctx, ration_position.0, ration_position.1) {
            log::warn!("Failed to spawn hot spring military ration at ({:.0}, {:.0}): {}", ration_position.0, ration_position.1, e);
        } else {
            hot_spring_crate_count += 1;
        }
    }
    log::info!("🏚️ Spawned {} abandoned shacks at hot springs", hot_spring_shack_count);
    log::info!("📦 Spawned {} loot crates near hot spring shacks", hot_spring_crate_count);
    
    // Set counters to 0 since hot springs themselves are tile-based (no entity count)
    let spawned_hot_spring_count = 0;

    // --- Seed Quarry Entities (Fumaroles, Basalt Columns, Stones) ---
    log::info!("🏔️ Seeding Quarry Entities on Quarry Tiles...");
    
    let mut total_spawned_fumarole_count = 0;
    let mut total_spawned_basalt_column_count = 0;
    let mut total_spawned_quarry_stone_count = 0;
    
    // Read large quarry data for typed ore spawning
    // Large quarries have designated types (Stone, Sulfur, Metal) that affect ore spawning
    let large_quarries: Vec<(f32, f32, i32, crate::LargeQuarryType)> = ctx.db.large_quarry()
        .iter()
        .map(|q| (q.world_x, q.world_y, q.radius_tiles, q.quarry_type.clone()))
        .collect();
    log::info!("🏔️ Found {} large quarries with types for ore spawning", large_quarries.len());
    
    // Collect all quarry tiles
    let quarry_tiles: Vec<(i32, i32)> = ctx.db.world_tile()
        .iter()
        .filter(|tile| tile.tile_type == crate::TileType::Quarry)
        .map(|tile| (tile.world_x, tile.world_y))
        .collect();
    
    log::info!("🏔️ Found {} quarry tiles", quarry_tiles.len());
    
    // Shuffle quarry tiles for random spawning
    let mut shuffled_tiles = quarry_tiles.clone();
    use rand::seq::SliceRandom;
    shuffled_tiles.shuffle(&mut rng);
    
    // Track spawned positions for collision checking
    let mut spawned_basalt_positions: Vec<(f32, f32)> = Vec::new();
    let mut spawned_fumarole_positions: Vec<(f32, f32)> = Vec::new();
    
    // === GUARANTEED MINIMUM FUMAROLES PER QUARRY CLUSTER ===
    // Detect distinct quarry clusters using flood-fill/union-find approach
    // Each cluster MUST get at least 1 fumarole for warmth (important for gameplay!)
    log::info!("🔥 Detecting quarry clusters to guarantee minimum fumaroles...");
    
    // Build a set of quarry tile positions for fast lookup
    let quarry_tile_set: std::collections::HashSet<(i32, i32)> = quarry_tiles.iter().cloned().collect();
    let mut visited: std::collections::HashSet<(i32, i32)> = std::collections::HashSet::new();
    let mut quarry_clusters: Vec<Vec<(i32, i32)>> = Vec::new();
    
    // Flood-fill to find connected quarry tile clusters
    for &start_tile in &quarry_tiles {
        if visited.contains(&start_tile) {
            continue;
        }
        
        // BFS to find all connected tiles in this cluster
        let mut cluster: Vec<(i32, i32)> = Vec::new();
        let mut queue: std::collections::VecDeque<(i32, i32)> = std::collections::VecDeque::new();
        queue.push_back(start_tile);
        visited.insert(start_tile);
        
        while let Some((tx, ty)) = queue.pop_front() {
            cluster.push((tx, ty));
            
            // Check 8-connected neighbors (including diagonals for quarry clusters)
            for dx in -1..=1 {
                for dy in -1..=1 {
                    if dx == 0 && dy == 0 { continue; }
                    let neighbor = (tx + dx, ty + dy);
                    if quarry_tile_set.contains(&neighbor) && !visited.contains(&neighbor) {
                        visited.insert(neighbor);
                        queue.push_back(neighbor);
                    }
                }
            }
        }
        
        if !cluster.is_empty() {
            quarry_clusters.push(cluster);
        }
    }
    
    log::info!("🔥 Found {} distinct quarry clusters", quarry_clusters.len());
    
    // For each cluster, spawn at least 1 fumarole near the center
    let mut guaranteed_fumaroles_spawned = 0;
    for (cluster_idx, cluster) in quarry_clusters.iter().enumerate() {
        // Find cluster center (average position)
        let sum_x: i32 = cluster.iter().map(|(x, _)| *x).sum();
        let sum_y: i32 = cluster.iter().map(|(_, y)| *y).sum();
        let center_x = sum_x as f32 / cluster.len() as f32;
        let center_y = sum_y as f32 / cluster.len() as f32;
        
        // Find the tile closest to the center
        let mut best_tile = cluster[0];
        let mut best_dist_sq = f32::MAX;
        for &(tx, ty) in cluster {
            let dx = tx as f32 - center_x;
            let dy = ty as f32 - center_y;
            let dist_sq = dx * dx + dy * dy;
            if dist_sq < best_dist_sq {
                best_dist_sq = dist_sq;
                best_tile = (tx, ty);
            }
        }
        
        // Convert to world coordinates
        let world_x_px = (best_tile.0 as f32 + 0.5) * crate::TILE_SIZE_PX as f32;
        let world_y_px = (best_tile.1 as f32 + 0.5) * crate::TILE_SIZE_PX as f32;
        
        // Check collision with trees and stones (skip other fumaroles since this is guaranteed)
        let mut too_close = false;
        const MIN_GUARANTEED_FUMAROLE_TREE_DIST_SQ: f32 = 80.0 * 80.0;
        const MIN_GUARANTEED_FUMAROLE_STONE_DIST_SQ: f32 = 60.0 * 60.0;
        
        for (tx, ty) in &spawned_tree_positions {
            let dx = world_x_px - tx;
            let dy = world_y_px - ty;
            if (dx * dx + dy * dy) < MIN_GUARANTEED_FUMAROLE_TREE_DIST_SQ {
                too_close = true;
                break;
            }
        }
        
        if !too_close {
            for (sx, sy) in &spawned_stone_positions {
                let dx = world_x_px - sx;
                let dy = world_y_px - sy;
                if (dx * dx + dy * dy) < MIN_GUARANTEED_FUMAROLE_STONE_DIST_SQ {
                    too_close = true;
                    break;
                }
            }
        }
        
        // If center tile is blocked, try nearby tiles in the cluster
        if too_close {
            let mut found_alternative = false;
            // Sort cluster tiles by distance to center for priority
            let mut sorted_cluster = cluster.clone();
            sorted_cluster.sort_by(|a, b| {
                let da = (a.0 as f32 - center_x).powi(2) + (a.1 as f32 - center_y).powi(2);
                let db = (b.0 as f32 - center_x).powi(2) + (b.1 as f32 - center_y).powi(2);
                da.partial_cmp(&db).unwrap_or(std::cmp::Ordering::Equal)
            });
            
            for &(alt_x, alt_y) in sorted_cluster.iter().skip(1).take(20) {
                let alt_world_x = (alt_x as f32 + 0.5) * crate::TILE_SIZE_PX as f32;
                let alt_world_y = (alt_y as f32 + 0.5) * crate::TILE_SIZE_PX as f32;
                
                let mut alt_too_close = false;
                for (tx, ty) in &spawned_tree_positions {
                    let dx = alt_world_x - tx;
                    let dy = alt_world_y - ty;
                    if (dx * dx + dy * dy) < MIN_GUARANTEED_FUMAROLE_TREE_DIST_SQ {
                        alt_too_close = true;
                        break;
                    }
                }
                if !alt_too_close {
                    for (sx, sy) in &spawned_stone_positions {
                        let dx = alt_world_x - sx;
                        let dy = alt_world_y - sy;
                        if (dx * dx + dy * dy) < MIN_GUARANTEED_FUMAROLE_STONE_DIST_SQ {
                            alt_too_close = true;
                            break;
                        }
                    }
                }
                
                if !alt_too_close {
                    // Spawn at alternative position
                    let chunk_idx = calculate_chunk_index(alt_world_x, alt_world_y);
                    let fumarole = crate::fumarole::Fumarole::new(alt_world_x, alt_world_y, chunk_idx);
                    if let Ok(inserted_fumarole) = ctx.db.fumarole().try_insert(fumarole) {
                        total_spawned_fumarole_count += 1;
                        guaranteed_fumaroles_spawned += 1;
                        spawned_fumarole_positions.push((alt_world_x, alt_world_y));
                        log::info!("🔥 Cluster #{}: Spawned GUARANTEED fumarole at ({:.0}, {:.0}) [alternative position, {} tiles]",
                                   cluster_idx + 1, alt_world_x, alt_world_y, cluster.len());
                        found_alternative = true;
                        break;
                    }
                }
            }
            
            if !found_alternative {
                log::warn!("🔥 Cluster #{}: Could not find valid position for guaranteed fumarole ({} tiles)", 
                          cluster_idx + 1, cluster.len());
            }
        } else {
            // Spawn at center position
            let chunk_idx = calculate_chunk_index(world_x_px, world_y_px);
            let fumarole = crate::fumarole::Fumarole::new(world_x_px, world_y_px, chunk_idx);
            if let Ok(inserted_fumarole) = ctx.db.fumarole().try_insert(fumarole) {
                total_spawned_fumarole_count += 1;
                guaranteed_fumaroles_spawned += 1;
                spawned_fumarole_positions.push((world_x_px, world_y_px));
                log::info!("🔥 Cluster #{}: Spawned GUARANTEED fumarole at ({:.0}, {:.0}) [center, {} tiles]",
                           cluster_idx + 1, world_x_px, world_y_px, cluster.len());
            }
        }
    }
    
    log::info!("🔥 Spawned {} GUARANTEED fumaroles (1 per quarry cluster)", guaranteed_fumaroles_spawned);
    
    // Spawn entities on a proportion of quarry tiles
    // Target for 600x600 map (2 large + 4 small quarries):
    // - Large quarries (2): 5-6 stones each = 10-12 total
    // - Small quarries (4): 1-2 stones each = 4-8 total  
    // - Large quarries (2): ~3 fumaroles each = ~6 total (REDUCED for performance)
    // - Small quarries (4): 1-2 fumaroles each = 4-8 total (unchanged)
    // - Basalt columns: REDUCED by 50% for performance (large quarries only)
    
    let fumarole_spawn_chance = 0.006;  // 0.6% - REDUCED 2x from 1.2% (large quarries get ~3, small still get 1-2)
    let basalt_spawn_chance = 0.04;     // 4% - REDUCED by 50% from 8% (half as many columns)
    let stone_spawn_chance = 0.015;     // 1.5% - unchanged (stones are important for gameplay)
    let military_ration_spawn_chance = 0.003; // 0.3% per quarry tile - balanced for PvP areas
    let mine_cart_spawn_chance = 0.003; // 0.3% per quarry tile - mining equipment (quarry-exclusive)
    let barrel_spawn_chance = 0.002;    // 0.2% per quarry tile - additional loot
    
    // Minimum distances for collision checking
    // Basalt columns are visually large (360x540px), so they need more space
    // Fumaroles have steam effects that need clearance
    const MIN_FUMAROLE_TREE_DIST_SQ: f32 = 100.0 * 100.0;  // Keep fumaroles away from trees
    const MIN_FUMAROLE_STONE_DIST_SQ: f32 = 80.0 * 80.0;
    const MIN_FUMAROLE_BASALT_DIST_SQ: f32 = 180.0 * 180.0; // Fumaroles must avoid large basalt columns
    const MIN_FUMAROLE_FUMAROLE_DIST_SQ: f32 = 120.0 * 120.0; // Fumaroles need space between each other
    const MIN_BASALT_TREE_DIST_SQ: f32 = 220.0 * 220.0;  // Large basalt (360px) needs more space from trees (320-480px)
    const MIN_BASALT_STONE_DIST_SQ: f32 = 180.0 * 180.0; // Basalt needs space from stones
    const MIN_BASALT_BASALT_DIST_SQ: f32 = 250.0 * 250.0; // Large basalt columns need good spacing between each other
    const MIN_BASALT_FUMAROLE_DIST_SQ: f32 = 180.0 * 180.0; // Basalt must avoid fumaroles
    const MIN_QUARRY_STONE_TREE_DIST_SQ: f32 = 80.0 * 80.0;
    const MIN_QUARRY_STONE_STONE_DIST_SQ: f32 = 80.0 * 80.0;
    const MIN_QUARRY_STONE_BASALT_DIST_SQ: f32 = 200.0 * 200.0; // Stones need more space from large basalt columns
    const MIN_QUARRY_STONE_FUMAROLE_DIST_SQ: f32 = 100.0 * 100.0; // Stones need to avoid fumaroles!
    
    for (tile_x, tile_y) in &shuffled_tiles {
        let world_x_px = (*tile_x as f32 + 0.5) * crate::TILE_SIZE_PX as f32;
        let world_y_px = (*tile_y as f32 + 0.5) * crate::TILE_SIZE_PX as f32;
        
        // Spawn fumarole with low probability (check collision with trees/stones/basalt/other fumaroles)
        if rng.gen::<f32>() < fumarole_spawn_chance {
            let mut too_close = false;
            
            // Check distance from trees
            for (tx, ty) in &spawned_tree_positions {
                let dx = world_x_px - tx;
                let dy = world_y_px - ty;
                if (dx * dx + dy * dy) < MIN_FUMAROLE_TREE_DIST_SQ {
                    too_close = true;
                    break;
                }
            }
            
            // Check distance from stones
            if !too_close {
                for (sx, sy) in &spawned_stone_positions {
                    let dx = world_x_px - sx;
                    let dy = world_y_px - sy;
                    if (dx * dx + dy * dy) < MIN_FUMAROLE_STONE_DIST_SQ {
                        too_close = true;
                        break;
                    }
                }
            }
            
            // Check distance from basalt columns
            if !too_close {
                for (bx, by) in &spawned_basalt_positions {
                    let dx = world_x_px - bx;
                    let dy = world_y_px - by;
                    if (dx * dx + dy * dy) < MIN_FUMAROLE_BASALT_DIST_SQ {
                        too_close = true;
                        break;
                    }
                }
            }
            
            // Check distance from other fumaroles
            if !too_close {
                for (fx, fy) in &spawned_fumarole_positions {
                    let dx = world_x_px - fx;
                    let dy = world_y_px - fy;
                    if (dx * dx + dy * dy) < MIN_FUMAROLE_FUMAROLE_DIST_SQ {
                        too_close = true;
                        break;
                    }
                }
            }
            
            if !too_close {
                let chunk_idx = calculate_chunk_index(world_x_px, world_y_px);
                let fumarole = crate::fumarole::Fumarole::new(world_x_px, world_y_px, chunk_idx);
                if let Ok(inserted_fumarole) = ctx.db.fumarole().try_insert(fumarole) {
                    total_spawned_fumarole_count += 1;
                    spawned_fumarole_positions.push((world_x_px, world_y_px)); // Track position
                    // Schedule processing for burn damage (runs even when empty)
                }
            }
        }
        
        // Spawn basalt column with moderate probability (check collision with trees/stones/fumaroles/other basalt)
        if rng.gen::<f32>() < basalt_spawn_chance {
            let mut too_close = false;
            
            // Check distance from trees
            for (tx, ty) in &spawned_tree_positions {
                let dx = world_x_px - tx;
                let dy = world_y_px - ty;
                if (dx * dx + dy * dy) < MIN_BASALT_TREE_DIST_SQ {
                    too_close = true;
                    break;
                }
            }
            
            // Check distance from stones
            if !too_close {
                for (sx, sy) in &spawned_stone_positions {
                    let dx = world_x_px - sx;
                    let dy = world_y_px - sy;
                    if (dx * dx + dy * dy) < MIN_BASALT_STONE_DIST_SQ {
                        too_close = true;
                        break;
                    }
                }
            }
            
            // Check distance from other basalt columns
            if !too_close {
                for (bx, by) in &spawned_basalt_positions {
                    let dx = world_x_px - bx;
                    let dy = world_y_px - by;
                    if (dx * dx + dy * dy) < MIN_BASALT_BASALT_DIST_SQ {
                        too_close = true;
                        break;
                    }
                }
            }
            
            // Check distance from fumaroles
            if !too_close {
                for (fx, fy) in &spawned_fumarole_positions {
                    let dx = world_x_px - fx;
                    let dy = world_y_px - fy;
                    if (dx * dx + dy * dy) < MIN_BASALT_FUMAROLE_DIST_SQ {
                        too_close = true;
                        break;
                    }
                }
            }
            
            if !too_close {
                let chunk_idx = calculate_chunk_index(world_x_px, world_y_px);
                let column_type = crate::basalt_column::BasaltColumnType::random(&mut rng);
                let basalt = crate::basalt_column::BasaltColumn::new(world_x_px, world_y_px, chunk_idx, column_type);
                if let Ok(_) = ctx.db.basalt_column().try_insert(basalt) {
                    total_spawned_basalt_column_count += 1;
                    spawned_basalt_positions.push((world_x_px, world_y_px)); // Track position
                }
            }
        }
        
        // Spawn stone with moderate probability (check collision with trees/other stones/basalt/fumaroles)
        if rng.gen::<f32>() < stone_spawn_chance {
            let mut too_close = false;
            
            // Check distance from trees
            for (tx, ty) in &spawned_tree_positions {
                let dx = world_x_px - tx;
                let dy = world_y_px - ty;
                if (dx * dx + dy * dy) < MIN_QUARRY_STONE_TREE_DIST_SQ {
                    too_close = true;
                    break;
                }
            }
            
            // Check distance from other stones
            if !too_close {
                for (sx, sy) in &spawned_stone_positions {
                    let dx = world_x_px - sx;
                    let dy = world_y_px - sy;
                    if (dx * dx + dy * dy) < MIN_QUARRY_STONE_STONE_DIST_SQ {
                        too_close = true;
                        break;
                    }
                }
            }
            
            // Check distance from basalt columns (CRITICAL: stones must avoid large basalt columns!)
            if !too_close {
                for (bx, by) in &spawned_basalt_positions {
                    let dx = world_x_px - bx;
                    let dy = world_y_px - by;
                    if (dx * dx + dy * dy) < MIN_QUARRY_STONE_BASALT_DIST_SQ {
                        too_close = true;
                        break;
                    }
                }
            }
            
            // Check distance from fumaroles (stones must avoid hot steam vents!)
            if !too_close {
                for (fx, fy) in &spawned_fumarole_positions {
                    let dx = world_x_px - fx;
                    let dy = world_y_px - fy;
                    if (dx * dx + dy * dy) < MIN_QUARRY_STONE_FUMAROLE_DIST_SQ {
                        too_close = true;
                        break;
                    }
                }
            }
            
            if !too_close {
                let chunk_idx = calculate_chunk_index(world_x_px, world_y_px);
                
                // Check if this position is within a TYPED large quarry
                // If so, use the quarry's designated type for ore selection
                let mut found_quarry_type: Option<&crate::LargeQuarryType> = None;
                for (qx, qy, radius_tiles, qtype) in &large_quarries {
                    // Convert radius from tiles to pixels for distance check
                    let radius_px = *radius_tiles as f32 * crate::TILE_SIZE_PX as f32;
                    let dx = world_x_px - qx;
                    let dy = world_y_px - qy;
                    let dist_sq = dx * dx + dy * dy;
                    if dist_sq < radius_px * radius_px {
                        found_quarry_type = Some(qtype);
                        break;
                    }
                }
                
                // Determine ore type: use quarry type if in large quarry, otherwise generic quarry spawn
                let ore_type = if let Some(quarry_type) = found_quarry_type {
                    // Use the typed quarry ore selection (75% of designated type)
                    crate::stone::OreType::random_for_quarry_type(quarry_type, &mut rng)
                } else {
                    // Generic quarry spawn (small quarries or untyped)
                    crate::stone::OreType::random_for_location(world_x_px, world_y_px, true, &mut rng)
                };
                
                // Set resource amount based on ore type
                // Stone: Basic building material (500-1000)
                // Metal/Sulfur: Rarer materials (~50% of stone yield, 250-500)
                // Memory: Tech tree upgrades (120-180)
                let stone_resource_amount = match ore_type {
                    crate::stone::OreType::Stone => {
                        rng.gen_range(crate::stone::STONE_MIN_RESOURCES..=crate::stone::STONE_MAX_RESOURCES)
                    },
                    crate::stone::OreType::Metal => {
                        rng.gen_range(crate::stone::METAL_ORE_MIN_RESOURCES..=crate::stone::METAL_ORE_MAX_RESOURCES)
                    },
                    crate::stone::OreType::Sulfur => {
                        rng.gen_range(crate::stone::SULFUR_ORE_MIN_RESOURCES..=crate::stone::SULFUR_ORE_MAX_RESOURCES)
                    },
                    crate::stone::OreType::Memory => {
                        rng.gen_range(crate::stone::MEMORY_SHARD_MIN_RESOURCES..=crate::stone::MEMORY_SHARD_MAX_RESOURCES)
                    },
                };
                
                let stone = crate::stone::Stone {
                    id: 0,
                    pos_x: world_x_px,
                    pos_y: world_y_px,
                    health: crate::stone::STONE_INITIAL_HEALTH,
                    resource_remaining: stone_resource_amount, // Set based on ore type
                    ore_type, // Set the ore type based on location
                    chunk_index: chunk_idx,
                    last_hit_time: None,
                    respawn_at: Timestamp::UNIX_EPOCH, // 0 = not respawning
                };
                if let Ok(_) = ctx.db.stone().try_insert(stone) {
                    total_spawned_quarry_stone_count += 1;
                    spawned_stone_positions.push((world_x_px, world_y_px));
                }
            }
        }
        
        // Spawn military ration with low probability (check collision with stones/fumaroles/basalt/barrels)
        if rng.gen::<f32>() < military_ration_spawn_chance {
            let mut too_close = false;
            
            // Check distance from stones
            for (sx, sy) in &spawned_stone_positions {
                let dx = world_x_px - sx;
                let dy = world_y_px - sy;
                if (dx * dx + dy * dy) < 100.0 * 100.0 { // 100px minimum distance
                    too_close = true;
                    break;
                }
            }
            
            // Check distance from fumaroles
            if !too_close {
                for (fx, fy) in &spawned_fumarole_positions {
                    let dx = world_x_px - fx;
                    let dy = world_y_px - fy;
                    if (dx * dx + dy * dy) < 100.0 * 100.0 {
                        too_close = true;
                        break;
                    }
                }
            }
            
            // Check distance from basalt columns
            if !too_close {
                for (bx, by) in &spawned_basalt_positions {
                    let dx = world_x_px - bx;
                    let dy = world_y_px - by;
                    if (dx * dx + dy * dy) < 150.0 * 150.0 { // Basalt columns are large
                        too_close = true;
                        break;
                    }
                }
            }
            
            // Check distance from existing barrels
            if !too_close {
                let existing_barrels = ctx.db.barrel();
                for existing_barrel in existing_barrels.iter() {
                    let dx = world_x_px - existing_barrel.pos_x;
                    let dy = world_y_px - existing_barrel.pos_y;
                    if (dx * dx + dy * dy) < 100.0 * 100.0 {
                        too_close = true;
                        break;
                    }
                }
            }
            
            // Check distance from existing military rations
            if !too_close {
                let existing_boxes = ctx.db.wooden_storage_box();
                for existing_box in existing_boxes.iter() {
                    if existing_box.box_type == crate::wooden_storage_box::BOX_TYPE_MILITARY_RATION {
                        let dx = world_x_px - existing_box.pos_x;
                        let dy = world_y_px - existing_box.pos_y;
                        if (dx * dx + dy * dy) < 100.0 * 100.0 {
                            too_close = true;
                            break;
                        }
                    }
                }
            }
            
            // Check collision with monument buildings
            if !too_close && crate::monument::is_position_inside_monument_building(ctx, world_x_px, world_y_px) {
                too_close = true;
            }
            
            if !too_close {
                let chunk_idx = calculate_chunk_index(world_x_px, world_y_px);
                match crate::military_ration::spawn_military_ration_with_loot(ctx, world_x_px, world_y_px, chunk_idx) {
                    Ok(_) => {
                        log::debug!("[QuarrySpawn] Spawned military ration at ({:.1}, {:.1})", world_x_px, world_y_px);
                    }
                    Err(e) => {
                        log::warn!("[QuarrySpawn] Failed to spawn military ration: {}", e);
                    }
                }
            }
        }
        
        // Spawn mine cart with low probability (quarry-exclusive loot container for mining equipment)
        if rng.gen::<f32>() < mine_cart_spawn_chance {
            let mut too_close = false;
            
            // Check distance from stones
            for (sx, sy) in &spawned_stone_positions {
                let dx = world_x_px - sx;
                let dy = world_y_px - sy;
                if (dx * dx + dy * dy) < 100.0 * 100.0 { // 100px minimum distance
                    too_close = true;
                    break;
                }
            }
            
            // Check distance from fumaroles
            if !too_close {
                for (fx, fy) in &spawned_fumarole_positions {
                    let dx = world_x_px - fx;
                    let dy = world_y_px - fy;
                    if (dx * dx + dy * dy) < 100.0 * 100.0 {
                        too_close = true;
                        break;
                    }
                }
            }
            
            // Check distance from basalt columns
            if !too_close {
                for (bx, by) in &spawned_basalt_positions {
                    let dx = world_x_px - bx;
                    let dy = world_y_px - by;
                    if (dx * dx + dy * dy) < 150.0 * 150.0 { // Basalt columns are large
                        too_close = true;
                        break;
                    }
                }
            }
            
            // Check distance from existing barrels
            if !too_close {
                let existing_barrels = ctx.db.barrel();
                for existing_barrel in existing_barrels.iter() {
                    let dx = world_x_px - existing_barrel.pos_x;
                    let dy = world_y_px - existing_barrel.pos_y;
                    if (dx * dx + dy * dy) < 100.0 * 100.0 {
                        too_close = true;
                        break;
                    }
                }
            }
            
            // Check distance from existing mine carts and military rations
            if !too_close {
                let existing_boxes = ctx.db.wooden_storage_box();
                for existing_box in existing_boxes.iter() {
                    if existing_box.box_type == crate::wooden_storage_box::BOX_TYPE_MINE_CART ||
                       existing_box.box_type == crate::wooden_storage_box::BOX_TYPE_MILITARY_RATION {
                        let dx = world_x_px - existing_box.pos_x;
                        let dy = world_y_px - existing_box.pos_y;
                        if (dx * dx + dy * dy) < 100.0 * 100.0 {
                            too_close = true;
                            break;
                        }
                    }
                }
            }
            
            // Check collision with monument buildings
            if !too_close && crate::monument::is_position_inside_monument_building(ctx, world_x_px, world_y_px) {
                too_close = true;
            }
            
            if !too_close {
                let chunk_idx = calculate_chunk_index(world_x_px, world_y_px);
                match crate::mine_cart::spawn_mine_cart_with_loot(ctx, world_x_px, world_y_px, chunk_idx) {
                    Ok(_) => {
                        log::debug!("[QuarrySpawn] Spawned mine cart at ({:.1}, {:.1})", world_x_px, world_y_px);
                    }
                    Err(e) => {
                        log::warn!("[QuarrySpawn] Failed to spawn mine cart: {}", e);
                    }
                }
            }
        }
        
        // Spawn barrel with low probability (check collision with stones/fumaroles/basalt/rations)
        if rng.gen::<f32>() < barrel_spawn_chance {
            let mut too_close = false;
            
            // Check distance from stones
            for (sx, sy) in &spawned_stone_positions {
                let dx = world_x_px - sx;
                let dy = world_y_px - sy;
                if (dx * dx + dy * dy) < 100.0 * 100.0 {
                    too_close = true;
                    break;
                }
            }
            
            // Check distance from fumaroles
            if !too_close {
                for (fx, fy) in &spawned_fumarole_positions {
                    let dx = world_x_px - fx;
                    let dy = world_y_px - fy;
                    if (dx * dx + dy * dy) < 100.0 * 100.0 {
                        too_close = true;
                        break;
                    }
                }
            }
            
            // Check distance from basalt columns
            if !too_close {
                for (bx, by) in &spawned_basalt_positions {
                    let dx = world_x_px - bx;
                    let dy = world_y_px - by;
                    if (dx * dx + dy * dy) < 150.0 * 150.0 {
                        too_close = true;
                        break;
                    }
                }
            }
            
            // Check distance from existing barrels
            if !too_close {
                use crate::barrel::{has_barrel_collision, has_player_barrel_collision};
                if has_barrel_collision(ctx, world_x_px, world_y_px, None) ||
                   has_player_barrel_collision(ctx, world_x_px, world_y_px) {
                    too_close = true;
                }
            }
            
            // Check distance from existing military rations
            if !too_close {
                let existing_boxes = ctx.db.wooden_storage_box();
                for existing_box in existing_boxes.iter() {
                    if existing_box.box_type == crate::wooden_storage_box::BOX_TYPE_MILITARY_RATION {
                        let dx = world_x_px - existing_box.pos_x;
                        let dy = world_y_px - existing_box.pos_y;
                        if (dx * dx + dy * dy) < 100.0 * 100.0 {
                            too_close = true;
                            break;
                        }
                    }
                }
            }
            
            // Check collision with monument buildings
            if !too_close && crate::monument::is_position_inside_monument_building(ctx, world_x_px, world_y_px) {
                too_close = true;
            }
            
            if !too_close {
                let chunk_idx = calculate_chunk_index(world_x_px, world_y_px);
                use crate::barrel::{Barrel, BARREL_INITIAL_HEALTH};
                let new_barrel = Barrel {
                    id: 0, // auto_inc
                    pos_x: world_x_px,
                    pos_y: world_y_px,
                    chunk_index: chunk_idx,
                    health: BARREL_INITIAL_HEALTH,
                    variant: rng.gen_range(0..3u8), // Road barrel variants (0, 1, 2)
                    last_hit_time: None,
                    respawn_at: Timestamp::UNIX_EPOCH, // 0 = not respawning
                    cluster_id: 0, // Individual spawns, not clusters
                    is_monument: false,
                };
                
                match ctx.db.barrel().try_insert(new_barrel) {
                    Ok(_) => {
                        log::debug!("[QuarrySpawn] Spawned barrel at ({:.1}, {:.1})", world_x_px, world_y_px);
                    }
                    Err(e) => {
                        log::warn!("[QuarrySpawn] Failed to spawn barrel: {}", e);
                    }
                }
            }
        }
    }
    
    // --- GUARANTEE: Ensure south quarries have fumaroles (simpler O(n) approach) ---
    // Count fumaroles already in the south half of the map
    let map_height_half_px = (WORLD_HEIGHT_TILES as f32 / 2.0) * crate::TILE_SIZE_PX as f32;
    let south_fumarole_count = spawned_fumarole_positions.iter()
        .filter(|(_, y)| *y >= map_height_half_px)
        .count();
    
    // Target: at least 4 fumaroles in south (one per small quarry on 600x600 map)
    // Scale with map size
    let map_scale = ((WORLD_WIDTH_TILES * WORLD_HEIGHT_TILES) as f32 / (600.0 * 600.0)).sqrt();
    let min_south_fumaroles = (4.0 * map_scale).round().max(2.0) as usize;
    
    if south_fumarole_count < min_south_fumaroles {
        let needed = min_south_fumaroles - south_fumarole_count;
        log::info!("🏔️ South quarries have {} fumaroles, need {} more (target: {})", 
                  south_fumarole_count, needed, min_south_fumaroles);
        
        // Collect south quarry tiles that are far from existing fumaroles
        const MIN_DIST_FROM_FUMAROLE_SQ: f32 = 200.0 * 200.0; // 200px minimum
        
        let mut candidate_tiles: Vec<(f32, f32)> = quarry_tiles.iter()
            .filter(|(_, tile_y)| *tile_y >= (WORLD_HEIGHT_TILES / 2) as i32)
            .map(|(tx, ty)| {
                ((*tx as f32 + 0.5) * crate::TILE_SIZE_PX as f32,
                 (*ty as f32 + 0.5) * crate::TILE_SIZE_PX as f32)
            })
            .filter(|(wx, wy)| {
                // Check if far enough from all existing fumaroles
                !spawned_fumarole_positions.iter().any(|(fx, fy)| {
                    let dx = wx - fx;
                    let dy = wy - fy;
                    (dx * dx + dy * dy) < MIN_DIST_FROM_FUMAROLE_SQ
                })
            })
            .collect();
        
        // Shuffle and try to spawn needed fumaroles
        candidate_tiles.shuffle(&mut rng);
        
        let mut spawned_count = 0;
        const MIN_NEW_FUMAROLE_DIST_SQ: f32 = 60.0 * 60.0; // Minimum between new fumaroles
        
        for (world_x_px, world_y_px) in candidate_tiles.iter().take(needed * 10) {
            if spawned_count >= needed {
                break;
            }
            
            // Check distance from newly spawned fumaroles in this loop
            let too_close_to_new = spawned_fumarole_positions.iter()
                .skip(spawned_fumarole_positions.len().saturating_sub(spawned_count))
                .any(|(fx, fy)| {
                    let dx = world_x_px - fx;
                    let dy = world_y_px - fy;
                    (dx * dx + dy * dy) < MIN_NEW_FUMAROLE_DIST_SQ
                });
            
            if !too_close_to_new {
                let chunk_idx = calculate_chunk_index(*world_x_px, *world_y_px);
                let fumarole = crate::fumarole::Fumarole::new(*world_x_px, *world_y_px, chunk_idx);
                if let Ok(inserted_fumarole) = ctx.db.fumarole().try_insert(fumarole) {
                    total_spawned_fumarole_count += 1;
                    spawned_fumarole_positions.push((*world_x_px, *world_y_px));
                    spawned_count += 1;
                    log::info!("🏔️✅ Force-spawned fumarole #{} in south at ({:.0}, {:.0})", 
                              spawned_count, world_x_px, world_y_px);
                }
            }
        }
        
        log::info!("🏔️ Force-spawned {} additional fumaroles in south quarries", spawned_count);
    } else {
        log::info!("🏔️ South quarries already have {} fumaroles (target: {})", 
                  south_fumarole_count, min_south_fumaroles);
    }
    
    log::info!("🏔️ Finished seeding quarry entities: {} stones, {} fumaroles, {} basalt columns", 
               total_spawned_quarry_stone_count, total_spawned_fumarole_count, total_spawned_basalt_column_count);

    // --- Seed Harvestable Resources (Unified System) ---
    log::info!("Seeding Harvestable Resources using unified system...");
    
    for (plant_type, config) in plants_database::PLANT_CONFIGS.iter() {
        let target_count = *plant_targets.get(plant_type).unwrap_or(&0);
        let max_attempts = *plant_attempts.get(plant_type).unwrap_or(&0);
        let mut spawned_count = 0;
        let mut attempts = 0;
        
        log::info!("Seeding {:?}... (target: {}, max attempts: {})", plant_type, target_count, max_attempts);
        
        while spawned_count < target_count && attempts < max_attempts {
            attempts += 1;
            
            match attempt_single_spawn(
                &mut rng,
                &mut occupied_tiles,
                &mut spawned_harvestable_positions,
                &spawned_tree_positions,
                &spawned_stone_positions,
                min_tile_x, max_tile_x, min_tile_y, max_tile_y,
                &fbm,
                crate::tree::TREE_SPAWN_NOISE_FREQUENCY,
                config.noise_threshold as f64,
                config.min_distance_sq,
                config.min_tree_distance_sq,
                config.min_stone_distance_sq,
                |pos_x, pos_y, _extra: ()| {
                    let chunk_idx = calculate_chunk_index(pos_x, pos_y);
                    harvestable_resource::create_harvestable_resource(
                        plant_type.clone(),
                        pos_x,
                        pos_y,
                        chunk_idx,
                        false // Mark as wild plant (not player-planted)
                    )
                },
                (),
                |pos_x, pos_y| {
                    // Special cases for water-spawning plants
                    let config = plants_database::PLANT_CONFIGS.get(plant_type).unwrap();
                    let allow_inland_water_spawn = matches!(config.spawn_condition, plants_database::SpawnCondition::InlandWater);
                    let allow_underwater_spawn = matches!(config.spawn_condition, plants_database::SpawnCondition::Underwater);
                    
                    let water_blocked = if allow_inland_water_spawn {
                        // For reeds: only block if it's NOT inland water (i.e., block ocean water and land)
                        !is_position_on_inland_water(ctx, pos_x, pos_y)
                    } else if allow_underwater_spawn {
                        // For seaweed: only block if NOT in sea/shallow water
                        !is_position_on_water(ctx, pos_x, pos_y)
                    } else {
                        // For all other plants: block any water tiles
                        is_position_on_water(ctx, pos_x, pos_y)
                    };
                    
                    water_blocked || !validate_spawn_location(
                        ctx, pos_x, pos_y, 
                        &config.spawn_condition,
                        &spawned_tree_positions, &spawned_stone_positions
                    )
                },
                |_pos_x, _pos_y| config.noise_threshold as f64, // Base threshold for plants
                |_pos_x, _pos_y| config.min_distance_sq, // Base distance for plants
                harvestable_resources,
            ) {
                Ok(true) => spawned_count += 1,
                Ok(false) => { /* Condition not met, continue */ }
                Err(_) => { /* Error already logged in helper, continue */ }
            }
        }
        
        // Update tracking
        plant_spawned_counts.insert(plant_type.clone(), spawned_count);
        plant_attempt_counts.insert(plant_type.clone(), attempts);
        
        log::info!(
            "Finished seeding {} {:?} plants (target: {}, attempts: {}).",
            spawned_count, plant_type, target_count, attempts
        );
    }

    // --- Seed Wild Animals ---
    log::info!("Seeding Wild Animals...");

    // Define species distribution (weighted probabilities)
    let species_weights = [
        (AnimalSpecies::CinderFox, 17),      // 17% - Common (reduced to make room for caribou)
        (AnimalSpecies::ArcticWalrus, 10),   // 10% - Common (beaches only)
        (AnimalSpecies::BeachCrab, 13),      // 13% - Common beach creature
        (AnimalSpecies::TundraWolf, 5),      // 5% - RARE predator
        (AnimalSpecies::CableViper, 5),      // 5% - RARE ambush predator
        (AnimalSpecies::Tern, 10),           // 10% - Coastal scavenger bird (beaches)
        (AnimalSpecies::Crow, 8),            // 8% - Inland thief bird
        (AnimalSpecies::Vole, 16),           // 16% - Common prey animal (tundra/grassland/forest)
        (AnimalSpecies::Wolverine, 6),       // 6% - Uncommon aggressive predator (tundra/alpine)
        (AnimalSpecies::Caribou, 10),        // 10% - Herd herbivore (tundra/alpine/grassland)
        (AnimalSpecies::SalmonShark, 4),     // 4% - RARE aquatic apex predator (deep water only)
        (AnimalSpecies::Jellyfish, 5),       // 5% - Uncommon aquatic hazard (deep water only)
        // Alpine animals
        (AnimalSpecies::PolarBear, 3),       // 3% - RARE alpine apex predator
        (AnimalSpecies::Hare, 10),           // 10% - Common alpine prey animal
        (AnimalSpecies::SnowyOwl, 5),        // 5% - Uncommon alpine flying predator
    ];
    let total_weight: u32 = species_weights.iter().map(|(_, weight)| weight).sum();
    
    // NEW: Chunk-based distribution system to prevent clustering (not to fill every chunk)
    let total_chunks = WORLD_WIDTH_CHUNKS * WORLD_WIDTH_CHUNKS;
    let max_animals_per_chunk = 1; // Hard limit: maximum 1 animal per chunk (reduced for performance)
    
    log::info!("Using chunk-based distribution: {} total chunks, max {} animal per chunk (target total: {})", 
               total_chunks, max_animals_per_chunk, target_wild_animal_count);
    
    // Track animals spawned per chunk (used to prevent clustering, not to force filling)
    let mut animals_per_chunk_map: std::collections::HashMap<u32, u32> = std::collections::HashMap::new();
    
    // Wild animal spawning loop
    while spawned_wild_animal_count < target_wild_animal_count && wild_animal_attempts < max_wild_animal_attempts {
        wild_animal_attempts += 1;
        
        // Choose species using weighted random selection
        let species_roll = rng.gen_range(0..total_weight);
        let mut cumulative_weight = 0;
        let mut chosen_species = AnimalSpecies::CinderFox;
        
        for &(species, weight) in &species_weights {
            cumulative_weight += weight;
            if species_roll < cumulative_weight {
                chosen_species = species;
                break;
            }
        }
        
        // Aquatic animals (sharks, jellyfish) ONLY spawn on Sea tiles. Picking a random world
        // position then checking suitability almost never hits water, so for aquatic species
        // we retry until we find a valid water tile (with a cap to avoid infinite loops).
        let is_aquatic_species = matches!(chosen_species, AnimalSpecies::SalmonShark | AnimalSpecies::Jellyfish);
        const MAX_AQUATIC_POSITION_ATTEMPTS: u32 = 200;
        
        let (tile_x, tile_y, pos_x, pos_y) = if is_aquatic_species {
            let mut found = None;
            for _ in 0..MAX_AQUATIC_POSITION_ATTEMPTS {
                let tx = rng.gen_range(min_tile_x..max_tile_x);
                let ty = rng.gen_range(min_tile_y..max_tile_y);
                let px = (tx as f32 + 0.5) * TILE_SIZE_PX as f32;
                let py = (ty as f32 + 0.5) * TILE_SIZE_PX as f32;
                if is_wild_animal_location_suitable(ctx, px, py, chosen_species, &spawned_tree_positions) {
                    found = Some((tx, ty, px, py));
                    break;
                }
            }
            match found {
                Some(t) => t,
                None => continue, // No valid water tile found this attempt; skip to next iteration
            }
        } else {
            // CHANGED: Use simpler random positioning instead of noise-based clustering
            let tile_x = rng.gen_range(min_tile_x..max_tile_x);
            let tile_y = rng.gen_range(min_tile_y..max_tile_y);
            let pos_x = (tile_x as f32 + 0.5) * TILE_SIZE_PX as f32;
            let pos_y = (tile_y as f32 + 0.5) * TILE_SIZE_PX as f32;
            (tile_x, tile_y, pos_x, pos_y)
        };
        
        // Calculate which chunk this position would be in
        let chunk_idx = calculate_chunk_index(pos_x, pos_y);
        let current_animals_in_chunk = animals_per_chunk_map.get(&chunk_idx).copied().unwrap_or(0);
        
        // Skip if this chunk already has enough animals (enforce distribution)
        if current_animals_in_chunk >= max_animals_per_chunk {
            continue;
        }
        
        // Check if occupied
        if occupied_tiles.contains(&(tile_x, tile_y)) {
            continue;
        }
        
        // Check central compound exclusion (no animals spawn in spawn zone)
        if is_position_in_central_compound(pos_x, pos_y) {
            continue;
        }
        
        // Check terrain suitability for the species (this handles both land AND aquatic animals)
        // IMPORTANT: This must be checked BEFORE the water check, because aquatic animals
        // (SalmonShark, Jellyfish) REQUIRE water tiles to spawn!
        if !is_wild_animal_location_suitable(ctx, pos_x, pos_y, chosen_species, &spawned_tree_positions) {
            continue;
        }
        
        // Block water spawns ONLY for non-aquatic animals
        // (Aquatic species were already forced to water tiles above.)
        if is_position_on_water(ctx, pos_x, pos_y) && !is_aquatic_species {
            continue;
        }
        
        // INCREASED: Much larger minimum distances to prevent clustering
        let min_animal_distance_sq = 150.0 * 150.0; // Increased from 60*60 to 150*150
        let mut too_close_to_animal = false;
        for &(other_x, other_y) in &spawned_wild_animal_positions {
            let dx = pos_x - other_x;
            let dy = pos_y - other_y;
            if dx * dx + dy * dy < min_animal_distance_sq {
                too_close_to_animal = true;
                break;
            }
        }
        if too_close_to_animal {
            continue;
        }
        
        // RELAXED: Distance checks from trees and stones (animals can be closer to environment)
        let min_tree_distance_sq = 40.0 * 40.0; // Reduced from 80*80 to 40*40
        let mut too_close_to_tree = false;
        for &(tree_x, tree_y) in &spawned_tree_positions {
            let dx = pos_x - tree_x;
            let dy = pos_y - tree_y;
            if dx * dx + dy * dy < min_tree_distance_sq {
                too_close_to_tree = true;
                break;
            }
        }
        if too_close_to_tree {
            continue;
        }
        
        let min_stone_distance_sq = 60.0 * 60.0; // Reduced from 100*100 to 60*60
        let mut too_close_to_stone = false;
        for &(stone_x, stone_y) in &spawned_stone_positions {
            let dx = pos_x - stone_x;
            let dy = pos_y - stone_y;
            if dx * dx + dy * dy < min_stone_distance_sq {
                too_close_to_stone = true;
                break;
            }
        }
        if too_close_to_stone {
            continue;
        }
        
        // Generate initial patrol center (same as spawn location)
        let patrol_center_x = pos_x;
        let patrol_center_y = pos_y;
        
        // Get stats directly from the behavior system (single source of truth)
        let behavior = chosen_species.get_behavior();
        let stats = behavior.get_stats();
        
        // Use the actual behavior stats instead of hardcoded duplicates
        let max_health = stats.max_health;
        let movement_speed = stats.movement_speed;
        let patrol_radius = stats.patrol_radius;
        let perception_range = stats.perception_range;
        let attack_damage = stats.attack_damage;
        
        // GROUP SPAWNING: Spawn walruses and caribou in groups
        let group_size = match chosen_species {
            AnimalSpecies::ArcticWalrus => rng.gen_range(3..=6), // 3-6 walruses per group
            AnimalSpecies::Caribou => rng.gen_range(3..=5),      // 3-5 caribou per herd (for breeding)
            _ => 1, // All other animals spawn alone
        };
        
        let mut group_positions = Vec::new();
        group_positions.push((pos_x, pos_y)); // Include the main spawn position
        
        // Group spacing varies by species
        let (min_group_distance, max_group_distance) = match chosen_species {
            AnimalSpecies::ArcticWalrus => (30.0, 60.0),  // Walruses cluster tightly
            AnimalSpecies::Caribou => (40.0, 100.0),      // Caribou spread out more (herd grazing)
            _ => (30.0, 60.0),
        };
        
        // If spawning multiple animals, generate additional positions nearby
        if group_size > 1 {
            for _ in 1..group_size {
                let mut attempts = 0;
                let max_attempts = 20;
                
                while attempts < max_attempts {
                    attempts += 1;
                    
                    // Generate position within species-appropriate distance of the main spawn point
                    let angle = rng.gen::<f32>() * 2.0 * std::f32::consts::PI;
                    let distance = rng.gen_range(min_group_distance..max_group_distance);
                    let group_pos_x = pos_x + (angle.cos() * distance);
                    let group_pos_y = pos_y + (angle.sin() * distance);
                    
                    // Check boundaries
                    if group_pos_x < PLAYER_RADIUS || group_pos_x > WORLD_WIDTH_PX - PLAYER_RADIUS ||
                       group_pos_y < PLAYER_RADIUS || group_pos_y > WORLD_HEIGHT_PX - PLAYER_RADIUS {
                        continue;
                    }
                    
                    // Check if suitable for this species spawning
                    if is_position_in_central_compound(group_pos_x, group_pos_y) ||
                       !is_wild_animal_location_suitable(ctx, group_pos_x, group_pos_y, chosen_species, &spawned_tree_positions) {
                        continue;
                    }
                    
                    // Block water spawns ONLY for non-aquatic animals
                    let is_aquatic_species = matches!(chosen_species, AnimalSpecies::SalmonShark | AnimalSpecies::Jellyfish);
                    if is_position_on_water(ctx, group_pos_x, group_pos_y) && !is_aquatic_species {
                        continue;
                    }
                    
                    // Check distance from other animals in this group (minimum 25px apart)
                    let mut too_close_to_group_member = false;
                    for &(other_x, other_y) in &group_positions {
                        let dx = group_pos_x - other_x;
                        let dy = group_pos_y - other_y;
                        if dx * dx + dy * dy < (25.0 * 25.0) {
                            too_close_to_group_member = true;
                            break;
                        }
                    }
                    if too_close_to_group_member {
                        continue;
                    }
                    
                    // Check distance from existing animals outside this group
                    let mut too_close_to_other_animal = false;
                    for &(other_x, other_y) in &spawned_wild_animal_positions {
                        let dx = group_pos_x - other_x;
                        let dy = group_pos_y - other_y;
                        if dx * dx + dy * dy < (80.0 * 80.0) { // Reduced from 150 for group members
                            too_close_to_other_animal = true;
                            break;
                        }
                    }
                    if too_close_to_other_animal {
                        continue;
                    }
                    
                    // Position is valid, add to group
                    group_positions.push((group_pos_x, group_pos_y));
                    break;
                }
            }
        }
        
        log::info!("Spawning {} {:?} at position ({:.1}, {:.1})", 
                  group_positions.len(), chosen_species, pos_x, pos_y);
        
        // BREEDING SYSTEM: Caribou and walruses spawn as ADULTS ONLY during world generation
        // Youth (calves/pups) are ONLY created through births from pregnant females.
        // This ensures youth are NEVER alone - they're always born near their mother and herd.
        // We track sex assignment to guarantee at least 1 male + 1 female per group for breeding.
        
        // For caribou herds, track sex assignment to ensure breeding viability
        let mut caribou_males_spawned = 0;
        let mut caribou_females_spawned = 0;
        let caribou_herd_size = group_positions.len();
        
        // For walrus groups, track sex assignment to ensure breeding viability
        let mut walrus_males_spawned = 0;
        let mut walrus_females_spawned = 0;
        let walrus_group_size = group_positions.len();
        
        // Spawn all animals in the group
        let mut group_spawn_success = true;
        for (i, &(spawn_x, spawn_y)) in group_positions.iter().enumerate() {
            let new_animal = crate::wild_animal_npc::WildAnimal {
                id: 0, // auto_inc
                species: chosen_species,
                pos_x: spawn_x,
                pos_y: spawn_y,
                direction_x: 0.0,
                direction_y: 1.0,
                facing_direction: "left".to_string(), // Default facing direction
                state: AnimalState::Patrolling,
                health: max_health as f32,
                spawn_x: spawn_x,
                spawn_y: spawn_y,
                target_player_id: None,
                last_attack_time: None,
                state_change_time: ctx.timestamp,
                hide_until: None,
                investigation_x: None,
                investigation_y: None,
                patrol_phase: 0.0,
                scent_ping_timer: 0,
                movement_pattern: MovementPattern::Loop, // Default pattern
                chunk_index: chunk_idx,
                created_at: ctx.timestamp,
                last_hit_time: None,
                
                // Pack behavior fields
                pack_id: None,
                is_pack_leader: false,
                pack_join_time: None,
                last_pack_check: None,
                
                // Fire fear override
                fire_fear_overridden_by: None,
                
                // Taming system fields
                tamed_by: None,
                tamed_at: None,
                heart_effect_until: None,
                crying_effect_until: None,
                last_food_check: None,
                
                // Bird scavenging/stealing system fields
                held_item_name: None,
                held_item_quantity: None,
                flying_target_x: None,
                flying_target_y: None,
                is_flying: matches!(chosen_species, AnimalSpecies::Tern | AnimalSpecies::Crow), // Birds start flying
                
                // Night hostile NPC fields (not used for normal animals)
                is_hostile_npc: false,
                target_structure_id: None,
                target_structure_type: None,
                stalk_angle: 0.0,
                stalk_distance: 0.0,
                despawn_at: None,
                shock_active_until: None,
                last_shock_time: None,
            };

            match ctx.db.wild_animal().try_insert(new_animal) {
                Ok(inserted_animal) => {
                    spawned_wild_animal_positions.push((spawn_x, spawn_y));
                    spawned_wild_animal_count += 1;
                    
                    // For caribou, assign sex and create breeding data
                    // Ensure at least one male and one female per herd for breeding viability
                    if matches!(chosen_species, AnimalSpecies::Caribou) {
                        let assigned_sex = if caribou_herd_size >= 2 {
                            // Force at least one of each sex for breeding
                            if caribou_males_spawned == 0 && i == caribou_herd_size - 1 && caribou_females_spawned > 0 {
                                // Last caribou, no males yet, force male
                                CaribouSex::Male
                            } else if caribou_females_spawned == 0 && i == caribou_herd_size - 1 && caribou_males_spawned > 0 {
                                // Last caribou, no females yet, force female
                                CaribouSex::Female
                            } else if caribou_males_spawned == 0 && i == 0 {
                                // First caribou, assign male to guarantee one
                                CaribouSex::Male
                            } else if caribou_females_spawned == 0 && i == 1 {
                                // Second caribou, assign female to guarantee one  
                                CaribouSex::Female
                            } else {
                                // Random for others
                                if rng.gen::<bool>() { CaribouSex::Male } else { CaribouSex::Female }
                            }
                        } else {
                            // Single caribou, random sex
                            if rng.gen::<bool>() { CaribouSex::Male } else { CaribouSex::Female }
                        };
                        
                        match assigned_sex {
                            CaribouSex::Male => caribou_males_spawned += 1,
                            CaribouSex::Female => caribou_females_spawned += 1,
                        }
                        
                        if let Err(e) = crate::wild_animal_npc::assign_caribou_sex_forced(ctx, inserted_animal.id, assigned_sex) {
                            log::warn!("Failed to assign sex to caribou {}: {}", inserted_animal.id, e);
                        }
                    }
                    
                    // For walrus groups, assign sex and create breeding data
                    // Ensure at least one male and one female per group for breeding viability
                    if matches!(chosen_species, AnimalSpecies::ArcticWalrus) {
                        use crate::wild_animal_npc::WalrusSex;
                        
                        let assigned_sex = if walrus_group_size >= 2 {
                            // Force at least one of each sex for breeding
                            if walrus_males_spawned == 0 && i == walrus_group_size - 1 && walrus_females_spawned > 0 {
                                // Last walrus, no males yet, force male
                                WalrusSex::Male
                            } else if walrus_females_spawned == 0 && i == walrus_group_size - 1 && walrus_males_spawned > 0 {
                                // Last walrus, no females yet, force female
                                WalrusSex::Female
                            } else if walrus_males_spawned == 0 && i == 0 {
                                // First walrus, assign male to guarantee one
                                WalrusSex::Male
                            } else if walrus_females_spawned == 0 && i == 1 {
                                // Second walrus, assign female to guarantee one  
                                WalrusSex::Female
                            } else {
                                // Random for others
                                if rng.gen::<bool>() { WalrusSex::Male } else { WalrusSex::Female }
                            }
                        } else {
                            // Single walrus, random sex
                            if rng.gen::<bool>() { WalrusSex::Male } else { WalrusSex::Female }
                        };
                        
                        match assigned_sex {
                            WalrusSex::Male => walrus_males_spawned += 1,
                            WalrusSex::Female => walrus_females_spawned += 1,
                        }
                        
                        if let Err(e) = crate::wild_animal_npc::assign_walrus_sex_forced(ctx, inserted_animal.id, assigned_sex) {
                            log::warn!("Failed to assign sex to walrus {}: {}", inserted_animal.id, e);
                        }
                    }
                    
                    log::info!("Spawned {:?} #{} at ({:.1}, {:.1}) [group member {}/{}]", 
                              chosen_species, inserted_animal.id, spawn_x, spawn_y, i + 1, group_positions.len());
                }
                Err(e) => {
                    log::warn!("Failed to insert {:?} group member {} at ({:.1}, {:.1}): {}. Skipping this animal.", 
                              chosen_species, i + 1, spawn_x, spawn_y, e);
                    group_spawn_success = false;
                    break;
                }
            }
        }
        
        if group_spawn_success {
            occupied_tiles.insert((tile_x, tile_y));
            // Update chunk animal count (count the whole group as one "spawn event")
            animals_per_chunk_map.insert(chunk_idx, current_animals_in_chunk + 1);
        }
    }
    log::info!(
        "Finished seeding {} wild animals (target: {}, attempts: {}).",
        spawned_wild_animal_count, target_wild_animal_count, wild_animal_attempts
    );

    // --- Seed Terns near Reed Marshes ---
    // Reed marshes attract terns as a hunting/scavenging location
    let terns_spawned = spawn_terns_near_reed_marshes(ctx, &mut rng, &spawned_wild_animal_positions);
    log::info!("🐦 Spawned {} terns near reed marshes", terns_spawned);

    // --- Seed Wolverines near Whale Bone Graveyard ---
    // Wolverines are attracted to the mysterious whale bone graveyard
    let wolverines_spawned = spawn_wolverines_near_whale_bone_graveyard(ctx, &mut rng, &spawned_wild_animal_positions);
    log::info!("🦡 Spawned {} wolverines near whale bone graveyard", wolverines_spawned);

    // --- Seed Crabs and Terns near Tide Pools ---
    // Tide pools are coastal inlets - crabs and terns spawn here (focus on crabs, a few terns)
    let (crabs_spawned, terns_at_pools) = spawn_crabs_and_terns_near_tide_pools(ctx, &mut rng, &spawned_wild_animal_positions);
    log::info!("🦀 Spawned {} crabs and {} terns near tide pools", crabs_spawned, terns_at_pools);

    // --- Seed Grass --- OPTIMIZED: Simple noise-based spawning on Grass/Forest tiles
    // REVERTED from plains detection (too intensive) back to efficient random sampling
    log::info!("Seeding Grass (optimized - Grass/Forest tiles only)...");
    
    // Get world tiles handle for biome checking
    let world_tiles_for_biome = ctx.db.world_tile();
    
    while spawned_grass_count < target_grass_count && grass_attempts < max_grass_attempts {
        grass_attempts += 1;

        // Generate random tile coordinates  
        let tile_x = rng.gen_range(min_tile_x..max_tile_x);
        let tile_y = rng.gen_range(min_tile_y..max_tile_y);
        
        // ===== BIOME FILTER: Only spawn on Grass or Forest tiles =====
        // Check tile type at this position
        let mut valid_biome = false;
        for tile in world_tiles_for_biome.idx_world_position().filter((tile_x as i32, tile_y as i32)) {
            if matches!(tile.tile_type, TileType::Grass | TileType::Forest) {
                valid_biome = true;
            }
            break;
        }
        if !valid_biome {
            continue; // Skip non-grass/forest biomes (Tundra, Alpine, Water, etc.)
        }

        // Calculate position
        let pos_x = (tile_x as f32 + 0.5) * TILE_SIZE_PX as f32;
        let pos_y = (tile_y as f32 + 0.5) * TILE_SIZE_PX as f32;

        // Skip central compound
        if is_position_in_central_compound(pos_x, pos_y) {
            continue;
        }

        // Noise check for natural distribution
        let noise_val = fbm.get([
            (pos_x as f64 / WORLD_WIDTH_PX as f64) * crate::grass::GRASS_SPAWN_NOISE_FREQUENCY,
            (pos_y as f64 / WORLD_HEIGHT_PX as f64) * crate::grass::GRASS_SPAWN_NOISE_FREQUENCY,
        ]);
        let normalized_noise = (noise_val + 1.0) / 2.0;
        if normalized_noise <= crate::grass::GRASS_SPAWN_NOISE_THRESHOLD {
            continue;
        }

        // Distance check from trees (O(n) where n = tree count, reasonable)
        let too_close_to_tree = spawned_tree_positions.iter().any(|(tx, ty)| {
            let dx = pos_x - tx;
            let dy = pos_y - ty;
            dx * dx + dy * dy < crate::grass::MIN_GRASS_TREE_DISTANCE_SQ
        });
        if too_close_to_tree {
            continue;
        }

        // Distance check from stones (O(n) where n = stone count, reasonable)
        let too_close_to_stone = spawned_stone_positions.iter().any(|(sx, sy)| {
            let dx = pos_x - sx;
            let dy = pos_y - sy;
            dx * dx + dy * dy < crate::grass::MIN_GRASS_STONE_DISTANCE_SQ
        });
        if too_close_to_stone {
            continue;
        }

        // Generate random grass properties
        let sway_offset_seed = rng.gen::<u32>();
        let sway_speed = rng.gen_range(0.5..2.0);
        
        // Choose grass appearance type with weighted distribution
        let appearance_roll: f64 = rng.gen_range(0.0..1.0);
        let appearance_type = if appearance_roll < 0.2 {
            GrassAppearanceType::PatchA
        } else if appearance_roll < 0.4 {
            GrassAppearanceType::PatchB
        } else if appearance_roll < 0.6 {
            GrassAppearanceType::PatchC
        } else if appearance_roll < 0.7 {
            GrassAppearanceType::PatchD
        } else if appearance_roll < 0.8 {
            GrassAppearanceType::PatchE
        } else if appearance_roll < 0.9 {
            GrassAppearanceType::TallGrassA
        } else {
            GrassAppearanceType::TallGrassB
        };

        let chunk_idx = calculate_chunk_index(pos_x, pos_y);
        
        // Use helper to spawn both Grass (static) and GrassState (dynamic) tables
        match crate::grass::spawn_grass_entity(
            ctx,
            pos_x,
            pos_y,
            appearance_type,
            chunk_idx,
            sway_offset_seed,
            sway_speed,
        ) {
            Ok(_) => {
                spawned_grass_count += 1;
            }
            Err(e) => {
                log::warn!("Failed to spawn grass at ({}, {}): {}", pos_x, pos_y, e);
            }
        }
    }
    log::info!(
        "Finished seeding {} grass entities (target: {}, attempts: {}).",
        spawned_grass_count, target_grass_count, grass_attempts
    );

    // --- Seed Tundra Grass --- Similar to regular grass but for Tundra/TundraGrass tiles
    log::info!("Seeding Tundra Grass (Tundra/TundraGrass tiles only)...");
    
    // Count tundra tiles for density calculation
    let mut tundra_tile_count = 0u32;
    for tile in world_tiles_for_biome.iter() {
        if matches!(tile.tile_type, TileType::Tundra | TileType::TundraGrass) {
            tundra_tile_count += 1;
        }
    }
    
    // Target ~12% of Tundra/TundraGrass tiles (same density as regular grass)
    const TUNDRA_GRASS_DENSITY_PERCENT: f32 = 0.12;
    let target_tundra_grass_count = (tundra_tile_count as f32 * TUNDRA_GRASS_DENSITY_PERCENT) as u32;
    let max_tundra_grass_attempts = target_tundra_grass_count * crate::grass::MAX_GRASS_SEEDING_ATTEMPTS_FACTOR;
    
    log::info!("Target Tundra Grass: {} (from {} Tundra/TundraGrass tiles, {:.1}% density), Max Attempts: {}", 
        target_tundra_grass_count, tundra_tile_count, TUNDRA_GRASS_DENSITY_PERCENT * 100.0, max_tundra_grass_attempts);
    
    let mut spawned_tundra_grass_count = 0;
    let mut tundra_grass_attempts = 0;
    
    while spawned_tundra_grass_count < target_tundra_grass_count && tundra_grass_attempts < max_tundra_grass_attempts {
        tundra_grass_attempts += 1;
        
        // Generate random tile coordinates
        let tile_x = rng.gen_range(min_tile_x..max_tile_x);
        let tile_y = rng.gen_range(min_tile_y..max_tile_y);
        
        // ===== BIOME FILTER: Only spawn on Tundra or TundraGrass tiles =====
        let mut valid_biome = false;
        for tile in world_tiles_for_biome.idx_world_position().filter((tile_x as i32, tile_y as i32)) {
            if matches!(tile.tile_type, TileType::Tundra | TileType::TundraGrass) {
                valid_biome = true;
            }
            break;
        }
        if !valid_biome {
            continue; // Skip non-tundra biomes
        }
        
        // Calculate position
        let pos_x = (tile_x as f32 + 0.5) * TILE_SIZE_PX as f32;
        let pos_y = (tile_y as f32 + 0.5) * TILE_SIZE_PX as f32;
        
        // Skip central compound
        if is_position_in_central_compound(pos_x, pos_y) {
            continue;
        }
        
        // Noise check for natural distribution (same as regular grass)
        let noise_val = fbm.get([
            (pos_x as f64 / WORLD_WIDTH_PX as f64) * crate::grass::GRASS_SPAWN_NOISE_FREQUENCY,
            (pos_y as f64 / WORLD_HEIGHT_PX as f64) * crate::grass::GRASS_SPAWN_NOISE_FREQUENCY,
        ]);
        let normalized_noise = (noise_val + 1.0) / 2.0;
        if normalized_noise <= crate::grass::GRASS_SPAWN_NOISE_THRESHOLD {
            continue;
        }
        
        // Distance check from trees
        let too_close_to_tree = spawned_tree_positions.iter().any(|(tx, ty)| {
            let dx = pos_x - tx;
            let dy = pos_y - ty;
            dx * dx + dy * dy < crate::grass::MIN_GRASS_TREE_DISTANCE_SQ
        });
        if too_close_to_tree {
            continue;
        }
        
        // Distance check from stones
        let too_close_to_stone = spawned_stone_positions.iter().any(|(sx, sy)| {
            let dx = pos_x - sx;
            let dy = pos_y - sy;
            dx * dx + dy * dy < crate::grass::MIN_GRASS_STONE_DISTANCE_SQ
        });
        if too_close_to_stone {
            continue;
        }
        
        // Generate random grass properties
        let sway_offset_seed = rng.gen::<u32>();
        let sway_speed = rng.gen_range(0.5..2.0);
        
        // Choose tundra grass appearance type with weighted distribution
        let appearance_roll: f64 = rng.gen_range(0.0..1.0);
        let appearance_type = if appearance_roll < 0.2 {
            GrassAppearanceType::TundraPatchA
        } else if appearance_roll < 0.4 {
            GrassAppearanceType::TundraPatchB
        } else if appearance_roll < 0.6 {
            GrassAppearanceType::TundraPatchC
        } else if appearance_roll < 0.7 {
            GrassAppearanceType::TundraPatchD
        } else if appearance_roll < 0.85 {
            GrassAppearanceType::TallGrassTundraA
        } else {
            GrassAppearanceType::TallGrassTundraB
        };
        
        let chunk_idx = calculate_chunk_index(pos_x, pos_y);
        
        // Use helper to spawn both Grass (static) and GrassState (dynamic) tables
        match crate::grass::spawn_grass_entity(
            ctx,
            pos_x,
            pos_y,
            appearance_type,
            chunk_idx,
            sway_offset_seed,
            sway_speed,
        ) {
            Ok(_) => {
                spawned_tundra_grass_count += 1;
            }
            Err(e) => {
                log::warn!("Failed to spawn tundra grass at ({}, {}): {}", pos_x, pos_y, e);
            }
        }
    }
    log::info!(
        "Finished seeding {} tundra grass entities (target: {}, attempts: {}).",
        spawned_tundra_grass_count, target_tundra_grass_count, tundra_grass_attempts
    );

    // --- Seed Alpine Grass --- Similar to tundra grass but for Alpine tiles only
    log::info!("Seeding Alpine Grass (Alpine tiles only)...");
    
    // Count alpine tiles for density calculation
    let mut alpine_tile_count = 0u32;
    for tile in world_tiles_for_biome.iter() {
        if tile.tile_type == TileType::Alpine {
            alpine_tile_count += 1;
        }
    }
    
    // Target ~12% of Alpine tiles (same density as regular grass)
    const ALPINE_GRASS_DENSITY_PERCENT: f32 = 0.12;
    let target_alpine_grass_count = (alpine_tile_count as f32 * ALPINE_GRASS_DENSITY_PERCENT) as u32;
    let max_alpine_grass_attempts = target_alpine_grass_count * crate::grass::MAX_GRASS_SEEDING_ATTEMPTS_FACTOR;
    
    log::info!("Target Alpine Grass: {} (from {} Alpine tiles, {:.1}% density), Max Attempts: {}", 
        target_alpine_grass_count, alpine_tile_count, ALPINE_GRASS_DENSITY_PERCENT * 100.0, max_alpine_grass_attempts);
    
    let mut spawned_alpine_grass_count = 0;
    let mut alpine_grass_attempts = 0;
    
    while spawned_alpine_grass_count < target_alpine_grass_count && alpine_grass_attempts < max_alpine_grass_attempts {
        alpine_grass_attempts += 1;
        
        // Generate random tile coordinates
        let tile_x = rng.gen_range(min_tile_x..max_tile_x);
        let tile_y = rng.gen_range(min_tile_y..max_tile_y);
        
        // ===== BIOME FILTER: Only spawn on Alpine tiles =====
        let mut valid_biome = false;
        for tile in world_tiles_for_biome.idx_world_position().filter((tile_x as i32, tile_y as i32)) {
            if tile.tile_type == TileType::Alpine {
                valid_biome = true;
            }
            break;
        }
        if !valid_biome {
            continue; // Skip non-alpine biomes
        }
        
        // Calculate position
        let pos_x = (tile_x as f32 + 0.5) * TILE_SIZE_PX as f32;
        let pos_y = (tile_y as f32 + 0.5) * TILE_SIZE_PX as f32;
        
        // Skip central compound
        if is_position_in_central_compound(pos_x, pos_y) {
            continue;
        }
        
        // Noise check for natural distribution (same as regular grass)
        let noise_val = fbm.get([
            (pos_x as f64 / WORLD_WIDTH_PX as f64) * crate::grass::GRASS_SPAWN_NOISE_FREQUENCY,
            (pos_y as f64 / WORLD_HEIGHT_PX as f64) * crate::grass::GRASS_SPAWN_NOISE_FREQUENCY,
        ]);
        let normalized_noise = (noise_val + 1.0) / 2.0;
        if normalized_noise <= crate::grass::GRASS_SPAWN_NOISE_THRESHOLD {
            continue;
        }
        
        // Distance check from trees
        let too_close_to_tree = spawned_tree_positions.iter().any(|(tx, ty)| {
            let dx = pos_x - tx;
            let dy = pos_y - ty;
            dx * dx + dy * dy < crate::grass::MIN_GRASS_TREE_DISTANCE_SQ
        });
        if too_close_to_tree {
            continue;
        }
        
        // Distance check from stones
        let too_close_to_stone = spawned_stone_positions.iter().any(|(sx, sy)| {
            let dx = pos_x - sx;
            let dy = pos_y - sy;
            dx * dx + dy * dy < crate::grass::MIN_GRASS_STONE_DISTANCE_SQ
        });
        if too_close_to_stone {
            continue;
        }
        
        // Generate random grass properties
        let sway_offset_seed = rng.gen::<u32>();
        let sway_speed = rng.gen_range(0.5..2.0);
        
        // Choose alpine grass appearance type with weighted distribution
        let appearance_roll: f64 = rng.gen_range(0.0..1.0);
        let appearance_type = if appearance_roll < 0.2 {
            GrassAppearanceType::AlpinePatchA
        } else if appearance_roll < 0.4 {
            GrassAppearanceType::AlpinePatchB
        } else if appearance_roll < 0.6 {
            GrassAppearanceType::AlpinePatchC
        } else if appearance_roll < 0.7 {
            GrassAppearanceType::AlpinePatchD
        } else if appearance_roll < 0.85 {
            GrassAppearanceType::TallGrassAlpineA
        } else {
            GrassAppearanceType::TallGrassAlpineB
        };
        
        let chunk_idx = calculate_chunk_index(pos_x, pos_y);
        
        // Use helper to spawn both Grass (static) and GrassState (dynamic) tables
        match crate::grass::spawn_grass_entity(
            ctx,
            pos_x,
            pos_y,
            appearance_type,
            chunk_idx,
            sway_offset_seed,
            sway_speed,
        ) {
            Ok(_) => {
                spawned_alpine_grass_count += 1;
            }
            Err(e) => {
                log::warn!("Failed to spawn alpine grass at ({}, {}): {}", pos_x, pos_y, e);
            }
        }
    }
    log::info!(
        "Finished seeding {} alpine grass entities (target: {}, attempts: {}).",
        spawned_alpine_grass_count, target_alpine_grass_count, alpine_grass_attempts
    );

    // --- Seed Beach Grass --- Sparse coastal dune grass on Beach tiles
    log::info!("Seeding Beach Grass (Beach tiles only)...");
    
    // Count beach tiles for density calculation
    let mut beach_tile_count = 0u32;
    for tile in world_tiles_for_biome.iter() {
        if tile.tile_type == TileType::Beach {
            beach_tile_count += 1;
        }
    }
    
    // Target ~5% of Beach tiles (sparser than regular grass - beaches are mostly sandy)
    const BEACH_GRASS_DENSITY_PERCENT: f32 = 0.05;
    let target_beach_grass_count = (beach_tile_count as f32 * BEACH_GRASS_DENSITY_PERCENT) as u32;
    let max_beach_grass_attempts = target_beach_grass_count * crate::grass::MAX_GRASS_SEEDING_ATTEMPTS_FACTOR;
    
    log::info!("Target Beach Grass: {} (from {} Beach tiles, {:.1}% density), Max Attempts: {}", 
        target_beach_grass_count, beach_tile_count, BEACH_GRASS_DENSITY_PERCENT * 100.0, max_beach_grass_attempts);
    
    let mut spawned_beach_grass_count = 0;
    let mut beach_grass_attempts = 0;
    
    while spawned_beach_grass_count < target_beach_grass_count && beach_grass_attempts < max_beach_grass_attempts {
        beach_grass_attempts += 1;
        
        // Generate random tile coordinates
        let tile_x = rng.gen_range(min_tile_x..max_tile_x);
        let tile_y = rng.gen_range(min_tile_y..max_tile_y);
        
        // ===== BIOME FILTER: Only spawn on Beach tiles =====
        let mut valid_biome = false;
        for tile in world_tiles_for_biome.idx_world_position().filter((tile_x as i32, tile_y as i32)) {
            if tile.tile_type == TileType::Beach {
                valid_biome = true;
            }
            break;
        }
        if !valid_biome {
            continue; // Skip non-beach biomes
        }
        
        // Calculate position
        let pos_x = (tile_x as f32 + 0.5) * TILE_SIZE_PX as f32;
        let pos_y = (tile_y as f32 + 0.5) * TILE_SIZE_PX as f32;
        
        // Skip central compound
        if is_position_in_central_compound(pos_x, pos_y) {
            continue;
        }
        
        // Noise check for natural distribution (sparser on beach)
        let noise_val = fbm.get([
            (pos_x as f64 / WORLD_WIDTH_PX as f64) * crate::grass::GRASS_SPAWN_NOISE_FREQUENCY * 1.5, // Higher frequency = smaller clusters
            (pos_y as f64 / WORLD_HEIGHT_PX as f64) * crate::grass::GRASS_SPAWN_NOISE_FREQUENCY * 1.5,
        ]);
        let normalized_noise = (noise_val + 1.0) / 2.0;
        if normalized_noise <= 0.5 { // Higher threshold = sparser
            continue;
        }
        
        // Distance check from trees
        let too_close_to_tree = spawned_tree_positions.iter().any(|(tx, ty)| {
            let dx = pos_x - tx;
            let dy = pos_y - ty;
            dx * dx + dy * dy < crate::grass::MIN_GRASS_TREE_DISTANCE_SQ
        });
        if too_close_to_tree {
            continue;
        }
        
        // Distance check from stones
        let too_close_to_stone = spawned_stone_positions.iter().any(|(sx, sy)| {
            let dx = pos_x - sx;
            let dy = pos_y - sy;
            dx * dx + dy * dy < crate::grass::MIN_GRASS_STONE_DISTANCE_SQ
        });
        if too_close_to_stone {
            continue;
        }
        
        // Generate random grass properties
        let sway_offset_seed = rng.gen::<u32>();
        let sway_speed = rng.gen_range(0.8..2.5); // Slightly faster sway for coastal wind
        
        // Beach grass is always BeachGrassA (single variant for now)
        let appearance_type = GrassAppearanceType::BeachGrassA;
        
        let chunk_idx = calculate_chunk_index(pos_x, pos_y);
        
        // Use helper to spawn both Grass (static) and GrassState (dynamic) tables
        match crate::grass::spawn_grass_entity(
            ctx,
            pos_x,
            pos_y,
            appearance_type,
            chunk_idx,
            sway_offset_seed,
            sway_speed,
        ) {
            Ok(_) => {
                spawned_beach_grass_count += 1;
            }
            Err(e) => {
                log::warn!("Failed to spawn beach grass at ({}, {}): {}", pos_x, pos_y, e);
            }
        }
    }
    log::info!(
        "Finished seeding {} beach grass entities (target: {}, attempts: {}).",
        spawned_beach_grass_count, target_beach_grass_count, beach_grass_attempts
    );

    // --- Seed Clouds ---
    log::info!("Seeding Clouds...");
    // Use WORLD_WIDTH_PX and WORLD_HEIGHT_PX from crate root (lib.rs)
    let world_width_px = crate::WORLD_WIDTH_PX;
    let world_height_px = crate::WORLD_HEIGHT_PX;

    while spawned_cloud_count < target_cloud_count && cloud_attempts < max_cloud_attempts {
        cloud_attempts += 1;

        let pos_x = rng.gen_range(0.0..world_width_px);
        let pos_y = rng.gen_range(0.0..world_height_px);
        
        // Basic check to avoid too many clouds in the exact same spot, though less critical.
        let mut too_close = false;
        for &(other_x, other_y) in &spawned_cloud_positions {
            let dx = pos_x - other_x;
            let dy = pos_y - other_y;
            // Using a generic minimum distance, e.g., 100px. Adjust as needed.
            if (dx * dx + dy * dy) < (100.0 * 100.0) { 
                too_close = true;
                break;
            }
        }
        if too_close {
            continue; // Try another position
        }

        // Use the existing calculate_chunk_index function from this module
        let chunk_idx = calculate_chunk_index(pos_x, pos_y);

        let shape_roll = rng.gen_range(0..5); // Corrected to 0..5 for 5 types
        let shape = match shape_roll {
            0 => crate::cloud::CloudShapeType::CloudImage1,
            1 => crate::cloud::CloudShapeType::CloudImage2,
            2 => crate::cloud::CloudShapeType::CloudImage3,
            3 => crate::cloud::CloudShapeType::CloudImage4,
            _ => crate::cloud::CloudShapeType::CloudImage5, // Default to CloudImage5
        };

        let base_width = rng.gen_range(200.0..600.0); 
        let width_variation_factor = rng.gen_range(0.7..1.3);
        let height_variation_factor = rng.gen_range(0.5..1.0); // Can be different from width factor for variety

        // Simplified width and height assignment, removing problematic match statements
        let width = base_width * width_variation_factor;
        let height = base_width * height_variation_factor; // Height based on base_width and its own factor
        
        let rotation_degrees = rng.gen_range(0.0..360.0);
        let base_opacity = rng.gen_range(0.08..0.25); 
        let blur_strength = rng.gen_range(10.0..30.0); 

        // Choose a random cloud type with weighted distribution
        let cloud_type = match rng.gen_range(0..100) {
            0..=30 => crate::cloud::CloudType::Cumulus,    // 30% - Most common
            31..=50 => crate::cloud::CloudType::Wispy,     // 20% - Light clouds
            51..=70 => crate::cloud::CloudType::Stratus,   // 20% - Layer clouds
            71..=85 => crate::cloud::CloudType::Cirrus,    // 15% - High thin clouds
            _ => crate::cloud::CloudType::Nimbus,          // 15% - Storm clouds
        };

        // Set evolution parameters based on cloud type
        let evolution_speed = rng.gen_range(0.1..0.3); // Base evolution speed (cycles per hour)
        let evolution_phase = rng.gen_range(0.0..1.0); // Random starting phase

        let new_cloud = crate::cloud::Cloud {
            id: 0, // auto_inc
            pos_x,
            pos_y,
            chunk_index: chunk_idx,
            shape,
            width,
            height,
            rotation_degrees,
            base_opacity,
            current_opacity: base_opacity, // Initialize current_opacity to base_opacity
            blur_strength,
            // --- Initialize new drift fields ---
            drift_speed_x: CLOUD_BASE_DRIFT_X + rng.gen_range(-CLOUD_DRIFT_VARIATION..CLOUD_DRIFT_VARIATION),
            drift_speed_y: CLOUD_BASE_DRIFT_Y + rng.gen_range(-CLOUD_DRIFT_VARIATION..CLOUD_DRIFT_VARIATION),
            // --- Initialize new dynamic intensity fields ---
            cloud_type,
            evolution_phase,
            evolution_speed,
            last_intensity_update: ctx.timestamp,
            spawned_during_storm: false, // Initial clouds are permanent
        };

        match ctx.db.cloud().try_insert(new_cloud) {
            Ok(inserted_cloud) => {
                spawned_cloud_positions.push((pos_x, pos_y));
                spawned_cloud_count += 1;
                log::info!("Inserted cloud id: {} at ({:.1}, {:.1}), chunk: {}", inserted_cloud.id, pos_x, pos_y, chunk_idx);
            }
            Err(e) => {
                log::warn!("Failed to insert cloud (attempt {}): {}. Skipping this cloud.", cloud_attempts, e);
            }
        }
    }
    log::info!(
        "Finished seeding {} clouds (target: {}, attempts: {}).",
        spawned_cloud_count, target_cloud_count, cloud_attempts
    );
    // --- End Seed Clouds ---

    // --- Schedule initial cloud update --- (NEW)
    if spawned_cloud_count > 0 {
        log::info!("Scheduling initial cloud position update.");
        let update_interval_seconds = 5.0; // How often to update cloud positions
        crate::try_insert_schedule!(
            ctx.db.cloud_update_schedule(),
            CloudUpdateSchedule {
                schedule_id: 0,
                scheduled_at: spacetimedb::spacetimedb_lib::ScheduleAt::Interval(spacetimedb::TimeDuration::from_micros((update_interval_seconds * 1_000_000.0) as i64)),
                delta_time_seconds: update_interval_seconds,
            },
            "Cloud update"
        );

        // --- Initialize Cloud Intensity System --- (NEW)
        log::info!("Initializing cloud intensity system.");
        if let Err(e) = crate::cloud::init_cloud_intensity_system(ctx) {
            log::error!("Failed to initialize cloud intensity system: {}", e);
        }
    }


    // --- Seed Barrels on Dirt Roads ---
    log::info!("Seeding Barrels on dirt roads...");
    
    // Collect all dirt road tiles from the world
    let world_tiles = ctx.db.world_tile();
    let dirt_road_tiles: Vec<(i32, i32)> = world_tiles.iter()
        .filter(|tile| tile.tile_type == TileType::DirtRoad)
        .map(|tile| (tile.world_x, tile.world_y))
        .collect();
    
    // Calculate scaling parameters based on map size (scaled; no hard caps)
    let current_map_tiles = WORLD_WIDTH_TILES * WORLD_HEIGHT_TILES;
    let area_target = ((current_map_tiles as f32) * crate::barrel::BARREL_CLUSTER_DENSITY_PER_TILE).round() as u32;
    let road_cap = (((dirt_road_tiles.len() as f32) / crate::barrel::ROAD_TILES_PER_CLUSTER).floor() as u32).max(1);
    // Cap area target by road availability; ensure at least 1
    let recommended_cluster_count = std::cmp::max(1, std::cmp::min(area_target, road_cap));
    
    log::info!("Found {} dirt road tiles for barrel spawning", dirt_road_tiles.len());
    log::info!(
        "Map size: {}x{} tiles ({}), Area target: {}, Road cap: {}, Final target: {}",
        WORLD_WIDTH_TILES,
        WORLD_HEIGHT_TILES,
        current_map_tiles,
        area_target,
        road_cap,
        recommended_cluster_count
    );
    
    // Spawn barrel clusters on dirt roads with scaling parameters
    match barrel::spawn_barrel_clusters_scaled(ctx, dirt_road_tiles.clone(), recommended_cluster_count) {
        Ok(_) => {
            let spawned_barrel_count = ctx.db.barrel().iter().count();
            log::info!("Successfully spawned {} barrels on dirt roads", spawned_barrel_count);
        }
        Err(e) => {
            log::error!("Failed to spawn barrels: {}", e);
        }
    }

    // --- Spawn Aleutian Whale Oil Lampposts along Dirt Roads ---
    // Spaced evenly but sparsely; excludes ALK central compound; sometimes near barrel clusters
    let barrel_positions: Vec<(f32, f32)> = ctx.db.barrel().iter()
        .filter(|b| b.health > 0.0 && b.variant < crate::barrel::SEA_BARREL_VARIANT_START) // Road barrels only
        .map(|b| (b.pos_x, b.pos_y))
        .collect();
    match crate::road_lamppost::spawn_road_lampposts(ctx, dirt_road_tiles.clone(), &barrel_positions) {
        Ok(count) => {
            log::info!("Successfully spawned {} Aleutian whale oil lampposts along dirt roads", count);
        }
        Err(e) => {
            log::error!("Failed to spawn road lampposts: {}", e);
        }
    }

    // --- Spawn Wild Beehives in Forest Areas ---
    log::info!("Seeding Wild Beehives in forest areas near trees...");
    let spawned_beehive_count = crate::wild_beehive::spawn_wild_beehives_in_forests(ctx, &spawned_tree_positions);
    log::info!("Successfully spawned {} wild beehives", spawned_beehive_count);

    // Generate summary for harvestable resources
    let mut harvestable_summary = String::new();
    for (plant_type, count) in &plant_spawned_counts {
        if !harvestable_summary.is_empty() {
            harvestable_summary.push_str(", ");
        }
        harvestable_summary.push_str(&format!("{:?}: {}", plant_type, count));
    }
    
    log::info!(
        "Environment seeding complete! Summary: Trees: {}, Stones: {}, Sea Stacks: {}, Living Coral: {}, Hot Springs: [tile-based], Harvestable Resources: [{}], Clouds: {}, Wild Animals: {}, Grass: {}, Tundra Grass: {}, Barrels: {}, Wild Beehives: {}",
        spawned_tree_count, spawned_stone_count, spawned_sea_stack_count, spawned_living_coral_count, harvestable_summary,
        spawned_cloud_count, spawned_wild_animal_count, spawned_grass_count, spawned_tundra_grass_count, ctx.db.barrel().iter().count(), spawned_beehive_count
    );

    // --- Seed Rune Stones ---
    log::info!("Seeding Rune Stones...");
    let rune_stones = ctx.db.rune_stone();
    
    // Calculate map dimensions for scaling (use tiles, not pixels)
    let map_area_tiles = total_tiles as f32; // Already calculated earlier in the function
    
    // Scale rune stone count with map size
    // Target: 6 rune stones for 400x400 tile map (160k tiles²)
    // Formula: base_count + (area_tiles / base_area) * additional_per_base_area
    // For 400x400: 6 rune stones
    // For 1000x1000: ~9-12 rune stones (scales with square root to avoid too many)
    let base_area_tiles = 160000.0; // 400x400 = 160k tiles² (reference point)
    let base_count = 6; // Minimum: 2 of each color (for 400x400 map)
    
    // Scale with square root to avoid exponential growth
    // For 400x400: sqrt(160k/160k) = 1.0, so 6 rune stones
    // For 1000x1000: sqrt(1M/160k) = sqrt(6.25) = 2.5, so ~15 rune stones
    let scale_factor = (map_area_tiles / base_area_tiles).sqrt();
    let target_rune_stone_count = ((base_count as f32) * scale_factor).round() as u32;
    
    // Ensure minimum of 6 (2 of each color) - smaller maps still get 6 rune stones
    let target_rune_stone_count = target_rune_stone_count.max(6);
    
    // Ensure we have at least 2 of each color, then distribute remaining evenly
    let min_per_color = 2;
    let guaranteed_count = min_per_color * 3; // 6 guaranteed (2 of each)
    let remaining_count = target_rune_stone_count.saturating_sub(guaranteed_count);
    let per_color_extra = remaining_count / 3; // Distribute remaining evenly
    let remainder_extra = remaining_count % 3; // Distribute remainder
    
    let target_green = min_per_color + per_color_extra + if remainder_extra > 0 { 1 } else { 0 };
    let target_red = min_per_color + per_color_extra + if remainder_extra > 1 { 1 } else { 0 };
    let target_blue = min_per_color + per_color_extra;
    
    log::info!(
        "Rune stone targets - Total: {}, Green: {}, Red: {}, Blue: {} (Map: {}x{} tiles, Area: {:.0} tiles²)",
        target_rune_stone_count, target_green, target_red, target_blue,
        WORLD_WIDTH_TILES, WORLD_HEIGHT_TILES, map_area_tiles
    );
    
    let (min_tile_x_rs, max_tile_x_rs, min_tile_y_rs, max_tile_y_rs) = 
        calculate_tile_bounds(WORLD_WIDTH_TILES, WORLD_HEIGHT_TILES, crate::rune_stone::RUNE_STONE_SPAWN_WORLD_MARGIN_TILES);
    
    // Calculate spawnable area
    let spawn_width_px = (max_tile_x_rs - min_tile_x_rs) as f32 * TILE_SIZE_PX as f32;
    let spawn_height_px = (max_tile_y_rs - min_tile_y_rs) as f32 * TILE_SIZE_PX as f32;
    
    // Create intelligent grid-based placement system
    // Divide map into grid cells - aim for roughly one rune stone per cell
    let grid_cols = ((target_rune_stone_count as f32).sqrt() * (spawn_width_px / spawn_height_px).max(1.0)).ceil() as u32;
    let grid_rows = ((target_rune_stone_count as f32 / grid_cols as f32).ceil() as u32).max(1);
    let cell_width_px = spawn_width_px / grid_cols as f32;
    let cell_height_px = spawn_height_px / grid_rows as f32;
    
    log::info!(
        "Rune stone grid: {}x{} cells ({}x{} px per cell), Spawn area: {}x{} px",
        grid_cols, grid_rows, cell_width_px, cell_height_px, spawn_width_px, spawn_height_px
    );
    
    // Track grid cell usage to ensure distribution
    let mut grid_cells_used: HashSet<(u32, u32)> = HashSet::new();
    let mut spawned_rune_stone_positions = Vec::<(f32, f32)>::new();
    
    // Collect barrel positions for distance checking (barrels are seeded before rune stones)
    let barrel_positions: Vec<(f32, f32)> = ctx.db.barrel().iter()
        .map(|barrel| (barrel.pos_x, barrel.pos_y))
        .collect();
    
    // Collect ALK station positions for distance checking (ALK system is initialized before environment seeding)
    let alk_station_positions: Vec<(f32, f32)> = ctx.db.alk_station().iter()
        .map(|station| (station.world_pos_x, station.world_pos_y))
        .collect();
    log::info!("Rune stone ALK exclusion: {} stations found, min distance {}px", 
               alk_station_positions.len(), crate::rune_stone::MIN_RUNE_STONE_ALK_STATION_DISTANCE_PX);
    
    // Collect monument positions for distance checking (all monument types - shipwreck, fishing village, whale bone, hunting village, drone, weather station, wolf den)
    let monument_positions: Vec<(f32, f32)> = ctx.db.monument_part().iter()
        .map(|part| (part.world_x, part.world_y))
        .collect();
    log::info!("Rune stone monument exclusion: {} monument parts found, min distance {}px", 
               monument_positions.len(), crate::rune_stone::MIN_RUNE_STONE_MONUMENT_DISTANCE_PX);
    
    // Track counts per color
    let mut spawned_green_count = 0;
    let mut spawned_red_count = 0;
    let mut spawned_blue_count = 0;
    
    let mut rune_stone_attempts = 0;
    let max_rune_stone_attempts = target_rune_stone_count * crate::rune_stone::MAX_RUNE_STONE_SEEDING_ATTEMPTS_FACTOR * 3; // More attempts for grid-based placement
    
    // Get all craftable items for red rune stones (all categories)
    // Simplified: Red and Green rune stones now boost ALL crafting/plants universally at 1.5x
    // No need to track specific items or plants anymore
    
    while (spawned_green_count < target_green || spawned_red_count < target_red || spawned_blue_count < target_blue)
        && rune_stone_attempts < max_rune_stone_attempts {
        rune_stone_attempts += 1;
        
        // Determine which color to spawn next (prioritize minimums, then balance)
        let rune_type = {
            // First, ensure minimums are met
            if spawned_green_count < min_per_color {
                crate::rune_stone::RuneStoneType::Green
            } else if spawned_red_count < min_per_color {
                crate::rune_stone::RuneStoneType::Red
            } else if spawned_blue_count < min_per_color {
                crate::rune_stone::RuneStoneType::Blue
            } else if spawned_green_count >= target_green && spawned_red_count >= target_red && spawned_blue_count >= target_blue {
                // All targets met, break
                break;
            } else {
                // Balance remaining: spawn the color that's furthest behind
                let green_deficit = target_green.saturating_sub(spawned_green_count);
                let red_deficit = target_red.saturating_sub(spawned_red_count);
                let blue_deficit = target_blue.saturating_sub(spawned_blue_count);
                
                if green_deficit >= red_deficit && green_deficit >= blue_deficit && green_deficit > 0 {
                    crate::rune_stone::RuneStoneType::Green
                } else if red_deficit >= blue_deficit && red_deficit > 0 {
                    crate::rune_stone::RuneStoneType::Red
                } else if blue_deficit > 0 {
                    crate::rune_stone::RuneStoneType::Blue
                } else {
                    // Shouldn't happen, but break if it does
                    break;
                }
            }
        };
        
        // Pre-generate effect configs BEFORE calling attempt_single_spawn to avoid borrowing rng twice
        let (agrarian_config, production_config, memory_shard_config) = match rune_type {
            crate::rune_stone::RuneStoneType::Green => {
                // Generate a unique random seed loot table for this rune stone
                let seed_loot_table = crate::rune_stone::generate_random_seed_loot_table(&mut rng);
                log::info!("Generated seed loot table for green rune stone: {:?}", seed_loot_table);
                
                (Some(crate::rune_stone::AgrarianEffectConfig {
                    seeds_spawned_this_night: 0,
                    last_seed_spawn_time: None,
                    night_start_time: None,
                    seed_loot_table,
                }), None, None)
            }
            crate::rune_stone::RuneStoneType::Red => {
                // Simplified: Boosts ALL crafting at 1.5x - no need to track specific items
                (None, Some(crate::rune_stone::ProductionEffectConfig {
                    items_spawned_this_night: 0,
                    last_item_spawn_time: None,
                    night_start_time: None,
                }), None)
            }
            crate::rune_stone::RuneStoneType::Blue => {
                (None, None, Some(crate::rune_stone::MemoryShardEffectConfig {
                    shards_spawned_this_night: 0,
                    last_shard_spawn_time: None,
                    night_start_time: None,
                }))
            }
        };
        
        // Try to find a good grid cell position
        // Try unused cells first (prefer spreading out)
        let mut available_cells: Vec<(u32, u32)> = (0..grid_rows)
            .flat_map(|row| (0..grid_cols).map(move |col| (col, row)))
            .filter(|cell| !grid_cells_used.contains(cell))
            .collect();
        
        // If no unused cells, allow reusing cells (but still check distance)
        if available_cells.is_empty() {
            available_cells = (0..grid_rows)
                .flat_map(|row| (0..grid_cols).map(move |col| (col, row)))
                .collect();
        }
        
        let mut found_position = false;
        if !available_cells.is_empty() {
            // Shuffle and try cells
            use rand::seq::SliceRandom;
            available_cells.shuffle(&mut rng);
            
            // Try up to 10 random cells
            for (grid_col, grid_row) in available_cells.iter().take(10) {
                // Calculate cell center position
                let cell_min_x = min_tile_x_rs as f32 * TILE_SIZE_PX as f32 + *grid_col as f32 * cell_width_px;
                let cell_min_y = min_tile_y_rs as f32 * TILE_SIZE_PX as f32 + *grid_row as f32 * cell_height_px;
                
                // Try multiple positions within the cell (center + some random offset)
                for _attempt in 0..5 {
                    let offset_x = rng.gen_range(-cell_width_px * 0.3..=cell_width_px * 0.3);
                    let offset_y = rng.gen_range(-cell_height_px * 0.3..=cell_height_px * 0.3);
                    
                    let pos_x = cell_min_x + cell_width_px * 0.5 + offset_x;
                    let pos_y = cell_min_y + cell_height_px * 0.5 + offset_y;
                    
                    // Validate position (not on water, not in central compound)
                    // Explicitly block all water tiles (ocean, inland water, beach water)
                    if is_position_on_water(ctx, pos_x, pos_y) || 
                       is_position_on_inland_water(ctx, pos_x, pos_y) ||
                       is_position_in_central_compound(pos_x, pos_y) {
                        continue;
                    }
                    
                    // Check minimum distance from ALK stations (central compound + substations) - 2000px
                    let too_close_to_alk = alk_station_positions.iter().any(|(sx, sy)| {
                        let dx = pos_x - sx;
                        let dy = pos_y - sy;
                        dx * dx + dy * dy < crate::rune_stone::MIN_RUNE_STONE_ALK_STATION_DISTANCE_SQ
                    });
                    
                    if too_close_to_alk {
                        continue;
                    }
                    
                    // Check minimum distance from monuments (shipwreck, fishing village, whale bone, hunting village, drone, weather station, wolf den) - 2000px
                    let too_close_to_monument = monument_positions.iter().any(|(mx, my)| {
                        let dx = pos_x - mx;
                        let dy = pos_y - my;
                        dx * dx + dy * dy < crate::rune_stone::MIN_RUNE_STONE_MONUMENT_DISTANCE_SQ
                    });
                    
                    if too_close_to_monument {
                        continue;
                    }
                    
                    // Check minimum distance from other rune stones
                    let min_dist_sq = crate::rune_stone::MIN_RUNE_STONE_DISTANCE_SQ;
                    let too_close_to_rune_stone = spawned_rune_stone_positions.iter().any(|(other_x, other_y)| {
                        let dx = pos_x - other_x;
                        let dy = pos_y - other_y;
                        dx * dx + dy * dy < min_dist_sq
                    });
                    
                    if too_close_to_rune_stone {
                        continue;
                    }
                    
                    // Check minimum distance from trees
                    let too_close_to_tree = spawned_tree_positions.iter().any(|(tree_x, tree_y)| {
                        let dx = pos_x - tree_x;
                        let dy = pos_y - tree_y;
                        dx * dx + dy * dy < crate::rune_stone::MIN_RUNE_STONE_TREE_DISTANCE_SQ
                    });
                    
                    if too_close_to_tree {
                        continue;
                    }
                    
                    // Check minimum distance from stones
                    let too_close_to_stone = spawned_stone_positions.iter().any(|(stone_x, stone_y)| {
                        let dx = pos_x - stone_x;
                        let dy = pos_y - stone_y;
                        dx * dx + dy * dy < crate::rune_stone::MIN_RUNE_STONE_STONE_DISTANCE_SQ
                    });
                    
                    if too_close_to_stone {
                        continue;
                    }
                    
                    // Check minimum distance from barrels
                    let too_close_to_barrel = barrel_positions.iter().any(|(barrel_x, barrel_y)| {
                        let dx = pos_x - barrel_x;
                        let dy = pos_y - barrel_y;
                        dx * dx + dy * dy < crate::rune_stone::MIN_RUNE_STONE_BARREL_DISTANCE_SQ
                    });
                    
                    if too_close_to_barrel {
                        continue;
                    }
                    
                    // Check minimum distance from hot springs (monuments) - 800px radius
                    // Iterate through all hot spring tiles and check distance
                    let mut too_close_to_hot_spring = false;
                    for tile in ctx.db.world_tile().iter() {
                        if tile.tile_type == crate::TileType::HotSpringWater {
                            let hot_spring_center_x = (tile.world_x as f32 * crate::TILE_SIZE_PX as f32) + (crate::TILE_SIZE_PX as f32 / 2.0);
                            let hot_spring_center_y = (tile.world_y as f32 * crate::TILE_SIZE_PX as f32) + (crate::TILE_SIZE_PX as f32 / 2.0);
                            let dx = pos_x - hot_spring_center_x;
                            let dy = pos_y - hot_spring_center_y;
                            let dist_sq = dx * dx + dy * dy;
                            
                            if dist_sq < crate::rune_stone::MIN_RUNE_STONE_HOT_SPRING_DISTANCE_SQ {
                                too_close_to_hot_spring = true;
                                break;
                            }
                        }
                    }
                    
                    if too_close_to_hot_spring {
                        continue;
                    }
                    
                    // Check minimum distance from quarries (monuments) - 800px radius
                    // Iterate through all quarry tiles and check distance
                    let mut too_close_to_quarry = false;
                    for tile in ctx.db.world_tile().iter() {
                        if tile.tile_type == crate::TileType::Quarry {
                            let quarry_center_x = (tile.world_x as f32 * crate::TILE_SIZE_PX as f32) + (crate::TILE_SIZE_PX as f32 / 2.0);
                            let quarry_center_y = (tile.world_y as f32 * crate::TILE_SIZE_PX as f32) + (crate::TILE_SIZE_PX as f32 / 2.0);
                            let dx = pos_x - quarry_center_x;
                            let dy = pos_y - quarry_center_y;
                            let dist_sq = dx * dx + dy * dy;
                            
                            if dist_sq < crate::rune_stone::MIN_RUNE_STONE_QUARRY_DISTANCE_SQ {
                                too_close_to_quarry = true;
                                break;
                            }
                        }
                    }
                    
                    if too_close_to_quarry {
                        continue;
                    }
                    
                    // Final validation: double-check we're not on water (safety measure)
                    if is_position_on_water(ctx, pos_x, pos_y) || is_position_on_inland_water(ctx, pos_x, pos_y) {
                        continue; // Skip this position if somehow it's on water
                    }
                    
                    // All distance checks passed - spawn the rune stone
                    let chunk_idx = calculate_chunk_index(pos_x, pos_y);
                    let new_rune_stone = crate::rune_stone::RuneStone {
                        id: 0,
                        pos_x,
                        pos_y,
                        chunk_index: chunk_idx,
                        rune_type: rune_type.clone(),
                        agrarian_config: agrarian_config.clone(),
                        production_config: production_config.clone(),
                        memory_shard_config: memory_shard_config.clone(),
                    };
                    
                    match rune_stones.try_insert(new_rune_stone) {
                        Ok(_inserted) => {
                            // Successfully spawned
                            spawned_rune_stone_positions.push((pos_x, pos_y));
                            grid_cells_used.insert((*grid_col, *grid_row));
                            
                            // Track counts
                            match rune_type {
                                crate::rune_stone::RuneStoneType::Green => spawned_green_count += 1,
                                crate::rune_stone::RuneStoneType::Red => spawned_red_count += 1,
                                crate::rune_stone::RuneStoneType::Blue => spawned_blue_count += 1,
                            }
                            
                            log::info!(
                                "Spawned {:?} rune stone at ({:.1}, {:.1}) in grid cell ({}, {})",
                                rune_type, pos_x, pos_y, grid_col, grid_row
                            );
                            
                            found_position = true;
                            break;
                        }
                        Err(_) => {
                            // Insert failed (shouldn't happen with auto_inc, but handle gracefully)
                            log::warn!("Failed to insert rune stone at ({:.1}, {:.1})", pos_x, pos_y);
                        }
                    }
                    
                    if found_position {
                        break;
                    }
                }
                
                if found_position {
                    break;
                }
            }
        }
    }
    
    // Final summary logging
    let total_spawned = spawned_green_count + spawned_red_count + spawned_blue_count;
    let green_met = spawned_green_count >= min_per_color;
    let red_met = spawned_red_count >= min_per_color;
    let blue_met = spawned_blue_count >= min_per_color;
    
    if !green_met || !red_met || !blue_met {
        log::warn!(
            "Could not guarantee minimum rune stones. Green: {}/{} (target: {}), Red: {}/{} (target: {}), Blue: {}/{} (target: {})",
            spawned_green_count, min_per_color, target_green,
            spawned_red_count, min_per_color, target_red,
            spawned_blue_count, min_per_color, target_blue
        );
    }
    
    log::info!(
        "Finished seeding rune stones - Total: {} (target: {}), Green: {} (target: {}), Red: {} (target: {}), Blue: {} (target: {}), Attempts: {}",
        total_spawned, target_rune_stone_count,
        spawned_green_count, target_green,
        spawned_red_count, target_red,
        spawned_blue_count, target_blue,
        rune_stone_attempts
    );
    

    // --- Seed Cairns ---
    seed_cairns(ctx)?;

    // --- Wild Animal Population Maintenance ---
    // Periodically checks if more animals should be spawned to maintain population
    crate::wild_animal_npc::respawn::maintain_wild_animal_population(ctx)?;

    Ok(())
}

// --- Resource Respawn Reducer --- Refactored using Macro ---

#[spacetimedb::reducer]
pub fn check_resource_respawns(ctx: &ReducerContext) -> Result<(), String> {
    // One snapshot per reducer — avoids ctx.db.large_quarry().iter() inside each stone update closure.
    let stone_respawn_quarry_circles: Vec<(f32, f32, f32, crate::LargeQuarryType)> = ctx
        .db
        .large_quarry()
        .iter()
        .map(|q| {
            let radius_px = q.radius_tiles as f32 * crate::TILE_SIZE_PX as f32;
            (
                q.world_x,
                q.world_y,
                radius_px * radius_px,
                q.quarry_type.clone(),
            )
        })
        .collect();

    // Respawn Stones
    check_and_respawn_resource!(
        ctx,
        stone, // Table symbol
        crate::stone::Stone, // Entity type
        "Stone", // Name for logging
        |s: &crate::stone::Stone| s.health == 0, // Filter: only check stones with 0 health
        |s: &mut crate::stone::Stone| { // Update logic
            s.health = crate::stone::STONE_INITIAL_HEALTH;
            
            // Create deterministic RNG seeded from position to ensure consistent ore type
            let position_seed: u64 = ((s.pos_x as u64) << 32) ^ (s.pos_y as u64);
            let mut position_rng = StdRng::seed_from_u64(position_seed);
            
            // Check if this stone is within a TYPED large quarry
            let mut found_quarry_type: Option<crate::LargeQuarryType> = None;
            for &(qx, qy, radius_sq, ref quarry_ty) in &stone_respawn_quarry_circles {
                let dx = s.pos_x - qx;
                let dy = s.pos_y - qy;
                if dx * dx + dy * dy < radius_sq {
                    found_quarry_type = Some(quarry_ty.clone());
                    break;
                }
            }
            
            // Determine ore type: use quarry type if in large quarry, otherwise location-based
            s.ore_type = if let Some(ref quarry_type) = found_quarry_type {
                crate::stone::OreType::random_for_quarry_type(quarry_type, &mut position_rng)
            } else {
                let is_in_quarry = is_position_on_monument(ctx, s.pos_x, s.pos_y);
                crate::stone::OreType::random_for_location(s.pos_x, s.pos_y, is_in_quarry, &mut position_rng)
            };
            
            // Generate new random resource amount based on ore type
            // Stone: Basic building material (500-1000)
            // Metal/Sulfur: Rarer materials (~50% of stone yield, 250-500)
            // Memory: Tech tree upgrades (120-180)
            s.resource_remaining = match s.ore_type {
                crate::stone::OreType::Stone => {
                    position_rng.gen_range(crate::stone::STONE_MIN_RESOURCES..=crate::stone::STONE_MAX_RESOURCES)
                },
                crate::stone::OreType::Metal => {
                    position_rng.gen_range(crate::stone::METAL_ORE_MIN_RESOURCES..=crate::stone::METAL_ORE_MAX_RESOURCES)
                },
                crate::stone::OreType::Sulfur => {
                    position_rng.gen_range(crate::stone::SULFUR_ORE_MIN_RESOURCES..=crate::stone::SULFUR_ORE_MAX_RESOURCES)
                },
                crate::stone::OreType::Memory => {
                    position_rng.gen_range(crate::stone::MEMORY_SHARD_MIN_RESOURCES..=crate::stone::MEMORY_SHARD_MAX_RESOURCES)
                },
            };
            s.respawn_at = Timestamp::UNIX_EPOCH; // 0 = not respawning
            s.last_hit_time = None;
        }
    );

    // Capture active static-entity counts so we can invalidate the static collision grid only when needed.
    let active_stone_count_before = ctx.db.stone().iter()
        .filter(|s| s.health > 0 && s.respawn_at == Timestamp::UNIX_EPOCH)
        .count();
    let active_tree_count_before = ctx.db.tree().iter()
        .filter(|t| t.health > 0 && t.respawn_at == Timestamp::UNIX_EPOCH)
        .count();

    // Get current season BEFORE respawn checks (used for trees and harvestable resources)
    let current_season = crate::world_state::get_current_season(ctx)
        .unwrap_or_else(|e| {
            log::warn!("Failed to get current season for respawn check: {}, defaulting to Spring", e);
            crate::world_state::Season::Spring
        });

    // Respawn Trees - SEASONAL: Trees do NOT respawn during winter
    // This creates wood scarcity in winter, incentivizing stockpiling and tree farming
    let is_winter = matches!(current_season, crate::world_state::Season::Winter);
    check_and_respawn_resource!(
        ctx,
        tree,
        crate::tree::Tree,
        "Tree",
        |t: &crate::tree::Tree| {
            // Trees can only respawn if:
            // 1. They are depleted (health == 0)
            // 2. It's NOT winter (trees are dormant in winter)
            // 3. They are NOT player-planted (olive, crab apple, etc. - never respawn)
            t.health == 0 && !is_winter && !t.is_player_planted
        },
        |t: &mut crate::tree::Tree| {
            let (health, min_wood, max_wood) = crate::tree::tree_type_stats(&t.tree_type);
            t.health = health;
            t.resource_remaining = ctx.rng().gen_range(min_wood..=max_wood);
            t.respawn_at = Timestamp::UNIX_EPOCH; // 0 = not respawning
            t.last_hit_time = None;
            // Position doesn't change during respawn, so chunk_index stays the same
        }
    );

    let active_stone_count_after = ctx.db.stone().iter()
        .filter(|s| s.health > 0 && s.respawn_at == Timestamp::UNIX_EPOCH)
        .count();
    let active_tree_count_after = ctx.db.tree().iter()
        .filter(|t| t.health > 0 && t.respawn_at == Timestamp::UNIX_EPOCH)
        .count();

    if active_stone_count_before != active_stone_count_after || active_tree_count_before != active_tree_count_after {
        crate::spatial_grid::invalidate_static_grid();
    }

    // Respawn Harvestable Resources (Unified System) with Seasonal Filtering and Foundation Check
    // Custom implementation to add foundation checking (resources shouldn't respawn on foundations)
    {
        use crate::harvestable_resource::harvestable_resource as HarvestableResourceTableTrait;
        use crate::building::{is_position_on_foundation, foundation_cell as FoundationCellTableTrait};
        use crate::player as PlayerTableTrait;
        
        let table_accessor = ctx.db.harvestable_resource();
        let now_ts = ctx.timestamp;
        let mut ids_to_respawn: Vec<u64> = Vec::new();
        
        // Get all online player positions for spatial gating
        let player_positions: Vec<(f32, f32)> = ctx.db.player().iter()
            .filter(|p| p.is_online && !p.is_dead)
            .map(|p| (p.position_x, p.position_y))
            .collect();
        
        const RESPAWN_CHECK_RADIUS_SQ: f32 = 2000.0 * 2000.0;
        
        if !player_positions.is_empty() {
            for entity in table_accessor.iter() {
                // Check if respawn_at is set and has passed
                if entity.respawn_at > Timestamp::UNIX_EPOCH && entity.respawn_at <= now_ts {
                    // SPATIAL FILTER: Only check entities within range of any player
                    let mut near_player = false;
                    for (px, py) in &player_positions {
                        let dx = entity.pos_x - px;
                        let dy = entity.pos_y - py;
                        let dist_sq = dx * dx + dy * dy;
                        if dist_sq <= RESPAWN_CHECK_RADIUS_SQ {
                            near_player = true;
                            break;
                        }
                    }
                    
                    if near_player {
                        // SEASONAL CHECK: Only allow respawn if plant can grow in current season
                        let season_ok = plants_database::can_grow_in_season(&entity.plant_type, &current_season);
                        
                        // FOUNDATION CHECK: Don't respawn on foundations
                        let not_on_foundation = !is_position_on_foundation(ctx, entity.pos_x, entity.pos_y);
                        
                        if season_ok && not_on_foundation {
                            ids_to_respawn.push(entity.id);
                        } else if season_ok && !not_on_foundation {
                            // Resource is on a foundation - delete it instead of respawning
                            log::info!("Deleting HarvestableResource {} at ({:.1}, {:.1}) - blocked by foundation", 
                                      entity.id, entity.pos_x, entity.pos_y);
                            // We'll delete it in the update phase
                        }
                    }
                }
            }
        }
        
        // Update phase
        for entity_id in ids_to_respawn {
            let table_accessor_update = ctx.db.harvestable_resource();
            if let Some(mut entity) = table_accessor_update.id().find(entity_id) {
                let original_pos_x = entity.pos_x;
                let original_pos_y = entity.pos_y;
                let mut current_pos_x = original_pos_x;
                let mut current_pos_y = original_pos_y;
                let mut position_clear = false;
                
                // Check initial position and attempt offsets
                for attempt in 0..=crate::respawn::MAX_RESPAWN_OFFSET_ATTEMPTS {
                    // Check both collision and foundation
                    let collision_clear = crate::utils::is_respawn_position_clear(ctx, current_pos_x, current_pos_y, crate::respawn::RESPAWN_CHECK_RADIUS_SQ);
                    let foundation_clear = !is_position_on_foundation(ctx, current_pos_x, current_pos_y);
                    
                    if collision_clear && foundation_clear {
                        position_clear = true;
                        if attempt > 0 {
                            log::info!(
                                "Respawning HarvestableResource {} at offset position ({:.1}, {:.1}) due to blockage at original ({:.1}, {:.1}). Attempt {}",
                                entity_id, current_pos_x, current_pos_y, original_pos_x, original_pos_y, attempt
                            );
                            entity.pos_x = current_pos_x;
                            entity.pos_y = current_pos_y;
                        } else {
                            log::info!("Respawning HarvestableResource {} at original position ({:.1}, {:.1}).", entity_id, original_pos_x, original_pos_y);
                        }
                        break;
                    }
                    
                    if attempt < crate::respawn::MAX_RESPAWN_OFFSET_ATTEMPTS {
                        let (dx, dy) = match attempt % 8 {
                            0 => (crate::respawn::RESPAWN_OFFSET_DISTANCE, 0.0),
                            1 => (0.0, crate::respawn::RESPAWN_OFFSET_DISTANCE),
                            2 => (-crate::respawn::RESPAWN_OFFSET_DISTANCE, 0.0),
                            3 => (0.0, -crate::respawn::RESPAWN_OFFSET_DISTANCE),
                            4 => (crate::respawn::RESPAWN_OFFSET_DISTANCE, crate::respawn::RESPAWN_OFFSET_DISTANCE),
                            5 => (-crate::respawn::RESPAWN_OFFSET_DISTANCE, crate::respawn::RESPAWN_OFFSET_DISTANCE),
                            6 => (-crate::respawn::RESPAWN_OFFSET_DISTANCE, -crate::respawn::RESPAWN_OFFSET_DISTANCE),
                            _ => (crate::respawn::RESPAWN_OFFSET_DISTANCE, -crate::respawn::RESPAWN_OFFSET_DISTANCE),
                        };
                        current_pos_x = original_pos_x + dx;
                        current_pos_y = original_pos_y + dy;
                    } else {
                        log::warn!(
                            "Could not find clear respawn position for HarvestableResource {} near ({:.1}, {:.1}) after {} attempts. Skipping respawn.",
                            entity_id, original_pos_x, original_pos_y, crate::respawn::MAX_RESPAWN_OFFSET_ATTEMPTS + 1
                        );
                    }
                }
                
                if position_clear {
                    entity.respawn_at = Timestamp::UNIX_EPOCH; // 0 = not respawning
                    ctx.db.harvestable_resource().id().update(entity);
                }
            } else {
                log::warn!("Could not find HarvestableResource {} to respawn.", entity_id);
            }
        }
    }

    // Respawn Grass - TEMPORARILY COMMENTED OUT
    // check_and_respawn_resource!(
    //     ctx,
    //     grass,
    //     crate::grass::Grass,
    //     "Grass",
    //     |g: &crate::grass::Grass| g.health == 0,
    //     |g: &mut crate::grass::Grass| {
    //         g.health = crate::grass::GRASS_INITIAL_HEALTH;
    //         g.respawn_at = None;
    //         g.last_hit_time = None;
    //         g.disturbed_at = None;
    //         g.disturbance_direction_x = 0.0;
    //         g.disturbance_direction_y = 0.0;
    //     }
    // );

    // NOTE: StormPile removed - storm debris now spawns as individual items

    // Respawn Living Coral
    check_and_respawn_resource!(
        ctx,
        living_coral,
        crate::coral::LivingCoral,
        "LivingCoral",
        |_c: &crate::coral::LivingCoral| true, // Check all coral with respawn_at set
        |c: &mut crate::coral::LivingCoral| {
            // Reset resource_remaining for next respawn
            c.resource_remaining = ctx.rng().gen_range(crate::coral::LIVING_CORAL_MIN_RESOURCES..=crate::coral::LIVING_CORAL_MAX_RESOURCES);
            c.respawn_at = Timestamp::UNIX_EPOCH; // 0 = not respawning
        }
    );

    // Note: Clouds are static for now, so no respawn logic needed in check_resource_respawns.
    // If they were to drift or change, a similar `check_and_respawn_resource!` or a dedicated
    // scheduled reducer would be needed here or in `cloud.rs`.

    // --- Wild Animal Population Maintenance ---
    // NOTE: Spawn zone maintenance (wolves at dens, wolverines at graveyard, terns at marshes)
    // runs on a separate 8-minute schedule for balance - see process_spawn_zone_maintenance
    if let Err(e) = crate::wild_animal_npc::respawn::maintain_wild_animal_population(ctx) {
        log::warn!("Wild animal population maintenance failed: {}", e);
    }

    Ok(())
}

// NOTE: detect_quarry_centers function removed - we now use TileType::Quarry for direct filtering!

/// Global multiplier for all plant densities (1.0 = normal, 2.0 = double density, 0.5 = half density)
/// ADJUST THIS VALUE TO GLOBALLY SCALE ALL PLANT SPAWNS WITHOUT EDITING INDIVIDUAL DENSITIES
/// 
/// Examples:
/// - 2.0 = Double all plant spawns (more resources, easier survival)
/// - 0.5 = Half all plant spawns (scarce resources, harder survival)
/// - 0.1 = Very sparse world (10% of normal plants, extreme scarcity)
/// - 3.0 = Very abundant world (300% of normal plants, easy resources)
/// 
/// BALANCED for gameplay: 0.40 provides meaningful scarcity while still
/// allowing resource gathering to feel rewarding. Players should find
/// plants regularly while exploring but not be drowning in them.
pub const GLOBAL_PLANT_DENSITY_MULTIPLIER: f32 = 0.10;

// =============================================================================
// REED MARSH TERN SPAWNING
// =============================================================================

/// Spawn terns near reed marsh zones
/// Reed marshes attract terns as scavenger birds for the player to hunt
fn spawn_terns_near_reed_marshes(
    ctx: &ReducerContext,
    rng: &mut StdRng,
    existing_animal_positions: &[(f32, f32)],
) -> u32 {
    use crate::wild_animal_npc::core::{WildAnimal, AnimalSpecies, AnimalState, MovementPattern};
    use crate::wild_animal_npc::wild_animal as WildAnimalTableTrait;
    
    let mut spawned_count = 0;
    let current_time = ctx.timestamp;
    
    // Collect marsh data to avoid borrow issues
    let marsh_data: Vec<(f32, f32, f32)> = ctx.db.reed_marsh()
        .iter()
        .map(|m| (m.world_x, m.world_y, m.radius_px))
        .collect();
    
    if marsh_data.is_empty() {
        return 0;
    }
    
    // Spawn 1-2 terns near each marsh (more marshes = more distributed terns)
    for (marsh_x, marsh_y, radius_px) in &marsh_data {
        let tern_count = rng.gen_range(1..=2);
        
        for _ in 0..tern_count {
            // Generate spawn position near the marsh
            let angle = rng.gen::<f32>() * std::f32::consts::PI * 2.0;
            let distance = rng.gen_range(50.0..*radius_px * 1.2); // Can spawn slightly outside marsh area too
            let spawn_x = marsh_x + angle.cos() * distance;
            let spawn_y = marsh_y + angle.sin() * distance;
            if crate::wild_animal_npc::core::is_position_in_alk_wildlife_zone(ctx, spawn_x, spawn_y) { continue; }
            
            // Check for collision with existing animals (simple distance check)
            let min_animal_dist_sq = 150.0 * 150.0;
            let too_close_to_animal = existing_animal_positions.iter()
                .any(|(ax, ay)| {
                    let dx = spawn_x - ax;
                    let dy = spawn_y - ay;
                    (dx * dx + dy * dy) < min_animal_dist_sq
                });
            
            if too_close_to_animal {
                continue;
            }
            
            // Calculate chunk index
            let chunk_idx = calculate_chunk_index(spawn_x, spawn_y);
            
            let tern = WildAnimal {
                id: 0, // auto_inc
                species: AnimalSpecies::Tern,
                pos_x: spawn_x,
                pos_y: spawn_y,
                direction_x: 1.0,
                direction_y: 0.0,
                facing_direction: "down".to_string(),
                state: AnimalState::Grounded, // Birds start grounded
                health: 80.0, // Tern max health
                spawn_x,
                spawn_y,
                target_player_id: None,
                last_attack_time: None,
                state_change_time: current_time,
                hide_until: None,
                investigation_x: None,
                investigation_y: None,
                patrol_phase: rng.gen::<f32>(),
                scent_ping_timer: 0,
                movement_pattern: MovementPattern::Wander,
                chunk_index: chunk_idx,
                created_at: current_time,
                last_hit_time: None,
                pack_id: None,
                is_pack_leader: false,
                pack_join_time: None,
                last_pack_check: None,
                fire_fear_overridden_by: None,
                tamed_by: None,
                tamed_at: None,
                heart_effect_until: None,
                crying_effect_until: None,
                last_food_check: None,
                held_item_name: None,
                held_item_quantity: None,
                flying_target_x: None,
                flying_target_y: None,
                is_flying: false, // Start grounded
                is_hostile_npc: false,
                target_structure_id: None,
                target_structure_type: None,
                stalk_angle: 0.0,
                stalk_distance: 0.0,
                despawn_at: None,
                shock_active_until: None,
                last_shock_time: None,
            };
            
            match ctx.db.wild_animal().try_insert(tern) {
                Ok(inserted) => {
                    spawned_count += 1;
                    log::debug!("🐦 Spawned Tern #{} near reed marsh at ({:.1}, {:.1})", 
                               inserted.id, spawn_x, spawn_y);
                }
                Err(e) => {
                    log::warn!("Failed to spawn tern near reed marsh: {}", e);
                }
            }
        }
    }
    
    spawned_count
}

// =============================================================================
// TIDE POOL CRAB AND TERN SPAWNING
// =============================================================================

/// Spawn crabs and terns near tide pool zones (coastal beach inlets)
/// Tide pools focus on crabs (2-3 per pool) with a few terns (1 per pool)
fn spawn_crabs_and_terns_near_tide_pools(
    ctx: &ReducerContext,
    rng: &mut StdRng,
    existing_animal_positions: &[(f32, f32)],
) -> (u32, u32) {
    use crate::wild_animal_npc::core::{WildAnimal, AnimalSpecies, AnimalState, MovementPattern};
    use crate::wild_animal_npc::wild_animal as WildAnimalTableTrait;
    
    let mut crabs_spawned = 0u32;
    let mut terns_spawned = 0u32;
    let current_time = ctx.timestamp;
    
    let pool_data: Vec<(f32, f32, f32)> = ctx.db.tide_pool()
        .iter()
        .map(|t| (t.world_x, t.world_y, t.radius_px))
        .collect();
    
    if pool_data.is_empty() {
        return (0, 0);
    }
    
    let min_animal_dist_sq = 120.0 * 120.0;
    
    for (pool_x, pool_y, radius_px) in &pool_data {
        // Spawn 2-3 crabs per tide pool (focus on crabs)
        let crab_count = rng.gen_range(2..=3);
        for _ in 0..crab_count {
            let angle = rng.gen::<f32>() * std::f32::consts::PI * 2.0;
            let distance = rng.gen_range(40.0..*radius_px * 0.9);
            let spawn_x = pool_x + angle.cos() * distance;
            let spawn_y = pool_y + angle.sin() * distance;
            if crate::wild_animal_npc::core::is_position_in_alk_wildlife_zone(ctx, spawn_x, spawn_y) { continue; }
            
            // Crabs spawn on beach OR water within tide pool (they can swim in the inlet)
            let on_beach = is_position_on_beach_tile(ctx, spawn_x, spawn_y);
            let on_water = is_position_on_water(ctx, spawn_x, spawn_y);
            if !on_beach && !on_water {
                continue;
            }
            
            let too_close = existing_animal_positions.iter()
                .any(|(ax, ay)| (spawn_x - ax).powi(2) + (spawn_y - ay).powi(2) < min_animal_dist_sq);
            if too_close {
                continue;
            }
            
            let chunk_idx = calculate_chunk_index(spawn_x, spawn_y);
            let crab = WildAnimal {
                id: 0,
                species: AnimalSpecies::BeachCrab,
                pos_x: spawn_x,
                pos_y: spawn_y,
                direction_x: 1.0,
                direction_y: 0.0,
                facing_direction: "down".to_string(),
                state: AnimalState::Grounded,
                health: 60.0, // BeachCrab max health
                spawn_x,
                spawn_y,
                target_player_id: None,
                last_attack_time: None,
                state_change_time: current_time,
                hide_until: None,
                investigation_x: None,
                investigation_y: None,
                patrol_phase: rng.gen::<f32>(),
                scent_ping_timer: 0,
                movement_pattern: MovementPattern::Wander,
                chunk_index: chunk_idx,
                created_at: current_time,
                last_hit_time: None,
                pack_id: None,
                is_pack_leader: false,
                pack_join_time: None,
                last_pack_check: None,
                fire_fear_overridden_by: None,
                tamed_by: None,
                tamed_at: None,
                heart_effect_until: None,
                crying_effect_until: None,
                last_food_check: None,
                held_item_name: None,
                held_item_quantity: None,
                flying_target_x: None,
                flying_target_y: None,
                is_flying: false,
                is_hostile_npc: false,
                target_structure_id: None,
                target_structure_type: None,
                stalk_angle: 0.0,
                stalk_distance: 0.0,
                despawn_at: None,
                shock_active_until: None,
                last_shock_time: None,
            };
            
            if ctx.db.wild_animal().try_insert(crab).is_ok() {
                crabs_spawned += 1;
            }
        }
        
        // Spawn 1 tern per tide pool (a few terns)
        let angle = rng.gen::<f32>() * std::f32::consts::PI * 2.0;
        let distance = rng.gen_range(50.0..*radius_px * 0.95);
        let spawn_x = pool_x + angle.cos() * distance;
        let spawn_y = pool_y + angle.sin() * distance;
        if crate::wild_animal_npc::core::is_position_in_alk_wildlife_zone(ctx, spawn_x, spawn_y) { continue; }
        
        // Terns spawn on beach OR water within tide pool (like crabs)
        let on_beach = is_position_on_beach_tile(ctx, spawn_x, spawn_y);
        let on_water = is_position_on_water(ctx, spawn_x, spawn_y);
        if !on_beach && !on_water {
            continue;
        }
        
        let too_close = existing_animal_positions.iter()
            .any(|(ax, ay)| (spawn_x - ax).powi(2) + (spawn_y - ay).powi(2) < min_animal_dist_sq);
        if too_close {
            continue;
        }
        
        let chunk_idx = calculate_chunk_index(spawn_x, spawn_y);
        let tern = WildAnimal {
            id: 0,
            species: AnimalSpecies::Tern,
            pos_x: spawn_x,
            pos_y: spawn_y,
            direction_x: 1.0,
            direction_y: 0.0,
            facing_direction: "down".to_string(),
            state: AnimalState::Grounded,
            health: 80.0, // Tern max health
            spawn_x,
            spawn_y,
            target_player_id: None,
            last_attack_time: None,
            state_change_time: current_time,
            hide_until: None,
            investigation_x: None,
            investigation_y: None,
            patrol_phase: rng.gen::<f32>(),
            scent_ping_timer: 0,
            movement_pattern: MovementPattern::Wander,
            chunk_index: chunk_idx,
            created_at: current_time,
            last_hit_time: None,
            pack_id: None,
            is_pack_leader: false,
            pack_join_time: None,
            last_pack_check: None,
            fire_fear_overridden_by: None,
            tamed_by: None,
            tamed_at: None,
            heart_effect_until: None,
            crying_effect_until: None,
            last_food_check: None,
            held_item_name: None,
            held_item_quantity: None,
            flying_target_x: None,
            flying_target_y: None,
            is_flying: false,
            is_hostile_npc: false,
            target_structure_id: None,
            target_structure_type: None,
            stalk_angle: 0.0,
            stalk_distance: 0.0,
            despawn_at: None,
            shock_active_until: None,
            last_shock_time: None,
        };
        
        if ctx.db.wild_animal().try_insert(tern).is_ok() {
            terns_spawned += 1;
        }
    }
    
    (crabs_spawned, terns_spawned)
}

// =============================================================================
// WHALE BONE GRAVEYARD WOLVERINE SPAWNING
// =============================================================================

/// Spawn wolverines near the whale bone graveyard
/// Wolverines are fearless predators attracted to the mysterious graveyard
fn spawn_wolverines_near_whale_bone_graveyard(
    ctx: &ReducerContext,
    rng: &mut StdRng,
    existing_animal_positions: &[(f32, f32)],
) -> u32 {
    use crate::wild_animal_npc::core::{WildAnimal, AnimalSpecies, AnimalState, MovementPattern};
    use crate::wild_animal_npc::wild_animal as WildAnimalTableTrait;
    
    let mut spawned_count = 0;
    let current_time = ctx.timestamp;
    
    // Get whale bone graveyard center position
    let graveyard_center = whale_bone_graveyard::get_whale_bone_graveyard_center(ctx);
    
    if graveyard_center.is_none() {
        log::debug!("No whale bone graveyard found, skipping wolverine spawning");
        return 0;
    }
    
    let (graveyard_x, graveyard_y) = graveyard_center.unwrap();
    
    // Spawn 2-4 wolverines near the graveyard
    let wolverine_count = rng.gen_range(2..=4);
    log::info!("🦡 Attempting to spawn {} wolverines near whale bone graveyard at ({:.0}, {:.0})", 
               wolverine_count, graveyard_x, graveyard_y);
    
    // Spawn radius around the graveyard (outside the NPC exclusion zone but still nearby)
    // The exclusion zone is 1200px, so we spawn just outside it for thematic effect
    let spawn_min_radius = 400.0;  // Minimum distance from center
    let spawn_max_radius = 800.0;  // Maximum distance from center
    
    for _ in 0..wolverine_count {
        // Generate spawn position around the graveyard
        let angle = rng.gen::<f32>() * std::f32::consts::PI * 2.0;
        let distance = rng.gen_range(spawn_min_radius..spawn_max_radius);
        let spawn_x = graveyard_x + angle.cos() * distance;
        let spawn_y = graveyard_y + angle.sin() * distance;
        if crate::wild_animal_npc::core::is_position_in_alk_wildlife_zone(ctx, spawn_x, spawn_y) { continue; }
        
        // Check for collision with existing animals (simple distance check)
        let min_animal_dist_sq = 200.0 * 200.0;
        let too_close_to_animal = existing_animal_positions.iter()
            .any(|(ax, ay)| {
                let dx = spawn_x - ax;
                let dy = spawn_y - ay;
                (dx * dx + dy * dy) < min_animal_dist_sq
            });
        
        if too_close_to_animal {
            continue;
        }
        
        // Calculate chunk index
        let chunk_idx = calculate_chunk_index(spawn_x, spawn_y);
        
        let wolverine = WildAnimal {
            id: 0, // auto_inc
            species: AnimalSpecies::Wolverine,
            pos_x: spawn_x,
            pos_y: spawn_y,
            direction_x: 1.0,
            direction_y: 0.0,
            facing_direction: "down".to_string(),
            state: AnimalState::Patrolling,
            health: 150.0, // Wolverine max health
            spawn_x,
            spawn_y,
            target_player_id: None,
            last_attack_time: None,
            state_change_time: current_time,
            hide_until: None,
            investigation_x: None,
            investigation_y: None,
            patrol_phase: rng.gen::<f32>(),
            scent_ping_timer: 0,
            movement_pattern: MovementPattern::Wander,
            chunk_index: chunk_idx,
            created_at: current_time,
            last_hit_time: None,
            pack_id: None,
            is_pack_leader: false,
            pack_join_time: None,
            last_pack_check: None,
            fire_fear_overridden_by: None,
            tamed_by: None,
            tamed_at: None,
            heart_effect_until: None,
            crying_effect_until: None,
            last_food_check: None,
            held_item_name: None,
            held_item_quantity: None,
            flying_target_x: None,
            flying_target_y: None,
            is_flying: false,
            is_hostile_npc: false,
            target_structure_id: None,
            target_structure_type: None,
            stalk_angle: 0.0,
            stalk_distance: 0.0,
            despawn_at: None,
            shock_active_until: None,
            last_shock_time: None,
        };
        
        match ctx.db.wild_animal().try_insert(wolverine) {
            Ok(inserted) => {
                spawned_count += 1;
                log::info!("🦡 Spawned Wolverine #{} near whale bone graveyard at ({:.1}, {:.1})", 
                           inserted.id, spawn_x, spawn_y);
            }
            Err(e) => {
                log::warn!("Failed to spawn wolverine near whale bone graveyard: {}", e);
            }
        }
    }
    
    spawned_count
}
