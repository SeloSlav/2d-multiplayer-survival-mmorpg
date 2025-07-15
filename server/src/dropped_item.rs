//! # Dropped Item System
//! 
//! This module handles items that are dropped in the world and provides automatic
//! inventory overflow handling. When a player's inventory is full and they attempt
//! to pick up items or harvest resources, those items are automatically dropped
//! near the player instead of being lost.
//!
//! ## Key Features:
//! - Players can pick up dropped items if they're close enough
//! - Items automatically despawn after their configured respawn time
//! - **Automatic dropping**: When inventory is full, items are dropped near the player
//! - Public API for other modules to give items with fallback dropping

use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};
use log;
// Use the specific import path from Blackholio
use spacetimedb::spacetimedb_lib::ScheduleAt;
// Import Duration for interval
use std::time::Duration;

// Import necessary items from other modules
// Need to use the generated table trait alias for InventoryItemTable operations
use crate::items::inventory_item as InventoryItemTableTrait;
use crate::items::item_definition as ItemDefinitionTableTrait; // Import ItemDefinition trait
use crate::player as PlayerTableTrait; // Import Player trait
use crate::items::{add_item_to_player_inventory, add_item_to_player_inventory_with_data, InventoryItem, ItemDefinition};
// Corrected imports for Player and PLAYER_RADIUS from crate root
use crate::{Player, PLAYER_RADIUS}; 
use crate::utils::get_distance_squared; // Assuming a utility function for distance
use crate::environment::calculate_chunk_index; // Assuming helper is here or in utils

// Define the table for items dropped in the world
#[spacetimedb::table(name = dropped_item, public)]
#[derive(Clone, Debug)]
pub struct DroppedItem {
    #[primary_key]
    #[auto_inc]
    pub id: u64,               // Unique ID for this dropped item instance
    pub item_def_id: u64,      // Links to ItemDefinition table
    pub quantity: u32,         // How many of this item are in the sack
    pub pos_x: f32,            // World X position
    pub pos_y: f32,            // World Y position
    pub chunk_index: u32,      // <<< ADDED chunk_index
    pub created_at: Timestamp, // When the item was dropped (for potential cleanup)
    pub item_data: Option<String>, // <<< ADDED: JSON data from original item (preserves water content, etc.)
}

// --- Schedule Table --- 
// Link reducer via scheduled(), remove public for now, ensure field is scheduled_at
#[spacetimedb::table(name = dropped_item_despawn_schedule, scheduled(despawn_expired_items))]
#[derive(Clone)]
pub struct DroppedItemDespawnSchedule {
    #[primary_key]
    #[auto_inc]
    pub id: u64, 
    pub scheduled_at: ScheduleAt, 
}

// Constants
const PICKUP_RADIUS: f32 = 64.0; // How close the player needs to be to pick up (adjust as needed)
const PICKUP_RADIUS_SQUARED: f32 = PICKUP_RADIUS * PICKUP_RADIUS;
pub(crate) const DROP_OFFSET: f32 = 40.0; // How far in front of the player to drop the item
const DESPAWN_CHECK_INTERVAL_SECS: u64 = 60; // Check every 1 minute

// --- Reducers ---

