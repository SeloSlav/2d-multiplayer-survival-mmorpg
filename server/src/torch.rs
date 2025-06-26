use spacetimedb::{ReducerContext, Identity, Timestamp, Table, log};
// Import necessary table traits
use crate::player;
use crate::active_equipment::active_equipment;
use crate::items::item_definition;
use crate::sound_events;

// Torch warmth constant (matches player_stats.rs)
// Neutralizes night cold (-1.5) but midnight (-2.0) still causes slow warmth loss
pub const TORCH_WARMTH_PER_SECOND: f32 = 1.75;

#[spacetimedb::reducer]
pub fn toggle_torch(ctx: &ReducerContext) -> Result<(), String> {
    let sender_id = ctx.sender;
    let mut players_table = ctx.db.player();
    let mut active_equipments_table = ctx.db.active_equipment();
    let item_defs_table = ctx.db.item_definition();

    let mut player = players_table.identity().find(&sender_id)
        .ok_or_else(|| "Player not found.".to_string())?;

    // Don't allow torch toggle if dead or knocked out
    if player.is_dead {
        return Err("Cannot toggle torch while dead.".to_string());
    }
    if player.is_knocked_out {
        return Err("Cannot toggle torch while knocked out.".to_string());
    }

    let mut equipment = active_equipments_table.player_identity().find(&sender_id)
        .ok_or_else(|| "Player has no active equipment record.".to_string())?;

    match equipment.equipped_item_def_id {
        Some(item_def_id) => {
            let item_def = item_defs_table.id().find(item_def_id)
                .ok_or_else(|| "Equipped item definition not found.".to_string())?;

            if item_def.name != "Torch" {
                return Err("Cannot toggle: Not a Torch.".to_string());
            }

            // Toggle the lit state
            player.is_torch_lit = !player.is_torch_lit;
            // ADD: Update player's last_update timestamp
            player.last_update = ctx.timestamp;

            // Update icon based on new lit state and play sounds
            if player.is_torch_lit {
                equipment.icon_asset_name = Some("torch_on.png".to_string());
                sound_events::emit_light_torch_sound(ctx, player.position_x, player.position_y, sender_id);
                log::info!("Player {:?} lit their torch.", sender_id);
            } else {
                equipment.icon_asset_name = Some("torch.png".to_string());
                sound_events::emit_extinguish_torch_sound(ctx, player.position_x, player.position_y, sender_id);
                log::info!("Player {:?} extinguished their torch.", sender_id);
            }

            // Update player and equipment records
            players_table.identity().update(player);
            active_equipments_table.player_identity().update(equipment);

            Ok(())
        }
        None => Err("No item equipped to toggle.".to_string()),
    }
}