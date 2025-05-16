use spacetimedb::{ReducerContext, SpacetimeType, Table};
use log;
// Import ActiveEquipment table definition
// use crate::active_equipment::{ActiveEquipment};
// ADD generated table trait import with alias
use crate::active_equipment::active_equipment as ActiveEquipmentTableTrait;
// Import Campfire table trait
use crate::campfire::campfire as CampfireTableTrait;
// Import Player table trait
use crate::player as PlayerTableTrait;
// Import DroppedItem helpers
use crate::dropped_item::{calculate_drop_position, create_dropped_item_entity};
// REMOVE unused concrete table type imports
// use crate::items::{InventoryItemTable, ItemDefinitionTable};
use crate::items_database; // ADD import for new module
use std::cmp::min;
use spacetimedb::Identity; // ADDED for add_item_to_player_inventory
// Import the ContainerItemClearer trait
use crate::inventory_management::ContainerItemClearer;
// Import the function that was moved
use crate::player_inventory::move_item_to_hotbar;
use crate::player_inventory::move_item_to_inventory;
// Import helper used locally
use crate::player_inventory::find_first_empty_inventory_slot; 
use crate::models::{ItemLocation, EquipmentSlotType, TargetType}; // <<< UPDATED IMPORT
use std::collections::HashSet;
use serde::{Deserialize, Serialize};
use crate::campfire::CampfireClearer; 
use crate::wooden_storage_box::WoodenStorageBoxClearer;
use crate::player_corpse::PlayerCorpseClearer;
use crate::stash::StashClearer; // Added StashClearer import

// --- Item Enums and Structs ---

// Define categories or types for items
#[derive(Clone, Debug, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize, SpacetimeType)]
pub enum ItemCategory {
    Tool,
    Material,
    Placeable,
    Armor,
    Consumable,
    Ammunition, // Added Ammunition as per previous user feedback, ensure it's used or remove if not
    // Add other categories as needed (Consumable, Wearable, etc.)
}

#[derive(SpacetimeType, Clone, Debug, Serialize, Deserialize)] // Added Serialize, Deserialize
pub struct CostIngredient {
    pub item_name: String,
    pub quantity: u32,
}

#[spacetimedb::table(name = item_definition, public)]
#[derive(Clone, Debug)] // Removed SpacetimeType, Serialize, Deserialize here as it's a table
                       // It will get them from the #[table] macro automatically.
pub struct ItemDefinition {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub name: String,          // Unique name used as an identifier too?
    pub description: String,   // Optional flavor text
    pub category: ItemCategory,
    pub icon_asset_name: String, // e.g., "stone_hatchet.png", used by client
    pub is_stackable: bool,    // Can multiple instances exist in one inventory slot?
    pub stack_size: u32,       // Max number per stack (if stackable)
    pub is_equippable: bool,   // Can this item be equipped (in hand OR on body)?
    pub equipment_slot_type: Option<EquipmentSlotType>, // <-- ADD THIS. Ensure EquipmentSlotType is imported from models.rs
    pub fuel_burn_duration_secs: Option<f32>, // How long one unit of this fuel lasts. If Some, it's fuel.

    // New fields for detailed damage and yield
    pub primary_target_damage_min: Option<u32>,
    pub primary_target_damage_max: Option<u32>,
    pub primary_target_yield_min: Option<u32>,
    pub primary_target_yield_max: Option<u32>,
    pub primary_target_type: Option<TargetType>,
    pub primary_yield_resource_name: Option<String>,

    pub secondary_target_damage_min: Option<u32>,
    pub secondary_target_damage_max: Option<u32>,
    pub secondary_target_yield_min: Option<u32>,
    pub secondary_target_yield_max: Option<u32>,
    pub secondary_target_type: Option<TargetType>,
    pub secondary_yield_resource_name: Option<String>,

    pub pvp_damage_min: Option<u32>,
    pub pvp_damage_max: Option<u32>,

    pub bleed_damage_per_tick: Option<f32>, // ADDED
    pub bleed_duration_seconds: Option<f32>, // ADDED
    pub bleed_tick_interval_seconds: Option<f32>, // ADDED

    pub crafting_cost: Option<Vec<CostIngredient>>, // MODIFIED HERE
    pub crafting_output_quantity: Option<u32>,      // How many items this recipe produces
    pub crafting_time_secs: Option<u32>,            // Time in seconds to craft

    // Consumable Effects
    pub consumable_health_gain: Option<f32>,
    pub consumable_hunger_satiated: Option<f32>,
    pub consumable_thirst_quenched: Option<f32>,
    pub consumable_stamina_gain: Option<f32>,
    pub consumable_duration_secs: Option<f32>, // For effects over time, 0 or None for instant
    pub cook_time_secs: Option<f32>, // ADDED
    pub cooked_item_def_name: Option<String>, // ADDED
}

// --- Inventory Table ---

