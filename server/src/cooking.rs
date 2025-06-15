use spacetimedb::{Identity, SpacetimeType, ReducerContext, Timestamp, Table, log};
use crate::models::{ItemLocation, ContainerType, ContainerLocationData}; // May need more specific imports later
use crate::items::{InventoryItem, ItemDefinition, inventory_item as InventoryItemTableTrait, item_definition as ItemDefinitionTableTrait}; // For function signatures
use std::cmp::min;
use crate::dropped_item; // For DROP_OFFSET and create_dropped_item_entity

// CookingProgress struct (moved from campfire.rs)
#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub struct CookingProgress {
    pub current_cook_time_secs: f32,
    pub target_cook_time_secs: f32,
    pub target_item_def_name: String,
}

// Trait for appliances that can cook/transform items
pub trait CookableAppliance {
    // --- Slot Access ---
    fn num_processing_slots(&self) -> usize;
    fn get_slot_instance_id(&self, slot_index: u8) -> Option<u64>;
    fn get_slot_def_id(&self, slot_index: u8) -> Option<u64>;
    fn set_slot(&mut self, slot_index: u8, instance_id: Option<u64>, def_id: Option<u64>);
    
    // --- Cooking Progress Access ---
    fn get_slot_cooking_progress(&self, slot_index: u8) -> Option<CookingProgress>;
    fn set_slot_cooking_progress(&mut self, slot_index: u8, progress: Option<CookingProgress>);

    // --- Appliance Info ---
    fn get_appliance_entity_id(&self) -> u64; // Generic ID for the appliance (e.g., campfire.id, furnace.id)
    fn get_appliance_world_position(&self) -> (f32, f32); // For dropping items

    // --- Container Type (for ItemLocation when placing transformed items back) ---
    fn get_appliance_container_type(&self) -> ContainerType;
}

// Renamed and generalized from transform_campfire_item
pub(crate) fn transform_item_in_appliance<T: CookableAppliance>(
    ctx: &ReducerContext,
    appliance: &mut T,
    slot_index: u8,
    new_item_def_name: &str,
) -> Result<(ItemDefinition, u64), String> { // Returns (new_item_def, new_item_instance_id)
    let item_defs_table = ctx.db.item_definition();
    let mut inventory_items_table = ctx.db.inventory_item();

    let new_item_def = item_defs_table
        .iter()
        .find(|def| def.name == new_item_def_name)
        .ok_or_else(|| format!("[TransformItem] Target item definition '{}' not found.", new_item_def_name))?;

    let source_item_instance_id = appliance.get_slot_instance_id(slot_index)
        .ok_or_else(|| format!("[TransformItem] No item instance found in appliance slot {} to transform.", slot_index))?;
    
    let mut source_item = inventory_items_table.instance_id().find(source_item_instance_id)
        .ok_or_else(|| format!("[TransformItem] Source item instance {} not found in DB for slot {}.", source_item_instance_id, slot_index))?;

    // Get the source item definition to check for crafting_output_quantity
    let source_item_def = item_defs_table.id().find(source_item.item_def_id)
        .ok_or_else(|| format!("[TransformItem] Source item definition {} not found.", source_item.item_def_id))?;

    // Determine output quantity: use crafting_output_quantity if available, otherwise default to 1
    let output_quantity = source_item_def.crafting_output_quantity.unwrap_or(1);

    if source_item.quantity > 0 {
        source_item.quantity -= 1;
    } else {
        log::error!("[TransformItem] Attempted to transform item {} in slot {} with quantity 0.", source_item_instance_id, slot_index);
        return Err(format!("Cannot transform item in slot {} with 0 quantity.", slot_index));
    }

    let appliance_id_for_log = appliance.get_appliance_entity_id(); // For logging

    if source_item.quantity == 0 {
        inventory_items_table.instance_id().delete(source_item_instance_id);
        appliance.set_slot(slot_index, None, None); 
        log::debug!("[TransformItem] Consumed last unit of item instance {} from appliance {} slot {}. Slot cleared.", 
                 source_item_instance_id, appliance_id_for_log, slot_index);
    } else {
        inventory_items_table.instance_id().update(source_item.clone()); // Pass clone if source_item is used later
        log::debug!("[TransformItem] Consumed 1 unit from stack {} in appliance {} slot {}. Remaining qty: {}.", 
                 source_item_instance_id, appliance_id_for_log, slot_index, source_item.quantity);
    }

    let new_inventory_item = InventoryItem {
        instance_id: 0, 
        item_def_id: new_item_def.id,
        quantity: output_quantity, // 🔥 NOW USES crafting_output_quantity!
        location: ItemLocation::Unknown, 
    };

    let inserted_item = inventory_items_table.try_insert(new_inventory_item)
        .map_err(|e| format!("[TransformItem] Failed to insert new transformed item '{}': {}", new_item_def_name, e))?;
    log::info!("[TransformItem] Appliance {}: Produced {} unit(s) of {} (New Instance ID: {}) from slot {}. Caller will place it.", 
             appliance_id_for_log, output_quantity, new_item_def_name, inserted_item.instance_id, slot_index);

    Ok((new_item_def.clone(), inserted_item.instance_id))
}

