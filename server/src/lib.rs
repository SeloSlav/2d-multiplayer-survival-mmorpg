use spacetimedb::{Identity, Timestamp, ReducerContext, Table, ConnectionId};
use rand::Rng; // Add Rng trait for ctx.rng().gen()
use log;
use std::time::Duration;
use crate::environment::calculate_chunk_index; // Make sure this helper is available
use crate::environment::WORLD_WIDTH_CHUNKS; // Import chunk constant for optimization
use crate::models::{ContainerType, ItemLocation}; // Ensure ItemLocation and ContainerType are in scope

// Declare the module
mod environment;
mod tree; // Add tree module
mod stone; // Add stone module
// Declare the items module
mod items;
// Declare the world_state module
mod world_state;
// Declare the campfire module
mod campfire;
// Declare the lantern module
mod lantern;
// Declare the active_equipment module
mod active_equipment;
// Declare the player_inventory module
mod player_inventory;
// Declare the consumables module
mod consumables;
mod utils; // Declare utils module
mod dropped_item; // Declare dropped_item module
mod wooden_storage_box; // Add the new module

mod items_database; // <<< NEW: Modular items database
mod starting_items; // <<< ADDED module declaration
mod inventory_management; // <<< ADDED new module
mod spatial_grid; // ADD: Spatial grid module for optimized collision detection
mod crafting; // ADD: Crafting recipe definitions
mod crafting_queue; // ADD: Crafting queue logic
mod player_stats; // ADD: Player stat scheduling logic
mod global_tick; // ADD: Global tick scheduling logic
mod chat; // ADD: Chat module for message handling
mod player_pin; // ADD: Player pin module for minimap
pub mod combat; // Add the new combat module
mod repair; // ADD: Repair module for structure repair functionality
mod collectible_resources; // Add the new collectible resources system
mod plants_database; // NEW: Plant configuration database
mod harvestable_resource; // NEW: Unified harvestable resource system
mod sleeping_bag; // ADD Sleeping Bag module
mod player_corpse; // <<< ADDED: Declare Player Corpse module
mod models; // <<< ADDED
mod cooking; // <<< ADDED: For generic cooking logic
mod stash; // Added Stash module
mod planted_seeds; // Added for farming system with planted seeds
pub mod active_effects; // Added for timed consumable effects
mod cloud; // Add the new cloud module
mod armor; // <<< ADDED armor module
mod grass; // <<< ADDED grass module
mod player_movement; // <<< ADDED player movement module
mod knocked_out; // <<< ADDED knocked out recovery module
mod bones; // <<< ADDED bones module
mod ranged_weapon_stats; // Add this line
mod projectile; // Add this line
mod death_marker; // <<< ADDED death marker module
mod torch; // <<< ADDED torch module
mod respawn; // <<< ADDED respawn module
mod player_collision; // <<< ADDED player_collision module
mod shelter; // <<< ADDED shelter module
mod world_generation; // <<< ADDED world generation module
mod fishing; // <<< ADDED fishing module
mod drinking; // <<< ADDED drinking module
mod wet; // <<< ADDED wet status effect module
mod sound_events; // <<< ADDED sound events module
mod rain_collector; // <<< ADDED rain collector module
mod water_patch; // <<< ADDED water patch module for crop watering
pub mod wild_animal_npc; // <<< ADDED wild animal NPC system (now modular)
mod animal_collision; // <<< ADDED animal collision system
mod barrel; // <<< ADDED roadside barrel loot system
mod metadata_providers; // <<< ADDED: Provides plant/seed metadata to client
mod sea_stack; // <<< ADDED: Sea stack decorative entities

// ADD: Re-export respawn reducer
pub use respawn::respawn_randomly;

// ADD: Re-export player movement reducers
pub use player_movement::{set_sprinting, toggle_crouch, jump, dodge_roll};

// ADD: Re-export shelter placement reducer
pub use shelter::place_shelter;

// ADD: Re-export sleeping bag respawn reducer
pub use sleeping_bag::respawn_at_sleeping_bag;

// ADD: Re-export world generation reducer
pub use world_generation::generate_world;

// ADD: Re-export fishing reducers
pub use fishing::{cast_fishing_line, finish_fishing, cancel_fishing};

// ADD: Re-export drinking reducers
pub use drinking::{drink_water, fill_water_container_from_natural_source};

// ADD: Re-export planted seeds reducer
pub use planted_seeds::plant_seed;

// ADD: Re-export rain collector reducers
pub use rain_collector::{place_rain_collector, move_item_to_rain_collector, move_item_from_rain_collector, fill_water_container};

// ADD: Re-export water container consumption reducer
pub use consumables::consume_filled_water_container;

// ADD: Re-export water patch reducer
pub use water_patch::water_crops;

// ADD: Re-export wild animal NPC reducers
pub use wild_animal_npc::{spawn_wild_animal, damage_wild_animal, process_wild_animal_ai};

// ADD: Re-export barrel reducers
pub use barrel::attack_barrel;

// ADD: Re-export unified harvestable resource reducer
pub use harvestable_resource::interact_with_harvestable_resource;

// ADD: Re-export metadata provider helper functions
pub use metadata_providers::{is_plantable_seed, get_plant_type_from_seed_name};

// Define a constant for the /kill command cooldown (e.g., 5 minutes)
pub const KILL_COMMAND_COOLDOWN_SECONDS: u64 = 300;

// Table to store the last time a player used the /kill command
#[spacetimedb::table(name = player_kill_command_cooldown)]
#[derive(Clone, Debug)]
pub struct PlayerKillCommandCooldown {
    #[primary_key]
    player_id: Identity,
    last_kill_command_at: Timestamp,
}

// Table for private system messages to individual players
#[spacetimedb::table(name = private_message, public)] // Public so client can subscribe with filter
#[derive(Clone, Debug)]
pub struct PrivateMessage {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub recipient_identity: Identity, // The player who should see this message
    pub sender_display_name: String,  // e.g., "SYSTEM"
    pub text: String,
    pub sent: Timestamp,
}

// Re-export chat types and reducers for use in other modules
pub use chat::Message;

// Re-export player movement reducer for client bindings
pub use player_movement::update_player_position_simple;

// Re-export campfire reducer for client bindings
pub use campfire::place_campfire;

// Re-export lantern reducers for client bindings
pub use lantern::{place_lantern, add_fuel_to_lantern, light_lantern, extinguish_lantern, pickup_lantern};

