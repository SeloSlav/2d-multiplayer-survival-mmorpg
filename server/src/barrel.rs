//! # Barrel System (Road, Sea & Beach)
//! 
//! This module handles destructible barrels that spawn in three locations:
//! 1. **Road Barrels** (variants 0-2): Spawn on dirt roads in clusters of 1-3
//! 2. **Sea Barrels** (variants 3-5): Spawn in ocean water around sea stacks (flotsam/cargo crates)
//! 3. **Beach Barrels** (variants 3-5): All sea barrel variants can wash up on beaches
//!
//! All types drop loot when destroyed and respawn after being destroyed.
//!
//! ## Key Features:
//! - Road barrels spawn frequently along dirt roads (~22 clusters on 600x600 map)
//! - Sea barrels (variants 3-5) spawn in ocean water near sea stacks (35% chance per stack, 1-3 barrels)
//! - Beach barrels (variants 3-5) spawn on beach tiles (0.03% density - washed up flotsam)
//! - Cluster spawning with proper spacing (road barrels)
//! - Health-based destruction system
//! - Configurable loot tables (shared between all types)
//! - Automatic respawning after destruction
//! - Collision detection similar to storage boxes

use spacetimedb::{ReducerContext, SpacetimeType, Table, Timestamp, Identity, TimeDuration};
use log;
use rand::Rng;
use std::time::Duration;
use std::collections::{HashMap, HashSet};
use spacetimedb::spacetimedb_lib::ScheduleAt;

// Import necessary items from other modules
use crate::items::item_definition as ItemDefinitionTableTrait;
use crate::player as PlayerTableTrait;
use crate::world_tile as WorldTileTableTrait;
use crate::dropped_item::{create_dropped_item_entity, calculate_drop_position};
use crate::wooden_storage_box::wooden_storage_box;
use crate::{Player, PLAYER_RADIUS, TileType};
use crate::utils::get_distance_squared;
use crate::environment::calculate_chunk_index;

// Constants for barrel system
pub const BARREL_INITIAL_HEALTH: f32 = 50.0; // Less health than storage boxes
pub const BARREL_COLLISION_RADIUS: f32 = 25.0; // Collision radius in pixels (tighter for better accuracy)
pub const BARREL_COLLISION_Y_OFFSET: f32 = 48.0; // Y-offset for collision detection (visual center)
// Buoy (variant 6) is 192x192 - same collision size as standard barrel, offset for visual center
pub const BUOY_COLLISION_RADIUS: f32 = 25.0; // Same as BARREL_COLLISION_RADIUS
pub const BUOY_COLLISION_Y_OFFSET: f32 = 110.0; // Moved down a bit from 124 for better alignment
pub const PLAYER_BARREL_COLLISION_DISTANCE_SQUARED: f32 = (PLAYER_RADIUS + BARREL_COLLISION_RADIUS) * (PLAYER_RADIUS + BARREL_COLLISION_RADIUS);
pub const PLAYER_BARREL_INTERACTION_DISTANCE_SQUARED: f32 = 64.0 * 64.0; // 64 pixels interaction range
pub const BARREL_BARREL_COLLISION_DISTANCE_SQUARED: f32 = (BARREL_COLLISION_RADIUS * 2.0 + 20.0) * (BARREL_COLLISION_RADIUS * 2.0 + 20.0); // Barrels can't overlap

// Spawning constants
pub const BARREL_DENSITY_PERCENT: f32 = 0.001; // 0.1% of total tiles for road density calculation  
pub const MAX_BARREL_SEEDING_ATTEMPTS_FACTOR: u32 = 5; // Attempt factor for finding valid positions
pub const MIN_BARREL_CLUSTER_DISTANCE_SQ: f32 = 250.0 * 250.0; // Minimum distance between clusters (closer spacing for more road encounters)
pub const MIN_BARREL_DISTANCE_SQ: f32 = 60.0 * 60.0; // Minimum distance between individual barrels in cluster
pub const BARREL_RESPAWN_TIME_SECONDS: u32 = 600; // 10 minutes respawn time

// Sea barrel (flotsam/cargo crate) constants
pub const SEA_BARREL_VARIANT_START: u8 = 3; // Variants 3, 4, 5 are sea barrels (with loot)
pub const SEA_BARREL_VARIANT_END: u8 = 6; // Exclusive end for loot barrels (3, 4, 5)
pub const BUOY_VARIANT: u8 = 6; // Indestructible navigational buoy, spawns in outer ocean, no loot
pub const SEA_BARREL_SPAWN_CHANCE_PER_STACK: f32 = 0.35; // 35% chance to spawn 1-3 sea barrels near each sea stack (balanced: visible loot around coastal landmarks)
pub const MIN_SEA_BARREL_DISTANCE_FROM_STACK: f32 = 100.0; // Minimum distance from sea stack center (closer for better density)
pub const MAX_SEA_BARREL_DISTANCE_FROM_STACK: f32 = 350.0; // Maximum distance from sea stack center (wider spread)
pub const MIN_SEA_BARREL_DISTANCE_SQ: f32 = 80.0 * 80.0; // Minimum distance between sea barrels (tighter packing allowed)
pub const SEA_BARREL_OLIVE_PIT_DROP_CHANCE: f32 = 0.01; // Very rare sea-only drop: Olive Pit

// Beach barrel constants (all sea variants 3, 4, 5 can spawn on beaches)
pub const BEACH_BARREL_SPAWN_DENSITY_PERCENT: f32 = 0.0003; // 0.03% of beach tiles get a barrel (washed up flotsam is common)
pub const MIN_BEACH_BARREL_DISTANCE_SQ: f32 = 120.0 * 120.0; // Minimum distance between beach barrels

// Buoy constants (indestructible, no loot, spawn on Sea↔DeepSea ring)
pub const BUOY_TARGET_SPACING_PX: f32 = 4200.0; // Even spacing along ring arc length
pub const BUOY_MIN_COUNT: usize = 12; // Keep minimum ring readability
pub const BUOY_MAX_COUNT: usize = 64; // Hard cap for huge maps
pub const BUOY_COAST_CLEARANCE_TILES: i32 = 14; // Must be far from beaches/islands
pub const MIN_BUOY_DISTANCE_SQ: f32 = 1800.0 * 1800.0; // Enforce even spacing in world-space

// Damage constants
// Note: Damage is determined by weapon type through the combat system
// No fixed damage constant needed - weapons define their own damage via pvp_damage_min/max
pub const BARREL_ATTACK_COOLDOWN_MS: u64 = 1000; // 1 second between attacks (used by damage_barrel for cooldown checks)

/// Density of barrel clusters per map tile. Used to scale clusters with map size.
/// Baseline: 600x600 tiles (360,000) -> 360000 * 0.00006 = ~22 clusters.
/// Road barrels are valuable loot sources - should be common enough to encourage road exploration.
pub const BARREL_CLUSTER_DENSITY_PER_TILE: f32 = 0.00006; // Balanced for engaging road gameplay
/// How many dirt road tiles roughly correspond to one barrel cluster capacity.
/// Used as an upper bound so road-heavy maps don't explode cluster counts.
pub const ROAD_TILES_PER_CLUSTER: f32 = 100.0; // More clusters allowed per road tile count

// Define the main barrel table
#[spacetimedb::table(accessor = barrel, public)]
#[derive(Clone, Debug)]
pub struct Barrel {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub pos_x: f32,
    pub pos_y: f32,
    pub health: f32,
    pub variant: u8, // 0-2 road loot; 3-5 flotsam; 6 buoy; 7-11 natural combat cover
    #[index(btree)]
    pub chunk_index: u32,
    pub last_hit_time: Option<Timestamp>,
    /// When this barrel should respawn. Use Timestamp::UNIX_EPOCH (0) for "not respawning".
    /// This allows efficient btree index range queries: .respawn_at().filter(1..=now)
    #[index(btree)]
    pub respawn_at: Timestamp,
    pub cluster_id: u64, // ID to group barrels that spawned together
    /// Monument barrels are indestructible and placed at monument locations
    pub is_monument: bool,
}

// Loot table definition
#[derive(SpacetimeType, Clone, Debug)]
pub struct BarrelLootEntry {
    pub item_def_id: u64,
    pub min_quantity: u32,
    pub max_quantity: u32,
    pub drop_chance: f32, // 0.0 to 1.0
}

// Schedule table for barrel respawning
#[spacetimedb::table(accessor = barrel_respawn_schedule, scheduled(respawn_destroyed_barrels))]
#[derive(Clone)]
pub struct BarrelRespawnSchedule {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub scheduled_at: ScheduleAt,
}

