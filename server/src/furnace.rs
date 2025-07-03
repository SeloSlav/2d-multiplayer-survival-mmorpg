/******************************************************************************
 *                                                                            *
 * Defines the Furnace entity, its data structure, and associated logic.     *
 * Handles interactions like adding/removing fuel, lighting/extinguishing,    *
 * fuel consumption checks, and managing items within the furnace's fuel      *
 * slots. Uses generic handlers from inventory_management.rs where applicable.*
 * Furnaces smelt Metal Ore into Metal Fragments using Wood as fuel.         *
 *                                                                            *
 ******************************************************************************/

use spacetimedb::{Identity, Timestamp, ReducerContext, Table, log, SpacetimeType, TimeDuration, ScheduleAt};
use std::cmp::min;
use std::time::Duration;   

// Import new models
use crate::models::{ContainerType, ItemLocation, EquipmentSlotType, ContainerLocationData};
use crate::cooking::CookingProgress;

// Import table traits and concrete types
use crate::player as PlayerTableTrait;
use crate::Player;
use crate::items::{
    inventory_item as InventoryItemTableTrait,
    item_definition as ItemDefinitionTableTrait,
    InventoryItem, ItemDefinition,
    calculate_merge_result, split_stack_helper, add_item_to_player_inventory
};
use crate::inventory_management::{self, ItemContainer, ContainerItemClearer, merge_or_place_into_container_slot};
use crate::player_inventory::{move_item_to_inventory, move_item_to_hotbar, find_first_empty_player_slot, get_player_item};
use crate::environment::calculate_chunk_index;
use crate::dropped_item::create_dropped_item_entity;

// Import campfire table trait for collision checking
use crate::campfire::campfire as CampfireTableTrait;

// --- Constants ---
// Collision constants
pub(crate) const FURNACE_COLLISION_RADIUS: f32 = 20.0;
pub(crate) const FURNACE_COLLISION_Y_OFFSET: f32 = 0.0;
pub(crate) const PLAYER_FURNACE_COLLISION_DISTANCE_SQUARED: f32 = 
    (super::PLAYER_RADIUS + FURNACE_COLLISION_RADIUS) * (super::PLAYER_RADIUS + FURNACE_COLLISION_RADIUS);
pub(crate) const FURNACE_FURNACE_COLLISION_DISTANCE_SQUARED: f32 = 
    (FURNACE_COLLISION_RADIUS * 2.0) * (FURNACE_COLLISION_RADIUS * 2.0);

// --- Placement constants ---
pub(crate) const FURNACE_PLACEMENT_MAX_DISTANCE: f32 = 96.0;
pub(crate) const FURNACE_PLACEMENT_MAX_DISTANCE_SQUARED: f32 = FURNACE_PLACEMENT_MAX_DISTANCE * FURNACE_PLACEMENT_MAX_DISTANCE;

// --- Initial amounts ---
pub const INITIAL_FURNACE_FUEL_AMOUNT: u32 = 50;

// --- Health constants ---
pub const FURNACE_INITIAL_HEALTH: f32 = 300.0;
pub const FURNACE_MAX_HEALTH: f32 = 300.0;

// Interaction constants
pub(crate) const PLAYER_FURNACE_INTERACTION_DISTANCE: f32 = 96.0;
pub(crate) const PLAYER_FURNACE_INTERACTION_DISTANCE_SQUARED: f32 = 
    PLAYER_FURNACE_INTERACTION_DISTANCE * PLAYER_FURNACE_INTERACTION_DISTANCE;

// Fuel constants
pub(crate) const FUEL_CONSUME_INTERVAL_SECS: u64 = 5;
pub const NUM_FUEL_SLOTS: usize = 5;
const FUEL_CHECK_INTERVAL_SECS: u64 = 1;
pub const FURNACE_PROCESS_INTERVAL_SECS: u64 = 1;

/// --- Furnace Data Structure ---
/// Represents a furnace in the game world with position, owner, burning state,
/// fuel slots (using individual fields instead of arrays), and fuel consumption timing.
#[spacetimedb::table(name = furnace, public)]
#[derive(Clone)]
pub struct Furnace {
    #[primary_key]
    #[auto_inc]
    pub id: u32,
    pub pos_x: f32,
    pub pos_y: f32,
    pub chunk_index: u32,
    pub placed_by: Identity,
    pub placed_at: Timestamp,
    pub is_burning: bool,
    // Use individual fields instead of arrays (same as campfire)
    pub fuel_instance_id_0: Option<u64>,
    pub fuel_def_id_0: Option<u64>,
    pub fuel_instance_id_1: Option<u64>,
    pub fuel_def_id_1: Option<u64>,
    pub fuel_instance_id_2: Option<u64>,
    pub fuel_def_id_2: Option<u64>,
    pub fuel_instance_id_3: Option<u64>,
    pub fuel_def_id_3: Option<u64>,
    pub fuel_instance_id_4: Option<u64>,
    pub fuel_def_id_4: Option<u64>,
    pub current_fuel_def_id: Option<u64>,
    pub remaining_fuel_burn_time_secs: Option<f32>,
    pub health: f32,
    pub max_health: f32,
    pub is_destroyed: bool,
    pub destroyed_at: Option<Timestamp>,
    pub last_hit_time: Option<Timestamp>,
    pub last_damaged_by: Option<Identity>,

