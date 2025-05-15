/******************************************************************************
 *                                                                            *
 * Defines the combat system for the game, handling damage calculations,      *
 * attack targeting, resource gathering, and player-vs-player interactions.   *
 * Provides reusable targeting functions, damage application, and resource    *
 * granting mechanisms used by tools and weapons across the game world.       *
 *                                                                            *
 ******************************************************************************/

// Standard library imports
use std::f32::consts::PI;
use std::time::Duration;
use rand::{Rng, SeedableRng};

// SpacetimeDB imports
use spacetimedb::{Identity, ReducerContext, Table, Timestamp, TimeDuration};
use log;

// Core game types
use crate::Player;
use crate::PLAYER_RADIUS;
use crate::{WORLD_WIDTH_PX, WORLD_HEIGHT_PX};
use crate::items::{ItemDefinition, ItemCategory};
use crate::models::TargetType;
use crate::spatial_grid;
use crate::tree;
use crate::stone;
use crate::wooden_storage_box;

// Collision constants
use crate::tree::{TREE_COLLISION_Y_OFFSET, PLAYER_TREE_COLLISION_DISTANCE_SQUARED};
use crate::stone::{STONE_COLLISION_Y_OFFSET, PLAYER_STONE_COLLISION_DISTANCE_SQUARED};

// Table trait imports for database access
use crate::tree::tree as TreeTableTrait;
use crate::stone::stone as StoneTableTrait;
use crate::items::item_definition as ItemDefinitionTableTrait;
use crate::items::inventory_item as InventoryItemTableTrait;
use crate::player as PlayerTableTrait;
use crate::active_equipment::active_equipment as ActiveEquipmentTableTrait;
use crate::dropped_item;
use crate::player_corpse::{PlayerCorpse, PlayerCorpseDespawnSchedule, CORPSE_DESPAWN_DURATION_SECONDS, NUM_CORPSE_SLOTS};
use crate::player_corpse::player_corpse as PlayerCorpseTableTrait;
use crate::player_corpse::player_corpse_despawn_schedule as PlayerCorpseDespawnScheduleTableTrait;
use crate::inventory_management::ItemContainer;
use crate::environment::calculate_chunk_index;
use crate::player_corpse::create_corpse_for_player;
use crate::campfire::{Campfire, CAMPFIRE_COLLISION_RADIUS, CAMPFIRE_COLLISION_Y_OFFSET, campfire as CampfireTableTrait, campfire_processing_schedule as CampfireProcessingScheduleTableTrait};
use crate::wooden_storage_box::{WoodenStorageBox, BOX_COLLISION_RADIUS, BOX_COLLISION_Y_OFFSET, wooden_storage_box as WoodenStorageBoxTableTrait};
use crate::stash::{Stash, stash as StashTableTrait};
use crate::sleeping_bag::{SleepingBag, SLEEPING_BAG_COLLISION_RADIUS, SLEEPING_BAG_COLLISION_Y_OFFSET, sleeping_bag as SleepingBagTableTrait};
use crate::active_effects; // Added for cancelling health regen
// --- Game Balance Constants ---
/// Time in seconds before resources (trees, stones) respawn after being depleted
pub const RESOURCE_RESPAWN_DURATION_SECS: u64 = 300; // 5 minutes
/// Time in milliseconds before a dead player can respawn
pub const RESPAWN_TIME_MS: u64 = 5000; // 5 seconds
/// Distance player is knocked back in PvP
pub const PVP_KNOCKBACK_DISTANCE: f32 = 32.0;

// --- Combat System Types ---

/// Identifiers for specific combat targets
#[derive(Debug, Clone)]
pub enum TargetId {
    Tree(u64),
    Stone(u64),
    Player(Identity),
    Campfire(u32),
    WoodenStorageBox(u32),
    Stash(u32),
    SleepingBag(u32),
}

/// Represents a potential target within attack range
#[derive(Debug, Clone)]
pub struct Target {
    pub target_type: TargetType,
    pub id: TargetId,
    pub distance_sq: f32,
}

/// Result of an attack action
#[derive(Debug, Clone)]
pub struct AttackResult {
    pub hit: bool,
    pub target_type: Option<TargetType>,
    pub resource_granted: Option<(String, u32)>, // (resource_name, amount)
}

// --- Direction & Movement Functions ---

/// Calculates player's forward vector based on direction string
///
/// Returns a normalized 2D vector representing the player's facing direction.
pub fn get_player_forward_vector(direction: &str) -> (f32, f32) {
    match direction {
        "up" => (0.0, -1.0),
        "down" => (0.0, 1.0),
        "left" => (-1.0, 0.0),
        "right" => (1.0, 0.0),
        _ => (0.0, 1.0), // Default to down
    }
}

// --- Target Acquisition Functions ---

