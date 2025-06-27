/******************************************************************************
 *                                                                            *
 * Defines the AnimalCorpse entity, representing a harvestable corpse dropped *
 * when wild animals die. Can be harvested for resources like animal fat,     *
 * cloth, bones, and other materials depending on the animal type and tool.   *
 *                                                                            *
 ******************************************************************************/

use spacetimedb::{Identity, Timestamp, ReducerContext, SpacetimeType, Table};
use log;
use std::time::Duration;

// Import required models and types
use crate::models::TargetType;
use crate::items::ItemCategory;
use crate::environment::calculate_chunk_index;
use super::core::AnimalSpecies; // Use AnimalSpecies from core module

// Define constants for animal corpses
const DEFAULT_ANIMAL_CORPSE_DESPAWN_SECONDS: u64 = 180; // 3 minutes default
pub(crate) const ANIMAL_CORPSE_COLLISION_RADIUS: f32 = 16.0; // Slightly smaller than player corpse
pub(crate) const ANIMAL_CORPSE_COLLISION_Y_OFFSET: f32 = 8.0; // Smaller Y offset
pub(crate) const PLAYER_ANIMAL_CORPSE_COLLISION_DISTANCE_SQUARED: f32 = (crate::PLAYER_RADIUS + ANIMAL_CORPSE_COLLISION_RADIUS) * (crate::PLAYER_RADIUS + ANIMAL_CORPSE_COLLISION_RADIUS);
pub(crate) const PLAYER_ANIMAL_CORPSE_INTERACTION_DISTANCE_SQUARED: f32 = 64.0 * 64.0; // Same as player corpse
pub(crate) const ANIMAL_CORPSE_INITIAL_HEALTH: u32 = 75; // Less health than player corpse

/// --- Animal Corpse Data Structure ---
/// Represents a harvestable corpse dropped when an animal dies.
/// Can be harvested for various resources depending on animal type and tool used.
#[spacetimedb::table(name = animal_corpse, public)]
#[derive(Clone)]
pub struct AnimalCorpse {
    #[primary_key]
    #[auto_inc]
    pub id: u32, // Unique identifier for this animal corpse

    pub animal_species: AnimalSpecies, // What kind of animal this corpse came from
    pub animal_id: u64, // Original animal ID for reference

    pub pos_x: f32,
    pub pos_y: f32,
    pub chunk_index: u32, // For spatial queries

    pub death_time: Timestamp,
    pub despawn_at: Timestamp, // When this corpse should be removed

    // --- Harvesting Fields ---
    pub health: u32,
    pub max_health: u32,
    pub last_hit_time: Option<Timestamp>,
    pub last_hit_by: Option<Identity>, // Track who last hit this corpse
}

impl AnimalCorpse {
    /// Creates a new animal corpse at the specified location
    pub fn new(
        animal_species: AnimalSpecies,
        animal_id: u64,
        pos_x: f32,
        pos_y: f32,
        death_time: Timestamp,
    ) -> Self {
        let chunk_index = calculate_chunk_index(pos_x, pos_y);
        let despawn_at = death_time + Duration::from_secs(DEFAULT_ANIMAL_CORPSE_DESPAWN_SECONDS);

        AnimalCorpse {
            id: 0, // Will be auto-incremented
            animal_species,
            animal_id,
            pos_x,
            pos_y,
            chunk_index,
            death_time,
            despawn_at,
            health: ANIMAL_CORPSE_INITIAL_HEALTH,
            max_health: ANIMAL_CORPSE_INITIAL_HEALTH,
            last_hit_time: None,
            last_hit_by: None,
        }
    }
}

