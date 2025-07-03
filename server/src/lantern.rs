use spacetimedb::{table, reducer, ReducerContext, Table, Identity, Timestamp, ScheduleAt, TimeDuration};
use log;
use crate::items::{InventoryItem, ItemDefinition, add_item_to_player_inventory, split_stack_helper};
use crate::items::{inventory_item as InventoryItemTableTrait, item_definition as ItemDefinitionTableTrait};
use crate::models::{ItemLocation, ContainerType, ContainerLocationData, InventoryLocationData, HotbarLocationData, EquippedLocationData, DroppedLocationData};
use crate::inventory_management::{self, ItemContainer, ContainerItemClearer, handle_move_to_container_slot, handle_quick_move_from_container, handle_move_from_container_slot, handle_move_within_container, handle_split_within_container, handle_quick_move_to_container, handle_split_from_container, handle_drop_from_container_slot, handle_split_and_drop_from_container_slot, merge_or_place_into_container_slot};
use crate::{Player, player as PlayerTableTrait};
use crate::campfire::{campfire as CampfireTableTrait};
use crate::wooden_storage_box::{wooden_storage_box as WoodenStorageBoxTableTrait};
use crate::environment::calculate_chunk_index;
use crate::player_inventory::{get_player_item, find_first_empty_player_slot, move_item_to_inventory, move_item_to_hotbar};
use crate::dropped_item::create_dropped_item_entity_with_data;

// --- ADDED: Import for sound events ---
use crate::sound_events::{start_lantern_sound, stop_lantern_sound};

// --- Constants ---
pub const FUEL_BURN_DURATION_MICROSECONDS: i64 = 120_000_000; // 120 seconds (double campfire duration)
pub const LANTERN_WARMTH_RADIUS_SQUARED: f32 = 3600.0; // 60 pixel radius (same as campfire)
pub const WARMTH_PER_SECOND: f32 = 0.5; // Same warmth as campfire
pub const LANTERN_PLACEMENT_MAX_DISTANCE: f32 = 150.0;
pub const LANTERN_PLACEMENT_MAX_DISTANCE_SQUARED: f32 = LANTERN_PLACEMENT_MAX_DISTANCE * LANTERN_PLACEMENT_MAX_DISTANCE;
pub const LANTERN_LANTERN_COLLISION_DISTANCE: f32 = 100.0;
pub const LANTERN_LANTERN_COLLISION_DISTANCE_SQUARED: f32 = LANTERN_LANTERN_COLLISION_DISTANCE * LANTERN_LANTERN_COLLISION_DISTANCE;
pub const LANTERN_INITIAL_HEALTH: f32 = 80.0;
pub const LANTERN_MAX_HEALTH: f32 = 80.0;
pub const NUM_FUEL_SLOTS: usize = 1;
pub const LANTERN_PROCESS_INTERVAL_SECS: u64 = 1; // How often to run the main logic when burning
pub const PLAYER_LANTERN_INTERACTION_DISTANCE: f32 = 200.0;
pub const PLAYER_LANTERN_INTERACTION_DISTANCE_SQUARED: f32 = PLAYER_LANTERN_INTERACTION_DISTANCE * PLAYER_LANTERN_INTERACTION_DISTANCE;
pub const INITIAL_LANTERN_FUEL_AMOUNT: u32 = 25; // UNUSED: Lanterns now start empty when placed

// --- Lantern Table ---
#[spacetimedb::table(name = lantern, public)]
#[derive(Clone, Debug)]
pub struct Lantern {
    #[primary_key]
    #[auto_inc]
    pub id: u32,
    pub pos_x: f32,
    pub pos_y: f32,
    pub chunk_index: u32,
    pub placed_by: Identity,
    pub placed_at: Timestamp,
    pub is_burning: bool,
    // Fuel slot for tallow
    pub fuel_instance_id_0: Option<u64>,
    pub fuel_def_id_0: Option<u64>,
    pub current_fuel_def_id: Option<u64>,
    pub remaining_fuel_burn_time_secs: Option<f32>,
    pub health: f32,
    pub max_health: f32,
    pub is_destroyed: bool,
    pub destroyed_at: Option<Timestamp>,
    pub last_hit_time: Option<Timestamp>,
    pub last_damaged_by: Option<Identity>,
}

// --- Scheduled Processing Table ---
#[spacetimedb::table(name = lantern_processing_schedule, scheduled(process_lantern_logic_scheduled), public)]
pub struct LanternProcessingSchedule {
    #[primary_key]
    pub lantern_id: u64,
    pub scheduled_at: ScheduleAt,
}

