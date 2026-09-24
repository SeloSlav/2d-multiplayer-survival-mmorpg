/******************************************************************************
 *                                                                            *
 * Door System - Placeable doors on foundation edges                          *
 *                                                                            *
 * Handles placement, opening/closing, and pickup of doors.                   *
 * Doors can only be placed on North/South edges of foundations.              *
 *                                                                            *
 ******************************************************************************/

use spacetimedb::{Identity, Timestamp, ReducerContext, Table, log};
use crate::{
    models::{BuildingEdge, ItemLocation, InventoryLocationData},
    environment::calculate_chunk_index,
    building::{FOUNDATION_TILE_SIZE_PX, BUILDING_PLACEMENT_MAX_DISTANCE_SQUARED, BUILDING_PLACEMENT_MAX_DISTANCE, DOOR_WOOD_MAX_HEALTH, DOOR_METAL_MAX_HEALTH},
    homestead_hearth::homestead_hearth, // Import the trait for accessing homestead_hearth table
};
use crate::player as PlayerTableTrait;
use crate::items::{item_definition as ItemDefinitionTableTrait, inventory_item as InventoryItemTableTrait};
use crate::building::foundation_cell as FoundationCellTableTrait;
use crate::building::wall_cell as WallCellTableTrait;

// --- Constants ---

/// Door types
pub const DOOR_TYPE_WOOD: u8 = 0;
pub const DOOR_TYPE_METAL: u8 = 1;

/// Door collision thickness (same as walls)
pub const DOOR_COLLISION_THICKNESS: f32 = 6.0;

/// Door interaction distance (same as other building objects like campfires, storage boxes)
pub const DOOR_INTERACTION_DISTANCE: f32 = 96.0; // Standard interaction distance (matches campfire, storage box, etc.)
pub const DOOR_INTERACTION_DISTANCE_SQUARED: f32 = DOOR_INTERACTION_DISTANCE * DOOR_INTERACTION_DISTANCE;

// --- Door Table ---

#[spacetimedb::table(
    accessor = door,
    public,
    index(accessor = idx_chunk, name = "idx_door_chunk", btree(columns = [chunk_index])),
    index(accessor = idx_cell_coords, name = "idx_door_cell_coords", btree(columns = [cell_x, cell_y]))
)]
#[derive(Clone, Debug)]
pub struct Door {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub owner_id: Identity,
    pub door_type: u8,        // 0 = Wood, 1 = Metal
    pub cell_x: i32,          // Foundation cell X
    pub cell_y: i32,          // Foundation cell Y
    pub edge: u8,             // 0 = North, 2 = South (matching wall edge convention)
    pub is_open: bool,        // Open/closed state
    pub pos_x: f32,           // World position X (edge center)
    pub pos_y: f32,           // World position Y (edge center)
    pub health: f32,
    pub max_health: f32,
    pub placed_at: Timestamp,
    pub chunk_index: u32,
    pub is_destroyed: bool,
    pub destroyed_at: Option<Timestamp>,
    pub last_hit_time: Option<Timestamp>,
    pub last_damaged_by: Option<Identity>,
}

// --- Helper Functions ---

/// Get door item name from door type
fn get_door_item_name(door_type: u8) -> &'static str {
    match door_type {
        DOOR_TYPE_WOOD => "Wood Door",
        DOOR_TYPE_METAL => "Metal Door",
        _ => "Wood Door",
    }
}

/// Get door max health from door type
fn get_door_max_health(door_type: u8) -> f32 {
    match door_type {
        DOOR_TYPE_WOOD => DOOR_WOOD_MAX_HEALTH,
        DOOR_TYPE_METAL => DOOR_METAL_MAX_HEALTH,
        _ => DOOR_WOOD_MAX_HEALTH,
    }
}

