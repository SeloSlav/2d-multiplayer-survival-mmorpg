/*
 * server/src/crafting_queue.rs
 *
 * Purpose: Manages the player's crafting queue and handles crafting completion.
 */

use spacetimedb::{Identity, ReducerContext, Table, Timestamp, TimeDuration};
use log;
use std::{collections::HashMap, time::Duration, ops::AddAssign};

// Import table traits and types
use crate::crafting::{Recipe, RecipeIngredient};
use crate::crafting::recipe as RecipeTableTrait;
use crate::items::{InventoryItem, ItemDefinition};
use crate::items::{inventory_item as InventoryItemTableTrait, item_definition as ItemDefinitionTableTrait};
use crate::Player;
use crate::player as PlayerTableTrait;
use crate::player_corpse::player_corpse as PlayerCorpseTableTrait;
use crate::dropped_item; // For dropping items
use crate::models::ItemLocation; // Corrected import
use crate::player_inventory::{find_first_empty_player_slot, get_player_item};

// --- Crafting Queue Table ---
#[spacetimedb::table(name = crafting_queue_item, public)]
#[derive(Clone, Debug)]
pub struct CraftingQueueItem {
    #[primary_key]
    #[auto_inc]
    pub queue_item_id: u64,
    pub player_identity: Identity,
    pub recipe_id: u64,
    pub output_item_def_id: u64, // Store for easier lookup on finish
    pub output_quantity: u32, // Store for granting
    pub start_time: Timestamp,
    pub finish_time: Timestamp, // When this specific item should finish
}

// --- Scheduled Reducer Table --- 
// This table drives the periodic check for finished crafting items.
#[spacetimedb::table(name = crafting_finish_schedule, scheduled(check_finished_crafting))]
#[derive(Clone)]
pub struct CraftingFinishSchedule {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub scheduled_at: spacetimedb::spacetimedb_lib::ScheduleAt,
}

const CRAFTING_CHECK_INTERVAL_SECS: u64 = 1; // Check every second

// --- Reducers ---

