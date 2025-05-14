/******************************************************************************
 *                                                                            *
 * Defines the Campfire entity, its data structure, and associated logic.     *
 * Handles interactions like adding/removing fuel, lighting/extinguishing,    *
 * fuel consumption checks, and managing items within the campfire's fuel     *
 * slots. Uses generic handlers from inventory_management.rs where applicable.*
 *                                                                            *
 ******************************************************************************/

use spacetimedb::{Identity, Timestamp, ReducerContext, Table, log, SpacetimeType, TimeDuration, ScheduleAt};
use std::cmp::min;
use std::time::Duration;
use rand::Rng; // Added for random chance

// Import new models
use crate::models::{ContainerType, ItemLocation, EquipmentSlotType, ContainerLocationData}; // Added ContainerLocationData

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
use crate::environment::calculate_chunk_index; // Assuming helper is here or in utils
use crate::dropped_item::create_dropped_item_entity; // For dropping charcoal

// --- Constants ---
// Collision constants
pub(crate) const CAMPFIRE_COLLISION_RADIUS: f32 = 18.0;
pub(crate) const CAMPFIRE_COLLISION_Y_OFFSET: f32 = 10.0;
pub(crate) const PLAYER_CAMPFIRE_COLLISION_DISTANCE_SQUARED: f32 = 
    (super::PLAYER_RADIUS + CAMPFIRE_COLLISION_RADIUS) * (super::PLAYER_RADIUS + CAMPFIRE_COLLISION_RADIUS);
pub(crate) const CAMPFIRE_CAMPFIRE_COLLISION_DISTANCE_SQUARED: f32 = 
    (CAMPFIRE_COLLISION_RADIUS * 2.0) * (CAMPFIRE_COLLISION_RADIUS * 2.0);

// Interaction constants
pub(crate) const PLAYER_CAMPFIRE_INTERACTION_DISTANCE: f32 = 64.0;
pub(crate) const PLAYER_CAMPFIRE_INTERACTION_DISTANCE_SQUARED: f32 = 
    PLAYER_CAMPFIRE_INTERACTION_DISTANCE * PLAYER_CAMPFIRE_INTERACTION_DISTANCE;

// Warmth and fuel constants
pub(crate) const WARMTH_RADIUS: f32 = 150.0;
pub(crate) const WARMTH_RADIUS_SQUARED: f32 = WARMTH_RADIUS * WARMTH_RADIUS;
pub(crate) const WARMTH_PER_SECOND: f32 = 5.0;
pub(crate) const FUEL_CONSUME_INTERVAL_SECS: u64 = 5;
pub const NUM_FUEL_SLOTS: usize = 5;
const FUEL_CHECK_INTERVAL_SECS: u64 = 1;
pub const CAMPFIRE_PROCESS_INTERVAL_SECS: u64 = 1; // How often to run the main logic when burning
const CHARCOAL_PRODUCTION_CHANCE: u8 = 75; // 75% chance

/// --- Campfire Data Structure ---
/// Represents a campfire in the game world with position, owner, burning state,
/// fuel slots (using individual fields instead of arrays), and fuel consumption timing.
#[spacetimedb::table(name = campfire, public)]
#[derive(Clone)]
pub struct Campfire {
    #[primary_key]
    #[auto_inc]
    pub id: u32,
    pub pos_x: f32,
    pub pos_y: f32,
    pub chunk_index: u32,
    pub placed_by: Identity, // Track who placed it
    pub placed_at: Timestamp,
    pub is_burning: bool, // Is the fire currently lit?
    // Use individual fields instead of arrays
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
    pub current_fuel_def_id: Option<u64>,        // ADDED: Def ID of the currently burning fuel item
    pub remaining_fuel_burn_time_secs: Option<f32>, // ADDED: How much time is left for the current_fuel_def_id
}

// ADD NEW Schedule Table for per-campfire processing
#[spacetimedb::table(name = campfire_processing_schedule, scheduled(process_campfire_logic_scheduled))]
#[derive(Clone)]
pub struct CampfireProcessingSchedule {
    #[primary_key] // This will store the campfire_id to make the schedule unique per campfire
    pub campfire_id_for_schedule: u64,
    pub scheduled_at: ScheduleAt,
}

/******************************************************************************
 *                           REDUCERS (Generic Handlers)                        *
 ******************************************************************************/

/// --- Add Fuel to Campfire ---
/// Adds an item from the player's inventory as fuel to a specific campfire slot.
/// Validates the campfire interaction and fuel item, then uses the generic container handler
/// to move the item to the campfire. Updates the campfire state after successful addition.
#[spacetimedb::reducer]
pub fn add_fuel_to_campfire(ctx: &ReducerContext, campfire_id: u32, target_slot_index: u8, item_instance_id: u64) -> Result<(), String> {
    let (_player, mut campfire) = validate_campfire_interaction(ctx, campfire_id)?;
    inventory_management::handle_move_to_container_slot(ctx, &mut campfire, target_slot_index, item_instance_id)?;
    ctx.db.campfire().id().update(campfire.clone()); // Persist campfire slot changes
    schedule_next_campfire_processing(ctx, campfire_id); // Reschedule based on new fuel state
    Ok(())
}

/// --- Remove Fuel from Campfire ---
/// Removes the fuel item from a specific campfire slot and returns it to the player inventory/hotbar.
/// Uses the quick move logic (attempts merge, then finds first empty slot).
#[spacetimedb::reducer]
pub fn auto_remove_fuel_from_campfire(ctx: &ReducerContext, campfire_id: u32, source_slot_index: u8) -> Result<(), String> {
    let (_player, mut campfire) = validate_campfire_interaction(ctx, campfire_id)?;
    inventory_management::handle_quick_move_from_container(ctx, &mut campfire, source_slot_index)?;
    let still_has_fuel = check_if_campfire_has_fuel(ctx, &campfire);
    if !still_has_fuel && campfire.is_burning {
        campfire.is_burning = false;
        campfire.current_fuel_def_id = None;
        campfire.remaining_fuel_burn_time_secs = None;
        log::info!("Campfire {} extinguished as last valid fuel was removed.", campfire_id);
        // No need to cancel schedule, schedule_next_campfire_processing will handle it if called
    }
    ctx.db.campfire().id().update(campfire.clone());
    schedule_next_campfire_processing(ctx, campfire_id); // Reschedule based on new fuel state
    Ok(())
}

