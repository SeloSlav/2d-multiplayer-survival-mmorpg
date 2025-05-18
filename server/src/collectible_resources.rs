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
use rand::Rng;

// Resource respawn timing (shared by all collectible resources)
// REMOVED: pub use crate::combat::RESOURCE_RESPAWN_DURATION_SECS;

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
    primary_resource_name: &str,
    primary_quantity_to_grant: u32,
    secondary_item_name_to_grant: Option<&str>,
    secondary_yield_min: u32,
    secondary_yield_max: u32,
    secondary_yield_chance: f32,
    rng: &mut impl Rng,
    _resource_id_for_log: u64,
    _resource_pos_x_for_log: f32,
    _resource_pos_y_for_log: f32,
    update_resource_fn: F,
    // NEW PARAMETERS for variable respawn times
    min_respawn_secs: u64,
    max_respawn_secs: u64
) -> Result<(), String> 
where 
    F: FnOnce(Timestamp) -> Result<(), String>
{
    let item_defs = ctx.db.item_definition();

    // --- Handle Primary Resource --- 
    let primary_item_def = item_defs.iter()
        .find(|def| def.name == primary_resource_name)
        .ok_or_else(|| format!("Primary resource item definition '{}' not found", primary_resource_name))?;

    crate::items::add_item_to_player_inventory(ctx, player_id, primary_item_def.id, primary_quantity_to_grant)?;
    log::info!("Player {:?} collected {} of primary resource: {}.", player_id, primary_quantity_to_grant, primary_resource_name);

    // --- Handle Secondary Resource --- 
    if let Some(sec_item_name) = secondary_item_name_to_grant {
        if secondary_yield_max > 0 && secondary_yield_chance > 0.0 {
            if rng.gen::<f32>() < secondary_yield_chance {
                let secondary_amount_to_grant = if secondary_yield_min >= secondary_yield_max {
                    secondary_yield_min // If min >= max, grant min (or max, it's the same or misconfigured)
                } else {
                    rng.gen_range(secondary_yield_min..=secondary_yield_max)
                };

                if secondary_amount_to_grant > 0 {
                    let secondary_item_def = item_defs.iter()
                        .find(|def| def.name == sec_item_name)
                        .ok_or_else(|| format!("Secondary resource item definition '{}' not found", sec_item_name))?;
                    
                    match crate::items::add_item_to_player_inventory(ctx, player_id, secondary_item_def.id, secondary_amount_to_grant) {
                        Ok(_) => {
                            log::info!("Player {:?} also collected {} of secondary resource: {}.", player_id, secondary_amount_to_grant, sec_item_name);
                        }
                        Err(e) => {
                            log::error!("Failed to add secondary resource {} for player {:?}: {}", sec_item_name, player_id, e);
                            // Decide if this error should propagate or just be logged. For now, just log.
                        }
                    }
                }
            }
        } else if secondary_yield_chance > 0.0 && secondary_yield_max == 0 { // Chance to get 0 is pointless, log warning
            log::warn!("Secondary yield for '{}' has a chance ({}) but max yield is 0.", sec_item_name, secondary_yield_chance);
        }
    }

    // Calculate respawn time using new min/max parameters
    let actual_respawn_secs = if min_respawn_secs >= max_respawn_secs {
        min_respawn_secs // If min >= max, or if they are equal, use min
    } else {
        rng.gen_range(min_respawn_secs..=max_respawn_secs)
    };
    let respawn_time = ctx.timestamp + TimeDuration::from(Duration::from_secs(actual_respawn_secs));
    
    // Update the resource (delegate to resource-specific implementation)
    update_resource_fn(respawn_time)?;
    
    // Original log was more specific to the resource type via _resource_id_for_log.
    // Kept specific logs above for primary/secondary grants.
    // General log about scheduling respawn can remain or be adapted.
    log::info!("Interaction complete for resource (ID: {}), scheduling respawn for player {:?}.", 
        _resource_id_for_log, player_id);

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