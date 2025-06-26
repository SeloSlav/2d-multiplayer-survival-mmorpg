use spacetimedb::{ReducerContext, Timestamp, Identity, Table, TimeDuration};
use log;
use crate::{
    models::TargetType,
    items::{ItemDefinition, InventoryItem},
    combat::AttackResult,
    // Import health constants from respective modules
    campfire::CAMPFIRE_MAX_HEALTH,
    wooden_storage_box::WOODEN_STORAGE_BOX_MAX_HEALTH,
    shelter::SHELTER_INITIAL_MAX_HEALTH,
    lantern::LANTERN_MAX_HEALTH,
    rain_collector::RAIN_COLLECTOR_MAX_HEALTH,
    // Import sound events for repair sounds
    sound_events,
};

// Import required table traits for SpacetimeDB access
use crate::items::{inventory_item as InventoryItemTableTrait, item_definition as ItemDefinitionTableTrait};
use crate::campfire::campfire as CampfireTableTrait;
use crate::lantern::lantern as LanternTableTrait;
use crate::wooden_storage_box::wooden_storage_box as WoodenStorageBoxTableTrait;
use crate::shelter::shelter as ShelterTableTrait;
use crate::rain_collector::rain_collector as RainCollectorTableTrait;
use crate::active_equipment::active_equipment as ActiveEquipmentTableTrait;

// Combat cooldown constants for PvP balance
const REPAIR_COMBAT_COOLDOWN_SECONDS: u64 = 300; // 5 minutes - structures can't be repaired if damaged recently

// Helper function to check if structure can be repaired (not in combat cooldown)
pub fn can_structure_be_repaired(
    last_hit_time: Option<Timestamp>, 
    last_damaged_by: Option<Identity>,
    repairer_id: Identity,
    structure_owner_id: Identity,
    current_time: Timestamp
) -> Result<(), String> {
    // If there's no damage history, allow repair
    if last_hit_time.is_none() || last_damaged_by.is_none() {
        return Ok(());
    }
    
    // Check if repairer is the structure owner
    if repairer_id != structure_owner_id {
        return Err("Only the structure owner can repair their own structures".to_string());
    }
    
    let last_damage_time = last_hit_time.unwrap();
    let damager_id = last_damaged_by.unwrap();
    
    // If the structure owner damaged their own structure, allow immediate repair
    if damager_id == structure_owner_id {
        return Ok(());
    }
    
    // If someone else damaged the structure, apply combat cooldown
    let cooldown_duration = TimeDuration::from_micros(REPAIR_COMBAT_COOLDOWN_SECONDS as i64 * 1_000_000);
    if current_time < last_damage_time + cooldown_duration {
        let remaining_seconds = ((last_damage_time + cooldown_duration).to_micros_since_unix_epoch() - current_time.to_micros_since_unix_epoch()) / 1_000_000;
        return Err(format!("Structure is in combat - cannot repair for {} more seconds", remaining_seconds));
    }
    
    Ok(())
}

// Helper function to get appropriate repair amount based on structure type
pub fn get_repair_amount_for_structure(target_type: TargetType) -> f32 {
    match target_type {
        TargetType::Campfire => 25.0,        // 4 hits to fully repair (100 / 25 = 4)
        TargetType::Lantern => 20.0,         // 4 hits to fully repair (80 / 20 = 4)
        TargetType::WoodenStorageBox => 75.0, // 10 hits to fully repair (750 / 75 = 10)
        TargetType::Shelter => 5000.0,       // 20 hits to fully repair (100,000 / 5000 = 20)
        TargetType::RainCollector => 50.0,   // 10 hits to fully repair (500 / 50 = 10)
        _ => 5.0, // Default fallback for other structures
    }
}

// Helper function to check if an item is a repair hammer
pub fn is_repair_hammer(item_def: &ItemDefinition) -> bool {
    item_def.name == "Repair Hammer"
}

