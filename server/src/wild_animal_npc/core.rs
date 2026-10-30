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
use std::collections::{HashMap, HashSet};
use std::time::Duration;
use std::f32::consts::PI;
use log;
use rand::{Rng, SeedableRng};

// Core game imports
use crate::{Player, PLAYER_RADIUS, WORLD_WIDTH_PX, WORLD_HEIGHT_PX, TILE_SIZE_PX, WORLD_WIDTH_TILES};
use crate::environment::{calculate_chunk_index, CHUNK_SIZE_PX, WORLD_WIDTH_CHUNKS, WORLD_HEIGHT_CHUNKS};
use crate::{get_tile_type_at_position, TileType};
use crate::utils::get_distance_squared;
use crate::sound_events::{self, SoundType};
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
// Breeding data table traits for milking
use crate::wild_animal_npc::caribou::caribou_breeding_data as CaribouBreedingDataTableTrait;
use crate::wild_animal_npc::walrus::walrus_breeding_data as WalrusBreedingDataTableTrait;
use crate::death_marker::death_marker as DeathMarkerTableTrait;
use crate::shelter::shelter as ShelterTableTrait;
use crate::active_equipment::active_equipment as ActiveEquipmentTableTrait;
use crate::items::item_definition as ItemDefinitionTableTrait;
use crate::campfire::campfire as CampfireTableTrait;
use crate::campfire::Campfire; // ADDED: Concrete type for pre-fetching
use crate::dropped_item::dropped_item as DroppedItemTableTrait; // Add dropped item table trait
use crate::building::foundation_cell as FoundationCellTableTrait; // ADDED: For foundation fear
use crate::building::FoundationCell; // ADDED: Concrete type for pre-fetching
use crate::building::wall_cell as WallCellTableTrait; // ADDED: For structure attacks
use crate::door::door as DoorTableTrait; // ADDED: For structure attacks
use crate::fence::fence as FenceTableTrait; // ADDED: For structure attacks
use crate::lantern::lantern as LanternTableTrait; // ADDED: For ward attacks (DrownedWatch)
// Import player progression table traits
use crate::player_progression::player_stats as PlayerStatsTableTrait;
// Runestone imports for hostile NPC deterrence
use crate::rune_stone::{rune_stone as RuneStoneTableTrait, RUNE_STONE_DETERRENCE_RADIUS};
// Monument safe zone imports - hostile NPCs actively avoid these areas
use crate::alk::alk_station as AlkStationTableTrait;
use super::alk_wildlife::{find_clear_position, WildlifeExclusionZone};
use crate::monument_part as MonumentPartTableTrait;
use crate::world_state::world_state as WorldStateTableTrait; // ADDED: For world_state table access
use crate::MonumentType;

// Collision detection constants
const ANIMAL_COLLISION_RADIUS: f32 = 32.0; // Animals maintain 32px distance from each other
const ANIMAL_PLAYER_COLLISION_RADIUS: f32 = 40.0; // Animals maintain 40px distance from players
const COLLISION_PUSHBACK_FORCE: f32 = 20.0; // How far to push back when colliding

// Fire fear constants
const FIRE_FEAR_RADIUS: f32 = 200.0; // Animals fear fire within 200px (4 tiles)
const FIRE_FEAR_RADIUS_SQUARED: f32 = FIRE_FEAR_RADIUS * FIRE_FEAR_RADIUS;
const TORCH_FEAR_RADIUS: f32 = 120.0; // Smaller fear radius for torches
const TORCH_FEAR_RADIUS_SQUARED: f32 = TORCH_FEAR_RADIUS * TORCH_FEAR_RADIUS;
const FOUNDATION_FEAR_RADIUS: f32 = 100.0; // Animals fear foundations within 100px (smaller than fire)
const FOUNDATION_FEAR_RADIUS_SQUARED: f32 = FOUNDATION_FEAR_RADIUS * FOUNDATION_FEAR_RADIUS;
const GROUP_COURAGE_THRESHOLD: usize = 3; // 3+ animals = ignore fire fear
const GROUP_DETECTION_RADIUS: f32 = 300.0; // Distance to count group members

// === FLASHLIGHT BEAM HESITATION CONSTANTS ===
// Flashlight beam causes apparitions (hostile NPCs) to hesitate - they slow down and won't escalate aggression
// Unlike fire fear, this is DIRECTIONAL (cone-based) and only affects hostile NPCs
// This creates tactical gameplay: shine light on threats to buy time, but you can't fight while holding flashlight
pub const FLASHLIGHT_BEAM_RANGE: f32 = 400.0; // How far the flashlight beam reaches
pub const FLASHLIGHT_BEAM_RANGE_SQUARED: f32 = FLASHLIGHT_BEAM_RANGE * FLASHLIGHT_BEAM_RANGE;
pub const FLASHLIGHT_BEAM_HALF_ANGLE: f32 = 0.523599; // ~30 degrees (60° total cone) in radians
pub const FLASHLIGHT_HESITATION_SPEED_MULTIPLIER: f32 = 0.10; // 10% speed when in beam (severe slowdown - nearly frozen)

// === WARD DETERRENCE CONSTANTS ===
// Wards create hard deterrence zones where hostile NPCs WILL NOT ENTER.
// Unlike spawn reduction, this is a complete barrier - hostiles actively flee from ward zones.
// This allows players to "civilize" their bases and have safe areas during night.
// Ward radii are imported from lantern.rs:
//   - Ancestral Ward: 800px radius (~50 tiles) - solo camp protection
//   - Signal Disruptor: 1600px radius (~100 tiles) - homestead/duo protection
//   - Memory Beacon: 3500px radius (~218 tiles) - large multiplayer compound
// The deterrence check uses hostile_spawning::is_position_in_active_ward_zone()

// Pack behavior constants  
const PACK_FORMATION_RADIUS: f32 = 400.0; // Distance wolves can form packs (increased for better encounters)
const PACK_FORMATION_CHANCE: f32 = 0.20; // 20% chance per encounter to form pack (increased)
const PACK_DISSOLUTION_CHANCE: f32 = 0.03; // 3% chance per AI tick for wolf to leave pack (reduced for longer packs)
const PACK_CHECK_INTERVAL_MS: i64 = 5000; // Check pack formation/dissolution every 5 seconds (longer intervals)
const MAX_PACK_SIZE: usize = 5; // Maximum wolves per pack (epic threat requiring 4-5 coordinated players)
const PACK_COHESION_RADIUS: f32 = 350.0; // Distance pack members try to stay near alpha (increased with formation radius)

// Taming behavior constants
pub const TAMING_FOOD_DETECTION_RADIUS: f32 = 150.0; // How close animal needs to be to detect food
pub const TAMING_FOOD_DETECTION_RADIUS_SQUARED: f32 = TAMING_FOOD_DETECTION_RADIUS * TAMING_FOOD_DETECTION_RADIUS;
pub const TAMING_FOOD_CHECK_INTERVAL_MS: i64 = 500; // Check for food every 500ms
pub const TAMING_HEART_EFFECT_DURATION_MS: i64 = 3000; // Show hearts for 3 seconds after taming
pub const TAMING_FOLLOW_DISTANCE: f32 = 100.0; // How close tamed animals follow their owner
pub const TAMING_FOLLOW_DISTANCE_SQUARED: f32 = TAMING_FOLLOW_DISTANCE * TAMING_FOLLOW_DISTANCE;
pub const TAMING_PROTECT_RADIUS: f32 = 300.0; // How far tamed animals will go to protect owner
pub const TAMING_PROTECT_RADIUS_SQUARED: f32 = TAMING_PROTECT_RADIUS * TAMING_PROTECT_RADIUS;
// When owner is beyond this distance, tamed animals stay in place instead of following
// This allows penning animals - they won't chase the player across the map
pub const TAMING_STAY_DISTANCE: f32 = 400.0; // Beyond this, animal stays put
pub const TAMING_STAY_DISTANCE_SQUARED: f32 = TAMING_STAY_DISTANCE * TAMING_STAY_DISTANCE;

// --- Constants ---
// Animal AI tick interval - determines how often animals update their position/behavior
// 100ms (10x/sec): smoother than 8Hz; culling still skips far animals most of the cost
pub const AI_TICK_INTERVAL_MS: u64 = 100;
pub const MAX_ANIMALS_PER_CHUNK: u32 = 3;
pub const ANIMAL_SPAWN_COOLDOWN_SECS: u64 = 120; // 2 minutes between spawns

// VIEWPORT-BASED CULLING OPTIMIZATION
// Animals outside this range from ALL players are completely frozen (no processing)
// This is ~1.5x the viewport size to ensure smooth transitions as players move
const ANIMAL_ACTIVE_ZONE_RADIUS: f32 = 1400.0; // ~viewport diagonal + buffer
const ANIMAL_ACTIVE_ZONE_SQUARED: f32 = ANIMAL_ACTIVE_ZONE_RADIUS * ANIMAL_ACTIVE_ZONE_RADIUS;
// Minimum distance to a player for an animal to start wandering (vs staying still)
// Animals within active zone but outside this range will stay Idle (not wander)
const WANDER_ACTIVATION_DISTANCE: f32 = 900.0; // ~viewport width
const WANDER_ACTIVATION_DISTANCE_SQUARED: f32 = WANDER_ACTIVATION_DISTANCE * WANDER_ACTIVATION_DISTANCE;

// === MONUMENT EXCLUSION ZONES - Hostile NPCs actively avoid these areas ===
// These zones match the building restriction radii to prevent NPC griefing
// Hostile NPCs will patrol around these zones, not enter them at all
const ALK_CENTRAL_EXCLUSION_MULTIPLIER: f32 = 8.75; // ~2188px for central compound (25% larger asphalt)
const ALK_SUBSTATION_EXCLUSION_MULTIPLIER: f32 = 3.0; // ~600px for substations
const FISHING_VILLAGE_EXCLUSION_RADIUS: f32 = 1000.0; // 25% larger than original 800 for building restriction
const FISHING_VILLAGE_EXCLUSION_RADIUS_SQ: f32 = FISHING_VILLAGE_EXCLUSION_RADIUS * FISHING_VILLAGE_EXCLUSION_RADIUS;

// === ANIMAL WALKING SOUND CONSTANTS ===
// DISABLED: Animal walking sounds temporarily removed due to duplicate sound playback issues
// const ANIMAL_WALKING_SOUND_DISTANCE_THRESHOLD: f32 = 80.0; // Minimum distance for a footstep (normal walking)
// const ANIMAL_SPRINTING_SOUND_DISTANCE_THRESHOLD: f32 = 110.0; // Distance for footstep when sprinting (faster cadence)
// const ANIMAL_WALKING_SOUND_MIN_TIME_MS: u64 = 300; // Minimum time between footsteps (normal walking)
// const ANIMAL_SPRINTING_SOUND_MIN_TIME_MS: u64 = 250; // Minimum time between footsteps when sprinting

// Table to track walking sound cadence for each animal
// DISABLED: Animal walking sounds temporarily removed due to duplicate sound playback issues
// #[spacetimedb::table(accessor = animal_walking_sound_state, public)]
// #[derive(Clone, Debug)]
// pub struct AnimalWalkingSoundState {
//     #[primary_key]
//     animal_id: u64,
//     last_walking_sound_time_ms: u64,
//     total_distance_since_last_sound: f32, // Accumulated distance for cadence
//     last_pos_x: f32, // Track last position to calculate movement distance
//     last_pos_y: f32,
// }

// --- Pre-fetched AI Data (PERFORMANCE OPTIMIZATION) ---
// This struct holds all data pre-fetched once per AI tick to avoid repeated table scans
pub struct PreFetchedAIData {
    pub all_players: Vec<Player>,
    pub lit_torch_players: Vec<Player>,
    pub burning_campfires: Vec<Campfire>,
    pub active_foundations: Vec<FoundationCell>,
    pub active_foundation_positions: Vec<(f32, f32)>,
    pub alk_wildlife_zones: Vec<WildlifeExclusionZone>,
}

impl PreFetchedAIData {
    /// Pre-fetch all data needed for animal AI processing
    /// Called ONCE at the start of each AI tick, not per-animal
    pub fn fetch(ctx: &ReducerContext) -> Self {
        let all_players: Vec<Player> = ctx.db.player().iter()
            .filter(|p| !p.is_dead && p.is_online)
            .collect();
        let lit_torch_players: Vec<Player> = all_players
            .iter()
            .filter(|p| p.is_torch_lit)
            .cloned()
            .collect();
        let active_foundations: Vec<FoundationCell> = ctx.db.foundation_cell().iter()
            .filter(|f| !f.is_destroyed)
            .collect();
        let active_foundation_positions: Vec<(f32, f32)> = active_foundations
            .iter()
            .map(|f| {
                let x = (f.cell_x as f32 * crate::building::FOUNDATION_TILE_SIZE_PX as f32)
                    + (crate::building::FOUNDATION_TILE_SIZE_PX as f32 / 2.0);
                let y = (f.cell_y as f32 * crate::building::FOUNDATION_TILE_SIZE_PX as f32)
                    + (crate::building::FOUNDATION_TILE_SIZE_PX as f32 / 2.0);
                (x, y)
            })
            .collect();
        Self {
            // Only online players matter for active zone / wander checks - saves iterations
            all_players,
            lit_torch_players,
            burning_campfires: ctx.db.campfire().iter()
                .filter(|c| c.is_burning && !c.is_destroyed)
                .collect(),
            active_foundations,
            active_foundation_positions,
            alk_wildlife_zones: alk_wildlife_zones(ctx),
        }
    }
}

// --- Animal Types and Behaviors ---

#[derive(Debug, Clone, Copy, PartialEq, spacetimedb::SpacetimeType)]
pub enum AnimalSpecies {
    CinderFox,
    TundraWolf,
    CableViper,
    ArcticWalrus,
    BeachCrab,
    Tern,       // Scavenger bird that picks up dropped items and alerts other animals
    Crow,       // Thief bird that steals items from player inventory
    Vole,       // Tiny skittish rodent that burrows and flees
    Wolverine,  // Fearless aggressive predator that attacks on sight
    Caribou,    // Large herbivore - flees by default, attacks only when low health, spawns in herds
    SalmonShark,   // Aquatic predator: Fast, persistent hunter that only spawns/swims in water
    Jellyfish,     // Aquatic passive: Slow drifter that periodically emits electric shocks (AOE burn damage)
    // Night-only hostile NPCs (spawn at dusk, despawn at dawn)
    Shorebound,    // Stalker: Fast, low health, circles and pressures players
    Shardkin,      // Swarmer: Small, fast, aggressive swarms that attack on contact
    DrownedWatch,  // Brute: Slow, high durability, primary structure attacker
    // Special spawning animals
    Bee,           // Spawns at beehives, tiny fast attackers, killed only by fire
    // Alpine animals
    PolarBear,     // Alpine apex predator: Massive, high health, aggressive solitary hunter
    Hare,          // Alpine prey: Fast fleeing animal that burrows when threatened
    SnowyOwl,      // Alpine flying predator: Aggressive bird that attacks within 200px range
}

#[derive(Debug, Clone, Copy, PartialEq, spacetimedb::SpacetimeType)]
pub enum AnimalState {
    Idle,          // Stationary - waiting for player to enter perception range (PERFORMANCE: no movement processing)
    Patrolling,
    Chasing,
    Attacking,
    Fleeing,
    Hiding,
    Burrowed,
    Investigating,
    Alert,
    Following,     // Following tamed player
    Protecting,    // Attacking enemies of tamed player
    Flying,        // Birds patrolling in flight over vast distances
    FlyingChase,   // Birds aggressively chasing players in flight
    Grounded,      // Birds on the ground - either still or walking in tiny circles
    Scavenging,    // Terns picking up dropped items
    Stealing,      // Crows stealing from player inventory
    // Aquatic predator states (SalmonShark)
    Swimming,          // Patrolling in water - actively hunting
    SwimmingChase,     // Chasing prey in water - very fast, persistent
    Drifting,          // Jellyfish passive drifting state - slow random movement in water
    // Night hostile NPC states
    Stalking,          // Shorebound: Circling and pressuring player before attacking
    AttackingStructure, // DrownedWatch/Shardkin: Attacking walls or doors
    Despawning,        // Being removed at dawn
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
#[spacetimedb::table(accessor = wild_animal, public)]
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
    pub facing_direction: String, // "left", "right", "up", or "down" for directional sprites
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
    #[index(btree)]
    pub chunk_index: u32, // For spatial optimization
    pub created_at: Timestamp,
    pub last_hit_time: Option<Timestamp>, // For damage visual effects
    
    // Pack behavior fields
    pub pack_id: Option<u64>, // Pack this animal belongs to (None = solo)
    pub is_pack_leader: bool, // True if this animal is the alpha
    pub pack_join_time: Option<Timestamp>, // When this animal joined current pack
    pub last_pack_check: Option<Timestamp>, // Last time we checked for pack formation/dissolution
    
    // Fire fear override tracking
    pub fire_fear_overridden_by: Option<Identity>, // Player who caused fire fear override (None = normal fire fear)
    
    // Taming system fields
    pub tamed_by: Option<Identity>, // Player who tamed this animal (None = wild)
    pub tamed_at: Option<Timestamp>, // When this animal was tamed
    pub heart_effect_until: Option<Timestamp>, // When to stop showing heart effect
    pub crying_effect_until: Option<Timestamp>, // When to stop showing crying effect (hit by owner)
    pub last_food_check: Option<Timestamp>, // Last time we checked for nearby food
    
    // Bird scavenging/stealing system fields
    pub held_item_name: Option<String>, // Item name the bird is carrying (Tern scavenge / Crow steal)
    pub held_item_quantity: Option<u32>, // Quantity of the held item
    pub flying_target_x: Option<f32>, // Flying destination X for vast patrol distances
    pub flying_target_y: Option<f32>, // Flying destination Y for vast patrol distances
    pub is_flying: bool, // Whether the bird is currently in flight
    
    // Night hostile NPC fields (Shorebound, Shardkin, DrownedWatch)
    pub is_hostile_npc: bool, // True if this is a night-only hostile enemy
    pub target_structure_id: Option<u64>, // ID of structure being attacked (door or wall)
    pub target_structure_type: Option<String>, // "door" or "wall"
    pub stalk_angle: f32, // For Shorebound circling behavior (radians)
    pub stalk_distance: f32, // Current circling distance from player
    pub despawn_at: Option<Timestamp>, // When to remove this hostile (dawn cleanup)
    
    // Jellyfish shock effect fields
    pub shock_active_until: Option<Timestamp>, // When shock visual effect ends (yellow glow)
    pub last_shock_time: Option<Timestamp>, // Last time jellyfish emitted electric shock
}

/// Use the actual station positions, including inactive compounds. During world
/// generation the stations may not have been seeded yet, so reserve their
/// canonical positions before any wildlife is spawned.
pub fn alk_wildlife_zones(ctx: &ReducerContext) -> Vec<WildlifeExclusionZone> {
    let stations: Vec<_> = ctx.db.alk_station().iter().collect();
    if !stations.is_empty() {
        return stations.iter().map(|station| {
            let multiplier = if station.station_id == 0 {
                crate::active_effects::SAFE_ZONE_RADIUS_MULTIPLIER_CENTRAL
            } else { crate::active_effects::SAFE_ZONE_RADIUS_MULTIPLIER_SUBSTATION };
            WildlifeExclusionZone::new(station.world_pos_x, station.world_pos_y, station.interaction_radius * multiplier)
        }).collect();
    }
    let center_x = (crate::WORLD_WIDTH_TILES / 2) as f32 * TILE_SIZE_PX as f32 + TILE_SIZE_PX as f32 / 2.0;
    let center_y = (crate::WORLD_HEIGHT_TILES / 2) as f32 * TILE_SIZE_PX as f32 + TILE_SIZE_PX as f32 / 2.0;
    let diagonal = WORLD_WIDTH_PX.min(WORLD_HEIGHT_PX) * 0.35 * 0.90 / 1.414;
    let mut zones = vec![WildlifeExclusionZone::new(center_x, center_y, 250.0 * crate::active_effects::SAFE_ZONE_RADIUS_MULTIPLIER_CENTRAL)];
    for dx in [-diagonal, diagonal] { for dy in [-diagonal, diagonal] {
        zones.push(WildlifeExclusionZone::new(center_x + dx, center_y + dy, 200.0 * crate::active_effects::SAFE_ZONE_RADIUS_MULTIPLIER_SUBSTATION));
    }}
    zones
}

pub fn is_position_in_alk_wildlife_zone(ctx: &ReducerContext, x: f32, y: f32) -> bool {
    alk_wildlife_zones(ctx).iter().any(|zone| zone.contains(x, y))
}

/// Move pre-existing wild animals out of the new protected area. Search the
/// boundary for compatible terrain so sea creatures stay in water and land
/// wildlife is not teleported into it. Tamed companions are handled separately.
fn clear_animal_from_alk(ctx: &ReducerContext, animal: &mut WildAnimal, zones: &[WildlifeExclusionZone], now: Timestamp) -> bool {
    if !zones.iter().any(|zone| zone.contains(animal.pos_x, animal.pos_y)) { return false; }
    let aquatic = matches!(animal.species, AnimalSpecies::SalmonShark | AnimalSpecies::Jellyfish);
    let amphibious = matches!(animal.species, AnimalSpecies::ArcticWalrus | AnimalSpecies::BeachCrab) || animal.is_flying;
    let suitable = |x, y| {
        let water = is_water_tile(ctx, x, y);
        !(aquatic && !water) && !(!aquatic && !amphibious && water)
    };
    let destination = find_clear_position(zones, (animal.pos_x, animal.pos_y), (WORLD_WIDTH_PX, WORLD_HEIGHT_PX), suitable)
        .or_else(|| {
            let (x, y) = (animal.spawn_x, animal.spawn_y);
            if x >= 50.0 && y >= 50.0 && x < WORLD_WIDTH_PX - 50.0 && y < WORLD_HEIGHT_PX - 50.0
                && zones.iter().all(|zone| !zone.contains(x, y)) && suitable(x, y) { Some((x, y)) } else { None }
        });
    if let Some((x, y)) = destination {
        update_animal_position(animal, x, y);
        if zones.iter().any(|z| z.contains(animal.spawn_x, animal.spawn_y)) { animal.spawn_x = x; animal.spawn_y = y; }
        animal.target_player_id = None;
        animal.target_structure_id = None;
        animal.target_structure_type = None;
        animal.flying_target_x = None; animal.flying_target_y = None;
        let state = match animal.species {
            AnimalSpecies::SalmonShark => AnimalState::Swimming,
            AnimalSpecies::Jellyfish => AnimalState::Drifting,
            AnimalSpecies::Tern | AnimalSpecies::Crow | AnimalSpecies::SnowyOwl => AnimalState::Grounded,
            _ => AnimalState::Patrolling,
        };
        transition_to_state(animal, state, now, None, "moved clear of ALK compound");
    } else {
        log::warn!("Could not find suitable terrain outside ALK wildlife zone for {:?} #{}", animal.species, animal.id);
    }
    true
}

fn clear_alk_target(animal: &mut WildAnimal, players: &[Player], zones: &[WildlifeExclusionZone], now: Timestamp) {
    if let Some(target) = animal.target_player_id {
        if players.iter().any(|player| player.identity == target && zones.iter().any(|zone| zone.contains(player.position_x, player.position_y))) {
            animal.target_player_id = None;
            animal.target_structure_id = None;
            animal.target_structure_type = None;
            let state = match animal.species {
                AnimalSpecies::SalmonShark => AnimalState::Swimming,
                AnimalSpecies::Jellyfish => AnimalState::Drifting,
                AnimalSpecies::Tern | AnimalSpecies::Crow | AnimalSpecies::SnowyOwl => AnimalState::Grounded,
                _ => AnimalState::Patrolling,
            };
            transition_to_state(animal, state, now, None, "target entered ALK wildlife exclusion");
        }
    }
}

// --- AI Processing Schedule Table ---
#[spacetimedb::table(accessor = wild_animal_ai_schedule, scheduled(process_wild_animal_ai))]
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
    fn should_chase_player(&self, ctx: &ReducerContext, animal: &WildAnimal, stats: &AnimalStats, player: &Player) -> bool;
    
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
    
    /// Check if this species can be tamed and with what food items
    fn can_be_tamed(&self) -> bool {
        false // Default: animals cannot be tamed
    }
    
    /// Get the food items that can tame this species
    fn get_taming_foods(&self) -> Vec<&'static str> {
        vec![] // Default: no taming foods
    }
    
    /// Get the chase abandonment distance multiplier for this species
    /// Multiplied by chase_trigger_range to determine when to give up chasing
    fn get_chase_abandonment_multiplier(&self) -> f32 {
        2.5 // Default: give up at 2.5x chase trigger range
    }
}

// --- Core Animal Behavior Implementation Helper ---
// Enum to hold all behavior types
pub enum AnimalBehaviorEnum {
    CinderFox(crate::wild_animal_npc::fox::CinderFoxBehavior),
    TundraWolf(crate::wild_animal_npc::wolf::TundraWolfBehavior),
    CableViper(crate::wild_animal_npc::viper::CableViperBehavior),
    ArcticWalrus(crate::wild_animal_npc::walrus::ArcticWalrusBehavior),
    BeachCrab(crate::wild_animal_npc::crab::BeachCrabBehavior),
    Tern(crate::wild_animal_npc::tern::TernBehavior),
    Crow(crate::wild_animal_npc::crow::CrowBehavior),
    Vole(crate::wild_animal_npc::vole::VoleBehavior),
    Wolverine(crate::wild_animal_npc::wolverine::WolverineBehavior),
    Caribou(crate::wild_animal_npc::caribou::CaribouBehavior),
    SalmonShark(crate::wild_animal_npc::salmon_shark::SalmonSharkBehavior),
    Jellyfish(crate::wild_animal_npc::jellyfish::JellyfishBehavior),
    // Night hostile NPCs
    Shorebound(crate::wild_animal_npc::shorebound::ShoreboundBehavior),
    Shardkin(crate::wild_animal_npc::shardkin::ShardkinBehavior),
    DrownedWatch(crate::wild_animal_npc::drowned_watch::DrownedWatchBehavior),
    // Special spawning animals
    Bee(crate::wild_animal_npc::bee::BeeBehavior),
    // Alpine animals
    PolarBear(crate::wild_animal_npc::polar_bear::PolarBearBehavior),
    Hare(crate::wild_animal_npc::hare::HareBehavior),
    SnowyOwl(crate::wild_animal_npc::snowy_owl::SnowyOwlBehavior),
}

impl AnimalBehavior for AnimalBehaviorEnum {
    fn get_stats(&self) -> AnimalStats {
        match self {
            AnimalBehaviorEnum::CinderFox(behavior) => behavior.get_stats(),
            AnimalBehaviorEnum::TundraWolf(behavior) => behavior.get_stats(),
            AnimalBehaviorEnum::CableViper(behavior) => behavior.get_stats(),
            AnimalBehaviorEnum::ArcticWalrus(behavior) => behavior.get_stats(),
            AnimalBehaviorEnum::BeachCrab(behavior) => behavior.get_stats(),
            AnimalBehaviorEnum::Tern(behavior) => behavior.get_stats(),
            AnimalBehaviorEnum::Crow(behavior) => behavior.get_stats(),
            AnimalBehaviorEnum::Vole(behavior) => behavior.get_stats(),
            AnimalBehaviorEnum::Wolverine(behavior) => behavior.get_stats(),
            AnimalBehaviorEnum::Caribou(behavior) => behavior.get_stats(),
            AnimalBehaviorEnum::SalmonShark(behavior) => behavior.get_stats(),
            AnimalBehaviorEnum::Jellyfish(behavior) => behavior.get_stats(),
            AnimalBehaviorEnum::Shorebound(behavior) => behavior.get_stats(),
            AnimalBehaviorEnum::Shardkin(behavior) => behavior.get_stats(),
            AnimalBehaviorEnum::DrownedWatch(behavior) => behavior.get_stats(),
            AnimalBehaviorEnum::Bee(behavior) => behavior.get_stats(),
            AnimalBehaviorEnum::PolarBear(behavior) => behavior.get_stats(),
            AnimalBehaviorEnum::Hare(behavior) => behavior.get_stats(),
            AnimalBehaviorEnum::SnowyOwl(behavior) => behavior.get_stats(),
        }
    }

    fn get_movement_pattern(&self) -> MovementPattern {
        match self {
            AnimalBehaviorEnum::CinderFox(behavior) => behavior.get_movement_pattern(),
            AnimalBehaviorEnum::TundraWolf(behavior) => behavior.get_movement_pattern(),
            AnimalBehaviorEnum::CableViper(behavior) => behavior.get_movement_pattern(),
            AnimalBehaviorEnum::ArcticWalrus(behavior) => behavior.get_movement_pattern(),
            AnimalBehaviorEnum::BeachCrab(behavior) => behavior.get_movement_pattern(),
            AnimalBehaviorEnum::Tern(behavior) => behavior.get_movement_pattern(),
            AnimalBehaviorEnum::Crow(behavior) => behavior.get_movement_pattern(),
            AnimalBehaviorEnum::Vole(behavior) => behavior.get_movement_pattern(),
            AnimalBehaviorEnum::Wolverine(behavior) => behavior.get_movement_pattern(),
            AnimalBehaviorEnum::Caribou(behavior) => behavior.get_movement_pattern(),
            AnimalBehaviorEnum::SalmonShark(behavior) => behavior.get_movement_pattern(),
            AnimalBehaviorEnum::Jellyfish(behavior) => behavior.get_movement_pattern(),
            AnimalBehaviorEnum::Shorebound(behavior) => behavior.get_movement_pattern(),
            AnimalBehaviorEnum::Shardkin(behavior) => behavior.get_movement_pattern(),
            AnimalBehaviorEnum::DrownedWatch(behavior) => behavior.get_movement_pattern(),
            AnimalBehaviorEnum::Bee(behavior) => behavior.get_movement_pattern(),
            AnimalBehaviorEnum::PolarBear(behavior) => behavior.get_movement_pattern(),
            AnimalBehaviorEnum::Hare(behavior) => behavior.get_movement_pattern(),
            AnimalBehaviorEnum::SnowyOwl(behavior) => behavior.get_movement_pattern(),
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
            AnimalBehaviorEnum::ArcticWalrus(behavior) => behavior.execute_attack_effects(ctx, animal, target_player, stats, current_time, rng),
            AnimalBehaviorEnum::BeachCrab(behavior) => behavior.execute_attack_effects(ctx, animal, target_player, stats, current_time, rng),
            AnimalBehaviorEnum::Tern(behavior) => behavior.execute_attack_effects(ctx, animal, target_player, stats, current_time, rng),
            AnimalBehaviorEnum::Crow(behavior) => behavior.execute_attack_effects(ctx, animal, target_player, stats, current_time, rng),
            AnimalBehaviorEnum::Vole(behavior) => behavior.execute_attack_effects(ctx, animal, target_player, stats, current_time, rng),
            AnimalBehaviorEnum::Wolverine(behavior) => behavior.execute_attack_effects(ctx, animal, target_player, stats, current_time, rng),
            AnimalBehaviorEnum::Caribou(behavior) => behavior.execute_attack_effects(ctx, animal, target_player, stats, current_time, rng),
            AnimalBehaviorEnum::SalmonShark(behavior) => behavior.execute_attack_effects(ctx, animal, target_player, stats, current_time, rng),
            AnimalBehaviorEnum::Jellyfish(behavior) => behavior.execute_attack_effects(ctx, animal, target_player, stats, current_time, rng),
            AnimalBehaviorEnum::Shorebound(behavior) => behavior.execute_attack_effects(ctx, animal, target_player, stats, current_time, rng),
            AnimalBehaviorEnum::Shardkin(behavior) => behavior.execute_attack_effects(ctx, animal, target_player, stats, current_time, rng),
            AnimalBehaviorEnum::DrownedWatch(behavior) => behavior.execute_attack_effects(ctx, animal, target_player, stats, current_time, rng),
            AnimalBehaviorEnum::Bee(behavior) => behavior.execute_attack_effects(ctx, animal, target_player, stats, current_time, rng),
            AnimalBehaviorEnum::PolarBear(behavior) => behavior.execute_attack_effects(ctx, animal, target_player, stats, current_time, rng),
            AnimalBehaviorEnum::Hare(behavior) => behavior.execute_attack_effects(ctx, animal, target_player, stats, current_time, rng),
            AnimalBehaviorEnum::SnowyOwl(behavior) => behavior.execute_attack_effects(ctx, animal, target_player, stats, current_time, rng),
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
            AnimalBehaviorEnum::ArcticWalrus(behavior) => behavior.update_ai_state_logic(ctx, animal, stats, detected_player, current_time, rng),
            AnimalBehaviorEnum::BeachCrab(behavior) => behavior.update_ai_state_logic(ctx, animal, stats, detected_player, current_time, rng),
            AnimalBehaviorEnum::Tern(behavior) => behavior.update_ai_state_logic(ctx, animal, stats, detected_player, current_time, rng),
            AnimalBehaviorEnum::Crow(behavior) => behavior.update_ai_state_logic(ctx, animal, stats, detected_player, current_time, rng),
            AnimalBehaviorEnum::Vole(behavior) => behavior.update_ai_state_logic(ctx, animal, stats, detected_player, current_time, rng),
            AnimalBehaviorEnum::Wolverine(behavior) => behavior.update_ai_state_logic(ctx, animal, stats, detected_player, current_time, rng),
            AnimalBehaviorEnum::Caribou(behavior) => behavior.update_ai_state_logic(ctx, animal, stats, detected_player, current_time, rng),
            AnimalBehaviorEnum::SalmonShark(behavior) => behavior.update_ai_state_logic(ctx, animal, stats, detected_player, current_time, rng),
            AnimalBehaviorEnum::Jellyfish(behavior) => behavior.update_ai_state_logic(ctx, animal, stats, detected_player, current_time, rng),
            AnimalBehaviorEnum::Shorebound(behavior) => behavior.update_ai_state_logic(ctx, animal, stats, detected_player, current_time, rng),
            AnimalBehaviorEnum::Shardkin(behavior) => behavior.update_ai_state_logic(ctx, animal, stats, detected_player, current_time, rng),
            AnimalBehaviorEnum::DrownedWatch(behavior) => behavior.update_ai_state_logic(ctx, animal, stats, detected_player, current_time, rng),
            AnimalBehaviorEnum::Bee(behavior) => behavior.update_ai_state_logic(ctx, animal, stats, detected_player, current_time, rng),
            AnimalBehaviorEnum::PolarBear(behavior) => behavior.update_ai_state_logic(ctx, animal, stats, detected_player, current_time, rng),
            AnimalBehaviorEnum::Hare(behavior) => behavior.update_ai_state_logic(ctx, animal, stats, detected_player, current_time, rng),
            AnimalBehaviorEnum::SnowyOwl(behavior) => behavior.update_ai_state_logic(ctx, animal, stats, detected_player, current_time, rng),
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
            AnimalBehaviorEnum::ArcticWalrus(behavior) => behavior.execute_flee_logic(ctx, animal, stats, dt, current_time, rng),
            AnimalBehaviorEnum::BeachCrab(behavior) => behavior.execute_flee_logic(ctx, animal, stats, dt, current_time, rng),
            AnimalBehaviorEnum::Tern(behavior) => behavior.execute_flee_logic(ctx, animal, stats, dt, current_time, rng),
            AnimalBehaviorEnum::Crow(behavior) => behavior.execute_flee_logic(ctx, animal, stats, dt, current_time, rng),
            AnimalBehaviorEnum::Vole(behavior) => behavior.execute_flee_logic(ctx, animal, stats, dt, current_time, rng),
            AnimalBehaviorEnum::Wolverine(behavior) => behavior.execute_flee_logic(ctx, animal, stats, dt, current_time, rng),
            AnimalBehaviorEnum::Caribou(behavior) => behavior.execute_flee_logic(ctx, animal, stats, dt, current_time, rng),
            AnimalBehaviorEnum::SalmonShark(behavior) => behavior.execute_flee_logic(ctx, animal, stats, dt, current_time, rng),
            AnimalBehaviorEnum::Jellyfish(behavior) => behavior.execute_flee_logic(ctx, animal, stats, dt, current_time, rng),
            AnimalBehaviorEnum::Shorebound(behavior) => behavior.execute_flee_logic(ctx, animal, stats, dt, current_time, rng),
            AnimalBehaviorEnum::Shardkin(behavior) => behavior.execute_flee_logic(ctx, animal, stats, dt, current_time, rng),
            AnimalBehaviorEnum::DrownedWatch(behavior) => behavior.execute_flee_logic(ctx, animal, stats, dt, current_time, rng),
            AnimalBehaviorEnum::Bee(behavior) => behavior.execute_flee_logic(ctx, animal, stats, dt, current_time, rng),
            AnimalBehaviorEnum::PolarBear(behavior) => behavior.execute_flee_logic(ctx, animal, stats, dt, current_time, rng),
            AnimalBehaviorEnum::Hare(behavior) => behavior.execute_flee_logic(ctx, animal, stats, dt, current_time, rng),
            AnimalBehaviorEnum::SnowyOwl(behavior) => behavior.execute_flee_logic(ctx, animal, stats, dt, current_time, rng),
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
            AnimalBehaviorEnum::ArcticWalrus(behavior) => behavior.execute_patrol_logic(ctx, animal, stats, dt, rng),
            AnimalBehaviorEnum::BeachCrab(behavior) => behavior.execute_patrol_logic(ctx, animal, stats, dt, rng),
            AnimalBehaviorEnum::Tern(behavior) => behavior.execute_patrol_logic(ctx, animal, stats, dt, rng),
            AnimalBehaviorEnum::Crow(behavior) => behavior.execute_patrol_logic(ctx, animal, stats, dt, rng),
            AnimalBehaviorEnum::Vole(behavior) => behavior.execute_patrol_logic(ctx, animal, stats, dt, rng),
            AnimalBehaviorEnum::Wolverine(behavior) => behavior.execute_patrol_logic(ctx, animal, stats, dt, rng),
            AnimalBehaviorEnum::Caribou(behavior) => behavior.execute_patrol_logic(ctx, animal, stats, dt, rng),
            AnimalBehaviorEnum::SalmonShark(behavior) => behavior.execute_patrol_logic(ctx, animal, stats, dt, rng),
            AnimalBehaviorEnum::Jellyfish(behavior) => behavior.execute_patrol_logic(ctx, animal, stats, dt, rng),
            AnimalBehaviorEnum::Shorebound(behavior) => behavior.execute_patrol_logic(ctx, animal, stats, dt, rng),
            AnimalBehaviorEnum::Shardkin(behavior) => behavior.execute_patrol_logic(ctx, animal, stats, dt, rng),
            AnimalBehaviorEnum::DrownedWatch(behavior) => behavior.execute_patrol_logic(ctx, animal, stats, dt, rng),
            AnimalBehaviorEnum::Bee(behavior) => behavior.execute_patrol_logic(ctx, animal, stats, dt, rng),
            AnimalBehaviorEnum::PolarBear(behavior) => behavior.execute_patrol_logic(ctx, animal, stats, dt, rng),
            AnimalBehaviorEnum::Hare(behavior) => behavior.execute_patrol_logic(ctx, animal, stats, dt, rng),
            AnimalBehaviorEnum::SnowyOwl(behavior) => behavior.execute_patrol_logic(ctx, animal, stats, dt, rng),
        }
    }

