/*
 * server/src/environment.rs
 *
 * Purpose: Manages the static and dynamic elements of the game world environment,
 *          excluding player-specific state.
 *
 * Responsibilities:
 *   - `seed_environment`: Populates the world with initial resources (trees, stones, mushrooms)
 *                         on server startup if the environment is empty. Uses helpers from `utils.rs`.
 *   - `check_resource_respawns`: Checks periodically if any depleted resources (trees, stones,
 *                                mushrooms with `respawn_at` set) are ready to respawn.
 *                                Uses a macro from `utils.rs` for conciseness.
 *
 * Note: Resource definitions (structs, constants) are in their respective modules (e.g., `tree.rs`).
 */

// server/src/environment.rs
use spacetimedb::{ReducerContext, Table, Timestamp};
use crate::{WORLD_WIDTH_PX, WORLD_HEIGHT_PX, TILE_SIZE_PX, WORLD_WIDTH_TILES, WORLD_HEIGHT_TILES};

// Import resource modules
use crate::tree;
use crate::stone;
use crate::mushroom;
use crate::corn;
use crate::hemp;
use crate::pumpkin;
use crate::cloud;
use crate::grass;

// Import table traits needed for ctx.db access
use crate::tree::tree as TreeTableTrait;
use crate::stone::stone as StoneTableTrait;
use crate::mushroom::mushroom as MushroomTableTrait;
use crate::corn::corn as CornTableTrait;
use crate::pumpkin::pumpkin as PumpkinTableTrait;
use crate::hemp::hemp as HempTableTrait;
use crate::items::ItemDefinition;
use crate::cloud::{Cloud, CloudShapeType, CloudUpdateSchedule};
use crate::utils::*;
use crate::cloud::cloud as CloudTableTrait;
use crate::cloud::cloud_update_schedule as CloudUpdateScheduleTableTrait;
use crate::grass::grass as GrassTableTrait;

// Import utils helpers and macro
use crate::utils::{calculate_tile_bounds, attempt_single_spawn};
use crate::check_and_respawn_resource; // Import the macro

use noise::{NoiseFn, Perlin, Fbm};
use rand::{Rng, SeedableRng};
use rand::rngs::StdRng;
use std::collections::HashSet;
use log;

// --- Constants for Chunk Calculation ---
// Size of a chunk in tiles (e.g., 20x20 tiles per chunk)
pub const CHUNK_SIZE_TILES: u32 = 20;
// World width in chunks
pub const WORLD_WIDTH_CHUNKS: u32 = (WORLD_WIDTH_TILES + CHUNK_SIZE_TILES - 1) / CHUNK_SIZE_TILES;
// Size of a chunk in pixels
pub const CHUNK_SIZE_PX: f32 = CHUNK_SIZE_TILES as f32 * TILE_SIZE_PX as f32;

// --- Helper function to calculate chunk index ---
pub fn calculate_chunk_index(pos_x: f32, pos_y: f32) -> u32 {
    // Convert position to tile coordinates
    let tile_x = (pos_x / TILE_SIZE_PX as f32).floor() as u32;
    let tile_y = (pos_y / TILE_SIZE_PX as f32).floor() as u32;
    
    // Calculate chunk coordinates (which chunk the tile is in)
    let chunk_x = (tile_x / CHUNK_SIZE_TILES).min(WORLD_WIDTH_CHUNKS - 1);
    let chunk_y = (tile_y / CHUNK_SIZE_TILES).min(WORLD_WIDTH_CHUNKS - 1);
    
    // Calculate 1D chunk index (row-major ordering)
    chunk_y * WORLD_WIDTH_CHUNKS + chunk_x
}

// --- Environment Seeding ---

