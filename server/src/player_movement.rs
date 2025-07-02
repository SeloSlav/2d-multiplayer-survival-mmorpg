use spacetimedb::{Identity, Timestamp, ReducerContext, Table};
use log;
use rand::Rng;

// Import table traits needed for database access
use crate::player as PlayerTableTrait;
use crate::tree::tree as TreeTableTrait;
use crate::stone::stone as StoneTableTrait;
use crate::wooden_storage_box::{self as WoodenStorageBoxModule, wooden_storage_box as WoodenStorageBoxTableTrait, WoodenStorageBox, PLAYER_BOX_COLLISION_DISTANCE_SQUARED, BOX_COLLISION_Y_OFFSET};
use crate::campfire::{self as CampfireModule, campfire as CampfireTableTrait, Campfire, PLAYER_CAMPFIRE_COLLISION_DISTANCE_SQUARED, CAMPFIRE_COLLISION_Y_OFFSET};
use crate::grass::grass as GrassTableTrait;
use crate::player_stats::stat_thresholds_config as StatThresholdsConfigTableTrait;

// Import constants from lib.rs
use crate::{PLAYER_RADIUS, PLAYER_SPEED, WORLD_WIDTH_PX, WORLD_HEIGHT_PX, WATER_SPEED_PENALTY, is_player_on_water, is_player_jumping, get_effective_player_radius};

// Import constants from player_stats module
use crate::player_stats::{SPRINT_SPEED_MULTIPLIER, JUMP_COOLDOWN_MS};

// Import exhausted effect constants and functions
use crate::active_effects::{EXHAUSTED_SPEED_PENALTY, player_has_exhausted_effect};

// Import constants from environment module
use crate::environment::{calculate_chunk_index, WORLD_WIDTH_CHUNKS};

// Import the new player_collision module
use crate::player_collision;

// Import grass types
use crate::grass::GrassAppearanceType;

// Import sound event functions
use crate::sound_events::emit_walking_sound;
use crate::sound_events::emit_swimming_sound;

// === DODGE ROLL CONSTANTS ===
pub const DODGE_ROLL_DISTANCE: f32 = 300.0; // Increased from 120 to 300 pixels (about 7.5x player radius)
pub const DODGE_ROLL_DURATION_MS: u64 = 350; // Increased from 250 to 350ms for more dramatic effect
pub const DODGE_ROLL_COOLDOWN_MS: u64 = 1000; // 1 second cooldown between dodge rolls
pub const DODGE_ROLL_SPEED: f32 = DODGE_ROLL_DISTANCE / (DODGE_ROLL_DURATION_MS as f32 / 1000.0); // Pixels per second

// Table to track dodge roll state for each player
#[spacetimedb::table(name = player_dodge_roll_state, public)]
#[derive(Clone, Debug)]
pub struct PlayerDodgeRollState {
    #[primary_key]
    player_id: Identity,
    start_time_ms: u64,
    start_x: f32,
    start_y: f32,
    target_x: f32,
    target_y: f32,
    direction: String, // "up", "down", "left", "right"
    last_dodge_time_ms: u64, // For cooldown tracking
}

// Table to track walking sound cadence for each player
#[spacetimedb::table(name = player_walking_sound_state, public)]
#[derive(Clone, Debug)]
pub struct PlayerWalkingSoundState {
    #[primary_key]
    player_id: Identity,
    last_walking_sound_time_ms: u64,
    total_distance_since_last_sound: f32, // Accumulated distance for cadence
    last_swimming_sound_time_ms: u64, // Track swimming sound timing separately
    total_swimming_distance_since_last_sound: f32, // Accumulated swimming distance for cadence
}

/*
 * ===================================================
 *              PLAYER MOVEMENT REDUCERS
 * ===================================================
 * 
 * This section contains reducers that handle various
 * player movement states and actions:
 * 
 * - Sprinting: Allows players to move faster at the
 *             cost of stamina
 * 
 * - Crouching: Reduces player speed and potentially
 *             affects other mechanics
 * 
 * - Jumping:   Enables vertical movement with cooldown
 *             restrictions
 * 
 * - Dodge Roll: Quick movement in facing direction
 *              with cooldown restrictions
 * 
 * All movement actions require the player to be alive
 * and conscious.
 * ===================================================
 */

