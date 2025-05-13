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
// Import new models
use crate::models::{ItemLocation, ContainerType, EquipmentSlotType};
// Import player inventory helpers
use crate::player_inventory::{move_item_to_inventory, move_item_to_hotbar, find_first_empty_player_slot, NUM_PLAYER_INVENTORY_SLOTS, NUM_PLAYER_HOTBAR_SLOTS};

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

    // --- NEW Methods for ItemLocation Refactor ---

    /// Get the specific ContainerType enum variant for this container.
    fn get_container_type(&self) -> ContainerType;

    /// Get the unique ID of this specific container instance.
    /// This might be a u32 entity ID, a u64 table row ID, or similar.
    /// Needs to be consistently represented, perhaps as u64?
    fn get_container_id(&self) -> u64; 
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

/// Handles moving an item from player inventory/hotbar/equipment INTO a container slot.
pub(crate) fn handle_move_to_container_slot<C: ItemContainer>(
    ctx: &ReducerContext,
    container: &mut C, 
    target_slot_index: u8,
    item_instance_id: u64,
) -> Result<(), String> {
    let inventory_table = ctx.db.inventory_item();
    let item_def_table = ctx.db.item_definition();
    let sender_id = ctx.sender;

    // --- Fetch and Validate Item to Move --- 
    let mut item_to_move = inventory_table.instance_id().find(item_instance_id)
        .ok_or(format!("Item instance {} not found", item_instance_id))?;
    let item_def_to_move = item_def_table.id().find(item_to_move.item_def_id)
        .ok_or(format!("Definition missing for item {}", item_to_move.item_def_id))?;
    
    // --- Determine Original Location & Validate Ownership/Possession --- 
    let original_location = item_to_move.location.clone();
    let original_equipment_slot_type: Option<EquipmentSlotType> = match &original_location {
        ItemLocation::Inventory(ref data) => {
            if data.owner_id != sender_id {
                return Err("Item not in sender's possession.".to_string());
            }
            None
        }
        ItemLocation::Hotbar(ref data) => {
            if data.owner_id != sender_id {
                return Err("Item not in sender's possession.".to_string());
            }
            None
        }
        ItemLocation::Equipped(ref data) => {
            if data.owner_id != sender_id {
                return Err("Item not in sender's possession.".to_string());
            }
            Some(data.slot_type.clone())
        }
        ItemLocation::Container(_) => return Err("Cannot move item from another container using this function.".to_string()),
        ItemLocation::Dropped(_) => return Err("Cannot move dropped item using this function.".to_string()),
        ItemLocation::Unknown => return Err("Item has an unknown location.".to_string()),
    };

    // --- Validate Target Slot Index --- 
    if target_slot_index >= container.num_slots() as u8 {
        return Err(format!("Target slot index {} out of bounds.", target_slot_index));
    }
    let target_instance_id_opt = container.get_slot_instance_id(target_slot_index);
    let new_item_location = ItemLocation::Container(crate::models::ContainerLocationData {
        container_id: container.get_container_id(),
        container_type: container.get_container_type(),
        slot_index: target_slot_index,
    });
    
    // --- Merge/Swap/Place Logic --- 
    if let Some(target_instance_id) = target_instance_id_opt {
        // Target occupied: Merge or Swap
        let mut target_item = inventory_table.instance_id().find(target_instance_id)
                                .ok_or_else(|| format!("Target item instance {} in container slot {} not found!", target_instance_id, target_slot_index))?;
        
        match calculate_merge_result(&item_to_move, &target_item, &item_def_to_move) {
            Ok((_, source_new_qty, target_new_qty, delete_source)) => {
                // Merge successful
                log::info!("[InvManager MergeToContainer] Merging item {} onto item {}. Target new qty: {}", item_instance_id, target_instance_id, target_new_qty);
                target_item.quantity = target_new_qty;
                // Target item's location remains the same container slot
                inventory_table.instance_id().update(target_item);
                
                if delete_source {
                    // Source item is fully merged, delete it.
                    // Update its location to Unknown before deleting for tidiness.
                    let mut item_to_delete = inventory_table.instance_id().find(item_instance_id)
                                               .ok_or("Failed to refetch item for deletion during merge!")?;
                    item_to_delete.location = ItemLocation::Unknown;
                    inventory_table.instance_id().update(item_to_delete);
                    inventory_table.instance_id().delete(item_instance_id);
                    log::debug!("[InvManager MergeToContainer] Deleted source item {} after merge.", item_instance_id);
                } else {
                    // Source item partially merged, update its quantity.
                    // Its location remains the original player inventory/hotbar/equipment slot.
                    item_to_move.quantity = source_new_qty;
                    item_to_move.location = original_location.clone(); // Reaffirm original location
                    inventory_table.instance_id().update(item_to_move);
                    log::debug!("[InvManager MergeToContainer] Updated source item {} quantity to {} after partial merge.", item_instance_id, source_new_qty);
                }
                // Container slot content (target_instance_id) unchanged on merge, only its quantity.
            },
            Err(_) => {
                // Merge Failed: Swap
                log::info!("[InvManager SwapToContainer] Cannot merge. Swapping container slot {} (item {}) with player item {} (originally at {:?}).", 
                         target_slot_index, target_instance_id, item_instance_id, original_location);

                // Move target item (from container) to player's original slot
                target_item.location = original_location.clone(); 
                inventory_table.instance_id().update(target_item);
                log::debug!("[InvManager SwapToContainer] Moved target item {} from container to player's original location {:?}", 
                         target_instance_id, original_location);
                
                // Update source item (from player) location to the container slot
                item_to_move.location = new_item_location.clone();
                inventory_table.instance_id().update(item_to_move);
                log::debug!("[InvManager SwapToContainer] Moved source item {} to container location {:?}", 
                         item_instance_id, new_item_location);

                // Update the container slot to hold the source item.
                container.set_slot(target_slot_index, Some(item_instance_id), Some(item_def_to_move.id));
            }
        }
    } else {
        // Target Empty: Place
        log::info!("[InvManager PlaceInContainer] Placing item {} into empty container slot {}", item_instance_id, target_slot_index);
        item_to_move.location = new_item_location.clone();
        inventory_table.instance_id().update(item_to_move);
        
        // Update the container slot.
        container.set_slot(target_slot_index, Some(item_instance_id), Some(item_def_to_move.id));
    }

    // --- Clear Original Equipment Slot if Necessary --- 
    if let Some(eq_slot_type) = original_equipment_slot_type {
        log::info!("[MoveToContainer] Clearing original equipment slot {:?} for item {}.", eq_slot_type, item_instance_id);
        crate::items::clear_specific_item_from_equipment_slots(ctx, sender_id, item_instance_id);
    }

    Ok(())
}

