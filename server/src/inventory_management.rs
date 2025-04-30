/******************************************************************************
 *                                                                            *
 * Provides generic traits and handler functions for managing items within    *
 * various container types. This module abstracts common inventory operations *
 * like moving, splitting, and merging items, allowing specific container     *
 * modules (e.g., campfire, wooden_storage_box) to reuse this logic.          *
 *                                                                            *
 ******************************************************************************/

use spacetimedb::{ReducerContext, Identity, Table};
use log;

// Import necessary types and Table Traits
use crate::items::{InventoryItem, ItemDefinition, calculate_merge_result, add_item_to_player_inventory};
use crate::items::{inventory_item as InventoryItemTableTrait, item_definition as ItemDefinitionTableTrait};

// --- Generic Item Container Trait --- 

/// Trait for entities that can hold items in indexed slots.
pub(crate) trait ItemContainer {
    /// Returns the total number of slots in this container.
    fn num_slots(&self) -> usize;

    /// Gets the item instance ID from a specific slot index.
    /// Returns None if the slot index is invalid or the slot is empty.
    fn get_slot_instance_id(&self, slot_index: u8) -> Option<u64>;

    /// Gets the item definition ID from a specific slot index.
    /// Returns None if the slot index is invalid or the slot is empty.
    fn get_slot_def_id(&self, slot_index: u8) -> Option<u64>;

    /// Sets the instance and definition IDs for a specific slot index.
    /// Implementations should handle invalid indices gracefully (e.g., do nothing).
    fn set_slot(&mut self, slot_index: u8, instance_id: Option<u64>, def_id: Option<u64>);
}

// --- Helper: Check if Container is Empty --- 

/// Checks if all slots in an ItemContainer are empty.
pub(crate) fn is_container_empty<C: ItemContainer>(container: &C) -> bool {
    for i in 0..container.num_slots() as u8 {
        if container.get_slot_instance_id(i).is_some() {
            return false; // Found an item, not empty
        }
    }
    true // Went through all slots, all were empty
}

// --- Container Item Search Helper Interface --- 

/// Trait for clearing an item from a container type.
/// Each container module should implement this trait for its container type.
pub(crate) trait ContainerItemClearer {
    /// Search for and remove the specified item instance from this container type.
    /// Returns true if the item was found and removed.
    fn clear_item(ctx: &ReducerContext, item_instance_id: u64) -> bool;
}

// Note: The clear_item_from_any_container function has been moved to items.rs
// to keep inventory_management.rs container-agnostic.

// --- Core Logic Handlers (Refactored to handle more validation) --- 

