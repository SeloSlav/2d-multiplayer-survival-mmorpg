/*
 * server/src/utils.rs
 *
 * Purpose: Contains reusable helper functions and macros used across various server modules.
 *
 * Benefits: 
 *   - Reduces code duplication by encapsulating common logic.
 *   - Improves maintainability by centralizing shared functionality.
 *   - Enhances code readability in the modules that use these helpers.
 *
 * Examples:
 *   - `attempt_single_spawn`: Generic function for spawning resources during environment seeding.
 *   - `check_and_respawn_resource`: Macro for handling the logic of checking and respawning resources.
 */

use spacetimedb::{ReducerContext, Table, SpacetimeType, Timestamp};
use noise::NoiseFn;
use rand::{Rng, rngs::StdRng};
use std::collections::HashSet;
use log;

// Assuming these are accessible from the crate root
use crate::{WORLD_WIDTH_PX, WORLD_HEIGHT_PX, TILE_SIZE_PX, PLAYER_RADIUS};

// Import table traits needed for collision checks
use crate::{
    player as PlayerTableTrait,
    campfire::campfire as CampfireTableTrait,
    wooden_storage_box::wooden_storage_box as WoodenStorageBoxTableTrait,
};

/// Calculates the valid min/max tile coordinates based on world dimensions and a margin.
pub fn calculate_tile_bounds(world_width_tiles: u32, world_height_tiles: u32, margin: u32) -> (u32, u32, u32, u32) {
    let min_tile_x = margin;
    let max_tile_x = world_width_tiles.saturating_sub(margin);
    let min_tile_y = margin;
    let max_tile_y = world_height_tiles.saturating_sub(margin);
    // Ensure min is less than max, handle edge cases where margin is too large
    (
        min_tile_x.min(max_tile_x), 
        max_tile_x, 
        min_tile_y.min(max_tile_y), 
        max_tile_y
    )
}

/// Checks if the given position (pos_x, pos_y) is closer than min_dist_sq to any position in existing_positions.
/// Returns true if too close, false otherwise.
pub fn check_distance_sq(pos_x: f32, pos_y: f32, existing_positions: &[(f32, f32)], min_dist_sq: f32) -> bool {
    for (existing_x, existing_y) in existing_positions {
        let dx = pos_x - existing_x;
        let dy = pos_y - existing_y;
        if (dx * dx + dy * dy) < min_dist_sq {
            return true; // Too close
        }
    }
    false // Not too close
}

/// Calculates the squared distance between two 2D points.
#[inline] // Suggest inlining for performance
pub fn get_distance_squared(x1: f32, y1: f32, x2: f32, y2: f32) -> f32 {
    let dx = x1 - x2;
    let dy = y1 - y2;
    dx * dx + dy * dy
}

/// Checks if a target position is clear of players, campfires, and wooden storage boxes
/// within a given squared radius. Returns true if clear, false otherwise.
pub fn is_respawn_position_clear(ctx: &ReducerContext, target_x: f32, target_y: f32, check_radius_sq: f32) -> bool {
    // Check players
    let players = ctx.db.player();
    for player in players.iter() {
        if !player.is_dead {
            let dist_sq = get_distance_squared(target_x, target_y, player.position_x, player.position_y);
            // Use PLAYER_RADIUS and the global RESPAWN_CHECK_RADIUS for collision check against players
            let player_check_radius_sq = (crate::PLAYER_RADIUS + crate::RESPAWN_CHECK_RADIUS) * (crate::PLAYER_RADIUS + crate::RESPAWN_CHECK_RADIUS);
            if dist_sq < player_check_radius_sq {
                log::trace!("Respawn blocked by player {:?} at ({}, {})", player.identity, player.position_x, player.position_y);
                return false;
            }
        }
    }

    // Check campfires
    let campfires = ctx.db.campfire();
    for campfire in campfires.iter() {
        let dist_sq = get_distance_squared(target_x, target_y, campfire.pos_x, campfire.pos_y);
        if dist_sq < check_radius_sq { // Use the passed-in check_radius_sq (which will be crate::RESPAWN_CHECK_RADIUS_SQ)
            log::trace!("Respawn blocked by campfire {} at ({}, {})", campfire.id, campfire.pos_x, campfire.pos_y);
            return false;
        }
    }

    // Check wooden storage boxes
    let storage_boxes = ctx.db.wooden_storage_box();
    for storage_box in storage_boxes.iter() {
        let dist_sq = get_distance_squared(target_x, target_y, storage_box.pos_x, storage_box.pos_y);
        if dist_sq < check_radius_sq { // Use the passed-in check_radius_sq
            log::trace!("Respawn blocked by storage box {} at ({}, {})", storage_box.id, storage_box.pos_x, storage_box.pos_y);
            return false;
        }
    }

    true // Position is clear
}

