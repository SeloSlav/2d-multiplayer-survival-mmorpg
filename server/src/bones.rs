use spacetimedb::{ReducerContext, Identity, Table};
use log;
use rand::Rng;

use crate::items::{InventoryItem, ItemDefinition};
use crate::items::{inventory_item as InventoryItemTableTrait, item_definition as ItemDefinitionTableTrait};
use crate::dropped_item::try_give_item_to_player;

// Constants for bone crushing
const FRAGMENTS_PER_SKULL: u32 = 20; // Increased to 20
const MIN_FRAGMENTS_PER_BONE: u32 = 8; // New min value
const MAX_FRAGMENTS_PER_BONE: u32 = 12; // New max value

/// Crushes a bone or skull item into bone fragments.
/// If inventory is full, fragments will be dropped near the player.
#[spacetimedb::reducer]
pub fn crush_bone_item(ctx: &ReducerContext, item_instance_id: u64) -> Result<(), String> {
    let sender_id = ctx.sender;
    let inventory_table = ctx.db.inventory_item();
    let item_def_table = ctx.db.item_definition();

    // 1. Fetch and validate the item to crush
    let item_to_crush = inventory_table.instance_id().find(item_instance_id)
        .ok_or_else(|| format!("Item {} not found", item_instance_id))?;

    let item_def = item_def_table.id().find(item_to_crush.item_def_id)
        .ok_or_else(|| format!("Item definition {} not found", item_to_crush.item_def_id))?;

    // 2. Validate item ownership and type
    match item_def.name.as_str() {
        "Animal Bone" | "Human Skull" => {
            // Validate ownership through location
            match &item_to_crush.location {
                crate::models::ItemLocation::Inventory(data) if data.owner_id == sender_id => (),
                crate::models::ItemLocation::Hotbar(data) if data.owner_id == sender_id => (),
                crate::models::ItemLocation::Equipped(data) if data.owner_id == sender_id => (),
                _ => return Err("Item must be in your inventory, hotbar, or equipped to crush.".to_string()),
            }
        },
        _ => return Err(format!("Cannot crush item '{}'. Only Animal Bones and Human Skulls can be crushed.", item_def.name)),
    }

    // 3. Calculate number of fragments to create
    let fragments_to_create = match item_def.name.as_str() {
        "Animal Bone" => {
            // Use gen_range for a more idiomatic way to generate random numbers
            ctx.rng().gen_range(MIN_FRAGMENTS_PER_BONE..=MAX_FRAGMENTS_PER_BONE)
        },
        "Human Skull" => FRAGMENTS_PER_SKULL,
        _ => unreachable!(), // We already validated the item type
    };

    // Find the Bone Fragments item definition by name
    let bone_fragments_def = item_def_table.iter()
        .find(|def| def.name == "Bone Fragments")
        .ok_or_else(|| "Bone Fragments item definition not found".to_string())?;

    log::info!("[CrushBone] Player {} crushing {} into {} bone fragments", 
             sender_id, item_def.name, fragments_to_create);

    // 4. Update item quantity or delete if last one
    if item_to_crush.quantity > 1 {
        let mut updated_item = item_to_crush.clone();
        updated_item.quantity -= 1;
        inventory_table.instance_id().update(updated_item);
    } else {
        // Delete the item if it's the last one
        inventory_table.instance_id().delete(item_instance_id);
    }

    // 5. Give fragments to player (or drop near them if inventory full)
    match try_give_item_to_player(ctx, sender_id, bone_fragments_def.id, fragments_to_create) {
        Ok(added_to_inventory) => {
            if added_to_inventory {
                log::info!("[CrushBone] Added {} bone fragments to inventory for player {}", fragments_to_create, sender_id);
            } else {
                log::info!("[CrushBone] Inventory full, dropped {} bone fragments near player {}", fragments_to_create, sender_id);
            }
            Ok(())
        },
        Err(e) => Err(format!("Failed to give bone fragments to player: {}", e))
    }
} 