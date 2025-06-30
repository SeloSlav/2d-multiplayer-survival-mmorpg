use crate::plants_database::{PlantType, plant_type_to_entity_name};

/// Helper function: Check if an item name is a plantable seed
/// This can be called by other server modules without hardcoding
pub fn is_plantable_seed(item_name: &str) -> bool {
    use crate::plants_database::PLANT_CONFIGS;
    
    PLANT_CONFIGS.values()
        .any(|config| config.seed_type == item_name)
}

/// Helper function: Get plant type from seed name
/// This can be called by other server modules without hardcoding
pub fn get_plant_type_from_seed_name(seed_name: &str) -> Option<PlantType> {
    use crate::plants_database::PLANT_CONFIGS;
    
    PLANT_CONFIGS.iter()
        .find(|(_, config)| config.seed_type == seed_name)
        .map(|(plant_type, _)| *plant_type)
} 