// Represents an instance of an item in a player's inventory
#[spacetimedb::table(name = inventory_item, public)]
#[derive(Clone, Debug)]
pub struct InventoryItem {
    #[primary_key]
    #[auto_inc]
    pub instance_id: u64,      // Unique ID for this specific item instance
    pub item_def_id: u64,      // Links to ItemDefinition table (FK)
    pub quantity: u32,         // How many of this item
    pub location: ItemLocation, // <<< NEW FIELD ADDED
    // Add other instance-specific data later (e.g., current_durability)
}

// --- Item Reducers ---

// Reducer to seed initial item definitions if the table is empty
#[spacetimedb::reducer]
pub fn seed_items(ctx: &ReducerContext) -> Result<(), String> {
    let items = ctx.db.item_definition();
    if items.iter().count() > 0 {
        log::info!("Item definitions already seeded ({}). Skipping.", items.iter().count());
        return Ok(());
    }

    log::info!("Seeding initial item definitions...");

    let initial_items = items_database::get_initial_item_definitions(); // REPLACE vector literal with function call

    let mut seeded_count = 0;
    for item_def in initial_items {
        match items.try_insert(item_def) {
            Ok(_) => seeded_count += 1,
            Err(e) => log::error!("Failed to insert item definition during seeding: {}", e),
        }
    }

    log::info!("Finished seeding {} item definitions.", seeded_count);
    Ok(())
}

// --- Inventory Management Reducers ---

// Helper to find an item instance owned by the caller
pub(crate) fn get_player_item(ctx: &ReducerContext, instance_id: u64) -> Result<InventoryItem, String> {
    ctx.db
        .inventory_item().iter()
        .find(|i| i.instance_id == instance_id && i.location.is_player_bound() == Some(ctx.sender))
        .ok_or_else(|| format!("Item instance {} not found or not owned by caller.", instance_id))
}

// Helper to find an item occupying a specific inventory slot for the caller
fn find_item_in_inventory_slot(ctx: &ReducerContext, slot: u16) -> Option<InventoryItem> {
    ctx.db
        .inventory_item().iter()
        .find(|i| match &i.location { 
            ItemLocation::Inventory(data) => data.owner_id == ctx.sender && data.slot_index == slot,
            _ => false,
        })
}

// Helper to find an item occupying a specific hotbar slot for the caller
fn find_item_in_hotbar_slot(ctx: &ReducerContext, slot: u8) -> Option<InventoryItem> {
    ctx.db
        .inventory_item().iter()
        .find(|i| match &i.location { 
            ItemLocation::Hotbar(data) => data.owner_id == ctx.sender && data.slot_index == slot,
            _ => false,
        })
}

// Helper function to find an empty slot for a player (hotbar preferred, then inventory)
// Returns ItemLocation pointing to the empty slot, or None if all full.
fn find_empty_slot_for_player(
    ctx: &ReducerContext, 
    player_id: Identity,
    // inventory_items: &(impl inventory_item + Table), // Removed direct table pass
) -> Option<ItemLocation> {
    // Check Hotbar first
    let occupied_hotbar_slots: HashSet<u8> = ctx.db.inventory_item().iter() // Use ctx.db directly
        .filter_map(|item| match &item.location { 
            ItemLocation::Hotbar(crate::models::HotbarLocationData { owner_id: item_owner_id, slot_index }) if *item_owner_id == player_id => Some(*slot_index),
            _ => None,
        })
        .collect();

    for i in 0..crate::player_inventory::NUM_PLAYER_HOTBAR_SLOTS {
        if !occupied_hotbar_slots.contains(&i) {
            return Some(ItemLocation::Hotbar(crate::models::HotbarLocationData { owner_id: player_id, slot_index: i }));
        }
    }

    // Then check Inventory
    let occupied_inventory_slots: HashSet<u16> = ctx.db.inventory_item().iter() // Use ctx.db directly
        .filter_map(|item| match &item.location {
            ItemLocation::Inventory(crate::models::InventoryLocationData { owner_id: item_owner_id, slot_index }) if *item_owner_id == player_id => Some(*slot_index),
            _ => None,
        })
        .collect();

    for i in 0..crate::player_inventory::NUM_PLAYER_INVENTORY_SLOTS {
        if !occupied_inventory_slots.contains(&i) {
            return Some(ItemLocation::Inventory(crate::models::InventoryLocationData { owner_id: player_id, slot_index: i }));
        }
    }
    None // No empty slots
}

