/******************************************************************************
 *                                                                            *
 * Defines player equipment system including loadout management, tool usage,  *
 * armor equipping, and weapon-based combat interactions. Handles equipment   *
 * slots, item switching, swinging mechanics, and damage application using    *
 * the combat system. Maintains both hotbar items and armor slots.            *
 *                                                                            *
 ******************************************************************************/

// Standard library imports
use std::f32::consts::PI;
use std::time::Duration;

// SpacetimeDB imports
use spacetimedb::{Identity, ReducerContext, Table, Timestamp};
use log;
use rand::{Rng, SeedableRng};

// Combat system imports
use crate::combat::{RESPAWN_TIME_MS};
use crate::combat::{
    find_targets_in_cone, find_best_target, process_attack, TargetId
};
// Tilled tiles system import
use crate::tilled_tiles;

// Consumable and active effects imports
use crate::consumables::MAX_HEALTH_VALUE;
use crate::consumables::apply_item_effects_and_consume;
use crate::active_effects::{ActiveConsumableEffect, EffectType, cancel_bleed_effects, cancel_health_regen_effects, active_consumable_effect as ActiveConsumableEffectTableTrait, cancel_bandage_burst_effects};
use crate::shared_config::{
    DEFAULT_MELEE_ARC_DEGREES,
    DEFAULT_MELEE_RANGE_MULTIPLIER,
    REMOTE_HEALING_RANGE_PX,
    SCYTHE_MELEE_ARC_DEGREES,
    SCYTHE_MELEE_RANGE_MULTIPLIER,
    SPEAR_MELEE_ARC_DEGREES,
    SPEAR_MELEE_RANGE_MULTIPLIER,
};

// Collision constants
use crate::tree::{TREE_COLLISION_Y_OFFSET, PLAYER_TREE_COLLISION_DISTANCE_SQUARED};
use crate::stone::{STONE_COLLISION_Y_OFFSET, PLAYER_STONE_COLLISION_DISTANCE_SQUARED};

// Core game types
use crate::Player;
use crate::PLAYER_RADIUS;
use crate::items::{InventoryItem, ItemDefinition, ItemCategory};

// Table trait imports for database access
// use crate::tree::tree as TreeTableTrait; // Assuming not used, or handle similarly if error appears
// use crate::stone::stone as StoneTableTrait; // Assuming not used, or handle similarly if error appears
use crate::items::item_definition as ItemDefinitionTableTrait;
use crate::items::inventory_item as InventoryItemTableTrait;
// REMOVE: use crate::player::player as PlayerTableTrait; // This was likely the source of E0658 and confusion for E0599
// Correct way to allow `ctx.db.player()` is usually by having the table struct in scope
// or ensuring the module `crate::player` itself provides the necessary accessors via generated code.
// No explicit `PlayerTableTrait` import is typically needed for `ctx.db.player()` if `Player` table is defined.
use crate::active_equipment as ActiveEquipmentTableTrait;
use crate::player; // Added to bring Player table accessors into scope
use crate::PlayerLastAttackTimestamp; // Import the new table
use crate::player_last_attack_timestamp as PlayerLastAttackTimestampTableTrait; // Import the trait for the new table
use crate::ranged_weapon_stats::ranged_weapon_stats as RangedWeaponStatsTableTrait; // For magazine capacity lookup

// Models imports
use crate::models::{ItemLocation, EquipmentSlotType};

// Player inventory imports
use crate::player_inventory::find_first_empty_player_slot;

// --- Weapon Ammo Persistence ---
// Struct to serialize/deserialize loaded ammo state to/from item_data JSON
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
struct WeaponAmmoData {
    loaded_ammo_def_id: u64,
    loaded_ammo_count: u8,
}

/// Saves the current weapon's loaded ammo state to its item_data field
fn save_weapon_ammo_to_item(ctx: &ReducerContext, item_instance_id: u64, ammo_def_id: Option<u64>, ammo_count: u8) {
    if ammo_count == 0 || ammo_def_id.is_none() {
        // No ammo to save - clear any existing ammo data
        if let Some(mut item) = ctx.db.inventory_item().instance_id().find(item_instance_id) {
            // Only clear if there was weapon ammo data before
            if item.item_data.as_ref().map_or(false, |d| d.contains("loaded_ammo")) {
                item.item_data = None;
                ctx.db.inventory_item().instance_id().update(item);
                log::info!("[WeaponAmmo] Cleared ammo data from weapon instance {}", item_instance_id);
            }
        }
        return;
    }
    
    let ammo_data = WeaponAmmoData {
        loaded_ammo_def_id: ammo_def_id.unwrap(),
        loaded_ammo_count: ammo_count,
    };
    
    if let Some(mut item) = ctx.db.inventory_item().instance_id().find(item_instance_id) {
        match serde_json::to_string(&ammo_data) {
            Ok(json) => {
                item.item_data = Some(json);
                ctx.db.inventory_item().instance_id().update(item);
                log::info!("[WeaponAmmo] Saved {} rounds (ammo_def_id: {}) to weapon instance {}", 
                    ammo_count, ammo_def_id.unwrap(), item_instance_id);
            }
            Err(e) => {
                log::error!("[WeaponAmmo] Failed to serialize ammo data: {}", e);
            }
        }
    }
}

/// Loads weapon ammo state from an item's item_data field
fn load_weapon_ammo_from_item(item: &InventoryItem) -> Option<WeaponAmmoData> {
    item.item_data.as_ref().and_then(|data| {
        serde_json::from_str::<WeaponAmmoData>(data).ok()
    })
}

// Sound events imports
use crate::sound_events;

// Weather imports for rain detection
use crate::world_state::{get_weather_for_position, WeatherType};

// --- Interaction Constants ---
/// Maximum distance for player-item interactions
const PLAYER_INTERACT_DISTANCE: f32 = 80.0;
/// Squared interaction distance for faster distance checks
const PLAYER_INTERACT_DISTANCE_SQUARED: f32 = PLAYER_INTERACT_DISTANCE * PLAYER_INTERACT_DISTANCE;

/// Represents a player's equipped items, both in hand and armor slots
#[spacetimedb::table(accessor = active_equipment, public)]
#[derive(Clone, Default, Debug)]
pub struct ActiveEquipment {
    #[primary_key]
    pub player_identity: Identity,
    pub equipped_item_def_id: Option<u64>, // ID from ItemDefinition table
    pub equipped_item_instance_id: Option<u64>, // Instance ID from InventoryItem
    pub icon_asset_name: Option<String>, // Icon to display for equipped item
    pub swing_start_time_ms: u64, // Timestamp (ms) when the current swing started, 0 if not swinging
    // Ranged weapon ammunition tracking
    pub loaded_ammo_def_id: Option<u64>, // ID of loaded ammunition (e.g., arrow)
    pub loaded_ammo_count: u8, // How many rounds are currently loaded in the magazine (0-255)
    pub is_ready_to_fire: bool, // Whether the ranged weapon is loaded and ready
    pub preferred_arrow_type: Option<String>, // Player's preferred arrow type for cycling (e.g., "Wooden Arrow")
    pub reload_start_time_ms: u64, // Timestamp (ms) when reload started, 0 if not reloading
    // Fields for worn armor
    pub head_item_instance_id: Option<u64>,
    pub chest_item_instance_id: Option<u64>,
    pub legs_item_instance_id: Option<u64>,
    pub feet_item_instance_id: Option<u64>,
    pub hands_item_instance_id: Option<u64>,
    pub back_item_instance_id: Option<u64>,
}

/// Schedule table for filling equipped water containers during rain
#[spacetimedb::table(accessor = water_container_fill_schedule, scheduled(fill_equipped_water_containers))]
#[derive(Clone, Debug)]
pub struct WaterContainerFillSchedule {
    #[primary_key]
    #[auto_inc]
    pub schedule_id: u64,
    pub scheduled_at: spacetimedb::ScheduleAt,
}

/// Initializes the water container fill schedule
/// Runs every 2 seconds to check for equipped water containers during rain
pub fn init_water_container_fill_schedule(ctx: &ReducerContext) -> Result<(), String> {
    use spacetimedb::spacetimedb_lib::ScheduleAt;
    use spacetimedb::TimeDuration;
    
    let schedule_table = ctx.db.water_container_fill_schedule();
    
    // Check if schedule already exists
    if schedule_table.iter().count() > 0 {
        log::debug!("Water container fill schedule already initialized.");
        return Ok(());
    }
    
    log::info!("Initializing water container fill schedule (runs every 2 seconds)...");
    
    // Create schedule that runs every 2 seconds
    let interval = TimeDuration::from_micros(2_000_000); // 2 seconds
    let schedule = WaterContainerFillSchedule {
        schedule_id: 0, // Auto-increment
        scheduled_at: ScheduleAt::Interval(interval),
    };
    
    crate::try_insert_schedule!(
        schedule_table,
        schedule.clone(),
        "Water container fill"
    );
    
    Ok(())
}