/// --- Split Stack Into Campfire ---
/// Splits a stack from player inventory into a campfire slot.
#[spacetimedb::reducer]
pub fn split_stack_into_campfire(
    ctx: &ReducerContext,
    source_item_instance_id: u64,
    quantity_to_split: u32,
    target_campfire_id: u32,
    target_slot_index: u8,
) -> Result<(), String> {
    let (_player, mut campfire) = validate_campfire_interaction(ctx, target_campfire_id)?;
    let mut source_item = get_player_item(ctx, source_item_instance_id)?;
    let new_item_target_location = ItemLocation::Container(crate::models::ContainerLocationData {
        container_type: ContainerType::Campfire,
        container_id: campfire.id as u64,
        slot_index: target_slot_index,
    });
    let new_item_instance_id = split_stack_helper(ctx, &mut source_item, quantity_to_split, new_item_target_location)?;
    
    // Fetch the newly created item and its definition to pass to merge_or_place
    let mut new_item = ctx.db.inventory_item().instance_id().find(new_item_instance_id)
        .ok_or_else(|| format!("Failed to find newly split item instance {}", new_item_instance_id))?;
    let new_item_def = ctx.db.item_definition().id().find(new_item.item_def_id)
        .ok_or_else(|| format!("Failed to find definition for new item {}", new_item.item_def_id))?;

    merge_or_place_into_container_slot(ctx, &mut campfire, target_slot_index, &mut new_item, &new_item_def)?;
    
    // Update the source item (quantity changed by split_stack_helper)
    ctx.db.inventory_item().instance_id().update(source_item); 
    ctx.db.campfire().id().update(campfire.clone());
    schedule_next_campfire_processing(ctx, target_campfire_id);
    Ok(())
}

/// --- Campfire Internal Item Movement ---
/// Moves/merges/swaps an item BETWEEN two slots within the same campfire.
#[spacetimedb::reducer]
pub fn move_fuel_within_campfire(
    ctx: &ReducerContext,
    campfire_id: u32,
    source_slot_index: u8,
    target_slot_index: u8,
) -> Result<(), String> {
    let (_player, mut campfire) = validate_campfire_interaction(ctx, campfire_id)?;
    inventory_management::handle_move_within_container(ctx, &mut campfire, source_slot_index, target_slot_index)?;
    ctx.db.campfire().id().update(campfire.clone());
    schedule_next_campfire_processing(ctx, campfire_id);
    Ok(())
}

/// --- Campfire Internal Stack Splitting ---
/// Splits a stack FROM one campfire slot TO another within the same campfire.
#[spacetimedb::reducer]
pub fn split_stack_within_campfire(
    ctx: &ReducerContext,
    campfire_id: u32,
    source_slot_index: u8,
    quantity_to_split: u32,
    target_slot_index: u8,
) -> Result<(), String> {
    let (_player, mut campfire) = validate_campfire_interaction(ctx, campfire_id)?;
    inventory_management::handle_split_within_container(ctx, &mut campfire, source_slot_index, target_slot_index, quantity_to_split)?;
    ctx.db.campfire().id().update(campfire.clone());
    schedule_next_campfire_processing(ctx, campfire_id);
    Ok(())
}

/// --- Quick Move to Campfire ---
/// Quickly moves an item from player inventory/hotbar to the first available/mergeable slot in the campfire.
#[spacetimedb::reducer]
pub fn quick_move_to_campfire(
    ctx: &ReducerContext,
    campfire_id: u32,
    item_instance_id: u64,
) -> Result<(), String> {
    let (_player, mut campfire) = validate_campfire_interaction(ctx, campfire_id)?;
    inventory_management::handle_quick_move_to_container(ctx, &mut campfire, item_instance_id)?;
    ctx.db.campfire().id().update(campfire.clone());
    schedule_next_campfire_processing(ctx, campfire_id);
    Ok(())
}

/// --- Move From Campfire to Player ---
/// Moves a specific fuel item FROM a campfire slot TO a specific player inventory/hotbar slot.
#[spacetimedb::reducer]
pub fn move_fuel_item_to_player_slot(
    ctx: &ReducerContext,
    campfire_id: u32,
    source_slot_index: u8,
    target_slot_type: String,
    target_slot_index: u32, // u32 to match client flexibility
) -> Result<(), String> {
    let (_player, mut campfire) = validate_campfire_interaction(ctx, campfire_id)?;
    inventory_management::handle_move_from_container_slot(ctx, &mut campfire, source_slot_index, target_slot_type, target_slot_index)?;
    let still_has_fuel = check_if_campfire_has_fuel(ctx, &campfire);
    if !still_has_fuel && campfire.is_burning {
        campfire.is_burning = false;
        campfire.current_fuel_def_id = None;
        campfire.remaining_fuel_burn_time_secs = None;
    }
    ctx.db.campfire().id().update(campfire.clone());
    schedule_next_campfire_processing(ctx, campfire_id);
    Ok(())
}

/// --- Split From Campfire to Player ---
/// Splits a stack FROM a campfire slot TO a specific player inventory/hotbar slot.
#[spacetimedb::reducer]
pub fn split_stack_from_campfire(
    ctx: &ReducerContext,
    source_campfire_id: u32,
    source_slot_index: u8,
    quantity_to_split: u32,
    target_slot_type: String,    // "inventory" or "hotbar"
    target_slot_index: u32,     // Numeric index for inventory/hotbar
) -> Result<(), String> {
    // Get mutable campfire table handle
    let mut campfires = ctx.db.campfire();

    // --- Basic Validations --- 
    let (_player, mut campfire) = validate_campfire_interaction(ctx, source_campfire_id)?;
    // Note: Further validations (item existence, stackability, quantity) are handled 
    //       within the generic handle_split_from_container function.

    log::info!(
        "[SplitFromCampfire] Player {:?} delegating split {} from campfire {} slot {} to {} slot {}",
        ctx.sender, quantity_to_split, source_campfire_id, source_slot_index, target_slot_type, target_slot_index
    );

    // --- Call GENERIC Handler --- 
    inventory_management::handle_split_from_container(
        ctx, 
        &mut campfire, 
        source_slot_index, 
        quantity_to_split,
        target_slot_type, 
        target_slot_index
    )?;

    // --- Commit Campfire Update --- 
    // The handler might have modified the source item quantity via split_stack_helper,
    // but the campfire state itself (slots) isn't directly changed by this handler.
    // However, to be safe and consistent with other reducers that fetch a mutable container,
    // we update it here. In the future, if the handler needed to modify the container state
    // (e.g., if the split failed and we needed to revert something), this update is necessary.
    campfires.id().update(campfire);

    Ok(())
}