// Helper to add an item to inventory, prioritizing hotbar for stacking and new slots.
// Called when items are gathered/added directly (e.g., picking mushrooms, gathering resources).
pub(crate) fn add_item_to_player_inventory(ctx: &ReducerContext, player_id: Identity, item_def_id: u64, quantity: u32) -> Result<Option<u64>, String> {
    let inventory = ctx.db.inventory_item();
    let item_defs = ctx.db.item_definition();
    let mut remaining_quantity = quantity;

    let item_def = item_defs.id().find(item_def_id)
        .ok_or_else(|| format!("Item definition {} not found", item_def_id))?;

    if item_def.is_stackable && remaining_quantity > 0 {
        let mut items_to_update: Vec<InventoryItem> = Vec::new();

        for mut item in inventory.iter().filter(|i| 
            match &i.location {
                ItemLocation::Hotbar(data) => data.owner_id == player_id && i.item_def_id == item_def_id,
                _ => false,
            }
        ) {
            let space_available = item_def.stack_size.saturating_sub(item.quantity);
            if space_available > 0 {
                let transfer_qty = std::cmp::min(remaining_quantity, space_available);
                item.quantity += transfer_qty;
                remaining_quantity -= transfer_qty;
                items_to_update.push(item.clone());
                if remaining_quantity == 0 { break; }
            }
        }

        if remaining_quantity > 0 {
            for mut item in inventory.iter().filter(|i| 
                match &i.location {
                    ItemLocation::Inventory(data) => data.owner_id == player_id && i.item_def_id == item_def_id,
                    _ => false,
                }
            ) {
                let space_available = item_def.stack_size.saturating_sub(item.quantity);
                if space_available > 0 {
                    let transfer_qty = std::cmp::min(remaining_quantity, space_available);
                    item.quantity += transfer_qty;
                    remaining_quantity -= transfer_qty;
                    items_to_update.push(item.clone());
                    if remaining_quantity == 0 { break; }
                }
            }
        }
        for item in items_to_update {
             inventory.instance_id().update(item);
        }
        if remaining_quantity == 0 {
            log::info!("[AddItem] Fully stacked {} of item def {} for player {:?}.", quantity, item_def_id, player_id);
            return Ok(None); // Items stacked, no new instance ID
        }
    }

    if remaining_quantity > 0 {
        let final_quantity_to_add = if item_def.is_stackable { remaining_quantity } else { 1 };

        let occupied_hotbar_slots: HashSet<u8> = inventory.iter()
            .filter_map(|i| match &i.location {
                ItemLocation::Hotbar(data) if data.owner_id == player_id => Some(data.slot_index),
                _ => None,
            })
            .collect();

        if let Some(empty_hotbar_slot) = (0..crate::player_inventory::NUM_PLAYER_HOTBAR_SLOTS as u8).find(|slot| !occupied_hotbar_slots.contains(slot)) {
            let new_item = InventoryItem {
                instance_id: 0, 
                item_def_id,
                quantity: final_quantity_to_add,
                location: ItemLocation::Hotbar(crate::models::HotbarLocationData { owner_id: player_id, slot_index: empty_hotbar_slot }),
            };
            let inserted_item = inventory.insert(new_item);
            log::info!("[AddItem] Added {} of item def {} to hotbar slot {} for player {:?}. New ID: {}",
                     final_quantity_to_add, item_def_id, empty_hotbar_slot, player_id, inserted_item.instance_id);
            return Ok(Some(inserted_item.instance_id));
        } else {
            let occupied_inventory_slots: HashSet<u16> = inventory.iter()
                .filter_map(|i| match &i.location {
                    ItemLocation::Inventory(data) if data.owner_id == player_id => Some(data.slot_index),
                    _ => None,
                })
                .collect();

            if let Some(empty_inventory_slot) = (0..crate::player_inventory::NUM_PLAYER_INVENTORY_SLOTS as u16).find(|slot| !occupied_inventory_slots.contains(slot)) {
                let new_item = InventoryItem {
                    instance_id: 0, 
                    item_def_id,
                    quantity: final_quantity_to_add,
                    location: ItemLocation::Inventory(crate::models::InventoryLocationData { owner_id: player_id, slot_index: empty_inventory_slot }),
                };
                let inserted_item = inventory.insert(new_item);
                log::info!("[AddItem] Added {} of item def {} to inventory slot {} for player {:?}. (Hotbar was full) New ID: {}",
                         final_quantity_to_add, item_def_id, empty_inventory_slot, player_id, inserted_item.instance_id);
                return Ok(Some(inserted_item.instance_id));
            } else {
                log::error!("[AddItem] No empty hotbar or inventory slots for player {:?} to add item def {}.", player_id, item_def_id);
                return Err("Inventory is full".to_string());
            }
        }
    } else {
         log::debug!("[AddItem] Stacking completed successfully for item def {} for player {:?}. No new slot needed.", item_def_id, player_id);
         Ok(None) // Stacking completed, no new instance ID
    }
}

