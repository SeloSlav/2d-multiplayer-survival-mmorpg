use spacetimedb::{ReducerContext, Table, Timestamp};
use log;
use std::f32::consts::PI;
use rand::Rng;
use crate::campfire::Campfire;
use crate::campfire::campfire as CampfireTableTrait;
use crate::campfire::campfire_processing_schedule as CampfireProcessingScheduleTableTrait;
use crate::items::inventory_item as InventoryItemTableTrait;
use crate::items::InventoryItem;
use crate::shelter::shelter as ShelterTableTrait;
use crate::world_state::world_state as WorldStateTableTrait;
use crate::world_state::thunder_event as ThunderEventTableTrait;

// Define fuel consumption rate (items per second)
const FUEL_ITEM_CONSUME_PER_SECOND: f32 = 0.2; // e.g., 1 wood every 5 seconds

// --- Constants ---
const DAY_DURATION_SECONDS: f32 = 2700.0; // 45 minutes
const NIGHT_DURATION_SECONDS: f32 = 900.0;  // 15 minutes
const FULL_CYCLE_DURATION_SECONDS: f32 = DAY_DURATION_SECONDS + NIGHT_DURATION_SECONDS; // Now 60 seconds total

// Full moon occurs roughly every 3 cycles (adjust as needed)
const FULL_MOON_CYCLE_INTERVAL: u32 = 3;

// Update interval for the tick reducer (e.g., every 5 seconds)
// const TICK_INTERVAL_SECONDS: u64 = 5; // We are currently ticking on player move

// Base warmth drain rate per second
pub(crate) const BASE_WARMTH_DRAIN_PER_SECOND: f32 = 0.5; 
// Multipliers for warmth drain based on time of day
pub(crate) const WARMTH_DRAIN_MULTIPLIER_NIGHT: f32 = 2.0;
pub(crate) const WARMTH_DRAIN_MULTIPLIER_MIDNIGHT: f32 = 3.0;
pub(crate) const WARMTH_DRAIN_MULTIPLIER_DAWN_DUSK: f32 = 1.5;

// --- Weather Constants ---
const MIN_RAIN_DURATION_SECONDS: f32 = 300.0; // 5 minutes
const MAX_RAIN_DURATION_SECONDS: f32 = 900.0; // 15 minutes
const RAIN_PROBABILITY_BASE: f32 = 0.6; // 60% base chance per day (increased from 15%)
const RAIN_PROBABILITY_SEASONAL_MODIFIER: f32 = 0.2; // Additional variability (increased from 0.1)
const MIN_TIME_BETWEEN_RAIN_CYCLES: f32 = 600.0; // 10 minutes minimum between rain events (reduced from 30 minutes)

#[derive(Clone, Debug, PartialEq, spacetimedb::SpacetimeType)]
pub enum WeatherType {
    Clear,
    LightRain,
    ModerateRain,
    HeavyRain,
    HeavyStorm, // Intense rain with thunder and lightning
}

#[derive(Clone, Debug, PartialEq, spacetimedb::SpacetimeType)]
pub enum TimeOfDay {
    Dawn,    // Transition from night to day
    TwilightMorning, // Purple hue after dawn
    Morning, // Early day
    Noon,    // Midday, brightest
    Afternoon, // Late day
    Dusk,    // Transition from day to night
    TwilightEvening, // Purple hue after dusk
    Night,   // Darkest part
    Midnight, // Middle of the night
}

#[spacetimedb::table(name = thunder_event, public)]
#[derive(Clone, Debug)]
pub struct ThunderEvent {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub timestamp: Timestamp,
    pub intensity: f32, // 0.5 to 1.0 for flash intensity
}

