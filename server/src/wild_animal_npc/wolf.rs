/******************************************************************************
 *                                                                            *
 * Tundra Wolf Behavior - Aggressive Apex Predator                           *
 *                                                                            *
 * Wolves are aggressive pack hunters that pursue any player in range.       *
 * They have strong attacks with bleeding effects, double strikes, and       *
 * brief resting periods after combat.                                       *
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
use crate::fishing::is_water_tile;
use crate::animal_collision::check_animal_collision;
use super::core::{
    AnimalBehavior, AnimalStats, AnimalState, MovementPattern, WildAnimal,
    move_towards_target, can_attack
};

pub struct TundraWolfBehavior;

pub trait WolfBehavior {
    // Removed hiding behavior - wolves no longer hide
}

impl AnimalBehavior for TundraWolfBehavior {
    fn get_stats(&self) -> AnimalStats {
        AnimalStats {
            max_health: 200.0, // 4 bow shots to kill
            attack_damage: 25.0, // Reduced from 40.0 - still dangerous but not one-shot
            attack_range: 72.0, // INCREASED from 48.0 - larger melee range for more reliable attacks
            attack_speed_ms: 800, // REDUCED from 1000ms - faster, more aggressive attacks
            movement_speed: 268.0, // Reduced by 33% from 400.0 - more manageable patrol speed
            sprint_speed: 503.0, // Reduced by 33% from 750.0 - players can outrun with sustained sprinting
            perception_range: 800.0, // Excellent hunter vision (increased)
            perception_angle_degrees: 200.0, // Wider hunter awareness
            patrol_radius: 540.0, // 18m wander
            chase_trigger_range: 750.0, // INCREASED: Very persistent hunters - long chase range
            flee_trigger_health_percent: 0.0, // Wolves never flee - they fight to the death (0% = never flee)
            hide_duration_ms: 0, // Wolves don't hide
        }
    }

    fn get_movement_pattern(&self) -> MovementPattern {
        MovementPattern::Wander
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
        let mut damage = stats.attack_damage;
        
        // Wolves get more aggressive after tasting blood
        damage += 5.0; // Bonus damage for being an apex predator
        
        // 25% chance to cause bleeding (savage bite)
        if rng.gen::<f32>() < 0.25 {
            if let Err(e) = crate::active_effects::apply_bleeding_effect(
                ctx, 
                target_player.identity, 
                15.0, // Total bleed damage
                10.0, // Duration: 10 seconds
                2.0   // Tick every 2 seconds
            ) {
                log::error!("Failed to apply bleeding effect from wolf attack: {}", e);
            } else {
                log::info!("Tundra Wolf {} inflicts bleeding on player {}!", animal.id, target_player.identity);
            }
        }
        
        // 30% chance to immediately attack again (double strike)
        if rng.gen::<f32>() < 0.3 {
            animal.last_attack_time = None; // Reset attack cooldown for immediate second strike
            log::info!("Tundra Wolf {} enters blood rage - double strike!", animal.id);
        } else {
            log::info!("Tundra Wolf {} savages player {}", animal.id, target_player.identity);
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
                    // Wolves are aggressive - chase immediately instead of alerting
                    if self.should_chase_player(animal, stats, player) {
                        animal.state = AnimalState::Chasing;
                        animal.target_player_id = Some(player.identity);
                        animal.state_change_time = current_time;
                        log::debug!("Tundra Wolf {} immediately chasing player {}", animal.id, player.identity);
                    } else {
                        // If not chasing, briefly investigate
                        animal.state = AnimalState::Alert;
                        animal.investigation_x = Some(player.position_x);
                        animal.investigation_y = Some(player.position_y);
                        animal.state_change_time = current_time;
                    }
                }
            },
            
            AnimalState::Chasing => {
                if let Some(target_id) = animal.target_player_id {
                    if let Some(target_player) = ctx.db.player().identity().find(&target_id) {
                        let distance_sq = get_distance_squared(
                            animal.pos_x, animal.pos_y,
                            target_player.position_x, target_player.position_y
                        );
                        
                        // Check if should stop chasing (wolves are VERY persistent)
                        if distance_sq > (stats.chase_trigger_range * 1.8).powi(2) {
                            animal.state = AnimalState::Patrolling;
                            animal.target_player_id = None;
                            animal.state_change_time = current_time;
                            log::debug!("Tundra Wolf {} stopping chase - player too far", animal.id);
                        }
                    } else {
                        // Target lost
                        animal.state = AnimalState::Patrolling;
                        animal.target_player_id = None;
                        animal.state_change_time = current_time;
                    }
                }
            },
            
            AnimalState::Alert => {
                // Wolf sniffing behavior - investigate for a short time then chase
                let time_in_state = (current_time.to_micros_since_unix_epoch() -
                                    animal.state_change_time.to_micros_since_unix_epoch()) / 1000;
                
                if time_in_state > 1500 { // Reduced from 4000ms to 1.5 seconds - wolves are aggressive
                    if let Some(player) = detected_player {
                        if self.should_chase_player(animal, stats, player) {
                            animal.state = AnimalState::Chasing;
                            animal.target_player_id = Some(player.identity);
                            log::debug!("Tundra Wolf {} transitioning from alert to chase", animal.id);
                        } else {
                            animal.state = AnimalState::Patrolling;
                        }
                    } else {
                        animal.state = AnimalState::Patrolling;
                    }
                    animal.state_change_time = current_time;
                }
            },
            
            AnimalState::Fleeing => {
                // Check if fled far enough to return to patrolling
                if let Some(investigation_x) = animal.investigation_x {
                    if let Some(investigation_y) = animal.investigation_y {
                        let distance_to_flee_target = get_distance_squared(
                            animal.pos_x, animal.pos_y,
                            investigation_x, investigation_y
                        );
                        
                        if distance_to_flee_target < 100.0 {
                            // Reached flee destination or close enough - return to patrol
                            animal.state = AnimalState::Patrolling;
                            animal.target_player_id = None;
                            animal.investigation_x = None;
                            animal.investigation_y = None;
                            animal.state_change_time = current_time;
                            log::debug!("Tundra Wolf {} finished fleeing - returning to patrol", animal.id);
                        }
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
        // Store previous position to detect if stuck
        let prev_x = animal.pos_x;
        let prev_y = animal.pos_y;
        
        // Pick a random direction to flee (don't return to spawn)
        if animal.investigation_x.is_none() || animal.investigation_y.is_none() {
            let flee_angle = rng.gen::<f32>() * 2.0 * PI;
            let flee_distance = 400.0 + (rng.gen::<f32>() * 300.0); // 8-14m flee
            animal.investigation_x = Some(animal.pos_x + flee_distance * flee_angle.cos());
            animal.investigation_y = Some(animal.pos_y + flee_distance * flee_angle.sin());
        }
        
        if let (Some(target_x), Some(target_y)) = (animal.investigation_x, animal.investigation_y) {
            move_towards_target(ctx, animal, target_x, target_y, stats.sprint_speed, dt);
            
            // Check if stuck on water or obstacle
            let movement_threshold = 8.0;
            let distance_moved = ((animal.pos_x - prev_x).powi(2) + (animal.pos_y - prev_y).powi(2)).sqrt();
            
            if distance_moved < movement_threshold {
                // Stuck! Pick new flee direction
                let new_angle = rng.gen::<f32>() * 2.0 * PI;
                let flee_distance = 400.0;
                animal.investigation_x = Some(animal.pos_x + flee_distance * new_angle.cos());
                animal.investigation_y = Some(animal.pos_y + flee_distance * new_angle.sin());
                log::debug!("Tundra Wolf {} stuck while fleeing - picking new direction", animal.id);
            }
            
            // Check if reached flee destination or fled long enough
            let distance_to_target = get_distance_squared(animal.pos_x, animal.pos_y, target_x, target_y).sqrt();
            let time_fleeing = current_time.to_micros_since_unix_epoch() - animal.state_change_time.to_micros_since_unix_epoch();
            
            if distance_to_target <= 80.0 || time_fleeing > 4_000_000 { // 4 seconds max flee
                animal.state = AnimalState::Patrolling;
                animal.target_player_id = None;
                animal.investigation_x = None;
                animal.investigation_y = None;
                animal.state_change_time = current_time;
                log::debug!("Tundra Wolf {} finished fleeing - continuing patrol", animal.id);
            }
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
        
        // Random wandering with pauses
        if rng.gen::<f32>() < 0.12 { // 12% chance to change direction
            let angle = rng.gen::<f32>() * 2.0 * PI;
            animal.direction_x = angle.cos();
            animal.direction_y = angle.sin();
        }
        
        let target_x = animal.pos_x + animal.direction_x * stats.movement_speed * dt;
        let target_y = animal.pos_y + animal.direction_y * stats.movement_speed * dt;
        
        // Avoid water and shelters (removed spawn radius restriction)
        if !is_water_tile(ctx, target_x, target_y) && 
           !super::core::is_position_in_shelter(ctx, target_x, target_y) {
            
            let mut final_x = target_x;
            let mut final_y = target_y;
            
            // Check for collisions before moving
            if let Some((pushback_x, pushback_y)) = check_animal_collision(ctx, animal.id, target_x, target_y) {
                final_x = animal.pos_x + pushback_x;
                final_y = animal.pos_y + pushback_y;
                log::debug!("Wandering wolf {} pushed back by other animal: ({:.1}, {:.1})", animal.id, pushback_x, pushback_y);
            }
            
            animal.pos_x = final_x;
            animal.pos_y = final_y;
            
            // Check if stuck (water detection)
            let movement_threshold = 5.0;
            let distance_moved = ((animal.pos_x - prev_x).powi(2) + (animal.pos_y - prev_y).powi(2)).sqrt();
            
            if distance_moved < movement_threshold {
                // Stuck! Pick new random direction
                let new_angle = rng.gen::<f32>() * 2.0 * PI;
                animal.direction_x = new_angle.cos();
                animal.direction_y = new_angle.sin();
                log::debug!("Tundra Wolf {} stuck during patrol - changing direction", animal.id);
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
        
        // Wolves are aggressive apex predators - chase any player in range
        distance_sq <= stats.chase_trigger_range.powi(2) && 
        animal.health > stats.max_health * 0.2 // Only need 20% health to be aggressive
    }

    fn handle_damage_response(
        &self,
        _ctx: &ReducerContext,
        animal: &mut WildAnimal,
        _attacker: &Player,
        stats: &AnimalStats,
        current_time: Timestamp,
        rng: &mut impl Rng,
    ) -> Result<(), String> {
        let health_percent = animal.health / stats.max_health;
        
        // Wolves only flee when critically wounded
        if health_percent < stats.flee_trigger_health_percent {
            animal.state = AnimalState::Fleeing;
            animal.target_player_id = None;
            animal.state_change_time = current_time;
            log::info!("Tundra Wolf {} fleeing due to low health ({:.1}%)", 
                      animal.id, health_percent * 100.0);
        }
        
        Ok(())
    }
} 