use spacetimedb::{ReducerContext, SpacetimeType, Table};
use log;
// Import ActiveEquipment table definition
// use crate::active_equipment::{ActiveEquipment};
// ADD generated table trait import with alias
use crate::active_equipment::active_equipment as ActiveEquipmentTableTrait;
// Import Campfire table trait
use crate::campfire::campfire as CampfireTableTrait;
// Import Player table trait
use crate::player as PlayerTableTrait;
// Import DroppedItem helpers
use crate::dropped_item::{calculate_drop_position, create_dropped_item_entity, create_dropped_item_entity_with_data};
// REMOVE unused concrete table type imports
// use crate::items::{InventoryItemTable, ItemDefinitionTable};
use crate::items_database; // Use new modular items database
use std::cmp::min;
use spacetimedb::Identity; // ADDED for add_item_to_player_inventory
// Import the ContainerItemClearer and ItemContainer traits
use crate::inventory_management::{ContainerItemClearer, ItemContainer};
// Table traits for clear_item_from_container_by_location (direct db access)
use crate::furnace::furnace as FurnaceTableTrait;
use crate::fumarole::fumarole as FumaroleTableTrait;
use crate::wooden_storage_box::wooden_storage_box as WoodenStorageBoxTableTrait;
use crate::player_corpse::player_corpse as PlayerCorpseTableTrait;
use crate::stash::stash as StashTableTrait;
use crate::rain_collector::rain_collector as RainCollectorTableTrait;
use crate::turret::turret as TurretTableTrait;
use crate::barbecue::barbecue as BarbecueTableTrait;
use crate::lantern::lantern as LanternTableTrait;
use crate::broth_pot::broth_pot as BrothPotTableTrait;
use crate::homestead_hearth::homestead_hearth as HomesteadHearthTableTrait;
// Import the function that was moved
use crate::player_inventory::move_item_to_hotbar;
use crate::player_inventory::move_item_to_inventory;
// Import helper used locally
use crate::player_inventory::find_first_empty_inventory_slot; 
use crate::models::{ItemLocation, ContainerLocationData, ContainerType, EquipmentSlotType, TargetType}; // <<< UPDATED IMPORT
use std::collections::HashSet;
use serde::{Deserialize, Serialize};
use crate::campfire::CampfireClearer; 
use crate::fumarole::FumaroleClearer;
use crate::wooden_storage_box::WoodenStorageBoxClearer;
use crate::player_corpse::PlayerCorpseClearer;
use crate::stash::StashClearer; // Added StashClearer import
use crate::rain_collector::RainCollector as RainCollectorClearer; // Added RainCollectorClearer import
use crate::turret::TurretClearer; // Added TurretClearer import
use crate::furnace::FurnaceClearer;
use crate::barbecue::BarbecueClearer;
use crate::lantern::LanternClearer;
use crate::broth_pot::BrothPotClearer;
use crate::ranged_weapon_stats::RangedWeaponStats; // For the struct
use crate::ranged_weapon_stats::ranged_weapon_stats as ranged_weapon_stats_table_accessor; // For ctx.db.ranged_weapon_stats()
use crate::active_effects::{FoodPoisoningRisk, food_poisoning_risk as FoodPoisoningRiskTableTrait}; // For food poisoning

// --- Item Enums and Structs ---

// Define categories or types for items
#[derive(Clone, Debug, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize, SpacetimeType)]
pub enum ItemCategory {
    Tool,
    Material,
    Placeable,
    Armor,
    Consumable,
    Ammunition,
    Weapon,
    RangedWeapon, // NEW: Added RangedWeapon category
    // Add other categories as needed (Consumable, Wearable, etc.)
}

#[derive(SpacetimeType, Clone, Debug, Serialize, Deserialize)] // Added Serialize, Deserialize
pub struct CostIngredient {
    pub item_name: String,
    pub quantity: u32,
}

/// Flexible ingredient group - allows any combination of valid items totaling the required quantity
/// Example: "Any 2 berries" where berries = ["Lingonberries", "Cloudberries", "Bilberries", ...]
#[derive(SpacetimeType, Clone, Debug, Serialize, Deserialize)]
pub struct FlexibleIngredient {
    pub valid_items: Vec<String>,  // List of item names that can satisfy this requirement
    pub total_required: u32,       // Total quantity needed (can mix different valid items)
    pub group_name: String,        // Display name like "Any Berry" or "Any Cooked Root"
}

#[spacetimedb::table(accessor = item_definition, public)]
#[derive(Clone, Debug)] // Removed SpacetimeType, Serialize, Deserialize here as it's a table
                       // It will get them from the #[table] macro automatically.
pub struct ItemDefinition {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub name: String,          // Unique name used as an identifier too?
    pub description: String,   // Optional flavor text
    pub category: ItemCategory,
    pub icon_asset_name: String, // e.g., "stone_hatchet.png", used by client
    pub is_stackable: bool,    // Can multiple instances exist in one inventory slot?
    pub stack_size: u32,       // Max number per stack (if stackable)
    pub is_equippable: bool,   // Can this item be equipped (in hand OR on body)?
    pub equipment_slot_type: Option<EquipmentSlotType>, // <-- ADD THIS. Ensure EquipmentSlotType is imported from models.rs
    pub fuel_burn_duration_secs: Option<f32>, // How long one unit of this fuel lasts. If Some, it's fuel.

    // New fields for detailed damage and yield
    pub primary_target_damage_min: Option<u32>,
    pub primary_target_damage_max: Option<u32>,
    pub primary_target_yield_min: Option<u32>,
    pub primary_target_yield_max: Option<u32>,
    pub primary_target_type: Option<TargetType>,
    pub primary_yield_resource_name: Option<String>,

    pub pvp_damage_min: Option<u32>,
    pub pvp_damage_max: Option<u32>,

    pub bleed_damage_per_tick: Option<f32>, // ADDED
    pub bleed_duration_seconds: Option<f32>, // ADDED
    pub bleed_tick_interval_seconds: Option<f32>, // ADDED

    pub crafting_cost: Option<Vec<CostIngredient>>, // MODIFIED HERE
    pub alternative_crafting_costs: Option<Vec<Vec<CostIngredient>>>, // Alternative recipes that can also produce this item
    pub flexible_ingredients: Option<Vec<FlexibleIngredient>>, // Flexible ingredient groups (e.g., "any 2 berries")
    pub crafting_output_quantity: Option<u32>,      // How many items this recipe produces
    pub crafting_time_secs: Option<u32>,            // Time in seconds to craft
    pub requires_station: Option<String>,           // Name of station required for crafting (e.g., "Cooking Station")

    // Consumable Effects
    pub consumable_health_gain: Option<f32>,
    pub consumable_hunger_satiated: Option<f32>,
    pub consumable_thirst_quenched: Option<f32>,
    pub consumable_duration_secs: Option<f32>, // For effects over time, 0 or None for instant
    pub cook_time_secs: Option<f32>,           // Time to cook this item if it's cookable
    pub cooked_item_def_name: Option<String>, // Name of the ItemDefinition this item cooks into
    pub requires_furnace_for_cooking: bool,    // If true, campfire produces Charcoal instead of cooked output (e.g. olives -> oil needs furnace)
    /// Generic extraction: crush bones, unravel rope, pulverize, mash, extract yeast, gut fish.
    /// When set, item can be processed into output_item (min..=max). Action label for UI: "Crush", "Unravel", etc.
    pub extraction_output_name: Option<String>,
    pub extraction_output_min: Option<u32>,
    pub extraction_output_max: Option<u32>,
    pub extraction_action_label: Option<String>,
    pub damage_resistance: Option<f32>, // <<< DEPRECATED: Use armor_resistances instead
    pub warmth_bonus: Option<f32>,      // <<< ADDED: e.g., 0.2 warmth points per effect interval
    pub respawn_time_seconds: Option<u32>, // Time for the item/resource node to respawn in the world
    pub attack_interval_secs: Option<f32>, // Minimum time between attacks for this item
    
    // NEW ARMOR SYSTEM FIELDS
    pub damage_type: Option<crate::models::DamageType>, // What type of damage this weapon deals
    pub armor_resistances: Option<crate::models::ArmorResistances>, // Typed resistance values
    pub movement_speed_modifier: Option<f32>, // -0.2 = -20% speed, 0.1 = +10% speed
    pub stamina_regen_modifier: Option<f32>, // Legacy name: 0.1 = 10% reduced hunger/thirst drain
    pub reflects_melee_damage: Option<f32>, // % of melee damage reflected back to attacker
    pub fire_damage_multiplier: Option<f32>, // 2.0 = double fire damage taken
    pub detection_radius_bonus: Option<f32>, // 0.1 = +10% detection radius
    pub low_health_damage_bonus: Option<f32>, // 0.2 = +20% damage when health < 30%
    
    // ARMOR SPECIAL PROPERTIES (booleans default to false)
    pub grants_burn_immunity: bool, // Full bone set grants burn immunity
    pub grants_cold_immunity: bool, // Full fur set grants cold immunity
    pub grants_wetness_immunity: bool, // Full scale set grants wetness immunity
    pub grants_knockback_immunity: bool, // Full scale set grants knockback immunity
    pub grants_bleed_immunity: bool, // Leather armor grants bleed immunity
    pub grants_night_vision: bool, // Angunax (owl) totem grants night vision
    pub noise_on_sprint: bool, // Bone armor makes noise when sprinting
    pub silences_movement: bool, // Fox fur boots silence footsteps
    pub intimidates_animals: bool, // Wolf fur intimidates animals
    
    // AMMUNITION TYPE (for distinguishing arrows from bullets)
    pub ammo_type: Option<crate::models::AmmoType>, // Arrow for bows/crossbows, Bullet for pistols
    
    // WEAPON ARC ANGLE (for melee weapons with different sweep widths)
    pub attack_arc_degrees: Option<f32>, // Custom attack arc in degrees. None = use default (90°). Scythe uses 120° for wide sweep.
    
    // WATER SPEED BONUS (for flippers and similar aquatic gear)
    pub water_speed_bonus: Option<f32>, // 1.0 = +100% water speed (2x normal), 0.5 = +50% water speed
    
    // FOOD PRESERVATION (for items that never spoil)
    pub is_preserved: bool, // If true, this food item never spoils (jams, pickles, honey, mead, vinegar)
    
    // EXPLICIT SPOILAGE (for non-food items that should spoil, like live creatures)
    pub spoils_after_hours: Option<f32>, // If set, item spoils after this many hours regardless of category
    