/// Starts crafting an item if the player has the required resources.
#[spacetimedb::reducer]
pub fn start_crafting(ctx: &ReducerContext, recipe_id: u64) -> Result<(), String> {
    let sender_id = ctx.sender;
    let recipe_table = ctx.db.recipe();
    let inventory_table = ctx.db.inventory_item();
    let queue_table = ctx.db.crafting_queue_item();

    // 1. Find the Recipe
    let recipe = recipe_table.recipe_id().find(&recipe_id)
        .ok_or(format!("Recipe with ID {} not found.", recipe_id))?;

    // 2. Check Resources
    let mut required_resources_map: HashMap<u64, u32> = HashMap::new();
    for ingredient in &recipe.ingredients {
        *required_resources_map.entry(ingredient.item_def_id).or_insert(0) += ingredient.quantity;
    }

    let mut available_resources_check: HashMap<u64, u32> = HashMap::new();
    let mut items_to_consume_map: HashMap<u64, u32> = HashMap::new(); // Map<instance_id, quantity_to_consume>

    // Iterate over player's inventory and hotbar items to find materials
    for item in inventory_table.iter() {
        let is_in_player_possession = match &item.location {
            ItemLocation::Inventory(crate::models::InventoryLocationData { owner_id, .. }) => *owner_id == sender_id,
            ItemLocation::Hotbar(crate::models::HotbarLocationData { owner_id, .. }) => *owner_id == sender_id,
            _ => false,
        };

        if is_in_player_possession {
            // Track total available for this item definition
            *available_resources_check.entry(item.item_def_id).or_insert(0) += item.quantity;

            // If this item definition is required for the recipe, determine how much of this stack to consume
            if let Some(needed_qty_for_def) = required_resources_map.get_mut(&item.item_def_id) {
                if *needed_qty_for_def > 0 { // Still need some of this item definition
                    let can_take_from_stack = std::cmp::min(item.quantity, *needed_qty_for_def);
                    *items_to_consume_map.entry(item.instance_id).or_insert(0) += can_take_from_stack;
                    *needed_qty_for_def -= can_take_from_stack;
                }
            }
        }
    }

    // Verify all requirements met by checking the initial required_resources_map against available_resources_check
    for (def_id, initial_needed) in recipe.ingredients.iter().map(|ing| (ing.item_def_id, ing.quantity)) {
        let total_available_for_def = available_resources_check.get(&def_id).copied().unwrap_or(0);
        if total_available_for_def < initial_needed {
            let item_name = ctx.db.item_definition().id().find(def_id).map(|d| d.name.clone()).unwrap_or_else(|| format!("ID {}", def_id));
            return Err(format!("Missing {} {} to craft. You have {}.", initial_needed - total_available_for_def, item_name, total_available_for_def));
        }
    }
    
    // Double check that all entries in required_resources_map are now zero (or less, if over-provided)
    // This check might be redundant if the above available_resources_check is correct
    for (def_id, still_needed) in required_resources_map.iter() {
        if *still_needed > 0 {
             let item_name = ctx.db.item_definition().id().find(*def_id).map(|d| d.name.clone()).unwrap_or_else(|| format!("ID {}", def_id));
            return Err(format!("Internal error: Resource check failed. Still need {} of {}.", still_needed, item_name));
        }
    }

    // 3. Consume Resources
    log::info!("[Crafting] Consuming resources for Recipe ID {} for player {:?}", recipe_id, sender_id);
    for (instance_id, qty_to_consume) in items_to_consume_map {
        if let Some(mut item) = inventory_table.instance_id().find(instance_id) {
            if qty_to_consume >= item.quantity {
                inventory_table.instance_id().delete(instance_id);
            } else {
                item.quantity -= qty_to_consume;
                inventory_table.instance_id().update(item);
            }
        } else {
            // This shouldn't happen if checks passed, but log if it does
            log::error!("[Crafting] Failed to find item instance {} to consume resources.", instance_id);
            return Err("Internal error consuming resources.".to_string());
        }
    }

    // 4. Calculate Finish Time
    let now = ctx.timestamp;
    let mut last_finish_time = now;
    // Find the latest finish time for items already in this player's queue
    for item in queue_table.iter().filter(|q| q.player_identity == sender_id) {
        if item.finish_time > last_finish_time {
            last_finish_time = item.finish_time;
        }
    }
    let crafting_duration = Duration::from_secs(recipe.crafting_time_secs as u64);
    let finish_time = last_finish_time + spacetimedb::TimeDuration::from(crafting_duration);

    // 5. Add to Queue
    let queue_item = CraftingQueueItem {
        queue_item_id: 0, // Auto-increment
        player_identity: sender_id,
        recipe_id,
        output_item_def_id: recipe.output_item_def_id,
        output_quantity: recipe.output_quantity,
        start_time: now,
        finish_time,
    };
    queue_table.insert(queue_item);

    let item_name = ctx.db.item_definition().id().find(recipe.output_item_def_id).map(|d| d.name.clone()).unwrap_or_else(|| format!("ID {}", recipe.output_item_def_id));
    log::info!("[Crafting] Player {:?} started crafting {} (Recipe ID {}). Finish time: {:?}", sender_id, item_name, recipe_id, finish_time);

    Ok(())
}

