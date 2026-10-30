use spacetimedb::{table, reducer, ReducerContext, Table, Identity, Timestamp, ScheduleAt, TimeDuration};
use log;
use crate::items::{InventoryItem, ItemDefinition, add_item_to_player_inventory, split_stack_helper};
use crate::items::{inventory_item as InventoryItemTableTrait, item_definition as ItemDefinitionTableTrait};
use crate::models::{ItemLocation, ContainerType, ContainerLocationData, InventoryLocationData, HotbarLocationData, EquippedLocationData, DroppedLocationData};
use crate::inventory_management::{self, ItemContainer, ContainerItemClearer, handle_move_to_container_slot, handle_quick_move_from_container, handle_move_from_container_slot, handle_move_within_container, handle_split_within_container, handle_quick_move_to_container, handle_split_from_container, handle_drop_from_container_slot, handle_split_and_drop_from_container_slot, merge_or_place_into_container_slot};
use crate::{Player, player as PlayerTableTrait};
use crate::environment::calculate_chunk_index;
use crate::player_inventory::{get_player_item, find_first_empty_player_slot, move_item_to_inventory, move_item_to_hotbar};
use crate::dropped_item::create_dropped_item_entity_with_data;
use crate::projectile::{Projectile, ProjectileRuntimeState, PROJECTILE_SOURCE_TURRET, PROJECTILE_SOURCE_MONUMENT_TURRET, NPC_PROJECTILE_NONE};
use crate::projectile::projectile as ProjectileTableTrait;
use crate::projectile::projectile_runtime_state as ProjectileRuntimeStateTableTrait;
use crate::world_state::world_state as WorldStateTableTrait;
use crate::wild_animal_npc::wild_animal as WildAnimalTableTrait;
use crate::sound_events::emit_shoot_turret_sound;

// --- Constants ---
pub const TURRET_PLACEMENT_MAX_DISTANCE: f32 = 150.0;
pub const TURRET_PLACEMENT_MAX_DISTANCE_SQUARED: f32 = TURRET_PLACEMENT_MAX_DISTANCE * TURRET_PLACEMENT_MAX_DISTANCE;
pub const TURRET_INITIAL_HEALTH: f32 = 500.0;
pub const TURRET_MAX_HEALTH: f32 = 500.0;
pub const NUM_AMMO_SLOTS: usize = 1;
pub const TURRET_PROCESS_INTERVAL_MS: u64 = 500; // Process every 500ms
pub const PLAYER_TURRET_INTERACTION_DISTANCE: f32 = 200.0;
pub const PLAYER_TURRET_INTERACTION_DISTANCE_SQUARED: f32 = PLAYER_TURRET_INTERACTION_DISTANCE * PLAYER_TURRET_INTERACTION_DISTANCE;

// === TURRET COLLISION CONSTANTS ===
// Turrets are 256x256 sprites centered on posX/posY
pub const TURRET_COLLISION_RADIUS: f32 = 50.0; // Collision radius for centered 256x256 sprite
pub const TURRET_COLLISION_Y_OFFSET: f32 = 0.0; // Collision centered at posY

// === TURRET TYPE CONSTANTS ===
pub const TURRET_TYPE_TALLOW_STEAM: u8 = 0;
// Future: TURRET_TYPE_BALLISTA, TURRET_TYPE_ROCK_LAUNCHER, etc.

// === TALLOW STEAM TURRET STATS ===
pub const TURRET_RANGE: f32 = 400.0;
pub const TURRET_RANGE_SQUARED: f32 = TURRET_RANGE * TURRET_RANGE;
pub const TURRET_FIRE_INTERVAL_MS: u64 = 2000;  // 2 seconds (30 shots/min) - doubled attack speed
pub const TALLOW_PROJECTILE_DAMAGE: f32 = 75.0; // Increased from 15.0 - tallow explodes on impact
pub const TALLOW_PROJECTILE_SPEED: f32 = 350.0; // Slow molten glob - visible in flight
pub const FIRE_PATCH_CHANCE_PERCENT: u32 = 25; // 25% chance to create fire patch on hit

// === MONUMENT TURRET STATS ===
// Range matches the central compound building exclusion zone (250.0 * 8.75 = 2187.5px)
pub const MONUMENT_TURRET_RANGE: f32 = 2188.0;
pub const MONUMENT_TURRET_RANGE_SQUARED: f32 = MONUMENT_TURRET_RANGE * MONUMENT_TURRET_RANGE;
pub const MONUMENT_TURRET_FIRE_INTERVAL_MS: u64 = 400; // Very fast attack speed for monument turrets
pub const MONUMENT_TURRET_DAMAGE: f32 = 99999.0; // One-shot kill any target
pub const MONUMENT_TURRET_PROJECTILE_SPEED: f32 = 600.0; // Fast projectile for monument turrets
pub const MONUMENT_TURRET_COLLISION_RADIUS: f32 = 100.0; // Double collision radius for 2x size monument turrets

