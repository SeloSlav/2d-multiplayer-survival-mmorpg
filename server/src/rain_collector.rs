/******************************************************************************
 *                                                                            *
 * Defines the RainCollector entity and its data structure.                  *
 * Handles placing collectors and managing their internal inventory.          *
 * Each collector automatically fills water containers during rain events.   *
 *                                                                            *
 ******************************************************************************/

use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};
use log;

// --- Constants --- 
pub(crate) const RAIN_COLLECTOR_COLLISION_RADIUS: f32 = 30.0; // Increased for easier targeting from all sides
pub(crate) const RAIN_COLLECTOR_COLLISION_Y_OFFSET: f32 = 0.0; // Match client-side visual alignment
pub(crate) const PLAYER_RAIN_COLLECTOR_COLLISION_DISTANCE_SQUARED: f32 = (super::PLAYER_RADIUS + RAIN_COLLECTOR_COLLISION_RADIUS) * (super::PLAYER_RADIUS + RAIN_COLLECTOR_COLLISION_RADIUS);
const RAIN_COLLECTOR_INTERACTION_DISTANCE_SQUARED: f32 = 96.0 * 96.0; // Same as storage box
pub(crate) const RAIN_COLLECTOR_RAIN_COLLECTOR_COLLISION_DISTANCE_SQUARED: f32 = (RAIN_COLLECTOR_COLLISION_RADIUS * 2.0) * (RAIN_COLLECTOR_COLLISION_RADIUS * 2.0);

// --- Water collection constants ---
pub const RAIN_COLLECTOR_MAX_WATER: f32 = 40.0; // Maximum water capacity
pub const RAIN_COLLECTOR_INITIAL_HEALTH: f32 = 500.0;
pub const RAIN_COLLECTOR_MAX_HEALTH: f32 = 500.0;

// --- Water container capacities in liters ---
pub const REED_WATER_BOTTLE_CAPACITY: f32 = 2.0; // 2 liters
pub const PLASTIC_WATER_JUG_CAPACITY: f32 = 5.0; // 5 liters

// Collection rates per second based on weather type (realistic for small reed collector)
pub const LIGHT_RAIN_COLLECTION_RATE: f32 = 0.1;    // units per second
pub const MODERATE_RAIN_COLLECTION_RATE: f32 = 0.3; // units per second  
pub const HEAVY_RAIN_COLLECTION_RATE: f32 = 0.6;    // units per second
pub const HEAVY_STORM_COLLECTION_RATE: f32 = 1.0;   // units per second

// --- Container constants ---
const RAIN_COLLECTOR_NUM_SLOTS: usize = 1; // Single slot for water container

// --- Import Table Traits and Concrete Types ---
use crate::player as PlayerTableTrait;
use crate::Player;
use crate::items::{
    InventoryItem, ItemDefinition,
    inventory_item as InventoryItemTableTrait, 
    item_definition as ItemDefinitionTableTrait,
    add_item_to_player_inventory
};
use crate::sound_events::emit_filling_container_sound;
use crate::rain_collector::rain_collector as RainCollectorTableTrait;
use crate::environment::calculate_chunk_index;
use crate::wooden_storage_box::wooden_storage_box as WoodenStorageBoxTableTrait;
use crate::models::{ContainerType, ItemLocation};
use crate::inventory_management::{ItemContainer, ContainerItemClearer};

/// --- Rain Collector Data Structure ---
/// Represents a rain collection device in the game world.
/// Automatically fills water containers during rain events.
#[spacetimedb::table(name = rain_collector, public)]
#[derive(Clone)]
pub struct RainCollector {
    #[primary_key]
    #[auto_inc]
    pub id: u32, // Unique identifier for this rain collector instance

    pub pos_x: f32,
    pub pos_y: f32,
    pub chunk_index: u32, // For spatial partitioning

    pub placed_by: Identity, // Who placed this rain collector
    pub placed_at: Timestamp, // When it was placed

    // --- Container Inventory ---
    pub slot_0_instance_id: Option<u64>, // Single slot for water container
    pub slot_0_def_id: Option<u64>,

    // --- Health System ---
    pub health: f32,
    pub max_health: f32,
    pub is_destroyed: bool,
    pub destroyed_at: Option<Timestamp>,
    pub last_hit_time: Option<Timestamp>,
    pub last_damaged_by: Option<Identity>, // Track who last damaged this collector

