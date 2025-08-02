/******************************************************************************
 *                                                                            *
 * Defines the PlayerCorpse entity, representing a lootable container dropped *
 * upon player death.                                                         *
 *                                                                            *
 ******************************************************************************/

use spacetimedb::{Identity, Timestamp, ReducerContext, SpacetimeType, Table};
use log;
use spacetimedb::spacetimedb_lib::ScheduleAt;
use std::time::Duration;

// Import new models
use crate::models::{ItemLocation, ContainerType, EquipmentSlotType, ContainerLocationData}; // <<< ADDED ContainerLocationData

// Define constants for the corpse
const DEFAULT_CORPSE_DESPAWN_SECONDS: u64 = 300; // Default to 5 minutes if no items or no respawn times set
pub(crate) const CORPSE_COLLISION_RADIUS: f32 = 18.0; // Similar to box/campfire
pub(crate) const CORPSE_COLLISION_Y_OFFSET: f32 = 10.0; // Similar to box/campfire
pub(crate) const PLAYER_CORPSE_COLLISION_DISTANCE_SQUARED: f32 = (super::PLAYER_RADIUS + CORPSE_COLLISION_RADIUS) * (super::PLAYER_RADIUS + CORPSE_COLLISION_RADIUS);
pub(crate) const PLAYER_CORPSE_INTERACTION_DISTANCE_SQUARED: f32 = 64.0 * 64.0; // Similar interaction range
pub(crate) const NUM_CORPSE_SLOTS: usize = 30 + 5; // 24 inv + 6 hotbar + 5 equipment (example)
pub(crate) const PLAYER_CORPSE_INITIAL_HEALTH: u32 = 100; // Health for harvesting the corpse itself

// Import required items
use crate::environment::calculate_chunk_index;
use crate::inventory_management::{self, ItemContainer, ContainerItemClearer};
use crate::Player; // Import Player struct directly
use crate::items::{InventoryItem, inventory_item as InventoryItemTableTrait}; // Import trait and struct
use crate::items::item_definition as ItemDefinitionTableTrait; // <<< ADDED ItemDefinition trait
use crate::player_corpse::player_corpse as PlayerCorpseTableTrait; // Self trait
use crate::player;
use crate::player_inventory::{move_item_to_inventory, move_item_to_hotbar, NUM_PLAYER_INVENTORY_SLOTS, NUM_PLAYER_HOTBAR_SLOTS};
use crate::items::add_item_to_player_inventory;

/// --- Player Corpse Data Structure ---
/// Represents a lootable backpack dropped when a player dies.
/// Contains the player's inventory at the time of death.
#[spacetimedb::table(name = player_corpse, public)]
#[derive(Clone)]
pub struct PlayerCorpse {
    #[primary_key]
    #[auto_inc]
    pub id: u32, // Unique identifier for this corpse instance

    pub player_identity: Identity,
    pub username: String, // For UI display

    pub pos_x: f32,
    pub pos_y: f32,
    pub chunk_index: u32, // For spatial queries

    pub death_time: Timestamp,
    pub despawn_scheduled_at: Timestamp, // When this corpse should be removed

    // --- Harvesting Fields ---
    pub health: u32,
    pub max_health: u32,
    pub last_hit_time: Option<Timestamp>,

    // --- Inventory Slots (0-NUM_CORPSE_SLOTS-1) ---
    // Conceptually: Player inv (0-23), hotbar (24-29), equipment (30-34)
    pub slot_instance_id_0: Option<u64>, pub slot_def_id_0: Option<u64>,
    pub slot_instance_id_1: Option<u64>, pub slot_def_id_1: Option<u64>,
    pub slot_instance_id_2: Option<u64>, pub slot_def_id_2: Option<u64>,
    pub slot_instance_id_3: Option<u64>, pub slot_def_id_3: Option<u64>,
    pub slot_instance_id_4: Option<u64>, pub slot_def_id_4: Option<u64>,
    pub slot_instance_id_5: Option<u64>, pub slot_def_id_5: Option<u64>,
    pub slot_instance_id_6: Option<u64>, pub slot_def_id_6: Option<u64>,
    pub slot_instance_id_7: Option<u64>, pub slot_def_id_7: Option<u64>,
    pub slot_instance_id_8: Option<u64>, pub slot_def_id_8: Option<u64>,
    pub slot_instance_id_9: Option<u64>, pub slot_def_id_9: Option<u64>,
    pub slot_instance_id_10: Option<u64>, pub slot_def_id_10: Option<u64>,
    pub slot_instance_id_11: Option<u64>, pub slot_def_id_11: Option<u64>,
    pub slot_instance_id_12: Option<u64>, pub slot_def_id_12: Option<u64>,
    pub slot_instance_id_13: Option<u64>, pub slot_def_id_13: Option<u64>,
    pub slot_instance_id_14: Option<u64>, pub slot_def_id_14: Option<u64>,
    pub slot_instance_id_15: Option<u64>, pub slot_def_id_15: Option<u64>,
    pub slot_instance_id_16: Option<u64>, pub slot_def_id_16: Option<u64>,
    pub slot_instance_id_17: Option<u64>, pub slot_def_id_17: Option<u64>,
    pub slot_instance_id_18: Option<u64>, pub slot_def_id_18: Option<u64>,
    pub slot_instance_id_19: Option<u64>, pub slot_def_id_19: Option<u64>,
    pub slot_instance_id_20: Option<u64>, pub slot_def_id_20: Option<u64>,
    pub slot_instance_id_21: Option<u64>, pub slot_def_id_21: Option<u64>,
    pub slot_instance_id_22: Option<u64>, pub slot_def_id_22: Option<u64>,
    pub slot_instance_id_23: Option<u64>, pub slot_def_id_23: Option<u64>,
    pub slot_instance_id_24: Option<u64>, pub slot_def_id_24: Option<u64>,
    pub slot_instance_id_25: Option<u64>, pub slot_def_id_25: Option<u64>,
    pub slot_instance_id_26: Option<u64>, pub slot_def_id_26: Option<u64>,
    pub slot_instance_id_27: Option<u64>, pub slot_def_id_27: Option<u64>,
    pub slot_instance_id_28: Option<u64>, pub slot_def_id_28: Option<u64>,
    pub slot_instance_id_29: Option<u64>, pub slot_def_id_29: Option<u64>,
    // Add more slots if NUM_CORPSE_SLOTS is increased for equipment
    pub slot_instance_id_30: Option<u64>, pub slot_def_id_30: Option<u64>,
    pub slot_instance_id_31: Option<u64>, pub slot_def_id_31: Option<u64>,
    pub slot_instance_id_32: Option<u64>, pub slot_def_id_32: Option<u64>,
    pub slot_instance_id_33: Option<u64>, pub slot_def_id_33: Option<u64>,
    pub slot_instance_id_34: Option<u64>, pub slot_def_id_34: Option<u64>,
}

