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

// --- Corn Specifics ---

/// Visual/interaction radius of corn plants
const CORN_RADIUS: f32 = BASE_RESOURCE_RADIUS * 1.25; // Slightly bigger than mushrooms

// --- Spawning Constants ---
/// Target percentage of map tiles containing corn plants
pub const CORN_DENSITY_PERCENT: f32 = 0.0008; // 0.08% - targets ~60 corn plants on 75k land tiles
/// Minimum distance between corn plants to prevent clustering
pub const MIN_CORN_DISTANCE_SQ: f32 = 40.0 * 40.0; // Min distance between corn plants squared
/// Minimum distance from trees for better distribution
pub const MIN_CORN_TREE_DISTANCE_SQ: f32 = 20.0 * 20.0; // Min distance from trees squared
/// Minimum distance from stones for better distribution
pub const MIN_CORN_STONE_DISTANCE_SQ: f32 = 25.0 * 25.0; // Min distance from stones squared

// NEW Respawn Time Constants for Corn
pub const MIN_CORN_RESPAWN_TIME_SECS: u64 = 900; // 15 minutes (CHANGED from 10)
pub const MAX_CORN_RESPAWN_TIME_SECS: u64 = 1500; // 25 minutes (CHANGED from 20)

// --- Corn Yield Constants ---
const CORN_PRIMARY_YIELD_ITEM_NAME: &str = "Corn";
const CORN_PRIMARY_YIELD_MIN_AMOUNT: u32 = 1; // CHANGED: Min amount for range
const CORN_PRIMARY_YIELD_MAX_AMOUNT: u32 = 2; // CHANGED: Max amount for range
const CORN_SECONDARY_YIELD_ITEM_NAME: Option<&str> = Some("Plant Fiber"); // CHANGED: Added plant fiber from corn husks/stalks
const CORN_SECONDARY_YIELD_MIN_AMOUNT: u32 = 2; // CHANGED: Moderate amount from corn plants
const CORN_SECONDARY_YIELD_MAX_AMOUNT: u32 = 4; // CHANGED: 2-4 plant fiber from husks/stalks
const CORN_SECONDARY_YIELD_CHANCE: f32 = 0.90; // CHANGED: 90% chance for fiber yield

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

    // Check if the corn is already harvested and waiting for respawn
    if corn.respawn_at.is_some() {
        return Err("This corn has already been harvested and is respawning.".to_string());
    }
    
    // Validate player can interact with this corn (distance check)
    let _player = validate_player_resource_interaction(ctx, player_id, corn.pos_x, corn.pos_y)?;

    // Calculate primary yield amount for Corn
    let primary_yield_amount = ctx.rng().gen_range(CORN_PRIMARY_YIELD_MIN_AMOUNT..=CORN_PRIMARY_YIELD_MAX_AMOUNT);

    // Add to inventory and schedule respawn
    collect_resource_and_schedule_respawn(
        ctx,
        player_id,
        CORN_PRIMARY_YIELD_ITEM_NAME,
        primary_yield_amount, // CHANGED: Use calculated amount
        CORN_SECONDARY_YIELD_ITEM_NAME,
        CORN_SECONDARY_YIELD_MIN_AMOUNT,
        CORN_SECONDARY_YIELD_MAX_AMOUNT,
        CORN_SECONDARY_YIELD_CHANCE,
        &mut ctx.rng().clone(), // rng
        corn.id,                // _resource_id_for_log
        corn.pos_x,             // _resource_pos_x_for_log
        corn.pos_y,             // _resource_pos_y_for_log
        // update_resource_fn (closure)
        |respawn_time| -> Result<(), String> {
            if let Some(mut corn_to_update) = ctx.db.corn().id().find(corn.id) {
                corn_to_update.respawn_at = Some(respawn_time);
                ctx.db.corn().id().update(corn_to_update);
                Ok(())
            } else {
                Err(format!("Corn {} disappeared before respawn scheduling.", corn.id))
            }
        },
        MIN_CORN_RESPAWN_TIME_SECS,     // min_respawn_secs
        MAX_CORN_RESPAWN_TIME_SECS      // max_respawn_secs
    )?;

    // Try to grant seed drops after successful harvest
    crate::collectible_resources::try_grant_seed_drops(
        ctx,
        player_id,
        CORN_PRIMARY_YIELD_ITEM_NAME,
        &mut ctx.rng().clone(),
    )?;

    // Log statement is now handled within collect_resource_and_schedule_respawn
    // log::info!("Player {} collected corn {}", player_id, corn_id);
    Ok(())
} 