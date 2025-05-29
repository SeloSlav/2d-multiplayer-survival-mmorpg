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
    
    log::info!("Starting world generation with seed: {}", config.seed);
    
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
    
    log::info!("Generating world: {}x{} tiles in {}x{} chunks", 
               config.world_width_tiles, config.world_height_tiles, chunks_x, chunks_y);
    
    let mut tiles_generated = 0;
    
    for chunk_x in 0..chunks_x {
        for chunk_y in 0..chunks_y {
            tiles_generated += generate_chunk(ctx, &config, &perlin, chunk_x as i32, chunk_y as i32)?;
        }
    }
    
    log::info!("World generation completed! Generated {} tiles with seed: {}", tiles_generated, config.seed);
    Ok(())
}

fn generate_chunk(
    ctx: &ReducerContext, 
    config: &WorldGenConfig, 
    noise: &Perlin, 
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
            
            let tile_type = determine_tile_type(
                config, noise, world_x, world_y, 
                config.world_width_tiles as i32, 
                config.world_height_tiles as i32
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

fn determine_tile_type(
    config: &WorldGenConfig,
    noise: &Perlin,
    world_x: i32,
    world_y: i32,
    world_width: i32,
    world_height: i32,
) -> TileType {
    let border_width = config.island_border_width as i32;
    let beach_width = config.beach_width as i32;
    
    // Island border logic - create sea around the edges
    if world_x < border_width || world_x >= world_width - border_width ||
       world_y < border_width || world_y >= world_height - border_width {
        return TileType::Sea;
    }
    
    // Beach around sea
    if world_x < border_width + beach_width || 
       world_x >= world_width - border_width - beach_width ||
       world_y < border_width + beach_width || 
       world_y >= world_height - border_width - beach_width {
        return TileType::Beach;
    }
    
    // Generate inland terrain using noise
    let noise_val = noise.get([world_x as f64 * 0.01, world_y as f64 * 0.01]);
    let river_noise = noise.get([world_x as f64 * 0.005, world_y as f64 * 0.008]);
    let dirt_noise = noise.get([world_x as f64 * 0.02, world_y as f64 * 0.015]);
    let road_noise = noise.get([world_x as f64 * 0.003, world_y as f64 * 0.003]);
    
    // Rivers and lakes (using river_frequency)
    if river_noise.abs() < (0.05 * config.river_frequency as f64) {
        return TileType::Sea;
    }
    
    // Beach around rivers/lakes
    if river_noise.abs() < (0.08 * config.river_frequency as f64) {
        return TileType::Beach;
    }
    
    // Dirt roads (linear features)
    if config.road_density > 0.0 {
        let road_threshold = 0.02 * config.road_density as f64;
        if (road_noise + 0.3).abs() < road_threshold || (road_noise - 0.3).abs() < road_threshold {
            return TileType::DirtRoad;
        }
    }
    
    // Dirt patches
    if dirt_noise > 0.3 && dirt_noise < 0.6 {
        if config.dirt_patch_frequency > 0.0 {
            let dirt_threshold = 0.1 + (config.dirt_patch_frequency as f64 * 0.3);
            if dirt_noise < dirt_threshold {
                return TileType::Dirt;
            }
        }
    }
    
    // Default to grass for most terrain
    TileType::Grass
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
        world_width_tiles: 250,
        world_height_tiles: 250,
        chunk_size: 20,
        island_border_width: 8,
        beach_width: 4,
        river_frequency: 0.3,
        dirt_patch_frequency: 0.2,
        road_density: 0.1,
    };
    
    generate_world(ctx, default_config)
} 