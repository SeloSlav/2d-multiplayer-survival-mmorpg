use spacetimedb::{ReducerContext, Timestamp, Table};
use spacetimedb::spacetimedb_lib::{ScheduleAt, TimeDuration};
use rand::Rng;
use log;
use std::time::Duration;

use crate::{TILE_SIZE_PX, WORLD_WIDTH_TILES, WORLD_HEIGHT_TILES};
use crate::environment::{calculate_chunk_index, is_wild_animal_location_suitable, is_position_on_water, is_position_in_central_compound, is_position_in_tide_pool};
use crate::utils::calculate_tile_bounds;
use super::core::{AnimalSpecies, AnimalState, MovementPattern, WildAnimal, AnimalBehavior, init_wild_animal_ai_schedule};
use crate::{MonumentType, monument_part as MonumentPartTableTrait};
use crate::whale_bone_graveyard;
use crate::reed_marsh as ReedMarshTableTrait;
use crate::tide_pool as TidePoolTableTrait;

// Table trait imports
use crate::wild_animal_npc::core::wild_animal;
use crate::tree::tree;
use crate::stone::stone;

// Spawn zone constants - match initial world generation
const WOLF_DEN_ZONE_RADIUS_SQ: f32 = 250.0 * 250.0;   // Wolves spawn 80-180px from den
const WOLF_DEN_TARGET: u32 = 4;
const WOLF_DEN_SPAWN_MIN: f32 = 80.0;
const WOLF_DEN_SPAWN_MAX: f32 = 180.0;

const WOLVERINE_GRAVEYARD_ZONE_RADIUS_SQ: f32 = 900.0 * 900.0;  // Wolverines spawn 400-800px from center
const WOLVERINE_GRAVEYARD_TARGET: u32 = 4;
const WOLVERINE_GRAVEYARD_SPAWN_MIN: f32 = 400.0;
const WOLVERINE_GRAVEYARD_SPAWN_MAX: f32 = 800.0;

const TERN_MARSH_TARGET_PER_MARSH: u32 = 2;

const TIDE_POOL_CRAB_TARGET: u32 = 2;   // 2 crabs per tide pool
const TIDE_POOL_TERN_TARGET: u32 = 1;   // 1 tern per tide pool

/// Interval for spawn zone respawn checks. Predators (wolves, wolverines) respawn slowly so clearing
/// a den/graveyard feels meaningful. Full wolf pack ~32 min, wolverines ~32 min, terns ~16 min per marsh.
const SPAWN_ZONE_CHECK_INTERVAL_SECS: u64 = 480; // 8 minutes

#[spacetimedb::table(accessor = spawn_zone_schedule, scheduled(process_spawn_zone_maintenance))]
#[derive(Clone)]
pub struct SpawnZoneSchedule {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub scheduled_at: ScheduleAt,
}

/// Scheduled reducer - only callable by scheduler. Runs spawn zone maintenance.
#[spacetimedb::reducer]
pub fn process_spawn_zone_maintenance(ctx: &ReducerContext, _schedule: SpawnZoneSchedule) -> Result<(), String> {
    if ctx.sender() != ctx.identity() {
        return Err("process_spawn_zone_maintenance may only be called by the scheduler.".into());
    }
    maintain_spawn_zone_populations(ctx)
}

/// Initialize spawn zone respawn schedule. Called from lib.rs init.
pub fn init_spawn_zone_schedule(ctx: &ReducerContext) -> Result<(), String> {
    let schedule_table = ctx.db.spawn_zone_schedule();
    if schedule_table.iter().count() == 0 {
        let interval = Duration::from_secs(SPAWN_ZONE_CHECK_INTERVAL_SECS);
        log::info!("Initializing spawn zone respawn (wolves/wolverines/terns at monuments) - check every {} min", SPAWN_ZONE_CHECK_INTERVAL_SECS / 60);
        crate::try_insert_schedule!(
            schedule_table,
            SpawnZoneSchedule {
                id: 0,
                scheduled_at: ScheduleAt::Interval(TimeDuration::from(interval)),
            },
            "Spawn zone respawn"
        );
    }
    Ok(())
}