/// Sets an item from inventory/hotbar as the player's "active" item (e.g., tool or weapon in hand).
/// This does NOT change the item's actual ItemLocation, only updates the ActiveEquipment table
/// to reflect which item is currently wielded/active.
#[spacetimedb::reducer]
pub fn set_active_item_reducer(ctx: &ReducerContext, item_instance_id: u64) -> Result<(), String> {
    let sender_id = ctx.sender();
    let inventory_items = ctx.db.inventory_item();
    let item_defs = ctx.db.item_definition();
    let active_equipments = ctx.db.active_equipment();
    let mut players_table = ctx.db.player(); // Get a mutable reference for player updates

    // --- Check player state first ---
    let player = players_table.identity().find(&sender_id)
        .ok_or_else(|| "Player not found.".to_string())?;
    
    if player.is_dead {
        return Err("Cannot equip items while dead.".to_string());
    }
    if player.is_knocked_out {
        return Err("Cannot equip items while knocked out.".to_string());
    }

    // Cancel any ongoing BandageBurst effect before equipping a new item or re-equipping.
    cancel_bandage_burst_effects(ctx, sender_id);

    let item_to_make_active = inventory_items.instance_id().find(item_instance_id)
        .ok_or_else(|| format!("Inventory item with instance ID {} not found.", item_instance_id))?;

    // Additional validation: ensure the item hasn't been consumed (quantity > 0)
    if item_to_make_active.quantity == 0 {
        return Err(format!("Cannot set item {} as active: it has been consumed (quantity is 0).", item_instance_id));
    }

    let item_def = item_defs.id().find(item_to_make_active.item_def_id)
        .ok_or_else(|| format!("Item definition {} not found for item instance {}.", item_to_make_active.item_def_id, item_instance_id))?;

    // --- Validate Item Location & Ownership ---
    // Item must be in player's inventory or hotbar to be made active.
    match &item_to_make_active.location {
        ItemLocation::Inventory(_) |
        ItemLocation::Hotbar(_) => {
            // Item is in inventory or hotbar - allow activation regardless of original owner_id
            // since if it's in the player's slots, they should be able to activate it
            if item_def.category == ItemCategory::Tool ||
               item_def.category == ItemCategory::Weapon ||
               item_def.category == ItemCategory::RangedWeapon { // Assuming RangedWeapon is a variant of ItemCategory
                // Valid location and type for activation
            } else {
                return Err(format!("Item '{}' (category {:?}) is not a Tool, Weapon, or Ranged Weapon and cannot be activated in hand.", item_def.name, item_def.category));
            }
        }
        ItemLocation::Equipped(data) => {
             return Err(format!("Cannot set item {} as active: it is currently equipped as armor in slot {:?}.", item_instance_id, data.slot_type));
        }
        ItemLocation::Container(_) => return Err("Cannot set an item from a container as active.".to_string()),
        ItemLocation::Dropped(_) => return Err("Cannot set a dropped item as active.".to_string()),
        ItemLocation::Unknown => return Err("Cannot set an item with an unknown location as active.".to_string()),
        // Catch-all for any other unhandled or future locations
        _ => {
            return Err(format!(
                "Item '{}' has an unsupported location ({:?}) for activation.",
                item_def.name, item_to_make_active.location
            ));
        }
    }

    // --- Item Definition Validations (moved after location check) ---
    // let item_def = item_defs.id().find(item_to_make_active.item_def_id) // Already fetched above
    //     .ok_or_else(|| format!("Item definition {} not found for item instance {}.", item_to_make_active.item_def_id, item_instance_id))?;

    if !item_def.is_equippable {
        return Err(format!("Item '{}' (Instance ID: {}) is not a usable tool or weapon and cannot be set as active.", item_def.name, item_instance_id));
    }
    if item_def.category == ItemCategory::Armor {
        return Err(format!("Armor item '{}' (Instance ID: {}) cannot be set as active. Use equip_armor.", item_def.name, item_instance_id));
    }
    
    // --- Check if item is broken (durability depleted) ---
    if crate::durability::has_durability_system(&item_def) && crate::durability::is_item_broken(&item_to_make_active) {
        log::warn!("[SetActiveItem] Player {:?} tried to equip broken item {} (Instance: {})", 
            sender_id, item_def.name, item_instance_id);
        return Err(format!("Cannot equip '{}' - it is broken and needs to be repaired.", item_def.name));
    }

    let mut equipment = get_or_create_active_equipment(ctx, sender_id)?;

    if equipment.equipped_item_instance_id == Some(item_instance_id) {
        // log::debug!("Item {} is already the active item for player {:?}. No change to ActiveEquipment needed.", item_instance_id, sender_id);
        return Ok(());
    }

    if player.is_aiming_throw {
        let mut player = player;
        player.is_aiming_throw = false;
        players_table.identity().update(player);
    }
    
    // --- SAVE OLD WEAPON'S AMMO STATE ---
    // Before switching, save the current weapon's loaded ammo to its item_data
    if let Some(old_active_id) = equipment.equipped_item_instance_id {
        if old_active_id != item_instance_id && equipment.loaded_ammo_count > 0 {
            save_weapon_ammo_to_item(ctx, old_active_id, equipment.loaded_ammo_def_id, equipment.loaded_ammo_count);
        }
    }

    equipment.equipped_item_def_id = Some(item_def.id);
    equipment.equipped_item_instance_id = Some(item_instance_id);
    equipment.swing_start_time_ms = 0;
    equipment.icon_asset_name = Some(item_def.icon_asset_name.clone());
    
    // --- LOAD NEW WEAPON'S AMMO STATE ---
    // Grenade and Flare are self-ammo RangedWeapons: the item itself is the projectile. Auto-load when equipped.
    if item_def.name == "Grenade" || item_def.name == "Flare" {
        equipment.loaded_ammo_def_id = Some(item_def.id);
        equipment.loaded_ammo_count = 1;
        equipment.is_ready_to_fire = true;
        log::info!("[SetActiveItem] Auto-loaded {} (self-ammo) for player {:?}", item_def.name, sender_id);
    } else if let Some(ammo_data) = load_weapon_ammo_from_item(&item_to_make_active) {
        // Restore the loaded ammo state from the weapon's item_data
        equipment.loaded_ammo_def_id = Some(ammo_data.loaded_ammo_def_id);
        equipment.loaded_ammo_count = ammo_data.loaded_ammo_count;
        equipment.is_ready_to_fire = ammo_data.loaded_ammo_count > 0;
        log::info!("[SetActiveItem] Restored {} rounds (ammo_def_id: {}) from weapon instance {}", 
            ammo_data.loaded_ammo_count, ammo_data.loaded_ammo_def_id, item_instance_id);
    } else {
        // New or never-loaded weapon - start unloaded
        equipment.loaded_ammo_def_id = None;
        equipment.loaded_ammo_count = 0;
        equipment.is_ready_to_fire = false;
    }

    // --- Handle Torch Specific State on Equip ---
    if item_def.name == "Torch" {
        equipment.icon_asset_name = Some("torch.png".to_string()); // Default to off
        if let Some(mut player) = players_table.identity().find(&sender_id) {
            // Ensure torch starts off, even if it was somehow lit with a previous torch
            if player.is_torch_lit { 
                player.is_torch_lit = false;
                player.last_update = ctx.timestamp; // Update timestamp
                players_table.identity().update(player);
            }
        }
    } else if item_def.name == "Flashlight" {
        equipment.icon_asset_name = Some("flashlight.png".to_string()); // Default to off
        if let Some(mut player) = players_table.identity().find(&sender_id) {
            // Ensure flashlight starts off, even if it was somehow on with a previous flashlight
            if player.is_flashlight_on { 
                player.is_flashlight_on = false;
                player.last_update = ctx.timestamp; // Update timestamp
                players_table.identity().update(player);
            }
        }
    } else {
        equipment.icon_asset_name = Some(item_def.icon_asset_name.clone());
        // If equipping something else and a torch was lit, flashlight was on, or snorkeling, turn them off
        if let Some(mut player) = players_table.identity().find(&sender_id) {
            let mut needs_update = false;
            if player.is_torch_lit {
                player.is_torch_lit = false;
                needs_update = true;
            }
            // If equipping something else and a flashlight was on, turn it off
            if player.is_flashlight_on {
                player.is_flashlight_on = false;
                needs_update = true;
            }
            // If equipping something else and snorkeling, emerge from water
            // EXCEPTION: Underwater-capable items can be used while snorkeling
            let is_underwater_capable = matches!(item_def.name.as_str(), 
                "Reed Harpoon" | "Reed Harpoon Gun" | "Diving Pick" | "Seaweed Frond" | "Tidebreaker Blade"
            );
            if player.is_snorkeling && !is_underwater_capable {
                player.is_snorkeling = false;
                crate::sound_events::emit_snorkel_emerge_sound(ctx, player.position_x, player.position_y, sender_id);
                needs_update = true;
            }
            if needs_update {
                player.last_update = ctx.timestamp; // Update timestamp
                players_table.identity().update(player);
            }
        }
    }
    // --- End Handle Torch Specific State ---

    active_equipments.player_identity().update(equipment.clone());

    // log::info!("Player {:?} set active item to: {} (Instance ID: {}). Item remains in location: {:?}",
    //     sender_id, item_def.name, item_instance_id, item_to_make_active.location);

    Ok(())
}