    // --- Collection Tracking ---
    pub total_water_collected: f32, // Lifetime total for statistics
    pub last_collection_time: Option<Timestamp>, // Last time water was collected
}

/// Implement ItemContainer trait for RainCollector
impl ItemContainer for RainCollector {
    fn num_slots(&self) -> usize {
        RAIN_COLLECTOR_NUM_SLOTS
    }

    fn get_slot_instance_id(&self, slot_index: u8) -> Option<u64> {
        match slot_index {
            0 => self.slot_0_instance_id,
            _ => None,
        }
    }

    fn get_slot_def_id(&self, slot_index: u8) -> Option<u64> {
        match slot_index {
            0 => self.slot_0_def_id,
            _ => None,
        }
    }

    fn set_slot(&mut self, slot_index: u8, instance_id: Option<u64>, def_id: Option<u64>) {
        match slot_index {
            0 => {
                self.slot_0_instance_id = instance_id;
                self.slot_0_def_id = def_id;
            }
            _ => {
                log::warn!("Invalid slot index {} for rain collector", slot_index);
            }
        }
    }

    fn get_container_type(&self) -> ContainerType {
        ContainerType::RainCollector
    }

    fn get_container_id(&self) -> u64 {
        self.id as u64
    }
}

/// Implement ContainerItemClearer trait for RainCollector
impl ContainerItemClearer for RainCollector {
    fn clear_item(ctx: &ReducerContext, item_instance_id: u64) -> bool {
        let rain_collectors: Vec<_> = ctx.db.rain_collector().iter().collect();
        
        for mut collector in rain_collectors {
            // Check if the item is in this collector's slot
            if collector.slot_0_instance_id == Some(item_instance_id) {
                log::info!("Clearing item {} from rain collector {} slot 0", item_instance_id, collector.id);
                collector.slot_0_instance_id = None;
                collector.slot_0_def_id = None;
                ctx.db.rain_collector().id().update(collector);
                return true;
            }
        }
        
        false // Item not found in any rain collector
    }
}

/******************************************************************************
 *                                 REDUCERS                                   *
 ******************************************************************************/

/// --- Place Rain Collector ---
/// Places a new rain collector in the world at the specified position.
/// Consumes the item from player's inventory and creates the collector entity.
#[spacetimedb::reducer]
pub fn place_rain_collector(ctx: &ReducerContext, item_instance_id: u64, world_x: f32, world_y: f32) -> Result<(), String> {
    log::info!("Player {} attempting to place rain collector at ({}, {})", ctx.sender, world_x, world_y);

    // --- Get player and validate ---
    let players = ctx.db.player();
    let player = players.identity().find(&ctx.sender)
        .ok_or_else(|| "Player not found.".to_string())?;

    // --- Validate item ---
    let items = ctx.db.inventory_item();
    let item = items.instance_id().find(&item_instance_id)
        .ok_or_else(|| "Item not found.".to_string())?;
    
    // Verify ownership by checking the item's location
    let owns_item = match &item.location {
        crate::models::ItemLocation::Inventory(data) => data.owner_id == ctx.sender,
        crate::models::ItemLocation::Hotbar(data) => data.owner_id == ctx.sender,
        crate::models::ItemLocation::Equipped(data) => data.owner_id == ctx.sender,
        _ => false, // Other locations like containers don't belong to players
    };
    
    if !owns_item {
        return Err("You don't own this item.".to_string());
    }

    // --- Get item definition ---
    let item_defs = ctx.db.item_definition();
    let item_def = item_defs.id().find(&item.item_def_id)
        .ok_or_else(|| "Item definition not found.".to_string())?;

    // Verify it's actually a rain collector
    if item_def.name != "Reed Rain Collector" {
        return Err("This item is not a rain collector.".to_string());
    }

    // --- Validate placement position ---
    let distance_to_player = ((world_x - player.position_x).powi(2) + (world_y - player.position_y).powi(2)).sqrt();
    if distance_to_player > 150.0 {
        return Err("Cannot place rain collector that far away.".to_string());
    }

    // --- Check for collisions with other rain collectors ---
    let collectors = ctx.db.rain_collector();
    for existing_collector in collectors.iter() {
        if existing_collector.is_destroyed {
            continue;
        }
        let distance_squared = (world_x - existing_collector.pos_x).powi(2) + (world_y - existing_collector.pos_y).powi(2);
        if distance_squared < RAIN_COLLECTOR_RAIN_COLLECTOR_COLLISION_DISTANCE_SQUARED {
            return Err("Cannot place rain collector too close to another rain collector.".to_string());
        }
    }

    // --- Check for collisions with other structures ---
    // Check wooden storage boxes
    let boxes = ctx.db.wooden_storage_box();
    for existing_box in boxes.iter() {
        if existing_box.is_destroyed {
            continue;
        }
        let distance_squared = (world_x - existing_box.pos_x).powi(2) + (world_y - existing_box.pos_y).powi(2);
        // Use sum of both collision radii
        let collision_distance_squared = (RAIN_COLLECTOR_COLLISION_RADIUS + crate::wooden_storage_box::BOX_COLLISION_RADIUS).powi(2);
        if distance_squared < collision_distance_squared {
            return Err("Cannot place rain collector too close to storage box.".to_string());
        }
    }

    // --- Calculate chunk index for spatial partitioning ---
    let chunk_index = calculate_chunk_index(world_x, world_y);

    // --- Create the rain collector ---
    let new_collector = RainCollector {
        id: 0, // Auto-increment
        pos_x: world_x,
        pos_y: world_y,
        chunk_index,
        placed_by: ctx.sender,
        placed_at: ctx.timestamp,
        slot_0_instance_id: None, // Start with empty inventory
        slot_0_def_id: None,
        health: RAIN_COLLECTOR_INITIAL_HEALTH,
        max_health: RAIN_COLLECTOR_MAX_HEALTH,
        is_destroyed: false,
        destroyed_at: None,
        last_hit_time: None,
        last_damaged_by: None,
        total_water_collected: 0.0,
        last_collection_time: None,
    };

    // --- Insert collector into database ---
    let mut collectors = ctx.db.rain_collector();
    collectors.insert(new_collector);

    // --- Remove item from player's inventory ---
    let mut items = ctx.db.inventory_item();
    items.instance_id().delete(&item_instance_id);

    log::info!("Rain collector placed successfully at ({}, {}) by player {}", world_x, world_y, ctx.sender);
    Ok(())
}

