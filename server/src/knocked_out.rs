use spacetimedb::{Identity, Timestamp, ReducerContext, Table, log};
use rand::Rng; // For random recovery/death chances

// Import table traits needed
use crate::player as PlayerTableTrait;
use crate::player_stats::stat_thresholds_config as StatThresholdsConfigTableTrait;

// Import the Player struct
use crate::Player;

// --- NEW: Knocked Out Recovery/Death System ---

/// Table for scheduling knocked out player recovery checks
#[spacetimedb::table(name = knocked_out_recovery_schedule, public, scheduled(process_knocked_out_recovery))]
#[derive(Clone)]
pub struct KnockedOutRecoverySchedule {
    #[primary_key]
    #[auto_inc]
    pub schedule_id: u64, // SpacetimeDB requires u64 primary key for scheduled tables
    pub player_id: Identity, // The player this recovery check is for
    pub scheduled_at: spacetimedb::spacetimedb_lib::ScheduleAt,
    pub check_count: u32, // Track how many checks have been performed
}

/// Scheduled reducer to handle knocked out player recovery/death
#[spacetimedb::reducer(name = "process_knocked_out_recovery")]
pub fn process_knocked_out_recovery(ctx: &ReducerContext, args: KnockedOutRecoverySchedule) -> Result<(), String> {
    // Security check
    if ctx.sender != ctx.identity() {
        return Err("process_knocked_out_recovery can only be called by the scheduler".to_string());
    }

    let player_id = args.player_id;
    let schedule_id = args.schedule_id;
    let players = ctx.db.player();
    let mut recovery_schedule = ctx.db.knocked_out_recovery_schedule();

    log::info!("[KnockedOutRecovery] Processing recovery check for player {:?} (check #{})", player_id, args.check_count);

    let mut player = match players.identity().find(&player_id) {
        Some(p) => p,
        None => {
            log::warn!("[KnockedOutRecovery] Player {:?} not found. Removing schedule {}.", player_id, schedule_id);
            recovery_schedule.schedule_id().delete(&schedule_id);
            return Ok(());
        }
    };

    // If player is no longer knocked out, remove schedule
    if !player.is_knocked_out {
        log::info!("[KnockedOutRecovery] Player {:?} is no longer knocked out. Removing schedule {}.", player_id, schedule_id);
        recovery_schedule.schedule_id().delete(&schedule_id);
        return Ok(());
    }

    let knocked_out_duration_secs = match player.knocked_out_at {
        Some(knocked_out_time) => {
            let duration_micros = ctx.timestamp.to_micros_since_unix_epoch() 
                .saturating_sub(knocked_out_time.to_micros_since_unix_epoch());
            (duration_micros / 1_000_000) as u32
        }
        None => {
            log::error!("[KnockedOutRecovery] Player {:?} is knocked out but has no knocked_out_at timestamp. Clearing state.", player_id);
            player.is_knocked_out = false;
            player.knocked_out_at = None;
            players.identity().update(player);
            recovery_schedule.schedule_id().delete(&schedule_id);
            return Ok(());
        }
    };

    // Calculate stat-based modifiers for recovery and death chances
    let stat_thresholds_config_table = ctx.db.stat_thresholds_config();
    let stat_config = stat_thresholds_config_table.iter().filter(|stc| stc.id == 0).next();
    let low_need_threshold = stat_config.map(|c| c.low_need_threshold).unwrap_or(25.0);

    let hunger_modifier = if player.hunger >= 75.0 { 1.5 } else if player.hunger >= low_need_threshold { 1.0 } else if player.hunger >= 10.0 { 0.7 } else { 0.5 };
    let thirst_modifier = if player.thirst >= 75.0 { 1.4 } else if player.thirst >= low_need_threshold { 1.0 } else if player.thirst >= 10.0 { 0.6 } else { 0.4 };
    let stamina_modifier = if player.stamina >= 75.0 { 1.3 } else if player.stamina >= 50.0 { 1.0 } else if player.stamina >= 25.0 { 0.8 } else { 0.6 };
    let warmth_modifier = if player.warmth >= 75.0 { 1.3 } else if player.warmth >= low_need_threshold { 1.0 } else if player.warmth >= 10.0 { 0.7 } else { 0.5 };
    let armor_modifier = 1.0 + (crate::armor::calculate_total_damage_resistance(ctx, player_id) * 2.0);
    let stat_multiplier = (hunger_modifier * thirst_modifier * stamina_modifier * warmth_modifier * armor_modifier).clamp(0.2, 3.0);

    // Calculate current recovery and death chances using updated algorithm
    let base_recovery_chance = if knocked_out_duration_secs <= 15 {
        let time_factor = (15 - knocked_out_duration_secs) as f64 / 15.0;
        0.05 + (time_factor * 0.06)  // Range: 5% to 11%
    } else if knocked_out_duration_secs <= 30 {
        let time_factor = (30 - knocked_out_duration_secs) as f64 / 15.0;
        0.03 + (time_factor * 0.02)  // Range: 3% to 5%
    } else {
        let time_factor = ((knocked_out_duration_secs - 30) as f64 / 30.0).min(1.0);
        0.03 - (time_factor * 0.02)  // Range: 3% down to 1%
    };

    let modified_recovery_chance = (base_recovery_chance * stat_multiplier as f64).clamp(0.0, 0.20); // Max 20% recovery chance

    // --- MODIFIED: Remove "safe time" by setting start time to 0 --- 
    let base_death_start_time: f64 = 0.0; // Player is at risk of death from the start
    // Escalation time is now effectively the duration of the first death phase
    let base_death_escalation_time = base_death_start_time + 6.0; // Death chance ramps up over these 6 seconds

    let death_chance = if knocked_out_duration_secs <= base_death_start_time as u32 { // This condition will likely always be false if start_time is 0
        0.0 // Should effectively not be used if base_death_start_time is 0
    } else if knocked_out_duration_secs <= base_death_escalation_time as u32 {
        // Early death phase: (now 0s to 6s)
        // Ensure time_factor doesn't become negative if duration is 0 and start_time is 0
        let time_in_this_phase = (knocked_out_duration_secs as f64 - base_death_start_time).max(0.0);
        let time_factor = time_in_this_phase / (base_death_escalation_time - base_death_start_time).max(1.0); // Avoid division by zero if times are equal
        (time_factor * 0.40) / (stat_multiplier as f64).max(0.8) 
    } else {
        // Late death phase (now after 6s)
        let time_since_escalation = (knocked_out_duration_secs as f64 - base_death_escalation_time).max(0.0);
        let time_factor = (time_since_escalation / 8.0).min(1.0); 
        let base_late_chance = 0.40 + (time_factor * 0.55); 
        base_late_chance / (1.0 + (stat_multiplier as f64 - 1.0) * 0.5).max(0.9) 
    };

    let time_until_death_risk = if knocked_out_duration_secs < base_death_start_time as u32 {
        // Perform calculation in f64, then cast to f32 for the variable
        (base_death_start_time - (knocked_out_duration_secs as f64)).max(0.0) as f32
    } else {
        0.0f32 // Explicitly f32 zero
    };

    let mut rng = ctx.rng();
    let roll = rng.gen::<f64>();

    log::info!("[KnockedOutRecovery] Player {:?} unconscious for {}s. Base recovery: {:.1}%, Modified recovery: {:.1}%, Death chance: {:.1}%, Roll: {:.3}", 
             player_id, knocked_out_duration_secs, base_recovery_chance * 100.0, modified_recovery_chance * 100.0, death_chance * 100.0, roll);

    if roll < death_chance {
        // Player dies
        log::info!("[KnockedOutRecovery] Player {:?} died from their wounds after {}s unconscious", player_id, knocked_out_duration_secs);
        
        player.is_knocked_out = false;
        player.knocked_out_at = None;
        player.is_dead = true;
        player.death_timestamp = Some(ctx.timestamp);
        player.health = 0.0;

        // Clear active item
        match crate::active_equipment::clear_active_item_reducer(ctx, player.identity) {
            Ok(_) => log::info!("[KnockedOutDeath] Active item cleared for dying player {}", player.identity),
            Err(e) => log::error!("[KnockedOutDeath] Failed to clear active item for dying player {}: {}", player.identity, e),
        }

        // Create corpse
        match crate::player_corpse::create_player_corpse(ctx, player.identity, player.position_x, player.position_y, &player.username) {
            Ok(_) => log::info!("[KnockedOutDeath] Corpse created for player {:?}", player_id),
            Err(e) => log::error!("[KnockedOutDeath] Failed to create corpse for player {:?}: {}", player_id, e),
        }

        players.identity().update(player);
        recovery_schedule.schedule_id().delete(&schedule_id);

    } else if roll < death_chance + modified_recovery_chance {
        // Player recovers on their own
        log::info!("[KnockedOutRecovery] Player {:?} recovered on their own after {}s unconscious", player_id, knocked_out_duration_secs);
        
        player.is_knocked_out = false;
        player.knocked_out_at = None;
        player.health = 10.0; // Recover with low health

        players.identity().update(player);
        recovery_schedule.schedule_id().delete(&schedule_id);

    } else {
        // Continue checking, schedule next check
        let next_check_count = args.check_count + 1;
        let next_check_time = ctx.timestamp + std::time::Duration::from_secs(3);

        // First, delete the current schedule entry that just ran.
        let current_schedule_id = args.schedule_id;
        match recovery_schedule.schedule_id().delete(&current_schedule_id) {
            true => {
                log::debug!("[KnockedOutRecovery] Deleted completed schedule entry {} for player {:?} (check #{})", 
                             current_schedule_id, player_id, args.check_count);
            }
            false => {
                // This would be unusual if we just processed this schedule_id from `args`
                log::warn!("[KnockedOutRecovery] Failed to delete schedule entry {} for player {:?} (check #{}) - it might have been already deleted.", 
                            current_schedule_id, player_id, args.check_count);
                // Continue to try and insert the next one anyway, as the goal is to keep the process going.
            }
        }

        // Then, insert a new schedule entry for the next check.
        // Note: schedule_id will be auto-generated for the new entry.
        let new_schedule_for_next_check = KnockedOutRecoverySchedule {
            schedule_id: 0, // Let SpacetimeDB auto-increment for the new entry
            player_id,
            scheduled_at: next_check_time.into(),
            check_count: next_check_count,
        };

        match recovery_schedule.try_insert(new_schedule_for_next_check) {
            Ok(inserted_schedule) => {
                log::debug!("[KnockedOutRecovery] Successfully INSERTED new schedule (ID: {}) for player {:?} (next check #{}), scheduled at: {:?}", 
                             inserted_schedule.schedule_id, player_id, next_check_count, inserted_schedule.scheduled_at);
            }
            Err(e) => {
                log::error!("[KnockedOutRecovery] CRITICAL: Failed to INSERT new schedule for player {:?} (next check #{}) after deleting old one. Error: {}. Recovery process for this player will stop.", 
                             player_id, next_check_count, e);
                // IMPORTANT: If this insert fails, the recovery check loop for this player stops.
                // Consider if there's any fallback or if this is an acceptable terminal error for this player's recovery process.
            }
        }
    }

    Ok(())
}

