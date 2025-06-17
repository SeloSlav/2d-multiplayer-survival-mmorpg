use spacetimedb::{ReducerContext, Identity, Table, Timestamp};
use log;

// Import required modules and traits
use crate::Player;
use crate::player as PlayerTableTrait;
use crate::{world_pos_to_tile_coords, is_player_on_water, TileType, get_tile_type_at_position};
use crate::environment::{is_position_on_inland_water, is_tile_inland_water};
use crate::active_effects::apply_seawater_poisoning_effect;

// Import constants for validation
use crate::{PLAYER_RADIUS, TILE_SIZE_PX};

// Drinking mechanics constants
const DRINKING_INTERACTION_DISTANCE_SQUARED: f32 = 64.0 * 64.0; // Close to water to drink
const DRINKING_COOLDOWN_MS: u64 = 2_000; // 2 second cooldown between drinks
const RIVER_WATER_THIRST_GAIN: f32 = 75.0; // Big hydration boost from clean water
const SEA_WATER_THIRST_LOSS: f32 = -25.0; // Dehydration from salt water

// Drinking action table to track cooldowns
#[spacetimedb::table(name = player_drinking_cooldown, public)]
#[derive(Clone, Debug)]
pub struct PlayerDrinkingCooldown {
    #[primary_key]
    pub player_id: Identity,
    pub last_drink_time: Timestamp,
}

/// Validates that a player can drink water at their current position
/// Returns the water type (inland/river vs sea) and validates distance to water
fn validate_water_drinking(ctx: &ReducerContext, player_id: Identity) -> Result<bool, String> {
    // Find the player
    let player = ctx.db.player().identity().find(&player_id)
        .ok_or_else(|| "Player not found.".to_string())?;

    // Check if player is dead or knocked out
    if player.is_dead {
        return Err("Cannot drink while dead.".to_string());
    }
    if player.is_knocked_out {
        return Err("Cannot drink while knocked out.".to_string());
    }

    // Check if player is standing on or very close to water
    let player_x = player.position_x;
    let player_y = player.position_y;
    
    // Check if player is directly on water
    if is_player_on_water(ctx, player_x, player_y) {
        // Player is standing on water, check if it's inland (river/lake) or sea
        return Ok(is_position_on_inland_water(ctx, player_x, player_y));
    }
    
    // Check if player is adjacent to water (within drinking distance)
    let mut found_water = false;
    let mut is_inland_water = false;
    
    // Check in a small radius around the player for water tiles
    let check_radius_tiles = 2; // Check 2 tiles around player
    let (player_tile_x, player_tile_y) = world_pos_to_tile_coords(player_x, player_y);
    
    for dy in -check_radius_tiles..=check_radius_tiles {
        for dx in -check_radius_tiles..=check_radius_tiles {
            let check_tile_x = player_tile_x + dx;
            let check_tile_y = player_tile_y + dy;
            
            // Calculate distance from player to center of this tile
            let tile_center_x = (check_tile_x as f32 + 0.5) * TILE_SIZE_PX as f32;
            let tile_center_y = (check_tile_y as f32 + 0.5) * TILE_SIZE_PX as f32;
            let distance_sq = (player_x - tile_center_x).powi(2) + (player_y - tile_center_y).powi(2);
            
            // If within drinking distance and it's a water tile
            if distance_sq <= DRINKING_INTERACTION_DISTANCE_SQUARED {
                if let Some(tile_type) = get_tile_type_at_position(ctx, check_tile_x, check_tile_y) {
                    if tile_type == TileType::Sea {
                        found_water = true;
                        // Check if this water tile is inland (river/lake) or ocean
                        if is_tile_inland_water(ctx, check_tile_x, check_tile_y) {
                            is_inland_water = true;
                            break; // Prefer inland water if available
                        }
                    }
                }
            }
        }
        if found_water && is_inland_water {
            break; // Found inland water, stop searching
        }
    }
    
    if !found_water {
        return Err("No water source nearby. Get closer to water to drink.".to_string());
    }
    
    Ok(is_inland_water)
}