/// Clears the player's currently "active" item (e.g., tool or weapon in hand).
/// This does NOT change the item's actual ItemLocation, only clears the ActiveEquipment table fields.
#[spacetimedb::reducer]
pub fn clear_active_item_reducer(ctx: &ReducerContext, player_identity: Identity) -> Result<(), String> {
    let active_equipments = ctx.db.active_equipment();
    let mut players_table = ctx.db.player(); // For updating player state

    // Cancel any ongoing BandageBurst effect when clearing the active item.
    cancel_bandage_burst_effects(ctx, player_identity);

    if let Some(mut equipment) = active_equipments.player_identity().find(player_identity) {
        // Store old item def ID before clearing for torch check
        let old_item_def_id_opt = equipment.equipped_item_def_id;

        if let Some(item_instance_id) = equipment.equipped_item_instance_id {
            // log::info!("Player {:?} cleared active item (was instance ID: {:?}, def ID: {:?}).", 
            //          player_identity, equipment.equipped_item_instance_id, equipment.equipped_item_def_id);
            
            // --- SAVE LOADED AMMO TO WEAPON'S ITEM_DATA ---
            // If weapon has loaded ammo, persist it to the weapon so it stays loaded
            if equipment.loaded_ammo_count > 0 {
                save_weapon_ammo_to_item(ctx, item_instance_id, equipment.loaded_ammo_def_id, equipment.loaded_ammo_count);
            }
            // --- END SAVE LOADED AMMO ---
            
            equipment.equipped_item_def_id = None;
            equipment.equipped_item_instance_id = None;
            equipment.swing_start_time_ms = 0;
            equipment.icon_asset_name = None; // <<< CLEAR icon name
            equipment.loaded_ammo_def_id = None;
            equipment.loaded_ammo_count = 0; // Clear from ActiveEquipment (ammo is now on the weapon itself)
            equipment.is_ready_to_fire = false;
            active_equipments.player_identity().update(equipment);

            // --- Handle Torch/Flashlight/Snorkel State on Unequip ---
            // Always turn off torch/flashlight/snorkel when unequipping, regardless of which item was equipped
            if let Some(mut player) = players_table.identity().find(&player_identity) {
                let mut needs_update = false;
                if player.is_aiming_throw {
                    player.is_aiming_throw = false;
                    needs_update = true;
                }
                
                if player.is_torch_lit {
                    player.is_torch_lit = false;
                    needs_update = true;
                    log::info!("Player {:?} unequipped item, extinguishing torch.", player_identity);
                }
                
                if player.is_flashlight_on {
                    player.is_flashlight_on = false;
                    needs_update = true;
                    log::info!("Player {:?} unequipped item, turning off flashlight.", player_identity);
                }
                
                if player.is_snorkeling {
                    player.is_snorkeling = false;
                    crate::sound_events::emit_snorkel_emerge_sound(ctx, player.position_x, player.position_y, player_identity);
                    needs_update = true;
                    log::info!("Player {:?} unequipped item, emerging from snorkel.", player_identity);
                }
                
                if needs_update {
                    player.last_update = ctx.timestamp;
                    players_table.identity().update(player);
                }
            }
            // --- End Handle Torch/Flashlight/Snorkel State on Unequip ---
        } else {
            log::debug!("Player {:?} called clear_active_item_reducer, but no item was active.", player_identity);
        }
    } else {
        log::info!("Player {:?} tried to clear active item, but no ActiveEquipment row found.", player_identity);
    }
    Ok(())
}

