// server/src/compound_buildings.rs
// ------------------------------------
// Static compound building collision definitions.
// These must match the client-side config in client/src/config/compoundBuildings.ts
// ------------------------------------

use crate::{WORLD_WIDTH_TILES, WORLD_HEIGHT_TILES, TILE_SIZE_PX};

/// Collision data for a static compound building.
/// Position is relative to world center.
pub struct CompoundBuildingCollision {
    /// X offset from world center (pixels)
    pub offset_x: f32,
    /// Y offset from world center (pixels)
    pub offset_y: f32,
    /// Collision radius (pixels) - used when aabb is None
    pub collision_radius: f32,
    /// Y offset for collision center from building anchor (pixels) - used when aabb is None
    pub collision_y_offset: f32,
    /// AABB collision: (half_width, half_height, center_y_offset). When Some, overrides circular.
    pub aabb: Option<(f32, f32, f32)>,
}

/// Static compound building collisions.
/// 
/// IMPORTANT: These values MUST match the client config in:
/// client/src/config/compoundBuildings.ts
/// 
/// When adding/modifying buildings:
/// 1. Copy offsetX, offsetY, collisionRadius, collisionYOffset from client config
/// 2. Keep the order consistent for easier maintenance
/// 
/// NOTE: Monument collisions (shipwrecks, fishing villages, whale bone graveyards) are handled separately
/// via monument_part table since monuments are dynamically placed during world generation.
lazy_static::lazy_static! {
    pub static ref COMPOUND_BUILDING_COLLISIONS: Vec<CompoundBuildingCollision> =
        crate::collision_geometry::COLLISION_GEOMETRY.alk.landmarks.iter().map(|landmark| {
            let bounds = crate::collision_geometry::alk_building_bounds(&landmark.asset, 0.0, 0.0).expect("valid ALK landmark");
            CompoundBuildingCollision { offset_x:landmark.offset_x, offset_y:landmark.offset_y,
                collision_radius:0.0, collision_y_offset:0.0,
                aabb:Some((bounds.half_width,bounds.half_depth,bounds.y)) }
        }).collect();
}

/// Calculate the world center coordinates in pixels.
#[inline]
pub fn get_world_center() -> (f32, f32) {
    let center_x = (WORLD_WIDTH_TILES as f32 * TILE_SIZE_PX as f32) / 2.0;
    let center_y = (WORLD_HEIGHT_TILES as f32 * TILE_SIZE_PX as f32) / 2.0;
    (center_x, center_y)
}

/// Check if a position collides with any compound building.
/// 
/// # Arguments
/// * `pos_x` - World X position to check
/// * `pos_y` - World Y position to check
/// * `entity_radius` - Radius of the entity being checked (e.g., player radius)
/// 
/// # Returns
/// `true` if the position would collide with any building
pub fn check_compound_building_collision(pos_x: f32, pos_y: f32, entity_radius: f32) -> bool {
    // Early exit if no buildings defined
    if COMPOUND_BUILDING_COLLISIONS.is_empty() {
        return false;
    }
    
    let (center_x, center_y) = get_world_center();
    
    for building in COMPOUND_BUILDING_COLLISIONS.iter() {
        if let Some((hw, hh, cy_off)) = building.aabb {
            // AABB collision (expand by entity_radius)
            let building_x = center_x + building.offset_x;
            let building_y = center_y + building.offset_y + cy_off;
            let left = building_x - hw - entity_radius;
            let right = building_x + hw + entity_radius;
            let top = building_y - hh - entity_radius;
            let bottom = building_y + hh + entity_radius;
            if pos_x >= left && pos_x <= right && pos_y >= top && pos_y <= bottom {
                return true;
            }
        } else {
            // Circular collision
            let building_x = center_x + building.offset_x;
            let building_y = center_y + building.offset_y - building.collision_y_offset;
            let dx = pos_x - building_x;
            let dy = pos_y - building_y;
            let dist_sq = dx * dx + dy * dy;
            let min_dist = building.collision_radius + entity_radius;
            if dist_sq < min_dist * min_dist {
                return true;
            }
        }
    }
    
    false
}

