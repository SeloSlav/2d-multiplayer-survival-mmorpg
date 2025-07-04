/******************************************************************************
 *                                                                            *
 * Tundra Wolf Behavior - Aggressive Apex Predator with Pack Dynamics       *
 *                                                                            *
 * Wolves are aggressive pack hunters that pursue any player in range.       *
 * They have strong attacks with bleeding effects, double strikes, and       *
 * brief resting periods after combat.                                       *
 *                                                                            *
 * 🐺 PACK BEHAVIOR:                                                          *
 * - Wolves spontaneously form packs when they encounter each other          *
 * - One alpha wolf leads each pack and controls movement direction           *
 * - Pack members follow the alpha during patrol/movement                     *
 * - Wolves randomly leave packs over time for dynamic pack changes          *
 * - IMPORTANT: Pack behavior does NOT affect combat/hunting behavior!       *
 *   All wolves still chase and attack players independently                 *
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
    AnimalBehavior, AnimalStats, AnimalState, MovementPattern, WildAnimal, AnimalSpecies,
    move_towards_target, can_attack, transition_to_state, emit_species_sound,
    is_player_in_chase_range, get_player_distance,
    execute_standard_patrol, wild_animal,
    set_flee_destination_away_from_threat,
    handle_fire_trap_escape, calculate_escape_angle_from_threats, detect_and_handle_stuck_movement,
    is_position_in_shelter, get_pack_alpha, should_follow_pack_alpha, get_pack_cohesion_movement,
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
            movement_speed: 201.0, // Patrol speed - slow and manageable
            sprint_speed: 450.0, // Noticeably faster than player walking (400) - wolves will catch walkers, force players to sprint
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
        // 🔥 FIRE TRAP ESCAPE LOGIC - Use centralized escape handler
        if let Some(player) = detected_player {
            if handle_fire_trap_escape(ctx, animal, player, current_time, rng) {
                return Ok(()); // Fire trap escape initiated - skip normal AI logic
            }
        }

        match animal.state {
            AnimalState::Patrolling => {
                if let Some(player) = detected_player {
                    // Fire fear is now handled by the new simplified logic in update_animal_ai_state
                    // No need for separate fire detection here
                    
                    // 🐺 PACK COMBAT: Wolves maintain aggressive behavior regardless of pack status
                    // Pack behavior does NOT interfere with hunting - all wolves chase independently
                    if self.should_chase_player(animal, stats, player) {
                        transition_to_state(animal, AnimalState::Chasing, current_time, Some(player.identity), "player in range");
                        
                        // 🔊 WOLF GROWL: Emit intimidating growl when starting to chase
                        emit_species_sound(ctx, animal, player.identity, "chase_start");
                        
                        // 🐺 PACK ALERT: If this wolf is in a pack, notify pack members about the threat
                        if let Some(pack_id) = animal.pack_id {
                            log::debug!("🐺 Pack wolf {} (pack {}) chasing player {} - pack hunt initiated!", 
                                      animal.id, pack_id, player.identity);
                        } else {
                            log::debug!("Solo Tundra Wolf {} immediately chasing player {}", animal.id, player.identity);
                        }
                    } else {
                        // If not chasing, briefly investigate
                        transition_to_state(animal, AnimalState::Alert, current_time, None, "investigating player");
                        animal.investigation_x = Some(player.position_x);
                        animal.investigation_y = Some(player.position_y);
                    }
                }
            },
            
            AnimalState::Chasing => {
                if let Some(target_id) = animal.target_player_id {
                    if let Some(target_player) = ctx.db.player().identity().find(&target_id) {
                        // Check if should stop chasing (wolves are VERY persistent)
                        if !is_player_in_chase_range(animal, &target_player, stats) {
                            let distance = get_player_distance(animal, &target_player);
                            if distance > stats.chase_trigger_range * 1.8 {
                                transition_to_state(animal, AnimalState::Patrolling, current_time, None, "player too far");
                                log::debug!("Tundra Wolf {} stopping chase - player too far", animal.id);
                            }
                        }
                    } else {
                        // Target lost
                        transition_to_state(animal, AnimalState::Patrolling, current_time, None, "target lost");
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
                                transition_to_state(animal, AnimalState::Chasing, current_time, Some(player.identity), "alert timeout - chase");
                                
                                // 🔊 WOLF GROWL: Emit intimidating growl when transitioning to chase
                                emit_species_sound(ctx, animal, player.identity, "alert_to_chase");
                                
                                log::debug!("Tundra Wolf {} transitioning from alert to chase", animal.id);
                            } else {
                                transition_to_state(animal, AnimalState::Patrolling, current_time, None, "alert timeout - patrol");
                            }
                        } else {
                            transition_to_state(animal, AnimalState::Patrolling, current_time, None, "alert timeout - no target");
                        }
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
                            transition_to_state(animal, AnimalState::Patrolling, current_time, None, "reached flee destination");
                            animal.investigation_x = None;
                            animal.investigation_y = None;
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
            
            // Check if stuck - use centralized handler
            if detect_and_handle_stuck_movement(animal, prev_x, prev_y, 8.0, rng, "fleeing") {
                // Update investigation target if direction changed
                let new_angle = animal.direction_y.atan2(animal.direction_x);
                let flee_distance = 400.0;
                animal.investigation_x = Some(animal.pos_x + flee_distance * new_angle.cos());
                animal.investigation_y = Some(animal.pos_y + flee_distance * new_angle.sin());
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
        // 🐺 PACK BEHAVIOR: Check if should follow pack alpha's movement
        if let Some(pack_id) = animal.pack_id {
            if !animal.is_pack_leader {
                if let Some(alpha) = super::core::get_pack_alpha(ctx, pack_id) {
                    if super::core::should_follow_pack_alpha(animal, &alpha) {
                        // Follow alpha's movement with pack cohesion
                        if let Some((cohesion_x, cohesion_y)) = super::core::get_pack_cohesion_movement(animal, &alpha) {
                            let target_x = animal.pos_x + cohesion_x * stats.movement_speed * dt;
                            let target_y = animal.pos_y + cohesion_y * stats.movement_speed * dt;
                            
                            // Avoid water and shelters while following alpha
                            if !is_water_tile(ctx, target_x, target_y) && 
                               !super::core::is_position_in_shelter(ctx, target_x, target_y) {
                                move_towards_target(ctx, animal, target_x, target_y, stats.movement_speed, dt);
                                log::debug!("Pack wolf {} following alpha {} towards ({:.1}, {:.1})", 
                                          animal.id, alpha.id, target_x, target_y);
                                return; // Skip solo wandering behavior
                            }
                        } else {
                            // Near alpha - mimic alpha's direction with slight variation
                            let variation_angle = (rng.gen::<f32>() - 0.5) * 0.5; // ±0.25 radian variation
                            let alpha_angle = alpha.direction_y.atan2(alpha.direction_x);
                            let follow_angle = alpha_angle + variation_angle;
                            
                            animal.direction_x = follow_angle.cos();
                            animal.direction_y = follow_angle.sin();
                            
                            log::debug!("Pack wolf {} mimicking alpha {}'s direction with variation", 
                                      animal.id, alpha.id);
                        }
                    }
                }
            }
        }
        
        // Store previous position to detect if stuck
        let prev_x = animal.pos_x;
        let prev_y = animal.pos_y;
        
        // 🐺 PACK ALPHA BEHAVIOR: Alphas lead the pack's movement
        if animal.is_pack_leader {
            // Alphas change direction less frequently but more decisively
            if rng.gen::<f32>() < 0.08 { // 8% chance to change direction (less than solo wolves)
                let angle = rng.gen::<f32>() * 2.0 * PI;
                animal.direction_x = angle.cos();
                animal.direction_y = angle.sin();
                log::debug!("Alpha wolf {} choosing new direction for pack", animal.id);
            }
        } else if animal.pack_id.is_none() {
            // Solo wolves: Random wandering with pauses
            if rng.gen::<f32>() < 0.12 { // 12% chance to change direction
                let angle = rng.gen::<f32>() * 2.0 * PI;
                animal.direction_x = angle.cos();
                animal.direction_y = angle.sin();
            }
        }
        // Pack followers already handled above
        
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
            
            // Check if stuck - use centralized handler
            detect_and_handle_stuck_movement(animal, prev_x, prev_y, 5.0, rng, "patrol");
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
        
        // 🐺 PACK INDEPENDENCE: Wolves chase players regardless of pack status
        // Pack behavior affects movement coordination, NOT hunting instincts
        // Each wolf in a pack will independently chase players they detect
        distance_sq <= stats.chase_trigger_range.powi(2) && 
        animal.health > stats.max_health * 0.2 // Only need 20% health to be aggressive
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
        // Wolves are aggressive and rarely back down
        let health_percent = animal.health / stats.max_health;
        
        if health_percent > 0.3 {
            // High health - retaliate aggressively
            transition_to_state(animal, AnimalState::Chasing, current_time, Some(attacker.identity), "wolf retaliation");
            emit_species_sound(ctx, animal, attacker.identity, "retaliation");
            
            log::info!("Tundra Wolf {} retaliating against attacker {} (Health: {:.1}%)", 
                      animal.id, attacker.identity, health_percent * 100.0);
        } else {
            // Low health - flee
            set_flee_destination_away_from_threat(animal, attacker.position_x, attacker.position_y, 400.0, rng);
            transition_to_state(animal, AnimalState::Fleeing, current_time, None, "low health flee");
            
            log::info!("Tundra Wolf {} fleeing due to low health ({:.1}%)", 
                      animal.id, health_percent * 100.0);
        }
        
        Ok(())
    }
    
    fn can_be_tamed(&self) -> bool {
        false // Wolves are currently not tameable (could be implemented in future with meat)
    }
    
    fn get_taming_foods(&self) -> Vec<&'static str> {
        vec![] // No taming foods for wolves yet (could add meat items later)
    }
}





 