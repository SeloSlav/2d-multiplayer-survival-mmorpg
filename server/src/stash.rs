/******************************************************************************
 *                                                                            *
 * Defines the Stash entity, its data structure, and associated logic.        *
 * Stashes are hidden containers that players can place and use to store      *
 * items securely.                                                            *
 *                                                                            *
 ******************************************************************************/

use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table};
use log;
use spacetimedb::Timestamp;

// --- Constants ---
pub(crate) const STASH_INTERACTION_DISTANCE_SQUARED: f32 = 48.0 * 48.0; // Closer interaction than a box
pub(crate) const STASH_SURFACE_INTERACTION_DISTANCE_SQUARED: f32 = 24.0 * 24.0; // Must be very close to surface
pub const NUM_STASH_SLOTS: usize = 6; // Stashes have fewer slots
// No collision constants as stashes are walkable

// --- Import Table Traits and Concrete Types ---
use crate::player as PlayerTableTrait;
use crate::Player;
use crate::items::{
    InventoryItem, ItemDefinition,
    inventory_item as InventoryItemTableTrait,
    item_definition as ItemDefinitionTableTrait,
    add_item_to_player_inventory, get_player_item
};
use crate::inventory_management::{self, ItemContainer, ContainerItemClearer};
use crate::stash::stash as StashTableTrait; // For ctx.db.stash()
use crate::environment::calculate_chunk_index;
use crate::models::{ContainerType, ItemLocation};


/// --- Stash Data Structure ---
/// Represents a hidden stash in the game world.
#[spacetimedb::table(name = stash, public)]
#[derive(Clone)]
pub struct Stash {
    #[primary_key]
    #[auto_inc]
    pub id: u32, // Unique identifier for this stash instance

    pub pos_x: f32,
    pub pos_y: f32,
    pub chunk_index: u32,

    pub placed_by: Identity, // Who placed this stash
    pub is_hidden: bool,     // Whether the stash is currently hidden
    pub last_surfaced_by: Option<Identity>, // Tracks who last made it visible

    // --- Inventory Slots (0-5 for NUM_STASH_SLOTS = 6) ---
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

    // --- Destruction Fields ---
    pub health: f32,
    pub max_health: f32,
    pub is_destroyed: bool,
    pub destroyed_at: Option<Timestamp>,
    pub last_hit_time: Option<Timestamp>,
}

/******************************************************************************
 *                            TRAIT IMPLEMENTATIONS                           *
 ******************************************************************************/

/// --- ItemContainer Implementation for Stash ---
impl ItemContainer for Stash {
    fn num_slots(&self) -> usize {
        NUM_STASH_SLOTS
    }

    fn get_slot_instance_id(&self, slot_index: u8) -> Option<u64> {
        match slot_index {
            0 => self.slot_instance_id_0,
            1 => self.slot_instance_id_1,
            2 => self.slot_instance_id_2,
            3 => self.slot_instance_id_3,
            4 => self.slot_instance_id_4,
            5 => self.slot_instance_id_5,
            _ => None,
        }
    }

    fn get_slot_def_id(&self, slot_index: u8) -> Option<u64> {
        match slot_index {
            0 => self.slot_def_id_0,
            1 => self.slot_def_id_1,
            2 => self.slot_def_id_2,
            3 => self.slot_def_id_3,
            4 => self.slot_def_id_4,
            5 => self.slot_def_id_5,
            _ => None,
        }
    }

    fn set_slot(&mut self, slot_index: u8, instance_id: Option<u64>, def_id: Option<u64>) {
        match slot_index {
            0 => { self.slot_instance_id_0 = instance_id; self.slot_def_id_0 = def_id; }
            1 => { self.slot_instance_id_1 = instance_id; self.slot_def_id_1 = def_id; }
            2 => { self.slot_instance_id_2 = instance_id; self.slot_def_id_2 = def_id; }
            3 => { self.slot_instance_id_3 = instance_id; self.slot_def_id_3 = def_id; }
            4 => { self.slot_instance_id_4 = instance_id; self.slot_def_id_4 = def_id; }
            5 => { self.slot_instance_id_5 = instance_id; self.slot_def_id_5 = def_id; }
            _ => { log::error!("[Stash] Attempted to set invalid slot index: {}", slot_index); }
        }
    }

    fn get_container_type(&self) -> crate::models::ContainerType {
        ContainerType::Stash
    }

    fn get_container_id(&self) -> u64 {
        self.id as u64
    }
}

/// --- Helper struct to implement the ContainerItemClearer trait for Stash ---
pub struct StashClearer;

