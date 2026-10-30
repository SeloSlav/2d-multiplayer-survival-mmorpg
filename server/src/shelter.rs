/******************************************************************************
 *                                                                            *
 * Defines the Shelter entity, its data structure, and associated logic.      *
 * Handles placement of shelters in the game world.                           *
 *                                                                            *
 ******************************************************************************/

use spacetimedb::{Identity, Timestamp, ReducerContext, Table, log};
use rand::Rng;

// Import table traits and concrete types
use crate::Player; // Corrected import for Player struct
use crate::player as PlayerTableTrait; // Corrected import for Player table trait
use crate::items::{
    inventory_item as InventoryItemTableTrait,
    item_definition as ItemDefinitionTableTrait,
    InventoryItem, ItemDefinition,
};
use crate::active_equipment::active_equipment as ActiveEquipmentTableTrait;
use crate::environment::calculate_chunk_index;
use crate::combat::AttackResult; // Import combat types
use crate::models::TargetType; // Import TargetType directly from models

// Import resource modules for cleanup
use crate::tree::tree as TreeTableTrait;
use crate::stone::stone as StoneTableTrait;
use crate::harvestable_resource::harvestable_resource as HarvestableResourceTableTrait;
use crate::grass::grass as GrassTableTrait;
use crate::grass::grass_state as GrassStateTableTrait;

// --- Constants ---
// Visual/Collision constants (can be tuned)
pub(crate) const SHELTER_VISUAL_WIDTH: f32 = 128.0; // For reference, actual collision might be different
pub(crate) const SHELTER_VISUAL_HEIGHT: f32 = 128.0; // For reference

// --- Terrain Variant Constants ---
// These map to different shelter visual appearances based on biome
pub const SHELTER_TERRAIN_DEFAULT: u8 = 0;  // Grass, Dirt, Forest, etc. - uses shelter.png
pub const SHELTER_TERRAIN_BEACH: u8 = 1;    // Beach tiles - uses shelter_beach.png
pub const SHELTER_TERRAIN_TUNDRA: u8 = 2;   // Tundra, TundraGrass - uses shelter_tundra.png
pub const SHELTER_TERRAIN_ALPINE: u8 = 3;   // Alpine terrain - uses shelter_alpine.png

// Placement constants
pub(crate) const SHELTER_PLACEMENT_MAX_DISTANCE: f32 = 256.0; // Increased from 128.0
pub(crate) const SHELTER_PLACEMENT_MAX_DISTANCE_SQUARED: f32 = SHELTER_PLACEMENT_MAX_DISTANCE * SHELTER_PLACEMENT_MAX_DISTANCE;

// Interaction constants (if any, for now focusing on placement)
pub(crate) const PLAYER_SHELTER_INTERACTION_DISTANCE: f32 = 128.0; 
pub(crate) const PLAYER_SHELTER_INTERACTION_DISTANCE_SQUARED: f32 = 
    PLAYER_SHELTER_INTERACTION_DISTANCE * PLAYER_SHELTER_INTERACTION_DISTANCE;

// Health
// Shelter is a STARTER base - cheap but weak. Designed to be raided in ~1.5-2 minutes.
// Intentionally WEAKER than a Wood Wall (500 HP) to encourage building system adoption.
// Game theory: Shelter = quick deploy, Building = better long-term investment
pub(crate) const SHELTER_INITIAL_MAX_HEALTH: f32 = 1000.0; // ~100 hits with Combat Ladle = ~1.5-2 min raid time

// --- Health constants for consistency ---
pub const SHELTER_INITIAL_HEALTH: f32 = SHELTER_INITIAL_MAX_HEALTH;
pub const SHELTER_MAX_HEALTH: f32 = SHELTER_INITIAL_MAX_HEALTH;

// --- NEW: Shelter Collision Constants (AABB based) ---
/// Width of the shelter's collision AABB.
pub(crate) const SHELTER_COLLISION_WIDTH: f32 = crate::shared_config::SHELTER_COLLISION_WIDTH;
/// Height of the shelter's collision AABB.
///
/// NOTE: This height is tuned to match the *interior* collision rectangle shown
/// by the client-side debug box (see `shelterRenderingUtils.ts`). It defines
/// the walkable / non‑walkable area for non‑owners, not the full visual canopy.
pub(crate) const SHELTER_COLLISION_HEIGHT: f32 = crate::shared_config::SHELTER_COLLISION_HEIGHT;
/// Half-width of the shelter's collision AABB.
pub(crate) const SHELTER_AABB_HALF_WIDTH: f32 = SHELTER_COLLISION_WIDTH / 2.0;
/// Half-height of the shelter's collision AABB.
pub(crate) const SHELTER_AABB_HALF_HEIGHT: f32 = SHELTER_COLLISION_HEIGHT / 2.0;
/// Vertical offset from shelter.pos_y (base) to the center of the AABB.
/// AABB_center_y = shelter.pos_y - SHELTER_AABB_CENTER_Y_OFFSET_FROM_POS_Y.
pub(crate) const SHELTER_AABB_CENTER_Y_OFFSET_FROM_POS_Y: f32 = -crate::shared_config::SHELTER_CENTER_OFFSET_Y;

/// Buffer zone around shelter for resource clearing (in pixels)
/// This extends the clearing area beyond the shelter's collision boundaries
/// Reduced from 300px to 75px to be less aggressive - only clears resources immediately adjacent to shelter
pub(crate) const SHELTER_RESOURCE_CLEARING_BUFFER: f32 = 75.0;

