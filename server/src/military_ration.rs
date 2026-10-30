//! # Military Ration Loot Crates
//! 
//! This module handles military ration containers that spawn as loot crates
//! in various locations (roads, monuments, quarries). They contain 3 slots
//! and typically spawn with 1-2 food items (up to 3, never 0), with small
//! stacks (1-2 max per item, mostly 1).

use spacetimedb::{ReducerContext, SpacetimeType, Table, Timestamp, Identity, TimeDuration};
use spacetimedb::spacetimedb_lib::ScheduleAt;
use log;
use rand::Rng;

use crate::wooden_storage_box::{
    WoodenStorageBox, BOX_TYPE_MILITARY_RATION, BOX_TYPE_MILITARY_CRATE,
    NUM_MILITARY_RATION_SLOTS,
    MILITARY_RATION_INITIAL_HEALTH, MILITARY_RATION_MAX_HEALTH,
    MILITARY_CRATE_INITIAL_HEALTH, MILITARY_CRATE_MAX_HEALTH,
    wooden_storage_box as WoodenStorageBoxTableTrait,
};
use crate::items::{
    InventoryItem, item_definition as ItemDefinitionTableTrait,
    inventory_item as InventoryItemTableTrait,
};
use crate::environment::calculate_chunk_index;
use crate::models::ItemLocation;
use crate::inventory_management::is_container_empty;

// --- Respawn Schedule Table ---

#[spacetimedb::table(accessor = military_ration_respawn_schedule, scheduled(respawn_military_rations))]
#[derive(Clone)]
pub struct MilitaryRationRespawnSchedule {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: ScheduleAt,
    pub spawn_location_type: String,  // "road", "shipwreck", "quarry"
    pub pos_x: f32,
    pub pos_y: f32,
    pub chunk_index: u32,
}

#[spacetimedb::table(accessor = military_crate_respawn_schedule, scheduled(respawn_military_crates))]
#[derive(Clone)]
pub struct MilitaryCrateRespawnSchedule {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: ScheduleAt,
    pub pos_x: f32,
    pub pos_y: f32,
    pub chunk_index: u32,
}

// --- Loot Table Structure ---

#[derive(SpacetimeType, Clone, Debug)]
pub struct MilitaryRationLootEntry {
    pub item_def_name: String,  // Food item name
    pub min_quantity: u32,
    pub max_quantity: u32,
    pub spawn_chance: f32,      // 0.0 to 1.0
}

// --- Food Loot Table ---

