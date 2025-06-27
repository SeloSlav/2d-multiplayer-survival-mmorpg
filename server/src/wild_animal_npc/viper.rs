/******************************************************************************
 *                                                                            *
 * Cable Viper Behavior - Ambush Predator with Persistent Venom & Spittle    *
 *                                                                            *
 * Vipers are slow ambush predators that burrow and teleport. They inject    *
 * persistent venom that requires Anti-Venom to cure and can strike from     *
 * long range with lightning-fast dashes. When facing ranged weapons, they   *
 * use spittle projectiles and strafe to avoid being hit.                    *
 *                                                                            *
 ******************************************************************************/

use spacetimedb::{ReducerContext, Identity, Timestamp, Table, TimeDuration};
use std::f32::consts::PI;
use rand::Rng;
use log;

use crate::{Player};
use crate::utils::get_distance_squared;

// Table trait imports
use crate::player as PlayerTableTrait;
use crate::active_equipment::active_equipment as ActiveEquipmentTableTrait;
use crate::items::item_definition as ItemDefinitionTableTrait;
use super::core::{
    AnimalBehavior, AnimalStats, AnimalState, MovementPattern, WildAnimal,
    move_towards_target, can_attack
};

pub struct CableViperBehavior;

// Viper spittle projectile table
#[spacetimedb::table(name = viper_spittle, public)]
#[derive(Clone, Debug)]
pub struct ViperSpittle {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub viper_id: u64,
    pub target_player_id: Identity,
    pub start_time: Timestamp,
    pub start_pos_x: f32,
    pub start_pos_y: f32,
    pub velocity_x: f32,
    pub velocity_y: f32,
    pub max_range: f32,
}

// Scheduled table for spittle updates
#[spacetimedb::table(name = viper_spittle_update_schedule, scheduled(update_viper_spittle))]
#[derive(Clone, Debug)]
pub struct ViperSpittleUpdateSchedule {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub scheduled_at: spacetimedb::ScheduleAt,
}

pub trait ViperBehavior {
    fn enter_burrowed_state(
        animal: &mut WildAnimal,
        stats: &AnimalStats,
        current_time: Timestamp,
        rng: &mut impl Rng,
    );
    
    fn fire_spittle_projectile(
        ctx: &ReducerContext,
        animal: &WildAnimal,
        target_player: &Player,
        current_time: Timestamp,
    ) -> Result<(), String>;
    
    fn player_has_ranged_weapon(
        ctx: &ReducerContext,
        player_id: Identity,
    ) -> bool;
}

impl ViperBehavior for CableViperBehavior {
    fn enter_burrowed_state(
        animal: &mut WildAnimal,
        stats: &AnimalStats,
        current_time: Timestamp,
        rng: &mut impl Rng,
    ) {
        animal.state = AnimalState::Burrowed;
        
        // FIXED: Much shorter burrow time (1-2 seconds instead of 20 seconds)
        let burrow_duration_ms = 1000 + (rng.gen::<f32>() * 1000.0) as i64; // 1-2 seconds
        animal.hide_until = Some(Timestamp::from_micros_since_unix_epoch(
            current_time.to_micros_since_unix_epoch() + (burrow_duration_ms * 1000)
        ));
        
        // FIXED: Teleport much closer (3-6m away instead of 10-15m)
        let respawn_distance = 150.0 + (150.0 * rng.gen::<f32>()); // 3-6m (150-300 pixels)
        let angle = rng.gen::<f32>() * 2.0 * PI;
        animal.pos_x = animal.spawn_x + respawn_distance * angle.cos();
        animal.pos_y = animal.spawn_y + respawn_distance * angle.sin();
        
        log::info!("Cable Viper {} burrowed for {:.1}s and teleported {:.1}m away", 
                   animal.id, burrow_duration_ms as f32 / 1000.0, respawn_distance / 50.0);
    }
    
    fn fire_spittle_projectile(
        ctx: &ReducerContext,
        animal: &WildAnimal,
        target_player: &Player,
        current_time: Timestamp,
    ) -> Result<(), String> {
        // Calculate direction to player
        let dx = target_player.position_x - animal.pos_x;
        let dy = target_player.position_y - animal.pos_y;
        let distance = (dx * dx + dy * dy).sqrt();
        
        if distance < 1.0 {
            return Err("Target too close for spittle".to_string());
        }
        
        // Spittle projectile speed
        const SPITTLE_SPEED: f32 = 600.0; // Slower than arrows but faster than player
        let velocity_x = (dx / distance) * SPITTLE_SPEED;
        let velocity_y = (dy / distance) * SPITTLE_SPEED;
        
        // Create spittle projectile
        let spittle = ViperSpittle {
            id: 0, // auto_inc
            viper_id: animal.id,
            target_player_id: target_player.identity,
            start_time: current_time,
            start_pos_x: animal.pos_x,
            start_pos_y: animal.pos_y,
            velocity_x,
            velocity_y,
            max_range: 400.0, // 8m range
        };
        
        ctx.db.viper_spittle().insert(spittle);
        log::info!("Cable Viper {} fired spittle at player {:?}", animal.id, target_player.identity);
        Ok(())
    }
    
