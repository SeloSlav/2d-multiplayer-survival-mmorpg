/*
 * server/src/monument.rs
 *
 * Purpose: Manages monument entities - generation, placement, and clearance zones.
 *          Monuments are special world structures (shipwrecks, ruins, etc.)
 *          that take precedence over natural obstacles like trees and stones.
 *
 * Responsibilities:
 *   - Generate monument positions during world creation
 *   - Provide clearance checking to prevent obstacles from spawning near monuments
 *   - Support multiple monument types (shipwrecks, ruins, crash sites, etc.)
 *   - Define clearance radii for different monument types
 *   - Allow easy extension for new monument types
 */

use spacetimedb::{ReducerContext, Table, Timestamp};
use crate::monument_part as MonumentPartTableTrait;
use crate::MonumentType;
use crate::items::item_definition as ItemDefinitionTableTrait;
use crate::harvestable_resource::harvestable_resource as HarvestableResourceTableTrait;
use crate::barrel::barrel as BarrelTableTrait;
use crate::player as PlayerTableTrait;
use noise::{NoiseFn, Perlin};
use std::collections::HashSet;
use rand::Rng;
use log;

/// Clearance radius for different monument types (in pixels)
/// Monuments will clear obstacles within this radius for visibility
pub mod clearance {
    /// Shipwreck parts - clear a 12-tile radius (600px)
    pub const SHIPWRECK: f32 = 600.0;
    
    /// Fishing village parts - clear a 12-tile radius (600px)
    pub const FISHING_VILLAGE: f32 = 600.0;
    
    /// Whale bone graveyard parts - clear an 11-tile radius (550px)
    pub const WHALE_BONE_GRAVEYARD: f32 = 600.0;
    
    /// Hunting village parts - clear a 16-tile radius (800px)
    /// Clearance is measured from lodge center. Village spans ~660px from center
    /// (huts at ±580px X and -320px Y), so 800px gives a comfortable buffer.
    pub const HUNTING_VILLAGE: f32 = 800.0;
    
    /// Crashed research drone - clear a 12-tile radius (600px)
    /// Smaller monument, single piece with surrounding loot
    pub const CRASHED_RESEARCH_DRONE: f32 = 600.0;
    
    /// Weather station - clear 2000px radius (4 radars, central compound, dirt roads)
    /// Four radar dishes equidistant around center, central dirt area, overrun with grass
    pub const WEATHER_STATION: f32 = 2000.0;
    
    /// Wolf den - clear a 8-tile radius (384px)
    /// Single wolf mound structure that spawns a pack of wolves
    pub const WOLF_DEN: f32 = 384.0;
    
    /// Alpine village - clear a 16-tile radius (800px)
    /// Single earth-sheltered lodge in alpine biome, like other village monuments
    pub const ALPINE_VILLAGE: f32 = 800.0;
}

/// Minimum distance between monument spawns (barrels, harvestables, placeables)
/// Prevents overlapping entities at monuments
pub const MONUMENT_SPAWN_MIN_DISTANCE: f32 = 50.0;
pub const MONUMENT_SPAWN_MIN_DISTANCE_SQ: f32 = MONUMENT_SPAWN_MIN_DISTANCE * MONUMENT_SPAWN_MIN_DISTANCE;
const VILLAGE_QUARRY_CLEARANCE_TILES: i32 = 24;

// Village campfire artwork is bottom-anchored; its collision and 3D fire pit
// are 128 pixels north of the stored part position. Keep the alpine pit well
// south of the lodge entrance, with room for a player to pass around it.
const ALPINE_FIRE_LEGACY_OFFSET_Y: f32 = 150.0;
const ALPINE_FIRE_OFFSET_Y: f32 = 400.0;
const VILLAGE_FIRE_ANCHOR_Y: f32 = -crate::shared_config::VILLAGE_CAMPFIRE_OFFSET_Y;

/// Repair the original alpine layout once, without regenerating the world.
/// Only the exact old lodge/fire relationship is eligible, so intentionally
/// moved fires and unrelated monuments are left alone.
pub fn repair_alpine_fire_entrance(ctx: &ReducerContext) {
    let parts: Vec<_> = ctx.db.monument_part().iter()
        .filter(|part| part.monument_type == MonumentType::AlpineVillage)
        .collect();
    for mut fire in parts.iter().filter(|part| part.part_type == "campfire").cloned() {
        let Some(lodge) = parts.iter().find(|part| part.part_type == "lodge" && part.is_center
            && (fire.world_x - part.world_x).abs() < 0.5
            && (fire.world_y - part.world_y - ALPINE_FIRE_LEGACY_OFFSET_Y).abs() < 0.5)
        else { continue };
        // Existing worlds may have spawned barrels or players in the new
        // courtyard. Prefer the standard location, then nearby clear spots.
        let candidates = [(0.0, ALPINE_FIRE_OFFSET_Y), (100.0, ALPINE_FIRE_OFFSET_Y),
            (0.0, 450.0), (100.0, 450.0), (0.0, 500.0), (100.0, 500.0)];
        let Some((dx, dy)) = candidates.into_iter().find(|(dx, dy)| {
            let x = lodge.world_x + dx;
            let y = lodge.world_y + dy - VILLAGE_FIRE_ANCHOR_Y;
            !ctx.db.barrel().iter().any(|barrel| barrel.health > 0.0
                && (barrel.pos_x - x).powi(2) + (barrel.pos_y - y).powi(2) < 160.0_f32.powi(2))
                && !ctx.db.player().iter().any(|player| !player.is_dead
                    && (player.position_x - x).powi(2) + (player.position_y - y).powi(2) < 120.0_f32.powi(2))
        }) else {
            log::warn!("[AlpineVillage] No clear courtyard spot for the communal fire; will retry on the next connection");
            continue;
        };
        fire.world_x = lodge.world_x + dx;
        fire.world_y = lodge.world_y + dy;
        ctx.db.monument_part().id().update(fire);
        log::info!("[AlpineVillage] Moved the original communal fire clear of the lodge entrance");
    }
}

/// Represents an occupied position at a monument
#[derive(Clone, Debug)]
pub struct OccupiedPosition {
    pub x: f32,
    pub y: f32,
    pub radius: f32, // Collision radius for this entity
}

/// Check if a position conflicts with any occupied positions
pub fn is_position_occupied(x: f32, y: f32, radius: f32, occupied: &[OccupiedPosition]) -> bool {
    for pos in occupied {
        let dx = x - pos.x;
        let dy = y - pos.y;
        let dist_sq = dx * dx + dy * dy;
        let min_dist = radius + pos.radius;
        if dist_sq < min_dist * min_dist {
            return true;
        }
    }
    false
}

fn is_tile_near_quarry_dirt(
    quarry_dirt: &[Vec<bool>],
    tile_x: usize,
    tile_y: usize,
    radius_tiles: i32,
) -> bool {
    if quarry_dirt.is_empty() || quarry_dirt[0].is_empty() {
        return false;
    }

    let height = quarry_dirt.len() as i32;
    let width = quarry_dirt[0].len() as i32;
    let center_x = tile_x as i32;
    let center_y = tile_y as i32;
    let radius_sq = radius_tiles * radius_tiles;

    for dy in -radius_tiles..=radius_tiles {
        for dx in -radius_tiles..=radius_tiles {
            if dx * dx + dy * dy > radius_sq {
                continue;
            }

            let check_x = center_x + dx;
            let check_y = center_y + dy;
            if check_x < 0 || check_y < 0 || check_x >= width || check_y >= height {
                continue;
            }

            if quarry_dirt[check_y as usize][check_x as usize] {
                return true;
            }
        }
    }

    false
}

/// Checks if the given world position is too close to any monument
/// Monuments take precedence and clear a radius around them for visibility
/// Returns true if the position is within the clearance radius of any monument
pub fn is_position_near_monument(ctx: &ReducerContext, pos_x: f32, pos_y: f32) -> bool {
    // Check shipwreck monuments
    if is_near_shipwreck(ctx, pos_x, pos_y) {
        return true;
    }
    
    // Check fishing village monuments
    if is_near_fishing_village(ctx, pos_x, pos_y) {
        return true;
    }
    
    // Check whale bone graveyard monuments
    if is_near_whale_bone_graveyard(ctx, pos_x, pos_y) {
        return true;
    }
    
    // Check hunting village monument (lodge center only)
    // Clears trees/stones in a 750px radius around the lodge center
    if is_near_hunting_village(ctx, pos_x, pos_y) {
        return true;
    }
    
    // Check crashed research drone monuments
    if is_near_crashed_research_drone(ctx, pos_x, pos_y) {
        return true;
    }
    
    // Check weather station monuments
    if is_near_weather_station(ctx, pos_x, pos_y) {
        return true;
    }
    
    // Check wolf den monuments
    if is_near_wolf_den(ctx, pos_x, pos_y) {
        return true;
    }
    
    // Check alpine village monument (single lodge in alpine)
    if is_near_alpine_village(ctx, pos_x, pos_y) {
        return true;
    }
    
    // Check ALK substations (clearance for trees/stones)
    if is_near_alk_substation(ctx, pos_x, pos_y) {
        return true;
    }
    
    false // Not near any monument
}

/// Checks if position is near any shipwreck part
fn is_near_shipwreck(ctx: &ReducerContext, pos_x: f32, pos_y: f32) -> bool {
    let clearance_sq = clearance::SHIPWRECK * clearance::SHIPWRECK;
    
    for part in ctx.db.monument_part().iter() {
        if part.monument_type != MonumentType::Shipwreck {
            continue;
        }
        let dx = pos_x - part.world_x;
        let dy = pos_y - part.world_y;
        let dist_sq = dx * dx + dy * dy;
        
        if dist_sq < clearance_sq {
            return true;
        }
    }
    
    false
}

/// Checks if position is near any fishing village part
fn is_near_fishing_village(ctx: &ReducerContext, pos_x: f32, pos_y: f32) -> bool {
    let clearance_sq = clearance::FISHING_VILLAGE * clearance::FISHING_VILLAGE;
    
    for part in ctx.db.monument_part().iter() {
        if part.monument_type != MonumentType::FishingVillage {
            continue;
        }
        let dx = pos_x - part.world_x;
        let dy = pos_y - part.world_y;
        let dist_sq = dx * dx + dy * dy;
        
        if dist_sq < clearance_sq {
            return true;
        }
    }
    
    false
}

/// Checks if position is near any whale bone graveyard part
fn is_near_whale_bone_graveyard(ctx: &ReducerContext, pos_x: f32, pos_y: f32) -> bool {
    let clearance_sq = clearance::WHALE_BONE_GRAVEYARD * clearance::WHALE_BONE_GRAVEYARD;
    
    for part in ctx.db.monument_part().iter() {
        if part.monument_type != MonumentType::WhaleBoneGraveyard {
            continue;
        }
        let dx = pos_x - part.world_x;
        let dy = pos_y - part.world_y;
        let dist_sq = dx * dx + dy * dy;
        
        if dist_sq < clearance_sq {
            return true;
        }
    }
    
    false
}

/// Checks if position is near the hunting village CENTER (lodge only)
/// Only checks center piece to avoid creating massive exclusion zones from multiple parts
fn is_near_hunting_village(ctx: &ReducerContext, pos_x: f32, pos_y: f32) -> bool {
    let clearance_sq = clearance::HUNTING_VILLAGE * clearance::HUNTING_VILLAGE;
    
    for part in ctx.db.monument_part().iter() {
        // Only check the CENTER (lodge) of hunting village, not every part
        // This prevents a massive exclusion zone from multiple overlapping radii
        if part.monument_type != MonumentType::HuntingVillage || !part.is_center {
            continue;
        }
        let dx = pos_x - part.world_x;
        let dy = pos_y - part.world_y;
        let dist_sq = dx * dx + dy * dy;
        
        if dist_sq < clearance_sq {
            return true;
        }
    }
    
    false
}

/// Checks if position is near any crashed research drone
fn is_near_crashed_research_drone(ctx: &ReducerContext, pos_x: f32, pos_y: f32) -> bool {
    let clearance_sq = clearance::CRASHED_RESEARCH_DRONE * clearance::CRASHED_RESEARCH_DRONE;
    
    for part in ctx.db.monument_part().iter() {
        if part.monument_type != MonumentType::CrashedResearchDrone {
            continue;
        }
        let dx = pos_x - part.world_x;
        let dy = pos_y - part.world_y;
        let dist_sq = dx * dx + dy * dy;
        
        if dist_sq < clearance_sq {
            return true;
        }
    }
    
    false
}

/// Checks if position is near any weather station
fn is_near_weather_station(ctx: &ReducerContext, pos_x: f32, pos_y: f32) -> bool {
    let clearance_sq = clearance::WEATHER_STATION * clearance::WEATHER_STATION;
    
    for part in ctx.db.monument_part().iter() {
        if part.monument_type != MonumentType::WeatherStation {
            continue;
        }
        let dx = pos_x - part.world_x;
        let dy = pos_y - part.world_y;
        let dist_sq = dx * dx + dy * dy;
        
        if dist_sq < clearance_sq {
            return true;
        }
    }
    
    false
}

/// Checks if position is near any wolf den
fn is_near_wolf_den(ctx: &ReducerContext, pos_x: f32, pos_y: f32) -> bool {
    let clearance_sq = clearance::WOLF_DEN * clearance::WOLF_DEN;
    
    for part in ctx.db.monument_part().iter() {
        if part.monument_type != MonumentType::WolfDen {
            continue;
        }
        let dx = pos_x - part.world_x;
        let dy = pos_y - part.world_y;
        let dist_sq = dx * dx + dy * dy;
        
        if dist_sq < clearance_sq {
            return true;
        }
    }
    
    false
}

/// Checks if position is near the alpine village (single lodge center)
fn is_near_alpine_village(ctx: &ReducerContext, pos_x: f32, pos_y: f32) -> bool {
    let clearance_sq = clearance::ALPINE_VILLAGE * clearance::ALPINE_VILLAGE;
    
    for part in ctx.db.monument_part().iter() {
        if part.monument_type != MonumentType::AlpineVillage || !part.is_center {
            continue;
        }
        let dx = pos_x - part.world_x;
        let dy = pos_y - part.world_y;
        let dist_sq = dx * dx + dy * dy;
        
        if dist_sq < clearance_sq {
            return true;
        }
    }
    
    false
}

/// Clearance radius for ALK substations (trees/stones should not spawn on them)
const ALK_SUBSTATION_CLEARANCE: f32 = 300.0; // 6 tile radius clearance for substations
const ALK_SUBSTATION_CLEARANCE_SQ: f32 = ALK_SUBSTATION_CLEARANCE * ALK_SUBSTATION_CLEARANCE;

/// Checks if position is near any ALK substation
/// This prevents trees and stones from spawning on top of substations
fn is_near_alk_substation(ctx: &ReducerContext, pos_x: f32, pos_y: f32) -> bool {
    use crate::alk::alk_station as AlkStationTableTrait;
    
    for station in ctx.db.alk_station().iter() {
        // Skip the central compound (station_id == 0), only check substations
        if station.station_id == 0 {
            continue;
        }
        
        let dx = pos_x - station.world_pos_x;
        let dy = pos_y - station.world_pos_y;
        let dist_sq = dx * dx + dy * dy;
        
        if dist_sq < ALK_SUBSTATION_CLEARANCE_SQ {
            return true;
        }
    }
    
    false
}

// =============================================================================
// MONUMENT BUILDING COLLISION - Prevents barrels/rations spawning inside buildings
// =============================================================================

/// Minimum distance from monument building centers to prevent resource spawns
/// Simple radius check - keeps barrels/rations away from lodges, huts, etc.
const MONUMENT_BUILDING_EXCLUSION_RADIUS: f32 = 450.0;
const MONUMENT_BUILDING_EXCLUSION_RADIUS_SQ: f32 = MONUMENT_BUILDING_EXCLUSION_RADIUS * MONUMENT_BUILDING_EXCLUSION_RADIUS;

/// Check if a part type is a "building" (structure that should block spawns)
fn is_building_part_type(part_type: &str) -> bool {
    matches!(part_type, "lodge" | "hut" | "hermit_hut" | "shack" | "radar" | "mound" | "drone" | "skeleton")
}

/// Checks if a position is too close to any monument building
/// Simple distance check - prevents barrels/rations from spawning inside or near buildings
/// 
/// Returns true if the position is within 450px of any monument building center
pub fn is_position_inside_monument_building(ctx: &ReducerContext, pos_x: f32, pos_y: f32) -> bool {
    for part in ctx.db.monument_part().iter() {
        // Only check building-type parts
        if is_building_part_type(&part.part_type) {
            let dx = pos_x - part.world_x;
            let dy = pos_y - part.world_y;
            let dist_sq = dx * dx + dy * dy;
            
            if dist_sq < MONUMENT_BUILDING_EXCLUSION_RADIUS_SQ {
                return true;
            }
        }
    }
    
    false
}

// =============================================================================
// MONUMENT GENERATION
// =============================================================================

/// Generate shipwreck monument on south beach
/// Returns (center_positions, crash_parts) where:
/// - center_positions: Vec of (x, y) in world pixels for hull1.png center piece
/// - crash_parts: Vec of (x, y, image_path) for additional crash debris scattered along beach
pub fn generate_shipwreck(
    noise: &Perlin,
    shore_distance: &[Vec<f64>],
    river_network: &[Vec<bool>],
    lake_map: &[Vec<bool>],
    width: usize,
    height: usize,
) -> (Vec<(f32, f32)>, Vec<(f32, f32, String)>) {
    let mut shipwreck_centers = Vec::new();
    let mut shipwreck_parts = Vec::new();
    
    log::info!("🚢 Generating shipwreck monument on south beach...");
    
    // Find south beach tiles (bottom 1/3 of map for more beach tiles, beach tiles only)
    // Focus on southern beach where there are more beach tiles available
    let map_height_third = height * 2 / 3; // Start at 2/3 down the map (bottom third)
    let beach_threshold = 12.0; // Same threshold as beach generation
    let min_distance_from_edge = 20;
    
    let mut candidate_positions = Vec::new();
    
    // Search bottom third of map for beach tiles (more beach tiles here)
    for y in (map_height_third + min_distance_from_edge)..(height - min_distance_from_edge) {
        for x in min_distance_from_edge..(width - min_distance_from_edge) {
            let shore_dist = shore_distance[y][x];
            
            // Must be beach tile (not water, not deep inland)
            if shore_dist >= 0.0 && shore_dist < beach_threshold {
                // Must not be on river or lake
                if river_network[y][x] || lake_map[y][x] {
                    continue;
                }
                
                // Must be walkable land (not water)
                if shore_dist < 0.0 {
                    continue;
                }
                
                candidate_positions.push((x, y));
            }
        }
    }
    
    if candidate_positions.is_empty() {
        log::warn!("🚢 No valid south beach positions found for shipwreck");
        return (shipwreck_centers, shipwreck_parts);
    }
    
    // Select one position using noise for deterministic placement
    let mut best_score = f64::NEG_INFINITY;
    let mut best_position: Option<(usize, usize)> = None;
    
    for &(x, y) in &candidate_positions {
        let noise_val = noise.get([x as f64 * 0.01, y as f64 * 0.01, 10000.0]);
        if noise_val > best_score {
            best_score = noise_val;
            best_position = Some((x, y));
        }
    }
    
    if let Some((center_x, center_y)) = best_position {
        // Convert tile position to world pixels
        let center_world_x = (center_x as f32 + 0.5) * crate::TILE_SIZE_PX as f32;
        let center_world_y = (center_y as f32 + 0.5) * crate::TILE_SIZE_PX as f32;
        
        shipwreck_centers.push((center_world_x, center_world_y));
        
        log::info!("🚢✨ PLACED SHIPWRECK CENTER at tile ({}, {}) = 📍 World Position: ({:.0}, {:.0}) ✨",
                   center_x, center_y, center_world_x, center_world_y);
        
        // Generate crash parts scattered along the beach (east and west of center)
        let min_distance_tiles = 15; // Minimum distance from center (about 720px)
        let max_distance_tiles = 50; // Maximum distance for wider spread (about 2400px)
        let tile_size_px = crate::TILE_SIZE_PX as f32;
        
        // Directions: east and west along the beach, with slight north/south variation
        let directions = [
            (1.0, 0.0),       // East
            (-1.0, 0.0),      // West
            (1.0, 0.3),       // East-southeast
            (-1.0, 0.3),      // West-southeast
            (1.0, -0.3),      // East-northeast
            (-1.0, -0.3),     // West-northeast
        ];
        
        // ALWAYS spawn exactly 6 crash parts (no randomness)
        // Center uses hull1.png, so parts use hull2.png through hull6.png + hull1.png (6 images for 6 parts)
        // One part will duplicate center's hull1.png, but that's acceptable since center is marked differently
        let num_parts = 6;
        let mut placed_parts = Vec::new();
        
        // Pre-assign image numbers: Start with hull6.png, hull5.png, hull4.png (harder to place, try first)
        // Then hull3.png, hull2.png, hull1.png (easier to place)
        // This ensures hull6.png gets placed before we run out of attempts
        // Parts: [hull6, hull5, hull4, hull3, hull2, hull1] - hull1 duplicates center but that's OK
        let part_image_nums: Vec<u32> = vec![6, 5, 4, 3, 2, 1]; // Reverse order: hull6 first, hull1 last
        
        for i in 0..num_parts {
            // Pre-assigned unique image for this part (hull6.png gets tried first)
            let image_num = part_image_nums[i];
            let image_path = format!("hull{}.png", image_num);
            
            let mut attempts = 0;
            // Increased attempts: hull6.png (part 0) gets 3000 attempts, others get 2000
            // This ensures all parts have a good chance of placement, especially on southern beach
            let max_attempts_normal = if i == 0 { 1500 } else { 1000 }; // More attempts for hull6.png
            let max_attempts_relaxed = if i == 0 { 1500 } else { 1000 }; // More relaxed attempts for hull6.png
            let total_max_attempts = max_attempts_normal + max_attempts_relaxed;
            let mut placed = false;
            
            loop {
                if attempts >= total_max_attempts {
                    log::error!("🚢 CRITICAL: Failed to place shipwreck part #{} (hull{}.png) after {} attempts.", i + 1, image_num, total_max_attempts);
                    break;
                }
                
                let relaxed_mode = attempts >= max_attempts_normal;
                // Extra relaxed mode for hull6.png (part 0) - be very permissive
                let extra_relaxed = relaxed_mode && i == 0;
                
                // Pick a direction (cycle through all directions for variety)
                let dir_idx = (i + (attempts / 10)) % directions.len();
                let (dir_x, dir_y) = directions[dir_idx];
                
                // Vary distance from center
                let distance_factor = noise.get([
                    center_x as f64 * 0.05 + i as f64 + attempts as f64 * 0.1, 
                    center_y as f64 * 0.05 + i as f64 + attempts as f64 * 0.1, 
                    10002.0
                ]);
                let distance_range = max_distance_tiles - min_distance_tiles;
                let distance_tiles = min_distance_tiles as f32 + (distance_factor.abs() as f32 * distance_range as f32);
                
                // Calculate part position in tiles
                let part_tile_x = center_x as f32 + dir_x * distance_tiles;
                let part_tile_y = center_y as f32 + dir_y * distance_tiles;
                let part_tile_x_int = part_tile_x.round() as i32;
                let part_tile_y_int = part_tile_y.round() as i32;
                
                // Bounds check - more relaxed for hull6.png
                let bounds_margin = if extra_relaxed { 3 } else if relaxed_mode { 5 } else { 10 };
                if part_tile_x_int < bounds_margin || part_tile_y_int < bounds_margin || 
                   part_tile_x_int >= (width as i32 - bounds_margin) || part_tile_y_int >= (height as i32 - bounds_margin) {
                    attempts += 1;
                    continue;
                }
                
                let px = part_tile_x_int as usize;
                let py = part_tile_y_int as usize;
                
                // Must be on land (not water, not river, not lake)
                let part_shore_dist = shore_distance[py][px];
                if part_shore_dist < 0.0 || river_network[py][px] || lake_map[py][px] {
                    attempts += 1;
                    continue;
                }
                
                // Must be at least 5 tiles from shore/water - relaxed for hull6.png and relaxed mode
                // More relaxed since we're focusing on southern beach with more beach tiles
                let min_water_dist = if extra_relaxed { 2.0 } else if relaxed_mode { 3.0 } else { 4.0 };
                if part_shore_dist < min_water_dist {
                    attempts += 1;
                    continue;
                }
                
                // Must be on beach or near beach - more relaxed for hull6.png and relaxed mode
                // Southern beach has more beach tiles, so we can be more permissive
                let max_inland = if extra_relaxed { 70.0 } else if relaxed_mode { 60.0 } else { 50.0 };
                if part_shore_dist > max_inland {
                    attempts += 1;
                    continue;
                }
                
                // Check minimum distance from other parts - more relaxed for hull6.png and relaxed mode
                // Reduced since southern beach has more space
                let min_part_distance = if extra_relaxed { 8.0 } else if relaxed_mode { 12.0 } else { 18.0 };
                let mut too_close = false;
                for &(other_x, other_y, _) in &placed_parts {
                    let other_tile_x = (other_x / tile_size_px) as f32;
                    let other_tile_y = (other_y / tile_size_px) as f32;
                    let dx = part_tile_x - other_tile_x;
                    let dy = part_tile_y - other_tile_y;
                    let dist_sq = dx * dx + dy * dy;
                    if dist_sq < min_part_distance * min_part_distance {
                        too_close = true;
                        break;
                    }
                }
                
                if too_close {
                    attempts += 1;
                    continue;
                }
                
                // Valid position found! Convert to world pixels
                let part_world_x = (part_tile_x_int as f32 + 0.5) * tile_size_px;
                let part_world_y = (part_tile_y_int as f32 + 0.5) * tile_size_px;
                
                // Use the pre-assigned unique image
                placed_parts.push((part_world_x, part_world_y, image_path.clone()));
                shipwreck_parts.push((part_world_x, part_world_y, image_path));
                
                log::info!("🚢✨ PLACED SHIPWRECK PART #{} (hull{}.png) at tile ({}, {}) = 📍 World Position: ({:.0}, {:.0}) {} ✨",
                           i + 1, image_num, px, py, part_world_x, part_world_y, if relaxed_mode { "(RELAXED)" } else { "" });
                placed = true;
                break;
            }
            
            if !placed {
                log::error!("🚢 CRITICAL: Part #{} (hull{}.png) was NOT placed! Only {} parts placed so far.", i + 1, image_num, placed_parts.len());
            }
        }
        
        log::info!("🚢 Shipwreck generation complete: 1 center + {} crash parts", shipwreck_parts.len());
    } else {
        log::warn!("🚢 Failed to select shipwreck position");
    }
    
    (shipwreck_centers, shipwreck_parts)
}