#[spacetimedb::table(name = world_state, public)]
#[derive(Clone)]
pub struct WorldState {
    #[primary_key]
    #[auto_inc]
    pub id: u32, // Now a regular primary key
    pub cycle_progress: f32, // 0.0 to 1.0 representing position in the full day/night cycle
    pub time_of_day: TimeOfDay,
    pub cycle_count: u32, // How many full cycles have passed
    pub is_full_moon: bool, // Flag for special night lighting
    pub last_tick: Timestamp,
    // Weather fields
    pub current_weather: WeatherType,
    pub rain_intensity: f32, // 0.0 to 1.0, for client-side rendering intensity
    pub weather_start_time: Option<Timestamp>, // When current weather started
    pub weather_duration: Option<f32>, // How long current weather should last (seconds)
    pub last_rain_end_time: Option<Timestamp>, // When rain last ended (for spacing)
    // Thunder/Lightning fields
    pub last_thunder_time: Option<Timestamp>, // When thunder last occurred
    pub next_thunder_time: Option<Timestamp>, // When next thunder should occur
}

// Reducer to initialize the world state if it doesn't exist
#[spacetimedb::reducer]
pub fn seed_world_state(ctx: &ReducerContext) -> Result<(), String> {
    let world_states = ctx.db.world_state();
    if world_states.iter().count() == 0 {
        log::info!("Seeding initial WorldState.");
        world_states.try_insert(WorldState {
            id: 0, // Autoinc takes care of this, but good practice
            cycle_progress: 0.25, // Start at morning
            time_of_day: TimeOfDay::Morning,
            cycle_count: 0,
            is_full_moon: false,
            last_tick: ctx.timestamp,
            current_weather: WeatherType::Clear,
            rain_intensity: 0.0,
            weather_start_time: None,
            weather_duration: None,
            last_rain_end_time: None,
            last_thunder_time: None,
            next_thunder_time: None,
        })?;
    } else {
        log::debug!("WorldState already seeded.");
    }
    Ok(())
}

// Reducer to advance the time of day
#[spacetimedb::reducer]
pub fn tick_world_state(ctx: &ReducerContext, _timestamp: Timestamp) -> Result<(), String> {
    let mut world_state = ctx.db.world_state().iter().next().ok_or_else(|| {
        log::error!("WorldState singleton not found during tick!");
        "WorldState singleton not found".to_string()
    })?;

    let now = ctx.timestamp;
    let last_tick_time = world_state.last_tick;
    let elapsed_micros = now.to_micros_since_unix_epoch().saturating_sub(last_tick_time.to_micros_since_unix_epoch());
    let elapsed_seconds = (elapsed_micros as f64 / 1_000_000.0) as f32;

    // Update the world state only if time actually passed
    if elapsed_seconds > 0.0 {
        let progress_delta = elapsed_seconds / FULL_CYCLE_DURATION_SECONDS;
        
        // Calculate potential progress before wrapping
        let potential_next_progress = world_state.cycle_progress + progress_delta;
        
        // Determine actual new progress (after wrapping)
        let new_progress = potential_next_progress % 1.0;
        
        // Determine if the cycle wrapped during this tick
        let did_wrap = potential_next_progress >= 1.0;
        
        // Determine the correct cycle count for the new_progress point
        let new_cycle_count = if did_wrap { 
            let next_count = world_state.cycle_count.wrapping_add(1); // Use wrapping_add for safety
            log::info!("New cycle started ({} -> {}).", world_state.cycle_count, next_count);
            next_count
        } else { 
            world_state.cycle_count 
        };
        
        // Determine full moon status based on the *correct* cycle count for this progress
        let new_is_full_moon = new_cycle_count % FULL_MOON_CYCLE_INTERVAL == 0;
        if did_wrap {
             log::info!("Cycle {} Full Moon status: {}", new_cycle_count, new_is_full_moon);
        }

        // Determine the new TimeOfDay based on new_progress
        // Day is now 0.0 to 0.75, Night is 0.75 to 1.0
        let new_time_of_day = match new_progress {
            p if p < 0.04 => TimeOfDay::Dawn,     // Orange (0.0 - 0.04)
            p if p < 0.08 => TimeOfDay::TwilightMorning, // Purple (0.04 - 0.08)
            p if p < 0.30 => TimeOfDay::Morning,   // Yellow (0.08 - 0.30)
            p if p < 0.45 => TimeOfDay::Noon,      // Bright Yellow (0.30 - 0.45)
            p if p < 0.67 => TimeOfDay::Afternoon, // Yellow (0.45 - 0.67)
            p if p < 0.71 => TimeOfDay::Dusk,      // Orange (0.67 - 0.71)
            p if p < 0.75 => TimeOfDay::TwilightEvening, // Purple (0.71 - 0.75)
            p if p < 0.90 => TimeOfDay::Night,     // Dark Blue (0.75 - 0.90)
            _             => TimeOfDay::Midnight, // Very Dark Blue/Black (0.90 - 1.0), also default
        };

        // Assign the calculated new values to the world_state object
        world_state.cycle_progress = new_progress;
        world_state.time_of_day = new_time_of_day;
        world_state.cycle_count = new_cycle_count;
        world_state.is_full_moon = new_is_full_moon; // Use the correctly determined flag
        world_state.last_tick = now;

        // Pass a clone to update
        ctx.db.world_state().id().update(world_state.clone());
        
        // Update weather after updating time
        update_weather(ctx, &mut world_state, elapsed_seconds)?;
        
        log::debug!("World tick: Progress {:.2}, Time: {:?}, Cycle: {}, Full Moon: {}, Weather: {:?}", 
                   new_progress, world_state.time_of_day, new_cycle_count, new_is_full_moon, world_state.current_weather);
    }

    Ok(())
}

