use spacetimedb::{ReducerContext, Table, Timestamp};
use log;
use std::f32::consts::PI;
use crate::campfire::Campfire;
use crate::campfire::campfire as CampfireTableTrait;
use crate::items::inventory_item as InventoryItemTableTrait;
use crate::items::InventoryItem;

// Define fuel consumption rate (items per second)
const FUEL_ITEM_CONSUME_PER_SECOND: f32 = 0.2; // e.g., 1 wood every 5 seconds

// --- Constants ---
const DAY_DURATION_SECONDS: f32 = 90.0;
const NIGHT_DURATION_SECONDS: f32 = 90.0;
const FULL_CYCLE_DURATION_SECONDS: f32 = DAY_DURATION_SECONDS + NIGHT_DURATION_SECONDS; // 60 minutes total

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

#[derive(Clone, Debug, PartialEq, spacetimedb::SpacetimeType)]
pub enum TimeOfDay {
    Dawn,    // Transition from night to day
    Morning, // Early day
    Noon,    // Midday, brightest
    Afternoon, // Late day
    Dusk,    // Transition from day to night
    Night,   // Darkest part
    Midnight, // Middle of the night
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
        let new_time_of_day = match new_progress {
            p if p < 0.05 => TimeOfDay::Midnight, 
            p if p < 0.20 => TimeOfDay::Night,
            p if p < 0.35 => TimeOfDay::Dawn,    // Adjusted timing
            p if p < 0.50 => TimeOfDay::Morning, // Adjusted timing
            p if p < 0.65 => TimeOfDay::Noon,    // Adjusted timing
            p if p < 0.80 => TimeOfDay::Afternoon, // Adjusted timing
            p if p < 0.95 => TimeOfDay::Dusk,    // Adjusted timing
            _             => TimeOfDay::Night,   // Default to Night for late dusk/early night
        };

        // Assign the calculated new values to the world_state object
        world_state.cycle_progress = new_progress;
        world_state.time_of_day = new_time_of_day;
        world_state.cycle_count = new_cycle_count;
        world_state.is_full_moon = new_is_full_moon; // Use the correctly determined flag
        world_state.last_tick = now;

        // Pass a clone to update
        ctx.db.world_state().id().update(world_state.clone());
        
        log::debug!("World tick: Progress {:.2}, Time: {:?}, Cycle: {}, Full Moon: {}", new_progress, world_state.time_of_day, new_cycle_count, new_is_full_moon);
    }

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