// Helper function to consume repair resources from player inventory
pub fn consume_repair_resources(
    ctx: &ReducerContext,
    player_id: Identity,
    wood_needed: u32,
    stone_needed: u32,
    metal_needed: u32,
) -> Result<(), String> {
    let inventory_items = ctx.db.inventory_item();
    let item_defs = ctx.db.item_definition();
    
    // Find wood, stone, and metal item definition IDs
    let wood_def_id = item_defs.iter()
        .find(|def| def.name == "Wood")
        .map(|def| def.id)
        .ok_or("Wood item definition not found")?;
    
    let stone_def_id = item_defs.iter()
        .find(|def| def.name == "Stone")
        .map(|def| def.id)
        .ok_or("Stone item definition not found")?;
    
    let metal_def_id = item_defs.iter()
        .find(|def| def.name == "Metal Fragments")
        .map(|def| def.id)
        .ok_or("Metal Fragments item definition not found")?;
    
    // Check if player has enough resources
    let mut wood_available = 0u32;
    let mut stone_available = 0u32;
    let mut metal_available = 0u32;
    
    for item in inventory_items.iter() {
        if let Some(owner_id) = item.location.is_player_bound() {
            if owner_id == player_id {
                if item.item_def_id == wood_def_id {
                    wood_available += item.quantity;
                } else if item.item_def_id == stone_def_id {
                    stone_available += item.quantity;
                } else if item.item_def_id == metal_def_id {
                    metal_available += item.quantity;
                }
            }
        }
    }
    
    if wood_needed > 0 && wood_available < wood_needed {
        return Err(format!("Not enough wood for repair. Need {}, have {}", wood_needed, wood_available));
    }
    
    if stone_needed > 0 && stone_available < stone_needed {
        return Err(format!("Not enough stone for repair. Need {}, have {}", stone_needed, stone_available));
    }
    
    if metal_needed > 0 && metal_available < metal_needed {
        return Err(format!("Not enough metal fragments for repair. Need {}, have {}", metal_needed, metal_available));
    }
    
    // Consume wood if needed
    if wood_needed > 0 {
        consume_resource_from_inventory(ctx, player_id, wood_def_id, wood_needed)?;
    }
    
    // Consume stone if needed
    if stone_needed > 0 {
        consume_resource_from_inventory(ctx, player_id, stone_def_id, stone_needed)?;
    }
    
    // Consume metal if needed
    if metal_needed > 0 {
        consume_resource_from_inventory(ctx, player_id, metal_def_id, metal_needed)?;
    }
    
    Ok(())
}

// Helper function to consume a specific resource from player inventory
fn consume_resource_from_inventory(
    ctx: &ReducerContext,
    player_id: Identity,
    resource_def_id: u64,
    amount_needed: u32,
) -> Result<(), String> {
    let inventory_items = ctx.db.inventory_item();
    let mut remaining_to_consume = amount_needed;
    let mut items_to_update = Vec::new();
    let mut items_to_delete = Vec::new();
    
    for mut item in inventory_items.iter() {
        if remaining_to_consume == 0 { break; }
        
        if let Some(owner_id) = item.location.is_player_bound() {
            if owner_id == player_id && item.item_def_id == resource_def_id {
                if item.quantity <= remaining_to_consume {
                    remaining_to_consume -= item.quantity;
                    items_to_delete.push(item.instance_id);
                } else {
                    item.quantity -= remaining_to_consume;
                    remaining_to_consume = 0;
                    items_to_update.push(item.clone());
                }
            }
        }
    }
    
    for item in items_to_update {
        inventory_items.instance_id().update(item);
    }
    for item_id in items_to_delete {
        inventory_items.instance_id().delete(item_id);
    }
    
    Ok(())
}