/// Maintains spawn zone populations: wolves at wolf dens, wolverines at whale bone graveyard,
/// terns at reed marshes. These species respawn at their allocated monument locations rather than randomly.
/// Runs on a dedicated 8-minute schedule (not every 15s) for balance - clearing a den should feel meaningful.
pub fn maintain_spawn_zone_populations(ctx: &ReducerContext) -> Result<(), String> {
    let existing_positions = get_existing_positions(ctx);
    let mut total_spawned = 0u32;

    // 1. Wolf dens - each den maintains 3-4 wolves
    for part in ctx.db.monument_part().iter() {
        if part.monument_type != MonumentType::WolfDen || !part.is_center {
            continue;
        }
        let center_x = part.world_x;
        let center_y = part.world_y;

        let wolf_count = ctx.db.wild_animal().iter()
            .filter(|a| a.species == AnimalSpecies::TundraWolf)
            .filter(|a| {
                let dx = a.pos_x - center_x;
                let dy = a.pos_y - center_y;
                dx * dx + dy * dy <= WOLF_DEN_ZONE_RADIUS_SQ
            })
            .count() as u32;

        if wolf_count >= WOLF_DEN_TARGET {
            continue;
        }

        // Spawn up to 1 wolf per den per cycle (gradual respawn)
        for _ in 0..(WOLF_DEN_TARGET - wolf_count).min(1) {
            let angle = ctx.rng().gen::<f32>() * 2.0 * std::f32::consts::PI;
            let distance = ctx.rng().gen_range(WOLF_DEN_SPAWN_MIN..WOLF_DEN_SPAWN_MAX);
            let spawn_x = center_x + angle.cos() * distance;
            let spawn_y = center_y + angle.sin() * distance;

            if !is_valid_spawn_position(ctx, spawn_x, spawn_y, AnimalSpecies::TundraWolf, &existing_positions) {
                continue;
            }

            let chunk_idx = calculate_chunk_index(spawn_x, spawn_y);
            match spawn_single_animal(ctx, AnimalSpecies::TundraWolf, spawn_x, spawn_y, chunk_idx) {
                Ok(inserted) => {
                    total_spawned += 1;
                    log::info!("🐺 Spawn zone: respawned Tundra Wolf #{} at wolf den ({:.1}, {:.1})", inserted.id, spawn_x, spawn_y);
                }
                Err(e) => log::warn!("Failed to spawn wolf at den: {}", e),
            }
        }
    }

    // 2. Whale bone graveyard - maintains 2-4 wolverines
    if let Some((graveyard_x, graveyard_y)) = whale_bone_graveyard::get_whale_bone_graveyard_center(ctx) {
        let wolverine_count = ctx.db.wild_animal().iter()
            .filter(|a| a.species == AnimalSpecies::Wolverine)
            .filter(|a| {
                let dx = a.pos_x - graveyard_x;
                let dy = a.pos_y - graveyard_y;
                dx * dx + dy * dy <= WOLVERINE_GRAVEYARD_ZONE_RADIUS_SQ
            })
            .count() as u32;

        if wolverine_count < WOLVERINE_GRAVEYARD_TARGET {
            for _ in 0..(WOLVERINE_GRAVEYARD_TARGET - wolverine_count).min(1) {
                let angle = ctx.rng().gen::<f32>() * 2.0 * std::f32::consts::PI;
                let distance = ctx.rng().gen_range(WOLVERINE_GRAVEYARD_SPAWN_MIN..WOLVERINE_GRAVEYARD_SPAWN_MAX);
                let spawn_x = graveyard_x + angle.cos() * distance;
                let spawn_y = graveyard_y + angle.sin() * distance;

                if !is_valid_spawn_position(ctx, spawn_x, spawn_y, AnimalSpecies::Wolverine, &existing_positions) {
                    continue;
                }

                let chunk_idx = calculate_chunk_index(spawn_x, spawn_y);
                match spawn_single_animal(ctx, AnimalSpecies::Wolverine, spawn_x, spawn_y, chunk_idx) {
                    Ok(inserted) => {
                        total_spawned += 1;
                        log::info!("🦡 Spawn zone: respawned Wolverine #{} at whale bone graveyard ({:.1}, {:.1})", inserted.id, spawn_x, spawn_y);
                    }
                    Err(e) => log::warn!("Failed to spawn wolverine at graveyard: {}", e),
                }
            }
        }
    }

    // 3. Reed marshes - each marsh maintains 1-2 terns
    for marsh in ctx.db.reed_marsh().iter() {
        let zone_radius_sq = (marsh.radius_px * 1.5) * (marsh.radius_px * 1.5);

        let tern_count = ctx.db.wild_animal().iter()
            .filter(|a| a.species == AnimalSpecies::Tern)
            .filter(|a| {
                let dx = a.pos_x - marsh.world_x;
                let dy = a.pos_y - marsh.world_y;
                dx * dx + dy * dy <= zone_radius_sq
            })
            .count() as u32;

        if tern_count >= TERN_MARSH_TARGET_PER_MARSH {
            continue;
        }

        for _ in 0..(TERN_MARSH_TARGET_PER_MARSH - tern_count).min(1) {
            let angle = ctx.rng().gen::<f32>() * 2.0 * std::f32::consts::PI;
            let distance = ctx.rng().gen_range(50.0..marsh.radius_px * 1.2);
            let spawn_x = marsh.world_x + angle.cos() * distance;
            let spawn_y = marsh.world_y + angle.sin() * distance;

            if !is_valid_spawn_position(ctx, spawn_x, spawn_y, AnimalSpecies::Tern, &existing_positions) {
                continue;
            }

            let chunk_idx = calculate_chunk_index(spawn_x, spawn_y);
            match spawn_single_animal(ctx, AnimalSpecies::Tern, spawn_x, spawn_y, chunk_idx) {
                Ok(inserted) => {
                    total_spawned += 1;
                    log::info!("🐦 Spawn zone: respawned Tern #{} at reed marsh ({:.1}, {:.1})", inserted.id, spawn_x, spawn_y);
                }
                Err(e) => log::warn!("Failed to spawn tern at marsh: {}", e),
            }
        }
    }

    // 4. Tide pools - each pool maintains 2 crabs and 1 tern
    for pool in ctx.db.tide_pool().iter() {
        let zone_radius_sq = (pool.radius_px * 1.2) * (pool.radius_px * 1.2);

        let crab_count = ctx.db.wild_animal().iter()
            .filter(|a| a.species == AnimalSpecies::BeachCrab)
            .filter(|a| {
                let dx = a.pos_x - pool.world_x;
                let dy = a.pos_y - pool.world_y;
                dx * dx + dy * dy <= zone_radius_sq
            })
            .count() as u32;

        if crab_count < TIDE_POOL_CRAB_TARGET {
            for _ in 0..(TIDE_POOL_CRAB_TARGET - crab_count).min(1) {
                let angle = ctx.rng().gen::<f32>() * 2.0 * std::f32::consts::PI;
                let distance = ctx.rng().gen_range(40.0..pool.radius_px * 0.9);
                let spawn_x = pool.world_x + angle.cos() * distance;
                let spawn_y = pool.world_y + angle.sin() * distance;

                if !is_valid_spawn_position(ctx, spawn_x, spawn_y, AnimalSpecies::BeachCrab, &existing_positions) {
                    continue;
                }

                let chunk_idx = calculate_chunk_index(spawn_x, spawn_y);
                match spawn_single_animal(ctx, AnimalSpecies::BeachCrab, spawn_x, spawn_y, chunk_idx) {
                    Ok(inserted) => {
                        total_spawned += 1;
                        log::info!("🦀 Spawn zone: respawned Beach Crab #{} at tide pool ({:.1}, {:.1})", inserted.id, spawn_x, spawn_y);
                    }
                    Err(e) => log::warn!("Failed to spawn crab at tide pool: {}", e),
                }
            }
        }

        let tern_count = ctx.db.wild_animal().iter()
            .filter(|a| a.species == AnimalSpecies::Tern)
            .filter(|a| {
                let dx = a.pos_x - pool.world_x;
                let dy = a.pos_y - pool.world_y;
                dx * dx + dy * dy <= zone_radius_sq
            })
            .count() as u32;

        if tern_count < TIDE_POOL_TERN_TARGET {
            let angle = ctx.rng().gen::<f32>() * 2.0 * std::f32::consts::PI;
            let distance = ctx.rng().gen_range(50.0..pool.radius_px * 0.95);
            let spawn_x = pool.world_x + angle.cos() * distance;
            let spawn_y = pool.world_y + angle.sin() * distance;

            if is_valid_spawn_position(ctx, spawn_x, spawn_y, AnimalSpecies::Tern, &existing_positions) {
                let chunk_idx = calculate_chunk_index(spawn_x, spawn_y);
                match spawn_single_animal(ctx, AnimalSpecies::Tern, spawn_x, spawn_y, chunk_idx) {
                    Ok(inserted) => {
                        total_spawned += 1;
                        log::info!("🐦 Spawn zone: respawned Tern #{} at tide pool ({:.1}, {:.1})", inserted.id, spawn_x, spawn_y);
                    }
                    Err(e) => log::warn!("Failed to spawn tern at tide pool: {}", e),
                }
            }
        }
    }

    if total_spawned > 0 {
        if let Err(e) = init_wild_animal_ai_schedule(ctx) {
            log::warn!("Failed to restart AI schedule after spawn zone respawn: {}", e);
        }
    }

    Ok(())
}