/// Generate fishing village monument on south beach (opposite side from shipwreck)
/// Aleut-style fishing village with huts, smoke racks, and central campfire.
/// Returns (center_position, village_parts) where:
/// - center_position: (x, y) in world pixels for campfire center piece
/// - village_parts: Vec of (x, y, image_path, part_type, rotation_rad) for all village structures
pub fn generate_fishing_village(
    noise: &Perlin,
    shore_distance: &[Vec<f64>],
    river_network: &[Vec<bool>],
    lake_map: &[Vec<bool>],
    quarry_dirt: &[Vec<bool>],
    shipwreck_centers: &[(f32, f32)], // Avoid placing near shipwreck
    hot_spring_centers: &[(f32, f32, i32)], // Avoid placing near hot springs (x, y, radius)
    width: usize,
    height: usize,
) -> (Option<(f32, f32)>, Vec<(f32, f32, String, String, f32)>) {
    let mut village_center: Option<(f32, f32)> = None;
    let mut village_parts: Vec<(f32, f32, String, String, f32)> = Vec::new();
    
    log::info!("🏘️ Generating fishing village monument on south beach...");
    
    // Find south beach tiles - VERY close to shore (2-6 tiles from water)
    let map_height_third = height * 2 / 3; // Start at 2/3 down the map (bottom third)
    let min_shore_dist = 2.0;  // At least 2 tiles from water (not IN water)
    let max_shore_dist = 6.0;  // At most 6 tiles from water (right on the beach!)
    let min_distance_from_edge = 25;
    let min_distance_from_shipwreck = 80.0; // Minimum tiles away from shipwreck
    let min_distance_from_hot_spring = 42.0; // Minimum tiles away from hot springs (~2000px)
    
    let mut candidate_positions = Vec::new();
    
    // Search bottom third of map for beach tiles RIGHT at the shore
    for y in (map_height_third + min_distance_from_edge)..(height - min_distance_from_edge) {
        for x in min_distance_from_edge..(width - min_distance_from_edge) {
            let shore_dist = shore_distance[y][x];
            
            // Must be very close to shore - right on the beach!
            if shore_dist >= min_shore_dist && shore_dist <= max_shore_dist {
                // Must not be on river or lake
                if river_network[y][x] || lake_map[y][x] {
                    continue;
                }

                if is_tile_near_quarry_dirt(quarry_dirt, x, y, VILLAGE_QUARRY_CLEARANCE_TILES) {
                    continue;
                }
                
                // CRITICAL: Verify this is actual OCEAN coast, not near an inland lake!
                // Follow the gradient towards water and confirm we reach deep ocean (shore_distance < -10)
                // within a reasonable distance. This prevents spawning near inland lakes.
                let mut is_ocean_coast = false;
                let check_distance = 25; // Check up to 25 tiles towards water
                let deep_ocean_threshold = -10.0; // Deep enough to confirm it's ocean, not a lake edge
                
                // Sample in 8 directions to find direction of decreasing shore_distance
                let directions: [(i32, i32); 8] = [
                    (1, 0), (1, 1), (0, 1), (-1, 1),  // E, SE, S, SW
                    (-1, 0), (-1, -1), (0, -1), (1, -1), // W, NW, N, NE
                ];
                
                for &(dx, dy) in &directions {
                    // Walk in this direction and check if we reach deep ocean
                    for step in 1..=check_distance {
                        let check_x = (x as i32 + dx * step).clamp(0, width as i32 - 1) as usize;
                        let check_y = (y as i32 + dy * step).clamp(0, height as i32 - 1) as usize;
                        
                        // Skip if we hit a lake - that's NOT ocean
                        if lake_map[check_y][check_x] {
                            break; // This direction leads to a lake, not ocean
                        }
                        
                        // Check if we've reached deep ocean
                        if shore_distance[check_y][check_x] < deep_ocean_threshold {
                            is_ocean_coast = true;
                            break;
                        }
                    }
                    
                    if is_ocean_coast {
                        break; // Found ocean access, this position is valid
                    }
                }
                
                if !is_ocean_coast {
                    continue; // Skip positions that don't have clear access to ocean
                }
                
                // Check distance from shipwreck - must be far away
                let tile_world_x = (x as f32 + 0.5) * crate::TILE_SIZE_PX as f32;
                let tile_world_y = (y as f32 + 0.5) * crate::TILE_SIZE_PX as f32;
                
                let mut too_close_to_monument = false;
                for &(shipwreck_x, shipwreck_y) in shipwreck_centers {
                    let dx = tile_world_x - shipwreck_x;
                    let dy = tile_world_y - shipwreck_y;
                    let dist_tiles = (dx * dx + dy * dy).sqrt() / crate::TILE_SIZE_PX as f32;
                    if dist_tiles < min_distance_from_shipwreck {
                        too_close_to_monument = true;
                        break;
                    }
                }
                
                // Check distance from hot springs - must be at least 2000px (~42 tiles) away
                if !too_close_to_monument {
                    for &(hs_x, hs_y, hs_radius) in hot_spring_centers {
                        let dx = tile_world_x - hs_x;
                        let dy = tile_world_y - hs_y;
                        let dist_tiles = (dx * dx + dy * dy).sqrt() / crate::TILE_SIZE_PX as f32;
                        // Must be further than the hot spring radius + buffer
                        let min_dist = min_distance_from_hot_spring + hs_radius as f32;
                        if dist_tiles < min_dist {
                            too_close_to_monument = true;
                            break;
                        }
                    }
                }
                
                if too_close_to_monument {
                    continue;
                }
                
                candidate_positions.push((x, y, shore_dist));
            }
        }
    }
    
    if candidate_positions.is_empty() {
        log::warn!("🏘️ No valid south beach positions found for fishing village");
        return (village_center, village_parts);
    }
    
    log::info!("🏘️ Found {} candidate positions for fishing village (shore_dist {}-{})", 
               candidate_positions.len(), min_shore_dist, max_shore_dist);
    
    // Select position using noise - prefer positions closer to water
    let mut best_score = f64::NEG_INFINITY;
    let mut best_position: Option<(usize, usize)> = None;
    
    for &(x, y, shore_dist) in &candidate_positions {
        // Score: noise value + bonus for being closer to water
        let noise_val = noise.get([x as f64 * 0.01, y as f64 * 0.01, 20000.0]);
        let shore_bonus = (max_shore_dist - shore_dist) / max_shore_dist * 0.5; // Bonus for closer to water
        let score = noise_val + shore_bonus;
        
        if score > best_score {
            best_score = score;
            best_position = Some((x, y));
        }
    }
    
    if let Some((center_x, center_y)) = best_position {
        let tile_size_px = crate::TILE_SIZE_PX as f32;
        let center_world_x = (center_x as f32 + 0.5) * tile_size_px;
        let center_world_y = (center_y as f32 + 0.5) * tile_size_px;
        
        // Determine which direction the water is using shore_distance gradient
        // Just sample 8 directions and find which has lowest shore_distance
        let sample_dist = 8; // Sample 8 tiles away
        let directions: [(i32, i32); 8] = [
            (1, 0), (1, 1), (0, 1), (-1, 1),  // E, SE, S, SW
            (-1, 0), (-1, -1), (0, -1), (1, -1), // W, NW, N, NE
        ];
        
        let mut water_direction_x = 0.0f32;
        let mut water_direction_y = 0.0f32;
        
        for &(dx, dy) in &directions {
            let nx = (center_x as i32 + dx * sample_dist).clamp(0, width as i32 - 1) as usize;
            let ny = (center_y as i32 + dy * sample_dist).clamp(0, height as i32 - 1) as usize;
            let dist = shore_distance[ny][nx];
            
            // Weight by how much closer to water this direction is (lower = closer)
            // Negative shore_dist means water, so lower values = more towards water
            let weight = (shore_distance[center_y][center_x] - dist).max(0.0) as f32;
            water_direction_x += dx as f32 * weight;
            water_direction_y += dy as f32 * weight;
        }
        
        // Normalize water direction
        let water_dir_len = (water_direction_x * water_direction_x + water_direction_y * water_direction_y).sqrt();
        if water_dir_len > 0.01 {
            water_direction_x /= water_dir_len;
            water_direction_y /= water_dir_len;
        } else {
            // Default: assume water is to the south
            water_direction_x = 0.0;
            water_direction_y = 1.0;
        }
        
        // Calculate angle to water (for orienting the village)
        let water_angle = water_direction_y.atan2(water_direction_x);
        let inland_angle = water_angle + std::f32::consts::PI; // Opposite direction
        
        log::info!("🏘️ Water direction: ({:.2}, {:.2}), angle: {:.2} rad", 
                   water_direction_x, water_direction_y, water_angle);
        
        village_center = Some((center_world_x, center_world_y));
        
        log::info!("🏘️✨ PLACED FISHING VILLAGE CENTER (campfire) at tile ({}, {}) = 📍 World Position: ({:.0}, {:.0}) ✨",
                   center_x, center_y, center_world_x, center_world_y);
        
        // Village layout - spread out along the beach with PROPER spacing
        // =============================================================================
        // SIMPLE GRID-BASED LAYOUT - Fixed offsets from campfire center
        // Much more reliable than angle-based placement!
        // =============================================================================
        // Layout (in local coords where +X is perpendicular to shore, +Y is along shore):
        //
        //     HUT1 (-480, -500)     HUT3 (0, -700)     HUT2 (+480, -500)   <- INLAND
        //                                    
        //     SMOKE1 (-320, -200)  CAMPFIRE (0, 0)   SMOKE2 (+320, -200)
        //
        // We rotate these offsets based on water_direction to orient the village
        // =============================================================================
        
        log::info!("🏘️ Using grid layout with water direction ({:.2}, {:.2})", 
                   water_direction_x, water_direction_y);
        
        // Structure definitions: (part_type, image_name, offset_along_shore, offset_towards_water)
        // Positive offset_towards_water = towards water
        // Positive offset_along_shore = "right" when facing water
        // NOTE: Campfire is already ON the beach (2-6 tiles from water), so towards_water
        //       offsets need careful tuning - positive values go INTO water!
        // LAYOUT: Spread out for spacious village feel with visual campfire at center
        let structure_configs: [(&str, &str, f32, f32); 5] = [
            // Campfire - CENTER PIECE - using visual doodad fv_campfire.png
            ("campfire", "fv_campfire.png", 0.0, 0.0),
            
            // Huts - set back INLAND from campfire (negative = away from water), spread wider
            ("hut", "fv_lodge.png", -480.0, -500.0),    // Inland-left
            ("hut", "fv_hut2.png", 480.0, -500.0),     // Inland-right
            ("hut", "fv_hut3.png", 0.0, -700.0),       // Far inland center
            
            // Drying rack - further from campfire, flanking it with more space
            ("fv_drying_rack", "fv_drying_rack.png", -320.0, -200.0),
        ];
        
        // Calculate perpendicular direction (along the shore)
        // If water is (wx, wy), perpendicular is (-wy, wx)
        let shore_dir_x = -water_direction_y;
        let shore_dir_y = water_direction_x;
        
        for (part_type, image_name, offset_along_shore, offset_towards_water) in structure_configs.iter() {
            // Standard placement for huts, campfire, drying rack
            let world_offset_x = water_direction_x * offset_towards_water + shore_dir_x * offset_along_shore;
            let world_offset_y = water_direction_y * offset_towards_water + shore_dir_y * offset_along_shore;
            let part_world_x = center_world_x + world_offset_x;
            let part_world_y = center_world_y + world_offset_y;
            let rotation_rad = 0.0f32;
            
            // Convert to tile coords for validation
            let part_tile_x = (part_world_x / tile_size_px) as i32;
            let part_tile_y = (part_world_y / tile_size_px) as i32;
            
            // Bounds check
            if part_tile_x < 5 || part_tile_y < 5 || 
               part_tile_x >= (width as i32 - 5) || part_tile_y >= (height as i32 - 5) {
                log::warn!("🏘️ {} out of bounds at tile ({}, {})", part_type, part_tile_x, part_tile_y);
                continue;
            }
            
            let px = part_tile_x as usize;
            let py = part_tile_y as usize;
            
            // Check terrain - RELAXED constraints (we trust the grid layout)
            let part_shore_dist = shore_distance[py][px];
            
            // Huts, campfire, and smoke racks must be on land
            if part_shore_dist < -1.0 || river_network[py][px] || lake_map[py][px] {
                log::warn!("🏘️ {} terrain invalid: shore_dist={:.1}", part_type, part_shore_dist);
                continue;
            }
            
            // Place the structure!
            village_parts.push((part_world_x, part_world_y, image_name.to_string(), part_type.to_string(), rotation_rad));
            
            log::info!("🏘️✨ PLACED {} ({}) at ({:.0}, {:.0}), offset=({:.0}, {:.0}) ✨",
                       part_type.to_uppercase(), image_name, part_world_x, part_world_y,
                       offset_along_shore, offset_towards_water);
        }
        
        log::info!("🏘️ Fishing village generation complete: {} total structures", village_parts.len());
    } else {
        log::warn!("🏘️ Failed to select fishing village position");
    }
    
    (village_center, village_parts)
}

/// Generate whale bone graveyard monument on beach (separate from shipwreck and fishing village)
/// Ancient whale bone graveyard with hermit's hut, various whale bone parts scattered on beach.
/// Returns (center_position, graveyard_parts) where:
/// - center_position: (x, y) in world pixels for ribcage center piece
/// - graveyard_parts: Vec of (x, y, image_path, part_type) for all whale bone structures
pub fn generate_whale_bone_graveyard(
    noise: &Perlin,
    shore_distance: &[Vec<f64>],
    river_network: &[Vec<bool>],
    lake_map: &[Vec<bool>],
    shipwreck_centers: &[(f32, f32)], // Avoid placing near shipwreck
    fishing_village_center: Option<(f32, f32)>, // Avoid placing near fishing village
    hot_spring_centers: &[(f32, f32, i32)], // Avoid placing near hot springs (x, y, radius)
    width: usize,
    height: usize,
) -> (Option<(f32, f32)>, Vec<(f32, f32, String, String)>) {
    let mut graveyard_center: Option<(f32, f32)> = None;
    let mut graveyard_parts: Vec<(f32, f32, String, String)> = Vec::new();
    
    log::info!("🦴 Generating whale bone graveyard monument on beach...");
    
    // Find beach tiles - prefer DIFFERENT area from shipwreck and fishing village
    // Focus on the bottom third of the map (beach tiles here)
    let map_height_third = height * 2 / 3;
    let min_shore_dist = 3.0;  // At least 3 tiles from water (not IN water)
    let max_shore_dist = 12.0; // At most 12 tiles from water (on the beach)
    let min_distance_from_edge = 30;
    let min_distance_from_shipwreck = 100.0; // Minimum tiles away from shipwreck
    let min_distance_from_fishing_village = 80.0; // Minimum tiles away from fishing village
    let min_distance_from_hot_spring = 42.0; // Minimum tiles away from hot springs (~2000px)
    
    let mut candidate_positions = Vec::new();
    
    // Search bottom third of map for beach tiles
    for y in (map_height_third + min_distance_from_edge)..(height - min_distance_from_edge) {
        for x in min_distance_from_edge..(width - min_distance_from_edge) {
            let shore_dist = shore_distance[y][x];
            
            // Must be on beach (not water, not too far inland)
            if shore_dist >= min_shore_dist && shore_dist <= max_shore_dist {
                // Must not be on river or lake
                if river_network[y][x] || lake_map[y][x] {
                    continue;
                }
                
                // Check distance from shipwreck - must be far away
                let tile_world_x = (x as f32 + 0.5) * crate::TILE_SIZE_PX as f32;
                let tile_world_y = (y as f32 + 0.5) * crate::TILE_SIZE_PX as f32;
                
                let mut too_close_to_monument = false;
                for &(shipwreck_x, shipwreck_y) in shipwreck_centers {
                    let dx = tile_world_x - shipwreck_x;
                    let dy = tile_world_y - shipwreck_y;
                    let dist_tiles = (dx * dx + dy * dy).sqrt() / crate::TILE_SIZE_PX as f32;
                    if dist_tiles < min_distance_from_shipwreck {
                        too_close_to_monument = true;
                        break;
                    }
                }
                
                // Check distance from fishing village
                if let Some((fv_x, fv_y)) = fishing_village_center {
                    let dx = tile_world_x - fv_x;
                    let dy = tile_world_y - fv_y;
                    let dist_tiles = (dx * dx + dy * dy).sqrt() / crate::TILE_SIZE_PX as f32;
                    if dist_tiles < min_distance_from_fishing_village {
                        too_close_to_monument = true;
                    }
                }
                
                // Check distance from hot springs - must be at least 2000px (~42 tiles) away
                if !too_close_to_monument {
                    for &(hs_x, hs_y, hs_radius) in hot_spring_centers {
                        let dx = tile_world_x - hs_x;
                        let dy = tile_world_y - hs_y;
                        let dist_tiles = (dx * dx + dy * dy).sqrt() / crate::TILE_SIZE_PX as f32;
                        // Must be further than the hot spring radius + buffer
                        let min_dist = min_distance_from_hot_spring + hs_radius as f32;
                        if dist_tiles < min_dist {
                            too_close_to_monument = true;
                            break;
                        }
                    }
                }
                
                if too_close_to_monument {
                    continue;
                }
                
                candidate_positions.push((x, y, shore_dist));
            }
        }
    }
    
    if candidate_positions.is_empty() {
        log::warn!("🦴 No valid beach positions found for whale bone graveyard");
        return (graveyard_center, graveyard_parts);
    }
    
    log::info!("🦴 Found {} candidate positions for whale bone graveyard (shore_dist {}-{})", 
               candidate_positions.len(), min_shore_dist, max_shore_dist);
    
    // Select position using noise - prefer positions with moderate beach width
    let mut best_score = f64::NEG_INFINITY;
    let mut best_position: Option<(usize, usize)> = None;
    
    for &(x, y, shore_dist) in &candidate_positions {
        // Score: noise value + bonus for being in sweet spot of beach (not too close to water, not too inland)
        let noise_val = noise.get([x as f64 * 0.01, y as f64 * 0.01, 30000.0]); // Different seed than other monuments
        let beach_bonus = 1.0 - ((shore_dist - 7.0).abs() / 7.0).min(1.0) * 0.5; // Peak at shore_dist ~7
        let score = noise_val + beach_bonus;
        
        if score > best_score {
            best_score = score;
            best_position = Some((x, y));
        }
    }
    
    if let Some((center_x, center_y)) = best_position {
        let tile_size_px = crate::TILE_SIZE_PX as f32;
        let center_world_x = (center_x as f32 + 0.5) * tile_size_px;
        let center_world_y = (center_y as f32 + 0.5) * tile_size_px;
        
        graveyard_center = Some((center_world_x, center_world_y));
        
        log::info!("🦴✨ PLACED WHALE BONE GRAVEYARD CENTER (hermit hut) at tile ({}, {}) = 📍 World Position: ({:.0}, {:.0}) ✨",
                   center_x, center_y, center_world_x, center_world_y);
        
        // =============================================================================
        // WHALE BONE GRAVEYARD LAYOUT
        // =============================================================================
        // The hermit's hut is the center of the graveyard, surrounded by whale bones
        // Bones are spread far apart to create a sprawling, ancient graveyard feel
        // The hermit tends his campfire near the hut
        //
        // Layout (in local coords) - spread out ~2x further:
        //              RIBCAGE (-150, -450)
        //     SKULL (-450, -200)               SPINE (450, -150)
        //                    HUT (0, 0) <- CENTER
        //                    CAMPFIRE (80, 120)
        //              JAWBONE (200, 400)
        //
        // =============================================================================
        
        // Structure definitions: (part_type, image_name, offset_x, offset_y)
        // Using same coordinate system as fishing village (water direction not critical for graveyard)
        // Note: Functional campfire is spawned via monument placeables, not as a visual doodad
        let structure_configs: [(&str, &str, f32, f32); 5] = [
            // Hermit's hut - CENTER PIECE - the heart of the graveyard
            ("hermit_hut", "wbg_hermit_hut.png", 0.0, 0.0),
            
            // Large whale ribcage - north, prominent landmark
            ("ribcage", "wbg_ribcage.png", -150.0, -450.0),
            
            // Whale skull - far north-west
            ("skull", "wbg_skull.png", -450.0, -200.0),
            
            // Whale spine - far north-east
            ("spine", "wbg_spine.png", 450.0, -150.0),
            
            // Whale jawbone - south, near the water
            ("jawbone", "wbg_jawbone.png", 200.0, 400.0),
        ];
        
        for (part_type, image_name, offset_x, offset_y) in structure_configs.iter() {
            let part_world_x = center_world_x + offset_x;
            let part_world_y = center_world_y + offset_y;
            
            // Convert to tile coords for validation
            let part_tile_x = (part_world_x / tile_size_px) as i32;
            let part_tile_y = (part_world_y / tile_size_px) as i32;
            
            // Bounds check
            if part_tile_x < 5 || part_tile_y < 5 || 
               part_tile_x >= (width as i32 - 5) || part_tile_y >= (height as i32 - 5) {
                log::warn!("🦴 {} out of bounds at tile ({}, {})", part_type, part_tile_x, part_tile_y);
                continue;
            }
            
            let px = part_tile_x as usize;
            let py = part_tile_y as usize;
            
            // Check terrain - allow some flexibility for bone placement
            let part_shore_dist = shore_distance[py][px];
            
            // Skip only if in water or on river/lake
            if part_shore_dist < -1.0 || river_network[py][px] || lake_map[py][px] {
                log::warn!("🦴 {} terrain invalid: shore_dist={:.1}", part_type, part_shore_dist);
                continue;
            }
            
            // Determine if this is the center piece (hermit hut is the heart of the graveyard)
            let is_center = *part_type == "hermit_hut";
            
            // Place the structure!
            graveyard_parts.push((part_world_x, part_world_y, image_name.to_string(), part_type.to_string()));
            
            log::info!("🦴✨ PLACED {} ({}) at ({:.0}, {:.0}), offset=({:.0}, {:.0}) ✨",
                       part_type.to_uppercase(), image_name, part_world_x, part_world_y,
                       offset_x, offset_y);
        }
        
        log::info!("🦴 Whale bone graveyard generation complete: {} total structures", graveyard_parts.len());
    } else {
        log::warn!("🦴 Failed to select whale bone graveyard position");
    }
    
    (graveyard_center, graveyard_parts)
}

