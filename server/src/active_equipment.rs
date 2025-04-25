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

// Combat system imports
use crate::combat::{
    PVP_DAMAGE_MULTIPLIER, RESOURCE_RESPAWN_DURATION_SECS, RESPAWN_TIME_MS,
    find_targets_in_cone, find_best_target, process_attack
};

// Collision constants
use crate::tree::{TREE_COLLISION_Y_OFFSET, PLAYER_TREE_COLLISION_DISTANCE_SQUARED};
use crate::stone::{STONE_COLLISION_Y_OFFSET, PLAYER_STONE_COLLISION_DISTANCE_SQUARED};

// Core game types
use crate::Player;
use crate::PLAYER_RADIUS;
use crate::items::{InventoryItem, ItemDefinition, ItemCategory, EquipmentSlot};

// Table trait imports for database access
use crate::tree::tree as TreeTableTrait;
use crate::stone::stone as StoneTableTrait;
use crate::items::item_definition as ItemDefinitionTableTrait;
use crate::items::inventory_item as InventoryItemTableTrait;
use crate::player as PlayerTableTrait;
use crate::active_equipment as ActiveEquipmentTableTrait;

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
    pub swing_start_time_ms: u64, // Timestamp (ms) when the current swing started, 0 if not swinging
    // Fields for worn armor
    pub head_item_instance_id: Option<u64>,
    pub chest_item_instance_id: Option<u64>,
    pub legs_item_instance_id: Option<u64>,
    pub feet_item_instance_id: Option<u64>,
    pub hands_item_instance_id: Option<u64>,
    pub back_item_instance_id: Option<u64>,
}

/// Equips an item from inventory to the player's main hand
///
/// Finds the specified item in the player's inventory and moves it to the main hand slot.
/// If the item is not equippable (or is armor), it clears the main hand slot instead.
#[spacetimedb::reducer]
pub fn equip_item(ctx: &ReducerContext, item_instance_id: u64) -> Result<(), String> {
    let sender_id = ctx.sender;
    let inventory_items = ctx.db.inventory_item();
    let item_defs = ctx.db.item_definition();
    let active_equipments = ctx.db.active_equipment();

    // Find the inventory item
    let item_to_equip = inventory_items.instance_id().find(item_instance_id)
        .ok_or_else(|| format!("Inventory item with instance ID {} not found.", item_instance_id))?;

    // Verify the item belongs to the sender
    if item_to_equip.player_identity != sender_id {
        return Err("Cannot equip an item that does not belong to you.".to_string());
    }

    // Find the item definition
    let item_def = item_defs.id().find(item_to_equip.item_def_id)
        .ok_or_else(|| format!("Item definition {} not found.", item_to_equip.item_def_id))?;

    // --- Get existing equipment or create default ---
    let mut equipment = get_or_create_active_equipment(ctx, sender_id)?;

    // Check if item is actually equippable using the field from ItemDefinition
    if !item_def.is_equippable || item_def.category == ItemCategory::Armor {
        // If not equippable OR if it's armor (handled by equip_armor), clear the main hand slot.
        log::info!("Player {:?} selected non-tool/weapon item {} or armor {}. Clearing main hand.", sender_id, item_def.name, item_instance_id);
        equipment.equipped_item_def_id = None;
        equipment.equipped_item_instance_id = None;
        equipment.swing_start_time_ms = 0;
        active_equipments.player_identity().update(equipment);
        return Ok(());
    }

    // --- Update the main hand equipment entry ---
    // Only update the fields related to the main hand item. Armor slots remain untouched.
    equipment.equipped_item_def_id = Some(item_def.id);
    equipment.equipped_item_instance_id = Some(item_instance_id);
    equipment.swing_start_time_ms = 0; // Reset swing state when equipping

    active_equipments.player_identity().update(equipment); // Update the existing row
    log::info!("Player {:?} equipped item: {} (Instance ID: {}) to hotbar", sender_id, item_def.name, item_instance_id);

    Ok(())
}