impl ItemContainer for PlayerCorpse {
    fn num_slots(&self) -> usize {
        NUM_CORPSE_SLOTS
    }

    fn get_slot_instance_id(&self, slot_index: u8) -> Option<u64> {
        if slot_index >= NUM_CORPSE_SLOTS as u8 { return None; }
        match slot_index {
            0 => self.slot_instance_id_0, 1 => self.slot_instance_id_1,
            2 => self.slot_instance_id_2, 3 => self.slot_instance_id_3,
            4 => self.slot_instance_id_4, 5 => self.slot_instance_id_5,
            6 => self.slot_instance_id_6, 7 => self.slot_instance_id_7,
            8 => self.slot_instance_id_8, 9 => self.slot_instance_id_9,
            10 => self.slot_instance_id_10, 11 => self.slot_instance_id_11,
            12 => self.slot_instance_id_12, 13 => self.slot_instance_id_13,
            14 => self.slot_instance_id_14, 15 => self.slot_instance_id_15,
            16 => self.slot_instance_id_16, 17 => self.slot_instance_id_17,
            18 => self.slot_instance_id_18, 19 => self.slot_instance_id_19,
            20 => self.slot_instance_id_20, 21 => self.slot_instance_id_21,
            22 => self.slot_instance_id_22, 23 => self.slot_instance_id_23,
            24 => self.slot_instance_id_24, 25 => self.slot_instance_id_25,
            26 => self.slot_instance_id_26, 27 => self.slot_instance_id_27,
            28 => self.slot_instance_id_28, 29 => self.slot_instance_id_29,
            30 => self.slot_instance_id_30, 31 => self.slot_instance_id_31,
            32 => self.slot_instance_id_32, 33 => self.slot_instance_id_33,
            34 => self.slot_instance_id_34,
            _ => None, // Unreachable due to index check
        }
    }

    fn get_slot_def_id(&self, slot_index: u8) -> Option<u64> {
        if slot_index >= NUM_CORPSE_SLOTS as u8 { return None; }
        match slot_index {
            0 => self.slot_def_id_0, 1 => self.slot_def_id_1,
            2 => self.slot_def_id_2, 3 => self.slot_def_id_3,
            4 => self.slot_def_id_4, 5 => self.slot_def_id_5,
            6 => self.slot_def_id_6, 7 => self.slot_def_id_7,
            8 => self.slot_def_id_8, 9 => self.slot_def_id_9,
            10 => self.slot_def_id_10, 11 => self.slot_def_id_11,
            12 => self.slot_def_id_12, 13 => self.slot_def_id_13,
            14 => self.slot_def_id_14, 15 => self.slot_def_id_15,
            16 => self.slot_def_id_16, 17 => self.slot_def_id_17,
            18 => self.slot_def_id_18, 19 => self.slot_def_id_19,
            20 => self.slot_def_id_20, 21 => self.slot_def_id_21,
            22 => self.slot_def_id_22, 23 => self.slot_def_id_23,
            24 => self.slot_def_id_24, 25 => self.slot_def_id_25,
            26 => self.slot_def_id_26, 27 => self.slot_def_id_27,
            28 => self.slot_def_id_28, 29 => self.slot_def_id_29,
            30 => self.slot_def_id_30, 31 => self.slot_def_id_31,
            32 => self.slot_def_id_32, 33 => self.slot_def_id_33,
            34 => self.slot_def_id_34,
            _ => None,
        }
    }

