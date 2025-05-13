use spacetimedb::{ReducerContext, Identity, Table};
use log;
use std::collections::HashSet; // Needed for slot checks

// Import necessary types, traits, and helpers from other modules
use crate::items::{
    InventoryItem, ItemDefinition, calculate_merge_result, split_stack_helper,
    clear_specific_item_from_equipment_slots
};
use crate::items::{
    inventory_item as InventoryItemTableTrait,
    item_definition as ItemDefinitionTableTrait
};
use crate::active_equipment::active_equipment as ActiveEquipmentTableTrait; // Needed for clearing equip slot
use crate::models::{ItemLocation, EquipmentSlotType}; // <<< ADDED IMPORT

// Placeholder for future content 

// <<< ADDED Constants >>>
pub(crate) const NUM_PLAYER_INVENTORY_SLOTS: u16 = 24;
pub(crate) const NUM_PLAYER_HOTBAR_SLOTS: u8 = 6;
// <<< END Added Constants >>>

// --- Helper Functions --- 

// Helper to find an item instance owned by the caller and in their direct possession (inv, hotbar, or equipped)
pub fn get_player_item(ctx: &ReducerContext, instance_id: u64) -> Result<InventoryItem, String> {
    ctx.db
        .inventory_item().iter()
        .find(|i| 
            i.instance_id == instance_id && 
            match &i.location {
                ItemLocation::Inventory(data) => data.owner_id == ctx.sender,
                ItemLocation::Hotbar(data) => data.owner_id == ctx.sender,
                ItemLocation::Equipped(data) => data.owner_id == ctx.sender,
                _ => false,
            }
        )
        .ok_or_else(|| format!("Item instance {} not found or not in player's possession.", instance_id))
}

// Helper to find an item occupying a specific inventory slot for the caller
pub(crate) fn find_item_in_inventory_slot(ctx: &ReducerContext, slot_index_to_find: u16) -> Option<InventoryItem> {
    ctx.db
        .inventory_item().iter()
        .find(|i| matches!(&i.location, ItemLocation::Inventory(data) if data.owner_id == ctx.sender && data.slot_index == slot_index_to_find))
}

// Helper to find an item occupying a specific hotbar slot for the caller
pub(crate) fn find_item_in_hotbar_slot(ctx: &ReducerContext, slot_index_to_find: u8) -> Option<InventoryItem> {
    ctx.db
        .inventory_item().iter()
        .find(|i| matches!(&i.location, ItemLocation::Hotbar(data) if data.owner_id == ctx.sender && data.slot_index == slot_index_to_find))
}

// Function to find the first available inventory slot (0-23)
// Needs to be pub(crate) to be callable from other modules like campfire.rs
pub(crate) fn find_first_empty_inventory_slot(ctx: &ReducerContext, player_id: Identity) -> Option<u16> {
    let occupied_slots: HashSet<u16> = ctx.db
        .inventory_item().iter()
        .filter_map(|i| match &i.location {
            ItemLocation::Inventory(data) if data.owner_id == player_id => Some(data.slot_index),
            _ => None,
        })
        .collect();

    (0..NUM_PLAYER_INVENTORY_SLOTS).find(|slot| !occupied_slots.contains(slot))
}

// Function to find the first available player slot (hotbar preferred)
pub(crate) fn find_first_empty_player_slot(ctx: &ReducerContext, player_id: Identity) -> Option<ItemLocation> {
    let inventory_table = ctx.db.inventory_item();
    
    // Check Hotbar
    let occupied_hotbar_slots: HashSet<u8> = inventory_table.iter()
        .filter_map(|item| match &item.location {
            ItemLocation::Hotbar(data) if data.owner_id == player_id => Some(data.slot_index),
            _ => None,
        })
        .collect();
    if let Some(empty_slot) = (0..NUM_PLAYER_HOTBAR_SLOTS).find(|slot| !occupied_hotbar_slots.contains(slot)) {
        return Some(ItemLocation::Hotbar(crate::models::HotbarLocationData { owner_id: player_id, slot_index: empty_slot }));
    }

    // Check Inventory
    let occupied_inventory_slots: HashSet<u16> = inventory_table.iter()
        .filter_map(|item| match &item.location {
            ItemLocation::Inventory(data) if data.owner_id == player_id => Some(data.slot_index),
            _ => None,
        })
        .collect();
    if let Some(empty_slot) = (0..NUM_PLAYER_INVENTORY_SLOTS).find(|slot| !occupied_inventory_slots.contains(slot)) {
        return Some(ItemLocation::Inventory(crate::models::InventoryLocationData { owner_id: player_id, slot_index: empty_slot }));
    }
    None // No empty slots found
}