/// Handles moving an item FROM a container slot TO the player's inventory/hotbar.
pub(crate) fn handle_move_from_container_slot<C: ItemContainer>(
    ctx: &ReducerContext, 
    container: &mut C, 
    source_slot_index: u8,
    target_slot_type: String, // "inventory" or "hotbar"
    target_slot_index: u32 
) -> Result<(), String> {
    let sender_id = ctx.sender;
    let inventory_table = ctx.db.inventory_item();
    let item_def_table = ctx.db.item_definition();

    // --- Fetch and Validate Item to Move from Container --- 
    if source_slot_index >= container.num_slots() as u8 {
        return Err(format!("Source slot index {} out of bounds.", source_slot_index));
    }
    let source_instance_id = container.get_slot_instance_id(source_slot_index)
        .ok_or_else(|| format!("Source slot {} in container is empty", source_slot_index))?;
    // let source_def_id = container.get_slot_def_id(source_slot_index) // No longer strictly needed here
    //     .ok_or_else(|| format!("Source slot {} has instance ID but no Def ID! Inconsistent state.", source_slot_index))?;

    log::info!("[InvManager FromContainer] Attempting move item {} from container slot {} to player {:?} {} slot {}", 
             source_instance_id, source_slot_index, sender_id, target_slot_type, target_slot_index);
    
    // --- Determine Target Player Location --- 
    let target_location = match target_slot_type.as_str() {
        "inventory" => {
            if target_slot_index >= NUM_PLAYER_INVENTORY_SLOTS as u32 {
                return Err("Invalid target inventory slot index.".to_string());
            }
            ItemLocation::Inventory(crate::models::InventoryLocationData { owner_id: sender_id, slot_index: target_slot_index as u16 })
        },
        "hotbar" => {
            if target_slot_index >= NUM_PLAYER_HOTBAR_SLOTS as u32 {
                return Err("Invalid target hotbar slot index.".to_string());
            }
            ItemLocation::Hotbar(crate::models::HotbarLocationData { owner_id: sender_id, slot_index: target_slot_index as u8 })
        },
        _ => return Err("Invalid target_slot_type. Must be 'inventory' or 'hotbar'".to_string()),
    };

    // --- Clear Slot in Container First --- 
    // Do this before moving to player inv to avoid potential duplication issues if player move fails.
    container.set_slot(source_slot_index, None, None);
    log::debug!("[InvManager FromContainer] Cleared container slot {} (held item {}).", source_slot_index, source_instance_id);

    // --- Move Item to Player Inventory/Hotbar (using player_inventory functions) --- 
    // These functions handle merging/swapping within player inventory/hotbar and update the item's location.
    let move_result = match target_location {
        ItemLocation::Inventory(ref data) => { // Destructure to get data if needed, or just use target_location directly
            move_item_to_inventory(ctx, source_instance_id, data.slot_index)
        }
        ItemLocation::Hotbar(ref data) => { // Destructure to get data if needed
            move_item_to_hotbar(ctx, source_instance_id, data.slot_index)
        }
        _ => Err("Internal error: Target location is not player inventory or hotbar after validation.".to_string()) // Should not happen
    };

    // Handle potential errors during the move
    if let Err(e) = move_result {
        log::error!("[InvManager FromContainer] Failed to move item {} to player location {:?}: {}. Attempting to revert.", 
                 source_instance_id, target_location, e);
        // Attempt to put the item back into the container slot if the player move failed
        container.set_slot(source_slot_index, Some(source_instance_id), None);
        // We don't revert the InventoryItem location here because the move functions 
        // should ideally roll back changes on error or not commit invalid states.
        // If the move function failed *after* updating the item location, that's a deeper issue.
        return Err(format!("Failed to move item to player: {}", e));
    }

    log::info!("[InvManager FromContainer] Successfully moved item {} from container slot {} to player location {:?}.", 
             source_instance_id, source_slot_index, target_location);

    Ok(())
}

