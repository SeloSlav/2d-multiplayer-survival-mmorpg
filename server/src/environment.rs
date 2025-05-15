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

// Import table traits needed for ctx.db access
use crate::tree::tree as TreeTableTrait;
use crate::stone::stone as StoneTableTrait;
use crate::mushroom::mushroom as MushroomTableTrait;
use crate::corn::corn as CornTableTrait;
use crate::pumpkin::pumpkin as PumpkinTableTrait;
use crate::hemp::hemp as HempTableTrait;

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

    if trees.iter().count() > 0 || stones.iter().count() > 0 || mushrooms.iter().count() > 0 || corns.iter().count() > 0 || pumpkins.iter().count() > 0 || hemps.iter().count() > 0 {
        log::info!(
            "Environment already seeded (Trees: {}, Stones: {}, Mushrooms: {}, Corns: {}, Hemps: {}). Skipping.",
            trees.iter().count(), stones.iter().count(), mushrooms.iter().count(), corns.iter().count(), hemps.iter().count()
        );
        return Ok(());
    }

    log::info!("Seeding environment (trees, stones, mushrooms, corn, pumpkins, hemp)..." );

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

    log::info!("Target Trees: {}, Max Attempts: {}", target_tree_count, max_tree_attempts);
    log::info!("Target Stones: {}, Max Attempts: {}", target_stone_count, max_stone_attempts);
    log::info!("Target Mushrooms: {}, Max Attempts: {}", target_mushroom_count, max_mushroom_attempts);
    log::info!("Target Corns: {}, Max Attempts: {}", target_corn_count, max_corn_attempts);
    log::info!("Target Hemps: {}, Max Attempts: {}", target_hemp_count, max_hemp_attempts);
    log::info!("Target Pumpkins: {}, Max Attempts: {}", target_pumpkin_count, max_pumpkin_attempts);
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

    Ok(())
}