/// Helper function to start knocked out recovery scheduling for a player
pub fn schedule_knocked_out_recovery(ctx: &ReducerContext, player_id: Identity) -> Result<(), String> {
    let recovery_schedule_table = ctx.db.knocked_out_recovery_schedule();
    
    let first_check_time = ctx.timestamp + std::time::Duration::from_secs(5); 
    
    let schedule_entry = KnockedOutRecoverySchedule {
        schedule_id: 0, // Auto-incremented by SpacetimeDB
        player_id,
        scheduled_at: first_check_time.into(),
        check_count: 1,
    };

    // --- BEGIN MODIFICATION: Add detailed logging before try_insert ---
    log::info!("[KnockedOutRecovery] Attempting to insert schedule: player_id: {:?}, schedule_id (pre-insert): {}, scheduled_at (raw timestamp): {:?}, check_count: {}", 
        player_id, schedule_entry.schedule_id, first_check_time, schedule_entry.check_count);
    // --- END MODIFICATION ---

    match recovery_schedule_table.try_insert(schedule_entry) {
        Ok(_) => {
            log::info!("[KnockedOutRecovery] Scheduled recovery checks for player {:?} starting in 5s", player_id);
            Ok(())
        }
        Err(e) => {
            log::error!("[KnockedOutRecovery] Failed to schedule recovery for player {:?}: {}", player_id, e);
            Err(format!("Failed to schedule recovery: {}", e))
        }
    }
}

