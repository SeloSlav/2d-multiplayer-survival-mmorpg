/******************************************************************************
 *                                                                            *
 * Bee Behavior - Beehive Guardian                                            *
 *                                                                            *
 * Tiny, fast, aggressive insects that guard wild beehives.                   *
 * Cannot be killed by normal weapons - only fire (torches, campfires).       *
 *                                                                            *
 * Key behaviors:                                                             *
 * - Spawns at wild beehives (BOX_TYPE_WILD_BEEHIVE)                         *
 * - Very fast movement, attacks frequently with low damage                  *
 * - Returns to home hive when player leaves range                           *
 * - IMMUNE to normal damage - only dies from fire proximity                 *
 * - No collision, no shadow, rendered as tiny black pixel on client        *
 * - Emits buzzing sound (client handles single loop for multiple bees)     *
 *                                                                            *
 ******************************************************************************/

use spacetimedb::{ReducerContext, Identity, Timestamp, Table};
use rand::Rng;
use log;

use crate::Player;
use crate::utils::get_distance_squared;
use crate::wooden_storage_box::BOX_TYPE_WILD_BEEHIVE;
use crate::environment::calculate_chunk_index;

// Table trait imports  
use crate::player as PlayerTableTrait;
use crate::wooden_storage_box::wooden_storage_box as WoodenStorageBoxTableTrait;
use crate::campfire::campfire as CampfireTableTrait;
use crate::fire_patch::fire_patch as FirePatchTableTrait;

use super::core::{
    AnimalBehavior, AnimalStats, AnimalState, MovementPattern, WildAnimal,
    move_towards_target, can_attack, transition_to_state,
    get_player_distance, wild_animal,
    update_animal_position,
};

pub struct BeeBehavior;

// Bee-specific constants
const BEE_HOME_RETURN_DISTANCE: f32 = 400.0; // Return to hive if player is this far
const BEE_AGGRO_RANGE: f32 = 250.0; // Bees aggro when player is within this range of hive
const BEE_FIRE_KILL_RADIUS: f32 = 150.0; // Instant death within this range of campfire (increased from 100)
const BEE_FIRE_KILL_RADIUS_SQ: f32 = BEE_FIRE_KILL_RADIUS * BEE_FIRE_KILL_RADIUS;
const BEE_TORCH_KILL_RADIUS: f32 = 180.0; // Larger kill radius for torches - bees die when player is nearby (increased from 80)
const BEE_TORCH_KILL_RADIUS_SQ: f32 = BEE_TORCH_KILL_RADIUS * BEE_TORCH_KILL_RADIUS;
const BEE_FIRE_PATCH_KILL_RADIUS: f32 = 80.0; // Fire patches (from fire arrows) - increased from 50
const BEE_FIRE_PATCH_KILL_RADIUS_SQ: f32 = BEE_FIRE_PATCH_KILL_RADIUS * BEE_FIRE_PATCH_KILL_RADIUS;

impl AnimalBehavior for BeeBehavior {
    fn get_stats(&self) -> AnimalStats {
        AnimalStats {
            max_health: 1.0, // Effectively invincible to weapons, but dies to fire
            attack_damage: 3.0, // Low damage per hit
            attack_range: 75.0, // Increased from 65 to compensate for collision pushback preventing hits
            attack_speed_ms: 500, // Fast attacks - every 0.5 seconds
            movement_speed: 180.0, // Fast patrol near hive
            sprint_speed: 320.0, // Fast chase - can catch walking players but not sprinters
            perception_range: 300.0, // Detects players near hive
            perception_angle_degrees: 360.0, // Full awareness (swarm behavior)
            patrol_radius: 100.0, // Stays close to hive
            chase_trigger_range: 250.0, // Chases when close to hive
            flee_trigger_health_percent: 0.0, // Never flees
            hide_duration_ms: 0, // Doesn't hide
        }
    }

    fn get_movement_pattern(&self) -> MovementPattern {
        MovementPattern::Wander // Buzzes around near hive
    }

