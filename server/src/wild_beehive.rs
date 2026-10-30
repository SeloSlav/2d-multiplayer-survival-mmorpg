//! # Wild Beehive Loot Containers
//! 
//! This module handles wild beehive containers that spawn in forest tiles
//! very close to trees. They contain 3 slots and spawn with 1-4 pieces of
//! Honeycomb (never Honey or Queen Bees - those must be extracted/cooked).
//! They respawn after looting and disappear when emptied.
//! 
//! Bees spawn at beehives when players approach - they are aggressive defenders
//! that can only be killed by fire (torches or campfires).

use spacetimedb::{ReducerContext, SpacetimeType, Table, Timestamp, Identity, TimeDuration};
use spacetimedb::spacetimedb_lib::ScheduleAt;
use log;
use rand::Rng;

use crate::wooden_storage_box::{
    WoodenStorageBox, BOX_TYPE_WILD_BEEHIVE, NUM_WILD_BEEHIVE_SLOTS,
    WILD_BEEHIVE_INITIAL_HEALTH, WILD_BEEHIVE_MAX_HEALTH,
    wooden_storage_box as WoodenStorageBoxTableTrait,
};
use crate::items::{
    InventoryItem, item_definition as ItemDefinitionTableTrait,
    inventory_item as InventoryItemTableTrait,
};
use crate::environment::{calculate_chunk_index, is_position_on_forest_tile};
use crate::models::ItemLocation;
use crate::inventory_management::is_container_empty;
use crate::tree::{tree as TreeTableTrait, TREE_COLLISION_Y_OFFSET};

// --- Constants ---

/// Minimum distance from a tree for beehive spawning (in pixels)
const MIN_TREE_DISTANCE: f32 = 30.0;
/// Maximum distance from a tree for beehive spawning (in pixels)  
const MAX_TREE_DISTANCE: f32 = 80.0;
/// Minimum distance squared
const MIN_TREE_DISTANCE_SQ: f32 = MIN_TREE_DISTANCE * MIN_TREE_DISTANCE;
/// Maximum distance squared
const MAX_TREE_DISTANCE_SQ: f32 = MAX_TREE_DISTANCE * MAX_TREE_DISTANCE;

/// Minimum distance between beehives (avoid clustering)
const MIN_BEEHIVE_DISTANCE: f32 = 200.0;
const MIN_BEEHIVE_DISTANCE_SQ: f32 = MIN_BEEHIVE_DISTANCE * MIN_BEEHIVE_DISTANCE;

/// Respawn time range (5-15 minutes)
const MIN_RESPAWN_SECS: u64 = 300;  // 5 minutes
const MAX_RESPAWN_SECS: u64 = 900;  // 15 minutes

// --- Respawn Schedule Table ---

#[spacetimedb::table(accessor = wild_beehive_respawn_schedule, scheduled(respawn_wild_beehives))]
#[derive(Clone)]
pub struct WildBeehiveRespawnSchedule {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: ScheduleAt,
    pub pos_x: f32,
    pub pos_y: f32,
    pub chunk_index: u32,
}

// --- Spawn Function ---