/// Reducer for other players to revive a knocked out player
#[spacetimedb::reducer]
pub fn revive_knocked_out_player(ctx: &ReducerContext, target_player_id: Identity) -> Result<(), String> {
    let reviver_id = ctx.sender;
    let players = ctx.db.player();
    let recovery_schedule_table = ctx.db.knocked_out_recovery_schedule();

    // Get both players
    let reviver = players.identity().find(&reviver_id)
        .ok_or_else(|| "Reviver player not found".to_string())?;
    
    let mut target_player = players.identity().find(&target_player_id)
        .ok_or_else(|| "Target player not found".to_string())?;

    // Validate reviver is alive and not knocked out
    if reviver.is_dead {
        return Err("Dead players cannot revive others".to_string());
    }
    if reviver.is_knocked_out {
        return Err("Knocked out players cannot revive others".to_string());
    }

    // Validate target is knocked out
    if !target_player.is_knocked_out {
        return Err("Target player is not knocked out".to_string());
    }
    if target_player.is_dead {
        return Err("Target player is already dead".to_string());
    }

    // Check distance (similar to other interaction distances)
    const REVIVE_INTERACTION_DISTANCE: f32 = 128.0; // Increased to match client-side distance
    const REVIVE_INTERACTION_DISTANCE_SQ: f32 = REVIVE_INTERACTION_DISTANCE * REVIVE_INTERACTION_DISTANCE;
    
    let dx = reviver.position_x - target_player.position_x;
    let dy = reviver.position_y - target_player.position_y;
    let distance_sq = dx * dx + dy * dy;
    
    if distance_sq > REVIVE_INTERACTION_DISTANCE_SQ {
        return Err("Too far away to revive player".to_string());
    }

    // Revive the player
    target_player.is_knocked_out = false;
    target_player.knocked_out_at = None;
    target_player.health = 10.0; // Revive with low health
    target_player.last_update = ctx.timestamp;

    players.identity().update(target_player.clone());

    // Cancel recovery schedule - find by player_id since we don't have schedule_id
    let schedules_to_remove: Vec<u64> = recovery_schedule_table.iter()
        .filter(|schedule| schedule.player_id == target_player_id)
        .map(|schedule| schedule.schedule_id)
        .collect();
    
    for schedule_id in schedules_to_remove {
        recovery_schedule_table.schedule_id().delete(&schedule_id);
        log::info!("[Revive] Canceled recovery schedule {} for revived player {:?}", schedule_id, target_player_id);
    }

    log::info!("Player {:?} ({}) revived player {:?} ({}) with 10 health", 
             reviver_id, reviver.username, target_player_id, target_player.username);

    Ok(())
}