/// Reducer that handles player sprint state changes.
/// 
/// This reducer is called by the client when a player wants to start or stop sprinting.
/// It verifies the player is alive and not knocked out before allowing the sprint state change.
#[spacetimedb::reducer]
pub fn set_sprinting(ctx: &ReducerContext, sprinting: bool) -> Result<(), String> {
    let sender_id = ctx.sender;
    let players = ctx.db.player();

    if let Some(mut player) = players.identity().find(&sender_id) {
        // Don't allow sprinting if dead or knocked out
        if player.is_dead {
            return Err("Cannot sprint while dead.".to_string());
        }
        if player.is_knocked_out {
            return Err("Cannot sprint while knocked out.".to_string());
        }

        // Players can sprint in water (with speed penalty applied during movement calculation)

        // Only update if the state is actually changing
        if player.is_sprinting != sprinting {
            player.is_sprinting = sprinting;
            player.last_update = ctx.timestamp; // Update timestamp when sprint state changes
            players.identity().update(player);
            log::debug!("Player {:?} set sprinting to {}", sender_id, sprinting);
        }
        Ok(())
    } else {
        Err("Player not found".to_string())
    }
}

/// Reducer that handles player crouch toggle requests.
/// 
/// This reducer is called by the client when a player attempts to toggle crouching.
/// It checks if the player is alive and not knocked out before allowing the crouch state to change.
/// The crouching state affects player movement speed and potentially other gameplay mechanics.
#[spacetimedb::reducer]
pub fn toggle_crouch(ctx: &ReducerContext) -> Result<(), String> {
    let sender_id = ctx.sender;
    let players = ctx.db.player();

    if let Some(mut player) = players.identity().find(&sender_id) {
        // Don't allow crouching if dead or knocked out
        if player.is_dead {
            return Err("Cannot crouch while dead.".to_string());
        }
        if player.is_knocked_out {
            return Err("Cannot crouch while knocked out.".to_string());
        }

        // ADD: Don't allow crouching on water
        if !player.is_crouching && is_player_on_water(ctx, player.position_x, player.position_y) {
            return Err("Cannot crouch on water.".to_string());
        }

        player.is_crouching = !player.is_crouching;
        player.last_update = ctx.timestamp; // Update timestamp when crouching state changes
        
        // Store the state for logging before moving the player struct
        let crouching_active_for_log = player.is_crouching;

        players.identity().update(player); // player is moved here
        
        log::info!(
            "Player {:?} toggled crouching. Active: {}",
            sender_id, crouching_active_for_log // Use the stored value for logging
        );
        Ok(())
    } else {
        Err("Player not found".to_string())
    }
}

/// Reducer that handles player jump requests.
/// 
/// This reducer is called by the client when a player attempts to jump.
/// It checks if the player is alive and not knocked out, then verifies
/// the jump cooldown before allowing the jump to occur.
#[spacetimedb::reducer]
pub fn jump(ctx: &ReducerContext) -> Result<(), String> {
   let identity = ctx.sender;
   
   let players = ctx.db.player();
   if let Some(mut player) = players.identity().find(&identity) {
       // Don't allow jumping if dead
       if player.is_dead {
           return Err("Cannot jump while dead.".to_string());
       }

       // Don't allow jumping if knocked out
       if player.is_knocked_out {
           return Err("Cannot jump while knocked out.".to_string());
       }

       // Don't allow jumping while crouching
       if player.is_crouching {
           return Err("Cannot jump while crouching.".to_string());
       }

       // ADD: Don't allow jumping on water
       if is_player_on_water(ctx, player.position_x, player.position_y) {
           return Err("Cannot jump on water.".to_string());
       }

       let now_micros = ctx.timestamp.to_micros_since_unix_epoch();
       let now_ms = (now_micros / 1000) as u64;

       // Check if the player is already jumping (within cooldown)
       if player.jump_start_time_ms > 0 && now_ms < player.jump_start_time_ms + JUMP_COOLDOWN_MS {
           let cooldown_remaining = (player.jump_start_time_ms + JUMP_COOLDOWN_MS) - now_ms;
           return Err("Cannot jump again so soon.".to_string());
       }

       // Proceed with the jump
       player.jump_start_time_ms = now_ms;
       player.last_update = ctx.timestamp; // Update timestamp on jump
       players.identity().update(player);
       Ok(())
   } else {
       Err("Player not found".to_string())
   }
}

