/******************************************************************************
 *                                                                            *
 * Defines the mushroom resource system including spawning, collection,       *
 * and respawning mechanics. Mushrooms are unique consumable resources that   *
 * can be picked up directly, without requiring tools, and provide food       *
 * items for the player. This module implements the generic collectible       *
 * resource system for mushroom-specific functionality.                       *
 *                                                                            *
 ******************************************************************************/

// SpacetimeDB imports
use spacetimedb::{Table, ReducerContext, Identity, Timestamp};
use rand::Rng;
use log;

// Module imports
use crate::collectible_resources::{
    BASE_RESOURCE_RADIUS, PLAYER_RESOURCE_INTERACTION_DISTANCE,
    PLAYER_RESOURCE_INTERACTION_DISTANCE_SQUARED,
    validate_player_resource_interaction,
    collect_resource_and_schedule_respawn,
    RespawnableResource
};

// Table trait imports for database access
use crate::items::{inventory_item as InventoryItemTableTrait, item_definition as ItemDefinitionTableTrait};
use crate::player as PlayerTableTrait;

// --- Mushroom Specifics ---

/// Visual/interaction radius of mushroom objects
const MUSHROOM_RADIUS: f32 = BASE_RESOURCE_RADIUS;

// --- Spawning Constants ---
/// Target percentage of map tiles containing mushrooms
pub(crate) const MUSHROOM_DENSITY_PERCENT: f32 = 0.0008; // Reduced from 0.0025 to 0.08% of map tiles for better game balance
/// Minimum distance between mushrooms to prevent clustering
pub(crate) const MIN_MUSHROOM_DISTANCE_PX: f32 = 60.0;
pub(crate) const MIN_MUSHROOM_DISTANCE_SQ: f32 = MIN_MUSHROOM_DISTANCE_PX * MIN_MUSHROOM_DISTANCE_PX;
/// Minimum distance from trees for better distribution
pub(crate) const MIN_MUSHROOM_TREE_DISTANCE_PX: f32 = 80.0;
pub(crate) const MIN_MUSHROOM_TREE_DISTANCE_SQ: f32 = MIN_MUSHROOM_TREE_DISTANCE_PX * MIN_MUSHROOM_TREE_DISTANCE_PX;
/// Minimum distance from stones for better distribution
pub(crate) const MIN_MUSHROOM_STONE_DISTANCE_PX: f32 = 80.0;
pub(crate) const MIN_MUSHROOM_STONE_DISTANCE_SQ: f32 = MIN_MUSHROOM_STONE_DISTANCE_PX * MIN_MUSHROOM_STONE_DISTANCE_PX;

// NEW Respawn Time Constants for Mushrooms
pub(crate) const MIN_MUSHROOM_RESPAWN_TIME_SECS: u64 = 300; // 5 minutes
pub(crate) const MAX_MUSHROOM_RESPAWN_TIME_SECS: u64 = 600; // 10 minutes
// OLD: pub const MUSHROOM_RESPAWN_TIME_SECS: u64 = 120; // 2 minutes (Example: if there was an old one)

// --- Mushroom Yield Constants ---
const MUSHROOM_PRIMARY_YIELD_ITEM_NAME: &str = "Mushroom";
const MUSHROOM_PRIMARY_YIELD_MIN_AMOUNT: u32 = 1;
const MUSHROOM_PRIMARY_YIELD_MAX_AMOUNT: u32 = 2;
const MUSHROOM_SECONDARY_YIELD_ITEM_NAME: Option<&str> = Some("Raw Fiber");
const MUSHROOM_SECONDARY_YIELD_MIN_AMOUNT: u32 = 1;
const MUSHROOM_SECONDARY_YIELD_MAX_AMOUNT: u32 = 2;
const MUSHROOM_SECONDARY_YIELD_CHANCE: f32 = 0.85;

/// Represents a mushroom resource in the game world
#[spacetimedb::table(name = mushroom, public)]
#[derive(Clone)]
pub struct Mushroom {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub pos_x: f32,
    pub pos_y: f32,
    #[index(btree)]
    pub chunk_index: u32, // Added for spatial filtering/queries
    pub respawn_at: Option<Timestamp>,
}

// Implement RespawnableResource trait for Mushroom
impl RespawnableResource for Mushroom {
    fn id(&self) -> u64 {
        self.id
    }
    
    fn pos_x(&self) -> f32 {
        self.pos_x
    }
    
    fn pos_y(&self) -> f32 {
        self.pos_y
    }
    
    fn respawn_at(&self) -> Option<Timestamp> {
        self.respawn_at
    }
    
    fn set_respawn_at(&mut self, time: Option<Timestamp>) {
        self.respawn_at = time;
    }
}

/// Handles player interactions with mushrooms, adding items to inventory
///
/// When a player interacts with a mushroom, this reducer checks distance,
/// adds the mushroom item to their inventory, and schedules respawn.
#[spacetimedb::reducer]
pub fn interact_with_mushroom(ctx: &ReducerContext, mushroom_id: u64) -> Result<(), String> {
    let sender_id = ctx.sender;
    let mushrooms = ctx.db.mushroom();

    // Find the mushroom
    let mushroom = mushrooms.id().find(mushroom_id)
        .ok_or_else(|| format!("Mushroom {} not found", mushroom_id))?;

    // Check if the mushroom is already harvested and waiting for respawn
    if mushroom.respawn_at.is_some() {
        return Err("This mushroom has already been harvested and is respawning.".to_string());
    }
    
    // Validate player can interact with this mushroom (distance check)
    let _player = validate_player_resource_interaction(ctx, sender_id, mushroom.pos_x, mushroom.pos_y)?;

    // Calculate primary yield amount for Mushrooms
    let primary_yield_amount = ctx.rng().gen_range(MUSHROOM_PRIMARY_YIELD_MIN_AMOUNT..=MUSHROOM_PRIMARY_YIELD_MAX_AMOUNT);

    // Use the generic collect_resource function
    collect_resource_and_schedule_respawn(
        ctx,
        sender_id,
        MUSHROOM_PRIMARY_YIELD_ITEM_NAME,
        primary_yield_amount,
        MUSHROOM_SECONDARY_YIELD_ITEM_NAME,
        MUSHROOM_SECONDARY_YIELD_MIN_AMOUNT,
        MUSHROOM_SECONDARY_YIELD_MAX_AMOUNT,
        MUSHROOM_SECONDARY_YIELD_CHANCE,
        &mut ctx.rng().clone(), // rng
        mushroom_id,            // _resource_id_for_log
        mushroom.pos_x,         // _resource_pos_x_for_log
        mushroom.pos_y,         // _resource_pos_y_for_log
        // update_resource_fn (closure)
        |respawn_time| -> Result<(), String> {
            if let Some(mut mushroom_to_update) = ctx.db.mushroom().id().find(mushroom_id) {
                mushroom_to_update.respawn_at = Some(respawn_time);
                ctx.db.mushroom().id().update(mushroom_to_update);
                Ok(())
            } else {
                Err(format!("Mushroom {} disappeared before respawn scheduling.", mushroom_id))
            }
        },
        MIN_MUSHROOM_RESPAWN_TIME_SECS, // min_respawn_secs
        MAX_MUSHROOM_RESPAWN_TIME_SECS  // max_respawn_secs
    )
} 