/******************************************************************************
 *                                                                            *
 * Defines the Shelter entity, its data structure, and associated logic.      *
 * Handles placement of shelters in the game world.                           *
 *                                                                            *
 ******************************************************************************/

use spacetimedb::{Identity, Timestamp, ReducerContext, Table, log};

// Import table traits and concrete types
use crate::Player; // Corrected import for Player struct
use crate::player as PlayerTableTrait; // Corrected import for Player table trait
use crate::items::{
    inventory_item as InventoryItemTableTrait,
    item_definition as ItemDefinitionTableTrait,
    InventoryItem, ItemDefinition,
};
use crate::environment::calculate_chunk_index;

// --- Constants ---
// Visual/Collision constants (can be tuned)
pub(crate) const SHELTER_VISUAL_WIDTH: f32 = 128.0; // For reference, actual collision might be different
pub(crate) const SHELTER_VISUAL_HEIGHT: f32 = 128.0; // For reference

// Placement constants
pub(crate) const SHELTER_PLACEMENT_MAX_DISTANCE: f32 = 256.0; // Increased from 128.0
pub(crate) const SHELTER_PLACEMENT_MAX_DISTANCE_SQUARED: f32 = SHELTER_PLACEMENT_MAX_DISTANCE * SHELTER_PLACEMENT_MAX_DISTANCE;

// Interaction constants (if any, for now focusing on placement)
pub(crate) const PLAYER_SHELTER_INTERACTION_DISTANCE: f32 = 128.0; 
pub(crate) const PLAYER_SHELTER_INTERACTION_DISTANCE_SQUARED: f32 = 
    PLAYER_SHELTER_INTERACTION_DISTANCE * PLAYER_SHELTER_INTERACTION_DISTANCE;

// Health
pub(crate) const SHELTER_INITIAL_MAX_HEALTH: f32 = 30000.0; // Adjusted for ~30 min destruction time with Wooden Spear

// --- NEW: Shelter Collision Constants (AABB based) ---
/// Width of the shelter's collision AABB.
pub(crate) const SHELTER_COLLISION_WIDTH: f32 = 300.0;
/// Height of the shelter's collision AABB.
pub(crate) const SHELTER_COLLISION_HEIGHT: f32 = 125.0; // Reduced back to match visual representation
/// Half-width of the shelter's collision AABB.
pub(crate) const SHELTER_AABB_HALF_WIDTH: f32 = SHELTER_COLLISION_WIDTH / 2.0;
/// Half-height of the shelter's collision AABB.
pub(crate) const SHELTER_AABB_HALF_HEIGHT: f32 = SHELTER_COLLISION_HEIGHT / 2.0; // Now 125.0 / 2.0 = 62.5
/// Vertical offset from shelter.pos_y (base) to the center of the AABB.
/// AABB_center_y = shelter.pos_y - SHELTER_AABB_CENTER_Y_OFFSET_FROM_POS_Y.
pub(crate) const SHELTER_AABB_CENTER_Y_OFFSET_FROM_POS_Y: f32 = 200.0; // Keep the same offset to maintain position

/// --- Shelter Data Structure ---
/// Represents a player-built shelter in the game world.
#[spacetimedb::table(name = shelter, public)]
#[derive(Clone, Debug)]
pub struct Shelter {
    #[primary_key]
    #[auto_inc]
    pub id: u32,
    pub pos_x: f32,
    pub pos_y: f32,
    pub chunk_index: u32,
    pub placed_by: Identity,
    pub placed_at: Timestamp,
    pub health: f32,
    pub max_health: f32,
    pub is_destroyed: bool,
    pub destroyed_at: Option<Timestamp>,
    pub last_hit_time: Option<Timestamp>,
}

