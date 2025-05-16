use spacetimedb::{table, Identity, Timestamp, ReducerContext, Table, ScheduleAt, TimeDuration, SpacetimeType};
// use crate::player::{Player, player as PlayerTableTrait}; // Old import
use crate::Player; // For the struct
use crate::player; // For the table trait
use crate::items::{ItemDefinition, item_definition as ItemDefinitionTableTrait}; // To check item properties
use log;

const MAX_STAT_VALUE: f32 = 100.0;
const MIN_STAT_VALUE: f32 = 0.0;

#[table(name = active_consumable_effect, public)] // public for client UI if needed
#[derive(Clone, Debug)]
pub struct ActiveConsumableEffect {
    #[primary_key]
    #[auto_inc]
    pub effect_id: u64,
    pub player_id: Identity,
    pub item_def_id: u64, 
    pub started_at: Timestamp,
    pub ends_at: Timestamp,
    
    pub total_amount: Option<f32>, 
    pub amount_applied_so_far: Option<f32>,
    pub effect_type: EffectType,

    pub tick_interval_micros: u64, 
    pub next_tick_at: Timestamp,   
}

#[derive(SpacetimeType, Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum EffectType {
    HealthRegen,
    Damage,
    Bleed,
    // Potentially HungerRegen, ThirstRegen, StaminaRegen in future
}

// Schedule table for processing effects
#[table(name = process_effects_schedule, scheduled(process_active_consumable_effects_tick))]
pub struct ProcessEffectsSchedule {
    #[primary_key]
    #[auto_inc]
    pub job_id: u64,
    pub job_name: String, 
    pub scheduled_at: ScheduleAt,
}

pub fn schedule_effect_processing(ctx: &ReducerContext) -> Result<(), String> {
    if ctx.db.process_effects_schedule().iter().find(|job| job.job_name == "process_consumable_effects").is_none() {
        ctx.db.process_effects_schedule().insert(ProcessEffectsSchedule {
            job_id: 0,
            job_name: "process_consumable_effects".to_string(),
            scheduled_at: TimeDuration::from_micros(1_000_000).into(), // Tick every 1 second
        });
        log::info!("Scheduled active consumable effect processing.");
    }
    Ok(())
}

