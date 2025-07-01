use spacetimedb::{ReducerContext, Timestamp, Table};
use rand::Rng;
use log;

use crate::{TILE_SIZE_PX, WORLD_WIDTH_TILES, WORLD_HEIGHT_TILES};
use crate::environment::{calculate_chunk_index, is_wild_animal_location_suitable, is_position_on_water, is_position_in_central_compound};
use crate::utils::calculate_tile_bounds;
use super::core::{AnimalSpecies, AnimalState, MovementPattern, WildAnimal, AnimalBehavior};

// Table trait imports
use crate::wild_animal_npc::core::wild_animal;
use crate::tree::tree;
use crate::stone::stone;

/// Maintains minimum wild animal population levels by spawning new animals when population drops too low.
/// Uses similar validation logic to resource respawning with collision detection.
/// Implements a Rust-like gradual respawn system rather than instant full population.
pub fn maintain_wild_animal_population(ctx: &ReducerContext) -> Result<(), String> {
    let wild_animals = ctx.db.wild_animal();
    let current_animal_count = wild_animals.iter().count();
    
    // Population thresholds (similar to Rust's animal spawn system)
    const MIN_POPULATION_THRESHOLD: usize = 25; // When to start respawning (1/3 of target ~75)
    const TARGET_POPULATION: usize = 75; // Target population (~0.03% of world tiles)
    const MAX_RESPAWN_PER_CYCLE: usize = 3; // Max animals to spawn per respawn cycle (gradual)
    
    // Only respawn if population is below minimum threshold
    if current_animal_count >= MIN_POPULATION_THRESHOLD {
        log::debug!("Wild animal population ({}) above minimum threshold ({}). No respawn needed.", 
                   current_animal_count, MIN_POPULATION_THRESHOLD);
        return Ok(());
    }
    
    let animals_needed = (TARGET_POPULATION - current_animal_count).min(MAX_RESPAWN_PER_CYCLE);
    log::info!("Wild animal population low ({}/{}). Attempting to spawn {} animals.", 
               current_animal_count, TARGET_POPULATION, animals_needed);
    
    // Species distribution (same as initial seeding)
    let species_weights = [
        (AnimalSpecies::CinderFox, 50),    // 50% - Most common
        (AnimalSpecies::TundraWolf, 30),   // 30% - Moderately common  
        (AnimalSpecies::CableViper, 20),   // 20% - Least common
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
        
        // Generate random position
        let tile_x = ctx.rng().gen_range(min_tile_x..max_tile_x);
        let tile_y = ctx.rng().gen_range(min_tile_y..max_tile_y);
        let pos_x = (tile_x as f32 + 0.5) * TILE_SIZE_PX as f32;
        let pos_y = (tile_y as f32 + 0.5) * TILE_SIZE_PX as f32;
        
        // Calculate chunk index and check distribution
        let chunk_idx = calculate_chunk_index(pos_x, pos_y);
        let current_animals_in_chunk = animals_per_chunk_map.get(&chunk_idx).copied().unwrap_or(0);
        
        // Skip if chunk already has too many animals (maintain distribution)
        if current_animals_in_chunk >= 1 { // Max 1 animal per chunk
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
                          current_animal_count + spawned_count, TARGET_POPULATION);
            }
            Err(e) => {
                log::warn!("Failed to respawn wild animal (attempt {}): {}. Continuing.", spawn_attempts, e);
            }
        }
    }
    
    if spawned_count > 0 {
        log::info!("Wild animal respawn cycle complete: spawned {} animals in {} attempts (population: {}/{})", 
                   spawned_count, spawn_attempts, current_animal_count + spawned_count, TARGET_POPULATION);
    } else if animals_needed > 0 {
        log::warn!("Failed to spawn any animals this cycle despite low population ({}/{}). Will retry next cycle.", 
                   current_animal_count, TARGET_POPULATION);
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
    // Validate terrain suitability for species
    if !is_wild_animal_location_suitable(ctx, pos_x, pos_y, species, &existing_positions.trees) {
        return false;
    }
    
    // Check water and central compound
    if is_position_on_water(ctx, pos_x, pos_y) || is_position_in_central_compound(pos_x, pos_y) {
        return false;
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
    
    // Check distance from trees and stones
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
        facing_direction: "left".to_string(), // Default facing direction
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
        
        // Initialize pack fields - animals start solo
        pack_id: None,
        is_pack_leader: false,
        pack_join_time: None,
        last_pack_check: None,
        
        // Fire fear override tracking
        fire_fear_overridden_by: None,
    };
    
    // Attempt to spawn the animal
    ctx.db.wild_animal().try_insert(new_animal)
        .map_err(|e| e.to_string())
}

/// Helper struct to organize existing positions
struct ExistingPositions {
    animals: Vec<(f32, f32)>,
    trees: Vec<(f32, f32)>,
    stones: Vec<(f32, f32)>,
} 