/// Finds all potential targets within an attack cone
///
/// Searches for trees, stones, and other players within range of the attacker
/// and within the specified angle cone in front of the player.
/// Returns a vector of targets sorted by distance (closest first).
pub fn find_targets_in_cone(
    ctx: &ReducerContext, 
    player: &Player,
    attack_range: f32,
    attack_angle_degrees: f32
) -> Vec<Target> {
    let mut targets = Vec::new();
    let attack_angle_rad = attack_angle_degrees * PI / 180.0;
    let half_attack_angle_rad = attack_angle_rad / 2.0;
    
    // Get player's forward vector
    let (forward_x, forward_y) = get_player_forward_vector(&player.direction);
    
    // Check trees
    for tree in ctx.db.tree().iter() {
        let dx = tree.pos_x - player.position_x;
        let target_y = tree.pos_y - TREE_COLLISION_Y_OFFSET;
        let dy = target_y - player.position_y;
        let dist_sq = dx * dx + dy * dy;
        
        if dist_sq < (attack_range * attack_range) && dist_sq > 0.0 {
            let distance = dist_sq.sqrt();
            let target_vec_x = dx / distance;
            let target_vec_y = dy / distance;

            // Calculate angle between forward and target vectors
            let dot_product = forward_x * target_vec_x + forward_y * target_vec_y;
            let angle_rad = dot_product.acos();

            if angle_rad <= half_attack_angle_rad {
                targets.push(Target {
                    target_type: TargetType::Tree,
                    id: TargetId::Tree(tree.id),
                    distance_sq: dist_sq,
                });
            }
        }
    }
    
    // Check stones
    for stone in ctx.db.stone().iter() {
        let dx = stone.pos_x - player.position_x;
        let target_y = stone.pos_y - STONE_COLLISION_Y_OFFSET;
        let dy = target_y - player.position_y;
        let dist_sq = dx * dx + dy * dy;
        
        if dist_sq < (attack_range * attack_range) && dist_sq > 0.0 {
            let distance = dist_sq.sqrt();
            let target_vec_x = dx / distance;
            let target_vec_y = dy / distance;

            let dot_product = forward_x * target_vec_x + forward_y * target_vec_y;
            let angle_rad = dot_product.acos();

            if angle_rad <= half_attack_angle_rad {
                targets.push(Target {
                    target_type: TargetType::Stone,
                    id: TargetId::Stone(stone.id),
                    distance_sq: dist_sq,
                });
            }
        }
    }
    
    // Check other players
    for other_player in ctx.db.player().iter() {
        if other_player.identity == player.identity || other_player.is_dead {
            continue;
        }
        
        let dx = other_player.position_x - player.position_x;
        let dy = other_player.position_y - player.position_y;
        let dist_sq = dx * dx + dy * dy;
        
        if dist_sq < (attack_range * attack_range) && dist_sq > 0.0 {
            let distance = dist_sq.sqrt();
            let target_vec_x = dx / distance;
            let target_vec_y = dy / distance;

            let dot_product = forward_x * target_vec_x + forward_y * target_vec_y;
            let angle_rad = dot_product.acos();

            if angle_rad <= half_attack_angle_rad {
                targets.push(Target {
                    target_type: TargetType::Player,
                    id: TargetId::Player(other_player.identity),
                    distance_sq: dist_sq,
                });
            }
        }
    }
    
    // Check campfires
    for campfire_entity in ctx.db.campfire().iter() {
        if campfire_entity.is_destroyed {
            continue;
        }
        let dx = campfire_entity.pos_x - player.position_x;
        let target_y = campfire_entity.pos_y - CAMPFIRE_COLLISION_Y_OFFSET;
        let dy = target_y - player.position_y;
        let dist_sq = dx * dx + dy * dy;

        if dist_sq < (attack_range * attack_range) && dist_sq > 0.0 {
            let distance = dist_sq.sqrt();
            let target_vec_x = dx / distance;
            let target_vec_y = dy / distance;

            let dot_product = forward_x * target_vec_x + forward_y * target_vec_y;
            let angle_rad = dot_product.acos();

            if angle_rad <= half_attack_angle_rad {
                targets.push(Target {
                    target_type: TargetType::Campfire,
                    id: TargetId::Campfire(campfire_entity.id),
                    distance_sq: dist_sq,
                });
            }
        }
    }

    // Check wooden storage boxes
    for box_entity in ctx.db.wooden_storage_box().iter() {
        if box_entity.is_destroyed {
            continue;
        }
        let dx = box_entity.pos_x - player.position_x;
        let target_y = box_entity.pos_y - BOX_COLLISION_Y_OFFSET;
        let dy = target_y - player.position_y;
        let dist_sq = dx * dx + dy * dy;

        if dist_sq < (attack_range * attack_range) && dist_sq > 0.0 {
            let distance = dist_sq.sqrt();
            let target_vec_x = dx / distance;
            let target_vec_y = dy / distance;

            let dot_product = forward_x * target_vec_x + forward_y * target_vec_y;
            let angle_rad = dot_product.acos();

            if angle_rad <= half_attack_angle_rad {
                targets.push(Target {
                    target_type: TargetType::WoodenStorageBox,
                    id: TargetId::WoodenStorageBox(box_entity.id),
                    distance_sq: dist_sq,
                });
            }
        }
    }

    // Check stashes
    for stash_entity in ctx.db.stash().iter() {
        if stash_entity.is_destroyed || stash_entity.is_hidden {
            continue; // Skip destroyed or hidden stashes
        }
        // Treat stash as a point target for now, or use a very small radius if needed for cone
        let dx = stash_entity.pos_x - player.position_x;
        let dy = stash_entity.pos_y - player.position_y; // No Y-offset for point target
        let dist_sq = dx * dx + dy * dy;

        if dist_sq < (attack_range * attack_range) && dist_sq > 0.0 {
            let distance = dist_sq.sqrt();
            let target_vec_x = dx / distance;
            let target_vec_y = dy / distance;

            let dot_product = forward_x * target_vec_x + forward_y * target_vec_y;
            let angle_rad = dot_product.acos();

            if angle_rad <= half_attack_angle_rad {
                targets.push(Target {
                    target_type: TargetType::Stash,
                    id: TargetId::Stash(stash_entity.id),
                    distance_sq: dist_sq,
                });
            }
        }
    }

    // Check sleeping bags
    for bag_entity in ctx.db.sleeping_bag().iter() {
        if bag_entity.is_destroyed {
            continue;
        }
        let dx = bag_entity.pos_x - player.position_x;
        let target_y = bag_entity.pos_y - SLEEPING_BAG_COLLISION_Y_OFFSET;
        let dy = target_y - player.position_y;
        let dist_sq = dx * dx + dy * dy;

        if dist_sq < (attack_range * attack_range) && dist_sq > 0.0 {
            let distance = dist_sq.sqrt();
            let target_vec_x = dx / distance;
            let target_vec_y = dy / distance;

            let dot_product = forward_x * target_vec_x + forward_y * target_vec_y;
            let angle_rad = dot_product.acos();

            if angle_rad <= half_attack_angle_rad {
                targets.push(Target {
                    target_type: TargetType::SleepingBag,
                    id: TargetId::SleepingBag(bag_entity.id),
                    distance_sq: dist_sq,
                });
            }
        }
    }
    
    // Sort by distance (closest first)
    targets.sort_by(|a, b| a.distance_sq.partial_cmp(&b.distance_sq).unwrap());
    
    targets
}

/// Determines the best target based on weapon type and available targets
///
/// Different weapons have different priorities (e.g., pickaxes prioritize stones).
/// This function selects the appropriate target based on the weapon and available targets.
pub fn find_best_target(targets: &[Target], item_def: &ItemDefinition) -> Option<Target> {
    if targets.is_empty() {
        return None;
    }
    
    // 1. Check for primary target type
    if let Some(primary_type) = item_def.primary_target_type {
        if let Some(target) = targets.iter().find(|t| t.target_type == primary_type) {
            return Some(target.clone());
        }
    }

    // 2. Check for secondary target type
    if let Some(secondary_type) = item_def.secondary_target_type {
        if let Some(target) = targets.iter().find(|t| t.target_type == secondary_type) {
            return Some(target.clone());
        }
    }

    // 3. If tool has PvP damage, check for Player targets if no resource target was found
    if item_def.pvp_damage_min.is_some() || item_def.pvp_damage_max.is_some() { // Check if any PvP damage is defined
        if let Some(player_target) = targets.iter().find(|t| t.target_type == TargetType::Player) {
            // Only return player if primary/secondary types weren't found or aren't defined
            if item_def.primary_target_type.is_none() && item_def.secondary_target_type.is_none() {
                return Some(player_target.clone());
            } else if item_def.primary_target_type.is_some() && targets.iter().find(|t| t.target_type == item_def.primary_target_type.unwrap()).is_none() &&
                      item_def.secondary_target_type.is_some() && targets.iter().find(|t| t.target_type == item_def.secondary_target_type.unwrap()).is_none() {
                 return Some(player_target.clone()); // Primary & secondary not found
            } else if item_def.primary_target_type.is_some() && targets.iter().find(|t| t.target_type == item_def.primary_target_type.unwrap()).is_none() && item_def.secondary_target_type.is_none(){
                return Some(player_target.clone()); // Primary not found, no secondary defined
            } else if item_def.secondary_target_type.is_some() && targets.iter().find(|t| t.target_type == item_def.secondary_target_type.unwrap()).is_none() && item_def.primary_target_type.is_none(){
                 return Some(player_target.clone()); // Secondary not found, no primary defined
            }
        }
    }

    // 4. If no specific preferred target found, return the closest target of any type.
    // This allows hitting unintended targets, and calculate_damage_and_yield will determine effect (possibly zero).
    return targets.first().cloned();
}

