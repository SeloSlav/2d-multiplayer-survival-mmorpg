use spacetimedb::{SpacetimeType, Timestamp};

// Import necessary constants from the main crate or environment
use crate::{PLAYER_RADIUS}; // Removed unused TILE_SIZE_PX

// --- Tree-Specific Constants ---

// Tree Collision settings
pub(crate) const TREE_TRUNK_RADIUS: f32 = 30.0;
pub(crate) const TREE_COLLISION_Y_OFFSET: f32 = 60.0; // Increased from 40.0 to move collision hitbox up
pub(crate) const PLAYER_TREE_COLLISION_DISTANCE_SQUARED: f32 = (PLAYER_RADIUS + TREE_TRUNK_RADIUS) * (PLAYER_RADIUS + TREE_TRUNK_RADIUS);

// Tree Spawning Parameters
pub(crate) const TREE_DENSITY_PERCENT: f32 = 0.01; // 1% of map tiles (halved from 2%)
pub(crate) const TREE_SPAWN_NOISE_FREQUENCY: f64 = 8.0;
pub(crate) const TREE_SPAWN_NOISE_THRESHOLD: f64 = 0.7;
pub(crate) const TREE_SPAWN_WORLD_MARGIN_TILES: u32 = 3;
pub(crate) const MAX_TREE_SEEDING_ATTEMPTS_FACTOR: u32 = 5;
pub(crate) const MIN_TREE_DISTANCE_PX: f32 = 200.0;
pub(crate) const MIN_TREE_DISTANCE_SQ: f32 = MIN_TREE_DISTANCE_PX * MIN_TREE_DISTANCE_PX;
pub(crate) const TREE_INITIAL_HEALTH: u32 = 2000;

// NEW Respawn Time Constants for Trees (adjusted to match Rust survival game)
pub(crate) const MIN_TREE_RESPAWN_TIME_SECS: u64 = 600;  // 10 minutes
pub(crate) const MAX_TREE_RESPAWN_TIME_SECS: u64 = 1200; // 20 minutes

// --- Tree Enums and Structs ---

// Define the different types of trees
#[derive(Clone, Debug, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize, SpacetimeType)]
pub enum TreeType {
    AleppoPine,
    MannaAsh,
    DownyOak,
    StonePine, // New variant for trees that spawn on beach tiles
}

#[spacetimedb::table(name = tree, public)]
#[derive(Clone)]
pub struct Tree {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub pos_x: f32,
    pub pos_y: f32,
    pub health: u32,
    pub tree_type: TreeType,
    #[index(btree)]
    pub chunk_index: u32,
    pub last_hit_time: Option<Timestamp>,
    pub respawn_at: Option<Timestamp>,
}