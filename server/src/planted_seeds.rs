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
    pub seed_type: String,        // "Potato Seeds", "Corn Seeds", etc.
    pub planted_at: Timestamp,    // When it was planted
    pub will_mature_at: Timestamp, // When it becomes harvestable
    pub planted_by: Identity,     // Who planted it
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
        "Potato Seeds" => Some(GrowthConfig {
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
    
    // Create the planted seed
    let planted_seed = PlantedSeed {
        id: 0, // Auto-inc
        pos_x: plant_pos_x,
        pos_y: plant_pos_y,
        chunk_index,
        seed_type: item_def.name.clone(),
        planted_at: ctx.timestamp,
        will_mature_at: maturity_time,
        planted_by: player_id,
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
    let mut plants_matured = 0;
    
    // Find all plants ready to mature
    let mature_plants: Vec<PlantedSeed> = ctx.db.planted_seed().iter()
        .filter(|plant| plant.will_mature_at <= current_time)
        .collect();
    
    for plant in mature_plants {
        match grow_plant_to_resource(ctx, &plant) {
            Ok(()) => {
                plants_matured += 1;
                // Remove the planted seed entry
                ctx.db.planted_seed().id().delete(plant.id);
            }
            Err(e) => {
                log::error!("Failed to grow plant {} ({}): {}", plant.id, plant.seed_type, e);
                // Keep the plant for retry next check
            }
        }
    }
    
    if plants_matured > 0 {
        log::info!("Matured {} plants during growth check", plants_matured);
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
        "Potato Seeds" => {
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