    fn player_has_ranged_weapon(
        ctx: &ReducerContext,
        player_id: Identity,
    ) -> bool {
        if let Some(equipment) = ctx.db.active_equipment().player_identity().find(&player_id) {
            if let Some(item_def_id) = equipment.equipped_item_def_id {
                if let Some(item_def) = ctx.db.item_definition().id().find(item_def_id) {
                    return item_def.name == "Hunting Bow" || item_def.name == "Crossbow";
                }
            }
        }
        false
    }
}

impl AnimalBehavior for CableViperBehavior {
    fn get_stats(&self) -> AnimalStats {
        AnimalStats {
            max_health: 200.0, // 2-3 bow shots to kill
            attack_damage: 30.0, // Higher venom damage
            attack_range: 120.0, // Longer strike range - 4m dash
            attack_speed_ms: 1500, // Slower but devastating strikes
            movement_speed: 60.0,  // Very slow movement (ambush predator)
            sprint_speed: 400.0,   // Lightning fast dash when attacking
            perception_range: 300.0, // INCREASED: Better detection for ranged combat
            perception_angle_degrees: 360.0, // Vibration sensing
            patrol_radius: 60.0, // 2m figure-eight
            chase_trigger_range: 250.0, // INCREASED: Longer range for spittle attacks
            flee_trigger_health_percent: 0.7, // Flees when injured (70%)
            hide_duration_ms: 2000, // FIXED: Much shorter burrow time (2 seconds max)
        }
    }

