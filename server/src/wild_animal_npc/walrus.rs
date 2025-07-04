/******************************************************************************
 *                                                                            *
 * Arctic Walrus Behavior - Defensive Beach Guardian                         *
 *                                                                            *
 * Walruses are massive, slow defensive animals that patrol beaches.         *
 * They only attack when provoked (attacked first), never flee from threats, *
 * ignore fire completely, and are extremely persistent once engaged.        *
 * Strong but slow with equal movement and sprint speeds.                    *
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
    AnimalBehavior, AnimalStats, AnimalState, MovementPattern, WildAnimal, AnimalSpecies,
    move_towards_target, can_attack, transition_to_state, emit_species_sound,
    execute_standard_patrol, get_player_distance, is_player_in_chase_range, wild_animal,
    TAMING_PROTECT_RADIUS, ThreatType, detect_threats_to_owner, find_closest_threat,
    handle_generic_threat_targeting, detect_and_handle_stuck_movement,
};

pub struct ArcticWalrusBehavior;

// Walrus-specific trait (for future extensions if needed)
pub trait WalrusBehavior {
    // Walruses have simple behavior - no special methods needed for now
}

impl WalrusBehavior for ArcticWalrusBehavior {
    // Implementation placeholder for future walrus-specific behaviors
}

impl AnimalBehavior for ArcticWalrusBehavior {
    fn get_stats(&self) -> AnimalStats {
        AnimalStats {
            max_health: 400.0, // Very tanky - takes 8 bow shots to kill
            attack_damage: 35.0, // High damage but slow attacks
            attack_range: 96.0, // Large attack range due to size
            attack_speed_ms: 2000, // Very slow attacks (2 seconds)
            movement_speed: 120.0, // Very slow patrol speed
            sprint_speed: 120.0, // Same as movement speed - walruses can't sprint
            perception_range: 300.0, // Moderate detection range
            perception_angle_degrees: 180.0, // Standard forward-facing vision
            patrol_radius: 200.0, // Small patrol area - stay on beaches
            chase_trigger_range: 400.0, // Will chase far once provoked
            flee_trigger_health_percent: 0.0, // Never flees (0% = never flee)
            hide_duration_ms: 0, // Walruses don't hide
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
        let damage = stats.attack_damage;
        
        // Walrus tusk strike - massive damage and knockback
        log::info!("Arctic Walrus {} delivers crushing tusk strike to player {}!", 
                  animal.id, target_player.identity);
        
        // 30% chance to cause bleeding from tusk wounds
        if rng.gen::<f32>() < 0.3 {
            if let Err(e) = crate::active_effects::apply_bleeding_effect(
                ctx, 
                target_player.identity, 
                20.0, // Heavy bleeding damage
                15.0, // Duration: 15 seconds
                3.0   // Tick every 3 seconds
            ) {
                log::error!("Failed to apply bleeding effect from walrus attack: {}", e);
            } else {
                log::info!("Arctic Walrus {} causes severe bleeding with tusk strike!", animal.id);
            }
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
        // 🦭 WALRUS DEFENSIVE BEHAVIOR: Only attack when provoked
        // Walruses ignore fire and never flee - they are purely reactive
        
        // 🐕 TAMED WALRUS BEHAVIOR: If tamed, follow owner and protect them
        if let Some(owner_id) = animal.tamed_by {
            // Tamed walruses don't attack their owner or patrol aggressively
            if let Some(player) = detected_player {
                if player.identity == owner_id {
                    // This is our owner - don't be aggressive
                    if matches!(animal.state, AnimalState::Chasing | AnimalState::Alert) {
                        transition_to_state(animal, AnimalState::Following, current_time, Some(owner_id), "owner detected - following");
                    }
                    return Ok(());
                }
            }
            
            // Check for threats to our owner using the generic threat detection system
            if handle_generic_threat_targeting(ctx, animal, owner_id, current_time).is_some() {
                return Ok(());
            }
            
            // If we're in Following or Protecting state, let the core taming system handle movement
            if matches!(animal.state, AnimalState::Following | AnimalState::Protecting) {
                return Ok(());
            }
            
            // Otherwise, default to following if tamed
            transition_to_state(animal, AnimalState::Following, current_time, Some(owner_id), "tamed - defaulting to follow");
            return Ok(());
        }
        
        // 🦭 WILD WALRUS BEHAVIOR: Normal defensive walrus logic
        match animal.state {
            AnimalState::Patrolling => {
                if let Some(player) = detected_player {
                    let distance = get_player_distance(animal, player);
                    
                    // Walruses only become alert when players get close - they don't attack unprovoked
                    if distance <= stats.perception_range * 0.6 { // 60% of perception range for alert
                        transition_to_state(animal, AnimalState::Alert, current_time, None, "player nearby");
                        
                        // 🔊 WALRUS SOUND: Emit warning bellow when player gets close
                        emit_species_sound(ctx, animal, player.identity, "warning");
                        
                        log::info!("Arctic Walrus {} becomes alert - player {} approaching at {:.1}px", 
                                  animal.id, player.identity, distance);
                    }
                }
            },
            
            AnimalState::Alert => {
                if let Some(player) = detected_player {
                    let distance = get_player_distance(animal, player);
                    
                    // Stay alert while player is nearby, return to patrol if they leave
                    if distance > stats.perception_range {
                        transition_to_state(animal, AnimalState::Patrolling, current_time, None, "player left area");
                        log::debug!("Arctic Walrus {} returning to patrol - player moved away", animal.id);
                    }
                    // Note: Walruses in Alert state will only attack if damaged (see handle_damage_response)
                } else {
                    // No player detected - return to patrol
                    transition_to_state(animal, AnimalState::Patrolling, current_time, None, "no player detected");
                }
            },
            
            AnimalState::Chasing => {
                // Once provoked, walruses are extremely persistent
                if let Some(target_id) = animal.target_player_id {
                    if let Some(target_player) = ctx.db.player().identity().find(&target_id) {
                        let distance = get_player_distance(animal, &target_player);
                        
                        // Walruses chase much further than other animals once provoked
                        if distance > (stats.chase_trigger_range * 3.0) { // 3x normal range
                            transition_to_state(animal, AnimalState::Patrolling, current_time, None, "player escaped");
                            log::debug!("Arctic Walrus {} ending chase - player very far away", animal.id);
                        }
                    } else {
                        // Target lost
                        transition_to_state(animal, AnimalState::Patrolling, current_time, None, "target lost");
                    }
                }
            },
            
            AnimalState::Fleeing => {
                // Walruses never flee - immediately return to patrol if somehow set to fleeing
                transition_to_state(animal, AnimalState::Patrolling, current_time, None, "walruses never flee");
                log::warn!("Arctic Walrus {} was set to fleeing state - walruses never flee!", animal.id);
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
        // Walruses never flee - immediately transition back to patrol
        transition_to_state(animal, AnimalState::Patrolling, current_time, None, "walruses never flee");
        animal.investigation_x = None;
        animal.investigation_y = None;
        log::warn!("Arctic Walrus {} attempted to flee - corrected to patrol state", animal.id);
    }

    fn execute_patrol_logic(
        &self,
        ctx: &ReducerContext,
        animal: &mut WildAnimal,
        stats: &AnimalStats,
        dt: f32,
        rng: &mut impl Rng,
    ) {
        // 🔊 WALRUS RANDOM GROWLING: Walruses make sounds randomly while patrolling
        if rng.gen::<f32>() < 0.008 { // 0.8% chance per tick = roughly every 2-4 seconds (more vocal than before)
            crate::sound_events::emit_walrus_growl_sound(ctx, animal.pos_x, animal.pos_y, ctx.identity());
            log::debug!("Arctic Walrus {} emits territorial growl while patrolling", animal.id);
        }
        
        // MODIFIED PATROL: Walruses move less and stay closer to their spawn point and group
        let modified_stats = AnimalStats {
            patrol_radius: 80.0, // Much smaller patrol radius
            movement_speed: stats.movement_speed * 0.6, // Move 40% slower during patrol
            ..stats.clone()
        };
        
        // Try to stay near other walruses (group behavior)
        if rng.gen::<f32>() < 0.15 { // 15% chance to check for nearby walruses
            if let Some((group_x, group_y)) = find_nearby_walrus_group_center(ctx, animal) {
                let distance_to_group = ((animal.pos_x - group_x).powi(2) + (animal.pos_y - group_y).powi(2)).sqrt();
                
                // If too far from group, bias movement toward them
                if distance_to_group > 120.0 { // Move toward group if more than 120px away
                    let dx = group_x - animal.pos_x;
                    let dy = group_y - animal.pos_y;
                    let group_distance = (dx * dx + dy * dy).sqrt();
                    
                    if group_distance > 0.0 {
                        // Bias direction toward group with some randomness
                        let group_weight = 0.6; // 60% toward group, 40% random patrol
                        let random_angle = rng.gen::<f32>() * 2.0 * PI;
                        let group_angle = dy.atan2(dx);
                        
                        animal.direction_x = group_weight * group_angle.cos() + (1.0 - group_weight) * random_angle.cos();
                        animal.direction_y = group_weight * group_angle.sin() + (1.0 - group_weight) * random_angle.sin();
                        
                        // Normalize the direction
                        let length = (animal.direction_x * animal.direction_x + animal.direction_y * animal.direction_y).sqrt();
                        if length > 0.0 {
                            animal.direction_x /= length;
                            animal.direction_y /= length;
                        }
                        
                        log::debug!("Arctic Walrus {} moving toward walrus group at ({:.1}, {:.1})", 
                                   animal.id, group_x, group_y);
                    }
                }
            }
        }
        
        execute_standard_patrol(ctx, animal, &modified_stats, dt, rng);
        
        // Additional check to keep walruses on beaches/coastal areas
        // If they wander too far from beach tiles, gently guide them back
        if rng.gen::<f32>() < 0.1 { // 10% chance per tick to check beach proximity
            if !is_position_on_beach_or_coastal(ctx, animal.pos_x, animal.pos_y) {
                // Find direction toward nearest beach and bias movement
                if let Some((beach_x, beach_y)) = find_nearest_beach_tile(ctx, animal.pos_x, animal.pos_y) {
                    let dx = beach_x - animal.pos_x;
                    let dy = beach_y - animal.pos_y;
                    let distance = (dx * dx + dy * dy).sqrt();
                    
                    if distance > 0.0 {
                        // Bias direction toward beach with some randomness
                        let beach_weight = 0.7; // 70% toward beach, 30% random
                        let random_angle = rng.gen::<f32>() * 2.0 * PI;
                        let beach_angle = dy.atan2(dx);
                        
                        animal.direction_x = beach_weight * beach_angle.cos() + (1.0 - beach_weight) * random_angle.cos();
                        animal.direction_y = beach_weight * beach_angle.sin() + (1.0 - beach_weight) * random_angle.sin();
                        
                        // Normalize the direction
                        let length = (animal.direction_x * animal.direction_x + animal.direction_y * animal.direction_y).sqrt();
                        if length > 0.0 {
                            animal.direction_x /= length;
                            animal.direction_y /= length;
                        }
                        
                        log::debug!("Arctic Walrus {} guided back toward beach area", animal.id);
                    }
                }
            }
        }
    }

    fn should_chase_player(&self, animal: &WildAnimal, stats: &AnimalStats, player: &Player) -> bool {
        // Walruses never chase unprovoked - they only attack when damaged first
        // This function should only return true if the walrus is already in a hostile state
        // due to being attacked (which is handled in handle_damage_response)
        false
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
        // 🐕 TAMED WALRUS: Don't attack the owner who tamed us
        if let Some(owner_id) = animal.tamed_by {
            if attacker.identity == owner_id {
                // Our owner hit us - just make a sad sound but don't retaliate
                // Show crying effect for 3 seconds
                animal.crying_effect_until = Some(Timestamp::from_micros_since_unix_epoch(
                    current_time.to_micros_since_unix_epoch() + 3000000 // 3 seconds in microseconds
                ));
                
                emit_species_sound(ctx, animal, attacker.identity, "confused");
                log::info!("🦭💧 Tamed Walrus {} was hit by owner {} - showing crying effect", animal.id, owner_id);
                return Ok(());
            }
            
            // Someone else attacked us while we're tamed - protect our owner by attacking the threat
            transition_to_state(animal, AnimalState::Protecting, current_time, Some(attacker.identity), "defending against attacker");
            emit_species_sound(ctx, animal, attacker.identity, "retaliation");
            log::info!("🦭 Tamed Walrus {} defending against attacker {} (owner: {})", 
                      animal.id, attacker.identity, owner_id);
            return Ok(());
        }
        
        // 🦭 WILD WALRUS RETALIATION: When attacked, walruses become extremely aggressive
        // They never flee and will chase the attacker relentlessly
        
        transition_to_state(animal, AnimalState::Chasing, current_time, Some(attacker.identity), "walrus retaliation");
        
        // 🔊 WALRUS SOUND: Emit aggressive bellow when provoked
        emit_species_sound(ctx, animal, attacker.identity, "retaliation");
        
        log::info!("🦭 Arctic Walrus {} PROVOKED by player {}! Entering aggressive state - walruses never back down!", 
                  animal.id, attacker.identity);
        
        Ok(())
    }
    
    fn can_be_tamed(&self) -> bool {
        true // Walruses can be tamed with fish
    }
    
    fn get_taming_foods(&self) -> Vec<&'static str> {
        vec!["Raw Twigfish", "Cooked Twigfish"] // Fish items that can tame walruses
    }
}

// Helper functions for beach navigation

/// Check if position is on beach or coastal area (beach tile or adjacent to water)
fn is_position_on_beach_or_coastal(ctx: &ReducerContext, pos_x: f32, pos_y: f32) -> bool {
    // Convert pixel position to tile coordinates
    let tile_x = (pos_x / crate::TILE_SIZE_PX as f32).floor() as i32;
    let tile_y = (pos_y / crate::TILE_SIZE_PX as f32).floor() as i32;
    
    // Check if current tile is beach
    if let Some(tile_type) = crate::get_tile_type_at_position(ctx, tile_x, tile_y) {
        if tile_type == crate::TileType::Beach {
            return true;
        }
        
        // If not beach, check if it's adjacent to water (coastal area)
        if tile_type == crate::TileType::Grass || tile_type == crate::TileType::Dirt {
            // Check surrounding tiles for water
            for dy in -1..=1 {
                for dx in -1..=1 {
                    if dx == 0 && dy == 0 { continue; }
                    
                    let check_x = tile_x + dx;
                    let check_y = tile_y + dy;
                    
                    if let Some(adjacent_tile_type) = crate::get_tile_type_at_position(ctx, check_x, check_y) {
                        if adjacent_tile_type == crate::TileType::Sea || adjacent_tile_type == crate::TileType::Beach {
                            return true; // Adjacent to water/beach = coastal
                        }
                    }
                }
            }
        }
    }
    
    false
}

/// Find the nearest beach tile to guide walrus movement
fn find_nearest_beach_tile(ctx: &ReducerContext, pos_x: f32, pos_y: f32) -> Option<(f32, f32)> {
    let current_tile_x = (pos_x / crate::TILE_SIZE_PX as f32).floor() as i32;
    let current_tile_y = (pos_y / crate::TILE_SIZE_PX as f32).floor() as i32;
    
    let search_radius = 10; // Search within 10 tiles
    let mut closest_beach: Option<(i32, i32)> = None;
    let mut closest_distance_sq = f32::MAX;
    
    // Search in expanding radius for beach tiles
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
                if tile_type == crate::TileType::Beach {
                    let distance_sq = (dx * dx + dy * dy) as f32;
                    if distance_sq < closest_distance_sq {
                        closest_distance_sq = distance_sq;
                        closest_beach = Some((check_x, check_y));
                    }
                }
            }
        }
    }
    
    // Convert tile coordinates back to world position
    if let Some((beach_tile_x, beach_tile_y)) = closest_beach {
        let beach_world_x = (beach_tile_x as f32 + 0.5) * crate::TILE_SIZE_PX as f32;
        let beach_world_y = (beach_tile_y as f32 + 0.5) * crate::TILE_SIZE_PX as f32;
        Some((beach_world_x, beach_world_y))
    } else {
        None
    }
}

/// Find the center of nearby walruses to encourage group behavior
fn find_nearby_walrus_group_center(ctx: &ReducerContext, current_walrus: &WildAnimal) -> Option<(f32, f32)> {
    let search_radius = 200.0; // Look for walruses within 200 pixels
    let mut nearby_walruses = Vec::new();
    
    for walrus in ctx.db.wild_animal().iter() {
        if walrus.id != current_walrus.id && matches!(walrus.species, AnimalSpecies::ArcticWalrus) {
            let distance = ((current_walrus.pos_x - walrus.pos_x).powi(2) + 
                           (current_walrus.pos_y - walrus.pos_y).powi(2)).sqrt();
            
            if distance <= search_radius {
                nearby_walruses.push(walrus);
            }
        }
    }
    
    if nearby_walruses.is_empty() {
        return None;
    }
    
    // Calculate center of nearby walruses
    let total_x: f32 = nearby_walruses.iter().map(|w| w.pos_x).sum();
    let total_y: f32 = nearby_walruses.iter().map(|w| w.pos_y).sum();
    let count = nearby_walruses.len() as f32;
    
    Some((total_x / count, total_y / count))
}