/// Updates weather patterns based on realistic probability and timing
fn update_weather(ctx: &ReducerContext, world_state: &mut WorldState, elapsed_seconds: f32) -> Result<(), String> {
    let now = ctx.timestamp;
    let mut rng = ctx.rng();
    
    match world_state.current_weather {
        WeatherType::Clear => {
            // Check if we should start rain
            let should_check_rain = if let Some(last_rain_end) = world_state.last_rain_end_time {
                let time_since_last_rain = (now.to_micros_since_unix_epoch() - last_rain_end.to_micros_since_unix_epoch()) as f32 / 1_000_000.0;
                time_since_last_rain >= MIN_TIME_BETWEEN_RAIN_CYCLES
            } else {
                true // No previous rain recorded
            };
            
            if should_check_rain {
                // Calculate rain probability based on time of day and cycle
                let time_modifier = match world_state.time_of_day {
                    TimeOfDay::Dawn | TimeOfDay::Dusk => 1.3, // Higher chance during transitions
                    TimeOfDay::TwilightMorning | TimeOfDay::TwilightEvening => 1.2,
                    TimeOfDay::Night | TimeOfDay::Midnight => 1.1, // Slightly higher at night
                    _ => 1.0,
                };
                
                // Seasonal variation based on cycle count
                let seasonal_modifier = 1.0 + (world_state.cycle_count as f32 * 0.1).sin() * RAIN_PROBABILITY_SEASONAL_MODIFIER;
                
                let rain_probability = RAIN_PROBABILITY_BASE * time_modifier * seasonal_modifier * elapsed_seconds / FULL_CYCLE_DURATION_SECONDS;
                
                if rng.gen::<f32>() < rain_probability {
                    // Start rain!
                    let rain_type = match rng.gen::<f32>() {
                        x if x < 0.4 => WeatherType::LightRain,
                        x if x < 0.7 => WeatherType::ModerateRain,
                        x if x < 0.95 => WeatherType::HeavyRain,
                        _ => WeatherType::HeavyStorm, // 5% chance for heavy storm
                    };
                    
                    let rain_duration = rng.gen_range(MIN_RAIN_DURATION_SECONDS..=MAX_RAIN_DURATION_SECONDS);
                    let rain_intensity = match rain_type {
                        WeatherType::LightRain => rng.gen_range(0.2..=0.4),
                        WeatherType::ModerateRain => rng.gen_range(0.5..=0.7),
                        WeatherType::HeavyRain => rng.gen_range(0.8..=1.0),
                        WeatherType::HeavyStorm => 1.0, // Maximum intensity
                        _ => 0.0,
                    };
                    
                    world_state.current_weather = rain_type.clone();
                    world_state.rain_intensity = rain_intensity;
                    world_state.weather_start_time = Some(now);
                    world_state.weather_duration = Some(rain_duration);
                    
                    // Schedule first thunder for Heavy Storm
                    if rain_type == WeatherType::HeavyStorm {
                        let first_thunder_delay = rng.gen_range(10.0..=30.0); // 10-30 seconds
                        world_state.next_thunder_time = Some(now + spacetimedb::TimeDuration::from_micros((first_thunder_delay * 1_000_000.0) as i64));
                        log::info!("Heavy Storm started with thunder scheduled in {:.1} seconds", first_thunder_delay);
                    }
                    
                    log::info!("Rain started: {:?} with intensity {:.2} for {:.1} seconds", 
                              world_state.current_weather, rain_intensity, rain_duration);
                    
                    // Extinguish all unprotected campfires when rain starts
                    extinguish_unprotected_campfires(ctx)?;
                }
            }
        },
        WeatherType::LightRain | WeatherType::ModerateRain | WeatherType::HeavyRain | WeatherType::HeavyStorm => {
            // Check if rain should end
            if let (Some(start_time), Some(duration)) = (world_state.weather_start_time, world_state.weather_duration) {
                let rain_elapsed = (now.to_micros_since_unix_epoch() - start_time.to_micros_since_unix_epoch()) as f32 / 1_000_000.0;
                
                if rain_elapsed >= duration {
                    // End rain
                    world_state.current_weather = WeatherType::Clear;
                    world_state.rain_intensity = 0.0;
                    world_state.weather_start_time = None;
                    world_state.weather_duration = None;
                    world_state.last_rain_end_time = Some(now);
                    // Clear thunder scheduling
                    world_state.last_thunder_time = None;
                    world_state.next_thunder_time = None;
                    
                    log::info!("Rain ended after {:.1} seconds", rain_elapsed);
                } else {
                    // Process thunder for Heavy Storm
                    if world_state.current_weather == WeatherType::HeavyStorm {
                        if let Some(next_thunder) = world_state.next_thunder_time {
                            if now.to_micros_since_unix_epoch() >= next_thunder.to_micros_since_unix_epoch() {
                                // Thunder occurs! Schedule next one
                                world_state.last_thunder_time = Some(now);
                                let next_thunder_delay = rng.gen_range(15.0..=60.0); // 15-60 seconds between thunder
                                world_state.next_thunder_time = Some(now + spacetimedb::TimeDuration::from_micros((next_thunder_delay * 1_000_000.0) as i64));
                                
                                // Create thunder event for client
                                let thunder_intensity = rng.gen_range(0.5..=1.0);
                                let thunder_event = ThunderEvent {
                                    id: 0, // auto_inc
                                    timestamp: now,
                                    intensity: thunder_intensity,
                                };
                                ctx.db.thunder_event().insert(thunder_event);
                                
                                log::info!("⚡ THUNDER! Intensity {:.2}, Next thunder in {:.1} seconds", thunder_intensity, next_thunder_delay);
                            }
                        }
                    }
                    
                    // Optionally vary intensity slightly during rain
                    let intensity_variation = (rain_elapsed * 0.1).sin() * 0.1;
                    let base_intensity = match world_state.current_weather {
                        WeatherType::LightRain => 0.3,
                        WeatherType::ModerateRain => 0.6,
                        WeatherType::HeavyRain => 0.9,
                        WeatherType::HeavyStorm => 1.0, // Maximum intensity
                        _ => 0.0,
                    };
                    world_state.rain_intensity = (base_intensity + intensity_variation).max(0.1).min(1.0);
                }
            }
        },
    }
    
    // Update the world state with new weather
    ctx.db.world_state().id().update(world_state.clone());
    Ok(())
}