    // --- Smelting progress for each slot ---
    pub slot_0_cooking_progress: Option<CookingProgress>,
    pub slot_1_cooking_progress: Option<CookingProgress>,
    pub slot_2_cooking_progress: Option<CookingProgress>,
    pub slot_3_cooking_progress: Option<CookingProgress>,
    pub slot_4_cooking_progress: Option<CookingProgress>,
}

// Schedule Table for per-furnace processing
#[spacetimedb::table(name = furnace_processing_schedule, scheduled(process_furnace_logic_scheduled))]
#[derive(Clone)]
pub struct FurnaceProcessingSchedule {
    #[primary_key]
    pub furnace_id: u64,
    pub scheduled_at: ScheduleAt,
}

/******************************************************************************
 *                           REDUCERS (Generic Handlers)                        *
 ******************************************************************************/

/// --- Add Fuel to Furnace ---
#[spacetimedb::reducer]
pub fn add_fuel_to_furnace(ctx: &ReducerContext, furnace_id: u32, target_slot_index: u8, item_instance_id: u64) -> Result<(), String> {
    let (_player, mut furnace) = validate_furnace_interaction(ctx, furnace_id)?;
    inventory_management::handle_move_to_container_slot(ctx, &mut furnace, target_slot_index, item_instance_id)?;
    ctx.db.furnace().id().update(furnace.clone());
    schedule_next_furnace_processing(ctx, furnace_id);
    Ok(())
}

/// --- Remove Fuel from Furnace ---
#[spacetimedb::reducer]
pub fn auto_remove_fuel_from_furnace(ctx: &ReducerContext, furnace_id: u32, source_slot_index: u8) -> Result<(), String> {
    let (_player, mut furnace) = validate_furnace_interaction(ctx, furnace_id)?;
    inventory_management::handle_quick_move_from_container(ctx, &mut furnace, source_slot_index)?;
    let still_has_fuel = check_if_furnace_has_fuel(ctx, &furnace);
    if !still_has_fuel && furnace.is_burning {
        furnace.is_burning = false;
        furnace.current_fuel_def_id = None;
        furnace.remaining_fuel_burn_time_secs = None;
        log::info!("Furnace {} extinguished as last valid fuel was removed.", furnace_id);
    }
    ctx.db.furnace().id().update(furnace.clone());
    schedule_next_furnace_processing(ctx, furnace_id);
    Ok(())
}

/// --- Split Stack Into Furnace ---
#[spacetimedb::reducer]
pub fn split_stack_into_furnace(
    ctx: &ReducerContext,
    source_item_instance_id: u64,
    quantity_to_split: u32,
    target_furnace_id: u32,
    target_slot_index: u8,
) -> Result<(), String> {
    let (_player, mut furnace) = validate_furnace_interaction(ctx, target_furnace_id)?;
    let mut source_item = get_player_item(ctx, source_item_instance_id)?;
    let new_item_target_location = ItemLocation::Container(crate::models::ContainerLocationData {
        container_type: ContainerType::Furnace,
        container_id: furnace.id as u64,
        slot_index: target_slot_index,
    });
    let new_item_instance_id = split_stack_helper(ctx, &mut source_item, quantity_to_split, new_item_target_location)?;
    
    let mut new_item = ctx.db.inventory_item().instance_id().find(new_item_instance_id)
        .ok_or_else(|| format!("Failed to find newly split item instance {}", new_item_instance_id))?;
    let new_item_def = ctx.db.item_definition().id().find(new_item.item_def_id)
        .ok_or_else(|| format!("Failed to find definition for new item {}", new_item.item_def_id))?;

    merge_or_place_into_container_slot(ctx, &mut furnace, target_slot_index, &mut new_item, &new_item_def)?;
    
    ctx.db.inventory_item().instance_id().update(source_item);
    ctx.db.furnace().id().update(furnace.clone());
    schedule_next_furnace_processing(ctx, target_furnace_id);
    Ok(())
}

/// --- Furnace Internal Item Movement ---
#[spacetimedb::reducer]
pub fn move_fuel_within_furnace(
    ctx: &ReducerContext,
    furnace_id: u32,
    source_slot_index: u8,
    target_slot_index: u8,
) -> Result<(), String> {
    let (_player, mut furnace) = validate_furnace_interaction(ctx, furnace_id)?;
    inventory_management::handle_move_within_container(ctx, &mut furnace, source_slot_index, target_slot_index)?;
    ctx.db.furnace().id().update(furnace.clone());
    schedule_next_furnace_processing(ctx, furnace_id);
    Ok(())
}

/// --- Furnace Internal Stack Splitting ---
#[spacetimedb::reducer]
pub fn split_stack_within_furnace(
    ctx: &ReducerContext,
    furnace_id: u32,
    source_slot_index: u8,
    quantity_to_split: u32,
    target_slot_index: u8,
) -> Result<(), String> {
    let (_player, mut furnace) = validate_furnace_interaction(ctx, furnace_id)?;
    inventory_management::handle_split_within_container(ctx, &mut furnace, source_slot_index, target_slot_index, quantity_to_split)?;
    ctx.db.furnace().id().update(furnace.clone());
    schedule_next_furnace_processing(ctx, furnace_id);
    Ok(())
}

