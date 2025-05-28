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
use crate::active_effects::{ActiveConsumableEffect, EffectType, active_consumable_effect as ActiveConsumableEffectTableTrait, cancel_bleed_effects, cancel_health_regen_effects};

// --- Max Stat Value ---
pub const MAX_HEALTH_VALUE: f32 = 100.0; // Max value for health
pub const MAX_HUNGER_VALUE: f32 = 250.0; // Max value for hunger
pub const MAX_THIRST_VALUE: f32 = 250.0; // Max value for thirst
pub const MAX_STAMINA_VALUE: f32 = 100.0; // Max value for stamina
pub const MAX_WARMTH_VALUE: f32 = 100.0; // Max value for warmth
pub const MIN_STAT_VALUE: f32 = 0.0;   // Min value for stats like health
const CONSUMPTION_COOLDOWN_MICROS: u64 = 1_000_000; // 1 second cooldown

#[spacetimedb::reducer]
pub fn consume_item(ctx: &ReducerContext, item_instance_id: u64) -> Result<(), String> {
    let sender_id = ctx.sender;
    let players_table = ctx.db.player();
    let item_defs = ctx.db.item_definition();

    log::info!("[ConsumeItem] Player {:?} attempting to consume item instance {}", sender_id, item_instance_id);

    let mut player_to_update = players_table.identity().find(&sender_id)
        .ok_or_else(|| "Player not found.".to_string())?;

    // --- Check player state first ---
    if player_to_update.is_dead {
        return Err("Cannot consume items while dead.".to_string());
    }
    if player_to_update.is_knocked_out {
        return Err("Cannot consume items while knocked out.".to_string());
    }

    if let Some(last_consumed_ts) = player_to_update.last_consumed_at {
        let cooldown_duration = TimeDuration::from_micros(CONSUMPTION_COOLDOWN_MICROS as i64);
        if ctx.timestamp < last_consumed_ts + cooldown_duration {
            return Err("You are consuming items too quickly.".to_string());
        }
    }

    let item_to_consume = ctx.db.inventory_item().instance_id().find(item_instance_id)
        .ok_or_else(|| format!("Item instance {} not found.", item_instance_id))?;

    let is_in_possession = match &item_to_consume.location {
        ItemLocation::Inventory(data) => data.owner_id == sender_id,
        ItemLocation::Hotbar(data) => data.owner_id == sender_id,
        _ => false,
    };

    if !is_in_possession {
        return Err("Cannot consume an item not in your inventory or hotbar.".to_string());
    }

    let item_def = item_defs.id().find(item_to_consume.item_def_id)
        .ok_or_else(|| format!("Definition for item ID {} not found.", item_to_consume.item_def_id))?;

    // For direct consumption, we still only allow items marked as Consumable category.
    // Bandages, now being Tools, won't pass this check if we strictly enforce it.
    // If you want bandages to be consumable this way, their category would need to remain Consumable,
    // or this check needs to be adjusted for them (e.g. allow Tool if name is Bandage).
    // For now, let's keep it strict: direct consumption is for Category::Consumable.
    if item_def.category != ItemCategory::Consumable {
        return Err(format!("Item '{}' is not a consumable category item and cannot be used this way.", item_def.name));
    }

    // Call the centralized helper function
    apply_item_effects_and_consume(ctx, sender_id, &item_def, item_instance_id, &mut player_to_update)?;

    // Update player table after effects are applied and item consumed
    players_table.identity().update(player_to_update);
    
    // For instant-effect items (no duration), handle consumption immediately.
    // Check if this item has no duration or a duration <= 0
    let has_instant_effect = item_def.consumable_duration_secs.map_or(true, |d| d <= 0.0);
    
    if has_instant_effect {
        // Consume the item directly here since no timed effect will handle it
        let mut item_to_consume = ctx.db.inventory_item().instance_id().find(item_instance_id)
            .ok_or_else(|| format!("Item instance {} suddenly disappeared.", item_instance_id))?;
            
        // Decrease quantity
        if item_to_consume.quantity > 0 {
            item_to_consume.quantity -= 1;
        }
        
        // Remove item if quantity is 0
        if item_to_consume.quantity == 0 {
            ctx.db.inventory_item().instance_id().delete(&item_instance_id);
            log::info!("[ConsumeItem] Instantly consumed and deleted item_instance_id: {} for player {:?}.", 
                item_instance_id, sender_id);
        } else {
            // Update with decreased quantity
            ctx.db.inventory_item().instance_id().update(item_to_consume.clone());
            log::info!("[ConsumeItem] Instantly consumed item_instance_id: {}, new quantity: {} for player {:?}.", 
                item_instance_id, item_to_consume.quantity, sender_id);
        }
    }

    Ok(())
}

