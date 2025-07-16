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
    wild_animal_npc::{AnimalSpecies, AnimalState, MovementPattern, WildAnimal},
    cloud::{Cloud, CloudUpdateSchedule, CloudShapeType, CloudType},
    barrel,
    plants_database,
    items::ItemDefinition,
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
use crate::sea_stack::sea_stack as SeaStackTableTrait;

// Import utils helpers and macro
use crate::utils::{calculate_tile_bounds, attempt_single_spawn};
use crate::check_and_respawn_resource;

use noise::{NoiseFn, Perlin, Fbm};
use rand::{Rng, SeedableRng};
use rand::rngs::StdRng;
use std::collections::HashSet;

// --- Sea Stack Constants ---
const SEA_STACK_DENSITY_PERCENT: f32 = 0.0012; // 0.12% of tiles - spawns on ocean water tiles
const MIN_SEA_STACK_DISTANCE_SQ: f32 = 360.0 * 360.0; // 360px = 7.5 tiles minimum between sea stacks (3x original)
const MIN_SEA_STACK_TREE_DISTANCE_SQ: f32 = 80.0 * 80.0; // 80px distance from trees (though they shouldn't overlap anyway)
const MIN_SEA_STACK_STONE_DISTANCE_SQ: f32 = 80.0 * 80.0; // 80px distance from stones
const SEA_STACK_SPAWN_NOISE_FREQUENCY: f64 = 0.008; // Noise frequency for clustering
const SEA_STACK_SPAWN_NOISE_THRESHOLD: f64 = 0.3; // Noise threshold for spawning

// --- Constants for Chunk Calculation ---
// Size of a chunk in tiles (e.g., 20x20 tiles per chunk)
pub const CHUNK_SIZE_TILES: u32 = 10;
// World width in chunks
pub const WORLD_WIDTH_CHUNKS: u32 = (WORLD_WIDTH_TILES + CHUNK_SIZE_TILES - 1) / CHUNK_SIZE_TILES;
// Size of a chunk in pixels
pub const CHUNK_SIZE_PX: f32 = CHUNK_SIZE_TILES as f32 * TILE_SIZE_PX as f32;

// --- Helper function to calculate chunk index ---
pub fn calculate_chunk_index(pos_x: f32, pos_y: f32) -> u32 {
    // Convert position to tile coordinates
    let tile_x = (pos_x / TILE_SIZE_PX as f32).floor() as u32;
    let tile_y = (pos_y / TILE_SIZE_PX as f32).floor() as u32;
    
    // Calculate chunk coordinates (which chunk the tile is in)
    let chunk_x = (tile_x / CHUNK_SIZE_TILES).min(WORLD_WIDTH_CHUNKS - 1);
    let chunk_y = (tile_y / CHUNK_SIZE_TILES).min(WORLD_WIDTH_CHUNKS - 1);
    
    // Calculate 1D chunk index (row-major ordering)
    chunk_y * WORLD_WIDTH_CHUNKS + chunk_x
}

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
    
    // Central compound size + buffer zone (same as in world_generation.rs)
    let compound_size = 8;
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
fn is_position_on_beach_tile(ctx: &ReducerContext, pos_x: f32, pos_y: f32) -> bool {
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

/// Checks if the given world position is on ocean water (not inland water or beaches)
/// Returns true if the position is on deep ocean water suitable for sea stacks
/// Excludes rivers, lakes, and beaches
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
        if tile.tile_type == TileType::Sea {
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

/// Checks if the given world position is on a water tile (Sea)
/// Returns true if the position is on water and resources should NOT spawn there
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
        return tile_type == crate::TileType::Sea;
    }
    
    // FALLBACK: Use original method if compressed data not available
    let world_tiles = ctx.db.world_tile();
    
    // Use the multi-column index to efficiently find the tile at (world_x, world_y)
    for tile in world_tiles.idx_world_position().filter((tile_x, tile_y)) {
        return tile.tile_type == TileType::Sea;
    }
    
    // If no tile found at these exact coordinates, default to non-water
    return false;
}