/// Returns the loot table for military rations
/// Focuses on Russian IRP (Individual Ration Pack) items - canned foods, preserved goods,
/// drinks, and accessories that would realistically be found in military ration containers
fn get_military_ration_loot_table() -> Vec<MilitaryRationLootEntry> {
    vec![
        // === CORE FOOD ITEMS (Common) ===
        MilitaryRationLootEntry {
            item_def_name: "Canned Meat".to_string(),
            min_quantity: 1,
            max_quantity: 1,
            spawn_chance: 0.35, // 35% - primary protein source
        },
        MilitaryRationLootEntry {
            item_def_name: "Canned Kasha".to_string(),
            min_quantity: 1,
            max_quantity: 1,
            spawn_chance: 0.40, // 40% - extremely common in Russian rations
        },
        MilitaryRationLootEntry {
            item_def_name: "Canned Pate".to_string(),
            min_quantity: 1,
            max_quantity: 1,
            spawn_chance: 0.30, // 30% - common spread
        },
        MilitaryRationLootEntry {
            item_def_name: "Condensed Milk".to_string(),
            min_quantity: 1,
            max_quantity: 1,
            spawn_chance: 0.35, // 35% - beloved morale booster
        },
        MilitaryRationLootEntry {
            item_def_name: "Fruit Jam".to_string(),
            min_quantity: 1,
            max_quantity: 2,
            spawn_chance: 0.28, // 28% - common sweet
        },
        MilitaryRationLootEntry {
            item_def_name: "Old Hardtack Biscuits".to_string(),
            min_quantity: 1,
            max_quantity: 2,
            spawn_chance: 0.38, // 38% - very common in military rations
        },
        MilitaryRationLootEntry {
            item_def_name: "Expired Soviet Chocolate".to_string(),
            min_quantity: 1,
            max_quantity: 1,
            spawn_chance: 0.22, // 22% - common morale boost item
        },
        
        // === DRINKS (Moderate) ===
        MilitaryRationLootEntry {
            item_def_name: "Black Tea Tin".to_string(),
            min_quantity: 1,
            max_quantity: 1,
            spawn_chance: 0.32, // 32% - common drink
        },
        MilitaryRationLootEntry {
            item_def_name: "Instant Coffee Tin".to_string(),
            min_quantity: 1,
            max_quantity: 1,
            spawn_chance: 0.25, // 25% - common alternative drink
        },
        MilitaryRationLootEntry {
            item_def_name: "Vitamin Drink".to_string(),
            min_quantity: 1,
            max_quantity: 1,
            spawn_chance: 0.18, // 18% - newer IRPs only
        },
        
        // === SMALL ITEMS (Common) ===
        MilitaryRationLootEntry {
            item_def_name: "Sugar Packets".to_string(),
            min_quantity: 2,
            max_quantity: 4,
            spawn_chance: 0.45, // 45% - always included
        },
        MilitaryRationLootEntry {
            item_def_name: "Salt and Pepper Pack".to_string(),
            min_quantity: 1,
            max_quantity: 2,
            spawn_chance: 0.40, // 40% - common accessory
        },
        MilitaryRationLootEntry {
            item_def_name: "Validol Tablets".to_string(),
            min_quantity: 1,
            max_quantity: 2,
            spawn_chance: 0.18, // 18% - insanity countermeasure (valuable but not common)
        },
        MilitaryRationLootEntry {
            item_def_name: "Med Kit".to_string(),
            min_quantity: 1,
            max_quantity: 1,
            spawn_chance: 0.12, // 12% - military first aid kit (rare but expected in military supplies)
        },
        MilitaryRationLootEntry {
            item_def_name: "Chewing Gum".to_string(),
            min_quantity: 1,
            max_quantity: 3,
            spawn_chance: 0.30, // 30% - common morale item
        },
        
        // === JUNK ITEMS (Very Common) ===
        MilitaryRationLootEntry {
            item_def_name: "Broken Lighter".to_string(),
            min_quantity: 1,
            max_quantity: 1,
            spawn_chance: 0.20, // 20% - broken accessory
        },
        MilitaryRationLootEntry {
            item_def_name: "Wet Wipes Pack".to_string(),
            min_quantity: 1,
            max_quantity: 1,
            spawn_chance: 0.35, // 35% - hygiene item
        },
        MilitaryRationLootEntry {
            item_def_name: "Paper Napkins".to_string(),
            min_quantity: 1,
            max_quantity: 2,
            spawn_chance: 0.42, // 42% - always included
        },
        MilitaryRationLootEntry {
            item_def_name: "Plastic Spoon".to_string(),
            min_quantity: 1,
            max_quantity: 1,
            spawn_chance: 0.48, // 48% - very common utensil
        },
        
        // === LEGACY ITEMS (Keep existing variety) ===
        MilitaryRationLootEntry {
            item_def_name: "Tin of Sprats in Oil".to_string(),
            min_quantity: 1,
            max_quantity: 1,
            spawn_chance: 0.15, // 15% chance
        },
        MilitaryRationLootEntry {
            item_def_name: "Fermented Cabbage Jar".to_string(),
            min_quantity: 1,
            max_quantity: 1,
            spawn_chance: 0.08, // 8% chance
        },
    ]
}

// --- Spawn Function ---

