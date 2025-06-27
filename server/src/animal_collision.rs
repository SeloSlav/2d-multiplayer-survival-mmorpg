use spacetimedb::{ReducerContext, Table, Identity, Timestamp};
use log;
use crate::spatial_grid;
use crate::{WORLD_WIDTH_PX, WORLD_HEIGHT_PX};

// Import table traits
use crate::player as PlayerTableTrait;
use crate::tree::tree as TreeTableTrait;
use crate::stone::stone as StoneTableTrait;
use crate::wooden_storage_box::wooden_storage_box as WoodenStorageBoxTableTrait;
use crate::shelter::{
    Shelter, SHELTER_AABB_HALF_WIDTH, SHELTER_AABB_HALF_HEIGHT,
    SHELTER_AABB_CENTER_Y_OFFSET_FROM_POS_Y
};
use crate::shelter::shelter as ShelterTableTrait;
use crate::rain_collector::{RainCollector, RAIN_COLLECTOR_COLLISION_RADIUS, RAIN_COLLECTOR_COLLISION_Y_OFFSET};
use crate::rain_collector::rain_collector as RainCollectorTableTrait;
use crate::player_corpse::{PlayerCorpse, CORPSE_COLLISION_RADIUS, CORPSE_COLLISION_Y_OFFSET};
use crate::player_corpse::player_corpse as PlayerCorpseTableTrait;
use crate::wild_animal_npc::{WildAnimal, wild_animal as WildAnimalTableTrait};
use crate::fishing::is_water_tile;

// Animal collision constants
pub const ANIMAL_COLLISION_RADIUS: f32 = 32.0; // Animals maintain 32px distance from each other
pub const ANIMAL_PLAYER_COLLISION_RADIUS: f32 = 40.0; // Animals maintain 40px distance from players
pub const ANIMAL_PLAYER_ATTACK_COLLISION_RADIUS: f32 = 50.0; // Reasonable distance when attacking (was 25.0)
pub const COLLISION_PUSHBACK_FORCE: f32 = 20.0; // How far to push back when colliding
pub const ANIMAL_SEPARATION_DISTANCE: f32 = 8.0; // Minimum separation after collision resolution

/// Represents the result of a collision check
#[derive(Debug, Clone)]
pub struct CollisionResult {
    pub collision_detected: bool,
    pub pushback_x: f32,
    pub pushback_y: f32,
    pub collision_type: CollisionType,
}

#[derive(Debug, Clone)]
pub enum CollisionType {
    None,
    Water,
    Shelter,
    Animal,
    Player,
    Tree,
    Stone,
    WoodenBox,
    RainCollector,
    PlayerCorpse,
}

/// Comprehensive collision check for animal movement
/// Returns the final position after all collision resolution
pub fn resolve_animal_collision(
    ctx: &ReducerContext,
    animal_id: u64,
    current_x: f32,
    current_y: f32,
    proposed_x: f32,
    proposed_y: f32,
    is_attacking: bool,
) -> (f32, f32) {
    let mut final_x = proposed_x;
    let mut final_y = proposed_y;
    
    // Check water collision first (absolute blocker)
    if is_water_tile(ctx, proposed_x, proposed_y) {
        log::debug!("[AnimalCollision] Animal {} movement blocked by water at ({:.1}, {:.1})", 
                   animal_id, proposed_x, proposed_y);
        return (current_x, current_y); // Don't move if target is water
    }
    
    // Check shelter collision (absolute blocker)
    if check_shelter_collision(ctx, proposed_x, proposed_y) {
        log::debug!("[AnimalCollision] Animal {} movement blocked by shelter at ({:.1}, {:.1})", 
                   animal_id, proposed_x, proposed_y);
        return (current_x, current_y); // Don't move if target is inside shelter
    }
    
    // Check and resolve pushback collisions
    let mut collision_detected = false;
    
    // Animal-to-animal collision
    if let Some((pushback_x, pushback_y)) = check_animal_collision(ctx, animal_id, final_x, final_y) {
        final_x = current_x + pushback_x;
        final_y = current_y + pushback_y;
        collision_detected = true;
        log::debug!("[AnimalCollision] Animal {} pushed back by other animal: ({:.1}, {:.1})", 
                   animal_id, pushback_x, pushback_y);
    }
    
    // Animal-to-player collision (different radius based on attacking state)
    if let Some((pushback_x, pushback_y)) = check_player_collision(ctx, final_x, final_y, is_attacking) {
        final_x = current_x + pushback_x;
        final_y = current_y + pushback_y;
        collision_detected = true;
        log::debug!("[AnimalCollision] Animal {} pushed back by player: ({:.1}, {:.1})", 
                   animal_id, pushback_x, pushback_y);
    }
    
    // Environmental collision checks
    if let Some((pushback_x, pushback_y)) = check_environmental_collision(ctx, final_x, final_y) {
        final_x = current_x + pushback_x;
        final_y = current_y + pushback_y;
        collision_detected = true;
        log::debug!("[AnimalCollision] Animal {} pushed back by environment: ({:.1}, {:.1})", 
                   animal_id, pushback_x, pushback_y);
    }
    
    // Clamp to world bounds
    final_x = final_x.max(ANIMAL_COLLISION_RADIUS).min(WORLD_WIDTH_PX - ANIMAL_COLLISION_RADIUS);
    final_y = final_y.max(ANIMAL_COLLISION_RADIUS).min(WORLD_HEIGHT_PX - ANIMAL_COLLISION_RADIUS);
    
    (final_x, final_y)
}