// --- ItemContainer Implementation ---
impl ItemContainer for Lantern {
    fn num_slots(&self) -> usize {
        NUM_FUEL_SLOTS
    }

    fn get_slot_instance_id(&self, slot_index: u8) -> Option<u64> {
        match slot_index {
            0 => self.fuel_instance_id_0,
            _ => None,
        }
    }

    fn get_slot_def_id(&self, slot_index: u8) -> Option<u64> {
        match slot_index {
            0 => self.fuel_def_id_0,
            _ => None,
        }
    }

    fn set_slot(&mut self, slot_index: u8, instance_id: Option<u64>, def_id: Option<u64>) {
        match slot_index {
            0 => {
                self.fuel_instance_id_0 = instance_id;
                self.fuel_def_id_0 = def_id;
            }
            _ => {}
        }
    }

    fn get_container_type(&self) -> ContainerType {
        ContainerType::Lantern
    }

    fn get_container_id(&self) -> u64 {
        self.id as u64
    }
}

/******************************************************************************
 *                           REDUCERS (Generic Handlers)                        *
 ******************************************************************************/

/// --- Move Item to Lantern ---
#[spacetimedb::reducer]
pub fn move_item_to_lantern(ctx: &ReducerContext, lantern_id: u32, target_slot_index: u8, item_instance_id: u64) -> Result<(), String> {
    let (_player, mut lantern) = validate_lantern_interaction(ctx, lantern_id)?;
    handle_move_to_container_slot(ctx, &mut lantern, target_slot_index, item_instance_id)?;
    ctx.db.lantern().id().update(lantern.clone());
    schedule_next_lantern_processing(ctx, lantern_id);
    Ok(())
}

/// --- Light Lantern ---
#[spacetimedb::reducer]
pub fn light_lantern(ctx: &ReducerContext, lantern_id: u32) -> Result<(), String> {
    let (_player, mut lantern) = validate_lantern_interaction(ctx, lantern_id)?;
    
    if lantern.is_burning {
        return Err("Lantern is already lit.".to_string());
    }
    
    if !check_if_lantern_has_fuel(ctx, &lantern) {
        return Err("Cannot light lantern, requires tallow fuel.".to_string());
    }
    
    lantern.is_burning = true;
    log::info!("Lantern {} lit by player {:?}.", lantern.id, ctx.sender);
    
    // Start lantern sound
    start_lantern_sound(ctx, lantern.id as u64, lantern.pos_x, lantern.pos_y);
    
    ctx.db.lantern().id().update(lantern.clone());
    schedule_next_lantern_processing(ctx, lantern_id);
    Ok(())
}

/// --- Extinguish Lantern ---
#[spacetimedb::reducer]
pub fn extinguish_lantern(ctx: &ReducerContext, lantern_id: u32) -> Result<(), String> {
    let (_player, mut lantern) = validate_lantern_interaction(ctx, lantern_id)?;
    
    if !lantern.is_burning {
        return Err("Lantern is already extinguished.".to_string());
    }
    
    lantern.is_burning = false;
    lantern.current_fuel_def_id = None;
    lantern.remaining_fuel_burn_time_secs = None;
    log::info!("Lantern {} extinguished by player {:?}.", lantern.id, ctx.sender);
    
    // Stop lantern sound
    stop_lantern_sound(ctx, lantern.id as u64);
    
    ctx.db.lantern().id().update(lantern.clone());
    schedule_next_lantern_processing(ctx, lantern_id);
    Ok(())
}

/// --- Toggle Lantern ---
/// Toggles the burning state of the lantern (lights or extinguishes it).
/// Similar to toggle_campfire_burning but without rain protection since lanterns are typically protected.
#[spacetimedb::reducer]
pub fn toggle_lantern(ctx: &ReducerContext, lantern_id: u32) -> Result<(), String> {
    let (_player, mut lantern) = validate_lantern_interaction(ctx, lantern_id)?;
    
    if lantern.is_burning {
        // Extinguish the lantern
        lantern.is_burning = false;
        lantern.current_fuel_def_id = None;
        lantern.remaining_fuel_burn_time_secs = None;
        log::info!("Lantern {} extinguished by player {:?}.", lantern.id, ctx.sender);
        
        // Stop lantern sound
        stop_lantern_sound(ctx, lantern.id as u64);
    } else {
        // Light the lantern
        if !check_if_lantern_has_fuel(ctx, &lantern) {
            return Err("Cannot light lantern, requires tallow fuel.".to_string());
        }
        
        lantern.is_burning = true;
        // remaining_fuel_burn_time_secs will be set by the first call to process_lantern_logic_scheduled
        log::info!("Lantern {} lit by player {:?}.", lantern.id, ctx.sender);
        
        // Start lantern sound
        start_lantern_sound(ctx, lantern.id as u64, lantern.pos_x, lantern.pos_y);
    }
    
    ctx.db.lantern().id().update(lantern.clone());
    schedule_next_lantern_processing(ctx, lantern_id);
    Ok(())
}