// Helper to clear a specific item instance from any equipment slot it might occupy
pub(crate) fn clear_specific_item_from_equipment_slots(ctx: &ReducerContext, player_id: spacetimedb::Identity, item_instance_id_to_clear: u64) {
    let active_equip_table = ctx.db.active_equipment();
    // Use try_find to avoid panic if player has no equipment entry yet
    if let Some(mut equip) = active_equip_table.player_identity().find(player_id) {
        let mut updated = false;

        // DO NOT Check main hand here anymore - this is handled by clear_active_item_reducer
        // if equip.equipped_item_instance_id == Some(item_instance_id_to_clear) {
        //      equip.equipped_item_instance_id = None;
        //      equip.equipped_item_def_id = None;
        //      equip.swing_start_time_ms = 0;
        //      updated = true;
        //      log::debug!("[ClearEquip] Removed item {} from main hand slot for player {:?}", item_instance_id_to_clear, player_id);
        // }
        
        // Check armor slots
        if equip.head_item_instance_id == Some(item_instance_id_to_clear) {
            equip.head_item_instance_id = None;
            updated = true;
            log::debug!("[ClearEquip] Removed item {} from Head slot for player {:?}", item_instance_id_to_clear, player_id);
        }
        if equip.chest_item_instance_id == Some(item_instance_id_to_clear) {
            equip.chest_item_instance_id = None;
            updated = true;
            log::debug!("[ClearEquip] Removed item {} from Chest slot for player {:?}", item_instance_id_to_clear, player_id);
        }
        if equip.legs_item_instance_id == Some(item_instance_id_to_clear) {
            equip.legs_item_instance_id = None;
            updated = true;
            log::debug!("[ClearEquip] Removed item {} from Legs slot for player {:?}", item_instance_id_to_clear, player_id);
        }
        if equip.feet_item_instance_id == Some(item_instance_id_to_clear) {
            equip.feet_item_instance_id = None;
            updated = true;
            log::debug!("[ClearEquip] Removed item {} from Feet slot for player {:?}", item_instance_id_to_clear, player_id);
        }
        if equip.hands_item_instance_id == Some(item_instance_id_to_clear) {
            equip.hands_item_instance_id = None;
            updated = true;
            log::debug!("[ClearEquip] Removed item {} from Hands slot for player {:?}", item_instance_id_to_clear, player_id);
        }
        if equip.back_item_instance_id == Some(item_instance_id_to_clear) {
            equip.back_item_instance_id = None;
            updated = true;
            log::debug!("[ClearEquip] Removed item {} from Back slot for player {:?}", item_instance_id_to_clear, player_id);
        }

        if updated {
            active_equip_table.player_identity().update(equip);
        }
    } else {
        // This is not necessarily an error, player might not have equipment entry yet
        log::debug!("[ClearEquip] No ActiveEquipment found for player {:?} when trying to clear item {}.", player_id, item_instance_id_to_clear);
    }
}

// Clears an item from any known container type that might hold it.
// This is a broader cleanup function, typically called when an item is being
// definitively removed from the game or its location becomes truly unknown.
pub(crate) fn clear_item_from_any_container(ctx: &ReducerContext, item_instance_id: u64) {
    // Attempt to clear from Campfire fuel slots
    if CampfireClearer::clear_item(ctx, item_instance_id) {
        log::debug!("[ItemsClear] Item {} cleared from a campfire.", item_instance_id);
        return; // Item found and handled
    }

    // Attempt to clear from WoodenStorageBox slots
    if WoodenStorageBoxClearer::clear_item(ctx, item_instance_id) {
        log::debug!("[ItemsClear] Item {} cleared from a wooden storage box.", item_instance_id);
        return; // Item found and handled
    }

    // Attempt to clear from PlayerCorpse slots
    if PlayerCorpseClearer::clear_item(ctx, item_instance_id) {
        log::debug!("[ItemsClear] Item {} cleared from a player corpse.", item_instance_id);
        return; // Item found and handled
    }
    
    // Attempt to clear from Stash slots
    if StashClearer::clear_item(ctx, item_instance_id) {
        log::debug!("[ItemsClear] Item {} cleared from a stash.", item_instance_id);
        return; // Item found and handled
    }

    // If we reach here, the item was not found in any of the explicitly checked containers.
    // The item's own `location` field might be stale or point to a player inventory/hotbar/equipment,
    // which this function is not designed to clear directly.
    log::debug!("[ItemsClear] Item {} was not found in any known clearable container types by clear_item_from_any_container.", item_instance_id);
}

// Clears an item from equipment OR container slots based on its state
// This should be called *before* modifying or deleting the InventoryItem itself.
fn clear_item_from_source_location(ctx: &ReducerContext, item_instance_id: u64) -> Result<(), String> {
    let sender_id = ctx.sender;
    let item_opt = ctx.db.inventory_item().instance_id().find(item_instance_id);
    if item_opt.is_none() {
        log::debug!("[ClearSource] Item {} already gone. No clearing needed.", item_instance_id);
        return Ok(());
    }
    let item = item_opt.unwrap();
    let was_equipped = matches!(&item.location, ItemLocation::Equipped(_)); 
    let was_in_container = matches!(&item.location, ItemLocation::Container(_));

    if was_equipped {
        clear_specific_item_from_equipment_slots(ctx, sender_id, item_instance_id);
        log::debug!("[ClearSource] Attempted clearing item {} from equipment slots for player {:?}", item_instance_id, sender_id);
    } else if was_in_container {
        clear_item_from_any_container(ctx, item_instance_id);
        log::debug!("[ClearSource] Attempted clearing item {} from container slots.", item_instance_id);
    } else {
        log::debug!("[ClearSource] Item {} was in player inventory/hotbar. No equipment/container clearing needed.", item_instance_id);
    }

    Ok(())
}

