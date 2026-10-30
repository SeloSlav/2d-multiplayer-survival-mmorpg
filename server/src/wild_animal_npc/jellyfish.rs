/******************************************************************************
 *                                                                            *
 * Jellyfish Behavior - Passive Aquatic Electric Hazard                       *
 *                                                                            *
 * Jellyfish are slow-drifting aquatic creatures that periodically emit       *
 * electric shocks in an area of effect. They do not approach or chase        *
 * players, but can cause significant burn damage if players get too close.   *
 *                                                                            *
 * KEY CHARACTERISTICS:                                                       *
 *   - Water-only: Can ONLY exist in Sea tiles (water)                        *
 *   - Very slow: Drifts lazily through the water                             *
 *   - Passive: Does not chase or approach players                            *
 *   - Electric shock: Periodic AOE damage (every 5-10 seconds)               *
 *   - Burns: Shock applies burn effect to players                            *
 *   - Cannot be tamed or harvested                                           *
 *   - No drops: Does not drop loot when killed                               *
 *   - Silent: No growl, death, or shock sounds                               *
 *                                                                            *
 * VISUAL EFFECTS:                                                            *
 *   - Shock causes yellow glow on jellyfish (client renders this)            *
 *                                                                            *
 ******************************************************************************/

use spacetimedb::{ReducerContext, Timestamp, Table, TimeDuration};
use rand::Rng;
use log;

use crate::Player;
use crate::utils::get_distance_squared;
use crate::animal_collision::resolve_animal_collision;

// Table trait imports
use crate::player as PlayerTableTrait;
use super::core::{
    AnimalBehavior, AnimalStats, AnimalState, MovementPattern, WildAnimal,
    transition_to_state, get_player_distance, wild_animal,
};

// Jellyfish constants
const JELLYFISH_SHOCK_RADIUS: f32 = 150.0; // AOE shock radius in pixels
const JELLYFISH_SHOCK_RADIUS_SQUARED: f32 = JELLYFISH_SHOCK_RADIUS * JELLYFISH_SHOCK_RADIUS;
const JELLYFISH_SHOCK_MIN_INTERVAL_MS: i64 = 5_000;  // Minimum 5 seconds between shocks
const JELLYFISH_SHOCK_MAX_INTERVAL_MS: i64 = 10_000; // Maximum 10 seconds between shocks
const JELLYFISH_SHOCK_VISUAL_DURATION_MS: i64 = 500; // Yellow glow duration
const JELLYFISH_SHOCK_DAMAGE: f32 = 15.0; // Direct damage from shock
const JELLYFISH_BURN_DAMAGE: f32 = 12.0; // Total burn damage over time
const JELLYFISH_BURN_DURATION: f32 = 6.0; // Burn lasts 6 seconds
const JELLYFISH_BURN_TICK_INTERVAL: f32 = 2.0; // Burn ticks every 2 seconds

pub struct JellyfishBehavior;

impl AnimalBehavior for JellyfishBehavior {
    fn get_stats(&self) -> AnimalStats {
        AnimalStats {
            max_health: 40.0, // Low health - fragile creature
            attack_damage: JELLYFISH_SHOCK_DAMAGE, // Shock damage (used for reference)
            attack_range: JELLYFISH_SHOCK_RADIUS, // Shock radius
            attack_speed_ms: 0, // Not used - jellyfish use periodic shocks instead
            movement_speed: 25.0, // Very slow drift speed
            sprint_speed: 25.0, // No sprinting - always drifts slowly
            perception_range: 0.0, // Doesn't perceive/react to players
            perception_angle_degrees: 0.0, // Doesn't perceive players
            patrol_radius: 200.0, // Drifts within area
            chase_trigger_range: 0.0, // Never chases
            flee_trigger_health_percent: 0.0, // Never flees
            hide_duration_ms: 0, // Doesn't hide
        }
    }

    fn get_movement_pattern(&self) -> MovementPattern {
        MovementPattern::Wander // Random drifting pattern
    }

    fn execute_attack_effects(
        &self,
        _ctx: &ReducerContext,
        _animal: &mut WildAnimal,
        _target_player: &Player,
        _stats: &AnimalStats,
        _current_time: Timestamp,
        _rng: &mut impl Rng,
    ) -> Result<f32, String> {
        // Jellyfish don't use the standard attack system
        // Shock damage is handled in update_ai_state_logic
        Ok(0.0)
    }

