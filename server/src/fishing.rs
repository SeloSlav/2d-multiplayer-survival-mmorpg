use spacetimedb::{Identity, Timestamp, table, reducer, ReducerContext, SpacetimeType, log, Table};
use crate::items::InventoryItem;
use crate::player;
use crate::active_equipment::active_equipment;
use crate::items::{inventory_item, item_definition};
use crate::dropped_item::{create_dropped_item_entity, calculate_drop_position};
use crate::world_state::{world_state as WorldStateTableTrait, TimeOfDay, WeatherType};
use rand::Rng;

// Fishing state tracking
#[derive(SpacetimeType)]
pub struct FishingState {
    pub is_fishing: bool,
    pub cast_timestamp: Option<Timestamp>,
    pub target_x: f32,
    pub target_y: f32,
    pub fishing_rod_item: String, // Name of the fishing rod being used
}

// Table to track active fishing sessions
#[table(name = fishing_session, public)]
pub struct FishingSession {
    #[primary_key]
    pub player_id: Identity,
    pub is_active: bool,
    pub cast_time: Timestamp,
    pub target_x: f32,
    pub target_y: f32,
    pub fishing_rod: String,
    pub has_bite: bool,
}

// Fishing loot table entry
#[derive(SpacetimeType, Clone, Debug)]
pub struct FishingLoot {
    pub item_name: String,
    pub min_quantity: u32,
    pub max_quantity: u32,
    pub drop_chance: f32, // 0.0 to 1.0
    pub is_junk: bool,
}

// Static fishing loot table
pub fn get_fishing_loot_table() -> Vec<FishingLoot> {
    vec![
        FishingLoot {
            item_name: "Raw Twigfish".to_string(),
            min_quantity: 1,
            max_quantity: 1,
            drop_chance: 1.0, // Always get at least one fish
            is_junk: false,
        },
        FishingLoot {
            item_name: "Tin Can".to_string(),
            min_quantity: 1,
            max_quantity: 1,
            drop_chance: 0.3, // 30% chance for junk
            is_junk: true,
        },
    ]
}

// Generate loot for a successful fishing attempt with time-of-day and weather bonuses
pub fn generate_fishing_loot(ctx: &ReducerContext) -> Vec<String> {
    let mut loot = vec!["Raw Twigfish".to_string()]; // Always get a fish
    
    // Get current time of day and weather for fishing bonuses
    let time_of_day = get_current_time_of_day(ctx);
    let current_weather = get_current_weather(ctx);
    
    // Calculate fishing effectiveness multiplier based on time of day
    let time_effectiveness = get_fishing_effectiveness_multiplier(&time_of_day);
    
    // Calculate rain-based fishing effectiveness multiplier
    let rain_effectiveness = get_rain_fishing_multiplier(&current_weather);
    
    // Combine both multipliers - rain stacks with time bonuses!
    let total_fishing_effectiveness = time_effectiveness * rain_effectiveness;
    
    // Base chances modified by combined effectiveness
    let base_bonus_fish_chance = 0.3; // 30% base chance for bonus fish
    let base_junk_chance = 0.5; // 50% base chance for junk
    
    // Apply combined bonuses
    let bonus_fish_chance = base_bonus_fish_chance * total_fishing_effectiveness;
    let junk_chance = base_junk_chance * (2.0 - total_fishing_effectiveness); // Less junk during good fishing times
    
    // Roll for bonus fish (better during dawn/dusk and rain)
    if ctx.rng().gen_range(0.0..1.0) < bonus_fish_chance {
        loot.push("Raw Twigfish".to_string());
        log::info!("Bonus fish caught during {:?} with {:?}! (time: {:.2}x, rain: {:.2}x, total: {:.2}x)", 
                  time_of_day, current_weather, time_effectiveness, rain_effectiveness, total_fishing_effectiveness);
    }
    
    // Roll for junk (less likely during good fishing conditions)
    if ctx.rng().gen_range(0.0..1.0) < junk_chance {
        loot.push("Tin Can".to_string());
    }
    
    // Very rare bonus during optimal fishing times (dawn/dusk + rain)
    if total_fishing_effectiveness > 2.0 && ctx.rng().gen_range(0.0..1.0) < 0.25 {
        loot.push("Raw Twigfish".to_string());
        log::info!("🐟🌧️ PERFECT fishing conditions! Extra bonus fish during {:?} + {:?} (total effectiveness: {:.2}x)", 
                  time_of_day, current_weather, total_fishing_effectiveness);
    }
    
    loot
}

// Helper function to get current time of day from world state
fn get_current_time_of_day(ctx: &ReducerContext) -> TimeOfDay {
    match ctx.db.world_state().iter().next() {
        Some(world_state) => world_state.time_of_day.clone(),
        None => {
            log::warn!("No world state found, defaulting to Noon for fishing calculations");
            TimeOfDay::Noon
        }
    }
}

