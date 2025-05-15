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
        let effect = effect_row.clone(); // Clone to work with, update original later if needed
        if current_time < effect.next_tick_at {
            continue; 
        }

        let mut effect_ended = false;
        let mut player_effect_applied = false;

        if let Some(total_amount_val) = effect.total_amount {
            let mut applied_so_far = effect.amount_applied_so_far.unwrap_or(0.0);
            
            let total_duration_micros = effect.ends_at.to_micros_since_unix_epoch().saturating_sub(effect.started_at.to_micros_since_unix_epoch());
            if total_duration_micros == 0 {
                effects_to_remove.push(effect.effect_id);
                continue;
            }

            let amount_per_micro = total_amount_val / total_duration_micros as f32;
            let mut amount_this_tick = amount_per_micro * effect.tick_interval_micros as f32;

            amount_this_tick = amount_this_tick.min(total_amount_val - applied_so_far);
            
            let mut player_to_update = match player_updates.get(&effect.player_id) {
                Some(p) => p.clone(),
                None => match ctx.db.player().identity().find(&effect.player_id) {
                    Some(p) => p,
                    None => { 
                        effects_to_remove.push(effect.effect_id);
                        continue;
                    }
                }
            };
            
            let old_health = player_to_update.health;

            match effect.effect_type {
                EffectType::HealthRegen => {
                    player_to_update.health = (player_to_update.health + amount_this_tick).clamp(MIN_STAT_VALUE, MAX_STAT_VALUE);
                    if player_to_update.health != old_health { player_effect_applied = true; }
                }
            }
            
            if player_effect_applied {
                player_updates.insert(effect.player_id, player_to_update);
                applied_so_far += amount_this_tick;
                 log::trace!("[EffectTick] Applied {:.2} {:?} to Player {:?}. Total applied: {:.2}/{:.2}", 
                    amount_this_tick, effect.effect_type, effect.player_id, applied_so_far, total_amount_val);
            }

            if applied_so_far >= total_amount_val || current_time >= effect.ends_at {
                effect_ended = true;
            }

            if effect_ended {
                effects_to_remove.push(effect.effect_id);
            } else {
                let mut updated_effect_for_db = effect.clone(); // Clone again for the update
                updated_effect_for_db.amount_applied_so_far = Some(applied_so_far);
                updated_effect_for_db.next_tick_at = current_time + TimeDuration::from_micros(effect.tick_interval_micros as i64);
                ctx.db.active_consumable_effect().effect_id().update(updated_effect_for_db);
            }
        } else { 
            effects_to_remove.push(effect.effect_id);
        }
    }

    for (player_id, player) in player_updates {
        ctx.db.player().identity().update(player);
        log::debug!("[EffectTick] Updated stats for player {:?}", player_id);
    }

    for effect_id in effects_to_remove {
        ctx.db.active_consumable_effect().effect_id().delete(&effect_id);
        log::debug!("[EffectTick] Removed effect {}", effect_id);
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