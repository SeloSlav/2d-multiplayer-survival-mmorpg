//! # Roadside Barrel System
//! 
//! This module handles destructible barrels that spawn on dirt roads and drop loot when destroyed.
//! Barrels spawn in clusters of 1-3 and respawn after being destroyed.
//!
//! ## Key Features:
//! - Spawn only on dirt road tiles
//! - Cluster spawning with proper spacing
//! - Health-based destruction system
//! - Configurable loot tables
//! - Automatic respawning after destruction
//! - Collision detection similar to storage boxes

use spacetimedb::{ReducerContext, SpacetimeType, Table, Timestamp, Identity};
use log;
use rand::Rng;
use std::time::Duration;
use spacetimedb::spacetimedb_lib::ScheduleAt;

// Import necessary items from other modules
use crate::items::item_definition as ItemDefinitionTableTrait;
use crate::player as PlayerTableTrait;
use crate::dropped_item::{create_dropped_item_entity, calculate_drop_position};
use crate::{Player, PLAYER_RADIUS, TileType};
use crate::utils::get_distance_squared;
use crate::environment::calculate_chunk_index;

// Constants for barrel system
pub const BARREL_INITIAL_HEALTH: f32 = 50.0; // Less health than storage boxes
pub const BARREL_COLLISION_RADIUS: f32 = 35.0; // Collision radius in pixels (matches 64x64 visual size)
pub const BARREL_COLLISION_Y_OFFSET: f32 = 12.0; // Y-offset for collision detection
pub const PLAYER_BARREL_COLLISION_DISTANCE_SQUARED: f32 = (PLAYER_RADIUS + BARREL_COLLISION_RADIUS) * (PLAYER_RADIUS + BARREL_COLLISION_RADIUS);
pub const PLAYER_BARREL_INTERACTION_DISTANCE_SQUARED: f32 = 64.0 * 64.0; // 64 pixels interaction range
pub const BARREL_BARREL_COLLISION_DISTANCE_SQUARED: f32 = (BARREL_COLLISION_RADIUS * 2.0 + 20.0) * (BARREL_COLLISION_RADIUS * 2.0 + 20.0); // Barrels can't overlap

// Spawning constants
pub const BARREL_DENSITY_PERCENT: f32 = 0.001; // 0.1% of total tiles for road density calculation  
pub const MAX_BARREL_SEEDING_ATTEMPTS_FACTOR: u32 = 5; // Attempt factor for finding valid positions
pub const MIN_BARREL_CLUSTER_DISTANCE_SQ: f32 = 400.0 * 400.0; // Minimum distance between clusters (PvP balance: wide spacing for contested points)
pub const MIN_BARREL_DISTANCE_SQ: f32 = 60.0 * 60.0; // Minimum distance between individual barrels in cluster
pub const BARREL_RESPAWN_TIME_SECONDS: u32 = 600; // 10 minutes respawn time

// Damage constants
pub const BARREL_DAMAGE_PER_HIT: f32 = 25.0; // 2 hits to destroy
pub const BARREL_ATTACK_COOLDOWN_MS: u64 = 1000; // 1 second between attacks

// Define the main barrel table
#[spacetimedb::table(name = barrel, public)]
#[derive(Clone, Debug)]
pub struct Barrel {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub pos_x: f32,
    pub pos_y: f32,
    pub health: f32,
    pub variant: u8, // 0, 1, or 2 for three different visual variations
    pub chunk_index: u32,
    pub last_hit_time: Option<Timestamp>,
    pub respawn_at: Option<Timestamp>, // When this barrel should respawn (if destroyed)
    pub cluster_id: u64, // ID to group barrels that spawned together
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
#[spacetimedb::table(name = barrel_respawn_schedule, scheduled(respawn_destroyed_barrels))]
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
    
