/******************************************************************************
 *                                                                            *
 * Defines the pumpkin plant resource system including spawning, collection,     *
 * and respawning mechanics. Pumpkin is a basic food resource that can be        *
 * picked directly without tools, similar to mushrooms.                       *
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

// --- Pumpkin Specifics ---

/// Visual/interaction radius of pumpkin plants
const PUMPKIN_RADIUS: f32 = BASE_RESOURCE_RADIUS * 1.25; // Slightly bigger than mushrooms

// --- Spawning Constants ---
/// Target percentage of map tiles containing pumpkin plants
pub const PUMPKIN_DENSITY_PERCENT: f32 = 0.001; // Reduced to 0.1% of tiles (very rare)
/// Minimum distance between pumpkin plants to prevent clustering
pub const MIN_PUMPKIN_DISTANCE_SQ: f32 = 40.0 * 40.0; // Min distance between pumpkin plants squared
/// Minimum distance from trees for better distribution
pub const MIN_PUMPKIN_TREE_DISTANCE_SQ: f32 = 20.0 * 20.0; // Min distance from trees squared
/// Minimum distance from stones for better distribution
pub const MIN_PUMPKIN_STONE_DISTANCE_SQ: f32 = 25.0 * 25.0; // Min distance from stones squared

// NEW Respawn Time Constants for Pumpkins
pub const MIN_PUMPKIN_RESPAWN_TIME_SECS: u64 = 600; // 10 minutes
pub const MAX_PUMPKIN_RESPAWN_TIME_SECS: u64 = 1200; // 20 minutes

// --- Pumpkin Yield Constants ---
const PUMPKIN_PRIMARY_YIELD_ITEM_NAME: &str = "Pumpkin";
const PUMPKIN_PRIMARY_YIELD_AMOUNT: u32 = 1;
const PUMPKIN_SECONDARY_YIELD_ITEM_NAME: Option<&str> = Some("Plant Fiber");
const PUMPKIN_SECONDARY_YIELD_MIN_AMOUNT: u32 = 1;
const PUMPKIN_SECONDARY_YIELD_MAX_AMOUNT: u32 = 2;
const PUMPKIN_SECONDARY_YIELD_CHANCE: f32 = 0.50; // 50% chance

/// Represents a pumpkin resource in the game world
#[spacetimedb::table(name = pumpkin, public)]
#[derive(Clone, Debug)]
pub struct Pumpkin {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub pos_x: f32,
    pub pos_y: f32,
    #[index(btree)]
    pub chunk_index: u32, // Added for spatial filtering/queries
    pub respawn_at: Option<Timestamp>,
}

// Implement RespawnableResource trait for Pumpkin
impl RespawnableResource for Pumpkin {
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

/// Handles player interactions with pumpkin, adding pumpkin to inventory
///
/// When a player interacts with pumpkin, it is added to their
/// inventory and the pumpkin resource is scheduled for respawn.
#[spacetimedb::reducer]
pub fn interact_with_pumpkin(ctx: &ReducerContext, pumpkin_id: u64) -> Result<(), String> {
    let player_id = ctx.sender;
    
    // Find the pumpkin
    let pumpkin = ctx.db.pumpkin().id().find(pumpkin_id)
        .ok_or_else(|| format!("Pumpkin {} not found", pumpkin_id))?;

    // Check if the pumpkin is already harvested and waiting for respawn
    if pumpkin.respawn_at.is_some() {
        return Err("This pumpkin has already been harvested and is respawning.".to_string());
    }
    
    // Validate player can interact with this pumpkin (distance check)
    let _player = validate_player_resource_interaction(ctx, player_id, pumpkin.pos_x, pumpkin.pos_y)?;

    // Add to inventory and schedule respawn
    collect_resource_and_schedule_respawn(
        ctx,
        player_id,
        PUMPKIN_PRIMARY_YIELD_ITEM_NAME,
        PUMPKIN_PRIMARY_YIELD_AMOUNT,
        PUMPKIN_SECONDARY_YIELD_ITEM_NAME,
        PUMPKIN_SECONDARY_YIELD_MIN_AMOUNT,
        PUMPKIN_SECONDARY_YIELD_MAX_AMOUNT,
        PUMPKIN_SECONDARY_YIELD_CHANCE,
        &mut ctx.rng().clone(), // rng
        pumpkin.id,             // _resource_id_for_log
        pumpkin.pos_x,          // _resource_pos_x_for_log
        pumpkin.pos_y,          // _resource_pos_y_for_log
        // update_resource_fn (closure)
        |respawn_time| -> Result<(), String> {
            if let Some(mut pumpkin_to_update) = ctx.db.pumpkin().id().find(pumpkin.id) {
                pumpkin_to_update.respawn_at = Some(respawn_time);
                ctx.db.pumpkin().id().update(pumpkin_to_update);
                Ok(())
            } else {
                Err(format!("Pumpkin {} disappeared before respawn scheduling.", pumpkin.id))
            }
        },
        MIN_PUMPKIN_RESPAWN_TIME_SECS,  // min_respawn_secs
        MAX_PUMPKIN_RESPAWN_TIME_SECS   // max_respawn_secs
    )?;

    // Log statement is now handled within collect_resource_and_schedule_respawn
    // log::info!("Player {} collected pumpkin {}", player_id, pumpkin_id);
    Ok(())
} 