/// Called by the client when they attempt to pick up a dropped item.
#[spacetimedb::reducer]
pub fn pickup_dropped_item(ctx: &ReducerContext, dropped_item_id: u64) -> Result<(), String> {
    let sender_id = ctx.sender;
    let dropped_items_table = ctx.db.dropped_item();
    let players_table = ctx.db.player();
    let item_defs_table = ctx.db.item_definition(); // Needed for logging

    log::info!("[PickupDropped] Player {:?} attempting to pick up dropped item ID {}", sender_id, dropped_item_id);

    // 1. Find the Player
    let player = players_table.identity().find(sender_id)
        .ok_or_else(|| "Player not found.".to_string())?;

    // 2. Find the DroppedItem
    let dropped_item = dropped_items_table.id().find(dropped_item_id)
        .ok_or_else(|| format!("Dropped item with ID {} not found.", dropped_item_id))?;

    // 3. Check Proximity
    let distance_sq = get_distance_squared(player.position_x, player.position_y, dropped_item.pos_x, dropped_item.pos_y);

    if distance_sq > PICKUP_RADIUS_SQUARED {
         log::warn!("[PickupDropped] Player {:?} too far from item {} (DistSq: {:.1} > {:.1})",
                   sender_id, dropped_item_id, distance_sq, PICKUP_RADIUS_SQUARED);
        return Err("Too far away to pick up the item.".to_string());
    }

    // 4. Attempt to give item to player (inventory or drop near player if full)
    log::info!("[PickupDropped] Player {:?} is close enough. Attempting to give item def {} (qty {}).",
             sender_id, dropped_item.item_def_id, dropped_item.quantity);

    // Get item name for logging
    let item_name = item_defs_table.id().find(dropped_item.item_def_id)
                       .map(|def| def.name.clone())
                       .unwrap_or_else(|| format!("[Def ID {}]", dropped_item.item_def_id));

    // Use the new helper that handles full inventory by dropping near player, preserving item data
    match give_item_to_player_or_drop_with_data(ctx, sender_id, dropped_item.item_def_id, dropped_item.quantity, dropped_item.item_data.clone()) {
        Ok(added_to_inventory) => {
            // 5. Delete the original dropped item regardless of whether it went to inventory or was re-dropped
            dropped_items_table.id().delete(dropped_item_id);
            
            // Emit pickup sound at the dropped item's position
            crate::sound_events::emit_pickup_item_sound(ctx, dropped_item.pos_x, dropped_item.pos_y, sender_id);
            
            if added_to_inventory {
                log::info!("[PickupDropped] Successfully picked up item '{}' (ID {}) and added to inventory for player {:?}",
                         item_name, dropped_item_id, sender_id);
            } else {
                log::info!("[PickupDropped] Inventory full, moved item '{}' (ID {}) closer to player {:?}",
                         item_name, dropped_item_id, sender_id);
            }
            Ok(())
        }
        Err(e) => {
            // If both inventory and dropping failed, leave the original dropped item in the world
            log::error!("[PickupDropped] Failed to handle pickup for item {} '{}' for player {:?}: {}",
                      dropped_item_id, item_name, sender_id, e);
            Err(format!("Could not pick up item: {}", e))
        }
    }
}

// --- Scheduled Despawn Reducer ---

/// Scheduled reducer that runs periodically to remove expired dropped items.
// Add the reducer macro back
#[spacetimedb::reducer]
pub fn despawn_expired_items(ctx: &ReducerContext, _schedule: DroppedItemDespawnSchedule) -> Result<(), String> {
    let current_time = ctx.timestamp;
    let dropped_items_table = ctx.db.dropped_item();
    let item_defs_table = ctx.db.item_definition(); // <<< ADDED: Need ItemDefinition table
    let mut items_to_despawn: Vec<u64> = Vec::new();
    let mut despawn_count = 0;

    log::trace!("[DespawnCheck] Running scheduled check for expired dropped items at {:?}", current_time);

    for item in dropped_items_table.iter() {
        // --- Get respawn time from ItemDefinition --- 
        let item_def_respawn_seconds = match item_defs_table.id().find(item.item_def_id) {
            Some(def) => def.respawn_time_seconds.unwrap_or(300), // Default to 5 mins if not set
            None => {
                log::warn!("[DespawnCheck] ItemDefinition not found for dropped item ID {} (DefID {}). Using default despawn time.", item.id, item.item_def_id);
                300 // Default to 5 mins if definition is missing
            }
        };

        // Calculate elapsed time in microseconds
        let elapsed_micros = current_time.to_micros_since_unix_epoch()
                               .saturating_sub(item.created_at.to_micros_since_unix_epoch());
        // Ensure comparison is between i64
        let elapsed_seconds = (elapsed_micros / 1_000_000) as i64;

        if elapsed_seconds >= item_def_respawn_seconds as i64 { // <<< MODIFIED: Use item_def_respawn_seconds
            log::info!("[DespawnCheck] Despawning item ID {} (DefID {}, created at {:?}, elapsed: {}s, despawn_time: {}s)", 
                     item.id, item.item_def_id, item.created_at, elapsed_seconds, item_def_respawn_seconds);
            items_to_despawn.push(item.id);
        }
    }

    // Delete the expired items
    for item_id in items_to_despawn {
        if dropped_items_table.id().find(item_id).is_some() { // Check if still exists
            dropped_items_table.id().delete(item_id);
            despawn_count += 1;
        } else {
            log::warn!("[DespawnCheck] Tried to despawn item ID {}, but it was already gone.", item_id);
        }
    }

    if despawn_count > 0 {
        log::info!("[DespawnCheck] Despawned {} items.", despawn_count);
    }

    Ok(())
}

