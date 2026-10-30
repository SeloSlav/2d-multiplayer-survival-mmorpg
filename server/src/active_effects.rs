use spacetimedb::{table, Identity, Timestamp, ReducerContext, Table, ScheduleAt, TimeDuration, SpacetimeType};
// use crate::player::{Player, player as PlayerTableTrait}; // Old import
use crate::Player; // For the struct
use crate::player; // For the table trait
use crate::items::{ItemDefinition, item_definition as ItemDefinitionTableTrait}; // To check item properties
use crate::items::{InventoryItem, inventory_item as InventoryItemTableTrait}; // Added for item consumption
use crate::active_equipment::active_equipment as ActiveEquipmentTableTrait;
use crate::consumables::{MAX_HEALTH_VALUE, MAX_THIRST_VALUE, MIN_STAT_VALUE}; // Import constants from consumables
use rand::Rng; // For random number generation
use log;
use std::collections::HashMap;

// Import table traits for burn extinguishing functionality
use crate::world_state::world_state as WorldStateTableTrait;
use crate::shelter::shelter as ShelterTableTrait;
use crate::tree::tree as TreeTableTrait;

// Import sound system for throwing up sound when poisoned and chewing gum
use crate::sound_events::{emit_throwing_up_sound, start_chewing_gum_sound, stop_chewing_gum_sound, update_chewing_gum_sound_position};

// Import armor module for immunity checks
use crate::armor;
use crate::models::ImmunityType;

#[table(accessor = active_consumable_effect, public)] // public for client UI if needed
#[derive(Clone, Debug)]
pub struct ActiveConsumableEffect {
    #[primary_key]
    #[auto_inc]
    pub effect_id: u64,
    #[index(btree)] // PERF FIX: Index for O(log N) lookups instead of O(N) full table scans per player
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
    Exhausted, // Movement speed penalty from low hunger/thirst/warmth
    BuildingPrivilege, // Allows building structures near homestead hearths
    ProductionRune, // Near a red production rune stone (2x crafting speed)
    AgrarianRune, // Near a green agrarian rune stone (2x plant growth)
    MemoryRune, // Near a blue memory rune stone (spawns memory shards at night)
    HotSpring, // Healing effect from standing in a hot spring
    Fumarole, // Warmth protection from standing near a fumarole (nullifies warmth decay)
    SafeZone, // Protection from player/animal/projectile damage when near ALK monuments (shield emoji)
    FishingVillageBonus, // 2x fishing hauls and premium tier bonus when near fishing village (fish+village emoji)
    NearCookingStation, // Near a cooking station - enables advanced food recipe crafting (chef hat emoji)
    
    // === BREWING SYSTEM EFFECTS - 1 hour buffs that don't persist through death ===
    Intoxicated,       // Drunk effect from alcoholic brews - blurred vision, movement wobble (1 hour)
    Poisoned,          // Poison DOT from brews/coated weapons (distinct from Venom which is animal-based)
    SpeedBoost,        // Movement speed increase from performance enhancer brews (1 hour)
    StaminaBoost,      // Reduced hunger/thirst drain from performance enhancer brews (1 hour)
    NightVision,       // Enhanced vision at night from psychoactive brews (1 hour)
    WarmthBoost,       // Warmth decay reduction from warming broths (1 hour)
    ColdResistance,    // Reduced cold damage from specialty brews (1 hour)
    PoisonResistance,  // Reduced poison/venom damage from antidote brews (1 hour)
    FireResistance,    // Reduced fire/burn damage from fire-resistant brews (1 hour)
    
    // === ADDITIONAL BROTH EFFECTS ===
    PoisonCoating,     // Poison weapon coating - all attacks inflict poison for X seconds (1 hour)
    PassiveHealthRegen, // Slow passive health regeneration over time (1 hour, distinct from instant HealthRegen)
    HarvestBoost,      // Mining/chopping efficacy bonus - extra yield per hit (1 hour)
    
    // === INSANITY SYSTEM EFFECTS ===
    Entrainment,       // Permanent debuff from max insanity - slow damage until death (cannot be removed)
    ValidolProtection, // Temporary protection from Entrainment damage (2-5 minutes from Validol Tablets)
    
    // === BREW CONSUMPTION COOLDOWN ===
    BrewCooldown,      // 60-second cooldown after consuming any broth pot brew (prevents spam)
    
    // === STUN EFFECT (from blunt weapons) ===
    Stun,              // Immobilizes player completely for a short duration (from blunt/crushing weapons)
    
    // === SHIPWRECK PROTECTION EFFECT ===
    LagunovGhost,      // Protected by Admiral Lagunov's ghost spirit near shipwreck (hostile NPCs avoid this area)
    
    // === MEMORY BEACON EFFECT ===
    MemoryBeaconSanity, // Inside Memory Beacon sanity zone - insanity is cleared and cannot accumulate (display only)

    // === COMBAT LADLE HEATING ===
    HotCombatLadle, // Hot combat ladle equipped: burn on hit, 2x wildlife (30 min). Gloves prevent self-burn.

    // === CHEWING GUM ===
    ChewingGum, // Continuous chewing sound from player position (2 min per gum, stacks on consume)
}

// Table defining food poisoning risks for different food items
#[table(accessor = food_poisoning_risk, public)]
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
#[table(accessor = process_effects_schedule, scheduled(process_active_consumable_effects_tick))]
pub struct ProcessEffectsSchedule {
    #[primary_key]
    #[auto_inc]
    pub job_id: u64,
    pub job_name: String,
    pub scheduled_at: ScheduleAt,
}

/// Hot combat ladle self-burn: without gloves, holding a hot ladle burns the player.
/// The "hot" state lives on the item (item_data.is_hot), not as a timed player effect.
/// Combat bonuses (2x wildlife, burn on hit) are checked directly from the equipped item.
const HOT_LADLE_SELF_BURN_DAMAGE: f32 = 2.0;
const HOT_LADLE_SELF_BURN_DURATION_SECS: f32 = 3.0;
const HOT_LADLE_SELF_BURN_TICK_INTERVAL: f32 = 2.0;

fn clear_active_equipment_if_consumed_item(
    ctx: &ReducerContext,
    player_id: Identity,
    item_instance_id: u64,
    effect_type: &EffectType,
) {
    let active_equipments = ctx.db.active_equipment();
    let Some(mut equipment) = active_equipments.player_identity().find(&player_id) else {
        return;
    };

    if equipment.equipped_item_instance_id != Some(item_instance_id) {
        return;
    }

    equipment.equipped_item_def_id = None;
    equipment.equipped_item_instance_id = None;
    equipment.swing_start_time_ms = 0;
    equipment.icon_asset_name = None;
    equipment.loaded_ammo_def_id = None;
    equipment.loaded_ammo_count = 0;
    equipment.is_ready_to_fire = false;
    active_equipments.player_identity().update(equipment);

    log::info!(
        "[ItemConsumption] Cleared active equipment for player {:?}: consumed held item {} after {:?}.",
        player_id,
        item_instance_id,
        effect_type
    );
}

fn process_hot_combat_ladle_self_burn(ctx: &ReducerContext) {
    use crate::combat_ladle_heating::{is_combat_ladle, is_combat_ladle_hot_at, check_and_expire_hot_ladle};

    let active_equipments = ctx.db.active_equipment();
    let inventory_items = ctx.db.inventory_item();
    let item_defs = ctx.db.item_definition();
    let current_micros = ctx.timestamp.to_micros_since_unix_epoch();

    for player in ctx.db.player().iter() {
        if player.is_dead || !player.is_online {
            continue;
        }

        let equipment = match active_equipments.player_identity().find(&player.identity) {
            Some(eq) => eq,
            None => continue,
        };

        let equipped_instance_id = match equipment.equipped_item_instance_id {
            Some(id) => id,
            None => continue,
        };

        let equipped_item = match inventory_items.instance_id().find(equipped_instance_id) {
            Some(item) => item,
            None => continue,
        };

        let item_def = match item_defs.id().find(equipped_item.item_def_id) {
            Some(def) => def,
            None => continue,
        };

        if !is_combat_ladle(&item_def.name) {
            continue;
        }

        // Check with time-based expiration
        if !is_combat_ladle_hot_at(&equipped_item, current_micros) {
            // Expire if needed
            check_and_expire_hot_ladle(ctx, &equipped_item);
            continue;
        }

        let has_gloves = equipment.hands_item_instance_id.is_some();

        // Without gloves: player takes burn damage from holding the hot ladle
        if !has_gloves {
            // Only apply burn if player doesn't already have active burn from hot ladle (avoid stacking every tick)
            let has_existing_burn = ctx.db.active_consumable_effect().player_id().filter(&player.identity)
                .any(|e| e.effect_type == EffectType::Burn && e.item_def_id == item_def.id && ctx.timestamp < e.ends_at);
            if !has_existing_burn {
                if let Err(e) = apply_burn_effect(
                    ctx,
                    player.identity,
                    HOT_LADLE_SELF_BURN_DAMAGE,
                    HOT_LADLE_SELF_BURN_DURATION_SECS,
                    HOT_LADLE_SELF_BURN_TICK_INTERVAL,
                    item_def.id,
                ) {
                    log::error!("[HotCombatLadle] Failed to apply self-burn to player {:?}: {}", player.identity, e);
                }
            }
        }
    }
}

/// Updates indoor status for all online players
/// This runs every tick regardless of active effects to ensure the is_inside_building flag
/// is properly set/cleared when entering/leaving shelters, buildings, and shipwreck zones
fn update_all_players_indoor_status(ctx: &ReducerContext) {
    for mut player in ctx.db.player().iter().filter(|p| p.is_online && !p.is_dead) {
        let indoors = crate::indoors::is_position_indoors(ctx, player.position_x, player.position_y);
        if player.is_inside_building != indoors {
            player.is_inside_building = indoors;
            ctx.db.player().identity().update(player);
        }
    }
}

pub fn schedule_effect_processing(ctx: &ReducerContext) -> Result<(), String> {
    if ctx.db.process_effects_schedule().iter().find(|job| job.job_name == "process_consumable_effects").is_none() {
        crate::try_insert_schedule!(
            ctx.db.process_effects_schedule(),
            ProcessEffectsSchedule {
                job_id: 0,
                job_name: "process_consumable_effects".to_string(),
                scheduled_at: ScheduleAt::Interval(TimeDuration::from_micros(1_000_000)),
            },
            "Active consumable effect processing"
        );
    }
    Ok(())
}

