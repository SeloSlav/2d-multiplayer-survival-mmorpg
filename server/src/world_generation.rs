use spacetimedb::{ReducerContext, Table, Timestamp, Identity};
use noise::{NoiseFn, Perlin, Seedable};
use log;
use crate::{WorldTile, TileType, WorldGenConfig, MinimapCache};

// Import the table trait
use crate::world_tile as WorldTileTableTrait;
use crate::minimap_cache as MinimapCacheTableTrait;
use crate::world_chunk_data as WorldChunkDataTableTrait;

use rand::{Rng, SeedableRng};
use rand::rngs::StdRng;
use std::collections::HashMap;

#[spacetimedb::reducer]
pub fn generate_world(ctx: &ReducerContext, config: WorldGenConfig) -> Result<(), String> {
    log::info!(
        "Starting world generation with seed {} ({}x{} tiles, {} chunk size)",
        config.seed, config.world_width_tiles, config.world_height_tiles, config.chunk_size
    );

    // TEMPORARILY REMOVED: Security check for testing
    // if ctx.sender != ctx.identity() {
    //     return Err("Only server can generate world".to_string());
    // }
    
    // Clear existing tiles
    let deleted_count = ctx.db.world_tile().iter().count();
    if deleted_count > 0 {
        log::info!("Clearing {} existing world tiles", deleted_count);
        // Delete all existing tiles
        for tile in ctx.db.world_tile().iter() {
            ctx.db.world_tile().id().delete(&tile.id);
        }
    }
    
    // Use the seed to create reproducible noise
    let noise = Perlin::new(config.seed as u32);
    
    // Pre-generate all world features at once for consistency
    let world_features = generate_world_features(&config, &noise);
    
    // Generate world in chunks
    let chunks_x = (config.world_width_tiles + config.chunk_size - 1) / config.chunk_size;
    let chunks_y = (config.world_height_tiles + config.chunk_size - 1) / config.chunk_size;
    
    let mut total_tiles = 0;
    for chunk_y in 0..chunks_y as i32 {
        for chunk_x in 0..chunks_x as i32 {
            match generate_chunk(ctx, &config, &noise, &world_features, chunk_x, chunk_y) {
                Ok(tiles_in_chunk) => {
                    total_tiles += tiles_in_chunk;
                }
                Err(e) => {
                    log::error!("Failed to generate chunk ({}, {}): {}", chunk_x, chunk_y, e);
                    return Err(format!("Chunk generation failed: {}", e));
                }
            }
        }
    }

    log::info!("Base world generation complete. Generated {} tiles in {} chunks.", total_tiles, chunks_x * chunks_y);
    
    // REMOVED: Post-processing adjacency validation (was causing terrain artifacts)
    // The autotile system handles transitions properly, no need for strict adjacency rules
    
    // Sea stacks will be generated in environment.rs alongside trees and stones
    
    log::info!("World generation complete!");
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

fn generate_scattered_islands(
    shore_distance: &mut Vec<Vec<f64>>, 
    noise: &Perlin, 
    width: usize, 
    height: usize, 
    base_island_radius: f64,
    center_x: f64,
    center_y: f64
) {
    log::info!("Generating a few scattered small islands throughout the sea (3-5 total)");
    
    // Generate only small islands (no mini/tiny - just 3-5 scattered islands)
    generate_island_layer(shore_distance, noise, width, height, base_island_radius, center_x, center_y,
                         base_island_radius * 0.12, // 12% of main island size - nice medium size
                         80.0, // Minimum distance from main island (stay well away)
                         80.0, // Large minimum distance between islands (spread them out)
                         0.015, // Much lower frequency for fewer placements
                         0.3,   // Very high threshold (much more selective)
                         4000.0); // Noise seed offset
}

fn generate_island_layer(
    shore_distance: &mut Vec<Vec<f64>>, 
    noise: &Perlin, 
    width: usize, 
    height: usize, 
    base_island_radius: f64,
    center_x: f64,
    center_y: f64,
    island_radius: f64,
    min_distance_from_main: f64,
    min_distance_between: f64,
    noise_frequency: f64,
    noise_threshold: f64,
    noise_seed: f64
) {
    let mut island_positions = Vec::new();
    
    // First pass: Find potential island positions using noise
    for y in 30..height-30 { // Stay away from edges
        for x in 30..width-30 {
            // Check if this point is in deep water (far from any existing land)
            if shore_distance[y][x] < -15.0 { // Deep water only
                let distance_from_main = ((x as f64 - center_x).powi(2) + (y as f64 - center_y).powi(2)).sqrt();
                
                // Check minimum distance from main island
                if distance_from_main > min_distance_from_main {
                    // Use noise to determine if an island should be here
                    let island_noise = noise.get([x as f64 * noise_frequency, y as f64 * noise_frequency, noise_seed]);
                    
                    if island_noise > noise_threshold {
                        // Check distance from other islands of this layer
                        let mut too_close = false;
                        for (other_x, other_y, _) in &island_positions {
                            let distance = ((x as f64 - other_x).powi(2) + (y as f64 - other_y).powi(2)).sqrt();
                            if distance < min_distance_between {
                                too_close = true;
                                break;
                            }
                        }
                        
                        if !too_close {
                            island_positions.push((x as f64, y as f64, island_radius));
                        }
                    }
                }
            }
        }
    }
    
    log::info!("Placing {} islands of radius {:.1}", island_positions.len(), island_radius);
    
    // Second pass: Actually create the islands
    for (island_x, island_y, radius) in island_positions {
        let search_radius = (radius + 5.0) as usize;
        
        for y in ((island_y as usize).saturating_sub(search_radius))..=((island_y as usize) + search_radius).min(height - 1) {
            for x in ((island_x as usize).saturating_sub(search_radius))..=((island_x as usize) + search_radius).min(width - 1) {
                let dx = x as f64 - island_x;
                let dy = y as f64 - island_y;
                let distance_from_island_center = (dx * dx + dy * dy).sqrt();
                
                // Add organic shape variation
                let shape_noise = noise.get([x as f64 * 0.08, y as f64 * 0.08, noise_seed + 1000.0]);
                let shape_variation = shape_noise * (radius * 0.3); // Vary shape by up to 30% of radius
                let adjusted_radius = radius + shape_variation;
                
                if distance_from_island_center < adjusted_radius {
                    // Only create island if this point is currently water
                    if shore_distance[y][x] < 0.0 {
                        // Create a smooth falloff from center to edge
                        let falloff = 1.0 - (distance_from_island_center / adjusted_radius);
                        let new_shore_distance = falloff * radius * 0.8; // Make it slightly smaller than the radius for natural look
                        
                        // Only update if this would create land or make existing land more prominent
                        if new_shore_distance > shore_distance[y][x] {
                            shore_distance[y][x] = new_shore_distance;
                        }
                    }
                }
            }
        }
    }
}

fn generate_wavy_shore_distance(config: &WorldGenConfig, noise: &Perlin, width: usize, height: usize) -> Vec<Vec<f64>> {
    let mut shore_distance = vec![vec![-100.0; width]; height]; // Start with deep water everywhere
    let center_x = width as f64 / 2.0;
    let center_y = height as f64 / 2.0;
    
    // Main island - back to original size
    let base_island_radius = (width.min(height) as f64 * 0.35).min(center_x.min(center_y) - 20.0); // Back to original 0.35
    
    // Generate main island
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
            let shore_variation = shore_noise1 * 18.0 + shore_noise2 * 30.0 + shore_noise3 * 10.0;
            let adjusted_radius = base_island_radius + shore_variation;
            
            // Distance from shore (negative = water, positive = land)
            shore_distance[y][x] = adjusted_radius - distance_from_center;
        }
    }
    
    // Add 2 separate islands in corners with proper water gaps
    let corner_positions = [
        (width / 5, height / 5),           // Top-left corner area (moved further from edge)
        (width * 4 / 5, height / 5),       // Top-right corner area  
        (width / 5, height * 4 / 5),       // Bottom-left corner area
        (width * 4 / 5, height * 4 / 5),   // Bottom-right corner area
    ];
    
    // Select 2 corners that won't overlap with main island
    let selected_corners = [
        corner_positions[(width + height) % 4],       
        corner_positions[(width + height + 2) % 4],   
    ];
    
    let secondary_island_radius = base_island_radius * 0.4; // Larger islands (40% of main)
    let min_separation_distance = base_island_radius * 0.6; // Reduced minimum distance to allow larger islands
    
    for (island_x, island_y) in selected_corners {
        // Check if this corner is far enough from main island
        let dist_from_main = ((island_x as f64 - center_x).powi(2) + (island_y as f64 - center_y).powi(2)).sqrt();
        
        if dist_from_main > min_separation_distance {
            for y in 0..height {
                for x in 0..width {
                    let dx = x as f64 - island_x as f64;
                    let dy = y as f64 - island_y as f64;
                    let distance_from_island_center = (dx * dx + dy * dy).sqrt();
                    
                    // Add wavy shores to secondary islands
                    let shore_noise = noise.get([x as f64 * 0.03, y as f64 * 0.03, (island_x + island_y) as f64]);
                    let island_variation = shore_noise * 8.0; // Smaller variation for smaller islands
                    let island_adjusted_radius = secondary_island_radius + island_variation;
                    
                    // Only create land if this point is close to THIS island AND far from main island
                    let island_shore_distance = island_adjusted_radius - distance_from_island_center;
                    let main_island_distance = ((x as f64 - center_x).powi(2) + (y as f64 - center_y).powi(2)).sqrt();
                    
                    // Only create secondary island land if:
                    // 1. Point is within secondary island radius
                    // 2. Point is far enough from main island center
                    if island_shore_distance > 0.0 && main_island_distance > base_island_radius + 20.0 {
                        shore_distance[y][x] = island_shore_distance;
                    }
                }
            }
        }
    }
    
    // Generate scattered small and mini islands throughout the sea
    generate_scattered_islands(&mut shore_distance, noise, width, height, base_island_radius, center_x, center_y);
    
    shore_distance
}

