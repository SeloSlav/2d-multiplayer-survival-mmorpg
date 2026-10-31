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
use crate::world_state::world_state as WorldStateTableTrait;
use crate::PLAYER_RADIUS;
use crate::{WORLD_WIDTH_PX, WORLD_HEIGHT_PX};
use crate::items::{ItemDefinition, ItemCategory};
use crate::models::{TargetType, DamageType, ImmunityType};
use crate::tree;
use crate::stone;
use crate::rune_stone;
use crate::wooden_storage_box;
use crate::player_corpse;
use crate::broth_pot::{broth_pot, broth_pot_processing_schedule};
use crate::grass; // RE-ADDED: grass module for destroyable grass

// Specific constants needed
use crate::tree::{MIN_TREE_RESPAWN_TIME_SECS, MAX_TREE_RESPAWN_TIME_SECS, TREE_COLLISION_Y_OFFSET, PLAYER_TREE_COLLISION_DISTANCE_SQUARED, tree_type_stats};
use crate::stone::{MIN_STONE_RESPAWN_TIME_SECS, MAX_STONE_RESPAWN_TIME_SECS, STONE_COLLISION_Y_OFFSET, PLAYER_STONE_COLLISION_DISTANCE_SQUARED};
use crate::rune_stone::{RUNE_STONE_AABB_HALF_WIDTH, RUNE_STONE_AABB_HALF_HEIGHT, RUNE_STONE_COLLISION_Y_OFFSET};
use crate::wooden_storage_box::{WoodenStorageBox, get_box_player_collision_radius, get_box_collision_y_offset, wooden_storage_box as WoodenStorageBoxTableTrait};
use crate::grass::grass as GrassTableTrait; // RE-ADDED: grass table trait for destroyable grass
use crate::grass::grass_state as GrassStateTableTrait; // Split tables: GrassState has health
use crate::barbecue::barbecue as BarbecueTableTrait;

// Table trait imports for database access
use crate::tree::tree as TreeTableTrait;
use crate::stone::stone as StoneTableTrait;
use crate::door::door as DoorTableTrait;
use crate::fence::fence as FenceTableTrait;
use crate::rune_stone::rune_stone as RuneStoneTableTrait;
use crate::items::item_definition as ItemDefinitionTableTrait;
use crate::items::inventory_item as InventoryItemTableTrait;
use crate::player as PlayerTableTrait;
use crate::active_equipment::active_equipment as ActiveEquipmentTableTrait;
use crate::dropped_item;
use crate::player_corpse::{PlayerCorpse, PlayerCorpseDespawnSchedule, NUM_CORPSE_SLOTS, create_player_corpse, player_corpse as PlayerCorpseTableTrait, player_corpse_despawn_schedule as PlayerCorpseDespawnScheduleTableTrait};
use crate::inventory_management::ItemContainer;
use crate::environment::{calculate_chunk_index, is_position_on_water};
use crate::campfire::{Campfire, campfire as CampfireTableTrait};
use crate::lantern::{Lantern, lantern as LanternTableTrait};
use crate::turret::{Turret, turret as TurretTableTrait, NUM_AMMO_SLOTS};
use crate::stash::{Stash, stash as StashTableTrait};
use crate::PrivateMessage;
use crate::private_message as PrivateMessageTableTrait;
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
// Import player progression table traits
use crate::player_progression::player_stats as PlayerStatsTableTrait;
// Import the player stats module
use crate::player_stats;
// Import the utils module
use crate::utils::get_distance_squared;
// REMOVED: grass respawn imports - grass collision detection removed for performance
// Import knocked out recovery function and types (re-exported from lib.rs)
use crate::{schedule_knocked_out_recovery, KnockedOutRecoverySchedule};
use crate::knocked_out::knocked_out_recovery_schedule as KnockedOutRecoveryScheduleTableTrait;
use crate::death_marker; // Ensure module is used
use crate::death_marker::death_marker as DeathMarkerTableTrait; // Ensure trait is used
use crate::sound_events; // Import sound events module
// Import rain collector types
use crate::rain_collector::{RainCollector, RAIN_COLLECTOR_COLLISION_RADIUS, RAIN_COLLECTOR_COLLISION_Y_OFFSET, rain_collector as RainCollectorTableTrait};
// Import furnace types
use crate::furnace::{furnace as FurnaceTableTrait};
// Import wild animal types
use crate::wild_animal_npc::wild_animal as WildAnimalTableTrait;
// Import animal corpse types
use crate::wild_animal_npc::animal_corpse::{AnimalCorpse, ANIMAL_CORPSE_COLLISION_Y_OFFSET, animal_corpse as AnimalCorpseTableTrait};
// Import barrel types
use crate::barrel::{Barrel, BARREL_COLLISION_Y_OFFSET, BUOY_COLLISION_Y_OFFSET, BUOY_VARIANT, barrel as BarrelTableTrait};
use crate::homestead_hearth::{HomesteadHearth, HEARTH_COLLISION_Y_OFFSET, homestead_hearth as HomesteadHearthTableTrait};
use crate::coral::{LivingCoral, LIVING_CORAL_COLLISION_Y_OFFSET, LIVING_CORAL_RADIUS, living_coral as LivingCoralTableTrait};
// --- Game Balance Constants ---
/// Time in milliseconds before a dead player can respawn
pub const RESPAWN_TIME_MS: u64 = 5000; // 5 seconds
/// Distance player is knocked back in PvP
pub const PVP_KNOCKBACK_DISTANCE: f32 = 32.0;

// --- PvP Configuration ---
/// Server-wide PvP master switch (compile-time).
/// - `false`: Player vs player damage uses **per-player opt-in** (`/pvp`, timer, combat extension).
/// - `true`: **Always-on PvP** — every player counts as PvP-active for damage, raiding, fire-patch vs players, turrets, etc.
///   Personal `/pvp` state is ignored for those checks (see [`is_pvp_active_for_player`]). XP bonus from `/pvp` still uses
///   [`player_personal_pvp_opt_in_active`] only.
pub const PVP_ENABLED: bool = false;

/// 2× resource yields from dedicated corpse tools; 1× for non-specialized items. Skull/trophy grants stay unscaled.
fn corpse_harvest_yield_multiplier(item_def: &ItemDefinition) -> u32 {
    match item_def.name.as_str() {
        "Bone Knife" | "Bone Club" | "Bush Knife" | "AK74 Bayonet" | "Tidebreaker Blade" => 2,
        _ => {
            if matches!(
                item_def.primary_target_type,
                Some(TargetType::PlayerCorpse) | Some(TargetType::AnimalCorpse)
            ) {
                2
            } else {
                1
            }
        }
    }
}

// --- Bone Totem Configuration ---
/// Distance within which allies count for the Sabaakax Totem pack bonus
/// Set to 1500px to cover most of the visible viewport so pack hunting is viable
const ALLY_DETECTION_RADIUS: f32 = 1500.0;
const ALLY_DETECTION_RADIUS_SQ: f32 = ALLY_DETECTION_RADIUS * ALLY_DETECTION_RADIUS;

/// Combat extension window - if player was in PvP combat within this time, timer can't expire
const PVP_COMBAT_EXTENSION_WINDOW_MICROS: i64 = 5 * 60 * 1_000_000; // 5 minutes

/// `/pvp` timer + combat extension only — **not** affected by [`PVP_ENABLED`]. Use for XP bonus and chat command logic.
pub fn player_personal_pvp_opt_in_active(player: &Player, current_time: Timestamp) -> bool {
    if !player.pvp_enabled {
        return false;
    }
    
    let Some(until) = player.pvp_enabled_until else {
        return false;
    };
    
    if until > current_time {
        return true;
    }
    
    if let Some(last_combat) = player.last_pvp_combat_time {
        let combat_elapsed = current_time.to_micros_since_unix_epoch()
            .saturating_sub(last_combat.to_micros_since_unix_epoch());
        if combat_elapsed < PVP_COMBAT_EXTENSION_WINDOW_MICROS {
            return true;
        }
    }
    
    false
}

/// True if this player may be targeted / counted as PvP-flagged for **combat and raid rules**.
/// When [`PVP_ENABLED`] is `true`, always `true` (opt-in ignored). Otherwise uses [`player_personal_pvp_opt_in_active`].
pub fn is_pvp_active_for_player(player: &Player, current_time: Timestamp) -> bool {
    if PVP_ENABLED {
        return true;
    }
    player_personal_pvp_opt_in_active(player, current_time)
}

/// Updates combat timestamp for both players and extends timer if needed
fn update_pvp_combat_time(ctx: &ReducerContext, player_id: Identity, current_time: Timestamp) {
    if let Some(mut player) = ctx.db.player().identity().find(&player_id) {
        player.last_pvp_combat_time = Some(current_time);
        
        // Auto-extend timer if within 5 minutes of expiry
        if let Some(until) = player.pvp_enabled_until {
            let time_remaining = until.to_micros_since_unix_epoch()
                .saturating_sub(current_time.to_micros_since_unix_epoch());
            if time_remaining < PVP_COMBAT_EXTENSION_WINDOW_MICROS {
                // Extend by 5 minutes from now
                let new_until = Timestamp::from_micros_since_unix_epoch(
                    current_time.to_micros_since_unix_epoch() + PVP_COMBAT_EXTENSION_WINDOW_MICROS
                );
                player.pvp_enabled_until = Some(new_until);
                log::info!("PvP timer extended for {:?} due to active combat", player_id);
            }
        }
        
        ctx.db.player().identity().update(player);
    }
}

/// Checks if a player has any allies (other alive players) within the ally detection radius
/// Used for the Sabaakax Totem (Wolf) pack damage bonus
fn check_for_nearby_allies(ctx: &ReducerContext, player_id: Identity, pos_x: f32, pos_y: f32) -> bool {
    let players = ctx.db.player();
    
    for player in players.iter() {
        // Skip self and dead players
        if player.identity == player_id || player.is_dead {
            continue;
        }
        
        // Check distance
        let dx = player.position_x - pos_x;
        let dy = player.position_y - pos_y;
        let dist_sq = dx * dx + dy * dy;
        
        if dist_sq <= ALLY_DETECTION_RADIUS_SQ {
            return true;
        }
    }
    
    false
}

// --- Combat System Types ---

/// Identifiers for specific combat targets
#[derive(Debug, Clone)]
pub enum TargetId {
    Tree(u64),
    Stone(u64),
    Player(Identity),
    Campfire(u32),
    Lantern(u32),
    WoodenStorageBox(u32),
    Stash(u32),
    SleepingBag(u32),
    PlayerCorpse(u32),
    Grass(u64), // RE-ADDED: Grass target for destroyable grass
    Shelter(u32),
    RainCollector(u32), // ADDED: Rain collector target
    Furnace(u32), // ADDED: Furnace target
    WildAnimal(u64), // ADDED: Wild animal target
    AnimalCorpse(u32), // ADDED: Animal corpse target
    Barrel(u64), // ADDED: Barrel target
    HomesteadHearth(u32), // ADDED: Homestead Hearth target
    Wall(u64), // ADDED: Wall target
    LivingCoral(u64), // ADDED: Living coral target (underwater resource)
    Door(u64), // ADDED: Door target (attackable doors)
    Fence(u64), // ADDED: Fence target
    Barbecue(u32), // ADDED: Barbecue target
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
    // Check walls first (walls block everything)
    if crate::building::is_line_blocked_by_walls(ctx, start_x, start_y, end_x, end_y) {
        return true;
    }
    
    // Then check shelters
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
        // Skip dead/respawning trees (respawn_at > UNIX_EPOCH when tree is destroyed)
        if tree.respawn_at > Timestamp::UNIX_EPOCH {
            continue;
        }
        
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
        // Skip dead/respawning stones (respawn_at > UNIX_EPOCH when stone is destroyed)
        if stone.respawn_at > Timestamp::UNIX_EPOCH {
            continue;
        }
        
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
    