/// Maintains minimum wild animal population levels by spawning new animals when population drops too low.
/// Uses similar validation logic to resource respawning with collision detection.
/// Implements a Rust-like gradual respawn system rather than instant full population.
pub fn maintain_wild_animal_population(ctx: &ReducerContext) -> Result<(), String> {
    let wild_animals = ctx.db.wild_animal();
    let current_animal_count = wild_animals.iter().count();
    
    // Population thresholds - SCALED with map size for consistency
    // Same density as initial seeding in environment.rs (0.0002 = 0.02% of tiles)
    const WILD_ANIMAL_DENSITY: f32 = 0.00025; // Slightly higher than seeding to maintain population
    let total_tiles = (WORLD_WIDTH_TILES * WORLD_HEIGHT_TILES) as f32;
    let target_population = (total_tiles * WILD_ANIMAL_DENSITY) as usize;
    let min_population_threshold = target_population / 2; // Start respawning when below 50% of target
    const MAX_RESPAWN_PER_CYCLE: usize = 3; // Max animals to spawn per respawn cycle (reduced for gradual growth)
    
    // Only respawn if population is below minimum threshold
    if current_animal_count >= min_population_threshold {
        log::debug!("Wild animal population ({}) above minimum threshold ({}). No respawn needed.", 
                   current_animal_count, min_population_threshold);
        return Ok(());
    }
    
    let animals_needed = (target_population - current_animal_count).min(MAX_RESPAWN_PER_CYCLE);
    log::info!("Wild animal population low ({}/{}). Attempting to spawn {} animals.", 
               current_animal_count, target_population, animals_needed);
    
    // Species distribution (same as initial seeding)
    let species_weights = [
        (AnimalSpecies::CinderFox, 17),      // 17% - Common (reduced to make room for aquatic)
        (AnimalSpecies::ArcticWalrus, 10),   // 10% - Common (beaches only)
        (AnimalSpecies::BeachCrab, 13),      // 13% - Common beach creature
        (AnimalSpecies::TundraWolf, 5),      // 5% - RARE predator
        (AnimalSpecies::CableViper, 5),      // 5% - RARE ambush predator
        (AnimalSpecies::Tern, 10),           // 10% - Coastal scavenger bird (beaches)
        (AnimalSpecies::Crow, 8),            // 8% - Inland thief bird
        (AnimalSpecies::Vole, 16),           // 16% - Common prey animal (tundra/grassland/forest)
        (AnimalSpecies::Wolverine, 6),       // 6% - Uncommon aggressive predator
        (AnimalSpecies::Caribou, 10),        // 10% - Tundra/alpine herd animal
        // Aquatic animals - REQUIRE water tiles to spawn
        (AnimalSpecies::SalmonShark, 4),     // 4% - RARE aquatic apex predator (deep water only)
        (AnimalSpecies::Jellyfish, 5),       // 5% - Uncommon aquatic hazard (deep water only)
        // Alpine animals
        (AnimalSpecies::PolarBear, 3),       // 3% - RARE alpine apex predator
        (AnimalSpecies::Hare, 10),           // 10% - Common alpine prey animal
        (AnimalSpecies::SnowyOwl, 5),        // 5% - Uncommon alpine flying predator
    ];
    let total_weight: u32 = species_weights.iter().map(|(_, weight)| weight).sum();
    
    // Get existing positions for collision avoidance
    let existing_positions = get_existing_positions(ctx);
    
    // Track animals spawned per chunk to maintain distribution
    let mut animals_per_chunk_map = get_animals_per_chunk_map(ctx);
    
    let mut spawned_count = 0;
    let max_spawn_attempts = animals_needed * 20; // 20 attempts per needed animal
    let mut spawn_attempts = 0;
    
    // Calculate spawn bounds (avoid world edges)
    let margin_tiles = 5;
    let (min_tile_x, max_tile_x, min_tile_y, max_tile_y) = 
        calculate_tile_bounds(WORLD_WIDTH_TILES, WORLD_HEIGHT_TILES, margin_tiles);
    
    while spawned_count < animals_needed && spawn_attempts < max_spawn_attempts {
        spawn_attempts += 1;
        
        // Choose species using weighted random selection
        let chosen_species = choose_random_species(&species_weights, total_weight, &mut ctx.rng());
        
        // Aquatic animals (sharks, jellyfish) ONLY spawn on Sea tiles. Retry until we find water.
        let is_aquatic = matches!(chosen_species, AnimalSpecies::SalmonShark | AnimalSpecies::Jellyfish);
        const MAX_AQUATIC_RESPAWN_ATTEMPTS: u32 = 150;
        
        let (pos_x, pos_y) = if is_aquatic {
            let mut rng = ctx.rng();
            let mut found = None;
            for _ in 0..MAX_AQUATIC_RESPAWN_ATTEMPTS {
                let tile_x = rng.gen_range(min_tile_x..max_tile_x);
                let tile_y = rng.gen_range(min_tile_y..max_tile_y);
                let px = (tile_x as f32 + 0.5) * TILE_SIZE_PX as f32;
                let py = (tile_y as f32 + 0.5) * TILE_SIZE_PX as f32;
                if is_wild_animal_location_suitable(ctx, px, py, chosen_species, &existing_positions.trees)
                    && is_position_on_water(ctx, px, py)
                {
                    found = Some((px, py));
                    break;
                }
            }
            match found {
                Some(p) => p,
                None => continue, // No valid water tile; skip this respawn attempt
            }
        } else {
            let tile_x = ctx.rng().gen_range(min_tile_x..max_tile_x);
            let tile_y = ctx.rng().gen_range(min_tile_y..max_tile_y);
            let pos_x = (tile_x as f32 + 0.5) * TILE_SIZE_PX as f32;
            let pos_y = (tile_y as f32 + 0.5) * TILE_SIZE_PX as f32;
            (pos_x, pos_y)
        };
        
        // Calculate chunk index and check distribution
        let chunk_idx = calculate_chunk_index(pos_x, pos_y);
        let current_animals_in_chunk = animals_per_chunk_map.get(&chunk_idx).copied().unwrap_or(0);
        
        // Skip if chunk already has too many animals (maintain distribution)
        if current_animals_in_chunk >= 1 { // Max 1 animal per chunk (reduced for performance)
            continue;
        }
        
        // Validate spawn position
        if !is_valid_spawn_position(ctx, pos_x, pos_y, chosen_species, &existing_positions) {
            continue;
        }
        
        // Create and spawn the animal
        match spawn_animal(ctx, chosen_species, pos_x, pos_y, chunk_idx) {
            Ok(inserted_animal) => {
                spawned_count += 1;
                animals_per_chunk_map.insert(chunk_idx, current_animals_in_chunk + 1);
                log::info!("Respawned {:?} #{} at ({:.1}, {:.1}) in chunk {} [population: {}/{}]", 
                          chosen_species, inserted_animal.id, pos_x, pos_y, chunk_idx, 
                          current_animal_count + spawned_count, target_population);
            }
            Err(e) => {
                log::warn!("Failed to respawn wild animal (attempt {}): {}. Continuing.", spawn_attempts, e);
            }
        }
    }
    
    if spawned_count > 0 {
        log::info!("Wild animal respawn cycle complete: spawned {} animals in {} attempts (population: {}/{})", 
                   spawned_count, spawn_attempts, current_animal_count + spawned_count, target_population);
        
        // CRITICAL FIX: Restart AI schedule if it was stopped (e.g., after database clear)
        // This ensures animals will actually move and function after spawning
        if let Err(e) = init_wild_animal_ai_schedule(ctx) {
            log::warn!("Failed to restart AI schedule after spawning animals: {}. Animals may not move until next AI tick.", e);
        } else {
            log::debug!("AI schedule restarted after spawning {} animals", spawned_count);
        }
    } else if animals_needed > 0 {
        log::warn!("Failed to spawn any animals this cycle despite low population ({}/{}). Will retry next cycle.", 
                   current_animal_count, target_population);
    }

    Ok(())
}