    // Find Rope item ID
    if let Some(rope_item) = item_defs.iter().find(|def| def.name == "Rope") {
        loot_table.push(BarrelLootEntry {
            item_def_id: rope_item.id,
            min_quantity: 1,
            max_quantity: 3,
            drop_chance: 0.7, // 70% chance
        });
    } else {
        log::warn!("[BarrelLoot] Rope item not found in database");
    }
    
    // Find Metal Fragments item ID
    if let Some(metal_item) = item_defs.iter().find(|def| def.name == "Metal Fragments") {
        loot_table.push(BarrelLootEntry {
            item_def_id: metal_item.id,
            min_quantity: 2,
            max_quantity: 5,
            drop_chance: 0.5, // 50% chance
        });
    } else {
        log::warn!("[BarrelLoot] Metal Fragments item not found in database");
    }
    
    loot_table
}

// --- Helper Functions ---

/// Checks if a position has collision with existing barrels
pub fn has_barrel_collision(ctx: &ReducerContext, pos_x: f32, pos_y: f32, exclude_id: Option<u64>) -> bool {
    for barrel in ctx.db.barrel().iter() {
        if barrel.health == 0.0 { continue; } // Skip destroyed barrels
        if let Some(exclude) = exclude_id {
            if barrel.id == exclude { continue; } // Skip the barrel we're checking against
        }
        
        let dx = pos_x - barrel.pos_x;
        let dy = pos_y - (barrel.pos_y - BARREL_COLLISION_Y_OFFSET);
        let distance_sq = dx * dx + dy * dy;
        
        if distance_sq < BARREL_BARREL_COLLISION_DISTANCE_SQUARED {
            return true;
        }
    }
    false
}

/// Checks if a position has collision with a player
pub fn has_player_barrel_collision(ctx: &ReducerContext, pos_x: f32, pos_y: f32) -> bool {
    for player in ctx.db.player().iter() {
        if player.is_dead { continue; }
        
        let dx = pos_x - player.position_x;
        let dy = pos_y - (player.position_y - BARREL_COLLISION_Y_OFFSET);
        let distance_sq = dx * dx + dy * dy;
        
        if distance_sq < PLAYER_BARREL_COLLISION_DISTANCE_SQUARED {
            return true;
        }
    }
    false
}

/// Generates loot drops around a destroyed barrel
fn generate_barrel_loot_drops(ctx: &ReducerContext, barrel_pos_x: f32, barrel_pos_y: f32) -> Result<(), String> {
    let loot_table = get_barrel_loot_table(ctx);
    let mut drops_created = 0;
    
    log::info!("[BarrelLoot] Generating loot drops for barrel at ({:.1}, {:.1})", barrel_pos_x, barrel_pos_y);
    
    for loot_entry in loot_table {
        // Check if this item should drop based on chance
        let roll: f32 = ctx.rng().gen();
        if roll > loot_entry.drop_chance {
            continue; // This item doesn't drop
        }
        
        // Determine quantity
        let quantity = if loot_entry.min_quantity == loot_entry.max_quantity {
            loot_entry.min_quantity
        } else {
            ctx.rng().gen_range(loot_entry.min_quantity..=loot_entry.max_quantity)
        };
        
        // Calculate drop position around the barrel
        let angle = ctx.rng().gen_range(0.0..std::f32::consts::PI * 2.0);
        let distance = ctx.rng().gen_range(30.0..60.0); // Drop items 30-60 pixels away
        let drop_x = barrel_pos_x + angle.cos() * distance;
        let drop_y = barrel_pos_y + angle.sin() * distance;
        
        // Create the dropped item
        match create_dropped_item_entity(ctx, loot_entry.item_def_id, quantity, drop_x, drop_y) {
            Ok(_) => {
                drops_created += 1;
                log::info!("[BarrelLoot] Created {} of item {} at ({:.1}, {:.1})", 
                          quantity, loot_entry.item_def_id, drop_x, drop_y);
            }
            Err(e) => {
                log::error!("[BarrelLoot] Failed to create dropped item {}: {}", loot_entry.item_def_id, e);
            }
        }
    }
    
    log::info!("[BarrelLoot] Created {} loot drops for destroyed barrel", drops_created);
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
        barrel.respawn_at = Some(Timestamp::from_micros_since_unix_epoch(respawn_time));
        
        // Generate loot drops
        if let Err(e) = generate_barrel_loot_drops(ctx, barrel.pos_x, barrel.pos_y) {
            log::error!("[BarrelDamage] Failed to generate loot for barrel {}: {}", barrel_id, e);
        }
        
        // Emit destruction sound
        crate::sound_events::emit_stone_destroyed_sound(ctx, barrel.pos_x, barrel.pos_y, attacker_id);
    } else {
        // Barrel damaged but not destroyed
        log::info!("[BarrelDamage] Barrel {} damaged, health: {:.1}", barrel_id, barrel.health);
        
        // Emit hit sound
        crate::sound_events::emit_melee_hit_blunt_sound(ctx, barrel.pos_x, barrel.pos_y, attacker_id);
    }
    
    // Update the barrel
    barrels.id().update(barrel);
    
    Ok(())
}

