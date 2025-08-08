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
    move_towards_target, can_attack, transition_to_state, 
    emit_species_sound, get_player_distance, is_player_in_chase_range, set_flee_destination_away_from_threat,
    handle_fire_trap_escape, is_animal_cornered, detect_and_handle_stuck_movement, handle_water_unstuck,
    update_animal_position,
};

pub struct CinderFoxBehavior;

impl AnimalBehavior for CinderFoxBehavior {
    fn get_stats(&self) -> AnimalStats {
        AnimalStats {
            max_health: 200.0, // 2 bow shots to kill
            attack_damage: 20.0, // Increased damage for aggressive hit-and-run
            attack_range: 72.0, // INCREASED from 40.0 - larger melee range like wolf
            attack_speed_ms: 600, // Much faster attacks (was 800ms)
            movement_speed: 188.0, // Patrol speed - slow and manageable  
            sprint_speed: 465.0, // INCREASED: Faster than walking (400) but slower than sprinting (800)
            perception_range: 600.0, // INCREASED from 400.0 - much better vision for early detection
            perception_angle_degrees: 220.0, // INCREASED from 180.0 - even wider field of view for safety
            patrol_radius: 180.0, // 6m patrol loop
            chase_trigger_range: 240.0, // INCREASED: Foxes are more aggressive hunters
            flee_trigger_health_percent: 0.1, // Only flee when critically wounded (10%)
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
            set_flee_destination_away_from_threat(animal, target_player.position_x, target_player.position_y, 640.0, rng);
            animal.state = AnimalState::Fleeing;
            animal.target_player_id = None;
            animal.state_change_time = current_time;
            
            // Fox jumps back after attack
            let jump_distance = 80.0;
            let dx = animal.pos_x - target_player.position_x;
            let dy = animal.pos_y - target_player.position_y;
            let distance = (dx * dx + dy * dy).sqrt();
            if distance > 0.0 {
                let new_x = animal.pos_x + (dx / distance) * jump_distance;
                let new_y = animal.pos_y + (dy / distance) * jump_distance;
                
                // Use centralized position update function
                update_animal_position(animal, new_x, new_y);
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
        // 🔥 FIRE TRAP ESCAPE LOGIC - Use centralized escape handler
        if let Some(player) = detected_player {
            if handle_fire_trap_escape(ctx, animal, player, current_time, rng) {
                return Ok(()); // Fire trap escape initiated - skip normal AI logic
            }
        }

        match animal.state {
            AnimalState::Patrolling => {
                if let Some(player) = detected_player {
                    let distance_to_player = get_player_distance(animal, player);
                    
                    // Fire fear is now handled by the new simplified logic in update_animal_ai_state
                    // No need for separate fire detection here
                    
                                if is_animal_cornered(animal, player, 480.0) { // INCREASED: Cornered distance proportional to new chase range
                // Too close! Fox feels cornered and attacks even healthy players
                transition_to_state(animal, AnimalState::Chasing, current_time, Some(player.identity), "cornered attack");
                        
                        // 🔊 FOX GROWL: Emit desperate growl when cornered
                        emit_species_sound(ctx, animal, player.identity, "cornered");
                        
                        log::info!("Fox {} CORNERED! Attacking player {} at close range ({:.1}px) regardless of health ({:.1})", 
                                   animal.id, player.identity, distance_to_player, player.health);
                    } else {
                        // Normal behavior: Make decision based on player health
                        if player.health >= (crate::player_stats::PLAYER_MAX_HEALTH * 0.4) {
                            // Healthy player = FLEE IMMEDIATELY AND COMMIT
                            set_flee_destination_away_from_threat(animal, player.position_x, player.position_y, 640.0, rng);
                            transition_to_state(animal, AnimalState::Fleeing, current_time, None, "healthy player flee");
                            log::info!("Fox {} COMMITTED TO FLEEING from healthy player {} (health: {:.1}) at distance {:.1}px", 
                                       animal.id, player.identity, player.health, distance_to_player);
                        } else {
                            // Weak player = ATTACK IMMEDIATELY AND COMMIT
                            transition_to_state(animal, AnimalState::Chasing, current_time, Some(player.identity), "weak player attack");
                            
                            // 🔊 FOX GROWL: Emit aggressive growl when starting to attack weak player
                            emit_species_sound(ctx, animal, player.identity, "attack_weak");
                            
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
                        // Only stop chasing if player gets too far away
                        let distance = get_player_distance(animal, &target_player);
                        if distance > (stats.chase_trigger_range * 2.0) { // Increased commitment range
                            transition_to_state(animal, AnimalState::Patrolling, current_time, None, "player escaped");
                            log::debug!("Fox {} stopping chase - player escaped too far", animal.id);
                        }
                        // NO health re-evaluation - fox is committed to the attack!
                    } else {
                        // Target lost
                        transition_to_state(animal, AnimalState::Patrolling, current_time, None, "target lost");
                    }
                }
            },
            
            AnimalState::Fleeing => {
                // Check for cornered animal override even while fleeing
                if let Some(player) = detected_player {
                    let distance_to_player = get_player_distance(animal, player);
                    
                    // Fire fear is now handled by the unified system - INCREASED cornered distance
                    let cornered_distance = 360.0; // Proportional to new chase range
                    
                    if is_animal_cornered(animal, player, cornered_distance) {
                        // Player got too close while fleeing - turn and fight!
                        transition_to_state(animal, AnimalState::Chasing, current_time, Some(player.identity), "cornered while fleeing");
                        animal.investigation_x = None; // Clear flee destination
                        animal.investigation_y = None;
                        
                        // 🔊 FOX GROWL: Emit desperate growl when cornered while fleeing
                        emit_species_sound(ctx, animal, player.identity, "cornered_fleeing");
                        
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
                        transition_to_state(animal, AnimalState::Patrolling, current_time, None, "reached flee destination");
                        log::debug!("Fox {} reached flee destination, continuing patrol", animal.id);
                    }
                } else {
                    // No specific flee target - timeout and continue patrolling
                    let time_since_flee = current_time.to_micros_since_unix_epoch() - 
                                         animal.state_change_time.to_micros_since_unix_epoch();
                    
                    // Return to patrol after timeout (removed spawn distance check)
                    if time_since_flee > 3_000_000 { // 3 seconds timeout
                        transition_to_state(animal, AnimalState::Patrolling, current_time, None, "flee timeout");
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
            
            // WATER UNSTUCK LOGIC: Use centralized handler
            handle_water_unstuck(ctx, animal, target_x, target_y, prev_x, prev_y, 5.0, 640.0, rng);
            
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
            
            // Check if stuck - use centralized handler
            detect_and_handle_stuck_movement(animal, prev_x, prev_y, 3.0, rng, "patrol");
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
        // 🦊 SMART FOX DAMAGE RESPONSE: Foxes assess threats intelligently
        let health_percent = animal.health / stats.max_health;
        let threat_level = super::core::assess_player_threat_level(attacker);
        
        if health_percent < 0.4 || matches!(threat_level, super::core::PlayerThreatLevel::Healthy | super::core::PlayerThreatLevel::Moderate) {
            // Low health or healthy attacker - flee
            set_flee_destination_away_from_threat(animal, attacker.position_x, attacker.position_y, 320.0, rng);
            transition_to_state(animal, AnimalState::Fleeing, current_time, None, "tactical retreat");
            
            log::info!("Cinder Fox {} tactically retreating from threat (Health: {:.1}%, Threat: {:?})", 
                      animal.id, health_percent * 100.0, threat_level);
        } else {
            // Weak or critical attacker - counter-attack
            transition_to_state(animal, AnimalState::Chasing, current_time, Some(attacker.identity), "fox counter-attack");
            emit_species_sound(ctx, animal, attacker.identity, "retaliation");
            
            log::info!("Cinder Fox {} counter-attacking weak target (Health: {:.1}%, Threat: {:?})", 
                      animal.id, health_percent * 100.0, threat_level);
        }
        
        Ok(())
    }
    
    fn can_be_tamed(&self) -> bool {
        false // Foxes are currently not tameable (could be implemented in future)
    }
    
    fn get_taming_foods(&self) -> Vec<&'static str> {
        vec![] // No taming foods for foxes yet
    }
    
    fn get_chase_abandonment_multiplier(&self) -> f32 {
        2.8 // Foxes are moderately persistent - give up at 2.8x chase trigger range
    }
}

 