/// Spawns a wild beehive container with honeycomb at the specified position
/// Returns the box ID on success
pub fn spawn_wild_beehive_with_loot(
    ctx: &ReducerContext,
    pos_x: f32,
    pos_y: f32,
    chunk_index: u32,
) -> Result<u32, String> {
    if crate::indoors::blocks_world_spawn(ctx, pos_x, pos_y) { return Err("World loot cannot spawn inside a building".into()); }
    // Verify position is on a forest tile
    if !is_position_on_forest_tile(ctx, pos_x, pos_y) {
        return Err("Wild beehives can only spawn on forest tiles".to_string());
    }
    
    // Check if position is on water
    if crate::environment::is_position_on_water(ctx, pos_x, pos_y) {
        return Err("Cannot spawn wild beehive on water".to_string());
    }
    
    let item_defs = ctx.db.item_definition();
    let inventory_items = ctx.db.inventory_item();
    let boxes = ctx.db.wooden_storage_box();
    
    // Find the Honeycomb item definition
    let honeycomb_def = item_defs.iter()
        .find(|def| def.name == "Honeycomb")
        .ok_or_else(|| "Honeycomb item definition not found".to_string())?;
    
    // Determine how many honeycomb to spawn (1-4)
    // Distribution: ~30% for 1, ~35% for 2, ~25% for 3, ~10% for 4
    let honeycomb_count = {
        let roll: f32 = ctx.rng().gen();
        if roll < 0.30 {
            1 // 30% chance
        } else if roll < 0.65 {
            2 // 35% chance
        } else if roll < 0.90 {
            3 // 25% chance
        } else {
            4 // 10% chance
        }
    };
    
    // Create the wild beehive container
    let mut beehive = WoodenStorageBox {
        id: 0, // auto_inc
        pos_x,
        pos_y,
        chunk_index,
        placed_by: ctx.identity(), // System-placed
        box_type: BOX_TYPE_WILD_BEEHIVE,
        // Initialize all slots as empty
        slot_instance_id_0: None, slot_def_id_0: None,
        slot_instance_id_1: None, slot_def_id_1: None,
        slot_instance_id_2: None, slot_def_id_2: None,
        // Unused slots (beehive only uses 0-2)
        slot_instance_id_3: None, slot_def_id_3: None,
        slot_instance_id_4: None, slot_def_id_4: None,
        slot_instance_id_5: None, slot_def_id_5: None,
        slot_instance_id_6: None, slot_def_id_6: None,
        slot_instance_id_7: None, slot_def_id_7: None,
        slot_instance_id_8: None, slot_def_id_8: None,
        slot_instance_id_9: None, slot_def_id_9: None,
        slot_instance_id_10: None, slot_def_id_10: None,
        slot_instance_id_11: None, slot_def_id_11: None,
        slot_instance_id_12: None, slot_def_id_12: None,
        slot_instance_id_13: None, slot_def_id_13: None,
        slot_instance_id_14: None, slot_def_id_14: None,
        slot_instance_id_15: None, slot_def_id_15: None,
        slot_instance_id_16: None, slot_def_id_16: None,
        slot_instance_id_17: None, slot_def_id_17: None,
        slot_instance_id_18: None, slot_def_id_18: None,
        slot_instance_id_19: None, slot_def_id_19: None,
        slot_instance_id_20: None, slot_def_id_20: None,
        slot_instance_id_21: None, slot_def_id_21: None,
        slot_instance_id_22: None, slot_def_id_22: None,
        slot_instance_id_23: None, slot_def_id_23: None,
        slot_instance_id_24: None, slot_def_id_24: None,
        slot_instance_id_25: None, slot_def_id_25: None,
        slot_instance_id_26: None, slot_def_id_26: None,
        slot_instance_id_27: None, slot_def_id_27: None,
        slot_instance_id_28: None, slot_def_id_28: None,
        slot_instance_id_29: None, slot_def_id_29: None,
        slot_instance_id_30: None, slot_def_id_30: None,
        slot_instance_id_31: None, slot_def_id_31: None,
        slot_instance_id_32: None, slot_def_id_32: None,
        slot_instance_id_33: None, slot_def_id_33: None,
        slot_instance_id_34: None, slot_def_id_34: None,
        slot_instance_id_35: None, slot_def_id_35: None,
        slot_instance_id_36: None, slot_def_id_36: None,
        slot_instance_id_37: None, slot_def_id_37: None,
        slot_instance_id_38: None, slot_def_id_38: None,
        slot_instance_id_39: None, slot_def_id_39: None,
        slot_instance_id_40: None, slot_def_id_40: None,
        slot_instance_id_41: None, slot_def_id_41: None,
        slot_instance_id_42: None, slot_def_id_42: None,
        slot_instance_id_43: None, slot_def_id_43: None,
        slot_instance_id_44: None, slot_def_id_44: None,
        slot_instance_id_45: None, slot_def_id_45: None,
        slot_instance_id_46: None, slot_def_id_46: None,
        slot_instance_id_47: None, slot_def_id_47: None,
        health: WILD_BEEHIVE_INITIAL_HEALTH,
        max_health: WILD_BEEHIVE_MAX_HEALTH,
        is_destroyed: false,
        destroyed_at: None,
        last_hit_time: None,
        last_damaged_by: None,
        respawn_at: Timestamp::UNIX_EPOCH, // 0 = not respawning yet
        is_monument: false,
        active_user_id: None,
        active_user_since: None,
    };
    
    // Distribute honeycomb across slots (1-2 per slot to use multiple slots if >2)
    let mut remaining = honeycomb_count;
    let mut slot_index = 0u8;
    
    while remaining > 0 && slot_index < NUM_WILD_BEEHIVE_SLOTS as u8 {
        // Put 1-2 honeycomb per slot
        let quantity = if remaining >= 2 && slot_index < 2 {
            // For first two slots, sometimes split to spread across slots
            if ctx.rng().gen::<f32>() < 0.5 && remaining > 2 {
                1
            } else {
                remaining.min(2)
            }
        } else {
            remaining
        };
        
        // Create inventory item
        let new_item = InventoryItem {
            instance_id: 0, // Will be assigned by insert
            item_def_id: honeycomb_def.id,
            quantity,
            location: ItemLocation::Container(crate::models::ContainerLocationData {
                container_type: crate::models::ContainerType::WoodenStorageBox,
                container_id: 0, // Will be updated after box is inserted
                slot_index,
            }),
            item_data: None,
        };
        
        let inserted_item = inventory_items.insert(new_item);
        
        // Update beehive slot
        match slot_index {
            0 => {
                beehive.slot_instance_id_0 = Some(inserted_item.instance_id);
                beehive.slot_def_id_0 = Some(inserted_item.item_def_id);
            }
            1 => {
                beehive.slot_instance_id_1 = Some(inserted_item.instance_id);
                beehive.slot_def_id_1 = Some(inserted_item.item_def_id);
            }
            2 => {
                beehive.slot_instance_id_2 = Some(inserted_item.instance_id);
                beehive.slot_def_id_2 = Some(inserted_item.item_def_id);
            }
            _ => break,
        }
        
        remaining -= quantity;
        slot_index += 1;
    }
    
    // Insert the beehive box
    let inserted_beehive = boxes.insert(beehive);
    
    // Update item locations with actual container ID
    if let Some(item_id) = inserted_beehive.slot_instance_id_0 {
        if let Some(mut item) = inventory_items.instance_id().find(&item_id) {
            if let ItemLocation::Container(ref mut loc_data) = item.location {
                loc_data.container_id = inserted_beehive.id as u64;
            }
            inventory_items.instance_id().update(item);
        }
    }
    if let Some(item_id) = inserted_beehive.slot_instance_id_1 {
        if let Some(mut item) = inventory_items.instance_id().find(&item_id) {
            if let ItemLocation::Container(ref mut loc_data) = item.location {
                loc_data.container_id = inserted_beehive.id as u64;
            }
            inventory_items.instance_id().update(item);
        }
    }
    if let Some(item_id) = inserted_beehive.slot_instance_id_2 {
        if let Some(mut item) = inventory_items.instance_id().find(&item_id) {
            if let ItemLocation::Container(ref mut loc_data) = item.location {
                loc_data.container_id = inserted_beehive.id as u64;
            }
            inventory_items.instance_id().update(item);
        }
    }
    
    log::info!(
        "[WildBeehive] Spawned wild beehive {} at ({:.1}, {:.1}) with {} honeycomb",
        inserted_beehive.id, pos_x, pos_y, honeycomb_count
    );
    
    // Spawn bees to guard the hive (2-3 bees per hive)
    let bee_count = ctx.rng().gen_range(2..=3);
    match crate::wild_animal_npc::bee::spawn_bees_at_hive(
        ctx, 
        inserted_beehive.id as u64, 
        pos_x, 
        pos_y, 
        bee_count, 
        &mut ctx.rng()
    ) {
        Ok(bee_ids) => {
            log::info!(
                "[WildBeehive] Spawned {} bees to guard beehive {}",
                bee_ids.len(), inserted_beehive.id
            );
            
            // Start buzzing sound since bees are present at wild beehives
            // Visual center Y is slightly above the container position (similar to placed beehives)
            let visual_center_y = pos_y - 20.0;
            crate::sound_events::start_beehive_sound(ctx, inserted_beehive.id as u64, pos_x, visual_center_y);
        }
        Err(e) => {
            log::warn!(
                "[WildBeehive] Failed to spawn bees for beehive {}: {}",
                inserted_beehive.id, e
            );
        }
    }
    
    Ok(inserted_beehive.id)
}

