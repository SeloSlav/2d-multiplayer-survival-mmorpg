use spacetimedb::{table, Identity, Timestamp, ReducerContext, Table, reducer, SpacetimeType, ScheduleAt, TimeDuration};
use rand::Rng;

// --- Sound Event Types ---

/// Types of sound events that can be triggered
#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum SoundType {
    TreeChop,     // tree_chop.mp3, tree_chop1.mp3, tree_chop2.mp3 (3 variations)
    TreeCreaking, // tree_creaking.mp3 (1 variation - plays when tree is about to fall)
    TreeFalling,  // tree_falling.mp3 (1 variation - plays when tree reaches 0 health)
    StoneHit,     // stone_hit.mp3, stone_hit1.mp3, stone_hit2.mp3 (3 variations)
    StoneDestroyed, // stone_destroyed.mp3 (1 variation - plays when stone reaches 0 health)
    HarvestPlant, // harvest_plant.mp3 (1 variation - for picking up resource nodes)
    PlantSeed,    // plant_seed.mp3 (1 variation - for planting seeds)
    PickupItem,   // item_pickup.mp3 (1 variation - for item pickup)
    CampfireLooping, // campfire_looping.mp3 (1 variation - continuous looping sound)
    LanternLooping,  // lantern_looping.mp3 (1 variation - continuous looping sound)
    Repair,       // repair.mp3 (1 variation - for successful repairs)
    RepairFail,   // repair_fail.mp3 (1 variation - for failed repair attempts)
    HeavyStormRain, // rain_heavy_storm.mp3 (1 variation - continuous heavy rain sound during storms)
    NormalRain,     // rain_normal.mp3 (1 variation - continuous normal rain sound during light/moderate rain)
    DrinkingWater,  // drinking_water.mp3 (1 variation - for drinking water from sources)
    ThrowingUp,     // throwing_up.mp3 (1 variation - for drinking salt water or eating poisonous food)
    EatingFood,     // eating_food.mp3 (1 variation - for eating food items)
    WateringCrops,  // watering_crops.mp3 (1 variation - for watering plants with water containers)
    FillingContainer, // filling_container.mp3 (1 variation - for filling water containers)
    MeleeHitSharp,  // melee_hit_sharp.mp3 (1 variation - for sharp melee weapon hits on players/corpses)
    SpearHit,       // spear_hit.mp3 (1 variation - for wooden/stone spear hits on players/corpses)
    TorchHit,       // torch_hit.mp3 (1 variation - for torch hits on players/corpses)
    TorchHitLit,    // torch_hit_lit.mp3 (1 variation - for lit torch hits on players/corpses, plays with TorchHit)
    LightTorch,     // light_torch.mp3 (1 variation - when lighting a torch)
    ExtinguishTorch, // extinguish_torch.mp3 (1 variation - when extinguishing a torch)
    MeleeHitBlunt,  // melee_hit_blunt.mp3 (1 variation - for blunt weapon hits on players/corpses)
    WeaponSwing,    // weapon_swing.mp3 (1 variation - for all weapon swings)
    ArrowHit,       // arrow_hit.mp3 (1 variation - when arrows hit players/corpses)
    ShootBow,       // shoot_bow.mp3 (1 variation - when hunting bow is fired)
    ShootCrossbow,  // shoot_crossbow.mp3 (1 variation - when crossbow is fired)
    Bandaging,      // bandaging.mp3 (1 variation - when player starts bandaging, stops if interrupted)
    StopBandaging,  // Special signal to stop bandaging sound
    BarrelHit,      // barrel_hit.mp3 (1 variation - when barrels are hit but not destroyed)
    BarrelDestroyed, // barrel_destroyed.mp3 (1 variation - when barrels are destroyed)
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
            SoundType::CampfireLooping => "campfire_looping",
            SoundType::LanternLooping => "lantern_looping",
            SoundType::Repair => "repair",
            SoundType::RepairFail => "repair_fail",
            SoundType::HeavyStormRain => "rain_heavy_storm",
            SoundType::NormalRain => "rain_normal",
            SoundType::DrinkingWater => "drinking_water",
            SoundType::ThrowingUp => "throwing_up",
            SoundType::EatingFood => "eating_food",
            SoundType::WateringCrops => "watering_crops",
            SoundType::FillingContainer => "filling_container",
            SoundType::MeleeHitSharp => "melee_hit_sharp",
            SoundType::SpearHit => "spear_hit",
            SoundType::TorchHit => "torch_hit",
            SoundType::TorchHitLit => "torch_hit_lit",
            SoundType::LightTorch => "light_torch",
            SoundType::ExtinguishTorch => "extinguish_torch",
            SoundType::MeleeHitBlunt => "melee_hit_blunt",
            SoundType::WeaponSwing => "weapon_swing",
            SoundType::ArrowHit => "arrow_hit",
            SoundType::ShootBow => "shoot_bow",
            SoundType::ShootCrossbow => "shoot_crossbow",
            SoundType::Bandaging => "bandaging",
            SoundType::StopBandaging => "stop_bandaging",
            SoundType::BarrelHit => "barrel_hit",
            SoundType::BarrelDestroyed => "barrel_destroyed",
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
            SoundType::CampfireLooping => 1, // campfire_looping.ogg (single variation)
            SoundType::LanternLooping => 1, // lantern_looping.ogg (single variation)
            SoundType::Repair => 1, // repair.ogg (single variation)
            SoundType::RepairFail => 1, // repair_fail.ogg (single variation)
            SoundType::HeavyStormRain => 1,
            SoundType::NormalRain => 1, // rain_heavy_storm.ogg (single variation)
            SoundType::DrinkingWater => 1,
            SoundType::ThrowingUp => 1,
            SoundType::EatingFood => 1,
            SoundType::WateringCrops => 1,
            SoundType::FillingContainer => 1,
            SoundType::MeleeHitSharp => 1,
            SoundType::SpearHit => 1,
            SoundType::TorchHit => 1,
            SoundType::TorchHitLit => 1,
            SoundType::LightTorch => 1,
            SoundType::ExtinguishTorch => 1,
            SoundType::MeleeHitBlunt => 1,
            SoundType::WeaponSwing => 1,
            SoundType::ArrowHit => 1,
            SoundType::ShootBow => 1,
            SoundType::ShootCrossbow => 1,
            SoundType::Bandaging => 1,
            SoundType::StopBandaging => 1,
            SoundType::BarrelHit => 1,
            SoundType::BarrelDestroyed => 1,
        }
    }

    /// Generate the full filename with random variation
    pub fn get_random_filename(&self, rng: &mut impl Rng) -> String {
        let base = self.get_base_filename();
        let variation_count = self.get_variation_count();
        
        if variation_count <= 1 {
            format!("{}.mp3", base)
        } else {
            let variation = rng.gen_range(0..variation_count);
            if variation == 0 {
                format!("{}.mp3", base)
            } else {
                format!("{}{}.mp3", base, variation)
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
    pub filename: String,        // e.g., "tree_chop2.mp3"
    pub pos_x: f32,             // Position where sound occurs
    pub pos_y: f32,
    pub volume: f32,            // 0.0 to 1.0
    pub max_distance: f32,      // Maximum distance to hear sound
    pub triggered_by: Identity, // Player who triggered the sound
    pub timestamp: Timestamp,
}

/// Continuous sound table - tracks active looping sounds (campfires, lanterns, etc.)
#[table(name = continuous_sound, public)]
#[derive(Clone, Debug)]
pub struct ContinuousSound {
    #[primary_key]
    pub object_id: u64,         // ID of the object making the sound (campfire ID, lantern ID, etc.)
    pub sound_type: SoundType,  // Type of looping sound
    pub filename: String,       // e.g., "campfire_looping.mp3"
    pub pos_x: f32,            // Position where sound occurs
    pub pos_y: f32,
    pub volume: f32,           // Volume level
    pub max_distance: f32,     // Maximum distance to hear sound
    pub is_active: bool,       // Whether the sound should be playing
    pub created_at: Timestamp, // When this continuous sound was created
    pub updated_at: Timestamp, // Last time this sound was updated
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
    // log::info!("🔊 EMITTING TREE CHOP SOUND at ({:.1}, {:.1}) by player {:?}", pos_x, pos_y, player_id);
    if let Err(e) = emit_sound_at_position_with_distance(ctx, SoundType::TreeChop, pos_x, pos_y, 0.8, 1050.0, player_id) {
        log::error!("Failed to emit tree chop sound: {}", e);
    }
}

/// Single line function to emit tree creaking sound (when about to fall)
pub fn emit_tree_creaking_sound(ctx: &ReducerContext, pos_x: f32, pos_y: f32, player_id: Identity) {
    // log::info!("🔊 EMITTING TREE CREAKING SOUND at ({:.1}, {:.1}) by player {:?}", pos_x, pos_y, player_id);
    if let Err(e) = emit_sound_at_position_with_distance(ctx, SoundType::TreeCreaking, pos_x, pos_y, 3.0, 1050.0, player_id) {
        log::error!("Failed to emit tree creaking sound: {}", e);
    }
}

/// Single line function to emit tree falling sound (when tree dies)
pub fn emit_tree_falling_sound(ctx: &ReducerContext, pos_x: f32, pos_y: f32, player_id: Identity) {
    // log::info!("🔊 EMITTING TREE FALLING SOUND at ({:.1}, {:.1}) by player {:?}", pos_x, pos_y, player_id);
    if let Err(e) = emit_sound_at_position_with_distance(ctx, SoundType::TreeFalling, pos_x, pos_y, 1.5, 1050.0, player_id) {
        log::error!("Failed to emit tree falling sound: {}", e);
    }
}

/// Single line function to emit stone hit sound  
pub fn emit_stone_hit_sound(ctx: &ReducerContext, pos_x: f32, pos_y: f32, player_id: Identity) {
    // log::info!("🔊 EMITTING STONE HIT SOUND at ({:.1}, {:.1}) by player {:?}", pos_x, pos_y, player_id);
    if let Err(e) = emit_sound_at_position_with_distance(ctx, SoundType::StoneHit, pos_x, pos_y, 0.8, 1050.0, player_id) {
        log::error!("Failed to emit stone hit sound: {}", e);
    }
}

/// Single line function to emit stone destroyed sound (when stone dies)
pub fn emit_stone_destroyed_sound(ctx: &ReducerContext, pos_x: f32, pos_y: f32, player_id: Identity) {
    // log::info!("🔊 EMITTING STONE DESTROYED SOUND at ({:.1}, {:.1}) by player {:?}", pos_x, pos_y, player_id);
    if let Err(e) = emit_sound_at_position_with_distance(ctx, SoundType::StoneDestroyed, pos_x, pos_y, 1.3, 1050.0, player_id) {
        log::error!("Failed to emit stone destroyed sound: {}", e);
    }
}

/// Single line function to emit plant harvest sound (for picking up resource nodes)
pub fn emit_harvest_plant_sound(ctx: &ReducerContext, pos_x: f32, pos_y: f32, player_id: Identity) {
    // log::info!("🔊 EMITTING HARVEST PLANT SOUND at ({:.1}, {:.1}) by player {:?}", pos_x, pos_y, player_id);
    if let Err(e) = emit_sound_at_position_with_distance(ctx, SoundType::HarvestPlant, pos_x, pos_y, 1.5, 525.0, player_id) {
        log::error!("Failed to emit harvest plant sound: {}", e);
    }
}

/// Single line function to emit plant seed sound (for planting seeds)
pub fn emit_plant_seed_sound(ctx: &ReducerContext, pos_x: f32, pos_y: f32, player_id: Identity) {
    // log::info!("🔊 EMITTING PLANT SEED SOUND at ({:.1}, {:.1}) by player {:?}", pos_x, pos_y, player_id);
    if let Err(e) = emit_sound_at_position_with_distance(ctx, SoundType::PlantSeed, pos_x, pos_y, 5.4, 525.0, player_id) {
        log::error!("Failed to emit plant seed sound: {}", e);
    }
}

/// Single line function to emit pickup item sound (for picking up dropped items)
pub fn emit_pickup_item_sound(ctx: &ReducerContext, pos_x: f32, pos_y: f32, player_id: Identity) {
    if let Err(e) = emit_sound_at_position(ctx, SoundType::PickupItem, pos_x, pos_y, 0.8, player_id) {
        log::warn!("Failed to emit pickup item sound: {}", e);
    }
}

/// Helper function to emit drinking water sound
pub fn emit_drinking_water_sound(ctx: &ReducerContext, pos_x: f32, pos_y: f32, player_id: Identity) {
    if let Err(e) = emit_sound_at_position(ctx, SoundType::DrinkingWater, pos_x, pos_y, 0.7, player_id) {
        log::warn!("Failed to emit drinking water sound: {}", e);
    }
}

/// Helper function to emit throwing up sound (for salt water drinking or food poisoning)
pub fn emit_throwing_up_sound(ctx: &ReducerContext, pos_x: f32, pos_y: f32, player_id: Identity) {
    if let Err(e) = emit_sound_at_position(ctx, SoundType::ThrowingUp, pos_x, pos_y, 0.8, player_id) {
        log::warn!("Failed to emit throwing up sound: {}", e);
    }
}

/// Helper function to emit eating food sound
pub fn emit_eating_food_sound(ctx: &ReducerContext, pos_x: f32, pos_y: f32, player_id: Identity) {
    if let Err(e) = emit_sound_at_position(ctx, SoundType::EatingFood, pos_x, pos_y, 0.7, player_id) {
        log::warn!("Failed to emit eating food sound: {}", e);
    }
}

/// Helper function to emit watering crops sound
pub fn emit_watering_sound(ctx: &ReducerContext, pos_x: f32, pos_y: f32, player_id: Identity) {
    if let Err(e) = emit_sound_at_position(ctx, SoundType::WateringCrops, pos_x, pos_y, 0.8, player_id) {
        log::warn!("Failed to emit watering sound: {}", e);
    }
}

/// Helper function to emit filling container sound
pub fn emit_filling_container_sound(ctx: &ReducerContext, pos_x: f32, pos_y: f32, player_id: Identity) {
    if let Err(e) = emit_sound_at_position(ctx, SoundType::FillingContainer, pos_x, pos_y, 1.3, player_id) {
        log::warn!("Failed to emit filling container sound: {}", e);
    }
}

/// Emit successful repair sound
pub fn emit_repair_sound(ctx: &ReducerContext, pos_x: f32, pos_y: f32, player_id: Identity) {
    // log::info!("🔧 EMITTING REPAIR SOUND at ({:.1}, {:.1}) by player {:?}", pos_x, pos_y, player_id);
    if let Err(e) = emit_sound_at_position_with_distance(ctx, SoundType::Repair, pos_x, pos_y, 1.2, 525.0, player_id) {
        log::error!("Failed to emit repair sound: {}", e);
    }
}

/// Emit repair failure sound (when repair fails due to insufficient resources, etc.)
pub fn emit_repair_fail_sound(ctx: &ReducerContext, pos_x: f32, pos_y: f32, player_id: Identity) {
    let _ = emit_sound_at_position_with_distance(ctx, SoundType::RepairFail, pos_x, pos_y, 1.0, 525.0, player_id);
}

/// Emit a melee hit sharp sound (for stone hatchet, stone pickaxe hitting players/corpses)
pub fn emit_melee_hit_sharp_sound(ctx: &ReducerContext, pos_x: f32, pos_y: f32, player_id: Identity) {
    let _ = emit_sound_at_position_with_distance(ctx, SoundType::MeleeHitSharp, pos_x, pos_y, 1.4, 700.0, player_id);
}

/// Emit a spear hit sound (for wooden/stone spear hitting players/corpses)
pub fn emit_spear_hit_sound(ctx: &ReducerContext, pos_x: f32, pos_y: f32, player_id: Identity) {
    let _ = emit_sound_at_position_with_distance(ctx, SoundType::SpearHit, pos_x, pos_y, 1.3, 650.0, player_id);
}

/// Emit a torch hit sound (for torch hitting players/corpses)
pub fn emit_torch_hit_sound(ctx: &ReducerContext, pos_x: f32, pos_y: f32, player_id: Identity) {
    let _ = emit_sound_at_position_with_distance(ctx, SoundType::TorchHit, pos_x, pos_y, 1.1, 600.0, player_id);
}

/// Emit a lit torch hit sound (for lit torch hitting players/corpses)
pub fn emit_torch_hit_lit_sound(ctx: &ReducerContext, pos_x: f32, pos_y: f32, player_id: Identity) {
    let _ = emit_sound_at_position_with_distance(ctx, SoundType::TorchHitLit, pos_x, pos_y, 1.2, 650.0, player_id);
}

/// Emit a torch hit sound combination (torch_hit + torch_hit_lit if lit)
pub fn emit_torch_hit_combined_sound(ctx: &ReducerContext, pos_x: f32, pos_y: f32, player_id: Identity, is_lit: bool) {
    // Always play the base torch hit sound
    let _ = emit_sound_at_position_with_distance(ctx, SoundType::TorchHit, pos_x, pos_y, 1.1, 600.0, player_id);
    
    // If torch is lit, also play the lit version
    if is_lit {
        let _ = emit_sound_at_position_with_distance(ctx, SoundType::TorchHitLit, pos_x, pos_y, 1.2, 650.0, player_id);
    }
}

/// Emit a torch lighting sound
pub fn emit_light_torch_sound(ctx: &ReducerContext, pos_x: f32, pos_y: f32, player_id: Identity) {
    let _ = emit_sound_at_position_with_distance(ctx, SoundType::LightTorch, pos_x, pos_y, 1.0, 500.0, player_id);
}

/// Emit a torch extinguishing sound
pub fn emit_extinguish_torch_sound(ctx: &ReducerContext, pos_x: f32, pos_y: f32, player_id: Identity) {
    let _ = emit_sound_at_position_with_distance(ctx, SoundType::ExtinguishTorch, pos_x, pos_y, 0.9, 450.0, player_id);
}

/// Emit a blunt melee hit sound (for blunt weapons hitting players/corpses)
pub fn emit_melee_hit_blunt_sound(ctx: &ReducerContext, pos_x: f32, pos_y: f32, player_id: Identity) {
    let _ = emit_sound_at_position_with_distance(ctx, SoundType::MeleeHitBlunt, pos_x, pos_y, 1.2, 600.0, player_id);
}

/// Emit a weapon swing sound (for all weapon swings)
pub fn emit_weapon_swing_sound(ctx: &ReducerContext, pos_x: f32, pos_y: f32, player_id: Identity) {
    let _ = emit_sound_at_position_with_distance(ctx, SoundType::WeaponSwing, pos_x, pos_y, 0.8, 400.0, player_id);
}

/// Emit an arrow hit sound (when arrows hit players/corpses)
pub fn emit_arrow_hit_sound(ctx: &ReducerContext, pos_x: f32, pos_y: f32, player_id: Identity) {
    let _ = emit_sound_at_position_with_distance(ctx, SoundType::ArrowHit, pos_x, pos_y, 1.1, 550.0, player_id);
}

/// Emit a bow shooting sound (when hunting bow is fired)
pub fn emit_shoot_bow_sound(ctx: &ReducerContext, pos_x: f32, pos_y: f32, player_id: Identity) {
    let _ = emit_sound_at_position_with_distance(ctx, SoundType::ShootBow, pos_x, pos_y, 1.0, 800.0, player_id);
}

/// Emit a crossbow shooting sound (when crossbow is fired)
pub fn emit_shoot_crossbow_sound(ctx: &ReducerContext, pos_x: f32, pos_y: f32, player_id: Identity) {
    let _ = emit_sound_at_position_with_distance(ctx, SoundType::ShootCrossbow, pos_x, pos_y, 1.1, 850.0, player_id);
}

/// Emit a bandaging sound (when player starts bandaging)
pub fn emit_bandaging_sound(ctx: &ReducerContext, pos_x: f32, pos_y: f32, player_id: Identity) {
    let _ = emit_sound_at_position_with_distance(ctx, SoundType::Bandaging, pos_x, pos_y, 0.8, 300.0, player_id);
}

/// Stop bandaging sound (when bandaging is interrupted)
pub fn stop_bandaging_sound(ctx: &ReducerContext, pos_x: f32, pos_y: f32, player_id: Identity) {
    let _ = emit_sound_at_position_with_distance(ctx, SoundType::StopBandaging, pos_x, pos_y, 0.0, 300.0, player_id);
}

/// Emit a barrel hit sound (when barrels are hit but not destroyed)
pub fn emit_barrel_hit_sound(ctx: &ReducerContext, pos_x: f32, pos_y: f32, player_id: Identity) {
    let _ = emit_sound_at_position_with_distance(ctx, SoundType::BarrelHit, pos_x, pos_y, 1.0, 600.0, player_id);
}

/// Emit a barrel destroyed sound (when barrels are completely destroyed)
pub fn emit_barrel_destroyed_sound(ctx: &ReducerContext, pos_x: f32, pos_y: f32, player_id: Identity) {
    let _ = emit_sound_at_position_with_distance(ctx, SoundType::BarrelDestroyed, pos_x, pos_y, 1.3, 700.0, player_id);
}

/// Emit a global sound that plays to all clients at full volume regardless of position
/// This is used for weather effects like lightning/thunder that should be heard everywhere
pub fn emit_global_sound(
    ctx: &ReducerContext,
    sound_type: SoundType,
    volume: f32,
) -> Result<(), String> {
    let mut rng = ctx.rng();
    let filename = sound_type.get_random_filename(&mut rng);
    
    let sound_event = SoundEvent {
        id: 0, // Auto-incremented
        sound_type,
        filename,
        pos_x: 0.0, // Position doesn't matter for global sounds
        pos_y: 0.0,
        volume: volume.max(0.0),
        max_distance: f32::MAX, // Infinite distance - heard everywhere
        triggered_by: ctx.identity(), // Triggered by the server/module itself
        timestamp: ctx.timestamp,
    };

    match ctx.db.sound_event().try_insert(sound_event) {
        Ok(inserted) => {
            log::info!("Global sound event {} emitted: {} at volume {:.1}", 
                       inserted.id, inserted.filename, volume);
            Ok(())
        }
        Err(e) => {
            log::error!("Failed to emit global sound event: {:?}", e);
            Err("Failed to emit global sound event".to_string())
        }
    }
}

/// Start heavy storm rain continuous sound globally
pub fn start_heavy_storm_rain_sound(ctx: &ReducerContext) -> Result<(), String> {
    const STORM_RAIN_OBJECT_ID: u64 = u64::MAX; // Use max value as a unique ID for global storm rain
    
    // Check if heavy storm rain sound is already active
    if ctx.db.continuous_sound().object_id().find(STORM_RAIN_OBJECT_ID).is_some() {
        log::debug!("Heavy storm rain sound already active");
        return Ok(());
    }
    
    let continuous_sound = ContinuousSound {
        object_id: STORM_RAIN_OBJECT_ID,
        sound_type: SoundType::HeavyStormRain,
        filename: "rain_heavy_storm.mp3".to_string(),
        pos_x: 0.0, // Global sound, position doesn't matter
        pos_y: 0.0,
        volume: 1.2, // Loud enough to be atmospheric
        max_distance: f32::MAX, // Infinite distance - heard everywhere
        is_active: true,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
    };
    
    match ctx.db.continuous_sound().try_insert(continuous_sound) {
        Ok(_) => {
            log::info!("🌧️ Started heavy storm rain sound globally");
            Ok(())
        }
        Err(e) => {
            log::error!("Failed to start heavy storm rain sound: {:?}", e);
            Err("Failed to start heavy storm rain sound".to_string())
        }
    }
}

/// Stop heavy storm rain continuous sound
pub fn stop_heavy_storm_rain_sound(ctx: &ReducerContext) {
    const STORM_RAIN_OBJECT_ID: u64 = u64::MAX;
    
    if ctx.db.continuous_sound().object_id().delete(STORM_RAIN_OBJECT_ID) {
        log::info!("🌧️ Stopped heavy storm rain sound");
    } else {
        log::debug!("Heavy storm rain sound was not active");
    }
}

/// Start normal rain continuous sound globally (for light and moderate rain)
pub fn start_normal_rain_sound(ctx: &ReducerContext) -> Result<(), String> {
    const NORMAL_RAIN_OBJECT_ID: u64 = u64::MAX - 1; // Use max-1 value as a unique ID for global normal rain
    
    // Check if normal rain sound is already active
    if ctx.db.continuous_sound().object_id().find(NORMAL_RAIN_OBJECT_ID).is_some() {
        log::debug!("Normal rain sound already active");
        return Ok(());
    }
    
    let continuous_sound = ContinuousSound {
        object_id: NORMAL_RAIN_OBJECT_ID,
        sound_type: SoundType::NormalRain,
        filename: "rain_normal.mp3".to_string(),
        pos_x: 0.0, // Global sound, position doesn't matter
        pos_y: 0.0,
        volume: 0.8, // Quieter than heavy storm rain
        max_distance: f32::MAX, // Infinite distance - heard everywhere
        is_active: true,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
    };
    
    match ctx.db.continuous_sound().try_insert(continuous_sound) {
        Ok(_) => {
            log::info!("🌦️ Started normal rain sound globally");
            Ok(())
        }
        Err(e) => {
            log::error!("Failed to start normal rain sound: {:?}", e);
            Err("Failed to start normal rain sound".to_string())
        }
    }
}

/// Stop normal rain continuous sound
pub fn stop_normal_rain_sound(ctx: &ReducerContext) {
    const NORMAL_RAIN_OBJECT_ID: u64 = u64::MAX - 1;
    
    if ctx.db.continuous_sound().object_id().delete(NORMAL_RAIN_OBJECT_ID) {
        log::info!("🌦️ Stopped normal rain sound");
    } else {
        log::debug!("Normal rain sound was not active");
    }
}

// --- Continuous/Looping Sound Management ---

/// Start a continuous looping sound for an object
pub fn start_continuous_sound(
    ctx: &ReducerContext,
    object_id: u64,
    sound_type: SoundType,
    pos_x: f32,
    pos_y: f32,
    volume: f32,
    max_distance: f32,
) -> Result<(), String> {
    let mut rng = ctx.rng();
    let filename = sound_type.get_random_filename(&mut rng);
    let continuous_sounds_table = ctx.db.continuous_sound();
    
    // Check if a continuous sound already exists for this object
    if let Some(mut existing_sound) = continuous_sounds_table.object_id().find(object_id) {
        // Update the existing sound instead of inserting a new one
        existing_sound.sound_type = sound_type;
        existing_sound.filename = filename.clone();
        existing_sound.pos_x = pos_x;
        existing_sound.pos_y = pos_y;
        existing_sound.volume = volume.max(0.0);
        existing_sound.max_distance = max_distance;
        existing_sound.is_active = true;
        existing_sound.updated_at = ctx.timestamp;
        
        continuous_sounds_table.object_id().update(existing_sound);
        // log::info!("🔊 RESTARTED CONTINUOUS SOUND: {} for object {} at ({:.1}, {:.1})", 
        //           filename, object_id, pos_x, pos_y);
        Ok(())
    } else {
        // Create a new continuous sound entry
        let continuous_sound = ContinuousSound {
            object_id,
            sound_type, 
            filename: filename.clone(),
            pos_x,
            pos_y,
            volume: volume.max(0.0),
            max_distance,
            is_active: true,
            created_at: ctx.timestamp,
            updated_at: ctx.timestamp,
        };

        match continuous_sounds_table.try_insert(continuous_sound) {
            Ok(_) => {
                // log::info!("🔊 STARTED NEW CONTINUOUS SOUND: {} for object {} at ({:.1}, {:.1})", 
                //           filename, object_id, pos_x, pos_y);
                Ok(())
            }
            Err(e) => {
                log::error!("Failed to start continuous sound for object {}: {:?}", object_id, e);
                Err("Failed to start continuous sound".to_string())
            }
        }
    }
}

/// Stop a continuous looping sound for an object
pub fn stop_continuous_sound(ctx: &ReducerContext, object_id: u64) -> Result<(), String> {
    let continuous_sounds_table = ctx.db.continuous_sound();
    
    if let Some(mut sound) = continuous_sounds_table.object_id().find(object_id) {
        sound.is_active = false;
        sound.updated_at = ctx.timestamp;
        continuous_sounds_table.object_id().update(sound);
        // log::info!("🔊 STOPPED CONTINUOUS SOUND for object {}", object_id);
        Ok(())
    } else {
        log::warn!("Attempted to stop continuous sound for object {} but it wasn't found", object_id);
        Ok(()) // Don't error if sound doesn't exist
    }
}

/// Update the position of a continuous sound (for moving objects)
pub fn update_continuous_sound_position(
    ctx: &ReducerContext,
    object_id: u64,
    pos_x: f32,
    pos_y: f32,
) -> Result<(), String> {
    let continuous_sounds_table = ctx.db.continuous_sound();
    
    if let Some(mut sound) = continuous_sounds_table.object_id().find(object_id) {
        if sound.pos_x != pos_x || sound.pos_y != pos_y {
            sound.pos_x = pos_x;
            sound.pos_y = pos_y;
            sound.updated_at = ctx.timestamp;
            continuous_sounds_table.object_id().update(sound);
            log::debug!("Updated continuous sound position for object {} to ({:.1}, {:.1})", object_id, pos_x, pos_y);
        }
        Ok(())
    } else {
        log::warn!("Attempted to update position for continuous sound object {} but it wasn't found", object_id);
        Ok(()) // Don't error if sound doesn't exist
    }
}

/// Remove a continuous sound completely (when object is deleted)
pub fn remove_continuous_sound(ctx: &ReducerContext, object_id: u64) -> Result<(), String> {
    let continuous_sounds_table = ctx.db.continuous_sound();
    
    if continuous_sounds_table.object_id().delete(object_id) {
        // log::info!("🔊 REMOVED CONTINUOUS SOUND for object {}", object_id);
    } else {
        log::debug!("Attempted to remove continuous sound for object {} but it wasn't found", object_id);
    }
    Ok(())
}

// --- Convenience Functions for Campfire and Lantern Sounds ---

// Helper function to create unique object IDs to prevent conflicts between different object types
fn create_unique_object_id(object_type: &str, object_id: u64) -> u64 {
    // Use a simple hash-based approach to create unique IDs
    // This ensures campfire ID 1 and lantern ID 1 don't conflict
    let type_hash = match object_type {
        "campfire" => 1_000_000_000_u64, // Campfires start at 1 billion
        "lantern" => 2_000_000_000_u64,  // Lanterns start at 2 billion
        _ => 0_u64, // Default for unknown types
    };
    type_hash + object_id
}

/// Start campfire looping sound
pub fn start_campfire_sound(ctx: &ReducerContext, campfire_id: u64, pos_x: f32, pos_y: f32) {
    let unique_id = create_unique_object_id("campfire", campfire_id);
    log::info!("🔥 STARTING CAMPFIRE SOUND for campfire {} (unique_id: {}) at ({:.1}, {:.1})", 
              campfire_id, unique_id, pos_x, pos_y);
    if let Err(e) = start_continuous_sound(ctx, unique_id, SoundType::CampfireLooping, pos_x, pos_y, 1.0, 525.0) {
        log::error!("Failed to start campfire sound: {}", e);
    }
}

/// Stop campfire looping sound
pub fn stop_campfire_sound(ctx: &ReducerContext, campfire_id: u64) {
    let unique_id = create_unique_object_id("campfire", campfire_id);
    log::info!("🔥 STOPPING CAMPFIRE SOUND for campfire {} (unique_id: {})", campfire_id, unique_id);
    if let Err(e) = stop_continuous_sound(ctx, unique_id) {
        log::error!("Failed to stop campfire sound: {}", e);
    }
}

/// Start lantern looping sound
pub fn start_lantern_sound(ctx: &ReducerContext, lantern_id: u64, pos_x: f32, pos_y: f32) {
    let unique_id = create_unique_object_id("lantern", lantern_id);
    log::info!("🏮 STARTING LANTERN SOUND for lantern {} (unique_id: {}) at ({:.1}, {:.1})", 
              lantern_id, unique_id, pos_x, pos_y);
    if let Err(e) = start_continuous_sound(ctx, unique_id, SoundType::LanternLooping, pos_x, pos_y, 1.0, 525.0) {
        log::error!("Failed to start lantern sound: {}", e);
    }
}

/// Stop lantern looping sound
pub fn stop_lantern_sound(ctx: &ReducerContext, lantern_id: u64) {
    let unique_id = create_unique_object_id("lantern", lantern_id);
    log::info!("🏮 STOPPING LANTERN SOUND for lantern {} (unique_id: {})", lantern_id, unique_id);
    if let Err(e) = stop_continuous_sound(ctx, unique_id) {
        log::error!("Failed to stop lantern sound: {}", e);
    }
}