// Helper function to get current weather from world state
fn get_current_weather(ctx: &ReducerContext) -> WeatherType {
    match ctx.db.world_state().iter().next() {
        Some(world_state) => world_state.current_weather.clone(),
        None => {
            log::warn!("No world state found, defaulting to Clear weather for fishing calculations");
            WeatherType::Clear
        }
    }
}

// Calculate fishing effectiveness multiplier based on time of day
fn get_fishing_effectiveness_multiplier(time_of_day: &TimeOfDay) -> f32 {
    match time_of_day {
        TimeOfDay::Dawn => 1.8,           // 80% better fishing at dawn
        TimeOfDay::Dusk => 1.8,           // 80% better fishing at dusk  
        TimeOfDay::TwilightMorning => 1.4, // 40% better during morning twilight
        TimeOfDay::TwilightEvening => 1.4, // 40% better during evening twilight
        TimeOfDay::Morning => 1.1,        // 10% better in morning
        TimeOfDay::Afternoon => 1.1,      // 10% better in afternoon
        TimeOfDay::Night => 0.8,          // 20% worse at night
        TimeOfDay::Midnight => 0.6,       // 40% worse at midnight
        TimeOfDay::Noon => 1.0,           // Normal fishing at noon
    }
}

// Calculate rain-based fishing effectiveness multiplier
fn get_rain_fishing_multiplier(weather: &WeatherType) -> f32 {
    match weather {
        WeatherType::Clear => 1.0,           // Normal fishing in clear weather
        WeatherType::LightRain => 1.3,       // 30% better - light rain stirs up insects
        WeatherType::ModerateRain => 1.6,    // 60% better - fish are more active
        WeatherType::HeavyRain => 2.0,       // 100% better - fish feeding frenzy
        WeatherType::HeavyStorm => 2.5,      // 150% better - but dangerous conditions!
    }
}

// Water tile detection using the existing tile system
pub fn is_water_tile(ctx: &ReducerContext, x: f32, y: f32) -> bool {
    use crate::{world_pos_to_tile_coords, get_tile_type_at_position, TileType};
    
    // Convert world position to tile coordinates
    let (tile_x, tile_y) = world_pos_to_tile_coords(x, y);
    
    // Get the tile type at this position
    match get_tile_type_at_position(ctx, tile_x, tile_y) {
        Some(TileType::Sea) => true,
        _ => false,
    }
}

// Fishing range check
pub fn is_within_fishing_range(player_x: f32, player_y: f32, target_x: f32, target_y: f32) -> bool {
    let distance = ((target_x - player_x).powi(2) + (target_y - player_y).powi(2)).sqrt();
    distance <= 800.0 // Fishing range of 800 units (matches client FISHING_CONSTANTS.RANGE)
}

#[reducer]
pub fn cast_fishing_line(ctx: &ReducerContext, target_x: f32, target_y: f32) -> Result<(), String> {
    let player_id = ctx.sender;
    
    // Get player position from player table
    let player = match ctx.db.player().identity().find(&player_id) {
        Some(p) => p,
        None => return Err("Player not found".to_string()),
    };
    
    // Check if player is alive
    if player.is_dead {
        return Err("Cannot fish while dead".to_string());
    }
    
    // Check fishing range
    if !is_within_fishing_range(player.position_x, player.position_y, target_x, target_y) {
        return Err("Target location is too far away".to_string());
    }
    
    // Check if target location is water
    if !is_water_tile(ctx, target_x, target_y) {
        return Err("Can only cast fishing line in water".to_string());
    }
    
    // Check if player has a fishing rod equipped by looking at active equipment
    let active_equipment = ctx.db.active_equipment().player_identity().find(&player_id);
    let active_item_name = match active_equipment {
        Some(eq) => {
            match eq.equipped_item_def_id {
                Some(item_def_id) => {
                    // Look up the item definition to get the name
                    match ctx.db.item_definition().id().find(&item_def_id) {
                        Some(item_def) => item_def.name.clone(),
                        None => return Err("Active item definition not found".to_string()),
                    }
                }
                None => return Err("No active item equipped".to_string()),
            }
        }
        None => return Err("No active equipment found".to_string()),
    };
    
    // Verify it's a fishing rod
    if !active_item_name.contains("Fishing Rod") {
        return Err("Must have a fishing rod equipped".to_string());
    }
    
    // Check if player is already fishing
    if let Some(_existing_session) = ctx.db.fishing_session().player_id().find(&player_id) {
        return Err("Already fishing".to_string());
    }
    
    // Create new fishing session
    let fishing_session = FishingSession {
        player_id,
        is_active: true,
        cast_time: ctx.timestamp,
        target_x,
        target_y,
        fishing_rod: active_item_name,
        has_bite: false,
    };
    
    ctx.db.fishing_session().insert(fishing_session);
    
    log::info!("Player {} cast fishing line at ({}, {})", player_id, target_x, target_y);
    Ok(())
}