// Re-export knocked out functions and types for other modules
pub use knocked_out::{schedule_knocked_out_recovery, KnockedOutRecoverySchedule, KnockedOutStatus};
pub use knocked_out::process_knocked_out_recovery; // For scheduler
pub use knocked_out::revive_knocked_out_player; // For client bindings  
pub use knocked_out::get_knocked_out_status; // For client bindings

// Re-export bones reducer for client bindings
pub use bones::crush_bone_item;

// ADD: Re-export torch reducer for client bindings
pub use torch::toggle_torch;

// Import Table Traits needed in this module
use crate::tree::tree as TreeTableTrait;
use crate::stone::stone as StoneTableTrait;
use crate::campfire::campfire as CampfireTableTrait;
use crate::lantern::lantern as LanternTableTrait;
use crate::harvestable_resource::harvestable_resource as HarvestableResourceTableTrait;
use crate::world_state::world_state as WorldStateTableTrait;
use crate::items::inventory_item as InventoryItemTableTrait;
use crate::items::item_definition as ItemDefinitionTableTrait;
use crate::active_equipment::active_equipment as ActiveEquipmentTableTrait;
use crate::dropped_item::dropped_item_despawn_schedule as DroppedItemDespawnScheduleTableTrait;
use crate::wooden_storage_box::wooden_storage_box as WoodenStorageBoxTableTrait;
use crate::chat::message as MessageTableTrait; // Import the trait for Message table
use crate::sleeping_bag::sleeping_bag as SleepingBagTableTrait; // ADD Sleeping Bag trait import
use crate::player_stats::stat_thresholds_config as StatThresholdsConfigTableTrait; // <<< UPDATED: Import StatThresholdsConfig table trait
use crate::grass::grass as GrassTableTrait; // <<< ADDED: Import Grass table trait
use crate::knocked_out::knocked_out_status as KnockedOutStatusTableTrait; // <<< ADDED: Import KnockedOutStatus table trait
use crate::world_tile as WorldTileTableTrait; // <<< ADDED: Import WorldTile table trait
use crate::minimap_cache as MinimapCacheTableTrait; // <<< ADDED: Import MinimapCache table trait
use crate::player_movement::player_dodge_roll_state as PlayerDodgeRollStateTableTrait; // <<< ADDED: Import PlayerDodgeRollState table trait
use crate::world_chunk_data as WorldChunkDataTableTrait; // <<< ADDED: Import WorldChunkData table trait
use crate::fishing::fishing_session as FishingSessionTableTrait; // <<< ADDED: Import FishingSession table trait
use crate::drinking::player_drinking_cooldown as PlayerDrinkingCooldownTableTrait; // <<< ADDED: Import PlayerDrinkingCooldown table trait
use crate::planted_seeds::planted_seed as PlantedSeedTableTrait; // <<< ADDED: Import PlantedSeed table trait
use crate::sound_events::sound_event as SoundEventTableTrait; // <<< ADDED: Import SoundEvent table trait
use crate::sound_events::sound_event_cleanup_schedule as SoundEventCleanupScheduleTableTrait; // <<< ADDED: Import SoundEventCleanupSchedule table trait
use crate::rain_collector::rain_collector as RainCollectorTableTrait; // <<< ADDED: Import RainCollector table trait
use crate::water_patch::water_patch as WaterPatchTableTrait; // <<< ADDED: Import WaterPatch table trait
use crate::wild_animal_npc::wild_animal as WildAnimalTableTrait; // <<< ADDED: Import WildAnimal table trait
use crate::wild_animal_npc::wild_animal_ai_schedule as WildAnimalAiScheduleTableTrait; // <<< ADDED: Import WildAnimalAiSchedule table trait
use crate::wild_animal_npc::viper::viper_spittle as ViperSpittleTableTrait; // <<< ADDED: Import ViperSpittle table trait
use crate::wild_animal_npc::viper::viper_spittle_update_schedule as ViperSpittleUpdateScheduleTableTrait; // <<< ADDED: Import ViperSpittleUpdateSchedule table trait
use crate::wild_animal_npc::animal_corpse as AnimalCorpseTableTrait; // <<< ADDED: Import AnimalCorpse table trait
use crate::barrel::barrel as BarrelTableTrait; // <<< ADDED: Import Barrel table trait
use crate::barrel::barrel_respawn_schedule as BarrelRespawnScheduleTableTrait; // <<< ADDED: Import BarrelRespawnSchedule table trait
use crate::sea_stack::sea_stack as SeaStackTableTrait; // <<< ADDED: Import SeaStack table trait

// Use struct names directly for trait aliases
use crate::crafting::Recipe as RecipeTableTrait;
use crate::crafting_queue::CraftingQueueItem as CraftingQueueItemTableTrait;
use crate::crafting_queue::CraftingFinishSchedule as CraftingFinishScheduleTableTrait;
use crate::global_tick::GlobalTickSchedule as GlobalTickScheduleTableTrait;
use crate::PlayerLastAttackTimestamp as PlayerLastAttackTimestampTableTrait; // Import for the new table

// Import constants needed from player_stats
use crate::player_stats::{
    SPRINT_SPEED_MULTIPLIER,
    JUMP_COOLDOWN_MS,
    PLAYER_STARTING_HUNGER,
    PLAYER_STARTING_THIRST
};

// Use specific items needed globally (or use qualified paths)
use crate::world_state::TimeOfDay; // Keep TimeOfDay if needed elsewhere, otherwise remove
use crate::campfire::{Campfire, WARMTH_RADIUS_SQUARED, WARMTH_PER_SECOND, CAMPFIRE_COLLISION_RADIUS, CAMPFIRE_CAMPFIRE_COLLISION_DISTANCE_SQUARED, CAMPFIRE_COLLISION_Y_OFFSET, PLAYER_CAMPFIRE_COLLISION_DISTANCE_SQUARED, PLAYER_CAMPFIRE_INTERACTION_DISTANCE_SQUARED };

// Initial Amounts

// --- Global Constants ---
pub const TILE_SIZE_PX: u32 = 48;
pub const PLAYER_RADIUS: f32 = 32.0; // Player collision radius
pub const PLAYER_SPEED: f32 = 400.0; // Speed in pixels per second - balanced for 60s world traversal
pub const PLAYER_SPRINT_MULTIPLIER: f32 = 2.0; // 2x speed for sprinting (800 px/s) - MATCHES CLIENT

// ADD: Crouching reduces collision radius by half
pub const CROUCHING_RADIUS_MULTIPLIER: f32 = 0.5;

