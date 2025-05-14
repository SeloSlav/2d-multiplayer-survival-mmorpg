/******************************************************************************
 *                                                                            *
 * Defines the WoodenStorageBox entity, its data structure, and associated    *
 * logic. Handles interactions like placing the box, adding/removing items,   *
 * splitting stacks, and managing items within the box's slots.               *
 * Uses generic handlers from inventory_management.rs where applicable.       *
 *                                                                            *
 ******************************************************************************/

use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table};
use log;

// --- Constants --- 
pub(crate) const BOX_COLLISION_RADIUS: f32 = 18.0; // Similar to campfire
pub(crate) const BOX_COLLISION_Y_OFFSET: f32 = 10.0; // Similar to campfire
pub(crate) const PLAYER_BOX_COLLISION_DISTANCE_SQUARED: f32 = (super::PLAYER_RADIUS + BOX_COLLISION_RADIUS) * (super::PLAYER_RADIUS + BOX_COLLISION_RADIUS);
const BOX_INTERACTION_DISTANCE_SQUARED: f32 = 64.0 * 64.0; // Similar to campfire interaction
pub const NUM_BOX_SLOTS: usize = 18;
pub(crate) const BOX_BOX_COLLISION_DISTANCE_SQUARED: f32 = (BOX_COLLISION_RADIUS * 2.0) * (BOX_COLLISION_RADIUS * 2.0);

// --- Import Table Traits and Concrete Types ---
// Import necessary table traits and concrete types for working with players,
// items, inventory management, and environment calculations
use crate::player as PlayerTableTrait;
use crate::Player;
use crate::items::{
    InventoryItem, ItemDefinition,
    inventory_item as InventoryItemTableTrait, 
    item_definition as ItemDefinitionTableTrait,
    add_item_to_player_inventory
};
use crate::inventory_management::{self, ItemContainer, ContainerItemClearer, merge_or_place_into_container_slot};
use crate::wooden_storage_box::wooden_storage_box as WoodenStorageBoxTableTrait;
use crate::environment::calculate_chunk_index;
use crate::models::{ContainerType, ItemLocation, InventoryLocationData, HotbarLocationData, DroppedLocationData, EquippedLocationData, ContainerLocationData};
use crate::player_inventory::{find_first_empty_player_slot, move_item_to_inventory, move_item_to_hotbar, get_player_item};

/// --- Wooden Storage Box Data Structure ---
/// Represents a storage box in the game world with position, owner, and
/// inventory slots (using individual fields instead of arrays).
/// Provides 18 slots for storing items that players can access when nearby.
#[spacetimedb::table(name = wooden_storage_box, public)]
#[derive(Clone)]
pub struct WoodenStorageBox {
    #[primary_key]
    #[auto_inc]
    pub id: u32, // Unique identifier for this storage box instance

    pub pos_x: f32,
    pub pos_y: f32,
    pub chunk_index: u32, // <<< ADDED chunk_index

    pub placed_by: Identity, // Who placed this storage box

    // --- Inventory Slots (0-17) --- 
    pub slot_instance_id_0: Option<u64>,
    pub slot_def_id_0: Option<u64>,
    pub slot_instance_id_1: Option<u64>,
    pub slot_def_id_1: Option<u64>,
    pub slot_instance_id_2: Option<u64>,
    pub slot_def_id_2: Option<u64>,
    pub slot_instance_id_3: Option<u64>,
    pub slot_def_id_3: Option<u64>,
    pub slot_instance_id_4: Option<u64>,
    pub slot_def_id_4: Option<u64>,
    pub slot_instance_id_5: Option<u64>,
    pub slot_def_id_5: Option<u64>,
    pub slot_instance_id_6: Option<u64>,
    pub slot_def_id_6: Option<u64>,
    pub slot_instance_id_7: Option<u64>,
    pub slot_def_id_7: Option<u64>,
    pub slot_instance_id_8: Option<u64>,
    pub slot_def_id_8: Option<u64>,
    pub slot_instance_id_9: Option<u64>,
    pub slot_def_id_9: Option<u64>,
    pub slot_instance_id_10: Option<u64>,
    pub slot_def_id_10: Option<u64>,
    pub slot_instance_id_11: Option<u64>,
    pub slot_def_id_11: Option<u64>,
    pub slot_instance_id_12: Option<u64>,
    pub slot_def_id_12: Option<u64>,
    pub slot_instance_id_13: Option<u64>,
    pub slot_def_id_13: Option<u64>,
    pub slot_instance_id_14: Option<u64>,
    pub slot_def_id_14: Option<u64>,
    pub slot_instance_id_15: Option<u64>,
    pub slot_def_id_15: Option<u64>,
    pub slot_instance_id_16: Option<u64>,
    pub slot_def_id_16: Option<u64>,
    pub slot_instance_id_17: Option<u64>,
    pub slot_def_id_17: Option<u64>,
}