/// --- Split and Move From Campfire ---
/// Splits a stack FROM a campfire slot and moves/merges the new stack 
/// TO a target slot (player inventory/hotbar, or another campfire slot).
#[spacetimedb::reducer]
pub fn split_and_move_from_campfire(
    ctx: &ReducerContext,
    source_campfire_id: u32,
    source_slot_index: u8,
    quantity_to_split: u32,
    target_slot_type: String,    // "inventory", "hotbar", or "campfire_fuel"
    target_slot_index: u32,     // Numeric index for inventory/hotbar/campfire
) -> Result<(), String> {
    let sender_id = ctx.sender; 
    let campfires = ctx.db.campfire();
    let mut inventory_items = ctx.db.inventory_item(); 

    log::info!(
        "[SplitMoveFromCampfire] Player {:?} splitting {} from campfire {} slot {} to {} slot {}",
        sender_id, quantity_to_split, source_campfire_id, source_slot_index, target_slot_type, target_slot_index
    );

    // --- 1. Find Source Campfire & Item ID --- 
    let campfire = campfires.id().find(source_campfire_id)
        .ok_or(format!("Source campfire {} not found", source_campfire_id))?;
    
    if source_slot_index >= crate::campfire::NUM_FUEL_SLOTS as u8 {
        return Err(format!("Invalid source fuel slot index: {}", source_slot_index));
    }

    let source_instance_id = match source_slot_index {
        0 => campfire.fuel_instance_id_0,
        1 => campfire.fuel_instance_id_1,
        2 => campfire.fuel_instance_id_2,
        3 => campfire.fuel_instance_id_3,
        4 => campfire.fuel_instance_id_4,
        _ => None,
    }.ok_or(format!("No item found in source campfire slot {}", source_slot_index))?;

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
    // If moving to another campfire slot, it can also initially be player inventory before being added.
    let initial_location_for_new_split_item = 
        find_first_empty_player_slot(ctx, sender_id)
            .ok_or_else(|| "Player inventory is full, cannot create split stack.".to_string())?;

    let new_item_instance_id = split_stack_helper(ctx, &mut source_item, quantity_to_split, initial_location_for_new_split_item)?;
    // source_item (original in campfire) quantity is now updated by split_stack_helper, persist it.
    inventory_items.instance_id().update(source_item.clone());

    // Fetch the newly created item (which is now in player's inventory/hotbar at initial_location_for_new_split_item)
    let new_item_for_move = inventory_items.instance_id().find(new_item_instance_id)
        .ok_or_else(|| format!("Failed to find newly split item instance {} for moving", new_item_instance_id))?;

    // --- 4. Move/Merge the NEW Stack from its initial player location to the FINAL target --- 
    log::debug!("[SplitMoveFromCampfire] Moving new stack {} from its initial player location {:?} to final target {} slot {}", 
                new_item_instance_id, new_item_for_move.location, target_slot_type, target_slot_index);
    
    match target_slot_type.as_str() {
        "inventory" => {
            move_item_to_inventory(ctx, new_item_instance_id, target_slot_index as u16)
        },
        "hotbar" => {
            move_item_to_hotbar(ctx, new_item_instance_id, target_slot_index as u8)
        },
        "campfire_fuel" => {
            // Moving to a slot in the *same* or *another* campfire. 
            // `add_fuel_to_campfire` expects the item to come from player inventory.
            // The new_item_instance_id is already in player's inventory due to split_stack_helper's new location.
            add_fuel_to_campfire(ctx, source_campfire_id, target_slot_index as u8, new_item_instance_id)
        },
        _ => {
            log::error!("[SplitMoveFromCampfire] Invalid target_slot_type: {}", target_slot_type);
            // Attempt to delete the orphaned split stack to prevent item loss
            inventory_items.instance_id().delete(new_item_instance_id);
            Err(format!("Invalid target slot type for split: {}", target_slot_type))
        }
    }
}

/******************************************************************************
 *                       REDUCERS (Campfire-Specific Logic)                   *
 ******************************************************************************/

/// --- Campfire Interaction Check ---
/// Allows a player to interact with a campfire if they are close enough.
#[spacetimedb::reducer]
pub fn interact_with_campfire(ctx: &ReducerContext, campfire_id: u32) -> Result<(), String> {
    let (_player, _campfire) = validate_campfire_interaction(ctx, campfire_id)?;
    Ok(())
}

/// --- Campfire Burning State Toggle ---
/// Toggles the burning state of the campfire (lights or extinguishes it).
/// Relies on checking if *any* fuel slot has Wood with quantity > 0.
#[spacetimedb::reducer]
pub fn toggle_campfire_burning(ctx: &ReducerContext, campfire_id: u32) -> Result<(), String> {
    let (_player, mut campfire) = validate_campfire_interaction(ctx, campfire_id)?;
        if campfire.is_burning {
            campfire.is_burning = false;
        campfire.current_fuel_def_id = None;
        campfire.remaining_fuel_burn_time_secs = None;
        log::info!("Campfire {} extinguished by player {:?}.", campfire.id, ctx.sender);
        } else {
        if !check_if_campfire_has_fuel(ctx, &campfire) {
            return Err("Cannot light campfire, requires fuel.".to_string());
        }
        campfire.is_burning = true;
        // remaining_fuel_burn_time_secs will be set by the first call to process_campfire_logic_scheduled
        log::info!("Campfire {} lit by player {:?}.", campfire.id, ctx.sender);
    }
    ctx.db.campfire().id().update(campfire.clone());
    schedule_next_campfire_processing(ctx, campfire_id);
        Ok(())
}

/******************************************************************************
 *                           SCHEDULED REDUCERS                               *
 ******************************************************************************/