    fn set_slot(&mut self, slot_index: u8, instance_id: Option<u64>, def_id: Option<u64>) {
        if slot_index >= NUM_CORPSE_SLOTS as u8 { return; }
        match slot_index {
            0 => { self.slot_instance_id_0 = instance_id; self.slot_def_id_0 = def_id; },
            1 => { self.slot_instance_id_1 = instance_id; self.slot_def_id_1 = def_id; },
            2 => { self.slot_instance_id_2 = instance_id; self.slot_def_id_2 = def_id; },
            3 => { self.slot_instance_id_3 = instance_id; self.slot_def_id_3 = def_id; },
            4 => { self.slot_instance_id_4 = instance_id; self.slot_def_id_4 = def_id; },
            5 => { self.slot_instance_id_5 = instance_id; self.slot_def_id_5 = def_id; },
            6 => { self.slot_instance_id_6 = instance_id; self.slot_def_id_6 = def_id; },
            7 => { self.slot_instance_id_7 = instance_id; self.slot_def_id_7 = def_id; },
            8 => { self.slot_instance_id_8 = instance_id; self.slot_def_id_8 = def_id; },
            9 => { self.slot_instance_id_9 = instance_id; self.slot_def_id_9 = def_id; },
            10 => { self.slot_instance_id_10 = instance_id; self.slot_def_id_10 = def_id; },
            11 => { self.slot_instance_id_11 = instance_id; self.slot_def_id_11 = def_id; },
            12 => { self.slot_instance_id_12 = instance_id; self.slot_def_id_12 = def_id; },
            13 => { self.slot_instance_id_13 = instance_id; self.slot_def_id_13 = def_id; },
            14 => { self.slot_instance_id_14 = instance_id; self.slot_def_id_14 = def_id; },
            15 => { self.slot_instance_id_15 = instance_id; self.slot_def_id_15 = def_id; },
            16 => { self.slot_instance_id_16 = instance_id; self.slot_def_id_16 = def_id; },
            17 => { self.slot_instance_id_17 = instance_id; self.slot_def_id_17 = def_id; },
            18 => { self.slot_instance_id_18 = instance_id; self.slot_def_id_18 = def_id; },
            19 => { self.slot_instance_id_19 = instance_id; self.slot_def_id_19 = def_id; },
            20 => { self.slot_instance_id_20 = instance_id; self.slot_def_id_20 = def_id; },
            21 => { self.slot_instance_id_21 = instance_id; self.slot_def_id_21 = def_id; },
            22 => { self.slot_instance_id_22 = instance_id; self.slot_def_id_22 = def_id; },
            23 => { self.slot_instance_id_23 = instance_id; self.slot_def_id_23 = def_id; },
            24 => { self.slot_instance_id_24 = instance_id; self.slot_def_id_24 = def_id; },
            25 => { self.slot_instance_id_25 = instance_id; self.slot_def_id_25 = def_id; },
            26 => { self.slot_instance_id_26 = instance_id; self.slot_def_id_26 = def_id; },
            27 => { self.slot_instance_id_27 = instance_id; self.slot_def_id_27 = def_id; },
            28 => { self.slot_instance_id_28 = instance_id; self.slot_def_id_28 = def_id; },
            29 => { self.slot_instance_id_29 = instance_id; self.slot_def_id_29 = def_id; },
            30 => { self.slot_instance_id_30 = instance_id; self.slot_def_id_30 = def_id; },
            31 => { self.slot_instance_id_31 = instance_id; self.slot_def_id_31 = def_id; },
            32 => { self.slot_instance_id_32 = instance_id; self.slot_def_id_32 = def_id; },
            33 => { self.slot_instance_id_33 = instance_id; self.slot_def_id_33 = def_id; },
            34 => { self.slot_instance_id_34 = instance_id; self.slot_def_id_34 = def_id; },
            _ => {}, // Unreachable due to index check
        }
    }

    // --- ItemContainer Trait Extension for ItemLocation --- 
    fn get_container_type(&self) -> ContainerType {
        ContainerType::PlayerCorpse
    }

    fn get_container_id(&self) -> u64 {
        self.id as u64 // PlayerCorpse ID is u32, cast to u64
    }
}

/// --- Helper struct to implement the ContainerItemClearer trait for PlayerCorpse ---
pub struct PlayerCorpseClearer;

impl ContainerItemClearer for PlayerCorpseClearer {
    fn clear_item(ctx: &ReducerContext, item_instance_id: u64) -> bool {
        let mut corpses = ctx.db.player_corpse();
        let inventory_items = ctx.db.inventory_item();
        let mut corpse_updated = false;
        let mut corpse_to_update_opt: Option<PlayerCorpse> = None;

        for current_corpse_candidate in corpses.iter() {
            let mut temp_corpse = current_corpse_candidate.clone();
            let mut found_in_this_corpse = false;

            for i in 0..temp_corpse.num_slots() as u8 {
                if temp_corpse.get_slot_instance_id(i) == Some(item_instance_id) {
                    log::debug!("[PlayerCorpseClearer] Found item {} in corpse {} slot {}. Clearing slot.", item_instance_id, temp_corpse.id, i);
                    temp_corpse.set_slot(i, None, None);
                    found_in_this_corpse = true;
                    corpse_to_update_opt = Some(temp_corpse.clone());
                    break;
                }
            }

            if found_in_this_corpse {
                if let Some(mut item_to_update_location) = inventory_items.instance_id().find(item_instance_id) {
                    item_to_update_location.location = ItemLocation::Unknown;
                    inventory_items.instance_id().update(item_to_update_location);
                }
                corpse_updated = true;
                break;
            }
        }
        if let Some(corpse_to_commit) = corpse_to_update_opt {
            corpses.id().update(corpse_to_commit);
        }
        corpse_updated
    }
}