/******************************************************************************
 *                           REDUCERS (Generic Handlers)                        *
 ******************************************************************************/

/// --- Move Item to Storage Box ---
/// Moves an item from the player's inventory/hotbar INTO a specified slot in the storage box.
/// Uses the generic handler from inventory_management.rs to perform the move operation.
/// The handler validates the item, checks slot availability, and handles stacking logic.
#[spacetimedb::reducer]
pub fn move_item_to_box(
    ctx: &ReducerContext, 
    box_id: u32, 
    target_slot_index: u8, 
    item_instance_id: u64 // Pass ID directly
) -> Result<(), String> {
    // Get mutable box table handle
    let mut boxes = ctx.db.wooden_storage_box();
    // NOTE: Other tables (inventory, item_defs) are accessed within the handler via ctx

    // --- Basic Validations --- 
    let (_player, mut storage_box) = validate_box_interaction(ctx, box_id)?;
    // REMOVED: Item fetching/validation moved to handler
    // REMOVED: Target slot index validation moved to handler (using container.num_slots())

    // --- Call GENERIC Handler --- 
    inventory_management::handle_move_to_container_slot(
        ctx, 
        &mut storage_box, 
        target_slot_index, 
        item_instance_id // Pass the ID
        // REMOVED item references
    )?;

    // --- Commit Box Update --- 
    boxes.id().update(storage_box);
    Ok(())
}

/// --- Move Item from Storage Box ---
/// Moves an item FROM a storage box slot INTO the player's inventory/hotbar.
/// Uses the generic handler from inventory_management.rs to perform the move operation.
/// The handler validates the item, checks slot availability, and handles stacking logic.
#[spacetimedb::reducer]
pub fn move_item_from_box(
    ctx: &ReducerContext, 
    box_id: u32, 
    source_slot_index: u8,
    target_slot_type: String, // NEW: "inventory" or "hotbar"
    target_slot_index: u32    // NEW: Index within inventory or hotbar
) -> Result<(), String> {
    // Get mutable box table handle
    let mut boxes = ctx.db.wooden_storage_box();

    // --- Validations --- 
    let (_player, mut storage_box) = validate_box_interaction(ctx, box_id)?;
    // NOTE: Basic distance/existence checked by validate_box_interaction
    // NOTE: Item details, slot checks, target validation now handled by inventory_management handler

    // --- Call Handler to attempt move to player inventory FIRST --- 
    inventory_management::handle_move_from_container_slot(
        ctx, 
        &mut storage_box, // Pass mutably, handler will clear slot on success
        source_slot_index,
        target_slot_type, // Pass through
        target_slot_index // Pass through
    )?;
    // ^ If this returns Ok, it means the move/merge/swap into the player slot succeeded.

    // --- Commit Box Update --- 
    // The handler modified storage_box (cleared the slot) if the move was successful.
    boxes.id().update(storage_box);
    Ok(())
}