/// Generate hunting village monument in a forest biome
/// Boreal Aleutian-style hunting village with lodge, huts, campfire, and surrounding tree ring.
/// Returns (center_position, village_parts) where:
/// - center_position: (x, y) in world pixels for lodge center piece
/// - village_parts: Vec of (x, y, image_path, part_type) for all village structures
pub fn generate_hunting_village(
    noise: &Perlin,
    shore_distance: &[Vec<f64>],
    river_network: &[Vec<bool>],
    lake_map: &[Vec<bool>],
    quarry_dirt: &[Vec<bool>],
    forest_areas: &[Vec<bool>],
    tundra_areas: &[Vec<bool>],
    hot_spring_centers: &[(f32, f32, i32)],
    shipwreck_centers: &[(f32, f32)],
    fishing_village_center: Option<(f32, f32)>,
    whale_bone_graveyard_center: Option<(f32, f32)>,
    large_quarry_centers: &[(f32, f32, i32)], // Large quarry centers (x_tile, y_tile, radius)
    width: usize,
    height: usize,
) -> (Option<(f32, f32)>, Vec<(f32, f32, String, String)>) {
    let mut village_center: Option<(f32, f32)> = None;
    let mut village_parts: Vec<(f32, f32, String, String)> = Vec::new();
    
    log::info!("🏕️ Generating hunting village monument in forest biome...");
    
    // Find suitable forest tiles - must be in FOREST biome (NOT tundra), away from water and rivers
    // Focus on middle-northern area of the map (forest-rich zone)
    let map_height_quarter = height / 4; // Start at 1/4 down the map
    let map_height_three_quarters = height * 3 / 4; // End at 3/4 down
    let min_shore_dist = 15.0;  // At least 15 tiles from water (deep in forest)
    let min_distance_from_edge = 40;
    let min_distance_from_shipwreck = 100.0; // Minimum tiles away from shipwreck
    let min_distance_from_fishing_village = 80.0; // Minimum tiles away from fishing village
    let min_distance_from_whale_graveyard = 80.0; // Minimum tiles away from whale graveyard
    let min_distance_from_hot_spring = 60.0; // Minimum tiles away from hot springs
    let min_distance_from_large_quarry = 50.0; // Minimum tiles away from large quarries (~2400px)
    let min_distance_from_river = 8; // Minimum tiles away from rivers
    
    let mut candidate_positions = Vec::new();
    
    // Search middle portion of map for forest tiles
    for y in (map_height_quarter + min_distance_from_edge)..(map_height_three_quarters - min_distance_from_edge) {
        for x in min_distance_from_edge..(width - min_distance_from_edge) {
            let shore_dist = shore_distance[y][x];
            
            // Must be deep inland, in a forest area, and NOT in tundra
            if shore_dist >= min_shore_dist && forest_areas[y][x] && !tundra_areas[y][x] {
                // Must not be on river or lake
                if river_network[y][x] || lake_map[y][x] {
                    continue;
                }

                if is_tile_near_quarry_dirt(quarry_dirt, x, y, VILLAGE_QUARRY_CLEARANCE_TILES) {
                    continue;
                }
                
                // Check if too close to a river (check surrounding tiles)
                let mut too_close_to_river = false;
                for check_dy in -(min_distance_from_river as i32)..=(min_distance_from_river as i32) {
                    for check_dx in -(min_distance_from_river as i32)..=(min_distance_from_river as i32) {
                        let check_x = x as i32 + check_dx;
                        let check_y = y as i32 + check_dy;
                        if check_x >= 0 && check_y >= 0 && 
                           (check_x as usize) < width && (check_y as usize) < height {
                            if river_network[check_y as usize][check_x as usize] {
                                too_close_to_river = true;
                                break;
                            }
                        }
                    }
                    if too_close_to_river { break; }
                }
                
                if too_close_to_river {
                    continue;
                }
                
                // Check distance from other monuments and special features
                let tile_world_x = (x as f32 + 0.5) * crate::TILE_SIZE_PX as f32;
                let tile_world_y = (y as f32 + 0.5) * crate::TILE_SIZE_PX as f32;
                
                let mut too_close = false;
                
                // Check distance from shipwreck
                for &(shipwreck_x, shipwreck_y) in shipwreck_centers {
                    let dx = tile_world_x - shipwreck_x;
                    let dy = tile_world_y - shipwreck_y;
                    let dist_tiles = (dx * dx + dy * dy).sqrt() / crate::TILE_SIZE_PX as f32;
                    if dist_tiles < min_distance_from_shipwreck {
                        too_close = true;
                        break;
                    }
                }
                
                // Check distance from hot springs
                if !too_close {
                    for &(hs_x, hs_y, hs_radius) in hot_spring_centers {
                        let dx = tile_world_x - hs_x;
                        let dy = tile_world_y - hs_y;
                        let dist_tiles = (dx * dx + dy * dy).sqrt() / crate::TILE_SIZE_PX as f32;
                        // Must be further than the hot spring radius + buffer
                        let min_dist = min_distance_from_hot_spring + hs_radius as f32;
                        if dist_tiles < min_dist {
                            too_close = true;
                            break;
                        }
                    }
                }
                
                // Check distance from fishing village
                if !too_close {
                    if let Some((fv_x, fv_y)) = fishing_village_center {
                        let dx = tile_world_x - fv_x;
                        let dy = tile_world_y - fv_y;
                        let dist_tiles = (dx * dx + dy * dy).sqrt() / crate::TILE_SIZE_PX as f32;
                        if dist_tiles < min_distance_from_fishing_village {
                            too_close = true;
                        }
                    }
                }
                
                // Check distance from whale bone graveyard
                if !too_close {
                    if let Some((wbg_x, wbg_y)) = whale_bone_graveyard_center {
                        let dx = tile_world_x - wbg_x;
                        let dy = tile_world_y - wbg_y;
                        let dist_tiles = (dx * dx + dy * dy).sqrt() / crate::TILE_SIZE_PX as f32;
                        if dist_tiles < min_distance_from_whale_graveyard {
                            too_close = true;
                        }
                    }
                }
                
                // Check distance from large quarries (Stone/Sulfur/Metal)
                if !too_close {
                    for &(quarry_tile_x, quarry_tile_y, quarry_radius) in large_quarry_centers {
                        let quarry_world_x = (quarry_tile_x + 0.5) * crate::TILE_SIZE_PX as f32;
                        let quarry_world_y = (quarry_tile_y + 0.5) * crate::TILE_SIZE_PX as f32;
                        let dx = tile_world_x - quarry_world_x;
                        let dy = tile_world_y - quarry_world_y;
                        let dist_tiles = (dx * dx + dy * dy).sqrt() / crate::TILE_SIZE_PX as f32;
                        let min_dist = min_distance_from_large_quarry + quarry_radius as f32;
                        if dist_tiles < min_dist {
                            too_close = true;
                            break;
                        }
                    }
                }
                
                if too_close {
                    continue;
                }
                
                candidate_positions.push((x, y, shore_dist));
            }
        }
    }
    
    if candidate_positions.is_empty() {
        log::warn!("🏕️ No valid forest positions found for hunting village");
        return (village_center, village_parts);
    }
    
    log::info!("🏕️ Found {} candidate positions for hunting village in forest biome", 
               candidate_positions.len());
    
    // Select position using noise - prefer positions deeper in forest
    let mut best_score = f64::NEG_INFINITY;
    let mut best_position: Option<(usize, usize)> = None;
    
    for &(x, y, shore_dist) in &candidate_positions {
        // Score: noise value + bonus for being deeper inland
        let noise_val = noise.get([x as f64 * 0.01, y as f64 * 0.01, 40000.0]); // Different seed than other monuments
        let inland_bonus = (shore_dist - min_shore_dist).min(30.0) / 30.0 * 0.3; // Bonus for deeper inland
        let score = noise_val + inland_bonus;
        
        if score > best_score {
            best_score = score;
            best_position = Some((x, y));
        }
    }
    
    if let Some((center_x, center_y)) = best_position {
        let tile_size_px = crate::TILE_SIZE_PX as f32;
        let center_world_x = (center_x as f32 + 0.5) * tile_size_px;
        let center_world_y = (center_y as f32 + 0.5) * tile_size_px;
        
        village_center = Some((center_world_x, center_world_y));
        
        log::info!("🏕️✨ PLACED HUNTING VILLAGE CENTER (lodge) at tile ({}, {}) = 📍 World Position: ({:.0}, {:.0}) ✨",
                   center_x, center_y, center_world_x, center_world_y);
        
        // =============================================================================
        // HUNTING VILLAGE LAYOUT (Improved spacing for visual clarity)
        // =============================================================================
        // The campfire is in the CENTER courtyard, surrounded by buildings.
        // The lodge is the center piece (for zone calculations), with huts forming
        // a protective semi-circle to the north. Drying rack placed with good separation.
        //
        // Layout (in local coords, negative Y = north):
        //
        //                    HUT3 (0, -550)                        <- FAR NORTH
        //     HUT1 (-580, -320)               HUT2 (+580, -320)    <- NW/NE flanks (spread wider)
        //     DRYING_RACK (-200, -350)                             <- MOVED UP for better spacing
        //                                     CAMPFIRE (+100, -250) <- CENTRAL COURTYARD
        //                                    
        //                    LODGE (0, 0)                          <- SOUTH (zone anchor)
        //
        // Structures are well-spaced to avoid visual overlap.
        // Tree ring cleared via 750px monument clearance check.
        // =============================================================================
        
        // Structure definitions: (part_type, image_name, offset_x, offset_y)
        let structure_configs: [(&str, &str, f32, f32); 6] = [
            // Main lodge - CENTER PIECE - the heart of the hunting village (zone anchor)
            ("lodge", "hv_lodge.png", -250.0, 0.0),
            
            // Hunting huts - arranged in a wider semi-circle to the north
            ("hut", "hv_hut2.png", 480.0, -320.0),   // Northeast flank (moved out)
            ("hut", "hv_hut3.png", 0.0, -550.0),     // Far north (pushed back for more space)
            
            // Campfire - in the central courtyard, offset to the east
            ("campfire", "fv_campfire.png", 100.0, -250.0),
            
            // Drying rack for pelts and meat - west side of courtyard, pushed further up
            ("hv_drying_rack", "hv_drying_rack.png", -200.0, -400.0),
            
            // Scarecrow - monument version by the crops (south of lodge, guards the farm)
            ("scarecrow", "scarecrow.png", 20.0, 250.0),
        ];
        
        for (part_type, image_name, offset_x, offset_y) in structure_configs.iter() {
            let part_world_x = center_world_x + offset_x;
            let part_world_y = center_world_y + offset_y;
            
            // Convert to tile coords for validation
            let part_tile_x = (part_world_x / tile_size_px) as i32;
            let part_tile_y = (part_world_y / tile_size_px) as i32;
            
            // Bounds check
            if part_tile_x < 5 || part_tile_y < 5 || 
               part_tile_x >= (width as i32 - 5) || part_tile_y >= (height as i32 - 5) {
                log::warn!("🏕️ {} out of bounds at tile ({}, {})", part_type, part_tile_x, part_tile_y);
                continue;
            }
            
            let px = part_tile_x as usize;
            let py = part_tile_y as usize;
            
            // Check terrain - must be on land, not water/river/lake
            let part_shore_dist = shore_distance[py][px];
            
            if part_shore_dist < 0.0 || river_network[py][px] || lake_map[py][px] {
                log::warn!("🏕️ {} terrain invalid: shore_dist={:.1}", part_type, part_shore_dist);
                continue;
            }
            
            // Place the structure!
            village_parts.push((part_world_x, part_world_y, image_name.to_string(), part_type.to_string()));
            
            log::info!("🏕️✨ PLACED {} ({}) at ({:.0}, {:.0}), offset=({:.0}, {:.0}) ✨",
                       part_type.to_uppercase(), image_name, part_world_x, part_world_y,
                       offset_x, offset_y);
        }
        
        log::info!("🏕️ Hunting village generation complete: {} total structures", village_parts.len());
    } else {
        log::warn!("🏕️ Failed to select hunting village position");
    }
    
    (village_center, village_parts)
}

// =============================================================================
// CRASHED RESEARCH DRONE MONUMENT
// =============================================================================

/// Generate crashed research drone monument in tundra biome
/// Returns (center_position, parts) where:
/// - center_position: Option<(x, y)> in world pixels for the drone center piece
/// - parts: Vec of (x, y, image_path, part_type) for the single drone structure
pub fn generate_crashed_research_drone(
    noise: &Perlin,
    shore_distance: &[Vec<f64>],
    river_network: &[Vec<bool>],
    lake_map: &[Vec<bool>],
    tundra_areas: &[Vec<bool>],
    hot_spring_centers: &[(f32, f32, i32)],
    shipwreck_centers: &[(f32, f32)],
    fishing_village_center: Option<(f32, f32)>,
    whale_bone_graveyard_center: Option<(f32, f32)>,
    hunting_village_center: Option<(f32, f32)>,
    large_quarry_centers: &[(f32, f32, i32)], // ADDED: Large quarry centers (x_tile, y_tile, radius)
    width: usize,
    height: usize,
) -> (Option<(f32, f32)>, Vec<(f32, f32, String, String)>) {
    let mut drone_center: Option<(f32, f32)> = None;
    let mut drone_parts: Vec<(f32, f32, String, String)> = Vec::new();
    
    log::info!("🛸 Generating crashed research drone monument in tundra biome...");
    
    // Find suitable tundra tiles - must be in TUNDRA biome, away from water and rivers
    let min_shore_dist = 10.0;  // At least 10 tiles from water
    let min_distance_from_edge = 30;
    let min_distance_from_shipwreck = 80.0; // Minimum tiles away from shipwreck
    let min_distance_from_fishing_village = 80.0; // Minimum tiles away from fishing village
    let min_distance_from_whale_graveyard = 80.0; // Minimum tiles away from whale graveyard
    let min_distance_from_hunting_village = 80.0; // Minimum tiles away from hunting village
    let min_distance_from_hot_spring = 50.0; // Minimum tiles away from hot springs
    let min_distance_from_large_quarry = 60.0; // ADDED: Minimum tiles away from large quarries
    let min_distance_from_river = 5; // Minimum tiles away from rivers
    
    let mut candidate_positions = Vec::new();
    
    // Search entire map for tundra tiles
    for y in min_distance_from_edge..(height - min_distance_from_edge) {
        for x in min_distance_from_edge..(width - min_distance_from_edge) {
            let shore_dist = shore_distance[y][x];
            
            // Must be inland and in tundra area
            if shore_dist >= min_shore_dist && tundra_areas[y][x] {
                // Must not be on river or lake
                if river_network[y][x] || lake_map[y][x] {
                    continue;
                }
                
                // Check if too close to a river (check surrounding tiles)
                let mut too_close_to_river = false;
                for check_dy in -(min_distance_from_river as i32)..=(min_distance_from_river as i32) {
                    for check_dx in -(min_distance_from_river as i32)..=(min_distance_from_river as i32) {
                        let check_x = x as i32 + check_dx;
                        let check_y = y as i32 + check_dy;
                        if check_x >= 0 && check_y >= 0 && 
                           (check_x as usize) < width && (check_y as usize) < height {
                            if river_network[check_y as usize][check_x as usize] {
                                too_close_to_river = true;
                                break;
                            }
                        }
                    }
                    if too_close_to_river { break; }
                }
                
                if too_close_to_river {
                    continue;
                }
                
                // Check distance from other monuments and special features
                let tile_world_x = (x as f32 + 0.5) * crate::TILE_SIZE_PX as f32;
                let tile_world_y = (y as f32 + 0.5) * crate::TILE_SIZE_PX as f32;
                
                let mut too_close = false;
                
                // Check distance from shipwreck
                for &(shipwreck_x, shipwreck_y) in shipwreck_centers {
                    let dx = tile_world_x - shipwreck_x;
                    let dy = tile_world_y - shipwreck_y;
                    let dist_tiles = (dx * dx + dy * dy).sqrt() / crate::TILE_SIZE_PX as f32;
                    if dist_tiles < min_distance_from_shipwreck {
                        too_close = true;
                        break;
                    }
                }
                
                // Check distance from hot springs
                if !too_close {
                    for &(hs_x, hs_y, hs_radius) in hot_spring_centers {
                        let dx = tile_world_x - hs_x;
                        let dy = tile_world_y - hs_y;
                        let dist_tiles = (dx * dx + dy * dy).sqrt() / crate::TILE_SIZE_PX as f32;
                        let min_dist = min_distance_from_hot_spring + hs_radius as f32;
                        if dist_tiles < min_dist {
                            too_close = true;
                            break;
                        }
                    }
                }
                
                // Check distance from fishing village
                if !too_close {
                    if let Some((fv_x, fv_y)) = fishing_village_center {
                        let dx = tile_world_x - fv_x;
                        let dy = tile_world_y - fv_y;
                        let dist_tiles = (dx * dx + dy * dy).sqrt() / crate::TILE_SIZE_PX as f32;
                        if dist_tiles < min_distance_from_fishing_village {
                            too_close = true;
                        }
                    }
                }
                
                // Check distance from whale bone graveyard
                if !too_close {
                    if let Some((wbg_x, wbg_y)) = whale_bone_graveyard_center {
                        let dx = tile_world_x - wbg_x;
                        let dy = tile_world_y - wbg_y;
                        let dist_tiles = (dx * dx + dy * dy).sqrt() / crate::TILE_SIZE_PX as f32;
                        if dist_tiles < min_distance_from_whale_graveyard {
                            too_close = true;
                        }
                    }
                }
                
                // Check distance from hunting village
                if !too_close {
                    if let Some((hv_x, hv_y)) = hunting_village_center {
                        let dx = tile_world_x - hv_x;
                        let dy = tile_world_y - hv_y;
                        let dist_tiles = (dx * dx + dy * dy).sqrt() / crate::TILE_SIZE_PX as f32;
                        if dist_tiles < min_distance_from_hunting_village {
                            too_close = true;
                        }
                    }
                }
                
                // ADDED: Check distance from large quarries (Stone/Sulfur/Metal)
                if !too_close {
                    for &(quarry_tile_x, quarry_tile_y, quarry_radius) in large_quarry_centers {
                        let quarry_world_x = (quarry_tile_x + 0.5) * crate::TILE_SIZE_PX as f32;
                        let quarry_world_y = (quarry_tile_y + 0.5) * crate::TILE_SIZE_PX as f32;
                        let dx = tile_world_x - quarry_world_x;
                        let dy = tile_world_y - quarry_world_y;
                        let dist_tiles = (dx * dx + dy * dy).sqrt() / crate::TILE_SIZE_PX as f32;
                        let min_dist = min_distance_from_large_quarry + quarry_radius as f32;
                        if dist_tiles < min_dist {
                            too_close = true;
                            break;
                        }
                    }
                }
                
                if too_close {
                    continue;
                }
                
                candidate_positions.push((x, y, shore_dist));
            }
        }
    }
    
    if candidate_positions.is_empty() {
        log::warn!("🛸 No valid tundra positions found for crashed research drone");
        return (drone_center, drone_parts);
    }
    
    log::info!("🛸 Found {} candidate positions for crashed research drone in tundra biome", 
               candidate_positions.len());
    
    // Select position using noise - prefer positions deeper in tundra
    let mut best_score = f64::NEG_INFINITY;
    let mut best_position: Option<(usize, usize)> = None;
    
    for &(x, y, shore_dist) in &candidate_positions {
        // Score: noise value + bonus for being deeper inland
        let noise_val = noise.get([x as f64 * 0.01, y as f64 * 0.01, 50000.0]); // Unique seed for this monument
        let inland_bonus = (shore_dist - min_shore_dist).min(20.0) / 20.0 * 0.3;
        let score = noise_val + inland_bonus;
        
        if score > best_score {
            best_score = score;
            best_position = Some((x, y));
        }
    }
    
    if let Some((center_x, center_y)) = best_position {
        let tile_size_px = crate::TILE_SIZE_PX as f32;
        let center_world_x = (center_x as f32 + 0.5) * tile_size_px;
        let center_world_y = (center_y as f32 + 0.5) * tile_size_px;
        
        drone_center = Some((center_world_x, center_world_y));
        
        log::info!("🛸✨ PLACED CRASHED RESEARCH DRONE at tile ({}, {}) = 📍 World Position: ({:.0}, {:.0}) ✨",
                   center_x, center_y, center_world_x, center_world_y);
        
        // =============================================================================
        // CRASHED RESEARCH DRONE LAYOUT
        // =============================================================================
        // Crashed drone structure with nearby researcher skeleton
        // Surrounded by loot (barrels, memory shards, sulfur piles, metal fragments)
        // spawned via separate functions after placement
        //
        // Layout (in local coords):
        //                    DRONE (0, 0) <- Center piece
        //        SKELETON (-180, 120) <- Dead researcher nearby
        // =============================================================================
        
        // Structure definitions: (part_type, image_name, offset_x, offset_y)
        let structure_configs: [(&str, &str, f32, f32); 1] = [
            // Crashed drone - CENTER PIECE
            ("drone", "cd_drone.png", 0.0, 0.0),
        ];
        
        for (part_type, image_name, offset_x, offset_y) in structure_configs.iter() {
            let part_world_x = center_world_x + offset_x;
            let part_world_y = center_world_y + offset_y;
            
            // Place the structure
            drone_parts.push((part_world_x, part_world_y, image_name.to_string(), part_type.to_string()));
            
            log::info!("🛸✨ PLACED {} ({}) at ({:.0}, {:.0}) ✨",
                       part_type.to_uppercase(), image_name, part_world_x, part_world_y);
        }
        
        log::info!("🛸 Crashed research drone generation complete: {} structures", drone_parts.len());
    } else {
        log::warn!("🛸 Failed to select crashed research drone position");
    }
    
    (drone_center, drone_parts)
}

/// Generate weather station monument in alpine biome (far north)
/// Returns (center_position, monument_parts) where:
/// - center_position: Option<(x, y)> in world pixels for the radar dish
/// - monument_parts: Vec of (x, y, image_path, part_type) for the single radar dish structure
pub fn generate_weather_station(
    noise: &Perlin,
    shore_distance: &[Vec<f64>],
    river_network: &[Vec<bool>],
    lake_map: &[Vec<bool>],
    alpine_areas: &[Vec<bool>],
    hot_spring_centers: &[(f32, f32, i32)],
    shipwreck_centers: &[(f32, f32)],
    fishing_village_center: Option<(f32, f32)>,
    whale_bone_graveyard_center: Option<(f32, f32)>,
    hunting_village_center: Option<(f32, f32)>,
    crashed_research_drone_center: Option<(f32, f32)>,
    large_quarry_centers: &[(f32, f32, i32)], // Large quarry centers (x_tile, y_tile, radius)
    width: usize,
    height: usize,
) -> (Option<(f32, f32)>, Vec<(f32, f32, String, String)>) {
    let mut station_center: Option<(f32, f32)> = None;
    let mut station_parts: Vec<(f32, f32, String, String)> = Vec::new();
    
    log::info!("📡 Generating weather station monument in alpine biome...");
    
    // Find suitable alpine tiles - must be in ALPINE biome, away from water and rivers
    let min_shore_dist = 15.0;  // At least 15 tiles from water (alpine is further inland)
    let min_distance_from_edge = 35;
    let min_distance_from_other_monuments = 80.0; // Minimum tiles away from other monuments
    let min_distance_from_hot_spring = 50.0; // Minimum tiles away from hot springs
    let min_distance_from_large_quarry = 50.0; // Minimum tiles away from large quarries (~2400px)
    let min_distance_from_river = 5; // Minimum tiles away from rivers
    
    let mut candidate_positions = Vec::new();
    
    // Search entire map for alpine tiles
    for y in min_distance_from_edge..(height - min_distance_from_edge) {
        for x in min_distance_from_edge..(width - min_distance_from_edge) {
            let shore_dist = shore_distance[y][x];
            
            // Must be inland and in alpine area
            if shore_dist >= min_shore_dist && alpine_areas[y][x] {
                // Must not be on river or lake
                if river_network[y][x] || lake_map[y][x] {
                    continue;
                }
                
                // Check if too close to a river (check surrounding tiles)
                let mut too_close_to_river = false;
                for check_dy in -(min_distance_from_river as i32)..=(min_distance_from_river as i32) {
                    for check_dx in -(min_distance_from_river as i32)..=(min_distance_from_river as i32) {
                        let check_x = x as i32 + check_dx;
                        let check_y = y as i32 + check_dy;
                        if check_x >= 0 && check_y >= 0 && 
                           (check_x as usize) < width && (check_y as usize) < height {
                            if river_network[check_y as usize][check_x as usize] {
                                too_close_to_river = true;
                                break;
                            }
                        }
                    }
                    if too_close_to_river { break; }
                }
                
                if too_close_to_river {
                    continue;
                }
                
                // Check distance from other monuments and special features
                let tile_world_x = (x as f32 + 0.5) * crate::TILE_SIZE_PX as f32;
                let tile_world_y = (y as f32 + 0.5) * crate::TILE_SIZE_PX as f32;
                
                let mut too_close = false;
                
                // Check distance from shipwreck
                for &(shipwreck_x, shipwreck_y) in shipwreck_centers {
                    let dx = tile_world_x - shipwreck_x;
                    let dy = tile_world_y - shipwreck_y;
                    let dist_tiles = (dx * dx + dy * dy).sqrt() / crate::TILE_SIZE_PX as f32;
                    if dist_tiles < min_distance_from_other_monuments {
                        too_close = true;
                        break;
                    }
                }
                
                // Check distance from hot springs
                if !too_close {
                    for &(hs_x, hs_y, hs_radius) in hot_spring_centers {
                        let dx = tile_world_x - hs_x;
                        let dy = tile_world_y - hs_y;
                        let dist_tiles = (dx * dx + dy * dy).sqrt() / crate::TILE_SIZE_PX as f32;
                        let min_dist = min_distance_from_hot_spring + hs_radius as f32;
                        if dist_tiles < min_dist {
                            too_close = true;
                            break;
                        }
                    }
                }
                
                // Check distance from fishing village
                if !too_close {
                    if let Some((fv_x, fv_y)) = fishing_village_center {
                        let dx = tile_world_x - fv_x;
                        let dy = tile_world_y - fv_y;
                        let dist_tiles = (dx * dx + dy * dy).sqrt() / crate::TILE_SIZE_PX as f32;
                        if dist_tiles < min_distance_from_other_monuments {
                            too_close = true;
                        }
                    }
                }
                
                // Check distance from whale bone graveyard
                if !too_close {
                    if let Some((wbg_x, wbg_y)) = whale_bone_graveyard_center {
                        let dx = tile_world_x - wbg_x;
                        let dy = tile_world_y - wbg_y;
                        let dist_tiles = (dx * dx + dy * dy).sqrt() / crate::TILE_SIZE_PX as f32;
                        if dist_tiles < min_distance_from_other_monuments {
                            too_close = true;
                        }
                    }
                }
                
                // Check distance from hunting village
                if !too_close {
                    if let Some((hv_x, hv_y)) = hunting_village_center {
                        let dx = tile_world_x - hv_x;
                        let dy = tile_world_y - hv_y;
                        let dist_tiles = (dx * dx + dy * dy).sqrt() / crate::TILE_SIZE_PX as f32;
                        if dist_tiles < min_distance_from_other_monuments {
                            too_close = true;
                        }
                    }
                }
                
                // Check distance from crashed research drone
                if !too_close {
                    if let Some((crd_x, crd_y)) = crashed_research_drone_center {
                        let dx = tile_world_x - crd_x;
                        let dy = tile_world_y - crd_y;
                        let dist_tiles = (dx * dx + dy * dy).sqrt() / crate::TILE_SIZE_PX as f32;
                        if dist_tiles < min_distance_from_other_monuments {
                            too_close = true;
                        }
                    }
                }
                
                // Check distance from large quarries (Stone/Sulfur/Metal)
                if !too_close {
                    for &(quarry_tile_x, quarry_tile_y, quarry_radius) in large_quarry_centers {
                        let quarry_world_x = (quarry_tile_x + 0.5) * crate::TILE_SIZE_PX as f32;
                        let quarry_world_y = (quarry_tile_y + 0.5) * crate::TILE_SIZE_PX as f32;
                        let dx = tile_world_x - quarry_world_x;
                        let dy = tile_world_y - quarry_world_y;
                        let dist_tiles = (dx * dx + dy * dy).sqrt() / crate::TILE_SIZE_PX as f32;
                        let min_dist = min_distance_from_large_quarry + quarry_radius as f32;
                        if dist_tiles < min_dist {
                            too_close = true;
                            break;
                        }
                    }
                }
                
                if too_close {
                    continue;
                }
                
                candidate_positions.push((x, y, shore_dist));
            }
        }
    }
    
    if candidate_positions.is_empty() {
        log::warn!("📡 No valid alpine positions found for weather station");
        return (station_center, station_parts);
    }
    
    log::info!("📡 Found {} candidate positions for weather station in alpine biome", 
               candidate_positions.len());
    
    // Select position using noise - prefer positions deeper in alpine
    let mut best_score = f64::NEG_INFINITY;
    let mut best_position: Option<(usize, usize)> = None;
    
    for &(x, y, shore_dist) in &candidate_positions {
        // Score: noise value + bonus for being deeper inland
        let noise_val = noise.get([x as f64 * 0.01, y as f64 * 0.01, 60000.0]); // Unique seed for weather station
        let inland_bonus = (shore_dist - min_shore_dist).min(25.0) / 25.0 * 0.35;
        let score = noise_val + inland_bonus;
        
        if score > best_score {
            best_score = score;
            best_position = Some((x, y));
        }
    }
    
    if let Some((center_x, center_y)) = best_position {
        let tile_size_px = crate::TILE_SIZE_PX as f32;
        let center_world_x = (center_x as f32 + 0.5) * tile_size_px;
        let center_world_y = (center_y as f32 + 0.5) * tile_size_px;
        
        station_center = Some((center_world_x, center_world_y));
        
        log::info!("📡✨ PLACED WEATHER STATION at tile ({}, {}) = 📍 World Position: ({:.0}, {:.0}) ✨",
                   center_x, center_y, center_world_x, center_world_y);
        
        // =============================================================================
        // WEATHER STATION LAYOUT
        // =============================================================================
        // Central operations building (ws_station.png) at origin.
        // Four radar dishes equidistant (1000px from center) at 0°, 90°, 180°, 270°.
        // Center scatter items ring the building at 220–380px so they're accessible.
        // =============================================================================
        
        // Central station building
        station_parts.push((center_world_x, center_world_y, "ws_station.png".to_string(), "station".to_string()));
        
        const RADAR_DISTANCE: f32 = 1000.0; // Distance from center to each radar
        
        // Four radars at cardinal directions (0° E, 90° S, 180° W, 270° N)
        for (i, (dx, dy)) in [(1.0, 0.0), (0.0, 1.0), (-1.0, 0.0), (0.0, -1.0)].iter().enumerate() {
            let part_world_x = center_world_x + dx * RADAR_DISTANCE;
            let part_world_y = center_world_y + dy * RADAR_DISTANCE;
            station_parts.push((part_world_x, part_world_y, "ws_radar.png".to_string(), "radar".to_string()));
            log::info!("📡✨ PLACED RADAR {} at ({:.0}, {:.0}) ✨",
                       i + 1, part_world_x, part_world_y);
        }
        
        log::info!("📡 Weather station generation complete: {} structures (1 station + 4 radars)", station_parts.len());
    } else {
        log::warn!("📡 Failed to select weather station position");
    }
    
    (station_center, station_parts)
}

