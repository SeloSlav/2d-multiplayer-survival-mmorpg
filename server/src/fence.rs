/******************************************************************************
 *                                                                            *
 * Fence System - Placeable fences on foundation cell edges                  *
 *                                                                            *
 * Handles placement, damage, and destruction of fences.                    *
 * Fences snap to 96px foundation cell edges (same as walls) but don't      *
 * require a foundation underneath.                                          *
 *                                                                            *
 ******************************************************************************/

use spacetimedb::{Identity, Timestamp, ReducerContext, Table, log};
use crate::{
    models::{ItemLocation, BuildingTier},
    environment::{calculate_chunk_index, is_position_on_water},
    building::{BUILDING_PLACEMENT_MAX_DISTANCE_SQUARED, BUILDING_PLACEMENT_MAX_DISTANCE, player_has_blueprint, player_has_repair_hammer, WALL_WOOD_MAX_HEALTH, WALL_STONE_MAX_HEALTH, WALL_METAL_MAX_HEALTH, MELEE_DAMAGE_MULT_WOOD, MELEE_DAMAGE_MULT_STONE, MELEE_DAMAGE_MULT_METAL, check_monument_zone_placement, FOUNDATION_TILE_SIZE_PX, is_valid_building_tier},
};
use crate::player as PlayerTableTrait;
use crate::items::{item_definition as ItemDefinitionTableTrait, inventory_item as InventoryItemTableTrait};
use crate::building::wall_cell as WallCellTableTrait;
use crate::homestead_hearth::homestead_hearth;

// --- Constants ---

/// Fence health by tier (same as walls since they serve similar defensive purpose)
pub const FENCE_WOOD_MAX_HEALTH: f32 = WALL_WOOD_MAX_HEALTH;   // 500.0
pub const FENCE_STONE_MAX_HEALTH: f32 = WALL_STONE_MAX_HEALTH; // 1500.0
pub const FENCE_METAL_MAX_HEALTH: f32 = WALL_METAL_MAX_HEALTH; // 4000.0

/// Legacy constant for backwards compatibility
pub const FENCE_MAX_HEALTH: f32 = FENCE_WOOD_MAX_HEALTH; // 500.0

/// Fence collision thickness (same as walls)
pub const FENCE_COLLISION_THICKNESS: f32 = 6.0;

/// Fence wood cost (same as walls)
pub const FENCE_WOOD_COST: u32 = 15;

/// Fence edge constants (matching wall BuildingEdge)
/// Fences use the same edge system as walls for perfect alignment
pub const FENCE_EDGE_NORTH: u8 = 0;
pub const FENCE_EDGE_EAST: u8 = 1;
pub const FENCE_EDGE_SOUTH: u8 = 2;
pub const FENCE_EDGE_WEST: u8 = 3;

// --- Fence Table ---

#[spacetimedb::table(
    accessor = fence,
    public,
    index(accessor = idx_chunk, name = "idx_fence_chunk", btree(columns = [chunk_index])),
    index(accessor = idx_cell_coords, name = "idx_fence_cell_coords", btree(columns = [cell_x, cell_y]))
)]
#[derive(Clone, Debug)]
pub struct Fence {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub owner_id: Identity,
    pub cell_x: i32,        // Foundation cell X coordinate (96px grid) - same as walls
    pub cell_y: i32,        // Foundation cell Y coordinate (96px grid) - same as walls
    pub edge: u8,           // 0 = North, 1 = East, 2 = South, 3 = West (same as walls)
    pub pos_x: f32,         // World position X (edge center)
    pub pos_y: f32,         // World position Y (edge center)
    pub tier: u8,           // BuildingTier enum (1-3: Wood, Stone, Metal) - fences start at Wood
    pub health: f32,
    pub max_health: f32,
    pub placed_at: Timestamp,
    pub chunk_index: u32,
    pub is_destroyed: bool,
    pub destroyed_at: Option<Timestamp>,
    pub last_hit_time: Option<Timestamp>,
    pub last_damaged_by: Option<Identity>,
    /// Monument fences (e.g. compound perimeter) are indestructible and non-upgradeable
    pub is_monument: bool,
}

// --- Helper Functions ---

/// Get fence max health based on tier
pub fn get_fence_max_health(tier: BuildingTier) -> f32 {
    match tier {
        BuildingTier::Twig => FENCE_WOOD_MAX_HEALTH,  // Fences don't have twig tier, default to wood
        BuildingTier::Wood => FENCE_WOOD_MAX_HEALTH,
        BuildingTier::Stone => FENCE_STONE_MAX_HEALTH,
        BuildingTier::Metal => FENCE_METAL_MAX_HEALTH,
    }
}

/// Get fence damage multiplier based on tier (same as walls)
pub fn get_fence_damage_multiplier(tier: u8) -> f32 {
    match tier {
        0 | 1 => MELEE_DAMAGE_MULT_WOOD,   // Twig/Wood: 25% melee damage
        2 => MELEE_DAMAGE_MULT_STONE,      // Stone: 15% melee damage
        3 => MELEE_DAMAGE_MULT_METAL,      // Metal: 5% melee damage
        _ => MELEE_DAMAGE_MULT_WOOD,       // Default to wood
    }
}

/// Calculate world position for a fence at a cell edge (exactly like walls)
/// Returns (pos_x, pos_y) for the center of the edge
fn calculate_fence_world_position(cell_x: i32, cell_y: i32, edge: u8) -> (f32, f32) {
    let cell_left = cell_x as f32 * FOUNDATION_TILE_SIZE_PX as f32;
    let cell_right = cell_left + FOUNDATION_TILE_SIZE_PX as f32;
    let cell_top = cell_y as f32 * FOUNDATION_TILE_SIZE_PX as f32;
    let cell_bottom = cell_top + FOUNDATION_TILE_SIZE_PX as f32;
    let cell_center_x = cell_left + FOUNDATION_TILE_SIZE_PX as f32 / 2.0;
    let cell_center_y = cell_top + FOUNDATION_TILE_SIZE_PX as f32 / 2.0;
    
    match edge {
        FENCE_EDGE_NORTH => (cell_center_x, cell_top),    // North edge: center X, top Y
        FENCE_EDGE_EAST => (cell_right, cell_center_y),   // East edge: right X, center Y
        FENCE_EDGE_SOUTH => (cell_center_x, cell_bottom), // South edge: center X, bottom Y
        FENCE_EDGE_WEST => (cell_left, cell_center_y),    // West edge: left X, center Y
        _ => (cell_center_x, cell_center_y),              // Fallback to center
    }
}