/// Moves an item BETWEEN two slots within the same storage box.
#[spacetimedb::reducer]
pub fn move_item_within_box(
    ctx: &ReducerContext,
    box_id: u32,
    source_slot_index: u8,
    target_slot_index: u8,
) -> Result<(), String> {
    // Get mutable box table handle
    let mut boxes = ctx.db.wooden_storage_box();
    // NOTE: Other tables accessed in handler via ctx

    // --- Basic Validations --- 
    let (_player, mut storage_box) = validate_box_interaction(ctx, box_id)?;
    // REMOVED: Item fetching/validation moved to handler
    // NOTE: Slot index validation moved to handler

    // --- Call GENERIC Handler --- 
    inventory_management::handle_move_within_container(
        ctx, 
        &mut storage_box, 
        source_slot_index, 
        target_slot_index
        // Removed table args
    )?;

    // --- Commit Box Update --- 
    boxes.id().update(storage_box);
    Ok(())
}

/// --- Split Stack Into Box ---
/// Splits a stack from player inventory/hotbar into a specific box slot.
/// Validates the box interaction and source item, then uses the generic container handler
/// to split the stack and move the specified quantity to the box.
#[spacetimedb::reducer]
pub fn split_stack_into_box(
    ctx: &ReducerContext,
    box_id: u32,
    target_slot_index: u8,
    source_item_instance_id: u64,
    quantity_to_split: u32,
) -> Result<(), String> {
    let mut boxes = ctx.db.wooden_storage_box();
    let (_player, mut storage_box) = validate_box_interaction(ctx, box_id)?;
    
    // The handler will fetch the source_item, validate its location/ownership, quantity, and stackability.
    inventory_management::handle_split_into_container(
        ctx, 
        &mut storage_box, 
        target_slot_index, 
        source_item_instance_id, 
        quantity_to_split
    )?;

    boxes.id().update(storage_box);
    Ok(())
}

/// --- Split Stack From Box ---
/// Splits a stack from a box slot into the player's inventory/hotbar.
/// Validates the box interaction, then uses the generic container handler
/// to split the stack and move the specified quantity to the player's inventory.
#[spacetimedb::reducer]
pub fn split_stack_from_box(
    ctx: &ReducerContext,
    box_id: u32,
    source_slot_index: u8,
    quantity_to_split: u32,
    target_slot_type: String, 
    target_slot_index: u32,   
) -> Result<(), String> {
    let mut boxes = ctx.db.wooden_storage_box();
    let (_player, mut storage_box) = validate_box_interaction(ctx, box_id)?;
    
    inventory_management::handle_split_from_container(
        ctx, 
        &mut storage_box, 
        source_slot_index, 
        quantity_to_split,
        target_slot_type, 
        target_slot_index
    )?;
    
    boxes.id().update(storage_box);
    Ok(())
}

/// --- Split Stack Within Box ---
/// Splits a stack FROM one box slot TO another within the same box.
/// Validates the box interaction, then uses the generic container handler
/// to split the stack and move the specified quantity to the target slot.
#[spacetimedb::reducer]
pub fn split_stack_within_box(
    ctx: &ReducerContext,
    box_id: u32,
    source_slot_index: u8,
    target_slot_index: u8,
    quantity_to_split: u32,
) -> Result<(), String> {
    // Get tables
    let mut boxes = ctx.db.wooden_storage_box();
    // NOTE: Other tables accessed in handler

    // --- Validations --- 
    let (_player, mut storage_box) = validate_box_interaction(ctx, box_id)?;
    // REMOVED: Item fetching/validation moved to handler
    // NOTE: Slot index/target empty validation moved to handler

    // --- Call GENERIC Handler ---
    inventory_management::handle_split_within_container(
        ctx,
        &mut storage_box,
        source_slot_index,
        target_slot_index,
        quantity_to_split
    )?;

    // --- Commit Box Update --- 
    boxes.id().update(storage_box);
    Ok(())
}

