use spacetimedb::{Identity, ReducerContext, Table, Timestamp};
use spacetimedb::spacetimedb_lib::ScheduleAt;
use spacetimedb::table;
use log;
use std::time::Duration;

use crate::inventory_management::ItemContainer;

// --- StatThresholdsConfig Table Definition (Formerly GameConfig) ---
pub const DEFAULT_LOW_NEED_THRESHOLD: f32 = 20.0;

#[table(name = stat_thresholds_config, public)]
#[derive(Clone, Debug)]
pub struct StatThresholdsConfig {
    #[primary_key]
    pub id: u8, // Singleton table, ID will always be 0
    pub low_need_threshold: f32,
    // Add other global config values here in the future
}

pub fn init_stat_thresholds_config(ctx: &ReducerContext) -> Result<(), String> {
    let config_table = ctx.db.stat_thresholds_config();
    if config_table.iter().count() == 0 {
        log::info!(
            "Initializing StatThresholdsConfig table with default low_need_threshold: {}",
            DEFAULT_LOW_NEED_THRESHOLD
        );
        match config_table.try_insert(StatThresholdsConfig {
            id: 0,
            low_need_threshold: DEFAULT_LOW_NEED_THRESHOLD,
        }) {
            Ok(_) => log::info!("StatThresholdsConfig table initialized in player_stats."),
            Err(e) => {
                log::error!("Failed to initialize StatThresholdsConfig table in player_stats: {}", e);
                return Err(format!("Failed to init StatThresholdsConfig in player_stats: {}", e));
            }
        }
    } else {
        log::debug!("StatThresholdsConfig table already initialized (in player_stats).");
    }
    Ok(())
}
// --- End StatThresholdsConfig Table Definition ---

// Define Constants locally
const HUNGER_DRAIN_PER_SECOND: f32 = 100.0 / (30.0 * 60.0);
const THIRST_DRAIN_PER_SECOND: f32 = 100.0 / (20.0 * 60.0);
// Make stat constants pub(crate) as well for consistency, although not strictly needed if only used here
pub(crate) const STAMINA_DRAIN_PER_SECOND: f32 = 2.5;
pub(crate) const STAMINA_RECOVERY_PER_SECOND: f32 = 1.0;
pub(crate) const HEALTH_LOSS_PER_SEC_LOW_THIRST: f32 = 0.5;
pub(crate) const HEALTH_LOSS_PER_SEC_LOW_HUNGER: f32 = 0.4;
pub(crate) const HEALTH_LOSS_MULTIPLIER_AT_ZERO: f32 = 2.0;
pub(crate) const HEALTH_RECOVERY_THRESHOLD: f32 = 51.0;
pub(crate) const HEALTH_RECOVERY_PER_SEC: f32 = 1.0;
pub(crate) const HEALTH_LOSS_PER_SEC_LOW_WARMTH: f32 = 0.6;

// Add the constants moved from lib.rs and make them pub(crate)
pub(crate) const SPRINT_SPEED_MULTIPLIER: f32 = 1.5;
pub(crate) const JUMP_COOLDOWN_MS: u64 = 500;
pub(crate) const LOW_THIRST_SPEED_PENALTY: f32 = 0.75;
pub(crate) const LOW_WARMTH_SPEED_PENALTY: f32 = 0.8;

// Import necessary items from the main lib module or other modules
use crate::{
    Player, // Player struct
    world_state::{self, TimeOfDay, BASE_WARMTH_DRAIN_PER_SECOND, WARMTH_DRAIN_MULTIPLIER_DAWN_DUSK, WARMTH_DRAIN_MULTIPLIER_NIGHT, WARMTH_DRAIN_MULTIPLIER_MIDNIGHT},
    campfire::{self, Campfire, WARMTH_RADIUS_SQUARED, WARMTH_PER_SECOND},
    active_equipment, // For unequipping on death
    player_corpse::{self, PlayerCorpse, NUM_CORPSE_SLOTS, PlayerCorpseDespawnSchedule},
    environment::calculate_chunk_index,
};