/// Unequips whatever item is currently in the player's main hand
///
/// Clears the main hand slot for the specified player, if they have an item equipped.
#[spacetimedb::reducer]
pub fn unequip_item(ctx: &ReducerContext, player_identity: Identity) -> Result<(), String> {
    let active_equipments = ctx.db.active_equipment();

    if let Some(mut equipment) = active_equipments.player_identity().find(player_identity) {
        // Only clear the hotbar fields. Leave armor slots untouched.
        if equipment.equipped_item_instance_id.is_some() {
             log::info!("Player {:?} explicitly unequipped hotbar item.", player_identity);
             equipment.equipped_item_def_id = None;
             equipment.equipped_item_instance_id = None;
             equipment.swing_start_time_ms = 0;
             active_equipments.player_identity().update(equipment);
        }
    } else {
        log::info!("Player {:?} tried to unequip, but no ActiveEquipment row found.", player_identity);
        // No row exists, so nothing to unequip. Not an error.
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

    // Get tables
    let active_equipments = ctx.db.active_equipment();
    let players = ctx.db.player();
    let item_defs = ctx.db.item_definition();

    // --- Get Player and Equipment Info ---
    let player = players.identity().find(sender_id)
        .ok_or_else(|| "Player not found".to_string())?;
    let mut current_equipment = active_equipments.player_identity().find(sender_id)
        .ok_or_else(|| "No active equipment record found.".to_string())?;

    let item_def_id = current_equipment.equipped_item_def_id
        .ok_or_else(|| "No item equipped to use.".to_string())?;
    let item_def = item_defs.id().find(item_def_id)
        .ok_or_else(|| "Equipped item definition not found".to_string())?;

    // --- Update Swing Time ---
    current_equipment.swing_start_time_ms = now_ms;
    active_equipments.player_identity().update(current_equipment.clone()); // Update swing time regardless of hitting anything
    log::debug!("Player {:?} started using item '{}' (ID: {})",
             sender_id, item_def.name, item_def_id);

    // --- Get Item Damage ---
    let item_damage = match item_def.damage {
        Some(dmg) if dmg > 0 => dmg,
        _ => return Ok(()), // Item has no damage, nothing more to do
    };

    // --- Attack Logic ---
    let attack_range = PLAYER_RADIUS * 4.0; // Increased range further
    let attack_angle_degrees = 90.0; // Widen attack arc to 90 degrees
    
    // Find potential targets using the combat module
    let targets = find_targets_in_cone(ctx, &player, attack_range, attack_angle_degrees);
    
    // Determine the best target based on weapon type
    if let Some(target) = find_best_target(&targets, &item_def.name) {
        // Process the attack using the combat module
        match process_attack(ctx, sender_id, &target, &item_def, now_ts) {
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
            equipped_item_def_id: None, // Initialize hand slot
            equipped_item_instance_id: None,
            swing_start_time_ms: 0,
            // Initialize all armor slots to None
            head_item_instance_id: None,
            chest_item_instance_id: None,
            legs_item_instance_id: None,
            feet_item_instance_id: None,
            hands_item_instance_id: None,
            back_item_instance_id: None,
        };
        table.insert(new_equip.clone()); // Insert returns nothing useful here
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

    // 1. Get the InventoryItem being equipped
    let mut item_to_equip = ctx.db.inventory_item().iter()
        .find(|i| i.instance_id == item_instance_id && i.player_identity == sender_id)
        .ok_or_else(|| format!("Item instance {} not found or not owned.", item_instance_id))?;
    let source_inv_slot = item_to_equip.inventory_slot; // Store original location
    let source_hotbar_slot = item_to_equip.hotbar_slot; // Store original location

    // 2. Get its ItemDefinition
    let item_def = ctx.db.item_definition().iter()
        .find(|def| def.id == item_to_equip.item_def_id)
        .ok_or_else(|| format!("Definition not found for item ID {}", item_to_equip.item_def_id))?;

    // 3. Validate: Must be Armor category and have a defined equipment_slot
    if item_def.category != ItemCategory::Armor {
        return Err(format!("Item '{}' is not Armor.", item_def.name));
    }
    let target_slot_type = item_def.equipment_slot
        .clone() // Clone the Option<EquipmentSlot>
        .ok_or_else(|| format!("Armor '{}' does not have a defined equipment slot.", item_def.name))?;

    // 4. Find or create the player's ActiveEquipment row
    let mut active_equipment = get_or_create_active_equipment(ctx, sender_id)?;

    // 5. Check if the target slot is already occupied & get old item ID
    let old_item_instance_id_opt = match target_slot_type {
         EquipmentSlot::Head => active_equipment.head_item_instance_id.take(), // .take() retrieves value and sets field to None
         EquipmentSlot::Chest => active_equipment.chest_item_instance_id.take(),
         EquipmentSlot::Legs => active_equipment.legs_item_instance_id.take(),
         EquipmentSlot::Feet => active_equipment.feet_item_instance_id.take(),
         EquipmentSlot::Hands => active_equipment.hands_item_instance_id.take(),
         EquipmentSlot::Back => active_equipment.back_item_instance_id.take(),
    };

    // 6. If occupied, move the old item back to the source slot of the item being equipped
    if let Some(old_item_instance_id) = old_item_instance_id_opt {
        log::info!("Slot {:?} was occupied by item {}. Moving it back to source slot (Inv: {:?}, Hotbar: {:?}).", 
                 target_slot_type, old_item_instance_id, source_inv_slot, source_hotbar_slot);
                 
        if let Some(mut old_item) = ctx.db.inventory_item().instance_id().find(old_item_instance_id) {
            old_item.inventory_slot = source_inv_slot; 
            old_item.hotbar_slot = source_hotbar_slot;
            ctx.db.inventory_item().instance_id().update(old_item);
        } else {
            // This shouldn't happen if data is consistent, but log an error if it does
            log::error!("Failed to find InventoryItem for previously equipped armor (ID: {})!", old_item_instance_id);
        }
    } else {
         log::info!("Slot {:?} was empty.", target_slot_type);
    }

    // 7. Update ActiveEquipment row with the new item ID in the correct slot
    match target_slot_type {
         EquipmentSlot::Head => active_equipment.head_item_instance_id = Some(item_instance_id),
         EquipmentSlot::Chest => active_equipment.chest_item_instance_id = Some(item_instance_id),
         EquipmentSlot::Legs => active_equipment.legs_item_instance_id = Some(item_instance_id),
         EquipmentSlot::Feet => active_equipment.feet_item_instance_id = Some(item_instance_id),
         EquipmentSlot::Hands => active_equipment.hands_item_instance_id = Some(item_instance_id),
         EquipmentSlot::Back => active_equipment.back_item_instance_id = Some(item_instance_id),
         // Note: The .take() above already cleared the field, so we just set the new value
    };
    ctx.db.active_equipment().player_identity().update(active_equipment); // Save ActiveEquipment changes

    // 8. Update the InventoryItem being equipped (remove from inventory/hotbar)
    item_to_equip.inventory_slot = None;
    item_to_equip.hotbar_slot = None;
    ctx.db.inventory_item().instance_id().update(item_to_equip);

    log::info!("Successfully equipped armor '{}' (ID: {}) to slot {:?}", 
             item_def.name, item_instance_id, target_slot_type);
             
    Ok(())
}
