use spacetimedb::{Table, ReducerContext, Identity, Timestamp};
use log;
use rand::Rng;

// Module imports
use crate::collectible_resources::{
    BASE_RESOURCE_RADIUS, PLAYER_RESOURCE_INTERACTION_DISTANCE_SQUARED,
    validate_player_resource_interaction,
    collect_resource_and_schedule_respawn,
    RespawnableResource
};

// Import plant types and configurations from the dedicated database
use crate::plants_database::{PlantType, PlantConfig, SpawnCondition, PLANT_CONFIGS};

// Table trait imports for database access
use crate::items::{inventory_item as InventoryItemTableTrait, item_definition as ItemDefinitionTableTrait};
use crate::player as PlayerTableTrait;

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
    // Pass the plant entity name (not the yield item name) for proper seed mapping
    let plant_entity_name = crate::plants_database::plant_type_to_entity_name(&resource.plant_type);
    crate::collectible_resources::try_grant_seed_drops(
        ctx,
        player_id,
        plant_entity_name,
        &mut ctx.rng().clone(),
    )?;

    Ok(())
}

// --- Helper Functions for Environment Seeding ---

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