/// Scheduled reducer: Processes the main campfire logic (fuel consumption, burning state).
#[spacetimedb::reducer]
pub fn process_campfire_logic_scheduled(ctx: &ReducerContext, schedule_args: CampfireProcessingSchedule) -> Result<(), String> {
    if ctx.sender != ctx.identity() {
        log::warn!("[ProcessCampfireScheduled] Unauthorized attempt to run scheduled campfire logic by {:?}. Ignoring.", ctx.sender);
        return Err("Unauthorized scheduler invocation".to_string());
    }

    let campfire_id = schedule_args.campfire_id_for_schedule as u32;
    let mut campfires_table = ctx.db.campfire();
    let mut inventory_items_table = ctx.db.inventory_item();
    let item_definition_table = ctx.db.item_definition(); // Ensure this is available for item def lookups

    let mut campfire = match campfires_table.id().find(campfire_id) {
        Some(cf) => cf,
        None => {
            log::warn!("[ProcessCampfireScheduled] Campfire {} not found for scheduled processing. Schedule might be stale. Not rescheduling.", campfire_id);
            // Try to delete the schedule entry if the campfire is gone
            ctx.db.campfire_processing_schedule().campfire_id_for_schedule().delete(campfire_id as u64);
            return Ok(());
        }
    };

    let mut made_changes_to_campfire_struct = false;
    let mut produced_charcoal_and_modified_campfire_struct = false; // New flag for charcoal specifically

    if campfire.is_burning {
        if let Some(mut remaining_time) = campfire.remaining_fuel_burn_time_secs {
            if remaining_time > 0.0 {
                let time_decrement = CAMPFIRE_PROCESS_INTERVAL_SECS as f32;
                remaining_time -= time_decrement;
                log::debug!("[ProcessCampfireScheduled] Campfire {} ({:?}) still burning. {:.1}s remaining of current fuel unit. Decrementing by {}s.", 
                         campfire.id, campfire.current_fuel_def_id, remaining_time + time_decrement, time_decrement);

                if remaining_time <= 0.0 {
                    log::info!("[ProcessCampfireScheduled] Campfire {} fuel unit burnt out (Def: {:?}). Attempting to consume from stack or find new fuel.", 
                             campfire.id, campfire.current_fuel_def_id);
                    
                    let mut current_fuel_item_instance_id_opt: Option<u64> = None;
                    let mut current_fuel_slot_idx_opt: Option<u8> = None;

                    // Find which slot holds the current_fuel_def_id
                    let fuel_slots_ids = [
                        (campfire.fuel_instance_id_0, 0u8), (campfire.fuel_instance_id_1, 1u8),
                        (campfire.fuel_instance_id_2, 2u8), (campfire.fuel_instance_id_3, 3u8),
                        (campfire.fuel_instance_id_4, 4u8),
                    ];

                    for (instance_id_opt, slot_idx) in fuel_slots_ids.iter() {
                        if let Some(instance_id) = instance_id_opt {
                            if let Some(item) = inventory_items_table.instance_id().find(*instance_id) {
                                if Some(item.item_def_id) == campfire.current_fuel_def_id {
                                    current_fuel_item_instance_id_opt = Some(*instance_id);
                                    current_fuel_slot_idx_opt = Some(*slot_idx);
                                    break;
                                }
                            }
                        }
                    }
                    
                    if let (Some(fuel_instance_id), Some(fuel_slot_idx)) = (current_fuel_item_instance_id_opt, current_fuel_slot_idx_opt) {
                        if let Some(mut fuel_item) = inventory_items_table.instance_id().find(fuel_instance_id) {
                            log::debug!("[ProcessCampfireScheduled] Campfire {} consuming 1 unit from InventoryItem {} (qty before: {}).", 
                                     campfire.id, fuel_instance_id, fuel_item.quantity);
                            
                            let consumed_item_def_id = fuel_item.item_def_id; // Capture def ID before quantity changes
                            let mut consumed_item_was_wood = false;
                            if let Some(consumed_def) = item_definition_table.id().find(consumed_item_def_id) {
                                if consumed_def.name == "Wood" {
                                    consumed_item_was_wood = true;
                                }
                            }

                            if fuel_item.quantity > 1 {
                                fuel_item.quantity -= 1;
                                inventory_items_table.instance_id().update(fuel_item.clone());
                                // Reload this fuel item for the next burn cycle
                                if let Some(item_def) = ctx.db.item_definition().id().find(fuel_item.item_def_id) {
                                    if let Some(burn_duration_per_unit) = item_def.fuel_burn_duration_secs {
                                        campfire.remaining_fuel_burn_time_secs = Some(burn_duration_per_unit); // Burn time for the next single unit
                                        log::info!("[ProcessCampfireScheduled] Campfire {} reloaded fuel unit (Def: {:?}, Qty: {}) from slot {}. Next unit burn time: {:.1}s.",
                                                 campfire.id, campfire.current_fuel_def_id, fuel_item.quantity, fuel_slot_idx, burn_duration_per_unit);
                                    } else { // Should not happen if it was burning
                                        campfire.remaining_fuel_burn_time_secs = None;
                                    }
                                }
                            } else {
                                // Last unit of this item stack
                                inventory_items_table.instance_id().delete(fuel_instance_id);
                                campfire.set_slot(fuel_slot_idx, None, None); // Clear from Campfire struct
                                log::info!("[ProcessCampfireScheduled] Campfire {} finished InventoryItem {} from slot {}.", campfire.id, fuel_instance_id, fuel_slot_idx);
                                campfire.current_fuel_def_id = None; // Signal to find new fuel
                                campfire.remaining_fuel_burn_time_secs = None;
                            }
                            made_changes_to_campfire_struct = true;

                            // --- CHARCOAL PRODUCTION --- 
                            if consumed_item_was_wood {
                                if ctx.rng().gen_range(0..100) < CHARCOAL_PRODUCTION_CHANCE {
                                    log::info!("[Charcoal] Campfire {}: Wood consumed, 75% chance succeeded for charcoal production.", campfire.id);
                                    if let Some(charcoal_def) = get_item_def_by_name(ctx, "Charcoal") {
                                        match try_add_charcoal_to_campfire_or_drop(ctx, &mut campfire, &charcoal_def, 1) {
                                            Ok(added_to_slots) => {
                                                if added_to_slots {
                                                    produced_charcoal_and_modified_campfire_struct = true;
                                                }
                                                // If not added_to_slots, it was dropped, no campfire struct change from this op.
                                            }
                                            Err(e) => {
                                                log::error!("[Charcoal] Campfire {}: Error producing charcoal: {}", campfire.id, e);
                                            }
                                        }
                                    } else {
                                        log::error!("[Charcoal] Campfire {}: Charcoal item definition not found! Cannot produce charcoal.", campfire.id);
                                    }
                                } else {
                                    log::debug!("[Charcoal] Campfire {}: Wood consumed, but 75% chance failed for charcoal.", campfire.id);
                                }
                            }
                            // --- END CHARCOAL PRODUCTION ---

                        } else { // Should not happen if current_fuel_def_id was set
                             log::warn!("[ProcessCampfireScheduled] Campfire {}: current_fuel_def_id {:?} was set, but no matching InventoryItem found in slots. Clearing current fuel.", 
                                     campfire.id, campfire.current_fuel_def_id);
                             campfire.current_fuel_def_id = None;
                             campfire.remaining_fuel_burn_time_secs = None;
                             made_changes_to_campfire_struct = true;
                        }
                    } else {
                        log::warn!("[ProcessCampfireScheduled] Campfire {}: current_fuel_def_id {:?} was set, but no matching InventoryItem found in slots. Clearing current fuel.", 
                                 campfire.id, campfire.current_fuel_def_id);
                        campfire.current_fuel_def_id = None;
                        campfire.remaining_fuel_burn_time_secs = None;
                        made_changes_to_campfire_struct = true;
                    }

                    // If current fuel ran out (or item was missing), try to load next fuel
                    if campfire.current_fuel_def_id.is_none() {
                        log::info!("[ProcessCampfireScheduled] Campfire {} attempting to find new fuel source...", campfire.id);
                        let mut new_fuel_loaded = false;
                        let fuel_slots_for_new_search = [
                            (campfire.fuel_instance_id_0, campfire.fuel_def_id_0, 0u8),
                            (campfire.fuel_instance_id_1, campfire.fuel_def_id_1, 1u8),
                            (campfire.fuel_instance_id_2, campfire.fuel_def_id_2, 2u8),
                            (campfire.fuel_instance_id_3, campfire.fuel_def_id_3, 3u8),
                            (campfire.fuel_instance_id_4, campfire.fuel_def_id_4, 4u8),
                        ];
                        for (instance_id_opt, def_id_opt, slot_idx) in fuel_slots_for_new_search.iter() {
                            if let (Some(instance_id), Some(def_id)) = (instance_id_opt, def_id_opt) {
                                // Call the existing helper, but it now just sets the burn time for *one unit*
                                if find_and_set_burn_time_for_fuel_unit(ctx, &mut campfire, *instance_id, *def_id, *slot_idx) {
                                    log::info!("[ProcessCampfireScheduled] Campfire {} started burning new fuel (Def: {:?}) from slot {}. Burn time for this unit: {:?})",
                                             campfire.id, campfire.current_fuel_def_id, *slot_idx, campfire.remaining_fuel_burn_time_secs);
                                    new_fuel_loaded = true;
                                    made_changes_to_campfire_struct = true;
                                    break; 
                                }
                            }
                        }
                        if !new_fuel_loaded {
                            log::info!("[ProcessCampfireScheduled] Campfire {} found no new fuel. Extinguishing.", campfire.id);
                            campfire.is_burning = false;
                            // current_fuel_def_id and remaining_fuel_burn_time_secs are already None
                            made_changes_to_campfire_struct = true;
                        }
                    }
                } else {
                    // Still burning current unit
                    campfire.remaining_fuel_burn_time_secs = Some(remaining_time);
                    made_changes_to_campfire_struct = true;
                }
            } else { // remaining_time was already <= 0.0 or None
                log::info!("[ProcessCampfireScheduled] Campfire {} had remaining_time <= 0 or None. Attempting to find new fuel source...", campfire.id);
                // This block is similar to the one above when current fuel runs out
                let mut new_fuel_loaded = false;
                let fuel_slots_for_initial_search = [
                    (campfire.fuel_instance_id_0, campfire.fuel_def_id_0, 0u8),
                    (campfire.fuel_instance_id_1, campfire.fuel_def_id_1, 1u8),
                    (campfire.fuel_instance_id_2, campfire.fuel_def_id_2, 2u8),
                    (campfire.fuel_instance_id_3, campfire.fuel_def_id_3, 3u8),
                    (campfire.fuel_instance_id_4, campfire.fuel_def_id_4, 4u8),
                ];
                for (instance_id_opt, def_id_opt, slot_idx) in fuel_slots_for_initial_search.iter() {
                    if let (Some(instance_id), Some(def_id)) = (instance_id_opt, def_id_opt) {
                         if find_and_set_burn_time_for_fuel_unit(ctx, &mut campfire, *instance_id, *def_id, *slot_idx) {
                            log::info!("[ProcessCampfireScheduled] Campfire {} started burning new fuel (Def: {:?}) from slot {}. Burn time for this unit: {:?})",
                                     campfire.id, campfire.current_fuel_def_id, *slot_idx, campfire.remaining_fuel_burn_time_secs);
                            new_fuel_loaded = true;
                            made_changes_to_campfire_struct = true;
                            break;
                        }
                    }
                }
                if !new_fuel_loaded {
                    log::info!("[ProcessCampfireScheduled] Campfire {} was lit but had no initial/suitable fuel. Extinguishing.", campfire.id);
                    campfire.is_burning = false;
                    campfire.current_fuel_def_id = None; 
                    campfire.remaining_fuel_burn_time_secs = None;
                    made_changes_to_campfire_struct = true;
                }
            }
        } else { // No remaining_fuel_burn_time_secs, meaning no fuel is currently "loaded"
            log::info!("[ProcessCampfireScheduled] Campfire {} is burning but no current fuel loaded. Attempting to find new fuel source...", campfire.id);
            // This block is similar to the one above
            let mut new_fuel_loaded = false;
            let fuel_slots_for_first_load = [
                (campfire.fuel_instance_id_0, campfire.fuel_def_id_0, 0u8),
                (campfire.fuel_instance_id_1, campfire.fuel_def_id_1, 1u8),
                (campfire.fuel_instance_id_2, campfire.fuel_def_id_2, 2u8),
                (campfire.fuel_instance_id_3, campfire.fuel_def_id_3, 3u8),
                (campfire.fuel_instance_id_4, campfire.fuel_def_id_4, 4u8),
            ];
            for (instance_id_opt, def_id_opt, slot_idx) in fuel_slots_for_first_load.iter() {
                if let (Some(instance_id), Some(def_id)) = (instance_id_opt, def_id_opt) {
                     if find_and_set_burn_time_for_fuel_unit(ctx, &mut campfire, *instance_id, *def_id, *slot_idx) {
                        log::info!("[ProcessCampfireScheduled] Campfire {} started burning new fuel (Def: {:?}) from slot {}. Burn time for this unit: {:?})",
                                 campfire.id, campfire.current_fuel_def_id, *slot_idx, campfire.remaining_fuel_burn_time_secs);
                        new_fuel_loaded = true;
                        made_changes_to_campfire_struct = true;
                        break;
                    }
                }
            }
            if !new_fuel_loaded {
                log::info!("[ProcessCampfireScheduled] Campfire {} was lit but had no initial/suitable fuel. Extinguishing.", campfire.id);
                campfire.is_burning = false;
                campfire.current_fuel_def_id = None; 
                campfire.remaining_fuel_burn_time_secs = None;
                made_changes_to_campfire_struct = true;
            }
        }
    } else { // Not burning
        log::debug!("[ProcessCampfireScheduled] Campfire {} is not burning. No processing needed.", campfire.id);
        // If it's not burning, but a schedule somehow exists, this `schedule_next_campfire_processing` call will clear it.
    }

    if made_changes_to_campfire_struct || produced_charcoal_and_modified_campfire_struct {
        campfires_table.id().update(campfire.clone());
    }

    // Always call schedule_next, it will decide if a new schedule is needed or if the current one (if periodic) continues, or if it should be cleared.
    schedule_next_campfire_processing(ctx, campfire_id)?;
    Ok(())
}