/// Attempts one resource spawn at a random valid tile.
/// Handles noise check, distance checks, and insertion.
/// Returns Ok(true) if successful, Ok(false) if conditions not met (e.g., tile occupied, too close), Err on DB error.
pub fn attempt_single_spawn<T, F, N, R, A>(
    rng: &mut R, // Generic RNG type
    occupied_tiles: &mut HashSet<(u32, u32)>,
    spawned_positions: &mut Vec<(f32, f32)>, // Keep mutable for adding
    spawned_tree_positions: &[(f32, f32)],
    spawned_stone_positions: &[(f32, f32)],
    min_tile_x: u32,
    max_tile_x: u32,
    min_tile_y: u32,
    max_tile_y: u32,
    noise_fn: &N,
    noise_freq: f64,
    noise_threshold: f64,
    min_dist_sq_self: f32,
    min_dist_sq_tree: f32,
    min_dist_sq_stone: f32,
    create_entity: F,
    extra_arg: A, // Add generic argument for extra data needed by create_entity
    table: &impl Table<Row = T>, // Use `impl Trait` for the table
) -> Result<bool, String> // Return standard String error
where
    T: Clone + SpacetimeType + 'static, 
    F: FnOnce(f32, f32, A) -> T, // Closure now accepts extra_arg
    N: NoiseFn<f64, 2>, // Correct NoiseFn signature
    R: Rng + ?Sized, // Make RNG generic
{
    // Generate random tile coordinates
    if min_tile_x >= max_tile_x || min_tile_y >= max_tile_y {
        log::warn!("Invalid tile bounds for spawning: ({}-{}, {}-{})", min_tile_x, max_tile_x, min_tile_y, max_tile_y);
        return Ok(false); // Cannot generate range
    }
    let tile_x = rng.gen_range(min_tile_x..max_tile_x);
    let tile_y = rng.gen_range(min_tile_y..max_tile_y);

    // Check occupancy
    if occupied_tiles.contains(&(tile_x, tile_y)) {
        return Ok(false);
    }

    // Calculate position
    let pos_x = (tile_x as f32 + 0.5) * TILE_SIZE_PX as f32;
    let pos_y = (tile_y as f32 + 0.5) * TILE_SIZE_PX as f32;

    // Noise check
    let noise_val = noise_fn.get([
        (pos_x as f64 / WORLD_WIDTH_PX as f64) * noise_freq,
        (pos_y as f64 / WORLD_HEIGHT_PX as f64) * noise_freq,
    ]);
    let normalized_noise = (noise_val + 1.0) / 2.0;
    if normalized_noise <= noise_threshold { 
        return Ok(false);
    }

    // Distance checks (perform all checks *before* potential insertion)
    // Check against self using an immutable slice borrow of the mutable vec
    if check_distance_sq(pos_x, pos_y, &spawned_positions, min_dist_sq_self) {
        return Ok(false);
    }
    // Check against other resource types
    if check_distance_sq(pos_x, pos_y, spawned_tree_positions, min_dist_sq_tree) {
        return Ok(false);
    }
    if check_distance_sq(pos_x, pos_y, spawned_stone_positions, min_dist_sq_stone) {
        return Ok(false);
    }

    // Create and insert
    let entity = create_entity(pos_x, pos_y, extra_arg); // Pass extra_arg to closure
    match table.try_insert(entity) {
        Ok(_) => {
            // If insertion succeeded, update tracking collections
            occupied_tiles.insert((tile_x, tile_y));
            spawned_positions.push((pos_x, pos_y)); // Add to the mutable vec now
            Ok(true)
        }
        Err(e) => {
            log::error!("Failed to insert entity during seeding: {}", e);
            Err(e.to_string()) // Convert error to String
        }
    }
}