/// Handles moving an item from player inventory/hotbar INTO a container slot.
pub(crate) fn handle_move_to_container_slot<C: ItemContainer>(
    ctx: &ReducerContext,
    container: &mut C, 
    target_slot_index: u8,
    item_instance_id: u64,
) -> Result<(), String> {
    // Get tables inside handler
    let inventory_table = ctx.db.inventory_item();
    let item_def_table = ctx.db.item_definition();
    let sender_id = ctx.sender;

    // --- Fetch and Validate Item to Move --- 
    let mut item_to_move = inventory_table.instance_id().find(item_instance_id)
        .ok_or(format!("Item instance {} not found", item_instance_id))?;
    let item_def_to_move = item_def_table.id().find(item_to_move.item_def_id)
        .ok_or(format!("Definition missing for item {}", item_to_move.item_def_id))?;
    
    // --- Determine Original Location & Basic Ownership Check --- 
    let original_location_was_equipment = item_to_move.inventory_slot.is_none() && item_to_move.hotbar_slot.is_none();
    if original_location_was_equipment {
        log::debug!("[MoveToContainer] Item {} is potentially coming from an equipment slot.", item_instance_id);
        // If from equipment, player_identity might still be set, skip explicit ownership check here.
        // Equipment removal logic will handle clearing the equipment slot later.
    } else {
        // If it's NOT from equipment, it MUST be from inv/hotbar and owned by the sender.
        if item_to_move.player_identity != sender_id { 
            return Err("Item does not belong to player".to_string()); 
        }
    }

    // --- Validate Target Slot Index --- 
    if target_slot_index >= container.num_slots() as u8 {
        return Err(format!("Target slot index {} out of bounds.", target_slot_index));
    }
    let target_instance_id_opt = container.get_slot_instance_id(target_slot_index);
    
    // --- Pre-update Item State (Clear Player Location Info) ---
    // Store original slots before clearing, needed for swap logic
    let original_inv_slot = item_to_move.inventory_slot;
    let original_hotbar_slot = item_to_move.hotbar_slot;

    // Clear player-specific location info on the item being moved *before* placing/merging/swapping
    item_to_move.inventory_slot = None;
    item_to_move.hotbar_slot = None;
    // Optionally clear player_identity, or keep as "last possessor" but don't rely on it for location.
    // Keeping it for now, but adding a log message for clarity.
    // item_to_move.player_identity = Identity::default(); // Example if clearing identity
    log::debug!("[MoveToContainer] Clearing player slots for item {} (Identity {:?} kept as last possessor).", 
             item_instance_id, item_to_move.player_identity);
    inventory_table.instance_id().update(item_to_move.clone()); // Update the item in DB *now*

    // --- Merge/Swap/Place Logic --- 
    if let Some(target_instance_id) = target_instance_id_opt {
        // Target occupied: Merge or Swap
        let mut target_item = inventory_table.instance_id().find(target_instance_id)
                                .ok_or_else(|| format!("Target item instance {} in container slot {} not found!", target_instance_id, target_slot_index))?;
        // Fetch item_to_move again in case its quantity changed during merge check (unlikely but safer)
        // No, calculate_merge_result takes immutable refs. Use the updated item_to_move from memory.
        match calculate_merge_result(&item_to_move, &target_item, &item_def_to_move) {
            Ok((_, source_new_qty, target_new_qty, delete_source)) => {
                // Merge successful
                log::info!("[InvManager MergeToContainer] Merging item {} onto item {}. Target new qty: {}", item_instance_id, target_instance_id, target_new_qty);
                target_item.quantity = target_new_qty;
                inventory_table.instance_id().update(target_item);
                if delete_source {
                    inventory_table.instance_id().delete(item_instance_id);
                    log::debug!("[InvManager MergeToContainer] Deleted source item {} after merge.", item_instance_id);
                } else {
                    // Source item partially merged, update its quantity (slots already cleared)
                    // We need to refetch it as calculate_merge_result didn't modify it directly
                    if let Some(mut source_item_refetch) = inventory_table.instance_id().find(item_instance_id) {
                         source_item_refetch.quantity = source_new_qty;
                         inventory_table.instance_id().update(source_item_refetch);
                         log::debug!("[InvManager MergeToContainer] Updated source item {} quantity to {} after partial merge.", item_instance_id, source_new_qty);
                    } else {
                         log::error!("[InvManager MergeToContainer] Could not find source item {} to update quantity after partial merge!", item_instance_id);
                    }
                }
                // Container state (target slot) unchanged on merge
            },
            Err(_) => {
                // Merge Failed: Swap
                log::info!("[InvManager SwapToContainer] Cannot merge. Swapping container slot {} with player slot.", target_slot_index);

                // Move target item to player's original slot
                target_item.inventory_slot = original_inv_slot; // Use stored original slot
                target_item.hotbar_slot = original_hotbar_slot; // Use stored original slot
                target_item.player_identity = sender_id; // Assign ownership to player
                inventory_table.instance_id().update(target_item);
                log::debug!("[InvManager SwapToContainer] Moved target item {} to player {:?} original slot (Inv: {:?}, Hotbar: {:?})", 
                         target_instance_id, sender_id, original_inv_slot, original_hotbar_slot);
                
                // Source item's state (slots cleared) was already updated before this block.
                // Now, update the container slot to hold the source item.
                container.set_slot(target_slot_index, Some(item_instance_id), Some(item_def_to_move.id));
                log::debug!("[InvManager SwapToContainer] Set container slot {} to hold source item {}", target_slot_index, item_instance_id);
            }
        }
    } else {
        // Target Empty: Place
        log::info!("[InvManager PlaceInContainer] Placing item {} into empty container slot {}", item_instance_id, target_slot_index);
        // Item state (slots cleared) was already updated before this block.
        // Just update the container state.
        container.set_slot(target_slot_index, Some(item_instance_id), Some(item_def_to_move.id));
    }

    // --- Clear Original Equipment Slot if Necessary --- 
    if original_location_was_equipment {
        log::info!("[MoveToContainer] Clearing original equipment slot for item {}.", item_instance_id);
        // Call helper using crate path
        crate::items::clear_specific_item_from_equipment_slots(ctx, sender_id, item_instance_id);
    }

    Ok(())
}