    fn get_movement_pattern(&self) -> MovementPattern {
        MovementPattern::FigureEight
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
        
        // Apply persistent venom damage over time (lasts until cured with Anti-Venom)
        if let Err(e) = crate::active_effects::apply_venom_effect(
            ctx,
            target_player.identity,
            f32::MAX, // Infinite damage pool - will only be stopped by Anti-Venom
            86400.0 * 365.0, // Duration: 1 year (effectively permanent until cured)
            5.0   // Tick every 5 seconds for slow but steady damage
        ) {
            log::error!("Failed to apply persistent venom effect from viper strike: {}", e);
        } else {
            log::info!("Cable Viper {} injects deadly persistent venom into player {}! Only Anti-Venom can cure this.", animal.id, target_player.identity);
        }
        
        // Viper immediately burrows after strike (ambush predator)
        Self::enter_burrowed_state(animal, stats, current_time, rng);
        animal.target_player_id = None;
        
        log::info!("Cable Viper {} strikes and burrows!", animal.id);
        
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
                    let distance_sq = get_distance_squared(
                        animal.pos_x, animal.pos_y,
                        player.position_x, player.position_y
                    );
                    let distance = distance_sq.sqrt();
                    
                    // NEW: Check if player has ranged weapon for spittle combat
                    let player_has_ranged = Self::player_has_ranged_weapon(ctx, player.identity);
                    
                    if player_has_ranged && distance <= 300.0 && distance > 120.0 {
                        // Player has ranged weapon and is in spittle range but not melee range
                        animal.state = AnimalState::Investigating; // Use investigating state for spittle combat
                        animal.target_player_id = Some(player.identity);
                        animal.state_change_time = current_time;
                        
                        // Set investigation position for strafing (perpendicular to player)
                        let angle_to_player = (player.position_y - animal.pos_y).atan2(player.position_x - animal.pos_x);
                        let strafe_angle = angle_to_player + PI / 2.0; // 90 degrees perpendicular
                        let strafe_distance = 100.0; // 2m strafe distance
                        animal.investigation_x = Some(animal.pos_x + strafe_distance * strafe_angle.cos());
                        animal.investigation_y = Some(animal.pos_y + strafe_distance * strafe_angle.sin());
                        
                        log::info!("Cable Viper {} detected ranged weapon - entering spittle combat mode", animal.id);
                    } else if distance <= stats.attack_range {
                        // Close enough to strike - transition to chasing for melee attack
                        animal.state = AnimalState::Chasing;
                        animal.target_player_id = Some(player.identity);
                        animal.state_change_time = current_time;
                        log::debug!("Cable Viper {} in strike range - entering melee attack mode", animal.id);
                    } else if distance <= stats.chase_trigger_range {
                        // Not in strike range, start chasing to get closer
                        animal.state = AnimalState::Chasing;
                        animal.target_player_id = Some(player.identity);
                        animal.state_change_time = current_time;
                        log::debug!("Cable Viper {} stalking player {}", animal.id, player.identity);
                    }
                }
            },
            
            AnimalState::Investigating => {
                // NEW: Spittle combat mode with strafing
                if let Some(target_id) = animal.target_player_id {
                    if let Some(target_player) = ctx.db.player().identity().find(&target_id) {
                        let distance_sq = get_distance_squared(
                            animal.pos_x, animal.pos_y,
                            target_player.position_x, target_player.position_y
                        );
                        let distance = distance_sq.sqrt();
                        
                        // Check if player still has ranged weapon
                        let player_has_ranged = Self::player_has_ranged_weapon(ctx, target_player.identity);
                        
                        if !player_has_ranged || distance > 350.0 {
                            // Player no longer has ranged weapon or moved too far - return to patrol
                            animal.state = AnimalState::Patrolling;
                            animal.target_player_id = None;
                            animal.investigation_x = None;
                            animal.investigation_y = None;
                            animal.state_change_time = current_time;
                            log::debug!("Cable Viper {} ending spittle combat - returning to patrol", animal.id);
                        } else if distance <= 120.0 {
                            // Player got too close - switch to melee
                            animal.state = AnimalState::Chasing;
                            animal.investigation_x = None;
                            animal.investigation_y = None;
                            animal.state_change_time = current_time;
                            log::debug!("Cable Viper {} switching to melee - player too close", animal.id);
                        } else {
                            // Fire spittle every 2 seconds and continue strafing
                            let time_since_state_change = current_time.to_micros_since_unix_epoch() - animal.state_change_time.to_micros_since_unix_epoch();
                            if time_since_state_change >= 2_000_000 { // 2 seconds
                                if let Err(e) = Self::fire_spittle_projectile(ctx, animal, &target_player, current_time) {
                                    log::error!("Failed to fire spittle: {}", e);
                                }
                                animal.state_change_time = current_time; // Reset timer
                                
                                // Update strafe position (switch direction)
                                let angle_to_player = (target_player.position_y - animal.pos_y).atan2(target_player.position_x - animal.pos_x);
                                let strafe_angle = angle_to_player + if rng.gen::<bool>() { PI / 2.0 } else { -PI / 2.0 };
                                let strafe_distance = 100.0;
                                animal.investigation_x = Some(animal.pos_x + strafe_distance * strafe_angle.cos());
                                animal.investigation_y = Some(animal.pos_y + strafe_distance * strafe_angle.sin());
                            }
                        }
                    } else {
                        // Target lost
                        animal.state = AnimalState::Patrolling;
                        animal.target_player_id = None;
                        animal.investigation_x = None;
                        animal.investigation_y = None;
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
                        
                        // Core system handles attacks when in range - just check if should stop chasing
                        if distance_sq > (stats.chase_trigger_range * 1.2).powi(2) {
                            animal.state = AnimalState::Patrolling;
                            animal.target_player_id = None;
                            animal.state_change_time = current_time;
                            log::debug!("Cable Viper {} returning to ambush position - player out of range", animal.id);
                        }
                    } else {
                        // Target lost
                        animal.state = AnimalState::Patrolling;
                        animal.target_player_id = None;
                        animal.state_change_time = current_time;
                    }
                }
            },
            
            AnimalState::Fleeing => {
                // Vipers burrow immediately when fleeing
                Self::enter_burrowed_state(animal, stats, current_time, rng);
            },
            
            _ => {} // Other states handled by core system
        }
        
        Ok(())
    }

    fn execute_flee_logic(
        &self,
        _ctx: &ReducerContext,
        animal: &mut WildAnimal,
        stats: &AnimalStats,
        dt: f32,
        current_time: Timestamp,
        rng: &mut impl Rng,
    ) {
        // Immediate burrow when fleeing
        Self::enter_burrowed_state(animal, stats, current_time, rng);
    }

    fn execute_patrol_logic(
        &self,
        ctx: &ReducerContext,
        animal: &mut WildAnimal,
        stats: &AnimalStats,
        dt: f32,
        rng: &mut impl Rng,
    ) {
        // Figure-eight pattern
        animal.patrol_phase += dt * 0.5;
        if animal.patrol_phase >= 2.0 * PI {
            animal.patrol_phase -= 2.0 * PI;
        }
        
        let t = animal.patrol_phase;
        let scale = stats.patrol_radius * 0.5;
        let target_x = animal.spawn_x + scale * (2.0 * t).sin();
        let target_y = animal.spawn_y + scale * t.sin();
        
        // Check if target position is safe (avoid shelters and water)
        if !super::core::is_position_in_shelter(ctx, target_x, target_y) &&
           !crate::fishing::is_water_tile(ctx, target_x, target_y) {
            move_towards_target(ctx, animal, target_x, target_y, stats.movement_speed, dt);
        } else {
            // If target position is blocked, skip ahead in the patrol phase
            animal.patrol_phase += dt * 0.3; // Move faster to find clear space
        }
    }

    fn should_chase_player(&self, animal: &WildAnimal, stats: &AnimalStats, _player: &Player) -> bool {
        let distance_sq = get_distance_squared(
            animal.pos_x, animal.pos_y,
            _player.position_x, _player.position_y
        );
        
        // Vipers are ambush predators - attack when in range
        distance_sq <= stats.chase_trigger_range.powi(2)
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
        
        // Vipers flee when injured (70% threshold)
        if health_percent < stats.flee_trigger_health_percent {
            Self::enter_burrowed_state(animal, stats, current_time, rng);
            log::info!("Cable Viper {} burrowing due to injury ({:.1}% health)", 
                      animal.id, health_percent * 100.0);
        }
        
        Ok(())
    }
}