/// Loads a ranged weapon with ammunition or cycles through available ammo types
///
/// If the weapon is not loaded, loads it with the player's preferred ammo type (or first available).
/// If the weapon is already loaded, cycles to the next available ammo type.
/// Remembers the player's preferred ammo type for future loading.
/// Filters ammunition by compatible type (arrows for bows/crossbows, bullets for pistols).
/// For magazine-based weapons, consumes ammo from inventory and tracks loaded count.
#[spacetimedb::reducer]
pub fn load_ranged_weapon(ctx: &ReducerContext) -> Result<(), String> {
    let sender_id = ctx.sender();
    log::info!("[LoadRangedWeapon] Reducer called by player: {:?}", sender_id);

    let active_equipments = ctx.db.active_equipment();
    let players_table = ctx.db.player();
    let item_defs = ctx.db.item_definition();
    let inventory_items = ctx.db.inventory_item();
    let ranged_weapon_stats = ctx.db.ranged_weapon_stats();

    // --- Check player state first ---
    let player = players_table.identity().find(&sender_id)
        .ok_or_else(|| "Player not found.".to_string())?;
    
    if player.is_dead {
        return Err("Cannot load weapons while dead.".to_string());
    }
    if player.is_knocked_out {
        return Err("Cannot load weapons while knocked out.".to_string());
    }

    let mut current_equipment = get_or_create_active_equipment(ctx, sender_id)?;
    log::info!("[LoadRangedWeapon] Found ActiveEquipment for player {:?}: {:?}", sender_id, current_equipment);

    let equipped_item_def_id = current_equipment.equipped_item_def_id
        .ok_or_else(|| "No item equipped to load.".to_string())?;
    
    let item_def = item_defs.id().find(equipped_item_def_id)
        .ok_or_else(|| "Equipped item definition not found".to_string())?;

    // Check if the equipped item is a ranged weapon
    if item_def.category != crate::items::ItemCategory::RangedWeapon {
        return Err("Equipped item is not a ranged weapon.".to_string());
    }

    // Grenade and Flare are self-ammo; they are auto-loaded when equipped. No manual load needed.
    if item_def.name == "Grenade" || item_def.name == "Flare" {
        return Ok(());
    }

    // Get weapon stats for magazine capacity and reload time
    let weapon_stats = ranged_weapon_stats.item_name().find(&item_def.name);
    let magazine_capacity = weapon_stats.as_ref().map(|s| s.magazine_capacity).unwrap_or(0);
    let magazine_reload_time_secs = weapon_stats.as_ref().map(|s| s.magazine_reload_time_secs).unwrap_or(0.0);
    
    // --- Reload Cooldown Check ---
    // If weapon has a reload time and we've started a reload, check if enough time has passed
    let current_time_ms = (ctx.timestamp.to_micros_since_unix_epoch() / 1000) as u64;
    
    if magazine_reload_time_secs > 0.0 && current_equipment.reload_start_time_ms > 0 {
        let reload_time_ms = (magazine_reload_time_secs * 1000.0) as u64;
        let elapsed_ms = current_time_ms.saturating_sub(current_equipment.reload_start_time_ms);
        
        if elapsed_ms < reload_time_ms {
            let remaining_ms = reload_time_ms - elapsed_ms;
            return Err(format!("Still reloading... ({:.1}s remaining)", remaining_ms as f32 / 1000.0));
        }
        // Reload cooldown complete - allow the reload to proceed
        log::info!("[LoadRangedWeapon] Player {:?} reload cooldown complete after {}ms", sender_id, elapsed_ms);
    }

    // Determine the compatible ammo type based on weapon
    // Bows and Crossbows use Arrow ammunition
    // Firearms (Makarov PM, PP-91 KEDR, etc.) use Bullet ammunition
    // Harpoon Guns use HarpoonDart ammunition
    let is_firearm = item_def.name == "Makarov PM" || item_def.name == "PP-91 KEDR"; // Firearms use 9x18mm bullets
    let is_harpoon_gun = item_def.name == "Reed Harpoon Gun"; // Underwater harpoon weapons
    
    let required_ammo_type = if is_harpoon_gun {
        crate::models::AmmoType::HarpoonDart
    } else if is_firearm {
        crate::models::AmmoType::Bullet
    } else {
        crate::models::AmmoType::Arrow
    };
    
    let ammo_type_name = if is_harpoon_gun { 
        "harpoon darts" 
    } else if is_firearm { 
        "ammunition" 
    } else { 
        "arrows" 
    };
    
    // Find all available compatible ammo types in player's inventory/hotbar
    let mut available_ammo: Vec<(String, u64)> = Vec::new(); // (name, def_id)
    
    // Iterate through all ammunition item definitions that match the required type
    for ammo_def in item_defs.iter().filter(|def| {
        def.category == crate::items::ItemCategory::Ammunition
            && def.ammo_type == Some(required_ammo_type)
    }) {
        // Check if player has at least 1 of this ammo in inventory/hotbar
        let has_ammo = inventory_items.iter().any(|item| {
            item.item_def_id == ammo_def.id 
            && item.quantity > 0
            && match &item.location {
                crate::models::ItemLocation::Inventory(data) => data.owner_id == sender_id,
                crate::models::ItemLocation::Hotbar(data) => data.owner_id == sender_id,
                _ => false,
            }
        });
        
        if has_ammo {
            available_ammo.push((ammo_def.name.clone(), ammo_def.id));
        }
    }

    if available_ammo.is_empty() {
        return Err(format!("You need at least 1 {} to load the weapon.", ammo_type_name));
    }

    let selected_ammo = if current_equipment.is_ready_to_fire && current_equipment.loaded_ammo_count > 0 {
        // Weapon already has ammo loaded - cycle to next ammo type (magazine weapons)
        // For single-shot weapons, this allows switching arrow types
        if let Some(current_ammo_id) = current_equipment.loaded_ammo_def_id {
            // Find current ammo in available list
            let current_index = available_ammo.iter()
                .position(|(_, id)| *id == current_ammo_id);
            
            if let Some(index) = current_index {
                // Cycle to next ammo type (wrap around to beginning if at end)
                let next_index = (index + 1) % available_ammo.len();
                available_ammo[next_index].clone()
            } else {
                // Current ammo not in available list, use first available
                available_ammo[0].clone()
            }
        } else {
            // Somehow ready to fire but no ammo loaded, use first available
            available_ammo[0].clone()
        }
    } else {
        // Weapon is not loaded - use preferred ammo type if available, otherwise first available
        if let Some(preferred_type) = &current_equipment.preferred_arrow_type {
            // Try to find preferred ammo type in available ammo
            available_ammo.iter()
                .find(|(name, _)| name == preferred_type)
                .cloned()
                .unwrap_or_else(|| available_ammo[0].clone()) // Fall back to first available
        } else {
            // No preference set, use first available
            available_ammo[0].clone()
        }
    };

    // --- Magazine-based loading (firearms) vs single-shot loading (bows) ---
    if magazine_capacity > 0 {
        // Magazine-based weapon (e.g., pistol)
        // Calculate how many rounds to load
        let current_loaded = current_equipment.loaded_ammo_count;
        let space_available = magazine_capacity.saturating_sub(current_loaded);
        
        if space_available == 0 {
            // Magazine is full - just cycle ammo type, but ensure weapon is ready to fire
            current_equipment.loaded_ammo_def_id = Some(selected_ammo.1);
            current_equipment.is_ready_to_fire = true; // Ensure ready to fire even when cycling
            current_equipment.preferred_arrow_type = Some(selected_ammo.0.clone());
            active_equipments.player_identity().update(current_equipment);
            log::info!("[LoadRangedWeapon] Player {:?} cycled {} ammo to {} (magazine full at {}).", 
                sender_id, item_def.name, selected_ammo.0, current_loaded);
            return Ok(());
        }
        
        // Count total available ammo of selected type in player's inventory/hotbar
        let total_available_ammo: u32 = inventory_items.iter()
            .filter(|item| {
                item.item_def_id == selected_ammo.1 
                && item.quantity > 0
                && match &item.location {
                    crate::models::ItemLocation::Inventory(data) => data.owner_id == sender_id,
                    crate::models::ItemLocation::Hotbar(data) => data.owner_id == sender_id,
                    _ => false,
                }
            })
            .map(|item| item.quantity)
            .sum();
        
        // Calculate how many to load (min of available space and available ammo)
        let rounds_to_load = std::cmp::min(space_available as u32, total_available_ammo) as u8;
        
        if rounds_to_load == 0 {
            return Err(format!("No {} available to load.", ammo_type_name));
        }
        
        // Consume rounds from inventory
        let mut rounds_remaining = rounds_to_load as u32;
        let inventory_items_table = ctx.db.inventory_item();
        
        // Collect items to consume from
        let mut items_to_consume: Vec<(u64, u32)> = Vec::new(); // (instance_id, amount_to_consume)
        for item in inventory_items_table.iter() {
            if rounds_remaining == 0 { break; }
            if item.item_def_id == selected_ammo.1 
                && item.quantity > 0
                && match &item.location {
                    crate::models::ItemLocation::Inventory(data) => data.owner_id == sender_id,
                    crate::models::ItemLocation::Hotbar(data) => data.owner_id == sender_id,
                    _ => false,
                }
            {
                let consume_amount = std::cmp::min(item.quantity, rounds_remaining);
                items_to_consume.push((item.instance_id, consume_amount));
                rounds_remaining -= consume_amount;
            }
        }
        
        // Actually consume the rounds
        for (instance_id, consume_amount) in items_to_consume {
            if let Some(mut item) = inventory_items_table.instance_id().find(instance_id) {
                if item.quantity <= consume_amount {
                    // Delete the item entirely
                    inventory_items_table.instance_id().delete(instance_id);
                } else {
                    // Reduce quantity
                    item.quantity -= consume_amount;
                    inventory_items_table.instance_id().update(item);
                }
            }
        }
        
        // Update equipment state
        current_equipment.loaded_ammo_def_id = Some(selected_ammo.1);
        current_equipment.loaded_ammo_count = current_loaded + rounds_to_load;
        current_equipment.is_ready_to_fire = true;
        current_equipment.preferred_arrow_type = Some(selected_ammo.0.clone());
        // Set reload start time for cooldown tracking (client shows overlay based on this)
        // Only set if weapon has a reload time > 0
        if magazine_reload_time_secs > 0.0 {
            current_equipment.reload_start_time_ms = current_time_ms;
        }
        active_equipments.player_identity().update(current_equipment);

        log::info!("[LoadRangedWeapon] Player {:?} loaded {} rounds of {} into {} (total: {}/{}, reload_time={}s).", 
            sender_id, rounds_to_load, selected_ammo.0, item_def.name, 
            current_loaded + rounds_to_load, magazine_capacity, magazine_reload_time_secs);
        
        // Emit reload sound for magazine-based weapons
        if is_harpoon_gun {
            // Use crossbow sound as placeholder for harpoon gun (mechanical loading)
            sound_events::emit_reload_crossbow_sound(ctx, player.position_x, player.position_y, sender_id);
        } else {
            // Pistol reload sound
            sound_events::emit_reload_pistol_sound(ctx, player.position_x, player.position_y, sender_id);
        }
    } else {
        // Single-shot weapon (bow, crossbow) - existing behavior
        // Just mark as ready to fire, ammo consumed on fire
        current_equipment.loaded_ammo_def_id = Some(selected_ammo.1);
        current_equipment.loaded_ammo_count = 1; // Mark as having 1 "virtual" round for display purposes
        current_equipment.is_ready_to_fire = true;
        current_equipment.preferred_arrow_type = Some(selected_ammo.0.clone());
        // Set reload start time for cooldown tracking (client shows overlay based on this)
        // Only set if weapon has a reload time > 0 (e.g., crossbow has reload time, bow doesn't)
        if magazine_reload_time_secs > 0.0 {
            current_equipment.reload_start_time_ms = current_time_ms;
        }
        active_equipments.player_identity().update(current_equipment);

        log::info!("[LoadRangedWeapon] Player {:?} loaded {} with {} (ready to fire).", 
            sender_id, item_def.name, selected_ammo.0);
        
        // Emit reload sound based on weapon type
        if item_def.name == "Hunting Bow" {
            sound_events::emit_reload_bow_sound(ctx, player.position_x, player.position_y, sender_id);
        } else if item_def.name == "Crossbow" {
            sound_events::emit_reload_crossbow_sound(ctx, player.position_x, player.position_y, sender_id);
        }
    }
    
    Ok(())
}