// Reducer to equip armor from a drag-and-drop operation
#[spacetimedb::reducer]
pub fn equip_armor_from_drag(ctx: &ReducerContext, item_instance_id: u64, target_slot_name: String) -> Result<(), String> {
    log::info!("[EquipArmorDrag] Attempting to equip item {} to slot {}", item_instance_id, target_slot_name);
    let sender_id = ctx.sender; // Get sender early
    let inventory_items = ctx.db.inventory_item(); // Need table access

    // 1. Get Item and Definition (Fetch directly, don't assume player ownership yet)
    let mut item_to_equip = inventory_items.instance_id().find(item_instance_id)
        .ok_or_else(|| format!("Item instance {} not found.", item_instance_id))?;
    let item_def = ctx.db.item_definition().id().find(item_to_equip.item_def_id)
        .ok_or_else(|| format!("Definition not found for item ID {}", item_to_equip.item_def_id))?;

    // --- Store original location type --- 
    let original_location = item_to_equip.location.clone(); // Clone to avoid borrow issues
    let came_from_player_direct_possession = matches!(&original_location, ItemLocation::Inventory(_) | ItemLocation::Hotbar(_));

    // --- Validations --- 
    // Basic ownership check: Player must own it if it came from inv/hotbar
    if came_from_player_direct_possession {
        if item_to_equip.location.is_player_bound() != Some(sender_id) {
             return Err(format!("Item {} in inventory/hotbar not owned by caller.", item_instance_id));
        }
    }
    // 1. Must be Armor category
    if item_def.category != ItemCategory::Armor {
        return Err(format!("Item '{}' is not armor.", item_def.name));
    }
    // 2. Must have a defined equipment slot
    let required_slot_enum = item_def.equipment_slot_type.ok_or_else(|| format!("Armor '{}' has no defined equipment slot in its definition.", item_def.name))?;
    // 3. Target slot name must match the item's defined equipment slot
    let target_slot_enum_model = match target_slot_name.as_str() {
        "Head" => EquipmentSlotType::Head,
        "Chest" => EquipmentSlotType::Chest,
        "Legs" => EquipmentSlotType::Legs,
        "Feet" => EquipmentSlotType::Feet,
        "Hands" => EquipmentSlotType::Hands,
        "Back" => EquipmentSlotType::Back,
        _ => return Err(format!("Invalid target equipment slot name: {}", target_slot_name)),
    };
    if required_slot_enum != target_slot_enum_model {
        return Err(format!("Cannot equip '{}' ({:?}) into {} slot ({:?}).", item_def.name, required_slot_enum, target_slot_name, target_slot_enum_model));
    }

    // --- Logic ---
    let active_equip_table = ctx.db.active_equipment();
    let mut equip = active_equip_table.player_identity().find(sender_id)
                     .ok_or_else(|| "ActiveEquipment entry not found for player.".to_string())?;

    // Check if something is already in the target slot and unequip it
    let current_item_in_slot: Option<u64> = match target_slot_enum_model {
        EquipmentSlotType::Head => equip.head_item_instance_id,
        EquipmentSlotType::Chest => equip.chest_item_instance_id,
        EquipmentSlotType::Legs => equip.legs_item_instance_id,
        EquipmentSlotType::Feet => equip.feet_item_instance_id,
        EquipmentSlotType::Hands => equip.hands_item_instance_id,
        EquipmentSlotType::Back => equip.back_item_instance_id,
    };

    if let Some(currently_equipped_id) = current_item_in_slot {
        if currently_equipped_id == item_instance_id { return Ok(()); } // Already equipped

        log::info!("[EquipArmorDrag] Unequipping item {} from slot {:?}", currently_equipped_id, target_slot_enum_model);
        // Try to move the currently equipped item to the first available inventory slot
        match find_first_empty_inventory_slot(ctx, sender_id) {
            Some(empty_slot_idx) => {
                if let Ok(mut currently_equipped_item_row) = get_player_item(ctx, currently_equipped_id) {
                    currently_equipped_item_row.location = ItemLocation::Inventory(crate::models::InventoryLocationData { owner_id: sender_id, slot_index: empty_slot_idx });
                    ctx.db.inventory_item().instance_id().update(currently_equipped_item_row);
                    log::info!("[EquipArmorDrag] Moved previously equipped item {} to inventory slot {}", currently_equipped_id, empty_slot_idx);
                } else {
                    log::error!("[EquipArmorDrag] Failed to find InventoryItem for previously equipped item {}!", currently_equipped_id);
                    // Continue anyway, clearing the slot, but log the error
                }
            }
            None => {
                log::error!("[EquipArmorDrag] Inventory full! Cannot unequip item {} from slot {:?}. Aborting equip.", currently_equipped_id, target_slot_enum_model);
                return Err("Inventory full, cannot unequip existing item.".to_string());
            }
        }
    }

    // Equip the new item
    log::info!("[EquipArmorDrag] Equipping item {} to slot {:?}", item_instance_id, target_slot_enum_model);
    let equipment_slot_type_for_location = target_slot_enum_model;

    match target_slot_enum_model {
        EquipmentSlotType::Head => equip.head_item_instance_id = Some(item_instance_id),
        EquipmentSlotType::Chest => equip.chest_item_instance_id = Some(item_instance_id),
        EquipmentSlotType::Legs => equip.legs_item_instance_id = Some(item_instance_id),
        EquipmentSlotType::Feet => equip.feet_item_instance_id = Some(item_instance_id),
        EquipmentSlotType::Hands => equip.hands_item_instance_id = Some(item_instance_id),
        EquipmentSlotType::Back => equip.back_item_instance_id = Some(item_instance_id),
    };

    // Update ActiveEquipment table
    active_equip_table.player_identity().update(equip);

    // Update the InventoryItem's location
    item_to_equip.location = ItemLocation::Equipped(crate::models::EquippedLocationData { owner_id: sender_id, slot_type: equipment_slot_type_for_location });
    inventory_items.instance_id().update(item_to_equip.clone()); // Update the item itself

    // Clear from original container if it wasn't in player direct possession
    if !came_from_player_direct_possession {
        log::debug!("[EquipArmorDrag] Item {} came from container/other. Clearing containers.", item_instance_id);
        clear_item_from_any_container(ctx, item_instance_id);
        // Ownership was implicitly handled by setting ItemLocation::Equipped above.
    }

    Ok(())
}