/// Starts crafting multiple items of the same recipe if the player has the required resources.
#[spacetimedb::reducer]
pub fn start_crafting_multiple(ctx: &ReducerContext, recipe_id: u64, quantity_to_craft: u32) -> Result<(), String> {
    if quantity_to_craft == 0 {
        return Err("Quantity to craft must be greater than 0.".to_string());
    }

    let sender_id = ctx.sender;
    let recipe_table = ctx.db.recipe();
    let inventory_table = ctx.db.inventory_item();
    let queue_table = ctx.db.crafting_queue_item();
    let item_def_table = ctx.db.item_definition(); // For item names in errors

    // 1. Find the Recipe
    let recipe = recipe_table.recipe_id().find(&recipe_id)
        .ok_or(format!("Recipe with ID {} not found.", recipe_id))?;

    // 2. Check Resources for the total quantity
    let mut total_required_resources_map: HashMap<u64, u32> = HashMap::new();
    for ingredient in &recipe.ingredients {
        *total_required_resources_map.entry(ingredient.item_def_id).or_insert(0) += ingredient.quantity * quantity_to_craft;
    }

    let mut available_resources_check: HashMap<u64, u32> = HashMap::new();
    // This map will store {item_instance_id, quantity_to_consume_from_this_stack}
    let mut items_to_consume_map: HashMap<u64, u32> = HashMap::new();

    // Iterate over player's inventory and hotbar items
    for item_instance in inventory_table.iter() {
        let is_in_player_possession = match &item_instance.location {
            ItemLocation::Inventory(crate::models::InventoryLocationData { owner_id, .. }) => *owner_id == sender_id,
            ItemLocation::Hotbar(crate::models::HotbarLocationData { owner_id, .. }) => *owner_id == sender_id,
            _ => false,
        };

        if is_in_player_possession {
            *available_resources_check.entry(item_instance.item_def_id).or_insert(0) += item_instance.quantity;

            if let Some(total_needed_for_def) = total_required_resources_map.get_mut(&item_instance.item_def_id) {
                if *total_needed_for_def > 0 { // Still need some of this item definition
                    let already_marked_to_consume_from_this_def = items_to_consume_map.iter()
                        .filter(|(id, _)| inventory_table.instance_id().find(**id).map_or(false, |i| i.item_def_id == item_instance.item_def_id))
                        .map(|(_, qty)| qty)
                        .sum::<u32>();
                    
                    let remaining_needed_for_def = (*total_needed_for_def).saturating_sub(already_marked_to_consume_from_this_def);
                    let can_take_from_stack = std::cmp::min(item_instance.quantity, remaining_needed_for_def);
                    
                    if can_take_from_stack > 0 {
                        *items_to_consume_map.entry(item_instance.instance_id).or_insert(0) += can_take_from_stack;
                        // No, don't decrement total_needed_for_def here. We verify it at the end.
                    }
                }
            }
        }
    }
    
    // Verify all requirements met
    for (def_id, total_required) in total_required_resources_map.iter() {
        let total_available_for_def = available_resources_check.get(def_id).copied().unwrap_or(0);
        if total_available_for_def < *total_required {
            let item_name = item_def_table.id().find(*def_id).map(|d| d.name.clone()).unwrap_or_else(|| format!("ID {}", def_id));
            return Err(format!("Missing {} {} to craft {}x. You have {}.",
                total_required - total_available_for_def, item_name, quantity_to_craft, total_available_for_def));
        }
    }

    // 3. Consume Resources
    log::info!("[Crafting Multiple] Consuming resources for Recipe ID {} ({}x) for player {:?}", recipe_id, quantity_to_craft, sender_id);
    for (instance_id, qty_to_consume) in items_to_consume_map {
        if let Some(mut item) = inventory_table.instance_id().find(instance_id) {
            if qty_to_consume >= item.quantity {
                inventory_table.instance_id().delete(instance_id);
            } else {
                item.quantity -= qty_to_consume;
                inventory_table.instance_id().update(item);
            }
        } else {
            log::error!("[Crafting Multiple] Failed to find item instance {} to consume resources.", instance_id);
            return Err("Internal error consuming resources for multiple craft.".to_string());
        }
    }

    // 4. Calculate Finish Times and Add to Queue
    let mut current_item_start_time = ctx.timestamp;
    // Find the latest finish time for items already in this player's queue
    // This becomes the start time for the first item in this batch.
    for item in queue_table.iter().filter(|q| q.player_identity == sender_id) {
        if item.finish_time > current_item_start_time {
            current_item_start_time = item.finish_time;
        }
    }

    let crafting_duration_per_item = TimeDuration::from(Duration::from_secs(recipe.crafting_time_secs as u64));

    for i in 0..quantity_to_craft {
        let item_finish_time = current_item_start_time + crafting_duration_per_item;
        
        let queue_item = CraftingQueueItem {
            queue_item_id: 0, // Auto-increment
            player_identity: sender_id,
            recipe_id,
            output_item_def_id: recipe.output_item_def_id,
            output_quantity: recipe.output_quantity,
            start_time: current_item_start_time, // The effective start time for this item in the sequence
            finish_time: item_finish_time,
        };
        queue_table.insert(queue_item.clone()); // Clone here if insert takes ownership and we log after

        current_item_start_time = item_finish_time; // Next item starts when this one finishes

        if i == 0 { // Log the start of the batch
             let item_name = item_def_table.id().find(recipe.output_item_def_id).map(|d| d.name.clone()).unwrap_or_else(|| format!("ID {}", recipe.output_item_def_id));
             log::info!("[Crafting Multiple] Player {:?} started crafting {}x {} (Recipe ID {}). First item finishes: {:?}, Last item finishes: {:?}",
                 sender_id, quantity_to_craft, item_name, recipe_id, item_finish_time, current_item_start_time);
        }
    }
    Ok(())
}

