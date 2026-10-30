/******************************************************************************
 *                                                                            *
 * Arctic Walrus Behavior - Defensive Beach Guardian with Breeding System    *
 *                                                                            *
 * Walruses are massive, EXTREMELY slow defensive animals that patrol        *
 * beaches. They only attack when provoked (attacked first), never flee      *
 * from threats, and are extremely persistent once engaged.                  *
 * Strong but very slow with equal movement and sprint speeds.               *
 *                                                                            *
 * UNIQUE TRAIT: Walruses are CURIOUS about ALL light sources:               *
 *   - Burning campfires                                                      *
 *   - Lit lanterns (placed in the world)                                    *
 *   - Players carrying lit torches                                          *
 * Instead of fearing fire like other animals, they will investigate and     *
 * slowly circle around warm glowing lights, watching with fascination       *
 * while keeping a safe distance.                                            *
 *                                                                            *
 * BREEDING SYSTEM (passive farming feature):                                 *
 *   - Sex: Male/Female assigned at birth/spawn                              *
 *   - Age Stages: Pup (8 days) → Juvenile (14 days) → Adult                 *
 *   - Rut Cycle: Every 30 game days (15 real hours), lasts 5 days           *
 *   - Mating: Male + Female proximity for 3 nights during rut               *
 *   - Pregnancy: 12-15 game days (6-7.5 real hours)                         *
 *   - Birth Limit: 1 pup per female per rut cycle                           *
 *   - Population Control: Soft cap per chunk with penalties                  *
 *                                                                            *
 * TIMING (1 game day = 30 real minutes):                                    *
 *   - Full growth to adult: ~22 game days = 11 real hours                   *
 *   - Pregnancy: ~13.5 game days = 6.75 real hours                          *
 *   - Rut cycle: 30 days = 15 real hours                                    *
 *                                                                            *
 ******************************************************************************/

use spacetimedb::{ReducerContext, Identity, Timestamp, Table, table, ScheduleAt, TimeDuration};
use std::f32::consts::PI;
use rand::Rng;
use log;

use crate::{Player};
use crate::utils::get_distance_squared;

// Table trait imports
use crate::player as PlayerTableTrait;
use crate::campfire::campfire as CampfireTableTrait;
use crate::lantern::lantern as LanternTableTrait;
use crate::active_equipment::active_equipment as ActiveEquipmentTableTrait;
use crate::items::item_definition as ItemDefinitionTableTrait;
use super::core::{
    AnimalBehavior, AnimalStats, AnimalState, MovementPattern, WildAnimal, AnimalSpecies,
    move_towards_target, can_attack, transition_to_state, emit_species_sound,
    execute_standard_patrol, get_player_distance, is_player_in_chase_range, wild_animal,
    TAMING_PROTECT_RADIUS, ThreatType, detect_threats_to_owner, find_closest_threat,
    handle_generic_threat_targeting, detect_and_handle_stuck_movement,
};

// =============================================================================
// WALRUS BREEDING SYSTEM - ENUMS AND CONSTANTS
// =============================================================================

/// Sex of a walrus - determines breeding role
#[derive(Debug, Clone, Copy, PartialEq, spacetimedb::SpacetimeType)]
pub enum WalrusSex {
    Male,
    Female,
}

/// Age stage of a walrus - determines size, drops, and breeding eligibility
#[derive(Debug, Clone, Copy, PartialEq, spacetimedb::SpacetimeType)]
pub enum WalrusAgeStage {
    Pup,       // 0-8 game days: Half size, minimal drops, vulnerable
    Juvenile,  // 8-22 game days: 75% size, moderate drops, cannot breed
    Adult,     // 22+ game days: Full size, full drops, can breed
}

// --- Breeding System Constants ---
// Timing based on 1 game day = 30 real minutes
// Walruses are slower breeders than caribou, reflecting their marine mammal biology

/// Rut (breeding season) cycle length in game days
/// 30 game days = 15 real hours - less frequent than caribou
pub const WALRUS_RUT_CYCLE_DAYS: u32 = 30;

/// Duration of rut period in game days (when breeding is possible)
/// 5 game days = 2.5 real hours - slightly longer window than caribou
pub const WALRUS_RUT_DURATION_DAYS: u32 = 5;

/// Number of consecutive nights of proximity required for mating attempt
/// 3 nights = ~30 real minutes of being penned together during night (more than caribou)
pub const WALRUS_MATING_NIGHTS_REQUIRED: u32 = 3;

/// Conception chance when mating requirements are met (0.0 - 1.0)
/// Lower than caribou - walruses are harder to breed
pub const WALRUS_CONCEPTION_CHANCE: f32 = 0.55;

/// Cooldown after mating attempt in game days (prevents spam attempts)
pub const WALRUS_MATING_COOLDOWN_DAYS: u32 = 2;

/// Minimum pregnancy duration in game days (longer than caribou)
pub const WALRUS_PREGNANCY_MIN_DAYS: u32 = 12;

/// Maximum pregnancy duration in game days
pub const WALRUS_PREGNANCY_MAX_DAYS: u32 = 15;

/// Days a female is locked out from breeding after giving birth
/// Equals RUT_CYCLE_DAYS to enforce 1 birth per cycle
pub const WALRUS_POSTPARTUM_LOCKOUT_DAYS: u32 = WALRUS_RUT_CYCLE_DAYS;

/// Pup stage duration in game days (half size, minimal drops)
pub const WALRUS_PUP_STAGE_DAYS: u32 = 8;

/// Juvenile stage duration in game days (75% size, moderate drops)
pub const WALRUS_JUVENILE_STAGE_DAYS: u32 = 14;

/// Total days from birth to adulthood
pub const WALRUS_DAYS_TO_ADULT: u32 = WALRUS_PUP_STAGE_DAYS + WALRUS_JUVENILE_STAGE_DAYS;

/// Proximity radius for mating (pixels) - walruses must be within this distance
/// 300px - walruses are more sedentary, need to be closer
pub const WALRUS_MATING_PROXIMITY_RADIUS: f32 = 300.0;
pub const WALRUS_MATING_PROXIMITY_RADIUS_SQUARED: f32 = WALRUS_MATING_PROXIMITY_RADIUS * WALRUS_MATING_PROXIMITY_RADIUS;

/// Soft cap for walrus population per chunk
pub const WALRUS_SOFT_CAP_PER_CHUNK: u32 = 4;

