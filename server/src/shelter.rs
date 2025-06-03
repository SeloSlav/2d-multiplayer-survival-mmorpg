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
use crate::mushroom::mushroom as MushroomTableTrait;
use crate::corn::corn as CornTableTrait;
use crate::pumpkin::pumpkin as PumpkinTableTrait;
use crate::hemp::hemp as HempTableTrait;
use crate::grass::grass as GrassTableTrait;
use crate::grass::grass_respawn_schedule as GrassRespawnScheduleTableTrait;

// --- Constants ---
// Visual/Collision constants (can be tuned)
pub(crate) const SHELTER_VISUAL_WIDTH: f32 = 128.0; // For reference, actual collision might be different
pub(crate) const SHELTER_VISUAL_HEIGHT: f32 = 128.0; // For reference

// Placement constants
pub(crate) const SHELTER_PLACEMENT_MAX_DISTANCE: f32 = 256.0; // Increased from 128.0
pub(crate) const SHELTER_PLACEMENT_MAX_DISTANCE_SQUARED: f32 = SHELTER_PLACEMENT_MAX_DISTANCE * SHELTER_PLACEMENT_MAX_DISTANCE;

// Interaction constants (if any, for now focusing on placement)
pub(crate) const PLAYER_SHELTER_INTERACTION_DISTANCE: f32 = 128.0; 
pub(crate) const PLAYER_SHELTER_INTERACTION_DISTANCE_SQUARED: f32 = 
    PLAYER_SHELTER_INTERACTION_DISTANCE * PLAYER_SHELTER_INTERACTION_DISTANCE;

// Health
pub(crate) const SHELTER_INITIAL_MAX_HEALTH: f32 = 25000.0; // Adjusted for ~6 min destruction time with Wooden Spear

// --- Health constants for consistency ---
pub const SHELTER_INITIAL_HEALTH: f32 = SHELTER_INITIAL_MAX_HEALTH;
pub const SHELTER_MAX_HEALTH: f32 = SHELTER_INITIAL_MAX_HEALTH;

// --- NEW: Shelter Collision Constants (AABB based) ---
/// Width of the shelter's collision AABB.
pub(crate) const SHELTER_COLLISION_WIDTH: f32 = 300.0;
/// Height of the shelter's collision AABB.
pub(crate) const SHELTER_COLLISION_HEIGHT: f32 = 125.0; // Reduced back to match visual representation
/// Half-width of the shelter's collision AABB.
pub(crate) const SHELTER_AABB_HALF_WIDTH: f32 = SHELTER_COLLISION_WIDTH / 2.0;
/// Half-height of the shelter's collision AABB.
pub(crate) const SHELTER_AABB_HALF_HEIGHT: f32 = SHELTER_COLLISION_HEIGHT / 2.0; // Now 125.0 / 2.0 = 62.5
/// Vertical offset from shelter.pos_y (base) to the center of the AABB.
/// AABB_center_y = shelter.pos_y - SHELTER_AABB_CENTER_Y_OFFSET_FROM_POS_Y.
pub(crate) const SHELTER_AABB_CENTER_Y_OFFSET_FROM_POS_Y: f32 = 200.0; // Keep the same offset to maintain position

/// Buffer zone around shelter for resource clearing (in pixels)
/// This extends the clearing area beyond the shelter's collision boundaries
pub(crate) const SHELTER_RESOURCE_CLEARING_BUFFER: f32 = 100.0; // 100px buffer around shelter

/// --- Shelter Data Structure ---
/// Represents a player-built shelter in the game world.
#[spacetimedb::table(name = shelter, public)]
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
}

