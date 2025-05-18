/******************************************************************************
 *                                                                            *
 * Defines the hemp plant resource system including spawning, collection,     *
 * and respawning mechanics. Hemp is a basic material resource that can be    *
 * picked directly without tools, yielding cloth.                             *
 *                                                                            *
 ******************************************************************************/

// SpacetimeDB imports
use spacetimedb::{Table, ReducerContext, Identity, Timestamp, log};
use rand::Rng; // CHANGED from rand::prelude::* to just Rng for consistency
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

// --- Hemp Specifics ---

/// Visual/interaction radius of hemp plants
const HEMP_RADIUS: f32 = BASE_RESOURCE_RADIUS * 1.1; // Slightly smaller than corn for variety

// --- Spawning Constants ---
/// Target percentage of map tiles containing hemp plants
pub const HEMP_DENSITY_PERCENT: f32 = 0.002; // Similar to mushrooms
/// Minimum distance between hemp plants to prevent clustering
pub const MIN_HEMP_DISTANCE_SQ: f32 = 35.0 * 35.0; 
/// Minimum distance from trees for better distribution
pub const MIN_HEMP_TREE_DISTANCE_SQ: f32 = 20.0 * 20.0;
/// Minimum distance from stones for better distribution
pub const MIN_HEMP_STONE_DISTANCE_SQ: f32 = 20.0 * 20.0; 

// NEW Respawn Time Constants for Hemp
pub const MIN_HEMP_RESPAWN_TIME_SECS: u64 = 300; // 5 minutes
pub const MAX_HEMP_RESPAWN_TIME_SECS: u64 = 600; // 10 minutes

// --- Hemp Yield Constants ---
const HEMP_PRIMARY_YIELD_ITEM_NAME: &str = "Plant Fiber"; // CHANGED from "Cloth"
const HEMP_PRIMARY_YIELD_MIN_AMOUNT: u32 = 20; // NEW
const HEMP_PRIMARY_YIELD_MAX_AMOUNT: u32 = 30; // NEW
// Secondary yield for Hemp (optional, can be None if primary is already fiber)
const HEMP_SECONDARY_YIELD_ITEM_NAME: Option<&str> = None; // No secondary Plant Fiber
const HEMP_SECONDARY_YIELD_MIN_AMOUNT: u32 = 0;
const HEMP_SECONDARY_YIELD_MAX_AMOUNT: u32 = 0;
const HEMP_SECONDARY_YIELD_CHANCE: f32 = 0.0;

/// Represents a hemp resource in the game world
#[spacetimedb::table(name = hemp, public)]
#[derive(Clone, Debug)]
pub struct Hemp {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub pos_x: f32,
    pub pos_y: f32,
    #[index(btree)]
    pub chunk_index: u32, 
    pub respawn_at: Option<Timestamp>,
}

// Implement RespawnableResource trait for Hemp
impl RespawnableResource for Hemp {
    fn id(&self) -> u64 { self.id }
    fn pos_x(&self) -> f32 { self.pos_x }
    fn pos_y(&self) -> f32 { self.pos_y }
    fn respawn_at(&self) -> Option<Timestamp> { self.respawn_at }
    fn set_respawn_at(&mut self, time: Option<Timestamp>) { self.respawn_at = time; }
}

/// Handles player interactions with hemp, adding cloth to inventory.
#[spacetimedb::reducer]
pub fn interact_with_hemp(ctx: &ReducerContext, hemp_id: u64) -> Result<(), String> {
    let sender_id = ctx.sender;
    
    // Find the hemp plant
    let hemp_plant = ctx.db.hemp().id().find(hemp_id)
        .ok_or_else(|| format!("Hemp plant {} not found", hemp_id))?;
    
    // Validate player can interact (distance check)
    let _player = validate_player_resource_interaction(ctx, sender_id, hemp_plant.pos_x(), hemp_plant.pos_y())?;

    // Check if the hemp is already harvested and waiting for respawn
    if hemp_plant.respawn_at.is_some() {
        return Err("This hemp plant has already been harvested and is respawning.".to_string());
    }

    // Calculate primary yield amount for Hemp
    let primary_yield_amount = ctx.rng().gen_range(HEMP_PRIMARY_YIELD_MIN_AMOUNT..=HEMP_PRIMARY_YIELD_MAX_AMOUNT);

    // Call the generic resource collection and respawn scheduling function
    collect_resource_and_schedule_respawn(
        ctx,
        sender_id,
        HEMP_PRIMARY_YIELD_ITEM_NAME,
        primary_yield_amount, 
        HEMP_SECONDARY_YIELD_ITEM_NAME,
        HEMP_SECONDARY_YIELD_MIN_AMOUNT,
        HEMP_SECONDARY_YIELD_MAX_AMOUNT,
        HEMP_SECONDARY_YIELD_CHANCE,
        &mut ctx.rng().clone(),
        hemp_id,
        hemp_plant.pos_x(),
        hemp_plant.pos_y(),
        |respawn_timestamp: Timestamp| -> Result<(), String> {
            if let Some(mut plant_to_update) = ctx.db.hemp().id().find(hemp_id) {
                plant_to_update.set_respawn_at(Some(respawn_timestamp));
                ctx.db.hemp().id().update(plant_to_update);
                Ok(())
            } else {
                Err(format!("Hemp plant {} disappeared before respawn scheduling.", hemp_id))
            }
        },
        MIN_HEMP_RESPAWN_TIME_SECS,
        MAX_HEMP_RESPAWN_TIME_SECS
    )?;

    // Log statement is now handled within collect_resource_and_schedule_respawn
    // log::info!("Player {:?} interacted with hemp plant {}", sender_id, hemp_id);
    Ok(())
} 