/// Spawns a military ration container with loot at the specified position
/// Returns the box ID on success
pub fn spawn_military_ration_with_loot(
    ctx: &ReducerContext,
    pos_x: f32,
    pos_y: f32,
    chunk_index: u32,
) -> Result<u32, String> {
    if crate::indoors::blocks_world_spawn(ctx, pos_x, pos_y) { return Err("World loot cannot spawn inside a building".into()); }
    // Check if position is on water - military rations cannot spawn in water
    if crate::environment::is_position_on_water(ctx, pos_x, pos_y) {
        return Err("Cannot spawn military ration on water".to_string());
    }
    
    let loot_table = get_military_ration_loot_table();
    let item_defs = ctx.db.item_definition();
    let inventory_items = ctx.db.inventory_item();
    let boxes = ctx.db.wooden_storage_box();
    
    // Determine how many items to spawn (typically 1-2, up to 3, never 0)
    // Distribution: ~60% chance for 1 item, ~35% chance for 2 items, ~5% chance for 3 items
    let item_count = {
        let roll: f32 = ctx.rng().gen();
        if roll < 0.60 {
            1 // 60% chance
        } else if roll < 0.95 {
            2 // 35% chance
        } else {
            3 // 5% chance
        }
    };
    
    // Create the military ration container
    let mut ration = WoodenStorageBox {
        id: 0, // auto_inc
        pos_x,
        pos_y,
        chunk_index,
        placed_by: ctx.identity(), // System-placed
        box_type: BOX_TYPE_MILITARY_RATION,
        // Initialize all slots as empty
        slot_instance_id_0: None, slot_def_id_0: None,
        slot_instance_id_1: None, slot_def_id_1: None,
        slot_instance_id_2: None, slot_def_id_2: None,
        // Large box slots (unused for military rations)
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
        health: MILITARY_RATION_INITIAL_HEALTH,
        max_health: MILITARY_RATION_MAX_HEALTH,
        is_destroyed: false,
        destroyed_at: None,
        last_hit_time: None,
        last_damaged_by: None,
        respawn_at: Timestamp::UNIX_EPOCH, // 0 = not respawning yet
        is_monument: false,
        active_user_id: None,
        active_user_since: None,
    };
    
    // Fill slots with loot - spawn exactly item_count items
    let mut slot_index = 0u8;
    let mut items_spawned = 0;
    
    // Spawn items one at a time until we reach item_count
    while items_spawned < item_count && slot_index < NUM_MILITARY_RATION_SLOTS as u8 {
        // Select a random loot entry weighted by spawn chance
        let mut selected_entry: Option<&MilitaryRationLootEntry> = None;
        let mut total_weight = 0.0;
        
        // Calculate total weight
        for entry in &loot_table {
            total_weight += entry.spawn_chance;
        }
        
        // Select entry based on weighted random
        let mut roll: f32 = ctx.rng().gen::<f32>() * total_weight;
        for entry in &loot_table {
            roll -= entry.spawn_chance;
            if roll <= 0.0 {
                selected_entry = Some(entry);
                break;
            }
        }
        
        // Fallback to first entry if none selected (shouldn't happen, but safety)
        let loot_entry = selected_entry.unwrap_or(&loot_table[0]);
        
        // Find the item definition
        let item_def = item_defs.iter()
            .find(|def| def.name == loot_entry.item_def_name)
            .ok_or_else(|| format!("Item definition not found: {}", loot_entry.item_def_name))?;
        
        // Determine quantity (mostly 1, occasionally 2)
        let quantity = {
            let qty_roll: f32 = ctx.rng().gen();
            if qty_roll < 0.75 {
                loot_entry.min_quantity // 75% chance for min (usually 1)
            } else {
                loot_entry.max_quantity.min(2) // 25% chance for max, capped at 2
            }
        };
        
        // Create inventory item
        let new_item = InventoryItem {
            instance_id: 0, // Will be assigned by insert
            item_def_id: item_def.id,
            quantity,
            location: ItemLocation::Container(crate::models::ContainerLocationData {
                container_type: crate::models::ContainerType::WoodenStorageBox,
                container_id: 0, // Will be updated after box is inserted
                slot_index,
            }),
            item_data: None,
        };
        
        let inserted_item = inventory_items.insert(new_item);
        
        // Update ration slot
        match slot_index {
            0 => {
                ration.slot_instance_id_0 = Some(inserted_item.instance_id);
                ration.slot_def_id_0 = Some(inserted_item.item_def_id);
            }
            1 => {
                ration.slot_instance_id_1 = Some(inserted_item.instance_id);
                ration.slot_def_id_1 = Some(inserted_item.item_def_id);
            }
            2 => {
                ration.slot_instance_id_2 = Some(inserted_item.instance_id);
                ration.slot_def_id_2 = Some(inserted_item.item_def_id);
            }
            _ => return Err("Invalid slot index".to_string()),
        }
        
        slot_index += 1;
        items_spawned += 1;
    }
    
    // Ensure we spawned at least 1 item (safety check)
    if items_spawned == 0 {
        // Force spawn at least one item
        let loot_entry = &loot_table[0]; // Use first entry (Potato - raw tuber)
        let item_def = item_defs.iter()
            .find(|def| def.name == loot_entry.item_def_name)
            .ok_or_else(|| format!("Item definition not found: {}", loot_entry.item_def_name))?;
        
        let quantity = loot_entry.min_quantity; // Usually 1
        
        let new_item = InventoryItem {
            instance_id: 0,
            item_def_id: item_def.id,
            quantity,
            location: ItemLocation::Container(crate::models::ContainerLocationData {
                container_type: crate::models::ContainerType::WoodenStorageBox,
                container_id: 0,
                slot_index: 0,
            }),
            item_data: None,
        };
        
        let inserted_item = inventory_items.insert(new_item);
        ration.slot_instance_id_0 = Some(inserted_item.instance_id);
        ration.slot_def_id_0 = Some(inserted_item.item_def_id);
        items_spawned = 1;
    }
    
    // Insert the ration box
    let inserted_ration = boxes.insert(ration);
    
    // Update item locations with actual container ID
    if let Some(item_id) = inserted_ration.slot_instance_id_0 {
        if let Some(mut item) = inventory_items.instance_id().find(&item_id) {
            if let ItemLocation::Container(ref mut loc_data) = item.location {
                loc_data.container_id = inserted_ration.id as u64;
            }
            inventory_items.instance_id().update(item);
        }
    }
    if let Some(item_id) = inserted_ration.slot_instance_id_1 {
        if let Some(mut item) = inventory_items.instance_id().find(&item_id) {
            if let ItemLocation::Container(ref mut loc_data) = item.location {
                loc_data.container_id = inserted_ration.id as u64;
            }
            inventory_items.instance_id().update(item);
        }
    }
    if let Some(item_id) = inserted_ration.slot_instance_id_2 {
        if let Some(mut item) = inventory_items.instance_id().find(&item_id) {
            if let ItemLocation::Container(ref mut loc_data) = item.location {
                loc_data.container_id = inserted_ration.id as u64;
            }
            inventory_items.instance_id().update(item);
        }
    }
    
    log::info!(
        "[MilitaryRation] Spawned military ration {} at ({:.1}, {:.1}) with {} items",
        inserted_ration.id, pos_x, pos_y, items_spawned
    );
    
    Ok(inserted_ration.id)
}

