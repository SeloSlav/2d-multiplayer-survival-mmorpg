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
 *   - CRITICAL PERFORMANCE FIX: Uses cached grid to avoid 18k+ DB iterations per movement
 */

use spacetimedb::{Identity, Timestamp};
use spacetimedb::Table;
use std::collections::HashMap;
use std::sync::Mutex;

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
use crate::harvestable_resource::harvestable_resource as HarvestableResourceTableTrait;
use crate::dropped_item::dropped_item as DroppedItemTableTrait;
use crate::shelter::shelter as ShelterTableTrait; // RE-ENABLE ShelterTableTrait import
use crate::player_corpse::player_corpse as PlayerCorpseTableTrait; // ADDED PlayerCorpse table trait
// Import rain collector table trait
use crate::rain_collector::rain_collector as RainCollectorTableTrait;
// Import furnace table trait
use crate::furnace::furnace as FurnaceTableTrait;
// Import wild animal table trait
use crate::wild_animal_npc::wild_animal as WildAnimalTableTrait;

// Cell size should be larger than the largest collision radius to ensure
// we only need to check adjacent cells. We use 8x the player radius for better performance with larger worlds.
pub const GRID_CELL_SIZE: f32 = PLAYER_RADIUS * 8.0;

// PERFORMANCE: Cache refresh interval - rebuild grid every 1000ms instead of every collision
// Increased from 300ms to 1000ms to reduce expensive rebuilds in dense forests
const CACHE_REFRESH_INTERVAL_MICROS: i64 = 1_000_000; // 1000ms in microseconds

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
    HarvestableResource(u64), // Changed from Mushroom to HarvestableResource
    DroppedItem(u64),
    Shelter(u32), // RE-ENABLE Shelter from EntityType
    PlayerCorpse(u32), // ADDED PlayerCorpse entity type (assuming u32 ID)
    RainCollector(u32), // ADDED RainCollector entity type (assuming u32 ID)
    Furnace(u32), // ADDED Furnace entity type (assuming u32 ID)
    WildAnimal(u64), // ADDED WildAnimal entity type
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

// PERFORMANCE CRITICAL: Cached spatial grid to avoid rebuilding every collision check
#[derive(Debug)]
struct CachedSpatialGrid {
    grid: SpatialGrid,
    last_refresh: Timestamp,
}