/// Scheduled reducer to check for and grant finished crafting items.
#[spacetimedb::reducer]
pub fn check_finished_crafting(ctx: &ReducerContext, _schedule: CraftingFinishSchedule) -> Result<(), String> {
    let now = ctx.timestamp;
    let queue_table = ctx.db.crafting_queue_item();
    let player_table = ctx.db.player();
    let mut items_to_finish: Vec<CraftingQueueItem> = Vec::new();

    // Find items ready to finish
    for item in queue_table.iter() {
        if now >= item.finish_time {
            items_to_finish.push(item.clone());
        }
    }

    if items_to_finish.is_empty() {
        return Ok(()); // Nothing to do
    }

    log::info!("[Crafting Check] Found {} items ready to finish.", items_to_finish.len());

    for item in items_to_finish {
        // Check if player still exists and is not dead
        let player_opt = player_table.identity().find(&item.player_identity);
        if player_opt.is_none() || player_opt.as_ref().map_or(false, |p| p.is_dead) {
            log::warn!("[Crafting Check] Player {:?} for queue item {} no longer valid or is dead. Cancelling craft.",
                      item.player_identity, item.queue_item_id);
            // Refund resources (or they are lost if player doesn't exist?)
            // For simplicity now, just delete the queue item. Refund on death handles it.
            queue_table.queue_item_id().delete(item.queue_item_id);
            continue; // Skip to next item
        }

        let player = player_opt.as_ref().unwrap(); // Use as_ref() here

        // Grant item or drop if inventory is full
        log::info!("[Crafting Check] Finishing item {} for player {:?}. Output: DefID {}, Qty {}",
                  item.queue_item_id, item.player_identity, item.output_item_def_id, item.output_quantity);

        match crate::items::add_item_to_player_inventory(ctx, item.player_identity, item.output_item_def_id, item.output_quantity) {
            Ok(_) => {
                 let item_name = ctx.db.item_definition().id().find(item.output_item_def_id).map(|d| d.name.clone()).unwrap_or_else(|| format!("ID {}", item.output_item_def_id));
                 log::info!("[Crafting Check] Granted {} {} to player {:?}", item.output_quantity, item_name, item.player_identity);
            }
            Err(e) => {
                log::warn!("[Crafting Check] Inventory full for player {:?}. Dropping item {}: {}", item.player_identity, item.output_item_def_id, e);
                // Drop item near player
                let (drop_x, drop_y) = dropped_item::calculate_drop_position(&player);
                if let Err(drop_err) = dropped_item::create_dropped_item_entity(ctx, item.output_item_def_id, item.output_quantity, drop_x, drop_y) {
                     log::error!("[Crafting Check] Failed to drop item {} for player {:?}: {}", item.output_item_def_id, item.player_identity, drop_err);
                     // Item is lost if dropping fails too
                }
            }
        }

        // Delete the finished item from the queue
        queue_table.queue_item_id().delete(item.queue_item_id);
    }

    Ok(())
}