/// Simple wrapper to spawn a wild beehive at a position with automatic chunk calculation
pub fn spawn_wild_beehive_at_position(
    ctx: &ReducerContext,
    pos_x: f32,
    pos_y: f32,
) -> Result<u32, String> {
    let chunk_index = calculate_chunk_index(pos_x, pos_y);
    spawn_wild_beehive_with_loot(ctx, pos_x, pos_y, chunk_index)
}

// --- Auto-Deletion Function ---

/// Checks if a wild beehive is empty and deletes it if so
/// Also schedules respawn if the beehive was fully looted
pub fn check_and_despawn_wild_beehive_if_empty(
    ctx: &ReducerContext,
    beehive_id: u32,
) -> Result<(), String> {
    let beehive = ctx.db.wooden_storage_box().id().find(beehive_id)
        .ok_or("Wild beehive not found")?;
    
    if beehive.box_type != BOX_TYPE_WILD_BEEHIVE {
        return Ok(()); // Not a wild beehive
    }
    
    // Check if all slots are empty
    if is_container_empty(&beehive) {
        // Check if this was a system-placed beehive (not player-placed)
        let was_system_placed = beehive.placed_by == ctx.identity();
        
        if was_system_placed {
            // Schedule respawn (5-15 minutes)
            let respawn_delay_secs = ctx.rng().gen_range(MIN_RESPAWN_SECS..=MAX_RESPAWN_SECS);
            let respawn_time = ctx.timestamp + TimeDuration::from_micros((respawn_delay_secs * 1_000_000) as i64);
            
            // Create respawn schedule entry
            let schedule_entry = WildBeehiveRespawnSchedule {
                scheduled_id: 0, // auto_inc
                scheduled_at: ScheduleAt::Time(respawn_time),
                pos_x: beehive.pos_x,
                pos_y: beehive.pos_y,
                chunk_index: beehive.chunk_index,
            };
            
            ctx.db.wild_beehive_respawn_schedule().insert(schedule_entry);
            log::info!("[WildBeehive] Scheduled respawn for wild beehive {} at ({:.1}, {:.1}) in {} seconds", 
                      beehive_id, beehive.pos_x, beehive.pos_y, respawn_delay_secs);
        }
        
        // Stop the buzzing sound before deleting
        crate::sound_events::stop_beehive_sound(ctx, beehive_id as u64);
        
        ctx.db.wooden_storage_box().id().delete(beehive_id);
        log::info!("[WildBeehive] Auto-despawned empty wild beehive {}", beehive_id);
    }
    
    Ok(())
}