/// Checks if a position would collide with shelter walls
pub fn check_shelter_collision(
    ctx: &ReducerContext,
    proposed_x: f32,
    proposed_y: f32,
) -> bool {
    for shelter in ctx.db.shelter().iter() {
        if shelter.is_destroyed {
            continue;
        }
        
        // Calculate shelter AABB bounds (same logic as shelter.rs)
        let shelter_aabb_center_x = shelter.pos_x;
        let shelter_aabb_center_y = shelter.pos_y - SHELTER_AABB_CENTER_Y_OFFSET_FROM_POS_Y;
        let aabb_left = shelter_aabb_center_x - SHELTER_AABB_HALF_WIDTH;
        let aabb_right = shelter_aabb_center_x + SHELTER_AABB_HALF_WIDTH;
        let aabb_top = shelter_aabb_center_y - SHELTER_AABB_HALF_HEIGHT;
        let aabb_bottom = shelter_aabb_center_y + SHELTER_AABB_HALF_HEIGHT;
        
        // Check if proposed position is inside shelter AABB
        if proposed_x >= aabb_left && proposed_x <= aabb_right && 
           proposed_y >= aabb_top && proposed_y <= aabb_bottom {
            log::debug!("[AnimalCollision] Movement blocked by Shelter {} at ({:.1}, {:.1})", 
                       shelter.id, proposed_x, proposed_y);
            return true;
        }
    }
    false
}

/// Checks if a position would collide with other animals
pub fn check_animal_collision(
    ctx: &ReducerContext,
    animal_id: u64,
    proposed_x: f32,
    proposed_y: f32,
) -> Option<(f32, f32)> {
    for other_animal in ctx.db.wild_animal().iter() {
        if other_animal.id == animal_id {
            continue; // Skip self
        }
        
        let dx = proposed_x - other_animal.pos_x;
        let dy = proposed_y - other_animal.pos_y;
        let distance_sq = dx * dx + dy * dy;
        let min_distance_sq = ANIMAL_COLLISION_RADIUS * ANIMAL_COLLISION_RADIUS;
        
        if distance_sq < min_distance_sq && distance_sq > 0.1 {
            // Collision detected - calculate pushback direction
            let distance = distance_sq.sqrt();
            let pushback_x = (dx / distance) * COLLISION_PUSHBACK_FORCE;
            let pushback_y = (dy / distance) * COLLISION_PUSHBACK_FORCE;
            return Some((pushback_x, pushback_y));
        }
    }
    None
}