/// Processes the use/swing action for the currently equipped item
///
/// Handles tool usage including swinging animations, target finding,
/// damage application, and resource gathering.
#[spacetimedb::reducer]
pub fn use_equipped_item(ctx: &ReducerContext) -> Result<(), String> {
    let sender_id = ctx.sender();
    let now_ts = ctx.timestamp;
    let now_micros = now_ts.to_micros_since_unix_epoch();
    let now_ms = (now_micros / 1000) as u64;

    let active_equipments = ctx.db.active_equipment();
    let players_table = ctx.db.player(); // Renamed for clarity
    let item_defs = ctx.db.item_definition();
    let player_last_attack_timestamps = ctx.db.player_last_attack_timestamp(); // Get handle to new table

    // Get RNG from context
    let mut rng = rand::rngs::StdRng::from_rng(ctx.rng()).map_err(|e| format!("Failed to create RNG: {}",e))?;

    let player = players_table.identity().find(sender_id)
        .ok_or_else(|| "Player not found".to_string())?;
    
    // --- Check player state first ---
    if player.is_dead {
        return Err("Cannot use items while dead.".to_string());
    }
    if player.is_knocked_out {
        return Err("Cannot use items while knocked out.".to_string());
    }
    
    let mut current_equipment = get_or_create_active_equipment(ctx, sender_id)?;

    // No bare-hand damage in this game; must have an item equipped
    let equipped_item_instance_id = current_equipment.equipped_item_instance_id
        .ok_or_else(|| "No item instance ID in active equipment to use.".to_string())?;
    let item_def_id = current_equipment.equipped_item_def_id
        .ok_or_else(|| "No item definition ID in active equipment to use.".to_string())?;

    // Check if the equipped item instance still exists (it might have been consumed)
    let inventory_items = ctx.db.inventory_item();
    let equipped_item = match inventory_items.instance_id().find(&equipped_item_instance_id) {
        Some(item) => item,
        None => {
            log::warn!("[UseEquippedItem] Equipped item instance {} no longer exists (probably consumed). Clearing from ActiveEquipment.", equipped_item_instance_id);

            // Clear the stale reference from ActiveEquipment
            current_equipment.equipped_item_def_id = None;
            current_equipment.equipped_item_instance_id = None;
            current_equipment.swing_start_time_ms = 0;
            current_equipment.icon_asset_name = None;
            active_equipments.player_identity().update(current_equipment);

            return Err("Equipped item no longer exists.".to_string());
        }
    };
    
    let item_def = item_defs.id().find(item_def_id)
        .ok_or_else(|| "Equipped item definition not found".to_string())?;
    
    // --- Check if item is broken (durability depleted) ---
    if crate::durability::has_durability_system(&item_def) && crate::durability::is_item_broken(&equipped_item) {
        log::warn!("[UseEquippedItem] Player {:?} tried to use broken item {} (Instance: {})", 
            sender_id, item_def.name, equipped_item_instance_id);
        return Err("This item is broken and cannot be used.".to_string());
    }

    // --- Skip ranged weapons for melee use_equipped_item logic ---
    if item_def.category == crate::items::ItemCategory::RangedWeapon {
        return Err("Ranged weapons should be fired using fire_projectile, not used as melee weapons.".to_string());
    }

    // --- Torch cannot be used as a weapon while underwater (snorkeling) ---
    // Wading on the surface is allowed; reach onto dry land is handled in combat::process_attack (miss).
    // Torches can still be lit/extinguished on land via toggle_torch
    if item_def.name == "Torch" && player.is_snorkeling {
        return Err("Cannot use torch as a weapon underwater. Use a harpoon instead!".to_string());
    }

    // --- BEGIN ATTACK SPEED CHECK ---
    if let Some(attack_interval_seconds) = item_def.attack_interval_secs {
        if attack_interval_seconds > 0.0 { // Only check if interval is positive
            let attack_interval_micros_u64 = (attack_interval_seconds * 1_000_000.0) as u64;
            if let Some(last_attack_record) = player_last_attack_timestamps.player_id().find(&sender_id) {
                let time_since_last_attack_micros_u64 = now_micros.saturating_sub(last_attack_record.last_attack_timestamp.to_micros_since_unix_epoch());
                // Attempting to satisfy the compiler's expectation of i64 for comparison
                if (time_since_last_attack_micros_u64 as i64) < attack_interval_micros_u64.try_into().unwrap() {
                    log::debug!(
                        "Player {:?} attack with {} (Def ID: {}) too soon. Last attack: {} us ago, interval: {} us.",
                        sender_id, item_def.name, item_def_id, time_since_last_attack_micros_u64, attack_interval_micros_u64
                    );
                    return Err("Attacking too quickly.".to_string());
                }
            }
            // If no record exists, or if enough time has passed, allow attack and update/insert timestamp later.
        }
    }
    // --- END ATTACK SPEED CHECK ---

    // --- BEGIN BANDAGE-LIKE MEDICAL HANDLING ---
    if item_def.name == "Bandage" || item_def.name == "Med Kit" || item_def.name == "Jellyfish Compress" {
        log::info!("[UseEquippedItem] Player {:?} is using equipped {} (Instance: {}, Def: {}, Health Gain: {:?}).", 
            sender_id, item_def.name, equipped_item_instance_id, item_def.id, item_def.consumable_health_gain);

        // Check for existing active BandageBurst effect from ANY bandage item to prevent stacking this specific effect type.
        let has_active_bandage_burst_effect = ctx.db.active_consumable_effect().iter().any(|effect| {
            // Check if player is either the healer or target of any active bandage effect
            (effect.player_id == sender_id && 
             (effect.effect_type == EffectType::BandageBurst || effect.effect_type == EffectType::RemoteBandageBurst)) ||
            (effect.target_player_id == Some(sender_id) && effect.effect_type == EffectType::RemoteBandageBurst)
        });

        if has_active_bandage_burst_effect {
            log::warn!("[UseEquippedItem] Player {:?} tried to use {} while another bandage-type effect is already active.", sender_id, item_def.name);
            return Err("You are already applying or receiving a bandage.".to_string());
        }

        // Get the player's position to check for nearby players
        let player_pos = players_table.identity().find(sender_id)
            .ok_or_else(|| "Player not found for medical consumable use".to_string())?;

        // Find nearby players within healing range (use a reasonable range, e.g., 4 tiles)
        const HEALING_RANGE: f32 = REMOTE_HEALING_RANGE_PX;
        let mut nearest_wounded_player: Option<(Identity, f32)> = None; // (player_id, distance)

        for other_player in players_table.iter() {
            if other_player.identity == sender_id { continue; } // Skip self
            if other_player.is_dead { continue; } // Skip dead players
            if other_player.health >= 100.0 { continue; } // Skip players at full health

            let dx = other_player.position_x - player_pos.position_x;
            let dy = other_player.position_y - player_pos.position_y;
            let distance = (dx * dx + dy * dy).sqrt();

            if distance <= HEALING_RANGE {
                if let Some((_, current_nearest_distance)) = nearest_wounded_player {
                    if distance < current_nearest_distance {
                        nearest_wounded_player = Some((other_player.identity, distance));
                    }
                } else {
                    nearest_wounded_player = Some((other_player.identity, distance));
                }
            }
        }

        if let Some((target_id, _)) = nearest_wounded_player {
            let duration_secs = item_def.consumable_duration_secs.unwrap_or(5.0).max(0.1);

            // Create a RemoteBandageBurst effect for the target
            let effect = ActiveConsumableEffect {
                effect_id: 0, // Will be auto-incremented
                player_id: sender_id, // The healer
                target_player_id: Some(target_id), // The player being healed
                item_def_id: item_def.id,
                consuming_item_instance_id: Some(equipped_item_instance_id),
                started_at: ctx.timestamp,
                ends_at: ctx.timestamp + Duration::from_micros((duration_secs * 1_000_000.0) as u64),
                total_amount: item_def.consumable_health_gain,
                amount_applied_so_far: Some(0.0),
                effect_type: EffectType::RemoteBandageBurst,
                tick_interval_micros: 1_000_000, // Check every second
                next_tick_at: ctx.timestamp + Duration::from_secs(1),
            };

            ctx.db.active_consumable_effect().insert(effect);
            log::info!("[UseEquippedItem] RemoteBandageBurst effect initiated from player {:?} to target {:?} using {}", 
                sender_id, target_id, item_def.name);
            
            // Play bandaging sound for remote bandaging
            sound_events::emit_bandaging_sound(ctx, player_pos.position_x, player_pos.position_y, sender_id);

            // Update player's last_consumed_at
            let mut player_to_update = player_pos.clone();
            player_to_update.last_consumed_at = Some(ctx.timestamp);
            players_table.identity().update(player_to_update);
        } else {
            // No nearby wounded players, apply to self as normal
            log::info!("[UseEquippedItem] No nearby wounded players found, applying bandage to self (Player {:?})", sender_id);
            
            let duration_secs = item_def.consumable_duration_secs.unwrap_or(5.0).max(0.1);

            // Create a BandageBurst effect for self-healing
            let effect = ActiveConsumableEffect {
                effect_id: 0, // Will be auto-incremented
                player_id: sender_id, // The healer (self)
                target_player_id: None, // For BandageBurst (self-heal), we use player_id as target
                item_def_id: item_def.id,
                consuming_item_instance_id: Some(equipped_item_instance_id),
                started_at: ctx.timestamp,
                ends_at: ctx.timestamp + Duration::from_micros((duration_secs * 1_000_000.0) as u64),
                total_amount: item_def.consumable_health_gain,
                amount_applied_so_far: Some(0.0),
                effect_type: EffectType::BandageBurst,
                tick_interval_micros: 1_000_000, // Check every second
                next_tick_at: ctx.timestamp + Duration::from_secs(1),
            };

            ctx.db.active_consumable_effect().insert(effect);
            log::info!("[UseEquippedItem] BandageBurst effect initiated for self-healing player {:?} with {} instance {}. Heal amount: {:?}", 
                sender_id, item_def.name, equipped_item_instance_id, item_def.consumable_health_gain);
            
            // Play bandaging sound for self-bandaging
            sound_events::emit_bandaging_sound(ctx, player_pos.position_x, player_pos.position_y, sender_id);

            // Update player's last_consumed_at
            let mut player_to_update = player_pos.clone();
            player_to_update.last_consumed_at = Some(ctx.timestamp);
            players_table.identity().update(player_to_update);
        }
        return Ok(()); // Bandage-like handling complete
    }

    if item_def.name == "Selo Olive Oil" {
        log::info!("[UseEquippedItem] Player {:?} is using equipped Selo Olive Oil (Instance: {}, Def: {}).", 
            sender_id, equipped_item_instance_id, item_def.id);

        // Use the consumables helper function to apply effects and consume the item
        let mut player_to_update = players_table.identity().find(&sender_id)
            .ok_or_else(|| "Player not found for Selo Olive Oil use".to_string())?;

        crate::consumables::apply_item_effects_and_consume(ctx, sender_id, &item_def, equipped_item_instance_id, &mut player_to_update)?;

        // Update player in database
        players_table.identity().update(player_to_update);

        return Ok(()); // Selo Olive Oil handling complete
    }

    // Default values for attack - BALANCED MELEE
    let mut actual_attack_range = PLAYER_RADIUS * DEFAULT_MELEE_RANGE_MULTIPLIER;
    
    // Use per-weapon attack arc if defined, otherwise default to 90 degrees
    // Weapons like Scythe have wider arcs (120°) for efficient grass clearing
    let mut actual_attack_angle_degrees = item_def.attack_arc_degrees.unwrap_or(DEFAULT_MELEE_ARC_DEGREES);

    // Check if the item is a spear and adjust its properties
    // SPEARS: Thrusting weapons with FOCUSED arc and VERY LONG range
    // The 60° arc is a balance between precision thrusting and forgiving the 4-directional limitation
    // (server only stores up/down/left/right, so we need some tolerance for diagonal aiming)
    if item_def.name == "Wooden Spear" || item_def.name == "Stone Spear" || item_def.name == "Reed Harpoon" {
        // Spears have the longest melee range - their defining advantage
        actual_attack_range = PLAYER_RADIUS * SPEAR_MELEE_RANGE_MULTIPLIER;
        // 60° arc (30° each side) - narrower than swing weapons, but forgiving enough
        // for the cardinal-direction limitation
        actual_attack_angle_degrees = SPEAR_MELEE_ARC_DEGREES;
        log::debug!("{} detected: Using THRUST hitbox - range {:.1}px, arc {:.1}°", 
                   item_def.name, actual_attack_range, actual_attack_angle_degrees);
    }
    
    // Scythe: VERY extended range + VERY wide arc for efficient grass clearing
    // Multi-hit all targets in arc is handled below in the attack processing
    let is_scythe = item_def.name == "Scythe";
    if is_scythe {
        actual_attack_range = PLAYER_RADIUS * SCYTHE_MELEE_RANGE_MULTIPLIER;
        actual_attack_angle_degrees = SCYTHE_MELEE_ARC_DEGREES;
        log::debug!("Scythe detected: Using extended range {:.1}, wide arc {:.1}°", actual_attack_range, actual_attack_angle_degrees);
    }

    // NEW: Blueprint doesn't swing/attack - it's only for building
    // Water containers can swing but don't deal damage (visual only)
    if item_def.name == "Blueprint" {
        log::debug!("[UseEquippedItem] {} equipped - skipping swing (non-weapon utility item)", item_def.name);
        return Ok(());
    }
    
    // --- STONE TILLER HANDLING ---
    // Stone Tiller converts terrain tiles to tilled soil for farming
    if item_def.name == "Stone Tiller" {
        log::info!("[UseEquippedItem] Stone Tiller detected - attempting to till soil");
        
        // Calculate the position in front of the player (one tile ahead in facing direction)
        // Player sprite is centered, so we target 1 tile ahead to hit the adjacent tile
        let till_distance = crate::TILE_SIZE_PX as f32; // 1 tile ahead (48px)
        let (dir_x, dir_y) = match player.direction.as_str() {
            "up" => (0.0, -1.0),
            "down" => (0.0, 1.0),
            "left" => (-1.0, 0.0),
            "right" => (1.0, 0.0),
            _ => (0.0, 1.0), // Default to down
        };
        
        let till_x = player.position_x + dir_x * till_distance;
        let till_y = player.position_y + dir_y * till_distance;
        
        // Update swing time to show the animation
        let mut current_equipment_mut = current_equipment.clone();
        current_equipment_mut.swing_start_time_ms = now_ms;
        active_equipments.player_identity().update(current_equipment_mut);
        
        // Play swing sound
        crate::sound_events::emit_weapon_swing_sound(ctx, player.position_x, player.position_y, sender_id);
        
        // Update attack timestamp
        if item_def.attack_interval_secs.is_some() && item_def.attack_interval_secs.unwrap_or(0.0) > 0.0 {
            let new_last_attack_record = PlayerLastAttackTimestamp {
                player_id: sender_id,
                last_attack_timestamp: now_ts,
            };
            if player_last_attack_timestamps.player_id().find(&sender_id).is_some() {
                player_last_attack_timestamps.player_id().update(new_last_attack_record);
            } else {
                player_last_attack_timestamps.insert(new_last_attack_record);
            }
        }
        
        // Attempt to till the soil
        match tilled_tiles::till_tile_at_position(ctx, till_x, till_y, sender_id) {
            tilled_tiles::TillResult::Success => {
                log::info!("[UseEquippedItem] Player {:?} successfully tilled soil at ({:.1}, {:.1})", 
                          sender_id, till_x, till_y);
                
                // Play tilling sound
                let _ = crate::sound_events::emit_sound_at_position_with_distance(
                    ctx, 
                    crate::sound_events::SoundType::TillDirt,
                    till_x, 
                    till_y, 
                    1.0, // volume
                    3.0 * crate::TILE_SIZE_PX as f32, // 3 tile hearing range
                    sender_id,
                );
                
                // Reduce durability on successful till
                if crate::durability::has_durability_system(&item_def) {
                    if let Err(e) = crate::durability::reduce_durability_on_hit(ctx, equipped_item_instance_id) {
                        log::error!("[UseEquippedItem] Failed to reduce tiller durability: {}", e);
                    }
                }
            },
            tilled_tiles::TillResult::AlreadyTilled => {
                log::debug!("[UseEquippedItem] Player {:?} tried to till already-prepared soil at ({:.1}, {:.1})", 
                          sender_id, till_x, till_y);
                // Play "already tilled" error sound (SOVA voice)
                let _ = crate::sound_events::emit_sound_at_position_with_distance(
                    ctx, 
                    crate::sound_events::SoundType::ErrorTillingDirt,
                    player.position_x, 
                    player.position_y, 
                    1.0, // volume
                    1.0 * crate::TILE_SIZE_PX as f32, // Only player hears
                    sender_id,
                );
            },
            tilled_tiles::TillResult::CannotTill => {
                log::debug!("[UseEquippedItem] Player {:?} cannot till at ({:.1}, {:.1}) - invalid tile type", 
                          sender_id, till_x, till_y);
                // Play "cannot till" error sound (SOVA voice)
                let _ = crate::sound_events::emit_sound_at_position_with_distance(
                    ctx, 
                    crate::sound_events::SoundType::ErrorTillingFailed,
                    player.position_x, 
                    player.position_y, 
                    1.0, // volume
                    1.0 * crate::TILE_SIZE_PX as f32, // Only player hears
                    sender_id,
                );
            },
            tilled_tiles::TillResult::Error(e) => {
                log::error!("[UseEquippedItem] Error tilling at ({:.1}, {:.1}): {}", till_x, till_y, e);
            }
        }
        
        return Ok(());
    }
    // --- END STONE TILLER HANDLING ---
    
    let mut current_equipment_mut = current_equipment.clone(); // Clone to modify for swing time
    current_equipment_mut.swing_start_time_ms = now_ms;
    active_equipments.player_identity().update(current_equipment_mut); // Update with new swing time
    
    // Play weapon swing sound for all weapon swings
    sound_events::emit_weapon_swing_sound(ctx, player.position_x, player.position_y, sender_id);

    // --- UPDATE LAST ATTACK TIMESTAMP ---
    if item_def.attack_interval_secs.is_some() && item_def.attack_interval_secs.unwrap_or(0.0) > 0.0 {
        let new_last_attack_record = PlayerLastAttackTimestamp {
            player_id: sender_id,
            last_attack_timestamp: now_ts,
        };
        if player_last_attack_timestamps.player_id().find(&sender_id).is_some() {
            player_last_attack_timestamps.player_id().update(new_last_attack_record);
        } else {
            player_last_attack_timestamps.insert(new_last_attack_record);
        }
        log::debug!("Player {:?} updated last attack timestamp for item {}", sender_id, item_def.name);
    }
    // --- END UPDATE LAST ATTACK TIMESTAMP ---

    log::debug!("[UseEquippedItem] Player {:?} started using non-bandage item '{}' (ID: {}). Swing time set.",
             sender_id, item_def.name, item_def_id);
    
    let targets = find_targets_in_cone(ctx, &player, actual_attack_range, actual_attack_angle_degrees);
    
    log::info!(
        "[UseEquippedItem] Player {:?} found {} targets with {} (range: {:.1}, angle: {:.1})",
        sender_id, targets.len(), item_def.name, actual_attack_range, actual_attack_angle_degrees
    );
    
    for (i, target) in targets.iter().enumerate() {
        log::info!(
            "[UseEquippedItem] Target {}: {:?} (distance: {:.1})",
            i, target.id, target.distance_sq.sqrt()
        );
    }
    
    // === SCYTHE CLEAVE: Hit ALL targets in the arc ===
    if is_scythe && !targets.is_empty() {
        log::info!(
            "[UseEquippedItem] Scythe cleave: Player {:?} hitting {} targets!",
            sender_id, targets.len()
        );
        
        // Hit ALL targets in the arc
        for target in &targets {
            match process_attack(ctx, sender_id, target, &item_def, now_ts, &mut rng) {
                Ok(result) => {
                    if result.hit {
                        log::debug!("Scythe hit {:?} at distance {:.1}", target.id, target.distance_sq.sqrt());
                    }
                },
                Err(e) => log::warn!("Scythe hit error on {:?}: {}", target.id, e),
            }
        }
        
        // Reduce durability once for the entire swing (not per target)
        if crate::durability::has_durability_system(&item_def) {
            if let Err(e) = crate::durability::reduce_durability_on_hit(ctx, equipped_item_instance_id) {
                log::error!("[UseEquippedItem] Failed to reduce scythe durability: {}", e);
            }
        }
        
        return Ok(());
    }
    // === END SCYTHE CLEAVE ===
    
    if let Some(target) = find_best_target(&targets, &item_def) {
        let hit_distance = target.distance_sq.sqrt();
        
        // === COMBAT DIAGNOSTIC LOGGING ===
        // Track hit distances to measure combat fairness
        // Non-blocking - just observing hit ranges
        
        // Log all successful hit attempts with distance info
        log::info!(
            "[COMBAT_DIAGNOSTIC] HIT_ATTEMPT: Player {:?} attacking {:?} with {} at distance {:.1}px (max range: {:.1}px, ratio: {:.2}x)",
            sender_id, target.id, item_def.name, hit_distance, actual_attack_range,
            if actual_attack_range > 0.0 { hit_distance / actual_attack_range } else { 0.0 }
        );
        
        // Flag suspiciously long-range hits (>120% of weapon range)
        if hit_distance > actual_attack_range * 1.2 {
            log::warn!(
                "[COMBAT_DIAGNOSTIC] RANGE_ANOMALY: Player {:?} hit target at {:.1}px with {} (max range: {:.1}px). 20%+ over range!",
                sender_id, hit_distance, item_def.name, actual_attack_range
            );
        }
        
        // For player targets, also log the target's position for desync analysis
        if let TargetId::Player(target_player_id) = &target.id {
            if let Some(target_player) = ctx.db.player().identity().find(target_player_id) {
                let dx = player.position_x - target_player.position_x;
                let dy = player.position_y - target_player.position_y;
                let calculated_distance = (dx * dx + dy * dy).sqrt();
                
                // Check if the stored distance matches calculated distance (desync detection)
                let distance_mismatch = (calculated_distance - hit_distance).abs();
                if distance_mismatch > 10.0 { // 10px tolerance
                    log::warn!(
                        "[COMBAT_DIAGNOSTIC] DISTANCE_MISMATCH: Player {:?} vs {:?}. Cone found: {:.1}px, Calculated: {:.1}px, Mismatch: {:.1}px",
                        sender_id, target_player_id, hit_distance, calculated_distance, distance_mismatch
                    );
                }
            }
        }
        // === END COMBAT DIAGNOSTIC LOGGING ===
        
        log::info!(
            "[UseEquippedItem] Player {:?} selected best target: {:?}",
            sender_id, target.id
        );
        match process_attack(ctx, sender_id, &target, &item_def, now_ts, &mut rng) {
            Ok(result) => {
                if result.hit {
                    log::debug!("Player {:?} hit a {:?} with {}.", sender_id, result.target_type, item_def.name);
                    
                    // --- Reduce durability on successful hit ---
                    if crate::durability::has_durability_system(&item_def) {
                        match crate::durability::reduce_durability_on_hit(ctx, equipped_item_instance_id) {
                            Ok(item_broke) => {
                                if item_broke {
                                    log::info!("[UseEquippedItem] Player {:?}'s {} broke after hitting target!", 
                                        sender_id, item_def.name);
                                }
                            }
                            Err(e) => {
                                log::error!("[UseEquippedItem] Failed to reduce durability for item {}: {}", 
                                    equipped_item_instance_id, e);
                            }
                        }
                    }
                }
            },
            Err(e) => log::error!("Error processing attack: {}", e),
        }
    } else {
        log::debug!("Player {:?} swung {} but hit nothing.", sender_id, item_def.name);
    }

    Ok(())
}

