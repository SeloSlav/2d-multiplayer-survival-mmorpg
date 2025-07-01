/******************************************************************************
 *                                                                            *
 * Core Wild Animal NPC System - Shared AI Framework                         *
 *                                                                            *
 * Provides the base framework for wild animals with extensible behaviors     *
 * through species-specific trait implementations. Handles core AI loop,      *
 * movement, collision detection, and database operations.                    *
 *                                                                            *
 ******************************************************************************/

use spacetimedb::{table, reducer, ReducerContext, Identity, Timestamp, Table, ScheduleAt, TimeDuration};
use std::time::Duration;
use std::f32::consts::PI;
use log;
use rand::{Rng, SeedableRng};

// Core game imports
use crate::{Player, PLAYER_RADIUS, WORLD_WIDTH_PX, WORLD_HEIGHT_PX};
use crate::utils::get_distance_squared;
use crate::sound_events::{self, SoundType};
use crate::spatial_grid::{SpatialGrid, EntityType};
use crate::fishing::is_water_tile;
use crate::shelter::{is_player_inside_shelter, SHELTER_AABB_CENTER_Y_OFFSET_FROM_POS_Y, SHELTER_AABB_HALF_WIDTH, SHELTER_AABB_HALF_HEIGHT};
use crate::animal_collision::{
    resolve_animal_collision, 
    validate_animal_spawn_position, 
    can_animal_move_to_position,
    check_animal_collision,
    check_player_collision,
    check_shelter_collision,
};

// Table trait imports
use crate::player as PlayerTableTrait;
use crate::wild_animal_npc::wild_animal as WildAnimalTableTrait;
use crate::wild_animal_npc::wild_animal_ai_schedule as WildAnimalAiScheduleTableTrait;
use crate::death_marker::death_marker as DeathMarkerTableTrait;
use crate::shelter::shelter as ShelterTableTrait;
use crate::active_equipment::active_equipment as ActiveEquipmentTableTrait;
use crate::items::item_definition as ItemDefinitionTableTrait;
use crate::campfire::campfire as CampfireTableTrait;

// Collision detection constants
const ANIMAL_COLLISION_RADIUS: f32 = 32.0; // Animals maintain 32px distance from each other
const ANIMAL_PLAYER_COLLISION_RADIUS: f32 = 40.0; // Animals maintain 40px distance from players
const COLLISION_PUSHBACK_FORCE: f32 = 20.0; // How far to push back when colliding

// Fire fear constants
const FIRE_FEAR_RADIUS: f32 = 200.0; // Animals fear fire within 200px (4 tiles)
const FIRE_FEAR_RADIUS_SQUARED: f32 = FIRE_FEAR_RADIUS * FIRE_FEAR_RADIUS;
const TORCH_FEAR_RADIUS: f32 = 120.0; // Smaller fear radius for torches
const TORCH_FEAR_RADIUS_SQUARED: f32 = TORCH_FEAR_RADIUS * TORCH_FEAR_RADIUS;
const GROUP_COURAGE_THRESHOLD: usize = 3; // 3+ animals = ignore fire fear
const GROUP_DETECTION_RADIUS: f32 = 300.0; // Distance to count group members

// Pack behavior constants  
const PACK_FORMATION_RADIUS: f32 = 400.0; // Distance wolves can form packs (increased for better encounters)
const PACK_FORMATION_CHANCE: f32 = 0.20; // 20% chance per encounter to form pack (increased)
const PACK_DISSOLUTION_CHANCE: f32 = 0.03; // 3% chance per AI tick for wolf to leave pack (reduced for longer packs)
const PACK_CHECK_INTERVAL_MS: i64 = 5000; // Check pack formation/dissolution every 5 seconds (longer intervals)
const MAX_PACK_SIZE: usize = 5; // Maximum wolves per pack (epic threat requiring 4-5 coordinated players)
const PACK_COHESION_RADIUS: f32 = 350.0; // Distance pack members try to stay near alpha (increased with formation radius)

// --- Constants ---
pub const AI_TICK_INTERVAL_MS: u64 = 125; // AI processes 8 times per second (improved from 4fps)
pub const MAX_ANIMALS_PER_CHUNK: u32 = 3;
pub const ANIMAL_SPAWN_COOLDOWN_SECS: u64 = 120; // 2 minutes between spawns

// --- Animal Types and Behaviors ---

#[derive(Debug, Clone, Copy, PartialEq, spacetimedb::SpacetimeType)]
pub enum AnimalSpecies {
    CinderFox,
    TundraWolf,
    CableViper,
}

#[derive(Debug, Clone, Copy, PartialEq, spacetimedb::SpacetimeType)]
pub enum AnimalState {
    Patrolling,
    Chasing,
    Attacking,
    Fleeing,
    Hiding,
    Burrowed,
    Investigating,
    Alert,
}

#[derive(Debug, Clone, Copy, PartialEq, spacetimedb::SpacetimeType)]
pub enum MovementPattern {
    Loop,
    Wander,
    FigureEight,
}

// --- Animal Statistics Structure ---
#[derive(Debug, Clone, spacetimedb::SpacetimeType)]
pub struct AnimalStats {
    pub max_health: f32,
    pub attack_damage: f32,
    pub attack_range: f32,
    pub attack_speed_ms: u64,
    pub movement_speed: f32,
    pub sprint_speed: f32,
    pub perception_range: f32,
    pub perception_angle_degrees: f32,
    pub patrol_radius: f32,
    pub chase_trigger_range: f32,
    pub flee_trigger_health_percent: f32,
    pub hide_duration_ms: u64,
}

// --- Main Animal Entity Table ---
#[spacetimedb::table(name = wild_animal, public)]
#[derive(Clone, Debug)]
pub struct WildAnimal {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub species: AnimalSpecies,
    pub pos_x: f32,
    pub pos_y: f32,
    pub direction_x: f32, // Normalized direction vector
    pub direction_y: f32,
    pub facing_direction: String, // "left" or "right" for sprite mirroring
    pub state: AnimalState,
    pub health: f32,
    pub spawn_x: f32, // Original spawn position for patrolling
    pub spawn_y: f32,
    pub target_player_id: Option<Identity>,
    pub last_attack_time: Option<Timestamp>,
    pub state_change_time: Timestamp,
    pub hide_until: Option<Timestamp>,
    pub investigation_x: Option<f32>, // Position being investigated
    pub investigation_y: Option<f32>,
    pub patrol_phase: f32, // For movement patterns (0.0 to 1.0)
    pub scent_ping_timer: u64, // For wolves' scent ability
    pub movement_pattern: MovementPattern,
    pub chunk_index: u32, // For spatial optimization
    pub created_at: Timestamp,
    pub last_hit_time: Option<Timestamp>, // For damage visual effects
    
    // Pack behavior fields
    pub pack_id: Option<u64>, // Pack this animal belongs to (None = solo)
    pub is_pack_leader: bool, // True if this animal is the alpha
    pub pack_join_time: Option<Timestamp>, // When this animal joined current pack
    pub last_pack_check: Option<Timestamp>, // Last time we checked for pack formation/dissolution
}

// --- AI Processing Schedule Table ---
#[spacetimedb::table(name = wild_animal_ai_schedule, scheduled(process_wild_animal_ai))]
#[derive(Clone)]
pub struct WildAnimalAiSchedule {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub scheduled_at: ScheduleAt,
}

// --- Species-Specific Behavior Trait ---
pub trait AnimalBehavior {
    /// Get species-specific stats
    fn get_stats(&self) -> AnimalStats;
    
    /// Get movement pattern for this species
    fn get_movement_pattern(&self) -> MovementPattern;
    