// Renamed and generalized from handle_cooked_item_placement
// Returns Ok(true) if appliance struct was modified, Ok(false) if dropped/merged without appliance struct modification.
pub(crate) fn handle_transformed_item_placement<T: CookableAppliance>(
    ctx: &ReducerContext,
    appliance: &mut T,
    new_item_instance_id: u64,
    new_item_def_id: u64,
) -> Result<bool, String> {
    let mut inventory_items_table = ctx.db.inventory_item();
    let item_defs_table = ctx.db.item_definition();

    let new_item_def = item_defs_table.id().find(new_item_def_id)
        .ok_or_else(|| format!("[TransformedPlacement] Definition not found for new item def ID {}", new_item_def_id))?;

    // Get the quantity of the new item to handle stacking properly
    let new_item = inventory_items_table.instance_id().find(new_item_instance_id)
        .ok_or_else(|| format!("[TransformedPlacement] New item instance {} not found.", new_item_instance_id))?;
    let new_item_quantity = new_item.quantity;

    // 1. Try to stack with existing items of the same type in OTHER appliance slots
    for i in 0..appliance.num_processing_slots() as u8 {
        if appliance.get_slot_def_id(i) == Some(new_item_def_id) {
            if let Some(target_slot_instance_id) = appliance.get_slot_instance_id(i) {
                // Ensure we are not trying to stack with the item that was just created if it somehow got placed back into a slot already
                // This check might be redundant if new_item_instance_id starts with ItemLocation::Unknown
                if target_slot_instance_id != new_item_instance_id { 
                    if let Some(mut target_item) = inventory_items_table.instance_id().find(target_slot_instance_id) {
                        let space_available = new_item_def.stack_size.saturating_sub(target_item.quantity);
                        if space_available > 0 {
                            let amount_to_stack = std::cmp::min(space_available, new_item_quantity);
                            target_item.quantity += amount_to_stack;
                            inventory_items_table.instance_id().update(target_item);
                            
                            if amount_to_stack >= new_item_quantity {
                                // All of the new item was stacked
                                inventory_items_table.instance_id().delete(new_item_instance_id); 
                                log::info!("[TransformedPlacement] Appliance {}: Stacked {} unit(s) of item (Def {}) onto existing stack in slot {}.", 
                                         appliance.get_appliance_entity_id(), amount_to_stack, new_item_def_id, i);
                                return Ok(false); 
                            } else {
                                // Partial stack - update the new item quantity and continue trying to place the rest
                                let mut updated_new_item = inventory_items_table.instance_id().find(new_item_instance_id)
                                    .ok_or_else(|| format!("[TransformedPlacement] New item instance {} disappeared during stacking.", new_item_instance_id))?;
                                updated_new_item.quantity -= amount_to_stack;
                                let remaining_quantity = updated_new_item.quantity; // Store before move
                                inventory_items_table.instance_id().update(updated_new_item);
                                log::info!("[TransformedPlacement] Appliance {}: Partially stacked {} unit(s) of item (Def {}) onto existing stack in slot {}. {} remaining.", 
                                         appliance.get_appliance_entity_id(), amount_to_stack, new_item_def_id, i, remaining_quantity);
                                // Continue to try placing the remaining quantity
                            }
                        }
                    }
                }
            }
        }
    }

    // 2. Try to place in an empty slot in the appliance
    for i in 0..appliance.num_processing_slots() as u8 {
        if appliance.get_slot_instance_id(i).is_none() {
            if let Some(mut new_item_to_place) = inventory_items_table.instance_id().find(new_item_instance_id) {
                new_item_to_place.location = ItemLocation::Container(ContainerLocationData {
                    container_type: appliance.get_appliance_container_type(),
                    container_id: appliance.get_appliance_entity_id(),
                    slot_index: i,
                });
                inventory_items_table.instance_id().update(new_item_to_place);
                appliance.set_slot(i, Some(new_item_instance_id), Some(new_item_def_id));
                log::info!("[TransformedPlacement] Appliance {}: Placed item (Instance {}, Def {}) into empty slot {}.", appliance.get_appliance_entity_id(), new_item_instance_id, new_item_def_id, i);
                return Ok(true); 
            } else {
                return Err(format!("[TransformedPlacement] Failed to find new item instance {} to place in empty slot.", new_item_instance_id));
            }
        }
    }

    // 3. If not added to appliance (full or error), drop it
    let (appliance_x, appliance_y) = appliance.get_appliance_world_position();
    
    // Get the current quantity of the item to drop
    let final_item_to_drop = inventory_items_table.instance_id().find(new_item_instance_id)
        .ok_or_else(|| format!("[TransformedPlacement] Item instance {} not found for dropping.", new_item_instance_id))?;
    let quantity_to_drop = final_item_to_drop.quantity;
    
    log::info!("[TransformedPlacement] Appliance {}: Slots full. Dropping {} unit(s) of item (Instance {}, Def {}).", 
             appliance.get_appliance_entity_id(), quantity_to_drop, new_item_instance_id, new_item_def_id);
    
    // Delete the temporary item that was in ItemLocation::Unknown
    inventory_items_table.instance_id().delete(new_item_instance_id);
    // Create a new dropped item entity in the world with the correct quantity
    dropped_item::create_dropped_item_entity(ctx, new_item_def_id, quantity_to_drop, appliance_x, appliance_y + dropped_item::DROP_OFFSET / 2.0)?;
    
    Ok(false) 
}