/// Checks if a position would collide with players
pub fn check_player_collision(
    ctx: &ReducerContext,
    proposed_x: f32,
    proposed_y: f32,
    is_attacking: bool,
) -> Option<(f32, f32)> {
    // Use different collision radius based on whether animal is attacking
    let collision_radius = if is_attacking {
        ANIMAL_PLAYER_ATTACK_COLLISION_RADIUS // Closer distance for attacking
    } else {
        ANIMAL_PLAYER_COLLISION_RADIUS // Normal distance for non-combat
    };
    
    for player in ctx.db.player().iter() {
        if player.is_dead {
            continue; // Skip dead players
        }
        
        let dx = proposed_x - player.position_x;
        let dy = proposed_y - player.position_y;
        let distance_sq = dx * dx + dy * dy;
        let min_distance_sq = collision_radius * collision_radius;
        
        if distance_sq < min_distance_sq && distance_sq > 0.1 {
            // Collision detected - calculate pushback direction
            let distance = distance_sq.sqrt();
            let pushback_distance = if is_attacking {
                30.0 // Stronger pushback for attacking animals to maintain proper distance
            } else {
                COLLISION_PUSHBACK_FORCE // Normal pushback for non-combat
            };
            let pushback_x = (dx / distance) * pushback_distance;
            let pushback_y = (dy / distance) * pushback_distance;
            return Some((pushback_x, pushback_y));
        }
    }
    None
}

/// Checks collision with environmental objects (trees, stones, boxes, etc.)
pub fn check_environmental_collision(
    ctx: &ReducerContext,
    proposed_x: f32,
    proposed_y: f32,
) -> Option<(f32, f32)> {
    // Use spatial grid for efficient collision detection
    let mut grid = spatial_grid::SpatialGrid::new();
    grid.populate_from_world(&ctx.db, ctx.timestamp);
    let nearby_entities = grid.get_entities_in_range(proposed_x, proposed_y);
    
    for entity in &nearby_entities {
        match entity {
            spatial_grid::EntityType::Tree(tree_id) => {
                if let Some(tree) = ctx.db.tree().id().find(tree_id) {
                    if tree.health == 0 { continue; }
                    let tree_collision_y = tree.pos_y - crate::tree::TREE_COLLISION_Y_OFFSET;
                    let dx = proposed_x - tree.pos_x;
                    let dy = proposed_y - tree_collision_y;
                    let distance_sq = dx * dx + dy * dy;
                    let min_distance = ANIMAL_COLLISION_RADIUS + crate::tree::TREE_TRUNK_RADIUS;
                    let min_distance_sq = min_distance * min_distance;
                    
                    if distance_sq < min_distance_sq && distance_sq > 0.1 {
                        let distance = distance_sq.sqrt();
                        let pushback_x = (dx / distance) * COLLISION_PUSHBACK_FORCE;
                        let pushback_y = (dy / distance) * COLLISION_PUSHBACK_FORCE;
                        return Some((pushback_x, pushback_y));
                    }
                }
            },
            spatial_grid::EntityType::Stone(stone_id) => {
                if let Some(stone) = ctx.db.stone().id().find(stone_id) {
                    if stone.health == 0 { continue; }
                    let stone_collision_y = stone.pos_y - crate::stone::STONE_COLLISION_Y_OFFSET;
                    let dx = proposed_x - stone.pos_x;
                    let dy = proposed_y - stone_collision_y;
                    let distance_sq = dx * dx + dy * dy;
                    let min_distance = ANIMAL_COLLISION_RADIUS + crate::stone::STONE_RADIUS;
                    let min_distance_sq = min_distance * min_distance;
                    
                    if distance_sq < min_distance_sq && distance_sq > 0.1 {
                        let distance = distance_sq.sqrt();
                        let pushback_x = (dx / distance) * COLLISION_PUSHBACK_FORCE;
                        let pushback_y = (dy / distance) * COLLISION_PUSHBACK_FORCE;
                        return Some((pushback_x, pushback_y));
                    }
                }
            },
            spatial_grid::EntityType::WoodenStorageBox(box_id) => {
                if let Some(box_instance) = ctx.db.wooden_storage_box().id().find(box_id) {
                    let box_collision_y = box_instance.pos_y - crate::wooden_storage_box::BOX_COLLISION_Y_OFFSET;
                    let dx = proposed_x - box_instance.pos_x;
                    let dy = proposed_y - box_collision_y;
                    let distance_sq = dx * dx + dy * dy;
                    let min_distance = ANIMAL_COLLISION_RADIUS + crate::wooden_storage_box::BOX_COLLISION_RADIUS;
                    let min_distance_sq = min_distance * min_distance;
                    
                    if distance_sq < min_distance_sq && distance_sq > 0.1 {
                        let distance = distance_sq.sqrt();
                        let pushback_x = (dx / distance) * COLLISION_PUSHBACK_FORCE;
                        let pushback_y = (dy / distance) * COLLISION_PUSHBACK_FORCE;
                        return Some((pushback_x, pushback_y));
                    }
                }
            },
            spatial_grid::EntityType::RainCollector(rain_collector_id) => {
                if let Some(rain_collector) = ctx.db.rain_collector().id().find(rain_collector_id) {
                    if rain_collector.is_destroyed { continue; }
                    let rain_collector_collision_y = rain_collector.pos_y - RAIN_COLLECTOR_COLLISION_Y_OFFSET;
                    let dx = proposed_x - rain_collector.pos_x;
                    let dy = proposed_y - rain_collector_collision_y;
                    let distance_sq = dx * dx + dy * dy;
                    let min_distance = ANIMAL_COLLISION_RADIUS + RAIN_COLLECTOR_COLLISION_RADIUS;
                    let min_distance_sq = min_distance * min_distance;
                    
                    if distance_sq < min_distance_sq && distance_sq > 0.1 {
                        let distance = distance_sq.sqrt();
                        let pushback_x = (dx / distance) * COLLISION_PUSHBACK_FORCE;
                        let pushback_y = (dy / distance) * COLLISION_PUSHBACK_FORCE;
                        return Some((pushback_x, pushback_y));
                    }
                }
            },
            spatial_grid::EntityType::PlayerCorpse(corpse_id) => {
                if let Some(corpse) = ctx.db.player_corpse().id().find(corpse_id) {
                    let corpse_collision_y = corpse.pos_y - CORPSE_COLLISION_Y_OFFSET;
                    let dx = proposed_x - corpse.pos_x;
                    let dy = proposed_y - corpse_collision_y;
                    let distance_sq = dx * dx + dy * dy;
                    let min_distance = ANIMAL_COLLISION_RADIUS + CORPSE_COLLISION_RADIUS;
                    let min_distance_sq = min_distance * min_distance;
                    
                    if distance_sq < min_distance_sq && distance_sq > 0.1 {
                        let distance = distance_sq.sqrt();
                        let pushback_x = (dx / distance) * COLLISION_PUSHBACK_FORCE;
                        let pushback_y = (dy / distance) * COLLISION_PUSHBACK_FORCE;
                        return Some((pushback_x, pushback_y));
                    }
                }
            },
            _ => {} // Other entities don't block animal movement
        }
    }
    None
}