/// Simple wrapper to spawn a military ration at a position with automatic chunk calculation
/// Used for spawning loot crates at hot springs and other monuments
pub fn spawn_military_ration_at_position(
    ctx: &ReducerContext,
    pos_x: f32,
    pos_y: f32,
) -> Result<u32, String> {
    let chunk_index = calculate_chunk_index(pos_x, pos_y);
    spawn_military_ration_with_loot(ctx, pos_x, pos_y, chunk_index)
}

// --- Auto-Deletion Function ---

/// Checks if a military ration is empty and deletes it if so
/// Also schedules respawn if the ration was fully looted (all slots had items)
pub fn check_and_despawn_military_ration_if_empty(
    ctx: &ReducerContext,
    ration_id: u32,
) -> Result<(), String> {
    let ration = ctx.db.wooden_storage_box().id().find(ration_id)
        .ok_or("Military ration not found")?;
    
    if ration.box_type != BOX_TYPE_MILITARY_RATION {
        return Ok(()); // Not a military ration
    }
    
    // Check if all slots are empty
    if is_container_empty(&ration) {
        // Check if this was a system-placed ration (not player-placed)
        let was_system_placed = ration.placed_by == ctx.identity();
        
        if was_system_placed {
            // Determine spawn location type based on context
            // For now, we'll use "road" as default (can be enhanced later)
            let spawn_location_type = "road".to_string();
            
            // Schedule respawn (5-10 minutes)
            let respawn_delay_secs = ctx.rng().gen_range(300..=600); // 5-10 minutes
            let respawn_time = ctx.timestamp + TimeDuration::from_micros(respawn_delay_secs * 1_000_000);
            
            // Create respawn schedule entry
            let schedule_entry = MilitaryRationRespawnSchedule {
                scheduled_id: 0, // auto_inc
                scheduled_at: ScheduleAt::Time(respawn_time),
                spawn_location_type,
                pos_x: ration.pos_x,
                pos_y: ration.pos_y,
                chunk_index: ration.chunk_index,
            };
            
            ctx.db.military_ration_respawn_schedule().insert(schedule_entry);
            log::info!("[MilitaryRation] Scheduled respawn for military ration {} at ({:.1}, {:.1})", 
                      ration_id, ration.pos_x, ration.pos_y);
        }
        
        ctx.db.wooden_storage_box().id().delete(ration_id);
        log::info!("[MilitaryRation] Auto-despawned empty military ration {}", ration_id);
    }
    
    Ok(())
}