// --- Turret Table ---
#[spacetimedb::table(accessor = turret, public)]
#[derive(Clone, Debug)]
pub struct Turret {
    #[primary_key]
    #[auto_inc]
    pub id: u32,
    pub turret_type: u8,                  // Type of turret (0 = Tallow Steam, future: ballista, etc.)
    pub pos_x: f32,
    pub pos_y: f32,
    #[index(btree)]
    pub chunk_index: u32,                 // Spatial index
    pub placed_by: Identity,
    pub placed_at: Timestamp,
    // Ammo slot (Tallow for steam turret)
    pub ammo_instance_id: Option<u64>,
    pub ammo_def_id: Option<u64>,
    pub last_fire_time: Option<Timestamp>,
    pub current_target_id: Option<u64>,   // WildAnimal ID being targeted
    pub current_target_player: Option<Identity>, // Player being targeted (PvP)
    pub health: f32,
    pub max_health: f32,
    pub is_destroyed: bool,
    pub destroyed_at: Option<Timestamp>,
    pub last_hit_time: Option<Timestamp>,
    /// Monument turrets are indestructible, have infinite ammo, extended range,
    /// target PvP players + all wild animals, and one-shot kill any valid target.
    pub is_monument: bool,
}

// --- Scheduled Processing Table ---
#[spacetimedb::table(accessor = turret_processing_schedule, scheduled(process_turret_logic_scheduled))]
#[derive(Clone, Debug)]
pub struct TurretProcessingSchedule {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub scheduled_at: ScheduleAt,
}

// --- ItemContainer Implementation ---
impl ItemContainer for Turret {
    fn num_slots(&self) -> usize {
        NUM_AMMO_SLOTS
    }

    fn get_slot_instance_id(&self, slot_index: u8) -> Option<u64> {
        match slot_index {
            0 => self.ammo_instance_id,
            _ => None,
        }
    }

    fn get_slot_def_id(&self, slot_index: u8) -> Option<u64> {
        match slot_index {
            0 => self.ammo_def_id,
            _ => None,
        }
    }

    fn set_slot(&mut self, slot_index: u8, instance_id: Option<u64>, def_id: Option<u64>) {
        match slot_index {
            0 => {
                self.ammo_instance_id = instance_id;
                self.ammo_def_id = def_id;
            }
            _ => {}
        }
    }

    fn get_container_type(&self) -> ContainerType {
        ContainerType::Turret
    }

    fn get_container_id(&self) -> u64 {
        self.id as u64
    }
}

// --- ContainerItemClearer Implementation ---
pub struct TurretClearer;

impl ContainerItemClearer for TurretClearer {
    fn clear_item(ctx: &ReducerContext, item_instance_id: u64) -> bool {
        let turrets = ctx.db.turret();
        
        for mut turret in turrets.iter() {
            // Check ammo slot
            if turret.ammo_instance_id == Some(item_instance_id) {
                let turret_id = turret.id; // Save id before move
                turret.ammo_instance_id = None;
                turret.ammo_def_id = None;
                turrets.id().update(turret);
                log::info!("Cleared item {} from turret {} ammo slot", item_instance_id, turret_id);
                return true;
            }
        }
        
        false
    }
}

// --- Initialization ---
pub fn init_turret_system(ctx: &ReducerContext) -> Result<(), String> {
    let schedule_table = ctx.db.turret_processing_schedule();
    if schedule_table.iter().count() == 0 {
        log::info!("Starting turret processing schedule (every {}ms).", TURRET_PROCESS_INTERVAL_MS);
        let interval = TimeDuration::from_micros(TURRET_PROCESS_INTERVAL_MS as i64 * 1000);
        crate::try_insert_schedule!(
            schedule_table,
            TurretProcessingSchedule {
                id: 0,
                scheduled_at: ScheduleAt::Interval(interval),
            },
            "Turret processing"
        );
    } else {
        log::debug!("Turret processing schedule already exists.");
    }
    Ok(())
}

// --- Helper Functions ---