// --- Reducers ---

/// Reducer for players to attack barrels
#[spacetimedb::reducer]
pub fn attack_barrel(ctx: &ReducerContext, barrel_id: u64) -> Result<(), String> {
    let sender_id = ctx.sender;
    let players = ctx.db.player();
    let barrels = ctx.db.barrel();
    
    log::info!("[AttackBarrel] Player {:?} attacking barrel {}", sender_id, barrel_id);
    
    // Find the player
    let player = players.identity().find(sender_id)
        .ok_or_else(|| "Player not found.".to_string())?;
    
    if player.is_dead {
        return Err("Cannot attack while dead.".to_string());
    }
    
    // Find the barrel
    let mut barrel = barrels.id().find(barrel_id)
        .ok_or_else(|| format!("Barrel with ID {} not found.", barrel_id))?;
    
    if barrel.health <= 0.0 {
        return Err("Barrel is already destroyed.".to_string());
    }
    
    // Check distance
    let distance_sq = get_distance_squared(
        player.position_x, 
        player.position_y, 
        barrel.pos_x, 
        barrel.pos_y - BARREL_COLLISION_Y_OFFSET
    );
    
    if distance_sq > PLAYER_BARREL_INTERACTION_DISTANCE_SQUARED {
        return Err("Too far away from barrel.".to_string());
    }
    
    // Check attack cooldown
    if let Some(last_hit) = barrel.last_hit_time {
        let elapsed_ms = (ctx.timestamp.to_micros_since_unix_epoch() - last_hit.to_micros_since_unix_epoch()) / 1000;
        if elapsed_ms < (BARREL_ATTACK_COOLDOWN_MS * 1000) as i64 { // Convert to microseconds and cast to i64
            return Err("Barrel was hit too recently.".to_string());
        }
    }
    
    // Apply damage
    barrel.health -= BARREL_DAMAGE_PER_HIT;
    barrel.last_hit_time = Some(ctx.timestamp);
    
    if barrel.health <= 0.0 {
        barrel.health = 0.0;
        // Set respawn timer
        let respawn_time = ctx.timestamp.to_micros_since_unix_epoch() + (BARREL_RESPAWN_TIME_SECONDS as i64 * 1_000_000);
        barrel.respawn_at = Some(Timestamp::from_micros_since_unix_epoch(respawn_time));
        
        log::info!("[AttackBarrel] Barrel {} destroyed by player {:?}, will respawn in {} seconds", 
                  barrel_id, sender_id, BARREL_RESPAWN_TIME_SECONDS);
        
        // Generate loot drops
        if let Err(e) = generate_barrel_loot_drops(ctx, barrel.pos_x, barrel.pos_y) {
            log::error!("[AttackBarrel] Failed to generate loot for barrel {}: {}", barrel_id, e);
        }
        
        // Emit destruction sound - using StoneDestroyed as closest match
        crate::sound_events::emit_stone_destroyed_sound(ctx, barrel.pos_x, barrel.pos_y, sender_id);
    } else {
        log::info!("[AttackBarrel] Barrel {} damaged, health: {:.1}", barrel_id, barrel.health);
        
        // Emit hit sound - using MeleeHitBlunt as closest match
        crate::sound_events::emit_melee_hit_blunt_sound(ctx, barrel.pos_x, barrel.pos_y, sender_id);
    }
    
    // Update the barrel
    barrels.id().update(barrel);
    
    Ok(())
}

