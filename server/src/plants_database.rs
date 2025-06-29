use spacetimedb::SpacetimeType;
use std::collections::HashMap;
use lazy_static::lazy_static;

// --- Plant Type Enum ---

#[derive(SpacetimeType, Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum PlantType {
    Corn,
    Hemp,
    Mushroom,
    Potato,
    Pumpkin,
    Reed,
    BeachLymeGrass,
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
        
        configs.insert(PlantType::BeachLymeGrass, PlantConfig {
            density_percent: 0.002,
            min_distance_sq: 30.0 * 30.0,
            min_tree_distance_sq: 20.0 * 20.0,
            min_stone_distance_sq: 25.0 * 25.0,
            noise_threshold: 0.65,
            primary_yield: ("Plant Fiber".to_string(), 15, 15), // Fixed 15 fiber
            secondary_yield: None,
            seed_type: "".to_string(), // No seeds
            seed_drop_chance: 0.0, // No seed drops
            min_respawn_time_secs: 480,  // 8 minutes
            max_respawn_time_secs: 720,  // 12 minutes
            spawn_condition: SpawnCondition::Coastal, // Spawns on beach tiles
        });
        
        configs
    };
}

// --- Helper Functions ---

pub fn get_plant_config(plant_type: &PlantType) -> Option<&PlantConfig> {
    PLANT_CONFIGS.get(plant_type)
} 