    fn update_ai_state_logic(
        &self,
        ctx: &ReducerContext,
        animal: &mut WildAnimal,
        stats: &AnimalStats,
        _detected_player: Option<&Player>,
        current_time: Timestamp,
        rng: &mut impl Rng,
    ) -> Result<(), String> {
        // 🎐 JELLYFISH WATER CONSTRAINT: Only operate in water
        if !is_position_on_water(ctx, animal.pos_x, animal.pos_y) {
            // Jellyfish stranded! Try to find nearest water and return
            if let Some((water_x, water_y)) = find_nearest_water_tile(ctx, animal.pos_x, animal.pos_y) {
                animal.investigation_x = Some(water_x);
                animal.investigation_y = Some(water_y);
                transition_to_state(animal, AnimalState::Drifting, current_time, None, "returning to water");
                log::warn!("🎐 Jellyfish {} stranded on land! Returning to water at ({:.1}, {:.1})", 
                          animal.id, water_x, water_y);
            }
            return Ok(());
        }
        
        // Ensure jellyfish is always in Drifting state
        if !matches!(animal.state, AnimalState::Drifting) {
            transition_to_state(animal, AnimalState::Drifting, current_time, None, "jellyfish drifts");
        }
        
        // ⚡ PERIODIC SHOCK MECHANIC
        // Check if it's time for an electric shock
        let should_shock = if let Some(last_shock) = animal.last_shock_time {
            let elapsed_ms = (current_time.to_micros_since_unix_epoch() - last_shock.to_micros_since_unix_epoch()) / 1000;
            // Random interval between 5-10 seconds
            let next_shock_interval = rng.gen_range(JELLYFISH_SHOCK_MIN_INTERVAL_MS..=JELLYFISH_SHOCK_MAX_INTERVAL_MS);
            elapsed_ms >= next_shock_interval
        } else {
            // First shock - wait a random initial delay (5-15 seconds)
            let initial_delay = rng.gen_range(5_000i64..=15_000i64);
            let elapsed_since_spawn_ms = (current_time.to_micros_since_unix_epoch() - animal.created_at.to_micros_since_unix_epoch()) / 1000;
            elapsed_since_spawn_ms >= initial_delay
        };
        
        if should_shock {
            self.execute_electric_shock(ctx, animal, current_time);
        }
        
        Ok(())
    }

    fn execute_flee_logic(
        &self,
        _ctx: &ReducerContext,
        animal: &mut WildAnimal,
        _stats: &AnimalStats,
        _dt: f32,
        current_time: Timestamp,
        _rng: &mut impl Rng,
    ) {
        // Jellyfish never flee - they just drift
        transition_to_state(animal, AnimalState::Drifting, current_time, None, "jellyfish never flee");
    }

    fn execute_patrol_logic(
        &self,
        ctx: &ReducerContext,
        animal: &mut WildAnimal,
        stats: &AnimalStats,
        dt: f32,
        rng: &mut impl Rng,
    ) {
        // 🎐 WATER-ONLY DRIFT: Jellyfish only drift in water tiles
        execute_water_drift(ctx, animal, stats, dt, rng);
    }

    fn should_chase_player(&self, _ctx: &ReducerContext, _animal: &WildAnimal, _stats: &AnimalStats, _player: &Player) -> bool {
        // Jellyfish never chase players - they're passive drifters
        false
    }

    fn handle_damage_response(
        &self,
        ctx: &ReducerContext,
        animal: &mut WildAnimal,
        _attacker: &Player,
        _stats: &AnimalStats,
        current_time: Timestamp,
        _rng: &mut impl Rng,
    ) -> Result<(), String> {
        // 🎐 JELLYFISH RESPONSE: When attacked, immediately shock
        // Jellyfish discharge electricity when disturbed
        log::info!("🎐⚡ Jellyfish {} disturbed by attack - emitting defensive shock!", animal.id);
        self.execute_electric_shock(ctx, animal, current_time);
        
        Ok(())
    }
    
    fn can_be_tamed(&self) -> bool {
        false // Jellyfish cannot be tamed
    }
    
    fn get_taming_foods(&self) -> Vec<&'static str> {
        vec![] // No taming foods - can't be tamed
    }
    
    fn get_chase_abandonment_multiplier(&self) -> f32 {
        0.0 // Never chases, so doesn't matter
    }
}

