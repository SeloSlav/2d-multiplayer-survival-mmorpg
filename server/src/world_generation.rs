use spacetimedb::{ReducerContext, Table};
use noise::{NoiseFn, Perlin, Seedable};
use log;
use crate::{WorldTile, TileType, WorldGenConfig};

// Import the table trait
use crate::world_tile as WorldTileTableTrait;

#[spacetimedb::reducer]
pub fn generate_world(ctx: &ReducerContext, config: WorldGenConfig) -> Result<(), String> {
    // TEMPORARILY REMOVED: Security check for testing
    // if ctx.sender != ctx.identity() {
    //     return Err("Only server can generate world".to_string());
    // }
    
    log::info!("Starting advanced world generation with seed: {}", config.seed);
    
    // Clear existing tiles
    let deleted_count = ctx.db.world_tile().iter().count();
    if deleted_count > 0 {
        log::info!("Clearing {} existing world tiles", deleted_count);
        // Delete all existing tiles
        for tile in ctx.db.world_tile().iter() {
            ctx.db.world_tile().id().delete(&tile.id);
        }
    }
    
    let perlin = Perlin::new(config.seed as u32);
    let chunks_x = (config.world_width_tiles + config.chunk_size - 1) / config.chunk_size;
    let chunks_y = (config.world_height_tiles + config.chunk_size - 1) / config.chunk_size;
    
    log::info!("Generating realistic world: {}x{} tiles in {}x{} chunks", 
               config.world_width_tiles, config.world_height_tiles, chunks_x, chunks_y);
    
    // Pre-generate the heightmap and features for better consistency
    let world_features = generate_world_features(&config, &perlin);
    
    let mut tiles_generated = 0;
    
    for chunk_x in 0..chunks_x {
        for chunk_y in 0..chunks_y {
            tiles_generated += generate_chunk(ctx, &config, &perlin, &world_features, chunk_x as i32, chunk_y as i32)?;
        }
    }
    
    log::info!("Advanced world generation completed! Generated {} tiles with seed: {}", tiles_generated, config.seed);
    Ok(())
}

// Structure to hold pre-generated world features
struct WorldFeatures {
    heightmap: Vec<Vec<f64>>,
    shore_distance: Vec<Vec<f64>>,
    river_network: Vec<Vec<bool>>,
    lake_map: Vec<Vec<bool>>,
    road_network: Vec<Vec<bool>>,
    dirt_paths: Vec<Vec<bool>>,
    width: usize,
    height: usize,
}

fn generate_world_features(config: &WorldGenConfig, noise: &Perlin) -> WorldFeatures {
    let width = config.world_width_tiles as usize;
    let height = config.world_height_tiles as usize;
    
    // Generate heightmap with multiple octaves for realistic terrain
    let mut heightmap = vec![vec![0.0; width]; height];
    for y in 0..height {
        for x in 0..width {
            let mut height_val = 0.0;
            let mut amplitude = 1.0;
            let mut frequency = 0.005;
            
            // Multiple octaves for realistic terrain
            for _ in 0..4 {
                height_val += noise.get([x as f64 * frequency, y as f64 * frequency]) * amplitude;
                amplitude *= 0.5;
                frequency *= 2.0;
            }
            heightmap[y][x] = height_val;
        }
    }
    
    // Generate wavy shore distance map
    let shore_distance = generate_wavy_shore_distance(config, noise, width, height);
    
    // Generate river network flowing to sea
    let river_network = generate_river_network(config, noise, &shore_distance, width, height);
    
    // Generate inland lakes
    let lake_map = generate_lakes(config, noise, &shore_distance, width, height);
    
    // Generate road network from corners to center
    let road_network = generate_road_network(config, noise, width, height);
    
    // Generate additional dirt paths
    let dirt_paths = generate_dirt_paths(config, noise, &road_network, width, height);
    
    WorldFeatures {
        heightmap,
        shore_distance,
        river_network,
        lake_map,
        road_network,
        dirt_paths,
        width,
        height,
    }
}