/// Schedules or re-schedules the main processing logic for a campfire.
/// Call this after lighting, extinguishing, adding, or removing fuel.
#[spacetimedb::reducer]
pub fn schedule_next_campfire_processing(ctx: &ReducerContext, campfire_id: u32) -> Result<(), String> {
    let mut schedules = ctx.db.campfire_processing_schedule();
    // Fetch campfire mutably by getting an owned copy that we can change and then update
    let campfire_opt = ctx.db.campfire().id().find(campfire_id);

    // If campfire doesn't exist, remove any existing schedule for it.
    if campfire_opt.is_none() {
        schedules.campfire_id_for_schedule().delete(campfire_id as u64);
        log::debug!("[ScheduleCampfire] Campfire {} does not exist. Removed any stale schedule.", campfire_id);
        return Ok(());
    }

    let mut campfire = campfire_opt.unwrap(); // Now an owned, mutable copy
    let mut campfire_state_changed = false; // Track if we modify the campfire struct

    let has_fuel = check_if_campfire_has_fuel(ctx, &campfire);

    if campfire.is_burning {
        if has_fuel {
            // If burning and has fuel, ensure schedule is active for periodic processing
            let interval = TimeDuration::from_micros((CAMPFIRE_PROCESS_INTERVAL_SECS * 1_000_000) as i64);
            let schedule_entry = CampfireProcessingSchedule {
                campfire_id_for_schedule: campfire_id as u64,
                scheduled_at: interval.into(),
            };
            // Try to insert; if it already exists (e.g. PK conflict), update it.
            if schedules.campfire_id_for_schedule().find(campfire_id as u64).is_some() {
                // Schedule exists, update it
                let mut existing_schedule = schedules.campfire_id_for_schedule().find(campfire_id as u64).unwrap(); // Safe due to check
                existing_schedule.scheduled_at = interval.into();
                schedules.campfire_id_for_schedule().update(existing_schedule);
                log::debug!("[ScheduleCampfire] Updated existing periodic processing schedule for burning campfire {}.", campfire_id);
            } else {
                // Schedule does not exist, insert new one
                match schedules.try_insert(schedule_entry) {
                    Ok(_) => log::debug!("[ScheduleCampfire] Successfully scheduled new periodic processing for burning campfire {}.", campfire_id),
                    Err(e) => {
                        // This case should ideally not be hit if the find check above is correct,
                        // but log as warning just in case of race or other unexpected state.
                        log::warn!("[ScheduleCampfire] Failed to insert new schedule for campfire {} despite not finding one: {}. Attempting update as fallback.", campfire_id, e);
                        // Attempt to update the existing schedule if PK is the issue (assuming PK is campfire_id_for_schedule)
                        if let Some(mut existing_schedule_fallback) = schedules.campfire_id_for_schedule().find(campfire_id as u64) {
                            existing_schedule_fallback.scheduled_at = interval.into();
                            schedules.campfire_id_for_schedule().update(existing_schedule_fallback);
                            log::debug!("[ScheduleCampfire] Fallback update of existing schedule for burning campfire {}.", campfire_id);
                        } else {
                            // If find still fails, then the original try_insert error was for a different reason.
                            return Err(format!("Failed to insert or update schedule for campfire {}: {}", campfire_id, e));
                        }
                    }
                }
            }
        } else {
            // Burning but NO fuel: extinguish and remove schedule
            log::info!("[ScheduleCampfire] Campfire {} is burning but found no valid fuel. Extinguishing.", campfire_id);
            campfire.is_burning = false;
            campfire.current_fuel_def_id = None;
            campfire.remaining_fuel_burn_time_secs = None;
            campfire_state_changed = true;

            schedules.campfire_id_for_schedule().delete(campfire_id as u64);
            log::debug!("[ScheduleCampfire] Campfire {} extinguished. Removed processing schedule.", campfire_id);
        }
    } else { // Not currently burning
        // If not burning, regardless of fuel presence, ensure any processing schedule is removed.
        // The fire must be manually lit via toggle_campfire_burning.
        schedules.campfire_id_for_schedule().delete(campfire_id as u64);
        if has_fuel {
            log::debug!("[ScheduleCampfire] Campfire {} is not burning (but has fuel). Ensured no active processing schedule.", campfire_id);
        } else {
            log::debug!("[ScheduleCampfire] Campfire {} is not burning and has no fuel. Ensured no active processing schedule.", campfire_id);
        }
    }

    if campfire_state_changed {
        ctx.db.campfire().id().update(campfire); // Update campfire if its state (e.g., is_burning) changed
    }
    Ok(())
}

