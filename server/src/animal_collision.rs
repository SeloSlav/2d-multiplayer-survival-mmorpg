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
use crate::furnace::{Furnace, FURNACE_COLLISION_RADIUS, FURNACE_COLLISION_Y_OFFSET};
use crate::furnace::furnace as FurnaceTableTrait;
use crate::homestead_hearth::{HomesteadHearth, HEARTH_COLLISION_RADIUS, HEARTH_COLLISION_Y_OFFSET};
use crate::homestead_hearth::homestead_hearth as HomesteadHearthTableTrait;
use crate::basalt_column::{BasaltColumn, BASALT_COLUMN_RADIUS, BASALT_COLUMN_COLLISION_Y_OFFSET};
use crate::basalt_column::basalt_column as BasaltColumnTableTrait;
use crate::sea_stack::{get_sea_stack_collision_dimensions, sea_stack as SeaStackTableTrait};
use crate::coral::{LIVING_CORAL_COLLISION_Y_OFFSET, LIVING_CORAL_RADIUS};
use crate::building::wall_cell as WallCellTableTrait;
use crate::building::foundation_cell as FoundationCellTableTrait;
use crate::building::FOUNDATION_TILE_SIZE_PX;
use crate::door::door as DoorTableTrait;
use crate::fence::fence as FenceTableTrait;
use crate::fence::{check_fence_collision, FENCE_COLLISION_THICKNESS};
use crate::wild_animal_npc::{WildAnimal, wild_animal as WildAnimalTableTrait, AnimalSpecies};
use crate::fishing::is_water_tile;
use crate::TILE_SIZE_PX;

// Animal collision constants - TUNED for fast hostile NPCs (500ms AI tick @ up to 1040px/s sprint)
// With 500ms ticks, a sprinting hostile can move ~520px per tick, so collision must be robust
pub const ANIMAL_COLLISION_RADIUS: f32 = 45.0; // Animals maintain 45px distance from each other
pub const ANIMAL_PLAYER_COLLISION_RADIUS: f32 = 65.0; // Animals maintain 65px distance from players (prevents overlap)
pub const ANIMAL_PLAYER_ATTACK_COLLISION_RADIUS: f32 = 50.0; // Closer distance when attacking to allow hits
pub const COLLISION_PUSHBACK_FORCE: f32 = 80.0; // Strong pushback to prevent fast NPCs from overlapping
pub const ANIMAL_SEPARATION_DISTANCE: f32 = 15.0; // Minimum separation after collision resolution

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
    BasaltColumn,
    WoodenBox,
    RainCollector,
    PlayerCorpse,
    HomesteadHearth,
    Wall,
    Foundation,
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
    
    // PERFORMANCE: Use cached spatial grid instead of creating new one
    let grid = spatial_grid::get_cached_spatial_grid(&ctx.db, ctx.timestamp);
    
    // Look up species + movement mode for special handling.
    let animal_row = ctx.db.wild_animal().id().find(&animal_id);
    let animal_species = animal_row.as_ref().map(|a| a.species);
    let animal_is_flying = animal_row.as_ref().map(|a| a.is_flying).unwrap_or(false);
    if !animal_is_flying && !matches!(animal_species,Some(AnimalSpecies::Bee)) && crate::world_cover::blocks_path(ctx,(current_x,current_y),(proposed_x,proposed_y),24.0) {
        return (current_x,current_y);
    }
    
    // BEES: No collision with players - they fly through everything
    let is_bee = matches!(animal_species, Some(crate::wild_animal_npc::AnimalSpecies::Bee));
    
    // Check water collision. Land animals are blocked; aquatic/flying species can traverse.
    if is_water_tile(ctx, proposed_x, proposed_y) {
        let can_traverse_water = matches!(
            animal_species,
            Some(crate::wild_animal_npc::AnimalSpecies::ArcticWalrus) | 
            Some(crate::wild_animal_npc::AnimalSpecies::BeachCrab) |
            Some(crate::wild_animal_npc::AnimalSpecies::SalmonShark) |
            Some(crate::wild_animal_npc::AnimalSpecies::Jellyfish) |
            Some(crate::wild_animal_npc::AnimalSpecies::Bee)
        ) || animal_is_flying;
        
        if !can_traverse_water {
            log::debug!("[AnimalCollision] Animal {} movement blocked by water at ({:.1}, {:.1})", 
                       animal_id, proposed_x, proposed_y);
            return (current_x, current_y); // Block non-walrus/non-bee animals
        }
        log::debug!("[AnimalCollision] Animal {} can traverse water at ({:.1}, {:.1})", 
                   animal_id, proposed_x, proposed_y);
    }
    
    // Check shelter collision (absolute blocker) - but bees can fly through
    if !is_bee && check_shelter_collision(ctx, proposed_x, proposed_y) {
        log::debug!("[AnimalCollision] Animal {} movement blocked by shelter at ({:.1}, {:.1})", 
                   animal_id, proposed_x, proposed_y);
        return (current_x, current_y); // Don't move if target is inside shelter
    }
    
    // ==========================================================================
    // CRITICAL: ANTI-TUNNELING WALL/DOOR/FENCE CHECK
    // NPCs can move 100+ pixels per tick and tunnel through thin walls.
    // Check for wall collisions along the ENTIRE movement path, not just destination.
    // EXCEPTION: Bees fly through everything - no structure collision!
    // ==========================================================================
    if !is_bee {
        if let Some(blocked_pos) = check_wall_line_collision(&ctx.db, current_x, current_y, proposed_x, proposed_y) {
            log::info!("[AnimalCollision] Animal {} BLOCKED by wall during movement from ({:.1},{:.1}) to ({:.1},{:.1}) - stopped at ({:.1},{:.1})", 
                       animal_id, current_x, current_y, proposed_x, proposed_y, blocked_pos.0, blocked_pos.1);
            return blocked_pos; // Return position before hitting wall
        }
        
        // Also check doors along the movement path (anti-tunneling)
        if let Some(blocked_pos) = check_door_line_collision(ctx, current_x, current_y, proposed_x, proposed_y) {
            log::info!("[AnimalCollision] Animal {} BLOCKED by door during movement from ({:.1},{:.1}) to ({:.1},{:.1}) - stopped at ({:.1},{:.1})", 
                       animal_id, current_x, current_y, proposed_x, proposed_y, blocked_pos.0, blocked_pos.1);
            return blocked_pos; // Return position before hitting door
        }
        
        // Also check fences along the movement path (anti-tunneling)
        if let Some(blocked_pos) = check_fence_line_collision(ctx, current_x, current_y, proposed_x, proposed_y) {
            log::info!("[AnimalCollision] Animal {} BLOCKED by fence during movement from ({:.1},{:.1}) to ({:.1},{:.1}) - stopped at ({:.1},{:.1})", 
                       animal_id, current_x, current_y, proposed_x, proposed_y, blocked_pos.0, blocked_pos.1);
            return blocked_pos; // Return position before hitting fence
        }
    }
    
    // Check and resolve pushback collisions
    let mut collision_detected = false;
    
    // Animal-to-animal collision
    // EXCEPTION: Bees have NO collision - they fly through everything!
    if !is_bee {
        if let Some((pushback_x, pushback_y)) = check_animal_collision(ctx, animal_id, final_x, final_y) {
            final_x = current_x + pushback_x;
            final_y = current_y + pushback_y;
            collision_detected = true;
            log::debug!("[AnimalCollision] Animal {} pushed back by other animal: ({:.1}, {:.1})", 
                       animal_id, pushback_x, pushback_y);
        }
    }
    
    // Animal-to-player collision (different radius based on attacking state)
    // EXCEPTION: Bees have NO collision - they fly through players!
    if !is_bee {
        if let Some((pushback_x, pushback_y)) = check_player_collision(ctx, final_x, final_y, is_attacking) {
            final_x = current_x + pushback_x;
            final_y = current_y + pushback_y;
            collision_detected = true;
            log::debug!("[AnimalCollision] Animal {} pushed back by player: ({:.1}, {:.1})", 
                       animal_id, pushback_x, pushback_y);
        }
    }
    
    // Environmental and structure collision checks - bees skip all of these (they fly)
    if !is_bee {
        // Environmental collision checks
        if let Some((pushback_x, pushback_y)) = check_environmental_collision_with_grid(grid, &ctx.db, final_x, final_y) {
            final_x = current_x + pushback_x;
            final_y = current_y + pushback_y;
            collision_detected = true;
            log::debug!("[AnimalCollision] Animal {} pushed back by environment: ({:.1}, {:.1})", 
                       animal_id, pushback_x, pushback_y);
        }
        
        // Living coral collision (not in spatial grid - direct iteration)
        if let Some((pushback_x, pushback_y)) = check_living_coral_collision(ctx, final_x, final_y) {
            final_x = current_x + pushback_x;
            final_y = current_y + pushback_y;
            collision_detected = true;
            log::debug!("[AnimalCollision] Animal {} pushed back by living coral: ({:.1}, {:.1})", 
                       animal_id, pushback_x, pushback_y);
        }
        
        // Check wall collisions at destination (backup check)
        if let Some((pushback_x, pushback_y)) = check_wall_collision(&ctx.db, final_x, final_y) {
            final_x = current_x + pushback_x;
            final_y = current_y + pushback_y;
            collision_detected = true;
            log::debug!("[AnimalCollision] Animal {} pushed back by wall: ({:.1}, {:.1})", 
                       animal_id, pushback_x, pushback_y);
        }
        
        // Check door collisions at destination (backup check)
        if let Some((pushback_x, pushback_y)) = crate::door::check_door_collision(ctx, final_x, final_y, ANIMAL_COLLISION_RADIUS) {
            final_x = current_x + pushback_x;
            final_y = current_y + pushback_y;
            collision_detected = true;
            log::debug!("[AnimalCollision] Animal {} pushed back by door: ({:.1}, {:.1})", 
                       animal_id, pushback_x, pushback_y);
        }
        
        // Check fence collisions at destination (backup check)
        if check_fence_collision(ctx, final_x, final_y, ANIMAL_COLLISION_RADIUS) {
            // Calculate pushback from fence collision
            if let Some((pushback_x, pushback_y)) = check_fence_collision_pushback(ctx, final_x, final_y, ANIMAL_COLLISION_RADIUS) {
                final_x = current_x + pushback_x;
                final_y = current_y + pushback_y;
                collision_detected = true;
                log::debug!("[AnimalCollision] Animal {} pushed back by fence: ({:.1}, {:.1})", 
                           animal_id, pushback_x, pushback_y);
            }
        }
        
        // Check foundation triangle hypotenuse collisions
        if let Some((pushback_x, pushback_y)) = check_foundation_collision(&ctx.db, final_x, final_y) {
            final_x = current_x + pushback_x;
            final_y = current_y + pushback_y;
            collision_detected = true;
            log::debug!("[AnimalCollision] Animal {} pushed back by foundation: ({:.1}, {:.1})", 
                       animal_id, pushback_x, pushback_y);
        }
    } // End of !is_bee block
    
    // Clamp to world bounds
    final_x = final_x.max(ANIMAL_COLLISION_RADIUS).min(WORLD_WIDTH_PX - ANIMAL_COLLISION_RADIUS);
    final_y = final_y.max(ANIMAL_COLLISION_RADIUS).min(WORLD_HEIGHT_PX - ANIMAL_COLLISION_RADIUS);
    
    (final_x, final_y)
}

