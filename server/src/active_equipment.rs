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
use crate::consumables::MAX_STAT_VALUE;
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

    // Cancel any ongoing BandageBurst effect before equipping a new item or re-equipping.
    cancel_bandage_burst_effects(ctx, sender_id);

    let item_to_make_active = inventory_items.instance_id().find(item_instance_id)
        .ok_or_else(|| format!("Inventory item with instance ID {} not found.", item_instance_id))?;

    let item_def = item_defs.id().find(item_to_make_active.item_def_id)
        .ok_or_else(|| format!("Item definition {} not found for item instance {}.", item_to_make_active.item_def_id, item_instance_id))?;

    // --- Validate Item Location & Ownership ---
    // Item must be in player's inventory or hotbar to be made active.
    match &item_to_make_active.location {
        ItemLocation::Inventory(crate::models::InventoryLocationData { owner_id, .. }) |
        ItemLocation::Hotbar(crate::models::HotbarLocationData { owner_id, .. }) => {
            // Check ownership
            if *owner_id != sender_id {
                return Err("Cannot activate an item you don't possess.".to_string());
            }
            // If item is a tool or weapon, allow activation
            if item_def.category == ItemCategory::Tool { // ItemCategory::Weapon removed
                // Valid location and type for activation
            } else {
                return Err(format!("Item '{}' (category {:?}) is not a tool and cannot be activated in hand.", item_def.name, item_def.category));
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
        log::debug!("Item {} is already the active item for player {:?}. No change to ActiveEquipment needed.", item_instance_id, sender_id);
        return Ok(());
    }
    
    if let Some(old_active_id) = equipment.equipped_item_instance_id {
        if old_active_id != item_instance_id {
             log::info!("Player {:?} changing active item from {} to {}.", sender_id, old_active_id, item_instance_id);
        }
    }

    equipment.equipped_item_def_id = Some(item_def.id);
    equipment.equipped_item_instance_id = Some(item_instance_id);
    equipment.swing_start_time_ms = 0;
    equipment.icon_asset_name = Some(item_def.icon_asset_name.clone());

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

    log::info!("Player {:?} set active item to: {} (Instance ID: {}). Item remains in location: {:?}",
        sender_id, item_def.name, item_instance_id, item_to_make_active.location);

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
            log::info!("Player {:?} cleared active item (was instance ID: {:?}, def ID: {:?}).", 
                     player_identity, equipment.equipped_item_instance_id, equipment.equipped_item_def_id);
            
            equipment.equipped_item_def_id = None;
            equipment.equipped_item_instance_id = None;
            equipment.swing_start_time_ms = 0;
            equipment.icon_asset_name = None; // <<< CLEAR icon name
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

    // Get RNG from context
    let mut rng = rand::rngs::StdRng::from_rng(ctx.rng()).map_err(|e| format!("Failed to create RNG: {}",e))?;

    let player = players_table.identity().find(sender_id)
        .ok_or_else(|| "Player not found".to_string())?;
    let current_equipment = active_equipments.player_identity().find(sender_id)
        .ok_or_else(|| "No active equipment record found.".to_string())?;

    let equipped_item_instance_id = current_equipment.equipped_item_instance_id
        .ok_or_else(|| "No item instance ID in active equipment to use.".to_string())?;
    let item_def_id = current_equipment.equipped_item_def_id
        .ok_or_else(|| "No item definition ID in active equipment to use.".to_string())?;
    let item_def = item_defs.id().find(item_def_id)
        .ok_or_else(|| "Equipped item definition not found".to_string())?;

    // --- BEGIN BANDAGE HANDLING ---
    if item_def.name == "Bandage" {
        log::info!("[UseEquippedItem] Player {:?} is using an equipped Bandage (Instance: {}, Def: {}).", 
            sender_id, equipped_item_instance_id, item_def.id);

        // Check for existing active BandageBurst effect from ANY bandage item to prevent stacking this specific effect type.
        let has_active_bandage_burst_effect = ctx.db.active_consumable_effect().iter().any(|effect| {
            effect.player_id == sender_id && 
            effect.effect_type == EffectType::BandageBurst 
            // We don't need to check effect.item_def_id == item_def.id here, 
            // as we just want to prevent any BandageBurst from stacking, regardless of specific bandage type if we had multiple.
        });

        if has_active_bandage_burst_effect {
            log::warn!("[UseEquippedItem] Player {:?} tried to use Bandage while another BandageBurst effect is already active.", sender_id);
            return Err("You are already applying a bandage.".to_string());
        }

        // Player state is needed for apply_item_effects_and_consume (though it won't change health directly for BandageBurst)
        // and for last_consumed_at update.
        let mut player_stats = players_table.identity().find(sender_id)
            .ok_or_else(|| "Player not found for bandage use".to_string())?;
        
        // This will create the BandageBurst effect. Item is NOT consumed here.
        match apply_item_effects_and_consume(ctx, sender_id, &item_def, equipped_item_instance_id, &mut player_stats) {
            Ok(_) => {
                // Update player for last_consumed_at (which is set by apply_item_effects_and_consume)
                players_table.identity().update(player_stats); 
                
                log::info!("[UseEquippedItem] BandageBurst effect initiated for player {:?} with bandage instance {}.", 
                    sender_id, equipped_item_instance_id);
                // No change to current_equipment is needed here as item is not consumed yet and bandaging_start_time_ms is removed.
                // The active_equipments table also doesn't need an update here just for using a bandage.
            },
            Err(e) => {
                log::error!("[UseEquippedItem] Failed to apply bandage effects for player {:?}: {}", sender_id, e);
                return Err(format!("Failed to apply bandage effects: {}", e));
            }
        }
        return Ok(()); // Bandage handling complete
    }
    // --- END BANDAGE HANDLING ---

    // Default values for attack cone
    let mut actual_attack_range = PLAYER_RADIUS * 4.0;
    let mut actual_attack_angle_degrees = 90.0;

    // Check if the item is a Wooden Spear and adjust its properties
    if item_def.name == "Wooden Spear" {
        // Spears have a longer range and a narrower cone for a thrust-like attack
        actual_attack_range = PLAYER_RADIUS * 6.0; // Further increased range for better standoff
        actual_attack_angle_degrees = 30.0;      // Narrow 30-degree cone for thrust
        log::debug!("Wooden Spear detected: Using custom range {:.1}, angle {:.1}", actual_attack_range, actual_attack_angle_degrees);
    }

    let mut current_equipment_mut = current_equipment.clone(); // Clone to modify for swing time
    current_equipment_mut.swing_start_time_ms = now_ms;
    active_equipments.player_identity().update(current_equipment_mut); // Update with new swing time

    log::debug!("[UseEquippedItem] Player {:?} started using non-bandage item '{}' (ID: {}). Swing time set.",
             sender_id, item_def.name, item_def_id);
    
    let targets = find_targets_in_cone(ctx, &player, actual_attack_range, actual_attack_angle_degrees);
    
    if let Some(target) = find_best_target(&targets, &item_def) {
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

    let mut item_to_equip = inventory_items.instance_id().find(item_instance_id)
        .ok_or_else(|| format!("Item instance {} not found.", item_instance_id))?;

    match &item_to_equip.location {
        ItemLocation::Inventory(crate::models::InventoryLocationData { owner_id, .. }) |
        ItemLocation::Hotbar(crate::models::HotbarLocationData { owner_id, .. }) => {
            if *owner_id != sender_id {
                return Err("Cannot equip item not in your inventory/hotbar.".to_string());
            }
        }
        _ => return Err("Item to equip must be in player inventory or hotbar.".to_string()),
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
