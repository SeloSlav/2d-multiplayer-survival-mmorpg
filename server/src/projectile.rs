use spacetimedb::{table, reducer, SpacetimeType, Identity, Timestamp, ReducerContext, Table, TimeDuration, ScheduleAt};
use std::f32::consts::PI;
use rand::{Rng, SeedableRng};

// Import the PlayerLastAttackTimestamp struct from root crate
use crate::PlayerLastAttackTimestamp;

// Import table accessor traits
use crate::player;
use crate::active_equipment::active_equipment;
use crate::items::item_definition;
use crate::items::inventory_item as inventory_item_table_accessor;
use crate::ranged_weapon_stats::ranged_weapon_stats;
use crate::player_last_attack_timestamp;
use crate::combat; // Import the combat module to use damage_player
use crate::dropped_item; // Import the dropped item module for creating dropped items
use crate::active_effects; // Import the active effects module for applying ammunition-based effects
use crate::active_effects::active_consumable_effect; // Import the trait for the table

#[table(name = projectile, public)]
#[derive(Clone, Debug)]
pub struct Projectile {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub owner_id: Identity,
    pub item_def_id: u64,
    pub ammo_def_id: u64, // NEW: The ammunition type that was fired (e.g., Wooden Arrow)
    pub start_time: Timestamp,
    pub start_pos_x: f32,
    pub start_pos_y: f32,
    pub velocity_x: f32,
    pub velocity_y: f32,
    pub max_range: f32,
}

// Scheduled table for projectile updates
#[table(name = projectile_update_schedule, scheduled(update_projectiles))]
#[derive(Clone, Debug)]
pub struct ProjectileUpdateSchedule {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub scheduled_at: ScheduleAt,
}

#[reducer]
pub fn init_projectile_system(ctx: &ReducerContext) -> Result<(), String> {
    // Only schedule if not already scheduled
    let schedule_table = ctx.db.projectile_update_schedule();
    if schedule_table.iter().count() == 0 {
        // Schedule projectile collision detection every 50ms
        let update_interval = TimeDuration::from_micros(50_000); // 50ms = 0.05 seconds
        schedule_table.insert(ProjectileUpdateSchedule {
            id: 0, // auto_inc
            scheduled_at: update_interval.into(),
        });
        log::info!("Projectile collision detection system initialized with 50ms updates");
    }
    Ok(())
}

