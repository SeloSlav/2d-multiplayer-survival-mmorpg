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

// Placeholder for future content 

// <<< ADDED Constants >>>
pub(crate) const NUM_PLAYER_INVENTORY_SLOTS: u16 = 24;
pub(crate) const NUM_PLAYER_HOTBAR_SLOTS: u8 = 6;
// <<< END Added Constants >>>

// --- Helper Functions --- 

// Helper to find an item instance owned by the caller
fn get_player_item(ctx: &ReducerContext, instance_id: u64) -> Result<InventoryItem, String> {
    ctx.db
        .inventory_item().iter()
        .filter(|i| i.instance_id == instance_id && i.player_identity == ctx.sender)
        .next()
        .ok_or_else(|| format!("Item instance {} not found or not owned by caller.", instance_id))
}

// Helper to find an item occupying a specific inventory slot for the caller
pub(crate) fn find_item_in_inventory_slot(ctx: &ReducerContext, slot: u16) -> Option<InventoryItem> {
    ctx.db
        .inventory_item().iter()
        .filter(|i| i.player_identity == ctx.sender && i.inventory_slot == Some(slot))
        .next()
}

// Helper to find an item occupying a specific hotbar slot for the caller
pub(crate) fn find_item_in_hotbar_slot(ctx: &ReducerContext, slot: u8) -> Option<InventoryItem> {
    ctx.db
        .inventory_item().iter()
        .filter(|i| i.player_identity == ctx.sender && i.hotbar_slot == Some(slot))
        .next()
}

// Function to find the first available inventory slot (0-23)
// Needs to be pub(crate) to be callable from other modules like campfire.rs
pub(crate) fn find_first_empty_inventory_slot(ctx: &ReducerContext, player_id: Identity) -> Option<u16> {
    let occupied_slots: std::collections::HashSet<u16> = ctx.db
        .inventory_item().iter()
        .filter(|i| i.player_identity == player_id && i.inventory_slot.is_some())
        .map(|i| i.inventory_slot.unwrap())
        .collect();

    // Assuming 24 inventory slots (0-23)
    (0..24).find(|slot| !occupied_slots.contains(slot))
}

// Function to find the first available player slot (hotbar preferred)
pub(crate) fn find_first_empty_player_slot(ctx: &ReducerContext, player_id: Identity) -> Option<(String, u32)> {
    let inventory = ctx.db.inventory_item();
    // Check Hotbar (0-5)
    let occupied_hotbar: std::collections::HashSet<u8> = inventory.iter()
        .filter(|i| i.player_identity == player_id && i.hotbar_slot.is_some())
        .map(|i| i.hotbar_slot.unwrap())
        .collect();
    if let Some(empty_slot) = (0..6).find(|slot| !occupied_hotbar.contains(slot)) {
        return Some(("hotbar".to_string(), empty_slot as u32));
    }
    // Check Inventory (0-23)
    let occupied_inventory: std::collections::HashSet<u16> = inventory.iter()
        .filter(|i| i.player_identity == player_id && i.inventory_slot.is_some())
        .map(|i| i.inventory_slot.unwrap())
        .collect();
    if let Some(empty_slot) = (0..24).find(|slot| !occupied_inventory.contains(slot)) {
        return Some(("inventory".to_string(), empty_slot as u32));
    }
    None // No empty slots found
}

// --- Reducers --- 

