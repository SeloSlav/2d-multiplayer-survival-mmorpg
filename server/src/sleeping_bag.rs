/******************************************************************************
 *                                                                            *
 * Defines the SleepingBag entity, its data structure, and associated logic.  *
 * Handles placing the sleeping bag, interaction checks, and picking it up.   *
 *                                                                            *
 ******************************************************************************/

use spacetimedb::{Identity, ReducerContext, Table, Timestamp};
use log;

// --- Constants --- 
pub(crate) const SLEEPING_BAG_COLLISION_RADIUS: f32 = 18.0; // Width approx 36
pub(crate) const SLEEPING_BAG_COLLISION_Y_OFFSET: f32 = 5.0; // Low profile
pub(crate) const PLAYER_SLEEPING_BAG_COLLISION_DISTANCE_SQUARED: f32 = (super::PLAYER_RADIUS + SLEEPING_BAG_COLLISION_RADIUS) * (super::PLAYER_RADIUS + SLEEPING_BAG_COLLISION_RADIUS);
const SLEEPING_BAG_INTERACTION_DISTANCE_SQUARED: f32 = 64.0 * 64.0; // Same as box/campfire
pub(crate) const SLEEPING_BAG_SLEEPING_BAG_COLLISION_DISTANCE_SQUARED: f32 = (SLEEPING_BAG_COLLISION_RADIUS * 2.0) * (SLEEPING_BAG_COLLISION_RADIUS * 2.0);
const PLACEMENT_RANGE_SQ: f32 = 96.0 * 96.0; // Standard placement range

// --- Import Dependencies ---
use crate::environment::calculate_chunk_index;
use crate::sleeping_bag::sleeping_bag as SleepingBagTableTrait; // Import self trait
use crate::Player; // Import Player struct directly from crate root
use crate::player as PlayerTableTrait; // Import the trait for ctx.db.player()
use crate::items::{
    InventoryItem, ItemDefinition,
    inventory_item as InventoryItemTableTrait, 
    item_definition as ItemDefinitionTableTrait,
    add_item_to_player_inventory, // For pickup
};
// Remove Filter imports as they are gated behind unstable feature
// use spacetimedb::{client_visibility_filter, Filter}; 
// Add imports needed for inventory/item logic
use crate::active_equipment; 
use crate::crafting_queue;
use crate::models::{ItemLocation, EquipmentSlotType}; // Removed PlayerActivity

/// --- Sleeping Bag Data Structure ---
/// Represents a placed sleeping bag in the world.
#[spacetimedb::table(name = sleeping_bag, public)]
#[derive(Clone)]
pub struct SleepingBag {
    #[primary_key]
    #[auto_inc]
    pub id: u32, // Unique identifier

    pub pos_x: f32,
    pub pos_y: f32,
    pub chunk_index: u32, 

    pub placed_by: Identity, // Who placed this sleeping bag
    pub placed_at: Timestamp, // When it was placed
    // Add future fields here (e.g., is_occupied, owner_identity for respawn)

    // --- Destruction Fields ---
    pub health: f32,
    pub max_health: f32,
    pub is_destroyed: bool,
    pub destroyed_at: Option<Timestamp>,
    pub last_hit_time: Option<Timestamp>,
}

/// --- Row-Level Security Filter ---
/// Clients can only subscribe to sleeping bags they placed themselves.
// Temporarily disable the filter due to potential host stack overflow
// #[client_visibility_filter]
// const ONLY_OWNED_SLEEPING_BAGS: Filter = Filter::Sql("SELECT * FROM sleeping_bag WHERE placed_by = :sender");

/******************************************************************************
 *                                REDUCERS                                    *
 ******************************************************************************/

