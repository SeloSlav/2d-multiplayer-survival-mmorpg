/******************************************************************************
 *                                                                            *
 * Water Patch System - Allows players to water crops by left-clicking       *
 * with water containers. Creates temporary water patches that boost plant    *
 * growth in a radius around them. Encourages strategic placement.            *
 *                                                                            *
 ******************************************************************************/

use spacetimedb::{table, reducer, ReducerContext, Identity, Timestamp, Table, log, TimeDuration};
use spacetimedb::spacetimedb_lib::ScheduleAt;
use std::time::Duration;

// Table trait imports
use crate::player as PlayerTableTrait;
use crate::items::{inventory_item as InventoryItemTableTrait, item_definition as ItemDefinitionTableTrait};
use crate::planted_seeds::planted_seed as PlantedSeedTableTrait;
use crate::environment::calculate_chunk_index;

// --- Constants ---

pub const WATER_PATCH_RADIUS: f32 = 25.0; // Visual radius of water patch
pub const WATER_PATCH_COLLISION_RADIUS: f32 = 15.0; // Collision detection radius
pub const WATER_PATCH_GROWTH_EFFECT_RADIUS: f32 = 60.0; // Growth bonus radius (larger than visual)
pub const WATER_PATCH_DURATION_SECS: u64 = 300; // 5 minutes base duration
pub const WATERING_DISTANCE: f32 = 40.0; // Distance in front of player where water lands
pub const WATER_CONSUMPTION_PER_USE: f32 = 0.25; // 250mL per watering action
pub const GROWTH_BONUS_MULTIPLIER: f32 = 2.0; // 2x growth rate when watered
pub const WATER_PATCH_CLEANUP_INTERVAL_SECS: u64 = 30; // Check for expired patches every 30 seconds

// --- Water Patch Table ---

#[spacetimedb::table(name = water_patch, public)]
#[derive(Clone, Debug)]
pub struct WaterPatch {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub pos_x: f32,
    pub pos_y: f32,
    pub chunk_index: u32,
    pub created_at: Timestamp,
    pub expires_at: Timestamp,
    pub created_by: Identity,
    pub water_amount: f32, // How much water was used to create this patch (affects duration)
    pub current_opacity: f32, // Visual opacity (1.0 = fully visible, 0.0 = invisible)
}

// --- Cleanup Schedule Table ---

#[spacetimedb::table(name = water_patch_cleanup_schedule, scheduled(cleanup_expired_water_patches))]
#[derive(Clone)]
pub struct WaterPatchCleanupSchedule {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub scheduled_at: ScheduleAt,
}

// --- Initialization ---

/// Initialize the water patch cleanup system (called from main init)
pub fn init_water_patch_system(ctx: &ReducerContext) -> Result<(), String> {
    // Only start if no existing schedule
    if ctx.db.water_patch_cleanup_schedule().count() == 0 {
        let cleanup_interval = TimeDuration::from(Duration::from_secs(WATER_PATCH_CLEANUP_INTERVAL_SECS));
        
        ctx.db.water_patch_cleanup_schedule().insert(WaterPatchCleanupSchedule {
            id: 0, // Auto-inc
            scheduled_at: cleanup_interval.into(), // Periodic scheduling
        });
        
        log::info!("Water patch cleanup system initialized - checking every {} seconds", WATER_PATCH_CLEANUP_INTERVAL_SECS);
    }
    
    Ok(())
}

// --- Helper Functions ---

/// Check if a water container has enough water for watering
pub fn can_water_with_container(container_item: &crate::items::InventoryItem, container_def: &crate::items::ItemDefinition) -> bool {
    // Check if it's a valid water container type
    if container_def.name != "Reed Water Bottle" && container_def.name != "Plastic Water Jug" {
        return false;
    }
    
    // Check if it has enough water content
    let current_water = crate::items::get_water_content(container_item).unwrap_or(0.0);
    current_water >= WATER_CONSUMPTION_PER_USE
}

/// Calculate the position where water should be placed based on player position and facing direction
fn calculate_watering_position(player_x: f32, player_y: f32, facing_direction: f32) -> (f32, f32) {
    let water_x = player_x + facing_direction.cos() * WATERING_DISTANCE;
    let water_y = player_y + facing_direction.sin() * WATERING_DISTANCE;
    (water_x, water_y)
}

