use spacetimedb::{Timestamp};

// Import necessary constants
use crate::{PLAYER_RADIUS}; // Removed unused TILE_SIZE_PX

// Import tree constants needed for density calculation
use crate::tree::TREE_DENSITY_PERCENT;

// --- Stone-Specific Constants ---
pub(crate) const STONE_RADIUS: f32 = 40.0;
pub(crate) const PLAYER_STONE_COLLISION_DISTANCE_SQUARED: f32 = (PLAYER_RADIUS + STONE_RADIUS) * (PLAYER_RADIUS + STONE_RADIUS);
pub(crate) const STONE_COLLISION_Y_OFFSET: f32 = 50.0;
pub(crate) const STONE_DENSITY_PERCENT: f32 = crate::tree::TREE_DENSITY_PERCENT / 20.0; // Reduced to half the previous amount
pub(crate) const MIN_STONE_DISTANCE_PX: f32 = 150.0;
pub(crate) const MIN_STONE_DISTANCE_SQ: f32 = MIN_STONE_DISTANCE_PX * MIN_STONE_DISTANCE_PX;
pub(crate) const MIN_STONE_TREE_DISTANCE_PX: f32 = 100.0;
pub(crate) const MIN_STONE_TREE_DISTANCE_SQ: f32 = MIN_STONE_TREE_DISTANCE_PX * MIN_STONE_TREE_DISTANCE_PX;
pub(crate) const STONE_INITIAL_HEALTH: u32 = 1000;

// NEW: Resource depletion system - each stone has a random amount of resources
pub(crate) const STONE_MIN_RESOURCES: u32 = 500; // Minimum stone ore per stone node
pub(crate) const STONE_MAX_RESOURCES: u32 = 1000; // Maximum stone ore per stone node

// NEW Respawn Time Constants for Stones (adjusted for balanced survival gameplay)
pub(crate) const MIN_STONE_RESPAWN_TIME_SECS: u64 = 240; // 4 minutes
pub(crate) const MAX_STONE_RESPAWN_TIME_SECS: u64 = 480; // 8 minutes

// --- Stone Struct and Table ---
#[spacetimedb::table(name = stone, public)]
#[derive(Clone)]
pub struct Stone {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub pos_x: f32,
    pub pos_y: f32,
    pub health: u32, // Stones just disappear when health is 0
    pub resource_remaining: u32, // NEW: How much stone ore is left to collect
    #[index(btree)]
    pub chunk_index: u32, // Added for spatial filtering/queries
    pub last_hit_time: Option<Timestamp>, // Added for shake effect
    pub respawn_at: Option<Timestamp>, // Added for respawn timer
}