/// --- Quick Move From Box ---
/// Quickly moves an item FROM a box slot TO the player inventory.
/// Validates the box interaction, then uses the generic container handler
/// to move the item to the player's inventory.
#[spacetimedb::reducer]
pub fn quick_move_from_box(
    ctx: &ReducerContext, 
    box_id: u32, 
    source_slot_index: u8
) -> Result<(), String> {
    // Get mutable box table handle
    let mut boxes = ctx.db.wooden_storage_box();

    // --- Basic Validations --- 
    let (_player, mut storage_box) = validate_box_interaction(ctx, box_id)?;
    // REMOVED: Item fetching/slot empty validation moved to handler

    // --- Call Handler --- 
    inventory_management::handle_quick_move_from_container(
        ctx, 
        &mut storage_box, 
        source_slot_index
    )?;

    // --- Commit Box Update --- 
    boxes.id().update(storage_box);
    Ok(())
}

/// Quickly moves an item FROM player inventory/hotbar TO the first available/mergeable slot in the box.
#[spacetimedb::reducer]
pub fn quick_move_to_box(
    ctx: &ReducerContext, 
    box_id: u32, 
    item_instance_id: u64 // Pass ID directly
) -> Result<(), String> {
    // Get tables
    let mut boxes = ctx.db.wooden_storage_box();
    // NOTE: Other tables accessed in handler via ctx

    // --- Validations --- 
    let (_player, mut storage_box) = validate_box_interaction(ctx, box_id)?;
    // REMOVED: Item fetching/validation moved to handler

    // --- Call Handler --- 
    inventory_management::handle_quick_move_to_container(
        ctx, 
        &mut storage_box, 
        item_instance_id // Pass the ID
        // REMOVED item references
    )?;

    // --- Commit Box Update --- 
    boxes.id().update(storage_box);
    Ok(())
}

/******************************************************************************
 *                         REDUCERS (Box-Specific Logic)                      *
 ******************************************************************************/