/// Get existing positions for collision checking
fn get_existing_positions(ctx: &ReducerContext) -> ExistingPositions {
    let existing_animal_positions: Vec<(f32, f32)> = ctx.db.wild_animal().iter()
        .map(|animal| (animal.pos_x, animal.pos_y))
        .collect();
    
    let existing_tree_positions: Vec<(f32, f32)> = ctx.db.tree().iter()
        .filter(|tree| tree.health > 0) // Only living trees
        .map(|tree| (tree.pos_x, tree.pos_y))
        .collect();
    
    let existing_stone_positions: Vec<(f32, f32)> = ctx.db.stone().iter()
        .filter(|stone| stone.health > 0) // Only intact stones
        .map(|stone| (stone.pos_x, stone.pos_y))
        .collect();
    
    ExistingPositions {
        animals: existing_animal_positions,
        trees: existing_tree_positions,
        stones: existing_stone_positions,
    }
}

/// Track animals per chunk for distribution
fn get_animals_per_chunk_map(ctx: &ReducerContext) -> std::collections::HashMap<u32, u32> {
    let mut animals_per_chunk_map: std::collections::HashMap<u32, u32> = std::collections::HashMap::new();
    for animal in ctx.db.wild_animal().iter() {
        let count = animals_per_chunk_map.get(&animal.chunk_index).copied().unwrap_or(0);
        animals_per_chunk_map.insert(animal.chunk_index, count + 1);
    }
    animals_per_chunk_map
}

