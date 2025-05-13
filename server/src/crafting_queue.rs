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
/// Called on player death/disconnect.
pub fn clear_player_crafting_queue(ctx: &ReducerContext, player_id: Identity) {
    let queue_table = ctx.db.crafting_queue_item();
    let recipe_table = ctx.db.recipe();
    let player_table = ctx.db.player();
    let inventory_table = ctx.db.inventory_item();
    let mut items_to_remove: Vec<u64> = Vec::new();
    let mut resources_to_refund: Vec<(u64, u32)> = Vec::new(); // (item_def_id, quantity)

    log::info!("[Clear Queue] Clearing crafting queue for player {:?}...", player_id);

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

    // Delete queue items first
    for queue_id in items_to_remove {
        queue_table.queue_item_id().delete(queue_id);
    }
    log::info!("[Clear Queue] Deleted {} items from queue for player {:?}. Refunding resources...", resources_to_refund.len(), player_id);

    // Refund Resources (attempt to add to inventory, drop if full)
    let player_opt = player_table.identity().find(&player_id);
    let mut refund_failed_and_dropped = false;

    for (def_id, quantity) in resources_to_refund {
        match crate::items::add_item_to_player_inventory(ctx, player_id, def_id, quantity) {
            Ok(_) => { /* Successfully refunded */ }
            Err(_) => {
                // Inventory full or other error, try to drop
                if let Some(ref player) = player_opt {
                    let (drop_x, drop_y) = dropped_item::calculate_drop_position(&player);
                    if let Err(drop_err) = dropped_item::create_dropped_item_entity(ctx, def_id, quantity, drop_x, drop_y) {
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

    // The following item deletion logic might be too aggressive as it deletes ALL items
    // in the player's inventory/hotbar upon respawn/queue clear, not just those
    // that *would have been* consumed. This was part of the original flawed logic.
    // For now, we preserve it but log a warning.
    // TODO: Revisit this logic. It should ideally only remove items that were part of recipes
    // in the cleared queue if precise refund isn't possible or if this is intended as a penalty.
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