/// Cancels a specific item in the player's crafting queue and refunds resources.
#[spacetimedb::reducer]
pub fn cancel_crafting_item(ctx: &ReducerContext, queue_item_id: u64) -> Result<(), String> {
    let sender_id = ctx.sender;
    let queue_table = ctx.db.crafting_queue_item();
    let recipe_table = ctx.db.recipe();
    let player_table = ctx.db.player();

    // 1. Find the Queue Item
    let queue_item = queue_table.queue_item_id().find(&queue_item_id)
        .ok_or(format!("Crafting queue item {} not found.", queue_item_id))?;

    // 2. Verify Ownership
    if queue_item.player_identity != sender_id {
        return Err("Cannot cancel crafting item started by another player.".to_string());
    }

    // 3. Find the Recipe
    let recipe = recipe_table.recipe_id().find(&queue_item.recipe_id)
        .ok_or(format!("Recipe {} for queue item {} not found.", queue_item.recipe_id, queue_item_id))?;

    log::info!("[Crafting Cancel] Player {:?} cancelling queue item {} (Recipe ID {}). Refunding resources...",
             sender_id, queue_item_id, queue_item.recipe_id);

    // 4. Refund Resources
    let mut refund_failed = false;
    for ingredient in &recipe.ingredients {
        match crate::items::add_item_to_player_inventory(ctx, sender_id, ingredient.item_def_id, ingredient.quantity) {
            Ok(_) => {
                let item_name = ctx.db.item_definition().id().find(ingredient.item_def_id).map(|d| d.name.clone()).unwrap_or_else(|| format!("ID {}", ingredient.item_def_id));
                log::debug!("[Crafting Cancel] Refunded {} {} to player {:?}.", ingredient.quantity, item_name, sender_id);
            }
            Err(e) => {
                log::warn!("[Crafting Cancel] Inventory full for player {:?}. Dropping refunded item {}: {}", sender_id, ingredient.item_def_id, e);
                refund_failed = true;
                // Find player position to drop item
                if let Some(player) = player_table.identity().find(&sender_id) {
                     let (drop_x, drop_y) = dropped_item::calculate_drop_position(&player);
                     if let Err(drop_err) = dropped_item::create_dropped_item_entity(ctx, ingredient.item_def_id, ingredient.quantity, drop_x, drop_y) {
                         log::error!("[Crafting Cancel] Failed to drop refunded item {} for player {:?}: {}", ingredient.item_def_id, sender_id, drop_err);
                         // Resource is lost if dropping fails
                     }
                } else {
                    log::error!("[Crafting Cancel] Player {:?} not found, cannot drop refunded item {}. Item lost.", sender_id, ingredient.item_def_id);
                }
            }
        }
    }

    // 5. Delete Queue Item (this implicitly cancels the scheduled finish check)
    queue_table.queue_item_id().delete(queue_item_id);
    log::info!("[Crafting Cancel] Deleted queue item {}.", queue_item_id);

    if refund_failed {
        // Optionally return a specific error or warning if dropping occurred
        // Ok(()) // Or maybe return an error/warning string?
         Err("Crafting canceled, but some resources were dropped due to full inventory.".to_string())
    } else {
        Ok(())
    }
}

/// Helper function to clear the crafting queue for a player and refund resources.
/// Called on player death/disconnect. When called for death, resources are added to the player corpse.
pub fn clear_player_crafting_queue(ctx: &ReducerContext, player_id: Identity) {
    clear_player_crafting_queue_with_corpse_refund(ctx, player_id, false);
}

/// Helper function to clear the crafting queue for a player and refund resources to their corpse.
/// Called specifically on player death to add crafting materials to the player corpse.
pub fn clear_player_crafting_queue_on_death(ctx: &ReducerContext, player_id: Identity) {
    clear_player_crafting_queue_with_corpse_refund(ctx, player_id, true);
}

