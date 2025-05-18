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
use crate::items::{add_item_to_player_inventory, InventoryItem, ItemDefinition};
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
// Ensure constant is i64
const DROPPED_ITEM_DESPAWN_DURATION_SECS: i64 = 300; // 5 minutes
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

    // 4. Attempt to add item to player inventory (using existing helper from items.rs)
    log::info!("[PickupDropped] Player {:?} is close enough. Attempting to add item def {} (qty {}) to inventory.",
             sender_id, dropped_item.item_def_id, dropped_item.quantity);

    // Call the helper function from the items module
    match crate::items::add_item_to_player_inventory(ctx, sender_id, dropped_item.item_def_id, dropped_item.quantity) {
        Ok(_) => {
            // 5. If successful, delete the dropped item entity
            dropped_items_table.id().delete(dropped_item_id);
            let item_name = item_defs_table.id().find(dropped_item.item_def_id)
                               .map(|def| def.name.clone())
                               .unwrap_or_else(|| format!("[Def ID {}]", dropped_item.item_def_id));
            log::info!("[PickupDropped] Successfully picked up item '{}' (ID {}) and added to inventory for player {:?}",
                     item_name, dropped_item_id, sender_id);
            Ok(())
        }
        Err(e) => {
            // If adding failed (e.g., inventory full), leave the dropped item in the world
            log::error!("[PickupDropped] Failed to add item {} to inventory for player {:?}: {}",
                      dropped_item_id, sender_id, e);
            Err(format!("Could not pick up item: {}", e)) // Propagate the error (e.g., "Inventory is full")
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
    let mut items_to_despawn: Vec<u64> = Vec::new();
    let mut despawn_count = 0;

    log::trace!("[DespawnCheck] Running scheduled check for expired dropped items at {:?}", current_time);

    for item in dropped_items_table.iter() {
        // Calculate elapsed time in microseconds
        let elapsed_micros = current_time.to_micros_since_unix_epoch()
                               .saturating_sub(item.created_at.to_micros_since_unix_epoch());
        // Ensure comparison is between i64
        let elapsed_seconds = (elapsed_micros / 1_000_000) as i64;

        if elapsed_seconds >= DROPPED_ITEM_DESPAWN_DURATION_SECS {
            log::info!("[DespawnCheck] Despawning item ID {} (created at {:?}, elapsed: {}s)", 
                     item.id, item.created_at, elapsed_seconds);
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

/// Creates a DroppedItem entity in the world.
/// Assumes validation (like position checks) might happen before calling this.
pub(crate) fn create_dropped_item_entity(
    ctx: &ReducerContext,
    item_def_id: u64,
    quantity: u32,
    pos_x: f32,
    pos_y: f32,
) -> Result<(), String> { // Changed return type to Result<(), String> as we don't need the entity back
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
