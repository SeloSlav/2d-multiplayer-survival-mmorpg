// server/src/consumables.rs
use spacetimedb::{ReducerContext, Identity, Table};
use log;

// Import table traits needed for ctx.db access
use crate::player as PlayerTableTrait;
use crate::items::{InventoryItem, inventory_item as InventoryItemTableTrait};
use crate::items::{ItemDefinition, item_definition as ItemDefinitionTableTrait};
use crate::items::ItemCategory; // Import the enum itself
use crate::models::ItemLocation; // Added import

// --- REMOVE Consumable Effect Constants ---
// const MUSHROOM_HEALTH_GAIN: f32 = 5.0;
// const MUSHROOM_HUNGER_GAIN: f32 = 10.0;
// const MUSHROOM_THIRST_GAIN: f32 = 5.0;
// const CORN_HEALTH_GAIN: f32 = 15.0;
// const CORN_HUNGER_GAIN: f32 = 25.0;
// const CORN_THIRST_GAIN: f32 = 10.0;

// --- Max Stat Value ---
const MAX_STAT_VALUE: f32 = 100.0; // Max value for health, hunger, thirst
const MIN_STAT_VALUE: f32 = 0.0;   // Min value for stats like health

#[spacetimedb::reducer]
pub fn consume_item(ctx: &ReducerContext, item_instance_id: u64) -> Result<(), String> {
    let sender_id = ctx.sender;
    let inventory = ctx.db.inventory_item();
    let item_defs = ctx.db.item_definition();
    let players = ctx.db.player();

    log::info!("[ConsumeItem] Player {:?} attempting to consume item instance {}", sender_id, item_instance_id);

    // 1. Get the InventoryItem being consumed
    let mut item_to_consume = inventory.instance_id().find(item_instance_id)
        .ok_or_else(|| format!("Item instance {} not found.", item_instance_id))?;

    // 2. Verify ownership and location
    let is_in_possession = match &item_to_consume.location {
        ItemLocation::Inventory(crate::models::InventoryLocationData { owner_id, .. }) => *owner_id == sender_id,
        ItemLocation::Hotbar(crate::models::HotbarLocationData { owner_id, .. }) => *owner_id == sender_id,
        _ => false,
    };

    if !is_in_possession {
        log::warn!(
            "[ConsumeItem] Player {:?} failed to consume item {} due to invalid location or ownership: {:?}.",
            sender_id, item_instance_id, item_to_consume.location
        );
        return Err("Cannot consume an item that is not in your inventory or hotbar.".to_string());
    }

    // 3. Get its ItemDefinition
    let item_def = item_defs.id().find(item_to_consume.item_def_id)
        .ok_or_else(|| format!("Definition not found for item ID {}", item_to_consume.item_def_id))?;

    // 4. Validate: Must be Consumable category
    if item_def.category != ItemCategory::Consumable {
        return Err(format!("Item '{}' is not consumable.", item_def.name));
    }

    // 5. Find the player to apply effects to
    let mut player = players.identity().find(sender_id)
        .ok_or_else(|| "Player not found to apply consumable effects.".to_string())?;

    // 6. Apply Effects (Based on ItemDefinition fields)
    let mut stat_changed = false;
    
    // Get initial stats for logging
    let old_health = player.health;
    let old_hunger = player.hunger;
    let old_thirst = player.thirst;
    // let old_stamina = player.stamina; // Assuming player has a stamina field

    if let Some(health_gain) = item_def.consumable_health_gain {
        player.health = (player.health + health_gain).clamp(MIN_STAT_VALUE, MAX_STAT_VALUE);
        stat_changed = true;
    }
    if let Some(hunger_satiated) = item_def.consumable_hunger_satiated {
        player.hunger = (player.hunger + hunger_satiated).clamp(MIN_STAT_VALUE, MAX_STAT_VALUE);
        stat_changed = true;
    }
    if let Some(thirst_quenched) = item_def.consumable_thirst_quenched {
        player.thirst = (player.thirst + thirst_quenched).clamp(MIN_STAT_VALUE, MAX_STAT_VALUE);
        stat_changed = true;
    }
    // Example for stamina, uncomment and adjust if player has stamina
    // if let Some(stamina_gain) = item_def.consumable_stamina_gain {
    //     player.stamina = (player.stamina + stamina_gain).clamp(MIN_STAT_VALUE, MAX_STAT_VALUE);
    //     stat_changed = true;
    // }

    // TODO: Handle item_def.consumable_duration_secs if effects over time are implemented

    // Log stat changes if any occurred
    if stat_changed {
        log::info!(
            "[ConsumeItem] Player {:?} consumed {}. Stats: H {:.1}->{:.1}, Hu {:.1}->{:.1}, T {:.1}->{:.1}",
            sender_id, item_def.name, 
            old_health, player.health, 
            old_hunger, player.hunger, 
            old_thirst, player.thirst
            // old_stamina, player.stamina // if stamina is added
        );
    } else {
        log::info!("[ConsumeItem] Player {:?} consumed {} but it had no direct stat effects defined.", sender_id, item_def.name);
    }

    // 7. Decrease quantity or delete item stack
    item_to_consume.quantity -= 1;
    if item_to_consume.quantity == 0 {
        log::debug!("[ConsumeItem] Item instance {} stack depleted, deleting.", item_instance_id);
        inventory.instance_id().delete(item_instance_id);
    } else {
        log::debug!("[ConsumeItem] Item instance {} quantity reduced to {}.", item_instance_id, item_to_consume.quantity);
        inventory.instance_id().update(item_to_consume);
    }

    // 8. Update Player state only if stats changed
    if stat_changed {
         players.identity().update(player);
    }

    Ok(())
} 