/// Handles moving an item FROM a container slot TO the player's inventory.
pub(crate) fn handle_move_from_container_slot<C: ItemContainer>(
    ctx: &ReducerContext, 
    container: &mut C, 
    source_slot_index: u8,
    target_slot_type: String, 
    target_slot_index: u32 // Use u32 to match split args
) -> Result<(), String> {
    let sender_id = ctx.sender;
    let inventory_table = ctx.db.inventory_item(); // Get inventory table handle

    // --- Fetch and Validate Item to Move --- 
    if source_slot_index >= container.num_slots() as u8 {
        return Err(format!("Source slot index {} out of bounds.", source_slot_index));
    }
    let source_instance_id = container.get_slot_instance_id(source_slot_index)
        .ok_or_else(|| format!("Source slot {} in container is empty", source_slot_index))?;

    log::info!("[InvManager FromContainer] Attempting move item {} from container slot {} to player {:?} {} slot {}", 
             source_instance_id, source_slot_index, sender_id, target_slot_type, target_slot_index);
    
    // --- Call specific move function from player_inventory.rs --- 
    // These functions handle merging/swapping within player inventory/hotbar
    let move_result = match target_slot_type.as_str() {
        "inventory" => {
            if target_slot_index >= 24 { return Err("Invalid inventory target index".to_string()); }
            crate::player_inventory::move_item_to_inventory(ctx, source_instance_id, target_slot_index as u16)
        },
        "hotbar" => {
            if target_slot_index >= 6 { return Err("Invalid hotbar target index".to_string()); }
            crate::player_inventory::move_item_to_hotbar(ctx, source_instance_id, target_slot_index as u8)
        },
        _ => Err(format!("Invalid target slot type '{}'", target_slot_type)),
    };

    // --- If move successful, update item state and clear container slot --- 
    match move_result {
        Ok(_) => {
            log::debug!("[InvManager FromContainer] Move to player successful for item {}. Updating item state.", source_instance_id);
            // Fetch the item again as the move functions might have updated its quantity (merge) or instance ID (swap)
            // Note: We use source_instance_id because even on swap, the item *originally* in the container slot ends up in the player inventory.
            if let Some(mut item_now_with_player) = inventory_table.instance_id().find(source_instance_id) {
                // Explicitly set player identity and slots
                item_now_with_player.player_identity = sender_id;
                if target_slot_type == "inventory" {
                    item_now_with_player.inventory_slot = Some(target_slot_index as u16);
                    item_now_with_player.hotbar_slot = None; // Ensure other slot is clear
                } else { // hotbar
                    item_now_with_player.inventory_slot = None; // Ensure other slot is clear
                    item_now_with_player.hotbar_slot = Some(target_slot_index as u8);
                }
                
                // --- Store slot values BEFORE moving item_now_with_player --- 
                let final_inv_slot = item_now_with_player.inventory_slot;
                let final_hotbar_slot = item_now_with_player.hotbar_slot;

                // Update the item in the DB (moves item_now_with_player)
                inventory_table.instance_id().update(item_now_with_player);
                
                log::debug!("[InvManager FromContainer] Updated item {} state (Player: {:?}, InvSlot: {:?}, HotbarSlot: {:?}). Clearing container slot {}.", 
                         source_instance_id, sender_id, final_inv_slot, final_hotbar_slot, source_slot_index);
                
                // NOW clear the container slot
                container.set_slot(source_slot_index, None, None);
                
            } else {
                 // This should ideally not happen if move_result was Ok, but handle defensively.
                 log::error!("[InvManager FromContainer] Could not find item {} to update state after successful move to player! Container slot {} may be cleared incorrectly.", 
                          source_instance_id, source_slot_index);
                 // Still clear the container slot based on the Ok result, but log the inconsistency.
                 container.set_slot(source_slot_index, None, None);
                 // Return an error because the state is inconsistent.
                 return Err(format!("Internal error: Item {} disappeared after move.", source_instance_id));
            }
            Ok(()) // Return Ok since the overall operation succeeded
        }
        Err(e) => {
            // If move failed, log and return the error. Do not clear the container slot.
            log::error!("[InvManager FromContainer] Failed to move item {} to player: {}. Container slot {} unchanged.",
                     source_instance_id, e, source_slot_index);
            Err(e) // Return the original error
        }
    }
}

/// Handles moving an item BETWEEN slots within the same container.
pub(crate) fn handle_move_within_container<C: ItemContainer>(
    ctx: &ReducerContext,
    container: &mut C,
    source_slot_index: u8,
    target_slot_index: u8
) -> Result<(), String> {
    // Get tables inside handler
    let inventory_table = ctx.db.inventory_item();
    let item_def_table = ctx.db.item_definition();

    // --- Validate Slots & Fetch Items --- 
    if source_slot_index >= container.num_slots() as u8 
        || target_slot_index >= container.num_slots() as u8 
        || source_slot_index == target_slot_index {
        return Err("Invalid source or target slot index".to_string());
    }
    let source_instance_id = container.get_slot_instance_id(source_slot_index)
        .ok_or(format!("Source slot {} is empty", source_slot_index))?;
    let source_def_id = container.get_slot_def_id(source_slot_index)
        .ok_or("Source definition ID missing")?;
    let mut source_item = inventory_table.instance_id().find(source_instance_id).ok_or("Source item not found")?;
    
    let target_instance_id_opt = container.get_slot_instance_id(target_slot_index);
    let target_def_id_opt = container.get_slot_def_id(target_slot_index);

    // --- Merge/Swap/Move Logic --- 
    if let Some(target_instance_id) = target_instance_id_opt {
        // Target occupied: Try Merge then Swap
        let mut source_item = inventory_table.instance_id().find(source_instance_id).ok_or("Source item not found")?;
        let mut target_item = inventory_table.instance_id().find(target_instance_id).ok_or("Target item not found")?;
        let item_def = item_def_table.id().find(source_def_id).ok_or("Item definition not found")?;

        match calculate_merge_result(&source_item, &target_item, &item_def) {
            Ok((_, source_new_qty, target_new_qty, delete_source)) => {
                // Merge Possible
                log::info!("[InvManager WithinContainer Merge] Merging slot {} onto slot {}", source_slot_index, target_slot_index);
                target_item.quantity = target_new_qty;
                inventory_table.instance_id().update(target_item);
                if delete_source {
                    inventory_table.instance_id().delete(source_instance_id);
                } else {
                    source_item.quantity = source_new_qty;
                    inventory_table.instance_id().update(source_item);
                }
                container.set_slot(source_slot_index, None, None); // Clear source slot
            },
            Err(_) => {
                // Merge Failed: Swap
                log::info!("[InvManager WithinContainer Swap] Swapping slot {} and {}", source_slot_index, target_slot_index);
                container.set_slot(target_slot_index, Some(source_instance_id), Some(source_def_id));
                container.set_slot(source_slot_index, target_instance_id_opt, target_def_id_opt);
            }
        }
    } else {
        // Target Empty: Move
        log::info!("[InvManager WithinContainer Move] Moving from slot {} to empty slot {}", source_slot_index, target_slot_index);
        container.set_slot(target_slot_index, Some(source_instance_id), Some(source_def_id));
        container.set_slot(source_slot_index, None, None);
    }
    Ok(())
}