// Helper function potentially needed later for client-side interpolation/lighting
pub fn get_light_intensity(progress: f32) -> f32 {
    // Simple sinusoidal model: peaks at noon (0.5 progress), troughs at midnight (0.0/1.0 progress)
    // Map progress [0, 1] to angle [0, 2*PI]
    let angle = progress * 2.0 * PI;
    // Use sin, shift phase so peak is at 0.5 progress (angle = PI)
    // sin(angle - PI/2) would peak at 0.5, but we want noon bright (intensity 1) and midnight dark (intensity 0)
    // Let's use a shifted cosine: cos(angle) peaks at 0 and 1. We want peak at 0.5.
    // cos(angle - PI) peaks at angle=PI (progress=0.5).
    // The range is [-1, 1]. We need [0, 1]. So (cos(angle - PI) + 1) / 2
    let intensity = (f32::cos(angle - PI) + 1.0) / 2.0;
    intensity.max(0.0).min(1.0) // Clamp just in case
}

/// Extinguishes all campfires that are not protected by shelters when rain starts
fn extinguish_unprotected_campfires(ctx: &ReducerContext) -> Result<(), String> {
    let mut extinguished_count = 0;
    
    for mut campfire in ctx.db.campfire().iter() {
        if !campfire.is_burning || campfire.is_destroyed {
            continue;
        }
        
        // Check if campfire is protected by being inside a shelter
        let is_protected = is_campfire_inside_shelter(ctx, &campfire);
        
        if !is_protected {
            // Extinguish the campfire
            campfire.is_burning = false;
            campfire.current_fuel_def_id = None;
            campfire.remaining_fuel_burn_time_secs = None;
            
            // Update the campfire in the database
            ctx.db.campfire().id().update(campfire.clone());
            
            // Cancel any scheduled processing for this campfire
            ctx.db.campfire_processing_schedule().campfire_id().delete(campfire.id as u64);
            
            extinguished_count += 1;
            log::info!("Rain extinguished unprotected campfire {} at ({:.1}, {:.1})", 
                      campfire.id, campfire.pos_x, campfire.pos_y);
        } else {
            log::debug!("Campfire {} is protected from rain by shelter", campfire.id);
        }
    }
    
    if extinguished_count > 0 {
        log::info!("Rain extinguished {} unprotected campfires", extinguished_count);
    }
    
    Ok(())
}