/// Determines the terrain variant for a shelter based on the tile type at its position.
/// This is an O(1) lookup using the pre-computed tile type.
/// 
/// Returns:
/// - SHELTER_TERRAIN_BEACH (1) for Beach tiles
/// - SHELTER_TERRAIN_TUNDRA (2) for Tundra or TundraGrass tiles
/// - SHELTER_TERRAIN_ALPINE (3) for Alpine tiles
/// - SHELTER_TERRAIN_DEFAULT (0) for all other tiles (Grass, Dirt, Forest, etc.)
#[inline]
pub fn get_terrain_variant_for_tile_type(tile_type: &crate::TileType) -> u8 {
    use crate::TileType;
    match tile_type {
        TileType::Beach => SHELTER_TERRAIN_BEACH,
        TileType::Tundra | TileType::TundraGrass => SHELTER_TERRAIN_TUNDRA,
        TileType::Alpine => SHELTER_TERRAIN_ALPINE,
        // All other tiles (Grass, Dirt, DirtRoad, Forest, Sand, Quarry, Asphalt, Sea, HotSpringWater)
        _ => SHELTER_TERRAIN_DEFAULT,
    }
}

/// Gets the terrain variant for a world position by looking up the tile type.
/// Uses efficient chunk-based tile lookup.
pub fn get_terrain_variant_at_position(ctx: &ReducerContext, world_x: f32, world_y: f32) -> u8 {
    let tile_x = (world_x / crate::TILE_SIZE_PX as f32).floor() as i32;
    let tile_y = (world_y / crate::TILE_SIZE_PX as f32).floor() as i32;
    
    if let Some(tile_type) = crate::get_tile_type_at_position(ctx, tile_x, tile_y) {
        get_terrain_variant_for_tile_type(&tile_type)
    } else {
        SHELTER_TERRAIN_DEFAULT // Default fallback if tile type lookup fails
    }
}

/// --- Shelter Data Structure ---
/// Represents a player-built shelter in the game world.
#[spacetimedb::table(accessor = shelter, public)]
#[derive(Clone, Debug)]
pub struct Shelter {
    #[primary_key]
    #[auto_inc]
    pub id: u32,
    pub pos_x: f32,
    pub pos_y: f32,
    pub chunk_index: u32,
    pub placed_by: Identity,
    pub placed_at: Timestamp,
    pub health: f32,
    pub max_health: f32,
    pub is_destroyed: bool,
    pub destroyed_at: Option<Timestamp>,
    pub last_hit_time: Option<Timestamp>,
    pub last_damaged_by: Option<Identity>,
    /// Terrain variant determines the visual style of the shelter (0=default, 1=beach, 2=tundra, 3=alpine)
    /// Set at placement time based on the tile type at the shelter's position
    pub terrain_variant: u8,
}