    // BONE TOTEM PASSIVE BONUSES
    pub harvest_bonus: Option<f32>, // 0.25 = +25% harvest yield bonus
    pub ally_damage_bonus: Option<f32>, // 0.15 = +15% damage when allies within range
    pub poison_damage_on_hit: Option<f32>, // Flat poison damage added to each melee hit
    pub max_health_bonus: Option<i32>, // Flat bonus to max health (e.g., +10)
    pub bleed_chance_on_melee: Option<f32>, // 0.1 = 10% chance to inflict bleed on melee hit
    pub reduces_animal_detection: Option<f32>, // 0.2 = -20% animal detection radius
    pub melee_damage_bonus: Option<f32>, // 0.15 = +15% melee damage bonus
}

// --- Inventory Table ---

// Represents an instance of an item in a player's inventory
#[spacetimedb::table(accessor = inventory_item, public)]
#[derive(Clone, Debug)]
pub struct InventoryItem {
    #[primary_key]
    #[auto_inc]
    pub instance_id: u64,      // Unique ID for this specific item instance
    pub item_def_id: u64,      // Links to ItemDefinition table (FK)
    pub quantity: u32,         // How many of this item
    pub location: ItemLocation, // <<< NEW FIELD ADDED
    pub item_data: Option<String>, // JSON string for item-specific data (water content, durability, etc.)
    // Add other instance-specific data later (e.g., current_durability)
}

// --- Item Reducers ---

// Reducer to seed initial item definitions if the table is empty
#[spacetimedb::reducer]
pub fn seed_items(ctx: &ReducerContext) -> Result<(), String> {
    let items = ctx.db.item_definition();
    if items.iter().count() > 0 {
        log::info!("Item definitions already seeded ({}). Skipping.", items.iter().count());
        return Ok(());
    }

    log::info!("Seeding initial item definitions...");

    let initial_items = items_database::get_initial_item_definitions(); // REPLACE vector literal with function call

    let mut seeded_count = 0;
    for item_def in initial_items {
        match items.try_insert(item_def) {
            Ok(_) => seeded_count += 1,
            Err(e) => log::error!("Failed to insert item definition during seeding: {}", e),
        }
    }

    log::info!("Finished seeding {} item definitions.", seeded_count);
    Ok(())
}

// Reducer to seed initial ranged weapon stats
#[spacetimedb::reducer]
pub fn seed_ranged_weapon_stats(ctx: &ReducerContext) -> Result<(), String> {
    let ranged_stats = ctx.db.ranged_weapon_stats();

    log::info!("Seeding/updating ranged weapon stats...");

    // RANGED WEAPON PROGRESSION (Early → Mid → Late Game)
    // ================================================
    // BALANCED for clear progression feel:
    // 
    // Hunting Bow: Skill-based, fast fire rate, decent damage, rewarding when mastered
    //   - DPS: ~55 | Burst: 47 avg | Requires leading shots but fast follow-ups
    //   
    // Crossbow: Power weapon, slow but devastating hits, punishes misses
    //   - DPS: ~37.5 | Burst: 86.5 avg | Best single-hit damage, slow reload
    //   
    // Makarov PM: Rapid fire, highest sustained DPS, burns expensive ammo
    //   - DPS: ~113 | Burst: 43 avg | Magazine-fed, ammo-hungry
    
    let initial_ranged_stats = vec![
        // TIER 1: Hunting Bow (Early Game)
        // THE "SKILL WEAPON" - Rewards practice and aggressive play
        // - Fast fire rate allows follow-up shots
        // - Arrow arc requires skill to compensate
        // - Close range forces decisive engagements
        // - Accessible materials, good for hunting and light PvP
        // - INSTANT NOCK - no reload time, just draw and fire
        RangedWeaponStats {
            item_name: "Hunting Bow".to_string(),
            weapon_range: 520.0,       // Close-mid range - rewards aggressive positioning
            projectile_speed: 800.0,   // Faster arrows - less frustrating to lead
            accuracy: 0.86,            // 86% accuracy - rewards getting in range
            reload_time_secs: 0.40,    // Slightly faster follow-up shots - keeps the bow snappy
            magazine_capacity: 0,      // Single-shot (arrows loaded one at a time)
            is_automatic: false,       // Semi-auto - must click for each shot
            magazine_reload_time_secs: 0.0, // Instant nock - no reload animation
        },
        
        // TIER 2: Crossbow (Mid Game)
        // THE "POWER WEAPON" - One-shot potential, punishes misses
        // - Highest single-hit damage in ranged category
        // - Mechanical precision (highest accuracy)
        // - Slow reload creates risk/reward tension
        // - Best for ambushes and calculated shots
        // - MANUAL RELOAD - right-click to crank string and load bolt (same as bow)
        // - NO FIRE RATE COOLDOWN - can press attack anytime, but must reload first
        RangedWeaponStats {
            item_name: "Crossbow".to_string(),
            weapon_range: 680.0,       // Good range - can engage from cover
            projectile_speed: 920.0,   // Fast bolts, flat trajectory
            accuracy: 0.95,            // 95% accuracy - mechanical precision
            reload_time_secs: 0.0,     // NO fire rate cooldown - manual reload is the only delay
            magazine_capacity: 0,      // Single-shot (bolts loaded one at a time)
            is_automatic: false,       // Semi-auto - must click for each shot
            magazine_reload_time_secs: 1.0, // 2 seconds to crank crossbow string (right-click)
        },
        
        // TIER 3: Makarov PM (Late Game)
        // THE "PRECISION PISTOL" - High per-shot damage, deliberate firing
        // - Slow semi-auto fire rate (1 shot/sec) encourages aimed shots
        // - Magazine allows 8 shots before reload
        // - Higher per-shot damage than SMG, lower DPS
        // - Burns through expensive 9x18mm ammo but rewards accuracy
        // - MAGAZINE SWAP - takes time to eject and insert magazine
        RangedWeaponStats {
            item_name: "Makarov PM".to_string(),
            weapon_range: 820.0,       // Longest range - engage at distance
            projectile_speed: 3200.0,  // Fast moving bullets, roughly four times bow speed
            accuracy: 0.88,            // 88% accuracy - slow fire rate means better aim
            reload_time_secs: 0.5,     // 1 second between shots - deliberate semi-auto
            magazine_capacity: 8,      // 8-round magazine
            is_automatic: false,       // Semi-auto pistol - must click for each shot
            magazine_reload_time_secs: 1.25, // 2.5 seconds to swap magazine
        },
        
        // TIER 4: PP-91 KEDR (Endgame)
        // THE "BULLET HOSE" - Maximum sustained DPS, ammo hungry
        // - Extreme fire rate with 30-round magazine
        // - Low per-shot damage compensated by volume
        // - Lower accuracy than pistol due to rapid fire
        // - Burns through 9x18mm ammo extremely fast
        // - FULLY AUTOMATIC - hold mouse button to spray
        // - LONGER RELOAD - larger magazine takes more time to swap
        RangedWeaponStats {
            item_name: "PP-91 KEDR".to_string(),
            weapon_range: 720.0,       // Shorter than pistol - SMG loses accuracy at range
            projectile_speed: 3000.0,  // Fast bullets, slightly slower than pistol
            accuracy: 0.72,            // 72% accuracy - full auto recoil
            reload_time_secs: 0.05,    // Extreme fire rate - 10 rounds per second
            magazine_capacity: 30,     // 30-round magazine
            is_automatic: true,        // FULL AUTO - hold mouse button to fire continuously
            magazine_reload_time_secs: 1.5, // 3 seconds to swap larger magazine
        },
        
        // UNDERWATER: Reed Harpoon Gun
        // THE "AMPHIBIOUS WEAPON" - Works both underwater and on land
        // - Only ranged weapon usable while swimming/snorkeling
        // - Small 2-dart magazine for underwater hunting
        // - Crossbow-like ballistics: fast projectile, good range, accurate
        // - Magazine reload is the ONLY delay (same pattern as Crossbow)
        // - NO fire rate cooldown - darts fire instantly when loaded
        // - PNEUMATIC RELOAD - takes time to re-pressurize and load darts
        RangedWeaponStats {
            item_name: "Reed Harpoon Gun".to_string(),
            weapon_range: 650.0,       // Similar to crossbow range (680)
            projectile_speed: 900.0,   // Fast dart speed like crossbow (920)
            accuracy: 0.90,            // 90% accuracy - pneumatic precision
            reload_time_secs: 0.0,     // NO fire rate cooldown - magazine reload is the only delay
            magazine_capacity: 2,      // 2-dart magazine - limited capacity
            is_automatic: false,       // Semi-auto - must click for each shot
            magazine_reload_time_secs: 1.0, // 2 seconds to reload darts
        },

        // Grenade - self-ammo throwable, straight-line, no bounce
        RangedWeaponStats {
            item_name: "Grenade".to_string(),
            weapon_range: 450.0,
            projectile_speed: 700.0,
            accuracy: 1.0,
            reload_time_secs: 0.25,
            magazine_capacity: 0,
            is_automatic: false,
            magazine_reload_time_secs: 0.0,
        },

        // Flare - self-ammo throwable, straight-line, no bounce
        RangedWeaponStats {
            item_name: "Flare".to_string(),
            weapon_range: 450.0,
            projectile_speed: 700.0,
            accuracy: 1.0,
            reload_time_secs: 0.25,
            magazine_capacity: 0,
            is_automatic: false,
            magazine_reload_time_secs: 0.0,
        },
    ];

    let mut seeded_count = 0;
    let mut updated_count = 0;
    
    for stats in initial_ranged_stats {
        // Check if this weapon already exists in the database
        if let Some(existing) = ranged_stats.item_name().find(&stats.item_name) {
            // Update if any values differ (allows hot-updating stats without clean deploy)
            if existing.weapon_range != stats.weapon_range 
                || existing.projectile_speed != stats.projectile_speed
                || existing.accuracy != stats.accuracy
                || existing.reload_time_secs != stats.reload_time_secs
                || existing.magazine_capacity != stats.magazine_capacity
                || existing.is_automatic != stats.is_automatic
                || existing.magazine_reload_time_secs != stats.magazine_reload_time_secs
            {
                log::info!("Updating ranged stats for '{}': range {:.0}->{:.0}, reload_time={:.1}s, magazine_reload={:.1}s", 
                    stats.item_name, existing.weapon_range, stats.weapon_range, 
                    stats.reload_time_secs, stats.magazine_reload_time_secs);
                ranged_stats.item_name().update(stats);
                updated_count += 1;
            }
        } else {
            // Insert new entry
            match ranged_stats.try_insert(stats) {
                Ok(inserted) => {
                    log::info!("Seeded ranged stats for '{}': range={:.0}", inserted.item_name, inserted.weapon_range);
                    seeded_count += 1;
                },
                Err(e) => log::error!("Failed to seed ranged stats: {}", e),
            }
        }
    }

    if seeded_count > 0 || updated_count > 0 {
        log::info!("Ranged weapon stats: {} new, {} updated.", seeded_count, updated_count);
    }
    Ok(())
}