fn generate_wavy_shore_distance(config: &WorldGenConfig, noise: &Perlin, width: usize, height: usize) -> Vec<Vec<f64>> {
    let mut shore_distance = vec![vec![0.0; width]; height];
    let center_x = width as f64 / 2.0;
    let center_y = height as f64 / 2.0;
    let base_island_radius = (width.min(height) as f64 * 0.35).min(center_x.min(center_y) - 20.0);
    
    for y in 0..height {
        for x in 0..width {
            let dx = x as f64 - center_x;
            let dy = y as f64 - center_y;
            let distance_from_center = (dx * dx + dy * dy).sqrt();
            
            // Create wavy shores using multiple noise functions
            let shore_noise1 = noise.get([x as f64 * 0.015, y as f64 * 0.015, 1000.0]);
            let shore_noise2 = noise.get([x as f64 * 0.008, y as f64 * 0.012, 2000.0]);
            let shore_noise3 = noise.get([x as f64 * 0.025, y as f64 * 0.025, 3000.0]);
            
            // Combine noise for realistic wavy shores
            let shore_variation = shore_noise1 * 15.0 + shore_noise2 * 25.0 + shore_noise3 * 8.0;
            let adjusted_radius = base_island_radius + shore_variation;
            
            // Distance from shore (negative = water, positive = land)
            shore_distance[y][x] = adjusted_radius - distance_from_center;
        }
    }
    
    shore_distance
}

fn generate_river_network(config: &WorldGenConfig, noise: &Perlin, shore_distance: &[Vec<f64>], width: usize, height: usize) -> Vec<Vec<bool>> {
    let mut rivers = vec![vec![false; width]; height];
    
    if config.river_frequency <= 0.0 {
        return rivers;
    }
    
    // Generate river sources in inland areas
    let mut river_sources = Vec::new();
    for y in 20..height-20 {
        for x in 20..width-20 {
            // Only place sources inland (reduced from 40.0 to 25.0)
            if shore_distance[y][x] > 25.0 {
                let source_noise = noise.get([x as f64 * 0.02, y as f64 * 0.02, 4000.0]);
                // Lowered threshold from 0.7 to 0.4 for more rivers
                if source_noise > 0.4 {
                    river_sources.push((x, y));
                }
            }
        }
    }
    
    // Increased river count - allow more rivers (was 8.0, now 15.0)
    river_sources.truncate((config.river_frequency * 15.0) as usize);
    
    // Trace rivers from sources to sea
    for (source_x, source_y) in river_sources {
        trace_river_to_sea(&mut rivers, shore_distance, source_x, source_y, width, height);
    }
    
    rivers
}

fn trace_river_to_sea(rivers: &mut Vec<Vec<bool>>, shore_distance: &[Vec<f64>], start_x: usize, start_y: usize, width: usize, height: usize) {
    let mut x = start_x;
    let mut y = start_y;
    let mut path = Vec::new();
    
    // Flow downhill toward the sea
    for _ in 0..1000 { // Prevent infinite loops
        if x >= width || y >= height {
            break;
        }
        
        path.push((x, y));
        
        // If we reached the sea area, stop
        if shore_distance[y][x] < 5.0 {
            break;
        }
        
        // Find steepest downhill direction toward shore
        let mut best_x = x;
        let mut best_y = y;
        let mut best_distance = shore_distance[y][x];
        
        // Check 8 directions
        for dy in -1..=1i32 {
            for dx in -1..=1i32 {
                if dx == 0 && dy == 0 { continue; }
                
                let new_x = (x as i32 + dx) as usize;
                let new_y = (y as i32 + dy) as usize;
                
                if new_x < width && new_y < height {
                    // Prefer moving toward shore (lower shore_distance = closer to water)
                    let distance = shore_distance[new_y][new_x];
                    if distance < best_distance {
                        best_distance = distance;
                        best_x = new_x;
                        best_y = new_y;
                    }
                }
            }
        }
        
        // If no downhill direction found, stop
        if best_x == x && best_y == y {
            break;
        }
        
        x = best_x;
        y = best_y;
    }
    
    // Mark the river path
    for (rx, ry) in path {
        if rx < width && ry < height {
            rivers[ry][rx] = true;
            // Also mark adjacent tiles for wider rivers (expanded radius)
            for dy in -2..=2i32 {
                for dx in -2..=2i32 {
                    let adj_x = (rx as i32 + dx) as usize;
                    let adj_y = (ry as i32 + dy) as usize;
                    if adj_x < width && adj_y < height {
                        // Create a more natural river shape (diamond pattern)
                        let distance = dx.abs() + dy.abs();
                        if distance <= 2 {
                            rivers[adj_y][adj_x] = true;
                        }
                    }
                }
            }
        }
    }
}

