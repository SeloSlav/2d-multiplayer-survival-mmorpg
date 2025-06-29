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

// Collision detection constants
const ANIMAL_COLLISION_RADIUS: f32 = 32.0; // Animals maintain 32px distance from each other
const ANIMAL_PLAYER_COLLISION_RADIUS: f32 = 40.0; // Animals maintain 40px distance from players
const COLLISION_PUSHBACK_FORCE: f32 = 20.0; // How far to push back when colliding

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

    // Find the closest detected player
    let detected_player = find_detected_player(animal, stats, nearby_players);

    // Delegate species-specific logic to behavior implementation
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
                    
                    // IMPROVED: More aggressive approach - get closer to attack range
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