#[spacetimedb::reducer]
pub fn move_item_to_inventory(ctx: &ReducerContext, item_instance_id: u64, target_inventory_slot: u16) -> Result<(), String> {
    let inventory_items = ctx.db.inventory_item();
    let item_defs = ctx.db.item_definition();
    let sender_id = ctx.sender;

    // --- 1. Find Item to Move --- 
    let mut item_to_move = inventory_items.instance_id().find(item_instance_id)
        .ok_or_else(|| format!("Item instance {} not found", item_instance_id))?;
    // REMOVED player identity check here - item might be coming from a container
    // if item_to_move.player_identity != sender_id { 
    //     return Err("Item does not belong to the caller".to_string()); 
    // }
    let item_def_to_move = item_defs.id().find(item_to_move.item_def_id)
        .ok_or("Item definition not found")?;

    // --- 2. Determine Original Location --- 
    let original_location_was_equipment = item_to_move.inventory_slot.is_none() && item_to_move.hotbar_slot.is_none();
    // We assume if it's not in inv/hotbar, it *must* be equipped for this move to be initiated.
    // A move from a container (box/campfire) would use a different reducer.
    if original_location_was_equipment {
        log::debug!("[MoveInv] Item {} is potentially coming from an equipment slot.", item_instance_id);
    }
    
    // --- 3. Check Target Slot --- 
    if target_inventory_slot >= 24 { // Assuming 0-23 are valid slots
        return Err("Invalid target inventory slot index".to_string());
    }
    
    let target_item_opt = find_item_in_inventory_slot(ctx, target_inventory_slot);

    if let Some(mut target_item) = target_item_opt {
        // --- 4a. Target Slot Occupied: Merge or Swap --- 
        if target_item.instance_id == item_instance_id { 
            // Trying to move item onto itself, just ensure it's correctly placed.
            item_to_move.inventory_slot = Some(target_inventory_slot);
            item_to_move.hotbar_slot = None;
            item_to_move.player_identity = sender_id; // Ensure ownership
            inventory_items.instance_id().update(item_to_move);
            log::debug!("[MoveInv] Item {} moved onto its own slot {}. Ensuring placement.", item_instance_id, target_inventory_slot);
            return Ok(()); 
        }

        log::debug!("[MoveInv] Target slot {} occupied by {}. Trying merge/swap for item {}.", 
                 target_inventory_slot, target_item.instance_id, item_instance_id);

        match calculate_merge_result(&item_to_move, &target_item, &item_def_to_move) {
            Ok((qty_transfer, source_new_qty, target_new_qty, delete_source)) => {
                 // Merge successful
                log::info!("[MoveInv Merge] Merging {} from item {} onto {} in inv slot {}. Target new qty: {}", 
                         qty_transfer, item_instance_id, target_item.instance_id, target_inventory_slot, target_new_qty);
                target_item.quantity = target_new_qty;
                inventory_items.instance_id().update(target_item);
                if delete_source {
                    // Explicitly clear location before deleting, just in case
                    let mut item_to_delete = inventory_items.instance_id().find(item_instance_id).ok_or("Item to delete not found during merge!")?;
                    item_to_delete.inventory_slot = None;
                    item_to_delete.hotbar_slot = None;
                    inventory_items.instance_id().update(item_to_delete);
                    // Now delete
                    inventory_items.instance_id().delete(item_instance_id); // Delete the source (new split stack)
                     log::info!("[MoveInv Merge] Source item {} deleted after merge.", item_instance_id);
                } else {
                    item_to_move.quantity = source_new_qty;
                    // Item remains in limbo until explicitly placed or handled further
                    // For a simple move, if not deleted, it means the move failed partially?
                    // Let's assume calculate_merge handles full merge or no merge cleanly.
                    // If it wasn't deleted, we might need error handling or different logic,
                    // but typically a move implies the whole stack moves if possible.
                     log::warn!("[MoveInv Merge] Source item {} not deleted after merge? New Qty: {}. Item state may be inconsistent.", 
                              item_instance_id, source_new_qty); 
                    // We still need to update the original item's state if it wasn't deleted.
                    // Where should it go? Back to original slot? Error out? 
                    // For now, let's assume merge means source is deleted or quantity updated.
                    // If source wasn't deleted, it means the quantity was just reduced. Update it.
                    inventory_items.instance_id().update(item_to_move);
                }
            },
            Err(_) => {
                // Merge Failed: Swap
                // Check if the source item is a newly split stack (no original slot)
                if item_to_move.inventory_slot.is_none() && item_to_move.hotbar_slot.is_none() {
                    // This is likely a split stack being dropped onto an incompatible item.
                    log::warn!("[MoveInv Swap] Cannot place split stack {} onto incompatible item {} in inv slot {}. Aborting.", 
                             item_instance_id, target_item.instance_id, target_inventory_slot);
                    return Err(format!("Cannot place split stack onto incompatible item in slot {}.", target_inventory_slot));
                }
                // Otherwise, proceed with the normal swap logic
                log::info!("[MoveInv Swap] Cannot merge. Swapping inv slot {} (item {}) with source item {}.", 
                         target_inventory_slot, target_item.instance_id, item_instance_id);
                
                // Get original location of item_to_move *before* potential clearing
                let source_inv_slot = item_to_move.inventory_slot;
                let source_hotbar_slot = item_to_move.hotbar_slot;

                // Move target item to source location (if it was in player inv/hotbar)
                target_item.inventory_slot = source_inv_slot;
                target_item.hotbar_slot = source_hotbar_slot;
                // Ensure target item belongs to player (might be redundant but safe)
                target_item.player_identity = sender_id; 
                inventory_items.instance_id().update(target_item);
                
                // Move source item to target inventory slot
                item_to_move.inventory_slot = Some(target_inventory_slot);
                item_to_move.hotbar_slot = None;
                item_to_move.player_identity = sender_id; // Assign ownership
                inventory_items.instance_id().update(item_to_move);
            }
        }
    } else {
        // --- 4b. Target Slot Empty: Place --- 
        log::info!("[MoveInv Place] Moving item {} to empty inv slot {}", item_instance_id, target_inventory_slot);
        item_to_move.inventory_slot = Some(target_inventory_slot);
        item_to_move.hotbar_slot = None;
        item_to_move.player_identity = sender_id; // Assign ownership
        inventory_items.instance_id().update(item_to_move);
    }

    // --- 5. Clear Original Equipment Slot if Necessary --- 
    if original_location_was_equipment {
        log::info!("[MoveInv] Clearing original equipment slot for item {}.", item_instance_id);
        clear_specific_item_from_equipment_slots(ctx, sender_id, item_instance_id);
    }

    Ok(())
}

