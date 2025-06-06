use spacetimedb::{SpacetimeType, Timestamp, Table};

// --- Grass-Specific Constants ---

// Grass Spawning Parameters
pub(crate) const GRASS_DENSITY_PERCENT: f32 = 0.18; // Reduced from 0.25 to 0.18 for better performance (still 1.8x more than original 0.10)
pub(crate) const GRASS_SPAWN_NOISE_FREQUENCY: f64 = 10.0; // Higher frequency for smaller patches
pub(crate) const GRASS_SPAWN_NOISE_THRESHOLD: f64 = 0.65; // Noise threshold for spawning
pub(crate) const GRASS_SPAWN_WORLD_MARGIN_TILES: u32 = 2; // Margin from world edges
pub(crate) const MAX_GRASS_SEEDING_ATTEMPTS_FACTOR: u32 = 4; // Reduced from 5 to 4 for faster seeding
pub(crate) const MIN_GRASS_DISTANCE_PX: f32 = 3.0; // Reduced from 10.0 to 3.0 for much denser patches
pub(crate) const MIN_GRASS_DISTANCE_SQ: f32 = MIN_GRASS_DISTANCE_PX * MIN_GRASS_DISTANCE_PX;
// Distances from other objects
pub(crate) const MIN_GRASS_TREE_DISTANCE_PX: f32 = 50.0; 
pub(crate) const MIN_GRASS_TREE_DISTANCE_SQ: f32 = MIN_GRASS_TREE_DISTANCE_PX * MIN_GRASS_TREE_DISTANCE_PX;
pub(crate) const MIN_GRASS_STONE_DISTANCE_PX: f32 = 40.0;
pub(crate) const MIN_GRASS_STONE_DISTANCE_SQ: f32 = MIN_GRASS_STONE_DISTANCE_PX * MIN_GRASS_STONE_DISTANCE_PX;


pub(crate) const GRASS_INITIAL_HEALTH: u32 = 1; // Changed to 1 for one-hit destruction
pub(crate) const MIN_GRASS_RESPAWN_TIME_SECS: u64 = 60; // 1 minute
pub(crate) const MAX_GRASS_RESPAWN_TIME_SECS: u64 = 180; // 3 minutes

// NEW: Grass disturbance constants
pub(crate) const GRASS_DISTURBANCE_RADIUS: f32 = 48.0; // Doubled from 24.0 - Radius around player to check for grass disturbance
pub(crate) const GRASS_DISTURBANCE_RADIUS_SQ: f32 = GRASS_DISTURBANCE_RADIUS * GRASS_DISTURBANCE_RADIUS;
pub(crate) const GRASS_DISTURBANCE_DURATION_SECS: f32 = 1.5; // How long the disturbance effect lasts
pub(crate) const GRASS_DISTURBANCE_STRENGTH: f32 = 2.0; // Multiplier for disturbance sway intensity

// --- Grass Enums and Structs ---

// Define different types/visuals of grass if needed later
#[derive(Clone, Debug, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize, SpacetimeType)]
pub enum GrassAppearanceType {
    // Land foliage
    PatchA, // Default patch
    PatchB, // Another variant
    PatchC, // Yet another variant
    TallGrassA,
    TallGrassB,
    BushRounded,
    BushSpiky,
    BushFlowering,
    BramblesA,
    BramblesB,
    
    // Water foliage
    ReedBedsA,       // Tall swaying reeds
    ReedBedsB,       // Dense reed clusters  
    Bulrushes,       // Classic cattails
    LilyPads,        // Floating surface plants (no sway)
    SeaweedForest,   // Underwater kelp-like plants
    AlgaeMats,       // Surface algae patches (no sway)
}

// --- NEW: Helper function to check if grass type is a bramble (indestructible) ---
impl GrassAppearanceType {
    /// Returns true if this grass type is a bramble and should be indestructible
    pub fn is_bramble(&self) -> bool {
        matches!(self, GrassAppearanceType::BramblesA | GrassAppearanceType::BramblesB)
    }
    
