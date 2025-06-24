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
/// Standard distance players can interact with collectibles (increased for easier food pickup)
pub const PLAYER_RESOURCE_INTERACTION_DISTANCE: f32 = 80.0;
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
/// 1. Adding item to player inventory (or dropping near player if inventory full)
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

    // Use our new system that automatically drops items if inventory is full
    match crate::dropped_item::try_give_item_to_player(ctx, player_id, primary_item_def.id, primary_quantity_to_grant) {
        Ok(added_to_inventory) => {
            if added_to_inventory {
                log::info!("Player {:?} collected {} of primary resource: {} (added to inventory).", player_id, primary_quantity_to_grant, primary_resource_name);
            } else {
                log::info!("Player {:?} collected {} of primary resource: {} (dropped near player - inventory full).", player_id, primary_quantity_to_grant, primary_resource_name);
            }
        }
        Err(e) => {
            return Err(format!("Failed to give primary resource {} to player: {}", primary_resource_name, e));
        }
    }

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
                    
                    // Use our new system that automatically drops items if inventory is full
                    match crate::dropped_item::try_give_item_to_player(ctx, player_id, secondary_item_def.id, secondary_amount_to_grant) {
                        Ok(added_to_inventory) => {
                            if added_to_inventory {
                                log::info!("Player {:?} also collected {} of secondary resource: {} (added to inventory).", player_id, secondary_amount_to_grant, sec_item_name);
                            } else {
                                log::info!("Player {:?} also collected {} of secondary resource: {} (dropped near player - inventory full).", player_id, secondary_amount_to_grant, sec_item_name);
                            }
                        }
                        Err(e) => {
                            log::error!("Failed to give secondary resource {} to player {:?}: {}", sec_item_name, player_id, e);
                            // Continue processing - secondary resource failure shouldn't stop primary resource collection
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
    
    // Emit harvest plant sound at resource position
    crate::sound_events::emit_harvest_plant_sound(ctx, _resource_pos_x_for_log, _resource_pos_y_for_log, player_id);
    
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

// --- Seed Drop System ---

/// Seed drop configuration for different resources
struct SeedDropConfig {
    seed_item_name: &'static str,
    drop_chance: f32, // 0.0 to 1.0
    min_seeds: u32,   // Minimum seeds to drop
    max_seeds: u32,   // Maximum seeds to drop
}

/// Mapping of harvestable resources to their corresponding seed drops
/// Updated for sustainable farming - each harvest should give back more seeds than planted
fn get_seed_drop_config(resource_name: &str) -> Option<SeedDropConfig> {
    match resource_name {
        "Potato" => Some(SeedDropConfig {
            seed_item_name: "Seed Potato",
            drop_chance: 0.85, // 85% chance (potatoes naturally multiply well)
            min_seeds: 2,      // 2-4 seeds per harvest
            max_seeds: 4,
        }),
        "Corn" => Some(SeedDropConfig {
            seed_item_name: "Corn Seeds", 
            drop_chance: 0.80, // 80% chance (reliable food crop)
            min_seeds: 2,      // 2-3 seeds per harvest
            max_seeds: 3,
        }),
        "Pumpkin" => Some(SeedDropConfig {
            seed_item_name: "Pumpkin Seeds",
            drop_chance: 0.90, // 90% chance (large crop with long growth time - most reliable)
            min_seeds: 3,      // 3-5 seeds per harvest (highest yield)
            max_seeds: 5,
        }),
        "Plant Fiber" => Some(SeedDropConfig { // Note: hemp primary yield is "Plant Fiber"
            seed_item_name: "Hemp Seeds",
            drop_chance: 0.88, // 88% chance (fiber crop essential for crafting)
            min_seeds: 2,      // 2-4 seeds per harvest
            max_seeds: 4,
        }),
        "Common Reed Stalk" => Some(SeedDropConfig {
            seed_item_name: "Reed Rhizome",
            drop_chance: 0.82, // 82% chance (building material)
            min_seeds: 2,      // 2-3 rhizomes per harvest
            max_seeds: 3,
        }),
        "Mushroom" => Some(SeedDropConfig {
            seed_item_name: "Mushroom Spores",
            drop_chance: 0.95, // 95% chance (basic food, fastest growing - most reliable)
            min_seeds: 2,      // 2-3 spores per harvest
            max_seeds: 3,
        }),
        _ => None, // No seed drops for other resources
    }
}

/// Attempts to grant seed drops to a player based on the harvested resource
///
/// This function is called after successful resource collection to potentially
/// give the player seeds that can be planted to grow more of that resource.
pub fn try_grant_seed_drops(
    ctx: &ReducerContext,
    player_id: Identity,
    harvested_resource_name: &str,
    rng: &mut impl Rng,
) -> Result<(), String> {
    // Check if this resource has seed drops configured
    let seed_config = match get_seed_drop_config(harvested_resource_name) {
        Some(config) => config,
        None => {
            // No seed drops for this resource, that's fine
            return Ok(());
        }
    };

    // Roll for seed drop chance
    if rng.gen::<f32>() < seed_config.drop_chance {
        let item_defs = ctx.db.item_definition();
        
        // Find the seed item definition
        let seed_item_def = item_defs.iter()
            .find(|def| def.name == seed_config.seed_item_name)
            .ok_or_else(|| format!("Seed item definition '{}' not found", seed_config.seed_item_name))?;

        // Calculate how many seeds to give (between min and max)
        let seed_amount = if seed_config.min_seeds >= seed_config.max_seeds {
            seed_config.min_seeds // If min >= max, give min amount
        } else {
            rng.gen_range(seed_config.min_seeds..=seed_config.max_seeds)
        };

        // Give seeds to the player (or drop near player if inventory full)
        match crate::dropped_item::try_give_item_to_player(ctx, player_id, seed_item_def.id, seed_amount) {
            Ok(added_to_inventory) => {
                if added_to_inventory {
                    log::info!("Player {:?} received {} seed drop(s): {} (added to inventory) from harvesting {}.", 
                              player_id, seed_amount, seed_config.seed_item_name, harvested_resource_name);
                } else {
                    log::info!("Player {:?} received {} seed drop(s): {} (dropped near player - inventory full) from harvesting {}.", 
                              player_id, seed_amount, seed_config.seed_item_name, harvested_resource_name);
                }
            }
            Err(e) => {
                log::error!("Failed to give {} seed drop(s) {} to player {:?}: {}", seed_amount, seed_config.seed_item_name, player_id, e);
                // Don't return error - seed drop failure shouldn't stop main harvest
            }
        }
    }

    Ok(())
} 