// --- Reducers --- 

#[spacetimedb::reducer]
pub fn move_item_to_inventory(ctx: &ReducerContext, item_instance_id: u64, target_inventory_slot: u16) -> Result<(), String> {
    let inventory_items = ctx.db.inventory_item();
    let item_defs = ctx.db.item_definition();
    let active_equip_table = ctx.db.active_equipment(); // Added for checking active item
    let sender_id = ctx.sender;

    // --- 1. Find Item to Move --- 
    let mut item_to_move = inventory_items.instance_id().find(item_instance_id)
        .ok_or_else(|| format!("Item instance {} not found", item_instance_id))?;
    let item_def_to_move = item_defs.id().find(item_to_move.item_def_id)
        .ok_or("Item definition not found")?;

    // --- 2. Determine Original Location & Validate --- 
    let original_location = item_to_move.location.clone();
    let mut was_active_item = false;

    match &original_location {
        ItemLocation::Inventory(data) => {
            if data.owner_id != sender_id {
                return Err("Item does not belong to the caller or is not in their direct possession.".to_string());
            }
            // Check if this inventory/hotbar item was the active one
            if let Some(active_equip) = active_equip_table.player_identity().find(sender_id) {
                if active_equip.equipped_item_instance_id == Some(item_instance_id) {
                    was_active_item = true;
                }
            }
        }
        ItemLocation::Hotbar(data) => {
            if data.owner_id != sender_id {
                return Err("Item does not belong to the caller or is not in their direct possession.".to_string());
            }
            // Check if this inventory/hotbar item was the active one
            if let Some(active_equip) = active_equip_table.player_identity().find(sender_id) {
                if active_equip.equipped_item_instance_id == Some(item_instance_id) {
                    was_active_item = true;
                }
            }
        }
        ItemLocation::Equipped(data) => {
            if data.owner_id != sender_id {
                return Err("Item does not belong to the caller or is not in their direct possession.".to_string());
            }
            // Item was equipped armor. It cannot be the "active item" in the sense of a tool/weapon simultaneously.
            // So, no need to check was_active_item here. clear_specific_item_from_equipment_slots will handle the armor slot.
        }
        ItemLocation::Container(_) => return Err("Cannot directly move item from container to player inventory using this reducer. Use inventory_management reducers.".to_string()),
        ItemLocation::Dropped(_) => return Err("Cannot move a dropped item using this reducer. Use pickup.".to_string()),
        ItemLocation::Unknown => return Err("Item has an unknown location.".to_string()),
    }

    // --- 3. Check Target Slot --- 
    if target_inventory_slot >= NUM_PLAYER_INVENTORY_SLOTS {
        return Err("Invalid target inventory slot index".to_string());
    }
    
    let target_item_opt = find_item_in_inventory_slot(ctx, target_inventory_slot);
    let new_item_location = ItemLocation::Inventory(crate::models::InventoryLocationData { owner_id: sender_id, slot_index: target_inventory_slot });

    if let Some(mut target_item) = target_item_opt {
        // --- 4a. Target Slot Occupied: Merge or Swap --- 
        if target_item.instance_id == item_instance_id { 
            item_to_move.location = new_item_location;
            inventory_items.instance_id().update(item_to_move);
            log::debug!("[MoveInv] Item {} moved onto its own slot {}. Ensuring placement.", item_instance_id, target_inventory_slot);
            return Ok(()); 
        }

        log::debug!("[MoveInv] Target slot {} occupied by {}. Trying merge/swap for item {}.", 
                 target_inventory_slot, target_item.instance_id, item_instance_id);

        match calculate_merge_result(&item_to_move, &target_item, &item_def_to_move) {
            Ok((qty_transfer, source_new_qty, target_new_qty, delete_source)) => {
                log::info!("[MoveInv Merge] Merging {} from item {} onto {} in inv slot {}. Target new qty: {}. Delete source: {}", 
                         qty_transfer, item_instance_id, target_item.instance_id, target_inventory_slot, target_new_qty, delete_source);
                target_item.quantity = target_new_qty;
                inventory_items.instance_id().update(target_item.clone());
                if delete_source {
                    let mut item_to_delete = inventory_items.instance_id().find(item_instance_id).ok_or("Item to delete not found during merge!")?;
                    item_to_delete.location = ItemLocation::Unknown;
                    log::info!("[MoveInv Merge] Updating location of item to delete {} to Unknown before deleting.", item_instance_id);
                    inventory_items.instance_id().update(item_to_delete);
                    inventory_items.instance_id().delete(item_instance_id);
                    log::info!("[MoveInv Merge] Source item {} deleted after merge.", item_instance_id);
                } else {
                    item_to_move.quantity = source_new_qty;
                    item_to_move.location = original_location; // Reaffirm original location
                    log::info!("[MoveInv Merge] Updating source item {} qty to {} at original location {:?}.", item_instance_id, source_new_qty, item_to_move.location);
                    inventory_items.instance_id().update(item_to_move.clone());
                }
            },
            Err(_) => {
                log::info!("[MoveInv Swap] Cannot merge. Swapping inv slot {} (item {}) with source item {} (originally at {:?}).", 
                         target_inventory_slot, target_item.instance_id, item_instance_id, original_location);
                
                let original_target_location = target_item.location.clone(); // Should be the current inventory slot
                target_item.location = original_location.clone();
                log::info!("[MoveInv Swap] Updating target item {} (from slot {}) to new location {:?}.", target_item.instance_id, target_inventory_slot, target_item.location);
                inventory_items.instance_id().update(target_item.clone());
                
                item_to_move.location = new_item_location; // This is the target_inventory_slot
                log::info!("[MoveInv Swap] Updating source item {} (from {:?}) to new location {:?}.", item_to_move.instance_id, original_location, item_to_move.location);
                inventory_items.instance_id().update(item_to_move.clone());

                if let ItemLocation::Equipped(data) = &original_location {
                    if data.owner_id == sender_id {
                        // This correctly clears the specific ARMOR slot if item was equipped armor
                        clear_specific_item_from_equipment_slots(ctx, sender_id, item_to_move.instance_id);
                        log::debug!("[MoveInv Swap] Cleared equipment slot {:?} for item {} after swap.", data.slot_type, item_to_move.instance_id);
                    }
                } else if was_active_item {
                    // If it was an active item (from inv/hotbar) and swapped, it should be cleared as active
                    if let Err(e) = crate::active_equipment::clear_active_item_reducer(ctx, sender_id) {
                        log::warn!("[MoveInv Swap] Failed to clear active status for item {}: {}", item_instance_id, e);
                    }
                }
            }
        }
    } else {
        log::info!("[MoveInv Place] Moving item {} to empty inv slot {}", item_instance_id, target_inventory_slot);
        
        let original_location_for_clearing_equip = item_to_move.location.clone(); // Clone before changing location
        item_to_move.location = new_item_location;
        log::info!("[MoveInv Place] Updating item {} from {:?} to new location {:?}.", item_to_move.instance_id, original_location_for_clearing_equip, item_to_move.location);
        inventory_items.instance_id().update(item_to_move.clone());

        if let ItemLocation::Equipped(data) = &original_location_for_clearing_equip {
            if data.owner_id == sender_id {
                 // This correctly clears the specific ARMOR slot if item was equipped armor
                 clear_specific_item_from_equipment_slots(ctx, sender_id, item_to_move.instance_id);
                 log::debug!("[MoveInv Place] Cleared equipment slot {:?} for item {} after place.", data.slot_type, item_to_move.instance_id);
            }
        } else if was_active_item {
             // If it was an active item (from inv/hotbar) and placed, it should be cleared as active
            if let Err(e) = crate::active_equipment::clear_active_item_reducer(ctx, sender_id) {
                log::warn!("[MoveInv Place] Failed to clear active status for item {}: {}", item_instance_id, e);
            }
        }
    }
    Ok(())
}