/// --- Place Sleeping Bag ---
/// Places a sleeping bag from the player's inventory into the world.
#[spacetimedb::reducer]
pub fn place_sleeping_bag(ctx: &ReducerContext, item_instance_id: u64, world_x: f32, world_y: f32) -> Result<(), String> {
    let sender_id = ctx.sender;
    let inventory_items = ctx.db.inventory_item();
    let item_defs = ctx.db.item_definition();
    let players = ctx.db.player();
    let sleeping_bags = ctx.db.sleeping_bag(); 

    log::info!(
        "[PlaceSleepingBag] Player {:?} attempting placement of item {} at ({:.1}, {:.1})",
        sender_id, item_instance_id, world_x, world_y
    );

    // 1. Find the 'Sleeping Bag' Item Definition ID
    let bag_def_id = item_defs.iter()
        .find(|def| def.name == "Sleeping Bag")
        .map(|def| def.id)
        .ok_or_else(|| "Sleeping Bag definition not found.".to_string())?;

    // 2. Find the specific item instance and validate
    let item_to_consume = inventory_items.instance_id().find(item_instance_id)
        .ok_or_else(|| format!("Item instance {} not found.", item_instance_id))?;
    
    // Validate ownership and location
    let is_owned_and_in_player_slots = match &item_to_consume.location {
        ItemLocation::Inventory(crate::models::InventoryLocationData { owner_id, .. }) => *owner_id == sender_id,
        ItemLocation::Hotbar(crate::models::HotbarLocationData { owner_id, .. }) => *owner_id == sender_id,
        _ => false,
    };

    if !is_owned_and_in_player_slots {
        return Err(format!(
            "Item instance {} must be in your inventory or hotbar to be placed. Location: {:?}", 
            item_instance_id, item_to_consume.location
        ));
    }

    if item_to_consume.item_def_id != bag_def_id {
        return Err(format!("Item instance {} is not a Sleeping Bag.", item_instance_id));
    }

    // 3. Validate Placement Distance
    if let Some(player) = players.identity().find(sender_id) {
        let dx = player.position_x - world_x;
        let dy = player.position_y - world_y;
        if (dx * dx + dy * dy) > PLACEMENT_RANGE_SQ {
            return Err("Placement location is too far away.".to_string());
        }
    } else {
        return Err("Could not find player data.".to_string());
    }

    // 4. Validate Collision with other Sleeping Bags
    for other_bag in sleeping_bags.iter() {
        let dx = world_x - other_bag.pos_x;
        let dy = world_y - other_bag.pos_y;
        if (dx * dx + dy * dy) < SLEEPING_BAG_SLEEPING_BAG_COLLISION_DISTANCE_SQUARED {
            return Err("Cannot place sleeping bag too close to another.".to_string());
        }
    }
    // TODO: Add collision checks against other entities if needed (trees, stones, boxes, etc.)

    // 5. Consume the Item
    log::info!(
        "[PlaceSleepingBag] Consuming item instance {} from player {:?}",
        item_instance_id, sender_id
    );
    inventory_items.instance_id().delete(item_instance_id);

    // 6. Create the SleepingBag Entity
    let chunk_idx = calculate_chunk_index(world_x, world_y);
    let new_bag = SleepingBag {
        id: 0, // Auto-incremented
        pos_x: world_x,
        pos_y: world_y,
        chunk_index: chunk_idx,
        placed_by: sender_id,
        placed_at: ctx.timestamp,
        // --- Destruction Fields Initialization ---
        health: 250.0,
        max_health: 250.0,
        is_destroyed: false,
        destroyed_at: None,
        last_hit_time: None,
    };
    sleeping_bags.insert(new_bag);

    log::info!(
        "[PlaceSleepingBag] Successfully placed Sleeping Bag at ({:.1}, {:.1}) by {:?}",
        world_x, world_y, sender_id
    );

    Ok(())
}

