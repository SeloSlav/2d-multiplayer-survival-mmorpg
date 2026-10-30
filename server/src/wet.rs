use spacetimedb::{ReducerContext, Table, Identity, Timestamp, TimeDuration};
use log;
use crate::active_effects::{ActiveConsumableEffect, EffectType, active_consumable_effect as ActiveConsumableEffectTableTrait};
use crate::Player;
use crate::player;
use crate::shelter::shelter;
// Import armor module for immunity checks
use crate::armor;
use crate::models::ImmunityType;
// Import chunk calculation for chunk-based weather
use crate::environment::calculate_chunk_index;

// Constants for wet effect
pub const WET_COLD_DAMAGE_MULTIPLIER: f32 = 2.0; // Double cold damage when wet
pub const WET_WARMTH_DRAIN_PER_SECOND: f32 = 0.15; // Additional warmth loss per second when wet (further reduced for balance)
pub const WET_LINGER_DURATION_SECONDS: u32 = 60; // How long wet effect lasts after leaving water/rain
pub const WET_EFFECT_CHECK_INTERVAL_SECONDS: u32 = 2; // Check wet conditions every 2 seconds
pub const WET_NORMAL_DECAY_RATE_PERCENT: f32 = 1.67; // Percentage points of wetness to remove per second normally (reaches 0 from 100% in ~60s)
pub const WET_FAST_DECAY_RATE_PERCENT: f32 = 10.0; // Percentage points to remove per second when near warmth (~10s to fully dry from 100%)
pub const WET_TREE_DECAY_RATE_PERCENT: f32 = 5.0; // Percentage points to remove per second when near trees (~20s to fully dry from 100%)
pub const WET_INCREASE_RATE_PERCENT: f32 = 5.0; // Percentage points of wetness to add per second when exposed to water/rain

