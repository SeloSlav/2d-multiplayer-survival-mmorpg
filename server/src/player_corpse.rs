/******************************************************************************
 *                                                                            *
 * Defines the PlayerCorpse entity, representing a lootable container dropped *
 * upon player death.                                                         *
 *                                                                            *
 ******************************************************************************/

use spacetimedb::{Identity, Timestamp, ReducerContext, SpacetimeType, Table};
use log;
use spacetimedb::spacetimedb_lib::ScheduleAt;

// Define constants for the corpse
pub(crate) const CORPSE_DESPAWN_DURATION_SECONDS: u64 = 300; // 5 minutes
pub(crate) const CORPSE_COLLISION_RADIUS: f32 = 18.0; // Similar to box/campfire
pub(crate) const CORPSE_COLLISION_Y_OFFSET: f32 = 10.0; // Similar to box/campfire
pub(crate) const PLAYER_CORPSE_COLLISION_DISTANCE_SQUARED: f32 = (super::PLAYER_RADIUS + CORPSE_COLLISION_RADIUS) * (super::PLAYER_RADIUS + CORPSE_COLLISION_RADIUS);
pub(crate) const PLAYER_CORPSE_INTERACTION_DISTANCE_SQUARED: f32 = 64.0 * 64.0; // Similar interaction range
pub(crate) const NUM_CORPSE_SLOTS: usize = 30; // 24 inv + 6 hotbar

// Import required items
use crate::environment::calculate_chunk_index;
use crate::inventory_management::{self, ItemContainer, ContainerItemClearer};
use crate::Player; // Import Player struct directly
use crate::items::inventory_item as InventoryItemTableTrait; // Import trait
use crate::player_corpse::player_corpse as PlayerCorpseTableTrait; // Self trait
use crate::player;

/// --- Player Corpse Data Structure ---
/// Represents a lootable backpack dropped when a player dies.
/// Contains the player's inventory at the time of death.
#[spacetimedb::table(name = player_corpse, public)]
#[derive(Clone)]
pub struct PlayerCorpse {
    #[primary_key]
    #[auto_inc]
    pub id: u32, // Unique identifier for this corpse instance

    pub original_player_identity: Identity,
    pub original_player_username: String, // For UI display

    pub pos_x: f32,
    pub pos_y: f32,
    pub chunk_index: u32, // For spatial queries

    pub created_at: Timestamp,
    pub despawn_at: Timestamp, // When this corpse should be removed

    // --- Inventory Slots (0-29) ---
    // Matches Player inventory (0-23) + hotbar (24-29)
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
    // Hotbar slots (mapped conceptually)
    pub slot_instance_id_24: Option<u64>, pub slot_def_id_24: Option<u64>, // Hotbar 0
    pub slot_instance_id_25: Option<u64>, pub slot_def_id_25: Option<u64>, // Hotbar 1
    pub slot_instance_id_26: Option<u64>, pub slot_def_id_26: Option<u64>, // Hotbar 2
    pub slot_instance_id_27: Option<u64>, pub slot_def_id_27: Option<u64>, // Hotbar 3
    pub slot_instance_id_28: Option<u64>, pub slot_def_id_28: Option<u64>, // Hotbar 4
    pub slot_instance_id_29: Option<u64>, pub slot_def_id_29: Option<u64>, // Hotbar 5
}

// TODO: Implement ItemContainer trait for PlayerCorpse
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
            _ => {}, // Unreachable due to index check
        }
    }
}

// <<< ADDED: Implementation block for PlayerCorpse specific methods >>>
impl PlayerCorpse {
    /// Finds the first available (empty) slot index in the corpse.
    /// Returns None if all slots are occupied.
    pub fn find_first_empty_slot(&self) -> Option<u8> {
        for i in 0..self.num_slots() as u8 { // Use ItemContainer::num_slots
            if self.get_slot_instance_id(i).is_none() { // Use ItemContainer::get_slot_instance_id
                return Some(i);
            }
        }
        None // No empty slot found
    }
}

// TODO: Implement ContainerItemClearer for PlayerCorpse? (May not be needed)

/******************************************************************************
 *                         DESPAWN SCHEDULING                             *
 ******************************************************************************/

