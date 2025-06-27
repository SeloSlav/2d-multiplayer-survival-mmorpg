use spacetimedb::{table, Identity, Timestamp, ReducerContext, Table, ScheduleAt, TimeDuration, SpacetimeType};
// use crate::player::{Player, player as PlayerTableTrait}; // Old import
use crate::Player; // For the struct
use crate::player; // For the table trait
use crate::items::{ItemDefinition, item_definition as ItemDefinitionTableTrait}; // To check item properties
use crate::items::{InventoryItem, inventory_item as InventoryItemTableTrait}; // Added for item consumption
use crate::consumables::{MAX_HEALTH_VALUE, MIN_STAT_VALUE}; // Import constants from consumables
use rand::Rng; // For random number generation
use log;

// Import table traits for burn extinguishing functionality
use crate::world_state::world_state as WorldStateTableTrait;
use crate::shelter::shelter as ShelterTableTrait;
use crate::tree::tree as TreeTableTrait;

// Import sound system for throwing up sound when poisoned
use crate::sound_events::emit_throwing_up_sound;

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
    SeawaterPoisoning, // Dehydration from drinking seawater
    FoodPoisoning, // From eating contaminated/raw foods
    Cozy, // Health regen bonus and food healing bonus when near campfires or in owned shelters
    Wet, // Cold damage multiplier when exposed to water/rain
    TreeCover, // Natural shelter and protection from trees
    WaterDrinking, // Visual effect for drinking water containers
    Venom, // Damage over time from Cable Viper strikes
}

// Table defining food poisoning risks for different food items
#[table(name = food_poisoning_risk, public)]
#[derive(Clone, Debug)]
pub struct FoodPoisoningRisk {
    #[primary_key]
    pub item_def_id: u64, // The food item that can cause poisoning
    pub poisoning_chance_percent: f32, // 0.0 to 100.0 chance of getting food poisoning
    pub damage_per_tick: f32, // Damage dealt per tick
    pub duration_seconds: f32, // How long the poisoning lasts
    pub tick_interval_seconds: f32, // How often damage is applied
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

