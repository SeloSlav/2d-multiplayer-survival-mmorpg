use spacetimedb::{Identity, ReducerContext, Table};
use crate::active_equipment::{ActiveEquipment, active_equipment as ActiveEquipmentTableTrait};
use crate::items::{ItemDefinition, item_definition as ItemDefinitionTableTrait, InventoryItem, inventory_item as InventoryItemTableTrait};
use crate::models::EquipmentSlotType; // For matching slot types if needed in future extensions
use log;

/// Calculates the total damage resistance from all equipped armor pieces.
/// Resistance is a float (e.g., 0.1 for 10%), and they stack additively for now.
pub fn calculate_total_damage_resistance(ctx: &ReducerContext, player_id: Identity) -> f32 {
    let active_equipments = ctx.db.active_equipment();
    let inventory_items = ctx.db.inventory_item();
    let item_defs = ctx.db.item_definition();
    let mut total_resistance = 0.0;

    if let Some(equipment) = active_equipments.player_identity().find(player_id) {
        let armor_instance_ids = [
            equipment.head_item_instance_id,
            equipment.chest_item_instance_id,
            equipment.legs_item_instance_id,
            equipment.feet_item_instance_id,
            equipment.hands_item_instance_id,
            equipment.back_item_instance_id,
        ];

        for maybe_instance_id in armor_instance_ids.iter().flatten() {
            if let Some(item_instance) = inventory_items.instance_id().find(*maybe_instance_id) {
                if let Some(item_def) = item_defs.id().find(item_instance.item_def_id) {
                    if let Some(resistance) = item_def.damage_resistance {
                        total_resistance += resistance;
                        log::trace!("[Armor] Player {:?} adding resistance {:.2}% from {} (Instance ID: {})", 
                                   player_id, resistance * 100.0, item_def.name, *maybe_instance_id);
                    }
                }
            }
        }
    }
    // Clamp resistance to a max (e.g., 90%) to prevent invulnerability
    total_resistance.min(0.9) 
}

/// Calculates the total warmth bonus from all equipped armor pieces.
/// Warmth bonus is a float value added to the player's warmth regeneration or subtracted from warmth loss.
pub fn calculate_total_warmth_bonus(ctx: &ReducerContext, player_id: Identity) -> f32 {
    let active_equipments = ctx.db.active_equipment();
    let inventory_items = ctx.db.inventory_item();
    let item_defs = ctx.db.item_definition();
    let mut total_warmth_bonus = 0.0;

    if let Some(equipment) = active_equipments.player_identity().find(player_id) {
        let armor_instance_ids = [
            equipment.head_item_instance_id,
            equipment.chest_item_instance_id,
            equipment.legs_item_instance_id,
            equipment.feet_item_instance_id,
            equipment.hands_item_instance_id,
            equipment.back_item_instance_id,
        ];

        for maybe_instance_id in armor_instance_ids.iter().flatten() {
            if let Some(item_instance) = inventory_items.instance_id().find(*maybe_instance_id) {
                if let Some(item_def) = item_defs.id().find(item_instance.item_def_id) {
                    if let Some(warmth) = item_def.warmth_bonus {
                        total_warmth_bonus += warmth;
                         log::trace!("[Armor] Player {:?} adding warmth bonus {:.2} from {} (Instance ID: {})", 
                                   player_id, warmth, item_def.name, *maybe_instance_id);
                    }
                }
            }
        }
    }
    total_warmth_bonus
}