// --- Split Handlers (Accessing ctx.db directly) --- 

/// Handles splitting a stack FROM player inventory INTO an empty container slot.
/// Updates the `container` struct directly, but caller must commit the change to the DB.
pub(crate) fn handle_split_into_container<C: ItemContainer>(
    ctx: &ReducerContext,
    container: &mut C, 
    target_slot_index: u8,
    source_item: &mut InventoryItem, 
    quantity_to_split: u32
) -> Result<(), String> {
    // NOTE: Source item validation (ownership, location, quantity, stackability) is done in the REDUCER before calling this.
    // This handler assumes the split is valid and just performs the split + placement/merge.
    log::info!("[InvManager SplitToContainer] Splitting {} from item {} into container slot {}", 
             quantity_to_split, source_item.instance_id, target_slot_index);

    // --- Validate Target Slot Index --- 
    if target_slot_index >= container.num_slots() as u8 {
        return Err(format!("Target slot index {} out of bounds.", target_slot_index));
    }

    let inventory_table = ctx.db.inventory_item();
    let item_def_table = ctx.db.item_definition();

    // 1. Perform split using helper from items.rs
    // This updates source_item quantity and creates a new item instance.
    let new_item_instance_id = crate::items::split_stack_helper(ctx, source_item, quantity_to_split)?;
    let new_item_def_id = source_item.item_def_id; // Get def_id from potentially updated source_item
    
    // --- Pre-update NEW Item State (Clear Player Location Info) ---
    // Find the newly created item
    let mut new_item = inventory_table.instance_id().find(new_item_instance_id)
                       .ok_or("Failed to find newly split item instance after creation")?;
    // Clear player-specific location info on the NEW item *before* placing/merging
    new_item.inventory_slot = None;
    new_item.hotbar_slot = None;
    // Keep original player_identity as "last possessor" or clear if desired
    log::debug!("[InvManager SplitToContainer] Clearing player slots for new item {} (Identity {:?} kept).", 
             new_item_instance_id, new_item.player_identity);
    inventory_table.instance_id().update(new_item.clone()); // Update the new item in DB *now*

    // Find the item definition (needed for merge check)
    let new_item_def = item_def_table.id().find(new_item_def_id)
                        .ok_or("Failed to find definition for new item")?;

    // 2. Check if target slot is occupied
    if let Some(target_instance_id) = container.get_slot_instance_id(target_slot_index) {
        // --- Target Occupied: Attempt Merge --- 
        log::debug!("[InvManager SplitToContainer] Target slot {} occupied by {}, attempting merge.", target_slot_index, target_instance_id);
        let mut target_item = inventory_table.instance_id().find(target_instance_id)
                            .ok_or_else(|| format!("Target item {} in container slot {} not found!", target_instance_id, target_slot_index))?;

        match calculate_merge_result(&new_item, &target_item, &new_item_def) {
            Ok((_, _source_new_qty, target_new_qty, delete_source)) => {
                // Merge successful
                log::info!("[InvManager SplitToContainer Merge] Merging new item {} onto target {}. Target new qty: {}", 
                         new_item_instance_id, target_instance_id, target_new_qty);
                target_item.quantity = target_new_qty;
                inventory_table.instance_id().update(target_item);
                if delete_source { 
                    // The new item was fully merged, delete it
                    inventory_table.instance_id().delete(new_item_instance_id);
                    log::debug!("[InvManager SplitToContainer Merge] New item {} deleted after merge.", new_item_instance_id);
                } else {
                    // Should not happen if merging the *entire* new stack, but handle defensively
                    log::warn!("[InvManager SplitToContainer Merge] New item {} not deleted after merge? New Qty: {}", 
                             new_item_instance_id, _source_new_qty); 
                    // Update the container slot anyway, overwriting the old target
                    container.set_slot(target_slot_index, Some(new_item_instance_id), Some(new_item_def_id));
                }
                // Container state for the target slot doesn't change if merge succeeded on existing item
            },
            Err(e) => {
                // Merge Failed (different types, target full, etc.) - Cannot place split item here.
                // Revert the split by giving quantity back? No, helper already updated source.
                // We must delete the newly created item and return error.
                log::warn!("[InvManager SplitToContainer Merge Failed] Cannot merge split item {} onto target {}: {}. Deleting split item.",
                         new_item_instance_id, target_instance_id, e);
                inventory_table.instance_id().delete(new_item_instance_id);
                return Err(format!("Cannot merge split stack onto item in slot {}: {}", target_slot_index, e));
            }
        }
    } else {
        // --- Target Empty: Place --- 
        log::debug!("[InvManager SplitToContainer] Target slot {} empty. Placing new item {}.", target_slot_index, new_item_instance_id);
        // Update the container struct state with the NEW item using trait method
        container.set_slot(target_slot_index, Some(new_item_instance_id), Some(new_item_def_id));
    }

    Ok(())
}