/// Handles moving an item between two slots WITHIN the same container.
pub(crate) fn handle_move_within_container<C: ItemContainer>(
    ctx: &ReducerContext,
    container: &mut C,
    source_slot_index: u8,
    target_slot_index: u8
) -> Result<(), String> {
    let inventory_table = ctx.db.inventory_item();
    let item_def_table = ctx.db.item_definition();
    let container_id = container.get_container_id();
    let container_type = container.get_container_type();

    // --- Validate Indices --- 
    if source_slot_index >= container.num_slots() as u8 || target_slot_index >= container.num_slots() as u8 {
        return Err("Invalid slot index provided.".to_string());
    }
    if source_slot_index == target_slot_index { return Ok(()); } // Moving onto itself

    // --- Get Items --- 
    let source_id_opt = container.get_slot_instance_id(source_slot_index);
    let target_id_opt = container.get_slot_instance_id(target_slot_index);

    // --- Logic --- 
    match (source_id_opt, target_id_opt) {
        (Some(source_id), Some(target_id)) => {
            // Both slots occupied: Attempt merge or swap
            let mut source_item = inventory_table.instance_id().find(source_id)
                .ok_or_else(|| format!("Source item {} not found in DB", source_id))?;
            let mut target_item = inventory_table.instance_id().find(target_id)
                .ok_or_else(|| format!("Target item {} not found in DB", target_id))?;
            
            let source_item_def = item_def_table.id().find(source_item.item_def_id)
                .ok_or_else(|| format!("Definition not found for source item ID {}", source_item.item_def_id))?;
            // Fetch target_item_def, it might be needed if swap logic uses it directly, or for consistency
            let target_item_def = item_def_table.id().find(target_item.item_def_id)
                .ok_or_else(|| format!("Definition not found for target item ID {}", target_item.item_def_id))?;

            log::info!("[InvManager WithinContainer] Attempting merge/swap: source item {}, target item {}", source_id, target_id);

            match calculate_merge_result(&source_item, &target_item, &source_item_def) { // Pass &source_item_def
                Ok((_, source_new_qty, target_new_qty, delete_source)) => {
                    // Merge successful
                    log::info!("[InvManager WithinContainer Merge] Merge successful. Target new qty: {}", target_new_qty);
                    target_item.quantity = target_new_qty;
                    inventory_table.instance_id().update(target_item);

                    // Update slots in the container itself
                    container.set_slot(target_slot_index, Some(source_id), Some(source_item_def.id));
                    // container.set_slot(source_slot_index, Some(target_id), Some(target_item_def.id)); // Use fetched target_item_def
                    // Re-fetch target_item_def for safety if its instance_id could have changed, though it shouldn't in a swap of locations only
                    let updated_target_item_for_def = inventory_table.instance_id().find(target_id)
                        .ok_or_else(|| format!("Target item {} disappeared before its def ID could be set in source slot after swap", target_id))?;
                    let updated_target_item_def = item_def_table.id().find(updated_target_item_for_def.item_def_id)
                        .ok_or_else(|| format!("Definition for target item {} (now in source slot) not found after swap", target_id))?;
                    container.set_slot(source_slot_index, Some(target_id), Some(updated_target_item_def.id));
                },
                Err(msg) => {
                    log::warn!("[InvManager WithinContainer] Cannot merge item {} into slot {} (item {}): {}. Item not placed.", source_id, target_slot_index, target_id, msg);
                    return Err(format!("Slot {} is occupied and items cannot be merged: {}", target_slot_index, msg));
                }
            }
        },
        (Some(source_id), None) => {
            // Target slot empty: Move source item to target slot
            let source_item = inventory_table.instance_id().find(source_id)
                .ok_or_else(|| format!("Source item {} not found in DB for move to empty slot", source_id))?;
            let source_item_def = item_def_table.id().find(source_item.item_def_id)
                .ok_or_else(|| format!("Definition not found for source item ID {}", source_item.item_def_id))?;

            log::info!("[InvManager WithinContainer Move] Moving item {} from slot {} to empty slot {}", source_id, source_slot_index, target_slot_index);
            
            let mut source_item_mut = source_item.clone(); // Clone to make mutable for location update
            source_item_mut.location = ItemLocation::Container(crate::models::ContainerLocationData {
                container_id: container.get_container_id(),
                container_type: container.get_container_type(),
                slot_index: target_slot_index,
            });
            inventory_table.instance_id().update(source_item_mut);

            container.set_slot(target_slot_index, Some(source_id), Some(source_item_def.id));
            container.set_slot(source_slot_index, None, None); // Clear original slot
        },
        (None, Some(target_id)) => {
            // Source slot empty: Move target item to source slot
            // This is effectively the same as the above case, just swapping source/target logic
            if let Some(mut target_item) = inventory_table.instance_id().find(target_id) {
                let target_item_def = item_def_table.id().find(target_item.item_def_id)
                    .ok_or_else(|| format!("Definition not found for target item ID {} when moving to empty source slot", target_item.item_def_id))?;
                
                log::info!("[InvManager WithinContainer Move] Moving item {} from slot {} to empty slot {}", target_id, target_slot_index, source_slot_index);

                target_item.location = ItemLocation::Container(crate::models::ContainerLocationData {
                    container_id: container.get_container_id(),
                    container_type: container.get_container_type(),
                    slot_index: source_slot_index, 
                });
                inventory_table.instance_id().update(target_item.clone()); // target_item is already mut, clone not strictly needed for update but safe

                container.set_slot(source_slot_index, Some(target_id), Some(target_item_def.id));
                container.set_slot(target_slot_index, None, None); // Clear original target slot
            } else {
                log::error!("[InvManager WithinContainer Move] Failed to find target item {} to move to empty source slot {}.", target_id, source_slot_index);
                // Optionally return an error here if this case should be fatal
                // return Err(format!("Target item {} not found for move operation", target_id));
            }
        },
        (None, None) => {
            // Both slots empty: Do nothing
            log::debug!("[InvManager WithinContainer] Both source slot {} and target slot {} are empty. No action.", source_slot_index, target_slot_index);
        }
    }
    Ok(())
}

