/*
 * server/src/spatial_grid.rs
 *
 * Purpose: Implements a spatial partitioning system to optimize collision detection
 * by only checking entities that are close to each other.
 *
 * Benefits:
 *   - Reduces collision checks from O(n²) to O(n)
 *   - Significantly improves performance with multiple players/entities
 *   - Scales better as the world gets more populated
 */

use spacetimedb::Identity;
use spacetimedb::Table;
use std::collections::HashMap;

// Importing constants from parent module
use crate::{
    WORLD_WIDTH_PX, WORLD_HEIGHT_PX, 
    PLAYER_RADIUS, WORLD_WIDTH_TILES, WORLD_HEIGHT_TILES
};

// Import table traits for entities with positions
use crate::player as PlayerTableTrait;
use crate::tree::tree as TreeTableTrait;
use crate::stone::stone as StoneTableTrait;
use crate::campfire::campfire as CampfireTableTrait;
use crate::wooden_storage_box::wooden_storage_box as WoodenStorageBoxTableTrait;
use crate::mushroom::mushroom as MushroomTableTrait;
use crate::dropped_item::dropped_item as DroppedItemTableTrait;
use crate::shelter::shelter as ShelterTableTrait; // RE-ENABLE ShelterTableTrait import
use crate::player_corpse::player_corpse as PlayerCorpseTableTrait; // ADDED PlayerCorpse table trait
// Import rain collector table trait
use crate::rain_collector::rain_collector as RainCollectorTableTrait;

// Cell size should be larger than the largest collision radius to ensure
// we only need to check adjacent cells. We use 4x the player radius as a safe default.
pub const GRID_CELL_SIZE: f32 = PLAYER_RADIUS * 4.0;

// Changed from const to functions to avoid using ceil() in constants
pub fn grid_width() -> usize {
    (WORLD_WIDTH_PX / GRID_CELL_SIZE).ceil() as usize
}

pub fn grid_height() -> usize {
    (WORLD_HEIGHT_PX / GRID_CELL_SIZE).ceil() as usize
}

// Entities supported by the spatial grid
// NOTE: Grass is intentionally EXCLUDED from collision detection for performance optimization
// This prevents the server from iterating through potentially thousands of grass entities
#[derive(Debug, Clone, Copy)]
pub enum EntityType {
    Player(Identity),
    Tree(u64),
    Stone(u64),
    Campfire(u32),
    WoodenStorageBox(u32),
    Mushroom(u32),
    DroppedItem(u64),
    Shelter(u32), // RE-ENABLE Shelter from EntityType
    PlayerCorpse(u32), // ADDED PlayerCorpse entity type (assuming u32 ID)
    RainCollector(u32), // ADDED RainCollector entity type (assuming u32 ID)
    // EXCLUDED: Grass - removed for performance to fix rubber-banding issues
}

// Grid cell that stores entities
#[derive(Debug, Default)]
pub struct GridCell {
    pub entities: Vec<EntityType>,
}

// The spatial grid containing all cells
#[derive(Debug)]
pub struct SpatialGrid {
    cells: Vec<GridCell>,
    width: usize,
    height: usize,
}

impl SpatialGrid {
    // Create a new empty spatial grid
    pub fn new() -> Self {
        let width = grid_width();
        let height = grid_height();
        let mut cells = Vec::with_capacity(width * height);
        for _ in 0..(width * height) {
            cells.push(GridCell { entities: Vec::new() });
        }
        SpatialGrid { cells, width, height }
    }

    // Get the cell index for a given world position
    pub fn get_cell_index(&self, x: f32, y: f32) -> Option<usize> {
        if x < 0.0 || y < 0.0 || x >= WORLD_WIDTH_PX || y >= WORLD_HEIGHT_PX {
            return None;
        }
        
        let cell_x = (x / GRID_CELL_SIZE) as usize;
        let cell_y = (y / GRID_CELL_SIZE) as usize;
        
        // Bounds check
        if cell_x >= self.width || cell_y >= self.height {
            return None;
        }
        
        Some(cell_y * self.width + cell_x)
    }
    
    // Clear all cells
    pub fn clear(&mut self) {
        for cell in &mut self.cells {
            cell.entities.clear();
        }
    }
    
    // Add an entity to the appropriate cell
    pub fn add_entity(&mut self, entity_type: EntityType, x: f32, y: f32) {
        if let Some(index) = self.get_cell_index(x, y) {
            self.cells[index].entities.push(entity_type);
        }
    }
    
    // Get all entities in the cell containing the given position
    pub fn get_entities_at(&self, x: f32, y: f32) -> &[EntityType] {
        if let Some(index) = self.get_cell_index(x, y) {
            &self.cells[index].entities
        } else {
            &[]
        }
    }
    
    // Get all entities in the cell and neighboring cells
    pub fn get_entities_in_range(&self, x: f32, y: f32) -> Vec<EntityType> {
        let mut result = Vec::new();
        
        // Calculate the cell coordinates
        let cell_x = (x / GRID_CELL_SIZE) as isize;
        let cell_y = (y / GRID_CELL_SIZE) as isize;
        
        // Check the cell and its neighbors (3x3 grid around the cell)
        for dy in -1..=1 {
            for dx in -1..=1 {
                let nx = cell_x + dx;
                let ny = cell_y + dy;
                
                // Skip if out of bounds
                if nx < 0 || ny < 0 || nx >= self.width as isize || ny >= self.height as isize {
                    continue;
                }
                
                let index = (ny as usize) * self.width + (nx as usize);
                if index < self.cells.len() {
                    result.extend_from_slice(&self.cells[index].entities);
                }
            }
        }
        
        result
    }
    
