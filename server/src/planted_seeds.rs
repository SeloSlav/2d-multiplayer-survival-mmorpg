/******************************************************************************
 *                                                                            *
 * Defines the planted seeds farming system including planting, growth,       *
 * and harvesting mechanics. Players can plant seeds which grow over time     *
 * into harvestable resources, creating a sustainable farming cycle.          *
 *                                                                            *
 ******************************************************************************/

// Standard library imports
use std::time::Duration;

// SpacetimeDB imports
use spacetimedb::{table, reducer, ReducerContext, Identity, Timestamp, Table, log, TimeDuration};
use spacetimedb::spacetimedb_lib::ScheduleAt;
use rand::Rng;

// Table trait imports for database access
use crate::items::{inventory_item as InventoryItemTableTrait, item_definition as ItemDefinitionTableTrait};
use crate::player as PlayerTableTrait;
use crate::environment::calculate_chunk_index;
use crate::mushroom::mushroom as MushroomTableTrait;
use crate::hemp::hemp as HempTableTrait;
use crate::corn::corn as CornTableTrait;
use crate::potato::potato as PotatoTableTrait;
use crate::reed::reed as ReedTableTrait;
use crate::pumpkin::pumpkin as PumpkinTableTrait;
use crate::world_state::{world_state as WorldStateTableTrait, WeatherType, TimeOfDay};
use crate::cloud::cloud as CloudTableTrait;
use crate::campfire::campfire as CampfireTableTrait;
use crate::lantern::lantern as LanternTableTrait;

// --- Planted Seed Tracking Table ---

#[spacetimedb::table(name = planted_seed, public)]
#[derive(Clone, Debug)]
pub struct PlantedSeed {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub pos_x: f32,
    pub pos_y: f32,
    pub chunk_index: u32,
    pub seed_type: String,        // "Seed Potato", "Corn Seeds", etc.
    pub planted_at: Timestamp,    // When it was planted
    pub will_mature_at: Timestamp, // When it becomes harvestable (dynamically updated)
    pub planted_by: Identity,     // Who planted it
    pub growth_progress: f32,     // 0.0 to 1.0 - actual growth accumulated
    pub base_growth_time_secs: u64, // Base time needed to reach maturity
    pub last_growth_update: Timestamp, // Last time growth was calculated
}

// --- Growth Schedule Table ---

#[spacetimedb::table(name = planted_seed_growth_schedule, scheduled(check_plant_growth))]
#[derive(Clone)]
pub struct PlantedSeedGrowthSchedule {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub scheduled_at: ScheduleAt,
}

// --- Growth Configuration ---

/// Growth time configuration for different seed types
struct GrowthConfig {
    min_growth_time_secs: u64,
    max_growth_time_secs: u64,
    target_resource_name: &'static str,
}

/// Get growth configuration for a seed type
fn get_growth_config(seed_type: &str) -> Option<GrowthConfig> {
    match seed_type {
        "Mushroom Spores" => Some(GrowthConfig {
            min_growth_time_secs: 300,  // 5 minutes
            max_growth_time_secs: 600,  // 10 minutes
            target_resource_name: "Mushroom",
        }),
        "Hemp Seeds" => Some(GrowthConfig {
            min_growth_time_secs: 480,  // 8 minutes
            max_growth_time_secs: 900,  // 15 minutes
            target_resource_name: "Plant Fiber",
        }),
        "Corn Seeds" => Some(GrowthConfig {
            min_growth_time_secs: 900,  // 15 minutes
            max_growth_time_secs: 1500, // 25 minutes
            target_resource_name: "Corn",
        }),
        "Seed Potato" => Some(GrowthConfig {
            min_growth_time_secs: 720,  // 12 minutes
            max_growth_time_secs: 1200, // 20 minutes
            target_resource_name: "Potato",
        }),
        "Reed Rhizome" => Some(GrowthConfig {
            min_growth_time_secs: 600,  // 10 minutes
            max_growth_time_secs: 1080, // 18 minutes
            target_resource_name: "Common Reed Stalk",
        }),
        "Pumpkin Seeds" => Some(GrowthConfig {
            min_growth_time_secs: 1200, // 20 minutes
            max_growth_time_secs: 2100, // 35 minutes
            target_resource_name: "Pumpkin",
        }),
        _ => None,
    }
}