#[spacetimedb::reducer]
pub fn process_active_consumable_effects_tick(ctx: &ReducerContext, _args: ProcessEffectsSchedule) -> Result<(), String> {
    if ctx.sender != ctx.identity() {
        return Err("process_active_consumable_effects_tick can only be called by the scheduler.".to_string());
    }

    let current_time = ctx.timestamp;
    let mut effects_to_remove = Vec::new();
    let mut player_updates = std::collections::HashMap::<Identity, Player>::new();

    for effect_row in ctx.db.active_consumable_effect().iter() {
        let effect = effect_row.clone(); // Clone to work with
        if current_time < effect.next_tick_at {
            continue;
        }

        let mut effect_ended = false;
        let mut player_effect_applied_this_iteration = false; // Tracks if this specific effect iteration changed player health

        // Fetch or get the latest player state for this effect
        let mut player_to_update = match player_updates.get(&effect.player_id) {
            Some(p) => p.clone(),
            None => match ctx.db.player().identity().find(&effect.player_id) {
                Some(p) => p,
                None => {
                    log::warn!("[EffectTick] Player {:?} not found for effect_id {}. Removing effect.", effect.player_id, effect.effect_id);
                    effects_to_remove.push(effect.effect_id);
                    continue;
                }
            }
        };
        let old_health = player_to_update.health;
        let mut current_effect_applied_so_far = effect.amount_applied_so_far.unwrap_or(0.0);

        // --- Handle Environmental Damage (One-Shot) ---
        if effect.effect_type == EffectType::Damage && effect.item_def_id == 0 {
            if let Some(damage_to_apply) = effect.total_amount { // For environmental, total_amount is the one-shot damage
                log::trace!("[EffectTick] ENV_DAMAGE Pre-Damage for Player {:?}: Health {:.2}, DamageThisTick {:.2}",
                    effect.player_id, player_to_update.health, damage_to_apply);
                player_to_update.health = (player_to_update.health - damage_to_apply).clamp(MIN_STAT_VALUE, MAX_STAT_VALUE);
                log::trace!("[EffectTick] ENV_DAMAGE Post-Damage for Player {:?}: Health now {:.2}",
                    effect.player_id, player_to_update.health);

                if (player_to_update.health - old_health).abs() > f32::EPSILON {
                    player_effect_applied_this_iteration = true;
                }
                // Environmental effect applies its full amount in one go, so conceptually `applied_so_far` becomes `total_amount`
                // current_effect_applied_so_far = damage_to_apply; // Not strictly needed as it's removed, but for consistency if logged
            }
            effect_ended = true; // Environmental damage is always one-shot and then removed
        }
        // --- Handle Progressive Effects (HealthRegen, Bleed, item-based Damage) ---
        else if let Some(total_amount_val) = effect.total_amount {
            let total_duration_micros = effect.ends_at.to_micros_since_unix_epoch().saturating_sub(effect.started_at.to_micros_since_unix_epoch());

            if total_duration_micros == 0 {
                log::warn!("[EffectTick] Effect {} for player {:?} has zero duration. Ending.", effect.effect_id, effect.player_id);
                effect_ended = true;
            } else if current_effect_applied_so_far >= total_amount_val {
                log::debug!("[EffectTick] Effect {} for player {:?} already met total_amount. Ending.", effect.effect_id, effect.player_id);
                effect_ended = true;
            }
             else {
                let amount_per_micro = total_amount_val / total_duration_micros as f32;
                let mut amount_this_tick = amount_per_micro * effect.tick_interval_micros as f32;

                // Ensure we don't apply more than remaining, and it's not negative.
                amount_this_tick = amount_this_tick.max(0.0); // Don't let calculated tick amount be negative
                // Cap amount_this_tick to not exceed (total_amount_val - current_effect_applied_so_far)
                amount_this_tick = amount_this_tick.min((total_amount_val - current_effect_applied_so_far).max(0.0));

                if amount_this_tick > 0.0 { // Only proceed if there's a positive amount to apply
                    match effect.effect_type {
                        EffectType::HealthRegen => {
                            log::trace!("[EffectTick] HEALTH_REGEN Pre-Regen for Player {:?}: Health {:.2}, AmountThisTick {:.2}",
                                effect.player_id, player_to_update.health, amount_this_tick);
                            player_to_update.health = (player_to_update.health + amount_this_tick).clamp(MIN_STAT_VALUE, MAX_STAT_VALUE);
                            log::trace!("[EffectTick] HEALTH_REGEN Post-Regen for Player {:?}: Health now {:.2}",
                                effect.player_id, player_to_update.health);
                        }
                        EffectType::Bleed | EffectType::Damage => { // Item-based Damage falls here too
                            log::trace!("[EffectTick] {:?} Pre-Damage for Player {:?}: Health {:.2}, AmountThisTick {:.2}",
                                effect.effect_type, effect.player_id, player_to_update.health, amount_this_tick);
                            player_to_update.health = (player_to_update.health - amount_this_tick).clamp(MIN_STAT_VALUE, MAX_STAT_VALUE);
                            log::trace!("[EffectTick] {:?} Post-Damage for Player {:?}: Health now {:.2}",
                                effect.effect_type, effect.player_id, player_to_update.health);
                        }
                    }

                    if (player_to_update.health - old_health).abs() > f32::EPSILON {
                        player_effect_applied_this_iteration = true;
                    }
                    current_effect_applied_so_far += amount_this_tick; // Increment amount applied *for this effect*
                } else {
                    log::trace!("[EffectTick] Effect {} for player {:?}: amount_this_tick was 0 or less. Applied so far: {:.2}/{:.2}",
                        effect.effect_id, effect.player_id, current_effect_applied_so_far, total_amount_val);
                }

                // Check if effect should end based on amount or time
                if current_effect_applied_so_far >= total_amount_val || current_time >= effect.ends_at {
                    effect_ended = true;
                }
            }
        } else {
            log::warn!("[EffectTick] Progressive effect_id {} for player {:?} is missing total_amount. Removing effect.", effect.effect_id, effect.player_id);
            effect_ended = true; // End if no total_amount for progressive effects
        }

        // --- Update player_updates map if health changed in this iteration ---
        if player_effect_applied_this_iteration {
            let health_was_reduced = player_to_update.health < old_health;

            player_updates.insert(effect.player_id, player_to_update.clone());
            log::trace!("[EffectTick] Player {:?} stat change recorded from effect_id {} (Type: {:?}). Old health: {:.2}, New health for player_updates map: {:.2}. Applied this tick (approx): {:.2}, Total Applied for effect: {:.2}",
                effect.player_id, effect.effect_id, effect.effect_type, old_health, player_to_update.health,
                if effect.effect_type == EffectType::Damage && effect.item_def_id == 0 { effect.total_amount.unwrap_or(0.0) } else { (current_effect_applied_so_far - effect.amount_applied_so_far.unwrap_or(0.0)).abs() },
                current_effect_applied_so_far
            );

            // If health was reduced by a damaging effect, cancel any active HealthRegen effects for that player.
            if health_was_reduced && (effect.effect_type == EffectType::Damage || effect.effect_type == EffectType::Bleed) {
                cancel_health_regen_effects(ctx, effect.player_id);
            }
        }

        // --- Update or Remove Effect Row ---
        if effect_ended {
            effects_to_remove.push(effect.effect_id);
            log::debug!("[EffectTick] Effect {} (Type: {:?}) for player {:?} ended. Applied so far: {:.2}. Reason: {}",
                effect.effect_id, effect.effect_type, effect.player_id, current_effect_applied_so_far,
                if current_time >= effect.ends_at { "duration" } else if effect.effect_type == EffectType::Damage && effect.item_def_id == 0 { "environmental one-shot" } else { "amount applied" }
            );
        } else {
            // Update the effect in the DB with the new applied_so_far and next_tick_at
            let mut updated_effect_for_db = effect; // 'effect' is already a clone of effect_row
            updated_effect_for_db.amount_applied_so_far = Some(current_effect_applied_so_far);
            updated_effect_for_db.next_tick_at = current_time + TimeDuration::from_micros(updated_effect_for_db.tick_interval_micros as i64);
            ctx.db.active_consumable_effect().effect_id().update(updated_effect_for_db);
        }
    }

    // --- Apply all accumulated player updates to the database ---
    for (player_id, player) in player_updates {
        ctx.db.player().identity().update(player); // This 'player' has the final health after all effects for them this tick
        log::debug!("[EffectTick] Final update for player {:?} applied to DB.", player_id);
    }

    // --- Remove all effects that have ended ---
    for effect_id_to_remove in effects_to_remove {
        ctx.db.active_consumable_effect().effect_id().delete(&effect_id_to_remove);
        // Log already happened when added to effects_to_remove
    }
    Ok(())
}

pub fn cancel_health_regen_effects(ctx: &ReducerContext, player_id: Identity) {
    let mut effects_to_cancel = Vec::new();
    for effect in ctx.db.active_consumable_effect().iter().filter(|e| e.player_id == player_id && e.effect_type == EffectType::HealthRegen) {
        effects_to_cancel.push(effect.effect_id);
    }
    for effect_id in effects_to_cancel {
        ctx.db.active_consumable_effect().effect_id().delete(&effect_id);
        log::info!("Cancelled health regen effect {} for player {:?} due to damage.", effect_id, player_id);
    }
} 