// --- Scheduled Reducer for Respawn ---

#[spacetimedb::reducer]
pub fn respawn_military_rations(ctx: &ReducerContext, schedule: MilitaryRationRespawnSchedule) -> Result<(), String> {
    // Security check: only the scheduler should call this
    if ctx.sender() != ctx.identity() {
        return Err("Respawn reducer may only be called by the scheduler".to_string());
    }
    
    // Respawn the military ration at the stored location
    match spawn_military_ration_with_loot(ctx, schedule.pos_x, schedule.pos_y, schedule.chunk_index) {
        Ok(_) => {
            log::info!("[MilitaryRation] Respawned military ration at ({:.1}, {:.1}) from {} location", 
                      schedule.pos_x, schedule.pos_y, schedule.spawn_location_type);
        }
        Err(e) => {
            log::warn!("[MilitaryRation] Failed to respawn military ration at ({:.1}, {:.1}): {}", 
                      schedule.pos_x, schedule.pos_y, e);
        }
    }
    
    Ok(())
}

// =============================================================================
// MILITARY CRATE (1 high-tier weapon, 1hr respawn)
// =============================================================================

/// High-tier weapons that can spawn in military crates (Soviet military / barrel loot tier)
fn get_military_crate_weapon_pool() -> Vec<&'static str> {
    vec![
        "Naval Cutlass",
        "AK74 Bayonet",
        "Engineers Maul",
        "Military Crowbar",
    ]
}