/// Creates an animal corpse when an animal dies
/// This should be called from the wild animal system when an animal is killed
pub fn create_animal_corpse(
    ctx: &ReducerContext,
    animal_species: AnimalSpecies,
    animal_id: u64,
    pos_x: f32,
    pos_y: f32,
    death_time: Timestamp,
) -> Result<u32, String> {
    log::info!(
        "Creating animal corpse for {:?} (ID: {}) at ({:.1}, {:.1})",
        animal_species, animal_id, pos_x, pos_y
    );

    let new_corpse = AnimalCorpse::new(animal_species, animal_id, pos_x, pos_y, death_time);
    log::info!(
        "🦴 [SERVER] Animal corpse created with chunk_index: {}, despawn_at: {:?}",
        new_corpse.chunk_index, new_corpse.despawn_at
    );

    let inserted_corpse = match ctx.db.animal_corpse().try_insert(new_corpse) {
        Ok(corpse) => corpse,
        Err(e) => {
            log::error!("Failed to create animal corpse for {:?} (ID: {}): {:?}", animal_species, animal_id, e);
            return Err(format!("Failed to create animal corpse: {:?}", e));
        }
    };

    log::info!(
        "🦴 [SERVER] Successfully inserted animal corpse with ID {} for {:?} (original ID: {}) at chunk {}",
        inserted_corpse.id, animal_species, animal_id, inserted_corpse.chunk_index
    );

    Ok(inserted_corpse.id)
}

/// Gets the loot table for a specific animal species
/// Returns (base_animal_fat_chance, base_cloth_chance, base_bone_chance, base_meat_chance)
pub fn get_animal_loot_chances(animal_species: AnimalSpecies) -> (f64, f64, f64, f64) {
    match animal_species {
        AnimalSpecies::CinderFox => (0.60, 0.80, 0.30, 0.70), // High cloth (fur), good meat, some fat, low bone
        AnimalSpecies::TundraWolf => (0.70, 0.50, 0.60, 0.80), // Good fat and bone, decent cloth (pelt), good meat
        AnimalSpecies::CableViper => (0.30, 0.20, 0.90, 0.40), // Low fat/cloth, very high bone (scales), some meat
    }
}

/// Gets the meat type for a specific animal
pub fn get_animal_meat_type(animal_species: AnimalSpecies) -> &'static str {
    match animal_species {
        AnimalSpecies::CinderFox => "Raw Fox Meat",
        AnimalSpecies::TundraWolf => "Raw Wolf Meat",
        AnimalSpecies::CableViper => "Raw Viper Meat",
    }
}

/// Scheduled reducer for cleaning up old animal corpses
/// This will be called periodically to remove corpses that have been around too long
#[spacetimedb::reducer]
pub fn cleanup_expired_animal_corpses(ctx: &ReducerContext) -> Result<(), String> {
    if ctx.sender != ctx.identity() {
        return Err("cleanup_expired_animal_corpses can only be called by the scheduler".to_string());
    }

    let current_time = ctx.timestamp;
    let animal_corpse_table = ctx.db.animal_corpse();
    
    let expired_corpses: Vec<u32> = animal_corpse_table
        .iter()
        .filter(|corpse| current_time >= corpse.despawn_at)
        .map(|corpse| corpse.id)
        .collect();

    let mut cleaned_count = 0;
    for corpse_id in expired_corpses {
        if animal_corpse_table.id().delete(&corpse_id) {
            cleaned_count += 1;
            log::debug!("Cleaned up expired animal corpse {}", corpse_id);
        }
    }

    if cleaned_count > 0 {
        log::info!("Cleaned up {} expired animal corpses", cleaned_count);
    }

    Ok(())
}