/// Helper function to merge or place an item into a specific container slot.
/// Updates both the InventoryItem state (location, quantity) and the ItemContainer state.
pub(crate) fn merge_or_place_into_container_slot<C: ItemContainer>(
    ctx: &ReducerContext, 
    container: &mut C,
    target_slot_index: u8,
    item_to_place: &mut InventoryItem, // Mutable: quantity might change, location is target
    item_def_for_item_to_place: &ItemDefinition // Definition for item_to_place
) -> Result<(), String> {
    let inventory_table = ctx.db.inventory_item();
    let item_def_table = ctx.db.item_definition(); // For fetching target item's def if slot is occupied

    if target_slot_index >= container.num_slots() as u8 {
        return Err(format!("Target slot index {} out of bounds for merge/place.", target_slot_index));
    }

    if let Some(target_instance_id) = container.get_slot_instance_id(target_slot_index) {
        // Target slot is OCCUPIED. Attempt to merge.
        let mut target_item_in_slot = inventory_table.instance_id().find(target_instance_id)
            .ok_or_else(|| format!("Item {} in target container slot {} not found in DB for merge!", target_instance_id, target_slot_index))?;
        // Note: item_def_for_item_to_place is for the item_to_place (source-like), not target_item_in_slot.
        
        match calculate_merge_result(item_to_place, &target_item_in_slot, item_def_for_item_to_place) {
            Ok((_, source_new_qty, target_new_qty, delete_source)) => {
                log::info!(
                    "[InvManager MergeOrPlace] Merging item {} (new qty {}) onto item {} in slot {} (new qty {}). Delete source: {}", 
                    item_to_place.instance_id, source_new_qty, target_instance_id, target_slot_index, target_new_qty, delete_source
                );
                target_item_in_slot.quantity = target_new_qty;
                inventory_table.instance_id().update(target_item_in_slot); // Target location unchanged

                item_to_place.quantity = source_new_qty; // Update quantity of the item being placed/merged
                if delete_source {
                    // item_to_place was fully merged, mark for potential deletion by caller or update if already in DB
                    // If item_to_place was already in DB, its location is target, so deleting it now would be wrong.
                    // The caller of merge_or_place needs to handle deleting item_to_place if it's appropriate (e.g. from split)
                    log::debug!("[InvManager MergeOrPlace] item_to_place {} fully merged. Its quantity is now {}. Caller should handle deletion if it was a temporary split item.", item_to_place.instance_id, item_to_place.quantity);
                } else {
                    // item_to_place partially merged, its quantity is updated. Location is already target.
                     inventory_table.instance_id().update(item_to_place.clone());
                     log::debug!("[InvManager MergeOrPlace] item_to_place {} partially merged. Its quantity is now {}. Location {:?}", item_to_place.instance_id, item_to_place.quantity, item_to_place.location);
                }
                // Container slot already holds target_instance_id, its quantity was updated.
            },
            Err(msg) => {
                log::warn!("[InvManager MergeOrPlace] Cannot merge item {} into slot {} (item {}): {}. Item not placed.", item_to_place.instance_id, target_slot_index, target_instance_id, msg);
                return Err(format!("Slot {} is occupied and items cannot be merged: {}", target_slot_index, msg));
            }
        }
    } else {
        // Target slot is EMPTY. Place the item_to_place.
        log::info!("[InvManager MergeOrPlace] Placing item {} (qty {}) into empty container slot {}. Location {:?}", 
                 item_to_place.instance_id, item_to_place.quantity, target_slot_index, item_to_place.location);
        
        // Item's location should already be set to this container slot by the caller (e.g. split_stack_helper)
        // If item_to_place is an existing DB item, update it. If it's a new one, it will be inserted by caller.
        // For safety, ensure its location is correct if it's already in the DB.
        if inventory_table.instance_id().find(item_to_place.instance_id).is_some() {
             item_to_place.location = ItemLocation::Container(crate::models::ContainerLocationData {
                container_id: container.get_container_id(),
                container_type: container.get_container_type(),
                slot_index: target_slot_index,
            });
            inventory_table.instance_id().update(item_to_place.clone());
        } 
        // If it's a brand new item not yet in DB, caller of split_stack_helper handles insert with this location.

        container.set_slot(target_slot_index, Some(item_to_place.instance_id), Some(item_def_for_item_to_place.id));
    }
    Ok(())
}

