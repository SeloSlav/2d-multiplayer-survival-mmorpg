use spacetimedb::{Table, ReducerContext, Identity, Timestamp, SpacetimeType};
use log;
use rand::Rng;
use std::collections::HashMap;
use lazy_static::lazy_static;

// Module imports
use crate::collectible_resources::{
    BASE_RESOURCE_RADIUS, PLAYER_RESOURCE_INTERACTION_DISTANCE_SQUARED,
    validate_player_resource_interaction,
    collect_resource_and_schedule_respawn,
    RespawnableResource
};

// Table trait imports for database access
use crate::items::{inventory_item as InventoryItemTableTrait, item_definition as ItemDefinitionTableTrait};
use crate::player as PlayerTableTrait;

// --- Plant Type Enum ---

#[derive(SpacetimeType, Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum PlantType {
    Corn,
    Hemp,
    Mushroom,
    Potato,
    Pumpkin,
    Reed,
}

// --- Plant Configuration System ---

#[derive(Clone, Debug)]
pub struct PlantConfig {
    // Spawning
    pub density_percent: f32,
    pub min_distance_sq: f32,
    pub min_tree_distance_sq: f32,
    pub min_stone_distance_sq: f32,
    pub noise_threshold: f32,
    
    // Yields
    pub primary_yield: (String, u32, u32), // (item_name, min_amount, max_amount)
    pub secondary_yield: Option<(String, u32, u32, f32)>, // (item_name, min, max, chance)
    
    // Seeds
    pub seed_type: String,
    pub seed_drop_chance: f32,
    
    // Respawn timing
    pub min_respawn_time_secs: u64,
    pub max_respawn_time_secs: u64,
    
    // Spawn conditions
    pub spawn_condition: SpawnCondition,
}

#[derive(Clone, Debug)]
pub enum SpawnCondition {
    Forest,      // Near trees (mushrooms)
    Plains,      // Away from trees/stones (hemp)
    NearWater,   // Close to water/sand (corn)
    Clearings,   // Dirt roads, clearings (potato)
    Coastal,     // Beach, riverside (pumpkin)
    InlandWater, // Along inland water (reed)
}

// --- Plant Configuration Database ---