// ADD: Helper function to get effective player radius based on crouching state
pub fn get_effective_player_radius(is_crouching: bool) -> f32 {
    if is_crouching {
        PLAYER_RADIUS * CROUCHING_RADIUS_MULTIPLIER
    } else {
        PLAYER_RADIUS
    }
}

// ADD: Water movement constants
pub const WATER_SPEED_PENALTY: f32 = 0.5; // 50% speed reduction (50% of normal speed)

// World Dimensions (example)
pub const WORLD_WIDTH_TILES: u32 = 500;
pub const WORLD_HEIGHT_TILES: u32 = 500;
// Change back to f32 as they are used in float calculations
pub const WORLD_WIDTH_PX: f32 = (WORLD_WIDTH_TILES * TILE_SIZE_PX) as f32;
pub const WORLD_HEIGHT_PX: f32 = (WORLD_HEIGHT_TILES * TILE_SIZE_PX) as f32;

// ADD: Helper functions for water detection
/// Converts world pixel coordinates to tile coordinates
pub fn world_pos_to_tile_coords(world_x: f32, world_y: f32) -> (i32, i32) {
    let tile_x = (world_x / TILE_SIZE_PX as f32).floor() as i32;
    let tile_y = (world_y / TILE_SIZE_PX as f32).floor() as i32;
    (tile_x, tile_y)
}

/// Checks if a player is standing on a water tile (Sea type)
/// This is highly optimized using direct tile coordinate lookup
/// NEW: Uses compressed chunk data for much better performance
pub fn is_player_on_water(ctx: &ReducerContext, player_x: f32, player_y: f32) -> bool {
    // Convert player position to tile coordinates
    let (tile_x, tile_y) = world_pos_to_tile_coords(player_x, player_y);
    
    // NEW: Try compressed lookup first for much better performance
    if let Some(tile_type) = get_tile_type_at_position(ctx, tile_x, tile_y) {
        return tile_type == TileType::Sea;
    }
    
    // FALLBACK: Use original method if compressed data not available
    let world_tiles = ctx.db.world_tile();
    
    // Use the indexed world_position btree for fast lookup
    for tile in world_tiles.idx_world_position().filter((tile_x, tile_y)) {
        match tile.tile_type {
            TileType::Sea => return true,
            _ => return false,
        }
    }
    
    // No tile found at this position, assume land (safety fallback)
    false
}

/// Checks if a player is currently jumping (in the air)
/// Returns true if the player started a jump and is still within the jump duration
pub fn is_player_jumping(jump_start_time_ms: u64, current_time_ms: u64) -> bool {
    if jump_start_time_ms == 0 {
        return false; // Player has never jumped or jump has been reset
    }
    
    let elapsed_ms = current_time_ms.saturating_sub(jump_start_time_ms);
    elapsed_ms < JUMP_COOLDOWN_MS // Player is still within the jump duration
}

/// NEW: Efficient tile lookup using compressed chunk data
/// This is much faster than individual WorldTile lookups for water detection
pub fn is_player_on_water_compressed(ctx: &ReducerContext, player_x: f32, player_y: f32) -> bool {
    // Convert player position to tile coordinates
    let (tile_x, tile_y) = world_pos_to_tile_coords(player_x, player_y);
    
    // Calculate which chunk this tile belongs to
    let chunk_x = tile_x / environment::CHUNK_SIZE_TILES as i32;
    let chunk_y = tile_y / environment::CHUNK_SIZE_TILES as i32;
    
    // Look up the compressed chunk data
    let world_chunk_data = ctx.db.world_chunk_data();
    for chunk in world_chunk_data.idx_chunk_coords().filter((chunk_x, chunk_y)) {
        // Calculate local tile position within the chunk
        let local_tile_x = (tile_x % environment::CHUNK_SIZE_TILES as i32) as usize;
        let local_tile_y = (tile_y % environment::CHUNK_SIZE_TILES as i32) as usize;
        let tile_index = local_tile_y * environment::CHUNK_SIZE_TILES as usize + local_tile_x;
        
        // Check bounds and extract tile type
        if tile_index < chunk.tile_types.len() {
            if let Some(tile_type) = TileType::from_u8(chunk.tile_types[tile_index]) {
                return tile_type == TileType::Sea;
            }
        }
        break; // Found the chunk, no need to continue
    }
    
    // Fallback to original method if compressed data not available
    is_player_on_water(ctx, player_x, player_y)
}

/// NEW: Get tile type at specific world coordinates using compressed data
pub fn get_tile_type_at_position(ctx: &ReducerContext, world_x: i32, world_y: i32) -> Option<TileType> {
    // Calculate which chunk this tile belongs to
    let chunk_x = world_x / environment::CHUNK_SIZE_TILES as i32;
    let chunk_y = world_y / environment::CHUNK_SIZE_TILES as i32;
    
    // Look up the compressed chunk data
    let world_chunk_data = ctx.db.world_chunk_data();
    for chunk in world_chunk_data.idx_chunk_coords().filter((chunk_x, chunk_y)) {
        // Calculate local tile position within the chunk
        let local_tile_x = (world_x % environment::CHUNK_SIZE_TILES as i32) as usize;
        let local_tile_y = (world_y % environment::CHUNK_SIZE_TILES as i32) as usize;
        let tile_index = local_tile_y * environment::CHUNK_SIZE_TILES as usize + local_tile_x;
        
        // Check bounds and extract tile type
        if tile_index < chunk.tile_types.len() {
            return TileType::from_u8(chunk.tile_types[tile_index]);
        }
        break; // Found the chunk, no need to continue
    }
    
    None // No compressed data found for this position
}

// Player table to store position
#[spacetimedb::table(
    name = player,
    public,
    // Add spatial index
    index(name = idx_player_pos, btree(columns = [position_x, position_y]))
)]
#[derive(Clone)]
pub struct Player {
    #[primary_key]
    pub identity: Identity,
    pub username: String,
    pub position_x: f32,
    pub position_y: f32,
    pub direction: String,
    pub last_update: Timestamp, // Timestamp of the last update (movement or stats)
    pub last_stat_update: Timestamp, // Timestamp of the last stat processing tick
    pub jump_start_time_ms: u64,
    pub health: f32,
    pub stamina: f32,
    pub thirst: f32,
    pub hunger: f32,
    pub warmth: f32,
    pub is_sprinting: bool,
    pub is_dead: bool,
    pub death_timestamp: Option<Timestamp>,
    pub last_hit_time: Option<Timestamp>,
    pub is_online: bool, // <<< ADDED
    pub is_torch_lit: bool, // <<< ADDED: Tracks if the player's torch is currently lit
    pub last_consumed_at: Option<Timestamp>, // <<< ADDED: Tracks when a player last consumed an item
    pub is_crouching: bool, // RENAMED: For crouching speed control
    pub is_knocked_out: bool, // NEW: Tracks if the player is in knocked out state
    pub knocked_out_at: Option<Timestamp>, // NEW: When the player was knocked out
    pub is_on_water: bool, // NEW: Tracks if the player is currently standing on water
}