/// Applies or updates a wet effect to a player with percentage-based wetness
/// - wetness_cap: The maximum wetness percentage (0.0 to 1.0) the player can reach from this source
/// - This increases wetness gradually up to the cap, but never decreases it (cap is just upper bound)
/// - total_amount stores the current wetness percentage (0.0 to 1.0)
pub fn apply_wet_effect(ctx: &ReducerContext, player_id: Identity, wetness_cap: f32, reason: &str) -> Result<(), String> {
    // <<< CHECK WETNESS IMMUNITY FROM ARMOR >>>
    if armor::has_armor_immunity(ctx, player_id, ImmunityType::Wetness) {
        log::info!("Player {:?} is immune to wetness effects (armor immunity)", player_id);
        return Ok(()); // Silently ignore wet effect application
    }
    // <<< END WETNESS IMMUNITY CHECK >>>
    
    let current_time = ctx.timestamp;
    let linger_duration = TimeDuration::from_micros((WET_LINGER_DURATION_SECONDS as i64) * 1_000_000);
    let new_end_time = current_time + linger_duration;
    
    // Check if player already has wet effect
    let existing_wet_effect: Option<ActiveConsumableEffect> = ctx.db.active_consumable_effect().iter()
        .find(|e| e.player_id == player_id && e.effect_type == EffectType::Wet)
        .map(|e| e.clone());

    if let Some(existing_effect) = existing_wet_effect {
        // Player already has wet effect - update wetness percentage
        let current_wetness = existing_effect.total_amount.unwrap_or(0.0);
        
        // Increase wetness by WET_INCREASE_RATE_PERCENT per second, but cap at wetness_cap
        // The cap is the upper bound - we never decrease wetness just because the cap dropped
        let wetness_increase = WET_INCREASE_RATE_PERCENT / 100.0; // Convert to 0.0-1.0 scale
        let new_wetness = (current_wetness + wetness_increase).min(wetness_cap).max(current_wetness);
        
        // Only update if there's a meaningful change
        if (new_wetness - current_wetness).abs() > 0.001 || new_wetness >= wetness_cap * 0.999 {
            let mut updated_effect = existing_effect.clone();
            updated_effect.ends_at = new_end_time; // Reset linger timer
            updated_effect.total_amount = Some(new_wetness.min(1.0)); // Clamp to max 1.0
            
            ctx.db.active_consumable_effect().effect_id().update(updated_effect);
            log::debug!("Updated wet effect {} for player {:?}: wetness {:.1}% -> {:.1}% (cap: {:.1}%, reason: {})", 
                existing_effect.effect_id, player_id, current_wetness * 100.0, new_wetness * 100.0, wetness_cap * 100.0, reason);
        } else {
            // Just refresh the linger timer without changing wetness
            let mut updated_effect = existing_effect.clone();
            updated_effect.ends_at = new_end_time;
            ctx.db.active_consumable_effect().effect_id().update(updated_effect);
        }
        return Ok(());
    }

    // Create new wet effect with initial wetness (start at 0 and increase)
    let initial_wetness = (WET_INCREASE_RATE_PERCENT / 100.0).min(wetness_cap);
    
    let wet_effect = ActiveConsumableEffect {
        effect_id: 0, // auto_inc
        player_id,
        target_player_id: None,
        item_def_id: 0, // Not from an item
        consuming_item_instance_id: None,
        started_at: current_time,
        ends_at: new_end_time,
        total_amount: Some(initial_wetness), // Store wetness percentage (0.0 to 1.0)
        amount_applied_so_far: None,
        effect_type: EffectType::Wet,
        tick_interval_micros: 1_000_000, // 1 second ticks
        next_tick_at: current_time + TimeDuration::from_micros(1_000_000),
    };
    
    match ctx.db.active_consumable_effect().try_insert(wet_effect) {
        Ok(inserted_effect) => {
            log::info!("Applied wet effect {} to player {:?}: initial wetness {:.1}% (cap: {:.1}%, reason: {})", 
                inserted_effect.effect_id, player_id, initial_wetness * 100.0, wetness_cap * 100.0, reason);
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

/// Gets the rain intensity at a specific position (0.0 to 1.0)
/// Returns 0.0 if not raining
fn get_rain_intensity_at_position(ctx: &ReducerContext, pos_x: f32, pos_y: f32) -> f32 {
    use crate::world_state::chunk_weather as ChunkWeatherTableTrait;
    
    // Calculate chunk index for the player's position
    let chunk_index = calculate_chunk_index(pos_x, pos_y);
    
    // Check chunk-based weather first
    if let Some(chunk_weather) = ctx.db.chunk_weather().chunk_index().find(&chunk_index) {
        return chunk_weather.rain_intensity;
    }
    
    // Fallback to global weather if chunk weather not found (backward compatibility)
    use crate::world_state::world_state as WorldStateTableTrait;
    if let Some(world_state) = ctx.db.world_state().iter().next() {
        world_state.rain_intensity
    } else {
        0.0
    }
}

/// Checks if it's currently raining at a specific position (any intensity > 0)
fn is_raining_at_position(ctx: &ReducerContext, pos_x: f32, pos_y: f32) -> bool {
    get_rain_intensity_at_position(ctx, pos_x, pos_y) > 0.0
}

/// Checks if a player should get wet due to environmental conditions
/// Returns (should_be_wet, wetness_cap, reason)
/// - wetness_cap: The maximum wetness percentage (0.0 to 1.0) the player can reach from this source
///   - Water (swimming/standing) always returns 1.0 (100%)
///   - Rain returns the rain intensity (e.g., 0.36 for 36% drizzle)
pub fn should_player_be_wet(ctx: &ReducerContext, player_id: Identity, player: &Player) -> (bool, f32, String) {
    // Check if player is standing on water - always 100% wetness cap
    if crate::is_player_on_water(ctx, player.position_x, player.position_y) {
        return (true, 1.0, "standing in water".to_string());
    }
    
    // Check if it's raining at player's position and player is not protected
    let rain_intensity = get_rain_intensity_at_position(ctx, player.position_x, player.position_y);
    if rain_intensity > 0.0 && !is_player_protected_from_rain(ctx, player) {
        return (true, rain_intensity, "exposed to rain".to_string());
    }
    
    (false, 0.0, String::new())
}


/// Checks if a position is near a fishing or hunting village communal campfire (for wetness decay acceleration)
fn is_player_near_village_campfire(ctx: &ReducerContext, pos_x: f32, pos_y: f32) -> bool {
    use crate::monument_part as MonumentPartTableTrait;
    use crate::MonumentType;

    const VILLAGE_CAMPFIRE_RADIUS: f32 = 450.0;
    const VILLAGE_CAMPFIRE_RADIUS_SQ: f32 = VILLAGE_CAMPFIRE_RADIUS * VILLAGE_CAMPFIRE_RADIUS;

    for part in ctx.db.monument_part().iter() {
        if (part.monument_type == MonumentType::FishingVillage || part.monument_type == MonumentType::HuntingVillage)
            && part.part_type == "campfire"
        {
            let dx = pos_x - part.world_x;
            let dy = pos_y - part.world_y;
            if (dx * dx + dy * dy) <= VILLAGE_CAMPFIRE_RADIUS_SQ {
                return true;
            }
        }
    }
    false
}

/// Checks if a player is protected from rain (inside shelter, building, near campfire, or has tree cover)
fn is_player_protected_from_rain(ctx: &ReducerContext, player: &Player) -> bool {
    use crate::shelter::shelter as ShelterTableTrait;
    use crate::campfire::campfire as CampfireTableTrait;
    use crate::monument_part as MonumentPartTableTrait;
    use crate::MonumentType;
    
    // Fishing village campfire warmth radius for rain protection (same as cozy radius)
    const FISHING_VILLAGE_WARMTH_RADIUS: f32 = 450.0;
    const FISHING_VILLAGE_WARMTH_RADIUS_SQ: f32 = FISHING_VILLAGE_WARMTH_RADIUS * FISHING_VILLAGE_WARMTH_RADIUS;
    
    if crate::indoors::is_position_indoors(ctx, player.position_x, player.position_y) { return true; }

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
    
    // Check if player is near fishing or hunting village communal campfire (always burning, provides rain protection)
    for part in ctx.db.monument_part().iter() {
        if (part.monument_type == MonumentType::FishingVillage || part.monument_type == MonumentType::HuntingVillage)
            && part.part_type == "campfire"
        {
            let dx = player.position_x - part.world_x;
            let dy = player.position_y - part.world_y;
            let distance_squared = dx * dx + dy * dy;

            if distance_squared <= FISHING_VILLAGE_WARMTH_RADIUS_SQ {
                log::debug!("Player {:?} is protected from rain by village campfire ({:?})", player.identity, part.monument_type);
                return true;
            }
        }
    }
    
    // Check if player has tree cover effect (natural shelter)
    if crate::active_effects::player_has_tree_cover_effect(ctx, player.identity) {
        return true;
    }
    
    false
}

/// Updates player wet status based on current environmental conditions
/// This should be called periodically for all players
pub fn update_player_wet_status(ctx: &ReducerContext, player_id: Identity, player: &Player) -> Result<(), String> {
    let (should_be_wet, wetness_cap, reason) = should_player_be_wet(ctx, player_id, player);
    let has_wet_effect = player_has_wet_effect(ctx, player_id);
    let has_cozy_effect = crate::active_effects::player_has_cozy_effect(ctx, player_id);
    
    log::debug!("Wet status check for player {:?}: should_be_wet={} (cap={:.1}%, {}), has_wet_effect={}, has_cozy_effect={}", 
        player_id, should_be_wet, wetness_cap * 100.0, reason, has_wet_effect, has_cozy_effect);
    
    if should_be_wet {
        // Apply or update wet effect with the appropriate cap
        apply_wet_effect(ctx, player_id, wetness_cap, &reason)?;
    }
    // Note: If not wet and has wet effect, let the decay system handle it naturally
    
    Ok(())
}

/// Checks for environmental conditions that should apply wet effects or accelerate decay
/// Uses percentage-based wetness system where total_amount stores the wetness level (0.0 to 1.0)
pub fn check_and_remove_wet_from_environment(ctx: &ReducerContext) -> Result<(), String> {
    use crate::player;
    
    // First, check all players to see if they should get wet effects
    for player in ctx.db.player().iter() {
        if !player.is_online || player.is_dead {
            continue;
        }
        
        let player_id = player.identity;
        let (should_be_wet, wetness_cap, reason) = should_player_be_wet(ctx, player_id, &player);
        
        if should_be_wet {
            // Apply or update wet effect with the appropriate cap
            apply_wet_effect(ctx, player_id, wetness_cap, &reason)?;
        }
        
        let indoors = crate::indoors::is_position_indoors(ctx, player.position_x, player.position_y);
        if player.is_inside_building != indoors {
            let mut updated_player = player.clone();
            updated_player.is_inside_building = indoors;
            ctx.db.player().identity().update(updated_player);
        }
    }
    
    // Then, handle drying (decay of wetness percentage) when not actively getting wet
    let wet_effects: Vec<ActiveConsumableEffect> = ctx.db.active_consumable_effect().iter()
        .filter(|effect| effect.effect_type == EffectType::Wet)
        .collect();

    for effect in wet_effects {
        let player_id = effect.player_id;
        
        if let Some(player) = ctx.db.player().identity().find(&player_id) {
            let is_raining_now = is_raining_at_position(ctx, player.position_x, player.position_y);
            let is_protected_from_rain = is_player_protected_from_rain(ctx, &player);
            let is_in_water = crate::is_player_on_water(ctx, player.position_x, player.position_y);
            let has_cozy_effect = crate::active_effects::player_has_cozy_effect(ctx, player_id);
            
            // Check if player is still actively getting wet
            let still_getting_wet = is_in_water || (is_raining_now && !is_protected_from_rain);
            
            if still_getting_wet {
                // Player is still getting wet - don't decay, just continue
                continue;
            }
            
            let has_tree_cover_effect = crate::active_effects::player_has_tree_cover_effect(ctx, player_id);
            let is_near_village_campfire = is_player_near_village_campfire(ctx, player.position_x, player.position_y);

            // Calculate decay rate based on environment - effects can stack!
            let mut decay_rate_percent = WET_NORMAL_DECAY_RATE_PERCENT; // Base decay rate (per second)
            let mut decay_reasons = Vec::new();

            // Village campfires (fishing/hunting) and cozy effect both provide fastest drying
            if has_cozy_effect || is_near_village_campfire {
                decay_rate_percent += WET_FAST_DECAY_RATE_PERCENT - WET_NORMAL_DECAY_RATE_PERCENT;
                decay_reasons.push(if is_near_village_campfire { "village campfire (warmth)" } else { "cozy effect (warmth)" });
            }
            
            if has_tree_cover_effect {
                // Tree cover provides moderate drying (can stack with cozy!)
                decay_rate_percent += WET_TREE_DECAY_RATE_PERCENT - WET_NORMAL_DECAY_RATE_PERCENT;
                decay_reasons.push("tree cover");
            }
            
            // 👕 ARMOR-BASED DRYING: Cloth armor dries faster
            let armor_drying_multiplier = armor::calculate_drying_speed_multiplier(ctx, player_id);
            if armor_drying_multiplier > 1.0 {
                // Apply cloth armor bonus to the base decay rate
                let armor_bonus = WET_NORMAL_DECAY_RATE_PERCENT * (armor_drying_multiplier - 1.0);
                if armor_bonus > 0.0 {
                    decay_rate_percent += armor_bonus;
                    decay_reasons.push("cloth armor (fast drying)");
                }
            }
            
            let decay_reason = if decay_reasons.is_empty() {
                "natural drying".to_string()
            } else if decay_reasons.len() > 1 {
                format!("{} (stacked effects)", decay_reasons.join(" + "))
            } else {
                decay_reasons[0].to_string()
            };
            
            // Apply decay to wetness percentage
            let current_wetness = effect.total_amount.unwrap_or(1.0); // Default to 100% if not set
            let wetness_decrease = decay_rate_percent / 100.0; // Convert to 0.0-1.0 scale
            let new_wetness = (current_wetness - wetness_decrease).max(0.0);
            
            if new_wetness <= 0.001 {
                // Wetness has reached 0% - remove the effect entirely
                remove_wet_effect(ctx, player_id, &format!("fully dried from {}", decay_reason));
                log::info!("WET EFFECT REMOVED: player={:?}, reason={}", player_id, decay_reason);
            } else if (new_wetness - current_wetness).abs() > 0.001 {
                // Update the effect with reduced wetness percentage
                let mut updated_effect = effect.clone();
                updated_effect.total_amount = Some(new_wetness);
                // Also refresh the linger timer since we're actively drying
                let current_time = ctx.timestamp;
                let linger_duration = TimeDuration::from_micros((WET_LINGER_DURATION_SECONDS as i64) * 1_000_000);
                updated_effect.ends_at = current_time + linger_duration;
                
                ctx.db.active_consumable_effect().effect_id().update(updated_effect);
                log::debug!("WET DECAY: player={:?}, wetness {:.1}% -> {:.1}% (rate: {:.1}%/s, reason: {})", 
                    player_id, current_wetness * 100.0, new_wetness * 100.0, decay_rate_percent, decay_reason);
            }
        }
    }

    Ok(())
} 