// --- Loot Table Configuration ---
pub fn get_barrel_loot_table(ctx: &ReducerContext) -> Vec<BarrelLootEntry> {
    let item_defs = ctx.db.item_definition();
    let mut loot_table = Vec::new();
    
    // Define all loot entries as (name, min_qty, max_qty, drop_chance)  
    let loot_definitions = [
        // --- GUARANTEED TIER - Always drops (barrels are a reliable memory shard source) ---
        // Memory shards: LOW quantity but HIGH consistency - barrels are "the shard meta"
        // Players can farm barrels for steady shard income (1-2 per barrel, nearly guaranteed)
        ("Memory Shard", 1, 2, 0.92),          // BALANCED: 1-2 shards at 92% = reliable, consistent source
        
        // --- COMMON TIER (40-65% drop rates) - Basic survival items ---
        ("Rope", 1, 2, 0.50),                  // Essential crafting material
        ("Metal Fragments", 1, 3, 0.45),       // Crafting material - reduced quantity
        ("Wooden Arrow", 2, 5, 0.50),          // Basic ammunition - reduced quantity
        ("Bandage", 1, 2, 0.45),               // Healing consumable
        ("Wood", 15, 30, 0.42),                // Basic crafting material - reduced quantity
        
        // --- UNCOMMON TIER (20-35% drop rates) - Useful items ---
        ("Bone Arrow", 1, 3, 0.28),            // Better ammunition - reduced from 45%
        ("Hollow Reed Arrow", 1, 3, 0.25),     // Special ammunition - reduced from 40%
        ("Stone Hatchet", 1, 1, 0.22),         // Useful tool - reduced from 35%
        ("Torch", 1, 1, 0.20),                 // Utility item - reduced from 30%
        ("Reed Water Bottle", 1, 1, 0.25),     // Water container - reduced from 35%
        ("Tin Can", 1, 2, 0.28),               // Metal source - moved from rare tier
        
        // --- RARE TIER (8-18% drop rates) - Valuable items ---
        ("AK74 Bayonet", 1, 1, 0.12),          // Fast military melee weapon - reduced from 18%
        ("Hunting Bow", 1, 1, 0.08),           // Ranged weapon - reduced from 10%
        ("Fire Arrow", 1, 2, 0.10),            // Special ammunition - reduced quantity
        ("Bush Knife", 1, 1, 0.09),            // Military clearing blade - reduced from 12%
        ("Engineers Maul", 1, 1, 0.08),        // Military engineering tool - reduced from 10%
        ("Plastic Water Jug", 1, 1, 0.09),     // Large water storage - reduced from 12%
        ("Anti-Venom", 1, 1, 0.10),            // Antidote - reduced from 15%
        ("Reed Diver's Helm", 1, 1, 0.06),     // Underwater breathing helmet - moderate low drop
        ("Headlamp", 1, 1, 0.08),              // Light source equipment
        ("Med Kit", 1, 1, 0.08),               // Military first aid kit - better than bandage
        
        // --- VERY RARE TIER (3-6% drop rates) - Premium items ---
        ("Naval Cutlass", 1, 1, 0.05),         // Rare ceremonial naval weapon - reduced from 8%
        
        // --- ULTRA-RARE TIER (1-2% drop rates) - Jackpot items ---
        ("Military Crowbar", 1, 1, 0.02),      // Highest damage weapon in game - reduced from 5%
        ("Scrap Batteries", 1, 1, 0.015),      // Ultra-rare electronics material - reduced from 3%
        ("Makarov PM", 1, 1, 0.01),            // Ultra-rare Soviet pistol - 1% drop rate
        ("PP-91 KEDR", 1, 1, 0.005),           // Extremely rare Soviet SMG - 0.5% drop rate (jackpot)
        ("9x18mm Round", 3, 8, 0.015),         // Ultra-rare pistol/SMG ammunition - 1.5% drop rate
    ];
    
    // Process each loot definition
    for (item_name, min_quantity, max_quantity, drop_chance) in loot_definitions {
        if let Some(item) = item_defs.iter().find(|def| def.name == item_name) {
            loot_table.push(BarrelLootEntry {
                item_def_id: item.id,
                min_quantity,
                max_quantity,
                drop_chance,
            });
        } else {
            log::warn!("[BarrelLoot] {} item not found in database", item_name);
        }
    }
    
    loot_table
}

// --- Helper Functions ---

/// Checks if a position has collision with existing buoys only.
/// Uses BUOY_COLLISION_RADIUS for proportional 144x144 buoy size.
fn has_buoy_collision(ctx: &ReducerContext, pos_x: f32, pos_y: f32) -> bool {
    for barrel in ctx.db.barrel().iter() {
        if barrel.health == 0.0 { continue; }
        if barrel.variant != BUOY_VARIANT { continue; }
        
        let buoy_collision_distance_sq =
            (BUOY_COLLISION_RADIUS * 2.0 + 20.0) * (BUOY_COLLISION_RADIUS * 2.0 + 20.0);
        let dx = pos_x - barrel.pos_x;
        let dy = pos_y - (barrel.pos_y - BUOY_COLLISION_Y_OFFSET);
        let distance_sq = dx * dx + dy * dy;
        if distance_sq < buoy_collision_distance_sq {
            return true;
        }
    }
    false
}

/// Checks if a position has collision with existing barrels
pub fn has_barrel_collision(ctx: &ReducerContext, pos_x: f32, pos_y: f32, exclude_id: Option<u64>) -> bool {
    for barrel in ctx.db.barrel().iter() {
        if barrel.health == 0.0 { continue; } // Skip destroyed barrels
        if let Some(exclude) = exclude_id {
            if barrel.id == exclude { continue; } // Skip the barrel we're checking against
        }

        if let Some(cover) = crate::cover_geometry::profile(barrel.variant) {
            if (pos_x-barrel.pos_x).abs() < cover.width/2.0+BARREL_COLLISION_RADIUS
                && (pos_y-barrel.pos_y).abs() < cover.depth/2.0+BARREL_COLLISION_RADIUS { return true; }
            continue;
        }
        
        let (collision_radius, collision_y_offset) = if barrel.variant == BUOY_VARIANT {
            (BUOY_COLLISION_RADIUS, BUOY_COLLISION_Y_OFFSET)
        } else if barrel.variant == 4 {
            (BARREL_COLLISION_RADIUS * 2.0, BARREL_COLLISION_Y_OFFSET * 2.0)
        } else {
            (BARREL_COLLISION_RADIUS, BARREL_COLLISION_Y_OFFSET)
        };
        let barrel_barrel_collision_distance_sq = (collision_radius * 2.0 + 20.0) * (collision_radius * 2.0 + 20.0);
        
        let dx = pos_x - barrel.pos_x;
        let dy = pos_y - (barrel.pos_y - collision_y_offset);
        let distance_sq = dx * dx + dy * dy;
        
        if distance_sq < barrel_barrel_collision_distance_sq {
            return true;
        }
    }
    false
}

/// Checks if a position has collision with a player (standard barrel size)
pub fn has_player_barrel_collision(ctx: &ReducerContext, pos_x: f32, pos_y: f32) -> bool {
    has_player_barrel_collision_with_size(ctx, pos_x, pos_y, BARREL_COLLISION_RADIUS, BARREL_COLLISION_Y_OFFSET)
}

/// Checks if a position has collision with a player (for buoy spawn - uses buoy size)
pub fn has_player_buoy_collision(ctx: &ReducerContext, pos_x: f32, pos_y: f32) -> bool {
    has_player_barrel_collision_with_size(ctx, pos_x, pos_y, BUOY_COLLISION_RADIUS, BUOY_COLLISION_Y_OFFSET)
}

fn has_player_barrel_collision_with_size(
    ctx: &ReducerContext,
    pos_x: f32,
    pos_y: f32,
    collision_radius: f32,
    collision_y_offset: f32,
) -> bool {
    let min_dist_sq = (PLAYER_RADIUS + collision_radius) * (PLAYER_RADIUS + collision_radius);
    for player in ctx.db.player().iter() {
        if player.is_dead { continue; }
        let dx = pos_x - player.position_x;
        let dy = pos_y - (player.position_y - collision_y_offset);
        if dx * dx + dy * dy < min_dist_sq {
            return true;
        }
    }
    false
}

