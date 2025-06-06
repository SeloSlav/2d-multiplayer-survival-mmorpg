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
 use crate::cooking::CookingProgress; // Added CookingProgress
 
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
 
 // --- ADDED: Import for active effects ---
 use crate::active_effects::{ActiveConsumableEffect, EffectType};
 use crate::active_effects::active_consumable_effect as ActiveConsumableEffectTableTrait; // Added trait import
 
 // --- ADDED: Import for rain protection functionality ---
 use crate::world_state::world_state as WorldStateTableTrait;
 use crate::shelter::shelter as ShelterTableTrait;
 
 // --- Constants ---
 // Collision constants
 pub(crate) const CAMPFIRE_COLLISION_RADIUS: f32 = 20.0; // Increased from 12.0 to better match visual size
pub(crate) const CAMPFIRE_COLLISION_Y_OFFSET: f32 = 0.0; // Changed from 25.0 to center on visual sprite
pub(crate) const PLAYER_CAMPFIRE_COLLISION_DISTANCE_SQUARED: f32 = 
    (super::PLAYER_RADIUS + CAMPFIRE_COLLISION_RADIUS) * (super::PLAYER_RADIUS + CAMPFIRE_COLLISION_RADIUS);
pub(crate) const CAMPFIRE_CAMPFIRE_COLLISION_DISTANCE_SQUARED: f32 = 
    (CAMPFIRE_COLLISION_RADIUS * 2.0) * (CAMPFIRE_COLLISION_RADIUS * 2.0);
 
 // --- Placement constants ---
 pub(crate) const CAMPFIRE_PLACEMENT_MAX_DISTANCE: f32 = 96.0;
 pub(crate) const CAMPFIRE_PLACEMENT_MAX_DISTANCE_SQUARED: f32 = CAMPFIRE_PLACEMENT_MAX_DISTANCE * CAMPFIRE_PLACEMENT_MAX_DISTANCE;
 
 // --- Initial amounts ---
 pub const INITIAL_CAMPFIRE_FUEL_AMOUNT: u32 = 50; // Starting wood amount for new campfires

 // --- Health constants ---
 pub const CAMPFIRE_INITIAL_HEALTH: f32 = 100.0;
 pub const CAMPFIRE_MAX_HEALTH: f32 = 100.0;

 // Interaction constants
 pub(crate) const PLAYER_CAMPFIRE_INTERACTION_DISTANCE: f32 = 96.0; // New radius: 96px
 pub(crate) const PLAYER_CAMPFIRE_INTERACTION_DISTANCE_SQUARED: f32 = 
    PLAYER_CAMPFIRE_INTERACTION_DISTANCE * PLAYER_CAMPFIRE_INTERACTION_DISTANCE; // 96.0 * 96.0
 
 // Warmth and fuel constants
 pub(crate) const WARMTH_RADIUS: f32 = 300.0; // Doubled from 150.0
 pub(crate) const WARMTH_RADIUS_SQUARED: f32 = WARMTH_RADIUS * WARMTH_RADIUS; // Updated to 300.0 * 300.0 = 90000.0
 pub(crate) const WARMTH_PER_SECOND: f32 = 5.0;
 pub(crate) const FUEL_CONSUME_INTERVAL_SECS: u64 = 5;
 pub const NUM_FUEL_SLOTS: usize = 5;
 const FUEL_CHECK_INTERVAL_SECS: u64 = 1;
 pub const CAMPFIRE_PROCESS_INTERVAL_SECS: u64 = 1; // How often to run the main logic when burning
 const CHARCOAL_PRODUCTION_CHANCE: u8 = 75; // 75% chance
 
 // --- ADDED: Campfire Damage Constants ---