/// Scheduled reducer to respawn destroyed barrels
#[spacetimedb::reducer]
pub fn respawn_destroyed_barrels(ctx: &ReducerContext, _schedule: BarrelRespawnSchedule) -> Result<(), String> {
    let current_time = ctx.timestamp;
    let barrels = ctx.db.barrel();
    let mut respawned_count = 0;
    
    log::trace!("[BarrelRespawn] Checking for barrels to respawn at {:?}", current_time);
    
    // Find all destroyed barrels that should respawn
    let barrels_to_respawn: Vec<_> = barrels.iter()
        .filter(|barrel| {
            barrel.health <= 0.0 && 
            barrel.respawn_at.is_some() && 
            barrel.respawn_at.unwrap().to_micros_since_unix_epoch() <= current_time.to_micros_since_unix_epoch()
        })
        .collect();
    
    for mut barrel in barrels_to_respawn {
        // Reset barrel state
        barrel.health = BARREL_INITIAL_HEALTH;
        barrel.respawn_at = None;
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
        
        schedule_table.insert(BarrelRespawnSchedule {
            id: 0, // Auto-incremented
            scheduled_at: ScheduleAt::Interval(check_interval.into()),
        });
    } else {
        log::debug!("Barrel respawn system already initialized");
    }
    
    Ok(())
}

// --- Spawning Functions (called from environment.rs) ---

/// Spawns barrel clusters on dirt road tiles during world generation
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
    
    // PvP BALANCE: Very conservative spawn rate for contested resources
    // Target: 3-6 clusters total (8-18 barrels max) regardless of map size
    let target_cluster_count = std::cmp::min(6, std::cmp::max(3, dirt_road_tiles.len() / 50)); // 1 cluster per ~50 dirt road tiles + hard cap at 6
    let max_attempts = target_cluster_count * 3;
    
    log::info!("[BarrelSpawn] Attempting to spawn {} barrel clusters from {} dirt road tiles", 
              target_cluster_count, dirt_road_tiles.len());
    
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
        
        // Determine cluster size (1-3 barrels)
        let cluster_size = ctx.rng().gen_range(1..=3);
        
        // Try to spawn the cluster
        if spawn_barrel_cluster_at_position(ctx, center_x, center_y, cluster_size, next_cluster_id)? {
            cluster_positions.push((center_x, center_y));
            spawned_clusters += 1;
            next_cluster_id += 1;
            
            log::info!("[BarrelSpawn] Spawned cluster {} with {} barrels at ({:.1}, {:.1})", 
                      next_cluster_id - 1, cluster_size, center_x, center_y);
        }
    }
    
    let total_barrels = barrels.iter().count();
    log::info!("[BarrelSpawn] Finished spawning {} barrel clusters ({} total barrels) after {} attempts", 
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
        // Check for collisions
        if has_barrel_collision(ctx, center_x, center_y, None) ||
           has_player_barrel_collision(ctx, center_x, center_y) {
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
            
            // Check for collisions
            if has_barrel_collision(ctx, barrel_x, barrel_y, None) ||
               has_player_barrel_collision(ctx, barrel_x, barrel_y) {
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
            respawn_at: None,
            cluster_id,
        };
        
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