/// Choose random species based on weights
fn choose_random_species(
    species_weights: &[(AnimalSpecies, u32)],
    total_weight: u32,
    rng: &mut impl Rng,
) -> AnimalSpecies {
    let species_roll = rng.gen_range(0..total_weight);
    let mut cumulative_weight = 0;
    
    for &(species, weight) in species_weights {
        cumulative_weight += weight;
        if species_roll < cumulative_weight {
            return species;
        }
    }
    
    // Fallback (shouldn't happen)
    AnimalSpecies::CinderFox
}

/// Validate if position is suitable for spawning
fn is_valid_spawn_position(
    ctx: &ReducerContext,
    pos_x: f32,
    pos_y: f32,
    species: AnimalSpecies,
    existing_positions: &ExistingPositions,
) -> bool {
    // Check central compound exclusion first
    if is_position_in_central_compound(pos_x, pos_y) {
        return false;
    }
    
    // Validate terrain suitability for species
    // IMPORTANT: This must be checked BEFORE the water check, because aquatic animals
    // (SalmonShark, Jellyfish) REQUIRE water tiles to spawn!
    if !is_wild_animal_location_suitable(ctx, pos_x, pos_y, species, &existing_positions.trees) {
        return false;
    }
    
    // Check water - aquatic species REQUIRE water, non-aquatic species are BLOCKED from water
    // Exception: BeachCrab and Tern can spawn on water within tide pools (coastal inlets)
    let is_aquatic_species = matches!(species, AnimalSpecies::SalmonShark | AnimalSpecies::Jellyfish);
    let is_tide_pool_species = matches!(species, AnimalSpecies::BeachCrab | AnimalSpecies::Tern);
    let is_on_water = is_position_on_water(ctx, pos_x, pos_y);
    let in_tide_pool = is_tide_pool_species && is_position_in_tide_pool(ctx, pos_x, pos_y);
    
    if is_aquatic_species {
        // Aquatic animals MUST spawn on water
        if !is_on_water {
            return false;
        }
        
        // Check distance from existing animals (prevent clustering - still applies to aquatic)
        let min_animal_distance_sq = 150.0 * 150.0;
        for &(other_x, other_y) in &existing_positions.animals {
            let dx = pos_x - other_x;
            let dy = pos_y - other_y;
            if dx * dx + dy * dy < min_animal_distance_sq {
                return false;
            }
        }
        
        // Skip tree/stone/respawn position checks for aquatic animals (they're in water)
        return true;
    } else {
        // Non-aquatic animals must NOT spawn on water (except tide pool species in their zone)
        if is_on_water && !in_tide_pool {
            return false;
        }
    }
    
    // Check distance from existing animals (prevent clustering)
    let min_animal_distance_sq = 150.0 * 150.0; // Same as initial seeding
    for &(other_x, other_y) in &existing_positions.animals {
        let dx = pos_x - other_x;
        let dy = pos_y - other_y;
        if dx * dx + dy * dy < min_animal_distance_sq {
            return false;
        }
    }
    
    // Check distance from trees and stones (only for non-aquatic)
    let min_tree_distance_sq = 40.0 * 40.0;
    for &(tree_x, tree_y) in &existing_positions.trees {
        let dx = pos_x - tree_x;
        let dy = pos_y - tree_y;
        if dx * dx + dy * dy < min_tree_distance_sq {
            return false;
        }
    }
    
    let min_stone_distance_sq = 60.0 * 60.0;
    for &(stone_x, stone_y) in &existing_positions.stones {
        let dx = pos_x - stone_x;
        let dy = pos_y - stone_y;
        if dx * dx + dy * dy < min_stone_distance_sq {
            return false;
        }
    }
    
    // Use existing respawn position validation (checks players, structures, etc.)
    if !crate::utils::is_respawn_position_clear(ctx, pos_x, pos_y, crate::respawn::RESPAWN_CHECK_RADIUS_SQ) {
        return false;
    }
    
    true
}