/// --- Move Item to Rain Collector ---
/// Moves an item from player inventory to the rain collector's single slot.
#[spacetimedb::reducer]
pub fn move_item_to_rain_collector(
    ctx: &ReducerContext,
    collector_id: u32,
    item_instance_id: u64,
    target_slot_index: u8,
) -> Result<(), String> {
    log::info!("Player {} moving item {} to rain collector {} slot {}", 
               ctx.sender, item_instance_id, collector_id, target_slot_index);

    // --- Validate interaction ---
    let (_player, mut collector) = validate_collector_interaction(ctx, collector_id)?;

    // --- Validate item type for rain collector ---
    let item_table = ctx.db.inventory_item();
    let item_def_table = ctx.db.item_definition();
    
    let item = item_table.instance_id().find(item_instance_id)
        .ok_or_else(|| "Item not found.".to_string())?;
    let item_def = item_def_table.id().find(item.item_def_id)
        .ok_or_else(|| "Item definition not found.".to_string())?;
    
    // Only allow water containers in rain collectors
    let allowed_items = ["Reed Water Bottle", "Plastic Water Jug"];
    if !allowed_items.contains(&item_def.name.as_str()) {
        return Err(format!("Only water containers (Reed Water Bottle, Plastic Water Jug) can be placed in rain collectors. '{}' is not allowed.", item_def.name));
    }

    // --- Use inventory management system ---
    crate::inventory_management::handle_move_to_container_slot(ctx, &mut collector, target_slot_index, item_instance_id)?;

    // --- Update collector in database ---
    ctx.db.rain_collector().id().update(collector);

    Ok(())
}

/// --- Move Item from Rain Collector ---
/// Moves an item from the rain collector to player inventory/hotbar.
#[spacetimedb::reducer]
pub fn move_item_from_rain_collector(
    ctx: &ReducerContext,
    collector_id: u32,
    source_slot_index: u8,
    target_slot_type: String,
    target_slot_index: u32,
) -> Result<(), String> {
    log::info!("Player {} moving item from rain collector {} slot {} to {} slot {}", 
               ctx.sender, collector_id, source_slot_index, target_slot_type, target_slot_index);

    // --- Validate interaction ---
    let (_player, mut collector) = validate_collector_interaction(ctx, collector_id)?;

    // --- Use inventory management system ---
    crate::inventory_management::handle_move_from_container_slot(
        ctx, 
        &mut collector, 
        source_slot_index, 
        target_slot_type, 
        target_slot_index
    )?;

    // --- Update collector in database ---
    ctx.db.rain_collector().id().update(collector);

    Ok(())
}