/// Internal function that handles crafting queue clearing with optional corpse refund.
fn clear_player_crafting_queue_with_corpse_refund(ctx: &ReducerContext, player_id: Identity, refund_to_corpse: bool) {
    let queue_table = ctx.db.crafting_queue_item();
    let recipe_table = ctx.db.recipe();
    let player_table = ctx.db.player();
    let inventory_table = ctx.db.inventory_item();
    let mut items_to_remove: Vec<u64> = Vec::new();
    let mut resources_to_refund: Vec<(u64, u32)> = Vec::new(); // (item_def_id, quantity)

    log::info!("[Clear Queue] Clearing crafting queue for player {:?} (refund_to_corpse: {})...", player_id, refund_to_corpse);

    // Find all queue items for the player
    for item in queue_table.iter().filter(|q| q.player_identity == player_id) {
        items_to_remove.push(item.queue_item_id);
        // Find the recipe to determine resources to refund
        if let Some(recipe) = recipe_table.recipe_id().find(&item.recipe_id) {
            for ingredient in &recipe.ingredients {
                resources_to_refund.push((ingredient.item_def_id, ingredient.quantity));
            }
        } else {
            log::error!("[Clear Queue] Recipe {} not found for queue item {}. Cannot refund resources.", item.recipe_id, item.queue_item_id);
        }
    }

    if items_to_remove.is_empty() {
        log::info!("[Clear Queue] No items found in queue for player {:?}.", player_id);
        return; // Nothing to do
    }

    let items_to_remove_count = items_to_remove.len();
    
    // Delete queue items first
    for queue_id in items_to_remove {
        queue_table.queue_item_id().delete(queue_id);
    }
    log::info!("[Clear Queue] Deleted {} items from queue for player {:?}. Refunding {} resources...", 
             items_to_remove_count, player_id, resources_to_refund.len());

    // Refund Resources
    if refund_to_corpse {
        // Player died - add materials to their corpse
        refund_crafting_materials_to_corpse(ctx, player_id, resources_to_refund);
    } else {
        // Normal queue clear (disconnect, etc.) - try inventory first, then drop
        refund_crafting_materials_to_inventory_or_drop(ctx, player_id, resources_to_refund);
    }

    // The following item deletion logic might be too aggressive as it deletes ALL items
    // in the player's inventory/hotbar upon respawn/queue clear, not just those
    // that *would have been* consumed. This was part of the original flawed logic.
    // For now, we preserve it but log a warning.
    // TODO: Revisit this logic. It should ideally only remove items that were part of recipes
    // in the cleared queue if precise refund isn't possible or if this is intended as a penalty.
    if !refund_to_corpse {
        let mut items_to_delete = Vec::new();

        for item in inventory_table.iter() {
            match &item.location {
                ItemLocation::Inventory(crate::models::InventoryLocationData { owner_id, .. }) if *owner_id == player_id => {
                    items_to_delete.push(item.instance_id);
                }
                ItemLocation::Hotbar(crate::models::HotbarLocationData { owner_id, .. }) if *owner_id == player_id => {
                    items_to_delete.push(item.instance_id);
                }
                _ => {}
            }
        }

        if !items_to_delete.is_empty() {
            for instance_id in items_to_delete {
                // Fetch the item to log its location, or remove location from log
                let item_location_str = inventory_table.instance_id().find(instance_id)
                    .map_or("Unknown (deleted)".to_string(), |item_found| format!("{:?}", item_found.location));

                log::warn!("[CraftingQueueClear] Deleting item instance {} for player {:?} from inventory due to queue clear (respawn path). Original Loc: {}",
                    instance_id, player_id, item_location_str);
                inventory_table.instance_id().delete(instance_id);
            }
        }
    }
}

/// Attempts to refund crafting materials to the player's corpse.
/// If the corpse is full, materials are dropped at the corpse location.
fn refund_crafting_materials_to_corpse(ctx: &ReducerContext, player_id: Identity, resources_to_refund: Vec<(u64, u32)>) {
    let player_corpse_table = ctx.db.player_corpse();
    let item_def_table = ctx.db.item_definition();
    
    // Find the player's corpse
    let player_corpse_opt = player_corpse_table.iter()
        .find(|corpse| corpse.player_identity == player_id);
    
    if let Some(mut player_corpse) = player_corpse_opt {
        log::info!("[Crafting Death Refund] Found player corpse for {:?}. Adding {} material types to corpse.", 
                 player_id, resources_to_refund.len());
        
        let mut items_added_to_corpse = 0;
        let mut items_dropped_near_corpse = 0;
        
        for (item_def_id, quantity) in resources_to_refund {
            if quantity == 0 { continue; }
            
            let item_name = item_def_table.id().find(item_def_id)
                .map_or_else(|| format!("ID {}", item_def_id), |def| def.name.clone());
            
            // Try to add to corpse using the container management system
            match crate::player_corpse::try_add_item_to_corpse_inventory(ctx, &mut player_corpse, item_def_id, quantity) {
                Ok(_) => {
                    items_added_to_corpse += 1;
                    log::info!("[Crafting Death Refund] Added {} {} to player corpse for {:?}", 
                             quantity, item_name, player_id);
                }
                Err(_) => {
                    // Corpse is full, drop the materials at the corpse location
                    items_dropped_near_corpse += 1;
                    if let Err(drop_err) = crate::dropped_item::create_dropped_item_entity_with_data(ctx, item_def_id, quantity, player_corpse.pos_x, player_corpse.pos_y, None) {
                        log::error!("[Crafting Death Refund] Failed to drop crafting material {} {} at corpse location for {:?}: {}", 
                                  quantity, item_name, player_id, drop_err);
                    } else {
                        log::info!("[Crafting Death Refund] Corpse full, dropped {} {} at corpse location for {:?}", 
                                 quantity, item_name, player_id);
                    }
                }
            }
        }
        
        // Update the corpse in the database if items were added
        if items_added_to_corpse > 0 {
            player_corpse_table.id().update(player_corpse);
        }
        
        log::info!("[Crafting Death Refund] Completed for player {:?}: {} items added to corpse, {} items dropped near corpse", 
                 player_id, items_added_to_corpse, items_dropped_near_corpse);
    } else {
        log::error!("[Crafting Death Refund] No player corpse found for {:?}. This should not happen during death! Materials will be lost.", player_id);
        // If no corpse is found during death, this is an error condition - materials are lost
        // This should never happen since create_player_corpse is called before this function
    }
}