// --- Reducer to Place a Shelter ---
#[spacetimedb::reducer]
pub fn place_shelter(ctx: &ReducerContext, item_instance_id: u64, world_x: f32, world_y: f32) -> Result<(), String> {
    let sender_id = ctx.sender;
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

    // Check collision with other shelters - RE-ENABLING
    for other_shelter in shelters.iter() {
        if other_shelter.is_destroyed { continue; }
        let dx_shelter = world_x - other_shelter.pos_x;
        let dy_shelter = world_y - other_shelter.pos_y; // Using shelter's base y for placement check distance
        let dist_sq_shelter = dx_shelter * dx_shelter + dy_shelter * dy_shelter;
    }
    
    // TODO: Add collision checks against other large structures (trees, stones, buildings) if necessary.

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
    };

    match shelters.try_insert(new_shelter) {
        Ok(inserted_shelter) => {
            log::info!(
                "Player {} ({:?}) placed a new Shelter (ID: {}) at ({:.1}, {:.1}).",
                player.username, sender_id, inserted_shelter.id, world_x, world_y
            );
            
            // Clear all natural resources within the shelter's footprint
            clear_resources_in_shelter_footprint(ctx, world_x, adjusted_world_y);
            
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
pub fn is_line_blocked_by_shelter(
    ctx: &ReducerContext,
    attacker_id: Identity,
    target_id: Option<Identity>, // None for non-player targets
    start_x: f32,
    start_y: f32,
    end_x: f32,
    end_y: f32,
) -> bool {
    log::debug!(
        "[LineOfSight] Checking line from Player {:?} at ({:.1}, {:.1}) to target at ({:.1}, {:.1})",
        attacker_id, start_x, start_y, end_x, end_y
    );
    
    // NEW: Check if attacker is inside their own shelter and targeting something outside
    for shelter in ctx.db.shelter().iter() {
        if shelter.is_destroyed {
            continue;
        }
        
        // If attacker is the owner and is inside their shelter
        if shelter.placed_by == attacker_id && is_player_inside_shelter(start_x, start_y, &shelter) {
            // Check if the target is outside this shelter
            let target_inside_same_shelter = is_player_inside_shelter(end_x, end_y, &shelter);
            
            if !target_inside_same_shelter {
                log::info!(
                    "[ShelterProtection] Player {:?} (owner) is inside Shelter {} but targeting outside - ATTACK BLOCKED for PvP protection",
                    attacker_id, shelter.id
                );
                return true; // Block the attack - no attacking from inside shelter to outside
            } else {
                log::debug!(
                    "[ShelterProtection] Player {:?} (owner) is inside Shelter {} targeting inside same shelter - attack allowed",
                    attacker_id, shelter.id
                );
                // Target is also inside the same shelter, continue checking other shelters for wall blocking
            }
        }
    }
    
    // Original wall blocking logic - check if any shelter walls physically block the line
    for shelter in ctx.db.shelter().iter() {
        if shelter.is_destroyed {
            continue;
        }
        
        log::debug!(
            "[LineOfSight] Checking Shelter {} placed by {:?} at ({:.1}, {:.1})",
            shelter.id, shelter.placed_by, shelter.pos_x, shelter.pos_y
        );
        
        // If the attacker is the owner and is inside their shelter, 
        // their own shelter walls don't block their line of sight to targets INSIDE the same shelter
        if shelter.placed_by == attacker_id && is_player_inside_shelter(start_x, start_y, &shelter) {
            let target_inside_same_shelter = is_player_inside_shelter(end_x, end_y, &shelter);
            if target_inside_same_shelter {
                log::debug!(
                    "[LineOfSight] Attacker {:?} is owner inside Shelter {} targeting inside same shelter, shelter walls do not block line of sight",
                    attacker_id, shelter.id
                );
                continue; // Skip wall blocking check for this shelter - owner inside can attack targets inside
            }
        }
        
        // All other cases: shelter walls block attacks (including owner inside attacking outside, handled above)
        
        // Calculate shelter AABB bounds
        let shelter_aabb_center_x = shelter.pos_x;
        let shelter_aabb_center_y = shelter.pos_y - SHELTER_AABB_CENTER_Y_OFFSET_FROM_POS_Y;
        let aabb_left = shelter_aabb_center_x - SHELTER_AABB_HALF_WIDTH;
        let aabb_right = shelter_aabb_center_x + SHELTER_AABB_HALF_WIDTH;
        let aabb_top = shelter_aabb_center_y - SHELTER_AABB_HALF_HEIGHT;
        let aabb_bottom = shelter_aabb_center_y + SHELTER_AABB_HALF_HEIGHT;
        
        log::debug!(
            "[LineOfSight] Shelter {} AABB: Center({:.1}, {:.1}), Bounds({:.1}-{:.1}, {:.1}-{:.1})",
            shelter.id, shelter_aabb_center_x, shelter_aabb_center_y,
            aabb_left, aabb_right, aabb_top, aabb_bottom
        );
        
        // Check if line segment intersects with shelter AABB
        if line_intersects_aabb(start_x, start_y, end_x, end_y, aabb_left, aabb_right, aabb_top, aabb_bottom) {
            log::info!(
                "[LineOfSight] BLOCKED! Line from ({:.1}, {:.1}) to ({:.1}, {:.1}) intersects Shelter {} AABB",
                start_x, start_y, end_x, end_y, shelter.id
            );
            return true; // Line is blocked
        } else {
            log::debug!(
                "[LineOfSight] Line does not intersect Shelter {} AABB",
                shelter.id
            );
        }
    }
    
    log::debug!(
        "[LineOfSight] Line from ({:.1}, {:.1}) to ({:.1}, {:.1}) is NOT blocked by any shelter",
        start_x, start_y, end_x, end_y
    );
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
pub fn add_shelter_targets_to_cone(
    ctx: &ReducerContext,
    player: &Player,
    attack_range: f32,
    half_attack_angle_rad: f32,
    forward_x: f32,
    forward_y: f32,
    targets: &mut Vec<crate::combat::Target>
) {
    // Check Shelters
    for shelter_entity in ctx.db.shelter().iter() {
        if shelter_entity.is_destroyed { continue; } // Skip destroyed shelters
        
        // NEW: If player is the owner and is inside the shelter, they cannot attack their own shelter
        if shelter_entity.placed_by == player.identity {
            if is_player_inside_shelter(player.position_x, player.position_y, &shelter_entity) {
                log::debug!(
                    "[ShelterTargeting] Player {:?} is owner and inside Shelter {}, cannot attack own shelter from inside",
                    player.identity, shelter_entity.id
                );
                continue; // Skip targeting this shelter
            }
        }
        
        // Use the collision center for targeting, not the base position
        let shelter_collision_center_x = shelter_entity.pos_x;
        let shelter_collision_center_y = shelter_entity.pos_y - SHELTER_AABB_CENTER_Y_OFFSET_FROM_POS_Y;
        
        let dx = shelter_collision_center_x - player.position_x;
        let dy = shelter_collision_center_y - player.position_y; 
        let dist_sq = dx * dx + dy * dy;
        
        log::debug!(
            "[ShelterTargeting] Player {:?} checking Shelter {} at base({:.1}, {:.1}) collision_center({:.1}, {:.1}). Distance: {:.1}, Attack Range: {:.1}",
            player.identity, shelter_entity.id, shelter_entity.pos_x, shelter_entity.pos_y, 
            shelter_collision_center_x, shelter_collision_center_y, dist_sq.sqrt(), attack_range
        );
        
        if dist_sq < (attack_range * attack_range) && dist_sq > 0.0 {
            let distance = dist_sq.sqrt();
            let target_vec_x = dx / distance;
            let target_vec_y = dy / distance;

            let dot_product = forward_x * target_vec_x + forward_y * target_vec_y;
            let angle_rad = dot_product.acos();

            log::debug!(
                "[ShelterTargeting] Shelter {} within range. Angle: {:.2} rad, Half attack angle: {:.2} rad",
                shelter_entity.id, angle_rad, half_attack_angle_rad
            );

            if angle_rad <= half_attack_angle_rad {
                log::info!(
                    "[ShelterTargeting] Adding Shelter {} as target for Player {:?}",
                    shelter_entity.id, player.identity
                );
                targets.push(crate::combat::Target {
                    target_type: TargetType::Shelter,
                    id: crate::combat::TargetId::Shelter(shelter_entity.id),
                    distance_sq: dist_sq,
                });
            } else {
                log::debug!(
                    "[ShelterTargeting] Shelter {} outside attack angle for Player {:?}",
                    shelter_entity.id, player.identity
                );
            }
        } else {
            log::debug!(
                "[ShelterTargeting] Shelter {} outside attack range for Player {:?}",
                shelter_entity.id, player.identity
            );
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
pub fn is_owner_inside_shelter(ctx: &ReducerContext, player_id: Identity, player_x: f32, player_y: f32) -> Option<u32> {
    for shelter in ctx.db.shelter().iter() {
        if shelter.is_destroyed { continue; }
        if shelter.placed_by == player_id && is_player_inside_shelter(player_x, player_y, &shelter) {
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
pub fn calculate_shelter_warmth_bonus(
    ctx: &ReducerContext,
    player_id: Identity,
    player_x: f32,
    player_y: f32,
) -> f32 {
    const SHELTER_WARMTH_BONUS_PER_SECOND: f32 = 0.5;
    
    for shelter in ctx.db.shelter().iter() {
        if shelter.is_destroyed { continue; }
        
        // Check if player is the owner and is inside the shelter
        if shelter.placed_by == player_id && is_player_inside_shelter(player_x, player_y, &shelter) {
            log::trace!(
                "[ShelterWarmth] Player {:?} is inside their own Shelter {}, granting {:.1} warmth/sec",
                player_id, shelter.id, SHELTER_WARMTH_BONUS_PER_SECOND
            );
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
pub fn can_player_interact_with_object_in_shelter(
    ctx: &ReducerContext,
    player_id: Identity,
    player_x: f32,
    player_y: f32,
    object_x: f32,
    object_y: f32,
) -> bool {
    // Check if the object is inside any shelter
    for shelter in ctx.db.shelter().iter() {
        if shelter.is_destroyed { continue; }
        
        // Check if the object is inside this shelter
        if is_player_inside_shelter(object_x, object_y, &shelter) {
            log::debug!(
                "[ShelterInteraction] Object at ({:.1}, {:.1}) is inside Shelter {} owned by {:?}",
                object_x, object_y, shelter.id, shelter.placed_by
            );
            
            // Object is inside a shelter - check if player is the owner and is also inside
            if shelter.placed_by == player_id {
                // Player owns the shelter, check if they're inside it
                if is_player_inside_shelter(player_x, player_y, &shelter) {
                    log::debug!(
                        "[ShelterInteraction] Player {:?} (owner) is inside Shelter {} and can interact with object",
                        player_id, shelter.id
                    );
                    return true; // Owner inside their shelter can interact
                } else {
                    log::info!(
                        "[ShelterInteraction] Player {:?} (owner) is outside Shelter {} and cannot interact with object inside",
                        player_id, shelter.id
                    );
                    return false; // Owner outside their shelter cannot interact
                }
            } else {
                log::info!(
                    "[ShelterInteraction] Player {:?} is not the owner of Shelter {} and cannot interact with object inside",
                    player_id, shelter.id
                );
                return false; // Non-owner cannot interact with objects inside shelter
            }
        }
    }
    
    // Object is not inside any shelter, interaction is allowed
    log::trace!(
        "[ShelterInteraction] Object at ({:.1}, {:.1}) is not inside any shelter, interaction allowed",
        object_x, object_y
    );
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
        resources_cleared += 1;
    }
    
    // Clear Mushrooms
    let mushrooms_to_remove: Vec<u64> = ctx.db.mushroom().iter()
        .filter(|mushroom| {
            let inside = mushroom.pos_x >= aabb_left && mushroom.pos_x <= aabb_right && 
                        mushroom.pos_y >= aabb_top && mushroom.pos_y <= aabb_bottom;
            if inside {
                log::debug!("[ShelterCleanup] Removing Mushroom {} at ({:.1}, {:.1})", mushroom.id, mushroom.pos_x, mushroom.pos_y);
            }
            inside
        })
        .map(|mushroom| mushroom.id)
        .collect();
    
    for mushroom_id in mushrooms_to_remove {
        ctx.db.mushroom().id().delete(mushroom_id);
        resources_cleared += 1;
    }
    
    // Clear Corn
    let corn_to_remove: Vec<u64> = ctx.db.corn().iter()
        .filter(|corn| {
            let inside = corn.pos_x >= aabb_left && corn.pos_x <= aabb_right && 
                        corn.pos_y >= aabb_top && corn.pos_y <= aabb_bottom;
            if inside {
                log::debug!("[ShelterCleanup] Removing Corn {} at ({:.1}, {:.1})", corn.id, corn.pos_x, corn.pos_y);
            }
            inside
        })
        .map(|corn| corn.id)
        .collect();
    
    for corn_id in corn_to_remove {
        ctx.db.corn().id().delete(corn_id);
        resources_cleared += 1;
    }
    
    // Clear Pumpkins
    let pumpkins_to_remove: Vec<u64> = ctx.db.pumpkin().iter()
        .filter(|pumpkin| {
            let inside = pumpkin.pos_x >= aabb_left && pumpkin.pos_x <= aabb_right && 
                        pumpkin.pos_y >= aabb_top && pumpkin.pos_y <= aabb_bottom;
            if inside {
                log::debug!("[ShelterCleanup] Removing Pumpkin {} at ({:.1}, {:.1})", pumpkin.id, pumpkin.pos_x, pumpkin.pos_y);
            }
            inside
        })
        .map(|pumpkin| pumpkin.id)
        .collect();
    
    for pumpkin_id in pumpkins_to_remove {
        ctx.db.pumpkin().id().delete(pumpkin_id);
        resources_cleared += 1;
    }
    
    // Clear Hemp
    let hemp_to_remove: Vec<u64> = ctx.db.hemp().iter()
        .filter(|hemp| {
            let inside = hemp.pos_x >= aabb_left && hemp.pos_x <= aabb_right && 
                        hemp.pos_y >= aabb_top && hemp.pos_y <= aabb_bottom;
            if inside {
                log::debug!("[ShelterCleanup] Removing Hemp {} at ({:.1}, {:.1})", hemp.id, hemp.pos_x, hemp.pos_y);
            }
            inside
        })
        .map(|hemp| hemp.id)
        .collect();
    
    for hemp_id in hemp_to_remove {
        ctx.db.hemp().id().delete(hemp_id);
        resources_cleared += 1;
    }
    
    // Clear Grass
    let grass_to_remove: Vec<u64> = ctx.db.grass().iter()
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
        ctx.db.grass().id().delete(grass_id);
        resources_cleared += 1;
    }
    
    // Clear Grass Respawn Schedules
    // Note: Grass respawn schedules contain position data, so we can filter by position
    let grass_respawn_schedules_to_remove: Vec<u64> = ctx.db.grass_respawn_schedule().iter()
        .filter(|schedule| {
            let grass_data = &schedule.respawn_data;
            let inside = grass_data.pos_x >= aabb_left && grass_data.pos_x <= aabb_right && 
                        grass_data.pos_y >= aabb_top && grass_data.pos_y <= aabb_bottom;
            if inside {
                log::debug!("[ShelterCleanup] Removing Grass respawn schedule {} for position ({:.1}, {:.1})", 
                           schedule.schedule_id, grass_data.pos_x, grass_data.pos_y);
            }
            inside
        })
        .map(|schedule| schedule.schedule_id)
        .collect();
    
    for schedule_id in grass_respawn_schedules_to_remove {
        ctx.db.grass_respawn_schedule().schedule_id().delete(schedule_id);
        resources_cleared += 1;
    }
    
    log::info!(
        "[ShelterCleanup] Cleared {} natural resources and schedules from shelter footprint at ({:.1}, {:.1})",
        resources_cleared, shelter_x, shelter_y
    );
}