lazy_static! {
    pub static ref PLANT_CONFIGS: HashMap<PlantType, PlantConfig> = {
        let mut configs = HashMap::new();
        
        configs.insert(PlantType::Corn, PlantConfig {
            density_percent: 0.0008,
            min_distance_sq: 40.0 * 40.0,
            min_tree_distance_sq: 20.0 * 20.0,
            min_stone_distance_sq: 25.0 * 25.0,
            noise_threshold: 0.70,
            primary_yield: ("Corn".to_string(), 1, 2),
            secondary_yield: Some(("Plant Fiber".to_string(), 2, 4, 0.90)),
            seed_type: "Corn Seeds".to_string(),
            seed_drop_chance: 0.15,
            min_respawn_time_secs: 900,  // 15 minutes
            max_respawn_time_secs: 1500, // 25 minutes
            spawn_condition: SpawnCondition::NearWater,
        });
        
        configs.insert(PlantType::Hemp, PlantConfig {
            density_percent: 0.00133,
            min_distance_sq: 35.0 * 35.0,
            min_tree_distance_sq: 20.0 * 20.0,
            min_stone_distance_sq: 20.0 * 20.0,
            noise_threshold: 0.68,
            primary_yield: ("Plant Fiber".to_string(), 50, 50),
            secondary_yield: None,
            seed_type: "Hemp Seeds".to_string(),
            seed_drop_chance: 0.12,
            min_respawn_time_secs: 600,  // 10 minutes
            max_respawn_time_secs: 900,  // 15 minutes
            spawn_condition: SpawnCondition::Plains,
        });
        
        configs.insert(PlantType::Mushroom, PlantConfig {
            density_percent: 0.0015,
            min_distance_sq: 30.0 * 30.0,
            min_tree_distance_sq: 25.0 * 25.0,
            min_stone_distance_sq: 30.0 * 30.0,
            noise_threshold: 0.65,
            primary_yield: ("Mushroom".to_string(), 1, 1),
            secondary_yield: None,
            seed_type: "Mushroom Spores".to_string(),
            seed_drop_chance: 0.10,
            min_respawn_time_secs: 300,  // 5 minutes
            max_respawn_time_secs: 600,  // 10 minutes
            spawn_condition: SpawnCondition::Forest,
        });
        
        configs.insert(PlantType::Potato, PlantConfig {
            density_percent: 0.0006,
            min_distance_sq: 35.0 * 35.0,
            min_tree_distance_sq: 18.0 * 18.0,
            min_stone_distance_sq: 22.0 * 22.0,
            noise_threshold: 0.65,
            primary_yield: ("Potato".to_string(), 1, 2),
            secondary_yield: Some(("Plant Fiber".to_string(), 1, 3, 0.80)),
            seed_type: "Seed Potato".to_string(),
            seed_drop_chance: 0.18,
            min_respawn_time_secs: 900,  // 15 minutes
            max_respawn_time_secs: 1800, // 30 minutes
            spawn_condition: SpawnCondition::Clearings,
        });
        
        configs.insert(PlantType::Pumpkin, PlantConfig {
            density_percent: 0.0004,
            min_distance_sq: 40.0 * 40.0,
            min_tree_distance_sq: 20.0 * 20.0,
            min_stone_distance_sq: 25.0 * 25.0,
            noise_threshold: 0.67,
            primary_yield: ("Pumpkin".to_string(), 1, 1),
            secondary_yield: Some(("Plant Fiber".to_string(), 3, 5, 0.85)),
            seed_type: "Pumpkin Seeds".to_string(),
            seed_drop_chance: 0.20,
            min_respawn_time_secs: 1200, // 20 minutes
            max_respawn_time_secs: 1800, // 30 minutes
            spawn_condition: SpawnCondition::Coastal,
        });
        
        configs.insert(PlantType::Reed, PlantConfig {
            density_percent: 0.003,
            min_distance_sq: 25.0 * 25.0,
            min_tree_distance_sq: 15.0 * 15.0,
            min_stone_distance_sq: 20.0 * 20.0,
            noise_threshold: 0.58,
            primary_yield: ("Common Reed Stalk".to_string(), 2, 4),
            secondary_yield: Some(("Plant Fiber".to_string(), 1, 3, 0.75)),
            seed_type: "Reed Rhizome".to_string(),
            seed_drop_chance: 0.14,
            min_respawn_time_secs: 600,  // 10 minutes
            max_respawn_time_secs: 900,  // 15 minutes
            spawn_condition: SpawnCondition::InlandWater,
        });
        
        configs
    };
}

// --- Unified Harvestable Resource Table ---

#[spacetimedb::table(name = harvestable_resource, public)]
#[derive(Clone, Debug)]
pub struct HarvestableResource {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub plant_type: PlantType,
    pub pos_x: f32,
    pub pos_y: f32,
    #[index(btree)]
    pub chunk_index: u32,
    pub respawn_at: Option<Timestamp>,
}

// Implement RespawnableResource trait for HarvestableResource
impl RespawnableResource for HarvestableResource {
    fn id(&self) -> u64 {
        self.id
    }
    
    fn pos_x(&self) -> f32 {
        self.pos_x
    }
    
    fn pos_y(&self) -> f32 {
        self.pos_y
    }
    
    fn respawn_at(&self) -> Option<Timestamp> {
        self.respawn_at
    }
    
    fn set_respawn_at(&mut self, time: Option<Timestamp>) {
        self.respawn_at = time;
    }
}

// --- Unified Generic Reducer ---