/// Validates that a player can interact with a turret (distance check)
fn validate_turret_interaction(ctx: &ReducerContext, turret_id: u32) -> Result<(Player, Turret), String> {
    let sender_id = ctx.sender();
    let player = ctx.db.player().identity().find(&sender_id)
        .ok_or_else(|| "Player not found.".to_string())?;
    
    let turret = ctx.db.turret().id().find(&turret_id)
        .ok_or_else(|| "Turret not found.".to_string())?;
    
    if turret.is_destroyed {
        return Err("Turret is destroyed.".to_string());
    }
    
    let dx = player.position_x - turret.pos_x;
    let dy = player.position_y - turret.pos_y;
    let dist_sq = dx * dx + dy * dy;
    
    if dist_sq > PLAYER_TURRET_INTERACTION_DISTANCE_SQUARED {
        return Err("Too far from turret.".to_string());
    }
    
    Ok((player, turret))
}

/// Finds the nearest valid target for a turret
fn find_target(ctx: &ReducerContext, turret: &Turret, current_time: Timestamp) -> Option<TargetInfo> {
    let turret_range_sq = TURRET_RANGE_SQUARED;
    
    // Priority 1: Hostile NPCs (always target - NOT regular wild animals like wolves/foxes)
    let mut closest_npc: Option<(u64, f32)> = None;
    for animal in ctx.db.wild_animal().iter() {
        // ONLY target hostile NPCs (Shorebound, Shardkin, DrownedWatch)
        // Never target regular animals (wolves, foxes, etc.)
        if animal.is_hostile_npc && animal.health > 0.0 {
            let dx = animal.pos_x - turret.pos_x;
            let dy = animal.pos_y - turret.pos_y;
            let dist_sq = dx * dx + dy * dy;
            if dist_sq < turret_range_sq {
                if closest_npc.map(|(_, d)| dist_sq < d).unwrap_or(true) {
                    closest_npc = Some((animal.id, dist_sq));
                }
            }
        }
    }
    
    if let Some((npc_id, _)) = closest_npc {
        return Some(TargetInfo::Animal(npc_id));
    }
    
    // Priority 2: Players (only if they have PvP enabled, and turret owner has PvP enabled)
    // Check if turret owner has PvP enabled first
    let owner_pvp_active = ctx.db.player().identity().find(&turret.placed_by)
        .map(|owner| crate::combat::is_pvp_active_for_player(&owner, current_time))
        .unwrap_or(false);
    
    if owner_pvp_active {
        let mut closest_player: Option<(Identity, f32)> = None;
        
        for player in ctx.db.player().iter() {
            // Skip owner, dead players, offline players
            if player.identity == turret.placed_by || player.is_dead || !player.is_online {
                continue;
            }
            
            // Only target players with active PvP
            if !crate::combat::is_pvp_active_for_player(&player, current_time) {
                continue;
            }
            
            // Check range
            let dx = player.position_x - turret.pos_x;
            let dy = player.position_y - turret.pos_y;
            let dist_sq = dx * dx + dy * dy;
            if dist_sq < turret_range_sq {
                if closest_player.map(|(_, d)| dist_sq < d).unwrap_or(true) {
                    closest_player = Some((player.identity, dist_sq));
                }
            }
        }
        
        if let Some((player_id, _)) = closest_player {
            return Some(TargetInfo::Player(player_id));
        }
    }
    
    None
}

/// Finds the nearest valid target for a monument turret.
/// Monument turrets target ONLY the 3 apparitions (Shorebound, Shardkin, Drowned Watch) and PvP-enabled players.
/// They do NOT target regular wild animals (wolves, crabs, voles, etc.).
fn find_monument_target(ctx: &ReducerContext, turret: &Turret, current_time: Timestamp) -> Option<TargetInfo> {
    let range_sq = MONUMENT_TURRET_RANGE_SQUARED;
    
    let mut closest_target: Option<(TargetInfo, f32)> = None;
    
    // Target ONLY the 3 apparitions (Shorebound, Shardkin, Drowned Watch) - not regular wild animals
    for animal in ctx.db.wild_animal().iter() {
        if animal.health <= 0.0 {
            continue;
        }
        if !animal.is_hostile_npc {
            continue; // Skip non-apparition animals (wolves, crabs, voles, etc.)
        }
        let dx = animal.pos_x - turret.pos_x;
        let dy = animal.pos_y - turret.pos_y;
        let dist_sq = dx * dx + dy * dy;
        if dist_sq < range_sq {
            if closest_target.as_ref().map(|(_, d)| dist_sq < *d).unwrap_or(true) {
                closest_target = Some((TargetInfo::Animal(animal.id), dist_sq));
            }
        }
    }
    
    // Target ALL PvP-enabled players (no owner PvP check needed - monument is system-owned)
    for player in ctx.db.player().iter() {
        // Skip dead/offline players
        if player.is_dead || !player.is_online {
            continue;
        }
        
        // Only target players with active PvP
        if !crate::combat::is_pvp_active_for_player(&player, current_time) {
            continue;
        }
        
        let dx = player.position_x - turret.pos_x;
        let dy = player.position_y - turret.pos_y;
        let dist_sq = dx * dx + dy * dy;
        if dist_sq < range_sq {
            if closest_target.as_ref().map(|(_, d)| dist_sq < *d).unwrap_or(true) {
                closest_target = Some((TargetInfo::Player(player.identity), dist_sq));
            }
        }
    }
    
    closest_target.map(|(info, _)| info)
}