// --- Constants ---

const PLANT_GROWTH_CHECK_INTERVAL_SECS: u64 = 30; // Check every 30 seconds
const MIN_PLANTING_DISTANCE_SQ: f32 = 50.0 * 50.0; // Minimum distance between plants

// --- Growth Rate Modifiers ---

/// Growth rate multipliers based on time of day
fn get_time_of_day_growth_multiplier(time_of_day: &TimeOfDay) -> f32 {
    match time_of_day {
        TimeOfDay::Dawn => 0.3,           // Slow growth at dawn
        TimeOfDay::TwilightMorning => 0.5, // Building up
        TimeOfDay::Morning => 1.0,        // Normal growth
        TimeOfDay::Noon => 1.5,           // Peak growth (most sunlight)
        TimeOfDay::Afternoon => 1.2,     // Good growth
        TimeOfDay::Dusk => 0.4,           // Slowing down
        TimeOfDay::TwilightEvening => 0.2, // Very slow
        TimeOfDay::Night => 0.0,          // No growth at night
        TimeOfDay::Midnight => 0.0,       // No growth at midnight
    }
}

/// Growth rate multipliers based on weather conditions
fn get_weather_growth_multiplier(weather: &WeatherType, rain_intensity: f32) -> f32 {
    match weather {
        WeatherType::Clear => 1.0,        // Normal growth
        WeatherType::LightRain => 1.3,    // Light rain helps growth
        WeatherType::ModerateRain => 1.6, // Moderate rain is very beneficial
        WeatherType::HeavyRain => 1.4,    // Heavy rain is good but not as much
        WeatherType::HeavyStorm => 0.8,   // Storm conditions slow growth
    }
}

/// Calculate cloud cover growth modifier for a specific planted seed
/// Returns a multiplier between 0.4 (heavy cloud cover) and 1.0 (no clouds)
fn get_cloud_cover_growth_multiplier(ctx: &ReducerContext, plant_x: f32, plant_y: f32) -> f32 {
    // Check if any clouds are covering this plant
    let mut cloud_coverage = 0.0f32;
    
    for cloud in ctx.db.cloud().iter() {
        // Calculate distance from plant to cloud center
        let dx = plant_x - cloud.pos_x;
        let dy = plant_y - cloud.pos_y;
        
        // Use elliptical coverage area based on cloud dimensions
        let half_width = cloud.width / 2.0;
        let half_height = cloud.height / 2.0;
        
        // Check if plant is within cloud's shadow area
        // Using simple ellipse formula: (x/a)² + (y/b)² <= 1
        if half_width > 0.0 && half_height > 0.0 {
            let normalized_x = dx / half_width;
            let normalized_y = dy / half_height;
            let distance_squared = normalized_x * normalized_x + normalized_y * normalized_y;
            
            if distance_squared <= 1.0 {
                // Plant is under this cloud - calculate coverage intensity
                // Closer to center = more coverage, fade out towards edges
                let coverage_intensity = (1.0 - distance_squared.sqrt()).max(0.0);
                
                // Factor in cloud opacity for coverage strength
                let effective_coverage = coverage_intensity * cloud.current_opacity;
                
                // Accumulate coverage (multiple clouds can overlap)
                cloud_coverage = (cloud_coverage + effective_coverage).min(1.0);
            }
        }
    }   
    
    // Convert coverage to growth multiplier
    // 0% coverage = 1.0x growth (full sunlight)
    // 100% coverage = 0.4x growth (significantly reduced but not stopped)
    let multiplier = 1.0 - (cloud_coverage * 0.6); // Reduces by up to 60%
    
    multiplier.max(0.4) // Ensure minimum 40% growth rate
}

