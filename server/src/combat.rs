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

// SpacetimeDB imports
use spacetimedb::{Identity, ReducerContext, Table, Timestamp};
use log;

// Core game types
use crate::Player;
use crate::PLAYER_RADIUS;
use crate::items::{ItemDefinition, ItemCategory};

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

// --- Game Balance Constants ---
/// Multiplier for damage when attacking other players
pub const PVP_DAMAGE_MULTIPLIER: f32 = 6.0;
/// Time in seconds before resources (trees, stones) respawn after being depleted
pub const RESOURCE_RESPAWN_DURATION_SECS: u64 = 300; // 5 minutes
/// Time in milliseconds before a dead player can respawn
pub const RESPAWN_TIME_MS: u64 = 5000; // 5 seconds

// --- Combat System Types ---

/// Types of entities that can be targeted in combat
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum TargetType {
    Tree,
    Stone,
    Player,
}

/// Identifiers for specific combat targets
#[derive(Debug, Clone)]
pub enum TargetId {
    Tree(u64),
    Stone(u64),
    Player(Identity),
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
    
    // Sort by distance (closest first)
    targets.sort_by(|a, b| a.distance_sq.partial_cmp(&b.distance_sq).unwrap());
    
    targets
}

/// Determines the best target based on weapon type and available targets
///
/// Different weapons have different priorities (e.g., pickaxes prioritize stones).
/// This function selects the appropriate target based on the weapon and available targets.
pub fn find_best_target(targets: &[Target], item_name: &str) -> Option<Target> {
    if targets.is_empty() {
        return None;
    }
    
    match item_name {
        "Stone Pickaxe" => {
            // Prioritize Stones > Players
            let stone_target = targets.iter().find(|t| t.target_type == TargetType::Stone);
            if stone_target.is_some() {
                return stone_target.cloned();
            }
            
            let player_target = targets.iter().find(|t| t.target_type == TargetType::Player);
            return player_target.cloned();
        },
        "Stone Hatchet" => {
            // Prioritize Trees > Players
            let tree_target = targets.iter().find(|t| t.target_type == TargetType::Tree);
            if tree_target.is_some() {
                return tree_target.cloned();
            }
            
            let player_target = targets.iter().find(|t| t.target_type == TargetType::Player);
            return player_target.cloned();
        },
        _ => {
            // Default: take closest target
            return targets.first().cloned();
        }
    }
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
        .map_err(|e| format!("Failed to grant {} to player: {}", resource_name, e))
}

/// Calculates damage amount based on item definition and target type
///
/// Applies special cases like PVP multiplier and custom damage values for specific items.
pub fn calculate_damage(item_def: &ItemDefinition, target_type: TargetType) -> f32 {
    let base_damage = item_def.damage.unwrap_or(0);
    
    // Apply special case for Rock item
    if item_def.name == "Rock" {
        return if target_type == TargetType::Player { 
            1.0 * PVP_DAMAGE_MULTIPLIER 
        } else { 
            1.0 
        };
    }
    
    // Apply PVP multiplier for player targets
    if target_type == TargetType::Player {
        base_damage as f32 * PVP_DAMAGE_MULTIPLIER
    } else {
        base_damage as f32
    }
}

/// Applies damage to a tree and handles destruction/respawning
///
/// Reduces tree health, grants wood resources, and schedules respawn if depleted.
pub fn damage_tree(
    ctx: &ReducerContext, 
    attacker_id: Identity, 
    tree_id: u64, 
    damage: u32, 
    timestamp: Timestamp
) -> Result<AttackResult, String> {
    let mut tree = ctx.db.tree().id().find(tree_id)
        .ok_or_else(|| "Target tree disappeared".to_string())?;
    
    let old_health = tree.health;
    tree.health = tree.health.saturating_sub(damage);
    tree.last_hit_time = Some(timestamp);
    
    log::info!("Player {:?} hit Tree {} for {} damage. Health: {} -> {}", 
           attacker_id, tree_id, damage, old_health, tree.health);
    
    // Grant wood
    let resource_name = "Wood";
    let resource_amount = damage as u32;
    let resource_result = grant_resource(ctx, attacker_id, resource_name, resource_amount);
    
    if let Err(e) = resource_result {
        log::error!("Failed to grant Wood to player {:?}: {}", attacker_id, e);
    }
    
    // Handle destruction
    if tree.health == 0 {
        log::info!("Tree {} destroyed by Player {:?}. Scheduling respawn.", tree_id, attacker_id);
        let respawn_time = timestamp + spacetimedb::TimeDuration::from(Duration::from_secs(RESOURCE_RESPAWN_DURATION_SECS));
        tree.respawn_at = Some(respawn_time);
    }
    
    // Update the tree
    ctx.db.tree().id().update(tree);
    
    Ok(AttackResult {
        hit: true,
        target_type: Some(TargetType::Tree),
        resource_granted: Some((resource_name.to_string(), resource_amount)),
    })
}

