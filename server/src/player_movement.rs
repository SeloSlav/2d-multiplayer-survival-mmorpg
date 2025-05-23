use spacetimedb::{Identity, Timestamp, ReducerContext, Table};
use log;

// Import table traits needed for database access
use crate::player as PlayerTableTrait;
use crate::tree::tree as TreeTableTrait;
use crate::stone::stone as StoneTableTrait;
use crate::wooden_storage_box::wooden_storage_box as WoodenStorageBoxTableTrait;
use crate::campfire::campfire as CampfireTableTrait;
use crate::grass::grass as GrassTableTrait;
use crate::player_stats::stat_thresholds_config as StatThresholdsConfigTableTrait;

// Import constants from lib.rs
use crate::{PLAYER_RADIUS, PLAYER_SPEED, WORLD_WIDTH_PX, WORLD_HEIGHT_PX};

// Import constants from player_stats module
use crate::player_stats::{SPRINT_SPEED_MULTIPLIER, LOW_THIRST_SPEED_PENALTY, LOW_WARMTH_SPEED_PENALTY};

// Import constants from environment module
use crate::environment::{calculate_chunk_index, WORLD_WIDTH_CHUNKS};

// Import spatial grid module
use crate::spatial_grid;

// Import grass types
use crate::grass::GrassAppearanceType;