/// --- Pickup Lantern ---
#[spacetimedb::reducer]
pub fn pickup_lantern(ctx: &ReducerContext, lantern_id: u32) -> Result<(), String> {
    let (player, lantern) = validate_lantern_interaction(ctx, lantern_id)?;
    
    // Drop all fuel items first
    for slot_index in 0..NUM_FUEL_SLOTS as u8 {
        if lantern.get_slot_instance_id(slot_index).is_some() {
            drop_item_from_lantern_slot_to_world(ctx, lantern_id, slot_index)?;
        }
    }
    
    // Get lantern item definition
    let item_defs = ctx.db.item_definition();
    let lantern_def = item_defs.iter()
        .find(|def| def.name == "Lantern")
        .ok_or_else(|| "Lantern item definition not found.".to_string())?;
    
    // Add lantern item to player inventory
    let new_location = find_first_empty_player_slot(ctx, ctx.sender)
        .ok_or_else(|| "Player inventory is full, cannot pickup lantern.".to_string())?;
    
    let new_lantern_item = InventoryItem {
        instance_id: 0, // Auto-inc
        item_def_id: lantern_def.id,
        quantity: 1,
        location: new_location,
        item_data: None, // Initialize as empty
    };
    
    ctx.db.inventory_item().try_insert(new_lantern_item)
        .map_err(|e| format!("Failed to insert lantern item: {}", e))?;
    
    // 🔊 Stop lantern sound if it was burning when picked up
    if lantern.is_burning {
        stop_lantern_sound(ctx, lantern.id as u64);
    }
    
    // Delete the lantern entity
    ctx.db.lantern().id().delete(lantern_id);
    
    log::info!("Player {:?} picked up lantern {}", ctx.sender, lantern_id);
    Ok(())
}

