/******************************************************************************
 *                                                                            *
 * Cinder Fox Behavior - Opportunistic Hit-and-Run Scavenger                 *
 *                                                                            *
 * Foxes are skittish opportunistic predators that target weak players and   *
 * flee from healthy ones. They use hit-and-run tactics and have no hiding   *
 * behavior, preferring to bolt to safety when threatened.                   *
 *                                                                            *
 ******************************************************************************/

use spacetimedb::{ReducerContext, Identity, Timestamp, Table};
use std::f32::consts::PI;
use rand::Rng;
use log;

use crate::{Player};
use crate::utils::get_distance_squared;

// Table trait imports
use crate::player as PlayerTableTrait;
use super::core::{
    AnimalBehavior, AnimalStats, AnimalState, MovementPattern, WildAnimal,
    move_towards_target, can_attack
};

pub struct CinderFoxBehavior;

pub trait FoxBehavior {
    fn set_fox_flee_destination(
        animal: &mut WildAnimal,
        from_x: f32,
        from_y: f32,
        rng: &mut impl Rng,
    );
}

impl FoxBehavior for CinderFoxBehavior {
    fn set_fox_flee_destination(
        animal: &mut WildAnimal,
        from_x: f32,
        from_y: f32,
        rng: &mut impl Rng,
    ) {
        // Calculate direction away from threat
        let dx_from_threat = animal.pos_x - from_x;
        let dy_from_threat = animal.pos_y - from_y;
        let distance_from_threat = (dx_from_threat * dx_from_threat + dy_from_threat * dy_from_threat).sqrt();
        
        if distance_from_threat > 0.1 {
            // ZERO RANDOMNESS: Pick exact opposite direction and commit completely
            let flee_direction_x = dx_from_threat / distance_from_threat;
            let flee_direction_y = dy_from_threat / distance_from_threat;
            
            // Flee VERY far - foxes bolt away and stay away
            let flee_distance = 800.0; // Fixed distance, no randomness
            let flee_x = animal.pos_x + flee_direction_x * flee_distance;
            let flee_y = animal.pos_y + flee_direction_y * flee_distance;
            
            animal.investigation_x = Some(flee_x);
            animal.investigation_y = Some(flee_y);
            
            log::debug!("Fox {} committed to EXACT opposite direction: ({:.1}, {:.1}) - distance: {:.1}px", 
                       animal.id, flee_x, flee_y, flee_distance);
        } else {
            // Fallback: pick a random direction (only if threat position is unknown)
            let random_angle = rng.gen::<f32>() * 2.0 * PI;
            let flee_distance = 800.0; // Fixed distance
            animal.investigation_x = Some(animal.pos_x + random_angle.cos() * flee_distance);
            animal.investigation_y = Some(animal.pos_y + random_angle.sin() * flee_distance);
        }
    }
}

impl AnimalBehavior for CinderFoxBehavior {
    fn get_stats(&self) -> AnimalStats {
        AnimalStats {
            max_health: 200.0, // 2 bow shots to kill
            attack_damage: 20.0, // Increased damage for aggressive hit-and-run
            attack_range: 72.0, // INCREASED from 40.0 - larger melee range like wolf
            attack_speed_ms: 600, // Much faster attacks (was 800ms)
            movement_speed: 200.0, // Faster base movement for quick escapes
            sprint_speed: 350.0, // REVERTED from 850.0 - back to previous speed (850 was too fast)
            perception_range: 600.0, // INCREASED from 400.0 - much better vision for early detection
            perception_angle_degrees: 220.0, // INCREASED from 180.0 - even wider field of view for safety
            patrol_radius: 180.0, // 6m patrol loop
            chase_trigger_range: 120.0, // Shorter chase range - foxes are cautious
            flee_trigger_health_percent: 0.6, // Flee when moderately injured
            hide_duration_ms: 0, // NO HIDING - foxes don't hide anymore
        }
    }