/// ANTI-TUNNELING: Check if a movement line crosses any walls
/// Returns the safe position just before hitting the wall, or None if path is clear
fn check_wall_line_collision<DB: WallCellTableTrait>(
    db: &DB,
    start_x: f32,
    start_y: f32,
    end_x: f32,
    end_y: f32,
) -> Option<(f32, f32)> {
    const WALL_THICKNESS: f32 = 12.0; // Slightly thicker for line check to catch edge cases
    const STEP_SIZE: f32 = 20.0; // Check every 20 pixels along the path
    
    let dx = end_x - start_x;
    let dy = end_y - start_y;
    let distance = (dx * dx + dy * dy).sqrt();
    
    if distance < 1.0 {
        return None; // Not moving significantly
    }
    
    // Normalize direction
    let dir_x = dx / distance;
    let dir_y = dy / distance;
    
    // Number of steps to check along the path
    let num_steps = ((distance / STEP_SIZE).ceil() as i32).max(1);
    
    // Calculate which foundation cells to check (the movement might cross multiple cells)
    let min_cell_x = ((start_x.min(end_x) - ANIMAL_COLLISION_RADIUS) / FOUNDATION_TILE_SIZE_PX as f32).floor() as i32 - 1;
    let max_cell_x = ((start_x.max(end_x) + ANIMAL_COLLISION_RADIUS) / FOUNDATION_TILE_SIZE_PX as f32).ceil() as i32 + 1;
    let min_cell_y = ((start_y.min(end_y) - ANIMAL_COLLISION_RADIUS) / FOUNDATION_TILE_SIZE_PX as f32).floor() as i32 - 1;
    let max_cell_y = ((start_y.max(end_y) + ANIMAL_COLLISION_RADIUS) / FOUNDATION_TILE_SIZE_PX as f32).ceil() as i32 + 1;
    
    let wall_cells = db.wall_cell();
    
    // Collect all walls in the movement area
    let mut walls_to_check: Vec<_> = Vec::new();
    for cell_x in min_cell_x..=max_cell_x {
        for cell_y in min_cell_y..=max_cell_y {
            for wall in wall_cells.idx_cell_coords().filter((cell_x, cell_y)) {
                if wall.is_destroyed { continue; }
                walls_to_check.push((cell_x, cell_y, wall.edge));
            }
        }
    }
    
    if walls_to_check.is_empty() {
        return None; // No walls in the area
    }
    
    // Check each step along the movement path
    for step in 0..=num_steps {
        let t = step as f32 / num_steps as f32;
        let check_x = start_x + dx * t;
        let check_y = start_y + dy * t;
        
        // Check against all walls we collected
        for &(cell_x, cell_y, edge) in &walls_to_check {
            let cell_left = cell_x as f32 * FOUNDATION_TILE_SIZE_PX as f32;
            let cell_top = cell_y as f32 * FOUNDATION_TILE_SIZE_PX as f32;
            let cell_right = cell_left + FOUNDATION_TILE_SIZE_PX as f32;
            let cell_bottom = cell_top + FOUNDATION_TILE_SIZE_PX as f32;
            
            let (wall_min_x, wall_max_x, wall_min_y, wall_max_y) = match edge {
                0 => (cell_left, cell_right, cell_top - WALL_THICKNESS / 2.0, cell_top + WALL_THICKNESS / 2.0),
                1 => (cell_right - WALL_THICKNESS / 2.0, cell_right + WALL_THICKNESS / 2.0, cell_top, cell_bottom),
                2 => (cell_left, cell_right, cell_bottom - WALL_THICKNESS / 2.0, cell_bottom + WALL_THICKNESS / 2.0),
                3 => (cell_left - WALL_THICKNESS / 2.0, cell_left + WALL_THICKNESS / 2.0, cell_top, cell_bottom),
                _ => continue,
            };
            
            // Check if position intersects wall
            let closest_x = check_x.max(wall_min_x).min(wall_max_x);
            let closest_y = check_y.max(wall_min_y).min(wall_max_y);
            let dx_to_wall = check_x - closest_x;
            let dy_to_wall = check_y - closest_y;
            let dist_sq = dx_to_wall * dx_to_wall + dy_to_wall * dy_to_wall;
            
            if dist_sq < ANIMAL_COLLISION_RADIUS * ANIMAL_COLLISION_RADIUS {
                // Found collision! Return position one step back (safe position)
                if step == 0 {
                    // Already colliding at start - stay at start
                    return Some((start_x, start_y));
                }
                // Go back one step and add buffer
                let safe_t = ((step - 1) as f32 / num_steps as f32).max(0.0);
                let safe_x = start_x + dx * safe_t;
                let safe_y = start_y + dy * safe_t;
                return Some((safe_x, safe_y));
            }
        }
    }
    
    None // Path is clear
}