// Reducer to seed initial food poisoning risks
#[spacetimedb::reducer]
pub fn seed_food_poisoning_risks(ctx: &ReducerContext) -> Result<(), String> {
    let food_risks = ctx.db.food_poisoning_risk();
    if food_risks.iter().count() > 0 {
        log::info!("Food poisoning risks already seeded ({}). Skipping.", food_risks.iter().count());
        return Ok(());
    }

    log::info!("Seeding initial food poisoning risks...");

    // Get item definitions to find IDs by name
    let item_defs = ctx.db.item_definition();
    let mut seeded_count = 0;

    // Define food poisoning risks: (item_name, chance%, damage_per_tick, duration_secs, tick_interval_secs)
    // Organized by risk category for clarity
    let food_risks_data = vec![
        // === EXTREMELY DANGEROUS (Toxic/Poisonous) ===
        ("Raw Human Flesh", 100.0, 2.0, 15.0, 1.5),      // 100% - prion disease, always dangerous
        ("Destroying Angel", 95.0, 4.0, 20.0, 1.0),      // 95% - one of deadliest mushrooms, severe liver damage
        ("Deadly Webcap", 90.0, 3.5, 18.0, 1.0),         // 90% - deadly nephrotoxic mushroom
        ("Fly Agaric", 75.0, 2.5, 12.0, 1.5),            // 75% - toxic psychoactive, can cause organ damage
        ("Henbane", 70.0, 2.0, 10.0, 1.5),               // 70% - toxic plant with dangerous alkaloids
        
        // === HIGH RISK (Raw Predator/Scavenger Meat - Parasites, Trichinosis) ===
        ("Raw Bear Meat", 45.0, 1.5, 12.0, 2.0),         // 45% - high trichinosis risk in bears
        ("Raw Wolverine Meat", 40.0, 1.5, 10.0, 2.0),    // 40% - scavenger, high parasite load
        ("Raw Wolf Meat", 35.0, 1.2, 10.0, 2.0),         // 35% - predator meat, parasites common
        ("Raw Fox Meat", 30.0, 1.0, 8.0, 2.0),           // 30% - wild canid, parasites
        ("Raw Walrus Meat", 30.0, 1.2, 10.0, 2.0),       // 30% - trichinosis risk in marine mammals
        
        // === MEDIUM-HIGH RISK (Raw Seafood - Bacteria, Parasites) ===
        ("Raw Sea Urchin", 25.0, 1.0, 8.0, 2.0),         // 25% - raw roe can harbor bacteria
        ("Raw Blue Mussel", 30.0, 1.2, 10.0, 2.0),       // 30% - filter feeders accumulate toxins/bacteria
        ("Raw Black Katy Chiton", 25.0, 1.0, 8.0, 2.0),  // 25% - raw shellfish risk
        ("Raw Crab Meat", 20.0, 0.8, 6.0, 2.0),          // 20% - less risky but still raw shellfish
        
        // === MEDIUM RISK (Raw Fish - Parasites, Must Be Prepared Properly) ===
        ("Raw Halibut", 20.0, 0.8, 6.0, 2.0),            // 20% - large bottom fish, parasites
        ("Raw King Salmon", 18.0, 0.7, 6.0, 2.0),        // 18% - salmon can have parasites
        ("Raw Sockeye Salmon", 18.0, 0.7, 6.0, 2.0),     // 18% - salmon parasites
        ("Raw Pink Salmon", 18.0, 0.7, 6.0, 2.0),        // 18% - salmon parasites
        ("Raw Steelhead", 15.0, 0.6, 5.0, 2.0),          // 15% - trout family
        ("Raw Pacific Cod", 15.0, 0.6, 5.0, 2.0),        // 15% - white fish, anisakis risk
        ("Raw Rockfish", 15.0, 0.6, 5.0, 2.0),           // 15% - deep water fish
        ("Raw Dolly Varden", 12.0, 0.5, 5.0, 2.0),       // 12% - char family
        ("Raw Sculpin", 12.0, 0.5, 5.0, 2.0),            // 12% - spiny fish, bacteria
        ("Raw Greenling", 10.0, 0.5, 4.0, 2.0),          // 10% - coastal fish
        ("Raw Herring", 10.0, 0.5, 4.0, 2.0),            // 10% - small oily fish
        ("Raw Smelt", 8.0, 0.4, 4.0, 2.0),               // 8% - small fish, lower risk
        ("Raw Twigfish", 8.0, 0.4, 4.0, 2.0),            // 8% - small bony fish
        ("Raw Shark Meat", 25.0, 1.0, 8.0, 2.0),         // 25% - can accumulate mercury/toxins
        
        // === MEDIUM RISK (Raw Game Meat - Parasites) ===
        ("Raw Caribou Meat", 20.0, 0.8, 6.0, 2.0),       // 20% - wild game, parasites possible
        ("Raw Hare Meat", 15.0, 0.6, 5.0, 2.0),          // 15% - tularemia risk in hares
        ("Raw Viper Meat", 15.0, 0.6, 5.0, 2.0),         // 15% - snake parasites, bacteria
        
        // === LOW-MEDIUM RISK (Raw Birds - Salmonella, Parasites) ===
        ("Raw Owl Meat", 18.0, 0.7, 6.0, 2.0),           // 18% - raptor, accumulates toxins from prey
        ("Raw Crow Meat", 15.0, 0.6, 5.0, 2.0),          // 15% - scavenger bird, bacteria
        ("Raw Tern Meat", 12.0, 0.5, 4.0, 2.0),          // 12% - seabird
        ("Raw Vole Meat", 10.0, 0.4, 4.0, 2.0),          // 10% - tiny, lower risk if fresh
        
        // === LOW RISK (Irritating/Mildly Risky Plants) ===
        ("Nettle Leaves", 20.0, 0.8, 6.0, 2.0),          // 20% - formic acid stings, irritation
        ("Shaggy Ink Cap", 15.0, 0.6, 5.0, 2.0),         // 15% - must be eaten fresh, deteriorates
        ("Seaweed", 10.0, 0.4, 4.0, 2.0),                // 10% - raw ocean bacteria
        ("Raw Milk", 8.0, 0.4, 4.0, 2.0),                // 8% - unpasteurized, bacteria risk
        
        // === VERY LOW RISK (Raw Vegetables - Minimal But Possible) ===
        ("Raw Corn", 5.0, 0.5, 6.0, 2.0),                // 5% - generally safe raw
        ("Raw Potato", 4.0, 0.4, 4.0, 2.0),              // 4% - solanine in green parts
        ("Pumpkin", 3.0, 0.3, 3.0, 2.0),                 // 3% - generally safe raw
        ("Chanterelle", 5.0, 0.4, 4.0, 2.0),             // 5% - safe mushroom but raw is risky
        ("Porcini", 5.0, 0.4, 4.0, 2.0),                 // 5% - safe mushroom but better cooked
    ];

    for (item_name, chance_percent, damage_per_tick, duration_seconds, tick_interval_seconds) in food_risks_data {
        // Find the item definition by name
        if let Some(item_def) = item_defs.iter().find(|def| def.name == item_name) {
            let food_risk = crate::active_effects::FoodPoisoningRisk {
                item_def_id: item_def.id,
                poisoning_chance_percent: chance_percent,
                damage_per_tick,
                duration_seconds,
                tick_interval_seconds,
            };

            match food_risks.try_insert(food_risk) {
                Ok(_) => {
                    seeded_count += 1;
                    log::info!("Added food poisoning risk for '{}': {:.1}% chance, {:.1} damage per {:.1}s for {:.1}s", 
                        item_name, chance_percent, damage_per_tick, tick_interval_seconds, duration_seconds);
                }
                Err(e) => log::error!("Failed to insert food poisoning risk for '{}': {}", item_name, e),
            }
        } else {
            log::warn!("Item definition not found for food poisoning risk: '{}'", item_name);
        }
    }

    // === SPOILED ITEMS - Very high poison chance (90%) - all items starting with "Spoiled "
    // Spoiled food is crawling with bacteria; consuming is extremely dangerous
    const SPOILED_POISON_CHANCE: f32 = 90.0;
    const SPOILED_DAMAGE_PER_TICK: f32 = 2.0;
    const SPOILED_DURATION: f32 = 15.0;
    const SPOILED_TICK_INTERVAL: f32 = 1.5;
    for item_def in item_defs.iter() {
        if item_def.name.starts_with("Spoiled ") {
            // Skip if already seeded (e.g. raw human flesh might overlap)
            if food_risks.item_def_id().find(&item_def.id).is_some() {
                continue;
            }
            let food_risk = crate::active_effects::FoodPoisoningRisk {
                item_def_id: item_def.id,
                poisoning_chance_percent: SPOILED_POISON_CHANCE,
                damage_per_tick: SPOILED_DAMAGE_PER_TICK,
                duration_seconds: SPOILED_DURATION,
                tick_interval_seconds: SPOILED_TICK_INTERVAL,
            };
            if let Ok(_) = food_risks.try_insert(food_risk) {
                seeded_count += 1;
                log::info!("Added food poisoning risk for spoiled item '{}': {:.1}% chance", 
                    item_def.name, SPOILED_POISON_CHANCE);
            }
        }
    }

    log::info!("Finished seeding {} food poisoning risks.", seeded_count);
    Ok(())
}

// --- Helper Functions ---

// Helper to get ranged weapon stats by item name
pub(crate) fn get_ranged_weapon_stats(ctx: &ReducerContext, item_name: &str) -> Option<RangedWeaponStats> {
    ctx.db.ranged_weapon_stats().iter().find(|stats| stats.item_name == item_name).map(|stats| stats.clone())
}

// --- Inventory Management Reducers ---

// Helper to find an item instance owned by the caller
pub(crate) fn get_player_item(ctx: &ReducerContext, instance_id: u64) -> Result<InventoryItem, String> {
    ctx.db
        .inventory_item().iter()
        .find(|i| i.instance_id == instance_id && i.location.is_player_bound() == Some(ctx.sender()))
        .ok_or_else(|| format!("Item instance {} not found or not owned by caller.", instance_id))
}