/// --- Quick Move to Furnace ---
#[spacetimedb::reducer]
pub fn quick_move_to_furnace(
    ctx: &ReducerContext,
    furnace_id: u32,
    item_instance_id: u64,
) -> Result<(), String> {
    let (_player, mut furnace) = validate_furnace_interaction(ctx, furnace_id)?;
    inventory_management::handle_quick_move_to_container(ctx, &mut furnace, item_instance_id)?;
    ctx.db.furnace().id().update(furnace.clone());
    schedule_next_furnace_processing(ctx, furnace_id);
    Ok(())
}

/// --- Move From Furnace to Player ---
#[spacetimedb::reducer]
pub fn move_fuel_item_from_furnace_to_player_slot(
    ctx: &ReducerContext,
    furnace_id: u32,
    source_slot_index: u8,
    target_slot_type: String,
    target_slot_index: u32,
) -> Result<(), String> {
    let (_player, mut furnace) = validate_furnace_interaction(ctx, furnace_id)?;
    inventory_management::handle_move_from_container_slot(ctx, &mut furnace, source_slot_index, target_slot_type, target_slot_index)?;
    let still_has_fuel = check_if_furnace_has_fuel(ctx, &furnace);
    if !still_has_fuel && furnace.is_burning {
        furnace.is_burning = false;
        furnace.current_fuel_def_id = None;
        furnace.remaining_fuel_burn_time_secs = None;
    }
    ctx.db.furnace().id().update(furnace.clone());
    schedule_next_furnace_processing(ctx, furnace_id);
    Ok(())
}

/// --- Split From Furnace to Player ---
#[spacetimedb::reducer]
pub fn split_stack_from_furnace(
    ctx: &ReducerContext,
    source_furnace_id: u32,
    source_slot_index: u8,
    quantity_to_split: u32,
    target_slot_type: String,    // "inventory" or "hotbar"
    target_slot_index: u32,     // Numeric index for inventory/hotbar
) -> Result<(), String> {
    // Get mutable furnace table handle
    let mut furnaces = ctx.db.furnace();

    // --- Basic Validations --- 
    let (_player, mut furnace) = validate_furnace_interaction(ctx, source_furnace_id)?;
    // Note: Further validations (item existence, stackability, quantity) are handled 
    //       within the generic handle_split_from_container function.

    log::info!(
        "[SplitFromFurnace] Player {:?} delegating split {} from furnace {} slot {} to {} slot {}",
        ctx.sender, quantity_to_split, source_furnace_id, source_slot_index, target_slot_type, target_slot_index
    );

    // --- Call GENERIC Handler --- 
    inventory_management::handle_split_from_container(
        ctx, 
        &mut furnace, 
        source_slot_index, 
        quantity_to_split,
        target_slot_type, 
        target_slot_index
    )?;

    // --- Commit Furnace Update --- 
    // The handler might have modified the source item quantity via split_stack_helper,
    // but the furnace state itself (slots) isn't directly changed by this handler.
    // However, to be safe and consistent with other reducers that fetch a mutable container,
    // we update it here. In the future, if the handler needed to modify the container state
    // (e.g., if the split failed and we needed to revert something), this update is necessary.
    furnaces.id().update(furnace);

    Ok(())
}