// Update player movement, handle sprinting, and collision
#[spacetimedb::reducer]
pub fn update_player_position(
    ctx: &ReducerContext,
    // Raw direction components from client input (-1, 0, 1) - server will normalize
    move_x: f32,
    move_y: f32,
) -> Result<(), String> {
    let sender_id = ctx.sender;
    let players = ctx.db.player();
    let trees = ctx.db.tree();
    let stones = ctx.db.stone();
    let campfires = ctx.db.campfire(); // Get campfire table
    let wooden_storage_boxes = ctx.db.wooden_storage_box(); // <<< ADDED

    let current_player = players.identity()
        .find(sender_id)
        .ok_or_else(|| "Player not found".to_string())?;

    // --- If player is dead, prevent movement ---
    if current_player.is_dead {
        log::trace!("Ignoring movement input for dead player {:?}", sender_id);
        return Ok(()); // Do nothing if dead
    }

    // --- NEW: If player is knocked out, prevent sprinting ---
    let mut current_sprinting_state = current_player.is_sprinting;
    if current_player.is_knocked_out {
        current_sprinting_state = false; // Force sprinting off for knocked out players
    }

    // --- Determine Animation Direction from Input Vector ---
    let mut final_anim_direction = current_player.direction.clone();
    // Basic check: If there's significant movement
    if move_x.abs() > 0.01 || move_y.abs() > 0.01 {
        // Prioritize horizontal or vertical based on magnitude
        if move_x.abs() > move_y.abs() {
            final_anim_direction = if move_x > 0.0 { "right".to_string() } else { "left".to_string() };
        } else {
            final_anim_direction = if move_y > 0.0 { "down".to_string() } else { "up".to_string() };
        }
    }
    // If input is (0,0), keep the previous direction

    if final_anim_direction != current_player.direction {
        log::trace!("Player {:?} animation direction set to: {}", sender_id, final_anim_direction);
    }
    // --- End Animation Direction ---

    let now = ctx.timestamp;

    // --- Calculate Delta Time ---
    let elapsed_micros = now.to_micros_since_unix_epoch().saturating_sub(current_player.last_update.to_micros_since_unix_epoch());
    // Clamp max delta time to avoid huge jumps on first update or after lag spikes (e.g., 100ms)
    let delta_time_secs = (elapsed_micros as f32 / 1_000_000.0).min(0.05); // Clamp max delta time

    // --- Stamina Drain & Base Speed Calculation ---
    let mut new_stamina = current_player.stamina; // Base this on current_player for speed calc
    let mut base_speed_multiplier = 1.0;
    // Movement now depends only on having a direction input from the client
    let is_moving = move_x.abs() > 0.01 || move_y.abs() > 0.01;
    let mut current_sprinting_state = current_player.is_sprinting;

    // Determine speed multiplier based on current sprint state and stamina
    if current_sprinting_state && new_stamina > 0.0 { // Check current stamina > 0
        base_speed_multiplier = SPRINT_SPEED_MULTIPLIER;
    } else if current_sprinting_state && new_stamina <= 0.0 {
        // If trying to sprint but no stamina, force sprint state off for this tick's movement calc
        current_sprinting_state = false;
        base_speed_multiplier = 1.0; // Use base speed
        // The actual player.is_sprinting state will be forced off in player_stats.rs
    }

    // --- Calculate Final Speed Multiplier based on Current Stats ---
    let mut final_speed_multiplier = base_speed_multiplier;
    // Use current player stats read at the beginning of the reducer

    // NEW: Apply massive speed reduction if knocked out (95% slower, so 5% of normal speed)
    if current_player.is_knocked_out {
        final_speed_multiplier *= 0.05; // Only 5% of normal speed
        log::trace!("Player {:?} is knocked out. Speed multiplier reduced to: {}", sender_id, final_speed_multiplier);
    }

    // Apply fine movement speed reduction if active
    if current_player.is_crouching {
        final_speed_multiplier *= 0.5; // Reduce speed by 50%
        log::trace!("Player {:?} crouching active. Speed multiplier adjusted to: {}", sender_id, final_speed_multiplier);
    }

    // --- <<< UPDATED: Read LOW_NEED_THRESHOLD from StatThresholdsConfig table >>> ---
    let stat_thresholds_config_table = ctx.db.stat_thresholds_config(); // <<< CORRECT: Use the direct table accessor
    let stat_thresholds_config = stat_thresholds_config_table.iter().filter(|stc| stc.id == 0).next();
    
    let mut effective_speed = PLAYER_SPEED * final_speed_multiplier;
    if let Some(config) = stat_thresholds_config { // <<< UPDATED variable name
        let low_need_threshold = config.low_need_threshold;
        if current_player.thirst < low_need_threshold {
            effective_speed *= LOW_THIRST_SPEED_PENALTY;
            log::debug!("Player {:?} has low thirst. Applying speed penalty. New speed: {}", sender_id, effective_speed);
        }
        if current_player.warmth < low_need_threshold {
            effective_speed *= LOW_WARMTH_SPEED_PENALTY;
            log::debug!("Player {:?} is cold. Applying speed penalty. New speed: {}", sender_id, effective_speed);
        }
    } else {
        log::warn!("StatThresholdsConfig not found for player {}. Using default behavior (no penalty applied from config).", sender_id);
    }

    // --- Calculate Target Velocity & Server Displacement ---
    let target_speed = effective_speed;
    
    // Normalize the movement vector to prevent diagonal movement from being faster
    let move_magnitude = (move_x * move_x + move_y * move_y).sqrt();
    let (normalized_move_x, normalized_move_y) = if move_magnitude > 0.0 {
        (move_x / move_magnitude, move_y / move_magnitude)
    } else {
        (0.0, 0.0)
    };
    
    // Velocity is the properly normalized direction vector scaled by target speed
    let velocity_x = normalized_move_x * target_speed;
    let velocity_y = normalized_move_y * target_speed;

    let server_dx = velocity_x * delta_time_secs;
    let server_dy = velocity_y * delta_time_secs;


    // --- Movement Calculation ---
    // Use server-calculated displacement
    let proposed_x = current_player.position_x + server_dx;
    let proposed_y = current_player.position_y + server_dy;

    let clamped_x = proposed_x.max(PLAYER_RADIUS).min(WORLD_WIDTH_PX - PLAYER_RADIUS);
    let clamped_y = proposed_y.max(PLAYER_RADIUS).min(WORLD_HEIGHT_PX - PLAYER_RADIUS);

    let mut final_x = clamped_x;
    let mut final_y = clamped_y;
    let mut collision_handled = false;

    // --- Collision Detection (using spatial grid) ---
    let mut grid = spatial_grid::SpatialGrid::new();
    grid.populate_from_world(&ctx.db);
    let nearby_entities = grid.get_entities_in_range(clamped_x, clamped_y);

    // Check collisions with nearby entities (Slide calculation)
    for entity in &nearby_entities {
        match entity {
            spatial_grid::EntityType::Player(other_identity) => {
                if *other_identity == sender_id { continue; } // Skip self
                 // Find the player in the database
                if let Some(other_player) = players.identity().find(other_identity) {
                    // Don't collide with dead players
                    if other_player.is_dead { continue; }

                    let dx = clamped_x - other_player.position_x;
                    let dy = clamped_y - other_player.position_y;
                    let dist_sq = dx * dx + dy * dy;
                    let min_dist = PLAYER_RADIUS * 2.0; // Player-Player collision distance
                    let min_dist_sq = min_dist * min_dist;

                    if dist_sq < min_dist_sq {
                        log::debug!("Player-Player collision detected between {:?} and {:?}. Calculating slide.", sender_id, other_player.identity);
                        // Slide calculation
                        let collision_normal_x = dx;
                        let collision_normal_y = dy;
                        let normal_mag_sq = dist_sq;

                        if normal_mag_sq > 0.0 {
                            let normal_mag = normal_mag_sq.sqrt();
                            let norm_x = collision_normal_x / normal_mag;
                            let norm_y = collision_normal_y / normal_mag;
                            // Use server_dx/dy for slide calculation
                            let dot_product = server_dx * norm_x + server_dy * norm_y;
                            let projection_x = dot_product * norm_x;
                            let projection_y = dot_product * norm_y;
                            let slide_dx = server_dx - projection_x;
                            let slide_dy = server_dy - projection_y;
                            final_x = current_player.position_x + slide_dx;
                            final_y = current_player.position_y + slide_dy;
                            // Clamp after slide application
                            final_x = final_x.max(PLAYER_RADIUS).min(WORLD_WIDTH_PX - PLAYER_RADIUS);
                            final_y = final_y.max(PLAYER_RADIUS).min(WORLD_HEIGHT_PX - PLAYER_RADIUS);
                        } else {
                            // If directly overlapping (dist_sq == 0), just stay put relative to this collision
                            final_x = current_player.position_x;
                            final_y = current_player.position_y;
                        }
                        collision_handled = true;
                        // break; // Handle one collision at a time for simplicity? Or continue checking? Continuing check for now.
                    }
                }
            },
            spatial_grid::EntityType::Tree(tree_id) => {
                 // if collision_handled { continue; } // Allow checking multiple collisions?
                 if let Some(tree) = trees.id().find(tree_id) {
                    if tree.health == 0 { continue; }
                    let tree_collision_y = tree.pos_y - crate::tree::TREE_COLLISION_Y_OFFSET;
                    let dx = clamped_x - tree.pos_x;
                    let dy = clamped_y - tree_collision_y;
                    let dist_sq = dx * dx + dy * dy;
                    if dist_sq < crate::tree::PLAYER_TREE_COLLISION_DISTANCE_SQUARED {
                         log::debug!("Player-Tree collision detected between {:?} and tree {}. Calculating slide.", sender_id, tree.id);
                         // Slide calculation
                         let collision_normal_x = dx;
                         let collision_normal_y = dy;
                         let normal_mag_sq = dist_sq;
                         if normal_mag_sq > 0.0 {
                            let normal_mag = normal_mag_sq.sqrt();
                            let norm_x = collision_normal_x / normal_mag;
                            let norm_y = collision_normal_y / normal_mag;
                            // Use server_dx/dy for slide calculation
                            let dot_product = server_dx * norm_x + server_dy * norm_y;
                            let projection_x = dot_product * norm_x;
                            let projection_y = dot_product * norm_y;
                            let slide_dx = server_dx - projection_x;
                            let slide_dy = server_dy - projection_y;
                            final_x = current_player.position_x + slide_dx;
                            final_y = current_player.position_y + slide_dy;
                             // Clamp after slide application
                            final_x = final_x.max(PLAYER_RADIUS).min(WORLD_WIDTH_PX - PLAYER_RADIUS);
                            final_y = final_y.max(PLAYER_RADIUS).min(WORLD_HEIGHT_PX - PLAYER_RADIUS);
                        } else {
                            final_x = current_player.position_x;
                            final_y = current_player.position_y;
                        }
                        collision_handled = true; // Mark collision handled for this type
                    }
                }
            },
            spatial_grid::EntityType::Stone(stone_id) => {
                 // if collision_handled { continue; }
                 if let Some(stone) = stones.id().find(stone_id) {
                     if stone.health == 0 { continue; }
                     let stone_collision_y = stone.pos_y - crate::stone::STONE_COLLISION_Y_OFFSET;
                     let dx = clamped_x - stone.pos_x;
                     let dy = clamped_y - stone_collision_y;
                     let dist_sq = dx * dx + dy * dy;
                     if dist_sq < crate::stone::PLAYER_STONE_COLLISION_DISTANCE_SQUARED {
                         log::debug!("Player-Stone collision detected between {:?} and stone {}. Calculating slide.", sender_id, stone.id);
                         // Slide calculation
                         let collision_normal_x = dx;
                         let collision_normal_y = dy;
                         let normal_mag_sq = dist_sq;
                         if normal_mag_sq > 0.0 {
                             let normal_mag = normal_mag_sq.sqrt();
                             let norm_x = collision_normal_x / normal_mag;
                             let norm_y = collision_normal_y / normal_mag;
                             // Use server_dx/dy for slide calculation
                             let dot_product = server_dx * norm_x + server_dy * norm_y;
                             let projection_x = dot_product * norm_x;
                             let projection_y = dot_product * norm_y;
                             let slide_dx = server_dx - projection_x;
                             let slide_dy = server_dy - projection_y;
                             final_x = current_player.position_x + slide_dx;
                             final_y = current_player.position_y + slide_dy;
                             // Clamp after slide application
                             final_x = final_x.max(PLAYER_RADIUS).min(WORLD_WIDTH_PX - PLAYER_RADIUS);
                             final_y = final_y.max(PLAYER_RADIUS).min(WORLD_HEIGHT_PX - PLAYER_RADIUS);
                         } else {
                             final_x = current_player.position_x;
                             final_y = current_player.position_y;
                         }
                         collision_handled = true; // Mark collision handled
                     }
                 }
            },
            spatial_grid::EntityType::WoodenStorageBox(box_id) => {
                // if collision_handled { continue; }
                if let Some(box_instance) = wooden_storage_boxes.id().find(box_id) {
                    let box_collision_y = box_instance.pos_y - crate::wooden_storage_box::BOX_COLLISION_Y_OFFSET;
                    let dx = clamped_x - box_instance.pos_x;
                    let dy = clamped_y - box_collision_y;
                    let dist_sq = dx * dx + dy * dy;
                    if dist_sq < crate::wooden_storage_box::PLAYER_BOX_COLLISION_DISTANCE_SQUARED {
                         log::debug!("Player-Box collision detected between {:?} and box {}. Calculating slide.", sender_id, box_instance.id);
                         // Slide calculation
                         let collision_normal_x = dx;
                         let collision_normal_y = dy;
                         let normal_mag_sq = dist_sq;
                         if normal_mag_sq > 0.0 {
                             let normal_mag = normal_mag_sq.sqrt();
                             let norm_x = collision_normal_x / normal_mag;
                             let norm_y = collision_normal_y / normal_mag;
                             // Use server_dx/dy for slide calculation
                             let dot_product = server_dx * norm_x + server_dy * norm_y;
                             let projection_x = dot_product * norm_x;
                             let projection_y = dot_product * norm_y;
                             let slide_dx = server_dx - projection_x;
                             let slide_dy = server_dy - projection_y;
                             final_x = current_player.position_x + slide_dx;
                             final_y = current_player.position_y + slide_dy;
                             // Clamp after slide application
                             final_x = final_x.max(PLAYER_RADIUS).min(WORLD_WIDTH_PX - PLAYER_RADIUS);
                             final_y = final_y.max(PLAYER_RADIUS).min(WORLD_HEIGHT_PX - PLAYER_RADIUS);
                         } else {
                             final_x = current_player.position_x;
                             final_y = current_player.position_y;
                         }
                         collision_handled = true; // Mark collision handled
                    }
                }
            },
             spatial_grid::EntityType::Campfire(_) => {
                // No collision with campfires
             },
            _ => {} // Ignore other types for collision
        }
        // If a slide occurred, the 'clamped_x/y' used for subsequent checks in this loop iteration
        // won't reflect the slide. This might lead to missed secondary collisions after sliding.
        // For simplicity, we keep it this way for now. A more robust solution would re-check
        // collisions after each slide within the loop, or use the push-out method below.
    }
    // --- End Initial Collision Check ---


    // --- Iterative Collision Resolution (Push-out) ---
    // Apply push-out based on the potentially slid final_x/final_y
    let mut resolved_x = final_x;
    let mut resolved_y = final_y;
    let resolution_iterations = 5;
    let epsilon = 0.01;

    for _iter in 0..resolution_iterations {
        let mut overlap_found_in_iter = false;
        // Re-query near the currently resolved position for this iteration
        let nearby_entities_resolve = grid.get_entities_in_range(resolved_x, resolved_y);

        for entity in &nearby_entities_resolve {
             match entity {
                 spatial_grid::EntityType::Player(other_identity) => {
                    if *other_identity == sender_id { continue; }
                    if let Some(other_player) = players.identity().find(other_identity) {
                         if other_player.is_dead { continue; } // Don't resolve against dead players
                         let dx = resolved_x - other_player.position_x;
                         let dy = resolved_y - other_player.position_y;
                         let dist_sq = dx * dx + dy * dy;
                         let min_dist = PLAYER_RADIUS * 2.0;
                         let min_dist_sq = min_dist * min_dist;
                         if dist_sq < min_dist_sq && dist_sq > 0.0 {
                             overlap_found_in_iter = true;
                             let distance = dist_sq.sqrt();
                             let overlap = min_dist - distance;
                             let push_amount = (overlap / 2.0) + epsilon; // Push each player half the overlap
                             let push_x = (dx / distance) * push_amount;
                             let push_y = (dy / distance) * push_amount;
                             resolved_x += push_x;
                             resolved_y += push_y;
                             // Note: This only pushes the current player. Ideally, both would be pushed.
                             // Full resolution is complex. This provides basic separation.
                         }
                    }
                },
                 spatial_grid::EntityType::Tree(tree_id) => {
                     if let Some(tree) = trees.id().find(tree_id) {
                         if tree.health == 0 { continue; }
                         let tree_collision_y = tree.pos_y - crate::tree::TREE_COLLISION_Y_OFFSET;
                         let dx = resolved_x - tree.pos_x;
                         let dy = resolved_y - tree_collision_y;
                         let dist_sq = dx * dx + dy * dy;
                         let min_dist = PLAYER_RADIUS + crate::tree::TREE_TRUNK_RADIUS;
                         let min_dist_sq = min_dist * min_dist;
                         if dist_sq < min_dist_sq && dist_sq > 0.0 {
                             overlap_found_in_iter = true;
                             let distance = dist_sq.sqrt();
                             let overlap = (min_dist - distance) + epsilon; // Calculate overlap
                             let push_x = (dx / distance) * overlap; // Push player away by full overlap
                             let push_y = (dy / distance) * overlap;
                             resolved_x += push_x;
                             resolved_y += push_y;
                         }
                     }
                },
                 spatial_grid::EntityType::Stone(stone_id) => {
                    if let Some(stone) = stones.id().find(stone_id) {
                        if stone.health == 0 { continue; }
                        let stone_collision_y = stone.pos_y - crate::stone::STONE_COLLISION_Y_OFFSET;
                        let dx = resolved_x - stone.pos_x;
                        let dy = resolved_y - stone_collision_y;
                        let dist_sq = dx * dx + dy * dy;
                        let min_dist = PLAYER_RADIUS + crate::stone::STONE_RADIUS;
                        let min_dist_sq = min_dist * min_dist;
                        if dist_sq < min_dist_sq && dist_sq > 0.0 {
                             overlap_found_in_iter = true;
                             let distance = dist_sq.sqrt();
                             let overlap = (min_dist - distance) + epsilon;
                             let push_x = (dx / distance) * overlap;
                             let push_y = (dy / distance) * overlap;
                             resolved_x += push_x;
                             resolved_y += push_y;
                        }
                    }
                },
                 spatial_grid::EntityType::WoodenStorageBox(box_id) => {
                     if let Some(box_instance) = wooden_storage_boxes.id().find(box_id) {
                         let box_collision_y = box_instance.pos_y - crate::wooden_storage_box::BOX_COLLISION_Y_OFFSET;
                         let dx = resolved_x - box_instance.pos_x;
                         let dy = resolved_y - box_collision_y;
                         let dist_sq = dx * dx + dy * dy;
                         let min_dist = PLAYER_RADIUS + crate::wooden_storage_box::BOX_COLLISION_RADIUS;
                         let min_dist_sq = min_dist * min_dist;
                         if dist_sq < min_dist_sq && dist_sq > 0.0 {
                             overlap_found_in_iter = true;
                             let distance = dist_sq.sqrt();
                             let overlap = (min_dist - distance) + epsilon;
                             let push_x = (dx / distance) * overlap;
                             let push_y = (dy / distance) * overlap;
                             resolved_x += push_x;
                             resolved_y += push_y;
                         }
                     }
                },
                 spatial_grid::EntityType::Campfire(_) => {
                     // No overlap resolution with campfires
                 },
                _ => {}
             }
        }

        // Clamp position after each iteration's adjustments
        resolved_x = resolved_x.max(PLAYER_RADIUS).min(WORLD_WIDTH_PX - PLAYER_RADIUS);
        resolved_y = resolved_y.max(PLAYER_RADIUS).min(WORLD_HEIGHT_PX - PLAYER_RADIUS);

        if !overlap_found_in_iter {
            // log::trace!("Overlap resolution complete after {} iterations.", _iter + 1);
            break;
        }
        if _iter == resolution_iterations - 1 {
            log::warn!("Overlap resolution reached max iterations ({}) for player {:?}. Position might still overlap slightly.", resolution_iterations, sender_id);
        }
    }
    // --- End Collision Resolution ---

    // --- NEW: Grass Disturbance Detection (OPTIMIZED) ---
    // Only check for grass disturbance if player is actually moving with meaningful distance
    const MIN_MOVEMENT_FOR_DISTURBANCE: f32 = 3.0; // Increased threshold slightly
    let movement_magnitude = (server_dx * server_dx + server_dy * server_dy).sqrt();
    
    // Check grass disturbance on every movement (user requested to revert frequency reduction)
    let should_check_disturbance = is_moving && movement_magnitude > MIN_MOVEMENT_FOR_DISTURBANCE;
    
    if should_check_disturbance {
        let grasses = ctx.db.grass();
        let current_time = ctx.timestamp;
        
        // Calculate movement direction for disturbance (opposite to player movement)
        if movement_magnitude > 0.0 {
            let normalized_movement_x = server_dx / movement_magnitude;
            let normalized_movement_y = server_dy / movement_magnitude;
            
            // Grass should sway in opposite direction to player movement
            let disturbance_direction_x = -normalized_movement_x;
            let disturbance_direction_y = -normalized_movement_y;
            
            // OPTIMIZATION: Use smaller radius for better performance while still being visually impactful
            const OPTIMIZED_DISTURBANCE_RADIUS: f32 = 48.0; // Changed back to 48.0 per user request
            const OPTIMIZED_DISTURBANCE_RADIUS_SQ: f32 = OPTIMIZED_DISTURBANCE_RADIUS * OPTIMIZED_DISTURBANCE_RADIUS;
            
            // OPTIMIZATION: Only check current chunk and immediate neighbors (smaller area)
            let player_chunk_index = calculate_chunk_index(resolved_x, resolved_y);
            let chunk_x = player_chunk_index % WORLD_WIDTH_CHUNKS;
            let chunk_y = player_chunk_index / WORLD_WIDTH_CHUNKS;
            
            let mut chunks_to_check = Vec::new();
            // Only check 3x3 grid but prioritize current chunk
            for dy in -1i32..=1i32 {
                for dx in -1i32..=1i32 {
                    let new_chunk_x = chunk_x as i32 + dx;
                    let new_chunk_y = chunk_y as i32 + dy;
                    
                    if new_chunk_x >= 0 && new_chunk_x < WORLD_WIDTH_CHUNKS as i32 &&
                       new_chunk_y >= 0 && new_chunk_y < WORLD_WIDTH_CHUNKS as i32 {
                        let chunk_idx = (new_chunk_y as u32 * WORLD_WIDTH_CHUNKS + new_chunk_x as u32);
                        chunks_to_check.push(chunk_idx);
                    }
                }
            }
            
            // OPTIMIZATION: Limit max disturbances per movement to prevent huge batches
            const MAX_DISTURBANCES_PER_MOVEMENT: usize = 8;
            let mut disturbed_count = 0;
            let chunks_set: std::collections::HashSet<u32> = chunks_to_check.iter().cloned().collect();
            
            // OPTIMIZATION: Collect updates to batch them
            let mut grass_updates = Vec::new();
            
            for grass in grasses.iter() {
                if disturbed_count >= MAX_DISTURBANCES_PER_MOVEMENT {
                    break; // Limit disturbances per movement
                }
                
                // Skip grass not in nearby chunks
                if !chunks_set.contains(&grass.chunk_index) { continue; }
                
                // Skip grass that's already destroyed
                if grass.health == 0 { continue; }
                
                // OPTIMIZATION: Skip grass that was recently disturbed (within last 500ms)
                if let Some(last_disturbed) = grass.disturbed_at {
                    let time_since_last_disturbance = current_time.to_micros_since_unix_epoch()
                        .saturating_sub(last_disturbed.to_micros_since_unix_epoch());
                    if time_since_last_disturbance < 500_000 { // 500ms in microseconds
                        continue;
                    }
                }
                
                // Only disturb certain grass types (not brambles)
                let should_disturb = match grass.appearance_type {
                    crate::grass::GrassAppearanceType::PatchA |
                    crate::grass::GrassAppearanceType::PatchB |
                    crate::grass::GrassAppearanceType::PatchC |
                    crate::grass::GrassAppearanceType::TallGrassA |
                    crate::grass::GrassAppearanceType::TallGrassB => true,
                    _ => false,
                };
                
                if !should_disturb { continue; }
                
                // Check if player is within disturbance radius of this grass
                let dx = resolved_x - grass.pos_x;
                let dy = resolved_y - grass.pos_y;
                let dist_sq = dx * dx + dy * dy;
                
                if dist_sq <= OPTIMIZED_DISTURBANCE_RADIUS_SQ {
                    // Prepare update for this grass
                    let mut grass_to_update = grass.clone();
                    grass_to_update.disturbed_at = Some(current_time);
                    grass_to_update.disturbance_direction_x = disturbance_direction_x;
                    grass_to_update.disturbance_direction_y = disturbance_direction_y;
                    
                    grass_updates.push(grass_to_update);
                    disturbed_count += 1;
                }
            }
            
            // OPTIMIZATION: Batch apply all updates
            for grass_update in grass_updates {
                grasses.id().update(grass_update);
            }
            
            if disturbed_count > 0 {
                log::trace!("Player {:?} disturbed {} grass patches (limit: {})", sender_id, disturbed_count, MAX_DISTURBANCES_PER_MOVEMENT);
            }
        }
    }
    // --- End Grass Disturbance Detection ---

    // --- Final Update ---
    let mut player_to_update = current_player; // Get a mutable copy from the initial read

    // Check if position or direction actually changed
    let position_changed = (resolved_x - player_to_update.position_x).abs() > 0.01 ||
                           (resolved_y - player_to_update.position_y).abs() > 0.01;
    // Check against the animation direction determined earlier
    let direction_changed = player_to_update.direction != final_anim_direction;
    // Don't check stamina/sprint changes here, they are handled by player_stats
    let should_update_state = position_changed || direction_changed;

    // Always update timestamp if delta_time > 0 to prevent accumulation on next tick
    // This ensures last_update reflects the time this reducer processed movement,
    // even if the final position/direction didn't change due to collision or no input.
    let needs_timestamp_update = delta_time_secs > 0.0;

    if should_update_state {
        log::trace!("Updating player {:?} - PosChange: {}, DirChange: {}",
            sender_id, position_changed, direction_changed);

        player_to_update.position_x = resolved_x;
        player_to_update.position_y = resolved_y;
        player_to_update.direction = final_anim_direction; // Update animation direction
        player_to_update.last_update = now; // Update timestamp because state changed

        players.identity().update(player_to_update); // Update the modified player struct
    } else if needs_timestamp_update { // If no state changed, but time passed
         log::trace!("No movement state changes detected for player {:?}, but updating timestamp due to elapsed time.", sender_id);
         // Update only the timestamp on the existing player data
         player_to_update.last_update = now;
         players.identity().update(player_to_update);
    } else {
         // This case should be rare (delta_time <= 0.0)
         log::trace!("No state changes and no time elapsed for player {:?}, skipping update.", sender_id);
    }

    Ok(())
}