/// --- Place Lantern ---
#[spacetimedb::reducer]
pub fn place_lantern(ctx: &ReducerContext, item_instance_id: u64, world_x: f32, world_y: f32) -> Result<(), String> {
    let sender_id = ctx.sender;
    let inventory_items = ctx.db.inventory_item();
    let item_defs = ctx.db.item_definition();
    let players = ctx.db.player();
    let lanterns = ctx.db.lantern();

    // Look up item definition IDs
    let lantern_def_id = item_defs.iter()
        .find(|def| def.name == "Lantern")
        .map(|def| def.id)
        .ok_or_else(|| "Item definition for 'Lantern' not found.".to_string())?;

    let tallow_def_id = item_defs.iter()
        .find(|def| def.name == "Tallow")
        .map(|def| def.id)
        .ok_or_else(|| "Item definition for 'Tallow' not found.".to_string())?;

    log::info!(
        "[PlaceLantern] Player {:?} attempting placement of item {} at ({:.1}, {:.1})",
        sender_id, item_instance_id, world_x, world_y
    );

    // Validate player and placement rules
    let player = players.identity().find(sender_id)
        .ok_or_else(|| "Player not found".to_string())?;

    if player.is_dead {
        return Err("Cannot place lantern while dead.".to_string());
    }
    if player.is_knocked_out {
        return Err("Cannot place lantern while knocked out.".to_string());
    }

    let dx_place = world_x - player.position_x;
    let dy_place = world_y - player.position_y;
    let dist_sq_place = dx_place * dx_place + dy_place * dy_place;
    if dist_sq_place > LANTERN_PLACEMENT_MAX_DISTANCE_SQUARED {
        return Err(format!("Cannot place lantern too far away ({} > {}).",
                dist_sq_place.sqrt(), LANTERN_PLACEMENT_MAX_DISTANCE));
    }

    // Check for collision with other lanterns
    for other_lantern in lanterns.iter() {
        let dx_lantern = world_x - other_lantern.pos_x;
        let dy_lantern = world_y - other_lantern.pos_y;
        let dist_sq_lantern = dx_lantern * dx_lantern + dy_lantern * dy_lantern;
        if dist_sq_lantern < LANTERN_LANTERN_COLLISION_DISTANCE_SQUARED {
            return Err("Cannot place lantern too close to another lantern.".to_string());
        }
    }

    // Find and validate the item instance
    let item_to_consume = inventory_items.instance_id().find(item_instance_id)
        .ok_or_else(|| format!("Item instance {} not found.", item_instance_id))?;

    // Validate ownership and location
    match item_to_consume.location {
        ItemLocation::Inventory(ref data) => {
            if data.owner_id != sender_id {
                return Err(format!("Item instance {} not owned by player.", item_instance_id));
            }
        }
        ItemLocation::Hotbar(ref data) => {
            if data.owner_id != sender_id {
                return Err(format!("Item instance {} not owned by player.", item_instance_id));
            }
        }
        _ => {
            return Err(format!("Item instance {} must be in inventory or hotbar to be placed.", item_instance_id));
        }
    }

    if item_to_consume.item_def_id != lantern_def_id {
        return Err(format!("Item instance {} is not a Lantern.", item_instance_id));
    }

    // Consume the item
    log::info!(
        "[PlaceLantern] Consuming item instance {} from player {:?}",
        item_instance_id, sender_id
    );
    inventory_items.instance_id().delete(item_instance_id);

    // Create lantern entity (without fuel)
    let current_time = ctx.timestamp;
    let chunk_idx = calculate_chunk_index(world_x, world_y);

    let new_lantern = Lantern {
        id: 0, // Auto-incremented
        pos_x: world_x,
        pos_y: world_y + 32.0, // Compensate for bottom-anchoring
        chunk_index: chunk_idx,
        placed_by: sender_id,
        placed_at: current_time,
        is_burning: false,
        fuel_instance_id_0: None,
        fuel_def_id_0: None,
        current_fuel_def_id: None,
        remaining_fuel_burn_time_secs: None,
        health: LANTERN_INITIAL_HEALTH,
        max_health: LANTERN_MAX_HEALTH,
        is_destroyed: false,
        destroyed_at: None,
        last_hit_time: None,
        last_damaged_by: None,
    };

    let inserted_lantern = lanterns.try_insert(new_lantern.clone())
        .map_err(|e| format!("Failed to insert lantern entity: {}", e))?;
    let new_lantern_id = inserted_lantern.id;

    log::info!("Player {} placed an empty lantern {} at ({:.1}, {:.1}). Add tallow to use.",
             player.username, new_lantern_id, world_x, world_y);

    // Schedule initial processing
    schedule_next_lantern_processing(ctx, new_lantern_id);

    Ok(())
}

/******************************************************************************
 *                       SCHEDULED PROCESSING                                   *
 ******************************************************************************/

/// --- Scheduled Lantern Processing ---
#[spacetimedb::reducer]
pub fn process_lantern_logic_scheduled(ctx: &ReducerContext, schedule_args: LanternProcessingSchedule) -> Result<(), String> {
    // Security check
    if ctx.sender != ctx.identity() {
        return Err("Reducer process_lantern_logic_scheduled may not be invoked by clients, only via scheduling.".into());
    }

    let lantern_id = schedule_args.lantern_id as u32;
    let mut lanterns = ctx.db.lantern();

    let mut lantern = match lanterns.id().find(lantern_id) {
        Some(lantern) => lantern,
        None => {
            log::warn!("[LanternScheduled] Lantern {} not found, canceling schedule.", lantern_id);
            return Ok(());
        }
    };

    if lantern.is_destroyed {
        log::info!("[LanternScheduled] Lantern {} is destroyed, canceling schedule.", lantern_id);
        return Ok(());
    }

    if !lantern.is_burning {
        log::debug!("[LanternScheduled] Lantern {} is not burning, no processing needed.", lantern_id);
        schedule_next_lantern_processing(ctx, lantern_id);
        return Ok(());
    }

    // Process fuel consumption
    let mut needs_update = false;
    let mut should_extinguish = false;

    // Check if we have current fuel burning
    if let Some(remaining_time) = lantern.remaining_fuel_burn_time_secs {
        let time_elapsed = LANTERN_PROCESS_INTERVAL_SECS as f32;
        let new_remaining_time = remaining_time - time_elapsed;

        if new_remaining_time <= 0.0 {
            // Current fuel unit is exhausted
            log::info!("[LanternScheduled] Fuel unit exhausted in lantern {}.", lantern_id);
            lantern.remaining_fuel_burn_time_secs = None;
            lantern.current_fuel_def_id = None;
            needs_update = true;

            // Try to find next fuel unit
            if !try_consume_next_fuel_unit(ctx, &mut lantern) {
                should_extinguish = true;
            } else {
                needs_update = true;
            }
        } else {
            // Update remaining time
            lantern.remaining_fuel_burn_time_secs = Some(new_remaining_time);
            needs_update = true;
        }
    } else {
        // No current fuel, try to start burning next unit
        if !try_consume_next_fuel_unit(ctx, &mut lantern) {
            should_extinguish = true;
        } else {
            needs_update = true;
        }
    }

    if should_extinguish {
        lantern.is_burning = false;
        lantern.current_fuel_def_id = None;
        lantern.remaining_fuel_burn_time_secs = None;
        needs_update = true;
        log::info!("[LanternScheduled] Lantern {} extinguished due to lack of fuel.", lantern_id);
        
        // 🔊 Stop lantern looping sound when extinguished due to fuel exhaustion
        crate::sound_events::stop_lantern_sound(ctx, lantern_id as u64);
    }

    if needs_update {
        lanterns.id().update(lantern);
    }

    schedule_next_lantern_processing(ctx, lantern_id);
    Ok(())
}