/// --- Split and Move From Furnace ---
/// Splits a stack FROM a furnace slot and moves/merges the new stack 
/// TO a target slot (player inventory/hotbar, or another furnace slot).
#[spacetimedb::reducer]
pub fn split_and_move_from_furnace(
    ctx: &ReducerContext,
    source_furnace_id: u32,
    source_slot_index: u8,
    quantity_to_split: u32,
    target_slot_type: String,    // "inventory", "hotbar", or "furnace_fuel"
    target_slot_index: u32,     // Numeric index for inventory/hotbar/furnace
) -> Result<(), String> {
    let sender_id = ctx.sender; 
    let furnaces = ctx.db.furnace();
    let mut inventory_items = ctx.db.inventory_item(); 

    log::info!(
        "[SplitMoveFromFurnace] Player {:?} splitting {} from furnace {} slot {} to {} slot {}",
        sender_id, quantity_to_split, source_furnace_id, source_slot_index, target_slot_type, target_slot_index
    );

    // --- 1. Find Source Furnace & Item ID --- 
    let furnace = furnaces.id().find(source_furnace_id)
        .ok_or(format!("Source furnace {} not found", source_furnace_id))?;
    
    if source_slot_index >= NUM_FUEL_SLOTS as u8 {
        return Err(format!("Invalid source fuel slot index: {}", source_slot_index));
    }

    let source_instance_id = match source_slot_index {
        0 => furnace.fuel_instance_id_0,
        1 => furnace.fuel_instance_id_1,
        2 => furnace.fuel_instance_id_2,
        3 => furnace.fuel_instance_id_3,
        4 => furnace.fuel_instance_id_4,
        _ => None,
    }.ok_or(format!("No item found in source furnace slot {}", source_slot_index))?;

    // --- 2. Get Source Item & Validate Split --- 
    let mut source_item = inventory_items.instance_id().find(source_instance_id)
        .ok_or("Source item instance not found in inventory table")?;

    let item_def = ctx.db.item_definition().id().find(source_item.item_def_id)
        .ok_or_else(|| format!("Definition not found for item ID {}", source_item.item_def_id))?;
    
    if !item_def.is_stackable {
        return Err(format!("Item '{}' is not stackable.", item_def.name));
    }
    if quantity_to_split == 0 {
        return Err("Cannot split a quantity of 0.".to_string());
    }
    if quantity_to_split >= source_item.quantity {
        return Err(format!("Cannot split {} items, only {} available.", quantity_to_split, source_item.quantity));
    }

    // --- 3. Perform Split --- 
    // Determine the initial location for the NEWLY SPLIT item.
    // If moving to player inventory/hotbar, it must initially be in player inventory.
    // If moving to another furnace slot, it can also initially be player inventory before being added.
    let initial_location_for_new_split_item = 
        find_first_empty_player_slot(ctx, sender_id)
            .ok_or_else(|| "Player inventory is full, cannot create split stack.".to_string())?;

    let new_item_instance_id = split_stack_helper(ctx, &mut source_item, quantity_to_split, initial_location_for_new_split_item)?;
    // source_item (original in furnace) quantity is now updated by split_stack_helper, persist it.
    inventory_items.instance_id().update(source_item.clone());

    // Fetch the newly created item (which is now in player's inventory/hotbar at initial_location_for_new_split_item)
    let new_item_for_move = inventory_items.instance_id().find(new_item_instance_id)
        .ok_or_else(|| format!("Failed to find newly split item instance {} for moving", new_item_instance_id))?;

    // --- 4. Move/Merge the NEW Stack from its initial player location to the FINAL target --- 
    log::debug!("[SplitMoveFromFurnace] Moving new stack {} from its initial player location {:?} to final target {} slot {}", 
                new_item_instance_id, new_item_for_move.location, target_slot_type, target_slot_index);
    
    match target_slot_type.as_str() {
        "inventory" => {
            move_item_to_inventory(ctx, new_item_instance_id, target_slot_index as u16)
        },
        "hotbar" => {
            move_item_to_hotbar(ctx, new_item_instance_id, target_slot_index as u8)
        },
        "furnace_fuel" => {
            // Moving to a slot in the *same* or *another* furnace. 
            // `add_fuel_to_furnace` expects the item to come from player inventory.
            // The new_item_instance_id is already in player's inventory due to split_stack_helper's new location.
            add_fuel_to_furnace(ctx, source_furnace_id, target_slot_index as u8, new_item_instance_id)
        },
        _ => {
            log::error!("[SplitMoveFromFurnace] Invalid target_slot_type: {}", target_slot_type);
            // Attempt to delete the orphaned split stack to prevent item loss
            inventory_items.instance_id().delete(new_item_instance_id);
            Err(format!("Invalid target slot type for split: {}", target_slot_type))
        }
    }
}

/// --- Drop Item from Furnace Fuel Slot to World ---
#[spacetimedb::reducer]
pub fn drop_item_from_furnace_slot_to_world(
    ctx: &ReducerContext,
    furnace_id: u32,
    slot_index: u8, // This will be 0-4 for fuel slots
) -> Result<(), String> {
    let sender_id = ctx.sender;
    let player_table = ctx.db.player();
    let mut furnace_table = ctx.db.furnace();

    log::info!("[DropFromFurnaceToWorld] Player {} attempting to drop fuel from furnace ID {}, slot index {}.", 
             sender_id, furnace_id, slot_index);

    // 1. Validate interaction and get furnace
    let (_player_for_validation, mut furnace) = validate_furnace_interaction(ctx, furnace_id)?;

    // 2. Get Player for drop location
    let player_for_drop_location = player_table.identity().find(sender_id)
        .ok_or_else(|| format!("Player {} not found for drop location.", sender_id))?;

    // 3. Call the generic handler from inventory_management
    // The ItemContainer trait for Furnace handles the slot_index for fuel slots
    crate::inventory_management::handle_drop_from_container_slot(ctx, &mut furnace, slot_index, &player_for_drop_location)?;

    // 4. Persist changes to the Furnace
    furnace_table.id().update(furnace);
    log::info!("[DropFromFurnaceToWorld] Successfully dropped fuel from furnace {}, slot {}. Furnace updated.", furnace_id, slot_index);

    Ok(())
}

/// --- Split and Drop Item from Furnace Fuel Slot to World ---
#[spacetimedb::reducer]
pub fn split_and_drop_item_from_furnace_slot_to_world(
    ctx: &ReducerContext,
    furnace_id: u32,
    slot_index: u8, // This will be 0-4 for fuel slots
    quantity_to_split: u32,
) -> Result<(), String> {
    let sender_id = ctx.sender;
    let player_table = ctx.db.player();
    let mut furnace_table = ctx.db.furnace();

    log::info!("[SplitDropFromFurnaceToWorld] Player {} attempting to split {} fuel from furnace ID {}, slot {}.", 
             sender_id, quantity_to_split, furnace_id, slot_index);

    // 1. Validate interaction and get furnace
    let (_player_for_validation, mut furnace) = validate_furnace_interaction(ctx, furnace_id)?;

    // 2. Get Player for drop location
    let player_for_drop_location = player_table.identity().find(sender_id)
        .ok_or_else(|| format!("Player {} not found for drop location.", sender_id))?;

    // 3. Call the generic handler from inventory_management
    crate::inventory_management::handle_split_and_drop_from_container_slot(ctx, &mut furnace, slot_index, quantity_to_split, &player_for_drop_location)?;

    // 4. Persist changes to the Furnace
    furnace_table.id().update(furnace);
    log::info!("[SplitDropFromFurnaceToWorld] Successfully split and dropped fuel from furnace {}, slot {}. Furnace updated.", furnace_id, slot_index);
    
    Ok(())
}

