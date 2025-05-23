/******************************************************************************
 *                                                                            *
 * Provides generic traits and handler functions for managing items within    *
 * various container types. This module abstracts common inventory operations *
 * like moving, splitting, and merging items, allowing specific container     *
 * modules (e.g., campfire, wooden_storage_box) to reuse this logic.          *
 *                                                                            *
 * NOTE: For operations that give NEW items to players (harvesting, loot,     *
 * rewards, etc.), consider using `crate::dropped_item::try_give_item_to_player` *
 * which automatically drops items near the player if inventory is full.      *
 *                                                                            *
 ******************************************************************************/

use spacetimedb::{ReducerContext, Identity, Table};
use log;

// Import necessary types and Table Traits
use crate::items::{InventoryItem, ItemDefinition, calculate_merge_result, add_item_to_player_inventory, split_stack_helper};
use crate::items::{inventory_item as InventoryItemTableTrait, item_definition as ItemDefinitionTableTrait};
// Import new models
use crate::models::{ItemLocation, ContainerType, EquipmentSlotType};
// Import player inventory helpers
use crate::player_inventory::{move_item_to_inventory, move_item_to_hotbar, find_first_empty_player_slot, NUM_PLAYER_INVENTORY_SLOTS, NUM_PLAYER_HOTBAR_SLOTS};
// Import for clearing active item
use crate::active_equipment;
// Import for active_equipment table trait
use crate::active_equipment::active_equipment as ActiveEquipmentTableTrait;

// Corrected imports for WoodenStorageBox (used as an example ItemContainer implementor, not for direct table access here)
use crate::wooden_storage_box::WoodenStorageBox; 
// use crate::wooden_storage_box::wooden_storage_box as WoodenStorageBoxTableTrait; // Not needed directly in generic part

// Corrected imports for Player (used for drop location calculation)
use crate::Player;                             
use crate::player; // Trait for ctx.db.player() and its methods