// Helper to find an item occupying a specific inventory slot for the caller
fn find_item_in_inventory_slot(ctx: &ReducerContext, slot: u16) -> Option<InventoryItem> {
    ctx.db
        .inventory_item().iter()
        .find(|i| match &i.location { 
            ItemLocation::Inventory(data) => data.owner_id == ctx.sender() && data.slot_index == slot,
            _ => false,
        })
}

// Helper to find an item occupying a specific hotbar slot for the caller
fn find_item_in_hotbar_slot(ctx: &ReducerContext, slot: u8) -> Option<InventoryItem> {
    ctx.db
        .inventory_item().iter()
        .find(|i| match &i.location { 
            ItemLocation::Hotbar(data) => data.owner_id == ctx.sender() && data.slot_index == slot,
            _ => false,
        })
}

// Helper function to find an empty slot for a player (hotbar preferred, then inventory)
// Returns ItemLocation pointing to the empty slot, or None if all full.
fn find_empty_slot_for_player(
    ctx: &ReducerContext, 
    player_id: Identity,
    // inventory_items: &(impl inventory_item + Table), // Removed direct table pass
) -> Option<ItemLocation> {
    // Check Hotbar first
    let occupied_hotbar_slots: HashSet<u8> = ctx.db.inventory_item().iter() // Use ctx.db directly
        .filter_map(|item| match &item.location { 
            ItemLocation::Hotbar(crate::models::HotbarLocationData { owner_id: item_owner_id, slot_index }) if *item_owner_id == player_id => Some(*slot_index),
            _ => None,
        })
        .collect();

    for i in 0..crate::player_inventory::NUM_PLAYER_HOTBAR_SLOTS {
        if !occupied_hotbar_slots.contains(&i) {
            return Some(ItemLocation::Hotbar(crate::models::HotbarLocationData { owner_id: player_id, slot_index: i }));
        }
    }

    // Then check Inventory
    let occupied_inventory_slots: HashSet<u16> = ctx.db.inventory_item().iter() // Use ctx.db directly
        .filter_map(|item| match &item.location {
            ItemLocation::Inventory(crate::models::InventoryLocationData { owner_id: item_owner_id, slot_index }) if *item_owner_id == player_id => Some(*slot_index),
            _ => None,
        })
        .collect();

    for i in 0..crate::player_inventory::NUM_PLAYER_INVENTORY_SLOTS {
        if !occupied_inventory_slots.contains(&i) {
            return Some(ItemLocation::Inventory(crate::models::InventoryLocationData { owner_id: player_id, slot_index: i }));
        }
    }
    None // No empty slots
}

// Helper to add an item to inventory, prioritizing hotbar for stacking and new slots.
// Called when items are gathered/added directly (e.g., picking mushrooms, gathering resources).
pub(crate) fn add_item_to_player_inventory(ctx: &ReducerContext, player_id: Identity, item_def_id: u64, quantity: u32) -> Result<Option<u64>, String> {
    let inventory = ctx.db.inventory_item();
    let item_defs = ctx.db.item_definition();
    let mut remaining_quantity = quantity;

    let item_def = item_defs.id().find(item_def_id)
        .ok_or_else(|| format!("Item definition {} not found", item_def_id))?;

    if item_def.is_stackable && remaining_quantity > 0 {
        let mut items_to_update: Vec<InventoryItem> = Vec::new();

        for mut item in inventory.iter().filter(|i| 
            match &i.location {
                ItemLocation::Hotbar(data) => data.owner_id == player_id && i.item_def_id == item_def_id,
                _ => false,
            }
        ) {
            let space_available = item_def.stack_size.saturating_sub(item.quantity);
            if space_available > 0 {
                let transfer_qty = std::cmp::min(remaining_quantity, space_available);
                item.quantity += transfer_qty;
                remaining_quantity -= transfer_qty;
                items_to_update.push(item.clone());
                if remaining_quantity == 0 { break; }
            }
        }

        if remaining_quantity > 0 {
            for mut item in inventory.iter().filter(|i| 
                match &i.location {
                    ItemLocation::Inventory(data) => data.owner_id == player_id && i.item_def_id == item_def_id,
                    _ => false,
                }
            ) {
                let space_available = item_def.stack_size.saturating_sub(item.quantity);
                if space_available > 0 {
                    let transfer_qty = std::cmp::min(remaining_quantity, space_available);
                    item.quantity += transfer_qty;
                    remaining_quantity -= transfer_qty;
                    items_to_update.push(item.clone());
                    if remaining_quantity == 0 { break; }
                }
            }
        }
        for item in items_to_update {
             inventory.instance_id().update(item);
        }
        if remaining_quantity == 0 {
            log::info!("[AddItem] Fully stacked {} of item def {} for player {:?}.", quantity, item_def_id, player_id);
            return Ok(None); // Items stacked, no new instance ID
        }
    }

    if remaining_quantity > 0 {
        let final_quantity_to_add = if item_def.is_stackable { remaining_quantity } else { 1 };

        let occupied_hotbar_slots: HashSet<u8> = inventory.iter()
            .filter_map(|i| match &i.location {
                ItemLocation::Hotbar(data) if data.owner_id == player_id => Some(data.slot_index),
                _ => None,
            })
            .collect();

        if let Some(empty_hotbar_slot) = (0..crate::player_inventory::NUM_PLAYER_HOTBAR_SLOTS as u8).find(|slot| !occupied_hotbar_slots.contains(slot)) {
            let new_item = InventoryItem {
                instance_id: 0, 
                item_def_id,
                quantity: final_quantity_to_add,
                location: ItemLocation::Hotbar(crate::models::HotbarLocationData { owner_id: player_id, slot_index: empty_hotbar_slot }),
                item_data: None, // Initialize as empty
            };
            let inserted_item = inventory.insert(new_item);
            log::info!("[AddItem] Added {} of item def {} to hotbar slot {} for player {:?}. New ID: {}",
                     final_quantity_to_add, item_def_id, empty_hotbar_slot, player_id, inserted_item.instance_id);
            return Ok(Some(inserted_item.instance_id));
        } else {
            let occupied_inventory_slots: HashSet<u16> = inventory.iter()
                .filter_map(|i| match &i.location {
                    ItemLocation::Inventory(data) if data.owner_id == player_id => Some(data.slot_index),
                    _ => None,
                })
                .collect();

            if let Some(empty_inventory_slot) = (0..crate::player_inventory::NUM_PLAYER_INVENTORY_SLOTS as u16).find(|slot| !occupied_inventory_slots.contains(slot)) {
                let new_item = InventoryItem {
                    instance_id: 0, 
                    item_def_id,
                    quantity: final_quantity_to_add,
                    location: ItemLocation::Inventory(crate::models::InventoryLocationData { owner_id: player_id, slot_index: empty_inventory_slot }),
                    item_data: None, // Initialize as empty
                };
                let inserted_item = inventory.insert(new_item);
                log::info!("[AddItem] Added {} of item def {} to inventory slot {} for player {:?}. (Hotbar was full) New ID: {}",
                         final_quantity_to_add, item_def_id, empty_inventory_slot, player_id, inserted_item.instance_id);
                return Ok(Some(inserted_item.instance_id));
            } else {
                log::error!("[AddItem] No empty hotbar or inventory slots for player {:?} to add item def {}.", player_id, item_def_id);
                return Err("Inventory is full".to_string());
            }
        }
    } else {
         log::debug!("[AddItem] Stacking completed successfully for item def {} for player {:?}. No new slot needed.", item_def_id, player_id);
         Ok(None) // Stacking completed, no new instance ID
    }
}

/// Similar to add_item_to_player_inventory but preserves item data (like water content)
/// This is used when picking up dropped items that had special data
pub(crate) fn add_item_to_player_inventory_with_data(
    ctx: &ReducerContext, 
    player_id: Identity, 
    item_def_id: u64, 
    quantity: u32, 
    item_data: Option<String>
) -> Result<Option<u64>, String> {
    let inventory = ctx.db.inventory_item();
    let item_defs = ctx.db.item_definition();
    let mut remaining_quantity = quantity;

    let item_def = item_defs.id().find(item_def_id)
        .ok_or_else(|| format!("Item definition {} not found", item_def_id))?;

    // For items with data (like water content), we generally don't want to stack them
    // because each instance might have different data. Only attempt stacking if the item 
    // has no special data or if we find an exact match.
    let can_stack = item_def.is_stackable && item_data.is_none();

    if can_stack && remaining_quantity > 0 {
        let mut items_to_update: Vec<InventoryItem> = Vec::new();

        // Check hotbar first
        for mut item in inventory.iter().filter(|i| 
            match &i.location {
                ItemLocation::Hotbar(data) => data.owner_id == player_id && i.item_def_id == item_def_id && i.item_data.is_none(),
                _ => false,
            }
        ) {
            let space_available = item_def.stack_size.saturating_sub(item.quantity);
            if space_available > 0 {
                let transfer_qty = std::cmp::min(remaining_quantity, space_available);
                item.quantity += transfer_qty;
                remaining_quantity -= transfer_qty;
                items_to_update.push(item.clone());
                if remaining_quantity == 0 { break; }
            }
        }

        // Check inventory if still have remaining quantity
        if remaining_quantity > 0 {
            for mut item in inventory.iter().filter(|i| 
                match &i.location {
                    ItemLocation::Inventory(data) => data.owner_id == player_id && i.item_def_id == item_def_id && i.item_data.is_none(),
                    _ => false,
                }
            ) {
                let space_available = item_def.stack_size.saturating_sub(item.quantity);
                if space_available > 0 {
                    let transfer_qty = std::cmp::min(remaining_quantity, space_available);
                    item.quantity += transfer_qty;
                    remaining_quantity -= transfer_qty;
                    items_to_update.push(item.clone());
                    if remaining_quantity == 0 { break; }
                }
            }
        }

        // Update all the items we modified
        for item in items_to_update {
            inventory.instance_id().update(item);
        }

        if remaining_quantity == 0 {
            log::info!("[AddItemWithData] Fully stacked {} of item def {} for player {:?}.", quantity, item_def_id, player_id);
            return Ok(None); // Items stacked, no new instance ID
        }
    }

    // If we still have remaining quantity, create a new item instance
    if remaining_quantity > 0 {
        let final_quantity_to_add = if item_def.is_stackable { remaining_quantity } else { 1 };

        // Find empty hotbar slot first
        let occupied_hotbar_slots: HashSet<u8> = inventory.iter()
            .filter_map(|i| match &i.location {
                ItemLocation::Hotbar(data) if data.owner_id == player_id => Some(data.slot_index),
                _ => None,
            })
            .collect();

        if let Some(empty_hotbar_slot) = (0..crate::player_inventory::NUM_PLAYER_HOTBAR_SLOTS as u8).find(|slot| !occupied_hotbar_slots.contains(slot)) {
            let new_item = InventoryItem {
                instance_id: 0, 
                item_def_id,
                quantity: final_quantity_to_add,
                location: ItemLocation::Hotbar(crate::models::HotbarLocationData { owner_id: player_id, slot_index: empty_hotbar_slot }),
                item_data: item_data.clone(), // Preserve the item data
            };
            let inserted_item = inventory.insert(new_item);
            log::info!("[AddItemWithData] Added {} of item def {} to hotbar slot {} for player {:?}. New ID: {} (with data: {})",
                     final_quantity_to_add, item_def_id, empty_hotbar_slot, player_id, inserted_item.instance_id, 
                     item_data.is_some());
            return Ok(Some(inserted_item.instance_id));
        } else {
            // Try inventory slot
            let occupied_inventory_slots: HashSet<u16> = inventory.iter()
                .filter_map(|i| match &i.location {
                    ItemLocation::Inventory(data) if data.owner_id == player_id => Some(data.slot_index),
                    _ => None,
                })
                .collect();

            if let Some(empty_inventory_slot) = (0..crate::player_inventory::NUM_PLAYER_INVENTORY_SLOTS as u16).find(|slot| !occupied_inventory_slots.contains(slot)) {
                let new_item = InventoryItem {
                    instance_id: 0, 
                    item_def_id,
                    quantity: final_quantity_to_add,
                    location: ItemLocation::Inventory(crate::models::InventoryLocationData { owner_id: player_id, slot_index: empty_inventory_slot }),
                    item_data: item_data.clone(), // Preserve the item data
                };
                let inserted_item = inventory.insert(new_item);
                log::info!("[AddItemWithData] Added {} of item def {} to inventory slot {} for player {:?}. New ID: {} (with data: {})",
                         final_quantity_to_add, item_def_id, empty_inventory_slot, player_id, inserted_item.instance_id,
                         item_data.is_some());
                return Ok(Some(inserted_item.instance_id));
            } else {
                log::error!("[AddItemWithData] No empty hotbar or inventory slots for player {:?} to add item def {}.", player_id, item_def_id);
                return Err("Inventory is full".to_string());
            }
        }
    } else {
         log::debug!("[AddItemWithData] Stacking completed successfully for item def {} for player {:?}. No new slot needed.", item_def_id, player_id);
         Ok(None) // Stacking completed, no new instance ID
    }
}