/// Validates if a spawn position is suitable for an animal
pub fn validate_animal_spawn_position(
    ctx: &ReducerContext,
    pos_x: f32,
    pos_y: f32,
) -> Result<(), String> {
    // Check water collision
    if is_water_tile(ctx, pos_x, pos_y) {
        return Err(format!("Cannot spawn animal on water tile at ({:.1}, {:.1})", pos_x, pos_y));
    }
    
    // Check shelter collision
    if check_shelter_collision(ctx, pos_x, pos_y) {
        return Err(format!("Cannot spawn animal inside shelter at ({:.1}, {:.1})", pos_x, pos_y));
    }
    
    // Check collision with other animals
    if let Some(_) = check_animal_collision(ctx, 0, pos_x, pos_y) { // Use 0 as dummy ID
        return Err(format!("Cannot spawn animal too close to other animals at ({:.1}, {:.1})", pos_x, pos_y));
    }
    
    // Check collision with players
    if let Some(_) = check_player_collision(ctx, pos_x, pos_y, false) {
        return Err(format!("Cannot spawn animal too close to players at ({:.1}, {:.1})", pos_x, pos_y));
    }
    
    // Check environmental collisions
    if let Some(_) = check_environmental_collision(ctx, pos_x, pos_y) {
        return Err(format!("Cannot spawn animal in environmental obstacle at ({:.1}, {:.1})", pos_x, pos_y));
    }
    
    Ok(())
}

/// Quick collision check for movement validation (lighter weight)
pub fn can_animal_move_to_position(
    ctx: &ReducerContext,
    animal_id: u64,
    proposed_x: f32,
    proposed_y: f32,
    is_attacking: bool,
) -> bool {
    // Quick checks for absolute blockers
    if is_water_tile(ctx, proposed_x, proposed_y) {
        return false;
    }
    
    if check_shelter_collision(ctx, proposed_x, proposed_y) {
        return false;
    }
    
    // Allow movement with pushback for other collisions
    true
} 