/// Check if a door position is valid (foundation exists, N/S edge only, no existing door/wall)
pub fn is_door_position_valid(
    ctx: &ReducerContext,
    cell_x: i32,
    cell_y: i32,
    edge: BuildingEdge,
) -> Result<(), String> {
    // 1. Only allow North or South edges
    if !matches!(edge, BuildingEdge::N | BuildingEdge::S) {
        return Err("Doors can only be placed on North or South edges.".to_string());
    }
    
    // 2. Check if there's a foundation at this cell
    let foundations = ctx.db.foundation_cell();
    let mut foundation_found = false;
    
    for foundation in foundations.idx_cell_coords().filter((cell_x, cell_y)) {
        if !foundation.is_destroyed {
            foundation_found = true;
            break;
        }
    }
    
    if !foundation_found {
        return Err("Cannot place door: no foundation at this location.".to_string());
    }
    
    // 3. Check if there's already a wall at this edge
    let walls = ctx.db.wall_cell();
    for wall in walls.idx_cell_coords().filter((cell_x, cell_y)) {
        if !wall.is_destroyed && wall.edge == edge as u8 {
            return Err("A wall already exists at this edge.".to_string());
        }
    }
    
    // 4. Check if there's already a door at this edge
    let doors = ctx.db.door();
    for door in doors.idx_cell_coords().filter((cell_x, cell_y)) {
        if !door.is_destroyed && door.edge == edge as u8 {
            return Err("A door already exists at this edge.".to_string());
        }
    }
    
    // 5. Check adjacent tiles for shared edges (walls or doors)
    let (adjacent_cell_x, adjacent_cell_y, opposite_edge) = match edge {
        BuildingEdge::N => (cell_x, cell_y - 1, BuildingEdge::S as u8),
        BuildingEdge::S => (cell_x, cell_y + 1, BuildingEdge::N as u8),
        _ => return Err("Invalid edge for door.".to_string()),
    };
    
    // Check adjacent cell for walls on the opposite edge
    for wall in walls.idx_cell_coords().filter((adjacent_cell_x, adjacent_cell_y)) {
        if !wall.is_destroyed && wall.edge == opposite_edge {
            return Err("A wall already exists on the shared edge with the adjacent tile.".to_string());
        }
    }
    
    // Check adjacent cell for doors on the opposite edge
    for door in doors.idx_cell_coords().filter((adjacent_cell_x, adjacent_cell_y)) {
        if !door.is_destroyed && door.edge == opposite_edge {
            return Err("A door already exists on the shared edge with the adjacent tile.".to_string());
        }
    }
    
    Ok(())
}

/// Calculate door world position from cell coordinates and edge
pub fn calculate_door_position(cell_x: i32, cell_y: i32, edge: BuildingEdge) -> (f32, f32) {
    let tile_size = FOUNDATION_TILE_SIZE_PX as f32;
    let tile_left = cell_x as f32 * tile_size;
    let tile_top = cell_y as f32 * tile_size;
    let tile_center_x = tile_left + (tile_size / 2.0);
    
    match edge {
        BuildingEdge::N => (tile_center_x, tile_top),
        BuildingEdge::S => (tile_center_x, tile_top + tile_size),
        _ => (tile_center_x, tile_top + (tile_size / 2.0)), // Fallback to center
    }
}

/// Returns the melee damage multiplier for a given door type
/// Doors resist melee damage significantly to prevent bypassing walls
/// Wood Door (type 0): Same resistance as Stone walls (10%)
/// Metal Door (type 1): Same resistance as Metal walls (5%)
fn get_door_damage_multiplier(door_type: u8) -> f32 {
    match door_type {
        DOOR_TYPE_WOOD => crate::building::MELEE_DAMAGE_MULT_STONE,  // Wood doors = Stone wall resistance
        DOOR_TYPE_METAL => crate::building::MELEE_DAMAGE_MULT_METAL, // Metal doors = Metal wall resistance
        _ => crate::building::MELEE_DAMAGE_MULT_METAL, // Unknown = Metal resistance
    }
}

