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
use spacetimedb::{ReducerContext, Table, Timestamp};
use crate::{WORLD_WIDTH_PX, WORLD_HEIGHT_PX, TILE_SIZE_PX, WORLD_WIDTH_TILES, WORLD_HEIGHT_TILES};

// Import resource modules
use crate::tree;
use crate::stone;
use crate::mushroom;
use crate::corn;
use crate::potato;
use crate::hemp;
use crate::pumpkin;
use crate::reed;
use crate::cloud;
use crate::grass;

// Import table traits needed for ctx.db access
use crate::tree::tree as TreeTableTrait;
use crate::stone::stone as StoneTableTrait;
use crate::mushroom::mushroom as MushroomTableTrait;
use crate::corn::corn as CornTableTrait;
use crate::potato::potato as PotatoTableTrait;
use crate::pumpkin::pumpkin as PumpkinTableTrait;
use crate::hemp::hemp as HempTableTrait;
use crate::reed::reed as ReedTableTrait;
use crate::items::ItemDefinition;
use crate::cloud::{Cloud, CloudShapeType, CloudUpdateSchedule};
use crate::utils::*;
use crate::cloud::cloud as CloudTableTrait;
use crate::cloud::cloud_update_schedule as CloudUpdateScheduleTableTrait;
use crate::grass::grass as GrassTableTrait;
use crate::world_tile as WorldTileTableTrait; // Added for tile checking
use crate::{TileType, WorldTile}; // Added for tile type checking

// Import utils helpers and macro
use crate::utils::{calculate_tile_bounds, attempt_single_spawn};
use crate::check_and_respawn_resource; // Import the macro

use noise::{NoiseFn, Perlin, Fbm};
use rand::{Rng, SeedableRng};
use rand::rngs::StdRng;
use std::collections::HashSet;
use log;

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