    fn get_movement_pattern(&self) -> MovementPattern {
        MovementPattern::Loop
    }

    fn execute_attack_effects(
        &self,
        ctx: &ReducerContext,
        animal: &mut WildAnimal,
        target_player: &Player,
        stats: &AnimalStats,
        current_time: Timestamp,
        rng: &mut impl Rng,
    ) -> Result<f32, String> {
        let damage = stats.attack_damage;
        
        // Check target's health to determine fox behavior after attack
        if target_player.health >= (crate::player_stats::PLAYER_MAX_HEALTH * 0.4) {
            // Healthy target - flee far away after hit-and-run
            Self::set_fox_flee_destination(animal, target_player.position_x, target_player.position_y, rng);
            animal.state = AnimalState::Fleeing;
            animal.target_player_id = None;
            animal.state_change_time = current_time;
            
            // Fox jumps back after attack
            let jump_distance = 80.0;
            let dx = animal.pos_x - target_player.position_x;
            let dy = animal.pos_y - target_player.position_y;
            let distance = (dx * dx + dy * dy).sqrt();
            if distance > 0.0 {
                animal.pos_x += (dx / distance) * jump_distance;
                animal.pos_y += (dy / distance) * jump_distance;
            }
            
            log::info!("Cinder Fox {} hit-and-run attack on healthy player {} - fleeing to ({:.1}, {:.1})", 
                      animal.id, target_player.identity, 
                      animal.investigation_x.unwrap_or(0.0), animal.investigation_y.unwrap_or(0.0));
        } else {
            // Weak target - stay aggressive and continue attacking
            animal.state = AnimalState::Chasing;
            
            // Reset attack cooldown for faster follow-up attacks on weak targets
            animal.last_attack_time = Some(Timestamp::from_micros_since_unix_epoch(
                current_time.to_micros_since_unix_epoch() - (stats.attack_speed_ms as i64 * 700)
            ));
            
            log::info!("Cinder Fox {} continues aggressive assault on weak player {} (health: {:.1})", 
                      animal.id, target_player.identity, target_player.health);
        }
        
        Ok(damage)
    }