#[reducer]
pub fn fire_projectile(ctx: &ReducerContext, target_world_x: f32, target_world_y: f32) -> Result<(), String> {
    let player_id = ctx.sender;
    
    // Find the player
    let player = ctx.db.player().identity().find(&player_id)
        .ok_or("Player not found")?;
    
    if player.is_dead {
        return Err("Dead players cannot fire projectiles".to_string());
    }

    // Get the equipped item and its definition
    let mut equipment = ctx.db.active_equipment().player_identity().find(&player_id)
        .ok_or("No active equipment record found for player.")?;
    
    let equipped_item_def_id = equipment.equipped_item_def_id
        .ok_or("No item definition ID in active equipment.")?;
    
    let item_def = ctx.db.item_definition().id().find(equipped_item_def_id)
        .ok_or("Equipped item definition not found.")?;

    // --- Check if it's a Ranged Weapon and if it's ready to fire ---
    if item_def.category != crate::items::ItemCategory::RangedWeapon {
        return Err("Equipped item is not a ranged weapon.".to_string());
    }

    if !equipment.is_ready_to_fire {
        return Err("Weapon is not loaded. Right-click to load ammunition.".to_string());
    }

    let loaded_ammo_def_id = equipment.loaded_ammo_def_id
        .ok_or("Weapon is not loaded correctly (missing ammo def ID).")?;

    // --- Consume Ammunition ---
    let inventory_items = ctx.db.inventory_item();
    let mut ammo_item_instance_id_to_consume: Option<u64> = None;
    let mut ammo_item_current_quantity: u32 = 0;

    for item in inventory_items.iter() {
        if item.item_def_id == loaded_ammo_def_id && item.quantity > 0 {
            match &item.location {
                crate::models::ItemLocation::Inventory(loc_data) if loc_data.owner_id == player_id => {
                    ammo_item_instance_id_to_consume = Some(item.instance_id);
                    ammo_item_current_quantity = item.quantity;
                    break;
                }
                crate::models::ItemLocation::Hotbar(loc_data) if loc_data.owner_id == player_id => {
                    ammo_item_instance_id_to_consume = Some(item.instance_id);
                    ammo_item_current_quantity = item.quantity;
                    break;
                }
                _ => {} // Not in player's inventory or hotbar
            }
        }
    }

    if let Some(instance_id) = ammo_item_instance_id_to_consume {
        if ammo_item_current_quantity > 1 {
            let mut item_to_update = inventory_items.instance_id().find(instance_id).unwrap(); // Should exist
            item_to_update.quantity -= 1;
            inventory_items.instance_id().update(item_to_update);
            log::info!("Player {:?} consumed 1 ammunition (def_id: {}). {} remaining.", 
                player_id, loaded_ammo_def_id, ammo_item_current_quantity - 1);
        } else {
            inventory_items.instance_id().delete(instance_id);
            log::info!("Player {:?} consumed last ammunition (def_id: {}). Item instance deleted.", 
                player_id, loaded_ammo_def_id);
        }
    } else {
        // This case should ideally not be reached if is_ready_to_fire was true,
        // but as a safeguard:
        equipment.is_ready_to_fire = false;
        equipment.loaded_ammo_def_id = None;
        ctx.db.active_equipment().player_identity().update(equipment);
        return Err("No loaded ammunition found in inventory to consume, despite weapon being marked as ready. Weapon unloaded.".to_string());
    }

    // --- Update ActiveEquipment: Weapon is now unloaded ---
    equipment.is_ready_to_fire = false;
    equipment.loaded_ammo_def_id = None;
    ctx.db.active_equipment().player_identity().update(equipment);
    // --- End Ammunition Consumption & Weapon Unload ---
 
    let weapon_stats = ctx.db.ranged_weapon_stats().item_name().find(&item_def.name)
        .ok_or(format!("Ranged weapon stats not found for: {}", item_def.name))?;

    // Check reload time
    if let Some(last_attack_record) = ctx.db.player_last_attack_timestamp().player_id().find(&player_id) {
        let time_since_last_attack = ctx.timestamp.to_micros_since_unix_epoch() - last_attack_record.last_attack_timestamp.to_micros_since_unix_epoch();
        let required_reload_time_micros = (weapon_stats.reload_time_secs * 1_000_000.0) as i64;
        
        if time_since_last_attack < required_reload_time_micros {
            return Err("Weapon is still reloading".to_string());
        }
    }

    // Calculate direction vector
    let dx = target_world_x - player.position_x;
    let dy = target_world_y - player.position_y;
    let distance = (dx * dx + dy * dy).sqrt();

    if distance > weapon_stats.weapon_range {
        return Err("Target is out of range".to_string());
    }

    if distance < 1.0 {
        return Err("Target too close".to_string());
    }

    // Normalize direction and apply accuracy
    let norm_dx = dx / distance;
    let norm_dy = dy / distance;

    // Apply accuracy spread (simple random spread)
    let spread_angle = (1.0 - weapon_stats.accuracy) * PI / 4.0; // Max 45 degree spread for 0 accuracy
    let spread = (ctx.timestamp.to_micros_since_unix_epoch() % 1000) as f32 / 1000.0 - 0.5; // Simple pseudo-random
    let angle_offset = spread * spread_angle;
    
    let cos_offset = angle_offset.cos();
    let sin_offset = angle_offset.sin();
    
    let final_dx = norm_dx * cos_offset - norm_dy * sin_offset;
    let final_dy = norm_dx * sin_offset + norm_dy * cos_offset;

    // Create projectile
    let projectile = Projectile {
        id: 0, // auto_inc
        owner_id: player_id,
        item_def_id: equipped_item_def_id,
        ammo_def_id: loaded_ammo_def_id, // Store the ammunition type that was fired
        start_time: ctx.timestamp,
        start_pos_x: player.position_x,
        start_pos_y: player.position_y,
        velocity_x: final_dx * weapon_stats.projectile_speed,
        velocity_y: final_dy * weapon_stats.projectile_speed,
        max_range: weapon_stats.weapon_range,
    };

    ctx.db.projectile().insert(projectile);

    // Update last attack timestamp
    let timestamp_record = PlayerLastAttackTimestamp {
        player_id,
        last_attack_timestamp: ctx.timestamp,
    };
    
    if ctx.db.player_last_attack_timestamp().player_id().find(&player_id).is_some() {
        ctx.db.player_last_attack_timestamp().player_id().update(timestamp_record);
    } else {
        ctx.db.player_last_attack_timestamp().insert(timestamp_record);
    }

    log::info!("Projectile fired from player {} towards ({:.1}, {:.1})", player_id.to_string(), target_world_x, target_world_y);
    Ok(())
}