/// Generates loot drops around a destroyed barrel
/// Guarantees 1 item, max 2 items (like Rust)
fn generate_barrel_loot_drops(ctx: &ReducerContext, barrel_pos_x: f32, barrel_pos_y: f32, barrel_variant: u8) -> Result<(), String> {
    let loot_table = get_barrel_loot_table(ctx);
    const MAX_DROPS_PER_BARREL: usize = 2;
    
    log::info!("[BarrelLoot] Generating loot drops for barrel at ({:.1}, {:.1})", barrel_pos_x, barrel_pos_y);
    
    // FIXED: Roll for ALL items first, then randomly select from successful rolls
    let mut successful_rolls = Vec::new();
    
    // Roll for every item in the loot table (no early breaks!)
    for loot_entry in &loot_table {
        let roll: f32 = ctx.rng().gen();
        if roll <= loot_entry.drop_chance {
            successful_rolls.push(loot_entry);
        }
    }
    
    log::info!("[BarrelLoot] {} items passed their drop chance rolls", successful_rolls.len());
    
    // If we have more successful rolls than max drops, randomly select which ones to actually drop
    let mut items_to_drop = if successful_rolls.len() <= MAX_DROPS_PER_BARREL {
        // All successful rolls can drop
        successful_rolls.clone()
    } else {
        // Randomly select MAX_DROPS_PER_BARREL items from successful rolls
        use rand::seq::SliceRandom;
        let mut rng = ctx.rng();
        let mut shuffled = successful_rolls.clone();
        shuffled.shuffle(&mut rng);
        shuffled.truncate(MAX_DROPS_PER_BARREL);
        shuffled
    };
    
    // GUARANTEE: If no items rolled to drop, force drop 1 common item (barrels always drop something)
    if items_to_drop.is_empty() {
        log::info!("[BarrelLoot] No items rolled to drop, forcing a guaranteed common item drop");
        
        // Find a common tier item (highest drop chances) to guarantee
        let fallback_item = loot_table.iter()
            .filter(|item| item.drop_chance >= 0.40) // Common tier items (40%+ drop chance)
            .next();
            
        if let Some(guaranteed_item) = fallback_item {
            items_to_drop.push(guaranteed_item);
            log::info!("[BarrelLoot] Guaranteed drop: item {}", guaranteed_item.item_def_id);
        } else {
            // Ultimate fallback - use the first item in the table
            if let Some(first_item) = loot_table.first() {
                items_to_drop.push(first_item);
                log::warn!("[BarrelLoot] Using first item as guaranteed drop: item {}", first_item.item_def_id);
            }
        }
    }
    
    let drops_created = items_to_drop.len();
    log::info!("[BarrelLoot] Selected {} items to drop from {} successful rolls", drops_created, successful_rolls.len());
    
    // Create the actual dropped items WITHOUT triggering consolidation per-item
    for (index, loot_entry) in items_to_drop.iter().enumerate() {
        // Determine quantity
        let quantity = if loot_entry.min_quantity == loot_entry.max_quantity {
            loot_entry.min_quantity
        } else {
            ctx.rng().gen_range(loot_entry.min_quantity..=loot_entry.max_quantity)
        };
        
        // Calculate drop position around the barrel (spread them out)
        let angle = (index as f32) * (2.0 * std::f32::consts::PI / drops_created.max(1) as f32) + 
                   ctx.rng().gen_range(-0.5..0.5); // Add some randomness
        let distance = ctx.rng().gen_range(30.0..60.0); // Drop items 30-60 pixels away
        let drop_x = barrel_pos_x + angle.cos() * distance;
        let drop_y = barrel_pos_y + angle.sin() * distance;
        
        // Create the dropped item without auto-consolidation
        match crate::dropped_item::create_dropped_item_entity_no_consolidation(ctx, loot_entry.item_def_id, quantity, drop_x, drop_y) {
            Ok(_) => {
                log::info!("[BarrelLoot] Created {} of item {} at ({:.1}, {:.1})", 
                          quantity, loot_entry.item_def_id, drop_x, drop_y);
            }
            Err(e) => {
                log::error!("[BarrelLoot] Failed to create dropped item {}: {}", loot_entry.item_def_id, e);
            }
        }
    }
    
    // Sea-only bonus drop: rare Olive Pit from maritime flotsam barrels (variants 3-5).
    let is_sea_variant = barrel_variant >= SEA_BARREL_VARIANT_START && barrel_variant < SEA_BARREL_VARIANT_END;
    if is_sea_variant && ctx.rng().gen::<f32>() < SEA_BARREL_OLIVE_PIT_DROP_CHANCE {
        if let Some(olive_pit_def) = ctx.db.item_definition().iter().find(|def| def.name == "Olive Pit") {
            let angle = ctx.rng().gen_range(0.0..std::f32::consts::TAU);
            let distance = ctx.rng().gen_range(30.0..60.0);
            let drop_x = barrel_pos_x + angle.cos() * distance;
            let drop_y = barrel_pos_y + angle.sin() * distance;
            if let Err(e) = crate::dropped_item::create_dropped_item_entity_no_consolidation(ctx, olive_pit_def.id, 1, drop_x, drop_y) {
                log::error!("[BarrelLoot] Failed to create Olive Pit sea bonus drop: {}", e);
            } else {
                log::info!("[BarrelLoot] Sea bonus drop: Olive Pit at ({:.1}, {:.1})", drop_x, drop_y);
            }
        } else {
            log::warn!("[BarrelLoot] Olive Pit item definition not found for sea bonus drop");
        }
    }

    // Trigger consolidation ONCE after all items are dropped
    crate::dropped_item::trigger_consolidation_at_position(ctx, barrel_pos_x, barrel_pos_y);
    
    log::info!("[BarrelLoot] Created {} loot drops for destroyed barrel (guaranteed 1, max 2)", drops_created);
    Ok(())
}

// --- Combat System Integration ---

/// Applies weapon damage to a barrel (called from combat system)
pub fn damage_barrel(
    ctx: &ReducerContext,
    attacker_id: Identity,
    barrel_id: u64,
    damage: f32,
    timestamp: Timestamp,
    rng: &mut impl Rng
) -> Result<(), String> {
    let barrels = ctx.db.barrel();
    
    // Find the barrel
    let mut barrel = barrels.id().find(barrel_id)
        .ok_or_else(|| format!("Barrel with ID {} not found.", barrel_id))?;
    
    if barrel.health <= 0.0 {
        return Err("Barrel is already destroyed.".to_string());
    }

    // Buoys (variant 6) are indestructible navigational markers - no loot
    if barrel.variant == BUOY_VARIANT {
        return Err("The buoy is indestructible.".to_string());
    }

    if let Some(cover) = crate::cover_geometry::profile(barrel.variant) {
        barrel.health = crate::cover_geometry::damage_after_hit(barrel.health, damage);
        barrel.last_hit_time = Some(timestamp);
        if barrel.health <= 0.0 {
            barrel.respawn_at = Timestamp::from_micros_since_unix_epoch(
                timestamp.to_micros_since_unix_epoch() + crate::cover_geometry::COVER.respawn_seconds * 1_000_000);
            if cover.material == "wood" {
                crate::sound_events::emit_box_destroyed_sound(ctx, barrel.pos_x, barrel.pos_y, attacker_id);
            } else { crate::sound_events::emit_stone_destroyed_sound(ctx, barrel.pos_x, barrel.pos_y, attacker_id); }
        } else if cover.material == "wood" {
            crate::sound_events::emit_wood_hit_sound(ctx, barrel.pos_x, barrel.pos_y, attacker_id);
        } else {
            crate::sound_events::emit_stone_hit_sound(ctx, barrel.pos_x, barrel.pos_y, attacker_id);
        }
        // Natural cover is not a loot barrel and does not award barrel achievements.
        barrels.id().update(barrel);
        return Ok(());
    }
    
    let old_health = barrel.health;
    barrel.health = (barrel.health - damage).max(0.0);
    barrel.last_hit_time = Some(timestamp);
    
    log::info!(
        "Player {:?} hit Barrel {} for {:.1} damage. Health: {:.1} -> {:.1}",
        attacker_id, barrel_id, damage, old_health, barrel.health
    );
    
    if barrel.health <= 0.0 {
        // Barrel destroyed
        log::info!("[BarrelDamage] Barrel {} destroyed by player {:?}", barrel_id, attacker_id);
        
        // Set respawn timer
        let respawn_time = timestamp.to_micros_since_unix_epoch() + (BARREL_RESPAWN_TIME_SECONDS as i64 * 1_000_000);
        barrel.respawn_at = Timestamp::from_micros_since_unix_epoch(respawn_time);
        
        // Generate loot drops
        if let Err(e) = generate_barrel_loot_drops(ctx, barrel.pos_x, barrel.pos_y, barrel.variant) {
            log::error!("[BarrelDamage] Failed to generate loot for barrel {}: {}", barrel_id, e);
        }
        
        // Track barrels_destroyed stat for achievements
        if let Err(e) = crate::player_progression::track_stat_and_check_achievements(ctx, attacker_id, "barrels_destroyed", 1) {
            log::error!("[BarrelDamage] Failed to track barrel destroyed stat: {}", e);
        }
        
        // Emit destruction sound - use box_destroyed for variants 3 and 4 (barrel4.png and barrel5.png)
        if barrel.variant == 3 || barrel.variant == 4 {
            crate::sound_events::emit_box_destroyed_sound(ctx, barrel.pos_x, barrel.pos_y, attacker_id);
        } else {
            crate::sound_events::emit_barrel_destroyed_sound(ctx, barrel.pos_x, barrel.pos_y, attacker_id);
        }
    } else {
        // Barrel damaged but not destroyed
        log::info!("[BarrelDamage] Barrel {} damaged, health: {:.1}", barrel_id, barrel.health);
        
        // Emit hit sound based on variant:
        // - variant 3 (barrel4.png) uses wood hit sound
        // - variant 4 (barrel5.png) uses trash hit sound
        // - all other variants use regular barrel hit sound
        if barrel.variant == 4 {
            crate::sound_events::emit_trash_hit_sound(ctx, barrel.pos_x, barrel.pos_y, attacker_id);
        } else if barrel.variant == 3 {
            crate::sound_events::emit_wood_hit_sound(ctx, barrel.pos_x, barrel.pos_y, attacker_id);
        } else {
            crate::sound_events::emit_barrel_hit_sound(ctx, barrel.pos_x, barrel.pos_y, attacker_id);
        }
    }
    
    // Update the barrel
    barrels.id().update(barrel);
    
    Ok(())
}