    fn update_ai_state_logic(
        &self,
        ctx: &ReducerContext,
        animal: &mut WildAnimal,
        stats: &AnimalStats,
        detected_player: Option<&Player>,
        current_time: Timestamp,
        rng: &mut impl Rng,
    ) -> Result<(), String> {
        match animal.state {
            AnimalState::Patrolling => {
                if let Some(player) = detected_player {
                    let distance_to_player = get_distance_squared(
                        animal.pos_x, animal.pos_y,
                        player.position_x, player.position_y
                    ).sqrt();
                    
                    // CORNERED ANIMAL OVERRIDE: If player gets too close, attack regardless of health
                    const CORNERED_DISTANCE: f32 = 90.0; // ~3 tiles - very close
                    
                    if distance_to_player <= CORNERED_DISTANCE {
                        // Too close! Fox feels cornered and attacks even healthy players
                        animal.state = AnimalState::Chasing;
                        animal.target_player_id = Some(player.identity);
                        animal.state_change_time = current_time;
                        log::info!("Fox {} CORNERED! Attacking player {} at close range ({:.1}px) regardless of health ({:.1})", 
                                   animal.id, player.identity, distance_to_player, player.health);
                    } else {
                        // Normal behavior: Make decision based on player health
                        if player.health >= (crate::player_stats::PLAYER_MAX_HEALTH * 0.4) {
                            // Healthy player = FLEE IMMEDIATELY AND COMMIT
                            Self::set_fox_flee_destination(animal, player.position_x, player.position_y, rng);
                            animal.state = AnimalState::Fleeing;
                            animal.target_player_id = None;
                            animal.state_change_time = current_time;
                            log::info!("Fox {} COMMITTED TO FLEEING from healthy player {} (health: {:.1}) at distance {:.1}px", 
                                       animal.id, player.identity, player.health, distance_to_player);
                        } else {
                            // Weak player = ATTACK IMMEDIATELY AND COMMIT
                            animal.state = AnimalState::Chasing;
                            animal.target_player_id = Some(player.identity);
                            animal.state_change_time = current_time;
                            log::info!("Fox {} COMMITTED TO ATTACKING weak player {} (health: {:.1}) at distance {:.1}px", 
                                       animal.id, player.identity, player.health, distance_to_player);
                        }
                    }
                }
            },
            
            AnimalState::Chasing => {
                // COMMITTED TO ATTACK - don't re-evaluate, just check distance
                if let Some(target_id) = animal.target_player_id {
                    if let Some(target_player) = ctx.db.player().identity().find(&target_id) {
                        let distance_sq = get_distance_squared(
                            animal.pos_x, animal.pos_y,
                            target_player.position_x, target_player.position_y
                        );
                        
                        // Only stop chasing if player gets too far away
                        if distance_sq > (stats.chase_trigger_range * 2.0).powi(2) { // Increased commitment range
                            animal.state = AnimalState::Patrolling;
                            animal.target_player_id = None;
                            animal.state_change_time = current_time;
                            log::debug!("Fox {} stopping chase - player escaped too far", animal.id);
                        }
                        // NO health re-evaluation - fox is committed to the attack!
                    } else {
                        // Target lost
                        animal.state = AnimalState::Patrolling;
                        animal.target_player_id = None;
                        animal.state_change_time = current_time;
                    }
                }
            },
            
            AnimalState::Fleeing => {
                // Check for cornered animal override even while fleeing
                if let Some(player) = detected_player {
                    let distance_to_player = get_distance_squared(
                        animal.pos_x, animal.pos_y,
                        player.position_x, player.position_y
                    ).sqrt();
                    
                    const CORNERED_DISTANCE: f32 = 90.0; // Same distance as patrol
                    
                    if distance_to_player <= CORNERED_DISTANCE {
                        // Player got too close while fleeing - turn and fight!
                        animal.state = AnimalState::Chasing;
                        animal.target_player_id = Some(player.identity);
                        animal.investigation_x = None; // Clear flee destination
                        animal.investigation_y = None;
                        animal.state_change_time = current_time;
                        log::info!("Fox {} CORNERED while fleeing! Turning to attack player {} at {:.1}px", 
                                   animal.id, player.identity, distance_to_player);
                        return Ok(()); // Exit early to start chasing
                    }
                }
                
                // Normal flee logic - COMMITTED TO FLEE - stay in flee mode until safe
                if let (Some(target_x), Some(target_y)) = (animal.investigation_x, animal.investigation_y) {
                    let distance_to_target_sq = get_distance_squared(animal.pos_x, animal.pos_y, target_x, target_y);
                    
                    // Only return to patrol when reached the flee destination
                    if distance_to_target_sq <= 50.0 * 50.0 { // Reached flee destination
                        animal.investigation_x = None;
                        animal.investigation_y = None;
                        animal.state = AnimalState::Patrolling;
                        animal.state_change_time = current_time;
                        log::debug!("Fox {} reached flee destination, continuing patrol", animal.id);
                    }
                } else {
                    // No specific flee target - timeout and continue patrolling
                    let time_since_flee = current_time.to_micros_since_unix_epoch() - 
                                         animal.state_change_time.to_micros_since_unix_epoch();
                    
                    // Return to patrol after timeout (removed spawn distance check)
                    if time_since_flee > 3_000_000 { // 3 seconds timeout
                        animal.state = AnimalState::Patrolling;
                        animal.state_change_time = current_time;
                        log::debug!("Fox {} flee timeout - continuing patrol", animal.id);
                    }
                }
            },
            
            _ => {} // Other states handled by core system
        }
        
        Ok(())
    }