// =============================================================================
// ALPINE VILLAGE MONUMENT
// =============================================================================

/// Generate alpine village monument in alpine biome
/// Single earth-sheltered lodge (av_lodge.png) with a visual campfire doodad (av_campfire.png).
/// Path and dirt center like hunting village. Overrun with grass (alpine grass zone).
/// Returns (center_position, monument_parts) where:
/// - center_position: Option<(x, y)> in world pixels for the lodge center
/// - monument_parts: Vec of (x, y, image_path, part_type) for alpine village structures
pub fn generate_alpine_village(
    noise: &Perlin,
    shore_distance: &[Vec<f64>],
    river_network: &[Vec<bool>],
    lake_map: &[Vec<bool>],
    quarry_dirt: &[Vec<bool>],
    alpine_areas: &[Vec<bool>],
    hot_spring_centers: &[(f32, f32, i32)],
    shipwreck_centers: &[(f32, f32)],
    fishing_village_center: Option<(f32, f32)>,
    whale_bone_graveyard_center: Option<(f32, f32)>,
    hunting_village_center: Option<(f32, f32)>,
    crashed_research_drone_center: Option<(f32, f32)>,
    weather_station_center: Option<(f32, f32)>,
    large_quarry_centers: &[(f32, f32, i32)],
    width: usize,
    height: usize,
) -> (Option<(f32, f32)>, Vec<(f32, f32, String, String)>) {
    let mut village_center: Option<(f32, f32)> = None;
    let mut village_parts: Vec<(f32, f32, String, String)> = Vec::new();
    
    log::info!("🏔️ Generating alpine village monument in alpine biome (northern zone)...");
    
    // Restrict to TOP 20% of map (northern alpine) - guarantees spawn in far north
    // Alpine = top 35% of map, so top 20% is deep in alpine band
    let northern_bound = height / 5; // Top 20% (y from 0 to height/5)
    
    let min_shore_dist = 10.0;  // Relaxed - northern coast can have inlets
    let min_distance_from_edge = 25;
    let min_distance_from_other_monuments = 60.0;  // Reduced from 80 - alpine band is narrower
    let min_distance_from_hot_spring = 40.0;
    let min_distance_from_large_quarry = 40.0;
    let min_distance_from_river = 5;
    
    let mut candidate_positions = Vec::new();
    
    // Search ONLY in northern alpine zone (top 20% of map)
    for y in min_distance_from_edge..northern_bound.min(height - min_distance_from_edge) {
        for x in min_distance_from_edge..(width - min_distance_from_edge) {
            let shore_dist = shore_distance[y][x];
            
            if shore_dist >= min_shore_dist && alpine_areas[y][x] {
                if river_network[y][x] || lake_map[y][x] {
                    continue;
                }

                if is_tile_near_quarry_dirt(quarry_dirt, x, y, VILLAGE_QUARRY_CLEARANCE_TILES) {
                    continue;
                }
                
                let mut too_close_to_river = false;
                for check_dy in -(min_distance_from_river as i32)..=(min_distance_from_river as i32) {
                    for check_dx in -(min_distance_from_river as i32)..=(min_distance_from_river as i32) {
                        let check_x = x as i32 + check_dx;
                        let check_y = y as i32 + check_dy;
                        if check_x >= 0 && check_y >= 0 &&
                           (check_x as usize) < width && (check_y as usize) < height {
                            if river_network[check_y as usize][check_x as usize] {
                                too_close_to_river = true;
                                break;
                            }
                        }
                    }
                    if too_close_to_river { break; }
                }
                
                if too_close_to_river {
                    continue;
                }
                
                let tile_world_x = (x as f32 + 0.5) * crate::TILE_SIZE_PX as f32;
                let tile_world_y = (y as f32 + 0.5) * crate::TILE_SIZE_PX as f32;
                
                let mut too_close = false;
                
                for &(sx, sy) in shipwreck_centers {
                    let dx = tile_world_x - sx;
                    let dy = tile_world_y - sy;
                    let dist_tiles = (dx * dx + dy * dy).sqrt() / crate::TILE_SIZE_PX as f32;
                    if dist_tiles < min_distance_from_other_monuments {
                        too_close = true;
                        break;
                    }
                }
                
                if !too_close {
                    if let Some((fv_x, fv_y)) = fishing_village_center {
                        let dx = tile_world_x - fv_x;
                        let dy = tile_world_y - fv_y;
                        let dist_tiles = (dx * dx + dy * dy).sqrt() / crate::TILE_SIZE_PX as f32;
                        if dist_tiles < min_distance_from_other_monuments {
                            too_close = true;
                        }
                    }
                }
                
                if !too_close {
                    if let Some((wbg_x, wbg_y)) = whale_bone_graveyard_center {
                        let dx = tile_world_x - wbg_x;
                        let dy = tile_world_y - wbg_y;
                        let dist_tiles = (dx * dx + dy * dy).sqrt() / crate::TILE_SIZE_PX as f32;
                        if dist_tiles < min_distance_from_other_monuments {
                            too_close = true;
                        }
                    }
                }
                
                if !too_close {
                    if let Some((hv_x, hv_y)) = hunting_village_center {
                        let dx = tile_world_x - hv_x;
                        let dy = tile_world_y - hv_y;
                        let dist_tiles = (dx * dx + dy * dy).sqrt() / crate::TILE_SIZE_PX as f32;
                        if dist_tiles < min_distance_from_other_monuments {
                            too_close = true;
                        }
                    }
                }
                
                if !too_close {
                    if let Some((crd_x, crd_y)) = crashed_research_drone_center {
                        let dx = tile_world_x - crd_x;
                        let dy = tile_world_y - crd_y;
                        let dist_tiles = (dx * dx + dy * dy).sqrt() / crate::TILE_SIZE_PX as f32;
                        if dist_tiles < min_distance_from_other_monuments {
                            too_close = true;
                        }
                    }
                }
                
                if !too_close {
                    if let Some((ws_x, ws_y)) = weather_station_center {
                        let dx = tile_world_x - ws_x;
                        let dy = tile_world_y - ws_y;
                        let dist_tiles = (dx * dx + dy * dy).sqrt() / crate::TILE_SIZE_PX as f32;
                        if dist_tiles < min_distance_from_other_monuments {
                            too_close = true;
                        }
                    }
                }
                
                if !too_close {
                    for &(hs_x, hs_y, hs_radius) in hot_spring_centers {
                        let dx = tile_world_x - hs_x;
                        let dy = tile_world_y - hs_y;
                        let dist_tiles = (dx * dx + dy * dy).sqrt() / crate::TILE_SIZE_PX as f32;
                        let min_dist = min_distance_from_hot_spring + hs_radius as f32;
                        if dist_tiles < min_dist {
                            too_close = true;
                            break;
                        }
                    }
                }
                
                if !too_close {
                    for &(qx, qy, qr) in large_quarry_centers {
                        let qw_x = (qx + 0.5) * crate::TILE_SIZE_PX as f32;
                        let qw_y = (qy + 0.5) * crate::TILE_SIZE_PX as f32;
                        let dx = tile_world_x - qw_x;
                        let dy = tile_world_y - qw_y;
                        let dist_tiles = (dx * dx + dy * dy).sqrt() / crate::TILE_SIZE_PX as f32;
                        let min_dist = min_distance_from_large_quarry + qr as f32;
                        if dist_tiles < min_dist {
                            too_close = true;
                            break;
                        }
                    }
                }
                
                if too_close {
                    continue;
                }
                
                candidate_positions.push((x, y, shore_dist));
            }
        }
    }
    
    if candidate_positions.is_empty() {
        log::warn!("🏔️ No valid alpine positions found for alpine village");
        return (village_center, village_parts);
    }
    
    log::info!("🏔️ Found {} candidate positions for alpine village in alpine biome",
               candidate_positions.len());
    
    let mut best_score = f64::NEG_INFINITY;
    let mut best_position: Option<(usize, usize)> = None;
    
    for &(x, y, shore_dist) in &candidate_positions {
        let noise_val = noise.get([x as f64 * 0.01, y as f64 * 0.01, 70000.0]);
        let inland_bonus = (shore_dist - min_shore_dist).min(25.0) / 25.0 * 0.35;
        let score = noise_val + inland_bonus;
        
        if score > best_score {
            best_score = score;
            best_position = Some((x, y));
        }
    }
    
    if let Some((center_x, center_y)) = best_position {
        let tile_size_px = crate::TILE_SIZE_PX as f32;
        let center_world_x = (center_x as f32 + 0.5) * tile_size_px;
        let center_world_y = (center_y as f32 + 0.5) * tile_size_px;
        
        village_center = Some((center_world_x, center_world_y));
        
        log::info!("🏔️✨ PLACED ALPINE VILLAGE (lodge) at tile ({}, {}) = 📍 World Position: ({:.0}, {:.0}) ✨",
                   center_x, center_y, center_world_x, center_world_y);
        
        // Alpine village doodads:
        // - Earth-sheltered lodge at center (is_center)
        // - av_hut and av_banya flanking campfire south of lodge (enclosed central area)
        // - Visual campfire south of lodge (no functional warmth/cooking logic)
        // - Scatter: av_drying_rack, av_weather_station_mast
        village_parts.push((center_world_x,            center_world_y,            "av_lodge.png".to_string(),             "lodge".to_string()));
        village_parts.push((center_world_x - 280.0,    center_world_y + 420.0,    "av_hut.png".to_string(),               "av_hut".to_string()));
        village_parts.push((center_world_x + 380.0,    center_world_y + 320.0,    "av_banya.png".to_string(),             "av_banya".to_string()));
        village_parts.push((center_world_x,            center_world_y + ALPINE_FIRE_OFFSET_Y, "av_campfire.png".to_string(), "campfire".to_string()));

        // Scatter decoratives
        village_parts.push((center_world_x - 480.0,    center_world_y - 120.0,    "av_drying_rack.png".to_string(),    "av_drying_rack".to_string()));
        village_parts.push((center_world_x + 280.0,    center_world_y - 480.0,    "av_weather_station_mast.png".to_string(), "av_weather_station_mast".to_string()));
        
        log::info!("🏔️ Alpine village generation complete: {} structures", village_parts.len());
    } else {
        log::warn!("🏔️ Failed to select alpine village position");
    }
    
    (village_center, village_parts)
}

/// Spawn barrels and memory shards at alpine village monument
pub fn spawn_alpine_village_all(
    ctx: &ReducerContext,
    center_x: f32,
    center_y: f32,
    part_positions: &[(f32, f32)],
) -> Result<(u32, u32), String> {
    let harvestable_configs = get_alpine_village_harvestables();
    // Include the actual fire-pit anchor so village loot cannot spawn on it.
    let mut occupied_positions: Vec<OccupiedPosition> = vec![OccupiedPosition {
        x: center_x, y: center_y + ALPINE_FIRE_OFFSET_Y - VILLAGE_FIRE_ANCHOR_Y, radius: 70.0,
    }];
    
    // Spawn memory shards (harvestables) with collision avoidance
    let harvestable_count = spawn_monument_harvestables_with_collision(
        ctx, part_positions, &harvestable_configs, &mut occupied_positions, true
    )?;
    
    // Spawn barrels with collision avoidance
    let barrel_count = spawn_alpine_village_barrels(ctx, center_x, center_y, &mut occupied_positions)?;
    
    log::info!("[AlpineVillageSpawn] Spawned {} memory shards, {} barrels", harvestable_count, barrel_count);
    
    Ok((harvestable_count, barrel_count))
}

/// Spawn barrels around alpine village lodge
fn spawn_alpine_village_barrels(
    ctx: &ReducerContext,
    center_x: f32,
    center_y: f32,
    occupied: &mut Vec<OccupiedPosition>,
) -> Result<u32, String> {
    use crate::barrel::{Barrel, BARREL_INITIAL_HEALTH};
    use crate::environment::calculate_chunk_index;
    use crate::barrel::{has_barrel_collision, has_player_barrel_collision};
    use rand::Rng;
    
    const BARREL_RADIUS: f32 = 35.0;
    
    let mut spawned_count = 0u32;
    let barrel_count = ctx.rng().gen_range(3..=5);
    
    for barrel_idx in 0..barrel_count {
        let mut attempts = 0;
        const MAX_ATTEMPTS: u32 = 25;
        
        while attempts < MAX_ATTEMPTS {
            attempts += 1;
            
            let base_angle = (barrel_idx as f32) * (2.0 * std::f32::consts::PI / barrel_count as f32);
            let angle = base_angle + ctx.rng().gen_range(-0.7..0.7);
            let distance = ctx.rng().gen_range(280.0..400.0);
            let barrel_x = center_x + angle.cos() * distance;
            let barrel_y = center_y + angle.sin() * distance;
            
            let tile_x = (barrel_x / crate::TILE_SIZE_PX as f32).floor() as i32;
            let tile_y = (barrel_y / crate::TILE_SIZE_PX as f32).floor() as i32;
            if let Some(tile_type) = crate::get_tile_type_at_position(ctx, tile_x, tile_y) {
                if tile_type.is_water() {
                    continue;
                }
            }
            
            if is_position_occupied(barrel_x, barrel_y, BARREL_RADIUS, occupied) {
                continue;
            }
            
            if has_barrel_collision(ctx, barrel_x, barrel_y, None) ||
               has_player_barrel_collision(ctx, barrel_x, barrel_y) {
                continue;
            }
            
            let variant = ctx.rng().gen_range(0..3);
            let chunk_idx = calculate_chunk_index(barrel_x, barrel_y);
            
            let new_barrel = Barrel {
                id: 0,
                pos_x: barrel_x,
                pos_y: barrel_y,
                chunk_index: chunk_idx,
                health: BARREL_INITIAL_HEALTH,
                variant,
                last_hit_time: None,
                respawn_at: Timestamp::UNIX_EPOCH,
                cluster_id: 0,
                is_monument: false,
            };
            
            ctx.db.barrel().insert(new_barrel);
            spawned_count += 1;
            
            occupied.push(OccupiedPosition {
                x: barrel_x,
                y: barrel_y,
                radius: BARREL_RADIUS,
            });
            
            break;
        }
    }
    
    Ok(spawned_count)
}

/// Alpine village harvestable configuration (memory shards - ancient memories)
pub fn get_alpine_village_harvestables() -> Vec<MonumentHarvestableConfig> {
    vec![
        MonumentHarvestableConfig {
            plant_type: crate::plants_database::PlantType::MemoryShard,
            spawn_chance: 0.85,
            min_distance: 80.0,
            max_distance: 180.0,
        },
        MonumentHarvestableConfig {
            plant_type: crate::plants_database::PlantType::MemoryShard,
            spawn_chance: 0.55,
            min_distance: 100.0,
            max_distance: 220.0,
        },
        MonumentHarvestableConfig {
            plant_type: crate::plants_database::PlantType::MemoryShard,
            spawn_chance: 0.35,
            min_distance: 120.0,
            max_distance: 250.0,
        },
    ]
}

/// Generate wolf den monuments in tundra biome (wolf pack spawn points)
/// Returns (center_positions, monument_parts) where:
/// - center_positions: Vec of (x, y) in world pixels for each wolf mound
/// - monument_parts: Vec of (x, y, image_path, part_type) for all wolf mound structures
/// NOTE: Spawns up to 2 wolf dens in the tundra, with minimum distance between them
pub fn generate_wolf_den(
    noise: &Perlin,
    shore_distance: &[Vec<f64>],
    river_network: &[Vec<bool>],
    lake_map: &[Vec<bool>],
    tundra_areas: &[Vec<bool>],
    hot_spring_centers: &[(f32, f32, i32)],
    shipwreck_centers: &[(f32, f32)],
    fishing_village_center: Option<(f32, f32)>,
    whale_bone_graveyard_center: Option<(f32, f32)>,
    hunting_village_center: Option<(f32, f32)>,
    crashed_research_drone_center: Option<(f32, f32)>,
    weather_station_center: Option<(f32, f32)>,
    alpine_village_center: Option<(f32, f32)>,
    large_quarry_centers: &[(f32, f32, i32)], // Large quarry centers (x_tile, y_tile, radius)
    width: usize,
    height: usize,
) -> (Vec<(f32, f32)>, Vec<(f32, f32, String, String)>) {
    let mut den_centers: Vec<(f32, f32)> = Vec::new();
    let mut den_parts: Vec<(f32, f32, String, String)> = Vec::new();
    
    const MAX_WOLF_DENS: usize = 2; // Allow up to 2 wolf dens
    const MIN_DISTANCE_BETWEEN_DENS: f32 = 80.0; // Minimum 80 tiles between wolf dens
    
    log::info!("🐺 Generating wolf den monuments in tundra biome (up to {})...", MAX_WOLF_DENS);
    
    // Find suitable tundra tiles - must be in TUNDRA biome, away from water and rivers
    let min_shore_dist = 12.0;  // At least 12 tiles from water
    let min_distance_from_edge = 30;
    let min_distance_from_other_monuments = 60.0; // Minimum tiles away from other monuments
    let min_distance_from_hot_spring = 40.0; // Minimum tiles away from hot springs
    let min_distance_from_large_quarry = 50.0; // Minimum tiles away from large quarries (~2400px)
    let min_distance_from_river = 5; // Minimum tiles away from rivers
    
    let mut candidate_positions = Vec::new();
    
    // Search entire map for tundra tiles
    for y in min_distance_from_edge..(height - min_distance_from_edge) {
        for x in min_distance_from_edge..(width - min_distance_from_edge) {
            let shore_dist = shore_distance[y][x];
            
            // Must be inland and in tundra area
            if shore_dist >= min_shore_dist && tundra_areas[y][x] {
                // Must not be on river or lake
                if river_network[y][x] || lake_map[y][x] {
                    continue;
                }
                
                // Check if too close to a river (check surrounding tiles)
                let mut too_close_to_river = false;
                for check_dy in -(min_distance_from_river as i32)..=(min_distance_from_river as i32) {
                    for check_dx in -(min_distance_from_river as i32)..=(min_distance_from_river as i32) {
                        let check_x = x as i32 + check_dx;
                        let check_y = y as i32 + check_dy;
                        if check_x >= 0 && check_y >= 0 && 
                           (check_x as usize) < width && (check_y as usize) < height {
                            if river_network[check_y as usize][check_x as usize] {
                                too_close_to_river = true;
                                break;
                            }
                        }
                    }
                    if too_close_to_river { break; }
                }
                
                if too_close_to_river {
                    continue;
                }
                
                // Check distance from other monuments and special features
                let tile_world_x = (x as f32 + 0.5) * crate::TILE_SIZE_PX as f32;
                let tile_world_y = (y as f32 + 0.5) * crate::TILE_SIZE_PX as f32;
                
                let mut too_close = false;
                
                // Check distance from shipwreck
                for &(shipwreck_x, shipwreck_y) in shipwreck_centers {
                    let dx = tile_world_x - shipwreck_x;
                    let dy = tile_world_y - shipwreck_y;
                    let dist_tiles = (dx * dx + dy * dy).sqrt() / crate::TILE_SIZE_PX as f32;
                    if dist_tiles < min_distance_from_other_monuments {
                        too_close = true;
                        break;
                    }
                }
                
                // Check distance from hot springs
                if !too_close {
                    for &(hs_x, hs_y, hs_radius) in hot_spring_centers {
                        let dx = tile_world_x - hs_x;
                        let dy = tile_world_y - hs_y;
                        let dist_tiles = (dx * dx + dy * dy).sqrt() / crate::TILE_SIZE_PX as f32;
                        let min_dist = min_distance_from_hot_spring + hs_radius as f32;
                        if dist_tiles < min_dist {
                            too_close = true;
                            break;
                        }
                    }
                }
                
                // Check distance from fishing village
                if !too_close {
                    if let Some((fv_x, fv_y)) = fishing_village_center {
                        let dx = tile_world_x - fv_x;
                        let dy = tile_world_y - fv_y;
                        let dist_tiles = (dx * dx + dy * dy).sqrt() / crate::TILE_SIZE_PX as f32;
                        if dist_tiles < min_distance_from_other_monuments {
                            too_close = true;
                        }
                    }
                }
                
                // Check distance from whale bone graveyard
                if !too_close {
                    if let Some((wbg_x, wbg_y)) = whale_bone_graveyard_center {
                        let dx = tile_world_x - wbg_x;
                        let dy = tile_world_y - wbg_y;
                        let dist_tiles = (dx * dx + dy * dy).sqrt() / crate::TILE_SIZE_PX as f32;
                        if dist_tiles < min_distance_from_other_monuments {
                            too_close = true;
                        }
                    }
                }
                
                // Check distance from hunting village
                if !too_close {
                    if let Some((hv_x, hv_y)) = hunting_village_center {
                        let dx = tile_world_x - hv_x;
                        let dy = tile_world_y - hv_y;
                        let dist_tiles = (dx * dx + dy * dy).sqrt() / crate::TILE_SIZE_PX as f32;
                        if dist_tiles < min_distance_from_other_monuments {
                            too_close = true;
                        }
                    }
                }
                
                // Check distance from crashed research drone
                if !too_close {
                    if let Some((crd_x, crd_y)) = crashed_research_drone_center {
                        let dx = tile_world_x - crd_x;
                        let dy = tile_world_y - crd_y;
                        let dist_tiles = (dx * dx + dy * dy).sqrt() / crate::TILE_SIZE_PX as f32;
                        if dist_tiles < min_distance_from_other_monuments {
                            too_close = true;
                        }
                    }
                }
                
                // Check distance from weather station
                if !too_close {
                    if let Some((ws_x, ws_y)) = weather_station_center {
                        let dx = tile_world_x - ws_x;
                        let dy = tile_world_y - ws_y;
                        let dist_tiles = (dx * dx + dy * dy).sqrt() / crate::TILE_SIZE_PX as f32;
                        if dist_tiles < min_distance_from_other_monuments {
                            too_close = true;
                        }
                    }
                }
                
                if !too_close {
                    if let Some((av_x, av_y)) = alpine_village_center {
                        let dx = tile_world_x - av_x;
                        let dy = tile_world_y - av_y;
                        let dist_tiles = (dx * dx + dy * dy).sqrt() / crate::TILE_SIZE_PX as f32;
                        if dist_tiles < min_distance_from_other_monuments {
                            too_close = true;
                        }
                    }
                }
                
                // Check distance from large quarries (Stone/Sulfur/Metal)
                if !too_close {
                    for &(quarry_tile_x, quarry_tile_y, quarry_radius) in large_quarry_centers {
                        let quarry_world_x = (quarry_tile_x + 0.5) * crate::TILE_SIZE_PX as f32;
                        let quarry_world_y = (quarry_tile_y + 0.5) * crate::TILE_SIZE_PX as f32;
                        let dx = tile_world_x - quarry_world_x;
                        let dy = tile_world_y - quarry_world_y;
                        let dist_tiles = (dx * dx + dy * dy).sqrt() / crate::TILE_SIZE_PX as f32;
                        let min_dist = min_distance_from_large_quarry + quarry_radius as f32;
                        if dist_tiles < min_dist {
                            too_close = true;
                            break;
                        }
                    }
                }
                
                if too_close {
                    continue;
                }
                
                candidate_positions.push((x, y, shore_dist));
            }
        }
    }
    
    if candidate_positions.is_empty() {
        log::warn!("🐺 No valid tundra positions found for wolf dens");
        return (den_centers, den_parts);
    }
    
    log::info!("🐺 Found {} candidate positions for wolf dens in tundra biome", 
               candidate_positions.len());
    
    // Score all candidate positions using noise - prefer positions deeper in tundra
    let mut scored_positions: Vec<((usize, usize), f64)> = candidate_positions.iter()
        .map(|&(x, y, shore_dist)| {
            let noise_val = noise.get([x as f64 * 0.01, y as f64 * 0.01, 70000.0]); // Unique seed for wolf den
            let inland_bonus = (shore_dist - min_shore_dist).min(20.0) / 20.0 * 0.3;
            let score = noise_val + inland_bonus;
            ((x, y), score)
        })
        .collect();
    
    // Sort by score (best first)
    scored_positions.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    
    let tile_size_px = crate::TILE_SIZE_PX as f32;
    
    // Select up to MAX_WOLF_DENS positions with minimum distance between them
    for ((center_x, center_y), _score) in scored_positions {
        if den_centers.len() >= MAX_WOLF_DENS {
            break;
        }
        
        let center_world_x = (center_x as f32 + 0.5) * tile_size_px;
        let center_world_y = (center_y as f32 + 0.5) * tile_size_px;
        
        // Check distance from already placed wolf dens
        let mut too_close_to_existing = false;
        for &(existing_x, existing_y) in &den_centers {
            let dx = center_world_x - existing_x;
            let dy = center_world_y - existing_y;
            let dist_tiles = (dx * dx + dy * dy).sqrt() / tile_size_px;
            if dist_tiles < MIN_DISTANCE_BETWEEN_DENS {
                too_close_to_existing = true;
                break;
            }
        }
        
        if too_close_to_existing {
            continue;
        }
        
        // Place this wolf den
        den_centers.push((center_world_x, center_world_y));
        
        log::info!("🐺✨ PLACED WOLF DEN #{} at tile ({}, {}) = 📍 World Position: ({:.0}, {:.0}) ✨",
                   den_centers.len(), center_x, center_y, center_world_x, center_world_y);
        
        // =============================================================================
        // WOLF DEN LAYOUT
        // =============================================================================
        // Single wolf mound structure - the den entrance
        // A pack of wolves will be spawned around this location during world generation
        //
        // Layout (in local coords):
        //                    MOUND (0, 0) <- Center piece
        // =============================================================================
        
        // Single structure: the wolf mound
        let part_type = "mound";
        let image_name = "wd_mound.png";
        
        let part_world_x = center_world_x;
        let part_world_y = center_world_y;
        
        // Place the structure
        den_parts.push((part_world_x, part_world_y, image_name.to_string(), part_type.to_string()));
        
        log::info!("🐺✨ PLACED {} ({}) at ({:.0}, {:.0}) ✨",
                   part_type.to_uppercase(), image_name, part_world_x, part_world_y);
    }
    
    if den_centers.is_empty() {
        log::warn!("🐺 Failed to place any wolf dens");
    } else {
        log::info!("🐺 Wolf den generation complete: {} dens, {} structures", den_centers.len(), den_parts.len());
    }
    
    (den_centers, den_parts)
}