const CAMPFIRE_DAMAGE_CENTER_Y_OFFSET: f32 = 0.0; // Changed from 30.0 to center with visual sprite
const CAMPFIRE_DAMAGE_RADIUS: f32 = 50.0; // Increased damage radius
const CAMPFIRE_DAMAGE_RADIUS_SQUARED: f32 = 2500.0; // 50.0 * 50.0
 const CAMPFIRE_DAMAGE_PER_TICK: f32 = 5.0; // How much damage is applied per tick
 const CAMPFIRE_DAMAGE_EFFECT_DURATION_SECONDS: u64 = 1; // Duration of the damage effect (short, effectively one tick)
 const CAMPFIRE_DAMAGE_APPLICATION_COOLDOWN_SECONDS: u64 = 0; // MODIFIED: Apply damage every process tick if player is present
 
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
     pub health: f32,
     pub max_health: f32,
     pub is_destroyed: bool,
     pub destroyed_at: Option<Timestamp>,
     pub last_hit_time: Option<Timestamp>, // ADDED
     pub last_damaged_by: Option<Identity>, // ADDED: Track who last damaged this campfire

     // --- ADDED: Cooking progress for each slot ---
     pub slot_0_cooking_progress: Option<CookingProgress>,
     pub slot_1_cooking_progress: Option<CookingProgress>,
     pub slot_2_cooking_progress: Option<CookingProgress>,
     pub slot_3_cooking_progress: Option<CookingProgress>,
     pub slot_4_cooking_progress: Option<CookingProgress>,
     pub last_damage_application_time: Option<Timestamp>, // ADDED: For damage cooldown
     pub is_player_in_hot_zone: bool, // ADDED: True if any player is in the damage radius
 }
 
 // ADD NEW Schedule Table for per-campfire processing
 #[spacetimedb::table(name = campfire_processing_schedule, scheduled(process_campfire_logic_scheduled))]
 #[derive(Clone)]
 pub struct CampfireProcessingSchedule {
     #[primary_key] // This will store the campfire_id to make the schedule unique per campfire
     pub campfire_id: u64,
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
/// Rain prevents lighting campfires unless they are inside a shelter.
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
        
        // Check if it's raining and campfire is not protected by shelter
        if is_raining(ctx) && !is_campfire_protected_from_rain(ctx, &campfire) {
            return Err("Cannot light campfire in the rain unless it's inside a shelter.".to_string());
        }
        
        campfire.is_burning = true;
        // remaining_fuel_burn_time_secs will be set by the first call to process_campfire_logic_scheduled
        log::info!("Campfire {} lit by player {:?}.", campfire.id, ctx.sender);
    }
    ctx.db.campfire().id().update(campfire.clone());
    schedule_next_campfire_processing(ctx, campfire_id);
    Ok(())
}

 // Reducer to place a campfire