    fn execute_flee_logic(
        &self,
        ctx: &ReducerContext,
        animal: &mut WildAnimal,
        stats: &AnimalStats,
        dt: f32,
        current_time: Timestamp,
        rng: &mut impl Rng,
    ) {
        // Store previous position to detect if we're stuck
        let prev_x = animal.pos_x;
        let prev_y = animal.pos_y;
        
        // Move toward investigation target (flee destination) if set, otherwise toward spawn
        if let (Some(target_x), Some(target_y)) = (animal.investigation_x, animal.investigation_y) {
            // Use SPRINT SPEED for fleeing - foxes bolt away fast!
            move_towards_target(ctx, animal, target_x, target_y, stats.sprint_speed, dt);
            
            // WATER UNSTUCK LOGIC: Check if we didn't move (stuck on water/collision)
            let movement_threshold = 5.0; // If moved less than 5px, consider stuck
            let distance_moved = ((animal.pos_x - prev_x).powi(2) + (animal.pos_y - prev_y).powi(2)).sqrt();
            
            if distance_moved < movement_threshold {
                // Check if target is water or if we're hitting water
                let target_is_water = crate::fishing::is_water_tile(ctx, target_x, target_y);
                let current_hitting_water = crate::fishing::is_water_tile(ctx, animal.pos_x + (target_x - animal.pos_x).signum() * 50.0, animal.pos_y + (target_y - animal.pos_y).signum() * 50.0);
                
                if target_is_water || current_hitting_water {
                    // UNSTUCK: Pick a new flee direction away from water
                    log::warn!("Fox {} got stuck on water while fleeing! Choosing new escape route...", animal.id);
                    
                    // Try multiple random directions to find one that's not water
                    let mut attempts = 0;
                    let mut found_safe_direction = false;
                    
                    while attempts < 8 && !found_safe_direction {
                        // Pick a random direction, preferring opposite to original threat
                        let random_angle = rng.gen::<f32>() * 2.0 * PI;
                        let flee_distance = 600.0 + (rng.gen::<f32>() * 400.0); // 12-20m flee distance
                        let new_flee_x = animal.pos_x + random_angle.cos() * flee_distance;
                        let new_flee_y = animal.pos_y + random_angle.sin() * flee_distance;
                        
                        // Check if this direction leads to water
                        let test_x = animal.pos_x + random_angle.cos() * 100.0; // Test 2m ahead
                        let test_y = animal.pos_y + random_angle.sin() * 100.0;
                        
                        if !crate::fishing::is_water_tile(ctx, test_x, test_y) && 
                           !super::core::is_position_in_shelter(ctx, test_x, test_y) {
                            // Found a safe direction!
                            animal.investigation_x = Some(new_flee_x);
                            animal.investigation_y = Some(new_flee_y);
                            found_safe_direction = true;
                            log::info!("Fox {} found safe escape route at angle {:.1}° - heading to ({:.1}, {:.1})", 
                                      animal.id, random_angle.to_degrees(), new_flee_x, new_flee_y);
                        }
                        attempts += 1;
                    }
                    
                    if !found_safe_direction {
                        // Last resort: flee directly away from current position
                        let emergency_angle = rng.gen::<f32>() * 2.0 * PI;
                        let emergency_distance = 800.0;
                        animal.investigation_x = Some(animal.pos_x + emergency_angle.cos() * emergency_distance);
                        animal.investigation_y = Some(animal.pos_y + emergency_angle.sin() * emergency_distance);
                        log::warn!("Fox {} using emergency escape route!", animal.id);
                    }
                }
            }
            
            // DON'T return to patrol here - let update_ai_state_logic handle it with larger safety zones
            // This prevents premature patrol returns
        } else {
            // No specific flee target - head toward spawn area at sprint speed and keep going
            move_towards_target(ctx, animal, animal.spawn_x, animal.spawn_y, stats.sprint_speed, dt);
        }
    }