// Table to store the last attack timestamp for each player
#[spacetimedb::table(name = player_last_attack_timestamp)]
#[derive(Clone, Debug)]
pub struct PlayerLastAttackTimestamp {
    #[primary_key]
    player_id: Identity,
    last_attack_timestamp: Timestamp,
}

// --- NEW: Define ActiveConnection Table --- 
#[spacetimedb::table(name = active_connection, public)]
#[derive(Clone, Debug)]
pub struct ActiveConnection {
    #[primary_key]
    identity: Identity,
    // Store the ID of the current WebSocket connection for this identity
    connection_id: ConnectionId,
    timestamp: Timestamp, // Add timestamp field
}

// --- NEW: Define ClientViewport Table ---
#[spacetimedb::table(name = client_viewport)]
#[derive(Clone, Debug)]
pub struct ClientViewport {
    #[primary_key]
    client_identity: Identity,
    min_x: f32,
    min_y: f32,
    max_x: f32,
    max_y: f32,
    last_update: Timestamp,
}

// --- Lifecycle Reducers ---

// Called once when the module is published or updated
#[spacetimedb::reducer(init)]
pub fn init_module(ctx: &ReducerContext) -> Result<(), String> {
    log::info!("Initializing module...");

    // Initialize the dropped item despawn schedule
    crate::dropped_item::init_dropped_item_schedule(ctx)?;
    // Initialize the crafting finish check schedule
    crate::crafting_queue::init_crafting_schedule(ctx)?;
    // ADD: Initialize the player stat update schedule
    crate::player_stats::init_player_stat_schedule(ctx)?;
    // ADD: Initialize the global tick schedule
    crate::global_tick::init_global_tick_schedule(ctx)?;
    // <<< UPDATED: Initialize StatThresholdsConfig table >>>
    crate::player_stats::init_stat_thresholds_config(ctx)?;
    // ADD: Initialize active effects processing schedule
    crate::active_effects::schedule_effect_processing(ctx)?;
    crate::projectile::init_projectile_system(ctx)?;
    // ADD: Initialize plant growth system
    crate::planted_seeds::init_plant_growth_system(ctx)?;
    
    // ADD: Initialize water patch cleanup system
    crate::water_patch::init_water_patch_system(ctx)?;
    
    // ADD: Initialize sound event cleanup system
    crate::sound_events::init_sound_cleanup_system(ctx)?;
    
    // ADD: Initialize wild animal AI system
    crate::wild_animal_npc::init_wild_animal_ai_schedule(ctx)?;
    
    // ADD: Initialize viper spittle projectile system
    crate::wild_animal_npc::viper::init_viper_spittle_system(ctx)?;
    
    // ADD: Initialize barrel respawn system
    crate::barrel::init_barrel_system(ctx)?;
    
    // ADD: Initialize WorldState for scheduled systems
    crate::world_state::seed_world_state(ctx)?;

    // ADD: Generate world automatically on first startup
    let existing_tiles_count = ctx.db.world_tile().iter().count();
    if existing_tiles_count == 0 {
        log::info!("No world tiles found, generating initial world...");
        // Generate world with smaller size for better performance
        let world_config = crate::WorldGenConfig {
            seed: ctx.rng().gen::<u64>(), // Random seed each time using ctx.rng()
            world_width_tiles: 500,  // Reduced from 250 for performance
            world_height_tiles: 500, // Reduced from 250 for performance  
            chunk_size: 10,
            island_border_width: 5,  // Adjusted for smaller world
            beach_width: 3,          // Adjusted for smaller world
            river_frequency: 0.3,
            dirt_patch_frequency: 0.2,
            road_density: 0.1,
        };
        
        match crate::world_generation::generate_world(ctx, world_config) {
            Ok(_) => {
                log::info!("Initial world generation completed successfully");
                
                // NEW: Generate compressed chunk data for efficient network transmission
                log::info!("Generating compressed chunk data for efficient network transmission...");
                match crate::world_generation::generate_compressed_chunk_data(ctx) {
                    Ok(_) => log::info!("Compressed chunk data generated successfully"),
                    Err(e) => log::error!("Failed to generate compressed chunk data: {}", e),
                }
                
                // Generate minimap cache after world generation
                log::info!("Generating minimap cache...");
                match crate::world_generation::generate_minimap_data(ctx, 300, 300) {
                    Ok(_) => log::info!("Minimap cache generated successfully"),
                    Err(e) => log::error!("Failed to generate minimap cache: {}", e),
                }
            },
            Err(e) => log::error!("Failed to generate initial world: {}", e),
        }
    } else {
        log::info!("World tiles already exist ({}), skipping world generation", existing_tiles_count);
        
        // Check if minimap cache exists, generate if missing
        let existing_minimap_count = ctx.db.minimap_cache().iter().count();
        if existing_minimap_count == 0 {
            log::info!("No minimap cache found, generating...");
            match crate::world_generation::generate_minimap_data(ctx, 300, 300) {
                Ok(_) => log::info!("Minimap cache generated successfully"),
                Err(e) => log::error!("Failed to generate minimap cache: {}", e),
            }
        } else {
            log::info!("Minimap cache already exists ({}), skipping generation", existing_minimap_count);
        }
        
        // NEW: Check if compressed chunk data exists, generate if missing
        let existing_chunk_data_count = ctx.db.world_chunk_data().iter().count();
        if existing_chunk_data_count == 0 {
            log::info!("No compressed chunk data found, generating...");
            match crate::world_generation::generate_compressed_chunk_data(ctx) {
                Ok(_) => log::info!("Compressed chunk data generated successfully"),
                Err(e) => log::error!("Failed to generate compressed chunk data: {}", e),
            }
        } else {
            log::info!("Compressed chunk data already exists ({}), skipping generation", existing_chunk_data_count);
        }
    }

    log::info!("Module initialization complete.");
    Ok(())
}