/// Calculate light source growth modifier for a specific planted seed
/// Returns a multiplier that can enhance or reduce growth based on nearby light sources
fn get_light_source_growth_multiplier(ctx: &ReducerContext, plant_x: f32, plant_y: f32) -> f32 {
    let mut total_light_effect = 0.0f32;
    
    // Check nearby campfires (negative effect - too much heat/smoke)
    for campfire in ctx.db.campfire().iter() {
        if campfire.is_burning && !campfire.is_destroyed {
            let dx = plant_x - campfire.pos_x;
            let dy = plant_y - campfire.pos_y;
            let distance = (dx * dx + dy * dy).sqrt();
            
            // Campfire negative effect radius: 0-120 pixels
            const CAMPFIRE_MAX_EFFECT_DISTANCE: f32 = 120.0;
            const CAMPFIRE_OPTIMAL_DISTANCE: f32 = 80.0; // Distance where effect starts to diminish
            
            if distance < CAMPFIRE_MAX_EFFECT_DISTANCE {
                let effect_strength = if distance < CAMPFIRE_OPTIMAL_DISTANCE {
                    // Close to campfire: strong negative effect (too hot/smoky)
                    1.0 - (distance / CAMPFIRE_OPTIMAL_DISTANCE)
                } else {
                    // Far from campfire: diminishing negative effect
                    (CAMPFIRE_MAX_EFFECT_DISTANCE - distance) / (CAMPFIRE_MAX_EFFECT_DISTANCE - CAMPFIRE_OPTIMAL_DISTANCE)
                };
                
                // Campfire reduces growth by up to 40% when very close
                total_light_effect -= effect_strength * 0.4;
            }
        }
    }
    
    // Check nearby lanterns (positive effect - gentle light for photosynthesis)
    for lantern in ctx.db.lantern().iter() {
        if lantern.is_burning && !lantern.is_destroyed {
            let dx = plant_x - lantern.pos_x;
            let dy = plant_y - lantern.pos_y;
            let distance = (dx * dx + dy * dy).sqrt();
            
            // Lantern positive effect radius: 0-100 pixels
            const LANTERN_MAX_EFFECT_DISTANCE: f32 = 100.0;
            const LANTERN_OPTIMAL_DISTANCE: f32 = 60.0; // Distance for maximum benefit
            
            if distance < LANTERN_MAX_EFFECT_DISTANCE {
                let effect_strength = if distance < LANTERN_OPTIMAL_DISTANCE {
                    // Close to lantern: strong positive effect
                    1.0 - (distance / LANTERN_OPTIMAL_DISTANCE)
                } else {
                    // Far from lantern: diminishing positive effect
                    (LANTERN_MAX_EFFECT_DISTANCE - distance) / (LANTERN_MAX_EFFECT_DISTANCE - LANTERN_OPTIMAL_DISTANCE)
                };
                
                // Lantern can boost growth by up to 80% when very close
                // This is enough to provide normal growth even at night (0.0x base rate)
                total_light_effect += effect_strength * 0.8;
            }
        }
    }
    
    // Convert total light effect to growth multiplier
    // Base multiplier is 1.0, then add/subtract light effects
    let multiplier = 1.0 + total_light_effect;
    
    // Clamp between reasonable bounds
    // Minimum 0.2x (campfires can significantly slow growth but not stop it)
    // Maximum 2.0x (lanterns can provide substantial boost but not unlimited)
    multiplier.max(0.2).min(2.0)
}

/// Calculate the effective growth rate for current conditions
fn calculate_growth_rate_multiplier(ctx: &ReducerContext) -> f32 {
    // Get current world state
    let world_state = match ctx.db.world_state().iter().next() {
        Some(state) => state,
        None => {
            log::warn!("No WorldState found for growth calculation, using default multiplier");
            return 0.5; // Default moderate growth if no world state
        }
    };
    
    let time_multiplier = get_time_of_day_growth_multiplier(&world_state.time_of_day);
    let weather_multiplier = get_weather_growth_multiplier(&world_state.current_weather, world_state.rain_intensity);
    
    let total_multiplier = time_multiplier * weather_multiplier;
    
    log::debug!("Growth multiplier: time={:.2} * weather={:.2} = {:.2} (time={:?}, weather={:?})", 
               time_multiplier, weather_multiplier, total_multiplier, 
               world_state.time_of_day, world_state.current_weather);
    
    total_multiplier
}