// Note: There is no attack_barrel reducer - damage is handled through the combat system
// which calls damage_barrel() with weapon-based damage calculated from pvp_damage_min/max

/// Scheduled reducer to respawn destroyed barrels
#[spacetimedb::reducer]
pub fn respawn_destroyed_barrels(ctx: &ReducerContext, _schedule: BarrelRespawnSchedule) -> Result<(), String> {
    // Security check - only allow scheduler to call this
    if ctx.sender() != ctx.identity() {
        return Err("respawn_destroyed_barrels may only be called by the scheduler.".to_string());
    }

    let current_time = ctx.timestamp;
    // Also fills existing worlds after a module update, without resetting the map.
    crate::world_cover::seed_if_missing(ctx);
    let barrels = ctx.db.barrel();
    let mut respawned_count = 0;
    
    log::trace!("[BarrelRespawn] Checking for barrels to respawn at {:?}", current_time);
    
    // PERFORMANCE OPTIMIZATION: Spatial gating - only check barrels near players
    let player_positions: Vec<(f32, f32)> = ctx.db.player().iter()
        .filter(|p| p.is_online && !p.is_dead)
        .map(|p| (p.position_x, p.position_y))
        .collect();
    
    if player_positions.is_empty() {
        return Ok(()); // No players online, skip
    }
    
    const RESPAWN_CHECK_RADIUS_PX: f32 = 2000.0;
    const RESPAWN_CHECK_RADIUS_SQ: f32 = RESPAWN_CHECK_RADIUS_PX * RESPAWN_CHECK_RADIUS_PX;
    
    // NOTE: SpacetimeDB btree indexes don't support range queries on Timestamp types.
    // We use .iter() with spatial gating to reduce scan size.
    // respawn_at is non-Option Timestamp; UNIX_EPOCH (0) means "not respawning"
    let barrels_to_respawn: Vec<_> = barrels.iter()
        .filter(|barrel| {
            // Check respawn timer (> UNIX_EPOCH means it's set)
            if barrel.respawn_at <= Timestamp::UNIX_EPOCH || barrel.respawn_at > current_time {
                return false;
            }
            // Additional health check
            if barrel.health > 0.0 {
                return false;
            }
            // SPATIAL FILTER: Only respawn barrels near players
            for (px, py) in &player_positions {
                let dx = barrel.pos_x - px;
                let dy = barrel.pos_y - py;
                let dist_sq = dx * dx + dy * dy;
                if dist_sq <= RESPAWN_CHECK_RADIUS_SQ {
                    return true; // Near a player, include this barrel
                }
            }
            false
        })
        .collect();
    
    for mut barrel in barrels_to_respawn {
        if let Some(cover) = crate::cover_geometry::profile(barrel.variant) {
            if !crate::world_cover::can_respawn(ctx, barrel.pos_x, barrel.pos_y, cover) { continue; }
        }
        if crate::indoors::blocks_world_spawn(ctx, barrel.pos_x, barrel.pos_y) || crate::indoors::blocks_world_spawn(ctx, barrel.pos_x, barrel.pos_y-BARREL_COLLISION_Y_OFFSET) { continue; }
        // Reset barrel state
        barrel.health = if crate::cover_geometry::profile(barrel.variant).is_some() {
            crate::cover_geometry::COVER.health
        } else { BARREL_INITIAL_HEALTH };
        barrel.respawn_at = Timestamp::UNIX_EPOCH; // Use epoch to mean "not respawning"
        barrel.last_hit_time = None;
        
        // Update the barrel
        barrels.id().update(barrel.clone());
        respawned_count += 1;
        
        log::info!("[BarrelRespawn] Respawned barrel {} at ({:.1}, {:.1})", 
                  barrel.id, barrel.pos_x, barrel.pos_y);
    }
    
    if respawned_count > 0 {
        log::info!("[BarrelRespawn] Respawned {} barrels", respawned_count);
    }
    
    Ok(())
}

// --- Initialization Function (called from lib.rs) ---

/// Initialize barrel respawn scheduling system
pub(crate) fn init_barrel_system(ctx: &ReducerContext) -> Result<(), String> {
    let schedule_table = ctx.db.barrel_respawn_schedule();
    
    // Check if schedule already exists
    if schedule_table.iter().count() == 0 {
        let check_interval = Duration::from_secs(30); // Check every 30 seconds
        
        log::info!("Initializing barrel respawn system (check every 30s)");
        
        crate::try_insert_schedule!(
            schedule_table,
            BarrelRespawnSchedule {
                id: 0,
                scheduled_at: ScheduleAt::Interval(TimeDuration::from(check_interval)),
            },
            "Barrel respawn"
        );
    } else {
        log::debug!("Barrel respawn system already initialized");
    }
    
    Ok(())
}

// --- Spawning Functions (called from environment.rs) ---

/// Spawns barrel clusters on dirt road tiles with map size scaling
/// This version accepts a pre-calculated cluster count that scales with map size
pub fn spawn_barrel_clusters_scaled(
    ctx: &ReducerContext, 
    dirt_road_tiles: Vec<(i32, i32)>,
    target_cluster_count: u32
) -> Result<(), String> {
    if dirt_road_tiles.is_empty() {
        log::warn!("[BarrelSpawn] No dirt road tiles available for barrel spawning");
        return Ok(());
    }

    log::info!("[BarrelSpawn] Starting barrel cluster spawning with target count: {}", target_cluster_count);

    let mut spawned_clusters = 0;
    let mut total_barrels = 0;
    let mut spawn_attempts = 0;
    let max_spawn_attempts = target_cluster_count * 8; // Allow multiple attempts per target cluster

    while spawned_clusters < target_cluster_count && spawn_attempts < max_spawn_attempts {
        spawn_attempts += 1;

        // Choose a random dirt road tile
        let tile_idx = ctx.rng().gen_range(0..dirt_road_tiles.len());
        let (tile_x, tile_y) = dirt_road_tiles[tile_idx];
        
        // Convert tile to world position (center of tile)
        let cluster_center_x = (tile_x as f32 + 0.5) * crate::TILE_SIZE_PX as f32;
        let cluster_center_y = (tile_y as f32 + 0.5) * crate::TILE_SIZE_PX as f32;

        // Check if there's already a barrel cluster nearby
        let min_cluster_distance = 200.0; // Minimum distance between clusters
        let existing_barrels = ctx.db.barrel();
        let mut too_close_to_existing = false;
        
        for existing_barrel in existing_barrels.iter() {
            let dx = cluster_center_x - existing_barrel.pos_x;
            let dy = cluster_center_y - existing_barrel.pos_y;
            let distance_sq = dx * dx + dy * dy;
            
            if distance_sq < (min_cluster_distance * min_cluster_distance) {
                too_close_to_existing = true;
                break;
            }
        }
        
        if too_close_to_existing {
            continue; // Try another location
        }

        // Spawn 1-3 barrels in a cluster pattern with weighted probabilities
        // 1 barrel: 45%, 2 barrels: 45%, 3 barrels: 10% (rare)
        let cluster_size_roll: f32 = ctx.rng().gen();
        let barrels_in_cluster = if cluster_size_roll < 0.45 {
            1 // 45% chance for single barrel
        } else if cluster_size_roll < 0.90 {
            2 // 45% chance for 2-barrel cluster
        } else {
            3 // 10% chance for 3-barrel cluster (rare)
        };
        let mut barrels_spawned_in_cluster = 0;
        
        for barrel_idx in 0..barrels_in_cluster {
            // Create slight offset for each barrel in the cluster
            let angle = (barrel_idx as f32) * (std::f32::consts::PI * 2.0) / (barrels_in_cluster as f32);
            let cluster_radius = ctx.rng().gen_range(20.0..50.0);
            let barrel_x = cluster_center_x + angle.cos() * cluster_radius;
            let barrel_y = cluster_center_y + angle.sin() * cluster_radius;
            
            // Calculate chunk index for this barrel
            let chunk_idx = crate::environment::calculate_chunk_index(barrel_x, barrel_y);
            
            let new_barrel = Barrel {
                id: 0, // auto_inc
                pos_x: barrel_x,
                pos_y: barrel_y,
                chunk_index: chunk_idx,
                health: BARREL_INITIAL_HEALTH,
                variant: ctx.rng().gen_range(0..3), // Random variant (0, 1, or 2)
                last_hit_time: None,
                respawn_at: Timestamp::UNIX_EPOCH, // 0 = not respawning
                cluster_id: spawned_clusters as u64 + 1, // Assign cluster ID
                is_monument: false,
            };

            if crate::indoors::blocks_world_spawn(ctx, new_barrel.pos_x, new_barrel.pos_y) || crate::indoors::blocks_world_spawn(ctx, new_barrel.pos_x, new_barrel.pos_y-BARREL_COLLISION_Y_OFFSET) { continue; }
            match ctx.db.barrel().try_insert(new_barrel) {
                Ok(inserted_barrel) => {
                    barrels_spawned_in_cluster += 1;
                    total_barrels += 1;
                    log::info!("[BarrelSpawn] Spawned barrel #{} at ({:.1}, {:.1}) in cluster {}", 
                              inserted_barrel.id, barrel_x, barrel_y, spawned_clusters + 1);
                }
                Err(e) => {
                    log::warn!("[BarrelSpawn] Failed to spawn barrel in cluster {}: {}", spawned_clusters + 1, e);
                }
            }
        }
        
        if barrels_spawned_in_cluster > 0 {
            spawned_clusters += 1;
            log::info!("[BarrelSpawn] Completed cluster {} with {} barrels", spawned_clusters, barrels_spawned_in_cluster);
            
            // Spawn 1 military ration near this barrel cluster with reduced probability (30% chance)
            const MILITARY_RATION_SPAWN_CHANCE: f32 = 0.30; // 30% chance per cluster
            if ctx.rng().gen::<f32>() < MILITARY_RATION_SPAWN_CHANCE {
                // Check if there's already a military ration in this cluster area (within 150px)
                let mut has_existing_ration = false;
                let existing_boxes = ctx.db.wooden_storage_box();
                for existing_box in existing_boxes.iter() {
                    if existing_box.box_type == crate::wooden_storage_box::BOX_TYPE_MILITARY_RATION {
                        let dx = cluster_center_x - existing_box.pos_x;
                        let dy = cluster_center_y - existing_box.pos_y;
                        if dx * dx + dy * dy < 150.0 * 150.0 { // 150px cluster radius check
                            has_existing_ration = true;
                            break;
                        }
                    }
                }
                
                if !has_existing_ration {
                    // Spawn ration within 50-100px of cluster center
                    let angle = ctx.rng().gen_range(0.0..std::f32::consts::PI * 2.0);
                    let distance = ctx.rng().gen_range(50.0..100.0);
                    let ration_x = cluster_center_x + angle.cos() * distance;
                    let ration_y = cluster_center_y + angle.sin() * distance;
                    
                    // Check collision with existing barrels
                    let mut too_close = false;
                    let existing_barrels = ctx.db.barrel();
                    for existing_barrel in existing_barrels.iter() {
                        let dx = ration_x - existing_barrel.pos_x;
                        let dy = ration_y - existing_barrel.pos_y;
                        if dx * dx + dy * dy < 100.0 * 100.0 { // 100px minimum distance
                            too_close = true;
                            break;
                        }
                    }
                    
                    // Check collision with monument buildings
                    if !too_close && crate::monument::is_position_inside_monument_building(ctx, ration_x, ration_y) {
                        too_close = true;
                    }
                    
                    if !too_close {
                        let chunk_idx = crate::environment::calculate_chunk_index(ration_x, ration_y);
                        match crate::military_ration::spawn_military_ration_with_loot(ctx, ration_x, ration_y, chunk_idx) {
                            Ok(_) => {
                                log::info!("[BarrelSpawn] Spawned 1 military ration in cluster {}", spawned_clusters);
                            }
                            Err(e) => {
                                log::warn!("[BarrelSpawn] Failed to spawn military ration in cluster {}: {}", spawned_clusters, e);
                            }
                        }
                    }
                }
            }
        }
    }

    log::info!("[BarrelSpawn] Finished spawning {} barrel clusters ({} total barrels) after {} attempts", 
              spawned_clusters, total_barrels, spawn_attempts);
    Ok(())
}