    // Check living corals (underwater resource, requires player to be on water)
    if player.is_on_water {
        for coral in ctx.db.living_coral().iter() {
            // Skip dead/respawning corals (respawn_at > UNIX_EPOCH when destroyed)
            if coral.respawn_at > Timestamp::UNIX_EPOCH {
                continue;
            }
            
            let dx = coral.pos_x - player.position_x;
            let target_y = coral.pos_y - LIVING_CORAL_COLLISION_Y_OFFSET;
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
                        target_type: TargetType::LivingCoral,
                        id: TargetId::LivingCoral(coral.id),
                        distance_sq: dist_sq,
                    });
                }
            }
        }
    }
    
    // Check other players
    for other_player in ctx.db.player().iter() {
        // Skip self, dead players, and OFFLINE players (offline players have a corpse instead)
        if other_player.identity == player.identity || other_player.is_dead || !other_player.is_online {
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

        // Campfire gets +24px range buffer: client attack debug uses predicted position, server uses
        // authoritative position. Small desync makes server reject hits that look in-range on client.
        const CAMPFIRE_RANGE_BUFFER: f32 = 24.0;
        let effective_range = attack_range + CAMPFIRE_RANGE_BUFFER;
        if dist_sq < (effective_range * effective_range) && dist_sq > 0.0 {
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

    // Check lanterns
    for lantern_entity in ctx.db.lantern().iter() {
        if lantern_entity.is_destroyed {
            continue;
        }
        // Skip server event beacons - they are invincible (prevents griefing)
        if crate::beacon_event::is_server_event_beacon(&lantern_entity) {
            continue;
        }
        // Lanterns are smaller objects, use their base position for targeting
        let dx = lantern_entity.pos_x - player.position_x;
        let dy = lantern_entity.pos_y - player.position_y;
        let dist_sq = dx * dx + dy * dy;

        if dist_sq < (attack_range * attack_range) && dist_sq > 0.0 {
            let distance = dist_sq.sqrt();
            let target_vec_x = dx / distance;
            let target_vec_y = dy / distance;

            let dot_product = forward_x * target_vec_x + forward_y * target_vec_y;
            let angle_rad = dot_product.acos();

            if angle_rad <= half_attack_angle_rad {
                // Check if line of sight is blocked by shelter walls
                if is_line_blocked_by_shelter(
                    ctx,
                    player.identity,
                    None, // No target player ID for lanterns
                    player.position_x,
                    player.position_y,
                    lantern_entity.pos_x,
                    lantern_entity.pos_y,
                ) {
                    log::debug!(
                        "Player {:?} cannot attack Lantern {}: line of sight blocked by shelter",
                        player.identity, lantern_entity.id
                    );
                    continue; // Skip this target - blocked by shelter
                }
                
                targets.push(Target {
                    target_type: TargetType::Lantern,
                    id: TargetId::Lantern(lantern_entity.id),
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
        let target_y = box_entity.pos_y - get_box_collision_y_offset(box_entity.box_type);
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

    // RE-ADDED: Grass collision detection using chunk-based querying for efficiency
    // Only check grass in player's chunk and adjacent chunks for performance
    let player_chunk_index = crate::environment::calculate_chunk_index(player.position_x, player.position_y);
    let chunks_per_row = crate::environment::WORLD_WIDTH_CHUNKS;
    
    // Calculate adjacent chunk indices (handling boundaries)
    let mut chunk_indices_to_check = vec![player_chunk_index];
    
    // Add adjacent chunks (left, right, top, bottom, and diagonals)
    if player_chunk_index > 0 && player_chunk_index % chunks_per_row > 0 {
        chunk_indices_to_check.push(player_chunk_index - 1); // Left
    }
    if (player_chunk_index + 1) % chunks_per_row > 0 {
        chunk_indices_to_check.push(player_chunk_index + 1); // Right
    }
    if player_chunk_index >= chunks_per_row {
        chunk_indices_to_check.push(player_chunk_index - chunks_per_row); // Top
    }
    chunk_indices_to_check.push(player_chunk_index + chunks_per_row); // Bottom (always safe - array bounds checked later)
    
    // Check grass only in nearby chunks (efficient chunk-based query)
    // FIX: Use the actual attack_range parameter, NOT hardcoded GRASS_INTERACTION_DISTANCE
    // This allows weapons with extended range (like Scythe) to hit grass at their full range
    // GRASS BONUS: +20px range and 1.8x wider attack arc to make grass MUCH easier to chop
    let grass_range_bonus = 20.0;
    let grass_attack_range = attack_range + grass_range_bonus;
    let grass_attack_range_sq = grass_attack_range * grass_attack_range;
    let grass_half_attack_angle_rad = half_attack_angle_rad * 1.8; // 80% wider arc for grass
    
    // Use split tables: GrassState has health, Grass has position/appearance
    let grass_table = ctx.db.grass();
    let grass_state_table = ctx.db.grass_state();
    
    for chunk_idx in chunk_indices_to_check {
        // Query GrassState for alive grass in this chunk
        for grass_state in grass_state_table.chunk_index().filter(chunk_idx) {
            // Skip dead grass (use is_alive for efficient filtering)
            if !grass_state.is_alive {
                continue;
            }
            
            // Look up static grass data for position and appearance
            let grass_entity = match grass_table.id().find(grass_state.grass_id) {
                Some(g) => g,
                None => continue, // No matching grass entity
            };
            
            // Skip brambles (indestructible)
            if grass_entity.appearance_type.is_bramble() {
                continue;
            }
            
            let dx = grass_entity.pos_x - player.position_x;
            let dy = grass_entity.pos_y - player.position_y;
            let dist_sq = dx * dx + dy * dy;
            
            // Use extended grass attack range for easier chopping
            if dist_sq < grass_attack_range_sq && dist_sq > 0.0 {
                let distance = dist_sq.sqrt();
                let target_vec_x = dx / distance;
                let target_vec_y = dy / distance;
                
                let dot_product = forward_x * target_vec_x + forward_y * target_vec_y;
                let angle_rad = dot_product.acos();
                
                // Use wider attack angle for grass - much more forgiving!
                if angle_rad <= grass_half_attack_angle_rad {
                    targets.push(Target {
                        target_type: TargetType::Tree, // Grass uses Tree target type (resource)
                        id: TargetId::Grass(grass_entity.id),
                        distance_sq: dist_sq,
                    });
                }
            }
        }
    }
    
    // Check rain collectors
    for rain_collector_entity in ctx.db.rain_collector().iter() {
        if rain_collector_entity.is_destroyed {
            continue;
        }
        let dx = rain_collector_entity.pos_x - player.position_x;
        let target_y = rain_collector_entity.pos_y - RAIN_COLLECTOR_COLLISION_Y_OFFSET;
        let dy = target_y - player.position_y;
        let dist_sq = dx * dx + dy * dy;

        if dist_sq < (attack_range * attack_range) && dist_sq > 0.0 {
            let distance = dist_sq.sqrt();
            let target_vec_x = dx / distance;
            let target_vec_y = dy / distance;

            let dot_product = forward_x * target_vec_x + forward_y * target_vec_y;
            let angle_rad = dot_product.acos();

            if angle_rad <= half_attack_angle_rad {
                // Check if line of sight is blocked by shelter walls
                if is_line_blocked_by_shelter(
                    ctx,
                    player.identity,
                    None, // No target player ID for rain collectors
                    player.position_x,
                    player.position_y,
                    rain_collector_entity.pos_x,
                    target_y,
                ) {
                    log::debug!(
                        "Player {:?} cannot attack RainCollector {}: line of sight blocked by shelter",
                        player.identity, rain_collector_entity.id
                    );
                    continue; // Skip this target - blocked by shelter
                }
                
                targets.push(Target {
                    target_type: TargetType::RainCollector,
                    id: TargetId::RainCollector(rain_collector_entity.id),
                    distance_sq: dist_sq,
                });
            }
        }
    }

    // Check furnaces
    for furnace_entity in ctx.db.furnace().iter() {
        if furnace_entity.is_destroyed {
            continue;
        }
        let dx = furnace_entity.pos_x - player.position_x;
        let dy = furnace_entity.pos_y - player.position_y; // No Y offset needed (FURNACE_COLLISION_Y_OFFSET is 0.0)
        let dist_sq = dx * dx + dy * dy;

        if dist_sq < (attack_range * attack_range) && dist_sq > 0.0 {
            let distance = dist_sq.sqrt();
            let target_vec_x = dx / distance;
            let target_vec_y = dy / distance;

            let dot_product = forward_x * target_vec_x + forward_y * target_vec_y;
            let angle_rad = dot_product.acos();

            if angle_rad <= half_attack_angle_rad {
                // Check if line of sight is blocked by shelter walls
                if is_line_blocked_by_shelter(
                    ctx,
                    player.identity,
                    None, // No target player ID for furnaces
                    player.position_x,
                    player.position_y,
                    furnace_entity.pos_x,
                    furnace_entity.pos_y,
                ) {
                    log::debug!(
                        "Player {:?} cannot attack Furnace {}: line of sight blocked by shelter",
                        player.identity, furnace_entity.id
                    );
                    continue; // Skip this target - blocked by shelter
                }
                
                targets.push(Target {
                    target_type: TargetType::Furnace,
                    id: TargetId::Furnace(furnace_entity.id),
                    distance_sq: dist_sq,
                });
            }
        }
    }
    
    // Check barbecues
    for barbecue_entity in ctx.db.barbecue().iter() {
        if barbecue_entity.is_destroyed {
            continue;
        }
        let dx = barbecue_entity.pos_x - player.position_x;
        let dy = barbecue_entity.pos_y - player.position_y; // Barbecue uses center-anchored rendering (no Y offset)
        let dist_sq = dx * dx + dy * dy;

        if dist_sq < (attack_range * attack_range) && dist_sq > 0.0 {
            let distance = dist_sq.sqrt();
            let target_vec_x = dx / distance;
            let target_vec_y = dy / distance;

            let dot_product = forward_x * target_vec_x + forward_y * target_vec_y;
            let angle_rad = dot_product.acos();

            if angle_rad <= half_attack_angle_rad {
                // Check if line of sight is blocked by shelter walls
                if is_line_blocked_by_shelter(
                    ctx,
                    player.identity,
                    None, // No target player ID for barbecues
                    player.position_x,
                    player.position_y,
                    barbecue_entity.pos_x,
                    barbecue_entity.pos_y,
                ) {
                    log::debug!(
                        "Player {:?} cannot attack Barbecue {}: line of sight blocked by shelter",
                        player.identity, barbecue_entity.id
                    );
                    continue; // Skip this target - blocked by shelter
                }
                
                targets.push(Target {
                    target_type: TargetType::Barbecue,
                    id: TargetId::Barbecue(barbecue_entity.id),
                    distance_sq: dist_sq,
                });
            }
        }
    }
    
    // Check wild animals
    // HITBOX_RADIUS accounts for the animal's physical size when checking cone intersection
    // This allows hits to register when the weapon passes through ANY part of the animal,
    // not just the exact center point. Without this, narrow-arc weapons like spears miss frequently.
    const WILD_ANIMAL_MELEE_HITBOX_RADIUS: f32 = 40.0; // Generous hitbox for melee attacks
    // Y_OFFSET moves the targeting point UP from the feet position to the visual body center
    // Animal sprites are bottom-anchored (pos_y = feet), but players aim at the body
    // Without this offset, attacks only connect when aiming at the bottom half of the sprite
    const WILD_ANIMAL_TARGET_Y_OFFSET: f32 = 40.0; // Offset to target body center instead of feet
    
    for wild_animal in ctx.db.wild_animal().iter() {
        // Skip dead animals or animals that are burrowed
        if wild_animal.health <= 0.0 || wild_animal.state == crate::wild_animal_npc::AnimalState::Burrowed {
            continue;
        }
        
        let dx = wild_animal.pos_x - player.position_x;
        // Apply Y offset to target the visual body center, not the feet position
        let target_y = wild_animal.pos_y - WILD_ANIMAL_TARGET_Y_OFFSET;
        let dy = target_y - player.position_y;
        let dist_sq = dx * dx + dy * dy;
        
        if dist_sq < (attack_range * attack_range) && dist_sq > 0.0 {
            let distance = dist_sq.sqrt();
            let target_vec_x = dx / distance;
            let target_vec_y = dy / distance;

            let dot_product = forward_x * target_vec_x + forward_y * target_vec_y;
            let angle_to_center_rad = dot_product.clamp(-1.0, 1.0).acos(); // Clamp to avoid NaN from floating point errors
            
            // Account for the animal's hitbox radius when checking cone intersection
            // The angular radius is the angle subtended by the hitbox from the player's perspective
            // Using atan(radius/distance) gives us the angle from center to edge of hitbox
            let angular_radius = (WILD_ANIMAL_MELEE_HITBOX_RADIUS / distance).atan();
            
            // Hit registers if ANY part of the hitbox circle intersects the attack cone
            // This means: angle_to_center - angular_radius <= half_attack_angle
            let effective_angle = (angle_to_center_rad - angular_radius).max(0.0);

            if effective_angle <= half_attack_angle_rad {
                // Check if line of sight is blocked by shelter walls
                if is_line_blocked_by_shelter(
                    ctx,
                    player.identity,
                    None, // No target player ID for wild animals
                    player.position_x,
                    player.position_y,
                    wild_animal.pos_x,
                    target_y, // Use offset target position for LOS check too
                ) {
                    log::debug!(
                        "Player {:?} cannot attack WildAnimal {}: line of sight blocked by shelter",
                        player.identity, wild_animal.id
                    );
                    continue; // Skip this target - blocked by shelter
                }
                
                targets.push(Target {
                    target_type: TargetType::Animal,
                    id: TargetId::WildAnimal(wild_animal.id),
                    distance_sq: dist_sq,
                });
            }
        }
    }
    
    // Note: Hostile NPCs (Shorebound, Shardkin, DrownedWatch) are now part of the WildAnimal table
    // and are targeted through the wild animal iteration above (with is_hostile_npc = true)
    
    // Check animal corpses
    for animal_corpse in ctx.db.animal_corpse().iter() {
        // Skip corpses that are already depleted
        if animal_corpse.health == 0 {
            continue;
        }
        
        let dx = animal_corpse.pos_x - player.position_x;
        let target_y = animal_corpse.pos_y - ANIMAL_CORPSE_COLLISION_Y_OFFSET;
        let dy = target_y - player.position_y;
        let dist_sq = dx * dx + dy * dy;
        
        if dist_sq < (attack_range * attack_range) && dist_sq > 0.0 {
            let distance = dist_sq.sqrt();
            let target_vec_x = dx / distance;
            let target_vec_y = dy / distance;

            let dot_product = forward_x * target_vec_x + forward_y * target_vec_y;
            let angle_rad = dot_product.acos();

            if angle_rad <= half_attack_angle_rad {
                // Check if line of sight is blocked by shelter walls
                if is_line_blocked_by_shelter(
                    ctx,
                    player.identity,
                    None, // No target player ID for animal corpses
                    player.position_x,
                    player.position_y,
                    animal_corpse.pos_x,
                    target_y,
                ) {
                    log::debug!(
                        "Player {:?} cannot attack AnimalCorpse {}: line of sight blocked by shelter",
                        player.identity, animal_corpse.id
                    );
                    continue; // Skip this target - blocked by shelter
                }
                
                targets.push(Target {
                    target_type: TargetType::AnimalCorpse,
                    id: TargetId::AnimalCorpse(animal_corpse.id),
                    distance_sq: dist_sq,
                });
            }
        }
    }
    
    // Check barrels
    for barrel in ctx.db.barrel().iter() {
        // Skip destroyed barrels
        if barrel.health == 0.0 {
            continue;
        }
        
        let collision_y_offset = if barrel.variant == BUOY_VARIANT {
            BUOY_COLLISION_Y_OFFSET
        } else if barrel.variant == 4 {
            crate::barrel::BARREL_COLLISION_Y_OFFSET * 2.0
        } else {
            crate::barrel::BARREL_COLLISION_Y_OFFSET
        };
        
        let (target_x,target_y) = if let Some(cover) = crate::cover_geometry::profile(barrel.variant) {
            cover.nearest_point(barrel.pos_x,barrel.pos_y,player.position_x,player.position_y)
        } else { (barrel.pos_x,barrel.pos_y-collision_y_offset) };
        let dx = target_x - player.position_x;
        let dy = target_y - player.position_y;
        let dist_sq = dx * dx + dy * dy;
        
        if dist_sq < (attack_range * attack_range) && dist_sq > 0.0 {
            let distance = dist_sq.sqrt();
            let target_vec_x = dx / distance;
            let target_vec_y = dy / distance;

            let dot_product = forward_x * target_vec_x + forward_y * target_vec_y;
            let angle_rad = dot_product.acos();

            if angle_rad <= half_attack_angle_rad {
                // Check if line of sight is blocked by shelter walls
                if is_line_blocked_by_shelter(
                    ctx,
                    player.identity,
                    None, // No target player ID for barrels
                    player.position_x,
                    player.position_y,
                    barrel.pos_x,
                    target_y,
                ) {
                    log::debug!(
                        "Player {:?} cannot attack Barrel {}: line of sight blocked by shelter",
                        player.identity, barrel.id
                    );
                    continue; // Skip this target - blocked by shelter
                }
                
                targets.push(Target {
                    target_type: TargetType::Barrel,
                    id: TargetId::Barrel(barrel.id),
                    distance_sq: dist_sq,
                });
            }
        }
    }
    
    // Check Homestead Hearth
    for hearth in ctx.db.homestead_hearth().iter() {
        // Skip destroyed hearths
        if hearth.is_destroyed {
            continue;
        }
        
        let dx = hearth.pos_x - player.position_x;
        let target_y = hearth.pos_y - HEARTH_COLLISION_Y_OFFSET;
        let dy = target_y - player.position_y;
        let dist_sq = dx * dx + dy * dy;
        
        if dist_sq < (attack_range * attack_range) && dist_sq > 0.0 {
            let distance = dist_sq.sqrt();
            let target_vec_x = dx / distance;
            let target_vec_y = dy / distance;

            let dot_product = forward_x * target_vec_x + forward_y * target_vec_y;
            let angle_rad = dot_product.acos();

            if angle_rad <= half_attack_angle_rad {
                // Check if line of sight is blocked by shelter walls
                if is_line_blocked_by_shelter(
                    ctx,
                    player.identity,
                    None, // No target player ID for hearths
                    player.position_x,
                    player.position_y,
                    hearth.pos_x,
                    target_y,
                ) {
                    log::debug!(
                        "Player {:?} cannot attack Hearth {}: line of sight blocked by shelter",
                        player.identity, hearth.id
                    );
                    continue; // Skip this target - blocked by shelter
                }
                
                targets.push(Target {
                    target_type: TargetType::HomesteadHearth,
                    id: TargetId::HomesteadHearth(hearth.id),
                    distance_sq: dist_sq,
                });
            }
        }
    }
    
    // Check walls (can be directly targeted)
    // Walls require closer range than other targets - use shorter range for melee attacks
    use crate::building::{wall_cell, FOUNDATION_TILE_SIZE_PX};
    const WALL_ATTACK_RANGE: f32 = 80.0; // Walls can only be hit when very close (80px)
    const WALL_ATTACK_RANGE_SQ: f32 = WALL_ATTACK_RANGE * WALL_ATTACK_RANGE;
    
    for wall in ctx.db.wall_cell().iter() {
        if wall.is_destroyed {
            continue;
        }
        
        // Calculate wall center position (foundation cell center)
        let wall_world_x = (wall.cell_x as f32 * FOUNDATION_TILE_SIZE_PX as f32) + (FOUNDATION_TILE_SIZE_PX as f32 / 2.0);
        let wall_world_y = (wall.cell_y as f32 * FOUNDATION_TILE_SIZE_PX as f32) + (FOUNDATION_TILE_SIZE_PX as f32 / 2.0);
        
        let dx = wall_world_x - player.position_x;
        let dy = wall_world_y - player.position_y;
        let dist_sq = dx * dx + dy * dy;
        
        // Use shorter range for walls - must be very close to hit
        if dist_sq < WALL_ATTACK_RANGE_SQ && dist_sq > 0.0 {
            let distance = dist_sq.sqrt();
            let target_vec_x = dx / distance;
            let target_vec_y = dy / distance;
            
            let dot_product = forward_x * target_vec_x + forward_y * target_vec_y;
            let angle_rad = dot_product.acos();
            
            if angle_rad <= half_attack_angle_rad {
                // Check if line of sight is blocked by shelter walls (but not by other walls)
                if is_line_blocked_by_shelter(
                    ctx,
                    player.identity,
                    None,
                    player.position_x,
                    player.position_y,
                    wall_world_x,
                    wall_world_y,
                ) {
                    log::debug!(
                        "Player {:?} cannot attack Wall {}: line of sight blocked by shelter",
                        player.identity, wall.id
                    );
                    continue;
                }
                
                targets.push(Target {
                    target_type: TargetType::Wall,
                    id: TargetId::Wall(wall.id),
                    distance_sq: dist_sq,
                });
            }
        }
    }
    
    // Check doors (can be directly targeted, similar to walls)
    const DOOR_ATTACK_RANGE: f32 = 80.0; // Doors can only be hit when very close (80px)
    const DOOR_ATTACK_RANGE_SQ: f32 = DOOR_ATTACK_RANGE * DOOR_ATTACK_RANGE;
    
    for door in ctx.db.door().iter() {
        if door.is_destroyed {
            continue;
        }
        
        // Calculate door center position (foundation cell center)
        let door_world_x = (door.cell_x as f32 * FOUNDATION_TILE_SIZE_PX as f32) + (FOUNDATION_TILE_SIZE_PX as f32 / 2.0);
        let door_world_y = (door.cell_y as f32 * FOUNDATION_TILE_SIZE_PX as f32) + (FOUNDATION_TILE_SIZE_PX as f32 / 2.0);
        
        let dx = door_world_x - player.position_x;
        let dy = door_world_y - player.position_y;
        let dist_sq = dx * dx + dy * dy;
        
        // Use shorter range for doors - must be very close to hit
        if dist_sq < DOOR_ATTACK_RANGE_SQ && dist_sq > 0.0 {
            let distance = dist_sq.sqrt();
            let target_vec_x = dx / distance;
            let target_vec_y = dy / distance;
            
            let dot_product = forward_x * target_vec_x + forward_y * target_vec_y;
            let angle_rad = dot_product.acos();
            
            if angle_rad <= half_attack_angle_rad {
                // Check if line of sight is blocked by shelter walls
                if is_line_blocked_by_shelter(
                    ctx,
                    player.identity,
                    None,
                    player.position_x,
                    player.position_y,
                    door_world_x,
                    door_world_y,
                ) {
                    log::debug!(
                        "Player {:?} cannot attack Door {}: line of sight blocked by shelter",
                        player.identity, door.id
                    );
                    continue;
                }
                
                targets.push(Target {
                    target_type: TargetType::Door,
                    id: TargetId::Door(door.id),
                    distance_sq: dist_sq,
                });
            }
        }
    }
    
    // Check fences (can be directly targeted, similar to walls)
    const FENCE_ATTACK_RANGE: f32 = 120.0; // Same range as other structures
    const FENCE_ATTACK_RANGE_SQ: f32 = FENCE_ATTACK_RANGE * FENCE_ATTACK_RANGE;
    
    use crate::fence::fence as FenceTableTrait;
    use crate::TILE_SIZE_PX;
    
    for fence in ctx.db.fence().iter() {
        if fence.is_destroyed {
            continue;
        }
        
        // Fences are positioned at tile EDGES (horizontal at south edge, vertical at east edge)
        let dx = fence.pos_x - player.position_x;
        let dy = fence.pos_y - player.position_y;
        let dist_sq = dx * dx + dy * dy;
        
        // Use shorter range for fences - must be very close to hit
        if dist_sq < FENCE_ATTACK_RANGE_SQ && dist_sq > 0.0 {
            let distance = dist_sq.sqrt();
            let target_vec_x = dx / distance;
            let target_vec_y = dy / distance;
            
            let dot_product = forward_x * target_vec_x + forward_y * target_vec_y;
            let angle_rad = dot_product.acos();
            
            if angle_rad <= half_attack_angle_rad {
                // Check if line of sight is blocked by shelter walls
                if is_line_blocked_by_shelter(
                    ctx,
                    player.identity,
                    None,
                    player.position_x,
                    player.position_y,
                    fence.pos_x,
                    fence.pos_y,
                ) {
                    log::debug!(
                        "Player {:?} cannot attack Fence {}: line of sight blocked by shelter",
                        player.identity, fence.id
                    );
                    continue;
                }
                
                targets.push(Target {
                    target_type: TargetType::Wall, // Use Wall target type for consistency
                    id: TargetId::Fence(fence.id),
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

/// Calculates logarithmic fat bonus based on time alive
/// Uses logarithmic curve to prevent exponential growth
/// Returns additional fat quantity to add to base yield
fn calculate_fat_bonus_from_time_alive(spawned_at: Timestamp, death_time: Timestamp) -> u32 {
    // Calculate time alive in seconds
    let time_alive_micros = death_time.to_micros_since_unix_epoch()
        .saturating_sub(spawned_at.to_micros_since_unix_epoch());
    let time_alive_seconds = (time_alive_micros as f64 / 1_000_000.0).max(0.0);
    
    // Logarithmic curve: log10(time_alive + 1) * multiplier
    // This grows slowly and caps naturally
    const MULTIPLIER: f64 = 2.0; // Scale factor for balance
    const MAX_BONUS: f64 = 10.0; // Cap at 10 extra fat (prevents excessive amounts)
    
    let log_value = (time_alive_seconds + 1.0).log10(); // log10(time_alive + 1)
    let bonus = (log_value * MULTIPLIER).min(MAX_BONUS);
    
    bonus as u32 // Round down to integer
}

/// Determines if a target type represents a destructible deployable structure
/// This makes the system generic for future deployables
fn is_destructible_deployable(target_type: TargetType) -> bool {
    matches!(target_type, 
        TargetType::Campfire | 
        TargetType::Lantern |
        TargetType::WoodenStorageBox | 
        TargetType::SleepingBag | 
        TargetType::Stash |
        TargetType::Shelter |
        TargetType::RainCollector |
        TargetType::Furnace |
        TargetType::Barbecue | // ADDED: Barbecue is destructible
        TargetType::Barrel | // Includes barrels and other destructible deployables
        TargetType::HomesteadHearth | // ADDED: Homestead Hearth is destructible
        TargetType::Wall | // ADDED: Walls are destructible structures
        TargetType::Door | // ADDED: Doors are destructible structures
        TargetType::Foundation // ADDED: Foundations are destructible structures
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
    log::debug!("[grant_resource] Looking for item '{}' in {} total item definitions", resource_name, item_defs.count());
    
    // Debug: List all item names for troubleshooting
    let all_item_names: Vec<String> = item_defs.iter().map(|def| def.name.clone()).collect();
    log::debug!("[grant_resource] Available items: {:?}", all_item_names);
    
    let resource_def = item_defs.iter()
        .find(|def| def.name == resource_name)
        .ok_or_else(|| {
            let available: Vec<String> = item_defs.iter().map(|def| def.name.clone()).collect();
            format!("{} item definition not found. Available items: {:?}", resource_name, available)
        })?;
    
    log::debug!("[grant_resource] Found item '{}' with id: {}", resource_name, resource_def.id);
        
    // Use our new system that automatically drops items if inventory is full
    match crate::dropped_item::try_give_item_to_player(ctx, player_id, resource_def.id, amount) {
        Ok(added_to_inventory) => {
            if !added_to_inventory {
                log::info!("[GrantResource] Inventory full for player {}. Dropped {} {} near player.", 
                         player_id, amount, resource_name);
            }
            
            // Track item collection for quest progress
            if let Err(e) = crate::quests::track_quest_progress(
                ctx,
                player_id,
                crate::quests::QuestObjectiveType::CollectSpecificItem,
                Some(resource_name),
                amount,
            ) {
                log::error!("Failed to track item collection quest progress: {}", e);
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
    // Water containers and Broken Lighter can swing but deal no damage
    if item_def.name == "Reed Water Bottle" 
        || item_def.name == "Plastic Water Jug"
        || item_def.name == "Broken Lighter" {
        return (0.0, 0, "".to_string());
    }
    
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
        // If PvP damage is explicitly set (even if zero), use it
        if item_def.pvp_damage_min.is_some() || item_def.pvp_damage_max.is_some() {
            let min_pvp_dmg = item_def.pvp_damage_min.unwrap_or(0) as f32;
            let max_pvp_dmg = item_def.pvp_damage_max.unwrap_or(min_pvp_dmg as u32) as f32;
            
            // If explicitly set to zero, return zero damage (e.g., Blueprint)
            if max_pvp_dmg == 0.0 && min_pvp_dmg == 0.0 {
                return (0.0, 0, "".to_string());
            }
            
            if max_pvp_dmg > 0.0 { // Only override default if PvP damage is defined and non-zero
                damage = if min_pvp_dmg >= max_pvp_dmg {
                    min_pvp_dmg
                } else {
                    rng.gen_range(min_pvp_dmg..=max_pvp_dmg)
                };
                
                // For players and animals, no yield. For deployables, they handle their own item drops in their respective damage functions
                return (damage, 0, "".to_string());
            }
        }
    }

    // NEW: Handle PlayerCorpse target type for fixed damage
    if target_type == TargetType::PlayerCorpse {
        // Player corpses always take a fixed amount of damage to ensure consistent hits to destroy.
        // Yield is handled separately in damage_player_corpse.
        return (25.0, 0, "".to_string());
    }

    // NEW: Handle AnimalCorpse target type for fixed damage
    if target_type == TargetType::AnimalCorpse {
        // Animal corpses always take a fixed amount of damage to ensure consistent hits to destroy.
        // Yield is handled separately in damage_animal_corpse.
        return (20.0, 0, "".to_string());
    }

    // Fallback for non-primary targets (or if primary_target_type is None)
    // Apply default damage (1.0), no yield for most other PvE targets unless specified
    // REMOVED: Grass damage calculation - grass collision detection removed for performance
    
    // NEW: Fallback harvesting for tools on harvestable resources
    // Any tool should be able to harvest minimal amounts from trees and stones
    if item_def.category == crate::items::ItemCategory::Tool {
        // Exclude certain specialized tools that shouldn't harvest basic resources
        let excluded_tools = [
            "Repair Hammer",    // For repairing structures, not harvesting
            "Blueprint",        // For building/placing structures
            "Bone Knife",       // Specialized for corpse harvesting only
            "Bandage",          // Medical tool, not for harvesting
            "Torch",            // Light source, not for harvesting
            "Broken Lighter",   // Junk tool - right-click only plays sound, no harvest
            "Reed Water Bottle", // Water container - can swing but no damage/harvest
            "Plastic Water Jug", // Water container - can swing but no damage/harvest
        ];
        
        if !excluded_tools.contains(&item_def.name.as_str()) {
            match target_type {
                TargetType::Tree => {
                    // Tools can harvest wood, but at lower efficiency than proper hatchets
                    // Target: ~40 hits to harvest an average tree (325 resources) for reasonable bootstrapping
                    // Proper hatchets still get 2-4x more yield/hit AND kill faster, so strong upgrade incentive
                    let fallback_damage = item_def.primary_target_damage_min.unwrap_or(5) as f32 * 0.5; // 50% of normal damage
                    let fallback_yield = rng.gen_range(7..=10); // 7-10 wood per hit (vs 16-22 for Stone Hatchet, 30-40 for Metal)
                    return (fallback_damage, fallback_yield, "Wood".to_string());
                },
                TargetType::Stone => {
                    // Tools can harvest stone, but at lower efficiency than proper pickaxes
                    let fallback_damage = item_def.primary_target_damage_min.unwrap_or(5) as f32 * 0.5; // 50% of normal damage
                    let fallback_yield = rng.gen_range(7..=10); // 7-10 stone per hit (vs 35-50 for Stone Pickaxe, 60-85 for Metal)
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
    
    // Check if this is the first hit on this tree (virgin tree)
    let is_first_hit = tree.last_hit_time.is_none();
    
    let old_health = tree.health;
    tree.health = tree.health.saturating_sub(damage as u32);
    tree.last_hit_time = Some(timestamp);
    
    // Play birds flapping sound on first hit to indicate virgin tree
    // if is_first_hit {
    //     sound_events::emit_birds_flapping_sound(ctx, tree.pos_x, tree.pos_y, attacker_id);
    // }
    
    // NEW: Resource depletion system - limit yield to remaining resources
    let mut actual_yield = std::cmp::min(yield_amount, tree.resource_remaining);
    
    // Player-planted trees yield less wood (60% of normal)
    // This is already factored into resource_remaining, but also affects per-hit yield
    // to maintain consistency throughout the chopping process
    if tree.is_player_planted {
        actual_yield = ((actual_yield as f32) * tree::PLAYER_PLANTED_YIELD_PERCENT) as u32;
        actual_yield = actual_yield.max(1); // Always yield at least 1
    }
    
    // <<< BROTH EFFECT: HarvestBoost gives 50% bonus yield from chopping >>>
    if active_effects::player_has_harvest_boost_effect(ctx, attacker_id) {
        let original_yield = actual_yield;
        actual_yield = ((actual_yield as f32) * active_effects::HARVEST_BOOST_MULTIPLIER).ceil() as u32;
        actual_yield = std::cmp::min(actual_yield, tree.resource_remaining); // Cap to remaining resources
        log::info!("Player {:?} has HarvestBoost broth - wood yield increased by {:.0}%: {} -> {}", 
            attacker_id, (active_effects::HARVEST_BOOST_MULTIPLIER - 1.0) * 100.0, original_yield, actual_yield);
    }
    // <<< END BROTH EFFECT >>>
    
    // <<< MEMORY GRID: Mining Efficiency gives +30% yield from chopping >>>
    if crate::memory_grid::player_has_mining_efficiency(ctx, attacker_id) {
        let original_yield = actual_yield;
        actual_yield = ((actual_yield as f32) * crate::memory_grid::MINING_EFFICIENCY_MULTIPLIER).ceil() as u32;
        actual_yield = std::cmp::min(actual_yield, tree.resource_remaining); // Cap to remaining resources
        log::info!("Player {:?} has Mining Efficiency node - wood yield increased by {:.0}%: {} -> {}",
            attacker_id, (crate::memory_grid::MINING_EFFICIENCY_MULTIPLIER - 1.0) * 100.0, original_yield, actual_yield);
    }
    // <<< END MEMORY GRID >>>
    
    // <<< BONE TOTEM: Tunux Charm (Vole) gives harvest yield bonus >>>
    let totem_harvest_bonus = armor::calculate_harvest_bonus(ctx, attacker_id);
    if totem_harvest_bonus > 0.0 {
        let original_yield = actual_yield;
        actual_yield = ((actual_yield as f32) * (1.0 + totem_harvest_bonus)).ceil() as u32;
        actual_yield = std::cmp::min(actual_yield, tree.resource_remaining); // Cap to remaining resources
        log::info!("Player {:?} has Tunux Charm - wood yield increased by {:.0}%: {} -> {}", 
            attacker_id, totem_harvest_bonus * 100.0, original_yield, actual_yield);
    }
    // <<< END BONE TOTEM >>>
    
    tree.resource_remaining = tree.resource_remaining.saturating_sub(actual_yield);
    
    log::info!("Player {:?} hit Tree {} for {:.1} damage. Health: {} -> {}, Resources: {} remaining", 
           attacker_id, tree_id, damage, old_health, tree.health, tree.resource_remaining);
    
    // Sound logic: Always play chop sound, plus special sounds for dramatic moments
    // Dynamic creaking threshold: Based on weapon damage to indicate "3-4 hits remaining"
    const TARGET_HITS_REMAINING: f32 = 3.5; // Target number of hits when creaking should start
    let creaking_threshold = (damage * TARGET_HITS_REMAINING) as u32; // Health when ~3-4 hits remain
    
    // Tree is destroyed when either health reaches 0 OR resources are depleted
    let tree_destroyed = tree.health == 0 || tree.resource_remaining == 0;
    
    if tree_destroyed {
        // Tree is destroyed - play both chop and falling sound
        sound_events::emit_tree_chop_sound(ctx, tree.pos_x, tree.pos_y, attacker_id);
        sound_events::emit_tree_falling_sound(ctx, tree.pos_x, tree.pos_y, attacker_id);
        // Set health to 0 to ensure it's marked as destroyed
        tree.health = 0;
    } else if tree.health <= creaking_threshold {
        // Tree is in critical condition - play both chop and creaking sound for every hit
        sound_events::emit_tree_chop_sound(ctx, tree.pos_x, tree.pos_y, attacker_id);
        sound_events::emit_tree_creaking_sound(ctx, tree.pos_x, tree.pos_y, attacker_id);
    } else {
        // Normal hit - play chop sound only
        sound_events::emit_tree_chop_sound(ctx, tree.pos_x, tree.pos_y, attacker_id);
    }
    
    // Only grant resources if we actually got some
    if actual_yield > 0 {
        let resource_result = grant_resource(ctx, attacker_id, resource_name_to_grant, actual_yield);
        
        if let Err(e) = resource_result {
            log::error!("Failed to grant {} to player {:?}: {}", resource_name_to_grant, attacker_id, e);
        }
        
        // Track quest progress for wood gathering - track ACTUAL wood collected per hit
        if let Err(e) = crate::quests::track_quest_progress(
            ctx,
            attacker_id,
            crate::quests::QuestObjectiveType::GatherWood,
            Some("Wood"),
            actual_yield,
        ) {
            log::error!("Failed to track quest progress for wood gathering: {}", e);
        }
        
        // === SECONDARY & TERTIARY TREE YIELDS (Bark and Seeds) ===
        // Better cutting tools have higher chances of yielding bark and tree seeds
        // Bark is secondary (higher chance), seeds/cones are tertiary (lower chance)
        
        // Determine tool quality from player's equipped item
        let (bark_chance, seed_chance) = if let Some(active_equip) = ctx.db.active_equipment().player_identity().find(&attacker_id) {
            if let Some(equipped_item_id) = active_equip.equipped_item_instance_id {
                if let Some(equipped_item) = ctx.db.inventory_item().instance_id().find(&equipped_item_id) {
                    if let Some(item_def) = ctx.db.item_definition().id().find(&equipped_item.item_def_id) {
                        match item_def.name.as_str() {
                            // Metal Hatchet - Best for tree harvesting (highest chances)
                            "Metal Hatchet" => (0.25, 0.12),
                            // Stone Hatchet - Good for tree harvesting  
                            "Stone Hatchet" => (0.18, 0.08),
                            // Bush Knife (Machete) - Decent but not specialized for trees
                            "Bush Knife" => (0.15, 0.06),
                            // Battle Axe - Heavy weapon, decent bark yield
                            "Battle Axe" => (0.20, 0.07),
                            // Combat Ladle, Rock, and other basic tools - minimal chances
                            "Rock" | "Combat Ladle" => (0.05, 0.02),
                            // Any other tool - small chance
                            _ => (0.08, 0.03),
                        }
                    } else {
                        (0.05, 0.02) // No item def found
                    }
                } else {
                    (0.05, 0.02) // No equipped item found
                }
            } else {
                (0.03, 0.01) // Nothing equipped (bare hands)
            }
        } else {
            (0.03, 0.01) // No active equipment record
        };
        
        // Determine tree category based on tree type
        // Conifer trees (Pine Bark + Pinecone): spruce, hemlock, pine variants
        // Deciduous trees (Birch Bark + Birch Catkin): birch, alder, willow
        // Fruit/Nut trees: CrabAppleTree, HazelnutTree, RowanberryTree - special drops
        let is_fruit_tree = matches!(
            tree.tree_type,
            tree::TreeType::CrabAppleTree |
            tree::TreeType::HazelnutTree |
            tree::TreeType::RowanberryTree |
            tree::TreeType::OliveTree
        );
        
        let is_conifer = matches!(
            tree.tree_type,
            tree::TreeType::SitkaSpruce |        // Classic tall spruce
            tree::TreeType::MountainHemlock |    // Mountain hemlock variant A
            tree::TreeType::MountainHemlock2 |   // Mountain hemlock variant B
            tree::TreeType::DwarfPine |          // Stunted alpine pine
            tree::TreeType::MountainHemlockSnow | // Snow-covered hemlock
            tree::TreeType::KrummholzSpruce      // Twisted wind-sculpted spruce
        );
        // Deciduous: SiberianBirch, SitkaAlder/SitkaAlder2, ArcticWillow
        
        if is_fruit_tree {
            // Fruit/Nut trees have special drops - fruits/nuts fall as dropped items
            let fruit_name = match tree.tree_type {
                tree::TreeType::CrabAppleTree => "Crab Apples",
                tree::TreeType::HazelnutTree => "Hazelnuts",
                tree::TreeType::RowanberryTree => "Rowan Berries",
                tree::TreeType::OliveTree => "Olives",
                _ => unreachable!(),
            };
            
            // Higher chance for fruit drops (30-50% based on tool)
            let fruit_chance = bark_chance * 2.0; // Double the bark chance
            let fruit_roll: f32 = rng.gen_range(0.0..1.0);
            
            if fruit_roll < fruit_chance {
                // Drop 1-3 fruits/nuts as dropped items near the tree with arc animation
                let fruit_amount = rng.gen_range(1..=3) as u32;
                
                // Find the fruit item definition
                if let Some(fruit_def) = ctx.db.item_definition().iter().find(|def| def.name == fruit_name) {
                    // Calculate spawn position (halfway up the tree canopy)
                    // Tree heights are roughly 300-400px, so spawn ~150px above tree base
                    let tree_height_offset: f32 = 180.0; // Spawn from upper part of tree
                    let spawn_x = tree.pos_x + rng.gen_range(-20.0..20.0); // Slight X variation
                    let spawn_y = tree.pos_y - tree_height_offset; // Above tree base
                    
                    // Calculate landing position in a circle around the tree base
                    // Use random angle and distance for natural-looking spread
                    let angle: f32 = rng.gen_range(0.0..std::f32::consts::TAU);
                    let drop_distance: f32 = rng.gen_range(40.0..100.0); // Land 40-100px from tree center
                    let drop_x = tree.pos_x + angle.cos() * drop_distance;
                    let drop_y = tree.pos_y + angle.sin() * drop_distance;
                    
                    // Create dropped item with arc animation
                    match crate::dropped_item::create_dropped_item_with_arc(
                        ctx, fruit_def.id, fruit_amount, drop_x, drop_y, spawn_x, spawn_y
                    ) {
                        Ok(_) => {
                            log::info!("🍎 Fruit tree drop: {} {} fell from {} - spawn ({:.0}, {:.0}) -> land ({:.0}, {:.0}) (roll: {:.3} < {:.3})", 
                                fruit_amount, fruit_name, 
                                match tree.tree_type {
                                    tree::TreeType::CrabAppleTree => "Crab Apple Tree",
                                    tree::TreeType::HazelnutTree => "Hazelnut Tree",
                                    tree::TreeType::RowanberryTree => "Rowanberry Tree",
                                    tree::TreeType::OliveTree => "Olive Tree",
                                    _ => "Fruit Tree",
                                },
                                spawn_x, spawn_y, drop_x, drop_y, fruit_roll, fruit_chance);
                        }
                        Err(e) => {
                            log::error!("Failed to drop {} from fruit tree: {}", fruit_name, e);
                        }
                    }
                }
            }
        } else {
            // Standard trees: bark and seed drops go to inventory
            let (bark_name, seed_name) = if is_conifer {
                ("Pine Bark", "Pinecone")
            } else {
                ("Birch Bark", "Birch Catkin")
            };
            
            // Roll for secondary yield (bark)
            let bark_roll: f32 = rng.gen_range(0.0..1.0);
            if bark_roll < bark_chance {
                let bark_amount = rng.gen_range(1..=3);
                if let Ok(_) = grant_resource(ctx, attacker_id, bark_name, bark_amount) {
                    log::info!("🌲 Tree secondary yield: Player {:?} received {} {} (roll: {:.3} < {:.3})", 
                        attacker_id, bark_amount, bark_name, bark_roll, bark_chance);
                }
            }
            
            // Roll for tertiary yield (seeds/cones) - rarer than bark
            let seed_roll: f32 = rng.gen_range(0.0..1.0);
            if seed_roll < seed_chance {
                let seed_amount = 1; // Seeds are always 1 at a time
                if let Ok(_) = grant_resource(ctx, attacker_id, seed_name, seed_amount) {
                    log::info!("🌰 Tree tertiary yield: Player {:?} received {} {} (roll: {:.3} < {:.3})", 
                        attacker_id, seed_amount, seed_name, seed_roll, seed_chance);
                }
            }
        }
    }
    
    if tree_destroyed {
        // Final chop bonus: Reward players for completing the tree with a MASSIVE bonus!
        // Bonus is 20-40% of the tree's initial health (type-specific) converted to resources
        // Player-planted trees get reduced bonus (60% of normal)
        let (initial_health, _, _) = tree_type_stats(&tree.tree_type);
        let bonus_percentage = rng.gen_range(0.20..=0.40); // 20-40% of tree's initial health
        let mut final_chop_bonus = ((initial_health as f32) * bonus_percentage).ceil() as u32;
        
        // Reduce final bonus for player-planted trees (consistent with overall yield reduction)
        if tree.is_player_planted {
            final_chop_bonus = ((final_chop_bonus as f32) * tree::PLAYER_PLANTED_YIELD_PERCENT) as u32;
        }
        
        if final_chop_bonus > 0 {
            let bonus_result = grant_resource(ctx, attacker_id, resource_name_to_grant, final_chop_bonus);
            
            if let Err(e) = bonus_result {
                log::error!("Failed to grant final chop bonus {} to player {:?}: {}", resource_name_to_grant, attacker_id, e);
            } else {
                log::info!("Player {:?} received final chop bonus: {} {} ({}% of tree health)", 
                         attacker_id, final_chop_bonus, resource_name_to_grant, (bonus_percentage * 100.0) as u32);
                // Bonus notification is now handled by the item acquisition system via grant_resource()
                
                // Track final bonus wood for quest progress
                if let Err(e) = crate::quests::track_quest_progress(
                    ctx,
                    attacker_id,
                    crate::quests::QuestObjectiveType::GatherWood,
                    Some("Wood"),
                    final_chop_bonus,
                ) {
                    log::error!("Failed to track quest progress for final wood bonus: {}", e);
                }
            }
        }
        
        // Award XP and update stats for tree chopped
        if let Err(e) = crate::player_progression::award_xp(ctx, attacker_id, crate::player_progression::XP_TREE_CHOPPED) {
            log::error!("Failed to award XP for tree chop: {}", e);
        }
        
        // Track tree chopped stat and check achievements
        if let Err(e) = crate::player_progression::track_stat_and_check_achievements(ctx, attacker_id, "trees_chopped", 1) {
            log::error!("Failed to check achievements after tree chop: {}", e);
        }
        
        // Track quest progress for tree destruction (e.g., "chop down 10 trees")
        if let Err(e) = crate::quests::track_quest_progress(
            ctx,
            attacker_id,
            crate::quests::QuestObjectiveType::ChopTree,
            None,
            1,
        ) {
            log::error!("Failed to track quest progress for tree destruction: {}", e);
        }
        
        // Store tree position for campfire protection checks
        const TREE_PROTECTION_DISTANCE_SQ: f32 = 100.0 * 100.0; // 100px protection radius (matches campfire.rs)
        let tree_pos_x = tree.pos_x;
        let tree_pos_y = tree.pos_y;
        
        // Player-planted trees: Mark as destroyed (health=0, respawn_at far future) so client can show
        // falling animation. Tree stays in DB but never respawns (respawn_at = 100 years). Wild trees
        // get normal respawn scheduling.
        if tree.is_player_planted {
            log::info!("Tree {} destroyed by Player {:?}. Player-planted tree - marking destroyed (no respawn, falling animation).", tree_id, attacker_id);
            tree.health = 0;
            // Far-future respawn_at: client sees "destroyed" state for falling animation, but tree never respawns
            const PLAYER_PLANTED_NEVER_RESPAWN_SECS: i64 = 100 * 365 * 24 * 3600; // 100 years
            tree.respawn_at = timestamp + TimeDuration::from_micros(PLAYER_PLANTED_NEVER_RESPAWN_SECS * 1_000_000);
            ctx.db.tree().id().update(tree.clone());
            crate::spatial_grid::invalidate_static_grid();
        } else {
            log::info!("Tree {} destroyed by Player {:?}. Scheduling respawn.", tree_id, attacker_id);
            
            // Calculate random respawn time for wild trees
            let respawn_duration_secs = if tree::MIN_TREE_RESPAWN_TIME_SECS >= tree::MAX_TREE_RESPAWN_TIME_SECS {
                tree::MIN_TREE_RESPAWN_TIME_SECS
            } else {
                rng.gen_range(tree::MIN_TREE_RESPAWN_TIME_SECS..=tree::MAX_TREE_RESPAWN_TIME_SECS)
            };
            let respawn_time = timestamp + TimeDuration::from_micros(respawn_duration_secs as i64 * 1_000_000);
            tree.respawn_at = respawn_time;
            
            // Update tree in database so protection checks see it as destroyed
            ctx.db.tree().id().update(tree.clone());
            crate::spatial_grid::invalidate_static_grid();
        }
        
        // Check for campfires that were protected by this tree and extinguish them if no longer protected
        for mut campfire in ctx.db.campfire().iter() {
            // Skip campfires that aren't burning or are destroyed
            if !campfire.is_burning || campfire.is_destroyed {
                continue;
            }
            
            // Check if this campfire was within protection distance of the destroyed tree
            let dx = campfire.pos_x - tree_pos_x;
            let dy = campfire.pos_y - tree_pos_y;
            let distance_sq = dx * dx + dy * dy;
            
            if distance_sq <= TREE_PROTECTION_DISTANCE_SQ {
                // This campfire was protected by the destroyed tree
                // Check if it's still protected by any other tree or shelter
                if !crate::campfire::is_campfire_protected_from_rain(ctx, &campfire) {
                    // No longer protected - extinguish the campfire
                    campfire.is_burning = false;
                    campfire.current_fuel_def_id = None;
                    campfire.remaining_fuel_burn_time_secs = None;
                    
                    // Stop campfire sound when extinguished
                    crate::sound_events::stop_campfire_sound(ctx, campfire.id as u64);
                    
                    // Update the campfire in the database
                    ctx.db.campfire().id().update(campfire.clone());
                    
                    log::info!("Campfire {} extinguished after tree {} was cut down (no longer protected)", 
                              campfire.id, tree_id);
                }
            }
        }
    } else {
        // Tree not destroyed - update normally
        ctx.db.tree().id().update(tree);
    }
    
    Ok(AttackResult {
        hit: true,
        target_type: Some(TargetType::Tree),
        resource_granted: if actual_yield > 0 { Some((resource_name_to_grant.to_string(), actual_yield)) } else { None },
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
    resource_name_to_grant: &str, // This parameter is now ignored - we use stone's ore_type instead
    timestamp: Timestamp,
    rng: &mut impl Rng
) -> Result<AttackResult, String> {
    let mut stone = ctx.db.stone().id().find(stone_id)
        .ok_or_else(|| "Target stone disappeared".to_string())?;
    
    // Determine resource name from stone's ore type
    // Safety: If ore_type is somehow not set (shouldn't happen, but handle gracefully for existing stones)
    let resource_name = stone.ore_type.get_resource_name();
    
    log::info!("[damage_stone] Stone {} - ore_type: {:?}, resource_name: '{}', resource_remaining: {}, yield_amount: {}, damage: {}", 
               stone_id, stone.ore_type, resource_name, stone.resource_remaining, yield_amount, damage);
    
    let old_health = stone.health;
    stone.health = stone.health.saturating_sub(damage as u32);
    stone.last_hit_time = Some(timestamp);
    
    // NEW: Resource depletion system - limit yield to remaining resources
    let mut actual_yield = std::cmp::min(yield_amount, stone.resource_remaining);
    
    // <<< BROTH EFFECT: HarvestBoost gives 50% bonus yield from mining >>>
    if active_effects::player_has_harvest_boost_effect(ctx, attacker_id) {
        let original_yield = actual_yield;
        actual_yield = ((actual_yield as f32) * active_effects::HARVEST_BOOST_MULTIPLIER).ceil() as u32;
        actual_yield = std::cmp::min(actual_yield, stone.resource_remaining); // Cap to remaining resources
        log::info!("Player {:?} has HarvestBoost broth - ore yield increased by {:.0}%: {} -> {}", 
            attacker_id, (active_effects::HARVEST_BOOST_MULTIPLIER - 1.0) * 100.0, original_yield, actual_yield);
    }
    // <<< END BROTH EFFECT >>>
    
    // <<< MEMORY GRID: Mining Efficiency gives +30% yield from mining >>>
    if crate::memory_grid::player_has_mining_efficiency(ctx, attacker_id) {
        let original_yield = actual_yield;
        actual_yield = ((actual_yield as f32) * crate::memory_grid::MINING_EFFICIENCY_MULTIPLIER).ceil() as u32;
        actual_yield = std::cmp::min(actual_yield, stone.resource_remaining); // Cap to remaining resources
        log::info!("Player {:?} has Mining Efficiency node - ore yield increased by {:.0}%: {} -> {}", 
            attacker_id, (crate::memory_grid::MINING_EFFICIENCY_MULTIPLIER - 1.0) * 100.0, original_yield, actual_yield);
    }
    // <<< END MEMORY GRID >>>
    
    // <<< BONE TOTEM: Tunux Charm (Vole) gives harvest yield bonus >>>
    let totem_harvest_bonus = armor::calculate_harvest_bonus(ctx, attacker_id);
    if totem_harvest_bonus > 0.0 {
        let original_yield = actual_yield;
        actual_yield = ((actual_yield as f32) * (1.0 + totem_harvest_bonus)).ceil() as u32;
        actual_yield = std::cmp::min(actual_yield, stone.resource_remaining); // Cap to remaining resources
        log::info!("Player {:?} has Tunux Charm - ore yield increased by {:.0}%: {} -> {}", 
            attacker_id, totem_harvest_bonus * 100.0, original_yield, actual_yield);
    }
    // <<< END BONE TOTEM >>>
    
    stone.resource_remaining = stone.resource_remaining.saturating_sub(actual_yield);
    
    log::info!("[damage_stone] After calculation - actual_yield: {}, new resource_remaining: {}", actual_yield, stone.resource_remaining);
    
    log::info!("Player {:?} hit Stone {} (ore_type: {:?}) for {:.1} damage. Health: {} -> {}, Resources: {} remaining", 
           attacker_id, stone_id, stone.ore_type, damage, old_health, stone.health, stone.resource_remaining);
    
    // Stone is destroyed when either health reaches 0 OR resources are depleted
    let stone_destroyed = stone.health == 0 || stone.resource_remaining == 0;
    
    // Sound logic: Always play hit sound, plus destroyed sound when stone dies
    if stone_destroyed {
        // Stone is destroyed - play both hit and destroyed sound
        sound_events::emit_stone_hit_sound(ctx, stone.pos_x, stone.pos_y, attacker_id);
        sound_events::emit_stone_destroyed_sound(ctx, stone.pos_x, stone.pos_y, attacker_id);
        // Set health to 0 to ensure it's marked as destroyed
        stone.health = 0;
    } else {
        // Normal hit - play hit sound only
        sound_events::emit_stone_hit_sound(ctx, stone.pos_x, stone.pos_y, attacker_id);
    }
    
    // Only grant resources if we actually got some
    if actual_yield > 0 {
        log::debug!("[damage_stone] Attempting to grant {} {} to player {:?}", actual_yield, resource_name, attacker_id);
        let resource_result = grant_resource(ctx, attacker_id, resource_name, actual_yield);
        
        if let Err(e) = resource_result {
            log::error!("Failed to grant {} to player {:?}: {}", resource_name, attacker_id, e);
        } else {
            log::debug!("[damage_stone] Successfully granted {} {} to player {:?}", actual_yield, resource_name, attacker_id);
        }
        
        // Track quest progress for stone gathering - ONLY "Stone" counts (not Metal Ore, Sulfur, etc.)
        if let Err(e) = crate::quests::track_quest_progress(
            ctx,
            attacker_id,
            crate::quests::QuestObjectiveType::GatherStone,
            Some(resource_name),
            actual_yield,
        ) {
            log::error!("Failed to track quest progress for stone gathering: {}", e);
        }
        
        // <<< INSANITY SYSTEM: Increase insanity when mining memory shard nodes >>>
        if stone.ore_type == crate::stone::OreType::Memory {
            let players = ctx.db.player();
            if let Some(mut player) = players.identity().find(&attacker_id) {
                let new_insanity = (player.insanity + crate::player_stats::INSANITY_MINING_INCREASE)
                    .min(crate::player_stats::PLAYER_MAX_INSANITY);
                player.insanity = new_insanity;
                players.identity().update(player);
                log::info!("Player {:?} mined memory shard node - insanity increased by {:.1} to {:.1}", 
                    attacker_id, crate::player_stats::INSANITY_MINING_INCREASE, new_insanity);
                
                // Check if insanity reached max - apply Entrainment effect
                if new_insanity >= crate::player_stats::PLAYER_MAX_INSANITY {
                    if !crate::active_effects::player_has_entrainment_effect(ctx, attacker_id) {
                        log::warn!("Player {:?} reached maximum insanity from mining - applying Entrainment effect!", attacker_id);
                        if let Err(e) = crate::active_effects::apply_entrainment_effect(ctx, attacker_id) {
                            log::error!("Failed to apply Entrainment effect to player {:?}: {}", attacker_id, e);
                        }
                    }
                }
            }
        }
        // <<< END INSANITY SYSTEM >>>
    }
    
    if stone_destroyed {
        // Final hit bonus: Reward players for completing the stone with a MASSIVE bonus!
        // Bonus is 2-4% of the stone's INITIAL health converted to resources - always feels rewarding!
        // This means ~20-40 stone for a standard stone node (1000 HP), regardless of tool quality
        let bonus_percentage = rng.gen_range(0.02..=0.04); // 2-4% of stone's initial health
        let final_hit_bonus = ((stone::STONE_INITIAL_HEALTH as f32) * bonus_percentage).ceil() as u32;
        
        if final_hit_bonus > 0 {
            let bonus_result = grant_resource(ctx, attacker_id, resource_name, final_hit_bonus);
            
            if let Err(e) = bonus_result {
                log::error!("Failed to grant final hit bonus {} to player {:?}: {}", resource_name, attacker_id, e);
            } else {
                log::info!("Player {:?} received final hit bonus: {} {} ({}% of stone health)", 
                         attacker_id, final_hit_bonus, resource_name, (bonus_percentage * 100.0) as u32);
                // Bonus notification is now handled by the item acquisition system via grant_resource()
                
                // Track final bonus for quest progress - ONLY "Stone" counts (not Metal Ore, Sulfur, etc.)
                if let Err(e) = crate::quests::track_quest_progress(
                    ctx,
                    attacker_id,
                    crate::quests::QuestObjectiveType::GatherStone,
                    Some(resource_name),
                    final_hit_bonus,
                ) {
                    log::error!("Failed to track quest progress for final stone bonus: {}", e);
                }
            }
        }
        
        log::info!("Stone {} depleted by Player {:?}. Scheduling respawn.", stone_id, attacker_id);
        
        // Award XP and update stats for stone mined
        if let Err(e) = crate::player_progression::award_xp(ctx, attacker_id, crate::player_progression::XP_STONE_MINED) {
            log::error!("Failed to award XP for stone mining: {}", e);
        }
        
        // Track stone mined stat and check achievements
        if let Err(e) = crate::player_progression::track_stat_and_check_achievements(ctx, attacker_id, "stones_mined", 1) {
            log::error!("Failed to check achievements after stone mining: {}", e);
        }
        
        // Track quest progress for stone node destruction (e.g., "deplete 5 stone nodes")
        if let Err(e) = crate::quests::track_quest_progress(
            ctx,
            attacker_id,
            crate::quests::QuestObjectiveType::MineStoneNode,
            None,
            1,
        ) {
            log::error!("Failed to track quest progress for stone node destruction: {}", e);
        }
        
        // Calculate random respawn time for stones
        let respawn_duration_secs = if stone::MIN_STONE_RESPAWN_TIME_SECS >= stone::MAX_STONE_RESPAWN_TIME_SECS {
            stone::MIN_STONE_RESPAWN_TIME_SECS
        } else {
            rng.gen_range(stone::MIN_STONE_RESPAWN_TIME_SECS..=stone::MAX_STONE_RESPAWN_TIME_SECS)
        };
        let respawn_time = timestamp + TimeDuration::from_micros(respawn_duration_secs as i64 * 1_000_000);
        stone.respawn_at = respawn_time;
        crate::spatial_grid::invalidate_static_grid();
    }
    
    ctx.db.stone().id().update(stone);
    
    Ok(AttackResult {
        hit: true,
        target_type: Some(TargetType::Stone),
        resource_granted: if actual_yield > 0 { Some((resource_name.to_string(), actual_yield)) } else { None },
    })
}

/// Applies damage to living coral and handles resource drops
///
/// Living coral is an underwater resource that requires a Diving Pick to harvest.
/// Yields Limestone primarily, with chances for Coral Fragments, Shells, and Pearls.
pub fn damage_living_coral(
    ctx: &ReducerContext,
    attacker_id: Identity,
    coral_id: u64,
    damage: f32,
    yield_amount: u32,
    timestamp: Timestamp,
    rng: &mut impl Rng
) -> Result<AttackResult, String> {
    use crate::coral::{
        LIVING_CORAL_MIN_RESOURCES, LIVING_CORAL_MAX_RESOURCES,
        MIN_LIVING_CORAL_RESPAWN_TIME_SECS, MAX_LIVING_CORAL_RESPAWN_TIME_SECS,
        LIVING_CORAL_INITIAL_HEALTH,
    };
    
    let mut coral = ctx.db.living_coral().id().find(coral_id)
        .ok_or_else(|| "Target coral disappeared".to_string())?;
    
    // Check if player is snorkeling (required for underwater harvesting - must be submerged)
    let player = ctx.db.player().identity().find(&attacker_id)
        .ok_or_else(|| "Attacker not found".to_string())?;
    
    if !player.is_snorkeling {
        return Err("You must be underwater (snorkeling) to harvest living coral.".to_string());
    }
    
    // Check if player has Diving Pick equipped
    let active_equipment = ctx.db.active_equipment().player_identity().find(attacker_id);
    let has_diving_pick = if let Some(equip) = active_equipment {
        if let Some(equipped_item_id) = equip.equipped_item_instance_id {
            if let Some(equipped_item) = ctx.db.inventory_item().instance_id().find(equipped_item_id) {
                if let Some(item_def) = ctx.db.item_definition().id().find(equipped_item.item_def_id) {
                    item_def.name == "Diving Pick"
                } else {
                    false
                }
            } else {
                false
            }
        } else {
            false
        }
    } else {
        false
    };
    
    if !has_diving_pick {
        return Err("You need a Diving Pick to harvest living coral.".to_string());
    }
    
    log::info!("[damage_living_coral] Coral {} - health: {}, resource_remaining: {}, yield_amount: {}, damage: {}",
               coral_id, coral.health, coral.resource_remaining, yield_amount, damage);
    
    let old_health = coral.health;
    coral.health = coral.health.saturating_sub(damage as u32);
    coral.last_hit_time = Some(timestamp);
    
    // Calculate actual yield based on resource remaining
    let actual_yield = std::cmp::min(yield_amount, coral.resource_remaining);
    
    // Grant Limestone as primary resource
    if actual_yield > 0 {
        if let Err(e) = grant_resource(ctx, attacker_id, "Limestone", actual_yield) {
            log::error!("Failed to grant Limestone to player {:?}: {}", attacker_id, e);
        }
    }
    
    // Update resource remaining
    coral.resource_remaining = coral.resource_remaining.saturating_sub(actual_yield);
    
    log::info!("Player {:?} hit Living Coral {} for {:.1} damage. Health: {} -> {}, Resources: {} remaining",
               attacker_id, coral_id, damage, old_health, coral.health, coral.resource_remaining);
    
    // Coral is destroyed when either health reaches 0 OR resources are depleted
    let coral_destroyed = coral.health == 0 || coral.resource_remaining == 0;
    
    // Bonus drops on hit (secondary yields)
    // Coral Fragments: 15% chance per hit
    if rng.gen::<f32>() < 0.15 {
        let coral_frag_amount = rng.gen_range(1..=2);
        if let Err(e) = grant_resource(ctx, attacker_id, "Coral Fragments", coral_frag_amount) {
            log::error!("Failed to grant Coral Fragments to player {:?}: {}", attacker_id, e);
        }
    }
    
    // Shell: 5% chance per hit
    if rng.gen::<f32>() < 0.05 {
        if let Err(e) = grant_resource(ctx, attacker_id, "Shell", 1) {
            log::error!("Failed to grant Shell to player {:?}: {}", attacker_id, e);
        }
    }
    
    // Pearl: 2% chance per hit (rare)
    if rng.gen::<f32>() < 0.02 {
        if let Err(e) = grant_resource(ctx, attacker_id, "Pearl", 1) {
            log::error!("Failed to grant Pearl to player {:?}: {}", attacker_id, e);
        }
    }
    
    // === PLAYER PROGRESSION: Award XP for coral mining ===
    if let Err(e) = crate::player_progression::award_xp(ctx, attacker_id, crate::player_progression::XP_CORAL_HARVESTED) {
        log::warn!("Failed to award XP for coral mining: {}", e);
    }
    // Track coral mined for achievements
    if let Err(e) = crate::player_progression::track_stat_and_check_achievements(ctx, attacker_id, "corals_mined", 1) {
        log::warn!("Failed to check coral mining achievements: {}", e);
    }
    
    // Track quest progress for coral mining
    if let Err(e) = crate::quests::track_quest_progress(
        ctx,
        attacker_id,
        crate::quests::QuestObjectiveType::MineCoral,
        None,
        1,
    ) {
        log::warn!("Failed to track quest progress for coral mining: {}", e);
    }
    
    if coral_destroyed {
        // Final hit bonus: grant extra resources (like stone)
        let bonus_percentage = 0.15; // 15% bonus
        let final_hit_bonus = (LIVING_CORAL_INITIAL_HEALTH as f32 * bonus_percentage) as u32;
        
        if final_hit_bonus > 0 {
            if let Err(e) = grant_resource(ctx, attacker_id, "Limestone", final_hit_bonus) {
                log::error!("Failed to grant final hit bonus Limestone to player {:?}: {}", attacker_id, e);
            } else {
                log::info!("Player {:?} received final hit bonus: {} Limestone",
                          attacker_id, final_hit_bonus);
            }
        }
        
        log::info!("Living Coral {} depleted by Player {:?}. Scheduling respawn.", coral_id, attacker_id);
        
        // Calculate random respawn time
        let respawn_duration_secs = if MIN_LIVING_CORAL_RESPAWN_TIME_SECS >= MAX_LIVING_CORAL_RESPAWN_TIME_SECS {
            MIN_LIVING_CORAL_RESPAWN_TIME_SECS
        } else {
            rng.gen_range(MIN_LIVING_CORAL_RESPAWN_TIME_SECS..=MAX_LIVING_CORAL_RESPAWN_TIME_SECS)
        };
        let respawn_time = timestamp + TimeDuration::from_micros(respawn_duration_secs as i64 * 1_000_000);
        coral.respawn_at = respawn_time;
        
        // Reset health and resources for next respawn
        coral.health = LIVING_CORAL_INITIAL_HEALTH;
        coral.resource_remaining = rng.gen_range(LIVING_CORAL_MIN_RESOURCES..=LIVING_CORAL_MAX_RESOURCES);
    }
    
    ctx.db.living_coral().id().update(coral);
    
    Ok(AttackResult {
        hit: true,
        target_type: Some(TargetType::LivingCoral),
        resource_granted: if actual_yield > 0 { Some(("Limestone".to_string(), actual_yield)) } else { None },
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

    // <<< OFFLINE PLAYER CHECK - Offline players cannot take damage (their corpse can) >>>
    if !target_player.is_online {
        log::debug!("Target player {:?} is offline. No damage applied (attack their corpse instead).", target_id);
        return Ok(AttackResult { hit: false, target_type: Some(TargetType::Player), resource_granted: None });
    }
    // <<< END OFFLINE PLAYER CHECK >>>

    // <<< SAFE ZONE CHECK - Players in safe zones are immune to player weapon damage >>>
    if crate::active_effects::player_has_safe_zone_effect(ctx, target_id) {
        log::info!("Player {:?} attack blocked - Target player {:?} is in a safe zone", 
            attacker_id, target_id);
        return Ok(AttackResult { hit: false, target_type: Some(TargetType::Player), resource_granted: None });
    }
    // <<< END SAFE ZONE CHECK >>>

    // <<< PVP CHECK - Per-player PvP flag system >>>
    // NEW LOGIC: If the TARGET has PvP enabled, anyone can attack them.
    // If a non-PvP attacker attacks a PvP target, they automatically get PvP enabled.
    let attacker_pvp_active = attacker_player_opt.as_ref()
        .map(|p| is_pvp_active_for_player(p, timestamp))
        .unwrap_or(false);
    let target_pvp_active = is_pvp_active_for_player(&target_player, timestamp);

    // PvP is allowed if the TARGET has PvP enabled (attackers can hit PvP-flagged players)
    // If neither has PvP enabled, block the attack
    if attacker_player_opt.is_some() && !target_pvp_active && !attacker_pvp_active {
        log::debug!("PvP blocked - Neither player has PvP enabled. Attacker PvP: {}, Target PvP: {}", 
            attacker_pvp_active, target_pvp_active);
        return Ok(AttackResult { hit: false, target_type: Some(TargetType::Player), resource_granted: None });
    }
    
    // If only the target has PvP (attacker doesn't), auto-enable PvP for the attacker
    // This makes attacking a PvP player a commitment - you become PvP-flagged too!
    if target_pvp_active && !attacker_pvp_active {
        if let Some(attacker_player) = attacker_player_opt.as_ref() {
            let pvp_duration_micros: i64 = 30 * 60 * 1_000_000; // 30 minutes
            let until = Timestamp::from_micros_since_unix_epoch(
                timestamp.to_micros_since_unix_epoch() + pvp_duration_micros
            );
            
            let mut updated_attacker = attacker_player.clone();
            updated_attacker.pvp_enabled = true;
            updated_attacker.pvp_enabled_until = Some(until);
            updated_attacker.last_pvp_combat_time = Some(timestamp);
            ctx.db.player().identity().update(updated_attacker);
            
            log::info!("Player {:?} attacked PvP player {:?} - auto-enabled PvP for attacker for 30 minutes!", 
                attacker_id, target_id);
        }
    }
    // <<< END PVP CHECK >>>

    let mut final_damage = damage; // Start with the damage passed in (already calculated from weapon stats)

    // <<< APPLY LOW HEALTH DAMAGE BONUS (WOLF FUR ARMOR / QILAX TOTEM) >>>
    // Check if attacker has low health damage bonus and is below 30% health
    if let Some(attacker_player) = attacker_player_opt.as_ref() {
        const LOW_HEALTH_THRESHOLD: f32 = 30.0; // 30% health threshold
        if attacker_player.health <= LOW_HEALTH_THRESHOLD {
            let damage_bonus = armor::calculate_low_health_damage_bonus(ctx, attacker_id);
            if damage_bonus > 0.0 {
                let bonus_damage = final_damage * damage_bonus;
                final_damage += bonus_damage;
                log::info!(
                    "Player {:?} has low health ({:.1} HP) - gained +{:.0}% damage bonus ({:.1} extra damage) from wolf fur armor",
                    attacker_id, attacker_player.health, damage_bonus * 100.0, bonus_damage
                );
            }
        }
    }
    // <<< END LOW HEALTH DAMAGE BONUS >>>
    
    // <<< APPLY MELEE DAMAGE BONUS (TANUUX TOTEM - POLAR BEAR) >>>
    let melee_damage_bonus = armor::calculate_melee_damage_bonus(ctx, attacker_id);
    if melee_damage_bonus > 0.0 {
        let bonus_damage = final_damage * melee_damage_bonus;
        final_damage += bonus_damage;
        log::info!(
            "Player {:?} gained +{:.0}% melee damage bonus ({:.1} extra damage) from bone totem",
            attacker_id, melee_damage_bonus * 100.0, bonus_damage
        );
    }
    // <<< END MELEE DAMAGE BONUS >>>
    
    // <<< APPLY ALLY DAMAGE BONUS (SABAAKAX TOTEM - WOLF) >>>
    // Check if attacker has allies nearby and has the ally damage bonus
    let ally_damage_bonus = armor::calculate_ally_damage_bonus(ctx, attacker_id);
    if ally_damage_bonus > 0.0 {
        if let Some(attacker_player) = attacker_player_opt.as_ref() {
            let has_ally_nearby = check_for_nearby_allies(ctx, attacker_id, attacker_player.position_x, attacker_player.position_y);
            if has_ally_nearby {
                let bonus_damage = final_damage * ally_damage_bonus;
                final_damage += bonus_damage;
                log::info!(
                    "Player {:?} gained +{:.0}% ally damage bonus ({:.1} extra damage) from pack totem",
                    attacker_id, ally_damage_bonus * 100.0, bonus_damage
                );
            }
        }
    }
    // <<< END ALLY DAMAGE BONUS >>>

    // <<< APPLY TYPED ARMOR RESISTANCE >>>
    // Determine damage type from weapon (default to Melee if not specified)
    let damage_type = item_def.damage_type.unwrap_or(DamageType::Melee);
    let resistance = armor::calculate_resistance_for_damage_type(ctx, target_id, damage_type);
    
    if resistance > 0.0 {
        let damage_reduction = final_damage * resistance;
        let resisted_damage = final_damage - damage_reduction;
        
        log::info!(
            "Player {:?} attacking Player {:?} with {:?}. Initial Damage: {:.2}, {:?} Resistance: {:.2} ({:.0}%), Final Damage: {:.2}",
            attacker_id, target_id, damage_type,
            final_damage,
            damage_type,
            resistance,
            resistance * 100.0,
            resisted_damage.max(0.0)
        );
        final_damage = resisted_damage.max(0.0); // Damage cannot be negative
    } else {
        log::info!(
            "Player {:?} attacking Player {:?} with {:?}. Initial Damage: {:.2} (No resistance). Final Damage: {:.2}",
            attacker_id, target_id, damage_type,
            final_damage, 
            final_damage
        );
    }
    // <<< END APPLY TYPED ARMOR RESISTANCE >>>

    // A "hit" has occurred. Set last_hit_time immediately for client visuals.
    target_player.last_hit_time = Some(timestamp);

    let old_health = target_player.health;
    target_player.health = (target_player.health - final_damage).clamp(0.0, MAX_HEALTH_VALUE);
    let actual_damage_applied = old_health - target_player.health; // This is essentially final_damage clamped by remaining health

    // Update PvP combat timestamps for both players (extends timer if in combat near expiry)
    if actual_damage_applied > 0.0 && attacker_player_opt.is_some() {
        update_pvp_combat_time(ctx, attacker_id, timestamp);
        update_pvp_combat_time(ctx, target_id, timestamp);
    }

    // <<< APPLY MELEE DAMAGE REFLECTION (WOODEN ARMOR) >>>
    // Only reflect damage from melee attacks (not projectiles)
    if actual_damage_applied > 0.0 && damage_type == DamageType::Melee {
        let reflection_percent = armor::calculate_melee_damage_reflection(ctx, target_id);
        if reflection_percent > 0.0 {
            let reflected_damage = actual_damage_applied * reflection_percent;
            
            // Apply reflected damage to attacker
            if let Some(mut attacker_to_damage) = players.identity().find(&attacker_id) {
                if !attacker_to_damage.is_dead {
                    let attacker_old_health = attacker_to_damage.health;
                    attacker_to_damage.health = (attacker_to_damage.health - reflected_damage).clamp(0.0, MAX_HEALTH_VALUE);
                    let attacker_actual_reflected = attacker_old_health - attacker_to_damage.health;
                    
                    log::info!(
                        "Player {:?} reflected {:.1} damage ({:.0}%) back to attacker {:?} (wooden armor reflection)",
                        target_id, attacker_actual_reflected, reflection_percent * 100.0, attacker_id
                    );
                    
                    // Check if attacker died from reflection
                    if attacker_to_damage.health <= 0.0 && !attacker_to_damage.is_dead {
                        attacker_to_damage.is_dead = true;
                        attacker_to_damage.death_timestamp = Some(timestamp);
                        log::info!("Attacker {:?} killed by reflected damage from {:?}!", attacker_id, target_id);
                        
                        // Drop active weapon on death (before clearing equipment and creating corpse)
                        match crate::dropped_item::drop_active_weapon_on_death(ctx, attacker_id, attacker_to_damage.position_x, attacker_to_damage.position_y) {
                            Ok(Some(item_name)) => log::info!("[PlayerDeath] Dropped active weapon '{}' for attacker {:?} killed by reflection", item_name, attacker_id),
                            Ok(None) => log::debug!("[PlayerDeath] No active weapon to drop for attacker {:?}", attacker_id),
                            Err(e) => log::error!("[PlayerDeath] Failed to drop active weapon for attacker {:?}: {}", attacker_id, e),
                        }
                        
                        // Clear active item reference
                        match crate::active_equipment::clear_active_item_reducer(ctx, attacker_id) {
                            Ok(_) => log::info!("[PlayerDeath] Active item cleared for attacker {:?}", attacker_id),
                            Err(e) => log::error!("[PlayerDeath] Failed to clear active item for attacker {:?}: {}", attacker_id, e),
                        }
                        
                        // Clear all active effects on death (bleed, venom, burns, stun, etc.)
                        crate::active_effects::clear_all_effects_on_death(ctx, attacker_id);
                        log::info!("[PlayerDeath] Cleared all active effects for attacker {:?} killed by reflected damage", attacker_id);
                        
                        // Create corpse for attacker
                        match create_player_corpse(ctx, attacker_id, attacker_to_damage.position_x, attacker_to_damage.position_y, &attacker_to_damage.username) {
                            Ok(_) => log::info!("Created corpse for attacker {:?} killed by reflected damage", attacker_id),
                            Err(e) => log::error!("Failed to create corpse for attacker {:?}: {}", attacker_id, e),
                        }
                    }
                    
                    players.identity().update(attacker_to_damage);
                }
            }
        }
    }
    // <<< END MELEE DAMAGE REFLECTION >>>

    // --- APPLY KNOCKBACK and update timestamp if damage was dealt ---
    if actual_damage_applied > 0.0 { // Only apply knockback and update timestamp if actual damage occurred
        target_player.last_update = timestamp; // Update target's timestamp due to health change and potential knockback

        if let Some(mut attacker) = attacker_player_opt.clone() { // Clone attacker_player_opt to get a mutable attacker if needed
            // <<< CHECK KNOCKBACK IMMUNITY FROM ARMOR >>>
            let has_knockback_immunity = armor::has_armor_immunity(ctx, target_id, ImmunityType::Knockback);
            
            // Only apply knockback if both players are online AND target doesn't have knockback immunity
            let should_apply_knockback = attacker.is_online && target_player.is_online && !has_knockback_immunity;
            
            if has_knockback_immunity {
                log::debug!("Player {:?} is immune to knockback (armor immunity)", target_id);
            }
            // <<< END KNOCKBACK IMMUNITY CHECK >>>
            
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

    // Play weapon-specific hit sounds
    play_weapon_hit_sound(ctx, item_def, target_player.position_x, target_player.position_y, attacker_id);

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
            // <<< CHECK BLEED IMMUNITY FROM ARMOR >>>
            if armor::has_armor_immunity(ctx, target_id, ImmunityType::Bleed) {
                log::info!(
                    "[BleedCheck] Player {:?} is immune to bleed effects (armor immunity) from item '{}' (Def ID: {})", 
                    target_id, item_def.name, item_def.id
                );
                // Skip bleed application
            } else {
            // <<< END BLEED IMMUNITY CHECK >>>
            log::info!(
                "[BleedCheck] Item '{}' (Def ID: {}) has positive bleed properties (Dmg: {}, Dur: {}, Int: {}). Attempting to apply bleed effect to player {:?}.", 
                item_def.name, item_def.id, dmg_per_tick, duration_sec, interval_sec, target_id
            );
            
            let total_ticks = (duration_sec / interval_sec).floor();
            let bleed_total_damage = dmg_per_tick * total_ticks;

            // Use centralized apply_bleeding_effect function which respects MAX_BLEED_STACKS
            if let Err(e) = active_effects::apply_bleeding_effect(
                ctx,
                target_id,
                bleed_total_damage,
                duration_sec,
                interval_sec,
            ) {
                log::error!("Failed to apply bleed effect to player {:?} from item '{}': {}", target_id, item_def.name, e);
            }
            } // Close the else block for bleed immunity check
        } else {
            log::info!("[BleedCheck] Item '{}' has bleed properties, but one or more are zero. Not applying bleed.", item_def.name);
        }
    } else {
        log::info!("[BleedCheck] Item '{}' does not have all necessary bleed properties defined. Not applying bleed.", item_def.name);
    }
    
    // <<< APPLY BONE TOTEM BLEED CHANCE (ALAX TOTEM - SHARK) >>>
    // Check if attacker has bleed chance on melee from equipped totem
    let totem_bleed_chance = armor::get_bleed_chance_on_melee(ctx, attacker_id);
    if totem_bleed_chance > 0.0 && actual_damage_applied > 0.0 {
        let mut rng = ctx.rng();
        let roll: f32 = rng.gen_range(0.0..1.0);
        if roll < totem_bleed_chance {
            // Check if target has bleed immunity
            if !armor::has_armor_immunity(ctx, target_id, ImmunityType::Bleed) {
                // Apply moderate bleed from totem (1.5 dmg/tick, 8 sec duration, 1 sec interval = 12 total)
                const TOTEM_BLEED_DAMAGE_PER_TICK: f32 = 1.5;
                const TOTEM_BLEED_DURATION: f32 = 8.0;
                const TOTEM_BLEED_INTERVAL: f32 = 1.0;
                
                if let Err(e) = active_effects::apply_bleeding_effect(
                    ctx,
                    target_id,
                    TOTEM_BLEED_DAMAGE_PER_TICK * (TOTEM_BLEED_DURATION / TOTEM_BLEED_INTERVAL),
                    TOTEM_BLEED_DURATION,
                    TOTEM_BLEED_INTERVAL,
                ) {
                    log::error!("Failed to apply totem bleed effect to player {:?}: {}", target_id, e);
                } else {
                    log::info!(
                        "Player {:?}'s Alax Totem triggered bleed on player {:?} (roll: {:.2} < chance: {:.2})",
                        attacker_id, target_id, roll, totem_bleed_chance
                    );
                }
            }
        }
    }
    // <<< END BONE TOTEM BLEED CHANCE >>>
    
    // <<< APPLY BONE TOTEM POISON DAMAGE (QAX'AADAX TOTEM - VIPER) >>>
    // Check if attacker has poison damage on hit from equipped totem
    let totem_poison_damage = armor::get_poison_damage_on_hit(ctx, attacker_id);
    if totem_poison_damage > 0.0 && actual_damage_applied > 0.0 {
        // Apply poison effect (duration based on totem damage)
        // Higher totem poison damage = longer poison duration
        const POISON_BASE_DURATION: f32 = 6.0;
        let poison_duration = POISON_BASE_DURATION + (totem_poison_damage * 2.0);
        
        // Use a dummy item_def_id (0) since this is from a totem, not an item
        if let Err(e) = active_effects::apply_poisoned_effect(
            ctx,
            target_id,
            0, // No item def - this is from a bone totem
            poison_duration,
        ) {
            log::error!("Failed to apply totem poison effect to player {:?}: {}", target_id, e);
        } else {
            log::info!(
                "Player {:?}'s Qax'aadax Totem applied poison ({:.1}s duration) to player {:?}",
                attacker_id, poison_duration, target_id
            );
        }
    }
    // <<< END BONE TOTEM POISON DAMAGE >>>

    // Apply burn effect if the weapon is a lit torch
    if item_def.name == "Torch" {
        // Check if the attacker's torch is currently lit by checking the player's is_torch_lit field
        if let Some(attacker_player) = ctx.db.player().identity().find(&attacker_id) {
            if attacker_player.is_torch_lit {
                log::info!(
                    "[BurnCheck] Lit torch '{}' (Def ID: {}) hit player {:?}. Applying 3-second burn effect.", 
                    item_def.name, item_def.id, target_id
                );
                
                // Apply 3 seconds of burn damage (similar to campfire burn)
                const TORCH_BURN_DURATION: f32 = 3.0; // 3 seconds
                const TORCH_BURN_DAMAGE_PER_TICK: f32 = 2.0; // 2 damage per tick
                const TORCH_BURN_TICK_INTERVAL: f32 = 1.0; // Every 1 second
                
                match active_effects::apply_burn_effect(
                    ctx, 
                    target_id, 
                    TORCH_BURN_DAMAGE_PER_TICK * (TORCH_BURN_DURATION / TORCH_BURN_TICK_INTERVAL), // Total damage: 6
                    TORCH_BURN_DURATION, 
                    TORCH_BURN_TICK_INTERVAL,
                    item_def.id
                ) {
                    Ok(_) => {
                        log::info!(
                            "Successfully applied torch burn effect to player {:?} for {} seconds (total {} damage)",
                            target_id, TORCH_BURN_DURATION, TORCH_BURN_DAMAGE_PER_TICK * (TORCH_BURN_DURATION / TORCH_BURN_TICK_INTERVAL)
                        );
                    }
                    Err(e) => {
                        log::error!("Failed to apply torch burn effect to player {:?}: {}", target_id, e);
                    }
                }
            } else {
                log::debug!(
                    "[BurnCheck] Torch '{}' hit player {:?}, but torch is not lit. No burn effect applied.", 
                    item_def.name, target_id
                );
            }
        }
    }

    // Apply burn effect if attacker has HotCombatLadle effect (hot ladle + gloves)
    if active_effects::player_has_hot_combat_ladle_effect(ctx, attacker_id) {
        const HOT_LADLE_BURN_DURATION: f32 = 3.0;
        const HOT_LADLE_BURN_TOTAL_DAMAGE: f32 = 5.0; // Similar to campfire
        const HOT_LADLE_BURN_TICK_INTERVAL: f32 = 2.0;
        if let Err(e) = active_effects::apply_burn_effect(
            ctx,
            target_id,
            HOT_LADLE_BURN_TOTAL_DAMAGE,
            HOT_LADLE_BURN_DURATION,
            HOT_LADLE_BURN_TICK_INTERVAL,
            item_def.id,
        ) {
            log::error!("Failed to apply hot combat ladle burn effect to player {:?}: {}", target_id, e);
        }
    }

    // <<< BROTH EFFECT: PoisonCoating - apply poison to target if attacker has coating >>>
    if active_effects::player_has_poison_coating_effect(ctx, attacker_id) {
        // Check if target has poison resistance (reduces duration)
        let has_resistance = active_effects::player_has_poison_resistance_effect(ctx, target_id);
        let poison_duration = if has_resistance {
            active_effects::POISON_COATING_DURATION_SECS * (1.0 - active_effects::POISON_RESISTANCE_REDUCTION)
        } else {
            active_effects::POISON_COATING_DURATION_SECS
        };
        
        if poison_duration >= 1.0 {
            log::info!(
                "[PoisonCoating] Attacker {:?} has poison coating active. Applying {}s poison to target {:?}.", 
                attacker_id, poison_duration, target_id
            );
            
            if let Err(e) = active_effects::apply_poisoned_effect(
                ctx,
                target_id,
                item_def.id,
                poison_duration,
            ) {
                log::error!("Failed to apply poison coating effect to player {:?}: {}", target_id, e);
            }
        } else {
            log::info!(
                "[PoisonCoating] Target {:?} has poison resistance - poison blocked.",
                target_id
            );
        }
    }
    // <<< END BROTH EFFECT >>>

    // <<< STUN EFFECT: Blunt weapons have a chance to stun targets >>>
    if item_def.damage_type == Some(crate::models::DamageType::Blunt) {
        // Try to apply stun based on weapon type and random chance
        let was_stunned = active_effects::try_apply_blunt_weapon_stun(
            ctx,
            attacker_id,
            target_id,
            &item_def.name,
        );
        if was_stunned {
            log::info!(
                "[Stun] Player {:?} was STUNNED by {:?}'s {} attack!",
                target_id, attacker_id, item_def.name
            );
        }
    }
    // <<< END STUN EFFECT >>>

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

        // Drop active weapon on death (before clearing equipment and creating corpse)
        match crate::dropped_item::drop_active_weapon_on_death(ctx, target_id, target_player.position_x, target_player.position_y) {
            Ok(Some(item_name)) => log::info!("[PlayerDeath] Dropped active weapon '{}' for dying player {:?}", item_name, target_id),
            Ok(None) => log::debug!("[PlayerDeath] No active weapon to drop for dying player {:?}", target_id),
            Err(e) => log::error!("[PlayerDeath] Failed to drop active weapon for dying player {:?}: {}", target_id, e),
        }

        // Clear active item reference
        match crate::active_equipment::clear_active_item_reducer(ctx, target_player.identity) {
            Ok(_) => log::info!("[PlayerDeath] Active item cleared for dying player {}", target_player.identity),
            Err(e) => log::error!("[PlayerDeath] Failed to clear active item for dying player {}: {}", target_player.identity, e),
        }

        // Clear all active effects on death (bleed, venom, burns, healing, etc.)
        crate::active_effects::clear_all_effects_on_death(ctx, target_id);
        log::info!("[PlayerDeath] Cleared all active effects for dying player {:?}", target_id);

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

/// Applies damage to a lantern and handles destruction/item scattering
pub fn damage_lantern(
    ctx: &ReducerContext,
    attacker_id: Identity,
    lantern_id: u32,
    damage: f32,
    timestamp: Timestamp,
    rng: &mut impl Rng // Added RNG for item scattering
) -> Result<AttackResult, String> {
    // Check if the attacker is using a repair hammer
    if let Some(active_equip) = ctx.db.active_equipment().player_identity().find(attacker_id) {
        if let Some(equipped_item_id) = active_equip.equipped_item_instance_id {
            if let Some(equipped_item) = ctx.db.inventory_item().instance_id().find(equipped_item_id) {
                if let Some(item_def) = ctx.db.item_definition().id().find(equipped_item.item_def_id) {
                    if crate::repair::is_repair_hammer(&item_def) {
                        // Use repair instead of damage
                        return crate::repair::repair_lantern(ctx, attacker_id, lantern_id, damage, timestamp);
                    }
                }
            }
        }
    }

    // Original damage logic if not using repair hammer
    let mut lanterns_table = ctx.db.lantern();
    let mut lantern = lanterns_table.id().find(lantern_id)
        .ok_or_else(|| format!("Target lantern {} disappeared", lantern_id))?;

    if lantern.is_destroyed {
        return Ok(AttackResult { hit: false, target_type: Some(TargetType::Lantern), resource_granted: None });
    }

    // <<< PVP RAIDING CHECK >>>
    if let Some(attacker_player) = ctx.db.player().identity().find(attacker_id) {
        let attacker_pvp = is_pvp_active_for_player(&attacker_player, timestamp);
        
        if lantern.placed_by != attacker_id {
            if let Some(owner_player) = ctx.db.player().identity().find(&lantern.placed_by) {
                let owner_pvp = is_pvp_active_for_player(&owner_player, timestamp);
                
                if !attacker_pvp || !owner_pvp {
                    log::debug!("Structure raiding blocked - Attacker PvP: {}, Owner PvP: {}", 
                        attacker_pvp, owner_pvp);
                    return Ok(AttackResult { hit: false, target_type: Some(TargetType::Lantern), resource_granted: None });
                }
            }
        }
    }
    // <<< END PVP RAIDING CHECK >>>

    let old_health = lantern.health;
    lantern.health = (lantern.health - damage).max(0.0);
    lantern.last_hit_time = Some(timestamp);
    lantern.last_damaged_by = Some(attacker_id);

    log::info!(
        "Player {:?} hit Lantern {} for {:.1} damage. Health: {:.1} -> {:.1}",
        attacker_id, lantern_id, damage, old_health, lantern.health
    );

    // Play hit sound for all hits
    sound_events::emit_barrel_hit_sound(ctx, lantern.pos_x, lantern.pos_y, attacker_id);

    if lantern.health <= 0.0 {
        // Play destroyed sound
        sound_events::emit_barrel_destroyed_sound(ctx, lantern.pos_x, lantern.pos_y, attacker_id);
        lantern.is_destroyed = true;
        lantern.destroyed_at = Some(timestamp);
        
        // 🔊 Stop lantern sound when destroyed
        if lantern.is_burning {
            crate::sound_events::stop_lantern_sound(ctx, lantern.id as u64);
        }
        
        // Scatter items
        let mut items_to_drop: Vec<(u64, u32)> = Vec::new(); // (item_def_id, quantity)
        for i in 0..crate::lantern::NUM_FUEL_SLOTS {
            if let (Some(instance_id), Some(def_id)) = (lantern.get_slot_instance_id(i as u8), lantern.get_slot_def_id(i as u8)) {
                if let Some(item) = ctx.db.inventory_item().instance_id().find(instance_id) {
                    items_to_drop.push((def_id, item.quantity));
                    // Delete the InventoryItem from the central table
                    ctx.db.inventory_item().instance_id().delete(instance_id);
                }
                lantern.set_slot(i as u8, None, None); // Clear slot in lantern struct (though it's about to be deleted)
            }
        }

        // Update the lantern one last time to ensure is_destroyed and destroyed_at are sent to client
        lanterns_table.id().update(lantern.clone()); 
        // Then immediately delete the lantern entity itself
        lanterns_table.id().delete(lantern_id);

        log::info!(
            "Lantern {} destroyed by player {:?}. Dropping items.",
            lantern_id, attacker_id
        );

        // Scatter collected items around the lantern's location WITHOUT triggering consolidation per-item
        for (item_def_id, quantity) in items_to_drop {
            // Spawn slightly offset from lantern center
            let offset_x = (rng.gen::<f32>() - 0.5) * 2.0 * 15.0; // Spread within +/- 15px (smaller than campfire)
            let offset_y = (rng.gen::<f32>() - 0.5) * 2.0 * 15.0;
            let drop_pos_x = lantern.pos_x + offset_x;
            let drop_pos_y = lantern.pos_y + offset_y;

            match dropped_item::create_dropped_item_entity_no_consolidation(ctx, item_def_id, quantity, drop_pos_x, drop_pos_y) {
                Ok(_) => log::debug!("Dropped {} of item_def_id {} from destroyed lantern {}", quantity, item_def_id, lantern_id),
                Err(e) => log::error!("Failed to drop item_def_id {}: {}", item_def_id, e),
            }
        }
        
        // Trigger consolidation ONCE after all items are dropped
        dropped_item::trigger_consolidation_at_position(ctx, lantern.pos_x, lantern.pos_y);

    } else {
        // Lantern still has health, just update it
        lanterns_table.id().update(lantern);
    }

    Ok(AttackResult {
        hit: true,
        target_type: Some(TargetType::Lantern),
        resource_granted: None,
    })
}

/// Applies damage to a turret and handles destruction/item scattering
pub fn damage_turret(
    ctx: &ReducerContext,
    attacker_id: Identity,
    turret_id: u32,
    damage: f32,
    timestamp: Timestamp,
    rng: &mut impl Rng
) -> Result<AttackResult, String> {
    let mut turrets_table = ctx.db.turret();
    let mut turret = turrets_table.id().find(&turret_id)
        .ok_or_else(|| format!("Target turret {} disappeared", turret_id))?;

    if turret.is_destroyed {
        return Ok(AttackResult { hit: false, target_type: Some(TargetType::Turret), resource_granted: None });
    }

    // Monument turrets are indestructible
    if turret.is_monument {
        return Ok(AttackResult { hit: false, target_type: Some(TargetType::Turret), resource_granted: None });
    }

    // <<< PVP RAIDING CHECK >>>
    // Turret raiding requires both attacker and owner to have active PvP status
    if let Some(attacker_player) = ctx.db.player().identity().find(&attacker_id) {
        let attacker_pvp = is_pvp_active_for_player(&attacker_player, timestamp);
        
        if turret.placed_by != attacker_id {
            if let Some(owner_player) = ctx.db.player().identity().find(&turret.placed_by) {
                let owner_pvp = is_pvp_active_for_player(&owner_player, timestamp);
                
                if !attacker_pvp || !owner_pvp {
                    log::debug!("Turret raiding blocked - Attacker PvP: {}, Owner PvP: {}", 
                        attacker_pvp, owner_pvp);
                    return Ok(AttackResult { hit: false, target_type: Some(TargetType::Turret), resource_granted: None });
                }
            }
        }
    }
    // <<< END PVP RAIDING CHECK >>>

    let old_health = turret.health;
    turret.health = (turret.health - damage).max(0.0);
    turret.last_hit_time = Some(timestamp);

    log::info!(
        "Player {:?} hit Turret {} for {:.1} damage. Health: {:.1} -> {:.1}",
        attacker_id, turret_id, damage, old_health, turret.health
    );

    if turret.health <= 0.0 {
        turret.is_destroyed = true;
        turret.destroyed_at = Some(timestamp);
        
        // Scatter items
        let mut items_to_drop: Vec<(u64, u32)> = Vec::new();
        
        // Drop ammo if any
        if let Some(ammo_instance_id) = turret.ammo_instance_id {
            if let Some(ammo_item) = ctx.db.inventory_item().instance_id().find(&ammo_instance_id) {
                items_to_drop.push((ammo_item.item_def_id, ammo_item.quantity));
                ctx.db.inventory_item().instance_id().delete(ammo_instance_id);
            }
        }
        
        // Find turret item definition
        let item_defs = ctx.db.item_definition();
        let turret_item_name = match turret.turret_type {
            crate::turret::TURRET_TYPE_TALLOW_STEAM => "Tallow Steam Turret",
            _ => return Err("Unknown turret type".to_string()),
        };
        
        let turret_item_def = item_defs.iter()
            .find(|def| def.name == turret_item_name)
            .ok_or_else(|| format!("Turret item definition '{}' not found", turret_item_name))?;
        
        items_to_drop.push((turret_item_def.id, 1));

        turrets_table.id().update(turret.clone());
        turrets_table.id().delete(turret_id);

        log::info!("Turret {} destroyed by player {:?}. Dropping items.", turret_id, attacker_id);

        // Scatter items
        for (item_def_id, quantity) in items_to_drop {
            let offset_x = (rng.gen::<f32>() - 0.5) * 2.0 * 15.0;
            let offset_y = (rng.gen::<f32>() - 0.5) * 2.0 * 15.0;
            let drop_pos_x = turret.pos_x + offset_x;
            let drop_pos_y = turret.pos_y + offset_y;

            match dropped_item::create_dropped_item_entity_no_consolidation(ctx, item_def_id, quantity, drop_pos_x, drop_pos_y) {
                Ok(_) => log::debug!("Dropped {} of item_def_id {} from destroyed turret {}", quantity, item_def_id, turret_id),
                Err(e) => log::error!("Failed to drop item_def_id {}: {}", item_def_id, e),
            }
        }
        
        dropped_item::trigger_consolidation_at_position(ctx, turret.pos_x, turret.pos_y);
    } else {
        turrets_table.id().update(turret);
    }

    Ok(AttackResult {
        hit: true,
        target_type: Some(TargetType::Turret),
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
    // Check if the attacker is using a repair hammer
    if let Some(active_equip) = ctx.db.active_equipment().player_identity().find(attacker_id) {
        if let Some(equipped_item_id) = active_equip.equipped_item_instance_id {
            if let Some(equipped_item) = ctx.db.inventory_item().instance_id().find(equipped_item_id) {
                if let Some(item_def) = ctx.db.item_definition().id().find(equipped_item.item_def_id) {
                    if crate::repair::is_repair_hammer(&item_def) {
                        // Use repair instead of damage
                        return crate::repair::repair_campfire(ctx, attacker_id, campfire_id, damage, timestamp);
                    }
                }
            }
        }
    }

    // Original damage logic if not using repair hammer
    let mut campfires_table = ctx.db.campfire();
    let mut campfire = campfires_table.id().find(campfire_id)
        .ok_or_else(|| format!("Target campfire {} disappeared", campfire_id))?;

    // Monument placeables are indestructible
    if campfire.is_monument {
        return Err("Cannot damage monument structures.".to_string());
    }

    if campfire.is_destroyed {
        return Ok(AttackResult { hit: false, target_type: Some(TargetType::Campfire), resource_granted: None });
    }

    // <<< PVP RAIDING CHECK >>>
    if let Some(attacker_player) = ctx.db.player().identity().find(attacker_id) {
        let attacker_pvp = is_pvp_active_for_player(&attacker_player, timestamp);
        
        if campfire.placed_by != attacker_id {
            if let Some(owner_player) = ctx.db.player().identity().find(&campfire.placed_by) {
                let owner_pvp = is_pvp_active_for_player(&owner_player, timestamp);
                
                if !attacker_pvp || !owner_pvp {
                    log::debug!("Structure raiding blocked - Attacker PvP: {}, Owner PvP: {}", 
                        attacker_pvp, owner_pvp);
                    return Ok(AttackResult { hit: false, target_type: Some(TargetType::Campfire), resource_granted: None });
                }
            }
        }
    }
    // <<< END PVP RAIDING CHECK >>>

    let old_health = campfire.health;
    campfire.health = (campfire.health - damage).max(0.0);
    campfire.last_hit_time = Some(timestamp);
    campfire.last_damaged_by = Some(attacker_id);

    log::info!(
        "Player {:?} hit Campfire {} for {:.1} damage. Health: {:.1} -> {:.1}",
        attacker_id, campfire_id, damage, old_health, campfire.health
    );

    // Play hit sound - same as barrel4.png (wooden crate) for logs/sticks feel
    sound_events::emit_wood_hit_sound(ctx, campfire.pos_x, campfire.pos_y, attacker_id);

    if campfire.health <= 0.0 {
        // Play destroyed sound - same as barrel4.png
        sound_events::emit_box_destroyed_sound(ctx, campfire.pos_x, campfire.pos_y, attacker_id);
        campfire.is_destroyed = true;
        campfire.destroyed_at = Some(timestamp);
        
        // 🔊 Stop campfire sound when destroyed
        if campfire.is_burning {
            crate::sound_events::stop_campfire_sound(ctx, campfire.id as u64);
        }
        
        // 🍲 Drop broth pot if one is attached to this campfire
        if let Some(broth_pot_id) = campfire.attached_broth_pot_id {
            if let Some(mut broth_pot) = ctx.db.broth_pot().id().find(broth_pot_id) {
                log::info!("Campfire {} destroyed - dropping attached broth pot {}", campfire_id, broth_pot_id);
                
                // Get broth pot item definition
                let item_defs = ctx.db.item_definition();
                if let Some(broth_pot_def) = item_defs.iter().find(|def| def.name == "Cerametal Field Cauldron Mk. II") {
                    // Drop the cauldron below the campfire (south of it)
                    let drop_y = campfire.pos_y + crate::dropped_item::DROP_OFFSET;
                    if let Err(e) = crate::dropped_item::create_dropped_item_entity(
                        ctx,
                        broth_pot_def.id,
                        1,
                        campfire.pos_x,
                        drop_y,
                    ) {
                        log::error!("Failed to drop broth pot {} when campfire destroyed: {}", broth_pot_id, e);
                    } else {
                        log::info!("Dropped broth pot {} as item when campfire {} was destroyed", broth_pot_id, campfire_id);
                    }
                } else {
                    log::error!("Could not find Cerametal Field Cauldron Mk. II item definition");
                }
                
                // Drop water container if present in the broth pot
                let items = ctx.db.inventory_item();
                if let Some(water_container_instance_id) = broth_pot.water_container_instance_id {
                    if let Some(water_container_item) = items.instance_id().find(&water_container_instance_id) {
                        if let Some(water_container_def) = item_defs.id().find(&water_container_item.item_def_id) {
                            // Drop water container below campfire with preserved water content
                            let drop_y = campfire.pos_y + crate::dropped_item::DROP_OFFSET + 20.0; // Slightly further south
                            if let Err(e) = crate::dropped_item::create_dropped_item_entity_with_data(
                                ctx,
                                water_container_item.item_def_id,
                                water_container_item.quantity,
                                campfire.pos_x,
                                drop_y,
                                water_container_item.item_data.clone(),
                            ) {
                                log::error!("Failed to drop water container {} when campfire destroyed: {}", 
                                           water_container_instance_id, e);
                            } else {
                                log::info!("Dropped water container {} ({}) when campfire {} was destroyed", 
                                          water_container_instance_id, water_container_def.name, campfire_id);
                            }
                            
                            // Delete the inventory item (it's now a dropped item)
                            items.instance_id().delete(water_container_instance_id);
                        }
                    }
                }
                
                // Remove processing schedule for the broth pot
                ctx.db.broth_pot_processing_schedule().broth_pot_id().delete(broth_pot_id as u64);
                
                // Delete the broth pot entity
                ctx.db.broth_pot().id().delete(broth_pot_id);
            }
        }
        
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

        // Scatter collected items around the campfire's location WITHOUT triggering consolidation per-item
        for (item_def_id, quantity) in items_to_drop {
            // Spawn slightly offset from campfire center
            let offset_x = (rng.gen::<f32>() - 0.5) * 2.0 * 20.0; // Spread within +/- 20px
            let offset_y = (rng.gen::<f32>() - 0.5) * 2.0 * 20.0;
            let drop_pos_x = campfire.pos_x + offset_x;
            let drop_pos_y = campfire.pos_y + offset_y;

            match dropped_item::create_dropped_item_entity_no_consolidation(ctx, item_def_id, quantity, drop_pos_x, drop_pos_y) {
                Ok(_) => log::debug!("Dropped {} of item_def_id {} from destroyed campfire {}", quantity, item_def_id, campfire_id),
                Err(e) => log::error!("Failed to drop item_def_id {}: {}", item_def_id, e),
            }
        }
        
        // Trigger consolidation ONCE after all items are dropped
        dropped_item::trigger_consolidation_at_position(ctx, campfire.pos_x, campfire.pos_y);

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
    // Check if the attacker is using a repair hammer
    if let Some(active_equip) = ctx.db.active_equipment().player_identity().find(attacker_id) {
        if let Some(equipped_item_id) = active_equip.equipped_item_instance_id {
            if let Some(equipped_item) = ctx.db.inventory_item().instance_id().find(equipped_item_id) {
                if let Some(item_def) = ctx.db.item_definition().id().find(equipped_item.item_def_id) {
                    if crate::repair::is_repair_hammer(&item_def) {
                        // Use repair instead of damage
                        return crate::repair::repair_wooden_storage_box(ctx, attacker_id, box_id, damage, timestamp);
                    }
                }
            }
        }
    }

    // Original damage logic if not using repair hammer
    let mut boxes_table = ctx.db.wooden_storage_box();
    let mut wooden_box = boxes_table.id().find(box_id)
        .ok_or_else(|| format!("Target wooden storage box {} disappeared", box_id))?;

    // Monument placeables are indestructible
    if wooden_box.is_monument {
        return Err("Cannot damage monument structures.".to_string());
    }

    // Backpacks are not damageable - they should be looted, not destroyed
    if wooden_box.box_type == crate::wooden_storage_box::BOX_TYPE_BACKPACK {
        log::debug!("Player {:?} attempted to damage backpack {} - backpacks are not damageable", attacker_id, box_id);
        return Ok(AttackResult { hit: false, target_type: Some(TargetType::WoodenStorageBox), resource_granted: None });
    }

    if wooden_box.is_destroyed {
        return Ok(AttackResult { hit: false, target_type: Some(TargetType::WoodenStorageBox), resource_granted: None });
    }

    // <<< PVP RAIDING CHECK >>>
    if let Some(attacker_player) = ctx.db.player().identity().find(attacker_id) {
        let attacker_pvp = is_pvp_active_for_player(&attacker_player, timestamp);
        
        // Check if owner has PvP enabled (if owner is not the attacker)
        if wooden_box.placed_by != attacker_id {
            if let Some(owner_player) = ctx.db.player().identity().find(&wooden_box.placed_by) {
                let owner_pvp = is_pvp_active_for_player(&owner_player, timestamp);
                
                if !attacker_pvp || !owner_pvp {
                    log::debug!("Structure raiding blocked - Attacker PvP: {}, Owner PvP: {}", 
                        attacker_pvp, owner_pvp);
                    return Ok(AttackResult { hit: false, target_type: Some(TargetType::WoodenStorageBox), resource_granted: None });
                }
            }
        }
    }
    // <<< END PVP RAIDING CHECK >>>

    let old_health = wooden_box.health;
    wooden_box.health = (wooden_box.health - damage).max(0.0);
    wooden_box.last_hit_time = Some(timestamp);
    wooden_box.last_damaged_by = Some(attacker_id);

    log::info!(
        "Player {:?} hit WoodenStorageBox {} for {:.1} damage. Health: {:.1} -> {:.1}",
        attacker_id, box_id, damage, old_health, wooden_box.health
    );

    // Play hit sound based on box type
    // Normal and large wooden storage boxes use wood hit sound
    if wooden_box.box_type == crate::wooden_storage_box::BOX_TYPE_NORMAL ||
       wooden_box.box_type == crate::wooden_storage_box::BOX_TYPE_LARGE {
        sound_events::emit_wood_hit_sound(ctx, wooden_box.pos_x, wooden_box.pos_y, attacker_id);
    } else {
        sound_events::emit_barrel_hit_sound(ctx, wooden_box.pos_x, wooden_box.pos_y, attacker_id);
    }

    if wooden_box.health <= 0.0 {
        // Play destroyed sound - use box_destroyed for normal/large boxes, barrel_destroyed for others
        if wooden_box.box_type == crate::wooden_storage_box::BOX_TYPE_NORMAL ||
           wooden_box.box_type == crate::wooden_storage_box::BOX_TYPE_LARGE {
            sound_events::emit_box_destroyed_sound(ctx, wooden_box.pos_x, wooden_box.pos_y, attacker_id);
        } else {
            sound_events::emit_barrel_destroyed_sound(ctx, wooden_box.pos_x, wooden_box.pos_y, attacker_id);
        }
        wooden_box.is_destroyed = true;
        wooden_box.destroyed_at = Some(timestamp);
        
        // Stop beehive buzzing sound if this was a player beehive
        if wooden_box.box_type == crate::wooden_storage_box::BOX_TYPE_PLAYER_BEEHIVE {
            sound_events::stop_beehive_sound(ctx, box_id as u64);
        }

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

        // Drop all items WITHOUT triggering consolidation on each drop
        for (item_def_id, quantity) in items_to_drop {
            let offset_x = (rng.gen::<f32>() - 0.5) * 2.0 * 30.0; // Spread within +/- 30px
            let offset_y = (rng.gen::<f32>() - 0.5) * 2.0 * 30.0;
            let drop_pos_x = wooden_box.pos_x + offset_x;
            let drop_pos_y = wooden_box.pos_y + offset_y;

            match dropped_item::create_dropped_item_entity_no_consolidation(ctx, item_def_id, quantity, drop_pos_x, drop_pos_y) {
                Ok(_) => log::debug!("Dropped {} of item_def_id {} from destroyed box {}", quantity, item_def_id, box_id),
                Err(e) => log::error!("Failed to drop item_def_id {}: {}", item_def_id, e),
            }
        }
        
        // Trigger consolidation ONCE after all items are dropped
        dropped_item::trigger_consolidation_at_position(ctx, wooden_box.pos_x, wooden_box.pos_y);

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

    // <<< PVP RAIDING CHECK >>>
    if let Some(attacker_player) = ctx.db.player().identity().find(attacker_id) {
        let attacker_pvp = is_pvp_active_for_player(&attacker_player, timestamp);
        
        if stash.placed_by != attacker_id {
            if let Some(owner_player) = ctx.db.player().identity().find(&stash.placed_by) {
                let owner_pvp = is_pvp_active_for_player(&owner_player, timestamp);
                
                if !attacker_pvp || !owner_pvp {
                    log::debug!("Structure raiding blocked - Attacker PvP: {}, Owner PvP: {}", 
                        attacker_pvp, owner_pvp);
                    return Ok(AttackResult { hit: false, target_type: Some(TargetType::Stash), resource_granted: None });
                }
            }
        }
    }
    // <<< END PVP RAIDING CHECK >>>

    let old_health = stash.health;
    stash.health = (stash.health - damage).max(0.0);
    stash.last_hit_time = Some(timestamp);

    log::info!(
        "Player {:?} hit Stash {} for {:.1} damage. Health: {:.1} -> {:.1}",
        attacker_id, stash_id, damage, old_health, stash.health
    );

    // Play hit sound - same as barrel5.png (marine debris/trash pile) for cloth/buried stash feel
    sound_events::emit_trash_hit_sound(ctx, stash.pos_x, stash.pos_y, attacker_id);

    if stash.health <= 0.0 {
        // Play destroyed sound - same as barrel5.png
        sound_events::emit_box_destroyed_sound(ctx, stash.pos_x, stash.pos_y, attacker_id);
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

        // Drop all items WITHOUT triggering consolidation on each drop
        for (item_def_id, quantity) in items_to_drop {
            let offset_x = (rng.gen::<f32>() - 0.5) * 2.0 * 15.0; // Smaller spread for stash
            let offset_y = (rng.gen::<f32>() - 0.5) * 2.0 * 15.0;
            let drop_pos_x = stash.pos_x + offset_x;
            let drop_pos_y = stash.pos_y + offset_y;

            match dropped_item::create_dropped_item_entity_no_consolidation(ctx, item_def_id, quantity, drop_pos_x, drop_pos_y) {
                Ok(_) => log::debug!("Dropped {} of item_def_id {} from destroyed stash {}", quantity, item_def_id, stash_id),
                Err(e) => log::error!("Failed to drop item_def_id {}: {}", item_def_id, e),
            }
        }
        
        // Trigger consolidation ONCE after all items are dropped
        dropped_item::trigger_consolidation_at_position(ctx, stash.pos_x, stash.pos_y);
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

    // <<< PVP RAIDING CHECK >>>
    if let Some(attacker_player) = ctx.db.player().identity().find(attacker_id) {
        let attacker_pvp = is_pvp_active_for_player(&attacker_player, timestamp);
        
        if bag.placed_by != attacker_id {
            if let Some(owner_player) = ctx.db.player().identity().find(&bag.placed_by) {
                let owner_pvp = is_pvp_active_for_player(&owner_player, timestamp);
                
                if !attacker_pvp || !owner_pvp {
                    log::debug!("Structure raiding blocked - Attacker PvP: {}, Owner PvP: {}", 
                        attacker_pvp, owner_pvp);
                    return Ok(AttackResult { hit: false, target_type: Some(TargetType::SleepingBag), resource_granted: None });
                }
            }
        }
    }
    // <<< END PVP RAIDING CHECK >>>

    let old_health = bag.health;
    bag.health = (bag.health - damage).max(0.0);
    bag.last_hit_time = Some(timestamp);

    log::info!(
        "Player {:?} hit SleepingBag {} for {:.1} damage. Health: {:.1} -> {:.1}",
        attacker_id, bag_id, damage, old_health, bag.health
    );

    // Play hit sound - same as barrel5.png (marine debris) for cloth/fabric feel
    sound_events::emit_trash_hit_sound(ctx, bag.pos_x, bag.pos_y, attacker_id);

    if bag.health <= 0.0 {
        // Play destroyed sound - same as barrel5.png (marine debris) for cloth/fabric feel
        sound_events::emit_box_destroyed_sound(ctx, bag.pos_x, bag.pos_y, attacker_id);
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
        // Still update last_hit_time for visual feedback before deletion
        corpse.last_hit_time = Some(timestamp);
        player_corpses_table.id().update(corpse);
        log::warn!("[DamagePlayerCorpse] Corpse {} already has 0 health. No action taken.", corpse_id);
        return Ok(AttackResult { hit: false, target_type: Some(TargetType::PlayerCorpse), resource_granted: None });
    }

    let old_health = corpse.health;
    corpse.health = corpse.health.saturating_sub(damage as u32);
    // Always update last_hit_time on every hit for shake effect
    corpse.last_hit_time = Some(timestamp);

    log::info!(
        "Player {:?} hit PlayerCorpse {} for {:.1} damage. Health: {} -> {}",
        attacker_id, corpse_id, damage, old_health, corpse.health
    );

    // Play weapon-specific hit sounds
    play_weapon_hit_sound(ctx, item_def, corpse.pos_x, corpse.pos_y, attacker_id);

    // Ranged weapons cannot harvest resources from corpses - they can only deal damage
    if item_def.category == ItemCategory::RangedWeapon {
        log::info!(
            "[DamagePlayerCorpse] Ranged weapon '{}' cannot harvest resources - only dealing damage",
            item_def.name
        );
        
        // Update corpse health and return without granting resources
        if corpse.health == 0 {
            // Corpse depleted - handle deletion and item scattering (same as normal depletion)
            let mut items_to_drop: Vec<(u64, u32)> = Vec::new();
            let inventory_items_table = ctx.db.inventory_item();

            for i in 0..corpse.num_slots() as u8 {
                if let (Some(instance_id), Some(def_id)) = (corpse.get_slot_instance_id(i), corpse.get_slot_def_id(i)) {
                    if let Some(item) = inventory_items_table.instance_id().find(instance_id) {
                        items_to_drop.push((def_id, item.quantity));
                        inventory_items_table.instance_id().delete(instance_id);
                    }
                }
            }

            // Scatter items around the corpse's location WITHOUT triggering consolidation per-item
            let corpse_pos_x = corpse.pos_x;
            let corpse_pos_y = corpse.pos_y;

            for (item_def_id, quantity) in items_to_drop {
                let offset_x = (rng.gen::<f32>() - 0.5) * 2.0 * 30.0;
                let offset_y = (rng.gen::<f32>() - 0.5) * 2.0 * 30.0;
                let drop_pos_x = corpse_pos_x + offset_x;
                let drop_pos_y = corpse_pos_y + offset_y;

                match dropped_item::create_dropped_item_entity_no_consolidation(ctx, item_def_id, quantity, drop_pos_x, drop_pos_y) {
                    Ok(_) => log::debug!("[DamagePlayerCorpse] Dropped {} of item_def_id {} from depleted corpse {} at ({:.1}, {:.1})", 
                                       quantity, item_def_id, corpse_id, drop_pos_x, drop_pos_y),
                    Err(e) => log::error!("[DamagePlayerCorpse] Failed to drop item_def_id {} from corpse {}: {}", item_def_id, corpse_id, e),
                }
            }
            
            // Trigger consolidation ONCE after all items are dropped
            dropped_item::trigger_consolidation_at_position(ctx, corpse_pos_x, corpse_pos_y);

            // Delete the PlayerCorpse entity itself
            player_corpses_table.id().delete(corpse_id);
            
            // Cancel any existing despawn schedule
            let despawn_schedule_table = ctx.db.player_corpse_despawn_schedule();
            if despawn_schedule_table.corpse_id().find(corpse_id as u64).is_some() {
                despawn_schedule_table.corpse_id().delete(corpse_id as u64);
            }
        } else {
            // Corpse still has health, just update it
            player_corpses_table.id().update(corpse);
        }
        
        return Ok(AttackResult {
            hit: true,
            target_type: Some(TargetType::PlayerCorpse),
            resource_granted: None,
        });
    }

    let mut resources_granted: Vec<(String, u32)> = Vec::new();

    // Determine resources based on RNG and tool
    const BASE_CHANCE_FAT: f64 = 0.50; 
    const BASE_CHANCE_FLESH: f64 = 0.30;
    const BASE_CHANCE_BONE: f64 = 0.20;
    // Multipliers for specific tools and general categories
    const BONE_KNIFE_MULTIPLIER: f64 = 5.0;
    const BONE_CLUB_MULTIPLIER: f64 = 3.0;
    const MACHETE_MULTIPLIER: f64 = 7.0; // High effectiveness for sharp cutting tool
    const AK74_BAYONET_MULTIPLIER: f64 = 10.0; // Highest effectiveness for modern military bayonet
    const PRIMARY_CORPSE_TOOL_MULTIPLIER: f64 = 1.0;
    const NON_PRIMARY_ITEM_MULTIPLIER: f64 = 0.1; // For non-primary items when harvesting corpses

    let effectiveness_multiplier = match item_def.name.as_str() {
        "AK74 Bayonet" => AK74_BAYONET_MULTIPLIER,
        "Bone Knife" => BONE_KNIFE_MULTIPLIER,
        "Bone Club" => BONE_CLUB_MULTIPLIER,
        "Bush Knife" => MACHETE_MULTIPLIER,
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
        "AK74 Bayonet" => rng.gen_range(4..=7), // Highest yield for modern military bayonet
        "Bone Knife" => rng.gen_range(3..=5),
        "Bone Club" => rng.gen_range(2..=4),
        "Bush Knife" => rng.gen_range(1..=3),
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

    let corpse_yield_mult = corpse_harvest_yield_multiplier(item_def);

    // Example: 50% chance to get Animal Fat per hit, if corpse still has health
    // Apply logarithmic bonus based on time alive
    if corpse.health > 0 && rng.gen_bool(actual_chance_fat) {
        let base_fat = quantity_per_successful_hit;
        let time_alive_bonus = calculate_fat_bonus_from_time_alive(corpse.spawned_at, corpse.death_time);
        let total_fat = (base_fat + time_alive_bonus).saturating_mul(corpse_yield_mult);
        
        log::debug!(
            "[DamagePlayerCorpse:{}] Time alive bonus: {} (base: {}, total: {})",
            corpse_id, time_alive_bonus, base_fat, total_fat
        );
        
        match grant_resource(ctx, attacker_id, "Animal Fat", total_fat) {
            Ok(_) => resources_granted.push(("Animal Fat".to_string(), total_fat)),
            Err(e) => log::error!("Failed to grant Animal Fat: {}", e),
        }
    }

    // Example: 30% chance to get 1 Raw Human Flesh per hit
    if corpse.health > 0 && rng.gen_bool(actual_chance_flesh) {
        let q = quantity_per_successful_hit.saturating_mul(corpse_yield_mult);
        match grant_resource(ctx, attacker_id, "Raw Human Flesh", q) {
            Ok(_) => resources_granted.push(("Raw Human Flesh".to_string(), q)),
            Err(e) => log::error!("Failed to grant Raw Human Flesh: {}", e),
        }
    }
    
    // Example: 20% chance to get 1 Animal Bone per hit
    if corpse.health > 0 && rng.gen_bool(actual_chance_bone) {
        let q = quantity_per_successful_hit.saturating_mul(corpse_yield_mult);
        match grant_resource(ctx, attacker_id, "Animal Bone", q) {
            Ok(_) => resources_granted.push(("Animal Bone".to_string(), q)),
            Err(e) => log::error!("Failed to grant Animal Bone: {}", e),
        }
    }

    if corpse.health == 0 {
        log::info!("[DamagePlayerCorpse:{}] Corpse depleted by Player {:?} using item {} (category {:?}, multiplier {:.1}). Checking for Human Skull grant.", 
                 corpse_id, attacker_id, item_def.name, item_def.category, effectiveness_multiplier);
        
        // Exactly one Human Skull per depleted corpse (trophy), when finished with a Tool
        if item_def.category == ItemCategory::Tool {
            const HUMAN_SKULLS_PER_DEPLETED_CORPSE: u32 = 1;
            match grant_resource(ctx, attacker_id, "Human Skull", HUMAN_SKULLS_PER_DEPLETED_CORPSE) {
                Ok(_) => {
                    resources_granted.push(("Human Skull".to_string(), HUMAN_SKULLS_PER_DEPLETED_CORPSE));
                    log::info!(
                        "[DamagePlayerCorpse:{}] Granted 1 Human Skull to Player {:?} (using {} with multiplier {:.1}).",
                        corpse_id, attacker_id, item_def.name, effectiveness_multiplier
                    );
                }
                Err(e) => log::error!(
                    "[DamagePlayerCorpse:{}] Failed to grant Human Skull to Player {:?}: {}",
                    corpse_id, attacker_id, e
                ),
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

        // Scatter collected items around the corpse's location WITHOUT triggering consolidation per-item
        let corpse_pos_x = corpse.pos_x;
        let corpse_pos_y = corpse.pos_y;

        for (item_def_id, quantity) in items_to_drop {
            // Spawn slightly offset from corpse center
            let offset_x = (rng.gen::<f32>() - 0.5) * 2.0 * 30.0; // Spread within +/- 30px
            let offset_y = (rng.gen::<f32>() - 0.5) * 2.0 * 30.0;
            let drop_pos_x = corpse_pos_x + offset_x;
            let drop_pos_y = corpse_pos_y + offset_y;

            match dropped_item::create_dropped_item_entity_no_consolidation(ctx, item_def_id, quantity, drop_pos_x, drop_pos_y) {
                Ok(_) => log::debug!("[DamagePlayerCorpse] Dropped {} of item_def_id {} from depleted corpse {} at ({:.1}, {:.1})", 
                                   quantity, item_def_id, corpse_id, drop_pos_x, drop_pos_y),
                Err(e) => log::error!("[DamagePlayerCorpse] Failed to drop item_def_id {} from corpse {}: {}", item_def_id, corpse_id, e),
            }
        }
        
        // Trigger consolidation ONCE after all items are dropped
        dropped_item::trigger_consolidation_at_position(ctx, corpse_pos_x, corpse_pos_y);

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
    let attacker = ctx.db.player().identity().find(&attacker_id)
        .ok_or_else(|| "Attacker not found".to_string())?;
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
        TargetId::Lantern(lantern_id) => {
            if let Some(lantern) = ctx.db.lantern().id().find(lantern_id) {
                (lantern.pos_x, lantern.pos_y, None)
            } else {
                return Err("Target lantern not found".to_string());
            }
        },
        TargetId::WoodenStorageBox(box_id) => {
            if let Some(storage_box) = ctx.db.wooden_storage_box().id().find(box_id) {
                (storage_box.pos_x, storage_box.pos_y - get_box_collision_y_offset(storage_box.box_type), None)
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
            if let Some(grass_entity) = ctx.db.grass().id().find(grass_id) {
                (grass_entity.pos_x, grass_entity.pos_y, None) // Grass has no associated player
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
        TargetId::RainCollector(rain_collector_id) => {
            if let Some(rain_collector) = ctx.db.rain_collector().id().find(rain_collector_id) {
                (rain_collector.pos_x, rain_collector.pos_y, None)
            } else {
                return Err("Target rain collector not found".to_string());
            }
        },
        TargetId::Furnace(furnace_id) => {
            if let Some(furnace) = ctx.db.furnace().id().find(furnace_id) {
                (furnace.pos_x, furnace.pos_y, None)
            } else {
                return Err("Target furnace not found".to_string());
            }
        },
        TargetId::Barbecue(barbecue_id) => {
            if let Some(barbecue) = ctx.db.barbecue().id().find(barbecue_id) {
                (barbecue.pos_x, barbecue.pos_y, None) // Center-anchored rendering (no Y offset)
            } else {
                return Err("Target barbecue not found".to_string());
            }
        },
        TargetId::WildAnimal(animal_id) => {
            use crate::wild_animal_npc::wild_animal as WildAnimalTableTrait;
            if let Some(animal) = ctx.db.wild_animal().id().find(animal_id) {
                (animal.pos_x, animal.pos_y, None)
            } else {
                return Err("Target wild animal not found".to_string());
            }
        },
        TargetId::AnimalCorpse(animal_corpse_id) => {
            if let Some(animal_corpse) = ctx.db.animal_corpse().id().find(animal_corpse_id) {
                (animal_corpse.pos_x, animal_corpse.pos_y - ANIMAL_CORPSE_COLLISION_Y_OFFSET, None)
            } else {
                return Err("Target animal corpse not found".to_string());
            }
        },
        TargetId::Barrel(barrel_id) => {
            if let Some(barrel) = ctx.db.barrel().id().find(barrel_id) {
                let y_offset = if barrel.variant == crate::barrel::BUOY_VARIANT {
                    crate::barrel::BUOY_COLLISION_Y_OFFSET
                } else if barrel.variant == 4 {
                    BARREL_COLLISION_Y_OFFSET * 2.0
                } else {
                    BARREL_COLLISION_Y_OFFSET
                };
                if let Some(cover) = crate::cover_geometry::profile(barrel.variant) {
                    let (x,y)=cover.nearest_point(barrel.pos_x,barrel.pos_y,attacker.position_x,attacker.position_y);
                    (x,y,None)
                } else { (barrel.pos_x, barrel.pos_y - y_offset, None) }
            } else {
                return Err("Target barrel not found".to_string());
            }
        },
        TargetId::HomesteadHearth(hearth_id) => {
            if let Some(hearth) = ctx.db.homestead_hearth().id().find(hearth_id) {
                (hearth.pos_x, hearth.pos_y - HEARTH_COLLISION_Y_OFFSET, None)
            } else {
                return Err("Target hearth not found".to_string());
            }
        },
        TargetId::Wall(wall_id) => {
            use crate::building::{wall_cell, FOUNDATION_TILE_SIZE_PX};
            if let Some(wall) = ctx.db.wall_cell().id().find(wall_id) {
                // Calculate wall center position (foundation cell center)
                let wall_world_x = (wall.cell_x as f32 * FOUNDATION_TILE_SIZE_PX as f32) + (FOUNDATION_TILE_SIZE_PX as f32 / 2.0);
                let wall_world_y = (wall.cell_y as f32 * FOUNDATION_TILE_SIZE_PX as f32) + (FOUNDATION_TILE_SIZE_PX as f32 / 2.0);
                (wall_world_x, wall_world_y, None)
            } else {
                return Err("Target wall not found".to_string());
            }
        },
        TargetId::Door(door_id) => {
            use crate::building::FOUNDATION_TILE_SIZE_PX;
            if let Some(door) = ctx.db.door().id().find(door_id) {
                // Calculate door center position (foundation cell center)
                let door_world_x = (door.cell_x as f32 * FOUNDATION_TILE_SIZE_PX as f32) + (FOUNDATION_TILE_SIZE_PX as f32 / 2.0);
                let door_world_y = (door.cell_y as f32 * FOUNDATION_TILE_SIZE_PX as f32) + (FOUNDATION_TILE_SIZE_PX as f32 / 2.0);
                (door_world_x, door_world_y, None)
            } else {
                return Err("Target door not found".to_string());
            }
        },
        TargetId::Fence(fence_id) => {
            if let Some(fence) = ctx.db.fence().id().find(fence_id) {
                // Fences are positioned at tile EDGES
                (fence.pos_x, fence.pos_y, None)
            } else {
                return Err("Target fence not found".to_string());
            }
        },
        TargetId::LivingCoral(coral_id) => {
            if let Some(coral) = ctx.db.living_coral().id().find(coral_id) {
                (coral.pos_x, coral.pos_y - LIVING_CORAL_COLLISION_Y_OFFSET, None)
            } else {
                return Err("Target coral not found".to_string());
            }
        },
    };

    // Melee from water cannot connect with targets on dry land (no reach onto shore).
    // Applies to every weapon (torch, harpoon, etc.), wading or snorkeling — not torch-only.
    // Use tile query from position so we don't rely on a possibly stale `is_on_water` cache.
    let attacker_on_water = crate::is_player_on_water(ctx, attacker.position_x, attacker.position_y);
    if attacker_on_water && !is_position_on_water(ctx, target_x, target_y) {
        return Ok(AttackResult {
            hit: false,
            target_type: None,
            resource_granted: None,
        });
    }

    // Check if melee attack hits a wall first (walls block attacks AND take damage)
    // EXCEPTION: If the target itself is a wall, skip this check (handle direct wall damage below)
    let target_is_wall = matches!(target.id, TargetId::Wall(_));
    let target_is_fence = matches!(target.id, TargetId::Fence(_));
    if !target_is_wall && !target_is_fence {
        // Check for wall collision blocking the attack
        if let Some(wall_id) = crate::building::check_line_hits_wall(
            ctx,
            attacker.position_x,
            attacker.position_y,
            target_x,
            target_y,
        ) {
        log::info!(
            "[ProcessAttack] Melee attack from Player {:?} hit Wall {} - damaging wall and blocking attack",
            attacker_id, wall_id
        );
        
        // Check if attacker is using repair hammer - repair instead of damage
        if let Some(active_equip) = ctx.db.active_equipment().player_identity().find(&attacker_id) {
            if let Some(equipped_item_id) = active_equip.equipped_item_instance_id {
                if let Some(equipped_item) = ctx.db.inventory_item().instance_id().find(&equipped_item_id) {
                    if let Some(item_def) = ctx.db.item_definition().id().find(&equipped_item.item_def_id) {
                        if crate::repair::is_repair_hammer(&item_def) {
                            // Use repair instead of damage
                            let (damage, _, _) = calculate_damage_and_yield(&item_def, TargetType::Wall, rng);
                            match crate::repair::repair_wall(ctx, attacker_id, wall_id, damage, timestamp) {
                                Ok(result) => return Ok(result),
                                Err(e) => {
                                    log::error!("[ProcessAttack] Error repairing Wall {}: {}", wall_id, e);
                                    // Fall through to block attack even if repair failed
                                }
                            }
                        }
                    }
                }
            }
        }
        
        // Calculate damage for the wall
        let (damage, _, _) = calculate_damage_and_yield(item_def, TargetType::Wall, rng);
        
        // Apply damage to the wall
        match crate::building::damage_wall(
            ctx,
            attacker_id,
            wall_id,
            damage,
            timestamp,
        ) {
            Ok(_) => {
                log::info!(
                    "[ProcessAttack] Melee attack dealt {:.1} damage to Wall {}",
                    damage, wall_id
                );
            }
            Err(e) => {
                log::error!(
                    "[ProcessAttack] Error applying melee damage to Wall {}: {}",
                    wall_id, e
                );
            }
        }
        
        // Block the attack from hitting targets behind the wall
        return Ok(AttackResult {
            hit: true, // Attack hit something (the wall)
            target_type: Some(TargetType::Wall),
            resource_granted: None,
        });
        }
        
        // Check for fence collision blocking the attack
        if let Some(fence_id) = crate::fence::check_line_hits_fence(
            ctx,
            attacker.position_x,
            attacker.position_y,
            target_x,
            target_y,
        ) {
        log::info!(
            "[ProcessAttack] Melee attack from Player {:?} hit Fence {} - damaging fence and blocking attack",
            attacker_id, fence_id
        );
        
        // Check if attacker is using repair hammer - repair instead of damage
        if let Some(active_equip) = ctx.db.active_equipment().player_identity().find(&attacker_id) {
            if let Some(equipped_item_id) = active_equip.equipped_item_instance_id {
                if let Some(equipped_item) = ctx.db.inventory_item().instance_id().find(&equipped_item_id) {
                    if let Some(item_def) = ctx.db.item_definition().id().find(&equipped_item.item_def_id) {
                        if crate::repair::is_repair_hammer(&item_def) {
                            // Use repair instead of damage
                            let (damage, _, _) = calculate_damage_and_yield(&item_def, TargetType::Wall, rng);
                            match crate::repair::repair_fence(ctx, attacker_id, fence_id, damage, timestamp) {
                                Ok(result) => return Ok(result),
                                Err(e) => {
                                    log::error!("[ProcessAttack] Error repairing Fence {}: {}", fence_id, e);
                                    // Fall through to block attack even if repair failed
                                }
                            }
                        }
                    }
                }
            }
        }
        
        // Calculate damage for the fence
        let (damage, _, _) = calculate_damage_and_yield(item_def, TargetType::Wall, rng);
        
        // Apply damage to the fence
        match crate::fence::damage_fence(
            ctx,
            attacker_id,
            fence_id,
            damage,
            timestamp,
        ) {
            Ok(_) => {
                log::info!(
                    "[ProcessAttack] Melee attack dealt {:.1} damage to Fence {}",
                    damage, fence_id
                );
            }
            Err(e) => {
                log::error!(
                    "[ProcessAttack] Error applying melee damage to Fence {}: {}",
                    fence_id, e
                );
            }
        }
        
        // Block the attack from hitting targets behind the fence
        return Ok(AttackResult {
            hit: true, // Attack hit something (the fence)
            target_type: Some(TargetType::Wall),
            resource_granted: None,
        });
        }
    }
    
    // Check if melee attack is blocked by a closed door
    // EXCEPTION: If the target itself is a door, skip this check (direct door damage)
    let target_is_door = matches!(target.id, TargetId::Door(_));
    if !target_is_door {
        if crate::door::check_line_hits_door(
            ctx,
            attacker.position_x,
            attacker.position_y,
            target_x,
            target_y,
        ).is_some() {
            log::info!(
                "[ProcessAttack] Melee attack from Player {:?} blocked by closed door",
                attacker_id
            );
            // Block the attack - closed doors block attacks
            return Ok(AttackResult {
                hit: false, // Attack blocked by door
                target_type: None,
                resource_granted: None,
            });
        }
    }

    // Check if line of sight is blocked by shelter walls
    // EXCEPTION: If the target itself is a shelter, allow the attack (direct shelter damage)
    let target_is_shelter = matches!(target.id, TargetId::Shelter(_));
    
    log::debug!(
        "[ProcessAttack] Checking line of sight from Player {:?} at ({:.1}, {:.1}) to target {:?} at ({:.1}, {:.1}). Target is shelter: {}",
        attacker_id, attacker.position_x, attacker.position_y, target.id, target_x, target_y, target_is_shelter
    );
    
    let ignored_cover = match target.id { TargetId::Barrel(id) => Some(id), _ => None };
    if let Some(cover) = crate::world_cover::first_blocker(ctx,
        crate::projectile_geometry::Point3{x:attacker.position_x,y:attacker.position_y,height:40.0},
        crate::projectile_geometry::Point3{x:target_x,y:target_y,height:40.0},0.0,ignored_cover) {
        // A preferred player/resource behind cover must not absorb the swing.
        // Resolve against the first barricade using the same reach and damage rules.
        let blocked_target = Target { target_type:TargetType::Barrel,id:TargetId::Barrel(cover.id),distance_sq:target.distance_sq };
        return process_attack(ctx,attacker_id,&blocked_target,item_def,timestamp,rng);
    }
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

    let (mut damage, yield_amount, resource_name) = calculate_damage_and_yield(item_def, target.target_type, rng);

    // HotCombatLadle effect: 2x damage vs wildlife
    if crate::active_effects::player_has_hot_combat_ladle_effect(ctx, attacker_id) {
        if matches!(target.id, TargetId::WildAnimal(_)) {
            damage *= 2.0;
            log::info!("[HotCombatLadle] 2x wildlife damage: {:.1} (attacker {:?})", damage, attacker_id);
        }
    }

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
        TargetId::Lantern(lantern_id) => {
            damage_lantern(ctx, attacker_id, *lantern_id, damage, timestamp, rng)
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
            // Route grass damage through the grass module's damage_grass reducer
            // We call the inner function directly since we're already in a reducer context
            match grass::damage_grass(ctx, *grass_id) {
                Ok(_) => Ok(AttackResult {
                    hit: true,
                    target_type: Some(TargetType::Tree), // Grass uses Tree type
                    resource_granted: None, // Drops handled by damage_grass reducer
                }),
                Err(e) => {
                    log::warn!("Failed to damage grass {}: {}", grass_id, e);
                    Err(e)
                }
            }
        },
        TargetId::Shelter(shelter_id) => {
            crate::shelter::damage_shelter(ctx, attacker_id, *shelter_id, damage, timestamp, rng)
        },
        TargetId::RainCollector(rain_collector_id) => {
            damage_rain_collector(ctx, attacker_id, *rain_collector_id, damage, timestamp, rng)
        },
        TargetId::Furnace(furnace_id) => {
            damage_furnace(ctx, attacker_id, *furnace_id, damage, timestamp, rng)
        },
        TargetId::Barbecue(barbecue_id) => {
            damage_barbecue(ctx, attacker_id, *barbecue_id, damage, timestamp, rng)
        },
        TargetId::WildAnimal(animal_id) => {
            // Use weapon-tracked version for melee kills achievement tracking
            crate::wild_animal_npc::damage_wild_animal_with_weapon(ctx, *animal_id, damage, attacker_id, Some(&item_def.name))
                .map(|_| AttackResult {
                    hit: true,
                    target_type: Some(TargetType::Animal),
                    resource_granted: None,
                })
        },
        TargetId::AnimalCorpse(animal_corpse_id) => {
            damage_animal_corpse(ctx, attacker_id, *animal_corpse_id, damage, item_def, timestamp, rng)
        },
        TargetId::Barrel(barrel_id) => {
            crate::barrel::damage_barrel(ctx, attacker_id, *barrel_id, damage, timestamp, rng)
                .map(|_| AttackResult {
                    hit: true,
                    target_type: Some(TargetType::Barrel),
                    resource_granted: None,
                })
        },
        TargetId::HomesteadHearth(hearth_id) => {
            // Use the damage_hearth helper function (called from combat system)
            crate::homestead_hearth::damage_hearth(ctx, attacker_id, *hearth_id, damage, timestamp)
                .map(|_| AttackResult {
                    hit: true,
                    target_type: Some(TargetType::HomesteadHearth),
                    resource_granted: None,
                })
        },
        TargetId::Wall(wall_id) => {
            // Direct wall attack - check if repair hammer first
            if let Some(active_equip) = ctx.db.active_equipment().player_identity().find(&attacker_id) {
                if let Some(equipped_item_id) = active_equip.equipped_item_instance_id {
                    if let Some(equipped_item) = ctx.db.inventory_item().instance_id().find(&equipped_item_id) {
                        if let Some(item_def) = ctx.db.item_definition().id().find(&equipped_item.item_def_id) {
                            if crate::repair::is_repair_hammer(&item_def) {
                                // Use repair instead of damage
                                return crate::repair::repair_wall(ctx, attacker_id, *wall_id, damage, timestamp);
                            }
                        }
                    }
                }
            }
            
            // Direct wall attack - damage the targeted wall
            crate::building::damage_wall(ctx, attacker_id, *wall_id, damage, timestamp)
                .map(|_| AttackResult {
                    hit: true,
                    target_type: Some(TargetType::Wall),
                    resource_granted: None,
                })
        },
        TargetId::Door(door_id) => {
            // Direct door attack - damage the targeted door
            crate::door::damage_door(ctx, attacker_id, *door_id, damage, timestamp)
                .map(|_| AttackResult {
                    hit: true,
                    target_type: Some(TargetType::Door),
                    resource_granted: None,
                })
        },
        TargetId::Fence(fence_id) => {
            // Direct fence attack - check if repair hammer first
            if let Some(active_equip) = ctx.db.active_equipment().player_identity().find(&attacker_id) {
                if let Some(equipped_item_id) = active_equip.equipped_item_instance_id {
                    if let Some(equipped_item) = ctx.db.inventory_item().instance_id().find(&equipped_item_id) {
                        if let Some(item_def) = ctx.db.item_definition().id().find(&equipped_item.item_def_id) {
                            if crate::repair::is_repair_hammer(&item_def) {
                                // Use repair instead of damage
                                return crate::repair::repair_fence(ctx, attacker_id, *fence_id, damage, timestamp);
                            }
                        }
                    }
                }
            }
            
            // Direct fence attack - damage the targeted fence
            crate::fence::damage_fence(ctx, attacker_id, *fence_id, damage, timestamp)
                .map(|_| AttackResult {
                    hit: true,
                    target_type: Some(TargetType::Wall), // Use Wall target type for consistency
                    resource_granted: None,
                })
        },
        TargetId::LivingCoral(coral_id) => {
            damage_living_coral(ctx, attacker_id, *coral_id, damage, yield_amount, timestamp, rng)
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
        // Skip dead/respawning trees (respawn_at > UNIX_EPOCH when tree is destroyed)
        if tree.health == 0 || tree.respawn_at > Timestamp::UNIX_EPOCH { 
            continue; 
        } 
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
        // Skip dead/respawning stones (respawn_at > UNIX_EPOCH when stone is destroyed)
        if stone.health == 0 || stone.respawn_at > Timestamp::UNIX_EPOCH { 
            continue; 
        }
        let stone_collision_center_y = stone.pos_y - STONE_COLLISION_Y_OFFSET;
        let dx = proposed_x - stone.pos_x;
        let dy = proposed_y - stone_collision_center_y;
        if (dx * dx + dy * dy) < PLAYER_STONE_COLLISION_DISTANCE_SQUARED {
            log::debug!("[KnockbackCollision] Player ID {:?} would collide with Stone ID {} at proposed ({:.1}, {:.1}). Reverting knockback.", 
                       colliding_player_id, stone.id, proposed_x, proposed_y);
            return (current_x, current_y);
        }
    }
    
    // Check against rune stones (AABB collision)
    for rune_stone in ctx.db.rune_stone().iter() {
        let rune_stone_aabb_center_x = rune_stone.pos_x;
        let rune_stone_aabb_center_y = rune_stone.pos_y - RUNE_STONE_COLLISION_Y_OFFSET;
        
        // AABB collision detection
        let closest_x = proposed_x.max(rune_stone_aabb_center_x - RUNE_STONE_AABB_HALF_WIDTH).min(rune_stone_aabb_center_x + RUNE_STONE_AABB_HALF_WIDTH);
        let closest_y = proposed_y.max(rune_stone_aabb_center_y - RUNE_STONE_AABB_HALF_HEIGHT).min(rune_stone_aabb_center_y + RUNE_STONE_AABB_HALF_HEIGHT);
        
        let dx = proposed_x - closest_x;
        let dy = proposed_y - closest_y;
        let dist_sq = dx * dx + dy * dy;
        let player_radius_sq = crate::PLAYER_RADIUS * crate::PLAYER_RADIUS;
        
        if dist_sq < player_radius_sq {
            log::debug!("[KnockbackCollision] Player ID {:?} would collide with RuneStone ID {} at proposed ({:.1}, {:.1}). Reverting knockback.", 
                       colliding_player_id, rune_stone.id, proposed_x, proposed_y);
            return (current_x, current_y);
        }
    }

    // Check against WoodenStorageBoxes (solid collision)
    for box_entity in ctx.db.wooden_storage_box().iter() {
        if box_entity.is_destroyed { continue; }
        let box_collision_center_y = box_entity.pos_y - get_box_collision_y_offset(box_entity.box_type);
        let dx = proposed_x - box_entity.pos_x;
        let dy = proposed_y - box_collision_center_y;
        let box_radius = get_box_player_collision_radius(box_entity.box_type);
        let player_box_collision_dist_sq = (PLAYER_RADIUS + box_radius) * (PLAYER_RADIUS + box_radius);
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

// REMOVED: damage_grass function - grass collision detection removed for performance

/// Applies damage to an animal corpse, yields resources, and handles destruction.
pub fn damage_animal_corpse(
    ctx: &ReducerContext,
    attacker_id: Identity,
    animal_corpse_id: u32,
    damage: f32,
    item_def: &ItemDefinition,
    timestamp: Timestamp,
    rng: &mut impl Rng,
) -> Result<AttackResult, String> {
    let mut animal_corpse_table = ctx.db.animal_corpse();
    let mut animal_corpse = animal_corpse_table.id().find(&animal_corpse_id)
        .ok_or_else(|| format!("Target animal corpse {} disappeared", animal_corpse_id))?;

    // Check if this is an aquatic corpse (shark/jellyfish) that requires underwater harvesting
    let is_aquatic_corpse = matches!(
        animal_corpse.animal_species,
        crate::wild_animal_npc::AnimalSpecies::SalmonShark | 
        crate::wild_animal_npc::AnimalSpecies::Jellyfish
    );
    
    if is_aquatic_corpse {
        // Get player to check if they're snorkeling
        let attacker = ctx.db.player().identity().find(&attacker_id)
            .ok_or_else(|| format!("Could not find attacking player {}", attacker_id))?;
        
        // Aquatic corpses require: player is snorkeling AND using Tidebreaker Blade
        if !attacker.is_snorkeling {
            return Err("You must be underwater (snorkeling) to harvest aquatic creatures.".to_string());
        }
        
        if item_def.name != "Tidebreaker Blade" {
            return Err("You need a Tidebreaker Blade to harvest aquatic creatures underwater.".to_string());
        }
    }

    if animal_corpse.health == 0 {
        // Still update last_hit_time for visual feedback before deletion
        animal_corpse.last_hit_time = Some(timestamp);
        animal_corpse_table.id().update(animal_corpse);
        log::warn!("[DamageAnimalCorpse] Animal corpse {} already has 0 health. No action taken.", animal_corpse_id);
        return Ok(AttackResult { hit: false, target_type: Some(TargetType::AnimalCorpse), resource_granted: None });
    }

    let old_health = animal_corpse.health;
    animal_corpse.health = animal_corpse.health.saturating_sub(damage as u32);
    // Always update last_hit_time on every hit for shake effect
    animal_corpse.last_hit_time = Some(timestamp);
    animal_corpse.last_hit_by = Some(attacker_id);

    log::info!(
        "Player {:?} hit AnimalCorpse {} for {:.1} damage. Health: {} -> {}",
        attacker_id, animal_corpse_id, damage, old_health, animal_corpse.health
    );

    // Play weapon-specific hit sounds
    play_weapon_hit_sound(ctx, item_def, animal_corpse.pos_x, animal_corpse.pos_y, attacker_id);

    // Ranged weapons cannot harvest resources from corpses - they can only deal damage
    if item_def.category == ItemCategory::RangedWeapon {
        log::info!(
            "[DamageAnimalCorpse] Ranged weapon '{}' cannot harvest resources - only dealing damage",
            item_def.name
        );
        
        // Update corpse health and return without granting resources
        if animal_corpse.health == 0 {
            // Corpse depleted - delete it
            animal_corpse_table.id().delete(&animal_corpse_id);
            log::info!("[DamageAnimalCorpse] AnimalCorpse {} entity deleted after being depleted by ranged weapon.", animal_corpse_id);
        } else {
            // Corpse still has health, just update it
            animal_corpse_table.id().update(animal_corpse);
        }
        
        return Ok(AttackResult {
            hit: true,
            target_type: Some(TargetType::AnimalCorpse),
            resource_granted: None,
        });
    }

    let mut resources_granted: Vec<(String, u32)> = Vec::new();

    // Get animal-specific loot chances
    let (base_fat_chance, base_cloth_chance, base_bone_chance, base_meat_chance) = 
        crate::wild_animal_npc::animal_corpse::get_animal_loot_chances(animal_corpse.animal_species);

    // Determine tool effectiveness
    const BONE_KNIFE_MULTIPLIER: f64 = 8.0;
    const BONE_CLUB_MULTIPLIER: f64 = 3.0;
    const MACHETE_MULTIPLIER: f64 = 7.0; // High effectiveness for sharp cutting tool
    const AK74_BAYONET_MULTIPLIER: f64 = 10.0; // Highest effectiveness for modern military bayonet
    const TIDEBREAKER_BLADE_MULTIPLIER: f64 = 9.0; // High effectiveness for underwater harvesting
    const PRIMARY_CORPSE_TOOL_MULTIPLIER: f64 = 1.0;
    const NON_PRIMARY_ITEM_MULTIPLIER: f64 = 0.4; // Increased from 0.1 to 0.4 - allows new players to harvest basic resources

    let effectiveness_multiplier = match item_def.name.as_str() {
        "AK74 Bayonet" => AK74_BAYONET_MULTIPLIER,
        "Bone Knife" => BONE_KNIFE_MULTIPLIER,
        "Bone Club" => BONE_CLUB_MULTIPLIER,
        "Bush Knife" => MACHETE_MULTIPLIER,
        "Tidebreaker Blade" => TIDEBREAKER_BLADE_MULTIPLIER,
        _ => {
            if item_def.primary_target_type == Some(TargetType::AnimalCorpse) {
                PRIMARY_CORPSE_TOOL_MULTIPLIER
            } else {
                NON_PRIMARY_ITEM_MULTIPLIER
            }
        }
    };

    // Calculate actual chances based on tool effectiveness
    // For non-primary tools, ensure minimum 10% chance for basic resources (fat, bone, meat, leather)
    const MIN_BASIC_RESOURCE_CHANCE: f64 = 0.10; // 10% minimum chance for basic resources
    let is_non_primary_tool = effectiveness_multiplier == NON_PRIMARY_ITEM_MULTIPLIER;
    
    let mut actual_fat_chance = (base_fat_chance * effectiveness_multiplier).clamp(0.0, base_fat_chance);
    let mut actual_cloth_chance = (base_cloth_chance * effectiveness_multiplier).clamp(0.0, base_cloth_chance);
    let mut actual_bone_chance = (base_bone_chance * effectiveness_multiplier).clamp(0.0, base_bone_chance);
    let mut actual_meat_chance = (base_meat_chance * effectiveness_multiplier).clamp(0.0, base_meat_chance);
    
    // Apply minimum floor for basic resources when using non-primary tools
    if is_non_primary_tool {
        actual_fat_chance = actual_fat_chance.max(MIN_BASIC_RESOURCE_CHANCE);
        actual_bone_chance = actual_bone_chance.max(MIN_BASIC_RESOURCE_CHANCE);
        actual_meat_chance = actual_meat_chance.max(MIN_BASIC_RESOURCE_CHANCE);
        // Cloth/leather don't get minimum floor as they're more specialized
    }

    // Determine quantity based on tool
    let quantity_per_hit = match item_def.name.as_str() {
        "AK74 Bayonet" => rng.gen_range(4..=7), // Highest yield for modern military bayonet
        "Bone Knife" => rng.gen_range(3..=5),
        "Bone Club" => rng.gen_range(2..=4),
        "Bush Knife" => rng.gen_range(1..=3),
        "Tidebreaker Blade" => rng.gen_range(3..=6), // Good yield for underwater harvesting
        _ => {
            if item_def.primary_target_type == Some(TargetType::AnimalCorpse) && item_def.category == ItemCategory::Tool {
                rng.gen_range(1..=2)
            } else if item_def.category == ItemCategory::Tool {
                1
            } else {
                1
            }
        }
    };

    // Get caribou age-based drop multipliers if this is a caribou
    let (caribou_meat_mult, caribou_fat_mult, caribou_bone_mult) = 
        if animal_corpse.animal_species == crate::wild_animal_npc::AnimalSpecies::Caribou {
            // Look up caribou breeding data for age-based drops
            let age_stage = crate::wild_animal_npc::get_caribou_age_stage(ctx, animal_corpse.animal_id);
            let (meat, fat, bone) = crate::wild_animal_npc::get_caribou_drop_multipliers(age_stage);
            log::debug!("[DamageAnimalCorpse:{}] Caribou age: {:?}, multipliers: meat={:.2}, fat={:.2}, bone={:.2}", 
                       animal_corpse_id, age_stage, meat, fat, bone);
            (meat, fat, bone)
        } else {
            (1.0, 1.0, 1.0) // Non-caribou get full drops
        };

    let corpse_yield_mult = corpse_harvest_yield_multiplier(item_def);
    
    // Grant resources based on RNG and animal type
    // Apply logarithmic bonus based on time alive
    // Note: Crabs don't drop Animal Fat - they have exoskeletons, not fat reserves
    if animal_corpse.health > 0 
        && animal_corpse.animal_species != crate::wild_animal_npc::AnimalSpecies::BeachCrab
        && rng.gen_bool(actual_fat_chance) 
    {
        let base_fat = quantity_per_hit;
        let time_alive_bonus = calculate_fat_bonus_from_time_alive(animal_corpse.spawned_at, animal_corpse.death_time);
        // Apply caribou age multiplier for fat, then corpse-tool harvest bonus (skulls/trophies excluded elsewhere)
        let mut total_fat = ((base_fat + time_alive_bonus) as f32 * caribou_fat_mult).round() as u32;
        if total_fat > 0 {
            total_fat = total_fat.saturating_mul(corpse_yield_mult);
        }
        
        if total_fat > 0 {
            log::debug!(
                "[DamageAnimalCorpse:{}] Time alive bonus: {} (base: {}, total: {})",
                animal_corpse_id, time_alive_bonus, base_fat, total_fat
            );
            
            match grant_resource(ctx, attacker_id, "Animal Fat", total_fat) {
                Ok(_) => resources_granted.push(("Animal Fat".to_string(), total_fat)),
                Err(e) => log::error!("Failed to grant Animal Fat: {}", e),
            }
        }
    }

    if animal_corpse.health > 0 && rng.gen_bool(actual_cloth_chance) {
        let cloth_type = match animal_corpse.animal_species {
            crate::wild_animal_npc::AnimalSpecies::CinderFox => Some("Fox Fur"),
            crate::wild_animal_npc::AnimalSpecies::TundraWolf => Some("Wolf Fur"),
            crate::wild_animal_npc::AnimalSpecies::CableViper => Some("Viper Scale"),
            crate::wild_animal_npc::AnimalSpecies::ArcticWalrus => None, // Walrus doesn't drop cloth-type resources
            crate::wild_animal_npc::AnimalSpecies::BeachCrab => None, // Crabs don't drop fur/cloth - they have shells
            crate::wild_animal_npc::AnimalSpecies::Tern => Some("Tern Feathers"), // Terns drop feathers
            crate::wild_animal_npc::AnimalSpecies::Crow => Some("Crow Feathers"), // Crows drop feathers
            crate::wild_animal_npc::AnimalSpecies::Vole => None, // Voles are too small for usable fur
            crate::wild_animal_npc::AnimalSpecies::Wolverine => None, // Wolverines drop Animal Hide instead
            crate::wild_animal_npc::AnimalSpecies::Caribou => None, // Caribou drop warm hides
            // SalmonShark - no cloth (sharks have skin, not fur)
            crate::wild_animal_npc::AnimalSpecies::SalmonShark => None,
            // Jellyfish - drops jellyfish membrane
            crate::wild_animal_npc::AnimalSpecies::Jellyfish => Some("Jellyfish Membrane"),
            // Night hostile NPCs don't drop items - they grant memory shards instead
            crate::wild_animal_npc::AnimalSpecies::Shorebound | 
            crate::wild_animal_npc::AnimalSpecies::Shardkin | 
            crate::wild_animal_npc::AnimalSpecies::DrownedWatch => None,
            // Bees don't drop cloth - they're tiny insects
            crate::wild_animal_npc::AnimalSpecies::Bee => None,
            // Alpine animals - no special cloth/fur per user request
            crate::wild_animal_npc::AnimalSpecies::PolarBear => None,
            crate::wild_animal_npc::AnimalSpecies::Hare => None,
            crate::wild_animal_npc::AnimalSpecies::SnowyOwl => None,
        };
        
        if let Some(cloth_name) = cloth_type {
            let q = quantity_per_hit.saturating_mul(corpse_yield_mult);
            match grant_resource(ctx, attacker_id, cloth_name, q) {
                Ok(_) => resources_granted.push((cloth_name.to_string(), q)),
                Err(e) => log::error!("Failed to grant {}: {}", cloth_name, e),
            }
        }
    }

    // Universal Animal Hide (crabs, birds, voles, bees too small — matches corpse loot table)
    let mut animal_hide_chance = (0.40 * effectiveness_multiplier).clamp(0.0, 0.40);
    if animal_corpse.animal_species == crate::wild_animal_npc::AnimalSpecies::Wolverine {
        animal_hide_chance = (0.70 * effectiveness_multiplier).clamp(0.0, 0.70);
    }
    if is_non_primary_tool {
        animal_hide_chance = animal_hide_chance.max(MIN_BASIC_RESOURCE_CHANCE);
    }
    let hide_eligible = !matches!(
        animal_corpse.animal_species,
        crate::wild_animal_npc::AnimalSpecies::BeachCrab
            | crate::wild_animal_npc::AnimalSpecies::Tern
            | crate::wild_animal_npc::AnimalSpecies::Crow
            | crate::wild_animal_npc::AnimalSpecies::Vole
            | crate::wild_animal_npc::AnimalSpecies::Bee
    );
    if animal_corpse.health > 0 && hide_eligible && rng.gen_bool(animal_hide_chance) {
        let q = quantity_per_hit.saturating_mul(corpse_yield_mult);
        match grant_resource(ctx, attacker_id, "Animal Hide", q) {
            Ok(_) => resources_granted.push(("Animal Hide".to_string(), q)),
            Err(e) => log::error!("Failed to grant Animal Hide: {}", e),
        }
    }

    // Note: Crabs don't drop Animal Bone - they have exoskeletons, not internal bones
    if animal_corpse.health > 0 
        && animal_corpse.animal_species != crate::wild_animal_npc::AnimalSpecies::BeachCrab
        && rng.gen_bool(actual_bone_chance) 
    {
        // Apply caribou age multiplier for bones, then corpse-tool harvest bonus
        let mut bone_quantity = (quantity_per_hit as f32 * caribou_bone_mult).round() as u32;
        if bone_quantity > 0 {
            bone_quantity = bone_quantity.saturating_mul(corpse_yield_mult);
        }
        if bone_quantity > 0 {
            match grant_resource(ctx, attacker_id, "Animal Bone", bone_quantity) {
                Ok(_) => resources_granted.push(("Animal Bone".to_string(), bone_quantity)),
                Err(e) => log::error!("Failed to grant Animal Bone: {}", e),
            }
        }
    }

    if animal_corpse.health > 0 && rng.gen_bool(actual_meat_chance) {
        let meat_type: Option<&str> = match animal_corpse.animal_species {
            crate::wild_animal_npc::AnimalSpecies::CinderFox => Some("Raw Fox Meat"),
            crate::wild_animal_npc::AnimalSpecies::TundraWolf => Some("Raw Wolf Meat"),
            crate::wild_animal_npc::AnimalSpecies::CableViper => Some("Raw Viper Meat"),
            crate::wild_animal_npc::AnimalSpecies::ArcticWalrus => Some("Raw Walrus Meat"),
            crate::wild_animal_npc::AnimalSpecies::BeachCrab => Some("Raw Crab Meat"),
            crate::wild_animal_npc::AnimalSpecies::Tern => Some("Raw Tern Meat"),
            crate::wild_animal_npc::AnimalSpecies::Crow => Some("Raw Crow Meat"),
            crate::wild_animal_npc::AnimalSpecies::Vole => Some("Raw Vole Meat"),
            crate::wild_animal_npc::AnimalSpecies::Wolverine => Some("Raw Wolverine Meat"),
            crate::wild_animal_npc::AnimalSpecies::Caribou => Some("Raw Caribou Meat"),
            // SalmonShark - drops shark meat
            crate::wild_animal_npc::AnimalSpecies::SalmonShark => Some("Raw Shark Meat"),
            // Jellyfish - drops jellyfish gel instead of meat
            crate::wild_animal_npc::AnimalSpecies::Jellyfish => Some("Jellyfish Gel"),
            // Night hostile NPCs don't drop items
            crate::wild_animal_npc::AnimalSpecies::Shorebound | 
            crate::wild_animal_npc::AnimalSpecies::Shardkin | 
            crate::wild_animal_npc::AnimalSpecies::DrownedWatch => None,
            // Bees don't drop meat - they're tiny insects
            crate::wild_animal_npc::AnimalSpecies::Bee => None,
            // Alpine animals
            crate::wild_animal_npc::AnimalSpecies::PolarBear => Some("Raw Bear Meat"),
            crate::wild_animal_npc::AnimalSpecies::Hare => Some("Raw Hare Meat"),
            crate::wild_animal_npc::AnimalSpecies::SnowyOwl => Some("Raw Owl Meat"),
        };
        if let Some(meat_name) = meat_type {
            // Apply caribou age multiplier for meat, then corpse-tool harvest bonus
            let mut meat_quantity = (quantity_per_hit as f32 * caribou_meat_mult).round() as u32;
            if meat_quantity > 0 {
                meat_quantity = meat_quantity.saturating_mul(corpse_yield_mult);
            }
            if meat_quantity > 0 {
                match grant_resource(ctx, attacker_id, meat_name, meat_quantity) {
                    Ok(_) => resources_granted.push((meat_name.to_string(), meat_quantity)),
                    Err(e) => log::error!("Failed to grant {}: {}", meat_name, e),
                }
            }
        }
    }

    if animal_corpse.health == 0 {
        log::info!("[DamageAnimalCorpse:{}] Animal corpse depleted by Player {:?} using item {} (category {:?}, multiplier {:.1})", 
                 animal_corpse_id, attacker_id, item_def.name, item_def.category, effectiveness_multiplier);
        
        // Grant 1 skull when corpse is depleted, regardless of tool used (like player corpses)
        // Note: Crabs and birds don't drop skulls
        let skull_type: Option<&str> = match animal_corpse.animal_species {
            crate::wild_animal_npc::AnimalSpecies::CinderFox => Some("Fox Skull"),
            crate::wild_animal_npc::AnimalSpecies::TundraWolf => Some("Wolf Skull"),
            crate::wild_animal_npc::AnimalSpecies::CableViper => Some("Viper Skull"),
            crate::wild_animal_npc::AnimalSpecies::ArcticWalrus => Some("Walrus Skull"), // Large, imposing skull with tusks
            crate::wild_animal_npc::AnimalSpecies::BeachCrab => None, // Crabs don't have skulls - they have exoskeletons
            crate::wild_animal_npc::AnimalSpecies::Tern => Some("Tern Skull"), // Seabird skull trophy
            crate::wild_animal_npc::AnimalSpecies::Crow => Some("Crow Skull"), // Clever scavenger skull trophy
            crate::wild_animal_npc::AnimalSpecies::Vole => Some("Vole Skull"), // Tiny novelty trophy skull
            crate::wild_animal_npc::AnimalSpecies::Wolverine => Some("Wolverine Skull"), // Fierce predator skull
            crate::wild_animal_npc::AnimalSpecies::Caribou => Some("Caribou Skull"), // Large herbivore skull
            // SalmonShark - drops shark skull (cartilage but still a trophy)
            crate::wild_animal_npc::AnimalSpecies::SalmonShark => Some("Shark Skull"),
            // Jellyfish - no skull (invertebrate)
            crate::wild_animal_npc::AnimalSpecies::Jellyfish => None,
            // Night hostile NPCs don't drop items
            crate::wild_animal_npc::AnimalSpecies::Shorebound | 
            crate::wild_animal_npc::AnimalSpecies::Shardkin | 
            crate::wild_animal_npc::AnimalSpecies::DrownedWatch => None,
            // Bees don't drop skulls - they're tiny insects
            crate::wild_animal_npc::AnimalSpecies::Bee => None,
            // Alpine animals
            crate::wild_animal_npc::AnimalSpecies::PolarBear => Some("Polar Bear Skull"), // Massive apex predator skull
            crate::wild_animal_npc::AnimalSpecies::Hare => Some("Hare Skull"), // Small prey skull
            crate::wild_animal_npc::AnimalSpecies::SnowyOwl => Some("Owl Skull"), // Flying predator skull
        };
        
        if let Some(skull_name) = skull_type {
            match grant_resource(ctx, attacker_id, skull_name, 1) {
                Ok(_) => {
                    resources_granted.push((skull_name.to_string(), 1));
                    log::info!(
                        "[DamageAnimalCorpse:{}] Granted 1 {} to Player {:?} (corpse depleted).",
                        animal_corpse_id, skull_name, attacker_id
                    );
                }
                Err(e) => log::error!(
                    "[DamageAnimalCorpse:{}] Failed to grant {} to Player {:?}: {}",
                    animal_corpse_id, skull_name, attacker_id, e
                ),
            }
        }
        
        // GUARANTEED: Cable Viper Gland drop for Cable Vipers (100% chance when corpse depleted)
        if animal_corpse.animal_species == crate::wild_animal_npc::AnimalSpecies::CableViper {
            match grant_resource(ctx, attacker_id, "Cable Viper Gland", 1) {
                Ok(_) => {
                    resources_granted.push(("Cable Viper Gland".to_string(), 1));
                    log::info!(
                        "[DamageAnimalCorpse:{}] Granted 1 Cable Viper Gland to Player {:?} (guaranteed viper drop).",
                        animal_corpse_id, attacker_id
                    );
                }
                Err(e) => log::error!(
                    "[DamageAnimalCorpse:{}] Failed to grant Cable Viper Gland to Player {:?}: {}",
                    animal_corpse_id, attacker_id, e
                ),
            }
        }
        
        // GUARANTEED: Shark Fin drop for SalmonShark (100% chance when corpse depleted with Tidebreaker Blade)
        if animal_corpse.animal_species == crate::wild_animal_npc::AnimalSpecies::SalmonShark {
            match grant_resource(ctx, attacker_id, "Shark Fin", 1) {
                Ok(_) => {
                    resources_granted.push(("Shark Fin".to_string(), 1));
                    log::info!(
                        "[DamageAnimalCorpse:{}] Granted 1 Shark Fin to Player {:?} (guaranteed shark drop).",
                        animal_corpse_id, attacker_id
                    );
                }
                Err(e) => log::error!(
                    "[DamageAnimalCorpse:{}] Failed to grant Shark Fin to Player {:?}: {}",
                    animal_corpse_id, attacker_id, e
                ),
            }
        }
        
        // GUARANTEED: Jellyfish Stinger drop for Jellyfish (100% chance when corpse depleted with Tidebreaker Blade)
        if animal_corpse.animal_species == crate::wild_animal_npc::AnimalSpecies::Jellyfish {
            match grant_resource(ctx, attacker_id, "Jellyfish Stinger", 1) {
                Ok(_) => {
                    resources_granted.push(("Jellyfish Stinger".to_string(), 1));
                    log::info!(
                        "[DamageAnimalCorpse:{}] Granted 1 Jellyfish Stinger to Player {:?} (guaranteed jellyfish drop).",
                        animal_corpse_id, attacker_id
                    );
                }
                Err(e) => log::error!(
                    "[DamageAnimalCorpse:{}] Failed to grant Jellyfish Stinger to Player {:?}: {}",
                    animal_corpse_id, attacker_id, e
                ),
            }
        }
        
        // Clean up caribou breeding data if this was a caribou (kept until corpse depleted for age-based drops)
        if animal_corpse.animal_species == crate::wild_animal_npc::AnimalSpecies::Caribou {
            crate::wild_animal_npc::cleanup_caribou_breeding_data(ctx, animal_corpse.animal_id);
        }
        
        // Clean up walrus breeding data if this was a walrus (kept until corpse depleted for age-based drops)
        if animal_corpse.animal_species == crate::wild_animal_npc::AnimalSpecies::ArcticWalrus {
            crate::wild_animal_npc::cleanup_walrus_breeding_data(ctx, animal_corpse.animal_id);
        }
        
        // Delete the corpse entity
        animal_corpse_table.id().delete(&animal_corpse_id);
        log::info!("[DamageAnimalCorpse] AnimalCorpse {} entity deleted after being depleted.", animal_corpse_id);
    } else {
        // Corpse still has health, just update it
        animal_corpse_table.id().update(animal_corpse);
    }

    // Return first resource granted or empty result
    let granted_summary = resources_granted.first().cloned();

    Ok(AttackResult {
        hit: true,
        target_type: Some(TargetType::AnimalCorpse),
        resource_granted: granted_summary,
    })
}

/// Applies damage to a rain collector and handles destruction/item scattering
pub fn damage_rain_collector(
    ctx: &ReducerContext,
    attacker_id: Identity,
    rain_collector_id: u32,
    damage: f32,
    timestamp: Timestamp,
    rng: &mut impl Rng
) -> Result<AttackResult, String> {
    // Check if the attacker is using a repair hammer
    if let Some(active_equip) = ctx.db.active_equipment().player_identity().find(&attacker_id) {
        if let Some(equipped_item_id) = active_equip.equipped_item_instance_id {
            if let Some(equipped_item) = ctx.db.inventory_item().instance_id().find(&equipped_item_id) {
                if let Some(item_def) = ctx.db.item_definition().id().find(&equipped_item.item_def_id) {
                    if crate::repair::is_repair_hammer(&item_def) {
                        // Use repair instead of damage
                        return crate::repair::repair_rain_collector(ctx, attacker_id, rain_collector_id, damage, timestamp);
                    }
                }
            }
        }
    }

    // Original damage logic if not using repair hammer
    let mut rain_collectors_table = ctx.db.rain_collector();
    let mut rain_collector = rain_collectors_table.id().find(&rain_collector_id)
        .ok_or_else(|| format!("Target rain collector {} disappeared", rain_collector_id))?;

    // Monument placeables are indestructible
    if rain_collector.is_monument {
        return Err("Cannot damage monument structures.".to_string());
    }

    if rain_collector.is_destroyed {
        return Ok(AttackResult { hit: false, target_type: Some(TargetType::RainCollector), resource_granted: None });
    }

    // <<< PVP RAIDING CHECK >>>
    if let Some(attacker_player) = ctx.db.player().identity().find(attacker_id) {
        let attacker_pvp = is_pvp_active_for_player(&attacker_player, timestamp);
        
        if rain_collector.placed_by != attacker_id {
            if let Some(owner_player) = ctx.db.player().identity().find(&rain_collector.placed_by) {
                let owner_pvp = is_pvp_active_for_player(&owner_player, timestamp);
                
                if !attacker_pvp || !owner_pvp {
                    log::debug!("Structure raiding blocked - Attacker PvP: {}, Owner PvP: {}", 
                        attacker_pvp, owner_pvp);
                    return Ok(AttackResult { hit: false, target_type: Some(TargetType::RainCollector), resource_granted: None });
                }
            }
        }
    }
    // <<< END PVP RAIDING CHECK >>>

    let old_health = rain_collector.health;
    rain_collector.health = (rain_collector.health - damage).max(0.0);
    rain_collector.last_hit_time = Some(timestamp);
    rain_collector.last_damaged_by = Some(attacker_id);

    log::info!(
        "Player {:?} hit RainCollector {} for {:.1} damage. Health: {:.1} -> {:.1}",
        attacker_id, rain_collector_id, damage, old_health, rain_collector.health
    );

    // Play hit sound for all hits
    sound_events::emit_barrel_hit_sound(ctx, rain_collector.pos_x, rain_collector.pos_y, attacker_id);

    if rain_collector.health <= 0.0 {
        // Play destroyed sound
        sound_events::emit_barrel_destroyed_sound(ctx, rain_collector.pos_x, rain_collector.pos_y, attacker_id);
        rain_collector.is_destroyed = true;
        rain_collector.destroyed_at = Some(timestamp);

        let mut items_to_drop: Vec<(u64, u32)> = Vec::new();
        // Check the single slot for water container
        if let (Some(instance_id), Some(def_id)) = (rain_collector.slot_0_instance_id, rain_collector.slot_0_def_id) {
            if let Some(item) = ctx.db.inventory_item().instance_id().find(&instance_id) {
                items_to_drop.push((def_id, item.quantity));
                ctx.db.inventory_item().instance_id().delete(&instance_id);
            }
            rain_collector.slot_0_instance_id = None;
            rain_collector.slot_0_def_id = None;
        }
        
        // Update the rain collector one last time to ensure is_destroyed and destroyed_at are sent to client
        rain_collectors_table.id().update(rain_collector.clone());
        // Then immediately delete the rain collector entity itself
        rain_collectors_table.id().delete(&rain_collector_id);

        log::info!(
            "RainCollector {} destroyed by player {:?}. Dropping contents.",
            rain_collector_id, attacker_id
        );

        // Drop all items WITHOUT triggering consolidation on each drop
        for (item_def_id, quantity) in items_to_drop {
            let offset_x = (rng.gen::<f32>() - 0.5) * 2.0 * 20.0; // Spread within +/- 20px
            let offset_y = (rng.gen::<f32>() - 0.5) * 2.0 * 20.0;
            let drop_pos_x = rain_collector.pos_x + offset_x;
            let drop_pos_y = rain_collector.pos_y + offset_y;

            match dropped_item::create_dropped_item_entity_no_consolidation(ctx, item_def_id, quantity, drop_pos_x, drop_pos_y) {
                Ok(_) => log::debug!("Dropped {} of item_def_id {} from destroyed rain collector {}", quantity, item_def_id, rain_collector_id),
                Err(e) => log::error!("Failed to drop item_def_id {}: {}", item_def_id, e),
            }
        }
        
        // Trigger consolidation ONCE after all items are dropped
        dropped_item::trigger_consolidation_at_position(ctx, rain_collector.pos_x, rain_collector.pos_y);

    } else {
        // Rain collector still has health, just update it
        rain_collectors_table.id().update(rain_collector);
    }

    Ok(AttackResult {
        hit: true,
        target_type: Some(TargetType::RainCollector),
        resource_granted: None,
    })
}

/// Applies damage to a furnace and handles destruction/item scattering
pub fn damage_furnace(
    ctx: &ReducerContext,
    attacker_id: Identity,
    furnace_id: u32,
    damage: f32,
    timestamp: Timestamp,
    rng: &mut impl Rng
) -> Result<AttackResult, String> {
    // Check if the attacker is using a repair hammer
    if let Some(active_equip) = ctx.db.active_equipment().player_identity().find(&attacker_id) {
        if let Some(equipped_item_id) = active_equip.equipped_item_instance_id {
            if let Some(equipped_item) = ctx.db.inventory_item().instance_id().find(&equipped_item_id) {
                if let Some(item_def) = ctx.db.item_definition().id().find(&equipped_item.item_def_id) {
                    if crate::repair::is_repair_hammer(&item_def) {
                        // Use repair instead of damage
                        return crate::repair::repair_furnace(ctx, attacker_id, furnace_id, damage, timestamp);
                    }
                }
            }
        }
    }

    // Original damage logic if not using repair hammer
    let mut furnaces_table = ctx.db.furnace();
    let mut furnace = furnaces_table.id().find(&furnace_id)
        .ok_or_else(|| format!("Target furnace {} disappeared", furnace_id))?;

    // Monument placeables are indestructible
    if furnace.is_monument {
        return Err("Cannot damage monument structures.".to_string());
    }

    if furnace.is_destroyed {
        return Ok(AttackResult { hit: false, target_type: Some(TargetType::Furnace), resource_granted: None });
    }

    // <<< PVP RAIDING CHECK >>>
    if let Some(attacker_player) = ctx.db.player().identity().find(attacker_id) {
        let attacker_pvp = is_pvp_active_for_player(&attacker_player, timestamp);
        
        if furnace.placed_by != attacker_id {
            if let Some(owner_player) = ctx.db.player().identity().find(&furnace.placed_by) {
                let owner_pvp = is_pvp_active_for_player(&owner_player, timestamp);
                
                if !attacker_pvp || !owner_pvp {
                    log::debug!("Structure raiding blocked - Attacker PvP: {}, Owner PvP: {}", 
                        attacker_pvp, owner_pvp);
                    return Ok(AttackResult { hit: false, target_type: Some(TargetType::Furnace), resource_granted: None });
                }
            }
        }
    }
    // <<< END PVP RAIDING CHECK >>>

    let old_health = furnace.health;
    furnace.health = (furnace.health - damage).max(0.0);
    furnace.last_hit_time = Some(timestamp);
    furnace.last_damaged_by = Some(attacker_id);

    log::info!(
        "Player {:?} hit Furnace {} for {:.1} damage. Health: {:.1} -> {:.1}",
        attacker_id, furnace_id, damage, old_health, furnace.health
    );

    // Play hit sound for all hits (using barrel sounds for now)
    sound_events::emit_barrel_hit_sound(ctx, furnace.pos_x, furnace.pos_y, attacker_id);

    if furnace.health <= 0.0 {
        // Play destroyed sound
        sound_events::emit_barrel_destroyed_sound(ctx, furnace.pos_x, furnace.pos_y, attacker_id);
        furnace.is_destroyed = true;
        furnace.destroyed_at = Some(timestamp);

        let mut items_to_drop: Vec<(u64, u32)> = Vec::new();
        // Check all 5 slots for items to drop
        let slots = [
            (furnace.slot_instance_id_0, furnace.slot_def_id_0),
            (furnace.slot_instance_id_1, furnace.slot_def_id_1),
            (furnace.slot_instance_id_2, furnace.slot_def_id_2),
            (furnace.slot_instance_id_3, furnace.slot_def_id_3),
            (furnace.slot_instance_id_4, furnace.slot_def_id_4),
        ];

        for (instance_id_opt, def_id_opt) in slots {
            if let (Some(instance_id), Some(def_id)) = (instance_id_opt, def_id_opt) {
                if let Some(item) = ctx.db.inventory_item().instance_id().find(&instance_id) {
                    items_to_drop.push((def_id, item.quantity));
                    ctx.db.inventory_item().instance_id().delete(&instance_id);
                }
            }
        }

        // Clear all slots
        furnace.slot_instance_id_0 = None;
        furnace.slot_def_id_0 = None;
        furnace.slot_instance_id_1 = None;
        furnace.slot_def_id_1 = None;
        furnace.slot_instance_id_2 = None;
        furnace.slot_def_id_2 = None;
        furnace.slot_instance_id_3 = None;
        furnace.slot_def_id_3 = None;
        furnace.slot_instance_id_4 = None;
        furnace.slot_def_id_4 = None;
        
        // Update the furnace one last time to ensure is_destroyed and destroyed_at are sent to client
        furnaces_table.id().update(furnace.clone());
        // Then immediately delete the furnace entity itself
        furnaces_table.id().delete(&furnace_id);

        log::info!(
            "Furnace {} destroyed by player {:?}. Dropping contents.",
            furnace_id, attacker_id
        );

        // Drop all items WITHOUT triggering consolidation on each drop
        for (item_def_id, quantity) in items_to_drop {
            let offset_x = (rng.gen::<f32>() - 0.5) * 2.0 * 20.0; // Spread within +/- 20px
            let offset_y = (rng.gen::<f32>() - 0.5) * 2.0 * 20.0;
            let drop_pos_x = furnace.pos_x + offset_x;
            let drop_pos_y = furnace.pos_y + offset_y;

            match dropped_item::create_dropped_item_entity_no_consolidation(ctx, item_def_id, quantity, drop_pos_x, drop_pos_y) {
                Ok(_) => log::debug!("Dropped {} of item_def_id {} from destroyed furnace {}", quantity, item_def_id, furnace_id),
                Err(e) => log::error!("Failed to drop item_def_id {}: {}", item_def_id, e),
            }
        }
        
        // Trigger consolidation ONCE after all items are dropped
        dropped_item::trigger_consolidation_at_position(ctx, furnace.pos_x, furnace.pos_y);

    } else {
        // Furnace still has health, just update it
        furnaces_table.id().update(furnace);
    }

    Ok(AttackResult {
        hit: true,
        target_type: Some(TargetType::Furnace),
        resource_granted: None,
    })
}

/// Applies damage to a barbecue and handles destruction/item scattering
pub fn damage_barbecue(
    ctx: &ReducerContext,
    attacker_id: Identity,
    barbecue_id: u32,
    damage: f32,
    timestamp: Timestamp,
    rng: &mut impl Rng
) -> Result<AttackResult, String> {
    // TODO: Add repair hammer support for barbecues
    // Check if the attacker is using a repair hammer
    // if let Some(active_equip) = ctx.db.active_equipment().player_identity().find(&attacker_id) {
    //     if let Some(equipped_item_id) = active_equip.equipped_item_instance_id {
    //         if let Some(equipped_item) = ctx.db.inventory_item().instance_id().find(&equipped_item_id) {
    //             if let Some(item_def) = ctx.db.item_definition().id().find(&equipped_item.item_def_id) {
    //                 if crate::repair::is_repair_hammer(&item_def) {
    //                     // Use repair instead of damage
    //                     return crate::repair::repair_barbecue(ctx, attacker_id, barbecue_id, damage, timestamp);
    //                 }
    //             }
    //         }
    //     }
    // }

    // Original damage logic if not using repair hammer
    let mut barbecues_table = ctx.db.barbecue();
    let mut barbecue = barbecues_table.id().find(&barbecue_id)
        .ok_or_else(|| format!("Target barbecue {} disappeared", barbecue_id))?;

    // Monument placeables are indestructible
    if barbecue.is_monument {
        return Err("Cannot damage monument structures.".to_string());
    }

    if barbecue.is_destroyed {
        return Ok(AttackResult { hit: false, target_type: Some(TargetType::Barbecue), resource_granted: None });
    }

    // <<< PVP RAIDING CHECK >>>
    if let Some(attacker_player) = ctx.db.player().identity().find(attacker_id) {
        let attacker_pvp = is_pvp_active_for_player(&attacker_player, timestamp);
        
        if barbecue.placed_by != attacker_id {
            if let Some(owner_player) = ctx.db.player().identity().find(&barbecue.placed_by) {
                let owner_pvp = is_pvp_active_for_player(&owner_player, timestamp);
                
                if !attacker_pvp || !owner_pvp {
                    log::debug!("Structure raiding blocked - Attacker PvP: {}, Owner PvP: {}", 
                        attacker_pvp, owner_pvp);
                    return Ok(AttackResult { hit: false, target_type: Some(TargetType::Barbecue), resource_granted: None });
                }
            }
        }
    }
    // <<< END PVP RAIDING CHECK >>>

    let old_health = barbecue.health;
    barbecue.health = (barbecue.health - damage).max(0.0);
    barbecue.last_hit_time = Some(timestamp);
    barbecue.last_damaged_by = Some(attacker_id);

    log::info!(
        "Player {:?} hit Barbecue {} for {:.1} damage. Health: {:.1} -> {:.1}",
        attacker_id, barbecue_id, damage, old_health, barbecue.health
    );

    // Play hit sound for all hits
    sound_events::emit_barrel_hit_sound(ctx, barbecue.pos_x, barbecue.pos_y, attacker_id);

    if barbecue.health <= 0.0 {
        // Play destroyed sound
        sound_events::emit_barrel_destroyed_sound(ctx, barbecue.pos_x, barbecue.pos_y, attacker_id);
        barbecue.is_destroyed = true;
        barbecue.destroyed_at = Some(timestamp);

        let mut items_to_drop: Vec<(u64, u32)> = Vec::new();
        // Check all 12 slots for items to drop
        let slots = [
            (barbecue.slot_instance_id_0, barbecue.slot_def_id_0),
            (barbecue.slot_instance_id_1, barbecue.slot_def_id_1),
            (barbecue.slot_instance_id_2, barbecue.slot_def_id_2),
            (barbecue.slot_instance_id_3, barbecue.slot_def_id_3),
            (barbecue.slot_instance_id_4, barbecue.slot_def_id_4),
            (barbecue.slot_instance_id_5, barbecue.slot_def_id_5),
            (barbecue.slot_instance_id_6, barbecue.slot_def_id_6),
            (barbecue.slot_instance_id_7, barbecue.slot_def_id_7),
            (barbecue.slot_instance_id_8, barbecue.slot_def_id_8),
            (barbecue.slot_instance_id_9, barbecue.slot_def_id_9),
            (barbecue.slot_instance_id_10, barbecue.slot_def_id_10),
            (barbecue.slot_instance_id_11, barbecue.slot_def_id_11),
        ];

        for (instance_id_opt, def_id_opt) in slots {
            if let (Some(instance_id), Some(def_id)) = (instance_id_opt, def_id_opt) {
                if let Some(item) = ctx.db.inventory_item().instance_id().find(&instance_id) {
                    items_to_drop.push((def_id, item.quantity));
                    ctx.db.inventory_item().instance_id().delete(&instance_id);
                }
            }
        }

        // Clear all slots
        barbecue.slot_instance_id_0 = None;
        barbecue.slot_def_id_0 = None;
        barbecue.slot_instance_id_1 = None;
        barbecue.slot_def_id_1 = None;
        barbecue.slot_instance_id_2 = None;
        barbecue.slot_def_id_2 = None;
        barbecue.slot_instance_id_3 = None;
        barbecue.slot_def_id_3 = None;
        barbecue.slot_instance_id_4 = None;
        barbecue.slot_def_id_4 = None;
        barbecue.slot_instance_id_5 = None;
        barbecue.slot_def_id_5 = None;
        barbecue.slot_instance_id_6 = None;
        barbecue.slot_def_id_6 = None;
        barbecue.slot_instance_id_7 = None;
        barbecue.slot_def_id_7 = None;
        barbecue.slot_instance_id_8 = None;
        barbecue.slot_def_id_8 = None;
        barbecue.slot_instance_id_9 = None;
        barbecue.slot_def_id_9 = None;
        barbecue.slot_instance_id_10 = None;
        barbecue.slot_def_id_10 = None;
        barbecue.slot_instance_id_11 = None;
        barbecue.slot_def_id_11 = None;

        // Save position before update (barbecue is moved by update)
        let barbecue_pos_x = barbecue.pos_x;
        let barbecue_pos_y = barbecue.pos_y;

        barbecues_table.id().update(barbecue);

        log::info!(
            "Barbecue {} destroyed by player {:?}. Dropping contents.",
            barbecue_id, attacker_id
        );

        // Drop all items WITHOUT triggering consolidation on each drop
        for (item_def_id, quantity) in items_to_drop {
            let offset_x = (rng.gen::<f32>() - 0.5) * 2.0 * 20.0; // Spread within +/- 20px
            let offset_y = (rng.gen::<f32>() - 0.5) * 2.0 * 20.0;
            let drop_pos_x = barbecue_pos_x + offset_x;
            let drop_pos_y = barbecue_pos_y + offset_y;

            match dropped_item::create_dropped_item_entity_no_consolidation(ctx, item_def_id, quantity, drop_pos_x, drop_pos_y) {
                Ok(_) => log::debug!("Dropped {} of item_def_id {} from destroyed barbecue {}", quantity, item_def_id, barbecue_id),
                Err(e) => log::error!("Failed to drop item_def_id {}: {}", item_def_id, e),
            }
        }
        
        // Trigger consolidation ONCE after all items are dropped
        dropped_item::trigger_consolidation_at_position(ctx, barbecue_pos_x, barbecue_pos_y);

    } else {
        // Barbecue still has health, just update it
        barbecues_table.id().update(barbecue);
    }

    Ok(AttackResult {
        hit: true,
        target_type: Some(TargetType::Barbecue),
        resource_granted: None,
    })
}

/// Plays weapon-specific hit sounds based on weapon type and attacker info
/// This function is shared between player vs player and player vs animal combat
pub fn play_weapon_hit_sound(
    ctx: &ReducerContext,
    item_def: &ItemDefinition,
    hit_pos_x: f32,
    hit_pos_y: f32,
    attacker_id: Identity,
) {
    if item_def.name == "Stone Hatchet" || item_def.name == "Metal Hatchet" || item_def.name == "Stone Pickaxe" || item_def.name == "Metal Pickaxe" || item_def.name == "Bush Knife" || item_def.name == "AK74 Bayonet" {
        sound_events::emit_melee_hit_sharp_sound(ctx, hit_pos_x, hit_pos_y, attacker_id);
        log::debug!("Emitted melee_hit_sharp sound for {} hitting target", item_def.name);
    } else if item_def.name == "Wooden Spear" || item_def.name == "Stone Spear" || item_def.name == "Reed Harpoon" || item_def.name == "Bone Knife" || item_def.name == "Bone Gaff Hook" || item_def.name == "Tidebreaker Blade" {
        sound_events::emit_spear_hit_sound(ctx, hit_pos_x, hit_pos_y, attacker_id);
        log::debug!("Emitted spear_hit sound for {} hitting target", item_def.name);
    } else if item_def.name == "Combat Ladle" || item_def.name == "Repair Hammer" || item_def.name == "Rock" || 
              item_def.name == "Flashlight" || item_def.name == "Reed Diver's Helm" || item_def.name == "Primitive Reed Fishing Rod" || item_def.name == "Bone Club" || item_def.name == "Human Skull" {
        sound_events::emit_melee_hit_blunt_sound(ctx, hit_pos_x, hit_pos_y, attacker_id);
        log::debug!("Emitted melee_hit_blunt sound for {} hitting target", item_def.name);
    } else if item_def.name == "Torch" {
        // Check if torch is lit using the player's is_torch_lit field
        let torch_is_lit = ctx.db.player().identity().find(&attacker_id)
            .map(|player| player.is_torch_lit)
            .unwrap_or(false);
        
        sound_events::emit_torch_hit_combined_sound(ctx, hit_pos_x, hit_pos_y, attacker_id, torch_is_lit);
    }
}
