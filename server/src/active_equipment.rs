/******************************************************************************
 *                                                                            *
 * Defines player equipment system including loadout management, tool usage,  *
 * armor equipping, and weapon-based combat interactions. Handles equipment   *
 * slots, item switching, swinging mechanics, and damage application using    *
 * the combat system. Maintains both hotbar items and armor slots.            *
 *                                                                            *
 ******************************************************************************/

// Standard library imports
use std::f32::consts::PI;
use std::time::Duration;

// SpacetimeDB imports
use spacetimedb::{Identity, ReducerContext, Table, Timestamp};
use log;
use rand::{Rng, SeedableRng};

// Combat system imports
use crate::combat::{RESPAWN_TIME_MS};
use crate::combat::{
    find_targets_in_cone, find_best_target, process_attack
};

// Consumable and active effects imports
use crate::consumables::MAX_HEALTH_VALUE;
use crate::consumables::apply_item_effects_and_consume;
use crate::active_effects::{ActiveConsumableEffect, EffectType, cancel_bleed_effects, cancel_health_regen_effects, active_consumable_effect as ActiveConsumableEffectTableTrait, cancel_bandage_burst_effects};

// Collision constants
use crate::tree::{TREE_COLLISION_Y_OFFSET, PLAYER_TREE_COLLISION_DISTANCE_SQUARED};
use crate::stone::{STONE_COLLISION_Y_OFFSET, PLAYER_STONE_COLLISION_DISTANCE_SQUARED};

// Core game types
use crate::Player;
use crate::PLAYER_RADIUS;
use crate::items::{InventoryItem, ItemDefinition, ItemCategory, add_item_to_player_inventory};

// Table trait imports for database access
// use crate::tree::tree as TreeTableTrait; // Assuming not used, or handle similarly if error appears
// use crate::stone::stone as StoneTableTrait; // Assuming not used, or handle similarly if error appears
use crate::items::item_definition as ItemDefinitionTableTrait;
use crate::items::inventory_item as InventoryItemTableTrait;
// REMOVE: use crate::player::player as PlayerTableTrait; // This was likely the source of E0658 and confusion for E0599
// Correct way to allow `ctx.db.player()` is usually by having the table struct in scope
// or ensuring the module `crate::player` itself provides the necessary accessors via generated code.
// No explicit `PlayerTableTrait` import is typically needed for `ctx.db.player()` if `Player` table is defined.
use crate::active_equipment as ActiveEquipmentTableTrait;
use crate::player; // Added to bring Player table accessors into scope
use crate::PlayerLastAttackTimestamp; // Import the new table
use crate::player_last_attack_timestamp as PlayerLastAttackTimestampTableTrait; // Import the trait for the new table

// Models imports
use crate::models::{ItemLocation, EquipmentSlotType};

// Player inventory imports
use crate::player_inventory::find_first_empty_player_slot;

// --- Interaction Constants ---
/// Maximum distance for player-item interactions
const PLAYER_INTERACT_DISTANCE: f32 = 80.0;
/// Squared interaction distance for faster distance checks
const PLAYER_INTERACT_DISTANCE_SQUARED: f32 = PLAYER_INTERACT_DISTANCE * PLAYER_INTERACT_DISTANCE;

/// Represents a player's equipped items, both in hand and armor slots
#[spacetimedb::table(name = active_equipment, public)]
#[derive(Clone, Default, Debug)]
pub struct ActiveEquipment {
    #[primary_key]
    pub player_identity: Identity,
    pub equipped_item_def_id: Option<u64>, // ID from ItemDefinition table
    pub equipped_item_instance_id: Option<u64>, // Instance ID from InventoryItem
    pub icon_asset_name: Option<String>, // Icon to display for equipped item
    pub swing_start_time_ms: u64, // Timestamp (ms) when the current swing started, 0 if not swinging
    // Ranged weapon ammunition tracking
    pub loaded_ammo_def_id: Option<u64>, // ID of loaded ammunition (e.g., arrow)
    pub is_ready_to_fire: bool, // Whether the ranged weapon is loaded and ready
    pub preferred_arrow_type: Option<String>, // Player's preferred arrow type for cycling (e.g., "Wooden Arrow")
    // Fields for worn armor
    pub head_item_instance_id: Option<u64>,
    pub chest_item_instance_id: Option<u64>,
    pub legs_item_instance_id: Option<u64>,
    pub feet_item_instance_id: Option<u64>,
    pub hands_item_instance_id: Option<u64>,
    pub back_item_instance_id: Option<u64>,
}