/// Target info enum
pub(crate) enum TargetInfo {
    Animal(u64),
    Player(Identity),
}

// --- Reducers ---

/// Place a turret in the world
#[spacetimedb::reducer]
pub fn place_turret(ctx: &ReducerContext, item_instance_id: u64, world_x: f32, world_y: f32) -> Result<(), String> {
    let sender_id = ctx.sender();
    let inventory_items = ctx.db.inventory_item();
    let item_defs = ctx.db.item_definition();
    
    // Find the item being placed
    let item = inventory_items.instance_id().find(&item_instance_id)
        .ok_or_else(|| "Item not found.".to_string())?;
    
    // Verify player owns the item (must be in inventory or hotbar)
    let is_owned = match &item.location {
        ItemLocation::Inventory(data) => data.owner_id == sender_id,
        ItemLocation::Hotbar(data) => data.owner_id == sender_id,
        _ => false,
    };
    if !is_owned {
        return Err("Item not in player inventory.".to_string());
    }
    
    // Get item definition to determine turret type
    let item_def = item_defs.id().find(&item.item_def_id)
        .ok_or_else(|| "Item definition not found.".to_string())?;
    
    // Determine turret type from item name
    let turret_type = if item_def.name == "Tallow Steam Turret" {
        TURRET_TYPE_TALLOW_STEAM
    } else {
        return Err(format!("Unknown turret item: {}", item_def.name));
    };
    
    // Distance check
    let player = ctx.db.player().identity().find(&sender_id)
        .ok_or_else(|| "Player not found.".to_string())?;
    let dx = player.position_x - world_x;
    let dy = player.position_y - world_y;
    let dist_sq = dx * dx + dy * dy;
    
    if dist_sq > TURRET_PLACEMENT_MAX_DISTANCE_SQUARED {
        return Err("Too far to place turret.".to_string());
    }
    
    // Check for water (basic check - you may want to enhance this)
    // TODO: Add proper water check
    
    // Check for collision with existing turrets
    for existing_turret in ctx.db.turret().iter() {
        if existing_turret.is_destroyed {
            continue;
        }
        let dx = existing_turret.pos_x - world_x;
        let dy = existing_turret.pos_y - world_y;
        let dist_sq = dx * dx + dy * dy;
        if dist_sq < 100.0 * 100.0 { // 100px minimum spacing
            return Err("Too close to another turret.".to_string());
        }
    }

    crate::placeable_collision::check_placeable_overlap(ctx, world_x, world_y, 48.0, 48.0, true)?;

    // Create turret
    let chunk_index = calculate_chunk_index(world_x, world_y);
    let new_turret = Turret {
        id: 0, // auto_inc
        turret_type,
        pos_x: world_x,
        pos_y: world_y,
        chunk_index,
        placed_by: sender_id,
        placed_at: ctx.timestamp,
        ammo_instance_id: None,
        ammo_def_id: None,
        last_fire_time: None,
        current_target_id: None,
        current_target_player: None,
        health: TURRET_INITIAL_HEALTH,
        max_health: TURRET_MAX_HEALTH,
        is_destroyed: false,
        destroyed_at: None,
        last_hit_time: None,
        is_monument: false, // Player-placed turrets are not monument turrets
    };
    
    ctx.db.turret().insert(new_turret);
    
    // Remove item from inventory
    inventory_items.instance_id().delete(item_instance_id);
    
    log::info!("Turret placed at ({}, {}) by player {:?}", world_x, world_y, sender_id);
    Ok(())
}