#[reducer]
pub fn finish_fishing(ctx: &ReducerContext, success: bool, _caught_items: Vec<String>) -> Result<(), String> {
    let player_id = ctx.sender;
    
    log::info!("===== FINISH_FISHING CALLED =====");
    log::info!("Player: {}", player_id);
    log::info!("Success: {}", success);
    log::info!("Caught items (ignored): {:?}", _caught_items);
    
    // Find active fishing session
    let fishing_session = match ctx.db.fishing_session().player_id().find(&player_id) {
        Some(session) => {
            log::info!("Found fishing session: active={}, cast_time={:?}", session.is_active, session.cast_time);
            session
        },
        None => {
            log::error!("No active fishing session found for player {}", player_id);
            return Err("No active fishing session".to_string());
        },
    };
    
    if !fishing_session.is_active {
        log::error!("Fishing session exists but is not active for player {}", player_id);
        return Err("Fishing session is not active".to_string());
    }
    
    log::info!("Removing fishing session for player {}", player_id);
    // Remove fishing session
    ctx.db.fishing_session().player_id().delete(&player_id);
    
    if success {
        // Generate loot server-side to ensure fairness and prevent cheating
        let generated_loot = generate_fishing_loot(ctx);
        
        if generated_loot.is_empty() {
            log::error!("Player {} successful fishing but no loot generated! This should never happen!", player_id);
            return Err("No loot generated despite successful fishing".to_string());
        }
        
        // Get player for drop position calculation
        let player = match ctx.db.player().identity().find(&player_id) {
            Some(p) => p,
            None => return Err("Player not found for item drop".to_string()),
        };
        
        // Track successful spawns
        let mut spawned_items = Vec::new();
        
        // Spawn caught items as dropped items with proper spacing
        log::info!("Attempting to spawn {} items near player position ({:.1}, {:.1})", generated_loot.len(), player.position_x, player.position_y);
        
        for (item_index, item_name) in generated_loot.iter().enumerate() {
            log::info!("Looking for item definition for: '{}'", item_name);
            
            // Find the item definition by name
            let item_def = ctx.db.item_definition().iter()
                .find(|def| def.name == *item_name);
            
            match item_def {
                Some(def) => {
                    log::info!("Found item definition for '{}' with ID: {}", item_name, def.id);
                    
                    // Calculate offset position for this item to spread them out visually
                    let base_distance = 48.0; // Base distance from player
                    let angle_offset = (item_index as f32) * (std::f32::consts::PI * 2.0 / generated_loot.len() as f32); // Spread items in a circle
                    let drop_x = player.position_x + (base_distance * angle_offset.cos());
                    let drop_y = player.position_y + (base_distance * angle_offset.sin());
                    
                    // Create dropped item at calculated offset position
                    match create_dropped_item_entity(ctx, def.id, 1, drop_x, drop_y) {
                        Ok(_) => {
                            log::info!("SUCCESS: Player {} caught: {} (spawned as dropped item at {:.1}, {:.1})", 
                                     player_id, item_name, drop_x, drop_y);
                            spawned_items.push(item_name.clone());
                        }
                        Err(e) => {
                            log::error!("FAILED to spawn caught item '{}' as dropped item: {}", item_name, e);
                        }
                    }
                }
                None => {
                    log::error!("FAILED to find item definition for: '{}'", item_name);
                    // Let's also log all available item names for debugging
                    let available_items: Vec<String> = ctx.db.item_definition().iter()
                        .map(|def| def.name.clone())
                        .collect();
                    log::error!("Available item names: {:?}", available_items);
                }
            }
        }
        
        if spawned_items.is_empty() {
            log::error!("Player {} successful fishing but no items were spawned!", player_id);
            return Err("Failed to spawn any caught items".to_string());
        }
        
        log::info!("Player {} successfully caught {} items: {:?}", player_id, spawned_items.len(), spawned_items);
    }
    
    log::info!("Player {} finished fishing. Success: {}", player_id, success);
    Ok(())
}

#[reducer]
pub fn cancel_fishing(ctx: &ReducerContext) -> Result<(), String> {
    let player_id = ctx.sender;
    
    // Remove fishing session if exists
    if ctx.db.fishing_session().player_id().find(&player_id).is_some() {
        ctx.db.fishing_session().player_id().delete(&player_id);
        log::info!("Player {} cancelled fishing", player_id);
    }
    
    Ok(())
}

// Helper function to check if a player is currently fishing
pub fn is_player_fishing(ctx: &ReducerContext, player_id: &Identity) -> bool {
    ctx.db.fishing_session()
        .player_id()
        .find(player_id)
        .map_or(false, |session| session.is_active)
}

// Get fishing session info for a player
pub fn get_fishing_session(ctx: &ReducerContext, player_id: &Identity) -> Option<FishingSession> {
    ctx.db.fishing_session().player_id().find(player_id)
} 