/// Updates player facing direction based on mouse position.
/// 
/// This allows the player's facing direction to be controlled by the mouse cursor
/// position relative to the player, but only when the player is not actively moving.
/// When the player is moving, their direction is controlled by movement instead.
/// 
/// # Arguments
/// * `mouse_world_x` - The world X coordinate of the mouse cursor
/// * `mouse_world_y` - The world Y coordinate of the mouse cursor
#[spacetimedb::reducer]
pub fn update_player_facing_direction(
    ctx: &ReducerContext,
    mouse_world_x: f32,
    mouse_world_y: f32,
) -> Result<(), String> {
    let sender_id = ctx.sender;
    let players = ctx.db.player();
    let dodge_roll_states = ctx.db.player_dodge_roll_state();

    let mut current_player = players.identity()
        .find(sender_id)
        .ok_or_else(|| "Player not found".to_string())?;

    // --- If player is dead, don't update facing direction ---
    if current_player.is_dead {
        log::trace!("Ignoring facing direction update for dead player {:?}", sender_id);
        return Ok(());
    }

    // --- Don't update facing direction during active dodge roll ---
    let now_ms = (ctx.timestamp.to_micros_since_unix_epoch() / 1000) as u64;
    if let Some(dodge_state) = dodge_roll_states.player_id().find(&sender_id) {
        let elapsed_ms = now_ms.saturating_sub(dodge_state.start_time_ms);
        if elapsed_ms < DODGE_ROLL_DURATION_MS {
            // Player is currently dodge rolling, don't update facing direction
            log::trace!("Skipping mouse direction update during dodge roll for player {:?}", sender_id);
            return Ok(());
        }
    }

    // --- Check if player is actively moving ---
    // If the player moved recently (within the last 100ms), skip mouse direction update
    // This prevents direction flipping while moving
    let now_micros = ctx.timestamp.to_micros_since_unix_epoch();
    let last_update_micros = current_player.last_update.to_micros_since_unix_epoch();
    let time_since_last_update_ms = (now_micros.saturating_sub(last_update_micros) / 1000) as u64;
    
    // If player moved within the last 100ms, they're considered "actively moving"
    const MOVEMENT_TIMEOUT_MS: u64 = 100;
    if time_since_last_update_ms < MOVEMENT_TIMEOUT_MS {
        // Player is actively moving, skip mouse direction update to prevent flipping
        return Ok(());
    }

    // Calculate direction vector from player to mouse cursor
    let dx = mouse_world_x - current_player.position_x;
    let dy = mouse_world_y - current_player.position_y;

    // Simple, pure mouse-based direction - no complex logic
    let new_direction = if dx.abs() > dy.abs() {
        // Mouse is more horizontal than vertical
        if dx > 0.0 { "right" } else { "left" }
    } else {
        // Mouse is more vertical than horizontal
        if dy > 0.0 { "down" } else { "up" }
    };

    // Only update if direction actually changed
    if current_player.direction != new_direction {
        current_player.direction = new_direction.to_string();
        current_player.last_update = ctx.timestamp;
        players.identity().update(current_player);
        log::trace!("Player {:?} facing direction updated to: {} (mouse-based, not moving)", sender_id, new_direction);
    }

    Ok(())
}