/// ANTI-TUNNELING: Check if a movement line crosses any closed doors
/// Returns the safe position just before hitting the door, or None if path is clear
fn check_door_line_collision(
    ctx: &ReducerContext,
    start_x: f32,
    start_y: f32,
    end_x: f32,
    end_y: f32,
) -> Option<(f32, f32)> {
    const DOOR_THICKNESS: f32 = 12.0; // Slightly thicker for line check
    const STEP_SIZE: f32 = 20.0; // Check every 20 pixels along the path
    
    let dx = end_x - start_x;
    let dy = end_y - start_y;
    let distance = (dx * dx + dy * dy).sqrt();
    
    if distance < 1.0 {
        return None; // Not moving significantly
    }
    
    // Number of steps to check along the path
    let num_steps = ((distance / STEP_SIZE).ceil() as i32).max(1);
    
    // Calculate which foundation cells to check
    let min_cell_x = ((start_x.min(end_x) - ANIMAL_COLLISION_RADIUS) / FOUNDATION_TILE_SIZE_PX as f32).floor() as i32 - 1;
    let max_cell_x = ((start_x.max(end_x) + ANIMAL_COLLISION_RADIUS) / FOUNDATION_TILE_SIZE_PX as f32).ceil() as i32 + 1;
    let min_cell_y = ((start_y.min(end_y) - ANIMAL_COLLISION_RADIUS) / FOUNDATION_TILE_SIZE_PX as f32).floor() as i32 - 1;
    let max_cell_y = ((start_y.max(end_y) + ANIMAL_COLLISION_RADIUS) / FOUNDATION_TILE_SIZE_PX as f32).ceil() as i32 + 1;
    
    let doors = ctx.db.door();
    
    // Collect all closed doors in the movement area
    let mut doors_to_check: Vec<_> = Vec::new();
    for cell_x in min_cell_x..=max_cell_x {
        for cell_y in min_cell_y..=max_cell_y {
            for door in doors.idx_cell_coords().filter((cell_x, cell_y)) {
                if door.is_destroyed || door.is_open { continue; }
                doors_to_check.push((cell_x, cell_y, door.edge));
            }
        }
    }
    
    if doors_to_check.is_empty() {
        return None; // No closed doors in the area
    }
    
    // Check each step along the movement path
    for step in 0..=num_steps {
        let t = step as f32 / num_steps as f32;
        let check_x = start_x + dx * t;
        let check_y = start_y + dy * t;
        
        // Check against all doors we collected
        for &(cell_x, cell_y, edge) in &doors_to_check {
            let cell_left = cell_x as f32 * FOUNDATION_TILE_SIZE_PX as f32;
            let cell_top = cell_y as f32 * FOUNDATION_TILE_SIZE_PX as f32;
            let cell_right = cell_left + FOUNDATION_TILE_SIZE_PX as f32;
            let cell_bottom = cell_top + FOUNDATION_TILE_SIZE_PX as f32;
            
            // Doors are only on North (0) or South (2) edges
            let (door_min_x, door_max_x, door_min_y, door_max_y) = match edge {
                0 => (cell_left, cell_right, cell_top - DOOR_THICKNESS / 2.0, cell_top + DOOR_THICKNESS / 2.0),
                2 => {
                    // South doors have collision positioned higher
                    let collision_y = cell_bottom - 24.0;
                    (cell_left, cell_right, collision_y - DOOR_THICKNESS / 2.0, collision_y + DOOR_THICKNESS / 2.0)
                },
                _ => continue,
            };
            
            // Check if position intersects door
            let closest_x = check_x.max(door_min_x).min(door_max_x);
            let closest_y = check_y.max(door_min_y).min(door_max_y);
            let dx_to_door = check_x - closest_x;
            let dy_to_door = check_y - closest_y;
            let dist_sq = dx_to_door * dx_to_door + dy_to_door * dy_to_door;
            
            if dist_sq < ANIMAL_COLLISION_RADIUS * ANIMAL_COLLISION_RADIUS {
                // Found collision! Return position one step back
                if step == 0 {
                    return Some((start_x, start_y));
                }
                let safe_t = ((step - 1) as f32 / num_steps as f32).max(0.0);
                let safe_x = start_x + dx * safe_t;
                let safe_y = start_y + dy * safe_t;
                return Some((safe_x, safe_y));
            }
        }
    }
    
    None // Path is clear
}

