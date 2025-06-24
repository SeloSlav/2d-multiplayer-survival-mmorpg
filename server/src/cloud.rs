use spacetimedb::{SpacetimeType, Identity, Timestamp, table, reducer, ReducerContext, Table, log, TimeDuration};
use rand::Rng;
use std::time::Duration;
use crate::environment;
use crate::world_state::{world_state as WorldStateTableTrait, WeatherType};

#[derive(SpacetimeType, Clone, PartialEq, Eq, Debug, Copy)]
pub enum CloudShapeType {
    CloudImage1,
    CloudImage2,
    CloudImage3,
    CloudImage4,
    CloudImage5,
}

#[derive(SpacetimeType, Clone, PartialEq, Eq, Debug, Copy)]
pub enum CloudType {
    Wispy,        // Light, fast-changing clouds (low base opacity, quick evolution)
    Cumulus,      // Normal puffy clouds (medium opacity, moderate evolution)
    Stratus,      // Layer clouds (medium-high opacity, slow evolution)
    Nimbus,       // Storm clouds (high opacity, dramatic evolution)
    Cirrus,       // High thin clouds (very low opacity, very slow evolution)
}

#[table(name = cloud, public)]
#[derive(Clone)]
pub struct Cloud {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub pos_x: f32, // Center X position in world coordinates
    pub pos_y: f32, // Center Y position in world coordinates
    #[index(btree)]
    pub chunk_index: u32, // For spatial querying if ever needed, though primarily top-layer
    pub shape: CloudShapeType,
    pub width: f32,           // Base width of the cloud shadow
    pub height: f32,          // Base height of the cloud shadow
    pub rotation_degrees: f32, // Rotation in degrees
    pub base_opacity: f32,    // Base opacity (0.0 to 1.0) - the cloud's natural density
    pub current_opacity: f32, // Current effective opacity (modified by weather/evolution)
    pub blur_strength: f32,   // Blur strength in pixels for the shadow effect
    // --- Added for drifting ---
    pub drift_speed_x: f32,   // Speed and direction on the X axis
    pub drift_speed_y: f32,   // Speed and direction on the Y axis
    // --- Added for dynamic intensity ---
    pub cloud_type: CloudType, // Type determines evolution behavior
    pub evolution_phase: f32,  // 0.0 to 1.0 - current evolution phase
    pub evolution_speed: f32,  // How fast this cloud evolves (per hour)
    pub last_intensity_update: spacetimedb::Timestamp, // Last time intensity was updated
}

// --- Scheduled Reducer for Cloud Movement ---

// TODO: Import CHUNK_SIZE_PX and WORLD_WIDTH_IN_CHUNKS from environment.rs or a constants module.
// For now, let's assume placeholders.
// const PLACEHOLDER_CHUNK_SIZE_PX: f32 = 512.0; // Example, replace with actual
// const PLACEHOLDER_WORLD_WIDTH_IN_CHUNKS: u32 = 64; // Example, replace with actual

// Table to trigger the cloud update reducer
#[table(name = cloud_update_schedule, scheduled(update_cloud_positions))]
pub struct CloudUpdateSchedule {
    #[primary_key]
    #[auto_inc]
    pub schedule_id: u64,
    pub scheduled_at: spacetimedb::ScheduleAt, // Determines how often update_cloud_positions runs
    pub delta_time_seconds: f32, // The time step for this update, in seconds
}