/// Reducer that handles client connection events.
/// 
/// This reducer is called automatically when a new client connects to the server.
/// It initializes the game world if needed, tracks the client's connection,
/// and updates the player's online status. The world seeding functions are
/// idempotent, so they can be safely called on every connection.
#[spacetimedb::reducer(client_connected)]
pub fn identity_connected(ctx: &ReducerContext) -> Result<(), String> {
    // Call seeders using qualified paths
    crate::environment::seed_environment(ctx)?; // Call the updated seeder
    crate::items::seed_items(ctx)?; // Call the item seeder
    crate::items::seed_food_poisoning_risks(ctx)?; // Seed food poisoning risks
    crate::world_state::seed_world_state(ctx)?; // Call the world state seeder
    crate::crafting::seed_recipes(ctx)?; // Seed the crafting recipes
    crate::items::seed_ranged_weapon_stats(ctx)?; // Seed the ranged weapon stats
    crate::projectile::init_projectile_system(ctx)?; // Initialize projectile collision detection system
    
    // No seeder needed for Campfire yet, table will be empty initially

    // --- Track Active Connection ---
    let client_identity = ctx.sender;
    let connection_id = ctx.connection_id.ok_or_else(|| {
        log::error!("[Connect] Missing ConnectionId in client_connected context for {:?}", client_identity);
        "Internal error: Missing connection ID on connect".to_string()
    })?;

    log::info!("[Connect] Tracking active connection for identity {:?} with connection ID {:?}", 
        client_identity, connection_id);

    let active_connections = ctx.db.active_connection();
    let new_active_conn = ActiveConnection {
        identity: client_identity,
        connection_id,
        timestamp: ctx.timestamp, // Add timestamp
    };

    // Insert or update the active connection record
    if active_connections.identity().find(&client_identity).is_some() {
        active_connections.identity().update(new_active_conn);
        log::info!("[Connect] Updated existing active connection record for {:?}.", client_identity);
    } else {
        match active_connections.try_insert(new_active_conn) {
            Ok(_) => {
                log::info!("[Connect] Inserted new active connection record for {:?}.", client_identity);
            }
            Err(e) => {
                log::error!("[Connect] Failed to insert active connection for {:?}: {}", client_identity, e);
                return Err(format!("Failed to track connection: {}", e));
            }
        }
    }
    // --- End Track Active Connection ---

    // --- Set Player Online Status ---
    let mut players = ctx.db.player();
    if let Some(mut player) = players.identity().find(&client_identity) {
        if !player.is_online {
            player.is_online = true;
            players.identity().update(player);
            log::info!("[Connect] Set player {:?} to online.", client_identity);
        }
    } else {
        // Player might not be registered yet, which is fine. is_online will be set during registration.
        log::debug!("[Connect] Player {:?} not found in Player table yet (likely needs registration).", client_identity);
    }
    // --- End Set Player Online Status ---

    // Note: Initial scheduling for player stats happens in register_player
    // Note: Initial scheduling for global ticks happens in init_module
    Ok(())
}

/// Reducer that handles client disconnection events.
/// 
/// This reducer is called automatically when a client disconnects from the server.
/// It performs necessary cleanup including:
/// - Removing the active connection record if it matches the disconnecting connection
/// - Setting the player's online status to false
/// - Preserving state if the player has already reconnected
#[spacetimedb::reducer(client_disconnected)]
pub fn identity_disconnected(ctx: &ReducerContext) {
    let sender_id = ctx.sender;
    let disconnecting_connection_id = match ctx.connection_id {
        Some(id) => id,
        None => {
            return;
        }
    };

    let active_connections = ctx.db.active_connection();
    let players = ctx.db.player(); // <<< Need players table handle

    // --- Check 1: Does the active connection record match the disconnecting one? ---
    if let Some(initial_active_conn) = active_connections.identity().find(&sender_id) {
        if initial_active_conn.connection_id == disconnecting_connection_id {

            // --- Clean Up Connection --- 
            active_connections.identity().delete(&sender_id);
            // --- END Clean Up Connection --- 

            // --- Set Player Offline Status --- 
            if let Some(mut player) = players.identity().find(&sender_id) {
                 if player.is_online { // Only update if they were marked online
                    player.is_online = false;
                    players.identity().update(player);
                    log::info!("[Disconnect] Set player {:?} to offline.", sender_id);
                 }
            } else {
                 log::warn!("[Disconnect] Player {:?} not found in Player table during disconnect cleanup.", sender_id);
            }
            // --- END Set Player Offline Status --- 

        } else {
            // The connection ID doesn't match the current active one. 
            // This means the player reconnected quickly before the old disconnect processed fully.
            // In this case, DO NOTHING. The new connection is already active, 
            // and we don't want to mark them offline or mess with their new state.
                        }
                    } else {
        // No active connection found for this identity, maybe they disconnected before fully registering?
        // Or maybe the disconnect arrived *very* late after a new connection replaced the record.
    }
}