// --- Reducer to Place a Shelter ---
#[spacetimedb::reducer]
pub fn place_shelter(ctx: &ReducerContext, item_instance_id: u64, world_x: f32, world_y: f32) -> Result<(), String> {
    let sender_id = ctx.sender();
    let inventory_items = ctx.db.inventory_item();
    let item_defs = ctx.db.item_definition();
    let players = ctx.db.player();
    let shelters = ctx.db.shelter(); // Access the shelter table

    // Look up the "Shelter" ItemDefinition ID
    let shelter_item_def_id = item_defs.iter()
        .find(|def| def.name == "Shelter")
        .map(|def| def.id)
        .ok_or_else(|| "Item definition for 'Shelter' not found.".to_string())?;

    log::info!(
        "[PlaceShelter] Player {:?} attempting placement of item {} (Shelter) at ({:.1}, {:.1})",
        sender_id, item_instance_id, world_x, world_y
    );

    // Check if position is within monument zones (ALK stations, rune stones, hot springs, quarries)
    crate::building::check_monument_zone_placement(ctx, world_x, world_y)?;

    // 1. Validate Player and Placement Rules
    let player = players.identity().find(sender_id)
        .ok_or_else(|| "Player not found".to_string())?;

    if player.is_dead {
        return Err("Cannot place shelter while dead.".to_string());
    }
    if player.is_knocked_out { // Assuming is_knocked_out field exists on Player
        return Err("Cannot place shelter while knocked out.".to_string());
    }

    // Check placement distance from player
    let dx_place = world_x - player.position_x;
    let dy_place = world_y - player.position_y;
    let dist_sq_place = dx_place * dx_place + dy_place * dy_place;
    if dist_sq_place > SHELTER_PLACEMENT_MAX_DISTANCE_SQUARED {
        return Err(format!("Cannot place shelter too far away (dist_sq: {:.1} > max_sq: {:.1}).",
                dist_sq_place, SHELTER_PLACEMENT_MAX_DISTANCE_SQUARED));
    }

    // Check if placement position is on a wall
    if crate::building::is_position_on_wall(ctx, world_x, world_y) {
        return Err("Cannot place shelter on a wall.".to_string());
    }

    // Check if placement position is on water (including hot springs)
    let tile_x = (world_x / crate::TILE_SIZE_PX as f32).floor() as i32;
    let tile_y = (world_y / crate::TILE_SIZE_PX as f32).floor() as i32;
    if let Some(tile_type) = crate::get_tile_type_at_position(ctx, tile_x, tile_y) {
        if tile_type.is_water() {
            return Err("Cannot place shelter on water.".to_string());
        }
    }

    // Check collision with other shelters - RE-ENABLING
    for other_shelter in shelters.iter() {
        if other_shelter.is_destroyed { continue; }
        let dx_shelter = world_x - other_shelter.pos_x;
        let dy_shelter = world_y - other_shelter.pos_y; // Using shelter's base y for placement check distance
        let dist_sq_shelter = dx_shelter * dx_shelter + dy_shelter * dy_shelter;
    }

    crate::placeable_collision::check_placeable_overlap(ctx, world_x, world_y, 192.0, 192.0, false)?;
    
    // Check if shelter would be placed on or near a foundation (not allowed)
    // Shelter is 384x384px, which covers 4x4 foundation cells (96px each)
    // We check a 5x5 grid centered on shelter position for full coverage
    use crate::building::{FOUNDATION_TILE_SIZE_PX, foundation_cell as FoundationCellTableTrait};
    let foundations = ctx.db.foundation_cell();
    
    // Convert shelter world position to foundation cell coordinates
    let center_cell_x = (world_x / FOUNDATION_TILE_SIZE_PX as f32).floor() as i32;
    let center_cell_y = (world_y / FOUNDATION_TILE_SIZE_PX as f32).floor() as i32;
    
    // Check 5x5 grid around center (±2 cells in each direction)
    for offset_x in -2..=2 {
        for offset_y in -2..=2 {
            let check_cell_x = center_cell_x + offset_x;
            let check_cell_y = center_cell_y + offset_y;
            
            for foundation in foundations.idx_cell_coords().filter((check_cell_x, check_cell_y)) {
                if !foundation.is_destroyed {
                    return Err("Cannot place shelter on or near foundations. Shelters must be placed on natural ground.".to_string());
                }
            }
        }
    }
    
    // TODO: Add collision checks against other large structures (trees, stones) if necessary.

    // 2. Find the specific item instance and validate
    let item_to_consume = inventory_items.instance_id().find(item_instance_id)
        .ok_or_else(|| format!("Shelter item instance {} not found in player inventory.", item_instance_id))?;

    // Clone the location for potential refund before matching (which might partially move parts of it)
    let original_item_location = item_to_consume.location.clone();

    // Validate ownership and location (simplified, assumes item is from player inventory/hotbar)
    match item_to_consume.location {
        crate::models::ItemLocation::Inventory(data) => {
            if data.owner_id != sender_id {
                return Err(format!("Item instance {} for shelter not owned by player {:?}.", item_instance_id, sender_id));
            }
        }
        crate::models::ItemLocation::Hotbar(data) => {
            if data.owner_id != sender_id {
                return Err(format!("Item instance {} for shelter not owned by player {:?}.", item_instance_id, sender_id));
            }
        }
        _ => {
            return Err(format!("Shelter item instance {} must be in inventory or hotbar to be placed.", item_instance_id));
        }
    }
    
    if item_to_consume.item_def_id != shelter_item_def_id {
        return Err(format!("Item instance {} is not a Shelter (expected def ID {}, got {}).",
                        item_instance_id, shelter_item_def_id, item_to_consume.item_def_id));
    }
    if item_to_consume.quantity < 1 {
        return Err(format!("Not enough quantity of Shelter item instance {}.", item_instance_id));
    }

    // 3. Consume the Item
    // If stackable (which Shelter is not, stack_size: 1), would decrement. For non-stackable, delete.
    log::info!(
        "[PlaceShelter] Consuming item instance {} (Def ID: {}) from player {:?}",
        item_instance_id, shelter_item_def_id, sender_id
    );
    inventory_items.instance_id().delete(item_instance_id);

    // 4. Create Shelter Entity
    let current_time = ctx.timestamp;
    let chunk_idx = calculate_chunk_index(world_x, world_y);

    // ⚠️ IMPORTANT: The shelter sprite is rendered 384px above its base position on the client
    // We offset the placement position by half that height (192px) to align with the preview
    // This offset MUST match the client-side rendering offset or shelters will appear misaligned!
    const SHELTER_VISUAL_RENDER_OFFSET_Y: f32 = 192.0;
    let adjusted_world_y = world_y + SHELTER_VISUAL_RENDER_OFFSET_Y;

    // Determine terrain variant at placement position for visual style
    // Uses efficient tile-based lookup - O(1) operation
    let terrain_variant = get_terrain_variant_at_position(ctx, world_x, world_y);
    log::info!(
        "[PlaceShelter] Terrain variant at ({:.1}, {:.1}): {} (0=default, 1=beach, 2=tundra, 3=alpine)",
        world_x, world_y, terrain_variant
    );

    let new_shelter = Shelter {
        id: 0, // Auto-incremented
        pos_x: world_x,
        pos_y: adjusted_world_y, // Use adjusted Y position
        chunk_index: chunk_idx,
        placed_by: sender_id,
        placed_at: current_time,
        health: SHELTER_INITIAL_MAX_HEALTH, 
        max_health: SHELTER_INITIAL_MAX_HEALTH,
        is_destroyed: false,
        destroyed_at: None,
        last_hit_time: None,
        last_damaged_by: None,
        terrain_variant, // Set terrain variant for visual style
    };

    match shelters.try_insert(new_shelter) {
        Ok(inserted_shelter) => {
            crate::spatial_grid::invalidate_static_grid();
            log::info!(
                "Player {} ({:?}) placed a new Shelter (ID: {}) at ({:.1}, {:.1}).",
                player.username, sender_id, inserted_shelter.id, world_x, world_y
            );
            
            // Clear all natural resources within the shelter's footprint
            clear_resources_in_shelter_footprint(ctx, world_x, adjusted_world_y);
            crate::indoors::repair_world_spawns(ctx);
            
            // Track quest progress for structure placement (generic)
            if let Err(e) = crate::quests::track_quest_progress(
                ctx,
                sender_id,
                crate::quests::QuestObjectiveType::PlaceStructure,
                None,
                1,
            ) {
                log::warn!("Failed to track quest progress for shelter placement: {}", e);
            }
            // Track specific structure placement
            if let Err(e) = crate::quests::track_quest_progress(
                ctx,
                sender_id,
                crate::quests::QuestObjectiveType::PlaceSpecificStructure,
                Some("Shelter"),
                1,
            ) {
                log::warn!("Failed to track specific quest progress for shelter: {}", e);
            }
            // Track PlaceShelter objective (used by tutorial quest)
            if let Err(e) = crate::quests::track_quest_progress(
                ctx,
                sender_id,
                crate::quests::QuestObjectiveType::PlaceShelter,
                None,
                1,
            ) {
                log::warn!("Failed to track PlaceShelter quest progress: {}", e);
            }
            
            // Future: Schedule any initial processing for the shelter if needed.
        }
        Err(e) => {
            log::error!("Failed to insert new shelter for player {:?}: {}", sender_id, e);
            // Attempt to refund the item if shelter placement failed at the DB level.
            // This is a basic refund, more complex logic might be needed for partial stack consumption if shelter was stackable.
            let refund_item = InventoryItem {
                instance_id: 0, // Will be new instance
                item_def_id: shelter_item_def_id,
                quantity: 1,
                location: original_item_location, // Use the cloned original location
                item_data: None, // Initialize as empty
            };
            if inventory_items.try_insert(refund_item).is_err() {
                log::error!("Critical error: Failed to refund Shelter item to player {:?} after placement failure.", sender_id);
            }
            return Err(format!("Failed to place shelter: Database error. Item refunded if possible."));
        }
    }
    Ok(())
}