    // Helper function to populate the grid with all world entities
    pub fn populate_from_world<DB: PlayerTableTrait + TreeTableTrait + StoneTableTrait 
                                  + CampfireTableTrait + WoodenStorageBoxTableTrait 
                                  + MushroomTableTrait + DroppedItemTableTrait
                                  + ShelterTableTrait 
                                  + PlayerCorpseTableTrait
                                  + RainCollectorTableTrait> // ADDED RainCollectorTableTrait to bounds
                                 (&mut self, db: &DB) {
        self.clear();
        
        // Add players
        for player in db.player().iter() {
            if !player.is_dead {
                self.add_entity(EntityType::Player(player.identity), player.position_x, player.position_y);
            }
        }
        
        // Add trees (only those with health > 0)
        for tree in db.tree().iter() {
            if tree.health > 0 {
                self.add_entity(EntityType::Tree(tree.id as u64), tree.pos_x, tree.pos_y);
            }
        }
        
        // Add stones (only those with health > 0)
        for stone in db.stone().iter() {
            if stone.health > 0 {
                self.add_entity(EntityType::Stone(stone.id as u64), stone.pos_x, stone.pos_y);
            }
        }
        
        // Add campfires
        for campfire in db.campfire().iter() {
            self.add_entity(EntityType::Campfire(campfire.id as u32), campfire.pos_x, campfire.pos_y);
        }
        
        // Add wooden storage boxes
        for box_instance in db.wooden_storage_box().iter() {
            self.add_entity(EntityType::WoodenStorageBox(box_instance.id as u32), box_instance.pos_x, box_instance.pos_y);
        }
        
        // Add mushrooms
        for mushroom in db.mushroom().iter() {
            self.add_entity(EntityType::Mushroom(mushroom.id as u32), mushroom.pos_x, mushroom.pos_y);
        }
        
        // Add dropped items
        for item in db.dropped_item().iter() {
            self.add_entity(EntityType::DroppedItem(item.id), item.pos_x, item.pos_y);
        }

        // Add shelters (only non-destroyed) - RE-ENABLING THIS BLOCK
        for shelter in db.shelter().iter() {
            if !shelter.is_destroyed {
                // For shelters, we need to add them to all cells their AABB overlaps
                // since their collision area is larger than a single grid cell
                use crate::shelter::{SHELTER_AABB_HALF_WIDTH, SHELTER_AABB_HALF_HEIGHT, SHELTER_AABB_CENTER_Y_OFFSET_FROM_POS_Y};
                
                let shelter_aabb_center_x = shelter.pos_x;
                let shelter_aabb_center_y = shelter.pos_y - SHELTER_AABB_CENTER_Y_OFFSET_FROM_POS_Y;
                
                // Calculate AABB bounds
                let aabb_left = shelter_aabb_center_x - SHELTER_AABB_HALF_WIDTH;
                let aabb_right = shelter_aabb_center_x + SHELTER_AABB_HALF_WIDTH;
                let aabb_top = shelter_aabb_center_y - SHELTER_AABB_HALF_HEIGHT;
                let aabb_bottom = shelter_aabb_center_y + SHELTER_AABB_HALF_HEIGHT;
                
                // Calculate which grid cells the AABB overlaps
                let start_cell_x = ((aabb_left / GRID_CELL_SIZE).floor() as isize).max(0) as usize;
                let end_cell_x = ((aabb_right / GRID_CELL_SIZE).ceil() as isize).min(self.width as isize - 1) as usize;
                let start_cell_y = ((aabb_top / GRID_CELL_SIZE).floor() as isize).max(0) as usize;
                let end_cell_y = ((aabb_bottom / GRID_CELL_SIZE).ceil() as isize).min(self.height as isize - 1) as usize;
                
                // Add shelter to all overlapping cells
                for cell_y in start_cell_y..=end_cell_y {
                    for cell_x in start_cell_x..=end_cell_x {
                        let index = cell_y * self.width + cell_x;
                        if index < self.cells.len() {
                            self.cells[index].entities.push(EntityType::Shelter(shelter.id));
                        }
                    }
                }
            }
        }
        
        // ADDED: Add player corpses
        for corpse in db.player_corpse().iter() {
            // Assuming PlayerCorpse does not have an `is_destroyed` field, or we always add active ones.
            // If there's a similar flag, add check: if !corpse.is_looted_or_despawned { ... }
            self.add_entity(EntityType::PlayerCorpse(corpse.id), corpse.pos_x, corpse.pos_y);
        }

        // Add rain collectors (only non-destroyed)
        for rain_collector in db.rain_collector().iter() {
            if !rain_collector.is_destroyed {
                self.add_entity(EntityType::RainCollector(rain_collector.id), rain_collector.pos_x, rain_collector.pos_y);
            }
        }
    }
}

// Implement Default
impl Default for SpatialGrid {
    fn default() -> Self {
        Self::new()
    }
} 