/// Spawns barrel clusters on dirt road tiles during world generation
/// This function now scales properly with map size (no hard caps)
pub fn spawn_barrel_clusters(
    ctx: &ReducerContext,
    dirt_road_tiles: Vec<(i32, i32)>, // List of dirt road tile coordinates
) -> Result<(), String> {
    if dirt_road_tiles.is_empty() {
        log::warn!("[BarrelSpawn] No dirt road tiles provided for barrel spawning");
        return Ok(());
    }
    
    let barrels = ctx.db.barrel();
    
    // Check if barrels already exist
    if barrels.iter().count() > 0 {
        log::info!("[BarrelSpawn] Barrels already exist, skipping spawn");
        return Ok(());
    }
    
    // UPDATED: Scale cluster count with map size using shared density constant (no hard caps)
    let current_map_tiles = crate::WORLD_WIDTH_TILES * crate::WORLD_HEIGHT_TILES;
    let area_target = ((current_map_tiles as f32) * BARREL_CLUSTER_DENSITY_PER_TILE).round() as u32;
    let road_cap = (((dirt_road_tiles.len() as f32) / ROAD_TILES_PER_CLUSTER).floor() as u32).max(1);
    // Final target: cap area-based target by road availability, min 1
    let target_cluster_count = std::cmp::max(1, std::cmp::min(area_target, road_cap));
    
    let max_attempts = target_cluster_count * 3;
    
    log::info!(
        "[BarrelSpawn] Attempting to spawn {} barrel clusters (area target {}, road cap {}) from {} dirt road tiles (map {}x{})",
        target_cluster_count,
        area_target,
        road_cap,
        dirt_road_tiles.len(),
        crate::WORLD_WIDTH_TILES,
        crate::WORLD_HEIGHT_TILES
    );
    
    let mut spawned_clusters = 0;
    let mut spawn_attempts = 0;
    let mut cluster_positions = Vec::new();
    let mut next_cluster_id = 1u64;
    
    while spawned_clusters < target_cluster_count && spawn_attempts < max_attempts {
        spawn_attempts += 1;
        
        // Pick a random dirt road tile
        let random_index = ctx.rng().gen_range(0..dirt_road_tiles.len());
        let (tile_x, tile_y) = dirt_road_tiles[random_index];
        
        // Convert to world position (center of tile)
        let center_x = (tile_x as f32 * crate::TILE_SIZE_PX as f32) + (crate::TILE_SIZE_PX as f32 / 2.0);
        let center_y = (tile_y as f32 * crate::TILE_SIZE_PX as f32) + (crate::TILE_SIZE_PX as f32 / 2.0);
        
        // Check if this position is too close to existing clusters
        let mut too_close_to_cluster = false;
        for &(other_x, other_y) in &cluster_positions {
            let dx = center_x - other_x;
            let dy = center_y - other_y;
            if dx * dx + dy * dy < MIN_BARREL_CLUSTER_DISTANCE_SQ {
                too_close_to_cluster = true;
                break;
            }
        }
        
        if too_close_to_cluster {
            continue;
        }
        
        // Determine cluster size (1-3 barrels) with weighted probabilities
        // 1 barrel: 45%, 2 barrels: 45%, 3 barrels: 10% (rare)
        let cluster_size_roll: f32 = ctx.rng().gen();
        let cluster_size = if cluster_size_roll < 0.45 {
            1 // 45% chance for single barrel
        } else if cluster_size_roll < 0.90 {
            2 // 45% chance for 2-barrel cluster
        } else {
            3 // 10% chance for 3-barrel cluster (rare)
        };
        
        // Try to spawn the cluster
        if spawn_barrel_cluster_at_position(ctx, center_x, center_y, cluster_size, next_cluster_id)? {
            cluster_positions.push((center_x, center_y));
            spawned_clusters += 1;
            next_cluster_id += 1;
            
            log::info!("[BarrelSpawn] Spawned cluster {} with {} barrels at ({:.1}, {:.1})", 
                      next_cluster_id - 1, cluster_size, center_x, center_y);
            
            // Spawn 1 military ration near this barrel cluster with reduced probability (30% chance)
            const MILITARY_RATION_SPAWN_CHANCE: f32 = 0.30; // 30% chance per cluster
            if ctx.rng().gen::<f32>() < MILITARY_RATION_SPAWN_CHANCE {
                // Check if there's already a military ration in this cluster area (within 150px)
                let mut has_existing_ration = false;
                let existing_boxes = ctx.db.wooden_storage_box();
                for existing_box in existing_boxes.iter() {
                    if existing_box.box_type == crate::wooden_storage_box::BOX_TYPE_MILITARY_RATION {
                        let dx = center_x - existing_box.pos_x;
                        let dy = center_y - existing_box.pos_y;
                        if dx * dx + dy * dy < 150.0 * 150.0 { // 150px cluster radius check
                            has_existing_ration = true;
                            break;
                        }
                    }
                }
                
                if !has_existing_ration {
                    // Spawn ration within 50-100px of cluster center
                    let angle = ctx.rng().gen_range(0.0..std::f32::consts::PI * 2.0);
                    let distance = ctx.rng().gen_range(50.0..100.0);
                    let ration_x = center_x + angle.cos() * distance;
                    let ration_y = center_y + angle.sin() * distance;
                    
                    // Check collision with existing barrels
                    let mut too_close = false;
                    let existing_barrels = ctx.db.barrel();
                    for existing_barrel in existing_barrels.iter() {
                        let dx = ration_x - existing_barrel.pos_x;
                        let dy = ration_y - existing_barrel.pos_y;
                        if dx * dx + dy * dy < 100.0 * 100.0 { // 100px minimum distance
                            too_close = true;
                            break;
                        }
                    }
                    
                    // Check collision with monument buildings
                    if !too_close && crate::monument::is_position_inside_monument_building(ctx, ration_x, ration_y) {
                        too_close = true;
                    }
                    
                    if !too_close {
                        let chunk_idx = crate::environment::calculate_chunk_index(ration_x, ration_y);
                        match crate::military_ration::spawn_military_ration_with_loot(ctx, ration_x, ration_y, chunk_idx) {
                            Ok(_) => {
                                log::info!("[BarrelSpawn] Spawned 1 military ration in cluster {}", next_cluster_id - 1);
                            }
                            Err(e) => {
                                log::warn!("[BarrelSpawn] Failed to spawn military ration in cluster {}: {}", next_cluster_id - 1, e);
                            }
                        }
                    }
                }
            }
        }
    }
    
    let total_barrels = barrels.iter().count();
    log::info!("[BarrelSpawn] Finished spawning {} barrel clusters ({} total barrels) after {} attempts (SCALES WITH MAP SIZE)", 
              spawned_clusters, total_barrels, spawn_attempts);
    
    Ok(())
}