// --- Shelter Combat Functions ---

/// Checks if a line of sight between two points is blocked by shelter walls
///
/// Returns true if the line is blocked by any shelter wall.
/// This function blocks ALL attacks through shelter walls regardless of ownership,
/// EXCEPT when the attacker is the owner and is inside their own shelter.
/// 
/// NEW RULE: Players inside their own shelter CANNOT attack players or objects outside of it.
/// This creates a safe zone mechanic where shelter owners must leave their shelter to attack.
///
/// PERFORMANCE OPTIMIZED: Single iteration with early distance checks and reduced logging
pub fn is_line_blocked_by_shelter(
    ctx: &ReducerContext,
    attacker_id: Identity,
    target_id: Option<Identity>, // None for non-player targets
    start_x: f32,
    start_y: f32,
    end_x: f32,
    end_y: f32,
) -> bool {
    // Calculate line segment bounding box for early rejection
    let line_min_x = start_x.min(end_x);
    let line_max_x = start_x.max(end_x);
    let line_min_y = start_y.min(end_y);
    let line_max_y = start_y.max(end_y);
    
    // Maximum distance a shelter could be from the line and still intersect
    // Use shelter AABB diagonal + buffer for conservative early rejection
    let max_shelter_extent = (SHELTER_AABB_HALF_WIDTH * SHELTER_AABB_HALF_WIDTH + 
                               SHELTER_AABB_HALF_HEIGHT * SHELTER_AABB_HALF_HEIGHT).sqrt() + 50.0;
    
    // Single iteration combining both owner check and wall blocking
    for shelter in ctx.db.shelter().iter() {
        if shelter.is_destroyed {
            continue;
        }
        
        // Calculate shelter AABB bounds (needed for both checks)
        let shelter_aabb_center_x = shelter.pos_x;
        let shelter_aabb_center_y = shelter.pos_y - SHELTER_AABB_CENTER_Y_OFFSET_FROM_POS_Y;
        let aabb_left = shelter_aabb_center_x - SHELTER_AABB_HALF_WIDTH;
        let aabb_right = shelter_aabb_center_x + SHELTER_AABB_HALF_WIDTH;
        let aabb_top = shelter_aabb_center_y - SHELTER_AABB_HALF_HEIGHT;
        let aabb_bottom = shelter_aabb_center_y + SHELTER_AABB_HALF_HEIGHT;
        
        // EARLY REJECTION: Quick bounding box check - skip shelters clearly too far from line
        if aabb_right < line_min_x - max_shelter_extent ||
           aabb_left > line_max_x + max_shelter_extent ||
           aabb_bottom < line_min_y - max_shelter_extent ||
           aabb_top > line_max_y + max_shelter_extent {
            continue; // Shelter is too far from line segment, skip expensive checks
        }
        
        // Check if attacker is the owner and is inside their shelter
        let attacker_is_owner_inside = shelter.placed_by == attacker_id && 
            is_player_inside_shelter(start_x, start_y, &shelter);
        
        if attacker_is_owner_inside {
            // Check if the target is outside this shelter
            let target_inside_same_shelter = is_player_inside_shelter(end_x, end_y, &shelter);
            
            if !target_inside_same_shelter {
                // Owner inside attacking outside - block for PvP protection
                return true;
            }
            // Target is also inside same shelter - continue to wall blocking check below
        }
        
        // Wall blocking check: If attacker is owner inside targeting inside, skip wall blocking
        if attacker_is_owner_inside && is_player_inside_shelter(end_x, end_y, &shelter) {
            continue; // Owner inside can attack targets inside, skip wall blocking
        }
        
        // Check if line segment intersects with shelter AABB
        if line_intersects_aabb(start_x, start_y, end_x, end_y, aabb_left, aabb_right, aabb_top, aabb_bottom) {
            return true; // Line is blocked
        }
    }
    
    false // Line is not blocked
}