/******************************************************************************
 *                       REDUCERS (Furnace-Specific Logic)                   *
 ******************************************************************************/

/// --- Furnace Interaction Check ---
#[spacetimedb::reducer]
pub fn interact_with_furnace(ctx: &ReducerContext, furnace_id: u32) -> Result<(), String> {
    let (_player, _furnace) = validate_furnace_interaction(ctx, furnace_id)?;
    Ok(())
}

/// --- Furnace Burning State Toggle ---
#[spacetimedb::reducer]
pub fn toggle_furnace_burning(ctx: &ReducerContext, furnace_id: u32) -> Result<(), String> {
    let (_player, mut furnace) = validate_furnace_interaction(ctx, furnace_id)?;
    if furnace.is_burning {
        furnace.is_burning = false;
        furnace.current_fuel_def_id = None;
        furnace.remaining_fuel_burn_time_secs = None;
        log::info!("Furnace {} extinguished by player {:?}.", furnace.id, ctx.sender);
    } else {
        if !check_if_furnace_has_fuel(ctx, &furnace) {
            return Err("Cannot light furnace, requires fuel.".to_string());
        }
        
        furnace.is_burning = true;
        log::info!("Furnace {} lit by player {:?}.", furnace.id, ctx.sender);
    }
    ctx.db.furnace().id().update(furnace.clone());
    schedule_next_furnace_processing(ctx, furnace_id);
    Ok(())
}

// Reducer to place a furnace
#[spacetimedb::reducer]
pub fn place_furnace(ctx: &ReducerContext, item_instance_id: u64, world_x: f32, world_y: f32) -> Result<(), String> {
    let sender_id = ctx.sender;
    let inventory_items = ctx.db.inventory_item();
    let item_defs = ctx.db.item_definition();
    let players = ctx.db.player();
    let furnaces = ctx.db.furnace();

    // Look up Item Definition IDs by Name
    let furnace_def_id = item_defs.iter()
        .find(|def| def.name == "Furnace")
        .map(|def| def.id)
        .ok_or_else(|| "Item definition for 'Furnace' not found.".to_string())?;

    let wood_def_id = item_defs.iter()
        .find(|def| def.name == "Wood")
        .map(|def| def.id)
        .ok_or_else(|| "Item definition for 'Wood' not found.".to_string())?;

    log::info!(
        "[PlaceFurnace] Player {:?} attempting placement of item {} at ({:.1}, {:.1})",
        sender_id, item_instance_id, world_x, world_y
    );

    // Find the player who wants to place the furnace
    let player = players.identity().find(sender_id)
        .ok_or_else(|| "Player not found.".to_string())?;

    // Find the item in the player's inventory
    let item = inventory_items.instance_id().find(item_instance_id)
        .ok_or_else(|| "Item not found.".to_string())?;

    // Verify the item belongs to the player and is a furnace
    if item.location.is_player_bound() != Some(sender_id) {
        return Err("Item does not belong to you.".to_string());
    }

    if item.item_def_id != furnace_def_id {
        return Err("Item is not a furnace.".to_string());
    }

    // Check placement distance
    let distance_squared = (player.position_x - world_x).powi(2) + (player.position_y - world_y).powi(2);
    if distance_squared > FURNACE_PLACEMENT_MAX_DISTANCE_SQUARED {
        return Err(format!("Furnace placement too far away (max distance: {:.1})", FURNACE_PLACEMENT_MAX_DISTANCE));
    }

    // Check for collisions with other furnaces
    for existing_furnace in furnaces.iter() {
        if existing_furnace.is_destroyed {
            continue;
        }
        let dx = existing_furnace.pos_x - world_x;
        let dy = existing_furnace.pos_y - world_y;
        let distance_squared = dx * dx + dy * dy;
        if distance_squared < FURNACE_FURNACE_COLLISION_DISTANCE_SQUARED {
            return Err("Cannot place furnace: too close to existing furnace.".to_string());
        }
    }

    // Check for collisions with campfires
    for existing_campfire in ctx.db.campfire().iter() {
        if existing_campfire.is_destroyed {
            continue;
        }
        let dx = existing_campfire.pos_x - world_x;
        let dy = existing_campfire.pos_y - world_y;
        let distance_squared = dx * dx + dy * dy;
        if distance_squared < FURNACE_FURNACE_COLLISION_DISTANCE_SQUARED {
            return Err("Cannot place furnace: too close to existing campfire.".to_string());
        }
    }

    // Remove the furnace item from inventory
    ctx.db.inventory_item().instance_id().delete(item_instance_id);

    // Create initial fuel: 50 Wood
    let fuel_location = ItemLocation::Container(ContainerLocationData {
        container_type: ContainerType::Furnace,
        container_id: 0, // Will be updated after furnace creation
        slot_index: 0,
    });

    let fuel_item = InventoryItem {
        instance_id: 0, // Auto-generated
        item_def_id: wood_def_id,
        quantity: INITIAL_FURNACE_FUEL_AMOUNT,
        location: fuel_location,
        item_data: None, // Initialize as empty
    };

    let fuel_item = ctx.db.inventory_item().insert(fuel_item);

    // Create the furnace
    // Adjust Y position to account for client-side rendering offset
    // Client renders at: entity.posY - FURNACE_HEIGHT - FURNACE_RENDER_Y_OFFSET
    // We want the furnace center to align with the placement cursor position
    // So: entity.posY = cursor_y + (FURNACE_HEIGHT / 2) + FURNACE_RENDER_Y_OFFSET
    let adjusted_y = world_y + 48.0 + 10.0; // 48 = FURNACE_HEIGHT/2 (96/2), 10 = FURNACE_RENDER_Y_OFFSET
    
    let new_furnace = Furnace {
        id: 0, // Auto-generated
        pos_x: world_x,
        pos_y: adjusted_y,
        chunk_index: calculate_chunk_index(world_x, world_y),
        placed_by: sender_id,
        placed_at: ctx.timestamp,
        is_burning: false,
        fuel_instance_id_0: Some(fuel_item.instance_id),
        fuel_def_id_0: Some(wood_def_id),
        fuel_instance_id_1: None,
        fuel_def_id_1: None,
        fuel_instance_id_2: None,
        fuel_def_id_2: None,
        fuel_instance_id_3: None,
        fuel_def_id_3: None,
        fuel_instance_id_4: None,
        fuel_def_id_4: None,
        current_fuel_def_id: None,
        remaining_fuel_burn_time_secs: None,
        health: FURNACE_INITIAL_HEALTH,
        max_health: FURNACE_MAX_HEALTH,
        is_destroyed: false,
        destroyed_at: None,
        last_hit_time: None,
        last_damaged_by: None,
        slot_0_cooking_progress: None,
        slot_1_cooking_progress: None,
        slot_2_cooking_progress: None,
        slot_3_cooking_progress: None,
        slot_4_cooking_progress: None,
    };

    let created_furnace = ctx.db.furnace().insert(new_furnace);

    // Update the fuel item's container_id
    let mut updated_fuel_item = fuel_item;
    if let ItemLocation::Container(ref mut container_data) = updated_fuel_item.location {
        container_data.container_id = created_furnace.id as u64;
    }
    ctx.db.inventory_item().instance_id().update(updated_fuel_item);

    log::info!(
        "Furnace {} placed successfully by player {:?} at ({:.1}, {:.1})",
        created_furnace.id, sender_id, world_x, world_y
    );

    Ok(())
}

