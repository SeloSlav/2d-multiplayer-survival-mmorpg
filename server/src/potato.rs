/******************************************************************************
 *                                                                            *
 * Defines the potato plant resource system including spawning, collection,   *
 * and respawning mechanics. Potato is a basic food resource that can be      *
 * picked directly without tools, similar to corn and mushrooms.              *
 *                                                                            *
 ******************************************************************************/

// SpacetimeDB imports
use spacetimedb::{Table, ReducerContext, Identity, Timestamp};
use log;
use rand::Rng;
use crate::TILE_SIZE_PX;

// Module imports
use crate::collectible_resources::{
    BASE_RESOURCE_RADIUS, PLAYER_RESOURCE_INTERACTION_DISTANCE_SQUARED,
    validate_player_resource_interaction,
    collect_resource_and_schedule_respawn,
    RespawnableResource
};

// Table trait imports for database access
use crate::items::{inventory_item as InventoryItemTableTrait, item_definition as ItemDefinitionTableTrait};
use crate::player as PlayerTableTrait;

// --- Potato Specifics ---

/// Visual/interaction radius of potato plants
const POTATO_RADIUS: f32 = BASE_RESOURCE_RADIUS * 1.15; // Slightly smaller than corn

// --- Spawning Constants ---
/// Target percentage of map tiles containing potato plants
pub const POTATO_DENSITY_PERCENT: f32 = 0.0005; // Reduced from 0.002 to 0.05% of tiles for better game balance
/// Minimum distance between potato plants to prevent clustering
pub const MIN_POTATO_DISTANCE_SQ: f32 = 35.0 * 35.0; // Min distance between potato plants squared
/// Minimum distance from trees for better distribution
pub const MIN_POTATO_TREE_DISTANCE_SQ: f32 = 18.0 * 18.0; // Min distance from trees squared
/// Minimum distance from stones for better distribution
pub const MIN_POTATO_STONE_DISTANCE_SQ: f32 = 22.0 * 22.0; // Min distance from stones squared

// Respawn Time Constants for Potato
pub const MIN_POTATO_RESPAWN_TIME_SECS: u64 = 480; // 8 minutes
pub const MAX_POTATO_RESPAWN_TIME_SECS: u64 = 960; // 16 minutes

// --- Potato Yield Constants ---
const POTATO_PRIMARY_YIELD_ITEM_NAME: &str = "Potato";
const POTATO_PRIMARY_YIELD_AMOUNT: u32 = 1;
const POTATO_SECONDARY_YIELD_ITEM_NAME: Option<&str> = Some("Plant Fiber");
const POTATO_SECONDARY_YIELD_MIN_AMOUNT: u32 = 1;
const POTATO_SECONDARY_YIELD_MAX_AMOUNT: u32 = 2;
const POTATO_SECONDARY_YIELD_CHANCE: f32 = 0.40; // 40% chance (slightly lower than corn)

/// Represents a potato resource in the game world
#[spacetimedb::table(name = potato, public)]
#[derive(Clone, Debug)]
pub struct Potato {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub pos_x: f32,
    pub pos_y: f32,
    #[index(btree)]
    pub chunk_index: u32, // Added for spatial filtering/queries
    pub respawn_at: Option<Timestamp>,
}

// Implement RespawnableResource trait for Potato
impl RespawnableResource for Potato {
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

/// Handles player interactions with potato, adding potato to inventory
///
/// When a player interacts with potato, it is added to their
/// inventory and the potato resource is scheduled for respawn.
#[spacetimedb::reducer]
pub fn interact_with_potato(ctx: &ReducerContext, potato_id: u64) -> Result<(), String> {
    let player_id = ctx.sender;
    
    // Find the potato
    let potato = ctx.db.potato().id().find(potato_id)
        .ok_or_else(|| format!("Potato {} not found", potato_id))?;

    // Check if the potato is already harvested and waiting for respawn
    if potato.respawn_at.is_some() {
        return Err("This potato has already been harvested and is respawning.".to_string());
    }
    
    // Validate player can interact with this potato (distance check)
    let _player = validate_player_resource_interaction(ctx, player_id, potato.pos_x, potato.pos_y)?;

    // Add to inventory and schedule respawn
    collect_resource_and_schedule_respawn(
        ctx,
        player_id,
        POTATO_PRIMARY_YIELD_ITEM_NAME,
        POTATO_PRIMARY_YIELD_AMOUNT,
        POTATO_SECONDARY_YIELD_ITEM_NAME,
        POTATO_SECONDARY_YIELD_MIN_AMOUNT,
        POTATO_SECONDARY_YIELD_MAX_AMOUNT,
        POTATO_SECONDARY_YIELD_CHANCE,
        &mut ctx.rng().clone(), // rng
        potato.id,                // _resource_id_for_log
        potato.pos_x,             // _resource_pos_x_for_log
        potato.pos_y,             // _resource_pos_y_for_log
        // update_resource_fn (closure)
        |respawn_time| -> Result<(), String> {
            if let Some(mut potato_to_update) = ctx.db.potato().id().find(potato.id) {
                potato_to_update.respawn_at = Some(respawn_time);
                ctx.db.potato().id().update(potato_to_update);
                Ok(())
            } else {
                Err(format!("Potato {} disappeared before respawn scheduling.", potato.id))
            }
        },
        MIN_POTATO_RESPAWN_TIME_SECS,     // min_respawn_secs
        MAX_POTATO_RESPAWN_TIME_SECS      // max_respawn_secs
    )?;

    // Log statement is now handled within collect_resource_and_schedule_respawn
    // log::info!("Player {} collected potato {}", player_id, potato_id);
    Ok(())
} 