/// Sets an item from inventory/hotbar as the player's "active" item (e.g., tool or weapon in hand).
/// This does NOT change the item's actual ItemLocation, only updates the ActiveEquipment table
/// to reflect which item is currently wielded/active.
#[spacetimedb::reducer]
pub fn set_active_item_reducer(ctx: &ReducerContext, item_instance_id: u64) -> Result<(), String> {
    let sender_id = ctx.sender;
    let inventory_items = ctx.db.inventory_item();
    let item_defs = ctx.db.item_definition();
    let active_equipments = ctx.db.active_equipment();
    let mut players_table = ctx.db.player(); // Get a mutable reference for player updates

    // --- Check player state first ---
    let player = players_table.identity().find(&sender_id)
        .ok_or_else(|| "Player not found.".to_string())?;
    
    if player.is_dead {
        return Err("Cannot equip items while dead.".to_string());
    }
    if player.is_knocked_out {
        return Err("Cannot equip items while knocked out.".to_string());
    }

    // Cancel any ongoing BandageBurst effect before equipping a new item or re-equipping.
    cancel_bandage_burst_effects(ctx, sender_id);

    let item_to_make_active = inventory_items.instance_id().find(item_instance_id)
        .ok_or_else(|| format!("Inventory item with instance ID {} not found.", item_instance_id))?;

    // Additional validation: ensure the item hasn't been consumed (quantity > 0)
    if item_to_make_active.quantity == 0 {
        return Err(format!("Cannot set item {} as active: it has been consumed (quantity is 0).", item_instance_id));
    }

    let item_def = item_defs.id().find(item_to_make_active.item_def_id)
        .ok_or_else(|| format!("Item definition {} not found for item instance {}.", item_to_make_active.item_def_id, item_instance_id))?;

    // --- Validate Item Location & Ownership ---
    // Item must be in player's inventory or hotbar to be made active.
    match &item_to_make_active.location {
        ItemLocation::Inventory(_) |
        ItemLocation::Hotbar(_) => {
            // Item is in inventory or hotbar - allow activation regardless of original owner_id
            // since if it's in the player's slots, they should be able to activate it
            if item_def.category == ItemCategory::Tool ||
               item_def.category == ItemCategory::Weapon ||
               item_def.category == ItemCategory::RangedWeapon { // Assuming RangedWeapon is a variant of ItemCategory
                // Valid location and type for activation
            } else {
                return Err(format!("Item '{}' (category {:?}) is not a Tool, Weapon, or Ranged Weapon and cannot be activated in hand.", item_def.name, item_def.category));
            }
        }
        ItemLocation::Equipped(data) => {
             return Err(format!("Cannot set item {} as active: it is currently equipped as armor in slot {:?}.", item_instance_id, data.slot_type));
        }
        ItemLocation::Container(_) => return Err("Cannot set an item from a container as active.".to_string()),
        ItemLocation::Dropped(_) => return Err("Cannot set a dropped item as active.".to_string()),
        ItemLocation::Unknown => return Err("Cannot set an item with an unknown location as active.".to_string()),
        // Catch-all for any other unhandled or future locations
        _ => {
            return Err(format!(
                "Item '{}' has an unsupported location ({:?}) for activation.",
                item_def.name, item_to_make_active.location
            ));
        }
    }

    // --- Item Definition Validations (moved after location check) ---
    // let item_def = item_defs.id().find(item_to_make_active.item_def_id) // Already fetched above
    //     .ok_or_else(|| format!("Item definition {} not found for item instance {}.", item_to_make_active.item_def_id, item_instance_id))?;

    if !item_def.is_equippable {
        return Err(format!("Item '{}' (Instance ID: {}) is not a usable tool or weapon and cannot be set as active.", item_def.name, item_instance_id));
    }
    if item_def.category == ItemCategory::Armor {
        return Err(format!("Armor item '{}' (Instance ID: {}) cannot be set as active. Use equip_armor.", item_def.name, item_instance_id));
    }

    let mut equipment = get_or_create_active_equipment(ctx, sender_id)?;

    if equipment.equipped_item_instance_id == Some(item_instance_id) {
        // log::debug!("Item {} is already the active item for player {:?}. No change to ActiveEquipment needed.", item_instance_id, sender_id);
        return Ok(());
    }
    
    if let Some(old_active_id) = equipment.equipped_item_instance_id {
        if old_active_id != item_instance_id {
             // log::info!("Player {:?} changing active item from {} to {}.", sender_id, old_active_id, item_instance_id);
        }
    }

    equipment.equipped_item_def_id = Some(item_def.id);
    equipment.equipped_item_instance_id = Some(item_instance_id);
    equipment.swing_start_time_ms = 0;
    equipment.icon_asset_name = Some(item_def.icon_asset_name.clone());
    // Reset ammunition state when switching items
    equipment.loaded_ammo_def_id = None;
    equipment.is_ready_to_fire = false;

    // --- Handle Torch Specific State on Equip ---
    if item_def.name == "Torch" {
        equipment.icon_asset_name = Some("torch.png".to_string()); // Default to off
        if let Some(mut player) = players_table.identity().find(&sender_id) {
            // Ensure torch starts off, even if it was somehow lit with a previous torch
            if player.is_torch_lit { 
                player.is_torch_lit = false;
                player.last_update = ctx.timestamp; // Update timestamp
                players_table.identity().update(player);
            }
        }
    } else {
        equipment.icon_asset_name = Some(item_def.icon_asset_name.clone());
        // If equipping something else and a torch was lit, turn it off
        if let Some(mut player) = players_table.identity().find(&sender_id) {
            if player.is_torch_lit {
                player.is_torch_lit = false;
                player.last_update = ctx.timestamp; // Update timestamp
                players_table.identity().update(player);
            }
        }
    }
    // --- End Handle Torch Specific State ---

    active_equipments.player_identity().update(equipment.clone());

    // log::info!("Player {:?} set active item to: {} (Instance ID: {}). Item remains in location: {:?}",
    //     sender_id, item_def.name, item_instance_id, item_to_make_active.location);

    Ok(())
}