// Helper function to calculate repair resource requirements based on structure type and repair amount
pub fn calculate_repair_resources(target_type: TargetType, repair_amount: f32, max_health: f32) -> (u32, u32, u32) {
    let repair_fraction = repair_amount / max_health;
    
    match target_type {
        TargetType::Campfire => {
            // Campfire costs: 25 Wood, 10 Stone, 0 Metal
            let wood_needed = (25.0 * repair_fraction).ceil() as u32;
            let stone_needed = (10.0 * repair_fraction).ceil() as u32;
            (wood_needed, stone_needed, 0)
        },
        TargetType::Lantern => {
            // Lantern costs: 75 Wood, 0 Stone, 15 Metal (matches crafting cost)
            let wood_needed = (75.0 * repair_fraction).ceil() as u32;
            let metal_needed = (15.0 * repair_fraction).ceil() as u32;
            (wood_needed, 0, metal_needed)
        },
        TargetType::WoodenStorageBox => {
            // Wooden Storage Box costs: 100 Wood, 0 Stone, 0 Metal
            let wood_needed = (100.0 * repair_fraction).ceil() as u32;
            (wood_needed, 0, 0)
        },
        TargetType::Shelter => {
            // Shelter costs: 3200 Wood, 0 Stone, 0 Metal (simplified - ignoring rope requirement)
            let wood_needed = (3200.0 * repair_fraction).ceil() as u32;
            (wood_needed, 0, 0)
        },
        TargetType::RainCollector => {
            // Rain Collector costs: 50 Wood, 10 Stone, 0 Metal (reed-based structure needs some wood and stone)
            let wood_needed = (50.0 * repair_fraction).ceil() as u32;
            let stone_needed = (10.0 * repair_fraction).ceil() as u32;
            (wood_needed, stone_needed, 0)
        },
        _ => (0, 0, 0), // Other structures don't support repair
    }
}

// Repair functions for different structure types

pub fn repair_campfire(
    ctx: &ReducerContext,
    repairer_id: Identity,
    campfire_id: u32,
    _weapon_damage: f32, // Ignore weapon damage, use proper repair amount
    timestamp: Timestamp,
) -> Result<AttackResult, String> {
    let mut campfires_table = ctx.db.campfire();
    let mut campfire = campfires_table.id().find(campfire_id)
        .ok_or_else(|| format!("Target campfire {} not found", campfire_id))?;

    if campfire.is_destroyed {
        return Err("Cannot repair destroyed campfire".to_string());
    }

    // Check combat cooldown for PvP balance
    match can_structure_be_repaired(campfire.last_hit_time, campfire.last_damaged_by, repairer_id, campfire.placed_by, timestamp) {
        Ok(()) => {},
        Err(e) => {
            // 🔧 Emit repair fail sound for cooldown/permission errors
            sound_events::emit_repair_fail_sound(ctx, campfire.pos_x, campfire.pos_y, repairer_id);
            return Err(e);
        }
    }

    // Use proper repair amount for campfires
    let repair_amount = get_repair_amount_for_structure(TargetType::Campfire);
    let campfire_max_health = campfire.max_health;
    let (wood_needed, stone_needed, metal_needed) = calculate_repair_resources(TargetType::Campfire, repair_amount, campfire_max_health);
    
    // Try to consume resources
    match consume_repair_resources(ctx, repairer_id, wood_needed, stone_needed, metal_needed) {
        Ok(()) => {
            // 🔧 Emit successful repair sound
            sound_events::emit_repair_sound(ctx, campfire.pos_x, campfire.pos_y, repairer_id);
        }
        Err(e) => {
            // 🔧 Emit repair fail sound for resource shortage
            sound_events::emit_repair_fail_sound(ctx, campfire.pos_x, campfire.pos_y, repairer_id);
            return Err(e);
        }
    }
    
    let old_health = campfire.health;
    campfire.health = (campfire.health + repair_amount).min(campfire_max_health);
    campfire.last_hit_time = Some(timestamp);
    campfire.last_damaged_by = Some(repairer_id);
    
    // Save new health before update
    let new_health = campfire.health;

    campfires_table.id().update(campfire);

    log::info!(
        "Player {:?} repaired Campfire {} for {:.1} health using {} wood, {} stone, {} metal. Health: {:.1} -> {:.1} (Max: {:.1})",
        repairer_id, campfire_id, repair_amount, wood_needed, stone_needed, metal_needed, old_health, new_health, campfire_max_health
    );

    Ok(AttackResult {
        hit: true,
        target_type: Some(TargetType::Campfire),
        resource_granted: None,
    })
}