impl JellyfishBehavior {
    /// Execute the electric shock - AOE damage + burn to nearby players
    fn execute_electric_shock(&self, ctx: &ReducerContext, animal: &mut WildAnimal, current_time: Timestamp) {
        // Update shock timing
        animal.last_shock_time = Some(current_time);
        
        // Set visual effect duration (yellow glow)
        let visual_end = current_time + TimeDuration::from_micros(JELLYFISH_SHOCK_VISUAL_DURATION_MS * 1000);
        animal.shock_active_until = Some(visual_end);
        
        log::info!("🎐⚡ Jellyfish {} emits electric shock at ({:.1}, {:.1})!", 
                  animal.id, animal.pos_x, animal.pos_y);
        
        // Find all players within shock radius who are in sea water (AOE hazard - no snorkel required)
        let affected_players: Vec<_> = ctx.db.player().iter()
            .filter(|p| {
                if p.is_dead {
                    return false;
                }
                if crate::indoors::is_position_indoors(ctx, p.position_x, p.position_y) { return false; }
                // Player must be in sea water to get shocked (wading, swimming, snorkeling - all count)
                if !is_position_on_water(ctx, p.position_x, p.position_y) {
                    return false;
                }
                let dx = p.position_x - animal.pos_x;
                let dy = p.position_y - animal.pos_y;
                let dist_sq = dx * dx + dy * dy;
                dist_sq <= JELLYFISH_SHOCK_RADIUS_SQUARED
            })
            .collect();
        
        for player in affected_players {
            let player_id = player.identity;
            
            // Apply direct shock damage
            if let Some(mut p) = ctx.db.player().identity().find(&player_id) {
                let new_health = (p.health - JELLYFISH_SHOCK_DAMAGE).max(0.0);
                p.health = new_health;
                p.last_hit_time = Some(current_time); // Trigger damage visual feedback
                ctx.db.player().identity().update(p);
                
                log::info!("🎐⚡ Jellyfish {} shocked player {} for {:.1} damage (health: {:.1})", 
                          animal.id, player_id, JELLYFISH_SHOCK_DAMAGE, new_health);
            }
            
            // Apply burn effect
            if let Err(e) = crate::active_effects::apply_burn_effect(
                ctx, 
                player_id, 
                JELLYFISH_BURN_DAMAGE, 
                JELLYFISH_BURN_DURATION, 
                JELLYFISH_BURN_TICK_INTERVAL,
                0 // Environmental source (not from an item)
            ) {
                log::error!("🎐 Failed to apply burn effect from jellyfish shock: {}", e);
            } else {
                log::info!("🎐🔥 Jellyfish {} applied burn effect to player {}", animal.id, player_id);
            }
        }
    }
}

// ============================================================================
// Helper functions for water-based behavior
// ============================================================================

/// Check if a position is on a water tile (Sea)
fn is_position_on_water(ctx: &ReducerContext, pos_x: f32, pos_y: f32) -> bool {
    let tile_x = (pos_x / crate::TILE_SIZE_PX as f32).floor() as i32;
    let tile_y = (pos_y / crate::TILE_SIZE_PX as f32).floor() as i32;
    
    if let Some(tile_type) = crate::get_tile_type_at_position(ctx, tile_x, tile_y) {
        // Only Sea tiles count as water for jellyfish
        tile_type.is_sea_water() // Sea or DeepSea
    } else {
        false
    }
}

/// Find the nearest water tile to guide jellyfish back to water
fn find_nearest_water_tile(ctx: &ReducerContext, pos_x: f32, pos_y: f32) -> Option<(f32, f32)> {
    let current_tile_x = (pos_x / crate::TILE_SIZE_PX as f32).floor() as i32;
    let current_tile_y = (pos_y / crate::TILE_SIZE_PX as f32).floor() as i32;
    
    let search_radius = 15; // Search within 15 tiles
    let mut closest_water: Option<(i32, i32)> = None;
    let mut closest_distance_sq = f32::MAX;
    
    for dy in -search_radius..=search_radius {
        for dx in -search_radius..=search_radius {
            let check_x = current_tile_x + dx;
            let check_y = current_tile_y + dy;
            
            // Check bounds
            if check_x < 0 || check_y < 0 || 
               check_x >= crate::WORLD_WIDTH_TILES as i32 || check_y >= crate::WORLD_HEIGHT_TILES as i32 {
                continue;
            }
            
            if let Some(tile_type) = crate::get_tile_type_at_position(ctx, check_x, check_y) {
                if tile_type.is_sea_water() {
                    let distance_sq = (dx * dx + dy * dy) as f32;
                    if distance_sq < closest_distance_sq {
                        closest_distance_sq = distance_sq;
                        closest_water = Some((check_x, check_y));
                    }
                }
            }
        }
    }
    
    // Convert tile coordinates back to world position
    if let Some((water_tile_x, water_tile_y)) = closest_water {
        let water_world_x = (water_tile_x as f32 + 0.5) * crate::TILE_SIZE_PX as f32;
        let water_world_y = (water_tile_y as f32 + 0.5) * crate::TILE_SIZE_PX as f32;
        Some((water_world_x, water_world_y))
    } else {
        None
    }
}