/// Move item to turret ammo slot
#[spacetimedb::reducer]
pub fn move_item_to_turret(ctx: &ReducerContext, turret_id: u32, slot_index: u8, item_instance_id: u64) -> Result<(), String> {
    let (_player, mut turret) = validate_turret_interaction(ctx, turret_id)?;
    
    // Validate ammo type based on turret_type
    let item = ctx.db.inventory_item().instance_id().find(&item_instance_id)
        .ok_or_else(|| "Item not found.".to_string())?;
    let item_def = ctx.db.item_definition().id().find(&item.item_def_id)
        .ok_or_else(|| "Item definition not found.".to_string())?;
    
    // Tallow Steam Turret only accepts Tallow
    if turret.turret_type == TURRET_TYPE_TALLOW_STEAM {
        if item_def.name != "Tallow" {
            return Err("Tallow Steam Turret only accepts Tallow.".to_string());
        }
    }
    
    // Use generic handler
    handle_move_to_container_slot(
        ctx,
        &mut turret,
        slot_index,
        item_instance_id,
    )?;
    
    // Update turret
    ctx.db.turret().id().update(turret);
    
    Ok(())
}

/// Quick move from turret ammo slot
#[spacetimedb::reducer]
pub fn quick_move_from_turret(ctx: &ReducerContext, turret_id: u32, slot_index: u8) -> Result<(), String> {
    let (_player, mut turret) = validate_turret_interaction(ctx, turret_id)?;
    
    handle_quick_move_from_container(
        ctx,
        &mut turret,
        slot_index,
    )?;
    
    ctx.db.turret().id().update(turret);
    
    Ok(())
}

/// Quick move item from player inventory/hotbar TO turret
#[spacetimedb::reducer]
pub fn quick_move_to_turret(
    ctx: &ReducerContext,
    turret_id: u32,
    item_instance_id: u64,
) -> Result<(), String> {
    let (_player, mut turret) = validate_turret_interaction(ctx, turret_id)?;
    
    // Validate ammo type based on turret_type
    let item = ctx.db.inventory_item().instance_id().find(&item_instance_id)
        .ok_or_else(|| "Item not found.".to_string())?;
    let item_def = ctx.db.item_definition().id().find(&item.item_def_id)
        .ok_or_else(|| "Item definition not found.".to_string())?;
    
    // Tallow Steam Turret only accepts Tallow
    if turret.turret_type == TURRET_TYPE_TALLOW_STEAM {
        if item_def.name != "Tallow" {
            return Err("Tallow Steam Turret only accepts Tallow as ammo.".to_string());
        }
    }
    
    handle_quick_move_to_container(ctx, &mut turret, item_instance_id)?;
    ctx.db.turret().id().update(turret);
    Ok(())
}

/// Move item FROM turret slot TO a specific player inventory/hotbar slot
#[spacetimedb::reducer]
pub fn move_item_from_turret_to_player_slot(
    ctx: &ReducerContext,
    turret_id: u32,
    source_slot_index: u8,
    target_slot_type: String,
    target_slot_index: u32,
) -> Result<(), String> {
    let (_player, mut turret) = validate_turret_interaction(ctx, turret_id)?;
    handle_move_from_container_slot(ctx, &mut turret, source_slot_index, target_slot_type, target_slot_index)?;
    ctx.db.turret().id().update(turret);
    Ok(())
}

/// Split stack FROM player inventory/hotbar INTO turret ammo slot
#[spacetimedb::reducer]
pub fn split_stack_into_turret(
    ctx: &ReducerContext,
    source_item_instance_id: u64,
    quantity_to_split: u32,
    target_turret_id: u32,
    target_slot_index: u8,
) -> Result<(), String> {
    let (_player, mut turret) = validate_turret_interaction(ctx, target_turret_id)?;
    
    // Validate ammo type based on turret_type
    let item = ctx.db.inventory_item().instance_id().find(&source_item_instance_id)
        .ok_or_else(|| "Item not found.".to_string())?;
    let item_def = ctx.db.item_definition().id().find(&item.item_def_id)
        .ok_or_else(|| "Item definition not found.".to_string())?;
    
    // Tallow Steam Turret only accepts Tallow
    if turret.turret_type == TURRET_TYPE_TALLOW_STEAM {
        if item_def.name != "Tallow" {
            return Err("Tallow Steam Turret only accepts Tallow.".to_string());
        }
    }
    
    let mut source_item = get_player_item(ctx, source_item_instance_id)?;
    let new_item_target_location = ItemLocation::Container(ContainerLocationData {
        container_type: ContainerType::Turret,
        container_id: turret.id as u64,
        slot_index: target_slot_index,
    });
    let new_item_instance_id = split_stack_helper(ctx, &mut source_item, quantity_to_split, new_item_target_location)?;
    
    // Fetch the newly created item and its definition to pass to merge_or_place
    let mut new_item = ctx.db.inventory_item().instance_id().find(new_item_instance_id)
        .ok_or_else(|| format!("Failed to find newly split item instance {}", new_item_instance_id))?;
    let new_item_def = ctx.db.item_definition().id().find(new_item.item_def_id)
        .ok_or_else(|| format!("Failed to find definition for new item {}", new_item.item_def_id))?;

    merge_or_place_into_container_slot(ctx, &mut turret, target_slot_index, &mut new_item, &new_item_def)?;
    
    // Update the source item (quantity changed by split_stack_helper)
    ctx.db.inventory_item().instance_id().update(source_item);
    ctx.db.turret().id().update(turret);
    Ok(())
}