fn generate_river_network(config: &WorldGenConfig, noise: &Perlin, shore_distance: &[Vec<f64>], width: usize, height: usize) -> Vec<Vec<bool>> {
    let mut rivers = vec![vec![false; width]; height];
    
    if config.river_frequency <= 0.0 {
        log::info!("River frequency is 0, no rivers will be generated");
        return rivers;
    }
    
    log::info!("Generating clean main rivers with natural meanders (NO tributaries)");
    
    // Scale river parameters with map size - all rivers same width for consistency
    let map_scale = ((width * height) as f64 / (500.0 * 500.0)).sqrt();
    let river_width = (3.0 * map_scale).max(2.0) as i32; // Same width for all rivers
    
    // Generate ONLY 2 main rivers with beautiful meandering (avoiding center)
    // River 1: Flows from north highlands to southeast coast
    trace_highly_meandering_river(&mut rivers, noise, 
                      width / 2 - width / 8, height / 5,     // Start: North area
                      width * 4 / 5, height * 4 / 5,         // End: Southeast area
                      width, height, river_width, 1000);
    
    // River 2: Flows from northwest highlands to south coast
    trace_highly_meandering_river(&mut rivers, noise,
                      width / 4, height / 3,                 // Start: Northwest area  
                      width / 2 + width / 6, height * 5 / 6, // End: South area
                      width, height, river_width, 2000);
    
    // REMOVED: All tributary and distributary generation
    // NO MORE: generate_spaced_tributaries()
    // NO MORE: generate_spaced_distributaries()
    
    log::info!("Generated 2 clean main rivers with natural meanders (width: {})", river_width);
    
    rivers
}