/// Apply damage to a door and handle destruction
/// Damage is reduced based on door type - melee is ineffective vs doors (like walls)
pub fn damage_door(
    ctx: &ReducerContext,
    attacker_id: Identity,
    door_id: u64,
    damage: f32,
    current_time: Timestamp,
) -> Result<(), String> {
    let doors = ctx.db.door();
    
    let mut door = doors.id().find(door_id)
        .ok_or_else(|| format!("Door {} not found", door_id))?;
    
    if door.is_destroyed {
        return Err(format!("Door {} is already destroyed", door_id));
    }
    
    // <<< PVP RAIDING CHECK >>>
    if let Some(attacker_player) = ctx.db.player().identity().find(&attacker_id) {
        let attacker_pvp = crate::combat::is_pvp_active_for_player(&attacker_player, current_time);
        
        // Check if owner has PvP enabled (if owner is not the attacker)
        if door.owner_id != attacker_id {
            if let Some(owner_player) = ctx.db.player().identity().find(&door.owner_id) {
                let owner_pvp = crate::combat::is_pvp_active_for_player(&owner_player, current_time);
                
                if !attacker_pvp || !owner_pvp {
                    log::debug!("Structure raiding blocked - Attacker PvP: {}, Owner PvP: {}", 
                        attacker_pvp, owner_pvp);
                    return Err("Cannot damage structure - PvP raiding requires both players to have PvP enabled.".to_string());
                }
            }
        }
    }
    // <<< END PVP RAIDING CHECK >>>
    
    // Apply melee damage reduction based on door type
    // Doors resist melee significantly to prevent bypassing walls
    let damage_multiplier = get_door_damage_multiplier(door.door_type);
    let effective_damage = damage * damage_multiplier;
    
    // Apply damage
    door.health = (door.health - effective_damage).max(0.0);
    door.last_hit_time = Some(current_time);
    door.last_damaged_by = Some(attacker_id);
    
    let door_name = if door.door_type == DOOR_TYPE_WOOD { "Wood" } else { "Metal" };
    log::info!(
        "[DoorDamage] {} Door {} took {:.1} damage (base: {:.1}, mult: {:.0}%) from {:?}. Health: {:.1}/{:.1}",
        door_name, door_id, effective_damage, damage, damage_multiplier * 100.0, attacker_id, door.health, door.max_health
    );
    
    // Check if door is destroyed
    if door.health <= 0.0 {
        door.is_destroyed = true;
        door.destroyed_at = Some(current_time);
        log::info!("[DoorDamage] {} Door {} destroyed by {:?}", door_name, door_id, attacker_id);
    }
    
    // Update door in database
    ctx.db.door().id().update(door);
    
    Ok(())
}

/// Applies explosive damage to a door (bypasses melee damage reduction)
/// Used by explosion system - explosives are effective against all door types
pub fn damage_door_explosive(
    ctx: &ReducerContext,
    attacker_id: Identity,
    door_id: u64,
    damage: f32,
) {
    let doors = ctx.db.door();
    
    if let Some(mut door) = doors.id().find(door_id) {
        if door.is_destroyed {
            return;
        }
        
        // <<< PVP RAIDING CHECK >>>
        if let Some(attacker_player) = ctx.db.player().identity().find(&attacker_id) {
            let attacker_pvp = crate::combat::is_pvp_active_for_player(&attacker_player, ctx.timestamp);
            
            if door.owner_id != attacker_id {
                if let Some(owner_player) = ctx.db.player().identity().find(&door.owner_id) {
                    let owner_pvp = crate::combat::is_pvp_active_for_player(&owner_player, ctx.timestamp);
                    
                    if !attacker_pvp || !owner_pvp {
                        log::debug!("Structure raiding blocked - Attacker PvP: {}, Owner PvP: {}", 
                            attacker_pvp, owner_pvp);
                        return; // Skip this structure in explosion
                    }
                }
            }
        }
        // <<< END PVP RAIDING CHECK >>>
        
        // Explosive damage bypasses melee reduction - full damage to all door types
        let old_health = door.health;
        door.health = (door.health - damage).max(0.0);
        door.last_hit_time = Some(ctx.timestamp);
        
        let door_name = if door.door_type == DOOR_TYPE_WOOD { "Wood" } else { "Metal" };
        
        if door.health <= 0.0 {
            door.is_destroyed = true;
            door.destroyed_at = Some(ctx.timestamp);
            crate::sound_events::emit_door_destroyed_sound(ctx, door.pos_x, door.pos_y, ctx.sender());
            log::info!("[DoorExplosiveDamage] {} Door {} destroyed by explosion", door_name, door_id);
        } else {
            crate::sound_events::emit_melee_hit_sharp_sound(ctx, door.pos_x, door.pos_y, ctx.sender());
            log::info!("[DoorExplosiveDamage] {} Door {} took {:.1} explosive damage, health: {:.1}", door_name, door_id, damage, door.health);
        }
        
        doors.id().update(door);
    }
}