fn generate_lakes(config: &WorldGenConfig, noise: &Perlin, shore_distance: &[Vec<f64>], width: usize, height: usize) -> Vec<Vec<bool>> {
    let mut lakes = vec![vec![false; width]; height];
    
    // Generate lake centers in safe inland areas
    let mut lake_centers = Vec::new();
    for y in 30..height-30 {
        for x in 30..width-30 {
            // Reduced inland requirement from 50.0 to 30.0
            if shore_distance[y][x] > 30.0 {
                let lake_noise = noise.get([x as f64 * 0.015, y as f64 * 0.015, 5000.0]);
                // Lowered threshold from 0.8 to 0.5 for more lakes
                if lake_noise > 0.5 {
                    lake_centers.push((x, y));
                }
            }
        }
    }
    
    // Increased lake limit from 5 to 12
    lake_centers.truncate(12);
    
    // Generate lakes around centers
    for (center_x, center_y) in lake_centers {
        // Increased base lake radius from 8.0 to 12.0
        let lake_radius = 12.0 + noise.get([center_x as f64 * 0.1, center_y as f64 * 0.1, 6000.0]) * 8.0;
        
        for y in (center_y.saturating_sub(20))..=(center_y + 20).min(height - 1) {
            for x in (center_x.saturating_sub(20))..=(center_x + 20).min(width - 1) {
                let dx = x as f64 - center_x as f64;
                let dy = y as f64 - center_y as f64;
                let distance = (dx * dx + dy * dy).sqrt();
                
                let shape_noise = noise.get([x as f64 * 0.05, y as f64 * 0.05, 7000.0]);
                let adjusted_radius = lake_radius + shape_noise * 4.0;
                
                if distance < adjusted_radius {
                    lakes[y][x] = true;
                }
            }
        }
    }
    
    lakes
}

fn generate_road_network(config: &WorldGenConfig, noise: &Perlin, width: usize, height: usize) -> Vec<Vec<bool>> {
    let mut roads = vec![vec![false; width]; height];
    
    if config.road_density <= 0.0 {
        return roads;
    }
    
    let center_x = width / 2;
    let center_y = height / 2;
    let center_size = 8; // Size of central compound area
    
    // Create central compound (square area)
    for y in (center_y - center_size)..=(center_y + center_size) {
        for x in (center_x - center_size)..=(center_x + center_size) {
            if x < width && y < height {
                roads[y][x] = true;
            }
        }
    }
    
    // Roads from corners to center
    let corners = [
        (20, 20),                    // Top-left
        (width - 21, 20),            // Top-right  
        (20, height - 21),           // Bottom-left
        (width - 21, height - 21),   // Bottom-right
    ];
    
    for (corner_x, corner_y) in corners {
        trace_road_to_center(&mut roads, corner_x, corner_y, center_x, center_y, width, height);
    }
    
    roads
}

fn trace_road_to_center(roads: &mut Vec<Vec<bool>>, start_x: usize, start_y: usize, target_x: usize, target_y: usize, width: usize, height: usize) {
    let mut x = start_x as i32;
    let mut y = start_y as i32;
    let target_x = target_x as i32;
    let target_y = target_y as i32;
    
    // Simple pathfinding toward center
    while (x - target_x).abs() > 8 || (y - target_y).abs() > 8 {
        // Move toward target
        if (x - target_x).abs() > (y - target_y).abs() {
            x += if target_x > x { 1 } else { -1 };
        } else {
            y += if target_y > y { 1 } else { -1 };
        }
        
        // Mark road (with width)
        for dy in -1..=1 {
            for dx in -1..=1 {
                let road_x = (x + dx) as usize;
                let road_y = (y + dy) as usize;
                if road_x < width && road_y < height {
                    roads[road_y][road_x] = true;
                }
            }
        }
    }
}

fn generate_dirt_paths(config: &WorldGenConfig, noise: &Perlin, road_network: &[Vec<bool>], width: usize, height: usize) -> Vec<Vec<bool>> {
    let mut paths = vec![vec![false; width]; height];
    
    // Generate winding dirt paths that connect to main roads
    for y in 0..height {
        for x in 0..width {
            let path_noise = noise.get([x as f64 * 0.02, y as f64 * 0.025, 8000.0]);
            let path_noise2 = noise.get([x as f64 * 0.015, y as f64 * 0.018, 9000.0]);
            
            // Create paths based on noise ridges
            if (path_noise > 0.6 && path_noise < 0.75) || (path_noise2 > 0.65 && path_noise2 < 0.8) {
                paths[y][x] = true;
            }
        }
    }
    
    paths
}