    fn execute_attack_effects(
        &self,
        ctx: &ReducerContext,
        animal: &mut WildAnimal,
        target_player: &Player,
        stats: &AnimalStats,
        _current_time: Timestamp,
        _rng: &mut impl Rng,
    ) -> Result<f32, String> {
        let damage = stats.attack_damage;
        
        // Bee stings are rapid and annoying but individually weak
        // The danger comes from persistence and inability to kill them without fire
        
        log::debug!("Bee {} stings player {} for {} damage", animal.id, target_player.identity, damage);
        Ok(damage)
    }

    fn update_ai_state_logic(
        &self,
        ctx: &ReducerContext,
        animal: &mut WildAnimal,
        stats: &AnimalStats,
        detected_player: Option<&Player>,
        current_time: Timestamp,
        rng: &mut impl Rng,
    ) -> Result<(), String> {
        // First, check for fire - bees die instantly near fire/torches
        if check_and_apply_fire_death(ctx, animal) {
            return Ok(()); // Bee died, nothing more to do
        }
        
        match animal.state {
            AnimalState::Idle | AnimalState::Patrolling => {
                if let Some(player) = detected_player {
                    // Only aggro if player is near the home hive
                    let home_x = animal.spawn_x;
                    let home_y = animal.spawn_y;
                    let player_to_hive_dx = player.position_x - home_x;
                    let player_to_hive_dy = player.position_y - home_y;
                    let player_to_hive_dist_sq = player_to_hive_dx * player_to_hive_dx + player_to_hive_dy * player_to_hive_dy;
                    
                    if player_to_hive_dist_sq < BEE_AGGRO_RANGE * BEE_AGGRO_RANGE {
                        // Player near our hive! Attack!
                        transition_to_state(animal, AnimalState::Chasing, current_time, Some(player.identity), "defending hive");
                        log::debug!("Bee {} defending hive - chasing player {}", animal.id, player.identity);
                    }
                }
                
                // Slowly drift back to hive if far away
                let home_x = animal.spawn_x;
                let home_y = animal.spawn_y;
                let dx = home_x - animal.pos_x;
                let dy = home_y - animal.pos_y;
                let dist_sq = dx * dx + dy * dy;
                
                if dist_sq > 150.0 * 150.0 {
                    // Too far from home, move back
                    animal.investigation_x = Some(home_x + rng.gen_range(-30.0..30.0));
                    animal.investigation_y = Some(home_y + rng.gen_range(-30.0..30.0));
                }
            },
            
            AnimalState::Chasing => {
                if let Some(target_id) = animal.target_player_id {
                    if let Some(target_player) = ctx.db.player().identity().find(&target_id) {
                        // Check if player has moved far from hive - give up chase
                        let home_x = animal.spawn_x;
                        let home_y = animal.spawn_y;
                        let player_to_hive_dx = target_player.position_x - home_x;
                        let player_to_hive_dy = target_player.position_y - home_y;
                        let player_to_hive_dist_sq = player_to_hive_dx * player_to_hive_dx + player_to_hive_dy * player_to_hive_dy;
                        
                        if player_to_hive_dist_sq > BEE_HOME_RETURN_DISTANCE * BEE_HOME_RETURN_DISTANCE {
                            // Player escaped, return home
                            transition_to_state(animal, AnimalState::Patrolling, current_time, None, "player fled - returning to hive");
                            animal.investigation_x = Some(home_x);
                            animal.investigation_y = Some(home_y);
                            log::debug!("Bee {} giving up chase - returning to hive", animal.id);
                            return Ok(());
                        }
                        
                        // Check if target is dead or in water
                        if target_player.is_dead || target_player.is_snorkeling {
                            transition_to_state(animal, AnimalState::Patrolling, current_time, None, "target unavailable");
                            animal.investigation_x = Some(home_x);
                            animal.investigation_y = Some(home_y);
                            return Ok(());
                        }
                    } else {
                        // Target player left - return home
                        transition_to_state(animal, AnimalState::Patrolling, current_time, None, "target disconnected");
                        let home_x = animal.spawn_x;
                        let home_y = animal.spawn_y;
                        animal.investigation_x = Some(home_x);
                        animal.investigation_y = Some(home_y);
                    }
                }
            },
            
            _ => {} // Other states not used by bees
        }
        
        Ok(())
    }