/// Get the collision resolution vector for compound buildings.
/// Returns the push-out direction and distance if colliding.
/// 
/// # Arguments
/// * `pos_x` - World X position to check
/// * `pos_y` - World Y position to check
/// * `entity_radius` - Radius of the entity being checked
/// 
/// # Returns
/// `Some((new_x, new_y))` with resolved position if colliding, `None` if no collision
pub fn resolve_compound_building_collision(
    pos_x: f32, 
    pos_y: f32, 
    entity_radius: f32
) -> Option<(f32, f32)> {
    // Early exit if no buildings defined
    if COMPOUND_BUILDING_COLLISIONS.is_empty() {
        return None;
    }
    
    let (center_x, center_y) = get_world_center();
    let separation_distance = 1.0; // Extra separation to prevent getting stuck
    
    let mut resolved_x = pos_x;
    let mut resolved_y = pos_y;
    let mut any_collision = false;
    
    for building in COMPOUND_BUILDING_COLLISIONS.iter() {
        if let Some((hw, hh, cy_off)) = building.aabb {
            // AABB collision - push to nearest edge
            let building_x = center_x + building.offset_x;
            let building_y = center_y + building.offset_y + cy_off;
            let aabb_left = building_x - hw;
            let aabb_right = building_x + hw;
            let aabb_top = building_y - hh;
            let aabb_bottom = building_y + hh;
            let exp_left = aabb_left - entity_radius;
            let exp_right = aabb_right + entity_radius;
            let exp_top = aabb_top - entity_radius;
            let exp_bottom = aabb_bottom + entity_radius;
            
            if resolved_x >= exp_left && resolved_x <= exp_right && resolved_y >= exp_top && resolved_y <= exp_bottom {
                any_collision = true;
                let closest_x = resolved_x.max(aabb_left).min(aabb_right);
                let closest_y = resolved_y.max(aabb_top).min(aabb_bottom);
                let dx = resolved_x - closest_x;
                let dy = resolved_y - closest_y;
                let dist_sq = dx * dx + dy * dy;
                if dist_sq < 0.0001 {
                    // Inside AABB - push to nearest edge
                    let to_left = resolved_x - exp_left;
                    let to_right = exp_right - resolved_x;
                    let to_top = resolved_y - exp_top;
                    let to_bottom = exp_bottom - resolved_y;
                    let min_dist = to_left.min(to_right).min(to_top).min(to_bottom);
                    if min_dist == to_left {
                        resolved_x = exp_left - separation_distance;
                    } else if min_dist == to_right {
                        resolved_x = exp_right + separation_distance;
                    } else if min_dist == to_top {
                        resolved_y = exp_top - separation_distance;
                    } else {
                        resolved_y = exp_bottom + separation_distance;
                    }
                } else {
                    let dist = dist_sq.sqrt();
                    let push = entity_radius - dist + separation_distance;
                    resolved_x += (dx / dist) * push;
                    resolved_y += (dy / dist) * push;
                }
            }
        } else {
            // Circular collision
            let building_x = center_x + building.offset_x;
            let building_y = center_y + building.offset_y - building.collision_y_offset;
            let dx = resolved_x - building_x;
            let dy = resolved_y - building_y;
            let dist_sq = dx * dx + dy * dy;
            let min_dist = building.collision_radius + entity_radius;
            
            if dist_sq < min_dist * min_dist {
                any_collision = true;
                let dist = dist_sq.sqrt();
                if dist > 0.001 {
                    let nx = dx / dist;
                    let ny = dy / dist;
                    let push_dist = min_dist - dist + separation_distance;
                    resolved_x += nx * push_dist;
                    resolved_y += ny * push_dist;
                } else {
                    resolved_x += min_dist + separation_distance;
                }
            }
        }
    }
    
    if any_collision {
        Some((resolved_x, resolved_y))
    } else {
        None
    }
}

/// Check if a line segment intersects any compound building.
/// Useful for projectile/raycast collision.
/// 
/// # Arguments
/// * `start_x`, `start_y` - Line start position
/// * `end_x`, `end_y` - Line end position
/// 
/// # Returns
/// `true` if the line intersects any building
pub fn line_intersects_compound_building(
    start_x: f32,
    start_y: f32,
    end_x: f32,
    end_y: f32,
) -> bool {
    // Early exit if no buildings defined
    if COMPOUND_BUILDING_COLLISIONS.is_empty() {
        return false;
    }
    
    let (center_x, center_y) = get_world_center();
    
    for building in COMPOUND_BUILDING_COLLISIONS.iter() {
        if let Some((hw, hh, cy_off)) = building.aabb {
            let building_x = center_x + building.offset_x;
            let building_y = center_y + building.offset_y + cy_off;
            let left = building_x - hw;
            let right = building_x + hw;
            let top = building_y - hh;
            let bottom = building_y + hh;
            if line_intersects_aabb(start_x, start_y, end_x, end_y, left, right, top, bottom) {
                return true;
            }
        } else {
            let building_x = center_x + building.offset_x;
            let building_y = center_y + building.offset_y - building.collision_y_offset;
            let dx = end_x - start_x;
            let dy = end_y - start_y;
            let fx = start_x - building_x;
            let fy = start_y - building_y;
            let a = dx * dx + dy * dy;
            let b = 2.0 * (fx * dx + fy * dy);
            let c = fx * fx + fy * fy - building.collision_radius * building.collision_radius;
            let discriminant = b * b - 4.0 * a * c;
            if discriminant >= 0.0 {
                let discriminant_sqrt = discriminant.sqrt();
                let t1 = (-b - discriminant_sqrt) / (2.0 * a);
                let t2 = (-b + discriminant_sqrt) / (2.0 * a);
                if (t1 >= 0.0 && t1 <= 1.0) || (t2 >= 0.0 && t2 <= 1.0) {
                    return true;
                }
            }
        }
    }
    
    false
}

fn line_intersects_aabb(
    x1: f32, y1: f32, x2: f32, y2: f32,
    left: f32, right: f32, top: f32, bottom: f32,
) -> bool {
    let dx = x2 - x1;
    let dy = y2 - y1;
    if dx.abs() < 0.001 && dy.abs() < 0.001 {
        return x1 >= left && x1 <= right && y1 >= top && y1 <= bottom;
    }
    let mut t_min = 0.0f32;
    let mut t_max = 1.0f32;
    if dx.abs() > 0.001 {
        let t1 = (left - x1) / dx;
        let t2 = (right - x1) / dx;
        t_min = t_min.max(t1.min(t2));
        t_max = t_max.min(t1.max(t2));
        if t_min > t_max {
            return false;
        }
    } else if x1 < left || x1 > right {
        return false;
    }
    if dy.abs() > 0.001 {
        let t1 = (top - y1) / dy;
        let t2 = (bottom - y1) / dy;
        t_min = t_min.max(t1.min(t2));
        t_max = t_max.min(t1.max(t2));
        if t_min > t_max {
            return false;
        }
    } else if y1 < top || y1 > bottom {
        return false;
    }
    true
}

