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
use crate::tree;
use crate::stone;
use crate::wooden_storage_box;
use crate::player_corpse;

// Specific constants needed
use crate::tree::{MIN_TREE_RESPAWN_TIME_SECS, MAX_TREE_RESPAWN_TIME_SECS, TREE_COLLISION_Y_OFFSET, PLAYER_TREE_COLLISION_DISTANCE_SQUARED};
use crate::stone::{MIN_STONE_RESPAWN_TIME_SECS, MAX_STONE_RESPAWN_TIME_SECS, STONE_COLLISION_Y_OFFSET, PLAYER_STONE_COLLISION_DISTANCE_SQUARED};
use crate::wooden_storage_box::{WoodenStorageBox, BOX_COLLISION_RADIUS, BOX_COLLISION_Y_OFFSET, wooden_storage_box as WoodenStorageBoxTableTrait};

// Table trait imports for database access
use crate::tree::tree as TreeTableTrait;
use crate::stone::stone as StoneTableTrait;
use crate::items::item_definition as ItemDefinitionTableTrait;
use crate::items::inventory_item as InventoryItemTableTrait;
use crate::player as PlayerTableTrait;
use crate::active_equipment::active_equipment as ActiveEquipmentTableTrait;
use crate::dropped_item;
use crate::player_corpse::{PlayerCorpse, PlayerCorpseDespawnSchedule, NUM_CORPSE_SLOTS, create_player_corpse, player_corpse as PlayerCorpseTableTrait, player_corpse_despawn_schedule as PlayerCorpseDespawnScheduleTableTrait};
use crate::inventory_management::ItemContainer;
use crate::environment::calculate_chunk_index;
use crate::campfire::{Campfire, CAMPFIRE_COLLISION_RADIUS, CAMPFIRE_COLLISION_Y_OFFSET, campfire as CampfireTableTrait, campfire_processing_schedule as CampfireProcessingScheduleTableTrait};
use crate::stash::{Stash, stash as StashTableTrait};
use crate::sleeping_bag::{SleepingBag, SLEEPING_BAG_COLLISION_RADIUS, SLEEPING_BAG_COLLISION_Y_OFFSET, sleeping_bag as SleepingBagTableTrait};
use crate::active_effects::{self, ActiveConsumableEffect, EffectType, active_consumable_effect as ActiveConsumableEffectTableTrait};
use crate::consumables::MAX_STAT_VALUE;
// Import the armor module
use crate::armor;
// Player inventory imports (commented out previously, keeping them commented if unresolved)
// use crate::player_inventory::{drop_all_inventory_on_death, drop_all_equipped_armor_on_death};
// Import the player stats module
use crate::player_stats;
// Import the utils module
use crate::utils::get_distance_squared;
// --- Game Balance Constants ---
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
    PlayerCorpse(u32),
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
        // OPTIMIZED: Use visual center for combat targeting
        const VISUAL_CENTER_Y_OFFSET: f32 = 42.0; // (CAMPFIRE_HEIGHT / 2) + CAMPFIRE_RENDER_Y_OFFSET = 32 + 10 = 42

        let dx = campfire_entity.pos_x - player.position_x;
        let target_y = campfire_entity.pos_y - VISUAL_CENTER_Y_OFFSET; // Calculate Y based on visual center
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

    // Check player corpses
    for corpse_entity in ctx.db.player_corpse().iter() {
        // Corpses can be harvested even if they have items, but not if already "destroyed" (health 0)
        if corpse_entity.health == 0 {
            continue;
        }
        // Use corpse_entity.pos_x, pos_y and CORPSE_COLLISION_Y_OFFSET for targeting
        let dx = corpse_entity.pos_x - player.position_x;
        let target_y = corpse_entity.pos_y - player_corpse::CORPSE_COLLISION_Y_OFFSET;
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
                    target_type: TargetType::PlayerCorpse,
                    id: TargetId::PlayerCorpse(corpse_entity.id),
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
    
    // 1. Check for primary target type if defined for the item
    if let Some(primary_type) = item_def.primary_target_type {
        if let Some(target) = targets.iter().find(|t| t.target_type == primary_type) {
            return Some(target.clone());
        }
    }

    // 2. If no primary target found (or item has no primary_target_type) 
    //    AND item has PvP damage capability, check for Player targets.
    if item_def.pvp_damage_min.is_some() || item_def.pvp_damage_max.is_some() {
        if let Some(player_target) = targets.iter().find(|t| t.target_type == TargetType::Player) {
            // Only return player if primary type wasn't found or wasn't defined.
            // This check ensures we don't pick a player if a defined primary (e.g. Tree) was available but just not in the current target list.
            // If primary_target_type is None, it means the item is not specialized, so a Player target is a valid choice if it has PvP damage.
            if item_def.primary_target_type.is_none() || 
               (item_def.primary_target_type.is_some() && targets.iter().find(|t| t.target_type == item_def.primary_target_type.unwrap()).is_none()) {
                return Some(player_target.clone());
            }
        }
    }

    // 3. If no specific preferred target found by the above logic, 
    //    return the closest target of any type. 
    //    This allows hitting unintended targets, and calculate_damage_and_yield 
    //    will determine the actual effect (possibly zero damage/yield).
    targets.first().cloned()
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
    let mut resource_name = "None".to_string();

    // 1. Handle PvP directly
    if target_type == TargetType::Player {
        damage_min = item_def.pvp_damage_min.unwrap_or(0);
        damage_max = item_def.pvp_damage_max.unwrap_or(damage_min); 
        yield_min = 0; // No yield from players
        yield_max = 0;
        resource_name = "None".to_string();
    // 2. Handle Structures (Campfire, Box, Stash, SleepingBag) - No yield, PvP or specific damage
    } else if target_type == TargetType::Campfire || 
              target_type == TargetType::WoodenStorageBox || 
              target_type == TargetType::Stash || 
              target_type == TargetType::SleepingBag {
        // For structures, could use pvp_damage_min/max or dedicated structure_damage fields if added later.
        damage_min = item_def.pvp_damage_min.unwrap_or(0); // Default to PvP damage for now
        damage_max = item_def.pvp_damage_max.unwrap_or(damage_min);
        yield_min = 0;
        yield_max = 0;
        resource_name = "None".to_string();
    // 3. Handle Resource Nodes (Tree, Stone, PlayerCorpse)
    } else if target_type == TargetType::Tree || target_type == TargetType::Stone || target_type == TargetType::PlayerCorpse {
        if item_def.category == ItemCategory::Weapon {
            // Weapons can damage resource nodes but yield no resources.
            // Use primary_target_damage if defined for the weapon, otherwise very low/pvp damage.
            damage_min = item_def.primary_target_damage_min.or(item_def.pvp_damage_min).unwrap_or(1); 
            damage_max = item_def.primary_target_damage_max.or(item_def.pvp_damage_max).unwrap_or(damage_min);
            yield_min = 0;
            yield_max = 0;
            resource_name = "None".to_string();
        } else if item_def.category == ItemCategory::Tool {
            // Default behavior for any Tool on a resource node:
            // Moderate general-purpose yield and damage (can be overridden by specialization).
            damage_min = item_def.primary_target_damage_min.unwrap_or(1); // Use primary damage if set, else default low
            damage_max = item_def.primary_target_damage_max.unwrap_or(damage_min.max(1));
            yield_min = 5; // Default moderate harvest power for any tool
            yield_max = 10;
            match target_type {
                TargetType::Tree => resource_name = "Wood".to_string(),
                TargetType::Stone => resource_name = "Stone".to_string(),
                TargetType::PlayerCorpse => resource_name = "Corpse Parts".to_string(),
                _ => resource_name = "Scraps".to_string(), // Should not be reached for these node types
            }

            // Override with specialized values if this tool's primary_target_type matches the actual target_type
            if item_def.primary_target_type == Some(target_type) {
                // Use specific damage if primary_target_damage is defined for this specialization
                damage_min = item_def.primary_target_damage_min.unwrap_or(damage_min); // Keep default if specialized damage is not set
                damage_max = item_def.primary_target_damage_max.unwrap_or(damage_max);
                
                yield_min = item_def.primary_target_yield_min.unwrap_or(yield_min); // Keep default if specialized yield is not set
                yield_max = item_def.primary_target_yield_max.unwrap_or(yield_max);
                resource_name = item_def.primary_yield_resource_name.clone().unwrap_or_else(|| resource_name); // Keep default if no specific name
            }
        } else {
            // Other categories (Material, Placeable, Armor, Consumable, Ammunition) - No damage/yield from nodes
            damage_min = 0;
            damage_max = 0;
            yield_min = 0;
            yield_max = 0;
            resource_name = "None".to_string();
        }
    } else {
        // Should not happen if all TargetTypes are covered above. Fallback for safety.
        log::warn!("Item '{}' used against unhandled target type '{:?}'. Defaulting to zero effect.", item_def.name, target_type);
        damage_min = 0;
        damage_max = 0;
        yield_min = 0;
        yield_max = 0;
        resource_name = "None".to_string();
    }

    // Ensure max is not less than min for damage and yield
    if damage_max < damage_min { damage_max = damage_min; }
    if yield_max < yield_min { yield_max = yield_min; }

    let final_damage = if damage_min == damage_max {
        damage_min as f32
    } else {
        rng.gen_range(damage_min..=damage_max) as f32
    };

    let final_yield = if yield_min == yield_max {
        yield_min
    } else {
        rng.gen_range(yield_min..=yield_max)
    };
    
    // PvP damage is already handled if target_type was Player. 
    // For other target types, final_damage is based on the logic above.

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
    timestamp: Timestamp,
    rng: &mut impl Rng
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
        // Calculate random respawn time for trees
        let respawn_duration_secs = if MIN_TREE_RESPAWN_TIME_SECS >= MAX_TREE_RESPAWN_TIME_SECS {
            MIN_TREE_RESPAWN_TIME_SECS
        } else {
            rng.gen_range(MIN_TREE_RESPAWN_TIME_SECS..=MAX_TREE_RESPAWN_TIME_SECS)
        };
        let respawn_time = timestamp + spacetimedb::TimeDuration::from(Duration::from_secs(respawn_duration_secs));
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
    timestamp: Timestamp,
    rng: &mut impl Rng
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
        // Calculate random respawn time for stones
        let respawn_duration_secs = if MIN_STONE_RESPAWN_TIME_SECS >= MAX_STONE_RESPAWN_TIME_SECS {
            MIN_STONE_RESPAWN_TIME_SECS
        } else {
            rng.gen_range(MIN_STONE_RESPAWN_TIME_SECS..=MAX_STONE_RESPAWN_TIME_SECS)
        };
        let respawn_time = timestamp + spacetimedb::TimeDuration::from(Duration::from_secs(respawn_duration_secs));
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
    item_def: &ItemDefinition,
    timestamp: Timestamp
) -> Result<AttackResult, String> {
    log::debug!(
        "Attempting to damage player {:?} from attacker {:?} with item {}", 
        target_id, attacker_id, item_def.name
    );
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
        .ok_or_else(|| format!("Target player {:?} not found for damage.", target_id))?;

    if target_player.is_dead {
        log::debug!("Target player {:?} is already dead. No damage applied.", target_id);
        return Ok(AttackResult { hit: false, target_type: Some(TargetType::Player), resource_granted: None });
    }

    let mut final_damage = damage; // Start with the damage passed in (already calculated from weapon stats)

    // <<< APPLY ARMOR RESISTANCE >>>
    let resistance = armor::calculate_total_damage_resistance(ctx, target_id);
    if resistance > 0.0 {
        let damage_reduction = final_damage * resistance;
        let resisted_damage = final_damage - damage_reduction;
        
        log::info!(
            "Player {:?} attacking Player {:?}. Initial Damage: {:.2}, Resistance: {:.2} ({:.0}%), Final Damage after resistance: {:.2}",
            attacker_id, target_id, 
            final_damage, // Log the damage before resistance
            resistance,
            resistance * 100.0,
            resisted_damage.max(0.0)
        );
        final_damage = resisted_damage.max(0.0); // Damage cannot be negative
    } else {
        log::info!(
            "Player {:?} attacking Player {:?}. Initial Damage: {:.2} (No resistance). Final Damage: {:.2}",
            attacker_id, target_id, 
            final_damage, 
            final_damage
        );
    }
    // <<< END APPLY ARMOR RESISTANCE >>>

    // A "hit" has occurred. Set last_hit_time immediately for client visuals.
    target_player.last_hit_time = Some(timestamp);

    let old_health = target_player.health;
    target_player.health = (target_player.health - final_damage).clamp(0.0, MAX_STAT_VALUE);
    let actual_damage_applied = old_health - target_player.health; // This is essentially final_damage clamped by remaining health

    // --- APPLY KNOCKBACK and update timestamp if damage was dealt ---
    if actual_damage_applied > 0.0 { // Only apply knockback and update timestamp if actual damage occurred
        target_player.last_update = timestamp; // Update target's timestamp due to health change and potential knockback

        if let Some(mut attacker) = attacker_player_opt.clone() { // Clone attacker_player_opt to get a mutable attacker if needed
            let dx_target_from_attacker = target_player.position_x - attacker.position_x;
            let dy_target_from_attacker = target_player.position_y - attacker.position_y;
            let distance_sq = dx_target_from_attacker * dx_target_from_attacker + dy_target_from_attacker * dy_target_from_attacker;

            if distance_sq > 0.001 { // Avoid division by zero or tiny distances
                let distance = distance_sq.sqrt();
                // Knockback for Target
                let knockback_dx_target = (dx_target_from_attacker / distance) * PVP_KNOCKBACK_DISTANCE;
                let knockback_dy_target = (dy_target_from_attacker / distance) * PVP_KNOCKBACK_DISTANCE;
                
                let current_target_x = target_player.position_x;
                let current_target_y = target_player.position_y;
                let proposed_target_x = current_target_x + knockback_dx_target;
                let proposed_target_y = current_target_y + knockback_dy_target;

                let (final_target_x, final_target_y) = resolve_knockback_collision(
                    ctx,
                    target_player.identity,
                    current_target_x,
                    current_target_y,
                    proposed_target_x,
                    proposed_target_y,
                );
                target_player.position_x = final_target_x;
                target_player.position_y = final_target_y;
                log::debug!("Applied knockback to target player {:?}: new pos ({:.1}, {:.1})", 
                    target_id, target_player.position_x, target_player.position_y);

                // Knockback for Attacker (recoil)
                let attacker_recoil_distance = PVP_KNOCKBACK_DISTANCE / 3.0; // Example: attacker recoils less
                let knockback_dx_attacker = (-dx_target_from_attacker / distance) * attacker_recoil_distance; // Opposite direction
                let knockback_dy_attacker = (-dy_target_from_attacker / distance) * attacker_recoil_distance; // Opposite direction
                
                let current_attacker_x = attacker.position_x;
                let current_attacker_y = attacker.position_y;
                let proposed_attacker_x = current_attacker_x + knockback_dx_attacker;
                let proposed_attacker_y = current_attacker_y + knockback_dy_attacker;

                let (final_attacker_x, final_attacker_y) = resolve_knockback_collision(
                    ctx,
                    attacker.identity,
                    current_attacker_x,
                    current_attacker_y,
                    proposed_attacker_x,
                    proposed_attacker_y,
                );
                attacker.position_x = final_attacker_x;
                attacker.position_y = final_attacker_y;
                attacker.last_update = timestamp; // Update attacker's timestamp as their position changed
                players.identity().update(attacker.clone()); // Update attacker player in DB
                 log::debug!("Applied recoil to attacking player {:?}: new pos ({:.1}, {:.1})", 
                    attacker_id, attacker.position_x, attacker.position_y);
            }
        }
    }
    // --- END KNOCKBACK ---

    let killed = target_player.health <= 0.0;

    log::info!(
        "Player {:?} damaged Player {:?} for {:.2} (raw: {:.2}) with {}. Health: {:.2} -> {:.2}",
        attacker_id, target_id, actual_damage_applied, damage, item_def.name, old_health, target_player.health
    );

    // Log the item_name and item_def_id being checked for bleed application
    // let item_def_id_for_bleed_check = ctx.db.item_definition().iter().find(|def| def.name == item_name).map_or(0, |def| def.id);
    log::info!("[BleedCheck] Item used: '{}' (Def ID: {}). Checking if it should apply bleed based on its definition.", item_def.name, item_def.id);

    // Apply bleed effect if the weapon has bleed damage defined in its properties
    if let (Some(dmg_per_tick), Some(duration_sec), Some(interval_sec)) = (
        item_def.bleed_damage_per_tick, 
        item_def.bleed_duration_seconds, 
        item_def.bleed_tick_interval_seconds
    ) {
        if dmg_per_tick > 0.0 && duration_sec > 0.0 && interval_sec > 0.0 {
            log::info!(
                "[BleedCheck] Item '{}' (Def ID: {}) has positive bleed properties (Dmg: {}, Dur: {}, Int: {}). Attempting to apply bleed effect to player {:?}.", 
                item_def.name, item_def.id, dmg_per_tick, duration_sec, interval_sec, target_id
            );
            
            let total_ticks = (duration_sec / interval_sec).floor();
            let bleed_total_damage = dmg_per_tick * total_ticks;

            let time_until_next_tick = TimeDuration::from_micros((interval_sec * 1_000_000.0) as i64);

            let bleed_effect = ActiveConsumableEffect {
                effect_id: 0, 
                player_id: target_id,
                item_def_id: item_def.id, // Store the ID of the item causing the bleed
                consuming_item_instance_id: None, 
                started_at: timestamp,
                ends_at: timestamp + TimeDuration::from_micros((duration_sec * 1_000_000.0) as i64),
                total_amount: Some(bleed_total_damage), // Total potential damage
                amount_applied_so_far: Some(0.0),
                effect_type: EffectType::Bleed,
                tick_interval_micros: (interval_sec * 1_000_000.0) as u64,
                next_tick_at: timestamp + time_until_next_tick,
            };
            match ctx.db.active_consumable_effect().try_insert(bleed_effect) {
                Ok(inserted_effect) => {
                    log::info!(
                        "Successfully applied bleed effect with ID {} to player {:?} from item '{}'",
                        inserted_effect.effect_id, 
                        target_id,
                        item_def.name
                    );
                }
                Err(e) => {
                    log::error!("Failed to apply bleed effect to player {:?} from item '{}': {:?}", target_id, item_def.name, e);
                }
            }
        } else {
            log::info!("[BleedCheck] Item '{}' has bleed properties, but one or more are zero. Not applying bleed.", item_def.name);
        }
    } else {
        log::info!("[BleedCheck] Item '{}' does not have all necessary bleed properties defined. Not applying bleed.", item_def.name);
    }

    // INTERRUPT BANDAGE IF DAMAGED
    active_effects::cancel_bandage_burst_effects(ctx, target_id);

    if killed {
        target_player.is_dead = true;
        target_player.death_timestamp = Some(timestamp);
        // last_update and last_hit_time are already set from the initial hit registration.
        // No need to set them again here unless there's a specific reason for death to override.
        // Keeping them as set at the start of the hit interaction is consistent.

        match crate::active_equipment::clear_active_item_reducer(ctx, target_player.identity) {
            Ok(_) => log::info!("[PlayerDeath] Active item cleared for dying player {}", target_player.identity),
            Err(e) => log::error!("[PlayerDeath] Failed to clear active item for dying player {}: {}", target_player.identity, e),
        }

        match create_player_corpse(ctx, target_player.identity, target_player.position_x, target_player.position_y, &target_player.username) {
            Ok(_) => {
                log::info!("Successfully created corpse via combat death for player {:?}", target_id);
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

    } else if target_player.health > 0.0 {
        // Player is alive. last_hit_time and last_update were set at the beginning.
        // Simply update the player state with new health etc.
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

/// Applies damage to a player corpse, yields resources, and handles destruction.
pub fn damage_player_corpse(
    ctx: &ReducerContext,
    attacker_id: Identity,
    corpse_id: u32,
    damage: f32,
    yield_harvest_power: u32, 
    item_def: &ItemDefinition, 
    item_category: ItemCategory, // Added new parameter
    timestamp: Timestamp,
    rng: &mut impl Rng,
) -> Result<AttackResult, String> {
    let mut player_corpses_table = ctx.db.player_corpse();
    let mut corpse = player_corpses_table.id().find(corpse_id)
        .ok_or_else(|| format!("Target player corpse {} disappeared", corpse_id))?;

    if corpse.health == 0 { // Already fully harvested
        // If health is already 0, but the entity somehow still exists, log and exit.
        // This might happen if two hits are processed very closely.
        log::warn!("[DamagePlayerCorpse] Corpse {} already has 0 health. No action taken.", corpse_id);
        return Ok(AttackResult { hit: false, target_type: Some(TargetType::PlayerCorpse), resource_granted: None });
    }

    let old_health = corpse.health;
    corpse.health = corpse.health.saturating_sub(damage as u32);
    corpse.last_hit_time = Some(timestamp);

    log::info!(
        "Player {:?} hit PlayerCorpse {} for {:.1} damage. Health: {} -> {}",
        attacker_id, corpse_id, damage, old_health, corpse.health
    );

    let mut resources_granted: Vec<(String, u32)> = Vec::new();

    // Determine resources based on RNG and tool (placeholder logic for now)
    // This is where you'd define frequencies for Animal Bone, Animal Fat, Raw Human Flesh.
    // Human Skull is special: 1 per corpse, granted when health reaches 0.

    // Base probabilities for high harvest power (e.g., Bone Knife yield_harvest_power might be 5)
    const BASE_CHANCE_FAT: f64 = 0.50; // 50%
    const BASE_CHANCE_FLESH: f64 = 0.30; // 30%
    const BASE_CHANCE_BONE: f64 = 0.20; // 20%
    const MAX_YIELD_FOR_FULL_CHANCE: u32 = 5; // At this harvest power, base chances apply.

    // Scale probabilities by harvest_power.
    // If yield_harvest_power is 0 (e.g. from wrong tool), chances will be 0.
    // If yield_harvest_power is 1 (e.g. from wrong tool), chances will be low.
    // If yield_harvest_power is high (e.g. from Bone Knife), chances will be close to base.
    let effectiveness_multiplier = if MAX_YIELD_FOR_FULL_CHANCE > 0 {
        (yield_harvest_power as f64) / (MAX_YIELD_FOR_FULL_CHANCE as f64)
    } else {
        0.0 // Avoid division by zero if MAX_YIELD_FOR_FULL_CHANCE is 0
    };
    
    let actual_chance_fat = (BASE_CHANCE_FAT * effectiveness_multiplier).clamp(0.0, BASE_CHANCE_FAT);
    let actual_chance_flesh = (BASE_CHANCE_FLESH * effectiveness_multiplier).clamp(0.0, BASE_CHANCE_FLESH);
    let actual_chance_bone = (BASE_CHANCE_BONE * effectiveness_multiplier).clamp(0.0, BASE_CHANCE_BONE);

    log::debug!(
        "[DamagePlayerCorpse:{}] Harvest Power: {}. Effectiveness: {:.2}. Chances: Fat({:.2}), Flesh({:.2}), Bone({:.2})",
        corpse_id, yield_harvest_power, effectiveness_multiplier, actual_chance_fat, actual_chance_flesh, actual_chance_bone
    );

    // Example: 50% chance to get 1 Animal Fat per hit, if corpse still has health
    if corpse.health > 0 && yield_harvest_power > 0 && rng.gen_bool(actual_chance_fat) {
        match grant_resource(ctx, attacker_id, "Animal Fat", 1) {
            Ok(_) => resources_granted.push(("Animal Fat".to_string(), 1)),
            Err(e) => log::error!("Failed to grant Animal Fat: {}", e),
        }
    }

    // Example: 30% chance to get 1 Raw Human Flesh per hit
    if corpse.health > 0 && yield_harvest_power > 0 && rng.gen_bool(actual_chance_flesh) {
        match grant_resource(ctx, attacker_id, "Raw Human Flesh", 1) {
            Ok(_) => resources_granted.push(("Raw Human Flesh".to_string(), 1)),
            Err(e) => log::error!("Failed to grant Raw Human Flesh: {}", e),
        }
    }
    
    // Example: 20% chance to get 1 Animal Bone per hit
    if corpse.health > 0 && yield_harvest_power > 0 && rng.gen_bool(actual_chance_bone) {
        match grant_resource(ctx, attacker_id, "Animal Bone", 1) {
            Ok(_) => resources_granted.push(("Animal Bone".to_string(), 1)),
            Err(e) => log::error!("Failed to grant Animal Bone: {}", e),
        }
    }


    if corpse.health == 0 {
        log::info!("[DamagePlayerCorpse:{}] Corpse depleted by Player {:?} using item from category {:?}. Checking for Human Skull grant.", 
                 corpse_id, attacker_id, item_category);
        // Grant 1 Human Skull only if a Tool was used to deplete or hit the depleted corpse.
        if item_category == ItemCategory::Tool {
            match grant_resource(ctx, attacker_id, "Human Skull", 1) {
                Ok(_) => {
                    resources_granted.push(("Human Skull".to_string(), 1));
                    log::info!("[DamagePlayerCorpse:{}] Granted Human Skull to Player {:?} (used a Tool).", corpse_id, attacker_id);
                }
                Err(e) => log::error!("[DamagePlayerCorpse:{}] Failed to grant Human Skull to Player {:?}: {}", corpse_id, attacker_id, e),
            }
        } else {
            log::info!("[DamagePlayerCorpse:{}] Corpse depleted, but item used ({:?}) was not a Tool. Human Skull not granted by this hit.", 
                     corpse_id, item_category);
        }
        
        // Corpse is depleted. It will despawn based on its original schedule or when items are looted.
        // We don't delete it here, just mark health as 0.
        // The existing despawn logic in player_corpse.rs (process_corpse_despawn) will handle final cleanup.

        // --- Scatter Items and Delete Corpse --- 
        let mut items_to_drop: Vec<(u64, u32)> = Vec::new(); // (item_def_id, quantity)
        let inventory_items_table = ctx.db.inventory_item();

        for i in 0..corpse.num_slots() as u8 {
            if let (Some(instance_id), Some(def_id)) = (corpse.get_slot_instance_id(i), corpse.get_slot_def_id(i)) {
                if let Some(item) = inventory_items_table.instance_id().find(instance_id) {
                    items_to_drop.push((def_id, item.quantity));
                    // Delete the InventoryItem from the central table
                    inventory_items_table.instance_id().delete(instance_id);
                    log::debug!("[DamagePlayerCorpse] Marked item instance {} (DefID: {}, Qty: {}) from corpse {} slot {} for dropping.", 
                               instance_id, def_id, item.quantity, corpse_id, i);
                } else {
                    log::warn!("[DamagePlayerCorpse] InventoryItem instance {} not found for corpse {} slot {}, though slot data existed. Skipping drop for this item.", instance_id, corpse_id, i);
                }
                // No need to clear slot in corpse struct as it's being deleted
            }
        }

        // Scatter collected items around the corpse's location
        let corpse_pos_x = corpse.pos_x;
        let corpse_pos_y = corpse.pos_y;

        for (item_def_id, quantity) in items_to_drop {
            // Spawn slightly offset from corpse center
            let offset_x = (rng.gen::<f32>() - 0.5) * 2.0 * 30.0; // Spread within +/- 30px
            let offset_y = (rng.gen::<f32>() - 0.5) * 2.0 * 30.0;
            let drop_pos_x = corpse_pos_x + offset_x;
            let drop_pos_y = corpse_pos_y + offset_y;

            match dropped_item::create_dropped_item_entity(ctx, item_def_id, quantity, drop_pos_x, drop_pos_y) {
                Ok(_) => log::debug!("[DamagePlayerCorpse] Dropped {} of item_def_id {} from depleted corpse {} at ({:.1}, {:.1})", 
                                   quantity, item_def_id, corpse_id, drop_pos_x, drop_pos_y),
                Err(e) => log::error!("[DamagePlayerCorpse] Failed to drop item_def_id {} from corpse {}: {}", item_def_id, corpse_id, e),
            }
        }

        // Delete the PlayerCorpse entity itself
        player_corpses_table.id().delete(corpse_id);
        log::info!("[DamagePlayerCorpse] PlayerCorpse {} entity deleted after being depleted.", corpse_id);

        // Cancel any existing despawn schedule for this corpse
        let despawn_schedule_table = ctx.db.player_corpse_despawn_schedule();
        // The PK of PlayerCorpseDespawnSchedule is corpse_id (u64), PlayerCorpse ID is u32
        if despawn_schedule_table.corpse_id().find(corpse_id as u64).is_some() {
            despawn_schedule_table.corpse_id().delete(corpse_id as u64);
            log::info!("[DamagePlayerCorpse] Canceled despawn schedule for depleted corpse {}.", corpse_id);
        } else {
            log::warn!("[DamagePlayerCorpse] No despawn schedule found for depleted corpse {} to cancel (might have already run or not existed).", corpse_id);
        }
        // --- END Scatter Items and Delete Corpse ---
    } else {
        // Corpse still has health, just update it
        player_corpses_table.id().update(corpse);
    }

    // For AttackResult, we can summarize the first resource or a generic message.
    let granted_summary = resources_granted.first().cloned();

    Ok(AttackResult {
        hit: true,
        target_type: Some(TargetType::PlayerCorpse),
        resource_granted: granted_summary,
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
            damage_tree(ctx, attacker_id, *tree_id, damage, yield_amount, &resource_name, timestamp, rng)
        },
        TargetId::Stone(stone_id) => {
            damage_stone(ctx, attacker_id, *stone_id, damage, yield_amount, &resource_name, timestamp, rng)
        },
        TargetId::Player(player_id) => {
            damage_player(ctx, attacker_id, *player_id, damage, item_def, timestamp)
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
        TargetId::PlayerCorpse(corpse_id) => {
            damage_player_corpse(ctx, attacker_id, *corpse_id, damage, yield_amount, item_def, item_def.category.clone(), timestamp, rng)
        }
    }
}

// --- NEW Helper function for knockback collision resolution ---
fn resolve_knockback_collision(
    ctx: &ReducerContext,
    colliding_player_id: Identity, // The player being knocked back
    current_x: f32,
    current_y: f32,
    mut proposed_x: f32,
    mut proposed_y: f32,
) -> (f32, f32) {
    // 1. Clamp to world boundaries first
    proposed_x = proposed_x.clamp(PLAYER_RADIUS, WORLD_WIDTH_PX - PLAYER_RADIUS);
    proposed_y = proposed_y.clamp(PLAYER_RADIUS, WORLD_HEIGHT_PX - PLAYER_RADIUS);

    // Check against other players
    for other_player in ctx.db.player().iter() {
        if other_player.identity == colliding_player_id || other_player.is_dead {
            continue;
        }
        let dx = proposed_x - other_player.position_x;
        let dy = proposed_y - other_player.position_y;
        let dist_sq = dx * dx + dy * dy;
        // Collision if distance is less than sum of radii (PLAYER_RADIUS * 2)
        if dist_sq < (PLAYER_RADIUS * 2.0 * PLAYER_RADIUS * 2.0) { 
            log::debug!("[KnockbackCollision] Player ID {:?} would collide with Player ID {:?} at proposed ({:.1}, {:.1}). Reverting knockback.", 
                       colliding_player_id, other_player.identity, proposed_x, proposed_y);
            return (current_x, current_y); // Revert to original position
        }
    }

    // Check against trees
    for tree in ctx.db.tree().iter() {
        if tree.health == 0 { continue; } 
        let tree_collision_center_y = tree.pos_y - TREE_COLLISION_Y_OFFSET;
        let dx = proposed_x - tree.pos_x;
        let dy = proposed_y - tree_collision_center_y;
        if (dx * dx + dy * dy) < PLAYER_TREE_COLLISION_DISTANCE_SQUARED {
            log::debug!("[KnockbackCollision] Player ID {:?} would collide with Tree ID {} at proposed ({:.1}, {:.1}). Reverting knockback.", 
                       colliding_player_id, tree.id, proposed_x, proposed_y);
            return (current_x, current_y);
        }
    }
    
    // Check against stones
    for stone in ctx.db.stone().iter() {
        if stone.health == 0 { continue; }
        let stone_collision_center_y = stone.pos_y - STONE_COLLISION_Y_OFFSET;
        let dx = proposed_x - stone.pos_x;
        let dy = proposed_y - stone_collision_center_y;
        if (dx * dx + dy * dy) < PLAYER_STONE_COLLISION_DISTANCE_SQUARED {
            log::debug!("[KnockbackCollision] Player ID {:?} would collide with Stone ID {} at proposed ({:.1}, {:.1}). Reverting knockback.", 
                       colliding_player_id, stone.id, proposed_x, proposed_y);
            return (current_x, current_y);
        }
    }

    // Check against WoodenStorageBoxes
    for box_entity in ctx.db.wooden_storage_box().iter() {
        if box_entity.is_destroyed { continue; }
        let box_collision_center_y = box_entity.pos_y - BOX_COLLISION_Y_OFFSET;
        let dx = proposed_x - box_entity.pos_x;
        let dy = proposed_y - box_collision_center_y;
        let player_box_collision_dist_sq = (PLAYER_RADIUS + BOX_COLLISION_RADIUS) * (PLAYER_RADIUS + BOX_COLLISION_RADIUS);
        if (dx * dx + dy * dy) < player_box_collision_dist_sq {
            log::debug!("[KnockbackCollision] Player ID {:?} would collide with Box ID {} at proposed ({:.1}, {:.1}). Reverting knockback.", 
                       colliding_player_id, box_entity.id, proposed_x, proposed_y);
            return (current_x, current_y);
        }
    }
    
    // Check against Campfires
    for campfire in ctx.db.campfire().iter() {
        if campfire.is_destroyed { continue; }
        let campfire_collision_center_y = campfire.pos_y - CAMPFIRE_COLLISION_Y_OFFSET;
        let dx = proposed_x - campfire.pos_x;
        let dy = proposed_y - campfire_collision_center_y;
        let player_campfire_collision_dist_sq = (PLAYER_RADIUS + CAMPFIRE_COLLISION_RADIUS) * (PLAYER_RADIUS + CAMPFIRE_COLLISION_RADIUS);
        if (dx * dx + dy * dy) < player_campfire_collision_dist_sq {
            log::debug!("[KnockbackCollision] Player ID {:?} would collide with Campfire ID {} at proposed ({:.1}, {:.1}). Reverting knockback.", 
                       colliding_player_id, campfire.id, proposed_x, proposed_y);
            return (current_x, current_y);
        }
    }

    // Check against SleepingBags
    for bag in ctx.db.sleeping_bag().iter() {
        if bag.is_destroyed { continue; }
        let bag_collision_center_y = bag.pos_y - SLEEPING_BAG_COLLISION_Y_OFFSET;
        let dx = proposed_x - bag.pos_x;
        let dy = proposed_y - bag_collision_center_y;
        let player_bag_collision_dist_sq = (PLAYER_RADIUS + SLEEPING_BAG_COLLISION_RADIUS) * (PLAYER_RADIUS + SLEEPING_BAG_COLLISION_RADIUS);
        if (dx * dx + dy * dy) < player_bag_collision_dist_sq {
             log::debug!("[KnockbackCollision] Player ID {:?} would collide with SleepingBag ID {} at proposed ({:.1}, {:.1}). Reverting knockback.", 
                       colliding_player_id, bag.id, proposed_x, proposed_y);
            return (current_x, current_y);
        }
    }
    
    // Note: Stashes are typically not solid. Add collision check if their behavior changes.

    // If no collisions, return the (boundary-clamped) proposed position
    (proposed_x, proposed_y)
} 