/// Applies damage to a stone and handles destruction/respawning
///
/// Reduces stone health, grants stone resources, and schedules respawn if depleted.
pub fn damage_stone(
    ctx: &ReducerContext, 
    attacker_id: Identity, 
    stone_id: u64, 
    damage: u32, 
    timestamp: Timestamp
) -> Result<AttackResult, String> {
    let mut stone = ctx.db.stone().id().find(stone_id)
        .ok_or_else(|| "Target stone disappeared".to_string())?;
    
    let old_health = stone.health;
    stone.health = stone.health.saturating_sub(damage);
    stone.last_hit_time = Some(timestamp);
    
    log::info!("Player {:?} hit Stone {} for {} damage. Health: {} -> {}", 
           attacker_id, stone_id, damage, old_health, stone.health);
    
    // Grant stone
    let resource_name = "Stone";
    let resource_amount = damage as u32;
    let resource_result = grant_resource(ctx, attacker_id, resource_name, resource_amount);
    
    if let Err(e) = resource_result {
        log::error!("Failed to grant Stone to player {:?}: {}", attacker_id, e);
    }
    
    // Handle destruction
    if stone.health == 0 {
        log::info!("Stone {} depleted by Player {:?}. Scheduling respawn.", stone_id, attacker_id);
        let respawn_time = timestamp + spacetimedb::TimeDuration::from(Duration::from_secs(RESOURCE_RESPAWN_DURATION_SECS));
        stone.respawn_at = Some(respawn_time);
    }
    
    // Update the stone
    ctx.db.stone().id().update(stone);
    
    Ok(AttackResult {
        hit: true,
        target_type: Some(TargetType::Stone),
        resource_granted: Some((resource_name.to_string(), resource_amount)),
    })
}

/// Applies damage to another player and handles death
///
/// Reduces player health, handles death state, and schedules respawn if killed.
pub fn damage_player(
    ctx: &ReducerContext, 
    attacker_id: Identity, 
    target_id: Identity, 
    damage: f32, 
    item_name: &str,
    timestamp: Timestamp
) -> Result<AttackResult, String> {
    let mut target_player = ctx.db.player().identity().find(target_id)
        .ok_or_else(|| "Target player disappeared".to_string())?;
    
    let old_health = target_player.health;
    let new_health = (target_player.health - damage).max(0.0);
    target_player.health = new_health;
    target_player.last_hit_time = Some(timestamp);
    
    log::info!("Player {:?} hit Player {:?} with {} for {:.1} damage. Health: {:.1} -> {:.1}",
           attacker_id, target_id, item_name, damage, old_health, new_health);
    
    // --- Handle Death ---
    if new_health <= 0.0 && !target_player.is_dead {
        log::info!("Player {} ({:?}) died from combat (Attacker: {:?}, Health: {:.1}).",
                 target_player.username, target_id, attacker_id, new_health);
        target_player.is_dead = true;
        target_player.death_timestamp = Some(timestamp);

        // --- Drop Equipped Item --- 
        let active_equip_table = ctx.db.active_equipment();
        if let Some(active_equip) = active_equip_table.player_identity().find(&target_id) {
            // Check the CORRECT field for the main equipped item
            if let Some(equipped_item_instance_id) = active_equip.equipped_item_instance_id {
                log::debug!("Player {:?} died with item instance {} equipped. Attempting to drop.", 
                         target_id, equipped_item_instance_id);
                
                let inventory_table = ctx.db.inventory_item();
                if let Some(equipped_item) = inventory_table.instance_id().find(equipped_item_instance_id) {
                    let item_def_to_drop = equipped_item.item_def_id;
                    let drop_pos_x = target_player.position_x;
                    let drop_pos_y = target_player.position_y;
                    
                    log::info!("Dropping item def {} at ({:.1}, {:.1}) for dead player {:?}", 
                             item_def_to_drop, drop_pos_x, drop_pos_y, target_id);
                                 
                    match dropped_item::create_dropped_item_entity(ctx, item_def_to_drop, 1, drop_pos_x, drop_pos_y) {
                        Ok(_) => log::info!("Successfully created dropped item entity for player {:?}'s weapon.", target_id),
                        Err(e) => log::error!("Failed to create dropped item entity for player {:?}: {}", target_id, e),
                    }
                } else {
                    log::warn!("Player {:?} died, active equipment referenced item instance {}, but that item was not found in inventory table!", 
                             target_id, equipped_item_instance_id);
                }
            } else {
                 log::debug!("Player {:?} died with nothing equipped.", target_id);
            }
        } // No else needed if active_equipment entry doesn't exist
        // --- End Drop Equipped Item ---

        // Unequip item (this will delete the active equipment record AND the inventory item)
        // This needs to happen *after* we potentially create the dropped item
        match crate::active_equipment::unequip_item(ctx, target_id) {
            Ok(_) => log::info!("Unequipped item for dying player {:?} (combat death).", target_id),
            Err(e) => log::error!("Failed to unequip item for dying player {:?} (combat death): {}", target_id, e),
        }

        // Mark player as dead *before* potential state update below
        target_player.is_dead = true;
    }

    // Update the player
    ctx.db.player().identity().update(target_player);
    
    Ok(AttackResult {
        hit: true,
        target_type: Some(TargetType::Player),
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
    timestamp: Timestamp
) -> Result<AttackResult, String> {
    let damage = match target.target_type {
        TargetType::Tree | TargetType::Stone => {
            if item_def.name == "Rock" { 1 } else { item_def.damage.unwrap_or(0) }
        },
        TargetType::Player => item_def.damage.unwrap_or(0),
    };
    
    match &target.id {
        TargetId::Tree(tree_id) => {
            damage_tree(ctx, attacker_id, *tree_id, damage, timestamp)
        },
        TargetId::Stone(stone_id) => {
            damage_stone(ctx, attacker_id, *stone_id, damage, timestamp)
        },
        TargetId::Player(player_id) => {
            let actual_damage = calculate_damage(item_def, TargetType::Player);
            damage_player(ctx, attacker_id, *player_id, actual_damage, &item_def.name, timestamp)
        }
    }
} 