// --- Scheduled Reducer for Respawn ---

#[spacetimedb::reducer]
pub fn respawn_wild_beehives(ctx: &ReducerContext, schedule: WildBeehiveRespawnSchedule) -> Result<(), String> {
    // Security check: only the scheduler should call this
    if ctx.sender() != ctx.identity() {
        return Err("Respawn reducer may only be called by the scheduler".to_string());
    }
    
    // Respawn the wild beehive at the stored location
    match spawn_wild_beehive_with_loot(ctx, schedule.pos_x, schedule.pos_y, schedule.chunk_index) {
        Ok(_) => {
            log::info!("[WildBeehive] Respawned wild beehive at ({:.1}, {:.1})", 
                      schedule.pos_x, schedule.pos_y);
        }
        Err(e) => {
            log::warn!("[WildBeehive] Failed to respawn wild beehive at ({:.1}, {:.1}): {}", 
                      schedule.pos_x, schedule.pos_y, e);
        }
    }
    
    Ok(())
}

// --- World Generation Helper ---

/// Finds a valid position for a wild beehive at the base of a tree in a forest tile.
/// Beehives always spawn at ground level (tree base Y); only horizontal offset varies.
/// Returns Some((x, y)) if found, None if no valid position
pub fn find_beehive_spawn_position_near_tree(
    ctx: &ReducerContext,
    tree_x: f32,
    tree_y: f32,
    existing_beehive_positions: &[(f32, f32)],
) -> Option<(f32, f32)> {
    // Try a few random horizontal offsets from the tree base
    for _ in 0..5 {
        // Use only horizontal offset - beehives spawn at tree base, never up the trunk
        let angle: f32 = ctx.rng().gen::<f32>() * std::f32::consts::TAU;
        let distance = ctx.rng().gen_range(MIN_TREE_DISTANCE..MAX_TREE_DISTANCE);
        
        let pos_x = tree_x + angle.cos() * distance;
        // Always at tree base: Y must be >= tree_y (never spawn up the trunk/canopy)
        // Small ground-level jitter: 0–15 px below base for natural variation
        let pos_y = tree_y + ctx.rng().gen_range(0.0..15.0);
        
        // Must be on forest tile
        if !is_position_on_forest_tile(ctx, pos_x, pos_y) {
            continue;
        }
        
        // Must not be on water
        if crate::environment::is_position_on_water(ctx, pos_x, pos_y) {
            continue;
        }
        
        // Must not be too close to another beehive
        let too_close = existing_beehive_positions.iter().any(|(bx, by)| {
            let dx = pos_x - bx;
            let dy = pos_y - by;
            dx * dx + dy * dy < MIN_BEEHIVE_DISTANCE_SQ
        });
        
        if too_close {
            continue;
        }
        
        return Some((pos_x, pos_y));
    }
    
    None
}