/// Checks if a campfire is inside any shelter (protected from rain)
fn is_campfire_inside_shelter(ctx: &ReducerContext, campfire: &Campfire) -> bool {
    for shelter in ctx.db.shelter().iter() {
        if shelter.is_destroyed {
            continue;
        }
        
        // Use the same shelter collision detection logic as in shelter.rs
        let shelter_aabb_center_x = shelter.pos_x;
        let shelter_aabb_center_y = shelter.pos_y - crate::shelter::SHELTER_AABB_CENTER_Y_OFFSET_FROM_POS_Y;
        let aabb_left = shelter_aabb_center_x - crate::shelter::SHELTER_AABB_HALF_WIDTH;
        let aabb_right = shelter_aabb_center_x + crate::shelter::SHELTER_AABB_HALF_WIDTH;
        let aabb_top = shelter_aabb_center_y - crate::shelter::SHELTER_AABB_HALF_HEIGHT;
        let aabb_bottom = shelter_aabb_center_y + crate::shelter::SHELTER_AABB_HALF_HEIGHT;
        
        // Check if campfire position is inside shelter AABB
        if campfire.pos_x >= aabb_left && campfire.pos_x <= aabb_right &&
           campfire.pos_y >= aabb_top && campfire.pos_y <= aabb_bottom {
            return true;
        }
    }
    
    false
} 