/******************************************************************************
 *                            TRAIT IMPLEMENTATIONS                           *
 ******************************************************************************/

/// --- ItemContainer Implementation for Campfire ---
/// Implements the ItemContainer trait for the Campfire struct.
/// Provides methods to get the number of slots and access individual slots.
impl ItemContainer for Campfire {
    fn num_slots(&self) -> usize {
        NUM_FUEL_SLOTS
    }

    /// --- Get Slot Instance ID ---
    /// Returns the instance ID for a given slot index.
    /// Returns None if the slot index is out of bounds.
    fn get_slot_instance_id(&self, slot_index: u8) -> Option<u64> {
        if slot_index >= NUM_FUEL_SLOTS as u8 { return None; }
        match slot_index {
            0 => self.fuel_instance_id_0,
            1 => self.fuel_instance_id_1,
            2 => self.fuel_instance_id_2,
            3 => self.fuel_instance_id_3,
            4 => self.fuel_instance_id_4,
            _ => None, // Should be unreachable due to index check
        }
    }

    /// --- Get Slot Definition ID ---
    /// Returns the definition ID for a given slot index.
    /// Returns None if the slot index is out of bounds.
    fn get_slot_def_id(&self, slot_index: u8) -> Option<u64> {
        if slot_index >= NUM_FUEL_SLOTS as u8 { return None; }
        match slot_index {
            0 => self.fuel_def_id_0,
            1 => self.fuel_def_id_1,
            2 => self.fuel_def_id_2,
            3 => self.fuel_def_id_3,
            4 => self.fuel_def_id_4,
            _ => None,
        }
    }

    /// --- Set Slot ---
    /// Sets the item instance ID and definition ID for a given slot index. 
    /// Returns None if the slot index is out of bounds.
    fn set_slot(&mut self, slot_index: u8, instance_id: Option<u64>, def_id: Option<u64>) {
        if slot_index >= NUM_FUEL_SLOTS as u8 { return; }
        match slot_index {
            0 => { self.fuel_instance_id_0 = instance_id; self.fuel_def_id_0 = def_id; },
            1 => { self.fuel_instance_id_1 = instance_id; self.fuel_def_id_1 = def_id; },
            2 => { self.fuel_instance_id_2 = instance_id; self.fuel_def_id_2 = def_id; },
            3 => { self.fuel_instance_id_3 = instance_id; self.fuel_def_id_3 = def_id; },
            4 => { self.fuel_instance_id_4 = instance_id; self.fuel_def_id_4 = def_id; },
            _ => {},
        }
    }

    // --- ItemContainer Trait Extension for ItemLocation --- 
    fn get_container_type(&self) -> ContainerType {
        ContainerType::Campfire
    }

    fn get_container_id(&self) -> u64 {
        self.id as u64 // Campfire ID is u32, cast to u64
    }
}

/// --- Helper struct to implement the ContainerItemClearer trait for Campfire ---
/// Implements the ContainerItemClearer trait for the Campfire struct.
/// Provides a method to clear an item from all campfires.
pub struct CampfireClearer;