/// Checks if a line segment intersects with an AABB (Axis-Aligned Bounding Box)
///
/// Uses the Liang-Barsky line clipping algorithm to determine intersection.
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

/// Adds shelter targets to the targeting cone if they are within range and angle
///
/// This function should be called from the main targeting logic in combat.rs
/// PERFORMANCE OPTIMIZED: Early range check and reduced logging
pub fn add_shelter_targets_to_cone(
    ctx: &ReducerContext,
    player: &Player,
    attack_range: f32,
    half_attack_angle_rad: f32,
    forward_x: f32,
    forward_y: f32,
    targets: &mut Vec<crate::combat::Target>
) {
    let attack_range_sq = attack_range * attack_range;
    
    // Check Shelters
    for shelter_entity in ctx.db.shelter().iter() {
        if shelter_entity.is_destroyed { continue; } // Skip destroyed shelters
        
        // Use the collision center for targeting, not the base position
        let shelter_collision_center_x = shelter_entity.pos_x;
        let shelter_collision_center_y = shelter_entity.pos_y - SHELTER_AABB_CENTER_Y_OFFSET_FROM_POS_Y;
        
        let dx = shelter_collision_center_x - player.position_x;
        let dy = shelter_collision_center_y - player.position_y; 
        let dist_sq = dx * dx + dy * dy;
        
        // Early range check - skip shelters clearly out of range
        if dist_sq >= attack_range_sq || dist_sq <= 0.0 {
            continue;
        }
        
        // NEW: If player is the owner and is inside the shelter, they cannot attack their own shelter
        if shelter_entity.placed_by == player.identity {
            if is_player_inside_shelter(player.position_x, player.position_y, &shelter_entity) {
                continue; // Skip targeting this shelter
            }
        }
        
        let distance = dist_sq.sqrt();
        let target_vec_x = dx / distance;
        let target_vec_y = dy / distance;

        let dot_product = forward_x * target_vec_x + forward_y * target_vec_y;
        let angle_rad = dot_product.acos();

        if angle_rad <= half_attack_angle_rad {
            targets.push(crate::combat::Target {
                target_type: TargetType::Shelter,
                id: crate::combat::TargetId::Shelter(shelter_entity.id),
                distance_sq: dist_sq,
            });
        }
    }
}

/// Gets the target coordinates for a shelter (collision center)
///
/// Returns the collision center position for line-of-sight calculations
pub fn get_shelter_target_coordinates(shelter: &Shelter) -> (f32, f32) {
    let shelter_collision_center_x = shelter.pos_x;
    let shelter_collision_center_y = shelter.pos_y - SHELTER_AABB_CENTER_Y_OFFSET_FROM_POS_Y;
    (shelter_collision_center_x, shelter_collision_center_y)
}

/// Checks if a player is inside a shelter's AABB
///
/// Returns true if the player's position is within the shelter's collision boundaries
pub fn is_player_inside_shelter(player_x: f32, player_y: f32, shelter: &Shelter) -> bool {
    let shelter_aabb_center_x = shelter.pos_x;
    let shelter_aabb_center_y = shelter.pos_y - SHELTER_AABB_CENTER_Y_OFFSET_FROM_POS_Y;
    let aabb_left = shelter_aabb_center_x - SHELTER_AABB_HALF_WIDTH;
    let aabb_right = shelter_aabb_center_x + SHELTER_AABB_HALF_WIDTH;
    let aabb_top = shelter_aabb_center_y - SHELTER_AABB_HALF_HEIGHT;
    let aabb_bottom = shelter_aabb_center_y + SHELTER_AABB_HALF_HEIGHT;
    
    player_x >= aabb_left && player_x <= aabb_right && player_y >= aabb_top && player_y <= aabb_bottom
}

/// Checks if a player is the owner of a shelter and is inside it
///
/// Returns true if the player owns the shelter and is currently inside its boundaries
/// PERFORMANCE OPTIMIZED: Early distance check to skip shelters far from player
pub fn is_owner_inside_shelter(ctx: &ReducerContext, player_id: Identity, player_x: f32, player_y: f32) -> Option<u32> {
    // Maximum distance from shelter center to still be inside
    let max_distance_sq = (SHELTER_AABB_HALF_WIDTH * SHELTER_AABB_HALF_WIDTH + 
                           SHELTER_AABB_HALF_HEIGHT * SHELTER_AABB_HALF_HEIGHT) + 100.0;
    
    for shelter in ctx.db.shelter().iter() {
        if shelter.is_destroyed { continue; }
        
        // Only check shelters owned by this player
        if shelter.placed_by != player_id { continue; }
        
        // Early distance check - skip shelters clearly too far
        let shelter_aabb_center_x = shelter.pos_x;
        let shelter_aabb_center_y = shelter.pos_y - SHELTER_AABB_CENTER_Y_OFFSET_FROM_POS_Y;
        let dx = player_x - shelter_aabb_center_x;
        let dy = player_y - shelter_aabb_center_y;
        let dist_sq = dx * dx + dy * dy;
        
        if dist_sq > max_distance_sq { continue; }
        
        if is_player_inside_shelter(player_x, player_y, &shelter) {
            return Some(shelter.id);
        }
    }
    None
}

