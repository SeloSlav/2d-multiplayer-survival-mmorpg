use spacetimedb::{ReducerContext, Table, Identity, Timestamp};
use log;
use crate::spatial_grid; // Assuming spatial_grid is a module in your crate
use crate::{PLAYER_RADIUS, WORLD_WIDTH_PX, WORLD_HEIGHT_PX}; // Global constants

// Import table traits (adjust paths as necessary)
use crate::player as PlayerTableTrait;
use crate::tree::tree as TreeTableTrait;
use crate::stone::stone as StoneTableTrait;
use crate::wooden_storage_box::wooden_storage_box as WoodenStorageBoxTableTrait;
// Campfire might not be needed for collision, but include if it is
// use crate::campfire::campfire as CampfireTableTrait;


/// Calculates initial collision and applies sliding.
/// Returns the new (x, y) position after potential sliding.
pub fn calculate_slide_collision(
    ctx: &ReducerContext,
    sender_id: Identity,
    current_player_pos_x: f32,
    current_player_pos_y: f32,
    proposed_x: f32,
    proposed_y: f32,
    server_dx: f32, // Original displacement vector for this frame
    server_dy: f32,
) -> (f32, f32) {
    let mut final_x = proposed_x.max(PLAYER_RADIUS).min(WORLD_WIDTH_PX - PLAYER_RADIUS);
    let mut final_y = proposed_y.max(PLAYER_RADIUS).min(WORLD_HEIGHT_PX - PLAYER_RADIUS);

    let players = ctx.db.player();
    let trees = ctx.db.tree();
    let stones = ctx.db.stone();
    let wooden_storage_boxes = ctx.db.wooden_storage_box();

    let mut grid = spatial_grid::SpatialGrid::new();
    grid.populate_from_world(&ctx.db);
    let nearby_entities = grid.get_entities_in_range(final_x, final_y);

    for entity in &nearby_entities {
        match entity {
            spatial_grid::EntityType::Player(other_identity) => {
                if *other_identity == sender_id { continue; }
                if let Some(other_player) = players.identity().find(other_identity) {
                    if other_player.is_dead { continue; }
                    let dx = final_x - other_player.position_x;
                    let dy = final_y - other_player.position_y;
                    let dist_sq = dx * dx + dy * dy;
                    let min_dist = PLAYER_RADIUS * 2.0;
                    let min_dist_sq = min_dist * min_dist;

                    if dist_sq < min_dist_sq {
                        log::debug!("Player-Player collision for slide: {:?} vs {:?}", sender_id, other_identity);
                        let collision_normal_x = dx;
                        let collision_normal_y = dy;
                        let normal_mag_sq = dist_sq;

                        if normal_mag_sq > 0.0 {
                            let normal_mag = normal_mag_sq.sqrt();
                            let norm_x = collision_normal_x / normal_mag;
                            let norm_y = collision_normal_y / normal_mag;
                            let dot_product = server_dx * norm_x + server_dy * norm_y;
                            let projection_x = dot_product * norm_x;
                            let projection_y = dot_product * norm_y;
                            let slide_dx = server_dx - projection_x;
                            let slide_dy = server_dy - projection_y;
                            final_x = current_player_pos_x + slide_dx;
                            final_y = current_player_pos_y + slide_dy;
                            final_x = final_x.max(PLAYER_RADIUS).min(WORLD_WIDTH_PX - PLAYER_RADIUS);
                            final_y = final_y.max(PLAYER_RADIUS).min(WORLD_HEIGHT_PX - PLAYER_RADIUS);
                        } else {
                            final_x = current_player_pos_x;
                            final_y = current_player_pos_y;
                        }
                        // collision_handled = true; // This flag is local to the original func, not strictly needed here
                                                // as we are directly modifying final_x, final_y
                    }
                }
            },
            spatial_grid::EntityType::Tree(tree_id) => {
                 if let Some(tree) = trees.id().find(tree_id) {
                    if tree.health == 0 { continue; }
                    let tree_collision_y = tree.pos_y - crate::tree::TREE_COLLISION_Y_OFFSET;
                    let dx = final_x - tree.pos_x;
                    let dy = final_y - tree_collision_y;
                    let dist_sq = dx * dx + dy * dy;
                    if dist_sq < crate::tree::PLAYER_TREE_COLLISION_DISTANCE_SQUARED {
                        log::debug!("Player-Tree collision for slide: {:?} vs tree {}", sender_id, tree.id);
                         let collision_normal_x = dx;
                         let collision_normal_y = dy;
                         let normal_mag_sq = dist_sq;
                         if normal_mag_sq > 0.0 {
                            let normal_mag = normal_mag_sq.sqrt();
                            let norm_x = collision_normal_x / normal_mag;
                            let norm_y = collision_normal_y / normal_mag;
                            let dot_product = server_dx * norm_x + server_dy * norm_y;
                            let projection_x = dot_product * norm_x;
                            let projection_y = dot_product * norm_y;
                            let slide_dx = server_dx - projection_x;
                            let slide_dy = server_dy - projection_y;
                            final_x = current_player_pos_x + slide_dx;
                            final_y = current_player_pos_y + slide_dy;
                            final_x = final_x.max(PLAYER_RADIUS).min(WORLD_WIDTH_PX - PLAYER_RADIUS);
                            final_y = final_y.max(PLAYER_RADIUS).min(WORLD_HEIGHT_PX - PLAYER_RADIUS);
                        } else {
                            final_x = current_player_pos_x;
                            final_y = current_player_pos_y;
                        }
                    }
                }
            },
            spatial_grid::EntityType::Stone(stone_id) => {
                 if let Some(stone) = stones.id().find(stone_id) {
                     if stone.health == 0 { continue; }
                     let stone_collision_y = stone.pos_y - crate::stone::STONE_COLLISION_Y_OFFSET;
                     let dx = final_x - stone.pos_x;
                     let dy = final_y - stone_collision_y;
                     let dist_sq = dx * dx + dy * dy;
                     if dist_sq < crate::stone::PLAYER_STONE_COLLISION_DISTANCE_SQUARED {
                        log::debug!("Player-Stone collision for slide: {:?} vs stone {}", sender_id, stone.id);
                         let collision_normal_x = dx;
                         let collision_normal_y = dy;
                         let normal_mag_sq = dist_sq;
                         if normal_mag_sq > 0.0 {
                             let normal_mag = normal_mag_sq.sqrt();
                             let norm_x = collision_normal_x / normal_mag;
                             let norm_y = collision_normal_y / normal_mag;
                             let dot_product = server_dx * norm_x + server_dy * norm_y;
                             let projection_x = dot_product * norm_x;
                             let projection_y = dot_product * norm_y;
                             let slide_dx = server_dx - projection_x;
                             let slide_dy = server_dy - projection_y;
                             final_x = current_player_pos_x + slide_dx;
                             final_y = current_player_pos_y + slide_dy;
                             final_x = final_x.max(PLAYER_RADIUS).min(WORLD_WIDTH_PX - PLAYER_RADIUS);
                             final_y = final_y.max(PLAYER_RADIUS).min(WORLD_HEIGHT_PX - PLAYER_RADIUS);
                         } else {
                             final_x = current_player_pos_x;
                             final_y = current_player_pos_y;
                         }
                     }
                 }
            },
            spatial_grid::EntityType::WoodenStorageBox(box_id) => {
                if let Some(box_instance) = wooden_storage_boxes.id().find(box_id) {
                    let box_collision_y = box_instance.pos_y - crate::wooden_storage_box::BOX_COLLISION_Y_OFFSET;
                    let dx = final_x - box_instance.pos_x;
                    let dy = final_y - box_collision_y;
                    let dist_sq = dx * dx + dy * dy;
                    if dist_sq < crate::wooden_storage_box::PLAYER_BOX_COLLISION_DISTANCE_SQUARED {
                        log::debug!("Player-Box collision for slide: {:?} vs box {}", sender_id, box_instance.id);
                         let collision_normal_x = dx;
                         let collision_normal_y = dy;
                         let normal_mag_sq = dist_sq;
                         if normal_mag_sq > 0.0 {
                             let normal_mag = normal_mag_sq.sqrt();
                             let norm_x = collision_normal_x / normal_mag;
                             let norm_y = collision_normal_y / normal_mag;
                             let dot_product = server_dx * norm_x + server_dy * norm_y;
                             let projection_x = dot_product * norm_x;
                             let projection_y = dot_product * norm_y;
                             let slide_dx = server_dx - projection_x;
                             let slide_dy = server_dy - projection_y;
                             final_x = current_player_pos_x + slide_dx;
                             final_y = current_player_pos_y + slide_dy;
                             final_x = final_x.max(PLAYER_RADIUS).min(WORLD_WIDTH_PX - PLAYER_RADIUS);
                             final_y = final_y.max(PLAYER_RADIUS).min(WORLD_HEIGHT_PX - PLAYER_RADIUS);
                         } else {
                             final_x = current_player_pos_x;
                             final_y = current_player_pos_y;
                         }
                    }
                }
            },
            _ => {} // Campfire, etc. - no slide collision
        }
    }
    (final_x, final_y)
}