    fn execute_patrol_logic(
        &self,
        ctx: &ReducerContext,
        animal: &mut WildAnimal,
        stats: &AnimalStats,
        dt: f32,
        rng: &mut impl Rng,
    ) {
        // Store previous position to detect if stuck
        let prev_x = animal.pos_x;
        let prev_y = animal.pos_y;
        
        // Random wandering instead of circular patrol around spawn
        if rng.gen::<f32>() < 0.18 { // 18% chance to change direction (foxes are more skittish)
            let angle = rng.gen::<f32>() * 2.0 * PI;
            animal.direction_x = angle.cos();
            animal.direction_y = angle.sin();
        }
        
        let target_x = animal.pos_x + animal.direction_x * stats.movement_speed * dt;
        let target_y = animal.pos_y + animal.direction_y * stats.movement_speed * dt;
        
        // Check if target position is safe (avoid shelters and water)
        if !super::core::is_position_in_shelter(ctx, target_x, target_y) &&
           !crate::fishing::is_water_tile(ctx, target_x, target_y) {
            move_towards_target(ctx, animal, target_x, target_y, stats.movement_speed, dt);
            
            // Check if stuck (water detection)
            let movement_threshold = 3.0;
            let distance_moved = ((animal.pos_x - prev_x).powi(2) + (animal.pos_y - prev_y).powi(2)).sqrt();
            
            if distance_moved < movement_threshold {
                // Stuck! Pick new random direction
                let new_angle = rng.gen::<f32>() * 2.0 * PI;
                animal.direction_x = new_angle.cos();
                animal.direction_y = new_angle.sin();
                log::debug!("Cinder Fox {} stuck during patrol - changing direction", animal.id);
            }
        } else {
            // If target position is blocked, pick a new random direction
            let angle = rng.gen::<f32>() * 2.0 * PI;
            animal.direction_x = angle.cos();
            animal.direction_y = angle.sin();
        }
    }

    fn should_chase_player(&self, animal: &WildAnimal, stats: &AnimalStats, player: &Player) -> bool {
        let distance_sq = get_distance_squared(
            animal.pos_x, animal.pos_y,
            player.position_x, player.position_y
        );
        
        // Foxes are opportunistic scavengers - only chase weak/injured players
        distance_sq <= stats.chase_trigger_range.powi(2) && 
        player.health < (crate::player_stats::PLAYER_MAX_HEALTH * 0.4) && // Only chase players under 40% health
        animal.health > stats.max_health * 0.5 // Need decent health to be aggressive
    }

    fn handle_damage_response(
        &self,
        ctx: &ReducerContext,
        animal: &mut WildAnimal,
        attacker: &Player,
        stats: &AnimalStats,
        current_time: Timestamp,
        rng: &mut impl Rng,
    ) -> Result<(), String> {
        // Foxes flee immediately when hit (super skittish)
        if attacker.health >= (crate::player_stats::PLAYER_MAX_HEALTH * 0.4) {
            // Healthy attacker - flee far away
            Self::set_fox_flee_destination(animal, attacker.position_x, attacker.position_y, rng);
            animal.state = AnimalState::Fleeing;
            animal.target_player_id = None;
            log::info!("Cinder Fox {} bolting away after being hit by healthy player {} (health: {:.1}) - target: ({:.1}, {:.1})", 
                      animal.id, attacker.identity, attacker.health,
                      animal.investigation_x.unwrap_or(0.0), animal.investigation_y.unwrap_or(0.0));
        } else {
            // Unhealthy attacker - become aggressive and chase
            animal.state = AnimalState::Chasing;
            animal.target_player_id = Some(attacker.identity);
            log::info!("Cinder Fox {} becoming aggressive toward weak attacker {} (health: {:.1})", 
                      animal.id, attacker.identity, attacker.health);
        }
        
        animal.state_change_time = current_time;
        Ok(())
    }
} 