// --- Resource & Damage Functions ---

/// Grants resource items to a player based on what they hit
///
/// Looks up the proper resource definition and adds it to the player's inventory.
pub fn grant_resource(
    ctx: &ReducerContext, 
    player_id: Identity, 
    resource_name: &str, 
    amount: u32
) -> Result<(), String> {
    let item_defs = ctx.db.item_definition();
    let resource_def = item_defs.iter()
        .find(|def| def.name == resource_name)
        .ok_or_else(|| format!("{} item definition not found.", resource_name))?;
        
    crate::items::add_item_to_player_inventory(ctx, player_id, resource_def.id, amount)
        .map(|_| ())
        .map_err(|e| format!("Failed to grant {} to player: {}", resource_name, e))
}

/// Calculates damage amount based on item definition, target type, and RNG.
/// Returns a random f32 damage value within the defined min/max range for the interaction.
pub fn calculate_damage_and_yield(
    item_def: &ItemDefinition, 
    target_type: TargetType,
    rng: &mut impl Rng,
) -> (f32, u32, String) {
    let mut damage_min = 0u32;
    let mut damage_max = 0u32;
    let mut yield_min = 0u32;
    let mut yield_max = 0u32;
    let mut resource_name = "None".to_string(); // Default to None, especially for PvP

    if target_type == TargetType::Player {
        damage_min = item_def.pvp_damage_min.unwrap_or(0);
        damage_max = item_def.pvp_damage_max.unwrap_or(damage_min); 
        yield_min = 0; // No yield from players
        yield_max = 0;
        // resource_name is already "None"
    } else if target_type == TargetType::Campfire || target_type == TargetType::WoodenStorageBox {
        // For structures, use PvP damage as a baseline if specific structure damage isn't defined.
        // Ideally, we would add specific fields like `campfire_damage_min`, etc., to ItemDefinition.
        damage_min = item_def.pvp_damage_min.unwrap_or(0); // Example: Use PvP damage for now
        damage_max = item_def.pvp_damage_max.unwrap_or(damage_min);
        yield_min = 0; // No resource yield from destroying structures directly
        yield_max = 0;
        resource_name = "None".to_string();
    } else if target_type == TargetType::Stash || target_type == TargetType::SleepingBag {
        // For stashes and sleeping bags, use PvP damage as a baseline.
        damage_min = item_def.pvp_damage_min.unwrap_or(0);
        damage_max = item_def.pvp_damage_max.unwrap_or(damage_min);
        yield_min = 0; // No resource yield
        yield_max = 0;
        resource_name = "None".to_string();
    } else if Some(target_type) == item_def.primary_target_type {
        // Target matches the item's primary target type
        damage_min = item_def.primary_target_damage_min.unwrap_or(0);
        damage_max = item_def.primary_target_damage_max.unwrap_or(damage_min);
        yield_min = item_def.primary_target_yield_min.unwrap_or(0);
        yield_max = item_def.primary_target_yield_max.unwrap_or(yield_min);
        resource_name = item_def.primary_yield_resource_name.clone().unwrap_or_else(|| "None".to_string());
    } else if Some(target_type) == item_def.secondary_target_type {
        // Target matches the item's secondary target type
        damage_min = item_def.secondary_target_damage_min.unwrap_or(0);
        damage_max = item_def.secondary_target_damage_max.unwrap_or(damage_min);
        yield_min = item_def.secondary_target_yield_min.unwrap_or(0);
        yield_max = item_def.secondary_target_yield_max.unwrap_or(yield_min);
        resource_name = item_def.secondary_yield_resource_name.clone().unwrap_or_else(|| "None".to_string());
    } else {
        // Tool is not designed for this target type (e.g., trying to hit a tree with something that has no tree affinity)
        // Fallback to very low/no damage and no yield.
        // If it has PvP damage defined, use that as a last resort even for non-player, otherwise 0.
        damage_min = item_def.pvp_damage_min.unwrap_or(0); // Could be 0 if not a weapon
        damage_max = item_def.pvp_damage_max.unwrap_or(damage_min);
        yield_min = 0;
        yield_max = 0;
        // resource_name is already "None"
        log::warn!(
            "Item '{}' used against unhandled target type '{:?}'. Primary: {:?}, Secondary: {:?}. Defaulting to minimal/no effect.", 
            item_def.name, 
            target_type,
            item_def.primary_target_type,
            item_def.secondary_target_type
        );
    }

    // Ensure max is not less than min
    if damage_max < damage_min { damage_max = damage_min; }
    if yield_max < yield_min { yield_max = yield_min; }

    let mut final_damage = if damage_min == damage_max {
        damage_min as f32
    } else {
        rng.gen_range(damage_min..=damage_max) as f32
    };

    let final_yield = if yield_min == yield_max {
        yield_min
    } else {
        rng.gen_range(yield_min..=yield_max)
    };
    
    // Apply PVP multiplier if target is a player. This is now the authoritative damage for PvP.
    if target_type == TargetType::Player {
        let pvp_min = item_def.pvp_damage_min.unwrap_or(0); // Default to 0 if not specified
        let pvp_max = item_def.pvp_damage_max.unwrap_or(pvp_min);
        let base_pvp_damage = if pvp_min == pvp_max { pvp_min } else { rng.gen_range(pvp_min..=pvp_max) };
        final_damage = base_pvp_damage as f32;
        // Yield and resource_name for PvP are already 0 and "None"
        return (final_damage, 0, "None".to_string());
    }

    (final_damage, final_yield, resource_name)
}

/// Applies damage to a tree and handles destruction/respawning
///
/// Reduces tree health, grants wood resources, and schedules respawn if depleted.
pub fn damage_tree(
    ctx: &ReducerContext, 
    attacker_id: Identity, 
    tree_id: u64, 
    damage: f32,
    yield_amount: u32,
    resource_name_to_grant: &str,
    timestamp: Timestamp
) -> Result<AttackResult, String> {
    let mut tree = ctx.db.tree().id().find(tree_id)
        .ok_or_else(|| "Target tree disappeared".to_string())?;
    
    let old_health = tree.health;
    tree.health = tree.health.saturating_sub(damage as u32);
    tree.last_hit_time = Some(timestamp);
    
    log::info!("Player {:?} hit Tree {} for {:.1} damage. Health: {} -> {}", 
           attacker_id, tree_id, damage, old_health, tree.health);
    
    let resource_result = grant_resource(ctx, attacker_id, resource_name_to_grant, yield_amount);
    
    if let Err(e) = resource_result {
        log::error!("Failed to grant {} to player {:?}: {}", resource_name_to_grant, attacker_id, e);
    }
    
    if tree.health == 0 {
        log::info!("Tree {} destroyed by Player {:?}. Scheduling respawn.", tree_id, attacker_id);
        let respawn_time = timestamp + spacetimedb::TimeDuration::from(Duration::from_secs(RESOURCE_RESPAWN_DURATION_SECS));
        tree.respawn_at = Some(respawn_time);
    }
    
    ctx.db.tree().id().update(tree);
    
    Ok(AttackResult {
        hit: true,
        target_type: Some(TargetType::Tree),
        resource_granted: Some((resource_name_to_grant.to_string(), yield_amount)),
    })
}