/// Spawns a single cluster of barrels at the specified position
fn spawn_barrel_cluster_at_position(
    ctx: &ReducerContext,
    center_x: f32,
    center_y: f32,
    cluster_size: u32,
    cluster_id: u64,
) -> Result<bool, String> {
    let mut barrel_positions = Vec::new();
    
    // For single barrel, place at center
    if cluster_size == 1 {
        // Check for collisions (including monument buildings)
        if has_barrel_collision(ctx, center_x, center_y, None) ||
           has_player_barrel_collision(ctx, center_x, center_y) ||
           crate::monument::is_position_inside_monument_building(ctx, center_x, center_y) {
            return Ok(false); // Failed to spawn cluster
        }
        
        barrel_positions.push((center_x, center_y));
    } else {
        // For multiple barrels, arrange them in a small pattern
        let spacing = 50.0; // Distance between barrels in cluster
        
        for i in 0..cluster_size {
            let angle = (i as f32) * (2.0 * std::f32::consts::PI / cluster_size as f32);
            let offset_x = angle.cos() * spacing;
            let offset_y = angle.sin() * spacing;
            
            let barrel_x = center_x + offset_x;
            let barrel_y = center_y + offset_y;
            
            // Check for collisions (including monument buildings)
            if has_barrel_collision(ctx, barrel_x, barrel_y, None) ||
               has_player_barrel_collision(ctx, barrel_x, barrel_y) ||
               crate::monument::is_position_inside_monument_building(ctx, barrel_x, barrel_y) {
                return Ok(false); // Failed to spawn cluster
            }
            
            barrel_positions.push((barrel_x, barrel_y));
        }
    }
    
    // All positions are valid, spawn the barrels
    let barrels = ctx.db.barrel();
    for (barrel_x, barrel_y) in barrel_positions {
        let variant = ctx.rng().gen_range(0..3u8); // Random variant (0, 1, or 2)
        let chunk_idx = calculate_chunk_index(barrel_x, barrel_y);
        
        let new_barrel = Barrel {
            id: 0, // Auto-incremented
            pos_x: barrel_x,
            pos_y: barrel_y,
            health: BARREL_INITIAL_HEALTH,
            variant,
            chunk_index: chunk_idx,
            last_hit_time: None,
            respawn_at: Timestamp::UNIX_EPOCH, // 0 = not respawning
            cluster_id,
            is_monument: false,
        };
        
        if crate::indoors::blocks_world_spawn(ctx, new_barrel.pos_x, new_barrel.pos_y) || crate::indoors::blocks_world_spawn(ctx, new_barrel.pos_x, new_barrel.pos_y-BARREL_COLLISION_Y_OFFSET) { continue; }
        match barrels.try_insert(new_barrel) {
            Ok(inserted_barrel) => {
                log::debug!("[BarrelSpawn] Spawned barrel {} (variant {}) at ({:.1}, {:.1})", 
                           inserted_barrel.id, variant, barrel_x, barrel_y);
            }
            Err(e) => {
                log::error!("[BarrelSpawn] Failed to insert barrel: {}", e);
                return Err(format!("Failed to spawn barrel: {}", e));
            }
        }
    }
    
    Ok(true)
}

/// Spawns sea barrels (flotsam/cargo crates) around sea stacks
/// These are variants 3, 4, 5 and only spawn in ocean water near sea stacks
pub fn spawn_sea_barrels_around_stacks(
    ctx: &ReducerContext,
    sea_stack_positions: &[(f32, f32)],
) -> Result<(), String> {
    if sea_stack_positions.is_empty() {
        log::info!("[SeaBarrelSpawn] No sea stacks available for sea barrel spawning");
        return Ok(());
    }

    log::info!("[SeaBarrelSpawn] Starting sea barrel spawning around {} sea stacks", sea_stack_positions.len());

    let mut spawned_count = 0;
    let barrels = ctx.db.barrel();
    let mut spawned_sea_barrel_positions = Vec::<(f32, f32)>::new();

    for &(stack_x, stack_y) in sea_stack_positions {
        // Roll for spawning chance (15% per stack)
        let spawn_roll: f32 = ctx.rng().gen();
        if spawn_roll > SEA_BARREL_SPAWN_CHANCE_PER_STACK {
            continue; // Skip this sea stack
        }

        // Determine how many sea barrels to spawn (1-3)
        let roll: f32 = ctx.rng().gen();
        let barrel_count = if roll < 0.35 {
            1 // 35% chance for single barrel
        } else if roll < 0.75 {
            2 // 40% chance for 2 barrels
        } else {
            3 // 25% chance for 3 barrels (jackpot sea stack!)
        };

        let mut barrels_spawned_near_this_stack = 0;

        for barrel_idx in 0..barrel_count {
            let mut attempts = 0;
            const MAX_POSITION_ATTEMPTS: u32 = 10;

            while attempts < MAX_POSITION_ATTEMPTS {
                attempts += 1;

                // Generate position in a ring around the sea stack
                let angle = (barrel_idx as f32) * (2.0 * std::f32::consts::PI / barrel_count as f32) +
                           ctx.rng().gen_range(-0.5..0.5); // Add randomness
                let distance = ctx.rng().gen_range(MIN_SEA_BARREL_DISTANCE_FROM_STACK..MAX_SEA_BARREL_DISTANCE_FROM_STACK);
                
                let barrel_x = stack_x + angle.cos() * distance;
                let barrel_y = stack_y + angle.sin() * distance;

                // Validate position: must be on ocean water
                if !crate::environment::is_position_on_ocean_water(ctx, barrel_x, barrel_y) {
                    continue; // Try another position
                }

                // Check distance from other sea barrels
                let mut too_close = false;
                for &(other_x, other_y) in &spawned_sea_barrel_positions {
                    let dx = barrel_x - other_x;
                    let dy = barrel_y - other_y;
                    if dx * dx + dy * dy < MIN_SEA_BARREL_DISTANCE_SQ {
                        too_close = true;
                        break;
                    }
                }
                if too_close {
                    continue; // Try another position
                }

                // Check distance from existing road barrels (avoid overlap)
                let mut too_close_to_road_barrel = false;
                for existing_barrel in barrels.iter() {
                    if existing_barrel.health == 0.0 { continue; } // Skip destroyed barrels
                    if existing_barrel.variant < SEA_BARREL_VARIANT_START {
                        // This is a road barrel, check distance
                        let dx = barrel_x - existing_barrel.pos_x;
                        let dy = barrel_y - existing_barrel.pos_y;
                        if dx * dx + dy * dy < MIN_SEA_BARREL_DISTANCE_SQ {
                            too_close_to_road_barrel = true;
                            break;
                        }
                    }
                }
                if too_close_to_road_barrel {
                    continue; // Try another position
                }

                // Position is valid - spawn the sea barrel
                let variant = ctx.rng().gen_range(SEA_BARREL_VARIANT_START..SEA_BARREL_VARIANT_END); // 3, 4, or 5
                let chunk_idx = crate::environment::calculate_chunk_index(barrel_x, barrel_y);

                let new_barrel = Barrel {
                    id: 0, // auto_inc
                    pos_x: barrel_x,
                    pos_y: barrel_y,
                    chunk_index: chunk_idx,
                    health: BARREL_INITIAL_HEALTH,
                    variant,
                    last_hit_time: None,
                    respawn_at: Timestamp::UNIX_EPOCH, // 0 = not respawning
                    cluster_id: 0, // Sea barrels don't use cluster IDs (they're individual spawns)
                    is_monument: false,
                };

                if crate::indoors::blocks_world_spawn(ctx, new_barrel.pos_x, new_barrel.pos_y) || crate::indoors::blocks_world_spawn(ctx, new_barrel.pos_x, new_barrel.pos_y-BARREL_COLLISION_Y_OFFSET) { continue; }
                match barrels.try_insert(new_barrel) {
                    Ok(inserted_barrel) => {
                        spawned_sea_barrel_positions.push((barrel_x, barrel_y));
                        barrels_spawned_near_this_stack += 1;
                        spawned_count += 1;
                        log::info!(
                            "[SeaBarrelSpawn] Spawned sea barrel #{} (variant {}) at ({:.1}, {:.1}) near sea stack at ({:.1}, {:.1})",
                            inserted_barrel.id, variant, barrel_x, barrel_y, stack_x, stack_y
                        );
                        break; // Successfully spawned, move to next barrel
                    }
                    Err(e) => {
                        log::warn!("[SeaBarrelSpawn] Failed to insert sea barrel: {}", e);
                        // Continue to try another position
                    }
                }
            }
        }

        if barrels_spawned_near_this_stack > 0 {
            log::info!(
                "[SeaBarrelSpawn] Spawned {} sea barrel(s) near sea stack at ({:.1}, {:.1})",
                barrels_spawned_near_this_stack, stack_x, stack_y
            );
        }
    }

    log::info!("[SeaBarrelSpawn] Finished spawning {} sea barrels around sea stacks", spawned_count);
    Ok(())
}