#[spacetimedb::reducer]
pub fn seed_environment(ctx: &ReducerContext) -> Result<(), String> {
    let trees = ctx.db.tree();
    let stones = ctx.db.stone();
    let mushrooms = ctx.db.mushroom();
    let corns = ctx.db.corn();
    let pumpkins = ctx.db.pumpkin();
    let hemps = ctx.db.hemp();
    let clouds = ctx.db.cloud();
    let grasses = ctx.db.grass();

    if trees.iter().count() > 0 || stones.iter().count() > 0 || mushrooms.iter().count() > 0 || corns.iter().count() > 0 || pumpkins.iter().count() > 0 || hemps.iter().count() > 0 || clouds.iter().count() > 0 || grasses.iter().count() > 0 {
        log::info!(
            "Environment already seeded (Trees: {}, Stones: {}, Mushrooms: {}, Corns: {}, Hemps: {}, Pumpkins: {}, Clouds: {}, Grass: {}). Skipping.",
            trees.iter().count(), stones.iter().count(), mushrooms.iter().count(), corns.iter().count(), hemps.iter().count(), pumpkins.iter().count(), clouds.iter().count(), grasses.iter().count()
        );
        return Ok(());
    }

    log::info!("Seeding environment (trees, stones, mushrooms, corn, pumpkins, hemp, clouds, grass)..." );

    let fbm = Fbm::<Perlin>::new(ctx.rng().gen());
    let mut rng = StdRng::from_rng(ctx.rng()).map_err(|e| format!("Failed to seed RNG: {}", e))?;

    let total_tiles = crate::WORLD_WIDTH_TILES * crate::WORLD_HEIGHT_TILES;

    // Calculate targets and limits
    let target_tree_count = (total_tiles as f32 * crate::tree::TREE_DENSITY_PERCENT) as u32;
    let max_tree_attempts = target_tree_count * crate::tree::MAX_TREE_SEEDING_ATTEMPTS_FACTOR;
    let target_stone_count = (total_tiles as f32 * crate::stone::STONE_DENSITY_PERCENT) as u32;
    let max_stone_attempts = target_stone_count * crate::tree::MAX_TREE_SEEDING_ATTEMPTS_FACTOR; 
    let target_mushroom_count = (total_tiles as f32 * crate::mushroom::MUSHROOM_DENSITY_PERCENT) as u32;
    let max_mushroom_attempts = target_mushroom_count * crate::tree::MAX_TREE_SEEDING_ATTEMPTS_FACTOR; 
    let target_corn_count = (total_tiles as f32 * crate::corn::CORN_DENSITY_PERCENT) as u32;
    let max_corn_attempts = target_corn_count * crate::tree::MAX_TREE_SEEDING_ATTEMPTS_FACTOR;
    let target_pumpkin_count = (total_tiles as f32 * crate::pumpkin::PUMPKIN_DENSITY_PERCENT) as u32;
    let max_pumpkin_attempts = target_pumpkin_count * crate::tree::MAX_TREE_SEEDING_ATTEMPTS_FACTOR;
    let target_hemp_count = (total_tiles as f32 * crate::hemp::HEMP_DENSITY_PERCENT) as u32;
    let max_hemp_attempts = target_hemp_count * crate::tree::MAX_TREE_SEEDING_ATTEMPTS_FACTOR;

    // Cloud seeding parameters
    const CLOUD_DENSITY_PERCENT: f32 = 0.005; // Example: 0.5% of tiles might have a cloud center
    const MAX_CLOUD_SEEDING_ATTEMPTS_FACTOR: u32 = 3;
    let target_cloud_count = (total_tiles as f32 * CLOUD_DENSITY_PERCENT) as u32;
    let max_cloud_attempts = target_cloud_count * MAX_CLOUD_SEEDING_ATTEMPTS_FACTOR;

    // Grass seeding parameters (using constants from grass.rs)
    let target_grass_count = (total_tiles as f32 * crate::grass::GRASS_DENSITY_PERCENT) as u32;
    let max_grass_attempts = target_grass_count * crate::grass::MAX_GRASS_SEEDING_ATTEMPTS_FACTOR;

    // --- NEW: Region parameters for grass types ---
    const GRASS_REGION_SIZE_CHUNKS: u32 = 10; // Each region is 10x10 chunks
    const GRASS_REGION_SIZE_TILES: u32 = GRASS_REGION_SIZE_CHUNKS * CHUNK_SIZE_TILES;

    // Cloud drift parameters
    const CLOUD_BASE_DRIFT_X: f32 = 4.0; // Base speed in pixels per second (e.g., gentle eastward drift) - Doubled
    const CLOUD_BASE_DRIFT_Y: f32 = 1.0; // Doubled
    const CLOUD_DRIFT_VARIATION: f32 = 1.0; // Max variation from base speed

    log::info!("Target Trees: {}, Max Attempts: {}", target_tree_count, max_tree_attempts);
    log::info!("Target Stones: {}, Max Attempts: {}", target_stone_count, max_stone_attempts);
    log::info!("Target Mushrooms: {}, Max Attempts: {}", target_mushroom_count, max_mushroom_attempts);
    log::info!("Target Corns: {}, Max Attempts: {}", target_corn_count, max_corn_attempts);
    log::info!("Target Hemps: {}, Max Attempts: {}", target_hemp_count, max_hemp_attempts);
    log::info!("Target Pumpkins: {}, Max Attempts: {}", target_pumpkin_count, max_pumpkin_attempts);
    log::info!("Target Clouds: {}, Max Attempts: {}", target_cloud_count, max_cloud_attempts);
    log::info!("Target Grass: {}, Max Attempts: {}", target_grass_count, max_grass_attempts);
    // Calculate spawn bounds using helper
    let (min_tile_x, max_tile_x, min_tile_y, max_tile_y) = 
        calculate_tile_bounds(WORLD_WIDTH_TILES, WORLD_HEIGHT_TILES, crate::tree::TREE_SPAWN_WORLD_MARGIN_TILES);

    // Initialize tracking collections
    let mut occupied_tiles = HashSet::<(u32, u32)>::new();
    let mut spawned_tree_positions = Vec::<(f32, f32)>::new();
    let mut spawned_stone_positions = Vec::<(f32, f32)>::new();
    let mut spawned_mushroom_positions = Vec::<(f32, f32)>::new();
    let mut spawned_corn_positions = Vec::<(f32, f32)>::new();
    let mut spawned_pumpkin_positions = Vec::<(f32, f32)>::new();
    let mut spawned_hemp_positions = Vec::<(f32, f32)>::new();
    let mut spawned_cloud_positions = Vec::<(f32, f32)>::new();
    let mut spawned_grass_positions = Vec::<(f32, f32)>::new();

    let mut spawned_tree_count = 0;
    let mut tree_attempts = 0;
    let mut spawned_stone_count = 0;
    let mut stone_attempts = 0;
    let mut spawned_mushroom_count = 0;
    let mut mushroom_attempts = 0;
    let mut spawned_corn_count = 0;
    let mut corn_attempts = 0;
    let mut spawned_hemp_count = 0;
    let mut hemp_attempts = 0;
    let mut spawned_pumpkin_count = 0;
    let mut pumpkin_attempts = 0;
    let mut spawned_cloud_count = 0;
    let mut cloud_attempts = 0;
    let mut spawned_grass_count = 0;
    let mut grass_attempts = 0;

    // --- Seed Trees --- Use helper function --- 
    log::info!("Seeding Trees...");
    while spawned_tree_count < target_tree_count && tree_attempts < max_tree_attempts {
        tree_attempts += 1;

        // Determine tree type roll *before* calling attempt_single_spawn
        let tree_type_roll_for_this_attempt: f64 = rng.gen_range(0.0..1.0);

        match attempt_single_spawn(
            &mut rng,
            &mut occupied_tiles,
            &mut spawned_tree_positions,
            &[],
            &spawned_stone_positions,
            min_tile_x, max_tile_x, min_tile_y, max_tile_y,
            &fbm,
            crate::tree::TREE_SPAWN_NOISE_FREQUENCY,
            crate::tree::TREE_SPAWN_NOISE_THRESHOLD,
            crate::tree::MIN_TREE_DISTANCE_SQ,
            0.0,
            0.0,
            |pos_x, pos_y, tree_type_roll: f64| { // Closure now accepts the pre-calculated roll
                // Calculate chunk index for the tree
                let chunk_idx = calculate_chunk_index(pos_x, pos_y);
                
                // Determine tree type with weighted probability using the passed-in roll
                let tree_type = if tree_type_roll < 0.6 { // 60% chance for DownyOak
                    crate::tree::TreeType::DownyOak
                } else if tree_type_roll < 0.8 { // 20% chance for AleppoPine
                    crate::tree::TreeType::AleppoPine
                } else { // 20% chance for MannaAsh
                    crate::tree::TreeType::MannaAsh
                };
                
                crate::tree::Tree {
                    id: 0,
                    pos_x,
                    pos_y,
                    health: crate::tree::TREE_INITIAL_HEALTH,
                    tree_type, // Assign the chosen type
                    chunk_index: chunk_idx, // Set the chunk index
                    last_hit_time: None,
                    respawn_at: None,
                }
            },
            tree_type_roll_for_this_attempt, // Pass the roll as extra_args
            trees,
        ) {
            Ok(true) => spawned_tree_count += 1,
            Ok(false) => { /* Condition not met, continue */ }
            Err(_) => { /* Error already logged in helper, continue */ }
        }
    }
     log::info!(
        "Finished seeding {} trees (target: {}, attempts: {}).",
        spawned_tree_count, target_tree_count, tree_attempts
    );

    // --- Seed Stones --- Use helper function ---
    log::info!("Seeding Stones...");
    while spawned_stone_count < target_stone_count && stone_attempts < max_stone_attempts {
        stone_attempts += 1;
         match attempt_single_spawn(
            &mut rng,
            &mut occupied_tiles,
            &mut spawned_stone_positions,
            &spawned_tree_positions,
            &[],
            min_tile_x, max_tile_x, min_tile_y, max_tile_y,
            &fbm,
            crate::tree::TREE_SPAWN_NOISE_FREQUENCY,
            crate::tree::TREE_SPAWN_NOISE_THRESHOLD,
            crate::stone::MIN_STONE_DISTANCE_SQ,
            crate::stone::MIN_STONE_TREE_DISTANCE_SQ,
            0.0,
            |pos_x, pos_y, _extra: ()| {
                // Calculate chunk index for the stone
                let chunk_idx = calculate_chunk_index(pos_x, pos_y);
                
                crate::stone::Stone {
                    id: 0,
                    pos_x,
                    pos_y,
                    health: crate::stone::STONE_INITIAL_HEALTH,
                    chunk_index: chunk_idx, // Set the chunk index
                    last_hit_time: None,
                    respawn_at: None,
                }
            },
            (),
            stones,
        ) {
            Ok(true) => spawned_stone_count += 1,
            Ok(false) => { /* Condition not met, continue */ }
            Err(_) => { /* Error already logged in helper, continue */ }
        }
    }
    log::info!(
        "Finished seeding {} stones (target: {}, attempts: {}).",
        spawned_stone_count, target_stone_count, stone_attempts
    );

    // --- Seed Mushrooms --- Use helper function ---
    log::info!("Seeding Mushrooms...");
    let mushroom_noise_threshold = 0.65; // Specific threshold for mushrooms
    while spawned_mushroom_count < target_mushroom_count && mushroom_attempts < max_mushroom_attempts {
        mushroom_attempts += 1;
        match attempt_single_spawn(
            &mut rng,
            &mut occupied_tiles,
            &mut spawned_mushroom_positions,
            &spawned_tree_positions,
            &spawned_stone_positions,
            min_tile_x, max_tile_x, min_tile_y, max_tile_y,
            &fbm,
            crate::tree::TREE_SPAWN_NOISE_FREQUENCY,
            mushroom_noise_threshold,
            crate::mushroom::MIN_MUSHROOM_DISTANCE_SQ,
            crate::mushroom::MIN_MUSHROOM_TREE_DISTANCE_SQ,
            crate::mushroom::MIN_MUSHROOM_STONE_DISTANCE_SQ,
            |pos_x, pos_y, _extra: ()| {
                // Calculate chunk index for the mushroom
                let chunk_idx = calculate_chunk_index(pos_x, pos_y);
                
                crate::mushroom::Mushroom {
                    id: 0,
                    pos_x,
                    pos_y,
                    chunk_index: chunk_idx, // Set the chunk index
                    respawn_at: None,
                }
            },
            (),
            mushrooms,
        ) {
            Ok(true) => spawned_mushroom_count += 1,
            Ok(false) => { /* Condition not met, continue */ }
            Err(_) => { /* Error already logged in helper, continue */ }
        }
    }
    log::info!(
        "Finished seeding {} mushrooms (target: {}, attempts: {}).",
        spawned_mushroom_count, target_mushroom_count, mushroom_attempts
    );

    // --- Seed Corn --- Use helper function ---
    log::info!("Seeding Corn...");
    let corn_noise_threshold = 0.70; // Specific threshold for corn
    while spawned_corn_count < target_corn_count && corn_attempts < max_corn_attempts {
        corn_attempts += 1;
        match attempt_single_spawn(
            &mut rng,
            &mut occupied_tiles,
            &mut spawned_corn_positions,
            &spawned_tree_positions,
            &spawned_stone_positions,
            min_tile_x, max_tile_x, min_tile_y, max_tile_y,
            &fbm,
            crate::tree::TREE_SPAWN_NOISE_FREQUENCY,
            corn_noise_threshold,
            crate::corn::MIN_CORN_DISTANCE_SQ,
            crate::corn::MIN_CORN_TREE_DISTANCE_SQ,
            crate::corn::MIN_CORN_STONE_DISTANCE_SQ,
            |pos_x, pos_y, _extra: ()| {
                // Calculate chunk index for the corn
                let chunk_idx = calculate_chunk_index(pos_x, pos_y);
                
                crate::corn::Corn {
                    id: 0,
                    pos_x,
                    pos_y,
                    chunk_index: chunk_idx, // Set the chunk index
                    respawn_at: None,
                }
            },
            (),
            corns,
        ) {
            Ok(true) => spawned_corn_count += 1,
            Ok(false) => { /* Condition not met, continue */ }
            Err(_) => { /* Error already logged in helper, continue */ }
        }
    }
    log::info!(
        "Finished seeding {} corn plants (target: {}, attempts: {}).",
        spawned_corn_count, target_corn_count, corn_attempts
    );

    // --- Seed Pumpkins --- Use helper function ---
    log::info!("Seeding Pumpkins...");
    let pumpkin_noise_threshold = 0.75; // Specific threshold for pumpkins
    while spawned_pumpkin_count < target_pumpkin_count && pumpkin_attempts < max_pumpkin_attempts {
        pumpkin_attempts += 1;
        match attempt_single_spawn(
            &mut rng,
            &mut occupied_tiles,
            &mut spawned_pumpkin_positions,
            &spawned_tree_positions,
            &spawned_stone_positions,
            min_tile_x, max_tile_x, min_tile_y, max_tile_y,
            &fbm,
            crate::tree::TREE_SPAWN_NOISE_FREQUENCY,
            pumpkin_noise_threshold,
            crate::pumpkin::MIN_PUMPKIN_DISTANCE_SQ,
            crate::pumpkin::MIN_PUMPKIN_TREE_DISTANCE_SQ,
            crate::pumpkin::MIN_PUMPKIN_STONE_DISTANCE_SQ,
            |pos_x, pos_y, _extra: ()| {
                // Calculate chunk index for the pumpkin
                let chunk_idx = calculate_chunk_index(pos_x, pos_y);
                
                crate::pumpkin::Pumpkin {
                    id: 0,
                    pos_x,
                    pos_y,
                    chunk_index: chunk_idx,
                    respawn_at: None,
                }
            },
            (),
            pumpkins,
        ) {
            Ok(true) => spawned_pumpkin_count += 1,
            Ok(false) => { /* Condition not met, continue */ }
            Err(_) => { /* Error already logged in helper, continue */ }
        }
    }
    log::info!(
        "Finished seeding {} pumpkins (target: {}, attempts: {}).",
        spawned_pumpkin_count, target_pumpkin_count, pumpkin_attempts
    );

    // --- Seed Hemp --- Use helper function ---
    log::info!("Seeding Hemp...");
    let hemp_noise_threshold = 0.68; // Specific threshold for hemp (adjust as needed)
    while spawned_hemp_count < target_hemp_count && hemp_attempts < max_hemp_attempts {
        hemp_attempts += 1;
        match attempt_single_spawn(
            &mut rng,
            &mut occupied_tiles,
            &mut spawned_hemp_positions, 
            &spawned_tree_positions,    
            &spawned_stone_positions,   // Consider corn positions too if they are dense
            min_tile_x, max_tile_x, min_tile_y, max_tile_y,
            &fbm,
            crate::tree::TREE_SPAWN_NOISE_FREQUENCY, 
            hemp_noise_threshold,          
            crate::hemp::MIN_HEMP_DISTANCE_SQ,
            crate::hemp::MIN_HEMP_TREE_DISTANCE_SQ,
            crate::hemp::MIN_HEMP_STONE_DISTANCE_SQ,
            |pos_x, pos_y, _extra: ()| {
                let chunk_idx = calculate_chunk_index(pos_x, pos_y);
                crate::hemp::Hemp {
                    id: 0,
                    pos_x,
                    pos_y,
                    chunk_index: chunk_idx,
                    respawn_at: None,
                }
            },
            (),
            hemps, 
        ) {
            Ok(true) => spawned_hemp_count += 1,
            Ok(false) => { /* Condition not met, continue */ }
            Err(_) => { /* Error already logged in helper, continue */ }
        }
    }
    log::info!(
        "Finished seeding {} hemps (target: {}, attempts: {}).",
        spawned_hemp_count, target_hemp_count, hemp_attempts
    );

    // --- Seed Grass --- (New Section)
    log::info!("Seeding Grass...");
    let (grass_min_tile_x, grass_max_tile_x, grass_min_tile_y, grass_max_tile_y) = 
        calculate_tile_bounds(WORLD_WIDTH_TILES, WORLD_HEIGHT_TILES, crate::grass::GRASS_SPAWN_WORLD_MARGIN_TILES);
    
    while spawned_grass_count < target_grass_count && grass_attempts < max_grass_attempts {
        grass_attempts += 1;

        // Generate random values for grass appearance and sway before the attempt_single_spawn call
        let appearance_roll_for_this_attempt: u32 = rng.gen_range(0..100);
        let sway_offset_seed_for_this_attempt: u32 = rng.gen();

        match attempt_single_spawn(
            &mut rng,
            &mut occupied_tiles, // Grass can share tiles with other non-blocking items, but not other grass or solid objects initially
            &mut spawned_grass_positions,
            &spawned_tree_positions,    
            &spawned_stone_positions,   
            grass_min_tile_x, grass_max_tile_x, grass_min_tile_y, grass_max_tile_y,
            &fbm,
            crate::grass::GRASS_SPAWN_NOISE_FREQUENCY, 
            crate::grass::GRASS_SPAWN_NOISE_THRESHOLD,          
            crate::grass::MIN_GRASS_DISTANCE_SQ,
            crate::grass::MIN_GRASS_TREE_DISTANCE_SQ,
            crate::grass::MIN_GRASS_STONE_DISTANCE_SQ,
            |pos_x, pos_y, (appearance_roll_base, sway_seed): (u32, u32)| { // Closure now accepts a tuple
                let chunk_idx = calculate_chunk_index(pos_x, pos_y);
                
                // --- NEW: Determine grass region and adjust appearance_roll ---
                let tile_x = (pos_x / TILE_SIZE_PX as f32).floor() as u32;
                let tile_y = (pos_y / TILE_SIZE_PX as f32).floor() as u32;

                let region_x = tile_x / GRASS_REGION_SIZE_TILES;
                let region_y = tile_y / GRASS_REGION_SIZE_TILES;

                let region_type_seed = region_x.wrapping_add(region_y.wrapping_mul(31));
                let region_type_roll = region_type_seed % 100; // Roll from 0-99

                let mut appearance_roll = appearance_roll_base; // Start with the random roll

                // Region Definitions:
                // 1. Tall Grass Plains (with Bramble Groves): 0-39 (40% of regions)
                // 2. Bushland: 40-59 (20% of regions)
                // 3. Default Mixed Short Grass: 60-99 (40% of regions)

                if region_type_roll < 40 { // Tall Grass Plains (40% of regions)
                    // Inside Tall Grass Plains:
                    if appearance_roll_base < 70 { // 70% chance for Tall Grass A/B
                        appearance_roll = 60 + (appearance_roll_base % 30); // Maps to 60-89 (TallGrassA/B)
                    } else if appearance_roll_base < 90 { // Next 20% chance for Brambles A/B
                        appearance_roll = 95 + (appearance_roll_base % 5); // Maps to 95-99 (BramblesA/B)
                    } else { // Remaining 10% chance for Short Grass Patches
                        appearance_roll = appearance_roll_base % 60; // Maps to 0-59 (PatchesA/B/C)
                    }
                } else if region_type_roll < 60 { // Bushland (20% of regions, from 40 up to 59)
                    // Bias towards Brambles and Tall Grass (since bushes are removed)
                    if appearance_roll_base < 60 { // 60% chance for Brambles
                        appearance_roll = 95 + (appearance_roll_base % 5); // Maps to 95-99 (BramblesA/B)
                    } else if appearance_roll_base < 85 { // Next 25% chance for Tall Grass
                        appearance_roll = 60 + (appearance_roll_base % 30); // Maps to 60-89 (TallGrassA/B)
                    }
                    // Else (remaining 15%): use original appearance_roll_base for short grass or rare bramble
                }
                // Else (remaining 40% of regions, from 60 up to 99): Default mixed short grass.
                // In this case, the original `appearance_roll_base` is used, which will mostly result in short grass types.
                // If appearance_roll_base is very high (e.g., 95-99), it could still rarely spawn a bramble.


                // Use the (potentially adjusted) appearance_roll
                let appearance_type = if appearance_roll < 20 { // 20% PatchA
                    crate::grass::GrassAppearanceType::PatchA
                } else if appearance_roll < 40 { // 20% PatchB
                    crate::grass::GrassAppearanceType::PatchB
                } else if appearance_roll < 60 { // 20% PatchC
                    crate::grass::GrassAppearanceType::PatchC
                } else if appearance_roll < 75 { // 15% TallGrassA
                    crate::grass::GrassAppearanceType::TallGrassA
                } else if appearance_roll < 90 { // 15% TallGrassB
                    crate::grass::GrassAppearanceType::TallGrassB
                } else if appearance_roll < 95 { // 5% BramblesA
                    crate::grass::GrassAppearanceType::BramblesA
                } else { // 5% BramblesB
                    crate::grass::GrassAppearanceType::BramblesB
                };

                crate::grass::Grass {
                    id: 0,
                    pos_x,
                    pos_y,
                    health: crate::grass::GRASS_INITIAL_HEALTH,
                    appearance_type,
                    chunk_index: chunk_idx,
                    last_hit_time: None,
                    respawn_at: None,
                    sway_offset_seed: sway_seed, // Use the passed-in sway_seed
                    sway_speed: 0.3f32, // Increased base sway speed to 0.3
                    // Initialize disturbance fields for new grass
                    disturbed_at: None,
                    disturbance_direction_x: 0.0,
                    disturbance_direction_y: 0.0,
                }
            },
            (appearance_roll_for_this_attempt, sway_offset_seed_for_this_attempt), // Pass the rolls as a tuple
            grasses, // Pass the grass table handle
        ) {
            Ok(true) => spawned_grass_count += 1,
            Ok(false) => { /* Condition not met, continue */ }
            Err(_) => { /* Error already logged in helper, continue */ }
        }
    }
    log::info!(
        "Finished seeding {} grass patches (target: {}, attempts: {}).",
        spawned_grass_count, target_grass_count, grass_attempts
    );
    // --- End Seed Grass ---

    // --- Seed Clouds ---
    log::info!("Seeding Clouds...");
    // Use WORLD_WIDTH_PX and WORLD_HEIGHT_PX from crate root (lib.rs)
    let world_width_px = crate::WORLD_WIDTH_PX;
    let world_height_px = crate::WORLD_HEIGHT_PX;

    while spawned_cloud_count < target_cloud_count && cloud_attempts < max_cloud_attempts {
        cloud_attempts += 1;

        let pos_x = rng.gen_range(0.0..world_width_px);
        let pos_y = rng.gen_range(0.0..world_height_px);
        
        // Basic check to avoid too many clouds in the exact same spot, though less critical.
        let mut too_close = false;
        for &(other_x, other_y) in &spawned_cloud_positions {
            let dx = pos_x - other_x;
            let dy = pos_y - other_y;
            // Using a generic minimum distance, e.g., 100px. Adjust as needed.
            if (dx * dx + dy * dy) < (100.0 * 100.0) { 
                too_close = true;
                break;
            }
        }
        if too_close {
            continue; // Try another position
        }

        // Use the existing calculate_chunk_index function from this module
        let chunk_idx = calculate_chunk_index(pos_x, pos_y);

        let shape_roll = rng.gen_range(0..5); // Corrected to 0..5 for 5 types
        let shape = match shape_roll {
            0 => crate::cloud::CloudShapeType::CloudImage1,
            1 => crate::cloud::CloudShapeType::CloudImage2,
            2 => crate::cloud::CloudShapeType::CloudImage3,
            3 => crate::cloud::CloudShapeType::CloudImage4,
            _ => crate::cloud::CloudShapeType::CloudImage5, // Default to CloudImage5
        };

        let base_width = rng.gen_range(200.0..600.0); 
        let width_variation_factor = rng.gen_range(0.7..1.3);
        let height_variation_factor = rng.gen_range(0.5..1.0); // Can be different from width factor for variety

        // Simplified width and height assignment, removing problematic match statements
        let width = base_width * width_variation_factor;
        let height = base_width * height_variation_factor; // Height based on base_width and its own factor
        
        let rotation_degrees = rng.gen_range(0.0..360.0);
        let base_opacity = rng.gen_range(0.08..0.25); 
        let blur_strength = rng.gen_range(10.0..30.0); 

        let new_cloud = crate::cloud::Cloud {
            id: 0, // auto_inc
            pos_x,
            pos_y,
            chunk_index: chunk_idx,
            shape,
            width,
            height,
            rotation_degrees,
            base_opacity,
            blur_strength,
            // --- Initialize new drift fields ---
            drift_speed_x: CLOUD_BASE_DRIFT_X + rng.gen_range(-CLOUD_DRIFT_VARIATION..CLOUD_DRIFT_VARIATION),
            drift_speed_y: CLOUD_BASE_DRIFT_Y + rng.gen_range(-CLOUD_DRIFT_VARIATION..CLOUD_DRIFT_VARIATION),
        };

        match ctx.db.cloud().try_insert(new_cloud) {
            Ok(inserted_cloud) => {
                spawned_cloud_positions.push((pos_x, pos_y));
                spawned_cloud_count += 1;
                log::info!("Inserted cloud id: {} at ({:.1}, {:.1}), chunk: {}", inserted_cloud.id, pos_x, pos_y, chunk_idx);
            }
            Err(e) => {
                log::warn!("Failed to insert cloud (attempt {}): {}. Skipping this cloud.", cloud_attempts, e);
            }
        }
    }
    log::info!(
        "Finished seeding {} clouds (target: {}, attempts: {}).",
        spawned_cloud_count, target_cloud_count, cloud_attempts
    );
    // --- End Seed Clouds ---

    // --- Schedule initial cloud update --- (NEW)
    if spawned_cloud_count > 0 {
        log::info!("Scheduling initial cloud position update.");
        let update_interval_seconds = 5.0; // How often to update cloud positions
        match ctx.db.cloud_update_schedule().try_insert(CloudUpdateSchedule {
            schedule_id: 0, // auto_inc
            scheduled_at: spacetimedb::TimeDuration::from_micros((update_interval_seconds * 1_000_000.0) as i64).into(),
            delta_time_seconds: update_interval_seconds,
        }) {
            Ok(_) => log::info!("Cloud update successfully scheduled every {} seconds.", update_interval_seconds),
            Err(e) => log::error!("Failed to schedule cloud update: {}", e),
        }
    }
    // --- End Schedule initial cloud update ---


    log::info!("Environment seeding complete.");
    Ok(())
}