/// Clears the player's currently "active" item (e.g., tool or weapon in hand).
/// This does NOT change the item's actual ItemLocation, only clears the ActiveEquipment table fields.
#[spacetimedb::reducer]
pub fn clear_active_item_reducer(ctx: &ReducerContext, player_identity: Identity) -> Result<(), String> {
    let active_equipments = ctx.db.active_equipment();
    let item_defs = ctx.db.item_definition(); // For checking item name
    let mut players_table = ctx.db.player(); // For updating player state

    // Cancel any ongoing BandageBurst effect when clearing the active item.
    cancel_bandage_burst_effects(ctx, player_identity);

    if let Some(mut equipment) = active_equipments.player_identity().find(player_identity) {
        // Store old item def ID before clearing for torch check
        let old_item_def_id_opt = equipment.equipped_item_def_id;

        if equipment.equipped_item_instance_id.is_some() {
            // log::info!("Player {:?} cleared active item (was instance ID: {:?}, def ID: {:?}).", 
            //          player_identity, equipment.equipped_item_instance_id, equipment.equipped_item_def_id);
            
            equipment.equipped_item_def_id = None;
            equipment.equipped_item_instance_id = None;
            equipment.swing_start_time_ms = 0;
            equipment.icon_asset_name = None; // <<< CLEAR icon name
            equipment.loaded_ammo_def_id = None;
            equipment.is_ready_to_fire = false;
            active_equipments.player_identity().update(equipment);

            // --- Handle Torch Lit State on Unequip ---
            if let Some(old_item_def_id) = old_item_def_id_opt {
                if let Some(item_def) = item_defs.id().find(old_item_def_id) {
                    if item_def.name == "Torch" {
                        if let Some(mut player) = players_table.identity().find(&player_identity) {
                            if player.is_torch_lit {
                                player.is_torch_lit = false;
                                player.last_update = ctx.timestamp;
                                players_table.identity().update(player);
                                log::info!("Player {:?} unequipped a lit torch, extinguishing it.", player_identity);
                            }
                        }
                    }
                }
            }
            // --- End Handle Torch Lit State on Unequip ---
        } else {
            log::debug!("Player {:?} called clear_active_item_reducer, but no item was active.", player_identity);
        }
    } else {
        log::info!("Player {:?} tried to clear active item, but no ActiveEquipment row found.", player_identity);
    }
    Ok(())
}