    /// Returns true if this grass type is water foliage that should spawn on water tiles
    pub fn is_water_foliage(&self) -> bool {
        matches!(self, 
            GrassAppearanceType::ReedBedsA | 
            GrassAppearanceType::ReedBedsB | 
            GrassAppearanceType::Bulrushes | 
            GrassAppearanceType::LilyPads | 
            GrassAppearanceType::SeaweedForest | 
            GrassAppearanceType::AlgaeMats
        )
    }
}

// Helper function for backwards compatibility and external use
pub fn is_grass_type_bramble(appearance_type: &GrassAppearanceType) -> bool {
    appearance_type.is_bramble()
}

#[spacetimedb::table(name = grass, public)]
#[derive(Clone, Debug)]
pub struct Grass {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub pos_x: f32,
    pub pos_y: f32,
    pub health: u32,
    pub appearance_type: GrassAppearanceType, // For different sprites/sway
    #[index(btree)]
    pub chunk_index: u32,
    pub last_hit_time: Option<Timestamp>, // When it was last "chopped"
    pub respawn_at: Option<Timestamp>,    // When it should reappear after being chopped
    // For client-side sway animation, to give each patch a unique offset
    pub sway_offset_seed: u32, 
    pub sway_speed: f32, // RENAMED: Was sway_speed_multiplier. This is now the actual speed.
    // NEW: Player disturbance tracking
    pub disturbed_at: Option<Timestamp>, // When grass was last disturbed by player movement
    pub disturbance_direction_x: f32,    // X component of disturbance direction (opposite to player movement)
    pub disturbance_direction_y: f32,    // Y component of disturbance direction (opposite to player movement)
} 

// --- NEW: Grass Respawn Scheduling --- 

/// Data needed to recreate a grass entity.
/// We don't store the original ID because the new grass will get a new auto_inc ID.
#[derive(Clone, Debug, SpacetimeType)]
pub struct GrassRespawnData {
    pub pos_x: f32,
    pub pos_y: f32,
    pub appearance_type: GrassAppearanceType,
    pub chunk_index: u32,
    pub sway_offset_seed: u32,
    pub sway_speed: f32, // RENAMED: Was sway_speed_multiplier. This is now the actual speed.
    // NOTE: We don't include disturbance data in respawn - grass respawns in undisturbed state
}

#[spacetimedb::table(name = grass_respawn_schedule, scheduled(process_grass_respawn))]
#[derive(Clone, Debug)]
pub struct GrassRespawnSchedule {
    #[primary_key]
    #[auto_inc]
    pub schedule_id: u64, // Unique ID for this respawn event
    pub respawn_data: GrassRespawnData, // The data needed to recreate the grass
    pub scheduled_at: spacetimedb::ScheduleAt, // When this respawn should occur
}

#[spacetimedb::reducer]
pub fn process_grass_respawn(ctx: &spacetimedb::ReducerContext, schedule_entry: GrassRespawnSchedule) -> Result<(), String> {
    // Security check: Only the module itself should trigger this via scheduling
    if ctx.sender != ctx.identity() {
        return Err("process_grass_respawn can only be called by the scheduler.".to_string());
    }

    let data = schedule_entry.respawn_data;
    
    // Re-insert the grass entity into the main Grass table
    // The new grass entity will get a new `id` due to `#[auto_inc]` on Grass.id
    match ctx.db.grass().try_insert(crate::grass::Grass {
        id: 0, // Will be auto-incremented
        pos_x: data.pos_x,
        pos_y: data.pos_y,
        health: GRASS_INITIAL_HEALTH, // Respawn with full health
        appearance_type: data.appearance_type,
        chunk_index: data.chunk_index,
        last_hit_time: None,
        respawn_at: None, // Not needed for newly spawned grass
        sway_offset_seed: data.sway_offset_seed,
        sway_speed: data.sway_speed, // UPDATED: Use the direct sway_speed from respawn data
        disturbed_at: None,
        disturbance_direction_x: 0.0,
        disturbance_direction_y: 0.0,
    }) {
        Ok(new_grass) => {
            log::info!("Respawned grass entity at ({}, {}) with new ID {}", new_grass.pos_x, new_grass.pos_y, new_grass.id);
        }
        Err(e) => {
            log::error!("Failed to respawn grass at ({}, {}): {}", data.pos_x, data.pos_y, e);
            // Optionally, reschedule if it failed due to a transient issue, 
            // but for now, just log the error.
        }
    }
    Ok(())
} 