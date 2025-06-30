use spacetimedb::SpacetimeType;
use std::collections::HashMap;
use lazy_static::lazy_static;
use crate::world_state::Season;

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
    // Identity
    pub entity_name: String, // The actual entity/resource name used in game
    
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
    
    // Seasonal growth
    pub growing_seasons: Vec<Season>, // Which seasons this plant can grow in
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
            entity_name: "Corn".to_string(),
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
            growing_seasons: vec![Season::Spring, Season::Summer], // Warm weather crop
        });
        
        configs.insert(PlantType::Hemp, PlantConfig {
            entity_name: "Hemp".to_string(),
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
            growing_seasons: vec![Season::Spring, Season::Summer, Season::Autumn, Season::Winter], // Hardy year-round fiber crop
        });
        
        configs.insert(PlantType::Mushroom, PlantConfig {
            entity_name: "Mushroom".to_string(),
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
            growing_seasons: vec![Season::Spring, Season::Summer, Season::Autumn, Season::Winter], // Forest conditions year-round
        });
        
        configs.insert(PlantType::Potato, PlantConfig {
            entity_name: "Potato".to_string(),
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
            growing_seasons: vec![Season::Spring, Season::Autumn], // Cool weather crop
        });
        
        configs.insert(PlantType::Pumpkin, PlantConfig {
            entity_name: "Pumpkin".to_string(),
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
            growing_seasons: vec![Season::Summer, Season::Autumn], // Long growing season
        });
        
        configs.insert(PlantType::Reed, PlantConfig {
            entity_name: "Common Reed Stalk".to_string(),
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
            growing_seasons: vec![Season::Spring, Season::Summer, Season::Autumn], // Hardy water plant
        });
        
        configs.insert(PlantType::BeachLymeGrass, PlantConfig {
            entity_name: "Beach Lyme Grass".to_string(),
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
            growing_seasons: vec![Season::Spring, Season::Summer, Season::Autumn, Season::Winter], // Extremely hardy coastal grass
        });
        
        configs
    };
}

// --- Helper Functions ---

pub fn get_plant_config(plant_type: &PlantType) -> Option<&PlantConfig> {
    PLANT_CONFIGS.get(plant_type)
}

/// Get all available seed types that can be planted
pub fn get_all_seed_types() -> Vec<String> {
    PLANT_CONFIGS.values()
        .filter(|config| !config.seed_type.is_empty()) // Exclude plants with no seeds
        .map(|config| config.seed_type.clone())
        .collect()
}

/// Get all plant entity names for seed drop mapping
pub fn get_all_plant_entity_names() -> Vec<String> {
    PLANT_CONFIGS.values()
        .map(|config| config.entity_name.clone())
        .collect()
}

/// Get seed type for a given plant type
pub fn get_seed_type_for_plant(plant_type: &PlantType) -> Option<&str> {
    PLANT_CONFIGS.get(plant_type)
        .map(|config| config.seed_type.as_str())
        .filter(|seed| !seed.is_empty())
}

/// Convert PlantType enum to entity name (for seed drops) - uses centralized config
pub fn plant_type_to_entity_name(plant_type: &PlantType) -> &str {
    PLANT_CONFIGS.get(plant_type)
        .map(|config| config.entity_name.as_str())
        .unwrap_or("Unknown Plant") // Fallback for missing configs
}

/// Get plant type by seed name
pub fn get_plant_type_by_seed(seed_name: &str) -> Option<PlantType> {
    PLANT_CONFIGS.iter()
        .find(|(_, config)| config.seed_type == seed_name)
        .map(|(plant_type, _)| *plant_type)
}

/// Get plant type by entity name  
pub fn get_plant_type_by_entity_name(entity_name: &str) -> Option<PlantType> {
    PLANT_CONFIGS.iter()
        .find(|(_, config)| config.entity_name == entity_name)
        .map(|(plant_type, _)| *plant_type)
}

/// Check if a seed has drops configured (non-zero drop chance)
pub fn has_seed_drops(plant_type: &PlantType) -> bool {
    PLANT_CONFIGS.get(plant_type)
        .map(|config| config.seed_drop_chance > 0.0 && !config.seed_type.is_empty())
        .unwrap_or(false)
}

/// Check if a plant can grow in the given season
pub fn can_grow_in_season(plant_type: &PlantType, season: &Season) -> bool {
    PLANT_CONFIGS.get(plant_type)
        .map(|config| config.growing_seasons.contains(season))
        .unwrap_or(false)
} 