/// Creates or retrieves a player's ActiveEquipment record
///
/// Ensures every player has an ActiveEquipment record by creating one if it doesn't exist.
/// Used by the equipment reducers to get the current equipment state.
fn get_or_create_active_equipment(ctx: &ReducerContext, player_id: Identity) -> Result<ActiveEquipment, String> {
    let table = ctx.db.active_equipment();
    if let Some(existing) = table.player_identity().find(player_id) {
        Ok(existing)
    } else {
        log::info!("Creating new ActiveEquipment row for player {:?}", player_id);
        let new_equip = ActiveEquipment { 
            player_identity: player_id, 
            equipped_item_def_id: None,
            equipped_item_instance_id: None,
            icon_asset_name: None,
            swing_start_time_ms: 0,
            loaded_ammo_def_id: None,
            loaded_ammo_count: 0,
            is_ready_to_fire: false,
            preferred_arrow_type: None,
            reload_start_time_ms: 0,
            head_item_instance_id: None,
            chest_item_instance_id: None,
            legs_item_instance_id: None,
            feet_item_instance_id: None,
            hands_item_instance_id: None,
            back_item_instance_id: None,
        };
        table.insert(new_equip.clone());
        Ok(new_equip)
    }
}

/// Equips an armor item to the appropriate slot based on its type
///
/// Moves an armor item from inventory to the appropriate armor slot.
/// Handles swapping with existing armor if a slot is already occupied.
#[spacetimedb::reducer]
pub fn equip_armor(ctx: &ReducerContext, item_instance_id: u64) -> Result<(), String> {
    let sender_id = ctx.sender();
    log::info!("Player {:?} attempting to equip armor item instance {}", sender_id, item_instance_id);
    let inventory_items = ctx.db.inventory_item();
    let item_defs = ctx.db.item_definition();
    let active_equipments = ctx.db.active_equipment();

    // --- Check player state first ---
    let player = ctx.db.player().identity().find(&sender_id)
        .ok_or_else(|| "Player not found.".to_string())?;
    
    if player.is_dead {
        return Err("Cannot equip armor while dead.".to_string());
    }
    if player.is_knocked_out {
        return Err("Cannot equip armor while knocked out.".to_string());
    }

    let mut item_to_equip = inventory_items.instance_id().find(item_instance_id)
        .ok_or_else(|| format!("Item instance {} not found.", item_instance_id))?;

    match &item_to_equip.location {
        ItemLocation::Inventory(_) | ItemLocation::Hotbar(_) => {
            // Item is in player's direct possession slots (Inventory or Hotbar).
            // The owner_id within these ItemLocationData variants should ideally match ctx.sender().
            // This reducer proceeds to equip it for ctx.sender() regardless of a potential mismatch here,
            // as the act of equipping by sender_id implies claim and corrects its state to Equipped by sender_id.
            log::debug!("[EquipArmor] Item {} found in Inventory/Hotbar ({:?}), proceeding to equip for player {:?}.", item_instance_id, item_to_equip.location, sender_id);
        }
        ItemLocation::Unknown => {
            // Item's location is Unknown. This typically means it's not properly tracked in a specific player slot or container.
            // Allowing equip from Unknown implies the player (ctx.sender()) is claiming this unlocated item.
            log::warn!("[EquipArmor] Equipping item {} which has an ItemLocation::Unknown for player {:?}. The item will be claimed and its location updated to Equipped.", item_instance_id, sender_id);
        }
        // Other locations (Container, Dropped, already Equipped in a different slot) are not directly handled here.
        // Equipping from a container would typically involve moving it to inventory first.
        // Equipping a dropped item requires picking it up first.
        // Swapping already equipped items is usually handled by client-side logic orchestrating unequip/equip or specific swap reducers.
        _ => {
            log::warn!("[EquipArmor] Item {} cannot be equipped directly from its current location: {:?}. It must be in Inventory, Hotbar, or be in an Unknown state to be claimed.", item_instance_id, item_to_equip.location);
            return Err(format!("Item cannot be equipped from its current location ({:?}). Move to inventory/hotbar or ensure it's in a claimable state first.", item_to_equip.location));
        }
    }

    let item_def = item_defs.id().find(item_to_equip.item_def_id)
        .ok_or_else(|| format!("Definition not found for item ID {}", item_to_equip.item_def_id))?;

    if item_def.category != ItemCategory::Armor {
        return Err(format!("Item '{}' is not armor.", item_def.name));
    }
    let target_slot_type = item_def.equipment_slot_type
        .ok_or_else(|| format!("Armor '{}' has no defined equipment slot.", item_def.name))?;

    let mut equipment = get_or_create_active_equipment(ctx, sender_id)?;
    let mut previously_equipped_item_id: Option<u64> = None;

    match target_slot_type {
        EquipmentSlotType::Head => {
            previously_equipped_item_id = equipment.head_item_instance_id.take();
            equipment.head_item_instance_id = Some(item_instance_id);
            
            // --- Auto-disable head slot states when changing head armor ---
            // Turn off headlamp and snorkeling when head armor changes
            if let Some(mut player) = ctx.db.player().identity().find(&sender_id) {
                let mut needs_update = false;
                
                if player.is_headlamp_lit {
                    player.is_headlamp_lit = false;
                    crate::sound_events::emit_extinguish_torch_sound(ctx, player.position_x, player.position_y, sender_id);
                    needs_update = true;
                    log::info!("Player {:?} changed head armor, extinguishing headlamp.", sender_id);
                }
                
                if player.is_snorkeling {
                    player.is_snorkeling = false;
                    crate::sound_events::emit_snorkel_emerge_sound(ctx, player.position_x, player.position_y, sender_id);
                    needs_update = true;
                    log::info!("Player {:?} changed head armor, emerging from snorkel.", sender_id);
                }
                
                if needs_update {
                    player.last_update = ctx.timestamp;
                    ctx.db.player().identity().update(player);
                }
            }
            // --- End head slot state handling ---
        }
        EquipmentSlotType::Chest => {
            previously_equipped_item_id = equipment.chest_item_instance_id.take();
            equipment.chest_item_instance_id = Some(item_instance_id);
        }
        EquipmentSlotType::Legs => {
            previously_equipped_item_id = equipment.legs_item_instance_id.take();
            equipment.legs_item_instance_id = Some(item_instance_id);
        }
        EquipmentSlotType::Feet => {
            previously_equipped_item_id = equipment.feet_item_instance_id.take();
            equipment.feet_item_instance_id = Some(item_instance_id);
        }
        EquipmentSlotType::Hands => {
            previously_equipped_item_id = equipment.hands_item_instance_id.take();
            equipment.hands_item_instance_id = Some(item_instance_id);
        }
        EquipmentSlotType::Back => {
            previously_equipped_item_id = equipment.back_item_instance_id.take();
            equipment.back_item_instance_id = Some(item_instance_id);
        }
    }

    if let Some(old_item_id) = previously_equipped_item_id {
        if old_item_id != item_instance_id {
            if let Some(mut old_item) = inventory_items.instance_id().find(old_item_id) {
                match find_first_empty_player_slot(ctx, sender_id) {
                    Some(empty_slot_location) => {
                        old_item.location = empty_slot_location;
                        inventory_items.instance_id().update(old_item);
                        log::info!("Moved previously equipped armor {} to {:?}", old_item_id, item_to_equip.location);
                    }
                    None => return Err("No space in inventory to unequip previous armor.".to_string()),
                }
            } else {
                 log::warn!("Could not find InventoryItem for previously equipped armor ID {}. Slot was cleared.", old_item_id);
            }
        }
    }

    item_to_equip.location = ItemLocation::Equipped(crate::models::EquippedLocationData { owner_id: sender_id, slot_type: target_slot_type.clone() });
    inventory_items.instance_id().update(item_to_equip);
    active_equipments.player_identity().update(equipment);

    log::info!("Player {:?} equipped armor '{}' (Instance ID: {}) to slot {:?}.", sender_id, item_def.name, item_instance_id, target_slot_type);
    Ok(())
}