// =============================================================================
// MONUMENT DECORATIONS (Flavor Items)
// =============================================================================

/// Configuration for what decorations spawn around a monument type
#[derive(Clone, Debug)]
pub struct MonumentDecorationConfig {
    /// Item name to spawn (must exist in item_definition table)
    pub item_name: String,
    /// Minimum quantity per spawn
    pub min_quantity: u32,
    /// Maximum quantity per spawn
    pub max_quantity: u32,
    /// Spawn chance per monument part (0.0 to 1.0)
    pub spawn_chance: f32,
    /// Minimum distance from monument part (pixels)
    pub min_distance: f32,
    /// Maximum distance from monument part (pixels)
    pub max_distance: f32,
}

/// Configuration for harvestable resources around monuments
#[derive(Clone, Debug)]
pub struct MonumentHarvestableConfig {
    /// Plant type to spawn
    pub plant_type: crate::plants_database::PlantType,
    /// Spawn chance per monument part (0.0 to 1.0)
    pub spawn_chance: f32,
    /// Minimum distance from monument part (pixels)
    pub min_distance: f32,
    /// Maximum distance from monument part (pixels)
    pub max_distance: f32,
}

/// Shipwreck-specific decoration configuration
/// Currently empty - shipwrecks use harvestable resources instead of one-time decorations
pub fn get_shipwreck_decorations() -> Vec<MonumentDecorationConfig> {
    vec![
        // Memory Shards are now spawned as harvestable resources (respawn!)
        // See get_shipwreck_harvestables() for Memory Shard spawning
    ]
}

/// Shipwreck-specific harvestable resource configuration
/// Spawns Beach Wood Piles and Memory Shards around shipwreck parts
pub fn get_shipwreck_harvestables() -> Vec<MonumentHarvestableConfig> {
    vec![
        // Beach Wood Pile - common, scattered around wreckage
        // Increased spawn chance and allow multiple spawns per part
        MonumentHarvestableConfig {
            plant_type: crate::plants_database::PlantType::BeachWoodPile,
            spawn_chance: 0.85, // 85% chance per part (increased from 60%)
            min_distance: 80.0,
            max_distance: 200.0,
        },
        // Second Beach Wood Pile spawn - additional chance for more driftwood
        MonumentHarvestableConfig {
            plant_type: crate::plants_database::PlantType::BeachWoodPile,
            spawn_chance: 0.50, // 50% chance for second pile per part
            min_distance: 100.0,
            max_distance: 250.0,
        },
        // Memory Shard - ancient tech debris washed up with the wreckage (RESPAWNS!)
        // Shipwrecks become reliable Memory Shard farming spots
        MonumentHarvestableConfig {
            plant_type: crate::plants_database::PlantType::MemoryShard,
            spawn_chance: 0.45, // 45% per part = ~3-4 shards per shipwreck
            min_distance: 60.0,
            max_distance: 180.0,
        },
        // Second Memory Shard spawn - bonus chance for extra shards
        MonumentHarvestableConfig {
            plant_type: crate::plants_database::PlantType::MemoryShard,
            spawn_chance: 0.25, // 25% chance for bonus spawn
            min_distance: 90.0,
            max_distance: 220.0,
        },
    ]
}

/// Whale Bone Graveyard-specific decoration configuration
/// Currently empty - whale bone graveyard uses harvestable resources instead
pub fn get_whale_bone_graveyard_decorations() -> Vec<MonumentDecorationConfig> {
    vec![
        // No one-time decorations - all resources respawn
    ]
}

/// Whale Bone Graveyard-specific harvestable resource configuration
/// Spawns Beach Wood Piles (driftwood) and Stone Piles (whale bones = bone meal) around bone parts
pub fn get_whale_bone_graveyard_harvestables() -> Vec<MonumentHarvestableConfig> {
    vec![
        // Bone Pile - whale bone fragments scattered throughout the graveyard
        // Primary source of bone fragments at this monument
        MonumentHarvestableConfig {
            plant_type: crate::plants_database::PlantType::BonePile,
            spawn_chance: 0.80, // 80% chance per part - abundant bone fragments
            min_distance: 50.0,
            max_distance: 160.0,
        },
        // Second Bone Pile spawn - more bone fragments
        MonumentHarvestableConfig {
            plant_type: crate::plants_database::PlantType::BonePile,
            spawn_chance: 0.50, // 50% chance for second pile
            min_distance: 70.0,
            max_distance: 180.0,
        },
        // Beach Wood Pile - driftwood scattered among the bones
        MonumentHarvestableConfig {
            plant_type: crate::plants_database::PlantType::BeachWoodPile,
            spawn_chance: 0.60, // 60% chance per part (reduced from 70%)
            min_distance: 60.0,
            max_distance: 180.0,
        },
        // Stone Pile - occasional stone debris
        MonumentHarvestableConfig {
            plant_type: crate::plants_database::PlantType::StonePile,
            spawn_chance: 0.35, // 35% per part (reduced from 50%)
            min_distance: 50.0,
            max_distance: 150.0,
        },
        // Memory Shard - mysterious ancient tech found among the bones
        // Perhaps the hermit has been collecting them?
        MonumentHarvestableConfig {
            plant_type: crate::plants_database::PlantType::MemoryShard,
            spawn_chance: 0.30, // 30% per part = ~2 shards per graveyard
            min_distance: 70.0,
            max_distance: 160.0,
        },
    ]
}

/// Spawns decorations around monument parts
/// Efficiently collects all positions first, then spawns items
pub fn spawn_monument_decorations(
    ctx: &ReducerContext,
    monument_part_positions: &[(f32, f32)],
    decoration_configs: &[MonumentDecorationConfig],
) -> Result<(), String> {
    if monument_part_positions.is_empty() {
        return Ok(()); // No parts, nothing to decorate
    }
    
    let item_defs = ctx.db.item_definition();
    let mut decorations_to_spawn: Vec<(f32, f32, u64, u32)> = Vec::new(); // (x, y, item_def_id, quantity)
    
    // Collect all decoration spawn positions
    for &(part_x, part_y) in monument_part_positions {
        for config in decoration_configs {
            // Roll for spawn chance
            let roll: f32 = ctx.rng().gen();
            if roll > config.spawn_chance {
                continue; // This decoration doesn't spawn for this part
            }
            
            // Find item definition
            let item_def_id = match item_defs.iter().find(|def| def.name == config.item_name) {
                Some(def) => def.id,
                None => {
                    log::warn!("[MonumentDecorations] Item '{}' not found in database, skipping", config.item_name);
                    continue;
                }
            };
            
            // Determine quantity
            let quantity = if config.min_quantity == config.max_quantity {
                config.min_quantity
            } else {
                ctx.rng().gen_range(config.min_quantity..=config.max_quantity)
            };
            
            // Calculate spawn position (random angle and distance from part)
            let angle = ctx.rng().gen_range(0.0..(2.0 * std::f32::consts::PI));
            let distance = ctx.rng().gen_range(config.min_distance..config.max_distance);
            let spawn_x = part_x + angle.cos() * distance;
            let spawn_y = part_y + angle.sin() * distance;
            
            decorations_to_spawn.push((spawn_x, spawn_y, item_def_id, quantity));
        }
    }
    
    log::info!("[MonumentDecorations] Collected {} decoration spawns around {} monument parts", 
               decorations_to_spawn.len(), monument_part_positions.len());
    
    // Spawn all collected decorations
    let mut spawned_count = 0;
    for (spawn_x, spawn_y, item_def_id, quantity) in decorations_to_spawn {
        match crate::dropped_item::create_dropped_item_entity(ctx, item_def_id, quantity, spawn_x, spawn_y) {
            Ok(_) => {
                spawned_count += 1;
                log::debug!("[MonumentDecorations] Spawned {}x item {} at ({:.1}, {:.1})", 
                           quantity, item_def_id, spawn_x, spawn_y);
            }
            Err(e) => {
                log::warn!("[MonumentDecorations] Failed to spawn decoration at ({:.1}, {:.1}): {}", 
                          spawn_x, spawn_y, e);
            }
        }
    }
    
    log::info!("[MonumentDecorations] Successfully spawned {} decorations", spawned_count);
    Ok(())
}

/// Spawns harvestable resources around monument parts
/// Efficiently collects all positions first, then spawns harvestable resources
/// Spawns harvestable resources around monument parts with collision avoidance
/// Takes a mutable list of occupied positions and adds spawned positions to it
/// `skip_biome_check` - if true, skips the beach/coastal tile check for resources like MemoryShard
///                      (used for inland monuments like Crashed Research Drone)
pub fn spawn_monument_harvestables_with_collision(
    ctx: &ReducerContext,
    monument_part_positions: &[(f32, f32)],
    harvestable_configs: &[MonumentHarvestableConfig],
    occupied_positions: &mut Vec<OccupiedPosition>,
    skip_biome_check: bool,
) -> Result<u32, String> {
    if monument_part_positions.is_empty() {
        return Ok(0); // No parts, nothing to spawn
    }
    
    let harvestable_resources = ctx.db.harvestable_resource();
    const HARVESTABLE_RADIUS: f32 = 30.0; // Collision radius for harvestable resources
    const MAX_PLACEMENT_ATTEMPTS: u32 = 10; // Max attempts to find non-colliding position
    
    let mut spawned_count = 0u32;
    
    // Process each monument part
    for &(part_x, part_y) in monument_part_positions {
        for config in harvestable_configs {
            // Roll for spawn chance
            let roll: f32 = ctx.rng().gen();
            if roll > config.spawn_chance {
                continue; // This harvestable doesn't spawn for this part
            }
            
            // Try multiple attempts to find a non-colliding position
            let mut spawn_x = 0.0;
            let mut spawn_y = 0.0;
            let mut found_position = false;
            
            for _attempt in 0..MAX_PLACEMENT_ATTEMPTS {
                // Calculate spawn position (random angle and distance from part)
                let angle = ctx.rng().gen_range(0.0..(2.0 * std::f32::consts::PI));
                let distance = ctx.rng().gen_range(config.min_distance..config.max_distance);
                spawn_x = part_x + angle.cos() * distance;
                spawn_y = part_y + angle.sin() * distance;
                
                // Check collision with occupied positions
                if !is_position_occupied(spawn_x, spawn_y, HARVESTABLE_RADIUS, occupied_positions) {
                    found_position = true;
                    break;
                }
            }
            
            if !found_position {
                log::debug!("[MonumentHarvestables] Could not find non-colliding position for {:?} after {} attempts", 
                           config.plant_type, MAX_PLACEMENT_ATTEMPTS);
                continue;
            }
            
            // Validate position: coastal resources must be on beach tiles
            // UNLESS skip_biome_check is true (for inland monuments like Crashed Research Drone)
            if !skip_biome_check {
                let is_coastal_resource = config.plant_type == crate::plants_database::PlantType::BeachWoodPile ||
                                           config.plant_type == crate::plants_database::PlantType::MemoryShard;
                if is_coastal_resource {
                    if !crate::environment::is_position_on_beach_tile(ctx, spawn_x, spawn_y) {
                        log::debug!("[MonumentHarvestables] Skipping {:?} at ({:.1}, {:.1}) - not on beach", config.plant_type, spawn_x, spawn_y);
                        continue;
                    }
                }
            }
            
            let chunk_idx = crate::environment::calculate_chunk_index(spawn_x, spawn_y);
            
            // Create harvestable resource
            let harvestable = crate::harvestable_resource::create_harvestable_resource(
                config.plant_type,
                spawn_x,
                spawn_y,
                chunk_idx,
                false // Mark as wild (not player-planted)
            );
            
            match harvestable_resources.try_insert(harvestable) {
                Ok(_inserted) => {
                    spawned_count += 1;
                    // Add to occupied positions
                    occupied_positions.push(OccupiedPosition {
                        x: spawn_x,
                        y: spawn_y,
                        radius: HARVESTABLE_RADIUS,
                    });
                    log::debug!("[MonumentHarvestables] Spawned {:?} at ({:.1}, {:.1})", 
                               config.plant_type, spawn_x, spawn_y);
                }
                Err(e) => {
                    log::warn!("[MonumentHarvestables] Failed to spawn {:?} at ({:.1}, {:.1}): {}", 
                              config.plant_type, spawn_x, spawn_y, e);
                }
            }
        }
    }
    
    log::info!("[MonumentHarvestables] Successfully spawned {} harvestable resources", spawned_count);
    Ok(spawned_count)
}

/// Legacy version without collision tracking - calls the new version with empty occupied list
/// Uses beach/biome check by default (for coastal monuments like shipwrecks)
pub fn spawn_monument_harvestables(
    ctx: &ReducerContext,
    monument_part_positions: &[(f32, f32)],
    harvestable_configs: &[MonumentHarvestableConfig],
) -> Result<(), String> {
    let mut occupied = Vec::new();
    spawn_monument_harvestables_with_collision(ctx, monument_part_positions, harvestable_configs, &mut occupied, false)?;
    Ok(())
}

/// Spawns hunting village harvestables in a dedicated garden grid south of the lodge.
/// Places crops/berries in a neat row or square grid so they don't overlap buildings.
/// Garden is positioned south of center (positive Y) - clear of lodge, huts, campfire, drying rack.
/// Scarecrow uses smaller exclusion (50) so crops can spawn around it - it's decorative, not a large building.
pub fn spawn_hunting_village_harvestables(
    ctx: &ReducerContext,
    center_x: f32,
    center_y: f32,
    monument_part_positions: &[(f32, f32, &str)],
    harvestable_configs: &[MonumentHarvestableConfig],
) -> Result<u32, String> {
    const HARVESTABLE_RADIUS: f32 = 30.0;
    const BUILDING_EXCLUSION_RADIUS: f32 = 220.0; // Keep harvestables away from building sprites
    const SCARECROW_EXCLUSION_RADIUS: f32 = 50.0; // Small - scarecrow is decorative, crops spawn around it
    const GRID_COLS: i32 = 4;
    const GRID_ROWS: i32 = 3;
    const GRID_SPACING: f32 = 56.0; // One tile between plants

    // Pre-populate occupied with all building positions so garden stays clear
    let mut occupied: Vec<OccupiedPosition> = monument_part_positions
        .iter()
        .map(|&(px, py, part_type)| {
            let radius = if part_type == "scarecrow" {
                SCARECROW_EXCLUSION_RADIUS
            } else {
                BUILDING_EXCLUSION_RADIUS
            };
            OccupiedPosition { x: px, y: py, radius }
        })
        .collect();

    // Garden center: south of the lodge (positive Y), offset slightly east for visual balance
    let garden_center_x = center_x + 20.0;
    let garden_center_y = center_y + 300.0;

    // Build grid positions (4 cols x 3 rows = 12 slots)
    let half_width = (GRID_COLS - 1) as f32 * GRID_SPACING * 0.5;
    let half_height = (GRID_ROWS - 1) as f32 * GRID_SPACING * 0.5;
    let start_x = garden_center_x - half_width;
    let start_y = garden_center_y - half_height;

    let harvestable_resources = ctx.db.harvestable_resource();
    let mut spawned_count = 0u32;

    for row in 0..GRID_ROWS {
        for col in 0..GRID_COLS {
            let spawn_x = start_x + col as f32 * GRID_SPACING;
            let spawn_y = start_y + row as f32 * GRID_SPACING;

            if is_position_occupied(spawn_x, spawn_y, HARVESTABLE_RADIUS, &occupied) {
                continue; // Slot too close to a building
            }

            // Pick first config that passes spawn_chance (shuffle order for variety)
            let mut config_indices: Vec<usize> = (0..harvestable_configs.len()).collect();
            for i in 1..config_indices.len() {
                let j = ctx.rng().gen_range(0..=i);
                config_indices.swap(i, j);
            }

            for &idx in &config_indices {
                let config = &harvestable_configs[idx];
                let roll: f32 = ctx.rng().gen();
                if roll > config.spawn_chance {
                    continue;
                }

                let chunk_idx = crate::environment::calculate_chunk_index(spawn_x, spawn_y);
                let harvestable = crate::harvestable_resource::create_harvestable_resource(
                    config.plant_type,
                    spawn_x,
                    spawn_y,
                    chunk_idx,
                    false, // wild
                );

                if harvestable_resources.try_insert(harvestable).is_ok() {
                    spawned_count += 1;
                    occupied.push(OccupiedPosition {
                        x: spawn_x,
                        y: spawn_y,
                        radius: HARVESTABLE_RADIUS,
                    });
                    break; // One harvestable per slot
                }
            }
        }
    }

    log::info!("[HuntingVillageGarden] Spawned {} harvestables in garden grid", spawned_count);
    Ok(spawned_count)
}

/// Spawns beach barrels around shipwreck monument parts
/// Uses barrel.rs system but spawns specifically around shipwreck locations
pub fn spawn_shipwreck_barrels(
    ctx: &ReducerContext,
    monument_part_positions: &[(f32, f32)],
) -> Result<(), String> {
    if monument_part_positions.is_empty() {
        return Ok(());
    }
    
    use crate::barrel::{Barrel, BARREL_INITIAL_HEALTH, SEA_BARREL_VARIANT_START, SEA_BARREL_VARIANT_END};
    use crate::environment::calculate_chunk_index;
    use crate::barrel::{has_barrel_collision, has_player_barrel_collision};
    use rand::Rng;
    
    let barrels = ctx.db.barrel();
    let mut spawned_count = 0;
    
    // Spawn 2-4 beach barrels per shipwreck part (70% chance per part - increased from 30%)
    for &(part_x, part_y) in monument_part_positions {
        let spawn_roll: f32 = ctx.rng().gen();
        if spawn_roll > 0.70 {
            continue; // 30% chance to skip this part (was 70%)
        }
        
        // Determine how many barrels (2-4) - increased from 1-2
        let barrel_count = if ctx.rng().gen::<f32>() < 0.4 {
            2 // 40% chance for 2 barrels
        } else if ctx.rng().gen::<f32>() < 0.8 {
            3 // 40% chance for 3 barrels
        } else {
            4 // 20% chance for 4 barrels
        };
        
        for barrel_idx in 0..barrel_count {
            let mut attempts = 0;
            const MAX_ATTEMPTS: u32 = 10;
            
            while attempts < MAX_ATTEMPTS {
                attempts += 1;
                
                // Generate position around the shipwreck part
                let angle = (barrel_idx as f32) * (2.0 * std::f32::consts::PI / barrel_count as f32) +
                           ctx.rng().gen_range(-0.5..0.5);
                let distance = ctx.rng().gen_range(150.0..350.0); // Further from parts than items
                let barrel_x = part_x + angle.cos() * distance;
                let barrel_y = part_y + angle.sin() * distance;
                
                // Validate position: must be on beach
                if !crate::environment::is_position_on_beach_tile(ctx, barrel_x, barrel_y) {
                    continue;
                }
                
                // Check collisions
                if has_barrel_collision(ctx, barrel_x, barrel_y, None) ||
                   has_player_barrel_collision(ctx, barrel_x, barrel_y) {
                    continue;
                }
                
                // Spawn beach barrel (sea variants 3, 4, 5)
                let variant = ctx.rng().gen_range(SEA_BARREL_VARIANT_START..SEA_BARREL_VARIANT_END);
                let chunk_idx = calculate_chunk_index(barrel_x, barrel_y);
                
                let new_barrel = Barrel {
                    id: 0,
                    pos_x: barrel_x,
                    pos_y: barrel_y,
                    chunk_index: chunk_idx,
                    health: BARREL_INITIAL_HEALTH,
                    variant,
                    last_hit_time: None,
                    respawn_at: Timestamp::UNIX_EPOCH, // 0 = not respawning
                    cluster_id: 0, // Individual spawns, not clusters
                    is_monument: false,
                };
                
                match barrels.try_insert(new_barrel) {
                    Ok(inserted_barrel) => {
                        spawned_count += 1;
                        log::info!("[ShipwreckBarrels] Spawned beach barrel #{} (variant {}) at ({:.1}, {:.1}) near shipwreck part",
                                  inserted_barrel.id, variant, barrel_x, barrel_y);
                        break; // Successfully spawned
                    }
                    Err(e) => {
                        log::warn!("[ShipwreckBarrels] Failed to insert barrel: {}", e);
                        // Continue to try another position
                    }
                }
            }
        }
    }
    
    log::info!("[ShipwreckBarrels] Spawned {} beach barrels around shipwreck monument", spawned_count);
    Ok(())
}

/// Spawns military rations around shipwreck monument parts
/// Spawns on ground (not water) around shipwreck parts
pub fn spawn_shipwreck_military_rations(
    ctx: &ReducerContext,
    monument_part_positions: &[(f32, f32)],
) -> Result<(), String> {
    if monument_part_positions.is_empty() {
        return Ok(());
    }
    
    use crate::environment::calculate_chunk_index;
    use crate::wooden_storage_box::{BOX_TYPE_MILITARY_RATION, wooden_storage_box as WoodenStorageBoxTableTrait};
    use rand::Rng;
    
    let mut spawned_count = 0;
    
    // Spawn max 1 military ration per shipwreck part (60% chance per part)
    for &(part_x, part_y) in monument_part_positions {
        let spawn_roll: f32 = ctx.rng().gen();
        if spawn_roll > 0.60 {
            continue; // 40% chance to skip this part
        }
        
        // Check if there's already a military ration near this shipwreck part (within 200px)
        let existing_boxes = ctx.db.wooden_storage_box();
        let mut has_existing_ration = false;
        for existing_box in existing_boxes.iter() {
            if existing_box.box_type == BOX_TYPE_MILITARY_RATION {
                let dx = part_x - existing_box.pos_x;
                let dy = part_y - existing_box.pos_y;
                if dx * dx + dy * dy < 200.0 * 200.0 { // 200px check for shipwreck part area
                    has_existing_ration = true;
                    break;
                }
            }
        }
        
        if has_existing_ration {
            continue; // Skip this part if there's already a ration nearby
        }
        
        // Try to spawn 1 military ration near this shipwreck part
        let mut attempts = 0;
        const MAX_ATTEMPTS: u32 = 10;
        
        while attempts < MAX_ATTEMPTS {
            attempts += 1;
            
            // Generate position around the shipwreck part
            let angle = ctx.rng().gen_range(0.0..std::f32::consts::PI * 2.0);
            let distance = ctx.rng().gen_range(100.0..250.0); // Distance from parts
            let ration_x = part_x + angle.cos() * distance;
            let ration_y = part_y + angle.sin() * distance;
            
            // Validate position: must be on ground (not water)
            // Check tile type at this position
            let tile_x = (ration_x / crate::TILE_SIZE_PX as f32).floor() as i32;
            let tile_y = (ration_y / crate::TILE_SIZE_PX as f32).floor() as i32;
            if let Some(tile_type) = crate::get_tile_type_at_position(ctx, tile_x, tile_y) {
                if tile_type.is_water() {
                    continue; // Skip water tiles
                }
            }
            
            // Check collision with existing barrels
            use crate::barrel::{has_barrel_collision, has_player_barrel_collision};
            if has_barrel_collision(ctx, ration_x, ration_y, None) ||
               has_player_barrel_collision(ctx, ration_x, ration_y) {
                continue;
            }
            
            // Check collision with existing military rations
            let existing_boxes = ctx.db.wooden_storage_box();
            let mut too_close = false;
            for existing_box in existing_boxes.iter() {
                if existing_box.box_type == BOX_TYPE_MILITARY_RATION {
                    let dx = ration_x - existing_box.pos_x;
                    let dy = ration_y - existing_box.pos_y;
                    if dx * dx + dy * dy < 100.0 * 100.0 { // 100px minimum distance
                        too_close = true;
                        break;
                    }
                }
            }
            
            if too_close {
                continue;
            }
            
            // Spawn military ration
            let chunk_idx = calculate_chunk_index(ration_x, ration_y);
            match crate::military_ration::spawn_military_ration_with_loot(ctx, ration_x, ration_y, chunk_idx) {
                Ok(_) => {
                    spawned_count += 1;
                    log::info!("[ShipwreckRations] Spawned military ration at ({:.1}, {:.1}) near shipwreck part",
                              ration_x, ration_y);
                    break; // Successfully spawned
                }
                Err(e) => {
                    log::warn!("[ShipwreckRations] Failed to spawn military ration: {}", e);
                    // Continue to try another position
                }
            }
        }
    }
    
    log::info!("[ShipwreckRations] Spawned {} military rations around shipwreck monument", spawned_count);
    Ok(())
}