/// --- Quick Move Item from Rain Collector ---
/// Automatically finds the next available inventory/hotbar slot for the item.
#[spacetimedb::reducer]
pub fn quick_move_item_from_rain_collector(
    ctx: &ReducerContext,
    collector_id: u32,
    source_slot_index: u8,
) -> Result<(), String> {
    log::info!("Player {} quick moving item from rain collector {} slot {}", 
               ctx.sender, collector_id, source_slot_index);

    // --- Validate interaction ---
    let (_player, mut collector) = validate_collector_interaction(ctx, collector_id)?;

    // --- Use inventory management system for quick move ---
    crate::inventory_management::handle_quick_move_from_container(
        ctx, 
        &mut collector, 
        source_slot_index
    )?;

    // --- Update collector in database ---
    ctx.db.rain_collector().id().update(collector);

    Ok(())
}

/// --- Fill Water Container ---
/// Fills a water container in the rain collector with collected rainwater.
#[spacetimedb::reducer]
pub fn fill_water_container(ctx: &ReducerContext, collector_id: u32) -> Result<(), String> {
    log::info!("Player {} attempting to fill water container in collector {}", ctx.sender, collector_id);

    // --- Validate interaction ---
    let (_player, mut collector) = validate_collector_interaction(ctx, collector_id)?;

    // --- Check if there's a container in the slot ---
    let container_instance_id = collector.slot_0_instance_id
        .ok_or_else(|| "No water container in rain collector.".to_string())?;

    // --- Get the container item ---
    let items = ctx.db.inventory_item();
    let mut container_item = items.instance_id().find(&container_instance_id)
        .ok_or_else(|| "Water container not found.".to_string())?;

    // --- Get container definition ---
    let item_defs = ctx.db.item_definition();
    let container_def = item_defs.id().find(&container_item.item_def_id)
        .ok_or_else(|| "Container definition not found.".to_string())?;

    // --- Determine container capacity ---
    let capacity = match container_def.name.as_str() {
        "Reed Water Bottle" => REED_WATER_BOTTLE_CAPACITY,
        "Plastic Water Jug" => PLASTIC_WATER_JUG_CAPACITY,
        _ => return Err("Item is not a valid water container.".to_string()),
    };

    // --- Check if collector has any water ---
    if collector.total_water_collected <= 0.0 {
        return Err("Rain collector has no water to transfer.".to_string());
    }

    // --- Get current water content in container ---
    let current_water = crate::items::get_water_content(&container_item).unwrap_or(0.0);
    let available_capacity = capacity - current_water;

    // --- Check if container has any available capacity ---
    if available_capacity <= 0.0 {
        return Err("Water container is already full.".to_string());
    }

    // --- Calculate how much water to transfer (limited by available water and container capacity) ---
    let water_to_transfer = collector.total_water_collected.min(available_capacity);
    let new_water_content = current_water + water_to_transfer;

    // --- Fill the container with water ---
    crate::items::set_water_content(&mut container_item, new_water_content)?;
    items.instance_id().update(container_item);

    // --- Reduce collector water by amount transferred ---
    collector.total_water_collected -= water_to_transfer;
    let remaining_collector_water = collector.total_water_collected; // Capture before move
    
    // --- Capture position before move for sound effect ---
    let collector_pos_x = collector.pos_x;
    let collector_pos_y = collector.pos_y;
    
    ctx.db.rain_collector().id().update(collector);

    // --- Emit filling container sound effect ---
    emit_filling_container_sound(ctx, collector_pos_x, collector_pos_y, ctx.sender);

    log::info!("Successfully transferred {:.1}L of water to {} (now has {:.1}L/{:.1}L). Collector now has {:.1}L remaining.", 
               water_to_transfer, container_def.name, new_water_content, capacity, remaining_collector_water);

    Ok(())
}