/// Applies damage to a shelter and handles destruction
pub fn damage_shelter(
    ctx: &ReducerContext,
    attacker_id: Identity,
    shelter_id: u32,
    damage: f32,
    timestamp: Timestamp,
    rng: &mut impl Rng
) -> Result<AttackResult, String> {
    // Check if the attacker is using a repair hammer
    if let Some(active_equip) = ctx.db.active_equipment().player_identity().find(attacker_id) {
        if let Some(equipped_item_id) = active_equip.equipped_item_instance_id {
            if let Some(equipped_item) = ctx.db.inventory_item().instance_id().find(equipped_item_id) {
                if let Some(item_def) = ctx.db.item_definition().id().find(equipped_item.item_def_id) {
                    if crate::repair::is_repair_hammer(&item_def) {
                        // Use repair instead of damage
                        return crate::repair::repair_shelter(ctx, attacker_id, shelter_id, damage, timestamp);
                    }
                }
            }
        }
    }

    // Original damage logic if not using repair hammer
    let mut shelters_table = ctx.db.shelter();
    let mut shelter = shelters_table.id().find(shelter_id)
        .ok_or_else(|| format!("Target shelter {} disappeared", shelter_id))?;

    if shelter.is_destroyed {
        return Ok(AttackResult { hit: false, target_type: Some(TargetType::Shelter), resource_granted: None });
    }

    let old_health = shelter.health;
    shelter.health = (shelter.health - damage).max(0.0);
    shelter.last_hit_time = Some(timestamp);
    shelter.last_damaged_by = Some(attacker_id);

    log::info!(
        "Player {:?} hit Shelter {} for {:.1} damage. Health: {:.1} -> {:.1}",
        attacker_id, shelter_id, damage, old_health, shelter.health
    );

    if shelter.health <= 0.0 {
        shelter.is_destroyed = true;
        shelter.destroyed_at = Some(timestamp);
        
        // Update shelter to mark as destroyed before deleting, so clients see the state change
        shelters_table.id().update(shelter.clone());
        // Then delete the shelter entity
        shelters_table.id().delete(shelter_id);
        crate::spatial_grid::invalidate_static_grid();

        log::info!(
            "Shelter {} destroyed by player {:?}. Consider dropping constituent materials.",
            shelter_id, attacker_id
        );

        // TODO: Implement logic to drop some constituent materials (e.g., wood, stone, fiber)
        // Example: grant_resource(ctx, attacker_id, "Wood", rng.gen_range(50..=150))?;
        // This would require shelter to store its original crafter or make resources drop at location.
        // For now, just logs a message.

    } else {
        shelters_table.id().update(shelter);
    }

    Ok(AttackResult {
        hit: true,
        target_type: Some(TargetType::Shelter),
        resource_granted: None, // No direct resource grant on hit, only on destruction (TODO)
    })
}

/// Checks if a projectile path intersects with any shelter walls
///
/// Returns Some((shelter_id, collision_x, collision_y)) if collision occurs, None otherwise
pub fn check_projectile_shelter_collision(
    ctx: &ReducerContext,
    start_x: f32,
    start_y: f32,
    end_x: f32,
    end_y: f32,
) -> Option<(u32, f32, f32)> {
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
        
        // Check if projectile line intersects with shelter AABB
        if line_intersects_aabb(start_x, start_y, end_x, end_y, aabb_left, aabb_right, aabb_top, aabb_bottom) {
            // Calculate collision point (approximate - could be more precise)
            let collision_x = end_x.max(aabb_left).min(aabb_right);
            let collision_y = end_y.max(aabb_top).min(aabb_bottom);
            
            log::info!(
                "[ProjectileCollision] Projectile path from ({:.1}, {:.1}) to ({:.1}, {:.1}) hits Shelter {} at approximately ({:.1}, {:.1})",
                start_x, start_y, end_x, end_y, shelter.id, collision_x, collision_y
            );
            
            return Some((shelter.id, collision_x, collision_y));
        }
    }
    
    None
}

/// Swept 3D projectile contact with a shelter volume, ordered by distance.
pub fn check_projectile_shelter_collision_3d(
    ctx: &ReducerContext, start: crate::projectile_geometry::Point3, end: crate::projectile_geometry::Point3,
) -> Option<(u32, f32, f32)> {
    use crate::projectile_geometry::{box_surface_impact, Point3};
    let mut nearest: Option<(u32, f32)> = None;
    for shelter in ctx.db.shelter().iter() {
        if shelter.is_destroyed { continue; }
        let cy = shelter.pos_y - SHELTER_AABB_CENTER_Y_OFFSET_FROM_POS_Y;
        let min = Point3 { x: shelter.pos_x - SHELTER_AABB_HALF_WIDTH, y: cy - SHELTER_AABB_HALF_HEIGHT, height: 0.0 };
        let max = Point3 { x: shelter.pos_x + SHELTER_AABB_HALF_WIDTH, y: cy + SHELTER_AABB_HALF_HEIGHT, height: 110.0 };
        if let Some(t) = box_surface_impact(start, end, min, max) {
            if nearest.map_or(true, |(id, old)| t < old || (t == old && shelter.id < id)) { nearest = Some((shelter.id, t)); }
        }
    }
    nearest.map(|(id, t)| (id, start.x + (end.x - start.x) * t, start.y + (end.y - start.y) * t))
}