/// Handles splitting a stack FROM player inventory INTO a container slot.
pub(crate) fn handle_split_into_container<C: ItemContainer>(
    ctx: &ReducerContext,
    container: &mut C, 
    target_slot_index: u8,
    source_item_instance_id: u64, // ID of original stack owned by player
    quantity_to_split: u32
) -> Result<(), String> {
    let inventory_table = ctx.db.inventory_item();
    let sender_id = ctx.sender;
    let item_def_table = ctx.db.item_definition();

    // Fetch source item (owned by player)
    let mut source_item = inventory_table.instance_id().find(source_item_instance_id)
        .ok_or_else(|| format!("Source item {} for split not found", source_item_instance_id))?;

    // --- Validate Source Item Location & Ownership ---
    match source_item.location {
        ItemLocation::Inventory(ref data) => {
            if data.owner_id != sender_id {
                return Err("Source item for split not owned by sender.".to_string());
            }
        }
        ItemLocation::Hotbar(ref data) => {
            if data.owner_id != sender_id {
                return Err("Source item for split not owned by sender.".to_string());
            }
        }
        ItemLocation::Equipped(ref data) => {
            if data.owner_id != sender_id {
                return Err("Source item for split not owned by sender.".to_string());
            }
        }
        _ => return Err("Source item for split must be in player inventory, hotbar, or equipped.".to_string()),
    }

    // --- Validate Target Slot --- 
    if target_slot_index >= container.num_slots() as u8 {
        return Err("Invalid target container slot index.".to_string());
    }

    // --- Determine Initial Location for NEW item --- 
    let initial_location_for_new_item = ItemLocation::Container(crate::models::ContainerLocationData {
        container_id: container.get_container_id(),
        container_type: container.get_container_type(),
        slot_index: target_slot_index,
    });

    // --- Perform Split using Helper --- 
    // This updates source_item quantity and creates the new item instance
    let new_item_instance_id = crate::items::split_stack_helper(ctx, &mut source_item, quantity_to_split, initial_location_for_new_item)?;
    inventory_table.instance_id().update(source_item); // Persist source item quantity change
    
    // --- Fetch the NEW item to merge/place --- 
    let mut new_item = inventory_table.instance_id().find(new_item_instance_id)
                       .ok_or("Failed to find newly split item instance after creation")?;
    let new_item_def = item_def_table.id().find(new_item.item_def_id).ok_or("Def for new item not found!")?;

    // --- Merge or Place NEW item into Container Slot --- 
    // The new item was created with the target container location already set.
    // Now, we need to see if the target slot in the *container itself* is occupied and potentially merge.
    match merge_or_place_into_container_slot(ctx, container, target_slot_index, &mut new_item, &new_item_def) {
        Ok(_) => {
            log::info!("[SplitIntoContainer] Successfully split {} from item {} and placed/merged new item {} into container slot {}.", 
                     quantity_to_split, source_item_instance_id, new_item_instance_id, target_slot_index);
            // If merge_or_place_into_container_slot updated new_item quantity (partial merge, though currently errors),
            // we might need to update it in the DB again. However, it currently errors on partial merge.
            // If it was deleted, no further action needed for new_item.
            Ok(())
        }
        Err(e) => {
            log::error!("[SplitIntoContainer] Failed to place/merge new item {} after split: {}. Attempting to delete new item and revert source.", new_item_instance_id, e);
            // Attempt to clean up the newly created item if placement failed
            inventory_table.instance_id().delete(new_item_instance_id);
            // Revert source item quantity change because the split couldn't be completed in container
            let mut source_to_revert = inventory_table.instance_id().find(source_item_instance_id).ok_or("Failed to find source item to revert qty")?;
            source_to_revert.quantity += quantity_to_split; // Add back the quantity
            inventory_table.instance_id().update(source_to_revert);
            Err(format!("Failed to place split stack: {}", e))
        }
    }
}

