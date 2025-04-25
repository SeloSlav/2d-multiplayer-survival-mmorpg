/******************************************************************************
 *                                                                            *
 * Defines the base system for collectible resources in the game world.       *
 * This module provides common constants, helper functions, and types used    *
 * by specific resource implementations like mushrooms, corn, hemp, etc.      *
 * It establishes a consistent pattern for resource creation, interaction,    *
 * and respawning while allowing for resource-specific customizations.        *
 *                                                                            *
 ******************************************************************************/

// Standard library imports
use std::time::Duration;

// SpacetimeDB imports
use spacetimedb::{table, reducer, ReducerContext, Identity, Timestamp, Table, log, TimeDuration};

// Resource respawn timing (shared by all collectible resources)
pub use crate::combat::RESOURCE_RESPAWN_DURATION_SECS;

// Table trait imports for database access
use crate::items::{inventory_item as InventoryItemTableTrait, item_definition as ItemDefinitionTableTrait};
use crate::player as PlayerTableTrait;

// --- Shared Interaction Constants ---
/// Base interaction radius for collectible resources
pub const BASE_RESOURCE_RADIUS: f32 = 16.0;
/// Standard distance players can interact with collectibles
pub const PLAYER_RESOURCE_INTERACTION_DISTANCE: f32 = 64.0;
/// Squared interaction distance for faster distance checks
pub const PLAYER_RESOURCE_INTERACTION_DISTANCE_SQUARED: f32 = 
    PLAYER_RESOURCE_INTERACTION_DISTANCE * PLAYER_RESOURCE_INTERACTION_DISTANCE;

// --- Common Implementation Helper Functions ---

/// Validates if a player can interact with a resource at the given position
/// 
/// Performs distance check and ensures the player exists.
/// Returns the player if interaction is valid, error otherwise.
pub fn validate_player_resource_interaction(
    ctx: &ReducerContext,
    player_id: Identity,
    resource_pos_x: f32,
    resource_pos_y: f32
) -> Result<crate::Player, String> {
    let player = ctx.db.player().identity().find(player_id)
        .ok_or_else(|| "Player not found".to_string())?;

    // Distance check
    let dx = player.position_x - resource_pos_x;
    let dy = player.position_y - resource_pos_y;
    let dist_sq = dx * dx + dy * dy;

    if dist_sq > PLAYER_RESOURCE_INTERACTION_DISTANCE_SQUARED {
        return Err("Too far away to interact with this resource".to_string());
    }

    Ok(player)
}

/// Adds a resource item to player's inventory and schedules respawn
///
/// Generic function to handle the common pattern of:
/// 1. Adding item to player inventory
/// 2. Scheduling resource respawn
/// 3. Logging the interaction
pub fn collect_resource_and_schedule_respawn<F>(
    ctx: &ReducerContext,
    player_id: Identity,
    resource_name: &str,
    resource_id: u64,
    resource_pos_x: f32, 
    resource_pos_y: f32,
    quantity: u32,
    update_resource_fn: F
) -> Result<(), String> 
where 
    F: FnOnce(Timestamp) -> Result<(), String>
{
    // Find the item definition for this resource
    let item_defs = ctx.db.item_definition();
    let item_def = item_defs.iter()
        .find(|def| def.name == resource_name)
        .ok_or_else(|| format!("{} item definition not found", resource_name))?;

    // Add to player's inventory
    crate::items::add_item_to_player_inventory(ctx, player_id, item_def.id, quantity)?;

    // Calculate respawn time
    let respawn_time = ctx.timestamp + TimeDuration::from(Duration::from_secs(RESOURCE_RESPAWN_DURATION_SECS));
    
    // Update the resource (delegate to resource-specific implementation)
    update_resource_fn(respawn_time)?;
    
    log::info!("Player {:?} collected {} × {} (id: {}). Scheduling respawn.", 
        player_id, quantity, resource_name, resource_id);

    Ok(())
}

/// Common trait for resource tables that can respawn
///
/// Implemented by specific resource types like Mushroom, Corn, etc.
pub trait RespawnableResource {
    /// The unique ID of this resource
    fn id(&self) -> u64;
    
    /// X coordinate in the world
    fn pos_x(&self) -> f32;
    
    /// Y coordinate in the world
    fn pos_y(&self) -> f32;
    
    /// When this resource will respawn (if depleted)
    fn respawn_at(&self) -> Option<Timestamp>;
    
    /// Set a new respawn time for this resource
    fn set_respawn_at(&mut self, time: Option<Timestamp>);
} 