/// Reducer that handles player dodge roll requests.
/// 
/// This reducer is called by the client when a player attempts to dodge roll.
/// It checks if the player can dodge roll (not crouching, not dead, not knocked out),
/// verifies the cooldown, and initiates the dodge roll in the specified direction.
/// Supports 8-directional movement including diagonals.
#[spacetimedb::reducer]
pub fn dodge_roll(ctx: &ReducerContext, move_x: f32, move_y: f32) -> Result<(), String> {
    let sender_id = ctx.sender;
    let players = ctx.db.player();
    let dodge_roll_states = ctx.db.player_dodge_roll_state();

    let current_player = players.identity()
        .find(&sender_id)
        .ok_or_else(|| "Player not found".to_string())?;

    // Don't allow dodge rolling if dead
    if current_player.is_dead {
        return Err("Cannot dodge roll while dead.".to_string());
    }

    // Don't allow dodge rolling if knocked out
    if current_player.is_knocked_out {
        return Err("Cannot dodge roll while knocked out.".to_string());
    }

    // Don't allow dodge rolling while crouching
    if current_player.is_crouching {
        return Err("Cannot dodge roll while crouching.".to_string());
    }

    // Don't allow dodge rolling on water
    if is_player_on_water(ctx, current_player.position_x, current_player.position_y) {
        return Err("Cannot dodge roll on water.".to_string());
    }

    let now_ms = (ctx.timestamp.to_micros_since_unix_epoch() / 1000) as u64;

    // Check if player is already dodge rolling
    if let Some(existing_dodge) = dodge_roll_states.player_id().find(&sender_id) {
        let elapsed_ms = now_ms.saturating_sub(existing_dodge.start_time_ms);
        if elapsed_ms < DODGE_ROLL_DURATION_MS {
            return Err("Already dodge rolling.".to_string());
        }
    }

    // Check cooldown
    if let Some(existing_dodge) = dodge_roll_states.player_id().find(&sender_id) {
        let time_since_last_dodge = now_ms.saturating_sub(existing_dodge.last_dodge_time_ms);
        if time_since_last_dodge < DODGE_ROLL_COOLDOWN_MS {
            return Err(format!("Dodge roll on cooldown. Wait {:.1}s", 
                             (DODGE_ROLL_COOLDOWN_MS - time_since_last_dodge) as f32 / 1000.0));
        }
    }

    // Check if player is providing movement input
    if move_x == 0.0 && move_y == 0.0 {
        return Err("Must be moving to dodge roll. Hold a movement key (WASD) while pressing dodge.".to_string());
    }



    // Calculate dodge direction based on movement input (we know movement input exists due to earlier check)
    // Normalize the movement vector to get proper direction
    let magnitude = (move_x * move_x + move_y * move_y).sqrt();
    let (dodge_dx, dodge_dy) = if magnitude > 0.0 {
        (move_x / magnitude, move_y / magnitude)
    } else {
        // This shouldn't happen due to our earlier check, but fallback just in case
        (0.0, 1.0)
    };

    // Calculate target position
    let target_x = current_player.position_x + (dodge_dx * DODGE_ROLL_DISTANCE);
    let target_y = current_player.position_y + (dodge_dy * DODGE_ROLL_DISTANCE);

    // Clamp target to world bounds
    let effective_radius = get_effective_player_radius(current_player.is_crouching);
    let clamped_target_x = target_x.max(effective_radius).min(WORLD_WIDTH_PX - effective_radius);
    let clamped_target_y = target_y.max(effective_radius).min(WORLD_HEIGHT_PX - effective_radius);

    // Determine direction string for 8-directional support
    let direction_string = if dodge_dx == 0.0 && dodge_dy < 0.0 {
        "up".to_string()
    } else if dodge_dx == 0.0 && dodge_dy > 0.0 {
        "down".to_string()
    } else if dodge_dx < 0.0 && dodge_dy == 0.0 {
        "left".to_string()
    } else if dodge_dx > 0.0 && dodge_dy == 0.0 {
        "right".to_string()
    } else if dodge_dx < 0.0 && dodge_dy < 0.0 {
        "up_left".to_string()
    } else if dodge_dx > 0.0 && dodge_dy < 0.0 {
        "up_right".to_string()
    } else if dodge_dx < 0.0 && dodge_dy > 0.0 {
        "down_left".to_string()
    } else if dodge_dx > 0.0 && dodge_dy > 0.0 {
        "down_right".to_string()
    } else {
        current_player.direction.clone() // Fallback to player's facing direction
    };

    // Create or update dodge roll state
    let dodge_state = PlayerDodgeRollState {
        player_id: sender_id,
        start_time_ms: now_ms,
        start_x: current_player.position_x,
        start_y: current_player.position_y,
        target_x: clamped_target_x,
        target_y: clamped_target_y,
        direction: direction_string.clone(),
        last_dodge_time_ms: now_ms,
    };

    // Insert or update the dodge roll state
    if dodge_roll_states.player_id().find(&sender_id).is_some() {
        dodge_roll_states.player_id().update(dodge_state);
    } else {
        match dodge_roll_states.try_insert(dodge_state) {
            Ok(_) => {},
            Err(e) => {
                log::error!("Failed to insert dodge roll state for player {:?}: {}", sender_id, e);
                return Err("Failed to start dodge roll.".to_string());
            }
        }
    }

    log::info!("Player {:?} started dodge roll in direction: {} (no stamina cost)", 
               sender_id, direction_string);

    Ok(())
}

