use spacetimedb::{Identity, Timestamp, ReducerContext, Table};
use log;

// Import table traits needed for database access
use crate::player as PlayerTableTrait;
use crate::tree::tree as TreeTableTrait;
use crate::stone::stone as StoneTableTrait;
use crate::wooden_storage_box::{self as WoodenStorageBoxModule, wooden_storage_box as WoodenStorageBoxTableTrait, WoodenStorageBox, PLAYER_BOX_COLLISION_DISTANCE_SQUARED, BOX_COLLISION_Y_OFFSET};
use crate::campfire::{self as CampfireModule, campfire as CampfireTableTrait, Campfire, PLAYER_CAMPFIRE_COLLISION_DISTANCE_SQUARED, CAMPFIRE_COLLISION_Y_OFFSET};
use crate::grass::grass as GrassTableTrait;
use crate::player_stats::stat_thresholds_config as StatThresholdsConfigTableTrait;

// Import constants from lib.rs
use crate::{PLAYER_RADIUS, PLAYER_SPEED, WORLD_WIDTH_PX, WORLD_HEIGHT_PX};

// Import constants from player_stats module
use crate::player_stats::{SPRINT_SPEED_MULTIPLIER, LOW_THIRST_SPEED_PENALTY, LOW_WARMTH_SPEED_PENALTY, JUMP_COOLDOWN_MS};

// Import constants from environment module
use crate::environment::{calculate_chunk_index, WORLD_WIDTH_CHUNKS};

// Import the new player_collision module
use crate::player_collision;

// Import grass types
use crate::grass::GrassAppearanceType;

