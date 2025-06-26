use rand::Rng; // Add rand for random respawn location
use spacetimedb::{ReducerContext, Identity, Timestamp, Table, log};
use rand::prelude::*;

// Import table traits
use crate::player;
use crate::items::item_definition;
use crate::active_equipment; // Import the module itself for clear_active_item_reducer

// Import functions from other modules
use crate::crafting_queue;
use crate::items;

// Import global constants from lib.rs
use crate::{TILE_SIZE_PX, WORLD_WIDTH_PX, WORLD_HEIGHT_PX, TileType};

// Import table traits for database access
use crate::tree::tree as TreeTableTrait;
use crate::stone::stone as StoneTableTrait;
use crate::campfire::campfire as CampfireTableTrait;
use crate::wooden_storage_box::wooden_storage_box as WoodenStorageBoxTableTrait;
use crate::world_tile as WorldTileTableTrait;

// Import necessary modules and constants
use crate::{Player, WORLD_WIDTH_TILES, WORLD_HEIGHT_TILES, world_pos_to_tile_coords, get_tile_type_at_position, PLAYER_RADIUS};
use crate::environment::calculate_chunk_index;
use crate::player_stats::{PLAYER_STARTING_HUNGER, PLAYER_STARTING_THIRST};
use crate::death_marker::{DeathMarker, death_marker as DeathMarkerTableTrait};

// Respawn Collision Check Constants
pub const RESPAWN_CHECK_RADIUS: f32 = TILE_SIZE_PX as f32 * 3.0; // 3 tiles radius (144 pixels) for realistic proximity blocking
pub const RESPAWN_CHECK_RADIUS_SQ: f32 = RESPAWN_CHECK_RADIUS * RESPAWN_CHECK_RADIUS;
pub const MAX_RESPAWN_OFFSET_ATTEMPTS: u32 = 8; // Max times to try offsetting
pub const RESPAWN_OFFSET_DISTANCE: f32 = TILE_SIZE_PX as f32 * 0.5; // How far to offset each attempt