/// Checks if player is on cooldown for drinking
fn check_drinking_cooldown(ctx: &ReducerContext, player_id: Identity) -> Result<(), String> {
    let drinking_cooldowns = ctx.db.player_drinking_cooldown();
    
    if let Some(cooldown) = drinking_cooldowns.player_id().find(&player_id) {
        let current_time = ctx.timestamp;
        let time_since_last_drink = current_time.to_micros_since_unix_epoch() - cooldown.last_drink_time.to_micros_since_unix_epoch();
        let cooldown_micros = (DRINKING_COOLDOWN_MS * 1000) as i64; // Convert to microseconds as i64
        
        if time_since_last_drink < cooldown_micros {
            let remaining_ms = (cooldown_micros - time_since_last_drink) / 1000;
            return Err(format!("Must wait {:.1}s before drinking again.", remaining_ms as f32 / 1000.0));
        }
    }
    
    Ok(())
}

/// Updates or inserts drinking cooldown for a player
fn update_drinking_cooldown(ctx: &ReducerContext, player_id: Identity) {
    let drinking_cooldowns = ctx.db.player_drinking_cooldown();
    let current_time = ctx.timestamp;
    
    let cooldown_data = PlayerDrinkingCooldown {
        player_id,
        last_drink_time: current_time,
    };
    
    // Use insert or update pattern
    if drinking_cooldowns.player_id().find(&player_id).is_some() {
        drinking_cooldowns.player_id().update(cooldown_data);
    } else {
        match drinking_cooldowns.try_insert(cooldown_data) {
            Ok(_) => {},
            Err(e) => {
                log::error!("Failed to insert drinking cooldown for player {:?}: {}", player_id, e);
            }
        }
    }
}

/// Main drinking reducer - allows players to drink water from nearby water tiles
/// Differentiates between inland water (rivers/lakes) which hydrates, and sea water which dehydrates
#[spacetimedb::reducer]
pub fn drink_water(ctx: &ReducerContext) -> Result<(), String> {
    let player_id = ctx.sender;
    
    log::info!("Player {:?} attempting to drink water", player_id);
    
    // Check drinking cooldown
    check_drinking_cooldown(ctx, player_id)?;
    
    // Validate water drinking (distance, water availability, etc.)
    let is_inland_water = validate_water_drinking(ctx, player_id)?;
    
    // Get player and update thirst based on water type
    let players = ctx.db.player();
    let mut player = players.identity().find(&player_id)
        .ok_or_else(|| "Player not found.".to_string())?;
    
    let (thirst_change, water_type_msg) = if is_inland_water {
        // Inland water (rivers/lakes) - clean, fresh water
        (RIVER_WATER_THIRST_GAIN, "fresh water from a river")
    } else {
        // Sea water - salty, causes dehydration
        (SEA_WATER_THIRST_LOSS, "salt water from the sea")
    };
    
    // Apply thirst change with bounds checking
    let old_thirst = player.thirst;
    player.thirst = (player.thirst + thirst_change).clamp(0.0, 250.0); // Max thirst is 250
    
    // Update player in database
    players.identity().update(player.clone());
    
    // Update drinking cooldown
    update_drinking_cooldown(ctx, player_id);
    
    // Apply seawater poisoning effect if drinking sea water
    if !is_inland_water {
        // Apply 10 seconds of seawater poisoning (10 damage over 10 seconds)
        const SEAWATER_POISONING_DURATION: u32 = 10; // 10 seconds
        match apply_seawater_poisoning_effect(ctx, player_id, SEAWATER_POISONING_DURATION) {
            Ok(_) => {
                log::info!("Applied seawater poisoning effect to player {:?} for {} seconds", 
                          player_id, SEAWATER_POISONING_DURATION);
            },
            Err(e) => {
                log::error!("Failed to apply seawater poisoning effect to player {:?}: {}", player_id, e);
            }
        }
    }
    
    // Log the action
    if is_inland_water {
        log::info!("Player {:?} drank {} and gained {:.1} thirst (was {:.1}, now {:.1})", 
                  player_id, water_type_msg, thirst_change, old_thirst, player.thirst);
    } else {
        log::info!("Player {:?} drank {} and lost {:.1} thirst (was {:.1}, now {:.1}) - dehydrating and poisoned!", 
                  player_id, water_type_msg, -thirst_change, old_thirst, player.thirst);
    }
    
    Ok(())
} 