/// Reducer that handles player registration and reconnection.
/// 
/// This reducer is called when a player first joins the game or reconnects after disconnecting.
/// For new players, it creates their initial game state and grants starting items.
/// For existing players, it updates their connection status and timestamps.
#[spacetimedb::reducer]
pub fn register_player(ctx: &ReducerContext, username: String) -> Result<(), String> {
    let sender_id = ctx.sender;
    let players = ctx.db.player();
    log::info!("Attempting registration/login for identity: {:?}, username: {}", sender_id, username);

    // --- Check if player already exists for this authenticated identity ---
    if let Some(mut existing_player) = players.identity().find(&sender_id) { 
        log::info!("[RegisterPlayer] Found existing player {} ({:?}).",
                 existing_player.username, sender_id);
        
        // --- MODIFIED: Only update timestamp on reconnect ---
        let update_timestamp = ctx.timestamp; // Capture timestamp for consistency
        existing_player.last_update = update_timestamp; // Always update player timestamp

        players.identity().update(existing_player.clone()); // Perform the player update

        // --- ALSO Update ActiveConnection record --- 
        let connection_id = ctx.connection_id.ok_or_else(|| {
            log::error!("[RegisterPlayer] Missing ConnectionId in context for existing player {:?}", sender_id);
            "Internal error: Missing connection ID on reconnect".to_string()
        })?;
        
        let active_connections = ctx.db.active_connection();
        let updated_active_conn = ActiveConnection {
            identity: sender_id,
            connection_id,
            timestamp: update_timestamp, // Use the SAME timestamp as player update
        };

        if active_connections.identity().find(&sender_id).is_some() {
            active_connections.identity().update(updated_active_conn);
            log::info!("[RegisterPlayer] Updated active connection record for {:?} with timestamp {:?}.", sender_id, update_timestamp);
        } else {
            match active_connections.try_insert(updated_active_conn) {
                Ok(_) => {
                    log::info!("[RegisterPlayer] Inserted missing active connection record for {:?} with timestamp {:?}.", sender_id, update_timestamp);
                }
                Err(e) => {
                    log::error!("[RegisterPlayer] Failed to insert missing active connection for {:?}: {}", sender_id, e);
                }
            }
        }

        return Ok(());
    }

    // --- Player does not exist, proceed with registration ---
    log::info!("New player registration for identity: {:?}. Finding spawn...", sender_id);

    // Check if desired username is taken by *another* player
    // Note: We check this *after* checking if the current identity is already registered
    let username_taken_by_other = players.iter().any(|p| p.username == username && p.identity != sender_id);
    if username_taken_by_other {
        log::warn!("Username '{}' already taken by another player. Registration failed for {:?}.", username, sender_id);
        return Err(format!("Username '{}' is already taken.", username));
    }

    // Get tables needed for spawn check only if registering new player
    let trees = ctx.db.tree();
    let stones = ctx.db.stone();
    let campfires = ctx.db.campfire();
    let wooden_storage_boxes = ctx.db.wooden_storage_box();

    // --- Find a valid spawn position - NEW: MANDATORY Random coastal beach spawn ---
    
    // Step 1: Find all beach tiles that are coastal (adjacent to sea/water)
    let world_tiles = ctx.db.world_tile();
    let mut coastal_beach_tiles = Vec::new();
    
    log::info!("Searching for coastal beach tiles. Map size: {}x{}", WORLD_WIDTH_TILES, WORLD_HEIGHT_TILES);
    
    // Create a map of all tiles for efficient lookup
    let mut tile_map = std::collections::HashMap::new();
    for tile in world_tiles.iter() {
        tile_map.insert((tile.world_x, tile.world_y), tile.clone());
    }
    
    // Find beach tiles that are adjacent to sea/water tiles
    let mut total_beach_tiles = 0;
    let mut coastal_beach_count = 0;
    let map_height_half = (WORLD_HEIGHT_TILES / 2) as i32;
    
    for tile in world_tiles.iter() {
        if tile.tile_type == TileType::Beach {
            total_beach_tiles += 1;
            
            // CONSTRAINT: Only consider tiles in the SOUTH HALF of the map for initial spawn
            // CORRECTED: Keep south half (larger Y values), skip north half (smaller Y values)
            if tile.world_y < map_height_half {
                continue; // Skip tiles in north half (smaller Y values)
            }
            
            // Check if this beach tile is adjacent to sea/water
            let mut is_coastal = false;
            
            // Check all 8 adjacent tiles (including diagonals)
            for dx in -1..=1i32 {
                for dy in -1..=1i32 {
                    if dx == 0 && dy == 0 { continue; } // Skip the tile itself
                    
                    let adjacent_x = tile.world_x + dx;
                    let adjacent_y = tile.world_y + dy;
                    
                    // Check if adjacent tile exists and is sea
                    if let Some(adjacent_tile) = tile_map.get(&(adjacent_x, adjacent_y)) {
                        if adjacent_tile.tile_type == TileType::Sea {
                            is_coastal = true;
                            break;
                        }
                    } else {
                        // If adjacent tile is outside map bounds, consider it coastal
                        // (this handles cases where beach is at true map edge)
                        is_coastal = true;
                        break;
                    }
                }
                if is_coastal { break; }
            }
            
            if is_coastal {
                coastal_beach_tiles.push(tile.clone());
                coastal_beach_count += 1;
                if coastal_beach_count <= 10 { // Log first 10 for debugging
                    log::debug!("Found coastal beach tile at ({}, {}) - world coords ({}, {})", 
                               tile.world_x, tile.world_y, tile.world_x * TILE_SIZE_PX as i32, tile.world_y * TILE_SIZE_PX as i32);
                }
            }
        }
    }
    
    log::info!("Coastal beach search complete: {} total beach tiles, {} coastal beach tiles found", 
               total_beach_tiles, coastal_beach_tiles.len());
    
    // MANDATORY: Must have coastal beach tiles
    if coastal_beach_tiles.is_empty() {
        return Err(format!("CRITICAL ERROR: No coastal beach tiles found! Cannot spawn player. Total beach tiles: {}", total_beach_tiles));
    }
    
    // Step 2: Find a valid spawn point from coastal beach tiles (with relaxed collision detection)
    let mut spawn_x: f32;
    let mut spawn_y: f32;
    let max_spawn_attempts = 50; // Increased attempts significantly
    let mut spawn_attempt = 0;
    let mut last_collision_reason = String::new();
    
    // Try to find a valid spawn on a random coastal beach tile
    loop {
        // Pick a random coastal beach tile
        let random_index = ctx.rng().gen_range(0..coastal_beach_tiles.len());
        let selected_tile = &coastal_beach_tiles[random_index];
        
        // Convert tile coordinates to world pixel coordinates (center of tile)
        spawn_x = (selected_tile.world_x as f32 * TILE_SIZE_PX as f32) + (TILE_SIZE_PX as f32 / 2.0);
        spawn_y = (selected_tile.world_y as f32 * TILE_SIZE_PX as f32) + (TILE_SIZE_PX as f32 / 2.0);
        
        log::debug!("Attempt {}: Testing spawn at coastal beach tile ({}, {}) -> world pos ({:.1}, {:.1})", 
                   spawn_attempt + 1, selected_tile.world_x, selected_tile.world_y, spawn_x, spawn_y);
        
        // Step 3: Check for collisions at this beach tile position (RELAXED collision detection)
        let mut collision = false;
        last_collision_reason.clear();
        
        // Check collision with other players (more lenient spacing)
        for other_player in players.iter() {
            if other_player.is_dead { continue; }
            let dx = spawn_x - other_player.position_x;
            let dy = spawn_y - other_player.position_y;
            let distance_sq = dx * dx + dy * dy;
            let min_distance_sq = PLAYER_RADIUS * PLAYER_RADIUS * 2.0; // Reduced spacing requirement
            if distance_sq < min_distance_sq {
                collision = true;
                last_collision_reason = format!("Player collision (distance: {:.1})", distance_sq.sqrt());
                break;
            }
        }
        
        // Check collision with trees (more lenient)
        if !collision {
            for tree in trees.iter() {
                if tree.health == 0 { continue; }
                let dx = spawn_x - tree.pos_x;
                let dy = spawn_y - (tree.pos_y - crate::tree::TREE_COLLISION_Y_OFFSET);
                let distance_sq = dx * dx + dy * dy;
                if distance_sq < (crate::tree::PLAYER_TREE_COLLISION_DISTANCE_SQUARED * 0.8) { // 20% more lenient
                    collision = true;
                    last_collision_reason = format!("Tree collision at ({:.1}, {:.1})", tree.pos_x, tree.pos_y);
                    break;
                }
            }
        }
        
        // Check collision with stones (more lenient)
        if !collision {
            for stone in stones.iter() {
                if stone.health == 0 { continue; }
                let dx = spawn_x - stone.pos_x;
                let dy = spawn_y - (stone.pos_y - crate::stone::STONE_COLLISION_Y_OFFSET);
                let distance_sq = dx * dx + dy * dy;
                if distance_sq < (crate::stone::PLAYER_STONE_COLLISION_DISTANCE_SQUARED * 0.8) { // 20% more lenient
                    collision = true;
                    last_collision_reason = format!("Stone collision at ({:.1}, {:.1})", stone.pos_x, stone.pos_y);
                    break;
                }
            }
        }
        
        // Check collision with campfires (more lenient)
        if !collision {
            for campfire in campfires.iter() {
                let dx = spawn_x - campfire.pos_x;
                let dy = spawn_y - (campfire.pos_y - CAMPFIRE_COLLISION_Y_OFFSET);
                let distance_sq = dx * dx + dy * dy;
                if distance_sq < (PLAYER_CAMPFIRE_COLLISION_DISTANCE_SQUARED * 0.8) { // 20% more lenient
                    collision = true;
                    last_collision_reason = format!("Campfire collision at ({:.1}, {:.1})", campfire.pos_x, campfire.pos_y);
                    break;
                }
            }
        }
        
        // Check collision with wooden storage boxes (more lenient)
        if !collision {
            for box_instance in wooden_storage_boxes.iter() {
                let dx = spawn_x - box_instance.pos_x;
                let dy = spawn_y - (box_instance.pos_y - crate::wooden_storage_box::BOX_COLLISION_Y_OFFSET);
                let distance_sq = dx * dx + dy * dy;
                if distance_sq < (crate::wooden_storage_box::PLAYER_BOX_COLLISION_DISTANCE_SQUARED * 0.8) { // 20% more lenient
                    collision = true;
                    last_collision_reason = format!("Storage box collision at ({:.1}, {:.1})", box_instance.pos_x, box_instance.pos_y);
                    break;
                }
            }
        }
        
        // If no collision found, we have a valid spawn point!
        if !collision {
            log::info!("SUCCESS: Coastal beach spawn found at ({:.1}, {:.1}) on tile ({}, {}) after {} attempts", 
                      spawn_x, spawn_y, selected_tile.world_x, selected_tile.world_y, spawn_attempt + 1);
            break;
        }
        
        // Log collision reason for debugging
        if spawn_attempt < 10 { // Only log first 10 attempts to avoid spam
            log::debug!("Attempt {} failed: {} at coastal beach tile ({}, {})", 
                       spawn_attempt + 1, last_collision_reason, selected_tile.world_x, selected_tile.world_y);
        }
        
        spawn_attempt += 1;
        if spawn_attempt >= max_spawn_attempts {
            // FORCE spawn on the last attempted beach tile - NO FALLBACK TO ORIGINAL LOCATION
            log::warn!("Could not find collision-free coastal beach spawn after {} attempts. FORCING spawn at last coastal beach tile ({:.1}, {:.1}) - {}", 
                      max_spawn_attempts, spawn_x, spawn_y, last_collision_reason);
            break;
        }
    }
    
    // Final validation - ensure we're spawning on a beach tile
    let final_tile_x = (spawn_x / TILE_SIZE_PX as f32).floor() as i32;
    let final_tile_y = (spawn_y / TILE_SIZE_PX as f32).floor() as i32;
    log::info!("FINAL SPAWN: Player {} will spawn at world coords ({:.1}, {:.1}) which is tile ({}, {})", 
               username, spawn_x, spawn_y, final_tile_x, final_tile_y);
    
    // --- End spawn position logic ---

    // --- Create and Insert New Player ---
    let player = Player {
        identity: sender_id, // Use the authenticated identity
        username: username.clone(),
        position_x: spawn_x, // Use calculated spawn position
        position_y: spawn_y, // Use calculated spawn position
        direction: "down".to_string(),
        last_update: ctx.timestamp,
        last_stat_update: ctx.timestamp,
        jump_start_time_ms: 0,
        health: 100.0,
        stamina: 100.0,
        thirst: PLAYER_STARTING_THIRST,
        hunger: PLAYER_STARTING_HUNGER,
        warmth: 100.0,
        is_sprinting: false,
        is_dead: false,
        death_timestamp: None,
        last_hit_time: None,
        is_online: true, // <<< Keep this for BRAND NEW players
        is_torch_lit: false, // Initialize to false
        last_consumed_at: None, // Initialize last_consumed_at
        is_crouching: false, // Initialize is_crouching
        is_knocked_out: false, // NEW: Initialize knocked out state
        knocked_out_at: None, // NEW: Initialize knocked out time
        is_on_water: false, // NEW: Initialize is_on_water
    };

    // Insert the new player
    match players.try_insert(player) {
        Ok(inserted_player) => {
            log::info!("Player registered: {}. Granting starting items...", username);

            // --- ADD ActiveConnection record for NEW player ---
             let connection_id = ctx.connection_id.ok_or_else(|| {
                 log::error!("[RegisterPlayer] Missing ConnectionId in context for NEW player {:?}", sender_id);
                 "Internal error: Missing connection ID on initial registration".to_string()
             })?;
             let active_connections = ctx.db.active_connection();
             let new_active_conn = ActiveConnection {
                 identity: sender_id,
                 connection_id,
                 timestamp: ctx.timestamp,
             };
             match active_connections.try_insert(new_active_conn) {
                 Ok(_) => {
                     log::info!("[RegisterPlayer] Inserted active connection record for new player {:?}.", sender_id);
                 }
                 Err(e) => {
                     // Log error but don't fail registration
                     log::error!("[RegisterPlayer] Failed to insert active connection for new player {:?}: {}", sender_id, e);
                 }
             }
            // --- END ADD ActiveConnection ---

            // --- Grant Starting Items (Keep existing logic) ---
            match crate::starting_items::grant_starting_items(ctx, sender_id, &username) {
                Ok(_) => { /* Logged inside function */ },
                Err(e) => {
                    log::error!("Unexpected error during grant_starting_items for player {}: {}", username, e);
                }
            }
            // --- End Grant Starting Items ---
            Ok(())
        },
        Err(e) => {
            log::error!("Failed to insert new player {} ({:?}): {}", username, sender_id, e);
            Err(format!("Failed to register player: Database error."))
        }
    }
}