/// Handles splitting a stack FROM a container slot TO player inventory/hotbar.
pub(crate) fn handle_split_from_container<C: ItemContainer>(
    ctx: &ReducerContext,
    container: &mut C, 
    source_slot_index: u8,
    quantity_to_split: u32,
    target_slot_type: String, // "inventory" or "hotbar"
    target_slot_index: u32
) -> Result<(), String> {
    let sender_id = ctx.sender;
    let inventory_table = ctx.db.inventory_item();
    let item_def_table = ctx.db.item_definition();

    // --- Get Source Item from Container --- 
    if source_slot_index >= container.num_slots() as u8 {
        return Err("Invalid source container slot index.".to_string());
    }
    let source_instance_id = container.get_slot_instance_id(source_slot_index)
        .ok_or("Source container slot is empty.")?;
    let mut source_item = inventory_table.instance_id().find(source_instance_id)
        .ok_or("Source item instance not found in DB!")?;

    // --- Determine Target Location for New Stack (in Player Inv/Hotbar) ---
    let initial_location_for_new_item = match target_slot_type.as_str() {
        "inventory" => {
            if target_slot_index >= NUM_PLAYER_INVENTORY_SLOTS as u32 {
                return Err("Invalid target inventory slot index for split".to_string());
            }
            ItemLocation::Inventory(crate::models::InventoryLocationData { owner_id: sender_id, slot_index: target_slot_index as u16 })
        },
        "hotbar" => {
            if target_slot_index >= NUM_PLAYER_HOTBAR_SLOTS as u32 {
                return Err("Invalid target hotbar slot index for split".to_string());
            }
            ItemLocation::Hotbar(crate::models::HotbarLocationData { owner_id: sender_id, slot_index: target_slot_index as u8 })
        },
        _ => return Err("Invalid target_slot_type for split. Must be 'inventory' or 'hotbar'.".to_string()),
    };

    // --- Perform Split using Helper --- 
    // This updates source_item quantity (in container) and creates new_item_instance_id
    // with the specified initial_location_for_new_item (in player inv/hotbar).
    let new_item_instance_id = crate::items::split_stack_helper(ctx, &mut source_item, quantity_to_split, initial_location_for_new_item.clone())?;
    inventory_table.instance_id().update(source_item); // Persist source item quantity change
    
    // --- Update Container Slot if Source Item Quantity is Now Zero --- 
    let updated_source_item = inventory_table.instance_id().find(source_instance_id)
        .ok_or("Failed to refetch source item after split!")?;
    if updated_source_item.quantity == 0 {
        log::debug!("[SplitFromContainer] Source item {} in container slot {} has quantity 0 after split. Deleting item and clearing slot.", 
                 source_instance_id, source_slot_index);
        let mut item_to_delete = updated_source_item;
        item_to_delete.location = ItemLocation::Unknown;
        inventory_table.instance_id().update(item_to_delete);
        inventory_table.instance_id().delete(source_instance_id);
        container.set_slot(source_slot_index, None, None);
    } else {
        // If source quantity > 0, the container slot remains unchanged.
        log::debug!("[SplitFromContainer] Source item {} in container slot {} has quantity {} remaining.", 
                 source_instance_id, source_slot_index, updated_source_item.quantity);
    }

    // --- Move/Merge the NEWLY CREATED stack to its target player slot --- 
    // Use player_inventory functions which handle merging/swapping.
    log::debug!("[SplitFromContainer] Attempting to move/merge new item {} to player location {:?}.", 
             new_item_instance_id, initial_location_for_new_item);

    let move_result = match initial_location_for_new_item {
        ItemLocation::Inventory(data) => {
            move_item_to_inventory(ctx, new_item_instance_id, data.slot_index)
        }
        ItemLocation::Hotbar(data) => {
            move_item_to_hotbar(ctx, new_item_instance_id, data.slot_index)
        }
        _ => Err("Internal error: Invalid target location for new item after split.".to_string()),
    };

    if let Err(e) = move_result {
         log::error!("[SplitFromContainer] Failed to move/merge new item {} to player after split: {}. Deleting new item.", new_item_instance_id, e);
         // Attempt cleanup of the new item
         inventory_table.instance_id().delete(new_item_instance_id);
         // State might be inconsistent if source container item was modified.
         // This requires careful consideration of transactional rollback or compensating actions.
         // For now, we have to assume the split_stack_helper's reduction of source_item qty is an issue if this fails.
         return Err(format!("Failed to place split stack into player inventory: {}", e));
    }

    Ok(())
}

/// Handles splitting a stack between two slots WITHIN the same container.
pub(crate) fn handle_split_within_container<C: ItemContainer>(
    ctx: &ReducerContext,
    container: &mut C,
    source_slot_index: u8,
    target_slot_index: u8,
    quantity_to_split: u32
) -> Result<(), String> {
    let inventory_table = ctx.db.inventory_item();
    let item_def_table = ctx.db.item_definition();
    let container_id = container.get_container_id();
    let container_type = container.get_container_type();

    // --- Validate Indices --- 
    if source_slot_index >= container.num_slots() as u8 || target_slot_index >= container.num_slots() as u8 {
        return Err("Invalid slot index provided.".to_string());
    }
    if source_slot_index == target_slot_index { 
        return Err("Cannot split item onto the same slot.".to_string()); 
    }

    // --- Get Source Item --- 
    let source_instance_id = container.get_slot_instance_id(source_slot_index)
        .ok_or("Source container slot is empty.")?;
    let mut source_item = inventory_table.instance_id().find(source_instance_id)
        .ok_or("Source item instance not found in DB!")?;

    // --- Determine Target Location for New Stack --- 
    let initial_location_for_new_item = ItemLocation::Container(crate::models::ContainerLocationData {
        container_id, 
        container_type: container_type.clone(), 
        slot_index: target_slot_index
    });

    // --- Perform Split using Helper --- 
    let new_item_instance_id = crate::items::split_stack_helper(ctx, &mut source_item, quantity_to_split, initial_location_for_new_item)?;
    inventory_table.instance_id().update(source_item); // Persist source item quantity change
    
    // --- Fetch the NEW item to merge/place --- 
    let mut new_item = inventory_table.instance_id().find(new_item_instance_id)
                       .ok_or("Failed to find newly split item instance after creation")?;
    let new_item_def = item_def_table.id().find(new_item.item_def_id).ok_or("Def for new item not found!")?;

    // --- Merge or Place NEW item into Target Container Slot --- 
    match merge_or_place_into_container_slot(ctx, container, target_slot_index, &mut new_item, &new_item_def) {
        Ok(_) => {
            log::info!("[SplitWithinContainer] Successfully split {} from item {} (slot {}) and placed/merged new item {} into container slot {}.", 
                     quantity_to_split, source_instance_id, source_slot_index, new_item_instance_id, target_slot_index);
            // Check if source item quantity is now zero after split and update container slot
            let updated_source_item = inventory_table.instance_id().find(source_instance_id)
                .ok_or("Failed to refetch source item after split!")?;
            if updated_source_item.quantity == 0 {
                log::debug!("[SplitWithinContainer] Source item {} in slot {} has quantity 0. Deleting item and clearing slot.", 
                         source_instance_id, source_slot_index);
                let mut item_to_delete = updated_source_item;
                item_to_delete.location = ItemLocation::Unknown;
                inventory_table.instance_id().update(item_to_delete);
                inventory_table.instance_id().delete(source_instance_id);
                container.set_slot(source_slot_index, None, None);
            }
            Ok(())
        }
        Err(e) => {
            log::error!("[SplitWithinContainer] Failed to place/merge new item {} after split: {}. Reverting source and deleting new.", new_item_instance_id, e);
            inventory_table.instance_id().delete(new_item_instance_id); // Delete the new item
            // Revert source item qty
            let mut source_to_revert = inventory_table.instance_id().find(source_instance_id).ok_or("Failed to find source item to revert qty")?;
            source_to_revert.quantity += quantity_to_split; 
            inventory_table.instance_id().update(source_to_revert);
            Err(format!("Failed to place split stack: {}", e))
        }
    }
}