// Import for dropped item creation
use crate::dropped_item::{create_dropped_item_entity, calculate_drop_position};

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
            Err(merge_err_msg) => { // Changed from _ to merge_err_msg for logging
                // Merge Failed: Swap
                log::warn!("[InvManager SwapToContainer] Cannot merge item {} (def {}) with item {} (def {}) in slot {}: {}. Attempting SWAP.", 
                         item_instance_id, item_to_move.item_def_id, target_instance_id, target_item.item_def_id, target_slot_index, merge_err_msg);

                // Move target item (from container) to player's original slot
                target_item.location = original_location.clone(); 
                inventory_table.instance_id().update(target_item.clone()); // target_item is already mut
                log::debug!("[InvManager SwapToContainer] Moved target item {} from container to player's original location {:?}", 
                         target_instance_id, original_location);
                
                // Update source item (from player) location to the container slot
                item_to_move.location = new_item_location.clone();
                inventory_table.instance_id().update(item_to_move.clone()); // item_to_move is already mut
                log::debug!("[InvManager SwapToContainer] Moved source item {} to container location {:?}", 
                         item_instance_id, new_item_location);

                // Update the container slot to hold the source item.
                let target_item_def_id = target_item.item_def_id; // Capture before target_item might be shadowed or modified further if logic changes
                container.set_slot(target_slot_index, Some(item_instance_id), Some(item_def_to_move.id));
                // And set the original player slot's effective content to target_item (handled by its location update)
                // If original_location was an equipment slot, this logic path implies the player item (item_to_move) also came from equipment.
                // The swap needs to respect that the target_item now occupies that equipment slot implicitly by its location.
                // No direct update to ActiveEquipment table here, that's for equipping actions.
                // This function assumes the player will re-equip if needed.
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
        // Check if the item_instance_id is still in that equipment slot. 
        // It wouldn't be if it was swapped with another item that took its original equipment slot.
        // However, a simple clear is safer if its location is no longer equipped.
        let current_item_location = inventory_table.instance_id().find(item_instance_id)
                                        .map(|item| item.location)
                                        .unwrap_or(ItemLocation::Unknown); // Default if item deleted (e.g. merged fully)
        if !matches!(current_item_location, ItemLocation::Equipped(data) if data.slot_type == eq_slot_type) {
            log::info!("[MoveToContainer] Item {} no longer in original equipment slot {:?}. Clearing slot.", item_instance_id, eq_slot_type);
            crate::items::clear_specific_item_from_equipment_slots(ctx, sender_id, item_instance_id);
        }
    }

    // --- Check if the moved item was the active equipped item and clear if so ---
    let active_equip_table = ctx.db.active_equipment();
    if let Some(active_equipment_state) = active_equip_table.player_identity().find(sender_id) {
        if active_equipment_state.equipped_item_instance_id == Some(item_instance_id) {
            // Check if the item still exists and is now in a container, or if it was fully merged (and thus deleted)
            let item_was_deleted = inventory_table.instance_id().find(&item_instance_id).is_none();
            let item_now_in_container = if !item_was_deleted {
                inventory_table.instance_id().find(item_instance_id)
                    .map_or(false, |item| matches!(item.location, ItemLocation::Container(_)))
            } else {
                false // If deleted, it's not in a container in the sense of needing a location check
            };

            if item_was_deleted || item_now_in_container {
                log::info!("[InvManager MoveToContainer] Item {} was the active equipped item and is now in a container or was fully merged. Clearing active item for player {}.", item_instance_id, sender_id);
                match active_equipment::clear_active_item_reducer(ctx, sender_id) {
                    Ok(_) => log::debug!("[InvManager MoveToContainer] Successfully cleared active item for {} after item {} moved to container/merged.", sender_id, item_instance_id),
                    Err(e) => log::error!("[InvManager MoveToContainer] Error clearing active item for {}: {}", sender_id, e),
                }
            }
        }
    }
    // --- End active item check ---

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

    // --- 1. Validate Source Container Slot and Get Item from Container ---
    if source_slot_index >= container.num_slots() as u8 {
        return Err(format!("Source slot index {} out of bounds.", source_slot_index));
    }
    let item_from_container_id = container.get_slot_instance_id(source_slot_index)
        .ok_or_else(|| format!("Source slot {} in container is empty", source_slot_index))?;
    
    let mut item_from_container = inventory_table.instance_id().find(item_from_container_id)
        .ok_or_else(|| format!("Item instance {} (from container slot {}) not found in DB", item_from_container_id, source_slot_index))?;
    let item_def_from_container = item_def_table.id().find(item_from_container.item_def_id)
        .ok_or_else(|| format!("Definition for item {} not found", item_from_container.item_def_id))?;

    log::info!("[InvManager FromContainer] Moving item {} (def {}) from container slot {} to player {} {} slot {}", 
             item_from_container_id, item_from_container.item_def_id, source_slot_index, sender_id, target_slot_type, target_slot_index);
    
    // --- 2. Determine Target Player Location ---
    let player_target_location = match target_slot_type.as_str() {
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

    // --- 3. Check if Player's Target Slot is Occupied ---
    let item_in_player_slot_opt = match player_target_location {
        ItemLocation::Inventory(ref data) => crate::player_inventory::find_item_in_inventory_slot(ctx, data.slot_index),
        ItemLocation::Hotbar(ref data) => crate::player_inventory::find_item_in_hotbar_slot(ctx, data.slot_index),
        _ => None, // Should not happen based on above validation
    };

    if let Some(mut item_in_player_slot) = item_in_player_slot_opt {
        // --- Player's Target Slot is OCCUPIED: Try to Merge or Swap ---
        if item_in_player_slot.instance_id == item_from_container_id {
             // Dragging item from container onto itself (somehow, if client allowed this by mistake)
             // This scenario should ideally not happen if client logic is correct.
             // For safety, treat as no-op for now, or ensure locations are distinct.
             log::warn!("[InvManager FromContainer] Item {} from container slot {} attempted to move onto itself in player slot {:?}. No action.", 
                      item_from_container_id, source_slot_index, player_target_location);
             return Ok(()); // Or an error if this state is truly invalid.
        }

        let item_def_in_player_slot = item_def_table.id().find(item_in_player_slot.item_def_id)
            .ok_or_else(|| format!("Definition for item {} in player slot not found", item_in_player_slot.item_def_id))?;
    
        log::info!("[InvManager FromContainer] Player slot {:?} occupied by item {} (def {}). Attempting merge with item {} (def {}).", 
                 player_target_location, item_in_player_slot.instance_id, item_in_player_slot.item_def_id, 
                 item_from_container_id, item_from_container.item_def_id);

        match calculate_merge_result(&item_from_container, &item_in_player_slot, &item_def_from_container) {
            Ok((qty_transfer, source_new_qty, target_new_qty, delete_source)) => {
                // MERGE Successful
                log::info!("[InvManager FromContainer MERGE] Merging {} from item {} (container) onto {} (player). Player item new qty: {}. Delete source from container: {}",
                         qty_transfer, item_from_container_id, item_in_player_slot.instance_id, target_new_qty, delete_source);

                item_in_player_slot.quantity = target_new_qty;
                inventory_table.instance_id().update(item_in_player_slot.clone());

                if delete_source {
                    // Item from container was fully merged. Delete it and clear container slot.
                    log::debug!("[InvManager FromContainer MERGE] Deleting fully merged item {} from container slot {}.", item_from_container_id, source_slot_index);
                    inventory_table.instance_id().delete(item_from_container_id);
                    container.set_slot(source_slot_index, None, None);
                } else {
                    // Item from container partially merged. Update its quantity.
                    item_from_container.quantity = source_new_qty;
                    // Its location remains the container slot (implicitly, not changing InventoryItem.location yet for this branch)
                    inventory_table.instance_id().update(item_from_container.clone());
                    // Container slot still holds item_from_container, its quantity updated.
                }
            }
            Err(merge_err_msg) => {
                // MERGE Failed: SWAP items
                log::warn!("[InvManager FromContainer SWAP] Cannot merge: {}. Swapping item {} (container slot {}) with item {} (player slot {:?}).", 
                         merge_err_msg, item_from_container_id, source_slot_index, item_in_player_slot.instance_id, player_target_location);

                let original_container_slot_location = ItemLocation::Container(crate::models::ContainerLocationData {
                    container_id: container.get_container_id(),
                    container_type: container.get_container_type(),
                    slot_index: source_slot_index,
                });

                // 1. Item from container (Mushroom) moves to player's target slot
                item_from_container.location = player_target_location.clone();
                inventory_table.instance_id().update(item_from_container.clone());
                log::debug!("[InvManager FromContainer SWAP] Item {} (was container) new location: {:?}", item_from_container_id, item_from_container.location);

                // 2. Item from player's slot (Hatchet) moves to the original container slot
                item_in_player_slot.location = original_container_slot_location;
                inventory_table.instance_id().update(item_in_player_slot.clone());
                log::debug!("[InvManager FromContainer SWAP] Item {} (was player) new location: {:?}", item_in_player_slot.instance_id, item_in_player_slot.location);
                
                // 3. Update the container's direct slot state to hold item_in_player_slot (Hatchet)
                container.set_slot(source_slot_index, Some(item_in_player_slot.instance_id), Some(item_def_in_player_slot.id));
                log::debug!("[InvManager FromContainer SWAP] Container slot {} now holds item {} (def {}).", 
                         source_slot_index, item_in_player_slot.instance_id, item_def_in_player_slot.id);
            }
        }
    } else {
        // --- Player's Target Slot is EMPTY: Place item_from_container there ---
        log::info!("[InvManager FromContainer PLACE] Player slot {:?} is empty. Placing item {} (def {}) from container slot {} there.", 
                 player_target_location, item_from_container_id, item_from_container.item_def_id, source_slot_index);
        
        item_from_container.location = player_target_location.clone();
        inventory_table.instance_id().update(item_from_container.clone());
        
        // Clear the original container slot in the container's state
        container.set_slot(source_slot_index, None, None);
        log::debug!("[InvManager FromContainer PLACE] Cleared container slot {} after moving item {}.", source_slot_index, item_from_container_id);
    }

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
            let target_item_def = item_def_table.id().find(target_item.item_def_id)
                .ok_or_else(|| format!("Definition not found for target item ID {}", target_item.item_def_id))?;

            log::info!("[InvManager WithinContainer] Attempting merge/swap: source item {} (slot {}), target item {} (slot {}).", 
                     source_id, source_slot_index, target_id, target_slot_index);

            match calculate_merge_result(&source_item, &target_item, &source_item_def) { // Pass &source_item_def
                Ok((_, source_new_qty, target_new_qty, delete_source)) => {
                    // Merge successful
                    log::info!("[InvManager WithinContainer Merge] Merge successful. Target new qty: {}, Source new qty: {}, Delete source: {}", 
                             target_new_qty, source_new_qty, delete_source);
                    
                    target_item.quantity = target_new_qty;
                    inventory_table.instance_id().update(target_item.clone());

                    if delete_source {
                        log::debug!("[InvManager WithinContainer Merge] Source item {} fully merged. Deleting from DB and clearing container slot {}.", source_id, source_slot_index);
                        inventory_table.instance_id().delete(source_id);
                        container.set_slot(source_slot_index, None, None);
                    } else {
                        log::debug!("[InvManager WithinContainer Merge] Source item {} partially merged. Updating quantity to {}. Container slot {} unchanged.", source_id, source_new_qty, source_slot_index);
                        source_item.quantity = source_new_qty;
                        inventory_table.instance_id().update(source_item.clone());
                    }
                },
                Err(merge_err_msg) => {
                    log::warn!("[InvManager WithinContainer] Cannot merge item {} (def {}) with item {} (def {}) in slot {}: {}. Attempting SWAP.", 
                             source_id, source_item.item_def_id, target_id, target_item.item_def_id, target_slot_index, merge_err_msg);

                    // Update source_item's location to target_slot_index
                    source_item.location = ItemLocation::Container(crate::models::ContainerLocationData {
                        container_id,
                        container_type: container_type.clone(),
                        slot_index: target_slot_index,
                    });
                    inventory_table.instance_id().update(source_item.clone());

                    // Update target_item's location to source_slot_index
                    target_item.location = ItemLocation::Container(crate::models::ContainerLocationData {
                        container_id, // container_id is the same for both items now
                        container_type: container_type.clone(),
                        slot_index: source_slot_index,
                    });
                    inventory_table.instance_id().update(target_item.clone());

                    // Update container's slots
                    container.set_slot(target_slot_index, Some(source_id), Some(source_item_def.id));
                    container.set_slot(source_slot_index, Some(target_id), Some(target_item_def.id));

                    log::info!("[InvManager WithinContainer Swap] Swapped item {} (now in slot {}) with item {} (now in slot {}).",
                             source_id, target_slot_index, target_id, source_slot_index);
                }
            }
        },
        (Some(source_id), None) => {
            // Target slot empty: Move source item to target slot
            let mut source_item = inventory_table.instance_id().find(source_id)
                .ok_or_else(|| format!("Source item {} not found in DB for move to empty slot", source_id))?;
            let source_item_def = item_def_table.id().find(source_item.item_def_id)
                .ok_or_else(|| format!("Definition not found for source item ID {}", source_item.item_def_id))?;

            log::info!("[InvManager WithinContainer Move] Moving item {} from slot {} to empty slot {}", source_id, source_slot_index, target_slot_index);
            
            source_item.location = ItemLocation::Container(crate::models::ContainerLocationData {
                container_id: container.get_container_id(),
                container_type: container.get_container_type(),
                slot_index: target_slot_index,
            });
            inventory_table.instance_id().update(source_item.clone());

            container.set_slot(target_slot_index, Some(source_id), Some(source_item_def.id));
            container.set_slot(source_slot_index, None, None); // Clear original slot
        },
        (None, Some(target_id)) => {
            // Source slot empty: Move target item to source slot
            let mut target_item = inventory_table.instance_id().find(target_id)
                .ok_or_else(|| format!("Target item {} not found in DB when source slot was empty", target_id))?;
                let target_item_def = item_def_table.id().find(target_item.item_def_id)
                    .ok_or_else(|| format!("Definition not found for target item ID {} when moving to empty source slot", target_item.item_def_id))?;
                
                log::info!("[InvManager WithinContainer Move] Moving item {} from slot {} to empty slot {}", target_id, target_slot_index, source_slot_index);

                target_item.location = ItemLocation::Container(crate::models::ContainerLocationData {
                    container_id: container.get_container_id(),
                    container_type: container.get_container_type(),
                    slot_index: source_slot_index, 
                });
            inventory_table.instance_id().update(target_item.clone());

                container.set_slot(source_slot_index, Some(target_id), Some(target_item_def.id));
                container.set_slot(target_slot_index, None, None); // Clear original target slot
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
    // let item_def_table = ctx.db.item_definition(); // For fetching target item's def if slot is occupied (not strictly needed by current merge logic)

    log::debug!("[MergeOrPlace] Attempting to place/merge item {} (def {}) into container slot {}. Container ID: {}, Type: {:?}", 
             item_to_place.instance_id, item_to_place.item_def_id, target_slot_index, container.get_container_id(), container.get_container_type());

    if target_slot_index >= container.num_slots() as u8 {
        return Err(format!("Target slot index {} out of bounds for merge/place.", target_slot_index));
    }

    let existing_item_id_in_slot = container.get_slot_instance_id(target_slot_index);
    log::debug!("[MergeOrPlace] Slot {} in container currently holds: {:?}", target_slot_index, existing_item_id_in_slot);

    if let Some(target_instance_id) = existing_item_id_in_slot {
        // Target slot is OCCUPIED. Attempt to merge.
        let mut target_item_in_slot = inventory_table.instance_id().find(target_instance_id)
            .ok_or_else(|| format!("Item {} in target container slot {} not found in DB for merge!", target_instance_id, target_slot_index))?;
        
        log::debug!("[MergeOrPlace] Target slot {} occupied by item {} (def {}). Item to place is {} (def {}).", 
                 target_slot_index, target_instance_id, target_item_in_slot.item_def_id, 
                 item_to_place.instance_id, item_to_place.item_def_id);
        
        match calculate_merge_result(item_to_place, &target_item_in_slot, item_def_for_item_to_place) {
            Ok((_, source_new_qty, target_new_qty, delete_source)) => {
                log::info!(
                    "[InvManager MergeOrPlace] Merging item {} (new qty {}) onto item {} in slot {} (new qty {}). Delete source: {}", 
                    item_to_place.instance_id, source_new_qty, target_instance_id, target_slot_index, target_new_qty, delete_source
                );
                target_item_in_slot.quantity = target_new_qty;
                inventory_table.instance_id().update(target_item_in_slot.clone());

                item_to_place.quantity = source_new_qty; 
                if delete_source {
                    log::debug!("[InvManager MergeOrPlace] item_to_place {} (qty {}) fully merged into target. Attempting to delete source.", item_to_place.instance_id, item_to_place.quantity);
                    if let Some(mut actual_item_to_delete) = inventory_table.instance_id().find(item_to_place.instance_id) {
                        actual_item_to_delete.location = ItemLocation::Unknown; 
                        inventory_table.instance_id().update(actual_item_to_delete.clone());
                        inventory_table.instance_id().delete(item_to_place.instance_id);
                        log::info!("[InvManager MergeOrPlace] Successfully deleted fully merged source item {}.", item_to_place.instance_id);
                    } else {
                        log::debug!("[InvManager MergeOrPlace] Source item {} was not found in DB for deletion, possibly a new item that was fully merged before first save.", item_to_place.instance_id);
                    }
                } else {
                    // item_to_place partially merged, its quantity is updated.
                    // Its location field should already reflect the target container slot (set by caller like split_stack_helper).
                    // Update it in DB to persist new quantity at that location.
                    log::debug!("[InvManager MergeOrPlace] item_to_place {} partially merged. Its quantity is now {}. Location {:?}. Updating in DB.", 
                                item_to_place.instance_id, item_to_place.quantity, item_to_place.location);
                    inventory_table.instance_id().update(item_to_place.clone());
                }
            },
            Err(msg) => {
                log::warn!("[InvManager MergeOrPlace] Cannot merge item {} (def {}) into slot {} (item {}, def {}): {}. Item not placed.", 
                         item_to_place.instance_id, item_to_place.item_def_id, 
                         target_slot_index, target_instance_id, 
                         target_item_in_slot.item_def_id, msg);
                return Err(format!("Slot {} is occupied and items cannot be merged: {}", target_slot_index, msg));
            }
        }
    } else {
        // Target slot is EMPTY. Place the item_to_place.
        log::info!("[InvManager MergeOrPlace] Placing item {} (qty {}) into empty container slot {}. Desired Location: {:?}", 
                 item_to_place.instance_id, item_to_place.quantity, target_slot_index, item_to_place.location);
        
        // Ensure item's location is correctly set to this container slot before updating/inserting.
        // This is crucial if item_to_place is an existing DB item being moved, or a new one from split.
        let final_location = ItemLocation::Container(crate::models::ContainerLocationData {
                container_id: container.get_container_id(),
                container_type: container.get_container_type(),
                slot_index: target_slot_index,
            });
        item_to_place.location = final_location;

        // If item_to_place is an existing DB item, update it. 
        // If it's a new one (e.g. from split_stack_helper), it was already inserted into DB by the helper,
        // so we just update its location and quantity here.
            inventory_table.instance_id().update(item_to_place.clone());
        log::debug!("[InvManager MergeOrPlace] Updated/Persisted item_to_place {} with location {:?} and quantity {}.", 
                    item_to_place.instance_id, item_to_place.location, item_to_place.quantity);

        container.set_slot(target_slot_index, Some(item_to_place.instance_id), Some(item_def_for_item_to_place.id));
        log::debug!("[InvManager MergeOrPlace] Container slot {} set to hold item {}.", target_slot_index, item_to_place.instance_id);
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

    log::debug!("[SplitIntoContainer] Player {} splitting {} of item {} into container slot {}. Container ID: {}, Type: {:?}", 
             sender_id, quantity_to_split, source_item_instance_id, target_slot_index, container.get_container_id(), container.get_container_type());

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
    let new_item_instance_id = crate::items::split_stack_helper(ctx, &mut source_item, quantity_to_split, initial_location_for_new_item)?;
    // inventory_table.instance_id().update(source_item); // split_stack_helper already updates source_item
    
    let mut new_item = inventory_table.instance_id().find(new_item_instance_id)
                       .ok_or("Failed to find newly split item instance after creation")?;
    let new_item_def = item_def_table.id().find(new_item.item_def_id).ok_or("Def for new item not found!")?;

    log::debug!("[SplitIntoContainer] After split_stack_helper: source_item {} qty {}, new_item {} (def {}) qty {} with location {:?}. Target slot in container is {}.",
        source_item.instance_id, source_item.quantity, new_item.instance_id, new_item.item_def_id, new_item.quantity, new_item.location, target_slot_index);

    match merge_or_place_into_container_slot(ctx, container, target_slot_index, &mut new_item, &new_item_def) {
        Ok(_) => {
            log::info!("[SplitIntoContainer] Successfully split {} from item {} and placed/merged new item {} into container slot {}.", 
                     quantity_to_split, source_item_instance_id, new_item_instance_id, target_slot_index);
            Ok(())
        }
        Err(e) => {
            log::error!("[SplitIntoContainer] Failed to place/merge new item {} after split: {}. Attempting to delete new item and revert source.", new_item_instance_id, e);
            inventory_table.instance_id().delete(new_item_instance_id);
            let mut source_to_revert = inventory_table.instance_id().find(source_item_instance_id).ok_or("Failed to find source item to revert qty")?;
            source_to_revert.quantity += quantity_to_split; 
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

    log::debug!("[SplitFromContainer] Splitting {} from container slot {} to player {} slot {}. Container ID: {}, Type: {:?}", 
             quantity_to_split, source_slot_index, target_slot_type, target_slot_index, container.get_container_id(), container.get_container_type());

    // --- 1. Get Source Item from Container --- 
    if source_slot_index >= container.num_slots() as u8 {
        return Err("Invalid source container slot index.".to_string());
    }
    let source_instance_id = container.get_slot_instance_id(source_slot_index)
        .ok_or("Source container slot is empty.")?;
    let mut source_item_from_container = inventory_table.instance_id().find(source_instance_id)
        .ok_or_else(|| format!("Source item instance {} from container slot {} not found in DB!", source_instance_id, source_slot_index))?;

    // --- 2. Determine Target Location for New Stack (in Player Inv/Hotbar) ---
    let player_target_location = match target_slot_type.as_str() {
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

    // --- 3. Perform Split using Helper --- 
    // split_stack_helper updates source_item_from_container quantity in DB,
    // and creates newly_split_item_id in DB with its location set to player_target_location.
    let newly_split_item_id = crate::items::split_stack_helper(ctx, &mut source_item_from_container, quantity_to_split, player_target_location.clone())?;
    
    let mut newly_split_item = inventory_table.instance_id().find(newly_split_item_id)
        .ok_or_else(|| format!("Newly split item {} not found after creation!", newly_split_item_id))?;
    let newly_split_item_def = item_def_table.id().find(newly_split_item.item_def_id)
        .ok_or_else(|| format!("Definition for newly split item {} not found", newly_split_item.item_def_id))?;

    log::debug!("[SplitFromContainer] After helper: source item {} (slot {}) now qty {}. New item {} (qty {}) at target {:?}.",
        source_item_from_container.instance_id, source_slot_index, source_item_from_container.quantity,
        newly_split_item.instance_id, newly_split_item.quantity, newly_split_item.location
    );
    
    // --- 4. Update Source Container Slot State ---
    // If source_item_from_container quantity is now zero after split, clear it from container struct.
    // Otherwise, the container struct still points to it with its reduced quantity.
    // (split_stack_helper already updated the source_item_from_container in the InventoryItem table)
    let source_item_after_split = inventory_table.instance_id().find(source_instance_id) // Re-fetch to be safe
        .ok_or_else(|| format!("Source item {} not found after split_stack_helper!", source_instance_id))?;

    if source_item_after_split.quantity == 0 {
        log::debug!("[SplitFromContainer] Source item {} in container slot {} depleted. Clearing slot and deleting item.", source_instance_id, source_slot_index);
        inventory_table.instance_id().delete(source_instance_id); // Delete the DB row for the depleted stack
        container.set_slot(source_slot_index, None, None);
    } else {
        // Container's slot already points to source_instance_id, which has its quantity updated in DB.
        // No change needed to container.set_slot here if item remains.
        log::debug!("[SplitFromContainer] Source item {} in container slot {} remains with qty {}.", source_instance_id, source_slot_index, source_item_after_split.quantity);
    }

    // --- 5. Handle Placement/Merge/Swap of newly_split_item in Player's Inventory ---
    // Check if the player's target slot is occupied by a *different* item.
    // Note: newly_split_item.location is already player_target_location.
    let item_actually_in_player_slot_opt = match player_target_location {
        ItemLocation::Inventory(ref data) => crate::player_inventory::find_item_in_inventory_slot(ctx, data.slot_index),
        ItemLocation::Hotbar(ref data) => crate::player_inventory::find_item_in_hotbar_slot(ctx, data.slot_index),
        _ => None, 
    };

    if let Some(mut actual_item_in_player_slot) = item_actually_in_player_slot_opt {
        // Player slot is occupied.
        // Important: Check if it's occupied by the newly_split_item itself (this means the slot was empty before split_stack_helper, which is fine)
        // or by a pre-existing different item.
        if actual_item_in_player_slot.instance_id == newly_split_item_id {
            // Slot was empty, newly_split_item is now there. This is a successful placement.
            log::info!("[SplitFromContainer] Newly split item {} (qty {}) successfully placed in player slot {:?}.", 
                     newly_split_item_id, newly_split_item.quantity, player_target_location);
        } else {
            // Player slot is occupied by a DIFFERENT pre-existing item. Try to merge or swap.
            let actual_item_in_player_slot_def = item_def_table.id().find(actual_item_in_player_slot.item_def_id)
                .ok_or_else(|| format!("Definition for item {} in player slot not found", actual_item_in_player_slot.item_def_id))?;
            
            log::info!("[SplitFromContainer] Player slot {:?} occupied by item {} (def {}). Attempting merge with new split item {} (def {}).", 
                     player_target_location, actual_item_in_player_slot.instance_id, actual_item_in_player_slot.item_def_id, 
                     newly_split_item_id, newly_split_item_def.id);

            match calculate_merge_result(&newly_split_item, &actual_item_in_player_slot, &newly_split_item_def) {
                Ok((qty_transfer, source_new_qty, target_new_qty, delete_source_of_merge)) => {
                    // MERGE Successful (newly_split_item into actual_item_in_player_slot)
                    log::info!("[SplitFromContainer MERGE] Merging {} from new split item {} onto player item {}. Player item new qty: {}. Delete new split item: {}",
                             qty_transfer, newly_split_item_id, actual_item_in_player_slot.instance_id, target_new_qty, delete_source_of_merge);

                    actual_item_in_player_slot.quantity = target_new_qty;
                    inventory_table.instance_id().update(actual_item_in_player_slot.clone());

                    if delete_source_of_merge {
                        log::debug!("[SplitFromContainer MERGE] Deleting fully merged new split item {}.", newly_split_item_id);
                        inventory_table.instance_id().delete(newly_split_item_id);
                    } else {
                        newly_split_item.quantity = source_new_qty;
                        // Its location is already player_target_location, just update qty
                        inventory_table.instance_id().update(newly_split_item.clone()); 
                    }
                }
                Err(merge_err_msg) => {
                    // MERGE Failed: SWAP (newly_split_item with actual_item_in_player_slot)
                    log::warn!("[SplitFromContainer SWAP] Cannot merge: {}. Swapping new split item {} (destined for player slot {:?}) with player item {} (currently in that slot).", 
                             merge_err_msg, newly_split_item_id, player_target_location, actual_item_in_player_slot.instance_id);

                    let original_container_slot_location = ItemLocation::Container(crate::models::ContainerLocationData {
                        container_id: container.get_container_id(),
                        container_type: container.get_container_type(),
                        slot_index: source_slot_index, // The slot from which the original stack was split
                    });

                    // 1. Item from player's slot (Hatchet) moves to the original container slot
                    actual_item_in_player_slot.location = original_container_slot_location;
                    inventory_table.instance_id().update(actual_item_in_player_slot.clone());
                    log::debug!("[SplitFromContainer SWAP] Player item {} (was {:?}) new location: {:?}.", 
                             actual_item_in_player_slot.instance_id, player_target_location, actual_item_in_player_slot.location);
                    
                    // 2. Update the container's direct slot state to hold actual_item_in_player_slot (Hatchet)
                    // This assumes the source_container_slot is now available for the Hatchet.
                    // If source_item_from_container still has items, this is more complex.
                    // For now, assume if a split happened, the source_slot is available or the remaining part of source_item_from_container stays.
                    // The Hatchet needs *a* slot in the container. If source_slot_index is still partially occupied, this will fail.
                    // This logic needs to ensure that the source_slot_index is effectively empty or can receive the swapped item.
                    // The original source_item_from_container was either depleted (slot cleared) or its quantity reduced.
                    // If it was depleted, container.set_slot was called with None.
                    // If it was NOT depleted, its entry in container.set_slot was NOT changed.
                    // So, if source_item_from_container was NOT depleted, Hatchet cannot go to source_slot_index. This swap would fail.
                    // This implies the current swap logic is too simple if the original container slot isn't fully clear.

                    // Re-evaluating the swap: The `actual_item_in_player_slot` needs to go to an empty slot in the source container,
                    // or if the source container's `source_slot_index` became empty due to the split taking the whole stack.
                    // For simplicity, this example will assume for now that for a SWAP to occur during split,
                    // the `source_slot_index` in the container must have been fully emptied by the split.
                    // A more robust solution would find any empty slot or handle partial source stack.

                    if source_item_after_split.quantity != 0 {
                        // The original slot in the container is still occupied by the remainder of the split stack.
                        // We cannot swap the player's item into this slot directly.
                        // This scenario requires a more complex handling: either fail the split-swap,
                        // or find another empty slot in the container for the player's item.
                        // For now, let's revert the newly_split_item and fail.
                        log::error!("[SplitFromContainer SWAP] Cannot swap: Original container slot {} still occupied by remainder of stack {}. Reverting split.", 
                                  source_slot_index, source_instance_id);
                        inventory_table.instance_id().delete(newly_split_item_id); // Delete the new item
                        // Revert source_item_from_container quantity (refetch and update)
                        let mut source_to_revert = inventory_table.instance_id().find(source_instance_id)
                            .ok_or_else(|| format!("Failed to find source item {} to revert qty for failed swap", source_instance_id))?;
                        source_to_revert.quantity += quantity_to_split; // Add back the split quantity
                        inventory_table.instance_id().update(source_to_revert);
                        // No changes to player's item or container struct needed for this failed swap path.
                        return Err("Cannot swap: Source container slot still occupied after split.".to_string());
                    }
                    
                    // If we reach here, source_item_after_split.quantity was 0, so container slot was cleared.
                    // Now, place the actual_item_in_player_slot into that cleared container slot.
                    container.set_slot(source_slot_index, Some(actual_item_in_player_slot.instance_id), Some(actual_item_in_player_slot_def.id));
                    log::debug!("[SplitFromContainer SWAP] Container slot {} now holds player item {} (def {}).", 
                             source_slot_index, actual_item_in_player_slot.instance_id, actual_item_in_player_slot_def.id);

                    // 3. newly_split_item's location is already player_target_location, and it's in DB.
                    // Its InventoryItem record is correct.
                    log::debug!("[SplitFromContainer SWAP] New split item {} remains at player location {:?}.",
                             newly_split_item_id, newly_split_item.location);
                }
            }
        }
    } else {
        // Player slot was empty. newly_split_item is already placed there by split_stack_helper.
        log::info!("[SplitFromContainer] Newly split item {} (qty {}) placed in empty player slot {:?}.", 
                 newly_split_item_id, newly_split_item.quantity, player_target_location);
        // No further action needed for item placement.
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

    log::debug!("[SplitWithinContainer] Splitting {} from slot {} to slot {} in container ID {}, Type {:?}", 
        quantity_to_split, source_slot_index, target_slot_index, container_id, container_type);

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
    // inventory_table.instance_id().update(source_item); // split_stack_helper updates source_item
    
    let mut new_item = inventory_table.instance_id().find(new_item_instance_id)
                       .ok_or("Failed to find newly split item instance after creation")?;
    let new_item_def = item_def_table.id().find(new_item.item_def_id).ok_or("Def for new item not found!")?;

    log::debug!("[SplitWithinContainer] After split_stack_helper: source_item {} (slot {}) qty {}, new_item {} (def {}) qty {} with location {:?}. Target slot in container is {}.",
        source_item.instance_id, source_slot_index, source_item.quantity, 
        new_item.instance_id, new_item.item_def_id, new_item.quantity, new_item.location, target_slot_index);

    match merge_or_place_into_container_slot(ctx, container, target_slot_index, &mut new_item, &new_item_def) {
        Ok(_) => {
            log::info!("[SplitWithinContainer] Successfully split {} from item {} (slot {}) and placed/merged new item {} into container slot {}.", 
                     quantity_to_split, source_instance_id, source_slot_index, new_item_instance_id, target_slot_index);
            
            let updated_source_item_from_db = inventory_table.instance_id().find(source_instance_id)
                .ok_or("Failed to refetch source item after split and merge/place attempt!")?;
            if updated_source_item_from_db.quantity == 0 {
                log::debug!("[SplitWithinContainer] Source item {} in slot {} has quantity 0. Deleting item and clearing slot.", 
                         source_instance_id, source_slot_index);
                let mut item_to_delete = updated_source_item_from_db;
                item_to_delete.location = ItemLocation::Unknown;
                inventory_table.instance_id().update(item_to_delete);
                inventory_table.instance_id().delete(source_instance_id);
                container.set_slot(source_slot_index, None, None);
            }
            Ok(())
        }
        Err(e) => {
            log::error!("[SplitWithinContainer] Failed to place/merge new item {} after split: {}. Reverting source and deleting new.", new_item_instance_id, e);
            inventory_table.instance_id().delete(new_item_instance_id); 
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
    // let item_def_table = ctx.db.item_definition(); // Not needed for this function

    // --- 1. Validate Source and Get Item ID --- 
    if source_slot_index >= container.num_slots() as u8 {
        return Err("Invalid source container slot index.".to_string());
    }
    let source_instance_id = container.get_slot_instance_id(source_slot_index)
        .ok_or("Source container slot is empty.")?;
    // let source_def_id = container.get_slot_def_id(source_slot_index)
    //     .ok_or_else(|| format!("Source slot {} missing def ID! Inconsistent state.", source_slot_index))?;
    
    // --- 2. Find First Available Player Slot --- 
    let target_location_opt = find_first_empty_player_slot(ctx, sender_id);

    if let Some(target_location) = target_location_opt {
        log::info!("[InvManager QuickMoveFromContainer] Attempting to move item {} from container slot {} to player {:?} at calculated location {:?}.", 
                 source_instance_id, source_slot_index, sender_id, target_location);

        // --- 3. Clear Container Slot --- 
        container.set_slot(source_slot_index, None, None);
        log::info!("[InvManager QuickMoveFromContainer] Cleared container slot {} (held item {}). Verify struct: Slot {} now holds {:?}.", 
                 source_slot_index, source_instance_id, source_slot_index, container.get_slot_instance_id(source_slot_index));

        // --- Update item's location to the TARGET PLAYER LOCATION before moving to player inventory --- 
        let mut item_to_move_to_player = inventory_table.instance_id().find(source_instance_id)
            .ok_or_else(|| format!("Item {} not found before attempting to set its location for player move", source_instance_id))?;
        
        log::info!("[InvManager QuickMoveFromContainer] Current location of item {} before setting to target player slot: {:?}", source_instance_id, item_to_move_to_player.location);
        item_to_move_to_player.location = target_location.clone(); // target_location is ItemLocation::Inventory or ItemLocation::Hotbar
        inventory_table.instance_id().update(item_to_move_to_player.clone()); // Persist this new location
        log::info!("[InvManager QuickMoveFromContainer] Set location of item {} to {:?}. Now attempting move via player_inventory functions.", source_instance_id, target_location);

        // --- 4. Move Item to Player (using the determined target_location) ---
        match target_location {
            ItemLocation::Inventory(ref data) => { // data is InventoryLocationData
                if let Err(e) = move_item_to_inventory(ctx, source_instance_id, data.slot_index) {
                    // Attempt to revert
                    log::error!("[InvManager QuickMoveFromContainer] Failed to move item {} to player inv slot {}: {}. Attempting revert.", source_instance_id, data.slot_index, e);
                    let source_item_for_revert = inventory_table.instance_id().find(source_instance_id).ok_or_else(|| format!("QuickMove: Source item {} lost during revert", source_instance_id))?;
                    let source_def_id_for_revert = source_item_for_revert.item_def_id;
                    container.set_slot(source_slot_index, Some(source_instance_id), Some(source_def_id_for_revert));
                    return Err(e);
                }
            }
            ItemLocation::Hotbar(ref data) => { // data is HotbarLocationData - add ref
                if let Err(e) = move_item_to_hotbar(ctx, source_instance_id, data.slot_index) {
                     // Attempt to revert
                    log::error!("[InvManager QuickMoveFromContainer] Failed to move item {} to player hotbar slot {}: {}. Attempting revert.", source_instance_id, data.slot_index, e);
                    let source_item_for_revert = inventory_table.instance_id().find(source_instance_id).ok_or_else(|| format!("QuickMove: Source item {} lost during revert", source_instance_id))?;
                    let source_def_id_for_revert = source_item_for_revert.item_def_id;
                    container.set_slot(source_slot_index, Some(source_instance_id), Some(source_def_id_for_revert));
                    return Err(e);
                }
            }
            _ => { // Should not happen if find_first_empty_player_slot is correct
                log::error!("[InvManager QuickMoveFromContainer] Unexpected target location type from find_first_empty_player_slot: {:?}. Reverting item {} to container slot {}.", target_location, source_instance_id, source_slot_index);
                let source_item_for_revert = inventory_table.instance_id().find(source_instance_id).ok_or_else(|| format!("QuickMove: Source item {} lost during revert", source_instance_id))?;
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
    log::info!(
        "[InvManager QuickMoveToContainer] Attempting for container type: {:?}, container ID: {}, item ID: {}", 
        container.get_container_type(), 
        container.get_container_id(), 
        item_instance_id
    );
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

    let target_slot_idx = target_slot_index_opt.ok_or_else(|| "Container is full or no suitable slot found.".to_string())?;
    
    log::info!("[QuickMoveToContainer] Attempting move item {} from player location {:?} to container slot {}.",
             item_instance_id, original_location, target_slot_idx);

    match merge_or_place_into_container_slot(ctx, container, target_slot_idx, &mut item_to_move, &item_def_to_move) {
        Ok(_) => {
            log::info!("[QuickMoveToContainer] Successfully moved/merged item {} to container slot {}.", item_instance_id, target_slot_idx);
            
            let item_after_merge_opt = inventory_table.instance_id().find(item_instance_id);
            let item_fully_moved_or_merged = item_after_merge_opt.is_none() || 
                                             item_after_merge_opt.map_or(false, |item| item.location != original_location);

            if let Some(eq_slot_type) = original_equipment_slot_type {
                if item_fully_moved_or_merged {
                    log::info!("[QuickMoveToContainer] Clearing original equipment slot {:?} as item {} was fully moved/merged.", eq_slot_type, item_instance_id);
                    crate::items::clear_specific_item_from_equipment_slots(ctx, sender_id, item_instance_id);
                }
            }

            // --- Check if the moved item was the active equipped item and clear if so ---
            let active_equip_table = ctx.db.active_equipment();
            if let Some(active_equipment_state) = active_equip_table.player_identity().find(sender_id) {
                if active_equipment_state.equipped_item_instance_id == Some(item_instance_id) {
                    // Item was identified as active. Check if it was indeed moved to container or deleted.
                    // The `item_fully_moved_or_merged` flag correctly covers if the item was deleted 
                    // or if its location changed from the original player slot.
                    if item_fully_moved_or_merged {
                        log::info!("[QuickMoveToContainer] Item {} was the active equipped item and was fully moved/merged to container. Clearing active item for player {}.", item_instance_id, sender_id);
                        match active_equipment::clear_active_item_reducer(ctx, sender_id) {
                            Ok(_) => log::debug!("[QuickMoveToContainer] Successfully cleared active item for {} after item {} quick moved to container/merged.", sender_id, item_instance_id),
                            Err(e) => log::error!("[QuickMoveToContainer] Error clearing active item for {}: {}", sender_id, e),
                        }
                    }
                }
            }
            // --- End active item check ---

            Ok(())
        }
        Err(e) => {
             log::error!("[QuickMoveToContainer] Failed to move item {} to container slot {}: {}", item_instance_id, target_slot_idx, e);
             Err(format!("Failed to place/merge item into container: {}", e))
        }
    }
}

// --- NEW GENERIC HANDLERS for Dropping Items from Containers ---

/// Generic handler to drop an entire item/stack from a container slot into the world.
/// The calling reducer is responsible for fetching the container and player, and updating the container in DB.
pub(crate) fn handle_drop_from_container_slot<C: ItemContainer>(
    ctx: &ReducerContext,
    container: &mut C, // Mutable reference to the container struct
    slot_index: u8,
    player_for_drop_location: &Player, // Player whose position determines drop location
) -> Result<(), String> {
    let inventory_table = ctx.db.inventory_item();
    let item_def_table = ctx.db.item_definition();

    log::info!("[GenericDropFromContainer] Dropping item from container ID {}, type {:?}, slot index {}. Drop relative to player {}.", 
             container.get_container_id(), container.get_container_type(), slot_index, player_for_drop_location.identity);

    // 1. Get item instance ID from the container slot
    let item_instance_id = container.get_slot_instance_id(slot_index)
        .ok_or_else(|| format!("No item in container {:?} ID {} slot {}.", container.get_container_type(), container.get_container_id(), slot_index))?;
    
    // 2. Fetch the InventoryItem and ItemDefinition
    let item_to_drop = inventory_table.instance_id().find(item_instance_id)
        .ok_or_else(|| format!("InventoryItem instance {} not found in DB.", item_instance_id))?;
    let item_def = item_def_table.id().find(item_to_drop.item_def_id)
        .ok_or_else(|| format!("ItemDefinition {} not found for item instance {}.", item_to_drop.item_def_id, item_instance_id))?;

    // 3. Calculate drop position based on the provided player
    let (drop_pos_x, drop_pos_y) = calculate_drop_position(player_for_drop_location);

    // 4. Create the dropped item entity in the world
    create_dropped_item_entity(ctx, item_def.id, item_to_drop.quantity, drop_pos_x, drop_pos_y)?;

    // 5. Delete the original InventoryItem from the database
    inventory_table.instance_id().delete(item_instance_id);
    log::debug!("[GenericDropFromContainer] Deleted InventoryItem instance {} from DB.", item_instance_id);

    // 6. Clear the slot in the container struct (passed by mut ref)
    // The caller (reducer) is responsible for persisting this change to the DB.
    container.set_slot(slot_index, None, None);
    log::info!("[GenericDropFromContainer] Item {} (def {}) qty {} dropped from container {:?} ID {} slot {}. Container struct updated.", 
             item_instance_id, item_def.id, item_to_drop.quantity, container.get_container_type(), container.get_container_id(), slot_index);

    Ok(())
}

/// Generic handler to split a quantity from an item stack in a container slot and drop the new stack into the world.
/// The calling reducer is responsible for fetching the container and player, and updating the container in DB.
pub(crate) fn handle_split_and_drop_from_container_slot<C: ItemContainer>(
    ctx: &ReducerContext,
    container: &mut C, // Mutable reference to the container struct
    slot_index: u8,
    quantity_to_split: u32,
    player_for_drop_location: &Player, // Player whose position determines drop location
) -> Result<(), String> {
    let inventory_table = ctx.db.inventory_item();
    let item_def_table = ctx.db.item_definition();

    log::info!("[GenericSplitDropFromContainer] Splitting {} from container ID {}, type {:?}, slot {}. Drop relative to player {}.", 
             quantity_to_split, container.get_container_id(), container.get_container_type(), slot_index, player_for_drop_location.identity);

    if quantity_to_split == 0 {
        return Err("Quantity to split cannot be zero.".to_string());
    }

    // 1. Get source item instance ID from the container slot
    let source_item_instance_id = container.get_slot_instance_id(slot_index)
        .ok_or_else(|| format!("No item in container {:?} ID {} slot {} to split.", container.get_container_type(), container.get_container_id(), slot_index))?;
    
    // 2. Fetch the source InventoryItem (mutable for split_stack_helper)
    let mut source_item = inventory_table.instance_id().find(source_item_instance_id)
        .ok_or_else(|| format!("Source InventoryItem instance {} not found in DB.", source_item_instance_id))?;
    let source_item_def = item_def_table.id().find(source_item.item_def_id)
        .ok_or_else(|| format!("ItemDefinition {} not found for source item {}.", source_item.item_def_id, source_item_instance_id))?;

    // 3. Handle splitting the entire stack (or more than available)
    if quantity_to_split >= source_item.quantity {
        log::info!("[GenericSplitDropFromContainer] Quantity to split ({}) is >= available ({}). Dropping entire stack from container {:?} ID {} slot {}.",
                 quantity_to_split, source_item.quantity, container.get_container_type(), container.get_container_id(), slot_index);
        // Delegate to the full drop handler. The container will be updated by it.
        return handle_drop_from_container_slot(ctx, container, slot_index, player_for_drop_location);
    }

    // 4. Perform the split using split_stack_helper
    let initial_location_for_new_split_item = ItemLocation::Unknown; // Temporary location
    let newly_split_item_id = split_stack_helper(
        ctx,
        &mut source_item, // Source item in the container, its quantity will be reduced by helper and updated in DB.
        quantity_to_split,
        initial_location_for_new_split_item,
    )?;
    // `source_item` (in the container) now has reduced quantity in the DB.
    // A new `InventoryItem` row (`newly_split_item_id`) exists with `quantity_to_split`.

    // 5. Fetch the newly created split item to get its details for dropping
    let new_item_for_drop = inventory_table.instance_id().find(newly_split_item_id)
        .ok_or_else(|| format!("Newly split item {} not found after creation.", newly_split_item_id))?;

    // 6. Calculate drop position based on the provided player
    let (drop_pos_x, drop_pos_y) = calculate_drop_position(player_for_drop_location);

    // 7. Create the dropped item entity for the new split stack
    create_dropped_item_entity(ctx, new_item_for_drop.item_def_id, new_item_for_drop.quantity, drop_pos_x, drop_pos_y)?;
    log::debug!("[GenericSplitDropFromContainer] Created DroppedItem entity for newly split stack {} (def {}, qty {}).", 
             newly_split_item_id, new_item_for_drop.item_def_id, new_item_for_drop.quantity);

    // 8. Delete the temporary InventoryItem row for the newly split stack (which was at ItemLocation::Unknown)
    inventory_table.instance_id().delete(newly_split_item_id);
    log::debug!("[GenericSplitDropFromContainer] Deleted temporary InventoryItem instance {} for the split part.", newly_split_item_id);

    // 9. The container's slot still points to source_item_instance_id, 
    // which has its quantity correctly updated in the InventoryItem table by split_stack_helper.
    // No direct change to container.set_slot() is needed here if the item instance ID in the slot remains the same.
    // The ItemContainer struct itself doesn't store quantity, only the instance ID.
    // The calling reducer is responsible for persisting any changes to the container struct if its structure changed (which it doesn't here, only item within it).

    log::info!("[GenericSplitDropFromContainer] Successfully split {} of item def {} (original instance {}) from container {:?} ID {} slot {}. Original stack now has {} items. Dropped stack created.",
             quantity_to_split, source_item_def.id, source_item_instance_id, container.get_container_type(), container.get_container_id(), slot_index, source_item.quantity);
    
    Ok(())
}