/// Resolves collisions by iteratively pushing the player out of overlapping objects.
/// Returns the resolved (x, y) position.
pub fn resolve_push_out_collision(
    ctx: &ReducerContext,
    sender_id: Identity,
    initial_x: f32, // Position after potential slide
    initial_y: f32,
) -> (f32, f32) {
    let mut resolved_x = initial_x;
    let mut resolved_y = initial_y;
    let resolution_iterations = 5;
    let epsilon = 0.01; // Small value to prevent floating point issues and ensure separation

    let players = ctx.db.player();
    let trees = ctx.db.tree();
    let stones = ctx.db.stone();
    let wooden_storage_boxes = ctx.db.wooden_storage_box();
    
    let mut grid = spatial_grid::SpatialGrid::new();
    // Populate grid once before iterations, assuming entities don't move during resolution
    grid.populate_from_world(&ctx.db);

    for _iter in 0..resolution_iterations {
        let mut overlap_found_in_iter = false;
        // Re-querying grid for nearby entities can be intensive if called every iteration.
        // For static objects, could query once. For players, it's more complex.
        // Current spatial_grid.get_entities_in_range is cheap if grid is already populated.
        let nearby_entities_resolve = grid.get_entities_in_range(resolved_x, resolved_y);

        for entity in &nearby_entities_resolve {
             match entity {
                 spatial_grid::EntityType::Player(other_identity) => {
                    if *other_identity == sender_id { continue; }
                    if let Some(other_player) = players.identity().find(other_identity) {
                         if other_player.is_dead { continue; }
                         let dx = resolved_x - other_player.position_x;
                         let dy = resolved_y - other_player.position_y;
                         let dist_sq = dx * dx + dy * dy;
                         let min_dist = PLAYER_RADIUS * 2.0;
                         let min_dist_sq = min_dist * min_dist;
                         if dist_sq < min_dist_sq && dist_sq > 0.0 { // Added dist_sq > 0.0 to avoid division by zero
                             overlap_found_in_iter = true;
                             let distance = dist_sq.sqrt();
                             let overlap = min_dist - distance;
                             // Push current player by half the overlap, ideally other player also pushed.
                             let push_amount = (overlap / 2.0) + epsilon; 
                             resolved_x += (dx / distance) * push_amount;
                             resolved_y += (dy / distance) * push_amount;
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
                             let overlap = (min_dist - distance) + epsilon;
                             resolved_x += (dx / distance) * overlap;
                             resolved_y += (dy / distance) * overlap;
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
                             resolved_x += (dx / distance) * overlap;
                             resolved_y += (dy / distance) * overlap;
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
                             resolved_x += (dx / distance) * overlap;
                             resolved_y += (dy / distance) * overlap;
                         }
                     }
                },
                _ => {} // Campfire, etc. - no push-out resolution
             }
        }

        resolved_x = resolved_x.max(PLAYER_RADIUS).min(WORLD_WIDTH_PX - PLAYER_RADIUS);
        resolved_y = resolved_y.max(PLAYER_RADIUS).min(WORLD_HEIGHT_PX - PLAYER_RADIUS);

        if !overlap_found_in_iter {
            break;
        }
        if _iter == resolution_iterations - 1 {
             log::warn!("Push-out collision resolution reached max iterations for {:?}. Position: ({}, {})", sender_id, resolved_x, resolved_y);
        }
    }
    (resolved_x, resolved_y)
}