// === SIMPLE CLIENT-AUTHORITATIVE MOVEMENT SYSTEM ===

/// Simple movement validation constants
const BASE_MAX_MOVEMENT_SPEED: f32 = PLAYER_SPEED * SPRINT_SPEED_MULTIPLIER * 2.0; // 1600 px/s max (100% buffer over 800 px/s sprint speed for high latency)
const MAX_TELEPORT_DISTANCE: f32 = 600.0; // Increased for high ping tolerance (Croatia-Netherlands)
const POSITION_UPDATE_TIMEOUT_MS: u64 = 20000; // 20 seconds for users with 100+ ms ping

/// Calculate the maximum allowed movement speed for a player, accounting for exhausted effect
fn get_max_movement_speed_for_player(ctx: &ReducerContext, player_id: Identity) -> f32 {
    let has_exhausted_effect = player_has_exhausted_effect(ctx, player_id);
    
    if has_exhausted_effect {
        BASE_MAX_MOVEMENT_SPEED * EXHAUSTED_SPEED_PENALTY // 25% speed reduction when exhausted
    } else {
        BASE_MAX_MOVEMENT_SPEED
    }
}

// === WALKING SOUND CONSTANTS ===
const WALKING_SOUND_DISTANCE_THRESHOLD: f32 = 80.0; // Minimum distance for a footstep (normal walking)
const SPRINTING_SOUND_DISTANCE_THRESHOLD: f32 = 110.0; // Distance for footstep when sprinting (faster cadence)
const WALKING_SOUND_MIN_TIME_MS: u64 = 300; // Minimum time between footsteps (normal walking)
const SPRINTING_SOUND_MIN_TIME_MS: u64 = 250; // Minimum time between footsteps when sprinting (less aggressive)

// === SWIMMING SOUND CONSTANTS ===
const SWIMMING_SOUND_DISTANCE_THRESHOLD: f32 = 90.0; // Minimum distance for a swimming stroke (normal swimming)
const FAST_SWIMMING_SOUND_DISTANCE_THRESHOLD: f32 = 120.0; // Distance for swimming stroke when sprinting in water
const SWIMMING_SOUND_MIN_TIME_MS: u64 = 350; // Minimum time between swimming strokes (normal swimming)
const FAST_SWIMMING_SOUND_MIN_TIME_MS: u64 = 280; // Minimum time between swimming strokes when sprinting in water (less aggressive)