pub fn repair_wooden_storage_box(
    ctx: &ReducerContext,
    repairer_id: Identity,
    box_id: u32,
    _weapon_damage: f32, // Ignore weapon damage, use proper repair amount
    timestamp: Timestamp,
) -> Result<AttackResult, String> {
    let mut boxes_table = ctx.db.wooden_storage_box();
    let mut wooden_box = boxes_table.id().find(box_id)
        .ok_or_else(|| format!("Target wooden storage box {} not found", box_id))?;

    if wooden_box.is_destroyed {
        return Err("Cannot repair destroyed wooden storage box".to_string());
    }

    // Check combat cooldown for PvP balance
    match can_structure_be_repaired(wooden_box.last_hit_time, wooden_box.last_damaged_by, repairer_id, wooden_box.placed_by, timestamp) {
        Ok(()) => {},
        Err(e) => {
            // 🔧 Emit repair fail sound for cooldown/permission errors
            sound_events::emit_repair_fail_sound(ctx, wooden_box.pos_x, wooden_box.pos_y, repairer_id);
            return Err(e);
        }
    }

    // Use proper repair amount for wooden storage boxes
    let repair_amount = get_repair_amount_for_structure(TargetType::WoodenStorageBox);
    let box_max_health = wooden_box.max_health;
    let (wood_needed, stone_needed, metal_needed) = calculate_repair_resources(TargetType::WoodenStorageBox, repair_amount, box_max_health);
    
    // Try to consume resources
    match consume_repair_resources(ctx, repairer_id, wood_needed, stone_needed, metal_needed) {
        Ok(()) => {
            // 🔧 Emit successful repair sound
            sound_events::emit_repair_sound(ctx, wooden_box.pos_x, wooden_box.pos_y, repairer_id);
        }
        Err(e) => {
            // 🔧 Emit repair fail sound for resource shortage
            sound_events::emit_repair_fail_sound(ctx, wooden_box.pos_x, wooden_box.pos_y, repairer_id);
            return Err(e);
        }
    }
    
    let old_health = wooden_box.health;
    wooden_box.health = (wooden_box.health + repair_amount).min(box_max_health);
    wooden_box.last_hit_time = Some(timestamp);
    wooden_box.last_damaged_by = Some(repairer_id);
    
    // Save new health before update
    let new_health = wooden_box.health;

    boxes_table.id().update(wooden_box);

    log::info!(
        "Player {:?} repaired WoodenStorageBox {} for {:.1} health using {} wood, {} stone, {} metal. Health: {:.1} -> {:.1} (Max: {:.1})",
        repairer_id, box_id, repair_amount, wood_needed, stone_needed, metal_needed, old_health, new_health, box_max_health
    );

    Ok(AttackResult {
        hit: true,
        target_type: Some(TargetType::WoodenStorageBox),
        resource_granted: None,
    })
}

