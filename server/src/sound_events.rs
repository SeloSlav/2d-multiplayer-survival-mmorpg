use spacetimedb::{table, Identity, Timestamp, ReducerContext, Table, reducer, SpacetimeType, ScheduleAt, TimeDuration};
use rand::Rng;

// --- Sound Event Types ---

/// Types of sound events that can be triggered
#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum SoundType {
    TreeChop,     // tree_chop.ogg, tree_chop1.ogg, tree_chop2.ogg (3 variations)
    TreeCreaking, // tree_creaking.ogg (1 variation - plays when tree is about to fall)
    TreeFalling,  // tree_falling.ogg (1 variation - plays when tree reaches 0 health)
    StoneHit,     // stone_hit.ogg, stone_hit1.ogg, stone_hit2.ogg (3 variations)
    StoneDestroyed, // stone_destroyed.ogg (1 variation - plays when stone reaches 0 health)
    HarvestPlant, // harvest_plant.ogg (1 variation - for picking up resource nodes)
    PlantSeed,    // plant_seed.ogg (1 variation - for planting seeds)
    PickupItem,   // item_pickup.ogg (1 variation - for item pickup)
    // Add more as needed - extensible system
}

impl SoundType {
    /// Get the base sound file name (without variation number and extension)
    pub fn get_base_filename(&self) -> &'static str {
        match self {
            SoundType::TreeChop => "tree_chop",
            SoundType::TreeCreaking => "tree_creaking",
            SoundType::TreeFalling => "tree_falling",
            SoundType::StoneHit => "stone_hit",
            SoundType::StoneDestroyed => "stone_destroyed",
                        SoundType::HarvestPlant => "harvest_plant", 
            SoundType::PlantSeed => "plant_seed",
            SoundType::PickupItem => "item_pickup",
        }
    }

    /// Get the number of sound variations available for this sound type
    pub fn get_variation_count(&self) -> u8 {
        match self {
            SoundType::TreeChop => 3,    // tree_chop.ogg, tree_chop1.ogg, tree_chop2.ogg
            SoundType::TreeCreaking => 1, // tree_creaking.ogg
            SoundType::TreeFalling => 1,  // tree_falling.ogg
            SoundType::StoneHit => 3,    // stone_hit.ogg, stone_hit1.ogg, stone_hit2.ogg
            SoundType::StoneDestroyed => 1, // stone_destroyed.ogg
            SoundType::HarvestPlant => 1, // harvest_plant.ogg (single variation)
            SoundType::PlantSeed => 1, // plant_seed.ogg (single variation)
            SoundType::PickupItem => 1, // item_pickup.ogg (single variation)
        }
    }

    /// Generate the full filename with random variation
    pub fn get_random_filename(&self, rng: &mut impl Rng) -> String {
        let base = self.get_base_filename();
        let variation_count = self.get_variation_count();
        
        if variation_count <= 1 {
            format!("{}.ogg", base)
        } else {
            let variation = rng.gen_range(0..variation_count);
            if variation == 0 {
                format!("{}.ogg", base)
            } else {
                format!("{}{}.ogg", base, variation)
            }
        }
    }
}

/// Sound event table - stores sound events for clients to process
#[table(name = sound_event, public)]
#[derive(Clone, Debug)]
pub struct SoundEvent {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub sound_type: SoundType,
    pub filename: String,        // e.g., "tree_chop2.ogg"
    pub pos_x: f32,             // Position where sound occurs
    pub pos_y: f32,
    pub volume: f32,            // 0.0 to 1.0
    pub max_distance: f32,      // Maximum distance to hear sound
    pub triggered_by: Identity, // Player who triggered the sound
    pub timestamp: Timestamp,
}

// --- Sound Event Cleanup System ---

/// Schedule table for cleaning up old sound events
#[table(name = sound_event_cleanup_schedule, scheduled(cleanup_old_sound_events))]
#[derive(Clone, Debug)]
pub struct SoundEventCleanupSchedule {
    #[primary_key]
    #[auto_inc]
    pub schedule_id: u64,
    pub scheduled_at: ScheduleAt,
}

