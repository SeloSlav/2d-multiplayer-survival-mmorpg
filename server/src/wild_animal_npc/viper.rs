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
 use crate::combat; // Import combat system for damage_player
 use crate::items::{ItemDefinition, ItemCategory}; // Import item types
 
 // Table trait imports
 use crate::player as PlayerTableTrait;
 use crate::active_equipment::active_equipment as ActiveEquipmentTableTrait;
 use crate::items::item_definition as ItemDefinitionTableTrait;
 use super::core::{
     AnimalBehavior, AnimalStats, AnimalState, MovementPattern, WildAnimal, AnimalSpecies,
     move_towards_target, can_attack, transition_to_state,
     emit_species_sound, get_player_distance, is_player_in_chase_range, wild_animal,
     set_flee_destination_away_from_threat,
     execute_standard_patrol, player_has_ranged_weapon, detect_and_handle_stuck_movement,
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
     fn fire_spittle_projectile(
         ctx: &ReducerContext,
         animal: &WildAnimal,
         target_player: &Player,
         current_time: Timestamp,
     ) -> Result<(), String>;
 }
 
 impl ViperBehavior for CableViperBehavior {
     fn fire_spittle_projectile(
         ctx: &ReducerContext,
         animal: &WildAnimal,
         target_player: &Player,
         current_time: Timestamp,
     ) -> Result<(), String> {
         // Calculate direction to player with predictive aiming
         let dx = target_player.position_x - animal.pos_x;
         let dy = target_player.position_y - animal.pos_y;
         let distance = (dx * dx + dy * dy).sqrt();
         
         if distance < 1.0 {
             return Err("Target too close for spittle".to_string());
         }
         
         // ENHANCED: Faster, more accurate spittle against ranged users
         let player_has_ranged = player_has_ranged_weapon(ctx, target_player.identity);
         let base_speed = if player_has_ranged { 750.0 } else { 600.0 }; // Faster against bow users
         
         // Predictive aiming - anticipate player movement
         let player_speed = 150.0; // Assume average player speed
         let projectile_time = distance / base_speed;
         
         // Predict where player will be
         let predicted_x = target_player.position_x + (dx.signum() * player_speed * projectile_time * 0.7); // 70% prediction
         let predicted_y = target_player.position_y + (dy.signum() * player_speed * projectile_time * 0.7);
         
         // Calculate velocity toward predicted position
         let pred_dx = predicted_x - animal.pos_x;
         let pred_dy = predicted_y - animal.pos_y;
         let pred_distance = (pred_dx * pred_dx + pred_dy * pred_dy).sqrt();
         
         if pred_distance < 1.0 {
             return Err("Predicted target too close".to_string());
         }
         
         let velocity_x = (pred_dx / pred_distance) * base_speed;
         let velocity_y = (pred_dy / pred_distance) * base_speed;
         
         // ENHANCED: Longer range and more persistent projectiles against ranged users
         let max_range = if player_has_ranged { 500.0 } else { 400.0 }; // 10m vs 8m range
         
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
             max_range,
         };
         
         ctx.db.viper_spittle().insert(spittle);
         
         if player_has_ranged {
             log::info!("Cable Viper {} fired ENHANCED spittle (speed:{:.0}, range:{:.0}) at bow user {:?}", 
                       animal.id, base_speed, max_range, target_player.identity);
         } else {
             log::info!("Cable Viper {} fired spittle at player {:?}", animal.id, target_player.identity);
         }
         
         Ok(())
     }
     
 
 }
 
 impl AnimalBehavior for CableViperBehavior {
     fn get_stats(&self) -> AnimalStats {
         AnimalStats {
             max_health: 200.0, // 2-3 bow shots to kill
             attack_damage: 22.0, // Balanced melee damage (venom provides additional DOT)
             attack_range: 120.0, // Longer strike range - 4m dash
             attack_speed_ms: 1500, // Slower but devastating strikes
             movement_speed: 60.0,  // Very slow movement (ambush predator)
             sprint_speed: 400.0,   // Lightning fast dash when attacking
             perception_range: 400.0, // ENHANCED: Much longer detection for bow combat
             perception_angle_degrees: 360.0, // Vibration sensing
             patrol_radius: 60.0, // 2m figure-eight
             chase_trigger_range: 350.0, // ENHANCED: Extended range for spittle combat
             flee_trigger_health_percent: 0.1, // Only flees when critically wounded (10%)
             hide_duration_ms: 0, // REMOVED: No more burrowing behavior
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
         
         // REMOVED: No more burrowing after strike - vipers fight normally
         log::info!("Cable Viper {} strikes with venomous fangs!", animal.id);
         
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
                     let distance = super::core::get_player_distance(animal, player);
                     
                     let player_has_ranged = player_has_ranged_weapon(ctx, player.identity);
                     
                     log::debug!("Cable Viper {} evaluating player at {:.1}px - ranged weapon: {}", 
                                animal.id, distance, player_has_ranged);
                     
                     // IMPROVED: Better distance bounds and priority for spittle combat
                     let safe_distance = 125.0; // Base safe distance (no fire adjustment needed - handled by common system)
                     
                     if player_has_ranged && distance <= 350.0 && distance >= safe_distance {
                         // Player has ranged weapon and is in spittle range but not melee range
                         super::core::transition_to_state(animal, AnimalState::Investigating, current_time, Some(player.identity), "spittle combat mode");
                         
                         // Set investigation position for strafing (perpendicular to player)
                         let angle_to_player = (player.position_y - animal.pos_y).atan2(player.position_x - animal.pos_x);
                         let strafe_angle = angle_to_player + PI / 2.0; // 90 degrees perpendicular
                         let strafe_distance = 100.0; // 2m strafe distance
                         animal.investigation_x = Some(animal.pos_x + strafe_distance * strafe_angle.cos());
                         animal.investigation_y = Some(animal.pos_y + strafe_distance * strafe_angle.sin());
                         
                         log::info!("Cable Viper {} detected ranged weapon at {:.1}px - entering spittle combat mode", animal.id, distance);
                     } else if distance <= stats.attack_range && distance < safe_distance {
                         // Close enough to strike AND within safe distance - transition to chasing for melee attack
                         super::core::transition_to_state(animal, AnimalState::Chasing, current_time, Some(player.identity), "melee attack mode");
                         
                         // 🔊 SNAKE GROWL: Emit menacing hiss when entering strike range
                         super::core::emit_species_sound(ctx, animal, player.identity, "strike_range");
                         
                         log::debug!("Cable Viper {} in strike range - entering melee attack mode", animal.id);
                     } else if distance <= stats.chase_trigger_range {
                         // Not in strike range, start chasing to get closer
                         super::core::transition_to_state(animal, AnimalState::Chasing, current_time, Some(player.identity), "stalking");
                         
                         // 🔊 SNAKE GROWL: Emit threatening hiss when starting to stalk
                         super::core::emit_species_sound(ctx, animal, player.identity, "stalk");
                         
                         log::debug!("Cable Viper {} stalking player {}", animal.id, player.identity);
                     }
                 }
             },
             
             AnimalState::Investigating => {
                 // NEW: Aggressive spittle combat mode with enhanced strafing against ranged weapons
                 if let Some(target_id) = animal.target_player_id {
                     if let Some(target_player) = ctx.db.player().identity().find(&target_id) {
                         let distance_sq = get_distance_squared(
                             animal.pos_x, animal.pos_y,
                             target_player.position_x, target_player.position_y
                         );
                         let distance = distance_sq.sqrt();
                         
                         // Check if player still has ranged weapon
                         let player_has_ranged = player_has_ranged_weapon(ctx, target_player.identity);
                         
                         if distance > 450.0 {
                             // Player moved too far - return to patrol (removed ranged weapon check to be more persistent)
                             animal.state = AnimalState::Patrolling;
                             animal.target_player_id = None;
                             animal.investigation_x = None;
                             animal.investigation_y = None;
                             animal.state_change_time = current_time;
                             log::debug!("Cable Viper {} ending spittle combat - player too far", animal.id);
                         } else if distance < 125.0 {
                             // Player got too close - switch to melee
                             animal.state = AnimalState::Chasing;
                             animal.investigation_x = None;
                             animal.investigation_y = None;
                             animal.state_change_time = current_time;
                             
                             // 🔊 SNAKE GROWL: Emit aggressive hiss when switching to close combat
                             crate::sound_events::emit_snake_growl_sound(ctx, animal.pos_x, animal.pos_y, target_player.identity);
                             
                             log::debug!("Cable Viper {} switching to melee - player too close at {:.1}px", animal.id, distance);
                         } else {
                             // AGGRESSIVE: Fire spittle much more frequently against bow users
                             let spittle_interval = if player_has_ranged { 800_000 } else { 2_000_000 }; // 0.8s vs 2s
                             let time_since_state_change = current_time.to_micros_since_unix_epoch() - animal.state_change_time.to_micros_since_unix_epoch();
                             
                             if time_since_state_change >= spittle_interval {
                                 if let Err(e) = Self::fire_spittle_projectile(ctx, animal, &target_player, current_time) {
                                     log::error!("Failed to fire spittle: {}", e);
                                 } else {
                                     log::info!("Cable Viper {} rapid-firing spittle at bow user!", animal.id);
                                 }
                                 animal.state_change_time = current_time; // Reset timer
                                 
                                 // ENHANCED: More aggressive strafing pattern with prediction
                                 let angle_to_player = (target_player.position_y - animal.pos_y).atan2(target_player.position_x - animal.pos_x);
                                 
                                 // Calculate player movement prediction for better strafing
                                 let player_speed = 150.0; // Assume average player speed
                                 let predicted_time = distance / 600.0; // Time for spittle to reach player
                                 let predicted_player_x = target_player.position_x + (target_player.position_x - animal.pos_x).signum() * player_speed * predicted_time;
                                 let predicted_player_y = target_player.position_y + (target_player.position_y - animal.pos_y).signum() * player_speed * predicted_time;
                                 
                                 // Strafe perpendicular to predicted position with random variation
                                 let angle_to_predicted = (predicted_player_y - animal.pos_y).atan2(predicted_player_x - animal.pos_x);
                                 let strafe_variation = (rng.gen::<f32>() - 0.5) * 1.0; // ±30 degree variation
                                 let strafe_angle = angle_to_predicted + (PI / 2.0) + strafe_variation;
                                 
                                 // AGGRESSIVE: Larger, more unpredictable strafe distance
                                 let strafe_distance = 120.0 + (rng.gen::<f32>() * 80.0); // 2.4-4m strafe
                                 animal.investigation_x = Some(animal.pos_x + strafe_distance * strafe_angle.cos());
                                 animal.investigation_y = Some(animal.pos_y + strafe_distance * strafe_angle.sin());
                                 
                                 log::debug!("Cable Viper {} aggressive strafe: {:.1}px at angle {:.1}°", 
                                            animal.id, strafe_distance, strafe_angle.to_degrees());
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
                         let distance = super::core::get_player_distance(animal, &target_player);
                         
                         // Check for spittle opportunity - if player has ranged weapon and is at medium range
                         if distance > stats.attack_range && distance <= 350.0 && 
                            player_has_ranged_weapon(ctx, target_player.identity) {
                             super::core::transition_to_state(animal, AnimalState::Investigating, current_time, Some(target_player.identity), "switch to spittle");
                             log::debug!("Cable Viper {} switching from chase to spittle at {:.1}px", animal.id, distance);
                         }
                         
                         // Only stop chasing if player gets very far away
                         if distance > (stats.chase_trigger_range * 1.5) {
                             super::core::transition_to_state(animal, AnimalState::Patrolling, current_time, None, "player too far");
                             log::debug!("Cable Viper {} stopping chase - player too far", animal.id);
                         }
                     } else {
                         // Target lost
                         super::core::transition_to_state(animal, AnimalState::Patrolling, current_time, None, "target lost");
                     }
                 }
             },
             
             AnimalState::Investigating => {
                 // Spittle combat mode - strafe around player and spit
                 if let Some(target_id) = animal.target_player_id {
                     if let Some(target_player) = ctx.db.player().identity().find(&target_id) {
                         let distance = super::core::get_player_distance(animal, &target_player);
                         
                         // If player gets too close, switch to melee
                         if distance <= 125.0 {
                             super::core::transition_to_state(animal, AnimalState::Chasing, current_time, Some(target_player.identity), "too close - melee");
                             animal.investigation_x = None;
                             animal.investigation_y = None;
                             log::debug!("Cable Viper {} switching to melee - player too close", animal.id);
                         }
                         // If player gets too far, return to patrol
                         else if distance > 400.0 {
                             super::core::transition_to_state(animal, AnimalState::Patrolling, current_time, None, "player too far");
                             animal.investigation_x = None;
                             animal.investigation_y = None;
                             log::debug!("Cable Viper {} ending spittle combat - player too far", animal.id);
                         }
                         // Continue spittle combat if player doesn't have ranged weapon anymore
                         else if !player_has_ranged_weapon(ctx, target_player.identity) {
                             super::core::transition_to_state(animal, AnimalState::Chasing, current_time, Some(target_player.identity), "no ranged weapon");
                             animal.investigation_x = None;
                             animal.investigation_y = None;
                             log::debug!("Cable Viper {} switching to chase - player no longer has ranged weapon", animal.id);
                         }
                     }
                 } else {
                     // No target - return to patrol
                     super::core::transition_to_state(animal, AnimalState::Patrolling, current_time, None, "no target");
                     animal.investigation_x = None;
                     animal.investigation_y = None;
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
                             // Reached flee destination - return to patrol
                             super::core::transition_to_state(animal, AnimalState::Patrolling, current_time, None, "reached flee destination");
                             animal.investigation_x = None;
                             animal.investigation_y = None;
                             log::debug!("Cable Viper {} finished fleeing - returning to patrol", animal.id);
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
             let flee_distance = 300.0 + (rng.gen::<f32>() * 200.0); // 6-10m flee
             animal.investigation_x = Some(animal.pos_x + flee_distance * flee_angle.cos());
             animal.investigation_y = Some(animal.pos_y + flee_distance * flee_angle.sin());
         }
         
         if let (Some(target_x), Some(target_y)) = (animal.investigation_x, animal.investigation_y) {
             move_towards_target(ctx, animal, target_x, target_y, stats.sprint_speed, dt);
             
             // Check if stuck - use centralized handler
             if detect_and_handle_stuck_movement(animal, prev_x, prev_y, 5.0, rng, "fleeing") {
                 // Update investigation target if direction changed
                 let new_angle = animal.direction_y.atan2(animal.direction_x);
                 let flee_distance = 300.0;
                 animal.investigation_x = Some(animal.pos_x + flee_distance * new_angle.cos());
                 animal.investigation_y = Some(animal.pos_y + flee_distance * new_angle.sin());
             }
             
             // Check if reached flee destination or fled long enough
             let distance_to_target = get_distance_squared(animal.pos_x, animal.pos_y, target_x, target_y).sqrt();
             let time_fleeing = current_time.to_micros_since_unix_epoch() - animal.state_change_time.to_micros_since_unix_epoch();
             
             if distance_to_target <= 50.0 || time_fleeing > 3_000_000 { // 3 seconds max flee
                 animal.state = AnimalState::Patrolling;
                 animal.target_player_id = None;
                 animal.investigation_x = None;
                 animal.investigation_y = None;
                 animal.state_change_time = current_time;
                 log::debug!("Cable Viper {} finished fleeing - continuing patrol", animal.id);
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
         
         // Random wandering instead of fixed spawn-based pattern
         if rng.gen::<f32>() < 0.15 { // 15% chance to change direction
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
         ctx: &ReducerContext,
         animal: &mut WildAnimal,
         attacker: &Player,
         stats: &AnimalStats,
         current_time: Timestamp,
         rng: &mut impl Rng,
     ) -> Result<(), String> {
         // 🐍 CABLE VIPER DEFENSIVE RESPONSE: Assess threat and respond accordingly
         let health_percent = animal.health / stats.max_health;
         let distance_to_attacker = get_player_distance(animal, attacker);
         
         // Vipers are defensive but will fight back when cornered
         if health_percent < 0.3 {
             // Very low health - definitely flee
             set_flee_destination_away_from_threat(animal, attacker.position_x, attacker.position_y, 400.0, rng);
             transition_to_state(animal, AnimalState::Fleeing, current_time, None, "critical health flee");
             
             log::info!("Cable Viper {} fleeing due to critical health ({:.1}%)", 
                       animal.id, health_percent * 100.0);
         } else if distance_to_attacker <= 150.0 {
             // Close range - fight back with venom
             transition_to_state(animal, AnimalState::Chasing, current_time, Some(attacker.identity), "viper retaliation");
             emit_species_sound(ctx, animal, attacker.identity, "retaliation");
             
             log::info!("Cable Viper {} retaliating at close range against {} (Health: {:.1}%)", 
                       animal.id, attacker.identity, health_percent * 100.0);
         } else {
             // Far range - retreat and reassess
             set_flee_destination_away_from_threat(animal, attacker.position_x, attacker.position_y, 200.0, rng);
             transition_to_state(animal, AnimalState::Fleeing, current_time, None, "tactical retreat");
             
             log::info!("Cable Viper {} tactically retreating from distant threat", animal.id);
         }
         
         Ok(())
     }
     
     fn can_be_tamed(&self) -> bool {
         false // Vipers are not tameable (too dangerous and solitary)
     }
     
     fn get_taming_foods(&self) -> Vec<&'static str> {
         vec![] // No taming foods for vipers
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
                     
                     // Apply immediate damage by modifying player health directly
                     let spittle_damage = 15.0; // Moderate damage for ranged attack
                     let mut target_player_mut = target_player.clone();
                     
                     let old_health = target_player_mut.health;
                     target_player_mut.health = (target_player_mut.health - spittle_damage).clamp(0.0, 100.0);
                     let actual_damage = old_health - target_player_mut.health;
                     
                     // Update last hit time for visual effects
                     target_player_mut.last_hit_time = Some(current_time);
                     
                     // Update the player in the database
                     ctx.db.player().identity().update(target_player_mut.clone());
                     
                     log::info!("Viper spittle dealt {:.1} damage to player {:?} (Health: {:.1} -> {:.1})", 
                               actual_damage, target_player.identity, old_health, target_player_mut.health);
                     
                     // PLAY DAMAGE SOUND: Trigger a sharp hit sound
                     crate::sound_events::emit_melee_hit_sharp_sound(
                         ctx,
                         target_player.position_x,
                         target_player.position_y,
                         target_player.identity, // Player who got hit triggers the sound
                     );
                     
                     // ADDITIONAL VENOM EFFECT: Apply venom damage over time (lighter than bite)
                     if let Err(e) = crate::active_effects::apply_venom_effect(
                         ctx,
                         target_player.identity,
                         20.0, // 20 total damage over time (much less than bite)
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