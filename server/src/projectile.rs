use spacetimedb::{table, reducer, SpacetimeType, Identity, Timestamp, ReducerContext, Table, TimeDuration, ScheduleAt};
use std::f32::consts::PI;

// Import the PlayerLastAttackTimestamp struct from root crate
use crate::PlayerLastAttackTimestamp;

// Import table accessor traits
use crate::player;
use crate::active_equipment::active_equipment;
use crate::items::item_definition;
use crate::ranged_weapon_stats::ranged_weapon_stats;
use crate::player_last_attack_timestamp;

#[table(name = projectile, public)]
#[derive(Clone, Debug)]
pub struct Projectile {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub owner_id: Identity,
    pub item_def_id: u64,
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

    // Get the equipped item
    let equipment = ctx.db.active_equipment().player_identity().find(&player_id)
        .ok_or("No equipped item found")?;

        // Get ranged weapon stats
        let equipped_item_def_id = equipment.equipped_item_def_id.ok_or("No item equipped")?;
        let item_def = ctx.db.item_definition().id().find(&equipped_item_def_id).ok_or("Item definition not found")?;

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

#[reducer]
pub fn update_projectiles(ctx: &ReducerContext, _args: ProjectileUpdateSchedule) -> Result<(), String> {
    // Security check - only allow scheduler to call this
    if ctx.sender != ctx.identity() {
        return Err("Only the scheduler can update projectiles".to_string());
    }

    let current_time = ctx.timestamp;
    let current_time_secs = current_time.to_micros_since_unix_epoch() as f64 / 1_000_000.0;

    let mut projectiles_to_delete = Vec::new();

    // Check each projectile for collisions and cleanup
    for projectile in ctx.db.projectile().iter() {
        let start_time_secs = projectile.start_time.to_micros_since_unix_epoch() as f64 / 1_000_000.0;
        let elapsed_time = current_time_secs - start_time_secs;
        
        let current_x = projectile.start_pos_x + projectile.velocity_x * elapsed_time as f32;
        let current_y = projectile.start_pos_y + projectile.velocity_y * elapsed_time as f32;
        
        // Calculate travel distance
        let travel_distance = ((current_x - projectile.start_pos_x).powi(2) + (current_y - projectile.start_pos_y).powi(2)).sqrt();
        
        // Check if projectile exceeded max range or is too old (10 seconds max)
        if travel_distance > projectile.max_range || elapsed_time > 10.0 {
            projectiles_to_delete.push(projectile.id);
            continue;
        }

        // Check collision with players (excluding owner)
        let mut hit_player = false;
        for player in ctx.db.player().iter() {
            if player.identity == projectile.owner_id || player.is_dead {
                continue;
            }
            
            let dx = current_x - player.position_x;
            let dy = current_y - player.position_y;
            let distance_sq = dx * dx + dy * dy;
            
            // Hit radius of ~20 pixels
            if distance_sq < 400.0 {
                log::info!("Projectile {} hit player {} at ({:.1}, {:.1})", projectile.id, player.identity.to_string(), current_x, current_y);
                
                // Apply damage (simplified - 25.0 damage)
                let damage = 25.0f32;
                let shooter_id = projectile.owner_id;
                let target_player_id = player.identity; // Get identity before moving player
                
                let mut updated_player = player;
                if updated_player.health > damage {
                    updated_player.health -= damage;
                } else {
                    updated_player.health = 0.0;
                    updated_player.is_dead = true;
                    updated_player.death_timestamp = Some(ctx.timestamp);
                }
                
                ctx.db.player().identity().update(updated_player);
                
                log::info!("Projectile from {} dealt {} damage to {}", shooter_id.to_string(), damage, target_player_id.to_string());
                
                projectiles_to_delete.push(projectile.id);
                hit_player = true;
                break;
            }
        }
        
        if hit_player {
            continue;
        }
    }

    // Clean up projectiles
    for projectile_id in projectiles_to_delete {
        ctx.db.projectile().id().delete(&projectile_id);
    }

    Ok(())
} 