// --- Helper Functions (Internal to this module) ---

/// Attempts to give an item to a player's inventory. If the inventory is full or cannot stack,
/// creates a dropped item near the player instead.
/// Returns Ok(true) if added to inventory, Ok(false) if dropped near player, Err if failed completely.
pub(crate) fn give_item_to_player_or_drop(
    ctx: &ReducerContext,
    player_id: Identity,
    item_def_id: u64,
    quantity: u32,
) -> Result<bool, String> {
    give_item_to_player_or_drop_with_data(ctx, player_id, item_def_id, quantity, None)
}

/// Attempts to give an item to a player's inventory with preserved item data. If the inventory is full or cannot stack,
/// creates a dropped item near the player instead.
/// Returns Ok(true) if added to inventory, Ok(false) if dropped near player, Err if failed completely.
pub(crate) fn give_item_to_player_or_drop_with_data(
    ctx: &ReducerContext,
    player_id: Identity,
    item_def_id: u64,
    quantity: u32,
    item_data: Option<String>,
) -> Result<bool, String> {
    // First try to add to inventory with preserved data
    match add_item_to_player_inventory_with_data(ctx, player_id, item_def_id, quantity, item_data.clone()) {
        Ok(_) => {
            log::debug!("[GiveOrDrop] Successfully added item def {} (qty {}) to player {} inventory", 
                       item_def_id, quantity, player_id);
            Ok(true) // Successfully added to inventory
        }
        Err(inventory_error) => {
            log::info!("[GiveOrDrop] Failed to add to inventory ({}), creating dropped item near player {}", 
                      inventory_error, player_id);
            
            // Get player for drop position calculation
            let player = ctx.db.player().identity().find(player_id)
                .ok_or_else(|| format!("Player {} not found for drop calculation", player_id))?;
            
            // Calculate drop position near player
            let (drop_x, drop_y) = calculate_drop_position(&player);
            
            // Create dropped item near player with preserved data
            create_dropped_item_entity_with_data(ctx, item_def_id, quantity, drop_x, drop_y, item_data)?;
            
            log::info!("[GiveOrDrop] Created dropped item near player {} at ({:.1}, {:.1}) for item def {} (qty {})", 
                      player_id, drop_x, drop_y, item_def_id, quantity);
            
            Ok(false) // Item was dropped, not added to inventory
        }
    }
}

/// Creates a DroppedItem entity in the world.
/// Assumes validation (like position checks) might happen before calling this.
pub(crate) fn create_dropped_item_entity(
    ctx: &ReducerContext,
    item_def_id: u64,
    quantity: u32,
    pos_x: f32,
    pos_y: f32,
) -> Result<(), String> { // Changed return type to Result<(), String> as we don't need the entity back
    create_dropped_item_entity_with_data(ctx, item_def_id, quantity, pos_x, pos_y, None)
}