/// --- Respawn at Sleeping Bag ---
/// Allows a dead player to respawn at a sleeping bag they placed.
#[spacetimedb::reducer]
pub fn respawn_at_sleeping_bag(ctx: &ReducerContext, bag_id: u32) -> Result<(), String> {
    let sender_id = ctx.sender;
    let players = ctx.db.player();
    let sleeping_bags = ctx.db.sleeping_bag();
    let item_defs = ctx.db.item_definition();
    let inventory = ctx.db.inventory_item();

    log::info!(
        "[RespawnAtSleepingBag] Player {:?} attempting respawn at bag {}",
        sender_id, bag_id
    );

    // 1. Find Player and check if dead
    let mut player = players.identity().find(sender_id)
        .ok_or_else(|| "Player not found".to_string())?;

    if !player.is_dead {
        return Err("Player is not dead.".to_string());
    }

    // 2. Find Sleeping Bag
    let sleeping_bag = sleeping_bags.id().find(bag_id)
        .ok_or_else(|| format!("Sleeping Bag {} not found", bag_id))?;

    // 3. Verify Ownership
    if sleeping_bag.placed_by != sender_id {
        return Err("Cannot respawn at a sleeping bag you didn't place.".to_string());
    }

    log::info!(
        "Respawning player {} ({:?}) at sleeping bag {}. Clearing inventory and crafting queue...", 
        player.username, sender_id, bag_id
    );

    // --- Safeguard - Clear Player Inventory AGAIN ---
    let mut items_to_delete = Vec::new();
    for item in inventory.iter().filter(|item| {
        match &item.location {
            ItemLocation::Inventory(crate::models::InventoryLocationData { owner_id, .. }) => *owner_id == sender_id,
            ItemLocation::Hotbar(crate::models::HotbarLocationData { owner_id, .. }) => *owner_id == sender_id,
            ItemLocation::Equipped(crate::models::EquippedLocationData { owner_id, .. }) => *owner_id == sender_id,
            _ => false, // Only clear items directly associated with the player's active slots
        }
    }) {
        items_to_delete.push(item.instance_id);
    }
    let delete_count = items_to_delete.len();
    if delete_count > 0 {
        log::warn!("[Respawn Safeguard] Found {} items still associated with player {:?} during respawn at bag. Deleting them now.", delete_count, sender_id);
        for item_instance_id in items_to_delete {
            if !inventory.instance_id().delete(item_instance_id) {
                log::error!("[Respawn Safeguard] Failed to delete leftover item instance {} for player {:?}.", item_instance_id, sender_id);
            }
        }
    }
    // --- END Safeguard ---

    // --- Clear Crafting Queue & Refund ---
    crafting_queue::clear_player_crafting_queue(ctx, sender_id);

    // --- Grant Starting Rock ---
    log::info!("Granting starting Rock to respawned player: {}", player.username);
    if let Some(rock_def) = item_defs.iter().find(|def| def.name == "Rock") {
        let rock_location = ItemLocation::Hotbar(crate::models::HotbarLocationData { owner_id: sender_id, slot_index: 0 }); // Put rock in first hotbar slot
        match inventory.try_insert(crate::items::InventoryItem {
            instance_id: 0, // Auto-incremented
            item_def_id: rock_def.id,
            quantity: 1,
            location: rock_location,
        }) {
            Ok(_) => log::info!("Granted 1 Rock (slot 0) to player {}", player.username),
            Err(e) => log::error!("Failed to grant starting Rock to player {}: {}", player.username, e),
        }
    } else {
        log::error!("Could not find item definition for starting Rock!");
    }

    // --- Grant Starting Torch ---
    match item_defs.iter().find(|def| def.name == "Torch") {
        Some(torch_def) => {
            log::info!("Granting starting Torch to respawned player: {}", player.username);
            // Attempt to place in hotbar slot 1, or first available inventory slot otherwise
            let torch_location = ItemLocation::Hotbar(crate::models::HotbarLocationData { owner_id: sender_id, slot_index: 1 });
            match inventory.try_insert(crate::items::InventoryItem {
                instance_id: 0, // Auto-incremented
                item_def_id: torch_def.id,
                quantity: 1,
                location: torch_location, // Attempt hotbar slot 1
            }) {
                Ok(_) => log::info!("Granted 1 Torch (slot 1) to player {}", player.username),
                Err(_e) => {
                     log::warn!("Hotbar slot 1 occupied, granting Torch to general inventory for player {}.", player.username);
                     // Fallback to general inventory add if hotbar slot is taken or try_insert fails for other reasons
                     match add_item_to_player_inventory(ctx, sender_id, torch_def.id, 1) {
                        Ok(Some(new_torch_instance_id)) => {
                            log::info!("Granted 1 Torch (ID: {}) to player {} (inventory fallback).", new_torch_instance_id, player.username);
                        }
                        Ok(None) => {
                            log::error!("Failed to grant starting Torch to player {} (no slot found - inventory fallback).", player.username);
                        }
                        Err(e_inv) => {
                            log::error!("Error granting Torch to player {} (inventory fallback): {}", player.username, e_inv);
                        }
                    }
                }
            }
        }
        None => {
            log::error!("Item definition for 'Torch' not found. Cannot grant starting torch.");
        }
    }
    // --- End Grant Starting Torch ---

    // 4. Respawn Player at Bag Location (Reset stats)
    player.is_dead = false;
    player.health = crate::player_stats::PLAYER_MAX_HEALTH; // Use fully qualified path
    player.position_x = sleeping_bag.pos_x;
    player.position_y = sleeping_bag.pos_y;
    player.death_timestamp = None; // Clear death timestamp
    // Reset other stats like in respawn_randomly
    player.hunger = 250.0;
    player.thirst = 250.0;
    player.warmth = 100.0;
    player.stamina = 100.0;
    player.jump_start_time_ms = 0;
    player.is_sprinting = false;
    player.last_hit_time = None;
    player.is_torch_lit = false; // Ensure torch is unlit on respawn
    player.is_knocked_out = false; // Reset knocked out state
    player.knocked_out_at = None; // Clear knocked out timestamp
    player.direction = "down".to_string(); // Reset direction
    // Update timestamps
    player.last_update = ctx.timestamp;
    player.last_stat_update = ctx.timestamp;

    players.identity().update(player);

    // Ensure item is unequipped on respawn
    match crate::active_equipment::clear_active_item_reducer(ctx, sender_id) {
        Ok(_) => log::info!("Ensured active item is cleared for respawned player {:?}", sender_id),
        Err(e) => log::error!("Failed to clear active item for respawned player {:?}: {}", sender_id, e),
    }

    log::info!(
        "[RespawnAtSleepingBag] Player {:?} respawned successfully at bag {} ({:.1}, {:.1})",
        sender_id, bag_id, sleeping_bag.pos_x, sleeping_bag.pos_y
    );

    Ok(())
}