    fn should_chase_player(&self, ctx: &ReducerContext, animal: &WildAnimal, stats: &AnimalStats, player: &Player) -> bool {
        match self {
            AnimalBehaviorEnum::CinderFox(behavior) => behavior.should_chase_player(ctx, animal, stats, player),
            AnimalBehaviorEnum::TundraWolf(behavior) => behavior.should_chase_player(ctx, animal, stats, player),
            AnimalBehaviorEnum::CableViper(behavior) => behavior.should_chase_player(ctx, animal, stats, player),
            AnimalBehaviorEnum::ArcticWalrus(behavior) => behavior.should_chase_player(ctx, animal, stats, player),
            AnimalBehaviorEnum::BeachCrab(behavior) => behavior.should_chase_player(ctx, animal, stats, player),
            AnimalBehaviorEnum::Tern(behavior) => behavior.should_chase_player(ctx, animal, stats, player),
            AnimalBehaviorEnum::Crow(behavior) => behavior.should_chase_player(ctx, animal, stats, player),
            AnimalBehaviorEnum::Vole(behavior) => behavior.should_chase_player(ctx, animal, stats, player),
            AnimalBehaviorEnum::Wolverine(behavior) => behavior.should_chase_player(ctx, animal, stats, player),
            AnimalBehaviorEnum::Caribou(behavior) => behavior.should_chase_player(ctx, animal, stats, player),
            AnimalBehaviorEnum::SalmonShark(behavior) => behavior.should_chase_player(ctx, animal, stats, player),
            AnimalBehaviorEnum::Jellyfish(behavior) => behavior.should_chase_player(ctx, animal, stats, player),
            AnimalBehaviorEnum::Shorebound(behavior) => behavior.should_chase_player(ctx, animal, stats, player),
            AnimalBehaviorEnum::Shardkin(behavior) => behavior.should_chase_player(ctx, animal, stats, player),
            AnimalBehaviorEnum::DrownedWatch(behavior) => behavior.should_chase_player(ctx, animal, stats, player),
            AnimalBehaviorEnum::Bee(behavior) => behavior.should_chase_player(ctx, animal, stats, player),
            AnimalBehaviorEnum::PolarBear(behavior) => behavior.should_chase_player(ctx, animal, stats, player),
            AnimalBehaviorEnum::Hare(behavior) => behavior.should_chase_player(ctx, animal, stats, player),
            AnimalBehaviorEnum::SnowyOwl(behavior) => behavior.should_chase_player(ctx, animal, stats, player),
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
            AnimalBehaviorEnum::ArcticWalrus(behavior) => behavior.handle_damage_response(ctx, animal, attacker, stats, current_time, rng),
            AnimalBehaviorEnum::BeachCrab(behavior) => behavior.handle_damage_response(ctx, animal, attacker, stats, current_time, rng),
            AnimalBehaviorEnum::Tern(behavior) => behavior.handle_damage_response(ctx, animal, attacker, stats, current_time, rng),
            AnimalBehaviorEnum::Crow(behavior) => behavior.handle_damage_response(ctx, animal, attacker, stats, current_time, rng),
            AnimalBehaviorEnum::Vole(behavior) => behavior.handle_damage_response(ctx, animal, attacker, stats, current_time, rng),
            AnimalBehaviorEnum::Wolverine(behavior) => behavior.handle_damage_response(ctx, animal, attacker, stats, current_time, rng),
            AnimalBehaviorEnum::Caribou(behavior) => behavior.handle_damage_response(ctx, animal, attacker, stats, current_time, rng),
            AnimalBehaviorEnum::SalmonShark(behavior) => behavior.handle_damage_response(ctx, animal, attacker, stats, current_time, rng),
            AnimalBehaviorEnum::Jellyfish(behavior) => behavior.handle_damage_response(ctx, animal, attacker, stats, current_time, rng),
            AnimalBehaviorEnum::Shorebound(behavior) => behavior.handle_damage_response(ctx, animal, attacker, stats, current_time, rng),
            AnimalBehaviorEnum::Shardkin(behavior) => behavior.handle_damage_response(ctx, animal, attacker, stats, current_time, rng),
            AnimalBehaviorEnum::DrownedWatch(behavior) => behavior.handle_damage_response(ctx, animal, attacker, stats, current_time, rng),
            AnimalBehaviorEnum::Bee(behavior) => behavior.handle_damage_response(ctx, animal, attacker, stats, current_time, rng),
            AnimalBehaviorEnum::PolarBear(behavior) => behavior.handle_damage_response(ctx, animal, attacker, stats, current_time, rng),
            AnimalBehaviorEnum::Hare(behavior) => behavior.handle_damage_response(ctx, animal, attacker, stats, current_time, rng),
            AnimalBehaviorEnum::SnowyOwl(behavior) => behavior.handle_damage_response(ctx, animal, attacker, stats, current_time, rng),
        }
    }

    fn can_be_tamed(&self) -> bool {
        match self {
            AnimalBehaviorEnum::CinderFox(behavior) => behavior.can_be_tamed(),
            AnimalBehaviorEnum::TundraWolf(behavior) => behavior.can_be_tamed(),
            AnimalBehaviorEnum::CableViper(behavior) => behavior.can_be_tamed(),
            AnimalBehaviorEnum::ArcticWalrus(behavior) => behavior.can_be_tamed(),
            AnimalBehaviorEnum::BeachCrab(behavior) => behavior.can_be_tamed(),
            AnimalBehaviorEnum::Tern(behavior) => behavior.can_be_tamed(),
            AnimalBehaviorEnum::Crow(behavior) => behavior.can_be_tamed(),
            AnimalBehaviorEnum::Vole(behavior) => behavior.can_be_tamed(),
            AnimalBehaviorEnum::Wolverine(behavior) => behavior.can_be_tamed(),
            AnimalBehaviorEnum::Caribou(behavior) => behavior.can_be_tamed(),
            AnimalBehaviorEnum::SalmonShark(behavior) => behavior.can_be_tamed(),
            AnimalBehaviorEnum::Jellyfish(behavior) => behavior.can_be_tamed(),
            AnimalBehaviorEnum::Shorebound(behavior) => behavior.can_be_tamed(),
            AnimalBehaviorEnum::Shardkin(behavior) => behavior.can_be_tamed(),
            AnimalBehaviorEnum::DrownedWatch(behavior) => behavior.can_be_tamed(),
            AnimalBehaviorEnum::Bee(behavior) => behavior.can_be_tamed(),
            AnimalBehaviorEnum::PolarBear(behavior) => behavior.can_be_tamed(),
            AnimalBehaviorEnum::Hare(behavior) => behavior.can_be_tamed(),
            AnimalBehaviorEnum::SnowyOwl(behavior) => behavior.can_be_tamed(),
        }
    }

    fn get_taming_foods(&self) -> Vec<&'static str> {
        match self {
            AnimalBehaviorEnum::CinderFox(behavior) => behavior.get_taming_foods(),
            AnimalBehaviorEnum::TundraWolf(behavior) => behavior.get_taming_foods(),
            AnimalBehaviorEnum::CableViper(behavior) => behavior.get_taming_foods(),
            AnimalBehaviorEnum::ArcticWalrus(behavior) => behavior.get_taming_foods(),
            AnimalBehaviorEnum::BeachCrab(behavior) => behavior.get_taming_foods(),
            AnimalBehaviorEnum::Tern(behavior) => behavior.get_taming_foods(),
            AnimalBehaviorEnum::Crow(behavior) => behavior.get_taming_foods(),
            AnimalBehaviorEnum::Vole(behavior) => behavior.get_taming_foods(),
            AnimalBehaviorEnum::Wolverine(behavior) => behavior.get_taming_foods(),
            AnimalBehaviorEnum::Caribou(behavior) => behavior.get_taming_foods(),
            AnimalBehaviorEnum::SalmonShark(behavior) => behavior.get_taming_foods(),
            AnimalBehaviorEnum::Jellyfish(behavior) => behavior.get_taming_foods(),
            AnimalBehaviorEnum::Shorebound(behavior) => behavior.get_taming_foods(),
            AnimalBehaviorEnum::Shardkin(behavior) => behavior.get_taming_foods(),
            AnimalBehaviorEnum::DrownedWatch(behavior) => behavior.get_taming_foods(),
            AnimalBehaviorEnum::Bee(behavior) => behavior.get_taming_foods(),
            AnimalBehaviorEnum::PolarBear(behavior) => behavior.get_taming_foods(),
            AnimalBehaviorEnum::Hare(behavior) => behavior.get_taming_foods(),
            AnimalBehaviorEnum::SnowyOwl(behavior) => behavior.get_taming_foods(),
        }
    }

    fn get_chase_abandonment_multiplier(&self) -> f32 {
        match self {
            AnimalBehaviorEnum::CinderFox(behavior) => behavior.get_chase_abandonment_multiplier(),
            AnimalBehaviorEnum::TundraWolf(behavior) => behavior.get_chase_abandonment_multiplier(),
            AnimalBehaviorEnum::CableViper(behavior) => behavior.get_chase_abandonment_multiplier(),
            AnimalBehaviorEnum::ArcticWalrus(behavior) => behavior.get_chase_abandonment_multiplier(),
            AnimalBehaviorEnum::BeachCrab(behavior) => behavior.get_chase_abandonment_multiplier(),
            AnimalBehaviorEnum::Tern(behavior) => behavior.get_chase_abandonment_multiplier(),
            AnimalBehaviorEnum::Crow(behavior) => behavior.get_chase_abandonment_multiplier(),
            AnimalBehaviorEnum::Vole(behavior) => behavior.get_chase_abandonment_multiplier(),
            AnimalBehaviorEnum::Wolverine(behavior) => behavior.get_chase_abandonment_multiplier(),
            AnimalBehaviorEnum::Caribou(behavior) => behavior.get_chase_abandonment_multiplier(),
            AnimalBehaviorEnum::SalmonShark(behavior) => behavior.get_chase_abandonment_multiplier(),
            AnimalBehaviorEnum::Jellyfish(behavior) => behavior.get_chase_abandonment_multiplier(),
            AnimalBehaviorEnum::Shorebound(behavior) => behavior.get_chase_abandonment_multiplier(),
            AnimalBehaviorEnum::Shardkin(behavior) => behavior.get_chase_abandonment_multiplier(),
            AnimalBehaviorEnum::DrownedWatch(behavior) => behavior.get_chase_abandonment_multiplier(),
            AnimalBehaviorEnum::Bee(behavior) => behavior.get_chase_abandonment_multiplier(),
            AnimalBehaviorEnum::PolarBear(behavior) => behavior.get_chase_abandonment_multiplier(),
            AnimalBehaviorEnum::Hare(behavior) => behavior.get_chase_abandonment_multiplier(),
            AnimalBehaviorEnum::SnowyOwl(behavior) => behavior.get_chase_abandonment_multiplier(),
        }
    }
}

impl AnimalSpecies {
    pub fn get_behavior(&self) -> AnimalBehaviorEnum {
        match self {
            AnimalSpecies::CinderFox => AnimalBehaviorEnum::CinderFox(crate::wild_animal_npc::fox::CinderFoxBehavior),
            AnimalSpecies::TundraWolf => AnimalBehaviorEnum::TundraWolf(crate::wild_animal_npc::wolf::TundraWolfBehavior),
            AnimalSpecies::CableViper => AnimalBehaviorEnum::CableViper(crate::wild_animal_npc::viper::CableViperBehavior),
            AnimalSpecies::ArcticWalrus => AnimalBehaviorEnum::ArcticWalrus(crate::wild_animal_npc::walrus::ArcticWalrusBehavior),
            AnimalSpecies::BeachCrab => AnimalBehaviorEnum::BeachCrab(crate::wild_animal_npc::crab::BeachCrabBehavior),
            AnimalSpecies::Tern => AnimalBehaviorEnum::Tern(crate::wild_animal_npc::tern::TernBehavior),
            AnimalSpecies::Crow => AnimalBehaviorEnum::Crow(crate::wild_animal_npc::crow::CrowBehavior),
            AnimalSpecies::Vole => AnimalBehaviorEnum::Vole(crate::wild_animal_npc::vole::VoleBehavior),
            AnimalSpecies::Wolverine => AnimalBehaviorEnum::Wolverine(crate::wild_animal_npc::wolverine::WolverineBehavior),
            AnimalSpecies::Caribou => AnimalBehaviorEnum::Caribou(crate::wild_animal_npc::caribou::CaribouBehavior),
            AnimalSpecies::SalmonShark => AnimalBehaviorEnum::SalmonShark(crate::wild_animal_npc::salmon_shark::SalmonSharkBehavior),
            AnimalSpecies::Jellyfish => AnimalBehaviorEnum::Jellyfish(crate::wild_animal_npc::jellyfish::JellyfishBehavior),
            AnimalSpecies::Shorebound => AnimalBehaviorEnum::Shorebound(crate::wild_animal_npc::shorebound::ShoreboundBehavior),
            AnimalSpecies::Shardkin => AnimalBehaviorEnum::Shardkin(crate::wild_animal_npc::shardkin::ShardkinBehavior),
            AnimalSpecies::DrownedWatch => AnimalBehaviorEnum::DrownedWatch(crate::wild_animal_npc::drowned_watch::DrownedWatchBehavior),
            AnimalSpecies::Bee => AnimalBehaviorEnum::Bee(crate::wild_animal_npc::bee::BeeBehavior),
            AnimalSpecies::PolarBear => AnimalBehaviorEnum::PolarBear(crate::wild_animal_npc::polar_bear::PolarBearBehavior),
            AnimalSpecies::Hare => AnimalBehaviorEnum::Hare(crate::wild_animal_npc::hare::HareBehavior),
            AnimalSpecies::SnowyOwl => AnimalBehaviorEnum::SnowyOwl(crate::wild_animal_npc::snowy_owl::SnowyOwlBehavior),
        }
    }
    
    /// Check if this species is a night-only hostile NPC
    pub fn is_hostile_npc(&self) -> bool {
        matches!(self, AnimalSpecies::Shorebound | AnimalSpecies::Shardkin | AnimalSpecies::DrownedWatch)
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
        crate::try_insert_schedule!(
            schedule_table,
            WildAnimalAiSchedule {
                id: 0,
                scheduled_at: ScheduleAt::Interval(TimeDuration::from(interval)),
            },
            "Wild animal AI"
        );
    }
    Ok(())
}

// --- AI Processing Reducer ---

#[spacetimedb::reducer]
pub fn process_wild_animal_ai(ctx: &ReducerContext, _schedule: WildAnimalAiSchedule) -> Result<(), String> {
    // Security check - only allow scheduler to call this
    if ctx.sender() != ctx.identity() {
        return Err("Wild animal AI can only be processed by scheduler".to_string());
    }

    // PERFORMANCE OPTIMIZATION: Skip AI entirely if no players are online
    // This saves significant compute when the server is idle (nobody playing)
    let online_player_count = ctx.db.player().iter().filter(|p| p.is_online).count();
    if online_player_count == 0 {
        log::trace!("No players online - skipping animal AI processing to save resources.");
        return Ok(());
    }

    // Early return if there are no animals - prevents unnecessary processing
    let animal_count = ctx.db.wild_animal().iter().count();
    if animal_count == 0 {
        // No animals to process - stop the schedule to save resources
        // BUT: Don't delete the schedule - keep it running so it can restart when animals spawn
        // This fixes the issue where animals spawn but don't move because schedule was deleted
        log::debug!("No animals to process (count: {}). Schedule will continue running and restart when animals spawn.", animal_count);
        return Ok(());
    }

    let current_time = ctx.timestamp;
    let mut rng = rand::rngs::StdRng::seed_from_u64(
        (current_time.to_micros_since_unix_epoch() as u64).wrapping_add(42)
    );

    // PERFORMANCE OPTIMIZATION: Pre-fetch all data ONCE per AI tick
    // This eliminates thousands of redundant table scans per tick
    let prefetched = PreFetchedAIData::fetch(ctx);

    // NOTE: Animal collision uses get_cached_spatial_grid() internally (refreshed every 1s)
    // No need to build a separate grid here - that was dead code costing ~full world scan every AI tick

    // CHUNK-BASED OPTIMIZATION: Only fetch animals in chunks near players
    // Avoids full table scan when world has many animals spread across the map
    let animals: Vec<WildAnimal> = collect_animals_in_active_chunks(ctx, &prefetched.all_players);
    let pack_snapshot = build_pack_snapshot(ctx);
    
    for mut animal in animals {
        // CRITICAL FIX: Wrap each animal's processing in error handling to prevent one bad animal from stopping the entire AI system
        let animal_id = animal.id;
        let animal_species = animal.species;
        
        // VIEWPORT CULLING OPTIMIZATION: Skip animals far from all players
        // They remain frozen in place until a player gets close
        // Exception: Tamed animals always process (they follow their owner)
        // Exception: Animals actively chasing/fleeing should finish their action
        let is_tamed = animal.tamed_by.is_some();
        if !is_tamed && clear_animal_from_alk(ctx, &mut animal, &prefetched.alk_wildlife_zones, current_time) {
            if ctx.db.wild_animal().id().find(&animal.id).is_some() {
                ctx.db.wild_animal().id().update(animal);
            }
            continue;
        }
        let is_active_state = matches!(animal.state, 
            AnimalState::Chasing | AnimalState::Attacking | AnimalState::Fleeing | 
            AnimalState::Following | AnimalState::Protecting | AnimalState::FlyingChase |
            AnimalState::SwimmingChase | // Salmon shark underwater/surface pursuit
            AnimalState::Drifting |     // Jellyfish passive drift - must always process when in range
            AnimalState::Scavenging | AnimalState::Stealing
        );
        
        if !is_tamed && !is_active_state && !is_any_player_in_active_zone(&prefetched.all_players, &animal) {
            // Animal is far from all players and not doing anything important
            // Skip all processing - they stay frozen in place
            continue;
        }
        
        // Process this animal and catch any errors
        let process_result = (|| -> Result<(), String> {
            let behavior = animal.species.get_behavior();
            let stats = behavior.get_stats();
            
            // Find nearby players for perception checks (uses pre-fetched data)
            let mut nearby_players = find_nearby_players_prefetched(&prefetched.all_players, &animal, &stats);
            if !is_tamed {
                nearby_players.retain(|player| !prefetched.alk_wildlife_zones.iter().any(|zone| zone.contains(player.position_x, player.position_y)));
                clear_alk_target(&mut animal, &prefetched.all_players, &prefetched.alk_wildlife_zones, current_time);
            }
            
            // Update AI state based on current conditions
            update_animal_ai_state(ctx, &prefetched, &mut animal, &behavior, &stats, &nearby_players, current_time, &mut rng)?;
            
            // Process pack behavior (formation, dissolution, etc.)
            process_pack_behavior(ctx, &mut animal, current_time, &mut rng, &pack_snapshot.pack_sizes, &pack_snapshot.pack_has_alpha)?;
            
            // Process taming behavior (food detection and consumption)
            process_taming_behavior(ctx, &mut animal, current_time)?;
            if animal.tamed_by.is_none() {
                clear_alk_target(&mut animal, &prefetched.all_players, &prefetched.alk_wildlife_zones, current_time);
            }
            
            // ====================================================================
            // PROACTIVE RANGED ATTACKS (any NPC with ranged capability)
            // ====================================================================
            // NPCs with ranged capabilities can fire projectiles during combat states:
            // - Chasing state: All attacking NPCs
            // - Stalking state: Shorebound circling behavior  
            // NOTE: We check species capability, NOT is_hostile_npc, because CableViper
            // is regular wildlife (not hostile) but still has ranged attacks!
            if animal.state == AnimalState::Chasing || animal.state == AnimalState::Stalking {
                // First check if this species even HAS ranged attacks
                if let Some(ranged_config) = get_npc_ranged_attack_config(animal.species) {
                    if let Some(target_id) = animal.target_player_id {
                        // CRITICAL: Only use ranged attacks if PLAYER has ranged weapon equipped
                        // This mirrors the player's combat style - melee vs melee, ranged vs ranged
                        if !player_has_ranged_weapon(ctx, target_id) {
                            // Player using melee - NPC should also use melee, skip ranged
                            log::debug!("🎯 [NPC RANGED SKIP] {:?} {} - player doesn't have ranged weapon", 
                                       animal.species, animal.id);
                        } else if let Some(target_player) = ctx.db.player().identity().find(&target_id) {
                            if !target_player.is_dead && target_player.health > 0.0 {
                                let distance_sq = get_distance_squared(
                                    animal.pos_x, animal.pos_y,
                                    target_player.position_x, target_player.position_y
                                );
                                let distance = distance_sq.sqrt();
                                
                                // Debug: Log ranged attack check status
                                let in_range = distance <= ranged_config.range;
                                let outside_min = distance >= ranged_config.min_range;
                                
                                log::debug!("🎯 [NPC RANGED DIST] {:?} {} dist={:.1}px (range={:.1}-{:.1}) in_range={} outside_min={}", 
                                          animal.species, animal.id, distance, ranged_config.min_range, ranged_config.range, in_range, outside_min);
                                
                                if in_range && outside_min {
                                    // Try to fire ranged attack
                                    match try_npc_proactive_ranged_attack(ctx, &mut animal, &target_player, current_time) {
                                        Ok(fired) => {
                                            if fired {
                                                log::info!("🎯 [NPC RANGED] {:?} {} in {:?} state FIRED at player {} at distance {:.1}px", 
                                                           animal.species, animal.id, animal.state, target_id, distance);
                                            }
                                        }
                                        Err(e) => {
                                            log::error!("Error in proactive ranged attack: {}", e);
                                        }
                                    }
                                }
                            } else {
                                log::debug!("🎯 [NPC RANGED SKIP] {:?} {} - target player is dead", animal.species, animal.id);
                            }
                        } else {
                            log::debug!("🎯 [NPC RANGED SKIP] {:?} {} - target player not found", animal.species, animal.id);
                        }
                    } else {
                        log::debug!("🎯 [NPC RANGED SKIP] {:?} {} - no target_player_id set", animal.species, animal.id);
                    }
                }
            }
            
            // Check for and execute MELEE attacks (Chasing or SwimmingChase - salmon shark underwater pursuit)
            if matches!(animal.state, AnimalState::Chasing | AnimalState::SwimmingChase) {
                if let Some(target_id) = animal.target_player_id {
                    if let Some(target_player) = ctx.db.player().identity().find(&target_id) {
                        // CRITICAL FIX: Don't attack dead players - prevents duplicate corpse creation
                        if target_player.is_dead || target_player.health <= 0.0 {
                            // Player is dead - stop chasing and go idle (not wander)
                            log::info!("[WildAnimal:{}] Stopping chase - target player {} is dead (health: {:.1})", 
                                     animal.id, target_id, target_player.health);
                            transition_to_state(&mut animal, AnimalState::Idle, current_time, None, "target died");
                        } else {
                            let distance_sq = get_distance_squared(
                                animal.pos_x, animal.pos_y,
                                target_player.position_x, target_player.position_y
                            );
                            
                            // MELEE ATTACKS - Only when in melee range
                            // If NPC has ranged capability AND player has ranged weapon, skip melee (use ranged instead)
                            // Otherwise use normal melee attacks
                            let npc_has_ranged = get_npc_ranged_attack_config(animal.species).is_some();
                            let player_using_ranged = player_has_ranged_weapon(ctx, target_id);
                            let should_use_ranged_instead = npc_has_ranged && player_using_ranged;
                            
                            if !should_use_ranged_instead && 
                               distance_sq <= (stats.attack_range * stats.attack_range) && 
                               can_attack(&animal, current_time, &stats) {
                                // Execute the melee attack
                                execute_attack(ctx, &mut animal, &target_player, &behavior, &stats, current_time, &mut rng)?;
                            }
                            
                            // HOSTILE NPC STRUCTURE ATTACK: If player is inside building, consider attacking structures
                            // This check runs REGARDLESS of whether the hostile can reach the player directly
                            
                            // DEBUG: Log all hostile NPCs in Chasing state to see why structure attacks aren't triggering
                            if animal.is_hostile_npc {
                                // Also check if player is ACTUALLY inside any shelter (direct check)
                                let mut actual_shelter_check = false;
                                for shelter in ctx.db.shelter().iter() {
                                    if !shelter.is_destroyed && crate::shelter::is_player_inside_shelter(
                                        target_player.position_x, target_player.position_y, &shelter
                                    ) {
                                        actual_shelter_check = true;
                                        log::debug!("👹 [SHELTER DEBUG] Player {} IS inside Shelter {} (pos {:.1},{:.1}) - AABB center at ({:.1},{:.1})", 
                                            target_id, shelter.id, 
                                            target_player.position_x, target_player.position_y,
                                            shelter.pos_x, shelter.pos_y - crate::shelter::SHELTER_AABB_CENTER_Y_OFFSET_FROM_POS_Y);
                                        break;
                                    }
                                }
                                
                                log::debug!("👹 [HostileNPC DEBUG] {:?} {} at ({:.1},{:.1}) in Chasing state - player.is_inside_building={}, actual_shelter_check={}, species_can_attack={}", 
                                    animal.species, animal.id, animal.pos_x, animal.pos_y,
                                    target_player.is_inside_building,
                                    actual_shelter_check,
                                    matches!(animal.species, AnimalSpecies::Shorebound | AnimalSpecies::Shardkin | AnimalSpecies::DrownedWatch));
                                
                                // If there's a mismatch, log it as a critical issue
                                if actual_shelter_check && !target_player.is_inside_building {
                                    log::error!("🚨 [BUG] Player {} is INSIDE shelter but is_inside_building is FALSE! Wet.rs update may not be running!", target_id);
                                }
                            }
                            
                            // DrownedWatch special behavior: HUNT WARDS proactively, even if player is not in building!
                            // DrownedWatch ignores ward protection and goes straight for them to destroy ward protection
                            if matches!(animal.species, AnimalSpecies::DrownedWatch) && animal.target_structure_id.is_none() {
                                const WARD_HUNT_RANGE: f32 = 800.0; // Extended range - DrownedWatch actively seeks wards
                                if let Some((ward_id, ward_type, dist_sq)) = crate::wild_animal_npc::hostile_spawning::find_nearest_active_ward(
                                    ctx, animal.pos_x, animal.pos_y, WARD_HUNT_RANGE
                                ) {
                                    log::debug!("👹 [DrownedWatch] {} detected ward {} at {:.1}px - switching to destroy mode!", 
                                              animal.id, ward_id, dist_sq.sqrt());
                                    animal.target_structure_id = Some(ward_id);
                                    animal.target_structure_type = Some(ward_type.clone());
                                    transition_to_state(&mut animal, AnimalState::AttackingStructure, current_time, Some(target_id), &format!("hunting ward #{}", ward_id));
                                }
                            }
                            
                            if animal.is_hostile_npc && target_player.is_inside_building {
                                // Only Drowned Watch (brutes) can attack structures - Shorebound and Shardkin cannot
                                // This creates gameplay differentiation: small/medium hostiles circle outside,
                                // but the big brutes will eventually tear through your walls
                                let can_attack_structures = matches!(animal.species, AnimalSpecies::DrownedWatch);
                                
                                // Check if hostile should switch to structure attack mode
                                // Don't require can_attack() here - we're just switching states
                                if can_attack_structures {
                                    // Look for nearby structures to attack (doors prioritized)
                                    // IMPORTANT: Search range must be larger than shelter collision box
                                    // Shelter AABB is ~300x125px, so hostile blocked at edge is ~150-200px from center
                                    // Use 400px to ensure hostiles can always find the shelter they're blocked by
                                    const STRUCTURE_SEARCH_RANGE: f32 = 400.0;
                                    
                                    // DrownedWatch PRIORITIZES wards - they go straight for protective wards to destroy them!
                                    // This makes them the counter to ward protection - players can't just hide behind wards forever
                                    let structure_result = if matches!(animal.species, AnimalSpecies::DrownedWatch) {
                                        // First check for wards in extended range (DrownedWatch specifically hunts wards)
                                        const WARD_HUNT_RANGE: f32 = 800.0; // Extended range for ward hunting
                                        if let Some(ward_result) = crate::wild_animal_npc::hostile_spawning::find_nearest_active_ward(
                                            ctx, animal.pos_x, animal.pos_y, WARD_HUNT_RANGE
                                        ) {
                                            Some(ward_result)
                                        } else {
                                            // No wards found, fall back to regular structures
                                            crate::wild_animal_npc::hostile_spawning::find_nearest_attackable_structure(
                                                ctx, animal.pos_x, animal.pos_y, STRUCTURE_SEARCH_RANGE
                                            )
                                        }
                                    } else {
                                        crate::wild_animal_npc::hostile_spawning::find_nearest_attackable_structure(
                                            ctx, animal.pos_x, animal.pos_y, STRUCTURE_SEARCH_RANGE
                                        )
                                    };
                                    
                                    log::debug!("👹 [HostileNPC DEBUG] {:?} {} searching for structures within {}px - found: {:?}", 
                                        animal.species, animal.id, STRUCTURE_SEARCH_RANGE, structure_result.is_some());
                                    
                                    if let Some((struct_id, struct_type, dist_sq)) = structure_result {
                                        log::debug!("👹 [HostileNPC] {:?} {} found structure to attack: {} #{} at dist {:.1}px (player {} is inside building)", 
                                            animal.species, animal.id, struct_type, struct_id, dist_sq.sqrt(), target_id);
                                        // Switch to attacking structure
                                        animal.target_structure_id = Some(struct_id);
                                        animal.target_structure_type = Some(struct_type.clone());
                                        transition_to_state(&mut animal, AnimalState::AttackingStructure, current_time, Some(target_id), &format!("attacking {} #{}", struct_type, struct_id));
                                    }
                                } else {
                                    log::debug!("👹 [HostileNPC DEBUG] {:?} {} CANNOT attack structures (not a structure-attacking species)", 
                                        animal.species, animal.id);
                                }
                            }
                        }
                    }
                }
            }
            
            // Process structure attacks for hostile NPCs
            if animal.state == AnimalState::AttackingStructure && animal.is_hostile_npc {
                if let (Some(struct_id), Some(ref struct_type)) = (animal.target_structure_id, animal.target_structure_type.clone()) {
                    // Check if hostile should stop attacking
                    // DrownedWatch NEVER stops attacking wards - they destroy them until dead!
                    // For other structures, stop if player exited building
                    let is_attacking_ward = struct_type == "ward";
                    let should_stop_attacking = if is_attacking_ward {
                        // Never stop attacking wards - DrownedWatch must destroy the protection!
                        false
                    } else if let Some(target_id) = animal.target_player_id {
                        if let Some(target_player) = ctx.db.player().identity().find(&target_id) {
                            // Only stop if player EXITED the building entirely
                            !target_player.is_inside_building
                        } else {
                            true // Player gone
                        }
                    } else {
                        true // No target player
                    };
                    
                    if should_stop_attacking {
                        log::info!("👹 [HostileNPC] {:?} {} stopping structure attack - player exited building", animal.species, animal.id);
                        animal.target_structure_id = None;
                        animal.target_structure_type = None;
                        if let Some(target_id) = animal.target_player_id {
                            transition_to_state(&mut animal, AnimalState::Chasing, current_time, Some(target_id), "player exited - chase");
                        } else {
                            transition_to_state(&mut animal, AnimalState::Patrolling, current_time, None, "no target");
                        }
                    } else {
                        // Check if we're close enough to the structure to attack
                        // For shelters, use AABB collision center (matches player attack detection)
                        let struct_pos = match struct_type.as_str() {
                            "door" => ctx.db.door().id().find(struct_id).map(|d| (d.pos_x, d.pos_y)),
                            "shelter" => ctx.db.shelter().id().find(struct_id as u32).map(|s| {
                                // Use AABB center for attack range check (matches player attack detection)
                                (s.pos_x, s.pos_y - crate::shelter::SHELTER_AABB_CENTER_Y_OFFSET_FROM_POS_Y)
                            }),
                            "ward" => ctx.db.lantern().id().find(struct_id as u32).map(|l| (l.pos_x, l.pos_y)),
                            "fence" => ctx.db.fence().id().find(struct_id).map(|f| (f.pos_x, f.pos_y)),
                            "wall" | _ => ctx.db.wall_cell().id().find(struct_id).map(|w| {
                                let wx = (w.cell_x as f32 * crate::building::FOUNDATION_TILE_SIZE_PX as f32) + (crate::building::FOUNDATION_TILE_SIZE_PX as f32 / 2.0);
                                let wy = (w.cell_y as f32 * crate::building::FOUNDATION_TILE_SIZE_PX as f32) + (crate::building::FOUNDATION_TILE_SIZE_PX as f32 / 2.0);
                                (wx, wy)
                            }),
                        };
                        
                        let in_attack_range = if let Some((sx, sy)) = struct_pos {
                            let dx = sx - animal.pos_x;
                            let dy = sy - animal.pos_y;
                            let dist_sq = dx * dx + dy * dy;
                            // IMPORTANT: Attack range must be larger than shelter collision box
                            // Shelter AABB is ~300x125px centered ~150px from edges
                            // Hostile blocked at edge needs ~200px range to hit AABB center
                            const STRUCTURE_ATTACK_RANGE: f32 = 200.0;
                            dist_sq <= STRUCTURE_ATTACK_RANGE * STRUCTURE_ATTACK_RANGE
                        } else {
                            false // Structure not found
                        };
                        
                        if in_attack_range && can_attack(&animal, current_time, &stats) {
                            // Attack the structure!
                            let structure_damage = match animal.species {
                                AnimalSpecies::Shorebound => 15.0,  // Fast stalker - moderate damage
                                AnimalSpecies::Shardkin => 5.0,     // Low damage, creates urgency
                                AnimalSpecies::DrownedWatch => 35.0, // Heavy damage
                                _ => 10.0,
                            };
                            
                            match crate::wild_animal_npc::hostile_spawning::hostile_attack_structure(
                                ctx, struct_id, &struct_type, structure_damage, current_time
                            ) {
                                Ok(destroyed) => {
                                    animal.last_attack_time = Some(current_time);
                                    
                                    // Emit blunt attack sound when hostile NPCs hit structures
                                    // Use animal position since they're close to the structure
                                    if let Some(target_id) = animal.target_player_id {
                                        crate::sound_events::emit_melee_hit_blunt_sound(
                                            ctx, animal.pos_x, animal.pos_y, target_id
                                        );
                                    }
                                    if destroyed {
                                        // Structure destroyed - look for another or chase player
                                        animal.target_structure_id = None;
                                        animal.target_structure_type = None;
                                        
                                        // Try to find another structure
                                        // DrownedWatch prioritizes wards, others use regular structure search
                                        const STRUCTURE_SEARCH_RANGE: f32 = 200.0;
                                        const WARD_HUNT_RANGE: f32 = 800.0;
                                        
                                        let new_target = if matches!(animal.species, AnimalSpecies::DrownedWatch) {
                                            // DrownedWatch: Check for wards first
                                            crate::wild_animal_npc::hostile_spawning::find_nearest_active_ward(
                                                ctx, animal.pos_x, animal.pos_y, WARD_HUNT_RANGE
                                            ).or_else(|| {
                                                crate::wild_animal_npc::hostile_spawning::find_nearest_attackable_structure(
                                                    ctx, animal.pos_x, animal.pos_y, STRUCTURE_SEARCH_RANGE
                                                )
                                            })
                                        } else {
                                            crate::wild_animal_npc::hostile_spawning::find_nearest_attackable_structure(
                                                ctx, animal.pos_x, animal.pos_y, STRUCTURE_SEARCH_RANGE
                                            )
                                        };
                                        
                                        if let Some((new_id, new_type, _)) = new_target {
                                            animal.target_structure_id = Some(new_id);
                                            animal.target_structure_type = Some(new_type);
                                        } else {
                                            // No more structures - chase player
                                            if let Some(target_id) = animal.target_player_id {
                                                transition_to_state(&mut animal, AnimalState::Chasing, current_time, Some(target_id), "structure destroyed - chase");
                                            } else {
                                                transition_to_state(&mut animal, AnimalState::Patrolling, current_time, None, "no targets");
                                            }
                                        }
                                    }
                                },
                                Err(e) => {
                                    log::error!("👹 [HostileNPC] Structure attack failed: {}", e);
                                    animal.target_structure_id = None;
                                    animal.target_structure_type = None;
                                }
                            }
                        }
                    }
                }
            }
            
            // Execute movement based on current state
            let previous_position = (animal.pos_x, animal.pos_y);
            execute_animal_movement(ctx, &mut animal, &behavior, &stats, current_time, &mut rng)?;
            if animal.tamed_by.is_none() {
                if prefetched.alk_wildlife_zones.iter().any(|zone| zone.contains(previous_position.0, previous_position.1)) {
                    clear_animal_from_alk(ctx, &mut animal, &prefetched.alk_wildlife_zones, current_time);
                } else if prefetched.alk_wildlife_zones.iter().any(|zone| zone.blocks_movement(previous_position, (animal.pos_x, animal.pos_y))) {
                    update_animal_position(&mut animal, previous_position.0, previous_position.1);
                    animal.flying_target_x = None;
                    animal.flying_target_y = None;
                }
            }
            
            // Update the animal in database, BUT only if it wasn't deleted during processing
            // (e.g., bees die from fire in check_and_apply_fire_death and get deleted there)
            // Without this check, the update() would RE-INSERT the deleted animal!
            if ctx.db.wild_animal().id().find(&animal.id).is_some() {
                ctx.db.wild_animal().id().update(animal);
            }
            
            Ok(())
        })();
        
        // Log any errors but continue processing other animals
        if let Err(e) = process_result {
            log::error!("[WildAnimalAI] Error processing {:?} #{}: {}. Skipping this animal but continuing with others.", 
                       animal_species, animal_id, e);
        }
    }

    Ok(())
}