    fn execute_flee_logic(
        &self,
        _ctx: &ReducerContext,
        _animal: &mut WildAnimal,
        _stats: &AnimalStats,
        _dt: f32,
        _current_time: Timestamp,
        _rng: &mut impl Rng,
    ) {
        // Bees never flee - they're fearless defenders
    }

    fn execute_patrol_logic(
        &self,
        ctx: &ReducerContext,
        animal: &mut WildAnimal,
        stats: &AnimalStats,
        dt: f32,
        rng: &mut impl Rng,
    ) {
        // Check for fire death during patrol too
        if check_and_apply_fire_death(ctx, animal) {
            return;
        }
        
        // Buzz around near the hive in erratic patterns
        let home_x = animal.spawn_x;
        let home_y = animal.spawn_y;
        
        // Random buzzing movement
        if rng.gen::<f32>() < 0.15 { // 15% chance per tick to change direction
            let angle = rng.gen::<f32>() * std::f32::consts::PI * 2.0;
            let radius = rng.gen_range(20.0..80.0);
            animal.investigation_x = Some(home_x + angle.cos() * radius);
            animal.investigation_y = Some(home_y + angle.sin() * radius);
        }
        
        // Move towards patrol target
        if let (Some(target_x), Some(target_y)) = (animal.investigation_x, animal.investigation_y) {
            let dx = target_x - animal.pos_x;
            let dy = target_y - animal.pos_y;
            let dist = (dx * dx + dy * dy).sqrt();
            
            if dist > 5.0 {
                let speed = stats.movement_speed * dt;
                let move_x = (dx / dist) * speed.min(dist);
                let move_y = (dy / dist) * speed.min(dist);
                update_animal_position(animal, animal.pos_x + move_x, animal.pos_y + move_y);
            }
        }
    }

    fn should_chase_player(
        &self,
        ctx: &ReducerContext,
        animal: &WildAnimal,
        stats: &AnimalStats,
        player: &Player,
    ) -> bool {
        // Only chase if player is near the hive
        let home_x = animal.spawn_x;
        let home_y = animal.spawn_y;
        let player_to_hive_dx = player.position_x - home_x;
        let player_to_hive_dy = player.position_y - home_y;
        let player_to_hive_dist_sq = player_to_hive_dx * player_to_hive_dx + player_to_hive_dy * player_to_hive_dy;
        
        // Don't chase if player is in water
        if player.is_snorkeling {
            return false;
        }
        
        player_to_hive_dist_sq < BEE_AGGRO_RANGE * BEE_AGGRO_RANGE
    }

    fn handle_damage_response(
        &self,
        ctx: &ReducerContext,
        animal: &mut WildAnimal,
        attacker: &Player,
        stats: &AnimalStats,
        current_time: Timestamp,
        rng: &mut impl Rng,
    ) -> Result<(), String> {
        // Bees are IMMUNE to normal damage - they can only be killed by fire
        // Reset health to max (effectively ignoring the damage)
        animal.health = stats.max_health;
        
        // Become more aggressive instead
        if animal.state != AnimalState::Chasing {
            transition_to_state(animal, AnimalState::Chasing, current_time, Some(attacker.identity), "enraged by attack");
            log::debug!("Bee {} enraged by attack - immune to weapons!", animal.id);
        }
        
        Ok(())
    }
    
    fn get_chase_abandonment_multiplier(&self) -> f32 {
        1.0 // Bees use distance from hive, not chase distance
    }
}