/// --- Interact with Sleeping Bag ---
/// Basic interaction check (currently just distance).
#[spacetimedb::reducer]
pub fn interact_with_sleeping_bag(ctx: &ReducerContext, bag_id: u32) -> Result<(), String> {
    validate_sleeping_bag_interaction(ctx, bag_id)?; // Use helper for validation
    log::debug!("Player {:?} interaction check OK for sleeping bag {}", ctx.sender, bag_id);
    // Currently no action on interact, but check succeeds if close enough.
    Ok(())
}

/******************************************************************************
 *                             HELPER FUNCTIONS                               *
 ******************************************************************************/

/// --- Validate Sleeping Bag Interaction ---
/// Checks if a player is close enough to interact with a specific sleeping bag.
fn validate_sleeping_bag_interaction(
    ctx: &ReducerContext,
    bag_id: u32,
) -> Result<(Player, SleepingBag), String> {
    let sender_id = ctx.sender;
    let players = ctx.db.player();
    let sleeping_bags = ctx.db.sleeping_bag();

    let player = players.identity().find(sender_id)
        .ok_or_else(|| "Player not found".to_string())?;
    let sleeping_bag = sleeping_bags.id().find(bag_id)
        .ok_or_else(|| format!("Sleeping Bag {} not found", bag_id))?;

    if sleeping_bag.is_destroyed {
        return Err(format!("Sleeping Bag {} is destroyed.", bag_id));
    }

    // Check distance
    let dx = player.position_x - sleeping_bag.pos_x;
    let dy = player.position_y - sleeping_bag.pos_y;
    if (dx * dx + dy * dy) > SLEEPING_BAG_INTERACTION_DISTANCE_SQUARED {
        return Err("Too far away".to_string());
    }
    Ok((player, sleeping_bag))
}