/// Handles splitting a stack FROM a container slot TO player inventory/hotbar.
pub(crate) fn handle_split_from_container<C: ItemContainer>(
    ctx: &ReducerContext,
    container: &mut C, 
    source_slot_index: u8,
    quantity_to_split: u32,
    target_slot_type: String, 
    target_slot_index: u32
) -> Result<(), String> {
    // Get tables inside handler
    let inventory_table = ctx.db.inventory_item();
    let item_defs = ctx.db.item_definition(); // Needed for stackability check
    let sender_id = ctx.sender;

    // --- Fetch and Validate Source Item --- 
    if source_slot_index >= container.num_slots() as u8 {
        return Err(format!("Source slot index {} out of bounds.", source_slot_index));
    }
     let source_instance_id = container.get_slot_instance_id(source_slot_index)
        .ok_or(format!("Source slot {} is empty", source_slot_index))?;
    let source_def_id = container.get_slot_def_id(source_slot_index)
        .ok_or("Missing definition ID in source slot")?;
    let mut source_item = inventory_table.instance_id().find(source_instance_id)
        .ok_or("Source item instance not found")?;
    if quantity_to_split == 0 || quantity_to_split >= source_item.quantity {
        return Err("Invalid split quantity".to_string());
    }
    let item_def = item_defs.id().find(source_def_id).ok_or("Item definition not found")?;
    if !item_def.is_stackable { return Err("Source item is not stackable".to_string()); }

    // --- Validate Target --- 
    let target_is_inventory = match target_slot_type.as_str() {
        "inventory" => true,
        "hotbar" => false,
        _ => return Err("Invalid target_slot_type".to_string()),
    };
    if target_is_inventory && target_slot_index >= 24 { return Err("Invalid inventory target index".to_string()); }
    if !target_is_inventory && target_slot_index >= 6 { return Err("Invalid hotbar target index".to_string()); }

    log::info!("[InvManager SplitFromContainer] Splitting {} from container slot {} to player {} slot {}",
             quantity_to_split, source_slot_index, target_slot_type, target_slot_index);

    // 1. Perform split using helper
    let new_item_instance_id = crate::items::split_stack_helper(ctx, &mut source_item, quantity_to_split)?;

    // 2. Move the NEWLY CREATED stack to the target player slot
    log::debug!("[InvManager SplitFromContainer] Moving new item {} to player {}", new_item_instance_id, sender_id);
    
    // Fetch the new stack to update its identity before moving
    let mut new_item_stack = inventory_table.instance_id().find(new_item_instance_id)
                            .ok_or("Newly split item stack not found!")?;
    
    // --- Explicitly set player identity and clear slots BEFORE move ---
    new_item_stack.player_identity = sender_id; 
    new_item_stack.inventory_slot = None; // Ensure slots are clear before move attempt
    new_item_stack.hotbar_slot = None;
    inventory_table.instance_id().update(new_item_stack); // Update state before move

    // Call appropriate move function from player_inventory.rs 
    let move_result = if target_slot_type == "inventory" {
        crate::player_inventory::move_item_to_inventory(ctx, new_item_instance_id, target_slot_index as u16)
    } else if target_slot_type == "hotbar" {
        crate::player_inventory::move_item_to_hotbar(ctx, new_item_instance_id, target_slot_index as u8)
    } else {
        ctx.db.inventory_item().instance_id().delete(new_item_instance_id); 
        Err(format!("Invalid target slot type '{}' in split handler", target_slot_type))
    };

    // If move to player failed (e.g., full inventory), log the error and return it.
    if let Err(ref e) = move_result { // Borrow the error for logging
        log::error!("[InvManager SplitFromContainer] Failed to move split stack {} to player: {:?}. Original stack quantity remains reduced.", 
                  new_item_instance_id, e); // Log the borrowed error `e`
        return move_result; // Return the original error Result
    }

    // If move was successful, clear the source slot in the container struct
    // container.set_slot(source_slot_index, None, None); // REMOVED: This was incorrect, split_stack_helper updates original item qty.
    Ok(())
}