/// Macro to handle the identification and respawning logic for a specific resource type.
/// Takes the context, table trait name (symbol), entity type, resource name (string),
/// a filter closure, and an update closure.
/// Now includes collision checking and position offsetting using global constants.
#[macro_export] // Export the macro for use in other modules
macro_rules! check_and_respawn_resource {
    (
        $ctx:expr,                 // ReducerContext
        $table_symbol:ident,       // Symbol for the table accessor (e.g., stone, tree)
        $entity_type:ty,           // The struct type (e.g., crate::stone::Stone)
        $resource_name:expr,       // String literal for logging ("Stone", "Tree", etc.)
        $filter_logic:expr,        // Closure |entity: &$entity_type| -> bool (checks if potentially respawnable, e.g., health == 0)
        $update_closure:expr       // Closure |entity: &mut $entity_type| { ... } (resets state)
    ) => {
        {
            let table_accessor = $ctx.db.$table_symbol();
            let now_ts = $ctx.timestamp;
            let mut ids_to_respawn: Vec<u64> = Vec::new();

            // --- Identification Phase ---
            // Assume entity has fields `id: u64`, `respawn_at: Option<Timestamp>`, `pos_x: f32`, `pos_y: f32`
            for entity in table_accessor.iter() {
                let filter_passes = $filter_logic(&entity);
                let respawn_at_opt = entity.respawn_at;

                if filter_passes && respawn_at_opt.is_some() {
                    if let Some(respawn_time) = respawn_at_opt {
                        if now_ts >= respawn_time {
                            ids_to_respawn.push(entity.id);
                        }
                    }
                }
            }

            // --- Update Phase with Collision Check & Offset ---
            for entity_id in ids_to_respawn {
                // Re-fetch the table accessor as the previous borrow might have ended
                let table_accessor_update = $ctx.db.$table_symbol();
                if let Some(mut entity) = table_accessor_update.id().find(entity_id) {
                    let original_pos_x = entity.pos_x;
                    let original_pos_y = entity.pos_y;
                    let mut current_pos_x = original_pos_x;
                    let mut current_pos_y = original_pos_y;
                    let mut position_clear = false;

                    // Check initial position and attempt offsets
                    // Use crate:: prefixed constants now
                    for attempt in 0..=crate::MAX_RESPAWN_OFFSET_ATTEMPTS { // Include initial check (attempt 0)
                        // Use the fully qualified path to the helper function and the global constant
                        if crate::utils::is_respawn_position_clear($ctx, current_pos_x, current_pos_y, crate::RESPAWN_CHECK_RADIUS_SQ) {
                            position_clear = true;
                            if attempt > 0 {
                                log::info!(
                                    "Respawning {} {} at offset position ({:.1}, {:.1}) due to blockage at original ({:.1}, {:.1}). Attempt {}",
                                    $resource_name, entity_id,
                                    current_pos_x, current_pos_y,
                                    original_pos_x, original_pos_y,
                                    attempt
                                );
                                // Update position only if offset and a clear spot was found
                                entity.pos_x = current_pos_x;
                                entity.pos_y = current_pos_y;
                            } else {
                                 // Original position is clear, no offset needed, log respawn
                                 log::info!("Respawning {} {} at original position ({:.1}, {:.1}).", $resource_name, entity_id, original_pos_x, original_pos_y);
                            }
                            break; // Found clear spot
                        }

                        // If not clear and more attempts left, calculate next offset position (simple spiral-like pattern)
                        // Use crate:: prefixed constants now
                        if attempt < crate::MAX_RESPAWN_OFFSET_ATTEMPTS {
                            // Simple offset strategy: move outwards in cardinal/diagonal directions
                            let (dx, dy) = match attempt % 8 {
                                0 => (crate::RESPAWN_OFFSET_DISTANCE, 0.0), // Right
                                1 => (0.0, crate::RESPAWN_OFFSET_DISTANCE), // Down
                                2 => (-crate::RESPAWN_OFFSET_DISTANCE, 0.0), // Left
                                3 => (0.0, -crate::RESPAWN_OFFSET_DISTANCE), // Up
                                4 => (crate::RESPAWN_OFFSET_DISTANCE, crate::RESPAWN_OFFSET_DISTANCE), // Down-Right
                                5 => (-crate::RESPAWN_OFFSET_DISTANCE, crate::RESPAWN_OFFSET_DISTANCE), // Down-Left
                                6 => (-crate::RESPAWN_OFFSET_DISTANCE, -crate::RESPAWN_OFFSET_DISTANCE), // Up-Left
                                _ => (crate::RESPAWN_OFFSET_DISTANCE, -crate::RESPAWN_OFFSET_DISTANCE), // Up-Right (7)
                            };
                            current_pos_x = original_pos_x + dx;
                            current_pos_y = original_pos_y + dy;
                            // Optional: Add bounds check here if needed
                        } else {
                            // Max attempts reached, log and skip respawn for this cycle
                            // Use crate:: prefixed constant now
                            log::warn!(
                                "Could not find clear respawn position for {} {} near ({:.1}, {:.1}) after {} attempts. Skipping respawn.",
                                $resource_name, entity_id, original_pos_x, original_pos_y, crate::MAX_RESPAWN_OFFSET_ATTEMPTS + 1 // +1 because we check 0..=MAX
                            );
                            // Ensure position_clear remains false
                        }
                    }

                    // If a clear position was found (original or offset), apply updates
                    if position_clear {
                        $update_closure(&mut entity); // Apply the state reset logic (health, respawn_at=None, etc.)
                        // Position was already set inside the loop if needed
                        table_accessor_update.id().update(entity); // Update the entity in DB
                    } // else: Skipped respawn, logged warning above

                } else {
                    log::warn!("Could not find {} {} to respawn.", $resource_name, entity_id);
                }
            }
        }
    };
}