pub fn repair_shelter(
    ctx: &ReducerContext,
    repairer_id: Identity,
    shelter_id: u32,
    _weapon_damage: f32, // Ignore weapon damage, use proper repair amount
    timestamp: Timestamp,
) -> Result<AttackResult, String> {
    let mut shelters_table = ctx.db.shelter();
    let mut shelter = shelters_table.id().find(shelter_id)
        .ok_or_else(|| format!("Target shelter {} not found", shelter_id))?;

    if shelter.is_destroyed {
        return Err("Cannot repair destroyed shelter".to_string());
    }

    // Check combat cooldown for PvP balance
    match can_structure_be_repaired(shelter.last_hit_time, shelter.last_damaged_by, repairer_id, shelter.placed_by, timestamp) {
        Ok(()) => {},
        Err(e) => {
            // 🔧 Emit repair fail sound for cooldown/permission errors
            sound_events::emit_repair_fail_sound(ctx, shelter.pos_x, shelter.pos_y, repairer_id);
            return Err(e);
        }
    }

    // Use proper repair amount for shelters
    let repair_amount = get_repair_amount_for_structure(TargetType::Shelter);
    let shelter_max_health = shelter.max_health;
    let (wood_needed, stone_needed, metal_needed) = calculate_repair_resources(TargetType::Shelter, repair_amount, shelter_max_health);
    
    // Try to consume resources
    match consume_repair_resources(ctx, repairer_id, wood_needed, stone_needed, metal_needed) {
        Ok(()) => {
            // 🔧 Emit successful repair sound
            sound_events::emit_repair_sound(ctx, shelter.pos_x, shelter.pos_y, repairer_id);
        }
        Err(e) => {
            // 🔧 Emit repair fail sound for resource shortage
            sound_events::emit_repair_fail_sound(ctx, shelter.pos_x, shelter.pos_y, repairer_id);
            return Err(e);
        }
    }
    
    let old_health = shelter.health;
    shelter.health = (shelter.health + repair_amount).min(shelter_max_health);
    shelter.last_hit_time = Some(timestamp);
    shelter.last_damaged_by = Some(repairer_id);
    
    // Save new health before update
    let new_health = shelter.health;

    shelters_table.id().update(shelter);

    log::info!(
        "Player {:?} repaired Shelter {} for {:.1} health using {} wood, {} stone, {} metal. Health: {:.1} -> {:.1} (Max: {:.1})",
        repairer_id, shelter_id, repair_amount, wood_needed, stone_needed, metal_needed, old_health, new_health, shelter_max_health
    );

    Ok(AttackResult {
        hit: true,
        target_type: Some(TargetType::Shelter),
        resource_granted: None,
    })
}

pub fn repair_lantern(
    ctx: &ReducerContext,
    repairer_id: Identity,
    lantern_id: u32,
    _weapon_damage: f32, // Ignore weapon damage, use proper repair amount
    timestamp: Timestamp,
) -> Result<AttackResult, String> {
    let mut lanterns_table = ctx.db.lantern();
    let mut lantern = lanterns_table.id().find(lantern_id)
        .ok_or_else(|| format!("Target lantern {} not found", lantern_id))?;

    if lantern.is_destroyed {
        return Err("Cannot repair destroyed lantern".to_string());
    }

    // Check combat cooldown for PvP balance
    match can_structure_be_repaired(lantern.last_hit_time, lantern.last_damaged_by, repairer_id, lantern.placed_by, timestamp) {
        Ok(()) => {},
        Err(e) => {
            // 🔧 Emit repair fail sound for cooldown/permission errors
            sound_events::emit_repair_fail_sound(ctx, lantern.pos_x, lantern.pos_y, repairer_id);
            return Err(e);
        }
    }

    // Use proper repair amount for lanterns
    let repair_amount = get_repair_amount_for_structure(TargetType::Lantern);
    let lantern_max_health = LANTERN_MAX_HEALTH;
    let (wood_needed, stone_needed, metal_needed) = calculate_repair_resources(TargetType::Lantern, repair_amount, lantern_max_health);
    
    // Try to consume resources
    match consume_repair_resources(ctx, repairer_id, wood_needed, stone_needed, metal_needed) {
        Ok(()) => {
            // 🔧 Emit successful repair sound
            sound_events::emit_repair_sound(ctx, lantern.pos_x, lantern.pos_y, repairer_id);
        }
        Err(e) => {
            // 🔧 Emit repair fail sound for resource shortage
            sound_events::emit_repair_fail_sound(ctx, lantern.pos_x, lantern.pos_y, repairer_id);
            return Err(e);
        }
    }
    
    let old_health = lantern.health;
    lantern.health = (lantern.health + repair_amount).min(lantern_max_health);
    lantern.last_hit_time = Some(timestamp);
    lantern.last_damaged_by = Some(repairer_id);
    
    // Save new health before update
    let new_health = lantern.health;

    lanterns_table.id().update(lantern);

    log::info!(
        "Player {:?} repaired Lantern {} for {:.1} health using {} wood, {} stone, {} metal. Health: {:.1} -> {:.1} (Max: {:.1})",
        repairer_id, lantern_id, repair_amount, wood_needed, stone_needed, metal_needed, old_health, new_health, lantern_max_health
    );

    Ok(AttackResult {
        hit: true,
        target_type: Some(TargetType::Lantern),
        resource_granted: None,
    })
}