// Calculates the result of merging source onto target
// Returns: (qty_to_transfer, source_new_qty, target_new_qty, delete_source)
pub(crate) fn calculate_merge_result(
    source_item: &InventoryItem,
    target_item: &InventoryItem, 
    item_def: &ItemDefinition
) -> Result<(u32, u32, u32, bool), String> {
    if !item_def.is_stackable || source_item.item_def_id != target_item.item_def_id {
        return Err("Items cannot be merged".to_string());
    }

    let space_available = item_def.stack_size.saturating_sub(target_item.quantity);
    if space_available == 0 {
        return Err("Target stack is full".to_string()); // Or handle as a swap later
    }

    let qty_to_transfer = std::cmp::min(source_item.quantity, space_available);
    let source_new_qty = source_item.quantity - qty_to_transfer;
    let target_new_qty = target_item.quantity + qty_to_transfer;
    let delete_source = source_new_qty == 0;

    Ok((qty_to_transfer, source_new_qty, target_new_qty, delete_source))
}

// Renamed helper function
pub(crate) fn split_stack_helper(
    ctx: &ReducerContext,
    source_item: &mut InventoryItem, // Takes mutable reference to modify quantity
    quantity_to_split: u32,
    initial_location_for_new_item: ItemLocation // Explicitly pass the initial location for the new stack
) -> Result<u64, String> {
    // Validations already done in reducers calling this, but sanity check:
    if quantity_to_split == 0 || quantity_to_split >= source_item.quantity {
        return Err("Invalid split quantity".to_string());
    }

    // Decrease quantity of the source item
    source_item.quantity -= quantity_to_split;
    // Update source item in DB *before* creating new one
    ctx.db.inventory_item().instance_id().update(source_item.clone()); 

    // Create the new item stack with the split quantity
    let new_item = InventoryItem {
        instance_id: 0, // Will be auto-generated
        item_def_id: source_item.item_def_id,
        quantity: quantity_to_split,
        location: initial_location_for_new_item.clone(), // Set by caller, clone for logging
    };
    let inserted_item = ctx.db.inventory_item().insert(new_item);
    let new_instance_id = inserted_item.instance_id;

    log::info!(
        "[SplitStack Helper] Split {} from item {}. New stack ID: {}. Original stack qty: {}. New item location: {:?}",
        quantity_to_split, source_item.instance_id, new_instance_id, source_item.quantity, initial_location_for_new_item
    );

    Ok(new_instance_id)
}