/// Spawns beach barrels around whale bone graveyard monument parts
/// Uses barrel.rs system but spawns specifically around whale bone graveyard locations
pub fn spawn_whale_bone_graveyard_barrels(
    ctx: &ReducerContext,
    monument_part_positions: &[(f32, f32)],
    center_position: Option<(f32, f32)>,
) -> Result<(), String> {
    if monument_part_positions.is_empty() {
        return Ok(());
    }
    
    use crate::barrel::{Barrel, BARREL_INITIAL_HEALTH, SEA_BARREL_VARIANT_START, SEA_BARREL_VARIANT_END};
    use crate::environment::calculate_chunk_index;
    use crate::barrel::{has_barrel_collision, has_player_barrel_collision};
    use rand::Rng;
    
    let barrels = ctx.db.barrel();
    let mut spawned_count = 0;
    
    // Threshold to identify hermit hut (center piece) - within 10 pixels
    const HERMIT_HUT_THRESHOLD: f32 = 10.0;
    
    // Spawn 1-2 beach barrels per whale bone part (50% chance per part)
    for &(part_x, part_y) in monument_part_positions {
        let spawn_roll: f32 = ctx.rng().gen();
        if spawn_roll > 0.50 {
            continue; // 50% chance to skip this part
        }
        
        // Check if this is the hermit hut (center piece)
        let is_hermit_hut = if let Some((center_x, center_y)) = center_position {
            let dx = part_x - center_x;
            let dy = part_y - center_y;
            (dx * dx + dy * dy).sqrt() < HERMIT_HUT_THRESHOLD
        } else {
            false
        };
        
        // Use larger distance range for hermit hut to spawn barrels further away
        let (min_distance, max_distance) = if is_hermit_hut {
            (200.0, 450.0) // Further from hermit hut
        } else {
            (120.0, 300.0) // Normal distance for other parts
        };
        
        // Determine how many barrels (1-2)
        let barrel_count = if ctx.rng().gen::<f32>() < 0.5 {
            1 // 50% chance for 1 barrel
        } else {
            2 // 50% chance for 2 barrels
        };
        
        for barrel_idx in 0..barrel_count {
            let mut attempts = 0;
            const MAX_ATTEMPTS: u32 = 10;
            
            while attempts < MAX_ATTEMPTS {
                attempts += 1;
                
                // Generate position around the whale bone part
                let angle = (barrel_idx as f32) * (2.0 * std::f32::consts::PI / barrel_count as f32) +
                           ctx.rng().gen_range(-0.5..0.5);
                let distance = ctx.rng().gen_range(min_distance..max_distance);
                let barrel_x = part_x + angle.cos() * distance;
                let barrel_y = part_y + angle.sin() * distance;
                
                // Validate position: must be on beach
                if !crate::environment::is_position_on_beach_tile(ctx, barrel_x, barrel_y) {
                    continue;
                }
                
                // Check collisions
                if has_barrel_collision(ctx, barrel_x, barrel_y, None) ||
                   has_player_barrel_collision(ctx, barrel_x, barrel_y) {
                    continue;
                }
                
                // Spawn beach barrel (sea variants 3, 4, 5)
                let variant = ctx.rng().gen_range(SEA_BARREL_VARIANT_START..SEA_BARREL_VARIANT_END);
                let chunk_idx = calculate_chunk_index(barrel_x, barrel_y);
                
                let new_barrel = Barrel {
                    id: 0,
                    pos_x: barrel_x,
                    pos_y: barrel_y,
                    chunk_index: chunk_idx,
                    health: BARREL_INITIAL_HEALTH,
                    variant,
                    last_hit_time: None,
                    respawn_at: Timestamp::UNIX_EPOCH, // 0 = not respawning
                    cluster_id: 0, // Individual spawns, not clusters
                    is_monument: false,
                };
                
                match barrels.try_insert(new_barrel) {
                    Ok(inserted_barrel) => {
                        spawned_count += 1;
                        log::info!("[WhaleBoneGraveyardBarrels] Spawned beach barrel #{} (variant {}) at ({:.1}, {:.1})",
                                  inserted_barrel.id, variant, barrel_x, barrel_y);
                        break; // Successfully spawned
                    }
                    Err(e) => {
                        log::warn!("[WhaleBoneGraveyardBarrels] Failed to insert barrel: {}", e);
                    }
                }
            }
        }
    }
    
    log::info!("[WhaleBoneGraveyardBarrels] Spawned {} beach barrels around whale bone graveyard monument", spawned_count);
    Ok(())
}

/// Spawns military rations around whale bone graveyard monument parts
/// Fewer than shipwreck (40% chance vs 60%) - the hermit has already picked through most of them
pub fn spawn_whale_bone_graveyard_military_rations(
    ctx: &ReducerContext,
    monument_part_positions: &[(f32, f32)],
) -> Result<(), String> {
    if monument_part_positions.is_empty() {
        return Ok(());
    }
    
    use crate::environment::calculate_chunk_index;
    use crate::wooden_storage_box::{BOX_TYPE_MILITARY_RATION, wooden_storage_box as WoodenStorageBoxTableTrait};
    use rand::Rng;
    
    let mut spawned_count = 0;
    
    // Spawn max 1 military ration per part (40% chance per part - less than shipwreck)
    for &(part_x, part_y) in monument_part_positions {
        let spawn_roll: f32 = ctx.rng().gen();
        if spawn_roll > 0.40 {
            continue; // 60% chance to skip this part
        }
        
        // Check if there's already a military ration nearby (within 200px)
        let existing_boxes = ctx.db.wooden_storage_box();
        let mut has_existing_ration = false;
        for existing_box in existing_boxes.iter() {
            if existing_box.box_type == BOX_TYPE_MILITARY_RATION {
                let dx = part_x - existing_box.pos_x;
                let dy = part_y - existing_box.pos_y;
                if dx * dx + dy * dy < 200.0 * 200.0 {
                    has_existing_ration = true;
                    break;
                }
            }
        }
        
        if has_existing_ration {
            continue;
        }
        
        // Try to spawn 1 military ration near this part
        let mut attempts = 0;
        const MAX_ATTEMPTS: u32 = 10;
        
        while attempts < MAX_ATTEMPTS {
            attempts += 1;
            
            // Generate position around the part
            let angle = ctx.rng().gen_range(0.0..std::f32::consts::PI * 2.0);
            let distance = ctx.rng().gen_range(80.0..200.0);
            let ration_x = part_x + angle.cos() * distance;
            let ration_y = part_y + angle.sin() * distance;
            
            // Validate position: must be on ground (not water)
            let tile_x = (ration_x / crate::TILE_SIZE_PX as f32).floor() as i32;
            let tile_y = (ration_y / crate::TILE_SIZE_PX as f32).floor() as i32;
            if let Some(tile_type) = crate::get_tile_type_at_position(ctx, tile_x, tile_y) {
                if tile_type.is_water() {
                    continue;
                }
            }
            
            // Check collision with existing barrels
            use crate::barrel::{has_barrel_collision, has_player_barrel_collision};
            if has_barrel_collision(ctx, ration_x, ration_y, None) ||
               has_player_barrel_collision(ctx, ration_x, ration_y) {
                continue;
            }
            
            // Check collision with existing military rations
            let existing_boxes = ctx.db.wooden_storage_box();
            let mut too_close = false;
            for existing_box in existing_boxes.iter() {
                if existing_box.box_type == BOX_TYPE_MILITARY_RATION {
                    let dx = ration_x - existing_box.pos_x;
                    let dy = ration_y - existing_box.pos_y;
                    if dx * dx + dy * dy < 100.0 * 100.0 {
                        too_close = true;
                        break;
                    }
                }
            }
            
            if too_close {
                continue;
            }
            
            // Spawn military ration
            let chunk_idx = calculate_chunk_index(ration_x, ration_y);
            match crate::military_ration::spawn_military_ration_with_loot(ctx, ration_x, ration_y, chunk_idx) {
                Ok(_) => {
                    spawned_count += 1;
                    log::info!("[WhaleBoneGraveyardRations] Spawned military ration at ({:.1}, {:.1})",
                              ration_x, ration_y);
                    break;
                }
                Err(e) => {
                    log::warn!("[WhaleBoneGraveyardRations] Failed to spawn military ration: {}", e);
                }
            }
        }
    }
    
    log::info!("[WhaleBoneGraveyardRations] Spawned {} military rations around whale bone graveyard monument", spawned_count);
    Ok(())
}

/// Spawns barrels around crashed research drone monument with collision avoidance
/// Uses road barrel variants (0, 1, 2) since this is inland tundra
/// Takes a mutable list of occupied positions and adds spawned barrel positions to it
pub fn spawn_crashed_research_drone_barrels_with_collision(
    ctx: &ReducerContext,
    monument_part_positions: &[(f32, f32)],
    occupied_positions: &mut Vec<OccupiedPosition>,
) -> Result<u32, String> {
    if monument_part_positions.is_empty() {
        return Ok(0);
    }
    
    use crate::barrel::{Barrel, BARREL_INITIAL_HEALTH};
    use crate::environment::calculate_chunk_index;
    use crate::barrel::{has_barrel_collision, has_player_barrel_collision};
    use rand::Rng;
    
    const BARREL_RADIUS: f32 = 35.0; // Collision radius for barrels
    
    let barrels = ctx.db.barrel();
    let mut spawned_count = 0u32;
    
    // Spawn 2-4 barrels per drone part (high spawn rate for good loot)
    for &(part_x, part_y) in monument_part_positions {
        // Determine how many barrels (2-4)
        let barrel_count = ctx.rng().gen_range(2..=4);
        
        for barrel_idx in 0..barrel_count {
            let mut attempts = 0;
            const MAX_ATTEMPTS: u32 = 20; // Increased attempts due to more collision checks
            
            while attempts < MAX_ATTEMPTS {
                attempts += 1;
                
                // Generate position around the drone crash site
                let angle = (barrel_idx as f32) * (2.0 * std::f32::consts::PI / barrel_count as f32) +
                           ctx.rng().gen_range(-0.8..0.8);
                let distance = ctx.rng().gen_range(80.0..200.0);
                let barrel_x = part_x + angle.cos() * distance;
                let barrel_y = part_y + angle.sin() * distance;
                
                // Validate position: must not be on water
                let tile_x = (barrel_x / crate::TILE_SIZE_PX as f32).floor() as i32;
                let tile_y = (barrel_y / crate::TILE_SIZE_PX as f32).floor() as i32;
                if let Some(tile_type) = crate::get_tile_type_at_position(ctx, tile_x, tile_y) {
                    if tile_type.is_water() {
                        continue; // Skip water tiles
                    }
                }
                
                // Check collision with occupied positions (placeables, harvestables)
                if is_position_occupied(barrel_x, barrel_y, BARREL_RADIUS, occupied_positions) {
                    continue;
                }
                
                // Check collisions with existing barrels
                if has_barrel_collision(ctx, barrel_x, barrel_y, None) ||
                   has_player_barrel_collision(ctx, barrel_x, barrel_y) {
                    continue;
                }
                
                // Spawn road barrel (variants 0, 1, 2) since this is inland tundra
                let variant = ctx.rng().gen_range(0..3);
                let chunk_idx = calculate_chunk_index(barrel_x, barrel_y);
                
                let new_barrel = Barrel {
                    id: 0,
                    pos_x: barrel_x,
                    pos_y: barrel_y,
                    chunk_index: chunk_idx,
                    health: BARREL_INITIAL_HEALTH,
                    variant,
                    last_hit_time: None,
                    respawn_at: Timestamp::UNIX_EPOCH, // 0 = not respawning
                    cluster_id: 0, // Individual spawns, not clusters
                    is_monument: false,
                };
                
                match barrels.try_insert(new_barrel) {
                    Ok(inserted_barrel) => {
                        spawned_count += 1;
                        // Add to occupied positions
                        occupied_positions.push(OccupiedPosition {
                            x: barrel_x,
                            y: barrel_y,
                            radius: BARREL_RADIUS,
                        });
                        log::info!("[CrashedDroneBarrels] Spawned barrel #{} (variant {}) at ({:.1}, {:.1})",
                                  inserted_barrel.id, variant, barrel_x, barrel_y);
                        break; // Successfully spawned
                    }
                    Err(e) => {
                        log::warn!("[CrashedDroneBarrels] Failed to insert barrel: {}", e);
                    }
                }
            }
        }
    }
    
    log::info!("[CrashedDroneBarrels] Spawned {} barrels around crashed research drone monument", spawned_count);
    Ok(spawned_count)
}

/// Legacy version without collision tracking - calls the new version with empty occupied list
pub fn spawn_crashed_research_drone_barrels(
    ctx: &ReducerContext,
    monument_part_positions: &[(f32, f32)],
) -> Result<(), String> {
    let mut occupied = Vec::new();
    spawn_crashed_research_drone_barrels_with_collision(ctx, monument_part_positions, &mut occupied)?;
    Ok(())
}

/// Spawn additional barrels around weather station monument (supplements placeables)
/// Adds 2-4 scattered barrels in center for natural clutter - placeables handle the rest
pub fn spawn_weather_station_barrels(
    ctx: &ReducerContext,
    center_x: f32,
    center_y: f32,
) -> Result<u32, String> {
    use crate::barrel::{Barrel, BARREL_INITIAL_HEALTH};
    use crate::environment::calculate_chunk_index;
    use crate::barrel::{has_barrel_collision, has_player_barrel_collision};
    use rand::Rng;
    
    const BARREL_RADIUS: f32 = 35.0;
    
    let mut spawned_count = 0u32;
    let mut occupied_positions: Vec<OccupiedPosition> = Vec::new();
    
    // Spawn 2-4 extra barrels in center area for natural scatter (placeables handle most)
    let barrel_count = ctx.rng().gen_range(2..=4);
    
    for _ in 0..barrel_count {
        let mut attempts = 0;
        const MAX_ATTEMPTS: u32 = 20;
        
        while attempts < MAX_ATTEMPTS {
            attempts += 1;
            let angle = ctx.rng().gen_range(0.0..std::f32::consts::TAU);
            let distance = ctx.rng().gen_range(200.0..350.0);
            let barrel_x = center_x + angle.cos() * distance;
            let barrel_y = center_y + angle.sin() * distance;
            
            let tile_x = (barrel_x / crate::TILE_SIZE_PX as f32).floor() as i32;
            let tile_y = (barrel_y / crate::TILE_SIZE_PX as f32).floor() as i32;
            if let Some(tile_type) = crate::get_tile_type_at_position(ctx, tile_x, tile_y) {
                if tile_type.is_water() {
                    continue;
                }
            }
            
            if is_position_occupied(barrel_x, barrel_y, BARREL_RADIUS, &occupied_positions) {
                continue;
            }
            if has_barrel_collision(ctx, barrel_x, barrel_y, None) ||
               has_player_barrel_collision(ctx, barrel_x, barrel_y) {
                continue;
            }
            
            let variant = ctx.rng().gen_range(0..3);
            let chunk_idx = calculate_chunk_index(barrel_x, barrel_y);
            
            ctx.db.barrel().insert(Barrel {
                id: 0,
                pos_x: barrel_x,
                pos_y: barrel_y,
                chunk_index: chunk_idx,
                health: BARREL_INITIAL_HEALTH,
                variant,
                last_hit_time: None,
                respawn_at: Timestamp::UNIX_EPOCH,
                cluster_id: 0,
                is_monument: false,
            });
            spawned_count += 1;
            occupied_positions.push(OccupiedPosition { x: barrel_x, y: barrel_y, radius: BARREL_RADIUS });
            break;
        }
    }
    
    log::info!("[WeatherStationBarrels] Spawned {} extra barrels around weather station monument", spawned_count);
    Ok(spawned_count)
}

// Future monument decoration configs can be added here:
/*
/// Ruins-specific decoration configuration
pub fn get_ruins_decorations() -> Vec<MonumentDecorationConfig> {
    vec![
        MonumentDecorationConfig {
            item_name: "Memory Shard".to_string(),
            min_quantity: 1,
            max_quantity: 3,
            spawn_chance: 0.40,
            min_distance: 50.0,
            max_distance: 150.0,
        },
        // ... more ruins-specific items
    ]
}
*/

// Future monument generators can be added here:
/*
/// Generate ruins monument in north forest clearings
pub fn generate_ruins(
    noise: &Perlin,
    forest_areas: &[Vec<bool>],
    width: usize,
    height: usize,
) -> (Vec<(f32, f32)>, Vec<(f32, f32, String)>) {
    // ... ruins generation logic ...
}
*/

// =============================================================================
// MONUMENT CLEARANCE CHECKING
// =============================================================================

// Future monument type checkers can be added here:
/*
/// Checks if position is near any ruins monument
fn is_near_ruins(ctx: &ReducerContext, pos_x: f32, pos_y: f32) -> bool {
    let clearance_sq = clearance::RUINS * clearance::RUINS;
    
    for ruins in ctx.db.ruins_part().iter() {
        let dx = pos_x - ruins.world_x;
        let dy = pos_y - ruins.world_y;
        let dist_sq = dx * dx + dy * dy;
        
        if dist_sq < clearance_sq {
            return true;
        }
    }
    
    false
}

/// Checks if position is near any crash site monument
fn is_near_crash_site(ctx: &ReducerContext, pos_x: f32, pos_y: f32) -> bool {
    let clearance_sq = clearance::CRASH_SITE * clearance::CRASH_SITE;
    
    for crash_site in ctx.db.crash_site_part().iter() {
        let dx = pos_x - crash_site.world_x;
        let dy = pos_y - crash_site.world_y;
        let dist_sq = dx * dx + dy * dy;
        
        if dist_sq < clearance_sq {
            return true;
        }
    }
    
    false
}
*/

// =============================================================================
// MONUMENT PLACEABLES SYSTEM
// =============================================================================
// Monument placeables are permanent, indestructible containers (campfires, furnaces,
// rain collectors, etc.) that are spawned at safe zone monuments during world generation.
// These allow players to use crafting/processing stations in safe zones without
// needing to place their own structures.

use crate::campfire::{Campfire, CAMPFIRE_INITIAL_HEALTH, CAMPFIRE_MAX_HEALTH, INITIAL_CAMPFIRE_FUEL_AMOUNT};
use crate::furnace::{Furnace, FURNACE_INITIAL_HEALTH, FURNACE_MAX_HEALTH, INITIAL_FURNACE_FUEL_AMOUNT};
use crate::rain_collector::{RainCollector, RAIN_COLLECTOR_INITIAL_HEALTH, RAIN_COLLECTOR_MAX_HEALTH};
use crate::lantern::{Lantern, LANTERN_INITIAL_HEALTH, LANTERN_MAX_HEALTH};
use crate::wooden_storage_box::{
    WoodenStorageBox, BOX_TYPE_COOKING_STATION, BOX_TYPE_REPAIR_BENCH, BOX_TYPE_COMPOST,
    COOKING_STATION_INITIAL_HEALTH, COOKING_STATION_MAX_HEALTH,
    REPAIR_BENCH_INITIAL_HEALTH, REPAIR_BENCH_MAX_HEALTH,
    BOX_COLLISION_Y_OFFSET,
};
use crate::campfire::campfire as CampfireTableTrait;
use crate::furnace::furnace as FurnaceTableTrait;
use crate::rain_collector::rain_collector as RainCollectorTableTrait;
use crate::lantern::lantern as LanternTableTrait;
use crate::wooden_storage_box::wooden_storage_box as WoodenStorageBoxTableTrait;
use crate::turret::{Turret, TURRET_TYPE_TALLOW_STEAM, TURRET_INITIAL_HEALTH, TURRET_MAX_HEALTH};
use crate::turret::turret as TurretTableTrait;
use crate::environment::calculate_chunk_index;
use spacetimedb::Identity;

/// Types of placeables that can be spawned at monuments
#[derive(Clone, Debug, PartialEq)]
pub enum MonumentPlaceableType {
    Campfire,
    Furnace,
    LargeFurnace,
    RainCollector,
    Lantern,
    CookingStation,
    RepairBench,
    Compost,
    Barrel,
    MilitaryRation,
    Turret,
}

/// Configuration for a single monument placeable
#[derive(Clone, Debug)]
pub struct MonumentPlaceableConfig {
    /// Type of placeable to spawn
    pub placeable_type: MonumentPlaceableType,
    /// X offset from monument center (positive = east)
    pub offset_x: f32,
    /// Y offset from monument center (positive = south)
    pub offset_y: f32,
    /// Initial fuel amount for campfires/furnaces (None = use default)
    pub initial_fuel: Option<u32>,
}

impl MonumentPlaceableConfig {
    pub fn campfire(offset_x: f32, offset_y: f32) -> Self {
        Self {
            placeable_type: MonumentPlaceableType::Campfire,
            offset_x,
            offset_y,
            initial_fuel: Some(INITIAL_CAMPFIRE_FUEL_AMOUNT),
        }
    }
    
    pub fn furnace(offset_x: f32, offset_y: f32) -> Self {
        Self {
            placeable_type: MonumentPlaceableType::Furnace,
            offset_x,
            offset_y,
            initial_fuel: Some(INITIAL_FURNACE_FUEL_AMOUNT),
        }
    }
    
    pub fn large_furnace(offset_x: f32, offset_y: f32) -> Self {
        Self {
            placeable_type: MonumentPlaceableType::LargeFurnace,
            offset_x,
            offset_y,
            initial_fuel: Some(INITIAL_FURNACE_FUEL_AMOUNT),
        }
    }
    
    pub fn rain_collector(offset_x: f32, offset_y: f32) -> Self {
        Self {
            placeable_type: MonumentPlaceableType::RainCollector,
            offset_x,
            offset_y,
            initial_fuel: None,
        }
    }
    
    pub fn cooking_station(offset_x: f32, offset_y: f32) -> Self {
        Self {
            placeable_type: MonumentPlaceableType::CookingStation,
            offset_x,
            offset_y,
            initial_fuel: None,
        }
    }
    
    pub fn repair_bench(offset_x: f32, offset_y: f32) -> Self {
        Self {
            placeable_type: MonumentPlaceableType::RepairBench,
            offset_x,
            offset_y,
            initial_fuel: None,
        }
    }
    
    pub fn lantern(offset_x: f32, offset_y: f32) -> Self {
        Self {
            placeable_type: MonumentPlaceableType::Lantern,
            offset_x,
            offset_y,
            initial_fuel: None,
        }
    }
    
    pub fn compost(offset_x: f32, offset_y: f32) -> Self {
        Self {
            placeable_type: MonumentPlaceableType::Compost,
            offset_x,
            offset_y,
            initial_fuel: None,
        }
    }
    
    pub fn barrel(offset_x: f32, offset_y: f32) -> Self {
        Self {
            placeable_type: MonumentPlaceableType::Barrel,
            offset_x,
            offset_y,
            initial_fuel: None,
        }
    }
    
    pub fn military_ration(offset_x: f32, offset_y: f32) -> Self {
        Self {
            placeable_type: MonumentPlaceableType::MilitaryRation,
            offset_x,
            offset_y,
            initial_fuel: None,
        }
    }
    
    pub fn turret(offset_x: f32, offset_y: f32) -> Self {
        Self {
            placeable_type: MonumentPlaceableType::Turret,
            offset_x,
            offset_y,
            initial_fuel: None,
        }
    }
}

/// Get monument placeables for the Central ALK Compound
/// The central compound is at a fixed position in the world center
pub fn get_central_compound_placeables() -> Vec<MonumentPlaceableConfig> {
    vec![
        // Large furnace - replaces the warehouse in the northwest area of the compound
        // Position matches the old warehouse offset (-450, -300) from compound center
        MonumentPlaceableConfig::large_furnace(-450.0, -300.0),
        // Rain collector (water reservoir) - southwest area of compound
        MonumentPlaceableConfig::rain_collector(-450.0, 500.0),
        
        // === Monument Campfires (2 remaining after replacing center ones with buildings) ===
        // South-west: near the fuel depot
        MonumentPlaceableConfig::campfire(-200.0, 600.0),
        // South-east: opposite corner
        MonumentPlaceableConfig::campfire(200.0, 700.0),
        
        // === Monument Buildings (functional interactables at building positions) ===
        // ALK Food Processor (center-west) - cooking station inside the food processor building
        MonumentPlaceableConfig::cooking_station(-600.0, 50.0),
        // ALK Weapons Depot (center-east) - repair bench inside the weapons depot building
        MonumentPlaceableConfig::repair_bench(650.0, 0.0),
        // ALK Bio Processor (south-center) - compost facility
        MonumentPlaceableConfig::compost(0.0, 400.0),
        
        // === Monument Barrels (indestructible, scattered around compound) ===
        // Near garage (north-west) - stacked supplies
        MonumentPlaceableConfig::barrel(-500.0, -600.0),
        MonumentPlaceableConfig::barrel(-480.0, -550.0),
        MonumentPlaceableConfig::barrel(-250.0, -620.0),
        // Near shed (north-east) - stacked supplies
        MonumentPlaceableConfig::barrel(500.0, -600.0),
        MonumentPlaceableConfig::barrel(520.0, -550.0),
        // Barrel to left of shed removed
        // Along south wall - perimeter crates
        // Two barrels near rain collector removed
        MonumentPlaceableConfig::barrel(100.0, 830.0),
        MonumentPlaceableConfig::barrel(400.0, 820.0),
        // Near fuel depot
        MonumentPlaceableConfig::barrel(600.0, 500.0),
        MonumentPlaceableConfig::barrel(550.0, 300.0),
        // Near barracks
        MonumentPlaceableConfig::barrel(600.0, -200.0),
        MonumentPlaceableConfig::barrel(620.0, -450.0),
        // Near weapons depot (east) - barrel removed (was at 820.0, 100.0)
        // Center scatter - compound yard clutter
        MonumentPlaceableConfig::barrel(-150.0, 200.0),
        MonumentPlaceableConfig::barrel(180.0, -250.0),
        
        // === Military Rations (lootable crates, spread around) ===
        // Near the center - main supply cache
        MonumentPlaceableConfig::military_ration(50.0, -100.0),
        // Near barracks - officer's rations
        MonumentPlaceableConfig::military_ration(300.0, -400.0),
        // Near fuel depot - emergency supplies
        MonumentPlaceableConfig::military_ration(300.0, 500.0),
        // Near north-west garage area
        MonumentPlaceableConfig::military_ration(-350.0, -500.0),
        // Near south-east perimeter
        MonumentPlaceableConfig::military_ration(500.0, 650.0),
        
        // === Additional Campfires (north side of compound) ===
        // North-center campfire removed (was in front of warehouse)
        // North-west: near the garage area
        MonumentPlaceableConfig::campfire(-350.0, -500.0),
        // North-east: near the barracks area
        MonumentPlaceableConfig::campfire(400.0, -550.0),
        
        // === Additional Barrels (scattered, avoiding buildings) ===
        // North-center scatter
        MonumentPlaceableConfig::barrel(100.0, -480.0),
        MonumentPlaceableConfig::barrel(-50.0, -520.0),
        // East perimeter
        MonumentPlaceableConfig::barrel(750.0, 300.0),
        MonumentPlaceableConfig::barrel(700.0, -350.0),
        // West scatter - barrel near cooking station removed
        
        // === Monument Turrets (four corners of the compound asphalt square) ===
        // These are indestructible, infinite ammo, 2000px range turrets
        // that target PvP-enabled players and all wild animals with one-shot kill
        // NW corner
        MonumentPlaceableConfig::turret(-850.0, -850.0),
        // NE corner
        MonumentPlaceableConfig::turret(850.0, -850.0),
        // SW corner
        MonumentPlaceableConfig::turret(-850.0, 850.0),
        // SE corner
        MonumentPlaceableConfig::turret(850.0, 850.0),
    ]
}

/// Get monument placeables for the Shipwreck monument
pub fn get_shipwreck_placeables() -> Vec<MonumentPlaceableConfig> {
    vec![
        // Single campfire north of the main shipwreck part (hull1.png center)
        MonumentPlaceableConfig::campfire(0.0, -200.0),
    ]
}