/******************************************************************************
 *                       HELPER FUNCTIONS                                       *
 ******************************************************************************/

fn validate_lantern_interaction(ctx: &ReducerContext, lantern_id: u32) -> Result<(Player, Lantern), String> {
    let sender_id = ctx.sender;
    let players = ctx.db.player();
    let lanterns = ctx.db.lantern();

    let player = players.identity().find(sender_id)
        .ok_or_else(|| "Player not found".to_string())?;

    let lantern = lanterns.id().find(lantern_id)
        .ok_or_else(|| format!("Lantern {} not found", lantern_id))?;

    if player.is_dead {
        return Err("Cannot interact with lantern while dead.".to_string());
    }

    if player.is_knocked_out {
        return Err("Cannot interact with lantern while knocked out.".to_string());
    }

    if lantern.is_destroyed {
        return Err("Cannot interact with destroyed lantern.".to_string());
    }

    let dx = player.position_x - lantern.pos_x;
    let dy = player.position_y - lantern.pos_y;
    let dist_sq = dx * dx + dy * dy;

    if dist_sq > PLAYER_LANTERN_INTERACTION_DISTANCE_SQUARED {
        return Err("Player is too far away from the lantern.".to_string());
    }

    Ok((player, lantern))
}

pub(crate) fn check_if_lantern_has_fuel(ctx: &ReducerContext, lantern: &Lantern) -> bool {
    let inventory_table = ctx.db.inventory_item();
    let item_def_table = ctx.db.item_definition();

    // Check each fuel slot
    for slot_index in 0..NUM_FUEL_SLOTS as u8 {
        if let Some(item_instance_id) = lantern.get_slot_instance_id(slot_index) {
            if let Some(item) = inventory_table.instance_id().find(item_instance_id) {
                if let Some(item_def) = item_def_table.id().find(item.item_def_id) {
                    if item_def.name == "Tallow" && item.quantity > 0 {
                        return true;
                    }
                }
            }
        }
    }
    false
}

fn try_consume_next_fuel_unit(ctx: &ReducerContext, lantern: &mut Lantern) -> bool {
    let inventory_table = ctx.db.inventory_item();
    let item_def_table = ctx.db.item_definition();

    // Look for tallow in fuel slots
    for slot_index in 0..NUM_FUEL_SLOTS as u8 {
        if let Some(item_instance_id) = lantern.get_slot_instance_id(slot_index) {
            if let Some(mut item) = inventory_table.instance_id().find(item_instance_id) {
                if let Some(item_def) = item_def_table.id().find(item.item_def_id) {
                    if item_def.name == "Tallow" && item.quantity > 0 {
                        // Consume one unit of tallow
                        item.quantity -= 1;
                        
                        if item.quantity == 0 {
                            // Remove empty item
                            inventory_table.instance_id().delete(item_instance_id);
                            lantern.set_slot(slot_index, None, None);
                        } else {
                            // Update item quantity
                            inventory_table.instance_id().update(item);
                        }

                        // Set burn time (double the duration of campfire wood)
                        lantern.current_fuel_def_id = Some(item_def.id);
                        lantern.remaining_fuel_burn_time_secs = Some(FUEL_BURN_DURATION_MICROSECONDS as f32 / 1_000_000.0);
                        
                        log::info!("[Lantern] Started burning tallow unit in lantern {}, {} seconds remaining.", lantern.id, FUEL_BURN_DURATION_MICROSECONDS / 1_000_000);
                        return true;
                    }
                }
            }
        }
    }
    false
}