/// Table for tracking knocked out player state for UI display
#[spacetimedb::table(name = knocked_out_status, public)]
#[derive(Clone)]
pub struct KnockedOutStatus {
    #[primary_key]
    pub player_id: Identity,
    pub knocked_out_at: Timestamp,
    pub current_recovery_chance_percent: f32,
    pub current_death_chance_percent: f32,
    pub time_until_death_risk_starts_secs: f32,
    pub stat_multiplier: f32,
    pub last_updated: Timestamp,
}

/// Reducer to calculate and update knocked out status for UI display
#[spacetimedb::reducer]
pub fn get_knocked_out_status(ctx: &ReducerContext) -> Result<(), String> {
    let sender_id = ctx.sender;
    let players = ctx.db.player();
    let knocked_out_status_table = ctx.db.knocked_out_status();

    let player = players.identity().find(&sender_id)
        .ok_or_else(|| "Player not found".to_string())?;

    if !player.is_knocked_out {
        // Remove status if player is no longer knocked out
        if knocked_out_status_table.player_id().find(&sender_id).is_some() {
            knocked_out_status_table.player_id().delete(&sender_id);
        }
        return Ok(());
    }

    let knocked_out_at = player.knocked_out_at
        .ok_or_else(|| "Player is knocked out but has no knocked_out_at timestamp".to_string())?;

    let knocked_out_duration_secs = {
        let duration_micros = ctx.timestamp.to_micros_since_unix_epoch() 
            .saturating_sub(knocked_out_at.to_micros_since_unix_epoch());
        (duration_micros / 1_000_000) as u32
    };

    // Calculate the same modifiers as in process_knocked_out_recovery
    let stat_thresholds_config_table = ctx.db.stat_thresholds_config();
    let stat_config = stat_thresholds_config_table.iter().filter(|stc| stc.id == 0).next();
    let low_need_threshold = stat_config.map(|c| c.low_need_threshold).unwrap_or(25.0);

    let hunger_modifier = if player.hunger >= 75.0 { 1.5 } else if player.hunger >= low_need_threshold { 1.0 } else if player.hunger >= 10.0 { 0.7 } else { 0.5 };
    let thirst_modifier = if player.thirst >= 75.0 { 1.4 } else if player.thirst >= low_need_threshold { 1.0 } else if player.thirst >= 10.0 { 0.6 } else { 0.4 };
    let stamina_modifier = if player.stamina >= 75.0 { 1.3 } else if player.stamina >= 50.0 { 1.0 } else if player.stamina >= 25.0 { 0.8 } else { 0.6 };
    let warmth_modifier = if player.warmth >= 75.0 { 1.3 } else if player.warmth >= low_need_threshold { 1.0 } else if player.warmth >= 10.0 { 0.7 } else { 0.5 };
    let armor_modifier = 1.0 + (crate::armor::calculate_total_damage_resistance(ctx, sender_id) * 2.0);
    let stat_multiplier = (hunger_modifier * thirst_modifier * stamina_modifier * warmth_modifier * armor_modifier).clamp(0.2, 3.0);

    // Calculate current recovery and death chances
    let base_recovery_chance = if knocked_out_duration_secs <= 15 {
        let time_factor = (15 - knocked_out_duration_secs) as f64 / 15.0;
        0.05 + (time_factor * 0.06)  // Range: 5% to 11%
    } else if knocked_out_duration_secs <= 30 {
        let time_factor = (30 - knocked_out_duration_secs) as f64 / 15.0;
        0.03 + (time_factor * 0.02)  // Range: 3% to 5%
    } else {
        let time_factor = ((knocked_out_duration_secs - 30) as f64 / 30.0).min(1.0);
        0.03 - (time_factor * 0.02)  // Range: 3% down to 1%
    };

    let modified_recovery_chance = (base_recovery_chance * stat_multiplier as f64).clamp(0.0, 0.20); // Max 20% recovery chance

    // --- MODIFIED: Remove "safe time" by setting start time to 0 --- 
    let base_death_start_time: f64 = 0.0; // Player is at risk of death from the start
    // Escalation time is now effectively the duration of the first death phase
    let base_death_escalation_time = base_death_start_time + 6.0; // Death chance ramps up over these 6 seconds

    let death_chance = if knocked_out_duration_secs <= base_death_start_time as u32 { // This condition will likely always be false if start_time is 0
        0.0 // Should effectively not be used if base_death_start_time is 0
    } else if knocked_out_duration_secs <= base_death_escalation_time as u32 {
        // Early death phase: (now 0s to 6s)
        // Ensure time_factor doesn't become negative if duration is 0 and start_time is 0
        let time_in_this_phase = (knocked_out_duration_secs as f64 - base_death_start_time).max(0.0);
        let time_factor = time_in_this_phase / (base_death_escalation_time - base_death_start_time).max(1.0); // Avoid division by zero if times are equal
        (time_factor * 0.40) / (stat_multiplier as f64).max(0.8) 
    } else {
        // Late death phase (now after 6s)
        let time_since_escalation = (knocked_out_duration_secs as f64 - base_death_escalation_time).max(0.0);
        let time_factor = (time_since_escalation / 8.0).min(1.0); 
        let base_late_chance = 0.40 + (time_factor * 0.55); 
        base_late_chance / (1.0 + (stat_multiplier as f64 - 1.0) * 0.5).max(0.9) 
    };

    let time_until_death_risk = if knocked_out_duration_secs < base_death_start_time as u32 {
        // Perform calculation in f64, then cast to f32 for the variable
        (base_death_start_time - (knocked_out_duration_secs as f64)).max(0.0) as f32
    } else {
        0.0f32 // Explicitly f32 zero
    };

    let status = KnockedOutStatus {
        player_id: sender_id,
        knocked_out_at,
        current_recovery_chance_percent: (modified_recovery_chance * 100.0) as f32,
        current_death_chance_percent: (death_chance * 100.0) as f32,
        time_until_death_risk_starts_secs: time_until_death_risk,
        stat_multiplier: stat_multiplier as f32,
        last_updated: ctx.timestamp,
    };

    // Insert or update status
    if knocked_out_status_table.player_id().find(&sender_id).is_some() {
        knocked_out_status_table.player_id().update(status);
    } else {
        match knocked_out_status_table.try_insert(status) {
            Ok(_) => {},
            Err(e) => log::error!("Failed to insert knocked out status for player {:?}: {}", sender_id, e),
        }
    }

    Ok(())
}