#[spacetimedb::reducer]
pub fn move_item_to_hotbar(ctx: &ReducerContext, item_instance_id: u64, target_hotbar_slot: u8) -> Result<(), String> {
    let inventory_items = ctx.db.inventory_item();
    let item_defs = ctx.db.item_definition();
    let active_equip_table = ctx.db.active_equipment(); // Added for checking active item
    let sender_id = ctx.sender;

    // --- 1. Find Item to Move --- 
    let mut item_to_move = inventory_items.instance_id().find(item_instance_id)
        .ok_or_else(|| format!("Item instance {} not found", item_instance_id))?;
    let item_def_to_move = item_defs.id().find(item_to_move.item_def_id)
        .ok_or("Item definition not found")?;

    // --- 2. Determine Original Location & Validate --- 
    let original_location = item_to_move.location.clone();
    let mut was_active_item = false;

    match &original_location {
        ItemLocation::Inventory(data) => {
            if data.owner_id != sender_id {
                return Err("Item does not belong to the caller or is not in their direct possession.".to_string());
            }
            // Check if this inventory item was the active one
            if let Some(active_equip) = active_equip_table.player_identity().find(sender_id) {
                if active_equip.equipped_item_instance_id == Some(item_instance_id) {
                    was_active_item = true;
                }
            }
        }
        ItemLocation::Hotbar(data) => {
            if data.owner_id != sender_id {
                return Err("Item does not belong to the caller or is not in their direct possession.".to_string());
            }
            // Check if this hotbar item was the active one
            if let Some(active_equip) = active_equip_table.player_identity().find(sender_id) {
                if active_equip.equipped_item_instance_id == Some(item_instance_id) {
                    was_active_item = true;
                }
            }
        }
        ItemLocation::Equipped(data) => {
            if data.owner_id != sender_id {
                return Err("Item does not belong to the caller or is not in their direct possession.".to_string());
            }
        }
        ItemLocation::Container(_) => return Err("Cannot directly move item from container to player hotbar using this reducer. Use inventory_management reducers.".to_string()),
        ItemLocation::Dropped(_) => return Err("Cannot move a dropped item using this reducer. Use pickup.".to_string()),
        ItemLocation::Unknown => return Err("Item has an unknown location.".to_string()),
    }

    // --- 3. Check Target Slot --- 
    if target_hotbar_slot >= NUM_PLAYER_HOTBAR_SLOTS {
        return Err("Invalid target hotbar slot index".to_string());
    }

    let target_item_opt = find_item_in_hotbar_slot(ctx, target_hotbar_slot);
    let new_item_location = ItemLocation::Hotbar(crate::models::HotbarLocationData { owner_id: sender_id, slot_index: target_hotbar_slot });

    if let Some(mut target_item) = target_item_opt {
        // --- 4a. Target Slot Occupied: Merge or Swap --- 
        if target_item.instance_id == item_instance_id {
            item_to_move.location = new_item_location;
            inventory_items.instance_id().update(item_to_move);
            log::debug!("[MoveHotbar] Item {} moved onto its own slot {}. Ensuring placement.", item_instance_id, target_hotbar_slot);
            return Ok(());
        }

        log::debug!("[MoveHotbar] Target slot {} occupied by {}. Trying merge/swap for item {}.", 
                 target_hotbar_slot, target_item.instance_id, item_instance_id);
        
        match calculate_merge_result(&item_to_move, &target_item, &item_def_to_move) {
            Ok((qty_transfer, source_new_qty, target_new_qty, delete_source)) => {
                log::info!("[MoveHotbar Merge] Merging {} from item {} onto {} in hotbar slot {}. Target new qty: {}. Delete source: {}", 
                         qty_transfer, item_instance_id, target_item.instance_id, target_hotbar_slot, target_new_qty, delete_source);
                target_item.quantity = target_new_qty;
                inventory_items.instance_id().update(target_item.clone());
                if delete_source {
                    let mut item_to_delete = inventory_items.instance_id().find(item_instance_id).ok_or("Item to delete not found during merge!")?;
                    item_to_delete.location = ItemLocation::Unknown;
                    log::info!("[MoveHotbar Merge] Updating location of item to delete {} to Unknown before deleting.", item_instance_id);
                    inventory_items.instance_id().update(item_to_delete);
                    inventory_items.instance_id().delete(item_instance_id);
                    log::info!("[MoveHotbar Merge] Source item {} deleted after merge.", item_instance_id);
                } else {
                    item_to_move.quantity = source_new_qty;
                    item_to_move.location = original_location;
                    log::info!("[MoveHotbar Merge] Updating source item {} qty to {} at original location {:?}.", item_instance_id, source_new_qty, item_to_move.location);
                    inventory_items.instance_id().update(item_to_move.clone());
                }
            },
            Err(_) => {
                log::info!("[MoveHotbar Swap] Cannot merge. Swapping hotbar slot {} (item {}) with source item {} (originally at {:?}).", 
                         target_hotbar_slot, target_item.instance_id, item_instance_id, original_location);
                
                target_item.location = original_location.clone();
                log::info!("[MoveHotbar Swap] Updating target item {} (from slot {}) to new location {:?}.", target_item.instance_id, target_hotbar_slot, target_item.location);
                inventory_items.instance_id().update(target_item.clone());

                item_to_move.location = new_item_location; // This is the target_hotbar_slot
                log::info!("[MoveHotbar Swap] Updating source item {} (from {:?}) to new location {:?}.", item_to_move.instance_id, original_location, item_to_move.location);
                inventory_items.instance_id().update(item_to_move.clone());

                if let ItemLocation::Equipped(data) = &original_location {
                    if data.owner_id == sender_id {
                        // This correctly clears the specific ARMOR slot if item was equipped armor
                        clear_specific_item_from_equipment_slots(ctx, sender_id, item_to_move.instance_id);
                        log::debug!("[MoveHotbar Swap] Cleared equipment slot {:?} for item {} after swap.", data.slot_type, item_to_move.instance_id);
                    }
                } else if was_active_item {
                     // If it was an active item (from inv/hotbar) and swapped, it should be cleared as active
                    if let Err(e) = crate::active_equipment::clear_active_item_reducer(ctx, sender_id) {
                        log::warn!("[MoveHotbar Swap] Failed to clear active status for item {}: {}", item_instance_id, e);
                    }
                }
            }
        }
    } else {
        log::info!("[MoveHotbar Place] Moving item {} to empty hotbar slot {}", item_instance_id, target_hotbar_slot);
        
        let original_location_for_clearing_equip = item_to_move.location.clone(); // Clone before changing location
        item_to_move.location = new_item_location;
        log::info!("[MoveHotbar Place] Updating item {} from {:?} to new location {:?}.", item_to_move.instance_id, original_location_for_clearing_equip, item_to_move.location);
        inventory_items.instance_id().update(item_to_move.clone());

        if let ItemLocation::Equipped(data) = &original_location_for_clearing_equip {
            if data.owner_id == sender_id {
                 // This correctly clears the specific ARMOR slot if item was equipped armor
                 clear_specific_item_from_equipment_slots(ctx, sender_id, item_to_move.instance_id);
                 log::debug!("[MoveHotbar Place] Cleared equipment slot {:?} for item {} after place.", data.slot_type, item_to_move.instance_id);
             }
        } else if was_active_item {
            // If it was an active item (from inv/hotbar) and placed, it should be cleared as active
            if let Err(e) = crate::active_equipment::clear_active_item_reducer(ctx, sender_id) {
                log::warn!("[MoveHotbar Place] Failed to clear active status for item {}: {}", item_instance_id, e);
            }
        }
    }
    Ok(())
}