/// Reducer that handles random respawn requests from dead players.
/// 
/// This reducer is called by the client when a dead player wants to respawn at a random location.
/// It verifies the player is dead, clears their crafting queue, and grants them basic starting items
/// before placing them at a new random position on valid land tiles (avoiding water).
#[spacetimedb::reducer]
pub fn respawn_randomly(ctx: &ReducerContext) -> Result<(), String> { // Renamed function
    let sender_id = ctx.sender;
    let players = ctx.db.player();
    let item_defs = ctx.db.item_definition();

    // Find the player requesting respawn
    let mut player = players.identity().find(&sender_id)
        .ok_or_else(|| "Player not found".to_string())?;

    // Check if the player is actually dead
    if !player.is_dead {
        log::warn!("Player {:?} requested respawn but is not dead.", sender_id);
        return Err("You are not dead.".to_string());
    }

    log::info!("Respawning player {} ({:?}). Crafting queue will be cleared.", player.username, sender_id);

    // --- Clear Crafting Queue & Refund ---
    crafting_queue::clear_player_crafting_queue(ctx, sender_id);
    // --- END Clear Crafting Queue ---

    // --- Look up Combat Ladle Item Definition ID ---
    let combat_ladle_item_def_id = item_defs.iter()
        .find(|def| def.name == "Combat Ladle")
        .map(|def| def.id)
        .ok_or_else(|| "Item definition for 'Combat Ladle' not found.".to_string())?;
    // --- End Look up ---

    // --- Grant Starting Combat Ladle ---
    log::info!("Granting starting Combat Ladle to respawned player: {}", player.username);
    let opt_instance_id = items::add_item_to_player_inventory(ctx, sender_id, combat_ladle_item_def_id, 1)?;
    match opt_instance_id {
        Some(new_combat_ladle_instance_id) => {
            let _ = log::info!("Granted 1 Combat Ladle (ID: {}) to player {}.", new_combat_ladle_instance_id, player.username);
        }
        None => {
            let _ = log::error!("Failed to grant starting Combat Ladle to player {} (no slot found).", player.username);
            // Optionally, we could return an Err here if not getting a combat ladle is critical
            // return Err("Could not grant starting Combat Ladle: Inventory full or other issue.".to_string());
        }
    }
    // --- End Grant Starting Combat Ladle ---

    // --- Grant Starting Torch ---
    match item_defs.iter().find(|def| def.name == "Torch") {
        Some(torch_def) => {
            log::info!("Granting starting Torch to respawned player: {}", player.username);
            match items::add_item_to_player_inventory(ctx, sender_id, torch_def.id, 1)? {
                Some(new_torch_instance_id) => {
                    log::info!("Granted 1 Torch (ID: {}) to player {}.", new_torch_instance_id, player.username);
                }
                None => {
                    log::error!("Failed to grant starting Torch to player {} (no slot found).", player.username);
                }
            }
        }
        None => {
            log::error!("Item definition for 'Torch' not found. Cannot grant starting torch.");
        }
    }
    // --- End Grant Starting Torch ---

    // --- Find Valid Coastal Beach Spawn Position (Same as register_player + south half constraint) ---
    
    // Step 1: Find all beach tiles that are coastal (adjacent to sea/water) in SOUTH HALF ONLY
    let world_tiles = ctx.db.world_tile();
    let trees = ctx.db.tree();
    let stones = ctx.db.stone();
    let campfires = ctx.db.campfire();
    let wooden_storage_boxes = ctx.db.wooden_storage_box();
    
    let mut coastal_beach_tiles = Vec::new();
    
    log::info!("Searching for coastal beach tiles in SOUTH HALF for respawn (corrected Y logic)...");
    
    // Create a map of all tiles for efficient lookup
    let mut tile_map = std::collections::HashMap::new();
    for tile in world_tiles.iter() {
        tile_map.insert((tile.world_x, tile.world_y), tile.clone());
    }
    
    // Find beach tiles that are adjacent to sea/water tiles AND in south half
    let mut total_beach_tiles = 0;
    let mut coastal_beach_count = 0;
    let map_height_half = (crate::WORLD_HEIGHT_TILES / 2) as i32;
    
    log::info!("Map height: {} tiles, half point: {} tiles (keeping Y < {})", crate::WORLD_HEIGHT_TILES, map_height_half, map_height_half);
    
    for tile in world_tiles.iter() {
        if tile.tile_type == crate::TileType::Beach {
            total_beach_tiles += 1;
            
            // CONSTRAINT: Only consider tiles in the SOUTH HALF of the map for respawn
            // CORRECTED: Keep south half (larger Y values), skip north half (smaller Y values)
            if tile.world_y < map_height_half {
                continue; // Skip tiles in north half (smaller Y values)
            }
            
            // Check if this beach tile is adjacent to sea/water
            let mut is_coastal = false;
            
            // Check all 8 adjacent tiles (including diagonals)
            for dx in -1..=1i32 {
                for dy in -1..=1i32 {
                    if dx == 0 && dy == 0 { continue; } // Skip the tile itself
                    
                    let adjacent_x = tile.world_x + dx;
                    let adjacent_y = tile.world_y + dy;
                    
                    // Check if adjacent tile exists and is sea
                    if let Some(adjacent_tile) = tile_map.get(&(adjacent_x, adjacent_y)) {
                        if adjacent_tile.tile_type == crate::TileType::Sea {
                            is_coastal = true;
                            break;
                        }
                    } else {
                        // If adjacent tile is outside map bounds, consider it coastal
                        // (this handles cases where beach is at true map edge)
                        is_coastal = true;
                        break;
                    }
                }
                if is_coastal { break; }
            }
            
            if is_coastal {
                coastal_beach_tiles.push(tile.clone());
                coastal_beach_count += 1;
                if coastal_beach_count <= 10 { // Log first 10 for debugging
                    log::debug!("Found south half coastal beach tile for respawn at ({}, {}) - world coords ({}, {})", 
                               tile.world_x, tile.world_y, tile.world_x * crate::TILE_SIZE_PX as i32, tile.world_y * crate::TILE_SIZE_PX as i32);
                }
            }
        }
    }
    
    log::info!("South half coastal beach search for respawn complete: {} total beach tiles, {} coastal beach tiles found", 
               total_beach_tiles, coastal_beach_tiles.len());
    
    // MANDATORY: Must have coastal beach tiles
    if coastal_beach_tiles.is_empty() {
        return Err(format!("CRITICAL ERROR: No south half coastal beach tiles found for respawn! Cannot respawn player. Total beach tiles: {}", total_beach_tiles));
    }
    
    // Step 2: Find a valid spawn point from coastal beach tiles (with relaxed collision detection)
    let mut spawn_x: f32;
    let mut spawn_y: f32;
    let max_spawn_attempts = 50; // Increased attempts significantly
    let mut spawn_attempt = 0;
    let mut last_collision_reason = String::new();
    
    // Try to find a valid spawn on a random coastal beach tile
    loop {
        // Pick a random coastal beach tile
        let random_index = ctx.rng().gen_range(0..coastal_beach_tiles.len());
        let selected_tile = &coastal_beach_tiles[random_index];
        
        // Convert tile coordinates to world pixel coordinates (center of tile)
        spawn_x = (selected_tile.world_x as f32 * crate::TILE_SIZE_PX as f32) + (crate::TILE_SIZE_PX as f32 / 2.0);
        spawn_y = (selected_tile.world_y as f32 * crate::TILE_SIZE_PX as f32) + (crate::TILE_SIZE_PX as f32 / 2.0);
        
        log::debug!("Respawn attempt {}: Testing spawn at south half coastal beach tile ({}, {}) -> world pos ({:.1}, {:.1})", 
                   spawn_attempt + 1, selected_tile.world_x, selected_tile.world_y, spawn_x, spawn_y);
        
        // Step 3: Check for collisions at this beach tile position (RELAXED collision detection)
        let mut collision = false;
        last_collision_reason.clear();
        
        // Check collision with other players (more lenient spacing)
        for other_player in players.iter() {
            if other_player.is_dead || other_player.identity == sender_id { continue; }
            let dx = spawn_x - other_player.position_x;
            let dy = spawn_y - other_player.position_y;
            let distance_sq = dx * dx + dy * dy;
            let min_distance_sq = crate::PLAYER_RADIUS * crate::PLAYER_RADIUS * 2.0; // Reduced spacing requirement
            if distance_sq < min_distance_sq {
                collision = true;
                last_collision_reason = format!("Player collision (distance: {:.1})", distance_sq.sqrt());
                break;
            }
        }
        
        // Check collision with trees (more lenient)
        if !collision {
            for tree in trees.iter() {
                if tree.health == 0 { continue; }
                let dx = spawn_x - tree.pos_x;
                let dy = spawn_y - (tree.pos_y - crate::tree::TREE_COLLISION_Y_OFFSET);
                let distance_sq = dx * dx + dy * dy;
                if distance_sq < (crate::tree::PLAYER_TREE_COLLISION_DISTANCE_SQUARED * 0.8) { // 20% more lenient
                    collision = true;
                    last_collision_reason = format!("Tree collision at ({:.1}, {:.1})", tree.pos_x, tree.pos_y);
                    break;
                }
            }
        }
        
        // Check collision with stones (more lenient)
        if !collision {
            for stone in stones.iter() {
                if stone.health == 0 { continue; }
                let dx = spawn_x - stone.pos_x;
                let dy = spawn_y - (stone.pos_y - crate::stone::STONE_COLLISION_Y_OFFSET);
                let distance_sq = dx * dx + dy * dy;
                if distance_sq < (crate::stone::PLAYER_STONE_COLLISION_DISTANCE_SQUARED * 0.8) { // 20% more lenient
                    collision = true;
                    last_collision_reason = format!("Stone collision at ({:.1}, {:.1})", stone.pos_x, stone.pos_y);
                    break;
                }
            }
        }
        
        // Check collision with campfires (more lenient)
        if !collision {
            for campfire in campfires.iter() {
                let dx = spawn_x - campfire.pos_x;
                let dy = spawn_y - (campfire.pos_y - crate::campfire::CAMPFIRE_COLLISION_Y_OFFSET);
                let distance_sq = dx * dx + dy * dy;
                if distance_sq < (crate::campfire::PLAYER_CAMPFIRE_COLLISION_DISTANCE_SQUARED * 0.8) { // 20% more lenient
                    collision = true;
                    last_collision_reason = format!("Campfire collision at ({:.1}, {:.1})", campfire.pos_x, campfire.pos_y);
                    break;
                }
            }
        }
        
        // Check collision with wooden storage boxes (more lenient)
        if !collision {
            for box_instance in wooden_storage_boxes.iter() {
                let dx = spawn_x - box_instance.pos_x;
                let dy = spawn_y - (box_instance.pos_y - crate::wooden_storage_box::BOX_COLLISION_Y_OFFSET);
                let distance_sq = dx * dx + dy * dy;
                if distance_sq < (crate::wooden_storage_box::PLAYER_BOX_COLLISION_DISTANCE_SQUARED * 0.8) { // 20% more lenient
                    collision = true;
                    last_collision_reason = format!("Storage box collision at ({:.1}, {:.1})", box_instance.pos_x, box_instance.pos_y);
                    break;
                }
            }
        }
        
        // If no collision found, we have a valid spawn point!
        if !collision {
            log::info!("SUCCESS: South half coastal beach respawn found at ({:.1}, {:.1}) on tile ({}, {}) after {} attempts", 
                      spawn_x, spawn_y, selected_tile.world_x, selected_tile.world_y, spawn_attempt + 1);
            break;
        }
        
        // Log collision reason for debugging
        if spawn_attempt < 10 { // Only log first 10 attempts to avoid spam
            log::debug!("South half respawn attempt {} failed: {} at coastal beach tile ({}, {})", 
                       spawn_attempt + 1, last_collision_reason, selected_tile.world_x, selected_tile.world_y);
        }
        
        spawn_attempt += 1;
        if spawn_attempt >= max_spawn_attempts {
            // FORCE spawn on the last attempted beach tile - NO FALLBACK
            log::warn!("Could not find collision-free south half coastal beach respawn after {} attempts. FORCING respawn at last coastal beach tile ({:.1}, {:.1}) - {}", 
                      max_spawn_attempts, spawn_x, spawn_y, last_collision_reason);
            break;
        }
    }
    
    // Final validation - ensure we're spawning on a beach tile
    let final_tile_x = (spawn_x / crate::TILE_SIZE_PX as f32).floor() as i32;
    let final_tile_y = (spawn_y / crate::TILE_SIZE_PX as f32).floor() as i32;
    log::info!("RESPAWN COMPLETE: Player {} will respawn at world coords ({:.1}, {:.1}) which is tile ({}, {})", 
               player.username, spawn_x, spawn_y, final_tile_x, final_tile_y);
    // --- End Find Valid Coastal Beach Spawn Position ---

    // --- Reset Stats and State ---
    player.health = 100.0;
    player.hunger = PLAYER_STARTING_HUNGER;
    player.thirst = PLAYER_STARTING_THIRST;
    player.warmth = 100.0;
    player.stamina = 100.0;
    player.jump_start_time_ms = 0;
    player.is_sprinting = false;
    player.is_dead = false; // Mark as alive again
    player.death_timestamp = None; // Clear death timestamp
    player.last_hit_time = None;
    player.is_torch_lit = false; // Ensure torch is unlit on respawn
    player.is_knocked_out = false; // NEW: Reset knocked out state
    player.knocked_out_at = None; // NEW: Clear knocked out timestamp

    // --- Set Position to Found Land Location ---
    player.position_x = spawn_x;
    player.position_y = spawn_y;
    player.direction = "down".to_string();

    // --- Update Timestamp ---
    player.last_update = ctx.timestamp;
    player.last_stat_update = ctx.timestamp; // Reset stat timestamp on respawn

    // --- Apply Player Changes ---
    players.identity().update(player);
    log::info!("Player {:?} respawned on land at ({:.1}, {:.1}).", sender_id, spawn_x, spawn_y);

    // Ensure item is unequipped on respawn
    match active_equipment::clear_active_item_reducer(ctx, sender_id) {
        Ok(_) => log::info!("Ensured active item is cleared for respawned player {:?}", sender_id),
        Err(e) => log::error!("Failed to clear active item for respawned player {:?}: {}", sender_id, e),
    }

    Ok(())
}