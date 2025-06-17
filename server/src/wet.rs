use spacetimedb::{ReducerContext, Table, Identity, Timestamp, TimeDuration};
use log;
use crate::active_effects::{ActiveConsumableEffect, EffectType, active_consumable_effect as ActiveConsumableEffectTableTrait};
use crate::Player;
use crate::player;

// Constants for wet effect
pub const WET_COLD_DAMAGE_MULTIPLIER: f32 = 4.0; // Quadruple cold damage when wet
pub const WET_LINGER_DURATION_SECONDS: u32 = 60; // How long wet effect lasts after leaving water/rain
pub const WET_EFFECT_CHECK_INTERVAL_SECONDS: u32 = 2; // Check wet conditions every 2 seconds
pub const WET_NORMAL_DECAY_RATE_SECONDS: u32 = 1; // How many seconds to remove from wet timer normally (1 second per 1-second interval)
pub const WET_FAST_DECAY_RATE_SECONDS: u32 = 5; // How many seconds to remove from wet timer when near warmth (5 seconds per 1-second interval - much faster!)

/// Applies a wet effect to a player
/// This creates a long-duration effect that will be removed by environmental conditions
pub fn apply_wet_effect(ctx: &ReducerContext, player_id: Identity, reason: &str) -> Result<(), String> {
    // Check if player already has wet effect - if so, just refresh the duration
    let existing_wet_effects: Vec<_> = ctx.db.active_consumable_effect().iter()
        .filter(|e| e.player_id == player_id && e.effect_type == EffectType::Wet)
        .collect();

    let current_time = ctx.timestamp;
    let linger_duration = TimeDuration::from_micros((WET_LINGER_DURATION_SECONDS as i64) * 1_000_000);
    let new_end_time = current_time + linger_duration;

    if !existing_wet_effects.is_empty() {
        // Refresh existing wet effect duration
        for existing_effect in existing_wet_effects {
            let mut updated_effect = existing_effect.clone();
            updated_effect.ends_at = new_end_time; // Reset the timer
            
            ctx.db.active_consumable_effect().effect_id().update(updated_effect);
            log::info!("Refreshed wet effect {} for player {:?} due to {} (duration reset to {}s)", 
                existing_effect.effect_id, player_id, reason, WET_LINGER_DURATION_SECONDS);
        }
        return Ok(());
    }

    // Create new wet effect
    let wet_effect = ActiveConsumableEffect {
        effect_id: 0, // auto_inc
        player_id,
        target_player_id: None,
        item_def_id: 0, // Not from an item
        consuming_item_instance_id: None,
        started_at: current_time,
        ends_at: new_end_time,
        total_amount: None, // No accumulation for wet effect
        amount_applied_so_far: None,
        effect_type: EffectType::Wet,
        tick_interval_micros: 1_000_000, // 1 second ticks (not really used)
        next_tick_at: current_time + TimeDuration::from_micros(1_000_000),
    };
    
    match ctx.db.active_consumable_effect().try_insert(wet_effect) {
        Ok(inserted_effect) => {
            log::info!("Applied wet effect {} to player {:?} due to {} (duration: {}s)", 
                inserted_effect.effect_id, player_id, reason, WET_LINGER_DURATION_SECONDS);
            Ok(())
        }
        Err(e) => {
            log::error!("Failed to apply wet effect to player {:?}: {:?}", player_id, e);
            Err("Failed to apply wet effect".to_string())
        }
    }
}

/// Removes wet effect from a player
pub fn remove_wet_effect(ctx: &ReducerContext, player_id: Identity, reason: &str) -> u32 {
    let mut effects_to_remove = Vec::new();
    for effect in ctx.db.active_consumable_effect().iter() {
        if effect.player_id == player_id && effect.effect_type == EffectType::Wet {
            effects_to_remove.push(effect.effect_id);
        }
    }
    
    let removed_count = effects_to_remove.len() as u32;
    for effect_id in effects_to_remove {
        ctx.db.active_consumable_effect().effect_id().delete(&effect_id);
        log::info!("Removed wet effect {} from player {:?} due to {}", effect_id, player_id, reason);
    }
    
    removed_count
}

/// Checks if a player currently has the wet effect active
pub fn player_has_wet_effect(ctx: &ReducerContext, player_id: Identity) -> bool {
    ctx.db.active_consumable_effect().iter()
        .any(|effect| effect.player_id == player_id && effect.effect_type == EffectType::Wet)
}

/// Checks if it's currently raining (any intensity > 0)
fn is_raining(ctx: &ReducerContext) -> bool {
    use crate::world_state::world_state as WorldStateTableTrait;
    
    if let Some(world_state) = ctx.db.world_state().iter().next() {
        world_state.rain_intensity > 0.0
    } else {
        false
    }
}

/// Checks if a player should get wet due to environmental conditions
/// Returns (should_be_wet, reason)
pub fn should_player_be_wet(ctx: &ReducerContext, player_id: Identity, player: &Player) -> (bool, String) {
    // Check if player is standing on water
    if crate::is_player_on_water(ctx, player.position_x, player.position_y) {
        return (true, "standing in water".to_string());
    }
    
    // Check if it's raining and player is not protected
    if is_raining(ctx) && !is_player_protected_from_rain(ctx, player) {
        return (true, "exposed to rain".to_string());
    }
    
    (false, String::new())
}