/// ANTI-TUNNELING: Check if a movement line crosses any fences
/// Returns the safe position just before hitting the fence, or None if path is clear
fn check_fence_line_collision(
    ctx: &ReducerContext,
    start_x: f32,
    start_y: f32,
    end_x: f32,
    end_y: f32,
) -> Option<(f32, f32)> {
    const FENCE_THICKNESS: f32 = 12.0; // Slightly thicker for line check
    const STEP_SIZE: f32 = 20.0; // Check every 20 pixels along the path
    
    let dx = end_x - start_x;
    let dy = end_y - start_y;
    let distance = (dx * dx + dy * dy).sqrt();
    
    if distance < 1.0 {
        return None; // Not moving significantly
    }
    
    // Number of steps to check along the path
    let num_steps = ((distance / STEP_SIZE).ceil() as i32).max(1);
    
    // Calculate which cells to check (fences use 96px foundation cell grid - same as walls)
    let min_cell_x = ((start_x.min(end_x) - ANIMAL_COLLISION_RADIUS) / FOUNDATION_TILE_SIZE_PX as f32).floor() as i32 - 1;
    let max_cell_x = ((start_x.max(end_x) + ANIMAL_COLLISION_RADIUS) / FOUNDATION_TILE_SIZE_PX as f32).ceil() as i32 + 1;
    let min_cell_y = ((start_y.min(end_y) - ANIMAL_COLLISION_RADIUS) / FOUNDATION_TILE_SIZE_PX as f32).floor() as i32 - 1;
    let max_cell_y = ((start_y.max(end_y) + ANIMAL_COLLISION_RADIUS) / FOUNDATION_TILE_SIZE_PX as f32).ceil() as i32 + 1;
    
    let fences = ctx.db.fence();
    
    // Collect all fences in the movement area
    // edge: 0=N, 1=E, 2=S, 3=W (same as walls)
    let mut fences_to_check: Vec<_> = Vec::new();
    for cell_x in min_cell_x..=max_cell_x {
        for cell_y in min_cell_y..=max_cell_y {
            for fence in fences.idx_cell_coords().filter((cell_x, cell_y)) {
                if fence.is_destroyed {
                    continue;
                }
                fences_to_check.push((fence.edge, fence.pos_x, fence.pos_y));
            }
        }
    }
    
    if fences_to_check.is_empty() {
        return None; // No fences in the area
    }
    
    // Check each step along the movement path
    for step in 0..=num_steps {
        let t = step as f32 / num_steps as f32;
        let check_x = start_x + dx * t;
        let check_y = start_y + dy * t;
        
        // Check against all fences - fences are at cell edges (same as walls)
        for &(edge, fence_x, fence_y) in &fences_to_check {
            let half_edge = FOUNDATION_TILE_SIZE_PX as f32 / 2.0;
            let half_thickness = FENCE_THICKNESS / 2.0;
            
            // Edge: 0=N, 1=E, 2=S, 3=W - N/S are horizontal (thin in Y), E/W are vertical (thin in X)
            let (fence_min_x, fence_max_x, fence_min_y, fence_max_y) = match edge {
                0 | 2 => {
                    // North or South edge: horizontal fence spanning cell width
                    (
                        fence_x - half_edge,
                        fence_x + half_edge,
                        fence_y - half_thickness,
                        fence_y + half_thickness,
                    )
                }
                _ => {
                    // East or West edge: vertical fence spanning cell height
                    (
                        fence_x - half_thickness,
                        fence_x + half_thickness,
                        fence_y - half_edge,
                        fence_y + half_edge,
                    )
                }
            };
            
            // Check if position intersects fence
            let closest_x = check_x.max(fence_min_x).min(fence_max_x);
            let closest_y = check_y.max(fence_min_y).min(fence_max_y);
            let dx_to_fence = check_x - closest_x;
            let dy_to_fence = check_y - closest_y;
            let dist_sq = dx_to_fence * dx_to_fence + dy_to_fence * dy_to_fence;
            
            if dist_sq < ANIMAL_COLLISION_RADIUS * ANIMAL_COLLISION_RADIUS {
                // Found collision! Return position one step back
                if step == 0 {
                    return Some((start_x, start_y));
                }
                let safe_t = ((step - 1) as f32 / num_steps as f32).max(0.0);
                let safe_x = start_x + dx * safe_t;
                let safe_y = start_y + dy * safe_t;
                return Some((safe_x, safe_y));
            }
        }
    }
    
    None // Path is clear
}