/// Check if a world position collides with any closed door
/// Returns pushback vector if collision detected
/// Uses circle-AABB collision detection (like walls)
pub fn check_door_collision(
    ctx: &ReducerContext,
    proposed_x: f32,
    proposed_y: f32,
    entity_radius: f32,
) -> Option<(f32, f32)> {
    const CHECK_RADIUS_TILES: i32 = 2;
    const SLIDE_SEPARATION_DISTANCE: f32 = 2.0; // Minimum separation distance
    
    // Convert to foundation cell coordinates
    let entity_cell_x = (proposed_x / FOUNDATION_TILE_SIZE_PX as f32).floor() as i32;
    let entity_cell_y = (proposed_y / FOUNDATION_TILE_SIZE_PX as f32).floor() as i32;
    
    let doors = ctx.db.door();
    
    for cell_offset_x in -CHECK_RADIUS_TILES..=CHECK_RADIUS_TILES {
        for cell_offset_y in -CHECK_RADIUS_TILES..=CHECK_RADIUS_TILES {
            let check_cell_x = entity_cell_x + cell_offset_x;
            let check_cell_y = entity_cell_y + cell_offset_y;
            
            for door in doors.idx_cell_coords().filter((check_cell_x, check_cell_y)) {
                // Skip destroyed or open doors
                if door.is_destroyed || door.is_open {
                    continue;
                }
                
                // Calculate door edge collision bounds
                let tile_left = check_cell_x as f32 * FOUNDATION_TILE_SIZE_PX as f32;
                let tile_top = check_cell_y as f32 * FOUNDATION_TILE_SIZE_PX as f32;
                let tile_right = tile_left + FOUNDATION_TILE_SIZE_PX as f32;
                let tile_bottom = tile_top + FOUNDATION_TILE_SIZE_PX as f32;
                
                // Determine door edge bounds (similar to wall collision)
                // South doors have collision positioned higher to prevent visual clipping through bottom half
                let (door_min_x, door_max_x, door_min_y, door_max_y) = match door.edge {
                    0 => { // North edge - perfect as is
                        (tile_left, tile_right, tile_top - DOOR_COLLISION_THICKNESS / 2.0, tile_top + DOOR_COLLISION_THICKNESS / 2.0)
                    },
                    2 => { // South edge - positioned higher to cover more of door visually
                        // Move collision up by 24px from bottom edge to prevent visual clipping
                        const SOUTH_DOOR_COLLISION_OFFSET: f32 = 24.0;
                        let collision_y = tile_bottom - SOUTH_DOOR_COLLISION_OFFSET;
                        (tile_left, tile_right, collision_y - DOOR_COLLISION_THICKNESS / 2.0, collision_y + DOOR_COLLISION_THICKNESS / 2.0)
                    },
                    _ => continue, // Invalid edge for door
                };
                
                // Check if entity circle intersects door AABB (circle-AABB collision)
                let closest_x = proposed_x.max(door_min_x).min(door_max_x);
                let closest_y = proposed_y.max(door_min_y).min(door_max_y);
                let dx = proposed_x - closest_x;
                let dy = proposed_y - closest_y;
                let dist_sq = dx * dx + dy * dy;
                
                if dist_sq < entity_radius * entity_radius {
                    // Collision detected - calculate pushback
                    let dist = dist_sq.sqrt();
                    if dist > 0.001 {
                        let norm_x = dx / dist;
                        let norm_y = dy / dist;
                        
                        // Push away from door to maintain minimum separation
                        let min_dist = entity_radius + SLIDE_SEPARATION_DISTANCE;
                        let pushback_distance = min_dist - dist;
                        let pushback_x = norm_x * pushback_distance;
                        let pushback_y = norm_y * pushback_distance;
                        
                        return Some((pushback_x, pushback_y));
                    } else {
                        // Very close to door, push away from door center
                        let door_center_x = (door_min_x + door_max_x) / 2.0;
                        let door_center_y = (door_min_y + door_max_y) / 2.0;
                        let center_dx = proposed_x - door_center_x;
                        let center_dy = proposed_y - door_center_y;
                        let center_dist = (center_dx * center_dx + center_dy * center_dy).sqrt();
                        if center_dist > 0.001 {
                            let norm_x = center_dx / center_dist;
                            let norm_y = center_dy / center_dist;
                            let pushback_distance = entity_radius + SLIDE_SEPARATION_DISTANCE;
                            return Some((norm_x * pushback_distance, norm_y * pushback_distance));
                        } else {
                            // Default pushback direction
                            return Some((0.0, entity_radius + SLIDE_SEPARATION_DISTANCE));
                        }
                    }
                }
            }
        }
    }
    
    None
}