/// Get monument placeables for the Fishing Village monument
/// Campfire is visual doodad (fv_campfire.png) with collision. Barrels placed away from campfire/buildings.
pub fn get_fishing_village_placeables() -> Vec<MonumentPlaceableConfig> {
    vec![
        // Barrels - perimeter positions, min 200px from campfire (0,0) and buildings
        // Huts at (-480,-500), (480,-500), (0,-700); fv_drying_rack at (-320,-200)
        MonumentPlaceableConfig::barrel(400.0, 120.0),   // East
        MonumentPlaceableConfig::barrel(-400.0, 120.0), // West
        MonumentPlaceableConfig::barrel(280.0, 280.0),  // East-south
        MonumentPlaceableConfig::barrel(-280.0, 280.0),// West-south
        MonumentPlaceableConfig::barrel(0.0, 420.0),    // South
    ]
}

/// Fishing village harvestables (memory shards) - min 200px from campfire and buildings
pub fn get_fishing_village_harvestables() -> Vec<MonumentHarvestableConfig> {
    vec![
        MonumentHarvestableConfig {
            plant_type: crate::plants_database::PlantType::MemoryShard,
            spawn_chance: 0.55,
            min_distance: 200.0,
            max_distance: 380.0,
        },
        MonumentHarvestableConfig {
            plant_type: crate::plants_database::PlantType::MemoryShard,
            spawn_chance: 0.35,
            min_distance: 220.0,
            max_distance: 400.0,
        },
    ]
}

/// Get monument placeables for the Whale Bone Graveyard monument
pub fn get_whale_bone_graveyard_placeables() -> Vec<MonumentPlaceableConfig> {
    vec![
        // Single campfire near the hermit's hut (which is now at center 0, 0)
        // Placed slightly in front and to the right of the hut for player access
        MonumentPlaceableConfig::campfire(80.0, 120.0),
    ]
}

/// Get monument placeables for the Hunting Village monument
/// Provides a functional campfire for cooking and warmth
pub fn get_hunting_village_placeables() -> Vec<MonumentPlaceableConfig> {
    vec![
        // No functional placeables - the campfire is a visual doodad (fv_campfire.png)
        // like Fishing Village. The visual campfire provides cozy effect via zone check.
        // If functional campfire is desired later, uncomment below:
        // MonumentPlaceableConfig::campfire(0.0, 250.0), // South of lodge
    ]
}

/// Get monument placeables for the Alpine Village monument
pub fn get_alpine_village_placeables() -> Vec<MonumentPlaceableConfig> {
    vec![] // Campfire is visual doodad with collision; no lanterns
}

/// Get monument placeables for the Weather Station monument
/// Center ring: campfires/barrels/rations orbit the ws_station building at 260–380px.
/// Around each of 4 radars (at ±1000px): barrels and military rations (unchanged).
pub fn get_weather_station_placeables() -> Vec<MonumentPlaceableConfig> {
    const R: f32 = 1000.0; // Radar distance from center
    vec![
        // --- Center ring (items circle the station building, keeping ≥250px clearance) ---
        // Campfires: NW, NE, S
        MonumentPlaceableConfig::campfire(-280.0, -180.0),
        MonumentPlaceableConfig::campfire( 260.0, -200.0),
        MonumentPlaceableConfig::campfire(  50.0,  310.0),
        // Barrels: spread across all quadrants at 280–380px
        MonumentPlaceableConfig::barrel(-320.0, -100.0),  // W
        MonumentPlaceableConfig::barrel( 310.0, -110.0),  // E
        MonumentPlaceableConfig::barrel(-210.0,  290.0),  // SW
        MonumentPlaceableConfig::barrel( 200.0,  270.0),  // SE
        MonumentPlaceableConfig::barrel(-350.0,  140.0),  // W-low
        MonumentPlaceableConfig::barrel( 340.0,  150.0),  // E-low
        MonumentPlaceableConfig::barrel(  50.0, -320.0),  // N
        // Military rations: diagonal quadrants
        MonumentPlaceableConfig::military_ration(-250.0, -260.0), // NW
        MonumentPlaceableConfig::military_ration( 240.0, -250.0), // NE
        MonumentPlaceableConfig::military_ration(-250.0,  240.0), // SW
        MonumentPlaceableConfig::military_ration( 240.0,  230.0), // SE
        MonumentPlaceableConfig::military_ration(   0.0,  360.0), // S
        // --- Around radar East (R, 0) ---
        MonumentPlaceableConfig::barrel(R + 60.0,   50.0),
        MonumentPlaceableConfig::barrel(R + 60.0,  -50.0),
        MonumentPlaceableConfig::military_ration(R + 30.0, 0.0),
        // --- Around radar South (0, R) ---
        MonumentPlaceableConfig::barrel(  50.0, R + 60.0),
        MonumentPlaceableConfig::barrel( -50.0, R + 60.0),
        MonumentPlaceableConfig::military_ration(0.0, R + 30.0),
        // --- Around radar West (-R, 0) ---
        MonumentPlaceableConfig::barrel(-R - 60.0,   50.0),
        MonumentPlaceableConfig::barrel(-R - 60.0,  -50.0),
        MonumentPlaceableConfig::military_ration(-R - 30.0, 0.0),
        // --- Around radar North (0, -R) ---
        MonumentPlaceableConfig::barrel(  50.0, -R - 60.0),
        MonumentPlaceableConfig::barrel( -50.0, -R - 60.0),
        MonumentPlaceableConfig::military_ration(0.0, -R - 30.0),
    ]
}

/// Get monument placeables for Hot Springs
/// A cozy campfire on the beach near the hot spring pool adds atmosphere
pub fn get_hot_spring_placeables() -> Vec<MonumentPlaceableConfig> {
    vec![
        // Single campfire on the beach, offset from the hot spring center
        // Hot springs have ~7-9 tile radius (336-432px), so we need 450+ px offset
        // to place the campfire on the beach outside the water pool
        MonumentPlaceableConfig::campfire(480.0, -100.0),
        // HTU loot set for hot spring village:
        // 1 barrel + 2 military rations (instead of 3 military rations)
        MonumentPlaceableConfig::barrel(350.0, -40.0),
        MonumentPlaceableConfig::military_ration(420.0, -180.0),
        MonumentPlaceableConfig::military_ration(520.0, -30.0),
    ]
}

/// Hunting Village-specific harvestable resource configuration
/// Spawns cold-hardy crops and northern berries appropriate for an Aleut hunting village.
/// Best 4 choices: Potato, Cabbage (staples), Lingonberries, Cloudberries (traditional forage).
pub fn get_hunting_village_harvestables() -> Vec<MonumentHarvestableConfig> {
    vec![
        // Potato - cold-hardy staple, historically grown in northern climates
        MonumentHarvestableConfig {
            plant_type: crate::plants_database::PlantType::Potato,
            spawn_chance: 0.55,
            min_distance: 60.0,
            max_distance: 180.0,
        },
        // Cabbage - cold-hardy leafy vegetable, excellent for northern climates
        MonumentHarvestableConfig {
            plant_type: crate::plants_database::PlantType::Cabbage,
            spawn_chance: 0.50,
            min_distance: 70.0,
            max_distance: 190.0,
        },
        // Lingonberries - native northern berry, traditional Aleut forage
        MonumentHarvestableConfig {
            plant_type: crate::plants_database::PlantType::Lingonberries,
            spawn_chance: 0.50,
            min_distance: 65.0,
            max_distance: 185.0,
        },
        // Cloudberries - northern berry, grows in boreal/tundra edges
        MonumentHarvestableConfig {
            plant_type: crate::plants_database::PlantType::Cloudberries,
            spawn_chance: 0.45,
            min_distance: 75.0,
            max_distance: 200.0,
        },
        // No wood piles in farm section - keep it natural with crops/berries only
    ]
}

/// Crashed Research Drone harvestable resource configuration
/// Spawns memory shards, sulfur piles, and metal ore piles around the crash site
pub fn get_crashed_research_drone_harvestables() -> Vec<MonumentHarvestableConfig> {
    vec![
        // Memory Shards - scattered tech debris from the drone (primary loot)
        MonumentHarvestableConfig {
            plant_type: crate::plants_database::PlantType::MemoryShard,
            spawn_chance: 0.90, // 90% chance - guaranteed tech loot
            min_distance: 60.0,
            max_distance: 150.0,
        },
        // Second Memory Shard spawn
        MonumentHarvestableConfig {
            plant_type: crate::plants_database::PlantType::MemoryShard,
            spawn_chance: 0.60, // 60% chance for bonus shard
            min_distance: 80.0,
            max_distance: 180.0,
        },
        // Third Memory Shard spawn
        MonumentHarvestableConfig {
            plant_type: crate::plants_database::PlantType::MemoryShard,
            spawn_chance: 0.40, // 40% chance for extra shard
            min_distance: 100.0,
            max_distance: 200.0,
        },
        // Sulfur Pile - fuel residue from the crash
        MonumentHarvestableConfig {
            plant_type: crate::plants_database::PlantType::SulfurPile,
            spawn_chance: 0.75, // 75% chance
            min_distance: 70.0,
            max_distance: 160.0,
        },
        // Second Sulfur Pile
        MonumentHarvestableConfig {
            plant_type: crate::plants_database::PlantType::SulfurPile,
            spawn_chance: 0.50, // 50% chance for bonus pile
            min_distance: 90.0,
            max_distance: 200.0,
        },
        // Metal Ore Pile - scattered drone components
        MonumentHarvestableConfig {
            plant_type: crate::plants_database::PlantType::MetalOrePile,
            spawn_chance: 0.80, // 80% chance
            min_distance: 60.0,
            max_distance: 150.0,
        },
        // Second Metal Ore Pile
        MonumentHarvestableConfig {
            plant_type: crate::plants_database::PlantType::MetalOrePile,
            spawn_chance: 0.55, // 55% chance for bonus pile
            min_distance: 80.0,
            max_distance: 180.0,
        },
    ]
}

/// Get monument placeables for the Crashed Research Drone monument
/// Abandoned survivor camp - someone tried to survive here before they disappeared...
/// NOT a safe zone, but has useful equipment left behind
pub fn get_crashed_research_drone_placeables() -> Vec<MonumentPlaceableConfig> {
    vec![
        // Abandoned campfire - left unlit, but still usable
        MonumentPlaceableConfig::campfire(-120.0, 150.0),
        
        // Furnace - the survivor was trying to smelt materials from the wreckage
        MonumentPlaceableConfig::furnace(140.0, 180.0),
        
        // Rain collector - water collection for survival (positioned far left to avoid drone image)
        MonumentPlaceableConfig::rain_collector(-320.0, -120.0),
        
        // Repair bench - they were trying to repair something from the drone (positioned far right to avoid drone image)
        MonumentPlaceableConfig::repair_bench(300.0, -140.0),
    ]
}

/// Calculate placeable world positions without spawning them
/// Used to pre-populate occupied positions list for collision avoidance
pub fn calculate_placeable_positions(
    monument_center_x: f32,
    monument_center_y: f32,
    configs: &[MonumentPlaceableConfig],
) -> Vec<OccupiedPosition> {
    const PLACEABLE_RADIUS: f32 = 45.0; // Collision radius for placeables
    
    configs.iter().map(|config| {
        OccupiedPosition {
            x: monument_center_x + config.offset_x,
            y: monument_center_y + config.offset_y,
            radius: PLACEABLE_RADIUS,
        }
    }).collect()
}

/// Coordinated spawn function for Crashed Research Drone monument
/// Spawns all entities (placeables, harvestables, barrels) with collision avoidance
/// This ensures no overlapping spawns at the monument
pub fn spawn_crashed_research_drone_all(
    ctx: &ReducerContext,
    center_x: f32,
    center_y: f32,
    part_positions: &[(f32, f32)],
) -> Result<(u32, u32, u32), String> {
    // Start with placeable positions as occupied (they're fixed, deterministic)
    let placeable_configs = get_crashed_research_drone_placeables();
    let mut occupied_positions = calculate_placeable_positions(center_x, center_y, &placeable_configs);
    
    log::info!("[CrashedDroneSpawn] Pre-marked {} placeable positions as occupied", occupied_positions.len());
    
    // Spawn harvestables, avoiding placeable positions
    // IMPORTANT: skip_biome_check = true because the drone is in tundra, not on a beach
    // This allows Memory Shards (normally coastal-only) to spawn at the inland crash site
    let harvestable_configs = get_crashed_research_drone_harvestables();
    let harvestable_count = spawn_monument_harvestables_with_collision(
        ctx, part_positions, &harvestable_configs, &mut occupied_positions, true // skip biome check
    )?;
    
    // Spawn barrels, avoiding placeables and harvestables
    let barrel_count = spawn_crashed_research_drone_barrels_with_collision(
        ctx, part_positions, &mut occupied_positions
    )?;
    
    // Finally spawn the actual placeables (they have fixed positions)
    let placeable_count = spawn_monument_placeables(
        ctx, "Crashed Research Drone", center_x, center_y, &placeable_configs
    )?;
    
    log::info!("[CrashedDroneSpawn] Completed spawning: {} placeables, {} harvestables, {} barrels (total {} occupied positions)",
               placeable_count, harvestable_count, barrel_count, occupied_positions.len());
    
    Ok((placeable_count, harvestable_count, barrel_count))
}