#[spacetimedb::table(name = player_corpse_despawn_schedule, scheduled(process_corpse_despawn))]
#[derive(Clone)]
pub struct PlayerCorpseDespawnSchedule {
    #[primary_key]
    pub corpse_id: u64, // <<< FIX: Change to u64
    pub scheduled_at: ScheduleAt, // Should be a Timestamp
}

#[spacetimedb::reducer]
pub fn process_corpse_despawn(ctx: &ReducerContext, schedule: PlayerCorpseDespawnSchedule) -> Result<(), String> {
    log::info!("Processing despawn for corpse {}", schedule.corpse_id);

    // Get table handles
    let corpses = ctx.db.player_corpse();
    let inventory_items = ctx.db.inventory_item(); // Need this to delete items

    // 1. Find the PlayerCorpse by schedule.corpse_id
    // NOTE: Need to handle potential u64 vs u32 mismatch if corpse.id is still u32
    // Assuming corpse.id remains u32, we might need to iterate or add an index
    // For now, let's assume we can find it directly if PlayerCorpse.id becomes u64 later or handle appropriately.
    // Let's proceed assuming corpse_id in schedule matches PlayerCorpse.id type (which it now should if PlayerCorpse.id was u32)
    // **Correction**: Schedule PK needs to be u64, but it refers to PlayerCorpse.id which is u32.
    // We cannot directly use corpse_id as PK. Let's use an auto_inc u64 schedule ID and store corpse_id as data.
    // REVERTING the PK change for now and adding data field.
    // --- REVERTING --- 
    // #[primary_key]
    // pub corpse_id: u64, // <<< FIX: Change to u64
    // --- Let's redefine the schedule table --- 
    
    // **Redefinition Attempt:**
    // #[spacetimedb::table(name = player_corpse_despawn_schedule, scheduled(process_corpse_despawn))]
    // #[derive(Clone)]
    // pub struct PlayerCorpseDespawnSchedule {
    //     #[primary_key]
    //     #[auto_inc]
    //     pub schedule_entry_id: u64, // Auto-inc PK for schedule
    //     pub corpse_id_to_despawn: u32, // The actual corpse ID
    //     pub scheduled_at: ScheduleAt,
    // }
    // 
    // #[spacetimedb::reducer]
    // pub fn process_corpse_despawn(ctx: &ReducerContext, schedule: PlayerCorpseDespawnSchedule) -> Result<(), String> {
    //     log::info!("Processing despawn schedule entry {} for corpse {}", schedule.schedule_entry_id, schedule.corpse_id_to_despawn);
    //     let corpse_id = schedule.corpse_id_to_despawn;
    //     // ... rest of the logic using corpse_id ...
    // }
    // ---- END REDEFINITION ATTEMPT ----
    // Sticking with the original simpler definition for now, assuming potential future changes or that direct u32 PK might work.
    // If E0277 persists, we'll use the redefinition above.

    if let Some(corpse) = corpses.id().find(schedule.corpse_id as u32) { // Cast u64 schedule PK to u32 corpse ID
        log::debug!("Found corpse {} to despawn. Deleting contained items...", corpse.id);
        // 2. If found:
        //    a. Iterate through its slots using ItemContainer trait
        let mut deleted_item_count = 0;
        for i in 0..corpse.num_slots() as u8 {
            //    b. For each item instance ID found, delete the InventoryItem
            if let Some(item_instance_id) = corpse.get_slot_instance_id(i) {
                if inventory_items.instance_id().delete(item_instance_id) {
                    log::trace!("Deleted item instance {} from despawning corpse {}", item_instance_id, corpse.id);
                    deleted_item_count += 1;
                } else {
                    log::warn!("Could not find item instance {} (from corpse {} slot {}) in inventory table during despawn.", 
                             item_instance_id, corpse.id, i);
                }
            }
        }
        log::debug!("Deleted {} items from corpse {}. Deleting corpse entity...", deleted_item_count, corpse.id);

        //    c. Delete the PlayerCorpse itself
        corpses.id().delete(corpse.id);
        log::info!("Successfully despawned corpse {}.", corpse.id);

    } else {
        log::warn!("Could not find corpse {} to despawn. Schedule might be stale.", schedule.corpse_id);
    }

    // 3. Delete this schedule entry (already done implicitly by SpacetimeDB when a one-off scheduled reducer runs)
    Ok(())
}

