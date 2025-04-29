use spacetimedb::{Identity, ReducerContext};
use spacetimedb::Table;
use log;

// Import needed Item types and Table Traits
use crate::items::{ItemDefinition, InventoryItem, EquipmentSlot, item_definition as ItemDefinitionTableTrait, inventory_item as InventoryItemTableTrait};
// Import ActiveEquipment types and Table Trait
use crate::active_equipment::{ActiveEquipment, active_equipment as ActiveEquipmentTableTrait};

/// Grants the predefined starting items (inventory/hotbar) and starting equipment to a newly registered player.
pub(crate) fn grant_starting_items(ctx: &ReducerContext, player_id: Identity, username: &str) -> Result<(), String> {
    log::info!("[GrantItems] Granting starting items & equipment to player {} ({:?})...", username, player_id);

    let item_defs = ctx.db.item_definition();
    let inventory = ctx.db.inventory_item();

    // --- Grant Inventory/Hotbar Items --- 
    // Define the items to go into inventory/hotbar slots
    // Format: (item_name: &str, quantity: u32, hotbar_slot: Option<u8>, inventory_slot: Option<u16>)
    let starting_inv_items = [
        // Hotbar (Slots 0-5)
        // ("Rock", 1, Some(0u8), None), 
        ("Stone Hatchet", 1, Some(1u8), None), 
        ("Stone Pickaxe", 1, Some(2u8), None),
       
        ("Wooden Storage Box", 1, Some(3u8), None), 
        ("Camp Fire", 1, Some(4u8), None),
        ("Sleeping Bag", 1, Some(5u8), None),
        
        // Starting materials in Inventory (Slots 0-23 typically)
        // ("Wood", 600, None, Some(12u16)), 
        // ("Wood", 500, None, Some(13u16)), 
        // ("Stone", 500, None, Some(14u16)),
    ];

    log::info!("[GrantItems] Defined {} starting inventory/hotbar item entries.", starting_inv_items.len());

    for (item_name, quantity, hotbar_slot_opt, inventory_slot_opt) in starting_inv_items.iter() {
         log::debug!("[GrantItems] Processing inv/hotbar entry: {}", item_name);
        if let Some(item_def) = item_defs.iter().find(|def| def.name == *item_name) {
            let item_to_insert = InventoryItem { 
                instance_id: 0,
                player_identity: player_id, 
                item_def_id: item_def.id,
                quantity: *quantity,
                hotbar_slot: *hotbar_slot_opt,
                inventory_slot: *inventory_slot_opt,
            };
            match inventory.try_insert(item_to_insert) {
                Ok(_) => {
                     log::info!("[GrantItems] Granted inv/hotbar: {} (Qty: {}, H: {:?}, I: {:?}) to player {:?}", 
                                 item_name, quantity, hotbar_slot_opt, inventory_slot_opt, player_id);
                },
                Err(e) => {
                    log::error!("[GrantItems] FAILED inv/hotbar insert for {} for player {:?}: {}", item_name, player_id, e);
                }
            }
        } else {
            log::error!("[GrantItems] Definition NOT FOUND for inv/hotbar item: {} for player {:?}", item_name, player_id);
        }
    }

    // --- Grant Starting Equipment --- 
    log::info!("[GrantItems] Equipping starting armor for player {:?}", player_id);
    let active_equip_table = ctx.db.active_equipment();
    
    // Find or create the ActiveEquipment row for the player
    let mut found_existing_entry = true; // Assume we find one initially
    let mut equip_entry = match active_equip_table.player_identity().find(player_id) {
        Some(entry) => entry, // Existing entry found
        None => {
            found_existing_entry = false; // Mark that we created a new one
            // Create a default entry if none exists
            log::info!("[GrantItems] No ActiveEquipment found for player {:?}, creating default.", player_id);
            ActiveEquipment {
                player_identity: player_id,
                equipped_item_instance_id: None,
                equipped_item_def_id: None,
                swing_start_time_ms: 0,
                head_item_instance_id: None,
                chest_item_instance_id: None,
                legs_item_instance_id: None,
                feet_item_instance_id: None,
                hands_item_instance_id: None,
                back_item_instance_id: None,
            }
        }
    };
    let mut equipment_updated = false; // Track if we modify the entry

    // Define the starting equipment: (item_name, equipment_slot)
    let starting_equipment = [
        ("Cloth Hood", EquipmentSlot::Head),
        ("Cloth Shirt", EquipmentSlot::Chest),
        ("Cloth Pants", EquipmentSlot::Legs),
        ("Cloth Boots", EquipmentSlot::Feet),
        ("Cloth Gloves", EquipmentSlot::Hands),
        ("Burlap Backpack", EquipmentSlot::Back),
    ];

    for (item_name, target_slot) in starting_equipment.iter() {
        log::debug!("[GrantItems] Processing equipment entry: {}", item_name);
        if let Some(item_def) = item_defs.iter().find(|def| def.name == *item_name) {
            // Create the InventoryItem instance (unslotted)
            let item_to_equip = InventoryItem {
                instance_id: 0, // Auto-inc
                player_identity: player_id,
                item_def_id: item_def.id,
                quantity: 1, // Equipment is typically quantity 1
                hotbar_slot: None, // Not in hotbar
                inventory_slot: None, // Not in inventory
            };
            match inventory.try_insert(item_to_equip) {
                Ok(inserted_item) => {
                    let new_instance_id = inserted_item.instance_id;
                    log::info!("[GrantItems] Created InventoryItem (ID: {}) for equipping {} to player {:?}", new_instance_id, item_name, player_id);
                    // Update the correct slot in the equip_entry struct
                    match target_slot {
                        EquipmentSlot::Head => equip_entry.head_item_instance_id = Some(new_instance_id),
                        EquipmentSlot::Chest => equip_entry.chest_item_instance_id = Some(new_instance_id),
                        EquipmentSlot::Legs => equip_entry.legs_item_instance_id = Some(new_instance_id),
                        EquipmentSlot::Feet => equip_entry.feet_item_instance_id = Some(new_instance_id),
                        EquipmentSlot::Hands => equip_entry.hands_item_instance_id = Some(new_instance_id),
                        EquipmentSlot::Back => equip_entry.back_item_instance_id = Some(new_instance_id),
                    }
                    equipment_updated = true;
                },
                Err(e) => {
                    log::error!("[GrantItems] FAILED to insert InventoryItem for equipping {} for player {:?}: {}", item_name, player_id, e);
                }
            }
        } else {
            log::error!("[GrantItems] Definition NOT FOUND for equipment item: {} for player {:?}", item_name, player_id);
        }
    }

    // If we modified the equipment entry, update or insert it in the table
    if equipment_updated {
        if found_existing_entry {
            log::info!("[GrantItems] Updating existing ActiveEquipment entry for player {:?}", player_id);
            active_equip_table.player_identity().update(equip_entry);
        } else {
            log::info!("[GrantItems] Inserting new ActiveEquipment entry for player {:?}", player_id);
            // Use insert for the newly created entry
            match active_equip_table.try_insert(equip_entry) {
                Ok(_) => { /* Successfully inserted */ },
                Err(e) => {
                    // Log error if insert fails (e.g., race condition if another process inserted just now)
                    log::error!("[GrantItems] FAILED to insert new ActiveEquipment entry for player {:?}: {}", player_id, e);
                }
            }
        }
    } else if !found_existing_entry {
        // If we created a default entry but didn't add any equipment (e.g., due to item def errors),
        // we still need to insert the default row.
        log::info!("[GrantItems] Inserting default (unmodified) ActiveEquipment entry for player {:?}", player_id);
        match active_equip_table.try_insert(equip_entry) {
            Ok(_) => { /* Successfully inserted */ },
            Err(e) => {
                log::error!("[GrantItems] FAILED to insert default ActiveEquipment entry for player {:?}: {}", player_id, e);
            }
        }
    }

    log::info!("[GrantItems] Finished granting items & equipment to player {}.", username);
    Ok(()) // Indicate overall success (individual errors logged)
} 