/// Check fence collision and return pushback vector
/// Fences now use 96px foundation cell grid (same as walls)
fn check_fence_collision_pushback(
    ctx: &ReducerContext,
    proposed_x: f32,
    proposed_y: f32,
    radius: f32,
) -> Option<(f32, f32)> {
    const CHECK_RADIUS_CELLS: i32 = 2; // Check fences within 2 cells
    
    // Convert to foundation cell coordinates (96px grid)
    let cell_x = (proposed_x / FOUNDATION_TILE_SIZE_PX as f32).floor() as i32;
    let cell_y = (proposed_y / FOUNDATION_TILE_SIZE_PX as f32).floor() as i32;
    let fences = ctx.db.fence();
    
    for offset_x in -CHECK_RADIUS_CELLS..=CHECK_RADIUS_CELLS {
        for offset_y in -CHECK_RADIUS_CELLS..=CHECK_RADIUS_CELLS {
            let check_cell_x = cell_x + offset_x;
            let check_cell_y = cell_y + offset_y;
            
            for fence in fences.idx_cell_coords().filter((check_cell_x, check_cell_y)) {
                if fence.is_destroyed {
                    continue;
                }
                
                // Calculate fence collision bounds (same as walls)
                let half_edge = FOUNDATION_TILE_SIZE_PX as f32 / 2.0;
                let half_thickness = FENCE_COLLISION_THICKNESS / 2.0;
                
                // Edge: 0=N, 1=E, 2=S, 3=W
                let (fence_min_x, fence_max_x, fence_min_y, fence_max_y) = match fence.edge {
                    0 | 2 => {
                        // North or South edge: horizontal fence
                        (
                            fence.pos_x - half_edge,
                            fence.pos_x + half_edge,
                            fence.pos_y - half_thickness - radius,
                            fence.pos_y + half_thickness + radius,
                        )
                    }
                    _ => {
                        // East or West edge: vertical fence
                        (
                            fence.pos_x - half_thickness - radius,
                            fence.pos_x + half_thickness + radius,
                            fence.pos_y - half_edge,
                            fence.pos_y + half_edge,
                        )
                    }
                };
                
                // Check if position (with radius) intersects fence AABB
                if proposed_x + radius >= fence_min_x && proposed_x - radius <= fence_max_x &&
                   proposed_y + radius >= fence_min_y && proposed_y - radius <= fence_max_y {
                    // Calculate pushback direction (away from fence center)
                    let dx = proposed_x - fence.pos_x;
                    let dy = proposed_y - fence.pos_y;
                    let distance_sq = dx * dx + dy * dy;
                    
                    if distance_sq > 0.001 {
                        let distance = distance_sq.sqrt();
                        let pushback_x = (dx / distance) * COLLISION_PUSHBACK_FORCE;
                        let pushback_y = (dy / distance) * COLLISION_PUSHBACK_FORCE;
                        return Some((pushback_x, pushback_y));
                    } else {
                        // Too close, push in a default direction
                        return Some((COLLISION_PUSHBACK_FORCE, 0.0));
                    }
                }
            }
        }
    }
    
    None
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
/// IMPORTANT: Pushback must be gentle enough that animals can still reach attack range!
pub fn check_player_collision(
    ctx: &ReducerContext,
    proposed_x: f32,
    proposed_y: f32,
    is_attacking: bool,
) -> Option<(f32, f32)> {
    // Use different collision radius based on whether animal is attacking
    // These radii define the "no-overlap" zone - animals should stop at this distance
    let collision_radius = if is_attacking {
        ANIMAL_PLAYER_ATTACK_COLLISION_RADIUS // 50px - closer distance for attacking
    } else {
        ANIMAL_PLAYER_COLLISION_RADIUS // 65px - normal distance for non-combat
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
            
            // Calculate how much the animal needs to be pushed to reach minimum distance
            let overlap = collision_radius - distance;
            
            // CRITICAL FIX: Pushback should ONLY move animal to collision boundary + small buffer
            // Previous values (40-80px) were pushing animals outside their attack range!
            // 
            // Correct pushback: just enough to reach collision_radius + small buffer
            // This allows animals to stay within attack range (most are 72-120px)
            let buffer = if is_attacking {
                3.0 // Minimal buffer when attacking - let them stay close
            } else {
                5.0 // Small buffer when not attacking
            };
            
            let pushback_distance = overlap + buffer;
            
            // Minimum pushback of 2px to ensure some separation
            let actual_pushback = pushback_distance.max(2.0);
            
            let pushback_x = (dx / distance) * actual_pushback;
            let pushback_y = (dy / distance) * actual_pushback;
            return Some((pushback_x, pushback_y));
        }
    }
    None
}

/// Checks collision with environmental objects (trees, stones, boxes, etc.)
/// Check collision with living coral (underwater obstacles)
/// Living coral is not in the spatial grid, so we iterate directly
fn check_living_coral_collision(
    ctx: &ReducerContext,
    proposed_x: f32,
    proposed_y: f32,
) -> Option<(f32, f32)> {
    use crate::coral::living_coral;
    for coral in ctx.db.living_coral().iter() {
        if coral.respawn_at > Timestamp::UNIX_EPOCH {
            continue; // Skip respawning/destroyed coral
        }
        let coral_collision_y = coral.pos_y - LIVING_CORAL_COLLISION_Y_OFFSET;
        let dx = proposed_x - coral.pos_x;
        let dy = proposed_y - coral_collision_y;
        let distance_sq = dx * dx + dy * dy;
        let min_distance = ANIMAL_COLLISION_RADIUS + LIVING_CORAL_RADIUS;
        let min_distance_sq = min_distance * min_distance;
        
        if distance_sq < min_distance_sq && distance_sq > 0.1 {
            let distance = distance_sq.sqrt();
            let pushback_x = (dx / distance) * COLLISION_PUSHBACK_FORCE;
            let pushback_y = (dy / distance) * COLLISION_PUSHBACK_FORCE;
            return Some((pushback_x, pushback_y));
        }
    }
    None
}

pub fn check_environmental_collision(
    ctx: &ReducerContext,
    proposed_x: f32,
    proposed_y: f32,
) -> Option<(f32, f32)> {
    // PERFORMANCE: Use cached spatial grid for efficient collision detection
    let grid = spatial_grid::get_cached_spatial_grid(&ctx.db, ctx.timestamp);
    check_environmental_collision_with_grid(grid, &ctx.db, proposed_x, proposed_y)
}