// Helper to clear a specific item instance from any equipment slot it might occupy
pub(crate) fn clear_specific_item_from_equipment_slots(ctx: &ReducerContext, player_id: spacetimedb::Identity, item_instance_id_to_clear: u64) {
    let active_equip_table = ctx.db.active_equipment();
    // Use try_find to avoid panic if player has no equipment entry yet
    if let Some(mut equip) = active_equip_table.player_identity().find(player_id) {
        let mut updated = false;

        // DO NOT Check main hand here anymore - this is handled by clear_active_item_reducer
        // if equip.equipped_item_instance_id == Some(item_instance_id_to_clear) {
        //      equip.equipped_item_instance_id = None;
        //      equip.equipped_item_def_id = None;
        //      equip.swing_start_time_ms = 0;
        //      updated = true;
        //      log::debug!("[ClearEquip] Removed item {} from main hand slot for player {:?}", item_instance_id_to_clear, player_id);
        // }
        
        // Check armor slots
        if equip.head_item_instance_id == Some(item_instance_id_to_clear) {
            equip.head_item_instance_id = None;
            updated = true;
            log::debug!("[ClearEquip] Removed item {} from Head slot for player {:?}", item_instance_id_to_clear, player_id);
            
            // When head armor is removed, emerge from snorkeling and turn off headlamp
            let players_table = ctx.db.player();
            if let Some(mut player) = players_table.identity().find(&player_id) {
                let mut player_updated = false;
                
                if player.is_snorkeling {
                    player.is_snorkeling = false;
                    crate::sound_events::emit_snorkel_emerge_sound(ctx, player.position_x, player.position_y, player_id);
                    player_updated = true;
                    log::info!("[ClearEquip] Player {:?} removed head armor while snorkeling - emerging from water.", player_id);
                }
                
                if player.is_headlamp_lit {
                    player.is_headlamp_lit = false;
                    crate::sound_events::emit_extinguish_torch_sound(ctx, player.position_x, player.position_y, player_id);
                    player_updated = true;
                    log::info!("[ClearEquip] Player {:?} removed head armor - extinguishing headlamp.", player_id);
                }
                
                if player_updated {
                    player.last_update = ctx.timestamp;
                    players_table.identity().update(player);
                }
            }
        }
        if equip.chest_item_instance_id == Some(item_instance_id_to_clear) {
            equip.chest_item_instance_id = None;
            updated = true;
            log::debug!("[ClearEquip] Removed item {} from Chest slot for player {:?}", item_instance_id_to_clear, player_id);
        }
        if equip.legs_item_instance_id == Some(item_instance_id_to_clear) {
            equip.legs_item_instance_id = None;
            updated = true;
            log::debug!("[ClearEquip] Removed item {} from Legs slot for player {:?}", item_instance_id_to_clear, player_id);
        }
        if equip.feet_item_instance_id == Some(item_instance_id_to_clear) {
            equip.feet_item_instance_id = None;
            updated = true;
            log::debug!("[ClearEquip] Removed item {} from Feet slot for player {:?}", item_instance_id_to_clear, player_id);
        }
        if equip.hands_item_instance_id == Some(item_instance_id_to_clear) {
            equip.hands_item_instance_id = None;
            updated = true;
            log::debug!("[ClearEquip] Removed item {} from Hands slot for player {:?}", item_instance_id_to_clear, player_id);
        }
        if equip.back_item_instance_id == Some(item_instance_id_to_clear) {
            equip.back_item_instance_id = None;
            updated = true;
            log::debug!("[ClearEquip] Removed item {} from Back slot for player {:?}", item_instance_id_to_clear, player_id);
        }

        if updated {
            active_equip_table.player_identity().update(equip);
        }
    } else {
        // This is not necessarily an error, player might not have equipment entry yet
        log::debug!("[ClearEquip] No ActiveEquipment found for player {:?} when trying to clear item {}.", player_id, item_instance_id_to_clear);
    }
}

/// Clears an item from a specific container when the location is known.
/// O(1) lookup by container ID instead of iterating all instances.
/// Use this when the item's ContainerLocationData is available (e.g. from bones, consumables).
pub(crate) fn clear_item_from_container_by_location(
    ctx: &ReducerContext,
    loc: &ContainerLocationData,
    item_instance_id: u64,
) -> bool {
    let container_id_u32 = loc.container_id as u32;
    let slot_index = loc.slot_index;

    let cleared = match loc.container_type {
        ContainerType::Campfire => {
            if let Some(mut cf) = ctx.db.campfire().id().find(container_id_u32) {
                if cf.get_slot_instance_id(slot_index) == Some(item_instance_id) {
                    cf.set_slot(slot_index, None, None);
                    ctx.db.campfire().id().update(cf);
                    true
                } else {
                    false
                }
            } else {
                false
            }
        }
        ContainerType::Furnace => {
            if let Some(mut f) = ctx.db.furnace().id().find(container_id_u32) {
                if f.get_slot_instance_id(slot_index) == Some(item_instance_id) {
                    f.set_slot(slot_index, None, None);
                    ctx.db.furnace().id().update(f);
                    true
                } else {
                    false
                }
            } else {
                false
            }
        }
        ContainerType::Fumarole => {
            if let Some(mut fu) = ctx.db.fumarole().id().find(container_id_u32) {
                if fu.get_slot_instance_id(slot_index) == Some(item_instance_id) {
                    fu.set_slot(slot_index, None, None);
                    ctx.db.fumarole().id().update(fu);
                    true
                } else {
                    false
                }
            } else {
                false
            }
        }
        ContainerType::WoodenStorageBox => {
            if let Some(mut w) = ctx.db.wooden_storage_box().id().find(container_id_u32) {
                if w.get_slot_instance_id(slot_index) == Some(item_instance_id) {
                    w.set_slot(slot_index, None, None);
                    ctx.db.wooden_storage_box().id().update(w);
                    true
                } else {
                    false
                }
            } else {
                false
            }
        }
        ContainerType::PlayerCorpse => {
            if let Some(mut pc) = ctx.db.player_corpse().id().find(container_id_u32) {
                if pc.get_slot_instance_id(slot_index) == Some(item_instance_id) {
                    pc.set_slot(slot_index, None, None);
                    ctx.db.player_corpse().id().update(pc);
                    true
                } else {
                    false
                }
            } else {
                false
            }
        }
        ContainerType::Stash => {
            if let Some(mut s) = ctx.db.stash().id().find(container_id_u32) {
                if s.get_slot_instance_id(slot_index) == Some(item_instance_id) {
                    s.set_slot(slot_index, None, None);
                    ctx.db.stash().id().update(s);
                    true
                } else {
                    false
                }
            } else {
                false
            }
        }
        ContainerType::RainCollector => {
            if slot_index == 0 {
                if let Some(mut rc) = ctx.db.rain_collector().id().find(container_id_u32) {
                    if rc.slot_0_instance_id == Some(item_instance_id) {
                        rc.slot_0_instance_id = None;
                        rc.slot_0_def_id = None;
                        ctx.db.rain_collector().id().update(rc);
                        true
                    } else {
                        false
                    }
                } else {
                    false
                }
            } else {
                false
            }
        }
        ContainerType::Turret => {
            if slot_index == 0 {
                if let Some(mut t) = ctx.db.turret().id().find(container_id_u32) {
                    if t.ammo_instance_id == Some(item_instance_id) {
                        t.ammo_instance_id = None;
                        t.ammo_def_id = None;
                        ctx.db.turret().id().update(t);
                        true
                    } else {
                        false
                    }
                } else {
                    false
                }
            } else {
                false
            }
        }
        ContainerType::Barbecue => {
            if let Some(mut b) = ctx.db.barbecue().id().find(container_id_u32) {
                if b.get_slot_instance_id(slot_index) == Some(item_instance_id) {
                    b.set_slot(slot_index, None, None);
                    ctx.db.barbecue().id().update(b);
                    true
                } else {
                    false
                }
            } else {
                false
            }
        }
        ContainerType::Lantern => {
            if let Some(mut l) = ctx.db.lantern().id().find(container_id_u32) {
                if l.get_slot_instance_id(slot_index) == Some(item_instance_id) {
                    l.set_slot(slot_index, None, None);
                    ctx.db.lantern().id().update(l);
                    true
                } else {
                    false
                }
            } else {
                false
            }
        }
        ContainerType::BrothPot => {
            if let Some(mut bp) = ctx.db.broth_pot().id().find(container_id_u32) {
                if bp.get_slot_instance_id(slot_index) == Some(item_instance_id) {
                    bp.set_slot(slot_index, None, None);
                    ctx.db.broth_pot().id().update(bp);
                    true
                } else {
                    false
                }
            } else {
                false
            }
        }
        ContainerType::HomesteadHearth => {
            if let Some(mut h) = ctx.db.homestead_hearth().id().find(container_id_u32) {
                if h.get_slot_instance_id(slot_index) == Some(item_instance_id) {
                    h.set_slot(slot_index, None, None);
                    ctx.db.homestead_hearth().id().update(h);
                    true
                } else {
                    false
                }
            } else {
                false
            }
        }
    };

    if cleared {
        log::debug!("[ItemsClear] Item {} cleared from container {:?} (optimized path).", item_instance_id, loc.container_type);
    }
    cleared
}

