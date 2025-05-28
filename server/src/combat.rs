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
use crate::grass;

// Specific constants needed
use crate::tree::{MIN_TREE_RESPAWN_TIME_SECS, MAX_TREE_RESPAWN_TIME_SECS, TREE_COLLISION_Y_OFFSET, PLAYER_TREE_COLLISION_DISTANCE_SQUARED};
use crate::stone::{MIN_STONE_RESPAWN_TIME_SECS, MAX_STONE_RESPAWN_TIME_SECS, STONE_COLLISION_Y_OFFSET, PLAYER_STONE_COLLISION_DISTANCE_SQUARED};
use crate::wooden_storage_box::{WoodenStorageBox, BOX_COLLISION_RADIUS, BOX_COLLISION_Y_OFFSET, wooden_storage_box as WoodenStorageBoxTableTrait};
use crate::grass::grass as GrassTableTrait;

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
use crate::shelter::Shelter; // Ensure Shelter struct is imported
use crate::shelter::shelter as ShelterTableTrait; // Ensure Shelter table trait is imported
use crate::shelter::{SHELTER_AABB_HALF_WIDTH, SHELTER_AABB_HALF_HEIGHT, SHELTER_AABB_CENTER_Y_OFFSET_FROM_POS_Y}; // Import AABB constants
use crate::active_effects::{self, ActiveConsumableEffect, EffectType, active_consumable_effect as ActiveConsumableEffectTableTrait};
use crate::consumables::MAX_HEALTH_VALUE;
// Import the armor module
use crate::armor;
// Player inventory imports (commented out previously, keeping them commented if unresolved)
// use crate::player_inventory::{drop_all_inventory_on_death, drop_all_equipped_armor_on_death};
// Import the player stats module
use crate::player_stats;
// Import the utils module
use crate::utils::get_distance_squared;
// Import grass respawn types
use crate::grass::{GrassRespawnData, GrassRespawnSchedule, GRASS_INITIAL_HEALTH};
use crate::grass::grass_respawn_schedule as GrassRespawnScheduleTableTrait;
// Import knocked out recovery function and types (re-exported from lib.rs)
use crate::{schedule_knocked_out_recovery, KnockedOutRecoverySchedule};
use crate::knocked_out::knocked_out_recovery_schedule as KnockedOutRecoveryScheduleTableTrait;
use crate::death_marker; // Ensure module is used
use crate::death_marker::death_marker as DeathMarkerTableTrait; // Ensure trait is used
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
    Grass(u64),
    Shelter(u32),
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