/// Checks if a projectile's current position intersects with any shelter walls
///
/// Returns Some(shelter_id) if collision occurs, None otherwise
pub fn check_projectile_position_in_shelter(
    ctx: &ReducerContext,
    projectile_x: f32,
    projectile_y: f32,
) -> Option<u32> {
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
        
        // Check if projectile position is inside shelter AABB
        if projectile_x >= aabb_left && projectile_x <= aabb_right && 
           projectile_y >= aabb_top && projectile_y <= aabb_bottom {
            
            log::debug!(
                "[ProjectileInShelter] Projectile at ({:.1}, {:.1}) is inside Shelter {}",
                projectile_x, projectile_y, shelter.id
            );
            
            return Some(shelter.id);
        }
    }
    
    None
}

/// Calculates warmth bonus for a player if they are inside their own shelter
///
/// Returns the warmth bonus per second (0.5 if inside own shelter, 0.0 otherwise)
/// PERFORMANCE OPTIMIZED: Early distance check to skip shelters far from player
pub fn calculate_shelter_warmth_bonus(
    ctx: &ReducerContext,
    player_id: Identity,
    player_x: f32,
    player_y: f32,
) -> f32 {
    const SHELTER_WARMTH_BONUS_PER_SECOND: f32 = 0.5;
    
    // Maximum distance player could be from shelter center and still be inside
    let max_distance_sq = (SHELTER_AABB_HALF_WIDTH * SHELTER_AABB_HALF_WIDTH + 
                           SHELTER_AABB_HALF_HEIGHT * SHELTER_AABB_HALF_HEIGHT) + 100.0;
    
    for shelter in ctx.db.shelter().iter() {
        if shelter.is_destroyed { continue; }
        
        // Only check shelters owned by this player
        if shelter.placed_by != player_id { continue; }
        
        // Early distance check - skip shelters clearly too far
        let shelter_aabb_center_x = shelter.pos_x;
        let shelter_aabb_center_y = shelter.pos_y - SHELTER_AABB_CENTER_Y_OFFSET_FROM_POS_Y;
        let dx = player_x - shelter_aabb_center_x;
        let dy = player_y - shelter_aabb_center_y;
        let dist_sq = dx * dx + dy * dy;
        
        if dist_sq > max_distance_sq { continue; }
        
        // Check if player is inside the shelter
        if is_player_inside_shelter(player_x, player_y, &shelter) {
            return SHELTER_WARMTH_BONUS_PER_SECOND;
        }
    }
    
    0.0 // No warmth bonus if not inside own shelter
}

/// Checks if a player can interact with an object at a given position
/// 
/// Returns true if:
/// - The object is not inside any shelter, OR
/// - The player is the owner of the shelter containing the object and is also inside that shelter
/// PERFORMANCE OPTIMIZED: Early distance checks to skip shelters far from object/player
pub fn can_player_interact_with_object_in_shelter(
    ctx: &ReducerContext,
    player_id: Identity,
    player_x: f32,
    player_y: f32,
    object_x: f32,
    object_y: f32,
) -> bool {
    // Maximum distance from shelter center to still be inside
    let max_distance_sq = (SHELTER_AABB_HALF_WIDTH * SHELTER_AABB_HALF_WIDTH + 
                           SHELTER_AABB_HALF_HEIGHT * SHELTER_AABB_HALF_HEIGHT) + 100.0;
    
    // Check if the object is inside any shelter
    for shelter in ctx.db.shelter().iter() {
        if shelter.is_destroyed { continue; }
        
        // Early distance check for object - skip shelters clearly too far
        let shelter_aabb_center_x = shelter.pos_x;
        let shelter_aabb_center_y = shelter.pos_y - SHELTER_AABB_CENTER_Y_OFFSET_FROM_POS_Y;
        let obj_dx = object_x - shelter_aabb_center_x;
        let obj_dy = object_y - shelter_aabb_center_y;
        let obj_dist_sq = obj_dx * obj_dx + obj_dy * obj_dy;
        
        if obj_dist_sq > max_distance_sq { continue; }
        
        // Check if the object is inside this shelter
        if is_player_inside_shelter(object_x, object_y, &shelter) {
            // Object is inside a shelter - check if player is the owner and is also inside
            if shelter.placed_by == player_id {
                // Player owns the shelter, check if they're inside it
                if is_player_inside_shelter(player_x, player_y, &shelter) {
                    return true; // Owner inside their shelter can interact
                } else {
                    return false; // Owner outside their shelter cannot interact
                }
            } else {
                return false; // Non-owner cannot interact with objects inside shelter
            }
        }
    }
    
    // Object is not inside any shelter, interaction is allowed
    true
}