/// Applies damage to a stone and handles destruction/respawning
///
/// Reduces stone health, grants stone resources, and schedules respawn if depleted.
pub fn damage_stone(
    ctx: &ReducerContext, 
    attacker_id: Identity, 
    stone_id: u64, 
    damage: f32,
    yield_amount: u32,
    resource_name_to_grant: &str,
    timestamp: Timestamp
) -> Result<AttackResult, String> {
    let mut stone = ctx.db.stone().id().find(stone_id)
        .ok_or_else(|| "Target stone disappeared".to_string())?;
    
    let old_health = stone.health;
    stone.health = stone.health.saturating_sub(damage as u32);
    stone.last_hit_time = Some(timestamp);
    
    log::info!("Player {:?} hit Stone {} for {:.1} damage. Health: {} -> {}", 
           attacker_id, stone_id, damage, old_health, stone.health);
    
    let resource_result = grant_resource(ctx, attacker_id, resource_name_to_grant, yield_amount);
    
    if let Err(e) = resource_result {
        log::error!("Failed to grant {} to player {:?}: {}", resource_name_to_grant, attacker_id, e);
    }
    
    if stone.health == 0 {
        log::info!("Stone {} depleted by Player {:?}. Scheduling respawn.", stone_id, attacker_id);
        let respawn_time = timestamp + spacetimedb::TimeDuration::from(Duration::from_secs(RESOURCE_RESPAWN_DURATION_SECS));
        stone.respawn_at = Some(respawn_time);
    }
    
    ctx.db.stone().id().update(stone);
    
    Ok(AttackResult {
        hit: true,
        target_type: Some(TargetType::Stone),
        resource_granted: Some((resource_name_to_grant.to_string(), yield_amount)),
    })
}