// NEW PUBLIC HELPER FUNCTION
pub fn apply_item_effects_and_consume(
    ctx: &ReducerContext,
    player_id: Identity,
    item_def: &ItemDefinition,
    item_instance_id: u64,
    player_to_update: &mut Player, // Pass mutable player to update directly
) -> Result<(), String> {
    let mut stat_changed_instantly = false;
    let old_health = player_to_update.health;
    let old_hunger = player_to_update.hunger;
    let old_thirst = player_to_update.thirst;
    let old_warmth = player_to_update.warmth;

    if let Some(duration_secs) = item_def.consumable_duration_secs {
        if duration_secs > 0.0 { // This branch handles timed effects
            if item_def.name == "Bandage" {
                if let Some(total_bandage_heal) = item_def.consumable_health_gain {
                    if total_bandage_heal != 0.0 {
                        // Cancel any existing HealthRegen OR BandageBurst effects for this player to prevent stacking similar effects.
                        // We might need a more nuanced approach if different types of healing shouldn't cancel each other.
                        cancel_health_regen_effects(ctx, player_id); 
                        // It might be wise to also explicitly cancel any existing BandageBurst here if a player tries to use another bandage while one is active.
                        // For now, let's assume one bandage at a time. A dedicated cancel_bandage_burst_effects could be called too.
                        // crate::active_effects::cancel_bleed_effects(ctx, player_id); // Bandages still cancel bleed - REMOVED, handled by BandageBurst effect completion
                        
                        log::info!("[EffectsHelper] Player {:?} using Bandage. Creating BandageBurst effect.", player_id);
                        apply_timed_effect_for_helper(ctx, player_id, item_def, item_instance_id, EffectType::BandageBurst, total_bandage_heal, duration_secs, 1.0)?;
                    }
                }
            } else if item_def.name == "Selo Olive Oil" {
                // SECURITY CHECK: Selo Olive Oil can only heal the consuming player (yourself)
                if player_id != ctx.sender {
                    return Err("Selo Olive Oil can only be used on yourself.".to_string());
                }
                
                // Handle Selo Olive Oil with instant effects for all stats
                if let Some(health_gain) = item_def.consumable_health_gain {
                    if health_gain != 0.0 {
                        cancel_health_regen_effects(ctx, player_id);
                        log::info!("[EffectsHelper] Player {:?} using Selo Olive Oil. Creating HealthRegen effect.", player_id);
                        apply_timed_effect_for_helper(ctx, player_id, item_def, item_instance_id, EffectType::HealthRegen, health_gain, duration_secs, 1.0)?;
                    }
                }
                
                // Apply instant effects for other stats during timed effect
                if let Some(hunger_satiated) = item_def.consumable_hunger_satiated {
                    let old_val = player_to_update.hunger;
                    player_to_update.hunger = (player_to_update.hunger + hunger_satiated).clamp(MIN_STAT_VALUE, MAX_HUNGER_VALUE);
                    if player_to_update.hunger != old_val { stat_changed_instantly = true; }
                }
                if let Some(thirst_quenched) = item_def.consumable_thirst_quenched {
                    let old_val = player_to_update.thirst;
                    player_to_update.thirst = (player_to_update.thirst + thirst_quenched).clamp(MIN_STAT_VALUE, MAX_THIRST_VALUE);
                    if player_to_update.thirst != old_val { stat_changed_instantly = true; }
                }
                if let Some(stamina_gain) = item_def.consumable_stamina_gain {
                    player_to_update.stamina = (player_to_update.stamina + stamina_gain).clamp(MIN_STAT_VALUE, MAX_STAMINA_VALUE);
                    stat_changed_instantly = true;
                }
                if let Some(warmth_gain) = item_def.warmth_bonus {
                    let old_val = player_to_update.warmth;
                    player_to_update.warmth = (player_to_update.warmth + warmth_gain).clamp(MIN_STAT_VALUE, MAX_WARMTH_VALUE);
                    if player_to_update.warmth != old_val { stat_changed_instantly = true; }
                }
            } else {
                // Logic for other timed consumable effects (non-bandage)
                if let Some(total_health_regen) = item_def.consumable_health_gain {
                    if total_health_regen != 0.0 {
                        cancel_health_regen_effects(ctx, player_id); // Cancel existing HoTs
                        apply_timed_effect_for_helper(ctx, player_id, item_def, item_instance_id, EffectType::HealthRegen, total_health_regen, duration_secs, 1.0)?;
                    }
                }
            }

            // Instant effects that can accompany timed effects (e.g., food gives instant hunger + HoT)
            if let Some(hunger_satiated) = item_def.consumable_hunger_satiated {
                let old_val = player_to_update.hunger;
                player_to_update.hunger = (player_to_update.hunger + hunger_satiated).clamp(MIN_STAT_VALUE, MAX_HUNGER_VALUE);
                if player_to_update.hunger != old_val { stat_changed_instantly = true; }
            }
            if let Some(thirst_quenched) = item_def.consumable_thirst_quenched {
                let old_val = player_to_update.thirst;
                player_to_update.thirst = (player_to_update.thirst + thirst_quenched).clamp(MIN_STAT_VALUE, MAX_THIRST_VALUE);
                if player_to_update.thirst != old_val { stat_changed_instantly = true; }
            }
            if let Some(stamina_gain) = item_def.consumable_stamina_gain {
                player_to_update.stamina = (player_to_update.stamina + stamina_gain).clamp(MIN_STAT_VALUE, MAX_STAMINA_VALUE);
                stat_changed_instantly = true;
            }
        } else {
            apply_instant_effects_for_helper(item_def, player_to_update, &mut stat_changed_instantly);
        }
    } else {
        apply_instant_effects_for_helper(item_def, player_to_update, &mut stat_changed_instantly);
    }

    if stat_changed_instantly {
        log::info!(
            "[EffectsHelper] Player {:?} instantly changed stats with {}. Stats: H {:.1}->{:.1}, Hu {:.1}->{:.1}, T {:.1}->{:.1}, W {:.1}->{:.1}",
            player_id, item_def.name,
            old_health, player_to_update.health,
            old_hunger, player_to_update.hunger,
            old_thirst, player_to_update.thirst,
            old_warmth, player_to_update.warmth
        );
    }

    player_to_update.last_consumed_at = Some(ctx.timestamp);
    // The caller of this helper will be responsible for updating the player table.

    Ok(())
}

