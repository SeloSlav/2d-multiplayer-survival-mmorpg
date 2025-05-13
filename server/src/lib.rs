use spacetimedb::{Identity, Timestamp, ReducerContext, Table, ConnectionId};
use log;
use std::time::Duration;
use rand::Rng; // Add rand for random respawn location
use crate::environment::calculate_chunk_index; // Make sure this helper is available
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
// Declare the active_equipment module
mod active_equipment;
// Declare the player_inventory module
mod player_inventory;
// Declare the mushroom module
mod mushroom;
// Declare the consumables module
mod consumables;
mod utils; // Declare utils module
mod dropped_item; // Declare dropped_item module
mod wooden_storage_box; // Add the new module
mod items_database; // <<< ADDED module declaration
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
mod collectible_resources; // Add the new collectible resources system
mod corn; // Add the new corn resource module
mod sleeping_bag; // ADD Sleeping Bag module
mod player_corpse; // <<< ADDED: Declare Player Corpse module
mod models; // <<< ADDED

// Re-export chat types and reducers for use in other modules
pub use chat::Message;

// Import Table Traits needed in this module
use crate::tree::tree as TreeTableTrait;
use crate::stone::stone as StoneTableTrait;
use crate::campfire::campfire as CampfireTableTrait;
use crate::corn::corn as CornTableTrait;
use crate::world_state::world_state as WorldStateTableTrait;
use crate::items::inventory_item as InventoryItemTableTrait;
use crate::items::item_definition as ItemDefinitionTableTrait;
use crate::active_equipment::active_equipment as ActiveEquipmentTableTrait;
use crate::dropped_item::dropped_item_despawn_schedule as DroppedItemDespawnScheduleTableTrait;
use crate::wooden_storage_box::wooden_storage_box as WoodenStorageBoxTableTrait;
use crate::chat::message as MessageTableTrait; // Import the trait for Message table
use crate::sleeping_bag::sleeping_bag as SleepingBagTableTrait; // ADD Sleeping Bag trait import

// Use struct names directly for trait aliases
use crate::crafting::Recipe as RecipeTableTrait;
use crate::crafting_queue::CraftingQueueItem as CraftingQueueItemTableTrait;
use crate::crafting_queue::CraftingFinishSchedule as CraftingFinishScheduleTableTrait;
use crate::global_tick::GlobalTickSchedule as GlobalTickScheduleTableTrait;

// Import constants needed from player_stats
use crate::player_stats::{
    SPRINT_SPEED_MULTIPLIER,
    JUMP_COOLDOWN_MS,
    LOW_NEED_THRESHOLD,
    LOW_THIRST_SPEED_PENALTY,
    LOW_WARMTH_SPEED_PENALTY
};

// Use specific items needed globally (or use qualified paths)
use crate::world_state::TimeOfDay; // Keep TimeOfDay if needed elsewhere, otherwise remove
use crate::campfire::{Campfire, WARMTH_RADIUS_SQUARED, WARMTH_PER_SECOND, CAMPFIRE_COLLISION_RADIUS, CAMPFIRE_CAMPFIRE_COLLISION_DISTANCE_SQUARED, CAMPFIRE_COLLISION_Y_OFFSET, PLAYER_CAMPFIRE_COLLISION_DISTANCE_SQUARED, PLAYER_CAMPFIRE_INTERACTION_DISTANCE_SQUARED };

// Initial Amounts
pub const INITIAL_CAMPFIRE_FUEL_AMOUNT: u32 = 50; // Example amount

// --- Global Constants ---
pub const TILE_SIZE_PX: u32 = 48;
pub const PLAYER_RADIUS: f32 = 32.0; // Player collision radius
pub const PLAYER_SPEED: f32 = 600.0; // Speed in pixels per second
pub const PLAYER_SPRINT_MULTIPLIER: f32 = 1.6;

// World Dimensions (example)
pub const WORLD_WIDTH_TILES: u32 = 500;
pub const WORLD_HEIGHT_TILES: u32 = 500;
// Change back to f32 as they are used in float calculations
pub const WORLD_WIDTH_PX: f32 = (WORLD_WIDTH_TILES * TILE_SIZE_PX) as f32;
pub const WORLD_HEIGHT_PX: f32 = (WORLD_HEIGHT_TILES * TILE_SIZE_PX) as f32;

// Campfire Placement Constants (Restored)
pub const CAMPFIRE_PLACEMENT_MAX_DISTANCE: f32 = 96.0;
pub const CAMPFIRE_PLACEMENT_MAX_DISTANCE_SQUARED: f32 = CAMPFIRE_PLACEMENT_MAX_DISTANCE * CAMPFIRE_PLACEMENT_MAX_DISTANCE;

// Respawn Collision Check Constants
pub const RESPAWN_CHECK_RADIUS: f32 = TILE_SIZE_PX as f32 * 0.8; // Check slightly less than a tile radius
pub const RESPAWN_CHECK_RADIUS_SQ: f32 = RESPAWN_CHECK_RADIUS * RESPAWN_CHECK_RADIUS;
pub const MAX_RESPAWN_OFFSET_ATTEMPTS: u32 = 8; // Max times to try offsetting
pub const RESPAWN_OFFSET_DISTANCE: f32 = TILE_SIZE_PX as f32 * 0.5; // How far to offset each attempt

// Player table to store position and color
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
    pub color: String,
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

    log::info!("Module initialization complete.");
    Ok(())
}