// Scheduled processing logic
#[spacetimedb::reducer]
pub fn process_furnace_logic_scheduled(ctx: &ReducerContext, schedule_args: FurnaceProcessingSchedule) -> Result<(), String> {
    // Security check
    if ctx.sender != ctx.identity() {
        return Err("Only the module itself can call scheduled furnace processing.".to_string());
    }

    let furnace_id = schedule_args.furnace_id as u32;
    let mut furnace = match ctx.db.furnace().id().find(furnace_id) {
        Some(f) => f,
        None => {
            log::warn!("Scheduled furnace processing: furnace {} not found, canceling schedule.", furnace_id);
            return Ok(()); // Furnace was deleted, don't reschedule
        }
    };

    if furnace.is_destroyed {
        log::debug!("Furnace {} is destroyed, not processing.", furnace_id);
        return Ok(()); // Don't reschedule destroyed furnaces
    }

    let mut needs_update = false;

    if furnace.is_burning {
        // Process fuel consumption
        if let Some(remaining_time) = furnace.remaining_fuel_burn_time_secs {
            if remaining_time <= 0.0 {
                // Current fuel is depleted, try to find next fuel
                if !find_and_consume_next_fuel(ctx, &mut furnace) {
                    // No more fuel, extinguish furnace
                    furnace.is_burning = false;
                    furnace.current_fuel_def_id = None;
                    furnace.remaining_fuel_burn_time_secs = None;
                    log::info!("Furnace {} ran out of fuel and was extinguished.", furnace_id);
                    needs_update = true;
                }
            } else {
                // Consume fuel time
                furnace.remaining_fuel_burn_time_secs = Some(remaining_time - FURNACE_PROCESS_INTERVAL_SECS as f32);
                needs_update = true;
            }
        } else {
            // No current fuel burn time set, try to start burning fuel
            if !find_and_consume_next_fuel(ctx, &mut furnace) {
                furnace.is_burning = false;
                log::info!("Furnace {} has no valid fuel, extinguishing.", furnace_id);
                needs_update = true;
            }
        }

        // Process smelting if still burning
        if furnace.is_burning {
            let current_fuel_instance_id = furnace.current_fuel_def_id.and_then(|_| {
                // Find which slot has the current fuel
                for slot_index in 0..NUM_FUEL_SLOTS {
                    if let Some(instance_id) = furnace.get_slot_instance_id(slot_index as u8) {
                        if let Some(def_id) = furnace.get_slot_def_id(slot_index as u8) {
                            if Some(def_id) == furnace.current_fuel_def_id {
                                return Some(instance_id);
                            }
                        }
                    }
                }
                None
            });

            let smelting_result = crate::cooking::process_appliance_cooking_tick(
                ctx, 
                &mut furnace, 
                FURNACE_PROCESS_INTERVAL_SECS as f32,
                current_fuel_instance_id
            );
            match smelting_result {
                Ok(appliance_modified) => {
                    if appliance_modified {
                        needs_update = true;
                    }
                }
                Err(e) => {
                    log::error!("Error processing furnace {} smelting: {}", furnace_id, e);
                }
            }
        }
    }

    if needs_update {
        ctx.db.furnace().id().update(furnace.clone());
    }

    // Schedule next processing if furnace is still burning or has fuel
    if furnace.is_burning || check_if_furnace_has_fuel(ctx, &furnace) {
        schedule_next_furnace_processing(ctx, furnace_id)?;
    }

    Ok(())
}