/// Check if a line segment intersects any closed door (for projectile collision)
/// Returns Some((door_id, collision_x, collision_y)) if collision occurs
pub fn check_door_projectile_collision(
    ctx: &ReducerContext,
    start_x: f32,
    start_y: f32,
    end_x: f32,
    end_y: f32,
) -> Option<(u64, f32, f32)> {
    const CHECK_RADIUS_TILES: i32 = 3;
    
    // Get center point for spatial query
    let center_x = (start_x + end_x) / 2.0;
    let center_y = (start_y + end_y) / 2.0;
    
    let center_cell_x = (center_x / FOUNDATION_TILE_SIZE_PX as f32).floor() as i32;
    let center_cell_y = (center_y / FOUNDATION_TILE_SIZE_PX as f32).floor() as i32;
    
    let doors = ctx.db.door();
    
    for cell_offset_x in -CHECK_RADIUS_TILES..=CHECK_RADIUS_TILES {
        for cell_offset_y in -CHECK_RADIUS_TILES..=CHECK_RADIUS_TILES {
            let check_cell_x = center_cell_x + cell_offset_x;
            let check_cell_y = center_cell_y + cell_offset_y;
            
            for door in doors.idx_cell_coords().filter((check_cell_x, check_cell_y)) {
                // Skip destroyed or open doors
                if door.is_destroyed || door.is_open {
                    continue;
                }
                
                // Calculate door edge collision bounds
                let tile_left = check_cell_x as f32 * FOUNDATION_TILE_SIZE_PX as f32;
                let tile_top = check_cell_y as f32 * FOUNDATION_TILE_SIZE_PX as f32;
                let tile_right = tile_left + FOUNDATION_TILE_SIZE_PX as f32;
                let tile_bottom = tile_top + FOUNDATION_TILE_SIZE_PX as f32;
                
                let (door_min_x, door_max_x, door_min_y, door_max_y) = match door.edge {
                    0 => { // North edge
                        (tile_left, tile_right, tile_top - DOOR_COLLISION_THICKNESS / 2.0, tile_top + DOOR_COLLISION_THICKNESS / 2.0)
                    },
                    2 => { // South edge - positioned higher to match player collision offset
                        const SOUTH_DOOR_COLLISION_OFFSET: f32 = 24.0;
                        let collision_y = tile_bottom - SOUTH_DOOR_COLLISION_OFFSET;
                        (tile_left, tile_right, collision_y - DOOR_COLLISION_THICKNESS / 2.0, collision_y + DOOR_COLLISION_THICKNESS / 2.0)
                    },
                    _ => continue,
                };
                
                // Simple AABB vs line segment intersection check
                if line_intersects_aabb(start_x, start_y, end_x, end_y, 
                                       door_min_x, door_min_y, door_max_x, door_max_y) {
                    // Calculate approximate collision point
                    let collision_x = end_x.max(door_min_x).min(door_max_x);
                    let collision_y = end_y.max(door_min_y).min(door_max_y);
                    
                    log::info!(
                        "[DoorProjectileCollision] Projectile path from ({:.1}, {:.1}) to ({:.1}, {:.1}) hits Door {} at ({:.1}, {:.1})",
                        start_x, start_y, end_x, end_y, door.id, collision_x, collision_y
                    );
                    
                    return Some((door.id, collision_x, collision_y));
                }
            }
        }
    }
    
    None
}

