use spacetimedb::{table, Identity, Timestamp, ReducerContext, Table, ScheduleAt, TimeDuration, SpacetimeType};
// use crate::player::{Player, player as PlayerTableTrait}; // Old import
use crate::Player; // For the struct
use crate::player; // For the table trait
use crate::items::{ItemDefinition, item_definition as ItemDefinitionTableTrait}; // To check item properties
use crate::items::{InventoryItem, inventory_item as InventoryItemTableTrait}; // Added for item consumption
use crate::consumables::{MAX_HEALTH_VALUE, MIN_STAT_VALUE}; // Import constants from consumables
use log;

#[table(name = active_consumable_effect, public)] // public for client UI if needed
#[derive(Clone, Debug)]
pub struct ActiveConsumableEffect {
    #[primary_key]
    #[auto_inc]
    pub effect_id: u64,
    pub player_id: Identity, // The player who INITIATED the effect (e.g., used the bandage)
    pub target_player_id: Option<Identity>, // The player RECEIVING the effect (None if self-inflicted/self-cast)
    pub item_def_id: u64, // Identifies the type of item that caused the effect (e.g., Bandage def ID)
    pub consuming_item_instance_id: Option<u64>, // Instance ID of the item being consumed (e.g., specific Bandage stack)
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
    Burn,
    Bleed,
    BandageBurst, // For self-use
    RemoteBandageBurst, // For targeting others
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
    // A temporary Vec to store effects that need item consumption to avoid borrowing issues with ctx.db
    let mut effects_requiring_consumption: Vec<(u64, Identity, EffectType, Option<f32>)> = Vec::new();
    let mut player_ids_who_took_external_damage_this_tick = std::collections::HashSet::<Identity>::new(); // Renamed for clarity

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
        if effect.effect_type == EffectType::Burn && effect.item_def_id == 0 {
            if let Some(damage_to_apply) = effect.total_amount {
                log::trace!("[EffectTick] ENV_BURN Pre-Damage for Player {:?}: Health {:.2}, DamageThisTick {:.2}",
                    effect.player_id, player_to_update.health, damage_to_apply);
                let health_before_env_damage = player_to_update.health;
                player_to_update.health = (player_to_update.health - damage_to_apply).clamp(MIN_STAT_VALUE, MAX_HEALTH_VALUE);
                log::trace!("[EffectTick] ENV_BURN Post-Damage for Player {:?}: Health now {:.2}",
                    effect.player_id, player_to_update.health);

                if player_to_update.health < health_before_env_damage {
                    player_effect_applied_this_iteration = true;
                    player_ids_who_took_external_damage_this_tick.insert(effect.player_id); // Environmental damage is external
                }
            }
            effect_ended = true;
        }
        // --- Handle BandageBurst (Delayed Burst Heal) ---
        else if effect.effect_type == EffectType::BandageBurst || effect.effect_type == EffectType::RemoteBandageBurst {
            if let Some(burst_heal_amount) = effect.total_amount {
                log::info!("[EffectTick] Processing bandage effect: type={:?}, player_id={:?}, target_id={:?}, amount={:?}, current_time={:?}, ends_at={:?}", 
                    effect.effect_type, effect.player_id, effect.target_player_id, burst_heal_amount, current_time, effect.ends_at);

                // For regular BandageBurst (self-heal), we want to heal the player_id
                // For RemoteBandageBurst, we want to heal the target_player_id
                let target_id = match effect.effect_type {
                    EffectType::BandageBurst => {
                        log::info!("[EffectTick] Self-heal case: Using player_id as target: {:?}", effect.player_id);
                        Some(effect.player_id)
                    },
                    EffectType::RemoteBandageBurst => {
                        log::info!("[EffectTick] Remote-heal case: Using target_player_id: {:?}", effect.target_player_id);
                        effect.target_player_id
                    },
                    // Other effect types shouldn't reach this code path, but we need to handle them
                    EffectType::HealthRegen | EffectType::Burn | EffectType::Bleed => {
                        log::warn!("[EffectTick] Unexpected effect type {:?} in bandage processing", effect.effect_type);
                        Some(effect.player_id)
                    }
                };

                if let Some(target_id) = target_id {
                    // For remote healing, check if players are still in range
                    let mut in_range = true;
                    if effect.effect_type == EffectType::RemoteBandageBurst {
                        if let (Some(healer), Some(target)) = (
                            ctx.db.player().identity().find(&effect.player_id),
                            ctx.db.player().identity().find(&target_id)
                        ) {
                            let dx = healer.position_x - target.position_x;
                            let dy = healer.position_y - target.position_y;
                            let distance = (dx * dx + dy * dy).sqrt();
                            const HEALING_RANGE: f32 = 4.0 * 32.0; // Must match the range in use_equipped_item (4 tiles)
                            in_range = distance <= HEALING_RANGE;
                            
                            if !in_range {
                                log::info!("[EffectTick] RemoteBandageBurst cancelled: Players moved out of range. Healer: {:?}, Target: {:?}, Distance: {:.2}", 
                                    effect.player_id, target_id, distance);
                                effects_to_remove.push(effect.effect_id);
                                effect_ended = true;
                                
                                // Cancel any other active effects for this healing attempt
                                cancel_bandage_burst_effects(ctx, effect.player_id);
                                cancel_bandage_burst_effects(ctx, target_id);
                                continue;
                            }
                        } else {
                            log::warn!("[EffectTick] RemoteBandageBurst cancelled: Player not found. Healer: {:?}, Target: {:?}", 
                                effect.player_id, target_id);
                            effects_to_remove.push(effect.effect_id);
                            effect_ended = true;
                            continue;
                        }
                    }

                    // Get the correct player to update based on who is receiving the healing
                    let mut target_player_to_update = match player_updates.get(&target_id) {
                        Some(p) => {
                            log::info!("[EffectTick] Found player in updates map. ID: {:?}, Health: {:.2}", target_id, p.health);
                            p.clone()
                        },
                        None => match ctx.db.player().identity().find(&target_id) {
                            Some(p) => {
                                log::info!("[EffectTick] Found player in DB. ID: {:?}, Health: {:.2}", target_id, p.health);
                                p
                            },
                            None => {
                                log::warn!("[EffectTick] Target player {:?} not found for bandage effect. Removing effect.", target_id);
                                effects_to_remove.push(effect.effect_id);
                                continue;
                            }
                        }
                    };
                    let old_health = target_player_to_update.health;

                    if current_time >= effect.ends_at && in_range { // Timer finished and players in range
                        log::info!("[EffectTick] BANDAGE_BURST Effect Type: {:?}, Target {:?}: Effect ended. Applying burst heal: {:.2}. Old health: {:.2}", 
                            effect.effect_type, target_id, burst_heal_amount, old_health);
                        
                        target_player_to_update.health = (target_player_to_update.health + burst_heal_amount).clamp(MIN_STAT_VALUE, MAX_HEALTH_VALUE);
                        current_effect_applied_so_far = burst_heal_amount; // Mark as fully applied for consistency in logging/consumption
                        
                        log::info!("[EffectTick] BANDAGE_BURST Effect Type: {:?}, Target {:?}: Health now {:.2} (change: {:.2})", 
                            effect.effect_type, target_id, target_player_to_update.health, target_player_to_update.health - old_health);
                        
                        if (target_player_to_update.health - old_health).abs() > f32::EPSILON {
                            player_effect_applied_this_iteration = true;
                            // Update the player_updates map with the target player's new state
                            log::info!("[EffectTick] Updating player_updates map for target {:?} with new health: {:.2}", 
                                target_id, target_player_to_update.health);
                            player_updates.insert(target_id, target_player_to_update.clone());
                            
                            // If BandageBurst completes successfully, cancel bleed effects for this player.
                            if player_effect_applied_this_iteration { // Ensure health was actually applied
                                log::info!("[EffectTick] BandageBurst completed for target {:?}. Attempting to cancel bleed effects.", target_id);
                                cancel_bleed_effects(ctx, target_id);
                            }
                        } else {
                            log::warn!("[EffectTick] No health change detected for target {:?}. Old: {:.2}, New: {:.2}", 
                                target_id, old_health, target_player_to_update.health);
                        }
                        effect_ended = true;
                    } else {
                        // Timer still running for BandageBurst, do nothing to health, don't end yet.
                        log::info!("[EffectTick] BANDAGE_BURST Target {:?}: Timer active, ends_at: {:?}, current_time: {:?}", 
                            target_id, effect.ends_at, current_time);
                    }
                } else {
                    log::warn!("[EffectTick] BandageBurst effect {} missing target_id", effect.effect_id);
                    effect_ended = true;
                }
            } else {
                log::warn!("[EffectTick] BandageBurst effect {} missing heal_amount", effect.effect_id);
                effect_ended = true;
            }
        }
        // --- Handle Other Progressive Effects (HealthRegen, Bleed, item-based Damage) ---
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
                            log::trace!("[EffectTick] HealthRegen for Player {:?}: Health {:.2}, AmountThisTick {:.2}",
                                effect.player_id, player_to_update.health, amount_this_tick);
                            player_to_update.health = (player_to_update.health + amount_this_tick).clamp(MIN_STAT_VALUE, MAX_HEALTH_VALUE);
                            log::trace!("[EffectTick] HealthRegen Post-Heal for Player {:?}: Health now {:.2}",
                                effect.player_id, player_to_update.health);
                        }
                        EffectType::Bleed | EffectType::Burn => {
                            log::trace!("[EffectTick] {:?} Pre-Damage for Player {:?}: Health {:.2}, AmountThisTick {:.2}",
                                effect.effect_type, effect.player_id, player_to_update.health, amount_this_tick);
                            
                            // --- KNOCKED OUT PLAYERS ARE IMMUNE TO BLEED AND BURN DAMAGE ---
                            if player_to_update.is_knocked_out && (effect.effect_type == EffectType::Bleed || effect.effect_type == EffectType::Burn) {
                                // Knocked out players are completely immune to bleed and burn damage
                                amount_this_tick = 0.0; // No damage applied
                                log::info!("[EffectTick] Knocked out player {:?} is immune to {:?} damage. No damage applied.",
                                    effect.player_id, effect.effect_type);
                            } else {
                                // Normal damage application for conscious players
                                player_to_update.health = (player_to_update.health - amount_this_tick).clamp(MIN_STAT_VALUE, MAX_HEALTH_VALUE);
                            }
                            // --- END KNOCKED OUT IMMUNITY ---
                            
                            log::trace!("[EffectTick] {:?} Post-Damage for Player {:?}: Health now {:.2}",
                                effect.effect_type, effect.player_id, player_to_update.health);
                        }
                        EffectType::BandageBurst | EffectType::RemoteBandageBurst => {
                            // No healing per tick for BandageBurst/RemoteBandageBurst, healing is applied only when the effect ends.
                            // This arm handles the per-tick calculation, so it should be 0 here.
                            amount_this_tick = 0.0; 
                        }
                    }

                    if (player_to_update.health - old_health).abs() > f32::EPSILON {
                        player_effect_applied_this_iteration = true;
                    }
                    current_effect_applied_so_far += amount_this_tick; // Increment amount applied *for this effect*

                    // If this effect was a damaging one and health was reduced, mark player for potential BandageBurst cancellation
                    // Only item-based direct Damage (not Bleed itself) counts as external for interrupting bandages.
                    if player_effect_applied_this_iteration && effect.effect_type == EffectType::Burn && effect.item_def_id != 0 {
                        if player_to_update.health < old_health {
                             player_ids_who_took_external_damage_this_tick.insert(effect.player_id);
                        }
                    }
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
        // NOTE: BandageBurst and RemoteBandageBurst handle their own player_updates insertions
        // with the correct target player, so we exclude them here
        if player_effect_applied_this_iteration && 
           effect.effect_type != EffectType::BandageBurst && 
           effect.effect_type != EffectType::RemoteBandageBurst {
            let health_was_reduced = player_to_update.health < old_health;

            player_to_update.last_update = current_time;
            player_updates.insert(effect.player_id, player_to_update.clone());
            log::trace!("[EffectTick] Player {:?} stat change recorded from effect_id {} (Type: {:?}). Old health: {:.2}, New health for player_updates map: {:.2}. Applied this tick (approx): {:.2}, Total Applied for effect: {:.2}",
                effect.player_id, effect.effect_id, effect.effect_type, old_health, player_to_update.health,
                if effect.effect_type == EffectType::Burn && effect.item_def_id == 0 { effect.total_amount.unwrap_or(0.0) } else { (current_effect_applied_so_far - effect.amount_applied_so_far.unwrap_or(0.0)).abs() },
                current_effect_applied_so_far
            );

            // If health was reduced by a damaging effect, cancel any active HealthRegen effects for that player.
            // This check is now implicitly handled by player_ids_who_took_external_damage_this_tick below,
            // but we'll keep the direct health_was_reduced check for HealthRegen for clarity specific to it.
            if health_was_reduced && (effect.effect_type == EffectType::Burn || effect.effect_type == EffectType::Bleed) {
                cancel_health_regen_effects(ctx, effect.player_id);
                // Note: BandageBurst cancellation due to taking damage is handled after iterating all effects using player_ids_who_took_external_damage_this_tick
            }
        }

        // --- Update or Remove Effect Row ---
        if effect_ended {
            effects_to_remove.push(effect.effect_id);
            log::debug!("[EffectTick] Effect {} (Type: {:?}) for player {:?} ended. Applied so far: {:.2}. Reason: {}",
                effect.effect_id, effect.effect_type, effect.player_id, current_effect_applied_so_far,
                if current_time >= effect.ends_at { "duration" } else if effect.effect_type == EffectType::Burn && effect.item_def_id == 0 { "environmental one-shot" } else { "amount applied" }
            );

            // If the effect had an associated item instance to consume, mark it for consumption
            if let Some(item_instance_id_to_consume) = effect.consuming_item_instance_id {
                effects_requiring_consumption.push((item_instance_id_to_consume, effect.player_id, effect.effect_type.clone(), Some(current_effect_applied_so_far)));
            }
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

    // --- Cancel BandageBurst effects for players who took EXTERNALLY sourced damage this tick ---
    for player_id_damaged in player_ids_who_took_external_damage_this_tick {
        log::debug!("[EffectTick] Player {:?} took external damage this tick. Cancelling their BandageBurst effects.", player_id_damaged);
        cancel_bandage_burst_effects(ctx, player_id_damaged);
    }
    
    // --- Consume items for effects that ended and had a consuming_item_instance_id ---
    for (item_instance_id, player_id, effect_type, amount_applied) in effects_requiring_consumption {
        if let Some(mut inventory_item) = ctx.db.inventory_item().instance_id().find(&item_instance_id) {
            log::info!("[ItemConsumption] Attempting to consume item_instance_id: {} for player {:?} after {:?} effect (applied: {:?}). Current quantity: {}", 
                item_instance_id, player_id, effect_type, amount_applied.unwrap_or(0.0), inventory_item.quantity);
            
            if inventory_item.quantity > 0 {
                inventory_item.quantity -= 1;
            }

            if inventory_item.quantity == 0 {
                ctx.db.inventory_item().instance_id().delete(&item_instance_id);
                log::info!("[ItemConsumption] Consumed and deleted item_instance_id: {} (quantity became 0) for player {:?}.", 
                    item_instance_id, player_id);
            } else {
                ctx.db.inventory_item().instance_id().update(inventory_item.clone());
                 log::info!("[ItemConsumption] Consumed item_instance_id: {}, new quantity: {} for player {:?}.", 
                    item_instance_id, inventory_item.quantity, player_id);
            }
        } else {
            log::warn!("[ItemConsumption] Could not find InventoryItem with instance_id: {} to consume for player {:?} after {:?} effect.", 
                item_instance_id, player_id, effect_type);
        }
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

pub fn cancel_bleed_effects(ctx: &ReducerContext, player_id: Identity) {
    let mut effects_to_cancel = Vec::new();
    for effect in ctx.db.active_consumable_effect().iter().filter(|e| e.player_id == player_id && e.effect_type == EffectType::Bleed) {
        effects_to_cancel.push(effect.effect_id);
    }
    for effect_id in effects_to_cancel {
        ctx.db.active_consumable_effect().effect_id().delete(&effect_id);
        log::info!("Cancelled bleed effect {} for player {:?} (e.g., by bandage).", effect_id, player_id);
    }
}

pub fn cancel_bandage_burst_effects(ctx: &ReducerContext, player_id: Identity) {
    let mut effects_to_cancel = Vec::new();
    for effect in ctx.db.active_consumable_effect().iter().filter(|e| {
        // Cancel if player is either the healer or the target of any bandage effect
        (e.player_id == player_id && (e.effect_type == EffectType::BandageBurst || e.effect_type == EffectType::RemoteBandageBurst)) ||
        (e.target_player_id == Some(player_id) && e.effect_type == EffectType::RemoteBandageBurst)
    }) {
        effects_to_cancel.push(effect.effect_id);
    }
    for effect_id in effects_to_cancel {
        ctx.db.active_consumable_effect().effect_id().delete(&effect_id);
        log::info!("Cancelled BandageBurst/RemoteBandageBurst effect {} for player {:?} (e.g., due to damage or interruption).", effect_id, player_id);
    }
} 