#[reducer]
pub fn update_cloud_positions(ctx: &ReducerContext, schedule_args: CloudUpdateSchedule) -> Result<(), String> {
    // Security check: Ensure this reducer is only called by the scheduler
    if ctx.sender != ctx.identity() {
        return Err("Reducer `update_cloud_positions` can only be invoked by the scheduler.".into());
    }

    // Double the delta time to make clouds move twice as fast
    let dt = schedule_args.delta_time_seconds * 2.0;

    // Calculate world boundaries in pixels
    let world_width_px = environment::WORLD_WIDTH_CHUNKS as f32 * environment::CHUNK_SIZE_PX;
    // Assuming a square world for simplicity - or use the same width for both dimensions
    let world_height_px = world_width_px;
    
    // Buffer zone outside the world for clouds to be considered "off-map"
    // Using cloud width/height estimates as buffer zones
    let buffer_zone = 200.0; // Approximate max cloud dimension

    for cloud_ref in ctx.db.cloud().iter() {
        let mut cloud = cloud_ref.clone();

        // Update position
        cloud.pos_x += cloud.drift_speed_x * dt;
        cloud.pos_y += cloud.drift_speed_y * dt;

        // Apply wrapping logic when clouds drift off-world
        // Horizontal wrapping (X-axis)
        if cloud.pos_x < -buffer_zone {
            // Went off the left edge, wrap to right
            cloud.pos_x = world_width_px + (cloud.pos_x % world_width_px);
            log::info!("Cloud {} wrapped from left to right edge", cloud.id);
        } else if cloud.pos_x > world_width_px + buffer_zone {
            // Went off the right edge, wrap to left
            cloud.pos_x = cloud.pos_x % world_width_px;
            log::info!("Cloud {} wrapped from right to left edge", cloud.id);
        }

        // Vertical wrapping (Y-axis)
        if cloud.pos_y < -buffer_zone {
            // Went off the top edge, wrap to bottom
            cloud.pos_y = world_height_px + (cloud.pos_y % world_height_px);
            log::info!("Cloud {} wrapped from top to bottom edge", cloud.id);
        } else if cloud.pos_y > world_height_px + buffer_zone {
            // Went off the bottom edge, wrap to top
            cloud.pos_y = cloud.pos_y % world_height_px;
            log::info!("Cloud {} wrapped from bottom to top edge", cloud.id);
        }

        // Recalculate chunk_index after position update and potential wrapping
        // Note: This assumes world coordinates start at (0,0) in the top-left.
        let chunk_x = (cloud.pos_x / environment::CHUNK_SIZE_PX).floor() as i32;
        let chunk_y = (cloud.pos_y / environment::CHUNK_SIZE_PX).floor() as i32;
        
        // Handle potential edge cases where chunk coords might go negative after wrapping
        let new_chunk_x = if chunk_x < 0 { 0 } else if chunk_x >= environment::WORLD_WIDTH_CHUNKS as i32 { environment::WORLD_WIDTH_CHUNKS - 1 } else { chunk_x as u32 };
        let new_chunk_y = if chunk_y < 0 { 0 } else if chunk_y >= environment::WORLD_WIDTH_CHUNKS as i32 { environment::WORLD_WIDTH_CHUNKS - 1 } else { chunk_y as u32 };
        
        let new_chunk_index = new_chunk_x + new_chunk_y * environment::WORLD_WIDTH_CHUNKS;

        if cloud.chunk_index != new_chunk_index {
            cloud.chunk_index = new_chunk_index;
        }
        
        // Update the cloud entity in the database
        ctx.db.cloud().id().update(cloud);
    }

    Ok(())
}

// Removed populate_initial_clouds reducer and related constants/helpers
// Seeding will be handled in environment.rs

// Debug reducer to manually trigger cloud intensity updates
#[spacetimedb::reducer]
pub fn debug_update_cloud_intensity(ctx: &ReducerContext) -> Result<(), String> {
    log::info!("Debug: Manually triggering cloud intensity update");
    update_cloud_intensities(ctx, CloudIntensitySchedule {
        schedule_id: 0,
        scheduled_at: ctx.timestamp.into(),
    })?;
    Ok(())
}

// --- Constants for Dynamic Cloud Intensity ---

const CLOUD_INTENSITY_UPDATE_INTERVAL_SECS: u64 = 30; // Update cloud intensity every 30 seconds

// --- Dynamic Cloud Intensity System ---

/// Get weather-based cloud intensity multiplier
fn get_weather_cloud_intensity_multiplier(weather: &WeatherType) -> f32 {
    match weather {
        WeatherType::Clear => 0.6,          // Clear skies = fewer/lighter clouds
        WeatherType::LightRain => 1.2,      // Light rain = more clouds
        WeatherType::ModerateRain => 1.5,   // Moderate rain = heavier clouds
        WeatherType::HeavyRain => 1.8,      // Heavy rain = very heavy clouds
        WeatherType::HeavyStorm => 2.0,     // Storm = maximum cloud density
    }
}

/// Get cloud type characteristics
fn get_cloud_type_characteristics(cloud_type: &CloudType) -> (f32, f32, f32) {
    // Returns: (base_opacity_multiplier, evolution_speed_multiplier, weather_sensitivity)
    match cloud_type {
        CloudType::Wispy => (0.3, 2.0, 1.5),    // Light, fast-changing, very weather-sensitive
        CloudType::Cumulus => (0.7, 1.0, 1.0),  // Normal density, normal evolution, normal sensitivity
        CloudType::Stratus => (0.9, 0.5, 0.7),  // Dense, slow evolution, less weather-sensitive
        CloudType::Nimbus => (1.2, 1.5, 1.8),   // Very dense, fast evolution, very weather-sensitive
        CloudType::Cirrus => (0.2, 0.3, 0.4),   // Very light, very slow evolution, minimal weather sensitivity
    }
}

