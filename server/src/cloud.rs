use spacetimedb::{SpacetimeType, Identity, Timestamp, table, reducer, ReducerContext, Table, log};
use rand::Rng;
use crate::environment;

#[derive(SpacetimeType, Clone, PartialEq, Eq, Debug, Copy)]
pub enum CloudShapeType {
    CloudImage1,
    CloudImage2,
    CloudImage3,
    CloudImage4,
    CloudImage5,
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
    pub base_opacity: f32,    // Base opacity (0.0 to 1.0)
    pub blur_strength: f32,   // Blur strength in pixels for the shadow effect
    // --- Added for drifting ---
    pub drift_speed_x: f32,   // Speed and direction on the X axis
    pub drift_speed_y: f32,   // Speed and direction on the Y axis
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