pub fn schedule_next_lantern_processing(ctx: &ReducerContext, lantern_id: u32) -> Result<(), String> {
    // Cancel existing schedule
    let existing_schedules = ctx.db.lantern_processing_schedule();
    if let Some(_existing) = existing_schedules.lantern_id().find(lantern_id as u64) {
        existing_schedules.lantern_id().delete(lantern_id as u64);
    }

    // Check if lantern still exists and needs processing
    let lanterns = ctx.db.lantern();
    let lantern = match lanterns.id().find(lantern_id) {
        Some(lantern) => lantern,
        None => return Ok(()), // Lantern doesn't exist anymore
    };

    if lantern.is_destroyed {
        return Ok(()); // Don't schedule destroyed lanterns
    }

    // Schedule next processing
    let next_schedule = LanternProcessingSchedule {
        lantern_id: lantern_id as u64,
        scheduled_at: TimeDuration::from_micros(LANTERN_PROCESS_INTERVAL_SECS as i64 * 1_000_000).into(),
    };

    existing_schedules.try_insert(next_schedule)
        .map_err(|e| format!("Failed to schedule lantern processing: {}", e))?;

    Ok(())
}

/// --- Drop Item from Lantern Slot to World ---
#[spacetimedb::reducer]
pub fn drop_item_from_lantern_slot_to_world(
    ctx: &ReducerContext,
    lantern_id: u32,
    slot_index: u8,
) -> Result<(), String> {
    let (player, mut lantern) = validate_lantern_interaction(ctx, lantern_id)?;
    
    handle_drop_from_container_slot(
        ctx,
        &mut lantern,
        slot_index,
        &player,
    )?;
    
    ctx.db.lantern().id().update(lantern);
    Ok(())
}

// --- ContainerItemClearer Implementation ---
pub struct LanternClearer;

impl ContainerItemClearer for LanternClearer {
    fn clear_item(ctx: &ReducerContext, item_instance_id: u64) -> bool {
        let lanterns = ctx.db.lantern();
        
        for mut lantern in lanterns.iter() {
            let mut found_and_cleared = false;
            
            // Check each fuel slot
            for slot_index in 0..NUM_FUEL_SLOTS as u8 {
                if let Some(stored_instance_id) = lantern.get_slot_instance_id(slot_index) {
                    if stored_instance_id == item_instance_id {
                        lantern.set_slot(slot_index, None, None);
                        found_and_cleared = true;
                        break;
                    }
                }
            }
            
            if found_and_cleared {
                let lantern_id = lantern.id;
                lanterns.id().update(lantern);
                log::info!("[Lantern] Cleared item {} from lantern {}", item_instance_id, lantern_id);
                return true;
            }
        }
        false
    }
}

/******************************************************************************
 *                           INVENTORY MANAGEMENT REDUCERS                     *
 ******************************************************************************/

/// --- Remove Fuel from Lantern ---
/// Removes the fuel item from a specific lantern slot and returns it to the player inventory/hotbar.
/// Uses the quick move logic (attempts merge, then finds first empty slot).
#[spacetimedb::reducer]
pub fn quick_move_from_lantern(ctx: &ReducerContext, lantern_id: u32, source_slot_index: u8) -> Result<(), String> {
    let (_player, mut lantern) = validate_lantern_interaction(ctx, lantern_id)?;
    inventory_management::handle_quick_move_from_container(ctx, &mut lantern, source_slot_index)?;
    let still_has_fuel = check_if_lantern_has_fuel(ctx, &lantern);
    if !still_has_fuel && lantern.is_burning {
        lantern.is_burning = false;
        lantern.current_fuel_def_id = None;
        lantern.remaining_fuel_burn_time_secs = None;
        log::info!("Lantern {} extinguished as last valid fuel was removed.", lantern_id);
    }
    ctx.db.lantern().id().update(lantern.clone());
    schedule_next_lantern_processing(ctx, lantern_id);
    Ok(())
}