/// Clean up sound events older than 5 seconds to prevent table bloat
#[reducer]
pub fn cleanup_old_sound_events(ctx: &ReducerContext, _args: SoundEventCleanupSchedule) -> Result<(), String> {
    // Security check - only allow scheduler to run this
    if ctx.sender != ctx.identity() {
        return Err("Sound event cleanup can only be run by scheduler".to_string());
    }

    let cutoff_time = ctx.timestamp - TimeDuration::from_micros(5_000_000); // 5 seconds ago
    
    let sound_events_table = ctx.db.sound_event();
    let old_events: Vec<u64> = sound_events_table.iter()
        .filter(|event| event.timestamp < cutoff_time)
        .map(|event| event.id)
        .collect();

    let removed_count = old_events.len();
    for event_id in old_events {
        sound_events_table.id().delete(event_id);
    }

    if removed_count > 0 {
        log::info!("Cleaned up {} old sound events", removed_count);
    }

    Ok(())
}

// --- Public API Functions ---

/// Emit a sound event at a specific position
/// This is the main function other modules should use
pub fn emit_sound_at_position(
    ctx: &ReducerContext,
    sound_type: SoundType,
    pos_x: f32,
    pos_y: f32,
    volume: f32,
    triggered_by: Identity,
) -> Result<(), String> {
    emit_sound_at_position_with_distance(ctx, sound_type, pos_x, pos_y, volume, 500.0, triggered_by)
}

/// Emit a sound event with custom max hearing distance
pub fn emit_sound_at_position_with_distance(
    ctx: &ReducerContext,
    sound_type: SoundType,
    pos_x: f32,
    pos_y: f32,
    volume: f32,
    max_distance: f32,
    triggered_by: Identity,
) -> Result<(), String> {
    let mut rng = ctx.rng();
    let filename = sound_type.get_random_filename(&mut rng);
    
    let sound_event = SoundEvent {
        id: 0, // Auto-incremented
        sound_type,
        filename,
        pos_x,
        pos_y,
        volume: volume.max(0.0), // Only clamp minimum to 0, no maximum limit
        max_distance,
        triggered_by,
        timestamp: ctx.timestamp,
    };

    match ctx.db.sound_event().try_insert(sound_event) {
        Ok(inserted) => {
            log::debug!("Sound event {} emitted: {} at ({:.1}, {:.1}) by {:?}", 
                       inserted.id, inserted.filename, pos_x, pos_y, triggered_by);
            Ok(())
        }
        Err(e) => {
            log::error!("Failed to emit sound event: {:?}", e);
            Err("Failed to emit sound event".to_string())
        }
    }
}

/// Emit a sound at a player's position
pub fn emit_sound_at_player(
    ctx: &ReducerContext,
    sound_type: SoundType,
    player_id: Identity,
    volume: f32,
) -> Result<(), String> {
    use crate::player as PlayerTableTrait;
    
    let player = ctx.db.player().identity().find(player_id)
        .ok_or_else(|| "Player not found for sound emission".to_string())?;
    
    emit_sound_at_position(ctx, sound_type, player.position_x, player.position_y, volume, player_id)
}

/// Initialize the sound event cleanup system
pub fn init_sound_cleanup_system(ctx: &ReducerContext) -> Result<(), String> {
    let cleanup_interval = TimeDuration::from_micros(10_000_000); // Clean up every 10 seconds
    
    let cleanup_schedule = SoundEventCleanupSchedule {
        schedule_id: 0,
        scheduled_at: cleanup_interval.into(), // Periodic cleanup
    };

    match ctx.db.sound_event_cleanup_schedule().try_insert(cleanup_schedule) {
        Ok(_) => {
            log::info!("Sound event cleanup system initialized");
            Ok(())
        }
        Err(e) => {
            log::error!("Failed to initialize sound cleanup system: {:?}", e);
            Err("Failed to initialize sound cleanup system".to_string())
        }
    }
}

// --- Convenience Functions for Common Sound Events ---

/// Single line function to emit tree chopping sound
pub fn emit_tree_chop_sound(ctx: &ReducerContext, pos_x: f32, pos_y: f32, player_id: Identity) {
    log::info!("🔊 EMITTING TREE CHOP SOUND at ({:.1}, {:.1}) by player {:?}", pos_x, pos_y, player_id);
    if let Err(e) = emit_sound_at_position(ctx, SoundType::TreeChop, pos_x, pos_y, 0.8, player_id) {
        log::error!("Failed to emit tree chop sound: {}", e);
    }
}