impl ContainerItemClearer for StashClearer {
    fn clear_item(ctx: &ReducerContext, item_instance_id: u64) -> bool {
        let mut stashes = ctx.db.stash();
        let inventory_items = ctx.db.inventory_item();
        let mut stash_updated = false;
        let mut stash_to_update_opt: Option<Stash> = None;

        for current_stash_candidate in stashes.iter() {
            // Optimization: if stash is hidden, items within are practically inaccessible
            // for general clearing operations unless it's part of a specific "destroy stash" flow.
            // However, a general clear_item should probably check all, regardless of hidden status,
            // as it might be called during admin cleanup or other non-player-driven events.
            // For now, let's assume it can clear from hidden stashes too.

            let mut temp_stash = current_stash_candidate.clone();
            let mut found_in_this_stash = false;

            for i in 0..temp_stash.num_slots() as u8 {
                if temp_stash.get_slot_instance_id(i) == Some(item_instance_id) {
                    log::debug!("[StashClearer] Found item {} in stash {} slot {}. Clearing slot.", item_instance_id, temp_stash.id, i);
                    temp_stash.set_slot(i, None, None);
                    found_in_this_stash = true;
                    stash_to_update_opt = Some(temp_stash.clone());
                    break;
                }
            }

            if found_in_this_stash {
                if let Some(mut item_to_update_location) = inventory_items.instance_id().find(item_instance_id) {
                    item_to_update_location.location = ItemLocation::Unknown;
                    inventory_items.instance_id().update(item_to_update_location);
                }
                stash_updated = true;
                break;
            }
        }
        if let Some(stash_to_commit) = stash_to_update_opt {
            stashes.id().update(stash_to_commit);
        }
        stash_updated
    }
}

/******************************************************************************
 *                             HELPER FUNCTIONS                               *
 ******************************************************************************/

/// Validates basic stash interaction: stash existence and player proximity.
/// Does NOT check if the stash is hidden or ownership.
fn validate_basic_stash_interaction(
    ctx: &ReducerContext,
    stash_id: u32,
    distance_squared: f32,
) -> Result<(Player, Stash), String> {
    let sender_id = ctx.sender;
    let players = ctx.db.player();
    let stashes = ctx.db.stash();

    let player = players.identity().find(sender_id).ok_or_else(|| "Player not found".to_string())?;
    let stash = stashes.id().find(stash_id).ok_or_else(|| format!("Stash {} not found", stash_id))?;

    if stash.is_destroyed {
        return Err(format!("Stash {} is destroyed.", stash_id));
    }

    let dx = player.position_x - stash.pos_x;
    let dy = player.position_y - stash.pos_y;
    if (dx * dx + dy * dy) > distance_squared {
        return Err("Too far away".to_string());
    }
    Ok((player, stash))
}


/******************************************************************************
 *                         REDUCERS (Stash-Specific Logic)                    *
 ******************************************************************************/

#[spacetimedb::reducer]
pub fn place_stash(ctx: &ReducerContext, item_instance_id: u64, world_x: f32, world_y: f32) -> Result<(), String> {
    let sender_id = ctx.sender;
    let mut inventory_items = ctx.db.inventory_item();
    let item_defs = ctx.db.item_definition();
    let mut stashes = ctx.db.stash(); // Plural for table access

    log::info!("Player {:?} attempting to place stash (item instance {}) at ({}, {}).", sender_id, item_instance_id, world_x, world_y);

    // 1. Validate Player (Existence checked by get_player_item)
    // 2. Validate Item to be Placed
    let mut item_to_place = get_player_item(ctx, item_instance_id)?; // Validates ownership and player existence
    let item_def = item_defs.id().find(item_to_place.item_def_id)
        .ok_or_else(|| format!("Item definition {} not found for item instance {}.", item_to_place.item_def_id, item_instance_id))?;

    if item_def.name != "Stash" { // Assuming "Stash" is the ItemDefinition.name
        return Err("Item is not a Stash.".to_string());
    }
    match &item_to_place.location {
        ItemLocation::Inventory(_) | ItemLocation::Hotbar(_) => {
            // Ownership and possession by sender already checked by get_player_item.
        }
        _ => return Err("Stash must be in inventory or hotbar to be placed.".to_string()),
    }

    // 3. Validate Placement Location (No collision with other stashes, unlike boxes)
    // Stashes can overlap.

    // 4. Create the Stash entity
    let new_chunk_index = calculate_chunk_index(world_x, world_y);
    let new_stash = Stash {
        id: 0, // Auto-incremented
        pos_x: world_x,
        pos_y: world_y,
        chunk_index: new_chunk_index,
        placed_by: sender_id,
        is_hidden: false, // Explicitly set to not hidden on placement
        last_surfaced_by: Some(sender_id), // Player who placed it is the one who last surfaced it
        slot_instance_id_0: None,
        slot_def_id_0: None,
        slot_instance_id_1: None,
        slot_def_id_1: None,
        slot_instance_id_2: None,
        slot_def_id_2: None,
        slot_instance_id_3: None,
        slot_def_id_3: None,
        slot_instance_id_4: None,
        slot_def_id_4: None,
        slot_instance_id_5: None,
        slot_def_id_5: None,
        health: 125.0,
        max_health: 125.0,
        is_destroyed: false,
        destroyed_at: None,
        last_hit_time: None,
    };
    let inserted_stash = stashes.insert(new_stash);
    log::info!("Player {:?} placed new Stash with ID {}. Location: {:?}", sender_id, inserted_stash.id, item_to_place.location);

    // 5. Consume the item from player's inventory
    if item_to_place.quantity > 1 {
        item_to_place.quantity -= 1;
        inventory_items.instance_id().update(item_to_place);
    } else {
        // Update location to Unknown before deleting for safety
        item_to_place.location = ItemLocation::Unknown;
        inventory_items.instance_id().update(item_to_place.clone()); // Persist unknown location
        inventory_items.instance_id().delete(item_instance_id);
    }
    log::info!("Stash (item instance {}) consumed from player {:?} inventory after placement.", item_instance_id, sender_id);

    Ok(())
}