/// Applies damage to another player and handles death
///
/// Reduces player health, handles death state, creates a corpse, and schedules despawn.
pub fn damage_player(
    ctx: &ReducerContext, 
    attacker_id: Identity, 
    target_id: Identity, 
    damage: f32, 
    item_name: &str,
    timestamp: Timestamp
) -> Result<AttackResult, String> {
    log::debug!("Attempting to damage player {:?} from attacker {:?} with item {}", target_id, attacker_id, item_name);
    let players = ctx.db.player();
    let active_equipment_table = ctx.db.active_equipment();
    let inventory_items_table = ctx.db.inventory_item();
    let player_corpse_table = ctx.db.player_corpse();
    let player_corpse_schedule_table = ctx.db.player_corpse_despawn_schedule();
    let trees_table = ctx.db.tree();
    let stones_table = ctx.db.stone();
    let wooden_storage_boxes_table = ctx.db.wooden_storage_box();

    let attacker_player_opt = players.identity().find(&attacker_id);
    let mut target_player = players.identity().find(&target_id)
        .ok_or_else(|| format!("Target player {:?} not found", target_id))?;

    // --- BEGIN KNOCKBACK LOGIC (for target) ---
    if let Some(ref attacker_player) = attacker_player_opt { // MODIFIED: Changed to `ref attacker_player` to borrow
        // Only apply knockback if the target is currently alive and was hit by another player
        if !target_player.is_dead && attacker_player.identity != target_player.identity {
            let dx = target_player.position_x - attacker_player.position_x;
            let dy = target_player.position_y - attacker_player.position_y;
            let distance = (dx * dx + dy * dy).sqrt();

            if distance > 0.0 { // Avoid division by zero and self-knockback issues
                let norm_dx = dx / distance;
                let norm_dy = dy / distance;

                target_player.position_x += norm_dx * PVP_KNOCKBACK_DISTANCE;
                target_player.position_y += norm_dy * PVP_KNOCKBACK_DISTANCE;

                log::debug!("Player {:?} knocked back by ({:.1}, {:.1}) from attacker {:?}",
                         target_id, norm_dx * PVP_KNOCKBACK_DISTANCE, norm_dy * PVP_KNOCKBACK_DISTANCE, attacker_id);

                // --- BEGIN COLLISION RESOLUTION FOR KNOCKBACK ---
                let mut resolved_x = target_player.position_x.max(PLAYER_RADIUS).min(WORLD_WIDTH_PX - PLAYER_RADIUS);
                let mut resolved_y = target_player.position_y.max(PLAYER_RADIUS).min(WORLD_HEIGHT_PX - PLAYER_RADIUS);

                let mut grid = spatial_grid::SpatialGrid::new();
                // Populate grid with relevant entities (players, trees, stones, boxes)
                // Note: This reuses some logic from lib.rs update_player_position
                // We only need players, trees, stones, and boxes for knockback collision.
                for p_other in players.iter() {
                    if p_other.identity != target_id && !p_other.is_dead { // Exclude self and dead players
                        grid.add_entity(spatial_grid::EntityType::Player(p_other.identity), p_other.position_x, p_other.position_y);
                    }
                }
                for tree_entity in trees_table.iter() {
                    if tree_entity.health > 0 {
                        grid.add_entity(spatial_grid::EntityType::Tree(tree_entity.id), tree_entity.pos_x, tree_entity.pos_y - TREE_COLLISION_Y_OFFSET);
                    }
                }
                for stone_entity in stones_table.iter() {
                    if stone_entity.health > 0 {
                        grid.add_entity(spatial_grid::EntityType::Stone(stone_entity.id), stone_entity.pos_x, stone_entity.pos_y - STONE_COLLISION_Y_OFFSET);
                    }
                }
                for box_entity in wooden_storage_boxes_table.iter() {
                     if !box_entity.is_destroyed {
                        grid.add_entity(spatial_grid::EntityType::WoodenStorageBox(box_entity.id), box_entity.pos_x, box_entity.pos_y - crate::wooden_storage_box::BOX_COLLISION_Y_OFFSET);
                    }
                }


                let resolution_iterations = 5;
                let epsilon = 0.01;

                for _iter in 0..resolution_iterations {
                    let mut overlap_found_in_iter = false;
                    let nearby_entities_resolve = grid.get_entities_in_range(resolved_x, resolved_y);

                    for entity in &nearby_entities_resolve {
                        match entity {
                            spatial_grid::EntityType::Player(other_identity) => {
                                // We already filter out self and dead players when populating the grid
                                if let Some(other_player_data) = players.identity().find(other_identity) {
                                     let odx = resolved_x - other_player_data.position_x;
                                     let ody = resolved_y - other_player_data.position_y;
                                     let odist_sq = odx * odx + ody * ody;
                                     let min_dist_players = PLAYER_RADIUS * 2.0;
                                     let min_dist_sq_players = min_dist_players * min_dist_players;
                                     if odist_sq < min_dist_sq_players && odist_sq > 0.0 {
                                         overlap_found_in_iter = true;
                                         let odistance = odist_sq.sqrt();
                                         let ooverlap = min_dist_players - odistance;
                                         let push_amount = (ooverlap / 2.0) + epsilon;
                                         resolved_x += (odx / odistance) * push_amount;
                                         resolved_y += (ody / odistance) * push_amount;
                                     }
                                }
                            },
                            spatial_grid::EntityType::Tree(tree_id_ref) => {
                                if let Some(tree_data) = trees_table.id().find(tree_id_ref) {
                                    // Tree collision logic from lib.rs
                                    let tree_collision_y_val = tree_data.pos_y - TREE_COLLISION_Y_OFFSET;
                                    let tdx = resolved_x - tree_data.pos_x;
                                    let tdy = resolved_y - tree_collision_y_val;
                                    let tdist_sq = tdx * tdx + tdy * tdy;
                                    let min_dist_tree = PLAYER_RADIUS + tree::TREE_TRUNK_RADIUS;
                                    let min_dist_sq_tree = min_dist_tree * min_dist_tree;
                                    if tdist_sq < min_dist_sq_tree && tdist_sq > 0.0 {
                                        overlap_found_in_iter = true;
                                        let tdistance = tdist_sq.sqrt();
                                        let toverlap = (min_dist_tree - tdistance) + epsilon;
                                        resolved_x += (tdx / tdistance) * toverlap;
                                        resolved_y += (tdy / tdistance) * toverlap;
                                    }
                                }
                            },
                            spatial_grid::EntityType::Stone(stone_id_ref) => {
                                if let Some(stone_data) = stones_table.id().find(stone_id_ref) {
                                    // Stone collision logic from lib.rs
                                    let stone_collision_y_val = stone_data.pos_y - STONE_COLLISION_Y_OFFSET;
                                    let sdx = resolved_x - stone_data.pos_x;
                                    let sdy = resolved_y - stone_collision_y_val;
                                    let sdist_sq = sdx * sdx + sdy * sdy;
                                    let min_dist_stone = PLAYER_RADIUS + stone::STONE_RADIUS;
                                    let min_dist_sq_stone = min_dist_stone * min_dist_stone;
                                    if sdist_sq < min_dist_sq_stone && sdist_sq > 0.0 {
                                        overlap_found_in_iter = true;
                                        let sdistance = sdist_sq.sqrt();
                                        let soverlap = (min_dist_stone - sdistance) + epsilon;
                                        resolved_x += (sdx / sdistance) * soverlap;
                                        resolved_y += (sdy / sdistance) * soverlap;
                                    }
                                }
                            },
                            spatial_grid::EntityType::WoodenStorageBox(box_id_ref) => {
                                if let Some(box_data) = wooden_storage_boxes_table.id().find(box_id_ref) {
                                    let box_collision_y_val = box_data.pos_y - crate::wooden_storage_box::BOX_COLLISION_Y_OFFSET;
                                    let bdx = resolved_x - box_data.pos_x;
                                    let bdy = resolved_y - box_collision_y_val;
                                    let bdist_sq = bdx*bdx + bdy*bdy;
                                    let min_dist_box = PLAYER_RADIUS + crate::wooden_storage_box::BOX_COLLISION_RADIUS;
                                    let min_dist_sq_box = min_dist_box * min_dist_box;
                                    if bdist_sq < min_dist_sq_box && bdist_sq > 0.0 {
                                        overlap_found_in_iter = true;
                                        let bdistance = bdist_sq.sqrt();
                                        let boverlap = (min_dist_box - bdistance) + epsilon;
                                        resolved_x += (bdx / bdistance) * boverlap;
                                        resolved_y += (bdy / bdistance) * boverlap;
                                    }
                                }
                            },
                            _ => {} // Ignore other entity types for knockback collision
                        }
                    }

                    resolved_x = resolved_x.max(PLAYER_RADIUS).min(WORLD_WIDTH_PX - PLAYER_RADIUS);
                    resolved_y = resolved_y.max(PLAYER_RADIUS).min(WORLD_HEIGHT_PX - PLAYER_RADIUS);

                    if !overlap_found_in_iter {
                        break;
                    }
                }
                target_player.position_x = resolved_x;
                target_player.position_y = resolved_y;
                log::debug!("Player {:?} final knockback position after collision: ({:.1}, {:.1})",
                         target_id, target_player.position_x, target_player.position_y);
                // --- END COLLISION RESOLUTION FOR KNOCKBACK ---
            }
        }
    }
    // --- END KNOCKBACK LOGIC ---

    // --- BEGIN ATTACKER RECOIL LOGIC ---
    if let Some(mut attacker_player_data) = attacker_player_opt {
        // Check if attacker is not the target and is alive (should always be true for an attack)
        if attacker_player_data.identity != target_player.identity && !attacker_player_data.is_dead {
            let recoil_dx = attacker_player_data.position_x - target_player.position_x; // Vector from target to attacker
            let recoil_dy = attacker_player_data.position_y - target_player.position_y; // Vector from target to attacker
            let recoil_distance_mag = (recoil_dx * recoil_dx + recoil_dy * recoil_dy).sqrt();

            if recoil_distance_mag > 0.0 {
                let norm_recoil_dx = recoil_dx / recoil_distance_mag;
                let norm_recoil_dy = recoil_dy / recoil_distance_mag;
                let attacker_recoil_amount = PVP_KNOCKBACK_DISTANCE / 3.0; // Attacker recoils less

                attacker_player_data.position_x += norm_recoil_dx * attacker_recoil_amount;
                attacker_player_data.position_y += norm_recoil_dy * attacker_recoil_amount;

                log::debug!("Attacker {:?} recoiled by ({:.1}, {:.1}) after hitting {:?}",
                         attacker_id, norm_recoil_dx * attacker_recoil_amount, norm_recoil_dy * attacker_recoil_amount, target_id);

                // --- COLLISION RESOLUTION FOR ATTACKER RECOIL ---
                let mut resolved_attacker_x = attacker_player_data.position_x.max(PLAYER_RADIUS).min(WORLD_WIDTH_PX - PLAYER_RADIUS);
                let mut resolved_attacker_y = attacker_player_data.position_y.max(PLAYER_RADIUS).min(WORLD_HEIGHT_PX - PLAYER_RADIUS);

                let mut attacker_grid = spatial_grid::SpatialGrid::new();
                // Populate grid (excluding the attacker itself and the target, as target's position is already being updated)
                for p_other in players.iter() {
                    if p_other.identity != attacker_id && p_other.identity != target_id && !p_other.is_dead {
                        attacker_grid.add_entity(spatial_grid::EntityType::Player(p_other.identity), p_other.position_x, p_other.position_y);
                    }
                }
                for tree_entity in trees_table.iter() {
                    if tree_entity.health > 0 {
                        attacker_grid.add_entity(spatial_grid::EntityType::Tree(tree_entity.id), tree_entity.pos_x, tree_entity.pos_y - TREE_COLLISION_Y_OFFSET);
                    }
                }
                for stone_entity in stones_table.iter() {
                    if stone_entity.health > 0 {
                        attacker_grid.add_entity(spatial_grid::EntityType::Stone(stone_entity.id), stone_entity.pos_x, stone_entity.pos_y - STONE_COLLISION_Y_OFFSET);
                    }
                }
                for box_entity in wooden_storage_boxes_table.iter() {
                    if !box_entity.is_destroyed {
                        attacker_grid.add_entity(spatial_grid::EntityType::WoodenStorageBox(box_entity.id), box_entity.pos_x, box_entity.pos_y - crate::wooden_storage_box::BOX_COLLISION_Y_OFFSET);
                    }
                }

                let resolution_iterations = 5;
                let epsilon = 0.01;

                for _iter in 0..resolution_iterations {
                    let mut overlap_found_in_iter = false;
                    let nearby_entities_resolve = attacker_grid.get_entities_in_range(resolved_attacker_x, resolved_attacker_y);

                    for entity in &nearby_entities_resolve {
                        match entity {
                            spatial_grid::EntityType::Player(other_identity) => {
                                if let Some(other_player_data) = players.identity().find(other_identity) {
                                     let odx = resolved_attacker_x - other_player_data.position_x;
                                     let ody = resolved_attacker_y - other_player_data.position_y;
                                     let odist_sq = odx * odx + ody * ody;
                                     let min_dist_players = PLAYER_RADIUS * 2.0;
                                     let min_dist_sq_players = min_dist_players * min_dist_players;
                                     if odist_sq < min_dist_sq_players && odist_sq > 0.0 {
                                         overlap_found_in_iter = true;
                                         let odistance = odist_sq.sqrt();
                                         let ooverlap = min_dist_players - odistance;
                                         let push_amount = (ooverlap / 2.0) + epsilon;
                                         resolved_attacker_x += (odx / odistance) * push_amount;
                                         resolved_attacker_y += (ody / odistance) * push_amount;
                                     }
                                }
                            },
                            spatial_grid::EntityType::Tree(tree_id_ref) => {
                                if let Some(tree_data) = trees_table.id().find(tree_id_ref) {
                                    let tree_collision_y_val = tree_data.pos_y - TREE_COLLISION_Y_OFFSET;
                                    let tdx = resolved_attacker_x - tree_data.pos_x;
                                    let tdy = resolved_attacker_y - tree_collision_y_val;
                                    let tdist_sq = tdx * tdx + tdy * tdy;
                                    let min_dist_tree = PLAYER_RADIUS + tree::TREE_TRUNK_RADIUS;
                                    let min_dist_sq_tree = min_dist_tree * min_dist_tree;
                                    if tdist_sq < min_dist_sq_tree && tdist_sq > 0.0 {
                                        overlap_found_in_iter = true;
                                        let tdistance = tdist_sq.sqrt();
                                        let toverlap = (min_dist_tree - tdistance) + epsilon;
                                        resolved_attacker_x += (tdx / tdistance) * toverlap;
                                        resolved_attacker_y += (tdy / tdistance) * toverlap;
                                    }
                                }
                            },
                            spatial_grid::EntityType::Stone(stone_id_ref) => {
                                if let Some(stone_data) = stones_table.id().find(stone_id_ref) {
                                    let stone_collision_y_val = stone_data.pos_y - STONE_COLLISION_Y_OFFSET;
                                    let sdx = resolved_attacker_x - stone_data.pos_x;
                                    let sdy = resolved_attacker_y - stone_collision_y_val;
                                    let sdist_sq = sdx * sdx + sdy * sdy;
                                    let min_dist_stone = PLAYER_RADIUS + stone::STONE_RADIUS;
                                    let min_dist_sq_stone = min_dist_stone * min_dist_stone;
                                    if sdist_sq < min_dist_sq_stone && sdist_sq > 0.0 {
                                        overlap_found_in_iter = true;
                                        let sdistance = sdist_sq.sqrt();
                                        let soverlap = (min_dist_stone - sdistance) + epsilon;
                                        resolved_attacker_x += (sdx / sdistance) * soverlap;
                                        resolved_attacker_y += (sdy / sdistance) * soverlap;
                                    }
                                }
                            },
                            spatial_grid::EntityType::WoodenStorageBox(box_id_ref) => {
                                if let Some(box_data) = wooden_storage_boxes_table.id().find(box_id_ref) {
                                    let box_collision_y_val = box_data.pos_y - crate::wooden_storage_box::BOX_COLLISION_Y_OFFSET;
                                    let bdx = resolved_attacker_x - box_data.pos_x;
                                    let bdy = resolved_attacker_y - box_collision_y_val;
                                    let bdist_sq = bdx*bdx + bdy*bdy;
                                    let min_dist_box = PLAYER_RADIUS + crate::wooden_storage_box::BOX_COLLISION_RADIUS;
                                    let min_dist_sq_box = min_dist_box * min_dist_box;
                                    if bdist_sq < min_dist_sq_box && bdist_sq > 0.0 {
                                        overlap_found_in_iter = true;
                                        let bdistance = bdist_sq.sqrt();
                                        let boverlap = (min_dist_box - bdistance) + epsilon;
                                        resolved_attacker_x += (bdx / bdistance) * boverlap;
                                        resolved_attacker_y += (bdy / bdistance) * boverlap;
                                    }
                                }
                            },
                            _ => {} 
                        }
                    }

                    resolved_attacker_x = resolved_attacker_x.max(PLAYER_RADIUS).min(WORLD_WIDTH_PX - PLAYER_RADIUS);
                    resolved_attacker_y = resolved_attacker_y.max(PLAYER_RADIUS).min(WORLD_HEIGHT_PX - PLAYER_RADIUS);

                    if !overlap_found_in_iter {
                        break;
                    }
                }
                attacker_player_data.position_x = resolved_attacker_x;
                attacker_player_data.position_y = resolved_attacker_y;
                attacker_player_data.last_update = timestamp; // Update attacker's timestamp
                players.identity().update(attacker_player_data);
                log::debug!("Attacker {:?} final recoil position after collision: ({:.1}, {:.1})",
                         attacker_id, resolved_attacker_x, resolved_attacker_y);
                // --- END COLLISION RESOLUTION FOR ATTACKER RECOIL ---
            }
        }
    }
    // --- END ATTACKER RECOIL LOGIC ---

    let old_health = target_player.health;
    let new_health = (target_player.health - damage).max(0.0);
    target_player.health = new_health;
    target_player.last_hit_time = Some(timestamp);
    
    // === ADDED: Cancel any active health regen effects ===
    active_effects::cancel_health_regen_effects(ctx, target_id);
    // ====================================================

    log::info!("Player {:?} hit Player {:?} with {} for {:.1} damage. Health: {:.1} -> {:.1}",
           attacker_id, target_id, item_name, damage, old_health, new_health);
    
    if new_health <= 0.0 && !target_player.is_dead {
        log::info!("Player {} ({:?}) died from combat (Attacker: {:?}, Health: {:.1}).",
                 target_player.username, target_id, attacker_id, new_health);
        target_player.is_dead = true;
        target_player.death_timestamp = Some(timestamp);
        target_player.last_update = timestamp;

        match crate::active_equipment::clear_active_item_reducer(ctx, target_player.identity) {
            Ok(_) => log::info!("[PlayerDeath] Active item cleared for dying player {}", target_player.identity),
            Err(e) => log::error!("[PlayerDeath] Failed to clear active item for dying player {}: {}", target_player.identity, e),
        }

        match create_corpse_for_player(ctx, &target_player) {
            Ok(corpse_id) => {
                log::info!("Successfully created corpse {} via combat death for player {:?}", corpse_id, target_id);
                if let Some(active_equip) = ctx.db.active_equipment().player_identity().find(&target_id) {
                    if active_equip.equipped_item_instance_id.is_some() {
                        match crate::active_equipment::clear_active_item_reducer(ctx, target_id) {
                            Ok(_) => log::info!("[CombatDeath] Active item cleared for target {}", target_id),
                            Err(e) => log::error!("[CombatDeath] Failed to clear active item for target {}: {}", target_id, e),
                        }
                    }
                }
            }
            Err(e) => {
                log::error!("Failed to create corpse via combat death for player {:?}: {}", target_id, e);
            }
        }
        players.identity().update(target_player.clone());
        log::info!("Player {:?} marked as dead.", target_id);

    } else if new_health > 0.0 {
        players.identity().update(target_player);
    }

    Ok(AttackResult {
        hit: true,
        target_type: Some(TargetType::Player),
        resource_granted: None,
    })
}