/// Split stack FROM turret ammo slot TO player inventory/hotbar slot
#[spacetimedb::reducer]
pub fn split_stack_from_turret(
    ctx: &ReducerContext,
    turret_id: u32,
    source_slot_index: u8,
    quantity_to_split: u32,
    target_slot_type: String,
    target_slot_index: u32,
) -> Result<(), String> {
    let (_player, mut turret) = validate_turret_interaction(ctx, turret_id)?;
    
    log::info!(
        "[SplitFromTurret] Player {:?} splitting {} from turret {} slot {} to {} slot {}",
        ctx.sender(), quantity_to_split, turret_id, source_slot_index, target_slot_type, target_slot_index
    );

    // Call generic handler
    handle_split_from_container(
        ctx,
        &mut turret,
        source_slot_index,
        quantity_to_split,
        target_slot_type,
        target_slot_index,
    )?;
    
    ctx.db.turret().id().update(turret);
    Ok(())
}

/// Split stack WITHIN turret (between slots - though turret only has 1 slot, this is for consistency)
#[spacetimedb::reducer]
pub fn split_stack_within_turret(
    ctx: &ReducerContext,
    turret_id: u32,
    source_slot_index: u8,
    quantity_to_split: u32,
    target_slot_index: u8,
) -> Result<(), String> {
    let (_player, mut turret) = validate_turret_interaction(ctx, turret_id)?;
    handle_split_within_container(ctx, &mut turret, source_slot_index, target_slot_index, quantity_to_split)?;
    ctx.db.turret().id().update(turret);
    Ok(())
}

/// Pickup turret (must be empty and not destroyed)
#[spacetimedb::reducer]
pub fn pickup_turret(ctx: &ReducerContext, turret_id: u32) -> Result<(), String> {
    let sender_id = ctx.sender();
    let (_player, turret) = validate_turret_interaction(ctx, turret_id)?;
    
    // Monument turrets cannot be picked up
    if turret.is_monument {
        return Err("Monument turrets cannot be picked up.".to_string());
    }
    
    // Check if turret is empty
    if turret.ammo_instance_id.is_some() {
        return Err("Turret must be empty to pickup.".to_string());
    }
    
    // Find item definition for turret
    let item_defs = ctx.db.item_definition();
    let turret_item_name = match turret.turret_type {
        TURRET_TYPE_TALLOW_STEAM => "Tallow Steam Turret",
        _ => return Err("Unknown turret type.".to_string()),
    };
    
    let turret_item_def = item_defs.iter()
        .find(|def| def.name == turret_item_name)
        .ok_or_else(|| format!("Turret item definition '{}' not found.", turret_item_name))?;
    
    // Give item to player
    match crate::dropped_item::try_give_item_to_player(ctx, sender_id, turret_item_def.id, 1) {
        Ok(_) => {
            // Delete turret
            ctx.db.turret().id().delete(turret_id);
            log::info!("Turret {} picked up by player {:?}", turret_id, sender_id);
            Ok(())
        }
        Err(e) => Err(format!("Failed to add turret to inventory: {}", e)),
    }
}

/// Interact with turret (opens UI)
#[spacetimedb::reducer]
pub fn interact_with_turret(ctx: &ReducerContext, turret_id: u32) -> Result<(), String> {
    let (_player, turret) = validate_turret_interaction(ctx, turret_id)?;
    
    // Monument turrets cannot be interacted with by players
    if turret.is_monument {
        return Err("Monument turrets cannot be interacted with.".to_string());
    }
    
    // UI is handled client-side, this reducer just validates interaction
    Ok(())
}