/// Check if bee is near fire and should die instantly
/// Returns true if the bee died
fn check_and_apply_fire_death(ctx: &ReducerContext, animal: &mut WildAnimal) -> bool {
    // DEBUG: Log every time this is called to confirm bees are reaching this function
    log::trace!("🐝 check_and_apply_fire_death called for bee {} at ({:.1}, {:.1})", 
               animal.id, animal.pos_x, animal.pos_y);
    
    // Check for burning campfires
    for campfire in ctx.db.campfire().iter() {
        if !campfire.is_burning || campfire.is_destroyed {
            continue;
        }
        
        let dx = campfire.pos_x - animal.pos_x;
        let dy = campfire.pos_y - animal.pos_y;
        let dist_sq = dx * dx + dy * dy;
        
        if dist_sq < BEE_FIRE_KILL_RADIUS_SQ {
            // Bee caught in campfire - instant death!
            log::info!("🐝🔥 Bee {} burned to death near campfire!", animal.id);
            // Emit death sound and delete bee (no corpse for bees)
            emit_bee_death_and_delete(ctx, animal);
            return true;
        }
    }
    
    // Check for fire patches (from fire arrows)
    for fire_patch in ctx.db.fire_patch().iter() {
        // Fire patches are always "burning" until they expire (handled by cleanup schedule)
        let dx = fire_patch.pos_x - animal.pos_x;
        let dy = fire_patch.pos_y - animal.pos_y;
        let dist_sq = dx * dx + dy * dy;
        
        if dist_sq < BEE_FIRE_PATCH_KILL_RADIUS_SQ {
            // Bee flew into fire patch - instant death!
            log::info!("🐝🔥 Bee {} burned to death in fire patch!", animal.id);
            emit_bee_death_and_delete(ctx, animal);
            return true;
        }
    }
    
    // Check for players with lit torches
    for player in ctx.db.player().iter() {
        if player.is_dead {
            continue;
        }
        
        // Check if player has a lit torch equipped
        let has_torch = player_has_lit_torch(ctx, &player);
        
        let dx = player.position_x - animal.pos_x;
        let dy = player.position_y - animal.pos_y;
        let dist_sq = dx * dx + dy * dy;
        let dist = dist_sq.sqrt();
        
        // Debug log for torch checking (only for close players)
        if dist < 300.0 {
            log::debug!("🐝 Bee {} checking player {} - distance: {:.1}px, torch_lit: {}, kill_radius: {:.1}", 
                       animal.id, player.identity, dist, has_torch, BEE_TORCH_KILL_RADIUS);
        }
        
        if !has_torch {
            continue;
        }
        
        if dist_sq < BEE_TORCH_KILL_RADIUS_SQ {
            // Bee caught near torch - instant death!
            log::info!("🐝🔥 Bee {} burned to death near player {}'s torch! (dist: {:.1}px)", animal.id, player.identity, dist);
            emit_bee_death_and_delete(ctx, animal);
            return true;
        }
    }
    
    false
}

/// Emit bee death sound and delete the bee from the database
/// Bees don't create corpses - they just poof when killed by fire
fn emit_bee_death_and_delete(ctx: &ReducerContext, animal: &WildAnimal) {
    use crate::sound_events::{self, SoundType};
    use super::core::wild_animal as WildAnimalTableTrait;
    
    // Emit death sound at bee's position
    if let Err(e) = sound_events::emit_sound_at_position(
        ctx, 
        SoundType::DeathBee, 
        animal.pos_x, 
        animal.pos_y, 
        0.6,  // Lower volume - bees are small
        ctx.identity()
    ) {
        log::error!("Failed to emit bee death sound: {}", e);
    }
    
    // Delete the bee - no corpse for bees
    ctx.db.wild_animal().id().delete(&animal.id);
    log::debug!("🐝 Bee {} removed after fire death (no corpse)", animal.id);
}

/// Check if a player has a lit torch equipped
fn player_has_lit_torch(_ctx: &ReducerContext, player: &Player) -> bool {
    // Player struct has is_torch_lit field that tracks if torch is currently lit
    player.is_torch_lit
}

