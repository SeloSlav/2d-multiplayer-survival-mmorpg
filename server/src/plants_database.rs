use spacetimedb::SpacetimeType;
use std::collections::HashMap;
use lazy_static::lazy_static;
use crate::world_state::Season;

// --- Plant Type Enum ---

#[derive(SpacetimeType, Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum PlantType {
    // === BASIC CROPS (Cold-hardy varieties that could survive short Aleutian growing season) ===
    BorealNettle, // Fiber plant - cold hardy
    Potato,       // Cold-hardy variety - historically grown in northern climates
    Pumpkin,      // Some cold-hardy varieties exist
    Reed,         // Wetland grass
    BeachLymeGrass, // Native coastal grass
    
    // === VEGETABLES & ROOT CROPS (Cold-hardy varieties) ===
    Carrot,       // Cold-hardy root crop
    Beets,        // Cold-hardy root crop
    Horseradish,  // Extremely cold-hardy perennial - single best root crop for Aleutian Islands
    
    // === HERBS & MEDICINAL PLANTS (Arctic/Subarctic species) ===
    Chicory,      // Cold-hardy perennial herb
    Yarrow,       // Native to cold climates, medicinal
    Chamomile,    // Some cold-hardy varieties
    Mint,         // Cold-hardy perennial
    Valerian,     // Cold-climate medicinal plant
    Mugwort,      // Hardy perennial, grows in harsh conditions
    BearGarlic,   // Wild cold-climate relative of garlic
    SiberianGinseng, // Cold-climate adaptogen
    Dogbane,      // Fiber plant, cold-hardy
    BogCotton,    // Native wetland plant
    Flax,         // Cold-hardy fiber crop
    Salsify,      // Cold-hardy root vegetable
    
    // === NEW: ARCTIC/SUBARCTIC PLANTS (Botanically accurate for Aleutian Islands) ===
    ScurvyGrass,  // Cochlearia - Arctic vitamin C source, grows year-round
    Crowberry,    // Empetrum - Low-growing subarctic berry, persists in winter
    SeaPlantain,  // Plantago maritima - Maritime plant, leaves available year-round
    Glasswort,    // Salicornia - Salt-tolerant maritime succulent
    
    // === MUSHROOMS (Can grow in cold, humid maritime conditions) ===
    Chanterelle,
    Porcini,
    FlyAgaric,
    ShaggyInkCap,
    DeadlyWebcap,
    DestroyingAngel,
    
    // === BERRIES (Native to subarctic/boreal regions) ===
    Lingonberries,    // Native to subarctic
    Cloudberries,     // Native to subarctic bogs
    Bilberries,       // Cold-climate blueberry relative
    WildStrawberries, // Cold-hardy wild variety
    RowanBerries,     // Mountain ash - cold-hardy tree berries
    Cranberries,      // Bog plant, cold-hardy
    
    // === TOXIC/MEDICINAL (Some grow in harsh northern climates) ===
    Mandrake,
    Belladonna,
    Henbane,
    Datura,
    Wolfsbane,
    
    // === OTHER ===
    Sunflowers, // Some cold-hardy varieties exist
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
    
    // Respawn timing (base values - modified by seasonal multiplier for wild plants)
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
        
        // === NEW ARCTIC/SUBARCTIC PLANTS ===
        configs.insert(PlantType::ScurvyGrass, PlantConfig {
            entity_name: "Scurvy Grass".to_string(),
            density_percent: 0.0001875, // REDUCED 8x: was 0.0015 (375 plants) → now ~47 plants
            min_distance_sq: 25.0 * 25.0,
            min_tree_distance_sq: 15.0 * 15.0,
            min_stone_distance_sq: 20.0 * 20.0,
            noise_threshold: 0.60,
            primary_yield: ("Scurvy Grass".to_string(), 1, 3),
            secondary_yield: None,
            seed_type: "Scurvy Grass Seeds".to_string(),
            seed_drop_chance: 0.60, // 60% chance - important vitamin C source
            min_respawn_time_secs: 480,  // 8 minutes
            max_respawn_time_secs: 720,  // 12 minutes
            spawn_condition: SpawnCondition::Coastal, // Grows near shores
            growing_seasons: vec![Season::Spring, Season::Summer, Season::Autumn, Season::Winter], // Year-round Arctic plant
        });
        
        configs.insert(PlantType::BorealNettle, PlantConfig {
            entity_name: "Boreal Nettle".to_string(),
            density_percent: 0.00016625, // REDUCED 8x: was 0.00133 (333 plants) → now ~42 plants
            min_distance_sq: 35.0 * 35.0,
            min_tree_distance_sq: 20.0 * 20.0,
            min_stone_distance_sq: 20.0 * 20.0,
            noise_threshold: 0.68,
            primary_yield: ("Plant Fiber".to_string(), 40, 50),
            secondary_yield: Some(("Nettle Leaves".to_string(), 1, 3, 0.80)),
            seed_type: "Nettle Seeds".to_string(),
            seed_drop_chance: 0.65, // 65% chance - important fiber crop should be sustainable
            min_respawn_time_secs: 600,  // 10 minutes
            max_respawn_time_secs: 900,  // 15 minutes
            spawn_condition: SpawnCondition::Plains,
            growing_seasons: vec![Season::Spring, Season::Summer, Season::Autumn, Season::Winter], // Extremely hardy - dried stalks and roots available year-round
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
            seed_drop_chance: 0.80, // 80% chance - essential food crop must be sustainable
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
            seed_drop_chance: 0.70, // Increased from 0.20 for farming sustainability
            min_respawn_time_secs: 1200, // 20 minutes
            max_respawn_time_secs: 1800, // 30 minutes
            spawn_condition: SpawnCondition::Coastal,
            growing_seasons: vec![Season::Summer, Season::Autumn], // Long growing season
        });
        
        configs.insert(PlantType::Reed, PlantConfig {
            entity_name: "Common Reed Stalk".to_string(),
            density_percent: 0.000375, // REDUCED 8x: was 0.003 (750 plants) → now ~94 plants
            min_distance_sq: 25.0 * 25.0,
            min_tree_distance_sq: 15.0 * 15.0,
            min_stone_distance_sq: 20.0 * 20.0,
            noise_threshold: 0.58,
            primary_yield: ("Common Reed Stalk".to_string(), 2, 4),
            secondary_yield: Some(("Plant Fiber".to_string(), 1, 3, 0.75)),
            seed_type: "Reed Rhizome".to_string(),
            seed_drop_chance: 0.65, // Increased from 0.14 for farming sustainability
            min_respawn_time_secs: 600,  // 10 minutes
            max_respawn_time_secs: 900,  // 15 minutes
            spawn_condition: SpawnCondition::InlandWater,
            growing_seasons: vec![Season::Spring, Season::Summer, Season::Autumn], // Hardy water plant
        });
        
        configs.insert(PlantType::BeachLymeGrass, PlantConfig {
            entity_name: "Beach Lyme Grass".to_string(),
            density_percent: 0.00025, // REDUCED 8x: was 0.002 (500 plants) → now ~63 plants
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
        
        configs.insert(PlantType::Crowberry, PlantConfig {
            entity_name: "Crowberry".to_string(),
            density_percent: 0.00015, // REDUCED 8x: was 0.0012 (300 plants) → now ~38 plants
            min_distance_sq: 30.0 * 30.0,
            min_tree_distance_sq: 20.0 * 20.0,
            min_stone_distance_sq: 25.0 * 25.0,
            noise_threshold: 0.62,
            primary_yield: ("Crowberry".to_string(), 3, 6),
            secondary_yield: None,
            seed_type: "Crowberry Seeds".to_string(),
            seed_drop_chance: 0.60, // Increased from 0.45 for farming sustainability
            min_respawn_time_secs: 1200, // 20 minutes
            max_respawn_time_secs: 1800, // 30 minutes
            spawn_condition: SpawnCondition::Plains, // Low-growing shrub on open ground
            growing_seasons: vec![Season::Summer, Season::Autumn, Season::Winter], // Berries persist into winter
        });
        
        // === VEGETABLES ===
        
        configs.insert(PlantType::Carrot, PlantConfig {
            entity_name: "Carrot".to_string(),
            density_percent: 0.0006,
            min_distance_sq: 30.0 * 30.0,
            min_tree_distance_sq: 20.0 * 20.0,
            min_stone_distance_sq: 25.0 * 25.0,
            noise_threshold: 0.66,
            primary_yield: ("Carrot".to_string(), 1, 3),
            secondary_yield: None,
            seed_type: "Carrot Seeds".to_string(),
            seed_drop_chance: 0.75, // 75% chance - common food crop must be sustainable
            min_respawn_time_secs: 900,  // 15 minutes
            max_respawn_time_secs: 1500, // 25 minutes
            spawn_condition: SpawnCondition::Clearings,
            growing_seasons: vec![Season::Spring, Season::Summer, Season::Autumn],
        });
        
        configs.insert(PlantType::SeaPlantain, PlantConfig {
            entity_name: "Sea Plantain".to_string(),
            density_percent: 0.000225, // REDUCED 8x: was 0.0018 (450 plants) → now ~56 plants
            min_distance_sq: 20.0 * 20.0,
            min_tree_distance_sq: 15.0 * 15.0,
            min_stone_distance_sq: 18.0 * 18.0,
            noise_threshold: 0.58,
            primary_yield: ("Sea Plantain".to_string(), 2, 4),
            secondary_yield: None,
            seed_type: "Sea Plantain Seeds".to_string(),
            seed_drop_chance: 0.55, // 55% chance - maritime plant
            min_respawn_time_secs: 600,  // 10 minutes
            max_respawn_time_secs: 900,  // 15 minutes
            spawn_condition: SpawnCondition::Coastal, // Maritime plant grows near shores
            growing_seasons: vec![Season::Spring, Season::Summer, Season::Autumn, Season::Winter], // Year-round leaves
        });
        
        configs.insert(PlantType::Glasswort, PlantConfig {
            entity_name: "Glasswort".to_string(),
            density_percent: 0.000175, // REDUCED 8x: was 0.0014 (350 plants) → now ~44 plants
            min_distance_sq: 25.0 * 25.0,
            min_tree_distance_sq: 20.0 * 20.0,
            min_stone_distance_sq: 15.0 * 15.0,
            noise_threshold: 0.62,
            primary_yield: ("Glasswort".to_string(), 2, 5),
            secondary_yield: None,
            seed_type: "Glasswort Seeds".to_string(),
            seed_drop_chance: 0.50, // 50% chance - salt-tolerant succulent
            min_respawn_time_secs: 800,  // 13 minutes
            max_respawn_time_secs: 1200, // 20 minutes
            spawn_condition: SpawnCondition::Coastal, // Salt-tolerant, grows in maritime areas
            growing_seasons: vec![Season::Summer, Season::Autumn], // Warm season succulent
        });
        
        configs.insert(PlantType::Beets, PlantConfig {
            entity_name: "Beets".to_string(),
            density_percent: 0.0007,
            min_distance_sq: 32.0 * 32.0,
            min_tree_distance_sq: 20.0 * 20.0,
            min_stone_distance_sq: 25.0 * 25.0,
            noise_threshold: 0.66,
            primary_yield: ("Beet".to_string(), 1, 2),
            secondary_yield: None,
            seed_type: "Beet Seeds".to_string(),
            seed_drop_chance: 0.70, // Increased from 0.15 for farming sustainability
            min_respawn_time_secs: 1000, // 16 minutes
            max_respawn_time_secs: 1400, // 23 minutes
            spawn_condition: SpawnCondition::Clearings,
            growing_seasons: vec![Season::Summer, Season::Autumn],
        });
        
        configs.insert(PlantType::Horseradish, PlantConfig {
            entity_name: "Horseradish".to_string(),
            density_percent: 0.0003,
            min_distance_sq: 40.0 * 40.0,
            min_tree_distance_sq: 25.0 * 25.0,
            min_stone_distance_sq: 30.0 * 30.0,
            noise_threshold: 0.70,
            primary_yield: ("Horseradish Root".to_string(), 1, 1),
            secondary_yield: None,
            seed_type: "Horseradish Root".to_string(),
            seed_drop_chance: 0.55, // Increased from 0.08 for farming sustainability - important cold-hardy food crop
            min_respawn_time_secs: 2000, // 33 minutes
            max_respawn_time_secs: 3000, // 50 minutes
            spawn_condition: SpawnCondition::NearWater,
            growing_seasons: vec![Season::Autumn],
        });
        
        // === HERBS & MEDICINAL PLANTS ===
        configs.insert(PlantType::Chicory, PlantConfig {
            entity_name: "Chicory".to_string(),
            density_percent: 0.0010,
            min_distance_sq: 25.0 * 25.0,
            min_tree_distance_sq: 15.0 * 15.0,
            min_stone_distance_sq: 20.0 * 20.0,
            noise_threshold: 0.62,
            primary_yield: ("Chicory".to_string(), 2, 4),
            secondary_yield: None,
            seed_type: "Chicory Seeds".to_string(),
            seed_drop_chance: 0.55, // Increased from 0.14 for farming sustainability
            min_respawn_time_secs: 600,  // 10 minutes
            max_respawn_time_secs: 1000, // 16 minutes
            spawn_condition: SpawnCondition::Plains,
            growing_seasons: vec![Season::Spring, Season::Summer, Season::Autumn, Season::Winter], // Deep taproot survives year-round - roots sweeter after frost
        });
        
        configs.insert(PlantType::Yarrow, PlantConfig {
            entity_name: "Yarrow".to_string(),
            density_percent: 0.0001875, // REDUCED 8x: was 0.0015 (375 plants) → now ~47 plants
            min_distance_sq: 20.0 * 20.0,
            min_tree_distance_sq: 15.0 * 15.0,
            min_stone_distance_sq: 18.0 * 18.0,
            noise_threshold: 0.60,
            primary_yield: ("Yarrow".to_string(), 1, 3),
            secondary_yield: None,
            seed_type: "Yarrow Seeds".to_string(),
            seed_drop_chance: 0.55, // Increased from 0.12 for farming sustainability
            min_respawn_time_secs: 800,  // 13 minutes
            max_respawn_time_secs: 1200, // 20 minutes
            spawn_condition: SpawnCondition::Plains,
            growing_seasons: vec![Season::Spring, Season::Summer, Season::Autumn, Season::Winter], // Persistent dried stalks and roots year-round
        });
        
        configs.insert(PlantType::Chamomile, PlantConfig {
            entity_name: "Chamomile".to_string(),
            density_percent: 0.00015, // REDUCED 8x: was 0.0012 (300 plants) → now ~38 plants
            min_distance_sq: 22.0 * 22.0,
            min_tree_distance_sq: 18.0 * 18.0,
            min_stone_distance_sq: 20.0 * 20.0,
            noise_threshold: 0.63,
            primary_yield: ("Chamomile".to_string(), 2, 4),
            secondary_yield: None,
            seed_type: "Chamomile Seeds".to_string(),
            seed_drop_chance: 0.60, // Increased from 0.15 for farming sustainability
            min_respawn_time_secs: 600,  // 10 minutes
            max_respawn_time_secs: 900,  // 15 minutes
            spawn_condition: SpawnCondition::Plains,
            growing_seasons: vec![Season::Spring, Season::Summer],
        });
        
        configs.insert(PlantType::Mint, PlantConfig {
            entity_name: "Mint".to_string(),
            density_percent: 0.00025, // REDUCED 8x: was 0.0020 (500 plants) → now ~63 plants
            min_distance_sq: 18.0 * 18.0,
            min_tree_distance_sq: 12.0 * 12.0,
            min_stone_distance_sq: 15.0 * 15.0,
            noise_threshold: 0.58,
            primary_yield: ("Mint Leaves".to_string(), 3, 5),
            secondary_yield: None,
            seed_type: "Mint Cuttings".to_string(),
            seed_drop_chance: 0.75, // 75% chance - sustainable for farming
            min_respawn_time_secs: 400,  // 6 minutes (fast spreading)
            max_respawn_time_secs: 700,  // 11 minutes
            spawn_condition: SpawnCondition::NearWater,
            growing_seasons: vec![Season::Spring, Season::Summer],
        });
        
        configs.insert(PlantType::Valerian, PlantConfig {
            entity_name: "Valerian".to_string(),
            density_percent: 0.0008,
            min_distance_sq: 30.0 * 30.0,
            min_tree_distance_sq: 20.0 * 20.0,
            min_stone_distance_sq: 25.0 * 25.0,
            noise_threshold: 0.66,
            primary_yield: ("Valerian Root".to_string(), 1, 2),
            secondary_yield: Some(("Valerian Leaves".to_string(), 2, 3, 0.75)),
            seed_type: "Valerian Seeds".to_string(),
            seed_drop_chance: 0.70, // 70% chance - medicinal herb should be farmable
            min_respawn_time_secs: 1200, // 20 minutes
            max_respawn_time_secs: 1800, // 30 minutes
            spawn_condition: SpawnCondition::NearWater,
            growing_seasons: vec![Season::Spring, Season::Summer],
        });
        
        configs.insert(PlantType::Mugwort, PlantConfig {
            entity_name: "Mugwort".to_string(),
            density_percent: 0.0001625, // REDUCED 8x: was 0.0013 (325 plants) → now ~41 plants
            min_distance_sq: 25.0 * 25.0,
            min_tree_distance_sq: 18.0 * 18.0,
            min_stone_distance_sq: 22.0 * 22.0,
            noise_threshold: 0.61,
            primary_yield: ("Mugwort".to_string(), 2, 4),
            secondary_yield: None,
            seed_type: "Mugwort Seeds".to_string(),
            seed_drop_chance: 0.55, // Increased from 0.13 for farming sustainability
            min_respawn_time_secs: 700,  // 11 minutes
            max_respawn_time_secs: 1100, // 18 minutes
            spawn_condition: SpawnCondition::Plains,
            growing_seasons: vec![Season::Spring, Season::Summer, Season::Autumn, Season::Winter], // Extremely invasive - dried stalks persist year-round
        });
        
        configs.insert(PlantType::Flax, PlantConfig {
            entity_name: "Flax Plant".to_string(),
            density_percent: 0.000125, // REDUCED 8x: was 0.0010 (250 plants) → now ~31 plants
            min_distance_sq: 35.0 * 35.0,
            min_tree_distance_sq: 25.0 * 25.0,
            min_stone_distance_sq: 30.0 * 30.0,
            noise_threshold: 0.68,
            primary_yield: ("Plant Fiber".to_string(), 25, 30), // Balanced between Nettle (40-50) and Beach Lyme (15)
            secondary_yield: None,
            seed_type: "Flax Seeds".to_string(),
            seed_drop_chance: 0.65, // Increased from 0.18 for farming sustainability
            min_respawn_time_secs: 800,  // 13 minutes - between Nettle (10-15) and Beach Lyme (8-12)
            max_respawn_time_secs: 1200, // 20 minutes
            spawn_condition: SpawnCondition::Plains,
            growing_seasons: vec![Season::Spring, Season::Summer, Season::Autumn],
        });
        
        configs.insert(PlantType::BearGarlic, PlantConfig {
            entity_name: "Bear Garlic".to_string(),
            density_percent: 0.0002, // REDUCED 8x: was 0.0016 (400 plants) → now ~50 plants
            min_distance_sq: 20.0 * 20.0,
            min_tree_distance_sq: 10.0 * 10.0,
            min_stone_distance_sq: 15.0 * 15.0,
            noise_threshold: 0.58,
            primary_yield: ("Bear Garlic".to_string(), 2, 4),
            secondary_yield: None,
            seed_type: "Bear Garlic Bulbs".to_string(),
            seed_drop_chance: 0.60, // 60% chance - sustainable for farming
            min_respawn_time_secs: 600,  // 10 minutes
            max_respawn_time_secs: 900,  // 15 minutes
            spawn_condition: SpawnCondition::Forest,
            growing_seasons: vec![Season::Spring, Season::Summer, Season::Autumn, Season::Winter], // Underground bulbs survive winter - dried leaves too
        });
        
        configs.insert(PlantType::SiberianGinseng, PlantConfig {
            entity_name: "Siberian Ginseng".to_string(),
            density_percent: 0.0002,
            min_distance_sq: 50.0 * 50.0,
            min_tree_distance_sq: 40.0 * 40.0,
            min_stone_distance_sq: 35.0 * 35.0,
            noise_threshold: 0.75,
            primary_yield: ("Siberian Ginseng".to_string(), 1, 1),
            secondary_yield: Some(("Ginseng Leaves".to_string(), 1, 2, 0.60)),
            seed_type: "Ginseng Seeds".to_string(),
            seed_drop_chance: 0.50, // Increased from 0.40 - just at sustainability threshold for rare plant
            min_respawn_time_secs: 3600, // 60 minutes (very rare)
            max_respawn_time_secs: 5400, // 90 minutes
            spawn_condition: SpawnCondition::Forest,
            growing_seasons: vec![Season::Spring, Season::Summer, Season::Autumn, Season::Winter], // Siberian hardiness - roots harvestable year-round
        });
        
        // === TREES/BARK/FIBER ===
        configs.insert(PlantType::Dogbane, PlantConfig {
            entity_name: "Dogbane".to_string(),
            density_percent: 0.0008,
            min_distance_sq: 30.0 * 30.0,
            min_tree_distance_sq: 20.0 * 20.0,
            min_stone_distance_sq: 25.0 * 25.0,
            noise_threshold: 0.66,
            primary_yield: ("Dogbane Fiber".to_string(), 2, 4),
            secondary_yield: None,
            seed_type: "Dogbane Seeds".to_string(),
            seed_drop_chance: 0.60, // Increased from 0.12 for farming sustainability
            min_respawn_time_secs: 1000, // 16 minutes
            max_respawn_time_secs: 1500, // 25 minutes
            spawn_condition: SpawnCondition::Plains,
            growing_seasons: vec![Season::Summer],
        });
        
        configs.insert(PlantType::BogCotton, PlantConfig {
            entity_name: "Bog Cotton".to_string(),
            density_percent: 0.00015, // REDUCED 8x: was 0.0012 (300 plants) → now ~38 plants
            min_distance_sq: 25.0 * 25.0,
            min_tree_distance_sq: 15.0 * 15.0,
            min_stone_distance_sq: 20.0 * 20.0,
            noise_threshold: 0.60,
            primary_yield: ("Cotton Fibers".to_string(), 3, 5),
            secondary_yield: None,
            seed_type: "Bog Cotton Seeds".to_string(),
            seed_drop_chance: 0.55, // Increased from 0.10 for farming sustainability
            min_respawn_time_secs: 800,  // 13 minutes
            max_respawn_time_secs: 1200, // 20 minutes
            spawn_condition: SpawnCondition::InlandWater,
            growing_seasons: vec![Season::Summer],
        });
        
        // === MUSHROOMS ===
        configs.insert(PlantType::Chanterelle, PlantConfig {
            entity_name: "Chanterelle".to_string(),
            density_percent: 0.0006,
            min_distance_sq: 40.0 * 40.0,
            min_tree_distance_sq: 30.0 * 30.0,
            min_stone_distance_sq: 35.0 * 35.0,
            noise_threshold: 0.72,
            primary_yield: ("Chanterelle".to_string(), 1, 2),
            secondary_yield: None,
            seed_type: "Chanterelle Spores".to_string(),
            seed_drop_chance: 0.50, // 50% chance - mushrooms should be farmable
            min_respawn_time_secs: 1200, // 20 minutes
            max_respawn_time_secs: 1800, // 30 minutes
            spawn_condition: SpawnCondition::Forest,
            growing_seasons: vec![Season::Summer, Season::Autumn],
        });
        
        configs.insert(PlantType::Porcini, PlantConfig {
            entity_name: "Porcini".to_string(),
            density_percent: 0.0004,
            min_distance_sq: 45.0 * 45.0,
            min_tree_distance_sq: 35.0 * 35.0,
            min_stone_distance_sq: 40.0 * 40.0,
            noise_threshold: 0.74,
            primary_yield: ("Porcini".to_string(), 1, 1),
            secondary_yield: None,
            seed_type: "Porcini Spores".to_string(),
            seed_drop_chance: 0.55, // Increased from 0.45 for farming sustainability 
            min_respawn_time_secs: 1500, // 25 minutes
            max_respawn_time_secs: 2200, // 36 minutes
            spawn_condition: SpawnCondition::Forest,
            growing_seasons: vec![Season::Summer, Season::Autumn],
        });
        
        configs.insert(PlantType::FlyAgaric, PlantConfig {
            entity_name: "Fly Agaric".to_string(),
            density_percent: 0.0008,
            min_distance_sq: 35.0 * 35.0,
            min_tree_distance_sq: 25.0 * 25.0,
            min_stone_distance_sq: 30.0 * 30.0,
            noise_threshold: 0.70,
            primary_yield: ("Fly Agaric".to_string(), 1, 1),
            secondary_yield: None,
            seed_type: "Fly Agaric Spores".to_string(),
            seed_drop_chance: 0.10,
            min_respawn_time_secs: 1000, // 16 minutes
            max_respawn_time_secs: 1600, // 26 minutes
            spawn_condition: SpawnCondition::Forest,
            growing_seasons: vec![Season::Autumn],
        });
        
        configs.insert(PlantType::ShaggyInkCap, PlantConfig {
            entity_name: "Shaggy Ink Cap".to_string(),
            density_percent: 0.0010,
            min_distance_sq: 25.0 * 25.0,
            min_tree_distance_sq: 20.0 * 20.0,
            min_stone_distance_sq: 25.0 * 25.0,
            noise_threshold: 0.65,
            primary_yield: ("Shaggy Ink Cap".to_string(), 1, 2),
            secondary_yield: None,
            seed_type: "Shaggy Ink Cap Spores".to_string(),
            seed_drop_chance: 0.55, // Increased from 0.12 for farming sustainability - edible mushroom
            min_respawn_time_secs: 600,  // 10 minutes
            max_respawn_time_secs: 1000, // 16 minutes
            spawn_condition: SpawnCondition::Clearings,
            growing_seasons: vec![Season::Spring, Season::Summer, Season::Autumn],
        });
        
        configs.insert(PlantType::DeadlyWebcap, PlantConfig {
            entity_name: "Deadly Webcap".to_string(),
            density_percent: 0.0002,
            min_distance_sq: 60.0 * 60.0,
            min_tree_distance_sq: 50.0 * 50.0,
            min_stone_distance_sq: 45.0 * 45.0,
            noise_threshold: 0.78,
            primary_yield: ("Deadly Webcap".to_string(), 1, 1),
            secondary_yield: None,
            seed_type: "Deadly Webcap Spores".to_string(),
            seed_drop_chance: 0.05,
            min_respawn_time_secs: 2400, // 40 minutes
            max_respawn_time_secs: 3600, // 60 minutes
            spawn_condition: SpawnCondition::Forest,
            growing_seasons: vec![Season::Autumn],
        });
        
        configs.insert(PlantType::DestroyingAngel, PlantConfig {
            entity_name: "Destroying Angel".to_string(),
            density_percent: 0.0001,
            min_distance_sq: 70.0 * 70.0,
            min_tree_distance_sq: 60.0 * 60.0,
            min_stone_distance_sq: 50.0 * 50.0,
            noise_threshold: 0.80,
            primary_yield: ("Destroying Angel".to_string(), 1, 1),
            secondary_yield: None,
            seed_type: "Destroying Angel Spores".to_string(),
            seed_drop_chance: 0.03,
            min_respawn_time_secs: 3600, // 60 minutes
            max_respawn_time_secs: 5400, // 90 minutes
            spawn_condition: SpawnCondition::Forest,
            growing_seasons: vec![Season::Autumn],
        });
        
        // === BERRIES & NUTS ===
        configs.insert(PlantType::Lingonberries, PlantConfig {
            entity_name: "Lingonberries".to_string(),
            density_percent: 0.0012,
            min_distance_sq: 30.0 * 30.0,
            min_tree_distance_sq: 20.0 * 20.0,
            min_stone_distance_sq: 25.0 * 25.0,
            noise_threshold: 0.64,
            primary_yield: ("Lingonberries".to_string(), 3, 6),
            secondary_yield: None,
            seed_type: "Lingonberry Seeds".to_string(),
            seed_drop_chance: 0.55, // Increased from 0.08 for farming sustainability
            min_respawn_time_secs: 1800, // 30 minutes
            max_respawn_time_secs: 2600, // 43 minutes
            spawn_condition: SpawnCondition::Forest,
            growing_seasons: vec![Season::Summer, Season::Autumn],
        });
        
        configs.insert(PlantType::Cloudberries, PlantConfig {
            entity_name: "Cloudberries".to_string(),
            density_percent: 0.0008,
            min_distance_sq: 40.0 * 40.0,
            min_tree_distance_sq: 30.0 * 30.0,
            min_stone_distance_sq: 35.0 * 35.0,
            noise_threshold: 0.70,
            primary_yield: ("Cloudberries".to_string(), 2, 4),
            secondary_yield: None,
            seed_type: "Cloudberry Seeds".to_string(),
            seed_drop_chance: 0.06,
            min_respawn_time_secs: 2000, // 33 minutes
            max_respawn_time_secs: 3000, // 50 minutes
            spawn_condition: SpawnCondition::Forest,
            growing_seasons: vec![Season::Autumn],
        });
        
        configs.insert(PlantType::Bilberries, PlantConfig {
            entity_name: "Bilberries".to_string(),
            density_percent: 0.0015,
            min_distance_sq: 25.0 * 25.0,
            min_tree_distance_sq: 15.0 * 15.0,
            min_stone_distance_sq: 20.0 * 20.0,
            noise_threshold: 0.62,
            primary_yield: ("Bilberries".to_string(), 4, 8),
            secondary_yield: None,
            seed_type: "Bilberry Seeds".to_string(),
            seed_drop_chance: 0.60, // Increased from 0.10 for farming sustainability
            min_respawn_time_secs: 1200, // 20 minutes
            max_respawn_time_secs: 1800, // 30 minutes
            spawn_condition: SpawnCondition::Forest,
            growing_seasons: vec![Season::Summer],
        });
        
        configs.insert(PlantType::WildStrawberries, PlantConfig {
            entity_name: "Wild Strawberries".to_string(),
            density_percent: 0.0018,
            min_distance_sq: 20.0 * 20.0,
            min_tree_distance_sq: 12.0 * 12.0,
            min_stone_distance_sq: 15.0 * 15.0,
            noise_threshold: 0.58,
            primary_yield: ("Wild Strawberries".to_string(), 2, 5),
            secondary_yield: None,
            seed_type: "Wild Strawberry Seeds".to_string(),
            seed_drop_chance: 0.65, // Increased from 0.12 for farming sustainability
            min_respawn_time_secs: 800,  // 13 minutes
            max_respawn_time_secs: 1300, // 21 minutes
            spawn_condition: SpawnCondition::Clearings,
            growing_seasons: vec![Season::Summer],
        });
        
        configs.insert(PlantType::RowanBerries, PlantConfig {
            entity_name: "Rowan Berries".to_string(),
            density_percent: 0.0006,
            min_distance_sq: 50.0 * 50.0,
            min_tree_distance_sq: 40.0 * 40.0,
            min_stone_distance_sq: 35.0 * 35.0,
            noise_threshold: 0.72,
            primary_yield: ("Rowan Berries".to_string(), 5, 10),
            secondary_yield: None,
            seed_type: "Rowan Seeds".to_string(),
            seed_drop_chance: 0.05,
            min_respawn_time_secs: 2400, // 40 minutes
            max_respawn_time_secs: 3600, // 60 minutes
            spawn_condition: SpawnCondition::Forest,
            growing_seasons: vec![Season::Summer, Season::Autumn, Season::Winter],
        });
        
        configs.insert(PlantType::Cranberries, PlantConfig {
            entity_name: "Cranberries".to_string(),
            density_percent: 0.0010,
            min_distance_sq: 35.0 * 35.0,
            min_tree_distance_sq: 25.0 * 25.0,
            min_stone_distance_sq: 20.0 * 20.0,
            noise_threshold: 0.67,
            primary_yield: ("Cranberries".to_string(), 3, 7),
            secondary_yield: None,
            seed_type: "Cranberry Seeds".to_string(),
            seed_drop_chance: 0.07,
            min_respawn_time_secs: 1600, // 26 minutes
            max_respawn_time_secs: 2400, // 40 minutes
            spawn_condition: SpawnCondition::InlandWater,
            growing_seasons: vec![Season::Autumn, Season::Winter],
        });
        
        // === TOXIC/MEDICINAL ===
        configs.insert(PlantType::Mandrake, PlantConfig {
            entity_name: "Mandrake".to_string(),
            density_percent: 0.0001,
            min_distance_sq: 80.0 * 80.0,
            min_tree_distance_sq: 70.0 * 70.0,
            min_stone_distance_sq: 60.0 * 60.0,
            noise_threshold: 0.82,
            primary_yield: ("Mandrake Root".to_string(), 1, 1),
            secondary_yield: None,
            seed_type: "Mandrake Seeds".to_string(),
            seed_drop_chance: 0.02,
            min_respawn_time_secs: 5400, // 90 minutes
            max_respawn_time_secs: 7200, // 120 minutes
            spawn_condition: SpawnCondition::Forest,
            growing_seasons: vec![Season::Autumn],
        });
        
        configs.insert(PlantType::Belladonna, PlantConfig {
            entity_name: "Belladonna".to_string(),
            density_percent: 0.0002,
            min_distance_sq: 60.0 * 60.0,
            min_tree_distance_sq: 50.0 * 50.0,
            min_stone_distance_sq: 45.0 * 45.0,
            noise_threshold: 0.78,
            primary_yield: ("Belladonna".to_string(), 1, 3),
            secondary_yield: None,
            seed_type: "Belladonna Seeds".to_string(),
            seed_drop_chance: 0.04,
            min_respawn_time_secs: 3000, // 50 minutes
            max_respawn_time_secs: 4500, // 75 minutes
            spawn_condition: SpawnCondition::Forest,
            growing_seasons: vec![Season::Autumn],
        });
        
        configs.insert(PlantType::Henbane, PlantConfig {
            entity_name: "Henbane".to_string(),
            density_percent: 0.0003,
            min_distance_sq: 50.0 * 50.0,
            min_tree_distance_sq: 40.0 * 40.0,
            min_stone_distance_sq: 35.0 * 35.0,
            noise_threshold: 0.76,
            primary_yield: ("Henbane".to_string(), 2, 4),
            secondary_yield: None,
            seed_type: "Henbane Seeds".to_string(),
            seed_drop_chance: 0.06,
            min_respawn_time_secs: 2400, // 40 minutes
            max_respawn_time_secs: 3600, // 60 minutes
            spawn_condition: SpawnCondition::Clearings,
            growing_seasons: vec![Season::Autumn],
        });
        
        configs.insert(PlantType::Datura, PlantConfig {
            entity_name: "Datura".to_string(),
            density_percent: 0.0002,
            min_distance_sq: 55.0 * 55.0,
            min_tree_distance_sq: 45.0 * 45.0,
            min_stone_distance_sq: 40.0 * 40.0,
            noise_threshold: 0.77,
            primary_yield: ("Datura".to_string(), 3, 6),
            secondary_yield: None,
            seed_type: "Datura Seeds".to_string(),
            seed_drop_chance: 0.08,
            min_respawn_time_secs: 2700, // 45 minutes
            max_respawn_time_secs: 4000, // 66 minutes
            spawn_condition: SpawnCondition::Plains,
            growing_seasons: vec![Season::Autumn],
        });
        
        configs.insert(PlantType::Wolfsbane, PlantConfig {
            entity_name: "Wolfsbane".to_string(),
            density_percent: 0.0001,
            min_distance_sq: 70.0 * 70.0,
            min_tree_distance_sq: 60.0 * 60.0,
            min_stone_distance_sq: 50.0 * 50.0,
            noise_threshold: 0.80,
            primary_yield: ("Wolfsbane".to_string(), 1, 1),
            secondary_yield: None,
            seed_type: "Wolfsbane Seeds".to_string(),
            seed_drop_chance: 0.03,
            min_respawn_time_secs: 4500, // 75 minutes
            max_respawn_time_secs: 6300, // 105 minutes
            spawn_condition: SpawnCondition::Forest,
            growing_seasons: vec![Season::Autumn],
        });
        
        // === OTHER ===
        configs.insert(PlantType::Sunflowers, PlantConfig {
            entity_name: "Sunflowers".to_string(),
            density_percent: 0.0004,
            min_distance_sq: 40.0 * 40.0,
            min_tree_distance_sq: 30.0 * 30.0,
            min_stone_distance_sq: 25.0 * 25.0,
            noise_threshold: 0.69,
            primary_yield: ("Sunflower".to_string(), 1, 2),
            secondary_yield: None, // Seeds come from seed drop system
            seed_type: "Sunflower Seeds".to_string(),
            seed_drop_chance: 0.75, // Increased from 0.30 - seeds are main harvest so should be sustainable
            min_respawn_time_secs: 2000, // 33 minutes
            max_respawn_time_secs: 3000, // 50 minutes
            spawn_condition: SpawnCondition::Plains,
            growing_seasons: vec![Season::Spring, Season::Summer, Season::Autumn, Season::Winter], // Tall dried stalks persist all winter
        });
        
        configs.insert(PlantType::Salsify, PlantConfig {
            entity_name: "Salsify".to_string(),
            density_percent: 0.0006,
            min_distance_sq: 30.0 * 30.0,
            min_tree_distance_sq: 20.0 * 20.0,
            min_stone_distance_sq: 25.0 * 25.0,
            noise_threshold: 0.65,
            primary_yield: ("Salsify Root".to_string(), 1, 2),
            secondary_yield: None,
            seed_type: "Salsify Seeds".to_string(),
            seed_drop_chance: 0.60, // Increased from 0.11 for farming sustainability
            min_respawn_time_secs: 1400, // 23 minutes
            max_respawn_time_secs: 2000, // 33 minutes
            spawn_condition: SpawnCondition::Plains,
            growing_seasons: vec![Season::Autumn],
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

// Helper function to get plants that can grow in a specific season
pub fn get_seasonal_plants(season: &Season) -> Vec<(PlantType, &PlantConfig)> {
    PLANT_CONFIGS.iter()
        .filter(|(plant_type, _)| can_grow_in_season(plant_type, season))
        .map(|(plant_type, config)| (*plant_type, config))
        .collect()
} 