/// Create and spawn a new animal
fn spawn_animal(
    ctx: &ReducerContext,
    species: AnimalSpecies,
    pos_x: f32,
    pos_y: f32,
    chunk_idx: u32,
) -> Result<WildAnimal, String> {
    // For herd animals (caribou, walrus), spawn in groups to ensure breeding viability
    // Youth should NEVER spawn alone - only through births from pregnant females
    if matches!(species, AnimalSpecies::Caribou | AnimalSpecies::ArcticWalrus) {
        return spawn_herd_animal_group(ctx, species, pos_x, pos_y, chunk_idx);
    }
    
    spawn_single_animal(ctx, species, pos_x, pos_y, chunk_idx)
}

/// Spawn herd animals (caribou, walrus) in breeding-viable groups
/// Ensures at least one male and one female adult per group
fn spawn_herd_animal_group(
    ctx: &ReducerContext,
    species: AnimalSpecies,
    pos_x: f32,
    pos_y: f32,
    chunk_idx: u32,
) -> Result<WildAnimal, String> {
    use super::caribou::CaribouSex;
    use super::walrus::WalrusSex;
    
    let mut rng = ctx.rng();
    
    // Group size: minimum 3 (1 male + 1 female + 1 random) for breeding viability
    let group_size = match species {
        AnimalSpecies::ArcticWalrus => rng.gen_range(3..=4), // 3-4 walruses
        AnimalSpecies::Caribou => rng.gen_range(3..=4),      // 3-4 caribou
        _ => 1,
    };
    
    // Group spacing
    let (min_dist, max_dist) = match species {
        AnimalSpecies::ArcticWalrus => (30.0, 60.0),
        AnimalSpecies::Caribou => (40.0, 80.0),
        _ => (30.0, 60.0),
    };
    
    // Generate group positions
    let mut group_positions = vec![(pos_x, pos_y)];
    for _ in 1..group_size {
        let mut attempts = 0;
        while attempts < 15 {
            attempts += 1;
            let angle = rng.gen::<f32>() * 2.0 * std::f32::consts::PI;
            let distance = rng.gen_range(min_dist..max_dist);
            let group_pos_x = pos_x + angle.cos() * distance;
            let group_pos_y = pos_y + angle.sin() * distance;
            
            // Basic bounds check
            let margin = 50.0;
            let world_width = (crate::WORLD_WIDTH_TILES * crate::TILE_SIZE_PX) as f32;
            let world_height = (crate::WORLD_HEIGHT_TILES * crate::TILE_SIZE_PX) as f32;
            if group_pos_x < margin || group_pos_x > world_width - margin ||
               group_pos_y < margin || group_pos_y > world_height - margin {
                continue;
            }
            if super::core::is_position_in_alk_wildlife_zone(ctx, group_pos_x, group_pos_y) { continue; }
            
            // Check not too close to other group members
            let mut too_close = false;
            for &(ox, oy) in &group_positions {
                if (group_pos_x - ox).powi(2) + (group_pos_y - oy).powi(2) < 25.0 * 25.0 {
                    too_close = true;
                    break;
                }
            }
            if too_close { continue; }
            
            group_positions.push((group_pos_x, group_pos_y));
            break;
        }
    }
    
    let actual_group_size = group_positions.len();
    log::info!("🦌🦭 Spawning {} {:?} in a breeding-viable group at ({:.1}, {:.1})", 
              actual_group_size, species, pos_x, pos_y);
    
    // Track sexes to ensure at least one of each
    let mut males_spawned = 0;
    let mut females_spawned = 0;
    let mut first_animal: Option<WildAnimal> = None;
    
    for (i, &(spawn_x, spawn_y)) in group_positions.iter().enumerate() {
        let spawn_chunk = calculate_chunk_index(spawn_x, spawn_y);
        
        match spawn_single_animal(ctx, species, spawn_x, spawn_y, spawn_chunk) {
            Ok(inserted) => {
                // Assign sex with breeding viability guarantee
                match species {
                    AnimalSpecies::Caribou => {
                        let sex = if actual_group_size >= 2 {
                            if males_spawned == 0 && (i == 0 || (i == actual_group_size - 1 && females_spawned > 0)) {
                                CaribouSex::Male
                            } else if females_spawned == 0 && (i == 1 || (i == actual_group_size - 1 && males_spawned > 0)) {
                                CaribouSex::Female
                            } else {
                                if rng.gen::<bool>() { CaribouSex::Male } else { CaribouSex::Female }
                            }
                        } else {
                            if rng.gen::<bool>() { CaribouSex::Male } else { CaribouSex::Female }
                        };
                        
                        match sex {
                            CaribouSex::Male => males_spawned += 1,
                            CaribouSex::Female => females_spawned += 1,
                        }
                        
                        if let Err(e) = super::caribou::assign_caribou_sex_forced(ctx, inserted.id, sex) {
                            log::warn!("Failed to assign sex to caribou {}: {}", inserted.id, e);
                        }
                    }
                    AnimalSpecies::ArcticWalrus => {
                        let sex = if actual_group_size >= 2 {
                            if males_spawned == 0 && (i == 0 || (i == actual_group_size - 1 && females_spawned > 0)) {
                                WalrusSex::Male
                            } else if females_spawned == 0 && (i == 1 || (i == actual_group_size - 1 && males_spawned > 0)) {
                                WalrusSex::Female
                            } else {
                                if rng.gen::<bool>() { WalrusSex::Male } else { WalrusSex::Female }
                            }
                        } else {
                            if rng.gen::<bool>() { WalrusSex::Male } else { WalrusSex::Female }
                        };
                        
                        match sex {
                            WalrusSex::Male => males_spawned += 1,
                            WalrusSex::Female => females_spawned += 1,
                        }
                        
                        if let Err(e) = super::walrus::assign_walrus_sex_forced(ctx, inserted.id, sex) {
                            log::warn!("Failed to assign sex to walrus {}: {}", inserted.id, e);
                        }
                    }
                    _ => {}
                }
                
                if first_animal.is_none() {
                    first_animal = Some(inserted);
                }
            }
            Err(e) => {
                log::warn!("Failed to spawn group member {} for {:?}: {}", i, species, e);
            }
        }
    }
    
    first_animal.ok_or_else(|| "Failed to spawn any animals in group".to_string())
}