#[spacetimedb::reducer]
pub fn process_active_consumable_effects_tick(ctx: &ReducerContext, _args: ProcessEffectsSchedule) -> Result<(), String> {
    if ctx.sender() != ctx.identity() {
        return Err("process_active_consumable_effects_tick can only be called by the scheduler.".to_string());
    }

    // Update indoor status only when players are online (needed for hostile AI, player stats warmth)
    // Skip when empty to avoid expensive shelter/building checks
    if ctx.db.player().iter().any(|p| p.is_online) {
        update_all_players_indoor_status(ctx);
    }

    // Process hot combat ladle: apply self-burn if holding hot ladle without gloves
    process_hot_combat_ladle_self_burn(ctx);

    // PERFORMANCE: Quick exit if no active effects exist (most common case when idle)
    if ctx.db.active_consumable_effect().iter().next().is_none() {
        return Ok(());
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

    // Skip cozy, tree cover, exhausted, building privilege, rune stone effects, hot spring, fumarole, safe zone, fishing village bonus, and Lagunov's Ghost - they are managed by other systems, not the effect tick system
    // These effects are permanent until removed by other systems, so skip them entirely
    if effect.effect_type == EffectType::Cozy || effect.effect_type == EffectType::TreeCover || effect.effect_type == EffectType::Exhausted || effect.effect_type == EffectType::BuildingPrivilege || effect.effect_type == EffectType::ProductionRune || effect.effect_type == EffectType::AgrarianRune || effect.effect_type == EffectType::MemoryRune || effect.effect_type == EffectType::HotSpring || effect.effect_type == EffectType::Fumarole || effect.effect_type == EffectType::SafeZone || effect.effect_type == EffectType::FishingVillageBonus || effect.effect_type == EffectType::NearCookingStation || effect.effect_type == EffectType::LagunovGhost || effect.effect_type == EffectType::MemoryBeaconSanity {
        continue;
    }
    
    // Stub brewing effects (Intoxicated, Poisoned, SpeedBoost, etc.) need to be checked for expiration
    // but don't need per-tick processing - they'll be handled in the time-based expiration check below

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

        // --- Handle ChewingGum (continuous sound, position update, expiration) ---
        if effect.effect_type == EffectType::ChewingGum {
            if current_time >= effect.ends_at {
                effect_ended = true;
            } else {
                update_chewing_gum_sound_position(ctx, effect.effect_id, player_to_update.position_x, player_to_update.position_y);
                let mut updated = effect.clone();
                updated.next_tick_at = current_time + TimeDuration::from_micros(effect.tick_interval_micros as i64);
                ctx.db.active_consumable_effect().effect_id().update(updated);
                continue; // Skip rest of loop - effect updated
            }
        }

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
                    EffectType::HealthRegen | EffectType::Burn | EffectType::Bleed | EffectType::Venom | EffectType::SeawaterPoisoning | EffectType::FoodPoisoning | EffectType::Cozy | EffectType::Wet | EffectType::TreeCover | EffectType::WaterDrinking | EffectType::Exhausted | EffectType::BuildingPrivilege | EffectType::ProductionRune | EffectType::AgrarianRune | EffectType::MemoryRune | EffectType::HotSpring | EffectType::Fumarole | EffectType::SafeZone | EffectType::FishingVillageBonus | EffectType::NearCookingStation | EffectType::Intoxicated | EffectType::Poisoned | EffectType::SpeedBoost | EffectType::StaminaBoost | EffectType::NightVision | EffectType::WarmthBoost | EffectType::ColdResistance | EffectType::PoisonResistance | EffectType::FireResistance | EffectType::PoisonCoating | EffectType::PassiveHealthRegen | EffectType::HarvestBoost | EffectType::Entrainment | EffectType::ValidolProtection | EffectType::BrewCooldown | EffectType::Stun | EffectType::LagunovGhost | EffectType::MemoryBeaconSanity | EffectType::HotCombatLadle | EffectType::ChewingGum => {
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
                            const HEALING_RANGE: f32 = crate::shared_config::REMOTE_HEALING_RANGE_PX;
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
        // Wet, WaterDrinking, and broth buff effects don't need per-tick processing (except PassiveHealthRegen)
        // Broth buff effects (Intoxicated, SpeedBoost, etc.) are time-based flags only
        // BrewCooldown is also a time-based flag that just prevents consuming another brew
        let is_broth_buff_effect = matches!(effect.effect_type, 
            EffectType::Intoxicated | EffectType::SpeedBoost | 
            EffectType::StaminaBoost | EffectType::NightVision | EffectType::WarmthBoost | 
            EffectType::ColdResistance | EffectType::PoisonResistance | EffectType::FireResistance |
            EffectType::PoisonCoating | EffectType::HarvestBoost | EffectType::BrewCooldown);
        
        if effect.effect_type == EffectType::Wet || effect.effect_type == EffectType::WaterDrinking || effect.effect_type == EffectType::Stun || effect.effect_type == EffectType::ValidolProtection || is_broth_buff_effect {
            // These effects are purely time-based, no per-tick processing needed
            // They just exist until they expire or are removed
            // Check for time-based expiration (this was missing, causing effects to persist indefinitely!)
            if current_time >= effect.ends_at {
                effect_ended = true;
                log::debug!("[EffectTick] Time-based effect {} ({:?}) for player {:?} expired", 
                    effect.effect_id, effect.effect_type, effect.player_id);
            }
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
                        EffectType::Bleed | EffectType::Burn | EffectType::Venom | EffectType::Entrainment => {
                            log::trace!("[EffectTick] {:?} Pre-Damage for Player {:?}: Health {:.2}, AmountThisTick {:.2}",
                                effect.effect_type, effect.player_id, player_to_update.health, amount_this_tick);
                            
                            // --- SAFE ZONE CHECK - Players in safe zones are immune to burn damage ---
                            if effect.effect_type == EffectType::Burn && player_has_safe_zone_effect(ctx, effect.player_id) {
                                amount_this_tick = 0.0; // No burn damage applied in safe zones
                                log::info!("[EffectTick] Player {:?} is in a safe zone - burn damage blocked.",
                                    effect.player_id);
                            }
                            // --- END SAFE ZONE CHECK ---
                            
                            // --- KNOCKED OUT PLAYERS ARE IMMUNE TO BLEED, BURN, VENOM, AND ENTRAINMENT DAMAGE ---
                            if player_to_update.is_knocked_out && (effect.effect_type == EffectType::Bleed || effect.effect_type == EffectType::Burn || effect.effect_type == EffectType::Venom || effect.effect_type == EffectType::Entrainment) {
                                // Knocked out players are completely immune to DOT damage
                                amount_this_tick = 0.0; // No damage applied
                                log::info!("[EffectTick] Knocked out player {:?} is immune to {:?} damage. No damage applied.",
                                    effect.player_id, effect.effect_type);
                            } else if amount_this_tick > 0.0 {
                                // Only process damage if amount_this_tick is still > 0 (not blocked by safe zone)
                                // Special handling for Venom: fixed damage per tick like SeawaterPoisoning
                                if effect.effect_type == EffectType::Venom {
                                    amount_this_tick = 1.0; // Fixed 1 damage per tick for persistent venom
                                    
                                    // <<< BROTH EFFECT: PoisonResistance reduces venom damage by 75% >>>
                                    if player_has_poison_resistance_effect(ctx, effect.player_id) {
                                        let original_damage = amount_this_tick;
                                        amount_this_tick *= (1.0 - POISON_RESISTANCE_REDUCTION);
                                        log::info!(
                                            "Player {:?} has PoisonResistance broth - venom damage reduced by {:.0}%: {:.1} -> {:.1}",
                                            effect.player_id, POISON_RESISTANCE_REDUCTION * 100.0, original_damage, amount_this_tick
                                        );
                                    }
                                    // <<< END BROTH EFFECT >>>
                                }
                                
                                // Special handling for Entrainment: permanent debuff from max insanity (3x faster than venom)
                                if effect.effect_type == EffectType::Entrainment {
                                    // Check if player has ValidolProtection - pauses Entrainment damage
                                    if player_has_validol_protection(ctx, effect.player_id) {
                                        amount_this_tick = 0.0; // Validol pauses Entrainment damage
                                        log::info!("Player {:?} has ValidolProtection - Entrainment damage paused", effect.player_id);
                                    } else {
                                        amount_this_tick = 3.0; // Fixed 3 damage per tick (3x venom rate for urgency)
                                        // Entrainment cannot be reduced or removed - it's a permanent death sentence
                                        log::trace!("Player {:?} taking Entrainment damage: {:.1} HP", effect.player_id, amount_this_tick);
                                    }
                                }
                                
                                // <<< APPLY FIRE DAMAGE MULTIPLIER FOR BURN EFFECTS (WOODEN ARMOR VULNERABILITY) >>>
                                if effect.effect_type == EffectType::Burn {
                                    let fire_multiplier = armor::calculate_fire_damage_multiplier(ctx, effect.player_id);
                                    if fire_multiplier != 1.0 {
                                        let original_damage = amount_this_tick;
                                        amount_this_tick *= fire_multiplier;
                                        log::info!(
                                            "Player {:?} has fire damage multiplier {:.1}x (wooden armor). Burn damage: {:.1} -> {:.1}",
                                            effect.player_id, fire_multiplier, original_damage, amount_this_tick
                                        );
                                    }
                                    
                                    // <<< BROTH EFFECT: FireResistance reduces burn damage by 50% >>>
                                    if player_has_fire_resistance_effect(ctx, effect.player_id) {
                                        let original_damage = amount_this_tick;
                                        amount_this_tick *= FIRE_RESISTANCE_REDUCTION;
                                        log::info!(
                                            "Player {:?} has FireResistance broth - burn damage reduced by {:.0}%: {:.1} -> {:.1}",
                                            effect.player_id, (1.0 - FIRE_RESISTANCE_REDUCTION) * 100.0, original_damage, amount_this_tick
                                        );
                                    }
                                    // <<< END BROTH EFFECT >>>
                                }
                                // <<< END FIRE DAMAGE MULTIPLIER >>>
                                
                                // Normal damage application for conscious players
                                player_to_update.health = (player_to_update.health - amount_this_tick).clamp(MIN_STAT_VALUE, MAX_HEALTH_VALUE);
                                
                                // <<< BURN DAMAGE TRIGGERS LAST_HIT_TIME FOR VISUAL DAMAGE EFFECTS >>>
                                // Only burn damage should trigger visual damage feedback (red overlay, screenshake)
                                // NOT bleed, venom, or entrainment - burn is visceral "you're on fire!" feedback
                                // NOTE: Cold damage does NOT trigger this - it uses a separate damage system
                                if effect.effect_type == EffectType::Burn && amount_this_tick > 0.0 {
                                    player_to_update.last_hit_time = Some(current_time);
                                    log::info!("[BurnDamage] Setting last_hit_time for player {:?} - burn damage {:.1} dealt", 
                                        effect.player_id, amount_this_tick);
                                }
                                // <<< END BURN DAMAGE EFFECTS >>>
                            }
                            // --- END KNOCKED OUT IMMUNITY ---
                            
                            log::trace!("[EffectTick] {:?} Post-Damage for Player {:?}: Health now {:.2}",
                                effect.effect_type, effect.player_id, player_to_update.health);
                        }
                        EffectType::SeawaterPoisoning => {
                            log::trace!("[EffectTick] SeawaterPoisoning Pre-Thirst-Drain for Player {:?}: Thirst {:.2}, AmountThisTick {:.2}",
                                effect.player_id, player_to_update.thirst, amount_this_tick);
                            
                            // --- KNOCKED OUT PLAYERS ARE IMMUNE TO SEAWATER POISONING ---
                            if player_to_update.is_knocked_out {
                                // Knocked out players are completely immune to seawater poisoning thirst drain
                                amount_this_tick = 0.0; // No thirst drain applied
                                log::info!("[EffectTick] Knocked out player {:?} is immune to SeawaterPoisoning thirst drain. No drain applied.",
                                    effect.player_id);
                            } else {
                                // Seawater poisoning drains thirst over time instead of dealing health damage
                                // This creates a gradual dehydration effect that makes sense mechanically
                                amount_this_tick = 2.5; // Drain 2.5 thirst per tick (per second)
                                let old_thirst = player_to_update.thirst;
                                player_to_update.thirst = (player_to_update.thirst - amount_this_tick).clamp(MIN_STAT_VALUE, MAX_THIRST_VALUE);
                                log::debug!("[EffectTick] SeawaterPoisoning drained {:.1} thirst from player {:?} ({:.1} -> {:.1})",
                                    amount_this_tick, effect.player_id, old_thirst, player_to_update.thirst);
                            }
                            // --- END KNOCKED OUT IMMUNITY ---
                            
                            log::trace!("[EffectTick] SeawaterPoisoning Post-Thirst-Drain for Player {:?}: Thirst now {:.2}",
                                effect.player_id, player_to_update.thirst);
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
                        // === NEW BREWING SYSTEM EFFECTS (stub implementations - logic to be added later) ===
                        EffectType::Intoxicated => {
                            // TODO: Implement drunk effect - blurred vision, movement wobble, etc.
                            // For now, just log that the effect is active
                            log::debug!("[EffectTick] Intoxicated effect active for player {:?} (stub - no effect yet)", effect.player_id);
                            amount_this_tick = 0.0; // No effect yet
                        }
                        EffectType::Poisoned => {
                            // Poison DOT from brews/coated weapons
                            // Similar to Venom but from brew-based poison
                            if player_to_update.is_knocked_out {
                                amount_this_tick = 0.0;
                                log::info!("[EffectTick] Knocked out player {:?} is immune to Poisoned damage.", effect.player_id);
                            } else {
                                // Apply poison damage (similar to Venom)
                                amount_this_tick = POISON_DOT_DAMAGE_PER_TICK; // 2.0 damage per tick
                                
                                // <<< BROTH EFFECT: PoisonResistance reduces poison damage by 75% >>>
                                if player_has_poison_resistance_effect(ctx, effect.player_id) {
                                    let original_damage = amount_this_tick;
                                    amount_this_tick *= (1.0 - POISON_RESISTANCE_REDUCTION);
                                    log::info!(
                                        "Player {:?} has PoisonResistance broth - poison damage reduced by {:.0}%: {:.1} -> {:.1}",
                                        effect.player_id, POISON_RESISTANCE_REDUCTION * 100.0, original_damage, amount_this_tick
                                    );
                                }
                                // <<< END BROTH EFFECT >>>
                                
                                player_to_update.health = (player_to_update.health - amount_this_tick).clamp(MIN_STAT_VALUE, MAX_HEALTH_VALUE);
                                log::trace!("[EffectTick] Poisoned damage for Player {:?}: {:.1} HP (health now {:.1})",
                                    effect.player_id, amount_this_tick, player_to_update.health);
                            }
                        }
                        EffectType::SpeedBoost => {
                            // TODO: Implement movement speed increase
                            // This will be handled by movement system, not effect tick
                            amount_this_tick = 0.0; // No per-tick stat change
                        }
                        EffectType::StaminaBoost => {
                            // Reduced hunger/thirst drain is handled by player_stats, not effect tick.
                            amount_this_tick = 0.0; // No per-tick stat change
                        }
                        EffectType::NightVision => {
                            // TODO: Implement enhanced vision at night
                            // This will be handled by rendering system, not effect tick
                            amount_this_tick = 0.0; // No per-tick stat change
                        }
                        EffectType::WarmthBoost => {
                            // TODO: Implement warmth protection bonus
                            // This will be handled by warmth decay system, not effect tick
                            amount_this_tick = 0.0; // No per-tick stat change
                        }
                        EffectType::ColdResistance => {
                            // TODO: Implement reduced cold damage
                            // This will be handled by cold damage system, not effect tick
                            amount_this_tick = 0.0; // No per-tick stat change
                        }
                        EffectType::PoisonResistance => {
                            // TODO: Implement reduced poison/venom damage
                            // This will be handled by damage calculation system, not effect tick
                            amount_this_tick = 0.0; // No per-tick stat change
                        }
                        EffectType::FireResistance => {
                            // TODO: Implement reduced fire/burn damage
                            // This will be handled by burn damage calculation system, not effect tick
                            amount_this_tick = 0.0; // No per-tick stat change
                        }
                        EffectType::WaterDrinking => {
                            // WaterDrinking is purely a visual effect, no per-tick processing needed
                            // It just exists for the duration to trigger client-side animations
                            amount_this_tick = 0.0;
                        }
                        EffectType::HotSpring => {
                            // HotSpring provides continuous healing while standing in the hot spring
                            // The healing is handled by player_stats.rs checking position
                            // This effect doesn't consume amount_applied_so_far
                            amount_this_tick = 0.0;
                        }
                        EffectType::Fumarole => {
                            // Fumarole provides warmth protection (nullifies warmth decay)
                            // The warmth protection is handled by player_stats.rs checking position
                            // This effect doesn't consume amount_applied_so_far
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
                        EffectType::Exhausted => {
                            // Exhausted provides movement speed penalty (EXHAUSTED_SPEED_PENALTY = 0.75)
                            // Applied when hunger OR thirst is below 20% (50/250)
                            // The movement speed penalty is handled in player movement system
                            // This effect doesn't consume amount_applied_so_far
                            amount_this_tick = 0.0;
                        },
                        EffectType::BuildingPrivilege => {
                            // BuildingPrivilege allows building structures near homestead hearths
                            // No health changes here, just a status flag
                            amount_this_tick = 0.0;
                        },
                        EffectType::ProductionRune => {
                            // ProductionRune provides 2x crafting speed in red rune stone zones
                            // The crafting speed bonus is handled in crafting system
                            // This effect doesn't consume amount_applied_so_far
                            amount_this_tick = 0.0;
                        },
                        EffectType::AgrarianRune => {
                            // AgrarianRune provides 2x plant growth in green rune stone zones
                            // The growth speed bonus is handled in plant growth system
                            // This effect doesn't consume amount_applied_so_far
                            amount_this_tick = 0.0;
                        },
                        EffectType::MemoryRune => {
                            // MemoryRune spawns memory shards at night in blue rune stone zones
                            // The spawning is handled in rune stone scheduled reducers
                            // This effect doesn't consume amount_applied_so_far
                            amount_this_tick = 0.0;
                        },
                        EffectType::SafeZone => {
                            // SafeZone provides protection from player/animal/projectile damage
                            // The protection is checked in damage application functions
                            // This effect doesn't consume amount_applied_so_far
                            amount_this_tick = 0.0;
                        },
                        EffectType::FishingVillageBonus => {
                            // FishingVillageBonus provides 2x fishing hauls and premium tier bonus
                            // The bonus is checked in fishing loot generation
                            // This effect doesn't consume amount_applied_so_far
                            amount_this_tick = 0.0;
                        },
                        EffectType::NearCookingStation => {
                            // NearCookingStation enables advanced food recipe crafting
                            // The crafting validation is checked in crafting.rs
                            // This effect is just a flag - no per-tick processing needed
                            amount_this_tick = 0.0;
                        },
                        // === ADDITIONAL BROTH EFFECTS ===
                        EffectType::PoisonCoating => {
                            // PoisonCoating makes all player attacks inflict poison on targets
                            // The poison application is handled in combat.rs when attacks land
                            // This effect is just a flag - no per-tick processing needed
                            amount_this_tick = 0.0;
                        },
                        EffectType::PassiveHealthRegen => {
                            // PassiveHealthRegen provides slow continuous health regeneration (1 hour buff)
                            // Heals a small amount per tick over the full duration
                            log::trace!("[EffectTick] PassiveHealthRegen for Player {:?}: Health {:.2}, AmountThisTick {:.2}",
                                effect.player_id, player_to_update.health, amount_this_tick);
                            player_to_update.health = (player_to_update.health + amount_this_tick).clamp(MIN_STAT_VALUE, MAX_HEALTH_VALUE);
                            log::trace!("[EffectTick] PassiveHealthRegen Post-Heal for Player {:?}: Health now {:.2}",
                                effect.player_id, player_to_update.health);
                        },
                        EffectType::HarvestBoost => {
                            // HarvestBoost provides bonus yield from mining and chopping
                            // The yield bonus is applied in tree/stone harvesting code
                            // This effect is just a flag - no per-tick processing needed
                            amount_this_tick = 0.0;
                        },
                        EffectType::BrewCooldown => {
                            // BrewCooldown is just a timer preventing consumption of another brew
                            // No per-tick stat changes, just a flag that expires after 60 seconds
                            amount_this_tick = 0.0;
                        },
                        EffectType::HotCombatLadle => {
                            // HotCombatLadle: burn on hit and 2x wildlife damage (applied in combat.rs)
                            // This effect is just a flag - no per-tick processing, expires after 30 min
                            amount_this_tick = 0.0;
                        },
                        EffectType::Stun => {
                            // Stun is a time-based immobilization effect from blunt weapons
                            // Movement is blocked in player_movement.rs when this effect is active
                            // No per-tick stat changes, just a flag that expires
                            amount_this_tick = 0.0;
                        },
                        EffectType::LagunovGhost => {
                            // Lagunov's Ghost is an informational effect for shipwreck protection
                            // No per-tick processing needed - managed by proximity system
                            amount_this_tick = 0.0;
                        },
                        EffectType::MemoryBeaconSanity => {
                            // Memory Beacon Sanity is a display-only effect for insanity immunity
                            // Actual insanity clearing is handled in player_stats.rs
                            // No per-tick processing needed - managed by proximity system
                            amount_this_tick = 0.0;
                        },
                        EffectType::ValidolProtection => {
                            // ValidolProtection pauses Entrainment damage - no per-tick processing needed
                            // The effect is checked in player_stats.rs when calculating Entrainment damage
                            amount_this_tick = 0.0;
                        },
                        EffectType::ChewingGum => {
                            // ChewingGum has no total_amount - handled in dedicated block above (unreachable here)
                            amount_this_tick = 0.0;
                        },
                    }

                    if (player_to_update.health - old_health).abs() > f32::EPSILON {
                        player_effect_applied_this_iteration = true;
                        if effect.effect_type == EffectType::Burn {
                            log::info!("[BurnDamage] Health changed for player {:?}: {:.1} -> {:.1}, player_effect_applied=true", 
                                effect.player_id, old_health, player_to_update.health);
                        }
                    } else if effect.effect_type == EffectType::Burn {
                        log::info!("[BurnDamage] Health NOT changed for player {:?} (old={:.1}, new={:.1}), player_effect_applied=false", 
                            effect.player_id, old_health, player_to_update.health);
                    }
                    
                    // For SeawaterPoisoning, Venom, and Entrainment, we don't track amount_applied_so_far
                    // These effects: fixed damage per tick, ends based on time only
                    if effect.effect_type != EffectType::SeawaterPoisoning && effect.effect_type != EffectType::Venom && effect.effect_type != EffectType::Entrainment {
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
        // For SeawaterPoisoning, Venom, Entrainment, Wet, WaterDrinking, and broth buff effects, only end based on time, not accumulated amount
        // Broth buff effects (Intoxicated, SpeedBoost, etc.) have total_amount = 0.0 and should only expire by time
        // Entrainment is permanent until death (effectively infinite duration)
        let is_broth_buff_effect_end_check = matches!(effect.effect_type, 
            EffectType::Intoxicated | EffectType::SpeedBoost | 
            EffectType::StaminaBoost | EffectType::NightVision | EffectType::WarmthBoost | 
            EffectType::ColdResistance | EffectType::PoisonResistance | EffectType::FireResistance |
            EffectType::PoisonCoating | EffectType::HarvestBoost | EffectType::BrewCooldown);
        
        if effect.effect_type == EffectType::SeawaterPoisoning || effect.effect_type == EffectType::Venom || effect.effect_type == EffectType::Entrainment || 
           effect.effect_type == EffectType::Wet || effect.effect_type == EffectType::WaterDrinking || effect.effect_type == EffectType::Stun ||
           effect.effect_type == EffectType::ValidolProtection || effect.effect_type == EffectType::HotCombatLadle || is_broth_buff_effect_end_check {
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

            // Stop chewing gum sound when ChewingGum effect ends
            if effect.effect_type == EffectType::ChewingGum {
                stop_chewing_gum_sound(ctx, effect.effect_id);
                log::info!("[EffectTick] Stopped chewing gum sound for effect {} (player {:?})", effect.effect_id, effect.player_id);
            }

            // If the effect had an associated item instance to consume, mark it for consumption
            if let Some(item_instance_id_to_consume) = effect.consuming_item_instance_id {
                effects_requiring_consumption.push((item_instance_id_to_consume, effect.player_id, effect.effect_type.clone(), Some(current_effect_applied_so_far)));
            }
        } else {
            // Update the effect in the DB with the new applied_so_far and next_tick_at
            // For stub brewing effects, we still need to update next_tick_at so they continue to be checked for expiration
            let mut updated_effect_for_db = effect; // 'effect' is already a clone of effect_row
            updated_effect_for_db.amount_applied_so_far = Some(current_effect_applied_so_far);
            updated_effect_for_db.next_tick_at = current_time + TimeDuration::from_micros(updated_effect_for_db.tick_interval_micros as i64);
            ctx.db.active_consumable_effect().effect_id().update(updated_effect_for_db);
        }
    }

    // --- Apply all accumulated player updates to the database ---
    for (player_id, player) in player_updates {
        // RE-FETCH the player record to get the latest position data before updating
        if let Some(mut current_player) = ctx.db.player().identity().find(&player_id) {
            // Only update health-related fields, preserve position and other fields
            current_player.health = player.health;
            current_player.is_dead = player.is_dead;
            current_player.death_timestamp = player.death_timestamp;
            current_player.last_update = player.last_update;
            // Update last_hit_time for burn damage visual effects (red overlay, screenshake)
            if player.last_hit_time.is_some() {
                log::info!("[EffectTick] Persisting last_hit_time for player {:?} - last_hit_time is Some", player_id);
            }
            current_player.last_hit_time = player.last_hit_time;
            
            ctx.db.player().identity().update(current_player);
            log::debug!("[EffectTick] Final update for player {:?} applied to DB (health fields only).", player_id);
        } else {
            log::warn!("[EffectTick] Player {:?} not found during final update - skipping.", player_id);
        }
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

            clear_active_equipment_if_consumed_item(ctx, player_id, item_instance_id, &effect_type);
            
            if inventory_item.quantity > 0 {
                inventory_item.quantity -= 1;
            }

            if inventory_item.quantity == 0 {
                // Clear from container slot if item was in a container (optimized O(1) when location known)
                if let crate::models::ItemLocation::Container(ref loc) = &inventory_item.location {
                    if !crate::items::clear_item_from_container_by_location(ctx, loc, item_instance_id) {
                        crate::items::clear_item_from_any_container(ctx, item_instance_id);
                    }
                }
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
    for effect in ctx.db.active_consumable_effect().player_id().filter(&player_id) {
        if effect.effect_type == EffectType::HealthRegen {
            effects_to_cancel.push(effect.effect_id);
        }
    }
    for effect_id in effects_to_cancel {
        ctx.db.active_consumable_effect().effect_id().delete(&effect_id);
        log::info!("Cancelled health regen effect {} for player {:?} due to damage.", effect_id, player_id);
    }
}

pub fn cancel_bleed_effects(ctx: &ReducerContext, player_id: Identity) {
    let mut effects_to_cancel = Vec::new();
    for effect in ctx.db.active_consumable_effect().player_id().filter(&player_id) {
        if effect.effect_type == EffectType::Bleed {
            effects_to_cancel.push(effect.effect_id);
        }
    }
    for effect_id in effects_to_cancel {
        ctx.db.active_consumable_effect().effect_id().delete(&effect_id);
        log::info!("Cancelled bleed effect {} for player {:?} (e.g., by bandage).", effect_id, player_id);
    }
}

pub fn cancel_bandage_burst_effects(ctx: &ReducerContext, player_id: Identity) {
    let mut effects_to_cancel = Vec::new();
    // Cancel effects where player is the healer (indexed lookup)
    for effect in ctx.db.active_consumable_effect().player_id().filter(&player_id) {
        if effect.effect_type == EffectType::BandageBurst || effect.effect_type == EffectType::RemoteBandageBurst {
            effects_to_cancel.push(effect.effect_id);
        }
    }
    // Also cancel RemoteBandageBurst where player is the TARGET (requires full scan for target_player_id)
    // This is acceptable since it's a rare cancel operation, not a hot path
    let target_effects: Vec<u64> = ctx.db.active_consumable_effect().iter()
        .filter(|e| {
            e.target_player_id == Some(player_id) && e.effect_type == EffectType::RemoteBandageBurst
                && !effects_to_cancel.contains(&e.effect_id)
        })
        .map(|e| e.effect_id)
        .collect();
    effects_to_cancel.extend(target_effects);
    
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

    // Check for existing food poisoning effects and extend if found (indexed lookup)
    for existing_effect in ctx.db.active_consumable_effect().player_id().filter(&player_id) {
        if existing_effect.effect_type == EffectType::FoodPoisoning {
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
    let total_thirst_drain = duration_seconds as f32 * 2.5; // 2.5 thirst drain per second
    
    // Check if player already has seawater poisoning - if so, extend the duration (indexed lookup)
    let existing_effects: Vec<_> = ctx.db.active_consumable_effect().player_id().filter(&player_id)
        .filter(|e| e.effect_type == EffectType::SeawaterPoisoning)
        .collect();

    if !existing_effects.is_empty() {
        // Extend existing effect instead of creating a new one
        for existing_effect in existing_effects {
            let mut updated_effect = existing_effect.clone();
            let additional_thirst_drain = duration_seconds as f32 * 2.5;
            
            // Extend the end time
            updated_effect.ends_at = current_time + TimeDuration::from_micros(duration_micros as i64);
            
            // Add to total thirst drain amount
            if let Some(current_total) = updated_effect.total_amount {
                updated_effect.total_amount = Some(current_total + additional_thirst_drain);
            } else {
                updated_effect.total_amount = Some(additional_thirst_drain);
            }
            
            let total_drain_amount = updated_effect.total_amount.unwrap_or(0.0);
            ctx.db.active_consumable_effect().effect_id().update(updated_effect);
            log::info!("Extended seawater poisoning effect for player {:?} by {} seconds (total thirst drain now: {:.1})", 
                player_id, duration_seconds, total_drain_amount);
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
            total_amount: Some(total_thirst_drain),
            amount_applied_so_far: Some(0.0),
            effect_type: EffectType::SeawaterPoisoning,
            tick_interval_micros,
            next_tick_at: current_time + TimeDuration::from_micros(tick_interval_micros as i64),
        };

        ctx.db.active_consumable_effect().insert(effect);
        log::info!("Applied seawater poisoning effect to player {:?} for {} seconds ({:.1} total thirst drain)", 
            player_id, duration_seconds, total_thirst_drain);

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
/// Note: Matron's Chest (hearth) no longer provides cozy effect
pub fn should_player_be_cozy(ctx: &ReducerContext, player_id: Identity, player_x: f32, player_y: f32) -> bool {
    // Import necessary traits
    use crate::campfire::{campfire as CampfireTableTrait, WARMTH_RADIUS_SQUARED};
    use crate::shelter::{shelter as ShelterTableTrait, is_player_inside_shelter};
    use crate::monument_part as MonumentPartTableTrait;
    use crate::MonumentType;
    use crate::wooden_storage_box::{wooden_storage_box as WoodenStorageBoxTableTrait, is_pelt_box_type};
    
    // Village communal campfire cozy radius (larger than regular campfires)
    // Public cozy zone at both fishing and hunting villages.
    const VILLAGE_COZY_RADIUS: f32 = 450.0;
    const VILLAGE_COZY_RADIUS_SQ: f32 = VILLAGE_COZY_RADIUS * VILLAGE_COZY_RADIUS;
    
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
    
    // Check for village communal campfires (always burning, public cozy zones)
    for part in ctx.db.monument_part().iter() {
        // Both fishing and hunting villages use fv_campfire doodad parts.
        // Use part_type == "campfire" instead of center flags so this remains stable
        // even if monument center definitions change.
        if (part.monument_type == MonumentType::FishingVillage || part.monument_type == MonumentType::HuntingVillage)
            && part.part_type == "campfire" {
            let dx = player_x - part.world_x;
            let dy = player_y - part.world_y;
            let distance_squared = dx * dx + dy * dy;
            
            if distance_squared <= VILLAGE_COZY_RADIUS_SQ {
                log::debug!(
                    "Player {:?} is cozy near village campfire ({:?})",
                    player_id,
                    part.monument_type
                );
                return true;
            }
        }
    }

    // Pelt rugs provide a local cozy aura to anyone nearby.
    const PELT_COZY_RADIUS: f32 = 220.0;
    const PELT_COZY_RADIUS_SQ: f32 = PELT_COZY_RADIUS * PELT_COZY_RADIUS;
    for box_entity in ctx.db.wooden_storage_box().iter() {
        if box_entity.is_destroyed || !is_pelt_box_type(box_entity.box_type) {
            continue;
        }
        let dx = player_x - box_entity.pos_x;
        // Pelt visual center is slightly above stored pos_y for rug-style rendering.
        let dy = player_y - (box_entity.pos_y - 48.0);
        let distance_squared = dx * dx + dy * dy;
        if distance_squared <= PELT_COZY_RADIUS_SQ {
            return true;
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
    
    // Matron's Chest (hearth) no longer provides cozy effect - removed
    
    false
}

/// Applies or removes cozy effect based on player's current conditions
pub fn update_player_cozy_status(ctx: &ReducerContext, player_id: Identity, player_x: f32, player_y: f32) -> Result<(), String> {
    let should_be_cozy = should_player_be_cozy(ctx, player_id, player_x, player_y);
    let has_cozy_effect = ctx.db.active_consumable_effect().player_id().filter(&player_id)
        .any(|effect| effect.effect_type == EffectType::Cozy);
    
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
    for effect in ctx.db.active_consumable_effect().player_id().filter(&player_id) {
        if effect.effect_type == EffectType::Cozy {
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
    ctx.db.active_consumable_effect().player_id().filter(&player_id)
        .any(|effect| effect.effect_type == EffectType::Cozy)
}

// Tree Cover Effect Management
// ============================

/// Checks if a player should have the tree cover effect based on their proximity to trees
pub fn should_player_have_tree_cover(ctx: &ReducerContext, player_x: f32, player_y: f32) -> bool {
    const TREE_COVER_DISTANCE_SQ: f32 = 150.0 * 150.0; // 150px protection radius
    
    for tree in ctx.db.tree().iter() {
        // Skip destroyed trees (respawn_at > UNIX_EPOCH when tree is harvested)
        if tree.respawn_at > Timestamp::UNIX_EPOCH {
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
    for effect in ctx.db.active_consumable_effect().player_id().filter(&player_id) {
        if effect.effect_type == EffectType::TreeCover {
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
    ctx.db.active_consumable_effect().player_id().filter(&player_id)
        .any(|effect| effect.effect_type == EffectType::Wet)
}

/// Checks if a player currently has the tree cover effect active
pub fn player_has_tree_cover_effect(ctx: &ReducerContext, player_id: Identity) -> bool {
    ctx.db.active_consumable_effect().player_id().filter(&player_id)
        .any(|effect| effect.effect_type == EffectType::TreeCover)
}

// Bleeding Effect Management
// ==========================

/// Maximum duration (in seconds) that bleeding can be stacked to
/// This prevents unlimited bleeding stacking from rapid attacks
pub const MAX_BLEED_DURATION_SECONDS: f32 = 30.0; // 30 seconds max

// Exhausted Effect Management
// ===========================

pub use crate::shared_config::EXHAUSTED_SPEED_PENALTY;

/// Checks if a player should have the exhausted effect based on low hunger or thirst only
/// Player is exhausted when hunger OR thirst drops below 20% of maximum
pub fn should_player_be_exhausted(player_hunger: f32, player_thirst: f32, _player_warmth: f32, _low_need_threshold: f32) -> bool {
    const HUNGER_EXHAUSTION_THRESHOLD: f32 = 50.0; // 20% of 250 max hunger
    const THIRST_EXHAUSTION_THRESHOLD: f32 = 50.0; // 20% of 250 max thirst
    
    player_hunger < HUNGER_EXHAUSTION_THRESHOLD || player_thirst < THIRST_EXHAUSTION_THRESHOLD
}

/// Applies or removes exhausted effect based on player's current hunger and thirst only
pub fn update_player_exhausted_status(ctx: &ReducerContext, player_id: Identity, player_hunger: f32, player_thirst: f32, player_warmth: f32, low_need_threshold: f32) -> Result<(), String> {
    let should_be_exhausted = should_player_be_exhausted(player_hunger, player_thirst, player_warmth, low_need_threshold);
    let has_exhausted_effect = player_has_exhausted_effect(ctx, player_id);
    
    log::debug!("Exhausted status check for player {:?}: should_be_exhausted={}, has_exhausted_effect={} (hunger: {:.1}, thirst: {:.1} - warmth ignored: {:.1})", 
        player_id, should_be_exhausted, has_exhausted_effect, player_hunger, player_thirst, player_warmth);
    
    if should_be_exhausted && !has_exhausted_effect {
        // Apply exhausted effect
        log::info!("Applying exhausted effect to player {:?} (hunger: {:.1}, thirst: {:.1})", player_id, player_hunger, player_thirst);
        apply_exhausted_effect(ctx, player_id)?;
    } else if !should_be_exhausted && has_exhausted_effect {
        // Remove exhausted effect
        log::info!("Removing exhausted effect from player {:?} (hunger: {:.1}, thirst: {:.1})", player_id, player_hunger, player_thirst);
        remove_exhausted_effect(ctx, player_id);
    }
    
    Ok(())
}

/// Applies an exhausted effect to a player
fn apply_exhausted_effect(ctx: &ReducerContext, player_id: Identity) -> Result<(), String> {
    let current_time = ctx.timestamp;
    // Set a very far future time (1 year from now) - effectively permanent
    let very_far_future = current_time + TimeDuration::from_micros(365 * 24 * 60 * 60 * 1_000_000i64);
    
    let exhausted_effect = ActiveConsumableEffect {
        effect_id: 0, // auto_inc
        player_id,
        target_player_id: None,
        item_def_id: 0, // Not from an item
        consuming_item_instance_id: None,
        started_at: current_time,
        ends_at: very_far_future, // Effectively permanent
        total_amount: None, // No accumulation for exhausted effect
        amount_applied_so_far: None,
        effect_type: EffectType::Exhausted,
        tick_interval_micros: 1_000_000, // 1 second ticks (not really used)
        next_tick_at: current_time + TimeDuration::from_micros(1_000_000),
    };
    
    match ctx.db.active_consumable_effect().try_insert(exhausted_effect) {
        Ok(inserted_effect) => {
            log::info!("Applied exhausted effect {} to player {:?}", inserted_effect.effect_id, player_id);
            Ok(())
        }
        Err(e) => {
            log::error!("Failed to apply exhausted effect to player {:?}: {:?}", player_id, e);
            Err("Failed to apply exhausted effect".to_string())
        }
    }
}

/// Removes exhausted effect from a player
fn remove_exhausted_effect(ctx: &ReducerContext, player_id: Identity) {
    let mut effects_to_remove = Vec::new();
    for effect in ctx.db.active_consumable_effect().player_id().filter(&player_id) {
        if effect.effect_type == EffectType::Exhausted {
            effects_to_remove.push(effect.effect_id);
        }
    }
    
    for effect_id in effects_to_remove {
        ctx.db.active_consumable_effect().effect_id().delete(&effect_id);
        log::info!("Removed exhausted effect {} from player {:?}", effect_id, player_id);
    }
}

/// Checks if a player currently has the exhausted effect active
/// Uses btree index on player_id for O(log N + k) lookup instead of O(N) table scan
pub fn player_has_exhausted_effect(ctx: &ReducerContext, player_id: Identity) -> bool {
    ctx.db.active_consumable_effect().player_id().filter(&player_id)
        .any(|effect| effect.effect_type == EffectType::Exhausted)
}

/// Extinguishes burn effects for a player due to water or rain
/// Returns the number of burn effects that were extinguished
pub fn extinguish_burn_effects(ctx: &ReducerContext, player_id: Identity, reason: &str) -> u32 {
    let mut extinguished_count = 0;
    
    // Find all burn effects for this player (indexed lookup)
    let burn_effects_to_remove: Vec<_> = ctx.db.active_consumable_effect().player_id().filter(&player_id)
        .filter(|effect| effect.effect_type == EffectType::Burn)
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
    if crate::indoors::is_position_indoors(ctx, player.position_x, player.position_y) { return true; }

    // Check if player is within 100px of any tree (protected by tree cover)
    const TREE_PROTECTION_DISTANCE_SQ: f32 = 100.0 * 100.0; // 100px protection radius
    
    for tree in ctx.db.tree().iter() {
        // Skip destroyed trees (respawn_at > UNIX_EPOCH when tree is harvested)
        if tree.respawn_at > Timestamp::UNIX_EPOCH {
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
    
    // Check if player already has a venom effect - if so, stack it (indexed lookup)
    let existing_venom_effects: Vec<_> = ctx.db.active_consumable_effect().player_id().filter(&player_id)
        .filter(|e| e.effect_type == EffectType::Venom)
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

/// Applies a bleeding effect to a player (damage over time from attacks)
/// Stacks duration and damage into a single effect, up to MAX_BLEED_DURATION_SECONDS
pub fn apply_bleeding_effect(
    ctx: &ReducerContext,
    player_id: Identity,
    total_damage: f32,
    duration_seconds: f32,
    tick_interval_seconds: f32,
) -> Result<(), String> {
    let current_time = ctx.timestamp;
    
    // Check if player already has a bleeding effect (indexed lookup)
    let existing_bleed_effect = ctx.db.active_consumable_effect().player_id().filter(&player_id)
        .find(|e| e.effect_type == EffectType::Bleed);

    if let Some(existing_effect) = existing_bleed_effect {
        // Stack onto existing effect
        let mut updated_effect = existing_effect.clone();
        
        // Calculate remaining duration from existing effect
        let remaining_duration_micros = existing_effect.ends_at.to_micros_since_unix_epoch()
            .saturating_sub(current_time.to_micros_since_unix_epoch());
        let remaining_duration_seconds = (remaining_duration_micros as f32) / 1_000_000.0;
        
        // Add new duration to remaining, but cap at MAX_BLEED_DURATION_SECONDS
        let new_total_duration = (remaining_duration_seconds + duration_seconds).min(MAX_BLEED_DURATION_SECONDS);
        let duration_micros = (new_total_duration * 1_000_000.0) as i64;
        
        // Calculate new total damage (existing remaining + new)
        let remaining_damage = existing_effect.total_amount.unwrap_or(0.0) 
            - existing_effect.amount_applied_so_far.unwrap_or(0.0);
        let new_total_damage = remaining_damage + total_damage;
        
        // Update the effect
        updated_effect.ends_at = current_time + TimeDuration::from_micros(duration_micros);
        updated_effect.total_amount = Some(new_total_damage);
        // Keep amount_applied_so_far as is - it tracks what's already been applied
        
        ctx.db.active_consumable_effect().effect_id().update(updated_effect);
        
        let was_capped = (remaining_duration_seconds + duration_seconds) > MAX_BLEED_DURATION_SECONDS;
        log::info!(
            "Stacked bleeding effect {} for player {:?}: added {:.1}s (total now {:.1}s{}), total damage now {:.1}", 
            existing_effect.effect_id, 
            player_id, 
            duration_seconds,
            new_total_duration,
            if was_capped { " - CAPPED" } else { "" },
            new_total_damage
        );
        
        return Ok(());
    }
    
    // No existing effect - create new bleeding effect
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
            log::info!("Applied new bleeding effect {} to player {:?}: {:.1} damage over {:.1}s (every {:.1}s)", 
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
    
    // <<< CHECK BURN IMMUNITY FROM ARMOR >>>
    if armor::has_armor_immunity(ctx, player_id, ImmunityType::Burn) {
        log::info!("Player {:?} is immune to burn effects (armor immunity)", player_id);
        return Ok(()); // Silently ignore burn effect application
    }
    // <<< END BURN IMMUNITY CHECK >>>
    
    // <<< SAFE ZONE CHECK - Players in safe zones are immune to burn effects >>>
    if player_has_safe_zone_effect(ctx, player_id) {
        log::info!("Player {:?} is in a safe zone - burn effect blocked", player_id);
        return Ok(()); // Silently ignore burn effect application
    }
    // <<< END SAFE ZONE CHECK >>>
    
    // Check if player already has a burn effect from the same source type (indexed lookup)
    let existing_burn_effects: Vec<_> = ctx.db.active_consumable_effect().player_id().filter(&player_id)
        .filter(|e| e.effect_type == EffectType::Burn && 
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
            
            // <<< IMMEDIATE VISUAL FEEDBACK ON BURN STACK >>>
            // Set last_hit_time immediately so player sees damage feedback when stepping on fire
            // This triggers red overlay, screenshake, etc. on the client
            if let Some(mut player) = ctx.db.player().identity().find(&player_id) {
                player.last_hit_time = Some(current_time);
                ctx.db.player().identity().update(player);
                log::info!("[BurnEffect] Set last_hit_time for player {:?} on burn stack (immediate feedback)", player_id);
            }
            // <<< END IMMEDIATE VISUAL FEEDBACK >>>
            
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
                
                // <<< IMMEDIATE VISUAL FEEDBACK ON NEW BURN >>>
                // Set last_hit_time immediately so player sees damage feedback when stepping on fire
                // This triggers red overlay, screenshake, etc. on the client
                if let Some(mut player) = ctx.db.player().identity().find(&player_id) {
                    player.last_hit_time = Some(current_time);
                    ctx.db.player().identity().update(player);
                    log::info!("[BurnEffect] Set last_hit_time for player {:?} on new burn (immediate feedback)", player_id);
                }
                // <<< END IMMEDIATE VISUAL FEEDBACK >>>
                
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
    let effects_to_cancel: Vec<_> = ctx.db.active_consumable_effect().player_id().filter(&player_id)
        .filter(|e| e.effect_type == EffectType::Venom)
        .collect();

    for effect in effects_to_cancel {
        ctx.db.active_consumable_effect().effect_id().delete(&effect.effect_id);
        log::info!("Cancelled venom effect {} for player {:?} (Anti-Venom consumed)", effect.effect_id, player_id);
    }
}

/// Clear all active effects for a player who has died
/// This includes all damage-over-time effects, healing effects, and status effects
/// CRITICAL: Broth effects do NOT persist through death!
pub fn clear_all_effects_on_death(ctx: &ReducerContext, player_id: Identity) {
    log::info!("[PlayerDeath] Clearing all active effects for deceased player {:?}", player_id);
    
    // Clear all damage-over-time effects
    cancel_bleed_effects(ctx, player_id);
    cancel_venom_effects(ctx, player_id);
    
    // Clear all healing effects  
    cancel_health_regen_effects(ctx, player_id);
    cancel_bandage_burst_effects(ctx, player_id);
    
    // CRITICAL: Clear all broth effects - they don't persist through death!
    clear_broth_effects_on_death(ctx, player_id);
    
    // Clear any other effects (burn, food poisoning, seawater poisoning, wet, exhausted, entrainment, etc.)
    // Entrainment is an insanity effect (not a broth effect), but it's still cleared on death
    // ONLY preserve BuildingPrivilege - it persists across death
    let mut effects_to_remove = Vec::new();
    for effect in ctx.db.active_consumable_effect().player_id().filter(&player_id) {
        {
            // Skip BuildingPrivilege - it persists across death
            if effect.effect_type == EffectType::BuildingPrivilege {
                log::debug!("[PlayerDeath] Preserving BuildingPrivilege effect {} for deceased player {:?}", 
                    effect.effect_id, player_id);
                continue;
            }
            // Entrainment is cleared on death (permanent while alive, cleared on respawn)
            if effect.effect_type == EffectType::Entrainment {
                log::info!("[PlayerDeath] Clearing Entrainment effect {} for deceased player {:?} (insanity effect cleared on death)", 
                    effect.effect_id, player_id);
            }
            // Stop chewing gum sound before removing effect
            if effect.effect_type == EffectType::ChewingGum {
                stop_chewing_gum_sound(ctx, effect.effect_id);
            }
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

// Rune Stone Zone Effect Management
// =================================

/// Updates rune stone zone effects for a player based on their position
/// This should be called periodically (e.g., from player stats system)
pub fn update_player_rune_stone_zone_effects(ctx: &ReducerContext, player_id: Identity, player_x: f32, player_y: f32) -> Result<(), String> {
    use crate::rune_stone::{rune_stone as RuneStoneTableTrait, RuneStoneType, RUNE_STONE_EFFECT_RADIUS_SQUARED};
    
    let mut in_production_zone = false;
    let mut in_agrarian_zone = false;
    let mut in_memory_zone = false;
    
    // Check all rune stones to see if player is in their effect radius
    for rune_stone in ctx.db.rune_stone().iter() {
        let dx = player_x - rune_stone.pos_x;
        let dy = player_y - rune_stone.pos_y;
        let distance_sq = dx * dx + dy * dy;
        
        if distance_sq <= RUNE_STONE_EFFECT_RADIUS_SQUARED {
            match rune_stone.rune_type {
                RuneStoneType::Red => in_production_zone = true,
                RuneStoneType::Green => in_agrarian_zone = true,
                RuneStoneType::Blue => in_memory_zone = true,
            }
        }
    }
    
    // Update production rune effect
    let has_production_effect = player_has_production_rune_effect(ctx, player_id);
    if in_production_zone && !has_production_effect {
        apply_production_rune_effect(ctx, player_id)?;
    } else if !in_production_zone && has_production_effect {
        remove_production_rune_effect(ctx, player_id);
    }
    
    // Update agrarian rune effect
    let has_agrarian_effect = player_has_agrarian_rune_effect(ctx, player_id);
    if in_agrarian_zone && !has_agrarian_effect {
        apply_agrarian_rune_effect(ctx, player_id)?;
    } else if !in_agrarian_zone && has_agrarian_effect {
        remove_agrarian_rune_effect(ctx, player_id);
    }
    
    // Update memory rune effect
    let has_memory_effect = player_has_memory_rune_effect(ctx, player_id);
    if in_memory_zone && !has_memory_effect {
        apply_memory_rune_effect(ctx, player_id)?;
    } else if !in_memory_zone && has_memory_effect {
        remove_memory_rune_effect(ctx, player_id);
    }
    
    Ok(())
}

/// Checks if a player has the production rune effect
pub fn player_has_production_rune_effect(ctx: &ReducerContext, player_id: Identity) -> bool {
    ctx.db.active_consumable_effect().player_id().filter(&player_id)
        .any(|effect| effect.effect_type == EffectType::ProductionRune)
}

/// Checks if a player has the agrarian rune effect
pub fn player_has_agrarian_rune_effect(ctx: &ReducerContext, player_id: Identity) -> bool {
    ctx.db.active_consumable_effect().player_id().filter(&player_id)
        .any(|effect| effect.effect_type == EffectType::AgrarianRune)
}

/// Checks if a player has the memory rune effect
pub fn player_has_memory_rune_effect(ctx: &ReducerContext, player_id: Identity) -> bool {
    ctx.db.active_consumable_effect().player_id().filter(&player_id)
        .any(|effect| effect.effect_type == EffectType::MemoryRune)
}

/// Applies production rune zone effect
fn apply_production_rune_effect(ctx: &ReducerContext, player_id: Identity) -> Result<(), String> {
    let current_time = ctx.timestamp;
    let very_far_future = current_time + TimeDuration::from_micros(365 * 24 * 60 * 60 * 1_000_000i64);
    
    let effect = ActiveConsumableEffect {
        effect_id: 0,
        player_id,
        target_player_id: None,
        item_def_id: 0,
        consuming_item_instance_id: None,
        started_at: current_time,
        ends_at: very_far_future,
        total_amount: None,
        amount_applied_so_far: None,
        effect_type: EffectType::ProductionRune,
        tick_interval_micros: 1_000_000,
        next_tick_at: current_time + TimeDuration::from_micros(1_000_000),
    };
    
    match ctx.db.active_consumable_effect().try_insert(effect) {
        Ok(inserted) => {
            log::info!("Applied production rune zone effect {} to player {:?}", inserted.effect_id, player_id);
            Ok(())
        }
        Err(e) => {
            log::error!("Failed to apply production rune effect: {:?}", e);
            Err("Failed to apply production rune effect".to_string())
        }
    }
}

/// Removes production rune zone effect
fn remove_production_rune_effect(ctx: &ReducerContext, player_id: Identity) {
    let effects_to_remove: Vec<_> = ctx.db.active_consumable_effect().player_id().filter(&player_id)
        .filter(|e| e.effect_type == EffectType::ProductionRune)
        .map(|e| e.effect_id)
        .collect();
    
    for effect_id in effects_to_remove {
        ctx.db.active_consumable_effect().effect_id().delete(&effect_id);
        log::info!("Removed production rune zone effect {} from player {:?}", effect_id, player_id);
    }
}

/// Applies agrarian rune zone effect
fn apply_agrarian_rune_effect(ctx: &ReducerContext, player_id: Identity) -> Result<(), String> {
    let current_time = ctx.timestamp;
    let very_far_future = current_time + TimeDuration::from_micros(365 * 24 * 60 * 60 * 1_000_000i64);
    
    let effect = ActiveConsumableEffect {
        effect_id: 0,
        player_id,
        target_player_id: None,
        item_def_id: 0,
        consuming_item_instance_id: None,
        started_at: current_time,
        ends_at: very_far_future,
        total_amount: None,
        amount_applied_so_far: None,
        effect_type: EffectType::AgrarianRune,
        tick_interval_micros: 1_000_000,
        next_tick_at: current_time + TimeDuration::from_micros(1_000_000),
    };
    
    match ctx.db.active_consumable_effect().try_insert(effect) {
        Ok(inserted) => {
            log::info!("Applied agrarian rune zone effect {} to player {:?}", inserted.effect_id, player_id);
            Ok(())
        }
        Err(e) => {
            log::error!("Failed to apply agrarian rune effect: {:?}", e);
            Err("Failed to apply agrarian rune effect".to_string())
        }
    }
}

/// Removes agrarian rune zone effect
fn remove_agrarian_rune_effect(ctx: &ReducerContext, player_id: Identity) {
    let effects_to_remove: Vec<_> = ctx.db.active_consumable_effect().player_id().filter(&player_id)
        .filter(|e| e.effect_type == EffectType::AgrarianRune)
        .map(|e| e.effect_id)
        .collect();
    
    for effect_id in effects_to_remove {
        ctx.db.active_consumable_effect().effect_id().delete(&effect_id);
        log::info!("Removed agrarian rune zone effect {} from player {:?}", effect_id, player_id);
    }
}

/// Applies memory rune zone effect
fn apply_memory_rune_effect(ctx: &ReducerContext, player_id: Identity) -> Result<(), String> {
    let current_time = ctx.timestamp;
    let very_far_future = current_time + TimeDuration::from_micros(365 * 24 * 60 * 60 * 1_000_000i64);
    
    let effect = ActiveConsumableEffect {
        effect_id: 0,
        player_id,
        target_player_id: None,
        item_def_id: 0,
        consuming_item_instance_id: None,
        started_at: current_time,
        ends_at: very_far_future,
        total_amount: None,
        amount_applied_so_far: None,
        effect_type: EffectType::MemoryRune,
        tick_interval_micros: 1_000_000,
        next_tick_at: current_time + TimeDuration::from_micros(1_000_000),
    };
    
    match ctx.db.active_consumable_effect().try_insert(effect) {
        Ok(inserted) => {
            log::info!("Applied memory rune zone effect {} to player {:?}", inserted.effect_id, player_id);
            Ok(())
        }
        Err(e) => {
            log::error!("Failed to apply memory rune effect: {:?}", e);
            Err("Failed to apply memory rune effect".to_string())
        }
    }
}

/// Removes memory rune zone effect
fn remove_memory_rune_effect(ctx: &ReducerContext, player_id: Identity) {
    let effects_to_remove: Vec<_> = ctx.db.active_consumable_effect().player_id().filter(&player_id)
        .filter(|e| e.effect_type == EffectType::MemoryRune)
        .map(|e| e.effect_id)
        .collect();
    
    for effect_id in effects_to_remove {
        ctx.db.active_consumable_effect().effect_id().delete(&effect_id);
        log::info!("Removed memory rune zone effect {} from player {:?}", effect_id, player_id);
    }
}

// Hot Spring Effect Management
// ============================

/// Checks if a player is currently standing in a hot spring (tile-based detection)
pub fn is_player_in_hot_spring(ctx: &ReducerContext, player_x: f32, player_y: f32) -> bool {
    // Convert player position to tile coordinates
    let tile_x = (player_x / crate::TILE_SIZE_PX as f32).floor() as i32;
    let tile_y = (player_y / crate::TILE_SIZE_PX as f32).floor() as i32;
    
    // Check if the player is standing on a HotSpringWater tile
    if let Some(tile_type) = crate::get_tile_type_at_position(ctx, tile_x, tile_y) {
        return tile_type == crate::TileType::HotSpringWater;
    }
    
    false
}

/// Updates hot spring healing effect for a player based on their position
/// Hot springs provide healing and cold immunity, but NOT cozy effect
pub fn update_player_hot_spring_status(ctx: &ReducerContext, player_id: Identity, player_x: f32, player_y: f32) -> Result<(), String> {
    let is_in_hot_spring = is_player_in_hot_spring(ctx, player_x, player_y);
    let has_hot_spring_effect = player_has_hot_spring_effect(ctx, player_id);
    
    log::debug!("Hot spring status check for player {:?}: in_hot_spring={}, has_hot_spring_effect={}", 
        player_id, is_in_hot_spring, has_hot_spring_effect);
    
    if is_in_hot_spring {
        // Apply hot spring effect if not present (provides healing + cold immunity)
        if !has_hot_spring_effect {
            log::info!("Applying hot spring effect to player {:?} (healing + cold immunity)", player_id);
            apply_hot_spring_effect(ctx, player_id)?;
        }
    } else {
        // Remove hot spring effect when player leaves
        if has_hot_spring_effect {
            log::info!("Removing hot spring effect from player {:?}", player_id);
            remove_hot_spring_effect(ctx, player_id);
        }
    }
    
    Ok(())
}

/// Checks if a player currently has the hot spring effect active
pub fn player_has_hot_spring_effect(ctx: &ReducerContext, player_id: Identity) -> bool {
    ctx.db.active_consumable_effect().player_id().filter(&player_id)
        .any(|effect| effect.effect_type == EffectType::HotSpring)
}

/// Applies hot spring healing effect to a player
fn apply_hot_spring_effect(ctx: &ReducerContext, player_id: Identity) -> Result<(), String> {
    let current_time = ctx.timestamp;
    // Set a very far future time (1 year from now) - effectively permanent
    let very_far_future = current_time + TimeDuration::from_micros(365 * 24 * 60 * 60 * 1_000_000i64);
    
    let hot_spring_effect = ActiveConsumableEffect {
        effect_id: 0, // auto_inc
        player_id,
        target_player_id: None,
        item_def_id: 0, // Not from an item
        consuming_item_instance_id: None,
        started_at: current_time,
        ends_at: very_far_future, // Effectively permanent
        total_amount: None, // No accumulation for hot spring effect
        amount_applied_so_far: None,
        effect_type: EffectType::HotSpring,
        tick_interval_micros: 1_000_000, // 1 second ticks
        next_tick_at: current_time + TimeDuration::from_micros(1_000_000),
    };
    
    match ctx.db.active_consumable_effect().try_insert(hot_spring_effect) {
        Ok(inserted_effect) => {
            log::info!("Applied hot spring healing effect {} to player {:?}", inserted_effect.effect_id, player_id);
            Ok(())
        }
        Err(e) => {
            log::error!("Failed to apply hot spring effect to player {:?}: {:?}", player_id, e);
            Err("Failed to apply hot spring effect".to_string())
        }
    }
}

/// Removes hot spring effect from a player
fn remove_hot_spring_effect(ctx: &ReducerContext, player_id: Identity) {
    let mut effects_to_remove = Vec::new();
    for effect in ctx.db.active_consumable_effect().player_id().filter(&player_id) {
        if effect.effect_type == EffectType::HotSpring {
            effects_to_remove.push(effect.effect_id);
        }
    }
    
    for effect_id in effects_to_remove {
        ctx.db.active_consumable_effect().effect_id().delete(&effect_id);
        log::info!("Removed hot spring effect {} from player {:?}", effect_id, player_id);
    }
}

// Fumarole Effect Management
// ===========================

/// Fumarole warmth protection radius (in pixels)
/// Players within this radius of a fumarole are protected from warmth decay
pub const FUMAROLE_WARMTH_PROTECTION_RADIUS: f32 = 600.0; // 600px = ~12 tiles radius (3x original)
const FUMAROLE_WARMTH_PROTECTION_RADIUS_SQ: f32 = FUMAROLE_WARMTH_PROTECTION_RADIUS * FUMAROLE_WARMTH_PROTECTION_RADIUS;

/// Checks if a player is currently near a fumarole (entity-based detection)
pub fn is_player_near_fumarole(ctx: &ReducerContext, player_x: f32, player_y: f32) -> bool {
    use crate::fumarole::fumarole as FumaroleTableTrait;
    
    // Check all fumaroles to see if player is within protection radius
    for fumarole in ctx.db.fumarole().iter() {
        let dx = player_x - fumarole.pos_x;
        let dy = player_y - fumarole.pos_y;
        let distance_sq = dx * dx + dy * dy;
        
        if distance_sq <= FUMAROLE_WARMTH_PROTECTION_RADIUS_SQ {
            return true;
        }
    }
    
    false
}

/// Updates fumarole warmth protection effect for a player based on their position
/// Fumaroles provide complete warmth decay protection (nullifies warmth loss)
pub fn update_player_fumarole_status(ctx: &ReducerContext, player_id: Identity, player_x: f32, player_y: f32) -> Result<(), String> {
    let is_near_fumarole = is_player_near_fumarole(ctx, player_x, player_y);
    let has_fumarole_effect = player_has_fumarole_effect(ctx, player_id);
    
    log::debug!("Fumarole status check for player {:?}: near_fumarole={}, has_fumarole_effect={}", 
        player_id, is_near_fumarole, has_fumarole_effect);
    
    if is_near_fumarole {
        // Apply fumarole effect if not present (provides warmth protection)
        if !has_fumarole_effect {
            log::info!("Applying fumarole warmth protection effect to player {:?}", player_id);
            apply_fumarole_effect(ctx, player_id)?;
        }
    } else {
        // Remove fumarole effect when player leaves radius
        if has_fumarole_effect {
            log::info!("Removing fumarole warmth protection effect from player {:?}", player_id);
            remove_fumarole_effect(ctx, player_id);
        }
    }
    
    Ok(())
}

/// Checks if a player currently has the fumarole effect active
pub fn player_has_fumarole_effect(ctx: &ReducerContext, player_id: Identity) -> bool {
    ctx.db.active_consumable_effect().player_id().filter(&player_id)
        .any(|effect| effect.effect_type == EffectType::Fumarole)
}

/// Applies fumarole warmth protection effect to a player
fn apply_fumarole_effect(ctx: &ReducerContext, player_id: Identity) -> Result<(), String> {
    let current_time = ctx.timestamp;
    // Set a very far future time (1 year from now) - effectively permanent
    let very_far_future = current_time + TimeDuration::from_micros(365 * 24 * 60 * 60 * 1_000_000i64);
    
    let fumarole_effect = ActiveConsumableEffect {
        effect_id: 0, // auto_inc
        player_id,
        target_player_id: None,
        item_def_id: 0, // Not from an item
        consuming_item_instance_id: None,
        started_at: current_time,
        ends_at: very_far_future, // Effectively permanent
        total_amount: None, // No accumulation for fumarole effect
        amount_applied_so_far: None,
        effect_type: EffectType::Fumarole,
        tick_interval_micros: 1_000_000, // 1 second ticks
        next_tick_at: current_time + TimeDuration::from_micros(1_000_000),
    };
    
    match ctx.db.active_consumable_effect().try_insert(fumarole_effect) {
        Ok(inserted_effect) => {
            log::info!("Applied fumarole warmth protection effect {} to player {:?}", inserted_effect.effect_id, player_id);
            Ok(())
        }
        Err(e) => {
            log::error!("Failed to apply fumarole effect to player {:?}: {:?}", player_id, e);
            Err("Failed to apply fumarole effect".to_string())
        }
    }
}

/// Removes fumarole effect from a player
fn remove_fumarole_effect(ctx: &ReducerContext, player_id: Identity) {
    let mut effects_to_remove = Vec::new();
    for effect in ctx.db.active_consumable_effect().player_id().filter(&player_id) {
        if effect.effect_type == EffectType::Fumarole {
            effects_to_remove.push(effect.effect_id);
        }
    }
    
    for effect_id in effects_to_remove {
        ctx.db.active_consumable_effect().effect_id().delete(&effect_id);
        log::info!("Removed fumarole warmth protection effect {} from player {:?}", effect_id, player_id);
    }
}

// Safe Zone Effect Management
// ============================

/// Safe zone radius multipliers - safe zone extends beyond interaction radius
/// Central compound gets larger protection, substations get standard protection
/// These MUST match the building restriction radii to prevent abuse
pub const SAFE_ZONE_RADIUS_MULTIPLIER_CENTRAL: f32 = 8.75; // 8.75x for central compound (station_id = 0) - scaled 25% from 7.0 to match larger asphalt
pub const SAFE_ZONE_RADIUS_MULTIPLIER_SUBSTATION: f32 = 3.0; // 3x for substations (station_id 1-4) - 1/3 of original 10x

/// Checks if a player is currently within a safe zone (near ALK monuments)
/// Safe zones protect from player/animal/projectile damage but NOT environmental damage (except burn)
/// Safe zone radius matches building restriction radius to prevent abuse
pub fn is_player_in_safe_zone(ctx: &ReducerContext, player_x: f32, player_y: f32) -> bool {
    use crate::alk::alk_station as AlkStationTableTrait;
    use crate::monument_part as MonumentPartTableTrait;
    use crate::MonumentType;
    use crate::whale_bone_graveyard::is_position_in_whale_bone_graveyard_safe_zone;
    use crate::hunting_village::is_position_in_hunting_village_safe_zone;
    
    // Fishing village safe zone radius - communal protection area
    const FISHING_VILLAGE_SAFE_ZONE_RADIUS: f32 = 600.0; // Protective radius around the campfire
    const FISHING_VILLAGE_SAFE_ZONE_RADIUS_SQ: f32 = FISHING_VILLAGE_SAFE_ZONE_RADIUS * FISHING_VILLAGE_SAFE_ZONE_RADIUS;
    
    // Check all ALK stations (central compound + 4 substations)
    for station in ctx.db.alk_station().iter() {
        // Skip inactive stations
        if !station.is_active {
            continue;
        }
        
        // Calculate distance squared between player and station
        let dx = player_x - station.world_pos_x;
        let dy = player_y - station.world_pos_y;
        let distance_sq = dx * dx + dy * dy;
        
        // Safe zone radius matches building restriction radius
        // Central compound (station_id = 0): 8.75x interaction_radius (~2188px)
        // Substations (station_id 1-4): 3x interaction_radius (~600px)
        let multiplier = if station.station_id == 0 {
            SAFE_ZONE_RADIUS_MULTIPLIER_CENTRAL
        } else {
            SAFE_ZONE_RADIUS_MULTIPLIER_SUBSTATION
        };
        let safe_zone_radius = station.interaction_radius * multiplier;
        let safe_zone_radius_sq = safe_zone_radius * safe_zone_radius;
        
        // Check if player is within safe zone radius
        if distance_sq <= safe_zone_radius_sq {
            return true;
        }
    }
    
    // Check fishing village communal safe zone
    // The village center provides protection from PvP and hostile animal attacks
    for part in ctx.db.monument_part().iter() {
        // Only the center piece creates the safe zone
        if part.monument_type != MonumentType::FishingVillage || !part.is_center {
            continue;
        }
        let dx = player_x - part.world_x;
        let dy = player_y - part.world_y;
        let distance_sq = dx * dx + dy * dy;
        
        if distance_sq <= FISHING_VILLAGE_SAFE_ZONE_RADIUS_SQ {
            return true;
        }
    }
    
    // Check whale bone graveyard safe zone
    // The ancient graveyard and hermit's camp provide protection
    if is_position_in_whale_bone_graveyard_safe_zone(ctx, player_x, player_y) {
        return true;
    }
    
    // Check hunting village safe zone
    // The boreal hunting village provides a safe haven for travelers
    if is_position_in_hunting_village_safe_zone(ctx, player_x, player_y) {
        return true;
    }
    
    false
}

/// Container access timeout in seconds for safe zone exclusivity
const CONTAINER_ACCESS_TIMEOUT_SECS: u64 = 60;

/// Validates if a player can access a container in a safe zone
/// In safe zones only, containers enforce exclusivity - only one player can use them at a time
/// This prevents griefing by multiple players trying to use the same monument containers
/// 
/// Returns Ok(()) if access is allowed, Err(message) if blocked by another player
pub fn validate_safe_zone_container_access(
    ctx: &ReducerContext,
    container_pos_x: f32,
    container_pos_y: f32,
    active_user_id: Option<Identity>,
    active_user_since: Option<spacetimedb::Timestamp>,
) -> Result<(), String> {
    // Only enforce exclusivity in safe zones
    if !is_player_in_safe_zone(ctx, container_pos_x, container_pos_y) {
        return Ok(());
    }
    
    // Check if another player is currently using this container
    if let Some(user_id) = active_user_id {
        // Same player is already using it - allow access
        if user_id == ctx.sender() {
            return Ok(());
        }
        
        // Different player - check if the lock has timed out
        if let Some(since) = active_user_since {
            if let Some(elapsed) = ctx.timestamp.duration_since(since) {
            if elapsed.as_secs() < CONTAINER_ACCESS_TIMEOUT_SECS {
                return Err("Another player is currently using this container. Please wait or try another one.".to_string());
            }
            }
            // Lock has timed out (or time went backwards), allow access (and let the caller update the active user)
        }
    }
    
    Ok(())
}

/// Updates safe zone effect for a player based on their position
/// Safe zones protect from player/animal/projectile damage but NOT environmental damage (except burn)
pub fn update_player_safe_zone_status(ctx: &ReducerContext, player_id: Identity, player_x: f32, player_y: f32) -> Result<(), String> {
    let is_in_safe_zone = is_player_in_safe_zone(ctx, player_x, player_y);
    let has_safe_zone_effect = player_has_safe_zone_effect(ctx, player_id);
    
    log::debug!("Safe zone status check for player {:?}: in_safe_zone={}, has_safe_zone_effect={}", 
        player_id, is_in_safe_zone, has_safe_zone_effect);
    
    if is_in_safe_zone {
        // Apply safe zone effect if not present
        if !has_safe_zone_effect {
            log::info!("Applying safe zone effect to player {:?} (protection from player/animal/projectile damage)", player_id);
            apply_safe_zone_effect(ctx, player_id)?;
        }
    } else {
        // Remove safe zone effect when player leaves
        if has_safe_zone_effect {
            log::info!("Removing safe zone effect from player {:?}", player_id);
            remove_safe_zone_effect(ctx, player_id);
        }
    }
    
    Ok(())
}

/// Checks if a player currently has the safe zone effect active
pub fn player_has_safe_zone_effect(ctx: &ReducerContext, player_id: Identity) -> bool {
    ctx.db.active_consumable_effect().player_id().filter(&player_id)
        .any(|effect| effect.effect_type == EffectType::SafeZone)
}

/// Applies safe zone effect to a player
fn apply_safe_zone_effect(ctx: &ReducerContext, player_id: Identity) -> Result<(), String> {
    let current_time = ctx.timestamp;
    // Set a very far future time (1 year from now) - effectively permanent while in zone
    let very_far_future = current_time + TimeDuration::from_micros(365 * 24 * 60 * 60 * 1_000_000i64);
    
    let safe_zone_effect = ActiveConsumableEffect {
        effect_id: 0, // auto_inc
        player_id,
        target_player_id: None,
        item_def_id: 0, // Not from an item
        consuming_item_instance_id: None,
        started_at: current_time,
        ends_at: very_far_future, // Effectively permanent while in zone
        total_amount: None, // No accumulation for safe zone effect
        amount_applied_so_far: None,
        effect_type: EffectType::SafeZone,
        tick_interval_micros: 1_000_000, // 1 second ticks (not really used)
        next_tick_at: current_time + TimeDuration::from_micros(1_000_000),
    };
    
    match ctx.db.active_consumable_effect().try_insert(safe_zone_effect) {
        Ok(inserted_effect) => {
            log::info!("Applied safe zone effect {} to player {:?}", inserted_effect.effect_id, player_id);
            Ok(())
        }
        Err(e) => {
            log::error!("Failed to apply safe zone effect to player {:?}: {:?}", player_id, e);
            Err("Failed to apply safe zone effect".to_string())
        }
    }
}

/// Removes safe zone effect from a player
fn remove_safe_zone_effect(ctx: &ReducerContext, player_id: Identity) {
    let mut effects_to_remove = Vec::new();
    for effect in ctx.db.active_consumable_effect().player_id().filter(&player_id) {
        if effect.effect_type == EffectType::SafeZone {
            effects_to_remove.push(effect.effect_id);
        }
    }
    
    for effect_id in effects_to_remove {
        ctx.db.active_consumable_effect().effect_id().delete(&effect_id);
        log::info!("Removed safe zone effect {} from player {:?}", effect_id, player_id);
    }
}

// Fishing Village Bonus Effect Management
// ============================

/// Checks if a player is currently within a fishing village bonus zone
/// Uses the fishing_village module to check position
pub fn is_player_in_fishing_village_zone(ctx: &ReducerContext, player_x: f32, player_y: f32) -> bool {
    crate::fishing_village::is_position_in_fishing_village_zone(ctx, player_x, player_y)
}

/// Updates fishing village bonus effect for a player based on their position
/// Fishing village bonus provides 2x fishing hauls and premium tier bonus
pub fn update_player_fishing_village_status(ctx: &ReducerContext, player_id: Identity, player_x: f32, player_y: f32) -> Result<(), String> {
    let is_in_fishing_village = is_player_in_fishing_village_zone(ctx, player_x, player_y);
    let has_fishing_village_effect = player_has_fishing_village_effect(ctx, player_id);
    
    log::debug!("Fishing village status check for player {:?}: in_zone={}, has_effect={}", 
        player_id, is_in_fishing_village, has_fishing_village_effect);
    
    if is_in_fishing_village {
        // Apply fishing village bonus effect if not present
        if !has_fishing_village_effect {
            log::info!("Applying fishing village bonus effect to player {:?} (2x fishing hauls)", player_id);
            apply_fishing_village_effect(ctx, player_id)?;
        }
    } else {
        // Remove fishing village bonus effect when player leaves
        if has_fishing_village_effect {
            log::info!("Removing fishing village bonus effect from player {:?}", player_id);
            remove_fishing_village_effect(ctx, player_id);
        }
    }
    
    Ok(())
}

/// Checks if a player currently has the fishing village bonus effect active
pub fn player_has_fishing_village_effect(ctx: &ReducerContext, player_id: Identity) -> bool {
    ctx.db.active_consumable_effect().player_id().filter(&player_id)
        .any(|effect| effect.effect_type == EffectType::FishingVillageBonus)
}

/// Applies fishing village bonus effect to a player
fn apply_fishing_village_effect(ctx: &ReducerContext, player_id: Identity) -> Result<(), String> {
    let current_time = ctx.timestamp;
    // Set a very far future time (1 year from now) - effectively permanent while in zone
    let very_far_future = current_time + TimeDuration::from_micros(365 * 24 * 60 * 60 * 1_000_000i64);
    
    let fishing_village_effect = ActiveConsumableEffect {
        effect_id: 0, // auto_inc
        player_id,
        target_player_id: None,
        item_def_id: 0, // Not from an item
        consuming_item_instance_id: None,
        started_at: current_time,
        ends_at: very_far_future, // Effectively permanent while in zone
        total_amount: None, // No accumulation for fishing village bonus effect
        amount_applied_so_far: None,
        effect_type: EffectType::FishingVillageBonus,
        tick_interval_micros: 1_000_000, // 1 second ticks (not really used)
        next_tick_at: current_time + TimeDuration::from_micros(1_000_000),
    };
    
    match ctx.db.active_consumable_effect().try_insert(fishing_village_effect) {
        Ok(inserted_effect) => {
            log::info!("Applied fishing village bonus effect {} to player {:?}", inserted_effect.effect_id, player_id);
            Ok(())
        }
        Err(e) => {
            log::error!("Failed to apply fishing village bonus effect to player {:?}: {:?}", player_id, e);
            Err("Failed to apply fishing village bonus effect".to_string())
        }
    }
}

/// Removes fishing village bonus effect from a player
fn remove_fishing_village_effect(ctx: &ReducerContext, player_id: Identity) {
    let mut effects_to_remove = Vec::new();
    for effect in ctx.db.active_consumable_effect().player_id().filter(&player_id) {
        if effect.effect_type == EffectType::FishingVillageBonus {
            effects_to_remove.push(effect.effect_id);
        }
    }
    
    for effect_id in effects_to_remove {
        ctx.db.active_consumable_effect().effect_id().delete(&effect_id);
        log::info!("Removed fishing village bonus effect {} from player {:?}", effect_id, player_id);
    }
}

// ============================================================================
// LAGUNOV'S GHOST EFFECT SYSTEM (SHIPWRECK PROTECTION)
// ============================================================================
// The LagunovGhost effect is applied when players are within the shipwreck
// protection radius. This is an informational effect - the actual protection
// (hostile NPCs avoiding the area) is handled by the NPC AI system.
// The effect serves as visual feedback that the player is in a protected zone.

/// Updates the Lagunov's Ghost effect for a player based on shipwreck proximity
/// Call this during player stat updates or movement processing
pub fn update_lagunov_ghost_status(ctx: &ReducerContext, player_id: Identity, player_x: f32, player_y: f32) -> Result<(), String> {
    let is_in_shipwreck_zone = crate::shipwreck::is_position_protected_by_shipwreck(ctx, player_x, player_y);
    let has_lagunov_ghost_effect = player_has_lagunov_ghost_effect(ctx, player_id);
    
    log::debug!("Lagunov's Ghost status check for player {:?}: in_zone={}, has_effect={}", 
        player_id, is_in_shipwreck_zone, has_lagunov_ghost_effect);
    
    if is_in_shipwreck_zone {
        // Apply Lagunov's Ghost effect if not present
        if !has_lagunov_ghost_effect {
            log::info!("Applying Lagunov's Ghost effect to player {:?} (shipwreck protection)", player_id);
            apply_lagunov_ghost_effect(ctx, player_id)?;
        }
    } else {
        // Remove Lagunov's Ghost effect when player leaves
        if has_lagunov_ghost_effect {
            log::info!("Removing Lagunov's Ghost effect from player {:?}", player_id);
            remove_lagunov_ghost_effect(ctx, player_id);
        }
    }
    
    Ok(())
}

/// Checks if a player currently has the Lagunov's Ghost effect active
pub fn player_has_lagunov_ghost_effect(ctx: &ReducerContext, player_id: Identity) -> bool {
    ctx.db.active_consumable_effect().player_id().filter(&player_id)
        .any(|effect| effect.effect_type == EffectType::LagunovGhost)
}

/// Returns true if the player is currently holding a hot combat ladle (not expired).
/// Checks the equipped item's item_data directly — no ActiveConsumableEffect needed.
/// Also expires the ladle if its 30 minutes are up.
pub fn player_has_hot_combat_ladle_effect(ctx: &ReducerContext, player_id: Identity) -> bool {
    use crate::combat_ladle_heating::{is_combat_ladle, is_combat_ladle_hot_at, check_and_expire_hot_ladle};
    use crate::active_equipment::active_equipment as ActiveEquipmentTableTrait;

    let equipment = match ctx.db.active_equipment().player_identity().find(&player_id) {
        Some(eq) => eq,
        None => return false,
    };
    let equipped_instance_id = match equipment.equipped_item_instance_id {
        Some(id) => id,
        None => return false,
    };
    let equipped_item = match ctx.db.inventory_item().instance_id().find(equipped_instance_id) {
        Some(item) => item,
        None => return false,
    };
    let item_def = match ctx.db.item_definition().id().find(equipped_item.item_def_id) {
        Some(def) => def,
        None => return false,
    };
    if !is_combat_ladle(&item_def.name) { return false; }

    let current_micros = ctx.timestamp.to_micros_since_unix_epoch();
    if is_combat_ladle_hot_at(&equipped_item, current_micros) {
        true
    } else {
        // If it was hot but expired, clear the hot state
        check_and_expire_hot_ladle(ctx, &equipped_item);
        false
    }
}

/// Applies Lagunov's Ghost effect to a player
fn apply_lagunov_ghost_effect(ctx: &ReducerContext, player_id: Identity) -> Result<(), String> {
    let current_time = ctx.timestamp;
    // Set a very far future time (1 year from now) - effectively permanent while in zone
    let very_far_future = current_time + TimeDuration::from_micros(365 * 24 * 60 * 60 * 1_000_000i64);
    
    let lagunov_ghost_effect = ActiveConsumableEffect {
        effect_id: 0, // auto_inc
        player_id,
        target_player_id: None,
        item_def_id: 0, // Not from an item
        consuming_item_instance_id: None,
        started_at: current_time,
        ends_at: very_far_future,
        total_amount: None,
        amount_applied_so_far: None,
        effect_type: EffectType::LagunovGhost,
        tick_interval_micros: 0, // No tick processing needed
        next_tick_at: very_far_future,
    };
    
    match ctx.db.active_consumable_effect().try_insert(lagunov_ghost_effect) {
        Ok(_) => {
            log::info!("Applied Lagunov's Ghost effect to player {:?}", player_id);
            Ok(())
        }
        Err(e) => {
            log::error!("Failed to apply Lagunov's Ghost effect to player {:?}: {:?}", player_id, e);
            Err("Failed to apply Lagunov's Ghost effect".to_string())
        }
    }
}

/// Removes Lagunov's Ghost effect from a player
fn remove_lagunov_ghost_effect(ctx: &ReducerContext, player_id: Identity) {
    let mut effects_to_remove = Vec::new();
    for effect in ctx.db.active_consumable_effect().player_id().filter(&player_id) {
        if effect.effect_type == EffectType::LagunovGhost {
            effects_to_remove.push(effect.effect_id);
        }
    }
    
    for effect_id in effects_to_remove {
        ctx.db.active_consumable_effect().effect_id().delete(&effect_id);
        log::info!("Removed Lagunov's Ghost effect {} from player {:?}", effect_id, player_id);
    }
}

// ============================================================================
// COOKING STATION PROXIMITY EFFECT SYSTEM
// ============================================================================
// The NearCookingStation effect enables advanced recipe crafting when players
// are within 100px of a cooking station. The effect is applied/removed based
// on proximity checks during player stat updates.

/// Updates the NearCookingStation effect for a player based on proximity
/// Call this during player stat updates or movement processing
pub fn update_cooking_station_proximity(ctx: &ReducerContext, player_id: Identity, player_x: f32, player_y: f32) -> Result<(), String> {
    // Check if player is near a cooking station
    let is_near = crate::cooking_station::is_player_near_cooking_station(ctx, player_x, player_y);
    let has_cooking_station_effect = player_has_cooking_station_effect(ctx, player_id);
    
    if is_near {
        // Apply cooking station effect if not already active
        if !has_cooking_station_effect {
            log::info!("Applying cooking station effect to player {:?}", player_id);
            apply_cooking_station_effect(ctx, player_id)?;
        }
    } else {
        // Remove cooking station effect when player leaves
        if has_cooking_station_effect {
            log::info!("Removing cooking station effect from player {:?}", player_id);
            remove_cooking_station_effect(ctx, player_id);
        }
    }
    
    Ok(())
}

/// Checks if a player currently has the cooking station proximity effect active
pub fn player_has_cooking_station_effect(ctx: &ReducerContext, player_id: Identity) -> bool {
    ctx.db.active_consumable_effect().player_id().filter(&player_id)
        .any(|effect| effect.effect_type == EffectType::NearCookingStation)
}

/// Applies cooking station proximity effect to a player
fn apply_cooking_station_effect(ctx: &ReducerContext, player_id: Identity) -> Result<(), String> {
    let current_time = ctx.timestamp;
    // Set a very far future time (1 year from now) - effectively permanent while in range
    let very_far_future = current_time + TimeDuration::from_micros(365 * 24 * 60 * 60 * 1_000_000i64);
    
    let cooking_station_effect = ActiveConsumableEffect {
        effect_id: 0, // auto_inc
        player_id,
        target_player_id: None,
        item_def_id: 0, // Not from an item
        consuming_item_instance_id: None,
        started_at: current_time,
        ends_at: very_far_future, // Effectively permanent while in range
        total_amount: None, // No accumulation
        amount_applied_so_far: None,
        effect_type: EffectType::NearCookingStation,
        tick_interval_micros: 1_000_000, // 1 second ticks (not really used)
        next_tick_at: current_time + TimeDuration::from_micros(1_000_000),
    };
    
    match ctx.db.active_consumable_effect().try_insert(cooking_station_effect) {
        Ok(inserted_effect) => {
            log::info!("Applied cooking station effect {} to player {:?}", inserted_effect.effect_id, player_id);
            Ok(())
        }
        Err(e) => {
            log::error!("Failed to apply cooking station effect to player {:?}: {:?}", player_id, e);
            Err("Failed to apply cooking station effect".to_string())
        }
    }
}

/// Removes cooking station proximity effect from a player
fn remove_cooking_station_effect(ctx: &ReducerContext, player_id: Identity) {
    let mut effects_to_remove = Vec::new();
    for effect in ctx.db.active_consumable_effect().player_id().filter(&player_id) {
        if effect.effect_type == EffectType::NearCookingStation {
            effects_to_remove.push(effect.effect_id);
        }
    }
    
    for effect_id in effects_to_remove {
        ctx.db.active_consumable_effect().effect_id().delete(&effect_id);
        log::info!("Removed cooking station effect {} from player {:?}", effect_id, player_id);
    }
}

// ============================================================================
// BROTH EFFECT SYSTEM
// ============================================================================
// Broths provide powerful 1-hour buffs that DO NOT persist through death.
// Effects are applied when consuming brewed items from the broth pot.

/// Duration for broth effects in microseconds (1 hour = 3600 seconds)
pub const BROTH_EFFECT_DURATION_MICROS: i64 = 3600 * 1_000_000;

/// Broth effect magnitudes
pub const SPEED_BOOST_MULTIPLIER: f32 = 1.25;         // 25% faster movement
pub const STAMINA_BOOST_DRAIN_REDUCTION: f32 = 0.5;   // 50% reduced hunger/thirst drain
pub const WARMTH_BOOST_DECAY_REDUCTION: f32 = 0.5;    // 50% reduced warmth decay
pub const COLD_RESISTANCE_REDUCTION: f32 = 0.5;       // 50% reduced cold damage
pub const FIRE_RESISTANCE_REDUCTION: f32 = 0.5;       // 50% reduced fire/burn damage
pub const POISON_RESISTANCE_REDUCTION: f32 = 0.75;    // 75% reduced poison/venom damage
pub const HARVEST_BOOST_MULTIPLIER: f32 = 1.5;        // 50% bonus yield from mining/chopping
pub const INTOXICATED_SPEED_PENALTY: f32 = 0.85;      // 15% slower movement when drunk
pub const PASSIVE_HEALTH_REGEN_TOTAL: f32 = 50.0;     // Total health regenerated over 1 hour (slow regen)
pub const POISON_DOT_DAMAGE_PER_TICK: f32 = 2.0;      // Damage per tick for poisoned status
pub const POISON_COATING_DURATION_SECS: f32 = 10.0;   // Duration of poison inflicted by coated weapons

// ============================================================================
// APPLY FUNCTIONS FOR BROTH EFFECTS
// ============================================================================

/// Applies a broth effect to a player based on the brew category
/// Called when consuming AI-generated brews
/// 
/// === BROTH EFFECT CATEGORIES (1-hour buffs, cleared on death) ===
/// - alcoholic: Intoxicated (drunk effect, 15% speed penalty)
/// - poison: Poisoned (DOT, self-harm for assassination attempts gone wrong)
/// - performance_enhancer: SpeedBoost (25% faster) + StaminaBoost (50% reduced drain)
/// - psychoactive: NightVision (enhanced night vision)
/// - warming_broth: WarmthBoost (50% reduced warmth decay)
/// - cold_resistant_brew: ColdResistance (50% reduced cold damage)
/// - fire_resistant_brew: FireResistance (50% reduced fire/burn damage)
/// - antidote_brew: PoisonResistance (75% reduced poison/venom damage, clears existing poison)
/// - endurance_broth: StaminaBoost (50% reduced hunger/thirst drain)
/// - healing_elixir: PassiveHealthRegen (slow 1-hour health regeneration)
/// - harvester_brew: HarvestBoost (50% bonus mining/chopping yield)
/// - weapon_coating: PoisonCoating (attacks inflict poison on targets)
pub fn apply_broth_effect_from_category(
    ctx: &ReducerContext, 
    player_id: Identity, 
    category: &str,
    item_def_id: u64,
) -> Result<(), String> {
    match category {
        "alcoholic" => apply_intoxicated_effect(ctx, player_id, item_def_id),
        "poison" => {
            // Poison brews ONLY apply PoisonCoating effect (weapon coating buff)
            // NO consumable stats (health/hunger/thirst) - strictly a weapon coating buff
            // NO Poisoned DOT - this is for coating weapons, not self-harm
            apply_poison_coating_effect(ctx, player_id, item_def_id) // 1 hour weapon coating
        },
        "performance_enhancer" => {
            // Performance enhancers give both speed and stamina boosts
            apply_speed_boost_effect(ctx, player_id, item_def_id)?;
            apply_stamina_boost_effect(ctx, player_id, item_def_id)
        },
        "psychoactive" => apply_night_vision_effect(ctx, player_id, item_def_id),
        
        // === NEW BROTH CATEGORIES (1-hour buffs, cleared on death) ===
        "warming_broth" => apply_warmth_boost_effect(ctx, player_id, item_def_id),
        "cold_resistant_brew" => apply_cold_resistance_effect(ctx, player_id, item_def_id),
        "fire_resistant_brew" => apply_fire_resistance_effect(ctx, player_id, item_def_id),
        "antidote_brew" => apply_poison_resistance_effect(ctx, player_id, item_def_id),
        "endurance_broth" => apply_stamina_boost_effect(ctx, player_id, item_def_id),
        "healing_elixir" => apply_passive_health_regen_effect(ctx, player_id, item_def_id),
        "harvester_brew" => apply_harvest_boost_effect(ctx, player_id, item_def_id),
        "weapon_coating" => apply_poison_coating_effect(ctx, player_id, item_def_id),
        
        "utility_brew" => {
            // Utility brews check for specific effect types from AI
            // For now, default to passive health regen
            apply_passive_health_regen_effect(ctx, player_id, item_def_id)
        },
        _ => {
            // medicinal_tea, healing_broth, nutritional_drink, maritime_specialty, technological
            // These don't apply special effects - their benefits are from consumable stats only
            log::debug!("[BrothEffect] Category '{}' has no special effect - using consumable stats", category);
            Ok(())
        }
    }
}

/// Applies a specific broth effect based on effect type string from AI
pub fn apply_broth_effect_from_type(
    ctx: &ReducerContext,
    player_id: Identity,
    effect_type_str: &str,
    item_def_id: u64,
) -> Result<(), String> {
    match effect_type_str {
        "Intoxicated" => apply_intoxicated_effect(ctx, player_id, item_def_id),
        "Poisoned" => apply_poisoned_effect(ctx, player_id, item_def_id, 30.0),
        "SpeedBoost" => apply_speed_boost_effect(ctx, player_id, item_def_id),
        "StaminaBoost" => apply_stamina_boost_effect(ctx, player_id, item_def_id),
        "NightVision" => apply_night_vision_effect(ctx, player_id, item_def_id),
        "WarmthBoost" => apply_warmth_boost_effect(ctx, player_id, item_def_id),
        "ColdResistance" => apply_cold_resistance_effect(ctx, player_id, item_def_id),
        "PoisonResistance" => apply_poison_resistance_effect(ctx, player_id, item_def_id),
        "FireResistance" => apply_fire_resistance_effect(ctx, player_id, item_def_id),
        "PoisonCoating" => apply_poison_coating_effect(ctx, player_id, item_def_id),
        "PassiveHealthRegen" => apply_passive_health_regen_effect(ctx, player_id, item_def_id),
        "HarvestBoost" => apply_harvest_boost_effect(ctx, player_id, item_def_id),
        _ => {
            log::warn!("[BrothEffect] Unknown effect type: {}", effect_type_str);
            Ok(())
        }
    }
}

/// Applies intoxicated (drunk) effect - movement wobble, visual effects
pub fn apply_intoxicated_effect(ctx: &ReducerContext, player_id: Identity, item_def_id: u64) -> Result<(), String> {
    // Remove any existing intoxicated effect first (refresh)
    cancel_broth_effect(ctx, player_id, EffectType::Intoxicated);
    
    let current_time = ctx.timestamp;
    let ends_at = current_time + TimeDuration::from_micros(BROTH_EFFECT_DURATION_MICROS);
    
    let effect = ActiveConsumableEffect {
        effect_id: 0, // auto_inc
        player_id,
        target_player_id: None,
        item_def_id,
        consuming_item_instance_id: None,
        started_at: current_time,
        ends_at,
        total_amount: Some(0.0), // No accumulation needed
        amount_applied_so_far: Some(0.0),
        effect_type: EffectType::Intoxicated,
        tick_interval_micros: 1_000_000, // 1 second
        next_tick_at: current_time + TimeDuration::from_micros(1_000_000),
    };
    
    match ctx.db.active_consumable_effect().try_insert(effect) {
        Ok(e) => {
            log::info!("[BrothEffect] Applied Intoxicated effect {} to player {:?} (1 hour)", e.effect_id, player_id);
            Ok(())
        }
        Err(e) => {
            log::error!("[BrothEffect] Failed to apply Intoxicated effect: {:?}", e);
            Err("Failed to apply intoxicated effect".to_string())
        }
    }
}

/// Applies poisoned DOT effect - damage over time from consuming poison or being hit by poisoned weapons
pub fn apply_poisoned_effect(
    ctx: &ReducerContext, 
    player_id: Identity, 
    item_def_id: u64,
    duration_secs: f32,
) -> Result<(), String> {
    // NOTE: Poison resistance is applied per-tick in process_active_consumable_effects_tick
    // Do NOT reduce duration here to avoid double-dipping the resistance bonus
    // The 75% damage reduction per tick is the intended resistance behavior
    
    if duration_secs < 1.0 {
        log::info!("[BrothEffect] Poison duration too short for player {:?}", player_id);
        return Ok(());
    }
    
    let current_time = ctx.timestamp;
    let duration_micros = (duration_secs * 1_000_000.0) as i64;
    let ends_at = current_time + TimeDuration::from_micros(duration_micros);
    let total_damage = POISON_DOT_DAMAGE_PER_TICK * duration_secs;
    
    let effect = ActiveConsumableEffect {
        effect_id: 0,
        player_id,
        target_player_id: None,
        item_def_id,
        consuming_item_instance_id: None,
        started_at: current_time,
        ends_at,
        total_amount: Some(total_damage),
        amount_applied_so_far: Some(0.0),
        effect_type: EffectType::Poisoned,
        tick_interval_micros: 1_000_000, // 1 damage tick per second
        next_tick_at: current_time + TimeDuration::from_micros(1_000_000),
    };
    
    match ctx.db.active_consumable_effect().try_insert(effect) {
        Ok(e) => {
            log::info!("[BrothEffect] Applied Poisoned effect {} to player {:?} ({:.1}s, {:.1} total damage)", 
                e.effect_id, player_id, duration_secs, total_damage);
            Ok(())
        }
        Err(e) => {
            log::error!("[BrothEffect] Failed to apply Poisoned effect: {:?}", e);
            Err("Failed to apply poisoned effect".to_string())
        }
    }
}

/// Applies speed boost effect - 25% faster movement for 1 hour
pub fn apply_speed_boost_effect(ctx: &ReducerContext, player_id: Identity, item_def_id: u64) -> Result<(), String> {
    cancel_broth_effect(ctx, player_id, EffectType::SpeedBoost);
    
    let current_time = ctx.timestamp;
    let ends_at = current_time + TimeDuration::from_micros(BROTH_EFFECT_DURATION_MICROS);
    
    let effect = ActiveConsumableEffect {
        effect_id: 0,
        player_id,
        target_player_id: None,
        item_def_id,
        consuming_item_instance_id: None,
        started_at: current_time,
        ends_at,
        total_amount: Some(0.0),
        amount_applied_so_far: Some(0.0),
        effect_type: EffectType::SpeedBoost,
        tick_interval_micros: 1_000_000,
        next_tick_at: current_time + TimeDuration::from_micros(1_000_000),
    };
    
    match ctx.db.active_consumable_effect().try_insert(effect) {
        Ok(e) => {
            log::info!("[BrothEffect] Applied SpeedBoost effect {} to player {:?} (1 hour, {}x speed)", 
                e.effect_id, player_id, SPEED_BOOST_MULTIPLIER);
            Ok(())
        }
        Err(e) => {
            log::error!("[BrothEffect] Failed to apply SpeedBoost effect: {:?}", e);
            Err("Failed to apply speed boost effect".to_string())
        }
    }
}

/// Applies stamina boost effect - 50% reduced hunger/thirst drain for 1 hour
pub fn apply_stamina_boost_effect(ctx: &ReducerContext, player_id: Identity, item_def_id: u64) -> Result<(), String> {
    cancel_broth_effect(ctx, player_id, EffectType::StaminaBoost);
    
    let current_time = ctx.timestamp;
    let ends_at = current_time + TimeDuration::from_micros(BROTH_EFFECT_DURATION_MICROS);
    
    let effect = ActiveConsumableEffect {
        effect_id: 0,
        player_id,
        target_player_id: None,
        item_def_id,
        consuming_item_instance_id: None,
        started_at: current_time,
        ends_at,
        total_amount: Some(0.0),
        amount_applied_so_far: Some(0.0),
        effect_type: EffectType::StaminaBoost,
        tick_interval_micros: 1_000_000,
        next_tick_at: current_time + TimeDuration::from_micros(1_000_000),
    };
    
    match ctx.db.active_consumable_effect().try_insert(effect) {
        Ok(e) => {
            log::info!("[BrothEffect] Applied StaminaBoost effect {} to player {:?} (1 hour, {}x drain)", 
                e.effect_id, player_id, STAMINA_BOOST_DRAIN_REDUCTION);
            Ok(())
        }
        Err(e) => {
            log::error!("[BrothEffect] Failed to apply StaminaBoost effect: {:?}", e);
            Err("Failed to apply stamina boost effect".to_string())
        }
    }
}

/// Applies night vision effect - enhanced vision at night for 1 hour
pub fn apply_night_vision_effect(ctx: &ReducerContext, player_id: Identity, item_def_id: u64) -> Result<(), String> {
    cancel_broth_effect(ctx, player_id, EffectType::NightVision);
    
    let current_time = ctx.timestamp;
    let ends_at = current_time + TimeDuration::from_micros(BROTH_EFFECT_DURATION_MICROS);
    
    let effect = ActiveConsumableEffect {
        effect_id: 0,
        player_id,
        target_player_id: None,
        item_def_id,
        consuming_item_instance_id: None,
        started_at: current_time,
        ends_at,
        total_amount: Some(0.0),
        amount_applied_so_far: Some(0.0),
        effect_type: EffectType::NightVision,
        tick_interval_micros: 1_000_000,
        next_tick_at: current_time + TimeDuration::from_micros(1_000_000),
    };
    
    match ctx.db.active_consumable_effect().try_insert(effect) {
        Ok(e) => {
            log::info!("[BrothEffect] Applied NightVision effect {} to player {:?} (1 hour)", e.effect_id, player_id);
            Ok(())
        }
        Err(e) => {
            log::error!("[BrothEffect] Failed to apply NightVision effect: {:?}", e);
            Err("Failed to apply night vision effect".to_string())
        }
    }
}

/// Applies warmth boost effect - 50% reduced warmth decay for 1 hour
pub fn apply_warmth_boost_effect(ctx: &ReducerContext, player_id: Identity, item_def_id: u64) -> Result<(), String> {
    cancel_broth_effect(ctx, player_id, EffectType::WarmthBoost);
    
    let current_time = ctx.timestamp;
    let ends_at = current_time + TimeDuration::from_micros(BROTH_EFFECT_DURATION_MICROS);
    
    let effect = ActiveConsumableEffect {
        effect_id: 0,
        player_id,
        target_player_id: None,
        item_def_id,
        consuming_item_instance_id: None,
        started_at: current_time,
        ends_at,
        total_amount: Some(0.0),
        amount_applied_so_far: Some(0.0),
        effect_type: EffectType::WarmthBoost,
        tick_interval_micros: 1_000_000,
        next_tick_at: current_time + TimeDuration::from_micros(1_000_000),
    };
    
    match ctx.db.active_consumable_effect().try_insert(effect) {
        Ok(e) => {
            log::info!("[BrothEffect] Applied WarmthBoost effect {} to player {:?} (1 hour, {}x decay)", 
                e.effect_id, player_id, WARMTH_BOOST_DECAY_REDUCTION);
            Ok(())
        }
        Err(e) => {
            log::error!("[BrothEffect] Failed to apply WarmthBoost effect: {:?}", e);
            Err("Failed to apply warmth boost effect".to_string())
        }
    }
}

/// Applies cold resistance effect - 50% reduced cold damage for 1 hour
pub fn apply_cold_resistance_effect(ctx: &ReducerContext, player_id: Identity, item_def_id: u64) -> Result<(), String> {
    cancel_broth_effect(ctx, player_id, EffectType::ColdResistance);
    
    let current_time = ctx.timestamp;
    let ends_at = current_time + TimeDuration::from_micros(BROTH_EFFECT_DURATION_MICROS);
    
    let effect = ActiveConsumableEffect {
        effect_id: 0,
        player_id,
        target_player_id: None,
        item_def_id,
        consuming_item_instance_id: None,
        started_at: current_time,
        ends_at,
        total_amount: Some(0.0),
        amount_applied_so_far: Some(0.0),
        effect_type: EffectType::ColdResistance,
        tick_interval_micros: 1_000_000,
        next_tick_at: current_time + TimeDuration::from_micros(1_000_000),
    };
    
    match ctx.db.active_consumable_effect().try_insert(effect) {
        Ok(e) => {
            log::info!("[BrothEffect] Applied ColdResistance effect {} to player {:?} (1 hour, {}x damage)", 
                e.effect_id, player_id, COLD_RESISTANCE_REDUCTION);
            Ok(())
        }
        Err(e) => {
            log::error!("[BrothEffect] Failed to apply ColdResistance effect: {:?}", e);
            Err("Failed to apply cold resistance effect".to_string())
        }
    }
}

/// Applies poison resistance effect - 75% reduced poison/venom damage for 1 hour (acts as antidote)
pub fn apply_poison_resistance_effect(ctx: &ReducerContext, player_id: Identity, item_def_id: u64) -> Result<(), String> {
    // Cancel existing poison effects when gaining resistance (antidote behavior)
    cancel_broth_effect(ctx, player_id, EffectType::Poisoned);
    cancel_venom_effects(ctx, player_id);
    cancel_broth_effect(ctx, player_id, EffectType::PoisonResistance);
    
    let current_time = ctx.timestamp;
    let ends_at = current_time + TimeDuration::from_micros(BROTH_EFFECT_DURATION_MICROS);
    
    let effect = ActiveConsumableEffect {
        effect_id: 0,
        player_id,
        target_player_id: None,
        item_def_id,
        consuming_item_instance_id: None,
        started_at: current_time,
        ends_at,
        total_amount: Some(0.0),
        amount_applied_so_far: Some(0.0),
        effect_type: EffectType::PoisonResistance,
        tick_interval_micros: 1_000_000,
        next_tick_at: current_time + TimeDuration::from_micros(1_000_000),
    };
    
    match ctx.db.active_consumable_effect().try_insert(effect) {
        Ok(e) => {
            log::info!("[BrothEffect] Applied PoisonResistance effect {} to player {:?} (1 hour, antidote + {}x damage)", 
                e.effect_id, player_id, POISON_RESISTANCE_REDUCTION);
            Ok(())
        }
        Err(e) => {
            log::error!("[BrothEffect] Failed to apply PoisonResistance effect: {:?}", e);
            Err("Failed to apply poison resistance effect".to_string())
        }
    }
}

/// Applies fire resistance effect - 50% reduced fire/burn damage for 1 hour
pub fn apply_fire_resistance_effect(ctx: &ReducerContext, player_id: Identity, item_def_id: u64) -> Result<(), String> {
    cancel_broth_effect(ctx, player_id, EffectType::FireResistance);
    
    let current_time = ctx.timestamp;
    let ends_at = current_time + TimeDuration::from_micros(BROTH_EFFECT_DURATION_MICROS);
    
    let effect = ActiveConsumableEffect {
        effect_id: 0,
        player_id,
        target_player_id: None,
        item_def_id,
        consuming_item_instance_id: None,
        started_at: current_time,
        ends_at,
        total_amount: Some(0.0),
        amount_applied_so_far: Some(0.0),
        effect_type: EffectType::FireResistance,
        tick_interval_micros: 1_000_000,
        next_tick_at: current_time + TimeDuration::from_micros(1_000_000),
    };
    
    match ctx.db.active_consumable_effect().try_insert(effect) {
        Ok(e) => {
            log::info!("[BrothEffect] Applied FireResistance effect {} to player {:?} (1 hour, {}x damage)", 
                e.effect_id, player_id, FIRE_RESISTANCE_REDUCTION);
            Ok(())
        }
        Err(e) => {
            log::error!("[BrothEffect] Failed to apply FireResistance effect: {:?}", e);
            Err("Failed to apply fire resistance effect".to_string())
        }
    }
}

/// Applies poison coating effect - all attacks inflict poison on targets for 1 hour
pub fn apply_poison_coating_effect(ctx: &ReducerContext, player_id: Identity, item_def_id: u64) -> Result<(), String> {
    cancel_broth_effect(ctx, player_id, EffectType::PoisonCoating);
    
    let current_time = ctx.timestamp;
    let ends_at = current_time + TimeDuration::from_micros(BROTH_EFFECT_DURATION_MICROS);
    
    let effect = ActiveConsumableEffect {
        effect_id: 0,
        player_id,
        target_player_id: None,
        item_def_id,
        consuming_item_instance_id: None,
        started_at: current_time,
        ends_at,
        total_amount: Some(0.0),
        amount_applied_so_far: Some(0.0),
        effect_type: EffectType::PoisonCoating,
        tick_interval_micros: 1_000_000,
        next_tick_at: current_time + TimeDuration::from_micros(1_000_000),
    };
    
    match ctx.db.active_consumable_effect().try_insert(effect) {
        Ok(e) => {
            log::info!("[BrothEffect] Applied PoisonCoating effect {} to player {:?} (1 hour, attacks inflict {}s poison)", 
                e.effect_id, player_id, POISON_COATING_DURATION_SECS);
            Ok(())
        }
        Err(e) => {
            log::error!("[BrothEffect] Failed to apply PoisonCoating effect: {:?}", e);
            Err("Failed to apply poison coating effect".to_string())
        }
    }
}

/// Applies passive health regen effect - slow health regeneration over 1 hour
pub fn apply_passive_health_regen_effect(ctx: &ReducerContext, player_id: Identity, item_def_id: u64) -> Result<(), String> {
    cancel_broth_effect(ctx, player_id, EffectType::PassiveHealthRegen);
    
    let current_time = ctx.timestamp;
    let ends_at = current_time + TimeDuration::from_micros(BROTH_EFFECT_DURATION_MICROS);
    
    let effect = ActiveConsumableEffect {
        effect_id: 0,
        player_id,
        target_player_id: None,
        item_def_id,
        consuming_item_instance_id: None,
        started_at: current_time,
        ends_at,
        total_amount: Some(PASSIVE_HEALTH_REGEN_TOTAL),
        amount_applied_so_far: Some(0.0),
        effect_type: EffectType::PassiveHealthRegen,
        tick_interval_micros: 1_000_000, // Heal a tiny bit each second
        next_tick_at: current_time + TimeDuration::from_micros(1_000_000),
    };
    
    match ctx.db.active_consumable_effect().try_insert(effect) {
        Ok(e) => {
            log::info!("[BrothEffect] Applied PassiveHealthRegen effect {} to player {:?} (1 hour, {:.1} total HP)", 
                e.effect_id, player_id, PASSIVE_HEALTH_REGEN_TOTAL);
            Ok(())
        }
        Err(e) => {
            log::error!("[BrothEffect] Failed to apply PassiveHealthRegen effect: {:?}", e);
            Err("Failed to apply passive health regen effect".to_string())
        }
    }
}

/// Applies harvest boost effect - 50% bonus yield from mining/chopping for 1 hour
pub fn apply_harvest_boost_effect(ctx: &ReducerContext, player_id: Identity, item_def_id: u64) -> Result<(), String> {
    cancel_broth_effect(ctx, player_id, EffectType::HarvestBoost);
    
    let current_time = ctx.timestamp;
    let ends_at = current_time + TimeDuration::from_micros(BROTH_EFFECT_DURATION_MICROS);
    
    let effect = ActiveConsumableEffect {
        effect_id: 0,
        player_id,
        target_player_id: None,
        item_def_id,
        consuming_item_instance_id: None,
        started_at: current_time,
        ends_at,
        total_amount: Some(0.0),
        amount_applied_so_far: Some(0.0),
        effect_type: EffectType::HarvestBoost,
        tick_interval_micros: 1_000_000,
        next_tick_at: current_time + TimeDuration::from_micros(1_000_000),
    };
    
    match ctx.db.active_consumable_effect().try_insert(effect) {
        Ok(e) => {
            log::info!("[BrothEffect] Applied HarvestBoost effect {} to player {:?} (1 hour, {}x yield)", 
                e.effect_id, player_id, HARVEST_BOOST_MULTIPLIER);
            Ok(())
        }
        Err(e) => {
            log::error!("[BrothEffect] Failed to apply HarvestBoost effect: {:?}", e);
            Err("Failed to apply harvest boost effect".to_string())
        }
    }
}

// ============================================================================
// CHECK FUNCTIONS FOR BROTH EFFECTS
// ============================================================================

/// Checks if a player has the intoxicated (drunk) effect
/// Uses btree index on player_id for O(log N + k) lookup instead of O(N) table scan
pub fn player_has_intoxicated_effect(ctx: &ReducerContext, player_id: Identity) -> bool {
    ctx.db.active_consumable_effect().player_id().filter(&player_id)
        .any(|e| e.effect_type == EffectType::Intoxicated)
}

/// Checks if a player has the speed boost effect
/// Uses btree index on player_id for O(log N + k) lookup instead of O(N) table scan
pub fn player_has_speed_boost_effect(ctx: &ReducerContext, player_id: Identity) -> bool {
    ctx.db.active_consumable_effect().player_id().filter(&player_id)
        .any(|e| e.effect_type == EffectType::SpeedBoost)
}

/// Checks if a player has the stamina boost effect
pub fn player_has_stamina_boost_effect(ctx: &ReducerContext, player_id: Identity) -> bool {
    ctx.db.active_consumable_effect().player_id().filter(&player_id)
        .any(|e| e.effect_type == EffectType::StaminaBoost)
}

/// Checks if a player has the night vision effect
pub fn player_has_night_vision_effect(ctx: &ReducerContext, player_id: Identity) -> bool {
    ctx.db.active_consumable_effect().player_id().filter(&player_id)
        .any(|e| e.effect_type == EffectType::NightVision)
}

/// Checks if a player has the warmth boost effect
pub fn player_has_warmth_boost_effect(ctx: &ReducerContext, player_id: Identity) -> bool {
    ctx.db.active_consumable_effect().player_id().filter(&player_id)
        .any(|e| e.effect_type == EffectType::WarmthBoost)
}

/// Checks if a player has the cold resistance effect
pub fn player_has_cold_resistance_effect(ctx: &ReducerContext, player_id: Identity) -> bool {
    ctx.db.active_consumable_effect().player_id().filter(&player_id)
        .any(|e| e.effect_type == EffectType::ColdResistance)
}

/// Checks if a player has the poison resistance effect
pub fn player_has_poison_resistance_effect(ctx: &ReducerContext, player_id: Identity) -> bool {
    ctx.db.active_consumable_effect().player_id().filter(&player_id)
        .any(|e| e.effect_type == EffectType::PoisonResistance)
}

/// Checks if a player has the fire resistance effect
pub fn player_has_fire_resistance_effect(ctx: &ReducerContext, player_id: Identity) -> bool {
    ctx.db.active_consumable_effect().player_id().filter(&player_id)
        .any(|e| e.effect_type == EffectType::FireResistance)
}

/// Checks if a player has the poison coating effect
pub fn player_has_poison_coating_effect(ctx: &ReducerContext, player_id: Identity) -> bool {
    ctx.db.active_consumable_effect().player_id().filter(&player_id)
        .any(|e| e.effect_type == EffectType::PoisonCoating)
}

/// Checks if a player has the passive health regen effect
pub fn player_has_passive_health_regen_effect(ctx: &ReducerContext, player_id: Identity) -> bool {
    ctx.db.active_consumable_effect().player_id().filter(&player_id)
        .any(|e| e.effect_type == EffectType::PassiveHealthRegen)
}

/// Checks if a player has the harvest boost effect
pub fn player_has_harvest_boost_effect(ctx: &ReducerContext, player_id: Identity) -> bool {
    ctx.db.active_consumable_effect().player_id().filter(&player_id)
        .any(|e| e.effect_type == EffectType::HarvestBoost)
}

/// Checks if a player has the poisoned status effect
pub fn player_has_poisoned_effect(ctx: &ReducerContext, player_id: Identity) -> bool {
    ctx.db.active_consumable_effect().player_id().filter(&player_id)
        .any(|e| e.effect_type == EffectType::Poisoned)
}

/// Checks if a player has the Entrainment effect (permanent insanity debuff)
pub fn player_has_entrainment_effect(ctx: &ReducerContext, player_id: Identity) -> bool {
    ctx.db.active_consumable_effect().player_id().filter(&player_id)
        .any(|e| e.effect_type == EffectType::Entrainment)
}

/// Applies Entrainment effect - permanent debuff from max insanity
/// This effect cannot be removed and damages the player slowly until death (same rate as venom)
pub fn apply_entrainment_effect(ctx: &ReducerContext, player_id: Identity) -> Result<(), String> {
    // Check if player already has Entrainment - if so, don't apply again
    if player_has_entrainment_effect(ctx, player_id) {
        log::warn!("Player {:?} already has Entrainment effect - not applying again", player_id);
        return Ok(());
    }
    
    let current_time = ctx.timestamp;
    
    // Entrainment is permanent - lasts effectively forever (1 year duration)
    // Damage: 3.0 per tick, tick every 5 seconds (3x faster than venom for urgency)
    // This gives ~2.8 minutes to death from 100 HP (balanced - fast but not instant)
    let duration_micros = (86400.0 * 365.0 * 1_000_000.0) as i64; // 1 year
    let tick_interval_micros = 5_000_000; // 5 seconds per tick
    
    let entrainment_effect = ActiveConsumableEffect {
        effect_id: 0, // auto_inc
        player_id,
        target_player_id: None,
        item_def_id: 0, // Not from an item, from insanity
        consuming_item_instance_id: None,
        started_at: current_time,
        ends_at: current_time + TimeDuration::from_micros(duration_micros),
        total_amount: Some(f32::MAX), // Infinite damage pool - will only stop on death
        amount_applied_so_far: Some(0.0),
        effect_type: EffectType::Entrainment,
        tick_interval_micros,
        next_tick_at: current_time + TimeDuration::from_micros(tick_interval_micros as i64),
    };
    
    match ctx.db.active_consumable_effect().try_insert(entrainment_effect) {
        Ok(inserted_effect) => {
            log::warn!("Applied Entrainment effect {} to player {:?} - permanent insanity debuff (3 damage per 5 seconds until death, ~2.8 minutes from 100 HP)", 
                inserted_effect.effect_id, player_id);
            Ok(())
        }
        Err(e) => {
            log::error!("Failed to apply Entrainment effect to player {:?}: {:?}", player_id, e);
            Err("Failed to apply Entrainment effect".to_string())
        }
    }
}

// ============================================================================
// VALIDOL PROTECTION (Insanity/Entrainment Countermeasure)
// ============================================================================

/// Checks if a player currently has ValidolProtection active (pauses Entrainment damage)
pub fn player_has_validol_protection(ctx: &ReducerContext, player_id: Identity) -> bool {
    ctx.db.active_consumable_effect().player_id().filter(&player_id)
        .any(|e| e.effect_type == EffectType::ValidolProtection)
}

/// Applies ValidolProtection effect - pauses Entrainment damage for 2-5 minutes
/// This effect is applied when consuming Validol Tablets while at max insanity (Entrainment)
/// Duration is random between 120-300 seconds (2-5 minutes)
/// Chewing gum effect duration per gum consumed (2 minutes)
const CHEWING_GUM_DURATION_SECS: i64 = 120;

/// Applies or extends the ChewingGum effect for a player. If they already have it, extends by 2 minutes.
/// Starts continuous chewing sound from player position. Sound is updated each tick and stopped when effect ends.
pub fn apply_chewing_gum_effect(ctx: &ReducerContext, player_id: Identity, item_def_id: u64) -> Result<(), String> {
    let current_time = ctx.timestamp;
    let duration_micros = CHEWING_GUM_DURATION_SECS * 1_000_000;

    // Check for existing ChewingGum effect - extend duration (stack)
    for existing_effect in ctx.db.active_consumable_effect().player_id().filter(&player_id) {
        if existing_effect.effect_type == EffectType::ChewingGum {
            let mut updated = existing_effect.clone();
            let new_ends_at = updated.ends_at + TimeDuration::from_micros(duration_micros);
            updated.ends_at = new_ends_at;
            ctx.db.active_consumable_effect().effect_id().update(updated);
            log::info!("[ChewingGum] Extended effect {} for player {:?} by {} seconds (now ends at {:?})",
                existing_effect.effect_id, player_id, CHEWING_GUM_DURATION_SECS, new_ends_at);
            return Ok(());
        }
    }

    // No existing effect - create new one and start sound
    let player = ctx.db.player().identity().find(&player_id)
        .ok_or_else(|| "Player not found".to_string())?;

    let chewing_gum_effect = ActiveConsumableEffect {
        effect_id: 0, // auto_inc
        player_id,
        target_player_id: None,
        item_def_id,
        consuming_item_instance_id: None,
        started_at: current_time,
        ends_at: current_time + TimeDuration::from_micros(duration_micros),
        total_amount: None,
        amount_applied_so_far: None,
        effect_type: EffectType::ChewingGum,
        tick_interval_micros: 500_000, // 0.5 second ticks to update sound position
        next_tick_at: current_time + TimeDuration::from_micros(500_000),
    };

    match ctx.db.active_consumable_effect().try_insert(chewing_gum_effect) {
        Ok(inserted) => {
            start_chewing_gum_sound(ctx, inserted.effect_id, player.position_x, player.position_y);
            log::info!("[ChewingGum] Applied effect {} to player {:?} - chewing for {} seconds",
                inserted.effect_id, player_id, CHEWING_GUM_DURATION_SECS);
            Ok(())
        }
        Err(e) => {
            log::error!("Failed to apply ChewingGum effect to player {:?}: {:?}", player_id, e);
            Err("Failed to apply ChewingGum effect".to_string())
        }
    }
}

pub fn apply_validol_protection(ctx: &ReducerContext, player_id: Identity) -> Result<u64, String> {
    // Remove any existing ValidolProtection (refresh timer instead of stacking)
    let existing_effects: Vec<u64> = ctx.db.active_consumable_effect().player_id().filter(&player_id)
        .filter(|e| e.effect_type == EffectType::ValidolProtection)
        .map(|e| e.effect_id)
        .collect();
    
    for effect_id in existing_effects {
        ctx.db.active_consumable_effect().effect_id().delete(&effect_id);
        log::info!("[Validol] Cancelled existing ValidolProtection effect {} for player {:?} (refreshing)", effect_id, player_id);
    }
    
    let current_time = ctx.timestamp;
    
    // Random duration between 2-5 minutes (120-300 seconds)
    let duration_secs = ctx.rng().gen_range(120..=300);
    let duration_micros = (duration_secs as i64) * 1_000_000;
    
    let validol_effect = ActiveConsumableEffect {
        effect_id: 0, // auto_inc
        player_id,
        target_player_id: None,
        item_def_id: 0, // Not associated with a specific item def
        consuming_item_instance_id: None,
        started_at: current_time,
        ends_at: current_time + TimeDuration::from_micros(duration_micros),
        total_amount: None, // No damage/healing amount - this is a status effect
        amount_applied_so_far: None,
        effect_type: EffectType::ValidolProtection,
        tick_interval_micros: 0, // No ticks - just a duration flag
        next_tick_at: current_time + TimeDuration::from_micros(duration_micros), // Set to end time
    };
    
    match ctx.db.active_consumable_effect().try_insert(validol_effect) {
        Ok(inserted_effect) => {
            log::info!("Applied ValidolProtection effect {} to player {:?} - Entrainment damage paused for {} seconds (~{} minutes)", 
                inserted_effect.effect_id, player_id, duration_secs, duration_secs / 60);
            Ok(duration_secs)
        }
        Err(e) => {
            log::error!("Failed to apply ValidolProtection effect to player {:?}: {:?}", player_id, e);
            Err("Failed to apply ValidolProtection effect".to_string())
        }
    }
}

/// Reduces player's insanity by a percentage of maximum
/// Used when consuming Validol Tablets while NOT at Entrainment
pub fn reduce_player_insanity(ctx: &ReducerContext, player_id: Identity, reduction_percent: f32) -> Result<f32, String> {
    let mut player = ctx.db.player().identity().find(&player_id)
        .ok_or_else(|| "Player not found".to_string())?;
    
    let max_insanity = crate::player_stats::PLAYER_MAX_INSANITY;
    let reduction_amount = max_insanity * reduction_percent;
    let old_insanity = player.insanity;
    let new_insanity = (player.insanity - reduction_amount).max(0.0);
    player.insanity = new_insanity;
    
    ctx.db.player().identity().update(player);
    
    log::info!("Reduced player {:?} insanity by {:.1} ({:.0}% of max): {:.1}% -> {:.1}%", 
        player_id, reduction_amount, reduction_percent * 100.0, old_insanity, new_insanity);
    
    Ok(reduction_amount)
}

// ============================================================================
// HELPER FUNCTIONS FOR BROTH EFFECTS
// ============================================================================

/// Cancels a specific broth effect type for a player
pub fn cancel_broth_effect(ctx: &ReducerContext, player_id: Identity, effect_type: EffectType) {
    let effects_to_cancel: Vec<_> = ctx.db.active_consumable_effect().player_id().filter(&player_id)
        .filter(|e| e.effect_type == effect_type)
        .map(|e| e.effect_id)
        .collect();

    for effect_id in effects_to_cancel {
        ctx.db.active_consumable_effect().effect_id().delete(&effect_id);
        log::info!("[BrothEffect] Cancelled {:?} effect {} for player {:?}", effect_type, effect_id, player_id);
    }
}

/// Cancels all poisoned effects for a player (used by antivenom/poison resistance)
pub fn cancel_poisoned_effects(ctx: &ReducerContext, player_id: Identity) {
    cancel_broth_effect(ctx, player_id, EffectType::Poisoned);
}

/// Clears all broth buff effects on player death (they don't persist through death)
/// Called from clear_all_effects_on_death
pub fn clear_broth_effects_on_death(ctx: &ReducerContext, player_id: Identity) {
    let broth_effect_types = [
        EffectType::Intoxicated,
        EffectType::Poisoned,
        EffectType::SpeedBoost,
        EffectType::StaminaBoost,
        EffectType::NightVision,
        EffectType::WarmthBoost,
        EffectType::ColdResistance,
        EffectType::PoisonResistance,
        EffectType::FireResistance,
        EffectType::PoisonCoating,
        EffectType::PassiveHealthRegen,
        EffectType::HarvestBoost,
        EffectType::BrewCooldown, // Also clear brew cooldown on death
    ];
    
    for effect_type in broth_effect_types {
        cancel_broth_effect(ctx, player_id, effect_type);
    }
    log::info!("[BrothEffect] Cleared all broth effects on death for player {:?}", player_id);
}

// ============================================================================
// BREW COOLDOWN SYSTEM
// ============================================================================

/// Cooldown duration for broth pot brews (60 seconds)
pub const BREW_COOLDOWN_SECONDS: u64 = 60;
pub const BREW_COOLDOWN_MICROS: i64 = (BREW_COOLDOWN_SECONDS as i64) * 1_000_000;

/// Checks if a player currently has the brew cooldown effect active
pub fn player_has_brew_cooldown(ctx: &ReducerContext, player_id: Identity) -> bool {
    ctx.db.active_consumable_effect().player_id().filter(&player_id)
        .any(|e| e.effect_type == EffectType::BrewCooldown)
}

/// Gets the remaining brew cooldown time in seconds for a player
/// Returns None if no cooldown is active, Some(seconds) otherwise
pub fn get_brew_cooldown_remaining(ctx: &ReducerContext, player_id: Identity) -> Option<f32> {
    let current_time = ctx.timestamp;
    ctx.db.active_consumable_effect().player_id().filter(&player_id)
        .find(|e| e.effect_type == EffectType::BrewCooldown)
        .map(|effect| {
            let ends_at_micros = effect.ends_at.to_micros_since_unix_epoch();
            let now_micros = current_time.to_micros_since_unix_epoch();
            let remaining_micros = ends_at_micros.saturating_sub(now_micros);
            (remaining_micros as f32) / 1_000_000.0
        })
}

/// Applies brew cooldown effect to a player (60 seconds)
/// This prevents consuming another broth pot brew for 60 seconds
pub fn apply_brew_cooldown(ctx: &ReducerContext, player_id: Identity, item_def_id: u64) -> Result<(), String> {
    // Cancel any existing cooldown first (refresh)
    cancel_broth_effect(ctx, player_id, EffectType::BrewCooldown);

    let current_time = ctx.timestamp;
    let ends_at = current_time + TimeDuration::from_micros(BREW_COOLDOWN_MICROS);

    let effect = ActiveConsumableEffect {
        effect_id: 0, // auto_inc
        player_id,
        target_player_id: None,
        item_def_id,
        consuming_item_instance_id: None,
        started_at: current_time,
        ends_at,
        total_amount: Some(0.0), // No accumulation needed
        amount_applied_so_far: Some(0.0),
        effect_type: EffectType::BrewCooldown,
        tick_interval_micros: 1_000_000, // 1 second (for display updates)
        next_tick_at: current_time + TimeDuration::from_micros(1_000_000),
    };

    match ctx.db.active_consumable_effect().try_insert(effect) {
        Ok(e) => {
            log::info!("[BrewCooldown] Applied 60-second brew cooldown (effect_id: {}) to player {:?}", e.effect_id, player_id);
            Ok(())
        }
        Err(e) => {
            log::error!("[BrewCooldown] Failed to apply brew cooldown: {:?}", e);
            Err("Failed to apply brew cooldown effect".to_string())
        }
    }
}

// ============================================================================
// STUN EFFECT SYSTEM (Blunt/Crushing Weapons)
// ============================================================================
// Blunt weapons have a chance to stun targets, completely immobilizing them
// for a short duration. Heavier weapons have higher stun chances and longer durations.

/// Stun duration in seconds by weapon tier (balanced for PvP)
pub const STUN_DURATION_LIGHT: f32 = 1.5;    // Kayak Paddle, Fox Skull
pub const STUN_DURATION_MEDIUM: f32 = 2.0;   // Stone Mace, Human Skull, Wolf Skull
pub const STUN_DURATION_HEAVY: f32 = 2.5;    // Engineers Maul
pub const STUN_DURATION_MASSIVE: f32 = 3.0;  // War Hammer, Military Crowbar

/// Stun chance percentages by weapon (0.0 to 1.0)
/// Returns (stun_chance, stun_duration) for a given blunt weapon name
pub fn get_blunt_weapon_stun_params(weapon_name: &str) -> Option<(f32, f32)> {
    match weapon_name {
        // Light blunt weapons - low chance, short duration
        "Kayak Paddle" => Some((0.05, STUN_DURATION_LIGHT)),     // 5% chance, 1.5s
        "Fox Skull" => Some((0.06, STUN_DURATION_LIGHT)),        // 6% chance, 1.5s
        
        // Medium blunt weapons - moderate chance
        "Human Skull" => Some((0.08, STUN_DURATION_MEDIUM)),     // 8% chance, 2.0s
        "Stone Mace" => Some((0.10, STUN_DURATION_MEDIUM)),      // 10% chance, 2.0s
        "Wolf Skull" => Some((0.12, STUN_DURATION_MEDIUM)),      // 12% chance, 2.0s
        
        // Heavy blunt weapons - high chance
        "Engineers Maul" => Some((0.15, STUN_DURATION_HEAVY)),   // 15% chance, 2.5s
        
        // Massive blunt weapons - highest chance, longest duration
        "War Hammer" => Some((0.18, STUN_DURATION_MASSIVE)),     // 18% chance, 3.0s
        "Military Crowbar" => Some((0.20, STUN_DURATION_MASSIVE)), // 20% chance, 3.0s
        
        _ => None, // Not a blunt weapon or unknown weapon
    }
}

/// Checks if a player currently has the stun effect active
/// Uses btree index on player_id for O(log N + k) lookup instead of O(N) table scan
pub fn player_has_stun_effect(ctx: &ReducerContext, player_id: Identity) -> bool {
    ctx.db.active_consumable_effect().player_id().filter(&player_id)
        .any(|e| e.effect_type == EffectType::Stun)
}

/// Gets the remaining stun time in seconds for a player
/// Returns None if not stunned, Some(seconds) otherwise
pub fn get_stun_remaining(ctx: &ReducerContext, player_id: Identity) -> Option<f32> {
    let current_time = ctx.timestamp;
    ctx.db.active_consumable_effect().player_id().filter(&player_id)
        .find(|e| e.effect_type == EffectType::Stun)
        .map(|effect| {
            let ends_at_micros = effect.ends_at.to_micros_since_unix_epoch();
            let now_micros = current_time.to_micros_since_unix_epoch();
            let remaining_micros = ends_at_micros.saturating_sub(now_micros);
            (remaining_micros as f32) / 1_000_000.0
        })
}

/// Applies a stun effect to a player (immobilizes them for the specified duration)
/// Stun does NOT stack - if already stunned, the new stun only applies if longer duration
pub fn apply_stun_effect(
    ctx: &ReducerContext, 
    player_id: Identity, 
    duration_seconds: f32,
    attacker_id: Identity,
    weapon_name: &str,
) -> Result<(), String> {
    // Check if target is in a safe zone - no stun in safe zones
    if player_has_safe_zone_effect(ctx, player_id) {
        log::debug!("[Stun] Player {:?} is in a safe zone - stun blocked", player_id);
        return Ok(());
    }
    
    // Check if target is already stunned
    if let Some(remaining) = get_stun_remaining(ctx, player_id) {
        if remaining >= duration_seconds {
            // Already stunned for longer, don't override
            log::debug!("[Stun] Player {:?} already stunned for {:.1}s (new stun would be {:.1}s)", 
                player_id, remaining, duration_seconds);
            return Ok(());
        }
        // New stun is longer - cancel existing and apply new
        cancel_stun_effect(ctx, player_id);
    }
    
    let current_time = ctx.timestamp;
    let duration_micros = (duration_seconds * 1_000_000.0) as i64;
    let ends_at = current_time + TimeDuration::from_micros(duration_micros);
    
    let stun_effect = ActiveConsumableEffect {
        effect_id: 0, // auto_inc
        player_id,
        target_player_id: None,
        item_def_id: 0, // Stun is from weapon attack, not item consumption
        consuming_item_instance_id: None,
        started_at: current_time,
        ends_at,
        total_amount: Some(0.0), // No damage accumulation
        amount_applied_so_far: Some(0.0),
        effect_type: EffectType::Stun,
        tick_interval_micros: 1_000_000, // 1 second (not really used)
        next_tick_at: current_time + TimeDuration::from_micros(1_000_000),
    };
    
    match ctx.db.active_consumable_effect().try_insert(stun_effect) {
        Ok(e) => {
            log::info!(
                "[Stun] Player {:?} STUNNED by {:?} using {} for {:.1}s (effect_id: {})", 
                player_id, attacker_id, weapon_name, duration_seconds, e.effect_id
            );
            
            // Emit stun sound at target position
            if let Some(target_player) = ctx.db.player().identity().find(&player_id) {
                crate::sound_events::emit_stun_sound(ctx, target_player.position_x, target_player.position_y, player_id);
            }
            
            Ok(())
        }
        Err(e) => {
            log::error!("[Stun] Failed to apply stun effect to player {:?}: {:?}", player_id, e);
            Err("Failed to apply stun effect".to_string())
        }
    }
}

/// Cancels any active stun effect for a player
pub fn cancel_stun_effect(ctx: &ReducerContext, player_id: Identity) {
    let effects_to_cancel: Vec<_> = ctx.db.active_consumable_effect().player_id().filter(&player_id)
        .filter(|e| e.effect_type == EffectType::Stun)
        .map(|e| e.effect_id)
        .collect();

    for effect_id in effects_to_cancel {
        ctx.db.active_consumable_effect().effect_id().delete(&effect_id);
        log::info!("[Stun] Cancelled stun effect {} for player {:?}", effect_id, player_id);
    }
}

/// Attempts to apply stun based on weapon type and random chance
/// Returns true if stun was successfully applied, false otherwise
pub fn try_apply_blunt_weapon_stun(
    ctx: &ReducerContext,
    attacker_id: Identity,
    target_id: Identity,
    weapon_name: &str,
) -> bool {
    // Check if this is a blunt weapon with stun capability
    if let Some((stun_chance, stun_duration)) = get_blunt_weapon_stun_params(weapon_name) {
        // Roll for stun chance
        let roll = ctx.rng().gen_range(0.0..1.0);
        
        if roll < stun_chance {
            log::info!(
                "[Stun] STUN PROC! {} rolled {:.2} < {:.2} chance. Applying {:.1}s stun to {:?}", 
                weapon_name, roll, stun_chance, stun_duration, target_id
            );
            
            if let Err(e) = apply_stun_effect(ctx, target_id, stun_duration, attacker_id, weapon_name) {
                log::error!("[Stun] Failed to apply stun: {}", e);
                return false;
            }
            return true;
        } else {
            log::debug!(
                "[Stun] No stun proc: {} rolled {:.2} >= {:.2} chance", 
                weapon_name, roll, stun_chance
            );
        }
    }
    
    false
}

// Memory Beacon Sanity Effect Management
// ============================
// This is a display-only effect that shows players they're in a Memory Beacon sanity zone
// The actual insanity clearing is handled in player_stats.rs

/// Checks if a player is currently within a Memory Beacon sanity zone
pub fn is_player_in_memory_beacon_zone(ctx: &ReducerContext, player_x: f32, player_y: f32) -> bool {
    crate::wild_animal_npc::hostile_spawning::is_position_in_memory_beacon_zone(ctx, player_x, player_y)
}

/// Updates Memory Beacon sanity effect for a player based on their position
/// This is a display-only effect - actual insanity clearing is in player_stats.rs
pub fn update_player_memory_beacon_status(ctx: &ReducerContext, player_id: Identity, player_x: f32, player_y: f32) -> Result<(), String> {
    let is_in_beacon_zone = is_player_in_memory_beacon_zone(ctx, player_x, player_y);
    let has_beacon_effect = player_has_memory_beacon_effect(ctx, player_id);
    
    log::debug!("Memory Beacon status check for player {:?}: in_zone={}, has_effect={}", 
        player_id, is_in_beacon_zone, has_beacon_effect);
    
    if is_in_beacon_zone {
        // Apply Memory Beacon sanity effect if not present
        if !has_beacon_effect {
            log::info!("Applying Memory Beacon sanity effect to player {:?} (insanity immunity)", player_id);
            apply_memory_beacon_effect(ctx, player_id)?;
        }
    } else {
        // Remove Memory Beacon sanity effect when player leaves
        if has_beacon_effect {
            log::info!("Removing Memory Beacon sanity effect from player {:?}", player_id);
            remove_memory_beacon_effect(ctx, player_id);
        }
    }
    
    Ok(())
}

/// Checks if a player currently has the Memory Beacon sanity effect active
pub fn player_has_memory_beacon_effect(ctx: &ReducerContext, player_id: Identity) -> bool {
    ctx.db.active_consumable_effect().player_id().filter(&player_id)
        .any(|effect| effect.effect_type == EffectType::MemoryBeaconSanity)
}

/// Applies Memory Beacon sanity effect to a player (display only)
fn apply_memory_beacon_effect(ctx: &ReducerContext, player_id: Identity) -> Result<(), String> {
    let current_time = ctx.timestamp;
    // Set a very far future time (1 year from now) - effectively permanent while in zone
    let very_far_future = current_time + TimeDuration::from_micros(365 * 24 * 60 * 60 * 1_000_000i64);
    
    let beacon_effect = ActiveConsumableEffect {
        effect_id: 0, // auto_inc
        player_id,
        target_player_id: None,
        item_def_id: 0, // Not from an item
        consuming_item_instance_id: None,
        started_at: current_time,
        ends_at: very_far_future, // Effectively permanent while in zone
        total_amount: None, // No accumulation for this effect
        amount_applied_so_far: None,
        effect_type: EffectType::MemoryBeaconSanity,
        tick_interval_micros: 1_000_000, // 1 second ticks (not really used)
        next_tick_at: current_time + TimeDuration::from_micros(1_000_000),
    };
    
    match ctx.db.active_consumable_effect().try_insert(beacon_effect) {
        Ok(inserted_effect) => {
            log::info!("Applied Memory Beacon sanity effect {} to player {:?}", inserted_effect.effect_id, player_id);
            Ok(())
        }
        Err(e) => {
            log::error!("Failed to apply Memory Beacon sanity effect to player {:?}: {:?}", player_id, e);
            Err("Failed to apply Memory Beacon sanity effect".to_string())
        }
    }
}

/// Removes Memory Beacon sanity effect from a player
fn remove_memory_beacon_effect(ctx: &ReducerContext, player_id: Identity) {
    let mut effects_to_remove = Vec::new();
    for effect in ctx.db.active_consumable_effect().player_id().filter(&player_id) {
        if effect.effect_type == EffectType::MemoryBeaconSanity {
            effects_to_remove.push(effect.effect_id);
        }
    }
    
    for effect_id in effects_to_remove {
        ctx.db.active_consumable_effect().effect_id().delete(&effect_id);
        log::info!("Removed Memory Beacon sanity effect {} from player {:?}", effect_id, player_id);
    }
}