/// Check if a line segment is blocked by any closed door (for melee attacks)
/// Returns Some(door_id) if a closed door is blocking the line, None otherwise
pub fn check_line_hits_door(
    ctx: &ReducerContext,
    start_x: f32,
    start_y: f32,
    end_x: f32,
    end_y: f32,
) -> Option<u64> {
    check_door_projectile_collision(ctx, start_x, start_y, end_x, end_y)
        .map(|(door_id, _, _)| door_id)
}

/// Simple line segment vs AABB intersection test
fn line_intersects_aabb(
    x1: f32, y1: f32, x2: f32, y2: f32,
    min_x: f32, min_y: f32, max_x: f32, max_y: f32,
) -> bool {
    // Parametric line: P(t) = P1 + t(P2 - P1), t in [0, 1]
    let dx = x2 - x1;
    let dy = y2 - y1;
    
    let mut t_min = 0.0f32;
    let mut t_max = 1.0f32;
    
    // Check X axis
    if dx.abs() < 0.0001 {
        // Line is vertical
        if x1 < min_x || x1 > max_x {
            return false;
        }
    } else {
        let t1 = (min_x - x1) / dx;
        let t2 = (max_x - x1) / dx;
        let (t1, t2) = if t1 > t2 { (t2, t1) } else { (t1, t2) };
        t_min = t_min.max(t1);
        t_max = t_max.min(t2);
        if t_min > t_max {
            return false;
        }
    }
    
    // Check Y axis
    if dy.abs() < 0.0001 {
        // Line is horizontal
        if y1 < min_y || y1 > max_y {
            return false;
        }
    } else {
        let t1 = (min_y - y1) / dy;
        let t2 = (max_y - y1) / dy;
        let (t1, t2) = if t1 > t2 { (t2, t1) } else { (t1, t2) };
        t_min = t_min.max(t1);
        t_max = t_max.min(t2);
        if t_min > t_max {
            return false;
        }
    }
    
    true
}

// --- Reducers ---