// Helper function to check if a point is too close to the center compound
fn is_too_close_to_center_compound(x: usize, y: usize, width: usize, height: usize) -> bool {
    let center_x = width / 2;
    let center_y = height / 2;
    let compound_size = 8;
    let buffer = 25; // Stay well away from the compound
    
    let min_x = center_x.saturating_sub(compound_size + buffer);
    let max_x = (center_x + compound_size + buffer).min(width - 1);
    let min_y = center_y.saturating_sub(compound_size + buffer);
    let max_y = (center_y + compound_size + buffer).min(height - 1);
    
    x >= min_x && x <= max_x && y >= min_y && y <= max_y
}

fn trace_highly_meandering_river(rivers: &mut Vec<Vec<bool>>, noise: &Perlin, start_x: usize, start_y: usize, end_x: usize, end_y: usize, width: usize, height: usize, river_width: i32, noise_seed: i32) {
    let mut current_x = start_x as f64;
    let mut current_y = start_y as f64;
    
    let total_distance = ((end_x as f64 - start_x as f64).powi(2) + (end_y as f64 - start_y as f64).powi(2)).sqrt();
    let num_steps = (total_distance * 4.0) as usize; // Keep the high step count for smooth curves
    
    // Track our general flow direction but allow huge deviations
    let overall_dx = end_x as f64 - start_x as f64;
    let overall_dy = end_y as f64 - start_y as f64;
    
    for step in 0..num_steps {
        let progress = step as f64 / num_steps as f64;
        
        // LOOSE target guidance - much less direct than before
        let loose_target_x = start_x as f64 + overall_dx * progress;
        let loose_target_y = start_y as f64 + overall_dy * progress;
        
        // Create LARGE, flowing meanders with very low frequency noise for big curves
        let meander_scale1 = 0.0008; // Huge sweeping curves
        let meander_scale2 = 0.002;  // Large secondary curves
        let meander_scale3 = 0.006;  // Medium curves
        let meander_scale4 = 0.015;  // Fine detail
        
        // Multiple noise octaves for complex, natural meandering
        let noise1_x = noise.get([current_x * meander_scale1, current_y * meander_scale1, noise_seed as f64]);
        let noise1_y = noise.get([current_x * meander_scale1, current_y * meander_scale1, (noise_seed + 500) as f64]);
        
        let noise2_x = noise.get([current_x * meander_scale2, current_y * meander_scale2, (noise_seed + 1000) as f64]);
        let noise2_y = noise.get([current_x * meander_scale2, current_y * meander_scale2, (noise_seed + 1500) as f64]);
        
        let noise3_x = noise.get([current_x * meander_scale3, current_y * meander_scale3, (noise_seed + 2000) as f64]);
        let noise3_y = noise.get([current_x * meander_scale3, current_y * meander_scale3, (noise_seed + 2500) as f64]);
        
        let noise4_x = noise.get([current_x * meander_scale4, current_y * meander_scale4, (noise_seed + 3000) as f64]);
        let noise4_y = noise.get([current_x * meander_scale4, current_y * meander_scale4, (noise_seed + 3500) as f64]);
        
        // Create natural meandering but with CONTROLLED amplitudes to prevent gaps
        let meander_x = noise1_x * 25.0 + noise2_x * 15.0 + noise3_x * 8.0 + noise4_x * 3.0; // REDUCED: Still large but controlled (was 50.0 + 35.0 + 20.0 + 8.0)
        let meander_y = noise1_y * 25.0 + noise2_y * 15.0 + noise3_y * 8.0 + noise4_y * 3.0; // Prevents huge jumps
        
        // Add directional bias that changes over time for realistic river behavior
        let flow_bias = (progress * std::f64::consts::PI * 3.0).sin() * 8.0; // REDUCED: Still oscillating but controlled (was 15.0)
        let perpendicular_bias = (progress * std::f64::consts::PI * 2.5).cos() * 6.0; // REDUCED: Cross-flow (was 12.0)
        
        // Calculate flow direction with controlled meandering
        let flow_x = meander_x + flow_bias;
        let flow_y = meander_y + perpendicular_bias;
        
        // VERY loose guidance toward target - allow large deviations
        let target_pull_strength = 0.12; // SLIGHTLY INCREASED: Better connectivity (was 0.08)
        let target_pull_x = (loose_target_x - current_x) * target_pull_strength;
        let target_pull_y = (loose_target_y - current_y) * target_pull_strength;
        
        // Combine organic flow with minimal target guidance
        let desired_x = current_x + flow_x + target_pull_x;
        let desired_y = current_y + flow_y + target_pull_y;
        
        // CRITICAL FIX: Limit maximum step size to prevent gaps
        let max_step_size = 3.5; // ADDED: Maximum distance per step to ensure connectivity
        let step_dx = desired_x - current_x;
        let step_dy = desired_y - current_y;
        let step_distance = (step_dx * step_dx + step_dy * step_dy).sqrt();
        
        let (new_x, new_y) = if step_distance > max_step_size {
            // Scale down the step to maximum allowed size while preserving direction
            let scale = max_step_size / step_distance;
            (current_x + step_dx * scale, current_y + step_dy * scale)
        } else {
            (desired_x, desired_y)
        };
        
        // Check if new position is too close to center compound
        if is_too_close_to_center_compound(new_x as usize, new_y as usize, width, height) {
            // Add gentle repulsion force away from center
            let center_x = width as f64 / 2.0;
            let center_y = height as f64 / 2.0;
            let repulsion_strength = 25.0;
            
            let dx_from_center = new_x - center_x;
            let dy_from_center = new_y - center_y;
            let distance_from_center = (dx_from_center * dx_from_center + dy_from_center * dy_from_center).sqrt();
            
            if distance_from_center > 0.0 {
                let repulsion_x = (dx_from_center / distance_from_center) * repulsion_strength;
                let repulsion_y = (dy_from_center / distance_from_center) * repulsion_strength;
                
                current_x = new_x + repulsion_x;
                current_y = new_y + repulsion_y;
            } else {
                current_x = new_x + repulsion_strength;
                current_y = new_y + repulsion_strength;
            }
        } else {
            current_x = new_x;
            current_y = new_y;
        }
        
        // Keep within bounds with buffer
        current_x = current_x.max(25.0).min(width as f64 - 25.0);
        current_y = current_y.max(25.0).min(height as f64 - 25.0);
        
        // Stronger guidance in final 20% to ensure we reach target
        if progress > 0.8 {
            let final_guidance_strength = (progress - 0.8) * 0.6; // Gradually increase guidance
            let final_pull_x = (end_x as f64 - current_x) * final_guidance_strength;
            let final_pull_y = (end_y as f64 - current_y) * final_guidance_strength;
            current_x += final_pull_x;
            current_y += final_pull_y;
        }
        
        // Draw river with full width
        draw_river_segment(rivers, current_x as i32, current_y as i32, river_width, width, height);
    }
}