/// Reducer that handles client viewport updates.
/// 
/// This reducer is called by the client to update their visible game area boundaries.
/// It stores the viewport coordinates for each client, which can be used for
/// optimizing game state updates and rendering.
#[spacetimedb::reducer]
pub fn update_viewport(ctx: &ReducerContext, min_x: f32, min_y: f32, max_x: f32, max_y: f32) -> Result<(), String> {
    let client_id = ctx.sender;
    let viewports = ctx.db.client_viewport();
    log::trace!("Reducer update_viewport called by {:?} with bounds: ({}, {}), ({}, {})",
             client_id, min_x, min_y, max_x, max_y);

    let viewport_data = ClientViewport {
        client_identity: client_id,
        min_x,
        min_y,
        max_x,
        max_y,
        last_update: ctx.timestamp,
    };

    // Use insert_or_update logic
    if viewports.client_identity().find(&client_id).is_some() {
        viewports.client_identity().update(viewport_data);
        log::trace!("Updated viewport for client {:?}", client_id);
    } else {
        match viewports.try_insert(viewport_data) {
            Ok(_) => {
                log::trace!("Inserted new viewport for client {:?}", client_id);
            },
            Err(e) => {
                 log::error!("Failed to insert viewport for client {:?}: {}", client_id, e);
                 return Err(format!("Failed to insert viewport: {}", e));
            }
        }
    }
    Ok(())
}