// --- Initialization ---

/// Initialize the plant growth checking system (called from main init)
pub fn init_plant_growth_system(ctx: &ReducerContext) -> Result<(), String> {
    // Only start if no existing schedule
    if ctx.db.planted_seed_growth_schedule().count() == 0 {
        let check_interval = TimeDuration::from(Duration::from_secs(PLANT_GROWTH_CHECK_INTERVAL_SECS));
        
        ctx.db.planted_seed_growth_schedule().insert(PlantedSeedGrowthSchedule {
            id: 0, // Auto-inc
            scheduled_at: check_interval.into(), // Periodic scheduling
        });
        
        log::info!("Plant growth system initialized - checking every {} seconds", PLANT_GROWTH_CHECK_INTERVAL_SECS);
    }
    
    Ok(())
}

// --- Planting Reducer ---

/// Plants a seed item on the ground to grow into a resource
#[spacetimedb::reducer]
pub fn plant_seed(
    ctx: &ReducerContext, 
    item_instance_id: u64, 
    plant_pos_x: f32, 
    plant_pos_y: f32
) -> Result<(), String> {
    let player_id = ctx.sender;
    
    // Find the player
    let player = ctx.db.player().identity().find(player_id)
        .ok_or_else(|| "Player not found".to_string())?;
    
    // Check distance from player (can't plant too far away)
    let dx = player.position_x - plant_pos_x;
    let dy = player.position_y - plant_pos_y;
    let distance_sq = dx * dx + dy * dy;
    const MAX_PLANTING_DISTANCE_SQ: f32 = 150.0 * 150.0;
    
    if distance_sq > MAX_PLANTING_DISTANCE_SQ {
        return Err("Too far away to plant there".to_string());
    }
    
    // Find the seed item in player's inventory
    let seed_item = ctx.db.inventory_item().instance_id().find(item_instance_id)
        .ok_or_else(|| "Seed item not found".to_string())?;
    
    // Validate ownership
    let item_location = &seed_item.location;
    let is_owned = match item_location {
        crate::models::ItemLocation::Inventory(data) => data.owner_id == player_id,
        crate::models::ItemLocation::Hotbar(data) => data.owner_id == player_id,
        _ => false,
    };
    
    if !is_owned {
        return Err("You don't own this item".to_string());
    }
    
    // Get the item definition
    let item_def = ctx.db.item_definition().id().find(seed_item.item_def_id)
        .ok_or_else(|| "Item definition not found".to_string())?;
    
    // Verify it's a plantable seed
    let growth_config = get_growth_config(&item_def.name)
        .ok_or_else(|| format!("'{}' is not a plantable seed", item_def.name))?;
    
    // Check for nearby plants (prevent overcrowding)
    let nearby_plants = ctx.db.planted_seed().iter()
        .any(|plant| {
            let plant_dx = plant.pos_x - plant_pos_x;
            let plant_dy = plant.pos_y - plant_pos_y;
            let plant_distance_sq = plant_dx * plant_dx + plant_dy * plant_dy;
            plant_distance_sq < MIN_PLANTING_DISTANCE_SQ
        });
    
    if nearby_plants {
        return Err("Too close to another plant. Plants need space to grow.".to_string());
    }
    
    // Calculate growth time
    let growth_time_secs = if growth_config.min_growth_time_secs >= growth_config.max_growth_time_secs {
        growth_config.min_growth_time_secs
    } else {
        ctx.rng().gen_range(growth_config.min_growth_time_secs..=growth_config.max_growth_time_secs)
    };
    
    let maturity_time = ctx.timestamp + TimeDuration::from(Duration::from_secs(growth_time_secs));
    let chunk_index = calculate_chunk_index(plant_pos_x, plant_pos_y);
    
    // Create the planted seed with initial maturity estimate
    // Note: will_mature_at will be dynamically updated based on environmental conditions
    let planted_seed = PlantedSeed {
        id: 0, // Auto-inc
        pos_x: plant_pos_x,
        pos_y: plant_pos_y,
        chunk_index,
        seed_type: item_def.name.clone(),
        planted_at: ctx.timestamp,
        will_mature_at: maturity_time, // Initial estimate, will be updated dynamically
        planted_by: player_id,
        growth_progress: 0.0,
        base_growth_time_secs: growth_time_secs,
        last_growth_update: ctx.timestamp,
    };
    
    ctx.db.planted_seed().insert(planted_seed);
    
    // Remove the seed item from inventory (consume 1)
    if seed_item.quantity > 1 {
        let mut updated_item = seed_item;
        updated_item.quantity -= 1;
        ctx.db.inventory_item().instance_id().update(updated_item);
    } else {
        ctx.db.inventory_item().instance_id().delete(item_instance_id);
    }
    
    log::info!("Player {:?} planted {} at ({:.1}, {:.1}) - will mature in {} seconds", 
              player_id, item_def.name, plant_pos_x, plant_pos_y, growth_time_secs);
    
    Ok(())
}