pub fn schedule_next_furnace_processing(ctx: &ReducerContext, furnace_id: u32) -> Result<(), String> {
    let furnace = ctx.db.furnace().id().find(furnace_id)
        .ok_or_else(|| format!("Furnace {} not found for scheduling.", furnace_id))?;

    if furnace.is_destroyed {
        log::debug!("Not scheduling processing for destroyed furnace {}.", furnace_id);
        return Ok(());
    }

    // Cancel existing schedule if any
    ctx.db.furnace_processing_schedule().furnace_id().delete(furnace_id as u64);

    // Only schedule if burning or has fuel
    if furnace.is_burning || check_if_furnace_has_fuel(ctx, &furnace) {
        let next_run_time = ctx.timestamp + TimeDuration::from_micros((FURNACE_PROCESS_INTERVAL_SECS * 1_000_000) as i64);
        let schedule = FurnaceProcessingSchedule {
            furnace_id: furnace_id as u64,
            scheduled_at: ScheduleAt::Time(next_run_time),
        };
        ctx.db.furnace_processing_schedule().insert(schedule);
        log::debug!("Scheduled next processing for furnace {} at {:?}", furnace_id, next_run_time);
    } else {
        log::debug!("Furnace {} not burning and has no fuel, not scheduling processing.", furnace_id);
    }

    Ok(())
}

/******************************************************************************
 *                           HELPER FUNCTIONS                                 *
 ******************************************************************************/

impl ItemContainer for Furnace {
    fn num_slots(&self) -> usize {
        NUM_FUEL_SLOTS
    }

    fn get_slot_instance_id(&self, slot_index: u8) -> Option<u64> {
        match slot_index {
            0 => self.fuel_instance_id_0,
            1 => self.fuel_instance_id_1,
            2 => self.fuel_instance_id_2,
            3 => self.fuel_instance_id_3,
            4 => self.fuel_instance_id_4,
            _ => None,
        }
    }

    fn get_slot_def_id(&self, slot_index: u8) -> Option<u64> {
        match slot_index {
            0 => self.fuel_def_id_0,
            1 => self.fuel_def_id_1,
            2 => self.fuel_def_id_2,
            3 => self.fuel_def_id_3,
            4 => self.fuel_def_id_4,
            _ => None,
        }
    }

    fn set_slot(&mut self, slot_index: u8, instance_id: Option<u64>, def_id: Option<u64>) {
        match slot_index {
            0 => { self.fuel_instance_id_0 = instance_id; self.fuel_def_id_0 = def_id; }
            1 => { self.fuel_instance_id_1 = instance_id; self.fuel_def_id_1 = def_id; }
            2 => { self.fuel_instance_id_2 = instance_id; self.fuel_def_id_2 = def_id; }
            3 => { self.fuel_instance_id_3 = instance_id; self.fuel_def_id_3 = def_id; }
            4 => { self.fuel_instance_id_4 = instance_id; self.fuel_def_id_4 = def_id; }
            _ => {}
        }
    }

    fn get_container_type(&self) -> ContainerType {
        ContainerType::Furnace
    }

    fn get_container_id(&self) -> u64 {
        self.id as u64
    }
}

// Container clearer implementation
pub struct FurnaceClearer;

pub(crate) fn clear_item_from_furnace_fuel_slots(ctx: &ReducerContext, item_instance_id_to_clear: u64) -> bool {
    let mut furnaces = ctx.db.furnace();
    let mut cleared = false;

    for furnace in furnaces.iter() {
        let mut furnace = furnace.clone(); // Clone to avoid borrow issues
        for slot_index in 0..NUM_FUEL_SLOTS {
            if let Some(instance_id) = furnace.get_slot_instance_id(slot_index as u8) {
                if instance_id == item_instance_id_to_clear {
                    let furnace_id = furnace.id; // Store ID before move
                    furnace.set_slot(slot_index as u8, None, None);
                    furnaces.id().update(furnace);
                    cleared = true;
                    log::info!("Cleared item {} from furnace {} slot {}", item_instance_id_to_clear, furnace_id, slot_index);
                    break;
                }
            }
        }
    }
    cleared
}

impl ContainerItemClearer for FurnaceClearer {
    fn clear_item(ctx: &ReducerContext, item_instance_id: u64) -> bool {
        clear_item_from_furnace_fuel_slots(ctx, item_instance_id)
    }
}