#[spacetimedb::reducer]
pub fn toggle_stash_visibility(ctx: &ReducerContext, stash_id: u32) -> Result<(), String> {
    let sender_id = ctx.sender;
    let mut stashes = ctx.db.stash();

    // Fetch stash first to check its current state
    let mut stash = stashes.id().find(stash_id)
        .ok_or_else(|| format!("Stash {} not found", stash_id))?;

    if stash.is_hidden {
        // Trying to SURFACE the stash
        // Ensure this uses the general, larger STASH_INTERACTION_DISTANCE_SQUARED
        let (_player, _stash_validated) = validate_basic_stash_interaction(ctx, stash_id, STASH_INTERACTION_DISTANCE_SQUARED) 
            .map_err(|e| format!("Cannot surface stash: {}", e))?;

        stash.is_hidden = false;
        stash.last_surfaced_by = Some(sender_id);
        stashes.id().update(stash.clone());
        log::info!("Player {} surfaced stash {}.", sender_id, stash_id);
    } else {
        // Trying to HIDE the stash
        // Only placed_by or last_surfaced_by can hide it
        if stash.placed_by != sender_id && stash.last_surfaced_by != Some(sender_id) {
            return Err("You cannot hide this stash.".to_string());
        }
        let (_player, _stash_validated) = validate_basic_stash_interaction(ctx, stash_id, STASH_INTERACTION_DISTANCE_SQUARED)
            .map_err(|e| format!("Cannot hide stash: {}", e))?; // Normal interaction distance

        stash.is_hidden = true;
        // last_surfaced_by remains who last surfaced it, or placer if never hidden then surfaced.
        stashes.id().update(stash.clone());
        log::info!("Player {} hid stash {}.", sender_id, stash_id);
    }
    Ok(())
}

// --- Item Interaction Reducers for Stash ---

/// Helper to validate stash interaction for item operations (not hidden, player close).
fn validate_stash_item_interaction(ctx: &ReducerContext, stash_id: u32) -> Result<(Player, Stash), String> {
    let (_player, stash) = validate_basic_stash_interaction(ctx, stash_id, STASH_INTERACTION_DISTANCE_SQUARED)?;
    if stash.is_hidden {
        return Err(format!("Stash {} is hidden.", stash_id));
    }
    Ok((_player, stash))
}

#[spacetimedb::reducer]
pub fn move_item_to_stash(ctx: &ReducerContext, stash_id: u32, target_slot_index: u8, item_instance_id: u64) -> Result<(), String> {
    let (_player, mut stash) = validate_stash_item_interaction(ctx, stash_id)?;
    inventory_management::handle_move_to_container_slot(ctx, &mut stash, target_slot_index, item_instance_id)?;
    ctx.db.stash().id().update(stash);
    Ok(())
}