// Initialize the spittle projectile system
#[spacetimedb::reducer]
pub fn init_viper_spittle_system(ctx: &ReducerContext) -> Result<(), String> {
    // Only schedule if not already scheduled
    let schedule_table = ctx.db.viper_spittle_update_schedule();
    if schedule_table.iter().count() == 0 {
        // Schedule spittle collision detection every 50ms (same as regular projectiles)
        let update_interval = TimeDuration::from_micros(50_000); // 50ms
        schedule_table.insert(ViperSpittleUpdateSchedule {
            id: 0, // auto_inc
            scheduled_at: update_interval.into(),
        });
        log::info!("Viper spittle projectile system initialized with 50ms updates");
    }
    Ok(())
}

// Update viper spittle projectiles
#[spacetimedb::reducer]
pub fn update_viper_spittle(ctx: &ReducerContext, _args: ViperSpittleUpdateSchedule) -> Result<(), String> {
    // Security check - only allow scheduler to call this
    if ctx.sender != ctx.identity() {
        return Err("Only the scheduler can update viper spittle".to_string());
    }

    let current_time = ctx.timestamp;
    let mut spittles_to_delete = Vec::new();

    for spittle in ctx.db.viper_spittle().iter() {
        let start_time_secs = spittle.start_time.to_micros_since_unix_epoch() as f64 / 1_000_000.0;
        let current_time_secs = current_time.to_micros_since_unix_epoch() as f64 / 1_000_000.0;
        let elapsed_time = current_time_secs - start_time_secs;
        
        // Calculate current position (straight line, no gravity)
        let current_x = spittle.start_pos_x + spittle.velocity_x * elapsed_time as f32;
        let current_y = spittle.start_pos_y + spittle.velocity_y * elapsed_time as f32;
        
        // Calculate previous position for collision detection
        let prev_time = (elapsed_time - 0.05).max(0.0); // 50ms ago
        let prev_x = spittle.start_pos_x + spittle.velocity_x * prev_time as f32;
        let prev_y = spittle.start_pos_y + spittle.velocity_y * prev_time as f32;
        
        let travel_distance = ((current_x - spittle.start_pos_x).powi(2) + (current_y - spittle.start_pos_y).powi(2)).sqrt();
        
        // Check if spittle has reached max range or time limit
        if travel_distance > spittle.max_range || elapsed_time > 5.0 {
            spittles_to_delete.push(spittle.id);
            continue;
        }

        // Check player collision (only target player)
        if let Some(target_player) = ctx.db.player().identity().find(&spittle.target_player_id) {
            if !target_player.is_dead {
                let player_radius = crate::PLAYER_RADIUS;
                let collision_detected = crate::projectile::line_intersects_circle(
                    prev_x, prev_y, current_x, current_y, 
                    target_player.position_x, target_player.position_y, 
                    player_radius
                );
                
                if collision_detected {
                    log::info!("Viper spittle {} hit player {:?}", spittle.id, target_player.identity);
                    
                    // Apply venom effect (lighter than bite)
                    if let Err(e) = crate::active_effects::apply_venom_effect(
                        ctx,
                        target_player.identity,
                        20.0, // 20 total damage (much less than bite)
                        15.0, // 15 seconds duration
                        3.0   // Tick every 3 seconds
                    ) {
                        log::error!("Failed to apply venom effect from spittle: {}", e);
                    } else {
                        log::info!("Viper spittle applied light venom to player {:?}", target_player.identity);
                    }
                    
                    spittles_to_delete.push(spittle.id);
                    continue;
                }
            }
        }
    }

    // Delete all spittles that need to be removed
    for spittle_id in spittles_to_delete {
        ctx.db.viper_spittle().id().delete(&spittle_id);
    }

    Ok(())
} 