fn validate_furnace_interaction(
    ctx: &ReducerContext,
    furnace_id: u32,
) -> Result<(Player, Furnace), String> {
    let sender_id = ctx.sender;
    let players = ctx.db.player();
    let furnaces = ctx.db.furnace();

    // Find the player
    let player = players.identity().find(sender_id)
        .ok_or_else(|| "Player not found.".to_string())?;

    // Find the furnace
    let furnace = furnaces.id().find(furnace_id)
        .ok_or_else(|| format!("Furnace {} not found.", furnace_id))?;

    if furnace.is_destroyed {
        return Err("Furnace is destroyed and cannot be interacted with.".to_string());
    }

    // Check interaction distance
    let distance_squared = (player.position_x - furnace.pos_x).powi(2) + (player.position_y - furnace.pos_y).powi(2);
    if distance_squared > PLAYER_FURNACE_INTERACTION_DISTANCE_SQUARED {
        return Err(format!(
            "Too far from furnace (distance: {:.1}, max: {:.1})",
            distance_squared.sqrt(),
            PLAYER_FURNACE_INTERACTION_DISTANCE
        ));
    }

    Ok((player, furnace))
}

pub(crate) fn check_if_furnace_has_fuel(ctx: &ReducerContext, furnace: &Furnace) -> bool {
    let wood_def_id = match get_item_def_by_name(ctx, "Wood") {
        Some(def) => def.id,
        None => {
            log::error!("Wood item definition not found!");
            return false;
        }
    };

    for slot_index in 0..NUM_FUEL_SLOTS {
        if let (Some(instance_id), Some(def_id)) = (
            furnace.get_slot_instance_id(slot_index as u8),
            furnace.get_slot_def_id(slot_index as u8),
        ) {
            // Only Wood is valid fuel for furnaces
            if def_id == wood_def_id {
                if let Some(item) = ctx.db.inventory_item().instance_id().find(instance_id) {
                    if item.quantity > 0 {
                        return true;
                    }
                }
            }
        }
    }
    false
}

fn find_and_consume_next_fuel(ctx: &ReducerContext, furnace: &mut Furnace) -> bool {
    let wood_def_id = match get_item_def_by_name(ctx, "Wood") {
        Some(def) => def.id,
        None => {
            log::error!("Wood item definition not found!");
            return false;
        }
    };

    for slot_index in 0..NUM_FUEL_SLOTS {
        if let (Some(instance_id), Some(def_id)) = (
            furnace.get_slot_instance_id(slot_index as u8),
            furnace.get_slot_def_id(slot_index as u8),
        ) {
            // Only Wood is valid fuel for furnaces
            if def_id == wood_def_id {
                if let Some(mut item) = ctx.db.inventory_item().instance_id().find(instance_id) {
                    if item.quantity > 0 {
                        // Store current quantity before modification
                        let original_quantity = item.quantity;
                        
                        // Consume one unit of fuel
                        item.quantity -= 1;
                        let remaining_quantity = item.quantity; // Store remaining quantity before move
                        
                        if item.quantity == 0 {
                            // Remove item and clear slot
                            ctx.db.inventory_item().instance_id().delete(instance_id);
                            furnace.set_slot(slot_index as u8, None, None);
                        } else {
                            // Update item quantity
                            ctx.db.inventory_item().instance_id().update(item);
                        }

                        // Set burn time for Wood (5.0 seconds)
                        furnace.current_fuel_def_id = Some(def_id);
                        furnace.remaining_fuel_burn_time_secs = Some(5.0);
                        
                        log::debug!("Furnace {} consumed 1 Wood from slot {}, {} remaining", 
                                   furnace.id, slot_index, remaining_quantity);
                        return true;
                    }
                }
            }
        }
    }
    false
}

fn get_item_def_by_name<'a>(ctx: &'a ReducerContext, name: &str) -> Option<ItemDefinition> {
    ctx.db.item_definition().iter().find(|def| def.name == name)
}

// Implement CookableAppliance for Furnace (smelting only)
impl crate::cooking::CookableAppliance for Furnace {
    fn num_processing_slots(&self) -> usize {
        NUM_FUEL_SLOTS
    }

    fn get_slot_instance_id(&self, slot_index: u8) -> Option<u64> {
        ItemContainer::get_slot_instance_id(self, slot_index)
    }

    fn get_slot_def_id(&self, slot_index: u8) -> Option<u64> {
        ItemContainer::get_slot_def_id(self, slot_index)
    }

    fn set_slot(&mut self, slot_index: u8, instance_id: Option<u64>, def_id: Option<u64>) {
        ItemContainer::set_slot(self, slot_index, instance_id, def_id)
    }

    fn get_slot_cooking_progress(&self, slot_index: u8) -> Option<CookingProgress> {
        match slot_index {
            0 => self.slot_0_cooking_progress.clone(),
            1 => self.slot_1_cooking_progress.clone(),
            2 => self.slot_2_cooking_progress.clone(),
            3 => self.slot_3_cooking_progress.clone(),
            4 => self.slot_4_cooking_progress.clone(),
            _ => None,
        }
    }

    fn set_slot_cooking_progress(&mut self, slot_index: u8, progress: Option<CookingProgress>) {
        match slot_index {
            0 => self.slot_0_cooking_progress = progress,
            1 => self.slot_1_cooking_progress = progress,
            2 => self.slot_2_cooking_progress = progress,
            3 => self.slot_3_cooking_progress = progress,
            4 => self.slot_4_cooking_progress = progress,
            _ => {}
        }
    }

    fn get_appliance_entity_id(&self) -> u64 {
        self.id as u64
    }

    fn get_appliance_world_position(&self) -> (f32, f32) {
        (self.pos_x, self.pos_y)
    }

    fn get_appliance_container_type(&self) -> ContainerType {
        ContainerType::Furnace
    }
} 