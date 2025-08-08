use spacetimedb::{table, SpacetimeType, Identity, ReducerContext};

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum SeaStackVariant {
    Tall,
    Medium, 
    Wide,
}

#[table(name = sea_stack, public)]
#[derive(Clone, Debug)]
pub struct SeaStack {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    
    pub pos_x: f32,
    pub pos_y: f32,
    
    // Chunk-based spatial indexing for efficient queries
    pub chunk_index: u32,
    
    // Visual properties
    pub scale: f32,           // 0.8 to 1.4
    pub rotation: f32,        // 0 to 2π radians
    pub opacity: f32,         // 0.8 to 1.0
    pub variant: SeaStackVariant, // Which image to use
}

impl SeaStack {
    pub fn new(
        pos_x: f32,
        pos_y: f32,
        chunk_index: u32,
        scale: f32,
        rotation: f32,
        opacity: f32,
        variant: SeaStackVariant,
    ) -> Self {
        Self {
            id: 0, // Auto-incremented
            pos_x,
            pos_y,
            chunk_index,
            scale,
            rotation,
            opacity,
            variant,
        }
    }
}

// Helper function to determine chunk index from world position
pub fn get_chunk_index_for_position(pos_x: f32, pos_y: f32) -> u32 {
    use crate::environment::{CHUNK_SIZE_PX, WORLD_WIDTH_CHUNKS};
    
    let chunk_x = (pos_x / CHUNK_SIZE_PX).floor() as u32;
    let chunk_y = (pos_y / CHUNK_SIZE_PX).floor() as u32;
    
    // Clamp to world bounds
    let chunk_x = chunk_x.min(WORLD_WIDTH_CHUNKS - 1);
    let chunk_y = chunk_y.min(crate::environment::WORLD_HEIGHT_CHUNKS - 1); // Fixed: use height for Y coordinate
    
    chunk_y * WORLD_WIDTH_CHUNKS + chunk_x
} 