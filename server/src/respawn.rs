use rand::Rng; // Add rand for random respawn location
use spacetimedb::{ReducerContext, Identity, Timestamp, Table, log};

// Import table traits
use crate::player;
use crate::items::item_definition;
use crate::active_equipment; // Import the module itself for clear_active_item_reducer

// Import functions from other modules
use crate::crafting_queue;
use crate::items;

// Import global constants from lib.rs
use crate::{TILE_SIZE_PX, WORLD_WIDTH_PX, WORLD_HEIGHT_PX};

// Respawn Collision Check Constants
pub const RESPAWN_CHECK_RADIUS: f32 = TILE_SIZE_PX as f32 * 0.8; // Check slightly less than a tile radius
pub const RESPAWN_CHECK_RADIUS_SQ: f32 = RESPAWN_CHECK_RADIUS * RESPAWN_CHECK_RADIUS;
pub const MAX_RESPAWN_OFFSET_ATTEMPTS: u32 = 8; // Max times to try offsetting
pub const RESPAWN_OFFSET_DISTANCE: f32 = TILE_SIZE_PX as f32 * 0.5; // How far to offset each attempt

/// Reducer that handles random respawn requests from dead players.
/// 
/// This reducer is called by the client when a dead player wants to respawn at a random location.
/// It verifies the player is dead, clears their crafting queue, and grants them basic starting items
/// before placing them at a new random position in the world.
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

    // --- Look up Rock Item Definition ID ---
    let rock_item_def_id = item_defs.iter()
        .find(|def| def.name == "Rock")
        .map(|def| def.id)
        .ok_or_else(|| "Item definition for 'Rock' not found.".to_string())?;
    // --- End Look up ---

    // --- Grant Starting Rock ---
    log::info!("Granting starting Rock to respawned player: {}", player.username);
    let opt_instance_id = items::add_item_to_player_inventory(ctx, sender_id, rock_item_def_id, 1)?;
    match opt_instance_id {
        Some(new_rock_instance_id) => {
            let _ = log::info!("Granted 1 Rock (ID: {}) to player {}.", new_rock_instance_id, player.username);
        }
        None => {
            let _ = log::error!("Failed to grant starting Rock to player {} (no slot found).", player.username);
            // Optionally, we could return an Err here if not getting a rock is critical
            // return Err("Could not grant starting Rock: Inventory full or other issue.".to_string());
        }
    }
    // --- End Grant Starting Rock ---

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

    // --- Reset Stats and State ---
    player.health = 100.0;
    player.hunger = 100.0;
    player.thirst = 100.0;
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

    // --- Reset Position to Random Location ---
    let mut rng = ctx.rng(); // Use the rng() method
    let spawn_padding = TILE_SIZE_PX as f32 * 2.0; // Padding from world edges
    let mut spawn_x;
    let mut spawn_y;
    let mut attempts = 0;
    const MAX_SPAWN_ATTEMPTS: u32 = 10; // Prevent infinite loop

    loop {
        spawn_x = rng.gen_range(spawn_padding..(WORLD_WIDTH_PX - spawn_padding));
        spawn_y = rng.gen_range(spawn_padding..(WORLD_HEIGHT_PX - spawn_padding));
        
        // Basic collision check (simplified - TODO: Add proper safe spawn logic like in register_player)
        let is_safe = true; // Placeholder - replace with actual check

        if is_safe || attempts >= MAX_SPAWN_ATTEMPTS {
            break;
        }
        attempts += 1;
    }

    if attempts >= MAX_SPAWN_ATTEMPTS {
        log::warn!("Could not find a guaranteed safe random spawn point for player {:?} after {} attempts. Spawning anyway.", sender_id, MAX_SPAWN_ATTEMPTS);
    }

    player.position_x = spawn_x;
    player.position_y = spawn_y;
    player.direction = "down".to_string();

    // --- Update Timestamp ---
    player.last_update = ctx.timestamp;
    player.last_stat_update = ctx.timestamp; // Reset stat timestamp on respawn

    // --- Apply Player Changes ---
    players.identity().update(player);
    log::info!("Player {:?} respawned randomly at ({:.1}, {:.1}).", sender_id, spawn_x, spawn_y);

    // Ensure item is unequipped on respawn
    match active_equipment::clear_active_item_reducer(ctx, sender_id) {
        Ok(_) => log::info!("Ensured active item is cleared for respawned player {:?}", sender_id),
        Err(e) => log::error!("Failed to clear active item for respawned player {:?}: {}", sender_id, e),
    }

    Ok(())
}