/// Conception penalty per walrus over soft cap (reduces conception chance)
pub const WALRUS_CONCEPTION_PENALTY_PER_OVER_CAP: f32 = 0.25;

/// Base daily pup mortality rate (chance to die each game day)
pub const WALRUS_PUP_MORTALITY_BASE_RATE: f32 = 0.04;

/// Additional mortality per walrus over soft cap
pub const WALRUS_PUP_MORTALITY_OVERCAP_RATE: f32 = 0.025;

/// Health multiplier for pups (relative to adult max health)
pub const WALRUS_PUP_HEALTH_MULTIPLIER: f32 = 0.35;

/// Health multiplier for juveniles (relative to adult max health)
pub const WALRUS_JUVENILE_HEALTH_MULTIPLIER: f32 = 0.65;

// =============================================================================
// WALRUS BREEDING DATA TABLE
// =============================================================================

/// Stores breeding-specific data for each walrus
/// Separate table to avoid bloating WildAnimal with null fields for other species
#[table(accessor = walrus_breeding_data, public)]
#[derive(Clone, Debug)]
pub struct WalrusBreedingData {
    #[primary_key]
    pub animal_id: u64,  // Links to WildAnimal.id
    
    // Identity
    pub sex: WalrusSex,
    pub age_stage: WalrusAgeStage,
    
    // Age tracking (in game day increments from birth)
    pub birth_day: u32,  // Game day when this walrus was born/spawned
    pub current_age_days: u32,  // How many game days old
    
    // Mating state (for females)
    pub is_pregnant: bool,
    pub pregnancy_start_day: Option<u32>,  // Game day pregnancy began
    pub pregnancy_duration: Option<u32>,   // How many days until birth
    pub last_birth_day: Option<u32>,       // Game day of last birth (for lockout)
    
    // Mating progress (tracked nightly during rut)
    pub mating_partner_id: Option<u64>,    // Current mating partner animal_id
    pub consecutive_mating_nights: u32,    // Nights spent near partner
    pub last_mating_check_day: Option<u32>, // Last game day mating was checked
    pub last_mating_attempt_day: Option<u32>, // Last day conception was attempted
    
    // Milking (for tamed females only)
    pub last_milked_day: Option<u32>,      // Game day (cycle_count) when last milked - milkable again at dawn
}

/// Schedule table for walrus breeding system updates
#[table(accessor = walrus_breeding_schedule, scheduled(process_walrus_breeding))]
#[derive(Clone)]
pub struct WalrusBreedingSchedule {
    #[primary_key]
    #[auto_inc]
    pub schedule_id: u64,
    pub scheduled_at: ScheduleAt,
}

/// Global rut state tracking for walruses
#[table(accessor = walrus_rut_state, public)]
#[derive(Clone, Debug)]
pub struct WalrusRutState {
    #[primary_key]
    pub id: u32,  // Singleton (always 1)
    pub current_cycle_day: u32,     // Day within the 30-day rut cycle (0-29)
    pub is_rut_active: bool,        // True during the 5-day rut period
    pub last_update_timestamp: Timestamp,
}

// Table trait imports for breeding system
use crate::wild_animal_npc::walrus::walrus_breeding_data as WalrusBreedingDataTableTrait;
use crate::wild_animal_npc::walrus::walrus_breeding_schedule as WalrusBreedingScheduleTableTrait;
use crate::wild_animal_npc::walrus::walrus_rut_state as WalrusRutStateTableTrait;
use crate::world_state::world_state as WorldStateTableTrait;

