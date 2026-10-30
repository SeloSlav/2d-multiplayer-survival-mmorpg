/******************************************************************************
 *                                                                            *
 * Caribou Behavior - Skittish Herd Herbivore with Full Breeding System      *
 *                                                                            *
 * Caribou are large herbivores that live in herds in tundra and alpine      *
 * regions. They are skittish and will flee when players approach, running   *
 * very fast when spooked. They only become aggressive when critically       *
 * wounded (cornered), at which point they will charge and attack with       *
 * their antlers.                                                             *
 *                                                                            *
 * BEHAVIOR SUMMARY:                                                          *
 *   - Default: Slow patrol in herd, grazing behavior                        *
 *   - When player approaches: Get spooked and flee at high speed            *
 *   - When low health (<30%): Cornered - fights back aggressively           *
 *   - Tameable with vegetarian food (berries, vegetables, mushrooms)        *
 *                                                                            *
 * BREEDING SYSTEM (passive farming feature):                                 *
 *   - Sex: Male/Female assigned at birth/spawn                              *
 *   - Age Stages: Calf (6 days) → Juvenile (10 days) → Adult                *
 *   - Rut Cycle: Every 24 game days (12 real hours), lasts 4 days           *
 *   - Mating: Male + Female proximity for 2 nights during rut               *
 *   - Pregnancy: 8-10 game days (4-5 real hours)                            *
 *   - Birth Limit: 1 calf per female per rut cycle                          *
 *   - Population Control: Soft cap per chunk with penalties                  *
 *                                                                            *
 * TIMING (1 game day = 30 real minutes):                                    *
 *   - Full growth to adult: ~16 game days = 8 real hours                    *
 *   - Pregnancy: ~9 game days = 4.5 real hours                              *
 *   - Rut cycle: 24 days = 12 real hours (twice per real day of play)       *
 *                                                                            *
 ******************************************************************************/

use spacetimedb::{ReducerContext, Identity, Timestamp, Table, table, ScheduleAt, TimeDuration};
use std::f32::consts::PI;
use rand::Rng;
use log;

use crate::{Player};
use crate::utils::get_distance_squared;
use crate::environment::calculate_chunk_index;

// Table trait imports
use crate::player as PlayerTableTrait;
use super::core::{
    AnimalBehavior, AnimalStats, AnimalState, MovementPattern, WildAnimal, AnimalSpecies,
    move_towards_target, can_attack, transition_to_state, emit_species_sound,
    execute_standard_patrol, get_player_distance, is_player_in_chase_range, wild_animal,
    TAMING_PROTECT_RADIUS, ThreatType, detect_threats_to_owner, find_closest_threat,
    handle_generic_threat_targeting, detect_and_handle_stuck_movement, set_flee_destination_away_from_threat,
};

// =============================================================================
// CARIBOU BREEDING SYSTEM - ENUMS AND CONSTANTS
// =============================================================================

/// Sex of a caribou - determines breeding role
#[derive(Debug, Clone, Copy, PartialEq, spacetimedb::SpacetimeType)]
pub enum CaribouSex {
    Male,
    Female,
}

/// Age stage of a caribou - determines size, drops, and breeding eligibility
#[derive(Debug, Clone, Copy, PartialEq, spacetimedb::SpacetimeType)]
pub enum CaribouAgeStage {
    Calf,      // 0-6 game days: Half size, minimal drops, vulnerable
    Juvenile,  // 6-16 game days: 75% size, moderate drops, cannot breed
    Adult,     // 16+ game days: Full size, full drops, can breed
}

// --- Breeding System Constants ---
// Timing based on 1 game day = 30 real minutes

/// Rut (breeding season) cycle length in game days
/// 24 game days = 12 real hours - roughly twice per real day of active play
pub const RUT_CYCLE_DAYS: u32 = 24;

/// Duration of rut period in game days (when breeding is possible)
/// 4 game days = 2 real hours - long enough to set up breeding
pub const RUT_DURATION_DAYS: u32 = 4;

/// Number of consecutive nights of proximity required for mating attempt
/// 2 nights = ~20 real minutes of being penned together during night
pub const MATING_NIGHTS_REQUIRED: u32 = 2;

/// Conception chance when mating requirements are met (0.0 - 1.0)
pub const CONCEPTION_CHANCE: f32 = 0.65;

/// Cooldown after mating attempt in game days (prevents spam attempts)
pub const MATING_COOLDOWN_DAYS: u32 = 1;

/// Minimum pregnancy duration in game days
pub const PREGNANCY_MIN_DAYS: u32 = 8;

/// Maximum pregnancy duration in game days
pub const PREGNANCY_MAX_DAYS: u32 = 10;

/// Days a female is locked out from breeding after giving birth
/// Equals RUT_CYCLE_DAYS to enforce 1 birth per cycle
pub const POSTPARTUM_LOCKOUT_DAYS: u32 = RUT_CYCLE_DAYS;

/// Calf stage duration in game days (half size, minimal drops)
pub const CALF_STAGE_DAYS: u32 = 6;

/// Juvenile stage duration in game days (75% size, moderate drops)  
pub const JUVENILE_STAGE_DAYS: u32 = 10;

/// Total days from birth to adulthood
pub const DAYS_TO_ADULT: u32 = CALF_STAGE_DAYS + JUVENILE_STAGE_DAYS;

/// Proximity radius for mating (pixels) - caribou must be within this distance
/// 350px allows wild herds to occasionally breed (patrol_radius is 250px)
/// while still incentivizing fencing for reliable breeding
pub const MATING_PROXIMITY_RADIUS: f32 = 350.0;
pub const MATING_PROXIMITY_RADIUS_SQUARED: f32 = MATING_PROXIMITY_RADIUS * MATING_PROXIMITY_RADIUS;

/// Soft cap for caribou population per chunk
pub const CARIBOU_SOFT_CAP_PER_CHUNK: u32 = 6;

/// Conception penalty per caribou over soft cap (reduces conception chance)
pub const CONCEPTION_PENALTY_PER_OVER_CAP: f32 = 0.20;

/// Base daily calf mortality rate (chance to die each game day)
pub const CALF_MORTALITY_BASE_RATE: f32 = 0.03;

/// Additional mortality per caribou over soft cap
pub const CALF_MORTALITY_OVERCAP_RATE: f32 = 0.02;

/// Health multiplier for calves (relative to adult max health)
pub const CALF_HEALTH_MULTIPLIER: f32 = 0.40;