/// Scheduled reducer that fills equipped water containers during rain
/// Runs every 2 seconds to check all players with equipped water containers
#[spacetimedb::reducer]
pub fn fill_equipped_water_containers(ctx: &ReducerContext, _args: WaterContainerFillSchedule) -> Result<(), String> {
    // Security check - only allow scheduler to run this
    if ctx.sender() != ctx.identity() {
        return Err("Water container filling can only be run by scheduler".to_string());
    }

    let players_table = ctx.db.player();
    
    // PERFORMANCE: Skip if no players online
    let has_online_players = players_table.iter().any(|p| p.is_online && !p.is_dead);
    if !has_online_players {
        return Ok(());
    }
    
    let active_equipments = ctx.db.active_equipment();
    let inventory_items = ctx.db.inventory_item();
    let item_defs = ctx.db.item_definition();
    
    let mut filled_count = 0;
    
    // Check each player
    for player in players_table.iter() {
        // Skip dead or knocked out players
        if player.is_dead || player.is_knocked_out {
            continue;
        }
        
        // Get player's active equipment
        let equipment = match active_equipments.player_identity().find(&player.identity) {
            Some(eq) => eq,
            None => continue,
        };
        
        // Check if player has a water container equipped
        let equipped_instance_id = match equipment.equipped_item_instance_id {
            Some(id) => id,
            None => continue,
        };
        
        // Get the equipped item
        let mut equipped_item = match inventory_items.instance_id().find(equipped_instance_id) {
            Some(item) => item,
            None => continue,
        };
        
        // Get item definition
        let item_def = match item_defs.id().find(equipped_item.item_def_id) {
            Some(def) => def,
            None => continue,
        };
        
        // Check if it's a water container
        let max_capacity = match item_def.name.as_str() {
            "Reed Water Bottle" => crate::rain_collector::REED_WATER_BOTTLE_CAPACITY,
            "Plastic Water Jug" => crate::rain_collector::PLASTIC_WATER_JUG_CAPACITY,
            _ => continue, // Not a water container
        };
        
        // Check if container is already full
        let current_water = equipped_item.item_data.as_ref()
            .and_then(|data| {
                // Try parsing as JSON first (new format: {"water_liters": 2.0})
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(data) {
                    parsed.get("water_liters").and_then(|v| v.as_f64()).map(|v| v as f32)
                } else {
                    // Fallback to plain number string (old format: "2.0")
                    data.parse::<f32>().ok()
                }
            })
            .unwrap_or(0.0);
        if current_water >= max_capacity {
            continue; // Already full
        }
        
        // Check if it's raining at player's position
        let chunk_weather = get_weather_for_position(ctx, player.position_x, player.position_y);
        
        // Skip if not raining
        if chunk_weather.current_weather == WeatherType::Clear {
            continue;
        }
        
        // Check if player is inside a building (can't collect rain indoors)
        if crate::building_enclosure::is_position_inside_building(ctx, player.position_x, player.position_y) {
            continue;
        }
        
        // Calculate fill rate based on weather intensity
        // Using same rates as rain collectors but scaled down for realism
        let fill_rate_per_second = match chunk_weather.current_weather {
            WeatherType::LightRain => 0.01,      // 0.01L per second (120 seconds to fill 2L bottle)
            WeatherType::ModerateRain => 0.02,   // 0.02L per second (100 seconds to fill 2L bottle)
            WeatherType::HeavyRain => 0.04,      // 0.04L per second (50 seconds to fill 2L bottle)
            WeatherType::HeavyStorm => 0.06,     // 0.06L per second (33 seconds to fill 2L bottle)
            WeatherType::Clear => continue,      // Already checked above
        };
        
        // Calculate water to add (2 second interval)
        let water_to_add = fill_rate_per_second * 2.0;
        let new_water_level = (current_water + water_to_add).min(max_capacity);
        
        // Update the item's water level (store as JSON for client compatibility)
        equipped_item.item_data = Some(format!(r#"{{"water_liters":{}}}"#, new_water_level));
        inventory_items.instance_id().update(equipped_item);
        
        filled_count += 1;
        
        log::debug!("Filled {} for player {:?} from {:.2}L to {:.2}L (max: {:.2}L) during {:?}", 
                   item_def.name, player.identity, current_water, new_water_level, max_capacity, chunk_weather.current_weather);
    }
    
    if filled_count > 0 {
        log::debug!("Filled {} equipped water containers during rain", filled_count);
    }
    
    Ok(())
}