/// Applies damage to a campfire and handles destruction/item scattering
pub fn damage_campfire(
    ctx: &ReducerContext,
    attacker_id: Identity,
    campfire_id: u32,
    damage: f32,
    timestamp: Timestamp,
    rng: &mut impl Rng // Added RNG for item scattering
) -> Result<AttackResult, String> {
    let mut campfires_table = ctx.db.campfire();
    let mut campfire = campfires_table.id().find(campfire_id)
        .ok_or_else(|| format!("Target campfire {} disappeared", campfire_id))?;

    if campfire.is_destroyed {
        return Ok(AttackResult { hit: false, target_type: Some(TargetType::Campfire), resource_granted: None });
    }

    let old_health = campfire.health;
    campfire.health = (campfire.health - damage).max(0.0);
    campfire.last_hit_time = Some(timestamp);

    log::info!(
        "Player {:?} hit Campfire {} for {:.1} damage. Health: {:.1} -> {:.1}",
        attacker_id, campfire_id, damage, old_health, campfire.health
    );

    if campfire.health <= 0.0 {
        campfire.is_destroyed = true;
        campfire.destroyed_at = Some(timestamp);
        // Scatter items
        let mut items_to_drop: Vec<(u64, u32)> = Vec::new(); // (item_def_id, quantity)
        for i in 0..crate::campfire::NUM_FUEL_SLOTS {
            if let (Some(instance_id), Some(def_id)) = (campfire.get_slot_instance_id(i as u8), campfire.get_slot_def_id(i as u8)) {
                if let Some(item) = ctx.db.inventory_item().instance_id().find(instance_id) {
                    items_to_drop.push((def_id, item.quantity));
                    // Delete the InventoryItem from the central table
                    ctx.db.inventory_item().instance_id().delete(instance_id);
                }
                campfire.set_slot(i as u8, None, None); // Clear slot in campfire struct (though it's about to be deleted)
            }
        }

        // Update the campfire one last time to ensure is_destroyed and destroyed_at are sent to client
        campfires_table.id().update(campfire.clone()); 
        // Then immediately delete the campfire entity itself
        campfires_table.id().delete(campfire_id);

        log::info!(
            "Campfire {} destroyed by player {:?}. Dropping items.",
            campfire_id, attacker_id
        );

        // Scatter collected items around the campfire's location
        for (item_def_id, quantity) in items_to_drop {
            // Spawn slightly offset from campfire center
            let offset_x = (rng.gen::<f32>() - 0.5) * 2.0 * 20.0; // Spread within +/- 20px
            let offset_y = (rng.gen::<f32>() - 0.5) * 2.0 * 20.0;
            let drop_pos_x = campfire.pos_x + offset_x;
            let drop_pos_y = campfire.pos_y + offset_y;

            match dropped_item::create_dropped_item_entity(ctx, item_def_id, quantity, drop_pos_x, drop_pos_y) {
                Ok(_) => log::debug!("Dropped {} of item_def_id {} from destroyed campfire {}", quantity, item_def_id, campfire_id),
                Err(e) => log::error!("Failed to drop item_def_id {}: {}", item_def_id, e),
            }
        }

    } else {
        // Campfire still has health, just update it
        campfires_table.id().update(campfire);
    }

    Ok(AttackResult {
        hit: true,
        target_type: Some(TargetType::Campfire),
        resource_granted: None,
    })
}

