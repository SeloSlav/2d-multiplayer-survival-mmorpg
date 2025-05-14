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
use crate::items::{ItemDefinition, ItemCategory};
use crate::models::TargetType;

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

// --- Game Balance Constants ---
/// Time in seconds before resources (trees, stones) respawn after being depleted
pub const RESOURCE_RESPAWN_DURATION_SECS: u64 = 300; // 5 minutes
/// Time in milliseconds before a dead player can respawn
pub const RESPAWN_TIME_MS: u64 = 5000; // 5 seconds

// --- Combat System Types ---

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

    let attacker_player_opt = players.identity().find(&attacker_id);
    let mut target_player = players.identity().find(&target_id)
        .ok_or_else(|| format!("Target player {:?} not found", target_id))?;

    let old_health = target_player.health;
    let new_health = (target_player.health - damage).max(0.0);
    target_player.health = new_health;
    target_player.last_hit_time = Some(timestamp);
    
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
        }
    }
} 