#[spacetimedb::reducer]
pub fn split_stack(
    ctx: &ReducerContext,
    source_item_instance_id: u64,
    quantity_to_split: u32,        // How many to move to the NEW stack
    target_slot_type: String,    // "inventory" or "hotbar"
    target_slot_index: u32,    // Use u32 to accept both potential u8/u16 client values easily
) -> Result<(), String> {
    let sender_id = ctx.sender;
    let inventory_items = ctx.db.inventory_item();

    // --- 1. Get Source Item --- 
    let mut source_item = get_player_item(ctx, source_item_instance_id)?;
    
    // --- 2. Determine Target Location for New Stack ---
    let initial_location_for_new_item = match target_slot_type.as_str() {
        "inventory" => {
            if target_slot_index >= NUM_PLAYER_INVENTORY_SLOTS as u32 {
                return Err("Invalid target inventory slot index for split".to_string());
            }
            ItemLocation::Inventory(crate::models::InventoryLocationData { owner_id: sender_id, slot_index: target_slot_index as u16 })
        }
        "hotbar" => {
            if target_slot_index >= NUM_PLAYER_HOTBAR_SLOTS as u32 {
                return Err("Invalid target hotbar slot index for split".to_string());
            }
            ItemLocation::Hotbar(crate::models::HotbarLocationData { owner_id: sender_id, slot_index: target_slot_index as u8 })
        }
        _ => return Err("Invalid target_slot_type for split. Must be 'inventory' or 'hotbar'.".to_string()),
    };

    // --- 3. Perform Split using Helper --- 
    // The helper updates the source_item quantity and creates new_item_instance_id
    // with the specified initial_location_for_new_item.
    let new_item_instance_id = split_stack_helper(ctx, &mut source_item, quantity_to_split, initial_location_for_new_item.clone())?;

    // --- 4. Move/Merge the NEWLY CREATED stack to its target player slot --- 
    // The new item was already created by split_stack_helper with the correct initial location.
    // Now we need to potentially merge it if the target slot is occupied, or just confirm its placement.
    // This is effectively what move_item_to_inventory/hotbar does.

    log::debug!("[SplitStack] New item {} created with target location {:?}. Attempting move/merge.", 
             new_item_instance_id, initial_location_for_new_item);

    match initial_location_for_new_item {
        ItemLocation::Inventory(slot_data) => {
            move_item_to_inventory(ctx, new_item_instance_id, slot_data.slot_index)?;
        }
        ItemLocation::Hotbar(slot_data) => {
            move_item_to_hotbar(ctx, new_item_instance_id, slot_data.slot_index)?;
        }
        _ => {
            // This case should ideally not be reached if target_slot_type validation is correct
            // Delete the newly created item if its location is invalid to prevent orphaned items.
            inventory_items.instance_id().delete(new_item_instance_id);
            return Err("Internal error: New split item has an invalid target location type after split_stack_helper.".to_string());
        }
    }

    Ok(())
}