/// --- Clear Item From Campfire Fuel Slots ---
/// Removes a specific item instance from any campfire fuel slot it might be in.
/// Used when items are deleted or moved to ensure consistency across containers.
pub(crate) fn clear_item_from_campfire_fuel_slots(ctx: &ReducerContext, item_instance_id_to_clear: u64) -> bool {
    let inventory_table = ctx.db.inventory_item();
    let mut item_found_and_cleared = false;

    for mut campfire in ctx.db.campfire().iter() { // Iterate over all campfires
        let mut campfire_modified = false;
        for i in 0..campfire.num_slots() as u8 { // Use ItemContainer trait method
            if campfire.get_slot_instance_id(i) == Some(item_instance_id_to_clear) {
                log::debug!(
                    "Item {} found in campfire {} slot {}. Clearing slot.",
                    item_instance_id_to_clear, campfire.id, i
                );
                // Update item's location to Unknown before clearing from container and deleting
                if let Some(mut item) = inventory_table.instance_id().find(item_instance_id_to_clear) {
                    item.location = ItemLocation::Unknown;
                    inventory_table.instance_id().update(item);
                }
                // It's assumed the caller will delete the InventoryItem itself after clearing it from all potential containers.
                // This function just clears the reference from this specific container type.
                campfire.set_slot(i, None, None);
                campfire_modified = true;
                item_found_and_cleared = true; // Mark that we found and cleared it at least once
                // Do not break here, an item ID (though should be unique) might theoretically appear in multiple campfires if DB was manually edited.
            }
        }
        if campfire_modified {
            ctx.db.campfire().id().update(campfire);
        }
    }
    item_found_and_cleared
}

impl ContainerItemClearer for CampfireClearer {
    fn clear_item(ctx: &ReducerContext, item_instance_id: u64) -> bool {
        // This specific implementation iterates all campfires to find and remove the item.
        // This is different from container-specific reducers which operate on a single container ID.
        clear_item_from_campfire_fuel_slots(ctx, item_instance_id)
    }
}

/******************************************************************************
 *                             HELPER FUNCTIONS                               *
 ******************************************************************************/

/// --- Campfire Interaction Validation ---
/// Validates if a player can interact with a specific campfire (checks existence and distance).
/// Returns Ok((Player struct instance, Campfire struct instance)) on success, or Err(String) on failure.
fn validate_campfire_interaction(
    ctx: &ReducerContext,
    campfire_id: u32,
) -> Result<(Player, Campfire), String> {
    let sender_id = ctx.sender;
    let players = ctx.db.player();
    let campfires = ctx.db.campfire();

    let player = players.identity().find(sender_id)
        .ok_or_else(|| "Player not found".to_string())?;
    let campfire = campfires.id().find(campfire_id)
        .ok_or_else(|| format!("Campfire {} not found", campfire_id))?;

    // Check distance between the interacting player and the campfire
    let dx = player.position_x - campfire.pos_x;
    let dy = player.position_y - campfire.pos_y;
    let dist_sq = dx * dx + dy * dy;

    if dist_sq > PLAYER_CAMPFIRE_INTERACTION_DISTANCE_SQUARED {
        return Err("Too far away from campfire".to_string());
    }
    Ok((player, campfire))
}

// --- Campfire Fuel Checking ---
// This function checks if a campfire has any valid fuel in its slots.
// It examines each fuel slot for Wood with quantity > 0.
// Returns true if valid fuel is found, false otherwise.
// Used when determining if a campfire can be lit or should continue burning.
pub(crate) fn check_if_campfire_has_fuel(ctx: &ReducerContext, campfire: &Campfire) -> bool {
    let item_def_table = ctx.db.item_definition();
    for i in 0..NUM_FUEL_SLOTS {
        if let Some(instance_id) = campfire.get_slot_instance_id(i as u8) { // Ensure i is u8 for get_slot
            if let Some(item_instance) = ctx.db.inventory_item().instance_id().find(instance_id) {
                if let Some(item_def) = item_def_table.id().find(item_instance.item_def_id) {
                    if item_def.fuel_burn_duration_secs.is_some() && item_instance.quantity > 0 {
                        return true;
                    }
                }
            }
        }
    }
    false
}

// Renamed and refactored: find_and_consume_fuel_for_campfire to find_and_set_burn_time_for_fuel_unit
// This function now only CHECKS if a fuel item is valid and sets the burn time for ONE unit of it.
// It does NOT consume the item's quantity here. Consumption happens in process_campfire_logic_scheduled.
// Returns true if valid fuel was found and burn time set, false otherwise.
fn find_and_set_burn_time_for_fuel_unit(
    ctx: &ReducerContext,
    current_campfire: &mut Campfire, 
    fuel_instance_id: u64,      
    fuel_item_def_id: u64,      
    _fuel_slot_index: u8, // Not strictly needed here anymore for setting, but good for logging if fuel_instance_id wasn't enough
) -> bool { 
    let inventory_items = ctx.db.inventory_item();
    let item_defs = ctx.db.item_definition();

    if let Some(fuel_item) = inventory_items.instance_id().find(fuel_instance_id) {
        if fuel_item.quantity == 0 { // Should not happen if slot is occupied, but good check
            log::warn!("[find_and_set_burn_time] Fuel item {} has 0 quantity, cannot use.", fuel_instance_id);
            return false;
        }
        if let Some(item_def) = item_defs.id().find(fuel_item_def_id) { 
            if let Some(burn_duration_per_unit) = item_def.fuel_burn_duration_secs {
                if burn_duration_per_unit > 0.0 {
                    log::debug!("[find_and_set_burn_time] Campfire {} found valid fuel item {} (Def: {}) with burn duration {}. Setting as current fuel.", 
                             current_campfire.id, fuel_instance_id, fuel_item_def_id, burn_duration_per_unit);

                    current_campfire.current_fuel_def_id = Some(fuel_item_def_id);
                    current_campfire.remaining_fuel_burn_time_secs = Some(burn_duration_per_unit); // Burn time for ONE unit.
                    current_campfire.is_burning = true; // Ensure it's set to burning if we found fuel
                    return true; 
                } else {
                    log::debug!("[find_and_set_burn_time] Fuel item {} (Def: {}) has no burn duration.", fuel_instance_id, fuel_item_def_id);
                }
            } else {
                 log::debug!("[find_and_set_burn_time] Fuel item {} (Def: {}) has no burn duration attribute.", fuel_instance_id, fuel_item_def_id);
            }
        }  else {
            log::warn!("[find_and_set_burn_time] Definition not found for fuel item_def_id {}.", fuel_item_def_id);
        }
    } else {
        log::warn!("[find_and_set_burn_time] InventoryItem instance {} not found for fuel.", fuel_instance_id);
    }
    false
}