#[spacetimedb::reducer]
pub fn move_item_from_stash(
    ctx: &ReducerContext,
    stash_id: u32,
    source_slot_index: u8,
    target_slot_type: String, // "inventory" or "hotbar"
    target_slot_index: u32
) -> Result<(), String> {
    let (_player, mut stash) = validate_stash_item_interaction(ctx, stash_id)?;
    inventory_management::handle_move_from_container_slot(ctx, &mut stash, source_slot_index, target_slot_type, target_slot_index)?;
    ctx.db.stash().id().update(stash);
    Ok(())
}

#[spacetimedb::reducer]
pub fn move_item_within_stash(
    ctx: &ReducerContext,
    stash_id: u32,
    source_slot_index: u8,
    target_slot_index: u8,
) -> Result<(), String> {
    let (_player, mut stash) = validate_stash_item_interaction(ctx, stash_id)?;
    inventory_management::handle_move_within_container(ctx, &mut stash, source_slot_index, target_slot_index)?;
    ctx.db.stash().id().update(stash);
    Ok(())
}

#[spacetimedb::reducer]
pub fn split_stack_into_stash(
    ctx: &ReducerContext,
    stash_id: u32,
    target_slot_index: u8,
    source_item_instance_id: u64,
    quantity_to_split: u32,
) -> Result<(), String> {
    let (_player, mut stash) = validate_stash_item_interaction(ctx, stash_id)?;
    inventory_management::handle_split_into_container(ctx, &mut stash, target_slot_index, source_item_instance_id, quantity_to_split)?;
    ctx.db.stash().id().update(stash);
    Ok(())
}

#[spacetimedb::reducer]
pub fn split_stack_from_stash(
    ctx: &ReducerContext,
    stash_id: u32,
    source_slot_index: u8,
    quantity_to_split: u32,
    target_slot_type: String,
    target_slot_index: u32,
) -> Result<(), String> {
    let (_player, mut stash) = validate_stash_item_interaction(ctx, stash_id)?;
    inventory_management::handle_split_from_container(ctx, &mut stash, source_slot_index, quantity_to_split, target_slot_type, target_slot_index)?;
    ctx.db.stash().id().update(stash);
    Ok(())
}

#[spacetimedb::reducer]
pub fn split_stack_within_stash(
    ctx: &ReducerContext,
    stash_id: u32,
    source_slot_index: u8,
    target_slot_index: u8,
    quantity_to_split: u32,
) -> Result<(), String> {
    let (_player, mut stash) = validate_stash_item_interaction(ctx, stash_id)?;
    inventory_management::handle_split_within_container(ctx, &mut stash, source_slot_index, target_slot_index, quantity_to_split)?;
    ctx.db.stash().id().update(stash);
    Ok(())
}

#[spacetimedb::reducer]
pub fn quick_move_to_stash(ctx: &ReducerContext, stash_id: u32, item_instance_id: u64) -> Result<(), String> {
    let (_player, mut stash) = validate_stash_item_interaction(ctx, stash_id)?;
    inventory_management::handle_quick_move_to_container(ctx, &mut stash, item_instance_id)?;
    ctx.db.stash().id().update(stash);
    Ok(())
}

#[spacetimedb::reducer]
pub fn quick_move_from_stash(ctx: &ReducerContext, stash_id: u32, source_slot_index: u8) -> Result<(), String> {
    let (_player, mut stash) = validate_stash_item_interaction(ctx, stash_id)?;
    inventory_management::handle_quick_move_from_container(ctx, &mut stash, source_slot_index)?;
    ctx.db.stash().id().update(stash);
    Ok(())
}

#[spacetimedb::reducer]
pub fn drop_item_from_stash_slot_to_world(
    ctx: &ReducerContext,
    stash_id: u32,
    slot_index: u8,
) -> Result<(), String> {
    let (player, mut stash) = validate_stash_item_interaction(ctx, stash_id)?;
    // Note: handle_drop_from_container_slot needs a &Player for drop location calculation.
    // The player instance from validate_stash_item_interaction is suitable here.
    inventory_management::handle_drop_from_container_slot(ctx, &mut stash, slot_index, &player)?;
    ctx.db.stash().id().update(stash);
    Ok(())
}

#[spacetimedb::reducer]
pub fn split_and_drop_item_from_stash_slot_to_world(
    ctx: &ReducerContext,
    stash_id: u32,
    slot_index: u8,
    quantity_to_split: u32,
) -> Result<(), String> {
    let (player, mut stash) = validate_stash_item_interaction(ctx, stash_id)?;
    // Similar to above, player instance is needed for drop location.
    inventory_management::handle_split_and_drop_from_container_slot(ctx, &mut stash, slot_index, quantity_to_split, &player)?;
    ctx.db.stash().id().update(stash);
    Ok(())
} 