// Import table traits
use crate::Player as PlayerTableTrait;
use crate::world_state::world_state as WorldStateTableTrait;
use crate::campfire::campfire as CampfireTableTrait;
use crate::active_equipment::active_equipment as ActiveEquipmentTableTrait; // Needed for unequip on death
use crate::player; // Added missing import for Player trait
use crate::player_stats::PlayerStatSchedule as PlayerStatScheduleTableTrait; // Added Self trait import
use crate::items::inventory_item as InventoryItemTableTrait; // <<< ADDED
use crate::player_corpse::player_corpse as PlayerCorpseTableTrait; // <<< ADDED
use crate::player_corpse::player_corpse_despawn_schedule as PlayerCorpseDespawnScheduleTableTrait; // <<< ADDED
use crate::items::item_definition as ItemDefinitionTableTrait; // <<< ADDED missing import
use crate::armor; // <<< ADDED for warmth bonus
use crate::death_marker; // <<< ADDED for DeathMarker
use crate::death_marker::death_marker as DeathMarkerTableTrait; // <<< ADDED DeathMarker table trait

pub(crate) const PLAYER_STAT_UPDATE_INTERVAL_SECS: u64 = 1; // Update stats every second

// --- Player Stat Schedule Table (Reverted to scheduled pattern) ---
#[spacetimedb::table(name = player_stat_schedule, scheduled(process_player_stats))]
#[derive(Clone)]
pub struct PlayerStatSchedule {
    #[primary_key]
    #[auto_inc]
    pub id: u64, // Changed PK name to id
    pub scheduled_at: ScheduleAt, // Added scheduled_at field
}

// --- Function to Initialize the Stat Update Schedule ---
pub fn init_player_stat_schedule(ctx: &ReducerContext) -> Result<(), String> {
    let schedule_table = ctx.db.player_stat_schedule();
    if schedule_table.iter().count() == 0 {
        log::info!(
            "Starting player stat update schedule (every {}s).",
            PLAYER_STAT_UPDATE_INTERVAL_SECS
        );
        let interval = Duration::from_secs(PLAYER_STAT_UPDATE_INTERVAL_SECS);
        // Use try_insert and handle potential errors (though unlikely for init schedule)
        match schedule_table.try_insert(PlayerStatSchedule {
            id: 0, // Auto-incremented
            scheduled_at: ScheduleAt::Interval(interval.into()),
        }) {
            Ok(_) => log::info!("Player stat schedule inserted."),
            Err(e) => log::error!("Failed to insert player stat schedule: {}", e),
        };
    } else {
        log::debug!("Player stat schedule already exists.");
    }
    Ok(())
}

