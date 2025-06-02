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
use crate::shelter; // Import shelter module for collision detection
use crate::shelter::shelter as ShelterTableTrait; // Import shelter table trait

// Import deployable entity modules for collision detection
use crate::campfire::{Campfire, CAMPFIRE_COLLISION_RADIUS, CAMPFIRE_COLLISION_Y_OFFSET, campfire as CampfireTableTrait};
use crate::wooden_storage_box::{WoodenStorageBox, BOX_COLLISION_RADIUS, BOX_COLLISION_Y_OFFSET, wooden_storage_box as WoodenStorageBoxTableTrait};
use crate::stash::{Stash, stash as StashTableTrait};
use crate::sleeping_bag::{SleepingBag, SLEEPING_BAG_COLLISION_RADIUS, SLEEPING_BAG_COLLISION_Y_OFFSET, sleeping_bag as SleepingBagTableTrait};
use crate::player_corpse::{PlayerCorpse, CORPSE_COLLISION_RADIUS, CORPSE_COLLISION_Y_OFFSET, player_corpse as PlayerCorpseTableTrait};

// Import natural obstacle modules for collision detection
use crate::tree::{Tree, tree as TreeTableTrait};
use crate::stone::{Stone, stone as StoneTableTrait};

const GRAVITY: f32 = 600.0; // Adjust this value to change the arc. Positive values pull downwards.

/// Helper function to check if a line segment intersects with a circle
/// Returns true if the line from (x1,y1) to (x2,y2) intersects with circle at (cx,cy) with radius r
fn line_intersects_circle(x1: f32, y1: f32, x2: f32, y2: f32, cx: f32, cy: f32, radius: f32) -> bool {
    // Vector from line start to circle center
    let ac_x = cx - x1;
    let ac_y = cy - y1;
    
    // Vector of the line segment
    let ab_x = x2 - x1;
    let ab_y = y2 - y1;
    
    // Length squared of the line segment
    let ab_length_sq = ab_x * ab_x + ab_y * ab_y;
    
    // If line segment has zero length, check point-to-circle distance
    if ab_length_sq < 1e-8 {
        let dist_sq = ac_x * ac_x + ac_y * ac_y;
        return dist_sq <= radius * radius;
    }
    
    // Project AC onto AB to find the closest point on the line segment
    let t = (ac_x * ab_x + ac_y * ab_y) / ab_length_sq;
    
    // Clamp t to [0, 1] to stay within the line segment
    let t_clamped = t.max(0.0).min(1.0);
    
    // Find the closest point on the line segment
    let closest_x = x1 + t_clamped * ab_x;
    let closest_y = y1 + t_clamped * ab_y;
    
    // Check if the closest point is within the circle
    let dist_x = cx - closest_x;
    let dist_y = cy - closest_y;
    let dist_sq = dist_x * dist_x + dist_y * dist_y;
    
    dist_sq <= radius * radius
}

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

#[table(name = arrow_break_event, public)]
#[derive(Clone, Debug)]
pub struct ArrowBreakEvent {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub pos_x: f32,
    pub pos_y: f32,
    pub timestamp: Timestamp,
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
    let inventory_items_table = ctx.db.inventory_item(); // Renamed for clarity
    let mut ammo_item_instance_id_to_consume: Option<u64> = None;
    let mut ammo_item_current_quantity: u32 = 0;

    for item_instance in inventory_items_table.iter() { // Renamed for clarity
        if item_instance.item_def_id == loaded_ammo_def_id && item_instance.quantity > 0 {
            match &item_instance.location {
                crate::models::ItemLocation::Inventory(loc_data) if loc_data.owner_id == player_id => {
                    ammo_item_instance_id_to_consume = Some(item_instance.instance_id);
                    ammo_item_current_quantity = item_instance.quantity;
                    break;
                }
                crate::models::ItemLocation::Hotbar(loc_data) if loc_data.owner_id == player_id => {
                    ammo_item_instance_id_to_consume = Some(item_instance.instance_id);
                    ammo_item_current_quantity = item_instance.quantity;
                    break;
                }
                _ => {} // Not in player's inventory or hotbar
            }
        }
    }

    if let Some(instance_id) = ammo_item_instance_id_to_consume {
        if ammo_item_current_quantity > 1 {
            let mut item_to_update = inventory_items_table.instance_id().find(instance_id).unwrap(); // Should exist
            item_to_update.quantity -= 1;
            inventory_items_table.instance_id().update(item_to_update);
            log::info!("Player {:?} consumed 1 ammunition (def_id: {}). {} remaining.", 
                player_id, loaded_ammo_def_id, ammo_item_current_quantity - 1);
        } else {
            inventory_items_table.instance_id().delete(instance_id);
            log::info!("Player {:?} consumed last ammunition (def_id: {}). Item instance deleted.", 
                player_id, loaded_ammo_def_id);
        }
    } else {
        equipment.is_ready_to_fire = false;
        equipment.loaded_ammo_def_id = None;
        ctx.db.active_equipment().player_identity().update(equipment);
        return Err("No loaded ammunition found in inventory to consume, despite weapon being marked as ready. Weapon unloaded.".to_string());
    }

    equipment.is_ready_to_fire = false;
    equipment.loaded_ammo_def_id = None;
    // Update swing_start_time_ms for weapon cooldown tracking (same as melee weapons)
    equipment.swing_start_time_ms = (ctx.timestamp.to_micros_since_unix_epoch() / 1000) as u64; // Convert to milliseconds and cast to u64
    ctx.db.active_equipment().player_identity().update(equipment);
 
    let weapon_stats = ctx.db.ranged_weapon_stats().item_name().find(&item_def.name)
        .ok_or(format!("Ranged weapon stats not found for: {}", item_def.name))?;

    if let Some(last_attack_record) = ctx.db.player_last_attack_timestamp().player_id().find(&player_id) {
        let time_since_last_attack = ctx.timestamp.to_micros_since_unix_epoch() - last_attack_record.last_attack_timestamp.to_micros_since_unix_epoch();
        let required_reload_time_micros = (weapon_stats.reload_time_secs * 1_000_000.0) as i64;
        
        if time_since_last_attack < required_reload_time_micros {
            return Err("Weapon is still reloading".to_string());
        }
    }

    // --- NEW: Check shelter protection rule for ranged attacks ---
    // Players inside their own shelter cannot fire projectiles outside
    if let Some(shelter_id) = shelter::is_owner_inside_shelter(ctx, player_id, player.position_x, player.position_y) {
        // Check if target is outside the shelter
        if !shelter::is_player_inside_shelter(target_world_x, target_world_y, &ctx.db.shelter().id().find(shelter_id).unwrap()) {
            return Err("Cannot fire from inside your shelter to targets outside. Leave your shelter to attack.".to_string());
        }
        log::debug!("Player {:?} firing from inside their shelter {} to target inside same shelter - allowed", player_id, shelter_id);
    }