    /// Handle species-specific attack effects
    fn execute_attack_effects(
        &self,
        ctx: &ReducerContext,
        animal: &mut WildAnimal,
        target_player: &Player,
        stats: &AnimalStats,
        current_time: Timestamp,
        rng: &mut impl Rng,
    ) -> Result<f32, String>; // Returns damage dealt
    
    /// Handle species-specific AI state logic
    fn update_ai_state_logic(
        &self,
        ctx: &ReducerContext,
        animal: &mut WildAnimal,
        stats: &AnimalStats,
        detected_player: Option<&Player>,
        current_time: Timestamp,
        rng: &mut impl Rng,
    ) -> Result<(), String>;
    
    /// Handle species-specific flee behavior
    fn execute_flee_logic(
        &self,
        ctx: &ReducerContext,
        animal: &mut WildAnimal,
        stats: &AnimalStats,
        dt: f32,
        current_time: Timestamp,
        rng: &mut impl Rng,
    );
    
    /// Handle species-specific patrol movement
    fn execute_patrol_logic(
        &self,
        ctx: &ReducerContext,
        animal: &mut WildAnimal,
        stats: &AnimalStats,
        dt: f32,
        rng: &mut impl Rng,
    );
    
    /// Determine if should chase player based on species behavior
    fn should_chase_player(&self, animal: &WildAnimal, stats: &AnimalStats, player: &Player) -> bool;
    
    /// Handle species-specific damage response
    fn handle_damage_response(
        &self,
        ctx: &ReducerContext,
        animal: &mut WildAnimal,
        attacker: &Player,
        stats: &AnimalStats,
        current_time: Timestamp,
        rng: &mut impl Rng,
    ) -> Result<(), String>;
}

// --- Core Animal Behavior Implementation Helper ---
// Enum to hold all behavior types
pub enum AnimalBehaviorEnum {
    CinderFox(crate::wild_animal_npc::fox::CinderFoxBehavior),
    TundraWolf(crate::wild_animal_npc::wolf::TundraWolfBehavior),
    CableViper(crate::wild_animal_npc::viper::CableViperBehavior),
}

impl AnimalBehavior for AnimalBehaviorEnum {
    fn get_stats(&self) -> AnimalStats {
        match self {
            AnimalBehaviorEnum::CinderFox(behavior) => behavior.get_stats(),
            AnimalBehaviorEnum::TundraWolf(behavior) => behavior.get_stats(),
            AnimalBehaviorEnum::CableViper(behavior) => behavior.get_stats(),
        }
    }

    fn get_movement_pattern(&self) -> MovementPattern {
        match self {
            AnimalBehaviorEnum::CinderFox(behavior) => behavior.get_movement_pattern(),
            AnimalBehaviorEnum::TundraWolf(behavior) => behavior.get_movement_pattern(),
            AnimalBehaviorEnum::CableViper(behavior) => behavior.get_movement_pattern(),
        }
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
        match self {
            AnimalBehaviorEnum::CinderFox(behavior) => behavior.execute_attack_effects(ctx, animal, target_player, stats, current_time, rng),
            AnimalBehaviorEnum::TundraWolf(behavior) => behavior.execute_attack_effects(ctx, animal, target_player, stats, current_time, rng),
            AnimalBehaviorEnum::CableViper(behavior) => behavior.execute_attack_effects(ctx, animal, target_player, stats, current_time, rng),
        }
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
        match self {
            AnimalBehaviorEnum::CinderFox(behavior) => behavior.update_ai_state_logic(ctx, animal, stats, detected_player, current_time, rng),
            AnimalBehaviorEnum::TundraWolf(behavior) => behavior.update_ai_state_logic(ctx, animal, stats, detected_player, current_time, rng),
            AnimalBehaviorEnum::CableViper(behavior) => behavior.update_ai_state_logic(ctx, animal, stats, detected_player, current_time, rng),
        }
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
        match self {
            AnimalBehaviorEnum::CinderFox(behavior) => behavior.execute_flee_logic(ctx, animal, stats, dt, current_time, rng),
            AnimalBehaviorEnum::TundraWolf(behavior) => behavior.execute_flee_logic(ctx, animal, stats, dt, current_time, rng),
            AnimalBehaviorEnum::CableViper(behavior) => behavior.execute_flee_logic(ctx, animal, stats, dt, current_time, rng),
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
        match self {
            AnimalBehaviorEnum::CinderFox(behavior) => behavior.execute_patrol_logic(ctx, animal, stats, dt, rng),
            AnimalBehaviorEnum::TundraWolf(behavior) => behavior.execute_patrol_logic(ctx, animal, stats, dt, rng),
            AnimalBehaviorEnum::CableViper(behavior) => behavior.execute_patrol_logic(ctx, animal, stats, dt, rng),
        }
    }

    fn should_chase_player(&self, animal: &WildAnimal, stats: &AnimalStats, player: &Player) -> bool {
        match self {
            AnimalBehaviorEnum::CinderFox(behavior) => behavior.should_chase_player(animal, stats, player),
            AnimalBehaviorEnum::TundraWolf(behavior) => behavior.should_chase_player(animal, stats, player),
            AnimalBehaviorEnum::CableViper(behavior) => behavior.should_chase_player(animal, stats, player),
        }
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
        match self {
            AnimalBehaviorEnum::CinderFox(behavior) => behavior.handle_damage_response(ctx, animal, attacker, stats, current_time, rng),
            AnimalBehaviorEnum::TundraWolf(behavior) => behavior.handle_damage_response(ctx, animal, attacker, stats, current_time, rng),
            AnimalBehaviorEnum::CableViper(behavior) => behavior.handle_damage_response(ctx, animal, attacker, stats, current_time, rng),
        }
    }
}

impl AnimalSpecies {
    pub fn get_behavior(&self) -> AnimalBehaviorEnum {
        match self {
            AnimalSpecies::CinderFox => AnimalBehaviorEnum::CinderFox(crate::wild_animal_npc::fox::CinderFoxBehavior),
            AnimalSpecies::TundraWolf => AnimalBehaviorEnum::TundraWolf(crate::wild_animal_npc::wolf::TundraWolfBehavior),
            AnimalSpecies::CableViper => AnimalBehaviorEnum::CableViper(crate::wild_animal_npc::viper::CableViperBehavior),
        }
    }

    // Backward compatibility methods - delegate to behavior trait
    pub fn get_stats(&self) -> AnimalStats {
        self.get_behavior().get_stats()
    }