/// Single line function to emit tree creaking sound (when about to fall)
pub fn emit_tree_creaking_sound(ctx: &ReducerContext, pos_x: f32, pos_y: f32, player_id: Identity) {
    log::info!("🔊 EMITTING TREE CREAKING SOUND at ({:.1}, {:.1}) by player {:?}", pos_x, pos_y, player_id);
    if let Err(e) = emit_sound_at_position_with_distance(ctx, SoundType::TreeCreaking, pos_x, pos_y, 3.0, 700.0, player_id) {
        log::error!("Failed to emit tree creaking sound: {}", e);
    }
}

/// Single line function to emit tree falling sound (when tree dies)
pub fn emit_tree_falling_sound(ctx: &ReducerContext, pos_x: f32, pos_y: f32, player_id: Identity) {
    log::info!("🔊 EMITTING TREE FALLING SOUND at ({:.1}, {:.1}) by player {:?}", pos_x, pos_y, player_id);
    if let Err(e) = emit_sound_at_position_with_distance(ctx, SoundType::TreeFalling, pos_x, pos_y, 1.5, 900.0, player_id) {
        log::error!("Failed to emit tree falling sound: {}", e);
    }
}

/// Single line function to emit stone hit sound  
pub fn emit_stone_hit_sound(ctx: &ReducerContext, pos_x: f32, pos_y: f32, player_id: Identity) {
    log::info!("🔊 EMITTING STONE HIT SOUND at ({:.1}, {:.1}) by player {:?}", pos_x, pos_y, player_id);
    if let Err(e) = emit_sound_at_position(ctx, SoundType::StoneHit, pos_x, pos_y, 0.8, player_id) {
        log::error!("Failed to emit stone hit sound: {}", e);
    }
}

/// Single line function to emit stone destroyed sound (when stone dies)
pub fn emit_stone_destroyed_sound(ctx: &ReducerContext, pos_x: f32, pos_y: f32, player_id: Identity) {
    log::info!("🔊 EMITTING STONE DESTROYED SOUND at ({:.1}, {:.1}) by player {:?}", pos_x, pos_y, player_id);
    if let Err(e) = emit_sound_at_position_with_distance(ctx, SoundType::StoneDestroyed, pos_x, pos_y, 1.3, 800.0, player_id) {
        log::error!("Failed to emit stone destroyed sound: {}", e);
    }
}

/// Single line function to emit plant harvest sound (for picking up resource nodes)
pub fn emit_harvest_plant_sound(ctx: &ReducerContext, pos_x: f32, pos_y: f32, player_id: Identity) {
    log::info!("🔊 EMITTING HARVEST PLANT SOUND at ({:.1}, {:.1}) by player {:?}", pos_x, pos_y, player_id);
    if let Err(e) = emit_sound_at_position(ctx, SoundType::HarvestPlant, pos_x, pos_y, 1.5, player_id) {
        log::error!("Failed to emit harvest plant sound: {}", e);
    }
}

/// Single line function to emit plant seed sound (for planting seeds)
pub fn emit_plant_seed_sound(ctx: &ReducerContext, pos_x: f32, pos_y: f32, player_id: Identity) {
    log::info!("🔊 EMITTING PLANT SEED SOUND at ({:.1}, {:.1}) by player {:?}", pos_x, pos_y, player_id);
    if let Err(e) = emit_sound_at_position_with_distance(ctx, SoundType::PlantSeed, pos_x, pos_y, 5.4, 300.0, player_id) {
        log::error!("Failed to emit plant seed sound: {}", e);
    }
}

/// Single line function to emit pickup item sound (for picking up dropped items)
pub fn emit_pickup_item_sound(ctx: &ReducerContext, pos_x: f32, pos_y: f32, player_id: Identity) {
    log::info!("🔊 EMITTING PICKUP ITEM SOUND at ({:.1}, {:.1}) by player {:?}", pos_x, pos_y, player_id);
    if let Err(e) = emit_sound_at_position_with_distance(ctx, SoundType::PickupItem, pos_x, pos_y, 1.0, 400.0, player_id) {
        log::error!("Failed to emit pickup item sound: {}", e);
    }
}

 