fn generate_chunk(
    ctx: &ReducerContext, 
    config: &WorldGenConfig, 
    noise: &Perlin, 
    world_features: &WorldFeatures,
    chunk_x: i32, 
    chunk_y: i32
) -> Result<u32, String> {
    let mut tiles_in_chunk = 0;
    
    for local_y in 0..config.chunk_size {
        for local_x in 0..config.chunk_size {
            let world_x = chunk_x * config.chunk_size as i32 + local_x as i32;
            let world_y = chunk_y * config.chunk_size as i32 + local_y as i32;
            
            // Skip tiles outside world bounds
            if world_x >= config.world_width_tiles as i32 || world_y >= config.world_height_tiles as i32 {
                continue;
            }
            
            let tile_type = determine_realistic_tile_type(
                config, noise, world_features, world_x, world_y
            );
            
            let variant = generate_tile_variant(noise, world_x, world_y, &tile_type);
            
            ctx.db.world_tile().insert(WorldTile {
                id: 0, // auto_inc
                chunk_x,
                chunk_y,
                tile_x: local_x as i32,
                tile_y: local_y as i32,
                world_x,
                world_y,
                tile_type,
                variant,
                biome_data: None,
            });
            
            tiles_in_chunk += 1;
        }
    }
    
    Ok(tiles_in_chunk)
}

fn determine_realistic_tile_type(
    config: &WorldGenConfig,
    noise: &Perlin,
    features: &WorldFeatures,
    world_x: i32,
    world_y: i32,
) -> TileType {
    let x = world_x as usize;
    let y = world_y as usize;
    
    if x >= features.width || y >= features.height {
        return TileType::Sea;
    }
    
    let shore_distance = features.shore_distance[y][x];
    
    // Sea (beyond the shore)
    if shore_distance < -5.0 {
        return TileType::Sea;
    }
    
    // Rivers take priority and flow into sea
    if features.river_network[y][x] {
        return TileType::Sea;
    }
    
    // Lakes
    if features.lake_map[y][x] {
        return TileType::Sea;
    }
    
    // Beach areas around water
    if shore_distance < 10.0 || is_near_water(features, x, y) {
        return TileType::Beach;
    }
    
    // Roads
    if features.road_network[y][x] {
        return TileType::DirtRoad;
    }
    
    // Dirt paths
    if features.dirt_paths[y][x] {
        return TileType::DirtRoad;
    }
    
    // Dirt patches using noise
    let dirt_noise = noise.get([world_x as f64 * 0.02, world_y as f64 * 0.015]);
    if dirt_noise > 0.4 && dirt_noise < 0.6 {
        if config.dirt_patch_frequency > 0.0 {
            let dirt_threshold = 0.15 + (config.dirt_patch_frequency as f64 * 0.25);
            if (dirt_noise - 0.5).abs() < dirt_threshold {
                return TileType::Dirt;
            }
        }
    }
    
    // Default to grass
    TileType::Grass
}

fn is_near_water(features: &WorldFeatures, x: usize, y: usize) -> bool {
    // Check if any adjacent tiles have water
    for dy in -3..=3i32 {
        for dx in -3..=3i32 {
            let check_x = (x as i32 + dx) as usize;
            let check_y = (y as i32 + dy) as usize;
            
            if check_x < features.width && check_y < features.height {
                if features.river_network[check_y][check_x] || 
                   features.lake_map[check_y][check_x] ||
                   features.shore_distance[check_y][check_x] < -2.0 {
                    return true;
                }
            }
        }
    }
    false
}

fn generate_tile_variant(noise: &Perlin, x: i32, y: i32, tile_type: &TileType) -> u8 {
    let variant_noise = noise.get([x as f64 * 0.1, y as f64 * 0.1, 100.0]);
    
    // Different variant ranges for different tile types
    match tile_type {
        TileType::Grass => {
            // More variation for grass tiles
            ((variant_noise + 1.0) * 127.5) as u8
        },
        TileType::Sea => {
            // Less variation for water (for consistent animation)
            ((variant_noise + 1.0) * 63.75) as u8
        },
        TileType::Beach => {
            // Sandy variation
            ((variant_noise + 1.0) * 85.0 + 40.0) as u8
        },
        _ => {
            // Standard variation for other tiles
            ((variant_noise + 1.0) * 95.0 + 32.0) as u8
        }
    }
}

#[spacetimedb::reducer]
pub fn generate_default_world(ctx: &ReducerContext) -> Result<(), String> {
    // TEMPORARILY REMOVED: Security check for testing
    // if ctx.sender != ctx.identity() {
    //     return Err("Only server can generate world".to_string());
    // }
    
    let default_config = WorldGenConfig {
        seed: 12345,
        world_width_tiles: 500,
        world_height_tiles: 500,
        chunk_size: 20,
        island_border_width: 8,
        beach_width: 6,
        river_frequency: 0.8,
        dirt_patch_frequency: 0.3,
        road_density: 0.2,
    };
    
    generate_world(ctx, default_config)
} 