#[spacetimedb::reducer]
pub fn move_item_to_hotbar(ctx: &ReducerContext, item_instance_id: u64, target_hotbar_slot: u8) -> Result<(), String> {
    let inventory_items = ctx.db.inventory_item();
    let item_defs = ctx.db.item_definition();
    let sender_id = ctx.sender;

    // --- 1. Find Item to Move --- 
    let mut item_to_move = inventory_items.instance_id().find(item_instance_id)
        .ok_or_else(|| format!("Item instance {} not found", item_instance_id))?;
    // REMOVED player identity check here
    // if item_to_move.player_identity != sender_id { 
    //     return Err("Item does not belong to the caller".to_string()); 
    // }
    let item_def_to_move = item_defs.id().find(item_to_move.item_def_id)
        .ok_or("Item definition not found")?;

    // --- 2. Determine Original Location --- 
    let original_location_was_equipment = item_to_move.inventory_slot.is_none() && item_to_move.hotbar_slot.is_none();
    // We assume if it's not in inv/hotbar, it *must* be equipped for this move to be initiated.
    // A move from a container (box/campfire) would use a different reducer.
    if original_location_was_equipment {
        log::debug!("[MoveHotbar] Item {} is potentially coming from an equipment slot.", item_instance_id);
    }
    
    // --- 3. Check Target Slot --- 
    if target_hotbar_slot >= 6 { // Assuming 0-5 are valid slots
        return Err("Invalid target hotbar slot index".to_string());
    }

    let target_item_opt = find_item_in_hotbar_slot(ctx, target_hotbar_slot);

    if let Some(mut target_item) = target_item_opt {
        // --- 4a. Target Slot Occupied: Merge or Swap --- 
        if target_item.instance_id == item_instance_id { 
            // Trying to move item onto itself, just ensure it's correctly placed.
            item_to_move.hotbar_slot = Some(target_hotbar_slot);
            item_to_move.inventory_slot = None;
            item_to_move.player_identity = sender_id; // Ensure ownership
            inventory_items.instance_id().update(item_to_move);
            log::debug!("[MoveHotbar] Item {} moved onto its own slot {}. Ensuring placement.", item_instance_id, target_hotbar_slot);
            return Ok(()); 
        }

        log::debug!("[MoveHotbar] Target slot {} occupied by {}. Trying merge/swap for item {}.", 
                 target_hotbar_slot, target_item.instance_id, item_instance_id);
        
        match calculate_merge_result(&item_to_move, &target_item, &item_def_to_move) {
             Ok((qty_transfer, source_new_qty, target_new_qty, delete_source)) => {
                 // Merge successful
                 log::info!("[MoveHotbar Merge] Merging {} from item {} onto {} in hotbar slot {}. Target new qty: {}", 
                         qty_transfer, item_instance_id, target_item.instance_id, target_hotbar_slot, target_new_qty);
                target_item.quantity = target_new_qty;
                inventory_items.instance_id().update(target_item);
                if delete_source {
                    // Explicitly clear location before deleting, just in case
                    let mut item_to_delete = inventory_items.instance_id().find(item_instance_id).ok_or("Item to delete not found during merge!")?;
                    item_to_delete.inventory_slot = None;
                    item_to_delete.hotbar_slot = None;
                    inventory_items.instance_id().update(item_to_delete);
                    // Now delete
                    inventory_items.instance_id().delete(item_instance_id); // Delete the source (new split stack)
                    log::info!("[MoveHotbar Merge] Source item {} deleted after merge.", item_instance_id);
                } else {
                    item_to_move.quantity = source_new_qty;
                    // See comment in move_item_to_inventory regarding partial merges.
                    log::warn!("[MoveHotbar Merge] Source item {} not deleted after merge? New Qty: {}. Item state may be inconsistent.", 
                             item_instance_id, source_new_qty); 
                    inventory_items.instance_id().update(item_to_move);
                }
            },
            Err(_) => {
                // Merge Failed: Swap
                // Check if the source item is a newly split stack (no original slot)
                if item_to_move.inventory_slot.is_none() && item_to_move.hotbar_slot.is_none() {
                    // This is likely a split stack being dropped onto an incompatible item.
                     log::warn!("[MoveHotbar Swap] Cannot place split stack {} onto incompatible item {} in hotbar slot {}. Aborting.", 
                              item_instance_id, target_item.instance_id, target_hotbar_slot);
                    return Err(format!("Cannot place split stack onto incompatible item in hotbar slot {}.", target_hotbar_slot));
                }
                // Otherwise, proceed with the normal swap logic
                log::info!("[MoveHotbar Swap] Cannot merge. Swapping hotbar slot {} (item {}) with source item {}.", 
                         target_hotbar_slot, target_item.instance_id, item_instance_id);
                
                // Get original location of item_to_move
                let source_inv_slot = item_to_move.inventory_slot;
                let source_hotbar_slot = item_to_move.hotbar_slot;

                // Move target item to source location
                target_item.inventory_slot = source_inv_slot;
                target_item.hotbar_slot = source_hotbar_slot;
                target_item.player_identity = sender_id; // Ensure ownership
                inventory_items.instance_id().update(target_item);
                
                // Move source item to target hotbar slot
                item_to_move.hotbar_slot = Some(target_hotbar_slot);
                item_to_move.inventory_slot = None;
                item_to_move.player_identity = sender_id; // Assign ownership
                inventory_items.instance_id().update(item_to_move);
            }
        }
    } else {
        // --- 4b. Target Slot Empty: Place --- 
        log::info!("[MoveHotbar Place] Moving item {} to empty hotbar slot {}", item_instance_id, target_hotbar_slot);
        item_to_move.hotbar_slot = Some(target_hotbar_slot);
        item_to_move.inventory_slot = None;
        item_to_move.player_identity = sender_id; // Assign ownership
        inventory_items.instance_id().update(item_to_move);
    }

    // --- 5. Clear Original Equipment Slot if Necessary --- 
    if original_location_was_equipment {
        log::info!("[MoveHotbar] Clearing original equipment slot for item {}.", item_instance_id);
        clear_specific_item_from_equipment_slots(ctx, sender_id, item_instance_id);
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
    // Logic of the original reducer restored
     let sender_id = ctx.sender;
    log::info!(
        "[SplitStack] Player {:?} attempting to split {} from item {} to {} slot {}",
        sender_id, quantity_to_split, source_item_instance_id, target_slot_type, target_slot_index
    );

    // 1. Get the original item stack
    let mut source_item = get_player_item(ctx, source_item_instance_id)?;

    // 2. Get Item Definition
    let item_def = ctx.db.item_definition().iter()
        .find(|def| def.id == source_item.item_def_id)
        .ok_or_else(|| format!("Definition not found for item ID {}", source_item.item_def_id))?;

    // --- Validations ---
    // a. Must be stackable
    if !item_def.is_stackable {
        return Err(format!("Item '{}' is not stackable.", item_def.name));
    }
    // b. Cannot split zero or negative quantity
    if quantity_to_split == 0 {
        return Err("Cannot split a quantity of 0.".to_string());
    }
    // c. Cannot split more than available (leave at least 1 in original stack)
    if quantity_to_split >= source_item.quantity {
        return Err(format!("Cannot split {} items, only {} available.", quantity_to_split, source_item.quantity));
    }
    // d. Validate target slot type
    let target_is_inventory = match target_slot_type.as_str() {
        "inventory" => true,
        "hotbar" => false,
        _ => return Err(format!("Invalid target slot type: {}. Must be 'inventory' or 'hotbar'.", target_slot_type)),
    };
    // e. Basic range check for target index (adjust ranges if needed)
    if target_is_inventory && target_slot_index >= 24 { // Assuming 24 inventory slots (0-23)
        return Err(format!("Invalid target inventory slot index: {} (must be 0-23).", target_slot_index));
    }
    if !target_is_inventory && target_slot_index >= 6 { // Assuming 6 hotbar slots (0-5)
        return Err(format!("Invalid target hotbar slot index: {} (must be 0-5).", target_slot_index));
    }

    // --- Check if target slot is empty ---
    let target_inventory_slot_check = if target_is_inventory { Some(target_slot_index as u16) } else { None };
    let target_hotbar_slot_check = if !target_is_inventory { Some(target_slot_index as u8) } else { None };

    let target_occupied = ctx.db.inventory_item().iter().any(|i| {
        i.player_identity == sender_id &&
        ((target_is_inventory && i.inventory_slot == target_inventory_slot_check) ||
         (!target_is_inventory && i.hotbar_slot == target_hotbar_slot_check))
    });

    if target_occupied {
        return Err(format!("Target {} slot {} is already occupied.", target_slot_type, target_slot_index));
    }

    // --- Perform the split ---

    // a. Decrease quantity of the source item
    source_item.quantity -= quantity_to_split;
    ctx.db.inventory_item().instance_id().update(source_item.clone()); // Update original stack

    // b. Create the new item stack
    let new_item = InventoryItem {
        instance_id: 0, // Will be auto-generated
        player_identity: sender_id,
        item_def_id: source_item.item_def_id,
        quantity: quantity_to_split,
        hotbar_slot: if !target_is_inventory { Some(target_slot_index as u8) } else { None },
        inventory_slot: if target_is_inventory { Some(target_slot_index as u16) } else { None },
    };
    ctx.db.inventory_item().insert(new_item);

    log::info!(
        "[SplitStack] Successfully split {} of item {} (Def: {}) to {} slot {}. Original stack quantity now {}.",
        quantity_to_split, source_item_instance_id, source_item.item_def_id, 
        target_slot_type, target_slot_index, source_item.quantity
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn move_to_first_available_hotbar_slot(ctx: &ReducerContext, item_instance_id: u64) -> Result<(), String> {
    let sender_id = ctx.sender;
    log::info!("[MoveToFirstAvailHotbar] Player {:?} trying to move item {} to first available hotbar slot.", sender_id, item_instance_id);

    // 1. Validate item exists and belongs to player (get_player_item does this)
    // Need to get the item to check its current location
    let item_to_move = get_player_item(ctx, item_instance_id)?;
    // Check if it's already in the hotbar
    if item_to_move.hotbar_slot.is_some() {
        return Err("Item is already in the hotbar.".to_string());
    }
    // Check if it's in the inventory (must be to move to hotbar like this)
    if item_to_move.inventory_slot.is_none() {
        return Err("Item must be in main inventory to move to hotbar this way.".to_string());
    }


    // 2. Find the first empty hotbar slot (0-5)
    let occupied_slots: std::collections::HashSet<u8> = ctx.db.inventory_item().iter()
        .filter(|i| i.player_identity == sender_id && i.hotbar_slot.is_some())
        .map(|i| i.hotbar_slot.unwrap())
        .collect();

    match (0..6).find(|slot| !occupied_slots.contains(slot)) {
        Some(empty_slot) => {
            log::info!("[MoveToFirstAvailHotbar] Found empty slot: {}. Calling move_item_to_hotbar.", empty_slot);
            // 3. Call the existing move_item_to_hotbar reducer
            move_item_to_hotbar(ctx, item_instance_id, empty_slot)
        }
        None => {
            log::warn!("[MoveToFirstAvailHotbar] No empty hotbar slots available for player {:?}.", sender_id);
            Err("No empty hotbar slots available.".to_string())
        }
    }
}

// ... rest of items.rs ... 