/// Health multiplier for juveniles (relative to adult max health)
pub const JUVENILE_HEALTH_MULTIPLIER: f32 = 0.70;

// =============================================================================
// CARIBOU BREEDING DATA TABLE
// =============================================================================

/// Stores breeding-specific data for each caribou
/// Separate table to avoid bloating WildAnimal with null fields for other species
#[table(accessor = caribou_breeding_data, public)]
#[derive(Clone, Debug)]
pub struct CaribouBreedingData {
    #[primary_key]
    pub animal_id: u64,  // Links to WildAnimal.id
    
    // Identity
    pub sex: CaribouSex,
    pub age_stage: CaribouAgeStage,
    
    // Age tracking (in game day increments from birth)
    pub birth_day: u32,  // Game day when this caribou was born/spawned
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

/// Schedule table for caribou breeding system updates
#[table(accessor = caribou_breeding_schedule, scheduled(process_caribou_breeding))]
#[derive(Clone)]
pub struct CaribouBreedingSchedule {
    #[primary_key]
    #[auto_inc]
    pub schedule_id: u64,
    pub scheduled_at: ScheduleAt,
}

/// Global rut state tracking
#[table(accessor = caribou_rut_state, public)]
#[derive(Clone, Debug)]
pub struct CaribouRutState {
    #[primary_key]
    pub id: u32,  // Singleton (always 1)
    pub current_cycle_day: u32,     // Day within the 24-day rut cycle (0-23)
    pub is_rut_active: bool,        // True during the 4-day rut period
    pub last_update_timestamp: Timestamp,
}

// Table trait imports for breeding system
use crate::wild_animal_npc::caribou::caribou_breeding_data as CaribouBreedingDataTableTrait;
use crate::wild_animal_npc::caribou::caribou_breeding_schedule as CaribouBreedingScheduleTableTrait;
use crate::wild_animal_npc::caribou::caribou_rut_state as CaribouRutStateTableTrait;
use crate::world_state::world_state as WorldStateTableTrait;

// Caribou-specific constants
const CARIBOU_SPOOK_DISTANCE: f32 = 350.0; // Distance at which caribou get spooked by players
const CARIBOU_SPOOK_DISTANCE_SQUARED: f32 = CARIBOU_SPOOK_DISTANCE * CARIBOU_SPOOK_DISTANCE;
const CARIBOU_HERD_DETECTION_RADIUS: f32 = 1400.0; // Large radius so scattered caribou can reconvene after fleeing
const CARIBOU_HERD_CLOSE_DISTANCE: f32 = 400.0; // Distance at which caribou consider themselves "close enough" to herd
const CARIBOU_LOW_HEALTH_THRESHOLD: f32 = 0.30; // Below 30% health, caribou fight back

pub struct CaribouBehavior;

// Caribou-specific trait (for future extensions)
pub trait CaribouTrait {
    // Caribou-specific methods if needed
}

impl CaribouTrait for CaribouBehavior {}

impl AnimalBehavior for CaribouBehavior {
    fn get_stats(&self) -> AnimalStats {
        AnimalStats {
            max_health: 120.0, // Reduced for balanced hunting - ~4 hits with spear (25-35 damage)
            attack_damage: 30.0, // Strong antler charge when cornered
            attack_range: 78.0, // Increased from 68 to compensate for collision pushback preventing hits
            attack_speed_ms: 1500, // Moderate attack speed
            movement_speed: 50.0, // ~half prior (100) — slower pacing for testing
            sprint_speed: 275.0, // ~half prior (550) when spooked/fleeing
            perception_range: 400.0, // Good awareness of surroundings
            perception_angle_degrees: 270.0, // Wide field of view (prey animal)
            patrol_radius: 250.0, // Larger patrol area for grazing
            chase_trigger_range: 150.0, // Only "chase" when cornered (short range)
            flee_trigger_health_percent: 0.30, // Fight when below 30% health instead of fleeing
            hide_duration_ms: 0, // Caribou don't hide
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
        
        // Caribou antler charge - strong knockback
        log::info!("Caribou {} delivers antler charge to player {}!", 
                  animal.id, target_player.identity);
        
        // 20% chance to cause bleeding from antler wounds
        if rng.gen::<f32>() < 0.2 {
            if let Err(e) = crate::active_effects::apply_bleeding_effect(
                ctx, 
                target_player.identity, 
                15.0, // Moderate bleeding damage
                12.0, // Duration: 12 seconds
                3.0   // Tick every 3 seconds
            ) {
                log::error!("Failed to apply bleeding effect from caribou attack: {}", e);
            } else {
                log::info!("Caribou {} causes bleeding with antler charge!", animal.id);
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
        let health_percent = animal.health / stats.max_health;
        
        // 🦌 TAMED CARIBOU BEHAVIOR: Follow owner and protect them
        if let Some(owner_id) = animal.tamed_by {
            if let Some(player) = detected_player {
                if player.identity == owner_id {
                    // This is our owner - don't be afraid
                    if matches!(animal.state, AnimalState::Fleeing | AnimalState::Alert) {
                        transition_to_state(animal, AnimalState::Following, current_time, Some(owner_id), "owner detected - following");
                    }
                    return Ok(());
                }
            }
            
            // Check for threats to our owner
            if handle_generic_threat_targeting(ctx, animal, owner_id, current_time).is_some() {
                return Ok(());
            }
            
            // If in Following or Protecting state, let core taming system handle movement
            if matches!(animal.state, AnimalState::Following | AnimalState::Protecting) {
                return Ok(());
            }
            
            // Default to following if tamed
            transition_to_state(animal, AnimalState::Following, current_time, Some(owner_id), "tamed - defaulting to follow");
            return Ok(());
        }
        
        // 🦌 WILD CARIBOU BEHAVIOR
        match animal.state {
            AnimalState::Patrolling => {
                if let Some(player) = detected_player {
                    let distance_sq = get_distance_squared(
                        animal.pos_x, animal.pos_y,
                        player.position_x, player.position_y
                    );
                    
                    // Check if player is close enough to spook the caribou
                    if distance_sq <= CARIBOU_SPOOK_DISTANCE_SQUARED {
                        // Caribou are skittish - flee immediately!
                        set_flee_destination_away_from_threat(
                            animal, 
                            player.position_x, 
                            player.position_y, 
                            600.0, // Flee far away
                            rng
                        );
                        transition_to_state(animal, AnimalState::Fleeing, current_time, None, "spooked by player");
                        
                        // Emit spooked sound
                        emit_species_sound(ctx, animal, player.identity, "spooked");
                        
                        log::info!("🦌 Caribou {} spooked by player {} at distance {:.1}px - fleeing!", 
                                  animal.id, player.identity, distance_sq.sqrt());
                        
                        // Alert nearby herd members
                        alert_nearby_caribou_herd(ctx, animal, player.position_x, player.position_y, current_time);
                        
                        return Ok(());
                    }
                }
            },
            
            AnimalState::Fleeing => {
                // Check if we're cornered (low health while fleeing)
                if health_percent < CARIBOU_LOW_HEALTH_THRESHOLD {
                    if let Some(player) = detected_player {
                        let distance = get_player_distance(animal, player);
                        
                        // If player is close and we're low health, turn and fight!
                        if distance < 200.0 {
                            transition_to_state(animal, AnimalState::Chasing, current_time, Some(player.identity), "cornered caribou");
                            animal.investigation_x = None;
                            animal.investigation_y = None;
                            
                            emit_species_sound(ctx, animal, player.identity, "cornered");
                            
                            log::info!("🦌 Caribou {} cornered at low health ({:.1}%) - fighting back!", 
                                      animal.id, health_percent * 100.0);
                            return Ok(());
                        }
                    }
                }
                
                // Continue fleeing - check if reached destination
                if let (Some(target_x), Some(target_y)) = (animal.investigation_x, animal.investigation_y) {
                    let distance_to_target_sq = get_distance_squared(animal.pos_x, animal.pos_y, target_x, target_y);
                    
                    if distance_to_target_sq <= 60.0 * 60.0 {
                        // Reached flee destination - now return to herd
                        // Set investigation target to spawn point (herd gathering area)
                        let dist_from_spawn_sq = get_distance_squared(animal.pos_x, animal.pos_y, animal.spawn_x, animal.spawn_y);
                        
                        if dist_from_spawn_sq > CARIBOU_HERD_CLOSE_DISTANCE * CARIBOU_HERD_CLOSE_DISTANCE {
                            // Far from herd - move back towards spawn point
                            animal.investigation_x = Some(animal.spawn_x);
                            animal.investigation_y = Some(animal.spawn_y);
                            transition_to_state(animal, AnimalState::Investigating, current_time, None, "returning to herd");
                            log::debug!("🦌 Caribou {} returning to herd at ({:.0}, {:.0})", animal.id, animal.spawn_x, animal.spawn_y);
                        } else {
                            // Close enough to herd - resume grazing
                            animal.investigation_x = None;
                            animal.investigation_y = None;
                            transition_to_state(animal, AnimalState::Patrolling, current_time, None, "reached safety near herd");
                            log::debug!("🦌 Caribou {} safe near herd, resuming grazing", animal.id);
                        }
                    }
                } else {
                    // No flee target - timeout and return to patrol
                    let time_since_flee = current_time.to_micros_since_unix_epoch() - 
                                         animal.state_change_time.to_micros_since_unix_epoch();
                    
                    if time_since_flee > 4_000_000 { // 4 seconds timeout
                        // Return to herd before patrolling
                        let dist_from_spawn_sq = get_distance_squared(animal.pos_x, animal.pos_y, animal.spawn_x, animal.spawn_y);
                        if dist_from_spawn_sq > CARIBOU_HERD_CLOSE_DISTANCE * CARIBOU_HERD_CLOSE_DISTANCE {
                            animal.investigation_x = Some(animal.spawn_x);
                            animal.investigation_y = Some(animal.spawn_y);
                            transition_to_state(animal, AnimalState::Investigating, current_time, None, "timeout - returning to herd");
                        } else {
                            transition_to_state(animal, AnimalState::Patrolling, current_time, None, "flee timeout");
                        }
                    }
                }
            },
            
            AnimalState::Chasing => {
                // Cornered caribou - only chase if low health, otherwise return to fleeing
                if health_percent >= CARIBOU_LOW_HEALTH_THRESHOLD {
                    // Health recovered or wasn't that low - go back to fleeing
                    if let Some(player) = detected_player {
                        set_flee_destination_away_from_threat(
                            animal, 
                            player.position_x, 
                            player.position_y, 
                            500.0,
                            rng
                        );
                        transition_to_state(animal, AnimalState::Fleeing, current_time, None, "not cornered anymore");
                        log::debug!("Caribou {} health recovered - fleeing instead of fighting", animal.id);
                        return Ok(());
                    }
                }
                
                // Still low health - continue fighting
                if let Some(target_id) = animal.target_player_id {
                    if let Some(target_player) = ctx.db.player().identity().find(&target_id) {
                        let distance = get_player_distance(animal, &target_player);
                        
                        // Stop chasing if player gets too far (caribou don't pursue)
                        if distance > stats.chase_trigger_range * 2.0 {
                            transition_to_state(animal, AnimalState::Patrolling, current_time, None, "player escaped");
                        }
                    } else {
                        transition_to_state(animal, AnimalState::Patrolling, current_time, None, "target lost");
                    }
                }
            },
            
            AnimalState::Investigating => {
                // Caribou use Investigating state to return to herd after fleeing
                // Still check for nearby threats while returning
                if let Some(player) = detected_player {
                    let distance_sq = get_distance_squared(
                        animal.pos_x, animal.pos_y,
                        player.position_x, player.position_y
                    );
                    
                    // If player is too close, flee again
                    if distance_sq <= CARIBOU_SPOOK_DISTANCE_SQUARED {
                        set_flee_destination_away_from_threat(
                            animal, 
                            player.position_x, 
                            player.position_y, 
                            600.0,
                            rng
                        );
                        transition_to_state(animal, AnimalState::Fleeing, current_time, None, "spooked while returning to herd");
                        emit_species_sound(ctx, animal, player.identity, "spooked");
                        return Ok(());
                    }
                }
                
                // Check if reached herd destination
                if let (Some(target_x), Some(target_y)) = (animal.investigation_x, animal.investigation_y) {
                    let distance_sq = get_distance_squared(animal.pos_x, animal.pos_y, target_x, target_y);
                    
                    if distance_sq <= 100.0 * 100.0 { // Within 100px of target
                        animal.investigation_x = None;
                        animal.investigation_y = None;
                        transition_to_state(animal, AnimalState::Patrolling, current_time, None, "rejoined herd");
                        log::debug!("🦌 Caribou {} rejoined herd area", animal.id);
                    }
                } else {
                    // No destination - resume patrolling
                    transition_to_state(animal, AnimalState::Patrolling, current_time, None, "no return destination");
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
        // Use SPRINT SPEED for fleeing - caribou are very fast when spooked!
        if let (Some(target_x), Some(target_y)) = (animal.investigation_x, animal.investigation_y) {
            move_towards_target(ctx, animal, target_x, target_y, stats.sprint_speed, dt);
        } else {
            // No specific flee target - head away from spawn at sprint speed
            let angle = rng.gen::<f32>() * 2.0 * PI;
            let flee_x = animal.pos_x + angle.cos() * 500.0;
            let flee_y = animal.pos_y + angle.sin() * 500.0;
            move_towards_target(ctx, animal, flee_x, flee_y, stats.sprint_speed, dt);
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
        // Caribou patrol slowly - grazing behavior
        // Try to stay near other caribou (herd behavior)
        if rng.gen::<f32>() < 0.15 { // 15% chance to check for herd (increased for better reconvening)
            if let Some((herd_x, herd_y)) = find_nearby_caribou_herd_center(ctx, animal) {
                let distance_to_herd = ((animal.pos_x - herd_x).powi(2) + (animal.pos_y - herd_y).powi(2)).sqrt();
                
                // If too far from herd, bias movement toward them
                if distance_to_herd > CARIBOU_HERD_CLOSE_DISTANCE {
                    let dx = herd_x - animal.pos_x;
                    let dy = herd_y - animal.pos_y;
                    let distance = (dx * dx + dy * dy).sqrt();
                    
                    if distance > 0.0 {
                        // Bias direction toward herd
                        let herd_weight = 0.5;
                        let random_angle = rng.gen::<f32>() * 2.0 * PI;
                        let herd_angle = dy.atan2(dx);
                        
                        animal.direction_x = herd_weight * herd_angle.cos() + (1.0 - herd_weight) * random_angle.cos();
                        animal.direction_y = herd_weight * herd_angle.sin() + (1.0 - herd_weight) * random_angle.sin();
                        
                        // Normalize
                        let length = (animal.direction_x * animal.direction_x + animal.direction_y * animal.direction_y).sqrt();
                        if length > 0.0 {
                            animal.direction_x /= length;
                            animal.direction_y /= length;
                        }
                    }
                }
            }
        }
        
        // Random direction changes (slow, grazing behavior)
        if rng.gen::<f32>() < 0.05 { // Smoother grazing paths
            let angle = rng.gen::<f32>() * 2.0 * PI;
            animal.direction_x = angle.cos();
            animal.direction_y = angle.sin();
        }
        
        // Move at slow patrol speed
        let target_x = animal.pos_x + animal.direction_x * stats.movement_speed * dt;
        let target_y = animal.pos_y + animal.direction_y * stats.movement_speed * dt;
        
        // Check if target position is safe
        if !super::core::is_position_in_shelter(ctx, target_x, target_y) &&
           !crate::fishing::is_water_tile(ctx, target_x, target_y) {
            move_towards_target(ctx, animal, target_x, target_y, stats.movement_speed, dt);
        } else {
            // Pick new direction if blocked
            let angle = rng.gen::<f32>() * 2.0 * PI;
            animal.direction_x = angle.cos();
            animal.direction_y = angle.sin();
        }
    }

    fn should_chase_player(&self, ctx: &ReducerContext, animal: &WildAnimal, stats: &AnimalStats, player: &Player) -> bool {
        // Caribou only chase when cornered (low health)
        let health_percent = animal.health / stats.max_health;
        
        if health_percent < CARIBOU_LOW_HEALTH_THRESHOLD {
            // Cornered - will fight back
            let distance_sq = get_distance_squared(
                animal.pos_x, animal.pos_y,
                player.position_x, player.position_y
            );
            
            return distance_sq <= stats.chase_trigger_range.powi(2);
        }
        
        // Not cornered - caribou don't chase, they flee
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
        // Check if tamed - don't attack owner
        if let Some(owner_id) = animal.tamed_by {
            if attacker.identity == owner_id {
                // Our owner hit us - show crying effect but don't retaliate
                animal.crying_effect_until = Some(Timestamp::from_micros_since_unix_epoch(
                    current_time.to_micros_since_unix_epoch() + 3000000
                ));
                emit_species_sound(ctx, animal, attacker.identity, "confused");
                log::info!("🦌💧 Tamed Caribou {} was hit by owner {} - showing crying effect", animal.id, owner_id);
                return Ok(());
            }
            
            // Someone else attacked us - defend ourselves
            transition_to_state(animal, AnimalState::Protecting, current_time, Some(attacker.identity), "defending against attacker");
            emit_species_sound(ctx, animal, attacker.identity, "retaliation");
            log::info!("🦌 Tamed Caribou {} defending against attacker {}", animal.id, attacker.identity);
            return Ok(());
        }
        
        // Wild caribou damage response
        let health_percent = animal.health / stats.max_health;
        
        if health_percent < CARIBOU_LOW_HEALTH_THRESHOLD {
            // Cornered at low health - fight back!
            transition_to_state(animal, AnimalState::Chasing, current_time, Some(attacker.identity), "cornered caribou fight");
            emit_species_sound(ctx, animal, attacker.identity, "retaliation");
            log::info!("🦌 Caribou {} cornered at {:.1}% health - fighting back against {}!", 
                      animal.id, health_percent * 100.0, attacker.identity);
        } else {
            // Not cornered - flee!
            set_flee_destination_away_from_threat(animal, attacker.position_x, attacker.position_y, 600.0, rng);
            transition_to_state(animal, AnimalState::Fleeing, current_time, None, "caribou flee from damage");
            emit_species_sound(ctx, animal, attacker.identity, "spooked");
            log::info!("🦌 Caribou {} fleeing from attacker {} (health: {:.1}%)", 
                      animal.id, attacker.identity, health_percent * 100.0);
        }
        
        Ok(())
    }
    
    fn can_be_tamed(&self) -> bool {
        true // Caribou can be tamed with vegetarian foods
    }
    
    fn get_taming_foods(&self) -> Vec<&'static str> {
        // Caribou are herbivores - they eat berries, vegetables, and mushrooms
        vec![
            // Berries (caribou love these)
            "Lingonberries", "Cloudberries", "Bilberries", "Crowberries", 
            "Wild Strawberries", "Rowan Berries", "Cranberries",
            // Vegetables
            "Carrot", "Cooked Carrot", "Potato", "Cooked Potato",
            "Cabbage", "Cooked Cabbage", "Beet", "Cooked Beet",
            // Mushrooms (safe ones)
            "Chanterelle", "Cooked Chanterelle", "Porcini", "Cooked Porcini",
            "Shaggy Ink Cap", "Cooked Shaggy Ink Cap",
            // Arctic plants
            "Arctic Poppy",
            "Fireweed Shoots", "Scurvy Grass",
        ]
    }
    
    fn get_chase_abandonment_multiplier(&self) -> f32 {
        1.5 // Caribou give up chasing quickly - they prefer to flee
    }
}

/// Find the center of nearby caribou herd members
fn find_nearby_caribou_herd_center(ctx: &ReducerContext, current_caribou: &WildAnimal) -> Option<(f32, f32)> {
    let mut nearby_caribou = Vec::new();
    
    for caribou in ctx.db.wild_animal().iter() {
        if caribou.id != current_caribou.id && matches!(caribou.species, AnimalSpecies::Caribou) {
            let distance = ((current_caribou.pos_x - caribou.pos_x).powi(2) + 
                           (current_caribou.pos_y - caribou.pos_y).powi(2)).sqrt();
            
            if distance <= CARIBOU_HERD_DETECTION_RADIUS {
                nearby_caribou.push(caribou);
            }
        }
    }
    
    if nearby_caribou.is_empty() {
        return None;
    }
    
    // Calculate center of nearby caribou
    let total_x: f32 = nearby_caribou.iter().map(|c| c.pos_x).sum();
    let total_y: f32 = nearby_caribou.iter().map(|c| c.pos_y).sum();
    let count = nearby_caribou.len() as f32;
    
    Some((total_x / count, total_y / count))
}

/// Alert nearby caribou herd members when one is spooked
fn alert_nearby_caribou_herd(
    ctx: &ReducerContext, 
    spooked_caribou: &WildAnimal, 
    threat_x: f32, 
    threat_y: f32,
    current_time: Timestamp
) {
    let alert_radius = CARIBOU_HERD_DETECTION_RADIUS * 1.5; // Alert slightly further than normal herd range
    let mut rng = ctx.rng();
    
    for mut caribou in ctx.db.wild_animal().iter() {
        if caribou.id != spooked_caribou.id && matches!(caribou.species, AnimalSpecies::Caribou) {
            let distance = ((spooked_caribou.pos_x - caribou.pos_x).powi(2) + 
                           (spooked_caribou.pos_y - caribou.pos_y).powi(2)).sqrt();
            
            if distance <= alert_radius {
                // Alert this caribou too!
                if caribou.state == AnimalState::Patrolling || caribou.state == AnimalState::Idle {
                    // Set flee destination away from threat
                    let angle = (caribou.pos_y - threat_y).atan2(caribou.pos_x - threat_x);
                    let flee_distance = 400.0 + rng.gen::<f32>() * 200.0;
                    caribou.investigation_x = Some(caribou.pos_x + angle.cos() * flee_distance);
                    caribou.investigation_y = Some(caribou.pos_y + angle.sin() * flee_distance);
                    caribou.state = AnimalState::Fleeing;
                    caribou.state_change_time = current_time;
                    
                    let caribou_id = caribou.id; // Store ID before move
                    ctx.db.wild_animal().id().update(caribou);
                    
                    log::debug!("🦌 Caribou {} alerted by herd member - fleeing!", caribou_id);
                }
            }
        }
    }
}

// =============================================================================
// CARIBOU BREEDING SYSTEM IMPLEMENTATION
// =============================================================================

/// Initialize the caribou breeding system scheduler
/// Called during game initialization
pub fn init_caribou_breeding_schedule(ctx: &ReducerContext) -> Result<(), String> {
    // Check if schedule already exists
    if ctx.db.caribou_breeding_schedule().iter().next().is_some() {
        log::debug!("Caribou breeding schedule already exists, skipping initialization");
        return Ok(());
    }
    
    // Initialize rut state singleton if it doesn't exist
    if ctx.db.caribou_rut_state().iter().next().is_none() {
        ctx.db.caribou_rut_state().try_insert(CaribouRutState {
            id: 1,
            current_cycle_day: 0,
            is_rut_active: false,
            last_update_timestamp: ctx.timestamp,
        }).map_err(|e| format!("Failed to create rut state: {}", e))?;
        log::info!("🦌 Initialized caribou rut state singleton");
    }
    
    // Create breeding schedule - runs every 30 real seconds (once per game "night")
    // This timing ensures we check mating proximity each night cycle
    let interval = TimeDuration::from_micros(30_000_000); // 30 seconds in microseconds
    ctx.db.caribou_breeding_schedule().try_insert(CaribouBreedingSchedule {
        schedule_id: 0,
        scheduled_at: ScheduleAt::Interval(interval.into()),
    }).map_err(|e| format!("Failed to create breeding schedule: {}", e))?;
    
    log::info!("🦌 Caribou breeding system initialized with 30-second update interval");
    Ok(())
}

/// Create breeding data for a new caribou
/// Called when spawning or birthing a caribou
pub fn create_caribou_breeding_data(
    ctx: &ReducerContext,
    animal_id: u64,
    sex: CaribouSex,
    current_game_day: u32,
    is_newborn: bool,
) -> Result<CaribouBreedingData, String> {
    let (age_stage, age_days) = if is_newborn {
        (CaribouAgeStage::Calf, 0)
    } else {
        // Spawned adults are fully grown
        (CaribouAgeStage::Adult, DAYS_TO_ADULT)
    };
    
    let breeding_data = CaribouBreedingData {
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
    
    ctx.db.caribou_breeding_data().try_insert(breeding_data.clone())
        .map_err(|e| format!("Failed to create breeding data for caribou {}: {}", animal_id, e))?;
    
    log::info!("🦌 Created breeding data for caribou {} - {:?} {:?} (age: {} days)", 
              animal_id, sex, age_stage, age_days);
    
    Ok(breeding_data)
}

/// Get the current game day from world state
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

/// Main scheduled reducer for caribou breeding system
#[spacetimedb::reducer]
pub fn process_caribou_breeding(ctx: &ReducerContext, _schedule: CaribouBreedingSchedule) -> Result<(), String> {
    // Security: Only allow scheduler to call this
    if ctx.sender() != ctx.identity() {
        return Err("Caribou breeding reducer can only be called by scheduler".to_string());
    }
    
    let current_day = get_current_game_day(ctx);
    let is_night = is_night_time(ctx);
    
    // Update rut state
    update_rut_state(ctx, current_day)?;
    
    // Get rut state
    let rut_state = ctx.db.caribou_rut_state().iter().next()
        .ok_or_else(|| "Rut state not found".to_string())?;
    
    // Process different aspects of breeding
    process_age_progression(ctx, current_day)?;
    process_calf_mortality(ctx)?;
    
    // Only check mating during rut AND at night
    if rut_state.is_rut_active && is_night {
        process_mating_proximity(ctx, current_day)?;
    }
    
    // Always check for births (pregnant females can give birth anytime)
    process_births(ctx, current_day)?;
    
    log::debug!("🦌 Caribou breeding tick complete - Day {}, Rut: {}, Night: {}", 
               current_day, rut_state.is_rut_active, is_night);
    
    Ok(())
}

/// Update the rut state based on current day
fn update_rut_state(ctx: &ReducerContext, current_day: u32) -> Result<(), String> {
    let mut rut_state = ctx.db.caribou_rut_state().iter().next()
        .ok_or_else(|| "Rut state not found".to_string())?;
    
    // Calculate position in rut cycle (0 to RUT_CYCLE_DAYS-1)
    let cycle_day = current_day % RUT_CYCLE_DAYS;
    
    // Rut is active during the first RUT_DURATION_DAYS of each cycle
    let new_is_rut_active = cycle_day < RUT_DURATION_DAYS;
    
    // Log rut state changes
    if new_is_rut_active != rut_state.is_rut_active {
        if new_is_rut_active {
            log::info!("🦌🔥 RUT SEASON BEGINS! Caribou breeding is now possible for {} days", RUT_DURATION_DAYS);
        } else {
            log::info!("🦌 Rut season ends. Next rut in {} days", RUT_CYCLE_DAYS - cycle_day);
        }
    }
    
    rut_state.current_cycle_day = cycle_day;
    rut_state.is_rut_active = new_is_rut_active;
    rut_state.last_update_timestamp = ctx.timestamp;
    
    ctx.db.caribou_rut_state().id().update(rut_state);
    Ok(())
}

/// Process age progression for all caribou
/// NOTE: Only ages UP (Calf → Juvenile → Adult), never DOWN.
/// This prevents spawned adults from being incorrectly downgraded when birth_day
/// underflows due to saturating_sub during early game days.
fn process_age_progression(ctx: &ReducerContext, current_day: u32) -> Result<(), String> {
    let mut updates = Vec::new();
    
    for breeding_data in ctx.db.caribou_breeding_data().iter() {
        let new_age = current_day.saturating_sub(breeding_data.birth_day);
        
        // Skip if age hasn't changed
        if new_age == breeding_data.current_age_days {
            continue;
        }
        
        // Determine new age stage based on calculated age
        let calculated_stage = if new_age < CALF_STAGE_DAYS {
            CaribouAgeStage::Calf
        } else if new_age < DAYS_TO_ADULT {
            CaribouAgeStage::Juvenile
        } else {
            CaribouAgeStage::Adult
        };
        
        // CRITICAL: Only allow aging UP, never DOWN
        // This prevents spawned adults from being incorrectly downgraded to calves
        // when birth_day underflows (e.g., day 1 - 16 = 0 via saturating_sub)
        let current_stage_rank = match breeding_data.age_stage {
            CaribouAgeStage::Calf => 0,
            CaribouAgeStage::Juvenile => 1,
            CaribouAgeStage::Adult => 2,
        };
        let new_stage_rank = match calculated_stage {
            CaribouAgeStage::Calf => 0,
            CaribouAgeStage::Juvenile => 1,
            CaribouAgeStage::Adult => 2,
        };
        
        // Only update if new stage is more mature (higher rank)
        if new_stage_rank <= current_stage_rank {
            // Skip - don't age animals backwards
            continue;
        }
        
        // Log stage transitions (only logs actual aging UP)
        log::info!("🦌 Caribou {} grows from {:?} to {:?} (age: {} days)", 
                  breeding_data.animal_id, breeding_data.age_stage, calculated_stage, new_age);
        
        updates.push((breeding_data.animal_id, new_age, calculated_stage));
    }
    
    // Apply updates
    for (animal_id, new_age, new_stage) in updates {
        if let Some(mut data) = ctx.db.caribou_breeding_data().animal_id().find(&animal_id) {
            data.current_age_days = new_age;
            data.age_stage = new_stage;
            ctx.db.caribou_breeding_data().animal_id().update(data);
            
            // Update health based on age stage
            update_caribou_health_for_age(ctx, animal_id, new_stage);
        }
    }
    
    Ok(())
}

/// Update caribou health based on age stage
fn update_caribou_health_for_age(ctx: &ReducerContext, animal_id: u64, age_stage: CaribouAgeStage) {
    if let Some(mut animal) = ctx.db.wild_animal().id().find(&animal_id) {
        let behavior = CaribouBehavior;
        let base_max_health = behavior.get_stats().max_health;
        
        let health_multiplier = match age_stage {
            CaribouAgeStage::Calf => CALF_HEALTH_MULTIPLIER,
            CaribouAgeStage::Juvenile => JUVENILE_HEALTH_MULTIPLIER,
            CaribouAgeStage::Adult => 1.0,
        };
        
        let new_max_health = base_max_health * health_multiplier;
        
        // Scale current health proportionally if health exceeds new max
        if animal.health > new_max_health {
            animal.health = new_max_health;
        }
        
        ctx.db.wild_animal().id().update(animal);
    }
}

/// Process calf mortality based on population density
fn process_calf_mortality(ctx: &ReducerContext) -> Result<(), String> {
    let mut rng = ctx.rng();
    let mut deaths = Vec::new();
    
    // Count caribou per chunk for overcap calculations
    let mut caribou_per_chunk: std::collections::HashMap<u32, u32> = std::collections::HashMap::new();
    for animal in ctx.db.wild_animal().iter() {
        if matches!(animal.species, AnimalSpecies::Caribou) {
            *caribou_per_chunk.entry(animal.chunk_index).or_insert(0) += 1;
        }
    }
    
    // Check each calf for mortality
    for breeding_data in ctx.db.caribou_breeding_data().iter() {
        if breeding_data.age_stage != CaribouAgeStage::Calf {
            continue;
        }
        
        // Get the animal's chunk
        if let Some(animal) = ctx.db.wild_animal().id().find(&breeding_data.animal_id) {
            let caribou_in_chunk = caribou_per_chunk.get(&animal.chunk_index).copied().unwrap_or(0);
            let over_cap = caribou_in_chunk.saturating_sub(CARIBOU_SOFT_CAP_PER_CHUNK);
            
            // Calculate mortality chance
            let mortality_chance = CALF_MORTALITY_BASE_RATE + 
                (over_cap as f32 * CALF_MORTALITY_OVERCAP_RATE);
            
            if rng.gen::<f32>() < mortality_chance {
                deaths.push(breeding_data.animal_id);
                log::info!("🦌💀 Calf {} died (mortality roll: {:.1}%, chunk had {} caribou)", 
                          breeding_data.animal_id, mortality_chance * 100.0, caribou_in_chunk);
            }
        }
    }
    
    // Process deaths
    for animal_id in deaths {
        // Remove breeding data
        ctx.db.caribou_breeding_data().animal_id().delete(&animal_id);
        
        // Remove the animal (this should also clean up via death system)
        if let Some(animal) = ctx.db.wild_animal().id().find(&animal_id) {
            // Create a corpse if desired, or just remove
            ctx.db.wild_animal().id().delete(&animal_id);
        }
    }
    
    Ok(())
}

/// Process mating proximity checks during rut nights
fn process_mating_proximity(ctx: &ReducerContext, current_day: u32) -> Result<(), String> {
    let mut rng = ctx.rng();
    
    // Get all adult caribou with breeding data
    let mut females: Vec<(u64, f32, f32, u32)> = Vec::new(); // (id, x, y, chunk)
    let mut males: Vec<(u64, f32, f32)> = Vec::new(); // (id, x, y)
    
    for breeding_data in ctx.db.caribou_breeding_data().iter() {
        // Only adults can mate
        if breeding_data.age_stage != CaribouAgeStage::Adult {
            continue;
        }
        
        // Skip pregnant females
        if breeding_data.is_pregnant {
            continue;
        }
        
        // Check postpartum lockout for females
        if breeding_data.sex == CaribouSex::Female {
            if let Some(last_birth) = breeding_data.last_birth_day {
                if current_day < last_birth + POSTPARTUM_LOCKOUT_DAYS {
                    continue; // Still in postpartum lockout
                }
            }
        }
        
        // Get animal position
        if let Some(animal) = ctx.db.wild_animal().id().find(&breeding_data.animal_id) {
            match breeding_data.sex {
                CaribouSex::Female => females.push((breeding_data.animal_id, animal.pos_x, animal.pos_y, animal.chunk_index)),
                CaribouSex::Male => males.push((breeding_data.animal_id, animal.pos_x, animal.pos_y)),
            }
        }
    }
    
    // For each eligible female, check for nearby males
    for (female_id, female_x, female_y, female_chunk) in females {
        // Find closest male within mating range
        let mut closest_male_id: Option<u64> = None;
        let mut closest_dist_sq = MATING_PROXIMITY_RADIUS_SQUARED;
        
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
        if let Some(mut female_data) = ctx.db.caribou_breeding_data().animal_id().find(&female_id) {
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
                    log::debug!("🦌❤️ Female {} and male {} - night {} of {}", 
                              female_id, male_id, female_data.consecutive_mating_nights, MATING_NIGHTS_REQUIRED);
                } else {
                    // New partner - reset progress
                    female_data.mating_partner_id = Some(male_id);
                    female_data.consecutive_mating_nights = 1;
                    log::debug!("🦌❤️ Female {} found new partner male {} - starting courtship", female_id, male_id);
                }
                
                // Check if mating requirements met
                if female_data.consecutive_mating_nights >= MATING_NIGHTS_REQUIRED {
                    // Check cooldown
                    let can_attempt = match female_data.last_mating_attempt_day {
                        Some(last_day) => current_day >= last_day + MATING_COOLDOWN_DAYS,
                        None => true,
                    };
                    
                    if can_attempt {
                        // Attempt conception
                        female_data.last_mating_attempt_day = Some(current_day);
                        
                        // Check population cap penalty
                        let caribou_in_chunk = ctx.db.wild_animal().iter()
                            .filter(|a| a.chunk_index == female_chunk && matches!(a.species, AnimalSpecies::Caribou))
                            .count() as u32;
                        
                        let over_cap = caribou_in_chunk.saturating_sub(CARIBOU_SOFT_CAP_PER_CHUNK);
                        let conception_penalty = over_cap as f32 * CONCEPTION_PENALTY_PER_OVER_CAP;
                        let final_conception_chance = (CONCEPTION_CHANCE - conception_penalty).max(0.05);
                        
                        if rng.gen::<f32>() < final_conception_chance {
                            // Conception successful!
                            let pregnancy_duration = PREGNANCY_MIN_DAYS + 
                                rng.gen_range(0..=(PREGNANCY_MAX_DAYS - PREGNANCY_MIN_DAYS));
                            
                            female_data.is_pregnant = true;
                            female_data.pregnancy_start_day = Some(current_day);
                            female_data.pregnancy_duration = Some(pregnancy_duration);
                            
                            log::info!("🦌🎉 Female {} is now PREGNANT by male {}! Due in {} days (conception chance was {:.0}%)", 
                                      female_id, male_id, pregnancy_duration, final_conception_chance * 100.0);
                        } else {
                            log::info!("🦌 Mating attempt between {} and {} failed (chance: {:.0}%)", 
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
                    log::debug!("🦌 Female {} lost contact with partner - resetting courtship", female_id);
                }
                female_data.mating_partner_id = None;
                female_data.consecutive_mating_nights = 0;
            }
            
            ctx.db.caribou_breeding_data().animal_id().update(female_data);
        }
    }
    
    Ok(())
}

/// Process births for pregnant females
fn process_births(ctx: &ReducerContext, current_day: u32) -> Result<(), String> {
    let mut births = Vec::new();
    
    // Find females ready to give birth
    for breeding_data in ctx.db.caribou_breeding_data().iter() {
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
            
            // Spawn calf near mother
            let spawn_offset = 50.0;
            let angle = rng.gen::<f32>() * 2.0 * PI;
            let calf_x = mother_animal.pos_x + spawn_offset * angle.cos();
            let calf_y = mother_animal.pos_y + spawn_offset * angle.sin();
            
            // Determine calf sex (50/50)
            let calf_sex = if rng.gen::<bool>() { CaribouSex::Male } else { CaribouSex::Female };
            
            // Create the calf
            match spawn_caribou_calf(ctx, calf_x, calf_y, mother_animal.chunk_index, calf_sex, current_day, mother_animal.tamed_by) {
                Ok(calf_id) => {
                    log::info!("🦌🐣 Caribou {} gave birth to {:?} calf {} at ({:.0}, {:.0})!", 
                              mother_id, calf_sex, calf_id, calf_x, calf_y);
                    
                    // Update mother's breeding data
                    if let Some(mut mother_data) = ctx.db.caribou_breeding_data().animal_id().find(&mother_id) {
                        mother_data.is_pregnant = false;
                        mother_data.pregnancy_start_day = None;
                        mother_data.pregnancy_duration = None;
                        mother_data.last_birth_day = Some(current_day);
                        ctx.db.caribou_breeding_data().animal_id().update(mother_data);
                    }
                }
                Err(e) => {
                    log::error!("🦌 Failed to spawn calf for mother {}: {}", mother_id, e);
                }
            }
        }
    }
    
    Ok(())
}

/// Spawn a new caribou calf
/// 
/// IMPORTANT: Calves can ONLY be spawned through this birth function, which is called
/// when a pregnant female gives birth. This ensures calves are NEVER alone - they are
/// always born near their mother (and typically near other herd adults).
/// 
/// Do NOT create any other code path that spawns calves without ensuring adults are nearby!
fn spawn_caribou_calf(
    ctx: &ReducerContext,
    pos_x: f32,
    pos_y: f32,
    chunk_index: u32,
    sex: CaribouSex,
    current_day: u32,
    tamed_by: Option<Identity>,
) -> Result<u64, String> {
    if tamed_by.is_none() && super::core::is_position_in_alk_wildlife_zone(ctx, pos_x, pos_y) {
        return Err("Wild caribou cannot give birth near an ALK compound".to_string());
    }
    let behavior = CaribouBehavior;
    let stats = behavior.get_stats();
    let calf_health = stats.max_health * CALF_HEALTH_MULTIPLIER;
    
    let new_calf = WildAnimal {
        id: 0, // auto_inc
        species: AnimalSpecies::Caribou,
        pos_x,
        pos_y,
        direction_x: 0.0,
        direction_y: 1.0,
        facing_direction: "down".to_string(),
        state: AnimalState::Patrolling,
        health: calf_health,
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
    
    let inserted = ctx.db.wild_animal().try_insert(new_calf)
        .map_err(|e| format!("Failed to spawn calf: {}", e))?;
    
    // Create breeding data for the calf
    create_caribou_breeding_data(ctx, inserted.id, sex, current_day, true)?;
    
    Ok(inserted.id)
}

/// Get health multiplier for a caribou's age stage (for combat drops)
pub fn get_caribou_age_health_multiplier(ctx: &ReducerContext, animal_id: u64) -> f32 {
    if let Some(data) = ctx.db.caribou_breeding_data().animal_id().find(&animal_id) {
        match data.age_stage {
            CaribouAgeStage::Calf => CALF_HEALTH_MULTIPLIER,
            CaribouAgeStage::Juvenile => JUVENILE_HEALTH_MULTIPLIER,
            CaribouAgeStage::Adult => 1.0,
        }
    } else {
        1.0 // Default to adult if no breeding data found
    }
}

/// Get the age stage of a caribou (for rendering/drops)
pub fn get_caribou_age_stage(ctx: &ReducerContext, animal_id: u64) -> CaribouAgeStage {
    if let Some(data) = ctx.db.caribou_breeding_data().animal_id().find(&animal_id) {
        data.age_stage
    } else {
        CaribouAgeStage::Adult // Default to adult if no data
    }
}

/// Get the sex of a caribou
pub fn get_caribou_sex(ctx: &ReducerContext, animal_id: u64) -> Option<CaribouSex> {
    ctx.db.caribou_breeding_data().animal_id().find(&animal_id)
        .map(|data| data.sex)
}

/// Check if a caribou is pregnant
pub fn is_caribou_pregnant(ctx: &ReducerContext, animal_id: u64) -> bool {
    ctx.db.caribou_breeding_data().animal_id().find(&animal_id)
        .map(|data| data.is_pregnant)
        .unwrap_or(false)
}

/// Calculate drop multiplier based on age stage
/// Returns (meat_mult, fat_mult, bone_mult)
pub fn get_caribou_drop_multipliers(age_stage: CaribouAgeStage) -> (f32, f32, f32) {
    match age_stage {
        CaribouAgeStage::Calf => (0.25, 0.10, 0.20),       // Minimal drops
        CaribouAgeStage::Juvenile => (0.50, 0.40, 0.50),   // Moderate drops
        CaribouAgeStage::Adult => (1.0, 1.0, 1.0),         // Full drops
    }
}

/// Clean up breeding data when a caribou dies
pub fn cleanup_caribou_breeding_data(ctx: &ReducerContext, animal_id: u64) {
    // Remove breeding data
    if ctx.db.caribou_breeding_data().animal_id().find(&animal_id).is_some() {
        ctx.db.caribou_breeding_data().animal_id().delete(&animal_id);
        log::debug!("🦌 Cleaned up breeding data for caribou {}", animal_id);
    }
    
    // Clear any mating references to this caribou
    for mut data in ctx.db.caribou_breeding_data().iter() {
        if data.mating_partner_id == Some(animal_id) {
            data.mating_partner_id = None;
            data.consecutive_mating_nights = 0;
            ctx.db.caribou_breeding_data().animal_id().update(data);
        }
    }
}

/// Assign random sex to a newly spawned adult caribou
pub fn assign_caribou_sex_on_spawn(ctx: &ReducerContext, animal_id: u64) -> Result<(), String> {
    let mut rng = ctx.rng();
    let sex = if rng.gen::<bool>() { CaribouSex::Male } else { CaribouSex::Female };
    let current_day = get_current_game_day(ctx);
    
    create_caribou_breeding_data(ctx, animal_id, sex, current_day, false)?;
    Ok(())
}

/// Assign a specific sex to a caribou (used for ensuring herd breeding viability)
pub fn assign_caribou_sex_forced(ctx: &ReducerContext, animal_id: u64, sex: CaribouSex) -> Result<(), String> {
    let current_day = get_current_game_day(ctx);
    create_caribou_breeding_data(ctx, animal_id, sex, current_day, false)?;
    Ok(())
}