        // Skip cozy and tree cover effects - they are managed by the player stats system, not the effect tick system
        // Wet effects are now processed normally like other effects
        if effect.effect_type == EffectType::Cozy || effect.effect_type == EffectType::TreeCover {
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

        // Note: Removed special case for environmental burn effects (item_def_id == 0)
        // All burn effects now use the standard DOT processing below
        
        // --- Handle BandageBurst (Delayed Burst Heal) ---
        if effect.effect_type == EffectType::BandageBurst || effect.effect_type == EffectType::RemoteBandageBurst {
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
                    EffectType::HealthRegen | EffectType::Burn | EffectType::Bleed | EffectType::Venom | EffectType::SeawaterPoisoning | EffectType::FoodPoisoning | EffectType::Cozy | EffectType::Wet | EffectType::TreeCover | EffectType::WaterDrinking => {
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
        // Wet effects don't have total_amount, so handle them separately
        if effect.effect_type == EffectType::Wet {
            // Wet effects are purely time-based, no per-tick processing needed
            // They just exist until they expire or are removed by environmental conditions
        } else if let Some(total_amount_val) = effect.total_amount {
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
                        EffectType::Bleed | EffectType::Burn | EffectType::Venom => {
                            log::trace!("[EffectTick] {:?} Pre-Damage for Player {:?}: Health {:.2}, AmountThisTick {:.2}",
                                effect.effect_type, effect.player_id, player_to_update.health, amount_this_tick);
                            
                            // --- KNOCKED OUT PLAYERS ARE IMMUNE TO BLEED, BURN, AND VENOM DAMAGE ---
                            if player_to_update.is_knocked_out && (effect.effect_type == EffectType::Bleed || effect.effect_type == EffectType::Burn || effect.effect_type == EffectType::Venom) {
                                // Knocked out players are completely immune to DOT damage
                                amount_this_tick = 0.0; // No damage applied
                                log::info!("[EffectTick] Knocked out player {:?} is immune to {:?} damage. No damage applied.",
                                    effect.player_id, effect.effect_type);
                            } else {
                                // Special handling for Venom: fixed damage per tick like SeawaterPoisoning
                                if effect.effect_type == EffectType::Venom {
                                    amount_this_tick = 1.0; // Fixed 1 damage per tick for persistent venom
                                }
                                // Normal damage application for conscious players
                                player_to_update.health = (player_to_update.health - amount_this_tick).clamp(MIN_STAT_VALUE, MAX_HEALTH_VALUE);
                            }
                            // --- END KNOCKED OUT IMMUNITY ---
                            
                            log::trace!("[EffectTick] {:?} Post-Damage for Player {:?}: Health now {:.2}",
                                effect.effect_type, effect.player_id, player_to_update.health);
                        }
                        EffectType::SeawaterPoisoning => {
                            log::trace!("[EffectTick] SeawaterPoisoning Pre-Damage for Player {:?}: Health {:.2}, AmountThisTick {:.2}",
                                effect.player_id, player_to_update.health, amount_this_tick);
                            
                            // --- KNOCKED OUT PLAYERS ARE IMMUNE TO SEAWATER POISONING ---
                            if player_to_update.is_knocked_out {
                                // Knocked out players are completely immune to seawater poisoning damage
                                amount_this_tick = 0.0; // No damage applied
                                log::info!("[EffectTick] Knocked out player {:?} is immune to SeawaterPoisoning damage. No damage applied.",
                                    effect.player_id);
                            } else {
                                // Normal damage application for conscious players - always exactly 1 damage per tick
                                amount_this_tick = 1.0; // Override calculated amount to ensure exactly 1 damage per tick
                                player_to_update.health = (player_to_update.health - amount_this_tick).clamp(MIN_STAT_VALUE, MAX_HEALTH_VALUE);
                            }
                            // --- END KNOCKED OUT IMMUNITY ---
                            
                            log::trace!("[EffectTick] SeawaterPoisoning Post-Damage for Player {:?}: Health now {:.2}",
                                effect.player_id, player_to_update.health);
                        }
                        EffectType::FoodPoisoning => {
                            log::trace!("[EffectTick] FoodPoisoning Pre-Damage for Player {:?}: Health {:.2}, AmountThisTick {:.2}",
                                effect.player_id, player_to_update.health, amount_this_tick);
                            
                            // --- KNOCKED OUT PLAYERS ARE IMMUNE TO FOOD POISONING ---
                            if player_to_update.is_knocked_out {
                                // Knocked out players are completely immune to food poisoning damage
                                amount_this_tick = 0.0; // No damage applied
                                log::info!("[EffectTick] Knocked out player {:?} is immune to FoodPoisoning damage. No damage applied.",
                                    effect.player_id);
                            } else {
                                // Normal damage application for conscious players - use calculated amount_this_tick
                                player_to_update.health = (player_to_update.health - amount_this_tick).clamp(MIN_STAT_VALUE, MAX_HEALTH_VALUE);
                            }
                            // --- END KNOCKED OUT IMMUNITY ---
                            
                            log::trace!("[EffectTick] FoodPoisoning Post-Damage for Player {:?}: Health now {:.2}",
                                effect.player_id, player_to_update.health);
                        }
                        EffectType::BandageBurst | EffectType::RemoteBandageBurst => {
                            // No healing per tick for BandageBurst/RemoteBandageBurst, healing is applied only when the effect ends.
                            // This arm handles the per-tick calculation, so it should be 0 here.
                            amount_this_tick = 0.0; 
                        }
                        EffectType::WaterDrinking => {
                            // WaterDrinking is purely a visual effect, no per-tick processing needed
                            // It just exists for the duration to trigger client-side animations
                            amount_this_tick = 0.0;
                        }
                        EffectType::Cozy => {
                            // Cozy provides health regeneration bonus and food healing bonus
                            // The health regen bonus is handled in player_stats.rs
                            // The food healing bonus is handled in consumables.rs
                            // This effect doesn't consume amount_applied_so_far
                            amount_this_tick = 0.0;
                        }
                        EffectType::Wet => {
                            // Wet provides cold damage multiplier
                            // The cold damage multiplier is handled in player_stats.rs
                            // This effect doesn't consume amount_applied_so_far
                            amount_this_tick = 0.0;
                        }
                        EffectType::TreeCover => {
                            // TreeCover provides natural shelter from rain and accelerated drying
                            // The rain protection and drying acceleration is handled in world_state.rs and wet.rs
                            // This effect doesn't consume amount_applied_so_far
                            amount_this_tick = 0.0;
                        }
                    }

                    if (player_to_update.health - old_health).abs() > f32::EPSILON {
                        player_effect_applied_this_iteration = true;
                    }
                    
                    // For SeawaterPoisoning and Venom, we don't track amount_applied_so_far
                    // SeawaterPoisoning and Venom: fixed damage per tick, ends based on time only
                    if effect.effect_type != EffectType::SeawaterPoisoning && effect.effect_type != EffectType::Venom {
                        current_effect_applied_so_far += amount_this_tick; // Increment amount applied *for this effect*
                    }

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
        // For SeawaterPoisoning, Venom, and Wet effects, only end based on time, not accumulated damage
        if effect.effect_type == EffectType::SeawaterPoisoning || effect.effect_type == EffectType::Venom || effect.effect_type == EffectType::Wet {
            if current_time >= effect.ends_at {
                effect_ended = true;
            }
        } else {
            if current_effect_applied_so_far >= total_amount_val || current_time >= effect.ends_at {
                effect_ended = true;
            }
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
            if health_was_reduced && (effect.effect_type == EffectType::Burn || effect.effect_type == EffectType::Bleed || effect.effect_type == EffectType::Venom || effect.effect_type == EffectType::SeawaterPoisoning || effect.effect_type == EffectType::FoodPoisoning) {
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

            // Stop bandaging sound when BandageBurst or RemoteBandageBurst effects end (both from completion and cancellation)
            if effect.effect_type == EffectType::BandageBurst || effect.effect_type == EffectType::RemoteBandageBurst {
                // For RemoteBandageBurst, get the target player's position; for BandageBurst, get the healer's position
                let sound_player_id = match effect.effect_type {
                    EffectType::RemoteBandageBurst => effect.target_player_id.unwrap_or(effect.player_id),
                    EffectType::BandageBurst => effect.player_id,
                    _ => effect.player_id, // This shouldn't happen but provides a fallback
                };
                
                if let Some(player) = ctx.db.player().identity().find(&sound_player_id) {
                    crate::sound_events::stop_bandaging_sound(ctx, player.position_x, player.position_y, sound_player_id);
                    log::info!("[EffectTick] Stopped bandaging sound for player {:?} as {:?} effect {} completed", 
                        sound_player_id, effect.effect_type, effect.effect_id);
                }
            }

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

    // Check for environmental conditions that should extinguish burn effects
    check_and_extinguish_burns_from_environment(ctx)?;

    // Check for environmental conditions that should apply wet effects and handle accelerated decay
    crate::wet::check_and_remove_wet_from_environment(ctx)?;

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
    
    // Stop bandaging sound if any effects are being cancelled
    if !effects_to_cancel.is_empty() {
        if let Some(player) = ctx.db.player().identity().find(&player_id) {
            crate::sound_events::stop_bandaging_sound(ctx, player.position_x, player.position_y, player_id);
        }
    }
    
    for effect_id in effects_to_cancel {
        ctx.db.active_consumable_effect().effect_id().delete(&effect_id);
        log::info!("Cancelled BandageBurst/RemoteBandageBurst effect {} for player {:?} (e.g., due to damage or interruption).", effect_id, player_id);
    }
}

pub fn apply_food_poisoning_effect(ctx: &ReducerContext, player_id: Identity, item_def_id: u64) -> Result<(), String> {
    // Get the food poisoning risk data for this item
    let poisoning_risk = match ctx.db.food_poisoning_risk().item_def_id().find(&item_def_id) {
        Some(risk) => risk,
        None => {
            log::debug!("No food poisoning risk defined for item_def_id: {}", item_def_id);
            return Ok(()); // Not an error, just no risk defined
        }
    };

    // Roll for poisoning chance
    let roll = ctx.rng().gen_range(0.0..100.0);
    if roll > poisoning_risk.poisoning_chance_percent {
        log::debug!("Food poisoning roll failed for player {:?}, item {}: {:.1}% > {:.1}%", 
            player_id, item_def_id, roll, poisoning_risk.poisoning_chance_percent);
        return Ok(()); // No poisoning occurred
    }

    log::info!("Food poisoning triggered for player {:?}, item {}: {:.1}% <= {:.1}%", 
        player_id, item_def_id, roll, poisoning_risk.poisoning_chance_percent);

    // Get player position for sound emission
    if let Some(player) = ctx.db.player().identity().find(&player_id) {
        emit_throwing_up_sound(ctx, player.position_x, player.position_y, player_id);
    }

    // Check for existing food poisoning effects and extend if found
    for existing_effect in ctx.db.active_consumable_effect().iter() {
        if existing_effect.player_id == player_id && existing_effect.effect_type == EffectType::FoodPoisoning {
            // Extend existing effect
            let additional_duration = TimeDuration::from_micros((poisoning_risk.duration_seconds * 1_000_000.0) as i64);
            let additional_damage = poisoning_risk.damage_per_tick * (poisoning_risk.duration_seconds / poisoning_risk.tick_interval_seconds);
            
            let mut updated_effect = existing_effect.clone();
            updated_effect.ends_at = updated_effect.ends_at + additional_duration;
            updated_effect.total_amount = Some(updated_effect.total_amount.unwrap_or(0.0) + additional_damage);
            
            let total_damage_amount = updated_effect.total_amount.unwrap_or(0.0);
            ctx.db.active_consumable_effect().effect_id().update(updated_effect);
            log::info!("Extended food poisoning effect for player {:?} by {:.1} seconds (total damage now: {:.1})", 
                player_id, poisoning_risk.duration_seconds, total_damage_amount);
            return Ok(());
        }
    }

    // Create new food poisoning effect
    let current_time = ctx.timestamp;
    let duration_micros = (poisoning_risk.duration_seconds * 1_000_000.0) as i64;
    let tick_interval_micros = (poisoning_risk.tick_interval_seconds * 1_000_000.0) as u64;
    let total_damage = poisoning_risk.damage_per_tick * (poisoning_risk.duration_seconds / poisoning_risk.tick_interval_seconds);

    let food_poisoning_effect = ActiveConsumableEffect {
        effect_id: 0, // auto_inc
        player_id,
        target_player_id: None,
        item_def_id,
        consuming_item_instance_id: None,
        started_at: current_time,
        ends_at: current_time + TimeDuration::from_micros(duration_micros),
        total_amount: Some(total_damage),
        amount_applied_so_far: Some(0.0),
        effect_type: EffectType::FoodPoisoning,
        tick_interval_micros,
        next_tick_at: current_time + TimeDuration::from_micros(tick_interval_micros as i64),
    };

    match ctx.db.active_consumable_effect().try_insert(food_poisoning_effect) {
        Ok(inserted_effect) => {
            log::info!("Applied food poisoning effect {} to player {:?}: {:.1} damage over {:.1}s (every {:.1}s)", 
                inserted_effect.effect_id, player_id, total_damage, poisoning_risk.duration_seconds, poisoning_risk.tick_interval_seconds);
            Ok(())
        }
        Err(e) => {
            log::error!("Failed to apply food poisoning effect to player {:?}: {:?}", player_id, e);
            Err("Failed to apply food poisoning effect".to_string())
        }
    }
}

pub fn apply_seawater_poisoning_effect(ctx: &ReducerContext, player_id: Identity, duration_seconds: u32) -> Result<(), String> {
    let current_time = ctx.timestamp;
    let duration_micros = (duration_seconds as u64) * 1_000_000;
    let tick_interval_micros = 1_000_000u64; // 1 second per tick
    let total_damage = duration_seconds as f32; // 1 damage per second
    
    // Check if player already has seawater poisoning - if so, extend the duration
    let existing_effects: Vec<_> = ctx.db.active_consumable_effect().iter()
        .filter(|e| e.player_id == player_id && e.effect_type == EffectType::SeawaterPoisoning)
        .collect();

    if !existing_effects.is_empty() {
        // Extend existing effect instead of creating a new one
        for existing_effect in existing_effects {
            let mut updated_effect = existing_effect.clone();
            let additional_damage = duration_seconds as f32;
            
            // Extend the end time
            updated_effect.ends_at = current_time + TimeDuration::from_micros(duration_micros as i64);
            
            // Add to total damage amount
            if let Some(current_total) = updated_effect.total_amount {
                updated_effect.total_amount = Some(current_total + additional_damage);
            } else {
                updated_effect.total_amount = Some(additional_damage);
            }
            
            let total_damage_amount = updated_effect.total_amount.unwrap_or(0.0);
            ctx.db.active_consumable_effect().effect_id().update(updated_effect);
            log::info!("Extended seawater poisoning effect for player {:?} by {} seconds (total damage now: {:.1})", 
                player_id, duration_seconds, total_damage_amount);
        }
    } else {
        // Create new seawater poisoning effect
        let effect = ActiveConsumableEffect {
            effect_id: 0, // auto_inc
            player_id,
            target_player_id: None, // Self-inflicted
            item_def_id: 0, // Not from an item
            consuming_item_instance_id: None, // No item to consume
            started_at: current_time,
            ends_at: current_time + TimeDuration::from_micros(duration_micros as i64),
            total_amount: Some(total_damage),
            amount_applied_so_far: Some(0.0),
            effect_type: EffectType::SeawaterPoisoning,
            tick_interval_micros,
            next_tick_at: current_time + TimeDuration::from_micros(tick_interval_micros as i64),
        };

        ctx.db.active_consumable_effect().insert(effect);
        log::info!("Applied seawater poisoning effect to player {:?} for {} seconds ({} total damage)", 
            player_id, duration_seconds, total_damage);

        // Emit throwing up sound for seawater poisoning
        if let Some(player) = ctx.db.player().identity().find(&player_id) {
            emit_throwing_up_sound(ctx, player.position_x, player.position_y, player_id);
        }
    }
    
    Ok(())
}

// Constants for cozy effect
pub const COZY_HEALTH_REGEN_MULTIPLIER: f32 = 2.0; // Double passive health regeneration when cozy
pub const COZY_FOOD_HEALING_MULTIPLIER: f32 = 1.5; // 50% bonus to food healing
pub const COZY_EFFECT_CHECK_INTERVAL_SECONDS: u32 = 2; // Check cozy conditions every 2 seconds

/// Checks if a player should have the cozy effect based on their proximity to campfires or owned shelters
pub fn should_player_be_cozy(ctx: &ReducerContext, player_id: Identity, player_x: f32, player_y: f32) -> bool {
    // Import necessary traits
    use crate::campfire::{campfire as CampfireTableTrait, WARMTH_RADIUS_SQUARED};
    use crate::shelter::{shelter as ShelterTableTrait, is_player_inside_shelter};
    
    // Check for nearby burning campfires
    for campfire in ctx.db.campfire().iter() {
        if campfire.is_burning {
            let dx = player_x - campfire.pos_x;
            let dy = player_y - campfire.pos_y;
            let distance_squared = dx * dx + dy * dy;
            
            if distance_squared <= WARMTH_RADIUS_SQUARED {
                log::debug!("Player {:?} is cozy near burning campfire {}", player_id, campfire.id);
                return true;
            }
        }
    }
    
    // Check for owned shelters
    for shelter in ctx.db.shelter().iter() {
        if shelter.is_destroyed { continue; }
        if shelter.placed_by == player_id { // Only owned shelters provide cozy effect
            if is_player_inside_shelter(player_x, player_y, &shelter) {
                log::debug!("Player {:?} is cozy inside their own shelter {}", player_id, shelter.id);
                return true;
            }
        }
    }
    
    false
}

/// Applies or removes cozy effect based on player's current conditions
pub fn update_player_cozy_status(ctx: &ReducerContext, player_id: Identity, player_x: f32, player_y: f32) -> Result<(), String> {
    let should_be_cozy = should_player_be_cozy(ctx, player_id, player_x, player_y);
    let has_cozy_effect = ctx.db.active_consumable_effect().iter()
        .any(|effect| effect.player_id == player_id && effect.effect_type == EffectType::Cozy);
    
    log::debug!("Cozy status check for player {:?}: should_be_cozy={}, has_cozy_effect={}", 
        player_id, should_be_cozy, has_cozy_effect);
    
    if should_be_cozy && !has_cozy_effect {
        // Apply cozy effect
        log::info!("Applying cozy effect to player {:?}", player_id);
        apply_cozy_effect(ctx, player_id)?;
    } else if !should_be_cozy && has_cozy_effect {
        // Remove cozy effect
        log::info!("Removing cozy effect from player {:?}", player_id);
        remove_cozy_effect(ctx, player_id);
    }
    // No need to extend - cozy effect is now permanent until removed
    
    Ok(())
}

/// Applies a cozy effect to a player
fn apply_cozy_effect(ctx: &ReducerContext, player_id: Identity) -> Result<(), String> {
    let current_time = ctx.timestamp;
    // Set a very far future time (1 year from now) - effectively permanent
    let very_far_future = current_time + TimeDuration::from_micros(365 * 24 * 60 * 60 * 1_000_000i64); // 1 year
    
    let cozy_effect = ActiveConsumableEffect {
        effect_id: 0, // auto_inc
        player_id,
        target_player_id: None,
        item_def_id: 0, // Not from an item
        consuming_item_instance_id: None,
        started_at: current_time,
        ends_at: very_far_future, // Effectively permanent
        total_amount: None, // No accumulation for cozy effect
        amount_applied_so_far: None,
        effect_type: EffectType::Cozy,
        tick_interval_micros: 1_000_000, // 1 second ticks (not really used)
        next_tick_at: current_time + TimeDuration::from_micros(1_000_000),
    };
    
    match ctx.db.active_consumable_effect().try_insert(cozy_effect) {
        Ok(inserted_effect) => {
            log::info!("Applied permanent cozy effect {} to player {:?}", inserted_effect.effect_id, player_id);
            Ok(())
        }
        Err(e) => {
            log::error!("Failed to apply cozy effect to player {:?}: {:?}", player_id, e);
            Err("Failed to apply cozy effect".to_string())
        }
    }
}

/// Removes cozy effect from a player
fn remove_cozy_effect(ctx: &ReducerContext, player_id: Identity) {
    let mut effects_to_remove = Vec::new();
    for effect in ctx.db.active_consumable_effect().iter() {
        if effect.player_id == player_id && effect.effect_type == EffectType::Cozy {
            effects_to_remove.push(effect.effect_id);
        }
    }
    
    for effect_id in effects_to_remove {
        ctx.db.active_consumable_effect().effect_id().delete(&effect_id);
        log::info!("Removed cozy effect {} from player {:?}", effect_id, player_id);
    }
}

/// Checks if a player currently has the cozy effect active
pub fn player_has_cozy_effect(ctx: &ReducerContext, player_id: Identity) -> bool {
    ctx.db.active_consumable_effect().iter()
        .any(|effect| effect.player_id == player_id && effect.effect_type == EffectType::Cozy)
}

// Tree Cover Effect Management
// ============================

/// Checks if a player should have the tree cover effect based on their proximity to trees
pub fn should_player_have_tree_cover(ctx: &ReducerContext, player_x: f32, player_y: f32) -> bool {
    const TREE_COVER_DISTANCE_SQ: f32 = 150.0 * 150.0; // 150px protection radius
    
    for tree in ctx.db.tree().iter() {
        // Skip destroyed trees (respawn_at is set when tree is harvested)
        if tree.respawn_at.is_some() {
            continue;
        }
        
        // Calculate distance squared between player and tree
        let dx = player_x - tree.pos_x;
        let dy = player_y - tree.pos_y;
        let distance_sq = dx * dx + dy * dy;
        
        // Check if player is within tree cover distance
        if distance_sq <= TREE_COVER_DISTANCE_SQ {
            return true;
        }
    }
    
    false
}

/// Applies or removes tree cover effect based on player's current position
pub fn update_player_tree_cover_status(ctx: &ReducerContext, player_id: Identity, player_x: f32, player_y: f32) -> Result<(), String> {
    let should_have_tree_cover = should_player_have_tree_cover(ctx, player_x, player_y);
    let has_tree_cover_effect = player_has_tree_cover_effect(ctx, player_id);
    
    log::debug!("Tree cover status check for player {:?}: should_have={}, has_effect={}", 
        player_id, should_have_tree_cover, has_tree_cover_effect);
    
    if should_have_tree_cover && !has_tree_cover_effect {
        // Apply tree cover effect
        log::info!("Applying tree cover effect to player {:?}", player_id);
        apply_tree_cover_effect(ctx, player_id)?;
    } else if !should_have_tree_cover && has_tree_cover_effect {
        // Remove tree cover effect
        log::info!("Removing tree cover effect from player {:?}", player_id);
        remove_tree_cover_effect(ctx, player_id);
    }
    
    Ok(())
}

/// Applies a tree cover effect to a player
fn apply_tree_cover_effect(ctx: &ReducerContext, player_id: Identity) -> Result<(), String> {
    let current_time = ctx.timestamp;
    // Set a very far future time (1 year from now) - effectively permanent
    let very_far_future = current_time + TimeDuration::from_micros(365 * 24 * 60 * 60 * 1_000_000i64);
    
    let tree_cover_effect = ActiveConsumableEffect {
        effect_id: 0, // auto_inc
        player_id,
        target_player_id: None,
        item_def_id: 0, // Not from an item
        consuming_item_instance_id: None,
        started_at: current_time,
        ends_at: very_far_future, // Effectively permanent
        total_amount: None, // No accumulation for tree cover effect
        amount_applied_so_far: None,
        effect_type: EffectType::TreeCover,
        tick_interval_micros: 1_000_000, // 1 second ticks (not really used)
        next_tick_at: current_time + TimeDuration::from_micros(1_000_000),
    };
    
    match ctx.db.active_consumable_effect().try_insert(tree_cover_effect) {
        Ok(inserted_effect) => {
            log::info!("Applied tree cover effect {} to player {:?}", inserted_effect.effect_id, player_id);
            Ok(())
        }
        Err(e) => {
            log::error!("Failed to apply tree cover effect to player {:?}: {:?}", player_id, e);
            Err("Failed to apply tree cover effect".to_string())
        }
    }
}

/// Removes tree cover effect from a player
fn remove_tree_cover_effect(ctx: &ReducerContext, player_id: Identity) {
    let mut effects_to_remove = Vec::new();
    for effect in ctx.db.active_consumable_effect().iter() {
        if effect.player_id == player_id && effect.effect_type == EffectType::TreeCover {
            effects_to_remove.push(effect.effect_id);
        }
    }
    
    for effect_id in effects_to_remove {
        ctx.db.active_consumable_effect().effect_id().delete(&effect_id);
        log::info!("Removed tree cover effect {} from player {:?}", effect_id, player_id);
    }
}

/// Checks if a player currently has the wet effect active
pub fn player_has_wet_effect(ctx: &ReducerContext, player_id: Identity) -> bool {
    ctx.db.active_consumable_effect().iter()
        .any(|effect| effect.player_id == player_id && effect.effect_type == EffectType::Wet)
}

/// Checks if a player currently has the tree cover effect active
pub fn player_has_tree_cover_effect(ctx: &ReducerContext, player_id: Identity) -> bool {
    ctx.db.active_consumable_effect().iter()
        .any(|effect| effect.player_id == player_id && effect.effect_type == EffectType::TreeCover)
}

/// Extinguishes burn effects for a player due to water or rain
/// Returns the number of burn effects that were extinguished
pub fn extinguish_burn_effects(ctx: &ReducerContext, player_id: Identity, reason: &str) -> u32 {
    let mut extinguished_count = 0;
    
    // Find all burn effects for this player
    let burn_effects_to_remove: Vec<_> = ctx.db.active_consumable_effect().iter()
        .filter(|effect| effect.player_id == player_id && effect.effect_type == EffectType::Burn)
        .collect();
    
    // Remove each burn effect
    for effect in burn_effects_to_remove {
        ctx.db.active_consumable_effect().effect_id().delete(&effect.effect_id);
        extinguished_count += 1;
        log::info!("Extinguished burn effect {} for player {:?} due to {}", 
                  effect.effect_id, player_id, reason);
    }
    
    if extinguished_count > 0 {
        log::info!("Extinguished {} burn effects for player {:?} due to {}", 
                  extinguished_count, player_id, reason);
    }
    
    extinguished_count
}

/// Checks if it's currently raining heavily enough to extinguish fires
fn is_heavy_raining_for_extinguishing(ctx: &ReducerContext) -> bool {
    if let Some(world_state) = ctx.db.world_state().iter().next() {
        if world_state.rain_intensity <= 0.0 {
            return false;
        }
        
        // Check the weather type if available, otherwise fall back to intensity threshold
        match &world_state.current_weather {
            crate::world_state::WeatherType::HeavyRain => true,
            crate::world_state::WeatherType::HeavyStorm => true,
            _ => {
                // For other weather types, fallback to intensity threshold (>= 0.8 is heavy rain/storm range)
                world_state.rain_intensity >= 0.8
            }
        }
    } else {
        false
    }
}

/// Checks for environmental conditions that should extinguish burn effects
/// Should be called periodically for all players with burn effects
pub fn check_and_extinguish_burns_from_environment(ctx: &ReducerContext) -> Result<(), String> {
    // Get all players who currently have burn effects
    let players_with_burns: Vec<Identity> = ctx.db.active_consumable_effect().iter()
        .filter(|effect| effect.effect_type == EffectType::Burn)
        .map(|effect| effect.player_id)
        .collect::<std::collections::HashSet<_>>() // Remove duplicates
        .into_iter()
        .collect();
    
    if players_with_burns.is_empty() {
        return Ok(()); // No players with burns, nothing to check
    }
    
    // Check if it's raining heavily
    let is_heavy_rain = is_heavy_raining_for_extinguishing(ctx);
    
    // Check each player with burn effects
    for player_id in players_with_burns {
        // Find the player to get their position
        if let Some(player) = ctx.db.player().identity().find(&player_id) {
            let mut should_extinguish = false;
            let mut extinguish_reason = String::new();
            
            // Check if player is standing on water
            if crate::is_player_on_water(ctx, player.position_x, player.position_y) {
                should_extinguish = true;
                extinguish_reason = "standing in water".to_string();
            }
            // Check if it's raining heavily and player is not protected
            else if is_heavy_rain && !is_player_protected_from_rain(ctx, &player) {
                should_extinguish = true;
                extinguish_reason = "heavy rain".to_string();
            }
            
            // Extinguish burn effects if conditions are met
            if should_extinguish {
                extinguish_burn_effects(ctx, player_id, &extinguish_reason);
            }
        }
    }
    
    Ok(())
}

/// Checks if a player is protected from rain (inside shelter or near trees)
fn is_player_protected_from_rain(ctx: &ReducerContext, player: &crate::Player) -> bool {
    // Check if player is inside any shelter
    for shelter in ctx.db.shelter().iter() {
        if shelter.is_destroyed {
            continue;
        }
        
        // Use the same shelter collision detection logic as in shelter.rs
        let shelter_aabb_center_x = shelter.pos_x;
        let shelter_aabb_center_y = shelter.pos_y - crate::shelter::SHELTER_AABB_CENTER_Y_OFFSET_FROM_POS_Y;
        let aabb_left = shelter_aabb_center_x - crate::shelter::SHELTER_AABB_HALF_WIDTH;
        let aabb_right = shelter_aabb_center_x + crate::shelter::SHELTER_AABB_HALF_WIDTH;
        let aabb_top = shelter_aabb_center_y - crate::shelter::SHELTER_AABB_HALF_HEIGHT;
        let aabb_bottom = shelter_aabb_center_y + crate::shelter::SHELTER_AABB_HALF_HEIGHT;
        
        // Check if player position is inside shelter AABB
        if player.position_x >= aabb_left && player.position_x <= aabb_right &&
           player.position_y >= aabb_top && player.position_y <= aabb_bottom {
            return true;
        }
    }
    
    // Check if player is within 100px of any tree (protected by tree cover)
    const TREE_PROTECTION_DISTANCE_SQ: f32 = 100.0 * 100.0; // 100px protection radius
    
    for tree in ctx.db.tree().iter() {
        // Skip destroyed trees (respawn_at is set when tree is harvested)
        if tree.respawn_at.is_some() {
            continue;
        }
        
        // Calculate distance squared between player and tree
        let dx = player.position_x - tree.pos_x;
        let dy = player.position_y - tree.pos_y;
        let distance_sq = dx * dx + dy * dy;
        
        // Check if player is within protection distance of this tree
        if distance_sq <= TREE_PROTECTION_DISTANCE_SQ {
            return true;
        }
    }
    
    false
}

/// Applies or extends a burn effect on a player
/// This creates a proper damage-over-time effect that continues burning even after leaving the source
pub fn apply_water_drinking_effect(
    ctx: &ReducerContext,
    player_id: Identity,
    item_def_id: u64,
    duration_seconds: f32
) -> Result<(), String> {
    let duration_micros = (duration_seconds * 1_000_000.0) as i64;
    let tick_interval_micros = 1_000_000i64; // 1 second (doesn't matter much since it's visual only)
    
    let effect = ActiveConsumableEffect {
        effect_id: 0, // auto_inc
        player_id,
        target_player_id: None,
        item_def_id,
        consuming_item_instance_id: None,
        started_at: ctx.timestamp,
        ends_at: Timestamp::from_micros_since_unix_epoch(
            ctx.timestamp.to_micros_since_unix_epoch() + duration_micros
        ),
        total_amount: None, // Visual effect only
        amount_applied_so_far: None,
        effect_type: EffectType::WaterDrinking,
        tick_interval_micros: tick_interval_micros as u64,
        next_tick_at: Timestamp::from_micros_since_unix_epoch(
            ctx.timestamp.to_micros_since_unix_epoch() + tick_interval_micros
        ),
    };
    
    ctx.db.active_consumable_effect().insert(effect);
    log::info!("[WaterDrinking] Applied water drinking visual effect for player {:?}, duration: {:.2}s", player_id, duration_seconds);
    Ok(())
}

/// Applies a venom effect to a player (damage over time from Cable Viper)
pub fn apply_venom_effect(
    ctx: &ReducerContext,
    player_id: Identity,
    total_damage: f32,
    duration_seconds: f32,
    tick_interval_seconds: f32,
) -> Result<(), String> {
    let current_time = ctx.timestamp;
    
    // Check if player already has a venom effect - if so, stack it
    let existing_venom_effects: Vec<_> = ctx.db.active_consumable_effect().iter()
        .filter(|e| e.player_id == player_id && e.effect_type == EffectType::Venom)
        .collect();

    if !existing_venom_effects.is_empty() {
        // Stack venom effect by extending duration and adding damage
        for existing_effect in existing_venom_effects {
            let mut updated_effect = existing_effect.clone();
            let duration_to_add = TimeDuration::from_micros((duration_seconds * 1_000_000.0) as i64);
            updated_effect.ends_at = updated_effect.ends_at + duration_to_add;
            let new_total_damage = updated_effect.total_amount.unwrap_or(0.0) + total_damage;
            updated_effect.total_amount = Some(new_total_damage);
            
            ctx.db.active_consumable_effect().effect_id().update(updated_effect);
            log::info!("Stacked venom effect {} for player {:?}: added {:.1}s duration, total damage now {:.1}", 
                existing_effect.effect_id, player_id, duration_seconds, new_total_damage);
            return Ok(());
        }
    }
    
    // Create new venom effect
    let duration_micros = (duration_seconds * 1_000_000.0) as i64;
    let tick_interval_micros = (tick_interval_seconds * 1_000_000.0) as u64;
    
    let venom_effect = ActiveConsumableEffect {
        effect_id: 0, // auto_inc
        player_id,
        target_player_id: None,
        item_def_id: 0, // Not from an item, from creature
        consuming_item_instance_id: None,
        started_at: current_time,
        ends_at: current_time + TimeDuration::from_micros(duration_micros),
        total_amount: Some(total_damage),
        amount_applied_so_far: Some(0.0),
        effect_type: EffectType::Venom,
        tick_interval_micros,
        next_tick_at: current_time + TimeDuration::from_micros(tick_interval_micros as i64),
    };

    match ctx.db.active_consumable_effect().try_insert(venom_effect) {
        Ok(inserted_effect) => {
            log::info!("Applied venom effect {} to player {:?}: {:.1} damage over {:.1}s (every {:.1}s)", 
                inserted_effect.effect_id, player_id, total_damage, duration_seconds, tick_interval_seconds);
            Ok(())
        }
        Err(e) => {
            log::error!("Failed to apply venom effect to player {:?}: {:?}", player_id, e);
            Err("Failed to apply venom effect".to_string())
        }
    }
}

/// Applies a bleeding effect to a player (damage over time from wolf attacks)
pub fn apply_bleeding_effect(
    ctx: &ReducerContext,
    player_id: Identity,
    total_damage: f32,
    duration_seconds: f32,
    tick_interval_seconds: f32,
) -> Result<(), String> {
    let current_time = ctx.timestamp;
    
    // Check if player already has a bleeding effect - if so, stack it
    let existing_bleed_effects: Vec<_> = ctx.db.active_consumable_effect().iter()
        .filter(|e| e.player_id == player_id && e.effect_type == EffectType::Bleed)
        .collect();

    if !existing_bleed_effects.is_empty() {
        // Stack bleeding effect by extending duration and adding damage
        for existing_effect in existing_bleed_effects {
            let mut updated_effect = existing_effect.clone();
            let duration_to_add = TimeDuration::from_micros((duration_seconds * 1_000_000.0) as i64);
            updated_effect.ends_at = updated_effect.ends_at + duration_to_add;
            let new_total_damage = updated_effect.total_amount.unwrap_or(0.0) + total_damage;
            updated_effect.total_amount = Some(new_total_damage);
            
            ctx.db.active_consumable_effect().effect_id().update(updated_effect);
            log::info!("Stacked bleeding effect {} for player {:?}: added {:.1}s duration, total damage now {:.1}", 
                existing_effect.effect_id, player_id, duration_seconds, new_total_damage);
            return Ok(());
        }
    }
    
    // Create new bleeding effect
    let duration_micros = (duration_seconds * 1_000_000.0) as i64;
    let tick_interval_micros = (tick_interval_seconds * 1_000_000.0) as u64;
    
    let bleed_effect = ActiveConsumableEffect {
        effect_id: 0, // auto_inc
        player_id,
        target_player_id: None,
        item_def_id: 0, // Not from an item, from creature
        consuming_item_instance_id: None,
        started_at: current_time,
        ends_at: current_time + TimeDuration::from_micros(duration_micros),
        total_amount: Some(total_damage),
        amount_applied_so_far: Some(0.0),
        effect_type: EffectType::Bleed,
        tick_interval_micros,
        next_tick_at: current_time + TimeDuration::from_micros(tick_interval_micros as i64),
    };

    match ctx.db.active_consumable_effect().try_insert(bleed_effect) {
        Ok(inserted_effect) => {
            log::info!("Applied bleeding effect {} to player {:?}: {:.1} damage over {:.1}s (every {:.1}s)", 
                inserted_effect.effect_id, player_id, total_damage, duration_seconds, tick_interval_seconds);
            Ok(())
        }
        Err(e) => {
            log::error!("Failed to apply bleeding effect to player {:?}: {:?}", player_id, e);
            Err("Failed to apply bleeding effect".to_string())
        }
    }
}

pub fn apply_burn_effect(
    ctx: &ReducerContext, 
    player_id: Identity, 
    total_damage: f32, 
    duration_seconds: f32, 
    tick_interval_seconds: f32,
    source_item_def_id: u64 // 0 for environmental sources like campfires
) -> Result<(), String> {
    let current_time = ctx.timestamp;
    
    // Check if player already has a burn effect from the same source type
    let existing_burn_effects: Vec<_> = ctx.db.active_consumable_effect().iter()
        .filter(|e| e.player_id == player_id && 
                   e.effect_type == EffectType::Burn && 
                   e.item_def_id == source_item_def_id)
        .collect();

    if !existing_burn_effects.is_empty() {
        // Stack burn effect by adding duration to existing end time
        for existing_effect in existing_burn_effects {
            let mut updated_effect = existing_effect.clone();
            // Stack by adding the full duration to the existing end time (true stacking behavior)
            let duration_to_add = TimeDuration::from_micros((duration_seconds * 1_000_000.0) as i64);
            let new_end_time = updated_effect.ends_at + duration_to_add;
            
            // Always stack - add the full damage and duration
            updated_effect.ends_at = new_end_time;
            let new_total_damage = updated_effect.total_amount.unwrap_or(0.0) + total_damage;
            updated_effect.total_amount = Some(new_total_damage);
            
            let total_duration_seconds = (new_end_time.to_micros_since_unix_epoch() - current_time.to_micros_since_unix_epoch()) as f32 / 1_000_000.0;
            
            ctx.db.active_consumable_effect().effect_id().update(updated_effect);
            
            log::info!("Stacked burn effect {} for player {:?}: added {:.1}s duration, total now {:.1}s (total damage: {:.1})", 
                existing_effect.effect_id, player_id, duration_seconds, total_duration_seconds, new_total_damage);
            return Ok(());
        }
        // This should never be reached since we checked !existing_burn_effects.is_empty()
        Ok(())
    } else {
        // Create new burn effect
        let duration_micros = (duration_seconds * 1_000_000.0) as i64;
        let tick_interval_micros = (tick_interval_seconds * 1_000_000.0) as u64;
        
        let burn_effect = ActiveConsumableEffect {
            effect_id: 0, // auto_inc
            player_id,
            target_player_id: None,
            item_def_id: source_item_def_id,
            consuming_item_instance_id: None,
            started_at: current_time,
            ends_at: current_time + TimeDuration::from_micros(duration_micros),
            total_amount: Some(total_damage),
            amount_applied_so_far: Some(0.0),
            effect_type: EffectType::Burn,
            tick_interval_micros,
            next_tick_at: current_time + TimeDuration::from_micros(tick_interval_micros as i64),
        };

        match ctx.db.active_consumable_effect().try_insert(burn_effect) {
            Ok(inserted_effect) => {
                log::info!("Applied new burn effect {} to player {:?}: {:.1} damage over {:.1}s (every {:.1}s)", 
                    inserted_effect.effect_id, player_id, total_damage, duration_seconds, tick_interval_seconds);
                Ok(())
            }
            Err(e) => {
                log::error!("Failed to apply burn effect to player {:?}: {:?}", player_id, e);
                Err("Failed to apply burn effect".to_string())
            }
        }
    }
}

/// Cancels all active venom effects for a player (used when Anti-Venom is consumed)
pub fn cancel_venom_effects(ctx: &ReducerContext, player_id: Identity) {
    let effects_to_cancel: Vec<_> = ctx.db.active_consumable_effect().iter()
        .filter(|e| e.player_id == player_id && e.effect_type == EffectType::Venom)
        .collect();

    for effect in effects_to_cancel {
        ctx.db.active_consumable_effect().effect_id().delete(&effect.effect_id);
        log::info!("Cancelled venom effect {} for player {:?} (Anti-Venom consumed)", effect.effect_id, player_id);
    }
}

/// Clear all active effects for a player who has died
/// This includes all damage-over-time effects, healing effects, and status effects
pub fn clear_all_effects_on_death(ctx: &ReducerContext, player_id: Identity) {
    log::info!("[PlayerDeath] Clearing all active effects for deceased player {:?}", player_id);
    
    // Clear all damage-over-time effects
    cancel_bleed_effects(ctx, player_id);
    cancel_venom_effects(ctx, player_id);
    
    // Clear all healing effects  
    cancel_health_regen_effects(ctx, player_id);
    cancel_bandage_burst_effects(ctx, player_id);
    
    // Clear any other effects (burn, food poisoning, seawater poisoning, wet, etc.)
    let mut effects_to_remove = Vec::new();
    for effect in ctx.db.active_consumable_effect().iter() {
        if effect.player_id == player_id {
            effects_to_remove.push(effect.effect_id);
            log::debug!("[PlayerDeath] Removing {:?} effect {} for deceased player {:?}", 
                effect.effect_type, effect.effect_id, player_id);
        }
    }
    
    // Remove all found effects
    for effect_id in effects_to_remove {
        ctx.db.active_consumable_effect().effect_id().delete(&effect_id);
    }
    
    log::info!("[PlayerDeath] Cleared all active effects for deceased player {:?}", player_id);
}