/// --- Split Stack Into Lantern ---
/// Splits a stack from player inventory into a lantern slot.
#[spacetimedb::reducer]
pub fn split_stack_into_lantern(
    ctx: &ReducerContext,
    source_item_instance_id: u64,
    quantity_to_split: u32,
    target_lantern_id: u32,
    target_slot_index: u8,
) -> Result<(), String> {
    let (_player, mut lantern) = validate_lantern_interaction(ctx, target_lantern_id)?;
    let mut source_item = get_player_item(ctx, source_item_instance_id)?;
    let new_item_target_location = ItemLocation::Container(crate::models::ContainerLocationData {
        container_type: ContainerType::Lantern,
        container_id: lantern.id as u64,
        slot_index: target_slot_index,
    });
    let new_item_instance_id = split_stack_helper(ctx, &mut source_item, quantity_to_split, new_item_target_location)?;
    
    // Fetch the newly created item and its definition to pass to merge_or_place
    let mut new_item = ctx.db.inventory_item().instance_id().find(new_item_instance_id)
        .ok_or_else(|| format!("Failed to find newly split item instance {}", new_item_instance_id))?;
    let new_item_def = ctx.db.item_definition().id().find(new_item.item_def_id)
        .ok_or_else(|| format!("Failed to find definition for new item {}", new_item.item_def_id))?;

    merge_or_place_into_container_slot(ctx, &mut lantern, target_slot_index, &mut new_item, &new_item_def)?;
    
    // Update the source item (quantity changed by split_stack_helper)
    ctx.db.inventory_item().instance_id().update(source_item); 
    ctx.db.lantern().id().update(lantern.clone());
    schedule_next_lantern_processing(ctx, target_lantern_id);
    Ok(())
}

/// --- Lantern Internal Item Movement ---
/// Moves/merges/swaps an item BETWEEN two slots within the same lantern.
#[spacetimedb::reducer]
pub fn move_item_within_lantern(
    ctx: &ReducerContext,
    lantern_id: u32,
    source_slot_index: u8,
    target_slot_index: u8,
) -> Result<(), String> {
    let (_player, mut lantern) = validate_lantern_interaction(ctx, lantern_id)?;
    inventory_management::handle_move_within_container(ctx, &mut lantern, source_slot_index, target_slot_index)?;
    ctx.db.lantern().id().update(lantern.clone());
    schedule_next_lantern_processing(ctx, lantern_id);
    Ok(())
}

/// --- Lantern Internal Stack Splitting ---
/// Splits a stack FROM one lantern slot TO another within the same lantern.
#[spacetimedb::reducer]
pub fn split_stack_within_lantern(
    ctx: &ReducerContext,
    lantern_id: u32,
    source_slot_index: u8,
    quantity_to_split: u32,
    target_slot_index: u8,
) -> Result<(), String> {
    let (_player, mut lantern) = validate_lantern_interaction(ctx, lantern_id)?;
    inventory_management::handle_split_within_container(ctx, &mut lantern, source_slot_index, target_slot_index, quantity_to_split)?;
    ctx.db.lantern().id().update(lantern.clone());
    schedule_next_lantern_processing(ctx, lantern_id);
    Ok(())
}

/// --- Quick Move to Lantern ---
/// Quickly moves an item from player inventory/hotbar to the first available/mergeable slot in the lantern.
#[spacetimedb::reducer]
pub fn quick_move_to_lantern(
    ctx: &ReducerContext,
    lantern_id: u32,
    item_instance_id: u64,
) -> Result<(), String> {
    let (_player, mut lantern) = validate_lantern_interaction(ctx, lantern_id)?;
    inventory_management::handle_quick_move_to_container(ctx, &mut lantern, item_instance_id)?;
    ctx.db.lantern().id().update(lantern.clone());
    schedule_next_lantern_processing(ctx, lantern_id);
    Ok(())
}

/// --- Move From Lantern to Player ---
/// Moves a specific item FROM a lantern slot TO a specific player inventory/hotbar slot.
#[spacetimedb::reducer]
pub fn move_item_from_lantern_to_player_slot(
    ctx: &ReducerContext,
    lantern_id: u32,
    source_slot_index: u8,
    target_slot_type: String,
    target_slot_index: u32, // u32 to match client flexibility
) -> Result<(), String> {
    let (_player, mut lantern) = validate_lantern_interaction(ctx, lantern_id)?;
    inventory_management::handle_move_from_container_slot(ctx, &mut lantern, source_slot_index, target_slot_type, target_slot_index)?;
    let still_has_fuel = check_if_lantern_has_fuel(ctx, &lantern);
    if !still_has_fuel && lantern.is_burning {
        lantern.is_burning = false;
        lantern.current_fuel_def_id = None;
        lantern.remaining_fuel_burn_time_secs = None;
    }
    ctx.db.lantern().id().update(lantern.clone());
    schedule_next_lantern_processing(ctx, lantern_id);
    Ok(())
}