// --- BEGIN NEW HELPER FUNCTION ---
fn apply_projectile_bleed_effect(
    ctx: &ReducerContext,
    target_player_id: Identity,
    ammo_item_def: &crate::items::ItemDefinition, // Pass the ammo definition
    current_time: Timestamp,
) -> Result<(), String> {
    if let (Some(bleed_damage_per_tick), Some(bleed_duration_seconds), Some(bleed_tick_interval_seconds)) = (
        ammo_item_def.bleed_damage_per_tick,
        ammo_item_def.bleed_duration_seconds,
        ammo_item_def.bleed_tick_interval_seconds,
    ) {
        if bleed_duration_seconds <= 0.0 || bleed_tick_interval_seconds <= 0.0 {
            log::warn!("Projectile bleed for ammo '{}' has non-positive duration or interval. Skipping.", ammo_item_def.name);
            return Ok(());
        }

        let total_ticks = (bleed_duration_seconds / bleed_tick_interval_seconds).ceil();
        let total_bleed_damage = bleed_damage_per_tick * total_ticks;

        let new_effect = active_effects::ActiveConsumableEffect {
            effect_id: 0, // auto_inc
            player_id: target_player_id, // The player receiving the bleed
            target_player_id: Some(target_player_id), // Bleed is on the target
            item_def_id: ammo_item_def.id, // ID of the ammunition causing the bleed
            consuming_item_instance_id: None, // Projectiles are not consumed "by" the effect
            started_at: current_time,
            ends_at: current_time + TimeDuration::from_micros((bleed_duration_seconds * 1_000_000.0) as i64),
            total_amount: Some(total_bleed_damage),
            amount_applied_so_far: Some(0.0),
            effect_type: active_effects::EffectType::Bleed,
            tick_interval_micros: (bleed_tick_interval_seconds * 1_000_000.0) as u64,
            next_tick_at: current_time + TimeDuration::from_micros((bleed_tick_interval_seconds * 1_000_000.0) as i64),
        };

        ctx.db.active_consumable_effect().insert(new_effect);
        log::info!(
            "Created Bleed effect on player {:?} from ammo '{}': {:.1} total damage over {:.1}s (tick every {:.1}s)",
            target_player_id,
            ammo_item_def.name,
            total_bleed_damage,
            bleed_duration_seconds,
            bleed_tick_interval_seconds
        );
        Ok(())
    } else {
        log::debug!(
            "Ammo '{}' does not have complete bleed parameters defined. No bleed applied.",
            ammo_item_def.name
        );
        Ok(())
    }
}
// --- END NEW HELPER FUNCTION ---