/// Checks if a line of sight between two points is blocked by shelter walls
///
/// Returns true if the line is blocked by any shelter that neither player owns.
fn is_line_blocked_by_shelter(
    ctx: &ReducerContext,
    attacker_id: Identity,
    target_id: Option<Identity>, // None for non-player targets
    start_x: f32,
    start_y: f32,
    end_x: f32,
    end_y: f32,
) -> bool {
    // Delegate to shelter module
    crate::shelter::is_line_blocked_by_shelter(ctx, attacker_id, target_id, start_x, start_y, end_x, end_y)
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
                // NEW: Check if line of sight is blocked by shelter walls
                log::debug!(
                    "[TargetAcquisition] Checking line of sight from Player {:?} to Player {:?}",
                    player.identity, other_player.identity
                );
                
                if is_line_blocked_by_shelter(
                    ctx,
                    player.identity,
                    Some(other_player.identity),
                    player.position_x,
                    player.position_y,
                    other_player.position_x,
                    other_player.position_y,
                ) {
                    log::info!(
                        "[TargetAcquisition] TARGET FILTERED! Player {:?} cannot target Player {:?}: line of sight blocked by shelter",
                        player.identity, other_player.identity
                    );
                    continue; // Skip this target - blocked by shelter
                } else {
                    log::debug!(
                        "[TargetAcquisition] Line of sight clear - adding Player {:?} as target",
                        other_player.identity
                    );
                }
                
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
                // NEW: Check if line of sight is blocked by shelter walls
                if is_line_blocked_by_shelter(
                    ctx,
                    player.identity,
                    None, // No target player ID for campfires
                    player.position_x,
                    player.position_y,
                    campfire_entity.pos_x,
                    target_y,
                ) {
                    log::debug!(
                        "Player {:?} cannot attack Campfire {}: line of sight blocked by shelter",
                        player.identity, campfire_entity.id
                    );
                    continue; // Skip this target - blocked by shelter
                }
                
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
                // NEW: Check if line of sight is blocked by shelter walls
                if is_line_blocked_by_shelter(
                    ctx,
                    player.identity,
                    None, // No target player ID for storage boxes
                    player.position_x,
                    player.position_y,
                    box_entity.pos_x,
                    target_y,
                ) {
                    log::debug!(
                        "Player {:?} cannot attack WoodenStorageBox {}: line of sight blocked by shelter",
                        player.identity, box_entity.id
                    );
                    continue; // Skip this target - blocked by shelter
                }
                
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
                // NEW: Check if line of sight is blocked by shelter walls
                if is_line_blocked_by_shelter(
                    ctx,
                    player.identity,
                    None, // No target player ID for stashes
                    player.position_x,
                    player.position_y,
                    stash_entity.pos_x,
                    stash_entity.pos_y,
                ) {
                    log::debug!(
                        "Player {:?} cannot attack Stash {}: line of sight blocked by shelter",
                        player.identity, stash_entity.id
                    );
                    continue; // Skip this target - blocked by shelter
                }
                
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
                // NEW: Check if line of sight is blocked by shelter walls
                if is_line_blocked_by_shelter(
                    ctx,
                    player.identity,
                    None, // No target player ID for sleeping bags
                    player.position_x,
                    player.position_y,
                    bag_entity.pos_x,
                    target_y,
                ) {
                    log::debug!(
                        "Player {:?} cannot attack SleepingBag {}: line of sight blocked by shelter",
                        player.identity, bag_entity.id
                    );
                    continue; // Skip this target - blocked by shelter
                }
                
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
                // NEW: Check if line of sight is blocked by shelter walls
                if is_line_blocked_by_shelter(
                    ctx,
                    player.identity,
                    None, // No target player ID for corpses
                    player.position_x,
                    player.position_y,
                    corpse_entity.pos_x,
                    target_y,
                ) {
                    log::debug!(
                        "Player {:?} cannot attack PlayerCorpse {}: line of sight blocked by shelter",
                        player.identity, corpse_entity.id
                    );
                    continue; // Skip this target - blocked by shelter
                }
                
                targets.push(Target {
                    target_type: TargetType::PlayerCorpse,
                    id: TargetId::PlayerCorpse(corpse_entity.id),
                    distance_sq: dist_sq,
                });
            }
        }
    }

    // Check Grass
    for grass_entity in ctx.db.grass().iter() {
        if grass_entity.health == 0 { continue; } // Skip already destroyed grass
        
        // --- NEW: Skip Brambles from targeting ---
        if grass_entity.appearance_type.is_bramble() {
            continue; // Skip bramble types
        }
        // --- END NEW ---

        let dx = grass_entity.pos_x - player.position_x;
        // Grass Y-offset is likely less significant than trees/stones, using a smaller or no offset
        // For now, let's assume its base position is fine for targeting.
        let dy = grass_entity.pos_y - player.position_y; 
        let dist_sq = dx * dx + dy * dy;
        
        if dist_sq < (attack_range * attack_range) && dist_sq > 0.0 {
            let distance = dist_sq.sqrt();
            let target_vec_x = dx / distance;
            let target_vec_y = dy / distance;

            let dot_product = forward_x * target_vec_x + forward_y * target_vec_y;
            let angle_rad = dot_product.acos();

            if angle_rad <= half_attack_angle_rad {
                targets.push(Target {
                    target_type: TargetType::Grass,
                    id: TargetId::Grass(grass_entity.id),
                    distance_sq: dist_sq,
                });
            }
        }
    }
    
    // Check Shelters - delegate to shelter module
    crate::shelter::add_shelter_targets_to_cone(ctx, player, attack_range, half_attack_angle_rad, forward_x, forward_y, &mut targets);
    
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

/// Determines if a target type represents a destructible deployable structure
/// This makes the system generic for future deployables
fn is_destructible_deployable(target_type: TargetType) -> bool {
    matches!(target_type, 
        TargetType::Campfire | 
        TargetType::WoodenStorageBox | 
        TargetType::SleepingBag | 
        TargetType::Stash |
        TargetType::Shelter
    )
}

/// Grants resource items to a player based on what they hit
///
/// Looks up the proper resource definition and adds it to the player's inventory.
/// If inventory is full, items are automatically dropped near the player.
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
        
    // Use our new system that automatically drops items if inventory is full
    match crate::dropped_item::try_give_item_to_player(ctx, player_id, resource_def.id, amount) {
        Ok(added_to_inventory) => {
            if !added_to_inventory {
                log::info!("[GrantResource] Inventory full for player {}. Dropped {} {} near player.", 
                         player_id, amount, resource_name);
            }
            Ok(())
        }
        Err(e) => Err(format!("Failed to grant {} to player: {}", resource_name, e))
    }
}

