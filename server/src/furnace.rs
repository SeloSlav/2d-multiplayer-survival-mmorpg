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
use rand::Rng; // Added for random chance

// Import new models
use crate::models::{ContainerType, ItemLocation, EquipmentSlotType, ContainerLocationData};
use crate::cooking::CookingProgress;

// Import table traits and concrete types
use crate::player as PlayerTableTrait;
use crate::Player;
use crate::items::{
    inventory_item as InventoryItemTableTrait,
    item_definition as ItemDefinitionTableTrait,
    InventoryItem, ItemDefinition, ItemCategory,
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
pub(crate) const FURNACE_COLLISION_RADIUS: f32 = 35.0;
pub(crate) const FURNACE_COLLISION_Y_OFFSET: f32 = -35.0;
pub(crate) const LARGE_FURNACE_COLLISION_RADIUS: f32 = 50.0;  // Larger collision radius for the big furnace
pub(crate) const LARGE_FURNACE_COLLISION_Y_OFFSET: f32 = 80.0;  // Same as Signal Disruptor
// Monument large furnace: 480px sprite, standardized 350x160 AABB collision (same as ALK substations)
// Circular approximation for server-side checks: half of AABB width = 175px
pub(crate) const MONUMENT_LARGE_FURNACE_COLLISION_RADIUS: f32 = 175.0;
pub(crate) const PLAYER_FURNACE_COLLISION_DISTANCE_SQUARED: f32 = 
    (super::PLAYER_RADIUS + FURNACE_COLLISION_RADIUS) * (super::PLAYER_RADIUS + FURNACE_COLLISION_RADIUS);
pub(crate) const FURNACE_FURNACE_COLLISION_DISTANCE_SQUARED: f32 = 
    (FURNACE_COLLISION_RADIUS * 2.0) * (FURNACE_COLLISION_RADIUS * 2.0);

// --- Placement constants ---
pub(crate) const FURNACE_PLACEMENT_MAX_DISTANCE: f32 = 96.0;
pub(crate) const FURNACE_PLACEMENT_MAX_DISTANCE_SQUARED: f32 = FURNACE_PLACEMENT_MAX_DISTANCE * FURNACE_PLACEMENT_MAX_DISTANCE;
pub(crate) const LARGE_FURNACE_PLACEMENT_MAX_DISTANCE: f32 = 160.0; // Larger placement range for large furnace (similar to wards/turrets)
pub(crate) const LARGE_FURNACE_PLACEMENT_MAX_DISTANCE_SQUARED: f32 = LARGE_FURNACE_PLACEMENT_MAX_DISTANCE * LARGE_FURNACE_PLACEMENT_MAX_DISTANCE;

// --- Initial amounts ---
pub const INITIAL_FURNACE_FUEL_AMOUNT: u32 = 50;

// --- Health constants ---
pub const FURNACE_INITIAL_HEALTH: f32 = 300.0;
pub const FURNACE_MAX_HEALTH: f32 = 300.0;

// Interaction constants
pub(crate) const PLAYER_FURNACE_INTERACTION_DISTANCE: f32 = 96.0;
pub(crate) const PLAYER_FURNACE_INTERACTION_DISTANCE_SQUARED: f32 = 
    PLAYER_FURNACE_INTERACTION_DISTANCE * PLAYER_FURNACE_INTERACTION_DISTANCE;
pub(crate) const PLAYER_LARGE_FURNACE_INTERACTION_DISTANCE: f32 = 130.0;
pub(crate) const PLAYER_LARGE_FURNACE_INTERACTION_DISTANCE_SQUARED: f32 = 
    PLAYER_LARGE_FURNACE_INTERACTION_DISTANCE * PLAYER_LARGE_FURNACE_INTERACTION_DISTANCE;
// Monument large furnace is ~480px vs 256px regular (1.875x), so proportionally larger interaction
pub(crate) const PLAYER_MONUMENT_LARGE_FURNACE_INTERACTION_DISTANCE: f32 = 250.0;
pub(crate) const PLAYER_MONUMENT_LARGE_FURNACE_INTERACTION_DISTANCE_SQUARED: f32 = 
    PLAYER_MONUMENT_LARGE_FURNACE_INTERACTION_DISTANCE * PLAYER_MONUMENT_LARGE_FURNACE_INTERACTION_DISTANCE;

// Fuel constants
pub(crate) const FUEL_CONSUME_INTERVAL_SECS: u64 = 5;
pub const NUM_FUEL_SLOTS: usize = 5;
pub const NUM_LARGE_FURNACE_SLOTS: usize = 18;
const FUEL_CHECK_INTERVAL_SECS: u64 = 1;
pub const FURNACE_PROCESS_INTERVAL_SECS: u64 = 1;
const CHARCOAL_PRODUCTION_CHANCE: u8 = 75; // 75% chance

// --- Furnace Types ---
pub const FURNACE_TYPE_NORMAL: u8 = 0;
pub const FURNACE_TYPE_LARGE: u8 = 1;

/// --- Furnace Data Structure ---
/// Represents a furnace in the game world with position, owner, burning state,
/// fuel slots (using individual fields instead of arrays), and fuel consumption timing.
#[spacetimedb::table(accessor = furnace, public)]
#[derive(Clone)]
pub struct Furnace {
    #[primary_key]
    #[auto_inc]
    pub id: u32,
    pub pos_x: f32,
    pub pos_y: f32,
    #[index(btree)]
    pub chunk_index: u32,
    pub placed_by: Identity,
    pub placed_at: Timestamp,
    pub is_burning: bool,
    pub furnace_type: u8, // 0 = normal (5 slots), 1 = large (18 slots)
    // Use individual fields instead of arrays (slot_* naming for consistency with other containers)
    // Slots 0-4 (used by both normal and large furnaces)
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
    // Slots 5-17 (only used by large furnaces, but always present in table)
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
    pub current_fuel_def_id: Option<u64>,
    pub remaining_fuel_burn_time_secs: Option<f32>,
    pub health: f32,
    pub max_health: f32,
    pub is_destroyed: bool,
    pub destroyed_at: Option<Timestamp>,
    pub last_hit_time: Option<Timestamp>,
    pub last_damaged_by: Option<Identity>,

    // --- Smelting progress for each slot ---
    // Slots 0-4 (used by both normal and large furnaces)
    pub slot_0_cooking_progress: Option<CookingProgress>,
    pub slot_1_cooking_progress: Option<CookingProgress>,
    pub slot_2_cooking_progress: Option<CookingProgress>,
    pub slot_3_cooking_progress: Option<CookingProgress>,
    pub slot_4_cooking_progress: Option<CookingProgress>,
    // Slots 5-17 (only used by large furnaces, but always present in table)
    pub slot_5_cooking_progress: Option<CookingProgress>,
    pub slot_6_cooking_progress: Option<CookingProgress>,
    pub slot_7_cooking_progress: Option<CookingProgress>,
    pub slot_8_cooking_progress: Option<CookingProgress>,
    pub slot_9_cooking_progress: Option<CookingProgress>,
    pub slot_10_cooking_progress: Option<CookingProgress>,
    pub slot_11_cooking_progress: Option<CookingProgress>,
    pub slot_12_cooking_progress: Option<CookingProgress>,
    pub slot_13_cooking_progress: Option<CookingProgress>,
    pub slot_14_cooking_progress: Option<CookingProgress>,
    pub slot_15_cooking_progress: Option<CookingProgress>,
    pub slot_16_cooking_progress: Option<CookingProgress>,
    pub slot_17_cooking_progress: Option<CookingProgress>,
    
    // --- Monument Placeable System ---
    pub is_monument: bool, // If true, this is a permanent monument placeable (indestructible, public access)
    pub active_user_id: Option<Identity>, // Player currently using this container (for safe zone exclusivity)
    pub active_user_since: Option<Timestamp>, // When the active user started using this container
}

// Schedule Table for per-furnace processing
#[spacetimedb::table(accessor = furnace_processing_schedule, scheduled(process_furnace_logic_scheduled))]
#[derive(Clone)]
pub struct FurnaceProcessingSchedule {
    #[primary_key]
    pub furnace_id: u64,
    pub scheduled_at: ScheduleAt,
}

/******************************************************************************
 *                           REDUCERS (Generic Handlers)                        *
 ******************************************************************************/

/// --- Move Item to Furnace ---
#[spacetimedb::reducer]
pub fn move_item_to_furnace(ctx: &ReducerContext, furnace_id: u32, target_slot_index: u8, item_instance_id: u64) -> Result<(), String> {
    let (_player, mut furnace) = validate_furnace_interaction(ctx, furnace_id)?;
    inventory_management::handle_move_to_container_slot(ctx, &mut furnace, target_slot_index, item_instance_id)?;
    ctx.db.furnace().id().update(furnace.clone());
    schedule_next_furnace_processing(ctx, furnace_id);
    Ok(())
}

/// --- Remove Fuel from Furnace ---
#[spacetimedb::reducer]
pub fn quick_move_from_furnace(ctx: &ReducerContext, furnace_id: u32, source_slot_index: u8) -> Result<(), String> {
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
pub fn move_item_within_furnace(
    ctx: &ReducerContext,
    furnace_id: u32,
    source_slot_index: u8,
    target_slot_index: u8,
) -> Result<(), String> {
    let (_player, mut furnace) = validate_furnace_interaction(ctx, furnace_id)?;
    
    // Save cooking progress before move (since set_slot clears it)
    use crate::cooking::CookableAppliance;
    let source_progress = furnace.get_slot_cooking_progress(source_slot_index);
    let target_progress = furnace.get_slot_cooking_progress(target_slot_index);
    let source_had_item = furnace.get_slot_instance_id(source_slot_index).is_some();
    let target_had_item = furnace.get_slot_instance_id(target_slot_index).is_some();
    
    inventory_management::handle_move_within_container(ctx, &mut furnace, source_slot_index, target_slot_index)?;
    
    // Transfer cooking progress based on what happened:
    // - Move to empty slot: source progress -> target
    // - Swap: exchange progress
    // - Merge: target keeps its progress (items combined there)
    if source_had_item && !target_had_item {
        // Move to empty slot: transfer source progress to target
        furnace.set_slot_cooking_progress(target_slot_index, source_progress);
    } else if source_had_item && target_had_item {
        // Check if it was a swap (source slot now has an item) or merge (source slot empty)
        if furnace.get_slot_instance_id(source_slot_index).is_some() {
            // Swap: exchange cooking progress
            furnace.set_slot_cooking_progress(target_slot_index, source_progress);
            furnace.set_slot_cooking_progress(source_slot_index, target_progress);
        }
        // If merge: target keeps its progress (already in place), source was cleared
    }
    
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
    
    // IMPORTANT: Keep cooking progress on source slot when splitting (same as compost keeps timestamp)
    // The remaining stack continues from where it was - only the new split item starts fresh
    // Note: Progress is per-slot, so the remaining stack will continue cooking with existing progress
    // The new split item in target slot will start cooking fresh when placed (no progress on new slot)
    
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
pub fn move_item_from_furnace_to_player_slot(
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
        ctx.sender(), quantity_to_split, source_furnace_id, source_slot_index, target_slot_type, target_slot_index
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

    // IMPORTANT: Keep cooking progress on source slot when splitting (same as compost keeps timestamp)
    // The remaining stack continues from where it was - only the new split item starts fresh
    // Note: Progress is per-slot, so the remaining stack will continue cooking with existing progress

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
    let sender_id = ctx.sender(); 
    let furnaces = ctx.db.furnace();
    let mut inventory_items = ctx.db.inventory_item(); 

    log::info!(
        "[SplitMoveFromFurnace] Player {:?} splitting {} from furnace {} slot {} to {} slot {}",
        sender_id, quantity_to_split, source_furnace_id, source_slot_index, target_slot_type, target_slot_index
    );

    // --- 1. Find Source Furnace & Item ID --- 
    let furnace = furnaces.id().find(source_furnace_id)
        .ok_or(format!("Source furnace {} not found", source_furnace_id))?;
    
    if source_slot_index >= furnace.num_slots() as u8 {
        return Err(format!("Invalid source fuel slot index: {}", source_slot_index));
    }

    let source_instance_id = furnace.get_slot_instance_id(source_slot_index)
        .ok_or(format!("No item found in source furnace slot {}", source_slot_index))?;

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
            // `move_item_to_furnace` expects the item to come from player inventory.
            // The new_item_instance_id is already in player's inventory due to split_stack_helper's new location.
            move_item_to_furnace(ctx, source_furnace_id, target_slot_index as u8, new_item_instance_id)
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
    let sender_id = ctx.sender();
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
    let sender_id = ctx.sender();
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

/// --- Split Furnace Ore Evenly ---
/// Distributes the chosen ore type evenly across all slots that have that ore + empty slots.
/// Picks the ore type with the largest total quantity (or first by slot order if tie).
/// Use case: Deposit a stack of Metal Ore, click Split, then light furnace to maximize burn rate.
#[spacetimedb::reducer]
pub fn split_furnace_ore_evenly(ctx: &ReducerContext, furnace_id: u32) -> Result<(), String> {
    use crate::cooking::CookableAppliance;

    let (_player, mut furnace) = validate_furnace_interaction(ctx, furnace_id)?;
    let item_defs = ctx.db.item_definition();
    let inventory_items = ctx.db.inventory_item();
    let num_slots = furnace.num_slots() as u8;

    // 1. Find stackable smeltable items (ore) - items with cooked_item_def_name that are stackable
    let mut def_totals: std::collections::HashMap<u64, (u32, u8)> = std::collections::HashMap::new(); // def_id -> (total_qty, first_slot)
    for slot in 0..num_slots {
        if let (Some(inst_id), Some(def_id)) = (
            furnace.get_slot_instance_id(slot),
            furnace.get_slot_def_id(slot),
        ) {
            let item = inventory_items.instance_id().find(inst_id);
            let def = item_defs.id().find(def_id);
            if let (Some(item), Some(def)) = (item, def) {
                if def.is_stackable && def.cooked_item_def_name.is_some() && item.quantity > 0 {
                    let entry = def_totals.entry(def_id).or_insert((0, slot));
                    entry.0 += item.quantity;
                    if slot < entry.1 {
                        entry.1 = slot;
                    }
                }
            }
        }
    }

    // 2. Pick ore type with largest total (tie: lowest slot index)
    let (chosen_def_id, (total_qty, _)) = def_totals
        .into_iter()
        .max_by(|a, b| a.1 .0.cmp(&b.1 .0).then_with(|| b.1 .1.cmp(&a.1 .1)))
        .ok_or("No stackable smeltable ore found in furnace.")?;

    // 3. Target slots: same def_id + empty
    let mut target_slots: Vec<u8> = Vec::new();
    for slot in 0..num_slots {
        let slot_def = furnace.get_slot_def_id(slot);
        let is_empty = furnace.get_slot_instance_id(slot).is_none();
        let is_same_ore = slot_def == Some(chosen_def_id);
        if is_empty || is_same_ore {
            target_slots.push(slot);
        }
    }

    let n = target_slots.len();
    if n < 2 || total_qty < 2 {
        return Err("Need at least 2 slots and 2 ore to split.".to_string());
    }

    // 4. Desired amount per slot: first (total % n) slots get +1 extra
    let per_slot = total_qty / n as u32;
    let remainder = (total_qty % n as u32) as usize;
    let mut desired: Vec<(u8, u32)> = target_slots
        .iter()
        .enumerate()
        .map(|(i, &s)| (s, per_slot + if i < remainder { 1 } else { 0 }))
        .collect();

    // 5. Iteratively balance using handle_split_within_container
    let max_iterations = (n * 2) as usize; // Safety limit
    for _ in 0..max_iterations {
        // Find slot with excess and slot with deficit
        let mut excess_slot: Option<(u8, u32)> = None;
        let mut deficit_slot: Option<(u8, u32)> = None;
        for &(slot, want) in &desired {
            let current = furnace
                .get_slot_instance_id(slot)
                .and_then(|id| inventory_items.instance_id().find(id))
                .map(|i| i.quantity)
                .unwrap_or(0);
            if current > want {
                excess_slot = Some((slot, current - want));
            } else if current < want {
                deficit_slot = Some((slot, want - current));
            }
        }
        let (src, to_split) = match excess_slot {
            Some(x) => x,
            None => break, // Balanced
        };
        let (dst, need) = match deficit_slot {
            Some(x) => x,
            None => break,
        };
        let qty = min(to_split, need);
        if qty == 0 {
            break;
        }
        inventory_management::handle_split_within_container(ctx, &mut furnace, src, dst, qty)?;
        // Clear cooking progress: target gets fresh ore; source if emptied
        furnace.set_slot_cooking_progress(dst, None);
        if furnace.get_slot_instance_id(src).is_none() {
            furnace.set_slot_cooking_progress(src, None);
        }
    }

    ctx.db.furnace().id().update(furnace.clone());
    schedule_next_furnace_processing(ctx, furnace_id);
    log::debug!("Player {:?} split furnace {} ore evenly.", ctx.sender(), furnace_id);
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
        log::info!("Furnace {} extinguished by player {:?}.", furnace.id, ctx.sender());
    } else {
        if !check_if_furnace_has_fuel(ctx, &furnace) {
            return Err("Cannot light furnace, requires fuel.".to_string());
        }
        
        furnace.is_burning = true;
        log::info!("Furnace {} lit by player {:?}.", furnace.id, ctx.sender());
    }
    ctx.db.furnace().id().update(furnace.clone());
    schedule_next_furnace_processing(ctx, furnace_id);
    Ok(())
}

// Reducer to place a furnace
#[spacetimedb::reducer]
pub fn place_furnace(ctx: &ReducerContext, item_instance_id: u64, world_x: f32, world_y: f32) -> Result<(), String> {
    let sender_id = ctx.sender();
    let inventory_items = ctx.db.inventory_item();
    let item_defs = ctx.db.item_definition();
    let players = ctx.db.player();
    let furnaces = ctx.db.furnace();

    // Look up Item Definition IDs by Name
    let furnace_def_id = item_defs.iter()
        .find(|def| def.name == "Furnace")
        .map(|def| def.id)
        .ok_or_else(|| "Item definition for 'Furnace' not found.".to_string())?;

    let large_furnace_def_id = item_defs.iter()
        .find(|def| def.name == "Large Furnace")
        .map(|def| def.id)
        .ok_or_else(|| "Item definition for 'Large Furnace' not found.".to_string())?;

    let wood_def_id = item_defs.iter()
        .find(|def| def.name == "Wood")
        .map(|def| def.id)
        .ok_or_else(|| "Item definition for 'Wood' not found.".to_string())?;

    log::info!(
        "[PlaceFurnace] Player {:?} attempting placement of item {} at ({:.1}, {:.1})",
        sender_id, item_instance_id, world_x, world_y
    );

    // Check if position is within monument zones (ALK stations, rune stones, hot springs, quarries)
    crate::building::check_monument_zone_placement(ctx, world_x, world_y)?;

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

    // Determine furnace type based on item definition
    let (furnace_type, is_large) = if item.item_def_id == large_furnace_def_id {
        (FURNACE_TYPE_LARGE, true)
    } else if item.item_def_id == furnace_def_id {
        (FURNACE_TYPE_NORMAL, false)
    } else {
        return Err("Item is not a furnace.".to_string());
    };

    // Check placement distance (large furnaces have a larger placement range)
    let distance_squared = (player.position_x - world_x).powi(2) + (player.position_y - world_y).powi(2);
    let (max_distance, max_distance_squared) = if is_large {
        (LARGE_FURNACE_PLACEMENT_MAX_DISTANCE, LARGE_FURNACE_PLACEMENT_MAX_DISTANCE_SQUARED)
    } else {
        (FURNACE_PLACEMENT_MAX_DISTANCE, FURNACE_PLACEMENT_MAX_DISTANCE_SQUARED)
    };
    if distance_squared > max_distance_squared {
        return Err(format!("Furnace placement too far away (max distance: {:.1})", max_distance));
    }

    // Check if placement position is on water (including hot springs)
    if crate::environment::is_position_on_water(ctx, world_x, world_y) {
        return Err("Cannot place furnace on water.".to_string());
    }

    // Check for collisions with other furnaces
    let placement_collision_radius = get_furnace_collision_radius(furnace_type);
    let placement_collision_distance_squared = (placement_collision_radius * 2.0) * (placement_collision_radius * 2.0);
    
    for existing_furnace in furnaces.iter() {
        if existing_furnace.is_destroyed {
            continue;
        }
        let existing_collision_radius = get_furnace_collision_radius(existing_furnace.furnace_type);
        let min_distance = placement_collision_radius + existing_collision_radius;
        let min_distance_squared = min_distance * min_distance;
        
        let dx = existing_furnace.pos_x - world_x;
        let dy = existing_furnace.pos_y - world_y;
        let distance_squared = dx * dx + dy * dy;
        if distance_squared < min_distance_squared {
            return Err("Cannot place furnace: too close to existing furnace.".to_string());
        }
    }

    // Check for collisions with campfires
    for existing_campfire in ctx.db.campfire().iter() {
        if existing_campfire.is_destroyed {
            continue;
        }
        let campfire_collision_radius = crate::campfire::CAMPFIRE_COLLISION_RADIUS;
        let min_distance = placement_collision_radius + campfire_collision_radius;
        let min_distance_squared = min_distance * min_distance;
        
        let dx = existing_campfire.pos_x - world_x;
        let dy = existing_campfire.pos_y - world_y;
        let distance_squared = dx * dx + dy * dy;
        if distance_squared < min_distance_squared {
            return Err("Cannot place furnace: too close to existing campfire.".to_string());
        }
    }

    crate::placeable_collision::check_placeable_overlap(ctx, world_x, world_y, 48.0, 48.0, true)?;

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
    // For normal furnace: 96px height, 10px offset -> adjusted_y = world_y + 48 + 10
    // For large furnace: 256px height, larger offset -> adjusted_y = world_y + 128 + offset
    let adjusted_y = if is_large {
        world_y + 128.0 + 0.0 // 128 = LARGE_FURNACE_HEIGHT/2 (256/2), 0 = LARGE_FURNACE_RENDER_Y_OFFSET
    } else {
        world_y + 48.0 + 10.0 // 48 = FURNACE_HEIGHT/2 (96/2), 10 = FURNACE_RENDER_Y_OFFSET
    };
    
    let new_furnace = Furnace {
        id: 0, // Auto-generated
        pos_x: world_x,
        pos_y: adjusted_y,
        chunk_index: calculate_chunk_index(world_x, world_y),
        placed_by: sender_id,
        placed_at: ctx.timestamp,
        is_burning: false,
        furnace_type,
        slot_instance_id_0: Some(fuel_item.instance_id),
        slot_def_id_0: Some(wood_def_id),
        slot_instance_id_1: None,
        slot_def_id_1: None,
        slot_instance_id_2: None,
        slot_def_id_2: None,
        slot_instance_id_3: None,
        slot_def_id_3: None,
        slot_instance_id_4: None,
        slot_def_id_4: None,
        // Large furnace additional slots (5-17) - initialize to None
        slot_instance_id_5: None,
        slot_def_id_5: None,
        slot_instance_id_6: None,
        slot_def_id_6: None,
        slot_instance_id_7: None,
        slot_def_id_7: None,
        slot_instance_id_8: None,
        slot_def_id_8: None,
        slot_instance_id_9: None,
        slot_def_id_9: None,
        slot_instance_id_10: None,
        slot_def_id_10: None,
        slot_instance_id_11: None,
        slot_def_id_11: None,
        slot_instance_id_12: None,
        slot_def_id_12: None,
        slot_instance_id_13: None,
        slot_def_id_13: None,
        slot_instance_id_14: None,
        slot_def_id_14: None,
        slot_instance_id_15: None,
        slot_def_id_15: None,
        slot_instance_id_16: None,
        slot_def_id_16: None,
        slot_instance_id_17: None,
        slot_def_id_17: None,
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
        // Large furnace additional cooking progress slots (5-17) - initialize to None
        slot_5_cooking_progress: None,
        slot_6_cooking_progress: None,
        slot_7_cooking_progress: None,
        slot_8_cooking_progress: None,
        slot_9_cooking_progress: None,
        slot_10_cooking_progress: None,
        slot_11_cooking_progress: None,
        slot_12_cooking_progress: None,
        slot_13_cooking_progress: None,
        slot_14_cooking_progress: None,
        slot_15_cooking_progress: None,
        slot_16_cooking_progress: None,
        slot_17_cooking_progress: None,
        // Monument placeable system (player-placed furnaces are not monuments)
        is_monument: false,
        active_user_id: None,
        active_user_since: None,
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
    
    // Track quest progress for furnace placement
    if let Err(e) = crate::quests::track_quest_progress(
        ctx,
        sender_id,
        crate::quests::QuestObjectiveType::PlaceFurnace,
        None,
        1,
    ) {
        log::error!("Failed to track quest progress for furnace placement: {}", e);
    }

    Ok(())
}

// Scheduled processing logic
#[spacetimedb::reducer]
pub fn process_furnace_logic_scheduled(ctx: &ReducerContext, schedule_args: FurnaceProcessingSchedule) -> Result<(), String> {
    // Security check
    if ctx.sender() != ctx.identity() {
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
    
    // --- Auto-release container access if user is offline or too far ---
    if let Some(active_user) = furnace.active_user_id {
        let should_release = match ctx.db.player().identity().find(&active_user) {
            Some(player) => {
                // Player is online - check distance (use appropriate range for furnace size)
                let dx = player.position_x - furnace.pos_x;
                let dy = player.position_y - furnace.pos_y;
                let dist_sq = dx * dx + dy * dy;
                let base_dist_sq = if furnace.is_monument && furnace.furnace_type == FURNACE_TYPE_LARGE {
                    PLAYER_MONUMENT_LARGE_FURNACE_INTERACTION_DISTANCE_SQUARED
                } else if furnace.furnace_type == FURNACE_TYPE_LARGE {
                    PLAYER_LARGE_FURNACE_INTERACTION_DISTANCE_SQUARED
                } else {
                    PLAYER_FURNACE_INTERACTION_DISTANCE_SQUARED
                };
                dist_sq > base_dist_sq * 2.0 // Give some buffer
            }
            None => true // Player is offline
        };
        if should_release {
            furnace.active_user_id = None;
            furnace.active_user_since = None;
            needs_update = true;
            log::debug!("[ProcessFurnaceScheduled] Released container access for furnace {} (user offline/too far)", furnace_id);
        }
    }

    if furnace.is_burning {
        // --- OPTIMIZATION: Cache bellows flag computed once per tick ---
        let cached_has_bellows = has_reed_bellows(ctx, &furnace);
        
        // Process fuel consumption (using cached bellows)
        if let Some(remaining_time) = furnace.remaining_fuel_burn_time_secs {
            let fuel_burn_multiplier = if cached_has_bellows { 1.5 } else { 1.0 };
            let adjusted_time_increment = FURNACE_PROCESS_INTERVAL_SECS as f32 / fuel_burn_multiplier;
            
            if remaining_time <= adjusted_time_increment {
                // Fuel unit completely burned, consume it and check for more
                let mut consumed_and_reloaded_from_stack = false;
                
                // Find the current fuel slot and consume one unit
                for i in 0..furnace.num_slots() as u8 {
                    if furnace.get_slot_def_id(i) == furnace.current_fuel_def_id {
                        if let Some(instance_id) = furnace.get_slot_instance_id(i) {
                            if let Some(mut fuel_item) = ctx.db.inventory_item().instance_id().find(instance_id) {
                                let consumed_item_def_id = fuel_item.item_def_id;
                                fuel_item.quantity -= 1;

                                if fuel_item.quantity > 0 {
                                    // Still has fuel, update quantity and reload burn time
                                    ctx.db.inventory_item().instance_id().update(fuel_item.clone());
                                    // Set burn time for Wood (5.0 seconds)
                                    furnace.remaining_fuel_burn_time_secs = Some(5.0);
                                    consumed_and_reloaded_from_stack = true;
                                } else {
                                    // No more fuel in this stack, remove item and clear slot
                                    ctx.db.inventory_item().instance_id().delete(instance_id);
                                    furnace.set_slot(i, None, None);
                                    furnace.current_fuel_def_id = None; 
                                    furnace.remaining_fuel_burn_time_secs = None;
                                }
                                needs_update = true;

                                // Produce charcoal from consumed Wood
                                if let Some(consumed_def) = ctx.db.item_definition().id().find(consumed_item_def_id) {
                                    if consumed_def.name == "Wood" && ctx.rng().gen_range(0..100) < CHARCOAL_PRODUCTION_CHANCE {
                                        if let Some(charcoal_def) = get_item_def_by_name(ctx, "Charcoal") {
                                            let _ = try_add_charcoal_to_furnace_or_drop(ctx, &mut furnace, &charcoal_def, 1);
                                            needs_update = true; // Charcoal might have been added to slots
                                        }
                                    }
                                }
                                break; 
                            } else {
                                // Item was deleted elsewhere (e.g. by another reducer) but slot still references it - clear orphaned slot
                                log::warn!("Furnace {} slot {} references item {} which is not in DB - clearing orphaned slot.", furnace_id, i, instance_id);
                                furnace.set_slot(i, None, None);
                                furnace.current_fuel_def_id = None;
                                furnace.remaining_fuel_burn_time_secs = None;
                                needs_update = true;
                                break;
                            }
                        }
                    }
                }

                // If we didn't reload from existing stack, try to find new fuel
                if !consumed_and_reloaded_from_stack {
                    if !find_and_consume_next_fuel(ctx, &mut furnace) {
                        furnace.is_burning = false;
                        log::info!("Furnace {} ran out of fuel and was extinguished.", furnace_id);
                        needs_update = true;
                    } else {
                        needs_update = true;
                    }
                }
            } else {
                // Consume fuel time
                furnace.remaining_fuel_burn_time_secs = Some(remaining_time - adjusted_time_increment);
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
            // --- OPTIMIZATION: Cache fuel instance ID (avoids re-scanning all slots) ---
            let current_fuel_instance_id: Option<u64> = furnace.current_fuel_def_id.and_then(|fuel_def_id| {
                (0..furnace.num_slots() as u8).find_map(|i| {
                    if furnace.get_slot_def_id(i) == Some(fuel_def_id) {
                        furnace.get_slot_instance_id(i)
                    } else {
                        None
                    }
                })
            });

            // --- OPTIMIZATION: Inline smelting speed multiplier using cached bellows flag ---
            let mut smelting_speed_multiplier = match furnace.furnace_type {
                FURNACE_TYPE_LARGE => 2.0,
                _ => 1.0,
            };
            if cached_has_bellows { smelting_speed_multiplier *= 1.2; }
            if crate::rune_stone::is_position_in_red_rune_zone(ctx, furnace.pos_x, furnace.pos_y) {
                smelting_speed_multiplier *= 2.0;
            }
            let adjusted_smelting_time_increment = FURNACE_PROCESS_INTERVAL_SECS as f32 * smelting_speed_multiplier;
            
            let smelting_result = crate::cooking::process_appliance_cooking_tick(
                ctx, 
                &mut furnace, 
                adjusted_smelting_time_increment,
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
            // --- COMBAT LADLE HEATING ---
            if crate::combat_ladle_heating::process_combat_ladle_heating(ctx, &mut furnace, adjusted_smelting_time_increment, current_fuel_instance_id) {
                needs_update = true;
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
        let interval = TimeDuration::from_micros((FURNACE_PROCESS_INTERVAL_SECS * 1_000_000) as i64);
        let schedule = FurnaceProcessingSchedule {
            furnace_id: furnace_id as u64,
            scheduled_at: ScheduleAt::Interval(interval), // PERIODIC - same as campfire
        };
        match ctx.db.furnace_processing_schedule().try_insert(schedule) {
            Ok(_) => log::debug!("Scheduled periodic processing for furnace {}", furnace_id),
            Err(e) => {
                log::error!("Failed to schedule furnace {} processing: {}", furnace_id, e);
                return Err(format!("Failed to schedule furnace processing: {}", e));
            }
        }
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
        match self.furnace_type {
            FURNACE_TYPE_LARGE => NUM_LARGE_FURNACE_SLOTS,
            _ => NUM_FUEL_SLOTS,
        }
    }

    fn get_slot_instance_id(&self, slot_index: u8) -> Option<u64> {
        // Check bounds based on furnace type
        if slot_index as usize >= self.num_slots() {
            return None;
        }
        match slot_index {
            0 => self.slot_instance_id_0,
            1 => self.slot_instance_id_1,
            2 => self.slot_instance_id_2,
            3 => self.slot_instance_id_3,
            4 => self.slot_instance_id_4,
            // Large furnace additional slots (5-17)
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

    fn get_slot_def_id(&self, slot_index: u8) -> Option<u64> {
        // Check bounds based on furnace type
        if slot_index as usize >= self.num_slots() {
            return None;
        }
        match slot_index {
            0 => self.slot_def_id_0,
            1 => self.slot_def_id_1,
            2 => self.slot_def_id_2,
            3 => self.slot_def_id_3,
            4 => self.slot_def_id_4,
            // Large furnace additional slots (5-17)
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

    fn set_slot(&mut self, slot_index: u8, instance_id: Option<u64>, def_id: Option<u64>) {
        // Check bounds based on furnace type
        if slot_index as usize >= self.num_slots() {
            log::error!("[Furnace] Attempted to set slot {} on furnace_type {} (max slots: {})", 
                slot_index, self.furnace_type, self.num_slots());
            return;
        }
        match slot_index {
            0 => { self.slot_instance_id_0 = instance_id; self.slot_def_id_0 = def_id; }
            1 => { self.slot_instance_id_1 = instance_id; self.slot_def_id_1 = def_id; }
            2 => { self.slot_instance_id_2 = instance_id; self.slot_def_id_2 = def_id; }
            3 => { self.slot_instance_id_3 = instance_id; self.slot_def_id_3 = def_id; }
            4 => { self.slot_instance_id_4 = instance_id; self.slot_def_id_4 = def_id; }
            // Large furnace additional slots (5-17)
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
            _ => { log::error!("[Furnace] Attempted to set invalid slot index: {}", slot_index); }
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
        for slot_index in 0..furnace.num_slots() {
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
    let sender_id = ctx.sender();
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

    // Check interaction distance - larger furnaces allow interaction from farther away
    let (max_dist_sq, max_dist) = if furnace.is_monument && furnace.furnace_type == FURNACE_TYPE_LARGE {
        (PLAYER_MONUMENT_LARGE_FURNACE_INTERACTION_DISTANCE_SQUARED, PLAYER_MONUMENT_LARGE_FURNACE_INTERACTION_DISTANCE)
    } else if furnace.furnace_type == FURNACE_TYPE_LARGE {
        (PLAYER_LARGE_FURNACE_INTERACTION_DISTANCE_SQUARED, PLAYER_LARGE_FURNACE_INTERACTION_DISTANCE)
    } else {
        (PLAYER_FURNACE_INTERACTION_DISTANCE_SQUARED, PLAYER_FURNACE_INTERACTION_DISTANCE)
    };
    let distance_squared = (player.position_x - furnace.pos_x).powi(2) + (player.position_y - furnace.pos_y).powi(2);
    if distance_squared > max_dist_sq {
        return Err(format!(
            "Too far from furnace (distance: {:.1}, max: {:.1})",
            distance_squared.sqrt(),
            max_dist
        ));
    }

    // Check safe zone container exclusivity
    crate::active_effects::validate_safe_zone_container_access(
        ctx,
        furnace.pos_x,
        furnace.pos_y,
        furnace.active_user_id,
        furnace.active_user_since,
    )?;

    Ok((player, furnace))
}

/// --- Open Furnace Container ---
/// Called when a player opens the furnace UI. Sets the active_user_id to prevent
/// other players from using this container in safe zones.
#[spacetimedb::reducer]
pub fn open_furnace_container(ctx: &ReducerContext, furnace_id: u32) -> Result<(), String> {
    let (_player, mut furnace) = validate_furnace_interaction(ctx, furnace_id)?;
    
    // Set the active user
    furnace.active_user_id = Some(ctx.sender());
    furnace.active_user_since = Some(ctx.timestamp);
    
    ctx.db.furnace().id().update(furnace);
    log::debug!("Player {:?} opened furnace {} container", ctx.sender(), furnace_id);
    
    Ok(())
}

/// --- Close Furnace Container ---
/// Called when a player closes the furnace UI. Clears the active_user_id to allow
/// other players to use this container.
#[spacetimedb::reducer]
pub fn close_furnace_container(ctx: &ReducerContext, furnace_id: u32) -> Result<(), String> {
    let furnace = ctx.db.furnace().id().find(&furnace_id)
        .ok_or_else(|| format!("Furnace {} not found", furnace_id))?;
    
    // Only clear if this player is the active user
    if furnace.active_user_id == Some(ctx.sender()) {
        let mut furnace = furnace;
        furnace.active_user_id = None;
        furnace.active_user_since = None;
        ctx.db.furnace().id().update(furnace);
        log::debug!("Player {:?} closed furnace {} container", ctx.sender(), furnace_id);
    }
    
    Ok(())
}

pub(crate) fn check_if_furnace_has_fuel(ctx: &ReducerContext, furnace: &Furnace) -> bool {
    let wood_def_id = match get_item_def_by_name(ctx, "Wood") {
        Some(def) => def.id,
        None => {
            log::error!("Wood item definition not found!");
            return false;
        }
    };

    for slot_index in 0..furnace.num_slots() {
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

    for slot_index in 0..furnace.num_slots() {
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
                } else {
                    // Slot references wood that no longer exists in DB - clear orphaned slot
                    log::warn!("Furnace {} slot {} references item {} which is not in DB - clearing orphaned slot.", furnace.id, slot_index, instance_id);
                    furnace.set_slot(slot_index as u8, None, None);
                }
            }
        }
    }
    false
}

fn get_item_def_by_name<'a>(ctx: &'a ReducerContext, name: &str) -> Option<ItemDefinition> {
    ctx.db.item_definition().iter().find(|def| def.name == name)
}



// --- Helper: Try to add charcoal to furnace or drop it ---
// Returns Ok(bool) where true means furnace struct was modified (charcoal added to slots)
// and false means it was dropped or stacked with existing items.
fn try_add_charcoal_to_furnace_or_drop(
    ctx: &ReducerContext,
    furnace: &mut Furnace,
    charcoal_def: &ItemDefinition,
    quantity: u32
) -> Result<bool, String> {
    let mut inventory_items_table = ctx.db.inventory_item();
    let charcoal_def_id = charcoal_def.id;
    let charcoal_stack_size = charcoal_def.stack_size;
    let mut charcoal_added_to_furnace_slots = false;

    // 1. Try to stack with existing charcoal in furnace slots
    for i in 0..furnace.num_slots() as u8 {
        if furnace.get_slot_def_id(i) == Some(charcoal_def_id) {
            if let Some(instance_id) = furnace.get_slot_instance_id(i) {
                if let Some(mut existing_charcoal_item) = inventory_items_table.instance_id().find(instance_id) {
                    if existing_charcoal_item.quantity < charcoal_stack_size {
                        let can_add = charcoal_stack_size - existing_charcoal_item.quantity;
                        let to_add = min(quantity, can_add); // quantity is usually 1 from charcoal production
                        existing_charcoal_item.quantity += to_add;
                        inventory_items_table.instance_id().update(existing_charcoal_item);
                        log::info!("[Charcoal] Furnace {}: Stacked {} charcoal onto existing stack in slot {}.", furnace.id, to_add, i);
                        // Furnace struct (slots) didn't change, only InventoryItem quantity
                        // Return false because furnace struct itself was not modified for its slots.
                        return Ok(false); 
                    }
                }
            }
        }
    }

    // 2. Try to place in an empty slot
    for i in 0..furnace.num_slots() as u8 {
        if furnace.get_slot_instance_id(i).is_none() {
            let new_charcoal_location = ItemLocation::Container(ContainerLocationData {
                container_type: ContainerType::Furnace,
                container_id: furnace.id as u64,
                slot_index: i,
            });
            let new_charcoal_item = InventoryItem {
                instance_id: 0, 
                item_def_id: charcoal_def_id,
                quantity, // This will be 1 from production
                location: new_charcoal_location,
                item_data: None,
            };
            match inventory_items_table.try_insert(new_charcoal_item) {
                Ok(inserted_item) => {
                    furnace.set_slot(i, Some(inserted_item.instance_id), Some(charcoal_def_id));
                    log::info!("[Charcoal] Furnace {}: Placed {} charcoal into empty slot {}.", furnace.id, quantity, i);
                    charcoal_added_to_furnace_slots = true; // Furnace struct was modified
                    return Ok(charcoal_added_to_furnace_slots);
                }
                Err(e) => {
                    log::error!("[Charcoal] Furnace {}: Failed to insert new charcoal item for slot {}: {:?}", furnace.id, i, e);
                    // Continue to drop if insert fails
                    break; 
                }
            }
        }
    }

    // 3. If not added to furnace (full or insert error), drop it
    log::info!("[Charcoal] Furnace {}: Slots full or error encountered. Dropping {} charcoal.", furnace.id, quantity);
    let drop_x = furnace.pos_x;
    let drop_y = furnace.pos_y + crate::dropped_item::DROP_OFFSET / 2.0; 
    create_dropped_item_entity(ctx, charcoal_def_id, quantity, drop_x, drop_y)?;
    
    Ok(charcoal_added_to_furnace_slots) // False, as it was dropped or failed to add to slots by modifying furnace struct
}

/// Check if a Reed Bellows is present in any of the furnace's fuel slots
pub fn has_reed_bellows(ctx: &ReducerContext, furnace: &Furnace) -> bool {
    let item_defs_table = ctx.db.item_definition();
    
    // Check all fuel slots for Reed Bellows
    for slot_index in 0..furnace.num_slots() {
        if let Some(fuel_def_id) = furnace.get_slot_def_id(slot_index as u8) {
            if let Some(item_def) = item_defs_table.id().find(fuel_def_id) {
                if item_def.name == "Reed Bellows" {
                    log::debug!("Reed Bellows found in furnace {} slot {}", furnace.id, slot_index);
                    return true;
                }
            }
        }
    }
    false
}

/// Get the fuel burn rate multiplier based on whether Reed Bellows is present
/// Reed Bellows makes fuel burn 50% slower (multiplier = 1.5)
pub fn get_fuel_burn_rate_multiplier(ctx: &ReducerContext, furnace: &Furnace) -> f32 {
    if has_reed_bellows(ctx, furnace) {
        1.5 // Fuel burns 50% slower with bellows (lasts 1.5x longer)
    } else {
        1.0 // Normal burn rate
    }
}

/// Get the smelting speed multiplier based on furnace type, Reed Bellows, and red rune stone proximity
/// Large furnace: 2x faster smelting (base multiplier = 2.0)
/// Reed Bellows makes smelting 20% faster (multiplier *= 1.2)
/// Red rune stone zone doubles smelting speed (multiplier *= 2.0)
/// Multipliers stack multiplicatively (e.g., large furnace + bellows = 2.0 * 1.2 = 2.4x)
pub fn get_smelting_speed_multiplier(ctx: &ReducerContext, furnace: &Furnace) -> f32 {
    // Large furnace smelts 2x faster (5s base -> 2.5s effective for Metal Ore)
    let mut multiplier = match furnace.furnace_type {
        FURNACE_TYPE_LARGE => 2.0,
        _ => 1.0, // Normal furnace: base speed
    };
    
    // Check for Reed Bellows (20% faster = 1.2x)
    if has_reed_bellows(ctx, furnace) {
        multiplier *= 1.2;
    }
    
    // Check for red rune stone zone (2x faster smelting)
    if crate::rune_stone::is_position_in_red_rune_zone(ctx, furnace.pos_x, furnace.pos_y) {
        multiplier *= 2.0;
    }
    
    multiplier
}

/// Get collision radius based on furnace type and monument status
pub(crate) fn get_furnace_collision_radius(furnace_type: u8) -> f32 {
    match furnace_type {
        FURNACE_TYPE_LARGE => LARGE_FURNACE_COLLISION_RADIUS,
        _ => FURNACE_COLLISION_RADIUS,
    }
}

/// Get collision radius for a specific furnace entity (accounts for monument status)
pub(crate) fn get_furnace_entity_collision_radius(furnace_type: u8, is_monument: bool) -> f32 {
    if is_monument && furnace_type == FURNACE_TYPE_LARGE {
        MONUMENT_LARGE_FURNACE_COLLISION_RADIUS
    } else {
        get_furnace_collision_radius(furnace_type)
    }
}

/// Get collision Y offset based on furnace type
pub(crate) fn get_furnace_collision_y_offset(furnace_type: u8) -> f32 {
    match furnace_type {
        FURNACE_TYPE_LARGE => LARGE_FURNACE_COLLISION_Y_OFFSET,
        _ => FURNACE_COLLISION_Y_OFFSET,
    }
}

// Implement CookableAppliance for Furnace (smelting only)
impl crate::cooking::CookableAppliance for Furnace {
    fn get_slot_cooking_progress(&self, slot_index: u8) -> Option<CookingProgress> {
        // Check bounds based on furnace type
        if slot_index as usize >= self.num_slots() {
            return None;
        }
        match slot_index {
            0 => self.slot_0_cooking_progress.clone(),
            1 => self.slot_1_cooking_progress.clone(),
            2 => self.slot_2_cooking_progress.clone(),
            3 => self.slot_3_cooking_progress.clone(),
            4 => self.slot_4_cooking_progress.clone(),
            // Large furnace additional slots (5-17)
            5 => self.slot_5_cooking_progress.clone(),
            6 => self.slot_6_cooking_progress.clone(),
            7 => self.slot_7_cooking_progress.clone(),
            8 => self.slot_8_cooking_progress.clone(),
            9 => self.slot_9_cooking_progress.clone(),
            10 => self.slot_10_cooking_progress.clone(),
            11 => self.slot_11_cooking_progress.clone(),
            12 => self.slot_12_cooking_progress.clone(),
            13 => self.slot_13_cooking_progress.clone(),
            14 => self.slot_14_cooking_progress.clone(),
            15 => self.slot_15_cooking_progress.clone(),
            16 => self.slot_16_cooking_progress.clone(),
            17 => self.slot_17_cooking_progress.clone(),
            _ => None,
        }
    }

    fn set_slot_cooking_progress(&mut self, slot_index: u8, progress: Option<CookingProgress>) {
        // Check bounds based on furnace type
        if slot_index as usize >= self.num_slots() {
            return;
        }
        match slot_index {
            0 => self.slot_0_cooking_progress = progress,
            1 => self.slot_1_cooking_progress = progress,
            2 => self.slot_2_cooking_progress = progress,
            3 => self.slot_3_cooking_progress = progress,
            4 => self.slot_4_cooking_progress = progress,
            // Large furnace additional slots (5-17)
            5 => self.slot_5_cooking_progress = progress,
            6 => self.slot_6_cooking_progress = progress,
            7 => self.slot_7_cooking_progress = progress,
            8 => self.slot_8_cooking_progress = progress,
            9 => self.slot_9_cooking_progress = progress,
            10 => self.slot_10_cooking_progress = progress,
            11 => self.slot_11_cooking_progress = progress,
            12 => self.slot_12_cooking_progress = progress,
            13 => self.slot_13_cooking_progress = progress,
            14 => self.slot_14_cooking_progress = progress,
            15 => self.slot_15_cooking_progress = progress,
            16 => self.slot_16_cooking_progress = progress,
            17 => self.slot_17_cooking_progress = progress,
            _ => {}
        }
    }

    fn get_appliance_world_position(&self) -> (f32, f32) {
        (self.pos_x, self.pos_y)
    }
}
