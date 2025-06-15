use spacetimedb::{ReducerContext, Table, Identity, Timestamp};
use log;
use crate::spatial_grid; // Assuming spatial_grid is a module in your crate
use crate::{PLAYER_RADIUS, WORLD_WIDTH_PX, WORLD_HEIGHT_PX, get_effective_player_radius}; // Global constants

// Import table traits (adjust paths as necessary)
use crate::player as PlayerTableTrait;
use crate::tree::tree as TreeTableTrait;
use crate::stone::stone as StoneTableTrait;
use crate::wooden_storage_box::wooden_storage_box as WoodenStorageBoxTableTrait;
use crate::player_corpse::{PlayerCorpse, CORPSE_COLLISION_RADIUS, PLAYER_CORPSE_COLLISION_DISTANCE_SQUARED, CORPSE_COLLISION_Y_OFFSET}; // Assuming CORPSE_COLLISION_RADIUS is what we need for simple circle vs circle.
use crate::player_corpse::player_corpse as PlayerCorpseTableTrait; // Ensure trait for fetching
use crate::shelter::{
    Shelter, SHELTER_COLLISION_WIDTH, SHELTER_COLLISION_HEIGHT,
    SHELTER_AABB_HALF_WIDTH, SHELTER_AABB_HALF_HEIGHT,
    SHELTER_AABB_CENTER_Y_OFFSET_FROM_POS_Y
};
use crate::shelter::shelter as ShelterTableTrait;

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
    let mut final_x = proposed_x;
    let mut final_y = proposed_y;
    
    // 🚀 GRAVITY WELL FIX: Add minimum separation for sliding collision
    const SLIDE_SEPARATION_DISTANCE: f32 = 8.0; // Ensure separation after sliding

    let players = ctx.db.player();
    let trees = ctx.db.tree();
    let stones = ctx.db.stone();
    let wooden_storage_boxes = ctx.db.wooden_storage_box();
    let player_corpses = ctx.db.player_corpse(); // Access player_corpse table
    let shelters = ctx.db.shelter(); // Access shelter table
    
    // GET: Current player's crouching state for effective radius calculation
    let current_player = players.identity().find(&sender_id);
    let current_player_radius = if let Some(player) = current_player {
        get_effective_player_radius(player.is_crouching)
    } else {
        PLAYER_RADIUS // Fallback to default radius
    };

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
                    let min_dist = (current_player_radius * 2.0) + SLIDE_SEPARATION_DISTANCE; // Add separation
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
                            
                            // Only slide if moving toward the object (dot_product < 0)
                            if dot_product < 0.0 {
                                let projection_x = dot_product * norm_x;
                                let projection_y = dot_product * norm_y;
                                let slide_dx = server_dx - projection_x;
                                let slide_dy = server_dy - projection_y;
                                final_x = current_player_pos_x + slide_dx;
                                final_y = current_player_pos_y + slide_dy;
                                
                                // 🛡️ SEPARATION ENFORCEMENT: Ensure minimum separation after sliding
                                let final_dx = final_x - other_player.position_x;
                                let final_dy = final_y - other_player.position_y;
                                let final_dist = (final_dx * final_dx + final_dy * final_dy).sqrt();
                                if final_dist < min_dist {
                                    let separation_direction = if final_dist > 0.001 {
                                        (final_dx / final_dist, final_dy / final_dist)
                                    } else {
                                        (1.0, 0.0) // Default direction
                                    };
                                    final_x = other_player.position_x + separation_direction.0 * min_dist;
                                    final_y = other_player.position_y + separation_direction.1 * min_dist;
                                }
                            }
                            final_x = final_x.max(current_player_radius).min(WORLD_WIDTH_PX - current_player_radius);
                            final_y = final_y.max(current_player_radius).min(WORLD_HEIGHT_PX - current_player_radius);
                        }
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
                    let min_dist = current_player_radius + crate::tree::TREE_TRUNK_RADIUS + SLIDE_SEPARATION_DISTANCE; // Add separation
                    let min_dist_sq = min_dist * min_dist;
                    
                    if dist_sq < min_dist_sq {
                        log::debug!("Player-Tree collision for slide: {:?} vs tree {}", sender_id, tree.id);
                         let collision_normal_x = dx;
                         let collision_normal_y = dy;
                         let normal_mag_sq = dist_sq;
                         if normal_mag_sq > 0.0 {
                            let normal_mag = normal_mag_sq.sqrt();
                            let norm_x = collision_normal_x / normal_mag;
                            let norm_y = collision_normal_y / normal_mag;
                            let dot_product = server_dx * norm_x + server_dy * norm_y;
                            
                            // Only slide if moving toward the object (dot_product < 0)
                            if dot_product < 0.0 {
                                let projection_x = dot_product * norm_x;
                                let projection_y = dot_product * norm_y;
                                let slide_dx = server_dx - projection_x;
                                let slide_dy = server_dy - projection_y;
                                final_x = current_player_pos_x + slide_dx;
                                final_y = current_player_pos_y + slide_dy;
                                
                                // 🛡️ SEPARATION ENFORCEMENT: Ensure minimum separation after sliding
                                let final_dx = final_x - tree.pos_x;
                                let final_dy = final_y - tree_collision_y;
                                let final_dist = (final_dx * final_dx + final_dy * final_dy).sqrt();
                                if final_dist < min_dist {
                                    let separation_direction = if final_dist > 0.001 {
                                        (final_dx / final_dist, final_dy / final_dist)
                                    } else {
                                        (1.0, 0.0) // Default direction
                                    };
                                    final_x = tree.pos_x + separation_direction.0 * min_dist;
                                    final_y = tree_collision_y + separation_direction.1 * min_dist;
                                }
                            }
                            final_x = final_x.max(current_player_radius).min(WORLD_WIDTH_PX - current_player_radius);
                            final_y = final_y.max(current_player_radius).min(WORLD_HEIGHT_PX - current_player_radius);
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
                     let min_dist = current_player_radius + crate::stone::STONE_RADIUS + SLIDE_SEPARATION_DISTANCE; // Add separation
                     let min_dist_sq = min_dist * min_dist;
                     
                     if dist_sq < min_dist_sq {
                        log::debug!("Player-Stone collision for slide: {:?} vs stone {}", sender_id, stone.id);
                         let collision_normal_x = dx;
                         let collision_normal_y = dy;
                         let normal_mag_sq = dist_sq;
                         if normal_mag_sq > 0.0 {
                             let normal_mag = normal_mag_sq.sqrt();
                             let norm_x = collision_normal_x / normal_mag;
                             let norm_y = collision_normal_y / normal_mag;
                             let dot_product = server_dx * norm_x + server_dy * norm_y;
                             
                             // Only slide if moving toward the object (dot_product < 0)
                             if dot_product < 0.0 {
                                 let projection_x = dot_product * norm_x;
                                 let projection_y = dot_product * norm_y;
                                 let slide_dx = server_dx - projection_x;
                                 let slide_dy = server_dy - projection_y;
                                 final_x = current_player_pos_x + slide_dx;
                                 final_y = current_player_pos_y + slide_dy;
                                 
                                 // 🛡️ SEPARATION ENFORCEMENT: Ensure minimum separation after sliding
                                 let final_dx = final_x - stone.pos_x;
                                 let final_dy = final_y - stone_collision_y;
                                 let final_dist = (final_dx * final_dx + final_dy * final_dy).sqrt();
                                 if final_dist < min_dist {
                                     let separation_direction = if final_dist > 0.001 {
                                         (final_dx / final_dist, final_dy / final_dist)
                                     } else {
                                         (1.0, 0.0) // Default direction
                                     };
                                     final_x = stone.pos_x + separation_direction.0 * min_dist;
                                     final_y = stone_collision_y + separation_direction.1 * min_dist;
                                 }
                             }
                             final_x = final_x.max(current_player_radius).min(WORLD_WIDTH_PX - current_player_radius);
                             final_y = final_y.max(current_player_radius).min(WORLD_HEIGHT_PX - current_player_radius);
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
                    let min_dist = current_player_radius + crate::wooden_storage_box::BOX_COLLISION_RADIUS + SLIDE_SEPARATION_DISTANCE; // Add separation
                    let min_dist_sq = min_dist * min_dist;
                    
                    if dist_sq < min_dist_sq {
                        log::debug!("Player-Box collision for slide: {:?} vs box {}", sender_id, box_instance.id);
                         let collision_normal_x = dx;
                         let collision_normal_y = dy;
                         let normal_mag_sq = dist_sq;
                         if normal_mag_sq > 0.0 {
                             let normal_mag = normal_mag_sq.sqrt();
                             let norm_x = collision_normal_x / normal_mag;
                             let norm_y = collision_normal_y / normal_mag;
                             let dot_product = server_dx * norm_x + server_dy * norm_y;
                             
                             // Only slide if moving toward the object (dot_product < 0)
                             if dot_product < 0.0 {
                                 let projection_x = dot_product * norm_x;
                                 let projection_y = dot_product * norm_y;
                                 let slide_dx = server_dx - projection_x;
                                 let slide_dy = server_dy - projection_y;
                                 final_x = current_player_pos_x + slide_dx;
                                 final_y = current_player_pos_y + slide_dy;
                                 
                                 // 🛡️ SEPARATION ENFORCEMENT: Ensure minimum separation after sliding
                                 let final_dx = final_x - box_instance.pos_x;
                                 let final_dy = final_y - box_collision_y;
                                 let final_dist = (final_dx * final_dx + final_dy * final_dy).sqrt();
                                 if final_dist < min_dist {
                                     let separation_direction = if final_dist > 0.001 {
                                         (final_dx / final_dist, final_dy / final_dist)
                                     } else {
                                         (1.0, 0.0) // Default direction
                                     };
                                     final_x = box_instance.pos_x + separation_direction.0 * min_dist;
                                     final_y = box_collision_y + separation_direction.1 * min_dist;
                                 }
                             }
                             final_x = final_x.max(current_player_radius).min(WORLD_WIDTH_PX - current_player_radius);
                             final_y = final_y.max(current_player_radius).min(WORLD_HEIGHT_PX - current_player_radius);
                         }
                    }
                }
            },
            spatial_grid::EntityType::Shelter(shelter_id) => { // ADDED Shelter slide logic
                if let Some(shelter) = shelters.id().find(shelter_id) {
                    if shelter.is_destroyed { continue; }
                    // Collision only for non-owners
                    if shelter.placed_by == sender_id { continue; }

                    let shelter_aabb_center_x = shelter.pos_x;
                    let shelter_aabb_center_y = shelter.pos_y - SHELTER_AABB_CENTER_Y_OFFSET_FROM_POS_Y;

                    // AABB collision detection
                    let closest_x = final_x.max(shelter_aabb_center_x - SHELTER_AABB_HALF_WIDTH).min(shelter_aabb_center_x + SHELTER_AABB_HALF_WIDTH);
                    let closest_y = final_y.max(shelter_aabb_center_y - SHELTER_AABB_HALF_HEIGHT).min(shelter_aabb_center_y + SHELTER_AABB_HALF_HEIGHT);

                    let dx_aabb = final_x - closest_x;
                    let dy_aabb = final_y - closest_y;
                    let dist_sq_aabb = dx_aabb * dx_aabb + dy_aabb * dy_aabb;
                    let player_radius_sq = current_player_radius * current_player_radius;

                    if dist_sq_aabb < player_radius_sq {
                        log::debug!(
                            "[ShelterSlideCollision] Player {:?} vs Shelter {}: PlayerY: {:.1}, ShelterBaseY: {:.1}, OffsetConst: {:.1}, AABBCenterY: {:.1}, AABBHalfHeightConst: {:.1}, ClosestY: {:.1}, DistSq: {:.1}, PlayerRadSq: {:.1}",
                            sender_id, shelter.id,
                            final_y, // Player's current Y
                            shelter.pos_y,
                            SHELTER_AABB_CENTER_Y_OFFSET_FROM_POS_Y,
                            shelter_aabb_center_y,
                            SHELTER_AABB_HALF_HEIGHT,
                            closest_y,
                            dist_sq_aabb,
                            player_radius_sq
                        );
                        let collision_normal_x = dx_aabb;
                        let collision_normal_y = dy_aabb;
                        let normal_mag_sq = dist_sq_aabb;

                        if normal_mag_sq > 0.0 {
                            let normal_mag = normal_mag_sq.sqrt();
                            let norm_x = collision_normal_x / normal_mag;
                            let norm_y = collision_normal_y / normal_mag;
                            let dot_product = server_dx * norm_x + server_dy * norm_y;
                            if dot_product > 0.0 { // Moving towards the shelter AABB
                                let projection_x = dot_product * norm_x;
                                let projection_y = dot_product * norm_y;
                                let slide_dx = server_dx - projection_x;
                                let slide_dy = server_dy - projection_y;
                                final_x = current_player_pos_x + slide_dx;
                                final_y = current_player_pos_y + slide_dy;
                                final_x = final_x.max(current_player_radius).min(WORLD_WIDTH_PX - current_player_radius);
                                final_y = final_y.max(current_player_radius).min(WORLD_HEIGHT_PX - current_player_radius);
                            }
                        } else {
                            // Player center is exactly on the closest point, attempt small slide or revert
                            // This case is less likely with AABB but good to handle
                            final_x = current_player_pos_x;
                            final_y = current_player_pos_y;
                        }
                    } else { // ADDED ELSE FOR DEBUGGING
                        log::debug!(
                            "[ShelterSlideNOCollision] Player {:?} vs Shelter {}: PlayerY: {:.1}, ShelterBaseY: {:.1}, OffsetConst: {:.1}, AABBCenterY: {:.1}, AABBHalfHeightConst: {:.1}, ClosestY: {:.1}, DistSq: {:.1} (NO COLLISION >= {:.1})",
                            sender_id, shelter.id,
                            final_y,
                            shelter.pos_y,
                            SHELTER_AABB_CENTER_Y_OFFSET_FROM_POS_Y,
                            shelter_aabb_center_y,
                            SHELTER_AABB_HALF_HEIGHT,
                            closest_y,
                            dist_sq_aabb,
                            player_radius_sq
                        );
                    }
                }
            },
            spatial_grid::EntityType::PlayerCorpse(corpse_id) => { // ADDED PlayerCorpse slide logic
                if let Some(corpse) = player_corpses.id().find(corpse_id) {
                    // Player corpses are static obstacles; player should slide around them.
                    // Using simple circle collision similar to stones/trees for sliding.
                    let corpse_collision_y = corpse.pos_y - CORPSE_COLLISION_Y_OFFSET;
                    let dx = final_x - corpse.pos_x;
                    let dy = final_y - corpse_collision_y;
                    let dist_sq = dx * dx + dy * dy;
                    let min_dist = current_player_radius + CORPSE_COLLISION_RADIUS + SLIDE_SEPARATION_DISTANCE; // Add separation
                    let min_dist_sq = min_dist * min_dist;

                    if dist_sq < min_dist_sq {
                        log::debug!("Player-Corpse collision for slide: {:?} vs corpse {}", sender_id, corpse.id);
                        let collision_normal_x = dx;
                        let collision_normal_y = dy;
                        let normal_mag_sq = dist_sq;
                        if normal_mag_sq > 0.0 {
                            let normal_mag = normal_mag_sq.sqrt();
                            let norm_x = collision_normal_x / normal_mag;
                            let norm_y = collision_normal_y / normal_mag;
                            let dot_product = server_dx * norm_x + server_dy * norm_y;
                            
                            // Only slide if moving toward the object (dot_product < 0)
                            if dot_product < 0.0 {
                                let projection_x = dot_product * norm_x;
                                let projection_y = dot_product * norm_y;
                                let slide_dx = server_dx - projection_x;
                                let slide_dy = server_dy - projection_y;
                                final_x = current_player_pos_x + slide_dx;
                                final_y = current_player_pos_y + slide_dy;
                                
                                // 🛡️ SEPARATION ENFORCEMENT: Ensure minimum separation after sliding
                                let final_dx = final_x - corpse.pos_x;
                                let final_dy = final_y - corpse_collision_y;
                                let final_dist = (final_dx * final_dx + final_dy * final_dy).sqrt();
                                if final_dist < min_dist {
                                    let separation_direction = if final_dist > 0.001 {
                                        (final_dx / final_dist, final_dy / final_dist)
                                    } else {
                                        (1.0, 0.0) // Default direction
                                    };
                                    final_x = corpse.pos_x + separation_direction.0 * min_dist;
                                    final_y = corpse_collision_y + separation_direction.1 * min_dist;
                                }
                            }
                        } else {
                            // Fallback: ensure minimum separation
                            final_x = corpse.pos_x + SLIDE_SEPARATION_DISTANCE;
                            final_y = corpse_collision_y;
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
    log::debug!("[PushOutStart] Player {:?} starting push-out at ({:.1}, {:.1})", sender_id, initial_x, initial_y);
    
    let mut resolved_x = initial_x;
    let mut resolved_y = initial_y;
    let resolution_iterations = 5;
    // 🚀 GRAVITY WELL FIX: Much larger separation to prevent trapping
    let separation_distance = 10.0; // Increased from 0.01 to 10.0 pixels for proper separation

    let players = ctx.db.player();
    let trees = ctx.db.tree();
    let stones = ctx.db.stone();
    let wooden_storage_boxes = ctx.db.wooden_storage_box();
    let player_corpses = ctx.db.player_corpse(); // Access player_corpse table
    let shelters = ctx.db.shelter(); // Access shelter table
    
    // GET: Current player's crouching state for effective radius calculation
    let current_player = players.identity().find(&sender_id);
    let current_player_radius = if let Some(player) = current_player {
        get_effective_player_radius(player.is_crouching)
    } else {
        PLAYER_RADIUS // Fallback to default radius
    };
    
    let mut grid = spatial_grid::SpatialGrid::new();
    // Populate grid once before iterations, assuming entities don't move during resolution
    grid.populate_from_world(&ctx.db);

    for _iter in 0..resolution_iterations {
        let mut overlap_found_in_iter = false;
        // Re-querying grid for nearby entities can be intensive if called every iteration.
        // For static objects, could query once. For players, it's more complex.
        // Current spatial_grid.get_entities_in_range is cheap if grid is already populated.
        let nearby_entities_resolve = grid.get_entities_in_range(resolved_x, resolved_y);
        
        log::debug!("[PushOutIter] Player {:?} iteration {} at ({:.1}, {:.1}), found {} nearby entities", 
                   sender_id, _iter, resolved_x, resolved_y, nearby_entities_resolve.len());

        for entity in &nearby_entities_resolve {
             match entity {
                 spatial_grid::EntityType::Player(other_identity) => {
                    log::debug!("[PushOutEntityType] Found Player: {:?}", other_identity);
                    if *other_identity == sender_id { continue; }
                    if let Some(other_player) = players.identity().find(other_identity) {
                         if other_player.is_dead { continue; }
                         let dx = resolved_x - other_player.position_x;
                         let dy = resolved_y - other_player.position_y;
                         let dist_sq = dx * dx + dy * dy;
                         let min_dist = current_player_radius * 2.0 + separation_distance; // Add separation
                         let min_dist_sq = min_dist * min_dist;
                         if dist_sq < min_dist_sq && dist_sq > 0.0 { // Added dist_sq > 0.0 to avoid division by zero
                             overlap_found_in_iter = true;
                             let distance = dist_sq.sqrt();
                             let overlap = (min_dist - distance) + separation_distance; // Ensure separation
                             // Push current player by the full overlap amount for proper separation
                             resolved_x += (dx / distance) * overlap;
                             resolved_y += (dy / distance) * overlap;
                         }
                    }
                },
                 spatial_grid::EntityType::Tree(tree_id) => {
                     log::debug!("[PushOutEntityType] Found Tree: {}", tree_id);
                     if let Some(tree) = trees.id().find(tree_id) {
                         if tree.health == 0 { continue; }
                         let tree_collision_y = tree.pos_y - crate::tree::TREE_COLLISION_Y_OFFSET;
                         let dx = resolved_x - tree.pos_x;
                         let dy = resolved_y - tree_collision_y;
                         let dist_sq = dx * dx + dy * dy;
                         let min_dist = current_player_radius + crate::tree::TREE_TRUNK_RADIUS + separation_distance; // Add separation
                         let min_dist_sq = min_dist * min_dist;
                         if dist_sq < min_dist_sq && dist_sq > 0.0 {
                             overlap_found_in_iter = true;
                             let distance = dist_sq.sqrt();
                             let overlap = (min_dist - distance) + separation_distance; // Ensure separation
                             resolved_x += (dx / distance) * overlap;
                             resolved_y += (dy / distance) * overlap;
                         }
                     }
                },
                 spatial_grid::EntityType::Stone(stone_id) => {
                    log::debug!("[PushOutEntityType] Found Stone: {}", stone_id);
                    if let Some(stone) = stones.id().find(stone_id) {
                        if stone.health == 0 { continue; }
                        let stone_collision_y = stone.pos_y - crate::stone::STONE_COLLISION_Y_OFFSET;
                        let dx = resolved_x - stone.pos_x;
                        let dy = resolved_y - stone_collision_y;
                        let dist_sq = dx * dx + dy * dy;
                        let min_dist = current_player_radius + crate::stone::STONE_RADIUS + separation_distance; // Add separation
                        let min_dist_sq = min_dist * min_dist;
                        if dist_sq < min_dist_sq && dist_sq > 0.0 {
                             overlap_found_in_iter = true;
                             let distance = dist_sq.sqrt();
                             let overlap = (min_dist - distance) + separation_distance; // Ensure separation
                             resolved_x += (dx / distance) * overlap;
                             resolved_y += (dy / distance) * overlap;
                        }
                    }
                },
                 spatial_grid::EntityType::WoodenStorageBox(box_id) => {
                     log::debug!("[PushOutEntityType] Found WoodenStorageBox: {}", box_id);
                     if let Some(box_instance) = wooden_storage_boxes.id().find(box_id) {
                         let box_collision_y = box_instance.pos_y - crate::wooden_storage_box::BOX_COLLISION_Y_OFFSET;
                         let dx = resolved_x - box_instance.pos_x;
                         let dy = resolved_y - box_collision_y;
                         let dist_sq = dx * dx + dy * dy;
                         let min_dist = current_player_radius + crate::wooden_storage_box::BOX_COLLISION_RADIUS + separation_distance; // Add separation
                         let min_dist_sq = min_dist * min_dist;
                         if dist_sq < min_dist_sq && dist_sq > 0.0 {
                             overlap_found_in_iter = true;
                             let distance = dist_sq.sqrt();
                             let overlap = (min_dist - distance) + separation_distance; // Ensure separation
                             resolved_x += (dx / distance) * overlap;
                             resolved_y += (dy / distance) * overlap;
                         }
                     }
                },
                spatial_grid::EntityType::Shelter(shelter_id) => { // ADDED Shelter push-out logic
                    log::debug!("[PushOutEntityType] Found Shelter: {}", shelter_id);
                    log::debug!("[PushOutShelterFound] Player {:?} found shelter {} in push-out", sender_id, shelter_id);
                    if let Some(shelter) = shelters.id().find(shelter_id) {
                        if shelter.is_destroyed { 
                            log::debug!("[PushOutShelterDestroyed] Shelter {} is destroyed, skipping", shelter_id);
                            continue; 
                        }
                        // Collision only for non-owners
                        if shelter.placed_by == sender_id { 
                            log::debug!("[PushOutShelterOwner] Player {:?} is owner of shelter {}, skipping collision", sender_id, shelter_id);
                            continue; 
                        }
                        
                        log::debug!("[PushOutShelterProcessing] Player {:?} (non-owner) processing collision with shelter {}", sender_id, shelter_id);

                        let shelter_aabb_center_x = shelter.pos_x;
                        let shelter_aabb_center_y = shelter.pos_y - SHELTER_AABB_CENTER_Y_OFFSET_FROM_POS_Y;

                        // AABB collision detection for push-out
                        let closest_x = resolved_x.max(shelter_aabb_center_x - SHELTER_AABB_HALF_WIDTH).min(shelter_aabb_center_x + SHELTER_AABB_HALF_WIDTH);
                        let closest_y = resolved_y.max(shelter_aabb_center_y - SHELTER_AABB_HALF_HEIGHT).min(shelter_aabb_center_y + SHELTER_AABB_HALF_HEIGHT);
                        
                        let dx_resolve = resolved_x - closest_x;
                        let dy_resolve = resolved_y - closest_y;
                        let dist_sq_resolve = dx_resolve * dx_resolve + dy_resolve * dy_resolve;
                        
                        log::debug!(
                            "[PushOutShelterAABB] Player {:?} vs Shelter {}: PlayerPos: ({:.1}, {:.1}), ShelterBase: ({:.1}, {:.1}), AABBCenter: ({:.1}, {:.1}), AABBBounds: ({:.1}-{:.1}, {:.1}-{:.1}), Closest: ({:.1}, {:.1}), DistSq: {:.1}, PlayerRadSq: {:.1}",
                            sender_id, shelter_id,
                            resolved_x, resolved_y,
                            shelter.pos_x, shelter.pos_y,
                            shelter_aabb_center_x, shelter_aabb_center_y,
                            shelter_aabb_center_x - SHELTER_AABB_HALF_WIDTH, shelter_aabb_center_x + SHELTER_AABB_HALF_WIDTH,
                            shelter_aabb_center_y - SHELTER_AABB_HALF_HEIGHT, shelter_aabb_center_y + SHELTER_AABB_HALF_HEIGHT,
                            closest_x, closest_y,
                            dist_sq_resolve,
                            current_player_radius * current_player_radius
                        );
                        
                        if dist_sq_resolve < current_player_radius * current_player_radius {
                            overlap_found_in_iter = true;
                            if dist_sq_resolve > 0.0 {
                                let distance = dist_sq_resolve.sqrt();
                                let overlap = (current_player_radius - distance) + separation_distance; // Push out by the overlap plus separation
                                resolved_x += (dx_resolve / distance) * overlap;
                                resolved_y += (dy_resolve / distance) * overlap;
                                log::debug!(
                                    "[ShelterPushNormal] Player {:?} vs Shelter {}: ResolvedXY: ({:.1}, {:.1}), Distance: {:.1}, Overlap: {:.1}",
                                    sender_id, shelter.id, resolved_x, resolved_y, distance, overlap
                                );
                            } else { // Player center is inside the AABB - push to nearest face
                                log::debug!(
                                    "[ShelterPushInside] Player {:?} vs Shelter {}: ResolvedXY: ({:.1}, {:.1}), AABBCenter: ({:.1}, {:.1}), AABBHalfSize: ({:.1}, {:.1})",
                                    sender_id, shelter.id, resolved_x, resolved_y, shelter_aabb_center_x, shelter_aabb_center_y, SHELTER_AABB_HALF_WIDTH, SHELTER_AABB_HALF_HEIGHT
                                );
                                
                                // Calculate AABB bounds for clarity
                                let aabb_left = shelter_aabb_center_x - SHELTER_AABB_HALF_WIDTH;
                                let aabb_right = shelter_aabb_center_x + SHELTER_AABB_HALF_WIDTH;
                                let aabb_top = shelter_aabb_center_y - SHELTER_AABB_HALF_HEIGHT;
                                let aabb_bottom = shelter_aabb_center_y + SHELTER_AABB_HALF_HEIGHT;
                                
                                log::debug!(
                                    "[ShelterPushBounds] AABB bounds: Left: {:.1}, Right: {:.1}, Top: {:.1}, Bottom: {:.1}",
                                    aabb_left, aabb_right, aabb_top, aabb_bottom
                                );
                                
                                // Calculate penetration depth on each axis
                                let penetration_left = (resolved_x - aabb_left).abs();
                                let penetration_right = (aabb_right - resolved_x).abs();
                                let penetration_top = (resolved_y - aabb_top).abs();
                                let penetration_bottom = (aabb_bottom - resolved_y).abs();
                                
                                log::debug!(
                                    "[ShelterPushPenetration] Penetrations - Left: {:.1}, Right: {:.1}, Top: {:.1}, Bottom: {:.1}",
                                    penetration_left, penetration_right, penetration_top, penetration_bottom
                                );
                                
                                // Find the minimum penetration (closest face)
                                let min_x_penetration = penetration_left.min(penetration_right);
                                let min_y_penetration = penetration_top.min(penetration_bottom);
                                
                                let old_resolved_x = resolved_x;
                                let old_resolved_y = resolved_y;
                                
                                if min_x_penetration < min_y_penetration {
                                    // Push out horizontally (left or right face is closer)
                                    if penetration_left < penetration_right {
                                        // Push out through left face
                                        resolved_x = aabb_left - current_player_radius - separation_distance;
                                        log::debug!("[ShelterPushDirection] Pushing LEFT: new X = {:.1}", resolved_x);
                                    } else {
                                        // Push out through right face
                                        resolved_x = aabb_right + current_player_radius + separation_distance;
                                        log::debug!("[ShelterPushDirection] Pushing RIGHT: new X = {:.1}", resolved_x);
                                    }
                                } else {
                                    // Push out vertically (top or bottom face is closer)
                                    if penetration_top < penetration_bottom {
                                        // Push out through top face
                                        resolved_y = aabb_top - current_player_radius - separation_distance;
                                        log::debug!("[ShelterPushDirection] Pushing UP: new Y = {:.1}", resolved_y);
                                    } else {
                                        // Push out through bottom face
                                        resolved_y = aabb_bottom + current_player_radius + separation_distance;
                                        log::debug!("[ShelterPushDirection] Pushing DOWN: new Y = {:.1}", resolved_y);
                                    }
                                }
                                
                                log::debug!(
                                    "[ShelterPushResult] Player {:?} vs Shelter {}: Old: ({:.1}, {:.1}) -> New: ({:.1}, {:.1})",
                                    sender_id, shelter.id, old_resolved_x, old_resolved_y, resolved_x, resolved_y
                                );
                            }
                        } else {
                            log::debug!(
                                "[ShelterPushNOCollision] Player {:?} vs Shelter {}: ResolvedXY: ({:.1}, {:.1}), DistSq: {:.1} >= PlayerRadSq: {:.1}",
                                sender_id, shelter.id, resolved_x, resolved_y, dist_sq_resolve, current_player_radius * current_player_radius
                            );
                        }
                    }
                },
                spatial_grid::EntityType::PlayerCorpse(corpse_id) => { // ADDED PlayerCorpse push-out logic
                    log::debug!("[PushOutEntityType] Found PlayerCorpse: {}", corpse_id);
                    if let Some(corpse) = player_corpses.id().find(corpse_id) {
                        let corpse_collision_y = corpse.pos_y - CORPSE_COLLISION_Y_OFFSET;
                        let dx = resolved_x - corpse.pos_x;
                        let dy = resolved_y - corpse_collision_y;
                        let dist_sq = dx * dx + dy * dy;
                        let min_dist = current_player_radius + CORPSE_COLLISION_RADIUS + separation_distance; // Add separation
                        let min_dist_sq = min_dist * min_dist;
                        if dist_sq < min_dist_sq && dist_sq > 0.0 {
                            overlap_found_in_iter = true;
                            let distance = dist_sq.sqrt();
                            let overlap = (min_dist - distance) + separation_distance; // Ensure separation
                            resolved_x += (dx / distance) * overlap;
                            resolved_y += (dy / distance) * overlap;
                        } else if dist_sq == 0.0 { // Player center is exactly on corpse center (unlikely)
                            overlap_found_in_iter = true;
                            resolved_x += separation_distance; // Minimal push
                        }
                    }
                },
                _ => {} // Campfire, etc. - no push-out resolution
             }
        }

        resolved_x = resolved_x.max(current_player_radius).min(WORLD_WIDTH_PX - current_player_radius);
        resolved_y = resolved_y.max(current_player_radius).min(WORLD_HEIGHT_PX - current_player_radius);

        if !overlap_found_in_iter {
            break;
        }
        if _iter == resolution_iterations - 1 {
             log::warn!("Push-out collision resolution reached max iterations for {:?}. Position: ({}, {})", sender_id, resolved_x, resolved_y);
        }
    }
    (resolved_x, resolved_y)
}