/// Optimized version that uses a pre-built spatial grid
pub fn check_environmental_collision_with_grid<DB>(
    grid: &spatial_grid::SpatialGrid,
    db: &DB,
    proposed_x: f32,
    proposed_y: f32,
) -> Option<(f32, f32)> 
where
    DB: TreeTableTrait + StoneTableTrait + WoodenStorageBoxTableTrait 
        + RainCollectorTableTrait + PlayerCorpseTableTrait + FurnaceTableTrait
        + HomesteadHearthTableTrait + BasaltColumnTableTrait
        + SeaStackTableTrait,
{
    let nearby_entities = grid.get_entities_in_range(proposed_x, proposed_y);
    
    for entity in &nearby_entities {
        match entity {
            spatial_grid::EntityType::Tree(tree_id) => {
                if let Some(tree) = db.tree().id().find(tree_id) {
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
                if let Some(stone) = db.stone().id().find(stone_id) {
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
            spatial_grid::EntityType::BasaltColumn(basalt_id) => {
                if let Some(basalt) = db.basalt_column().id().find(basalt_id) {
                    let basalt_collision_y = basalt.pos_y - BASALT_COLUMN_COLLISION_Y_OFFSET;
                    let dx = proposed_x - basalt.pos_x;
                    let dy = proposed_y - basalt_collision_y;
                    let distance_sq = dx * dx + dy * dy;
                    let min_distance = ANIMAL_COLLISION_RADIUS + BASALT_COLUMN_RADIUS;
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
                if let Some(box_instance) = db.wooden_storage_box().id().find(box_id) {
                    let box_collision_y = box_instance.pos_y - crate::wooden_storage_box::get_box_collision_y_offset(box_instance.box_type);
                    let dx = proposed_x - box_instance.pos_x;
                    let dy = proposed_y - box_collision_y;
                    let distance_sq = dx * dx + dy * dy;
                    let box_radius = crate::wooden_storage_box::get_box_player_collision_radius(box_instance.box_type);
                    let min_distance = ANIMAL_COLLISION_RADIUS + box_radius;
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
                if let Some(rain_collector) = db.rain_collector().id().find(rain_collector_id) {
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
                if let Some(corpse) = db.player_corpse().id().find(corpse_id) {
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
            spatial_grid::EntityType::Furnace(furnace_id) => {
                if let Some(furnace) = db.furnace().id().find(furnace_id) {
                    if furnace.is_destroyed { continue; }
                    let furnace_collision_y = furnace.pos_y - FURNACE_COLLISION_Y_OFFSET;
                    let dx = proposed_x - furnace.pos_x;
                    let dy = proposed_y - furnace_collision_y;
                    let distance_sq = dx * dx + dy * dy;
                    let min_distance = ANIMAL_COLLISION_RADIUS + FURNACE_COLLISION_RADIUS;
                    let min_distance_sq = min_distance * min_distance;
                    
                    if distance_sq < min_distance_sq && distance_sq > 0.1 {
                        let distance = distance_sq.sqrt();
                        let pushback_x = (dx / distance) * COLLISION_PUSHBACK_FORCE;
                        let pushback_y = (dy / distance) * COLLISION_PUSHBACK_FORCE;
                        return Some((pushback_x, pushback_y));
                    }
                }
            },
            spatial_grid::EntityType::HomesteadHearth(hearth_id) => {
                if let Some(hearth) = db.homestead_hearth().id().find(hearth_id) {
                    if hearth.is_destroyed { continue; }
                    let hearth_collision_y = hearth.pos_y - HEARTH_COLLISION_Y_OFFSET;
                    let dx = proposed_x - hearth.pos_x;
                    let dy = proposed_y - hearth_collision_y;
                    let distance_sq = dx * dx + dy * dy;
                    let min_distance = ANIMAL_COLLISION_RADIUS + HEARTH_COLLISION_RADIUS;
                    let min_distance_sq = min_distance * min_distance;
                    
                    if distance_sq < min_distance_sq && distance_sq > 0.1 {
                        let distance = distance_sq.sqrt();
                        let pushback_x = (dx / distance) * COLLISION_PUSHBACK_FORCE;
                        let pushback_y = (dy / distance) * COLLISION_PUSHBACK_FORCE;
                        return Some((pushback_x, pushback_y));
                    }
                }
            },
            spatial_grid::EntityType::SeaStack(sea_stack_id) => {
                if let Some(sea_stack) = db.sea_stack().id().find(sea_stack_id) {
                    let (half_width, half_height, y_offset) = get_sea_stack_collision_dimensions(sea_stack.scale);
                    let stack_collision_y = sea_stack.pos_y - y_offset;
                    let dx = proposed_x - sea_stack.pos_x;
                    let dy = proposed_y - stack_collision_y;
                    let distance_sq = dx * dx + dy * dy;
                    let min_distance = ANIMAL_COLLISION_RADIUS + half_width.max(half_height);
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

/// Checks collision with walls (thin edges along foundation cell boundaries)
/// IMPORTANT: Wall cells use FOUNDATION_TILE_SIZE_PX (96px) coordinates, not TILE_SIZE_PX (48px)!
pub fn check_wall_collision<DB: WallCellTableTrait>(
    db: &DB,
    proposed_x: f32,
    proposed_y: f32,
) -> Option<(f32, f32)> {
    const WALL_COLLISION_THICKNESS: f32 = 6.0; // Thin collision thickness (matches player collision)
    const CHECK_RADIUS_CELLS: i32 = 2; // Check walls within 2 foundation cells
    
    // CRITICAL FIX: Walls use foundation cell coordinates (96px), NOT tile coordinates (48px)!
    let animal_cell_x = (proposed_x / FOUNDATION_TILE_SIZE_PX as f32).floor() as i32;
    let animal_cell_y = (proposed_y / FOUNDATION_TILE_SIZE_PX as f32).floor() as i32;
    
    let wall_cells = db.wall_cell();
    
    for cell_offset_x in -CHECK_RADIUS_CELLS..=CHECK_RADIUS_CELLS {
        for cell_offset_y in -CHECK_RADIUS_CELLS..=CHECK_RADIUS_CELLS {
            let check_cell_x = animal_cell_x + cell_offset_x;
            let check_cell_y = animal_cell_y + cell_offset_y;
            
            // Find walls on this foundation cell
            for wall in wall_cells.idx_cell_coords().filter((check_cell_x, check_cell_y)) {
                if wall.is_destroyed { continue; }
                
                // Calculate wall edge collision bounds using foundation cell size (96px)
                let cell_left = check_cell_x as f32 * FOUNDATION_TILE_SIZE_PX as f32;
                let cell_top = check_cell_y as f32 * FOUNDATION_TILE_SIZE_PX as f32;
                let cell_right = cell_left + FOUNDATION_TILE_SIZE_PX as f32;
                let cell_bottom = cell_top + FOUNDATION_TILE_SIZE_PX as f32;
                
                // Determine wall edge bounds based on edge direction
                // Edge 0 = North (top), 1 = East (right), 2 = South (bottom), 3 = West (left)
                let (wall_min_x, wall_max_x, wall_min_y, wall_max_y) = match wall.edge {
                    0 => { // North (top edge) - horizontal line
                        (cell_left, cell_right, cell_top - WALL_COLLISION_THICKNESS / 2.0, cell_top + WALL_COLLISION_THICKNESS / 2.0)
                    },
                    1 => { // East (right edge) - vertical line
                        (cell_right - WALL_COLLISION_THICKNESS / 2.0, cell_right + WALL_COLLISION_THICKNESS / 2.0, cell_top, cell_bottom)
                    },
                    2 => { // South (bottom edge) - horizontal line
                        (cell_left, cell_right, cell_bottom - WALL_COLLISION_THICKNESS / 2.0, cell_bottom + WALL_COLLISION_THICKNESS / 2.0)
                    },
                    3 => { // West (left edge) - vertical line
                        (cell_left - WALL_COLLISION_THICKNESS / 2.0, cell_left + WALL_COLLISION_THICKNESS / 2.0, cell_top, cell_bottom)
                    },
                    _ => continue, // Skip diagonal or invalid edges
                };
                
                // Check if animal circle intersects wall AABB
                let closest_x = proposed_x.max(wall_min_x).min(wall_max_x);
                let closest_y = proposed_y.max(wall_min_y).min(wall_max_y);
                let dx = proposed_x - closest_x;
                let dy = proposed_y - closest_y;
                let dist_sq = dx * dx + dy * dy;
                
                if dist_sq < ANIMAL_COLLISION_RADIUS * ANIMAL_COLLISION_RADIUS {
                    // Collision detected - calculate pushback direction
                    let distance = dist_sq.sqrt();
                    if distance > 0.001 {
                        let pushback_x = (dx / distance) * COLLISION_PUSHBACK_FORCE;
                        let pushback_y = (dy / distance) * COLLISION_PUSHBACK_FORCE;
                        return Some((pushback_x, pushback_y));
                    }
                }
            }
        }
    }
    None
}

/// Checks collision with foundation triangle hypotenuses (outer edges)
pub fn check_foundation_collision<DB: FoundationCellTableTrait>(
    db: &DB,
    proposed_x: f32,
    proposed_y: f32,
) -> Option<(f32, f32)> {
    const FOUNDATION_COLLISION_THICKNESS: f32 = 8.0; // Thickness for triangle hypotenuse collision
    const CHECK_RADIUS_CELLS: i32 = 2; // Check foundations within 2 foundation cells (192px)
    
    // Convert world position to foundation cell coordinates
    let foundation_cell_x = (proposed_x / FOUNDATION_TILE_SIZE_PX as f32).floor() as i32;
    let foundation_cell_y = (proposed_y / FOUNDATION_TILE_SIZE_PX as f32).floor() as i32;
    
    let foundations = db.foundation_cell();
    
    for cell_offset_x in -CHECK_RADIUS_CELLS..=CHECK_RADIUS_CELLS {
        for cell_offset_y in -CHECK_RADIUS_CELLS..=CHECK_RADIUS_CELLS {
            let check_cell_x = foundation_cell_x + cell_offset_x;
            let check_cell_y = foundation_cell_y + cell_offset_y;
            
            // Find foundations at this cell
            for foundation in foundations.idx_cell_coords().filter((check_cell_x, check_cell_y)) {
                if foundation.is_destroyed { continue; }
                
                // Only check triangle foundations (shapes 2-5)
                let foundation_shape = foundation.shape as i32;
                if foundation_shape < 2 || foundation_shape > 5 {
                    continue; // Skip full foundations (walls handle their edges)
                }
                
                // Calculate foundation cell world bounds
                let cell_top_left_x = foundation.cell_x as f32 * FOUNDATION_TILE_SIZE_PX as f32;
                let cell_top_left_y = foundation.cell_y as f32 * FOUNDATION_TILE_SIZE_PX as f32;
                let cell_bottom_right_x = cell_top_left_x + FOUNDATION_TILE_SIZE_PX as f32;
                let cell_bottom_right_y = cell_top_left_y + FOUNDATION_TILE_SIZE_PX as f32;
                
                // Calculate hypotenuse endpoints based on triangle shape
                // Triangle shapes: 2=TriNW, 3=TriNE, 4=TriSE, 5=TriSW
                let (hyp_start_x, hyp_start_y, hyp_end_x, hyp_end_y) = match foundation_shape {
                    2 => { // TriNW - hypotenuse from top-right to bottom-left
                        (cell_bottom_right_x, cell_top_left_y, cell_top_left_x, cell_bottom_right_y)
                    },
                    3 => { // TriNE - hypotenuse from top-left to bottom-right
                        (cell_top_left_x, cell_top_left_y, cell_bottom_right_x, cell_bottom_right_y)
                    },
                    4 => { // TriSE - hypotenuse from bottom-left to top-right
                        (cell_top_left_x, cell_bottom_right_y, cell_bottom_right_x, cell_top_left_y)
                    },
                    5 => { // TriSW - hypotenuse from bottom-right to top-left
                        (cell_bottom_right_x, cell_bottom_right_y, cell_top_left_x, cell_top_left_y)
                    },
                    _ => continue, // Invalid triangle shape
                };
                
                // Find closest point on hypotenuse line segment to animal position
                let line_vec_x = hyp_end_x - hyp_start_x;
                let line_vec_y = hyp_end_y - hyp_start_y;
                let line_length_sq = line_vec_x * line_vec_x + line_vec_y * line_vec_y;
                
                if line_length_sq < 0.001 {
                    continue; // Degenerate line
                }
                
                // Project animal position onto line segment
                let to_start_x = proposed_x - hyp_start_x;
                let to_start_y = proposed_y - hyp_start_y;
                let t = ((to_start_x * line_vec_x + to_start_y * line_vec_y) / line_length_sq).max(0.0).min(1.0);
                
                let closest_point_x = hyp_start_x + t * line_vec_x;
                let closest_point_y = hyp_start_y + t * line_vec_y;
                
                // Calculate distance from animal to closest point on hypotenuse
                let dx = proposed_x - closest_point_x;
                let dy = proposed_y - closest_point_y;
                let dist_sq = dx * dx + dy * dy;
                let total_thickness = ANIMAL_COLLISION_RADIUS + FOUNDATION_COLLISION_THICKNESS / 2.0;
                let total_thickness_sq = total_thickness * total_thickness;
                
                if dist_sq < total_thickness_sq && dist_sq > 0.1 {
                    // Collision detected - calculate pushback direction (perpendicular to hypotenuse)
                    let distance = dist_sq.sqrt();
                    // Normal is perpendicular to line (pointing away from animal)
                    let line_normal_x = -line_vec_y;
                    let line_normal_y = line_vec_x;
                    let normal_length = (line_normal_x * line_normal_x + line_normal_y * line_normal_y).sqrt();
                    
                    if normal_length > 0.001 {
                        let norm_x = line_normal_x / normal_length;
                        let norm_y = line_normal_y / normal_length;
                        
                        // Ensure normal points away from animal
                        let to_closest_x = closest_point_x - proposed_x;
                        let to_closest_y = closest_point_y - proposed_y;
                        let dot = norm_x * to_closest_x + norm_y * to_closest_y;
                        let final_norm_x = if dot < 0.0 { norm_x } else { -norm_x };
                        let final_norm_y = if dot < 0.0 { norm_y } else { -norm_y };
                        
                        let pushback_x = final_norm_x * COLLISION_PUSHBACK_FORCE;
                        let pushback_y = final_norm_y * COLLISION_PUSHBACK_FORCE;
                        return Some((pushback_x, pushback_y));
                    }
                }
            }
        }
    }
    None
}

/// Validates if a spawn position is suitable for an animal
/// species: When Some, used to allow aquatic species (SalmonShark, Jellyfish) to spawn on water tiles
pub fn validate_animal_spawn_position(
    ctx: &ReducerContext,
    pos_x: f32,
    pos_y: f32,
    species: Option<AnimalSpecies>,
) -> Result<(), String> {
    if crate::world_cover::blocks_path(ctx,(pos_x,pos_y),(pos_x,pos_y),32.0) {
        return Err("Cannot spawn wildlife inside natural cover".to_string());
    }
    if crate::wild_animal_npc::core::is_position_in_alk_wildlife_zone(ctx, pos_x, pos_y) {
        return Err("Cannot spawn wildlife near an ALK compound".to_string());
    }
    // Check water collision - land animals can't spawn on water; aquatic species REQUIRE water
    let is_aquatic = species.map(|s| matches!(s, AnimalSpecies::SalmonShark | AnimalSpecies::Jellyfish)).unwrap_or(false);
    if is_water_tile(ctx, pos_x, pos_y) && !is_aquatic {
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
    
    // Check wall collisions
    if let Some(_) = check_wall_collision(&ctx.db, pos_x, pos_y) {
        return Err(format!("Cannot spawn animal inside wall at ({:.1}, {:.1})", pos_x, pos_y));
    }
    
    // Check foundation collisions
    if let Some(_) = check_foundation_collision(&ctx.db, pos_x, pos_y) {
        return Err(format!("Cannot spawn animal on foundation edge at ({:.1}, {:.1})", pos_x, pos_y));
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
    if let Some(animal) = ctx.db.wild_animal().id().find(animal_id) {
        if !animal.is_flying && animal.species != AnimalSpecies::Bee && crate::world_cover::blocks_path(ctx,(animal.pos_x,animal.pos_y),(proposed_x,proposed_y),24.0) {
            return false;
        }
    }
    // Quick check for water - allow walruses to swim
    if is_water_tile(ctx, proposed_x, proposed_y) {
        if let Some(animal) = ctx.db.wild_animal().id().find(&animal_id) {
            if !matches!(animal.species, crate::wild_animal_npc::AnimalSpecies::ArcticWalrus) {
                return false; // Block non-walrus animals
            }
            // Walruses can swim
        }
    }
    
    if check_shelter_collision(ctx, proposed_x, proposed_y) {
        return false;
    }
    
    // Allow movement with pushback for other collisions
    true
}

// ==========================================================================
// LINE OF SIGHT CHECK FOR ATTACKS
// Prevents attacks through walls - if there's a wall/door between attacker and target,
// the attack should not connect.
// ==========================================================================

/// Check if there's a clear line of sight between two points (no walls, closed doors, or shelters blocking)
/// Returns true if line of sight is CLEAR (no obstacles), false if BLOCKED
pub fn has_clear_line_of_sight(
    ctx: &ReducerContext,
    from_x: f32,
    from_y: f32,
    to_x: f32,
    to_y: f32,
) -> bool {
    if crate::world_cover::blocks_path(ctx,(from_x,from_y),(to_x,to_y),0.0) { return false; }
    // If wall blocks the path, LOS is blocked
    if check_wall_line_collision(&ctx.db, from_x, from_y, to_x, to_y).is_some() {
        return false;
    }
    
    // If closed door blocks the path, LOS is blocked
    if check_door_line_collision(ctx, from_x, from_y, to_x, to_y).is_some() {
        return false;
    }
    
    // If shelter blocks the path, LOS is blocked
    // This prevents hostile NPCs from attacking players inside shelters
    if check_shelter_line_collision(ctx, from_x, from_y, to_x, to_y) {
        return false;
    }
    
    // No obstacles - clear line of sight
    true
}

/// Check if a line segment passes through any shelter collision box
/// Returns true if the line is BLOCKED by a shelter, false if clear
fn check_shelter_line_collision(
    ctx: &ReducerContext,
    start_x: f32,
    start_y: f32,
    end_x: f32,
    end_y: f32,
) -> bool {
    for shelter in ctx.db.shelter().iter() {
        if shelter.is_destroyed {
            continue;
        }
        
        // Calculate shelter AABB bounds
        let shelter_aabb_center_x = shelter.pos_x;
        let shelter_aabb_center_y = shelter.pos_y - SHELTER_AABB_CENTER_Y_OFFSET_FROM_POS_Y;
        let aabb_left = shelter_aabb_center_x - SHELTER_AABB_HALF_WIDTH;
        let aabb_right = shelter_aabb_center_x + SHELTER_AABB_HALF_WIDTH;
        let aabb_top = shelter_aabb_center_y - SHELTER_AABB_HALF_HEIGHT;
        let aabb_bottom = shelter_aabb_center_y + SHELTER_AABB_HALF_HEIGHT;
        
        // Check if start point is inside shelter (attacker inside)
        let start_inside = start_x >= aabb_left && start_x <= aabb_right && 
                          start_y >= aabb_top && start_y <= aabb_bottom;
        
        // Check if end point is inside shelter (target inside)
        let end_inside = end_x >= aabb_left && end_x <= aabb_right && 
                        end_y >= aabb_top && end_y <= aabb_bottom;
        
        // If BOTH points are inside the same shelter, LOS is clear (same shelter)
        if start_inside && end_inside {
            continue;
        }
        
        // If one is inside and one is outside, the shelter wall blocks LOS
        if start_inside != end_inside {
            log::debug!("[LOS] Shelter {} blocks attack - attacker_inside={}, target_inside={}", 
                shelter.id, start_inside, end_inside);
            return true; // Blocked
        }
        
        // If both are outside, check if line passes through the shelter
        if line_intersects_aabb(start_x, start_y, end_x, end_y, aabb_left, aabb_right, aabb_top, aabb_bottom) {
            log::debug!("[LOS] Shelter {} blocks attack - line passes through", shelter.id);
            return true; // Blocked
        }
    }
    
    false // No shelter blocks the line
}

/// Check if a line segment intersects with an AABB
fn line_intersects_aabb(
    x1: f32, y1: f32, x2: f32, y2: f32,
    left: f32, right: f32, top: f32, bottom: f32
) -> bool {
    let dx = x2 - x1;
    let dy = y2 - y1;
    
    // If line is a point, check if it's inside the AABB
    if dx.abs() < 0.001 && dy.abs() < 0.001 {
        return x1 >= left && x1 <= right && y1 >= top && y1 <= bottom;
    }
    
    let mut t_min: f32 = 0.0;
    let mut t_max: f32 = 1.0;
    
    // Check X bounds
    if dx.abs() > 0.001 {
        let t1 = (left - x1) / dx;
        let t2 = (right - x1) / dx;
        let t_near = t1.min(t2);
        let t_far = t1.max(t2);
        
        t_min = t_min.max(t_near);
        t_max = t_max.min(t_far);
        
        if t_min > t_max {
            return false;
        }
    } else {
        // Line is vertical, check if it's within X bounds
        if x1 < left || x1 > right {
            return false;
        }
    }
    
    // Check Y bounds
    if dy.abs() > 0.001 {
        let t1 = (top - y1) / dy;
        let t2 = (bottom - y1) / dy;
        let t_near = t1.min(t2);
        let t_far = t1.max(t2);
        
        t_min = t_min.max(t_near);
        t_max = t_max.min(t_far);
        
        if t_min > t_max {
            return false;
        }
    } else {
        // Line is horizontal, check if it's within Y bounds
        if y1 < top || y1 > bottom {
            return false;
        }
    }
    
    true // Line intersects AABB
}