/// Spawn bees at a beehive location
/// Called when a beehive is interacted with or periodically
pub fn spawn_bees_at_hive(
    ctx: &ReducerContext,
    hive_id: u64,
    hive_x: f32,
    hive_y: f32,
    count: u32,
    rng: &mut impl Rng,
) -> Result<Vec<u64>, String> {
    use super::core::AnimalSpecies;
    
    let mut spawned_ids = Vec::new();
    let current_time = ctx.timestamp;
    
    for i in 0..count {
        // Spawn bees slightly scattered around the hive
        let offset_angle = rng.gen::<f32>() * std::f32::consts::PI * 2.0;
        let offset_dist = rng.gen_range(20.0..60.0);
        let spawn_x = hive_x + offset_angle.cos() * offset_dist;
        let spawn_y = hive_y + offset_angle.sin() * offset_dist;
        if super::core::is_position_in_alk_wildlife_zone(ctx, spawn_x, spawn_y) { continue; }
        
        let bee = WildAnimal {
            id: 0, // Auto-increment
            species: AnimalSpecies::Bee,
            pos_x: spawn_x,
            pos_y: spawn_y,
            direction_x: 0.0,
            direction_y: 0.0,
            facing_direction: "right".to_string(),
            health: 1.0, // Will be ignored for damage anyway
            state: AnimalState::Patrolling,
            spawn_x: hive_x, // Home hive location
            spawn_y: hive_y,
            target_player_id: None,
            last_attack_time: None,
            state_change_time: current_time,
            hide_until: None,
            investigation_x: Some(hive_x),
            investigation_y: Some(hive_y),
            patrol_phase: 0.0,
            scent_ping_timer: 0,
            movement_pattern: MovementPattern::Wander,
            chunk_index: calculate_chunk_index(spawn_x, spawn_y), // Must match hive chunk for AI processing
            created_at: current_time,
            last_hit_time: None,
            is_pack_leader: false,
            pack_id: Some(hive_id), // Use hive ID as pack ID for grouping
            pack_join_time: None,
            last_pack_check: None,
            fire_fear_overridden_by: None,
            tamed_by: None,
            tamed_at: None,
            heart_effect_until: None,
            crying_effect_until: None,
            last_food_check: None,
            held_item_name: None,
            held_item_quantity: None,
            flying_target_x: None,
            flying_target_y: None,
            is_flying: false,
            is_hostile_npc: false,
            target_structure_id: None,
            target_structure_type: None,
            stalk_angle: 0.0,
            stalk_distance: 0.0,
            despawn_at: None,
            shock_active_until: None,
            last_shock_time: None,
        };
        
        let inserted = ctx.db.wild_animal().insert(bee);
        spawned_ids.push(inserted.id);
        log::debug!("Spawned bee {} at hive {} ({}, {})", inserted.id, hive_id, spawn_x, spawn_y);
    }
    
    if !spawned_ids.is_empty() {
        log::info!("Spawned {} bees at hive {} ({}, {})", count, hive_id, hive_x, hive_y);
    }
    
    Ok(spawned_ids)
}

/// Check if there are already bees at a hive
pub fn count_bees_at_hive(ctx: &ReducerContext, hive_x: f32, hive_y: f32) -> u32 {
    use super::core::AnimalSpecies;
    
    let mut count = 0;
    for animal in ctx.db.wild_animal().iter() {
        if animal.species != AnimalSpecies::Bee {
            continue;
        }
        let spawn_x = animal.spawn_x;
        let spawn_y = animal.spawn_y;
        let dx = spawn_x - hive_x;
        let dy = spawn_y - hive_y;
        if dx * dx + dy * dy < 100.0 * 100.0 {
            count += 1;
        }
    }
    count
}

/// Spawn bees when a wild beehive is first interacted with
/// Returns the number of bees spawned
pub fn ensure_bees_at_hive(ctx: &ReducerContext, hive_id: u64, hive_x: f32, hive_y: f32) -> u32 {
    let existing = count_bees_at_hive(ctx, hive_x, hive_y);
    
    if existing >= 3 {
        return 0; // Already have enough bees
    }
    
    let to_spawn = 3 - existing; // Spawn up to 3 bees per hive
    let mut rng = ctx.rng();
    
    match spawn_bees_at_hive(ctx, hive_id, hive_x, hive_y, to_spawn, &mut rng) {
        Ok(ids) => ids.len() as u32,
        Err(e) => {
            log::warn!("Failed to spawn bees at hive {}: {}", hive_id, e);
            0
        }
    }
}