/// Attempts to refund crafting materials to the player's inventory, dropping if full.
fn refund_crafting_materials_to_inventory_or_drop(ctx: &ReducerContext, player_id: Identity, resources_to_refund: Vec<(u64, u32)>) {
    let player_table = ctx.db.player();
    let item_def_table = ctx.db.item_definition();
    let player_opt = player_table.identity().find(&player_id);
    let mut refund_failed_and_dropped = false;

    for (def_id, quantity) in resources_to_refund {
        if quantity == 0 { continue; }
        
        match crate::items::add_item_to_player_inventory(ctx, player_id, def_id, quantity) {
            Ok(_) => { /* Successfully refunded */ }
            Err(_) => {
                // Inventory full or other error, try to drop
                if let Some(ref player) = player_opt { // Use ref player to borrow instead of move
                    let (drop_x, drop_y) = crate::dropped_item::calculate_drop_position(&player);
                    if let Err(drop_err) = crate::dropped_item::create_dropped_item_entity(ctx, def_id, quantity, drop_x, drop_y) {
                        log::error!("[Clear Queue] Failed to add AND drop refunded item {} (qty {}) for player {:?}: {}", def_id, quantity, player_id, drop_err);
                    } else {
                        refund_failed_and_dropped = true;
                    }
                } else {
                     log::error!("[Clear Queue] Player {:?} not found, cannot drop refunded item {}. Item lost.", player_id, def_id);
                }
            }
        }
    }

    if refund_failed_and_dropped {
         log::warn!("[Clear Queue] Refund complete for player {:?}, but some resources were dropped.", player_id);
    } else {
         log::info!("[Clear Queue] Refund complete for player {:?}.", player_id);
    }
}