/// Applies damage to a wooden storage box and handles destruction/item scattering
pub fn damage_wooden_storage_box(
    ctx: &ReducerContext,
    attacker_id: Identity,
    box_id: u32,
    damage: f32,
    timestamp: Timestamp,
    rng: &mut impl Rng // Added RNG for item scattering
) -> Result<AttackResult, String> {
    let mut boxes_table = ctx.db.wooden_storage_box();
    let mut wooden_box = boxes_table.id().find(box_id)
        .ok_or_else(|| format!("Target wooden storage box {} disappeared", box_id))?;

    if wooden_box.is_destroyed {
        return Ok(AttackResult { hit: false, target_type: Some(TargetType::WoodenStorageBox), resource_granted: None });
    }

    let old_health = wooden_box.health;
    wooden_box.health = (wooden_box.health - damage).max(0.0);
    wooden_box.last_hit_time = Some(timestamp);

    log::info!(
        "Player {:?} hit WoodenStorageBox {} for {:.1} damage. Health: {:.1} -> {:.1}",
        attacker_id, box_id, damage, old_health, wooden_box.health
    );

    if wooden_box.health <= 0.0 {
        wooden_box.is_destroyed = true;
        wooden_box.destroyed_at = Some(timestamp);

        let mut items_to_drop: Vec<(u64, u32)> = Vec::new();
        for i in 0..crate::wooden_storage_box::NUM_BOX_SLOTS {
            if let (Some(instance_id), Some(def_id)) = (wooden_box.get_slot_instance_id(i as u8), wooden_box.get_slot_def_id(i as u8)) {
                if let Some(item) = ctx.db.inventory_item().instance_id().find(instance_id) {
                    items_to_drop.push((def_id, item.quantity));
                    ctx.db.inventory_item().instance_id().delete(instance_id);
                }
                wooden_box.set_slot(i as u8, None, None);
            }
        }
        
        // Update the box one last time to ensure is_destroyed and destroyed_at are sent to client
        boxes_table.id().update(wooden_box.clone());
        // Then immediately delete the box entity itself
        boxes_table.id().delete(box_id);

        log::info!(
            "WoodenStorageBox {} destroyed by player {:?}. Dropping contents.",
            box_id, attacker_id
        );

        for (item_def_id, quantity) in items_to_drop {
            let offset_x = (rng.gen::<f32>() - 0.5) * 2.0 * 30.0; // Spread within +/- 30px
            let offset_y = (rng.gen::<f32>() - 0.5) * 2.0 * 30.0;
            let drop_pos_x = wooden_box.pos_x + offset_x;
            let drop_pos_y = wooden_box.pos_y + offset_y;

            match dropped_item::create_dropped_item_entity(ctx, item_def_id, quantity, drop_pos_x, drop_pos_y) {
                Ok(_) => log::debug!("Dropped {} of item_def_id {} from destroyed box {}", quantity, item_def_id, box_id),
                Err(e) => log::error!("Failed to drop item_def_id {}: {}", item_def_id, e),
            }
        }

    } else {
        // Box still has health, just update it
        boxes_table.id().update(wooden_box);
    }

    Ok(AttackResult {
        hit: true,
        target_type: Some(TargetType::WoodenStorageBox),
        resource_granted: None,
    })
}

