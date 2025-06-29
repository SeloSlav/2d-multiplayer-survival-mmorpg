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
use crate::harvestable_resource::{harvestable_resource as HarvestableResourceTableTrait};
use crate::plants_database::PlantType;
use crate::world_state::{world_state as WorldStateTableTrait, WeatherType, TimeOfDay};
use crate::cloud::cloud as CloudTableTrait;
use crate::campfire::campfire as CampfireTableTrait;
use crate::lantern::lantern as LanternTableTrait;
use crate::shelter::shelter as ShelterTableTrait;
// Import water tile detection from fishing module
use crate::fishing::is_water_tile;

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
    pub plant_type: PlantType,    // What plant this will become when mature
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
    plant_type: PlantType, // Changed from target_resource_name to plant_type
}

/// Get growth configuration for a seed type
fn get_growth_config(seed_type: &str) -> Option<GrowthConfig> {
    match seed_type {
        "Mushroom Spores" => Some(GrowthConfig {
            min_growth_time_secs: 300,  // 5 minutes
            max_growth_time_secs: 600,  // 10 minutes
            plant_type: PlantType::Mushroom,
        }),
        "Hemp Seeds" => Some(GrowthConfig {
            min_growth_time_secs: 480,  // 8 minutes
            max_growth_time_secs: 900,  // 15 minutes
            plant_type: PlantType::Hemp,
        }),
        "Corn Seeds" => Some(GrowthConfig {
            min_growth_time_secs: 900,  // 15 minutes
            max_growth_time_secs: 1500, // 25 minutes
            plant_type: PlantType::Corn,
        }),
        "Seed Potato" => Some(GrowthConfig {
            min_growth_time_secs: 1200, // 20 minutes
            max_growth_time_secs: 1800, // 30 minutes
            plant_type: PlantType::Potato,
        }),
        "Pumpkin Seeds" => Some(GrowthConfig {
            min_growth_time_secs: 1500, // 25 minutes
            max_growth_time_secs: 2400, // 40 minutes
            plant_type: PlantType::Pumpkin,
        }),
        "Reed Rhizome" => Some(GrowthConfig {
            min_growth_time_secs: 600,  // 10 minutes
            max_growth_time_secs: 1200, // 20 minutes
            plant_type: PlantType::Reed,
        }),
        _ => None,
    }
}

// --- Constants ---

const PLANT_GROWTH_CHECK_INTERVAL_SECS: u64 = 30; // Check every 30 seconds

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

/// Calculate crowding penalty for a specific planted seed based on nearby plants
/// Returns a multiplier between 0.1 (severely crowded) and 1.0 (no crowding)
fn get_crowding_penalty_multiplier(ctx: &ReducerContext, plant_x: f32, plant_y: f32, plant_id: u64) -> f32 {
    let mut crowding_penalty = 0.0f32;
    
    // Distance thresholds for different penalty levels
    const SEVERE_CROWDING_DISTANCE_SQ: f32 = 30.0 * 30.0;  // 30px - severe penalty
    const MODERATE_CROWDING_DISTANCE_SQ: f32 = 50.0 * 50.0; // 50px - moderate penalty  
    const LIGHT_CROWDING_DISTANCE_SQ: f32 = 80.0 * 80.0;   // 80px - light penalty
    
    // Check all other planted seeds for crowding effects
    for other_plant in ctx.db.planted_seed().iter() {
        // Skip self
        if other_plant.id == plant_id {
            continue;
        }
        
        // Calculate distance to other plant
        let dx = plant_x - other_plant.pos_x;
        let dy = plant_y - other_plant.pos_y;
        let distance_sq = dx * dx + dy * dy;
        
        // Apply penalties based on distance
        if distance_sq <= SEVERE_CROWDING_DISTANCE_SQ {
            // Severe crowding: 70% growth reduction
            crowding_penalty += 0.7;
        } else if distance_sq <= MODERATE_CROWDING_DISTANCE_SQ {
            // Moderate crowding: 40% growth reduction
            crowding_penalty += 0.4;
        } else if distance_sq <= LIGHT_CROWDING_DISTANCE_SQ {
            // Light crowding: 15% growth reduction
            crowding_penalty += 0.15;
        }
        // Beyond 80px: no penalty
    }
    
    // Convert penalty to multiplier
    // Cap maximum penalty at 90% (minimum 10% growth rate)
    let total_penalty = crowding_penalty.min(0.9);
    let multiplier = 1.0 - total_penalty;
    
    // Log significant crowding effects
    if total_penalty > 0.2 {
        log::debug!("Plant at ({:.1}, {:.1}) has {:.1}% crowding penalty (growth rate: {:.1}%)", 
                   plant_x, plant_y, total_penalty * 100.0, multiplier * 100.0);
    }
    
    multiplier.max(0.1) // Ensure minimum 10% growth rate
}