/// --- Split From Lantern to Player ---
/// Splits a stack FROM a lantern slot TO a specific player inventory/hotbar slot.
#[spacetimedb::reducer]
pub fn split_stack_from_lantern(
    ctx: &ReducerContext,
    source_lantern_id: u32,
    source_slot_index: u8,
    quantity_to_split: u32,
    target_slot_type: String,    // "inventory" or "hotbar"
    target_slot_index: u32,     // Numeric index for inventory/hotbar
) -> Result<(), String> {
    let (_player, mut lantern) = validate_lantern_interaction(ctx, source_lantern_id)?;

    log::info!(
        "[SplitFromLantern] Player {:?} delegating split {} from lantern {} slot {} to {} slot {}",
        ctx.sender, quantity_to_split, source_lantern_id, source_slot_index, target_slot_type, target_slot_index
    );

    // Call GENERIC Handler
    inventory_management::handle_split_from_container(
        ctx, 
        &mut lantern, 
        source_slot_index, 
        quantity_to_split,
        target_slot_type, 
        target_slot_index
    )?;

    // Check if lantern should be extinguished after fuel removal
    let still_has_fuel = check_if_lantern_has_fuel(ctx, &lantern);
    if !still_has_fuel && lantern.is_burning {
        lantern.is_burning = false;
        lantern.current_fuel_def_id = None;
        lantern.remaining_fuel_burn_time_secs = None;
        log::info!("Lantern {} extinguished as last valid fuel was removed.", source_lantern_id);
    }

    ctx.db.lantern().id().update(lantern.clone());
    schedule_next_lantern_processing(ctx, source_lantern_id);
    Ok(())
}

/// --- Split and Drop Item from Lantern Slot to World ---
/// Splits a specified quantity from a lantern slot and drops it as a world item.
#[spacetimedb::reducer]
pub fn split_and_drop_item_from_lantern_slot_to_world(
    ctx: &ReducerContext,
    lantern_id: u32,
    slot_index: u8,
    quantity_to_split: u32,
) -> Result<(), String> {
    let (_player, mut lantern) = validate_lantern_interaction(ctx, lantern_id)?;
    
    // Get the item in the slot
    let item_instance_id = lantern.get_slot_instance_id(slot_index)
        .ok_or_else(|| format!("No item in lantern {} slot {}", lantern_id, slot_index))?;
    
    let mut source_item = ctx.db.inventory_item().instance_id().find(item_instance_id)
        .ok_or_else(|| format!("Item instance {} not found", item_instance_id))?;
    
    if source_item.quantity < quantity_to_split {
        return Err(format!("Cannot split {} items, only {} available", quantity_to_split, source_item.quantity));
    }
    
    // Create the dropped item entity directly in the world
    create_dropped_item_entity_with_data(
        ctx,
        source_item.item_def_id,
        quantity_to_split,
        lantern.pos_x,
        lantern.pos_y,
        source_item.item_data.clone()
    )?;
    
    // Update source item quantity
    source_item.quantity -= quantity_to_split;
    
    if source_item.quantity == 0 {
        // Remove empty item and clear slot
        ctx.db.inventory_item().instance_id().delete(item_instance_id);
        lantern.set_slot(slot_index, None, None);
    } else {
        ctx.db.inventory_item().instance_id().update(source_item);
    }
    
    // Check if lantern should be extinguished after fuel removal
    let still_has_fuel = check_if_lantern_has_fuel(ctx, &lantern);
    if !still_has_fuel && lantern.is_burning {
        lantern.is_burning = false;
        lantern.current_fuel_def_id = None;
        lantern.remaining_fuel_burn_time_secs = None;
        log::info!("Lantern {} extinguished as last valid fuel was removed.", lantern_id);
    }
    
    ctx.db.lantern().id().update(lantern.clone());
    schedule_next_lantern_processing(ctx, lantern_id);
    Ok(())
}

/// --- Interact with Lantern ---
/// Basic interaction reducer for opening the lantern interface.
#[spacetimedb::reducer]
pub fn interact_with_lantern(ctx: &ReducerContext, lantern_id: u32) -> Result<(), String> {
    let (_player, _lantern) = validate_lantern_interaction(ctx, lantern_id)?;
    log::info!("Player {:?} interacted with lantern {}", ctx.sender, lantern_id);
    Ok(())
} 