/// Spawn a single animal (non-herd species or called for each member of a herd)
fn spawn_single_animal(
    ctx: &ReducerContext,
    species: AnimalSpecies,
    pos_x: f32,
    pos_y: f32,
    chunk_idx: u32,
) -> Result<WildAnimal, String> {
    if super::core::is_position_in_alk_wildlife_zone(ctx, pos_x, pos_y) {
        return Err("Cannot spawn wildlife near an ALK compound".to_string());
    }
    // Get stats directly from the behavior system (single source of truth)
    let behavior = species.get_behavior();
    let stats = behavior.get_stats();
    let max_health = stats.max_health;
    
    // Create new animal
    let new_animal = WildAnimal {
        id: 0, // auto_inc
        species,
        pos_x,
        pos_y,
        direction_x: 0.0,
        direction_y: 1.0,
        facing_direction: "down".to_string(), // Default facing direction
        state: AnimalState::Patrolling,
        health: max_health,
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
        movement_pattern: MovementPattern::Loop,
        chunk_index: chunk_idx,
        created_at: ctx.timestamp,
        last_hit_time: None,
        
        // Pack behavior fields
        pack_id: None,
        is_pack_leader: false,
        pack_join_time: None,
        last_pack_check: None,
        
        // Fire fear override
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
        is_flying: matches!(species, AnimalSpecies::Tern | AnimalSpecies::Crow), // Birds start flying
        
        // Night hostile NPC fields (not used in normal animal respawn)
        is_hostile_npc: false,
        target_structure_id: None,
        target_structure_type: None,
        stalk_angle: 0.0,
        stalk_distance: 0.0,
        despawn_at: None,
        shock_active_until: None,
        last_shock_time: None,
    };
    
    // Attempt to spawn the animal
    let inserted = ctx.db.wild_animal().try_insert(new_animal)
        .map_err(|e| e.to_string())?;
    
    // NOTE: For herd animals (caribou, walrus), sex assignment is handled by spawn_herd_animal_group
    // to ensure breeding viability. For individual spawns of non-herd animals, no sex assignment needed.
    
    Ok(inserted)
}

/// Helper struct to organize existing positions
struct ExistingPositions {
    animals: Vec<(f32, f32)>,
    trees: Vec<(f32, f32)>,
    stones: Vec<(f32, f32)>,
}