/// Spawn monument placeables at the given monument center position
/// Uses a sentinel identity for placed_by to indicate system-placed
pub fn spawn_monument_placeables(
    ctx: &ReducerContext,
    monument_name: &str,
    monument_center_x: f32,
    monument_center_y: f32,
    configs: &[MonumentPlaceableConfig],
) -> Result<u32, String> {
    let mut spawned_count = 0u32;
    let current_time = ctx.timestamp;
    
    // Use module identity as the "owner" of monument placeables
    let monument_owner = ctx.identity();
    
    for config in configs {
        let world_x = monument_center_x + config.offset_x;
        let world_y = monument_center_y + config.offset_y;
        let chunk_idx = calculate_chunk_index(world_x, world_y);
        
        match config.placeable_type {
            MonumentPlaceableType::Campfire => {
                let campfire = Campfire {
                    id: 0, // Auto-increment
                    pos_x: world_x,
                    pos_y: world_y + 42.0, // Same Y offset as player-placed
                    chunk_index: chunk_idx,
                    placed_by: monument_owner,
                    placed_at: current_time,
                    is_burning: false,
                    slot_instance_id_0: None, slot_def_id_0: None,
                    slot_instance_id_1: None, slot_def_id_1: None,
                    slot_instance_id_2: None, slot_def_id_2: None,
                    slot_instance_id_3: None, slot_def_id_3: None,
                    slot_instance_id_4: None, slot_def_id_4: None,
                    current_fuel_def_id: None,
                    remaining_fuel_burn_time_secs: None,
                    health: CAMPFIRE_INITIAL_HEALTH,
                    max_health: CAMPFIRE_MAX_HEALTH,
                    is_destroyed: false,
                    destroyed_at: None,
                    last_hit_time: None,
                    last_damaged_by: None,
                    slot_0_cooking_progress: None,
                    slot_1_cooking_progress: None,
                    slot_2_cooking_progress: None,
                    slot_3_cooking_progress: None,
                    slot_4_cooking_progress: None,
                    last_damage_application_time: None,
                    is_player_in_hot_zone: false,
                    attached_broth_pot_id: None,
                    // Mark as monument placeable
                    is_monument: true,
                    active_user_id: None,
                    active_user_since: None,
                };
                
                match ctx.db.campfire().try_insert(campfire) {
                    Ok(inserted) => {
                        spawned_count += 1;
                        log::info!("[MonumentPlaceables] Spawned monument campfire {} at ({:.1}, {:.1}) for {}", 
                            inserted.id, world_x, world_y, monument_name);
                    }
                    Err(e) => {
                        log::warn!("[MonumentPlaceables] Failed to spawn campfire at ({:.1}, {:.1}): {}", 
                            world_x, world_y, e);
                    }
                }
            }
            
            MonumentPlaceableType::Furnace => {
                let furnace = Furnace {
                    id: 0,
                    pos_x: world_x,
                    pos_y: world_y + 42.0, // Same Y offset as player-placed
                    chunk_index: chunk_idx,
                    placed_by: monument_owner,
                    placed_at: current_time,
                    is_burning: false,
                    furnace_type: crate::furnace::FURNACE_TYPE_NORMAL, // Monuments use normal furnaces
                    slot_instance_id_0: None, slot_def_id_0: None,
                    slot_instance_id_1: None, slot_def_id_1: None,
                    slot_instance_id_2: None, slot_def_id_2: None,
                    slot_instance_id_3: None, slot_def_id_3: None,
                    slot_instance_id_4: None, slot_def_id_4: None,
                    // Large furnace additional slots (5-17) - initialize to None
                    slot_instance_id_5: None, slot_def_id_5: None,
                    slot_instance_id_6: None, slot_def_id_6: None,
                    slot_instance_id_7: None, slot_def_id_7: None,
                    slot_instance_id_8: None, slot_def_id_8: None,
                    slot_instance_id_9: None, slot_def_id_9: None,
                    slot_instance_id_10: None, slot_def_id_10: None,
                    slot_instance_id_11: None, slot_def_id_11: None,
                    slot_instance_id_12: None, slot_def_id_12: None,
                    slot_instance_id_13: None, slot_def_id_13: None,
                    slot_instance_id_14: None, slot_def_id_14: None,
                    slot_instance_id_15: None, slot_def_id_15: None,
                    slot_instance_id_16: None, slot_def_id_16: None,
                    slot_instance_id_17: None, slot_def_id_17: None,
                    current_fuel_def_id: None,
                    remaining_fuel_burn_time_secs: None,
                    health: FURNACE_INITIAL_HEALTH,
                    max_health: FURNACE_MAX_HEALTH,
                    is_destroyed: false,
                    destroyed_at: None,
                    last_hit_time: None,
                    last_damaged_by: None,
                    slot_0_cooking_progress: None,
                    slot_1_cooking_progress: None,
                    slot_2_cooking_progress: None,
                    slot_3_cooking_progress: None,
                    slot_4_cooking_progress: None,
                    // Large furnace additional cooking progress slots (5-17) - initialize to None
                    slot_5_cooking_progress: None,
                    slot_6_cooking_progress: None,
                    slot_7_cooking_progress: None,
                    slot_8_cooking_progress: None,
                    slot_9_cooking_progress: None,
                    slot_10_cooking_progress: None,
                    slot_11_cooking_progress: None,
                    slot_12_cooking_progress: None,
                    slot_13_cooking_progress: None,
                    slot_14_cooking_progress: None,
                    slot_15_cooking_progress: None,
                    slot_16_cooking_progress: None,
                    slot_17_cooking_progress: None,
                    // Mark as monument placeable
                    is_monument: true,
                    active_user_id: None,
                    active_user_since: None,
                };
                
                match ctx.db.furnace().try_insert(furnace) {
                    Ok(inserted) => {
                        spawned_count += 1;
                        log::info!("[MonumentPlaceables] Spawned monument furnace {} at ({:.1}, {:.1}) for {}", 
                            inserted.id, world_x, world_y, monument_name);
                    }
                    Err(e) => {
                        log::warn!("[MonumentPlaceables] Failed to spawn furnace at ({:.1}, {:.1}): {}", 
                            world_x, world_y, e);
                    }
                }
            }
            
            MonumentPlaceableType::LargeFurnace => {
                // Large furnace Y offset: 128 (LARGE_FURNACE_HEIGHT/2) + 0 (LARGE_FURNACE_RENDER_Y_OFFSET)
                let large_furnace_adjusted_y = world_y + 128.0;
                let furnace = Furnace {
                    id: 0,
                    pos_x: world_x,
                    pos_y: large_furnace_adjusted_y,
                    chunk_index: chunk_idx,
                    placed_by: monument_owner,
                    placed_at: current_time,
                    is_burning: false,
                    furnace_type: crate::furnace::FURNACE_TYPE_LARGE,
                    slot_instance_id_0: None, slot_def_id_0: None,
                    slot_instance_id_1: None, slot_def_id_1: None,
                    slot_instance_id_2: None, slot_def_id_2: None,
                    slot_instance_id_3: None, slot_def_id_3: None,
                    slot_instance_id_4: None, slot_def_id_4: None,
                    slot_instance_id_5: None, slot_def_id_5: None,
                    slot_instance_id_6: None, slot_def_id_6: None,
                    slot_instance_id_7: None, slot_def_id_7: None,
                    slot_instance_id_8: None, slot_def_id_8: None,
                    slot_instance_id_9: None, slot_def_id_9: None,
                    slot_instance_id_10: None, slot_def_id_10: None,
                    slot_instance_id_11: None, slot_def_id_11: None,
                    slot_instance_id_12: None, slot_def_id_12: None,
                    slot_instance_id_13: None, slot_def_id_13: None,
                    slot_instance_id_14: None, slot_def_id_14: None,
                    slot_instance_id_15: None, slot_def_id_15: None,
                    slot_instance_id_16: None, slot_def_id_16: None,
                    slot_instance_id_17: None, slot_def_id_17: None,
                    current_fuel_def_id: None,
                    remaining_fuel_burn_time_secs: None,
                    health: FURNACE_INITIAL_HEALTH,
                    max_health: FURNACE_MAX_HEALTH,
                    is_destroyed: false,
                    destroyed_at: None,
                    last_hit_time: None,
                    last_damaged_by: None,
                    slot_0_cooking_progress: None,
                    slot_1_cooking_progress: None,
                    slot_2_cooking_progress: None,
                    slot_3_cooking_progress: None,
                    slot_4_cooking_progress: None,
                    slot_5_cooking_progress: None,
                    slot_6_cooking_progress: None,
                    slot_7_cooking_progress: None,
                    slot_8_cooking_progress: None,
                    slot_9_cooking_progress: None,
                    slot_10_cooking_progress: None,
                    slot_11_cooking_progress: None,
                    slot_12_cooking_progress: None,
                    slot_13_cooking_progress: None,
                    slot_14_cooking_progress: None,
                    slot_15_cooking_progress: None,
                    slot_16_cooking_progress: None,
                    slot_17_cooking_progress: None,
                    // Mark as monument placeable
                    is_monument: true,
                    active_user_id: None,
                    active_user_since: None,
                };
                
                match ctx.db.furnace().try_insert(furnace) {
                    Ok(inserted) => {
                        spawned_count += 1;
                        log::info!("[MonumentPlaceables] Spawned monument large furnace {} at ({:.1}, {:.1}) for {}", 
                            inserted.id, world_x, world_y, monument_name);
                    }
                    Err(e) => {
                        log::warn!("[MonumentPlaceables] Failed to spawn large furnace at ({:.1}, {:.1}): {}", 
                            world_x, world_y, e);
                    }
                }
            }
            
            MonumentPlaceableType::RainCollector => {
                let collector = RainCollector {
                    id: 0,
                    pos_x: world_x,
                    pos_y: world_y,
                    chunk_index: chunk_idx,
                    placed_by: monument_owner,
                    placed_at: current_time,
                    slot_0_instance_id: None,
                    slot_0_def_id: None,
                    health: RAIN_COLLECTOR_INITIAL_HEALTH,
                    max_health: RAIN_COLLECTOR_MAX_HEALTH,
                    is_destroyed: false,
                    destroyed_at: None,
                    last_hit_time: None,
                    last_damaged_by: None,
                    total_water_collected: 0.0,
                    last_collection_time: None,
                    is_salt_water: false,
                    // Mark as monument placeable
                    is_monument: true,
                    active_user_id: None,
                    active_user_since: None,
                };
                
                match ctx.db.rain_collector().try_insert(collector) {
                    Ok(inserted) => {
                        spawned_count += 1;
                        log::info!("[MonumentPlaceables] Spawned monument rain collector {} at ({:.1}, {:.1}) for {}", 
                            inserted.id, world_x, world_y, monument_name);
                    }
                    Err(e) => {
                        log::warn!("[MonumentPlaceables] Failed to spawn rain collector at ({:.1}, {:.1}): {}", 
                            world_x, world_y, e);
                    }
                }
            }
            
            MonumentPlaceableType::Lantern => {
                let lantern = Lantern {
                    id: 0, // Auto-increment
                    pos_x: world_x,
                    pos_y: world_y + 32.0, // Same Y offset as player-placed
                    chunk_index: chunk_idx,
                    placed_by: monument_owner,
                    placed_at: current_time,
                    is_burning: false,
                    fuel_instance_id_0: None,
                    fuel_def_id_0: None,
                    current_fuel_def_id: None,
                    remaining_fuel_burn_time_secs: None,
                    health: LANTERN_INITIAL_HEALTH,
                    max_health: LANTERN_MAX_HEALTH,
                    is_destroyed: false,
                    destroyed_at: None,
                    last_hit_time: None,
                    last_damaged_by: None,
                    is_monument: true, // Mark as monument placeable
                    lantern_type: 0, // Regular lantern (not a ward)
                };
                
                match ctx.db.lantern().try_insert(lantern) {
                    Ok(inserted) => {
                        spawned_count += 1;
                        log::info!("[MonumentPlaceables] Spawned monument lantern {} at ({:.1}, {:.1}) for {}", 
                            inserted.id, world_x, world_y, monument_name);
                    }
                    Err(e) => {
                        log::warn!("[MonumentPlaceables] Failed to spawn lantern at ({:.1}, {:.1}): {}", 
                            world_x, world_y, e);
                    }
                }
            }
            
            MonumentPlaceableType::CookingStation => {
                let cooking_station = WoodenStorageBox {
                    id: 0,
                    pos_x: world_x,
                    pos_y: world_y + BOX_COLLISION_Y_OFFSET,
                    chunk_index: chunk_idx,
                    placed_by: monument_owner,
                    box_type: BOX_TYPE_COOKING_STATION,
                    slot_instance_id_0: None, slot_def_id_0: None,
                    slot_instance_id_1: None, slot_def_id_1: None,
                    slot_instance_id_2: None, slot_def_id_2: None,
                    slot_instance_id_3: None, slot_def_id_3: None,
                    slot_instance_id_4: None, slot_def_id_4: None,
                    slot_instance_id_5: None, slot_def_id_5: None,
                    slot_instance_id_6: None, slot_def_id_6: None,
                    slot_instance_id_7: None, slot_def_id_7: None,
                    slot_instance_id_8: None, slot_def_id_8: None,
                    slot_instance_id_9: None, slot_def_id_9: None,
                    slot_instance_id_10: None, slot_def_id_10: None,
                    slot_instance_id_11: None, slot_def_id_11: None,
                    slot_instance_id_12: None, slot_def_id_12: None,
                    slot_instance_id_13: None, slot_def_id_13: None,
                    slot_instance_id_14: None, slot_def_id_14: None,
                    slot_instance_id_15: None, slot_def_id_15: None,
                    slot_instance_id_16: None, slot_def_id_16: None,
                    slot_instance_id_17: None, slot_def_id_17: None,
                    slot_instance_id_18: None, slot_def_id_18: None,
                    slot_instance_id_19: None, slot_def_id_19: None,
                    slot_instance_id_20: None, slot_def_id_20: None,
                    slot_instance_id_21: None, slot_def_id_21: None,
                    slot_instance_id_22: None, slot_def_id_22: None,
                    slot_instance_id_23: None, slot_def_id_23: None,
                    slot_instance_id_24: None, slot_def_id_24: None,
                    slot_instance_id_25: None, slot_def_id_25: None,
                    slot_instance_id_26: None, slot_def_id_26: None,
                    slot_instance_id_27: None, slot_def_id_27: None,
                    slot_instance_id_28: None, slot_def_id_28: None,
                    slot_instance_id_29: None, slot_def_id_29: None,
                    slot_instance_id_30: None, slot_def_id_30: None,
                    slot_instance_id_31: None, slot_def_id_31: None,
                    slot_instance_id_32: None, slot_def_id_32: None,
                    slot_instance_id_33: None, slot_def_id_33: None,
                    slot_instance_id_34: None, slot_def_id_34: None,
                    slot_instance_id_35: None, slot_def_id_35: None,
                    slot_instance_id_36: None, slot_def_id_36: None,
                    slot_instance_id_37: None, slot_def_id_37: None,
                    slot_instance_id_38: None, slot_def_id_38: None,
                    slot_instance_id_39: None, slot_def_id_39: None,
                    slot_instance_id_40: None, slot_def_id_40: None,
                    slot_instance_id_41: None, slot_def_id_41: None,
                    slot_instance_id_42: None, slot_def_id_42: None,
                    slot_instance_id_43: None, slot_def_id_43: None,
                    slot_instance_id_44: None, slot_def_id_44: None,
                    slot_instance_id_45: None, slot_def_id_45: None,
                    slot_instance_id_46: None, slot_def_id_46: None,
                    slot_instance_id_47: None, slot_def_id_47: None,
                    health: COOKING_STATION_INITIAL_HEALTH,
                    max_health: COOKING_STATION_MAX_HEALTH,
                    is_destroyed: false,
                    destroyed_at: None,
                    last_hit_time: None,
                    last_damaged_by: None,
                    respawn_at: Timestamp::UNIX_EPOCH, // 0 = not respawning (monument placeables don't respawn)
                    // Mark as monument placeable
                    is_monument: true,
                    active_user_id: None,
                    active_user_since: None,
                };
                
                match ctx.db.wooden_storage_box().try_insert(cooking_station) {
                    Ok(inserted) => {
                        spawned_count += 1;
                        log::info!("[MonumentPlaceables] Spawned monument cooking station {} at ({:.1}, {:.1}) for {}", 
                            inserted.id, world_x, world_y, monument_name);
                    }
                    Err(e) => {
                        log::warn!("[MonumentPlaceables] Failed to spawn cooking station at ({:.1}, {:.1}): {}", 
                            world_x, world_y, e);
                    }
                }
            }
            
            MonumentPlaceableType::Barrel => {
                use crate::barrel::{Barrel, BARREL_INITIAL_HEALTH};
                
                let barrel = Barrel {
                    id: 0,
                    pos_x: world_x,
                    pos_y: world_y,
                    chunk_index: chunk_idx,
                    health: BARREL_INITIAL_HEALTH,
                    variant: ctx.rng().gen_range(0..3), // Random road barrel variant (0, 1, 2)
                    last_hit_time: None,
                    respawn_at: Timestamp::UNIX_EPOCH, // 0 = not respawning
                    cluster_id: 0,
                    is_monument: true, // Monument barrels are indestructible
                };
                
                match ctx.db.barrel().try_insert(barrel) {
                    Ok(inserted) => {
                        spawned_count += 1;
                        log::info!("[MonumentPlaceables] Spawned monument barrel {} at ({:.1}, {:.1}) for {}", 
                            inserted.id, world_x, world_y, monument_name);
                    }
                    Err(e) => {
                        log::warn!("[MonumentPlaceables] Failed to spawn monument barrel at ({:.1}, {:.1}): {}", 
                            world_x, world_y, e);
                    }
                }
            }
            
            MonumentPlaceableType::MilitaryRation => {
                match crate::military_ration::spawn_military_ration_with_loot(ctx, world_x, world_y, chunk_idx) {
                    Ok(box_id) => {
                        // Mark the spawned ration as a monument (indestructible but lootable)
                        if let Some(mut ration_box) = ctx.db.wooden_storage_box().id().find(box_id) {
                            ration_box.is_monument = true;
                            ctx.db.wooden_storage_box().id().update(ration_box);
                        }
                        spawned_count += 1;
                        log::info!("[MonumentPlaceables] Spawned monument military ration {} at ({:.1}, {:.1}) for {}", 
                            box_id, world_x, world_y, monument_name);
                    }
                    Err(e) => {
                        log::warn!("[MonumentPlaceables] Failed to spawn military ration at ({:.1}, {:.1}): {}", 
                            world_x, world_y, e);
                    }
                }
            }
            
            MonumentPlaceableType::RepairBench => {
                let repair_bench = WoodenStorageBox {
                    id: 0,
                    pos_x: world_x,
                    pos_y: world_y + BOX_COLLISION_Y_OFFSET,
                    chunk_index: chunk_idx,
                    placed_by: monument_owner,
                    box_type: BOX_TYPE_REPAIR_BENCH,
                    slot_instance_id_0: None, slot_def_id_0: None,
                    slot_instance_id_1: None, slot_def_id_1: None,
                    slot_instance_id_2: None, slot_def_id_2: None,
                    slot_instance_id_3: None, slot_def_id_3: None,
                    slot_instance_id_4: None, slot_def_id_4: None,
                    slot_instance_id_5: None, slot_def_id_5: None,
                    slot_instance_id_6: None, slot_def_id_6: None,
                    slot_instance_id_7: None, slot_def_id_7: None,
                    slot_instance_id_8: None, slot_def_id_8: None,
                    slot_instance_id_9: None, slot_def_id_9: None,
                    slot_instance_id_10: None, slot_def_id_10: None,
                    slot_instance_id_11: None, slot_def_id_11: None,
                    slot_instance_id_12: None, slot_def_id_12: None,
                    slot_instance_id_13: None, slot_def_id_13: None,
                    slot_instance_id_14: None, slot_def_id_14: None,
                    slot_instance_id_15: None, slot_def_id_15: None,
                    slot_instance_id_16: None, slot_def_id_16: None,
                    slot_instance_id_17: None, slot_def_id_17: None,
                    slot_instance_id_18: None, slot_def_id_18: None,
                    slot_instance_id_19: None, slot_def_id_19: None,
                    slot_instance_id_20: None, slot_def_id_20: None,
                    slot_instance_id_21: None, slot_def_id_21: None,
                    slot_instance_id_22: None, slot_def_id_22: None,
                    slot_instance_id_23: None, slot_def_id_23: None,
                    slot_instance_id_24: None, slot_def_id_24: None,
                    slot_instance_id_25: None, slot_def_id_25: None,
                    slot_instance_id_26: None, slot_def_id_26: None,
                    slot_instance_id_27: None, slot_def_id_27: None,
                    slot_instance_id_28: None, slot_def_id_28: None,
                    slot_instance_id_29: None, slot_def_id_29: None,
                    slot_instance_id_30: None, slot_def_id_30: None,
                    slot_instance_id_31: None, slot_def_id_31: None,
                    slot_instance_id_32: None, slot_def_id_32: None,
                    slot_instance_id_33: None, slot_def_id_33: None,
                    slot_instance_id_34: None, slot_def_id_34: None,
                    slot_instance_id_35: None, slot_def_id_35: None,
                    slot_instance_id_36: None, slot_def_id_36: None,
                    slot_instance_id_37: None, slot_def_id_37: None,
                    slot_instance_id_38: None, slot_def_id_38: None,
                    slot_instance_id_39: None, slot_def_id_39: None,
                    slot_instance_id_40: None, slot_def_id_40: None,
                    slot_instance_id_41: None, slot_def_id_41: None,
                    slot_instance_id_42: None, slot_def_id_42: None,
                    slot_instance_id_43: None, slot_def_id_43: None,
                    slot_instance_id_44: None, slot_def_id_44: None,
                    slot_instance_id_45: None, slot_def_id_45: None,
                    slot_instance_id_46: None, slot_def_id_46: None,
                    slot_instance_id_47: None, slot_def_id_47: None,
                    health: REPAIR_BENCH_INITIAL_HEALTH,
                    max_health: REPAIR_BENCH_MAX_HEALTH,
                    is_destroyed: false,
                    destroyed_at: None,
                    last_hit_time: None,
                    last_damaged_by: None,
                    respawn_at: Timestamp::UNIX_EPOCH, // 0 = not respawning (monument placeables don't respawn)
                    // Mark as monument placeable
                    is_monument: true,
                    active_user_id: None,
                    active_user_since: None,
                };
                
                match ctx.db.wooden_storage_box().try_insert(repair_bench) {
                    Ok(inserted) => {
                        spawned_count += 1;
                        log::info!("[MonumentPlaceables] Spawned monument repair bench {} at ({:.1}, {:.1}) for {}", 
                            inserted.id, world_x, world_y, monument_name);
                    }
                    Err(e) => {
                        log::warn!("[MonumentPlaceables] Failed to spawn repair bench at ({:.1}, {:.1}): {}", 
                            world_x, world_y, e);
                    }
                }
            }
            
            MonumentPlaceableType::Turret => {
                let turret = Turret {
                    id: 0,
                    turret_type: TURRET_TYPE_TALLOW_STEAM,
                    pos_x: world_x,
                    pos_y: world_y,
                    chunk_index: chunk_idx,
                    placed_by: monument_owner,
                    placed_at: current_time,
                    ammo_instance_id: None, // Monument turrets don't use ammo
                    ammo_def_id: None,
                    last_fire_time: None,
                    current_target_id: None,
                    current_target_player: None,
                    health: TURRET_INITIAL_HEALTH,
                    max_health: TURRET_MAX_HEALTH,
                    is_destroyed: false,
                    destroyed_at: None,
                    last_hit_time: None,
                    is_monument: true, // Monument turret: indestructible, infinite ammo, extended range
                };
                
                match ctx.db.turret().try_insert(turret) {
                    Ok(inserted) => {
                        spawned_count += 1;
                        log::info!("[MonumentPlaceables] Spawned monument turret {} at ({:.1}, {:.1}) for {}", 
                            inserted.id, world_x, world_y, monument_name);
                    }
                    Err(e) => {
                        log::warn!("[MonumentPlaceables] Failed to spawn turret at ({:.1}, {:.1}): {}", 
                            world_x, world_y, e);
                    }
                }
            }
            
            MonumentPlaceableType::Compost => {
                use crate::compost::{COMPOST_INITIAL_HEALTH, COMPOST_MAX_HEALTH};
                
                let compost = WoodenStorageBox {
                    id: 0,
                    pos_x: world_x,
                    pos_y: world_y + BOX_COLLISION_Y_OFFSET,
                    chunk_index: chunk_idx,
                    placed_by: monument_owner,
                    box_type: BOX_TYPE_COMPOST,
                    slot_instance_id_0: None, slot_def_id_0: None,
                    slot_instance_id_1: None, slot_def_id_1: None,
                    slot_instance_id_2: None, slot_def_id_2: None,
                    slot_instance_id_3: None, slot_def_id_3: None,
                    slot_instance_id_4: None, slot_def_id_4: None,
                    slot_instance_id_5: None, slot_def_id_5: None,
                    slot_instance_id_6: None, slot_def_id_6: None,
                    slot_instance_id_7: None, slot_def_id_7: None,
                    slot_instance_id_8: None, slot_def_id_8: None,
                    slot_instance_id_9: None, slot_def_id_9: None,
                    slot_instance_id_10: None, slot_def_id_10: None,
                    slot_instance_id_11: None, slot_def_id_11: None,
                    slot_instance_id_12: None, slot_def_id_12: None,
                    slot_instance_id_13: None, slot_def_id_13: None,
                    slot_instance_id_14: None, slot_def_id_14: None,
                    slot_instance_id_15: None, slot_def_id_15: None,
                    slot_instance_id_16: None, slot_def_id_16: None,
                    slot_instance_id_17: None, slot_def_id_17: None,
                    slot_instance_id_18: None, slot_def_id_18: None,
                    slot_instance_id_19: None, slot_def_id_19: None,
                    slot_instance_id_20: None, slot_def_id_20: None,
                    slot_instance_id_21: None, slot_def_id_21: None,
                    slot_instance_id_22: None, slot_def_id_22: None,
                    slot_instance_id_23: None, slot_def_id_23: None,
                    slot_instance_id_24: None, slot_def_id_24: None,
                    slot_instance_id_25: None, slot_def_id_25: None,
                    slot_instance_id_26: None, slot_def_id_26: None,
                    slot_instance_id_27: None, slot_def_id_27: None,
                    slot_instance_id_28: None, slot_def_id_28: None,
                    slot_instance_id_29: None, slot_def_id_29: None,
                    slot_instance_id_30: None, slot_def_id_30: None,
                    slot_instance_id_31: None, slot_def_id_31: None,
                    slot_instance_id_32: None, slot_def_id_32: None,
                    slot_instance_id_33: None, slot_def_id_33: None,
                    slot_instance_id_34: None, slot_def_id_34: None,
                    slot_instance_id_35: None, slot_def_id_35: None,
                    slot_instance_id_36: None, slot_def_id_36: None,
                    slot_instance_id_37: None, slot_def_id_37: None,
                    slot_instance_id_38: None, slot_def_id_38: None,
                    slot_instance_id_39: None, slot_def_id_39: None,
                    slot_instance_id_40: None, slot_def_id_40: None,
                    slot_instance_id_41: None, slot_def_id_41: None,
                    slot_instance_id_42: None, slot_def_id_42: None,
                    slot_instance_id_43: None, slot_def_id_43: None,
                    slot_instance_id_44: None, slot_def_id_44: None,
                    slot_instance_id_45: None, slot_def_id_45: None,
                    slot_instance_id_46: None, slot_def_id_46: None,
                    slot_instance_id_47: None, slot_def_id_47: None,
                    health: COMPOST_INITIAL_HEALTH,
                    max_health: COMPOST_MAX_HEALTH,
                    is_destroyed: false,
                    destroyed_at: None,
                    last_hit_time: None,
                    last_damaged_by: None,
                    respawn_at: Timestamp::UNIX_EPOCH,
                    is_monument: true,
                    active_user_id: None,
                    active_user_since: None,
                };
                
                match ctx.db.wooden_storage_box().try_insert(compost) {
                    Ok(inserted) => {
                        spawned_count += 1;
                        log::info!("[MonumentPlaceables] Spawned monument compost {} at ({:.1}, {:.1}) for {}", 
                            inserted.id, world_x, world_y, monument_name);
                    }
                    Err(e) => {
                        log::warn!("[MonumentPlaceables] Failed to spawn compost at ({:.1}, {:.1}): {}", 
                            world_x, world_y, e);
                    }
                }
            }
        }
    }
    
    log::info!("[MonumentPlaceables] Spawned {} placeables for {} at ({:.1}, {:.1})", 
        spawned_count, monument_name, monument_center_x, monument_center_y);
    
    Ok(spawned_count)
}

// =============================================================================
// REED MARSH RESOURCE SPAWNING
// =============================================================================

/// Spawns reeds, water barrels, and memory shards around reed marsh centers
/// Reed marshes are natural wetland areas - great for farming reeds, barrels, memory shards, and hunting terns
pub fn spawn_reed_marsh_resources(ctx: &ReducerContext) -> Result<(), String> {
    use crate::reed_marsh as ReedMarshTableTrait;
    use crate::barrel::{Barrel, BARREL_INITIAL_HEALTH, SEA_BARREL_VARIANT_START, SEA_BARREL_VARIANT_END};
    use crate::harvestable_resource::{HarvestableResource, create_harvestable_resource};
    use crate::plants_database::PlantType;
    use crate::environment::calculate_chunk_index;
    
    // Collect marsh data first to avoid borrow issues
    let marsh_data: Vec<(f32, f32, f32)> = ctx.db.reed_marsh()
        .iter()
        .map(|m| (m.world_x, m.world_y, m.radius_px))
        .collect();
    
    if marsh_data.is_empty() {
        log::info!("[ReedMarsh] No reed marshes found to spawn resources in");
        return Ok(());
    }
    
    let mut total_reeds = 0;
    let mut total_barrels = 0;
    let mut total_shards = 0;
    
    for (marsh_x, marsh_y, radius_px) in &marsh_data {
        let mut marsh_reeds = 0;
        let mut marsh_barrels = 0;
        let mut marsh_shards = 0;
        
        // Spawn reeds (main resource) - 5-8 reed plants per marsh
        // Reeds grow along the marshy edges of rivers and lakes
        let reed_count = ctx.rng().gen_range(5..=8);
        for _ in 0..reed_count {
            let angle = ctx.rng().gen::<f32>() * std::f32::consts::PI * 2.0;
            let distance = ctx.rng().gen_range(30.0..*radius_px);
            let spawn_x = marsh_x + angle.cos() * distance;
            let spawn_y = marsh_y + angle.sin() * distance;
            
            let chunk_idx = calculate_chunk_index(spawn_x, spawn_y);
            
            let reed = create_harvestable_resource(
                PlantType::Reed,
                spawn_x,
                spawn_y,
                chunk_idx,
                false // Not player planted
            );
            
            ctx.db.harvestable_resource().insert(reed);
            marsh_reeds += 1;
        }
        
        // Spawn water barrels (1-2 per marsh) - washed up cargo and flotsam
        let barrel_count = ctx.rng().gen_range(1..=2);
        for _ in 0..barrel_count {
            let angle = ctx.rng().gen::<f32>() * std::f32::consts::PI * 2.0;
            let distance = ctx.rng().gen_range(50.0..*radius_px * 0.9);
            let spawn_x = marsh_x + angle.cos() * distance;
            let spawn_y = marsh_y + angle.sin() * distance;
            
            let chunk_idx = calculate_chunk_index(spawn_x, spawn_y);
            // Use sea barrel variants (washed up look)
            let variant = ctx.rng().gen_range(SEA_BARREL_VARIANT_START..SEA_BARREL_VARIANT_END);
            
            let barrel = Barrel {
                id: 0, // auto_inc
                pos_x: spawn_x,
                pos_y: spawn_y,
                chunk_index: chunk_idx,
                health: BARREL_INITIAL_HEALTH,
                variant,
                last_hit_time: None,
                respawn_at: spacetimedb::Timestamp::UNIX_EPOCH, // 0 = not respawning
                cluster_id: 0, // Reed marsh barrels don't belong to a cluster
                is_monument: false,
            };
            
            ctx.db.barrel().insert(barrel);
            marsh_barrels += 1;
        }
        
        // Spawn memory shards (50% chance for 1 shard per marsh)
        // Debris washed up from the crashed ship finds its way to these wetlands
        if ctx.rng().gen::<f32>() < 0.50 {
            let angle = ctx.rng().gen::<f32>() * std::f32::consts::PI * 2.0;
            let distance = ctx.rng().gen_range(40.0..*radius_px * 0.85);
            let spawn_x = marsh_x + angle.cos() * distance;
            let spawn_y = marsh_y + angle.sin() * distance;
            
            let chunk_idx = calculate_chunk_index(spawn_x, spawn_y);
            
            let shard = create_harvestable_resource(
                PlantType::MemoryShard,
                spawn_x,
                spawn_y,
                chunk_idx,
                false // Not player planted
            );
            
            ctx.db.harvestable_resource().insert(shard);
            marsh_shards += 1;
        }
        
        log::debug!("🌾 [ReedMarsh] ({:.0}, {:.0}): {} reeds, {} barrels, {} shards",
                   marsh_x, marsh_y, marsh_reeds, marsh_barrels, marsh_shards);
        
        total_reeds += marsh_reeds;
        total_barrels += marsh_barrels;
        total_shards += marsh_shards;
    }
    
    log::info!("🌾 [ReedMarsh] Total spawned: {} reeds, {} barrels, {} memory shards across {} marshes",
               total_reeds, total_barrels, total_shards, marsh_data.len());
    
    Ok(())
}

// =============================================================================
// TIDE POOL RESOURCE SPAWNING
// =============================================================================

/// Spawns reeds, washed-up items (coral fragments, plastic water jug, vitamin drink), and barrels around tide pool centers
/// Tide pools are coastal beach inlets - crabs and terns are spawned/respawned via environment and respawn systems
pub fn spawn_tide_pool_resources(ctx: &ReducerContext) -> Result<(), String> {
    use crate::tide_pool as TidePoolTableTrait;
    use crate::barrel::{Barrel, BARREL_INITIAL_HEALTH, SEA_BARREL_VARIANT_START, SEA_BARREL_VARIANT_END};
    use crate::harvestable_resource::{create_harvestable_resource};
    use crate::plants_database::PlantType;
    use crate::environment::calculate_chunk_index;
    
    let tide_pool_data: Vec<(f32, f32, f32)> = ctx.db.tide_pool()
        .iter()
        .map(|t| (t.world_x, t.world_y, t.radius_px))
        .collect();
    
    if tide_pool_data.is_empty() {
        log::info!("[TidePool] No tide pools found to spawn resources in");
        return Ok(());
    }
    
    let item_defs = ctx.db.item_definition();
    let mut total_reeds = 0;
    let mut total_barrels = 0;
    let mut total_washed_up = 0;
    
    for (pool_x, pool_y, radius_px) in &tide_pool_data {
        let mut pool_reeds = 0;
        let mut pool_barrels = 0;
        let mut pool_washed_up = 0;
        
        // Spawn reeds (3-5 per tide pool) - coastal reeds grow IN the water inlet (not on sand)
        let reed_count = ctx.rng().gen_range(3..=5);
        for _ in 0..reed_count {
            let angle = ctx.rng().gen::<f32>() * std::f32::consts::PI * 2.0;
            let distance = ctx.rng().gen_range(25.0..*radius_px * 0.6); // Closer to center = in the water
            let spawn_x = pool_x + angle.cos() * distance;
            let spawn_y = pool_y + angle.sin() * distance;
            
            if !crate::environment::is_position_on_water(ctx, spawn_x, spawn_y) {
                continue;
            }
            
            let chunk_idx = calculate_chunk_index(spawn_x, spawn_y);
            let reed = create_harvestable_resource(PlantType::Reed, spawn_x, spawn_y, chunk_idx, false);
            ctx.db.harvestable_resource().insert(reed);
            pool_reeds += 1;
        }
        
        // Spawn 1 sea barrel per tide pool (washed up flotsam)
        let angle = ctx.rng().gen::<f32>() * std::f32::consts::PI * 2.0;
        let distance = ctx.rng().gen_range(40.0..*radius_px * 0.85);
        let barrel_x = pool_x + angle.cos() * distance;
        let barrel_y = pool_y + angle.sin() * distance;
        
        if crate::environment::is_position_on_beach_tile(ctx, barrel_x, barrel_y) {
            let chunk_idx = calculate_chunk_index(barrel_x, barrel_y);
            let variant = ctx.rng().gen_range(SEA_BARREL_VARIANT_START..SEA_BARREL_VARIANT_END);
            let barrel = Barrel {
                id: 0,
                pos_x: barrel_x,
                pos_y: barrel_y,
                chunk_index: chunk_idx,
                health: BARREL_INITIAL_HEALTH,
                variant,
                last_hit_time: None,
                respawn_at: spacetimedb::Timestamp::UNIX_EPOCH,
                cluster_id: 0,
                is_monument: false,
            };
            ctx.db.barrel().insert(barrel);
            pool_barrels += 1;
        }
        
        // Spawn washed-up items - beachcombing surprises (thematic: things that wash ashore)
        let washed_up_configs = [
            ("Coral Fragments", 1, 3, 0.65),   // Storm-washed coral - useful for Diving Pick
            ("Sea Glass", 1, 2, 0.45),        // Frosted glass worn by tides - flavor
            ("Shell", 1, 1, 0.25),             // Rare intact mollusk shell - valuable
            ("Shell Fragment", 1, 2, 0.35),   // Worn smooth by tides - atmospheric
            ("Aleut Charm", 1, 1, 0.18),       // Mysterious lost trinket - story surprise
            ("Rusty Hook", 1, 2, 0.30),       // Fishing debris - smelts to metal
            ("Reed Water Bottle", 1, 1, 0.22), // Portable container washed up
            ("Old Boot", 1, 1, 0.08),          // Waterlogged boot - useless but funny
        ];
        
        for (item_name, min_qty, max_qty, chance) in washed_up_configs {
            if ctx.rng().gen::<f32>() > chance {
                continue;
            }
            
            let item_def_id = match item_defs.iter().find(|def| def.name == item_name) {
                Some(def) => def.id,
                None => {
                    log::warn!("[TidePool] Item '{}' not found, skipping", item_name);
                    continue;
                }
            };
            
            let angle = ctx.rng().gen::<f32>() * std::f32::consts::PI * 2.0;
            let distance = ctx.rng().gen_range(30.0..*radius_px * 0.9);
            let spawn_x = pool_x + angle.cos() * distance;
            let spawn_y = pool_y + angle.sin() * distance;
            
            if !crate::environment::is_position_on_beach_tile(ctx, spawn_x, spawn_y) {
                continue;
            }
            
            let quantity = ctx.rng().gen_range(min_qty..=max_qty);
            if let Err(e) = crate::dropped_item::create_dropped_item_entity(ctx, item_def_id, quantity, spawn_x, spawn_y) {
                log::warn!("[TidePool] Failed to spawn {} at ({:.1}, {:.1}): {}", item_name, spawn_x, spawn_y, e);
            } else {
                pool_washed_up += 1;
            }
        }
        
        log::debug!("🦀 [TidePool] ({:.0}, {:.0}): {} reeds, {} barrels, {} washed-up items",
                   pool_x, pool_y, pool_reeds, pool_barrels, pool_washed_up);
        
        total_reeds += pool_reeds;
        total_barrels += pool_barrels;
        total_washed_up += pool_washed_up;
    }
    
    log::info!("🦀 [TidePool] Total spawned: {} reeds, {} barrels, {} washed-up items across {} tide pools",
               total_reeds, total_barrels, total_washed_up, tide_pool_data.len());
    
    Ok(())
}