// Renamed and adapted apply_instant_effects to be used by the helper
fn apply_instant_effects_for_helper(item_def: &ItemDefinition, player: &mut Player, stat_changed: &mut bool) {
    if let Some(health_gain) = item_def.consumable_health_gain {
        if item_def.consumable_duration_secs.map_or(true, |d| d <= 0.0) {
            let old_val = player.health;
            player.health = (player.health + health_gain).clamp(MIN_STAT_VALUE, MAX_HEALTH_VALUE);
            if player.health != old_val { *stat_changed = true; }
        }
    }
    if let Some(hunger_satiated) = item_def.consumable_hunger_satiated {
        let old_val = player.hunger;
        player.hunger = (player.hunger + hunger_satiated).clamp(MIN_STAT_VALUE, MAX_HUNGER_VALUE);
        if player.hunger != old_val { *stat_changed = true; }
    }
    if let Some(thirst_quenched) = item_def.consumable_thirst_quenched {
        let old_val = player.thirst;
        player.thirst = (player.thirst + thirst_quenched).clamp(MIN_STAT_VALUE, MAX_THIRST_VALUE);
        if player.thirst != old_val { *stat_changed = true; }
    }
    if let Some(stamina_gain) = item_def.consumable_stamina_gain {
        player.stamina = (player.stamina + stamina_gain).clamp(MIN_STAT_VALUE, MAX_STAMINA_VALUE);
        *stat_changed = true;
    }
    if let Some(warmth_gain) = item_def.warmth_bonus {
        let old_val = player.warmth;
        player.warmth = (player.warmth + warmth_gain).clamp(MIN_STAT_VALUE, MAX_WARMTH_VALUE);
        if player.warmth != old_val { *stat_changed = true; }
    }
}

fn apply_timed_effect_for_helper(
    ctx: &ReducerContext,
    player_id: Identity,
    item_def: &ItemDefinition,
    item_instance_id: u64,
    effect_type: EffectType,
    total_amount: f32,
    duration_secs: f32,
    tick_interval_secs: f32,
) -> Result<(), String> {
    if duration_secs <= 0.0 {
        return Err("Timed effect duration must be positive.".to_string());
    }
    if tick_interval_secs <= 0.0 {
        return Err("Timed effect tick interval must be positive.".to_string());
    }
    if total_amount == 0.0 { // No point in a zero-amount timed effect
        log::info!("[TimedEffectHelper] Total amount for {:?} on player {:?} with item '{}' is 0. Skipping effect creation.", 
            effect_type, player_id, item_def.name);
        return Ok(());
    }

    let now = ctx.timestamp;
    let duration_micros = (duration_secs * 1_000_000.0) as u64;
    let tick_interval_micros = (tick_interval_secs * 1_000_000.0) as u64;

    if tick_interval_micros == 0 {
        return Err("Tick interval micros calculated to zero, too small.".to_string());
    }

    let effect_to_insert = ActiveConsumableEffect {
        effect_id: 0,
        player_id: player_id,
        target_player_id: None,
        item_def_id: item_def.id,
        consuming_item_instance_id: Some(item_instance_id),
        started_at: now,
        ends_at: now + TimeDuration::from_micros(duration_micros as i64),
        total_amount: Some(total_amount),
        amount_applied_so_far: Some(0.0),
        effect_type: effect_type.clone(),
        tick_interval_micros,
        next_tick_at: now + TimeDuration::from_micros(tick_interval_micros as i64),
    };

    match ctx.db.active_consumable_effect().try_insert(effect_to_insert) {
        Ok(_) => {
            log::info!(
                "[TimedEffectHelper] Applied timed effect {:?} to player {:?} from item '{}' (instance {}). Duration: {}s, Total: {}, Tick: {}s.",
                effect_type, player_id, item_def.name, item_instance_id, duration_secs, total_amount, tick_interval_secs
            );
            Ok(())
        }
        Err(e) => {
            log::error!(
                "[TimedEffectHelper] Failed to insert timed effect {:?} for player {:?} from item '{}': {:?}",
                effect_type, player_id, item_def.name, e
            );
            Err(format!("Failed to apply timed effect: {:?}", e))
        }
    }
} 