/// Spawns sea barrel variants (3, 4, 5) on beach tiles
/// All sea barrel variants can wash up on beaches, but much rarer than around sea stacks
pub fn spawn_beach_barrels(
    ctx: &ReducerContext,
) -> Result<(), String> {
    log::info!("[BeachBarrelSpawn] Starting beach barrel spawning...");

    // Collect all beach tiles
    let world_tiles = ctx.db.world_tile();
    let beach_tiles: Vec<(i32, i32)> = world_tiles.iter()
        .filter(|tile| tile.tile_type == crate::TileType::Beach)
        .map(|tile| (tile.world_x, tile.world_y))
        .collect();

    if beach_tiles.is_empty() {
        log::info!("[BeachBarrelSpawn] No beach tiles available for barrel spawning");
        return Ok(());
    }

    // Calculate target count based on beach tile density
    let target_count = ((beach_tiles.len() as f32) * BEACH_BARREL_SPAWN_DENSITY_PERCENT).round() as u32;
    let max_attempts = target_count * MAX_BARREL_SEEDING_ATTEMPTS_FACTOR;

    log::info!(
        "[BeachBarrelSpawn] Attempting to spawn {} beach barrels from {} beach tiles (max attempts: {})",
        target_count, beach_tiles.len(), max_attempts
    );

    let mut spawned_count = 0;
    let mut attempts = 0;
    let barrels = ctx.db.barrel();
    let mut spawned_beach_barrel_positions = Vec::<(f32, f32)>::new();

    while spawned_count < target_count && attempts < max_attempts {
        attempts += 1;

        // Pick a random beach tile
        let tile_idx = ctx.rng().gen_range(0..beach_tiles.len());
        let (tile_x, tile_y) = beach_tiles[tile_idx];

        // Convert to world position (center of tile with slight random offset)
        let offset_x = ctx.rng().gen_range(-0.3..0.3) * crate::TILE_SIZE_PX as f32;
        let offset_y = ctx.rng().gen_range(-0.3..0.3) * crate::TILE_SIZE_PX as f32;
        let barrel_x = (tile_x as f32 + 0.5) * crate::TILE_SIZE_PX as f32 + offset_x;
        let barrel_y = (tile_y as f32 + 0.5) * crate::TILE_SIZE_PX as f32 + offset_y;

        // Validate position: must still be on beach tile
        if !crate::environment::is_position_on_beach_tile(ctx, barrel_x, barrel_y) {
            continue; // Try another position
        }

        // Check distance from other beach barrels
        let mut too_close = false;
        for &(other_x, other_y) in &spawned_beach_barrel_positions {
            let dx = barrel_x - other_x;
            let dy = barrel_y - other_y;
            if dx * dx + dy * dy < MIN_BEACH_BARREL_DISTANCE_SQ {
                too_close = true;
                break;
            }
        }
        if too_close {
            continue; // Try another position
        }

        // Check distance from existing barrels (all variants)
        let mut too_close_to_existing = false;
        for existing_barrel in barrels.iter() {
            if existing_barrel.health == 0.0 { continue; } // Skip destroyed barrels
            let dx = barrel_x - existing_barrel.pos_x;
            let dy = barrel_y - existing_barrel.pos_y;
            if dx * dx + dy * dy < MIN_BEACH_BARREL_DISTANCE_SQ {
                too_close_to_existing = true;
                break;
            }
        }
        if too_close_to_existing {
            continue; // Try another position
        }

        // Check collision with players
        if has_player_barrel_collision(ctx, barrel_x, barrel_y) {
            continue; // Try another position
        }

        // Position is valid - spawn a random sea barrel variant (3, 4, or 5)
        let variant = ctx.rng().gen_range(SEA_BARREL_VARIANT_START..SEA_BARREL_VARIANT_END); // Random variant 3, 4, or 5
        let chunk_idx = crate::environment::calculate_chunk_index(barrel_x, barrel_y);

        let new_barrel = Barrel {
            id: 0, // auto_inc
            pos_x: barrel_x,
            pos_y: barrel_y,
            chunk_index: chunk_idx,
            health: BARREL_INITIAL_HEALTH,
            variant, // Random sea barrel variant (3, 4, or 5)
            last_hit_time: None,
            respawn_at: Timestamp::UNIX_EPOCH, // 0 = not respawning
            cluster_id: 0, // Beach barrels don't use cluster IDs
            is_monument: false,
        };

        if crate::indoors::blocks_world_spawn(ctx, new_barrel.pos_x, new_barrel.pos_y) || crate::indoors::blocks_world_spawn(ctx, new_barrel.pos_x, new_barrel.pos_y-BARREL_COLLISION_Y_OFFSET) { continue; }
        match barrels.try_insert(new_barrel) {
            Ok(inserted_barrel) => {
                spawned_beach_barrel_positions.push((barrel_x, barrel_y));
                spawned_count += 1;
                log::info!(
                    "[BeachBarrelSpawn] Spawned beach barrel #{} (variant {}) at ({:.1}, {:.1}) on beach tile ({}, {})",
                    inserted_barrel.id, variant, barrel_x, barrel_y, tile_x, tile_y
                );
            }
            Err(e) => {
                log::warn!("[BeachBarrelSpawn] Failed to insert beach barrel: {}", e);
                // Continue to try another position
            }
        }
    }

    log::info!(
        "[BeachBarrelSpawn] Finished spawning {} beach barrels (target: {}, attempts: {})",
        spawned_count, target_count, attempts
    );
    Ok(())
}

/// Spawns beach barrels around hot springs for extra flavor
/// Places 2-4 barrels on Beach tiles adjacent to each hot spring
pub fn spawn_hot_spring_barrels(
    ctx: &ReducerContext,
    hot_spring_centers: &[(f32, f32)],
) -> Result<u32, String> {
    if hot_spring_centers.is_empty() {
        log::info!("[HotSpringBarrelSpawn] No hot springs found, skipping barrel spawning");
        return Ok(0);
    }

    log::info!("[HotSpringBarrelSpawn] Spawning barrels around {} hot springs...", hot_spring_centers.len());

    let mut total_spawned = 0u32;
    let barrels = ctx.db.barrel();

    for (center_x, center_y) in hot_spring_centers {
        // Target 2-4 barrels per hot spring
        let target_barrels = ctx.rng().gen_range(2..=4);
        let mut spawned_this_spring = 0u32;
        let mut attempts = 0u32;
        let max_attempts = target_barrels * 15; // Give plenty of attempts
        let mut spawned_positions: Vec<(f32, f32)> = Vec::new();

        while spawned_this_spring < target_barrels && attempts < max_attempts {
            attempts += 1;

            // Pick a random position on the beach ring around the hot spring
            // Hot springs have water radius ~7-9 tiles, beach is just outside
            // Try spawning 8-14 tiles from center (beach zone)
            let angle = ctx.rng().gen_range(0.0..std::f32::consts::TAU);
            let distance = ctx.rng().gen_range(8.0..14.0) * crate::TILE_SIZE_PX as f32;
            
            let barrel_x = center_x + angle.cos() * distance;
            let barrel_y = center_y + angle.sin() * distance;

            // Must be on a beach tile
            if !crate::environment::is_position_on_beach_tile(ctx, barrel_x, barrel_y) {
                continue;
            }

            // Check distance from other hot spring barrels we've placed
            let mut too_close = false;
            for &(other_x, other_y) in &spawned_positions {
                let dx = barrel_x - other_x;
                let dy = barrel_y - other_y;
                if dx * dx + dy * dy < MIN_BEACH_BARREL_DISTANCE_SQ {
                    too_close = true;
                    break;
                }
            }
            if too_close {
                continue;
            }

            // Check distance from existing barrels
            let mut too_close_to_existing = false;
            for existing_barrel in barrels.iter() {
                if existing_barrel.health == 0.0 { continue; }
                let dx = barrel_x - existing_barrel.pos_x;
                let dy = barrel_y - existing_barrel.pos_y;
                if dx * dx + dy * dy < MIN_BEACH_BARREL_DISTANCE_SQ {
                    too_close_to_existing = true;
                    break;
                }
            }
            if too_close_to_existing {
                continue;
            }

            // Check collision with players
            if has_player_barrel_collision(ctx, barrel_x, barrel_y) {
                continue;
            }

            // Spawn a sea barrel variant (3, 4, or 5) - these look like washed-up flotsam
            let variant = ctx.rng().gen_range(SEA_BARREL_VARIANT_START..SEA_BARREL_VARIANT_END);
            let chunk_idx = crate::environment::calculate_chunk_index(barrel_x, barrel_y);

            let new_barrel = Barrel {
                id: 0,
                pos_x: barrel_x,
                pos_y: barrel_y,
                chunk_index: chunk_idx,
                health: BARREL_INITIAL_HEALTH,
                variant,
                last_hit_time: None,
                respawn_at: Timestamp::UNIX_EPOCH,
                cluster_id: 0,
                is_monument: false,
            };

            if crate::indoors::blocks_world_spawn(ctx, new_barrel.pos_x, new_barrel.pos_y) || crate::indoors::blocks_world_spawn(ctx, new_barrel.pos_x, new_barrel.pos_y-BARREL_COLLISION_Y_OFFSET) { continue; }
            match barrels.try_insert(new_barrel) {
                Ok(inserted_barrel) => {
                    spawned_positions.push((barrel_x, barrel_y));
                    spawned_this_spring += 1;
                    total_spawned += 1;
                    log::debug!(
                        "[HotSpringBarrelSpawn] Spawned barrel #{} (variant {}) at ({:.1}, {:.1}) near hot spring ({:.1}, {:.1})",
                        inserted_barrel.id, variant, barrel_x, barrel_y, center_x, center_y
                    );
                }
                Err(e) => {
                    log::warn!("[HotSpringBarrelSpawn] Failed to insert barrel: {}", e);
                }
            }
        }

        log::info!(
            "[HotSpringBarrelSpawn] Hot spring at ({:.0}, {:.0}): spawned {} barrels",
            center_x, center_y, spawned_this_spring
        );
    }

    log::info!("[HotSpringBarrelSpawn] Total: spawned {} barrels around {} hot springs", 
        total_spawned, hot_spring_centers.len());
    Ok(total_spawned)
}