/// Place a door on the edge of a foundation tile (North or South only)
#[spacetimedb::reducer]
pub fn place_door(
    ctx: &ReducerContext,
    cell_x: i64,
    cell_y: i64,
    world_x: f32,
    world_y: f32,
    door_type: u8,
) -> Result<(), String> {
    let sender_id = ctx.sender();
    let players = ctx.db.player();
    
    log::info!(
        "[PlaceDoor] Player {:?} attempting to place door at cell ({}, {}), world=({:.1}, {:.1}), type={}",
        sender_id, cell_x, cell_y, world_x, world_y, door_type
    );
    
    // 1. Validate player
    let player = players.identity().find(&sender_id)
        .ok_or_else(|| "Player not found".to_string())?;
    
    if player.is_dead {
        return Err("Cannot place door while dead.".to_string());
    }
    
    if player.is_knocked_out {
        return Err("Cannot place door while knocked out.".to_string());
    }
    
    // 2. Validate door type
    if door_type != DOOR_TYPE_WOOD && door_type != DOOR_TYPE_METAL {
        return Err(format!("Invalid door type: {}. Must be 0 (Wood) or 1 (Metal).", door_type));
    }
    
    let cell_x_i32 = cell_x as i32;
    let cell_y_i32 = cell_y as i32;
    
    // 3. Determine which edge based on world position
    let tile_size = FOUNDATION_TILE_SIZE_PX as f32;
    let tile_center_y = (cell_y_i32 as f32 * tile_size) + (tile_size / 2.0);
    let dy = world_y - tile_center_y;
    
    let edge = if dy < 0.0 {
        BuildingEdge::N
    } else {
        BuildingEdge::S
    };
    
    // 4. Validate door position
    is_door_position_valid(ctx, cell_x_i32, cell_y_i32, edge)?;
    
    // 5. Check placement distance from player
    let (door_pos_x, door_pos_y) = calculate_door_position(cell_x_i32, cell_y_i32, edge);

    // Validate the same snapped edge position shown by the client preview.
    crate::building::check_monument_zone_placement(ctx, door_pos_x, door_pos_y)?;
    
    let dx = door_pos_x - player.position_x;
    let dy = door_pos_y - player.position_y;
    let dist_sq = dx * dx + dy * dy;
    
    if dist_sq > BUILDING_PLACEMENT_MAX_DISTANCE_SQUARED {
        return Err(format!(
            "Door placement too far from player. Distance: {:.1}px, Max: {:.1}px",
            dist_sq.sqrt(),
            BUILDING_PLACEMENT_MAX_DISTANCE
        ));
    }
    
    // 6. Check and consume door item from inventory
    let door_item_name = get_door_item_name(door_type);
    let inventory = ctx.db.inventory_item();
    let item_defs = ctx.db.item_definition();
    
    let door_item_def = item_defs.iter()
        .find(|def| def.name == door_item_name)
        .ok_or_else(|| format!("{} item definition not found", door_item_name))?;
    
    // Find door item in player's inventory or hotbar
    let mut door_item_found = None;
    for item in inventory.iter() {
        if item.item_def_id == door_item_def.id {
            match &item.location {
                ItemLocation::Inventory(data) if data.owner_id == sender_id => {
                    door_item_found = Some(item.clone());
                    break;
                }
                ItemLocation::Hotbar(data) if data.owner_id == sender_id => {
                    door_item_found = Some(item.clone());
                    break;
                }
                _ => {}
            }
        }
    }
    
    let door_item = door_item_found.ok_or_else(|| format!("You need a {} to place a door.", door_item_name))?;
    
    // Consume one door item
    if door_item.quantity > 1 {
        let mut updated_item = door_item.clone();
        updated_item.quantity -= 1;
        ctx.db.inventory_item().instance_id().update(updated_item);
    } else {
        ctx.db.inventory_item().instance_id().delete(&door_item.instance_id);
    }
    
    // 7. Calculate chunk index
    let chunk_index = calculate_chunk_index(door_pos_x, door_pos_y);
    
    // 8. Get max health for door type
    let max_health = get_door_max_health(door_type);
    
    // 9. Insert door
    let doors = ctx.db.door();
    let new_door = Door {
        id: 0, // Auto-increment
        owner_id: sender_id,
        door_type,
        cell_x: cell_x_i32,
        cell_y: cell_y_i32,
        edge: edge as u8,
        is_open: false,
        pos_x: door_pos_x,
        pos_y: door_pos_y,
        health: max_health,
        max_health,
        placed_at: ctx.timestamp,
        chunk_index,
        is_destroyed: false,
        destroyed_at: None,
        last_hit_time: None,
        last_damaged_by: None,
    };
    
    match doors.try_insert(new_door) {
        Ok(inserted_door) => {
            log::info!(
                "[PlaceDoor] Successfully placed {} (id={}) at cell ({}, {}), edge={:?}, pos=({:.1}, {:.1})",
                door_item_name, inserted_door.id, cell_x_i32, cell_y_i32, edge, door_pos_x, door_pos_y
            );
            Ok(())
        }
        Err(e) => {
            log::error!("[PlaceDoor] Failed to insert door: {}", e);
            Err(format!("Failed to place door: {}", e))
        }
    }
}