/// Check if there's already a water patch at the target location (prevent stacking)
fn has_water_patch_at_location(ctx: &ReducerContext, x: f32, y: f32) -> bool {
    for patch in ctx.db.water_patch().iter() {
        let dx = patch.pos_x - x;
        let dy = patch.pos_y - y;
        let distance_sq = dx * dx + dy * dy;
        
        // If there's already a patch within collision radius, consider it occupied
        if distance_sq <= (WATER_PATCH_COLLISION_RADIUS * WATER_PATCH_COLLISION_RADIUS) {
            return true;
        }
    }
    false
}

/// Get the growth bonus multiplier for a planted seed based on nearby water patches
pub fn get_water_patch_growth_multiplier(ctx: &ReducerContext, plant_x: f32, plant_y: f32) -> f32 {
    let mut max_bonus: f32 = 1.0; // Base multiplier (no bonus)
    
    for patch in ctx.db.water_patch().iter() {
        let dx = patch.pos_x - plant_x;
        let dy = patch.pos_y - plant_y;
        let distance_sq = dx * dx + dy * dy;
        let effect_radius_sq = WATER_PATCH_GROWTH_EFFECT_RADIUS * WATER_PATCH_GROWTH_EFFECT_RADIUS;
        
        if distance_sq <= effect_radius_sq {
            // Calculate bonus based on distance (closer = stronger effect)
            let distance = distance_sq.sqrt();
            let distance_factor = (WATER_PATCH_GROWTH_EFFECT_RADIUS - distance) / WATER_PATCH_GROWTH_EFFECT_RADIUS;
            let distance_factor = distance_factor.max(0.0).min(1.0);
            
            // Calculate bonus based on patch opacity (fresher patches = stronger effect)
            let opacity_factor = patch.current_opacity;
            
            // Combine factors for this patch's bonus
            let patch_bonus = 1.0 + (GROWTH_BONUS_MULTIPLIER - 1.0) * distance_factor * opacity_factor;
            
            // Use the strongest bonus found (non-stacking)
            max_bonus = max_bonus.max(patch_bonus);
        }
    }
    
    max_bonus
}

// --- Reducers ---