    // --- Check if projectile path would immediately hit a shelter wall very close to player ---
    if let Some((shelter_id, collision_x, collision_y)) = shelter::check_projectile_shelter_collision(
        ctx,
        player.position_x,
        player.position_y,
        target_world_x,
        target_world_y,
    ) {
        // Only block the shot if the collision happens very close to the player
        // This allows intentional targeting of shelters while preventing immediate wall hits
        let collision_distance = ((collision_x - player.position_x).powi(2) + (collision_y - player.position_y).powi(2)).sqrt();
        const MIN_FIRING_DISTANCE: f32 = 80.0; // About 2 tiles
        
        if collision_distance < MIN_FIRING_DISTANCE {
            return Err(format!("Cannot fire projectile - shelter wall too close ({:.1} units)", collision_distance));
        }
        
        // If collision is far enough away, allow the shot (player is intentionally targeting the shelter)
        log::info!("Player {:?} targeting shelter {} at distance {:.1} - shot allowed", player_id, shelter_id, collision_distance);
    }

    // --- Physics Calculation for Initial Velocity to Hit Target ---
    let delta_x = target_world_x - player.position_x;
    let delta_y = target_world_y - player.position_y;
    let v0 = weapon_stats.projectile_speed;
    let g = GRAVITY; // GRAVITY const defined at the top of the file
    
    let distance_sq = delta_x * delta_x + delta_y * delta_y;
    if distance_sq < 1.0 { // distance < 1.0
        return Err("Target too close".to_string());
    }

    let final_vx: f32;
    let final_vy: f32;

    // Crossbows fire in a straight line with minimal gravity effect
    if item_def.name == "Crossbow" {
        let distance = distance_sq.sqrt();
        let time_to_target = distance / v0;
        
        // Direct line calculation with minimal gravity compensation
        final_vx = delta_x / time_to_target;
        final_vy = delta_y / time_to_target + 0.5 * g * time_to_target * 0.1; // Reduced gravity effect (10% of normal)
        
        log::info!("Crossbow fired: straight-line trajectory with minimal gravity. Distance: {:.1}, Time: {:.3}s", distance, time_to_target);
    } else {
        // Existing bow physics with full gravity arc
        if delta_x.abs() < 1e-6 { // Target is (almost) vertically aligned
            final_vx = 0.0;
            if delta_y == 0.0 { // Target is at player's exact location (already handled by distance_sq < 1.0)
                 return Err("Target is at player position".to_string());
            }
            // Time to fall/rise delta_y: delta_y = v0y*T + 0.5*g*T^2
            // If shooting straight up/down, v0x = 0, so |v0y| = v0
            let discriminant_vertical = v0.powi(2) + 2.0 * g * delta_y; // For T = (v0y +/- sqrt(v0y^2 + 2g*delta_y))/g , if v0y is +/- v0
                                                                     // Simplified: check if target is reachable vertically
            if delta_y > 0.0 { // Target below
                final_vy = v0; // Shoot straight down
                // Check if it can even reach if v0 is too small against gravity for upward component
                // For purely downward, it will always reach if T > 0.
                // T = (-v0 + sqrt(v0^2 + 2g*delta_y))/g
                if v0.powi(2) + 2.0 * g * delta_y < 0.0 { // Should not happen for delta_y > 0
                     return Err("Error in vertical aiming (down)".to_string());
                }

            } else { // Target above (delta_y < 0)
                if discriminant_vertical < 0.0 {
                    return Err("Target vertically unreachable (too high or gravity too strong)".to_string());
                }
                final_vy = -v0; // Shoot straight up
            }
        } else {
            // Quadratic equation for T^2: A_z * (T^2)^2 + B_z * T^2 + C_z = 0
            // A_z = 0.25 * g^2
            // B_z = -(v0^2 + g * delta_y)
            // C_z = delta_x^2 + delta_y^2
            let a_z = 0.25 * g * g;
            let b_z = -(v0.powi(2) + g * delta_y);
            let c_z = distance_sq;

            let discriminant_t_sq = b_z.powi(2) - 4.0 * a_z * c_z;

            if discriminant_t_sq < 0.0 {
                return Err(format!("Target is unreachable with current weapon arc (discriminant: {:.2})", discriminant_t_sq));
            }

            let sqrt_discriminant_t_sq = discriminant_t_sq.sqrt();
            
            // Two potential solutions for T^2
            let t_sq1 = (-b_z + sqrt_discriminant_t_sq) / (2.0 * a_z);
            let t_sq2 = (-b_z - sqrt_discriminant_t_sq) / (2.0 * a_z);

            let mut chosen_t_sq = -1.0;

            // Prefer the smaller positive T^2 (shorter time of flight, usually lower arc)
            if t_sq2 > 1e-6 {
                chosen_t_sq = t_sq2;
            } else if t_sq1 > 1e-6 {
                chosen_t_sq = t_sq1;
            }

            if chosen_t_sq < 1e-6 { // Ensure chosen_t_sq is positive and not extremely small
                return Err(format!("Target is unreachable (no positive time of flight, T^2: {:.2})", chosen_t_sq));
            }
            
            let t = chosen_t_sq.sqrt();
            if t < 1e-3 { // Avoid division by very small T
                 return Err("Target too close for stable arc calculation".to_string());
            }

            final_vx = delta_x / t;
            final_vy = (delta_y / t) - 0.5 * g * t;
            
            // Sanity check: ensure calculated speed is close to v0
            let calculated_speed_sq = final_vx.powi(2) + final_vy.powi(2);
            if (calculated_speed_sq - v0.powi(2)).abs() > 1.0 { // Allow some tolerance
                // This might indicate an issue if chosen_t_sq was at limits or g=0 etc.
                // but with g being non-zero and checks on T, this should hold.
                log::warn!(
                    "Calculated speed ({:.2}) differs from v0 ({:.2}). dx:{:.1},dy:{:.1},T:{:.2},vX:{:.1},vY:{:.1}",
                    calculated_speed_sq.sqrt(), v0, delta_x, delta_y, t, final_vx, final_vy
                );
                // Optionally, could return an error here if strict speed adherence is critical
                // return Err("Physics calculation resulted in inconsistent speed.".to_string());
            }
        }
    }
    // --- End Physics Calculation ---