impl PlayerCorpse {
    /// Finds the first available (empty) slot index in the corpse.
    /// Returns None if all slots are occupied.
    pub fn find_first_empty_slot(&self) -> Option<u8> {
        for i in 0..self.num_slots() as u8 { 
            if self.get_slot_instance_id(i).is_none() { 
                return Some(i);
            }
        }
        None 
    }
}

/// Attempts to add an item to the player corpse inventory.
/// This function creates a new InventoryItem and tries to place it in the corpse.
/// Returns Ok(()) if successful, Err if the corpse is full or other error occurs.
pub fn try_add_item_to_corpse_inventory(
    ctx: &ReducerContext,
    corpse: &mut PlayerCorpse,
    item_def_id: u64,
    quantity: u32,
) -> Result<(), String> {
    let inventory_table = ctx.db.inventory_item();
    let item_def_table = ctx.db.item_definition();
    
    // Get item definition for validation
    let item_def = item_def_table.id().find(item_def_id)
        .ok_or_else(|| format!("Item definition {} not found", item_def_id))?;
    
    // Check if we can stack with existing items first
    if item_def.is_stackable {
        for slot_idx in 0..corpse.num_slots() as u8 {
            if let Some(existing_instance_id) = corpse.get_slot_instance_id(slot_idx) {
                if let Some(mut existing_item) = inventory_table.instance_id().find(existing_instance_id) {
                    if existing_item.item_def_id == item_def_id && existing_item.quantity < item_def.stack_size {
                        // Can stack here
                        let space_available = item_def.stack_size - existing_item.quantity;
                        let quantity_to_add = std::cmp::min(quantity, space_available);
                        existing_item.quantity += quantity_to_add;
                        inventory_table.instance_id().update(existing_item);
                        
                        log::info!("[CorpseAddItem] Stacked {} items (def {}) into corpse slot {}", 
                                 quantity_to_add, item_def_id, slot_idx);
                        
                        // If we couldn't fit everything, we'll need to continue with remaining quantity
                        if quantity_to_add < quantity {
                            return try_add_item_to_corpse_inventory(ctx, corpse, item_def_id, quantity - quantity_to_add);
                        } else {
                            return Ok(());
                        }
                    }
                }
            }
        }
    }
    
    // Need to create a new item instance - find empty slot
    let empty_slot = corpse.find_first_empty_slot()
        .ok_or_else(|| "Corpse is full".to_string())?;
    
    // Create new inventory item
    let new_item = InventoryItem {
        instance_id: 0, // Auto-increment
        item_def_id,
        quantity,
        location: ItemLocation::Container(crate::models::ContainerLocationData {
            container_id: corpse.get_container_id(),
            container_type: corpse.get_container_type(),
            slot_index: empty_slot,
        }),
        item_data: None,
    };
    
    let inserted_item = inventory_table.insert(new_item);
    
    // Update corpse slot
    corpse.set_slot(empty_slot, Some(inserted_item.instance_id), Some(item_def_id));
    
    log::info!("[CorpseAddItem] Added {} items (def {}) to corpse slot {} as new instance {}", 
             quantity, item_def_id, empty_slot, inserted_item.instance_id);
    
    Ok(())
}

/******************************************************************************
 *                         DESPAWN SCHEDULING                             *
 ******************************************************************************/

#[spacetimedb::table(name = player_corpse_despawn_schedule, public, scheduled(process_corpse_despawn))]
#[derive(Clone)]
pub struct PlayerCorpseDespawnSchedule {
    #[primary_key]
    pub corpse_id: u64,
    pub scheduled_at: ScheduleAt, 
}

/// --- Corpse Despawn (Scheduled) ---
/// Scheduled reducer to despawn a player corpse after a certain time.
#[spacetimedb::reducer(name = "process_corpse_despawn")]
pub fn process_corpse_despawn(ctx: &ReducerContext, args: PlayerCorpseDespawnSchedule) -> Result<(), String> {
    if ctx.sender != ctx.identity() {
        return Err("process_corpse_despawn can only be called by the scheduler".to_string());
    }

    let corpse_id_to_despawn = args.corpse_id;
    log::info!("[CorpseDespawn:{}] Processing despawn schedule.", corpse_id_to_despawn);

    let inventory_table = ctx.db.inventory_item();
    let player_corpse_table = ctx.db.player_corpse();
    
    let corpse_to_despawn = match player_corpse_table.id().find(corpse_id_to_despawn as u32) {
        Some(corpse) => corpse,
        None => {
            log::warn!("[CorpseDespawn:{}] Corpse not found. Already despawned or error?", corpse_id_to_despawn);
            // If not found, assume it's already been handled. Stop processing.
            return Ok(()); 
        }
    };

    // Delete items within the corpse
    let mut items_deleted_count = 0;
    for i in 0..corpse_to_despawn.num_slots() as u8 {
        if let Some(item_instance_id) = corpse_to_despawn.get_slot_instance_id(i) {
            // Update item location to Unknown before deleting, for consistency
            if let Some(mut item) = inventory_table.instance_id().find(item_instance_id) {
                item.location = ItemLocation::Unknown;
                inventory_table.instance_id().update(item);
            }
            inventory_table.instance_id().delete(item_instance_id);
            items_deleted_count += 1;
            log::trace!("[CorpseDespawn:{}] Deleted item {} from corpse slot {}.", corpse_id_to_despawn, item_instance_id, i);
        }
    }
    log::info!("[CorpseDespawn:{}] Deleted {} items from corpse.", corpse_id_to_despawn, items_deleted_count);

    // Delete the corpse entry itself
    // The schedule entry is automatically removed by SpacetimeDB when the scheduled reducer runs.
    // No need to manually delete from PlayerCorpseDespawnSchedule table here.
    player_corpse_table.id().delete(corpse_id_to_despawn as u32); // Cast u64 to u32 for delete
    log::info!("[CorpseDespawn:{}] Corpse and its items ({} count) deleted.", corpse_id_to_despawn, items_deleted_count);

    Ok(())
}