/// Calculate shelter penalty for a specific planted seed
/// Returns a multiplier of 0.1 (90% penalty) if inside any shelter, 1.0 otherwise
fn get_shelter_penalty_multiplier(ctx: &ReducerContext, plant_x: f32, plant_y: f32) -> f32 {
    // Check if plant is inside any shelter
    for shelter in ctx.db.shelter().iter() {
        if shelter.is_destroyed { 
            continue; 
        }
        
        // Use the shelter's collision detection logic to check if plant is inside
        if crate::shelter::is_player_inside_shelter(plant_x, plant_y, &shelter) {
            log::info!(
                "Plant at ({:.1}, {:.1}) is inside Shelter {} - applying 90% growth penalty", 
                plant_x, plant_y, shelter.id
            );
            return 0.1; // 90% penalty - only 10% growth rate
        }
    }
    
    1.0 // No penalty if not inside any shelter
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

// --- Shore Distance Calculation ---

/// Calculate distance from a position to the nearest shore
/// Returns distance in pixels (same units as world coordinates)
/// Adapted from FishingManager.tsx logic but optimized for server use
fn calculate_shore_distance(ctx: &ReducerContext, x: f32, y: f32) -> f32 {
    // Use efficient radial search instead of grid search
    // This reduces checks from ~1,000 to ~50-100 and stops early when shore is found
    
    const MAX_SEARCH_RADIUS: f32 = 200.0; // Maximum search distance in pixels
    const RADIUS_STEP: f32 = 16.0; // Check every 16 pixels radially
    const ANGLE_STEP: f32 = std::f32::consts::PI / 8.0; // Check 16 directions (22.5° apart)
    
    let mut min_distance = MAX_SEARCH_RADIUS;
    
    // Search outward in concentric circles
    let mut radius = RADIUS_STEP;
    while radius <= MAX_SEARCH_RADIUS {
        let mut found_shore_at_this_radius = false;
        
        // Check points around the circle at this radius
        let mut angle = 0.0;
        while angle < std::f32::consts::PI * 2.0 {
            let check_x = x + angle.cos() * radius;
            let check_y = y + angle.sin() * radius;
            
            // If this position is not water (i.e., it's shore/land)
            if !is_water_tile(ctx, check_x, check_y) {
                min_distance = min_distance.min(radius);
                found_shore_at_this_radius = true;
            }
            
            angle += ANGLE_STEP;
        }
        
        // Early exit: if we found shore at this radius, we don't need to search further
        // (since we're searching outward, this is likely the minimum distance)
        if found_shore_at_this_radius {
            break;
        }
        
        radius += RADIUS_STEP;
    }
    
    min_distance
}

/// Validate reed rhizome planting location
/// Reed rhizomes can only be planted on water tiles within 20 meters of shore
fn validate_reed_rhizome_planting(ctx: &ReducerContext, x: f32, y: f32) -> Result<(), String> {
    // First check if it's a water tile
    if !is_water_tile(ctx, x, y) {
        return Err("Reed Rhizome can only be planted in water".to_string());
    }
    
    // Check distance to shore (20 meters = ~200 pixels at current scale)
    const MAX_SHORE_DISTANCE: f32 = 200.0; // 20 meters in pixels
    let shore_distance = calculate_shore_distance(ctx, x, y);
    
    if shore_distance > MAX_SHORE_DISTANCE {
        return Err(format!("Reed Rhizome must be planted within 20m of shore (current distance: {:.1}m)", shore_distance / 10.0));
    }
    
    log::info!("Reed Rhizome planting validated at ({:.1}, {:.1}) - {:.1}m from shore", x, y, shore_distance / 10.0);
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
    
    log::info!("PLANT_SEED: Player {:?} attempting to plant item {} at ({:.1}, {:.1})", 
              player_id, item_instance_id, plant_pos_x, plant_pos_y);
    
    // Find the player
    let player = ctx.db.player().identity().find(player_id)
        .ok_or_else(|| {
            log::error!("PLANT_SEED: Player not found: {:?}", player_id);
            "Player not found".to_string()
        })?;
    
    // Check distance from player (can't plant too far away)
    let dx = player.position_x - plant_pos_x;
    let dy = player.position_y - plant_pos_y;
    let distance_sq = dx * dx + dy * dy;
    const MAX_PLANTING_DISTANCE_SQ: f32 = 150.0 * 150.0;
    
    log::info!("PLANT_SEED: Player at ({:.1}, {:.1}), planting at ({:.1}, {:.1}), distance: {:.1}px", 
              player.position_x, player.position_y, plant_pos_x, plant_pos_y, distance_sq.sqrt());
    
    if distance_sq > MAX_PLANTING_DISTANCE_SQ {
        log::error!("PLANT_SEED: Too far away - distance {:.1}px > {:.1}px max", 
                   distance_sq.sqrt(), MAX_PLANTING_DISTANCE_SQ.sqrt());
        return Err("Too far away to plant there".to_string());
    }
    
    // Find the seed item in player's inventory
    let seed_item = ctx.db.inventory_item().instance_id().find(item_instance_id)
        .ok_or_else(|| {
            log::error!("PLANT_SEED: Seed item not found: {}", item_instance_id);
            "Seed item not found".to_string()
        })?;
    
    log::info!("PLANT_SEED: Found seed item: {} (quantity: {})", seed_item.item_def_id, seed_item.quantity);
    
    // Validate ownership
    let item_location = &seed_item.location;
    let is_owned = match item_location {
        crate::models::ItemLocation::Inventory(data) => data.owner_id == player_id,
        crate::models::ItemLocation::Hotbar(data) => data.owner_id == player_id,
        _ => false,
    };
    
    if !is_owned {
        log::error!("PLANT_SEED: Player {:?} doesn't own item {}", player_id, item_instance_id);
        return Err("You don't own this item".to_string());
    }
    
    // Get the item definition
    let item_def = ctx.db.item_definition().id().find(seed_item.item_def_id)
        .ok_or_else(|| {
            log::error!("PLANT_SEED: Item definition not found: {}", seed_item.item_def_id);
            "Item definition not found".to_string()
        })?;
    
    log::info!("PLANT_SEED: Item definition found: {}", item_def.name);
    
    // Verify it's a plantable seed
    let growth_config = get_growth_config(&item_def.name)
        .ok_or_else(|| {
            log::error!("PLANT_SEED: '{}' is not a plantable seed", item_def.name);
            format!("'{}' is not a plantable seed", item_def.name)
        })?;
    
    // Special validation for Reed Rhizome - must be planted on water near shore
    if item_def.name == "Reed Rhizome" {
        if let Err(e) = validate_reed_rhizome_planting(ctx, plant_pos_x, plant_pos_y) {
            log::error!("PLANT_SEED: Reed Rhizome validation failed: {}", e);
            return Err(e);
        }
    }
    
    // Calculate growth time
    let growth_time_secs = if growth_config.min_growth_time_secs >= growth_config.max_growth_time_secs {
        growth_config.min_growth_time_secs
    } else {
        ctx.rng().gen_range(growth_config.min_growth_time_secs..=growth_config.max_growth_time_secs)
    };
    
    let maturity_time = ctx.timestamp + TimeDuration::from(Duration::from_secs(growth_time_secs));
    let chunk_index = calculate_chunk_index(plant_pos_x, plant_pos_y);
    
    log::info!("PLANT_SEED: Creating planted seed - growth time: {}s, chunk: {}", growth_time_secs, chunk_index);
    
    // Create the planted seed with initial maturity estimate
    // Note: will_mature_at will be dynamically updated based on environmental conditions
    let planted_seed = PlantedSeed {
        id: 0, // Auto-inc
        pos_x: plant_pos_x,
        pos_y: plant_pos_y,
        chunk_index,
        seed_type: item_def.name.clone(),
        plant_type: growth_config.plant_type, // Store the target plant type directly
        planted_at: ctx.timestamp,
        will_mature_at: maturity_time, // Initial estimate, will be updated dynamically
        planted_by: player_id,
        growth_progress: 0.0,
        base_growth_time_secs: growth_time_secs,
        last_growth_update: ctx.timestamp,
    };
    
    match ctx.db.planted_seed().try_insert(planted_seed) {
        Ok(inserted) => {
            log::info!("PLANT_SEED: Successfully inserted planted seed with ID: {}", inserted.id);
        }
        Err(e) => {
            log::error!("PLANT_SEED: Failed to insert planted seed: {}", e);
            return Err(format!("Failed to plant seed: {}", e));
        }
    }
    
    // Remove the seed item from inventory (consume 1)
    if seed_item.quantity > 1 {
        let mut updated_item = seed_item;
        updated_item.quantity -= 1;
        let new_quantity = updated_item.quantity; // Store quantity before move
        ctx.db.inventory_item().instance_id().update(updated_item);
        log::info!("PLANT_SEED: Reduced seed quantity to {}", new_quantity);
    } else {
        ctx.db.inventory_item().instance_id().delete(item_instance_id);
        log::info!("PLANT_SEED: Deleted last seed item");
    }
    
    log::info!("PLANT_SEED: SUCCESS - Player {:?} planted {} at ({:.1}, {:.1}) - will mature in {} seconds", 
              player_id, item_def.name, plant_pos_x, plant_pos_y, growth_time_secs);
    
    // Emit plant seed sound
    crate::sound_events::emit_plant_seed_sound(ctx, plant_pos_x, plant_pos_y, player_id);
    
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
        
        // Calculate crowding penalty for this specific plant
        let crowding_multiplier = get_crowding_penalty_multiplier(ctx, plant.pos_x, plant.pos_y, plant.id);
        
        // Calculate shelter penalty for this specific plant
        let shelter_multiplier = get_shelter_penalty_multiplier(ctx, plant.pos_x, plant.pos_y);
        
        // Calculate water patch bonus for this specific plant
        let water_multiplier = crate::water_patch::get_water_patch_growth_multiplier(ctx, plant.pos_x, plant.pos_y);
        
        // Combine all growth modifiers for this plant
        let total_growth_multiplier = base_growth_multiplier * cloud_multiplier * light_multiplier * crowding_multiplier * shelter_multiplier * water_multiplier;
        
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
                log::debug!("Plant {} ({}) grew from {:.1}% to {:.1}% (base: {:.2}x, cloud: {:.2}x, light: {:.2}x, crowding: {:.2}x, shelter: {:.2}x, water: {:.2}x, total: {:.2}x)", 
                           plant_id, plant_type, old_progress * 100.0, progress_pct, 
                           base_growth_multiplier, cloud_multiplier, light_multiplier, crowding_multiplier, shelter_multiplier, water_multiplier, total_growth_multiplier);
            }
        }
    }
    
    if plants_matured > 0 || plants_updated > 0 {
        log::info!("Growth check: {} plants matured, {} plants updated (base rate: {:.2}x, cloud/light/crowding/shelter effects vary per plant)", 
                  plants_matured, plants_updated, base_growth_multiplier);
    }
    
    Ok(())
}

// --- Growth Helper Functions ---

/// Converts a planted seed into its corresponding harvestable resource
fn grow_plant_to_resource(ctx: &ReducerContext, plant: &PlantedSeed) -> Result<(), String> {
    let growth_config = get_growth_config(&plant.seed_type)
        .ok_or_else(|| format!("Unknown seed type: {}", plant.seed_type))?;
    
    // Create the harvestable resource using the unified system
    let harvestable_resource = crate::harvestable_resource::create_harvestable_resource(
        growth_config.plant_type, // No need to clone since PlantType now implements Copy
        plant.pos_x,
        plant.pos_y,
        plant.chunk_index
    );
    
    match ctx.db.harvestable_resource().try_insert(harvestable_resource) {
        Ok(inserted_resource) => {
            log::info!(
                "Successfully grew {:?} from {} at ({:.1}, {:.1}), ID: {}",
                growth_config.plant_type, plant.seed_type, plant.pos_x, plant.pos_y, inserted_resource.id
            );
            Ok(())
        }
        Err(e) => {
            log::error!(
                "Failed to insert grown {:?} from {}: {}",
                growth_config.plant_type, plant.seed_type, e
            );
            Err(format!("Failed to create harvestable resource: {}", e))
        }
    }
} 