/// Check if a fence position is valid
/// edge: 0 = North, 1 = East, 2 = South, 3 = West (same as walls)
pub fn is_fence_position_valid(
    ctx: &ReducerContext,
    cell_x: i32,
    cell_y: i32,
    edge: u8,
) -> Result<(), String> {
    // 1. Check if there's already a fence at this exact edge
    let fences = ctx.db.fence();
    for fence in fences.idx_cell_coords().filter((cell_x, cell_y)) {
        if !fence.is_destroyed && fence.edge == edge {
            return Err("A fence already exists at this edge.".to_string());
        }
    }
    
    // 2. Check adjacent cells for shared edges (same as walls)
    // North edge of (x, y) = South edge of (x, y-1)
    // East edge of (x, y) = West edge of (x+1, y)
    // South edge of (x, y) = North edge of (x, y+1)
    // West edge of (x, y) = East edge of (x-1, y)
    let (adjacent_cell_x, adjacent_cell_y, opposite_edge) = match edge {
        FENCE_EDGE_NORTH => (cell_x, cell_y - 1, FENCE_EDGE_SOUTH),
        FENCE_EDGE_EAST => (cell_x + 1, cell_y, FENCE_EDGE_WEST),
        FENCE_EDGE_SOUTH => (cell_x, cell_y + 1, FENCE_EDGE_NORTH),
        FENCE_EDGE_WEST => (cell_x - 1, cell_y, FENCE_EDGE_EAST),
        _ => return Err("Invalid fence edge.".to_string()),
    };
    
    for fence in fences.idx_cell_coords().filter((adjacent_cell_x, adjacent_cell_y)) {
        if !fence.is_destroyed && fence.edge == opposite_edge {
            return Err("A fence already exists on the shared edge with the adjacent cell.".to_string());
        }
    }
    
    // 3. Check for wall collision - cannot place fence where a wall exists
    let walls = ctx.db.wall_cell();
    for wall in walls.idx_cell_coords().filter((cell_x, cell_y)) {
        if !wall.is_destroyed && wall.edge == edge {
            return Err("Cannot place fence where a wall exists.".to_string());
        }
    }
    // Also check adjacent cell's opposite edge
    for wall in walls.idx_cell_coords().filter((adjacent_cell_x, adjacent_cell_y)) {
        if !wall.is_destroyed && wall.edge == opposite_edge {
            return Err("Cannot place fence where a wall exists.".to_string());
        }
    }
    
    // 4. Check if position is on water (use edge center for terrain check)
    let (world_x, world_y) = calculate_fence_world_position(cell_x, cell_y, edge);
    
    if is_position_on_water(ctx, world_x, world_y) {
        return Err("Cannot place fence on water tiles.".to_string());
    }
    
    // 5. Check if position is on asphalt (compounds)
    if crate::environment::is_position_on_asphalt_tile(ctx, world_x, world_y) {
        return Err("Cannot place fence on asphalt/compound areas.".to_string());
    }
    
    // 6. Check if position is within monument zones
    check_monument_zone_placement(ctx, world_x, world_y)?;
    
    Ok(())
}

// --- Reducers ---