/// --- Update All Rain Collectors During Rain Events ---
/// Called by the world state system during rain to update all collectors.
/// This is the main entry point for rain collection logic.
pub fn update_rain_collectors(ctx: &ReducerContext, weather: &crate::world_state::WeatherType, elapsed_seconds: f32) -> Result<(), String> {
    // Only collect water during rain
    if *weather == crate::world_state::WeatherType::Clear {
        return Ok(());
    }
    
    // Get collection rate based on weather type
    let collection_rate = match weather {
        crate::world_state::WeatherType::LightRain => LIGHT_RAIN_COLLECTION_RATE,
        crate::world_state::WeatherType::ModerateRain => MODERATE_RAIN_COLLECTION_RATE,
        crate::world_state::WeatherType::HeavyRain => HEAVY_RAIN_COLLECTION_RATE,
        crate::world_state::WeatherType::HeavyStorm => HEAVY_STORM_COLLECTION_RATE,
        crate::world_state::WeatherType::Clear => return Ok(()), // Already handled above
    };
    
    // Calculate water to add this tick
    let water_to_add = collection_rate * elapsed_seconds;
    
    if water_to_add <= 0.0 {
        return Ok(()); // No water to add this tick
    }
    
    // Update all active rain collectors
    let collectors: Vec<_> = ctx.db.rain_collector().iter()
        .filter(|c| !c.is_destroyed)
        .collect();
    
    let mut updated_count = 0;
    for mut collector in collectors {
        // Check capacity limit before adding water
        if collector.total_water_collected < RAIN_COLLECTOR_MAX_WATER {
            let water_before = collector.total_water_collected;
            let collector_id = collector.id; // Capture ID before move
            collector.total_water_collected = (collector.total_water_collected + water_to_add).min(RAIN_COLLECTOR_MAX_WATER);
            let water_after = collector.total_water_collected; // Capture final amount before move
            collector.last_collection_time = Some(ctx.timestamp);
            
            // Update the collector in the database
            ctx.db.rain_collector().id().update(collector);
            updated_count += 1;
            
            log::debug!("Collector {} water: {:.1} -> {:.1} (max: {})", 
                       collector_id, water_before, water_after, RAIN_COLLECTOR_MAX_WATER);
        }
    }
    
    if updated_count > 0 {
        log::info!("Added {:.1} water units to {} rain collectors during {:?}", 
                   water_to_add, updated_count, weather);
    }
    
    Ok(())
}

/// --- Add Water to Specific Collector (Internal Helper) ---
/// Helper function for adding water to a specific collector by ID.
/// Used by the update system and potentially other internal systems.
pub fn add_water_to_collector(ctx: &ReducerContext, collector_id: u32, amount: f32) -> Result<(), String> {
    let collectors = ctx.db.rain_collector();
    let mut collector = collectors.id().find(&collector_id)
        .ok_or_else(|| format!("Rain collector {} not found", collector_id))?;

    if collector.is_destroyed {
        return Err("Collector is destroyed".to_string());
    }

    // Apply capacity limit
    collector.total_water_collected = (collector.total_water_collected + amount).min(RAIN_COLLECTOR_MAX_WATER);
    collector.last_collection_time = Some(ctx.timestamp);
    
    // Update the collector in the database
    ctx.db.rain_collector().id().update(collector);
    
    Ok(())
}

/******************************************************************************
 *                              HELPER FUNCTIONS                              *
 ******************************************************************************/

/// Validates that a player can interact with a rain collector.
/// Checks existence, distance, and returns both player and collector data.
fn validate_collector_interaction(
    ctx: &ReducerContext,
    collector_id: u32,
) -> Result<(Player, RainCollector), String> {
    // --- Get player ---
    let players = ctx.db.player();
    let player = players.identity().find(&ctx.sender)
        .ok_or_else(|| "Player not found.".to_string())?;

    // --- Get collector ---
    let collectors = ctx.db.rain_collector();
    let collector = collectors.id().find(&collector_id)
        .ok_or_else(|| "Rain collector not found.".to_string())?;

    // --- Check if collector is destroyed ---
    if collector.is_destroyed {
        return Err("Rain collector is destroyed.".to_string());
    }

    // --- Check distance ---
    let distance_squared = (player.position_x - collector.pos_x).powi(2) + (player.position_y - collector.pos_y).powi(2);
    if distance_squared > RAIN_COLLECTOR_INTERACTION_DISTANCE_SQUARED {
        return Err("Too far away from rain collector.".to_string());
    }

    Ok((player, collector))
} 