// --- Scheduled Growth Checker ---

/// Scheduled reducer that checks for plants ready to mature
#[spacetimedb::reducer]
pub fn check_plant_growth(ctx: &ReducerContext, _args: PlantedSeedGrowthSchedule) -> Result<(), String> {
    // Security check - only allow scheduler to call this
    if ctx.sender != ctx.identity() {
        return Err("This reducer can only be called by the scheduler".to_string());
    }
    
    let current_time = ctx.timestamp;
    let base_growth_multiplier = calculate_growth_rate_multiplier(ctx);
    let mut plants_updated = 0;
    let mut plants_matured = 0;
    
    // Process all planted seeds to update their growth
    let all_plants: Vec<PlantedSeed> = ctx.db.planted_seed().iter().collect();
    
    for mut plant in all_plants {
        // Calculate time elapsed since last update
        let elapsed_micros = current_time.to_micros_since_unix_epoch()
            .saturating_sub(plant.last_growth_update.to_micros_since_unix_epoch());
        let elapsed_seconds = (elapsed_micros as f64 / 1_000_000.0) as f32;
        
        if elapsed_seconds <= 0.0 {
            continue; // No time has passed
        }
        
        // Calculate cloud cover effect for this specific plant
        let cloud_multiplier = get_cloud_cover_growth_multiplier(ctx, plant.pos_x, plant.pos_y);
        
        // Calculate light source effect for this specific plant
        let light_multiplier = get_light_source_growth_multiplier(ctx, plant.pos_x, plant.pos_y);
        
        // Combine all growth modifiers for this plant
        let total_growth_multiplier = base_growth_multiplier * cloud_multiplier * light_multiplier;
        
        // Calculate growth progress increment
        let base_growth_rate = 1.0 / plant.base_growth_time_secs as f32; // Progress per second at 1x multiplier
        let actual_growth_rate = base_growth_rate * total_growth_multiplier;
        let growth_increment = actual_growth_rate * elapsed_seconds;
        
        // Update growth progress
        let old_progress = plant.growth_progress;
        plant.growth_progress = (plant.growth_progress + growth_increment).min(1.0);
        plant.last_growth_update = current_time;
        
        // Update estimated maturity time based on current growth rate
        if total_growth_multiplier > 0.0 && plant.growth_progress < 1.0 {
            let remaining_progress = 1.0 - plant.growth_progress;
            let estimated_remaining_seconds = remaining_progress / actual_growth_rate;
            plant.will_mature_at = current_time + TimeDuration::from_micros((estimated_remaining_seconds * 1_000_000.0) as i64);
        }
        
        // Check if plant has matured
        if plant.growth_progress >= 1.0 {
            // Plant is ready to mature!
            let plant_clone = plant.clone(); // Clone for logging and resource creation
            match grow_plant_to_resource(ctx, &plant_clone) {
                Ok(()) => {
                    plants_matured += 1;
                    // Remove the planted seed entry
                    ctx.db.planted_seed().id().delete(plant.id);
                    log::info!("Plant {} ({}) matured at ({:.1}, {:.1}) after {:.1}% growth", 
                              plant_clone.id, plant_clone.seed_type, plant_clone.pos_x, plant_clone.pos_y, plant_clone.growth_progress * 100.0);
                }
                Err(e) => {
                    log::error!("Failed to grow plant {} ({}): {}", plant.id, plant.seed_type, e);
                    // Update the plant anyway to track progress
                    ctx.db.planted_seed().id().update(plant);
                    plants_updated += 1;
                }
            }
        } else {
            // Update the plant with new progress
            let plant_id = plant.id;
            let plant_type = plant.seed_type.clone();
            let progress_pct = plant.growth_progress * 100.0;
            ctx.db.planted_seed().id().update(plant);
            plants_updated += 1;
            
            if growth_increment > 0.0 {
                log::debug!("Plant {} ({}) grew from {:.1}% to {:.1}% (base: {:.2}x, cloud: {:.2}x, light: {:.2}x, total: {:.2}x)", 
                           plant_id, plant_type, old_progress * 100.0, progress_pct, 
                           base_growth_multiplier, cloud_multiplier, light_multiplier, total_growth_multiplier);
            }
        }
    }
    
    if plants_matured > 0 || plants_updated > 0 {
        log::info!("Growth check: {} plants matured, {} plants updated (base rate: {:.2}x, cloud/light effects vary per plant)", 
                  plants_matured, plants_updated, base_growth_multiplier);
    }
    
    Ok(())
}