/// Creates a DroppedItem entity in the world with optional item data preservation.
/// Use this when dropping items that have special data (like water content).
pub(crate) fn create_dropped_item_entity_with_data(
    ctx: &ReducerContext,
    item_def_id: u64,
    quantity: u32,
    pos_x: f32,
    pos_y: f32,
    item_data: Option<String>,
) -> Result<(), String> {
    // --- ADD: Calculate chunk index ---
    let chunk_idx = calculate_chunk_index(pos_x, pos_y);
    // --- END ADD ---
     let new_dropped_item = DroppedItem {
        id: 0, // Auto-incremented
        item_def_id,
        quantity,
        pos_x,
        pos_y,
        chunk_index: chunk_idx, // <<< SET chunk_index
        created_at: ctx.timestamp,
        item_data, // <<< ADDED: Store the item data
    };

    match ctx.db.dropped_item().try_insert(new_dropped_item) {
        Ok(_) => {
            log::info!("[CreateDroppedItem] Created dropped item entity (DefID: {}, Qty: {}) at ({:.1}, {:.1})",
                     item_def_id, quantity, pos_x, pos_y);
            Ok(())
        },
        Err(e) => {
            log::error!("[CreateDroppedItem] Failed to insert dropped item: {}", e);
            Err(format!("Failed to create dropped item entity: {}", e))
        }
    }
}

/// Calculates a position slightly in front of the player based on their direction.
pub(crate) fn calculate_drop_position(player: &Player) -> (f32, f32) {
    let mut drop_x = player.position_x;
    let mut drop_y = player.position_y;

    match player.direction.as_str() {
        "up" => drop_y -= DROP_OFFSET,
        "down" => drop_y += DROP_OFFSET,
        "left" => drop_x -= DROP_OFFSET,
        "right" => drop_x += DROP_OFFSET,
        _ => drop_y += DROP_OFFSET, // Default to dropping below if direction is weird
    }

    // Basic boundary clamping (could add collision checks later if needed)
    // Using player radius as a buffer from the edge
    drop_x = drop_x.max(PLAYER_RADIUS).min(crate::WORLD_WIDTH_PX - PLAYER_RADIUS);
    drop_y = drop_y.max(PLAYER_RADIUS).min(crate::WORLD_HEIGHT_PX - PLAYER_RADIUS);

    (drop_x, drop_y)
}

// --- Init Helper (Called from lib.rs) ---
pub(crate) fn init_dropped_item_schedule(ctx: &ReducerContext) -> Result<(), String> {
    let schedule_table = ctx.db.dropped_item_despawn_schedule();
    if schedule_table.iter().count() == 0 {
        log::info!("Starting dropped item despawn schedule (every {}s).", DESPAWN_CHECK_INTERVAL_SECS);
        let interval = Duration::from_secs(DESPAWN_CHECK_INTERVAL_SECS);
        // Insert the schedule row (insert returns the row, not Result)
        schedule_table.insert(DroppedItemDespawnSchedule {
            id: 0, // Auto-incremented
            scheduled_at: ScheduleAt::Interval(interval.into()),
        });
    } else {
        log::debug!("Dropped item despawn schedule already exists.");
    }
    Ok(())
}

// --- Public API Functions for Other Modules ---

/// Public API for giving items to players with automatic dropping fallback.
/// This should be used by harvesting, crafting, and other systems that give items to players.
/// If the player's inventory is full, the item will be dropped near the player instead.
/// Returns Ok(true) if added to inventory, Ok(false) if dropped near player.
pub fn try_give_item_to_player(
    ctx: &ReducerContext,
    player_id: Identity,
    item_def_id: u64,
    quantity: u32,
) -> Result<bool, String> {
    give_item_to_player_or_drop(ctx, player_id, item_def_id, quantity)
}

/// Public API for giving items to players with item data preservation and automatic dropping fallback.
/// Use this when giving items that have special data (like water content).
/// Returns Ok(true) if added to inventory, Ok(false) if dropped near player.
pub fn try_give_item_to_player_with_data(
    ctx: &ReducerContext,
    player_id: Identity,
    item_def_id: u64,
    quantity: u32,
    item_data: Option<String>,
) -> Result<bool, String> {
    give_item_to_player_or_drop_with_data(ctx, player_id, item_def_id, quantity, item_data)
}