/// Checks if a player is protected from rain (inside shelter or near campfire)
fn is_player_protected_from_rain(ctx: &ReducerContext, player: &Player) -> bool {
    use crate::shelter::shelter as ShelterTableTrait;
    use crate::campfire::campfire as CampfireTableTrait;
    
    // Check if player is inside any shelter
    for shelter in ctx.db.shelter().iter() {
        if shelter.is_destroyed {
            continue;
        }
        
        if crate::shelter::is_player_inside_shelter(player.position_x, player.position_y, &shelter) {
            return true;
        }
    }
    
    // Check if player is near any burning campfire (warmth radius provides rain protection)
    for campfire in ctx.db.campfire().iter() {
        if !campfire.is_burning {
            continue;
        }
        
        let dx = player.position_x - campfire.pos_x;
        let dy = player.position_y - campfire.pos_y;
        let distance_squared = dx * dx + dy * dy;
        
        if distance_squared <= crate::campfire::WARMTH_RADIUS_SQUARED {
            return true;
        }
    }
    
    false
}

/// Updates player wet status based on current environmental conditions
/// This should be called periodically for all players
pub fn update_player_wet_status(ctx: &ReducerContext, player_id: Identity, player: &Player) -> Result<(), String> {
    let (should_be_wet, reason) = should_player_be_wet(ctx, player_id, player);
    let has_wet_effect = player_has_wet_effect(ctx, player_id);
    let has_cozy_effect = crate::active_effects::player_has_cozy_effect(ctx, player_id);
    
    log::debug!("Wet status check for player {:?}: should_be_wet={} ({}), has_wet_effect={}, has_cozy_effect={}", 
        player_id, should_be_wet, reason, has_wet_effect, has_cozy_effect);
    
    if should_be_wet && !has_wet_effect {
        // Apply wet effect
        log::info!("Applying wet effect to player {:?} due to {}", player_id, reason);
        apply_wet_effect(ctx, player_id, &reason)?;
    } else if should_be_wet && has_wet_effect {
        // Player is still wet and should be - refresh the effect duration
        apply_wet_effect(ctx, player_id, &reason)?;
    }
    // Note: Removed immediate cozy effect removal - let the decay system handle it naturally
    // If player is not wet and doesn't have wet effect, or if they have wet effect but it should naturally expire, do nothing
    
    Ok(())
}

/// Checks for environmental conditions that should apply wet effects or accelerate decay
/// Normal time-based expiration is now handled by the standard effect system
pub fn check_and_remove_wet_from_environment(ctx: &ReducerContext) -> Result<(), String> {
    use crate::player;
    
    // First, check all players to see if they should get wet effects
    for player in ctx.db.player().iter() {
        if !player.is_online || player.is_dead {
            continue;
        }
        
        let player_id = player.identity;
        let has_wet_effect = player_has_wet_effect(ctx, player_id);
        let (should_be_wet, reason) = should_player_be_wet(ctx, player_id, &player);
        
        if should_be_wet && !has_wet_effect {
            // Apply wet effect
            log::info!("Applying wet effect to player {:?} due to {}", player_id, reason);
            apply_wet_effect(ctx, player_id, &reason)?;
        } else if should_be_wet && has_wet_effect {
            // Player is still wet and should be - refresh the effect duration
            apply_wet_effect(ctx, player_id, &reason)?;
        }
    }
    
    // Then, check for accelerated decay when near warmth (cozy effect)
    // Normal time-based decay is now handled by the standard effect processing system
    let wet_effects: Vec<ActiveConsumableEffect> = ctx.db.active_consumable_effect().iter()
        .filter(|effect| effect.effect_type == EffectType::Wet)
        .collect();

    for effect in wet_effects {
        let player_id = effect.player_id;
        
        if let Some(player) = ctx.db.player().identity().find(&player_id) {
            let is_raining_now = is_raining(ctx);
            let is_protected_from_rain = is_player_protected_from_rain(ctx, &player);
            let is_in_water = crate::is_player_on_water(ctx, player.position_x, player.position_y);
            let has_cozy_effect = crate::active_effects::player_has_cozy_effect(ctx, player_id);
            
            // Check if player is still actively getting wet
            let still_getting_wet = is_in_water || (is_raining_now && !is_protected_from_rain);
            
            if still_getting_wet {
                // Player is still getting wet - don't decay, just continue
                continue;
            }
            
            // Only apply accelerated decay if player has cozy effect
            if has_cozy_effect {
                let current_time = ctx.timestamp;
                let accelerated_decay_amount = WET_FAST_DECAY_RATE_SECONDS - WET_NORMAL_DECAY_RATE_SECONDS; // Extra decay beyond normal
                let decay_duration = TimeDuration::from_micros((accelerated_decay_amount as i64) * 1_000_000);
                let new_end_time = effect.ends_at - decay_duration;
                
                log::info!("WET ACCELERATED DECAY: player={:?}, extra_decay={}s due to cozy effect", 
                    player_id, accelerated_decay_amount);
                
                // If the new end time is in the past, remove the effect entirely
                if new_end_time <= current_time {
                    remove_wet_effect(ctx, player_id, "accelerated drying near warmth");
                    log::info!("WET EFFECT REMOVED: player={:?}, reason=accelerated decay", player_id);
                } else {
                    // Update the effect with reduced duration
                    let mut updated_effect = effect.clone();
                    updated_effect.ends_at = new_end_time;
                    ctx.db.active_consumable_effect().effect_id().update(updated_effect);
                    log::info!("WET EFFECT ACCELERATED: player={:?}, new_end_time={:?}", 
                        player_id, new_end_time);
                }
            }
        }
    }

    Ok(())
} 