/// Handles quickly moving an item FROM a container slot to the first available player slot.
pub(crate) fn handle_quick_move_from_container<C: ItemContainer>(
    ctx: &ReducerContext, 
    container: &mut C, 
    source_slot_index: u8
) -> Result<(), String> {
    let sender_id = ctx.sender;
    let inventory_table = ctx.db.inventory_item();
    let item_def_table = ctx.db.item_definition();

    // --- 1. Validate Source and Get Item ID --- 
    if source_slot_index >= container.num_slots() as u8 {
        return Err("Invalid source container slot index.".to_string());
    }
    let source_instance_id = container.get_slot_instance_id(source_slot_index)
        .ok_or("Source container slot is empty.")?;
    let source_def_id = container.get_slot_def_id(source_slot_index)
        .ok_or_else(|| format!("Source slot {} missing def ID! Inconsistent state.", source_slot_index))?;
    
    // --- 2. Find First Available Player Slot --- 
    let target_location_opt = find_first_empty_player_slot(ctx, sender_id);

    if let Some(target_location) = target_location_opt {
        log::info!("[InvManager QuickMoveFromContainer] Attempting to move item {} from container slot {} to player {:?} at calculated location {:?}.", 
                 source_instance_id, source_slot_index, sender_id, target_location);

        // --- 3. Clear Container Slot --- 
        container.set_slot(source_slot_index, None, None);
        log::debug!("[InvManager QuickMoveFromContainer] Cleared container slot {} (held item {}).", source_slot_index, source_instance_id);

        // --- 4. Move Item to Player (using the determined target_location) ---
        match target_location {
            ItemLocation::Inventory(ref data) => { // data is InventoryLocationData
                if let Err(e) = move_item_to_inventory(ctx, source_instance_id, data.slot_index) {
                    // Attempt to revert
                    log::error!("[InvManager QuickMoveFromContainer] Failed to move item {} to player inv slot {}: {}. Attempting revert.", source_instance_id, data.slot_index, e);
                    // Re-fetch item def for revert
                    let source_item_for_revert = inventory_table.instance_id().find(source_instance_id).ok_or_else(||"Source item lost".to_string())?;
                    let source_def_id_for_revert = source_item_for_revert.item_def_id;
                    container.set_slot(source_slot_index, Some(source_instance_id), Some(source_def_id_for_revert));
                    return Err(e);
                }
            }
            ItemLocation::Hotbar(ref data) => { // data is HotbarLocationData - add ref
                if let Err(e) = move_item_to_hotbar(ctx, source_instance_id, data.slot_index) {
                     // Attempt to revert
                    log::error!("[InvManager QuickMoveFromContainer] Failed to move item {} to player hotbar slot {}: {}. Attempting revert.", source_instance_id, data.slot_index, e);
                    let source_item_for_revert = inventory_table.instance_id().find(source_instance_id).ok_or_else(||"Source item lost".to_string())?;
                    let source_def_id_for_revert = source_item_for_revert.item_def_id;
                    container.set_slot(source_slot_index, Some(source_instance_id), Some(source_def_id_for_revert));
                    return Err(e);
                }
            }
            _ => { // Should not happen if find_first_empty_player_slot is correct
                log::error!("[InvManager QuickMoveFromContainer] Unexpected target location type from find_first_empty_player_slot: {:?}. Reverting item {} to container slot {}.", target_location, source_instance_id, source_slot_index);
                // Attempt to revert by putting item back
                let source_item_for_revert = inventory_table.instance_id().find(source_instance_id).ok_or_else(||"Source item lost".to_string())?;
                let source_def_id_for_revert = source_item_for_revert.item_def_id;
                container.set_slot(source_slot_index, Some(source_instance_id), Some(source_def_id_for_revert));
                return Err("Unexpected target location type for quick move.".to_string());
            }
        }
        log::info!("[InvManager QuickMoveFromContainer] Successfully moved item {} to player at {:?}.", source_instance_id, target_location);
    } else {
        log::warn!("[InvManager QuickMoveFromContainer] Player {:?} inventory and hotbar are full. Cannot quick move item {} from container slot {}.", 
                 sender_id, source_instance_id, source_slot_index);
        return Err("Player inventory and hotbar are full.".to_string());
    }
    Ok(())
}