/// Checks if position is in the central compound area where trees and stones should not spawn
fn is_position_in_central_compound(pos_x: f32, pos_y: f32) -> bool {
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

/// Checks if the given world position is on a water tile (Sea)
/// Returns true if the position is on water and resources should NOT spawn there
/// NEW: Uses compressed chunk data for much better performance
fn is_position_on_water(ctx: &ReducerContext, pos_x: f32, pos_y: f32) -> bool {
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

/// NEW: Smart water check for grass spawning that handles both land and water foliage
/// Returns true if spawning should be blocked (wrong tile type for the given grass type)
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

// --- NEW: Helper functions for location-specific spawning ---

/// Checks if position is suitable for mushroom spawning (forested grass tiles)
/// Mushrooms prefer areas with grass tiles that are near trees (forest-like areas)
fn is_mushroom_location_suitable(ctx: &ReducerContext, pos_x: f32, pos_y: f32, tree_positions: &[(f32, f32)]) -> bool {
    // Convert pixel position to tile coordinates
    let tile_x = (pos_x / TILE_SIZE_PX as f32).floor() as i32;
    let tile_y = (pos_y / TILE_SIZE_PX as f32).floor() as i32;
    
    // Check if position is on grass tile
    let world_tiles = ctx.db.world_tile();
    let mut is_grass = false;
    for tile in world_tiles.idx_world_position().filter((tile_x, tile_y)) {
        is_grass = tile.tile_type == TileType::Grass;
        break;
    }
    
    if !is_grass {
        return false;
    }
    
    // Check if near trees (within forested areas)
    let forest_check_distance_sq = 150.0 * 150.0; // Within 150 pixels of trees for forest feel
    for &(tree_x, tree_y) in tree_positions {
        let dx = pos_x - tree_x;
        let dy = pos_y - tree_y;
        if dx * dx + dy * dy <= forest_check_distance_sq {
            return true; // Near trees, good for mushrooms
        }
    }
    
    false // Not in forested area
}

/// Checks if position is suitable for hemp spawning (open plains - grass, dirt)
/// Hemp prefers open areas away from trees and stones
fn is_hemp_location_suitable(ctx: &ReducerContext, pos_x: f32, pos_y: f32, tree_positions: &[(f32, f32)], stone_positions: &[(f32, f32)]) -> bool {
    // Convert pixel position to tile coordinates
    let tile_x = (pos_x / TILE_SIZE_PX as f32).floor() as i32;
    let tile_y = (pos_y / TILE_SIZE_PX as f32).floor() as i32;
    
    // Check if position is on grass or dirt tile
    let world_tiles = ctx.db.world_tile();
    let mut suitable_tile = false;
    for tile in world_tiles.idx_world_position().filter((tile_x, tile_y)) {
        suitable_tile = matches!(tile.tile_type, TileType::Grass | TileType::Dirt);
        break;
    }
    
    if !suitable_tile {
        return false;
    }
    
    // Check if NOT too close to trees (open plains requirement)
    let min_tree_distance_sq = 100.0 * 100.0; // Stay 100 pixels away from trees
    for &(tree_x, tree_y) in tree_positions {
        let dx = pos_x - tree_x;
        let dy = pos_y - tree_y;
        if dx * dx + dy * dy < min_tree_distance_sq {
            return false; // Too close to trees, not open plains
        }
    }
    
    // Check if NOT too close to stones
    let min_stone_distance_sq = 80.0 * 80.0; // Stay 80 pixels away from stones
    for &(stone_x, stone_y) in stone_positions {
        let dx = pos_x - stone_x;
        let dy = pos_y - stone_y;
        if dx * dx + dy * dy < min_stone_distance_sq {
            return false; // Too close to stones, not open plains
        }
    }
    
    true
}

/// Checks if position is suitable for corn spawning (near water/sand tiles)
/// Corn prefers areas close to water sources or sandy areas
fn is_corn_location_suitable(ctx: &ReducerContext, pos_x: f32, pos_y: f32) -> bool {
    // Convert pixel position to tile coordinates
    let tile_x = (pos_x / TILE_SIZE_PX as f32).floor() as i32;
    let tile_y = (pos_y / TILE_SIZE_PX as f32).floor() as i32;
    
    // Check surrounding area for water or sand within reasonable distance
    let search_radius = 3; // Check 3 tiles in each direction
    let world_tiles = ctx.db.world_tile();
    
    for dy in -search_radius..=search_radius {
        for dx in -search_radius..=search_radius {
            let check_x = tile_x + dx;
            let check_y = tile_y + dy;
            
            // Check if this nearby tile is water, beach, or sand
            for tile in world_tiles.idx_world_position().filter((check_x, check_y)) {
                if matches!(tile.tile_type, TileType::Sea | TileType::Beach | TileType::Sand) {
                    return true; // Found water/sand nearby
                }
            }
        }
    }
    
    false // No water/sand nearby
}

/// Checks if position is suitable for potato spawning (dirt roads, clearings)
/// Potatoes prefer dirt roads and open cleared areas
fn is_potato_location_suitable(ctx: &ReducerContext, pos_x: f32, pos_y: f32, tree_positions: &[(f32, f32)]) -> bool {
    // Convert pixel position to tile coordinates
    let tile_x = (pos_x / TILE_SIZE_PX as f32).floor() as i32;
    let tile_y = (pos_y / TILE_SIZE_PX as f32).floor() as i32;
    
    let world_tiles = ctx.db.world_tile();
    
    // First check: Is this on a dirt road? (preferred)
    for tile in world_tiles.idx_world_position().filter((tile_x, tile_y)) {
        if tile.tile_type == TileType::DirtRoad {
            return true; // Perfect for potatoes
        }
    }
    
    // Second check: Is this in a clearing? (open dirt or grass areas away from trees)
    for tile in world_tiles.idx_world_position().filter((tile_x, tile_y)) {
        if matches!(tile.tile_type, TileType::Dirt | TileType::Grass) {
            // Check if it's a clearing (away from trees)
            let clearing_distance_sq = 80.0 * 80.0; // 80 pixels away from trees for clearing
            let mut is_clearing = true;
            
            for &(tree_x, tree_y) in tree_positions {
                let dx = pos_x - tree_x;
                let dy = pos_y - tree_y;
                if dx * dx + dy * dy < clearing_distance_sq {
                    is_clearing = false;
                    break;
                }
            }
            
            return is_clearing;
        }
    }
    
    false
}

/// Checks if position is suitable for pumpkin spawning (riversides, ruins/coastal)
/// Pumpkins prefer coastal areas, beach regions, and areas near water
fn is_pumpkin_location_suitable(ctx: &ReducerContext, pos_x: f32, pos_y: f32) -> bool {
    // Convert pixel position to tile coordinates
    let tile_x = (pos_x / TILE_SIZE_PX as f32).floor() as i32;
    let tile_y = (pos_y / TILE_SIZE_PX as f32).floor() as i32;
    
    let world_tiles = ctx.db.world_tile();
    
    // Check if directly on beach/sand (coastal areas)
    for tile in world_tiles.idx_world_position().filter((tile_x, tile_y)) {
        if matches!(tile.tile_type, TileType::Beach | TileType::Sand) {
            return true; // Perfect coastal location
        }
    }
    
    // Check if very close to water (riverside)
    let search_radius = 2; // Check 2 tiles in each direction for water proximity
    for dy in -search_radius..=search_radius {
        for dx in -search_radius..=search_radius {
            let check_x = tile_x + dx;
            let check_y = tile_y + dy;
            
            // Check if this nearby tile is water
            for tile in world_tiles.idx_world_position().filter((check_x, check_y)) {
                if tile.tile_type == TileType::Sea {
                    // Make sure we're on a reasonable tile ourselves (not water)
                    for own_tile in world_tiles.idx_world_position().filter((tile_x, tile_y)) {
                        if matches!(own_tile.tile_type, TileType::Grass | TileType::Dirt | TileType::Beach) {
                            return true; // Near water and on good tile
                        }
                    }
                }
            }
        }
    }
    
    false
}

/// Checks if position is suitable for reed spawning (along inland water sources)
/// Reeds prefer to grow directly adjacent to inland water (rivers/lakes) but not ocean water
fn is_reed_location_suitable(ctx: &ReducerContext, pos_x: f32, pos_y: f32) -> bool {
    // Convert pixel position to tile coordinates
    let tile_x = (pos_x / TILE_SIZE_PX as f32).floor() as i32;
    let tile_y = (pos_y / TILE_SIZE_PX as f32).floor() as i32;
    
    // Check if position is immediately adjacent to inland water
    let search_radius = 1; // Check 1 tile in each direction (immediate neighbors)
    let world_tiles = ctx.db.world_tile();
    
    for dy in -search_radius..=search_radius {
        for dx in -search_radius..=search_radius {
            let check_x = tile_x + dx;
            let check_y = tile_y + dy;
            
            // Skip if out of bounds
            if check_x < 0 || check_y < 0 || 
               check_x >= WORLD_WIDTH_TILES as i32 || check_y >= WORLD_HEIGHT_TILES as i32 {
                continue;
            }
            
            // Check if this nearby tile is water
            for tile in world_tiles.idx_world_position().filter((check_x, check_y)) {
                if tile.tile_type == TileType::Sea {
                    // Check if it's inland water (not ocean)
                    if is_tile_inland_water(ctx, check_x, check_y) {
                        // Make sure our own position is on a suitable tile (grass, dirt, or beach)
                        for own_tile in world_tiles.idx_world_position().filter((tile_x, tile_y)) {
                            if matches!(own_tile.tile_type, TileType::Grass | TileType::Dirt | TileType::Beach) {
                                return true; // Adjacent to inland water and on good tile
                            }
                        }
                    }
                }
            }
        }
    }
    
    false
}

// --- Environment Seeding ---

#[spacetimedb::reducer]
pub fn seed_environment(ctx: &ReducerContext) -> Result<(), String> {
    let trees = ctx.db.tree();
    let stones = ctx.db.stone();
    let mushrooms = ctx.db.mushroom();
    let corns = ctx.db.corn();
    let potatoes = ctx.db.potato();
    let pumpkins = ctx.db.pumpkin();
    let hemps = ctx.db.hemp();
    let reeds = ctx.db.reed();
    let clouds = ctx.db.cloud();
    let grasses = ctx.db.grass();

    if trees.iter().count() > 0 || stones.iter().count() > 0 || mushrooms.iter().count() > 0 || corns.iter().count() > 0 || potatoes.iter().count() > 0 || pumpkins.iter().count() > 0 || hemps.iter().count() > 0 || reeds.iter().count() > 0 || clouds.iter().count() > 0 {
        log::info!(
            "Environment already seeded (Trees: {}, Stones: {}, Mushrooms: {}, Corns: {}, Potatoes: {}, Hemps: {}, Pumpkins: {}, Reeds: {}, Clouds: {}). Skipping.",
            trees.iter().count(), stones.iter().count(), mushrooms.iter().count(), corns.iter().count(), potatoes.iter().count(), hemps.iter().count(), pumpkins.iter().count(), reeds.iter().count(), clouds.iter().count()
        );
        return Ok(());
    }

    log::info!("Seeding environment (trees, stones, mushrooms, corn, pumpkins, hemp, reeds, clouds)..." );

    let fbm = Fbm::<Perlin>::new(ctx.rng().gen());
    let mut rng = StdRng::from_rng(ctx.rng()).map_err(|e| format!("Failed to seed RNG: {}", e))?;

    let total_tiles = crate::WORLD_WIDTH_TILES * crate::WORLD_HEIGHT_TILES;

    // Calculate targets and limits
    let target_tree_count = (total_tiles as f32 * crate::tree::TREE_DENSITY_PERCENT) as u32;
    let max_tree_attempts = target_tree_count * crate::tree::MAX_TREE_SEEDING_ATTEMPTS_FACTOR;
    let target_stone_count = (total_tiles as f32 * crate::stone::STONE_DENSITY_PERCENT) as u32;
    let max_stone_attempts = target_stone_count * crate::tree::MAX_TREE_SEEDING_ATTEMPTS_FACTOR; 
    let target_mushroom_count = (total_tiles as f32 * crate::mushroom::MUSHROOM_DENSITY_PERCENT) as u32;
    let max_mushroom_attempts = target_mushroom_count * crate::tree::MAX_TREE_SEEDING_ATTEMPTS_FACTOR; 
    let target_corn_count = (total_tiles as f32 * crate::corn::CORN_DENSITY_PERCENT) as u32;
    let max_corn_attempts = target_corn_count * crate::tree::MAX_TREE_SEEDING_ATTEMPTS_FACTOR;
    let target_potato_count = (total_tiles as f32 * crate::potato::POTATO_DENSITY_PERCENT) as u32;
    let max_potato_attempts = target_potato_count * crate::tree::MAX_TREE_SEEDING_ATTEMPTS_FACTOR;
    let target_pumpkin_count = (total_tiles as f32 * crate::pumpkin::PUMPKIN_DENSITY_PERCENT) as u32;
    let max_pumpkin_attempts = target_pumpkin_count * crate::tree::MAX_TREE_SEEDING_ATTEMPTS_FACTOR;
    let target_hemp_count = (total_tiles as f32 * crate::hemp::HEMP_DENSITY_PERCENT) as u32;
    let max_hemp_attempts = target_hemp_count * crate::tree::MAX_TREE_SEEDING_ATTEMPTS_FACTOR;
    let target_reed_count = (total_tiles as f32 * crate::reed::REED_DENSITY_PERCENT) as u32;
    let max_reed_attempts = target_reed_count * crate::tree::MAX_TREE_SEEDING_ATTEMPTS_FACTOR;

    // Cloud seeding parameters
    const CLOUD_DENSITY_PERCENT: f32 = 0.005; // Example: 0.5% of tiles might have a cloud center
    const MAX_CLOUD_SEEDING_ATTEMPTS_FACTOR: u32 = 3;
    let target_cloud_count = (total_tiles as f32 * CLOUD_DENSITY_PERCENT) as u32;
    let max_cloud_attempts = target_cloud_count * MAX_CLOUD_SEEDING_ATTEMPTS_FACTOR;

    // Grass seeding parameters (using constants from grass.rs) - COMMENTED OUT
    let target_grass_count = (total_tiles as f32 * crate::grass::GRASS_DENSITY_PERCENT) as u32;
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
    log::info!("Target Mushrooms: {}, Max Attempts: {}", target_mushroom_count, max_mushroom_attempts);
    log::info!("Target Corns: {}, Max Attempts: {}", target_corn_count, max_corn_attempts);
    log::info!("Target Potatoes: {}, Max Attempts: {}", target_potato_count, max_potato_attempts);
    log::info!("Target Hemps: {}, Max Attempts: {}", target_hemp_count, max_hemp_attempts);
    log::info!("Target Pumpkins: {}, Max Attempts: {}", target_pumpkin_count, max_pumpkin_attempts);
    log::info!("Target Reeds: {}, Max Attempts: {}", target_reed_count, max_reed_attempts);
    log::info!("Target Clouds: {}, Max Attempts: {}", target_cloud_count, max_cloud_attempts);
    // log::info!("Target Grass: {}, Max Attempts: {}", target_grass_count, max_grass_attempts); // COMMENTED OUT
    // Calculate spawn bounds using helper
    let (min_tile_x, max_tile_x, min_tile_y, max_tile_y) = 
        calculate_tile_bounds(WORLD_WIDTH_TILES, WORLD_HEIGHT_TILES, crate::tree::TREE_SPAWN_WORLD_MARGIN_TILES);

    // Initialize tracking collections
    let mut occupied_tiles = HashSet::<(u32, u32)>::new();
    let mut spawned_tree_positions = Vec::<(f32, f32)>::new();
    let mut spawned_stone_positions = Vec::<(f32, f32)>::new();
    let mut spawned_mushroom_positions = Vec::<(f32, f32)>::new();
    let mut spawned_corn_positions = Vec::<(f32, f32)>::new();
    let mut spawned_potato_positions = Vec::<(f32, f32)>::new();
    let mut spawned_pumpkin_positions = Vec::<(f32, f32)>::new();
    let mut spawned_hemp_positions = Vec::<(f32, f32)>::new();
    let mut spawned_reed_positions = Vec::<(f32, f32)>::new();
    let mut spawned_cloud_positions = Vec::<(f32, f32)>::new();
    let mut spawned_grass_positions = Vec::<(f32, f32)>::new(); // COMMENTED OUT

    let mut spawned_tree_count = 0;
    let mut tree_attempts = 0;
    let mut spawned_stone_count = 0;
    let mut stone_attempts = 0;
    let mut spawned_mushroom_count = 0;
    let mut mushroom_attempts = 0;
    let mut spawned_corn_count = 0;
    let mut corn_attempts = 0;
    let mut spawned_potato_count = 0;
    let mut potato_attempts = 0;
    let mut spawned_hemp_count = 0;
    let mut hemp_attempts = 0;
    let mut spawned_pumpkin_count = 0;
    let mut pumpkin_attempts = 0;
    let mut spawned_reed_count = 0;
    let mut reed_attempts = 0;
    let mut spawned_cloud_count = 0;
    let mut cloud_attempts = 0;
    let mut spawned_grass_count = 0; // COMMENTED OUT
    let mut grass_attempts = 0; // COMMENTED OUT

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

    // --- Seed Mushrooms --- Use helper function ---
    log::info!("Seeding Mushrooms...");
    let mushroom_noise_threshold = 0.65; // Specific threshold for mushrooms
    while spawned_mushroom_count < target_mushroom_count && mushroom_attempts < max_mushroom_attempts {
        mushroom_attempts += 1;
        match attempt_single_spawn(
            &mut rng,
            &mut occupied_tiles,
            &mut spawned_mushroom_positions,
            &spawned_tree_positions,
            &spawned_stone_positions,
            min_tile_x, max_tile_x, min_tile_y, max_tile_y,
            &fbm,
            crate::tree::TREE_SPAWN_NOISE_FREQUENCY,
            mushroom_noise_threshold,
            crate::mushroom::MIN_MUSHROOM_DISTANCE_SQ,
            crate::mushroom::MIN_MUSHROOM_TREE_DISTANCE_SQ,
            crate::mushroom::MIN_MUSHROOM_STONE_DISTANCE_SQ,
            |pos_x, pos_y, _extra: ()| {
                // Calculate chunk index for the mushroom
                let chunk_idx = calculate_chunk_index(pos_x, pos_y);
                
                crate::mushroom::Mushroom {
                    id: 0,
                    pos_x,
                    pos_y,
                    chunk_index: chunk_idx, // Set the chunk index
                    respawn_at: None,
                }
            },
            (),
            |pos_x, pos_y| {
                // UPDATED: Combined water and location check for mushrooms
                is_position_on_water(ctx, pos_x, pos_y) || 
                !is_mushroom_location_suitable(ctx, pos_x, pos_y, &spawned_tree_positions)
            },
            mushrooms,
        ) {
            Ok(true) => spawned_mushroom_count += 1,
            Ok(false) => { /* Condition not met, continue */ }
            Err(_) => { /* Error already logged in helper, continue */ }
        }
    }
    log::info!(
        "Finished seeding {} mushrooms (target: {}, attempts: {}).",
        spawned_mushroom_count, target_mushroom_count, mushroom_attempts
    );

    // --- Seed Corn --- Use helper function ---
    log::info!("Seeding Corn...");
    let corn_noise_threshold = 0.70; // Specific threshold for corn
    while spawned_corn_count < target_corn_count && corn_attempts < max_corn_attempts {
        corn_attempts += 1;
        match attempt_single_spawn(
            &mut rng,
            &mut occupied_tiles,
            &mut spawned_corn_positions,
            &spawned_tree_positions,
            &spawned_stone_positions,
            min_tile_x, max_tile_x, min_tile_y, max_tile_y,
            &fbm,
            crate::tree::TREE_SPAWN_NOISE_FREQUENCY,
            corn_noise_threshold,
            crate::corn::MIN_CORN_DISTANCE_SQ,
            crate::corn::MIN_CORN_TREE_DISTANCE_SQ,
            crate::corn::MIN_CORN_STONE_DISTANCE_SQ,
            |pos_x, pos_y, _extra: ()| {
                // Calculate chunk index for the corn
                let chunk_idx = calculate_chunk_index(pos_x, pos_y);
                
                crate::corn::Corn {
                    id: 0,
                    pos_x,
                    pos_y,
                    chunk_index: chunk_idx, // Set the chunk index
                    respawn_at: None,
                }
            },
            (),
            |pos_x, pos_y| {
                // UPDATED: Combined water and location check for corn
                is_position_on_water(ctx, pos_x, pos_y) || 
                !is_corn_location_suitable(ctx, pos_x, pos_y)
            },
            corns,
        ) {
            Ok(true) => spawned_corn_count += 1,
            Ok(false) => { /* Condition not met, continue */ }
            Err(_) => { /* Error already logged in helper, continue */ }
        }
    }
    log::info!(
        "Finished seeding {} corn plants (target: {}, attempts: {}).",
        spawned_corn_count, target_corn_count, corn_attempts
    );

    // --- Seed Potatoes --- Use helper function ---
    log::info!("Seeding Potatoes...");
    let potato_noise_threshold = 0.65; // Lowered from 0.72 to match mushrooms
    while spawned_potato_count < target_potato_count && potato_attempts < max_potato_attempts {
        potato_attempts += 1;
        match attempt_single_spawn(
            &mut rng,
            &mut occupied_tiles,
            &mut spawned_potato_positions,
            &spawned_tree_positions,
            &spawned_stone_positions,
            min_tile_x, max_tile_x, min_tile_y, max_tile_y,
            &fbm,
            crate::tree::TREE_SPAWN_NOISE_FREQUENCY,
            potato_noise_threshold,
            crate::potato::MIN_POTATO_DISTANCE_SQ,
            crate::potato::MIN_POTATO_TREE_DISTANCE_SQ,
            crate::potato::MIN_POTATO_STONE_DISTANCE_SQ,
            |pos_x, pos_y, _extra: ()| {
                // Calculate chunk index for the potato
                let chunk_idx = calculate_chunk_index(pos_x, pos_y);
                
                crate::potato::Potato {
                    id: 0,
                    pos_x,
                    pos_y,
                    chunk_index: chunk_idx, // Set the chunk index
                    respawn_at: None,
                }
            },
            (),
            |pos_x, pos_y| {
                // UPDATED: Combined water and location check for potatoes
                is_position_on_water(ctx, pos_x, pos_y) || 
                !is_potato_location_suitable(ctx, pos_x, pos_y, &spawned_tree_positions)
            },
            potatoes,
        ) {
            Ok(true) => spawned_potato_count += 1,
            Ok(false) => { /* Condition not met, continue */ }
            Err(_) => { /* Error already logged in helper, continue */ }
        }
    }
    log::info!(
        "Finished seeding {} potatoes (target: {}, attempts: {}).",
        spawned_potato_count, target_potato_count, potato_attempts
    );

    // --- Seed Pumpkins --- Use helper function ---
    log::info!("Seeding Pumpkins...");
    let pumpkin_noise_threshold = 0.67; // Lowered from 0.75 to be more reasonable
    while spawned_pumpkin_count < target_pumpkin_count && pumpkin_attempts < max_pumpkin_attempts {
        pumpkin_attempts += 1;
        match attempt_single_spawn(
            &mut rng,
            &mut occupied_tiles,
            &mut spawned_pumpkin_positions,
            &spawned_tree_positions,
            &spawned_stone_positions,
            min_tile_x, max_tile_x, min_tile_y, max_tile_y,
            &fbm,
            crate::tree::TREE_SPAWN_NOISE_FREQUENCY,
            pumpkin_noise_threshold,
            crate::pumpkin::MIN_PUMPKIN_DISTANCE_SQ,
            crate::pumpkin::MIN_PUMPKIN_TREE_DISTANCE_SQ,
            crate::pumpkin::MIN_PUMPKIN_STONE_DISTANCE_SQ,
            |pos_x, pos_y, _extra: ()| {
                // Calculate chunk index for the pumpkin
                let chunk_idx = calculate_chunk_index(pos_x, pos_y);
                
                crate::pumpkin::Pumpkin {
                    id: 0,
                    pos_x,
                    pos_y,
                    chunk_index: chunk_idx,
                    respawn_at: None,
                }
            },
            (),
            |pos_x, pos_y| {
                // UPDATED: Combined water and location check for pumpkins
                is_position_on_water(ctx, pos_x, pos_y) || 
                !is_pumpkin_location_suitable(ctx, pos_x, pos_y)
            },
            pumpkins,
        ) {
            Ok(true) => spawned_pumpkin_count += 1,
            Ok(false) => { /* Condition not met, continue */ }
            Err(_) => { /* Error already logged in helper, continue */ }
        }
    }
    log::info!(
        "Finished seeding {} pumpkins (target: {}, attempts: {}).",
        spawned_pumpkin_count, target_pumpkin_count, pumpkin_attempts
    );

    // --- Seed Hemp --- Use helper function ---
    log::info!("Seeding Hemp...");
    let hemp_noise_threshold = 0.68; // Specific threshold for hemp (adjust as needed)
    while spawned_hemp_count < target_hemp_count && hemp_attempts < max_hemp_attempts {
        hemp_attempts += 1;
        match attempt_single_spawn(
            &mut rng,
            &mut occupied_tiles,
            &mut spawned_hemp_positions, 
            &spawned_tree_positions,    
            &spawned_stone_positions,   // Consider corn positions too if they are dense
            min_tile_x, max_tile_x, min_tile_y, max_tile_y,
            &fbm,
            crate::tree::TREE_SPAWN_NOISE_FREQUENCY, 
            hemp_noise_threshold,          
            crate::hemp::MIN_HEMP_DISTANCE_SQ,
            crate::hemp::MIN_HEMP_TREE_DISTANCE_SQ,
            crate::hemp::MIN_HEMP_STONE_DISTANCE_SQ,
            |pos_x, pos_y, _extra: ()| {
                let chunk_idx = calculate_chunk_index(pos_x, pos_y);
                crate::hemp::Hemp {
                    id: 0,
                    pos_x,
                    pos_y,
                    chunk_index: chunk_idx,
                    respawn_at: None,
                }
            },
            (),
            |pos_x, pos_y| {
                // UPDATED: Combined water and location check for hemp
                is_position_on_water(ctx, pos_x, pos_y) || 
                !is_hemp_location_suitable(ctx, pos_x, pos_y, &spawned_tree_positions, &spawned_stone_positions)
            },
            hemps, 
        ) {
            Ok(true) => spawned_hemp_count += 1,
            Ok(false) => { /* Condition not met, continue */ }
            Err(_) => { /* Error already logged in helper, continue */ }
        }
    }
    log::info!(
        "Finished seeding {} hemps (target: {}, attempts: {}).",
        spawned_hemp_count, target_hemp_count, hemp_attempts
    );

    // --- Seed Reeds --- Use helper function ---
    log::info!("Seeding Reeds...");
    let reed_noise_threshold = 0.62; // Lower threshold for reeds (easier to spawn near water)
    while spawned_reed_count < target_reed_count && reed_attempts < max_reed_attempts {
        reed_attempts += 1;
        match attempt_single_spawn(
            &mut rng,
            &mut occupied_tiles,
            &mut spawned_reed_positions,
            &spawned_tree_positions,
            &spawned_stone_positions,
            min_tile_x, max_tile_x, min_tile_y, max_tile_y,
            &fbm,
            crate::tree::TREE_SPAWN_NOISE_FREQUENCY,
            reed_noise_threshold,
            crate::reed::MIN_REED_DISTANCE_SQ,
            crate::reed::MIN_REED_TREE_DISTANCE_SQ,
            crate::reed::MIN_REED_STONE_DISTANCE_SQ,
            |pos_x, pos_y, _extra: ()| {
                // Calculate chunk index for the reed
                let chunk_idx = calculate_chunk_index(pos_x, pos_y);
                
                crate::reed::Reed {
                    id: 0,
                    pos_x,
                    pos_y,
                    chunk_index: chunk_idx,
                    respawn_at: None,
                }
            },
            (),
            |pos_x, pos_y| {
                // UPDATED: Combined water and location check for reeds
                // Note: Reeds want to be NEAR water, not ON water, so we use the inverse
                !is_reed_location_suitable(ctx, pos_x, pos_y)
            },
            reeds,
        ) {
            Ok(true) => spawned_reed_count += 1,
            Ok(false) => { /* Condition not met, continue */ }
            Err(_) => { /* Error already logged in helper, continue */ }
        }
    }
    log::info!(
        "Finished seeding {} reeds (target: {}, attempts: {}).",
        spawned_reed_count, target_reed_count, reed_attempts
    );

    // --- Seed Grass --- (New Section) - COMMENTED OUT
    log::info!("Seeding Grass...");
    let (grass_min_tile_x, grass_max_tile_x, grass_min_tile_y, grass_max_tile_y) = 
        calculate_tile_bounds(WORLD_WIDTH_TILES, WORLD_HEIGHT_TILES, crate::grass::GRASS_SPAWN_WORLD_MARGIN_TILES);
    
    while spawned_grass_count < target_grass_count && grass_attempts < max_grass_attempts {
        grass_attempts += 1;

        // Generate random values for grass appearance and sway before the attempt_single_spawn call
        let appearance_roll_for_this_attempt: u32 = rng.gen_range(0..100);
        let sway_offset_seed_for_this_attempt: u32 = rng.gen();

        // Pre-determine grass type to use in water check
        // First, do a quick check to see if this position might be on inland water
        let test_tile_x = rng.gen_range(grass_min_tile_x..grass_max_tile_x) as i32;
        let test_tile_y = rng.gen_range(grass_min_tile_y..grass_max_tile_y) as i32;
        let test_pos_x = (test_tile_x as f32 + 0.5) * TILE_SIZE_PX as f32;
        let test_pos_y = (test_tile_y as f32 + 0.5) * TILE_SIZE_PX as f32;
        let is_on_inland_water = is_position_on_inland_water(ctx, test_pos_x, test_pos_y);
        
        let mut appearance_roll = appearance_roll_for_this_attempt;
        
        // Heavily bias towards water foliage if we're in a water area
        let predetermined_grass_type = if is_on_inland_water {
            // Check if this is a lake-like area (larger water body) for even more foliage
            let is_lake_area = is_position_in_lake_area(ctx, test_pos_x, test_pos_y);
            
            if is_lake_area {
                // In lake areas, make 90% water foliage with more diverse types
                if appearance_roll < 25 { // 25% LilyPads - very common in lakes
                    crate::grass::GrassAppearanceType::LilyPads
                } else if appearance_roll < 40 { // 15% ReedBedsA
                    crate::grass::GrassAppearanceType::ReedBedsA
                } else if appearance_roll < 55 { // 15% ReedBedsB
                    crate::grass::GrassAppearanceType::ReedBedsB
                } else if appearance_roll < 70 { // 15% Bulrushes
                    crate::grass::GrassAppearanceType::Bulrushes
                } else if appearance_roll < 80 { // 10% AlgaeMats - surface plants for lakes
                    crate::grass::GrassAppearanceType::AlgaeMats
                } else if appearance_roll < 87 { // 7% SeaweedForest
                    crate::grass::GrassAppearanceType::SeaweedForest
                } else { // 7% fallback to PatchA
                    crate::grass::GrassAppearanceType::PatchA
                }
            } else {
                // In river areas, make 80% water foliage (original distribution)
                if appearance_roll < 20 { // 20% ReedBedsA - most common in rivers
                    crate::grass::GrassAppearanceType::ReedBedsA
                } else if appearance_roll < 35 { // 15% ReedBedsB 
                    crate::grass::GrassAppearanceType::ReedBedsB
                } else if appearance_roll < 50 { // 15% Bulrushes
                    crate::grass::GrassAppearanceType::Bulrushes
                } else if appearance_roll < 65 { // 15% LilyPads
                    crate::grass::GrassAppearanceType::LilyPads
                } else if appearance_roll < 85 { // 10% SeaweedForest
                    crate::grass::GrassAppearanceType::SeaweedForest
                } else if appearance_roll < 95 { // 10% AlgaeMats
                    crate::grass::GrassAppearanceType::AlgaeMats
                } else { // 5% fallback to PatchA
                    crate::grass::GrassAppearanceType::PatchA
                }
            }
        } else {
            // Regular land-based distribution
            if appearance_roll < 20 { // 20% PatchA
                crate::grass::GrassAppearanceType::PatchA
            } else if appearance_roll < 35 { // 15% PatchB
                crate::grass::GrassAppearanceType::PatchB
            } else if appearance_roll < 50 { // 15% PatchC
                crate::grass::GrassAppearanceType::PatchC
            } else if appearance_roll < 65 { // 15% TallGrassA
                crate::grass::GrassAppearanceType::TallGrassA
            } else if appearance_roll < 75 { // 10% TallGrassB
                crate::grass::GrassAppearanceType::TallGrassB
            } else if appearance_roll < 85 { // 10% BramblesA
                crate::grass::GrassAppearanceType::BramblesA
            } else { // 15% BramblesB
                crate::grass::GrassAppearanceType::BramblesB
            }
        };

        match attempt_single_spawn(
            &mut rng,
            &mut occupied_tiles, // Grass can share tiles with other non-blocking items, but not other grass or solid objects initially
            &mut spawned_grass_positions,
            &spawned_tree_positions,    
            &spawned_stone_positions,   
            grass_min_tile_x, grass_max_tile_x, grass_min_tile_y, grass_max_tile_y,
            &fbm,
            crate::grass::GRASS_SPAWN_NOISE_FREQUENCY, 
            crate::grass::GRASS_SPAWN_NOISE_THRESHOLD,          
            crate::grass::MIN_GRASS_DISTANCE_SQ,
            crate::grass::MIN_GRASS_TREE_DISTANCE_SQ,
            crate::grass::MIN_GRASS_STONE_DISTANCE_SQ,
            |pos_x, pos_y, (predetermined_type, sway_seed): (crate::grass::GrassAppearanceType, u32)| { // Use predetermined type
                let chunk_idx = calculate_chunk_index(pos_x, pos_y);
                
                // Use the predetermined grass type (passed in as argument)
                let appearance_type = predetermined_type;

                crate::grass::Grass {
                    id: 0,
                    pos_x,
                    pos_y,
                    health: crate::grass::GRASS_INITIAL_HEALTH,
                    appearance_type,
                    chunk_index: chunk_idx,
                    last_hit_time: None,
                    respawn_at: None,
                    sway_offset_seed: sway_seed, // Use the passed-in sway_seed
                    sway_speed: 0.3f32, // Increased base sway speed to 0.3
                    // Initialize disturbance fields for new grass
                    disturbed_at: None,
                    disturbance_direction_x: 0.0,
                    disturbance_direction_y: 0.0,
                }
            },
            (predetermined_grass_type.clone(), sway_offset_seed_for_this_attempt), // Pass the predetermined type and sway seed
            |pos_x, pos_y| is_grass_water_check_blocked(ctx, pos_x, pos_y, &predetermined_grass_type), // NEW: Smart water check function
            grasses, // Pass the grass table handle
        ) {
            Ok(true) => spawned_grass_count += 1,
            Ok(false) => { /* Condition not met, continue */ }
            Err(_) => { /* Error already logged in helper, continue */ }
        }
    }
    log::info!(
        "Finished seeding {} grass patches (target: {}, attempts: {}).",
        spawned_grass_count, target_grass_count, grass_attempts
    );
    // --- End Seed Grass --- (COMMENTED OUT)

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


    log::info!("Environment seeding complete.");
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

    // Respawn Mushrooms
    check_and_respawn_resource!(
        ctx,
        mushroom,
        crate::mushroom::Mushroom,
        "Mushroom",
        |_m: &crate::mushroom::Mushroom| true, // Filter: Always check mushrooms if respawn_at is set (handled internally by macro)
        |m: &mut crate::mushroom::Mushroom| {
            m.respawn_at = None;
        }
    );

    // Respawn Corn
    check_and_respawn_resource!(
        ctx,
        corn,
        crate::corn::Corn,
        "Corn",
        |_c: &crate::corn::Corn| true, // Filter: Always check corn if respawn_at is set (handled internally by macro)
        |c: &mut crate::corn::Corn| {
            c.respawn_at = None;
        }
    );

    // Respawn Potatoes
    check_and_respawn_resource!(
        ctx,
        potato,
        crate::potato::Potato,
        "Potato",
        |_p: &crate::potato::Potato| true, // Filter: Always check potatoes if respawn_at is set (handled internally by macro)
        |p: &mut crate::potato::Potato| {
            p.respawn_at = None;
        }
    );

    // Respawn Pumpkins
    check_and_respawn_resource!(
        ctx,
        pumpkin,
        crate::pumpkin::Pumpkin,
        "Pumpkin",
        |_p: &crate::pumpkin::Pumpkin| true, // Filter: Always check pumpkins if respawn_at is set (handled internally by macro)
        |p: &mut crate::pumpkin::Pumpkin| {
            p.respawn_at = None;
        }
    );

    // Respawn Hemp
    check_and_respawn_resource!(
        ctx,
        hemp, // Table symbol
        crate::hemp::Hemp, // Entity type
        "Hemp", // Name for logging
        |_h: &crate::hemp::Hemp| true, // Filter: Always check if respawn_at is set
        |h: &mut crate::hemp::Hemp| {
            h.respawn_at = None;
        }
    );

    // Respawn Reeds
    check_and_respawn_resource!(
        ctx,
        reed, // Table symbol
        crate::reed::Reed, // Entity type
        "Reed", // Name for logging
        |_r: &crate::reed::Reed| true, // Filter: Always check if respawn_at is set
        |r: &mut crate::reed::Reed| {
            r.respawn_at = None;
        }
    );

    // Respawn Grass
    check_and_respawn_resource!(
        ctx,
        grass, // Table symbol
        crate::grass::Grass, // Entity type
        "Grass", // Name for logging
        |g: &crate::grass::Grass| g.health == 0, // Filter: only check grass with 0 health
        |g: &mut crate::grass::Grass| { // Update logic
            g.health = crate::grass::GRASS_INITIAL_HEALTH;
            g.respawn_at = None;
            g.last_hit_time = None;
            // appearance_type and sway_offset_seed remain the same on respawn
        }
    );

    // Note: Clouds are static for now, so no respawn logic needed in check_resource_respawns.
    // If they were to drift or change, a similar `check_and_respawn_resource!` or a dedicated
    // scheduled reducer would be needed here or in `cloud.rs`.

    Ok(())
}