// Global cache - SpacetimeDB is single-threaded per database so this is safe
static mut CACHED_GRID: Option<CachedSpatialGrid> = None;

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

    // DEPRECATED: Use get_cached_spatial_grid() instead for performance
    // Create a new spatial grid and immediately populate it (optimization)
    pub fn new_populated<DB: PlayerTableTrait + TreeTableTrait + StoneTableTrait 
                            + CampfireTableTrait + WoodenStorageBoxTableTrait 
                            + HarvestableResourceTableTrait + DroppedItemTableTrait
                            + ShelterTableTrait 
                            + PlayerCorpseTableTrait
                            + RainCollectorTableTrait
                            + FurnaceTableTrait
                            + WildAnimalTableTrait>
                           (db: &DB, current_time: spacetimedb::Timestamp) -> Self {
        let mut grid = Self::new();
        grid.populate_from_world(db, current_time);
        grid
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
                                  + HarvestableResourceTableTrait + DroppedItemTableTrait
                                  + ShelterTableTrait 
                                  + PlayerCorpseTableTrait
                                  + RainCollectorTableTrait
                                  + FurnaceTableTrait
                                  + WildAnimalTableTrait> // ADDED WildAnimalTableTrait to bounds
                                 (&mut self, db: &DB, current_time: spacetimedb::Timestamp) {
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
        
        // Add harvestable resources (unified system including mushrooms)
        for resource in db.harvestable_resource().iter() {
            if resource.respawn_at.is_none() { // Only add if not respawning
                self.add_entity(EntityType::HarvestableResource(resource.id), resource.pos_x, resource.pos_y);
            }
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
        
        // Add furnaces (only non-destroyed)
        for furnace in db.furnace().iter() {
            if !furnace.is_destroyed {
                self.add_entity(EntityType::Furnace(furnace.id), furnace.pos_x, furnace.pos_y);
            }
        }
        
        // Add wild animals (only those not hiding/burrowed)
        for animal in db.wild_animal().iter() {
            if animal.hide_until.is_none() || animal.hide_until.unwrap() <= current_time {
                self.add_entity(EntityType::WildAnimal(animal.id), animal.pos_x, animal.pos_y);
            }
        }
    }
    
    // PERFORMANCE OPTIMIZED: Faster population method for high-density areas
    pub fn populate_from_world_optimized<DB: PlayerTableTrait + TreeTableTrait + StoneTableTrait 
                                            + CampfireTableTrait + WoodenStorageBoxTableTrait 
                                            + HarvestableResourceTableTrait + DroppedItemTableTrait
                                            + ShelterTableTrait 
                                            + PlayerCorpseTableTrait
                                            + RainCollectorTableTrait
                                            + FurnaceTableTrait
                                            + WildAnimalTableTrait>
                                           (&mut self, db: &DB, current_time: spacetimedb::Timestamp) {
        self.clear();
        
        // PERFORMANCE: Quick entity count check - if too many entities, use emergency mode
        let tree_count = db.tree().iter().count();
        let stone_count = db.stone().iter().count();
        let total_static_entities = tree_count + stone_count;
        
        // Emergency mode for dense forests - limit entity processing
        let emergency_mode = total_static_entities > 500;
        let entity_limit = if emergency_mode { 200 } else { 1000 };
        
        if emergency_mode {
            log::debug!("🚨 [SpatialGrid] Emergency mode: {} total static entities, limiting to {}", 
                       total_static_entities, entity_limit);
        }
        
        // Pre-allocate vectors to reduce reallocations
        let mut entities_to_add: Vec<(EntityType, f32, f32)> = Vec::with_capacity(entity_limit);
        
        // Add players - only living ones
        for player in db.player().iter() {
            if !player.is_dead {
                entities_to_add.push((EntityType::Player(player.identity), player.position_x, player.position_y));
            }
        }
        
        // Add trees - only healthy ones (with emergency limiting)
        let mut tree_count = 0;
        let tree_limit = if emergency_mode { 100 } else { usize::MAX };
        for tree in db.tree().iter() {
            if tree.health > 0 && tree_count < tree_limit {
                entities_to_add.push((EntityType::Tree(tree.id as u64), tree.pos_x, tree.pos_y));
                tree_count += 1;
            }
        }
        
        // Add stones - only healthy ones (with emergency limiting)
        let mut stone_count = 0;
        let stone_limit = if emergency_mode { 50 } else { usize::MAX };
        for stone in db.stone().iter() {
            if stone.health > 0 && stone_count < stone_limit {
                entities_to_add.push((EntityType::Stone(stone.id as u64), stone.pos_x, stone.pos_y));
                stone_count += 1;
            }
        }
        
        // Add campfires - all active ones
        for campfire in db.campfire().iter() {
            entities_to_add.push((EntityType::Campfire(campfire.id as u32), campfire.pos_x, campfire.pos_y));
        }
        
        // Add wooden storage boxes - all active ones
        for box_instance in db.wooden_storage_box().iter() {
            entities_to_add.push((EntityType::WoodenStorageBox(box_instance.id as u32), box_instance.pos_x, box_instance.pos_y));
        }
        
        // Add harvestable resources - only non-respawning ones
        for resource in db.harvestable_resource().iter() {
            if resource.respawn_at.is_none() {
                entities_to_add.push((EntityType::HarvestableResource(resource.id), resource.pos_x, resource.pos_y));
            }
        }
        
        // Add dropped items - all active ones
        for item in db.dropped_item().iter() {
            entities_to_add.push((EntityType::DroppedItem(item.id), item.pos_x, item.pos_y));
        }
        
        // Add player corpses - all active ones
        for corpse in db.player_corpse().iter() {
            entities_to_add.push((EntityType::PlayerCorpse(corpse.id), corpse.pos_x, corpse.pos_y));
        }
        
        // Add rain collectors - only non-destroyed ones
        for rain_collector in db.rain_collector().iter() {
            if !rain_collector.is_destroyed {
                entities_to_add.push((EntityType::RainCollector(rain_collector.id), rain_collector.pos_x, rain_collector.pos_y));
            }
        }
        
        // Add furnaces - only non-destroyed ones
        for furnace in db.furnace().iter() {
            if !furnace.is_destroyed {
                entities_to_add.push((EntityType::Furnace(furnace.id), furnace.pos_x, furnace.pos_y));
            }
        }
        
        // Add wild animals - only visible ones
        for animal in db.wild_animal().iter() {
            if animal.hide_until.is_none() || animal.hide_until.unwrap() <= current_time {
                entities_to_add.push((EntityType::WildAnimal(animal.id), animal.pos_x, animal.pos_y));
            }
        }
        
        // Batch add all simple entities
        for (entity_type, x, y) in entities_to_add {
            self.add_entity(entity_type, x, y);
        }
        
        // Handle shelters separately due to their complex AABB logic
        self.add_shelters_optimized(db);
    }
    
    // Optimized shelter addition with reduced calculations
    fn add_shelters_optimized<DB: ShelterTableTrait>(&mut self, db: &DB) {
        use crate::shelter::{SHELTER_AABB_HALF_WIDTH, SHELTER_AABB_HALF_HEIGHT, SHELTER_AABB_CENTER_Y_OFFSET_FROM_POS_Y};
        
        for shelter in db.shelter().iter() {
            if shelter.is_destroyed {
                continue;
            }
            
            let shelter_aabb_center_x = shelter.pos_x;
            let shelter_aabb_center_y = shelter.pos_y - SHELTER_AABB_CENTER_Y_OFFSET_FROM_POS_Y;
            
            // Calculate AABB bounds
            let aabb_left = shelter_aabb_center_x - SHELTER_AABB_HALF_WIDTH;
            let aabb_right = shelter_aabb_center_x + SHELTER_AABB_HALF_WIDTH;
            let aabb_top = shelter_aabb_center_y - SHELTER_AABB_HALF_HEIGHT;
            let aabb_bottom = shelter_aabb_center_y + SHELTER_AABB_HALF_HEIGHT;
            
            // Calculate which grid cells the AABB overlaps (optimized)
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
}

// PERFORMANCE CRITICAL: Get cached spatial grid, refreshing only when needed
pub fn get_cached_spatial_grid<DB: PlayerTableTrait + TreeTableTrait + StoneTableTrait 
                                 + CampfireTableTrait + WoodenStorageBoxTableTrait 
                                 + HarvestableResourceTableTrait + DroppedItemTableTrait
                                 + ShelterTableTrait 
                                 + PlayerCorpseTableTrait
                                 + RainCollectorTableTrait
                                 + FurnaceTableTrait
                                 + WildAnimalTableTrait>
                              (db: &DB, current_time: spacetimedb::Timestamp) -> &'static SpatialGrid {
    unsafe {
        // Check if we need to refresh the cache
        let needs_refresh = match &CACHED_GRID {
            None => true,
            Some(cached) => {
                let time_diff_micros = current_time.to_micros_since_unix_epoch() - cached.last_refresh.to_micros_since_unix_epoch();
                time_diff_micros >= CACHE_REFRESH_INTERVAL_MICROS
            }
        };

        if needs_refresh {
            let last_refresh_ms = match &CACHED_GRID {
                None => 0,
                Some(cached) => (current_time.to_micros_since_unix_epoch() - cached.last_refresh.to_micros_since_unix_epoch()) / 1000
            };
            
            log::debug!("🚀 [SpatialGrid] Refreshing cached spatial grid (last refresh: {}ms ago)", last_refresh_ms);
            
            // Create new grid and populate it with optimized logic
            let mut new_grid = SpatialGrid::new();
            new_grid.populate_from_world_optimized(db, current_time);
            
            // Update the cache
            CACHED_GRID = Some(CachedSpatialGrid {
                grid: new_grid,
                last_refresh: current_time,
            });
        }

        // Return reference to cached grid
        &CACHED_GRID.as_ref().unwrap().grid
    }
}

// PERFORMANCE: Invalidate cache when major world changes occur (optional optimization)
pub fn invalidate_spatial_grid_cache() {
    unsafe {
        CACHED_GRID = None;
    }
    log::debug!("🚀 [SpatialGrid] Cache invalidated");
}

// Implement Default
impl Default for SpatialGrid {
    fn default() -> Self {
        Self::new()
    }
} 