// Clears an item from any known container type that might hold it.
// This is a broader cleanup function, typically called when an item is being
// definitively removed from the game or its location becomes truly unknown.
// Use clear_item_from_container_by_location when the item's ContainerLocationData is available.
pub(crate) fn clear_item_from_any_container(ctx: &ReducerContext, item_instance_id: u64) {
    // Attempt to clear from Campfire fuel slots
    if CampfireClearer::clear_item(ctx, item_instance_id) {
        log::debug!("[ItemsClear] Item {} cleared from a campfire.", item_instance_id);
        return; // Item found and handled
    }

    // Attempt to clear from Fumarole slots
    if FumaroleClearer::clear_item(ctx, item_instance_id) {
        log::debug!("[ItemsClear] Item {} cleared from a fumarole.", item_instance_id);
        return; // Item found and handled
    }

    // Attempt to clear from WoodenStorageBox slots
    if WoodenStorageBoxClearer::clear_item(ctx, item_instance_id) {
        log::debug!("[ItemsClear] Item {} cleared from a wooden storage box.", item_instance_id);
        return; // Item found and handled
    }

    // Attempt to clear from PlayerCorpse slots
    if PlayerCorpseClearer::clear_item(ctx, item_instance_id) {
        log::debug!("[ItemsClear] Item {} cleared from a player corpse.", item_instance_id);
        return; // Item found and handled
    }
    
    // Attempt to clear from Stash slots
    if StashClearer::clear_item(ctx, item_instance_id) {
        log::debug!("[ItemsClear] Item {} cleared from a stash.", item_instance_id);
        return; // Item found and handled
    }

    // Attempt to clear from RainCollector slots
    if RainCollectorClearer::clear_item(ctx, item_instance_id) {
        log::debug!("[ItemsClear] Item {} cleared from a rain collector.", item_instance_id);
        return; // Item found and handled
    }

    // Attempt to clear from Turret ammo slots
    if TurretClearer::clear_item(ctx, item_instance_id) {
        log::debug!("[ItemsClear] Item {} cleared from a turret.", item_instance_id);
        return; // Item found and handled
    }

    // Attempt to clear from Furnace slots
    if FurnaceClearer::clear_item(ctx, item_instance_id) {
        log::debug!("[ItemsClear] Item {} cleared from a furnace.", item_instance_id);
        return;
    }

    // Attempt to clear from Barbecue slots
    if BarbecueClearer::clear_item(ctx, item_instance_id) {
        log::debug!("[ItemsClear] Item {} cleared from a barbecue.", item_instance_id);
        return;
    }

    // Attempt to clear from Lantern slots
    if LanternClearer::clear_item(ctx, item_instance_id) {
        log::debug!("[ItemsClear] Item {} cleared from a lantern.", item_instance_id);
        return;
    }

    // Attempt to clear from BrothPot slots
    if BrothPotClearer::clear_item(ctx, item_instance_id) {
        log::debug!("[ItemsClear] Item {} cleared from a broth pot.", item_instance_id);
        return;
    }

    // If we reach here, the item was not found in any of the explicitly checked containers.
    // The item's own `location` field might be stale or point to a player inventory/hotbar/equipment,
    // which this function is not designed to clear directly.
    log::debug!("[ItemsClear] Item {} was not found in any known clearable container types by clear_item_from_any_container.", item_instance_id);
}

// Clears an item from equipment OR container slots based on its state
// This should be called *before* modifying or deleting the InventoryItem itself.
fn clear_item_from_source_location(ctx: &ReducerContext, item_instance_id: u64) -> Result<(), String> {
    let sender_id = ctx.sender();
    let item_opt = ctx.db.inventory_item().instance_id().find(item_instance_id);
    if item_opt.is_none() {
        log::debug!("[ClearSource] Item {} already gone. No clearing needed.", item_instance_id);
        return Ok(());
    }
    let item = item_opt.unwrap();
    let was_equipped = matches!(&item.location, ItemLocation::Equipped(_)); 
    let was_in_container = matches!(&item.location, ItemLocation::Container(_));

    if was_equipped {
        clear_specific_item_from_equipment_slots(ctx, sender_id, item_instance_id);
        log::debug!("[ClearSource] Attempted clearing item {} from equipment slots for player {:?}", item_instance_id, sender_id);
    } else if let ItemLocation::Container(ref loc) = &item.location {
        if !clear_item_from_container_by_location(ctx, loc, item_instance_id) {
            clear_item_from_any_container(ctx, item_instance_id);
        }
        log::debug!("[ClearSource] Attempted clearing item {} from container slots.", item_instance_id);
    } else {
        log::debug!("[ClearSource] Item {} was in player inventory/hotbar. No equipment/container clearing needed.", item_instance_id);
    }

    Ok(())
}

// Reducer to equip armor from a drag-and-drop operation
#[spacetimedb::reducer]
pub fn equip_armor_from_drag(ctx: &ReducerContext, item_instance_id: u64, target_slot_name: String) -> Result<(), String> {
    log::info!("[EquipArmorDrag] Attempting to equip item {} to slot {}", item_instance_id, target_slot_name);
    let sender_id = ctx.sender(); // Get sender early
    let inventory_items = ctx.db.inventory_item(); // Need table access

    // 1. Get Item and Definition (Fetch directly, don't assume player ownership yet)
    let mut item_to_equip = inventory_items.instance_id().find(item_instance_id)
        .ok_or_else(|| format!("Item instance {} not found.", item_instance_id))?;
    let item_def = ctx.db.item_definition().id().find(item_to_equip.item_def_id)
        .ok_or_else(|| format!("Definition not found for item ID {}", item_to_equip.item_def_id))?;

    // --- Store original location type --- 
    let original_location = item_to_equip.location.clone(); // Clone to avoid borrow issues
    let came_from_player_direct_possession = matches!(&original_location, ItemLocation::Inventory(_) | ItemLocation::Hotbar(_));

    // --- Validations --- 
    // Basic ownership check: Player must own it if it came from inv/hotbar
    if came_from_player_direct_possession {
        if item_to_equip.location.is_player_bound() != Some(sender_id) {
             return Err(format!("Item {} in inventory/hotbar not owned by caller.", item_instance_id));
        }
    }
    // 1. Must be Armor category
    if item_def.category != ItemCategory::Armor {
        return Err(format!("Item '{}' is not armor.", item_def.name));
    }
    // 2. Must have a defined equipment slot
    let required_slot_enum = item_def.equipment_slot_type.ok_or_else(|| format!("Armor '{}' has no defined equipment slot in its definition.", item_def.name))?;
    // 3. Target slot name must match the item's defined equipment slot
    let target_slot_enum_model = match target_slot_name.as_str() {
        "Head" => EquipmentSlotType::Head,
        "Chest" => EquipmentSlotType::Chest,
        "Legs" => EquipmentSlotType::Legs,
        "Feet" => EquipmentSlotType::Feet,
        "Hands" => EquipmentSlotType::Hands,
        "Back" => EquipmentSlotType::Back,
        _ => return Err(format!("Invalid target equipment slot name: {}", target_slot_name)),
    };
    if required_slot_enum != target_slot_enum_model {
        return Err(format!("Cannot equip '{}' ({:?}) into {} slot ({:?}).", item_def.name, required_slot_enum, target_slot_name, target_slot_enum_model));
    }

    // --- Logic ---
    let active_equip_table = ctx.db.active_equipment();
    let mut equip = active_equip_table.player_identity().find(sender_id)
                     .ok_or_else(|| "ActiveEquipment entry not found for player.".to_string())?;

    // Check if something is already in the target slot and unequip it
    let current_item_in_slot: Option<u64> = match target_slot_enum_model {
        EquipmentSlotType::Head => equip.head_item_instance_id,
        EquipmentSlotType::Chest => equip.chest_item_instance_id,
        EquipmentSlotType::Legs => equip.legs_item_instance_id,
        EquipmentSlotType::Feet => equip.feet_item_instance_id,
        EquipmentSlotType::Hands => equip.hands_item_instance_id,
        EquipmentSlotType::Back => equip.back_item_instance_id,
    };

    if let Some(currently_equipped_id) = current_item_in_slot {
        if currently_equipped_id == item_instance_id { return Ok(()); } // Already equipped

        log::info!("[EquipArmorDrag] Unequipping item {} from slot {:?}", currently_equipped_id, target_slot_enum_model);
        // Try to move the currently equipped item to the first available inventory slot
        match find_first_empty_inventory_slot(ctx, sender_id) {
            Some(empty_slot_idx) => {
                if let Ok(mut currently_equipped_item_row) = get_player_item(ctx, currently_equipped_id) {
                    currently_equipped_item_row.location = ItemLocation::Inventory(crate::models::InventoryLocationData { owner_id: sender_id, slot_index: empty_slot_idx });
                    ctx.db.inventory_item().instance_id().update(currently_equipped_item_row);
                    log::info!("[EquipArmorDrag] Moved previously equipped item {} to inventory slot {}", currently_equipped_id, empty_slot_idx);
                } else {
                    log::error!("[EquipArmorDrag] Failed to find InventoryItem for previously equipped item {}!", currently_equipped_id);
                    // Continue anyway, clearing the slot, but log the error
                }
            }
            None => {
                log::error!("[EquipArmorDrag] Inventory full! Cannot unequip item {} from slot {:?}. Aborting equip.", currently_equipped_id, target_slot_enum_model);
                return Err("Inventory full, cannot unequip existing item.".to_string());
            }
        }
    }

    // Equip the new item
    log::info!("[EquipArmorDrag] Equipping item {} to slot {:?}", item_instance_id, target_slot_enum_model);
    let equipment_slot_type_for_location = target_slot_enum_model;

    match target_slot_enum_model {
        EquipmentSlotType::Head => equip.head_item_instance_id = Some(item_instance_id),
        EquipmentSlotType::Chest => equip.chest_item_instance_id = Some(item_instance_id),
        EquipmentSlotType::Legs => equip.legs_item_instance_id = Some(item_instance_id),
        EquipmentSlotType::Feet => equip.feet_item_instance_id = Some(item_instance_id),
        EquipmentSlotType::Hands => equip.hands_item_instance_id = Some(item_instance_id),
        EquipmentSlotType::Back => equip.back_item_instance_id = Some(item_instance_id),
    };

    // Update ActiveEquipment table
    active_equip_table.player_identity().update(equip);

    // Update the InventoryItem's location
    item_to_equip.location = ItemLocation::Equipped(crate::models::EquippedLocationData { owner_id: sender_id, slot_type: equipment_slot_type_for_location });
    inventory_items.instance_id().update(item_to_equip.clone()); // Update the item itself

    // Clear from original container if it wasn't in player direct possession
    if !came_from_player_direct_possession {
        log::debug!("[EquipArmorDrag] Item {} came from container/other. Clearing containers.", item_instance_id);
        if let ItemLocation::Container(ref loc) = &original_location {
            if !clear_item_from_container_by_location(ctx, loc, item_instance_id) {
                clear_item_from_any_container(ctx, item_instance_id);
            }
        } else {
            clear_item_from_any_container(ctx, item_instance_id);
        }
        // Ownership was implicitly handled by setting ItemLocation::Equipped above.
    }

    Ok(())
}