/******************************************************************************
 *                          INTERACTION REDUCERS                            *
 ******************************************************************************/

/// Helper to validate player distance and fetch corpse/player entities.
fn validate_corpse_interaction(
    ctx: &ReducerContext,
    corpse_id: u32,
) -> Result<(Player, PlayerCorpse), String> { 
    let player = ctx.db.player().identity().find(&ctx.sender)
        .ok_or_else(|| "Player not found".to_string())?;
    let corpse = ctx.db.player_corpse().id().find(corpse_id)
        .ok_or_else(|| "Corpse not found".to_string())?;

    // Validate distance (optional, client might do this, but good for server-side check too)
    let dist_sq = (player.position_x - corpse.pos_x).powi(2) + (player.position_y - corpse.pos_y).powi(2);
    if dist_sq > PLAYER_CORPSE_INTERACTION_DISTANCE_SQUARED {
        return Err("Too far away from corpse".to_string());
    }
    Ok((player, corpse))
}

/// --- Move Item FROM Corpse --- 
/// Moves an item FROM a corpse slot INTO the player's inventory/hotbar.
#[spacetimedb::reducer]
pub fn move_item_from_corpse(
    ctx: &ReducerContext, 
    corpse_id: u32, 
    source_slot_index: u8,
    target_slot_type: String, // "inventory" or "hotbar"
    target_slot_index: u32
) -> Result<(), String> {
    let (_, mut corpse) = validate_corpse_interaction(ctx, corpse_id)?;
    inventory_management::handle_move_from_container_slot(ctx, &mut corpse, source_slot_index, target_slot_type, target_slot_index)?;
    ctx.db.player_corpse().id().update(corpse);
    Ok(())
}

/// --- Split Stack From Corpse ---
/// Splits a stack from a corpse slot into the player's inventory/hotbar.
#[spacetimedb::reducer]
pub fn split_stack_from_corpse(
    ctx: &ReducerContext,
    corpse_id: u32,
    source_slot_index: u8,
    quantity_to_split: u32,
    target_slot_type: String, 
    target_slot_index: u32,   
) -> Result<(), String> {
    let (_, mut corpse) = validate_corpse_interaction(ctx, corpse_id)?;
    inventory_management::handle_split_from_container(ctx, &mut corpse, source_slot_index, quantity_to_split, target_slot_type, target_slot_index)?;
    ctx.db.player_corpse().id().update(corpse);
    Ok(())
}

/// --- Quick Move From Corpse ---
/// Quickly moves an item FROM a corpse slot TO the player inventory.
#[spacetimedb::reducer]
pub fn quick_move_from_corpse(
    ctx: &ReducerContext, 
    corpse_id: u32, 
    source_slot_index: u8
) -> Result<(), String> {
    let (_, mut corpse) = validate_corpse_interaction(ctx, corpse_id)?;
    inventory_management::handle_quick_move_from_container(ctx, &mut corpse, source_slot_index)?;
    ctx.db.player_corpse().id().update(corpse);
    Ok(())
}

/// --- Move Item Within Corpse --- 
/// Moves an item BETWEEN two slots within the same corpse.
#[spacetimedb::reducer]
pub fn move_item_within_corpse(
    ctx: &ReducerContext,
    corpse_id: u32,
    source_slot_index: u8,
    target_slot_index: u8,
) -> Result<(), String> {
    let (_, mut corpse) = validate_corpse_interaction(ctx, corpse_id)?;
    inventory_management::handle_move_within_container(ctx, &mut corpse, source_slot_index, target_slot_index)?;
    ctx.db.player_corpse().id().update(corpse);
    Ok(())
}

/// --- Split Stack Within Corpse ---
/// Splits a stack FROM one corpse slot TO another within the same corpse.
#[spacetimedb::reducer]
pub fn split_stack_within_corpse(
    ctx: &ReducerContext,
    corpse_id: u32,
    source_slot_index: u8,
    target_slot_index: u8,
    quantity_to_split: u32,
) -> Result<(), String> {
    let (_, mut corpse) = validate_corpse_interaction(ctx, corpse_id)?;
    inventory_management::handle_split_within_container(ctx, &mut corpse, source_slot_index, target_slot_index, quantity_to_split)?;
    ctx.db.player_corpse().id().update(corpse);
    Ok(())
}

// --- Move Item TO Corpse ---
/// Moves an item from the player's inventory/hotbar INTO a specified slot in the corpse.
#[spacetimedb::reducer]
pub fn move_item_to_corpse(
    ctx: &ReducerContext,
    corpse_id: u32,
    target_slot_index: u8,
    item_instance_id: u64,
) -> Result<(), String> {
    let (_, mut corpse) = validate_corpse_interaction(ctx, corpse_id)?;
    inventory_management::handle_move_to_container_slot(ctx, &mut corpse, target_slot_index, item_instance_id)?;
    ctx.db.player_corpse().id().update(corpse);
    Ok(())
}