/// Water crops with a water container (triggered by left-click with water container)
#[spacetimedb::reducer]
pub fn water_crops(ctx: &ReducerContext, container_instance_id: u64) -> Result<(), String> {
    let player_id = ctx.sender;
    
    log::info!("Player {} attempting to water crops with container {}", player_id, container_instance_id);
    
    // Find the player
    let player = ctx.db.player().identity().find(&player_id)
        .ok_or_else(|| "Player not found".to_string())?;
    
    // Find the water container
    let mut container_item = ctx.db.inventory_item().instance_id().find(&container_instance_id)
        .ok_or_else(|| "Water container not found".to_string())?;
    
    // Verify ownership
    let owns_container = match &container_item.location {
        crate::models::ItemLocation::Inventory(data) => data.owner_id == player_id,
        crate::models::ItemLocation::Hotbar(data) => data.owner_id == player_id,
        crate::models::ItemLocation::Equipped(data) => data.owner_id == player_id,
        _ => false,
    };
    
    if !owns_container {
        return Err("You don't own this water container".to_string());
    }
    
    // Get container definition
    let container_def = ctx.db.item_definition().id().find(&container_item.item_def_id)
        .ok_or_else(|| "Container definition not found".to_string())?;
    
    // Check if container can be used for watering
    if !can_water_with_container(&container_item, &container_def) {
        return Err("This container cannot be used for watering or doesn't have enough water".to_string());
    }
    
    // Calculate where the water should be placed
    // Convert direction string to angle (game coordinate system: positive Y goes down)
    // Client sends: "up", "down", "left", "right", "up_left", "up_right", "down_left", "down_right"
    let facing_angle = match player.direction.as_str() {
        "up" => -std::f32::consts::PI / 2.0,     // Up (-Y direction)
        "down" => std::f32::consts::PI / 2.0,    // Down (+Y direction)  
        "right" => 0.0,                          // Right (+X direction)
        "left" => std::f32::consts::PI,          // Left (-X direction)
        "up_right" => -std::f32::consts::PI / 4.0, // Up-Right
        "up_left" => -3.0 * std::f32::consts::PI / 4.0, // Up-Left
        "down_right" => std::f32::consts::PI / 4.0,  // Down-Right
        "down_left" => 3.0 * std::f32::consts::PI / 4.0, // Down-Left
        // Legacy support for old direction names
        "north" => -std::f32::consts::PI / 2.0,
        "south" => std::f32::consts::PI / 2.0,
        "east" => 0.0,
        "west" => std::f32::consts::PI,
        "northeast" => -std::f32::consts::PI / 4.0,
        "northwest" => -3.0 * std::f32::consts::PI / 4.0,
        "southeast" => std::f32::consts::PI / 4.0,
        "southwest" => 3.0 * std::f32::consts::PI / 4.0,
        _ => 0.0, // Default to right if unknown direction
    };
    let (water_x, water_y) = calculate_watering_position(player.position_x, player.position_y, facing_angle);
    
    // Check if there's already a water patch at this location
    if has_water_patch_at_location(ctx, water_x, water_y) {
        return Err("There's already water at that location".to_string());
    }
    
    // Consume water from container
    let current_water = crate::items::get_water_content(&container_item).unwrap_or(0.0);
    let new_water_content = current_water - WATER_CONSUMPTION_PER_USE;
    
    if new_water_content <= 0.0 {
        // Container is now empty, remove water content
        crate::items::set_water_content(&mut container_item, 0.0)?;
    } else {
        // Update water content
        crate::items::set_water_content(&mut container_item, new_water_content)?;
    }
    
    ctx.db.inventory_item().instance_id().update(container_item);
    
    // Create water patch
    let chunk_index = calculate_chunk_index(water_x, water_y);
    let duration = TimeDuration::from(Duration::from_secs(WATER_PATCH_DURATION_SECS));
    let expires_at = ctx.timestamp + duration;
    
    let water_patch = WaterPatch {
        id: 0, // Auto-inc
        pos_x: water_x,
        pos_y: water_y,
        chunk_index,
        created_at: ctx.timestamp,
        expires_at,
        created_by: player_id,
        water_amount: WATER_CONSUMPTION_PER_USE,
        current_opacity: 1.0, // Start fully visible
    };
    
    ctx.db.water_patch().insert(water_patch);
    
    log::info!("Player {} created water patch at ({:.1}, {:.1}) using {:.1}L of water", 
               player_id, water_x, water_y, WATER_CONSUMPTION_PER_USE);
    
    // Emit watering sound effect
    crate::sound_events::emit_watering_sound(ctx, water_x, water_y, player_id);
    
    Ok(())
}

/// Scheduled cleanup of expired water patches
#[spacetimedb::reducer]
pub fn cleanup_expired_water_patches(ctx: &ReducerContext, _args: WaterPatchCleanupSchedule) -> Result<(), String> {
    // Security check - only allow scheduler to call this
    if ctx.sender != ctx.identity() {
        return Err("This reducer can only be called by the scheduler".to_string());
    }
    
    let current_time = ctx.timestamp;
    let mut patches_updated = 0;
    let mut patches_removed = 0;
    
    // Get all water patches
    let all_patches: Vec<WaterPatch> = ctx.db.water_patch().iter().collect();
    
    for mut patch in all_patches {
        let time_remaining_micros = patch.expires_at.to_micros_since_unix_epoch()
            .saturating_sub(current_time.to_micros_since_unix_epoch());
        
        if time_remaining_micros <= 0 {
            // Patch has expired, remove it
            ctx.db.water_patch().id().delete(patch.id);
            patches_removed += 1;
            log::debug!("Removed expired water patch {} at ({:.1}, {:.1})", patch.id, patch.pos_x, patch.pos_y);
        } else {
            // Update opacity based on remaining time
            let total_duration_micros = patch.expires_at.to_micros_since_unix_epoch()
                - patch.created_at.to_micros_since_unix_epoch();
            let opacity = if total_duration_micros > 0 {
                (time_remaining_micros as f32 / total_duration_micros as f32).min(1.0).max(0.0)
            } else {
                0.0
            };
            
            // Only update if opacity changed significantly
            if (patch.current_opacity - opacity).abs() > 0.05 {
                patch.current_opacity = opacity;
                ctx.db.water_patch().id().update(patch);
                patches_updated += 1;
            }
        }
    }
    
    if patches_removed > 0 || patches_updated > 0 {
        log::info!("Water patch cleanup: {} patches removed, {} patches updated", patches_removed, patches_updated);
    }
    
    Ok(())
} 