// Calculates the result of merging source onto target
// Returns: (qty_to_transfer, source_new_qty, target_new_qty, delete_source)
pub(crate) fn calculate_merge_result(
    source_item: &InventoryItem,
    target_item: &InventoryItem, 
    item_def: &ItemDefinition
) -> Result<(u32, u32, u32, bool), String> {
    if !item_def.is_stackable || source_item.item_def_id != target_item.item_def_id {
        return Err("Items cannot be merged".to_string());
    }

    let space_available = item_def.stack_size.saturating_sub(target_item.quantity);
    if space_available == 0 {
        return Err("Target stack is full".to_string()); // Or handle as a swap later
    }

    let qty_to_transfer = std::cmp::min(source_item.quantity, space_available);
    let source_new_qty = source_item.quantity - qty_to_transfer;
    let target_new_qty = target_item.quantity + qty_to_transfer;
    let delete_source = source_new_qty == 0;

    Ok((qty_to_transfer, source_new_qty, target_new_qty, delete_source))
}

// Renamed helper function
pub(crate) fn split_stack_helper(
    ctx: &ReducerContext,
    source_item: &mut InventoryItem, // Takes mutable reference to modify quantity
    quantity_to_split: u32,
    initial_location_for_new_item: ItemLocation // Explicitly pass the initial location for the new stack
) -> Result<u64, String> {
    // Validations already done in reducers calling this, but sanity check:
    if quantity_to_split == 0 || quantity_to_split >= source_item.quantity {
        return Err("Invalid split quantity".to_string());
    }

    // Decrease quantity of the source item
    source_item.quantity -= quantity_to_split;
    // Update source item in DB *before* creating new one
    ctx.db.inventory_item().instance_id().update(source_item.clone()); 

    // Create the new item stack with the split quantity
    let new_item = InventoryItem {
        instance_id: 0, // Will be auto-generated
        item_def_id: source_item.item_def_id,
        quantity: quantity_to_split,
        location: initial_location_for_new_item.clone(), // Set by caller, clone for logging
        item_data: source_item.item_data.clone(), // Copy item data from source
    };
    let inserted_item = ctx.db.inventory_item().insert(new_item);
    let new_instance_id = inserted_item.instance_id;

    log::info!(
        "[SplitStack Helper] Split {} from item {}. New stack ID: {}. Original stack qty: {}. New item location: {:?}",
        quantity_to_split, source_item.instance_id, new_instance_id, source_item.quantity, initial_location_for_new_item
    );

    Ok(new_instance_id)
}

// --- NEW: Drop Item into the World ---
#[spacetimedb::reducer]
pub fn drop_item(
    ctx: &ReducerContext,
    item_instance_id: u64,
    quantity_to_drop: u32, // How many to drop (can be less than total stack)
) -> Result<(), String> {
    let sender_id = ctx.sender();
    log::info!("[DropItem] Player {:?} attempting to drop {} of item instance {}", sender_id, quantity_to_drop, item_instance_id);

    let inventory_items = ctx.db.inventory_item();
    let item_defs = ctx.db.item_definition();
    let players = ctx.db.player();
    let active_equip_table_opt = ctx.db.active_equipment().player_identity().find(sender_id);

    // --- 1. Find Player ---
    let player = players.identity().find(sender_id)
        .ok_or_else(|| "Player not found.".to_string())?;

    // --- 2. Find Item & Validate ---
    let mut item_to_drop = inventory_items.instance_id().find(item_instance_id)
        .ok_or_else(|| format!("Item instance {} not found.", item_instance_id))?;
    
    // Clone the original location *before* any modifications to item_to_drop for partial drops.
    let original_location_of_item = item_to_drop.location.clone();

    // --- 2. Validate Item Ownership and Location ---
    match &item_to_drop.location {
        ItemLocation::Inventory(crate::models::InventoryLocationData { owner_id, .. }) |
        ItemLocation::Hotbar(crate::models::HotbarLocationData { owner_id, .. }) => {
            if *owner_id != sender_id {
                return Err(format!("Item instance {} in inv/hotbar not owned by caller.", item_instance_id));
            }
        }
        ItemLocation::Equipped(crate::models::EquippedLocationData { owner_id, slot_type }) => { 
            if *owner_id != sender_id {
                return Err(format!("Equipped item instance {} not owned by caller.", item_instance_id));
            }
            if quantity_to_drop >= item_to_drop.quantity { 
                clear_specific_item_from_equipment_slots(ctx, sender_id, item_instance_id); 
                log::info!("[DropItem] Dropping full stack of equipped armor {:?}. Slot cleared.", slot_type);
            }
        }
        _ => return Err(format!("Cannot drop item {} from its current location: {:?}. Must be in inventory, hotbar, or equipped.", item_instance_id, item_to_drop.location)),
    }

    // Validate quantity
    if quantity_to_drop == 0 {
        return Err("Cannot drop a quantity of 0.".to_string());
    }
    if quantity_to_drop > item_to_drop.quantity {
        return Err(format!("Cannot drop {} items, only {} available in stack.", quantity_to_drop, item_to_drop.quantity));
    }

    // --- 3. Get Item Definition ---
    let item_def = item_defs.id().find(item_to_drop.item_def_id)
        .ok_or_else(|| format!("Definition missing for item {}", item_to_drop.item_def_id))?;

    // --- 4. Check if dropped item was the ACTIVE tool/weapon and clear active status (only if dropping entire stack) ---
    if quantity_to_drop >= item_to_drop.quantity { // Only if entire stack is dropped
        if let Some(active_equip) = active_equip_table_opt.as_ref() { 
            if active_equip.equipped_item_instance_id == Some(item_instance_id) {
                match crate::active_equipment::clear_active_item_reducer(ctx, sender_id) {
                    Ok(_) => {
                        log::info!("[DropItem] Dropped item {} was the active item. Cleared from ActiveEquipment.", item_instance_id);
                    }
                    Err(e) => {
                        log::error!("[DropItem] Failed to clear active item {} during drop: {}. Proceeding with drop.", item_instance_id, e);
                    }
                }
            }
        }
    }

    // --- 5. Store item data before potential modification/move ---
    let item_data_to_preserve = item_to_drop.item_data.clone();

    // --- 6. Handle Quantity & Potential Splitting ---
    if quantity_to_drop == item_to_drop.quantity {
        // Dropping the entire stack
        log::info!("[DropItem] Dropping entire stack (ID: {}, Qty: {}). Deleting original InventoryItem.", item_instance_id, quantity_to_drop);
        
        clear_item_from_source_location(ctx, item_instance_id)?;
        inventory_items.instance_id().delete(item_instance_id);
    } else {
        // Dropping part of the stack
        if !item_def.is_stackable {
            return Err(format!("Cannot drop partial quantity of non-stackable item '{}'.", item_def.name));
        }
        
        log::info!("[DropItem] Dropping partial stack (ID: {}, QtyDrop: {}). Reducing original quantity.", item_instance_id, quantity_to_drop);
        item_to_drop.quantity -= quantity_to_drop;
        
        inventory_items.instance_id().update(item_to_drop);
    }

    // --- 7. Calculate Drop Position ---
    let (drop_x, drop_y) = calculate_drop_position(&player);
    log::debug!("[DropItem] Calculated drop position: ({:.1}, {:.1}) for player {:?}", drop_x, drop_y, sender_id);

    // --- 8. Create Dropped Item Entity in World (preserving item data) ---
    create_dropped_item_entity_with_data(ctx, item_def.id, quantity_to_drop, drop_x, drop_y, item_data_to_preserve)?;

    log::info!("[DropItem] Successfully dropped {} of item def {} (Original ID: {}) at ({:.1}, {:.1}) for player {:?}.",
            quantity_to_drop, item_def.id, item_instance_id, drop_x, drop_y, sender_id);

    Ok(())
}