/// Simple timestamped position update from client
/// This replaces complex prediction with simple client-authoritative movement
#[spacetimedb::reducer]
pub fn update_player_position_simple(
    ctx: &ReducerContext,
    new_x: f32,
    new_y: f32,
    client_timestamp_ms: u64,
    is_sprinting: bool,
    facing_direction: String,
) -> Result<(), String> {
    let sender_id = ctx.sender;
    let players = ctx.db.player();
    
    let mut current_player = players.identity()
        .find(sender_id)
        .ok_or_else(|| "Player not found".to_string())?;

    // --- Basic validation checks ---
    
    // 1. Check if player is dead
    if current_player.is_dead {
        log::trace!("Ignoring position update for dead player {:?}", sender_id);
        return Err("Player is dead".to_string());
    }

    // 2. Check if player is knocked out - severely restrict movement but allow facing direction updates
    if current_player.is_knocked_out {
        // Allow very limited movement for knocked out players (crawling)
        let distance_moved = ((new_x - current_player.position_x).powi(2) + 
                             (new_y - current_player.position_y).powi(2)).sqrt();
        
        const KNOCKED_OUT_MAX_MOVEMENT_PER_UPDATE: f32 = 5.0; // Very slow crawling
        if distance_moved > KNOCKED_OUT_MAX_MOVEMENT_PER_UPDATE {
            log::trace!("Knocked out player {:?} attempted to move too far: {:.1}px (max: {}px), but allowing facing direction update", 
                       sender_id, distance_moved, KNOCKED_OUT_MAX_MOVEMENT_PER_UPDATE);
            
            // Don't reject the entire update - just update facing direction without moving
            current_player.direction = facing_direction;
            current_player.last_update = ctx.timestamp;
            players.identity().update(current_player);
            return Ok(()); // Accept the facing direction update
        }
        
        // Force knocked out players to not sprint
        if is_sprinting {
            log::trace!("Knocked out player {:?} attempted to sprint", sender_id);
            return Err("Cannot sprint while knocked out".to_string());
        }
    }

    // 2. Check world bounds
    let effective_radius = get_effective_player_radius(current_player.is_crouching);
    if new_x < effective_radius || new_x > WORLD_WIDTH_PX - effective_radius ||
       new_y < effective_radius || new_y > WORLD_HEIGHT_PX - effective_radius {
        log::warn!("Player {:?} position out of bounds: ({}, {})", sender_id, new_x, new_y);
        return Err("Position out of world bounds".to_string());
    }

    // 3. Check for teleporting (distance-based validation) - More lenient
    let distance_moved = ((new_x - current_player.position_x).powi(2) + 
                         (new_y - current_player.position_y).powi(2)).sqrt();
    
    if distance_moved > MAX_TELEPORT_DISTANCE {
        log::warn!("Player {:?} teleport detected: moved {:.1}px in one update (max: {})", sender_id, distance_moved, MAX_TELEPORT_DISTANCE);
        return Err("Movement too large, possible teleport".to_string());
    }

    // 4. Speed hack detection (optimized for 30fps client updates)
    let now_ms = (ctx.timestamp.to_micros_since_unix_epoch() / 1000) as u64;
    let last_update_ms = (current_player.last_update.to_micros_since_unix_epoch() / 1000) as u64;
    let time_diff_ms = now_ms.saturating_sub(last_update_ms);
    
    // Only validate speed for reasonable time intervals (avoid false positives from lag spikes)
    // More lenient validation for high-latency connections (Croatia-Netherlands)
    if time_diff_ms >= 20 && time_diff_ms <= 300 && distance_moved > 5.0 { // 20-300ms window, min 5px movement
        let speed_px_per_sec = (distance_moved * 1000.0) / time_diff_ms as f32;
        let max_speed_for_player = get_max_movement_speed_for_player(ctx, sender_id);
        
        if speed_px_per_sec > max_speed_for_player {
            let has_exhausted = player_has_exhausted_effect(ctx, sender_id);
            log::warn!("Player {:?} speed hack detected: {:.1}px/s (max: {:.1}{}) over {}ms", 
                      sender_id, speed_px_per_sec, max_speed_for_player, 
                      if has_exhausted { " - exhausted" } else { "" }, time_diff_ms);
            return Err("Movement speed too high".to_string());
        }
    }

    // 5. Check timestamp age (prevent replay attacks) - More lenient
    if now_ms.saturating_sub(client_timestamp_ms) > POSITION_UPDATE_TIMEOUT_MS {
        log::warn!("Player {:?} position update too old: {}ms", sender_id, now_ms.saturating_sub(client_timestamp_ms));
        return Err("Position update too old".to_string());
    }

    // --- Apply CLIENT-FRIENDLY collision detection ---
    // For client-authoritative movement, we need to be less aggressive to maintain smoothness
    
    // GET: Effective player radius based on crouching state
    let effective_radius = get_effective_player_radius(current_player.is_crouching);

    // World bounds clamping (same as original)
    let clamped_x = new_x.max(effective_radius).min(WORLD_WIDTH_PX - effective_radius);
    let clamped_y = new_y.max(effective_radius).min(WORLD_HEIGHT_PX - effective_radius);

    // Calculate how far the client wants to move
    let movement_distance = ((clamped_x - current_player.position_x).powi(2) + (clamped_y - current_player.position_y).powi(2)).sqrt();
    
    // DEBUG: Reduced logging to avoid spam
    if movement_distance > 50.0 {
        log::debug!("Player {:?} large movement: distance={:.1}", sender_id, movement_distance);
    }
    
    // Only apply collision correction for reasonable movements to avoid rubber banding
    // Further increased threshold for sprinting with high latency (Croatia-Netherlands)
    let (final_x, final_y) = if movement_distance < 200.0 { // Increased threshold for sprinting + latency tolerance
        // Apply collision detection with improved separation
        let server_dx = clamped_x - current_player.position_x;
        let server_dy = clamped_y - current_player.position_y;
        
        // Use sliding collision for smooth movement around obstacles
        let (slid_x, slid_y) = player_collision::calculate_slide_collision(
            ctx, 
            sender_id, 
            current_player.position_x,
            current_player.position_y,
            clamped_x,
            clamped_y,
            server_dx,
            server_dy
        );
        
        // 🚀 GRAVITY WELL FIX: Skip push-out if sliding provided significant correction
        // This prevents double-correction conflicts that cause gravity wells
        let slide_distance = ((slid_x - clamped_x).powi(2) + (slid_y - clamped_y).powi(2)).sqrt();
        if slide_distance > 3.0 { // If sliding moved us significantly, trust the slide result
            log::debug!("Player {:?} slide correction of {:.1}px applied, skipping push-out", sender_id, slide_distance);
            (slid_x, slid_y)
        } else {
            // Only apply gentle push-out if sliding didn't resolve the collision
            let push_result = player_collision::resolve_push_out_collision(ctx, sender_id, slid_x, slid_y);
            
            // Verify the push-out didn't move us too far from intended position
            let push_distance = ((push_result.0 - slid_x).powi(2) + (push_result.1 - slid_y).powi(2)).sqrt();
            if push_distance > 20.0 { // Don't allow push-out to move us more than 20px
                log::debug!("Player {:?} push-out distance {:.1}px too large, using slide result", sender_id, push_distance);
                (slid_x, slid_y)
            } else {
                push_result
            }
        }
    } else {
        // For large movements (teleports, lag spikes), trust the client more but still clamp
        log::debug!("Player {:?} large movement {:.1}px detected, skipping collision", sender_id, movement_distance);
        (clamped_x, clamped_y)
    };

    // --- Water detection for new position ---
    let is_on_water = is_player_on_water(ctx, final_x, final_y);
    let is_jumping = is_player_jumping(current_player.jump_start_time_ms, now_ms);

    // --- Extinguish burn effects and apply wet effect if player entered water ---
    if is_on_water && !current_player.is_on_water {
        // Player just entered water - extinguish any burn effects
        crate::active_effects::extinguish_burn_effects(ctx, sender_id, "entering water");
        // Apply wet effect when entering water
        if let Err(e) = crate::wet::apply_wet_effect(ctx, sender_id, "entering water") {
            log::warn!("Failed to apply wet effect when player {:?} entered water: {}", sender_id, e);
        }
    }

    // --- Movement Sound Logic (Walking & Swimming) ---
    // Only emit movement sounds if player actually moved and conditions are right
    if movement_distance > 3.0 && // Moved a meaningful distance
       !current_player.is_dead && 
       !current_player.is_knocked_out &&
       !is_jumping {   // No movement sounds while jumping
        
        let walking_sound_states = ctx.db.player_walking_sound_state();
        
        // Get or create walking sound state for this player
        let mut walking_state = walking_sound_states.player_id().find(&sender_id).unwrap_or_else(|| {
            PlayerWalkingSoundState {
                player_id: sender_id,
                last_walking_sound_time_ms: 0,
                total_distance_since_last_sound: 0.0,
                last_swimming_sound_time_ms: 0,
                total_swimming_distance_since_last_sound: 0.0,
            }
        });
        
        if is_on_water {
            // --- Swimming Sound Logic ---
            // Add movement distance to accumulated swimming total
            walking_state.total_swimming_distance_since_last_sound += movement_distance;
            
            // Determine thresholds based on movement speed (sprinting in water)
            let (distance_threshold, time_threshold_ms) = if is_sprinting {
                (FAST_SWIMMING_SOUND_DISTANCE_THRESHOLD, FAST_SWIMMING_SOUND_MIN_TIME_MS)
            } else {
                (SWIMMING_SOUND_DISTANCE_THRESHOLD, SWIMMING_SOUND_MIN_TIME_MS)
            };
            
            // Check if enough distance and time has passed for a swimming stroke
            let time_since_last_stroke = now_ms.saturating_sub(walking_state.last_swimming_sound_time_ms);
            
            if walking_state.total_swimming_distance_since_last_sound >= distance_threshold && 
               time_since_last_stroke >= time_threshold_ms {
                
                // Emit swimming sound
                emit_swimming_sound(ctx, final_x, final_y, sender_id);
                
                // Reset accumulated swimming distance and update time
                walking_state.total_swimming_distance_since_last_sound = 0.0;
                walking_state.last_swimming_sound_time_ms = now_ms;
                
                log::debug!("Player {:?} swimming stroke at ({:.1}, {:.1}) - sprinting: {}, distance: {:.1}", 
                           sender_id, final_x, final_y, is_sprinting, movement_distance);
            }
        } else if !current_player.is_crouching {
            // --- Walking Sound Logic (on land, not crouching) ---
            // Add movement distance to accumulated total
            walking_state.total_distance_since_last_sound += movement_distance;
            
            // Determine thresholds based on movement speed
            let (distance_threshold, time_threshold_ms) = if is_sprinting {
                (SPRINTING_SOUND_DISTANCE_THRESHOLD, SPRINTING_SOUND_MIN_TIME_MS)
            } else {
                (WALKING_SOUND_DISTANCE_THRESHOLD, WALKING_SOUND_MIN_TIME_MS)
            };
            
            // Check if enough distance and time has passed for a footstep
            let time_since_last_footstep = now_ms.saturating_sub(walking_state.last_walking_sound_time_ms);
            
            if walking_state.total_distance_since_last_sound >= distance_threshold && 
               time_since_last_footstep >= time_threshold_ms {
                
                // Emit walking sound
                emit_walking_sound(ctx, final_x, final_y, sender_id);
                
                // Reset accumulated distance and update time
                walking_state.total_distance_since_last_sound = 0.0;
                walking_state.last_walking_sound_time_ms = now_ms;
                
                log::debug!("Player {:?} footstep at ({:.1}, {:.1}) - sprinting: {}, distance: {:.1}", 
                           sender_id, final_x, final_y, is_sprinting, movement_distance);
            }
        }
        

        
        // Update or insert the walking sound state
        if walking_sound_states.player_id().find(&sender_id).is_some() {
            walking_sound_states.player_id().update(walking_state);
        } else {
            if let Err(e) = walking_sound_states.try_insert(walking_state) {
                log::warn!("Failed to insert walking sound state for player {:?}: {}", sender_id, e);
            }
        }
    }

    // --- Update player state ---
    current_player.position_x = final_x;
    current_player.position_y = final_y;
    current_player.is_sprinting = is_sprinting; // Allow sprinting in water
    current_player.is_on_water = is_on_water;
    current_player.direction = facing_direction; // Accept client-provided direction
    current_player.last_update = ctx.timestamp;

    players.identity().update(current_player);

    // Only log successful updates very rarely to reduce spam
    if ctx.rng().gen_bool(0.001) { // 0.1% of successful updates
        log::debug!("Player {:?} position updated to ({:.1}, {:.1})", sender_id, final_x, final_y);
    }

    Ok(())
}