// --- NEW: Drop Item into the World ---
#[spacetimedb::reducer]
pub fn drop_item(
    ctx: &ReducerContext,
    item_instance_id: u64,
    quantity_to_drop: u32, // How many to drop (can be less than total stack)
) -> Result<(), String> {
    let sender_id = ctx.sender;
    log::info!("[DropItem] Player {:?} attempting to drop {} of item instance {}", sender_id, quantity_to_drop, item_instance_id);

    let inventory_items = ctx.db.inventory_item();
    let item_defs = ctx.db.item_definition();
    let players = ctx.db.player();
    let active_equip_table_opt = ctx.db.active_equipment().player_identity().find(sender_id);

    // --- 1. Find Player ---
    let player = players.identity().find(sender_id)
        .ok_or_else(|| "Player not found.".to_string())?;

    // --- 2. Find Item & Validate ---
    let mut item_to_drop = inventory_items.instance_id().find(item_instance_id)
        .ok_or_else(|| format!("Item instance {} not found.", item_instance_id))?;
    
    // Clone the original location *before* any modifications to item_to_drop for partial drops.
    let original_location_of_item = item_to_drop.location.clone();

    // --- 2. Validate Item Ownership and Location ---
    match &item_to_drop.location {
        ItemLocation::Inventory(crate::models::InventoryLocationData { owner_id, .. }) |
        ItemLocation::Hotbar(crate::models::HotbarLocationData { owner_id, .. }) => {
            if *owner_id != sender_id {
                return Err(format!("Item instance {} in inv/hotbar not owned by caller.", item_instance_id));
            }
        }
        ItemLocation::Equipped(crate::models::EquippedLocationData { owner_id, slot_type }) => { 
            if *owner_id != sender_id {
                return Err(format!("Equipped item instance {} not owned by caller.", item_instance_id));
            }
            if quantity_to_drop >= item_to_drop.quantity { 
                clear_specific_item_from_equipment_slots(ctx, sender_id, item_instance_id); 
                log::info!("[DropItem] Dropping full stack of equipped armor {:?}. Slot cleared.", slot_type);
            }
        }
        _ => return Err(format!("Cannot drop item {} from its current location: {:?}. Must be in inventory, hotbar, or equipped.", item_instance_id, item_to_drop.location)),
    }

    // Validate quantity
    if quantity_to_drop == 0 {
        return Err("Cannot drop a quantity of 0.".to_string());
    }
    if quantity_to_drop > item_to_drop.quantity {
        return Err(format!("Cannot drop {} items, only {} available in stack.", quantity_to_drop, item_to_drop.quantity));
    }

    // --- 3. Get Item Definition ---
    let item_def = item_defs.id().find(item_to_drop.item_def_id)
        .ok_or_else(|| format!("Definition missing for item {}", item_to_drop.item_def_id))?;

    // --- 4. Check if dropped item was the ACTIVE tool/weapon and clear active status (only if dropping entire stack) ---
    if quantity_to_drop >= item_to_drop.quantity { // Only if entire stack is dropped
        if let Some(active_equip) = active_equip_table_opt.as_ref() { 
            if active_equip.equipped_item_instance_id == Some(item_instance_id) {
                match crate::active_equipment::clear_active_item_reducer(ctx, sender_id) {
                    Ok(_) => {
                        log::info!("[DropItem] Dropped item {} was the active item. Cleared from ActiveEquipment.", item_instance_id);
                    }
                    Err(e) => {
                        log::error!("[DropItem] Failed to clear active item {} during drop: {}. Proceeding with drop.", item_instance_id, e);
                    }
                }
            }
        }
    }

    // --- 5. Handle Quantity & Potential Splitting ---
    if quantity_to_drop == item_to_drop.quantity {
        // Dropping the entire stack
        log::info!("[DropItem] Dropping entire stack (ID: {}, Qty: {}). Deleting original InventoryItem.", item_instance_id, quantity_to_drop);
        
        clear_item_from_source_location(ctx, item_instance_id)?;
        inventory_items.instance_id().delete(item_instance_id);
    } else {
        // Dropping part of the stack
        if !item_def.is_stackable {
            return Err(format!("Cannot drop partial quantity of non-stackable item '{}'.", item_def.name));
        }
        
        log::info!("[DropItem] Dropping partial stack (ID: {}, QtyDrop: {}). Reducing original quantity.", item_instance_id, quantity_to_drop);
        item_to_drop.quantity -= quantity_to_drop;
        
        inventory_items.instance_id().update(item_to_drop);
    }

    // --- 6. Calculate Drop Position ---
    let (drop_x, drop_y) = calculate_drop_position(&player);
    log::debug!("[DropItem] Calculated drop position: ({:.1}, {:.1}) for player {:?}", drop_x, drop_y, sender_id);

    // --- 7. Create Dropped Item Entity in World ---
    create_dropped_item_entity(ctx, item_def.id, quantity_to_drop, drop_x, drop_y)?;

    log::info!("[DropItem] Successfully dropped {} of item def {} (Original ID: {}) at ({:.1}, {:.1}) for player {:?}.",
            quantity_to_drop, item_def.id, item_instance_id, drop_x, drop_y, sender_id);

    Ok(())
}