// --- Main Processing Function for Cookable Appliances ---
pub fn process_appliance_cooking_tick<T: CookableAppliance>(
    ctx: &ReducerContext,
    appliance: &mut T,
    time_increment: f32,
    active_fuel_instance_id: Option<u64>, // MODIFIED: Pass the ID directly
) -> Result<bool, String> { // Returns true if the appliance struct was modified
    let mut appliance_struct_modified = false;
    let item_definition_table = ctx.db.item_definition();

    for i in 0..appliance.num_processing_slots() as u8 {
        let mut slot_cooking_progress_opt = appliance.get_slot_cooking_progress(i);

        // Check if current slot is the active fuel slot
        let is_this_slot_active_fuel = if let Some(active_id) = active_fuel_instance_id {
            appliance.get_slot_instance_id(i) == Some(active_id)
        } else {
            false
        };

        if is_this_slot_active_fuel {
            if slot_cooking_progress_opt.is_some() {
                appliance.set_slot_cooking_progress(i, None);
                appliance_struct_modified = true;
                log::debug!("[ApplianceCooking] Appliance {}: Slot {} contains active fuel. Clearing any cooking progress.", appliance.get_appliance_entity_id(), i);
            }
            continue; // Skip to next slot if this one is active fuel
        }

        if let Some(current_item_instance_id) = appliance.get_slot_instance_id(i) {
            if let Some(current_item_def_id) = appliance.get_slot_def_id(i) {
                if let Some(current_item_def) = item_definition_table.id().find(current_item_def_id) {
                    if let Some(mut progress_data) = slot_cooking_progress_opt.take() {
                        progress_data.current_cook_time_secs += time_increment;
                        log::debug!("[ApplianceCooking] Appliance {}: Slot {} item (Def: {}) incremented cook time to {:.1}s / {:.1}s for target {}", 
                                 appliance.get_appliance_entity_id(), i, current_item_def.id, progress_data.current_cook_time_secs, progress_data.target_cook_time_secs, progress_data.target_item_def_name);

                        if progress_data.current_cook_time_secs >= progress_data.target_cook_time_secs {
                            match transform_item_in_appliance(ctx, appliance, i, &progress_data.target_item_def_name) {
                                Ok((transformed_item_def, new_instance_id)) => {
                                    appliance_struct_modified = true; // transform_item_in_appliance might have modified it
                                    match handle_transformed_item_placement(ctx, appliance, new_instance_id, transformed_item_def.id) {
                                        Ok(placement_modified_appliance) => {
                                            if placement_modified_appliance {
                                                appliance_struct_modified = true;
                                            }
                                        }
                                        Err(e) => {
                                            log::error!("[ApplianceCooking] Appliance {}: Error placing transformed item {}: {}. Item may be lost.", 
                                                     appliance.get_appliance_entity_id(), new_instance_id, e);
                                            ctx.db.inventory_item().instance_id().delete(new_instance_id); // Attempt cleanup
                                        }
                                    }

                                    // Logic for the source slot after transformation
                                    if let Some(source_instance_after_transform) = appliance.get_slot_instance_id(i) {
                                        if let Some(source_item_details) = ctx.db.inventory_item().instance_id().find(source_instance_after_transform) {
                                            if source_item_details.quantity > 0 {
                                                if let Some(raw_def) = item_definition_table.id().find(source_item_details.item_def_id) {
                                                    if let (Some(raw_target_name), Some(raw_target_time)) = (&raw_def.cooked_item_def_name, raw_def.cook_time_secs) {
                                                        if raw_target_time > 0.0 {
                                                            slot_cooking_progress_opt = Some(CookingProgress {
                                                                current_cook_time_secs: 0.0,
                                                                target_cook_time_secs: raw_target_time,
                                                                target_item_def_name: raw_target_name.clone(),
                                                            });
                                                        } else { slot_cooking_progress_opt = None; }
                                                    } else { slot_cooking_progress_opt = None; }
                                                } else { slot_cooking_progress_opt = None; }
                                            } else { slot_cooking_progress_opt = None; }
                                        } else { slot_cooking_progress_opt = None; }
                                    } else {
                                        // Original stack depleted. Does the *transformed* item have a next stage?
                                        // This is tricky if it was moved. For now, if source slot is empty, stop cooking *in this slot*.
                                        // Further cooking of the transformed item would happen in its new slot, if applicable.
                                        slot_cooking_progress_opt = None;
                                    }
                                }
                                Err(e) => {
                                    log::error!("[ApplianceCooking] Appliance {}: Error transforming item in slot {}: {}. Halting for this slot.", 
                                             appliance.get_appliance_entity_id(), i, e);
                                    slot_cooking_progress_opt = None;
                                }
                            }
                        } else {
                            slot_cooking_progress_opt = Some(progress_data); // Continue current stage
                        }
                    } else { // No current progress, check if item *should* start cooking
                        let item_can_be_fuel_for_other_appliances = current_item_def.fuel_burn_duration_secs.is_some() && current_item_def.fuel_burn_duration_secs.unwrap_or(0.0) > 0.0;
                        // The `is_slot_active_fuel` check handles the current appliance's fuel.
                        // This `prevent_cooking_due_to_potential_fuel_selection` is more about general fuel items not starting to cook if no appliance fuel is active.
                        // For a generic cooking tick, we might simplify this: if `is_slot_active_fuel` is false, it *can* cook.
                        // The caller (campfire) will ensure `is_slot_active_fuel` is true for its burning fuel.
                        
                        if let (Some(target_name), Some(target_time)) = (&current_item_def.cooked_item_def_name, current_item_def.cook_time_secs) {
                            if target_time > 0.0 {
                                slot_cooking_progress_opt = Some(CookingProgress {
                                    current_cook_time_secs: 0.0, 
                                    target_cook_time_secs: target_time,
                                    target_item_def_name: target_name.clone(),
                                });
                                log::debug!("[ApplianceCooking] Appliance {}: Slot {} item {} starting to cook towards {} ({}s).", 
                                         appliance.get_appliance_entity_id(), i, current_item_def.name, target_name, target_time);
                            }
                        }
                    }
                }
            }
        } else if slot_cooking_progress_opt.is_some() { // Slot became empty but had progress
            slot_cooking_progress_opt = None;
            log::debug!("[ApplianceCooking] Appliance {}: Slot {} became empty, cleared stale cooking progress.", appliance.get_appliance_entity_id(), i);
        }

        // Update appliance's slot_X_cooking_progress for the current slot i
        let previous_slot_progress_for_appliance = appliance.get_slot_cooking_progress(i);
        if previous_slot_progress_for_appliance != slot_cooking_progress_opt {
            appliance.set_slot_cooking_progress(i, slot_cooking_progress_opt);
            appliance_struct_modified = true;
        }
    }
    Ok(appliance_struct_modified)
}