/// Updates player position based on client input, handling:
/// - Movement speed and direction
/// - Sprinting state and speed modifiers
/// - Collision detection with world objects
/// - Animation direction updates
/// - Death and knocked out state checks
#[spacetimedb::reducer]
pub fn update_player_position(
    ctx: &ReducerContext,
    // Raw direction components from client input (-1, 0, 1) - server will normalize
    move_x: f32,
    move_y: f32,
) -> Result<(), String> {
    let sender_id = ctx.sender;
    let players = ctx.db.player();
    let trees = ctx.db.tree();
    let stones = ctx.db.stone();
    let campfires = ctx.db.campfire();
    let wooden_storage_boxes = ctx.db.wooden_storage_box();

    let current_player = players.identity()
        .find(sender_id)
        .ok_or_else(|| "Player not found".to_string())?;

    // --- If player is dead, prevent movement ---
    if current_player.is_dead {
        log::trace!("Ignoring movement input for dead player {:?}", sender_id);
        return Ok(()); // Do nothing if dead
    }

    // --- NEW: If player is knocked out, prevent sprinting ---
    let mut current_sprinting_state = current_player.is_sprinting;
    if current_player.is_knocked_out {
        current_sprinting_state = false; // Force sprinting off for knocked out players
    }

    // --- Determine Animation Direction from Input Vector ---
    let mut final_anim_direction = current_player.direction.clone();
    // Basic check: If there's significant movement
    if move_x.abs() > 0.01 || move_y.abs() > 0.01 {
        // Prioritize horizontal or vertical based on magnitude
        if move_x.abs() > move_y.abs() {
            final_anim_direction = if move_x > 0.0 { "right".to_string() } else { "left".to_string() };
        } else {
            final_anim_direction = if move_y > 0.0 { "down".to_string() } else { "up".to_string() };
        }
    }
    // If input is (0,0), keep the previous direction

    if final_anim_direction != current_player.direction {
        log::trace!("Player {:?} animation direction set to: {}", sender_id, final_anim_direction);
    }
    // --- End Animation Direction ---

    let now = ctx.timestamp;

    // --- Calculate Delta Time ---
    let elapsed_micros = now.to_micros_since_unix_epoch().saturating_sub(current_player.last_update.to_micros_since_unix_epoch());
    // Clamp max delta time to avoid huge jumps on first update or after lag spikes (e.g., 100ms)
    let delta_time_secs = (elapsed_micros as f32 / 1_000_000.0).min(0.05); // Clamp max delta time

    // --- Stamina Drain & Base Speed Calculation ---
    let mut new_stamina = current_player.stamina; // Base this on current_player for speed calc
    let mut base_speed_multiplier = 1.0;
    // Movement now depends only on having a direction input from the client
    let is_moving = move_x.abs() > 0.01 || move_y.abs() > 0.01;
    let mut current_sprinting_state = current_player.is_sprinting;

    // Determine speed multiplier based on current sprint state and stamina
    if current_sprinting_state && new_stamina > 0.0 { // Check current stamina > 0
        base_speed_multiplier = SPRINT_SPEED_MULTIPLIER;
    } else if current_sprinting_state && new_stamina <= 0.0 {
        // If trying to sprint but no stamina, force sprint state off for this tick's movement calc
        current_sprinting_state = false;
        base_speed_multiplier = 1.0; // Use base speed
        // The actual player.is_sprinting state will be forced off in player_stats.rs
    }

    // --- Calculate Final Speed Multiplier based on Current Stats ---
    let mut final_speed_multiplier = base_speed_multiplier;
    // Use current player stats read at the beginning of the reducer

    // NEW: Apply massive speed reduction if knocked out (95% slower, so 5% of normal speed)
    if current_player.is_knocked_out {
        final_speed_multiplier *= 0.05; // Only 5% of normal speed
        log::trace!("Player {:?} is knocked out. Speed multiplier reduced to: {}", sender_id, final_speed_multiplier);
    }

    // Apply fine movement speed reduction if active
    if current_player.is_crouching {
        final_speed_multiplier *= 0.5; // Reduce speed by 50%
        log::trace!("Player {:?} crouching active. Speed multiplier adjusted to: {}", sender_id, final_speed_multiplier);
    }

    // --- <<< UPDATED: Read LOW_NEED_THRESHOLD from StatThresholdsConfig table >>> ---
    let stat_thresholds_config_table = ctx.db.stat_thresholds_config(); // <<< CORRECT: Use the direct table accessor
    let stat_thresholds_config = stat_thresholds_config_table.iter().filter(|stc| stc.id == 0).next();
    
    let mut effective_speed = PLAYER_SPEED * final_speed_multiplier;
    if let Some(config) = stat_thresholds_config { // <<< UPDATED variable name
        let low_need_threshold = config.low_need_threshold;
        if current_player.thirst < low_need_threshold {
            effective_speed *= LOW_THIRST_SPEED_PENALTY;
            log::debug!("Player {:?} has low thirst. Applying speed penalty. New speed: {}", sender_id, effective_speed);
        }
        if current_player.warmth < low_need_threshold {
            effective_speed *= LOW_WARMTH_SPEED_PENALTY;
            log::debug!("Player {:?} is cold. Applying speed penalty. New speed: {}", sender_id, effective_speed);
        }
    } else {
        log::warn!("StatThresholdsConfig not found for player {}. Using default behavior (no penalty applied from config).", sender_id);
    }

    // --- Calculate Target Velocity & Server Displacement ---
    let target_speed = effective_speed;
    
    // Normalize the movement vector to prevent diagonal movement from being faster
    let move_magnitude = (move_x * move_x + move_y * move_y).sqrt();
    let (normalized_move_x, normalized_move_y) = if move_magnitude > 0.0 {
        (move_x / move_magnitude, move_y / move_magnitude)
    } else {
        (0.0, 0.0)
    };
    
    // Velocity is the properly normalized direction vector scaled by target speed
    let velocity_x = normalized_move_x * target_speed;
    let velocity_y = normalized_move_y * target_speed;

    let server_dx = velocity_x * delta_time_secs;
    let server_dy = velocity_y * delta_time_secs;


    // --- Movement Calculation ---
    // Use server-calculated displacement
    let proposed_x = current_player.position_x + server_dx;
    let proposed_y = current_player.position_y + server_dy;

    let clamped_x = proposed_x.max(PLAYER_RADIUS).min(WORLD_WIDTH_PX - PLAYER_RADIUS);
    let clamped_y = proposed_y.max(PLAYER_RADIUS).min(WORLD_HEIGHT_PX - PLAYER_RADIUS);

    let mut final_x = clamped_x;
    let mut final_y = clamped_y;
    let mut collision_handled = false;

    // --- Call Slide Collision Logic --- 
    let (slid_x, slid_y) = player_collision::calculate_slide_collision(
        ctx, 
        sender_id, 
        current_player.position_x, // Pass current player position for accurate slide from original point
        current_player.position_y,
        clamped_x, // Pass the initially clamped proposed position
        clamped_y,
        server_dx, // Pass the original server displacement for slide calculation
        server_dy
    );

    // --- Call Push-Out Collision Resolution Logic --- 
    let (resolved_x, resolved_y) = player_collision::resolve_push_out_collision(
        ctx, 
        sender_id, 
        slid_x, // Pass the position after sliding
        slid_y
    );

    // --- Grass Disturbance Detection (OPTIMIZED) ---
    const MIN_MOVEMENT_FOR_DISTURBANCE: f32 = 3.0;
    let movement_magnitude_for_disturbance = (server_dx * server_dx + server_dy * server_dy).sqrt();
    let should_check_disturbance = is_moving && movement_magnitude_for_disturbance > MIN_MOVEMENT_FOR_DISTURBANCE;
    
    if should_check_disturbance {
        let grasses = ctx.db.grass();
        let current_time = ctx.timestamp;
        
        if movement_magnitude_for_disturbance > 0.0 {
            let normalized_movement_x_disturb = server_dx / movement_magnitude_for_disturbance;
            let normalized_movement_y_disturb = server_dy / movement_magnitude_for_disturbance;
            let disturbance_direction_x = -normalized_movement_x_disturb;
            let disturbance_direction_y = -normalized_movement_y_disturb;
            
            const OPTIMIZED_DISTURBANCE_RADIUS: f32 = 48.0;
            const OPTIMIZED_DISTURBANCE_RADIUS_SQ: f32 = OPTIMIZED_DISTURBANCE_RADIUS * OPTIMIZED_DISTURBANCE_RADIUS;
            
            let player_chunk_index = calculate_chunk_index(resolved_x, resolved_y);
            let chunk_x = player_chunk_index % WORLD_WIDTH_CHUNKS;
            let chunk_y = player_chunk_index / WORLD_WIDTH_CHUNKS;
            
            let mut chunks_to_check = Vec::new();
            for dy_offset in -1i32..=1i32 {
                for dx_offset in -1i32..=1i32 {
                    let new_chunk_x = chunk_x as i32 + dx_offset;
                    let new_chunk_y = chunk_y as i32 + dy_offset;
                    
                    if new_chunk_x >= 0 && new_chunk_x < WORLD_WIDTH_CHUNKS as i32 &&
                       new_chunk_y >= 0 && new_chunk_y < WORLD_WIDTH_CHUNKS as i32 {
                        let chunk_idx = (new_chunk_y as u32 * WORLD_WIDTH_CHUNKS + new_chunk_x as u32);
                        chunks_to_check.push(chunk_idx);
                    }
                }
            }
            
            const MAX_DISTURBANCES_PER_MOVEMENT: usize = 8;
            let mut disturbed_count = 0;
            let chunks_set: std::collections::HashSet<u32> = chunks_to_check.iter().cloned().collect();
            let mut grass_updates = Vec::new();
            
            for grass in grasses.iter() {
                if disturbed_count >= MAX_DISTURBANCES_PER_MOVEMENT { break; }
                if !chunks_set.contains(&grass.chunk_index) { continue; }
                if grass.health == 0 { continue; }
                if let Some(last_disturbed) = grass.disturbed_at {
                    let time_since_last_disturbance = current_time.to_micros_since_unix_epoch()
                        .saturating_sub(last_disturbed.to_micros_since_unix_epoch());
                    if time_since_last_disturbance < 500_000 { continue; }
                }
                
                let should_disturb_type = match grass.appearance_type {
                    crate::grass::GrassAppearanceType::PatchA |
                    crate::grass::GrassAppearanceType::PatchB |
                    crate::grass::GrassAppearanceType::PatchC |
                    crate::grass::GrassAppearanceType::TallGrassA |
                    crate::grass::GrassAppearanceType::TallGrassB => true,
                    _ => false,
                };
                if !should_disturb_type { continue; }
                
                let dx_grass = resolved_x - grass.pos_x;
                let dy_grass = resolved_y - grass.pos_y;
                let dist_sq_grass = dx_grass * dx_grass + dy_grass * dy_grass;
                
                if dist_sq_grass <= OPTIMIZED_DISTURBANCE_RADIUS_SQ {
                    let mut grass_to_update = grass.clone();
                    grass_to_update.disturbed_at = Some(current_time);
                    grass_to_update.disturbance_direction_x = disturbance_direction_x;
                    grass_to_update.disturbance_direction_y = disturbance_direction_y;
                    grass_updates.push(grass_to_update);
                    disturbed_count += 1;
                }
            }
            
            for grass_update in grass_updates {
                grasses.id().update(grass_update);
            }
            
            if disturbed_count > 0 {
                log::trace!("Player {:?} disturbed {} grass patches (limit: {})", sender_id, disturbed_count, MAX_DISTURBANCES_PER_MOVEMENT);
            }
        }
    }

    // --- Final Update ---
    let mut player_to_update = current_player.clone(); // Get a mutable copy by CLONING

    // Check if position or direction actually changed
    let position_changed = (resolved_x - player_to_update.position_x).abs() > 0.01 ||
                           (resolved_y - player_to_update.position_y).abs() > 0.01;
    // Check against the animation direction determined earlier
    let direction_changed = player_to_update.direction != final_anim_direction;
    // Don't check stamina/sprint changes here, they are handled by player_stats
    let should_update_state = position_changed || direction_changed;

    // Always update timestamp if delta_time > 0 to prevent accumulation on next tick
    // This ensures last_update reflects the time this reducer processed movement,
    // even if the final position/direction didn't change due to collision or no input.
    let needs_timestamp_update = delta_time_secs > 0.0;

    if should_update_state {
        log::trace!("Updating player {:?} - PosChange: {}, DirChange: {}",
            sender_id, position_changed, direction_changed);

        player_to_update.position_x = resolved_x;
        player_to_update.position_y = resolved_y;
        player_to_update.direction = final_anim_direction; // Update animation direction
        player_to_update.last_update = now; // Update timestamp because state changed

        players.identity().update(player_to_update.clone()); // Update the modified player struct
    } else if needs_timestamp_update { // If no state changed, but time passed
         log::trace!("No movement state changes detected for player {:?}, but updating timestamp due to elapsed time.", sender_id);
         // Update only the timestamp on the existing player data
         player_to_update.last_update = now;
         players.identity().update(player_to_update.clone()); // CLONE here too for consistency if player_to_update was a mutable borrow later
    } else {
         // This case should be rare (delta_time <= 0.0)
         log::trace!("No state changes and no time elapsed for player {:?}, skipping update.", sender_id);
    }

    Ok(())
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

       let now_micros = ctx.timestamp.to_micros_since_unix_epoch();
       let now_ms = (now_micros / 1000) as u64;

       // Check if the player is already jumping (within cooldown)
       if player.jump_start_time_ms > 0 && now_ms < player.jump_start_time_ms + JUMP_COOLDOWN_MS {
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