/// Place a fence on a foundation cell edge (same grid system as walls)
#[spacetimedb::reducer]
pub fn place_fence(
    ctx: &ReducerContext,
    cell_x: i64,
    cell_y: i64,
    edge: u8,
) -> Result<(), String> {
    let sender_id = ctx.sender();
    let players = ctx.db.player();
    
    log::info!(
        "[PlaceFence] Player {:?} attempting to place fence at cell ({}, {}), edge={}",
        sender_id, cell_x, cell_y, edge
    );
    
    // 1. Validate player
    let player = players.identity().find(&sender_id)
        .ok_or_else(|| "Player not found".to_string())?;
    
    if player.is_dead {
        return Err("Cannot place fence while dead.".to_string());
    }
    
    if player.is_knocked_out {
        return Err("Cannot place fence while knocked out.".to_string());
    }
    
    // 2. Validate Blueprint equipped
    if !player_has_blueprint(ctx, sender_id) {
        return Err("Blueprint must be equipped to place fences.".to_string());
    }
    
    // 3. Validate edge
    if edge > 3 {
        return Err(format!("Invalid edge: {}. Must be 0-3 (N, E, S, W).", edge));
    }
    
    // 4. Convert cell coordinates
    let cell_x_i32 = cell_x as i32;
    let cell_y_i32 = cell_y as i32;
    
    // 5. Validate fence position
    is_fence_position_valid(ctx, cell_x_i32, cell_y_i32, edge)?;
    
    // 6. Calculate world position at cell edge (exactly like walls)
    let (world_x, world_y) = calculate_fence_world_position(cell_x_i32, cell_y_i32, edge);
    
    // 7. Check that player is NOT standing on the fence position
    let half_edge = FOUNDATION_TILE_SIZE_PX as f32 / 2.0;
    let half_thickness = FENCE_COLLISION_THICKNESS / 2.0;
    let player_radius = crate::PLAYER_RADIUS;
    
    // Calculate fence collision bounds (same logic as walls)
    let (fence_min_x, fence_max_x, fence_min_y, fence_max_y) = match edge {
        FENCE_EDGE_NORTH | FENCE_EDGE_SOUTH => {
            // Horizontal fence: spans full cell width, thin in Y
            (
                world_x - half_edge - player_radius,
                world_x + half_edge + player_radius,
                world_y - half_thickness - player_radius,
                world_y + half_thickness + player_radius,
            )
        }
        _ => {
            // Vertical fence (EAST/WEST): thin in X, spans full cell height
            (
                world_x - half_thickness - player_radius,
                world_x + half_thickness + player_radius,
                world_y - half_edge - player_radius,
                world_y + half_edge + player_radius,
            )
        }
    };
    
    if player.position_x >= fence_min_x && player.position_x <= fence_max_x &&
       player.position_y >= fence_min_y && player.position_y <= fence_max_y {
        return Err("Cannot place fence where you are standing.".to_string());
    }
    
    // 8. Check placement distance from player
    let dx = world_x - player.position_x;
    let dy = world_y - player.position_y;
    let dist_sq = dx * dx + dy * dy;
    
    if dist_sq > BUILDING_PLACEMENT_MAX_DISTANCE_SQUARED {
        return Err(format!(
            "Fence placement too far from player. Distance: {:.1}px, Max: {:.1}px",
            dist_sq.sqrt(),
            BUILDING_PLACEMENT_MAX_DISTANCE
        ));
    }
    
    // 9. Calculate chunk index
    let chunk_index = calculate_chunk_index(world_x, world_y);
    
    // 10. Check and consume resources
    let required_wood = FENCE_WOOD_COST;
    
    let inventory = ctx.db.inventory_item();
    let item_defs = ctx.db.item_definition();
    
    // Find "Wood" item definition
    let wood_item_def = item_defs.iter()
        .find(|def| def.name == "Wood")
        .ok_or_else(|| "Wood item definition not found".to_string())?;
    
    // Find wood items in player's inventory OR hotbar
    let mut wood_items: Vec<_> = inventory.iter()
        .filter(|item| {
            let is_owned = match &item.location {
                ItemLocation::Inventory(data) => data.owner_id == sender_id,
                ItemLocation::Hotbar(data) => data.owner_id == sender_id,
                _ => false,
            };
            is_owned &&
            item.item_def_id == wood_item_def.id &&
            item.quantity > 0
        })
        .collect();
    
    // Calculate total wood available
    let total_wood: u32 = wood_items.iter().map(|item| item.quantity).sum();
    
    if total_wood < required_wood {
        // Emit error sound for instant feedback
        crate::sound_events::emit_error_resources_sound(ctx, player.position_x, player.position_y, sender_id);
        return Err(format!(
            "Not enough wood. Required: {}, Available: {}",
            required_wood, total_wood
        ));
    }
    
    // Consume wood
    let mut remaining_to_consume = required_wood;
    for wood_item in &wood_items {
        if remaining_to_consume == 0 {
            break;
        }
        
        let consume_from_this = remaining_to_consume.min(wood_item.quantity);
        let new_quantity = wood_item.quantity - consume_from_this;
        remaining_to_consume -= consume_from_this;
        
        if new_quantity == 0 {
            ctx.db.inventory_item().instance_id().delete(wood_item.instance_id);
        } else {
            let mut updated_item = wood_item.clone();
            updated_item.quantity = new_quantity;
            ctx.db.inventory_item().instance_id().update(updated_item);
        }
    }
    
    log::info!("[PlaceFence] Consumed {} wood from player {:?}", required_wood, sender_id);
    
    // 11. Create and insert fence (fences start at Wood tier = 1)
    let fences = ctx.db.fence();
    let initial_tier = 1u8; // Wood tier
    let new_fence = Fence {
        id: 0, // Auto-incremented
        owner_id: sender_id,
        cell_x: cell_x_i32,
        cell_y: cell_y_i32,
        edge,
        pos_x: world_x,
        pos_y: world_y,
        tier: initial_tier,
        health: FENCE_WOOD_MAX_HEALTH,
        max_health: FENCE_WOOD_MAX_HEALTH,
        placed_at: ctx.timestamp,
        chunk_index,
        is_destroyed: false,
        destroyed_at: None,
        last_hit_time: None,
        last_damaged_by: None,
        is_monument: false,
    };
    
    fences.try_insert(new_fence)
        .map_err(|e| format!("Failed to insert fence: {}", e))?;
    
    // 12. Emit construction sound
    crate::sound_events::emit_foundation_wood_constructed_sound(ctx, world_x, world_y, sender_id);
    
    log::info!(
        "[PlaceFence] Successfully placed fence at cell ({}, {}), edge={}, health={:.1}",
        cell_x, cell_y, edge, FENCE_MAX_HEALTH
    );
    
    Ok(())
}