/// Loads a ranged weapon with ammunition or cycles through available arrow types
///
/// If the weapon is not loaded, loads it with the player's preferred arrow type (or first available).
/// If the weapon is already loaded, cycles to the next available arrow type.
/// Remembers the player's preferred arrow type for future loading.
#[spacetimedb::reducer]
pub fn load_ranged_weapon(ctx: &ReducerContext) -> Result<(), String> {
    let sender_id = ctx.sender;
    log::info!("[LoadRangedWeapon] Reducer called by player: {:?}", sender_id);

    let active_equipments = ctx.db.active_equipment();
    let players_table = ctx.db.player();
    let item_defs = ctx.db.item_definition();
    let inventory_items = ctx.db.inventory_item();

    // --- Check player state first ---
    let player = players_table.identity().find(&sender_id)
        .ok_or_else(|| "Player not found.".to_string())?;
    
    if player.is_dead {
        return Err("Cannot load weapons while dead.".to_string());
    }
    if player.is_knocked_out {
        return Err("Cannot load weapons while knocked out.".to_string());
    }

    let mut current_equipment = active_equipments.player_identity().find(sender_id)
        .ok_or_else(|| "No active equipment record found.".to_string())?;
    log::info!("[LoadRangedWeapon] Found ActiveEquipment for player {:?}: {:?}", sender_id, current_equipment);

    let equipped_item_def_id = current_equipment.equipped_item_def_id
        .ok_or_else(|| "No item equipped to load.".to_string())?;
    
    let item_def = item_defs.id().find(equipped_item_def_id)
        .ok_or_else(|| "Equipped item definition not found".to_string())?;

    // Check if the equipped item is a ranged weapon
    if item_def.category != crate::items::ItemCategory::RangedWeapon {
        return Err("Equipped item is not a ranged weapon.".to_string());
    }

    // Define all available arrow types in order
    let arrow_types = vec!["Wooden Arrow", "Bone Arrow", "Fire Arrow"];
    
    // Find all available arrow types in player's inventory/hotbar
    let mut available_arrows: Vec<(String, u64)> = Vec::new(); // (name, def_id)
    
    for arrow_name in &arrow_types {
        if let Some(ammo_def) = item_defs.iter().find(|def| def.name == *arrow_name) {
            // Check if player has at least 1 of this ammo in inventory/hotbar
            let has_ammo = inventory_items.iter().any(|item| {
                item.item_def_id == ammo_def.id 
                && item.quantity > 0
                && match &item.location {
                    crate::models::ItemLocation::Inventory(data) => data.owner_id == sender_id,
                    crate::models::ItemLocation::Hotbar(data) => data.owner_id == sender_id,
                    _ => false,
                }
            });
            
            if has_ammo {
                available_arrows.push((arrow_name.to_string(), ammo_def.id));
            }
        }
    }

    if available_arrows.is_empty() {
        return Err("You need at least 1 arrow to load the weapon.".to_string());
    }

    let selected_arrow = if current_equipment.is_ready_to_fire {
        // Weapon is already loaded - cycle to next arrow type
        if let Some(current_ammo_id) = current_equipment.loaded_ammo_def_id {
            // Find current arrow in available list
            let current_index = available_arrows.iter()
                .position(|(_, id)| *id == current_ammo_id);
            
            if let Some(index) = current_index {
                // Cycle to next arrow type (wrap around to beginning if at end)
                let next_index = (index + 1) % available_arrows.len();
                available_arrows[next_index].clone()
            } else {
                // Current arrow not in available list, use first available
                available_arrows[0].clone()
            }
        } else {
            // Somehow ready to fire but no ammo loaded, use first available
            available_arrows[0].clone()
        }
    } else {
        // Weapon is not loaded - use preferred arrow type if available, otherwise first available
        if let Some(preferred_type) = &current_equipment.preferred_arrow_type {
            // Try to find preferred arrow type in available arrows
            available_arrows.iter()
                .find(|(name, _)| name == preferred_type)
                .cloned()
                .unwrap_or_else(|| available_arrows[0].clone()) // Fall back to first available
        } else {
            // No preference set, use first available
            available_arrows[0].clone()
        }
    };

    // Load the weapon with selected arrow
    current_equipment.loaded_ammo_def_id = Some(selected_arrow.1);
    current_equipment.is_ready_to_fire = true;
    current_equipment.preferred_arrow_type = Some(selected_arrow.0.clone());
    active_equipments.player_identity().update(current_equipment);

    log::info!("[LoadRangedWeapon] Player {:?} loaded {} with {} (ready to fire).", 
        sender_id, item_def.name, selected_arrow.0);
    Ok(())
}