/// Handles splitting a stack BETWEEN two slots within the same container.
pub(crate) fn handle_split_within_container<C: ItemContainer>(
    ctx: &ReducerContext,
    container: &mut C,
    source_slot_index: u8,
    target_slot_index: u8,
    quantity_to_split: u32
) -> Result<(), String> {
    // Get tables inside handler
    let inventory_table = ctx.db.inventory_item();
    let item_defs = ctx.db.item_definition();

     log::info!("[InvManager SplitWithinContainer] Splitting {} from slot {} to slot {} within container",
             quantity_to_split, source_slot_index, target_slot_index);

    // --- Fetch and Validate Source & Target --- 
    if source_slot_index >= container.num_slots() as u8 
        || target_slot_index >= container.num_slots() as u8 
        || source_slot_index == target_slot_index {
        return Err("Invalid source or target slot index".to_string());
    }
    let source_instance_id = container.get_slot_instance_id(source_slot_index)
        .ok_or(format!("Source slot {} is empty", source_slot_index))?;
    let mut source_item = inventory_table.instance_id().find(source_instance_id)
        .ok_or("Source item instance not found")?;
    if quantity_to_split == 0 || quantity_to_split >= source_item.quantity {
        return Err("Invalid split quantity".to_string());
    }
    let item_def = item_defs.id().find(source_item.item_def_id).ok_or("Item definition not found")?;
    if !item_def.is_stackable { return Err("Source item is not stackable".to_string()); }

    // --- Perform Split --- 
    let new_item_instance_id = crate::items::split_stack_helper(ctx, &mut source_item, quantity_to_split)?;
    let new_item_def_id = source_item.item_def_id;
    // Find the newly created item (needed for merging)
    let mut new_item = inventory_table.instance_id().find(new_item_instance_id)
                       .ok_or("Failed to find newly split item instance")?;
    let new_item_def = item_defs.id().find(new_item_def_id)
                        .ok_or("Failed to find definition for new item")?;

    // --- Place New Stack or Merge --- 
    if let Some(target_instance_id) = container.get_slot_instance_id(target_slot_index) {
        // --- Target Occupied: Attempt Merge --- 
        log::debug!("[InvManager SplitWithinContainer] Target slot {} occupied by {}, attempting merge.", target_slot_index, target_instance_id);
        let mut target_item = inventory_table.instance_id().find(target_instance_id)
                            .ok_or_else(|| format!("Target item {} in container slot {} not found!", target_instance_id, target_slot_index))?;

        match calculate_merge_result(&new_item, &target_item, &new_item_def) {
            Ok((_, _source_new_qty, target_new_qty, delete_source)) => {
                // Merge successful
                log::info!("[InvManager SplitWithinContainer Merge] Merging new item {} onto target {}. Target new qty: {}", 
                         new_item_instance_id, target_instance_id, target_new_qty);
                target_item.quantity = target_new_qty;
                inventory_table.instance_id().update(target_item);
                if delete_source { 
                    inventory_table.instance_id().delete(new_item_instance_id);
                    log::debug!("[InvManager SplitWithinContainer Merge] New item {} deleted after merge.", new_item_instance_id);
                } else {
                     log::warn!("[InvManager SplitWithinContainer Merge] New item {} not deleted after merge? New Qty: {}", 
                             new_item_instance_id, _source_new_qty); 
                    // Overwrite target slot if merge didn't delete source (unexpected)
                     container.set_slot(target_slot_index, Some(new_item_instance_id), Some(new_item_def_id));
                }
            },
            Err(e) => {
                 // Merge Failed - Error out, delete the split stack
                log::warn!("[InvManager SplitWithinContainer Merge Failed] Cannot merge split item {} onto target {}: {}. Deleting split item.",
                         new_item_instance_id, target_instance_id, e);
                inventory_table.instance_id().delete(new_item_instance_id);
                return Err(format!("Cannot merge split stack onto item in slot {}: {}", target_slot_index, e));
            }
        }

    } else {
        // --- Target Empty: Place --- 
        log::debug!("[InvManager SplitWithinContainer] Target slot {} empty. Placing new item {}.", target_slot_index, new_item_instance_id);
        container.set_slot(target_slot_index, Some(new_item_instance_id), Some(new_item_def_id));
    }

    Ok(())
}

/// Handles quickly moving an item FROM a container slot TO the player inventory.
/// Assumes validation (distance, etc.) is done by the calling reducer.
/// Updates the `container` struct directly, but caller must commit the change to the DB.
pub(crate) fn handle_quick_move_from_container<C: ItemContainer>(
    ctx: &ReducerContext, 
    container: &mut C, 
    source_slot_index: u8
) -> Result<(), String> {
    let inventory_table = ctx.db.inventory_item();
    let item_defs = ctx.db.item_definition(); // Needed for stacking check
    let sender_id = ctx.sender;

    // Get item info using trait methods
    let source_instance_id = container.get_slot_instance_id(source_slot_index)
        .ok_or_else(|| format!("Source slot {} in container is empty", source_slot_index))?;
    let source_def_id = container.get_slot_def_id(source_slot_index)
        .ok_or_else(|| format!("Missing definition ID in source slot {}", source_slot_index))?;
    
    // Fetch the item to move
    let mut item_to_move = inventory_table.instance_id().find(source_instance_id)
        .ok_or("Item instance in container slot not found in inventory table")?;
    let item_def = item_defs.id().find(source_def_id)
        .ok_or("Item definition not found")?;

    log::info!("[InvManager QuickFromContainer] Moving item {} (Def {}) from container slot {} to player {:?} inventory", 
             source_instance_id, source_def_id, source_slot_index, sender_id);

    // --- Logic to add/merge item into player inventory --- 
    let mut remaining_quantity = item_to_move.quantity;
    let mut item_deleted_from_container = false;

    // 1. Try merging onto existing stacks (Hotbar first, then Inventory)
    if item_def.is_stackable {
        let mut items_to_update: Vec<InventoryItem> = Vec::new();
        // Hotbar merge attempt
        for mut target_item in inventory_table.iter().filter(|i| i.player_identity == sender_id && i.item_def_id == source_def_id && i.hotbar_slot.is_some()) {
            let space_available = item_def.stack_size.saturating_sub(target_item.quantity);
            if space_available > 0 {
                let transfer_qty = std::cmp::min(remaining_quantity, space_available);
                target_item.quantity += transfer_qty;
                remaining_quantity -= transfer_qty;
                items_to_update.push(target_item); // Stage update
                if remaining_quantity == 0 { break; }
            }
        }
        // Inventory merge attempt
        if remaining_quantity > 0 {
            for mut target_item in inventory_table.iter().filter(|i| i.player_identity == sender_id && i.item_def_id == source_def_id && i.inventory_slot.is_some()) {
                 let space_available = item_def.stack_size.saturating_sub(target_item.quantity);
                 if space_available > 0 {
                    let transfer_qty = std::cmp::min(remaining_quantity, space_available);
                    target_item.quantity += transfer_qty;
                    remaining_quantity -= transfer_qty;
                    items_to_update.push(target_item); // Stage update
                    if remaining_quantity == 0 { break; }
                }
            }
        }
        // Apply merged updates
        for updated_item in items_to_update {
             inventory_table.instance_id().update(updated_item);
        }
    }

    // 2. If quantity remains, find empty slot (Hotbar first, then Inventory)
    if remaining_quantity > 0 {
        // Use helper from player_inventory module
        let target_slot: Option<(String, u32)> = crate::player_inventory::find_first_empty_player_slot(ctx, sender_id);

        if let Some((slot_type, slot_index)) = target_slot {
            // Assign the *original item* to the empty slot
            item_to_move.player_identity = sender_id; // Ensure ownership
            item_to_move.quantity = remaining_quantity; // Update quantity if partially merged
            if slot_type == "hotbar" {
                item_to_move.hotbar_slot = Some(slot_index as u8);
                item_to_move.inventory_slot = None;
            } else {
                item_to_move.hotbar_slot = None;
                item_to_move.inventory_slot = Some(slot_index as u16);
            }
            inventory_table.instance_id().update(item_to_move);
            log::info!("[InvManager QuickFromContainer] Placed item {} (Qty {}) into {} slot {}", source_instance_id, remaining_quantity, slot_type, slot_index);
            item_deleted_from_container = true; // The item instance is now fully owned by the player
        } else {
             log::warn!("[InvManager QuickFromContainer] Inventory full for player {:?}. Could not place remaining {} of item {}. Item remains in container.", 
                      sender_id, remaining_quantity, source_instance_id);
            return Err("Inventory is full".to_string());
        }
    } else {
        // Item fully merged, delete the original instance
        log::info!("[InvManager QuickFromContainer] Item {} fully merged. Deleting instance.", source_instance_id);
        inventory_table.instance_id().delete(source_instance_id);
        item_deleted_from_container = true;
    }

    // --- If item was successfully moved/merged/deleted, clear container slot --- 
    if item_deleted_from_container {
        container.set_slot(source_slot_index, None, None);
    }
    
    Ok(()) 
}