/// Applies weapon damage to a fence (called from combat system or projectile collision)
/// Fences use wood tier damage reduction (25% melee damage)
pub fn damage_fence(
    ctx: &ReducerContext,
    attacker_id: Identity,
    fence_id: u64,
    damage: f32,
    timestamp: Timestamp,
) -> Result<(), String> {
    let fences = ctx.db.fence();
    
    // Find the fence
    let mut fence = fences.id().find(&fence_id)
        .ok_or_else(|| format!("Fence with ID {} not found.", fence_id))?;
    
    if fence.is_destroyed {
        return Err("Fence is already destroyed.".to_string());
    }
    
    // Monument fences are indestructible
    if fence.is_monument {
        return Err("Cannot damage monument fences.".to_string());
    }
    
    // <<< PVP RAIDING CHECK >>>
    if let Some(attacker_player) = ctx.db.player().identity().find(&attacker_id) {
        let attacker_pvp = crate::combat::is_pvp_active_for_player(&attacker_player, timestamp);
        
        // Check if owner has PvP enabled (if owner is not the attacker)
        if fence.owner_id != attacker_id {
            if let Some(owner_player) = ctx.db.player().identity().find(&fence.owner_id) {
                let owner_pvp = crate::combat::is_pvp_active_for_player(&owner_player, timestamp);
                
                if !attacker_pvp || !owner_pvp {
                    log::debug!("Structure raiding blocked - Attacker PvP: {}, Owner PvP: {}", 
                        attacker_pvp, owner_pvp);
                    return Err("Cannot damage structure - PvP raiding requires both players to have PvP enabled.".to_string());
                }
            }
        }
    }
    // <<< END PVP RAIDING CHECK >>>
    
    // Apply tier-based damage reduction
    let damage_mult = get_fence_damage_multiplier(fence.tier);
    let effective_damage = damage * damage_mult;
    
    let old_health = fence.health;
    fence.health = (fence.health - effective_damage).max(0.0);
    fence.last_hit_time = Some(timestamp);
    fence.last_damaged_by = Some(attacker_id);
    
    log::info!(
        "Player {:?} hit Fence {} (tier {}) for {:.1} damage (base: {:.1}, mult: {:.0}%). Health: {:.1} -> {:.1}",
        attacker_id, fence_id, fence.tier, effective_damage, damage, damage_mult * 100.0, old_health, fence.health
    );
    
    if fence.health <= 0.0 {
        // Fence destroyed
        fence.health = 0.0;
        fence.is_destroyed = true;
        fence.destroyed_at = Some(timestamp);
        
        log::info!("[FenceDamage] Fence {} destroyed by player {:?}", fence_id, attacker_id);
        
        // Emit destruction sound
        crate::sound_events::emit_foundation_twig_destroyed_sound(ctx, fence.pos_x, fence.pos_y, attacker_id);
    } else {
        // Fence damaged but not destroyed
        log::info!("[FenceDamage] Fence {} damaged, health: {:.1}", fence_id, fence.health);
        
        // Emit hit sound
        crate::sound_events::emit_melee_hit_sharp_sound(ctx, fence.pos_x, fence.pos_y, attacker_id);
    }
    
    // Update the fence
    fences.id().update(fence);
    
    Ok(())
}