/// Calculates damage amount based on item definition, target type, and RNG.
/// Returns a random f32 damage value within the defined min/max range for the interaction.
pub fn calculate_damage_and_yield(
    item_def: &ItemDefinition, 
    target_type: TargetType,
    rng: &mut impl Rng,
) -> (f32, u32, String) {
    let mut damage = 1.0; // Default damage
    let mut yield_qty = 0;
    let mut resource_name = "".to_string();

    // Check if the target type is the item's primary target type FIRST
    if Some(target_type) == item_def.primary_target_type {
        let min_dmg = item_def.primary_target_damage_min.unwrap_or(0) as f32;
        let max_dmg = item_def.primary_target_damage_max.unwrap_or(min_dmg as u32) as f32;
        
        damage = if min_dmg >= max_dmg {
            min_dmg
        } else {
            rng.gen_range(min_dmg..=max_dmg)
        };

        let min_yield = item_def.primary_target_yield_min.unwrap_or(0);
        let max_yield = item_def.primary_target_yield_max.unwrap_or(min_yield);
        
        yield_qty = if min_yield >= max_yield {
            min_yield
        } else {
            rng.gen_range(min_yield..=max_yield)
        };
        resource_name = item_def.primary_yield_resource_name.clone().unwrap_or_default();
        
        return (damage, yield_qty, resource_name);
    }

    // Check for PvP damage for Players, Animals, AND Deployable Structures
    if target_type == TargetType::Player || target_type == TargetType::Animal || is_destructible_deployable(target_type) {
        let min_pvp_dmg = item_def.pvp_damage_min.unwrap_or(0) as f32;
        let max_pvp_dmg = item_def.pvp_damage_max.unwrap_or(min_pvp_dmg as u32) as f32;
        if max_pvp_dmg > 0.0 { // Only override default if PvP damage is defined
            damage = if min_pvp_dmg >= max_pvp_dmg {
                min_pvp_dmg
            } else {
                rng.gen_range(min_pvp_dmg..=max_pvp_dmg)
            };
            
            // For players and animals, no yield. For deployables, they handle their own item drops in their respective damage functions
            return (damage, 0, "".to_string());
        }
    }

    // NEW: Handle PlayerCorpse target type for fixed damage
    if target_type == TargetType::PlayerCorpse {
        // Player corpses always take a fixed amount of damage to ensure consistent hits to destroy.
        // Yield is handled separately in damage_player_corpse.
        return (25.0, 0, "".to_string());
    }

    // Fallback for non-primary targets (or if primary_target_type is None)
    // Apply default damage (1.0), no yield for most other PvE targets unless specified
    if target_type == TargetType::Grass {
        // Grass is destroyed in one hit if any damage is applied.
        // The actual health is 1, so any positive damage destroys it.
        // No yield.
        return (1.0, 0, "".to_string());
    }
    
    // NEW: Fallback harvesting for tools on harvestable resources
    // Any tool should be able to harvest minimal amounts from trees and stones
    if item_def.category == crate::items::ItemCategory::Tool {
        // Exclude certain specialized tools that shouldn't harvest basic resources
        let excluded_tools = [
            "Repair Hammer",    // For repairing structures, not harvesting
            "Blueprint",        // For building/placing structures
            "Bone Knife",       // Specialized for corpse harvesting only
            "Bandage",          // Medical tool, not for harvesting
            "Torch"
        ];
        
        if !excluded_tools.contains(&item_def.name.as_str()) {
            match target_type {
                TargetType::Tree => {
                    // Tools can harvest wood, but at minimal efficiency
                    let fallback_damage = item_def.primary_target_damage_min.unwrap_or(5) as f32 * 0.5; // 50% of normal damage
                    let fallback_yield = rng.gen_range(5..=10); // Random 5-10 wood per hit
                    return (fallback_damage, fallback_yield, "Wood".to_string());
                },
                TargetType::Stone => {
                    // Tools can harvest stone, but at minimal efficiency  
                    let fallback_damage = item_def.primary_target_damage_min.unwrap_or(5) as f32 * 0.5; // 50% of normal damage
                    let fallback_yield = rng.gen_range(5..=10); // Random 5-10 stone per hit
                    return (fallback_damage, fallback_yield, "Stone".to_string());
                },
                _ => {
                    // For other target types, use default behavior
                }
            }
        }
    }
    
    // For other destructibles that don't match any of the above conditions,
    // they get the default 1.0 damage.
    // No direct yield from this function for them.
    (damage, yield_qty, resource_name)
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
        let respawn_time = timestamp + TimeDuration::from_micros(respawn_duration_secs as i64 * 1_000_000);
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
        let respawn_time = timestamp + TimeDuration::from_micros(respawn_duration_secs as i64 * 1_000_000);
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
    target_player.health = (target_player.health - final_damage).clamp(0.0, MAX_HEALTH_VALUE);
    let actual_damage_applied = old_health - target_player.health; // This is essentially final_damage clamped by remaining health

    // --- APPLY KNOCKBACK and update timestamp if damage was dealt ---
    if actual_damage_applied > 0.0 { // Only apply knockback and update timestamp if actual damage occurred
        target_player.last_update = timestamp; // Update target's timestamp due to health change and potential knockback

        if let Some(mut attacker) = attacker_player_opt.clone() { // Clone attacker_player_opt to get a mutable attacker if needed
            // --- CHECK: Only apply knockback if both players are online ---
            let should_apply_knockback = attacker.is_online && target_player.is_online;
            
            if should_apply_knockback {
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

                    // --- MODIFIED: Only apply recoil if it's not a ranged weapon --- 
                    if item_def.category != crate::items::ItemCategory::RangedWeapon {
                        let attacker_recoil_distance = PVP_KNOCKBACK_DISTANCE / 3.0; 
                        let knockback_dx_attacker = (-dx_target_from_attacker / distance) * attacker_recoil_distance; 
                        let knockback_dy_attacker = (-dy_target_from_attacker / distance) * attacker_recoil_distance; 
                        
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
                        attacker.last_update = timestamp; 
                        players.identity().update(attacker.clone()); 
                        log::debug!("Applied recoil to attacking player {:?}: new pos ({:.1}, {:.1})", 
                            attacker_id, attacker.position_x, attacker.position_y);
                    } else {
                        log::debug!("Skipping recoil for attacker {:?} because a ranged weapon ({}) was used.", attacker_id, item_def.name);
                    }
                    // --- END MODIFICATION ---
                }
            } else {
                log::debug!("Skipping knockback for attack between {:?} and {:?} because one or both players are offline (attacker online: {}, target online: {})", 
                    attacker_id, target_id, attacker.is_online, target_player.is_online);
            }
        }
    }
    // --- END KNOCKBACK ---

    let killed = target_player.health <= 0.0;

    log::info!(
        "Player {:?} damaged Player {:?} for {:.2} (raw: {:.2}) with {}. Health: {:.2} -> {:.2}",
        attacker_id, target_id, actual_damage_applied, damage, item_def.name, old_health, target_player.health
    );

    // DEBUG: Log the state before knocked out logic
    log::info!(
        "[DEBUG] Player {:?} state: health={:.2}, killed={}, is_knocked_out={}, actual_damage={:.2}",
        target_id, target_player.health, killed, target_player.is_knocked_out, actual_damage_applied
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
                target_player_id: None, // Add this line
                item_def_id: item_def.id,
                consuming_item_instance_id: None,
                started_at: timestamp,
                ends_at: timestamp + TimeDuration::from_micros((duration_sec * 1_000_000.0) as i64),
                total_amount: Some(bleed_total_damage),
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

    // NEW: Handle knocked out state and death logic
    if target_player.is_knocked_out && actual_damage_applied > 0.0 {
        // Player is already knocked out and took damage - they die immediately
        log::info!("[DEBUG] Branch 1: Player {:?} was hit while knocked out and dies immediately", target_id);
        
        target_player.is_knocked_out = false;
        target_player.knocked_out_at = None;
        target_player.is_dead = true;
        target_player.death_timestamp = Some(timestamp);
        target_player.health = 0.0;

        // Cancel any recovery schedule - find by player_id since we don't have schedule_id
        let schedules_to_remove: Vec<u64> = ctx.db.knocked_out_recovery_schedule().iter()
            .filter(|schedule| schedule.player_id == target_id)
            .map(|schedule| schedule.schedule_id)
            .collect();
        
        for schedule_id in schedules_to_remove {
            ctx.db.knocked_out_recovery_schedule().schedule_id().delete(&schedule_id);
            log::info!("[CombatDeath] Canceled recovery schedule {} for player {:?} who died while knocked out", schedule_id, target_id);
        }

        // Clear active item and create corpse
        match crate::active_equipment::clear_active_item_reducer(ctx, target_player.identity) {
            Ok(_) => log::info!("[PlayerDeath] Active item cleared for dying player {}", target_player.identity),
            Err(e) => log::error!("[PlayerDeath] Failed to clear active item for dying player {}: {}", target_player.identity, e),
        }

        match create_player_corpse(ctx, target_player.identity, target_player.position_x, target_player.position_y, &target_player.username) {
            Ok(_) => {
                log::info!("Successfully created corpse via combat death for player {:?}", target_id);
            }
            Err(e) => {
                log::error!("Failed to create corpse via combat death for player {:?}: {}", target_id, e);
            }
        }
        players.identity().update(target_player.clone());
        log::info!("Player {:?} marked as dead after being hit while knocked out.", target_id);

        // --- Create/Update DeathMarker ---
        let new_death_marker = death_marker::DeathMarker {
            player_id: target_player.identity,
            pos_x: target_player.position_x,
            pos_y: target_player.position_y,
            death_timestamp: timestamp, // Use the combat timestamp
            killed_by: Some(attacker_id), // Track who killed this player
            death_cause: "Combat".to_string(), // Death due to PvP combat
        };
        let death_marker_table = ctx.db.death_marker();
        if death_marker_table.player_id().find(&target_player.identity).is_some() {
            death_marker_table.player_id().update(new_death_marker);
            log::info!("[DeathMarker] Updating death marker for player {:?} due to combat death.", target_player.identity);
        } else {
            death_marker_table.insert(new_death_marker);
            log::info!("[DeathMarker] Inserting new death marker for player {:?} due to combat death.", target_player.identity);
        }
        // --- End DeathMarker ---

    } else if killed && !target_player.is_knocked_out {
        // Player health reached 0 but they weren't already knocked out - enter knocked out state
        log::info!("[DEBUG] Branch 2: Player {:?} health reached 0, entering knocked out state", target_id);
        
        target_player.is_knocked_out = true;
        target_player.knocked_out_at = Some(timestamp);
        target_player.health = 1.0; // Set to 1 health while knocked out
        target_player.is_dead = false; // Not dead yet, just knocked out

        players.identity().update(target_player.clone());

        // Schedule recovery checks
        match crate::schedule_knocked_out_recovery(ctx, target_id) {
            Ok(_) => log::info!("Recovery checks scheduled for knocked out player {:?}", target_id),
            Err(e) => {
                log::error!("Failed to schedule recovery for knocked out player {:?}: {}. This attack will be rolled back.", target_id, e);
                // CRITICAL: Propagate the error to roll back the transaction
                return Err(format!("Failed to enter knocked out state due to scheduling error: {}", e)); 
            }
        }

    } else if target_player.health > 0.0 {
        // Player is alive and not knocked out. Update normally.
        log::info!("[DEBUG] Branch 3: Player {:?} is alive and not knocked out, updating normally", target_id);
        players.identity().update(target_player);
    } else {
        // This shouldn't happen, but let's log it for debugging
        log::warn!("[DEBUG] Branch 4: Player {:?} in unexpected state - health: {:.2}, is_knocked_out: {}, killed: {}", 
                   target_id, target_player.health, target_player.is_knocked_out, killed);
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
    damage: f32, // Damage already calculated by calculate_damage_and_yield
    item_def: &ItemDefinition, // Pass the full item_def to check its properties
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

    // Determine resources based on RNG and tool
    const BASE_CHANCE_FAT: f64 = 0.50; 
    const BASE_CHANCE_FLESH: f64 = 0.30;
    const BASE_CHANCE_BONE: f64 = 0.20;
    // Multipliers for specific tools and general categories
    const BONE_KNIFE_MULTIPLIER: f64 = 5.0;
    const BONE_CLUB_MULTIPLIER: f64 = 3.0;
    const PRIMARY_CORPSE_TOOL_MULTIPLIER: f64 = 1.0;
    const NON_PRIMARY_ITEM_MULTIPLIER: f64 = 0.1; // For non-primary items when harvesting corpses

    let effectiveness_multiplier = match item_def.name.as_str() {
        "Bone Knife" => BONE_KNIFE_MULTIPLIER,
        "Bone Club" => BONE_CLUB_MULTIPLIER,
        _ => {
            if item_def.primary_target_type == Some(TargetType::PlayerCorpse) {
                PRIMARY_CORPSE_TOOL_MULTIPLIER
            } else {
                NON_PRIMARY_ITEM_MULTIPLIER
            }
        }
    };
    
    let actual_chance_fat = (BASE_CHANCE_FAT * effectiveness_multiplier).clamp(0.0, BASE_CHANCE_FAT);
    let actual_chance_flesh = (BASE_CHANCE_FLESH * effectiveness_multiplier).clamp(0.0, BASE_CHANCE_FLESH);
    let actual_chance_bone = (BASE_CHANCE_BONE * effectiveness_multiplier).clamp(0.0, BASE_CHANCE_BONE);

    log::debug!(
        "[DamagePlayerCorpse:{}] Effectiveness: {:.2}. Chances: Fat({:.2}), Flesh({:.2}), Bone({:.2})",
        corpse_id, effectiveness_multiplier, actual_chance_fat, actual_chance_flesh, actual_chance_bone
    );

    // Determine quantity based on tool, introducing randomization for specialized tools
    let quantity_per_successful_hit = match item_def.name.as_str() {
        "Bone Knife" => rng.gen_range(3..=5),
        "Bone Club" => rng.gen_range(2..=4),
        _ => { // Default for other items
            if item_def.primary_target_type == Some(TargetType::PlayerCorpse) && item_def.category == ItemCategory::Tool {
                rng.gen_range(1..=2) // Other primary tools for corpses
            } else if item_def.category == ItemCategory::Tool {
                1 // Non-primary tools get a fixed minimal yield
            } else {
                1 // Non-tool items also get a fixed minimal yield (if they pass the low chance)
            }
        }
    };

    // Example: 50% chance to get 1 Animal Fat per hit, if corpse still has health
    if corpse.health > 0 && rng.gen_bool(actual_chance_fat) {
        match grant_resource(ctx, attacker_id, "Animal Fat", quantity_per_successful_hit) {
            Ok(_) => resources_granted.push(("Animal Fat".to_string(), quantity_per_successful_hit)),
            Err(e) => log::error!("Failed to grant Animal Fat: {}", e),
        }
    }

    // Example: 30% chance to get 1 Raw Human Flesh per hit
    if corpse.health > 0 && rng.gen_bool(actual_chance_flesh) {
        match grant_resource(ctx, attacker_id, "Raw Human Flesh", quantity_per_successful_hit) {
            Ok(_) => resources_granted.push(("Raw Human Flesh".to_string(), quantity_per_successful_hit)),
            Err(e) => log::error!("Failed to grant Raw Human Flesh: {}", e),
        }
    }
    
    // Example: 20% chance to get 1 Animal Bone per hit
    if corpse.health > 0 && rng.gen_bool(actual_chance_bone) {
        match grant_resource(ctx, attacker_id, "Animal Bone", quantity_per_successful_hit) {
            Ok(_) => resources_granted.push(("Animal Bone".to_string(), quantity_per_successful_hit)),
            Err(e) => log::error!("Failed to grant Animal Bone: {}", e),
        }
    }

    if corpse.health == 0 {
        log::info!("[DamagePlayerCorpse:{}] Corpse depleted by Player {:?} using item {} (category {:?}, multiplier {:.1}). Checking for Human Skull grant.", 
                 corpse_id, attacker_id, item_def.name, item_def.category, effectiveness_multiplier);
        
        // Grant Human Skulls based on tool effectiveness, only if the item is a Tool
        if item_def.category == ItemCategory::Tool {
            let skulls_to_grant = match effectiveness_multiplier {
                m if m == BONE_KNIFE_MULTIPLIER => 3, // Bone Knife
                m if m == BONE_CLUB_MULTIPLIER => 2,  // Bone Club
                // Includes PRIMARY_CORPSE_TOOL_MULTIPLIER (1.0) 
                // and NON_PRIMARY_ITEM_MULTIPLIER (0.1) if it's a tool, resulting in 1 skull
                _ => 1, 
            };

            if skulls_to_grant > 0 {
                match grant_resource(ctx, attacker_id, "Human Skull", skulls_to_grant) {
                    Ok(_) => {
                        resources_granted.push(("Human Skull".to_string(), skulls_to_grant));
                        log::info!(
                            "[DamagePlayerCorpse:{}] Granted {} Human Skull(s) to Player {:?} (using {} with multiplier {:.1}).",
                            corpse_id, skulls_to_grant, attacker_id, item_def.name, effectiveness_multiplier
                        );
                    }
                    Err(e) => log::error!(
                        "[DamagePlayerCorpse:{}] Failed to grant Human Skull(s) to Player {:?}: {}",
                        corpse_id, attacker_id, e
                    ),
                }
            } else {
                 log::info!(
                    "[DamagePlayerCorpse:{}] Corpse depleted, item {} (category {:?}) is a tool but effectiveness multiplier {:.1} resulted in 0 skulls.",
                    corpse_id, item_def.name, item_def.category, effectiveness_multiplier
                );
            }
        } else {
            log::info!(
                "[DamagePlayerCorpse:{}] Corpse depleted, but item used ({}, category {:?}) was not a Tool. Human Skull not granted.",
                corpse_id, item_def.name, item_def.category
            );
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
    // NEW: Check line of sight before processing any attack
    let (target_x, target_y, target_player_id) = match &target.id {
        TargetId::Player(player_id) => {
            if let Some(target_player) = ctx.db.player().identity().find(player_id) {
                (target_player.position_x, target_player.position_y, Some(*player_id))
            } else {
                return Err("Target player not found".to_string());
            }
        },
        TargetId::Tree(tree_id) => {
            if let Some(tree) = ctx.db.tree().id().find(tree_id) {
                (tree.pos_x, tree.pos_y - TREE_COLLISION_Y_OFFSET, None)
            } else {
                return Err("Target tree not found".to_string());
            }
        },
        TargetId::Stone(stone_id) => {
            if let Some(stone) = ctx.db.stone().id().find(stone_id) {
                (stone.pos_x, stone.pos_y - STONE_COLLISION_Y_OFFSET, None)
            } else {
                return Err("Target stone not found".to_string());
            }
        },
        TargetId::Campfire(campfire_id) => {
            if let Some(campfire) = ctx.db.campfire().id().find(campfire_id) {
                const VISUAL_CENTER_Y_OFFSET: f32 = 42.0;
                (campfire.pos_x, campfire.pos_y - VISUAL_CENTER_Y_OFFSET, None)
            } else {
                return Err("Target campfire not found".to_string());
            }
        },
        TargetId::WoodenStorageBox(box_id) => {
            if let Some(storage_box) = ctx.db.wooden_storage_box().id().find(box_id) {
                (storage_box.pos_x, storage_box.pos_y - BOX_COLLISION_Y_OFFSET, None)
            } else {
                return Err("Target storage box not found".to_string());
            }
        },
        TargetId::Stash(stash_id) => {
            if let Some(stash) = ctx.db.stash().id().find(stash_id) {
                (stash.pos_x, stash.pos_y, None)
            } else {
                return Err("Target stash not found".to_string());
            }
        },
        TargetId::SleepingBag(bag_id) => {
            if let Some(bag) = ctx.db.sleeping_bag().id().find(bag_id) {
                (bag.pos_x, bag.pos_y - SLEEPING_BAG_COLLISION_Y_OFFSET, None)
            } else {
                return Err("Target sleeping bag not found".to_string());
            }
        },
        TargetId::PlayerCorpse(corpse_id) => {
            if let Some(corpse) = ctx.db.player_corpse().id().find(corpse_id) {
                (corpse.pos_x, corpse.pos_y - player_corpse::CORPSE_COLLISION_Y_OFFSET, None)
            } else {
                return Err("Target corpse not found".to_string());
            }
        },
        TargetId::Grass(grass_id) => {
            if let Some(grass) = ctx.db.grass().id().find(grass_id) {
                (grass.pos_x, grass.pos_y, None)
            } else {
                return Err("Target grass not found".to_string());
            }
        },
        TargetId::Shelter(shelter_id) => {
            if let Some(shelter) = ctx.db.shelter().id().find(shelter_id) {
                // Use shelter module function to get target coordinates
                let (target_x, target_y) = crate::shelter::get_shelter_target_coordinates(&shelter);
                (target_x, target_y, None)
            } else {
                return Err("Target shelter not found".to_string());
            }
        },
    };

    // Get attacker position
    let attacker = ctx.db.player().identity().find(&attacker_id)
        .ok_or_else(|| "Attacker not found".to_string())?;

    // Check if line of sight is blocked by shelter walls
    // EXCEPTION: If the target itself is a shelter, allow the attack (direct shelter damage)
    let target_is_shelter = matches!(target.id, TargetId::Shelter(_));
    
    log::debug!(
        "[ProcessAttack] Checking line of sight from Player {:?} at ({:.1}, {:.1}) to target {:?} at ({:.1}, {:.1}). Target is shelter: {}",
        attacker_id, attacker.position_x, attacker.position_y, target.id, target_x, target_y, target_is_shelter
    );
    
    if !target_is_shelter && is_line_blocked_by_shelter(
        ctx,
        attacker_id,
        target_player_id,
        attacker.position_x,
        attacker.position_y,
        target_x,
        target_y,
    ) {
        log::info!(
            "[ProcessAttack] ATTACK BLOCKED! Player {:?} cannot attack {:?} - line of sight blocked by shelter wall",
            attacker_id, target.id
        );
        return Ok(AttackResult {
            hit: false,
            target_type: Some(target.target_type),
            resource_granted: None,
        });
    } else if target_is_shelter {
        log::debug!(
            "[ProcessAttack] Direct shelter attack - bypassing line-of-sight check for Player {:?} attacking Shelter",
            attacker_id
        );
    } else {
        log::debug!(
            "[ProcessAttack] Line of sight clear - proceeding with attack from Player {:?} to {:?}",
            attacker_id, target.id
        );
    }

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
            // Removed harvest_power from the call, pass item_def instead
            damage_player_corpse(ctx, attacker_id, *corpse_id, damage, item_def, timestamp, rng)
        },
        TargetId::Grass(grass_id) => {
            damage_grass(ctx, attacker_id, *grass_id, damage, timestamp, rng)
        },
        TargetId::Shelter(shelter_id) => {
            crate::shelter::damage_shelter(ctx, attacker_id, *shelter_id, damage, timestamp, rng)
        },
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

    // Check against other players (solid collision)
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

    // Check against trees (solid collision)
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
    
    // Check against stones (solid collision)
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

    // Check against WoodenStorageBoxes (solid collision)
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
    
    // REMOVED: Campfire collision check - players can be knocked back over campfires
    // REMOVED: SleepingBag collision check - players can be knocked back over sleeping bags
    // NOTE: Stashes were already not checked - players can be knocked back over stashes

    // If no collisions with solid objects, return the (boundary-clamped) proposed position
    (proposed_x, proposed_y)
}

// --- NEW: Damage Grass Function ---
pub fn damage_grass(
    ctx: &ReducerContext,
    attacker_id: Identity,
    grass_id: u64,
    damage: f32,
    timestamp: Timestamp,
    rng: &mut impl Rng
) -> Result<AttackResult, String> {
    let grass_table = ctx.db.grass();
    if let Some(grass_entity) = grass_table.id().find(&grass_id) { // Make grass_entity immutable here
        if grass_entity.health == 0 {
            return Ok(AttackResult { hit: false, target_type: Some(TargetType::Grass), resource_granted: None }); // Already destroyed
        }

        // --- NEW: Check if this grass type is a bramble (indestructible) ---
        if grass_entity.appearance_type.is_bramble() {
            log::info!("Grass ID {} (bramble type {:?}) hit by {} but brambles are indestructible. No damage applied.", 
                      grass_id, grass_entity.appearance_type, attacker_id);
            return Ok(AttackResult { hit: false, target_type: Some(TargetType::Grass), resource_granted: None });
        }

        let current_health = grass_entity.health;
        let new_health = (current_health as f32 - damage).max(0.0) as u32;

        log::info!("Grass ID {} hit by {}, health: {} -> {}", grass_id, attacker_id, current_health, new_health);

        if new_health == 0 {
            log::info!("Grass ID {} destroyed by {}. Scheduling respawn.", grass_id, attacker_id);
            
            // Prepare data for respawn schedule
            let respawn_data = GrassRespawnData {
                pos_x: grass_entity.pos_x,
                pos_y: grass_entity.pos_y,
                appearance_type: grass_entity.appearance_type.clone(),
                chunk_index: grass_entity.chunk_index,
                sway_offset_seed: grass_entity.sway_offset_seed,
                sway_speed: grass_entity.sway_speed, // Use the renamed field
            };

            let respawn_delay_secs = rng.gen_range(crate::grass::MIN_GRASS_RESPAWN_TIME_SECS..=crate::grass::MAX_GRASS_RESPAWN_TIME_SECS);
            let respawn_at_timestamp = timestamp + TimeDuration::from_micros(respawn_delay_secs as i64 * 1_000_000);

            let schedule_entry = GrassRespawnSchedule {
                schedule_id: 0, // Auto-incremented by SpacetimeDB
                respawn_data,
                scheduled_at: respawn_at_timestamp.into(), // Convert Timestamp to ScheduleAt
            };

            // Insert into the respawn schedule table
            match ctx.db.grass_respawn_schedule().try_insert(schedule_entry) {
                Ok(_) => log::info!("Grass ID {} respawn scheduled for {:?}", grass_id, respawn_at_timestamp),
                Err(e) => log::error!("Failed to schedule respawn for grass ID {}: {}", grass_id, e),
            }

            // Delete the original grass entity
            grass_table.id().delete(&grass_id);
            
            Ok(AttackResult { hit: true, target_type: Some(TargetType::Grass), resource_granted: None })
        } else {
            // Grass still has health, update it
            let mut mutable_grass_entity = grass_entity.clone(); // Clone to make it mutable for update
            mutable_grass_entity.health = new_health;
            mutable_grass_entity.last_hit_time = Some(timestamp);
            grass_table.id().update(mutable_grass_entity);
            Ok(AttackResult { hit: true, target_type: Some(TargetType::Grass), resource_granted: None })
        }
    } else {
        Err(format!("Grass with ID {} not found.", grass_id))
    }
}