// --- AI State Management ---

fn update_animal_ai_state(
    ctx: &ReducerContext,
    prefetched: &PreFetchedAIData,
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
        // Clear fire fear override when fleeing due to low health
        animal.fire_fear_overridden_by = None;
        return Ok(());
    }
    
    // IDLE WAKE-UP: Animals in Idle state check if they should start moving
    // This happens when a player gets close enough to potentially see them
    if animal.state == AnimalState::Idle {
        // Check if any player is within detection range OR close enough to warrant wandering
        if !nearby_players.is_empty() {
            // Player detected nearby - wake up and potentially start chasing
            // Detection logic below will handle the state transition
            log::debug!("{:?} {} waking from Idle - player detected nearby", animal.species, animal.id);
            // Don't transition yet - let the normal detection logic handle it below
        } else {
            // No players in detection range - stay in Idle
            // Only skip remaining logic if no players are within wander activation distance
            // (The prefetched player data in nearby_players is filtered by perception range,
            //  so if it's empty, definitely stay idle)
            return Ok(());
        }
    }

    // CENTRALIZED FEAR LOGIC - Foundation fear applies to most animals regardless of group size
    // Fire/torch fear can be ignored by groups (group courage), but foundations should always be feared
    // EXCEPTION: Night hostile NPCs (Shorebound, Shardkin, DrownedWatch) fear NOTHING except monument zones
    
    // Check if this is a hostile NPC that doesn't fear anything (except monument zones)
    let is_fearless_hostile = matches!(animal.species, 
        AnimalSpecies::Shorebound | AnimalSpecies::Shardkin | AnimalSpecies::DrownedWatch);
    
    // MONUMENT EXCLUSION ZONE - Hostile NPCs actively avoid protected monument areas (ALK, Fishing Village)
    // This prevents players from griefing NPCs by standing in safe zones and killing them
    // Hostile NPCs will patrol around these zones, never entering them
    // NOTE: Shipwrecks use per-part zones below, not this monument system
    if is_fearless_hostile {
        if let Some((zone_x, zone_y, exclusion_radius)) = get_monument_exclusion_zone(ctx, animal.pos_x, animal.pos_y) {
            // We're inside a monument exclusion zone - push out immediately
            let dx = animal.pos_x - zone_x;
            let dy = animal.pos_y - zone_y;
            let dist = (dx * dx + dy * dy).sqrt();
            
            if dist > 1.0 {
                // Push outward to just outside the exclusion zone
                let push_dist = exclusion_radius - dist + 100.0; // 100px buffer outside
                let new_x = animal.pos_x + (dx / dist) * push_dist;
                let new_y = animal.pos_y + (dy / dist) * push_dist;
                update_animal_position(animal, new_x, new_y);
                
                log::info!("{:?} {} pushed out of monument zone at ({:.0}, {:.0}) - new position ({:.1}, {:.1})",
                          animal.species, animal.id, zone_x, zone_y, new_x, new_y);
            } else {
                // At center - push in arbitrary direction
                let new_x = zone_x + exclusion_radius + 100.0;
                update_animal_position(animal, new_x, animal.pos_y);
            }
            
            // Clear any target player that's inside the zone (don't chase into safe zones)
            if let Some(target_id) = animal.target_player_id {
                if let Some(target_player) = ctx.db.player().identity().find(&target_id) {
                    if get_monument_exclusion_zone(ctx, target_player.position_x, target_player.position_y).is_some() {
                        // Target is in a safe zone - forget about them
                        animal.target_player_id = None;
                        transition_to_state(animal, AnimalState::Patrolling, current_time, None, "target in safe zone");
                        log::debug!("{:?} {} abandoning target {:?} - player is in monument safe zone",
                                  animal.species, animal.id, target_id);
                    }
                }
            }
        }
        
        // SHIPWRECK PART AVOIDANCE - Check each individual shipwreck part (192px zones)
        // This works like shelter avoidance - small zones around each part, not one big monument zone
        // NOTE: Protection zones are centered at visual center of sprites (using Y-offset)
        for part in ctx.db.monument_part().iter() {
            if part.monument_type != MonumentType::Shipwreck {
                continue;
            }
            let dx = animal.pos_x - part.world_x;
            // Apply Y-offset to check distance from visual center, not anchor point
            let protection_center_y = part.world_y - crate::shipwreck::SHIPWRECK_PROTECTION_Y_OFFSET;
            let dy = animal.pos_y - protection_center_y;
            let dist_sq = dx * dx + dy * dy;
            
            if dist_sq < crate::shipwreck::SHIPWRECK_PROTECTION_RADIUS_SQ {
                // Inside a shipwreck part zone - push out
                let dist = dist_sq.sqrt();
                if dist > 1.0 {
                    let push_dist = crate::shipwreck::SHIPWRECK_PROTECTION_RADIUS - dist + 30.0; // 30px buffer
                    let new_x = animal.pos_x + (dx / dist) * push_dist;
                    let new_y = animal.pos_y + (dy / dist) * push_dist;
                    update_animal_position(animal, new_x, new_y);
                    
                    log::debug!("{:?} {} pushed out of shipwreck part zone at ({:.0}, {:.0})",
                              animal.species, animal.id, part.world_x, protection_center_y);
                } else {
                    // At center - push in arbitrary direction
                    let new_x = part.world_x + crate::shipwreck::SHIPWRECK_PROTECTION_RADIUS + 30.0;
                    update_animal_position(animal, new_x, animal.pos_y);
                }
                break; // Only need to push out of one zone at a time
            }
        }
        
        // Clear target if player is in any shipwreck part zone
        if let Some(target_id) = animal.target_player_id {
            if let Some(target_player) = ctx.db.player().identity().find(&target_id) {
                if crate::shipwreck::is_position_protected_by_shipwreck(ctx, target_player.position_x, target_player.position_y) {
                    // Target is in a shipwreck part zone - forget about them
                    animal.target_player_id = None;
                    transition_to_state(animal, AnimalState::Patrolling, current_time, None, "target in shipwreck zone");
                    log::debug!("{:?} {} abandoning target {:?} - player is in shipwreck part zone",
                              animal.species, animal.id, target_id);
                }
            }
        }
    }
    
    // Check foundation fear first (applies to ALL animals EXCEPT hostile NPCs)
    let should_fear_foundations = !is_fearless_hostile
        && is_foundation_nearby_prefetched(animal.pos_x, animal.pos_y, &prefetched.active_foundation_positions);
    
    if should_fear_foundations {
        // ALL animals flee from foundations (player structures) - no group courage exception
        if let Some((foundation_x, foundation_y)) =
            find_closest_foundation_position_prefetched(animal.pos_x, animal.pos_y, &prefetched.active_foundation_positions)
        {
            transition_to_state(animal, AnimalState::Fleeing, current_time, None, "fleeing from foundation");
            
            // Species-specific flee distances from foundations
            let flee_distance = match animal.species {
                AnimalSpecies::TundraWolf => 400.0,
                AnimalSpecies::CinderFox => 320.0,
                AnimalSpecies::CableViper => 300.0,
                AnimalSpecies::ArcticWalrus => 300.0, // Walruses also fear foundations
                AnimalSpecies::BeachCrab => 200.0, // Crabs are small and scuttle away from buildings
                AnimalSpecies::Tern => 500.0, // Birds fly away from foundations
                AnimalSpecies::Crow => 450.0, // Crows fly away from foundations
                AnimalSpecies::Vole => 350.0, // Voles flee quickly from buildings
                AnimalSpecies::Wolverine => 0.0, // Wolverines are fearless - don't flee from foundations
                AnimalSpecies::Caribou => 400.0, // Caribou flee from foundations
                AnimalSpecies::SalmonShark => 0.0, // Sharks don't flee from foundations (water-only)
                AnimalSpecies::Jellyfish => 0.0, // Jellyfish don't flee from foundations (water-only)
                // Night hostile NPCs don't flee from foundations
                AnimalSpecies::Shorebound | AnimalSpecies::Shardkin | AnimalSpecies::DrownedWatch => 0.0,
                // Bees don't flee from foundations
                AnimalSpecies::Bee => 0.0,
                // Alpine animals
                AnimalSpecies::PolarBear => 0.0, // Polar bears are fearless - don't flee from foundations
                AnimalSpecies::Hare => 400.0, // Hares flee quickly from buildings
                AnimalSpecies::SnowyOwl => 350.0, // Owls fly away from foundations
            };
            
            set_flee_destination_away_from_threat(animal, foundation_x, foundation_y, flee_distance, rng);
            
            log::info!("{:?} {} FLEEING from foundation - target: ({:.1}, {:.1})", 
                      animal.species, animal.id,
                      animal.investigation_x.unwrap_or(0.0), 
                      animal.investigation_y.unwrap_or(0.0));
            
            return Ok(()); // Skip normal AI logic - animal is now fleeing from foundation
        }
    }
    
    // FIRE FEAR LOGIC - Only applies to non-walruses, non-crows, non-bees, and non-hostile NPCs
    // Walruses are curious about fire, crows are bold thieves that don't fear flames
    // Night hostile NPCs (Shorebound, Shardkin, DrownedWatch) are fearless and charge through fire
    // BEES: Handled separately in BeeBehavior::update_ai_state_logic - they DIE from fire, not flee!
    let fears_fire = should_fear_fire_prefetched(prefetched, ctx, animal);
    if !is_fearless_hostile && 
       animal.species != AnimalSpecies::ArcticWalrus && 
       animal.species != AnimalSpecies::Crow && 
       animal.species != AnimalSpecies::Bee &&  // Bees die from fire, handled in their AI
       fears_fire {
        // Check for fire from players with torches
        for player in nearby_players {
            let player_has_fire = is_fire_nearby_prefetched(
                player.position_x,
                player.position_y,
                &prefetched.burning_campfires,
                &prefetched.lit_torch_players,
                &prefetched.active_foundation_positions,
            );
            
            if player_has_fire {
                // Check if fire fear is overridden for this specific player
                let should_fear_this_player = animal.fire_fear_overridden_by.map_or(true, |override_id| override_id != player.identity);
                
                if should_fear_this_player {
                    // FORCE FLEE STATE - Don't just filter players, actively flee from fire
                    transition_to_state(animal, AnimalState::Fleeing, current_time, None, "fleeing from torch");
                    
                    // Set flee destination away from the fire source
                    let flee_distance = match animal.species {
                        AnimalSpecies::TundraWolf => 950.0,   // 750 + 200 buffer
                        AnimalSpecies::CinderFox => 640.0,    // INCREASED: Proportional to new 240px chase range  
                        AnimalSpecies::CableViper => 500.0,   // 350 + 150 buffer
                        AnimalSpecies::ArcticWalrus => unreachable!(), // Already handled above
                        AnimalSpecies::BeachCrab => 300.0,    // Crabs scuttle away from fire
                        AnimalSpecies::Tern => 600.0,         // Birds fly away from fire
                        AnimalSpecies::Crow => 550.0,         // Crows fly away from fire
                        AnimalSpecies::Vole => 450.0,         // Voles flee quickly from fire
                        AnimalSpecies::Wolverine => 0.0,      // Wolverines are fearless - don't flee from fire
                        AnimalSpecies::Caribou => 500.0,      // Caribou flee from fire
                        AnimalSpecies::SalmonShark => 0.0,    // Sharks don't flee from fire (water-only)
                        AnimalSpecies::Jellyfish => 0.0,     // Jellyfish don't flee from fire (water-only)
                        // Night hostile NPCs don't flee from fire
                        AnimalSpecies::Shorebound | AnimalSpecies::Shardkin | AnimalSpecies::DrownedWatch => 0.0,
                        // Bees don't flee - they die from fire instead
                        AnimalSpecies::Bee => 0.0,
                        // Alpine animals
                        AnimalSpecies::PolarBear => 600.0, // Polar bears flee from fire (exception to fearlessness)
                        AnimalSpecies::Hare => 500.0,      // Hares flee quickly from fire
                        AnimalSpecies::SnowyOwl => 600.0,  // Owls fly away from fire
                    };
                    
                    set_flee_destination_away_from_threat(animal, player.position_x, player.position_y, flee_distance, rng);
                    
                    log::info!("{:?} {} FLEEING from torch - target: ({:.1}, {:.1})", 
                              animal.species, animal.id, 
                              animal.investigation_x.unwrap_or(0.0), 
                              animal.investigation_y.unwrap_or(0.0));
                    
                    return Ok(()); // Skip normal AI logic - animal is now fleeing
                }
            }
        }
        
        // Check for standalone campfires
        if let Some((fire_x, fire_y)) = find_closest_fire_position_prefetched(
            animal.pos_x,
            animal.pos_y,
            &prefetched.burning_campfires,
            &prefetched.lit_torch_players,
            &prefetched.active_foundation_positions,
        ) {
            // Check if fire fear override applies for any nearby players
            let mut should_flee_from_fire = true;
            
            if let Some(override_player_id) = animal.fire_fear_overridden_by {
                for player in &prefetched.all_players {
                    if player.identity == override_player_id && !player.is_dead {
                        let distance_to_player = get_distance_squared(animal.pos_x, animal.pos_y, player.position_x, player.position_y).sqrt();
                        let distance_to_fire = get_distance_squared(animal.pos_x, animal.pos_y, fire_x, fire_y).sqrt();
                        
                        // If the override player is near this fire source, don't flee
                        if distance_to_player <= 300.0 && distance_to_fire <= FIRE_FEAR_RADIUS {
                            should_flee_from_fire = false;
                            break;
                        }
                    }
                }
            }
            
            if should_flee_from_fire {
                // FORCE FLEE STATE from standalone fire sources (campfires)
                transition_to_state(animal, AnimalState::Fleeing, current_time, None, "fleeing from campfire");
                
                let flee_distance = match animal.species {
                    AnimalSpecies::TundraWolf => 950.0,
                    AnimalSpecies::CinderFox => 640.0,
                    AnimalSpecies::CableViper => 500.0,
                    AnimalSpecies::ArcticWalrus => unreachable!(), // Already handled above
                    AnimalSpecies::BeachCrab => 300.0, // Crabs scuttle away from campfires
                    AnimalSpecies::Tern => 600.0, // Birds fly away from campfires
                    AnimalSpecies::Crow => 550.0, // Crows fly away from campfires
                    AnimalSpecies::Vole => 450.0, // Voles flee quickly from campfires
                    AnimalSpecies::Wolverine => 0.0, // Wolverines are fearless - don't flee from campfires
                    AnimalSpecies::Caribou => 500.0, // Caribou flee from campfires
                    AnimalSpecies::SalmonShark => 0.0, // Sharks don't flee from campfires (water-only)
                    AnimalSpecies::Jellyfish => 0.0,  // Jellyfish don't flee from campfires (water-only)
                    // Night hostile NPCs don't flee from campfires
                    AnimalSpecies::Shorebound | AnimalSpecies::Shardkin | AnimalSpecies::DrownedWatch => 0.0,
                    // Bees die from fire instead of fleeing
                    AnimalSpecies::Bee => 0.0,
                    // Alpine animals
                    AnimalSpecies::PolarBear => 600.0, // Polar bears flee from fire
                    AnimalSpecies::Hare => 500.0,      // Hares flee quickly from fire
                    AnimalSpecies::SnowyOwl => 600.0,  // Owls fly away from fire
                };
                
                set_flee_destination_away_from_threat(animal, fire_x, fire_y, flee_distance, rng);
                
                log::info!("{:?} {} FLEEING from campfire - target: ({:.1}, {:.1})", 
                          animal.species, animal.id,
                          animal.investigation_x.unwrap_or(0.0), 
                          animal.investigation_y.unwrap_or(0.0));
                
                return Ok(()); // Skip normal AI logic - animal is now fleeing
            }
        }
    }
    
    // Normal AI logic - only process if not fleeing from fire
    // Filter out fire-afraid players for target selection
    // 
    // CRITICAL: Some animals should NEVER filter players due to fire:
    // - Fearless hostile NPCs (Shorebound, Shardkin, DrownedWatch) charge through fire
    // - Bees NEED to chase torch-wielding players to die from fire proximity
    //   (if we filter out torch players, bees can't get close enough to burn)
    let should_skip_fire_filtering = is_fearless_hostile || 
        animal.species == AnimalSpecies::Bee;
    
    let detected_player = if should_skip_fire_filtering {
        // These species don't filter players based on fire - use all nearby players
        find_detected_player(ctx, animal, stats, &nearby_players)
    } else {
        // Normal species: filter out players with fire if this animal fears it
        let mut fire_safe_players = Vec::new();
        
        for player in nearby_players {
            let player_has_fire = is_fire_nearby_prefetched(
                player.position_x,
                player.position_y,
                &prefetched.burning_campfires,
                &prefetched.lit_torch_players,
                &prefetched.active_foundation_positions,
            );
            let should_fear_this_player = player_has_fire && 
                fears_fire &&
                // Only fear if no override OR override is for a different player
                animal.fire_fear_overridden_by.map_or(true, |override_id| override_id != player.identity);
            
            if !should_fear_this_player {
                fire_safe_players.push(player.clone());
            }
        }
        
        find_detected_player(ctx, animal, stats, &fire_safe_players)
    };
    behavior.update_ai_state_logic(ctx, animal, stats, detected_player.as_ref(), current_time, rng)?;

    Ok(())
}

// --- Movement Execution ---

/// In melee range, keep lateral motion (orbit / stutter-step) instead of rooting until the next strike.
/// `hesitation_multiplier` scales speed (flashlight, etc.).
fn apply_melee_engagement_movement(
    ctx: &ReducerContext,
    animal: &mut WildAnimal,
    target_player: &Player,
    stats: &AnimalStats,
    distance_to_target: f32,
    dt: f32,
    hesitation_multiplier: f32,
) {
    let dx = target_player.position_x - animal.pos_x;
    let dy = target_player.position_y - animal.pos_y;
    let dist = distance_to_target.max(1.0);
    let nx = dx / dist;
    let ny = dy / dist;
    // Stable handedness per animal so strafe direction does not flip randomly each tick
    let hand = if (animal.id & 1) == 0 { 1.0 } else { -1.0 };
    let tx = -ny * hand;
    let ty = nx * hand;

    let inner = stats.attack_range * 0.48;
    let radial_blend = if distance_to_target < inner {
        0.45
    } else {
        0.0
    };

    let mut mx = tx + nx * radial_blend;
    let mut my = ty + ny * radial_blend;
    let mlen = (mx * mx + my * my).sqrt().max(0.001);
    mx /= mlen;
    my /= mlen;

    let combat_speed =
        (stats.movement_speed * 0.92 + stats.sprint_speed * 0.22) * hesitation_multiplier;
    const ENGAGE_LEAD_PX: f32 = 72.0;
    let goal_x = animal.pos_x + mx * ENGAGE_LEAD_PX;
    let goal_y = animal.pos_y + my * ENGAGE_LEAD_PX;
    move_towards_target(ctx, animal, goal_x, goal_y, combat_speed, dt);
}

fn execute_animal_movement(
    ctx: &ReducerContext,
    animal: &mut WildAnimal,
    behavior: &AnimalBehaviorEnum,
    stats: &AnimalStats,
    current_time: Timestamp,
    rng: &mut impl Rng,
) -> Result<(), String> {
    let dt = AI_TICK_INTERVAL_MS as f32 / 1000.0;
    
    let mut is_sprinting = false;
    
    // Fire fear is now handled entirely in update_animal_ai_state() 
    // Movement system just executes whatever state the animal is in
    
    match animal.state {
        AnimalState::Patrolling => {
            // For birds in Patrolling state, use is_flying flag to determine behavior
            // This ensures proper sprite selection (walking vs flying)
            if is_flying_species(&animal.species) {
                if animal.is_flying {
                    execute_flying_patrol(ctx, animal, stats, dt, rng);
                } else {
                    execute_grounded_idle(ctx, animal, stats, dt, rng);
                }
            } else {
                // Non-birds use standard patrol
                behavior.execute_patrol_logic(ctx, animal, stats, dt, rng);
            }
        },
        
        AnimalState::Chasing => {
            if let Some(target_id) = animal.target_player_id {
                if let Some(target_player) = ctx.db.player().identity().find(&target_id) {
                    // WARD DETERRENCE: Hostile NPCs will NOT enter active ward zones
                    // If the target player is inside a ward zone, break off chase and flee
                    // This is only for hostile NPCs (apparitions) - regular animals ignore wards
                    // EXCEPTION: DrownedWatch IGNORES wards - they target and destroy them!
                    if animal.is_hostile_npc && !matches!(animal.species, AnimalSpecies::DrownedWatch) {
                        // Check if target player is inside an active ward zone
                        if let Some((ward_x, ward_y, ward_radius_sq)) = 
                            crate::wild_animal_npc::hostile_spawning::get_active_ward_at_position(
                                ctx, target_player.position_x, target_player.position_y
                            ) {
                            // Player is protected by a ward - hostile cannot approach
                            // Calculate flee direction AWAY from the ward center
                            let dx = animal.pos_x - ward_x;
                            let dy = animal.pos_y - ward_y;
                            let dist = (dx * dx + dy * dy).sqrt();
                            
                            if dist > 1.0 {
                                // Set flee destination to a point well outside the ward radius
                                let ward_radius = ward_radius_sq.sqrt();
                                let flee_distance = ward_radius + 200.0; // Move 200px beyond ward radius
                                animal.investigation_x = Some(ward_x + (dx / dist) * flee_distance);
                                animal.investigation_y = Some(ward_y + (dy / dist) * flee_distance);
                            }
                            
                            // Transition to patrolling - break off chase, target is in safe zone
                            animal.target_player_id = None;
                            animal.state = AnimalState::Patrolling;
                            log::debug!("🛡️ [Ward] Hostile {:?} {} broke off chase - player inside ward zone", 
                                       animal.species, animal.id);
                            return Ok(()); // Exit early, don't continue chase
                        }
                        
                        // Also check if the hostile NPC itself is inside a ward zone (shouldn't happen but safety check)
                        if crate::wild_animal_npc::hostile_spawning::is_position_in_active_ward_zone(
                            ctx, animal.pos_x, animal.pos_y
                        ) {
                            // Hostile is inside ward zone - flee immediately!
                            if let Some((ward_x, ward_y, ward_radius_sq)) = 
                                crate::wild_animal_npc::hostile_spawning::get_active_ward_at_position(
                                    ctx, animal.pos_x, animal.pos_y
                                ) {
                                let dx = animal.pos_x - ward_x;
                                let dy = animal.pos_y - ward_y;
                                let dist = (dx * dx + dy * dy).sqrt();
                                
                                if dist > 1.0 {
                                    let ward_radius = ward_radius_sq.sqrt();
                                    let flee_distance = ward_radius + 200.0;
                                    animal.investigation_x = Some(ward_x + (dx / dist) * flee_distance);
                                    animal.investigation_y = Some(ward_y + (dy / dist) * flee_distance);
                                }
                            }
                            
                            animal.target_player_id = None;
                            animal.state = AnimalState::Fleeing;
                            log::info!("🛡️ [Ward] Hostile {:?} {} is inside ward zone - fleeing!", 
                                      animal.species, animal.id);
                            return Ok(());
                        }
                    }
                    
                    let distance_sq = get_distance_squared(
                        animal.pos_x, animal.pos_y,
                        target_player.position_x, target_player.position_y
                    );
                    let distance = distance_sq.sqrt();
                    
                    // COLLISION ENFORCEMENT: Prevent animals from standing inside players
                    // Use attack range as minimum since that's where they should stop
                    // This is critical for fast hostile NPCs that can overshoot in a single tick
                    enforce_minimum_player_distance(animal, &target_player, stats);
                    
                    // Recalculate distance after potential pushback
                    let new_distance_sq = get_distance_squared(
                        animal.pos_x, animal.pos_y,
                        target_player.position_x, target_player.position_y
                    );
                    let new_distance = new_distance_sq.sqrt();
                    
                    // FLASHLIGHT HESITATION: Hostile NPCs move slower when in flashlight beam
                    // This applies during chasing movement to give players a tactical advantage
                    let hesitation_multiplier = get_flashlight_hesitation_multiplier(ctx, animal);
                    
                    // Check if NPC should use ranged combat (has ranged capability AND player has ranged weapon)
                    let npc_has_ranged = get_npc_ranged_attack_config(animal.species).is_some();
                    let player_using_ranged = player_has_ranged_weapon(ctx, target_id);
                    let should_use_ranged_mode = npc_has_ranged && player_using_ranged;
                    
                    if should_use_ranged_mode {
                        // RANGED MODE: Player has ranged weapon, NPC maintains optimal firing distance
                        // Don't close in - instead, maintain range and fire projectiles
                        const RANGED_OPTIMAL_MIN: f32 = 400.0;  // Don't get closer than this
                        const RANGED_OPTIMAL_MAX: f32 = 600.0;  // Move in if farther than this
                        
                        if new_distance < RANGED_OPTIMAL_MIN {
                            // Too close! Back up to maintain distance
                            let dx = animal.pos_x - target_player.position_x;
                            let dy = animal.pos_y - target_player.position_y;
                            let dist = (dx * dx + dy * dy).sqrt().max(1.0);
                            
                            // Move away from player
                            let retreat_target_x = animal.pos_x + (dx / dist) * 100.0;
                            let retreat_target_y = animal.pos_y + (dy / dist) * 100.0;
                            let effective_speed = stats.movement_speed * hesitation_multiplier;
                            move_towards_target(ctx, animal, retreat_target_x, retreat_target_y, effective_speed, dt);
                        } else if new_distance > RANGED_OPTIMAL_MAX {
                            // Too far - close in until at optimal range
                            is_sprinting = hesitation_multiplier >= 1.0;
                            let effective_speed = stats.sprint_speed * hesitation_multiplier;
                            move_towards_target(ctx, animal, target_player.position_x, target_player.position_y, effective_speed, dt);
                        }
                        // If in optimal range (200-400px), stay put and fire projectiles (handled elsewhere)
                    } else {
                        // MELEE MODE: close from outside; inside range, orbit/stutter-step (stay readable, not a frozen turret)
                        // 🐺 NOTE: Once an animal is chasing (e.g., you attacked it), wolf fur won't stop it!
                        if new_distance > stats.attack_range * 0.9 {
                            is_sprinting = hesitation_multiplier >= 1.0;
                            let effective_speed = stats.sprint_speed * hesitation_multiplier;
                            move_towards_target(ctx, animal, target_player.position_x, target_player.position_y, effective_speed, dt);
                        } else {
                            is_sprinting = hesitation_multiplier >= 1.0;
                            apply_melee_engagement_movement(
                                ctx,
                                animal,
                                &target_player,
                                stats,
                                new_distance,
                                dt,
                                hesitation_multiplier,
                            );
                        }
                    }
                }
            }
        },
        
        AnimalState::Investigating => {
            // Handle strafe movement for investigation behavior
            if let (Some(target_x), Some(target_y)) = (animal.investigation_x, animal.investigation_y) {
                // Enhanced movement speed for aggressive strafing
                let strafe_speed = match animal.species {
                    AnimalSpecies::CableViper => stats.sprint_speed * 0.8, // Fast strafing for vipers
                    _ => stats.movement_speed * 1.2, // Slightly faster for other species
                };
                
                is_sprinting = strafe_speed > stats.movement_speed * 1.1; // Consider sprinting if significantly faster
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
            is_sprinting = true; // Fleeing uses sprint speed
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
        
        AnimalState::Following => {
            // Tamed animal following their owner
            handle_tamed_following(ctx, animal, stats, current_time, dt, rng);
        },
        
        AnimalState::Protecting => {
            // Tamed animal protecting their owner from threats
            handle_tamed_protecting(ctx, animal, stats, current_time, dt, rng);
        },
        
        // ============================================================
        // BIRD-SPECIFIC STATES - Handle Flying, Grounded, Scavenging, Stealing
        // ============================================================
        
        AnimalState::Flying => {
            // Flying birds - ensure is_flying is true and execute flying patrol
            // This is the FLYING state, so bird should always be flying here
            if is_flying_species(&animal.species) {
                animal.is_flying = true; // Ensure flag is set for sprite selection
                execute_flying_patrol(ctx, animal, stats, dt, rng);
            } else {
                // Non-birds shouldn't be in Flying state, fallback to patrol
                behavior.execute_patrol_logic(ctx, animal, stats, dt, rng);
            }
        },
        
        AnimalState::FlyingChase => {
            // Flying chase toward a target
            is_sprinting = true;
            if let (Some(target_x), Some(target_y)) = (animal.investigation_x, animal.investigation_y) {
                execute_flying_chase(ctx, animal, stats, target_x, target_y, dt);
            } else if let Some(target_id) = animal.target_player_id {
                if let Some(target_player) = ctx.db.player().identity().find(&target_id) {
                    execute_flying_chase(ctx, animal, stats, target_player.position_x, target_player.position_y, dt);
                }
            }
        },
        
        AnimalState::Grounded => {
            // Grounded birds - walk around using direction-based patrol (like crabs)
            // This is the GROUNDED state, so bird should always be walking here
            animal.is_flying = false; // Ensure flag is set for walking sprite selection
            execute_grounded_idle(ctx, animal, stats, dt, rng);
        },
        
        AnimalState::Scavenging => {
            // Terns scavenging dropped items - fly/walk toward investigation target
            if let (Some(target_x), Some(target_y)) = (animal.investigation_x, animal.investigation_y) {
                let distance_sq = get_distance_squared(animal.pos_x, animal.pos_y, target_x, target_y);
                
                if animal.is_flying {
                    // Fly toward item
                    execute_flying_chase(ctx, animal, stats, target_x, target_y, dt);
                } else if distance_sq > 100.0 * 100.0 {
                    // Too far - take off and fly
                    animal.is_flying = true;
                    execute_flying_chase(ctx, animal, stats, target_x, target_y, dt);
                } else {
                    // Walk toward item on ground
                    move_towards_target(ctx, animal, target_x, target_y, stats.movement_speed, dt);
                }
            } else {
                // No target - return to patrol
                behavior.execute_patrol_logic(ctx, animal, stats, dt, rng);
            }
        },
        
        AnimalState::Stealing => {
            // Crows stealing from players - fly toward target
            if let (Some(target_x), Some(target_y)) = (animal.investigation_x, animal.investigation_y) {
                animal.is_flying = true;
                execute_flying_chase(ctx, animal, stats, target_x, target_y, dt);
            } else if let Some(target_id) = animal.target_player_id {
                if let Some(target_player) = ctx.db.player().identity().find(&target_id) {
                    animal.is_flying = true;
                    execute_flying_chase(ctx, animal, stats, target_player.position_x, target_player.position_y, dt);
                }
            } else {
                // No target - return to patrol
                behavior.execute_patrol_logic(ctx, animal, stats, dt, rng);
            }
        },
        
        AnimalState::Idle => {
            // PERFORMANCE: Idle state - animal stays completely still
            // No movement, no animation updates (except facing direction)
            // Wake-up to Patrolling is handled in update_animal_ai_state when player gets close
        },
        
        AnimalState::Stalking => {
            // Shorebound stalking behavior - delegate to species-specific patrol logic
            // which handles the special circling movement for Stalking state
            behavior.execute_patrol_logic(ctx, animal, stats, dt, rng);
        },
        
        AnimalState::Attacking => {
            // Keep slight footwork during attack windows (hostiles / sharks) instead of a hard freeze
            if let Some(target_id) = animal.target_player_id {
                if let Some(target_player) = ctx.db.player().identity().find(&target_id) {
                    enforce_minimum_player_distance(animal, &target_player, stats);
                    let d_sq = get_distance_squared(
                        animal.pos_x,
                        animal.pos_y,
                        target_player.position_x,
                        target_player.position_y,
                    );
                    let d = d_sq.sqrt();
                    if d <= stats.attack_range * 1.05 {
                        apply_melee_engagement_movement(
                            ctx,
                            animal,
                            &target_player,
                            stats,
                            d,
                            dt,
                            get_flashlight_hesitation_multiplier(ctx, animal),
                        );
                    }
                }
            }
        },
        
        // ============================================================
        // AQUATIC STATES - Sharks patrol/chase in water, Jellyfish drift
        // ============================================================
        
        AnimalState::Swimming => {
            // Salmon Shark patrolling in water - delegate to species patrol logic
            behavior.execute_patrol_logic(ctx, animal, stats, dt, rng);
        },
        
        AnimalState::SwimmingChase => {
            // Salmon Shark chasing prey in water - move toward target
            is_sprinting = true;
            if let Some(target_id) = animal.target_player_id {
                if let Some(target_player) = ctx.db.player().identity().find(&target_id) {
                    let distance_sq = get_distance_squared(
                        animal.pos_x, animal.pos_y,
                        target_player.position_x, target_player.position_y
                    );
                    let distance = distance_sq.sqrt();
                    enforce_minimum_player_distance(animal, &target_player, stats);
                    let new_distance_sq = get_distance_squared(
                        animal.pos_x, animal.pos_y,
                        target_player.position_x, target_player.position_y
                    );
                    let new_distance = new_distance_sq.sqrt();
                    if new_distance > stats.attack_range * 0.9 {
                        move_towards_target(ctx, animal, target_player.position_x, target_player.position_y, stats.sprint_speed, dt);
                    } else {
                        apply_melee_engagement_movement(
                            ctx,
                            animal,
                            &target_player,
                            stats,
                            new_distance,
                            dt,
                            1.0,
                        );
                    }
                }
            }
        },
        
        AnimalState::Drifting => {
            // Jellyfish passive drifting - delegate to species patrol logic
            behavior.execute_patrol_logic(ctx, animal, stats, dt, rng);
        },
        
        AnimalState::AttackingStructure => {
            // Hostile NPCs attacking structures - MOVE TOWARD the structure!
            if let (Some(struct_id), Some(ref struct_type)) = (animal.target_structure_id, animal.target_structure_type.clone()) {
                // Get structure position based on type
                // For shelters, use AABB collision center (matches attack detection position)
                let struct_pos = match struct_type.as_str() {
                    "door" => ctx.db.door().id().find(struct_id).map(|d| (d.pos_x, d.pos_y)),
                    "shelter" => ctx.db.shelter().id().find(struct_id as u32).map(|s| {
                        // Use AABB center for movement/attack targeting (matches player attack detection)
                        (s.pos_x, s.pos_y - crate::shelter::SHELTER_AABB_CENTER_Y_OFFSET_FROM_POS_Y)
                    }),
                    "ward" => ctx.db.lantern().id().find(struct_id as u32).map(|l| (l.pos_x, l.pos_y)),
                    "wall" | _ => ctx.db.wall_cell().id().find(struct_id).map(|w| {
                        let wx = (w.cell_x as f32 * crate::building::FOUNDATION_TILE_SIZE_PX as f32) + (crate::building::FOUNDATION_TILE_SIZE_PX as f32 / 2.0);
                        let wy = (w.cell_y as f32 * crate::building::FOUNDATION_TILE_SIZE_PX as f32) + (crate::building::FOUNDATION_TILE_SIZE_PX as f32 / 2.0);
                        (wx, wy)
                    }),
                };
                
                if let Some((target_x, target_y)) = struct_pos {
                    let dx = target_x - animal.pos_x;
                    let dy = target_y - animal.pos_y;
                    let dist = (dx * dx + dy * dy).sqrt();
                    
                    // Move toward structure if not in attack range
                    // Range is 200px to allow attacking from outside shelter collision box
                    const STRUCTURE_ATTACK_RANGE: f32 = 200.0;
                    if dist > STRUCTURE_ATTACK_RANGE {
                        // Normalize direction and move
                        let move_speed = stats.sprint_speed; // Use sprint speed when attacking
                        let norm_x = dx / dist;
                        let norm_y = dy / dist;
                        
                        // Calculate proposed position
                        let dt = AI_TICK_INTERVAL_MS as f32 / 1000.0;
                        let proposed_x = animal.pos_x + norm_x * move_speed * dt;
                        let proposed_y = animal.pos_y + norm_y * move_speed * dt;
                        
                        // Apply collision (this will respect walls, preventing clipping)
                        // is_attacking=false since we're just moving toward the structure, not attacking yet
                        let (final_x, final_y) = crate::animal_collision::resolve_animal_collision(
                            ctx, animal.id, animal.pos_x, animal.pos_y, proposed_x, proposed_y, false
                        );
                        
                        animal.pos_x = final_x;
                        animal.pos_y = final_y;
                    }
                }
            }
        },
        
        _ => {} // Other states (Hiding, Burrowed, Despawning) don't move continuously
    }

    // Keep animal within world bounds
    clamp_to_world_bounds(animal);
    
    // --- Animal Walking Sound Logic ---
    // DISABLED: Animal walking sounds temporarily removed due to duplicate sound playback issues
    // The logic below was causing sounds to play multiple times. Will be re-enabled once
    // the client-side sound event deduplication is properly implemented.
    
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
        // <<< LINE OF SIGHT CHECK - Attacks cannot go through walls or closed doors >>>
        // EXCEPTION: Bees are tiny flying insects - they fly around/through obstacles to sting
        if animal.species != AnimalSpecies::Bee {
            if !crate::animal_collision::has_clear_line_of_sight(ctx, animal.pos_x, animal.pos_y, target.position_x, target.position_y) {
                log::info!("Animal {:?} {} attack blocked - wall/door between animal and Player {:?}", 
                    animal.species, animal.id, target.identity);
                return Ok(()); // No damage applied - obstacle in the way
            }
        }
        // <<< END LINE OF SIGHT CHECK >>>
        
        // <<< SAFE ZONE CHECK - Players in safe zones are immune to animal damage >>>
        if crate::active_effects::player_has_safe_zone_effect(ctx, target.identity) {
            log::info!("Animal {:?} {} attack blocked - Player {:?} is in a safe zone",
                animal.species, animal.id, target.identity);
            return Ok(()); // No damage applied
        }
        // <<< END SAFE ZONE CHECK >>>
        
        // <<< SHIPWRECK PROTECTION CHECK - Players in shipwreck zones are immune to hostile NPC damage >>>
        // Only check if NPC is near a shipwreck AND player is in protection zone
        if animal.is_hostile_npc {
            let npc_near_shipwreck = ctx.db.monument_part().iter().any(|part| {
                if part.monument_type != MonumentType::Shipwreck {
                    return false;
                }
                let dx = animal.pos_x - part.world_x;
                let protection_center_y = part.world_y - crate::shipwreck::SHIPWRECK_PROTECTION_Y_OFFSET;
                let dy = animal.pos_y - protection_center_y;
                dx * dx + dy * dy < 500.0 * 500.0
            });
            
            if npc_near_shipwreck && crate::shipwreck::is_position_protected_by_shipwreck(ctx, target.position_x, target.position_y) {
                log::info!("🚢 Animal {:?} {} attack blocked - Player {:?} is in shipwreck protection zone",
                    animal.species, animal.id, target.identity);
                return Ok(()); // No damage applied - player protected by shipwreck
            }
        }
        // <<< END SHIPWRECK PROTECTION CHECK >>>
        
        // Get species-specific damage and effects
        let raw_damage = behavior.execute_attack_effects(ctx, animal, target_player, stats, current_time, rng)?;
        
        // <<< APPLY TYPED ARMOR RESISTANCE >>>
        // Animals use Melee damage type for their attacks
        let resistance = crate::armor::calculate_resistance_for_damage_type(ctx, target.identity, crate::models::DamageType::Melee);
        let mut final_damage = raw_damage;
        
        if resistance > 0.0 {
            let damage_reduction = raw_damage * resistance;
            final_damage = (raw_damage - damage_reduction).max(0.0);
            
            log::info!(
                "Animal {:?} {} attacking Player {:?}. Raw Damage: {:.2}, Melee Resistance: {:.2} ({:.0}%), Final Damage: {:.2}",
                animal.species, animal.id, target.identity,
                raw_damage,
                resistance,
                resistance * 100.0,
                final_damage
            );
        }
        // <<< END APPLY TYPED ARMOR RESISTANCE >>>
        
        // Apply damage
        let old_health = target.health;
        target.health = (target.health - final_damage).max(0.0);
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
            // Play player death sound
            if let Err(e) = sound_events::emit_sound_at_position(ctx, SoundType::DeathPlayer, target_pos_x, target_pos_y, 1.0, target_id) {
                log::error!("Failed to emit player death sound: {}", e);
            }
        } else if actual_damage > 0.0 {
            // Player took damage but didn't die - play hurt sound
            if let Err(e) = sound_events::emit_sound_at_position(ctx, SoundType::PlayerHurt, target_pos_x, target_pos_y, 0.8, target_id) {
                log::error!("Failed to emit player hurt sound: {}", e);
            }
        }
        
        ctx.db.player().identity().update(target);
        
        // Update animal's last attack time
        animal.last_attack_time = Some(current_time);
        
        // Play melee hit sound when animal attacks player
        crate::sound_events::emit_melee_hit_sharp_sound(ctx, target_pos_x, target_pos_y, target_id);
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
            !player.is_snorkeling && // 🤿 Snorkeling players are completely hidden
            get_distance_squared(animal.pos_x, animal.pos_y, player.position_x, player.position_y) 
                <= (stats.perception_range * 1.5).powi(2)
        })
        .collect()
}