    pub fn get_movement_pattern(&self) -> MovementPattern {
        self.get_behavior().get_movement_pattern()
    }
}

// --- Initialization Functions ---

pub fn init_wild_animal_ai_schedule(ctx: &ReducerContext) -> Result<(), String> {
    let schedule_table = ctx.db.wild_animal_ai_schedule();
    if schedule_table.iter().count() == 0 {
        log::info!("Starting wild animal AI schedule (every {}ms).", AI_TICK_INTERVAL_MS);
        let interval = Duration::from_millis(AI_TICK_INTERVAL_MS);
        match schedule_table.try_insert(WildAnimalAiSchedule {
            id: 0,
            scheduled_at: ScheduleAt::Interval(interval.into()),
        }) {
            Ok(_) => log::info!("Wild animal AI schedule initialized."),
            Err(e) => log::error!("Failed to initialize wild animal AI schedule: {}", e),
        };
    }
    Ok(())
}

// --- AI Processing Reducer ---

#[spacetimedb::reducer]
pub fn process_wild_animal_ai(ctx: &ReducerContext, _schedule: WildAnimalAiSchedule) -> Result<(), String> {
    // Security check - only allow scheduler to call this
    if ctx.sender != ctx.identity() {
        return Err("Wild animal AI can only be processed by scheduler".to_string());
    }

    let current_time = ctx.timestamp;
    let mut rng = rand::rngs::StdRng::seed_from_u64(
        (current_time.to_micros_since_unix_epoch() as u64).wrapping_add(42)
    );

    // Build spatial grid for efficient collision detection
    let mut spatial_grid = SpatialGrid::new();
    spatial_grid.populate_from_world(&ctx.db, current_time);

    // Process each animal
    let animals: Vec<WildAnimal> = ctx.db.wild_animal().iter().collect();
    
    for mut animal in animals {
        // No hiding logic - all animals are always active

        let behavior = animal.species.get_behavior();
        let stats = behavior.get_stats();
        
        // Find nearby players for perception checks
        let nearby_players = find_nearby_players(ctx, &animal, &stats);
        
        // Update AI state based on current conditions
        update_animal_ai_state(ctx, &mut animal, &behavior, &stats, &nearby_players, current_time, &mut rng)?;
        
        // Process pack behavior (formation, dissolution, etc.)
        process_pack_behavior(ctx, &mut animal, current_time, &mut rng)?;
        
        // Check for and execute attacks
        if animal.state == AnimalState::Chasing {
            if let Some(target_id) = animal.target_player_id {
                if let Some(target_player) = ctx.db.player().identity().find(&target_id) {
                    let distance_sq = get_distance_squared(
                        animal.pos_x, animal.pos_y,
                        target_player.position_x, target_player.position_y
                    );
                    
                    // Check if in attack range and can attack
                    if distance_sq <= (stats.attack_range * stats.attack_range) && 
                       can_attack(&animal, current_time, &stats) {
                        // Execute the attack
                        execute_attack(ctx, &mut animal, &target_player, &behavior, &stats, current_time, &mut rng)?;
                    }
                }
            }
        }
        
        // Execute movement based on current state
        execute_animal_movement(ctx, &mut animal, &behavior, &stats, current_time, &mut rng)?;
        
        // Update the animal in database
        ctx.db.wild_animal().id().update(animal);
    }

    Ok(())
}

// --- AI State Management ---

fn update_animal_ai_state(
    ctx: &ReducerContext,
    animal: &mut WildAnimal,
    behavior: &AnimalBehaviorEnum,
    stats: &AnimalStats,
    nearby_players: &[Player],
    current_time: Timestamp,
    rng: &mut impl Rng,
) -> Result<(), String> {
    let health_percent = animal.health / stats.max_health;
    
    // Check if should flee due to low health
    if health_percent < stats.flee_trigger_health_percent && animal.state != AnimalState::Fleeing {
        animal.state = AnimalState::Fleeing;
        animal.state_change_time = current_time;
        animal.target_player_id = None;
        return Ok(());
    }

    // Fire fear check - if afraid of fire, don't chase players near fire sources
    if should_fear_fire(ctx, animal) {
        // If currently chasing, check if target is still near fire
        if animal.state == AnimalState::Chasing {
            if let Some(target_id) = animal.target_player_id {
                if let Some(target_player) = ctx.db.player().identity().find(&target_id) {
                    // Check if player is near a fire source
                    if is_fire_nearby(ctx, target_player.position_x, target_player.position_y) {
                        // Stop chasing, switch to patrolling/alert
                        animal.state = AnimalState::Patrolling;
                        animal.state_change_time = current_time;
                        animal.target_player_id = None;
                        return Ok(());
                    }
                }
            }
        }
        
        // Filter out players near fire sources when looking for new targets
        let fire_safe_players: Vec<Player> = nearby_players.iter()
            .filter(|player| !is_fire_nearby(ctx, player.position_x, player.position_y))
            .cloned()
            .collect();
        
        // Find detected player only from fire-safe players
        let detected_player = find_detected_player(animal, stats, &fire_safe_players);
        
        // Delegate species-specific logic with filtered players
        behavior.update_ai_state_logic(ctx, animal, stats, detected_player.as_ref(), current_time, rng)?;
        return Ok(());
    }

    // Normal behavior when not afraid of fire
    let detected_player = find_detected_player(animal, stats, nearby_players);
    behavior.update_ai_state_logic(ctx, animal, stats, detected_player.as_ref(), current_time, rng)?;

    Ok(())
}

// --- Movement Execution ---

fn execute_animal_movement(
    ctx: &ReducerContext,
    animal: &mut WildAnimal,
    behavior: &AnimalBehaviorEnum,
    stats: &AnimalStats,
    current_time: Timestamp,
    rng: &mut impl Rng,
) -> Result<(), String> {
    let dt = 0.125; // Updated to match new AI tick interval (8fps instead of 4fps)
    
    // Check fire fear first - this can override normal movement behavior
    if should_fear_fire(ctx, animal) {
        // Animal is afraid of fire - flee from nearest fire source
        if let Some((fire_x, fire_y)) = find_closest_fire_position(ctx, animal.pos_x, animal.pos_y) {
            // Calculate direction away from fire
            let away_x = animal.pos_x - fire_x;
            let away_y = animal.pos_y - fire_y;
            let distance = (away_x * away_x + away_y * away_y).sqrt();
            
            if distance > 0.0 {
                let flee_x = animal.pos_x + (away_x / distance) * 100.0; // Flee 100px away
                let flee_y = animal.pos_y + (away_y / distance) * 100.0;
                
                // Use fast flee speed
                move_towards_target(ctx, animal, flee_x, flee_y, stats.sprint_speed, dt);
                return Ok(()); // Skip normal movement logic
            }
        }
    }
    
    match animal.state {
        AnimalState::Patrolling => {
            behavior.execute_patrol_logic(ctx, animal, stats, dt, rng);
        },
        
        AnimalState::Chasing => {
            if let Some(target_id) = animal.target_player_id {
                if let Some(target_player) = ctx.db.player().identity().find(&target_id) {
                    let distance_sq = get_distance_squared(
                        animal.pos_x, animal.pos_y,
                        target_player.position_x, target_player.position_y
                    );
                    let distance = distance_sq.sqrt();
                    
                    // Fire fear override: If chasing but fire is nearby, hover at fire boundary
                    if should_fear_fire(ctx, animal) {
                        if let Some((fire_x, fire_y)) = find_closest_fire_position(ctx, animal.pos_x, animal.pos_y) {
                            let fire_distance = get_distance_squared(animal.pos_x, animal.pos_y, fire_x, fire_y).sqrt();
                            let fear_radius = if is_campfire_at_position(ctx, fire_x, fire_y) {
                                FIRE_FEAR_RADIUS
                            } else {
                                TORCH_FEAR_RADIUS
                            };
                            
                            // If too close to fire, back away slightly
                            if fire_distance < fear_radius * 0.8 {
                                let away_x = animal.pos_x - fire_x;
                                let away_y = animal.pos_y - fire_y;
                                let away_distance = (away_x * away_x + away_y * away_y).sqrt();
                                
                                if away_distance > 0.0 {
                                    let safe_x = animal.pos_x + (away_x / away_distance) * 30.0;
                                    let safe_y = animal.pos_y + (away_y / away_distance) * 30.0;
                                    move_towards_target(ctx, animal, safe_x, safe_y, stats.movement_speed, dt);
                                    return Ok(());
                                }
                            }
                            // If at safe distance from fire, circle/hover and wait
                            // (emergent behavior - just don't move toward player if it means getting closer to fire)
                            return Ok(());
                        }
                    }
                    
                    // Normal chase behavior if no fire fear
                    if distance > stats.attack_range * 0.9 { // Start moving when slightly outside attack range
                        // Move directly toward player - no stopping short
                        move_towards_target(ctx, animal, target_player.position_x, target_player.position_y, stats.sprint_speed, dt);
                    }
                    // If within 90% of attack range, stop moving and let attack system handle it
                }
            }
        },
        
        AnimalState::Investigating => {
            // Handle strafe movement for spittle combat (primarily for vipers)
            if let (Some(target_x), Some(target_y)) = (animal.investigation_x, animal.investigation_y) {
                // Enhanced movement speed for aggressive strafing
                let strafe_speed = match animal.species {
                    AnimalSpecies::CableViper => stats.sprint_speed * 0.8, // Fast strafing for vipers
                    _ => stats.movement_speed * 1.2, // Slightly faster for other species
                };
                
                move_towards_target(ctx, animal, target_x, target_y, strafe_speed, dt);
                
                // Check if reached strafe position
                let distance_to_target = get_distance_squared(animal.pos_x, animal.pos_y, target_x, target_y).sqrt();
                if distance_to_target <= 20.0 { // Within 20px of strafe target
                    // Clear investigation position - AI will set new one if needed
                    animal.investigation_x = None;
                    animal.investigation_y = None;
                }
            }
        },
        
        AnimalState::Fleeing => {
            behavior.execute_flee_logic(ctx, animal, stats, dt, current_time, rng);
        },
        
        AnimalState::Alert => {
            // Generic alert behavior - species can override this in update_ai_state_logic
            if animal.species == AnimalSpecies::TundraWolf {
                animal.scent_ping_timer += (dt * 1000.0) as u64;
                if animal.scent_ping_timer >= 3000 { // Every 3 seconds
                    animal.scent_ping_timer = 0;
                }
            }
        },
        
        _ => {} // Other states don't move
    }

    // Keep animal within world bounds
    clamp_to_world_bounds(animal);
    
    Ok(())
}

// --- Combat Functions ---

fn execute_attack(
    ctx: &ReducerContext,
    animal: &mut WildAnimal,
    target_player: &Player,
    behavior: &AnimalBehaviorEnum,
    stats: &AnimalStats,
    current_time: Timestamp,
    rng: &mut impl Rng,
) -> Result<(), String> {
    // Apply damage to player
    if let Some(mut target) = ctx.db.player().identity().find(&target_player.identity) {
        // Get species-specific damage and effects
        let damage = behavior.execute_attack_effects(ctx, animal, target_player, stats, current_time, rng)?;
        
        // Apply damage
        let old_health = target.health;
        target.health = (target.health - damage).max(0.0);
        target.last_hit_time = Some(current_time);
        let actual_damage = old_health - target.health;
        
        // Apply knockback to player if damage was dealt
        if actual_damage > 0.0 && target.is_online {
            apply_knockback_to_player(animal, &mut target, current_time);
        }
        
        // Save values before moving target
        let target_id = target.identity;
        let target_pos_x = target.position_x;
        let target_pos_y = target.position_y;
        
        // Check if player dies
        if target.health <= 0.0 {
            handle_player_death(ctx, &mut target, animal, current_time)?;
        }
        
        ctx.db.player().identity().update(target);
        
        // Update animal's last attack time
        animal.last_attack_time = Some(current_time);
        
        // Play animal attack sound (animals use melee hit sharp sound)
        crate::sound_events::emit_melee_hit_sharp_sound(ctx, target_pos_x, target_pos_y, ctx.identity());
        log::debug!("Animal {} hit player {} - played melee_hit_sharp sound", animal.id, target_id);
    }
    
    Ok(())
}

// --- Helper Functions ---

fn find_nearby_players(ctx: &ReducerContext, animal: &WildAnimal, stats: &AnimalStats) -> Vec<Player> {
    ctx.db.player()
        .iter()
        .filter(|player| {
            !player.is_dead && 
            get_distance_squared(animal.pos_x, animal.pos_y, player.position_x, player.position_y) 
                <= (stats.perception_range * 1.5).powi(2)
        })
        .collect()
}

fn find_detected_player(animal: &WildAnimal, stats: &AnimalStats, nearby_players: &[Player]) -> Option<Player> {
    for player in nearby_players {
        let distance_sq = get_distance_squared(
            animal.pos_x, animal.pos_y,
            player.position_x, player.position_y
        );
        
        if distance_sq <= stats.perception_range * stats.perception_range {
            // Check if within perception cone (except for Cable Viper which has 360° detection)
            if animal.species == AnimalSpecies::CableViper || 
               is_within_perception_cone(animal, player, stats) {
                return Some(player.clone());
            }
        }
    }
    None
}

fn is_within_perception_cone(animal: &WildAnimal, player: &Player, stats: &AnimalStats) -> bool {
    if stats.perception_angle_degrees >= 360.0 {
        return true;
    }
    
    let to_player_x = player.position_x - animal.pos_x;
    let to_player_y = player.position_y - animal.pos_y;
    let distance = (to_player_x * to_player_x + to_player_y * to_player_y).sqrt();
    
    if distance == 0.0 {
        return true;
    }
    
    let to_player_normalized_x = to_player_x / distance;
    let to_player_normalized_y = to_player_y / distance;
    
    let dot_product = animal.direction_x * to_player_normalized_x + animal.direction_y * to_player_normalized_y;
    let angle_rad = dot_product.acos();
    let half_perception_angle_rad = (stats.perception_angle_degrees * PI / 180.0) / 2.0;
    
    angle_rad <= half_perception_angle_rad
}

pub fn can_attack(animal: &WildAnimal, current_time: Timestamp, stats: &AnimalStats) -> bool {
    if let Some(last_attack) = animal.last_attack_time {
        let time_since_attack = (current_time.to_micros_since_unix_epoch() - last_attack.to_micros_since_unix_epoch()) / 1000;
        time_since_attack >= stats.attack_speed_ms as i64
    } else {
        true
    }
}

pub fn move_towards_target(ctx: &ReducerContext, animal: &mut WildAnimal, target_x: f32, target_y: f32, speed: f32, dt: f32) {
    let dx = target_x - animal.pos_x;
    let dy = target_y - animal.pos_y;
    let distance = (dx * dx + dy * dy).sqrt();
    
    if distance > 0.0 {
        let move_distance = speed * dt;
        let normalize_factor = if distance <= move_distance {
            1.0
        } else {
            move_distance / distance
        };
        
        let proposed_x = animal.pos_x + dx * normalize_factor;
        let proposed_y = animal.pos_y + dy * normalize_factor;
        
        let is_attacking = animal.state == AnimalState::Attacking;
        let (final_x, final_y) = resolve_animal_collision(
            ctx,
            animal.id,
            animal.pos_x,
            animal.pos_y,
            proposed_x,
            proposed_y,
            is_attacking,
        );
        
        animal.pos_x = final_x;
        animal.pos_y = final_y;
        
        // Update chunk_index when position changes (CRITICAL FIX for chunk boundary invisibility)
        animal.chunk_index = crate::environment::calculate_chunk_index(final_x, final_y);
        
        animal.direction_x = dx / distance;
        animal.direction_y = dy / distance;
        
        // Update facing direction based on horizontal movement
        // Only change facing direction if there's significant horizontal movement
        if dx.abs() > 0.1 {
            animal.facing_direction = if dx > 0.0 { "right".to_string() } else { "left".to_string() };
        }
    }
}

fn clamp_to_world_bounds(animal: &mut WildAnimal) {
    let margin = 50.0;
    animal.pos_x = animal.pos_x.clamp(margin, WORLD_WIDTH_PX - margin);
    animal.pos_y = animal.pos_y.clamp(margin, WORLD_HEIGHT_PX - margin);
}

fn apply_knockback_to_player(animal: &WildAnimal, target: &mut Player, current_time: Timestamp) {
    let dx_target_from_animal = target.position_x - animal.pos_x;
    let dy_target_from_animal = target.position_y - animal.pos_y;
    let distance_sq = dx_target_from_animal * dx_target_from_animal + dy_target_from_animal * dy_target_from_animal;
    
    if distance_sq > 0.001 {
        let distance = distance_sq.sqrt();
        let knockback_distance = match animal.species {
            AnimalSpecies::TundraWolf => 48.0,
            AnimalSpecies::CinderFox => 32.0,
            AnimalSpecies::CableViper => 24.0,
        };
        
        let knockback_dx = (dx_target_from_animal / distance) * knockback_distance;
        let knockback_dy = (dy_target_from_animal / distance) * knockback_distance;
        
        let proposed_x = target.position_x + knockback_dx;
        let proposed_y = target.position_y + knockback_dy;
        
        let final_x = proposed_x.clamp(32.0, WORLD_WIDTH_PX - 32.0);
        let final_y = proposed_y.clamp(32.0, WORLD_HEIGHT_PX - 32.0);
        
        target.position_x = final_x;
        target.position_y = final_y;
        target.last_update = current_time;
        
        log::debug!("Applied knockback to player {} from {} (species: {:?}): distance={:.1}px", 
                   target.identity, animal.id, animal.species, knockback_distance);
    }
}

fn handle_player_death(ctx: &ReducerContext, target: &mut Player, animal: &WildAnimal, current_time: Timestamp) -> Result<(), String> {
    target.is_dead = true;
    target.death_timestamp = Some(current_time);
    log::info!("Player {} killed by {} (species: {:?})", 
              target.identity, animal.id, animal.species);
    
    // Clear all active effects on death (bleed, venom, burns, healing, etc.)
    crate::active_effects::clear_all_effects_on_death(ctx, target.identity);
    log::info!("[PlayerDeath] Cleared all active effects for player {:?} killed by wild animal", target.identity);
    
    // Create death marker for wild animal kill
    let death_cause = match animal.species {
        AnimalSpecies::CinderFox => "Cinder Fox",
        AnimalSpecies::TundraWolf => "Tundra Wolf", 
        AnimalSpecies::CableViper => "Cable Viper",
    };
    
    let new_death_marker = crate::death_marker::DeathMarker {
        player_id: target.identity,
        pos_x: target.position_x,
        pos_y: target.position_y,
        death_timestamp: current_time,
        killed_by: None,
        death_cause: death_cause.to_string(),
    };
    
    let death_marker_table = ctx.db.death_marker();
    if death_marker_table.player_id().find(&target.identity).is_some() {
        death_marker_table.player_id().update(new_death_marker);
        log::info!("[DeathMarker] Updated death marker for player {:?} killed by {}", target.identity, death_cause);
    } else {
        death_marker_table.insert(new_death_marker);
        log::info!("[DeathMarker] Created death marker for player {:?} killed by {}", target.identity, death_cause);
    }
    
    // Create player corpse
    if let Err(e) = crate::player_corpse::create_player_corpse(ctx, target.identity, target.position_x, target.position_y, &target.username) {
        log::error!("Failed to create corpse for player {:?} killed by wild animal: {}", target.identity, e);
    }
    
    // Clear active equipment
    if let Err(e) = crate::active_equipment::clear_active_item_reducer(ctx, target.identity) {
        log::error!("Failed to clear active item for player {:?} killed by wild animal: {}", target.identity, e);
    }
    
    Ok(())
}

// --- Spawning Functions ---

#[spacetimedb::reducer]
pub fn spawn_wild_animal(
    ctx: &ReducerContext,
    species: AnimalSpecies,
    pos_x: f32,
    pos_y: f32,
) -> Result<(), String> {
    if let Err(validation_error) = validate_animal_spawn_position(ctx, pos_x, pos_y) {
        return Err(format!("Cannot spawn {:?}: {}", species, validation_error));
    }
    
    let behavior = species.get_behavior();
    let stats = behavior.get_stats();
    let current_time = ctx.timestamp;
    
    let animal = WildAnimal {
        id: 0,
        species,
        pos_x,
        pos_y,
        direction_x: 1.0,
        direction_y: 0.0,
        facing_direction: "left".to_string(), // Default facing direction (matches current sprites)
        state: AnimalState::Patrolling,
        health: stats.max_health,
        spawn_x: pos_x,
        spawn_y: pos_y,
        target_player_id: None,
        last_attack_time: None,
        state_change_time: current_time,
        hide_until: None,
        investigation_x: None,
        investigation_y: None,
        patrol_phase: 0.0,
        scent_ping_timer: 0,
        movement_pattern: behavior.get_movement_pattern(),
        chunk_index: crate::environment::calculate_chunk_index(pos_x, pos_y),
        created_at: current_time,
        last_hit_time: None,
        
        // Initialize pack fields - animals start solo
        pack_id: None,
        is_pack_leader: false,
        pack_join_time: None,
        last_pack_check: None,
    };
    
    ctx.db.wild_animal().insert(animal);
    log::info!("Spawned {:?} at ({}, {})", species, pos_x, pos_y);
    
    Ok(())
}

#[spacetimedb::reducer]
pub fn damage_wild_animal(
    ctx: &ReducerContext,
    animal_id: u64,
    damage: f32,
    attacker_id: Identity,
) -> Result<(), String> {
    let mut rng = ctx.rng();
    
    if let Some(mut animal) = ctx.db.wild_animal().id().find(&animal_id) {
        let old_health = animal.health;
        animal.health = (animal.health - damage).max(0.0);
        animal.last_hit_time = Some(ctx.timestamp);
        let actual_damage = old_health - animal.health;
        
        // Apply knockback effects
        if actual_damage > 0.0 {
            apply_damage_knockback_effects(ctx, &animal, attacker_id)?;
            
            // Play weapon hit sound when player hits animal
            if let Some(attacker) = ctx.db.player().identity().find(&attacker_id) {
                if let Some(active_item) = ctx.db.active_equipment().player_identity().find(&attacker_id) {
                    if let Some(item_def_id) = active_item.equipped_item_def_id {
                        if let Some(item_def) = ctx.db.item_definition().id().find(item_def_id) {
                            // Use the shared weapon hit sound function from combat.rs
                            crate::combat::play_weapon_hit_sound(ctx, &item_def, animal.pos_x, animal.pos_y, attacker_id);
                        }
                    }
                }
            }
        }
        
        if animal.health <= 0.0 {
            log::info!("🦴 [ANIMAL DEATH] Animal {} (species: {:?}) died at ({:.1}, {:.1}) - attempting to create corpse", 
                      animal.id, animal.species, animal.pos_x, animal.pos_y);
            
            // Create animal corpse before deleting the animal
            if let Err(e) = super::animal_corpse::create_animal_corpse(
                ctx,
                animal.species,
                animal.id,
                animal.pos_x,
                animal.pos_y,
                ctx.timestamp,
            ) {
                log::error!("🦴 [ERROR] Failed to create animal corpse for {} (species: {:?}): {}", animal.id, animal.species, e);
            } else {
                log::info!("🦴 [SUCCESS] Animal corpse creation call completed successfully for animal {}", animal.id);
            }
            
            ctx.db.wild_animal().id().delete(&animal_id);
            log::info!("Wild animal {} killed by player {} - corpse created", animal_id, attacker_id);
        } else {
            // Handle species-specific damage response
            let behavior = animal.species.get_behavior();
            let stats = behavior.get_stats();
            
            if let Some(attacker) = ctx.db.player().identity().find(&attacker_id) {
                behavior.handle_damage_response(ctx, &mut animal, &attacker, &stats, ctx.timestamp, &mut rng)?;
            }
            
            ctx.db.wild_animal().id().update(animal);
        }
    }
    
    Ok(())
}

fn apply_damage_knockback_effects(ctx: &ReducerContext, animal: &WildAnimal, attacker_id: Identity) -> Result<(), String> {
    if let Some(mut attacker) = ctx.db.player().identity().find(&attacker_id) {
        if attacker.is_online {
            let dx_animal_from_attacker = animal.pos_x - attacker.position_x;
            let dy_animal_from_attacker = animal.pos_y - attacker.position_y;
            let distance_sq = dx_animal_from_attacker * dx_animal_from_attacker + dy_animal_from_attacker * dy_animal_from_attacker;
            
            if distance_sq > 0.001 {
                let distance = distance_sq.sqrt();
                
                // Apply knockback and recoil based on attack range
                if distance <= 80.0 { // Melee range
                    let attacker_recoil_distance = 16.0;
                    let attacker_recoil_dx = (-dx_animal_from_attacker / distance) * attacker_recoil_distance;
                    let attacker_recoil_dy = (-dy_animal_from_attacker / distance) * attacker_recoil_distance;
                    
                    let proposed_attacker_x = attacker.position_x + attacker_recoil_dx;
                    let proposed_attacker_y = attacker.position_y + attacker_recoil_dy;
                    
                    attacker.position_x = proposed_attacker_x.clamp(32.0, WORLD_WIDTH_PX - 32.0);
                    attacker.position_y = proposed_attacker_y.clamp(32.0, WORLD_HEIGHT_PX - 32.0);
                    attacker.last_update = ctx.timestamp;
                    
                    ctx.db.player().identity().update(attacker);
                    
                    log::debug!("Applied recoil to player {} from melee attacking wild animal {}: distance={:.1}px", 
                               attacker_id, animal.id, attacker_recoil_distance);
                }
            }
        }
    }
    Ok(())
}

// Helper function to check if a position is inside any shelter (used by all animals for collision avoidance)
pub fn is_position_in_shelter(ctx: &ReducerContext, x: f32, y: f32) -> bool {
    for shelter in ctx.db.shelter().iter() {
        if shelter.is_destroyed {
            continue;
        }
        
        // Use the same collision bounds as the shelter system
        // These constants should match the ones in shelter.rs
        const SHELTER_AABB_CENTER_Y_OFFSET_FROM_POS_Y: f32 = 20.0;
        const SHELTER_AABB_HALF_WIDTH: f32 = 80.0;
        const SHELTER_AABB_HALF_HEIGHT: f32 = 60.0;
        
        let shelter_aabb_center_x = shelter.pos_x;
        let shelter_aabb_center_y = shelter.pos_y - SHELTER_AABB_CENTER_Y_OFFSET_FROM_POS_Y;
        let aabb_left = shelter_aabb_center_x - SHELTER_AABB_HALF_WIDTH;
        let aabb_right = shelter_aabb_center_x + SHELTER_AABB_HALF_WIDTH;
        let aabb_top = shelter_aabb_center_y - SHELTER_AABB_HALF_HEIGHT;
        let aabb_bottom = shelter_aabb_center_y + SHELTER_AABB_HALF_HEIGHT;
        
        if x >= aabb_left && x <= aabb_right && y >= aabb_top && y <= aabb_bottom {
            return true;
        }
    }
    false
}

// Fire fear helper functions

/// Check if there's a fire source (campfire or torch) within fear radius of an animal
fn is_fire_nearby(ctx: &ReducerContext, animal_x: f32, animal_y: f32) -> bool {
    // Check for burning campfires
    for campfire in ctx.db.campfire().iter() {
        if !campfire.is_burning || campfire.is_destroyed {
            continue;
        }
        
        let dx = animal_x - campfire.pos_x;
        let dy = animal_y - campfire.pos_y;
        let distance_sq = dx * dx + dy * dy;
        
        if distance_sq <= FIRE_FEAR_RADIUS_SQUARED {
            return true;
        }
    }
    
    // Check for players with lit torches
    for player in ctx.db.player().iter() {
        if !player.is_torch_lit || player.is_dead {
            continue;
        }
        
        let dx = animal_x - player.position_x;
        let dy = animal_y - player.position_y;
        let distance_sq = dx * dx + dy * dy;
        
        if distance_sq <= TORCH_FEAR_RADIUS_SQUARED {
            return true;
        }
    }
    
    false
}

/// Count nearby animals of the same species to determine group courage
fn count_nearby_group_members(ctx: &ReducerContext, animal: &WildAnimal) -> usize {
    let mut count = 1; // Count self
    
    for other_animal in ctx.db.wild_animal().iter() {
        if other_animal.id == animal.id || other_animal.species != animal.species {
            continue;
        }
        
        let dx = animal.pos_x - other_animal.pos_x;
        let dy = animal.pos_y - other_animal.pos_y;
        let distance_sq = dx * dx + dy * dy;
        
        if distance_sq <= GROUP_DETECTION_RADIUS * GROUP_DETECTION_RADIUS {
            count += 1;
        }
    }
    
    count
}

/// Find the closest fire source position for boundary calculation
pub fn find_closest_fire_position(ctx: &ReducerContext, animal_x: f32, animal_y: f32) -> Option<(f32, f32)> {
    let mut closest_fire_pos: Option<(f32, f32)> = None;
    let mut closest_distance_sq = f32::MAX;
    
    // Check burning campfires
    for campfire in ctx.db.campfire().iter() {
        if !campfire.is_burning || campfire.is_destroyed {
            continue;
        }
        
        let dx = animal_x - campfire.pos_x;
        let dy = animal_y - campfire.pos_y;
        let distance_sq = dx * dx + dy * dy;
        
        if distance_sq < closest_distance_sq {
            closest_distance_sq = distance_sq;
            closest_fire_pos = Some((campfire.pos_x, campfire.pos_y));
        }
    }
    
    // Check lit torches (players)
    for player in ctx.db.player().iter() {
        if !player.is_torch_lit || player.is_dead {
            continue;
        }
        
        let dx = animal_x - player.position_x;
        let dy = animal_y - player.position_y;
        let distance_sq = dx * dx + dy * dy;
        
        if distance_sq < closest_distance_sq {
            closest_distance_sq = distance_sq;
            closest_fire_pos = Some((player.position_x, player.position_y));
        }
    }
    
    closest_fire_pos
}

/// Check if an animal should fear fire (considers group courage)
fn should_fear_fire(ctx: &ReducerContext, animal: &WildAnimal) -> bool {
    // Count nearby group members
    let group_size = count_nearby_group_members(ctx, animal);
    
    // Groups of 3+ ignore fire fear
    if group_size >= GROUP_COURAGE_THRESHOLD {
        return false;
    }
    
    // Check if fire is nearby
    is_fire_nearby(ctx, animal.pos_x, animal.pos_y)
}

/// Check if there's a campfire at the given position (for determining fear radius)
fn is_campfire_at_position(ctx: &ReducerContext, x: f32, y: f32) -> bool {
    for campfire in ctx.db.campfire().iter() {
        if !campfire.is_burning || campfire.is_destroyed {
            continue;
        }
        
        let dx = x - campfire.pos_x;
        let dy = y - campfire.pos_y;
        
        // Check if position is very close to campfire (within 10px)
        if dx * dx + dy * dy <= 100.0 {
            return true;
        }
    }
    false
}

// --- Anti-Exploit Functions (Fire Trap Escape) ---

/// Detects if an animal is trapped by campfire and player has ranged weapon - the "animal farming" exploit
pub fn is_animal_trapped_by_fire_and_ranged(ctx: &ReducerContext, animal: &WildAnimal, player: &Player) -> bool {
    // Check if animal is near fire boundary (stuck due to fire fear)
    if let Some((fire_x, fire_y)) = find_closest_fire_position(ctx, animal.pos_x, animal.pos_y) {
        let fire_distance = get_distance_squared(animal.pos_x, animal.pos_y, fire_x, fire_y).sqrt();
        
        // Check if animal is at fire boundary (180-220px from fire = trapped at edge)
        const FIRE_FEAR_RADIUS: f32 = 200.0;
        if fire_distance >= FIRE_FEAR_RADIUS * 0.9 && fire_distance <= FIRE_FEAR_RADIUS * 1.1 {
            // Check if player has ranged weapon equipped
            if has_ranged_weapon_equipped(ctx, player.identity) {
                // Check if player is close enough to exploit (within 300px)
                let player_distance = get_distance_squared(animal.pos_x, animal.pos_y, player.position_x, player.position_y).sqrt();
                return player_distance <= 300.0;
            }
        }
    }
    false
}

/// Detects if a player has a ranged weapon (bow/crossbow) equipped
pub fn has_ranged_weapon_equipped(ctx: &ReducerContext, player_id: Identity) -> bool {
    if let Some(active_equipment) = ctx.db.active_equipment().player_identity().find(&player_id) {
        if let Some(item_def_id) = active_equipment.equipped_item_def_id {
            if let Some(item_def) = ctx.db.item_definition().id().find(item_def_id) {
                return item_def.name == "Bow" || item_def.name == "Crossbow";
            }
        }
    }
    false
}

// --- Pack Management Functions ---

/// Process pack formation and dissolution for wolves
pub fn process_pack_behavior(ctx: &ReducerContext, animal: &mut WildAnimal, current_time: Timestamp, rng: &mut impl Rng) -> Result<(), String> {
    // Only wolves can form packs
    if animal.species != AnimalSpecies::TundraWolf {
        return Ok(());
    }
    
    // Check if enough time has passed since last pack check
    if let Some(last_check) = animal.last_pack_check {
        let time_since_check = (current_time.to_micros_since_unix_epoch() - last_check.to_micros_since_unix_epoch()) / 1000;
        if time_since_check < PACK_CHECK_INTERVAL_MS {
            return Ok(());
        }
    }
    
    animal.last_pack_check = Some(current_time);
    
    // If wolf is in a pack, check for dissolution
    if let Some(pack_id) = animal.pack_id {
        if should_leave_pack(ctx, animal, current_time, rng)? {
            leave_pack(ctx, animal, current_time)?;
            log::info!("Wolf {} left pack {}", animal.id, pack_id);
        }
    } else {
        // Wolf is solo, check for pack formation
        if let Some(other_wolf) = find_nearby_packable_wolf(ctx, animal) {
            attempt_pack_formation(ctx, animal, other_wolf, current_time, rng)?;
        }
    }
    
    Ok(())
}

/// Check if a wolf should leave its current pack
fn should_leave_pack(ctx: &ReducerContext, animal: &WildAnimal, current_time: Timestamp, rng: &mut impl Rng) -> Result<bool, String> {
    // Leaders are MUCH less likely to leave (stable leadership)
    let dissolution_chance = if animal.is_pack_leader {
        PACK_DISSOLUTION_CHANCE * 0.15 // Only 15% of normal chance (was 30%)
    } else {
        PACK_DISSOLUTION_CHANCE
    };
    
    // Random chance to leave
    if rng.gen::<f32>() < dissolution_chance {
        return Ok(true);
    }
    
    // Leave if pack is too small or alpha is missing
    if let Some(pack_id) = animal.pack_id {
        let pack_members = get_pack_members(ctx, pack_id);
        
        // If pack has only 1 member (this wolf), dissolve
        if pack_members.len() <= 1 {
            return Ok(true);
        }
        
        // Don't dissolve larger packs easily - they're more valuable for gameplay
        if pack_members.len() >= 3 && rng.gen::<f32>() < 0.5 {
            // 50% chance to stay even if randomly selected to leave (pack loyalty)
            return Ok(false);
        }
        
        // If no alpha in pack, someone should become alpha
        if !pack_members.iter().any(|w| w.is_pack_leader) {
            // This wolf becomes the new alpha
            return Ok(false);
        }
    }
    
    Ok(false)
}

/// Remove a wolf from its pack
fn leave_pack(ctx: &ReducerContext, animal: &mut WildAnimal, current_time: Timestamp) -> Result<(), String> {
    let old_pack_id = animal.pack_id;
    
    animal.pack_id = None;
    animal.is_pack_leader = false;
    animal.pack_join_time = None;
    
    // If this was the alpha, promote another wolf
    if let Some(pack_id) = old_pack_id {
        promote_new_alpha(ctx, pack_id, current_time)?;
    }
    
    Ok(())
}

/// Find a nearby wolf that can form a pack or merge packs
fn find_nearby_packable_wolf(ctx: &ReducerContext, animal: &WildAnimal) -> Option<WildAnimal> {
    for other_animal in ctx.db.wild_animal().iter() {
        if other_animal.id == animal.id || other_animal.species != AnimalSpecies::TundraWolf {
            continue;
        }
        
        let distance_sq = get_distance_squared(
            animal.pos_x, animal.pos_y,
            other_animal.pos_x, other_animal.pos_y
        );
        
        if distance_sq <= PACK_FORMATION_RADIUS * PACK_FORMATION_RADIUS {
            // Case 1: Solo wolf meets solo wolf
            if animal.pack_id.is_none() && other_animal.pack_id.is_none() {
                return Some(other_animal);
            }
            
            // Case 2: Solo wolf meets pack member
            if animal.pack_id.is_none() && other_animal.pack_id.is_some() {
                let pack_size = get_pack_size(ctx, other_animal.pack_id.unwrap());
                if pack_size < MAX_PACK_SIZE {
                    return Some(other_animal);
                }
            }
            
            // Case 3: Pack member meets solo wolf  
            if animal.pack_id.is_some() && other_animal.pack_id.is_none() {
                let pack_size = get_pack_size(ctx, animal.pack_id.unwrap());
                if pack_size < MAX_PACK_SIZE {
                    return Some(other_animal);
                }
            }
            
            // Case 4: Two different packs meet - alpha challenge!
            if let (Some(pack_a), Some(pack_b)) = (animal.pack_id, other_animal.pack_id) {
                if pack_a != pack_b && animal.is_pack_leader && other_animal.is_pack_leader {
                    // Two alphas meeting - potential pack merger
                    let combined_size = get_pack_size(ctx, pack_a) + get_pack_size(ctx, pack_b);
                    if combined_size <= MAX_PACK_SIZE {
                        return Some(other_animal);
                    }
                }
            }
        }
    }
    None
}

/// Attempt to form a pack between two wolves or merge existing packs
fn attempt_pack_formation(
    ctx: &ReducerContext,
    animal: &mut WildAnimal,
    mut other_wolf: WildAnimal,
    current_time: Timestamp,
    rng: &mut impl Rng,
) -> Result<(), String> {
    // Random chance to form pack/merge (higher chance for pack mergers - alphas are territorial)
    let formation_chance = if animal.is_pack_leader && other_wolf.is_pack_leader {
        PACK_FORMATION_CHANCE * 0.6 // 60% of normal chance for alpha challenges
    } else {
        PACK_FORMATION_CHANCE
    };
    
    if rng.gen::<f32>() > formation_chance {
        return Ok(());
    }
    
    // Handle different scenarios
    match (animal.pack_id, other_wolf.pack_id) {
        // Case 1: Solo + Solo = New pack
        (None, None) => {
            let other_wolf_id = other_wolf.id;
            let pack_id = animal.id.max(other_wolf_id);
            let (alpha_id, _) = if rng.gen::<bool>() {
                (animal.id, other_wolf_id)
            } else {
                (other_wolf_id, animal.id)
            };
            
            animal.pack_id = Some(pack_id);
            animal.is_pack_leader = alpha_id == animal.id;
            animal.pack_join_time = Some(current_time);
            
            other_wolf.pack_id = Some(pack_id);
            other_wolf.is_pack_leader = alpha_id == other_wolf_id;
            other_wolf.pack_join_time = Some(current_time);
            
            ctx.db.wild_animal().id().update(other_wolf);
            log::info!("Wolves {} and {} formed new pack {} (alpha: {})", 
                      animal.id, other_wolf_id, pack_id, alpha_id);
        },
        
        // Case 2: Solo + Pack = Join existing pack
        (None, Some(existing_pack_id)) => {
            animal.pack_id = Some(existing_pack_id);
            animal.is_pack_leader = false;
            animal.pack_join_time = Some(current_time);
            log::info!("Solo wolf {} joined existing pack {}", animal.id, existing_pack_id);
        },
        
        // Case 3: Pack + Solo = Solo joins this pack  
        (Some(existing_pack_id), None) => {
            let other_wolf_id = other_wolf.id;
            other_wolf.pack_id = Some(existing_pack_id);
            other_wolf.is_pack_leader = false;
            other_wolf.pack_join_time = Some(current_time);
            ctx.db.wild_animal().id().update(other_wolf);
            log::info!("Solo wolf {} joined existing pack {}", other_wolf_id, existing_pack_id);
        },
        
        // Case 4: Pack + Pack = ALPHA CHALLENGE! 
        (Some(pack_a), Some(pack_b)) if pack_a != pack_b => {
            if animal.is_pack_leader && other_wolf.is_pack_leader {
                // Determine dominant alpha based on pack size, health, and random factor
                let pack_a_size = get_pack_size(ctx, pack_a);
                let pack_b_size = get_pack_size(ctx, pack_b);
                
                let animal_dominance = pack_a_size as f32 * 10.0 + animal.health * 0.1 + rng.gen::<f32>() * 20.0;
                let other_dominance = pack_b_size as f32 * 10.0 + other_wolf.health * 0.1 + rng.gen::<f32>() * 20.0;
                
                let (winning_pack, losing_pack, winning_alpha, losing_alpha) = if animal_dominance > other_dominance {
                    (pack_a, pack_b, animal.id, other_wolf.id)
                } else {
                    (pack_b, pack_a, other_wolf.id, animal.id)
                };
                
                // Merge smaller pack into larger pack
                merge_packs(ctx, winning_pack, losing_pack, winning_alpha, current_time)?;
                
                log::info!("🐺 ALPHA CHALLENGE: Pack {} (alpha {}) dominates pack {} (alpha {}) - packs merged!", 
                          winning_pack, winning_alpha, losing_pack, losing_alpha);
            }
        },
        
        _ => {} // Same pack or other edge cases
    }
    
    Ok(())
}

/// Get all members of a pack
fn get_pack_members(ctx: &ReducerContext, pack_id: u64) -> Vec<WildAnimal> {
    ctx.db.wild_animal()
        .iter()
        .filter(|animal| animal.pack_id == Some(pack_id))
        .collect()
}

/// Get the size of a pack
fn get_pack_size(ctx: &ReducerContext, pack_id: u64) -> usize {
    get_pack_members(ctx, pack_id).len()
}

/// Merge two packs after an alpha challenge
fn merge_packs(
    ctx: &ReducerContext,
    winning_pack_id: u64,
    losing_pack_id: u64,
    winning_alpha_id: u64,
    current_time: Timestamp,
) -> Result<(), String> {
    let losing_pack_members = get_pack_members(ctx, losing_pack_id);
    
    // Transfer all losing pack members to winning pack
    for mut losing_member in losing_pack_members {
        let losing_member_id = losing_member.id;
        
        // Demote losing alpha to follower
        losing_member.is_pack_leader = false;
        losing_member.pack_id = Some(winning_pack_id);
        losing_member.pack_join_time = Some(current_time);
        
        // Update in database
        ctx.db.wild_animal().id().update(losing_member);
        
        log::debug!("Wolf {} transferred from pack {} to pack {} (now follower)", 
                   losing_member_id, losing_pack_id, winning_pack_id);
    }
    
    // If merged pack exceeds size limit, some wolves leave to form new packs or go solo
    let merged_size = get_pack_size(ctx, winning_pack_id);
    if merged_size > MAX_PACK_SIZE {
        let excess_count = merged_size - MAX_PACK_SIZE;
        let all_members = get_pack_members(ctx, winning_pack_id);
        
        // Remove the newest members (last to join) to maintain pack stability
        let mut members_to_remove: Vec<_> = all_members
            .into_iter()
            .filter(|w| !w.is_pack_leader) // Never remove the alpha
            .collect();
        
        // Sort by join time (newest first) 
        members_to_remove.sort_by(|a, b| {
            b.pack_join_time.unwrap_or(current_time)
                .cmp(&a.pack_join_time.unwrap_or(current_time))
        });
        
        // Remove excess wolves
        for mut wolf_to_remove in members_to_remove.into_iter().take(excess_count) {
            let wolf_id = wolf_to_remove.id;
            wolf_to_remove.pack_id = None;
            wolf_to_remove.is_pack_leader = false;
            wolf_to_remove.pack_join_time = None;
            ctx.db.wild_animal().id().update(wolf_to_remove);
            
            log::info!("Wolf {} left pack {} due to overcrowding after merger", 
                      wolf_id, winning_pack_id);
        }
    }
    
    Ok(())
}

/// Promote a new alpha when the current alpha leaves
fn promote_new_alpha(ctx: &ReducerContext, pack_id: u64, current_time: Timestamp) -> Result<(), String> {
    let pack_members = get_pack_members(ctx, pack_id);
    
    if pack_members.is_empty() {
        return Ok(());
    }
    
    // Find the oldest pack member (first to join)
    if let Some(mut new_alpha) = pack_members
        .into_iter()
        .filter(|w| !w.is_pack_leader)
        .min_by_key(|w| w.pack_join_time.unwrap_or(current_time)) {
        
        new_alpha.is_pack_leader = true;
        let new_alpha_id = new_alpha.id;
        ctx.db.wild_animal().id().update(new_alpha);
        log::info!("Wolf {} promoted to alpha of pack {}", new_alpha_id, pack_id);
    }
    
    Ok(())
}

/// Get the alpha wolf of a pack
pub fn get_pack_alpha(ctx: &ReducerContext, pack_id: u64) -> Option<WildAnimal> {
    ctx.db.wild_animal()
        .iter()
        .find(|animal| animal.pack_id == Some(pack_id) && animal.is_pack_leader)
}

/// Check if a wolf should follow pack alpha's movement
pub fn should_follow_pack_alpha(animal: &WildAnimal, alpha: &WildAnimal) -> bool {
    if animal.is_pack_leader || animal.pack_id != alpha.pack_id {
        return false;
    }
    
    // Only follow if alpha is patrolling (not chasing/attacking)
    alpha.state == AnimalState::Patrolling || alpha.state == AnimalState::Alert
}

/// Calculate pack cohesion movement towards alpha
pub fn get_pack_cohesion_movement(animal: &WildAnimal, alpha: &WildAnimal) -> Option<(f32, f32)> {
    let distance_sq = get_distance_squared(
        animal.pos_x, animal.pos_y,
        alpha.pos_x, alpha.pos_y
    );
    
    // If too far from alpha, move towards them
    if distance_sq > PACK_COHESION_RADIUS * PACK_COHESION_RADIUS {
        let distance = distance_sq.sqrt();
        let direction_x = (alpha.pos_x - animal.pos_x) / distance;
        let direction_y = (alpha.pos_y - animal.pos_y) / distance;
        return Some((direction_x, direction_y));
    }
    
    None
}