/// Handles quickly moving an item FROM player inventory/hotbar TO the first available container slot.
pub(crate) fn handle_quick_move_to_container<C: ItemContainer>(
    ctx: &ReducerContext,
    container: &mut C,
    item_instance_id: u64,
) -> Result<(), String> {
    let inventory_table = ctx.db.inventory_item();
    let item_def_table = ctx.db.item_definition();
    let sender_id = ctx.sender;

    // --- 1. Fetch and Validate Item to Move --- 
    let mut item_to_move = inventory_table.instance_id().find(item_instance_id)
        .ok_or(format!("Item instance {} not found", item_instance_id))?;
    let item_def_to_move = item_def_table.id().find(item_to_move.item_def_id)
        .ok_or(format!("Definition missing for item {}", item_to_move.item_def_id))?;
    
    // --- 2. Determine Original Location & Validate --- 
    let original_location = item_to_move.location.clone();
    let original_equipment_slot_type: Option<EquipmentSlotType> = match &original_location {
        ItemLocation::Inventory(ref data) => {
            if data.owner_id != sender_id {
                return Err("Item not in sender's possession.".to_string());
            }
            None
        }
        ItemLocation::Hotbar(ref data) => {
            if data.owner_id != sender_id {
                return Err("Item not in sender's possession.".to_string());
            }
            None
        }
        ItemLocation::Equipped(ref data) => {
            if data.owner_id != sender_id {
                return Err("Item not in sender's possession.".to_string());
            }
            Some(data.slot_type.clone())
        }
        _ => return Err("Item must be in player inventory, hotbar, or equipped to quick move to container.".to_string()),
    };

    // --- 3. Find First Available/Stackable Container Slot --- 
    let mut target_slot_index_opt: Option<u8> = None;

    // Prioritize stacking
    if item_def_to_move.is_stackable {
        for i in 0..container.num_slots() as u8 {
            if let Some(existing_instance_id) = container.get_slot_instance_id(i) {
                if let Some(existing_item) = inventory_table.instance_id().find(existing_instance_id) {
                    if existing_item.item_def_id == item_to_move.item_def_id && existing_item.quantity < item_def_to_move.stack_size {
                        target_slot_index_opt = Some(i);
                        break;
                    }
                }
            }
        }
    }

    // If no stackable slot found, find the first empty slot
    if target_slot_index_opt.is_none() {
        for i in 0..container.num_slots() as u8 {
            if container.get_slot_instance_id(i).is_none() {
                target_slot_index_opt = Some(i);
                break;
            }
        }
    }

    // If no suitable slot found
    let target_slot_idx = target_slot_index_opt.ok_or_else(|| "Container is full or no suitable slot found.".to_string())?;
    
    log::info!("[QuickMoveToContainer] Attempting move item {} from player location {:?} to container slot {}.",
             item_instance_id, original_location, target_slot_idx);

    // --- 4. Merge or Place into Container Slot --- 
    // Pass a mutable reference to item_to_move to allow its quantity to be updated directly by the helper if partially merged.
    match merge_or_place_into_container_slot(ctx, container, target_slot_idx, &mut item_to_move, &item_def_to_move) {
        Ok(_) => {
            log::info!("[QuickMoveToContainer] Successfully moved/merged item {} to container slot {}.", item_instance_id, target_slot_idx);
            
            // If item_to_move.quantity became 0 (fully merged & deleted by helper), no further DB update needed for it.
            // If item_to_move.quantity > 0 (partially merged), its quantity was updated by the helper,
            // but its location is still the player's. We need to persist this quantity update for the player's item.
            // The location remains the player's original location unless it was fully merged.
            // If it was fully merged, it was deleted by merge_or_place_into_container_slot.
            // If it was NOT fully merged, we must update its quantity in the DB at its original location.
            // merge_or_place_into_container_slot already updates it if not deleted.
            
            // --- 5. Clear Original Equipment Slot if Necessary --- 
            // This should only happen if the item was *actually* removed from the player (i.e., fully merged or placed).
            // If item_to_move was fully merged and deleted, then its original_equipment_slot can be cleared.
            // If it was partially merged, it remains in the equipment slot with reduced quantity.
            // If it was placed (target slot empty), then it's fully moved.
            let item_fully_moved_or_merged = inventory_table.instance_id().find(item_instance_id).is_none() || item_to_move.location != original_location;

            if let Some(eq_slot_type) = original_equipment_slot_type {
                if item_fully_moved_or_merged {
                    log::info!("[QuickMoveToContainer] Clearing original equipment slot {:?} as item {} was fully moved/merged.", eq_slot_type, item_instance_id);
                    crate::items::clear_specific_item_from_equipment_slots(ctx, sender_id, item_instance_id);
                } else {
                    log::debug!("[QuickMoveToContainer] Item {} was partially merged or move failed, not clearing equipment slot {:?}.", item_instance_id, eq_slot_type);
                }
            }
            Ok(())
        }
        Err(e) => {
             log::error!("[QuickMoveToContainer] Failed to move item {} to container slot {}: {}", item_instance_id, target_slot_idx, e);
             Err(format!("Failed to place/merge item into container: {}", e))
        }
    }
}