/// Cancels all items in the player's crafting queue and refunds all resources.
#[spacetimedb::reducer]
pub fn cancel_all_crafting(ctx: &ReducerContext) -> Result<(), String> {
    let sender_id = ctx.sender;
    let queue_table = ctx.db.crafting_queue_item();
    let recipe_table = ctx.db.recipe();
    let player_table = ctx.db.player();
    let item_def_table = ctx.db.item_definition(); // For logging item names

    let mut items_to_remove_from_queue: Vec<u64> = Vec::new();
    let mut total_resources_to_refund: HashMap<u64, u32> = HashMap::new(); // <item_def_id, total_quantity>

    log::info!("[Cancel All Crafting] Player {:?} initiated cancel all.", sender_id);

    // 1. Collect all queued items and their ingredients for the player
    for item in queue_table.iter().filter(|q| q.player_identity == sender_id) {
        items_to_remove_from_queue.push(item.queue_item_id);
        if let Some(recipe) = recipe_table.recipe_id().find(&item.recipe_id) {
            for ingredient in &recipe.ingredients {
                *total_resources_to_refund.entry(ingredient.item_def_id).or_insert(0) += ingredient.quantity;
            }
        } else {
            log::warn!("[Cancel All Crafting] Recipe {} not found for queue item {}. Resources for this item might not be refunded.", item.recipe_id, item.queue_item_id);
        }
    }

    if items_to_remove_from_queue.is_empty() {
        log::info!("[Cancel All Crafting] No items in queue for player {:?}. Nothing to cancel.", sender_id);
        return Ok(()); // Nothing to do
    }

    // 2. Delete all items from the queue for this player
    for queue_id in &items_to_remove_from_queue {
        queue_table.queue_item_id().delete(*queue_id);
    }
    log::info!("[Cancel All Crafting] Deleted {} items from queue for player {:?}. Now refunding resources.", items_to_remove_from_queue.len(), sender_id);

    // 3. Refund all collected resources
    let mut refund_partially_failed_and_dropped = false;
    if let Some(player) = player_table.identity().find(&sender_id) { // Need player for drop position
        for (item_def_id, quantity_to_refund) in total_resources_to_refund {
            if quantity_to_refund == 0 { continue; }

            match crate::items::add_item_to_player_inventory(ctx, sender_id, item_def_id, quantity_to_refund) {
                Ok(_) => {
                    let item_name = item_def_table.id().find(item_def_id).map_or_else(|| format!("ID {}", item_def_id), |def| def.name.clone());
                    log::debug!("[Cancel All Crafting] Successfully refunded {} {} to player {:?}.", quantity_to_refund, item_name, sender_id);
                }
                Err(e) => {
                    let item_name = item_def_table.id().find(item_def_id).map_or_else(|| format!("ID {}", item_def_id), |def| def.name.clone());
                    log::warn!("[Cancel All Crafting] Inventory full for player {:?} while refunding {} {}. Attempting to drop. Error: {}", sender_id, quantity_to_refund, item_name, e);
                    refund_partially_failed_and_dropped = true;
                    let (drop_x, drop_y) = dropped_item::calculate_drop_position(&player);
                    if let Err(drop_err) = dropped_item::create_dropped_item_entity(ctx, item_def_id, quantity_to_refund, drop_x, drop_y) {
                        log::error!("[Cancel All Crafting] Failed to drop refunded item {} (DefID: {}) for player {:?}: {}", item_name, item_def_id, sender_id, drop_err);
                        // Resource is lost if dropping also fails
                    } else {
                        log::info!("[Cancel All Crafting] Successfully dropped {} {} for player {:?} near ({}, {}).", quantity_to_refund, item_name, sender_id, drop_x, drop_y);
                    }
                }
            }
        }
    } else {
        log::error!("[Cancel All Crafting] Player {:?} not found. Cannot determine drop position for refunded items. Resources may be lost if inventory is full.", sender_id);
        // Attempt to refund anyway, but dropping won't be possible if player is gone.
        // This case should be rare if the player is initiating the cancel all.
        for (item_def_id, quantity_to_refund) in total_resources_to_refund {
             if quantity_to_refund == 0 { continue; }
             if crate::items::add_item_to_player_inventory(ctx, sender_id, item_def_id, quantity_to_refund).is_err() {
                let item_name = item_def_table.id().find(item_def_id).map_or_else(|| format!("ID {}", item_def_id), |def| def.name.clone());
                log::error!("[Cancel All Crafting] Failed to refund {} {} to non-existent player {:?} and cannot drop. Item lost.", quantity_to_refund, item_name, sender_id);
             }
        }
        return Err("Player not found during refund process, some items may have been lost if inventory was full.".to_string());
    }

    if refund_partially_failed_and_dropped {
        Err("Crafting queue canceled. Some resources were dropped due to full inventory.".to_string())
    } else {
        Ok(())
    }
}

// --- Init Helper (Called from lib.rs) ---
pub fn init_crafting_schedule(ctx: &ReducerContext) -> Result<(), String> {
    let schedule_table = ctx.db.crafting_finish_schedule();
    if schedule_table.iter().count() == 0 {
        log::info!("Starting crafting finish check schedule (every {}s).", CRAFTING_CHECK_INTERVAL_SECS);
        let interval = Duration::from_secs(CRAFTING_CHECK_INTERVAL_SECS);
        schedule_table.insert(CraftingFinishSchedule {
            id: 0, // Auto-incremented
            scheduled_at: spacetimedb::spacetimedb_lib::ScheduleAt::Interval(interval.into()),
        });
    } else {
        log::debug!("Crafting finish check schedule already exists.");
    }
    Ok(())
} 