/// Processes the use/swing action for the currently equipped item
///
/// Handles tool usage including swinging animations, target finding,
/// damage application, and resource gathering.
#[spacetimedb::reducer]
pub fn use_equipped_item(ctx: &ReducerContext) -> Result<(), String> {
    let sender_id = ctx.sender;
    let now_ts = ctx.timestamp;
    let now_micros = now_ts.to_micros_since_unix_epoch();
    let now_ms = (now_micros / 1000) as u64;

    let active_equipments = ctx.db.active_equipment();
    let players_table = ctx.db.player(); // Renamed for clarity
    let item_defs = ctx.db.item_definition();
    let player_last_attack_timestamps = ctx.db.player_last_attack_timestamp(); // Get handle to new table

    // Get RNG from context
    let mut rng = rand::rngs::StdRng::from_rng(ctx.rng()).map_err(|e| format!("Failed to create RNG: {}",e))?;

    let player = players_table.identity().find(sender_id)
        .ok_or_else(|| "Player not found".to_string())?;
    
    // --- Check player state first ---
    if player.is_dead {
        return Err("Cannot use items while dead.".to_string());
    }
    if player.is_knocked_out {
        return Err("Cannot use items while knocked out.".to_string());
    }
    
    let mut current_equipment = active_equipments.player_identity().find(sender_id)
        .ok_or_else(|| "No active equipment record found.".to_string())?;

    let equipped_item_instance_id = current_equipment.equipped_item_instance_id
        .ok_or_else(|| "No item instance ID in active equipment to use.".to_string())?;
    let item_def_id = current_equipment.equipped_item_def_id
        .ok_or_else(|| "No item definition ID in active equipment to use.".to_string())?;
    
    // Check if the equipped item instance still exists (it might have been consumed)
    let inventory_items = ctx.db.inventory_item();
    if inventory_items.instance_id().find(equipped_item_instance_id).is_none() {
        log::warn!("[UseEquippedItem] Equipped item instance {} no longer exists (probably consumed). Clearing from ActiveEquipment.", equipped_item_instance_id);
        
        // Clear the stale reference from ActiveEquipment
        current_equipment.equipped_item_def_id = None;
        current_equipment.equipped_item_instance_id = None;
        current_equipment.swing_start_time_ms = 0;
        current_equipment.icon_asset_name = None;
        active_equipments.player_identity().update(current_equipment);
        
        return Err("Equipped item no longer exists.".to_string());
    }
    
    let item_def = item_defs.id().find(item_def_id)
        .ok_or_else(|| "Equipped item definition not found".to_string())?;

    // --- Skip ranged weapons for melee use_equipped_item logic ---
    if item_def.category == crate::items::ItemCategory::RangedWeapon {
        return Err("Ranged weapons should be fired using fire_projectile, not used as melee weapons.".to_string());
    }

    // --- BEGIN ATTACK SPEED CHECK ---
    if let Some(attack_interval_seconds) = item_def.attack_interval_secs {
        if attack_interval_seconds > 0.0 { // Only check if interval is positive
            let attack_interval_micros_u64 = (attack_interval_seconds * 1_000_000.0) as u64;
            if let Some(last_attack_record) = player_last_attack_timestamps.player_id().find(&sender_id) {
                let time_since_last_attack_micros_u64 = now_micros.saturating_sub(last_attack_record.last_attack_timestamp.to_micros_since_unix_epoch());
                // Attempting to satisfy the compiler's expectation of i64 for comparison
                if (time_since_last_attack_micros_u64 as i64) < attack_interval_micros_u64.try_into().unwrap() {
                    log::debug!(
                        "Player {:?} attack with {} (Def ID: {}) too soon. Last attack: {} us ago, interval: {} us.",
                        sender_id, item_def.name, item_def_id, time_since_last_attack_micros_u64, attack_interval_micros_u64
                    );
                    return Err("Attacking too quickly.".to_string());
                }
            }
            // If no record exists, or if enough time has passed, allow attack and update/insert timestamp later.
        }
    }
    // --- END ATTACK SPEED CHECK ---

    // --- BEGIN BANDAGE HANDLING ---
    if item_def.name == "Bandage" {
        log::info!("[UseEquippedItem] Player {:?} is using an equipped Bandage (Instance: {}, Def: {}, Health Gain: {:?}).", 
            sender_id, equipped_item_instance_id, item_def.id, item_def.consumable_health_gain);

        // Check for existing active BandageBurst effect from ANY bandage item to prevent stacking this specific effect type.
        let has_active_bandage_burst_effect = ctx.db.active_consumable_effect().iter().any(|effect| {
            // Check if player is either the healer or target of any active bandage effect
            (effect.player_id == sender_id && 
             (effect.effect_type == EffectType::BandageBurst || effect.effect_type == EffectType::RemoteBandageBurst)) ||
            (effect.target_player_id == Some(sender_id) && effect.effect_type == EffectType::RemoteBandageBurst)
        });

        if has_active_bandage_burst_effect {
            log::warn!("[UseEquippedItem] Player {:?} tried to use Bandage while another bandage effect is already active.", sender_id);
            return Err("You are already applying or receiving a bandage.".to_string());
        }

        // Get the player's position to check for nearby players
        let player_pos = players_table.identity().find(sender_id)
            .ok_or_else(|| "Player not found for bandage use".to_string())?;

        // Find nearby players within healing range (use a reasonable range, e.g., 4 tiles)
        const HEALING_RANGE: f32 = 4.0 * 32.0; // 4 tiles * 32 pixels per tile (increased from 2 tiles)
        let mut nearest_wounded_player: Option<(Identity, f32)> = None; // (player_id, distance)

        for other_player in players_table.iter() {
            if other_player.identity == sender_id { continue; } // Skip self
            if other_player.is_dead { continue; } // Skip dead players
            if other_player.health >= 100.0 { continue; } // Skip players at full health

            let dx = other_player.position_x - player_pos.position_x;
            let dy = other_player.position_y - player_pos.position_y;
            let distance = (dx * dx + dy * dy).sqrt();

            if distance <= HEALING_RANGE {
                if let Some((_, current_nearest_distance)) = nearest_wounded_player {
                    if distance < current_nearest_distance {
                        nearest_wounded_player = Some((other_player.identity, distance));
                    }
                } else {
                    nearest_wounded_player = Some((other_player.identity, distance));
                }
            }
        }

        if let Some((target_id, _)) = nearest_wounded_player {
            // Create a RemoteBandageBurst effect for the target
            let effect = ActiveConsumableEffect {
                effect_id: 0, // Will be auto-incremented
                player_id: sender_id, // The healer
                target_player_id: Some(target_id), // The player being healed
                item_def_id: item_def.id,
                consuming_item_instance_id: Some(equipped_item_instance_id),
                started_at: ctx.timestamp,
                ends_at: ctx.timestamp + Duration::from_secs(5), // 5 second duration
                total_amount: item_def.consumable_health_gain,
                amount_applied_so_far: Some(0.0),
                effect_type: EffectType::RemoteBandageBurst,
                tick_interval_micros: 1_000_000, // Check every second
                next_tick_at: ctx.timestamp + Duration::from_secs(1),
            };

            ctx.db.active_consumable_effect().insert(effect);
            log::info!("[UseEquippedItem] RemoteBandageBurst effect initiated from player {:?} to target {:?}", 
                sender_id, target_id);

            // Update player's last_consumed_at
            let mut player_to_update = player_pos.clone();
            player_to_update.last_consumed_at = Some(ctx.timestamp);
            players_table.identity().update(player_to_update);
        } else {
            // No nearby wounded players, apply to self as normal
            log::info!("[UseEquippedItem] No nearby wounded players found, applying bandage to self (Player {:?})", sender_id);
            
            // Create a BandageBurst effect for self-healing
            let effect = ActiveConsumableEffect {
                effect_id: 0, // Will be auto-incremented
                player_id: sender_id, // The healer (self)
                target_player_id: None, // For BandageBurst (self-heal), we use player_id as target
                item_def_id: item_def.id,
                consuming_item_instance_id: Some(equipped_item_instance_id),
                started_at: ctx.timestamp,
                ends_at: ctx.timestamp + Duration::from_secs(5), // 5 second duration
                total_amount: item_def.consumable_health_gain,
                amount_applied_so_far: Some(0.0),
                effect_type: EffectType::BandageBurst,
                tick_interval_micros: 1_000_000, // Check every second
                next_tick_at: ctx.timestamp + Duration::from_secs(1),
            };

            ctx.db.active_consumable_effect().insert(effect);
            log::info!("[UseEquippedItem] BandageBurst effect initiated for self-healing player {:?} with bandage instance {}. Heal amount: {:?}", 
                sender_id, equipped_item_instance_id, item_def.consumable_health_gain);

            // Update player's last_consumed_at
            let mut player_to_update = player_pos.clone();
            player_to_update.last_consumed_at = Some(ctx.timestamp);
            players_table.identity().update(player_to_update);
        }
        return Ok(()); // Bandage handling complete
    }

    if item_def.name == "Selo Olive Oil" {
        log::info!("[UseEquippedItem] Player {:?} is using equipped Selo Olive Oil (Instance: {}, Def: {}).", 
            sender_id, equipped_item_instance_id, item_def.id);

        // Use the consumables helper function to apply effects and consume the item
        let mut player_to_update = players_table.identity().find(&sender_id)
            .ok_or_else(|| "Player not found for Selo Olive Oil use".to_string())?;

        crate::consumables::apply_item_effects_and_consume(ctx, sender_id, &item_def, equipped_item_instance_id, &mut player_to_update)?;

        // Update player in database
        players_table.identity().update(player_to_update);

        return Ok(()); // Selo Olive Oil handling complete
    }

    // Default values for attack cone
    let mut actual_attack_range = PLAYER_RADIUS * 4.0;
    let mut actual_attack_angle_degrees = 90.0;

    // Check if the item is a spear and adjust its properties
    if item_def.name == "Wooden Spear" || item_def.name == "Stone Spear" {
        // Spears have a longer range and a narrower cone for a thrust-like attack
        actual_attack_range = PLAYER_RADIUS * 6.0; // Further increased range for better standoff
        actual_attack_angle_degrees = 30.0;      // Narrow 30-degree cone for thrust
        log::debug!("{} detected: Using custom range {:.1}, angle {:.1}", item_def.name, actual_attack_range, actual_attack_angle_degrees);
    }

    let mut current_equipment_mut = current_equipment.clone(); // Clone to modify for swing time
    current_equipment_mut.swing_start_time_ms = now_ms;
    active_equipments.player_identity().update(current_equipment_mut); // Update with new swing time

    // --- UPDATE LAST ATTACK TIMESTAMP ---
    if item_def.attack_interval_secs.is_some() && item_def.attack_interval_secs.unwrap_or(0.0) > 0.0 {
        let new_last_attack_record = PlayerLastAttackTimestamp {
            player_id: sender_id,
            last_attack_timestamp: now_ts,
        };
        if player_last_attack_timestamps.player_id().find(&sender_id).is_some() {
            player_last_attack_timestamps.player_id().update(new_last_attack_record);
        } else {
            player_last_attack_timestamps.insert(new_last_attack_record);
        }
        log::debug!("Player {:?} updated last attack timestamp for item {}", sender_id, item_def.name);
    }
    // --- END UPDATE LAST ATTACK TIMESTAMP ---

    log::debug!("[UseEquippedItem] Player {:?} started using non-bandage item '{}' (ID: {}). Swing time set.",
             sender_id, item_def.name, item_def_id);
    
    let targets = find_targets_in_cone(ctx, &player, actual_attack_range, actual_attack_angle_degrees);
    
    log::info!(
        "[UseEquippedItem] Player {:?} found {} targets with {} (range: {:.1}, angle: {:.1})",
        sender_id, targets.len(), item_def.name, actual_attack_range, actual_attack_angle_degrees
    );
    
    for (i, target) in targets.iter().enumerate() {
        log::info!(
            "[UseEquippedItem] Target {}: {:?} (distance: {:.1})",
            i, target.id, target.distance_sq.sqrt()
        );
    }
    
    if let Some(target) = find_best_target(&targets, &item_def) {
        log::info!(
            "[UseEquippedItem] Player {:?} selected best target: {:?}",
            sender_id, target.id
        );
        match process_attack(ctx, sender_id, &target, &item_def, now_ts, &mut rng) {
            Ok(result) => {
                if result.hit {
                    log::debug!("Player {:?} hit a {:?} with {}.", sender_id, result.target_type, item_def.name);
                }
            },
            Err(e) => log::error!("Error processing attack: {}", e),
        }
    } else {
        log::debug!("Player {:?} swung {} but hit nothing.", sender_id, item_def.name);
    }

    Ok(())
}