// ADD: Tile types and world generation structures
#[derive(spacetimedb::SpacetimeType, Clone, Debug, PartialEq)]
pub enum TileType {
    Grass,
    Dirt, 
    DirtRoad,
    Sea,
    Beach,
    Sand,
}

#[derive(spacetimedb::SpacetimeType, Clone, Debug)]
pub struct WorldGenConfig {
    pub seed: u64,
    pub world_width_tiles: u32,   // 250
    pub world_height_tiles: u32,  // 250
    pub chunk_size: u32,          // 8
    pub island_border_width: u32, // Sea border thickness
    pub beach_width: u32,         // Beach border thickness
    pub river_frequency: f32,     // 0.0-1.0
    pub dirt_patch_frequency: f32,
    pub road_density: f32,
}

// ADD: Compressed chunk data table for efficient tile transmission
#[spacetimedb::table(
    name = world_chunk_data, 
    public,
    index(name = idx_chunk_coords, btree(columns = [chunk_x, chunk_y]))
)]
#[derive(Clone, Debug)]
pub struct WorldChunkData {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub chunk_x: i32,
    pub chunk_y: i32,
    pub chunk_size: u32, // How many tiles per side (usually 10x10 = 100 tiles)
    pub tile_types: Vec<u8>, // Compressed tile types (100 bytes instead of 100 objects)
    pub variants: Vec<u8>,   // Compressed variants (100 bytes)
    pub generated_at: Timestamp,
}

#[spacetimedb::table(
    name = world_tile, 
    public,
    index(name = idx_chunk_position, btree(columns = [chunk_x, chunk_y])),
    index(name = idx_world_position, btree(columns = [world_x, world_y]))
)]
#[derive(Clone, Debug)]
pub struct WorldTile {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub chunk_x: i32,
    pub chunk_y: i32,
    pub tile_x: i32,  // Local tile position within chunk
    pub tile_y: i32,  // Local tile position within chunk
    pub world_x: i32, // Global world position for easier queries
    pub world_y: i32, // Global world position for easier queries
    pub tile_type: TileType,
    pub variant: u8,  // For tile variations (0-255)
    pub biome_data: Option<String>, // JSON for future biome properties
}

#[spacetimedb::table(name = minimap_cache, public)]
#[derive(Clone, Debug)]
pub struct MinimapCache {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub width: u32,
    pub height: u32,
    pub data: Vec<u8>, // Compressed minimap data as color values
    pub generated_at: Timestamp,
}

// ADD: Utility functions for tile compression
impl TileType {
    /// Convert TileType to u8 for compression
    pub fn to_u8(&self) -> u8 {
        match self {
            TileType::Grass => 0,
            TileType::Dirt => 1,
            TileType::DirtRoad => 2,
            TileType::Sea => 3,
            TileType::Beach => 4,
            TileType::Sand => 5,
        }
    }
    
    /// Convert u8 back to TileType for decompression
    pub fn from_u8(value: u8) -> Option<TileType> {
        match value {
            0 => Some(TileType::Grass),
            1 => Some(TileType::Dirt),
            2 => Some(TileType::DirtRoad),
            3 => Some(TileType::Sea),
            4 => Some(TileType::Beach),
            5 => Some(TileType::Sand),
            _ => None,
        }
    }
}

/// NEW: Manual reducer to generate compressed chunk data for testing/debugging
/// This can be called by clients to force regeneration of compressed chunk data
#[spacetimedb::reducer]
pub fn regenerate_compressed_chunks(ctx: &ReducerContext) -> Result<(), String> {
    log::info!("Manual regeneration of compressed chunk data requested by {:?}", ctx.sender);
    
    // Clear existing compressed chunk data
    let world_chunk_data = ctx.db.world_chunk_data();
    let chunks_to_delete: Vec<_> = world_chunk_data.iter().collect();
    for chunk in chunks_to_delete {
        world_chunk_data.id().delete(chunk.id);
    }
    
    // Regenerate compressed chunk data
    match crate::world_generation::generate_compressed_chunk_data(ctx) {
        Ok(_) => {
            let new_chunk_count = world_chunk_data.iter().count();
            log::info!("Successfully regenerated {} compressed chunks", new_chunk_count);
            Ok(())
        }
        Err(e) => {
            log::error!("Failed to regenerate compressed chunk data: {}", e);
            Err(format!("Failed to regenerate compressed chunks: {}", e))
        }
    }
}