/// Spawns a military crate (1 slot, at most 1 high-tier weapon) at the specified position.
/// Used for elite monument spawns. Returns the box ID on success.
pub fn spawn_military_crate_with_loot(
    ctx: &ReducerContext,
    pos_x: f32,
    pos_y: f32,
    chunk_index: u32,
) -> Result<u32, String> {
    if crate::indoors::blocks_world_spawn(ctx, pos_x, pos_y) { return Err("World loot cannot spawn inside a building".into()); }
    if crate::environment::is_position_on_water(ctx, pos_x, pos_y) {
        return Err("Cannot spawn military crate on water".to_string());
    }
    
    let weapon_pool = get_military_crate_weapon_pool();
    let item_defs = ctx.db.item_definition();
    let inventory_items = ctx.db.inventory_item();
    let boxes = ctx.db.wooden_storage_box();
    
    // 100% chance to spawn with 1 weapon (guaranteed high-tier loot)
    let spawn_weapon = true;
    
    let mut ration = WoodenStorageBox {
        id: 0,
        pos_x,
        pos_y,
        chunk_index,
        placed_by: ctx.identity(),
        box_type: BOX_TYPE_MILITARY_CRATE,
        slot_instance_id_0: None, slot_def_id_0: None,
        slot_instance_id_1: None, slot_def_id_1: None,
        slot_instance_id_2: None, slot_def_id_2: None,
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
        health: MILITARY_CRATE_INITIAL_HEALTH,
        max_health: MILITARY_CRATE_MAX_HEALTH,
        is_destroyed: false,
        destroyed_at: None,
        last_hit_time: None,
        last_damaged_by: None,
        respawn_at: Timestamp::UNIX_EPOCH,
        is_monument: false,
        active_user_id: None,
        active_user_since: None,
    };
    
    if spawn_weapon && !weapon_pool.is_empty() {
        let weapon_name = weapon_pool[ctx.rng().gen_range(0..weapon_pool.len())];
        if let Some(item_def) = item_defs.iter().find(|def| def.name == weapon_name) {
            let new_item = InventoryItem {
                instance_id: 0,
                item_def_id: item_def.id,
                quantity: 1,
                location: ItemLocation::Container(crate::models::ContainerLocationData {
                    container_type: crate::models::ContainerType::WoodenStorageBox,
                    container_id: 0,
                    slot_index: 0,
                }),
                item_data: None,
            };
            let inserted_item = inventory_items.insert(new_item);
            ration.slot_instance_id_0 = Some(inserted_item.instance_id);
            ration.slot_def_id_0 = Some(inserted_item.item_def_id);
        }
    }
    
    let inserted = boxes.insert(ration);
    
    if let Some(item_id) = inserted.slot_instance_id_0 {
        if let Some(mut item) = inventory_items.instance_id().find(&item_id) {
            if let ItemLocation::Container(ref mut loc_data) = item.location {
                loc_data.container_id = inserted.id as u64;
            }
            inventory_items.instance_id().update(item);
        }
    }
    
    log::info!("[MilitaryCrate] Spawned military crate {} at ({:.1}, {:.1})", inserted.id, pos_x, pos_y);
    Ok(inserted.id)
}

/// Checks if a military crate is empty and deletes it if so.
/// Schedules respawn in 1 hour (elite monument cooldown).
pub fn check_and_despawn_military_crate_if_empty(
    ctx: &ReducerContext,
    crate_id: u32,
) -> Result<(), String> {
    let ration = ctx.db.wooden_storage_box().id().find(crate_id)
        .ok_or("Military crate not found")?;
    
    if ration.box_type != BOX_TYPE_MILITARY_CRATE {
        return Ok(());
    }
    
    if is_container_empty(&ration) {
        let was_system_placed = ration.placed_by == ctx.identity();
        
        if was_system_placed {
            const RESPAWN_DELAY_SECS: u64 = 3600; // 1 hour
            let respawn_time = ctx.timestamp + TimeDuration::from_micros((RESPAWN_DELAY_SECS * 1_000_000) as i64);
            
            let schedule_entry = MilitaryCrateRespawnSchedule {
                scheduled_id: 0,
                scheduled_at: ScheduleAt::Time(respawn_time),
                pos_x: ration.pos_x,
                pos_y: ration.pos_y,
                chunk_index: ration.chunk_index,
            };
            
            ctx.db.military_crate_respawn_schedule().insert(schedule_entry);
            log::info!("[MilitaryCrate] Scheduled respawn in 1hr for crate {} at ({:.1}, {:.1})",
                      crate_id, ration.pos_x, ration.pos_y);
        }
        
        ctx.db.wooden_storage_box().id().delete(crate_id);
        log::info!("[MilitaryCrate] Auto-despawned empty military crate {}", crate_id);
    }
    
    Ok(())
}

#[spacetimedb::reducer]
pub fn respawn_military_crates(ctx: &ReducerContext, schedule: MilitaryCrateRespawnSchedule) -> Result<(), String> {
    if ctx.sender() != ctx.identity() {
        return Err("Respawn reducer may only be called by the scheduler".to_string());
    }
    
    match spawn_military_crate_with_loot(ctx, schedule.pos_x, schedule.pos_y, schedule.chunk_index) {
        Ok(_) => {
            log::info!("[MilitaryCrate] Respawned military crate at ({:.1}, {:.1})", schedule.pos_x, schedule.pos_y);
        }
        Err(e) => {
            log::warn!("[MilitaryCrate] Failed to respawn at ({:.1}, {:.1}): {}", schedule.pos_x, schedule.pos_y, e);
        }
    }
    
    Ok(())
}