/// Creates or retrieves a player's ActiveEquipment record
///
/// Ensures every player has an ActiveEquipment record by creating one if it doesn't exist.
/// Used by the equipment reducers to get the current equipment state.
fn get_or_create_active_equipment(ctx: &ReducerContext, player_id: Identity) -> Result<ActiveEquipment, String> {
    let table = ctx.db.active_equipment();
    if let Some(existing) = table.player_identity().find(player_id) {
        Ok(existing)
    } else {
        log::info!("Creating new ActiveEquipment row for player {:?}", player_id);
        let new_equip = ActiveEquipment { 
            player_identity: player_id, 
            equipped_item_def_id: None,
            equipped_item_instance_id: None,
            icon_asset_name: None,
            swing_start_time_ms: 0,
            loaded_ammo_def_id: None,
            is_ready_to_fire: false,
            preferred_arrow_type: None,
            head_item_instance_id: None,
            chest_item_instance_id: None,
            legs_item_instance_id: None,
            feet_item_instance_id: None,
            hands_item_instance_id: None,
            back_item_instance_id: None,
        };
        table.insert(new_equip.clone());
        Ok(new_equip)
    }
}

/// Equips an armor item to the appropriate slot based on its type
///
/// Moves an armor item from inventory to the appropriate armor slot.
/// Handles swapping with existing armor if a slot is already occupied.
#[spacetimedb::reducer]
pub fn equip_armor(ctx: &ReducerContext, item_instance_id: u64) -> Result<(), String> {
    let sender_id = ctx.sender;
    log::info!("Player {:?} attempting to equip armor item instance {}", sender_id, item_instance_id);
    let inventory_items = ctx.db.inventory_item();
    let item_defs = ctx.db.item_definition();
    let active_equipments = ctx.db.active_equipment();

    // --- Check player state first ---
    let player = ctx.db.player().identity().find(&sender_id)
        .ok_or_else(|| "Player not found.".to_string())?;
    
    if player.is_dead {
        return Err("Cannot equip armor while dead.".to_string());
    }
    if player.is_knocked_out {
        return Err("Cannot equip armor while knocked out.".to_string());
    }

    let mut item_to_equip = inventory_items.instance_id().find(item_instance_id)
        .ok_or_else(|| format!("Item instance {} not found.", item_instance_id))?;

    match &item_to_equip.location {
        ItemLocation::Inventory(_) | ItemLocation::Hotbar(_) => {
            // Item is in player's direct possession slots (Inventory or Hotbar).
            // The owner_id within these ItemLocationData variants should ideally match ctx.sender.
            // This reducer proceeds to equip it for ctx.sender regardless of a potential mismatch here,
            // as the act of equipping by sender_id implies claim and corrects its state to Equipped by sender_id.
            log::debug!("[EquipArmor] Item {} found in Inventory/Hotbar ({:?}), proceeding to equip for player {:?}.", item_instance_id, item_to_equip.location, sender_id);
        }
        ItemLocation::Unknown => {
            // Item's location is Unknown. This typically means it's not properly tracked in a specific player slot or container.
            // Allowing equip from Unknown implies the player (ctx.sender) is claiming this unlocated item.
            log::warn!("[EquipArmor] Equipping item {} which has an ItemLocation::Unknown for player {:?}. The item will be claimed and its location updated to Equipped.", item_instance_id, sender_id);
        }
        // Other locations (Container, Dropped, already Equipped in a different slot) are not directly handled here.
        // Equipping from a container would typically involve moving it to inventory first.
        // Equipping a dropped item requires picking it up first.
        // Swapping already equipped items is usually handled by client-side logic orchestrating unequip/equip or specific swap reducers.
        _ => {
            log::warn!("[EquipArmor] Item {} cannot be equipped directly from its current location: {:?}. It must be in Inventory, Hotbar, or be in an Unknown state to be claimed.", item_instance_id, item_to_equip.location);
            return Err(format!("Item cannot be equipped from its current location ({:?}). Move to inventory/hotbar or ensure it's in a claimable state first.", item_to_equip.location));
        }
    }

    let item_def = item_defs.id().find(item_to_equip.item_def_id)
        .ok_or_else(|| format!("Definition not found for item ID {}", item_to_equip.item_def_id))?;

    if item_def.category != ItemCategory::Armor {
        return Err(format!("Item '{}' is not armor.", item_def.name));
    }
    let target_slot_type = item_def.equipment_slot_type
        .ok_or_else(|| format!("Armor '{}' has no defined equipment slot.", item_def.name))?;

    let mut equipment = get_or_create_active_equipment(ctx, sender_id)?;
    let mut previously_equipped_item_id: Option<u64> = None;

    match target_slot_type {
        EquipmentSlotType::Head => {
            previously_equipped_item_id = equipment.head_item_instance_id.take();
            equipment.head_item_instance_id = Some(item_instance_id);
        }
        EquipmentSlotType::Chest => {
            previously_equipped_item_id = equipment.chest_item_instance_id.take();
            equipment.chest_item_instance_id = Some(item_instance_id);
        }
        EquipmentSlotType::Legs => {
            previously_equipped_item_id = equipment.legs_item_instance_id.take();
            equipment.legs_item_instance_id = Some(item_instance_id);
        }
        EquipmentSlotType::Feet => {
            previously_equipped_item_id = equipment.feet_item_instance_id.take();
            equipment.feet_item_instance_id = Some(item_instance_id);
        }
        EquipmentSlotType::Hands => {
            previously_equipped_item_id = equipment.hands_item_instance_id.take();
            equipment.hands_item_instance_id = Some(item_instance_id);
        }
        EquipmentSlotType::Back => {
            previously_equipped_item_id = equipment.back_item_instance_id.take();
            equipment.back_item_instance_id = Some(item_instance_id);
        }
    }

    if let Some(old_item_id) = previously_equipped_item_id {
        if old_item_id != item_instance_id {
            if let Some(mut old_item) = inventory_items.instance_id().find(old_item_id) {
                match find_first_empty_player_slot(ctx, sender_id) {
                    Some(empty_slot_location) => {
                        old_item.location = empty_slot_location;
                        inventory_items.instance_id().update(old_item);
                        log::info!("Moved previously equipped armor {} to {:?}", old_item_id, item_to_equip.location);
                    }
                    None => return Err("No space in inventory to unequip previous armor.".to_string()),
                }
            } else {
                 log::warn!("Could not find InventoryItem for previously equipped armor ID {}. Slot was cleared.", old_item_id);
            }
        }
    }

    item_to_equip.location = ItemLocation::Equipped(crate::models::EquippedLocationData { owner_id: sender_id, slot_type: target_slot_type.clone() });
    inventory_items.instance_id().update(item_to_equip);
    active_equipments.player_identity().update(equipment);

    log::info!("Player {:?} equipped armor '{}' (Instance ID: {}) to slot {:?}.", sender_id, item_def.name, item_instance_id, target_slot_type);
    Ok(())
}
