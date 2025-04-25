/******************************************************************************
 *                                                                            *
 * Defines the corn plant resource system including spawning, collection,     *
 * and respawning mechanics. Corn is a basic food resource that can be        *
 * picked directly without tools, similar to mushrooms.                       *
 *                                                                            *
 ******************************************************************************/

// SpacetimeDB imports
use spacetimedb::{Table, ReducerContext, Identity, Timestamp};
use log;
use rand::prelude::*;
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

// --- Corn Specifics ---

/// Visual/interaction radius of corn plants
const CORN_RADIUS: f32 = BASE_RESOURCE_RADIUS * 1.25; // Slightly bigger than mushrooms

// --- Spawning Constants ---
/// Target percentage of map tiles containing corn plants
pub const CORN_DENSITY_PERCENT: f32 = 0.001; // Reduced to 0.1% of tiles (very rare)
/// Minimum distance between corn plants to prevent clustering
pub const MIN_CORN_DISTANCE_SQ: f32 = 40.0 * 40.0; // Min distance between corn plants squared
/// Minimum distance from trees for better distribution
pub const MIN_CORN_TREE_DISTANCE_SQ: f32 = 20.0 * 20.0; // Min distance from trees squared
/// Minimum distance from stones for better distribution
pub const MIN_CORN_STONE_DISTANCE_SQ: f32 = 25.0 * 25.0; // Min distance from stones squared
/// Minimum respawn time for corn plants
pub const CORN_RESPAWN_TIME_SECS: u64 = 180; // 3 minutes (adjust as needed)

/// Represents a corn resource in the game world
#[spacetimedb::table(name = corn, public)]
#[derive(Clone, Debug)]
pub struct Corn {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub pos_x: f32,
    pub pos_y: f32,
    #[index(btree)]
    pub chunk_index: u32, // Added for spatial filtering/queries
    pub respawn_at: Option<Timestamp>,
}

// Implement RespawnableResource trait for Corn
impl RespawnableResource for Corn {
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

/// Handles player interactions with corn, adding corn to inventory
///
/// When a player interacts with corn, it is added to their
/// inventory and the corn resource is scheduled for respawn.
#[spacetimedb::reducer]
pub fn interact_with_corn(ctx: &ReducerContext, corn_id: u64) -> Result<(), String> {
    let player_id = ctx.sender;
    
    // Find the corn
    let corn = ctx.db.corn().id().find(corn_id)
        .ok_or_else(|| format!("Corn {} not found", corn_id))?;
    
    // Validate player can interact with this corn (distance check)
    let _player = validate_player_resource_interaction(ctx, player_id, corn.pos_x, corn.pos_y)?;

    // Add to inventory and schedule respawn
    collect_resource_and_schedule_respawn(
        ctx,
        player_id,
        "Corn", // Capitalize for item name
        corn.id,
        corn.pos_x,
        corn.pos_y,
        1, // Quantity to give
        |respawn_time| -> Result<(), String> {
            // This closure handles the corn-specific update logic
            if let Some(mut corn_to_update) = ctx.db.corn().id().find(corn.id) {
                corn_to_update.respawn_at = Some(respawn_time);
                ctx.db.corn().id().update(corn_to_update);
                Ok(())
            } else {
                Err("Failed to update corn respawn time".to_string())
            }
        }
    )?;

    log::info!("Player {} collected corn {}", player_id, corn_id);
    Ok(())
} 