/// Toggle door open/closed state (requires building privilege)
#[spacetimedb::reducer]
pub fn interact_door(ctx: &ReducerContext, door_id: u64) -> Result<(), String> {
    let sender_id = ctx.sender();
    let players = ctx.db.player();
    let doors = ctx.db.door();
    
    log::info!("[InteractDoor] Player {:?} attempting to interact with door {}", sender_id, door_id);
    
    // 1. Validate player
    let player = players.identity().find(&sender_id)
        .ok_or_else(|| "Player not found".to_string())?;
    
    if player.is_dead {
        return Err("Cannot interact with door while dead.".to_string());
    }
    
    if player.is_knocked_out {
        return Err("Cannot interact with door while knocked out.".to_string());
    }
    
    // 2. Find door
    let door = doors.id().find(&door_id)
        .ok_or_else(|| "Door not found".to_string())?;
    
    if door.is_destroyed {
        return Err("Door is destroyed.".to_string());
    }
    
    // 3. Check building privilege - anyone with privilege can open/close doors
    // EARLY GAME: If no hearths exist, allow anyone to use doors (pre-privilege phase)
    // LATE GAME: Once hearths exist, require building privilege (prevents former owner abuse)
    use crate::homestead_hearth::player_has_building_privilege;
    let hearths = ctx.db.homestead_hearth();
    let any_hearth_exists = hearths.iter().any(|h| !h.is_destroyed);
    
    if any_hearth_exists && !player_has_building_privilege(ctx, sender_id) {
        return Err("Building privilege required to open/close doors.".to_string());
    }
    
    // 4. Check distance
    let dx = door.pos_x - player.position_x;
    let dy = door.pos_y - player.position_y;
    let dist_sq = dx * dx + dy * dy;
    
    if dist_sq > DOOR_INTERACTION_DISTANCE_SQUARED {
        return Err("Door is too far away.".to_string());
    }
    
    // 5. Toggle open state
    let mut updated_door = door.clone();
    updated_door.is_open = !door.is_open;
    doors.id().update(updated_door.clone());
    
    let state_str = if updated_door.is_open { "opened" } else { "closed" };
    log::info!("[InteractDoor] Door {} {} by player {:?}", door_id, state_str, sender_id);
    
    // 6. Play door sound when door is opened or closed (same sound for both)
    crate::sound_events::emit_door_opening_sound(ctx, door.pos_x, door.pos_y, sender_id);
    
    Ok(())
}

/// Pick up a door and return it to inventory (requires building privilege)
#[spacetimedb::reducer]
pub fn pickup_door(ctx: &ReducerContext, door_id: u64) -> Result<(), String> {
    let sender_id = ctx.sender();
    let players = ctx.db.player();
    let doors = ctx.db.door();
    let item_defs = ctx.db.item_definition();
    
    log::info!("[PickupDoor] Player {:?} attempting to pickup door {}", sender_id, door_id);
    
    // 1. Validate player
    let player = players.identity().find(&sender_id)
        .ok_or_else(|| "Player not found".to_string())?;
    
    if player.is_dead {
        return Err("Cannot pickup door while dead.".to_string());
    }
    
    if player.is_knocked_out {
        return Err("Cannot pickup door while knocked out.".to_string());
    }
    
    // 2. Find door
    let door = doors.id().find(&door_id)
        .ok_or_else(|| "Door not found".to_string())?;
    
    if door.is_destroyed {
        return Err("Door is destroyed.".to_string());
    }
    
    // 3. Check building privilege - anyone with privilege can pickup doors
    // EARLY GAME: If no hearths exist, allow anyone to pickup doors (pre-privilege phase)
    // LATE GAME: Once hearths exist, require building privilege (prevents former owner abuse)
    use crate::homestead_hearth::player_has_building_privilege;
    let hearths = ctx.db.homestead_hearth();
    let any_hearth_exists = hearths.iter().any(|h| !h.is_destroyed);
    
    if any_hearth_exists && !player_has_building_privilege(ctx, sender_id) {
        return Err("Building privilege required to pickup doors.".to_string());
    }
    
    // 4. Check distance
    let dx = door.pos_x - player.position_x;
    let dy = door.pos_y - player.position_y;
    let dist_sq = dx * dx + dy * dy;
    
    if dist_sq > DOOR_INTERACTION_DISTANCE_SQUARED {
        return Err("Door is too far away.".to_string());
    }
    
    // 5. Get door item definition
    let door_item_name = get_door_item_name(door.door_type);
    let door_item_def = item_defs.iter()
        .find(|def| def.name == door_item_name)
        .ok_or_else(|| format!("{} item definition not found", door_item_name))?;
    
    // 6. Add door item to inventory using helper function
    match crate::items::add_item_to_player_inventory(ctx, sender_id, door_item_def.id, 1) {
        Ok(_) => {
            log::info!("[PickupDoor] Successfully added door item to inventory for player {:?}", sender_id);
        }
        Err(e) => {
            log::error!("[PickupDoor] Failed to add door to inventory: {}", e);
            return Err(format!("Failed to add door to inventory: {}", e));
        }
    }
    
    // 8. Delete the door entity
    doors.id().delete(door_id);
    
    log::info!("[PickupDoor] Successfully picked up door {} by player {:?}", door_id, sender_id);
    
    Ok(())
}

