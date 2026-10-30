//! # Mine Cart Loot Containers
//! 
//! This module handles mine cart containers that spawn exclusively in quarry areas
//! (large and small quarries). They contain 3 slots and spawn with mining-related
//! loot: pickaxes, hatchets, tallow, headlamps, metal fragments, metal ore, stone.

use spacetimedb::{ReducerContext, SpacetimeType, Table, Timestamp, Identity, TimeDuration};
use spacetimedb::spacetimedb_lib::ScheduleAt;
use log;
use rand::Rng;

use crate::wooden_storage_box::{
    WoodenStorageBox, BOX_TYPE_MINE_CART, NUM_MINE_CART_SLOTS,
    MINE_CART_INITIAL_HEALTH, MINE_CART_MAX_HEALTH,
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

#[spacetimedb::table(accessor = mine_cart_respawn_schedule, scheduled(respawn_mine_carts))]
#[derive(Clone)]
pub struct MineCartRespawnSchedule {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: ScheduleAt,
    pub spawn_location_type: String,  // "large_quarry", "small_quarry"
    pub pos_x: f32,
    pub pos_y: f32,
    pub chunk_index: u32,
}

// --- Loot Table Structure ---

#[derive(SpacetimeType, Clone, Debug)]
pub struct MineCartLootEntry {
    pub item_def_name: String,  // Mining equipment item name
    pub min_quantity: u32,
    pub max_quantity: u32,
    pub spawn_chance: f32,      // 0.0 to 1.0
}

// --- Mining Equipment Loot Table ---

/// Returns the loot table for mine carts
/// Contains pickaxes, hatchets, tallow, headlamp, ores, and stone
fn get_mine_cart_loot_table() -> Vec<MineCartLootEntry> {
    vec![
        // Common materials (high chance)
        MineCartLootEntry {
            item_def_name: "Stone".to_string(),
            min_quantity: 15,
            max_quantity: 40,
            spawn_chance: 0.30, // 30% chance
        },
        MineCartLootEntry {
            item_def_name: "Metal Fragments".to_string(),
            min_quantity: 8,
            max_quantity: 20,
            spawn_chance: 0.25, // 25% chance
        },
        MineCartLootEntry {
            item_def_name: "Metal Ore".to_string(),
            min_quantity: 5,
            max_quantity: 15,
            spawn_chance: 0.20, // 20% chance
        },
        // Uncommon tools (medium chance)
        MineCartLootEntry {
            item_def_name: "Stone Pickaxe".to_string(),
            min_quantity: 1,
            max_quantity: 1,
            spawn_chance: 0.12, // 12% chance
        },
        MineCartLootEntry {
            item_def_name: "Stone Hatchet".to_string(),
            min_quantity: 1,
            max_quantity: 1,
            spawn_chance: 0.12, // 12% chance
        },
        MineCartLootEntry {
            item_def_name: "Tallow".to_string(),
            min_quantity: 3,
            max_quantity: 8,
            spawn_chance: 0.15, // 15% chance
        },
        // Rare tools (low chance)
        MineCartLootEntry {
            item_def_name: "Metal Pickaxe".to_string(),
            min_quantity: 1,
            max_quantity: 1,
            spawn_chance: 0.06, // 6% chance
        },
        MineCartLootEntry {
            item_def_name: "Metal Hatchet".to_string(),
            min_quantity: 1,
            max_quantity: 1,
            spawn_chance: 0.06, // 6% chance
        },
        MineCartLootEntry {
            item_def_name: "Headlamp".to_string(),
            min_quantity: 1,
            max_quantity: 1,
            spawn_chance: 0.08, // 8% chance
        },
        MineCartLootEntry {
            item_def_name: "Flashlight".to_string(),
            min_quantity: 1,
            max_quantity: 1,
            spawn_chance: 0.07, // 7% chance
        },
        MineCartLootEntry {
            item_def_name: "Gunpowder".to_string(),
            min_quantity: 5,
            max_quantity: 15,
            spawn_chance: 0.12, // 12% chance
        },
    ]
}

// --- Spawn Function ---

/// Spawns a mine cart container with loot at the specified position
/// Returns the box ID on success
pub fn spawn_mine_cart_with_loot(
    ctx: &ReducerContext,
    pos_x: f32,
    pos_y: f32,
    chunk_index: u32,
) -> Result<u32, String> {
    if crate::indoors::blocks_world_spawn(ctx, pos_x, pos_y) { return Err("World loot cannot spawn inside a building".into()); }
    let loot_table = get_mine_cart_loot_table();
    let item_defs = ctx.db.item_definition();
    let inventory_items = ctx.db.inventory_item();
    let boxes = ctx.db.wooden_storage_box();
    
    // Determine how many items to spawn (typically 1-2, up to 3, never 0)
    // Distribution: ~55% chance for 1 item, ~35% chance for 2 items, ~10% chance for 3 items
    let item_count = {
        let roll: f32 = ctx.rng().gen();
        if roll < 0.55 {
            1 // 55% chance
        } else if roll < 0.90 {
            2 // 35% chance
        } else {
            3 // 10% chance
        }
    };
    
    // Create the mine cart container
    let mut cart = WoodenStorageBox {
        id: 0, // auto_inc
        pos_x,
        pos_y,
        chunk_index,
        placed_by: ctx.identity(), // System-placed
        box_type: BOX_TYPE_MINE_CART,
        // Initialize all slots as empty
        slot_instance_id_0: None, slot_def_id_0: None,
        slot_instance_id_1: None, slot_def_id_1: None,
        slot_instance_id_2: None, slot_def_id_2: None,
        // Large box slots (unused for mine carts)
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
        health: MINE_CART_INITIAL_HEALTH,
        max_health: MINE_CART_MAX_HEALTH,
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
    while items_spawned < item_count && slot_index < NUM_MINE_CART_SLOTS as u8 {
        // Select a random loot entry weighted by spawn chance
        let mut selected_entry: Option<&MineCartLootEntry> = None;
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
        
        // Determine quantity (range between min and max)
        let quantity = if loot_entry.min_quantity == loot_entry.max_quantity {
            loot_entry.min_quantity
        } else {
            ctx.rng().gen_range(loot_entry.min_quantity..=loot_entry.max_quantity)
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
        
        // Update cart slot
        match slot_index {
            0 => {
                cart.slot_instance_id_0 = Some(inserted_item.instance_id);
                cart.slot_def_id_0 = Some(inserted_item.item_def_id);
            }
            1 => {
                cart.slot_instance_id_1 = Some(inserted_item.instance_id);
                cart.slot_def_id_1 = Some(inserted_item.item_def_id);
            }
            2 => {
                cart.slot_instance_id_2 = Some(inserted_item.instance_id);
                cart.slot_def_id_2 = Some(inserted_item.item_def_id);
            }
            _ => return Err("Invalid slot index".to_string()),
        }
        
        slot_index += 1;
        items_spawned += 1;
    }
    
    // Ensure we spawned at least 1 item (safety check)
    if items_spawned == 0 {
        // Force spawn at least one item
        let loot_entry = &loot_table[0]; // Use first entry (Stone)
        let item_def = item_defs.iter()
            .find(|def| def.name == loot_entry.item_def_name)
            .ok_or_else(|| format!("Item definition not found: {}", loot_entry.item_def_name))?;
        
        let quantity = loot_entry.min_quantity;
        
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
        cart.slot_instance_id_0 = Some(inserted_item.instance_id);
        cart.slot_def_id_0 = Some(inserted_item.item_def_id);
        items_spawned = 1;
    }
    
    // Insert the mine cart box
    let inserted_cart = boxes.insert(cart);
    
    // Update item locations with actual container ID
    if let Some(item_id) = inserted_cart.slot_instance_id_0 {
        if let Some(mut item) = inventory_items.instance_id().find(&item_id) {
            if let ItemLocation::Container(ref mut loc_data) = item.location {
                loc_data.container_id = inserted_cart.id as u64;
            }
            inventory_items.instance_id().update(item);
        }
    }
    if let Some(item_id) = inserted_cart.slot_instance_id_1 {
        if let Some(mut item) = inventory_items.instance_id().find(&item_id) {
            if let ItemLocation::Container(ref mut loc_data) = item.location {
                loc_data.container_id = inserted_cart.id as u64;
            }
            inventory_items.instance_id().update(item);
        }
    }
    if let Some(item_id) = inserted_cart.slot_instance_id_2 {
        if let Some(mut item) = inventory_items.instance_id().find(&item_id) {
            if let ItemLocation::Container(ref mut loc_data) = item.location {
                loc_data.container_id = inserted_cart.id as u64;
            }
            inventory_items.instance_id().update(item);
        }
    }
    
    log::info!(
        "[MineCart] Spawned mine cart {} at ({:.1}, {:.1}) with {} items",
        inserted_cart.id, pos_x, pos_y, items_spawned
    );
    
    Ok(inserted_cart.id)
}

// --- Auto-Deletion Function ---

/// Checks if a mine cart is empty and deletes it if so
/// Also schedules respawn if the cart was fully looted
pub fn check_and_despawn_mine_cart_if_empty(
    ctx: &ReducerContext,
    cart_id: u32,
) -> Result<(), String> {
    let cart = ctx.db.wooden_storage_box().id().find(cart_id)
        .ok_or("Mine cart not found")?;
    
    if cart.box_type != BOX_TYPE_MINE_CART {
        return Ok(()); // Not a mine cart
    }
    
    // Check if all slots are empty
    if is_container_empty(&cart) {
        // Check if this was a system-placed cart (not player-placed)
        let was_system_placed = cart.placed_by == ctx.identity();
        
        if was_system_placed {
            // Determine spawn location type (default to large_quarry)
            let spawn_location_type = "quarry".to_string();
            
            // Schedule respawn (5-10 minutes)
            let respawn_delay_secs = ctx.rng().gen_range(300..=600); // 5-10 minutes
            let respawn_time = ctx.timestamp + TimeDuration::from_micros(respawn_delay_secs * 1_000_000);
            
            // Create respawn schedule entry
            let schedule_entry = MineCartRespawnSchedule {
                scheduled_id: 0, // auto_inc
                scheduled_at: ScheduleAt::Time(respawn_time),
                spawn_location_type,
                pos_x: cart.pos_x,
                pos_y: cart.pos_y,
                chunk_index: cart.chunk_index,
            };
            
            ctx.db.mine_cart_respawn_schedule().insert(schedule_entry);
            log::info!("[MineCart] Scheduled respawn for mine cart {} at ({:.1}, {:.1})", 
                      cart_id, cart.pos_x, cart.pos_y);
        }
        
        ctx.db.wooden_storage_box().id().delete(cart_id);
        log::info!("[MineCart] Auto-despawned empty mine cart {}", cart_id);
    }
    
    Ok(())
}

// --- Scheduled Reducer for Respawn ---

#[spacetimedb::reducer]
pub fn respawn_mine_carts(ctx: &ReducerContext, schedule: MineCartRespawnSchedule) -> Result<(), String> {
    // Security check: only the scheduler should call this
    if ctx.sender() != ctx.identity() {
        return Err("Respawn reducer may only be called by the scheduler".to_string());
    }
    
    // Respawn the mine cart at the stored location
    match spawn_mine_cart_with_loot(ctx, schedule.pos_x, schedule.pos_y, schedule.chunk_index) {
        Ok(_) => {
            log::info!("[MineCart] Respawned mine cart at ({:.1}, {:.1}) from {} location", 
                      schedule.pos_x, schedule.pos_y, schedule.spawn_location_type);
        }
        Err(e) => {
            log::warn!("[MineCart] Failed to respawn mine cart at ({:.1}, {:.1}): {}", 
                      schedule.pos_x, schedule.pos_y, e);
        }
    }
    
    Ok(())
}