#[spacetimedb::reducer]
pub fn move_to_first_available_hotbar_slot(ctx: &ReducerContext, item_instance_id: u64) -> Result<(), String> {
    let sender_id = ctx.sender;
    let inventory_items = ctx.db.inventory_item();
    let active_equip_table = ctx.db.active_equipment(); // Added for checking active item

    let mut item_to_move = get_player_item(ctx, item_instance_id)?;
    let original_location = item_to_move.location.clone(); // Store original location
    let mut was_active_item = false;

    // Determine if it was equipped or active
    match &original_location {
        ItemLocation::Inventory(data) => {
            if data.owner_id == sender_id {
                if let Some(active_equip) = active_equip_table.player_identity().find(sender_id) {
                    if active_equip.equipped_item_instance_id == Some(item_instance_id) {
                        was_active_item = true;
                    }
                }
            }
        }
        ItemLocation::Hotbar(data) => {
            if data.owner_id == sender_id {
                if let Some(active_equip) = active_equip_table.player_identity().find(sender_id) {
                    if active_equip.equipped_item_instance_id == Some(item_instance_id) {
                        was_active_item = true;
                    }
                }
            }
        }
        ItemLocation::Equipped(ref data) => {
            if data.owner_id != sender_id {
                return Err("Item not owned by player or not in direct possession.".to_string());
            }
            // If it's equipped armor, it cannot be moved to hotbar this way.
            // Only tools/weapons (which appear in inv/hotbar when not active) can use this.
            return Err("Equipped armor cannot be directly moved to hotbar. Unequip it first.".to_string());
        }
        _ => { /* Not directly possessed or not relevant for equip/active state */ }
    }
    
    // Find first empty hotbar slot
    let occupied_hotbar_slots: HashSet<u8> = inventory_items.iter()
        .filter_map(|item| match &item.location {
            ItemLocation::Hotbar(data) if data.owner_id == sender_id => Some(data.slot_index),
            _ => None,
        })
        .collect();

    if let Some(empty_slot) = (0..NUM_PLAYER_HOTBAR_SLOTS).find(|slot| !occupied_hotbar_slots.contains(slot)) {
        log::info!("[MoveToHotbar] Moving item {} from {:?} to first available hotbar slot: {}", item_instance_id, original_location, empty_slot);
        
        // Update location first
        item_to_move.location = ItemLocation::Hotbar(crate::models::HotbarLocationData { owner_id: sender_id, slot_index: empty_slot });
        inventory_items.instance_id().update(item_to_move.clone()); // Use clone as item_to_move is used in logging

        // Clear original equipment slot if it was equipped armor
        if let ItemLocation::Equipped(data) = &original_location {
            if data.owner_id == sender_id {
                 clear_specific_item_from_equipment_slots(ctx, sender_id, item_instance_id);
                 log::debug!("[MoveToHotbar] Cleared equipment slot {:?} for item {} after move.", data.slot_type, item_instance_id);
            }
        } else if was_active_item { // Else if it was an active item (from inv/hotbar)
            if let Err(e) = crate::active_equipment::clear_active_item_reducer(ctx, sender_id) {
                log::warn!("[MoveToHotbar] Failed to clear active status for item {}: {}", item_instance_id, e);
            } else {
                log::debug!("[MoveToHotbar] Cleared active status for item {} after move.", item_instance_id);
            }
        }
        Ok(())
    } else {
        Err("No available hotbar slots".to_string())
    }
}

// ... rest of items.rs ... 