/// PERFORMANCE OPTIMIZATION: Uses pre-fetched player data instead of querying database
fn find_nearby_players_prefetched(all_players: &[Player], animal: &WildAnimal, stats: &AnimalStats) -> Vec<Player> {
    all_players
        .iter()
        .filter(|player| {
            !player.is_snorkeling && // 🤿 Snorkeling players are completely hidden
            get_distance_squared(animal.pos_x, animal.pos_y, player.position_x, player.position_y) 
                <= (stats.perception_range * 1.5).powi(2)
        })
        .cloned()
        .collect()
}

/// CHUNK-BASED OPTIMIZATION: Collect only animals in chunks near players
/// Uses chunk_index B-tree index to avoid full table scan when world has many animals
fn collect_animals_in_active_chunks(ctx: &ReducerContext, all_players: &[Player]) -> Vec<WildAnimal> {
    if all_players.is_empty() {
        return Vec::new();
    }
    // Chunks within this radius of each player are "active" (ANIMAL_ACTIVE_ZONE_RADIUS + buffer for fleeing)
    let chunks_in_radius = (ANIMAL_ACTIVE_ZONE_RADIUS / CHUNK_SIZE_PX).ceil() as i32 + 1;
    let mut active_chunks: HashSet<u32> = HashSet::new();
    for player in all_players {
        let center_chunk = calculate_chunk_index(player.position_x, player.position_y);
        let center_x = (center_chunk % WORLD_WIDTH_CHUNKS) as i32;
        let center_y = (center_chunk / WORLD_WIDTH_CHUNKS) as i32;
        for dy in -chunks_in_radius..=chunks_in_radius {
            for dx in -chunks_in_radius..=chunks_in_radius {
                let cx = (center_x + dx).clamp(0, WORLD_WIDTH_CHUNKS as i32 - 1);
                let cy = (center_y + dy).clamp(0, WORLD_HEIGHT_CHUNKS as i32 - 1);
                active_chunks.insert((cy as u32) * WORLD_WIDTH_CHUNKS + (cx as u32));
            }
        }
    }
    let mut animals: Vec<WildAnimal> = Vec::new();
    for chunk_idx in active_chunks {
        for animal in ctx.db.wild_animal().chunk_index().filter(chunk_idx) {
            animals.push(animal);
        }
    }
    animals
}

/// VIEWPORT CULLING: Check if ANY player is within the active processing zone
/// Animals outside this zone are completely frozen (no AI processing at all)
/// This is a cheap O(n) check where n = number of online players (usually 1-10)
fn is_any_player_in_active_zone(all_players: &[Player], animal: &WildAnimal) -> bool {
    for player in all_players {
        let dist_sq = get_distance_squared(
            animal.pos_x, animal.pos_y,
            player.position_x, player.position_y
        );
        if dist_sq <= ANIMAL_ACTIVE_ZONE_SQUARED {
            return true;
        }
    }
    false
}

/// WANDER ACTIVATION: Check if ANY player is close enough for animal to start wandering
/// Animals within active zone but outside this range stay in Idle state (stationary)
/// This prevents animals from wandering when they're technically "active" but not visible
fn get_closest_player_distance_squared(all_players: &[Player], animal: &WildAnimal) -> f32 {
    let mut closest_dist_sq = f32::MAX;
    for player in all_players {
        let dist_sq = get_distance_squared(
            animal.pos_x, animal.pos_y,
            player.position_x, player.position_y
        );
        if dist_sq < closest_dist_sq {
            closest_dist_sq = dist_sq;
        }
    }
    closest_dist_sq
}

/// Check if animal should be wandering (player close enough to see them)
fn should_animal_wander(all_players: &[Player], animal: &WildAnimal) -> bool {
    get_closest_player_distance_squared(all_players, animal) <= WANDER_ACTIVATION_DISTANCE_SQUARED
}