/// DISABLED: Smart water check for grass spawning - grass spawning disabled for performance
/// This function is no longer used as grass spawning has been completely disabled
#[allow(dead_code)]
fn is_grass_water_check_blocked(ctx: &ReducerContext, pos_x: f32, pos_y: f32, grass_type: &crate::grass::GrassAppearanceType) -> bool {
    let is_water_tile = is_position_on_water(ctx, pos_x, pos_y);
    
    if grass_type.is_water_foliage() {
        // Water foliage should spawn on INLAND water (rivers/lakes), NOT ocean water
        let is_inland_water = is_position_on_inland_water(ctx, pos_x, pos_y);
        !is_inland_water // Block if NOT on inland water
    } else {
        // Land foliage should spawn on land tiles, so block if on water
        is_water_tile
    }
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
        if tile.tile_type == TileType::Sea {
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
        is_water = tile.tile_type == TileType::Sea;
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

/// Detects if a position is in a lake-like area (larger contiguous water body) vs a river
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
                if tile.tile_type == TileType::Sea {
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
    
    // Block water tiles for all animals
    if tile_type == TileType::Sea {
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
                        
                        // Check if adjacent tile is water or beach
                        for adjacent_tile in world_tiles.idx_world_position().filter((check_x, check_y)) {
                            if matches!(adjacent_tile.tile_type, TileType::Sea | TileType::Beach) {
                                return true; // Coastal area suitable for walrus
                            }
                        }
                    }
                }
            }
            
            false // Not on beach or coastal area
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
            // Mushrooms: Must be on grass + near trees (within 150px)
            if !matches!(current_tile_type, Some(TileType::Grass)) {
                return false;
            }
            
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
                        if tile.tile_type == TileType::Sea {
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
                // Must be a water tile (Sea type) AND inland water (not ocean)
                if tile.tile_type == TileType::Sea && is_tile_inland_water(ctx, tile_x, tile_y) {
                    return true;
                }
                break;
            }
            false
        }
    }
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

    // Check if core environment is already seeded (exclude wild_animals since they can dynamically respawn)
    if trees.iter().count() > 0 || stones.iter().count() > 0 || harvestable_resources.iter().count() > 0 || clouds.iter().count() > 0 {
        log::info!(
            "Environment already seeded (Trees: {}, Stones: {}, Harvestable Resources: {}, Clouds: {}, Sea Stacks: {}, Wild Animals: {}). Grass spawning disabled. Skipping.",
            trees.iter().count(), stones.iter().count(), harvestable_resources.iter().count(), clouds.iter().count(), sea_stacks.iter().count(), wild_animals.iter().count()
        );
        return Ok(());
    }

    log::info!("Seeding environment (trees, stones, unified harvestable resources, clouds) - grass disabled for performance..." );

    let fbm = Fbm::<Perlin>::new(ctx.rng().gen());
    let mut rng = StdRng::from_rng(ctx.rng()).map_err(|e| format!("Failed to seed RNG: {}", e))?;

    let total_tiles = crate::WORLD_WIDTH_TILES * crate::WORLD_HEIGHT_TILES;

    // Calculate targets and limits
    let target_tree_count = (total_tiles as f32 * crate::tree::TREE_DENSITY_PERCENT) as u32;
    let max_tree_attempts = target_tree_count * crate::tree::MAX_TREE_SEEDING_ATTEMPTS_FACTOR;
    let target_stone_count = (total_tiles as f32 * crate::stone::STONE_DENSITY_PERCENT) as u32;
    let max_stone_attempts = target_stone_count * crate::tree::MAX_TREE_SEEDING_ATTEMPTS_FACTOR;
    let target_sea_stack_count = (total_tiles as f32 * SEA_STACK_DENSITY_PERCENT) as u32;
    let max_sea_stack_attempts = target_sea_stack_count * crate::tree::MAX_TREE_SEEDING_ATTEMPTS_FACTOR; 
    
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

    // Wild animal seeding parameters - COMPLETELY DISABLED for performance testing
    const WILD_ANIMAL_DENSITY_PERCENT: f32 = 0.0; // DISABLED - no animals will spawn
    const MAX_WILD_ANIMAL_SEEDING_ATTEMPTS_FACTOR: u32 = 0;
    let target_wild_animal_count = (total_tiles as f32 * WILD_ANIMAL_DENSITY_PERCENT) as u32;
    let max_wild_animal_attempts = target_wild_animal_count * MAX_WILD_ANIMAL_SEEDING_ATTEMPTS_FACTOR;

    // DISABLED: Grass seeding parameters for performance optimization
    // let target_grass_count = (total_tiles as f32 * crate::grass::GRASS_DENSITY_PERCENT) as u32;
    // let max_grass_attempts = target_grass_count * crate::grass::MAX_GRASS_SEEDING_ATTEMPTS_FACTOR;

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
    
    // Log harvestable resource targets
    for (plant_type, target_count) in &plant_targets {
        let max_attempts = plant_attempts.get(plant_type).unwrap_or(&0);
        log::info!("Target {:?}: {}, Max Attempts: {}", plant_type, target_count, max_attempts);
    }
    
    log::info!("Target Clouds: {}, Max Attempts: {}", target_cloud_count, max_cloud_attempts);
    log::info!("Target Wild Animals: {}, Max Attempts: {}", target_wild_animal_count, max_wild_animal_attempts);
    // DISABLED: Grass spawning log - grass spawning disabled for performance optimization
    // Calculate spawn bounds using helper
    let (min_tile_x, max_tile_x, min_tile_y, max_tile_y) = 
        calculate_tile_bounds(WORLD_WIDTH_TILES, WORLD_HEIGHT_TILES, crate::tree::TREE_SPAWN_WORLD_MARGIN_TILES);

    // Initialize tracking collections
    let mut occupied_tiles = HashSet::<(u32, u32)>::new();
    let mut spawned_tree_positions = Vec::<(f32, f32)>::new();
    let mut spawned_stone_positions = Vec::<(f32, f32)>::new();
    let mut spawned_sea_stack_positions = Vec::<(f32, f32)>::new();
    let mut spawned_harvestable_positions = Vec::<(f32, f32)>::new(); // Unified for all plants
    let mut spawned_cloud_positions = Vec::<(f32, f32)>::new();
    let mut spawned_wild_animal_positions = Vec::<(f32, f32)>::new();
    // DISABLED: let mut spawned_grass_positions = Vec::<(f32, f32)>::new(); // Grass spawning disabled

    let mut spawned_tree_count = 0;
    let mut tree_attempts = 0;
    let mut spawned_stone_count = 0;
    let mut stone_attempts = 0;
    let mut spawned_sea_stack_count = 0;
    let mut sea_stack_attempts = 0;
    
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
    // DISABLED: let mut spawned_grass_count = 0; // Grass spawning disabled
    // DISABLED: let mut grass_attempts = 0; // Grass spawning disabled

    // --- Seed Trees --- Use helper function --- 
    log::info!("Seeding Trees...");
    while spawned_tree_count < target_tree_count && tree_attempts < max_tree_attempts {
        tree_attempts += 1;

        // Determine tree type roll *before* calling attempt_single_spawn
        let tree_type_roll_for_this_attempt: f64 = rng.gen_range(0.0..1.0);
        
        // Generate random resource amount *before* calling attempt_single_spawn
        let tree_resource_amount = rng.gen_range(crate::tree::TREE_MIN_RESOURCES..=crate::tree::TREE_MAX_RESOURCES);

        match attempt_single_spawn(
            &mut rng,
            &mut occupied_tiles,
            &mut spawned_tree_positions,
            &[],
            &spawned_stone_positions,
            min_tile_x, max_tile_x, min_tile_y, max_tile_y,
            &fbm,
            crate::tree::TREE_SPAWN_NOISE_FREQUENCY,
            crate::tree::TREE_SPAWN_NOISE_THRESHOLD,
            crate::tree::MIN_TREE_DISTANCE_SQ,
            0.0,
            0.0,
            |pos_x, pos_y, (tree_type_roll, resource_amount): (f64, u32)| { // Closure now accepts both values
                // Calculate chunk index for the tree
                let chunk_idx = calculate_chunk_index(pos_x, pos_y);
                
                // Check if position is on a beach tile first
                let tree_type = if is_position_on_beach_tile(ctx, pos_x, pos_y) {
                    // If on beach tile, use StonePine
                    crate::tree::TreeType::StonePine
                } else {
                    // Otherwise, determine tree type with weighted probability using the passed-in roll
                    if tree_type_roll < 0.6 { // 60% chance for DownyOak
                        crate::tree::TreeType::DownyOak
                    } else if tree_type_roll < 0.8 { // 20% chance for AleppoPine
                        crate::tree::TreeType::AleppoPine
                    } else { // 20% chance for MannaAsh
                        crate::tree::TreeType::MannaAsh
                    }
                };
                
                crate::tree::Tree {
                    id: 0,
                    pos_x,
                    pos_y,
                    health: crate::tree::TREE_INITIAL_HEALTH,
                    resource_remaining: resource_amount, // Use the passed-in resource amount
                    tree_type, // Assign the chosen type
                    chunk_index: chunk_idx, // Set the chunk index
                    last_hit_time: None,
                    respawn_at: None,
                }
            },
            (tree_type_roll_for_this_attempt, tree_resource_amount), // Pass both values as extra_args
            |pos_x, pos_y| is_position_on_water(ctx, pos_x, pos_y) || is_position_in_central_compound(pos_x, pos_y), // Block water and central compound for trees
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

    // --- Seed Stones --- Use helper function ---
    log::info!("Seeding Stones...");
    while spawned_stone_count < target_stone_count && stone_attempts < max_stone_attempts {
        stone_attempts += 1;
        
        // Generate random resource amount *before* calling attempt_single_spawn
        let stone_resource_amount = rng.gen_range(crate::stone::STONE_MIN_RESOURCES..=crate::stone::STONE_MAX_RESOURCES);
        
         match attempt_single_spawn(
            &mut rng,
            &mut occupied_tiles,
            &mut spawned_stone_positions,
            &spawned_tree_positions,
            &[],
            min_tile_x, max_tile_x, min_tile_y, max_tile_y,
            &fbm,
            crate::tree::TREE_SPAWN_NOISE_FREQUENCY,
            crate::tree::TREE_SPAWN_NOISE_THRESHOLD,
            crate::stone::MIN_STONE_DISTANCE_SQ,
            crate::stone::MIN_STONE_TREE_DISTANCE_SQ,
            0.0,
            |pos_x, pos_y, resource_amount: u32| {
                // Calculate chunk index for the stone
                let chunk_idx = calculate_chunk_index(pos_x, pos_y);
                
                crate::stone::Stone {
                    id: 0,
                    pos_x,
                    pos_y,
                    health: crate::stone::STONE_INITIAL_HEALTH,
                    resource_remaining: resource_amount, // Use the passed-in resource amount
                    chunk_index: chunk_idx, // Set the chunk index
                    last_hit_time: None,
                    respawn_at: None,
                }
            },
            stone_resource_amount, // Pass the resource amount as extra_args
            |pos_x, pos_y| is_position_on_water(ctx, pos_x, pos_y) || is_position_in_central_compound(pos_x, pos_y), // Block water and central compound for stones
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
            |pos_x, pos_y| !is_position_on_ocean_water(ctx, pos_x, pos_y) || is_position_in_central_compound(pos_x, pos_y), // Only spawn on ocean water, not inland water
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
                    // Special case for reeds: allow them to spawn in water (they need inland water)
                    let config = plants_database::PLANT_CONFIGS.get(plant_type).unwrap();
                    let allow_water_spawn = matches!(config.spawn_condition, plants_database::SpawnCondition::InlandWater);
                    
                    let water_blocked = if allow_water_spawn {
                        // For reeds: only block if it's NOT inland water (i.e., block ocean water and land)
                        !is_position_on_inland_water(ctx, pos_x, pos_y)
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

    // --- DISABLED: Seed Wild Animals ---
    log::info!("Wild Animal seeding DISABLED for performance testing...");
    
    // Define species distribution (weighted probabilities)
    let species_weights = [
        (AnimalSpecies::CinderFox, 35),      // 35% - Most common
        (AnimalSpecies::TundraWolf, 25),     // 25% - Moderately common
        (AnimalSpecies::CableViper, 20),     // 20% - Uncommon
        (AnimalSpecies::ArcticWalrus, 20),   // 20% - More common (beaches only)
    ];
    let total_weight: u32 = species_weights.iter().map(|(_, weight)| weight).sum();
    
    // NEW: Chunk-based distribution system to prevent clustering (not to fill every chunk)
    let total_chunks = WORLD_WIDTH_CHUNKS * WORLD_WIDTH_CHUNKS;
    let max_animals_per_chunk = 1; // Hard limit: maximum 1 animal per chunk (reduced for performance)
    
    log::info!("Using chunk-based distribution: {} total chunks, max {} animal per chunk (target total: {})", 
               total_chunks, max_animals_per_chunk, target_wild_animal_count);
    
    // Track animals spawned per chunk (used to prevent clustering, not to force filling)
    let mut animals_per_chunk_map: std::collections::HashMap<u32, u32> = std::collections::HashMap::new();
    
    // DISABLED: Wild animal spawning loop - will never execute since target_wild_animal_count is 0
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
        
        // CHANGED: Use simpler random positioning instead of noise-based clustering
        let tile_x = rng.gen_range(min_tile_x..max_tile_x);
        let tile_y = rng.gen_range(min_tile_y..max_tile_y);
        let pos_x = (tile_x as f32 + 0.5) * TILE_SIZE_PX as f32;
        let pos_y = (tile_y as f32 + 0.5) * TILE_SIZE_PX as f32;
        
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
        
        // Block spawning on water, in central compound, or unsuitable terrain for the species
        if is_position_on_water(ctx, pos_x, pos_y) || 
           is_position_in_central_compound(pos_x, pos_y) ||
           !is_wild_animal_location_suitable(ctx, pos_x, pos_y, chosen_species, &spawned_tree_positions) {
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
        
        // WALRUS GROUP SPAWNING: Spawn multiple walruses together
        let walrus_group_size = if chosen_species == AnimalSpecies::ArcticWalrus {
            rng.gen_range(3..=6) // Spawn 3-6 walruses per group
        } else {
            1 // All other animals spawn alone
        };
        
        let mut walrus_positions = Vec::new();
        walrus_positions.push((pos_x, pos_y)); // Include the main spawn position
        
        // If spawning multiple walruses, generate additional positions nearby
        if walrus_group_size > 1 {
            for _ in 1..walrus_group_size {
                let mut attempts = 0;
                let max_attempts = 20;
                
                while attempts < max_attempts {
                    attempts += 1;
                    
                    // Generate position within 30-60 pixels of the main spawn point
                    let angle = rng.gen::<f32>() * 2.0 * std::f32::consts::PI;
                    let distance = rng.gen_range(30.0..60.0);
                    let group_pos_x = pos_x + (angle.cos() * distance);
                    let group_pos_y = pos_y + (angle.sin() * distance);
                    
                    // Check boundaries
                    if group_pos_x < PLAYER_RADIUS || group_pos_x > WORLD_WIDTH_PX - PLAYER_RADIUS ||
                       group_pos_y < PLAYER_RADIUS || group_pos_y > WORLD_HEIGHT_PX - PLAYER_RADIUS {
                        continue;
                    }
                    
                    // Check if suitable for walrus spawning
                    if is_position_on_water(ctx, group_pos_x, group_pos_y) || 
                       is_position_in_central_compound(group_pos_x, group_pos_y) ||
                       !is_wild_animal_location_suitable(ctx, group_pos_x, group_pos_y, chosen_species, &spawned_tree_positions) {
                        continue;
                    }
                    
                    // Check distance from other walruses in this group (minimum 25px apart)
                    let mut too_close_to_group_member = false;
                    for &(other_x, other_y) in &walrus_positions {
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
                    walrus_positions.push((group_pos_x, group_pos_y));
                    break;
                }
            }
        }
        
        log::info!("Spawning {} {:?} at position ({:.1}, {:.1})", 
                  walrus_positions.len(), chosen_species, pos_x, pos_y);
        
        // Spawn all animals in the group
        let mut group_spawn_success = true;
        for (i, &(spawn_x, spawn_y)) in walrus_positions.iter().enumerate() {
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
                
                // Initialize pack fields - animals start solo
                pack_id: None,
                is_pack_leader: false,
                pack_join_time: None,
                last_pack_check: None,
                
                // Fire fear override tracking
                fire_fear_overridden_by: None,
                
                // Taming system fields
                tamed_by: None,
                tamed_at: None,
                heart_effect_until: None,
                crying_effect_until: None,
                last_food_check: None,
            };

            match ctx.db.wild_animal().try_insert(new_animal) {
                Ok(inserted_animal) => {
                    spawned_wild_animal_positions.push((spawn_x, spawn_y));
                    spawned_wild_animal_count += 1;
                    
                    log::info!("Spawned {:?} #{} at ({:.1}, {:.1}) [group member {}/{}]", 
                              chosen_species, inserted_animal.id, spawn_x, spawn_y, i + 1, walrus_positions.len());
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

    // --- DISABLED: Grass Seeding for Performance Optimization ---
    // Grass spawning has been completely disabled to prevent creation of thousands
    // of grass entities that could cause server performance issues and rubber-banding.
    // The client will handle grass rendering procedurally without server entities.
    log::info!("Grass seeding DISABLED for performance optimization - no grass entities will be spawned.");
    let spawned_grass_count = 0; // Set to 0 since we're not spawning any grass
    // --- End Disabled Grass Seeding ---

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
        match ctx.db.cloud_update_schedule().try_insert(CloudUpdateSchedule {
            schedule_id: 0, // auto_inc
            scheduled_at: spacetimedb::TimeDuration::from_micros((update_interval_seconds * 1_000_000.0) as i64).into(),
            delta_time_seconds: update_interval_seconds,
        }) {
            Ok(_) => log::info!("Cloud update successfully scheduled every {} seconds.", update_interval_seconds),
            Err(e) => log::error!("Failed to schedule cloud update: {}", e),
        }

        // --- Initialize Cloud Intensity System --- (NEW)
        log::info!("Initializing cloud intensity system.");
        if let Err(e) = crate::cloud::init_cloud_intensity_system(ctx) {
            log::error!("Failed to initialize cloud intensity system: {}", e);
        }
        // --- End Initialize Cloud Intensity System ---
    }
    // --- End Schedule initial cloud update ---


    // --- Seed Barrels on Dirt Roads ---
    log::info!("Seeding Barrels on dirt roads...");
    
    // Collect all dirt road tiles from the world
    let world_tiles = ctx.db.world_tile();
    let dirt_road_tiles: Vec<(i32, i32)> = world_tiles.iter()
        .filter(|tile| tile.tile_type == TileType::DirtRoad)
        .map(|tile| (tile.world_x, tile.world_y))
        .collect();
    
    // Calculate scaling parameters based on map size
    // CONSERVATIVE: Match original balance of 6-12 clusters for typical maps
    // Original system: ~1 cluster per 25 road tiles, capped at 12 clusters max
    let current_map_tiles = WORLD_WIDTH_TILES * WORLD_HEIGHT_TILES;
    let barrel_density_per_map_tile = 0.00008; // REDUCED from 0.00040 to 0.00008 (0.008% vs 0.04%)
    let target_clusters_from_map_size = (current_map_tiles as f32 * barrel_density_per_map_tile) as u32;
    let target_clusters_from_roads = (dirt_road_tiles.len() / 25) as u32; // 1 cluster per 25 road tiles
    
    // Use the higher of the two calculations, but add a reasonable cap for sanity
    let base_target = std::cmp::max(
        target_clusters_from_map_size, 
        std::cmp::max(3, target_clusters_from_roads) // Minimum 3 clusters even for tiny maps
    );
    
    // SANITY CAP: Prevent excessive barrel counts on massive maps
    let recommended_cluster_count = std::cmp::min(base_target, 24); // Cap at 24 clusters (48-96 barrels max)
    
    log::info!("Found {} dirt road tiles for barrel spawning", dirt_road_tiles.len());
    log::info!("Map size: {}x{} tiles ({}), Road-based target: {}, Map-based target: {}, Final target: {}", 
               WORLD_WIDTH_TILES, WORLD_HEIGHT_TILES, current_map_tiles, 
               target_clusters_from_roads, target_clusters_from_map_size, recommended_cluster_count);
    
    // Spawn barrel clusters on dirt roads with scaling parameters
    match barrel::spawn_barrel_clusters_scaled(ctx, dirt_road_tiles, recommended_cluster_count) {
        Ok(_) => {
            let spawned_barrel_count = ctx.db.barrel().iter().count();
            log::info!("Successfully spawned {} barrels on dirt roads", spawned_barrel_count);
        }
        Err(e) => {
            log::error!("Failed to spawn barrels: {}", e);
        }
    }

    // Generate summary for harvestable resources
    let mut harvestable_summary = String::new();
    for (plant_type, count) in &plant_spawned_counts {
        if !harvestable_summary.is_empty() {
            harvestable_summary.push_str(", ");
        }
        harvestable_summary.push_str(&format!("{:?}: {}", plant_type, count));
    }
    
    log::info!(
        "Environment seeding complete! Summary: Trees: {}, Stones: {}, Sea Stacks: {}, Harvestable Resources: [{}], Clouds: {}, Wild Animals: {}, Barrels: {}",
        spawned_tree_count, spawned_stone_count, spawned_sea_stack_count, harvestable_summary,
        spawned_cloud_count, spawned_wild_animal_count, ctx.db.barrel().iter().count()
    );
    Ok(())
}

// --- Resource Respawn Reducer --- Refactored using Macro ---

#[spacetimedb::reducer]
pub fn check_resource_respawns(ctx: &ReducerContext) -> Result<(), String> {
    
    // Respawn Stones
    check_and_respawn_resource!(
        ctx,
        stone, // Table symbol
        crate::stone::Stone, // Entity type
        "Stone", // Name for logging
        |s: &crate::stone::Stone| s.health == 0, // Filter: only check stones with 0 health
        |s: &mut crate::stone::Stone| { // Update logic
            s.health = crate::stone::STONE_INITIAL_HEALTH;
            // Generate new random resource amount for respawned stone
            s.resource_remaining = ctx.rng().gen_range(crate::stone::STONE_MIN_RESOURCES..=crate::stone::STONE_MAX_RESOURCES);
            s.respawn_at = None;
            s.last_hit_time = None;
        }
    );

    // Respawn Trees
    check_and_respawn_resource!(
        ctx,
        tree,
        crate::tree::Tree,
        "Tree",
        |t: &crate::tree::Tree| t.health == 0,
        |t: &mut crate::tree::Tree| {
            t.health = crate::tree::TREE_INITIAL_HEALTH;
            // Generate new random resource amount for respawned tree
            t.resource_remaining = ctx.rng().gen_range(crate::tree::TREE_MIN_RESOURCES..=crate::tree::TREE_MAX_RESOURCES);
            t.respawn_at = None;
            t.last_hit_time = None;
            // Position doesn't change during respawn, so chunk_index stays the same
        }
    );

    // Respawn Harvestable Resources (Unified System) with Seasonal Filtering
    let current_season = crate::world_state::get_current_season(ctx)
        .unwrap_or_else(|e| {
            log::warn!("Failed to get current season for respawn check: {}, defaulting to Spring", e);
            crate::world_state::Season::Spring
        });
    
    check_and_respawn_resource!(
        ctx,
        harvestable_resource,
        crate::harvestable_resource::HarvestableResource,
        "HarvestableResource",
        |h: &crate::harvestable_resource::HarvestableResource| {
            // SEASONAL CHECK: Only allow respawn if plant can grow in current season
            plants_database::can_grow_in_season(&h.plant_type, &current_season)
        },
        |h: &mut crate::harvestable_resource::HarvestableResource| {
            h.respawn_at = None;
        }
    );

    // DISABLED: Grass respawn logic - grass spawning disabled for performance optimization
    // No grass entities exist, so no respawn logic needed

    // Note: Clouds are static for now, so no respawn logic needed in check_resource_respawns.
    // If they were to drift or change, a similar `check_and_respawn_resource!` or a dedicated
    // scheduled reducer would be needed here or in `cloud.rs`.

    // --- DISABLED: Wild Animal Population Maintenance ---
    // Completely disabled for performance testing - no animals will respawn
    // crate::wild_animal_npc::respawn::maintain_wild_animal_population(ctx)?;

    Ok(())
}

/// Global multiplier for all plant densities (1.0 = normal, 2.0 = double density, 0.5 = half density)
/// ADJUST THIS VALUE TO GLOBALLY SCALE ALL PLANT SPAWNS WITHOUT EDITING INDIVIDUAL DENSITIES
/// 
/// Examples:
/// - 2.0 = Double all plant spawns (more resources, easier survival)
/// - 0.5 = Half all plant spawns (scarce resources, harder survival)
/// - 0.1 = Very sparse world (10% of normal plants, extreme scarcity)
/// - 3.0 = Very abundant world (300% of normal plants, easy resources)
pub const GLOBAL_PLANT_DENSITY_MULTIPLIER: f32 = 1.0;