// When a client connects, we need to create a player for them
#[spacetimedb::reducer(client_connected)]
pub fn identity_connected(ctx: &ReducerContext) -> Result<(), String> {
    // Call seeders using qualified paths
    crate::environment::seed_environment(ctx)?; // Call the updated seeder
    crate::items::seed_items(ctx)?; // Call the item seeder
    crate::world_state::seed_world_state(ctx)?; // Call the world state seeder
    crate::crafting::seed_recipes(ctx)?; // Seed the crafting recipes
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

// When a client disconnects, we need to clean up
#[spacetimedb::reducer(client_disconnected)]
pub fn identity_disconnected(ctx: &ReducerContext) {
    let sender_id = ctx.sender;
    let disconnecting_connection_id = match ctx.connection_id {
        Some(id) => id,
        None => {
            // Log if possible, but return regardless
            // log::error!("[Disconnect] Missing ConnectionId for {:?}. Cannot clean up.", sender_id);
            return;
        }
    };

    // Log if possible
    // log::info!("[Disconnect] Handling disconnect for identity: {:?}, connection_id: {:?}", sender_id, disconnecting_connection_id);

    let active_connections = ctx.db.active_connection();
    let players = ctx.db.player(); // <<< Need players table handle

    // --- Check 1: Does the active connection record match the disconnecting one? ---
    if let Some(initial_active_conn) = active_connections.identity().find(&sender_id) {
        if initial_active_conn.connection_id == disconnecting_connection_id {
            // --- Clean Up Connection --- 
                    // Log if possible
            // log::info!("[Disconnect] Removing active connection record for identity: {:?}, connection_id: {:?}", 
            //               sender_id, disconnecting_connection_id);
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
                            // Log if possible
            // log::info!("[Disconnect] Stale disconnect for {:?}. New connection ({:?}) already active. Ignoring disconnect for ID {:?}.", 
            //              sender_id, initial_active_conn.connection_id, disconnecting_connection_id);
                        }
                    } else {
        // No active connection found for this identity, maybe they disconnected before fully registering?
        // Or maybe the disconnect arrived *very* late after a new connection replaced the record.
        // Log if possible
        // log::info!("[Disconnect] No active connection record found for identity {:?}. Possibly already cleaned up or never registered.", sender_id);
    }
}

// Register a new player (Now handles existing authenticated players)
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

    // --- Find a valid spawn position (Keep existing logic) ---
    let initial_x = 640.0;
    let initial_y = 480.0;
    let mut spawn_x = initial_x;
    let mut spawn_y = initial_y;
    let max_attempts = 10;
    let offset_step = PLAYER_RADIUS * 2.5;
    let mut attempt = 0;
    loop {
        let mut collision = false;
        // (Existing collision check logic...)
        for other_player in players.iter() {
             if other_player.is_dead { continue; }
             let dx = spawn_x - other_player.position_x;
             let dy = spawn_y - other_player.position_y;
             if (dx * dx + dy * dy) < PLAYER_RADIUS * PLAYER_RADIUS {
                 collision = true; break;
             }
         }
         if !collision {
             for tree in trees.iter() {
                 if tree.health == 0 { continue; }
                 let dx = spawn_x - tree.pos_x;
                 let dy = spawn_y - (tree.pos_y - crate::tree::TREE_COLLISION_Y_OFFSET);
                 if (dx * dx + dy * dy) < crate::tree::PLAYER_TREE_COLLISION_DISTANCE_SQUARED {
                     collision = true; break;
                 }
             }
         }
         if !collision {
             for stone in stones.iter() {
                 if stone.health == 0 { continue; }
                 let dx = spawn_x - stone.pos_x;
                 let dy = spawn_y - (stone.pos_y - crate::stone::STONE_COLLISION_Y_OFFSET);
                 if (dx * dx + dy * dy) < crate::stone::PLAYER_STONE_COLLISION_DISTANCE_SQUARED {
                     collision = true; break;
                 }
             }
         }
         if !collision {
             for box_instance in wooden_storage_boxes.iter() {
                 let dx = spawn_x - box_instance.pos_x;
                 let dy = spawn_y - (box_instance.pos_y - crate::wooden_storage_box::BOX_COLLISION_Y_OFFSET);
                 if (dx * dx + dy * dy) < crate::wooden_storage_box::PLAYER_BOX_COLLISION_DISTANCE_SQUARED {
                     collision = true; break;
                 }
             }
         }
         // Decide if position is valid or max attempts reached
         if !collision || attempt >= max_attempts {
             if attempt >= max_attempts && collision {
                  log::warn!("Could not find clear spawn point for {} ({:?}), spawning at default (may collide).", username, sender_id);
                  spawn_x = initial_x;
                  spawn_y = initial_y;
             }
             break;
         }
         match attempt % 4 {
             0 => spawn_x += offset_step,
             1 => spawn_y += offset_step,
             2 => spawn_x -= offset_step * 2.0,
             3 => spawn_y -= offset_step * 2.0,
             _ => {},
         }
         if attempt == 5 {
              spawn_x = initial_x;
              spawn_y = initial_y;
              spawn_x += offset_step * 1.5;
              spawn_y += offset_step * 1.5;
         }
         attempt += 1;
     }
    // --- End spawn position logic ---

    // --- Create and Insert New Player ---
    let color = random_color(&username);

    let player = Player {
        identity: sender_id, // Use the authenticated identity
        username: username.clone(),
        position_x: spawn_x, // Use calculated spawn position
        position_y: spawn_y, // Use calculated spawn position
        color,
        direction: "down".to_string(),
        last_update: ctx.timestamp,
        last_stat_update: ctx.timestamp,
        jump_start_time_ms: 0,
        health: 100.0,
        stamina: 100.0,
        thirst: 100.0,
        hunger: 100.0,
        warmth: 100.0,
        is_sprinting: false,
        is_dead: false,
        death_timestamp: None,
        last_hit_time: None,
        is_online: true, // <<< Keep this for BRAND NEW players
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

// Reducer to place a campfire
#[spacetimedb::reducer]
pub fn place_campfire(ctx: &ReducerContext, item_instance_id: u64, world_x: f32, world_y: f32) -> Result<(), String> {
    let sender_id = ctx.sender;
    let inventory_items = ctx.db.inventory_item();
    let item_defs = ctx.db.item_definition();
    let players = ctx.db.player();
    let campfires = ctx.db.campfire();

    // --- Look up Item Definition IDs by Name ---
    let campfire_def_id = item_defs.iter()
        .find(|def| def.name == "Camp Fire")
        .map(|def| def.id)
        .ok_or_else(|| "Item definition for 'Camp Fire' not found.".to_string())?;

    let wood_def_id = item_defs.iter()
        .find(|def| def.name == "Wood")
        .map(|def| def.id)
        .ok_or_else(|| "Item definition for 'Wood' not found.".to_string())?;
    // --- End Look up ---

    log::info!(
        "[PlaceCampfire] Player {:?} attempting placement of item {} at ({:.1}, {:.1})",
        sender_id, item_instance_id, world_x, world_y
    );

    // --- 1. Validate Player and Placement Rules ---
    let player = players.identity().find(sender_id)
        .ok_or_else(|| "Player not found".to_string())?;

    let dx_place = world_x - player.position_x;
    let dy_place = world_y - player.position_y;
    let dist_sq_place = dx_place * dx_place + dy_place * dy_place;
    if dist_sq_place > CAMPFIRE_PLACEMENT_MAX_DISTANCE_SQUARED {
        return Err(format!("Cannot place campfire too far away ({} > {}).",
                dist_sq_place.sqrt(), CAMPFIRE_PLACEMENT_MAX_DISTANCE));
    }
    for other_fire in campfires.iter() {
        let dx_fire = world_x - other_fire.pos_x;
        let dy_fire = world_y - other_fire.pos_y;
        let dist_sq_fire = dx_fire * dx_fire + dy_fire * dy_fire;
        if dist_sq_fire < CAMPFIRE_CAMPFIRE_COLLISION_DISTANCE_SQUARED {
            return Err("Cannot place campfire too close to another campfire.".to_string());
        }
    }

    // --- 3. Find the specific item instance and validate ---
    let item_to_consume = inventory_items.instance_id().find(item_instance_id)
        .ok_or_else(|| format!("Item instance {} not found.", item_instance_id))?;

    // Validate ownership and location based on ItemLocation
    match item_to_consume.location {
        ItemLocation::Inventory(data) => {
            if data.owner_id != sender_id {
                return Err(format!("Item instance {} for campfire not owned by player {:?}.", item_instance_id, sender_id));
            }
        }
        ItemLocation::Hotbar(data) => {
            if data.owner_id != sender_id {
                return Err(format!("Item instance {} for campfire not owned by player {:?}.", item_instance_id, sender_id));
            }
        }
        _ => {
            return Err(format!("Item instance {} must be in inventory or hotbar to be placed.", item_instance_id));
        }
    }
    if item_to_consume.item_def_id != campfire_def_id {
        return Err(format!("Item instance {} is not a Camp Fire (expected def {}, got {}).",
                        item_instance_id, campfire_def_id, item_to_consume.item_def_id));
    }

    // --- 4. Consume the Item (Delete from InventoryItem table) ---
    log::info!(
        "[PlaceCampfire] Consuming item instance {} (Def ID: {}) from player {:?}",
        item_instance_id, campfire_def_id, sender_id
    );
    inventory_items.instance_id().delete(item_instance_id);

    // --- 5. Create Campfire Entity & Initial Fuel ---
    // --- 5a. Insert Campfire Entity first to get its ID ---
    let current_time = ctx.timestamp;
    let chunk_idx = calculate_chunk_index(world_x, world_y);

    // --- 5b. Create Initial Fuel Item (Wood) with correct ItemLocation ---
    // We need the ItemDefinition of the wood to get its fuel_burn_duration_secs
    let initial_fuel_item_def = ctx.db.item_definition().id().find(wood_def_id)
        .ok_or_else(|| "Wood item definition not found for initial fuel.".to_string())?;

    // --- 5a. Insert Campfire Entity first to get its ID ---
    // The campfire entity is created with initial fuel data directly
    let new_campfire_data_without_fuel_ids = Campfire {
        id: 0, // Auto-incremented
        pos_x: world_x,
        pos_y: world_y,
        chunk_index: chunk_idx,
        placed_by: sender_id,
        placed_at: current_time,
        is_burning: true, // Start burning by default
        // Let the scheduled processor handle these initially
        current_fuel_def_id: None, 
        remaining_fuel_burn_time_secs: None, 
        fuel_instance_id_0: None, 
        fuel_def_id_0: None,      
        fuel_instance_id_1: None,
        fuel_def_id_1: None,
        fuel_instance_id_2: None,
        fuel_def_id_2: None,
        fuel_instance_id_3: None,
        fuel_def_id_3: None,
        fuel_instance_id_4: None,
        fuel_def_id_4: None,
    };
    let inserted_campfire = campfires.try_insert(new_campfire_data_without_fuel_ids)
        .map_err(|e| format!("Failed to insert campfire entity: {}", e))?;
    let new_campfire_id = inserted_campfire.id; 

    let initial_fuel_item = crate::items::InventoryItem {
        instance_id: 0, // Auto-inc
        item_def_id: wood_def_id, 
        quantity: INITIAL_CAMPFIRE_FUEL_AMOUNT, 
        location: ItemLocation::Container(models::ContainerLocationData {
            container_type: ContainerType::Campfire,
            container_id: new_campfire_id as u64, 
            slot_index: 0, 
        }),
    };
    let inserted_fuel_item = inventory_items.try_insert(initial_fuel_item)
        .map_err(|e| format!("Failed to insert initial fuel item: {}", e))?;
    let fuel_instance_id = inserted_fuel_item.instance_id;
    log::info!("[PlaceCampfire] Created initial fuel item (Wood, instance {}) for campfire {}.", fuel_instance_id, new_campfire_id);

    // --- 5c. Update the Campfire Entity with the Fuel Item's ID in the correct slot --- 
    let mut campfire_to_update = campfires.id().find(new_campfire_id)
        .ok_or_else(|| format!("Failed to re-find campfire {} to update with fuel.", new_campfire_id))?;
    
    // Set the first fuel slot of the campfire
    campfire_to_update.fuel_instance_id_0 = Some(fuel_instance_id);
    campfire_to_update.fuel_def_id_0 = Some(wood_def_id);
    // DO NOT set current_fuel_def_id or remaining_fuel_burn_time_secs here.
    // is_burning is already true from new_campfire_data_without_fuel_ids.
    // The scheduled process_campfire_logic_scheduled will pick it up.
    
    let is_burning_for_log = campfire_to_update.is_burning; // Capture before move
    campfires.id().update(campfire_to_update); // campfire_to_update is moved here
    
    log::info!("Player {} placed a campfire {} at ({:.1}, {:.1}) with initial fuel (Item {} in slot 0). Burning state: {}.",
             player.username, new_campfire_id, world_x, world_y, fuel_instance_id, is_burning_for_log); // Use captured value

    // Schedule initial processing for the new campfire
    match crate::campfire::schedule_next_campfire_processing(ctx, new_campfire_id) {
        Ok(_) => log::info!("[PlaceCampfire] Scheduled initial processing for campfire {}", new_campfire_id),
        Err(e) => log::error!("[PlaceCampfire] Failed to schedule initial processing for campfire {}: {}", new_campfire_id, e),
    }

    Ok(())
}

// Called by the client to set the sprinting state
#[spacetimedb::reducer]
pub fn set_sprinting(ctx: &ReducerContext, sprinting: bool) -> Result<(), String> {
    let sender_id = ctx.sender;
    let players = ctx.db.player();

    if let Some(mut player) = players.identity().find(&sender_id) {
        // Only update if the state is actually changing
        if player.is_sprinting != sprinting {
            player.is_sprinting = sprinting;
            player.last_update = ctx.timestamp; // Update timestamp when sprint state changes
            players.identity().update(player);
            log::debug!("Player {:?} set sprinting to {}", sender_id, sprinting);
        }
        Ok(())
    } else {
        Err("Player not found".to_string())
    }
}

// Update player movement, handle sprinting, and collision
#[spacetimedb::reducer]
pub fn update_player_position(
    ctx: &ReducerContext,
    // Renamed parameters to represent normalized direction vector from client
    move_x: f32,
    move_y: f32,
) -> Result<(), String> {
    let sender_id = ctx.sender;
    let players = ctx.db.player();
    let trees = ctx.db.tree();
    let stones = ctx.db.stone();
    let campfires = ctx.db.campfire(); // Get campfire table
    let wooden_storage_boxes = ctx.db.wooden_storage_box(); // <<< ADDED

    let current_player = players.identity()
        .find(sender_id)
        .ok_or_else(|| "Player not found".to_string())?;

    // --- If player is dead, prevent movement ---
    if current_player.is_dead {
        log::trace!("Ignoring movement input for dead player {:?}", sender_id);
        return Ok(()); // Do nothing if dead
    }

    // --- Determine Animation Direction from Input Vector ---
    let mut final_anim_direction = current_player.direction.clone();
    // Basic check: If there's significant movement
    if move_x.abs() > 0.01 || move_y.abs() > 0.01 {
        // Prioritize horizontal or vertical based on magnitude
        if move_x.abs() > move_y.abs() {
            final_anim_direction = if move_x > 0.0 { "right".to_string() } else { "left".to_string() };
        } else {
            final_anim_direction = if move_y > 0.0 { "down".to_string() } else { "up".to_string() };
        }
    }
    // If input is (0,0), keep the previous direction

    if final_anim_direction != current_player.direction {
        log::trace!("Player {:?} animation direction set to: {}", sender_id, final_anim_direction);
    }
    // --- End Animation Direction ---

    let now = ctx.timestamp;

    // --- Calculate Delta Time ---
    let elapsed_micros = now.to_micros_since_unix_epoch().saturating_sub(current_player.last_update.to_micros_since_unix_epoch());
    // Clamp max delta time to avoid huge jumps on first update or after lag spikes (e.g., 100ms)
    let delta_time_secs = (elapsed_micros as f32 / 1_000_000.0).min(0.1); // Clamp max delta time

    // --- Stamina Drain & Base Speed Calculation ---
    let mut new_stamina = current_player.stamina; // Base this on current_player for speed calc
    let mut base_speed_multiplier = 1.0;
    // Movement now depends only on having a direction input from the client
    let is_moving = move_x.abs() > 0.01 || move_y.abs() > 0.01;
    let mut current_sprinting_state = current_player.is_sprinting;

    // Determine speed multiplier based on current sprint state and stamina
    if current_sprinting_state && new_stamina > 0.0 { // Check current stamina > 0
        base_speed_multiplier = SPRINT_SPEED_MULTIPLIER;
    } else if current_sprinting_state && new_stamina <= 0.0 {
        // If trying to sprint but no stamina, force sprint state off for this tick's movement calc
        current_sprinting_state = false;
        base_speed_multiplier = 1.0; // Use base speed
        // The actual player.is_sprinting state will be forced off in player_stats.rs
    }

    // --- Calculate Final Speed Multiplier based on Current Stats ---
    let mut final_speed_multiplier = base_speed_multiplier;
    // Use current player stats read at the beginning of the reducer
    if current_player.thirst < LOW_NEED_THRESHOLD {
        if is_moving { // Only apply penalty if trying to move
            final_speed_multiplier *= LOW_THIRST_SPEED_PENALTY;
            log::debug!("Player {:?} has low thirst. Applying speed penalty.", sender_id);
        }
    }
    if current_player.warmth < LOW_NEED_THRESHOLD {
        if is_moving { // Only apply penalty if trying to move
            final_speed_multiplier *= LOW_WARMTH_SPEED_PENALTY;
            log::debug!("Player {:?} is cold. Applying speed penalty.", sender_id);
        }
    }

    // --- Calculate Target Velocity & Server Displacement ---
    let target_speed = PLAYER_SPEED * final_speed_multiplier;
    // Velocity is the normalized direction vector scaled by target speed
    let velocity_x = move_x * target_speed;
    let velocity_y = move_y * target_speed;

    let server_dx = velocity_x * delta_time_secs;
    let server_dy = velocity_y * delta_time_secs;


    // --- Movement Calculation ---
    // Use server-calculated displacement
    let proposed_x = current_player.position_x + server_dx;
    let proposed_y = current_player.position_y + server_dy;

    let clamped_x = proposed_x.max(PLAYER_RADIUS).min(WORLD_WIDTH_PX - PLAYER_RADIUS);
    let clamped_y = proposed_y.max(PLAYER_RADIUS).min(WORLD_HEIGHT_PX - PLAYER_RADIUS);

    let mut final_x = clamped_x;
    let mut final_y = clamped_y;
    let mut collision_handled = false;

    // --- Collision Detection (using spatial grid) ---
    let mut grid = spatial_grid::SpatialGrid::new();
    grid.populate_from_world(&ctx.db);
    let nearby_entities = grid.get_entities_in_range(clamped_x, clamped_y);

    // Check collisions with nearby entities (Slide calculation)
    for entity in &nearby_entities {
        match entity {
            spatial_grid::EntityType::Player(other_identity) => {
                if *other_identity == sender_id { continue; } // Skip self
                 // Find the player in the database
                if let Some(other_player) = players.identity().find(other_identity) {
                    // Don't collide with dead players
                    if other_player.is_dead { continue; }

                    let dx = clamped_x - other_player.position_x;
                    let dy = clamped_y - other_player.position_y;
                    let dist_sq = dx * dx + dy * dy;
                    let min_dist = PLAYER_RADIUS * 2.0; // Player-Player collision distance
                    let min_dist_sq = min_dist * min_dist;

                    if dist_sq < min_dist_sq {
                        log::debug!("Player-Player collision detected between {:?} and {:?}. Calculating slide.", sender_id, other_player.identity);
                        // Slide calculation
                        let collision_normal_x = dx;
                        let collision_normal_y = dy;
                        let normal_mag_sq = dist_sq;

                        if normal_mag_sq > 0.0 {
                            let normal_mag = normal_mag_sq.sqrt();
                            let norm_x = collision_normal_x / normal_mag;
                            let norm_y = collision_normal_y / normal_mag;
                            // Use server_dx/dy for slide calculation
                            let dot_product = server_dx * norm_x + server_dy * norm_y;
                            let projection_x = dot_product * norm_x;
                            let projection_y = dot_product * norm_y;
                            let slide_dx = server_dx - projection_x;
                            let slide_dy = server_dy - projection_y;
                            final_x = current_player.position_x + slide_dx;
                            final_y = current_player.position_y + slide_dy;
                            // Clamp after slide application
                            final_x = final_x.max(PLAYER_RADIUS).min(WORLD_WIDTH_PX - PLAYER_RADIUS);
                            final_y = final_y.max(PLAYER_RADIUS).min(WORLD_HEIGHT_PX - PLAYER_RADIUS);
                        } else {
                            // If directly overlapping (dist_sq == 0), just stay put relative to this collision
                            final_x = current_player.position_x;
                            final_y = current_player.position_y;
                        }
                        collision_handled = true;
                        // break; // Handle one collision at a time for simplicity? Or continue checking? Continuing check for now.
                    }
                }
            },
            spatial_grid::EntityType::Tree(tree_id) => {
                 // if collision_handled { continue; } // Allow checking multiple collisions?
                 if let Some(tree) = trees.id().find(tree_id) {
                    if tree.health == 0 { continue; }
                    let tree_collision_y = tree.pos_y - crate::tree::TREE_COLLISION_Y_OFFSET;
                    let dx = clamped_x - tree.pos_x;
                    let dy = clamped_y - tree_collision_y;
                    let dist_sq = dx * dx + dy * dy;
                    if dist_sq < crate::tree::PLAYER_TREE_COLLISION_DISTANCE_SQUARED {
                         log::debug!("Player-Tree collision detected between {:?} and tree {}. Calculating slide.", sender_id, tree.id);
                         // Slide calculation
                         let collision_normal_x = dx;
                         let collision_normal_y = dy;
                         let normal_mag_sq = dist_sq;
                         if normal_mag_sq > 0.0 {
                            let normal_mag = normal_mag_sq.sqrt();
                            let norm_x = collision_normal_x / normal_mag;
                            let norm_y = collision_normal_y / normal_mag;
                            // Use server_dx/dy for slide calculation
                            let dot_product = server_dx * norm_x + server_dy * norm_y;
                            let projection_x = dot_product * norm_x;
                            let projection_y = dot_product * norm_y;
                            let slide_dx = server_dx - projection_x;
                            let slide_dy = server_dy - projection_y;
                            final_x = current_player.position_x + slide_dx;
                            final_y = current_player.position_y + slide_dy;
                             // Clamp after slide application
                            final_x = final_x.max(PLAYER_RADIUS).min(WORLD_WIDTH_PX - PLAYER_RADIUS);
                            final_y = final_y.max(PLAYER_RADIUS).min(WORLD_HEIGHT_PX - PLAYER_RADIUS);
                        } else {
                            final_x = current_player.position_x;
                            final_y = current_player.position_y;
                        }
                        collision_handled = true; // Mark collision handled for this type
                    }
                }
            },
            spatial_grid::EntityType::Stone(stone_id) => {
                 // if collision_handled { continue; }
                 if let Some(stone) = stones.id().find(stone_id) {
                     if stone.health == 0 { continue; }
                     let stone_collision_y = stone.pos_y - crate::stone::STONE_COLLISION_Y_OFFSET;
                     let dx = clamped_x - stone.pos_x;
                     let dy = clamped_y - stone_collision_y;
                     let dist_sq = dx * dx + dy * dy;
                     if dist_sq < crate::stone::PLAYER_STONE_COLLISION_DISTANCE_SQUARED {
                         log::debug!("Player-Stone collision detected between {:?} and stone {}. Calculating slide.", sender_id, stone.id);
                         // Slide calculation
                         let collision_normal_x = dx;
                         let collision_normal_y = dy;
                         let normal_mag_sq = dist_sq;
                         if normal_mag_sq > 0.0 {
                             let normal_mag = normal_mag_sq.sqrt();
                             let norm_x = collision_normal_x / normal_mag;
                             let norm_y = collision_normal_y / normal_mag;
                             // Use server_dx/dy for slide calculation
                             let dot_product = server_dx * norm_x + server_dy * norm_y;
                             let projection_x = dot_product * norm_x;
                             let projection_y = dot_product * norm_y;
                             let slide_dx = server_dx - projection_x;
                             let slide_dy = server_dy - projection_y;
                             final_x = current_player.position_x + slide_dx;
                             final_y = current_player.position_y + slide_dy;
                             // Clamp after slide application
                             final_x = final_x.max(PLAYER_RADIUS).min(WORLD_WIDTH_PX - PLAYER_RADIUS);
                             final_y = final_y.max(PLAYER_RADIUS).min(WORLD_HEIGHT_PX - PLAYER_RADIUS);
                         } else {
                             final_x = current_player.position_x;
                             final_y = current_player.position_y;
                         }
                         collision_handled = true; // Mark collision handled
                     }
                 }
            },
            spatial_grid::EntityType::WoodenStorageBox(box_id) => {
                // if collision_handled { continue; }
                if let Some(box_instance) = wooden_storage_boxes.id().find(box_id) {
                    let box_collision_y = box_instance.pos_y - crate::wooden_storage_box::BOX_COLLISION_Y_OFFSET;
                    let dx = clamped_x - box_instance.pos_x;
                    let dy = clamped_y - box_collision_y;
                    let dist_sq = dx * dx + dy * dy;
                    if dist_sq < crate::wooden_storage_box::PLAYER_BOX_COLLISION_DISTANCE_SQUARED {
                         log::debug!("Player-Box collision detected between {:?} and box {}. Calculating slide.", sender_id, box_instance.id);
                         // Slide calculation
                         let collision_normal_x = dx;
                         let collision_normal_y = dy;
                         let normal_mag_sq = dist_sq;
                         if normal_mag_sq > 0.0 {
                             let normal_mag = normal_mag_sq.sqrt();
                             let norm_x = collision_normal_x / normal_mag;
                             let norm_y = collision_normal_y / normal_mag;
                             // Use server_dx/dy for slide calculation
                             let dot_product = server_dx * norm_x + server_dy * norm_y;
                             let projection_x = dot_product * norm_x;
                             let projection_y = dot_product * norm_y;
                             let slide_dx = server_dx - projection_x;
                             let slide_dy = server_dy - projection_y;
                             final_x = current_player.position_x + slide_dx;
                             final_y = current_player.position_y + slide_dy;
                             // Clamp after slide application
                             final_x = final_x.max(PLAYER_RADIUS).min(WORLD_WIDTH_PX - PLAYER_RADIUS);
                             final_y = final_y.max(PLAYER_RADIUS).min(WORLD_HEIGHT_PX - PLAYER_RADIUS);
                         } else {
                             final_x = current_player.position_x;
                             final_y = current_player.position_y;
                         }
                         collision_handled = true; // Mark collision handled
                    }
                }
            },
             spatial_grid::EntityType::Campfire(_) => {
                // No collision with campfires
             },
            _ => {} // Ignore other types for collision
        }
        // If a slide occurred, the 'clamped_x/y' used for subsequent checks in this loop iteration
        // won't reflect the slide. This might lead to missed secondary collisions after sliding.
        // For simplicity, we keep it this way for now. A more robust solution would re-check
        // collisions after each slide within the loop, or use the push-out method below.
    }
    // --- End Initial Collision Check ---


    // --- Iterative Collision Resolution (Push-out) ---
    // Apply push-out based on the potentially slid final_x/final_y
    let mut resolved_x = final_x;
    let mut resolved_y = final_y;
    let resolution_iterations = 5;
    let epsilon = 0.01;

    for _iter in 0..resolution_iterations {
        let mut overlap_found_in_iter = false;
        // Re-query near the currently resolved position for this iteration
        let nearby_entities_resolve = grid.get_entities_in_range(resolved_x, resolved_y);

        for entity in &nearby_entities_resolve {
             match entity {
                 spatial_grid::EntityType::Player(other_identity) => {
                    if *other_identity == sender_id { continue; }
                    if let Some(other_player) = players.identity().find(other_identity) {
                         if other_player.is_dead { continue; } // Don't resolve against dead players
                         let dx = resolved_x - other_player.position_x;
                         let dy = resolved_y - other_player.position_y;
                         let dist_sq = dx * dx + dy * dy;
                         let min_dist = PLAYER_RADIUS * 2.0;
                         let min_dist_sq = min_dist * min_dist;
                         if dist_sq < min_dist_sq && dist_sq > 0.0 {
                             overlap_found_in_iter = true;
                             let distance = dist_sq.sqrt();
                             let overlap = min_dist - distance;
                             let push_amount = (overlap / 2.0) + epsilon; // Push each player half the overlap
                             let push_x = (dx / distance) * push_amount;
                             let push_y = (dy / distance) * push_amount;
                             resolved_x += push_x;
                             resolved_y += push_y;
                             // Note: This only pushes the current player. Ideally, both would be pushed.
                             // Full resolution is complex. This provides basic separation.
                         }
                    }
                },
                 spatial_grid::EntityType::Tree(tree_id) => {
                     if let Some(tree) = trees.id().find(tree_id) {
                         if tree.health == 0 { continue; }
                         let tree_collision_y = tree.pos_y - crate::tree::TREE_COLLISION_Y_OFFSET;
                         let dx = resolved_x - tree.pos_x;
                         let dy = resolved_y - tree_collision_y;
                         let dist_sq = dx * dx + dy * dy;
                         let min_dist = PLAYER_RADIUS + crate::tree::TREE_TRUNK_RADIUS;
                         let min_dist_sq = min_dist * min_dist;
                         if dist_sq < min_dist_sq && dist_sq > 0.0 {
                             overlap_found_in_iter = true;
                             let distance = dist_sq.sqrt();
                             let overlap = (min_dist - distance) + epsilon; // Calculate overlap
                             let push_x = (dx / distance) * overlap; // Push player away by full overlap
                             let push_y = (dy / distance) * overlap;
                             resolved_x += push_x;
                             resolved_y += push_y;
                         }
                     }
                },
                 spatial_grid::EntityType::Stone(stone_id) => {
                    if let Some(stone) = stones.id().find(stone_id) {
                        if stone.health == 0 { continue; }
                        let stone_collision_y = stone.pos_y - crate::stone::STONE_COLLISION_Y_OFFSET;
                        let dx = resolved_x - stone.pos_x;
                        let dy = resolved_y - stone_collision_y;
                        let dist_sq = dx * dx + dy * dy;
                        let min_dist = PLAYER_RADIUS + crate::stone::STONE_RADIUS;
                        let min_dist_sq = min_dist * min_dist;
                        if dist_sq < min_dist_sq && dist_sq > 0.0 {
                             overlap_found_in_iter = true;
                             let distance = dist_sq.sqrt();
                             let overlap = (min_dist - distance) + epsilon;
                             let push_x = (dx / distance) * overlap;
                             let push_y = (dy / distance) * overlap;
                             resolved_x += push_x;
                             resolved_y += push_y;
                        }
                    }
                },
                 spatial_grid::EntityType::WoodenStorageBox(box_id) => {
                     if let Some(box_instance) = wooden_storage_boxes.id().find(box_id) {
                         let box_collision_y = box_instance.pos_y - crate::wooden_storage_box::BOX_COLLISION_Y_OFFSET;
                         let dx = resolved_x - box_instance.pos_x;
                         let dy = resolved_y - box_collision_y;
                         let dist_sq = dx * dx + dy * dy;
                         let min_dist = PLAYER_RADIUS + crate::wooden_storage_box::BOX_COLLISION_RADIUS;
                         let min_dist_sq = min_dist * min_dist;
                         if dist_sq < min_dist_sq && dist_sq > 0.0 {
                             overlap_found_in_iter = true;
                             let distance = dist_sq.sqrt();
                             let overlap = (min_dist - distance) + epsilon;
                             let push_x = (dx / distance) * overlap;
                             let push_y = (dy / distance) * overlap;
                             resolved_x += push_x;
                             resolved_y += push_y;
                         }
                     }
                },
                 spatial_grid::EntityType::Campfire(_) => {
                     // No overlap resolution with campfires
                 },
                _ => {}
             }
        }

        // Clamp position after each iteration's adjustments
        resolved_x = resolved_x.max(PLAYER_RADIUS).min(WORLD_WIDTH_PX - PLAYER_RADIUS);
        resolved_y = resolved_y.max(PLAYER_RADIUS).min(WORLD_HEIGHT_PX - PLAYER_RADIUS);

        if !overlap_found_in_iter {
            // log::trace!("Overlap resolution complete after {} iterations.", _iter + 1);
            break;
        }
        if _iter == resolution_iterations - 1 {
            log::warn!("Overlap resolution reached max iterations ({}) for player {:?}. Position might still overlap slightly.", resolution_iterations, sender_id);
        }
    }
    // --- End Collision Resolution ---


    // --- Final Update ---
    let mut player_to_update = current_player; // Get a mutable copy from the initial read

    // Check if position or direction actually changed
    let position_changed = (resolved_x - player_to_update.position_x).abs() > 0.01 ||
                           (resolved_y - player_to_update.position_y).abs() > 0.01;
    // Check against the animation direction determined earlier
    let direction_changed = player_to_update.direction != final_anim_direction;
    // Don't check stamina/sprint changes here, they are handled by player_stats
    let should_update_state = position_changed || direction_changed;

    // Always update timestamp if delta_time > 0 to prevent accumulation on next tick
    // This ensures last_update reflects the time this reducer processed movement,
    // even if the final position/direction didn't change due to collision or no input.
    let needs_timestamp_update = delta_time_secs > 0.0;

    if should_update_state {
        log::trace!("Updating player {:?} - PosChange: {}, DirChange: {}",
            sender_id, position_changed, direction_changed);

        player_to_update.position_x = resolved_x;
        player_to_update.position_y = resolved_y;
        player_to_update.direction = final_anim_direction; // Update animation direction
        player_to_update.last_update = now; // Update timestamp because state changed

        players.identity().update(player_to_update); // Update the modified player struct
    } else if needs_timestamp_update { // If no state changed, but time passed
         log::trace!("No movement state changes detected for player {:?}, but updating timestamp due to elapsed time.", sender_id);
         // Update only the timestamp on the existing player data
         player_to_update.last_update = now;
         players.identity().update(player_to_update);
    } else {
         // This case should be rare (delta_time <= 0.0)
         log::trace!("No state changes and no time elapsed for player {:?}, skipping update.", sender_id);
    }

    Ok(())
}

// Helper function to generate a deterministic color based on username
fn random_color(username: &str) -> String {
    let colors = [
        "#FF0000", // Red
        "#00FF00", // Green
        "#0000FF", // Blue
        "#FFFF00", // Yellow
        "#FF00FF", // Magenta
        "#00FFFF", // Cyan
        "#FF8000", // Orange
        "#8000FF", // Purple
    ];
    let username_bytes = username.as_bytes();
    let sum_of_bytes: u64 = username_bytes.iter().map(|&byte| byte as u64).sum();
    let color_index = (sum_of_bytes % colors.len() as u64) as usize;
    colors[color_index].to_string()
}

// Reducer called by the client to initiate a jump.
#[spacetimedb::reducer]
pub fn jump(ctx: &ReducerContext) -> Result<(), String> {
   let identity = ctx.sender;
   let players = ctx.db.player();
   if let Some(mut player) = players.identity().find(&identity) {
       // Don't allow jumping if dead
       if player.is_dead {
           return Err("Cannot jump while dead.".to_string());
       }

       let now_micros = ctx.timestamp.to_micros_since_unix_epoch();
       let now_ms = (now_micros / 1000) as u64;

       // Check if the player is already jumping (within cooldown)
       if player.jump_start_time_ms > 0 && now_ms < player.jump_start_time_ms + JUMP_COOLDOWN_MS {
           return Err("Cannot jump again so soon.".to_string());
       }

       // Proceed with the jump
       player.jump_start_time_ms = now_ms;
       player.last_update = ctx.timestamp; // Update timestamp on jump
       players.identity().update(player);
       Ok(())
   } else {
       Err("Player not found".to_string())
   }
}

// --- Client-Requested Random Respawn Reducer ---
#[spacetimedb::reducer]
pub fn respawn_randomly(ctx: &ReducerContext) -> Result<(), String> { // Renamed function
    let sender_id = ctx.sender;
    let players = ctx.db.player();
    let item_defs = ctx.db.item_definition();

    // Find the player requesting respawn
    let mut player = players.identity().find(&sender_id)
        .ok_or_else(|| "Player not found".to_string())?;

    // Check if the player is actually dead
    if !player.is_dead {
        log::warn!("Player {:?} requested respawn but is not dead.", sender_id);
        return Err("You are not dead.".to_string());
    }

    log::info!("Respawning player {} ({:?}). Crafting queue will be cleared.", player.username, sender_id);

    // --- Clear Crafting Queue & Refund ---
    crate::crafting_queue::clear_player_crafting_queue(ctx, sender_id);
    // --- END Clear Crafting Queue ---

    // --- Look up Rock Item Definition ID ---
    let rock_item_def_id = item_defs.iter()
        .find(|def| def.name == "Rock")
        .map(|def| def.id)
        .ok_or_else(|| "Item definition for 'Rock' not found.".to_string())?;
    // --- End Look up ---

    // --- Grant Starting Rock ---
    log::info!("Granting starting Rock to respawned player: {}", player.username);
    let opt_instance_id = crate::items::add_item_to_player_inventory(ctx, sender_id, rock_item_def_id, 1)?;
    match opt_instance_id {
        Some(new_rock_instance_id) => {
            let _ = log::info!("Granted 1 Rock (ID: {}) to player {}.", new_rock_instance_id, player.username);
            ()
        }
        None => {
            let _ = log::error!("Failed to grant starting Rock to player {} (no slot found).", player.username);
            // Optionally, we could return an Err here if not getting a rock is critical
            // return Err("Could not grant starting Rock: Inventory full or other issue.".to_string());
            ()
        }
    }
    // --- End Grant Starting Rock ---

    // --- Reset Stats and State ---
    player.health = 100.0;
    player.hunger = 100.0;
    player.thirst = 100.0;
    player.warmth = 100.0;
    player.stamina = 100.0;
    player.jump_start_time_ms = 0;
    player.is_sprinting = false;
    player.is_dead = false; // Mark as alive again
    player.death_timestamp = None; // Clear death timestamp
    player.last_hit_time = None;

    // --- Reset Position to Random Location ---
    let mut rng = ctx.rng(); // Use the rng() method
    let spawn_padding = TILE_SIZE_PX as f32 * 2.0; // Padding from world edges
    let mut spawn_x;
    let mut spawn_y;
    let mut attempts = 0;
    const MAX_SPAWN_ATTEMPTS: u32 = 10; // Prevent infinite loop

    loop {
        spawn_x = rng.gen_range(spawn_padding..(WORLD_WIDTH_PX - spawn_padding));
        spawn_y = rng.gen_range(spawn_padding..(WORLD_HEIGHT_PX - spawn_padding));
        
        // Basic collision check (simplified - TODO: Add proper safe spawn logic like in register_player)
        let is_safe = true; // Placeholder - replace with actual check

        if is_safe || attempts >= MAX_SPAWN_ATTEMPTS {
            break;
        }
        attempts += 1;
    }

    if attempts >= MAX_SPAWN_ATTEMPTS {
        log::warn!("Could not find a guaranteed safe random spawn point for player {:?} after {} attempts. Spawning anyway.", sender_id, MAX_SPAWN_ATTEMPTS);
    }

    player.position_x = spawn_x;
    player.position_y = spawn_y;
    player.direction = "down".to_string();

    // --- Update Timestamp ---
    player.last_update = ctx.timestamp;
    player.last_stat_update = ctx.timestamp; // Reset stat timestamp on respawn

    // --- Apply Player Changes ---
    players.identity().update(player);
    log::info!("Player {:?} respawned randomly at ({:.1}, {:.1}).", sender_id, spawn_x, spawn_y);

    // Ensure item is unequipped on respawn
    match active_equipment::clear_active_item_reducer(ctx, sender_id) {
        Ok(_) => log::info!("Ensured active item is cleared for respawned player {:?}", sender_id),
        Err(e) => log::error!("Failed to clear active item for respawned player {:?}: {}", sender_id, e),
    }

    // match items::clear_all_equipped_armor_from_player(ctx, sender_id) {
    //     Ok(_) => log::info!("All equipped armor cleared for player {} before respawn.", sender_id),
    //     Err(e) => log::error!("Failed to clear equipped armor for player {} before respawn: {}", sender_id, e),
    // }

    Ok(())
}

// --- NEW: Reducer to Update Viewport ---
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