/// Applies damage to a stash and handles destruction/item scattering
pub fn damage_stash(
    ctx: &ReducerContext,
    attacker_id: Identity,
    stash_id: u32,
    damage: f32,
    timestamp: Timestamp,
    rng: &mut impl Rng
) -> Result<AttackResult, String> {
    let mut stashes_table = ctx.db.stash();
    let mut stash = stashes_table.id().find(stash_id)
        .ok_or_else(|| format!("Target stash {} disappeared", stash_id))?;

    if stash.is_destroyed {
        return Ok(AttackResult { hit: false, target_type: Some(TargetType::Stash), resource_granted: None });
    }
    // Stashes might only be damageable if not hidden, or maybe always by owner?
    // For now, let's assume they can be damaged if found (not hidden).
    if stash.is_hidden {
         return Ok(AttackResult { hit: false, target_type: Some(TargetType::Stash), resource_granted: None });
    }

    let old_health = stash.health;
    stash.health = (stash.health - damage).max(0.0);
    stash.last_hit_time = Some(timestamp);

    log::info!(
        "Player {:?} hit Stash {} for {:.1} damage. Health: {:.1} -> {:.1}",
        attacker_id, stash_id, damage, old_health, stash.health
    );

    if stash.health <= 0.0 {
        stash.is_destroyed = true;
        stash.destroyed_at = Some(timestamp);

        let mut items_to_drop: Vec<(u64, u32)> = Vec::new();
        for i in 0..crate::stash::NUM_STASH_SLOTS { // Use NUM_STASH_SLOTS
            if let (Some(instance_id), Some(def_id)) = (stash.get_slot_instance_id(i as u8), stash.get_slot_def_id(i as u8)) {
                if let Some(item) = ctx.db.inventory_item().instance_id().find(instance_id) {
                    items_to_drop.push((def_id, item.quantity));
                    ctx.db.inventory_item().instance_id().delete(instance_id);
                }
                stash.set_slot(i as u8, None, None); // Clear slot in stash struct
            }
        }
        
        stashes_table.id().update(stash.clone());
        stashes_table.id().delete(stash_id);

        log::info!(
            "Stash {} destroyed by player {:?}. Dropping contents.",
            stash_id, attacker_id
        );

        for (item_def_id, quantity) in items_to_drop {
            let offset_x = (rng.gen::<f32>() - 0.5) * 2.0 * 15.0; // Smaller spread for stash
            let offset_y = (rng.gen::<f32>() - 0.5) * 2.0 * 15.0;
            let drop_pos_x = stash.pos_x + offset_x;
            let drop_pos_y = stash.pos_y + offset_y;

            match dropped_item::create_dropped_item_entity(ctx, item_def_id, quantity, drop_pos_x, drop_pos_y) {
                Ok(_) => log::debug!("Dropped {} of item_def_id {} from destroyed stash {}", quantity, item_def_id, stash_id),
                Err(e) => log::error!("Failed to drop item_def_id {}: {}", item_def_id, e),
            }
        }
    } else {
        stashes_table.id().update(stash);
    }

    Ok(AttackResult {
        hit: true,
        target_type: Some(TargetType::Stash),
        resource_granted: None, 
    })
}

/// Applies damage to a sleeping bag and handles destruction
pub fn damage_sleeping_bag(
    ctx: &ReducerContext,
    attacker_id: Identity,
    bag_id: u32,
    damage: f32,
    timestamp: Timestamp,
    _rng: &mut impl Rng // RNG not needed as bags don't drop items
) -> Result<AttackResult, String> {
    let mut bags_table = ctx.db.sleeping_bag();
    let mut bag = bags_table.id().find(bag_id)
        .ok_or_else(|| format!("Target sleeping bag {} disappeared", bag_id))?;

    if bag.is_destroyed {
        return Ok(AttackResult { hit: false, target_type: Some(TargetType::SleepingBag), resource_granted: None });
    }

    let old_health = bag.health;
    bag.health = (bag.health - damage).max(0.0);
    bag.last_hit_time = Some(timestamp);

    log::info!(
        "Player {:?} hit SleepingBag {} for {:.1} damage. Health: {:.1} -> {:.1}",
        attacker_id, bag_id, damage, old_health, bag.health
    );

    if bag.health <= 0.0 {
        bag.is_destroyed = true;
        bag.destroyed_at = Some(timestamp);
        
        bags_table.id().update(bag.clone()); 
        bags_table.id().delete(bag_id);

        log::info!(
            "SleepingBag {} destroyed by player {:?}.",
            bag_id, attacker_id
        );
    } else {
        bags_table.id().update(bag);
    }

    Ok(AttackResult {
        hit: true,
        target_type: Some(TargetType::SleepingBag),
        resource_granted: None, 
    })
}

/// Processes an attack against a target
///
/// Main entry point for weapon damage application. Handles different target types
/// and applies appropriate damage and effects.
pub fn process_attack(
    ctx: &ReducerContext,
    attacker_id: Identity,
    target: &Target,
    item_def: &ItemDefinition,
    timestamp: Timestamp,
    rng: &mut impl Rng
) -> Result<AttackResult, String> {
    let (damage, yield_amount, resource_name) = calculate_damage_and_yield(item_def, target.target_type, rng);
    
    match &target.id {
        TargetId::Tree(tree_id) => {
            damage_tree(ctx, attacker_id, *tree_id, damage, yield_amount, &resource_name, timestamp)
        },
        TargetId::Stone(stone_id) => {
            damage_stone(ctx, attacker_id, *stone_id, damage, yield_amount, &resource_name, timestamp)
        },
        TargetId::Player(player_id) => {
            damage_player(ctx, attacker_id, *player_id, damage, &item_def.name, timestamp)
        },
        TargetId::Campfire(campfire_id) => {
            damage_campfire(ctx, attacker_id, *campfire_id, damage, timestamp, rng)
        },
        TargetId::WoodenStorageBox(box_id) => {
            damage_wooden_storage_box(ctx, attacker_id, *box_id, damage, timestamp, rng)
        },
        TargetId::Stash(stash_id) => {
            damage_stash(ctx, attacker_id, *stash_id, damage, timestamp, rng)
        },
        TargetId::SleepingBag(bag_id) => {
            damage_sleeping_bag(ctx, attacker_id, *bag_id, damage, timestamp, rng)
        },
    }
} 