#[reducer]
pub fn update_projectiles(ctx: &ReducerContext, _args: ProjectileUpdateSchedule) -> Result<(), String> {
    // Security check - only allow scheduler to call this
    if ctx.sender != ctx.identity() {
        return Err("Only the scheduler can update projectiles".to_string());
    }

    let current_time = ctx.timestamp;
    let item_defs_table = ctx.db.item_definition(); // Get item definitions table
    let mut rng = rand::rngs::StdRng::from_seed(ctx.rng().gen::<[u8; 32]>()); // Explicitly generate a [u8; 32] seed

    let mut projectiles_to_delete = Vec::new();
    let mut missed_projectiles_for_drops = Vec::new(); // Store missed projectiles for drop creation

    for projectile in ctx.db.projectile().iter() {
        let start_time_secs = projectile.start_time.to_micros_since_unix_epoch() as f64 / 1_000_000.0;
        let current_time_secs = current_time.to_micros_since_unix_epoch() as f64 / 1_000_000.0; // Moved here for correct scope
        let elapsed_time = current_time_secs - start_time_secs;
        
        let current_x = projectile.start_pos_x + projectile.velocity_x * elapsed_time as f32;
        let current_y = projectile.start_pos_y + projectile.velocity_y * elapsed_time as f32;
        
        let travel_distance = ((current_x - projectile.start_pos_x).powi(2) + (current_y - projectile.start_pos_y).powi(2)).sqrt();
        
        if travel_distance > projectile.max_range || elapsed_time > 10.0 {
            // Projectile missed - store info for dropped item creation
            missed_projectiles_for_drops.push((projectile.id, projectile.ammo_def_id, current_x, current_y));
            projectiles_to_delete.push(projectile.id);
            continue;
        }

        let mut hit_player_this_tick = false;
        for player_to_check in ctx.db.player().iter() {
            if player_to_check.identity == projectile.owner_id || player_to_check.is_dead { // Also check if target is already dead
                continue;
            }
            
            let dx = current_x - player_to_check.position_x;
            let dy = current_y - player_to_check.position_y;
            let distance_sq = dx * dx + dy * dy;
            
            // Use PLAYER_RADIUS for collision detection
            const PROJECTILE_HIT_PLAYER_RADIUS_SQ: f32 = crate::PLAYER_RADIUS * crate::PLAYER_RADIUS; 

            if distance_sq < PROJECTILE_HIT_PLAYER_RADIUS_SQ { // Use player's actual radius
                log::info!("Projectile {} from owner {:?} hit player {:?} at ({:.1}, {:.1}) with hit radius check against PLAYER_RADIUS ({:.1})", 
                         projectile.id, projectile.owner_id, player_to_check.identity, current_x, current_y, crate::PLAYER_RADIUS);
                
                // Fetch the ItemDefinition for the weapon that fired the projectile (e.g., the bow)
                let weapon_item_def = match item_defs_table.id().find(projectile.item_def_id) {
                    Some(def) => def,
                    None => {
                        log::error!("[UpdateProjectiles] ItemDefinition not found for projectile's weapon (ID: {}). Cannot apply damage.", projectile.item_def_id);
                        projectiles_to_delete.push(projectile.id); // Delete projectile if weapon def is missing
                        hit_player_this_tick = true; // Mark as handled to prevent further processing for this projectile
                        break; // Stop checking other players for this projectile
                    }
                };

                // --- IMPROVED: Use ammunition-based damage and effects ---
                // First apply weapon-based damage via combat::damage_player
                match combat::damage_player(ctx, projectile.owner_id, player_to_check.identity, weapon_item_def.pvp_damage_min.unwrap_or(0) as f32, &weapon_item_def, current_time) {
                    Ok(attack_result) => {
                        if attack_result.hit {
                            log::info!("Projectile from {:?} (weapon: {}) successfully processed damage on player {:?}.", 
                                     projectile.owner_id, weapon_item_def.name, player_to_check.identity);
                            
                            // Now apply ammunition-based bleed effects
                            if let Some(ammo_item_def) = item_defs_table.id().find(projectile.ammo_def_id) {
                                // Call the new helper to apply bleed
                                if let Err(e) = apply_projectile_bleed_effect(ctx, player_to_check.identity, &ammo_item_def, current_time) {
                                    log::error!("Error applying projectile bleed effect for ammo '{}' on player {:?}: {}", 
                                        ammo_item_def.name, player_to_check.identity, e);
                                }
                            } else {
                                log::error!("[UpdateProjectiles] ItemDefinition not found for projectile's ammunition (ID: {}). Cannot apply ammo effects.", projectile.ammo_def_id);
                            }
                        } else {
                            log::info!("Projectile from {:?} (weapon: {}) hit player {:?}, but combat::damage_player reported no effective damage (e.g., target already dead).", 
                                     projectile.owner_id, weapon_item_def.name, player_to_check.identity);
                        }
                    }
                    Err(e) => {
                        log::error!("Error calling combat::damage_player for projectile hit from {:?} on {:?}: {}", 
                                 projectile.owner_id, player_to_check.identity, e);
                        // Even if damage_player fails, we should consume the projectile.
                    }
                }
                // --- End Improved Ammunition-Based Effects ---

                projectiles_to_delete.push(projectile.id);
                hit_player_this_tick = true;
                break; // Projectile hits one player and is consumed
            }
        }
        
        if hit_player_this_tick {
            continue; // Move to the next projectile if this one hit someone
        }
    }

    // Create dropped items for missed projectiles
    for (projectile_id, ammo_def_id, pos_x, pos_y) in missed_projectiles_for_drops {
        // Get the ammunition name for better logging
        let ammo_name = item_defs_table.id().find(ammo_def_id)
            .map(|def| def.name.clone())
            .unwrap_or_else(|| format!("Unknown (ID: {})", ammo_def_id));
        
        match dropped_item::create_dropped_item_entity(ctx, ammo_def_id, 1, pos_x, pos_y) {
            Ok(_) => {
                log::info!("[ProjectileMiss] Created dropped '{}' (def_id: {}) at ({:.1}, {:.1}) for missed projectile {}", 
                         ammo_name, ammo_def_id, pos_x, pos_y, projectile_id);
            }
            Err(e) => {
                log::error!("[ProjectileMiss] Failed to create dropped '{}' for missed projectile {}: {}", 
                          ammo_name, projectile_id, e);
            }
        }
    }

    // Delete all projectiles that need to be removed
    for projectile_id in projectiles_to_delete {
        ctx.db.projectile().id().delete(&projectile_id);
    }

    Ok(())
} 