// --- NEW: Drop Item from Campfire Fuel Slot to World ---
#[spacetimedb::reducer]
pub fn drop_item_from_campfire_slot_to_world(
    ctx: &ReducerContext,
    campfire_id: u32,
    slot_index: u8, // This will be 0-4 for fuel slots
) -> Result<(), String> {
    let sender_id = ctx.sender;
    let player_table = ctx.db.player();
    let mut campfire_table = ctx.db.campfire();

    log::info!("[DropFromCampfireToWorld] Player {} attempting to drop fuel from campfire ID {}, slot index {}.", 
             sender_id, campfire_id, slot_index);

    // 1. Validate interaction and get campfire
    let (_player_for_validation, mut campfire) = validate_campfire_interaction(ctx, campfire_id)?;

    // 2. Get Player for drop location
    let player_for_drop_location = player_table.identity().find(sender_id)
        .ok_or_else(|| format!("Player {} not found for drop location.", sender_id))?;

    // 3. Call the generic handler from inventory_management
    // The ItemContainer trait for Campfire handles the slot_index for fuel slots
    crate::inventory_management::handle_drop_from_container_slot(ctx, &mut campfire, slot_index, &player_for_drop_location)?;

    // 4. Persist changes to the Campfire
    campfire_table.id().update(campfire);
    log::info!("[DropFromCampfireToWorld] Successfully dropped fuel from campfire {}, slot {}. Campfire updated.", campfire_id, slot_index);

    Ok(())
}

// --- NEW: Split and Drop Item from Campfire Fuel Slot to World ---
#[spacetimedb::reducer]
pub fn split_and_drop_item_from_campfire_slot_to_world(
    ctx: &ReducerContext,
    campfire_id: u32,
    slot_index: u8, // This will be 0-4 for fuel slots
    quantity_to_split: u32,
) -> Result<(), String> {
    let sender_id = ctx.sender;
    let player_table = ctx.db.player();
    let mut campfire_table = ctx.db.campfire();

    log::info!("[SplitDropFromCampfireToWorld] Player {} attempting to split {} fuel from campfire ID {}, slot {}.", 
             sender_id, quantity_to_split, campfire_id, slot_index);

    // 1. Validate interaction and get campfire
    let (_player_for_validation, mut campfire) = validate_campfire_interaction(ctx, campfire_id)?;

    // 2. Get Player for drop location
    let player_for_drop_location = player_table.identity().find(sender_id)
        .ok_or_else(|| format!("Player {} not found for drop location.", sender_id))?;

    // 3. Call the generic handler from inventory_management
    crate::inventory_management::handle_split_and_drop_from_container_slot(ctx, &mut campfire, slot_index, quantity_to_split, &player_for_drop_location)?;

    // 4. Persist changes to the Campfire
    campfire_table.id().update(campfire);
    log::info!("[SplitDropFromCampfireToWorld] Successfully split and dropped fuel from campfire {}, slot {}. Campfire updated.", campfire_id, slot_index);
    
    Ok(())
}

// --- Helper: Get Item Definition by Name ---
fn get_item_def_by_name<'a>(ctx: &'a ReducerContext, name: &str) -> Option<ItemDefinition> {
    ctx.db.item_definition().iter().find(|def| def.name == name)
}

// --- Helper: Try to add charcoal to campfire or drop it ---
// Returns Ok(bool) where true means campfire struct was modified (charcoal added to slots)
// and false means it was dropped or not produced.
fn try_add_charcoal_to_campfire_or_drop(
    ctx: &ReducerContext,
    campfire: &mut Campfire,
    charcoal_def: &ItemDefinition,
    quantity: u32
) -> Result<bool, String> {
    let inventory_items_table = ctx.db.inventory_item();
    let charcoal_def_id = charcoal_def.id;
    let charcoal_stack_size = charcoal_def.stack_size;
    let mut charcoal_added_to_campfire_slots = false;

    // 1. Try to stack with existing charcoal in campfire slots
    for i in 0..NUM_FUEL_SLOTS as u8 {
        if campfire.get_slot_def_id(i) == Some(charcoal_def_id) {
            if let Some(instance_id) = campfire.get_slot_instance_id(i) {
                if let Some(mut existing_charcoal_item) = inventory_items_table.instance_id().find(instance_id) {
                    if existing_charcoal_item.quantity < charcoal_stack_size {
                        let can_add = charcoal_stack_size - existing_charcoal_item.quantity;
                        let to_add = min(quantity, can_add);
                        existing_charcoal_item.quantity += to_add;
                        inventory_items_table.instance_id().update(existing_charcoal_item);
                        log::info!("[Charcoal] Campfire {}: Stacked {} charcoal onto existing stack in slot {}.", campfire.id, to_add, i);
                        // If quantity was fully added, we're done. This simple version assumes we add 1 unit only.
                        return Ok(false); // Campfire struct (slots) didn't change, only InventoryItem quantity
                    }
                }
            }
        }
    }

    // 2. Try to place in an empty slot
    for i in 0..NUM_FUEL_SLOTS as u8 {
        if campfire.get_slot_instance_id(i).is_none() {
            let new_charcoal_location = ItemLocation::Container(ContainerLocationData {
                container_type: ContainerType::Campfire,
                container_id: campfire.id as u64,
                slot_index: i,
            });
            let new_charcoal_item = InventoryItem {
                instance_id: 0, // Auto-incremented by SpacetimeDB on insert - Changed id to instance_id
                item_def_id: charcoal_def_id,
                quantity,
                location: new_charcoal_location,
            };
            match inventory_items_table.try_insert(new_charcoal_item) {
                Ok(inserted_item) => {
                    campfire.set_slot(i, Some(inserted_item.instance_id), Some(charcoal_def_id));
                    log::info!("[Charcoal] Campfire {}: Placed {} charcoal into empty slot {}.", campfire.id, quantity, i);
                    charcoal_added_to_campfire_slots = true;
                    return Ok(charcoal_added_to_campfire_slots);
                }
                Err(e) => {
                    log::error!("[Charcoal] Campfire {}: Failed to insert new charcoal item for slot {}: {:?}", campfire.id, i, e);
                    // Continue to drop if insert fails
                    break; 
                }
            }
        }
    }

    // 3. If not added to campfire (full or insert error), drop it
    log::info!("[Charcoal] Campfire {}: Slots full or error encountered. Dropping {} charcoal.", campfire.id, quantity);
    let drop_x = campfire.pos_x;
    // Slightly offset Y to avoid dropping directly in the middle of the campfire model
    let drop_y = campfire.pos_y + crate::dropped_item::DROP_OFFSET / 2.0; 
    create_dropped_item_entity(ctx, charcoal_def_id, quantity, drop_x, drop_y)?;
    
    Ok(charcoal_added_to_campfire_slots) // False, as it was dropped or failed to add to slots
}