// --- Split Stack INTO Corpse ---
/// Splits a stack from player inventory/hotbar into a specific corpse slot.
#[spacetimedb::reducer]
pub fn split_stack_into_corpse(
    ctx: &ReducerContext,
    corpse_id: u32,
    target_slot_index: u8,
    source_item_instance_id: u64,
    quantity_to_split: u32,
) -> Result<(), String> {
    let (_, mut corpse) = validate_corpse_interaction(ctx, corpse_id)?;
    inventory_management::handle_split_into_container(ctx, &mut corpse, target_slot_index, source_item_instance_id, quantity_to_split)?;
    ctx.db.player_corpse().id().update(corpse);
    Ok(())
}

// --- Quick Move TO Corpse ---
/// Quickly moves an item from player inventory/hotbar TO the first available/mergeable slot in the corpse.
#[spacetimedb::reducer]
pub fn quick_move_to_corpse(
    ctx: &ReducerContext,
    corpse_id: u32,
    item_instance_id: u64,
) -> Result<(), String> {
    let (_, mut corpse) = validate_corpse_interaction(ctx, corpse_id)?;
    inventory_management::handle_quick_move_to_container(ctx, &mut corpse, item_instance_id)?;
    ctx.db.player_corpse().id().update(corpse);
    Ok(())
}

// --- NEW: Drop Item from Corpse Slot to World ---
#[spacetimedb::reducer]
pub fn drop_item_from_corpse_slot_to_world(
    ctx: &ReducerContext,
    corpse_id: u32,
    slot_index: u8,
) -> Result<(), String> {
    let sender_id = ctx.sender;
    let player_table = ctx.db.player(); // For fetching the player for drop location
    let mut corpse_table = ctx.db.player_corpse();

    log::info!("[DropFromCorpseToWorld] Player {} attempting to drop item from corpse ID {}, slot index {}.", sender_id, corpse_id, slot_index);

    // 1. Validate interaction and get corpse (also gets a player instance for validation)
    let (_player_for_validation, mut corpse) = validate_corpse_interaction(ctx, corpse_id)?;
    
    // 2. Get Player again for drop location calculation (ensure it's the sender)
    let player_for_drop_location = player_table.identity().find(sender_id)
        .ok_or_else(|| format!("Player {} not found for drop location.", sender_id))?;

    // 3. Call the generic handler from inventory_management
    crate::inventory_management::handle_drop_from_container_slot(ctx, &mut corpse, slot_index, &player_for_drop_location)?;

    // 4. Persist changes to the PlayerCorpse
    corpse_table.id().update(corpse);
    log::info!("[DropFromCorpseToWorld] Successfully dropped item from corpse {}, slot {}. Corpse updated.", corpse_id, slot_index);

    Ok(())
}

// --- NEW: Split and Drop Item from Corpse Slot to World ---
#[spacetimedb::reducer]
pub fn split_and_drop_item_from_corpse_slot_to_world(
    ctx: &ReducerContext,
    corpse_id: u32,
    slot_index: u8,
    quantity_to_split: u32,
) -> Result<(), String> {
    let sender_id = ctx.sender;
    let player_table = ctx.db.player(); // For fetching the player for drop location
    let mut corpse_table = ctx.db.player_corpse();

    log::info!("[SplitDropFromCorpseToWorld] Player {} attempting to split {} from corpse ID {}, slot {}.", 
             sender_id, quantity_to_split, corpse_id, slot_index);

    // 1. Validate interaction and get corpse
    let (_player_for_validation, mut corpse) = validate_corpse_interaction(ctx, corpse_id)?;

    // 2. Get Player again for drop location
    let player_for_drop_location = player_table.identity().find(sender_id)
        .ok_or_else(|| format!("Player {} not found for drop location.", sender_id))?;

    // 3. Call the generic handler from inventory_management
    crate::inventory_management::handle_split_and_drop_from_container_slot(ctx, &mut corpse, slot_index, quantity_to_split, &player_for_drop_location)?;

    // 4. Persist changes to the PlayerCorpse
    corpse_table.id().update(corpse);
    log::info!("[SplitDropFromCorpseToWorld] Successfully split and dropped from corpse {}, slot {}. Corpse updated.", corpse_id, slot_index);
    
    Ok(())
}

/// Creates a PlayerCorpse entity, transfers items from the dead player's inventory,
/// and schedules despawn.