/// Execute slow water drift behavior for jellyfish
fn execute_water_drift(
    ctx: &ReducerContext,
    animal: &mut WildAnimal,
    stats: &AnimalStats,
    dt: f32,
    rng: &mut impl Rng,
) {
    use std::f32::consts::PI;
    
    // Store starting position for facing direction update
    let start_x = animal.pos_x;
    let start_y = animal.pos_y;
    
    // Check if current position is on water
    if !is_position_on_water(ctx, animal.pos_x, animal.pos_y) {
        // Not on water - find nearest water and head there
        if let Some((water_x, water_y)) = find_nearest_water_tile(ctx, animal.pos_x, animal.pos_y) {
            let dx = water_x - animal.pos_x;
            let dy = water_y - animal.pos_y;
            let dist = (dx * dx + dy * dy).sqrt();
            
            if dist > 0.0 {
                animal.direction_x = dx / dist;
                animal.direction_y = dy / dist;
                
                let speed = stats.movement_speed * dt;
                let proposed_x = animal.pos_x + animal.direction_x * speed;
                let proposed_y = animal.pos_y + animal.direction_y * speed;
                let (final_x, final_y) = resolve_animal_collision(
                    ctx,
                    animal.id,
                    animal.pos_x,
                    animal.pos_y,
                    proposed_x,
                    proposed_y,
                    false,
                );
                animal.pos_x = final_x;
                animal.pos_y = final_y;
            }
        }
        return;
    }
    
    // Very rarely change direction (very slow, lazy drift)
    if rng.gen::<f32>() < 0.005 { // 0.5% chance per tick to change direction
        let angle = rng.gen::<f32>() * 2.0 * PI;
        animal.direction_x = angle.cos();
        animal.direction_y = angle.sin();
    }
    
    // Calculate potential new position (very slow movement)
    let speed = stats.movement_speed * dt;
    let proposed_x = animal.pos_x + animal.direction_x * speed;
    let proposed_y = animal.pos_y + animal.direction_y * speed;
    
    // Check if new position would be on water
    if is_position_on_water(ctx, proposed_x, proposed_y) {
        // Run through collision resolution (barrels, seastacks, corals, etc.)
        let (final_x, final_y) = resolve_animal_collision(
            ctx,
            animal.id,
            animal.pos_x,
            animal.pos_y,
            proposed_x,
            proposed_y,
            false, // Not attacking
        );
        animal.pos_x = final_x;
        animal.pos_y = final_y;
    } else {
        // Would leave water - gently bounce off the boundary
        for _ in 0..8 {
            let angle = rng.gen::<f32>() * 2.0 * PI;
            let test_dir_x = angle.cos();
            let test_dir_y = angle.sin();
            let test_x = animal.pos_x + test_dir_x * speed;
            let test_y = animal.pos_y + test_dir_y * speed;
            
            if is_position_on_water(ctx, test_x, test_y) {
                animal.direction_x = test_dir_x;
                animal.direction_y = test_dir_y;
                let (final_x, final_y) = resolve_animal_collision(
                    ctx,
                    animal.id,
                    animal.pos_x,
                    animal.pos_y,
                    test_x,
                    test_y,
                    false,
                );
                animal.pos_x = final_x;
                animal.pos_y = final_y;
                break;
            }
        }
    }
    
    // World boundary constraints
    let half_tile = crate::TILE_SIZE_PX as f32 / 2.0;
    let max_x = (crate::WORLD_WIDTH_TILES as f32 * crate::TILE_SIZE_PX as f32) - half_tile;
    let max_y = (crate::WORLD_HEIGHT_TILES as f32 * crate::TILE_SIZE_PX as f32) - half_tile;
    animal.pos_x = animal.pos_x.clamp(half_tile, max_x);
    animal.pos_y = animal.pos_y.clamp(half_tile, max_y);
    
    // Update facing direction based on actual movement delta (4 directions)
    let actual_move_x = animal.pos_x - start_x;
    let actual_move_y = animal.pos_y - start_y;
    if actual_move_x.abs() > 0.5 || actual_move_y.abs() > 0.5 {
        if actual_move_x.abs() > actual_move_y.abs() {
            animal.facing_direction = if actual_move_x > 0.0 { "right".to_string() } else { "left".to_string() };
        } else {
            animal.facing_direction = if actual_move_y > 0.0 { "down".to_string() } else { "up".to_string() };
        }
    }
}