// --- Resource Respawn Reducer --- Refactored using Macro ---

#[spacetimedb::reducer]
pub fn check_resource_respawns(ctx: &ReducerContext) -> Result<(), String> {
    
    // Respawn Stones
    check_and_respawn_resource!(
        ctx,
        stone, // Table symbol
        crate::stone::Stone, // Entity type
        "Stone", // Name for logging
        |s: &crate::stone::Stone| s.health == 0, // Filter: only check stones with 0 health
        |s: &mut crate::stone::Stone| { // Update logic
            s.health = crate::stone::STONE_INITIAL_HEALTH;
            s.respawn_at = None;
            s.last_hit_time = None;
        }
    );

    // Respawn Trees
    check_and_respawn_resource!(
        ctx,
        tree,
        crate::tree::Tree,
        "Tree",
        |t: &crate::tree::Tree| t.health == 0,
        |t: &mut crate::tree::Tree| {
            t.health = crate::tree::TREE_INITIAL_HEALTH;
            t.respawn_at = None;
            t.last_hit_time = None;
            // Position doesn't change during respawn, so chunk_index stays the same
        }
    );

    // Respawn Mushrooms
    check_and_respawn_resource!(
        ctx,
        mushroom,
        crate::mushroom::Mushroom,
        "Mushroom",
        |_m: &crate::mushroom::Mushroom| true, // Filter: Always check mushrooms if respawn_at is set (handled internally by macro)
        |m: &mut crate::mushroom::Mushroom| {
            m.respawn_at = None;
        }
    );

    // Respawn Corn
    check_and_respawn_resource!(
        ctx,
        corn,
        crate::corn::Corn,
        "Corn",
        |_c: &crate::corn::Corn| true, // Filter: Always check corn if respawn_at is set (handled internally by macro)
        |c: &mut crate::corn::Corn| {
            c.respawn_at = None;
        }
    );

    // Respawn Pumpkins
    check_and_respawn_resource!(
        ctx,
        pumpkin,
        crate::pumpkin::Pumpkin,
        "Pumpkin",
        |_p: &crate::pumpkin::Pumpkin| true, // Filter: Always check pumpkins if respawn_at is set (handled internally by macro)
        |p: &mut crate::pumpkin::Pumpkin| {
            p.respawn_at = None;
        }
    );

    // Respawn Hemp
    check_and_respawn_resource!(
        ctx,
        hemp, // Table symbol
        crate::hemp::Hemp, // Entity type
        "Hemp", // Name for logging
        |_h: &crate::hemp::Hemp| true, // Filter: Always check if respawn_at is set
        |h: &mut crate::hemp::Hemp| {
            h.respawn_at = None;
        }
    );

    // Respawn Grass
    check_and_respawn_resource!(
        ctx,
        grass, // Table symbol
        crate::grass::Grass, // Entity type
        "Grass", // Name for logging
        |g: &crate::grass::Grass| g.health == 0, // Filter: only check grass with 0 health
        |g: &mut crate::grass::Grass| { // Update logic
            g.health = crate::grass::GRASS_INITIAL_HEALTH;
            g.respawn_at = None;
            g.last_hit_time = None;
            // appearance_type and sway_offset_seed remain the same on respawn
        }
    );

    // Note: Clouds are static for now, so no respawn logic needed in check_resource_respawns.
    // If they were to drift or change, a similar `check_and_respawn_resource!` or a dedicated
    // scheduled reducer would be needed here or in `cloud.rs`.

    Ok(())
}