// Walrus light curiosity constants
const LIGHT_CURIOSITY_DETECTION_RADIUS: f32 = 500.0; // How far walrus can detect light sources
const LIGHT_CURIOSITY_DETECTION_RADIUS_SQUARED: f32 = LIGHT_CURIOSITY_DETECTION_RADIUS * LIGHT_CURIOSITY_DETECTION_RADIUS;
const LIGHT_CURIOSITY_MIN_DISTANCE: f32 = 120.0; // Minimum distance to keep from light source
const LIGHT_CURIOSITY_MAX_DISTANCE: f32 = 180.0; // Maximum distance to orbit at
const LIGHT_CURIOSITY_ORBIT_SPEED: f32 = 0.4; // Radians per second for circling (slow, curious pace)
const LIGHT_CURIOSITY_CHANCE: f32 = 0.02; // 2% chance per tick to notice light when patrolling

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
            attack_range: 92.0, // Increased from 80 to compensate for collision pushback preventing hits
            attack_speed_ms: 2000, // Very slow attacks (2 seconds)
            movement_speed: 60.0, // Extremely slow patrol speed (half of before)
            sprint_speed: 60.0, // Same as movement speed - walruses can't sprint
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
                // First check for nearby players that might make us alert
                if let Some(player) = detected_player {
                    let distance = get_player_distance(animal, player);
                    
                    // Walruses only become alert when players get close - they don't attack unprovoked
                    if distance <= stats.perception_range * 0.6 { // 60% of perception range for alert
                        transition_to_state(animal, AnimalState::Alert, current_time, None, "player nearby");
                        
                        // 🔊 WALRUS SOUND: Emit warning bellow when player gets close
                        emit_species_sound(ctx, animal, player.identity, "warning");
                        
                        log::info!("Arctic Walrus {} becomes alert - player {} approaching at {:.1}px", 
                                  animal.id, player.identity, distance);
                        return Ok(());
                    }
                }
                
                // 🔥 LIGHT CURIOSITY: Check for nearby light sources (campfires, lanterns)
                // Walruses are curious about warm glowing lights - they'll investigate!
                if rng.gen::<f32>() < LIGHT_CURIOSITY_CHANCE {
                    if let Some((light_x, light_y, _distance_sq)) = find_nearest_light_source(ctx, animal.pos_x, animal.pos_y) {
                        // Set investigation target to the light source
                        animal.investigation_x = Some(light_x);
                        animal.investigation_y = Some(light_y);
                        
                        transition_to_state(animal, AnimalState::Investigating, current_time, None, "curious about light");
                        
                        log::info!("🦭🔥 Arctic Walrus {} curious about light source at ({:.1}, {:.1}) - investigating!", 
                                  animal.id, light_x, light_y);
                    }
                }
            },
            
            AnimalState::Investigating => {
                // 🔥 LIGHT CURIOSITY BEHAVIOR: Circle around light sources at safe distance
                if let (Some(light_x), Some(light_y)) = (animal.investigation_x, animal.investigation_y) {
                    // Check if the light source is still active
                    let light_still_active = find_nearest_light_source(ctx, light_x, light_y)
                        .map(|(lx, ly, _)| {
                            let dx = lx - light_x;
                            let dy = ly - light_y;
                            (dx * dx + dy * dy) < 100.0 // Within 10px = same light source
                        })
                        .unwrap_or(false);
                    
                    if !light_still_active {
                        // Light went out or was destroyed - return to patrol
                        animal.investigation_x = None;
                        animal.investigation_y = None;
                        transition_to_state(animal, AnimalState::Patrolling, current_time, None, "light source gone");
                        log::debug!("Arctic Walrus {} - light source gone, returning to patrol", animal.id);
                        return Ok(());
                    }
                    
                    // Check if player gets too close while investigating
                    if let Some(player) = detected_player {
                        let distance = get_player_distance(animal, player);
                        if distance <= stats.perception_range * 0.4 { // Alert at 40% range while investigating
                            animal.investigation_x = None;
                            animal.investigation_y = None;
                            transition_to_state(animal, AnimalState::Alert, current_time, None, "player too close");
                            emit_species_sound(ctx, animal, player.identity, "warning");
                            log::info!("Arctic Walrus {} becomes alert - player interrupted light watching", animal.id);
                            return Ok(());
                        }
                    }
                    
                    // 🔄 Execute orbiting movement around the light source
                    // Using AI tick interval approximation (~66ms per tick)
                    let dt = 0.066_f32;
                    execute_light_curiosity_orbit(animal, light_x, light_y, dt, stats, rng);
                    
                    // Occasionally emit a curious grunt while watching the light
                    if rng.gen::<f32>() < 0.005 { // 0.5% chance per tick
                        crate::sound_events::emit_walrus_growl_sound(ctx, animal.pos_x, animal.pos_y, ctx.identity());
                        log::debug!("Arctic Walrus {} grunts curiously at the light", animal.id);
                    }
                    
                    // Randomly decide to stop watching after some time (average ~1 minute watching)
                    if rng.gen::<f32>() < 0.001 {
                        animal.investigation_x = None;
                        animal.investigation_y = None;
                        transition_to_state(animal, AnimalState::Patrolling, current_time, None, "lost interest in light");
                        log::debug!("Arctic Walrus {} lost interest in light, resuming patrol", animal.id);
                    }
                } else {
                    // No investigation target - return to patrol
                    transition_to_state(animal, AnimalState::Patrolling, current_time, None, "no investigation target");
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

    fn should_chase_player(&self, ctx: &ReducerContext, animal: &WildAnimal, stats: &AnimalStats, player: &Player) -> bool {
        // Walruses never chase unprovoked - they only attack when damaged first
        // This function should only return true if the walrus is already in a hostile state
        // due to being attacked (which is handled in handle_damage_response)
        // Note: Intimidation doesn't apply to walruses since they don't chase anyway
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
        // 🐺 NOTE: Walruses are NOT intimidated by wolf fur - they're too massive and defensive!
        
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
        // Walruses love all fish and seafood - they're marine animals!
        vec![
            // Crab meat (walruses love crabs)
            "Raw Crab Meat", "Cooked Crab Meat",
            // Small fish
            "Raw Twigfish", "Cooked Twigfish",
            "Raw Herring", "Cooked Herring",
            "Raw Smelt", "Cooked Smelt",
            // Medium fish
            "Raw Greenling", "Cooked Greenling",
            "Raw Sculpin", "Cooked Sculpin",
            "Raw Pacific Cod", "Cooked Pacific Cod",
            "Raw Dolly Varden", "Cooked Dolly Varden",
            "Raw Rockfish", "Cooked Rockfish",
            "Raw Steelhead", "Cooked Steelhead",
            // Large/premium fish
            "Raw Pink Salmon", "Cooked Pink Salmon",
            "Raw Sockeye Salmon", "Cooked Sockeye Salmon",
            "Raw King Salmon", "Cooked King Salmon",
            "Raw Halibut", "Cooked Halibut",
            // Shellfish and mollusks
            "Raw Black Katy Chiton", "Cooked Black Katy Chiton",
            "Raw Sea Urchin", "Cooked Sea Urchin",
            "Raw Blue Mussel", "Cooked Blue Mussel",
        ]
    }
    
    fn get_chase_abandonment_multiplier(&self) -> f32 {
        4.0 // Walruses are extremely persistent - give up at 4.0x chase trigger range (very territorial)
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
                        if adjacent_tile_type.is_water() || adjacent_tile_type == crate::TileType::Beach {
                            return true; // Adjacent to water/beach = coastal (includes Sea and HotSpringWater)
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

/******************************************************************************
 *                       LIGHT CURIOSITY BEHAVIOR                             *
 *                                                                            *
 * Walruses are curious about ALL light sources:                             *
 *   - Burning campfires                                                      *
 *   - Lit lanterns (placed in the world)                                    *
 *   - Players carrying lit torches                                          *
 *                                                                            *
 * They will keep their distance but hover relatively close and circle       *
 * around the warm glow - watching with fascinated interest.                 *
 ******************************************************************************/

/// Find the closest active light source (burning campfire, lit lantern, or player's lit torch) within detection range
fn find_nearest_light_source(ctx: &ReducerContext, walrus_x: f32, walrus_y: f32) -> Option<(f32, f32, f32)> {
    let mut closest_light: Option<(f32, f32, f32)> = None; // (x, y, distance_sq)
    let mut closest_distance_sq = LIGHT_CURIOSITY_DETECTION_RADIUS_SQUARED;
    
    // Check burning campfires
    for campfire in ctx.db.campfire().iter() {
        if !campfire.is_burning || campfire.is_destroyed {
            continue;
        }
        
        let dx = walrus_x - campfire.pos_x;
        let dy = walrus_y - campfire.pos_y;
        let distance_sq = dx * dx + dy * dy;
        
        if distance_sq <= LIGHT_CURIOSITY_DETECTION_RADIUS_SQUARED && distance_sq < closest_distance_sq {
            closest_distance_sq = distance_sq;
            closest_light = Some((campfire.pos_x, campfire.pos_y, distance_sq));
        }
    }
    
    // Check lit lanterns
    for lantern in ctx.db.lantern().iter() {
        if !lantern.is_burning || lantern.is_destroyed {
            continue;
        }
        
        let dx = walrus_x - lantern.pos_x;
        let dy = walrus_y - lantern.pos_y;
        let distance_sq = dx * dx + dy * dy;
        
        if distance_sq <= LIGHT_CURIOSITY_DETECTION_RADIUS_SQUARED && distance_sq < closest_distance_sq {
            closest_distance_sq = distance_sq;
            closest_light = Some((lantern.pos_x, lantern.pos_y, distance_sq));
        }
    }
    
    // Check players with lit torches (optimized: distance check first, then database lookups)
    for player in ctx.db.player().iter() {
        // Early exit: Skip dead or knocked out players
        if player.is_dead || player.is_knocked_out {
            continue;
        }
        
        // Early exit: Quick distance check BEFORE expensive database lookups
        let dx = walrus_x - player.position_x;
        let dy = walrus_y - player.position_y;
        let distance_sq = dx * dx + dy * dy;
        
        // Skip players outside detection radius or further than current closest
        if distance_sq > LIGHT_CURIOSITY_DETECTION_RADIUS_SQUARED || distance_sq >= closest_distance_sq {
            continue;
        }
        
        // Early exit: Check torch lit status (cheap field check)
        if !player.is_torch_lit {
            continue;
        }
        
        // Only do expensive database lookups if player is close and has lit torch
        if let Some(equipment) = ctx.db.active_equipment().player_identity().find(&player.identity) {
            if let Some(item_def_id) = equipment.equipped_item_def_id {
                if let Some(item_def) = ctx.db.item_definition().id().find(item_def_id) {
                    if item_def.name == "Torch" {
                        closest_distance_sq = distance_sq;
                        closest_light = Some((player.position_x, player.position_y, distance_sq));
                    }
                }
            }
        }
    }
    
    closest_light
}

/// Execute circling behavior around a light source
/// Walrus will orbit at a safe distance, slowly circling the light with curiosity
fn execute_light_curiosity_orbit(
    animal: &mut WildAnimal, 
    light_x: f32, 
    light_y: f32, 
    dt: f32,
    stats: &AnimalStats,
    rng: &mut impl Rng,
) {
    let dx = animal.pos_x - light_x;
    let dy = animal.pos_y - light_y;
    let current_distance = (dx * dx + dy * dy).sqrt();
    
    // Calculate current angle from light to walrus
    let current_angle = dy.atan2(dx);
    
    // Advance the orbit angle (walruses circle slowly, clockwise)
    // Add some randomness to make it look more natural
    let orbit_variation = if rng.gen::<f32>() < 0.1 { rng.gen::<f32>() * 0.2 - 0.1 } else { 0.0 };
    let new_angle = current_angle + (LIGHT_CURIOSITY_ORBIT_SPEED + orbit_variation) * dt;
    
    // Determine target orbit distance (within min/max range)
    let target_distance = (LIGHT_CURIOSITY_MIN_DISTANCE + LIGHT_CURIOSITY_MAX_DISTANCE) / 2.0;
    
    // Calculate target position on the orbit circle
    let target_x = light_x + target_distance * new_angle.cos();
    let target_y = light_y + target_distance * new_angle.sin();
    
    // Calculate direction to target orbit position
    let move_dx = target_x - animal.pos_x;
    let move_dy = target_y - animal.pos_y;
    let move_distance = (move_dx * move_dx + move_dy * move_dy).sqrt();
    
    if move_distance > 1.0 {
        // Normalize direction
        animal.direction_x = move_dx / move_distance;
        animal.direction_y = move_dy / move_distance;
        
        // Store starting position
        let start_x = animal.pos_x;
        let start_y = animal.pos_y;
        
        // Move at slow patrol speed (walruses are curious, not urgent)
        let move_speed = stats.movement_speed * 0.5 * dt; // Half patrol speed
        
        animal.pos_x += animal.direction_x * move_speed;
        animal.pos_y += animal.direction_y * move_speed;
        
        // Update facing direction based on ACTUAL movement delta (4 directions)
        let actual_move_x = animal.pos_x - start_x;
        let actual_move_y = animal.pos_y - start_y;
        if actual_move_x.abs() > 2.0 || actual_move_y.abs() > 2.0 {
            if actual_move_x.abs() > actual_move_y.abs() {
                animal.facing_direction = if actual_move_x > 0.0 { "right".to_string() } else { "left".to_string() };
            } else {
                animal.facing_direction = if actual_move_y > 0.0 { "down".to_string() } else { "up".to_string() };
            }
        }
    }
    
    // If too close to the light, back off
    if current_distance < LIGHT_CURIOSITY_MIN_DISTANCE {
        // Move away from light
        if current_distance > 0.0 {
            let away_x = dx / current_distance;
            let away_y = dy / current_distance;
            let backup_speed = stats.movement_speed * 0.3 * dt;
            
            animal.pos_x += away_x * backup_speed;
            animal.pos_y += away_y * backup_speed;
        }
    }
}

// =============================================================================
// WALRUS BREEDING SYSTEM IMPLEMENTATION
// =============================================================================

/// Initialize the walrus breeding system scheduler
/// Called during game initialization
pub fn init_walrus_breeding_schedule(ctx: &ReducerContext) -> Result<(), String> {
    // Check if schedule already exists
    if ctx.db.walrus_breeding_schedule().iter().next().is_some() {
        log::debug!("Walrus breeding schedule already exists, skipping initialization");
        return Ok(());
    }
    
    // Initialize rut state singleton if it doesn't exist
    if ctx.db.walrus_rut_state().iter().next().is_none() {
        ctx.db.walrus_rut_state().try_insert(WalrusRutState {
            id: 1,
            current_cycle_day: 0,
            is_rut_active: false,
            last_update_timestamp: ctx.timestamp,
        }).map_err(|e| format!("Failed to create walrus rut state: {}", e))?;
        log::info!("🦭 Initialized walrus rut state singleton");
    }
    
    // Create breeding schedule - runs every 30 real seconds (once per game "night")
    // This timing ensures we check mating proximity each night cycle
    let interval = TimeDuration::from_micros(30_000_000); // 30 seconds in microseconds
    ctx.db.walrus_breeding_schedule().try_insert(WalrusBreedingSchedule {
        schedule_id: 0,
        scheduled_at: ScheduleAt::Interval(interval.into()),
    }).map_err(|e| format!("Failed to create walrus breeding schedule: {}", e))?;
    
    log::info!("🦭 Walrus breeding system initialized with 30-second update interval");
    Ok(())
}

/// Create breeding data for a new walrus
/// Called when spawning or birthing a walrus
pub fn create_walrus_breeding_data(
    ctx: &ReducerContext,
    animal_id: u64,
    sex: WalrusSex,
    current_game_day: u32,
    is_newborn: bool,
) -> Result<WalrusBreedingData, String> {
    let (age_stage, age_days) = if is_newborn {
        (WalrusAgeStage::Pup, 0)
    } else {
        // Spawned adults are fully grown
        (WalrusAgeStage::Adult, WALRUS_DAYS_TO_ADULT)
    };
    
    let breeding_data = WalrusBreedingData {
        animal_id,
        sex,
        age_stage,
        birth_day: current_game_day.saturating_sub(age_days),
        current_age_days: age_days,
        is_pregnant: false,
        pregnancy_start_day: None,
        pregnancy_duration: None,
        last_birth_day: None,
        mating_partner_id: None,
        consecutive_mating_nights: 0,
        last_mating_check_day: None,
        last_mating_attempt_day: None,
        last_milked_day: None, // Never milked yet
    };
    
    ctx.db.walrus_breeding_data().try_insert(breeding_data.clone())
        .map_err(|e| format!("Failed to create breeding data for walrus {}: {}", animal_id, e))?;
    
    log::info!("🦭 Created breeding data for walrus {} - {:?} {:?} (age: {} days)", 
              animal_id, sex, age_stage, age_days);
    
    Ok(breeding_data)
}

/// Get the current game day from world state (shared with caribou)
pub fn get_current_game_day(ctx: &ReducerContext) -> u32 {
    if let Some(world_state) = ctx.db.world_state().iter().next() {
        // Use day_of_year + (year-1) * 960 for absolute day count
        (world_state.year.saturating_sub(1)) * 960 + world_state.day_of_year
    } else {
        1 // Default to day 1 if world state not found
    }
}

/// Check if it's currently night time (when mating checks occur)
pub fn is_night_time(ctx: &ReducerContext) -> bool {
    use crate::world_state::TimeOfDay;
    
    if let Some(world_state) = ctx.db.world_state().iter().next() {
        matches!(world_state.time_of_day, 
            TimeOfDay::Dusk | TimeOfDay::Night | TimeOfDay::Midnight | TimeOfDay::TwilightMorning)
    } else {
        false
    }
}

/// Main scheduled reducer for walrus breeding system
#[spacetimedb::reducer]
pub fn process_walrus_breeding(ctx: &ReducerContext, _schedule: WalrusBreedingSchedule) -> Result<(), String> {
    // Security: Only allow scheduler to call this
    if ctx.sender() != ctx.identity() {
        return Err("Walrus breeding reducer can only be called by scheduler".to_string());
    }
    
    let current_day = get_current_game_day(ctx);
    let is_night = is_night_time(ctx);
    
    // Update rut state
    update_walrus_rut_state(ctx, current_day)?;
    
    // Get rut state
    let rut_state = ctx.db.walrus_rut_state().iter().next()
        .ok_or_else(|| "Walrus rut state not found".to_string())?;
    
    // Process different aspects of breeding
    process_walrus_age_progression(ctx, current_day)?;
    process_walrus_pup_mortality(ctx)?;
    
    // Only check mating during rut AND at night
    if rut_state.is_rut_active && is_night {
        process_walrus_mating_proximity(ctx, current_day)?;
    }
    
    // Always check for births (pregnant females can give birth anytime)
    process_walrus_births(ctx, current_day)?;
    
    log::debug!("🦭 Walrus breeding tick complete - Day {}, Rut: {}, Night: {}", 
               current_day, rut_state.is_rut_active, is_night);
    
    Ok(())
}

/// Update the rut state based on current day
fn update_walrus_rut_state(ctx: &ReducerContext, current_day: u32) -> Result<(), String> {
    let mut rut_state = ctx.db.walrus_rut_state().iter().next()
        .ok_or_else(|| "Walrus rut state not found".to_string())?;
    
    // Calculate position in rut cycle (0 to WALRUS_RUT_CYCLE_DAYS-1)
    let cycle_day = current_day % WALRUS_RUT_CYCLE_DAYS;
    
    // Rut is active during the first WALRUS_RUT_DURATION_DAYS of each cycle
    let new_is_rut_active = cycle_day < WALRUS_RUT_DURATION_DAYS;
    
    // Log rut state changes
    if new_is_rut_active != rut_state.is_rut_active {
        if new_is_rut_active {
            log::info!("🦭🔥 WALRUS RUT SEASON BEGINS! Breeding is now possible for {} days", WALRUS_RUT_DURATION_DAYS);
        } else {
            log::info!("🦭 Walrus rut season ends. Next rut in {} days", WALRUS_RUT_CYCLE_DAYS - cycle_day);
        }
    }
    
    rut_state.current_cycle_day = cycle_day;
    rut_state.is_rut_active = new_is_rut_active;
    rut_state.last_update_timestamp = ctx.timestamp;
    
    ctx.db.walrus_rut_state().id().update(rut_state);
    Ok(())
}

/// Process age progression for all walruses
/// NOTE: Only ages UP (Pup → Juvenile → Adult), never DOWN.
/// This prevents spawned adults from being incorrectly downgraded when birth_day
/// underflows due to saturating_sub during early game days.
fn process_walrus_age_progression(ctx: &ReducerContext, current_day: u32) -> Result<(), String> {
    let mut updates = Vec::new();
    
    for breeding_data in ctx.db.walrus_breeding_data().iter() {
        let new_age = current_day.saturating_sub(breeding_data.birth_day);
        
        // Skip if age hasn't changed
        if new_age == breeding_data.current_age_days {
            continue;
        }
        
        // Determine new age stage based on calculated age
        let calculated_stage = if new_age < WALRUS_PUP_STAGE_DAYS {
            WalrusAgeStage::Pup
        } else if new_age < WALRUS_DAYS_TO_ADULT {
            WalrusAgeStage::Juvenile
        } else {
            WalrusAgeStage::Adult
        };
        
        // CRITICAL: Only allow aging UP, never DOWN
        // This prevents spawned adults from being incorrectly downgraded to pups
        // when birth_day underflows (e.g., day 1 - 18 = 0 via saturating_sub)
        let current_stage_rank = match breeding_data.age_stage {
            WalrusAgeStage::Pup => 0,
            WalrusAgeStage::Juvenile => 1,
            WalrusAgeStage::Adult => 2,
        };
        let new_stage_rank = match calculated_stage {
            WalrusAgeStage::Pup => 0,
            WalrusAgeStage::Juvenile => 1,
            WalrusAgeStage::Adult => 2,
        };
        
        // Only update if new stage is more mature (higher rank)
        if new_stage_rank <= current_stage_rank {
            // Skip - don't age animals backwards
            continue;
        }
        
        // Log stage transitions (only logs actual aging UP)
        log::info!("🦭 Walrus {} grows from {:?} to {:?} (age: {} days)", 
                  breeding_data.animal_id, breeding_data.age_stage, calculated_stage, new_age);
        
        updates.push((breeding_data.animal_id, new_age, calculated_stage));
    }
    
    // Apply updates
    for (animal_id, new_age, new_stage) in updates {
        if let Some(mut data) = ctx.db.walrus_breeding_data().animal_id().find(&animal_id) {
            data.current_age_days = new_age;
            data.age_stage = new_stage;
            ctx.db.walrus_breeding_data().animal_id().update(data);
            
            // Update health based on age stage
            update_walrus_health_for_age(ctx, animal_id, new_stage);
        }
    }
    
    Ok(())
}

/// Update walrus health based on age stage
fn update_walrus_health_for_age(ctx: &ReducerContext, animal_id: u64, age_stage: WalrusAgeStage) {
    if let Some(mut animal) = ctx.db.wild_animal().id().find(&animal_id) {
        let behavior = ArcticWalrusBehavior;
        let base_max_health = behavior.get_stats().max_health;
        
        let health_multiplier = match age_stage {
            WalrusAgeStage::Pup => WALRUS_PUP_HEALTH_MULTIPLIER,
            WalrusAgeStage::Juvenile => WALRUS_JUVENILE_HEALTH_MULTIPLIER,
            WalrusAgeStage::Adult => 1.0,
        };
        
        let new_max_health = base_max_health * health_multiplier;
        
        // Scale current health proportionally if health exceeds new max
        if animal.health > new_max_health {
            animal.health = new_max_health;
        }
        
        ctx.db.wild_animal().id().update(animal);
    }
}

/// Process pup mortality based on population density
fn process_walrus_pup_mortality(ctx: &ReducerContext) -> Result<(), String> {
    let mut rng = ctx.rng();
    let mut deaths = Vec::new();
    
    // Count walruses per chunk for overcap calculations
    let mut walrus_per_chunk: std::collections::HashMap<u32, u32> = std::collections::HashMap::new();
    for animal in ctx.db.wild_animal().iter() {
        if matches!(animal.species, AnimalSpecies::ArcticWalrus) {
            *walrus_per_chunk.entry(animal.chunk_index).or_insert(0) += 1;
        }
    }
    
    // Check each pup for mortality
    for breeding_data in ctx.db.walrus_breeding_data().iter() {
        if breeding_data.age_stage != WalrusAgeStage::Pup {
            continue;
        }
        
        // Get the animal's chunk
        if let Some(animal) = ctx.db.wild_animal().id().find(&breeding_data.animal_id) {
            let walrus_in_chunk = walrus_per_chunk.get(&animal.chunk_index).copied().unwrap_or(0);
            let over_cap = walrus_in_chunk.saturating_sub(WALRUS_SOFT_CAP_PER_CHUNK);
            
            // Calculate mortality chance
            let mortality_chance = WALRUS_PUP_MORTALITY_BASE_RATE + 
                (over_cap as f32 * WALRUS_PUP_MORTALITY_OVERCAP_RATE);
            
            if rng.gen::<f32>() < mortality_chance {
                deaths.push(breeding_data.animal_id);
                log::info!("🦭💀 Walrus pup {} died (mortality roll: {:.1}%, chunk had {} walruses)", 
                          breeding_data.animal_id, mortality_chance * 100.0, walrus_in_chunk);
            }
        }
    }
    
    // Process deaths
    for animal_id in deaths {
        // Remove breeding data
        ctx.db.walrus_breeding_data().animal_id().delete(&animal_id);
        
        // Remove the animal
        if let Some(_animal) = ctx.db.wild_animal().id().find(&animal_id) {
            ctx.db.wild_animal().id().delete(&animal_id);
        }
    }
    
    Ok(())
}

/// Process mating proximity checks during rut nights
fn process_walrus_mating_proximity(ctx: &ReducerContext, current_day: u32) -> Result<(), String> {
    let mut rng = ctx.rng();
    
    // Get all adult walruses with breeding data
    let mut females: Vec<(u64, f32, f32, u32)> = Vec::new(); // (id, x, y, chunk)
    let mut males: Vec<(u64, f32, f32)> = Vec::new(); // (id, x, y)
    
    for breeding_data in ctx.db.walrus_breeding_data().iter() {
        // Only adults can mate
        if breeding_data.age_stage != WalrusAgeStage::Adult {
            continue;
        }
        
        // Skip pregnant females
        if breeding_data.is_pregnant {
            continue;
        }
        
        // Check postpartum lockout for females
        if breeding_data.sex == WalrusSex::Female {
            if let Some(last_birth) = breeding_data.last_birth_day {
                if current_day < last_birth + WALRUS_POSTPARTUM_LOCKOUT_DAYS {
                    continue; // Still in postpartum lockout
                }
            }
        }
        
        // Get animal position
        if let Some(animal) = ctx.db.wild_animal().id().find(&breeding_data.animal_id) {
            match breeding_data.sex {
                WalrusSex::Female => females.push((breeding_data.animal_id, animal.pos_x, animal.pos_y, animal.chunk_index)),
                WalrusSex::Male => males.push((breeding_data.animal_id, animal.pos_x, animal.pos_y)),
            }
        }
    }
    
    // For each eligible female, check for nearby males
    for (female_id, female_x, female_y, female_chunk) in females {
        // Find closest male within mating range
        let mut closest_male_id: Option<u64> = None;
        let mut closest_dist_sq = WALRUS_MATING_PROXIMITY_RADIUS_SQUARED;
        
        for &(male_id, male_x, male_y) in &males {
            let dx = female_x - male_x;
            let dy = female_y - male_y;
            let dist_sq = dx * dx + dy * dy;
            
            if dist_sq < closest_dist_sq {
                closest_dist_sq = dist_sq;
                closest_male_id = Some(male_id);
            }
        }
        
        // Update mating progress for this female
        if let Some(mut female_data) = ctx.db.walrus_breeding_data().animal_id().find(&female_id) {
            // Check if already checked today
            if female_data.last_mating_check_day == Some(current_day) {
                continue;
            }
            female_data.last_mating_check_day = Some(current_day);
            
            if let Some(male_id) = closest_male_id {
                // Male is nearby
                if female_data.mating_partner_id == Some(male_id) {
                    // Same partner - increment consecutive nights
                    female_data.consecutive_mating_nights += 1;
                    log::debug!("🦭❤️ Female walrus {} and male {} - night {} of {}", 
                              female_id, male_id, female_data.consecutive_mating_nights, WALRUS_MATING_NIGHTS_REQUIRED);
                } else {
                    // New partner - reset progress
                    female_data.mating_partner_id = Some(male_id);
                    female_data.consecutive_mating_nights = 1;
                    log::debug!("🦭❤️ Female walrus {} found new partner male {} - starting courtship", female_id, male_id);
                }
                
                // Check if mating requirements met
                if female_data.consecutive_mating_nights >= WALRUS_MATING_NIGHTS_REQUIRED {
                    // Check cooldown
                    let can_attempt = match female_data.last_mating_attempt_day {
                        Some(last_day) => current_day >= last_day + WALRUS_MATING_COOLDOWN_DAYS,
                        None => true,
                    };
                    
                    if can_attempt {
                        // Attempt conception
                        female_data.last_mating_attempt_day = Some(current_day);
                        
                        // Check population cap penalty
                        let walrus_in_chunk = ctx.db.wild_animal().iter()
                            .filter(|a| a.chunk_index == female_chunk && matches!(a.species, AnimalSpecies::ArcticWalrus))
                            .count() as u32;
                        
                        let over_cap = walrus_in_chunk.saturating_sub(WALRUS_SOFT_CAP_PER_CHUNK);
                        let conception_penalty = over_cap as f32 * WALRUS_CONCEPTION_PENALTY_PER_OVER_CAP;
                        let final_conception_chance = (WALRUS_CONCEPTION_CHANCE - conception_penalty).max(0.05);
                        
                        if rng.gen::<f32>() < final_conception_chance {
                            // Conception successful!
                            let pregnancy_duration = WALRUS_PREGNANCY_MIN_DAYS + 
                                rng.gen_range(0..=(WALRUS_PREGNANCY_MAX_DAYS - WALRUS_PREGNANCY_MIN_DAYS));
                            
                            female_data.is_pregnant = true;
                            female_data.pregnancy_start_day = Some(current_day);
                            female_data.pregnancy_duration = Some(pregnancy_duration);
                            
                            log::info!("🦭🎉 Female walrus {} is now PREGNANT by male {}! Due in {} days (conception chance was {:.0}%)", 
                                      female_id, male_id, pregnancy_duration, final_conception_chance * 100.0);
                        } else {
                            log::info!("🦭 Walrus mating attempt between {} and {} failed (chance: {:.0}%)", 
                                      female_id, male_id, final_conception_chance * 100.0);
                        }
                        
                        // Reset mating progress
                        female_data.mating_partner_id = None;
                        female_data.consecutive_mating_nights = 0;
                    }
                }
            } else {
                // No male nearby - reset progress
                if female_data.mating_partner_id.is_some() {
                    log::debug!("🦭 Female walrus {} lost contact with partner - resetting courtship", female_id);
                }
                female_data.mating_partner_id = None;
                female_data.consecutive_mating_nights = 0;
            }
            
            ctx.db.walrus_breeding_data().animal_id().update(female_data);
        }
    }
    
    Ok(())
}

/// Process births for pregnant females
fn process_walrus_births(ctx: &ReducerContext, current_day: u32) -> Result<(), String> {
    let mut births = Vec::new();
    
    // Find females ready to give birth
    for breeding_data in ctx.db.walrus_breeding_data().iter() {
        if !breeding_data.is_pregnant {
            continue;
        }
        
        if let (Some(start_day), Some(duration)) = (breeding_data.pregnancy_start_day, breeding_data.pregnancy_duration) {
            if current_day >= start_day + duration {
                // Time to give birth!
                births.push(breeding_data.animal_id);
            }
        }
    }
    
    // Process each birth
    for mother_id in births {
        if let Some(mother_animal) = ctx.db.wild_animal().id().find(&mother_id) {
            let mut rng = ctx.rng();
            
            // Spawn pup near mother
            let spawn_offset = 60.0;
            let angle = rng.gen::<f32>() * 2.0 * PI;
            let pup_x = mother_animal.pos_x + spawn_offset * angle.cos();
            let pup_y = mother_animal.pos_y + spawn_offset * angle.sin();
            
            // Determine pup sex (50/50)
            let pup_sex = if rng.gen::<bool>() { WalrusSex::Male } else { WalrusSex::Female };
            
            // Create the pup
            match spawn_walrus_pup(ctx, pup_x, pup_y, mother_animal.chunk_index, pup_sex, current_day, mother_animal.tamed_by) {
                Ok(pup_id) => {
                    log::info!("🦭🐣 Walrus {} gave birth to {:?} pup {} at ({:.0}, {:.0})!", 
                              mother_id, pup_sex, pup_id, pup_x, pup_y);
                    
                    // Update mother's breeding data
                    if let Some(mut mother_data) = ctx.db.walrus_breeding_data().animal_id().find(&mother_id) {
                        mother_data.is_pregnant = false;
                        mother_data.pregnancy_start_day = None;
                        mother_data.pregnancy_duration = None;
                        mother_data.last_birth_day = Some(current_day);
                        ctx.db.walrus_breeding_data().animal_id().update(mother_data);
                    }
                }
                Err(e) => {
                    log::error!("🦭 Failed to spawn pup for mother walrus {}: {}", mother_id, e);
                }
            }
        }
    }
    
    Ok(())
}

/// Spawn a new walrus pup
/// 
/// IMPORTANT: Pups can ONLY be spawned through this birth function, which is called
/// when a pregnant female gives birth. This ensures pups are NEVER alone - they are
/// always born near their mother (and typically near other group adults).
/// 
/// Do NOT create any other code path that spawns pups without ensuring adults are nearby!
fn spawn_walrus_pup(
    ctx: &ReducerContext,
    pos_x: f32,
    pos_y: f32,
    chunk_index: u32,
    sex: WalrusSex,
    current_day: u32,
    tamed_by: Option<Identity>,
) -> Result<u64, String> {
    if tamed_by.is_none() && super::core::is_position_in_alk_wildlife_zone(ctx, pos_x, pos_y) {
        return Err("Wild walrus cannot give birth near an ALK compound".to_string());
    }
    let behavior = ArcticWalrusBehavior;
    let stats = behavior.get_stats();
    let pup_health = stats.max_health * WALRUS_PUP_HEALTH_MULTIPLIER;
    
    let new_pup = WildAnimal {
        id: 0, // auto_inc
        species: AnimalSpecies::ArcticWalrus,
        pos_x,
        pos_y,
        direction_x: 0.0,
        direction_y: 1.0,
        facing_direction: "down".to_string(),
        state: AnimalState::Patrolling,
        health: pup_health,
        spawn_x: pos_x,
        spawn_y: pos_y,
        target_player_id: None,
        last_attack_time: None,
        state_change_time: ctx.timestamp,
        hide_until: None,
        investigation_x: None,
        investigation_y: None,
        patrol_phase: 0.0,
        scent_ping_timer: 0,
        movement_pattern: MovementPattern::Wander,
        chunk_index,
        created_at: ctx.timestamp,
        last_hit_time: None,
        pack_id: None,
        is_pack_leader: false,
        pack_join_time: None,
        last_pack_check: None,
        fire_fear_overridden_by: None,
        tamed_by, // Inherit taming status from mother
        tamed_at: if tamed_by.is_some() { Some(ctx.timestamp) } else { None },
        heart_effect_until: None,
        crying_effect_until: None,
        last_food_check: None,
        held_item_name: None,
        held_item_quantity: None,
        flying_target_x: None,
        flying_target_y: None,
        is_flying: false,
        is_hostile_npc: false,
        target_structure_id: None,
        target_structure_type: None,
        stalk_angle: 0.0,
        stalk_distance: 0.0,
        despawn_at: None,
        shock_active_until: None,
        last_shock_time: None,
    };
    
    let inserted = ctx.db.wild_animal().try_insert(new_pup)
        .map_err(|e| format!("Failed to spawn walrus pup: {}", e))?;
    
    // Create breeding data for the pup
    create_walrus_breeding_data(ctx, inserted.id, sex, current_day, true)?;
    
    Ok(inserted.id)
}

/// Get health multiplier for a walrus's age stage (for combat drops)
pub fn get_walrus_age_health_multiplier(ctx: &ReducerContext, animal_id: u64) -> f32 {
    if let Some(data) = ctx.db.walrus_breeding_data().animal_id().find(&animal_id) {
        match data.age_stage {
            WalrusAgeStage::Pup => WALRUS_PUP_HEALTH_MULTIPLIER,
            WalrusAgeStage::Juvenile => WALRUS_JUVENILE_HEALTH_MULTIPLIER,
            WalrusAgeStage::Adult => 1.0,
        }
    } else {
        1.0 // Default to adult if no breeding data found
    }
}

/// Get the age stage of a walrus (for rendering/drops)
pub fn get_walrus_age_stage(ctx: &ReducerContext, animal_id: u64) -> WalrusAgeStage {
    if let Some(data) = ctx.db.walrus_breeding_data().animal_id().find(&animal_id) {
        data.age_stage
    } else {
        WalrusAgeStage::Adult // Default to adult if no data
    }
}

/// Get the sex of a walrus
pub fn get_walrus_sex(ctx: &ReducerContext, animal_id: u64) -> Option<WalrusSex> {
    ctx.db.walrus_breeding_data().animal_id().find(&animal_id)
        .map(|data| data.sex)
}

/// Check if a walrus is pregnant
pub fn is_walrus_pregnant(ctx: &ReducerContext, animal_id: u64) -> bool {
    ctx.db.walrus_breeding_data().animal_id().find(&animal_id)
        .map(|data| data.is_pregnant)
        .unwrap_or(false)
}

/// Calculate drop multiplier based on age stage
/// Returns (blubber_mult, tusk_mult, hide_mult)
pub fn get_walrus_drop_multipliers(age_stage: WalrusAgeStage) -> (f32, f32, f32) {
    match age_stage {
        WalrusAgeStage::Pup => (0.20, 0.0, 0.15),        // Minimal drops, no tusks
        WalrusAgeStage::Juvenile => (0.45, 0.30, 0.45),  // Moderate drops, small tusks
        WalrusAgeStage::Adult => (1.0, 1.0, 1.0),        // Full drops
    }
}

/// Clean up breeding data when a walrus dies
pub fn cleanup_walrus_breeding_data(ctx: &ReducerContext, animal_id: u64) {
    // Remove breeding data
    if ctx.db.walrus_breeding_data().animal_id().find(&animal_id).is_some() {
        ctx.db.walrus_breeding_data().animal_id().delete(&animal_id);
        log::debug!("🦭 Cleaned up breeding data for walrus {}", animal_id);
    }
    
    // Clear any mating references to this walrus
    for mut data in ctx.db.walrus_breeding_data().iter() {
        if data.mating_partner_id == Some(animal_id) {
            data.mating_partner_id = None;
            data.consecutive_mating_nights = 0;
            ctx.db.walrus_breeding_data().animal_id().update(data);
        }
    }
}

/// Assign random sex to a newly spawned adult walrus
pub fn assign_walrus_sex_on_spawn(ctx: &ReducerContext, animal_id: u64) -> Result<(), String> {
    let mut rng = ctx.rng();
    let sex = if rng.gen::<bool>() { WalrusSex::Male } else { WalrusSex::Female };
    let current_day = get_current_game_day(ctx);
    
    create_walrus_breeding_data(ctx, animal_id, sex, current_day, false)?;
    Ok(())
}

/// Assign a specific sex to a walrus (used for ensuring group breeding viability)
pub fn assign_walrus_sex_forced(ctx: &ReducerContext, animal_id: u64, sex: WalrusSex) -> Result<(), String> {
    let current_day = get_current_game_day(ctx);
    create_walrus_breeding_data(ctx, animal_id, sex, current_day, false)?;
    Ok(())
}
