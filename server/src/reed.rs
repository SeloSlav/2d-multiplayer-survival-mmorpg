/******************************************************************************
 *                                                                            *
 * Defines the reed stalk resource system including spawning, collection,     *
 * and respawning mechanics. Reeds are a material resource that can be        *
 * picked directly without tools, found along inland water sources.           *
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

// --- Reed Specifics ---

/// Visual/interaction radius of reed stalks
const REED_RADIUS: f32 = BASE_RESOURCE_RADIUS * 0.8; // Slightly smaller than mushrooms (reeds are thin)

// --- Spawning Constants ---
/// Target percentage of map tiles containing reed stalks
pub const REED_DENSITY_PERCENT: f32 = 0.003; // 0.3% - targets ~225 reed patches on 75k land tiles (increased from 0.12% due to restrictive spawn conditions)
/// Minimum distance between reed stalks to prevent clustering
pub const MIN_REED_DISTANCE_SQ: f32 = 25.0 * 25.0; // Min distance between reeds squared (smaller than corn - reeds can grow closer together)
/// Minimum distance from trees for better distribution
pub const MIN_REED_TREE_DISTANCE_SQ: f32 = 15.0 * 15.0; // Min distance from trees squared (reeds can be closer to trees than corn)
/// Minimum distance from stones for better distribution
pub const MIN_REED_STONE_DISTANCE_SQ: f32 = 20.0 * 20.0; // Min distance from stones squared

// Reed Respawn Time Constants - Faster than corn since they grow quickly near water
pub const MIN_REED_RESPAWN_TIME_SECS: u64 = 600; // 10 minutes
pub const MAX_REED_RESPAWN_TIME_SECS: u64 = 900; // 15 minutes

// --- Reed Yield Constants ---
const REED_PRIMARY_YIELD_ITEM_NAME: &str = "Common Reed Stalk";
const REED_PRIMARY_YIELD_MIN_AMOUNT: u32 = 2; // 2-4 reed stalks per patch
const REED_PRIMARY_YIELD_MAX_AMOUNT: u32 = 4;
const REED_SECONDARY_YIELD_ITEM_NAME: Option<&str> = Some("Plant Fiber"); // Fibrous material from reed leaves
const REED_SECONDARY_YIELD_MIN_AMOUNT: u32 = 1; // Small amount of fiber
const REED_SECONDARY_YIELD_MAX_AMOUNT: u32 = 3; // 1-3 plant fiber from leaves
const REED_SECONDARY_YIELD_CHANCE: f32 = 0.75; // 75% chance for fiber yield

/// Represents a reed resource in the game world
#[spacetimedb::table(name = reed, public)]
#[derive(Clone, Debug)]
pub struct Reed {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub pos_x: f32,
    pub pos_y: f32,
    #[index(btree)]
    pub chunk_index: u32, // Added for spatial filtering/queries
    pub respawn_at: Option<Timestamp>,
}

// Implement RespawnableResource trait for Reed
impl RespawnableResource for Reed {
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

/// Handles player interactions with reeds, adding reed stalks to inventory
///
/// When a player interacts with reeds, reed stalks are added to their
/// inventory and the reed resource is scheduled for respawn.
#[spacetimedb::reducer]
pub fn interact_with_reed(ctx: &ReducerContext, reed_id: u64) -> Result<(), String> {
    let player_id = ctx.sender;
    
    // Find the reed
    let reed = ctx.db.reed().id().find(reed_id)
        .ok_or_else(|| format!("Reed {} not found", reed_id))?;

    // Check if the reed is already harvested and waiting for respawn
    if reed.respawn_at.is_some() {
        return Err("This reed has already been harvested and is respawning.".to_string());
    }
    
    // Validate player can interact with this reed (distance check)
    let _player = validate_player_resource_interaction(ctx, player_id, reed.pos_x, reed.pos_y)?;

    // Calculate primary yield amount for Reed
    let primary_yield_amount = ctx.rng().gen_range(REED_PRIMARY_YIELD_MIN_AMOUNT..=REED_PRIMARY_YIELD_MAX_AMOUNT);

    // Add to inventory and schedule respawn
    collect_resource_and_schedule_respawn(
        ctx,
        player_id,
        REED_PRIMARY_YIELD_ITEM_NAME,
        primary_yield_amount,
        REED_SECONDARY_YIELD_ITEM_NAME,
        REED_SECONDARY_YIELD_MIN_AMOUNT,
        REED_SECONDARY_YIELD_MAX_AMOUNT,
        REED_SECONDARY_YIELD_CHANCE,
        &mut ctx.rng().clone(), // rng
        reed.id,                // _resource_id_for_log
        reed.pos_x,             // _resource_pos_x_for_log
        reed.pos_y,             // _resource_pos_y_for_log
        // update_resource_fn (closure)
        |respawn_time| -> Result<(), String> {
            if let Some(mut reed_to_update) = ctx.db.reed().id().find(reed.id) {
                reed_to_update.respawn_at = Some(respawn_time);
                ctx.db.reed().id().update(reed_to_update);
                Ok(())
            } else {
                Err(format!("Reed {} disappeared before respawn scheduling.", reed.id))
            }
        },
        MIN_REED_RESPAWN_TIME_SECS,     // min_respawn_secs
        MAX_REED_RESPAWN_TIME_SECS      // max_respawn_secs
    )?;

    // Try to grant seed drops after successful harvest
    crate::collectible_resources::try_grant_seed_drops(
        ctx,
        player_id,
        REED_PRIMARY_YIELD_ITEM_NAME,
        &mut ctx.rng().clone(),
    )?;

    // Log statement is now handled within collect_resource_and_schedule_respawn
    // log::info!("Player {} collected reed {}", player_id, reed_id);
    Ok(())
} 