/// Spawns indestructible buoys (variant 6) in outer ocean water.
/// No loot, decorative/navigational.
/// Placement rules:
/// 1) Only Sea↔DeepSea transition ring tiles.
/// 2) Exclude candidates near any beach/island (non-Sea/DeepSea tiles).
/// 3) Even angular spacing around the ring.
pub fn spawn_buoy_barrels(ctx: &ReducerContext) -> Result<(), String> {
    use crate::{WORLD_WIDTH_PX, WORLD_HEIGHT_PX, TILE_SIZE_PX};
    log::info!("[BuoySpawn] Starting buoy barrel spawning...");

    let center_x = WORLD_WIDTH_PX / 2.0;
    let center_y = WORLD_HEIGHT_PX / 2.0;
    let barrels = ctx.db.barrel();

    // Build tile map once for fast neighborhood checks.
    let tile_map: HashMap<(i32, i32), TileType> = ctx.db.world_tile()
        .iter()
        .map(|t| ((t.world_x, t.world_y), t.tile_type))
        .collect();

    let is_open_ocean = |t: &TileType| *t == TileType::Sea || *t == TileType::DeepSea;
    let is_transition_tile = |tx: i32, ty: i32| -> bool {
        let center = match tile_map.get(&(tx, ty)) {
            Some(t) => t,
            None => return false,
        };
        if !is_open_ocean(center) {
            return false;
        }
        [(-1, 0), (1, 0), (0, -1), (0, 1)].iter().any(|(dx, dy)| {
            tile_map
                .get(&(tx + dx, ty + dy))
                .map(|t| {
                    if *center == TileType::Sea {
                        *t == TileType::DeepSea
                    } else {
                        *t == TileType::Sea
                    }
                })
                .unwrap_or(false)
        })
    };

    let is_far_from_coast_or_island = |tx: i32, ty: i32| -> bool {
        for dy in -BUOY_COAST_CLEARANCE_TILES..=BUOY_COAST_CLEARANCE_TILES {
            for dx in -BUOY_COAST_CLEARANCE_TILES..=BUOY_COAST_CLEARANCE_TILES {
                let nx = tx + dx;
                let ny = ty + dy;
                if let Some(t) = tile_map.get(&(nx, ny)) {
                    if !is_open_ocean(t) {
                        return false;
                    }
                }
            }
        }
        true
    };

    // 1) Collect all valid transition candidates.
    let mut candidates: Vec<(f32, f32, f32, f32)> = Vec::new(); // (x_px, y_px, angle, radius)
    for (&(tx, ty), tile_type) in &tile_map {
        if !is_open_ocean(tile_type) {
            continue;
        }
        if !is_transition_tile(tx, ty) {
            continue;
        }
        if !is_far_from_coast_or_island(tx, ty) {
            continue;
        }

        let x = (tx as f32 + 0.5) * TILE_SIZE_PX as f32;
        let y = (ty as f32 + 0.5) * TILE_SIZE_PX as f32;
        let dx = x - center_x;
        let dy = y - center_y;
        let mut angle = dy.atan2(dx);
        if angle < 0.0 {
            angle += std::f32::consts::TAU;
        }
        let radius = (dx * dx + dy * dy).sqrt();
        candidates.push((x, y, angle, radius));
    }

    if candidates.is_empty() {
        log::warn!("[BuoySpawn] No valid Sea↔DeepSea transition candidates found after coast/island filtering");
        return Ok(());
    }

    // 2) Sort by angle to treat transition ring as an ordered loop.
    candidates.sort_by(|a, b| a.2.partial_cmp(&b.2).unwrap_or(std::cmp::Ordering::Equal));

    // 3) Compute target buoy count from ring circumference and desired spacing.
    let avg_radius = candidates.iter().map(|c| c.3).sum::<f32>() / candidates.len() as f32;
    let estimated_circumference = std::f32::consts::TAU * avg_radius.max(1.0);
    let mut target_count = (estimated_circumference / BUOY_TARGET_SPACING_PX).round() as usize;
    target_count = target_count.clamp(BUOY_MIN_COUNT, BUOY_MAX_COUNT).min(candidates.len());

    // 4) Select evenly distributed candidates by angular index.
    let mut selected_positions: Vec<(f32, f32)> = Vec::new();
    let mut used_indices: HashSet<usize> = HashSet::new();
    let n = candidates.len();

    for i in 0..target_count {
        let ideal_idx = (((i as f32) * n as f32 / target_count as f32).round() as usize) % n;
        let mut chosen_idx: Option<usize> = None;

        for step in 0..n {
            let idx = (ideal_idx + step) % n;
            if used_indices.contains(&idx) {
                continue;
            }
            let (cx, cy, _, _) = candidates[idx];
            let too_close = selected_positions.iter().any(|(sx, sy)| {
                let dx = cx - *sx;
                let dy = cy - *sy;
                dx * dx + dy * dy < MIN_BUOY_DISTANCE_SQ
            });
            if !too_close {
                chosen_idx = Some(idx);
                break;
            }
        }

        if let Some(idx) = chosen_idx {
            used_indices.insert(idx);
            let (x, y, _, _) = candidates[idx];
            selected_positions.push((x, y));
        }
    }

    if selected_positions.is_empty() {
        log::warn!("[BuoySpawn] Candidate ring found but spacing constraints rejected all placements");
        return Ok(());
    }

    // 5) Spawn buoys from selected positions.
    let mut spawned_count = 0u32;
    for (barrel_x, barrel_y) in selected_positions {
        if has_buoy_collision(ctx, barrel_x, barrel_y) || has_player_buoy_collision(ctx, barrel_x, barrel_y) {
            continue;
        }

        let too_close_existing_buoy = barrels.iter().any(|existing| {
            if existing.health == 0.0 || existing.variant != BUOY_VARIANT {
                return false;
            }
            let dx = barrel_x - existing.pos_x;
            let dy = barrel_y - existing.pos_y;
            dx * dx + dy * dy < MIN_BUOY_DISTANCE_SQ
        });
        if too_close_existing_buoy {
            continue;
        }

        let chunk_idx = crate::environment::calculate_chunk_index(barrel_x, barrel_y);
        let new_barrel = Barrel {
            id: 0,
            pos_x: barrel_x,
            pos_y: barrel_y,
            chunk_index: chunk_idx,
            health: BARREL_INITIAL_HEALTH,
            variant: BUOY_VARIANT,
            last_hit_time: None,
            respawn_at: Timestamp::UNIX_EPOCH,
            cluster_id: 0,
            is_monument: false,
        };

        if crate::indoors::blocks_world_spawn(ctx, new_barrel.pos_x, new_barrel.pos_y) || crate::indoors::blocks_world_spawn(ctx, new_barrel.pos_x, new_barrel.pos_y-BARREL_COLLISION_Y_OFFSET) { continue; }
        match barrels.try_insert(new_barrel) {
            Ok(inserted) => {
                spawned_count += 1;
                log::info!("[BuoySpawn] Spawned buoy #{} at ({:.1}, {:.1})", inserted.id, barrel_x, barrel_y);
            }
            Err(e) => {
                log::warn!("[BuoySpawn] Failed to insert buoy: {}", e);
            }
        }
    }

    log::info!(
        "[BuoySpawn] Finished spawning {} buoys from {} valid transition candidates",
        spawned_count,
        candidates.len()
    );
    Ok(())
}