/// Spawns wild beehives during world generation
/// Called from environment.rs after trees are spawned
/// Target: approximately 1 beehive per 15-20 trees in forest areas
pub fn spawn_wild_beehives_in_forests(
    ctx: &ReducerContext,
    spawned_tree_positions: &[(f32, f32)],
) -> u32 {
    let mut spawned_count = 0u32;
    let mut beehive_positions: Vec<(f32, f32)> = Vec::new();
    
    // Filter to only trees on forest tiles
    let forest_trees: Vec<(f32, f32)> = spawned_tree_positions.iter()
        .filter(|(x, y)| is_position_on_forest_tile(ctx, *x, *y))
        .copied()
        .collect();
    
    if forest_trees.is_empty() {
        log::info!("[WildBeehive] No forest trees found, skipping beehive spawning");
        return 0;
    }
    
    // Target: 1 beehive per ~15 forest trees (sparse but meaningful)
    let target_beehives = (forest_trees.len() / 15).max(1);
    
    log::info!("[WildBeehive] Attempting to spawn ~{} beehives near {} forest trees", 
              target_beehives, forest_trees.len());
    
    // Shuffle tree order for random selection
    let mut tree_indices: Vec<usize> = (0..forest_trees.len()).collect();
    for i in (1..tree_indices.len()).rev() {
        let j = ctx.rng().gen_range(0..=i);
        tree_indices.swap(i, j);
    }
    
    for &tree_idx in &tree_indices {
        if spawned_count >= target_beehives as u32 {
            break;
        }
        
        let (tree_x, tree_y) = forest_trees[tree_idx];
        
        // Try to find a valid spawn position near this tree
        if let Some((spawn_x, spawn_y)) = find_beehive_spawn_position_near_tree(
            ctx, tree_x, tree_y, &beehive_positions
        ) {
            let chunk_index = calculate_chunk_index(spawn_x, spawn_y);
            
            match spawn_wild_beehive_with_loot(ctx, spawn_x, spawn_y, chunk_index) {
                Ok(_) => {
                    beehive_positions.push((spawn_x, spawn_y));
                    spawned_count += 1;
                }
                Err(e) => {
                    log::debug!("[WildBeehive] Failed to spawn at ({:.1}, {:.1}): {}", 
                              spawn_x, spawn_y, e);
                }
            }
        }
    }
    
    log::info!("[WildBeehive] Spawned {} wild beehives in forest areas", spawned_count);
    spawned_count
}