/// Handles player interactions with any harvestable resource type
#[spacetimedb::reducer]
pub fn interact_with_harvestable_resource(ctx: &ReducerContext, resource_id: u64) -> Result<(), String> {
    let player_id = ctx.sender;
    
    // Find the resource
    let resource = ctx.db.harvestable_resource().id().find(resource_id)
        .ok_or_else(|| format!("Harvestable resource {} not found", resource_id))?;

    // Check if already harvested and waiting for respawn
    if resource.respawn_at.is_some() {
        return Err("This resource has already been harvested and is respawning.".to_string());
    }
    
    // Validate player can interact with this resource (distance check)
    let _player = validate_player_resource_interaction(ctx, player_id, resource.pos_x, resource.pos_y)?;

    // Get configuration for this plant type
    let config = PLANT_CONFIGS.get(&resource.plant_type)
        .ok_or_else(|| format!("No configuration found for plant type: {:?}", resource.plant_type))?;

    // Calculate primary yield amount
    let primary_yield_amount = if config.primary_yield.1 == config.primary_yield.2 {
        config.primary_yield.1 // Fixed amount
    } else {
        ctx.rng().gen_range(config.primary_yield.1..=config.primary_yield.2) // Random range
    };

    // Collect resource and schedule respawn
    collect_resource_and_schedule_respawn(
        ctx,
        player_id,
        &config.primary_yield.0, // primary item name
        primary_yield_amount,
        config.secondary_yield.as_ref().map(|(name, _, _, _)| name.as_str()), // secondary item name
        config.secondary_yield.as_ref().map(|(_, min, _, _)| *min).unwrap_or(0), // secondary min
        config.secondary_yield.as_ref().map(|(_, _, max, _)| *max).unwrap_or(0), // secondary max
        config.secondary_yield.as_ref().map(|(_, _, _, chance)| *chance).unwrap_or(0.0), // secondary chance
        &mut ctx.rng().clone(),
        resource.id,
        resource.pos_x,
        resource.pos_y,
        // update_resource_fn (closure)
        |respawn_time| -> Result<(), String> {
            if let Some(mut resource_to_update) = ctx.db.harvestable_resource().id().find(resource.id) {
                resource_to_update.respawn_at = Some(respawn_time);
                ctx.db.harvestable_resource().id().update(resource_to_update);
                Ok(())
            } else {
                Err(format!("Harvestable resource {} disappeared before respawn scheduling.", resource.id))
            }
        },
        config.min_respawn_time_secs,
        config.max_respawn_time_secs
    )?;

    // Try to grant seed drops after successful harvest
    crate::collectible_resources::try_grant_seed_drops(
        ctx,
        player_id,
        &config.primary_yield.0,
        &mut ctx.rng().clone(),
    )?;

    Ok(())
}

// --- Helper Functions for Environment Seeding ---

pub fn get_plant_config(plant_type: &PlantType) -> Option<&PlantConfig> {
    PLANT_CONFIGS.get(plant_type)
}

pub fn create_harvestable_resource(
    plant_type: PlantType,
    pos_x: f32,
    pos_y: f32,
    chunk_index: u32
) -> HarvestableResource {
    HarvestableResource {
        id: 0, // auto_inc
        plant_type,
        pos_x,
        pos_y,
        chunk_index,
        respawn_at: None,
    }
}

// --- Spawn Condition Validation Functions ---

/// Check if a spawn location is suitable for a specific plant type
pub fn is_spawn_location_suitable(
    ctx: &ReducerContext,
    pos_x: f32,
    pos_y: f32,
    plant_type: &PlantType,
    tree_positions: &[(f32, f32)],
    stone_positions: &[(f32, f32)]
) -> bool {
    let config = PLANT_CONFIGS.get(plant_type);
    if let Some(config) = config {
        crate::environment::validate_spawn_location(
            ctx, pos_x, pos_y, &config.spawn_condition, tree_positions, stone_positions
        )
    } else {
        false
    }
}

// Import the location validation functions from environment.rs
// REMOVED: These functions no longer exist, we use validate_spawn_location directly 