// Placeholder for the missing function
fn transfer_inventory_to_corpse(ctx: &ReducerContext, dead_player: &Player) -> Result<u32, String> {
    let mut inventory_table = ctx.db.inventory_item();
    let mut player_corpse_table = ctx.db.player_corpse();
    let player_id = dead_player.identity;

    log::info!("[PlayerCorpse] Starting inventory transfer for player {}", player_id);

    // 1. Collect all items to be transferred from the player
    let mut items_to_transfer: Vec<InventoryItem> = Vec::new();
    for item in inventory_table.iter() {
        match &item.location {
            ItemLocation::Inventory(data) if data.owner_id == player_id => {
                items_to_transfer.push(item.clone());
            }
            ItemLocation::Hotbar(data) if data.owner_id == player_id => {
                items_to_transfer.push(item.clone());
            }
            ItemLocation::Equipped(data) if data.owner_id == player_id => {
                items_to_transfer.push(item.clone());
            }
            _ => {} // Item is elsewhere or belongs to someone else
        }
    }

    if items_to_transfer.is_empty() {
        log::info!("[PlayerCorpse] Player {} had no items to transfer.", player_id);
        // Create an empty corpse if desired, or return early if no items means no corpse
        // For now, let's create an empty corpse.
    }

    // 2. Create a new PlayerCorpse instance
    let mut new_corpse = PlayerCorpse {
        id: 0, // Will be auto-incremented
        player_identity: player_id,
        username: dead_player.username.clone(),
        pos_x: dead_player.position_x,
        pos_y: dead_player.position_y,
        chunk_index: calculate_chunk_index(dead_player.position_x, dead_player.position_y),
        death_time: ctx.timestamp,
        despawn_scheduled_at: ctx.timestamp + Duration::from_secs(DEFAULT_CORPSE_DESPAWN_SECONDS), // This will be set in create_corpse_for_player
        health: PLAYER_CORPSE_INITIAL_HEALTH, // Initialize health
        max_health: PLAYER_CORPSE_INITIAL_HEALTH, // Initialize max_health
        last_hit_time: None, // Initialize last_hit_time
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
        slot_instance_id_18: None, slot_def_id_18: None,
        slot_instance_id_19: None, slot_def_id_19: None,
        slot_instance_id_20: None, slot_def_id_20: None,
        slot_instance_id_21: None, slot_def_id_21: None,
        slot_instance_id_22: None, slot_def_id_22: None,
        slot_instance_id_23: None, slot_def_id_23: None,
        slot_instance_id_24: None, slot_def_id_24: None,
        slot_instance_id_25: None, slot_def_id_25: None,
        slot_instance_id_26: None, slot_def_id_26: None,
        slot_instance_id_27: None, slot_def_id_27: None,
        slot_instance_id_28: None, slot_def_id_28: None,
        slot_instance_id_29: None, slot_def_id_29: None,
        slot_instance_id_30: None, slot_def_id_30: None,
        slot_instance_id_31: None, slot_def_id_31: None,
        slot_instance_id_32: None, slot_def_id_32: None,
        slot_instance_id_33: None, slot_def_id_33: None,
        slot_instance_id_34: None, slot_def_id_34: None,
    };

    // 3. Populate corpse slots and prepare items for location update
    let mut updated_item_locations: Vec<(u64, ItemLocation)> = Vec::new();
    let mut corpse_slot_idx: u8 = 0;

    for item in items_to_transfer {
        if corpse_slot_idx < NUM_CORPSE_SLOTS as u8 {
            new_corpse.set_slot(corpse_slot_idx, Some(item.instance_id), Some(item.item_def_id));
            // The actual corpse ID isn\'t known yet, so we\'ll update location after insertion.
            // For now, we just note which slot it will go into.
            // The ItemLocation will be updated after the corpse is inserted.
            updated_item_locations.push((item.instance_id, ItemLocation::Container(ContainerLocationData {
                container_type: ContainerType::PlayerCorpse,
                container_id: 0, // Placeholder, will be updated
                slot_index: corpse_slot_idx,
            })));
            corpse_slot_idx += 1;
        } else {
            log::warn!("[PlayerCorpse] Corpse full for player {}. Item {} (Def: {}) could not be transferred and will be effectively lost (not dropped yet).",
                player_id, item.instance_id, item.item_def_id);
            // Future: Implement dropping excess items. For now, they are marked as Unknown.
            if let Some(mut excess_item) = inventory_table.instance_id().find(item.instance_id) {
                excess_item.location = ItemLocation::Unknown; // Mark as unknown/lost
                inventory_table.instance_id().update(excess_item);
            }
        }
    }

    // 4. Insert the PlayerCorpse into the table to get its ID
    let inserted_corpse = match player_corpse_table.try_insert(new_corpse.clone()) {
        Ok(c) => c,
        Err(e) => {
            log::error!("[PlayerCorpse] Failed to insert corpse for player {}: {:?}", player_id, e);
            return Err(format!("Failed to insert corpse: {:?}", e));
        }
    };
    log::info!("[PlayerCorpse] Inserted corpse with ID {} for player {}", inserted_corpse.id, player_id);

    // 5. Update ItemLocation for all transferred items with the actual corpse ID
    for (item_instance_id, mut target_location) in updated_item_locations {
        if let Some(mut item_to_update) = inventory_table.instance_id().find(item_instance_id) {
            if let ItemLocation::Container(ref mut loc_data) = target_location {
                loc_data.container_id = inserted_corpse.id as u64; // Update with real corpse ID
            }
            item_to_update.location = target_location;
            inventory_table.instance_id().update(item_to_update);
            log::debug!("[PlayerCorpse] Updated location for item {} to corpse {} slot.", item_instance_id, inserted_corpse.id);
        } else {
            log::warn!("[PlayerCorpse] Item {} not found during final location update for corpse {}. This should not happen.", item_instance_id, inserted_corpse.id);
        }
    }
    
    log::info!("[PlayerCorpse] Successfully transferred {} items to corpse {} for player {}", corpse_slot_idx, inserted_corpse.id, player_id);
    Ok(inserted_corpse.id)
}

