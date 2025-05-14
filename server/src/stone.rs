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
    #[index(btree)]
    pub chunk_index: u32, // Added for spatial filtering/queries
    pub last_hit_time: Option<Timestamp>, // Added for shake effect
    pub respawn_at: Option<Timestamp>, // Added for respawn timer
}