// --- NEW: Reducer to equip armor directly from inventory/hotbar ---
#[spacetimedb::reducer]
pub fn equip_armor_from_inventory(ctx: &ReducerContext, item_instance_id: u64) -> Result<(), String> {
    let sender_id = ctx.sender();
    log::info!("[EquipArmorInv] Player {:?} attempting to equip item {} from inventory/hotbar.", sender_id, item_instance_id);

    // 1. Get Item and Definition
    // MODIFIED: Fetch item directly without get_player_item's strict ownership check first.
    let mut item_to_equip = ctx.db.inventory_item().instance_id().find(item_instance_id)
        .ok_or_else(|| format!("Item instance {} not found.", item_instance_id))?;
    
    let item_def = ctx.db.item_definition().id().find(item_to_equip.item_def_id)
        .ok_or_else(|| format!("Definition not found for item ID {}", item_to_equip.item_def_id))?;

    // 2. Validate Item Type and Location
    if item_def.category != ItemCategory::Armor {
        return Err(format!("Item '{}' is not armor.", item_def.name));
    }
    let target_slot_enum_model = item_def.equipment_slot_type
        .ok_or_else(|| format!("Armor '{}' has no defined equipment slot.", item_def.name))?;
    
    // MODIFIED: Allow Inventory, Hotbar, or Unknown. Ownership is asserted by sender equipping.
    match &item_to_equip.location {
        ItemLocation::Inventory(data) => {
            // Log if owner_id in location data doesn't match sender, but proceed.
            if data.owner_id != sender_id {
                log::warn!("[EquipArmorInv] Item {} in Inventory slot owned by {:?}, but being equipped by {:?}. Proceeding with equip.", 
                         item_instance_id, data.owner_id, sender_id);
            } else {
                log::debug!("[EquipArmorInv] Item {} found in Inventory ({:?}), proceeding to equip for player {:?}.", 
                         item_instance_id, item_to_equip.location, sender_id);
            }
        }
        ItemLocation::Hotbar(data) => {
            if data.owner_id != sender_id {
                log::warn!("[EquipArmorInv] Item {} in Hotbar slot owned by {:?}, but being equipped by {:?}. Proceeding with equip.", 
                         item_instance_id, data.owner_id, sender_id);
            } else {
                log::debug!("[EquipArmorInv] Item {} found in Hotbar ({:?}), proceeding to equip for player {:?}.", 
                         item_instance_id, item_to_equip.location, sender_id);
            }
        }
        ItemLocation::Unknown => {
            log::warn!("[EquipArmorInv] Equipping item {} which has an ItemLocation::Unknown for player {:?}. The item will be claimed and its location updated to Equipped.", 
                     item_instance_id, sender_id);
        }
        _ => {
            log::warn!("[EquipArmorInv] Item {} cannot be equipped directly from its current location: {:?}. It must be in Inventory, Hotbar, or be in an Unknown state.", 
                     item_instance_id, item_to_equip.location);
            return Err(format!("Item cannot be equipped from its current location ({:?}).", item_to_equip.location));
        }
    }

    // 3. Get ActiveEquipment and Handle Unequipping Existing Item
    let active_equip_table = ctx.db.active_equipment();
    let mut equip = match active_equip_table.player_identity().find(sender_id) {
        Some(existing_equip) => existing_equip, // Found it
        None => { // Not found, create it
            log::info!("[EquipArmorInv] ActiveEquipment not found for player {:?}. Creating new entry.", sender_id);
            let new_equip_entry = crate::active_equipment::ActiveEquipment {
                player_identity: sender_id,
                ..Default::default()
            };
            active_equip_table.insert(new_equip_entry.clone());
            new_equip_entry // Use the newly created entry
        }
    };

    let mut previously_equipped_item_id: Option<u64> = None;

    match target_slot_enum_model {
        EquipmentSlotType::Head => previously_equipped_item_id = equip.head_item_instance_id.replace(item_instance_id),
        EquipmentSlotType::Chest => previously_equipped_item_id = equip.chest_item_instance_id.replace(item_instance_id),
        EquipmentSlotType::Legs => previously_equipped_item_id = equip.legs_item_instance_id.replace(item_instance_id),
        EquipmentSlotType::Feet => previously_equipped_item_id = equip.feet_item_instance_id.replace(item_instance_id),
        EquipmentSlotType::Hands => previously_equipped_item_id = equip.hands_item_instance_id.replace(item_instance_id),
        EquipmentSlotType::Back => previously_equipped_item_id = equip.back_item_instance_id.replace(item_instance_id),
    }

    if let Some(old_item_id) = previously_equipped_item_id {
        if old_item_id != item_instance_id { // Ensure it's not the same item being "swapped" with itself
            if let Some(mut old_item) = ctx.db.inventory_item().instance_id().find(old_item_id) {
                // Move old item to first available inventory/hotbar slot
                match crate::player_inventory::find_first_empty_player_slot(ctx, sender_id) {
                    Some(empty_slot_location) => {
                        old_item.location = empty_slot_location;
                        ctx.db.inventory_item().instance_id().update(old_item);
                        log::info!("[EquipArmorInv] Moved previously equipped armor {} to player slot {:?}.", old_item_id, item_to_equip.location);
                    }
                    None => {
                        // No space, try to drop it near the player. This is a last resort.
                        log::warn!("[EquipArmorInv] No space in inventory to unequip previous armor {}. Attempting to drop.", old_item_id);
                        if let Some(player_for_drop) = ctx.db.player().identity().find(&sender_id) {
                            let (drop_x, drop_y) = crate::dropped_item::calculate_drop_position(&player_for_drop);
                            if crate::dropped_item::create_dropped_item_entity(ctx, old_item.item_def_id, old_item.quantity, drop_x, drop_y).is_err() {
                                log::error!("[EquipArmorInv] Failed to drop previously equipped item {} after inventory was full.", old_item_id);
                                // Potentially revert the equip operation if dropping the old item is critical and fails.
                                // For now, we'll proceed with the new equip, the old item might be lost if drop failed.
                            } else {
                                // If successfully dropped, we also need to delete its InventoryItem record
                                ctx.db.inventory_item().instance_id().delete(old_item_id);
                            }
                        } else {
                            log::error!("[EquipArmorInv] Player not found for dropping previously equipped item {}. Item may be lost.", old_item_id);
                        }
                    }
                }
            } else {
                log::warn!("[EquipArmorInv] Could not find InventoryItem for previously equipped armor ID {}. Slot was cleared.", old_item_id);
            }
        }
    }
    
    active_equip_table.player_identity().update(equip);

    // 4. Update the newly equipped item's location
    item_to_equip.location = ItemLocation::Equipped(crate::models::EquippedLocationData { owner_id: sender_id, slot_type: target_slot_enum_model.clone() });
    ctx.db.inventory_item().instance_id().update(item_to_equip);

    log::info!("[EquipArmorInv] Player {:?} successfully equipped armor '{}' (Instance ID: {}) to slot {:?}.", sender_id, item_def.name, item_instance_id, target_slot_enum_model);
    Ok(())
}

// NOTE: init_ranged_weapon_stats was REMOVED - use seed_ranged_weapon_stats() instead
// which is called during module initialization and supports hot-updating stats on redeploy

// --- Helper functions for item data management ---

/// Get the maximum water capacity (in liters) for a water container item definition.
/// Returns Some(capacity) if the item is a portable water container, None otherwise.
/// 
/// This function identifies portable water containers by checking if an item instance
/// has `water_liters` in its `item_data`. This is the definitive property-based check:
/// if an item has been used as a water container (has water_liters), it IS a water container.
/// 
/// The presence of `water_liters` in `item_data` is the definitive property that makes
/// something a portable water container - no name or description checking needed.
/// 
/// For items that haven't been used yet, pass None for item_instance and this will return None.
/// Once an item is filled with water, it will be automatically detected.
pub fn get_water_container_capacity(item_def: &ItemDefinition, item_instance: Option<&InventoryItem>) -> Option<f32> {
    // Check if this item instance has water_liters in its item_data
    // This is the definitive property-based check - if it has water_liters, it's a water container
    if let Some(item) = item_instance {
        if let Some(_current_water) = get_water_content(item) {
            // Item has been used as a water container, so it IS a water container
            // Try to extract capacity from description for max capacity
            let desc_lower = item_def.description.to_lowercase();
            if let Some(capacity_pos) = desc_lower.find("capacity:") {
                let after_capacity = &desc_lower[capacity_pos + "capacity:".len()..];
                let capacity_str: String = after_capacity
                    .chars()
                    .skip_while(|c| c.is_whitespace())
                    .take_while(|c| c.is_ascii_digit() || *c == '.')
                    .collect();
                
                if let Ok(capacity) = capacity_str.parse::<f32>() {
                    return Some(capacity);
                }
            }
            // If we can't parse capacity but item has water_liters, it's still a water container
            // Return a reasonable default capacity
            return Some(5.0); // Default capacity for containers without parsed capacity
        }
    }
    
    None
}

/// Get water content from a water container item
pub fn get_water_content(item: &InventoryItem) -> Option<f32> {
    if let Some(data_str) = &item.item_data {
        // Try to parse JSON
        if let Ok(json_value) = serde_json::from_str::<serde_json::Value>(data_str) {
            if let Some(water_liters) = json_value.get("water_liters") {
                return water_liters.as_f64().map(|v| v as f32);
            }
        }
    }
    None
}

/// Check if water in container is salt water
pub fn is_salt_water(item: &InventoryItem) -> bool {
    if let Some(data_str) = &item.item_data {
        if let Ok(json_value) = serde_json::from_str::<serde_json::Value>(data_str) {
            if let Some(is_salt) = json_value.get("is_salt_water") {
                return is_salt.as_bool().unwrap_or(false);
            }
        }
    }
    false // Default to fresh water if not specified
}

/// Set water content for a water container item
/// If is_salt_water is true, marks the water as salt water
/// If container already has fresh water, it will be converted to salt water
pub fn set_water_content(item: &mut InventoryItem, water_liters: f32) -> Result<(), String> {
    let data = serde_json::json!({
        "water_liters": water_liters
    });
    item.item_data = Some(data.to_string());
    Ok(())
}

/// Set water content with salt water flag
pub fn set_water_content_with_salt(item: &mut InventoryItem, water_liters: f32, is_salt_water: bool) -> Result<(), String> {
    let data = serde_json::json!({
        "water_liters": water_liters,
        "is_salt_water": is_salt_water
    });
    item.item_data = Some(data.to_string());
    Ok(())
}

/// Add water to container, preserving salt water status if adding salt water
/// If adding salt water to container with fresh water, converts all to salt
pub fn add_water_to_container(item: &mut InventoryItem, water_liters: f32, is_salt_water_param: bool) -> Result<(), String> {
    let current_water = get_water_content(item).unwrap_or(0.0);
    let current_is_salt = is_salt_water(item);
    
    // If adding salt water, or container already has salt water, mark as salt
    let final_is_salt = is_salt_water_param || current_is_salt;
    let new_water = current_water + water_liters;
    
    set_water_content_with_salt(item, new_water, final_is_salt)
}

/// Remove water content from a water container (make it empty)
pub fn clear_water_content(item: &mut InventoryItem) {
    item.item_data = None;
} 