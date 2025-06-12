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
use crate::player_stats::{SPRINT_SPEED_MULTIPLIER, LOW_THIRST_SPEED_PENALTY, LOW_WARMTH_SPEED_PENALTY, JUMP_COOLDOWN_MS};

// Import constants from environment module
use crate::environment::{calculate_chunk_index, WORLD_WIDTH_CHUNKS};

// Import the new player_collision module
use crate::player_collision;

// Import grass types
use crate::grass::GrassAppearanceType;

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

/// Updates player position based on client input, handling:
/// - Movement speed and direction
/// - Sprinting state and speed modifiers
/// - Collision detection with world objects
/// - Animation direction updates
/// - Death and knocked out state checks
/// - Dodge roll physics when active
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
    let dodge_roll_states = ctx.db.player_dodge_roll_state();

    let current_player = players.identity()
        .find(sender_id)
        .ok_or_else(|| "Player not found".to_string())?;

    // --- If player is dead, prevent movement ---
    if current_player.is_dead {
        log::trace!("Ignoring movement input for dead player {:?}", sender_id);
        return Ok(()); // Do nothing if dead
    }

    let now = ctx.timestamp;
    let now_ms = (now.to_micros_since_unix_epoch() / 1000) as u64;

    // === CHECK FOR ACTIVE DODGE ROLL ===
    let active_dodge_roll = dodge_roll_states.player_id().find(&sender_id);
    
    // If player is dodge rolling, handle dodge roll physics instead of normal movement
    if let Some(dodge_state) = active_dodge_roll {
        let elapsed_ms = now_ms.saturating_sub(dodge_state.start_time_ms);
        
        if elapsed_ms < DODGE_ROLL_DURATION_MS {
            // Dodge roll is still active - calculate position based on dodge physics
            let progress = elapsed_ms as f32 / DODGE_ROLL_DURATION_MS as f32;
            
            // Use easing for more natural movement (ease-out)
            let eased_progress = 1.0 - (1.0 - progress).powi(3);
            
            let target_x = dodge_state.start_x + (dodge_state.target_x - dodge_state.start_x) * eased_progress;
            let target_y = dodge_state.start_y + (dodge_state.target_y - dodge_state.start_y) * eased_progress;
            
            // Clamp to world bounds
            let effective_radius = get_effective_player_radius(current_player.is_crouching);
            let clamped_x = target_x.max(effective_radius).min(WORLD_WIDTH_PX - effective_radius);
            let clamped_y = target_y.max(effective_radius).min(WORLD_HEIGHT_PX - effective_radius);
            
            // Apply collision detection during dodge roll
            let (final_x, final_y) = player_collision::resolve_push_out_collision(
                ctx, 
                sender_id, 
                clamped_x,
                clamped_y
            );
            
            // Update player position
            let mut player_to_update = current_player.clone();
            player_to_update.position_x = final_x;
            player_to_update.position_y = final_y;
            player_to_update.direction = dodge_state.direction.clone();
            player_to_update.last_update = now;
            
            players.identity().update(player_to_update);
            
            log::trace!("Player {:?} dodge rolling: progress {:.2}, pos ({:.1}, {:.1})", 
                       sender_id, progress, final_x, final_y);
            
            return Ok(());
        } else {
            // Dodge roll finished - clean up state
            dodge_roll_states.player_id().delete(&sender_id);
            log::debug!("Player {:?} dodge roll completed", sender_id);
        }
    }

    // === NORMAL MOVEMENT LOGIC (unchanged from here) ===
    // --- NEW: If player is knocked out, prevent sprinting ---
    let mut current_sprinting_state = current_player.is_sprinting;
    if current_player.is_knocked_out {
        current_sprinting_state = false; // Force sprinting off for knocked out players
    }

    // --- Movement-based Facing Direction ---
    // When player is actively moving, face the direction of movement
    // This prevents mouse-based direction flipping while moving
    let dx = move_x;
    let dy = move_y;
    let final_anim_direction = if dx != 0.0 || dy != 0.0 {
        // Player is actively moving - face movement direction
        if dx.abs() > dy.abs() {
            // Horizontal movement dominates
            if dx > 0.0 { "right" } else { "left" }
        } else {
            // Vertical movement dominates
            if dy > 0.0 { "down" } else { "up" }
        }
    } else {
        // No movement - keep current direction (mouse-based updates will handle this)
        current_player.direction.as_str()
    };

    // --- ADD: Water Detection ---
    // Check water status at current position for reference
    let was_on_water = current_player.is_on_water;
    
    // --- ADD: Jump Detection ---
    let now_ms = (now.to_micros_since_unix_epoch() / 1000) as u64;
    let is_jumping = is_player_jumping(current_player.jump_start_time_ms, now_ms);
    


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

    // REMOVED: Allow sprinting on water - players can sprint in water now
    // The water speed penalty will still apply, making sprint-in-water slower than normal walking
    
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
        // Reduced logging frequency for performance
        if !current_player.is_sprinting { // Only log when not sprinting to reduce spam
            log::trace!("Player {:?} is knocked out. Speed multiplier reduced to: {}", sender_id, final_speed_multiplier);
        }
    }

    // Apply fine movement speed reduction if active
    if current_player.is_crouching {
        final_speed_multiplier *= 0.5; // Reduce speed by 50%
        // Reduced logging frequency for performance  
        if !current_player.is_sprinting { // Only log when not sprinting to reduce spam
            log::trace!("Player {:?} crouching active. Speed multiplier adjusted to: {}", sender_id, final_speed_multiplier);
        }
    }

    // ADD: Apply water speed penalty (but not while jumping over water)
    if was_on_water && !is_jumping {
        final_speed_multiplier *= WATER_SPEED_PENALTY; // 50% speed reduction
        // Reduced logging frequency for performance
        if !current_player.is_sprinting { // Only log when not sprinting to reduce spam
            log::trace!("Player {:?} water speed penalty applied (not jumping). Speed multiplier: {}", sender_id, final_speed_multiplier);
        }
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

    // GET: Effective player radius based on crouching state
    let effective_radius = get_effective_player_radius(current_player.is_crouching);

    let clamped_x = proposed_x.max(effective_radius).min(WORLD_WIDTH_PX - effective_radius);
    let clamped_y = proposed_y.max(effective_radius).min(WORLD_HEIGHT_PX - effective_radius);

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

    // --- ADD: Water Detection at NEW position ---
    let is_on_water = is_player_on_water(ctx, resolved_x, resolved_y);
    
    if is_on_water {
        log::trace!("Player {:?} is on water tile at new position ({:.1}, {:.1}), jumping: {}", sender_id, resolved_x, resolved_y, is_jumping);
    }

    // --- ADD: Auto-uncrouch when entering water ---
    // If player is crouching and moves into water, automatically uncrouch them (start swimming)
    let mut auto_uncrouch_needed = false;
    if current_player.is_crouching && is_on_water && !is_jumping {
        auto_uncrouch_needed = true;
        log::debug!("Player {:?} auto-uncrouching due to entering water at new position ({:.1}, {:.1})", sender_id, resolved_x, resolved_y);
    }

    // --- Grass Disturbance Detection (HEAVILY OPTIMIZED) ---
    // PERFORMANCE: Check global disable flag first
    if !crate::grass::DISABLE_GRASS_DISTURBANCE {
        const MIN_MOVEMENT_FOR_DISTURBANCE: f32 = 15.0; // Increased from 3.0 to 15.0 - only disturb on significant movement
        let movement_magnitude_for_disturbance = (server_dx * server_dx + server_dy * server_dy).sqrt();
        // PERFORMANCE: Only check disturbance every 5th movement update to prevent lag
        let should_check_disturbance = is_moving && 
                                       movement_magnitude_for_disturbance > MIN_MOVEMENT_FOR_DISTURBANCE &&
                                       (now_ms % 5) == 0; // Only process 20% of movement updates
        
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
            
            // HEAVY OPTIMIZATION: Drastically reduce grass disturbance processing to prevent lag
            let max_disturbances = if current_sprinting_state { 1 } else { 3 }; // Minimal disturbance count
            let chunk_search_radius = 0; // Always only check current chunk for maximum performance
            
            let player_chunk_index = calculate_chunk_index(resolved_x, resolved_y);
            let chunk_x = player_chunk_index % WORLD_WIDTH_CHUNKS;
            let chunk_y = player_chunk_index / WORLD_WIDTH_CHUNKS;
            
            let mut chunks_to_check = Vec::new();
            for dy_offset in -chunk_search_radius..=chunk_search_radius {
                for dx_offset in -chunk_search_radius..=chunk_search_radius {
                    let new_chunk_x = chunk_x as i32 + dx_offset;
                    let new_chunk_y = chunk_y as i32 + dy_offset;
                    
                    if new_chunk_x >= 0 && new_chunk_x < WORLD_WIDTH_CHUNKS as i32 &&
                       new_chunk_y >= 0 && new_chunk_y < WORLD_WIDTH_CHUNKS as i32 {
                        let chunk_idx = (new_chunk_y as u32 * WORLD_WIDTH_CHUNKS + new_chunk_x as u32);
                        chunks_to_check.push(chunk_idx);
                    }
                }
            }
            
            let mut disturbed_count = 0;
            let chunks_set: std::collections::HashSet<u32> = chunks_to_check.iter().cloned().collect();
            let mut grass_updates = Vec::new();
            
            for grass in grasses.iter() {
                if disturbed_count >= max_disturbances { break; } // Use dynamic limit
                if !chunks_set.contains(&grass.chunk_index) { continue; }
                if grass.health == 0 { continue; }
                if let Some(last_disturbed) = grass.disturbed_at {
                    let time_since_last_disturbance = current_time.to_micros_since_unix_epoch()
                        .saturating_sub(last_disturbed.to_micros_since_unix_epoch());
                    if time_since_last_disturbance < 2_000_000 { continue; } // Increased from 0.5s to 2s cooldown
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
                log::trace!("Player {:?} disturbed {} grass patches (limit: {}, sprinting: {})", sender_id, disturbed_count, max_disturbances, current_sprinting_state);
            }
        }
    } // End of should_check_disturbance block
    } // End of DISABLE_GRASS_DISTURBANCE check

    // --- Final Update ---
    let mut player_to_update = current_player.clone(); // Get a mutable copy by CLONING

    // Check if position or direction actually changed
    let position_changed = (resolved_x - player_to_update.position_x).abs() > 0.01 ||
                           (resolved_y - player_to_update.position_y).abs() > 0.01;
    let direction_changed = player_to_update.direction != final_anim_direction;
    
    // ADD: Check if water status changed
    let water_status_changed = player_to_update.is_on_water != is_on_water;
    
    // ADD: Check if crouch state needs to change due to water
    let crouch_status_changed = auto_uncrouch_needed;
    
    let should_update_state = position_changed || direction_changed || water_status_changed || crouch_status_changed;

    // Always update timestamp if delta_time > 0 to prevent accumulation on next tick
    // This ensures last_update reflects the time this reducer processed movement,
    // even if the final position/direction didn't change due to collision or no input.
    let needs_timestamp_update = delta_time_secs > 0.0;

    if should_update_state {
        log::trace!("Updating player {:?} - PosChange: {}, DirChange: {}, WaterChange: {}, CrouchChange: {}",
            sender_id, position_changed, direction_changed, water_status_changed, crouch_status_changed);

        player_to_update.position_x = resolved_x;
        player_to_update.position_y = resolved_y;
        player_to_update.direction = final_anim_direction.to_string();
        player_to_update.is_on_water = is_on_water; // ADD: Update water status
        
        // ADD: Apply auto-uncrouch if needed
        if auto_uncrouch_needed {
            player_to_update.is_crouching = false;
            log::info!("Player {:?} automatically uncrouched due to entering water", sender_id);
        }
        
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
const MAX_MOVEMENT_SPEED: f32 = PLAYER_SPEED * SPRINT_SPEED_MULTIPLIER * 2.0; // More lenient for high ping users
const MAX_TELEPORT_DISTANCE: f32 = 400.0; // Increased for high ping tolerance  
const POSITION_UPDATE_TIMEOUT_MS: u64 = 15000; // 15 seconds for users with 100+ ms ping

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

    // 4. Speed hack detection (more lenient for high ping users)
    let now_ms = (ctx.timestamp.to_micros_since_unix_epoch() / 1000) as u64;
    let last_update_ms = (current_player.last_update.to_micros_since_unix_epoch() / 1000) as u64;
    let time_diff_ms = now_ms.saturating_sub(last_update_ms);
    
    // More lenient thresholds for high ping users (100+ ms ping)
    if time_diff_ms > 50 && distance_moved > 20.0 { // Increased thresholds for accuracy
        let speed_px_per_sec = (distance_moved * 1000.0) / time_diff_ms as f32;
        if speed_px_per_sec > MAX_MOVEMENT_SPEED {
            log::warn!("Player {:?} speed hack detected: {:.1}px/s (max: {:.1}) over {}ms", 
                      sender_id, speed_px_per_sec, MAX_MOVEMENT_SPEED, time_diff_ms);
            return Err("Movement speed too high".to_string());
        }
    }

    // 5. Check timestamp age (prevent replay attacks) - More lenient
    if now_ms.saturating_sub(client_timestamp_ms) > POSITION_UPDATE_TIMEOUT_MS {
        log::warn!("Player {:?} position update too old: {}ms", sender_id, now_ms.saturating_sub(client_timestamp_ms));
        return Err("Position update too old".to_string());
    }

    // --- Apply collision detection ---
    let (final_x, final_y) = player_collision::resolve_push_out_collision(
        ctx, 
        sender_id, 
        new_x,
        new_y
    );

    // --- Water detection for new position ---
    let is_on_water = is_player_on_water(ctx, final_x, final_y);
    let is_jumping = is_player_jumping(current_player.jump_start_time_ms, now_ms);

    // --- Update player state ---
    current_player.position_x = final_x;
    current_player.position_y = final_y;
    current_player.is_sprinting = is_sprinting; // Allow sprinting in water
    current_player.is_on_water = is_on_water;
    current_player.direction = facing_direction; // Accept client-provided direction
    current_player.last_update = ctx.timestamp;

    players.identity().update(current_player);

    // Only log successful updates occasionally to reduce spam
    if ctx.rng().gen_bool(0.01) { // 1% of successful updates
        log::info!("Player {:?} position updated to ({:.1}, {:.1})", sender_id, final_x, final_y);
    }

    Ok(())
}