// --- NEW: Reducer to equip armor directly from inventory/hotbar ---
#[spacetimedb::reducer]
pub fn equip_armor_from_inventory(ctx: &ReducerContext, item_instance_id: u64) -> Result<(), String> {
    let sender_id = ctx.sender;
    log::info!("[EquipArmorInv] Player {:?} attempting to equip item {} from inventory/hotbar.", sender_id, item_instance_id);

    // 1. Get Item and Definition
    let mut item_to_equip = get_player_item(ctx, item_instance_id)?;
    let item_def = ctx.db.item_definition().id().find(item_to_equip.item_def_id)
        .ok_or_else(|| format!("Definition not found for item ID {}", item_to_equip.item_def_id))?;

    // 2. Validate Item Type and Location
    if item_def.category != ItemCategory::Armor {
        return Err(format!("Item '{}' is not armor.", item_def.name));
    }
    let target_slot_enum_model = item_def.equipment_slot_type
        .ok_or_else(|| format!("Armor '{}' has no defined equipment slot.", item_def.name))?;
    
    // Ensure item is currently in player inventory or hotbar
    if !matches!(&item_to_equip.location, ItemLocation::Inventory(data) if data.owner_id == sender_id) && 
       !matches!(&item_to_equip.location, ItemLocation::Hotbar(data) if data.owner_id == sender_id) {
        return Err("Item must be in inventory or hotbar to be equipped this way.".to_string());
    }

    // 3. Get ActiveEquipment and Handle Unequipping Existing Item
    let active_equip_table = ctx.db.active_equipment();
    let mut equip = active_equip_table.player_identity().find(sender_id)
                     .ok_or_else(|| "ActiveEquipment entry not found for player.".to_string())?;

    let current_item_in_slot_id: Option<u64> = match target_slot_enum_model {
        EquipmentSlotType::Head => equip.head_item_instance_id,
        EquipmentSlotType::Chest => equip.chest_item_instance_id,
        EquipmentSlotType::Legs => equip.legs_item_instance_id,
        EquipmentSlotType::Feet => equip.feet_item_instance_id,
        EquipmentSlotType::Hands => equip.hands_item_instance_id,
        EquipmentSlotType::Back => equip.back_item_instance_id,
    };

    if let Some(currently_equipped_id) = current_item_in_slot_id {
        if currently_equipped_id == item_instance_id { return Ok(()); } // Already equipped in the correct slot

        log::info!("[EquipArmorInv] Unequipping item {} from slot {:?}.", currently_equipped_id, target_slot_enum_model);
        match find_first_empty_inventory_slot(ctx, sender_id) {
            Some(empty_slot_idx) => {
                if let Ok(mut currently_equipped_item_row) = get_player_item(ctx, currently_equipped_id) {
                    currently_equipped_item_row.location = ItemLocation::Inventory(crate::models::InventoryLocationData { owner_id: sender_id, slot_index: empty_slot_idx });
                    ctx.db.inventory_item().instance_id().update(currently_equipped_item_row);
                    log::info!("[EquipArmorInv] Moved previously equipped item {} to inventory slot {}.", currently_equipped_id, empty_slot_idx);
                    // Clear the slot in ActiveEquipment *after* successfully moving the old item
                    match target_slot_enum_model {
                        EquipmentSlotType::Head => equip.head_item_instance_id = None,
                        EquipmentSlotType::Chest => equip.chest_item_instance_id = None,
                        EquipmentSlotType::Legs => equip.legs_item_instance_id = None,
                        EquipmentSlotType::Feet => equip.feet_item_instance_id = None,
                        EquipmentSlotType::Hands => equip.hands_item_instance_id = None,
                        EquipmentSlotType::Back => equip.back_item_instance_id = None,
                    };
                } else {
                    log::error!("[EquipArmorInv] Failed to find InventoryItem for previously equipped item {}! Aborting equip.", currently_equipped_id);
                    return Err("Failed to process currently equipped item.".to_string());
                }
            }
            None => {
                log::error!("[EquipArmorInv] Inventory full! Cannot unequip item {} from slot {:?}. Aborting equip.", currently_equipped_id, target_slot_enum_model);
                return Err("Inventory full, cannot unequip existing item.".to_string());
            }
        }
    } // End handling currently equipped item

    // 4. Equip the New Item
    log::info!("[EquipArmorInv] Equipping item {} to slot {:?}.", item_instance_id, target_slot_enum_model);
    let equipment_slot_type_for_location = target_slot_enum_model;

    match target_slot_enum_model {
        EquipmentSlotType::Head => equip.head_item_instance_id = Some(item_instance_id),
        EquipmentSlotType::Chest => equip.chest_item_instance_id = Some(item_instance_id),
        EquipmentSlotType::Legs => equip.legs_item_instance_id = Some(item_instance_id),
        EquipmentSlotType::Feet => equip.feet_item_instance_id = Some(item_instance_id),
        EquipmentSlotType::Hands => equip.hands_item_instance_id = Some(item_instance_id),
        EquipmentSlotType::Back => equip.back_item_instance_id = Some(item_instance_id),
    };
    active_equip_table.player_identity().update(equip);

    // 5. Update the InventoryItem's location
    item_to_equip.location = ItemLocation::Equipped(crate::models::EquippedLocationData { owner_id: sender_id, slot_type: equipment_slot_type_for_location });
    ctx.db.inventory_item().instance_id().update(item_to_equip);

    Ok(())
} 