/// --- Main public function to create a corpse and transfer items ---
/// This is intended to be called when a player dies.
pub fn create_player_corpse(ctx: &ReducerContext, dead_player_id: Identity, death_x: f32, death_y: f32, dead_player_username: &str) -> Result<(), String> {
    // --- PRE-CREATION CHECK: Prevent duplicate corpses for the same death event ---
    let current_time = ctx.timestamp;
    for corpse in ctx.db.player_corpse().iter() {
        if corpse.player_identity == dead_player_id {
            let time_since_creation = current_time.to_micros_since_unix_epoch()
                .saturating_sub(corpse.death_time.to_micros_since_unix_epoch());
            
            // If a corpse was created in the last 2 seconds, assume it's a duplicate for the same death.
            if time_since_creation < 2_000_000 { // 2 seconds in microseconds
                log::warn!("[CorpseCreate] A recent corpse (ID {}) already exists for player {:?}. Aborting duplicate creation.", corpse.id, dead_player_id);
                return Ok(()); // Prevent creating a new corpse
            }
        }
    }
    // --- END PRE-CREATION CHECK ---

    log::info!(
        "Creating corpse for player {} ({:?}) at ({:.1}, {:.1}).",
        dead_player_username, dead_player_id, death_x, death_y
    );

    let player_table = ctx.db.player();
    let corpse_schedules = ctx.db.player_corpse_despawn_schedule();
    let item_defs_table = ctx.db.item_definition(); // <<< ADDED: Need item definitions

    // Clear player's active equipped item (tool/weapon in hand) first
    match crate::active_equipment::clear_active_item_reducer(ctx, dead_player_id) {
        Ok(_) => log::info!("[PlayerDeath] Active item cleared for player {}", dead_player_id),
        Err(e) => log::error!("[PlayerDeath] Failed to clear active item for player {}: {}", dead_player_id, e),
    }

    // Clear crafting queue and refund materials to corpse
    crate::crafting_queue::clear_player_crafting_queue_on_death(ctx, dead_player_id);

    // The transfer_inventory_to_corpse function should handle un-equipping armor and moving it.
    // So, explicit calls to clear_all_equipped_armor_from_player are likely redundant here.

    let new_corpse_id = match transfer_inventory_to_corpse(ctx, &player_table.identity().find(dead_player_id).ok_or_else(|| format!("Player {} not found", dead_player_id))?) {
        Ok(id) => id,
        Err(e) => return Err(e),
    };

    // --- 4. Schedule Despawn (Dynamically based on corpse contents) --- 
    let corpse_for_despawn_check = match ctx.db.player_corpse().id().find(new_corpse_id) {
        Some(c) => c,
        None => {
            log::error!("[CorpseCreate:{:?}] Critical error: Corpse {} not found immediately after creation for despawn scheduling.", dead_player_id, new_corpse_id);
            return Err(format!("Corpse {} not found after creation", new_corpse_id));
        }
    };

    let mut max_respawn_time_seconds: u64 = 0;
    let mut corpse_has_items_with_respawn_time = false;

    for i in 0..corpse_for_despawn_check.num_slots() as u8 {
        if let Some(item_def_id_in_corpse) = corpse_for_despawn_check.get_slot_def_id(i) {
            if let Some(item_def) = item_defs_table.id().find(item_def_id_in_corpse) {
                if let Some(respawn_time_u32) = item_def.respawn_time_seconds {
                    let respawn_time_u64 = respawn_time_u32 as u64; // Cast to u64
                    if respawn_time_u64 > max_respawn_time_seconds {
                        max_respawn_time_seconds = respawn_time_u64;
                    }
                    corpse_has_items_with_respawn_time = true;
                }
            }
        }
    }

    let despawn_duration_seconds = if corpse_has_items_with_respawn_time {
        log::info!("[CorpseCreate:{:?}] Corpse {} has items with respawn times. Max respawn time: {}s.", dead_player_id, new_corpse_id, max_respawn_time_seconds);
        max_respawn_time_seconds 
    } else {
        log::info!("[CorpseCreate:{:?}] Corpse {} is empty or items have no respawn time. Using default: {}s.", dead_player_id, new_corpse_id, DEFAULT_CORPSE_DESPAWN_SECONDS);
        DEFAULT_CORPSE_DESPAWN_SECONDS
    };

    let despawn_time = ctx.timestamp + Duration::from_secs(despawn_duration_seconds);
    log::debug!("[CorpseCreate:{:?}] Scheduling despawn for corpse {} at {:?}. Duration: {}s", dead_player_id, new_corpse_id, despawn_time, despawn_duration_seconds);
    
    // Update the corpse entity with the correct despawn_scheduled_at time
    if let Some(mut corpse_to_update) = ctx.db.player_corpse().id().find(new_corpse_id) {
        corpse_to_update.despawn_scheduled_at = despawn_time;
        ctx.db.player_corpse().id().update(corpse_to_update);
    } else {
        // This case should have been caught by corpse_for_despawn_check already
        log::error!("[CorpseCreate:{:?}] Failed to find corpse {} to update its despawn_scheduled_at time.", dead_player_id, new_corpse_id);
    }

    // Insert panics on failure, so if it doesn't panic, it succeeded.
    // The error from TryInsertError would be SpacetimeDB specific, not a string directly.
    // If a string error message is desired, try_insert should be used and mapped.
    // For now, assuming panic on error is acceptable for this insert.
    corpse_schedules.insert(PlayerCorpseDespawnSchedule {
        corpse_id: new_corpse_id as u64, // This should be u32 if PlayerCorpse.id is u32 - it is u64 in the table.
        scheduled_at: despawn_time.into(),
    });

    Ok(())
} 