// --- Growth Helper Functions ---

/// Converts a planted seed into its corresponding harvestable resource
fn grow_plant_to_resource(ctx: &ReducerContext, plant: &PlantedSeed) -> Result<(), String> {
    let growth_config = get_growth_config(&plant.seed_type)
        .ok_or_else(|| format!("Unknown seed type: {}", plant.seed_type))?;
    
    // Create the appropriate harvestable resource based on seed type
    match plant.seed_type.as_str() {
        "Mushroom Spores" => {
            let mushroom = crate::mushroom::Mushroom {
                id: 0, // Auto-inc
                pos_x: plant.pos_x,
                pos_y: plant.pos_y,
                chunk_index: plant.chunk_index,
                respawn_at: None, // Ready to harvest immediately
            };
            ctx.db.mushroom().insert(mushroom);
        }
        "Hemp Seeds" => {
            let hemp = crate::hemp::Hemp {
                id: 0, // Auto-inc
                pos_x: plant.pos_x,
                pos_y: plant.pos_y,
                chunk_index: plant.chunk_index,
                respawn_at: None, // Ready to harvest immediately
            };
            ctx.db.hemp().insert(hemp);
        }
        "Corn Seeds" => {
            let corn = crate::corn::Corn {
                id: 0, // Auto-inc
                pos_x: plant.pos_x,
                pos_y: plant.pos_y,
                chunk_index: plant.chunk_index,
                respawn_at: None, // Ready to harvest immediately
            };
            ctx.db.corn().insert(corn);
        }
        "Seed Potato" => {
            let potato = crate::potato::Potato {
                id: 0, // Auto-inc
                pos_x: plant.pos_x,
                pos_y: plant.pos_y,
                chunk_index: plant.chunk_index,
                respawn_at: None, // Ready to harvest immediately
            };
            ctx.db.potato().insert(potato);
        }
        "Reed Rhizome" => {
            let reed = crate::reed::Reed {
                id: 0, // Auto-inc
                pos_x: plant.pos_x,
                pos_y: plant.pos_y,
                chunk_index: plant.chunk_index,
                respawn_at: None, // Ready to harvest immediately
            };
            ctx.db.reed().insert(reed);
        }
        "Pumpkin Seeds" => {
            let pumpkin = crate::pumpkin::Pumpkin {
                id: 0, // Auto-inc
                pos_x: plant.pos_x,
                pos_y: plant.pos_y,
                chunk_index: plant.chunk_index,
                respawn_at: None, // Ready to harvest immediately
            };
            ctx.db.pumpkin().insert(pumpkin);
        }
        _ => {
            return Err(format!("Unknown seed type for growth: {}", plant.seed_type));
        }
    }
    
    log::info!("Planted {} (ID: {}) has grown into {} at ({:.1}, {:.1})", 
              plant.seed_type, plant.id, growth_config.target_resource_name, plant.pos_x, plant.pos_y);
    
    Ok(())
} 