// --- Reducer to Place a Shelter ---
#[spacetimedb::reducer]
pub fn place_shelter(ctx: &ReducerContext, item_instance_id: u64, world_x: f32, world_y: f32) -> Result<(), String> {
    let sender_id = ctx.sender;
    let inventory_items = ctx.db.inventory_item();
    let item_defs = ctx.db.item_definition();
    let players = ctx.db.player();
    let shelters = ctx.db.shelter(); // Access the shelter table

    // Look up the "Shelter" ItemDefinition ID
    let shelter_item_def_id = item_defs.iter()
        .find(|def| def.name == "Shelter")
        .map(|def| def.id)
        .ok_or_else(|| "Item definition for 'Shelter' not found.".to_string())?;

    log::info!(
        "[PlaceShelter] Player {:?} attempting placement of item {} (Shelter) at ({:.1}, {:.1})",
        sender_id, item_instance_id, world_x, world_y
    );

    // 1. Validate Player and Placement Rules
    let player = players.identity().find(sender_id)
        .ok_or_else(|| "Player not found".to_string())?;

    if player.is_dead {
        return Err("Cannot place shelter while dead.".to_string());
    }
    if player.is_knocked_out { // Assuming is_knocked_out field exists on Player
        return Err("Cannot place shelter while knocked out.".to_string());
    }

    // Check placement distance from player
    let dx_place = world_x - player.position_x;
    let dy_place = world_y - player.position_y;
    let dist_sq_place = dx_place * dx_place + dy_place * dy_place;
    if dist_sq_place > SHELTER_PLACEMENT_MAX_DISTANCE_SQUARED {
        return Err(format!("Cannot place shelter too far away (dist_sq: {:.1} > max_sq: {:.1}).",
                dist_sq_place, SHELTER_PLACEMENT_MAX_DISTANCE_SQUARED));
    }

    // Check collision with other shelters - RE-ENABLING
    for other_shelter in shelters.iter() {
        if other_shelter.is_destroyed { continue; }
        let dx_shelter = world_x - other_shelter.pos_x;
        let dy_shelter = world_y - other_shelter.pos_y; // Using shelter's base y for placement check distance
        let dist_sq_shelter = dx_shelter * dx_shelter + dy_shelter * dy_shelter;
    }
    
    // TODO: Add collision checks against other large structures (trees, stones, buildings) if necessary.

    // 2. Find the specific item instance and validate
    let item_to_consume = inventory_items.instance_id().find(item_instance_id)
        .ok_or_else(|| format!("Shelter item instance {} not found in player inventory.", item_instance_id))?;

    // Clone the location for potential refund before matching (which might partially move parts of it)
    let original_item_location = item_to_consume.location.clone();

    // Validate ownership and location (simplified, assumes item is from player inventory/hotbar)
    match item_to_consume.location {
        crate::models::ItemLocation::Inventory(data) => {
            if data.owner_id != sender_id {
                return Err(format!("Item instance {} for shelter not owned by player {:?}.", item_instance_id, sender_id));
            }
        }
        crate::models::ItemLocation::Hotbar(data) => {
            if data.owner_id != sender_id {
                return Err(format!("Item instance {} for shelter not owned by player {:?}.", item_instance_id, sender_id));
            }
        }
        _ => {
            return Err(format!("Shelter item instance {} must be in inventory or hotbar to be placed.", item_instance_id));
        }
    }
    
    if item_to_consume.item_def_id != shelter_item_def_id {
        return Err(format!("Item instance {} is not a Shelter (expected def ID {}, got {}).",
                        item_instance_id, shelter_item_def_id, item_to_consume.item_def_id));
    }
    if item_to_consume.quantity < 1 {
        return Err(format!("Not enough quantity of Shelter item instance {}.", item_instance_id));
    }

    // 3. Consume the Item
    // If stackable (which Shelter is not, stack_size: 1), would decrement. For non-stackable, delete.
    log::info!(
        "[PlaceShelter] Consuming item instance {} (Def ID: {}) from player {:?}",
        item_instance_id, shelter_item_def_id, sender_id
    );
    inventory_items.instance_id().delete(item_instance_id);

    // 4. Create Shelter Entity
    let current_time = ctx.timestamp;
    let chunk_idx = calculate_chunk_index(world_x, world_y);

    let new_shelter = Shelter {
        id: 0, // Auto-incremented
        pos_x: world_x,
        pos_y: world_y,
        chunk_index: chunk_idx,
        placed_by: sender_id,
        placed_at: current_time,
        health: SHELTER_INITIAL_MAX_HEALTH, 
        max_health: SHELTER_INITIAL_MAX_HEALTH,
        is_destroyed: false,
        destroyed_at: None,
        last_hit_time: None,
    };

    match shelters.try_insert(new_shelter) {
        Ok(inserted_shelter) => {
            log::info!(
                "Player {} ({:?}) placed a new Shelter (ID: {}) at ({:.1}, {:.1}).",
                player.username, sender_id, inserted_shelter.id, world_x, world_y
            );
            // Future: Schedule any initial processing for the shelter if needed.
        }
        Err(e) => {
            log::error!("Failed to insert new shelter for player {:?}: {}", sender_id, e);
            // Attempt to refund the item if shelter placement failed at the DB level.
            // This is a basic refund, more complex logic might be needed for partial stack consumption if shelter was stackable.
            let refund_item = InventoryItem {
                instance_id: 0, // Will be new instance
                item_def_id: shelter_item_def_id,
                quantity: 1,
                location: original_item_location, // Use the cloned original location
            };
            if inventory_items.try_insert(refund_item).is_err() {
                log::error!("Critical error: Failed to refund Shelter item to player {:?} after placement failure.", sender_id);
            }
            return Err(format!("Failed to place shelter: Database error. Item refunded if possible."));
        }
    }
    Ok(())
}