#[spacetimedb::reducer]
pub fn place_campfire(ctx: &ReducerContext, item_instance_id: u64, world_x: f32, world_y: f32) -> Result<(), String> {
    let sender_id = ctx.sender;
    let inventory_items = ctx.db.inventory_item();
    let item_defs = ctx.db.item_definition();
    let players = ctx.db.player();
    let campfires = ctx.db.campfire();

    // --- Look up Item Definition IDs by Name ---
    let campfire_def_id = item_defs.iter()
        .find(|def| def.name == "Camp Fire")
        .map(|def| def.id)
        .ok_or_else(|| "Item definition for 'Camp Fire' not found.".to_string())?;

    let wood_def_id = item_defs.iter()
        .find(|def| def.name == "Wood")
        .map(|def| def.id)
        .ok_or_else(|| "Item definition for 'Wood' not found.".to_string())?;
    // --- End Look up ---

    log::info!(
        "[PlaceCampfire] Player {:?} attempting placement of item {} at ({:.1}, {:.1})",
        sender_id, item_instance_id, world_x, world_y
    );

    // --- 1. Validate Player and Placement Rules ---
    let player = players.identity().find(sender_id)
        .ok_or_else(|| "Player not found".to_string())?;

    // Don't allow placing campfires if dead or knocked out
    if player.is_dead {
        return Err("Cannot place campfire while dead.".to_string());
    }
    if player.is_knocked_out {
        return Err("Cannot place campfire while knocked out.".to_string());
    }

    let dx_place = world_x - player.position_x;
    let dy_place = world_y - player.position_y;
    let dist_sq_place = dx_place * dx_place + dy_place * dy_place;
    if dist_sq_place > CAMPFIRE_PLACEMENT_MAX_DISTANCE_SQUARED {
        return Err(format!("Cannot place campfire too far away ({} > {}).",
                dist_sq_place.sqrt(), CAMPFIRE_PLACEMENT_MAX_DISTANCE));
    }
    for other_fire in campfires.iter() {
        let dx_fire = world_x - other_fire.pos_x;
        let dy_fire = world_y - other_fire.pos_y;
        let dist_sq_fire = dx_fire * dx_fire + dy_fire * dy_fire;
        if dist_sq_fire < CAMPFIRE_CAMPFIRE_COLLISION_DISTANCE_SQUARED {
            return Err("Cannot place campfire too close to another campfire.".to_string());
        }
    }

    // --- 3. Find the specific item instance and validate ---
    let item_to_consume = inventory_items.instance_id().find(item_instance_id)
        .ok_or_else(|| format!("Item instance {} not found.", item_instance_id))?;

    // Validate ownership and location based on ItemLocation
    match item_to_consume.location {
        ItemLocation::Inventory(data) => {
            if data.owner_id != sender_id {
                return Err(format!("Item instance {} for campfire not owned by player {:?}.", item_instance_id, sender_id));
            }
        }
        ItemLocation::Hotbar(data) => {
            if data.owner_id != sender_id {
                return Err(format!("Item instance {} for campfire not owned by player {:?}.", item_instance_id, sender_id));
            }
        }
        _ => {
            return Err(format!("Item instance {} must be in inventory or hotbar to be placed.", item_instance_id));
        }
    }
    if item_to_consume.item_def_id != campfire_def_id {
        return Err(format!("Item instance {} is not a Camp Fire (expected def {}, got {}).",
                        item_instance_id, campfire_def_id, item_to_consume.item_def_id));
    }

    // --- 4. Consume the Item (Delete from InventoryItem table) ---
    log::info!(
        "[PlaceCampfire] Consuming item instance {} (Def ID: {}) from player {:?}",
        item_instance_id, campfire_def_id, sender_id
    );
    inventory_items.instance_id().delete(item_instance_id);

    // --- 5. Create Campfire Entity & Initial Fuel ---
    // --- 5a. Insert Campfire Entity first to get its ID ---
    let current_time = ctx.timestamp;
    let chunk_idx = calculate_chunk_index(world_x, world_y);

    // --- 5b. Create Initial Fuel Item (Wood) with correct ItemLocation ---
    // We need the ItemDefinition of the wood to get its fuel_burn_duration_secs
    let initial_fuel_item_def = ctx.db.item_definition().id().find(wood_def_id)
        .ok_or_else(|| "Wood item definition not found for initial fuel.".to_string())?;

    // --- 5a. Insert Campfire Entity first to get its ID ---
    // The campfire entity is created with initial fuel data directly
    let new_campfire = Campfire {
        id: 0, // Auto-incremented
        pos_x: world_x,
        pos_y: world_y + 42.0, // Compensate for bottom-anchoring + 10px render offset
        chunk_index: chunk_idx,
        placed_by: sender_id,
        placed_at: current_time,
        is_burning: false, // Campfires start unlit
        // Initialize all fuel slots to None
        fuel_instance_id_0: None,
        fuel_def_id_0: None,
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
        health: CAMPFIRE_INITIAL_HEALTH, // Example initial health
        max_health: CAMPFIRE_MAX_HEALTH, // Example max health
        is_destroyed: false,
        destroyed_at: None,
        last_hit_time: None,
        last_damaged_by: None, // ADDED: Track who last damaged this campfire
        // Initialize cooking progress to None
        slot_0_cooking_progress: None,
        slot_1_cooking_progress: None,
        slot_2_cooking_progress: None,
        slot_3_cooking_progress: None,
        slot_4_cooking_progress: None,
        last_damage_application_time: None,
        is_player_in_hot_zone: false, // Initialize new field
    };
    let inserted_campfire = campfires.try_insert(new_campfire.clone())
        .map_err(|e| format!("Failed to insert campfire entity: {}", e))?;
    let new_campfire_id = inserted_campfire.id; 

    let initial_fuel_item = crate::items::InventoryItem {
        instance_id: 0, // Auto-inc
        item_def_id: wood_def_id, 
        quantity: INITIAL_CAMPFIRE_FUEL_AMOUNT, 
        location: ItemLocation::Container(ContainerLocationData {
            container_type: ContainerType::Campfire,
            container_id: new_campfire_id as u64, 
            slot_index: 0, 
        }),
    };
    let inserted_fuel_item = inventory_items.try_insert(initial_fuel_item)
        .map_err(|e| format!("Failed to insert initial fuel item: {}", e))?;
    let fuel_instance_id = inserted_fuel_item.instance_id;
    log::info!("[PlaceCampfire] Created initial fuel item (Wood, instance {}) for campfire {}.", fuel_instance_id, new_campfire_id);

    // --- 5c. Update the Campfire Entity with the Fuel Item's ID in the correct slot --- 
    let mut campfire_to_update = campfires.id().find(new_campfire_id)
        .ok_or_else(|| format!("Failed to re-find campfire {} to update with fuel.", new_campfire_id))?;
    
    // Set the first fuel slot of the campfire
    campfire_to_update.fuel_instance_id_0 = Some(fuel_instance_id);
    campfire_to_update.fuel_def_id_0 = Some(wood_def_id);
    // DO NOT set current_fuel_def_id or remaining_fuel_burn_time_secs here.
    // is_burning is already false from new_campfire.
    // The scheduled process_campfire_logic_scheduled will pick it up.
    
    let is_burning_for_log = campfire_to_update.is_burning; // Capture before move
    campfires.id().update(campfire_to_update); // campfire_to_update is moved here
    
    log::info!("Player {} placed a campfire {} at ({:.1}, {:.1}) with initial fuel (Item {} in slot 0). Burning state: {}.",
             player.username, new_campfire_id, world_x, world_y, fuel_instance_id, is_burning_for_log); // Use captured value

    // Schedule initial processing for the new campfire
    match crate::campfire::schedule_next_campfire_processing(ctx, new_campfire_id) {
        Ok(_) => log::info!("[PlaceCampfire] Scheduled initial processing for campfire {}", new_campfire_id),
        Err(e) => log::error!("[PlaceCampfire] Failed to schedule initial processing for campfire {}: {}", new_campfire_id, e),
    }

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
 
     let campfire_id = schedule_args.campfire_id as u32;
     let mut campfires_table = ctx.db.campfire();
     let mut inventory_items_table = ctx.db.inventory_item();
     let item_definition_table = ctx.db.item_definition(); // Keep this if fuel logic or charcoal needs it.
 
     // Get a mutable handle to the active_consumable_effect table
     let mut active_effects_table = ctx.db.active_consumable_effect();
 
     let mut campfire = match campfires_table.id().find(campfire_id) {
         Some(cf) => cf,
         None => {
             log::warn!("[ProcessCampfireScheduled] Campfire {} not found for scheduled processing. Schedule might be stale. Not rescheduling.", campfire_id);
             ctx.db.campfire_processing_schedule().campfire_id().delete(campfire_id as u64);
             return Ok(());
         }
     };
 
     if campfire.is_destroyed {
         log::debug!("[ProcessCampfireScheduled] Campfire {} is destroyed. Skipping processing and removing schedule.", campfire_id);
         ctx.db.campfire_processing_schedule().campfire_id().delete(campfire_id as u64);
         return Ok(());
     }
 
     let mut made_changes_to_campfire_struct = false;
     let mut produced_charcoal_and_modified_campfire_struct = false; // For charcoal logic
 
     // Reset is_player_in_hot_zone at the beginning of each tick for this campfire
     if campfire.is_player_in_hot_zone { // Only change if it was true, to minimize DB writes if it's already false
         campfire.is_player_in_hot_zone = false;
         made_changes_to_campfire_struct = true;
     }
 
     let current_time = ctx.timestamp;
     log::trace!("[CampfireProcess {}] Current time: {:?}", campfire_id, current_time);
 
     if campfire.is_burning {
         log::debug!("[CampfireProcess {}] Is BURNING.", campfire_id);
         let time_increment = CAMPFIRE_PROCESS_INTERVAL_SECS as f32;
 
         // --- ADDED: Campfire Damage Logic ---
         let damage_cooldown_duration = TimeDuration::from_micros(CAMPFIRE_DAMAGE_APPLICATION_COOLDOWN_SECONDS as i64 * 1_000_000);
         log::trace!("[CampfireProcess {}] Damage cooldown duration: {:?}", campfire_id, damage_cooldown_duration);
         log::trace!("[CampfireProcess {}] Last damage application time: {:?}", campfire_id, campfire.last_damage_application_time);
 
         let can_apply_damage = campfire.last_damage_application_time.map_or(true, |last_time| {
             current_time >= last_time + damage_cooldown_duration
         });
         log::debug!("[CampfireProcess {}] Can apply damage this tick: {}", campfire_id, can_apply_damage);
 
         if can_apply_damage {
             // --- MODIFIED: Update cooldown time immediately upon damage attempt ---
             campfire.last_damage_application_time = Some(current_time);
             // This change is now handled by the made_changes_to_campfire_struct flag later
             log::debug!("[CampfireProcess {}] Damage application attempt at {:?}. Updated last_damage_application_time.", campfire_id, current_time);
             // --- END MODIFICATION ---

             let mut applied_damage_this_tick = false;
             let mut a_player_is_in_hot_zone_this_tick = false; // Track if any player is in the zone this tick

             for player_entity in ctx.db.player().iter() {
                 if player_entity.is_dead { continue; } // Skip dead players
                 
                 // Check if player is in hot zone (for setting the flag, separate from damage application logic)
                 // UPDATED: Use the same visual center offset for damage calculations
                 // This ensures damage is applied based on the visual fire location the player sees
                 const VISUAL_CENTER_Y_OFFSET: f32 = 42.0;
                 
                 let dx = player_entity.position_x - campfire.pos_x;
                 let dy = player_entity.position_y - (campfire.pos_y - VISUAL_CENTER_Y_OFFSET);
                 let dist_sq = dx * dx + dy * dy;

                 if dist_sq < CAMPFIRE_DAMAGE_RADIUS_SQUARED {
                     a_player_is_in_hot_zone_this_tick = true; // A player is in the zone

                     // Proceed with damage effect application as before
                     log::info!("[CampfireProcess {}] Player {:?} IS IN DAMAGE RADIUS. Attempting to apply damage effect.", campfire_id, player_entity.identity);
                     let damage_effect = ActiveConsumableEffect {
                         effect_id: 0, // Auto-incremented by the table
                         player_id: player_entity.identity,
                         target_player_id: None, // Add this line
                         item_def_id: 0, // 0 for environmental/non-item effects
                         consuming_item_instance_id: None, // Added: Campfire damage doesn't consume an item instance
                         started_at: current_time,
                         ends_at: current_time + TimeDuration::from_micros(CAMPFIRE_DAMAGE_EFFECT_DURATION_SECONDS as i64 * 1_000_000),
                         total_amount: Some(CAMPFIRE_DAMAGE_PER_TICK),
                         amount_applied_so_far: Some(0.0),
                         effect_type: EffectType::Burn, // CHANGED from Damage to Burn
                         tick_interval_micros: CAMPFIRE_DAMAGE_EFFECT_DURATION_SECONDS * 1_000_000,
                         next_tick_at: current_time, // Apply immediately
                     };
                     match active_effects_table.try_insert(damage_effect) {
                         Ok(_) => {
                             log::info!("[CampfireProcess {}] Successfully INSERTED burn effect for player {:?}", campfire_id, player_entity.identity);
                             applied_damage_this_tick = true; // Mark that we attempted to apply damage
                         }
                         Err(e) => {
                             log::error!("[CampfireProcess {}] FAILED to insert burn effect for player {:?}: {:?}", campfire_id, player_entity.identity, e);
                         }
                     }
                 }
             }

             // After checking all players, if any were in the hot zone, update the campfire state
             if a_player_is_in_hot_zone_this_tick && !campfire.is_player_in_hot_zone {
                 campfire.is_player_in_hot_zone = true;
                 made_changes_to_campfire_struct = true;
                 log::debug!("[CampfireProcess {}] Player detected in hot zone. Set is_player_in_hot_zone to true.", campfire_id);
             } else if !a_player_is_in_hot_zone_this_tick && campfire.is_player_in_hot_zone {
                 // This case is handled by the reset at the beginning of the tick.
                 // campfire.is_player_in_hot_zone = false;
                 // made_changes_to_campfire_struct = true;
                 log::debug!("[CampfireProcess {}] No players in hot zone this tick. is_player_in_hot_zone is now false (was reset or already false).", campfire_id);
             }

             if applied_damage_this_tick { // If damage was applied, update the last_damage_application_time
                 campfire.last_damage_application_time = Some(current_time);
                 made_changes_to_campfire_struct = true;
                 log::debug!("[CampfireProcess {}] Damage applied this tick. Updated last_damage_application_time.", campfire_id);
             }
         }
 
         // --- COOKING LOGIC (now delegated) ---
         let active_fuel_instance_id_for_cooking_check = campfire.current_fuel_def_id.and_then(|fuel_def_id| {
             (0..NUM_FUEL_SLOTS as u8).find_map(|slot_idx_check| {
                 if campfire.get_slot_def_id(slot_idx_check) == Some(fuel_def_id) {
                     if let Some(instance_id_check) = campfire.get_slot_instance_id(slot_idx_check) {
                         if campfire.remaining_fuel_burn_time_secs.is_some() && campfire.remaining_fuel_burn_time_secs.unwrap_or(0.0) > 0.0 {
                             return Some(instance_id_check);
                         }
                     }
                 }
                 None
             })
         });
 
         match crate::cooking::process_appliance_cooking_tick(ctx, &mut campfire, time_increment, active_fuel_instance_id_for_cooking_check) {
             Ok(cooking_modified_appliance) => {
                 if cooking_modified_appliance {
                     made_changes_to_campfire_struct = true;
                 }
             }
             Err(e) => {
                 log::error!("[ProcessCampfireScheduled] Error during generic cooking tick for campfire {}: {}. Further processing might be affected.", campfire.id, e);
             }
         }
         // --- END COOKING LOGIC (delegated) ---
 
         // --- FUEL CONSUMPTION LOGIC (remains specific to campfire) ---
         if let Some(mut remaining_time) = campfire.remaining_fuel_burn_time_secs {
             if remaining_time > 0.0 {
                 remaining_time -= time_increment; // time_increment was defined above
 
                 if remaining_time <= 0.0 {
                     log::info!("[ProcessCampfireScheduled] Campfire {} fuel unit (Def: {:?}) burnt out. Consuming unit and checking stack/new fuel.", campfire.id, campfire.current_fuel_def_id);
                     
                     let mut consumed_and_reloaded_from_stack = false;
                     let mut active_fuel_slot_idx_found: Option<u8> = None;
 
                     for i in 0..NUM_FUEL_SLOTS as u8 {
                         if campfire.get_slot_def_id(i) == campfire.current_fuel_def_id {
                             if let Some(instance_id) = campfire.get_slot_instance_id(i) {
                                 if let Some(mut fuel_item) = inventory_items_table.instance_id().find(instance_id) {
                                     active_fuel_slot_idx_found = Some(i);
                                     let consumed_item_def_id_for_charcoal = fuel_item.item_def_id;
                                     fuel_item.quantity -= 1;
 
                                     if fuel_item.quantity > 0 {
                                         inventory_items_table.instance_id().update(fuel_item.clone());
                                         if let Some(item_def) = item_definition_table.id().find(fuel_item.item_def_id) {
                                             if let Some(burn_duration_per_unit) = item_def.fuel_burn_duration_secs {
                                                 campfire.remaining_fuel_burn_time_secs = Some(burn_duration_per_unit);
                                                 consumed_and_reloaded_from_stack = true;
                                             } else { campfire.current_fuel_def_id = None; campfire.remaining_fuel_burn_time_secs = None; }
                                         } else { campfire.current_fuel_def_id = None; campfire.remaining_fuel_burn_time_secs = None; }
                                     } else {
                                         inventory_items_table.instance_id().delete(instance_id);
                                         campfire.set_slot(i, None, None);
                                         campfire.current_fuel_def_id = None; 
                                         campfire.remaining_fuel_burn_time_secs = None;
                                     }
                                     made_changes_to_campfire_struct = true;
 
                                     if let Some(consumed_def) = item_definition_table.id().find(consumed_item_def_id_for_charcoal) {
                                         if consumed_def.name == "Wood" && ctx.rng().gen_range(0..100) < CHARCOAL_PRODUCTION_CHANCE {
                                             if let Some(charcoal_def) = get_item_def_by_name(ctx, "Charcoal") {
                                                 if try_add_charcoal_to_campfire_or_drop(ctx, &mut campfire, &charcoal_def, 1).unwrap_or(false) {
                                                     produced_charcoal_and_modified_campfire_struct = true;
                                                 }
                                             }
                                         }
                                     }
                                     break; 
                                 } else { campfire.current_fuel_def_id = None; campfire.remaining_fuel_burn_time_secs = None; made_changes_to_campfire_struct = true; break;}
                             }
                         }
                     }
                     if !consumed_and_reloaded_from_stack && campfire.current_fuel_def_id.is_some() && active_fuel_slot_idx_found.is_none() {
                         campfire.current_fuel_def_id = None; campfire.remaining_fuel_burn_time_secs = None; made_changes_to_campfire_struct = true;
                     }
                 } else {
                     campfire.remaining_fuel_burn_time_secs = Some(remaining_time);
                     made_changes_to_campfire_struct = true;
                 }
             } else { // remaining_fuel_burn_time_secs was already <= 0.0 or None
                 campfire.current_fuel_def_id = None; 
                 campfire.remaining_fuel_burn_time_secs = None;
                 made_changes_to_campfire_struct = true; 
             }
         }
         
         if campfire.current_fuel_def_id.is_none() { // Try to find new fuel
             let mut new_fuel_loaded = false;
             for i in 0..NUM_FUEL_SLOTS as u8 {
                 if let (Some(instance_id), Some(def_id)) = (campfire.get_slot_instance_id(i), campfire.get_slot_def_id(i)) {
                     if let Some(fuel_item_check) = inventory_items_table.instance_id().find(instance_id){
                         if fuel_item_check.quantity > 0 {
                              if find_and_set_burn_time_for_fuel_unit(ctx, &mut campfire, instance_id, def_id, i) {
                                 new_fuel_loaded = true; made_changes_to_campfire_struct = true; break;
                             }
                         } else { campfire.set_slot(i, None, None); made_changes_to_campfire_struct = true; }
                     } else { campfire.set_slot(i, None, None); made_changes_to_campfire_struct = true; }
                 }
             }
             if !new_fuel_loaded {
                 campfire.is_burning = false; made_changes_to_campfire_struct = true;
             }
         }
     } else { // campfire.is_burning is false
         log::debug!("[ProcessCampfireScheduled] Campfire {} is not burning. No processing needed for fuel/cooking.", campfire.id);
         log::debug!("[CampfireProcess {}] Is NOT burning. Skipping damage and fuel/cooking.", campfire_id);
     }
 
     if made_changes_to_campfire_struct || produced_charcoal_and_modified_campfire_struct {
         campfires_table.id().update(campfire); // Update the owned campfire variable
     }
 
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
 
     // If campfire doesn't exist, or is destroyed, remove any existing schedule for it.
     if campfire_opt.is_none() || campfire_opt.as_ref().map_or(false, |cf| cf.is_destroyed) {
         schedules.campfire_id().delete(campfire_id as u64);
         if campfire_opt.is_none() {
             log::debug!("[ScheduleCampfire] Campfire {} does not exist. Removed any stale schedule.", campfire_id);
         } else {
             log::debug!("[ScheduleCampfire] Campfire {} is destroyed. Removed processing schedule.", campfire_id);
         }
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
                 campfire_id: campfire_id as u64,
                 scheduled_at: interval.into(),
             };
             // Try to insert; if it already exists (e.g. PK conflict), update it.
             if schedules.campfire_id().find(campfire_id as u64).is_some() {
                 // Schedule exists, update it
                 let mut existing_schedule = schedules.campfire_id().find(campfire_id as u64).unwrap();
                 existing_schedule.scheduled_at = interval.into();
                 schedules.campfire_id().update(existing_schedule);
                 log::debug!("[ScheduleCampfire] Updated existing periodic processing schedule for burning campfire {}.", campfire_id);
             } else {
                 // Schedule does not exist, insert new one
                 match schedules.try_insert(schedule_entry) {
                     Ok(_) => log::debug!("[ScheduleCampfire] Successfully scheduled new periodic processing for burning campfire {}.", campfire_id),
                     Err(e) => {
                         // This case should ideally not be hit if the find check above is correct,
                         // but log as warning just in case of race or other unexpected state.
                         log::warn!("[ScheduleCampfire] Failed to insert new schedule for campfire {} despite not finding one: {}. Attempting update as fallback.", campfire_id, e);
                         // Attempt to update the existing schedule if PK is the issue (assuming PK is campfire_id)
                         if let Some(mut existing_schedule_fallback) = schedules.campfire_id().find(campfire_id as u64) {
                             existing_schedule_fallback.scheduled_at = interval.into();
                             schedules.campfire_id().update(existing_schedule_fallback);
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
 
             schedules.campfire_id().delete(campfire_id as u64);
             log::debug!("[ScheduleCampfire] Campfire {} extinguished. Removed processing schedule.", campfire_id);
         }
     } else { // Not currently burning
         // If not burning, regardless of fuel presence, ensure any processing schedule is removed.
         // The fire must be manually lit via toggle_campfire_burning.
         schedules.campfire_id().delete(campfire_id as u64);
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
             0 => { self.fuel_instance_id_0 = instance_id; self.fuel_def_id_0 = def_id; if instance_id.is_none() { self.slot_0_cooking_progress = None; } },
             1 => { self.fuel_instance_id_1 = instance_id; self.fuel_def_id_1 = def_id; if instance_id.is_none() { self.slot_1_cooking_progress = None; } },
             2 => { self.fuel_instance_id_2 = instance_id; self.fuel_def_id_2 = def_id; if instance_id.is_none() { self.slot_2_cooking_progress = None; } },
             3 => { self.fuel_instance_id_3 = instance_id; self.fuel_def_id_3 = def_id; if instance_id.is_none() { self.slot_3_cooking_progress = None; } },
             4 => { self.fuel_instance_id_4 = instance_id; self.fuel_def_id_4 = def_id; if instance_id.is_none() { self.slot_4_cooking_progress = None; } },
             _ => {},
         }
         // If a new item is placed (instance_id is Some), its cooking progress should be determined by process_campfire_logic_scheduled.
         // If an item is cleared (instance_id is None), its cooking progress is set to None above.
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

     // OPTIMIZED: Check distance between player and campfire's visual center
     // Since the visual campfire is rendered with its center offset from the base position,
     // we need to adjust the y-coordinate to match where the player sees the campfire
     // Using CAMPFIRE_HEIGHT constant from client (64px) divided by 2 plus CAMPFIRE_RENDER_Y_OFFSET (10px)
     // Total offset is roughly 32 + 10 = 42px upward from base position
     const VISUAL_CENTER_Y_OFFSET: f32 = 42.0;
     
     let dx = player.position_x - campfire.pos_x;
     let dy = player.position_y - (campfire.pos_y - VISUAL_CENTER_Y_OFFSET);
     let dist_sq = dx * dx + dy * dy;

     if dist_sq > PLAYER_CAMPFIRE_INTERACTION_DISTANCE_SQUARED {
         return Err("Too far away from campfire".to_string());
     }

     // NEW: Check shelter access control
     if !crate::shelter::can_player_interact_with_object_in_shelter(
         ctx,
         sender_id,
         player.position_x,
         player.position_y,
         campfire.pos_x,
         campfire.pos_y,
     ) {
         return Err("Cannot interact with campfire inside shelter - only the shelter owner can access it from inside".to_string());
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
    let mut inventory_items_table = ctx.db.inventory_item(); // Changed to mut
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
                        let to_add = min(quantity, can_add); // quantity is usually 1 from charcoal production
                        existing_charcoal_item.quantity += to_add;
                        inventory_items_table.instance_id().update(existing_charcoal_item);
                        log::info!("[Charcoal] Campfire {}: Stacked {} charcoal onto existing stack in slot {}.", campfire.id, to_add, i);
                        // Campfire struct (slots) didn't change, only InventoryItem quantity
                        // Return false because campfire struct itself was not modified for its slots.
                        return Ok(false); 
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
                instance_id: 0, 
                item_def_id: charcoal_def_id,
                quantity, // This will be 1 from production
                location: new_charcoal_location,
            };
            match inventory_items_table.try_insert(new_charcoal_item) {
                Ok(inserted_item) => {
                    campfire.set_slot(i, Some(inserted_item.instance_id), Some(charcoal_def_id));
                    log::info!("[Charcoal] Campfire {}: Placed {} charcoal into empty slot {}.", campfire.id, quantity, i);
                    charcoal_added_to_campfire_slots = true; // Campfire struct was modified
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
    let drop_y = campfire.pos_y + crate::dropped_item::DROP_OFFSET / 2.0; 
    create_dropped_item_entity(ctx, charcoal_def_id, quantity, drop_x, drop_y)?;
    
    Ok(charcoal_added_to_campfire_slots) // False, as it was dropped or failed to add to slots by modifying campfire struct
}

// --- CookableAppliance Trait Implementation for Campfire ---
impl crate::cooking::CookableAppliance for Campfire {
    fn num_processing_slots(&self) -> usize {
        NUM_FUEL_SLOTS // Campfires use their fuel slots for cooking
    }

    fn get_slot_instance_id(&self, slot_index: u8) -> Option<u64> {
        // Delegate to existing ItemContainer method
        <Self as ItemContainer>::get_slot_instance_id(self, slot_index)
    }

    fn get_slot_def_id(&self, slot_index: u8) -> Option<u64> {
        // Delegate to existing ItemContainer method
        <Self as ItemContainer>::get_slot_def_id(self, slot_index)
    }

    fn set_slot(&mut self, slot_index: u8, instance_id: Option<u64>, def_id: Option<u64>) {
        // Delegate to existing ItemContainer method
        <Self as ItemContainer>::set_slot(self, slot_index, instance_id, def_id);
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
            _ => { log::warn!("[CookableAppliance] Attempted to set cooking progress for invalid Campfire slot: {}", slot_index); }
        }
    }

    fn get_appliance_entity_id(&self) -> u64 {
        self.id as u64
    }

    fn get_appliance_world_position(&self) -> (f32, f32) {
        (self.pos_x, self.pos_y)
    }

    fn get_appliance_container_type(&self) -> ContainerType {
        ContainerType::Campfire // Campfire's own container type
    }
}

/// Checks if it's currently raining by looking at the world state
fn is_raining(ctx: &ReducerContext) -> bool {
    if let Some(world_state) = ctx.db.world_state().iter().next() {
        world_state.rain_intensity > 0.0
    } else {
        false
    }
}

/// Checks if a campfire is protected from rain by being inside a shelter
fn is_campfire_protected_from_rain(ctx: &ReducerContext, campfire: &Campfire) -> bool {
    // Check if campfire is inside any shelter
    for shelter in ctx.db.shelter().iter() {
        if shelter.is_destroyed {
            continue;
        }
        
        // Use the same shelter collision detection logic as in shelter.rs
        let shelter_aabb_center_x = shelter.pos_x;
        let shelter_aabb_center_y = shelter.pos_y - crate::shelter::SHELTER_AABB_CENTER_Y_OFFSET_FROM_POS_Y;
        let aabb_left = shelter_aabb_center_x - crate::shelter::SHELTER_AABB_HALF_WIDTH;
        let aabb_right = shelter_aabb_center_x + crate::shelter::SHELTER_AABB_HALF_WIDTH;
        let aabb_top = shelter_aabb_center_y - crate::shelter::SHELTER_AABB_HALF_HEIGHT;
        let aabb_bottom = shelter_aabb_center_y + crate::shelter::SHELTER_AABB_HALF_HEIGHT;
        
        // Check if campfire position is inside shelter AABB
        if campfire.pos_x >= aabb_left && campfire.pos_x <= aabb_right &&
           campfire.pos_y >= aabb_top && campfire.pos_y <= aabb_bottom {
            log::debug!("Campfire {} is protected from rain by shelter {}", campfire.id, shelter.id);
            return true;
        }
    }
    
    false
}