pub fn repair_rain_collector(
    ctx: &ReducerContext,
    repairer_id: Identity,
    rain_collector_id: u32,
    _weapon_damage: f32, // Ignore weapon damage, use proper repair amount
    timestamp: Timestamp,
) -> Result<AttackResult, String> {
    let mut rain_collectors_table = ctx.db.rain_collector();
    let mut rain_collector = rain_collectors_table.id().find(&rain_collector_id)
        .ok_or_else(|| format!("Target rain collector {} not found", rain_collector_id))?;

    if rain_collector.is_destroyed {
        return Err("Cannot repair destroyed rain collector".to_string());
    }

    // Check combat cooldown for PvP balance
    match can_structure_be_repaired(rain_collector.last_hit_time, rain_collector.last_damaged_by, repairer_id, rain_collector.placed_by, timestamp) {
        Ok(()) => {},
        Err(e) => {
            // 🔧 Emit repair fail sound for cooldown/permission errors
            sound_events::emit_repair_fail_sound(ctx, rain_collector.pos_x, rain_collector.pos_y, repairer_id);
            return Err(e);
        }
    }

    // Use proper repair amount for rain collectors
    let repair_amount = get_repair_amount_for_structure(TargetType::RainCollector);
    let rain_collector_max_health = rain_collector.max_health;
    let (wood_needed, stone_needed, metal_needed) = calculate_repair_resources(TargetType::RainCollector, repair_amount, rain_collector_max_health);
    
    // Try to consume resources
    match consume_repair_resources(ctx, repairer_id, wood_needed, stone_needed, metal_needed) {
        Ok(()) => {
            // 🔧 Emit successful repair sound
            sound_events::emit_repair_sound(ctx, rain_collector.pos_x, rain_collector.pos_y, repairer_id);
        }
        Err(e) => {
            // 🔧 Emit repair fail sound for resource shortage
            sound_events::emit_repair_fail_sound(ctx, rain_collector.pos_x, rain_collector.pos_y, repairer_id);
            return Err(e);
        }
    }
    
    let old_health = rain_collector.health;
    rain_collector.health = (rain_collector.health + repair_amount).min(rain_collector_max_health);
    rain_collector.last_hit_time = Some(timestamp);
    rain_collector.last_damaged_by = Some(repairer_id);
    
    // Save new health before update
    let new_health = rain_collector.health;

    rain_collectors_table.id().update(rain_collector);

    log::info!(
        "Player {:?} repaired RainCollector {} for {:.1} health using {} wood, {} stone, {} metal. Health: {:.1} -> {:.1} (Max: {:.1})",
        repairer_id, rain_collector_id, repair_amount, wood_needed, stone_needed, metal_needed, old_health, new_health, rain_collector_max_health
    );

    Ok(AttackResult {
        hit: true,
        target_type: Some(TargetType::RainCollector),
        resource_granted: None,
    })
}