/// Scheduled reducer to process turret logic (targeting and firing)
#[spacetimedb::reducer]
pub fn process_turret_logic_scheduled(ctx: &ReducerContext, _schedule: TurretProcessingSchedule) -> Result<(), String> {
    // Security check - only allow scheduler to call this
    if ctx.sender() != ctx.identity() {
        return Err("process_turret_logic_scheduled can only be called by scheduler".to_string());
    }

    // Early exit: no online players means no targets (PvP) and no need to process turrets
    if !ctx.db.player().iter().any(|p| p.is_online && !p.is_dead) {
        return Ok(());
    }

    // Early exit: no active turrets to process
    let has_active_turrets = ctx.db.turret().iter().any(|t| !t.is_destroyed);
    if !has_active_turrets {
        return Ok(());
    }
    
    let current_time = ctx.timestamp;
    
    // Process each active turret
    for mut turret in ctx.db.turret().iter() {
        if turret.is_destroyed {
            continue;
        }
        
        // Monument turrets have infinite ammo and different targeting
        if turret.is_monument {
            // Find target using monument-specific targeting (all animals + PvP players)
            let target = find_monument_target(ctx, &turret, current_time);
            
            match target {
                Some(TargetInfo::Animal(animal_id)) => {
                    turret.current_target_id = Some(animal_id);
                    turret.current_target_player = None;
                }
                Some(TargetInfo::Player(player_id)) => {
                    turret.current_target_id = None;
                    turret.current_target_player = Some(player_id);
                }
                None => {
                    turret.current_target_id = None;
                    turret.current_target_player = None;
                }
            }
            
            // Check fire cooldown (monument turrets fire faster)
            let can_fire = if let Some(last_fire) = turret.last_fire_time {
                let time_since_fire = current_time.to_micros_since_unix_epoch() - last_fire.to_micros_since_unix_epoch();
                time_since_fire >= (MONUMENT_TURRET_FIRE_INTERVAL_MS * 1000) as i64
            } else {
                true
            };
            
            if can_fire && (turret.current_target_id.is_some() || turret.current_target_player.is_some()) {
                // Get target position
                let (target_x, target_y) = if let Some(animal_id) = turret.current_target_id {
                    if let Some(animal) = ctx.db.wild_animal().id().find(&animal_id) {
                        (animal.pos_x, animal.pos_y)
                    } else {
                        ctx.db.turret().id().update(turret);
                        continue;
                    }
                } else if let Some(player_id) = turret.current_target_player {
                    if let Some(player) = ctx.db.player().identity().find(&player_id) {
                        (player.position_x, player.position_y)
                    } else {
                        ctx.db.turret().id().update(turret);
                        continue;
                    }
                } else {
                    ctx.db.turret().id().update(turret);
                    continue;
                };
                
                let dx = target_x - turret.pos_x;
                let dy = target_y - turret.pos_y;
                let distance = (dx * dx + dy * dy).sqrt();
                
                if distance >= 1.0 {
                    let time_to_target = distance / MONUMENT_TURRET_PROJECTILE_SPEED;
                    let velocity_x = dx / time_to_target;
                    let velocity_y = dy / time_to_target;
                    
                    // Monument turrets use a dummy def_id of 0 - no real ammo consumed
                    // Use PROJECTILE_SOURCE_MONUMENT_TURRET so damage system knows to one-shot
                    let projectile = Projectile {
                        id: 0,
                        client_shot_id: String::new(),
                        owner_id: turret.placed_by,
                        item_def_id: 0,
                        ammo_def_id: 0,
                        source_type: PROJECTILE_SOURCE_MONUMENT_TURRET,
                        npc_projectile_type: NPC_PROJECTILE_NONE,
                        start_time: current_time,
                        start_pos_x: turret.pos_x,
                        start_pos_y: turret.pos_y,
                        velocity_x,
                        velocity_y,
                        max_range: MONUMENT_TURRET_RANGE * 1.5,
                        flight_3d: false, start_height: 0.0, velocity_height: 0.0, gravity_height: 0.0,
                    };
                    
                    let inserted_projectile = ctx.db.projectile().insert(projectile);
                    ctx.db.projectile_runtime_state().insert(ProjectileRuntimeState {
                        projectile_id: inserted_projectile.id,
                        last_sample_elapsed_secs: 0.0,
                    });
                    turret.last_fire_time = Some(current_time);
                    emit_shoot_turret_sound(ctx, turret.pos_x, turret.pos_y);
                    log::info!("Monument turret {} fired at target at ({:.1}, {:.1})", turret.id, target_x, target_y);
                }
            }
            
            ctx.db.turret().id().update(turret);
            continue; // Skip normal turret processing
        }
        
        // === Normal (player-placed) turret processing ===
        
        // Skip if no ammo loaded
        if turret.ammo_instance_id.is_none() {
            turret.current_target_id = None;
            turret.current_target_player = None;
            ctx.db.turret().id().update(turret.clone());
            continue;
        }
        
        // Find target
        let target = find_target(ctx, &turret, current_time);
        
        match target {
            Some(TargetInfo::Animal(animal_id)) => {
                turret.current_target_id = Some(animal_id);
                turret.current_target_player = None;
            }
            Some(TargetInfo::Player(player_id)) => {
                turret.current_target_id = None;
                turret.current_target_player = Some(player_id);
            }
            None => {
                turret.current_target_id = None;
                turret.current_target_player = None;
            }
        }
        
        // Check if we can fire
        let can_fire = if let Some(last_fire) = turret.last_fire_time {
            let time_since_fire = current_time.to_micros_since_unix_epoch() - last_fire.to_micros_since_unix_epoch();
            time_since_fire >= (TURRET_FIRE_INTERVAL_MS * 1000) as i64
        } else {
            true // Never fired before
        };
        
        if can_fire && (turret.current_target_id.is_some() || turret.current_target_player.is_some()) {
            // Get ammo item to consume
            if let Some(ammo_instance_id) = turret.ammo_instance_id {
                if let Some(mut ammo_item) = ctx.db.inventory_item().instance_id().find(&ammo_instance_id) {
                    // Get target position
                    let (target_x, target_y) = if let Some(animal_id) = turret.current_target_id {
                        if let Some(animal) = ctx.db.wild_animal().id().find(&animal_id) {
                            (animal.pos_x, animal.pos_y)
                        } else {
                            continue; // Target disappeared
                        }
                    } else if let Some(player_id) = turret.current_target_player {
                        if let Some(player) = ctx.db.player().identity().find(&player_id) {
                            (player.position_x, player.position_y)
                        } else {
                            continue; // Target disappeared
                        }
                    } else {
                        continue; // No valid target
                    };
                    
                    // Calculate velocity toward target
                    let dx = target_x - turret.pos_x;
                    let dy = target_y - turret.pos_y;
                    let distance = (dx * dx + dy * dy).sqrt();
                    
                    if distance < 1.0 {
                        continue; // Target too close
                    }
                    
                    // Simple direct trajectory (tallow globs are slower but direct)
                    let time_to_target = distance / TALLOW_PROJECTILE_SPEED;
                    let velocity_x = dx / time_to_target;
                    let velocity_y = dy / time_to_target;
                    
                    // Get Tallow item definition ID for projectile
                    if let Some(tallow_def_id) = turret.ammo_def_id {
                        // Create projectile
                        let projectile = Projectile {
                            id: 0, // auto_inc
                            client_shot_id: String::new(),
                            owner_id: turret.placed_by,
                            item_def_id: tallow_def_id, // Tallow is both item and ammo
                            ammo_def_id: tallow_def_id,
                            source_type: PROJECTILE_SOURCE_TURRET,
                            npc_projectile_type: NPC_PROJECTILE_NONE, // Turret, not NPC
                            start_time: current_time,
                            start_pos_x: turret.pos_x,
                            start_pos_y: turret.pos_y,
                            velocity_x,
                            velocity_y,
                            max_range: TURRET_RANGE * 1.5, // Slightly longer than detection range
                            flight_3d: false, start_height: 0.0, velocity_height: 0.0, gravity_height: 0.0,
                        };
                        
                        let inserted_projectile = ctx.db.projectile().insert(projectile);
                        ctx.db.projectile_runtime_state().insert(ProjectileRuntimeState {
                            projectile_id: inserted_projectile.id,
                            last_sample_elapsed_secs: 0.0,
                        });
                        
                        // Consume 1 Tallow
                        if ammo_item.quantity > 1 {
                            ammo_item.quantity -= 1;
                            ctx.db.inventory_item().instance_id().update(ammo_item);
                        } else {
                            // Last Tallow consumed - remove item and clear turret slot
                            ctx.db.inventory_item().instance_id().delete(ammo_instance_id);
                            turret.ammo_instance_id = None;
                            turret.ammo_def_id = None;
                        }
                        
                        turret.last_fire_time = Some(current_time);
                        emit_shoot_turret_sound(ctx, turret.pos_x, turret.pos_y);
                        log::info!("Turret {} fired at target at ({:.1}, {:.1})", turret.id, target_x, target_y);
                    }
                }
            }
        }
        
        ctx.db.turret().id().update(turret);
    }
    
    Ok(())
}