fn find_detected_player(ctx: &ReducerContext, animal: &WildAnimal, stats: &AnimalStats, nearby_players: &[Player]) -> Option<Player> {
    // Check if this is a hostile NPC that should respect shipwreck protection zones
    let is_hostile_npc = matches!(animal.species, 
        AnimalSpecies::Shorebound | AnimalSpecies::Shardkin | AnimalSpecies::DrownedWatch);
    
    // Pre-compute if NPC is near any shipwreck (within 500px) - only then check player protection
    // This optimization prevents NPCs far from shipwrecks from incorrectly skipping players
    let npc_near_shipwreck = if is_hostile_npc {
        ctx.db.monument_part().iter().any(|part| {
            if part.monument_type != MonumentType::Shipwreck {
                return false;
            }
            let dx = animal.pos_x - part.world_x;
            // Use the Y-offset for consistent zone calculation
            let protection_center_y = part.world_y - crate::shipwreck::SHIPWRECK_PROTECTION_Y_OFFSET;
            let dy = animal.pos_y - protection_center_y;
            // 500px radius - generous buffer around the 192px protection zones
            dx * dx + dy * dy < 500.0 * 500.0
        })
    } else {
        false
    };
    
    for player in nearby_players {
        // 🚢 SHIPWRECK PROTECTION: Hostile NPCs cannot detect players inside shipwreck protection zones
        // This prevents aggro sounds and chase behavior when player is safely sheltered
        // Only check if NPC is actually near a shipwreck (optimization + correctness)
        if npc_near_shipwreck && crate::shipwreck::is_position_protected_by_shipwreck(ctx, player.position_x, player.position_y) {
            log::debug!("🚢 {:?} {} cannot detect player {} - inside shipwreck protection zone",
                       animal.species, animal.id, player.identity);
            continue; // Skip this player entirely - they're protected by the shipwreck
        }
        
        // 🤿 SNORKEL STEALTH: Players using snorkel are hidden from LAND animals (invisible beneath surface)
        // 🦈 Salmon sharks detect ALL players near water (attack both surface and underwater)
        // 🎐 Jellyfish only detect snorkeling players (passive AOE hazard for underwater only)
        if animal.species == AnimalSpecies::Jellyfish && !player.is_snorkeling {
            continue; // Jellyfish only care about players underwater
        } else if animal.species != AnimalSpecies::SalmonShark && animal.species != AnimalSpecies::Jellyfish && player.is_snorkeling {
            log::debug!("🤿 {:?} {} cannot detect player {} - snorkeling underwater",
                       animal.species, animal.id, player.identity);
            continue; // Land animals cannot detect snorkeling players - they're hidden
        }

        // 🐺 WOLF FUR INTIMIDATION: Animals are intimidated by players wearing full wolf fur set
        // Intimidated animals will not detect or chase the player
        // 🦭 EXCEPTION: Walruses are never intimidated - they're too massive and defensive!
        if animal.species != AnimalSpecies::ArcticWalrus &&
           crate::armor::intimidates_animals(ctx, player.identity) {
            log::debug!("🐺 {:?} {} intimidated by player {} wearing wolf fur - skipping detection",
                       animal.species, animal.id, player.identity);
            continue; // Skip this player entirely
        }
        
        let distance_sq = get_distance_squared(
            animal.pos_x, animal.pos_y,
            player.position_x, player.position_y
        );
        
        // 🥷 STEALTH MECHANIC: Crouching reduces animal detection radius by 50%
        let mut effective_perception_range = if player.is_crouching {
            stats.perception_range * 0.5 // 50% reduction when crouching
        } else {
            stats.perception_range
        };
        
        // 🦊 FOX FUR ARMOR: Detection radius bonus makes animals less likely to detect you
        // Each piece of Fox Fur armor reduces animal detection range by the bonus percentage
        let detection_bonus = crate::armor::calculate_detection_radius_bonus(ctx, player.identity);
        if detection_bonus > 0.0 {
            // Detection bonus REDUCES the animal's perception range (makes you harder to detect)
            effective_perception_range *= 1.0 - detection_bonus;
            log::debug!("🦊 Player {} has {:.1}% detection bonus, reducing animal perception to {:.1}px",
                       player.identity, detection_bonus * 100.0, effective_perception_range);
        }
        
        // 🦴 KAYUX AMULET (FOX TOTEM): Reduces animal detection radius
        // The fox spirit helps the wearer evade animal detection
        let animal_detection_reduction = crate::armor::get_reduces_animal_detection(ctx, player.identity);
        if animal_detection_reduction > 0.0 {
            effective_perception_range *= 1.0 - animal_detection_reduction;
            log::debug!("🦴 Player {} has Kayux Amulet, {:.1}% animal detection reduction, perception now {:.1}px",
                       player.identity, animal_detection_reduction * 100.0, effective_perception_range);
        }
        
        // 🦊 FOX FUR BOOTS: Silent movement further reduces detection range
        // Players wearing fox fur boots make no sound, reducing detection by an additional 30%
        if crate::armor::has_silent_movement(ctx, player.identity) {
            effective_perception_range *= 0.7; // 30% additional reduction
            log::debug!("🦊 Player {} has silent movement (fox fur boots), further reducing perception to {:.1}px",
                       player.identity, effective_perception_range);
        }
        
        if distance_sq <= effective_perception_range * effective_perception_range {
            // Check if within perception cone (except for Cable Viper which has 360° detection)
            if animal.species == AnimalSpecies::CableViper || 
               is_within_perception_cone(animal, player, stats) {
                
                // Log stealth detection for debugging
                if player.is_crouching {
                    log::debug!("🥷 {:?} {} detected crouching player {} at {:.1}px (reduced range: {:.1}px)", 
                               animal.species, animal.id, player.identity, 
                               distance_sq.sqrt(), effective_perception_range);
                }
                
                return Some(player.clone());
            }
        } else if player.is_crouching && distance_sq <= stats.perception_range * stats.perception_range {
            // Player would have been detected if standing, but crouching saved them
            log::debug!("🥷 {:?} {} missed crouching player {} at {:.1}px (stealth successful)", 
                       animal.species, animal.id, player.identity, distance_sq.sqrt());
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

fn can_animal_traverse_water(animal: &WildAnimal) -> bool {
    matches!(
        animal.species,
        AnimalSpecies::ArcticWalrus
            | AnimalSpecies::BeachCrab
            | AnimalSpecies::SalmonShark
            | AnimalSpecies::Jellyfish
            | AnimalSpecies::Bee
    ) || animal.is_flying
}

pub fn move_towards_target(ctx: &ReducerContext, animal: &mut WildAnimal, target_x: f32, target_y: f32, speed: f32, dt: f32) {
    let dx = target_x - animal.pos_x;
    let dy = target_y - animal.pos_y;
    let distance = (dx * dx + dy * dy).sqrt();
    
    if distance > 0.0 {
        let effective_speed = if animal.species == AnimalSpecies::BeachCrab
            && (is_water_tile(ctx, animal.pos_x, animal.pos_y) || is_water_tile(ctx, target_x, target_y))
        {
            speed * 0.5
        } else {
            speed
        };
        let move_distance = effective_speed * dt;
        let normalize_factor = if distance <= move_distance {
            1.0
        } else {
            move_distance / distance
        };
        
        let mut proposed_x = animal.pos_x + dx * normalize_factor;
        let mut proposed_y = animal.pos_y + dy * normalize_factor;
        
        // HOSTILE NPC RUNESTONE DETERRENCE: Block entry into runestone light radius
        if animal.is_hostile_npc {
            let runestone_radius_sq = RUNE_STONE_DETERRENCE_RADIUS * RUNE_STONE_DETERRENCE_RADIUS;
            for rune_stone in ctx.db.rune_stone().iter() {
                let rdx = proposed_x - rune_stone.pos_x;
                let rdy = proposed_y - rune_stone.pos_y;
                let dist_sq = rdx * rdx + rdy * rdy;
                
                if dist_sq < runestone_radius_sq {
                    // Would enter runestone light radius - push back to the boundary
                    let dist = dist_sq.sqrt();
                    if dist > 0.0 {
                        let push_factor = RUNE_STONE_DETERRENCE_RADIUS / dist;
                        proposed_x = rune_stone.pos_x + rdx * push_factor;
                        proposed_y = rune_stone.pos_y + rdy * push_factor;
                    }
                }
            }
            
            // MONUMENT SAFE ZONE DETERRENCE: Block entry into all monument exclusion zones
            // This prevents hostile NPCs from entering ALK stations and fishing village
            // NOTE: Shipwrecks use per-part avoidance below, not this monument system
            if let Some((zone_x, zone_y, exclusion_radius)) = get_monument_exclusion_zone(ctx, proposed_x, proposed_y) {
                let mdx = proposed_x - zone_x;
                let mdy = proposed_y - zone_y;
                let dist = (mdx * mdx + mdy * mdy).sqrt();
                
                if dist > 0.0 {
                    // Push to just outside the exclusion zone
                    let push_factor = (exclusion_radius + 50.0) / dist; // 50px buffer
                    proposed_x = zone_x + mdx * push_factor;
                    proposed_y = zone_y + mdy * push_factor;
                }
            }
            
            // WARD DETERRENCE: Block entry into active ward zones
            // Wards create civilized safe zones where hostile NPCs cannot enter
            // This allows players to build protected bases during night
            if let Some((ward_x, ward_y, ward_radius_sq)) = 
                crate::wild_animal_npc::hostile_spawning::get_active_ward_at_position(ctx, proposed_x, proposed_y) {
                let wdx = proposed_x - ward_x;
                let wdy = proposed_y - ward_y;
                let dist = (wdx * wdx + wdy * wdy).sqrt();
                
                if dist > 0.0 {
                    // Push to just outside the ward radius with a buffer
                    let ward_radius = ward_radius_sq.sqrt();
                    let push_factor = (ward_radius + 50.0) / dist; // 50px buffer
                    proposed_x = ward_x + wdx * push_factor;
                    proposed_y = ward_y + wdy * push_factor;
                }
            }
            
            // SHIPWRECK PART AVOIDANCE: Block entry into individual shipwreck part zones (192px each)
            // This works like shelter avoidance - small zones around each part, not one big zone
            // NOTE: Protection zones are centered at visual center of sprites (using Y-offset)
            for part in ctx.db.monument_part().iter() {
                if part.monument_type != MonumentType::Shipwreck {
                    continue;
                }
                let sdx = proposed_x - part.world_x;
                // Apply Y-offset to check distance from visual center, not anchor point
                let protection_center_y = part.world_y - crate::shipwreck::SHIPWRECK_PROTECTION_Y_OFFSET;
                let sdy = proposed_y - protection_center_y;
                let dist_sq = sdx * sdx + sdy * sdy;
                
                if dist_sq < crate::shipwreck::SHIPWRECK_PROTECTION_RADIUS_SQ {
                    // Would enter shipwreck part protection zone - push back to boundary
                    let dist = dist_sq.sqrt();
                    if dist > 0.0 {
                        let push_factor = (crate::shipwreck::SHIPWRECK_PROTECTION_RADIUS + 20.0) / dist; // 20px buffer
                        proposed_x = part.world_x + sdx * push_factor;
                        proposed_y = protection_center_y + sdy * push_factor;
                    }
                }
            }
        }
        
        // Store starting position to calculate actual movement
        let start_x = animal.pos_x;
        let start_y = animal.pos_y;
        
        let is_attacking = matches!(animal.state, AnimalState::Attacking | AnimalState::Chasing | AnimalState::SwimmingChase | AnimalState::FlyingChase);
        let (mut final_x, mut final_y) = resolve_animal_collision(
            ctx,
            animal.id,
            animal.pos_x,
            animal.pos_y,
            proposed_x,
            proposed_y,
            is_attacking,
        );

        // Water-edge recovery for non-aquatic animals:
        // if movement is fully blocked by water, pick a deterministic turn-away heading
        // and set a nearby investigation target so they turn around instead of "buzzing" in place.
        let attempted_step = ((proposed_x - start_x).powi(2) + (proposed_y - start_y).powi(2)).sqrt();
        let actual_step = ((final_x - start_x).powi(2) + (final_y - start_y).powi(2)).sqrt();
        let blocked_by_water = attempted_step > 1.0
            && actual_step < 0.5
            && !can_animal_traverse_water(animal)
            && crate::fishing::is_water_tile(ctx, proposed_x, proposed_y);

        if blocked_by_water {
            let blocked_dx = proposed_x - start_x;
            let blocked_dy = proposed_y - start_y;
            let blocked_len = (blocked_dx * blocked_dx + blocked_dy * blocked_dy).sqrt().max(0.001);

            // Base "away from water" direction
            let away_x = -blocked_dx / blocked_len;
            let away_y = -blocked_dy / blocked_len;

            // Deterministic side step based on animal id to prevent herd-wide lockstep.
            let side_sign = if animal.id % 2 == 0 { 1.0 } else { -1.0 };
            let turn_angle: f32 = 0.75 * side_sign; // ~43 degrees
            let sin_t = turn_angle.sin();
            let cos_t = turn_angle.cos();
            let steer_x = away_x * cos_t - away_y * sin_t;
            let steer_y = away_x * sin_t + away_y * cos_t;

            animal.direction_x = steer_x;
            animal.direction_y = steer_y;

            let stats = animal.species.get_behavior().get_stats();
            let escape_distance = stats.patrol_radius.clamp(120.0, 320.0);
            let mut escape_x = (start_x + steer_x * escape_distance).clamp(50.0, WORLD_WIDTH_PX - 50.0);
            let mut escape_y = (start_y + steer_y * escape_distance).clamp(50.0, WORLD_HEIGHT_PX - 50.0);

            // If deterministic route still points to water, use straight-away fallback.
            if crate::fishing::is_water_tile(ctx, escape_x, escape_y) {
                escape_x = (start_x + away_x * (escape_distance * 0.7)).clamp(50.0, WORLD_WIDTH_PX - 50.0);
                escape_y = (start_y + away_y * (escape_distance * 0.7)).clamp(50.0, WORLD_HEIGHT_PX - 50.0);
            }

            animal.investigation_x = Some(escape_x);
            animal.investigation_y = Some(escape_y);
        }
        
        // CRITICAL ANTI-OVERLAP ENFORCEMENT: After all collision resolution,
        // do a final check to ensure we're not inside any player.
        // This is the absolute last line of defense against overlap bugs.
        // EXCEPTION: Bees have no collision and fly through players!
        const ABSOLUTE_MIN_PLAYER_DISTANCE: f32 = 50.0; // Never closer than 50px to any player
        
        let skip_player_collision = matches!(animal.species, AnimalSpecies::Bee);
        
        if !skip_player_collision {
            // When in combat (Chasing/Attacking/FlyingChase), use smaller push buffer
            // to keep animals within their attack range after pushback.
            // Non-combat states use larger buffer to prevent visual overlap.
            let push_buffer = if is_attacking { 3.0 } else { 15.0 };
            
            for player in ctx.db.player().iter() {
                if player.is_dead {
                    continue;
                }
                
                let pdx = final_x - player.position_x;
                let pdy = final_y - player.position_y;
                let player_dist_sq = pdx * pdx + pdy * pdy;
                let player_dist = player_dist_sq.sqrt();
                
                if player_dist < ABSOLUTE_MIN_PLAYER_DISTANCE {
                    // Too close! Push away from player
                    if player_dist > 1.0 {
                        final_x = player.position_x + (pdx / player_dist) * (ABSOLUTE_MIN_PLAYER_DISTANCE + push_buffer);
                        final_y = player.position_y + (pdy / player_dist) * (ABSOLUTE_MIN_PLAYER_DISTANCE + push_buffer);
                    } else {
                        // Almost exactly on player - push in direction we were moving
                        let push_angle = (animal.id as f32 * 2.39996) % (2.0 * std::f32::consts::PI);
                        final_x = player.position_x + push_angle.cos() * (ABSOLUTE_MIN_PLAYER_DISTANCE + push_buffer + 5.0);
                        final_y = player.position_y + push_angle.sin() * (ABSOLUTE_MIN_PLAYER_DISTANCE + push_buffer + 5.0);
                    }
                    log::debug!("[AntiOverlap] Animal {} was too close to player (combat={}), pushed to ({:.1}, {:.1})", 
                               animal.id, is_attacking, final_x, final_y);
                    break; // Only need to push away from one player
                }
            }
        }
        
        // Use centralized position update function
        update_animal_position(animal, final_x, final_y);
        
        animal.direction_x = dx / distance;
        animal.direction_y = dy / distance;
        
        // Update facing direction based on ACTUAL movement (not intended direction)
        // This prevents jittery flipping when herding/patrolling behaviors adjust target
        let actual_move_x = final_x - start_x;
        let actual_move_y = final_y - start_y;
        
        // Only change facing direction if there's significant actual movement
        // Threshold of 2.0 pixels ensures meaningful movement before flipping
        // Use the dominant axis (whichever has more movement) to determine direction
        if actual_move_x.abs() > 2.0 || actual_move_y.abs() > 2.0 {
            if actual_move_x.abs() > actual_move_y.abs() {
                // Horizontal movement is dominant
                animal.facing_direction = if actual_move_x > 0.0 { "right".to_string() } else { "left".to_string() };
            } else {
                // Vertical movement is dominant
                animal.facing_direction = if actual_move_y > 0.0 { "down".to_string() } else { "up".to_string() };
            }
        }
    }
}

/// Helper function to update animal position and ensure chunk_index stays synchronized
pub fn update_animal_position(animal: &mut WildAnimal, new_x: f32, new_y: f32) {
    animal.pos_x = new_x;
    animal.pos_y = new_y;
    animal.chunk_index = crate::environment::calculate_chunk_index(new_x, new_y);
}

fn clamp_to_world_bounds(animal: &mut WildAnimal) {
    let margin = 50.0;
    let clamped_x = animal.pos_x.clamp(margin, WORLD_WIDTH_PX - margin);
    let clamped_y = animal.pos_y.clamp(margin, WORLD_HEIGHT_PX - margin);
    
    // Use centralized position update function
    update_animal_position(animal, clamped_x, clamped_y);
}

/// Enforces minimum distance between animal and player to prevent overlap
/// This is critical for fast-moving hostile NPCs that can overshoot during chase
/// IMPORTANT: Animals must be pushed to a distance that's WITHIN their attack range!
fn enforce_minimum_player_distance(animal: &mut WildAnimal, player: &Player, stats: &AnimalStats) {
    // Bees have NO collision - they fly around and through players
    // Skip all collision enforcement for bees
    if matches!(animal.species, AnimalSpecies::Bee) {
        return;
    }
    
    let dx = animal.pos_x - player.position_x;
    let dy = animal.pos_y - player.position_y;
    let distance_sq = dx * dx + dy * dy;
    let distance = distance_sq.sqrt();
    
    // Absolute minimum distance to prevent visual overlap
    const ABSOLUTE_MIN_DISTANCE: f32 = 45.0; // Matches ANIMAL_COLLISION_RADIUS
    
    // Calculate where animal should be pushed to:
    // - Must be at least ABSOLUTE_MIN_DISTANCE away (prevents standing inside player)
    // - Must be WITHIN attack range so animal can actually attack
    // Target position: midpoint between min collision distance and attack range
    let target_distance = ((ABSOLUTE_MIN_DISTANCE + stats.attack_range) / 2.0).max(ABSOLUTE_MIN_DISTANCE);
    
    // Only push if animal is closer than the minimum collision distance
    if distance < ABSOLUTE_MIN_DISTANCE {
        // Calculate push direction
        if distance > 1.0 {
            // Normal case: push away from player to target distance
            // Ensure we don't push BEYOND attack range (cap at attack_range - 5px for safety margin)
            let max_push_target = stats.attack_range - 5.0;
            let actual_target = target_distance.min(max_push_target);
            
            let push_distance = actual_target - distance;
            let push_x = (dx / distance) * push_distance;
            let push_y = (dy / distance) * push_distance;
            
            let new_x = animal.pos_x + push_x;
            let new_y = animal.pos_y + push_y;
            update_animal_position(animal, new_x, new_y);
            
            log::debug!("[CollisionEnforce] Pushed {:?} {} back from player, distance was {:.1}px -> {:.1}px (attack_range: {:.1})", 
                       animal.species, animal.id, distance, actual_target, stats.attack_range);
        } else {
            // Edge case: animal is almost exactly on top of player (distance ~= 0)
            // Push in a random-ish direction based on animal ID to avoid stuck state
            let angle = (animal.id as f32 * 2.39996) % (2.0 * std::f32::consts::PI); // Golden angle distribution
            
            // Push to target distance, capped within attack range
            let max_push_target = stats.attack_range - 5.0;
            let push_distance = target_distance.min(max_push_target);
            let push_x = angle.cos() * push_distance;
            let push_y = angle.sin() * push_distance;
            
            let new_x = animal.pos_x + push_x;
            let new_y = animal.pos_y + push_y;
            update_animal_position(animal, new_x, new_y);
            
            log::warn!("[CollisionEnforce] Emergency push for {:?} {} - was ON TOP of player! Pushed to {:.1}px", 
                      animal.species, animal.id, push_distance);
        }
    }
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
            AnimalSpecies::ArcticWalrus => 64.0, // Strongest knockback - massive walrus attack
            AnimalSpecies::BeachCrab => 16.0, // Small knockback - crab pinch
            AnimalSpecies::Tern => 8.0, // Very small knockback - bird peck
            AnimalSpecies::Crow => 12.0, // Small knockback - crow peck
            AnimalSpecies::Vole => 4.0, // Tiny knockback - tiny rodent bite
            AnimalSpecies::Wolverine => 56.0, // Strong knockback - aggressive predator
            AnimalSpecies::Caribou => 48.0, // Strong knockback - large herbivore charge
            AnimalSpecies::SalmonShark => 40.0, // Moderate knockback - shark bite
            AnimalSpecies::Jellyfish => 16.0,  // Light knockback - electric shock pushback
            // Hostile NPCs
            AnimalSpecies::Shorebound => 36.0, // Fast stalker - moderate knockback
            AnimalSpecies::Shardkin => 20.0, // Small swarmer - light knockback
            AnimalSpecies::DrownedWatch => 72.0, // Heavy brute - strong knockback
            // Bees - tiny knockback
            AnimalSpecies::Bee => 8.0, // Tiny insect - minimal knockback
            // Alpine animals
            AnimalSpecies::PolarBear => 72.0, // Massive apex predator - strongest knockback
            AnimalSpecies::Hare => 4.0,       // Tiny prey - minimal knockback
            AnimalSpecies::SnowyOwl => 12.0,  // Medium bird - light knockback
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
    
    // Drop active weapon on death (before clearing equipment and creating corpse)
    match crate::dropped_item::drop_active_weapon_on_death(ctx, target.identity, target.position_x, target.position_y) {
        Ok(Some(item_name)) => log::info!("[PlayerDeath] Dropped active weapon '{}' for player {:?} killed by wild animal", item_name, target.identity),
        Ok(None) => log::debug!("[PlayerDeath] No active weapon to drop for player {:?}", target.identity),
        Err(e) => log::error!("[PlayerDeath] Failed to drop active weapon for player {:?}: {}", target.identity, e),
    }
    
    // Clear active equipment reference
    if let Err(e) = crate::active_equipment::clear_active_item_reducer(ctx, target.identity) {
        log::error!("Failed to clear active item for player {:?} killed by wild animal: {}", target.identity, e);
    }
    
    // Clear all active effects on death (bleed, venom, burns, healing, etc.)
    crate::active_effects::clear_all_effects_on_death(ctx, target.identity);
    log::info!("[PlayerDeath] Cleared all active effects for player {:?} killed by wild animal", target.identity);
    
    // Create death marker for wild animal kill
    let death_cause = match animal.species {
        AnimalSpecies::CinderFox => "Cinder Fox",
        AnimalSpecies::TundraWolf => "Tundra Wolf", 
        AnimalSpecies::CableViper => "Cable Viper",
        AnimalSpecies::ArcticWalrus => "Arctic Walrus",
        AnimalSpecies::BeachCrab => "Beach Crab",
        AnimalSpecies::Tern => "Tern",
        AnimalSpecies::Crow => "Crow",
        AnimalSpecies::Vole => "Vole",
        AnimalSpecies::Wolverine => "Wolverine",
        AnimalSpecies::Caribou => "Caribou",
        AnimalSpecies::SalmonShark => "Salmon Shark",
        AnimalSpecies::Jellyfish => "Jellyfish",
        // Hostile NPCs
        AnimalSpecies::Shorebound => "The Shorebound",
        AnimalSpecies::Shardkin => "The Shardkin",
        AnimalSpecies::DrownedWatch => "The Drowned Watch",
        // Bees
        AnimalSpecies::Bee => "A Bee",
        // Alpine animals
        AnimalSpecies::PolarBear => "Polar Bear",
        AnimalSpecies::Hare => "Hare",
        AnimalSpecies::SnowyOwl => "Snowy Owl",
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
    if let Err(validation_error) = validate_animal_spawn_position(ctx, pos_x, pos_y, Some(species)) {
        return Err(format!("Cannot spawn {:?}: {}", species, validation_error));
    }
    
    let behavior = species.get_behavior();
    let stats = behavior.get_stats();
    let current_time = ctx.timestamp;
    
    // Set species-appropriate initial state
    let is_bird = matches!(species, AnimalSpecies::Tern | AnimalSpecies::Crow);
    let initial_state = if is_bird {
        AnimalState::Grounded
    } else if matches!(species, AnimalSpecies::SalmonShark) {
        AnimalState::Swimming
    } else if matches!(species, AnimalSpecies::Jellyfish) {
        AnimalState::Drifting
    } else {
        AnimalState::Patrolling
    };
    
    let animal = WildAnimal {
        id: 0,
        species,
        pos_x,
        pos_y,
        direction_x: 1.0,
        direction_y: 0.0,
        facing_direction: "down".to_string(), // Default facing direction
        state: initial_state,
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
        
        // Fire fear override tracking
        fire_fear_overridden_by: None,
        
        // Taming system fields
        tamed_by: None,
        tamed_at: None,
        heart_effect_until: None,
        crying_effect_until: None,
        last_food_check: None,
        
        // Bird scavenging/stealing system fields
        held_item_name: None,
        held_item_quantity: None,
        flying_target_x: None,
        flying_target_y: None,
        is_flying: false, // Birds start grounded (not flying)
        
        // Night hostile NPC fields
        is_hostile_npc: species.is_hostile_npc(),
        target_structure_id: None,
        target_structure_type: None,
        stalk_angle: 0.0,
        stalk_distance: 0.0,
        despawn_at: None,
        shock_active_until: None,
        last_shock_time: None,
    };
    
    ctx.db.wild_animal().insert(animal);
    
    if is_bird {
        log::info!("🐦 Spawned {:?} at ({:.0}, {:.0}) - GROUNDED (is_flying=false, walking sprite)", species, pos_x, pos_y);
    } else {
        log::info!("Spawned {:?} at ({:.0}, {:.0}) with initial state {:?}", species, pos_x, pos_y, initial_state);
    }
    
    Ok(())
}

/// Debug reducer to spawn a wild animal near the player (for testing)
/// Takes a species string and spawns the animal at a random offset from the player
#[spacetimedb::reducer]
pub fn debug_spawn_animal(ctx: &ReducerContext, species_str: String) -> Result<(), String> {
    // Parse the species string
    let species = match species_str.as_str() {
        "CinderFox" => AnimalSpecies::CinderFox,
        "TundraWolf" => AnimalSpecies::TundraWolf,
        "CableViper" => AnimalSpecies::CableViper,
        "ArcticWalrus" => AnimalSpecies::ArcticWalrus,
        "BeachCrab" => AnimalSpecies::BeachCrab,
        "Tern" => AnimalSpecies::Tern,
        "Crow" => AnimalSpecies::Crow,
        "Vole" => AnimalSpecies::Vole,
        "Wolverine" => AnimalSpecies::Wolverine,
        "Caribou" => AnimalSpecies::Caribou,
        "SalmonShark" => AnimalSpecies::SalmonShark,
        "Jellyfish" => AnimalSpecies::Jellyfish,
        "Shorebound" => AnimalSpecies::Shorebound,
        "Shardkin" => AnimalSpecies::Shardkin,
        "DrownedWatch" => AnimalSpecies::DrownedWatch,
        _ => return Err(format!("Invalid species: {}. Valid options: CinderFox, TundraWolf, CableViper, ArcticWalrus, BeachCrab, Tern, Crow, Vole, Wolverine, Caribou, SalmonShark, Jellyfish, Shorebound, Shardkin, DrownedWatch", species_str)),
    };
    
    // Get the player's position
    let player = ctx.db.player().identity().find(&ctx.sender())
        .ok_or_else(|| "Player not found".to_string())?;
    
    let (spawn_x, spawn_y) = if matches!(species, AnimalSpecies::SalmonShark | AnimalSpecies::Jellyfish) {
        // Aquatic species REQUIRE Sea tiles - search for nearest water near player
        let player_tile_x = (player.position_x / TILE_SIZE_PX as f32).floor() as i32;
        let player_tile_y = (player.position_y / TILE_SIZE_PX as f32).floor() as i32;
        const SEARCH_RADIUS: i32 = 25; // tiles (~1200px) - enough to reach ocean from most inland positions
        let mut rng = ctx.rng();
        let mut candidates: Vec<(i32, i32)> = Vec::new();
        for dy in -SEARCH_RADIUS..=SEARCH_RADIUS {
            for dx in -SEARCH_RADIUS..=SEARCH_RADIUS {
                let check_x = player_tile_x + dx;
                let check_y = player_tile_y + dy;
                if check_x < 0 || check_y < 0
                    || check_x >= WORLD_WIDTH_TILES as i32
                    || check_y >= crate::WORLD_HEIGHT_TILES as i32
                {
                    continue;
                }
                if let Some(tile_type) = get_tile_type_at_position(ctx, check_x, check_y) {
                    if tile_type == TileType::Sea {
                        candidates.push((check_x, check_y));
                    }
                }
            }
        }
        if candidates.is_empty() {
            return Err(format!(
                "No Sea tiles found within {} tiles of player. Move closer to the ocean to spawn {:?}.",
                SEARCH_RADIUS, species
            ));
        }
        let (tx, ty) = candidates[rng.gen_range(0..candidates.len())];
        let px = (tx as f32 + 0.5) * TILE_SIZE_PX as f32;
        let py = (ty as f32 + 0.5) * TILE_SIZE_PX as f32;
        (px, py)
    } else {
        // Land/non-aquatic: use random offset from player
        let is_hostile = matches!(
            species,
            AnimalSpecies::TundraWolf
                | AnimalSpecies::CableViper
                | AnimalSpecies::Wolverine
                | AnimalSpecies::Shorebound
                | AnimalSpecies::Shardkin
                | AnimalSpecies::DrownedWatch
        );
        let mut rng = ctx.rng();
        let angle = rng.gen::<f32>() * std::f32::consts::PI * 2.0;
        let distance = if is_hostile {
            400.0 + rng.gen::<f32>() * 200.0 // 400-600 pixels for hostile
        } else {
            100.0 + rng.gen::<f32>() * 100.0 // 100-200 pixels for passive
        };
        (
            player.position_x + angle.cos() * distance,
            player.position_y + angle.sin() * distance,
        )
    };
    
    log::info!(
        "🐾 Debug spawning {:?} at ({:.0}, {:.0})",
        species,
        spawn_x,
        spawn_y
    );
    
    spawn_wild_animal(ctx, species, spawn_x, spawn_y)
}

/// Internal function to handle animal damage with optional weapon tracking
/// weapon_name: Optional weapon name for tracking weapon-specific kill achievements
pub fn damage_wild_animal_with_weapon(
    ctx: &ReducerContext,
    animal_id: u64,
    damage: f32,
    attacker_id: Identity,
    weapon_name: Option<&str>,
) -> Result<(), String> {
    let mut rng = ctx.rng();

    if let Some(mut animal) = ctx.db.wild_animal().id().find(&animal_id) {
        // BURROWED PROTECTION: Animals that are burrowed underground cannot be attacked
        if animal.state == AnimalState::Burrowed {
            log::debug!("Cannot attack burrowed {:?} {} - it's underground!", animal.species, animal.id);
            return Ok(()); // Silently ignore the attack - animal is safely hidden
        }
        
        // BEE IMMUNITY: Bees cannot be killed by weapons - only fire kills them!
        // They become more aggressive when attacked but take no damage
        if matches!(animal.species, AnimalSpecies::Bee) {
            log::debug!("🐝 Bee {} is immune to weapon damage! Only fire can kill bees.", animal.id);
            // Trigger the damage response (makes them aggressive) but don't apply damage
            if let Some(attacker) = ctx.db.player().identity().find(&attacker_id) {
                let behavior = animal.species.get_behavior();
                let stats = behavior.get_stats();
                behavior.handle_damage_response(ctx, &mut animal, &attacker, &stats, ctx.timestamp, &mut rng)?;
                ctx.db.wild_animal().id().update(animal);
            }
            return Ok(()); // No damage applied to bees from weapons
        }
        
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
                
                // Play animal pain/growl sound when hit
                emit_species_sound(ctx, &animal, attacker_id, "hit");
                
                // JELLYFISH REACTIVE ELECTROCUTION: Shock immediately when damaged (even if lethal)
                // Jellyfish discharge electricity when disturbed - must happen before death handling
                if matches!(animal.species, AnimalSpecies::Jellyfish) {
                    let behavior = animal.species.get_behavior();
                    let stats = behavior.get_stats();
                    behavior.handle_damage_response(ctx, &mut animal, &attacker, &stats, ctx.timestamp, &mut rng)?;
                }
            }
        }
        
        if animal.health <= 0.0 {
            // HOSTILE NPCs: Drop memory shards directly, no corpse
            // Reward scales with difficulty - MUST be worth the risk vs safe barrel farming!
            // Barrels: 1-2 shards at 92% chance (~1.38 avg), no danger, infinite respawn
            // Night combat: Risk of death and inventory loss, limited to nighttime
            //
            // Tiered rewards:
            //   Shardkin (45 HP, swarm): 8-15 shards each - dangerous in groups
            //   Shorebound (80 HP, stalker): 15-25 shards - worth the chase
            //   DrownedWatch (400 HP, brute): 50-80 shards - boss-tier jackpot
            if animal.is_hostile_npc {
                log::info!("👹 [HOSTILE DEATH] {:?} {} killed at ({:.1}, {:.1}) - dropping memory shards", 
                          animal.species, animal.id, animal.pos_x, animal.pos_y);
                
                // Tiered shard rewards based on enemy difficulty
                // Night combat should be MUCH more rewarding than safe barrel farming
                let shard_count = match animal.species {
                    AnimalSpecies::Shardkin => rng.gen_range(8..=15),      // Swarmers - dangerous in groups
                    AnimalSpecies::Shorebound => rng.gen_range(15..=25),   // Stalkers - worth the risk
                    AnimalSpecies::DrownedWatch => rng.gen_range(50..=80), // Brutes - boss-tier reward
                    _ => rng.gen_range(10..=20), // Fallback
                } as u32;
                
                // Drop memory shards at the hostile NPC's death location for player to pick up
                // This adds to the dopamine loop of seeing loot drop and collecting it
                if let Some(shard_def) = ctx.db.item_definition().iter()
                    .find(|def| def.name == "Memory Shard") 
                {
                    match crate::dropped_item::create_dropped_item_entity(
                        ctx, 
                        shard_def.id, 
                        shard_count,
                        animal.pos_x,
                        animal.pos_y,
                    ) {
                        Ok(_) => {
                            log::info!("👹 Dropped {} memory shards at ({:.1}, {:.1}) from {:?} kill", 
                                      shard_count, animal.pos_x, animal.pos_y, animal.species);
                        }
                        Err(e) => {
                            log::error!("👹 Failed to drop memory shards: {}", e);
                        }
                    }
                }
                
                // Emit death sound (visual particles handled client-side when WildAnimal is deleted)
                super::hostile_spawning::emit_hostile_death_sound(
                    ctx,
                    animal.pos_x,
                    animal.pos_y,
                    attacker_id,
                );
                
                ctx.db.wild_animal().id().delete(&animal_id);
                log::info!("👹 Hostile NPC {:?} {} removed after death", animal.species, animal_id);
                
                // Award XP for hostile NPC kill (more XP than regular animals)
                if let Err(e) = crate::player_progression::award_xp(ctx, attacker_id, crate::player_progression::XP_APPARITION_BANISHED) {
                    log::error!("Failed to award XP for apparition banishment: {}", e);
                }
                
                // Track apparitions_banished stat (separate from regular animals) and check achievements
                if let Err(e) = crate::player_progression::track_stat_and_check_achievements(ctx, attacker_id, "apparitions_banished", 1) {
                    log::error!("Failed to track apparition banishment stat: {}", e);
                }
            } else {
                // Regular animals: Create corpse as usual
                log::info!("🦴 [ANIMAL DEATH] Animal {} (species: {:?}) died at ({:.1}, {:.1}) - attempting to create corpse", 
                          animal.id, animal.species, animal.pos_x, animal.pos_y);
                
                // Emit species-specific death sound for regular animals
                emit_death_sound(ctx, &animal, attacker_id);
                
                // Create animal corpse before deleting the animal
                if let Err(e) = super::animal_corpse::create_animal_corpse(
                    ctx,
                    animal.species,
                    animal.id,
                    animal.pos_x,
                    animal.pos_y,
                    ctx.timestamp,
                    animal.created_at, // Pass spawn time to calculate time alive at harvest
                ) {
                    log::error!("🦴 [ERROR] Failed to create animal corpse for {} (species: {:?}): {}", animal.id, animal.species, e);
                } else {
                    log::info!("🦴 [SUCCESS] Animal corpse creation call completed successfully for animal {}", animal.id);
                }
                
                // NOTE: Caribou breeding data is NOT cleaned up here - it's kept until the corpse
                // is harvested so we can apply age-based drop multipliers. Cleanup happens in
                // combat.rs damage_animal_corpse when the corpse is depleted or despawns.
                
                ctx.db.wild_animal().id().delete(&animal_id);
                log::info!("Wild animal {} killed by player {} - corpse created", animal_id, attacker_id);
                
                // Award XP for regular animal kill
                if let Err(e) = crate::player_progression::award_xp(ctx, attacker_id, crate::player_progression::XP_ANIMAL_KILLED) {
                    log::error!("Failed to award XP for animal kill: {}", e);
                }
                
                // Track animals_killed stat (only for regular animals) and check achievements
                if let Err(e) = crate::player_progression::track_stat_and_check_achievements(ctx, attacker_id, "animals_killed", 1) {
                    log::error!("Failed to track animal kill stat: {}", e);
                }
                
                // Track quest progress for animal kills (only real animals, not void manifestations)
                if let Err(e) = crate::quests::track_quest_progress(
                    ctx,
                    attacker_id,
                    crate::quests::QuestObjectiveType::KillAnyAnimal,
                    None,
                    1,
                ) {
                    log::error!("Failed to track quest progress for animal kill: {}", e);
                }
                // Track specific animal type kills for quests
                let species_name = format!("{:?}", animal.species);
                if let Err(e) = crate::quests::track_quest_progress(
                    ctx,
                    attacker_id,
                    crate::quests::QuestObjectiveType::KillSpecificAnimal,
                    Some(&species_name),
                    1,
                ) {
                    log::error!("Failed to track specific animal quest progress: {}", e);
                }
            }
            
            // Track weapon-specific kill achievement if weapon name provided (counts for both animals and void manifestations)
            if let Some(wep_name) = weapon_name {
                let weapon_stat = categorize_weapon_for_achievement(wep_name);
                if !weapon_stat.is_empty() {
                    if let Err(e) = crate::player_progression::track_stat_and_check_achievements(ctx, attacker_id, weapon_stat, 1) {
                        log::error!("Failed to track weapon kill stat '{}': {}", weapon_stat, e);
                    }
                    // Spears also count as melee kills
                    if weapon_stat == "spear_kills" {
                        if let Err(e) = crate::player_progression::track_stat_and_check_achievements(ctx, attacker_id, "melee_kills", 1) {
                            log::error!("Failed to track melee kill stat for spear: {}", e);
                        }
                    }
                }
            }
        } else {
            // 🔥 FIRE FEAR OVERRIDE: If animal was afraid of fire but got attacked, they now ignore fire and retaliate
            if let Some(attacker) = ctx.db.player().identity().find(&attacker_id) {
                let was_fire_afraid = should_fear_fire(ctx, &animal);
                
                // Check if animal was previously fleeing from fire or in a fire-influenced state
                let was_fleeing_from_fire = animal.state == AnimalState::Fleeing && was_fire_afraid;
                let was_avoiding_fire_targets = was_fire_afraid && 
                    (animal.state == AnimalState::Patrolling || animal.state == AnimalState::Alert);
                
                if (was_fleeing_from_fire || was_avoiding_fire_targets) && animal.species != AnimalSpecies::ArcticWalrus {
                    // Set fire fear override for this specific attacker
                    animal.fire_fear_overridden_by = Some(attacker.identity);
                    
                    // Override fire fear - animal now prioritizes attacking over fire avoidance
                    transition_to_state(&mut animal, AnimalState::Chasing, ctx.timestamp, Some(attacker.identity), "fire fear overridden by attack");
                    
                    // Clear flee destination if they were fleeing
                    animal.investigation_x = None;
                    animal.investigation_y = None;
                    
                    // Emit aggressive sound to indicate they're now hostile
                    emit_species_sound(ctx, &animal, attacker.identity, "fire_fear_override");
                    
                    log::info!("🔥➡️⚔️ {:?} {} was afraid of fire but got attacked - now ignoring fire from attacker {} specifically", 
                              animal.species, animal.id, attacker.identity);
                }
                
                // Continue with species-specific damage response (jellyfish already shocked above)
                if animal.species != AnimalSpecies::Jellyfish {
                    let behavior = animal.species.get_behavior();
                    let stats = behavior.get_stats();
                    behavior.handle_damage_response(ctx, &mut animal, &attacker, &stats, ctx.timestamp, &mut rng)?;
                }
            }
            
            ctx.db.wild_animal().id().update(animal);
        }
    }
    
    Ok(())
}

/// Try to fire a ranged counter-attack from an NPC when hit by a player's ranged weapon.
/// This is called from projectile.rs when a player projectile hits certain NPCs.
/// Returns true if a counter-attack projectile was fired.
/// 
/// NPCs with ranged counter-attacks:
/// - Shardkin: Fires spectral shards (fast, low damage)
/// - Shorebound: Fires spectral bolts (medium speed, medium damage)
/// - CableViper: Spits venom (slow, applies venom effect)
/// - DrownedWatch: NO ranged attacks (melee brute only)
pub fn try_npc_ranged_counter_attack(
    ctx: &ReducerContext,
    animal_id: u64,
    attacker_player_x: f32,
    attacker_player_y: f32,
) -> Result<bool, String> {
    use crate::projectile::{
        fire_npc_projectile,
        NPC_PROJECTILE_SPECTRAL_SHARD, NPC_PROJECTILE_SPECTRAL_BOLT, NPC_PROJECTILE_VENOM_SPITTLE,
        SHARDKIN_PROJECTILE_DAMAGE, SHARDKIN_PROJECTILE_SPEED,
        SHOREBOUND_PROJECTILE_DAMAGE, SHOREBOUND_PROJECTILE_SPEED,
        VIPER_PROJECTILE_DAMAGE, VIPER_PROJECTILE_SPEED,
    };
    
    // Find the animal
    let animal = match ctx.db.wild_animal().id().find(&animal_id) {
        Some(a) => a,
        None => return Ok(false), // Animal doesn't exist (might be dead)
    };
    
    // Skip if animal is dead or burrowed
    if animal.health <= 0.0 || animal.state == AnimalState::Burrowed {
        log::debug!("🎯 [COUNTER BLOCK] {:?} {} - dead or burrowed", animal.species, animal.id);
        return Ok(false);
    }
    
    // NOTE: We intentionally DO NOT check last_attack_time here!
    // The melee attack system also uses last_attack_time, so counter-attacks
    // would be blocked by melee attack cooldowns if we checked it.
    // Counter-attacks fire immediately when hit by projectiles as a reaction.
    
    // Determine if this species has ranged counter-attacks - use 900px range for all
    let (projectile_type, damage, speed, max_range) = match animal.species {
        AnimalSpecies::Shardkin => (
            NPC_PROJECTILE_SPECTRAL_SHARD,
            SHARDKIN_PROJECTILE_DAMAGE,
            SHARDKIN_PROJECTILE_SPEED,
            900.0, // Large range - can't be griefed from distance
        ),
        AnimalSpecies::Shorebound => (
            NPC_PROJECTILE_SPECTRAL_BOLT,
            SHOREBOUND_PROJECTILE_DAMAGE,
            SHOREBOUND_PROJECTILE_SPEED,
            900.0, // Large range - can't be griefed from distance
        ),
        AnimalSpecies::CableViper => (
            NPC_PROJECTILE_VENOM_SPITTLE,
            VIPER_PROJECTILE_DAMAGE,
            VIPER_PROJECTILE_SPEED,
            900.0, // Large range - can't be griefed from distance
        ),
        // DrownedWatch does NOT have ranged attacks
        // Other species don't counter-attack with ranged
        _ => return Ok(false),
    };
    
    // Calculate distance to target
    let dx = attacker_player_x - animal.pos_x;
    let dy = attacker_player_y - animal.pos_y;
    let distance = (dx * dx + dy * dy).sqrt();
    
    // Only fire if target is within range - NO min distance, they can shoot point blank
    if distance > max_range {
        return Ok(false); // Too far
    }
    
    // Fire the projectile
    match fire_npc_projectile(
        ctx,
        animal.id,
        animal.pos_x,
        animal.pos_y,
        attacker_player_x,
        attacker_player_y,
        projectile_type,
        damage,
        speed,
        max_range,
    ) {
        Ok(projectile_id) => {
            log::info!(
                "🎯 [NPC COUNTER] {:?} {} fired ranged counter-attack (projectile {}) at player position ({:.1}, {:.1})",
                animal.species, animal.id, projectile_id, attacker_player_x, attacker_player_y
            );
            
            // Update the animal's last_attack_time to track cooldown
            if let Some(mut updated_animal) = ctx.db.wild_animal().id().find(&animal_id) {
                updated_animal.last_attack_time = Some(ctx.timestamp);
                ctx.db.wild_animal().id().update(updated_animal);
            }
            
            Ok(true)
        }
        Err(e) => {
            log::error!("Failed to fire NPC counter-attack projectile: {}", e);
            Ok(false)
        }
    }
}

// ============================================================================
// PROACTIVE NPC RANGED ATTACKS
// ============================================================================
// Unlike counter-attacks (which fire when NPCs get hit by player projectiles),
// proactive ranged attacks are fired by NPCs during normal chase/combat when
// they are within their ranged attack range of a player.

/// Configuration for NPC proactive ranged attacks
#[derive(Debug, Clone)]
pub struct NpcRangedAttackConfig {
    pub projectile_type: u8,
    pub damage: f32,
    pub speed: f32,
    pub range: f32,       // Maximum range for ranged attack
    pub min_range: f32,   // Minimum range (don't shoot if too close - use melee)
    pub cooldown_ms: i64, // Cooldown between ranged attacks
}

/// Get ranged attack configuration for a species, if it has ranged attacks
pub fn get_npc_ranged_attack_config(species: AnimalSpecies) -> Option<NpcRangedAttackConfig> {
    use crate::projectile::{
        NPC_PROJECTILE_SPECTRAL_SHARD, NPC_PROJECTILE_SPECTRAL_BOLT, NPC_PROJECTILE_VENOM_SPITTLE,
        SHARDKIN_PROJECTILE_DAMAGE, SHARDKIN_PROJECTILE_SPEED,
        SHOREBOUND_PROJECTILE_DAMAGE, SHOREBOUND_PROJECTILE_SPEED,
        VIPER_PROJECTILE_DAMAGE, VIPER_PROJECTILE_SPEED,
    };
    
    match species {
        // Shardkin: Fast shard projectiles - ALWAYS uses ranged, 900px range
        AnimalSpecies::Shardkin => Some(NpcRangedAttackConfig {
            projectile_type: NPC_PROJECTILE_SPECTRAL_SHARD,
            damage: SHARDKIN_PROJECTILE_DAMAGE,
            speed: SHARDKIN_PROJECTILE_SPEED,
            range: 900.0,        // Large range - can't be griefed from distance
            min_range: 0.0,      // NO min range - always use ranged, even point blank
            cooldown_ms: 1000,   // 1 second between shots
        }),
        
        // Shorebound: Medium-speed ghostly bolts - ALWAYS uses ranged, 900px range
        AnimalSpecies::Shorebound => Some(NpcRangedAttackConfig {
            projectile_type: NPC_PROJECTILE_SPECTRAL_BOLT,
            damage: SHOREBOUND_PROJECTILE_DAMAGE,
            speed: SHOREBOUND_PROJECTILE_SPEED,
            range: 900.0,        // Large range - can't be griefed from distance
            min_range: 0.0,      // NO min range - always use ranged, even point blank
            cooldown_ms: 1200,   // 1.2 seconds between shots
        }),
        
        // CableViper: Venom spittle - ALWAYS uses ranged, 900px range
        AnimalSpecies::CableViper => Some(NpcRangedAttackConfig {
            projectile_type: NPC_PROJECTILE_VENOM_SPITTLE,
            damage: VIPER_PROJECTILE_DAMAGE,
            speed: VIPER_PROJECTILE_SPEED,
            range: 900.0,        // Large range - can't be griefed from distance
            min_range: 0.0,      // NO min range - always use ranged, even point blank
            cooldown_ms: 1500,   // 1.5 seconds (venom is powerful)
        }),
        
        // DrownedWatch: NO ranged attacks - melee brute only
        // Other species: No ranged attacks
        _ => None,
    }
}

/// Try to fire a proactive ranged attack from an NPC at their target player.
/// This is called during the chase state when the NPC is within ranged attack range.
/// Returns Ok(true) if a projectile was fired, Ok(false) if not (cooldown, out of range, etc.)
pub fn try_npc_proactive_ranged_attack(
    ctx: &ReducerContext,
    animal: &mut WildAnimal,
    target_player: &Player,
    current_time: Timestamp,
) -> Result<bool, String> {
    use crate::projectile::fire_npc_projectile;
    
    // Get ranged attack config for this species
    let config = match get_npc_ranged_attack_config(animal.species) {
        Some(c) => c,
        None => return Ok(false), // This species doesn't have ranged attacks
    };
    
    // Skip if animal is dead or burrowed
    if animal.health <= 0.0 || animal.state == AnimalState::Burrowed {
        log::debug!("🎯 [RANGED BLOCK] {:?} {} - dead or burrowed", animal.species, animal.id);
        return Ok(false);
    }
    
    // Skip if player is dead
    if target_player.is_dead {
        log::debug!("🎯 [RANGED BLOCK] {:?} {} - player is dead", animal.species, animal.id);
        return Ok(false);
    }
    
    // Check if player is inside a building - don't fire ranged into buildings
    if target_player.is_inside_building {
        log::debug!("🎯 [RANGED BLOCK] {:?} {} - player is inside building", animal.species, animal.id);
        return Ok(false);
    }
    
    // Calculate distance to target
    let dx = target_player.position_x - animal.pos_x;
    let dy = target_player.position_y - animal.pos_y;
    let distance = (dx * dx + dy * dy).sqrt();
    
    // Check if target is within ranged attack range (but not too close for melee)
    if distance > config.range || distance < config.min_range {
        log::debug!("🎯 [RANGED BLOCK] {:?} {} - out of range (dist={:.1}, range={:.1}-{:.1})", 
                   animal.species, animal.id, distance, config.min_range, config.range);
        return Ok(false); // Out of range or too close (use melee instead)
    }
    
    // Check line of sight - don't shoot through walls
    if !crate::animal_collision::has_clear_line_of_sight(
        ctx, animal.pos_x, animal.pos_y, target_player.position_x, target_player.position_y
    ) {
        log::debug!("🎯 [RANGED BLOCK] {:?} {} - no line of sight", animal.species, animal.id);
        return Ok(false); // No clear shot
    }
    
    // COOLDOWN CHECK: These NPCs ONLY use ranged attacks (no melee), so we can use last_attack_time
    // for ranged cooldown without conflict
    if let Some(last_attack) = animal.last_attack_time {
        let time_since_last_ms = (current_time.to_micros_since_unix_epoch() - last_attack.to_micros_since_unix_epoch()) / 1000;
        if time_since_last_ms < config.cooldown_ms {
            log::debug!("🎯 [RANGED BLOCK] {:?} {} - on cooldown ({}/{}ms)", 
                       animal.species, animal.id, time_since_last_ms, config.cooldown_ms);
            return Ok(false); // Still on cooldown
        }
    }
    
    // Fire the projectile!
    match fire_npc_projectile(
        ctx,
        animal.id,
        animal.pos_x,
        animal.pos_y,
        target_player.position_x,
        target_player.position_y,
        config.projectile_type,
        config.damage,
        config.speed,
        config.range,
    ) {
        Ok(projectile_id) => {
            log::info!(
                "🎯 [NPC RANGED] {:?} {} fired ranged attack (projectile {}) at player {} at distance {:.1}px",
                animal.species, animal.id, projectile_id, target_player.identity, distance
            );
            
            // Update the animal's last_attack_time to track cooldown
            animal.last_attack_time = Some(current_time);
            
            Ok(true)
        }
        Err(e) => {
            log::error!("Failed to fire NPC proactive ranged attack: {}", e);
            Ok(false)
        }
    }
}

/// Categorize weapon name into achievement stat category
fn categorize_weapon_for_achievement(weapon_name: &str) -> &'static str {
    let name_lower = weapon_name.to_lowercase();
    
    // Ranged - Bow
    if name_lower.contains("bow") && !name_lower.contains("crossbow") {
        return "bow_kills";
    }
    
    // Ranged - Crossbow
    if name_lower.contains("crossbow") {
        return "crossbow_kills";
    }
    
    // Ranged - Harpoon Gun (must check before generic "gun" check)
    if name_lower.contains("harpoon gun") {
        return "harpoon_gun_kills";
    }
    
    // Ranged - Firearms (Makarov, PP-91 KEDR, etc.)
    if name_lower.contains("makarov") || name_lower.contains("kedr") || name_lower.contains("smg")
       || name_lower.contains("pistol") || name_lower.contains("gun") 
       || name_lower.contains("rifle") || name_lower.contains("firearm") {
        return "gun_kills";
    }
    
    // Melee - Reed Harpoon (melee weapon, not the gun)
    // Note: "Reed Harpoon" without "Gun" is a melee weapon
    if name_lower == "reed harpoon" {
        return "spear_kills"; // Melee harpoon counts as spear
    }
    
    // Melee - Spears (specific category within melee)
    if name_lower.contains("spear") {
        // Track both spear_kills AND melee_kills for spears
        // We'll handle the dual-tracking in the caller
        return "spear_kills";
    }
    
    // Melee - All other melee weapons
    // Maces, hammers, daggers, axes, swords, cutlass, bayonet, crowbar, maul, scythe, paddle, skulls
    if name_lower.contains("mace") || name_lower.contains("hammer") || name_lower.contains("dagger") 
       || name_lower.contains("axe") || name_lower.contains("sword") || name_lower.contains("cutlass")
       || name_lower.contains("bayonet") || name_lower.contains("crowbar") || name_lower.contains("maul")
       || name_lower.contains("scythe") || name_lower.contains("paddle") || name_lower.contains("skull")
       || name_lower.contains("shiv") {
        return "melee_kills";
    }
    
    // Default - if weapon not recognized, don't track
    ""
}

/// Original reducer wrapper for backward compatibility
/// Delegates to damage_wild_animal_with_weapon with no weapon tracking
#[spacetimedb::reducer]
pub fn damage_wild_animal(
    ctx: &ReducerContext,
    animal_id: u64,
    damage: f32,
    attacker_id: Identity,
) -> Result<(), String> {
    damage_wild_animal_with_weapon(ctx, animal_id, damage, attacker_id, None)
}

/// NEW: Handle wild animal vs wild animal combat
/// This function allows wild animals (especially tamed ones) to damage other wild animals
pub fn damage_wild_animal_by_animal(
    ctx: &ReducerContext,
    target_animal_id: u64,
    damage: f32,
    attacker_animal_id: u64,
    timestamp: Timestamp,
) -> Result<bool, String> {
    // Verify both animals exist
    let attacker_animal = ctx.db.wild_animal().id().find(&attacker_animal_id)
        .ok_or_else(|| format!("Attacker animal {} not found", attacker_animal_id))?;
    
    let mut target_animal = ctx.db.wild_animal().id().find(&target_animal_id)
        .ok_or_else(|| format!("Target animal {} not found", target_animal_id))?;
    
    // BURROWED PROTECTION: Animals that are burrowed underground cannot be attacked
    if target_animal.state == AnimalState::Burrowed {
        log::debug!("Cannot attack burrowed {:?} {} - it's underground!", target_animal.species, target_animal.id);
        return Ok(false); // Attack missed - animal is safely hidden
    }
    
    let old_health = target_animal.health;
    target_animal.health = (target_animal.health - damage).max(0.0);
    target_animal.last_hit_time = Some(timestamp);
    let actual_damage = old_health - target_animal.health;
    
    // Log the attack
    log::info!("🦁 [ANIMAL COMBAT] {:?} {} attacked {:?} {} for {:.1} damage. Health: {:.1} -> {:.1}",
              attacker_animal.species, attacker_animal_id,
              target_animal.species, target_animal_id,
              actual_damage, old_health, target_animal.health);
    
    if actual_damage > 0.0 {
        // Apply knockback effects between animals
        apply_animal_knockback_effects(ctx, &target_animal, &attacker_animal)?;
        
        // Play attack sound
        emit_species_sound(ctx, &attacker_animal, attacker_animal.tamed_by.unwrap_or(ctx.identity()), "attack");
        
        // Play hit sound for target
        emit_species_sound(ctx, &target_animal, attacker_animal.tamed_by.unwrap_or(ctx.identity()), "hit");
    }
    
    let animal_died = target_animal.health <= 0.0;
    
    if animal_died {
        log::info!("🦴 [ANIMAL COMBAT DEATH] Animal {} (species: {:?}) killed by animal {} at ({:.1}, {:.1})", 
                  target_animal.id, target_animal.species, attacker_animal_id, target_animal.pos_x, target_animal.pos_y);
        
        // Create animal corpse before deleting the animal
        if let Err(e) = super::animal_corpse::create_animal_corpse(
            ctx,
            target_animal.species,
            target_animal.id,
            target_animal.pos_x,
            target_animal.pos_y,
            timestamp,
            target_animal.created_at, // Pass spawn time to calculate time alive at harvest
        ) {
            log::error!("🦴 [ERROR] Failed to create animal corpse for {} (species: {:?}): {}", target_animal.id, target_animal.species, e);
        } else {
            log::info!("🦴 [SUCCESS] Animal corpse created for animal {} killed by animal {}", target_animal.id, attacker_animal_id);
        }
        
        ctx.db.wild_animal().id().delete(&target_animal_id);
    } else {
        // If target survives, handle damage response
        let target_behavior = target_animal.species.get_behavior();
        let target_stats = target_behavior.get_stats();
        
        // Make the target animal retaliate or flee based on its behavior
        // If the attacker is tamed, consider it as coming from the owner for AI purposes
        let effective_attacker_id = attacker_animal.tamed_by.unwrap_or(ctx.identity());
        
        if let Some(effective_attacker_player) = ctx.db.player().identity().find(&effective_attacker_id) {
            let mut rng = ctx.rng();
            target_behavior.handle_damage_response(ctx, &mut target_animal, &effective_attacker_player, &target_stats, timestamp, &mut rng)?;
        }
        
        ctx.db.wild_animal().id().update(target_animal);
    }
    
    Ok(animal_died)
}

/// Apply knockback effects between two animals
fn apply_animal_knockback_effects(
    ctx: &ReducerContext,
    target_animal: &WildAnimal,
    attacker_animal: &WildAnimal,
) -> Result<(), String> {
    // Calculate direction from attacker to target
    let dx_target_from_attacker = target_animal.pos_x - attacker_animal.pos_x;
    let dy_target_from_attacker = target_animal.pos_y - attacker_animal.pos_y;
    let distance_sq = dx_target_from_attacker * dx_target_from_attacker + dy_target_from_attacker * dy_target_from_attacker;
    
    if distance_sq > 0.001 {
        let distance = distance_sq.sqrt();
        
        // Apply smaller knockback for animal vs animal combat
        const ANIMAL_KNOCKBACK_DISTANCE: f32 = 12.0; // Smaller than player knockback
        
        let knockback_dx = (dx_target_from_attacker / distance) * ANIMAL_KNOCKBACK_DISTANCE;
        let knockback_dy = (dy_target_from_attacker / distance) * ANIMAL_KNOCKBACK_DISTANCE;
        
        // Update target animal position (with basic bounds checking)
        let mut updated_target = target_animal.clone();
        let new_x = (updated_target.pos_x + knockback_dx).clamp(32.0, WORLD_WIDTH_PX - 32.0);
        let new_y = (updated_target.pos_y + knockback_dy).clamp(32.0, WORLD_HEIGHT_PX - 32.0);
        
        // Use centralized position update function
        update_animal_position(&mut updated_target, new_x, new_y);
        
        ctx.db.wild_animal().id().update(updated_target);
        
        log::debug!("Applied animal knockback: {} -> {} distance={:.1}px", 
                   attacker_animal.id, target_animal.id, ANIMAL_KNOCKBACK_DISTANCE);
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
                
                // --- KNOCKBACK THE ANIMAL AWAY FROM PLAYER ---
                // Knockback distance varies by species mass/size:
                // Lighter animals get knocked back more, massive ones are immune
                let animal_knockback_distance = match animal.species {
                    // Tiny - sent flying
                    AnimalSpecies::Vole => 28.0,
                    AnimalSpecies::Hare => 28.0,
                    AnimalSpecies::Bee => 20.0,
                    // Small - solid knockback
                    AnimalSpecies::CinderFox => 22.0,
                    AnimalSpecies::BeachCrab => 18.0,
                    AnimalSpecies::Tern => 20.0,
                    AnimalSpecies::Crow => 20.0,
                    AnimalSpecies::SnowyOwl => 20.0,
                    AnimalSpecies::CableViper => 18.0,
                    AnimalSpecies::Shardkin => 22.0,
                    AnimalSpecies::Jellyfish => 16.0,
                    // Medium - moderate knockback
                    AnimalSpecies::TundraWolf => 16.0,
                    AnimalSpecies::Wolverine => 14.0,
                    AnimalSpecies::Shorebound => 16.0,
                    AnimalSpecies::Caribou => 12.0,
                    // MASSIVE - immune to knockback (too heavy to push)
                    AnimalSpecies::ArcticWalrus => 0.0,
                    AnimalSpecies::PolarBear => 0.0,
                    AnimalSpecies::DrownedWatch => 0.0,
                    AnimalSpecies::SalmonShark => 0.0,
                };
                
                // Push animal away from player (skip if immune to knockback)
                if animal_knockback_distance > 0.0 {
                    if let Some(mut updated_animal) = ctx.db.wild_animal().id().find(&animal.id) {
                        let kb_dx = (dx_animal_from_attacker / distance) * animal_knockback_distance;
                        let kb_dy = (dy_animal_from_attacker / distance) * animal_knockback_distance;
                        
                        let new_x = (updated_animal.pos_x + kb_dx).clamp(32.0, WORLD_WIDTH_PX - 32.0);
                        let new_y = (updated_animal.pos_y + kb_dy).clamp(32.0, WORLD_HEIGHT_PX - 32.0);
                        
                        update_animal_position(&mut updated_animal, new_x, new_y);
                        ctx.db.wild_animal().id().update(updated_animal);
                        
                        log::debug!("Applied knockback to animal {} ({:?}) from player {}: distance={:.1}px", 
                                   animal.id, animal.species, attacker_id, animal_knockback_distance);
                    }
                }
                
                // --- SMALL PLAYER RECOIL FOR MELEE HITS ---
                // Skip recoil when snorkeling - 8px push can move player from water to land, forcing unwanted surface emergence
                if distance <= 100.0 && !attacker.is_snorkeling {
                    let attacker_recoil_distance = 8.0; // Small recoil - focus is on pushing the animal
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

/// Check if a position is inside any monument exclusion zone
/// Returns Some((center_x, center_y, exclusion_radius)) if inside a zone, None otherwise
/// Hostile NPCs use this to actively avoid entering protected areas like:
/// - ALK stations (central compound and substations)
/// - Fishing village
/// NOTE: Shipwrecks are NOT included here - they use per-part avoidance like shelters
pub fn get_monument_exclusion_zone(ctx: &ReducerContext, x: f32, y: f32) -> Option<(f32, f32, f32)> {
    // Check ALK stations
    for station in ctx.db.alk_station().iter() {
        let dx = x - station.world_pos_x;
        let dy = y - station.world_pos_y;
        let dist_sq = dx * dx + dy * dy;
        
        // Calculate exclusion radius based on station type
        let exclusion_radius = if station.station_id == 0 {
            station.interaction_radius * ALK_CENTRAL_EXCLUSION_MULTIPLIER // Central compound ~2188px
        } else {
            station.interaction_radius * ALK_SUBSTATION_EXCLUSION_MULTIPLIER // Substations ~600px
        };
        let exclusion_radius_sq = exclusion_radius * exclusion_radius;
        
        if dist_sq < exclusion_radius_sq {
            return Some((station.world_pos_x, station.world_pos_y, exclusion_radius));
        }
    }
    
    // Check Fishing Village (use center as exclusion zone center)
    for part in ctx.db.monument_part().iter() {
        if part.monument_type == MonumentType::FishingVillage && part.is_center {
            let dx = x - part.world_x;
            let dy = y - part.world_y;
            let dist_sq = dx * dx + dy * dy;
            
            if dist_sq < FISHING_VILLAGE_EXCLUSION_RADIUS_SQ {
                return Some((part.world_x, part.world_y, FISHING_VILLAGE_EXCLUSION_RADIUS));
            }
        }
    }
    
    // Check Weather Station (use center part - 2000px exclusion)
    const WEATHER_STATION_EXCLUSION_RADIUS: f32 = 2000.0;
    const WEATHER_STATION_EXCLUSION_RADIUS_SQ: f32 = WEATHER_STATION_EXCLUSION_RADIUS * WEATHER_STATION_EXCLUSION_RADIUS;
    for part in ctx.db.monument_part().iter() {
        if part.monument_type == MonumentType::WeatherStation && part.is_center {
            let dx = x - part.world_x;
            let dy = y - part.world_y;
            let dist_sq = dx * dx + dy * dy;
            
            if dist_sq < WEATHER_STATION_EXCLUSION_RADIUS_SQ {
                return Some((part.world_x, part.world_y, WEATHER_STATION_EXCLUSION_RADIUS));
            }
        }
    }
    
    // NOTE: Shipwrecks intentionally NOT included here
    // Shipwrecks use per-part protection zones (192px per part) like shelters
    // See is_position_in_shipwreck_part_zone() for shipwreck avoidance
    
    None
}

/// Check if a position is inside any shipwreck part's protection zone (192px per part)
/// This is similar to shelter avoidance - small zones around each individual part
/// Hostile NPCs avoid these small zones, not a single large monument zone
/// NOTE: Returns visual center position (with Y-offset applied), not anchor position
pub fn is_position_in_shipwreck_part_zone(ctx: &ReducerContext, x: f32, y: f32) -> Option<(f32, f32)> {
    crate::shipwreck::is_position_protected_by_shipwreck(ctx, x, y)
        .then(|| {
            // Find the closest part to return its position (visual center)
            for part in ctx.db.monument_part().iter() {
                if part.monument_type != MonumentType::Shipwreck {
                    continue;
                }
                let dx = x - part.world_x;
                // Apply Y-offset to check distance from visual center, not anchor point
                let protection_center_y = part.world_y - crate::shipwreck::SHIPWRECK_PROTECTION_Y_OFFSET;
                let dy = y - protection_center_y;
                let dist_sq = dx * dx + dy * dy;
                
                if dist_sq < crate::shipwreck::SHIPWRECK_PROTECTION_RADIUS_SQ {
                    return Some((part.world_x, protection_center_y));
                }
            }
            None
        })
        .flatten()
}

/// Push a position out of a monument exclusion zone
/// Returns the new position if pushed, or original position if not in a zone
pub fn push_out_of_monument_zone(ctx: &ReducerContext, x: f32, y: f32) -> (f32, f32) {
    if let Some((zone_center_x, zone_center_y, exclusion_radius)) = get_monument_exclusion_zone(ctx, x, y) {
        let dx = x - zone_center_x;
        let dy = y - zone_center_y;
        let dist = (dx * dx + dy * dy).sqrt();
        
        if dist > 1.0 {
            // Push outward to just outside the exclusion zone
            let push_dist = exclusion_radius - dist + 50.0; // 50px buffer outside
            let new_x = x + (dx / dist) * push_dist;
            let new_y = y + (dy / dist) * push_dist;
            return (new_x, new_y);
        } else {
            // At center - push in arbitrary direction
            return (zone_center_x + exclusion_radius + 50.0, y);
        }
    }
    
    (x, y)
}

// Fire fear helper functions

/// Check if there's a foundation within fear radius (separate from fire check for walruses)
fn is_foundation_nearby(ctx: &ReducerContext, animal_x: f32, animal_y: f32) -> bool {
    use crate::building::FOUNDATION_TILE_SIZE_PX;
    for foundation in ctx.db.foundation_cell().iter() {
        if foundation.is_destroyed {
            continue;
        }
        
        // Convert foundation cell coordinates to world pixel coordinates (center of foundation cell)
        let foundation_world_x = (foundation.cell_x as f32 * FOUNDATION_TILE_SIZE_PX as f32) + (FOUNDATION_TILE_SIZE_PX as f32 / 2.0);
        let foundation_world_y = (foundation.cell_y as f32 * FOUNDATION_TILE_SIZE_PX as f32) + (FOUNDATION_TILE_SIZE_PX as f32 / 2.0);
        
        let dx = animal_x - foundation_world_x;
        let dy = animal_y - foundation_world_y;
        let distance_sq = dx * dx + dy * dy;
        
        if distance_sq <= FOUNDATION_FEAR_RADIUS_SQUARED {
            return true;
        }
    }
    
    false
}

/// Find the closest foundation position (for walrus flee behavior)
fn find_closest_foundation_position(ctx: &ReducerContext, animal_x: f32, animal_y: f32) -> Option<(f32, f32)> {
    use crate::building::FOUNDATION_TILE_SIZE_PX;
    let mut closest_foundation_pos: Option<(f32, f32)> = None;
    let mut closest_distance_sq = f32::MAX;
    
    for foundation in ctx.db.foundation_cell().iter() {
        if foundation.is_destroyed {
            continue;
        }
        
        // Convert foundation cell coordinates to world pixel coordinates (center of foundation cell)
        let foundation_world_x = (foundation.cell_x as f32 * FOUNDATION_TILE_SIZE_PX as f32) + (FOUNDATION_TILE_SIZE_PX as f32 / 2.0);
        let foundation_world_y = (foundation.cell_y as f32 * FOUNDATION_TILE_SIZE_PX as f32) + (FOUNDATION_TILE_SIZE_PX as f32 / 2.0);
        
        let dx = animal_x - foundation_world_x;
        let dy = animal_y - foundation_world_y;
        let distance_sq = dx * dx + dy * dy;
        
        if distance_sq < closest_distance_sq && distance_sq <= FOUNDATION_FEAR_RADIUS_SQUARED {
            closest_distance_sq = distance_sq;
            closest_foundation_pos = Some((foundation_world_x, foundation_world_y));
        }
    }
    
    closest_foundation_pos
}

/// Prefetched variant to avoid repeated foundation table scans during hot AI ticks.
fn is_foundation_nearby_prefetched(animal_x: f32, animal_y: f32, foundation_positions: &[(f32, f32)]) -> bool {
    for (fx, fy) in foundation_positions {
        let dx = animal_x - *fx;
        let dy = animal_y - *fy;
        if dx * dx + dy * dy <= FOUNDATION_FEAR_RADIUS_SQUARED {
            return true;
        }
    }
    false
}

/// Prefetched variant to avoid repeated foundation table scans during hot AI ticks.
fn find_closest_foundation_position_prefetched(animal_x: f32, animal_y: f32, foundation_positions: &[(f32, f32)]) -> Option<(f32, f32)> {
    let mut closest_foundation_pos: Option<(f32, f32)> = None;
    let mut closest_distance_sq = f32::MAX;
    for (fx, fy) in foundation_positions {
        let dx = animal_x - *fx;
        let dy = animal_y - *fy;
        let distance_sq = dx * dx + dy * dy;
        if distance_sq < closest_distance_sq && distance_sq <= FOUNDATION_FEAR_RADIUS_SQUARED {
            closest_distance_sq = distance_sq;
            closest_foundation_pos = Some((*fx, *fy));
        }
    }
    closest_foundation_pos
}

/// Prefetched fire/foundation proximity check used in hot AI paths.
fn is_fire_nearby_prefetched(
    animal_x: f32,
    animal_y: f32,
    burning_campfires: &[Campfire],
    lit_torch_players: &[Player],
    foundation_positions: &[(f32, f32)],
) -> bool {
    for campfire in burning_campfires {
        let dx = animal_x - campfire.pos_x;
        let dy = animal_y - campfire.pos_y;
        if dx * dx + dy * dy <= FIRE_FEAR_RADIUS_SQUARED {
            return true;
        }
    }

    for player in lit_torch_players {
        let dx = animal_x - player.position_x;
        let dy = animal_y - player.position_y;
        if dx * dx + dy * dy <= TORCH_FEAR_RADIUS_SQUARED {
            return true;
        }
    }

    for (fx, fy) in foundation_positions {
        let dx = animal_x - *fx;
        let dy = animal_y - *fy;
        if dx * dx + dy * dy <= FOUNDATION_FEAR_RADIUS_SQUARED {
            return true;
        }
    }

    false
}

/// Check if there's a fire source (campfire or torch) or foundation within fear radius of an animal
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
    
    // Check for foundations (animals fear player structures)
    use crate::building::FOUNDATION_TILE_SIZE_PX;
    for foundation in ctx.db.foundation_cell().iter() {
        if foundation.is_destroyed {
            continue;
        }
        
        // Convert foundation cell coordinates to world pixel coordinates (center of foundation cell)
        let foundation_world_x = (foundation.cell_x as f32 * FOUNDATION_TILE_SIZE_PX as f32) + (FOUNDATION_TILE_SIZE_PX as f32 / 2.0);
        let foundation_world_y = (foundation.cell_y as f32 * FOUNDATION_TILE_SIZE_PX as f32) + (FOUNDATION_TILE_SIZE_PX as f32 / 2.0);
        
        let dx = animal_x - foundation_world_x;
        let dy = animal_y - foundation_world_y;
        let distance_sq = dx * dx + dy * dy;
        
        if distance_sq <= FOUNDATION_FEAR_RADIUS_SQUARED {
            return true;
        }
    }
    
    false
}

// === FLASHLIGHT BEAM HESITATION SYSTEM ===
// Flashlight beams cause apparitions (hostile NPCs) to hesitate when caught in the light cone.
// Unlike fire fear (which causes fleeing), flashlight hesitation:
// - Slows movement to 55% speed
// - Prevents escalation from Stalking → Chasing (they stay hesitant)
// - Only affects hostile NPCs (Shorebound, Shardkin, DrownedWatch)
// - Is directional (cone-based, player must aim at them)
// This creates tactical gameplay: flashlight occupies weapon slot, so you choose to deter OR fight

/// Check if a hostile NPC is within any player's flashlight beam cone
/// Returns Some(player_identity) if in beam, None if not
pub fn is_in_any_flashlight_beam(ctx: &ReducerContext, npc_x: f32, npc_y: f32) -> Option<Identity> {
    for player in ctx.db.player().iter() {
        // Skip dead players or those with flashlight off
        if player.is_dead || !player.is_flashlight_on {
            continue;
        }
        
        // Check distance first (cheaper than angle calculation)
        let dx = npc_x - player.position_x;
        let dy = npc_y - player.position_y;
        let distance_sq = dx * dx + dy * dy;
        
        if distance_sq > FLASHLIGHT_BEAM_RANGE_SQUARED || distance_sq < 1.0 {
            continue; // Too far or too close (avoid div by zero)
        }
        
        // Calculate angle from player to NPC
        let angle_to_npc = dy.atan2(dx);
        
        // Get player's flashlight aim direction
        let aim_angle = player.flashlight_aim_angle;
        
        // Calculate angular difference (handling wraparound)
        let mut angle_diff = (angle_to_npc - aim_angle).abs();
        if angle_diff > PI {
            angle_diff = 2.0 * PI - angle_diff;
        }
        
        // Check if NPC is within the beam cone
        if angle_diff <= FLASHLIGHT_BEAM_HALF_ANGLE {
            return Some(player.identity);
        }
    }
    
    None
}

/// Check if a specific player's flashlight beam is hitting an NPC at given position
/// More efficient when checking against a specific player
pub fn is_in_player_flashlight_beam(player: &Player, npc_x: f32, npc_y: f32) -> bool {
    // Skip if flashlight is off or player is dead
    if !player.is_flashlight_on || player.is_dead {
        return false;
    }
    
    // Check distance first
    let dx = npc_x - player.position_x;
    let dy = npc_y - player.position_y;
    let distance_sq = dx * dx + dy * dy;
    
    if distance_sq > FLASHLIGHT_BEAM_RANGE_SQUARED || distance_sq < 1.0 {
        return false;
    }
    
    // Calculate angle from player to NPC
    let angle_to_npc = dy.atan2(dx);
    
    // Get player's flashlight aim direction
    let aim_angle = player.flashlight_aim_angle;
    
    // Calculate angular difference (handling wraparound)
    let mut angle_diff = (angle_to_npc - aim_angle).abs();
    if angle_diff > PI {
        angle_diff = 2.0 * PI - angle_diff;
    }
    
    // Check if NPC is within the beam cone
    angle_diff <= FLASHLIGHT_BEAM_HALF_ANGLE
}

/// Get the speed multiplier for a hostile NPC based on flashlight beam exposure
/// Returns 1.0 if not in beam, FLASHLIGHT_HESITATION_SPEED_MULTIPLIER if in beam
pub fn get_flashlight_hesitation_multiplier(ctx: &ReducerContext, animal: &WildAnimal) -> f32 {
    // Only hostile NPCs are affected by flashlight hesitation
    let is_hostile = matches!(animal.species,
        AnimalSpecies::Shorebound | AnimalSpecies::Shardkin | AnimalSpecies::DrownedWatch);
    
    if !is_hostile {
        return 1.0; // Regular animals are not affected
    }
    
    // Check if in any flashlight beam
    if is_in_any_flashlight_beam(ctx, animal.pos_x, animal.pos_y).is_some() {
        FLASHLIGHT_HESITATION_SPEED_MULTIPLIER
    } else {
        1.0
    }
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

/// Prefetched closest fire/foundation source position for fleeing boundary logic.
fn find_closest_fire_position_prefetched(
    animal_x: f32,
    animal_y: f32,
    burning_campfires: &[Campfire],
    lit_torch_players: &[Player],
    foundation_positions: &[(f32, f32)],
) -> Option<(f32, f32)> {
    let mut closest_fire_pos: Option<(f32, f32)> = None;
    let mut closest_distance_sq = f32::MAX;

    for campfire in burning_campfires {
        let dx = animal_x - campfire.pos_x;
        let dy = animal_y - campfire.pos_y;
        let distance_sq = dx * dx + dy * dy;
        if distance_sq < closest_distance_sq {
            closest_distance_sq = distance_sq;
            closest_fire_pos = Some((campfire.pos_x, campfire.pos_y));
        }
    }

    for player in lit_torch_players {
        let dx = animal_x - player.position_x;
        let dy = animal_y - player.position_y;
        let distance_sq = dx * dx + dy * dy;
        if distance_sq < closest_distance_sq {
            closest_distance_sq = distance_sq;
            closest_fire_pos = Some((player.position_x, player.position_y));
        }
    }

    for (fx, fy) in foundation_positions {
        let dx = animal_x - *fx;
        let dy = animal_y - *fy;
        let distance_sq = dx * dx + dy * dy;
        if distance_sq < closest_distance_sq {
            closest_distance_sq = distance_sq;
            closest_fire_pos = Some((*fx, *fy));
        }
    }

    closest_fire_pos
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
    
    // Check foundations (animals fear player structures)
    use crate::building::FOUNDATION_TILE_SIZE_PX;
    for foundation in ctx.db.foundation_cell().iter() {
        if foundation.is_destroyed {
            continue;
        }
        
        // Convert foundation cell coordinates to world pixel coordinates (center of foundation cell)
        let foundation_world_x = (foundation.cell_x as f32 * FOUNDATION_TILE_SIZE_PX as f32) + (FOUNDATION_TILE_SIZE_PX as f32 / 2.0);
        let foundation_world_y = (foundation.cell_y as f32 * FOUNDATION_TILE_SIZE_PX as f32) + (FOUNDATION_TILE_SIZE_PX as f32 / 2.0);
        
        let dx = animal_x - foundation_world_x;
        let dy = animal_y - foundation_world_y;
        let distance_sq = dx * dx + dy * dy;
        
        if distance_sq < closest_distance_sq {
            closest_distance_sq = distance_sq;
            closest_fire_pos = Some((foundation_world_x, foundation_world_y));
        }
    }
    
    closest_fire_pos
}

/// Check if an animal should fear fire (considers group courage)
fn should_fear_fire(ctx: &ReducerContext, animal: &WildAnimal) -> bool {
    // Wolverines are completely fearless - they ignore fire entirely
    if animal.species == AnimalSpecies::Wolverine {
        return false;
    }
    
    // Fearless hostile NPCs (Shorebound, Shardkin, DrownedWatch) fear NOTHING
    // They charge through fire without hesitation
    if matches!(animal.species, 
        AnimalSpecies::Shorebound | AnimalSpecies::Shardkin | AnimalSpecies::DrownedWatch) {
        return false;
    }
    
    // Bees don't FEAR fire - they DIE from it!
    // They need to chase torch-wielding players to get close enough to burn
    // Fire death is handled separately in BeeBehavior::update_ai_state_logic
    if animal.species == AnimalSpecies::Bee {
        return false;
    }
    
    // Count nearby group members
    let group_size = count_nearby_group_members(ctx, animal);
    
    // Groups of 3+ ignore fire fear
    if group_size >= GROUP_COURAGE_THRESHOLD {
        return false;
    }
    
    // Check if fire is nearby
    is_fire_nearby(ctx, animal.pos_x, animal.pos_y)
}

/// Prefetched variant to keep behavior identical while reducing repeated table scans.
fn should_fear_fire_prefetched(prefetched: &PreFetchedAIData, ctx: &ReducerContext, animal: &WildAnimal) -> bool {
    // Keep species and group-courage logic exactly the same as should_fear_fire().
    if animal.species == AnimalSpecies::Wolverine {
        return false;
    }
    if matches!(animal.species, AnimalSpecies::Shorebound | AnimalSpecies::Shardkin | AnimalSpecies::DrownedWatch) {
        return false;
    }
    if animal.species == AnimalSpecies::Bee {
        return false;
    }

    let group_size = count_nearby_group_members(ctx, animal);
    if group_size >= GROUP_COURAGE_THRESHOLD {
        return false;
    }

    is_fire_nearby_prefetched(
        animal.pos_x,
        animal.pos_y,
        &prefetched.burning_campfires,
        &prefetched.lit_torch_players,
        &prefetched.active_foundation_positions,
    )
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

/// Wrapper function for animal behavior compatibility - checks if position has fire nearby
/// The distance parameter is ignored since is_fire_nearby already uses appropriate thresholds
pub fn is_position_near_fire(ctx: &ReducerContext, x: f32, y: f32, _distance: f32) -> bool {
    is_fire_nearby(ctx, x, y)
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
pub fn process_pack_behavior(
    ctx: &ReducerContext,
    animal: &mut WildAnimal,
    current_time: Timestamp,
    rng: &mut impl Rng,
    pack_size_map: &HashMap<u64, usize>,
    pack_has_alpha_map: &HashMap<u64, bool>,
) -> Result<(), String> {
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
        if should_leave_pack(ctx, animal, current_time, rng, pack_size_map, pack_has_alpha_map)? {
            leave_pack(ctx, animal, current_time)?;
            log::info!("Wolf {} left pack {}", animal.id, pack_id);
        }
    } else {
        // Wolf is solo, check for pack formation
        if let Some(other_wolf) = find_nearby_packable_wolf(ctx, animal, pack_size_map) {
            attempt_pack_formation(ctx, animal, other_wolf, current_time, rng)?;
        }
    }
    
    Ok(())
}

/// Check if a wolf should leave its current pack
fn should_leave_pack(
    ctx: &ReducerContext,
    animal: &WildAnimal,
    current_time: Timestamp,
    rng: &mut impl Rng,
    pack_size_map: &HashMap<u64, usize>,
    pack_has_alpha_map: &HashMap<u64, bool>,
) -> Result<bool, String> {
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
        let pack_member_count = *pack_size_map.get(&pack_id).unwrap_or(&get_pack_size(ctx, pack_id));
        let has_alpha = *pack_has_alpha_map.get(&pack_id).unwrap_or(&get_pack_member_stats(ctx, pack_id).1);
        
        // If pack has only 1 member (this wolf), dissolve
        if pack_member_count <= 1 {
            return Ok(true);
        }
        
        // Don't dissolve larger packs easily - they're more valuable for gameplay
        if pack_member_count >= 3 && rng.gen::<f32>() < 0.5 {
            // 50% chance to stay even if randomly selected to leave (pack loyalty)
            return Ok(false);
        }
        
        // If no alpha in pack, someone should become alpha
        if !has_alpha {
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
fn find_nearby_packable_wolf(
    ctx: &ReducerContext,
    animal: &WildAnimal,
    pack_size_map: &HashMap<u64, usize>,
) -> Option<WildAnimal> {
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
                let other_pack_id = other_animal.pack_id.unwrap();
                let pack_size = *pack_size_map
                    .get(&other_pack_id)
                    .unwrap_or(&get_pack_size(ctx, other_pack_id));
                if pack_size < MAX_PACK_SIZE {
                    return Some(other_animal);
                }
            }
            
            // Case 3: Pack member meets solo wolf  
            if animal.pack_id.is_some() && other_animal.pack_id.is_none() {
                let current_pack_id = animal.pack_id.unwrap();
                let pack_size = *pack_size_map
                    .get(&current_pack_id)
                    .unwrap_or(&get_pack_size(ctx, current_pack_id));
                if pack_size < MAX_PACK_SIZE {
                    return Some(other_animal);
                }
            }
            
            // Case 4: Two different packs meet - alpha challenge!
            if let (Some(pack_a), Some(pack_b)) = (animal.pack_id, other_animal.pack_id) {
                if pack_a != pack_b && animal.is_pack_leader && other_animal.is_pack_leader {
                    // Two alphas meeting - potential pack merger
                    let size_a = *pack_size_map.get(&pack_a).unwrap_or(&get_pack_size(ctx, pack_a));
                    let size_b = *pack_size_map.get(&pack_b).unwrap_or(&get_pack_size(ctx, pack_b));
                    let combined_size = size_a + size_b;
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
    ctx.db.wild_animal()
        .iter()
        .filter(|animal| animal.pack_id == Some(pack_id))
        .count()
}

/// Fast per-call pack summary to reduce repeated full scans in pack checks.
struct PackSnapshot {
    pack_sizes: HashMap<u64, usize>,
    pack_has_alpha: HashMap<u64, bool>,
}

fn build_pack_snapshot(ctx: &ReducerContext) -> PackSnapshot {
    let mut pack_sizes: HashMap<u64, usize> = HashMap::new();
    let mut pack_has_alpha: HashMap<u64, bool> = HashMap::new();
    for wolf in ctx.db.wild_animal().iter() {
        if let Some(pack_id) = wolf.pack_id {
            *pack_sizes.entry(pack_id).or_insert(0) += 1;
            if wolf.is_pack_leader {
                pack_has_alpha.insert(pack_id, true);
            } else {
                pack_has_alpha.entry(pack_id).or_insert(false);
            }
        }
    }
    PackSnapshot { pack_sizes, pack_has_alpha }
}

/// Returns (member_count, has_alpha) for the given pack.
fn get_pack_member_stats(ctx: &ReducerContext, pack_id: u64) -> (usize, bool) {
    let mut member_count = 0usize;
    let mut has_alpha = false;
    for wolf in ctx.db.wild_animal().iter() {
        if wolf.pack_id == Some(pack_id) {
            member_count += 1;
            if wolf.is_pack_leader {
                has_alpha = true;
            }
        }
    }
    (member_count, has_alpha)
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

/// **COMMON FIRE FLEE SYSTEM** - Handles torch loop prevention for all animals
/// Returns true if fire was detected and animal is now fleeing (caller should skip normal AI logic)
pub fn handle_fire_detection_and_flee(
    ctx: &ReducerContext,
    animal: &mut WildAnimal,
    stats: &AnimalStats,
    player: &Player,
    current_time: Timestamp,
    rng: &mut impl Rng,
) -> bool {
    // 🦭 WALRUS EXCEPTION: Walruses don't respond to fire at all
    if animal.species == AnimalSpecies::ArcticWalrus {
        return false; // Walruses ignore fire completely
    }
    
    // Check if player has fire nearby
    if !is_position_near_fire(ctx, player.position_x, player.position_y, 100.0) {
        return false; // No fire detected
    }
    
    // Calculate species-specific flee distance beyond engagement radius
    let base_flee_distance = match animal.species {
        AnimalSpecies::TundraWolf => stats.chase_trigger_range + 200.0,   // 750 + 200 = 950px
        AnimalSpecies::CinderFox => 320.0,                               // Fixed distance for foxes
        AnimalSpecies::CableViper => stats.chase_trigger_range + 150.0,  // 350 + 150 = 500px
        AnimalSpecies::ArcticWalrus => unreachable!(), // Already handled above
        AnimalSpecies::BeachCrab => 250.0,             // Crabs scuttle away from fire
        AnimalSpecies::Tern => 500.0,                  // Birds fly away from fire
        AnimalSpecies::Crow => 450.0,                  // Crows fly away from fire
        AnimalSpecies::Vole => 400.0,                  // Voles flee quickly from fire
        AnimalSpecies::Caribou => 500.0,              // Caribou flee quickly from fire
        AnimalSpecies::SalmonShark => {
            return false; // Sharks are water-only - don't flee from fire
        },
        AnimalSpecies::Jellyfish => {
            return false; // Jellyfish are water-only - don't flee from fire
        },
        AnimalSpecies::Wolverine => {
            return false; // Wolverines are fearless - don't flee from fire
        }
        // Hostile NPCs don't flee from fire - they're aggressive night creatures
        AnimalSpecies::Shorebound | AnimalSpecies::Shardkin | AnimalSpecies::DrownedWatch => {
            return false; // Hostile NPCs ignore fire
        }
        // Bees don't flee from fire - they die from it
        AnimalSpecies::Bee => {
            return false; // Bees die from fire, don't flee
        }
        // Alpine animals
        AnimalSpecies::PolarBear => 600.0,          // Polar bears flee far from fire
        AnimalSpecies::Hare => 500.0,               // Hares flee quickly from fire
        AnimalSpecies::SnowyOwl => 600.0,           // Owls fly away from fire
    };
    
    // Special handling for cornered foxes (don't flee if too close)
    if animal.species == AnimalSpecies::CinderFox {
        let distance_to_player = get_distance_squared(animal.pos_x, animal.pos_y, player.position_x, player.position_y).sqrt();
        let cornered_distance = 240.0; // Larger buffer from torch users for foxes
        
        if distance_to_player <= cornered_distance {
            return false; // Fox is cornered, let it fight instead of flee
        }
    }
    
    // Force animal to flee beyond engagement radius
    animal.state = AnimalState::Fleeing;
    animal.target_player_id = None;
    animal.state_change_time = current_time;
    
    // Calculate direction away from player with fire
    let dx = animal.pos_x - player.position_x;
    let dy = animal.pos_y - player.position_y;
    let distance = (dx * dx + dy * dy).sqrt();
    
    if distance > 0.0 {
        // Flee in exact opposite direction from player
        let flee_direction_x = dx / distance;
        let flee_direction_y = dy / distance;
        
        animal.investigation_x = Some(animal.pos_x + flee_direction_x * base_flee_distance);
        animal.investigation_y = Some(animal.pos_y + flee_direction_y * base_flee_distance);
    } else {
        // Fallback: flee in random direction if player position is unknown
        let flee_angle = rng.gen::<f32>() * 2.0 * PI;
        animal.investigation_x = Some(animal.pos_x + base_flee_distance * flee_angle.cos());
        animal.investigation_y = Some(animal.pos_y + base_flee_distance * flee_angle.sin());
    }
    
    log::info!("{:?} {} fleeing from torch/fire - moving beyond engagement range ({:.0}px)", 
               animal.species, animal.id, base_flee_distance);
    
    true // Fire detected and flee initiated
}

/// **COMMON SOUND EMISSION SYSTEM** - Handles species-specific growl/hiss sounds
pub fn emit_species_sound(
    ctx: &ReducerContext,
    animal: &WildAnimal, 
    player_identity: Identity,
    sound_context: &str,  // "chase_start", "cornered", "attack", etc.
) {
    match animal.species {
        AnimalSpecies::TundraWolf => {
            crate::sound_events::emit_wolf_growl_sound(ctx, animal.pos_x, animal.pos_y, player_identity);
        },
        AnimalSpecies::CinderFox => {
            crate::sound_events::emit_fox_growl_sound(ctx, animal.pos_x, animal.pos_y, player_identity);
        },
        AnimalSpecies::CableViper => {
            crate::sound_events::emit_snake_growl_sound(ctx, animal.pos_x, animal.pos_y, player_identity);
        },
        AnimalSpecies::ArcticWalrus => {
            crate::sound_events::emit_walrus_growl_sound(ctx, animal.pos_x, animal.pos_y, player_identity);
        },
        AnimalSpecies::BeachCrab => {
            crate::sound_events::emit_crab_growl_sound(ctx, animal.pos_x, animal.pos_y, player_identity);
        },
        AnimalSpecies::Tern => {
            crate::sound_events::emit_tern_growl_sound(ctx, animal.pos_x, animal.pos_y, player_identity);
        },
        AnimalSpecies::Crow => {
            crate::sound_events::emit_crow_growl_sound(ctx, animal.pos_x, animal.pos_y, player_identity);
        },
        AnimalSpecies::Vole => {
            crate::sound_events::emit_vole_growl_sound(ctx, animal.pos_x, animal.pos_y, player_identity);
        },
        AnimalSpecies::Wolverine => {
            crate::sound_events::emit_wolverine_growl_sound(ctx, animal.pos_x, animal.pos_y, player_identity);
        },
        AnimalSpecies::Caribou => {
            crate::sound_events::emit_caribou_growl_sound(ctx, animal.pos_x, animal.pos_y, player_identity);
        },
        AnimalSpecies::SalmonShark => {
            // Sharks are silent hunters - no growl sound
        },
        AnimalSpecies::Jellyfish => {
            // Jellyfish are silent - no growl sound
        },
        // Night hostile NPCs have their own custom sounds
        AnimalSpecies::Shorebound => {
            crate::sound_events::emit_shorebound_growl_sound(ctx, animal.pos_x, animal.pos_y, player_identity);
        },
        AnimalSpecies::Shardkin => {
            crate::sound_events::emit_shardkin_growl_sound(ctx, animal.pos_x, animal.pos_y, player_identity);
        },
        AnimalSpecies::DrownedWatch => {
            crate::sound_events::emit_drowned_watch_growl_sound(ctx, animal.pos_x, animal.pos_y, player_identity);
        },
        AnimalSpecies::Bee => {
            // Bees use a continuous buzzing sound, handled client-side
            // No individual attack/growl sounds
        },
        // Alpine animals
        AnimalSpecies::PolarBear => {
            crate::sound_events::emit_polar_bear_growl_sound(ctx, animal.pos_x, animal.pos_y, player_identity);
        },
        AnimalSpecies::Hare => {
            crate::sound_events::emit_hare_growl_sound(ctx, animal.pos_x, animal.pos_y, player_identity);
        },
        AnimalSpecies::SnowyOwl => {
            crate::sound_events::emit_owl_growl_sound(ctx, animal.pos_x, animal.pos_y, player_identity);
        },
    }
    
    log::debug!("{:?} {} emitting {} sound", animal.species, animal.id, sound_context);
}

/// **DEATH SOUND SYSTEM** - Emits species-specific death sounds when animals die
pub fn emit_death_sound(
    ctx: &ReducerContext,
    animal: &WildAnimal,
    killer_identity: Identity,
) {
    let sound_type = match animal.species {
        AnimalSpecies::TundraWolf => SoundType::DeathWolf,
        AnimalSpecies::CinderFox => SoundType::DeathFox,
        AnimalSpecies::CableViper => SoundType::DeathViper,
        AnimalSpecies::ArcticWalrus => SoundType::DeathWalrus,
        AnimalSpecies::BeachCrab => SoundType::DeathCrab,
        AnimalSpecies::Tern => SoundType::DeathTern,
        AnimalSpecies::Crow => SoundType::DeathCrow,
        AnimalSpecies::Vole => SoundType::DeathVole,
        AnimalSpecies::Wolverine => SoundType::DeathWolverine,
        AnimalSpecies::Caribou => SoundType::DeathCaribou,
        AnimalSpecies::SalmonShark => SoundType::DeathCaribou, // Use similar death sound for now
        AnimalSpecies::Jellyfish => return, // Jellyfish are silent - no death sound
        // Hostile NPCs use their own death sound (already handled separately)
        AnimalSpecies::Shorebound | AnimalSpecies::Shardkin | AnimalSpecies::DrownedWatch => {
            return; // These use HostileDeath sound via hostile_spawning.rs
        },
        // Bees have their own death handling in bee.rs (emit_bee_death_and_delete)
        // This function shouldn't be called for bees, but just in case:
        AnimalSpecies::Bee => {
            SoundType::DeathBee
        },
        // Alpine animals
        AnimalSpecies::PolarBear => SoundType::DeathPolarBear,
        AnimalSpecies::Hare => SoundType::DeathHare,
        AnimalSpecies::SnowyOwl => SoundType::DeathOwl,
    };
    
    if let Err(e) = sound_events::emit_sound_at_position(ctx, sound_type, animal.pos_x, animal.pos_y, 1.0, killer_identity) {
        log::error!("Failed to emit death sound for {:?}: {}", animal.species, e);
    }
    log::debug!("🦴 {:?} {} death sound emitted", animal.species, animal.id);
}

/// **COMMON STATE TRANSITION HELPER** - Standardizes state changes with logging
pub fn transition_to_state(
    animal: &mut WildAnimal,
    new_state: AnimalState,
    current_time: Timestamp,
    target_player: Option<Identity>,
    reason: &str,
) {
    let old_state = animal.state;
    animal.state = new_state;
    animal.state_change_time = current_time;
    
    // Clear fire fear override when appropriate
    match new_state {
        AnimalState::Idle => {
            // Clear fire fear override when going idle
            if animal.fire_fear_overridden_by.is_some() {
                log::debug!("{:?} {} clearing fire fear override - going idle", 
                           animal.species, animal.id);
                animal.fire_fear_overridden_by = None;
            }
            animal.target_player_id = None;
            // Clear any investigation targets
            animal.investigation_x = None;
            animal.investigation_y = None;
        },
        
        AnimalState::Patrolling => {
            // Clear fire fear override when returning to patrol
            if animal.fire_fear_overridden_by.is_some() {
                log::debug!("{:?} {} clearing fire fear override - returning to patrol", 
                           animal.species, animal.id);
                animal.fire_fear_overridden_by = None;
            }
            animal.target_player_id = None;
        },
        
        AnimalState::Fleeing => {
            // Clear fire fear override when fleeing (probably due to low health)
            if animal.fire_fear_overridden_by.is_some() {
                log::debug!("{:?} {} clearing fire fear override - fleeing", 
                           animal.species, animal.id);
                animal.fire_fear_overridden_by = None;
            }
            animal.target_player_id = target_player;
        },
        
        AnimalState::Chasing => {
            // If switching to a different target, clear fire fear override
            if let (Some(old_target), Some(new_target)) = (animal.target_player_id, target_player) {
                if old_target != new_target && animal.fire_fear_overridden_by.is_some() {
                    log::debug!("{:?} {} clearing fire fear override - switching targets", 
                               animal.species, animal.id);
                    animal.fire_fear_overridden_by = None;
                }
            }
            animal.target_player_id = target_player;
        },
        
        _ => {
            // For other states, keep target and fire fear override as is
            animal.target_player_id = target_player;
        }
    }
    
    log::debug!("{:?} {} state: {:?} -> {:?} ({})", 
               animal.species, animal.id, old_state, new_state, reason);
}

/// **COMMON DISTANCE AND DETECTION HELPERS** - Reduce boilerplate in animal behaviors
pub fn get_player_distance(animal: &WildAnimal, player: &Player) -> f32 {
    get_distance_squared(animal.pos_x, animal.pos_y, player.position_x, player.position_y).sqrt()
}

pub fn is_player_in_attack_range(animal: &WildAnimal, player: &Player, stats: &AnimalStats) -> bool {
    let distance_sq = get_distance_squared(animal.pos_x, animal.pos_y, player.position_x, player.position_y);
    distance_sq <= (stats.attack_range * stats.attack_range)
}

pub fn is_player_in_chase_range(animal: &WildAnimal, player: &Player, stats: &AnimalStats) -> bool {
    let distance_sq = get_distance_squared(animal.pos_x, animal.pos_y, player.position_x, player.position_y);
    distance_sq <= (stats.chase_trigger_range * stats.chase_trigger_range)
}

/// **COMMON FLEE DESTINATION CALCULATOR** - Standardizes flee logic
pub fn set_flee_destination_away_from_threat(
    animal: &mut WildAnimal,
    threat_x: f32,
    threat_y: f32,
    flee_distance: f32,
    rng: &mut impl Rng,
) {
    // Calculate direction away from threat
    let dx_from_threat = animal.pos_x - threat_x;
    let dy_from_threat = animal.pos_y - threat_y;
    let distance_from_threat = (dx_from_threat * dx_from_threat + dy_from_threat * dy_from_threat).sqrt();
    
    if distance_from_threat > 0.1 {
        // Flee in exact opposite direction from threat
        let flee_direction_x = dx_from_threat / distance_from_threat;
        let flee_direction_y = dy_from_threat / distance_from_threat;
        
        animal.investigation_x = Some(animal.pos_x + flee_direction_x * flee_distance);
        animal.investigation_y = Some(animal.pos_y + flee_direction_y * flee_distance);
        
        log::debug!("{:?} {} fleeing {:.0}px away from threat at ({:.1}, {:.1})", 
                   animal.species, animal.id, flee_distance, threat_x, threat_y);
    } else {
        // Fallback: random direction if threat position is unknown
        let random_angle = rng.gen::<f32>() * 2.0 * PI;
        animal.investigation_x = Some(animal.pos_x + random_angle.cos() * flee_distance);
        animal.investigation_y = Some(animal.pos_y + random_angle.sin() * flee_distance);
        
        log::debug!("{:?} {} fleeing {:.0}px in random direction (threat position unknown)", 
                   animal.species, animal.id, flee_distance);
    }
}

/// **COMMON STUCK DETECTION AND RECOVERY** - Detects when animals get stuck and picks new directions
pub fn handle_movement_stuck_recovery(
    animal: &mut WildAnimal,
    prev_x: f32,
    prev_y: f32,
    movement_threshold: f32,
    rng: &mut impl Rng,
    context: &str, // "patrol", "flee", etc.
) -> bool {
    let distance_moved = ((animal.pos_x - prev_x).powi(2) + (animal.pos_y - prev_y).powi(2)).sqrt();
    
    if distance_moved < movement_threshold {
        // Stuck! Pick new random direction
        let new_angle = rng.gen::<f32>() * 2.0 * PI;
        animal.direction_x = new_angle.cos();
        animal.direction_y = new_angle.sin();
        
        log::debug!("{:?} {} stuck during {} - changing direction", 
                   animal.species, animal.id, context);
        return true; // Was stuck
    }
    false // Not stuck
}

/// **COMMON RANDOM DIRECTION CHANGE** - Handles species-specific random direction changes during patrol
pub fn maybe_change_patrol_direction(
    animal: &mut WildAnimal,
    rng: &mut impl Rng,
) {
    let change_chance = match animal.species {
        AnimalSpecies::CinderFox => 0.10,     // Fewer zig-zags — smoother patrol
        AnimalSpecies::TundraWolf => 0.07,    // Straighter prowl between turns
        AnimalSpecies::CableViper => 0.15,    // Vipers are moderate
        AnimalSpecies::ArcticWalrus => 0.06,  // Walruses are very slow and deliberate
        AnimalSpecies::BeachCrab => 0.10,     // Crabs scuttle but are fairly predictable
        AnimalSpecies::Tern => 0.05,          // Terns fly in more consistent directions
        AnimalSpecies::Crow => 0.08,          // Crows are fairly focused
        AnimalSpecies::Vole => 0.25,          // Voles are very erratic and skittish
        AnimalSpecies::Wolverine => 0.06,     // Deliberate, less twitchy patrol
        AnimalSpecies::Caribou => 0.05,       // Grazing herds — long straight segments
        AnimalSpecies::SalmonShark => 0.05,   // Sharks swim in smooth, deliberate patterns
        AnimalSpecies::Jellyfish => 0.02,    // Jellyfish drift very slowly and smoothly
        // Hostile NPCs - different patrol patterns
        AnimalSpecies::Shorebound => 0.15,    // Stalker - moderate direction changes while circling
        AnimalSpecies::Shardkin => 0.20,      // Swarmer - erratic movements
        AnimalSpecies::DrownedWatch => 0.04,  // Brute - very deliberate, rarely changes direction
        // Bees have very erratic buzzing movements
        AnimalSpecies::Bee => 0.25,           // Bees buzz around erratically
        // Alpine animals
        AnimalSpecies::PolarBear => 0.08,     // Polar bears are deliberate predators
        AnimalSpecies::Hare => 0.22,          // Hares are skittish and erratic
        AnimalSpecies::SnowyOwl => 0.10,      // Owls fly with purpose
    };
    
    // Adjust for pack wolves (alphas change direction less frequently)
    let effective_chance = if animal.species == AnimalSpecies::TundraWolf && animal.is_pack_leader {
        change_chance * 0.67 // 8% for alphas vs 12% for solo wolves
    } else {
        change_chance
    };
    
    if rng.gen::<f32>() < effective_chance {
        let new_angle = rng.gen::<f32>() * 2.0 * PI;
        animal.direction_x = new_angle.cos();
        animal.direction_y = new_angle.sin();
        
        log::debug!("{:?} {} changed patrol direction", animal.species, animal.id);
    }
}

/// **COMMON PATROL MOVEMENT** - Standard wandering with obstacle avoidance
pub fn execute_standard_patrol(
    ctx: &ReducerContext,
    animal: &mut WildAnimal,
    stats: &AnimalStats,
    dt: f32,
    rng: &mut impl Rng,
) {
    let prev_x = animal.pos_x;
    let prev_y = animal.pos_y;
    
    // Handle species-specific random direction changes
    maybe_change_patrol_direction(animal, rng);
    
    let target_x = animal.pos_x + animal.direction_x * stats.movement_speed * dt;
    let target_y = animal.pos_y + animal.direction_y * stats.movement_speed * dt;
    
    // Check if target position is safe (avoid shelters and disallowed water).
    let water_blocks = !can_animal_traverse_water(animal) && crate::fishing::is_water_tile(ctx, target_x, target_y);
    if !is_position_in_shelter(ctx, target_x, target_y) && !water_blocks {
        move_towards_target(ctx, animal, target_x, target_y, stats.movement_speed, dt);
        
        // Check if stuck and recover
        handle_movement_stuck_recovery(animal, prev_x, prev_y, 3.0, rng, "patrol");
    } else {
        // If target position is blocked, pick a new random direction
        let new_angle = rng.gen::<f32>() * 2.0 * PI;
        animal.direction_x = new_angle.cos();
        animal.direction_y = new_angle.sin();
    }
}

/// **COMMON FLEE MOVEMENT** - Standard fleeing with destination and obstacle avoidance
pub fn execute_standard_flee(
    ctx: &ReducerContext,
    animal: &mut WildAnimal,
    stats: &AnimalStats,
    dt: f32,
    current_time: Timestamp,
    rng: &mut impl Rng,
) {
    let prev_x = animal.pos_x;
    let prev_y = animal.pos_y;
    
    // Pick a random direction to flee if none set
    if animal.investigation_x.is_none() || animal.investigation_y.is_none() {
        let flee_angle = rng.gen::<f32>() * 2.0 * PI;
        let flee_distance = match animal.species {
            AnimalSpecies::CinderFox => 600.0 + (rng.gen::<f32>() * 400.0), // 12-20m for foxes
            AnimalSpecies::TundraWolf => 400.0 + (rng.gen::<f32>() * 300.0), // 8-14m for wolves
            AnimalSpecies::CableViper => 300.0 + (rng.gen::<f32>() * 200.0), // 6-10m for vipers
            AnimalSpecies::ArcticWalrus => 100.0, // Walruses barely flee (defensive positioning only)
            AnimalSpecies::BeachCrab => 200.0 + (rng.gen::<f32>() * 100.0), // 4-6m for crabs - short scuttle
            AnimalSpecies::Tern => 800.0 + (rng.gen::<f32>() * 500.0), // 16-26m for terns - fly away
            AnimalSpecies::Crow => 600.0 + (rng.gen::<f32>() * 400.0), // 12-20m for crows - fly away
            AnimalSpecies::Vole => 500.0 + (rng.gen::<f32>() * 300.0), // 10-16m for voles - fast scurry
            AnimalSpecies::Wolverine => 0.0, // Wolverines NEVER flee
            AnimalSpecies::Caribou => 600.0 + (rng.gen::<f32>() * 400.0), // 12-20m for caribou - fast sprint
            AnimalSpecies::SalmonShark => 0.0, // Sharks NEVER flee
            AnimalSpecies::Jellyfish => 0.0, // Jellyfish NEVER flee - passive drifters
            // Night hostile NPCs don't flee
            AnimalSpecies::Shorebound | AnimalSpecies::Shardkin | AnimalSpecies::DrownedWatch => 0.0,
            // Bees don't flee
            AnimalSpecies::Bee => 0.0,
            // Alpine animals
            AnimalSpecies::PolarBear => 0.0, // Polar bears NEVER flee (apex predator)
            AnimalSpecies::Hare => 500.0 + (rng.gen::<f32>() * 300.0), // 10-16m for hares - fast scurry
            AnimalSpecies::SnowyOwl => 400.0 + (rng.gen::<f32>() * 300.0), // 8-14m for owls - fly away
        };
        
        animal.investigation_x = Some(animal.pos_x + flee_distance * flee_angle.cos());
        animal.investigation_y = Some(animal.pos_y + flee_distance * flee_angle.sin());
        
        log::debug!("{:?} {} set flee destination: {:.0}px away", 
                   animal.species, animal.id, flee_distance);
    }
    
    if let (Some(target_x), Some(target_y)) = (animal.investigation_x, animal.investigation_y) {
        move_towards_target(ctx, animal, target_x, target_y, stats.sprint_speed, dt);
        
        // Check if stuck and pick new direction
        if handle_movement_stuck_recovery(animal, prev_x, prev_y, 5.0, rng, "flee") {
            // Pick new flee direction if stuck
            let new_angle = rng.gen::<f32>() * 2.0 * PI;
            let flee_distance = 300.0;
            animal.investigation_x = Some(animal.pos_x + flee_distance * new_angle.cos());
            animal.investigation_y = Some(animal.pos_y + flee_distance * new_angle.sin());
        }
        
        // Check if reached destination or timeout
        let distance_to_target = get_distance_squared(animal.pos_x, animal.pos_y, target_x, target_y).sqrt();
        let time_fleeing = current_time.to_micros_since_unix_epoch() - animal.state_change_time.to_micros_since_unix_epoch();
        
        let max_flee_time = match animal.species {
            AnimalSpecies::CinderFox => 3_000_000,  // 3 seconds
            AnimalSpecies::TundraWolf => 4_000_000, // 4 seconds  
            AnimalSpecies::CableViper => 3_000_000, // 3 seconds
            AnimalSpecies::ArcticWalrus => 1_000_000, // 1 second (walruses don't really flee)
            AnimalSpecies::BeachCrab => 2_000_000,  // 2 seconds - quick scuttle escape
            AnimalSpecies::Tern => 5_000_000,       // 5 seconds - fly away far
            AnimalSpecies::Crow => 4_000_000,       // 4 seconds - fly away
            AnimalSpecies::Vole => 2_500_000,       // 2.5 seconds - quick burrow/hide
            AnimalSpecies::Wolverine => 500_000,    // 0.5 seconds - wolverines don't flee, recover fast
            AnimalSpecies::Caribou => 4_000_000,    // 4 seconds - caribou flee far and fast
            AnimalSpecies::SalmonShark => 500_000, // 0.5 seconds - sharks don't flee, recover fast
            AnimalSpecies::Jellyfish => 500_000, // 0.5 seconds - jellyfish don't flee, recover fast
            // Hostile NPCs don't flee - but if they somehow enter flee state, recover quickly
            AnimalSpecies::Shorebound | AnimalSpecies::Shardkin | AnimalSpecies::DrownedWatch => 500_000, // 0.5 seconds
            // Bees never flee
            AnimalSpecies::Bee => 500_000, // 0.5 seconds - bees don't flee
            // Alpine animals
            AnimalSpecies::PolarBear => 500_000, // 0.5 seconds - polar bears don't flee
            AnimalSpecies::Hare => 3_000_000,    // 3 seconds - hares flee quickly
            AnimalSpecies::SnowyOwl => 4_000_000, // 4 seconds - owls fly away
        };
        
        if distance_to_target <= 50.0 || time_fleeing > max_flee_time {
            // PERFORMANCE: Go to Idle instead of Patrolling - animal stops moving until player nearby
            transition_to_state(animal, AnimalState::Idle, current_time, None, "flee completed");
            animal.investigation_x = None;
            animal.investigation_y = None;
            log::debug!("{:?} {} finished fleeing - going idle (no wandering)", animal.species, animal.id);
        }
    }
}

// ============================================================================
// FLYING BIRD SYSTEM - Reusable for Terns, Crows, and future bird types
// ============================================================================

/// Flying patrol constants
const FLYING_PATROL_MIN_DISTANCE: f32 = 150.0;  // Minimum distance to fly when patrolling
const FLYING_PATROL_MAX_DISTANCE: f32 = 400.0;  // Maximum distance to fly when patrolling  
const FLYING_SPEED_MULTIPLIER: f32 = 1.8;       // Birds fly faster than they walk
const FLYING_HEIGHT_VISUAL: f32 = 32.0;         // Visual height offset for flying birds (not actual collision)
const GROUNDED_PATROL_RADIUS: f32 = 150.0;      // Walking patrol radius for grounded birds
const CHANCE_TO_LAND: f32 = 0.15;               // 15% chance per tick to land while flying (increased - birds should land more often)
const CHANCE_TO_TAKE_OFF: f32 = 0.008;          // 0.8% chance per tick to take off while grounded (much lower - birds should stay grounded longer)

/// **FLYING PATROL** - Birds fly around the island but frequently land to walk
pub fn execute_flying_patrol(
    ctx: &ReducerContext,
    animal: &mut WildAnimal,
    stats: &AnimalStats,
    dt: f32,
    rng: &mut impl Rng,
) {
    // CRITICAL: Set flying flag to true when flying - this controls sprite selection on client
    animal.is_flying = true;
    
    // Random chance to land each tick (high chance - birds should land often)
    // At 8 ticks/second, 15% = roughly 120% per second, so they land quickly
    if rng.gen::<f32>() < CHANCE_TO_LAND {
        // Check if current position is valid for landing (not water)
        if !is_water_tile(ctx, animal.pos_x, animal.pos_y) && 
           !is_position_in_shelter(ctx, animal.pos_x, animal.pos_y) {
            animal.is_flying = false;
            animal.state = AnimalState::Grounded;
            animal.flying_target_x = None;
            animal.flying_target_y = None;
            log::info!("🐦 {:?} {} LANDED at ({:.0}, {:.0}) - now walking", 
                       animal.species, animal.id, animal.pos_x, animal.pos_y);
            return;
        }
    }
    
    // Set a flying destination if we don't have one
    if animal.flying_target_x.is_none() || animal.flying_target_y.is_none() {
        let fly_distance = FLYING_PATROL_MIN_DISTANCE + rng.gen::<f32>() * (FLYING_PATROL_MAX_DISTANCE - FLYING_PATROL_MIN_DISTANCE);
        let fly_angle = rng.gen::<f32>() * 2.0 * PI;
        
        let target_x = animal.pos_x + fly_distance * fly_angle.cos();
        let target_y = animal.pos_y + fly_distance * fly_angle.sin();
        
        // Clamp to world bounds (birds can fly anywhere, including over water)
        let clamped_x = target_x.clamp(50.0, WORLD_WIDTH_PX - 50.0);
        let clamped_y = target_y.clamp(50.0, WORLD_HEIGHT_PX - 50.0);
        
        animal.flying_target_x = Some(clamped_x);
        animal.flying_target_y = Some(clamped_y);
        
        log::debug!("{:?} {} set flying patrol destination to ({:.0}, {:.0})", 
                   animal.species, animal.id, clamped_x, clamped_y);
    }
    
    // Move toward flying destination at high speed (ignore ground obstacles)
    if let (Some(target_x), Some(target_y)) = (animal.flying_target_x, animal.flying_target_y) {
        let fly_speed = stats.sprint_speed * FLYING_SPEED_MULTIPLIER;
        
        // Calculate direction to target
        let dx = target_x - animal.pos_x;
        let dy = target_y - animal.pos_y;
        let distance = (dx * dx + dy * dy).sqrt();
        
        if distance > 20.0 {
            // Move toward target (flying ignores water/shelter collision)
            let norm_dx = dx / distance;
            let norm_dy = dy / distance;
            
            let move_amount = fly_speed * dt;
            let new_x = (animal.pos_x + norm_dx * move_amount).clamp(10.0, WORLD_WIDTH_PX - 10.0);
            let new_y = (animal.pos_y + norm_dy * move_amount).clamp(10.0, WORLD_HEIGHT_PX - 10.0);
            
            animal.pos_x = new_x;
            animal.pos_y = new_y;
            animal.direction_x = norm_dx;
            animal.direction_y = norm_dy;
            
            // Update facing direction
            update_facing_direction(animal);
            
            // Update chunk index
            animal.chunk_index = crate::environment::calculate_chunk_index(animal.pos_x, animal.pos_y);
        } else {
            // Reached flying destination - high chance to land
            animal.flying_target_x = None;
            animal.flying_target_y = None;
            
            // 40% chance to land when reaching destination
            if rng.gen::<f32>() < 0.40 {
                // Check if current position is valid for landing (not water)
                if !is_water_tile(ctx, animal.pos_x, animal.pos_y) && 
                   !is_position_in_shelter(ctx, animal.pos_x, animal.pos_y) {
                    animal.is_flying = false;
                    animal.state = AnimalState::Grounded;
                    log::debug!("{:?} {} landed after reaching flying destination", 
                               animal.species, animal.id);
                }
            }
        }
    }
}

/// **GROUNDED PATROL** - Birds on the ground walk around using direction-based movement like crabs
/// This uses the same pattern as execute_standard_patrol for smooth, organic walking
pub fn execute_grounded_idle(
    ctx: &ReducerContext,
    animal: &mut WildAnimal,
    stats: &AnimalStats,
    dt: f32,
    rng: &mut impl Rng,
) {
    // CRITICAL: Ensure bird is NOT flying - this flag controls sprite selection on client
    animal.is_flying = false;
    
    // Very low random chance to take off - birds should stay grounded and walk more
    // At ~10 ticks/second, 0.8% ≈ 8% chance per second to take off
    if rng.gen::<f32>() < CHANCE_TO_TAKE_OFF {
        animal.is_flying = true;
        animal.state = AnimalState::Flying;
        animal.flying_target_x = None;
        animal.flying_target_y = None;
        log::info!("🐦 {:?} {} TOOK OFF from ground - now flying", animal.species, animal.id);
        return;
    }
    
    let prev_x = animal.pos_x;
    let prev_y = animal.pos_y;
    
    // Use DIRECTION-BASED movement like crabs, not destination-based
    // This prevents the jittery back-and-forth behavior
    
    // Small chance to randomly change direction (3% per tick = ~24% per second)
    if rng.gen::<f32>() < 0.03 {
        let new_angle = rng.gen::<f32>() * 2.0 * PI;
        animal.direction_x = new_angle.cos();
        animal.direction_y = new_angle.sin();
    }
    
    // Ground walking speed - slower than flying, similar to crabs
    let ground_speed = stats.movement_speed * 0.6;
    
    // Calculate next position based on current direction
    let next_x = animal.pos_x + animal.direction_x * ground_speed * dt;
    let next_y = animal.pos_y + animal.direction_y * ground_speed * dt;
    
    // Check if next position is valid (not water, not in shelter)
    if !is_water_tile(ctx, next_x, next_y) && !is_position_in_shelter(ctx, next_x, next_y) {
        // Position is valid - move there
        move_towards_target(ctx, animal, next_x, next_y, ground_speed, dt);
    } else {
        // Blocked! Pick a new random direction away from obstacle
        let new_angle = rng.gen::<f32>() * 2.0 * PI;
        animal.direction_x = new_angle.cos();
        animal.direction_y = new_angle.sin();
    }
    
    // Check if stuck (didn't move enough) and pick new direction
    let distance_moved = ((animal.pos_x - prev_x).powi(2) + (animal.pos_y - prev_y).powi(2)).sqrt();
    if distance_moved < 1.0 {
        // Stuck - pick a new random direction
        let new_angle = rng.gen::<f32>() * 2.0 * PI;
        animal.direction_x = new_angle.cos();
        animal.direction_y = new_angle.sin();
    }
    
    // Clear any flying target since we're using direction-based movement now
    animal.flying_target_x = None;
    animal.flying_target_y = None;
}

/// **FLYING CHASE** - Birds aggressively fly-chase players for food/items
pub fn execute_flying_chase(
    ctx: &ReducerContext,
    animal: &mut WildAnimal,
    stats: &AnimalStats,
    target_x: f32,
    target_y: f32,
    dt: f32,
) {
    // Ensure bird is flying
    animal.is_flying = true;
    
    // Chase at high flying speed
    let chase_speed = stats.sprint_speed * FLYING_SPEED_MULTIPLIER;
    
    // Calculate direction to target
    let dx = target_x - animal.pos_x;
    let dy = target_y - animal.pos_y;
    let distance = (dx * dx + dy * dy).sqrt();
    
    if distance > 10.0 {
        let norm_dx = dx / distance;
        let norm_dy = dy / distance;
        
        let move_amount = chase_speed * dt;
        let new_x = (animal.pos_x + norm_dx * move_amount).clamp(10.0, WORLD_WIDTH_PX - 10.0);
        let new_y = (animal.pos_y + norm_dy * move_amount).clamp(10.0, WORLD_HEIGHT_PX - 10.0);
        
        animal.pos_x = new_x;
        animal.pos_y = new_y;
        animal.direction_x = norm_dx;
        animal.direction_y = norm_dy;
        
        // Update facing direction
        update_facing_direction(animal);
        
        // Update chunk index
        animal.chunk_index = crate::environment::calculate_chunk_index(animal.pos_x, animal.pos_y);
    }
    
    // Clear any flying target since we're chasing
    animal.flying_target_x = None;
    animal.flying_target_y = None;
}

/// Check if a bird is currently flying
pub fn is_bird_flying(animal: &WildAnimal) -> bool {
    animal.is_flying
}

/// Check if a species is a bird that can fly
pub fn is_flying_species(species: &AnimalSpecies) -> bool {
    matches!(species, AnimalSpecies::Tern | AnimalSpecies::Crow | AnimalSpecies::SnowyOwl)
}

/// Update the facing direction string based on direction vector
pub fn update_facing_direction(animal: &mut WildAnimal) {
    if animal.direction_x.abs() > animal.direction_y.abs() {
        // Horizontal movement is dominant
        animal.facing_direction = if animal.direction_x > 0.0 { "right".to_string() } else { "left".to_string() };
    } else {
        // Vertical movement is dominant
        animal.facing_direction = if animal.direction_y > 0.0 { "down".to_string() } else { "up".to_string() };
    }
}

// ============================================================================
// END FLYING BIRD SYSTEM
// ============================================================================

/// **COMMON CHASE DISTANCE CHECKS** - Standard logic for when to stop chasing
pub fn should_stop_chasing(
    animal: &WildAnimal,
    target_player: &Player,
    stats: &AnimalStats,
    behavior: &AnimalBehaviorEnum,
) -> bool {
    let distance = get_player_distance(animal, target_player);
    let chase_abandon_distance = stats.chase_trigger_range * behavior.get_chase_abandonment_multiplier();
    
    distance > chase_abandon_distance
}

/// **COMMON STATE TIMEOUT CHECKER** - Handles time-based state transitions
pub fn check_state_timeout(
    animal: &WildAnimal,
    current_time: Timestamp,
    timeout_ms: i64,
) -> bool {
    let time_in_state = (current_time.to_micros_since_unix_epoch() - 
                        animal.state_change_time.to_micros_since_unix_epoch()) / 1000;
    time_in_state > timeout_ms
}

/// **COMMON PLAYER HEALTH ASSESSMENT** - Evaluate player health for decision making
pub fn assess_player_threat_level(player: &Player) -> PlayerThreatLevel {
    let health_percent = player.health / crate::player_stats::PLAYER_MAX_HEALTH;
    
    if health_percent >= 0.7 {
        PlayerThreatLevel::Healthy
    } else if health_percent >= 0.4 {
        PlayerThreatLevel::Moderate
    } else if health_percent >= 0.15 {
        PlayerThreatLevel::Weak
    } else {
        PlayerThreatLevel::Critical
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum PlayerThreatLevel {
    Healthy,    // 70%+ health - dangerous to attack
    Moderate,   // 40-70% health - moderate threat
    Weak,       // 15-40% health - good target for opportunistic animals
    Critical,   // <15% health - easy target
}

/// **COMMON ATTACK AFTERMATH LOGIC** - Handle common post-attack behaviors
pub fn handle_attack_aftermath(
    animal: &mut WildAnimal,
    target_player: &Player,
    current_time: Timestamp,
    rng: &mut impl Rng,
) {
    match animal.species {
        AnimalSpecies::CinderFox => {
            // Fox hit-and-run behavior based on target health
            let threat_level = assess_player_threat_level(target_player);
            
            if matches!(threat_level, PlayerThreatLevel::Healthy | PlayerThreatLevel::Moderate) {
                // Healthy target - flee after attack
                set_flee_destination_away_from_threat(animal, target_player.position_x, target_player.position_y, 320.0, rng);
                transition_to_state(animal, AnimalState::Fleeing, current_time, None, "hit and run");
                
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
                
                log::info!("Cinder Fox {} hit-and-run on healthy target - fleeing", animal.id);
            } else {
                // Weak target - stay aggressive
                transition_to_state(animal, AnimalState::Chasing, current_time, Some(target_player.identity), "continue assault");
                log::info!("Cinder Fox {} continues assault on weak target", animal.id);
            }
        },
        
        AnimalSpecies::TundraWolf => {
            // Wolves sometimes get double strikes or become more aggressive
            if rng.gen::<f32>() < 0.3 {
                animal.last_attack_time = None; // Reset for immediate second strike
                log::info!("Tundra Wolf {} enters blood rage - double strike ready!", animal.id);
            }
        },
        
        AnimalSpecies::CableViper => {
            // Vipers might retreat after venomous strike or continue attacking
            log::info!("Cable Viper {} injected venom - assessing next move", animal.id);
        },
        
        AnimalSpecies::ArcticWalrus => {
            // Walruses are relentless once engaged - no special behavior, just keep attacking
            log::info!("Arctic Walrus {} delivered crushing blow - remaining aggressive", animal.id);
        },
        
        AnimalSpecies::BeachCrab => {
            // Crabs are simple - they pinch and continue attacking
            log::info!("Beach Crab {} delivered pinch attack - continuing defense", animal.id);
        },
        
        AnimalSpecies::Tern => {
            // Terns are scavengers - they peck and then fly away
            set_flee_destination_away_from_threat(animal, target_player.position_x, target_player.position_y, 200.0, rng);
            transition_to_state(animal, AnimalState::Flying, current_time, None, "tern fly away");
            animal.is_flying = true;
            log::info!("Tern {} pecked and flew away", animal.id);
        },
        
        AnimalSpecies::Crow => {
            // Crows are opportunistic - they steal/peck and then fly away
            set_flee_destination_away_from_threat(animal, target_player.position_x, target_player.position_y, 250.0, rng);
            transition_to_state(animal, AnimalState::Flying, current_time, None, "crow fly away");
            animal.is_flying = true;
            log::info!("Crow {} attacked and flew away", animal.id);
        },
        
        AnimalSpecies::Vole => {
            // Voles immediately flee after any attack - they're tiny and skittish
            set_flee_destination_away_from_threat(animal, target_player.position_x, target_player.position_y, 300.0, rng);
            transition_to_state(animal, AnimalState::Fleeing, current_time, None, "vole flee after attack");
            log::info!("Vole {} squeaked and fled after attack", animal.id);
        },
        
        AnimalSpecies::Wolverine => {
            // Wolverines are FEARLESS - continue attacking relentlessly
            transition_to_state(animal, AnimalState::Chasing, current_time, Some(target_player.identity), "wolverine fury");
            log::info!("Wolverine {} continues ferocious assault", animal.id);
        },
        
        AnimalSpecies::Caribou => {
            // Caribou flee after attacking (they only attack when low health/cornered)
            let caribou_max_health = 120.0; // Caribou max health (reduced for balanced hunting)
            let health_percent = animal.health / caribou_max_health;
            if health_percent < 0.25 {
                // Very low health - continue desperate fight
                transition_to_state(animal, AnimalState::Chasing, current_time, Some(target_player.identity), "caribou desperate fight");
                log::info!("Caribou {} continues desperate fight at low health", animal.id);
            } else {
                // After attack, flee
                set_flee_destination_away_from_threat(animal, target_player.position_x, target_player.position_y, 500.0, rng);
                transition_to_state(animal, AnimalState::Fleeing, current_time, None, "caribou flee after attack");
                log::info!("Caribou {} attacked and fled", animal.id);
            }
        },
        
        AnimalSpecies::SalmonShark => {
            // Salmon Sharks are persistent predators - continue aggressive pursuit
            transition_to_state(animal, AnimalState::SwimmingChase, current_time, Some(target_player.identity), "shark pursuit");
            log::info!("Salmon Shark {} delivered devastating bite - continuing pursuit", animal.id);
        },
        
        AnimalSpecies::Jellyfish => {
            // Jellyfish are passive - they don't chase, just continue drifting
            transition_to_state(animal, AnimalState::Drifting, current_time, None, "jellyfish passive");
            log::info!("Jellyfish {} continues passive drift", animal.id);
        },
        
        // Hostile NPCs - continue attacking aggressively
        AnimalSpecies::Shorebound => {
            // Shorebound stalkers continue pressuring after attack
            transition_to_state(animal, AnimalState::Chasing, current_time, Some(target_player.identity), "shorebound pursuit");
            log::info!("Shorebound {} continues stalking after attack", animal.id);
        },
        AnimalSpecies::Shardkin => {
            // Shardkin swarmers are relentless - continue attack immediately
            transition_to_state(animal, AnimalState::Chasing, current_time, Some(target_player.identity), "shardkin swarm");
            log::info!("Shardkin {} continues swarming after attack", animal.id);
        },
        AnimalSpecies::DrownedWatch => {
            // Drowned Watch brutes are slow but relentless
            transition_to_state(animal, AnimalState::Chasing, current_time, Some(target_player.identity), "brute assault");
            log::info!("Drowned Watch {} delivered heavy blow - continuing assault", animal.id);
        },
        AnimalSpecies::Bee => {
            // Bees keep stinging relentlessly
            transition_to_state(animal, AnimalState::Chasing, current_time, Some(target_player.identity), "bee swarm attack");
            log::debug!("Bee {} stung - continuing attack", animal.id);
        },
        // Alpine animals
        AnimalSpecies::PolarBear => {
            // Polar bears are relentless apex predators - continue attacking
            transition_to_state(animal, AnimalState::Chasing, current_time, Some(target_player.identity), "polar bear fury");
            log::info!("Polar Bear {} continues ferocious assault", animal.id);
        },
        AnimalSpecies::Hare => {
            // Hares immediately flee after any attack - they're tiny and skittish
            set_flee_destination_away_from_threat(animal, target_player.position_x, target_player.position_y, 400.0, rng);
            transition_to_state(animal, AnimalState::Fleeing, current_time, None, "hare flee after attack");
            log::info!("Hare {} squeaked and fled after attack", animal.id);
        },
        AnimalSpecies::SnowyOwl => {
            // Snowy owls are aggressive but tactical - they fly and swoop
            set_flee_destination_away_from_threat(animal, target_player.position_x, target_player.position_y, 150.0, rng);
            transition_to_state(animal, AnimalState::Flying, current_time, Some(target_player.identity), "owl swooping");
            animal.is_flying = true;
            log::info!("Snowy Owl {} swooped and repositioning", animal.id);
        },
    }
}

/// **COMMON CHASE STATE HANDLER** - Standardized chase behavior
pub fn handle_chase_state(
    ctx: &ReducerContext,
    animal: &mut WildAnimal,
    stats: &AnimalStats,
    current_time: Timestamp,
) -> Result<(), String> {
    if let Some(target_id) = animal.target_player_id {
        if let Some(target_player) = ctx.db.player().identity().find(&target_id) {
            // Check if should stop chasing based on distance
            let behavior = animal.species.get_behavior();
            if should_stop_chasing(animal, &target_player, stats, &behavior) {
                // PERFORMANCE: Go to Idle instead of Patrolling - animal stops until player nearby
                transition_to_state(animal, AnimalState::Idle, current_time, None, "player escaped");
                log::debug!("{:?} {} stopping chase - going idle", animal.species, animal.id);
                return Ok(());
            }
        } else {
            // Target lost - go idle instead of wandering
            transition_to_state(animal, AnimalState::Idle, current_time, None, "target lost");
        }
    }
    Ok(())
}

/// **COMMON DAMAGE RESPONSE HANDLER** - Standard health-based reactions  
pub fn handle_standard_damage_response(
    animal: &mut WildAnimal,
    attacker: &Player,
    stats: &AnimalStats,
    current_time: Timestamp,
    rng: &mut impl Rng,
) {
    let health_percent = animal.health / stats.max_health;
    
    // Check if should flee due to low health
    if health_percent < stats.flee_trigger_health_percent {
        set_flee_destination_away_from_threat(animal, attacker.position_x, attacker.position_y, 400.0, rng);
        transition_to_state(animal, AnimalState::Fleeing, current_time, None, "low health flee");
        
        log::info!("{:?} {} fleeing due to injury ({:.1}% health)", 
                  animal.species, animal.id, health_percent * 100.0);
    } else {
        // Species-specific damage responses
        match animal.species {
            AnimalSpecies::CinderFox => {
                let threat_level = assess_player_threat_level(attacker);
                
                if matches!(threat_level, PlayerThreatLevel::Healthy | PlayerThreatLevel::Moderate) {
                    // Healthy attacker - flee
                    set_flee_destination_away_from_threat(animal, attacker.position_x, attacker.position_y, 320.0, rng);
                    transition_to_state(animal, AnimalState::Fleeing, current_time, None, "healthy attacker");
                } else {
                    // Weak attacker - become aggressive
                    transition_to_state(animal, AnimalState::Chasing, current_time, Some(attacker.identity), "weak attacker");
                }
            },
            
            AnimalSpecies::TundraWolf => {
                // Wolves rarely flee - become more aggressive when hit
                if health_percent > 0.3 {
                    transition_to_state(animal, AnimalState::Chasing, current_time, Some(attacker.identity), "retaliation");
                    log::info!("Tundra Wolf {} retaliating against attacker", animal.id);
                }
            },
            
            AnimalSpecies::CableViper => {
                // Vipers might enter defensive mode or continue attacking
                log::info!("Cable Viper {} damaged - entering defensive posture", animal.id);
            },
            
            AnimalSpecies::ArcticWalrus => {
                // Walruses are relentless once engaged - no special behavior, just keep attacking
                log::info!("Arctic Walrus {} delivered crushing blow - remaining aggressive", animal.id);
            },
            
            AnimalSpecies::BeachCrab => {
                // Crabs retaliate when attacked - simple defensive behavior
                transition_to_state(animal, AnimalState::Chasing, current_time, Some(attacker.identity), "crab retaliation");
                log::info!("Beach Crab {} retaliating against attacker", animal.id);
            },
            
            AnimalSpecies::Tern => {
                // Terns always flee when damaged - fly away
                set_flee_destination_away_from_threat(animal, attacker.position_x, attacker.position_y, 500.0, rng);
                transition_to_state(animal, AnimalState::Flying, current_time, None, "tern flee damage");
                animal.is_flying = true;
                log::info!("Tern {} flying away after damage", animal.id);
            },
            
            AnimalSpecies::Crow => {
                // Crows flee when damaged but may drop stolen items
                set_flee_destination_away_from_threat(animal, attacker.position_x, attacker.position_y, 400.0, rng);
                transition_to_state(animal, AnimalState::Flying, current_time, None, "crow flee damage");
                animal.is_flying = true;
                log::info!("Crow {} flying away after damage", animal.id);
            },
            
            AnimalSpecies::Vole => {
                // Voles always flee when damaged - tiny and skittish
                set_flee_destination_away_from_threat(animal, attacker.position_x, attacker.position_y, 400.0, rng);
                transition_to_state(animal, AnimalState::Fleeing, current_time, None, "vole flee damage");
                log::info!("Vole {} fleeing in panic after damage", animal.id);
            },
            
            AnimalSpecies::Wolverine => {
                // Wolverines NEVER flee - they become MORE aggressive when damaged
                transition_to_state(animal, AnimalState::Chasing, current_time, Some(attacker.identity), "wolverine rage");
                log::info!("Wolverine {} enters rage mode after damage - attacking relentlessly!", animal.id);
            },
            
            AnimalSpecies::Caribou => {
                // Caribou behavior depends on health - flee normally, fight when cornered
                let health_percent = animal.health / stats.max_health;
                if health_percent < 0.30 {
                    // Low health - cornered caribou fights back
                    transition_to_state(animal, AnimalState::Chasing, current_time, Some(attacker.identity), "caribou cornered");
                    log::info!("Caribou {} cornered at low health - fighting back!", animal.id);
                } else {
                    // Healthy - flee from threat
                    set_flee_destination_away_from_threat(animal, attacker.position_x, attacker.position_y, 500.0, rng);
                    transition_to_state(animal, AnimalState::Fleeing, current_time, None, "caribou flee damage");
                    log::info!("Caribou {} fleeing after damage", animal.id);
                }
            },
            
            AnimalSpecies::SalmonShark => {
                // Salmon Sharks NEVER flee - chase attacker (underwater or surface)
                // Primary handler is SalmonSharkBehavior::handle_damage_response
                transition_to_state(animal, AnimalState::SwimmingChase, current_time, Some(attacker.identity), "shark enraged");
                log::info!("Salmon Shark {} ENRAGED by attacker - aggressive pursuit!", animal.id);
            },
            
            AnimalSpecies::Jellyfish => {
                // Jellyfish are passive - they don't flee or attack, just emit defensive shock
                // Damage response is handled in JellyfishBehavior::handle_damage_response
                transition_to_state(animal, AnimalState::Drifting, current_time, None, "jellyfish defensive shock");
                log::info!("Jellyfish {} damaged - emitting defensive shock", animal.id);
            },
            
            // Hostile NPCs don't flee when damaged - they become more aggressive
            AnimalSpecies::Shorebound => {
                // Shorebound stalkers retaliate when hit
                transition_to_state(animal, AnimalState::Chasing, current_time, Some(attacker.identity), "shorebound retaliation");
                log::info!("Shorebound {} retaliating against attacker", animal.id);
            },
            AnimalSpecies::Shardkin => {
                // Shardkin swarmers are relentless
                transition_to_state(animal, AnimalState::Chasing, current_time, Some(attacker.identity), "shardkin retaliation");
                log::info!("Shardkin {} swarming attacker", animal.id);
            },
            AnimalSpecies::DrownedWatch => {
                // Drowned Watch brutes are unfazed by damage
                transition_to_state(animal, AnimalState::Chasing, current_time, Some(attacker.identity), "brute retaliation");
                log::info!("Drowned Watch {} unfazed by damage - continuing assault", animal.id);
            },
            AnimalSpecies::Bee => {
                // Bees are immune to normal damage - handled in BeeBehavior
                // If this somehow gets called, they just keep attacking
                transition_to_state(animal, AnimalState::Chasing, current_time, Some(attacker.identity), "bee enraged");
                log::debug!("Bee {} enraged by attack attempt", animal.id);
            },
            // Alpine animals
            AnimalSpecies::PolarBear => {
                // Polar bears NEVER flee - they become MORE aggressive when damaged
                transition_to_state(animal, AnimalState::Chasing, current_time, Some(attacker.identity), "polar bear rage");
                log::info!("Polar Bear {} enters rage mode after damage - attacking relentlessly!", animal.id);
            },
            AnimalSpecies::Hare => {
                // Hares always flee when damaged - tiny and skittish
                set_flee_destination_away_from_threat(animal, attacker.position_x, attacker.position_y, 400.0, rng);
                transition_to_state(animal, AnimalState::Fleeing, current_time, None, "hare flee damage");
                log::info!("Hare {} fleeing in panic after damage", animal.id);
            },
            AnimalSpecies::SnowyOwl => {
                // Snowy owls fly away when damaged but remain aggressive
                set_flee_destination_away_from_threat(animal, attacker.position_x, attacker.position_y, 300.0, rng);
                transition_to_state(animal, AnimalState::Flying, current_time, Some(attacker.identity), "owl flee damage");
                animal.is_flying = true;
                log::info!("Snowy Owl {} flying away after damage", animal.id);
            },
        }
    }
}

// --- TAMING SYSTEM FUNCTIONS ---

/// Types of threats that can threaten a tamed animal's owner
#[derive(Debug, Clone)]
pub enum ThreatType {
    Player(Identity),
    WildAnimal(u64), // animal id
}

/// Efficiently detect all threats (players and wild animals) to the owner within protection range
/// This function can be used by any tamed animal species to protect their owner
pub fn detect_threats_to_owner(
    ctx: &ReducerContext, 
    protecting_animal: &WildAnimal, 
    owner: &Player
) -> Vec<ThreatType> {
    let mut threats = Vec::new();
    
    // Check player threats
    for player in ctx.db.player().iter() {
        if player.identity == owner.identity || player.is_dead || !player.is_online { 
            continue; 
        }
        
        let distance_to_owner = get_distance_squared(player.position_x, player.position_y, owner.position_x, owner.position_y).sqrt();
        let distance_to_protector = get_player_distance(protecting_animal, &player);
        
        // Player is a threat if they're close to owner and within protector's range
        if distance_to_owner <= 150.0 && distance_to_protector <= TAMING_PROTECT_RADIUS {
            threats.push(ThreatType::Player(player.identity));
        }
    }
    
    // Check wild animal threats
    for animal in ctx.db.wild_animal().iter() {
        if animal.id == protecting_animal.id { 
            continue; // Skip self
        }
        
        // Skip animals tamed by the same owner
        if let Some(other_tamed_by) = animal.tamed_by {
            if other_tamed_by == owner.identity {
                continue;
            }
        }
        
        // Only consider animals that are actively threatening the owner
        if let Some(target_id) = animal.target_player_id {
            if target_id == owner.identity && matches!(animal.state, AnimalState::Chasing | AnimalState::Attacking) {
                let distance_to_protector = ((protecting_animal.pos_x - animal.pos_x).powi(2) + 
                                            (protecting_animal.pos_y - animal.pos_y).powi(2)).sqrt();
                
                if distance_to_protector <= TAMING_PROTECT_RADIUS {
                    threats.push(ThreatType::WildAnimal(animal.id));
                }
            }
        }
    }
    
    threats
}

/// Find the closest threat from a list of threats
pub fn find_closest_threat(
    ctx: &ReducerContext,
    protecting_animal: &WildAnimal,
    threats: Vec<ThreatType>
) -> Option<ThreatType> {
    threats.into_iter().min_by(|a, b| {
        let dist_a = match a {
            ThreatType::Player(id) => {
                ctx.db.player().identity().find(id)
                    .map(|p| get_player_distance(protecting_animal, &p))
                    .unwrap_or(f32::MAX)
            },
            ThreatType::WildAnimal(id) => {
                ctx.db.wild_animal().id().find(id)
                    .map(|w| ((protecting_animal.pos_x - w.pos_x).powi(2) + 
                              (protecting_animal.pos_y - w.pos_y).powi(2)).sqrt())
                    .unwrap_or(f32::MAX)
            }
        };
        let dist_b = match b {
            ThreatType::Player(id) => {
                ctx.db.player().identity().find(id)
                    .map(|p| get_player_distance(protecting_animal, &p))
                    .unwrap_or(f32::MAX)
            },
            ThreatType::WildAnimal(id) => {
                ctx.db.wild_animal().id().find(id)
                    .map(|w| ((protecting_animal.pos_x - w.pos_x).powi(2) + 
                              (protecting_animal.pos_y - w.pos_y).powi(2)).sqrt())
                    .unwrap_or(f32::MAX)
            }
        };
        dist_a.partial_cmp(&dist_b).unwrap_or(std::cmp::Ordering::Equal)
    })
}

/// Generic helper function for tamed animals to handle threat targeting
/// Returns the target Identity that should be pursued (either player or effective target for wild animals)
pub fn handle_generic_threat_targeting(
    ctx: &ReducerContext,
    protecting_animal: &mut WildAnimal,
    owner_id: Identity,
    current_time: Timestamp,
) -> Option<Identity> {
    if let Some(owner) = ctx.db.player().identity().find(&owner_id) {
        let threats = detect_threats_to_owner(ctx, protecting_animal, &owner);
        
        if !threats.is_empty() {
            if let Some(closest_threat) = find_closest_threat(ctx, protecting_animal, threats) {
                let target_id = match &closest_threat {
                    ThreatType::Player(id) => *id,
                    ThreatType::WildAnimal(id) => {
                        // For wild animals, we target them but store as a special case
                        // The main AI system will handle this in the chase/attack logic
                        if let Some(threatening_animal) = ctx.db.wild_animal().id().find(id) {
                            // Use the threatening animal's target (our owner) or fallback to owner
                            threatening_animal.target_player_id.unwrap_or(owner_id)
                        } else {
                            owner_id // Fallback
                        }
                    }
                };
                
                transition_to_state(protecting_animal, AnimalState::Protecting, current_time, Some(target_id), "protecting owner from threat");
                
                match closest_threat {
                    ThreatType::Player(id) => {
                        log::info!("🛡️ Tamed {:?} {} protecting owner {} from player threat {}", 
                                  protecting_animal.species, protecting_animal.id, owner_id, id);
                    },
                    ThreatType::WildAnimal(id) => {
                        log::info!("🛡️ Tamed {:?} {} protecting owner {} from wild animal threat {}", 
                                  protecting_animal.species, protecting_animal.id, owner_id, id);
                    }
                }
                
                return Some(target_id);
            }
        }
    }
    
    None // No threats found
}

/// Check if an item is valid taming food for the given animal species
pub fn is_valid_taming_food(ctx: &ReducerContext, item_def_id: u64, species: AnimalSpecies) -> bool {
    if let Some(item_def) = ctx.db.item_definition().id().find(item_def_id) {
        let behavior = species.get_behavior();
        if !behavior.can_be_tamed() {
            return false;
        }
        
        let taming_foods = behavior.get_taming_foods();
        taming_foods.contains(&item_def.name.as_str())
    } else {
        false
    }
}

/// Find nearby dropped food items that this animal can eat
pub fn find_nearby_taming_food(ctx: &ReducerContext, animal: &WildAnimal) -> Vec<crate::dropped_item::DroppedItem> {
    let mut nearby_food = Vec::new();
    let behavior = animal.species.get_behavior();
    let taming_foods = behavior.get_taming_foods();
    let valid_food_ids: HashSet<u64> = ctx.db.item_definition()
        .iter()
        .filter(|def| taming_foods.contains(&def.name.as_str()))
        .map(|def| def.id)
        .collect();
    
    for dropped_item in ctx.db.dropped_item().iter() {
        let distance_sq = get_distance_squared(
            animal.pos_x, animal.pos_y,
            dropped_item.pos_x, dropped_item.pos_y
        );
        
        if distance_sq <= TAMING_FOOD_DETECTION_RADIUS_SQUARED
            && valid_food_ids.contains(&dropped_item.item_def_id)
        {
            nearby_food.push(dropped_item);
        }
    }
    
    nearby_food
}

/// Handle an animal eating food and potentially becoming tamed
pub fn handle_animal_eat_food(
    ctx: &ReducerContext,
    animal: &mut WildAnimal,
    dropped_item: &crate::dropped_item::DroppedItem,
    current_time: Timestamp,
) -> Result<bool, String> {
    // Find the player who dropped this food (closest player)
    let mut closest_player: Option<Player> = None;
    let mut closest_distance = f32::MAX;
    
    for player in ctx.db.player().iter() {
        if player.is_dead { continue; }
        
        let distance = get_distance_squared(
            dropped_item.pos_x, dropped_item.pos_y,
            player.position_x, player.position_y
        ).sqrt();
        
        if distance < closest_distance && distance <= 200.0 { // Must be within 200px when food was dropped
            closest_distance = distance;
            closest_player = Some(player);
        }
    }
    
    if let Some(tamer) = closest_player {
        // Animal becomes tamed by this player
        animal.tamed_by = Some(tamer.identity);
        animal.tamed_at = Some(current_time);
        animal.heart_effect_until = Some(Timestamp::from_micros_since_unix_epoch(
            current_time.to_micros_since_unix_epoch() + (TAMING_HEART_EFFECT_DURATION_MS * 1000) as i64
        ));
        
        // Change to following state
        transition_to_state(animal, AnimalState::Following, current_time, Some(tamer.identity), "tamed by food");
        
        // Clear any aggressive states
        animal.fire_fear_overridden_by = None;
        
        // Remove the dropped item from the world
        ctx.db.dropped_item().id().delete(dropped_item.id);
        
        // Emit eating sound
        emit_species_sound(ctx, animal, tamer.identity, "eating");
        
        // Emit heart effect (this would be handled client-side based on heart_effect_until field)
        // For now we'll just log it
        log::info!("💖 {:?} {} has been tamed by player {} after eating {}! Hearts appearing for {}ms", 
                  animal.species, animal.id, tamer.identity, dropped_item.item_def_id, TAMING_HEART_EFFECT_DURATION_MS);
        
        // Track walrus taming achievement specifically
        if animal.species == AnimalSpecies::ArcticWalrus {
            if let Err(e) = crate::player_progression::track_stat_and_check_achievements(ctx, tamer.identity, "walrus_tamed", 1) {
                log::error!("Failed to track walrus taming stat: {}", e);
            }
        }
        
        Ok(true) // Successfully tamed
    } else {
        // No suitable player found - just eat the food without taming
        ctx.db.dropped_item().id().delete(dropped_item.id);
        log::info!("{:?} {} ate food but no player nearby to become tamed", animal.species, animal.id);
        Ok(false) // Ate food but not tamed
    }
}

/// Process taming behavior - check for food and handle eating
pub fn process_taming_behavior(
    ctx: &ReducerContext,
    animal: &mut WildAnimal,
    current_time: Timestamp,
) -> Result<(), String> {
    // Only check for food periodically to avoid performance issues
    if let Some(last_check) = animal.last_food_check {
        let time_since_check = (current_time.to_micros_since_unix_epoch() - last_check.to_micros_since_unix_epoch()) / 1000;
        if time_since_check < TAMING_FOOD_CHECK_INTERVAL_MS {
            return Ok(());
        }
    }
    
    animal.last_food_check = Some(current_time);
    
    // Don't process taming if already tamed
    if animal.tamed_by.is_some() {
        return Ok(());
    }
    
    // Check if this species can be tamed using the trait method
    let behavior = animal.species.get_behavior();
    if !behavior.can_be_tamed() {
        return Ok(());
    }
    
    // Look for nearby food
    let nearby_food = find_nearby_taming_food(ctx, animal);
    
    if let Some(food_item) = nearby_food.first() {
        // Move towards the food if not already next to it
        let distance_to_food = get_distance_squared(
            animal.pos_x, animal.pos_y,
            food_item.pos_x, food_item.pos_y
        ).sqrt();
        
        if distance_to_food > 30.0 {
            // Move towards food
            transition_to_state(animal, AnimalState::Investigating, current_time, None, "approaching food");
            animal.investigation_x = Some(food_item.pos_x);
            animal.investigation_y = Some(food_item.pos_y);
        } else {
            // Close enough to eat
            handle_animal_eat_food(ctx, animal, food_item, current_time)?;
        }
    }
    
    Ok(())
}

/// Handle following behavior for tamed animals
/// TAMING IS PERMANENT - animals never become wild again once tamed
/// Behavior:
/// - If owner is nearby (within TAMING_STAY_DISTANCE), follow them
/// - If owner is far away (beyond TAMING_STAY_DISTANCE), stay in place (allows penning)
/// - If owner is dead/offline/not found, stay in place and wait
pub fn handle_tamed_following(
    ctx: &ReducerContext,
    animal: &mut WildAnimal,
    stats: &AnimalStats,
    current_time: Timestamp,
    dt: f32,
    rng: &mut impl Rng, // Add rng parameter
) {
    if let Some(owner_id) = animal.tamed_by {
        if let Some(owner) = ctx.db.player().identity().find(&owner_id) {
            // If owner is dead or offline, just stay in place and wait
            // TAMING IS PERMANENT - we don't untame, we just wait
            if owner.is_dead || !owner.is_online {
                // Stay in place - do nothing, just wait for owner to return/respawn
                return;
            }
            
            let distance_to_owner = get_distance_squared(
                animal.pos_x, animal.pos_y,
                owner.position_x, owner.position_y
            );
            
            // If owner is beyond the stay distance, animal stays in place (penning behavior)
            // This allows players to pen animals without them following across the map
            if distance_to_owner > TAMING_STAY_DISTANCE_SQUARED {
                // Stay in place - don't follow, just idle nearby
                // Small chance to wander within a tiny area to look alive
                if rng.gen::<f32>() < 0.02 { // 2% chance to shift slightly
                    let angle = rng.gen::<f32>() * 2.0 * PI;
                    let wander_distance = 15.0;
                    let target_x = animal.pos_x + angle.cos() * wander_distance;
                    let target_y = animal.pos_y + angle.sin() * wander_distance;
                    move_towards_target(ctx, animal, target_x, target_y, stats.movement_speed * 0.3, dt);
                }
                return;
            }
            
            // Owner is within follow range - check for threats and follow
            
            // Check if anyone is attacking the owner
            let mut attacker: Option<Player> = None;
            for player in ctx.db.player().iter() {
                if player.identity != owner_id && !player.is_dead {
                    let distance_to_potential_threat = get_distance_squared(
                        owner.position_x, owner.position_y,
                        player.position_x, player.position_y
                    );
                    
                    // If another player is very close to owner, consider them a threat
                    if distance_to_potential_threat <= 10000.0 { // 100px
                        attacker = Some(player);
                        break;
                    }
                }
            }
            
            // Check if we should protect owner
            if let Some(threat) = attacker {
                let distance_to_threat = get_distance_squared(
                    animal.pos_x, animal.pos_y,
                    threat.position_x, threat.position_y
                );
                
                if distance_to_threat <= TAMING_PROTECT_RADIUS_SQUARED {
                    transition_to_state(animal, AnimalState::Protecting, current_time, Some(threat.identity), "protecting owner");
                    log::info!("{:?} {} protecting owner {} from threat {}", 
                              animal.species, animal.id, owner_id, threat.identity);
                }
            } else if distance_to_owner > TAMING_FOLLOW_DISTANCE_SQUARED {
                // Within stay distance but beyond follow distance - move closer
                move_towards_target(ctx, animal, owner.position_x, owner.position_y, stats.movement_speed * 1.2, dt);
            } else {
                // Close enough to owner - just chill nearby
                // Maybe wander slightly but stay close
                if rng.gen::<f32>() < 0.05 { // 5% chance to adjust position slightly
                    let angle = rng.gen::<f32>() * 2.0 * PI;
                    let wander_distance = 20.0;
                    let target_x = owner.position_x + angle.cos() * wander_distance;
                    let target_y = owner.position_y + angle.sin() * wander_distance;
                    move_towards_target(ctx, animal, target_x, target_y, stats.movement_speed * 0.5, dt);
                }
            }
        } else {
            // Owner not found in database (possibly deleted account) - stay in place
            // TAMING IS PERMANENT - we don't untame, we just wait
            // Animal will idle in place indefinitely
            return;
        }
    }
}

/// Handle protecting behavior for tamed animals
pub fn handle_tamed_protecting(
    ctx: &ReducerContext,
    animal: &mut WildAnimal,
    stats: &AnimalStats,
    current_time: Timestamp,
    dt: f32,
    rng: &mut impl Rng, // Add rng parameter
) {
    // Only protect if we have an owner
    let owner_id = match animal.tamed_by {
        Some(id) => id,
        None => return,
    };
    
    // Find the owner
    let owner = match ctx.db.player().identity().find(&owner_id) {
        Some(player) => player,
        None => {
            // Owner not found - TAMING IS PERMANENT, just stop protecting and go back to following (waiting)
            log::debug!("Tamed animal {} owner {} not found - returning to following state", animal.id, owner_id);
            transition_to_state(animal, AnimalState::Following, current_time, Some(owner_id), "owner not found - return to waiting");
            return;
        }
    };
    
    // If owner is dead or offline, stop protecting and wait
    if owner.is_dead || !owner.is_online {
        transition_to_state(animal, AnimalState::Following, current_time, Some(owner_id), "owner dead/offline - stop protecting");
        return;
    }
    
    // Find threats to the owner (wild animals and players attacking the owner)
    let mut animal_threats = Vec::new();
    let mut player_threats = Vec::new();
    
    // Check for wild animals that might be threats (untamed or tamed by others)
    for other_animal in ctx.db.wild_animal().iter() {
        if other_animal.id == animal.id {
            continue;
        }
        
        // Skip animals tamed by the same owner
        if let Some(other_tamed_by) = other_animal.tamed_by {
            if other_tamed_by == owner_id {
                continue;
            }
        }
        
        // Check if this animal is within protection radius and potentially hostile
        let distance_to_threat = get_distance_squared(
            animal.pos_x, animal.pos_y,
            other_animal.pos_x, other_animal.pos_y
        );
        
        if distance_to_threat <= TAMING_PROTECT_RADIUS_SQUARED {
            // Check if this animal is actively hostile (chasing/attacking the owner or close enough to be a threat)
            let distance_to_owner = get_distance_squared(
                other_animal.pos_x, other_animal.pos_y,
                owner.position_x, owner.position_y
            );
            
            // Consider as threat if:
            // 1. Animal is targeting our owner specifically
            // 2. Animal is very close to owner (within attack range + buffer)
            // 3. Animal is in aggressive state and near owner
            let is_targeting_owner = other_animal.target_player_id == Some(owner_id);
            let is_close_to_owner = distance_to_owner <= (stats.attack_range + 50.0) * (stats.attack_range + 50.0);
            let is_aggressive_near_owner = matches!(other_animal.state, AnimalState::Chasing | AnimalState::Attacking) && distance_to_owner <= 400.0;
            
            if is_targeting_owner || is_close_to_owner || is_aggressive_near_owner {
                log::debug!("🛡️ [THREAT DETECTED] Tamed {:?} {} identified {:?} {} as threat to owner {}", 
                           animal.species, animal.id, 
                           other_animal.species, other_animal.id, owner_id);
                animal_threats.push(other_animal);
            }
        }
    }
    
    // Check for player threats (players very close to owner and potentially hostile)
    for other_player in ctx.db.player().iter() {
        if other_player.identity == owner_id || other_player.is_dead || !other_player.is_online {
            continue;
        }
        
        let distance_to_player = get_distance_squared(
            animal.pos_x, animal.pos_y,
            other_player.position_x, other_player.position_y
        );
        
        if distance_to_player <= TAMING_PROTECT_RADIUS_SQUARED {
            let distance_to_owner = get_distance_squared(
                other_player.position_x, other_player.position_y,
                owner.position_x, owner.position_y
            );
            
            // Consider player a threat if very close to owner (within 100px)
            if distance_to_owner <= 10000.0 { // 100px squared
                log::debug!("🛡️ [PLAYER THREAT] Tamed {:?} {} identified player {} as threat to owner {}", 
                           animal.species, animal.id, other_player.identity, owner_id);
                player_threats.push(other_player);
            }
        }
    }
    
    // Prioritize animal threats first (easier to handle), then player threats
    if let Some(threat_animal) = animal_threats.first() {
        // Handle animal vs animal combat
        let distance_to_threat = get_distance_squared(
            animal.pos_x, animal.pos_y,
            threat_animal.pos_x, threat_animal.pos_y
        );
        
        if distance_to_threat <= stats.attack_range * stats.attack_range {
            // Attack the threat animal if we can
            if can_attack(animal, current_time, stats) {
                // Use our new animal vs animal damage function
                let damage_to_deal = stats.attack_damage;
                
                match damage_wild_animal_by_animal(ctx, threat_animal.id, damage_to_deal, animal.id, current_time) {
                    Ok(target_died) => {
                        log::info!("🛡️ [PROTECTION ATTACK] Tamed {:?} {} dealt {:.1} damage to threat {:?} {} ({})", 
                                  animal.species, animal.id, damage_to_deal,
                                  threat_animal.species, threat_animal.id,
                                  if target_died { "KILLED" } else { "WOUNDED" });
                        
                        // If we killed the threat, check for more threats or return to following
                        if target_died {
                            if animal_threats.len() <= 1 && player_threats.is_empty() {
                                transition_to_state(animal, AnimalState::Following, current_time, Some(owner_id), "threat eliminated - return to following");
                            }
                        }
                    }
                    Err(e) => {
                        log::error!("🛡️ [PROTECTION ERROR] Tamed {:?} {} failed to attack threat {}: {}", 
                                   animal.species, animal.id, threat_animal.id, e);
                    }
                }
                
                animal.last_attack_time = Some(current_time);
            }
        } else {
            // Move toward the threat
            move_towards_target(ctx, animal, threat_animal.pos_x, threat_animal.pos_y, stats.sprint_speed, dt);
            log::debug!("🛡️ [PROTECTION PURSUIT] Tamed {:?} {} pursuing threat {:?} {} (distance: {:.1}px)", 
                       animal.species, animal.id,
                       threat_animal.species, threat_animal.id,
                       distance_to_threat.sqrt());
        }
    } else if let Some(threat_player) = player_threats.first() {
        // Handle player threats (for future implementation)
        let distance_to_threat = get_distance_squared(
            animal.pos_x, animal.pos_y,
            threat_player.position_x, threat_player.position_y
        );
        
        if distance_to_threat <= stats.attack_range * stats.attack_range {
            // Attack player if in range and we can attack
            if can_attack(animal, current_time, stats) {
                // Set target for main AI loop to handle player attack
                animal.target_player_id = Some(threat_player.identity);
                animal.last_attack_time = Some(current_time);
                log::info!("🛡️ [PROTECTION PLAYER ATTACK] Tamed {:?} {} attacking player threat {}", 
                          animal.species, animal.id, threat_player.identity);
            }
        } else {
            // Move toward the player threat
            move_towards_target(ctx, animal, threat_player.position_x, threat_player.position_y, stats.sprint_speed, dt);
            log::debug!("🛡️ [PROTECTION PLAYER PURSUIT] Tamed {:?} {} pursuing player threat {} (distance: {:.1}px)", 
                       animal.species, animal.id, threat_player.identity, distance_to_threat.sqrt());
        }
    } else {
        // No threats found, return to following the owner
        transition_to_state(animal, AnimalState::Following, current_time, Some(owner_id), "no threats - return to following");
    }
}

/// **COMMON ESCAPE ANGLE CALCULATOR** - Calculate optimal flee direction away from multiple threats
pub fn calculate_escape_angle_from_threats(
    animal_x: f32, 
    animal_y: f32, 
    primary_threat_x: f32, 
    primary_threat_y: f32, 
    secondary_threat_x: f32, 
    secondary_threat_y: f32
) -> f32 {
    // Vector away from primary threat
    let away_from_primary_x = animal_x - primary_threat_x;
    let away_from_primary_y = animal_y - primary_threat_y;
    
    // Vector away from secondary threat
    let away_from_secondary_x = animal_x - secondary_threat_x;
    let away_from_secondary_y = animal_y - secondary_threat_y;
    
    // Combine vectors (weighted more toward escaping primary threat)
    let combined_x = away_from_primary_x * 0.7 + away_from_secondary_x * 0.3;
    let combined_y = away_from_primary_y * 0.7 + away_from_secondary_y * 0.3;
    
    // Calculate angle
    combined_y.atan2(combined_x)
}

/// **COMMON RANGED WEAPON DETECTION** - Check if player has any ranged weapon equipped
/// This is used to determine if NPCs should use ranged attacks (mirror player's combat style)
pub fn player_has_ranged_weapon(ctx: &ReducerContext, player_id: Identity) -> bool {
    // Find the player's active equipment
    let equipment = match ctx.db.active_equipment().player_identity().find(&player_id) {
        Some(eq) => eq,
        None => {
            log::debug!("[RANGED CHECK] No active_equipment found for player {:?}", player_id);
            return false;
        }
    };
    
    // Check if they have an item equipped
    let item_def_id = match equipment.equipped_item_def_id {
        Some(id) => id,
        None => {
            log::debug!("[RANGED CHECK] Player {:?} has no equipped_item_def_id", player_id);
            return false;
        }
    };
    
    // Look up the item definition
    let item_def = match ctx.db.item_definition().id().find(item_def_id) {
        Some(def) => def,
        None => {
            log::debug!("[RANGED CHECK] Item def {} not found for player {:?}", item_def_id, player_id);
            return false;
        }
    };
    
    // Check if it's a ranged weapon by category OR by name
    let is_ranged_category = item_def.category == crate::items::ItemCategory::RangedWeapon;
    let is_known_ranged = matches!(item_def.name.as_str(), 
        "Hunting Bow" | "Crossbow" | 
        "Makarov PM" | "PP-91 KEDR" | 
        "AKS-74U" | "SKS" |
        "Slingshot" | "Blowgun"
    );
    let has_ranged = is_ranged_category || is_known_ranged;
    
    log::debug!("[RANGED CHECK] Player {:?} equipped '{}' (id={}, category={:?}) -> is_ranged={}", 
              player_id, item_def.name, item_def_id, item_def.category, has_ranged);
    
    has_ranged
}

/// **COMMON FIRE TRAP ESCAPE HANDLER** - Generic escape logic for animals trapped by fire + ranged
pub fn handle_fire_trap_escape(
    ctx: &ReducerContext,
    animal: &mut WildAnimal,
    player: &Player,
    current_time: Timestamp,
    rng: &mut impl Rng,
) -> bool {
    if is_animal_trapped_by_fire_and_ranged(ctx, animal, player) {
        // Force flee even for animals that normally don't flee
        transition_to_state(animal, AnimalState::Fleeing, current_time, None, "fire trap escape");
        
        // Calculate escape direction away from BOTH fire AND player
        if let Some((fire_x, fire_y)) = find_closest_fire_position(ctx, animal.pos_x, animal.pos_y) {
            let flee_angle = calculate_escape_angle_from_threats(
                animal.pos_x, animal.pos_y, 
                fire_x, fire_y, 
                player.position_x, player.position_y
            );
            
            // Species-specific flee distances
            let flee_distance = match animal.species {
                AnimalSpecies::TundraWolf => 600.0,    // 12+ tiles
                AnimalSpecies::CinderFox => 640.0,     // Proportional to chase range
                AnimalSpecies::CableViper => 500.0,    // Moderate distance
                AnimalSpecies::ArcticWalrus => 200.0,  // Walruses barely flee
                AnimalSpecies::BeachCrab => 250.0,    // Crabs scuttle away quickly
                AnimalSpecies::Tern => 800.0,         // Birds fly far away
                AnimalSpecies::Crow => 700.0,         // Crows fly away
                AnimalSpecies::Vole => 500.0,         // Voles flee quickly
                AnimalSpecies::Wolverine => 0.0,      // Wolverines don't flee from fire
                AnimalSpecies::Caribou => 550.0,      // Caribou flee quickly from fire
                AnimalSpecies::SalmonShark => 0.0,    // Sharks don't flee from fire traps (water-only)
                AnimalSpecies::Jellyfish => 0.0,     // Jellyfish don't flee from fire traps (water-only)
                // Night hostile NPCs don't flee from fire traps
                AnimalSpecies::Shorebound | AnimalSpecies::Shardkin | AnimalSpecies::DrownedWatch => 0.0,
                // Bees die from fire instead of fleeing
                AnimalSpecies::Bee => 0.0,
                // Alpine animals
                AnimalSpecies::PolarBear => 500.0, // Polar bears flee from fire traps (exception to their fearlessness)
                AnimalSpecies::Hare => 550.0,      // Hares flee far from fire
                AnimalSpecies::SnowyOwl => 600.0,  // Owls fly far from fire
            };
            
            animal.investigation_x = Some(animal.pos_x + flee_distance * flee_angle.cos());
            animal.investigation_y = Some(animal.pos_y + flee_distance * flee_angle.sin());
            
            log::info!("🔥 {:?} {} ESCAPING fire trap! Player {} with ranged weapon detected.", 
                      animal.species, animal.id, player.identity);
            return true; // Fire trap detected and escape initiated
        }
    }
    false // No fire trap detected
}

/// **COMMON UNSTUCK DETECTION** - Detect if animal is stuck and needs direction change
pub fn detect_and_handle_stuck_movement(
    animal: &mut WildAnimal,
    prev_x: f32,
    prev_y: f32,
    movement_threshold: f32,
    rng: &mut impl Rng,
    context: &str,
) -> bool {
    let distance_moved = ((animal.pos_x - prev_x).powi(2) + (animal.pos_y - prev_y).powi(2)).sqrt();
    
    if distance_moved < movement_threshold {
        // Stuck! Pick new random direction
        let new_angle = rng.gen::<f32>() * 2.0 * PI;
        animal.direction_x = new_angle.cos();
        animal.direction_y = new_angle.sin();
        
        log::debug!("{:?} {} stuck during {} - changing direction (moved only {:.1}px)", 
                   animal.species, animal.id, context, distance_moved);
        return true; // Was stuck
    }
    false // Not stuck
}

/// **COMMON CORNERED BEHAVIOR** - Check if animal feels cornered and should attack regardless of normal behavior
pub fn is_animal_cornered(
    animal: &WildAnimal,
    player: &Player,
    cornered_distance: f32,
) -> bool {
    let distance_to_player = get_player_distance(animal, player);
    distance_to_player <= cornered_distance
}

/// **COMMON WATER UNSTUCK LOGIC** - Handle animals getting stuck on water with alternative routing
pub fn handle_water_unstuck(
    ctx: &ReducerContext,
    animal: &mut WildAnimal,
    target_x: f32,
    target_y: f32,
    prev_x: f32,
    prev_y: f32,
    movement_threshold: f32,
    flee_distance: f32,
    rng: &mut impl Rng,
) -> bool {
    let distance_moved = ((animal.pos_x - prev_x).powi(2) + (animal.pos_y - prev_y).powi(2)).sqrt();
    
    if distance_moved < movement_threshold {
        // Check if target is water or if we're hitting water
        let target_is_water = crate::fishing::is_water_tile(ctx, target_x, target_y);
        let current_hitting_water = crate::fishing::is_water_tile(
            ctx, 
            animal.pos_x + (target_x - animal.pos_x).signum() * 50.0, 
            animal.pos_y + (target_y - animal.pos_y).signum() * 50.0
        );
        
        if target_is_water || current_hitting_water {
            log::warn!("{:?} {} got stuck on water! Choosing new route...", animal.species, animal.id);
            
            // Try multiple random directions to find one that's not water
            let mut attempts = 0;
            let mut found_safe_direction = false;
            
            while attempts < 8 && !found_safe_direction {
                let random_angle = rng.gen::<f32>() * 2.0 * PI;
                let new_target_x = animal.pos_x + random_angle.cos() * flee_distance;
                let new_target_y = animal.pos_y + random_angle.sin() * flee_distance;
                
                // Test direction ahead
                let test_x = animal.pos_x + random_angle.cos() * 100.0;
                let test_y = animal.pos_y + random_angle.sin() * 100.0;
                
                if !crate::fishing::is_water_tile(ctx, test_x, test_y) && 
                   !is_position_in_shelter(ctx, test_x, test_y) {
                    // Found safe direction
                    animal.investigation_x = Some(new_target_x);
                    animal.investigation_y = Some(new_target_y);
                    found_safe_direction = true;
                    log::info!("{:?} {} found safe route at angle {:.1}° - heading to ({:.1}, {:.1})", 
                              animal.species, animal.id, random_angle.to_degrees(), new_target_x, new_target_y);
                }
                attempts += 1;
            }
            
            if !found_safe_direction {
                // Last resort: emergency direction
                let emergency_angle = rng.gen::<f32>() * 2.0 * PI;
                animal.investigation_x = Some(animal.pos_x + emergency_angle.cos() * flee_distance);
                animal.investigation_y = Some(animal.pos_y + emergency_angle.sin() * flee_distance);
                log::warn!("{:?} {} using emergency escape route!", animal.species, animal.id);
            }
            
            return true; // Water unstuck was handled
        }
    }
    false // No water collision detected
}

// =============================================================================
// MILKING SYSTEM - Milk tamed female caribou and walruses once per game day
// =============================================================================

/// Milk a tamed animal (caribou or walrus)
/// Requirements:
/// - Animal must be tamed by the caller
/// - Animal must be female
/// - Animal must be adult age
/// - Animal must not have been milked today (resets at dawn each day)
/// - Player must be close enough to the animal
#[spacetimedb::reducer]
pub fn milk_animal(ctx: &ReducerContext, animal_id: u64) -> Result<(), String> {
    // Get the player
    let player = ctx.db.player().identity().find(&ctx.sender())
        .ok_or_else(|| "Player not found".to_string())?;
    
    if player.is_dead {
        return Err("Cannot milk while dead".to_string());
    }
    
    // Get the animal
    let mut animal = ctx.db.wild_animal().id().find(animal_id)
        .ok_or_else(|| "Animal not found".to_string())?;
    
    // Check if animal is tamed by this player
    let tamed_by = animal.tamed_by.ok_or_else(|| "Animal is not tamed".to_string())?;
    if tamed_by != ctx.sender() {
        return Err("You don't own this animal".to_string());
    }
    
    // Check proximity (must be within 100 pixels)
    let distance_sq = get_distance_squared(player.position_x, player.position_y, animal.pos_x, animal.pos_y);
    if distance_sq > 10000.0 { // 100^2
        return Err("Too far from animal to milk".to_string());
    }
    
    // Get current game day from world state
    let world_state = ctx.db.world_state().iter().next()
        .ok_or_else(|| "World state not found".to_string())?;
    let current_day = world_state.cycle_count;
    
    // Handle milking based on species
    match animal.species {
        AnimalSpecies::Caribou => {
            milk_caribou(ctx, &mut animal, current_day, ctx.sender())?;
        }
        AnimalSpecies::ArcticWalrus => {
            milk_walrus(ctx, &mut animal, current_day, ctx.sender())?;
        }
        _ => {
            return Err(format!("{:?} cannot be milked", animal.species));
        }
    }
    
    // Update the animal (in case any state changed)
    ctx.db.wild_animal().id().update(animal);
    
    Ok(())
}

/// Internal function to milk a caribou
fn milk_caribou(ctx: &ReducerContext, animal: &mut WildAnimal, current_day: u32, player_id: Identity) -> Result<(), String> {
    use crate::wild_animal_npc::caribou::{CaribouSex, CaribouAgeStage};
    
    // Get breeding data
    let mut breeding_data = ctx.db.caribou_breeding_data().animal_id().find(animal.id)
        .ok_or_else(|| "Caribou breeding data not found".to_string())?;
    
    // Check if female
    if breeding_data.sex != CaribouSex::Female {
        return Err("Only female caribou can be milked".to_string());
    }
    
    // Check if adult
    if breeding_data.age_stage != CaribouAgeStage::Adult {
        return Err("Only adult caribou can be milked".to_string());
    }
    
    // Check if already milked today
    if let Some(last_milked) = breeding_data.last_milked_day {
        if last_milked >= current_day {
            return Err("This caribou has already been milked today".to_string());
        }
    }
    
    // Update last milked day
    breeding_data.last_milked_day = Some(current_day);
    ctx.db.caribou_breeding_data().animal_id().update(breeding_data);
    
    // Give player milk
    give_milk_to_player(ctx, player_id)?;
    
    log::info!("🥛 Player {} milked caribou {} (day {})", player_id, animal.id, current_day);
    
    Ok(())
}

/// Internal function to milk a walrus
fn milk_walrus(ctx: &ReducerContext, animal: &mut WildAnimal, current_day: u32, player_id: Identity) -> Result<(), String> {
    use crate::wild_animal_npc::walrus::{WalrusSex, WalrusAgeStage};
    
    // Get breeding data
    let mut breeding_data = ctx.db.walrus_breeding_data().animal_id().find(animal.id)
        .ok_or_else(|| "Walrus breeding data not found".to_string())?;
    
    // Check if female
    if breeding_data.sex != WalrusSex::Female {
        return Err("Only female walruses can be milked".to_string());
    }
    
    // Check if adult
    if breeding_data.age_stage != WalrusAgeStage::Adult {
        return Err("Only adult walruses can be milked".to_string());
    }
    
    // Check if already milked today
    if let Some(last_milked) = breeding_data.last_milked_day {
        if last_milked >= current_day {
            return Err("This walrus has already been milked today".to_string());
        }
    }
    
    // Update last milked day
    breeding_data.last_milked_day = Some(current_day);
    ctx.db.walrus_breeding_data().animal_id().update(breeding_data);
    
    // Give player milk
    give_milk_to_player(ctx, player_id)?;
    
    log::info!("🥛 Player {} milked walrus {} (day {})", player_id, animal.id, current_day);
    
    Ok(())
}

/// Helper to give milk item to player
fn give_milk_to_player(ctx: &ReducerContext, player_id: Identity) -> Result<(), String> {
    // Find the Raw Milk item definition
    let milk_def = ctx.db.item_definition().iter()
        .find(|def| def.name == "Raw Milk")
        .ok_or_else(|| "Raw Milk item definition not found".to_string())?;
    
    // Add milk to player's inventory (1 milk per milking)
    crate::items::add_item_to_player_inventory(ctx, player_id, milk_def.id, 1)?;
    
    Ok(())
}

/// Check if an animal is milkable right now
/// Used by client to determine if milking indicator should be shown
pub fn is_animal_milkable(
    animal: &WildAnimal,
    caribou_breeding: Option<&super::caribou::CaribouBreedingData>,
    walrus_breeding: Option<&super::walrus::WalrusBreedingData>,
    current_day: u32,
) -> bool {
    // Must be tamed
    if animal.tamed_by.is_none() {
        return false;
    }
    
    match animal.species {
        AnimalSpecies::Caribou => {
            if let Some(breeding) = caribou_breeding {
                // Must be female adult
                if breeding.sex != super::caribou::CaribouSex::Female {
                    return false;
                }
                if breeding.age_stage != super::caribou::CaribouAgeStage::Adult {
                    return false;
                }
                // Check if not milked today
                match breeding.last_milked_day {
                    None => true, // Never milked
                    Some(last_day) => last_day < current_day, // Milked on a previous day
                }
            } else {
                false
            }
        }
        AnimalSpecies::ArcticWalrus => {
            if let Some(breeding) = walrus_breeding {
                // Must be female adult
                if breeding.sex != super::walrus::WalrusSex::Female {
                    return false;
                }
                if breeding.age_stage != super::walrus::WalrusAgeStage::Adult {
                    return false;
                }
                // Check if not milked today
                match breeding.last_milked_day {
                    None => true, // Never milked
                    Some(last_day) => last_day < current_day, // Milked on a previous day
                }
            } else {
                false
            }
        }
        _ => false, // Other species cannot be milked
    }
}