fn draw_river_segment(rivers: &mut Vec<Vec<bool>>, center_x: i32, center_y: i32, river_width: i32, width: usize, height: usize) {
    let radius = river_width;
    
    for dy in -radius..=radius {
        for dx in -radius..=radius {
            let x = center_x + dx;
            let y = center_y + dy;
            
            // Check bounds
            if x >= 0 && y >= 0 && (x as usize) < width && (y as usize) < height {
                // Create natural river shape (circular with soft edges)
                let distance_sq = dx * dx + dy * dy;
                let radius_sq = radius * radius;
                
                if distance_sq <= radius_sq {
                    // Add some variation to river edges for natural look
                    let edge_factor = distance_sq as f64 / radius_sq as f64;
                    if edge_factor < 0.8 || (edge_factor < 1.0 && (x + y) % 3 != 0) {
                        rivers[y as usize][x as usize] = true;
                    }
                }
            }
        }
    }
}

fn generate_lakes(config: &WorldGenConfig, noise: &Perlin, shore_distance: &[Vec<f64>], width: usize, height: usize) -> Vec<Vec<bool>> {
    let mut lakes = vec![vec![false; width]; height];
    
    // Scale lake density with map size
    let map_scale = (width * height) as f64 / (500.0 * 500.0); // Relative to base 500x500 map
    let base_lake_density = 0.012; // Base sampling frequency for lakes
    let scaled_density = base_lake_density * map_scale.sqrt();
    
    // Generate lake centers in safe inland areas
    let mut lake_centers = Vec::new();
    
    // Multiple passes for different lake types and sizes
    // Pass 1: Large central lakes deep inland
    for y in 25..height-25 {
        for x in 25..width-25 {
            if shore_distance[y][x] > 40.0 { // Deep inland for large lakes
                let lake_noise = noise.get([x as f64 * scaled_density * 0.8, y as f64 * scaled_density * 0.8, 5000.0]);
                if lake_noise > 0.6 { // Higher threshold for large lakes
                    lake_centers.push((x, y, 2)); // Size type 2 = large
                }
            }
        }
    }
    
    // Pass 2: Medium lakes moderately inland  
    for y in 20..height-20 {
        for x in 20..width-20 {
            if shore_distance[y][x] > 25.0 { // Moderately inland
                let lake_noise = noise.get([x as f64 * scaled_density, y as f64 * scaled_density, 5500.0]);
                if lake_noise > 0.45 { // Medium threshold for medium lakes
                    lake_centers.push((x, y, 1)); // Size type 1 = medium
                }
            }
        }
    }
    
    // Pass 3: Small lakes closer to shore (like ponds)
    for y in 15..height-15 {
        for x in 15..width-15 {
            if shore_distance[y][x] > 18.0 { // Closer to shore
                let lake_noise = noise.get([x as f64 * scaled_density * 1.2, y as f64 * scaled_density * 1.2, 6000.0]);
                if lake_noise > 0.3 { // Lower threshold for small lakes
                    lake_centers.push((x, y, 0)); // Size type 0 = small
                }
            }
        }
    }
    
    // Scale total lake count with map size - much more lakes like Rust
    let max_lakes = (35.0 * map_scale) as usize; // Significantly increased from 12
    lake_centers.truncate(max_lakes);
    
    // Generate lakes around centers with size-based radius
    for (center_x, center_y, size_type) in lake_centers {
        let base_radius = match size_type {
            2 => 18.0, // Large lakes
            1 => 12.0, // Medium lakes  
            0 => 6.0,  // Small lakes/ponds
            _ => 8.0,  // Fallback
        };
        
        let lake_radius = base_radius + noise.get([center_x as f64 * 0.1, center_y as f64 * 0.1, 6000.0]) * (base_radius * 0.4);
        
        let search_radius = (lake_radius + 8.0) as usize;
        for y in (center_y.saturating_sub(search_radius))..=(center_y + search_radius).min(height - 1) {
            for x in (center_x.saturating_sub(search_radius))..=(center_x + search_radius).min(width - 1) {
                let dx = x as f64 - center_x as f64;
                let dy = y as f64 - center_y as f64;
                let distance = (dx * dx + dy * dy).sqrt();
                
                // Add organic shape variation
                let shape_noise = noise.get([x as f64 * 0.05, y as f64 * 0.05, 7000.0]);
                let adjusted_radius = lake_radius + shape_noise * (base_radius * 0.3);
                
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
    
    // Roads from corners to center (the original cross pattern)
    let corners = [
        (20, 20),                    // Top-left
        (width - 21, 20),            // Top-right  
        (20, height - 21),           // Bottom-left
        (width - 21, height - 21),   // Bottom-right
    ];
    
    for (corner_x, corner_y) in corners {
        trace_road_to_center(&mut roads, corner_x, corner_y, center_x, center_y, width, height);
    }
    
    // Add ring road around the main island
    trace_ring_road(&mut roads, noise, center_x, center_y, width, height);
    
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

fn trace_ring_road(roads: &mut Vec<Vec<bool>>, noise: &Perlin, center_x: usize, center_y: usize, width: usize, height: usize) {
    let center_x_f = center_x as f64;
    let center_y_f = center_y as f64;
    
    // Calculate ring road radius - position it between the center and the island edge
    // The main island has radius of about 35% of map size, so place ring at about 60% to stay on land
    let base_ring_radius = (width.min(height) as f64 * 0.25).min(center_x_f.min(center_y_f) - 30.0);
    
    // Number of points around the circle - higher for smoother road
    let num_points = (base_ring_radius * 0.8) as usize; // Adjust density based on radius
    let angle_step = 2.0 * std::f64::consts::PI / num_points as f64;
    
    let mut ring_points = Vec::new();
    
    // Generate ring points with organic variation
    for i in 0..num_points {
        let base_angle = i as f64 * angle_step;
        
        // Add noise-based variation to make the ring more organic
        let noise_x = center_x_f + base_angle.cos() * 20.0;
        let noise_y = center_y_f + base_angle.sin() * 20.0;
        let radius_noise = noise.get([noise_x * 0.01, noise_y * 0.01, 8000.0]);
        let angle_noise = noise.get([noise_x * 0.015, noise_y * 0.015, 8500.0]);
        
        // Vary the radius and angle slightly for organic look
        let varied_radius = base_ring_radius + radius_noise * 15.0; // ±15 tile variation
        let varied_angle = base_angle + angle_noise * 0.3; // ±0.3 radian variation
        
        // Calculate point position
        let x = center_x_f + varied_angle.cos() * varied_radius;
        let y = center_y_f + varied_angle.sin() * varied_radius;
        
        // Ensure point is within bounds with some margin
        let x = x.max(25.0).min(width as f64 - 25.0);
        let y = y.max(25.0).min(height as f64 - 25.0);
        
        ring_points.push((x as i32, y as i32));
    }
    
    // Connect the ring points to form a continuous road
    for i in 0..ring_points.len() {
        let current = ring_points[i];
        let next = ring_points[(i + 1) % ring_points.len()]; // Wrap around to close the ring
        
        // Draw road segment between current and next point
        draw_road_segment_between_points(roads, current.0, current.1, next.0, next.1, width, height);
    }
    
    // Connect ring road to the main cross roads at strategic points
    connect_ring_to_cross_roads(roads, &ring_points, center_x, center_y, width, height);
}

fn draw_road_segment_between_points(roads: &mut Vec<Vec<bool>>, x1: i32, y1: i32, x2: i32, y2: i32, width: usize, height: usize) {
    // Use Bresenham's line algorithm to draw road between two points
    let dx = (x2 - x1).abs();
    let dy = (y2 - y1).abs();
    let sx = if x1 < x2 { 1 } else { -1 };
    let sy = if y1 < y2 { 1 } else { -1 };
    let mut err = dx - dy;
    
    let mut x = x1;
    let mut y = y1;
    
    loop {
        // Draw road with width (3x3 for visibility)
        for dy_offset in -1..=1 {
            for dx_offset in -1..=1 {
                let road_x = (x + dx_offset) as usize;
                let road_y = (y + dy_offset) as usize;
                if road_x < width && road_y < height {
                    roads[road_y][road_x] = true;
                }
            }
        }
        
        if x == x2 && y == y2 {
            break;
        }
        
        let e2 = 2 * err;
        if e2 > -dy {
            err -= dy;
            x += sx;
        }
        if e2 < dx {
            err += dx;
            y += sy;
        }
    }
}

fn connect_ring_to_cross_roads(roads: &mut Vec<Vec<bool>>, ring_points: &[(i32, i32)], center_x: usize, center_y: usize, width: usize, height: usize) {
    // Find 4 connection points on the ring road that align roughly with the cross roads
    let quarter_points = ring_points.len() / 4;
    
    let connection_indices = [
        0,                           // North
        quarter_points,              // East  
        quarter_points * 2,          // South
        quarter_points * 3,          // West
    ];
    
    // Connect each quarter point to an intermediate point between ring and center
    for &idx in &connection_indices {
        if idx < ring_points.len() {
            let ring_point = ring_points[idx];
            
            // Calculate intermediate point (halfway between ring and center)
            let intermediate_x = (ring_point.0 + center_x as i32) / 2;
            let intermediate_y = (ring_point.1 + center_y as i32) / 2;
            
            // Draw connecting road from ring to intermediate point
            draw_road_segment_between_points(roads, ring_point.0, ring_point.1, intermediate_x, intermediate_y, width, height);
        }
    }
}

fn generate_dirt_paths(config: &WorldGenConfig, noise: &Perlin, road_network: &[Vec<bool>], width: usize, height: usize) -> Vec<Vec<bool>> {
    // DISABLED: No more dirt paths to prevent loops
    // Only keep the main cross-island roads (handled in road_network)
    vec![vec![false; width]; height]
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
    
    // Roads (main cross-island diagonals and center compound)
    if features.road_network[y][x] {
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
        chunk_size: 10,
        island_border_width: 8,
        beach_width: 6,
        river_frequency: 0.8,
        dirt_patch_frequency: 0.3,
        road_density: 0.2,
    };
    
    generate_world(ctx, default_config)
}

#[spacetimedb::reducer]
pub fn generate_minimap_data(ctx: &ReducerContext, minimap_width: u32, minimap_height: u32) -> Result<(), String> {
    log::info!("Generating minimap data ({}x{}) from stored world tiles", minimap_width, minimap_height);
    
    // PRE-LOAD ALL TILES INTO HASHMAP FOR INSTANT LOOKUPS (99% faster!)
    let mut tile_map: HashMap<(i32, i32), TileType> = HashMap::new();
    
    for tile in ctx.db.world_tile().iter() {
        tile_map.insert((tile.world_x, tile.world_y), tile.tile_type.clone());
    }
    
    // Calculate sampling ratios based on actual world size in tiles
    let world_width_tiles = 500.0; // Known world size
    let world_height_tiles = 500.0;
    let sample_step_x = world_width_tiles / minimap_width as f64;
    let sample_step_y = world_height_tiles / minimap_height as f64;
    
    // Generate minimap data by sampling the actual stored world tiles
    let mut minimap_data = Vec::new();
    
    for y in 0..minimap_height {
        for x in 0..minimap_width {
            // Calculate which world tile to sample for this minimap pixel
            let world_tile_x = (x as f64 * sample_step_x) as i32;
            let world_tile_y = (y as f64 * sample_step_y) as i32;
            
            // INSTANT O(1) LOOKUP instead of filter + manual search!
            let found_tile_type = tile_map.get(&(world_tile_x, world_tile_y))
                .cloned()
                .unwrap_or(TileType::Sea); // Default to sea if no tile found
            
            // Convert tile type to color value (0-255)
            let color_value = match found_tile_type {
                TileType::Sea => 0,        // Dark blue water (matches client [19, 69, 139])
                TileType::Beach => 64,     // Muted sandy beach (matches client [194, 154, 108])
                TileType::Sand => 96,      // Darker sand (matches client [180, 142, 101])
                TileType::Grass => 128,    // Muted forest green (matches client [76, 110, 72])
                TileType::Dirt => 192,     // Dark brown dirt (matches client [101, 67, 33])
                TileType::DirtRoad => 224, // Very dark brown roads (matches client [71, 47, 24])
            };
            
            minimap_data.push(color_value);
        }
    }
    
    // Clear any existing minimap cache
    for cache in ctx.db.minimap_cache().iter() {
        ctx.db.minimap_cache().id().delete(&cache.id);
    }
    
    // Store the new minimap data
    ctx.db.minimap_cache().insert(MinimapCache {
        id: 0, // auto_inc
        width: minimap_width,
        height: minimap_height,
        data: minimap_data,
        generated_at: ctx.timestamp,
    });
    
    log::info!("Minimap data generated successfully from {} stored world tiles", tile_map.len());
    Ok(())
}

#[spacetimedb::reducer]
pub fn get_minimap_data(ctx: &ReducerContext) -> Result<(), String> {
    // This reducer just triggers the minimap data to be sent to clients
    // The actual data is retrieved via subscription to the minimap_cache table
    log::info!("Minimap data requested");
    Ok(())
}

pub fn generate_compressed_chunk_data(ctx: &ReducerContext) -> Result<(), String> {
    log::info!("Generating compressed chunk data from world tiles...");
    
    let world_tiles = ctx.db.world_tile();
    let world_chunk_data = ctx.db.world_chunk_data();
    
    // Group tiles by chunk coordinates
    let mut chunk_tiles: std::collections::HashMap<(i32, i32), Vec<crate::WorldTile>> = std::collections::HashMap::new();
    
    for tile in world_tiles.iter() {
        let chunk_key = (tile.chunk_x, tile.chunk_y);
        chunk_tiles.entry(chunk_key).or_insert_with(Vec::new).push(tile);
    }
    
    let mut chunks_processed = 0;
    let total_chunks = chunk_tiles.len();
    
    for ((chunk_x, chunk_y), mut tiles) in chunk_tiles {
        // Sort tiles by their local position for consistent ordering
        tiles.sort_by(|a, b| {
            a.tile_y.cmp(&b.tile_y).then(a.tile_x.cmp(&b.tile_x))
        });
        
        // Calculate expected chunk size (should be CHUNK_SIZE_TILES x CHUNK_SIZE_TILES)
        let chunk_size = crate::environment::CHUNK_SIZE_TILES;
        let expected_tile_count = (chunk_size * chunk_size) as usize;
        
        // Initialize compressed arrays
        let mut tile_types = Vec::with_capacity(expected_tile_count);
        let mut variants = Vec::with_capacity(expected_tile_count);
        
        // Create a grid to ensure proper ordering
        let mut tile_grid: std::collections::HashMap<(i32, i32), &crate::WorldTile> = std::collections::HashMap::new();
        for tile in &tiles {
            tile_grid.insert((tile.tile_x, tile.tile_y), tile);
        }
        
        // Fill arrays in row-major order (y first, then x)
        for local_y in 0..chunk_size as i32 {
            for local_x in 0..chunk_size as i32 {
                if let Some(tile) = tile_grid.get(&(local_x, local_y)) {
                    tile_types.push(tile.tile_type.to_u8());
                    variants.push(tile.variant);
                } else {
                    // Fill missing tiles with default values (shouldn't happen in a well-generated world)
                    tile_types.push(crate::TileType::Grass.to_u8());
                    variants.push(0);
                    log::warn!("Missing tile at chunk ({}, {}) local position ({}, {})", 
                              chunk_x, chunk_y, local_x, local_y);
                }
            }
        }
        
        // Create compressed chunk data
        let compressed_chunk = crate::WorldChunkData {
            id: 0, // auto_inc
            chunk_x,
            chunk_y,
            chunk_size,
            tile_types,
            variants,
            generated_at: ctx.timestamp,
        };
        
        // Insert compressed chunk data
        match world_chunk_data.try_insert(compressed_chunk) {
            Ok(_) => {
                chunks_processed += 1;
                if chunks_processed % 100 == 0 || chunks_processed == total_chunks {
                    log::info!("Compressed chunk data: {}/{} chunks processed", chunks_processed, total_chunks);
                }
            }
            Err(e) => {
                log::error!("Failed to insert compressed chunk data for chunk ({}, {}): {}", 
                           chunk_x, chunk_y, e);
            }
        }
    }
    
    log::info!("Compressed chunk data generation complete: {} chunks processed from {} total world tiles", 
               chunks_processed, world_tiles.iter().count());
    
    Ok(())
} 