/// Clears all natural resources within the shelter's footprint
///
/// This function removes trees, stones, mushrooms, corn, pumpkins, hemp, grass,
/// and their associated respawn schedules to prevent them from respawning inside the shelter.
/// Uses a buffer zone around the shelter for a larger clearing area.
fn clear_resources_in_shelter_footprint(ctx: &ReducerContext, shelter_x: f32, shelter_y: f32) {
    // Calculate shelter AABB bounds with buffer zone for resource clearing
    let shelter_aabb_center_x = shelter_x;
    let shelter_aabb_center_y = shelter_y - SHELTER_AABB_CENTER_Y_OFFSET_FROM_POS_Y;
    let aabb_left = shelter_aabb_center_x - SHELTER_AABB_HALF_WIDTH - SHELTER_RESOURCE_CLEARING_BUFFER;
    let aabb_right = shelter_aabb_center_x + SHELTER_AABB_HALF_WIDTH + SHELTER_RESOURCE_CLEARING_BUFFER;
    let aabb_top = shelter_aabb_center_y - SHELTER_AABB_HALF_HEIGHT - SHELTER_RESOURCE_CLEARING_BUFFER;
    let aabb_bottom = shelter_aabb_center_y + SHELTER_AABB_HALF_HEIGHT + SHELTER_RESOURCE_CLEARING_BUFFER;
    
    log::info!(
        "[ShelterCleanup] Clearing resources in expanded shelter footprint ({}px buffer): AABB({:.1}-{:.1}, {:.1}-{:.1})",
        SHELTER_RESOURCE_CLEARING_BUFFER, aabb_left, aabb_right, aabb_top, aabb_bottom
    );
    
    let mut resources_cleared = 0;
    
    // Clear Trees
    let trees_to_remove: Vec<u64> = ctx.db.tree().iter()
        .filter(|tree| {
            let inside = tree.pos_x >= aabb_left && tree.pos_x <= aabb_right && 
                        tree.pos_y >= aabb_top && tree.pos_y <= aabb_bottom;
            if inside {
                log::debug!("[ShelterCleanup] Removing Tree {} at ({:.1}, {:.1})", tree.id, tree.pos_x, tree.pos_y);
            }
            inside
        })
        .map(|tree| tree.id)
        .collect();
    
    for tree_id in trees_to_remove {
        ctx.db.tree().id().delete(tree_id);
        crate::spatial_grid::invalidate_static_grid();
        resources_cleared += 1;
    }
    
    // Clear Stones
    let stones_to_remove: Vec<u64> = ctx.db.stone().iter()
        .filter(|stone| {
            let inside = stone.pos_x >= aabb_left && stone.pos_x <= aabb_right && 
                        stone.pos_y >= aabb_top && stone.pos_y <= aabb_bottom;
            if inside {
                log::debug!("[ShelterCleanup] Removing Stone {} at ({:.1}, {:.1})", stone.id, stone.pos_x, stone.pos_y);
            }
            inside
        })
        .map(|stone| stone.id)
        .collect();
    
    for stone_id in stones_to_remove {
        ctx.db.stone().id().delete(stone_id);
        crate::spatial_grid::invalidate_static_grid();
        resources_cleared += 1;
    }
    
    // Clear Harvestable Resources (including mushrooms in unified system)
    let harvestable_to_remove: Vec<u64> = ctx.db.harvestable_resource().iter()
        .filter(|resource| {
            let inside = resource.pos_x >= aabb_left && resource.pos_x <= aabb_right && 
                        resource.pos_y >= aabb_top && resource.pos_y <= aabb_bottom;
            if inside {
                log::debug!("[ShelterCleanup] Removing {:?} {} at ({:.1}, {:.1})", 
                           resource.plant_type, resource.id, resource.pos_x, resource.pos_y);
            }
            inside
        })
        .map(|resource| resource.id)
        .collect();
    
    for resource_id in harvestable_to_remove {
        ctx.db.harvestable_resource().id().delete(resource_id);
        resources_cleared += 1;
    }
    
    // Clear Grass (split tables: delete from both Grass and GrassState)
    let grass_table = ctx.db.grass();
    let grass_state_table = ctx.db.grass_state();
    
    let grass_to_remove: Vec<u64> = grass_table.iter()
        .filter(|grass| {
            let inside = grass.pos_x >= aabb_left && grass.pos_x <= aabb_right && 
                        grass.pos_y >= aabb_top && grass.pos_y <= aabb_bottom;
            if inside {
                log::debug!("[ShelterCleanup] Removing Grass {} at ({:.1}, {:.1})", grass.id, grass.pos_x, grass.pos_y);
            }
            inside
        })
        .map(|grass| grass.id)
        .collect();
    
    for grass_id in grass_to_remove {
        // Delete from both tables
        grass_state_table.grass_id().delete(grass_id);
        grass_table.id().delete(grass_id);
        resources_cleared += 1;
    }
    
    // Cancel Grass Respawns within shelter footprint (update GrassState only)
    // Note: With the batch scheduler, grass entities stay in the table with is_alive=false and respawn_at set.
    // We cancel their respawn by setting respawn_at = UNIX_EPOCH in GrassState
    let grass_to_cancel: Vec<u64> = grass_state_table.iter()
        .filter(|state| {
            // Only check destroyed grass (is_alive=false) with pending respawn
            if state.is_alive || state.respawn_at == spacetimedb::Timestamp::UNIX_EPOCH {
                return false;
            }
            // Look up position from static Grass table
            if let Some(grass) = grass_table.id().find(state.grass_id) {
                let inside = grass.pos_x >= aabb_left && grass.pos_x <= aabb_right && 
                            grass.pos_y >= aabb_top && grass.pos_y <= aabb_bottom;
                if inside {
                    log::debug!("[ShelterCleanup] Cancelling Grass respawn for ID {} at ({:.1}, {:.1})", 
                               grass.id, grass.pos_x, grass.pos_y);
                }
                inside
            } else {
                false
            }
        })
        .map(|state| state.grass_id)
        .collect();
    
    for grass_id in grass_to_cancel {
        if let Some(mut state) = grass_state_table.grass_id().find(grass_id) {
            state.respawn_at = spacetimedb::Timestamp::UNIX_EPOCH; // Cancel respawn
            grass_state_table.grass_id().update(state);
            resources_cleared += 1;
        }
    }
    
    log::info!(
        "[ShelterCleanup] Cleared {} natural resources and schedules from shelter footprint at ({:.1}, {:.1})",
        resources_cleared, shelter_x, shelter_y
    );
}