/// Gets the harvest loot for a specific animal species based on tool effectiveness
/// Returns a vector of (resource_name, quantity) tuples
pub fn get_harvest_loot(
    animal_species: AnimalSpecies, 
    tool_name: &str,
    target_type: Option<TargetType>,
    tool_category: ItemCategory,
    rng: &mut impl rand::Rng,
) -> Vec<(String, u32)> {
    let mut loot = Vec::new();
    
    // Get base loot chances for this animal species
    let (base_fat_chance, base_cloth_chance, base_bone_chance, base_meat_chance) = get_animal_loot_chances(animal_species);
    
    // Determine tool effectiveness multiplier (similar to player corpse logic)
    const BONE_KNIFE_MULTIPLIER: f64 = 5.0;
    const BONE_CLUB_MULTIPLIER: f64 = 3.0;
    const PRIMARY_CORPSE_TOOL_MULTIPLIER: f64 = 1.0;
    const NON_PRIMARY_ITEM_MULTIPLIER: f64 = 0.1;
    
    let effectiveness_multiplier = match tool_name {
        "Bone Knife" => BONE_KNIFE_MULTIPLIER,
        "Bone Club" => BONE_CLUB_MULTIPLIER,
        _ => {
            if target_type == Some(TargetType::AnimalCorpse) {
                PRIMARY_CORPSE_TOOL_MULTIPLIER
            } else {
                NON_PRIMARY_ITEM_MULTIPLIER
            }
        }
    };
    
    // Calculate actual chances with multiplier (clamped to reasonable values)
    let actual_fat_chance = (base_fat_chance * effectiveness_multiplier).clamp(0.0, 0.95);
    let actual_cloth_chance = (base_cloth_chance * effectiveness_multiplier).clamp(0.0, 0.95);
    let actual_bone_chance = (base_bone_chance * effectiveness_multiplier).clamp(0.0, 0.95);
    let actual_meat_chance = (base_meat_chance * effectiveness_multiplier).clamp(0.0, 0.95);
    
    // Determine quantity per successful hit based on tool
    let base_quantity = match tool_name {
        "Bone Knife" => rng.gen_range(3..=5),
        "Bone Club" => rng.gen_range(2..=4),
        _ => {
            if target_type == Some(TargetType::AnimalCorpse) && tool_category == ItemCategory::Tool {
                rng.gen_range(1..=2) // Other primary tools for corpses
            } else if tool_category == ItemCategory::Tool {
                1 // Non-primary tools get minimal yield
            } else {
                1 // Non-tool items get minimal yield
            }
        }
    };
    
    // Roll for each resource type
    if rng.gen_bool(actual_fat_chance) {
        loot.push(("Animal Fat".to_string(), base_quantity));
    }
    
    if rng.gen_bool(actual_cloth_chance) {
        let cloth_type = match animal_species {
            AnimalSpecies::CinderFox => "Fox Fur", // Fox has valuable fur (common material)
            AnimalSpecies::TundraWolf => "Wolf Fur", // Wolf has warm fur (common material)  
            AnimalSpecies::CableViper => "Viper Scale", // Viper has scales (treated as cloth)
        };
        loot.push((cloth_type.to_string(), base_quantity));
    }
    
    // Rare trophy drops - only with good tools and low chance
    if tool_name == "Bone Knife" {
        let rare_trophy_chance = match animal_species {
            AnimalSpecies::CinderFox => 0.15, // 15% chance for Fox Pelt with bone knife
            AnimalSpecies::TundraWolf => 0.12, // 12% chance for Wolf Pelt with bone knife
            AnimalSpecies::CableViper => 0.0, // No rare trophy for viper
        };
        
        if rare_trophy_chance > 0.0 && rng.gen_bool(rare_trophy_chance) {
            let rare_trophy = match animal_species {
                AnimalSpecies::CinderFox => "Fox Pelt", // Rare placeable trophy
                AnimalSpecies::TundraWolf => "Wolf Pelt", // Rare placeable trophy
                AnimalSpecies::CableViper => unreachable!(), // Already checked above
            };
            loot.push((rare_trophy.to_string(), 1)); // Always quantity 1 for rare trophies
        }
    }
    
         if rng.gen_bool(actual_bone_chance) {
         loot.push(("Animal Bone".to_string(), base_quantity));
     }
    
    if rng.gen_bool(actual_meat_chance) {
        let meat_type = get_animal_meat_type(animal_species);
        loot.push((meat_type.to_string(), base_quantity));
    }
    
    // Note: Skull rewards are handled separately when corpse is depleted (like player corpses)
    // This function only handles regular harvesting loot
    
    loot
} 