/******************************************************************************
 *                          INTERACTION REDUCERS                            *
 ******************************************************************************/

/// --- Validate Corpse Interaction ---
/// Checks if the player is close enough to interact with the corpse.
/// Returns Ok((Player instance, PlayerCorpse instance)) on success.
fn validate_corpse_interaction(
    ctx: &ReducerContext,
    corpse_id: u32,
) -> Result<(Player, PlayerCorpse), String> { 
    let sender_id = ctx.sender;
    let players = ctx.db.player(); // <<< ADD: Needs Player trait import
    let corpses = ctx.db.player_corpse(); // Need PlayerCorpse table trait

    let player = players.identity().find(sender_id)
        .ok_or_else(|| "Player not found".to_string())?;
    let corpse = corpses.id().find(corpse_id)
        .ok_or_else(|| format!("Player corpse {} not found", corpse_id))?;

    // Check distance
    let dx = player.position_x - corpse.pos_x;
    let dy = player.position_y - corpse.pos_y;
    if (dx * dx + dy * dy) > PLAYER_CORPSE_INTERACTION_DISTANCE_SQUARED {
        return Err("Too far away from the corpse".to_string());
    }

    // Optional: Check if corpse has despawned?
    if ctx.timestamp >= corpse.despawn_at {
        return Err("Corpse has despawned".to_string());
    }

    Ok((player, corpse))
}

/// --- Move Item from Corpse --- 
/// Moves an item FROM a corpse slot INTO the player's inventory/hotbar.
#[spacetimedb::reducer]
pub fn move_item_from_corpse(
    ctx: &ReducerContext, 
    corpse_id: u32, 
    source_slot_index: u8,
    target_slot_type: String, // "inventory" or "hotbar"
    target_slot_index: u32
) -> Result<(), String> {
    let mut corpses = ctx.db.player_corpse();

    // --- Validations ---
    let (_player, mut corpse) = validate_corpse_interaction(ctx, corpse_id)?;

    // --- Call Generic Handler ---
    // This handler takes care of moving/merging the item to the player's specified slot
    // and clears the corpse slot if successful.
    inventory_management::handle_move_from_container_slot(
        ctx, 
        &mut corpse, 
        source_slot_index,
        target_slot_type, 
        target_slot_index
    )?;

    // --- Commit Corpse Update ---
    // The handler modified corpse (cleared the slot) if the move was successful.
    corpses.id().update(corpse);
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
    let mut corpses = ctx.db.player_corpse();

    // --- Validations ---
    let (_player, mut corpse) = validate_corpse_interaction(ctx, corpse_id)?;

    // --- Call Generic Handler ---
    inventory_management::handle_split_from_container(
        ctx, 
        &mut corpse, 
        source_slot_index, 
        quantity_to_split,
        target_slot_type, 
        target_slot_index
    )?;

    // --- Commit Corpse Update ---
    corpses.id().update(corpse);
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
    let mut corpses = ctx.db.player_corpse();

    // --- Basic Validations ---
    let (_player, mut corpse) = validate_corpse_interaction(ctx, corpse_id)?;

    // --- Call Handler ---
    inventory_management::handle_quick_move_from_container(
        ctx, 
        &mut corpse, 
        source_slot_index
    )?;

    // --- Commit Corpse Update ---
    corpses.id().update(corpse);
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
    let mut corpses = ctx.db.player_corpse();

    // --- Basic Validations ---
    let (_player, mut corpse) = validate_corpse_interaction(ctx, corpse_id)?;

    // --- Call Generic Handler ---
    inventory_management::handle_move_within_container(
        ctx, 
        &mut corpse, 
        source_slot_index, 
        target_slot_index
    )?;

    // --- Commit Corpse Update ---
    corpses.id().update(corpse);
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
    let mut corpses = ctx.db.player_corpse();

    // --- Validations ---
    let (_player, mut corpse) = validate_corpse_interaction(ctx, corpse_id)?;

    // --- Call Generic Handler ---
    inventory_management::handle_split_within_container(
        ctx,
        &mut corpse,
        source_slot_index,
        target_slot_index,
        quantity_to_split
    )?;

    // --- Commit Corpse Update ---
    corpses.id().update(corpse);
    Ok(())
}

// TODO: Implement despawn schedule table and reducer 