    // Create projectile
    let projectile = Projectile {
        id: 0, // auto_inc
        owner_id: player_id,
        item_def_id: equipped_item_def_id,
        ammo_def_id: loaded_ammo_def_id, 
        start_time: ctx.timestamp,
        start_pos_x: player.position_x,
        start_pos_y: player.position_y,
        velocity_x: final_vx, // Use calculated velocity
        velocity_y: final_vy, // Use calculated velocity
        max_range: weapon_stats.weapon_range, // Keep max_range for flight limit
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

    log::info!("Projectile fired from player {} towards ({:.1}, {:.1}) with initial V_x={:.1}, V_y={:.1}", 
        player_id.to_string(), target_world_x, target_world_y, final_vx, final_vy);
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

    let projectile_count = ctx.db.projectile().iter().count();
    if projectile_count > 0 {
        log::info!("DEBUG: update_projectiles running with {} active projectiles", projectile_count);
    }

    for projectile in ctx.db.projectile().iter() {
        let start_time_secs = projectile.start_time.to_micros_since_unix_epoch() as f64 / 1_000_000.0;
        let current_time_secs = current_time.to_micros_since_unix_epoch() as f64 / 1_000_000.0; // Moved here for correct scope
        let elapsed_time = current_time_secs - start_time_secs;
        
        // Get weapon definition to determine gravity effect
        let weapon_item_def = item_defs_table.id().find(projectile.item_def_id);
        let gravity_multiplier = if let Some(weapon_def) = weapon_item_def {
            if weapon_def.name == "Crossbow" {
                0.1 // Crossbow projectiles have 10% gravity effect
            } else {
                1.0 // Bow projectiles have full gravity effect
            }
        } else {
            1.0 // Default to full gravity if weapon not found
        };
        
        // Check if this is a thrown item (ammo_def_id == item_def_id) - no gravity for thrown items
        let is_thrown_item = projectile.ammo_def_id == projectile.item_def_id;
        let final_gravity_multiplier = if is_thrown_item {
            0.0 // Thrown items have no gravity (straight line)
        } else {
            gravity_multiplier
        };
        
        // Calculate current position
        let current_x = projectile.start_pos_x + projectile.velocity_x * elapsed_time as f32;
        let current_y = projectile.start_pos_y + projectile.velocity_y * elapsed_time as f32 + 0.5 * GRAVITY * final_gravity_multiplier * (elapsed_time as f32).powi(2);
        
        // Calculate previous position (50ms ago) for line segment collision detection
        let prev_time = (elapsed_time - 0.05).max(0.0); // 50ms ago, but not negative
        let prev_x = projectile.start_pos_x + projectile.velocity_x * prev_time as f32;
        let prev_y = projectile.start_pos_y + projectile.velocity_y * prev_time as f32 + 0.5 * GRAVITY * final_gravity_multiplier * (prev_time as f32).powi(2);
        
        let travel_distance = ((current_x - projectile.start_pos_x).powi(2) + (current_y - projectile.start_pos_y).powi(2)).sqrt();
        
        // Check for shelter wall collision first
        if let Some((shelter_id, collision_x, collision_y)) = shelter::check_projectile_shelter_collision(
            ctx, 
            projectile.start_pos_x, 
            projectile.start_pos_y, 
            current_x, 
            current_y
        ) {
            // NEW: Check if player is attacking their own shelter - prevent self-damage
            if let Some(shelter) = ctx.db.shelter().id().find(shelter_id) {
                if shelter.placed_by == projectile.owner_id {
                    // Check if the projectile was fired from inside the shelter
                    if shelter::is_player_inside_shelter(projectile.start_pos_x, projectile.start_pos_y, &shelter) {
                        log::info!(
                            "[ProjectileUpdate] Projectile {} from owner {:?} hit their own Shelter {} from inside - NO DAMAGE (self-protection)",
                            projectile.id, projectile.owner_id, shelter_id
                        );
                        
                        // Projectile hit own shelter from inside - consume projectile but don't damage shelter
                        missed_projectiles_for_drops.push((projectile.id, projectile.ammo_def_id, collision_x, collision_y));
                        projectiles_to_delete.push(projectile.id);
                        continue;
                    } else {
                        log::info!(
                            "[ProjectileUpdate] Projectile {} from owner {:?} hit their own Shelter {} from outside - DAMAGE ALLOWED",
                            projectile.id, projectile.owner_id, shelter_id
                        );
                        // Allow damage to own shelter if fired from outside (e.g., accidentally)
                    }
                }
            }
            
            log::info!(
                "[ProjectileUpdate] Projectile {} from owner {:?} hit Shelter {} wall at ({:.1}, {:.1})",
                projectile.id, projectile.owner_id, shelter_id, collision_x, collision_y
            );
            
            // Apply damage to the shelter before handling the projectile
            if let Some(weapon_item_def) = item_defs_table.id().find(projectile.item_def_id) {
                if let Some(ammo_item_def) = item_defs_table.id().find(projectile.ammo_def_id) {
                    // Calculate combined damage (same logic as shelter)
                    let weapon_damage_min = weapon_item_def.pvp_damage_min.unwrap_or(0) as f32;
                    let weapon_damage_max = weapon_item_def.pvp_damage_max.unwrap_or(weapon_damage_min as u32) as f32;
                    let weapon_damage = if weapon_damage_min == weapon_damage_max {
                        weapon_damage_min
                    } else {
                        rng.gen_range(weapon_damage_min..=weapon_damage_max)
                    };

                    let ammo_damage_min = ammo_item_def.pvp_damage_min.unwrap_or(0) as f32;
                    let ammo_damage_max = ammo_item_def.pvp_damage_max.unwrap_or(ammo_damage_min as u32) as f32;
                    let ammo_damage = if ammo_damage_min == ammo_damage_max {
                        ammo_damage_min
                    } else {
                        rng.gen_range(ammo_damage_min..=ammo_damage_max)
                    };

                    // Check if this is a thrown item (ammo_def_id == item_def_id)
                    let is_thrown_item = projectile.ammo_def_id == projectile.item_def_id;

                    let final_damage = if is_thrown_item {
                        // Thrown items do double the weapon's base damage
                        weapon_damage * 2.0
                    } else if ammo_item_def.name == "Fire Arrow" {
                        ammo_damage
                    } else {
                        weapon_damage + ammo_damage
                    };

                    if final_damage > 0.0 {
                        match crate::shelter::damage_shelter(
                            ctx, 
                            projectile.owner_id, 
                            shelter_id, 
                            final_damage, 
                            current_time, 
                            &mut rng
                        ) {
                            Ok(attack_result) => {
                                if attack_result.hit {
                                    log::info!(
                                        "[ProjectileUpdate] Projectile {} (weapon: {} + ammo: {}) dealt {:.1} damage to Shelter {}",
                                        projectile.id, weapon_item_def.name, ammo_item_def.name, final_damage, shelter_id
                                    );
                                }
                            }
                            Err(e) => {
                                log::error!(
                                    "[ProjectileUpdate] Error applying projectile damage to Shelter {}: {}",
                                    shelter_id, e
                                );
                            }
                        }
                    } else {
                        log::debug!(
                            "[ProjectileUpdate] Combined damage from weapon '{}' and ammunition '{}' is 0, no damage applied to Shelter {}",
                            weapon_item_def.name, ammo_item_def.name, shelter_id
                        );
                    }
                } else {
                    log::error!(
                        "[ProjectileUpdate] ItemDefinition not found for projectile's ammunition (ID: {}). Cannot apply shelter damage.",
                        projectile.ammo_def_id
                    );
                }
            } else {
                log::error!(
                    "[ProjectileUpdate] ItemDefinition not found for projectile's weapon (ID: {}). Cannot apply shelter damage.",
                    projectile.item_def_id
                );
            }
            
            // Projectile hit shelter wall - store info for dropped item creation
            missed_projectiles_for_drops.push((projectile.id, projectile.ammo_def_id, collision_x, collision_y));
            projectiles_to_delete.push(projectile.id);
            continue;
        }
        
        // Check for natural obstacle collisions (trees and stones)
        let mut hit_natural_obstacle_this_tick = false;
        
        // Check tree collisions
        for tree in ctx.db.tree().iter() {
            // Trees have a generous collision radius for projectiles
            const PROJECTILE_TREE_HIT_RADIUS: f32 = 30.0; // Generous radius for tree trunks
            const PROJECTILE_TREE_Y_OFFSET: f32 = 10.0; // Slight offset for tree base
            
            let tree_hit_y = tree.pos_y - PROJECTILE_TREE_Y_OFFSET;
            
            // Use line segment collision detection for trees
            if line_intersects_circle(prev_x, prev_y, current_x, current_y, tree.pos_x, tree_hit_y, PROJECTILE_TREE_HIT_RADIUS) {
                log::info!(
                    "[ProjectileUpdate] Projectile {} from owner {:?} hit Tree {} along path from ({:.1}, {:.1}) to ({:.1}, {:.1})",
                    projectile.id, projectile.owner_id, tree.id, prev_x, prev_y, current_x, current_y
                );
                
                // Trees block projectiles but don't take damage - projectile becomes dropped item
                missed_projectiles_for_drops.push((projectile.id, projectile.ammo_def_id, current_x, current_y));
                projectiles_to_delete.push(projectile.id);
                hit_natural_obstacle_this_tick = true;
                break;
            }
        }
        
        if hit_natural_obstacle_this_tick {
            continue;
        }
        
        // Check stone collisions
        for stone in ctx.db.stone().iter() {
            // Stones have a generous collision radius for projectiles
            const PROJECTILE_STONE_HIT_RADIUS: f32 = 25.0; // Generous radius for stone rocks
            const PROJECTILE_STONE_Y_OFFSET: f32 = 5.0; // Slight offset for stone base
            
            let stone_hit_y = stone.pos_y - PROJECTILE_STONE_Y_OFFSET;
            
            // Use line segment collision detection for stones
            if line_intersects_circle(prev_x, prev_y, current_x, current_y, stone.pos_x, stone_hit_y, PROJECTILE_STONE_HIT_RADIUS) {
                log::info!(
                    "[ProjectileUpdate] Projectile {} from owner {:?} hit Stone {} along path from ({:.1}, {:.1}) to ({:.1}, {:.1})",
                    projectile.id, projectile.owner_id, stone.id, prev_x, prev_y, current_x, current_y
                );
                
                // Stones block projectiles but don't take damage - projectile becomes dropped item
                missed_projectiles_for_drops.push((projectile.id, projectile.ammo_def_id, current_x, current_y));
                projectiles_to_delete.push(projectile.id);
                hit_natural_obstacle_this_tick = true;
                break;
            }
        }
        
        if hit_natural_obstacle_this_tick {
            continue;
        }
        
        // Check deployable entity collisions (campfires, boxes, stashes, sleeping bags)
        let mut hit_deployable_this_tick = false;
        
        // Check campfire collisions
        for campfire in ctx.db.campfire().iter() {
            if campfire.is_destroyed {
                continue;
            }
            
            // Use a more generous hit radius for projectiles and reduce Y offset for easier targeting
            const PROJECTILE_CAMPFIRE_HIT_RADIUS: f32 = 32.0; // Larger than collision radius (20.0)
            const PROJECTILE_CAMPFIRE_Y_OFFSET: f32 = -5.0; // Slight upward offset for easier hits
            
            let campfire_hit_y = campfire.pos_y - PROJECTILE_CAMPFIRE_Y_OFFSET;
            
            // Use line segment collision detection instead of just checking current position
            if line_intersects_circle(prev_x, prev_y, current_x, current_y, campfire.pos_x, campfire_hit_y, PROJECTILE_CAMPFIRE_HIT_RADIUS) {
                log::info!(
                    "[ProjectileUpdate] Projectile {} from owner {:?} hit Campfire {} along path from ({:.1}, {:.1}) to ({:.1}, {:.1})",
                    projectile.id, projectile.owner_id, campfire.id, prev_x, prev_y, current_x, current_y
                );
                
                // Apply damage using existing combat system
                if let Some(weapon_item_def) = item_defs_table.id().find(projectile.item_def_id) {
                    if let Some(ammo_item_def) = item_defs_table.id().find(projectile.ammo_def_id) {
                        // Calculate combined damage (same logic as shelter)
                        let weapon_damage_min = weapon_item_def.pvp_damage_min.unwrap_or(0) as f32;
                        let weapon_damage_max = weapon_item_def.pvp_damage_max.unwrap_or(weapon_damage_min as u32) as f32;
                        let weapon_damage = if weapon_damage_min == weapon_damage_max {
                            weapon_damage_min
                        } else {
                            rng.gen_range(weapon_damage_min..=weapon_damage_max)
                        };

                        let ammo_damage_min = ammo_item_def.pvp_damage_min.unwrap_or(0) as f32;
                        let ammo_damage_max = ammo_item_def.pvp_damage_max.unwrap_or(ammo_damage_min as u32) as f32;
                        let ammo_damage = if ammo_damage_min == ammo_damage_max {
                            ammo_damage_min
                        } else {
                            rng.gen_range(ammo_damage_min..=ammo_damage_max)
                        };

                        // Check if this is a thrown item (ammo_def_id == item_def_id)
                        let is_thrown_item = projectile.ammo_def_id == projectile.item_def_id;

                        let final_damage = if is_thrown_item {
                            // Thrown items do double the weapon's base damage
                            weapon_damage * 2.0
                        } else if ammo_item_def.name == "Fire Arrow" {
                            ammo_damage
                        } else {
                            weapon_damage + ammo_damage
                        };

                        if final_damage > 0.0 {
                            match combat::damage_campfire(ctx, projectile.owner_id, campfire.id, final_damage, current_time, &mut rng) {
                                Ok(attack_result) => {
                                    if attack_result.hit {
                                        log::info!(
                                            "[ProjectileUpdate] Projectile {} dealt {:.1} damage to Campfire {}",
                                            projectile.id, final_damage, campfire.id
                                        );
                                    }
                                }
                                Err(e) => {
                                    log::error!(
                                        "[ProjectileUpdate] Error applying projectile damage to Campfire {}: {}",
                                        campfire.id, e
                                    );
                                }
                            }
                        }
                    }
                }
                
                // Add projectile to dropped item system (with break chance) like shelters
                missed_projectiles_for_drops.push((projectile.id, projectile.ammo_def_id, current_x, current_y));
                projectiles_to_delete.push(projectile.id);
                hit_deployable_this_tick = true;
                break;
            }
        }
        
        if hit_deployable_this_tick {
            continue;
        }
        
        // Check wooden storage box collisions
        for storage_box in ctx.db.wooden_storage_box().iter() {
            if storage_box.is_destroyed {
                continue;
            }
            
            // Use a more generous hit radius for projectiles
            const PROJECTILE_BOX_HIT_RADIUS: f32 = 28.0; // Larger than collision radius (18.0)
            const PROJECTILE_BOX_Y_OFFSET: f32 = 5.0; // Reduced from 10.0 for easier hits
            
            let box_hit_y = storage_box.pos_y - PROJECTILE_BOX_Y_OFFSET;
            
            // Use line segment collision detection instead of just checking current position
            if line_intersects_circle(prev_x, prev_y, current_x, current_y, storage_box.pos_x, box_hit_y, PROJECTILE_BOX_HIT_RADIUS) {
                log::info!(
                    "[ProjectileUpdate] Projectile {} from owner {:?} hit Wooden Storage Box {} along path from ({:.1}, {:.1}) to ({:.1}, {:.1})",
                    projectile.id, projectile.owner_id, storage_box.id, prev_x, prev_y, current_x, current_y
                );
                
                // Apply damage using existing combat system
                if let Some(weapon_item_def) = item_defs_table.id().find(projectile.item_def_id) {
                    if let Some(ammo_item_def) = item_defs_table.id().find(projectile.ammo_def_id) {
                        // Calculate combined damage (same logic as shelter)
                        let weapon_damage_min = weapon_item_def.pvp_damage_min.unwrap_or(0) as f32;
                        let weapon_damage_max = weapon_item_def.pvp_damage_max.unwrap_or(weapon_damage_min as u32) as f32;
                        let weapon_damage = if weapon_damage_min == weapon_damage_max {
                            weapon_damage_min
                        } else {
                            rng.gen_range(weapon_damage_min..=weapon_damage_max)
                        };

                        let ammo_damage_min = ammo_item_def.pvp_damage_min.unwrap_or(0) as f32;
                        let ammo_damage_max = ammo_item_def.pvp_damage_max.unwrap_or(ammo_damage_min as u32) as f32;
                        let ammo_damage = if ammo_damage_min == ammo_damage_max {
                            ammo_damage_min
                        } else {
                            rng.gen_range(ammo_damage_min..=ammo_damage_max)
                        };

                        // Check if this is a thrown item (ammo_def_id == item_def_id)
                        let is_thrown_item = projectile.ammo_def_id == projectile.item_def_id;

                        let final_damage = if is_thrown_item {
                            // Thrown items do double the weapon's base damage
                            weapon_damage * 2.0
                        } else if ammo_item_def.name == "Fire Arrow" {
                            ammo_damage
                        } else {
                            weapon_damage + ammo_damage
                        };

                        if final_damage > 0.0 {
                            match combat::damage_wooden_storage_box(ctx, projectile.owner_id, storage_box.id, final_damage, current_time, &mut rng) {
                                Ok(attack_result) => {
                                    if attack_result.hit {
                                        log::info!(
                                            "[ProjectileUpdate] Projectile {} dealt {:.1} damage to Wooden Storage Box {}",
                                            projectile.id, final_damage, storage_box.id
                                        );
                                    }
                                }
                                Err(e) => {
                                    log::error!(
                                        "[ProjectileUpdate] Error applying projectile damage to Wooden Storage Box {}: {}",
                                        storage_box.id, e
                                    );
                                }
                            }
                        }
                    }
                }
                
                // Add projectile to dropped item system (with break chance) like shelters
                missed_projectiles_for_drops.push((projectile.id, projectile.ammo_def_id, current_x, current_y));
                projectiles_to_delete.push(projectile.id);
                hit_deployable_this_tick = true;
                break;
            }
        }
        
        if hit_deployable_this_tick {
            continue;
        }
        
        // Check stash collisions (stashes are walkable but still damageable)
        for stash in ctx.db.stash().iter() {
            if stash.is_destroyed {
                continue;
            }
            
            // Stashes don't have collision radius since they're walkable, use a generous hit radius for projectiles
            const PROJECTILE_STASH_HIT_RADIUS: f32 = 25.0; // Larger radius for easier hits
            
            // Use line segment collision detection instead of just checking current position
            if line_intersects_circle(prev_x, prev_y, current_x, current_y, stash.pos_x, stash.pos_y, PROJECTILE_STASH_HIT_RADIUS) {
                log::info!(
                    "[ProjectileUpdate] Projectile {} from owner {:?} hit Stash {} along path from ({:.1}, {:.1}) to ({:.1}, {:.1})",
                    projectile.id, projectile.owner_id, stash.id, prev_x, prev_y, current_x, current_y
                );
                
                // Apply damage using existing combat system
                if let Some(weapon_item_def) = item_defs_table.id().find(projectile.item_def_id) {
                    if let Some(ammo_item_def) = item_defs_table.id().find(projectile.ammo_def_id) {
                        // Calculate combined damage (same logic as shelter)
                        let weapon_damage_min = weapon_item_def.pvp_damage_min.unwrap_or(0) as f32;
                        let weapon_damage_max = weapon_item_def.pvp_damage_max.unwrap_or(weapon_damage_min as u32) as f32;
                        let weapon_damage = if weapon_damage_min == weapon_damage_max {
                            weapon_damage_min
                        } else {
                            rng.gen_range(weapon_damage_min..=weapon_damage_max)
                        };

                        let ammo_damage_min = ammo_item_def.pvp_damage_min.unwrap_or(0) as f32;
                        let ammo_damage_max = ammo_item_def.pvp_damage_max.unwrap_or(ammo_damage_min as u32) as f32;
                        let ammo_damage = if ammo_damage_min == ammo_damage_max {
                            ammo_damage_min
                        } else {
                            rng.gen_range(ammo_damage_min..=ammo_damage_max)
                        };

                        // Check if this is a thrown item (ammo_def_id == item_def_id)
                        let is_thrown_item = projectile.ammo_def_id == projectile.item_def_id;

                        let final_damage = if is_thrown_item {
                            // Thrown items do double the weapon's base damage
                            weapon_damage * 2.0
                        } else if ammo_item_def.name == "Fire Arrow" {
                            ammo_damage
                        } else {
                            weapon_damage + ammo_damage
                        };

                        if final_damage > 0.0 {
                            match combat::damage_stash(ctx, projectile.owner_id, stash.id, final_damage, current_time, &mut rng) {
                                Ok(attack_result) => {
                                    if attack_result.hit {
                                        log::info!(
                                            "[ProjectileUpdate] Projectile {} dealt {:.1} damage to Stash {}",
                                            projectile.id, final_damage, stash.id
                                        );
                                    }
                                }
                                Err(e) => {
                                    log::error!(
                                        "[ProjectileUpdate] Error applying projectile damage to Stash {}: {}",
                                        stash.id, e
                                    );
                                }
                            }
                        }
                    }
                }
                
                // Add projectile to dropped item system (with break chance) like shelters
                missed_projectiles_for_drops.push((projectile.id, projectile.ammo_def_id, current_x, current_y));
                projectiles_to_delete.push(projectile.id);
                hit_deployable_this_tick = true;
                break;
            }
        }
        
        if hit_deployable_this_tick {
            continue;
        }
        
        // Check sleeping bag collisions
        for sleeping_bag in ctx.db.sleeping_bag().iter() {
            if sleeping_bag.is_destroyed {
                continue;
            }
            
            // Use a more generous hit radius for projectiles and reduce Y offset
            const PROJECTILE_SLEEPING_BAG_HIT_RADIUS: f32 = 28.0; // Larger than collision radius (18.0)
            const PROJECTILE_SLEEPING_BAG_Y_OFFSET: f32 = 0.0; // No Y offset for easier hits on low-profile items
            
            let bag_hit_y = sleeping_bag.pos_y - PROJECTILE_SLEEPING_BAG_Y_OFFSET;
            
            // Use line segment collision detection instead of just checking current position
            if line_intersects_circle(prev_x, prev_y, current_x, current_y, sleeping_bag.pos_x, bag_hit_y, PROJECTILE_SLEEPING_BAG_HIT_RADIUS) {
                log::info!(
                    "[ProjectileUpdate] Projectile {} from owner {:?} hit Sleeping Bag {} along path from ({:.1}, {:.1}) to ({:.1}, {:.1})",
                    projectile.id, projectile.owner_id, sleeping_bag.id, prev_x, prev_y, current_x, current_y
                );
                
                // Apply damage using existing combat system
                if let Some(weapon_item_def) = item_defs_table.id().find(projectile.item_def_id) {
                    if let Some(ammo_item_def) = item_defs_table.id().find(projectile.ammo_def_id) {
                        // Calculate combined damage (same logic as shelter)
                        let weapon_damage_min = weapon_item_def.pvp_damage_min.unwrap_or(0) as f32;
                        let weapon_damage_max = weapon_item_def.pvp_damage_max.unwrap_or(weapon_damage_min as u32) as f32;
                        let weapon_damage = if weapon_damage_min == weapon_damage_max {
                            weapon_damage_min
                        } else {
                            rng.gen_range(weapon_damage_min..=weapon_damage_max)
                        };

                        let ammo_damage_min = ammo_item_def.pvp_damage_min.unwrap_or(0) as f32;
                        let ammo_damage_max = ammo_item_def.pvp_damage_max.unwrap_or(ammo_damage_min as u32) as f32;
                        let ammo_damage = if ammo_damage_min == ammo_damage_max {
                            ammo_damage_min
                        } else {
                            rng.gen_range(ammo_damage_min..=ammo_damage_max)
                        };

                        // Check if this is a thrown item (ammo_def_id == item_def_id)
                        let is_thrown_item = projectile.ammo_def_id == projectile.item_def_id;

                        let final_damage = if is_thrown_item {
                            // Thrown items do double the weapon's base damage
                            weapon_damage * 2.0
                        } else if ammo_item_def.name == "Fire Arrow" {
                            ammo_damage
                        } else {
                            weapon_damage + ammo_damage
                        };

                        if final_damage > 0.0 {
                            match combat::damage_sleeping_bag(ctx, projectile.owner_id, sleeping_bag.id, final_damage, current_time, &mut rng) {
                                Ok(attack_result) => {
                                    if attack_result.hit {
                                        log::info!(
                                            "[ProjectileUpdate] Projectile {} dealt {:.1} damage to Sleeping Bag {}",
                                            projectile.id, final_damage, sleeping_bag.id
                                        );
                                    }
                                }
                                Err(e) => {
                                    log::error!(
                                        "[ProjectileUpdate] Error applying projectile damage to Sleeping Bag {}: {}",
                                        sleeping_bag.id, e
                                    );
                                }
                            }
                        }
                    }
                }
                
                // Add projectile to dropped item system (with break chance) like shelters
                missed_projectiles_for_drops.push((projectile.id, projectile.ammo_def_id, current_x, current_y));
                projectiles_to_delete.push(projectile.id);
                hit_deployable_this_tick = true;
                break;
            }
        }
        
        if hit_deployable_this_tick {
            continue;
        }
        
        // Check player corpse collisions
        for corpse in ctx.db.player_corpse().iter() {
            if corpse.health == 0 {
                continue; // Skip depleted corpses
            }
            
            // Use generous hit radius for corpses and account for Y offset
            const PROJECTILE_CORPSE_HIT_RADIUS: f32 = 25.0; // Generous radius for corpses
            let corpse_hit_y = corpse.pos_y - CORPSE_COLLISION_Y_OFFSET;
            
            // Use line segment collision detection for corpses
            if line_intersects_circle(prev_x, prev_y, current_x, current_y, corpse.pos_x, corpse_hit_y, PROJECTILE_CORPSE_HIT_RADIUS) {
                log::info!(
                    "[ProjectileUpdate] Projectile {} from owner {:?} hit Player Corpse {} (player: {:?}) along path from ({:.1}, {:.1}) to ({:.1}, {:.1})",
                    projectile.id, projectile.owner_id, corpse.id, corpse.player_identity, prev_x, prev_y, current_x, current_y
                );
                
                // Apply damage using existing combat system
                if let Some(weapon_item_def) = item_defs_table.id().find(projectile.item_def_id) {
                    if let Some(ammo_item_def) = item_defs_table.id().find(projectile.ammo_def_id) {
                        // Calculate combined damage (same logic as other entities)
                        let weapon_damage_min = weapon_item_def.pvp_damage_min.unwrap_or(0) as f32;
                        let weapon_damage_max = weapon_item_def.pvp_damage_max.unwrap_or(weapon_damage_min as u32) as f32;
                        let weapon_damage = if weapon_damage_min == weapon_damage_max {
                            weapon_damage_min
                        } else {
                            rng.gen_range(weapon_damage_min..=weapon_damage_max)
                        };

                        let ammo_damage_min = ammo_item_def.pvp_damage_min.unwrap_or(0) as f32;
                        let ammo_damage_max = ammo_item_def.pvp_damage_max.unwrap_or(ammo_damage_min as u32) as f32;
                        let ammo_damage = if ammo_damage_min == ammo_damage_max {
                            ammo_damage_min
                        } else {
                            rng.gen_range(ammo_damage_min..=ammo_damage_max)
                        };

                        // Check if this is a thrown item (ammo_def_id == item_def_id)
                        let is_thrown_item = projectile.ammo_def_id == projectile.item_def_id;

                        let final_damage = if is_thrown_item {
                            // Thrown items do double the weapon's base damage
                            weapon_damage * 2.0
                        } else if ammo_item_def.name == "Fire Arrow" {
                            ammo_damage
                        } else {
                            weapon_damage + ammo_damage
                        };

                        if final_damage > 0.0 {
                            match combat::damage_player_corpse(ctx, projectile.owner_id, corpse.id, final_damage, &weapon_item_def, current_time, &mut rng) {
                                Ok(attack_result) => {
                                    if attack_result.hit {
                                        log::info!(
                                            "[ProjectileUpdate] Projectile {} dealt {:.1} damage to Player Corpse {}",
                                            projectile.id, final_damage, corpse.id
                                        );
                                    }
                                }
                                Err(e) => {
                                    log::error!(
                                        "[ProjectileUpdate] Error applying projectile damage to Player Corpse {}: {}",
                                        corpse.id, e
                                    );
                                }
                            }
                        }
                    }
                }
                
                // Add projectile to dropped item system (with break chance) like other hits
                missed_projectiles_for_drops.push((projectile.id, projectile.ammo_def_id, current_x, current_y));
                projectiles_to_delete.push(projectile.id);
                hit_deployable_this_tick = true;
                break;
            }
        }
        
        if hit_deployable_this_tick {
            continue;
        }
        
        if travel_distance > projectile.max_range || elapsed_time > 10.0 {
            // Projectile missed - store info for dropped item creation
            log::info!("DEBUG: Projectile {} reached max range/time. Distance: {:.1}, Range: {:.1}, Time: {:.1}s", 
                projectile.id, travel_distance, projectile.max_range, elapsed_time);
            missed_projectiles_for_drops.push((projectile.id, projectile.ammo_def_id, current_x, current_y));
            projectiles_to_delete.push(projectile.id);
            continue;
        }

        log::info!("DEBUG: Projectile {} checking player collisions at ({:.1}, {:.1})", projectile.id, current_x, current_y);

        // Check living player collisions
        let mut hit_player_this_tick = false;
        for player_to_check in ctx.db.player().iter() {
            if player_to_check.identity == projectile.owner_id || player_to_check.is_dead {
                continue; // Skip self and dead players (corpses handled above)
            }
            
            // Use line segment collision detection for players
            let player_radius = crate::PLAYER_RADIUS;
            let collision_detected = line_intersects_circle(prev_x, prev_y, current_x, current_y, player_to_check.position_x, player_to_check.position_y, player_radius);
            
            // Debug logging for nearby collisions
            if (prev_x - player_to_check.position_x).abs() < 100.0 && (prev_y - player_to_check.position_y).abs() < 100.0 {
                log::info!("DEBUG: Checking collision for projectile {} with living player {:?}. Path: ({:.1},{:.1}) -> ({:.1},{:.1}), Player: ({:.1},{:.1}), Radius: {:.1}, Collision: {}", 
                    projectile.id, player_to_check.identity, 
                    prev_x, prev_y, current_x, current_y, 
                    player_to_check.position_x, player_to_check.position_y, 
                    player_radius, collision_detected);
            }
            
            if collision_detected {
                log::info!("Projectile {} from owner {:?} hit living player {:?} along path from ({:.1}, {:.1}) to ({:.1}, {:.1}) with PLAYER_RADIUS ({:.1})", 
                         projectile.id, projectile.owner_id, player_to_check.identity, prev_x, prev_y, current_x, current_y, crate::PLAYER_RADIUS);
                
                // --- IMPROVED: Use combined weapon + ammunition damage ---
                // Get weapon definition for base damage
                let weapon_item_def = match item_defs_table.id().find(projectile.item_def_id) {
                    Some(def) => def,
                    None => {
                        log::error!("[UpdateProjectiles] ItemDefinition not found for projectile's weapon (ID: {}). Cannot apply damage.", projectile.item_def_id);
                        projectiles_to_delete.push(projectile.id); // Delete projectile if weapon def is missing
                        hit_player_this_tick = true; // Mark as handled to prevent further processing for this projectile
                        break; // Stop checking other players for this projectile
                    }
                };

                // Get ammunition definition for damage calculation
                let ammo_item_def = match item_defs_table.id().find(projectile.ammo_def_id) {
                    Some(def) => def,
                    None => {
                        log::error!("[UpdateProjectiles] ItemDefinition not found for projectile's ammunition (ID: {}). Cannot apply damage.", projectile.ammo_def_id);
                        projectiles_to_delete.push(projectile.id); // Delete projectile if ammo def is missing
                        hit_player_this_tick = true; // Mark as handled to prevent further processing for this projectile
                        break; // Stop checking other players for this projectile
                    }
                };

                // Calculate base weapon damage
                let weapon_damage_min = weapon_item_def.pvp_damage_min.unwrap_or(0) as f32;
                let weapon_damage_max = weapon_item_def.pvp_damage_max.unwrap_or(weapon_damage_min as u32) as f32;
                let weapon_damage = if weapon_damage_min == weapon_damage_max {
                    weapon_damage_min
                } else {
                    rng.gen_range(weapon_damage_min..=weapon_damage_max)
                };

                // Calculate ammunition damage
                let ammo_damage_min = ammo_item_def.pvp_damage_min.unwrap_or(0) as f32;
                let ammo_damage_max = ammo_item_def.pvp_damage_max.unwrap_or(ammo_damage_min as u32) as f32;
                let ammo_damage = if ammo_damage_min == ammo_damage_max {
                    ammo_damage_min
                } else {
                    rng.gen_range(ammo_damage_min..=ammo_damage_max)
                };

                // Check if this is a thrown item (ammo_def_id == item_def_id)
                let is_thrown_item = projectile.ammo_def_id == projectile.item_def_id;

                let final_damage = if is_thrown_item {
                    // Thrown items do double the weapon's base damage
                    weapon_damage * 2.0
                } else if ammo_item_def.name == "Fire Arrow" {
                    ammo_damage
                } else {
                    weapon_damage + ammo_damage
                };

                if is_thrown_item {
                    log::info!("Thrown item damage calculation: Item '{}' base damage ({:.1}) * 2 = {:.1} total damage", 
                             weapon_item_def.name, weapon_damage, final_damage);
                } else {
                    log::info!("Projectile damage calculation: Weapon '{}' ({:.1}) + Ammo '{}' ({:.1}) = {:.1} total damage", 
                             weapon_item_def.name, weapon_damage, ammo_item_def.name, ammo_damage, final_damage);
                }

                // Apply combined damage via combat::damage_player
                match combat::damage_player(ctx, projectile.owner_id, player_to_check.identity, final_damage, &ammo_item_def, current_time) {
                    Ok(attack_result) => {
                        if attack_result.hit {
                            log::info!("Projectile from {:?} (weapon: {} + ammo: {}) dealt {:.1} damage to player {:?}.", 
                                     projectile.owner_id, weapon_item_def.name, ammo_item_def.name, final_damage, player_to_check.identity);
                            
                            // Apply ammunition-based bleed/burn effects
                            if let Err(e) = apply_projectile_bleed_effect(ctx, player_to_check.identity, &ammo_item_def, current_time) {
                                log::error!("Error applying projectile bleed effect for ammo '{}' on player {:?}: {}", 
                                    ammo_item_def.name, player_to_check.identity, e);
                            }
                        } else {
                            log::info!("Projectile from {:?} (weapon: {} + ammo: {}) hit player {:?}, but combat::damage_player reported no effective damage (e.g., target already dead).", 
                                     projectile.owner_id, weapon_item_def.name, ammo_item_def.name, player_to_check.identity);
                        }
                    }
                    Err(e) => {
                        log::error!("Error calling combat::damage_player for projectile hit from {:?} on {:?}: {}", 
                                 projectile.owner_id, player_to_check.identity, e);
                        // Even if damage_player fails, we should consume the projectile.
                    }
                }
                // --- End Improved Combined Damage System ---

                // Add projectile to dropped item system (with break chance) like other hits
                missed_projectiles_for_drops.push((projectile.id, projectile.ammo_def_id, current_x, current_y));
                projectiles_to_delete.push(projectile.id);
                hit_player_this_tick = true;
                break; // Projectile hits one player and is consumed
            }
        }
        
        if hit_player_this_tick {
            continue; // Move to the next projectile if this one hit someone
        }
    }

    // Create dropped items for missed projectiles (with 10% chance to break)
    for (projectile_id, ammo_def_id, pos_x, pos_y) in missed_projectiles_for_drops {
        // Get the ammunition name for better logging
        let ammo_name = item_defs_table.id().find(ammo_def_id)
            .map(|def| def.name.clone())
            .unwrap_or_else(|| format!("Unknown (ID: {})", ammo_def_id));
        
        // 20% chance for the projectile to break and be destroyed
        if rng.gen::<f32>() < 0.15 {
            log::info!("[ProjectileMiss] Projectile {} broke on impact - '{}' (def_id: {}) destroyed at ({:.1}, {:.1})", 
                     projectile_id, ammo_name, ammo_def_id, pos_x, pos_y);
            
            // Create arrow break event for client particle effect
            let break_event = ArrowBreakEvent {
                id: 0, // auto_inc
                pos_x,
                pos_y,
                timestamp: ctx.timestamp,
            };
            ctx.db.arrow_break_event().insert(break_event);
            
            continue; // Skip creating dropped item - projectile is destroyed
        }
        
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

#[reducer]
pub fn throw_item(ctx: &ReducerContext, target_world_x: f32, target_world_y: f32) -> Result<(), String> {
    log::info!("=== THROW_ITEM REDUCER CALLED ===");
    log::info!("Target position: ({:.2}, {:.2})", target_world_x, target_world_y);
    log::info!("Caller identity: {}", ctx.sender.to_string());
    
    let player_id = ctx.sender;
    
    // Find the player
    let player = ctx.db.player().identity().find(&player_id)
        .ok_or("Player not found")?;
    
    if player.is_dead {
        return Err("Dead players cannot throw items".to_string());
    }

    // Get the equipped item and its definition
    let mut equipment = ctx.db.active_equipment().player_identity().find(&player_id)
        .ok_or("No active equipment record found for player.")?;
    
    let equipped_item_def_id = equipment.equipped_item_def_id
        .ok_or("No item equipped to throw.")?;
    
    let equipped_item_instance_id = equipment.equipped_item_instance_id
        .ok_or("No item instance equipped to throw.")?;
    
    let item_def = ctx.db.item_definition().id().find(equipped_item_def_id)
        .ok_or("Equipped item definition not found.")?;

    // Check if the item is throwable (not a ranged weapon, bandage, etc.)
    let is_throwable = match item_def.category {
        crate::items::ItemCategory::RangedWeapon => false,
        _ => {
            // Allow specific throwable items
            let throwable_names = [
                "Rock", "Spear", "Stone Hatchet", "Stone Pickaxe", "Combat Ladle",
                "Bone Club", "Bone Knife", "Repair Hammer", "Stone Spear", "Wooden Spear",
                "Stone Axe", "Stone Knife", "Wooden Club", "Improvised Knife"
            ];
            
            throwable_names.contains(&item_def.name.as_str()) ||
            item_def.name.contains("Hatchet") || item_def.name.contains("Axe") ||
            item_def.name.contains("Pickaxe") || item_def.name.contains("Spear") ||
            item_def.name.contains("Club") || item_def.name.contains("Knife")
        }
    };

    if !is_throwable {
        return Err(format!("Item '{}' cannot be thrown.", item_def.name));
    }

    // Check if the item is bandage, torch, or other special items that shouldn't be thrown
    if item_def.name == "Bandage" || item_def.name == "Selo Olive Oil" || item_def.name == "Torch" {
        return Err(format!("Item '{}' cannot be thrown.", item_def.name));
    }

    // Remove the item from the player's equipment and inventory
    let inventory_items_table = ctx.db.inventory_item();
    let mut item_found = false;

    // Find and remove the specific item instance
    if let Some(inventory_item) = inventory_items_table.instance_id().find(&equipped_item_instance_id) {
        if inventory_item.quantity > 1 {
            // Reduce quantity by 1
            let mut updated_item = inventory_item;
            updated_item.quantity -= 1;
            inventory_items_table.instance_id().update(updated_item);
            item_found = true;
        } else {
            // Remove the item entirely
            inventory_items_table.instance_id().delete(&equipped_item_instance_id);
            item_found = true;
        }
    }

    if !item_found {
        return Err("Could not find equipped item in inventory to throw.".to_string());
    }

    // Clear the equipped item since we threw it
    equipment.equipped_item_def_id = None;
    equipment.equipped_item_instance_id = None;
    equipment.swing_start_time_ms = (ctx.timestamp.to_micros_since_unix_epoch() / 1000) as u64;
    ctx.db.active_equipment().player_identity().update(equipment);

    // --- NEW: Check shelter protection rule for thrown items ---
    // Players inside their own shelter cannot throw items outside
    if let Some(shelter_id) = shelter::is_owner_inside_shelter(ctx, player_id, player.position_x, player.position_y) {
        // Check if target is outside the shelter
        if !shelter::is_player_inside_shelter(target_world_x, target_world_y, &ctx.db.shelter().id().find(shelter_id).unwrap()) {
            return Err("Cannot throw from inside your shelter to targets outside. Leave your shelter to attack.".to_string());
        }
        log::debug!("Player {:?} throwing from inside their shelter {} to target inside same shelter - allowed", player_id, shelter_id);
    }

    // --- Check if projectile path would immediately hit a shelter wall very close to player ---
    if let Some((shelter_id, collision_x, collision_y)) = shelter::check_projectile_shelter_collision(
        ctx,
        player.position_x,
        player.position_y,
        target_world_x,
        target_world_y,
    ) {
        // Only block the throw if the collision happens very close to the player
        let collision_distance = ((collision_x - player.position_x).powi(2) + (collision_y - player.position_y).powi(2)).sqrt();
        const MIN_THROWING_DISTANCE: f32 = 80.0; // About 2 tiles
        
        if collision_distance < MIN_THROWING_DISTANCE {
            return Err(format!("Cannot throw item - shelter wall too close ({:.1} units)", collision_distance));
        }
        
        log::info!("Player {:?} targeting shelter {} at distance {:.1} - throw allowed", player_id, shelter_id, collision_distance);
    }

    // --- Physics Calculation for Thrown Item ---
    let delta_x = target_world_x - player.position_x;
    let delta_y = target_world_y - player.position_y;
    
    // All thrown items have the same throwing speed
    const THROWING_SPEED: f32 = 800.0; // Increased from 400.0 for faster throwing
    let v0 = THROWING_SPEED;
    
    let distance_sq = delta_x * delta_x + delta_y * delta_y;
    if distance_sq < 1.0 {
        return Err("Target too close".to_string());
    }

    // Straight-line physics for thrown items (no gravity arc)
    let distance = distance_sq.sqrt();
    let normalized_dx = delta_x / distance;
    let normalized_dy = delta_y / distance;
    
    let final_vx = normalized_dx * v0;
    let final_vy = normalized_dy * v0;

    // Create projectile for the thrown item
    let projectile = Projectile {
        id: 0, // auto_inc
        owner_id: player_id,
        item_def_id: equipped_item_def_id,
        ammo_def_id: equipped_item_def_id, // For thrown items, ammo_def_id is the same as item_def_id
        start_time: ctx.timestamp,
        start_pos_x: player.position_x,
        start_pos_y: player.position_y,
        velocity_x: final_vx,
        velocity_y: final_vy,
        max_range: 400.0, // Increased from 300.0 to match client throwing distance
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

    log::info!("Item '{}' thrown by player {} towards ({:.1}, {:.1}) with initial V_x={:.1}, V_y={:.1}", 
        item_def.name, player_id.to_string(), target_world_x, target_world_y, final_vx, final_vy);
    Ok(())
} 