/// Applies explosive damage to a fence (bypasses melee damage reduction)
/// Used by explosion system - explosives are effective against fences
pub fn damage_fence_explosive(
    ctx: &ReducerContext,
    attacker_id: Identity,
    fence_id: u64,
    damage: f32,
) {
    let fences = ctx.db.fence();
    
    if let Some(mut fence) = fences.id().find(&fence_id) {
        if fence.is_destroyed {
            return;
        }
        
        // Monument fences are indestructible
        if fence.is_monument {
            return;
        }
        
        // <<< PVP RAIDING CHECK >>>
        if let Some(attacker_player) = ctx.db.player().identity().find(&attacker_id) {
            let attacker_pvp = crate::combat::is_pvp_active_for_player(&attacker_player, ctx.timestamp);
            
            if fence.owner_id != attacker_id {
                if let Some(owner_player) = ctx.db.player().identity().find(&fence.owner_id) {
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
        
        // Explosive damage bypasses melee reduction - full damage
        let old_health = fence.health;
        fence.health = (fence.health - damage).max(0.0);
        fence.last_hit_time = Some(ctx.timestamp);
        fence.last_damaged_by = Some(attacker_id);
        
        if fence.health <= 0.0 {
            fence.is_destroyed = true;
            fence.destroyed_at = Some(ctx.timestamp);
            crate::sound_events::emit_foundation_twig_destroyed_sound(ctx, fence.pos_x, fence.pos_y, ctx.sender());
            log::info!("[FenceExplosiveDamage] Fence {} destroyed by explosion", fence_id);
        } else {
            crate::sound_events::emit_melee_hit_sharp_sound(ctx, fence.pos_x, fence.pos_y, ctx.sender());
            log::info!("[FenceExplosiveDamage] Fence {} took {:.1} explosive damage, health: {:.1}", fence_id, damage, fence.health);
        }
        
        fences.id().update(fence);
    }
}

// --- Collision Detection Functions ---

/// Helper function: Checks if a line segment intersects with an AABB
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
    
    // Check intersection with each edge of the AABB
    let mut tmin: f32 = 0.0;
    let mut tmax: f32 = 1.0;
    
    // Check X-axis
    if dx.abs() > 0.001 {
        let tx1 = (left - x1) / dx;
        let tx2 = (right - x1) / dx;
        let tmin_x = tx1.min(tx2);
        let tmax_x = tx1.max(tx2);
        tmin = tmin.max(tmin_x);
        tmax = tmax.min(tmax_x);
    } else {
        // Line is vertical, check if it's within X bounds
        if x1 < left || x1 > right {
            return false;
        }
    }
    
    // Check Y-axis
    if dy.abs() > 0.001 {
        let ty1 = (top - y1) / dy;
        let ty2 = (bottom - y1) / dy;
        let tmin_y = ty1.min(ty2);
        let tmax_y = ty1.max(ty2);
        tmin = tmin.max(tmin_y);
        tmax = tmax.min(tmax_y);
    } else {
        // Line is horizontal, check if it's within Y bounds
        if y1 < top || y1 > bottom {
            return false;
        }
    }
    
    tmin <= tmax
}

/// Checks if a line segment intersects with a fence
/// Returns Some((fence_id, collision_x, collision_y)) if collision occurs
pub fn check_projectile_fence_collision(
    ctx: &ReducerContext,
    start_x: f32,
    start_y: f32,
    end_x: f32,
    end_y: f32,
) -> Option<(u64, f32, f32)> {
    check_projectile_fence_collision_3d(ctx, start_x, start_y, end_x, end_y, 0.0, 0.0)
}

pub fn check_projectile_fence_collision_3d(
    ctx: &ReducerContext, start_x: f32, start_y: f32, end_x: f32, end_y: f32, start_height: f32, end_height: f32,
) -> Option<(u64, f32, f32)> {
    let fences = ctx.db.fence();
    let mut closest: Option<(u64, f32)> = None;
    
    // Calculate which cells to check (within 2 cells of line segment)
    let min_x = start_x.min(end_x);
    let max_x = start_x.max(end_x);
    let min_y = start_y.min(end_y);
    let max_y = start_y.max(end_y);
    
    // Fences use 96px foundation cell grid (same as walls)
    let start_cell_x = ((min_x - 96.0) / FOUNDATION_TILE_SIZE_PX as f32).floor() as i32;
    let end_cell_x = ((max_x + 96.0) / FOUNDATION_TILE_SIZE_PX as f32).ceil() as i32;
    let start_cell_y = ((min_y - 96.0) / FOUNDATION_TILE_SIZE_PX as f32).floor() as i32;
    let end_cell_y = ((max_y + 96.0) / FOUNDATION_TILE_SIZE_PX as f32).ceil() as i32;
    
    for cell_x in start_cell_x..=end_cell_x {
        for cell_y in start_cell_y..=end_cell_y {
            // Find fences at this cell
            for fence in fences.idx_cell_coords().filter((cell_x, cell_y)) {
                if fence.is_destroyed {
                    continue;
                }
                
                // Calculate fence collision bounds (same as walls)
                let half_edge = FOUNDATION_TILE_SIZE_PX as f32 / 2.0;
                let half_thickness = FENCE_COLLISION_THICKNESS / 2.0;
                
                let (fence_min_x, fence_max_x, fence_min_y, fence_max_y) = match fence.edge {
                    FENCE_EDGE_NORTH | FENCE_EDGE_SOUTH => {
                        // Horizontal fence: spans full cell width, thin in Y
                        (
                            fence.pos_x - half_edge,
                            fence.pos_x + half_edge,
                            fence.pos_y - half_thickness,
                            fence.pos_y + half_thickness,
                        )
                    }
                    _ => {
                        // Vertical fence (EAST/WEST): thin in X, spans full cell height
                        (
                            fence.pos_x - half_thickness,
                            fence.pos_x + half_thickness,
                            fence.pos_y - half_edge,
                            fence.pos_y + half_edge,
                        )
                    }
                };
                
                if let Some(t) = crate::projectile_geometry::box_impact(
                    crate::projectile_geometry::Point3 { x: start_x, y: start_y, height: start_height },
                    crate::projectile_geometry::Point3 { x: end_x, y: end_y, height: end_height },
                    crate::projectile_geometry::Point3 { x: fence_min_x, y: fence_min_y, height: 0.0 },
                    crate::projectile_geometry::Point3 { x: fence_max_x, y: fence_max_y, height: 50.0 },
                ) {
                    if closest.map_or(true, |(id, old_t)| t < old_t || (t == old_t && fence.id < id)) {
                        closest = Some((fence.id, t));
                    }
                }
            }
        }
    }
    
    closest.map(|(id, t)| (id, start_x + t * (end_x - start_x), start_y + t * (end_y - start_y)))
}

/// Checks if a line segment is blocked by fences (for melee attacks)
/// Returns Some(fence_id) if a fence is hit, None otherwise
pub fn check_line_hits_fence(
    ctx: &ReducerContext,
    start_x: f32,
    start_y: f32,
    end_x: f32,
    end_y: f32,
) -> Option<u64> {
    check_projectile_fence_collision(ctx, start_x, start_y, end_x, end_y)
        .map(|(fence_id, _, _)| fence_id)
}

/// Checks if a world position collides with a fence (for player/NPC movement)
/// Returns true if the position is within collision bounds of any fence
/// Fences are positioned on cell edges (same as walls)
pub fn check_fence_collision(
    ctx: &ReducerContext,
    world_x: f32,
    world_y: f32,
    radius: f32,
) -> bool {
    let fences = ctx.db.fence();
    
    // Convert world position to cell coordinates (96px foundation cell grid)
    let cell_x = (world_x / FOUNDATION_TILE_SIZE_PX as f32).floor() as i32;
    let cell_y = (world_y / FOUNDATION_TILE_SIZE_PX as f32).floor() as i32;
    
    // Check fences in nearby cells (±2 cells to catch edge-positioned fences)
    for offset_x in -2..=2 {
        for offset_y in -2..=2 {
            let check_cell_x = cell_x + offset_x;
            let check_cell_y = cell_y + offset_y;
            
            for fence in fences.idx_cell_coords().filter((check_cell_x, check_cell_y)) {
                if fence.is_destroyed {
                    continue;
                }
                
                // Fences are same size as walls: FOUNDATION_TILE_SIZE long, FENCE_COLLISION_THICKNESS thick
                let half_edge = FOUNDATION_TILE_SIZE_PX as f32 / 2.0;
                let half_thickness = FENCE_COLLISION_THICKNESS / 2.0;
                
                let (fence_min_x, fence_max_x, fence_min_y, fence_max_y) = match fence.edge {
                    FENCE_EDGE_NORTH | FENCE_EDGE_SOUTH => {
                        // Horizontal fence: spans cell width, thin in Y
                        (
                            fence.pos_x - half_edge - radius,
                            fence.pos_x + half_edge + radius,
                            fence.pos_y - half_thickness - radius,
                            fence.pos_y + half_thickness + radius,
                        )
                    }
                    _ => {
                        // Vertical fence (EAST/WEST): thin in X, spans cell height
                        (
                            fence.pos_x - half_thickness - radius,
                            fence.pos_x + half_thickness + radius,
                            fence.pos_y - half_edge - radius,
                            fence.pos_y + half_edge + radius,
                        )
                    }
                };
                
                // Check if position (with radius) intersects fence AABB
                if world_x >= fence_min_x && world_x <= fence_max_x &&
                   world_y >= fence_min_y && world_y <= fence_max_y {
                    return true;
                }
            }
        }
    }
    
    false
}

/// Destroy a fence (player must own it and be within range)
#[spacetimedb::reducer]
pub fn destroy_fence(ctx: &ReducerContext, fence_id: u64) -> Result<(), String> {
    use crate::sound_events;
    use crate::building::{player_has_repair_hammer, BUILDING_PLACEMENT_MAX_DISTANCE_SQUARED};
    
    let sender_id = ctx.sender();
    let fences = ctx.db.fence();
    let players = ctx.db.player();
    
    // 1. Validate player exists and is not knocked out
    let player = players.identity().find(&sender_id)
        .ok_or_else(|| "Player not found".to_string())?;
    
    if player.is_knocked_out {
        return Err("Cannot destroy fence while knocked out.".to_string());
    }
    
    // 2. Validate Repair Hammer equipped
    if !player_has_repair_hammer(ctx, sender_id) {
        return Err("Repair Hammer must be equipped to destroy fences.".to_string());
    }
    
    // 3. Find fence
    let fence = fences.id().find(&fence_id)
        .ok_or_else(|| "Fence not found".to_string())?;
    
    if fence.is_destroyed {
        return Err("Fence is already destroyed.".to_string());
    }
    
    // Monument fences cannot be destroyed
    if fence.is_monument {
        return Err("Cannot destroy monument fences.".to_string());
    }
    
    // 4. Check ownership - only the player who placed it can destroy it
    if fence.owner_id != sender_id {
        return Err("You can only destroy fences that you built.".to_string());
    }
    
    // 5. Check placement distance from player
    let dx = fence.pos_x - player.position_x;
    let dy = fence.pos_y - player.position_y;
    let dist_sq = dx * dx + dy * dy;
    
    if dist_sq > BUILDING_PLACEMENT_MAX_DISTANCE_SQUARED {
        return Err("Fence is too far away.".to_string());
    }
    
    // 6. Mark fence as destroyed
    let mut updated_fence = fence.clone();
    updated_fence.is_destroyed = true;
    updated_fence.destroyed_at = Some(ctx.timestamp);
    
    fences.id().update(updated_fence);
    
    // 7. Emit destroy sound
    sound_events::emit_foundation_twig_destroyed_sound(ctx, fence.pos_x, fence.pos_y, sender_id);
    
    log::info!(
        "[DestroyFence] Successfully destroyed fence {} at ({}, {})",
        fence_id, fence.cell_x, fence.cell_y
    );
    
    Ok(())
}

/// Upgrade a fence to a higher tier
#[spacetimedb::reducer]
pub fn upgrade_fence(
    ctx: &ReducerContext,
    fence_id: u64,
    new_tier: u8,
) -> Result<(), String> {
    let sender_id = ctx.sender();
    let players = ctx.db.player();
    let fences = ctx.db.fence();
    
    log::info!(
        "[UpgradeFence] Player {:?} attempting to upgrade fence {} to tier {}",
        sender_id, fence_id, new_tier
    );
    
    // 1. Validate player
    let player = players.identity().find(&sender_id)
        .ok_or_else(|| "Player not found".to_string())?;
    
    if player.is_dead {
        return Err("Cannot upgrade fence while dead.".to_string());
    }
    
    if player.is_knocked_out {
        return Err("Cannot upgrade fence while knocked out.".to_string());
    }
    
    // 2. Validate Repair Hammer equipped
    if !player_has_repair_hammer(ctx, sender_id) {
        return Err("Repair Hammer must be equipped to upgrade fences.".to_string());
    }
    
    // 2.5. Check building privilege (only if hearths exist)
    use crate::homestead_hearth::player_has_building_privilege;
    let hearths = ctx.db.homestead_hearth();
    let any_hearth_exists = hearths.iter().any(|h| !h.is_destroyed);
    
    if any_hearth_exists {
        if !player_has_building_privilege(ctx, sender_id) {
            return Err("Building privilege required. Hold E near a Homestead Hearth to gain building privilege.".to_string());
        }
    }
    
    // 3. Find fence
    let fence = fences.id().find(&fence_id)
        .ok_or_else(|| "Fence not found".to_string())?;
    
    if fence.is_destroyed {
        return Err("Cannot upgrade destroyed fence.".to_string());
    }
    
    // Monument fences cannot be upgraded
    if fence.is_monument {
        return Err("Cannot upgrade monument fences.".to_string());
    }
    
    // 4. Validate new tier (fences can only be Wood=1, Stone=2, Metal=3)
    if new_tier < 1 || new_tier > 3 {
        return Err(format!("Invalid fence tier: {}. Must be 1-3 (Wood, Stone, Metal).", new_tier));
    }
    
    let current_tier = match fence.tier {
        0 | 1 => BuildingTier::Wood,   // Treat 0 as Wood for legacy fences
        2 => BuildingTier::Stone,
        3 => BuildingTier::Metal,
        _ => return Err("Invalid current fence tier".to_string()),
    };
    
    let target_tier = match new_tier {
        1 => BuildingTier::Wood,
        2 => BuildingTier::Stone,
        3 => BuildingTier::Metal,
        _ => return Err("Invalid target tier".to_string()),
    };
    
    // 5. Ensure upgrade is to a higher tier
    if new_tier <= fence.tier {
        return Err(format!("Cannot downgrade fence. Current tier: {}, Target tier: {}", fence.tier, new_tier));
    }
    
    // 6. Check placement distance from player
    let dx = fence.pos_x - player.position_x;
    let dy = fence.pos_y - player.position_y;
    let dist_sq = dx * dx + dy * dy;
    
    if dist_sq > BUILDING_PLACEMENT_MAX_DISTANCE_SQUARED {
        return Err("Fence is too far away.".to_string());
    }
    
    // 7. Calculate resource costs (same as walls: 20 wood/stone/metal for fences)
    let inventory = ctx.db.inventory_item();
    let item_defs = ctx.db.item_definition();
    
    let required_wood = if target_tier == BuildingTier::Wood { 20 } else { 0 };
    let required_stone = if target_tier == BuildingTier::Stone { 20 } else { 0 };
    let required_metal = if target_tier == BuildingTier::Metal { 20 } else { 0 };
    
    // Check and consume wood
    if required_wood > 0 {
        let wood_item_def = item_defs.iter()
            .find(|def| def.name == "Wood")
            .ok_or_else(|| "Wood item definition not found".to_string())?;
        
        let mut wood_items: Vec<_> = inventory.iter()
            .filter(|item| {
                let is_owned = match &item.location {
                    ItemLocation::Inventory(data) => data.owner_id == sender_id,
                    ItemLocation::Hotbar(data) => data.owner_id == sender_id,
                    _ => false,
                };
                is_owned &&
                item.item_def_id == wood_item_def.id &&
                item.quantity > 0
            })
            .collect();
        
        let total_wood: u32 = wood_items.iter().map(|item| item.quantity).sum();
        
        if total_wood < required_wood {
            crate::sound_events::emit_error_resources_sound(ctx, player.position_x, player.position_y, sender_id);
            return Err(format!("Not enough wood. Required: {}, Available: {}", required_wood, total_wood));
        }
        
        // Consume wood
        let mut remaining = required_wood;
        for wood_item in &wood_items {
            if remaining == 0 { break; }
            let consume = remaining.min(wood_item.quantity);
            let new_qty = wood_item.quantity - consume;
            remaining -= consume;
            
            if new_qty == 0 {
                ctx.db.inventory_item().instance_id().delete(wood_item.instance_id);
            } else {
                let mut updated = wood_item.clone();
                updated.quantity = new_qty;
                ctx.db.inventory_item().instance_id().update(updated);
            }
        }
    }
    
    // Check and consume stone
    if required_stone > 0 {
        let stone_item_def = item_defs.iter()
            .find(|def| def.name == "Stone")
            .ok_or_else(|| "Stone item definition not found".to_string())?;
        
        let mut stone_items: Vec<_> = inventory.iter()
            .filter(|item| {
                let is_owned = match &item.location {
                    ItemLocation::Inventory(data) => data.owner_id == sender_id,
                    ItemLocation::Hotbar(data) => data.owner_id == sender_id,
                    _ => false,
                };
                is_owned &&
                item.item_def_id == stone_item_def.id &&
                item.quantity > 0
            })
            .collect();
        
        let total_stone: u32 = stone_items.iter().map(|item| item.quantity).sum();
        
        if total_stone < required_stone {
            crate::sound_events::emit_error_resources_sound(ctx, player.position_x, player.position_y, sender_id);
            return Err(format!("Not enough stone. Required: {}, Available: {}", required_stone, total_stone));
        }
        
        // Consume stone
        let mut remaining = required_stone;
        for stone_item in &stone_items {
            if remaining == 0 { break; }
            let consume = remaining.min(stone_item.quantity);
            let new_qty = stone_item.quantity - consume;
            remaining -= consume;
            
            if new_qty == 0 {
                ctx.db.inventory_item().instance_id().delete(stone_item.instance_id);
            } else {
                let mut updated = stone_item.clone();
                updated.quantity = new_qty;
                ctx.db.inventory_item().instance_id().update(updated);
            }
        }
    }
    
    // Check and consume metal fragments
    if required_metal > 0 {
        let metal_item_def = item_defs.iter()
            .find(|def| def.name == "Metal Fragments")
            .ok_or_else(|| "Metal Fragments item definition not found".to_string())?;
        
        let mut metal_items: Vec<_> = inventory.iter()
            .filter(|item| {
                let is_owned = match &item.location {
                    ItemLocation::Inventory(data) => data.owner_id == sender_id,
                    ItemLocation::Hotbar(data) => data.owner_id == sender_id,
                    _ => false,
                };
                is_owned &&
                item.item_def_id == metal_item_def.id &&
                item.quantity > 0
            })
            .collect();
        
        let total_metal: u32 = metal_items.iter().map(|item| item.quantity).sum();
        
        if total_metal < required_metal {
            crate::sound_events::emit_error_resources_sound(ctx, player.position_x, player.position_y, sender_id);
            return Err(format!("Not enough metal fragments. Required: {}, Available: {}", required_metal, total_metal));
        }
        
        // Consume metal
        let mut remaining = required_metal;
        for metal_item in &metal_items {
            if remaining == 0 { break; }
            let consume = remaining.min(metal_item.quantity);
            let new_qty = metal_item.quantity - consume;
            remaining -= consume;
            
            if new_qty == 0 {
                ctx.db.inventory_item().instance_id().delete(metal_item.instance_id);
            } else {
                let mut updated = metal_item.clone();
                updated.quantity = new_qty;
                ctx.db.inventory_item().instance_id().update(updated);
            }
        }
    }
    
    // 8. Calculate new health (increase max health proportionally)
    let new_max_health = get_fence_max_health(target_tier);
    let health_ratio = fence.health / fence.max_health;
    let new_health = (new_max_health * health_ratio).max(1.0);
    
    // 9. Update fence
    let mut updated_fence = fence.clone();
    updated_fence.tier = new_tier;
    updated_fence.health = new_health;
    updated_fence.max_health = new_max_health;
    
    fences.id().update(updated_fence);
    
    // 10. Emit upgrade sound based on tier
    match target_tier {
        BuildingTier::Wood => {
            crate::sound_events::emit_foundation_wood_upgraded_sound(ctx, fence.pos_x, fence.pos_y, sender_id);
        },
        BuildingTier::Stone => {
            crate::sound_events::emit_foundation_stone_upgraded_sound(ctx, fence.pos_x, fence.pos_y, sender_id);
        },
        BuildingTier::Metal => {
            crate::sound_events::emit_foundation_metal_upgraded_sound(ctx, fence.pos_x, fence.pos_y, sender_id);
        },
        _ => {},
    }
    
    log::info!(
        "[UpgradeFence] Successfully upgraded fence {} to tier {} (health: {:.1}/{:.1})",
        fence_id, new_tier, new_health, new_max_health
    );
    
    Ok(())
}

/// Spawn monument fences around the central compound perimeter.
/// Square fence just outside the auto turrets (±1056px from center), with 2-cell (192px) gaps
/// at each corner so players can walk in through the four corners.
/// Uses module identity as owner. Fences are indestructible (is_monument = true).
pub fn spawn_compound_perimeter_fences(
    ctx: &ReducerContext,
    center_x: f32,
    center_y: f32,
) -> Result<u32, String> {
    use crate::building::FOUNDATION_TILE_SIZE_PX;
    
    let monument_owner = ctx.identity();
    let current_time = ctx.timestamp;
    let fences = ctx.db.fence();
    
    let cell_center_x = (center_x / FOUNDATION_TILE_SIZE_PX as f32).floor() as i32;
    let cell_center_y = (center_y / FOUNDATION_TILE_SIZE_PX as f32).floor() as i32;
    
    // Perimeter at ±1056px (11 cells) from center - just outside turrets at ±850px
    const RADIUS_CELLS: i32 = 11;
    // Corner gaps: 5 cells (480px) at each corner for generous player entry around turrets
    const GAP_CELLS: i32 = 5;
    let cx_min = cell_center_x - RADIUS_CELLS + GAP_CELLS;
    let cx_max = cell_center_x + RADIUS_CELLS - GAP_CELLS;
    let cy_min = cell_center_y - RADIUS_CELLS + GAP_CELLS;
    let cy_max = cell_center_y + RADIUS_CELLS - GAP_CELLS;
    
    let mut spawned_count = 0u32;
    
    // Helper: skip if fence already exists at this position (e.g. from previous publish)
    let fence_exists = |cell_x: i32, cell_y: i32, edge: u8| -> bool {
        fences.idx_cell_coords().filter((cell_x, cell_y))
            .any(|f| !f.is_destroyed && f.edge == edge)
    };
    
    // North edge: fence on NORTH edge of cells
    let north_cell_y = cell_center_y - RADIUS_CELLS;
    for cell_x in cx_min..=cx_max {
        if fence_exists(cell_x, north_cell_y, FENCE_EDGE_NORTH) {
            continue;
        }
        let (world_x, world_y) = calculate_fence_world_position(cell_x, north_cell_y, FENCE_EDGE_NORTH);
        let chunk_index = calculate_chunk_index(world_x, world_y);
        
        let new_fence = Fence {
            id: 0,
            owner_id: monument_owner,
            cell_x,
            cell_y: north_cell_y,
            edge: FENCE_EDGE_NORTH,
            pos_x: world_x,
            pos_y: world_y,
            tier: 3, // Metal
            health: FENCE_METAL_MAX_HEALTH,
            max_health: FENCE_METAL_MAX_HEALTH,
            placed_at: current_time,
            chunk_index,
            is_destroyed: false,
            destroyed_at: None,
            last_hit_time: None,
            last_damaged_by: None,
            is_monument: true,
        };
        
        if fences.try_insert(new_fence).is_ok() {
            spawned_count += 1;
        }
    }
    
    // South edge
    let south_cell_y = cell_center_y + RADIUS_CELLS - 1;
    for cell_x in cx_min..=cx_max {
        if fence_exists(cell_x, south_cell_y, FENCE_EDGE_SOUTH) {
            continue;
        }
        let (world_x, world_y) = calculate_fence_world_position(cell_x, south_cell_y, FENCE_EDGE_SOUTH);
        let chunk_index = calculate_chunk_index(world_x, world_y);
        
        let new_fence = Fence {
            id: 0,
            owner_id: monument_owner,
            cell_x,
            cell_y: south_cell_y,
            edge: FENCE_EDGE_SOUTH,
            pos_x: world_x,
            pos_y: world_y,
            tier: 3, // Metal
            health: FENCE_METAL_MAX_HEALTH,
            max_health: FENCE_METAL_MAX_HEALTH,
            placed_at: current_time,
            chunk_index,
            is_destroyed: false,
            destroyed_at: None,
            last_hit_time: None,
            last_damaged_by: None,
            is_monument: true,
        };
        
        if fences.try_insert(new_fence).is_ok() {
            spawned_count += 1;
        }
    }
    
    // West edge
    let west_cell_x = cell_center_x - RADIUS_CELLS;
    for cell_y in cy_min..=cy_max {
        if fence_exists(west_cell_x, cell_y, FENCE_EDGE_WEST) {
            continue;
        }
        let (world_x, world_y) = calculate_fence_world_position(west_cell_x, cell_y, FENCE_EDGE_WEST);
        let chunk_index = calculate_chunk_index(world_x, world_y);
        
        let new_fence = Fence {
            id: 0,
            owner_id: monument_owner,
            cell_x: west_cell_x,
            cell_y,
            edge: FENCE_EDGE_WEST,
            pos_x: world_x,
            pos_y: world_y,
            tier: 3, // Metal
            health: FENCE_METAL_MAX_HEALTH,
            max_health: FENCE_METAL_MAX_HEALTH,
            placed_at: current_time,
            chunk_index,
            is_destroyed: false,
            destroyed_at: None,
            last_hit_time: None,
            last_damaged_by: None,
            is_monument: true,
        };
        
        if fences.try_insert(new_fence).is_ok() {
            spawned_count += 1;
        }
    }
    
    // East edge
    let east_cell_x = cell_center_x + RADIUS_CELLS - 1;
    for cell_y in cy_min..=cy_max {
        if fence_exists(east_cell_x, cell_y, FENCE_EDGE_EAST) {
            continue;
        }
        let (world_x, world_y) = calculate_fence_world_position(east_cell_x, cell_y, FENCE_EDGE_EAST);
        let chunk_index = calculate_chunk_index(world_x, world_y);
        
        let new_fence = Fence {
            id: 0,
            owner_id: monument_owner,
            cell_x: east_cell_x,
            cell_y,
            edge: FENCE_EDGE_EAST,
            pos_x: world_x,
            pos_y: world_y,
            tier: 3, // Metal
            health: FENCE_METAL_MAX_HEALTH,
            max_health: FENCE_METAL_MAX_HEALTH,
            placed_at: current_time,
            chunk_index,
            is_destroyed: false,
            destroyed_at: None,
            last_hit_time: None,
            last_damaged_by: None,
            is_monument: true,
        };
        
        if fences.try_insert(new_fence).is_ok() {
            spawned_count += 1;
        }
    }
    
    log::info!(
        "[CompoundPerimeterFences] Spawned {} monument fences around compound at ({:.1}, {:.1})",
        spawned_count, center_x, center_y
    );
    
    Ok(spawned_count)
}
