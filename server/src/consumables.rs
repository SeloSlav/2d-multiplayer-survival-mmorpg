// server/src/consumables.rs
use spacetimedb::{ReducerContext, Identity, Table, Timestamp, TimeDuration};
use log;

// Import table traits needed for ctx.db access
// use crate::player::{player as PlayerTableTrait, Player}; // Old import
use crate::Player; // For the struct
use crate::player; // For the table trait
use crate::items::{InventoryItem, inventory_item as InventoryItemTableTrait};
use crate::items::{ItemDefinition, item_definition as ItemDefinitionTableTrait};
use crate::items::ItemCategory; // Import the enum itself
use crate::models::ItemLocation; // Added import

// Import active effects related items
use crate::active_effects::{ActiveConsumableEffect, EffectType, active_consumable_effect as ActiveConsumableEffectTableTrait};

// --- Max Stat Value ---
const MAX_STAT_VALUE: f32 = 100.0; // Max value for health, hunger, thirst
const MIN_STAT_VALUE: f32 = 0.0;   // Min value for stats like health
const CONSUMPTION_COOLDOWN_MICROS: u64 = 1_000_000; // 1 second cooldown

#[spacetimedb::reducer]
pub fn consume_item(ctx: &ReducerContext, item_instance_id: u64) -> Result<(), String> {
    let sender_id = ctx.sender;
    let inventory = ctx.db.inventory_item();
    let item_defs = ctx.db.item_definition();
    let players_table = ctx.db.player();
    let active_effects_table = ctx.db.active_consumable_effect();

    log::info!("[ConsumeItem] Player {:?} attempting to consume item instance {}", sender_id, item_instance_id);

    // 0. Get the player and check cooldown
    let mut player_to_update = players_table.identity().find(&sender_id)
        .ok_or_else(|| "Player not found to apply consumable effects.".to_string())?;

    if let Some(last_consumed_ts) = player_to_update.last_consumed_at {
        let cooldown_duration = TimeDuration::from_micros(CONSUMPTION_COOLDOWN_MICROS as i64);
        if ctx.timestamp < last_consumed_ts + cooldown_duration {
            log::warn!(
                "[ConsumeItem] Player {:?} attempted to consume too quickly. Last consumed: {:?}, current: {:?}", 
                sender_id, last_consumed_ts, ctx.timestamp
            );
            return Err("You are consuming items too quickly.".to_string());
        }
    }

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
    // let mut player_to_update = players_table.identity().find(&sender_id)
    //     .ok_or_else(|| "Player not found to apply consumable effects.".to_string())?;

    // 6. Apply Effects (Based on ItemDefinition fields)
    let mut stat_changed_instantly = false;
    
    // Get initial stats for logging
    let old_health = player_to_update.health;
    let old_hunger = player_to_update.hunger;
    let old_thirst = player_to_update.thirst;
    let old_stamina = player_to_update.stamina; // Assuming player has a stamina field

    if let Some(duration_secs) = item_def.consumable_duration_secs {
        if duration_secs > 0.0 {
            let mut timed_effect_created = false;
            // Handle timed health regeneration
            if let Some(total_health_regen) = item_def.consumable_health_gain {
                if total_health_regen != 0.0 { // Allow negative for poison, positive for regen
                    let current_time = ctx.timestamp;
                    let duration_micros = (duration_secs.abs() * 1_000_000.0) as u64;
                    let tick_interval = TimeDuration::from_micros(1_000_000);

                    active_effects_table.insert(ActiveConsumableEffect {
                        effect_id: 0, 
                        player_id: sender_id,
                        item_def_id: item_def.id,
                        started_at: current_time,
                        ends_at: current_time + TimeDuration::from_micros(duration_micros as i64),
                        total_amount: Some(total_health_regen),
                        amount_applied_so_far: Some(0.0),
                        effect_type: EffectType::HealthRegen,
                        tick_interval_micros: tick_interval.to_micros() as u64,
                        next_tick_at: current_time + tick_interval, 
                    });
                    timed_effect_created = true;
                    log::info!(
                        "[ConsumeItem] Player {:?} initiated timed HealthRegen effect from {} ({} over {}s).",
                        sender_id, item_def.name, total_health_regen, duration_secs
                    );
                }
            }
            // Note: consumable_health_gain is now exclusively for timed effects if duration_secs > 0.
            // Instant health changes for items with duration should be handled by a different field if necessary.

            // Apply other non-health effects (hunger, thirst) instantly even if a timed health effect was created
            if let Some(hunger_satiated) = item_def.consumable_hunger_satiated {
                let old_val = player_to_update.hunger;
                player_to_update.hunger = (player_to_update.hunger + hunger_satiated).clamp(MIN_STAT_VALUE, MAX_STAT_VALUE);
                if player_to_update.hunger != old_val { stat_changed_instantly = true; }
            }
            if let Some(thirst_quenched) = item_def.consumable_thirst_quenched {
                let old_val = player_to_update.thirst;
                player_to_update.thirst = (player_to_update.thirst + thirst_quenched).clamp(MIN_STAT_VALUE, MAX_STAT_VALUE);
                if player_to_update.thirst != old_val { stat_changed_instantly = true; }
            }
            // Example for stamina, uncomment and adjust if player has stamina
            if let Some(stamina_gain) = item_def.consumable_stamina_gain {
                player_to_update.stamina = (player_to_update.stamina + stamina_gain).clamp(MIN_STAT_VALUE, MAX_STAT_VALUE);
                stat_changed_instantly = true;
            }

        } else {
            // Duration is 0.0 or negative (treat as instant for now, though negative duration is odd)
            apply_instant_effects(&item_def, &mut player_to_update, &mut stat_changed_instantly);
        }
    } else {
        // No duration specified, apply all effects instantly
        apply_instant_effects(&item_def, &mut player_to_update, &mut stat_changed_instantly);
    }

    // Log stat changes if any occurred
    if stat_changed_instantly {
        log::info!(
            "[ConsumeItem] Player {:?} instantly changed stats with {}. Stats: H {:.1}->{:.1} (instant part), Hu {:.1}->{:.1}, T {:.1}->{:.1}",
            sender_id, item_def.name, 
            old_health, player_to_update.health, 
            old_hunger, player_to_update.hunger, 
            old_thirst, player_to_update.thirst
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

    // 8. Update Player state
    player_to_update.last_consumed_at = Some(ctx.timestamp); // Update last consumed time
    // Update Player state only if stats changed or cooldown was updated (always update now)
    // if stat_changed_instantly { // Old condition
    players_table.identity().update(player_to_update);
    // }

    Ok(())
}

fn apply_instant_effects(item_def: &ItemDefinition, player: &mut Player, stat_changed: &mut bool) {
    if let Some(health_gain) = item_def.consumable_health_gain {
        // Only apply health_gain instantly if there's no positive duration specified.
        // If duration_secs is Some(d) where d > 0, health_gain is handled by timed effects.
        if item_def.consumable_duration_secs.map_or(true, |d| d <= 0.0) {
            let old_val = player.health;
            player.health = (player.health + health_gain).clamp(MIN_STAT_VALUE, MAX_STAT_VALUE);
            if player.health != old_val { *stat_changed = true; }
        }
    }
    if let Some(hunger_satiated) = item_def.consumable_hunger_satiated {
        let old_val = player.hunger;
        player.hunger = (player.hunger + hunger_satiated).clamp(MIN_STAT_VALUE, MAX_STAT_VALUE);
        if player.hunger != old_val { *stat_changed = true; }
    }
    if let Some(thirst_quenched) = item_def.consumable_thirst_quenched {
        let old_val = player.thirst;
        player.thirst = (player.thirst + thirst_quenched).clamp(MIN_STAT_VALUE, MAX_STAT_VALUE);
        if player.thirst != old_val { *stat_changed = true; }
    }
    if let Some(stamina_gain) = item_def.consumable_stamina_gain {
        player.stamina = (player.stamina + stamina_gain).clamp(MIN_STAT_VALUE, MAX_STAT_VALUE);
        *stat_changed = true;
    }
} 