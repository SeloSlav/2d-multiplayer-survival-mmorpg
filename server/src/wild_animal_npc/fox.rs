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
            sprint_speed: 450.0, // REVERTED from 850.0 - back to previous speed (850 was too fast)
            perception_range: 800.0, // INCREASED from 400.0 - much better vision for early detection
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
                    // DECISIVE: Make ONE decision and stick to it
                    if player.health >= (crate::player_stats::PLAYER_MAX_HEALTH * 0.4) {
                        // Healthy player = FLEE IMMEDIATELY AND COMMIT
                        Self::set_fox_flee_destination(animal, player.position_x, player.position_y, rng);
                        animal.state = AnimalState::Fleeing;
                        animal.target_player_id = None;
                        animal.state_change_time = current_time;
                        log::info!("Fox {} COMMITTED TO FLEEING from healthy player {} (health: {:.1})", 
                                   animal.id, player.identity, player.health);
                    } else {
                        // Weak player = ATTACK IMMEDIATELY AND COMMIT
                        animal.state = AnimalState::Chasing;
                        animal.target_player_id = Some(player.identity);
                        animal.state_change_time = current_time;
                        log::info!("Fox {} COMMITTED TO ATTACKING weak player {} (health: {:.1})", 
                                   animal.id, player.identity, player.health);
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
                // COMMITTED TO FLEE - stay in flee mode much longer
                if let (Some(target_x), Some(target_y)) = (animal.investigation_x, animal.investigation_y) {
                    let distance_to_target_sq = get_distance_squared(animal.pos_x, animal.pos_y, target_x, target_y);
                    
                    // Only return to patrol when VERY far from original threat location
                    if distance_to_target_sq <= 200.0 * 200.0 { // Much larger safety zone
                        animal.investigation_x = None;
                        animal.investigation_y = None;
                        animal.state = AnimalState::Patrolling;
                        animal.state_change_time = current_time;
                        log::debug!("Fox {} finally reached safe distance, returning to patrol", animal.id);
                    }
                } else {
                    // No flee target - check if far enough from spawn
                    let spawn_distance_sq = get_distance_squared(
                        animal.pos_x, animal.pos_y, animal.spawn_x, animal.spawn_y
                    );
                    
                    if spawn_distance_sq >= (stats.patrol_radius * 2.0).powi(2) { // Much farther requirement
                        animal.state = AnimalState::Patrolling;
                        animal.state_change_time = current_time;
                        log::debug!("Fox {} fled far enough from spawn area, returning to patrol", animal.id);
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
        // Move toward investigation target (flee destination) if set, otherwise toward spawn
        if let (Some(target_x), Some(target_y)) = (animal.investigation_x, animal.investigation_y) {
            // Use SPRINT SPEED for fleeing - foxes bolt away fast!
            move_towards_target(ctx, animal, target_x, target_y, stats.sprint_speed, dt);
            
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
        // Circular patrol pattern
        animal.patrol_phase += dt * 0.3; // Adjust speed
        if animal.patrol_phase >= 2.0 * PI {
            animal.patrol_phase -= 2.0 * PI;
        }
        
        let target_x = animal.spawn_x + stats.patrol_radius * animal.patrol_phase.cos();
        let target_y = animal.spawn_y + stats.patrol_radius * animal.patrol_phase.sin();
        
        // Check if target position is safe (avoid shelters and water)
        if !super::core::is_position_in_shelter(ctx, target_x, target_y) &&
           !crate::fishing::is_water_tile(ctx, target_x, target_y) {
            move_towards_target(ctx, animal, target_x, target_y, stats.movement_speed, dt);
        } else {
            // If target position is blocked, skip ahead in the patrol phase
            animal.patrol_phase += dt * 0.5; // Move faster to find clear space
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