/// Handles quickly moving an item FROM the player inventory/hotbar INTO the first
/// available/mergeable slot in the container.
pub(crate) fn handle_quick_move_to_container<C: ItemContainer>(
    ctx: &ReducerContext,
    container: &mut C,
    item_instance_id: u64,
) -> Result<(), String> {
    // Get tables
    let inventory_table = ctx.db.inventory_item();
    let item_def_table = ctx.db.item_definition();
    let sender_id = ctx.sender;
    
    // --- Fetch and Validate Item --- 
    let mut item_to_move = inventory_table.instance_id().find(item_instance_id)
        .ok_or(format!("Item instance {} not found", item_instance_id))?;
    let item_def_to_move = item_def_table.id().find(item_to_move.item_def_id)
        .ok_or(format!("Definition missing for item {}", item_to_move.item_def_id))?;
    
    // --- Determine Original Location & Basic Ownership Check --- 
    let original_location_was_equipment = item_to_move.inventory_slot.is_none() && item_to_move.hotbar_slot.is_none();
    if original_location_was_equipment {
        log::debug!("[QuickMoveToContainer] Item {} is potentially coming from an equipment slot.", item_instance_id);
    } else {
         // Ownership check if not from equipment
         if item_to_move.player_identity != sender_id {
             return Err("Item does not belong to player".to_string());
         }
    }

    // --- Pre-update Item State (Clear Player Location Info) ---
    let original_inv_slot = item_to_move.inventory_slot; // Store for potential swap/equipment clear/restore
    let original_hotbar_slot = item_to_move.hotbar_slot;
    item_to_move.inventory_slot = None;
    item_to_move.hotbar_slot = None;
    // Keep player_identity as last possessor
    log::debug!("[QuickMoveToContainer] Clearing player slots for item {} before merge/place attempt.", item_instance_id);
    inventory_table.instance_id().update(item_to_move.clone()); // Update DB now

    let mut operation_occured = false; 
    let mut item_instance_id_to_use = item_instance_id; // Keep track of the ID being manipulated
    let mut current_quantity = item_to_move.quantity; // Track remaining quantity

    // 1. Attempt to merge with existing stacks
    if item_def_to_move.is_stackable {
        for slot_index in 0..container.num_slots() as u8 {
            if current_quantity == 0 { break; } // Stop if item fully merged

            if let Some(target_instance_id) = container.get_slot_instance_id(slot_index) {
                if container.get_slot_def_id(slot_index) == Some(item_def_to_move.id) { // Check if same item type
                    let mut target_item = inventory_table.instance_id().find(target_instance_id)
                                            .ok_or_else(|| format!("Target item {} in slot {} missing!", target_instance_id, slot_index))?;
                    
                    // Fetch the latest state of the item being moved for merge calculation source
                    // Needed because its quantity might change across loop iterations if we merge onto multiple stacks
                    let current_item_to_move_state = inventory_table.instance_id().find(item_instance_id_to_use)
                                                     .ok_or_else(|| format!("Source item {} disappeared during merge loop!", item_instance_id_to_use))?;

                    match calculate_merge_result(&current_item_to_move_state, &target_item, &item_def_to_move) {
                        Ok((qty_transfer, source_new_qty, target_new_qty, delete_source)) => {
                            if qty_transfer > 0 { // Only proceed if merge actually happened
                                log::info!("[InvManager QuickToContainer Merge] Merging {} from item {} onto item {} in slot {}",
                                        qty_transfer, item_instance_id_to_use, target_instance_id, slot_index);
                                target_item.quantity = target_new_qty;
                                inventory_table.instance_id().update(target_item);
                                
                                // Update remaining quantity
                                current_quantity -= qty_transfer;
                                
                                if delete_source || current_quantity == 0 {
                                    log::debug!("[InvManager QuickToContainer Merge] Source item {} fully merged. Deleting instance.", item_instance_id_to_use);
                                    inventory_table.instance_id().delete(item_instance_id_to_use);
                                    current_quantity = 0; // Ensure quantity is zero
                                    operation_occured = true;
                                    // If source fully merged, we are done with this quick move
                                    break; 
                                } else {
                                     // Item partially merged, update its quantity in the DB
                                     // Fetch again to ensure we have latest state before updating qty
                                     if let Some(mut source_item_to_update) = inventory_table.instance_id().find(item_instance_id_to_use) {
                                         source_item_to_update.quantity = source_new_qty; // Use calculated source_new_qty
                                         inventory_table.instance_id().update(source_item_to_update);
                                         log::debug!("[InvManager QuickToContainer Merge] Updated partially merged source item {} qty to {}", item_instance_id_to_use, source_new_qty);
                                     } else {
                                         log::error!("[InvManager QuickToContainer Merge] Failed to find source item {} to update after partial merge!", item_instance_id_to_use);
                                         // This is problematic, maybe abort? For now, log and continue.
                                     }
                                     operation_occured = true;
                                }
                                // Continue loop to merge into other stacks if possible
                            }
                        },
                        Err(_) => { /* Merge not possible (e.g., target full), continue loop */ }
                    }
                }
            }
        }
    }

    // 2. If quantity remains, find first empty slot and place it
    if current_quantity > 0 {
        let mut empty_slot_found: Option<u8> = None;
        for slot_index in 0..container.num_slots() as u8 {
            if container.get_slot_instance_id(slot_index).is_none() {
                empty_slot_found = Some(slot_index);
                break;
            }
        }

        if let Some(target_slot_index) = empty_slot_found {
            log::info!("[InvManager QuickToContainer Place] Placing remaining {} of item {} into empty slot {}",
                    current_quantity, item_instance_id_to_use, target_slot_index);
            
            // The item state (slots cleared) was updated before the merge loop.
            // Quantity might have been updated *during* the merge loop if partial merge happened.
            // If quantity didn't change from initial state (no partial merge), no extra DB update needed here.
            // If it did change, it was updated inside the merge loop.
            
            // Update container state
            container.set_slot(target_slot_index, Some(item_instance_id_to_use), Some(item_def_to_move.id));
            operation_occured = true;
        } else {
            // No empty slot found. Handle based on whether merge occurred.
            if operation_occured { // Merge happened, but no room for remainder
                log::info!("[InvManager QuickToContainer] Partially merged item {}, but no empty slot for remainder {}. Remainder stays with player.", item_instance_id_to_use, current_quantity);
                 // Restore original player slots since it didn't fully move
                 if let Some(mut item_to_restore_slots) = inventory_table.instance_id().find(item_instance_id_to_use) {
                      item_to_restore_slots.inventory_slot = original_inv_slot;
                      item_to_restore_slots.hotbar_slot = original_hotbar_slot;
                      // Quantity was already updated during merge loop if needed
                      inventory_table.instance_id().update(item_to_restore_slots);
                      log::debug!("[InvManager QuickToContainer] Restored player slots for partially moved item {}.", item_instance_id_to_use);
                 } else {
                     log::error!("[InvManager QuickToContainer] Failed to find item {} to restore slots after partial merge failure!", item_instance_id_to_use);
                 }
                 // Return Ok because *some* operation (merge) happened. Item remains partially with player.
            } else { // No merge AND no place possible. Restore original item state fully.
                log::warn!("[InvManager QuickToContainer] Failed: No stack to merge onto and no empty slots for item {}. Restoring original player state.", item_instance_id_to_use);
                 if let Some(mut item_to_restore) = inventory_table.instance_id().find(item_instance_id_to_use) {
                      // Restore original slots (quantity was never changed)
                      item_to_restore.inventory_slot = original_inv_slot;
                      item_to_restore.hotbar_slot = original_hotbar_slot;
                      inventory_table.instance_id().update(item_to_restore);
                      log::debug!("[InvManager QuickToContainer] Restored player slots for failed move item {}.", item_instance_id_to_use);
                 } else {
                      log::error!("[InvManager QuickToContainer] Failed to find item {} to restore state after failed quick move!", item_instance_id_to_use);
                 }
                return Err("Container is full".to_string());
            }
        }
    }

    // --- Clear Original Equipment Slot if Necessary --- 
    // Only clear if the item was fully moved (current_quantity == 0) 
    if original_location_was_equipment && operation_occured && current_quantity == 0 { 
        log::info!("[MoveToContainer] Clearing original equipment slot for item {}.", item_instance_id);
        // Call helper using crate path - make sure this helper is accessible (it's in items.rs)
        crate::items::clear_specific_item_from_equipment_slots(ctx, sender_id, item_instance_id);
    }

    Ok(())
}