// --- Reducer to Process ALL Player Stat Updates (Scheduled) ---
#[spacetimedb::reducer]
pub fn process_player_stats(ctx: &ReducerContext, _schedule: PlayerStatSchedule) -> Result<(), String> {
    log::trace!("Processing player stats via schedule...");
    let current_time = ctx.timestamp;
    let players = ctx.db.player();
    let world_states = ctx.db.world_state();
    let campfires = ctx.db.campfire();
    let game_config_table = ctx.db.stat_thresholds_config();
    let config = game_config_table.iter().next()
        .ok_or_else(|| "StatThresholdsConfig not found. Critical error during stat processing.".to_string())?;
    let low_need_threshold = config.low_need_threshold;

    let world_state = world_states.iter().next()
        .ok_or_else(|| "WorldState not found during stat processing".to_string())?;

    for player_ref in players.iter() {
        let mut player = player_ref.clone();
        let player_id = player.identity;

        // --- Skip stat processing for offline players --- 
        if !player.is_online {
            log::trace!("Skipping stat processing for offline player {:?}", player_id);
            continue; // Move to the next player in the loop
        }

        if player.is_dead {
            continue;
        }

        // Use the dedicated stat update timestamp
        let last_stat_update_time = player.last_stat_update;
        let elapsed_micros = current_time.to_micros_since_unix_epoch().saturating_sub(last_stat_update_time.to_micros_since_unix_epoch());

        let elapsed_seconds = (elapsed_micros as f64 / 1_000_000.0) as f32;

        // --- Calculate Stat Changes ---
        let new_hunger = (player.hunger - (elapsed_seconds * HUNGER_DRAIN_PER_SECOND)).max(0.0);
        let new_thirst = (player.thirst - (elapsed_seconds * THIRST_DRAIN_PER_SECOND)).max(0.0);

        // Calculate Warmth
        // NEW WARMTH LOGIC: Base warmth change per second based on TimeOfDay
        let base_warmth_change_per_sec = match world_state.time_of_day {
            TimeOfDay::Midnight => -2.0,
            TimeOfDay::Night => -1.5,
            TimeOfDay::TwilightEvening => -0.5,
            TimeOfDay::Dusk => 0.0,
            TimeOfDay::Afternoon => 1.0, 
            TimeOfDay::Noon => 2.0,
            TimeOfDay::Morning => 1.0,
            TimeOfDay::TwilightMorning => 0.5,
            TimeOfDay::Dawn => 0.0,
        };

        let mut total_warmth_change_per_sec = base_warmth_change_per_sec;

        for fire in campfires.iter() {
            // Only gain warmth from burning campfires
            if fire.is_burning {
                let dx = player.position_x - fire.pos_x;
                let dy = player.position_y - fire.pos_y;
                if (dx * dx + dy * dy) < WARMTH_RADIUS_SQUARED {
                    total_warmth_change_per_sec += WARMTH_PER_SECOND;
                    log::trace!("Player {:?} gaining warmth from campfire {}", player_id, fire.id);
                }
            }
        }

        // <<< ADD WARMTH BONUS FROM ARMOR >>>
        let armor_warmth_bonus_per_interval = armor::calculate_total_warmth_bonus(ctx, player_id);
        // Assuming PLAYER_STAT_UPDATE_INTERVAL_SECS is the interval length in seconds for this stat processing.
        // If the bonus is defined as points per second, it can be added directly.
        // If it's meant as points per processing interval, then we divide by the interval.
        // For simplicity, let's assume warmth_bonus in ItemDefinition is points per second.
        if armor_warmth_bonus_per_interval > 0.0 {
            total_warmth_change_per_sec += armor_warmth_bonus_per_interval; 
            log::trace!(
                "Player {:?} gaining {:.2} warmth/sec from armor bonus.", 
                player_id, armor_warmth_bonus_per_interval
            );
        }
        // <<< END WARMTH BONUS FROM ARMOR >>>

        let new_warmth = (player.warmth + (total_warmth_change_per_sec * elapsed_seconds))
                         .max(0.0).min(100.0);

        // Calculate Stamina (Drain happens first if sprinting+moving, then recovery if not sprinting)
        let mut new_stamina = player.stamina;
        let mut new_sprinting_state = player.is_sprinting; // Start with current state

        // Check if player likely moved since last stat update
        let likely_moved = player.last_update > player.last_stat_update;

        if new_sprinting_state && likely_moved {
            // Apply drain if sprinting and likely moved
            new_stamina = (new_stamina - (elapsed_seconds * STAMINA_DRAIN_PER_SECOND)).max(0.0);
            if new_stamina <= 0.0 {
                new_sprinting_state = false; // Force sprinting off if out of stamina
                log::debug!("Player {:?} ran out of stamina (stat tick).", player_id);
            }
        } else if !new_sprinting_state {
            // Apply recovery only if not sprinting (or just stopped sprinting this tick)
            new_stamina = (new_stamina + (elapsed_seconds * STAMINA_RECOVERY_PER_SECOND)).min(100.0);
        }

        // Calculate Health
        let mut health_change_per_sec: f32 = 0.0;
        if new_thirst <= 0.0 {
            health_change_per_sec -= HEALTH_LOSS_PER_SEC_LOW_THIRST * HEALTH_LOSS_MULTIPLIER_AT_ZERO;
        } else if new_thirst < low_need_threshold {
            health_change_per_sec -= HEALTH_LOSS_PER_SEC_LOW_THIRST;
        }
        if new_hunger <= 0.0 {
            health_change_per_sec -= HEALTH_LOSS_PER_SEC_LOW_HUNGER * HEALTH_LOSS_MULTIPLIER_AT_ZERO;
        } else if new_hunger < low_need_threshold {
            health_change_per_sec -= HEALTH_LOSS_PER_SEC_LOW_HUNGER;
        }
        if new_warmth <= 0.0 {
            health_change_per_sec -= HEALTH_LOSS_PER_SEC_LOW_WARMTH * HEALTH_LOSS_MULTIPLIER_AT_ZERO;
        } else if new_warmth < low_need_threshold {
            health_change_per_sec -= HEALTH_LOSS_PER_SEC_LOW_WARMTH;
        }

        // Health recovery only if needs are met and not taking damage
        if health_change_per_sec == 0.0 && // No damage from needs
           player.health >= HEALTH_RECOVERY_THRESHOLD && // ADDED: Only regen if health is already high
           new_hunger >= HEALTH_RECOVERY_THRESHOLD &&
           new_thirst >= HEALTH_RECOVERY_THRESHOLD &&
           new_warmth >= low_need_threshold { // Ensure warmth is also at a decent level (using low_need_threshold for now)
            health_change_per_sec += HEALTH_RECOVERY_PER_SEC;
        }

        let health_change = health_change_per_sec * elapsed_seconds;
        let mut final_health = player.health + health_change;
        final_health = final_health.min(PLAYER_MAX_HEALTH); // Clamp health to max

        // --- Handle Death ---
        if final_health <= 0.0 && !player.is_dead {
            log::info!("Player {} ({:?}) died from stats decay (Health: {}).", 
                     player.username, player_id, final_health);
            player.is_dead = true;
            player.death_timestamp = Some(ctx.timestamp); // Set death timestamp

            // --- <<< CHANGED: Call refactored corpse creation function >>> ---
            match player_corpse::create_player_corpse(ctx, player_id, player.position_x, player.position_y, &player.username) {
                Ok(_) => {
                    log::info!("Successfully created corpse via stats decay for player {:?}", player_id);
                    // If player was holding an item, it should be unequipped (returned to inventory or dropped)
                    if let Some(player_state) = ctx.db.player().identity().find(&player_id) {
                        if player_state.health == 0.0 { // Double check health is indeed 0 after death processing
                            // Player is dead, clear active equipment if any
                            if let Some(active_equip) = ctx.db.active_equipment().player_identity().find(&player_id) {
                                if let Some(item_id) = active_equip.equipped_item_instance_id {
                                    log::info!("[StatsUpdate] Player {} died with active item instance {}. Clearing.", player_id, item_id);
                                    match crate::active_equipment::clear_active_item_reducer(ctx, player_id) {
                                        Ok(_) => log::info!("[PlayerDeath] Active item cleared for player {}", player_id),
                                        Err(e) => log::error!("[PlayerDeath] Failed to clear active item for player {}: {}", player_id, e),
                                    }
                                }
                            }
                        }
                    }
                }
                Err(e) => {
                    log::error!("Failed to create corpse via stats decay for player {:?}: {}", player_id, e);
                }
            }
            // --- <<< END CHANGED >>> ---

            // --- Create/Update DeathMarker ---
            let new_death_marker = death_marker::DeathMarker {
                player_id: player.identity, // Use player_id directly
                pos_x: player.position_x,
                pos_y: player.position_y,
                death_timestamp: ctx.timestamp,
            };
            let death_marker_table = ctx.db.death_marker();
            if death_marker_table.player_id().find(&player.identity).is_some() {
                death_marker_table.player_id().update(new_death_marker);
                log::info!("[DeathMarker] Updating death marker for player {:?} due to stats decay.", player.identity);
            } else {
                death_marker_table.insert(new_death_marker);
                log::info!("[DeathMarker] Inserting new death marker for player {:?} due to stats decay.", player.identity);
            }
            // --- End DeathMarker ---
        }

        // --- Update Player Table ---
        // Only update if something actually changed
        let stats_changed = (player.health - final_health).abs() > 0.01 ||
                            (player.hunger - new_hunger).abs() > 0.01 ||
                            (player.thirst - new_thirst).abs() > 0.01 ||
                            (player.warmth - new_warmth).abs() > 0.01 ||
                            (player.stamina - new_stamina).abs() > 0.01 ||
                            (player.is_sprinting != new_sprinting_state) || // Check if sprint state changed
                            player.is_dead; // Also update if other stats changed OR if player died

        if stats_changed {
            player.health = final_health;
            player.hunger = new_hunger;
            player.thirst = new_thirst;
            player.warmth = new_warmth;
            player.stamina = new_stamina;
            player.is_dead = player.is_dead;
            player.death_timestamp = player.death_timestamp;
            player.is_sprinting = new_sprinting_state; // Update sprint state if changed
            // Note: We don't update position, direction here

            // ALWAYS update last_stat_update timestamp after processing
            player.last_stat_update = current_time;

            players.identity().update(player.clone());
            log::trace!("[StatsUpdate] Updated stats for player {:?}. Health: {:.1}, Hunger: {:.1}, Thirst: {:.1}, Warmth: {:.1}, Stamina: {:.1}, Sprinting: {}, Dead: {}",
                      player_id, player.health, player.hunger, player.thirst, player.warmth, player.stamina, player.is_sprinting, player.is_dead);
        } else {
             log::trace!("No significant stat changes for player {:?}, skipping update.", player_id);
             // Still update the stat timestamp even if nothing changed, to prevent large future deltas
             player.last_stat_update = current_time;
             players.identity().update(player.clone());
             log::trace!("Updated player {:?} last_stat_update timestamp anyway.", player_id);
        }
    }

    // No rescheduling needed here, the table's ScheduleAt::Interval handles it
    Ok(())
}

pub const PLAYER_MAX_HEALTH: f32 = 100.0; // Define MAX_HEALTH here 