/// Calculate current cloud opacity based on all factors
fn calculate_cloud_opacity(cloud: &Cloud, weather: &WeatherType, current_time: Timestamp) -> f32 {
    let (base_multiplier, evolution_speed_multiplier, weather_sensitivity) = get_cloud_type_characteristics(&cloud.cloud_type);
    
    // Base opacity from cloud type
    let type_opacity = cloud.base_opacity * base_multiplier;
    
    // Weather effect
    let weather_multiplier = get_weather_cloud_intensity_multiplier(weather);
    let weather_effect = 1.0 + ((weather_multiplier - 1.0) * weather_sensitivity);
    
    // Evolution phase effect (creates natural variation over time)
    // Use sine wave for smooth transitions between light and dense phases
    let evolution_effect = 0.7 + 0.6 * (cloud.evolution_phase * std::f32::consts::PI * 2.0).sin();
    
    // Combine all effects
    let final_opacity = type_opacity * weather_effect * evolution_effect;
    
    // Clamp between 0.0 and 1.0
    final_opacity.max(0.0).min(1.0)
}

// --- Scheduled Reducer for Cloud Intensity Updates ---

// Table to trigger the cloud intensity update reducer
#[table(name = cloud_intensity_schedule, scheduled(update_cloud_intensities))]
pub struct CloudIntensitySchedule {
    #[primary_key]
    #[auto_inc]
    pub schedule_id: u64,
    pub scheduled_at: spacetimedb::ScheduleAt,
}

#[reducer]
pub fn update_cloud_intensities(ctx: &ReducerContext, _schedule_args: CloudIntensitySchedule) -> Result<(), String> {
    // Security check: Ensure this reducer is only called by the scheduler
    if ctx.sender != ctx.identity() {
        return Err("Reducer `update_cloud_intensities` can only be invoked by the scheduler.".into());
    }

    // Get current world state for weather information
    let world_state = ctx.db.world_state().iter().next();
    if world_state.is_none() {
        log::warn!("No world state found for cloud intensity update");
        return Ok(());
    }
    let world_state = world_state.unwrap();
    let current_weather = &world_state.current_weather;
    let current_time = ctx.timestamp;
    
    let mut clouds_updated = 0;
    
    // Process all clouds to update their intensity
    for cloud_ref in ctx.db.cloud().iter() {
        let mut cloud = cloud_ref.clone();
        
        // Calculate time elapsed since last intensity update
        let elapsed_micros = current_time.to_micros_since_unix_epoch()
            .saturating_sub(cloud.last_intensity_update.to_micros_since_unix_epoch());
        let elapsed_hours = (elapsed_micros as f64 / (1_000_000.0 * 3600.0)) as f32;
        
        if elapsed_hours <= 0.0 {
            continue; // No time has passed
        }
        
        // Update evolution phase based on cloud type and elapsed time
        let (_, evolution_speed_multiplier, _) = get_cloud_type_characteristics(&cloud.cloud_type);
        let evolution_increment = cloud.evolution_speed * evolution_speed_multiplier * elapsed_hours;
        cloud.evolution_phase = (cloud.evolution_phase + evolution_increment) % 1.0;
        
        // Calculate new opacity based on current conditions
        let new_opacity = calculate_cloud_opacity(&cloud, current_weather, current_time);
        let old_opacity = cloud.current_opacity;
        cloud.current_opacity = new_opacity;
        cloud.last_intensity_update = current_time;
        
        // Update the cloud in the database
        ctx.db.cloud().id().update(cloud.clone());
        clouds_updated += 1;
        
        // Log significant opacity changes
        if (new_opacity - old_opacity).abs() > 0.1 {
            log::debug!("Cloud {} ({:?}) opacity: {:.2} -> {:.2} (weather: {:?}, phase: {:.2})", 
                       cloud.id, cloud.cloud_type, old_opacity, new_opacity, 
                       current_weather, cloud.evolution_phase);
        }
    }
    
    if clouds_updated > 0 {
        log::info!("Updated intensity for {} clouds (weather: {:?})", clouds_updated, current_weather);
    }
    
    Ok(())
}

/// Initialize the cloud intensity update system
pub fn init_cloud_intensity_system(ctx: &ReducerContext) -> Result<(), String> {
    // Check if intensity schedule already exists
    if ctx.db.cloud_intensity_schedule().iter().next().is_some() {
        log::info!("Cloud intensity system already initialized");
        return Ok(());
    }
    
    // Schedule periodic cloud intensity updates
    let update_interval = TimeDuration::from_micros((CLOUD_INTENSITY_UPDATE_INTERVAL_SECS * 1_000_000) as i64);
    ctx.db.cloud_intensity_schedule().insert(CloudIntensitySchedule {
        schedule_id: 0, // Auto-increment
        scheduled_at: update_interval.into(), // Periodic execution
    });
    
    log::info!("Cloud intensity system initialized with {}-second update interval", 
              CLOUD_INTENSITY_UPDATE_INTERVAL_SECS);
    Ok(())
} 