/// --- Place Wooden Storage Box ---
/// Places a wooden storage box from the player's inventory into the world at specified coordinates.
/// Validates item ownership, type, and placement distance before consuming the item and creating
/// the storage box entity. Uses the generic container system for item management.
#[spacetimedb::reducer]
pub fn place_wooden_storage_box(ctx: &ReducerContext, item_instance_id: u64, world_x: f32, world_y: f32) -> Result<(), String> {
    let sender_id = ctx.sender;
    let mut inventory_items = ctx.db.inventory_item();
    let item_defs = ctx.db.item_definition();
    let mut boxes = ctx.db.wooden_storage_box();
    let players = ctx.db.player();

    log::info!("Player {:?} attempting to place wooden storage box (item instance {}) at ({}, {}).", sender_id, item_instance_id, world_x, world_y);

    // 1. Validate Player
    let player = players.identity().find(sender_id)
        .ok_or_else(|| "Player not found.".to_string())?;

    // 2. Validate Item to be Placed ---
    // Get the item definition to ensure it's a placeable box
    let mut item_to_place = get_player_item(ctx, item_instance_id)?;
    let item_def = item_defs.id().find(item_to_place.item_def_id)
        .ok_or_else(|| format!("Item definition {} not found for item instance {}.", item_to_place.item_def_id, item_instance_id))?;

    // Check if the item is a Wooden Storage Box and is in player's inventory/hotbar
    if item_def.name != "Wooden Storage Box" {
        return Err("Item is not a Wooden Storage Box.".to_string());
    }

    match &item_to_place.location { 
        ItemLocation::Inventory(data) => {
            if data.owner_id != sender_id {
                return Err("Item to place storage box not owned by player or not in direct possession.".to_string());
            }
        }
        ItemLocation::Hotbar(data) => {
            if data.owner_id != sender_id {
                return Err("Item to place storage box not owned by player or not in direct possession.".to_string());
            }
        }
        _ => return Err("Wooden Storage Box must be in inventory or hotbar to be placed.".to_string()),
    }

    // 3. Validate Placement Location (Collision Checks)
    let new_chunk_index = calculate_chunk_index(world_x, world_y);
    if boxes.iter().any(|b| {
        let dist_sq = (b.pos_x - world_x).powi(2) + (b.pos_y - world_y).powi(2);
        dist_sq < BOX_BOX_COLLISION_DISTANCE_SQUARED
    }) {
        return Err("Too close to another storage box.".to_string());
    }
    // Add other collision checks as needed (e.g., with players, other entities)

    // 4. Create the WoodenStorageBox entity
    let new_box = WoodenStorageBox {
        id: 0, // Auto-incremented
        pos_x: world_x,
        pos_y: world_y,
        chunk_index: new_chunk_index,
        placed_by: sender_id,
        slot_instance_id_0: None, slot_def_id_0: None,
        slot_instance_id_1: None, slot_def_id_1: None,
        slot_instance_id_2: None, slot_def_id_2: None,
        slot_instance_id_3: None, slot_def_id_3: None,
        slot_instance_id_4: None, slot_def_id_4: None,
        slot_instance_id_5: None, slot_def_id_5: None,
        slot_instance_id_6: None, slot_def_id_6: None,
        slot_instance_id_7: None, slot_def_id_7: None,
        slot_instance_id_8: None, slot_def_id_8: None,
        slot_instance_id_9: None, slot_def_id_9: None,
        slot_instance_id_10: None, slot_def_id_10: None,
        slot_instance_id_11: None, slot_def_id_11: None,
        slot_instance_id_12: None, slot_def_id_12: None,
        slot_instance_id_13: None, slot_def_id_13: None,
        slot_instance_id_14: None, slot_def_id_14: None,
        slot_instance_id_15: None, slot_def_id_15: None,
        slot_instance_id_16: None, slot_def_id_16: None,
        slot_instance_id_17: None, slot_def_id_17: None,
    };
    let inserted_box = boxes.insert(new_box);
    log::info!("Player {:?} placed new Wooden Storage Box with ID {}.
Location: {:?}", sender_id, inserted_box.id, item_to_place.location);


    // 5. Consume the item from player's inventory
    if item_to_place.quantity > 1 {
        item_to_place.quantity -= 1;
        inventory_items.instance_id().update(item_to_place);
    } else {
        inventory_items.instance_id().delete(item_instance_id);
    }
    
    log::info!("Wooden Storage Box (item instance {}) consumed from player {:?} inventory after placement.", item_instance_id, sender_id);

    Ok(())
}

/// --- Interact with Storage Box ---
/// Allows a player to interact with a storage box if they are close enough.
/// Uses the helper function for validation before proceeding.
#[spacetimedb::reducer]
pub fn interact_with_storage_box(ctx: &ReducerContext, box_id: u32) -> Result<(), String> {
    validate_box_interaction(ctx, box_id)?; // Use helper for validation
    log::debug!("Player {:?} interaction check OK for box {}", ctx.sender, box_id);
    Ok(())
}

/// --- Pickup Storage Box ---
/// Allows a player to pick up an *empty* storage box, returning it to their inventory.
#[spacetimedb::reducer]
pub fn pickup_storage_box(ctx: &ReducerContext, box_id: u32) -> Result<(), String> {
    let sender_id = ctx.sender;
    let mut boxes_table = ctx.db.wooden_storage_box();
    let item_defs_table = ctx.db.item_definition();
    // inventory_items_table is not needed if the box must be empty

    log::info!("Player {:?} attempting to pick up storage box {}.", sender_id, box_id);

    // 1. Validate Interaction
    let (_player, storage_box_to_pickup) = validate_box_interaction(ctx, box_id)?;
    // Optional: Add ownership check if only the placer can pick it up:
    // if storage_box_to_pickup.placed_by != sender_id {
    //     return Err("You did not place this storage box.".to_string());
    // }

    // 2. Check if the box is empty
    for i in 0..NUM_BOX_SLOTS {
        if storage_box_to_pickup.get_slot_instance_id(i as u8).is_some() {
            return Err("Cannot pick up storage box: It is not empty.".to_string());
        }
    }

    // 3. Find the ItemDefinition for "Wooden Storage Box"
    let box_item_def = item_defs_table.iter()
        .find(|def| def.name == "Wooden Storage Box")
        .ok_or_else(|| "ItemDefinition for 'Wooden Storage Box' not found. Cannot give item back.".to_string())?;

    // 4. Give the player back one "Wooden Storage Box" item
    // The add_item_to_player_inventory function will handle finding a slot or stacking.
    match add_item_to_player_inventory(ctx, sender_id, box_item_def.id, 1) {
        Ok(_) => log::info!("Added 'Wooden Storage Box' item to player {:?} inventory.", sender_id),
        Err(e) => {
            log::error!("Failed to give 'Wooden Storage Box' item to player {:?}: {}. Box not deleted.", sender_id, e);
            return Err(format!("Could not add Wooden Storage Box to your inventory: {}", e));
        }
    }

    // 5. Delete the WoodenStorageBox entity from the world
    boxes_table.id().delete(box_id);
    log::info!("Storage box {} picked up and removed from world by player {:?}.", box_id, sender_id);

    Ok(())
}

#[spacetimedb::reducer]
pub fn drop_item_from_box_slot_to_world(
    ctx: &ReducerContext,
    box_id: u32,
    slot_index: u8,
) -> Result<(), String> {
    let sender_id = ctx.sender;
    let player_table = ctx.db.player();
    let mut wooden_box_table = ctx.db.wooden_storage_box();

    log::info!("[DropFromBoxToWorld] Player {} attempting to drop item from box ID {}, slot index {}.", sender_id, box_id, slot_index);

    // 1. Get Player (for drop position calculation and permission, though permission is implicit by calling)
    let player = player_table.identity().find(sender_id)
        .ok_or_else(|| format!("Player {} not found.", sender_id))?;

    // 2. Get WoodenStorageBox
    // Use validate_box_interaction to also check distance
    let (_player_for_validation, mut wooden_box) = validate_box_interaction(ctx, box_id)?;
    // We refetch player here specifically for the drop location, 
    // as validate_box_interaction returns a potentially different instance.
    let player_for_drop_location = player_table.identity().find(sender_id)
        .ok_or_else(|| format!("Player {} not found for drop location.", sender_id))?;

    // 3. Call the generic handler from inventory_management
    // The handler will modify wooden_box (clear slot) and create dropped item, delete inventory_item.
    crate::inventory_management::handle_drop_from_container_slot(ctx, &mut wooden_box, slot_index, &player_for_drop_location)?;

    // 4. Persist changes to the WoodenStorageBox
    wooden_box_table.id().update(wooden_box);
    log::info!("[DropFromBoxToWorld] Successfully dropped item from box {}, slot {}. Box updated.", box_id, slot_index);

    Ok(())
}

#[spacetimedb::reducer]
pub fn split_and_drop_item_from_box_slot_to_world(
    ctx: &ReducerContext,
    box_id: u32,
    slot_index: u8,
    quantity_to_split: u32,
) -> Result<(), String> {
    let sender_id = ctx.sender;
    let player_table = ctx.db.player();
    let mut wooden_box_table = ctx.db.wooden_storage_box();

    log::info!("[SplitDropFromBoxToWorld] Player {} attempting to split {} from box ID {}, slot {}.", 
             sender_id, quantity_to_split, box_id, slot_index);

    // 1. Get Player (for drop position calculation and permission)
    // Use validate_box_interaction to also check distance
    let (_player_for_validation, mut wooden_box) = validate_box_interaction(ctx, box_id)?;
    // Refetch player for drop location
    let player_for_drop_location = player_table.identity().find(sender_id)
        .ok_or_else(|| format!("Player {} not found for drop location.", sender_id))?;


    // 3. Call the generic handler from inventory_management
    crate::inventory_management::handle_split_and_drop_from_container_slot(ctx, &mut wooden_box, slot_index, quantity_to_split, &player_for_drop_location)?;

    // 4. Persist changes to the WoodenStorageBox (if its slot was cleared because the whole stack was dropped)
    wooden_box_table.id().update(wooden_box); 

    log::info!("[SplitDropFromBoxToWorld] Successfully split and dropped from box {}, slot {}. Box updated if slot cleared.", box_id, slot_index);
    
    Ok(())
}

/******************************************************************************
 *                            TRAIT IMPLEMENTATIONS                           *
 ******************************************************************************/

/// --- ItemContainer Implementation for WoodenStorageBox ---
/// Implements the ItemContainer trait for the WoodenStorageBox struct.
/// Provides methods to get the number of slots and access individual slots.
impl ItemContainer for WoodenStorageBox {
    fn num_slots(&self) -> usize {
        NUM_BOX_SLOTS
    }

    /// --- Get Slot Instance ID ---
    /// Returns the instance ID for a given slot index.
    /// Returns None if the slot index is out of bounds.
    fn get_slot_instance_id(&self, slot_index: u8) -> Option<u64> {
        match slot_index {
            0 => self.slot_instance_id_0,
            1 => self.slot_instance_id_1,
            2 => self.slot_instance_id_2,
            3 => self.slot_instance_id_3,
            4 => self.slot_instance_id_4,
            5 => self.slot_instance_id_5,
            6 => self.slot_instance_id_6,
            7 => self.slot_instance_id_7,
            8 => self.slot_instance_id_8,
            9 => self.slot_instance_id_9,
            10 => self.slot_instance_id_10,
            11 => self.slot_instance_id_11,
            12 => self.slot_instance_id_12,
            13 => self.slot_instance_id_13,
            14 => self.slot_instance_id_14,
            15 => self.slot_instance_id_15,
            16 => self.slot_instance_id_16,
            17 => self.slot_instance_id_17,
            _ => None,
        }
    }

    /// --- Get Slot Definition ID ---
    /// Returns the definition ID for a given slot index.
    /// Returns None if the slot index is out of bounds.
    fn get_slot_def_id(&self, slot_index: u8) -> Option<u64> {
        match slot_index {
            0 => self.slot_def_id_0,
            1 => self.slot_def_id_1,
            2 => self.slot_def_id_2,
            3 => self.slot_def_id_3,
            4 => self.slot_def_id_4,
            5 => self.slot_def_id_5,
            6 => self.slot_def_id_6,
            7 => self.slot_def_id_7,
            8 => self.slot_def_id_8,
            9 => self.slot_def_id_9,
            10 => self.slot_def_id_10,
            11 => self.slot_def_id_11,
            12 => self.slot_def_id_12,
            13 => self.slot_def_id_13,
            14 => self.slot_def_id_14,
            15 => self.slot_def_id_15,
            16 => self.slot_def_id_16,
            17 => self.slot_def_id_17,
            _ => None,
        }
    }

    /// --- Set Slot ---
    /// Sets the item instance ID and definition ID for a given slot index. 
    /// Returns None if the slot index is out of bounds.
    fn set_slot(&mut self, slot_index: u8, instance_id: Option<u64>, def_id: Option<u64>) {
        match slot_index {
            0 => { self.slot_instance_id_0 = instance_id; self.slot_def_id_0 = def_id; }
            1 => { self.slot_instance_id_1 = instance_id; self.slot_def_id_1 = def_id; }
            2 => { self.slot_instance_id_2 = instance_id; self.slot_def_id_2 = def_id; }
            3 => { self.slot_instance_id_3 = instance_id; self.slot_def_id_3 = def_id; }
            4 => { self.slot_instance_id_4 = instance_id; self.slot_def_id_4 = def_id; }
            5 => { self.slot_instance_id_5 = instance_id; self.slot_def_id_5 = def_id; }
            6 => { self.slot_instance_id_6 = instance_id; self.slot_def_id_6 = def_id; }
            7 => { self.slot_instance_id_7 = instance_id; self.slot_def_id_7 = def_id; }
            8 => { self.slot_instance_id_8 = instance_id; self.slot_def_id_8 = def_id; }
            9 => { self.slot_instance_id_9 = instance_id; self.slot_def_id_9 = def_id; }
            10 => { self.slot_instance_id_10 = instance_id; self.slot_def_id_10 = def_id; }
            11 => { self.slot_instance_id_11 = instance_id; self.slot_def_id_11 = def_id; }
            12 => { self.slot_instance_id_12 = instance_id; self.slot_def_id_12 = def_id; }
            13 => { self.slot_instance_id_13 = instance_id; self.slot_def_id_13 = def_id; }
            14 => { self.slot_instance_id_14 = instance_id; self.slot_def_id_14 = def_id; }
            15 => { self.slot_instance_id_15 = instance_id; self.slot_def_id_15 = def_id; }
            16 => { self.slot_instance_id_16 = instance_id; self.slot_def_id_16 = def_id; }
            17 => { self.slot_instance_id_17 = instance_id; self.slot_def_id_17 = def_id; }
            _ => { log::error!("[WoodenStorageBox] Attempted to set invalid slot index: {}", slot_index); }
        }
    }

    // --- NEW Methods for ItemLocation Refactor ---
    fn get_container_type(&self) -> crate::models::ContainerType {
        ContainerType::WoodenStorageBox
    }

    fn get_container_id(&self) -> u64 {
        self.id as u64
    }
}

/// --- Helper struct to implement the ContainerItemClearer trait for WoodenStorageBox ---
/// Implements the ContainerItemClearer trait for the WoodenStorageBox struct.
/// Provides a method to clear an item from all boxes.
pub struct WoodenStorageBoxClearer;

impl ContainerItemClearer for WoodenStorageBoxClearer {
    fn clear_item(ctx: &ReducerContext, item_instance_id: u64) -> bool {
        let mut boxes = ctx.db.wooden_storage_box();
        let inventory_items = ctx.db.inventory_item(); 
        let mut box_updated = false;
        let mut box_to_update: Option<WoodenStorageBox> = None; 

        for current_box in boxes.iter() {
            let mut temp_box = current_box.clone(); 
            let mut found_in_this_box = false;
            
            for i in 0..temp_box.num_slots() as u8 {
                if temp_box.get_slot_instance_id(i) == Some(item_instance_id) {
                    log::debug!("[WoodenStorageBoxClearer] Found item {} in box {} slot {}. Clearing slot and updating item location.", item_instance_id, temp_box.id, i);
                    temp_box.set_slot(i, None, None); 
                    found_in_this_box = true;
                    box_to_update = Some(temp_box.clone()); 
                    break;
                }
            }

            if found_in_this_box {
                if let Some(mut item_to_update) = inventory_items.instance_id().find(item_instance_id) {
                    item_to_update.location = ItemLocation::Unknown;
                    inventory_items.instance_id().update(item_to_update);
                }
                box_updated = true;
                break; 
            }
        }
        if let Some(b) = box_to_update {
            boxes.id().update(b);
        }
        box_updated
    }
}

/******************************************************************************
 *                             HELPER FUNCTIONS                               *
 ******************************************************************************/

/// --- Validate Box Interaction ---
/// Validates if a player can interact with a specific box (checks existence and distance).
/// Returns Ok((Player struct instance, WoodenStorageBox struct instance)) on success, or Err(String) on failure.
/// Does NOT check ownership.
fn validate_box_interaction(
    ctx: &ReducerContext,
    box_id: u32,
) -> Result<(Player, WoodenStorageBox), String> { // Use corrected Player type
    let sender_id = ctx.sender;
    let players = ctx.db.player();
    let boxes = ctx.db.wooden_storage_box();

    let player = players.identity().find(sender_id).ok_or_else(|| "Player not found".to_string())?;
    let storage_box = boxes.id().find(box_id).ok_or_else(|| format!("Storage Box {} not found", box_id))?;

    // Check distance between the interacting player and the box
    let dx = player.position_x - storage_box.pos_x;
    let dy = player.position_y - storage_box.pos_y;
    if (dx * dx + dy * dy) > BOX_INTERACTION_DISTANCE_SQUARED {
        return Err("Too far away".to_string());
    }
    Ok((player, storage_box))
}