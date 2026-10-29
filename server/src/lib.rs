use spacetimedb::{Identity, Timestamp, ReducerContext, Table, ConnectionId};
use rand::Rng; // Add Rng trait for ctx.rng().gen()
use log;
use std::time::Duration;
use crate::environment::calculate_chunk_index; // Make sure this helper is available
use crate::environment::WORLD_WIDTH_CHUNKS; // Import chunk constant for optimization
use crate::models::{ContainerType, ItemLocation}; // Ensure ItemLocation and ContainerType are in scope

// ============================================================================
// SCHEDULE INITIALIZATION MACRO WITH RETRY LOGIC
// ============================================================================
// Macro to safely insert schedules with proper error handling and retries
// This prevents silent failures that can break game systems
// Retries up to 3 times before giving up
// NOTE: On failure, logs error but DOES NOT crash the server - the system
// will just be disabled until the next server restart or manual fix
#[macro_export]
macro_rules! try_insert_schedule {
    ($table:expr, $schedule:expr, $system_name:expr) => {{
        let mut last_error = String::new();
        let mut success = false;
        
        // Try up to 3 times
        for attempt in 1..=3 {
            // We can't clone the schedule, so we only get one real attempt
            // The retry logic is here for future enhancement if needed
            if attempt > 1 {
                // Can't retry without clone - just log and break
                log::error!("Cannot retry schedule insertion without Clone trait");
                break;
            }
            
            match $table.try_insert($schedule) {
                Ok(_) => {
                    log::info!("{} schedule initialized successfully", $system_name);
                    success = true;
                    break;
                }
                Err(e) => {
                    last_error = format!("{}", e);
                    log::error!("⚠️ CRITICAL: Failed to initialize {} schedule: {}", $system_name, e);
                    log::error!("⚠️ {} system will be DISABLED until server restart or manual fix!", $system_name);
                    log::error!("⚠️ This is likely due to database corruption or a constraint violation.");
                }
            }
        }
        
        // Don't crash the server - just log the error and continue
        // The specific system will be disabled but other systems will work
        if !success {
            log::error!("⚠️ Continuing server startup with {} system DISABLED", $system_name);
        }
    }};
}

// Declare the module
mod shared_config;
#[allow(dead_code)]
mod collision_geometry;
mod environment;
mod tree; // Add tree module
mod stone; // Add stone module
// Declare the items module
mod items;
// Declare the world_state module
mod world_state;
// Declare the campfire module
mod campfire;
// Declare the furnace module
mod furnace;
// Declare the lantern module
mod lantern;
// Declare the active_equipment module
mod active_equipment;
// Declare the player_inventory module
mod player_inventory;
// Declare the consumables module
mod consumables;
mod utils; // Declare utils module
mod dropped_item; // Declare dropped_item module
mod wooden_storage_box; // Add the new module
mod refrigerator; // Refrigerator-specific container logic
mod compost; // Compost-specific container logic
mod tanning_rack; // Tanning rack: hide + bark -> leather over time
mod fish_trap; // Fish trap-specific container logic (passive fishing)
mod beehive; // Player beehive - honeycomb production system
mod backpack; // Backpack auto-consolidation system

mod items_database; // <<< NEW: Modular items database
mod starting_items; // <<< ADDED module declaration
mod inventory_management; // <<< ADDED new module
mod container_access; // Validates player access to items in external containers
mod spatial_grid; // ADD: Spatial grid module for optimized collision detection
mod crafting; // ADD: Crafting recipe definitions
mod crafting_queue; // ADD: Crafting queue logic
mod player_stats; // ADD: Player stat scheduling logic
mod global_tick; // ADD: Global tick scheduling logic
mod chat; // ADD: Chat module for message handling
mod player_pin; // ADD: Player pin module for minimap
pub mod combat; // Add the new combat module
mod repair; // ADD: Repair module for structure repair functionality
mod collectible_resources; // Add the new collectible resources system
mod plants_database; // NEW: Plant configuration database
mod harvestable_resource; // NEW: Unified harvestable resource system
mod coral; // Living Coral resource system (underwater harvestable corals)
mod storm_debris; // Storm debris spawning on beaches (seaweed, shells, driftwood, etc.)
mod sleeping_bag; // ADD Sleeping Bag module
mod player_corpse; // <<< ADDED: Declare Player Corpse module
mod models; // <<< ADDED
mod cooking; // <<< ADDED: For generic cooking logic
mod combat_ladle_heating; // Combat ladle heating in fire sources
mod stash; // Added Stash module
mod planted_seeds; // Added for farming system with planted seeds
pub mod active_effects; // Added for timed consumable effects
mod cloud; // Add the new cloud module
mod armor; // <<< ADDED armor module
mod grass; // <<< ADDED grass module
mod player_movement; // <<< ADDED player movement module
mod knocked_out; // <<< ADDED knocked out recovery module
mod bones; // <<< ADDED bones module
mod ranged_weapon_stats; // Add this line
mod projectile; // Add this line
mod death_marker; // <<< ADDED death marker module
mod torch; // <<< ADDED torch module
mod flashlight; // <<< ADDED flashlight module
mod headlamp; // <<< ADDED headlamp module
mod snorkel; // <<< ADDED snorkel module for underwater stealth
mod respawn; // <<< ADDED respawn module
mod shelter; // <<< ADDED shelter module
mod world_generation; // <<< ADDED world generation module
mod fishing; // <<< ADDED fishing module
mod drinking; // <<< ADDED drinking module
mod wet; // <<< ADDED wet status effect module
mod sound_events; // <<< ADDED sound events module
mod rain_collector; // <<< ADDED rain collector module
mod water_patch; // <<< ADDED water patch module for crop watering
mod fertilizer_patch; // <<< ADDED fertilizer patch module for visual fertilizer application
mod tilled_tiles; // <<< ADDED tilled tiles module for farming soil preparation
pub mod wild_animal_npc; // <<< ADDED wild animal NPC system (now modular, includes hostile NPCs)
mod animal_collision; // <<< ADDED animal collision system
mod barrel; // <<< ADDED roadside barrel loot system
mod metadata_providers; // <<< ADDED: Provides plant/seed metadata to client
mod sea_stack; // <<< ADDED: Sea stack decorative entities
mod memory_grid; // <<< ADDED: Memory Grid tech tree system
mod building; // <<< ADDED: Building system (foundations, walls, doors)
mod building_enclosure; // <<< ADDED: Building enclosure detection (rain protection, "inside" logic)
mod door; // <<< ADDED: Door system for building entrances
mod fence; // <<< ADDED: Fence system for crop/base protection
mod fumarole; // <<< ADDED: Fumarole module for quarry geothermal vents
mod basalt_column; // <<< ADDED: Basalt column module for quarry decorative obstacles
mod homestead_hearth; // <<< ADDED: Homestead Hearth for building privilege system
mod building_decay; // <<< ADDED: Building decay system
mod rune_stone; // <<< ADDED: Rune stone system
mod cairn; // <<< ADDED: Cairn lore system
mod broth_pot; // <<< ADDED: Broth pot cooking system
mod recipes; // <<< ADDED: Recipe system for broth pot cooking
mod barbecue; // <<< ADDED: Barbecue cooking appliance system
mod fire_patch; // <<< ADDED: Fire patch system for fire arrows
mod turret; // <<< ADDED: Turret system for automated defense
mod explosive; // <<< ADDED: Explosive system for raiding
mod grenade; // <<< ADDED: Grenade fuse system (armed grenades as items)
mod ai_brewing; // <<< ADDED: AI-generated brew recipes system
mod alk; // <<< ADDED: ALK (Automated Logistics Kernel) provisioning system
mod matronage; // <<< ADDED: Matronage pooled rewards system
pub mod compound_buildings; // <<< ADDED: Static compound building collision system
mod shipwreck; // <<< ADDED: Shipwreck monument collision system
mod fishing_village; // <<< ADDED: Fishing village monument collision system
mod whale_bone_graveyard; // <<< ADDED: Whale Bone Graveyard monument collision system
mod hunting_village; // <<< ADDED: Hunting Village monument collision system
mod bone_carving; // <<< ADDED: Bone carving system for Aleutian spirit totems
mod transistor_radio; // <<< ADDED: Transistor Radio spawn/respawn system
mod tide_pool_items; // <<< ADDED: Tide pool washed-up item respawn (Coral Fragments, Plastic Water Jug, Vitamin Drink)
pub mod monument; // <<< ADDED: Generic monument system for clearance zones (shipwrecks, ruins, crash sites, etc.)
mod durability; // <<< ADDED: Item durability system for weapons, tools, and torches
mod placeable_collision; // <<< ADDED: Shared placeable overlap prevention
mod repair_bench; // <<< ADDED: Repair bench for item repair
mod cooking_station; // <<< ADDED: Cooking station for advanced food recipes
mod player_progression; // <<< ADDED: Player progression system (XP, achievements, leaderboards)
mod quests; // <<< ADDED: Quest system (tutorial + daily quests)
mod beacon_event; // <<< ADDED: Memory Beacon server event system (airdrop-style)
mod drone; // <<< ADDED: Periodic drone flyover event (eerie shadow across island)
mod military_ration; // <<< ADDED: Military ration loot crate system
mod mine_cart; // <<< ADDED: Mine cart loot crate system (quarry-only spawns)
mod wild_beehive; // <<< ADDED: Wild beehive loot system (forest-only spawns)
mod road_lamppost; // <<< ADDED: Aleutian whale oil lampposts along dirt roads
mod sova_procedure; // <<< ADDED: SOVA HTTP procedures (ask_sova, transcribe_speech)

// ADD: Re-export respawn reducer
pub use respawn::respawn_randomly;

// ADD: Re-export player movement reducers
pub use player_movement::{set_sprinting, toggle_crouch, jump, dodge_roll};

// ADD: Re-export shelter placement reducer
pub use shelter::place_shelter;

// ADD: Re-export sleeping bag respawn reducer
pub use sleeping_bag::respawn_at_sleeping_bag;

// ADD: Re-export world generation reducer
pub use world_generation::generate_world;

// ADD: Re-export fishing reducers
pub use fishing::{cast_fishing_line, finish_fishing, cancel_fishing};

// ADD: Re-export drinking reducers
pub use drinking::{drink_water, fill_water_container_from_natural_source};

// ADD: Re-export planted seeds reducer
pub use planted_seeds::plant_seed;

// ADD: Re-export rain collector reducers
pub use rain_collector::{place_rain_collector, move_item_to_rain_collector, move_item_from_rain_collector, quick_move_from_rain_collector, fill_water_container};

// ADD: Re-export water container consumption reducer
pub use consumables::consume_filled_water_container;

// ADD: Re-export water patch reducer
pub use water_patch::water_crops;

// ADD: Re-export wild animal NPC reducers
pub use wild_animal_npc::{spawn_wild_animal, damage_wild_animal, damage_wild_animal_by_animal, process_wild_animal_ai};

// ADD: Re-export unified harvestable resource reducer
pub use harvestable_resource::interact_with_harvestable_resource;

// NOTE: Living coral no longer has a custom reducer - it uses combat.rs
// Storm debris spawns as individual HarvestableResources and DroppedItems

// ADD: Re-export metadata provider helper functions
pub use metadata_providers::{is_plantable_seed, get_plant_type_from_seed_name};

// ADD: Re-export memory grid reducers
pub use memory_grid::{purchase_memory_grid_node, initialize_player_memory_grid};

// ADD: Re-export building reducers
pub use building::place_foundation;

// ADD: Re-export door reducers
pub use door::{place_door, interact_door, pickup_door};

// ADD: Re-export fence reducers
pub use fence::place_fence;

// ADD: Re-export explosive reducers
pub use explosive::{place_explosive, relight_dud_explosive};

// ADD: Re-export homestead hearth reducers for client bindings
pub use homestead_hearth::{
    place_homestead_hearth, grant_building_privilege_from_hearth,
    move_item_to_hearth, move_item_from_hearth, move_item_within_hearth,
    split_stack_into_hearth, split_stack_from_hearth, split_stack_within_hearth,
    quick_move_from_hearth, quick_move_to_hearth,
    drop_item_from_hearth_slot_to_world, split_and_drop_item_from_hearth_slot_to_world
};

// ADD: Re-export matronage reducers for client bindings
pub use matronage::{
    use_matrons_mark, invite_to_matronage, accept_matronage_invitation, 
    decline_matronage_invitation, leave_matronage, remove_from_matronage,
    promote_to_pra_matron, rename_matronage, dissolve_matronage,
    withdraw_matronage_shards
};

// Define a constant for the /kill command cooldown (e.g., 5 minutes)
pub const KILL_COMMAND_COOLDOWN_SECONDS: u64 = 300;

// Table to store the last time a player used the /kill command
#[spacetimedb::table(accessor = player_kill_command_cooldown)]
#[derive(Clone, Debug)]
pub struct PlayerKillCommandCooldown {
    #[primary_key]
    player_id: Identity,
    last_kill_command_at: Timestamp,
}

// Table for private system messages to individual players
#[spacetimedb::table(accessor = private_message, public)] // Public so client can subscribe with filter
#[derive(Clone, Debug)]
pub struct PrivateMessage {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub recipient_identity: Identity, // The player who should see this message
    pub sender_display_name: String,  // e.g., "SYSTEM"
    pub text: String,
    pub sent: Timestamp,
}

// Re-export chat types and reducers for use in other modules
pub use chat::{Message, LastWhisperFrom, TeamMessage};

// Re-export player movement reducer for client bindings
pub use player_movement::update_player_position_simple;

// Re-export campfire reducers for client bindings  
pub use campfire::{
    place_campfire, move_item_to_campfire, quick_move_from_campfire,
    split_stack_into_campfire, move_item_within_campfire, split_stack_within_campfire,
    quick_move_to_campfire, move_item_from_campfire_to_player_slot,
    split_stack_from_campfire, split_and_move_from_campfire,
    drop_item_from_campfire_slot_to_world, split_and_drop_item_from_campfire_slot_to_world,
    interact_with_campfire, toggle_campfire_burning
};

// Re-export barbecue reducers for client bindings
pub use barbecue::{
    place_barbecue, move_item_to_barbecue, quick_move_from_barbecue,
    split_stack_into_barbecue, quick_move_to_barbecue,
    move_item_within_barbecue, split_stack_within_barbecue,
    move_item_from_barbecue_to_player_slot, split_stack_from_barbecue,
    drop_item_from_barbecue_slot_to_world, split_and_drop_item_from_barbecue_slot_to_world,
    interact_with_barbecue, toggle_barbecue_burning, pickup_barbecue
};

// Re-export furnace reducers for client bindings
pub use furnace::{
    place_furnace, move_item_to_furnace, quick_move_from_furnace, 
    split_stack_into_furnace, move_item_within_furnace, split_stack_within_furnace,
    quick_move_to_furnace, move_item_from_furnace_to_player_slot,
    split_stack_from_furnace, split_and_move_from_furnace,
    drop_item_from_furnace_slot_to_world, split_and_drop_item_from_furnace_slot_to_world,
    interact_with_furnace, toggle_furnace_burning, process_furnace_logic_scheduled
};

// Re-export fumarole reducers for client bindings
pub use fumarole::{
    move_item_to_fumarole, quick_move_from_fumarole,
    split_stack_into_fumarole, move_item_within_fumarole, split_stack_within_fumarole,
    quick_move_to_fumarole, move_item_from_fumarole_to_player_slot,
    split_stack_from_fumarole, split_and_move_from_fumarole,
    drop_item_from_fumarole_slot_to_world, split_and_drop_item_from_fumarole_slot_to_world,
    interact_with_fumarole
};

// Re-export lantern reducers for client bindings
pub use lantern::{
    place_lantern, move_item_to_lantern, quick_move_from_lantern,
    split_stack_into_lantern, move_item_within_lantern, split_stack_within_lantern,
    quick_move_to_lantern, move_item_from_lantern_to_player_slot,
    split_stack_from_lantern, split_and_drop_item_from_lantern_slot_to_world,
    drop_item_from_lantern_slot_to_world, light_lantern, extinguish_lantern, 
    toggle_lantern, pickup_lantern, interact_with_lantern
};

// Re-export turret reducers for client bindings
pub use turret::{
    place_turret, move_item_to_turret, quick_move_from_turret,
    quick_move_to_turret, move_item_from_turret_to_player_slot,
    split_stack_into_turret, split_stack_from_turret, split_stack_within_turret,
    pickup_turret, interact_with_turret
};

// Re-export wooden storage box reducers for client bindings
pub use wooden_storage_box::{
    place_wooden_storage_box, move_item_to_box, quick_move_from_box,
    split_stack_into_box, move_item_within_box, split_stack_within_box,
    quick_move_to_box, move_item_from_box, split_stack_from_box,
    drop_item_from_box_slot_to_world, split_and_drop_item_from_box_slot_to_world,
    interact_with_storage_box, pickup_storage_box
};

// Re-export repair bench reducers for client bindings
pub use repair_bench::{
    place_repair_bench, move_item_to_repair_bench, quick_move_to_repair_bench,
    repair_item, pickup_repair_bench
};

// Re-export cooking station reducers for client bindings
pub use cooking_station::{
    place_cooking_station, pickup_cooking_station
};

// Re-export player progression reducers for client bindings
pub use player_progression::{set_active_title, get_leaderboard};

// Re-export stash reducers for client bindings  
pub use stash::{
    place_stash, move_item_to_stash, quick_move_from_stash,
    split_stack_into_stash, move_item_within_stash, split_stack_within_stash,
    quick_move_to_stash, move_item_from_stash, split_stack_from_stash,
    drop_item_from_stash_slot_to_world, split_and_drop_item_from_stash_slot_to_world,
    toggle_stash_visibility
};

// Re-export player corpse reducers for client bindings
pub use player_corpse::{
    create_player_corpse, handle_player_death, move_item_to_corpse, quick_move_from_corpse,
    split_stack_into_corpse, move_item_within_corpse, split_stack_within_corpse,
    quick_move_to_corpse, move_item_from_corpse, split_stack_from_corpse,
    drop_item_from_corpse_slot_to_world, split_and_drop_item_from_corpse_slot_to_world
};

// Re-export broth pot reducers for client bindings
pub use broth_pot::{
    place_broth_pot_on_campfire, place_broth_pot_on_fumarole, pickup_broth_pot,
    interact_with_broth_pot,
    move_item_to_broth_pot, move_item_from_broth_pot, move_item_within_broth_pot,
    split_stack_into_broth_pot, split_stack_from_broth_pot, split_stack_within_broth_pot,
    quick_move_to_broth_pot, quick_move_from_broth_pot,
    move_item_to_broth_pot_water_container, move_item_from_broth_pot_water_container,
    quick_move_to_broth_pot_water_container, quick_move_from_broth_pot_water_container,
    move_item_from_broth_pot_output, quick_move_from_broth_pot_output,
    transfer_water_from_container_to_pot,
    schedule_next_broth_pot_processing, process_broth_pot_logic_scheduled
};

// Re-export AI brewing reducers for client bindings
pub use ai_brewing::{check_brew_cache, create_generated_brew};  

// Re-export ALK (Automated Logistics Kernel) reducers for client bindings
pub use alk::{
    get_available_contracts, accept_alk_contract, cancel_alk_contract,
    deliver_alk_contract, deliver_alk_contract_to_matronage, get_shard_balance, check_alk_station_proximity,
    debug_refresh_alk_contracts, debug_grant_shards, process_alk_contract_refresh,
    // Types
    AlkState, AlkStation, AlkContract, AlkPlayerContract, PlayerShardBalance,
    AlkContractKind, AlkContractStatus, AlkStationAllowance, ItemAlkTag,
};

// Re-export knocked out functions and types for other modules
pub use knocked_out::{schedule_knocked_out_recovery, KnockedOutRecoverySchedule, KnockedOutStatus};
pub use knocked_out::process_knocked_out_recovery; // For scheduler
pub use knocked_out::revive_knocked_out_player; // For client bindings  
pub use knocked_out::get_knocked_out_status; // For client bindings

// Re-export bones reducers for client bindings
pub use bones::process_extraction;

// ADD: Re-export torch reducer for client bindings
pub use torch::toggle_torch;

// ADD: Re-export flashlight reducer for client bindings
pub use flashlight::toggle_flashlight;

// ADD: Re-export snorkel reducer for client bindings
pub use snorkel::toggle_snorkel;

// ADD: Re-export headlamp reducer for client bindings
pub use headlamp::toggle_headlamp;

// Import Table Traits needed in this module
use crate::tree::tree as TreeTableTrait;
use crate::stone::stone as StoneTableTrait;
use crate::rune_stone::rune_stone as RuneStoneTableTrait;
use crate::cairn::cairn as CairnTableTrait;
use crate::cairn::player_discovered_cairn as PlayerDiscoveredCairnTableTrait;
use crate::campfire::campfire as CampfireTableTrait;
use crate::furnace::furnace as FurnaceTableTrait;
use crate::lantern::lantern as LanternTableTrait;
use crate::harvestable_resource::harvestable_resource as HarvestableResourceTableTrait;
use crate::harvestable_resource::player_discovered_plant as PlayerDiscoveredPlantTableTrait;
use crate::world_state::world_state as WorldStateTableTrait;
use crate::world_state::thunder_event_cleanup_schedule as ThunderEventCleanupScheduleTableTrait; // <<< ADDED: Import ThunderEventCleanupSchedule table trait
use crate::items::inventory_item as InventoryItemTableTrait;
use crate::items::item_definition as ItemDefinitionTableTrait;
use crate::active_equipment::active_equipment as ActiveEquipmentTableTrait;
use crate::dropped_item::dropped_item_despawn_schedule as DroppedItemDespawnScheduleTableTrait;
use crate::dropped_item::flare_expiry_schedule as FlareExpiryScheduleTableTrait;
use crate::wooden_storage_box::wooden_storage_box as WoodenStorageBoxTableTrait;
use crate::chat::message as MessageTableTrait; // Import the trait for Message table
use crate::sleeping_bag::sleeping_bag as SleepingBagTableTrait; // ADD Sleeping Bag trait import
use crate::player_stats::stat_thresholds_config as StatThresholdsConfigTableTrait; // <<< UPDATED: Import StatThresholdsConfig table trait
use crate::grass::grass as GrassTableTrait; // <<< ADDED: Import Grass table trait
use crate::grass::grass_state as GrassStateTableTrait; // <<< ADDED: Import GrassState table trait (split from Grass)
use crate::knocked_out::knocked_out_status as KnockedOutStatusTableTrait; // <<< ADDED: Import KnockedOutStatus table trait
use crate::world_tile as WorldTileTableTrait; // <<< ADDED: Import WorldTile table trait
use crate::minimap_cache as MinimapCacheTableTrait; // <<< ADDED: Import MinimapCache table trait
use crate::player_movement::player_dodge_roll_state as PlayerDodgeRollStateTableTrait; // <<< ADDED: Import PlayerDodgeRollState table trait
use crate::player_movement::dodge_roll_cleanup_schedule as DodgeRollCleanupScheduleTableTrait; // <<< ADDED: Import DodgeRollCleanupSchedule table trait
use crate::projectile::projectile_update_schedule as ProjectileUpdateScheduleTableTrait; // <<< ADDED: For pause/resume game systems
use crate::world_chunk_data as WorldChunkDataTableTrait; // <<< ADDED: Import WorldChunkData table trait
use crate::fishing::fishing_session as FishingSessionTableTrait; // <<< ADDED: Import FishingSession table trait
use crate::drinking::player_drinking_cooldown as PlayerDrinkingCooldownTableTrait; // <<< ADDED: Import PlayerDrinkingCooldown table trait
use crate::planted_seeds::planted_seed as PlantedSeedTableTrait; // <<< ADDED: Import PlantedSeed table trait
use crate::sound_events::sound_event as SoundEventTableTrait; // <<< ADDED: Import SoundEvent table trait
use crate::sound_events::sound_event_cleanup_schedule as SoundEventCleanupScheduleTableTrait; // <<< ADDED: Import SoundEventCleanupSchedule table trait
use crate::sound_events::thunder_sound_schedule as ThunderSoundScheduleTableTrait; // <<< ADDED: Import ThunderSoundSchedule table trait for delayed thunder
use crate::rain_collector::rain_collector as RainCollectorTableTrait; // <<< ADDED: Import RainCollector table trait
use crate::water_patch::water_patch as WaterPatchTableTrait; // <<< ADDED: Import WaterPatch table trait
use crate::fertilizer_patch::fertilizer_patch as FertilizerPatchTableTrait; // <<< ADDED: Import FertilizerPatch table trait
use crate::tilled_tiles::tilled_tile_metadata as TilledTileMetadataTableTrait; // <<< ADDED: Import TilledTileMetadata table trait
use crate::tilled_tiles::tilled_tile_reversion_schedule as TilledTileReversionScheduleTableTrait; // <<< ADDED: Import TilledTileReversionSchedule table trait
use crate::compost::compost_process_schedule as CompostProcessScheduleTableTrait; // <<< ADDED: Import CompostProcessSchedule table trait
use crate::tanning_rack::tanning_process_schedule as TanningProcessScheduleTableTrait; // Tanning rack schedule (pause/resume / clear DB)
use crate::wild_animal_npc::wild_animal as WildAnimalTableTrait; // <<< ADDED: Import WildAnimal table trait
use crate::wild_animal_npc::wild_animal_ai_schedule as WildAnimalAiScheduleTableTrait; // <<< ADDED: Import WildAnimalAiSchedule table trait
use crate::wild_animal_npc::animal_corpse as AnimalCorpseTableTrait; // <<< ADDED: Import AnimalCorpse table trait
use crate::wild_animal_npc::caribou::caribou_breeding_data as CaribouBreedingDataTableTrait; // <<< ADDED: Caribou breeding system
use crate::wild_animal_npc::caribou::caribou_breeding_schedule as CaribouBreedingScheduleTableTrait; // <<< ADDED: Caribou breeding system
use crate::wild_animal_npc::caribou::caribou_rut_state as CaribouRutStateTableTrait; // <<< ADDED: Caribou breeding system
use crate::barrel::barrel as BarrelTableTrait; // <<< ADDED: Import Barrel table trait
use crate::barrel::barrel_respawn_schedule as BarrelRespawnScheduleTableTrait; // <<< ADDED: Import BarrelRespawnSchedule table trait
use crate::wild_animal_npc::respawn::spawn_zone_schedule as SpawnZoneScheduleTableTrait; // <<< Spawn zone respawn (wolves/wolverines/terns at monuments)
use crate::turret::turret_processing_schedule as TurretProcessingScheduleTableTrait; // <<< For pause/resume game systems
use crate::wild_animal_npc::hostile_spawning::hostile_spawn_schedule as HostileSpawnScheduleTableTrait; // <<< For pause/resume game systems
use crate::wild_animal_npc::hostile_spawning::hostile_dawn_cleanup_schedule as HostileDawnCleanupScheduleTableTrait; // <<< For pause/resume game systems
use crate::fumarole::fumarole_global_schedule as FumaroleGlobalScheduleTableTrait; // <<< For pause/resume game systems (top CPU consumer)
use crate::active_effects::process_effects_schedule as ProcessEffectsScheduleTableTrait; // <<< For pause/resume game systems
use crate::player_stats::player_stat_schedule as PlayerStatScheduleTableTrait; // <<< For pause/resume game systems
use crate::cloud::cloud_update_schedule as CloudUpdateScheduleTableTrait; // <<< For pause/resume game systems
use crate::cloud::cloud_intensity_schedule as CloudIntensityScheduleTableTrait; // <<< For pause/resume game systems
use crate::campfire::campfire_global_schedule as CampfireGlobalScheduleTableTrait; // <<< For pause/resume
use crate::furnace::furnace_processing_schedule as FurnaceProcessingScheduleTableTrait; // <<< For pause/resume
use crate::barbecue::barbecue_processing_schedule as BarbecueProcessingScheduleTableTrait; // <<< For pause/resume
use crate::broth_pot::broth_pot_processing_schedule as BrothPotProcessingScheduleTableTrait; // <<< For pause/resume
use crate::lantern::lantern_processing_schedule as LanternProcessingScheduleTableTrait; // <<< For pause/resume
use crate::global_tick::global_tick_schedule; // <<< Trait for ctx.db.global_tick_schedule()
use crate::world_state::seasonal_plant_management_schedule as SeasonalPlantManagementScheduleTableTrait; // <<< For pause/resume
use crate::drone::drone_daily_schedule as DroneDailyScheduleTableTrait; // <<< For pause/resume
use crate::drone::drone_flight_schedule as DroneFlightScheduleTableTrait; // <<< For pause/resume
use crate::durability::torch_durability_schedule as TorchDurabilityScheduleTableTrait; // <<< For pause/resume
use crate::durability::food_spoilage_schedule as FoodSpoilageScheduleTableTrait; // <<< For pause/resume
use crate::planted_seeds::planted_seed_growth_schedule as PlantedSeedGrowthScheduleTableTrait; // <<< For pause/resume
use crate::grass::grass_respawn_batch_schedule as GrassRespawnBatchScheduleTableTrait; // <<< For pause/resume
use crate::fire_patch::fire_patch_cleanup_schedule as FirePatchCleanupScheduleTableTrait; // <<< For pause/resume
use crate::fire_patch::fire_patch_damage_schedule as FirePatchDamageScheduleTableTrait; // <<< For pause/resume
use crate::fish_trap::fish_trap_process_schedule as FishTrapProcessScheduleTableTrait; // <<< For pause/resume
use crate::homestead_hearth::building_privilege_check_schedule as BuildingPrivilegeCheckScheduleTableTrait; // <<< For pause/resume
use crate::homestead_hearth::hearth_upkeep_schedule as HearthUpkeepScheduleTableTrait; // <<< For pause/resume
use crate::building_decay::building_decay_schedule as BuildingDecayScheduleTableTrait; // <<< For pause/resume
use crate::fertilizer_patch::fertilizer_patch_cleanup_schedule as FertilizerPatchCleanupScheduleTableTrait; // <<< For pause/resume
use crate::active_equipment::water_container_fill_schedule as WaterContainerFillScheduleTableTrait; // <<< For pause/resume
use crate::matronage::matronage_payout_schedule as MatronagePayoutScheduleTableTrait; // <<< For pause/resume
use crate::alk::alk_contract_refresh_schedule as AlkContractRefreshScheduleTableTrait; // <<< For pause/resume
use crate::wild_animal_npc::walrus::walrus_breeding_schedule as WalrusBreedingScheduleTableTrait; // <<< For pause/resume
use crate::water_patch::water_patch_cleanup_schedule as WaterPatchCleanupScheduleTableTrait; // <<< For pause/resume
use crate::barbecue::barbecue as BarbecueTableTrait; // <<< For resume iteration
use crate::broth_pot::broth_pot as BrothPotTableTrait; // <<< For resume iteration
use crate::rune_stone::rune_stone_shard_spawn_schedule as RuneStoneShardSpawnScheduleTableTrait; // <<< For pause/resume
use crate::rune_stone::rune_stone_item_spawn_schedule as RuneStoneItemSpawnScheduleTableTrait; // <<< For pause/resume
use crate::rune_stone::rune_stone_seed_spawn_schedule as RuneStoneSeedSpawnScheduleTableTrait; // <<< For pause/resume
use crate::backpack::backpack_consolidation_schedule as BackpackConsolidationScheduleTableTrait; // <<< For pause/resume
use crate::explosive::explosive_detonation_schedule as ExplosiveDetonationScheduleTableTrait; // <<< For pause/resume
use crate::grenade::grenade_fuse_schedule as GrenadeFuseScheduleTableTrait; // <<< For pause/resume
use crate::beehive::beehive_process_schedule as BeehiveProcessScheduleTableTrait; // <<< For pause/resume
use crate::sea_stack::sea_stack as SeaStackTableTrait; // <<< ADDED: Import SeaStack table trait
use crate::player_corpse::player_corpse as PlayerCorpseTableTrait; // <<< ADDED: Import PlayerCorpse table trait
use crate::player_progression::player_stats as PlayerStatsTableTrait; // <<< ADDED: Import PlayerStats table trait
use crate::player_progression::achievement_definition as AchievementDefinitionTableTrait; // <<< ADDED
use crate::player_progression::player_achievement as PlayerAchievementTableTrait; // <<< ADDED
use crate::player_progression::daily_login_reward as DailyLoginRewardTableTrait; // <<< ADDED
use crate::player_progression::achievement_unlock_notification as AchievementUnlockNotificationTableTrait; // <<< ADDED
use crate::player_progression::level_up_notification as LevelUpNotificationTableTrait; // <<< ADDED
use crate::player_progression::daily_login_notification as DailyLoginNotificationTableTrait; // <<< ADDED
use crate::player_progression::progress_notification as ProgressNotificationTableTrait; // <<< ADDED
use crate::player_progression::comparative_stat_notification as ComparativeStatNotificationTableTrait; // <<< ADDED
use crate::player_progression::leaderboard_entry as LeaderboardEntryTableTrait; // <<< ADDED

// Use struct names directly for trait aliases
use crate::crafting::Recipe as RecipeTableTrait;
use crate::crafting_queue::CraftingQueueItem as CraftingQueueItemTableTrait;
use crate::crafting_queue::CraftingFinishSchedule as CraftingFinishScheduleTableTrait;
use crate::crafting_queue::crafting_finish_schedule; // Trait for ctx.db.crafting_finish_schedule()
use crate::global_tick::GlobalTickSchedule as GlobalTickScheduleTableTrait;
use crate::PlayerLastAttackTimestamp as PlayerLastAttackTimestampTableTrait; // Import for the new table

// Import constants needed from player_stats
use crate::player_stats::{
    SPRINT_SPEED_MULTIPLIER,
    JUMP_COOLDOWN_MS,
    PLAYER_STARTING_HUNGER,
    PLAYER_STARTING_THIRST
};

// Use specific items needed globally (or use qualified paths)
use crate::world_state::TimeOfDay; // Keep TimeOfDay if needed elsewhere, otherwise remove
use crate::campfire::{Campfire, WARMTH_RADIUS_SQUARED, WARMTH_PER_SECOND, CAMPFIRE_COLLISION_RADIUS, CAMPFIRE_CAMPFIRE_COLLISION_DISTANCE_SQUARED, CAMPFIRE_COLLISION_Y_OFFSET, PLAYER_CAMPFIRE_COLLISION_DISTANCE_SQUARED, PLAYER_CAMPFIRE_INTERACTION_DISTANCE_SQUARED };

// Initial Amounts

// --- Global Constants ---
pub const MAX_PLAYERS: usize = 50;
pub use shared_config::{
    CROUCHING_RADIUS_MULTIPLIER,
    PLAYER_RADIUS,
    PLAYER_SPEED,
    PLAYER_SPRINT_MULTIPLIER,
    TILE_SIZE_PX,
    WATER_SPEED_PENALTY,
    WORLD_HEIGHT_TILES,
    WORLD_WIDTH_TILES,
};

// ADD: Helper function to get effective player radius based on crouching state
pub fn get_effective_player_radius(is_crouching: bool) -> f32 {
    if is_crouching {
        PLAYER_RADIUS * CROUCHING_RADIUS_MULTIPLIER
    } else {
        PLAYER_RADIUS
    }
}

// World Dimensions
// Change back to f32 as they are used in float calculations
pub const WORLD_WIDTH_PX: f32 = (WORLD_WIDTH_TILES * TILE_SIZE_PX) as f32;
pub const WORLD_HEIGHT_PX: f32 = (WORLD_HEIGHT_TILES * TILE_SIZE_PX) as f32;

// ADD: Helper functions for water detection
/// Converts world pixel coordinates to tile coordinates
pub fn world_pos_to_tile_coords(world_x: f32, world_y: f32) -> (i32, i32) {
    let tile_x = (world_x / TILE_SIZE_PX as f32).floor() as i32;
    let tile_y = (world_y / TILE_SIZE_PX as f32).floor() as i32;
    (tile_x, tile_y)
}

/// Checks if a player is standing on a water tile (Sea type)
/// This is highly optimized using direct tile coordinate lookup
/// NEW: Uses compressed chunk data for much better performance
pub fn is_player_on_water(ctx: &ReducerContext, player_x: f32, player_y: f32) -> bool {
    // Convert player position to tile coordinates
    let (tile_x, tile_y) = world_pos_to_tile_coords(player_x, player_y);
    
    // NEW: Try compressed lookup first for much better performance
    if let Some(tile_type) = get_tile_type_at_position(ctx, tile_x, tile_y) {
        return tile_type.is_water(); // Includes both Sea and HotSpringWater
    }
    
    // FALLBACK: Use original method if compressed data not available
    let world_tiles = ctx.db.world_tile();
    
    // Use the indexed world_position btree for fast lookup
    for tile in world_tiles.idx_world_position().filter((tile_x, tile_y)) {
        return tile.tile_type.is_water(); // Sea, DeepSea, HotSpringWater
    }
    
    // No tile found at this position, assume land (safety fallback)
    false
}

/// Checks if a player is currently jumping (in the air)
/// Returns true if the player started a jump and is still within the jump duration
pub fn is_player_jumping(jump_start_time_ms: u64, current_time_ms: u64) -> bool {
    if jump_start_time_ms == 0 {
        return false; // Player has never jumped or jump has been reset
    }
    
    let elapsed_ms = current_time_ms.saturating_sub(jump_start_time_ms);
    elapsed_ms < JUMP_COOLDOWN_MS // Player is still within the jump duration
}

/// NEW: Efficient tile lookup using compressed chunk data
/// This is much faster than individual WorldTile lookups for water detection
pub fn is_player_on_water_compressed(ctx: &ReducerContext, player_x: f32, player_y: f32) -> bool {
    // Convert player position to tile coordinates
    let (tile_x, tile_y) = world_pos_to_tile_coords(player_x, player_y);
    
    // Calculate which chunk this tile belongs to
    let chunk_x = tile_x / environment::CHUNK_SIZE_TILES as i32;
    let chunk_y = tile_y / environment::CHUNK_SIZE_TILES as i32;
    
    // Look up the compressed chunk data
    let world_chunk_data = ctx.db.world_chunk_data();
    for chunk in world_chunk_data.idx_chunk_coords().filter((chunk_x, chunk_y)) {
        // Calculate local tile position within the chunk
        let local_tile_x = (tile_x % environment::CHUNK_SIZE_TILES as i32) as usize;
        let local_tile_y = (tile_y % environment::CHUNK_SIZE_TILES as i32) as usize;
        let tile_index = local_tile_y * environment::CHUNK_SIZE_TILES as usize + local_tile_x;
        
        // Check bounds and extract tile type
        if tile_index < chunk.tile_types.len() {
            if let Some(tile_type) = TileType::from_u8(chunk.tile_types[tile_index]) {
                return tile_type.is_water(); // Includes both Sea and HotSpringWater
            }
        }
        break; // Found the chunk, no need to continue
    }
    
    // Fallback to original method if compressed data not available
    // Log a warning (once per few seconds/calls ideally, but simple log for now)
    // Only log if we are actually in bounds, to avoid spam for out-of-bounds checks
    if player_x >= 0.0 && player_y >= 0.0 && player_x < WORLD_WIDTH_PX && player_y < WORLD_HEIGHT_PX {
        log::warn!("PERFORMANCE WARNING: Compressed chunk data missing for player at ({}, {}). Fallback to slow WorldTile lookup.", player_x, player_y);
    }
    is_player_on_water(ctx, player_x, player_y)
}

/// NEW: Get tile type at specific world coordinates using compressed data
pub fn get_tile_type_at_position(ctx: &ReducerContext, world_x: i32, world_y: i32) -> Option<TileType> {
    // Calculate which chunk this tile belongs to
    let chunk_x = world_x / environment::CHUNK_SIZE_TILES as i32;
    let chunk_y = world_y / environment::CHUNK_SIZE_TILES as i32;
    
    // Look up the compressed chunk data
    let world_chunk_data = ctx.db.world_chunk_data();
    for chunk in world_chunk_data.idx_chunk_coords().filter((chunk_x, chunk_y)) {
        // Calculate local tile position within the chunk
        let local_tile_x = (world_x % environment::CHUNK_SIZE_TILES as i32) as usize;
        let local_tile_y = (world_y % environment::CHUNK_SIZE_TILES as i32) as usize;
        let tile_index = local_tile_y * environment::CHUNK_SIZE_TILES as usize + local_tile_x;
        
        // Check bounds and extract tile type
        if tile_index < chunk.tile_types.len() {
            return TileType::from_u8(chunk.tile_types[tile_index]);
        }
        break; // Found the chunk, no need to continue
    }
    
    None // No compressed data found for this position
}

// Player table to store position
#[spacetimedb::table(
    accessor = player,
    public,
    // Add spatial index
    index(accessor = idx_player_pos, name = "idx_player_pos", btree(columns = [position_x, position_y]))
)]
#[derive(Clone)]
pub struct Player {
    #[primary_key]
    pub identity: Identity,
    pub username: String,
    pub position_x: f32,
    pub position_y: f32,
    pub direction: String,
    pub last_update: Timestamp, // Timestamp of the last update (movement or stats)
    pub last_stat_update: Timestamp, // Timestamp of the last stat processing tick
    pub jump_start_time_ms: u64,
    pub health: f32,
    pub stamina: f32,
    pub thirst: f32,
    pub hunger: f32,
    pub warmth: f32,
    pub is_sprinting: bool,
    pub is_dead: bool,
    pub death_timestamp: Option<Timestamp>,
    pub last_hit_time: Option<Timestamp>,
    pub is_online: bool, // <<< ADDED
    pub is_torch_lit: bool, // <<< ADDED: Tracks if the player's torch is currently lit
    pub is_flashlight_on: bool, // <<< ADDED: Tracks if the player's flashlight is currently on
    pub is_headlamp_lit: bool, // <<< ADDED: Tracks if the player's headlamp is currently lit (head armor)
    pub flashlight_aim_angle: f32, // Angle in radians for flashlight direction (synced for all players)
    pub last_consumed_at: Option<Timestamp>, // <<< ADDED: Tracks when a player last consumed an item
    pub is_crouching: bool, // RENAMED: For crouching speed control
    pub is_knocked_out: bool, // NEW: Tracks if the player is in knocked out state
    pub knocked_out_at: Option<Timestamp>, // NEW: When the player was knocked out
    pub is_on_water: bool, // NEW: Tracks if the player is currently standing on water
    pub is_snorkeling: bool, // NEW: Tracks if player is submerged using reed snorkel (hidden from animals)
    pub client_movement_sequence: u64,
    pub is_inside_building: bool, // NEW: Tracks if player is inside an enclosed building (≥70% wall coverage)
    pub last_respawn_time: Timestamp, // NEW: When the player last spawned/respawned (for fat accumulation calculation)
    pub insanity: f32, // NEW: Hidden stat that increases when carrying memory shards or mining them (0.0-100.0)
    pub last_insanity_threshold: f32, // NEW: Last insanity threshold crossed (for SOVA sound triggers: 0.0, 25.0, 50.0, 75.0, 90.0, 100.0)
    pub shard_carry_start_time: Option<Timestamp>, // NEW: When player started carrying memory shards (for time-based insanity scaling)
    pub offline_corpse_id: Option<u32>, // Links to corpse created when player went offline
    pub is_aiming_throw: bool, // NEW: Tracks if player is in throw-aiming state (right mouse held)
    // Unified tutorial progress: list of tutorial IDs this player has completed.
    // Keeps schema DRY as tutorial count grows.
    pub seen_tutorial_ids: Vec<String>,
    pub pvp_enabled: bool, // Whether PvP mode is currently active
    pub pvp_enabled_until: Option<Timestamp>, // When PvP will auto-disable (minimum 30min)
    pub last_pvp_combat_time: Option<Timestamp>, // Last time player dealt/received PvP damage (for combat extension)
    // === NPC Agent Fields ===
    pub is_npc: bool, // True for ElizaOS-driven NPC agents, false for human players
    pub npc_role: String, // NPC role identifier: "gatherer", "warrior", "builder", "trader", etc. Empty for humans.
}

pub const TUTORIAL_ID_MEMORY_SHARD: &str = "memoryShard";
pub const TUTORIAL_ID_MEMORY_SHARD_200: &str = "memoryShard200";
pub const TUTORIAL_ID_CRASH_INTRO: &str = "crashIntro";
pub const TUTORIAL_ID_TUTORIAL_HINT: &str = "tutorialHint";
pub const TUTORIAL_ID_FIRST_HOSTILE_ENCOUNTER: &str = "firstHostileEncounter";
pub const TUTORIAL_ID_RUNE_STONE: &str = "runeStone";
pub const TUTORIAL_ID_ALK_STATION: &str = "alkStation";
pub const TUTORIAL_ID_CRASHED_DRONE: &str = "crashedDrone";

pub const ALL_TUTORIAL_IDS: [&str; 8] = [
    TUTORIAL_ID_MEMORY_SHARD,
    TUTORIAL_ID_MEMORY_SHARD_200,
    TUTORIAL_ID_CRASH_INTRO,
    TUTORIAL_ID_TUTORIAL_HINT,
    TUTORIAL_ID_FIRST_HOSTILE_ENCOUNTER,
    TUTORIAL_ID_RUNE_STONE,
    TUTORIAL_ID_ALK_STATION,
    TUTORIAL_ID_CRASHED_DRONE,
];

pub fn has_seen_tutorial(player: &Player, tutorial_id: &str) -> bool {
    player.seen_tutorial_ids.iter().any(|id| id == tutorial_id)
}

pub fn mark_tutorial_seen_in_player(player: &mut Player, tutorial_id: &str) -> bool {
    if has_seen_tutorial(player, tutorial_id) {
        return false;
    }
    player.seen_tutorial_ids.push(tutorial_id.to_string());
    true
}

// Table to store the last attack timestamp for each player
#[spacetimedb::table(accessor = player_last_attack_timestamp)]
#[derive(Clone, Debug)]
pub struct PlayerLastAttackTimestamp {
    #[primary_key]
    player_id: Identity,
    last_attack_timestamp: Timestamp,
}

// --- NEW: Define ActiveConnection Table --- 
#[spacetimedb::table(accessor = active_connection, public)]
#[derive(Clone, Debug)]
pub struct ActiveConnection {
    #[primary_key]
    identity: Identity,
    // Store the ID of the current WebSocket connection for this identity
    connection_id: ConnectionId,
    timestamp: Timestamp, // Add timestamp field
}

// --- NEW: Define ClientViewport Table ---
#[spacetimedb::table(accessor = client_viewport)]
#[derive(Clone, Debug)]
pub struct ClientViewport {
    #[primary_key]
    client_identity: Identity,
    min_x: f32,
    min_y: f32,
    max_x: f32,
    max_y: f32,
    last_update: Timestamp,
}

// --- Lifecycle Reducers ---

// Called once when the module is published or updated
#[spacetimedb::reducer(init)]
pub fn init_module(ctx: &ReducerContext) -> Result<(), String> {
    log::info!("Initializing module...");

    // Seed all static game data first (items, recipes, etc.)
    crate::items::seed_items(ctx)?;
    crate::items::seed_food_poisoning_risks(ctx)?;
    crate::items::seed_ranged_weapon_stats(ctx)?;
    crate::crafting::seed_recipes(ctx)?;
    // Seed plant configuration data for Encyclopedia
    crate::plants_database::populate_plant_config_definitions(ctx);
    // Seed progression system data
    crate::player_progression::seed_achievements(ctx)?;
    crate::player_progression::seed_daily_login_rewards(ctx)?;
    // Seed quest system data (tutorial + daily quests)
    crate::quests::init_quest_system(ctx)?;
    // NOTE: seed_environment is now called AFTER world generation (see below)

    // Initialize the dropped item despawn schedule
    crate::dropped_item::init_dropped_item_schedule(ctx)?;
    crate::dropped_item::init_flare_expiry_schedule(ctx);
    // Initialize the crafting finish check schedules
    crate::crafting_queue::init_crafting_schedule(ctx)?;
    // Re-enable the player stat update schedule for TreeCover effects
    crate::player_stats::init_player_stat_schedule(ctx)?;
    // Initialize the global tick schedule - enables time progression and resource respawns
    crate::global_tick::init_global_tick_schedule(ctx)?;
    // <<< UPDATED: Initialize StatThresholdsConfig table >>>
    crate::player_stats::init_stat_thresholds_config(ctx)?;
    // Re-enable active effects processing - needed for health regen, bleeding, poisoning, etc.
    crate::active_effects::schedule_effect_processing(ctx)?;
    crate::projectile::init_projectile_system(ctx)?;
    // ADD: Initialize plant growth system
    crate::planted_seeds::init_plant_growth_system(ctx)?;
    
    // ADD: Initialize water patch cleanup system
    crate::water_patch::init_water_patch_system(ctx)?;
    
    // ADD: Initialize fertilizer patch cleanup system
    crate::fertilizer_patch::init_fertilizer_patch_system(ctx)?;
    
    // ADD: Initialize tilled tile reversion system
    crate::tilled_tiles::init_tilled_tile_system(ctx)?;
    
    // ADD: Initialize compost processing system
    crate::compost::init_compost_system(ctx)?;
    
    crate::tanning_rack::init_tanning_rack_system(ctx)?;
    
    // ADD: Initialize fish trap processing system
    crate::fish_trap::init_fish_trap_system(ctx)?;
    
    // ADD: Initialize player beehive production system
    crate::beehive::init_beehive_system(ctx)?;
    
    // ADD: Initialize fire patch cleanup system
    crate::fire_patch::init_fire_patch_system(ctx)?;
    
    // ADD: Initialize explosive system
    crate::explosive::init_explosive_system(ctx)?;
    
    // ADD: Initialize grenade fuse system
    crate::grenade::init_grenade_system(ctx)?;
    
    // ADD: Initialize turret system
    crate::turret::init_turret_system(ctx)?;
    
    // ADD: Initialize backpack consolidation system
    crate::backpack::init_backpack_consolidation_schedule(ctx)?;
    
    // ADD: Initialize sound event cleanup system
    crate::sound_events::init_sound_cleanup_system(ctx)?;

    // ADD: Initialize drone daily flyover system
    crate::drone::init_drone_system(ctx);
    
    // ADD: Initialize wild animal AI system
    crate::wild_animal_npc::init_wild_animal_ai_schedule(ctx)?;
    
    // ADD: Initialize spawn zone respawn (wolves at dens, wolverines at graveyard, terns at marshes - 8 min interval)
    crate::wild_animal_npc::respawn::init_spawn_zone_schedule(ctx)?;
    
    // ADD: Initialize hostile NPC spawning system (night-only enemies)
    crate::wild_animal_npc::init_hostile_spawning_system(ctx)?;
    
    // ADD: Initialize caribou breeding system (passive farming feature)
    crate::wild_animal_npc::init_caribou_breeding_schedule(ctx)?;
    
    // ADD: Initialize walrus breeding system (passive farming feature)
    crate::wild_animal_npc::init_walrus_breeding_schedule(ctx)?;
    
    // ADD: Initialize building privilege distance check system
    crate::homestead_hearth::init_building_privilege_check_schedule(ctx)?;
    
    // ADD: Initialize hearth upkeep processing system
    crate::homestead_hearth::init_hearth_upkeep_schedule(ctx)?;
    
    // ADD: Initialize building decay processing system
    crate::building_decay::init_building_decay_schedule(ctx)?;
    
    // ADD: Initialize barrel respawn system
    crate::barrel::init_barrel_system(ctx)?;
    
    // ADD: Initialize grass respawn batch scheduler (replaces per-entity schedules)
    crate::grass::init_grass_respawn_scheduler(ctx);
    
    // ADD: Initialize rune stone spawning systems
    crate::rune_stone::init_rune_stone_shard_spawning(ctx)?;
    crate::rune_stone::init_rune_stone_item_spawning(ctx)?;
    crate::rune_stone::init_rune_stone_seed_spawning(ctx)?;
    
    // ADD: Initialize WorldState for scheduled systems
    crate::world_state::seed_world_state(ctx)?;
    
    // NOTE: ALK system initialization moved to AFTER world generation (needs tiles to exist for asphalt spawning)
    
    // ADD: Initialize dodge roll cleanup system
    crate::player_movement::init_dodge_roll_cleanup_system(ctx)?;

    // ADD: Initialize global fumarole processing (1 tx/sec for all fumaroles, replaces per-fumarole schedules)
    crate::fumarole::init_fumarole_global_schedule(ctx)?;
    // ADD: Initialize global campfire processing (1 tx/sec for all campfires, replaces per-campfire schedules)
    crate::campfire::init_campfire_global_schedule(ctx)?;
    
    // ADD: Initialize water container fill system for rain collection
    crate::active_equipment::init_water_container_fill_schedule(ctx)?;
    
    // ADD: Initialize torch durability system
    crate::durability::init_torch_durability_schedule(ctx)?;
    
    // ADD: Initialize food spoilage system
    crate::durability::init_food_spoilage_schedule(ctx)?;

    // ADD: Generate world automatically on first startup
    let existing_tiles_count = ctx.db.world_tile().iter().count();
    if existing_tiles_count == 0 {
        log::info!("No world tiles found, generating initial world...");
        // Generate world with smaller size for better performance
        let world_config = crate::WorldGenConfig {
            seed: ctx.rng().gen::<u64>(), // Random seed each time using ctx.rng()
            world_width_tiles: WORLD_WIDTH_TILES,  // Reduced from 250 for performance
            world_height_tiles: WORLD_HEIGHT_TILES, // Reduced from 250 for performance  
            chunk_size: environment::CHUNK_SIZE_TILES, // Use the same chunk size as runtime lookups
            island_border_width: 5,  // Adjusted for smaller world
            beach_width: 3,          // Adjusted for smaller world
            river_frequency: 0.3,
            dirt_patch_frequency: 0.2,
            road_density: 0.1,
        };
        
        match crate::world_generation::generate_world(ctx, world_config) {
            Ok(_) => {
                log::info!("Initial world generation completed successfully");
                
                // CRITICAL: Initialize ALK system FIRST (spawns asphalt pads around stations)
                // This MUST happen before compressed chunk data generation so asphalt is included
                log::info!("Initializing ALK system (substations with asphalt pads)...");
                match crate::alk::init_alk_system(ctx) {
                    Ok(_) => log::info!("ALK system initialized successfully"),
                    Err(e) => log::error!("Failed to initialize ALK system: {}", e),
                }

                // Initialize Matronage system (pooled rewards)
                log::info!("Initializing Matronage system...");
                match crate::matronage::init_matronage_system(ctx) {
                    Ok(_) => log::info!("Matronage system initialized successfully"),
                    Err(e) => log::error!("Failed to initialize Matronage system: {}", e),
                }

                // CRITICAL: Seed environment AFTER world tiles exist
                log::info!("Seeding environment (trees, stones, plants) now that world tiles exist...");
                match crate::environment::seed_environment(ctx) {
                    Ok(_) => log::info!("Environment seeding completed successfully"),
                    Err(e) => log::error!("Failed to seed environment: {}", e),
                }
                
                // Populate coastal spawn points for fast respawn lookups
                log::info!("Populating coastal spawn points...");
                match crate::populate_coastal_spawn_points(ctx) {
                    Ok(_) => log::info!("Coastal spawn points populated successfully"),
                    Err(e) => log::error!("Failed to populate coastal spawn points: {}", e),
                }
                
                // Generate compressed chunk data AFTER all tile modifications (ALK asphalt, etc.)
                log::info!("Generating compressed chunk data for efficient network transmission...");
                match crate::world_generation::generate_compressed_chunk_data(ctx) {
                    Ok(_) => log::info!("Compressed chunk data generated successfully"),
                    Err(e) => log::error!("Failed to generate compressed chunk data: {}", e),
                }
                
                // Generate minimap cache LAST (after all tile modifications)
                log::info!("Generating minimap cache...");
                match crate::world_generation::generate_minimap_data(ctx, 300, 300) {
                    Ok(_) => log::info!("Minimap cache generated successfully"),
                    Err(e) => log::error!("Failed to generate minimap cache: {}", e),
                }
            },
            Err(e) => log::error!("Failed to generate initial world: {}", e),
        }
    } else {
        log::info!("World tiles already exist ({}), skipping world generation", existing_tiles_count);
        
        // Initialize ALK system FIRST (may fix missing asphalt around stations)
        // This needs to happen BEFORE compressed chunk data generation
        log::info!("Initializing ALK system (checking for missing asphalt)...");
        match crate::alk::init_alk_system(ctx) {
            Ok(_) => log::info!("ALK system initialized successfully"),
            Err(e) => log::error!("Failed to initialize ALK system: {}", e),
        }

        // Initialize Matronage system (pooled rewards)
        log::info!("Initializing Matronage system...");
        match crate::matronage::init_matronage_system(ctx) {
            Ok(_) => log::info!("Matronage system initialized successfully"),
            Err(e) => log::error!("Failed to initialize Matronage system: {}", e),
        }

        // Check if coastal spawn points exist, generate if missing
        let existing_spawn_points_count = ctx.db.coastal_spawn_point().iter().count();
        if existing_spawn_points_count == 0 {
            log::info!("No coastal spawn points found, generating...");
            match crate::populate_coastal_spawn_points(ctx) {
                Ok(_) => log::info!("Coastal spawn points generated successfully"),
                Err(e) => log::error!("Failed to generate coastal spawn points: {}", e),
            }
        } else {
            log::info!("Coastal spawn points already exist ({}), skipping generation", existing_spawn_points_count);
        }

        // Check if minimap cache exists, generate if missing
        let existing_minimap_count = ctx.db.minimap_cache().iter().count();
        if existing_minimap_count == 0 {
            log::info!("No minimap cache found, generating...");
            match crate::world_generation::generate_minimap_data(ctx, 300, 300) {
                Ok(_) => log::info!("Minimap cache generated successfully"),
                Err(e) => log::error!("Failed to generate minimap cache: {}", e),
            }
        } else {
            log::info!("Minimap cache already exists ({}), skipping generation", existing_minimap_count);
        }
        
        // Check if compressed chunk data exists, generate if missing
        let existing_chunk_data_count = ctx.db.world_chunk_data().iter().count();
        if existing_chunk_data_count == 0 {
            log::info!("No compressed chunk data found, generating...");
            match crate::world_generation::generate_compressed_chunk_data(ctx) {
                Ok(_) => log::info!("Compressed chunk data generated successfully"),
                Err(e) => log::error!("Failed to generate compressed chunk data: {}", e),
            }
        } else {
            log::info!("Compressed chunk data already exists ({}), skipping generation", existing_chunk_data_count);
        }
    }

    // ADD: Initialize beacon event system (airdrop-style memory beacon spawning)
    crate::beacon_event::init_beacon_event_system(ctx);

    log::info!("Module initialization complete.");
    Ok(())
}

/// Reducer that handles client connection events.
/// Pause game systems when no players are online to save reducer transactions.
/// Deletes schedule rows for projectiles, wild animal AI, dodge roll cleanup,
/// turrets, hostile spawning, dawn cleanup, fumaroles, effects, crafting,
/// player stats, clouds, and spawn zone.
fn pause_game_systems(ctx: &ReducerContext) {
    log::info!("[GameSystems] Pausing game systems (no players online)");
    let projectile_ids: Vec<u64> = ctx.db.projectile_update_schedule().iter().map(|r| r.id).collect();
    for id in projectile_ids {
        ctx.db.projectile_update_schedule().id().delete(id);
    }
    let animal_ids: Vec<u64> = ctx.db.wild_animal_ai_schedule().iter().map(|r| r.id).collect();
    for id in animal_ids {
        ctx.db.wild_animal_ai_schedule().id().delete(id);
    }
    let dodge_ids: Vec<u64> = ctx.db.dodge_roll_cleanup_schedule().iter().map(|r| r.id).collect();
    for id in dodge_ids {
        ctx.db.dodge_roll_cleanup_schedule().id().delete(id);
    }
    let turret_ids: Vec<u64> = ctx.db.turret_processing_schedule().iter().map(|r| r.id).collect();
    for id in turret_ids {
        ctx.db.turret_processing_schedule().id().delete(id);
    }
    let spawn_ids: Vec<u64> = ctx.db.hostile_spawn_schedule().iter().map(|r| r.scheduled_id).collect();
    for id in spawn_ids {
        ctx.db.hostile_spawn_schedule().scheduled_id().delete(&id);
    }
    let dawn_ids: Vec<u64> = ctx.db.hostile_dawn_cleanup_schedule().iter().map(|r| r.scheduled_id).collect();
    for id in dawn_ids {
        ctx.db.hostile_dawn_cleanup_schedule().scheduled_id().delete(&id);
    }
    let fumarole_ids: Vec<u64> = ctx.db.fumarole_global_schedule().iter().map(|r| r.id).collect();
    for id in fumarole_ids {
        ctx.db.fumarole_global_schedule().id().delete(id);
    }
    let effects_ids: Vec<u64> = ctx.db.process_effects_schedule().iter().map(|r| r.job_id).collect();
    for id in effects_ids {
        ctx.db.process_effects_schedule().job_id().delete(&id);
    }
    let crafting_ids: Vec<u64> = ctx.db.crafting_finish_schedule().iter().map(|r| r.id).collect();
    for id in crafting_ids {
        ctx.db.crafting_finish_schedule().id().delete(id);
    }
    let player_stat_ids: Vec<u64> = ctx.db.player_stat_schedule().iter().map(|r| r.id).collect();
    for id in player_stat_ids {
        ctx.db.player_stat_schedule().id().delete(id);
    }
    let cloud_update_ids: Vec<u64> = ctx.db.cloud_update_schedule().iter().map(|r| r.schedule_id).collect();
    for id in cloud_update_ids {
        ctx.db.cloud_update_schedule().schedule_id().delete(&id);
    }
    let cloud_intensity_ids: Vec<u64> = ctx.db.cloud_intensity_schedule().iter().map(|r| r.schedule_id).collect();
    for id in cloud_intensity_ids {
        ctx.db.cloud_intensity_schedule().schedule_id().delete(&id);
    }
    let spawn_zone_ids: Vec<u64> = ctx.db.spawn_zone_schedule().iter().map(|r| r.id).collect();
    for id in spawn_zone_ids {
        ctx.db.spawn_zone_schedule().id().delete(id);
    }
    // Global schedules (campfire, furnace, barbecue, broth_pot, lantern - converted from per-entity)
    let campfire_global_ids: Vec<u64> = ctx.db.campfire_global_schedule().iter().map(|r| r.id).collect();
    for id in campfire_global_ids {
        ctx.db.campfire_global_schedule().id().delete(id);
    }
    let furnace_ids: Vec<u64> = ctx.db.furnace_processing_schedule().iter().map(|r| r.furnace_id).collect();
    for id in furnace_ids {
        ctx.db.furnace_processing_schedule().furnace_id().delete(id);
    }
    let barbecue_ids: Vec<u64> = ctx.db.barbecue_processing_schedule().iter().map(|r| r.barbecue_id).collect();
    for id in barbecue_ids {
        ctx.db.barbecue_processing_schedule().barbecue_id().delete(id);
    }
    let broth_pot_ids: Vec<u64> = ctx.db.broth_pot_processing_schedule().iter().map(|r| r.broth_pot_id).collect();
    for id in broth_pot_ids {
        ctx.db.broth_pot_processing_schedule().broth_pot_id().delete(id);
    }
    let lantern_ids: Vec<u64> = ctx.db.lantern_processing_schedule().iter().map(|r| r.lantern_id).collect();
    for id in lantern_ids {
        ctx.db.lantern_processing_schedule().lantern_id().delete(id);
    }
    // Global schedules
    let global_tick_ids: Vec<u64> = ctx.db.global_tick_schedule().iter().map(|r| r.id).collect();
    for id in global_tick_ids {
        ctx.db.global_tick_schedule().id().delete(id);
    }
    let dropped_item_ids: Vec<u64> = ctx.db.dropped_item_despawn_schedule().iter().map(|r| r.id).collect();
    for id in dropped_item_ids {
        ctx.db.dropped_item_despawn_schedule().id().delete(id);
    }
    let flare_expiry_ids: Vec<u64> = ctx.db.flare_expiry_schedule().iter().map(|r| r.id).collect();
    for id in flare_expiry_ids {
        ctx.db.flare_expiry_schedule().id().delete(id);
    }
    let alk_ids: Vec<u64> = ctx.db.alk_contract_refresh_schedule().iter().map(|r| r.schedule_id).collect();
    for id in alk_ids {
        ctx.db.alk_contract_refresh_schedule().schedule_id().delete(&id);
    }
    let sound_ids: Vec<u64> = ctx.db.sound_event_cleanup_schedule().iter().map(|r| r.schedule_id).collect();
    for id in sound_ids {
        ctx.db.sound_event_cleanup_schedule().schedule_id().delete(&id);
    }
    let thunder_cleanup_ids: Vec<u64> = ctx.db.thunder_event_cleanup_schedule().iter().map(|r| r.schedule_id).collect();
    for id in thunder_cleanup_ids {
        ctx.db.thunder_event_cleanup_schedule().schedule_id().delete(&id);
    }
    let thunder_sound_ids: Vec<u64> = ctx.db.thunder_sound_schedule().iter().map(|r| r.schedule_id).collect();
    for id in thunder_sound_ids {
        ctx.db.thunder_sound_schedule().schedule_id().delete(&id);
    }
    let seasonal_ids: Vec<u64> = ctx.db.seasonal_plant_management_schedule().iter().map(|r| r.schedule_id).collect();
    for id in seasonal_ids {
        ctx.db.seasonal_plant_management_schedule().schedule_id().delete(&id);
    }
    let drone_daily_ids: Vec<u64> = ctx.db.drone_daily_schedule().iter().map(|r| r.schedule_id).collect();
    for id in drone_daily_ids {
        ctx.db.drone_daily_schedule().schedule_id().delete(&id);
    }
    let drone_flight_ids: Vec<u64> = ctx.db.drone_flight_schedule().iter().map(|r| r.schedule_id).collect();
    for id in drone_flight_ids {
        ctx.db.drone_flight_schedule().schedule_id().delete(&id);
    }
    let compost_ids: Vec<u64> = ctx.db.compost_process_schedule().iter().map(|r| r.id).collect();
    for id in compost_ids {
        ctx.db.compost_process_schedule().id().delete(id);
    }
    let tanning_ids: Vec<u64> = ctx.db.tanning_process_schedule().iter().map(|r| r.id).collect();
    for id in tanning_ids {
        ctx.db.tanning_process_schedule().id().delete(id);
    }
    let torch_ids: Vec<u64> = ctx.db.torch_durability_schedule().iter().map(|r| r.schedule_id).collect();
    for id in torch_ids {
        ctx.db.torch_durability_schedule().schedule_id().delete(&id);
    }
    let food_spoilage_ids: Vec<u64> = ctx.db.food_spoilage_schedule().iter().map(|r| r.schedule_id).collect();
    for id in food_spoilage_ids {
        ctx.db.food_spoilage_schedule().schedule_id().delete(&id);
    }
    let barrel_ids: Vec<u64> = ctx.db.barrel_respawn_schedule().iter().map(|r| r.id).collect();
    for id in barrel_ids {
        ctx.db.barrel_respawn_schedule().id().delete(id);
    }
    let caribou_ids: Vec<u64> = ctx.db.caribou_breeding_schedule().iter().map(|r| r.schedule_id).collect();
    for id in caribou_ids {
        ctx.db.caribou_breeding_schedule().schedule_id().delete(&id);
    }
    let walrus_ids: Vec<u64> = ctx.db.walrus_breeding_schedule().iter().map(|r| r.schedule_id).collect();
    for id in walrus_ids {
        ctx.db.walrus_breeding_schedule().schedule_id().delete(&id);
    }
    let beehive_ids: Vec<u64> = ctx.db.beehive_process_schedule().iter().map(|r| r.id).collect();
    for id in beehive_ids {
        ctx.db.beehive_process_schedule().id().delete(id);
    }
    let planted_seed_ids: Vec<u64> = ctx.db.planted_seed_growth_schedule().iter().map(|r| r.id).collect();
    for id in planted_seed_ids {
        ctx.db.planted_seed_growth_schedule().id().delete(id);
    }
    let explosive_ids: Vec<u64> = ctx.db.explosive_detonation_schedule().iter().map(|r| r.id).collect();
    for id in explosive_ids {
        ctx.db.explosive_detonation_schedule().id().delete(id);
    }
    let grenade_ids: Vec<u64> = ctx.db.grenade_fuse_schedule().iter().map(|r| r.id).collect();
    for id in grenade_ids {
        ctx.db.grenade_fuse_schedule().id().delete(id);
    }
    let grass_ids: Vec<u64> = ctx.db.grass_respawn_batch_schedule().iter().map(|r| r.schedule_id).collect();
    for id in grass_ids {
        ctx.db.grass_respawn_batch_schedule().schedule_id().delete(&id);
    }
    let fire_cleanup_ids: Vec<u64> = ctx.db.fire_patch_cleanup_schedule().iter().map(|r| r.id).collect();
    for id in fire_cleanup_ids {
        ctx.db.fire_patch_cleanup_schedule().id().delete(id);
    }
    let fire_damage_ids: Vec<u64> = ctx.db.fire_patch_damage_schedule().iter().map(|r| r.id).collect();
    for id in fire_damage_ids {
        ctx.db.fire_patch_damage_schedule().id().delete(id);
    }
    let fish_trap_ids: Vec<u64> = ctx.db.fish_trap_process_schedule().iter().map(|r| r.id).collect();
    for id in fish_trap_ids {
        ctx.db.fish_trap_process_schedule().id().delete(id);
    }
    let backpack_ids: Vec<u64> = ctx.db.backpack_consolidation_schedule().iter().map(|r| r.id).collect();
    for id in backpack_ids {
        ctx.db.backpack_consolidation_schedule().id().delete(id);
    }
    let building_priv_ids: Vec<u64> = ctx.db.building_privilege_check_schedule().iter().map(|r| r.id).collect();
    for id in building_priv_ids {
        ctx.db.building_privilege_check_schedule().id().delete(id);
    }
    let hearth_ids: Vec<u64> = ctx.db.hearth_upkeep_schedule().iter().map(|r| r.id).collect();
    for id in hearth_ids {
        ctx.db.hearth_upkeep_schedule().id().delete(id);
    }
    let decay_ids: Vec<u64> = ctx.db.building_decay_schedule().iter().map(|r| r.id).collect();
    for id in decay_ids {
        ctx.db.building_decay_schedule().id().delete(id);
    }
    let water_patch_ids: Vec<u64> = ctx.db.water_patch_cleanup_schedule().iter().map(|r| r.id).collect();
    for id in water_patch_ids {
        ctx.db.water_patch_cleanup_schedule().id().delete(id);
    }
    let fertilizer_ids: Vec<u64> = ctx.db.fertilizer_patch_cleanup_schedule().iter().map(|r| r.id).collect();
    for id in fertilizer_ids {
        ctx.db.fertilizer_patch_cleanup_schedule().id().delete(id);
    }
    let tilled_ids: Vec<u64> = ctx.db.tilled_tile_reversion_schedule().iter().map(|r| r.id).collect();
    for id in tilled_ids {
        ctx.db.tilled_tile_reversion_schedule().id().delete(id);
    }
    let water_container_ids: Vec<u64> = ctx.db.water_container_fill_schedule().iter().map(|r| r.schedule_id).collect();
    for id in water_container_ids {
        ctx.db.water_container_fill_schedule().schedule_id().delete(&id);
    }
    let matronage_ids: Vec<u64> = ctx.db.matronage_payout_schedule().iter().map(|r| r.id).collect();
    for id in matronage_ids {
        ctx.db.matronage_payout_schedule().id().delete(id);
    }
    let rune_shard_ids: Vec<u64> = ctx.db.rune_stone_shard_spawn_schedule().iter().map(|r| r.id).collect();
    for id in rune_shard_ids {
        ctx.db.rune_stone_shard_spawn_schedule().id().delete(id);
    }
    let rune_item_ids: Vec<u64> = ctx.db.rune_stone_item_spawn_schedule().iter().map(|r| r.id).collect();
    for id in rune_item_ids {
        ctx.db.rune_stone_item_spawn_schedule().id().delete(id);
    }
    let rune_seed_ids: Vec<u64> = ctx.db.rune_stone_seed_spawn_schedule().iter().map(|r| r.id).collect();
    for id in rune_seed_ids {
        ctx.db.rune_stone_seed_spawn_schedule().id().delete(id);
    }
}

/// Resume game systems when first player connects.
fn resume_game_systems(ctx: &ReducerContext) -> Result<(), String> {
    log::info!("[GameSystems] Resuming game systems");
    // Already-paused systems (from previous implementation)
    crate::projectile::init_projectile_system(ctx)?;
    crate::wild_animal_npc::init_wild_animal_ai_schedule(ctx)?;
    crate::player_movement::init_dodge_roll_cleanup_system(ctx)?;
    crate::turret::init_turret_system(ctx)?;
    crate::wild_animal_npc::init_hostile_spawning_system(ctx)?;
    crate::fumarole::init_fumarole_global_schedule(ctx)?;
    crate::campfire::init_campfire_global_schedule(ctx)?;
    crate::active_effects::schedule_effect_processing(ctx)?;
    crate::crafting_queue::init_crafting_schedule(ctx)?;
    crate::player_stats::init_player_stat_schedule(ctx)?;
    crate::cloud::init_cloud_update_schedule(ctx)?;
    crate::cloud::init_cloud_intensity_system(ctx)?;
    crate::wild_animal_npc::respawn::init_spawn_zone_schedule(ctx)?;
    // Per-entity schedules: reschedule each entity that needs processing
    // Campfire uses global schedule (init_campfire_global_schedule called above with fumarole)
    for furnace in ctx.db.furnace().iter() {
        let _ = crate::furnace::schedule_next_furnace_processing(ctx, furnace.id);
    }
    for barbecue in ctx.db.barbecue().iter() {
        let _ = crate::barbecue::schedule_next_barbecue_processing(ctx, barbecue.id);
    }
    for broth_pot in ctx.db.broth_pot().iter() {
        let _ = crate::broth_pot::schedule_next_broth_pot_processing(ctx, broth_pot.id);
    }
    for lantern in ctx.db.lantern().iter() {
        let _ = crate::lantern::schedule_next_lantern_processing(ctx, lantern.id);
    }
    // Global schedules
    crate::global_tick::init_global_tick_schedule(ctx)?;
    crate::dropped_item::init_dropped_item_schedule(ctx)?;
    crate::dropped_item::init_flare_expiry_schedule(ctx);
    crate::alk::init_alk_system(ctx)?;
    crate::sound_events::init_sound_cleanup_system(ctx)?;
    crate::world_state::init_thunder_event_cleanup_schedule(ctx)?;
    // Note: seasonal_plant_management_schedule is created dynamically during tick_world_state when season changes
    crate::drone::init_drone_system(ctx);
    crate::compost::init_compost_system(ctx)?;
    crate::tanning_rack::init_tanning_rack_system(ctx)?;
    crate::durability::init_torch_durability_schedule(ctx)?;
    crate::durability::init_food_spoilage_schedule(ctx)?;
    crate::barrel::init_barrel_system(ctx)?;
    crate::wild_animal_npc::caribou::init_caribou_breeding_schedule(ctx)?;
    crate::wild_animal_npc::walrus::init_walrus_breeding_schedule(ctx)?;
    crate::beehive::init_beehive_system(ctx)?;
    crate::planted_seeds::init_plant_growth_system(ctx)?;
    crate::explosive::init_explosive_system(ctx)?;
    crate::grenade::init_grenade_system(ctx)?;
    crate::grass::init_grass_respawn_scheduler(ctx);
    crate::fire_patch::init_fire_patch_system(ctx)?;
    crate::fish_trap::init_fish_trap_system(ctx)?;
    crate::backpack::init_backpack_consolidation_schedule(ctx)?;
    crate::homestead_hearth::init_building_privilege_check_schedule(ctx)?;
    crate::homestead_hearth::init_hearth_upkeep_schedule(ctx)?;
    crate::building_decay::init_building_decay_schedule(ctx)?;
    crate::water_patch::init_water_patch_system(ctx)?;
    crate::fertilizer_patch::init_fertilizer_patch_system(ctx)?;
    crate::tilled_tiles::init_tilled_tile_system(ctx)?;
    crate::active_equipment::init_water_container_fill_schedule(ctx)?;
    crate::matronage::init_matronage_system(ctx)?;
    crate::rune_stone::init_rune_stone_shard_spawning(ctx)?;
    crate::rune_stone::init_rune_stone_item_spawning(ctx)?;
    crate::rune_stone::init_rune_stone_seed_spawning(ctx)?;
    Ok(())
}

/// 
/// This reducer is called automatically when a new client connects to the server.
/// It initializes the game world if needed, tracks the client's connection,
/// and updates the player's online status. The world seeding functions are
/// idempotent, so they can be safely called on every connection.
#[spacetimedb::reducer(client_connected)]
pub fn identity_connected(ctx: &ReducerContext) -> Result<(), String> {
    // NOTE: All seeders are now called in init_module only, not here
    // This prevents duplicate inserts when clients reconnect to an existing database
    // The seeders are idempotent but calling them on every client connection is wasteful

    // --- Track Active Connection ---
    let client_identity = ctx.sender();
    let connection_id = ctx.connection_id().ok_or_else(|| {
        log::error!("[Connect] Missing ConnectionId in client_connected context for {:?}", client_identity);
        "Internal error: Missing connection ID on connect".to_string()
    })?;

    crate::monument::repair_alpine_fire_entrance(ctx);

    log::info!("[Connect] Tracking active connection for identity {:?} with connection ID {:?}", 
        client_identity, connection_id);

    let active_connections = ctx.db.active_connection();
    let new_active_conn = ActiveConnection {
        identity: client_identity,
        connection_id,
        timestamp: ctx.timestamp, // Add timestamp
    };

    // --- Resume game systems when first player connects (saves ~23 tx/sec when idle) ---
    let was_empty = active_connections.iter().count() == 0;
    if was_empty {
        if let Err(e) = resume_game_systems(ctx) {
            log::warn!("[Connect] Failed to resume game systems: {}", e);
        }
    }
    // --- End resume game systems ---

    // Insert or update the active connection record
    if active_connections.identity().find(&client_identity).is_some() {
        active_connections.identity().update(new_active_conn);
        log::info!("[Connect] Updated existing active connection record for {:?}.", client_identity);
    } else {
        match active_connections.try_insert(new_active_conn) {
            Ok(_) => {
                log::info!("[Connect] Inserted new active connection record for {:?}.", client_identity);
            }
            Err(e) => {
                log::error!("[Connect] Failed to insert active connection for {:?}: {}", client_identity, e);
                return Err(format!("Failed to track connection: {}", e));
            }
        }
    }
    // --- End Track Active Connection ---

    // --- Set Player Online Status and Handle Offline Corpse Restoration ---
    let players = ctx.db.player();
    if let Some(mut player) = players.identity().find(&client_identity) {
        let mut player_updated = false;
        
        // Set player online if they weren't already
        if !player.is_online {
            player.is_online = true;
            player_updated = true;
            log::info!("[Connect] Set player {:?} to online.", client_identity);
        }
        
        // Handle Offline Corpse Restoration - restore items and delete corpse when player reconnects
        if let Some(corpse_id) = player.offline_corpse_id {
            log::info!("[Connect] Player {} has offline corpse ID {}. Checking if it still exists...", 
                      player.username, corpse_id);
            
            if ctx.db.player_corpse().id().find(corpse_id).is_some() {
                // Corpse still exists - restore items to player and move them back to corpse position
                log::info!("[Connect] Offline corpse {} found. Restoring items to player {}.", 
                          corpse_id, player.username);
                
                match player_corpse::restore_from_offline_corpse(ctx, client_identity, corpse_id) {
                    Ok((corpse_x, corpse_y)) => {
                        // Restore player position to where their corpse was
                        player.position_x = corpse_x;
                        player.position_y = corpse_y;
                        log::info!("[Connect] Successfully restored items from offline corpse {} to player {} at ({:.1}, {:.1}).", 
                                  corpse_id, player.username, corpse_x, corpse_y);
                    }
                    Err(e) => {
                        log::error!("[Connect] Failed to restore items from offline corpse {}: {}", corpse_id, e);
                    }
                }
                player.offline_corpse_id = None;
                player_updated = true;
            } else {
                // Corpse was destroyed - player died while offline
                log::info!("[Connect] Offline corpse {} was destroyed. Player {} died while offline.", 
                          corpse_id, player.username);
                player.is_dead = true;
                player.death_timestamp = Some(ctx.timestamp);
                player.offline_corpse_id = None;
                player_updated = true;
                
                // Clear all active effects on death (any lingering effects from before disconnect)
                active_effects::clear_all_effects_on_death(ctx, player.identity);
                log::info!("[Connect] Cleared all active effects for player {:?} who died while offline", player.identity);
            }
        }
        
        // Only update if something changed
        if player_updated {
            players.identity().update(player);
        }
        
        // Reconcile tutorial quest progress with current inventory (count existing items)
        // So players who already have 400 wood, 200 stone, Stone Hatchet, etc. get credit on connect
        if let Err(e) = crate::quests::reconcile_tutorial_quest_progress(ctx, client_identity) {
            log::warn!("[Connect] Failed to reconcile tutorial quest progress for {:?}: {}", client_identity, e);
        }
        
        // Check for daily login rewards
        if let Some(world_state) = ctx.db.world_state().iter().next() {
            let current_day = world_state.day_of_year;
            let mut stats = crate::player_progression::get_or_init_player_stats(ctx, client_identity);
            
            // Check if this is a new day
            if stats.last_login_day != current_day {
                let days_since_last_login = if current_day > stats.last_login_day {
                    current_day - stats.last_login_day
                } else {
                    // Year rollover
                    (360 - stats.last_login_day) + current_day
                };
                
                // Update streak (reset if gap > 1 day, otherwise increment)
                if days_since_last_login == 1 {
                    stats.login_streak_days += 1;
                } else {
                    stats.login_streak_days = 1; // Reset streak
                }
                
                // Calculate reward day (1-7, loops)
                let reward_day = ((stats.login_streak_days - 1) % 7) + 1;
                
                // Get daily reward
                if let Some(daily_reward) = ctx.db.daily_login_reward().day().find(&reward_day) {
                    // Award shards
                    let memory_shard_def_id = ctx.db.item_definition().iter()
                        .find(|def| def.name == "Memory Shard")
                        .map(|def| def.id);
                    
                    if let Some(shard_def_id) = memory_shard_def_id {
                        match crate::dropped_item::give_item_to_player_or_drop(ctx, client_identity, shard_def_id, daily_reward.shard_reward as u32) {
                            Ok(_) => {
                                log::info!("Daily login reward: {} shards awarded to player {}", daily_reward.shard_reward, client_identity);
                            }
                            Err(e) => {
                                log::error!("Failed to award daily login shards: {}", e);
                            }
                        }
                    }
                    
                    // Award XP
                    if let Err(e) = crate::player_progression::award_xp(ctx, client_identity, daily_reward.bonus_xp) {
                        log::error!("Failed to award daily login XP: {}", e);
                    }
                    
                    // Update stats
                    stats.total_shards_earned += daily_reward.shard_reward as u64;
                    stats.last_login_day = current_day;
                    stats.updated_at = ctx.timestamp;
                    ctx.db.player_stats().player_id().update(stats.clone());
                    
                    // Send notification
                    let notif = crate::player_progression::DailyLoginNotification {
                        id: 0,
                        player_id: client_identity,
                        day: reward_day,
                        shard_reward: daily_reward.shard_reward,
                        bonus_xp: daily_reward.bonus_xp,
                        streak_days: stats.login_streak_days,
                        unlocked_at: ctx.timestamp,
                    };
                    ctx.db.daily_login_notification().insert(notif);
                    
                    log::info!("Daily login reward processed for player {}: Day {}, Streak {} days", 
                              client_identity, reward_day, stats.login_streak_days);
                }
                
                // Assign daily quests for this new day
                if let Err(e) = crate::quests::assign_daily_quests(ctx, client_identity) {
                    log::error!("[Connect] Failed to assign daily quests for player {:?}: {}", client_identity, e);
                }
            } else {
                // Same day login - still try to assign quests (function is idempotent)
                // This handles edge cases like new players or players who somehow missed assignment
                if let Err(e) = crate::quests::assign_daily_quests(ctx, client_identity) {
                    log::error!("[Connect] Failed to assign daily quests for player {:?}: {}", client_identity, e);
                }
            }
        }
        
        // Initialize tutorial progress if not exists (so existing players without quests get them)
        // This is idempotent - won't overwrite existing progress
        let progress = crate::quests::get_or_init_tutorial_progress(ctx, client_identity);
        log::info!("[Connect] Tutorial progress for {:?}: quest_idx={}, completed={}", 
                   client_identity, progress.current_quest_index, progress.tutorial_completed);
    } else {
        // Player might not be registered yet, which is fine. is_online will be set during registration.
        log::debug!("[Connect] Player {:?} not found in Player table yet (likely needs registration).", client_identity);
    }
    // --- End Set Player Online Status and Offline Corpse Restoration ---

    // Note: Initial scheduling for player stats happens in register_player
    // Note: Initial scheduling for global ticks happens in init_module
    Ok(())
}

/// Reducer that handles client disconnection events.
/// 
/// This reducer is called automatically when a client disconnects from the server.
/// It performs necessary cleanup including:
/// - Removing the active connection record if it matches the disconnecting connection
/// - Setting the player's online status to false
/// - Preserving state if the player has already reconnected
#[spacetimedb::reducer(client_disconnected)]
pub fn identity_disconnected(ctx: &ReducerContext) {
    let sender_id = ctx.sender();
    let disconnecting_connection_id = match ctx.connection_id() {
        Some(id) => id,
        None => {
            return;
        }
    };

    let active_connections = ctx.db.active_connection();
    let players = ctx.db.player(); // <<< Need players table handle

    // --- Check 1: Does the active connection record match the disconnecting one? ---
    if let Some(initial_active_conn) = active_connections.identity().find(&sender_id) {
        if initial_active_conn.connection_id == disconnecting_connection_id {

            // --- Clean Up Connection --- 
            let was_last_player = active_connections.iter().count() == 1;
            active_connections.identity().delete(&sender_id);
            // --- END Clean Up Connection --- 

            // --- Pause game systems when last player leaves (saves ~23 tx/sec when idle) ---
            if was_last_player {
                pause_game_systems(ctx);
            }
            // --- End pause game systems ---

            // --- Set Player Offline Status and Create Offline Corpse --- 
            // NPCs are treated identically to human players here:
            // they create lootable offline corpses, so other players can raid them.
            if let Some(mut player) = players.identity().find(&sender_id) {
                 if player.is_online { // Only update if they were marked online
                    player.is_online = false;
                    
                    // Create offline corpse if player is not dead (NPCs and humans alike)
                    if !player.is_dead {
                        match player_corpse::create_offline_corpse(ctx, &player) {
                            Ok(corpse_id) => {
                                player.offline_corpse_id = Some(corpse_id);
                                log::info!("[Disconnect] Created offline corpse {} for {} {:?}", 
                                    corpse_id, if player.is_npc { "NPC" } else { "player" }, sender_id);
                            }
                            Err(e) => {
                                log::error!("[Disconnect] Failed to create offline corpse for {:?}: {}", sender_id, e);
                            }
                        }
                    } else {
                        log::info!("[Disconnect] {:?} is dead, no offline corpse needed.", sender_id);
                    }
                    
                    let is_npc = player.is_npc;
                    players.identity().update(player);
                    log::info!("[Disconnect] Set {} {:?} to offline.", 
                        if is_npc { "NPC" } else { "player" }, sender_id);
                 }
            } else {
                 log::warn!("[Disconnect] Player {:?} not found in Player table during disconnect cleanup.", sender_id);
            }
            // --- END Set Player Offline Status --- 

        } else {
            // The connection ID doesn't match the current active one. 
            // This means the player reconnected quickly before the old disconnect processed fully.
            // In this case, DO NOTHING. The new connection is already active, 
            // and we don't want to mark them offline or mess with their new state.
            log::debug!("[Disconnect] Connection ID mismatch for {:?}. Likely reconnected quickly.", sender_id);
        }
    } else {
        // No active connection found for this identity, maybe they disconnected before fully registering?
        // Or maybe the disconnect arrived *very* late after a new connection replaced the record.
        log::debug!("[Disconnect] No active connection found for {:?}. May have disconnected before registering.", sender_id);
    }
}

/// Reducer that handles player registration and reconnection.
/// 
/// This reducer is called when a player first joins the game or reconnects after disconnecting.
/// For new players, it creates their initial game state and grants starting items.
/// For existing players, it updates their connection status and timestamps.
#[spacetimedb::reducer]
pub fn register_player(ctx: &ReducerContext, username: String) -> Result<(), String> {
    let sender_id = ctx.sender();
    let players = ctx.db.player();
    log::info!("Attempting registration/login for identity: {:?}, username: {}", sender_id, username);

    // --- Check if player already exists for this authenticated identity ---
    if let Some(mut existing_player) = players.identity().find(&sender_id) { 
        log::info!("[RegisterPlayer] Found existing player {} ({:?}).",
                 existing_player.username, sender_id);
        
        // --- MODIFIED: Only update timestamp on reconnect ---
        let update_timestamp = ctx.timestamp; // Capture timestamp for consistency
        existing_player.last_update = update_timestamp; // Always update player timestamp

        // --- Handle Offline Corpse Restoration ---
        if let Some(corpse_id) = existing_player.offline_corpse_id {
            log::info!("[RegisterPlayer] Player {} has offline corpse ID {}. Checking if it still exists...", 
                      existing_player.username, corpse_id);
            
            if ctx.db.player_corpse().id().find(corpse_id).is_some() {
                // Corpse still exists - restore items to player and move them back to corpse position
                log::info!("[RegisterPlayer] Offline corpse {} found. Restoring items to player {}.", 
                          corpse_id, existing_player.username);
                
                match player_corpse::restore_from_offline_corpse(ctx, sender_id, corpse_id) {
                    Ok((corpse_x, corpse_y)) => {
                        // Restore player position to where their corpse was
                        existing_player.position_x = corpse_x;
                        existing_player.position_y = corpse_y;
                        log::info!("[RegisterPlayer] Successfully restored items from offline corpse {} to player {} at ({:.1}, {:.1}).", 
                                  corpse_id, existing_player.username, corpse_x, corpse_y);
                    }
                    Err(e) => {
                        log::error!("[RegisterPlayer] Failed to restore items from offline corpse {}: {}", corpse_id, e);
                    }
                }
                existing_player.offline_corpse_id = None;
            } else {
                // Corpse was destroyed - player died while offline
                log::info!("[RegisterPlayer] Offline corpse {} was destroyed. Player {} died while offline.", 
                          corpse_id, existing_player.username);
                existing_player.is_dead = true;
                existing_player.death_timestamp = Some(ctx.timestamp);
                existing_player.offline_corpse_id = None;
                
                // Clear all active effects on death (any lingering effects from before disconnect)
                active_effects::clear_all_effects_on_death(ctx, existing_player.identity);
                log::info!("[RegisterPlayer] Cleared all active effects for player {:?} who died while offline", existing_player.identity);
            }
        }
        // --- END Handle Offline Corpse Restoration ---

        players.identity().update(existing_player.clone()); // Perform the player update

        // --- ALSO Update ActiveConnection record --- 
        let connection_id = ctx.connection_id().ok_or_else(|| {
            log::error!("[RegisterPlayer] Missing ConnectionId in context for existing player {:?}", sender_id);
            "Internal error: Missing connection ID on reconnect".to_string()
        })?;
        
        let active_connections = ctx.db.active_connection();
        let updated_active_conn = ActiveConnection {
            identity: sender_id,
            connection_id,
            timestamp: update_timestamp, // Use the SAME timestamp as player update
        };

        if active_connections.identity().find(&sender_id).is_some() {
            active_connections.identity().update(updated_active_conn);
            log::info!("[RegisterPlayer] Updated active connection record for {:?} with timestamp {:?}.", sender_id, update_timestamp);
        } else {
            match active_connections.try_insert(updated_active_conn) {
                Ok(_) => {
                    log::info!("[RegisterPlayer] Inserted missing active connection record for {:?} with timestamp {:?}.", sender_id, update_timestamp);
                }
                Err(e) => {
                    log::error!("[RegisterPlayer] Failed to insert missing active connection for {:?}: {}", sender_id, e);
                }
            }
        }

        return Ok(());
    }

    // --- Player does not exist, proceed with registration ---
    log::info!("New player registration for identity: {:?}. Finding spawn...", sender_id);

    // Check if desired username is taken by *another* player
    // Note: We check this *after* checking if the current identity is already registered
    let username_taken_by_other = players.iter().any(|p| p.username == username && p.identity != sender_id);
    if username_taken_by_other {
        log::warn!("Username '{}' already taken by another player. Registration failed for {:?}.", username, sender_id);
        return Err(format!("Username '{}' is already taken.", username));
    }

    // --- Enforce max player cap for new registrations (reconnects allowed when full) ---
    let active_connections = ctx.db.active_connection();
    let online_human_count = active_connections.iter()
        .filter(|conn| {
            if let Some(player) = players.identity().find(&conn.identity) {
                !player.is_npc
            } else {
                true // No player record yet - new human connecting
            }
        })
        .count();
    if online_human_count >= MAX_PLAYERS {
        log::warn!("Server full ({} players online). Rejecting new registration for {:?}.", online_human_count, sender_id);
        return Err(format!(
            "Server is full ({} players online). Please try again later.",
            MAX_PLAYERS
        ));
    }
    // --- End max player cap ---

    // Get tables needed for spawn check only if registering new player
    let trees = ctx.db.tree();
    let stones = ctx.db.stone();
    let rune_stones = ctx.db.rune_stone();
    let campfires = ctx.db.campfire();
    let wooden_storage_boxes = ctx.db.wooden_storage_box();

    // --- Find a valid spawn position ---
    // FIRST-TIME PLAYERS: Spawn at the shipwreck (thematic - they washed ashore from the wreck)
    // FALLBACK: Random coastal beach spawn if shipwreck doesn't exist
    
    let mut spawn_x: f32 = 0.0;
    let mut spawn_y: f32 = 0.0;
    let mut found_shipwreck_spawn = false;
    
    // Try to spawn at shipwreck first (for new players - thematic spawn location)
    if let Some(shipwreck_center) = ctx.db.monument_part().iter()
        .find(|part| part.monument_type == crate::MonumentType::Shipwreck && part.is_center) {
        log::info!("🚢 Found shipwreck center at ({:.0}, {:.0}) - attempting to spawn new player nearby", 
                   shipwreck_center.world_x, shipwreck_center.world_y);
        
        // Generate spawn positions around the shipwreck (within 200-400 pixels of center)
        let spawn_radius_min = 150.0;
        let spawn_radius_max = 350.0;
        let max_shipwreck_attempts = 30;
        
        for attempt in 0..max_shipwreck_attempts {
            // Random angle and distance from shipwreck center
            let angle = ctx.rng().gen_range(0.0..std::f32::consts::TAU);
            let distance = ctx.rng().gen_range(spawn_radius_min..spawn_radius_max);
            
            let test_x = shipwreck_center.world_x + angle.cos() * distance;
            let test_y = shipwreck_center.world_y + angle.sin() * distance;
            
            // Check if position is on valid terrain (beach)
            let tile_x = (test_x / TILE_SIZE_PX as f32).floor() as i32;
            let tile_y = (test_y / TILE_SIZE_PX as f32).floor() as i32;
            
            if let Some(tile_type) = get_tile_type_at_position(ctx, tile_x, tile_y) {
                // Allow Beach or Grass tiles near shipwreck
                if tile_type == TileType::Beach || tile_type == TileType::Grass {
                    // Check for collisions using spatial grid
                    let spatial_grid = crate::spatial_grid::get_cached_spatial_grid(&ctx.db, ctx.timestamp);
                    let nearby_entities = spatial_grid.get_entities_in_range(test_x, test_y);
                    
                    let mut collision = false;
                    for entity in nearby_entities {
                        match entity {
                            crate::spatial_grid::EntityType::Player(other_id) => {
                                if other_id == sender_id { continue; }
                                if let Some(other) = players.identity().find(&other_id) {
                                    if other.is_dead { continue; }
                                    let dx = test_x - other.position_x;
                                    let dy = test_y - other.position_y;
                                    if dx * dx + dy * dy < PLAYER_RADIUS * PLAYER_RADIUS * 4.0 {
                                        collision = true;
                                        break;
                                    }
                                }
                            },
                            crate::spatial_grid::EntityType::Tree(tree_id) => {
                                if let Some(tree) = trees.id().find(&tree_id) {
                                    if tree.health == 0 { continue; }
                                    let dx = test_x - tree.pos_x;
                                    let dy = test_y - (tree.pos_y - crate::tree::TREE_COLLISION_Y_OFFSET);
                                    if dx * dx + dy * dy < crate::tree::PLAYER_TREE_COLLISION_DISTANCE_SQUARED * 0.8 {
                                        collision = true;
                                        break;
                                    }
                                }
                            },
                            crate::spatial_grid::EntityType::Stone(stone_id) => {
                                if let Some(stone) = stones.id().find(&stone_id) {
                                    if stone.health == 0 { continue; }
                                    let dx = test_x - stone.pos_x;
                                    let dy = test_y - (stone.pos_y - crate::stone::STONE_COLLISION_Y_OFFSET);
                                    if dx * dx + dy * dy < crate::stone::PLAYER_STONE_COLLISION_DISTANCE_SQUARED * 0.8 {
                                        collision = true;
                                        break;
                                    }
                                }
                            },
                            _ => {} // Ignore other entity types
                        }
                        if collision { break; }
                    }
                    
                    if !collision {
                        spawn_x = test_x;
                        spawn_y = test_y;
                        found_shipwreck_spawn = true;
                        log::info!("🚢✨ SUCCESS: New player will spawn near shipwreck at ({:.1}, {:.1}) after {} attempts", 
                                   spawn_x, spawn_y, attempt + 1);
                        break;
                    }
                }
            }
        }
        
        if !found_shipwreck_spawn {
            log::warn!("🚢 Could not find valid spawn near shipwreck after {} attempts, falling back to coastal spawn", 
                       max_shipwreck_attempts);
        }
    } else {
        log::info!("No shipwreck found in world, using coastal beach spawn");
    }
    
    // FALLBACK: Coastal beach spawn if shipwreck spawn failed
    if !found_shipwreck_spawn {
    
    // Strategy 1: Random sampling (fast, works most of the time)
    // Strategy 2: Perimeter scan (guaranteed to find beaches around island edge)
    // Strategy 3: Emergency fallback (find ANY non-water tile)
    
    let mut coastal_beach_tiles: Vec<(i32, i32)> = Vec::new(); // Store just (x, y) coordinates
    let max_search_attempts = 500; // Increased from 100 for better hit rate
    let map_height_half = (WORLD_HEIGHT_TILES / 2) as i32;
    
    log::info!("Searching for coastal beach tiles via random sampling (up to {} attempts)...", max_search_attempts);
    
    // --- STRATEGY 1: Random sampling in southern half ---
    for attempt in 0..max_search_attempts {
        let tile_x = ctx.rng().gen_range(0..WORLD_WIDTH_TILES as i32);
        let tile_y = ctx.rng().gen_range(map_height_half..WORLD_HEIGHT_TILES as i32);
        
        if let Some(tile_type) = get_tile_type_at_position(ctx, tile_x, tile_y) {
            if tile_type == TileType::Beach {
                // Check if coastal (adjacent to water)
                let mut is_coastal = false;
                for dx in -1..=1i32 {
                    for dy in -1..=1i32 {
                        if dx == 0 && dy == 0 { continue; }
                        if let Some(adj_type) = get_tile_type_at_position(ctx, tile_x + dx, tile_y + dy) {
                            if adj_type.is_water() {
                                is_coastal = true;
                                break;
                            }
                        }
                    }
                    if is_coastal { break; }
                }

                if is_coastal {
                    coastal_beach_tiles.push((tile_x, tile_y));
                    if coastal_beach_tiles.len() >= 10 {
                        log::info!("Found {} coastal beach tiles after {} random samples", coastal_beach_tiles.len(), attempt + 1);
                        break;
                    }
                }
            }
        }
    }
    
    // --- STRATEGY 2: Perimeter scan if random sampling failed ---
    // Beaches are guaranteed around the island perimeter, so scan edges
    if coastal_beach_tiles.is_empty() {
        log::warn!("Random sampling found no beach tiles. Scanning island perimeter...");
        
        // Scan the bottom edge (y = near max) - most likely to have beaches
        let perimeter_scan_depth = 30; // Scan 30 tiles inward from edges
        let scan_step = 5; // Check every 5th tile for efficiency
        
        // Bottom edge (high Y values in southern half)
        for y_offset in 0..perimeter_scan_depth {
            let tile_y = (WORLD_HEIGHT_TILES as i32) - 10 - y_offset; // Start 10 tiles from edge
            if tile_y < map_height_half { break; } // Stay in southern half
            
            for tile_x in (0..WORLD_WIDTH_TILES as i32).step_by(scan_step as usize) {
                if let Some(tile_type) = get_tile_type_at_position(ctx, tile_x, tile_y) {
                    if tile_type == TileType::Beach {
                        // Quick coastal check - just need one adjacent water tile
                        for (dx, dy) in [(-1, 0), (1, 0), (0, -1), (0, 1)] {
                            if let Some(adj_type) = get_tile_type_at_position(ctx, tile_x + dx, tile_y + dy) {
                                if adj_type.is_water() {
                                    coastal_beach_tiles.push((tile_x, tile_y));
                                    break;
                                }
                            }
                        }
                    }
                }
                if coastal_beach_tiles.len() >= 10 { break; }
            }
            if coastal_beach_tiles.len() >= 10 { break; }
        }
        
        // Also scan left and right edges if still need more
        if coastal_beach_tiles.len() < 5 {
            for x_offset in 0..perimeter_scan_depth {
                // Left edge
                let tile_x = 10 + x_offset;
                for tile_y in (map_height_half..WORLD_HEIGHT_TILES as i32).step_by(scan_step as usize) {
                    if let Some(tile_type) = get_tile_type_at_position(ctx, tile_x, tile_y) {
                        if tile_type == TileType::Beach {
                            for (dx, dy) in [(-1, 0), (1, 0), (0, -1), (0, 1)] {
                                if let Some(adj_type) = get_tile_type_at_position(ctx, tile_x + dx, tile_y + dy) {
                                    if adj_type.is_water() {
                                        coastal_beach_tiles.push((tile_x, tile_y));
                                        break;
                                    }
                                }
                            }
                        }
                    }
                    if coastal_beach_tiles.len() >= 10 { break; }
                }
                
                // Right edge
                let tile_x = (WORLD_WIDTH_TILES as i32) - 10 - x_offset;
                for tile_y in (map_height_half..WORLD_HEIGHT_TILES as i32).step_by(scan_step as usize) {
                    if let Some(tile_type) = get_tile_type_at_position(ctx, tile_x, tile_y) {
                        if tile_type == TileType::Beach {
                            for (dx, dy) in [(-1, 0), (1, 0), (0, -1), (0, 1)] {
                                if let Some(adj_type) = get_tile_type_at_position(ctx, tile_x + dx, tile_y + dy) {
                                    if adj_type.is_water() {
                                        coastal_beach_tiles.push((tile_x, tile_y));
                                        break;
                                    }
                                }
                            }
                        }
                    }
                    if coastal_beach_tiles.len() >= 10 { break; }
                }
                if coastal_beach_tiles.len() >= 10 { break; }
            }
        }
        
        if !coastal_beach_tiles.is_empty() {
            log::info!("Perimeter scan found {} coastal beach tiles", coastal_beach_tiles.len());
        }
    }
    
    // --- STRATEGY 3: Emergency fallback - find ANY beach tile (not necessarily coastal) ---
    if coastal_beach_tiles.is_empty() {
        log::warn!("Perimeter scan found no coastal beaches. Searching for ANY beach tile...");
        
        // Scan with larger steps to find any beach
        for tile_y in (map_height_half..WORLD_HEIGHT_TILES as i32).step_by(10) {
            for tile_x in (0..WORLD_WIDTH_TILES as i32).step_by(10) {
                if let Some(tile_type) = get_tile_type_at_position(ctx, tile_x, tile_y) {
                    if tile_type == TileType::Beach {
                        coastal_beach_tiles.push((tile_x, tile_y));
                        if coastal_beach_tiles.len() >= 5 { break; }
                    }
                }
            }
            if coastal_beach_tiles.len() >= 5 { break; }
        }
        
        if !coastal_beach_tiles.is_empty() {
            log::info!("Emergency scan found {} beach tiles", coastal_beach_tiles.len());
        }
    }
    
    // --- STRATEGY 4: Last resort - find ANY walkable land tile ---
    if coastal_beach_tiles.is_empty() {
        log::error!("No beach tiles found anywhere! Finding ANY land tile as last resort...");
        
        // Find any grass or dirt tile in the center-ish area
        let center_x = (WORLD_WIDTH_TILES / 2) as i32;
        let center_y = (WORLD_HEIGHT_TILES * 3 / 4) as i32; // 3/4 down (southern half center)
        
        // Spiral outward from center
        for radius in (0..200).step_by(5) {
            for angle in (0..360).step_by(45) {
                let rad = (angle as f32).to_radians();
                let tile_x = center_x + (rad.cos() * radius as f32) as i32;
                let tile_y = center_y + (rad.sin() * radius as f32) as i32;
                
                // Bounds check
                if tile_x < 0 || tile_x >= WORLD_WIDTH_TILES as i32 { continue; }
                if tile_y < 0 || tile_y >= WORLD_HEIGHT_TILES as i32 { continue; }
                
                if let Some(tile_type) = get_tile_type_at_position(ctx, tile_x, tile_y) {
                    if tile_type.is_walkable() {
                        coastal_beach_tiles.push((tile_x, tile_y));
                        log::warn!("Last resort: Found walkable tile at ({}, {}) - type: {:?}", tile_x, tile_y, tile_type);
                        break;
                    }
                }
            }
            if !coastal_beach_tiles.is_empty() { break; }
        }
    }
    
    // --- ABSOLUTE FINAL FALLBACK: Hardcoded safe position ---
    if coastal_beach_tiles.is_empty() {
        // This should NEVER happen, but if it does, spawn at center of map
        let emergency_x = (WORLD_WIDTH_TILES / 2) as i32;
        let emergency_y = (WORLD_HEIGHT_TILES * 3 / 4) as i32;
        log::error!("CRITICAL: All spawn strategies failed! Using hardcoded fallback position ({}, {})", emergency_x, emergency_y);
        coastal_beach_tiles.push((emergency_x, emergency_y));
    }
    
    // Step 2: Find a valid spawn point from candidate tiles (OPTIMIZED with spatial queries)
    let max_spawn_attempts = 50;
    let mut spawn_attempt = 0;
    let mut last_collision_reason = String::new();
    let mut selected_tile_x: i32 = 0;
    let mut selected_tile_y: i32 = 0;
    
    // Try to find a valid spawn on a random candidate tile
    loop {
        // Pick a random candidate tile
        let random_index = ctx.rng().gen_range(0..coastal_beach_tiles.len());
        let (tile_x, tile_y) = coastal_beach_tiles[random_index];
        selected_tile_x = tile_x;
        selected_tile_y = tile_y;
        
        // Convert tile coordinates to world pixel coordinates (center of tile)
        spawn_x = (tile_x as f32 * TILE_SIZE_PX as f32) + (TILE_SIZE_PX as f32 / 2.0);
        spawn_y = (tile_y as f32 * TILE_SIZE_PX as f32) + (TILE_SIZE_PX as f32 / 2.0);
        
        log::debug!("Attempt {}: Testing spawn at tile ({}, {}) -> world pos ({:.1}, {:.1})", 
                   spawn_attempt + 1, tile_x, tile_y, spawn_x, spawn_y);
        
        // Step 3: Check for collisions at this beach tile position (OPTIMIZED spatial queries)
        let mut collision = false;
        last_collision_reason.clear();
        
        // OPTIMIZATION: Use spatial grid for ALL collision checks (players, trees, stones, etc.)
        // This avoids scanning entire tables and only checks nearby entities
        let spatial_grid = crate::spatial_grid::get_cached_spatial_grid(&ctx.db, ctx.timestamp);
        let nearby_entities = spatial_grid.get_entities_in_range(spawn_x, spawn_y);
        
        for entity in nearby_entities {
            match entity {
                crate::spatial_grid::EntityType::Player(other_player_id) => {
                    // Check collision with other players (more lenient spacing)
                    if other_player_id == sender_id { continue; } // Skip self
                    if let Some(other_player) = players.identity().find(&other_player_id) {
                        if other_player.is_dead { continue; }
                        let dx = spawn_x - other_player.position_x;
                        let dy = spawn_y - other_player.position_y;
                        let distance_sq = dx * dx + dy * dy;
                        let min_distance_sq = PLAYER_RADIUS * PLAYER_RADIUS * 2.0; // Reduced spacing requirement
                        if distance_sq < min_distance_sq {
                            collision = true;
                            last_collision_reason = format!("Player collision (distance: {:.1})", distance_sq.sqrt());
                            break;
                        }
                    }
                },
                crate::spatial_grid::EntityType::Tree(tree_id) => {
                    if let Some(tree) = trees.id().find(&tree_id) {
                        if tree.health == 0 { continue; }
                        let dx = spawn_x - tree.pos_x;
                        let dy = spawn_y - (tree.pos_y - crate::tree::TREE_COLLISION_Y_OFFSET);
                        let distance_sq = dx * dx + dy * dy;
                        if distance_sq < (crate::tree::PLAYER_TREE_COLLISION_DISTANCE_SQUARED * 0.8) {
                            collision = true;
                            last_collision_reason = format!("Tree collision at ({:.1}, {:.1})", tree.pos_x, tree.pos_y);
                            break;
                        }
                    }
                },
                crate::spatial_grid::EntityType::Stone(stone_id) => {
                    if let Some(stone) = stones.id().find(&stone_id) {
                        if stone.health == 0 { continue; }
                        let dx = spawn_x - stone.pos_x;
                        let dy = spawn_y - (stone.pos_y - crate::stone::STONE_COLLISION_Y_OFFSET);
                        let distance_sq = dx * dx + dy * dy;
                        if distance_sq < (crate::stone::PLAYER_STONE_COLLISION_DISTANCE_SQUARED * 0.8) {
                            collision = true;
                            last_collision_reason = format!("Stone collision at ({:.1}, {:.1})", stone.pos_x, stone.pos_y);
                            break;
                        }
                    }
                },
                crate::spatial_grid::EntityType::RuneStone(rune_stone_id) => {
                    if let Some(rune_stone) = rune_stones.id().find(&rune_stone_id) {
                        // AABB collision detection
                        let rune_stone_aabb_center_x = rune_stone.pos_x;
                        let rune_stone_aabb_center_y = rune_stone.pos_y - crate::rune_stone::RUNE_STONE_COLLISION_Y_OFFSET;
                        
                        let closest_x = spawn_x.max(rune_stone_aabb_center_x - crate::rune_stone::RUNE_STONE_AABB_HALF_WIDTH).min(rune_stone_aabb_center_x + crate::rune_stone::RUNE_STONE_AABB_HALF_WIDTH);
                        let closest_y = spawn_y.max(rune_stone_aabb_center_y - crate::rune_stone::RUNE_STONE_AABB_HALF_HEIGHT).min(rune_stone_aabb_center_y + crate::rune_stone::RUNE_STONE_AABB_HALF_HEIGHT);
                        
                        let dx = spawn_x - closest_x;
                        let dy = spawn_y - closest_y;
                        let distance_sq = dx * dx + dy * dy;
                        let player_radius_sq = crate::PLAYER_RADIUS * crate::PLAYER_RADIUS;
                        
                        if distance_sq < (player_radius_sq * 0.8) {
                            collision = true;
                            last_collision_reason = format!("RuneStone collision at ({:.1}, {:.1})", rune_stone.pos_x, rune_stone.pos_y);
                            break;
                        }
                    }
                },
                crate::spatial_grid::EntityType::Campfire(campfire_id) => {
                    if let Some(campfire) = campfires.id().find(&campfire_id) {
                        let dx = spawn_x - campfire.pos_x;
                        let dy = spawn_y - (campfire.pos_y - CAMPFIRE_COLLISION_Y_OFFSET);
                        let distance_sq = dx * dx + dy * dy;
                        if distance_sq < (PLAYER_CAMPFIRE_COLLISION_DISTANCE_SQUARED * 0.8) {
                            collision = true;
                            last_collision_reason = format!("Campfire collision at ({:.1}, {:.1})", campfire.pos_x, campfire.pos_y);
                            break;
                        }
                    }
                },
                crate::spatial_grid::EntityType::WoodenStorageBox(box_id) => {
                    if let Some(box_instance) = wooden_storage_boxes.id().find(&box_id) {
                        let box_collision_y = box_instance.pos_y - crate::wooden_storage_box::get_box_collision_y_offset(box_instance.box_type);
                        let dx = spawn_x - box_instance.pos_x;
                        let dy = spawn_y - box_collision_y;
                        let distance_sq = dx * dx + dy * dy;
                        let box_radius = crate::wooden_storage_box::get_box_player_collision_radius(box_instance.box_type);
                        let spawn_collision_dist_sq = (crate::PLAYER_RADIUS + box_radius) * (crate::PLAYER_RADIUS + box_radius) * 0.8;
                        if distance_sq < spawn_collision_dist_sq {
                            collision = true;
                            last_collision_reason = format!("Storage box collision at ({:.1}, {:.1})", box_instance.pos_x, box_instance.pos_y);
                            break;
                        }
                    }
                },
                _ => {} // Ignore other entity types for spawn collision
            }
            
            if collision { break; }
        }
        
        // If no collision found, we have a valid spawn point!
        if !collision {
            log::info!("SUCCESS: Spawn found at ({:.1}, {:.1}) on tile ({}, {}) after {} attempts", 
                      spawn_x, spawn_y, selected_tile_x, selected_tile_y, spawn_attempt + 1);
            break;
        }
        
        // Log collision reason for debugging
        if spawn_attempt < 10 { // Only log first 10 attempts to avoid spam
            log::debug!("Attempt {} failed: {} at tile ({}, {})", 
                       spawn_attempt + 1, last_collision_reason, selected_tile_x, selected_tile_y);
        }
        
        spawn_attempt += 1;
        if spawn_attempt >= max_spawn_attempts {
            // FORCE spawn on the last attempted beach tile - NO FALLBACK TO ORIGINAL LOCATION
            log::warn!("Could not find collision-free coastal beach spawn after {} attempts. FORCING spawn at last coastal beach tile ({:.1}, {:.1}) - {}", 
                      max_spawn_attempts, spawn_x, spawn_y, last_collision_reason);
            break;
        }
    }
    
    // Final validation - ensure we're spawning on a beach tile
    let final_tile_x = (spawn_x / TILE_SIZE_PX as f32).floor() as i32;
    let final_tile_y = (spawn_y / TILE_SIZE_PX as f32).floor() as i32;
    log::info!("FINAL SPAWN: Player {} will spawn at world coords ({:.1}, {:.1}) which is tile ({}, {})", 
               username, spawn_x, spawn_y, final_tile_x, final_tile_y);
    
    } // End of if !found_shipwreck_spawn block
    
    // --- End spawn position logic ---

    // --- Create and Insert New Player ---
    let player = Player {
        identity: sender_id, // Use the authenticated identity
        username: username.clone(),
        position_x: spawn_x, // Use calculated spawn position
        position_y: spawn_y, // Use calculated spawn position
        direction: "down".to_string(),
        last_update: ctx.timestamp,
        last_stat_update: ctx.timestamp,
        jump_start_time_ms: 0,
        health: 100.0,
        stamina: 100.0,
        thirst: PLAYER_STARTING_THIRST,
        hunger: PLAYER_STARTING_HUNGER,
        warmth: 100.0,
        is_sprinting: false,
        is_dead: false,
        death_timestamp: None,
        last_hit_time: None,
        is_online: true, // <<< Keep this for BRAND NEW players
        is_torch_lit: false, // Initialize to false
        is_flashlight_on: false, // Initialize to false
        is_headlamp_lit: false, // Initialize to false
        flashlight_aim_angle: 0.0, // Initialize to 0 radians (pointing right)
        last_consumed_at: None, // Initialize last_consumed_at
        is_crouching: false, // Initialize is_crouching
        is_knocked_out: false, // NEW: Initialize knocked out state
        knocked_out_at: None, // NEW: Initialize knocked out time
        is_on_water: false, // NEW: Initialize is_on_water
        is_snorkeling: false, // NEW: Initialize snorkeling state
        client_movement_sequence: 0,
        is_inside_building: false, // NEW: Players spawn outside (not inside buildings)
        is_aiming_throw: false, // Initialize throw-aiming state to false
        last_respawn_time: ctx.timestamp, // NEW: Track initial spawn time
        insanity: 0.0, // NEW: Start with no insanity
        last_insanity_threshold: 0.0, // NEW: No threshold crossed initially
        shard_carry_start_time: None, // NEW: Not carrying shards initially
        offline_corpse_id: None, // No offline corpse for new players
        seen_tutorial_ids: Vec::new(), // New players start with no completed tutorials
        pvp_enabled: false, // PvP disabled by default
        pvp_enabled_until: None, // No PvP timer initially
        last_pvp_combat_time: None, // No PvP combat history initially
        // NPC fields - human players are never NPCs
        is_npc: false,
        npc_role: String::new(),
    };

    // Insert the new player
    match players.try_insert(player) {
        Ok(inserted_player) => {
            log::info!("Player registered: {}. Granting starting items...", username);

            // --- ADD ActiveConnection record for NEW player ---
             let connection_id = ctx.connection_id().ok_or_else(|| {
                 log::error!("[RegisterPlayer] Missing ConnectionId in context for NEW player {:?}", sender_id);
                 "Internal error: Missing connection ID on initial registration".to_string()
             })?;
             let active_connections = ctx.db.active_connection();
             let new_active_conn = ActiveConnection {
                 identity: sender_id,
                 connection_id,
                 timestamp: ctx.timestamp,
             };
             match active_connections.try_insert(new_active_conn) {
                 Ok(_) => {
                     log::info!("[RegisterPlayer] Inserted active connection record for new player {:?}.", sender_id);
                 }
                 Err(e) => {
                     // Log error but don't fail registration
                     log::error!("[RegisterPlayer] Failed to insert active connection for new player {:?}: {}", sender_id, e);
                 }
             }
            // --- END ADD ActiveConnection ---

            // --- Grant Starting Items (Keep existing logic) ---
            match crate::starting_items::grant_starting_items(ctx, sender_id, &username) {
                Ok(_) => { /* Logged inside function */ },
                Err(e) => {
                    log::error!("Unexpected error during grant_starting_items for player {}: {}", username, e);
                }
            }
            // --- End Grant Starting Items ---
            
            // --- Initialize Quest System for NEW player ---
            // Initialize tutorial progress so they see quests immediately
            let _ = crate::quests::get_or_init_tutorial_progress(ctx, sender_id);
            log::info!("[RegisterPlayer] Initialized tutorial progress for new player {}", username);
            
            // Assign daily quests
            if let Err(e) = crate::quests::assign_daily_quests(ctx, sender_id) {
                log::error!("[RegisterPlayer] Failed to assign daily quests for new player {}: {}", username, e);
            } else {
                log::info!("[RegisterPlayer] Assigned daily quests for new player {}", username);
            }
            // --- End Initialize Quest System ---
            
            // --- Spawn 3 Beach Lyme Grass near spawn for first quest ---
            // This helps new players complete their first tutorial quest quickly
            spawn_starter_beach_lyme_grass(ctx, spawn_x, spawn_y);
            // --- End Spawn Starter Beach Lyme Grass ---
            
            Ok(())
        },
        Err(e) => {
            log::error!("Failed to insert new player {} ({:?}): {}", username, sender_id, e);
            Err(format!("Failed to register player: Database error."))
        }
    }
}

/// Reducer for registering an NPC agent.
/// Called by the ElizaOS agent runtime when connecting an NPC to the game.
/// NPCs use the same Player table and systems as human players, but:
/// - Skip tutorials, quests, daily login rewards
/// - Don't create offline corpses on disconnect
/// - Spawn at a random valid land position (not restricted to beach/shipwreck)
/// - Receive role-appropriate starting items
#[spacetimedb::reducer]
pub fn register_npc(ctx: &ReducerContext, username: String, role: String) -> Result<(), String> {
    let sender_id = ctx.sender();
    let players = ctx.db.player();
    log::info!("[NPC] Attempting NPC registration for identity: {:?}, username: {}, role: {}", 
        sender_id, username, role);

    // Check if this NPC already exists (reconnection case)
    if let Some(mut existing_player) = players.identity().find(&sender_id) {
        log::info!("[NPC] Found existing NPC {} ({:?}). Updating online status.", 
            existing_player.username, sender_id);
        existing_player.is_online = true;
        existing_player.last_update = ctx.timestamp;
        existing_player.npc_role = role;
        players.identity().update(existing_player);
        return Ok(());
    }

    // Validate inputs
    if username.is_empty() || username.len() > 30 {
        return Err("NPC username must be 1-30 characters.".to_string());
    }
    let valid_roles = ["gatherer", "warrior", "builder", "scout", "healer", "crafter", "explorer"];
    if !valid_roles.contains(&role.as_str()) {
        log::warn!("[NPC] Unknown role '{}' for NPC {}. Defaulting to explorer.", role, username);
    }

    // Find a spawn position - try random land tiles
    let mut spawn_x: f32 = (WORLD_WIDTH_TILES / 2) as f32 * TILE_SIZE_PX as f32;
    let mut spawn_y: f32 = (WORLD_HEIGHT_TILES / 2) as f32 * TILE_SIZE_PX as f32;
    
    // Try to find a valid land position up to 50 times
    for _attempt in 0..50 {
        let tile_x = ctx.rng().gen_range(50..WORLD_WIDTH_TILES as i32 - 50);
        let tile_y = ctx.rng().gen_range(50..WORLD_HEIGHT_TILES as i32 - 50);
        
        if let Some(tile_type) = get_tile_type_at_position(ctx, tile_x, tile_y) {
            // Check if this is a walkable land tile (not water)
            if tile_type.is_walkable() && !tile_type.is_water() {
                spawn_x = tile_x as f32 * TILE_SIZE_PX as f32 + (TILE_SIZE_PX as f32 / 2.0);
                spawn_y = tile_y as f32 * TILE_SIZE_PX as f32 + (TILE_SIZE_PX as f32 / 2.0);
                log::info!("[NPC] Found valid spawn at tile ({}, {})", tile_x, tile_y);
                break;
            }
        }
    }

    // Create the NPC player record (same struct as human players)
    let player = Player {
        identity: sender_id,
        username: username.clone(),
        position_x: spawn_x,
        position_y: spawn_y,
        direction: "down".to_string(),
        last_update: ctx.timestamp,
        last_stat_update: ctx.timestamp,
        jump_start_time_ms: 0,
        health: 100.0,
        stamina: 100.0,
        thirst: PLAYER_STARTING_THIRST,
        hunger: PLAYER_STARTING_HUNGER,
        warmth: 100.0,
        is_sprinting: false,
        is_dead: false,
        death_timestamp: None,
        last_hit_time: None,
        is_online: true,
        is_torch_lit: false,
        is_flashlight_on: false,
        is_headlamp_lit: false,
        flashlight_aim_angle: 0.0,
        last_consumed_at: None,
        is_crouching: false,
        is_knocked_out: false,
        knocked_out_at: None,
        is_on_water: false,
        is_snorkeling: false,
        client_movement_sequence: 0,
        is_inside_building: false,
        is_aiming_throw: false,
        last_respawn_time: ctx.timestamp,
        insanity: 0.0,
        last_insanity_threshold: 0.0,
        shard_carry_start_time: None,
        offline_corpse_id: None,
        seen_tutorial_ids: ALL_TUTORIAL_IDS.iter().map(|id| (*id).to_string()).collect(), // NPCs skip tutorials
        pvp_enabled: false,
        pvp_enabled_until: None,
        last_pvp_combat_time: None,
        // NPC-specific fields
        is_npc: true,
        npc_role: role.clone(),
    };

    match players.try_insert(player) {
        Ok(_inserted) => {
            log::info!("[NPC] NPC registered: {} (role: {}). Granting starting items...", username, role);

            // Track connection for NPCs too
            if let Some(connection_id) = ctx.connection_id() {
                let new_active_conn = ActiveConnection {
                    identity: sender_id,
                    connection_id,
                    timestamp: ctx.timestamp,
                };
                let _ = ctx.db.active_connection().try_insert(new_active_conn);
            }

            // Grant basic starting items (same as human players)
            match crate::starting_items::grant_starting_items(ctx, sender_id, &username) {
                Ok(_) => log::info!("[NPC] Starting items granted to NPC {}", username),
                Err(e) => log::error!("[NPC] Failed to grant starting items to NPC {}: {}", username, e),
            }

            Ok(())
        }
        Err(e) => {
            log::error!("[NPC] Failed to insert NPC {} ({:?}): {}", username, sender_id, e);
            Err(format!("Failed to register NPC: {}", e))
        }
    }
}

/// Spawns 3 Beach Lyme Grass harvestable resources near a new player's spawn point.
/// This helps new players complete their first tutorial quest quickly.
fn spawn_starter_beach_lyme_grass(ctx: &ReducerContext, spawn_x: f32, spawn_y: f32) {
    use crate::plants_database::PlantType;
    use crate::harvestable_resource::{create_harvestable_resource, harvestable_resource as HarvestableResourceTableTrait};
    use crate::environment::calculate_chunk_index;
    
    const SPAWN_COUNT: u8 = 3;
    const MIN_DISTANCE: f32 = 300.0;  // Minimum distance from player spawn (~1.5 character widths)
    const MAX_DISTANCE: f32 = 1200.0;  // Maximum distance from player spawn (~3 character widths)
    const MIN_SEPARATION: f32 = 600.0; // Minimum separation between grass spawns
    
    log::info!("🌿 Spawning {} starter Beach Lyme Grass near new player at ({:.1}, {:.1})", 
               SPAWN_COUNT, spawn_x, spawn_y);
    
    let mut spawned_positions: Vec<(f32, f32)> = Vec::new();
    let mut attempts = 0;
    const MAX_ATTEMPTS: u32 = 50;
    
    while spawned_positions.len() < SPAWN_COUNT as usize && attempts < MAX_ATTEMPTS {
        attempts += 1;
        
        // Generate random position around spawn point
        let angle = ctx.rng().gen_range(0.0..std::f32::consts::TAU);
        let distance = ctx.rng().gen_range(MIN_DISTANCE..MAX_DISTANCE);
        
        let grass_x = spawn_x + angle.cos() * distance;
        let grass_y = spawn_y + angle.sin() * distance;
        
        // Check tile type - Beach Lyme Grass should be on Beach tiles
        let tile_x = (grass_x / TILE_SIZE_PX as f32).floor() as i32;
        let tile_y = (grass_y / TILE_SIZE_PX as f32).floor() as i32;
        
        if let Some(tile_type) = get_tile_type_at_position(ctx, tile_x, tile_y) {
            // Beach Lyme Grass can spawn on Beach tiles
            if tile_type != TileType::Beach {
                continue;
            }
        } else {
            continue;
        }
        
        // Check separation from other spawned grass
        let mut too_close = false;
        for (prev_x, prev_y) in &spawned_positions {
            let dx = grass_x - prev_x;
            let dy = grass_y - prev_y;
            if dx * dx + dy * dy < MIN_SEPARATION * MIN_SEPARATION {
                too_close = true;
                break;
            }
        }
        if too_close {
            continue;
        }
        
        // Spawn the Beach Lyme Grass
        let chunk_index = calculate_chunk_index(grass_x, grass_y);
        let resource = create_harvestable_resource(
            PlantType::BeachLymeGrass,
            grass_x,
            grass_y,
            chunk_index,
            false // Not player-planted (spawned by system for tutorial)
        );
        
        ctx.db.harvestable_resource().insert(resource);
        spawned_positions.push((grass_x, grass_y));
        
        log::info!("🌿 Spawned starter Beach Lyme Grass #{} at ({:.1}, {:.1})", 
                   spawned_positions.len(), grass_x, grass_y);
    }
    
    if spawned_positions.len() < SPAWN_COUNT as usize {
        log::warn!("🌿 Only spawned {}/{} starter Beach Lyme Grass (couldn't find enough valid beach positions)", 
                   spawned_positions.len(), SPAWN_COUNT);
    } else {
        log::info!("🌿 Successfully spawned all {} starter Beach Lyme Grass for new player", SPAWN_COUNT);
    }
}

/// Reducer that handles client viewport updates.
/// 
/// This reducer is called by the client to update their visible game area boundaries.
/// It stores the viewport coordinates for each client, which can be used for
/// optimizing game state updates and rendering.
#[spacetimedb::reducer]
pub fn update_viewport(ctx: &ReducerContext, min_x: f32, min_y: f32, max_x: f32, max_y: f32) -> Result<(), String> {
    let client_id = ctx.sender();
    let viewports = ctx.db.client_viewport();
    log::trace!("Reducer update_viewport called by {:?} with bounds: ({}, {}), ({}, {})",
             client_id, min_x, min_y, max_x, max_y);

    let viewport_data = ClientViewport {
        client_identity: client_id,
        min_x,
        min_y,
        max_x,
        max_y,
        last_update: ctx.timestamp,
    };

    // Use insert_or_update logic
    if viewports.client_identity().find(&client_id).is_some() {
        viewports.client_identity().update(viewport_data);
        log::trace!("Updated viewport for client {:?}", client_id);
    } else {
        match viewports.try_insert(viewport_data) {
            Ok(_) => {
                log::trace!("Inserted new viewport for client {:?}", client_id);
            },
            Err(e) => {
                 log::error!("Failed to insert viewport for client {:?}: {}", client_id, e);
                 return Err(format!("Failed to insert viewport: {}", e));
            }
        }
    }
    Ok(())
}

// ADD: Tile types and world generation structures
#[derive(spacetimedb::SpacetimeType, Clone, Debug, PartialEq)]
pub enum TileType {
    Grass,       // Temperate meadows (south/middle of island)
    Dirt, 
    DirtRoad,
    Sea,
    DeepSea,  // Outer ring - empty deep ocean, no spawns, distinct rendering
    Beach,
    Sand,
    HotSpringWater, // Distinct type for hot spring water pools (teal/turquoise)
    Quarry,      // Quarry tiles (rocky gray-brown texture for mining areas)
    Asphalt,     // Paved compound areas (dark gray, for central compound and mini-compounds)
    Forest,      // Dense forested areas (dark green, higher tree density)
    Tundra,      // Arctic tundra (northern regions - mossy, low vegetation)
    Alpine,      // High-altitude rocky terrain (far north - sparse, rocky)
    TundraGrass, // Grassy patches within tundra biome (lighter green tundra grass)
    Tilled,      // Temporarily tilled soil for farming (+50% growth bonus, reverts after 48h)
}

impl TileType {
    /// Returns true if this tile type is any form of water (Sea, DeepSea, or HotSpringWater)
    /// Use this instead of checking `== TileType::Sea` to include hot springs and deep sea
    pub fn is_water(&self) -> bool {
        matches!(self, TileType::Sea | TileType::DeepSea | TileType::HotSpringWater)
    }
    
    /// Returns true if this tile type is specifically ocean/sea water (not hot springs)
    pub fn is_sea_water(&self) -> bool {
        matches!(self, TileType::Sea | TileType::DeepSea)
    }
    
    /// Returns true if this tile type is hot spring water
    pub fn is_hot_spring_water(&self) -> bool {
        matches!(self, TileType::HotSpringWater)
    }
    
    /// Returns true if this tile is walkable (not water)
    pub fn is_walkable(&self) -> bool {
        !self.is_water()
    }
    
    /// Returns true if this tile can be fished in
    pub fn is_fishable(&self) -> bool {
        // Both sea and hot springs can be fished
        self.is_water()
    }
    
    /// Returns true if drinking is allowed from this tile
    pub fn is_drinkable(&self) -> bool {
        // Both sea and hot springs can be drunk from
        self.is_water()
    }
    
    /// Returns true if this tile should block building placement
    pub fn blocks_building(&self) -> bool {
        // Water tiles and asphalt (compounds) block building
        matches!(self, TileType::Sea | TileType::DeepSea | TileType::HotSpringWater | TileType::Asphalt)
    }
    
    /// Returns true if this tile should have water visual effects (waves, etc.)
    pub fn has_water_visuals(&self) -> bool {
        self.is_water()
    }
    
    /// Returns true if this tile is a forest tile (dense vegetation)
    pub fn is_forest(&self) -> bool {
        matches!(self, TileType::Forest)
    }
    
    /// Returns true if this tile is a paved/developed area (asphalt compound)
    pub fn is_paved(&self) -> bool {
        matches!(self, TileType::Asphalt)
    }
    
    /// Returns true if this tile is a road or paved area
    pub fn is_road_or_paved(&self) -> bool {
        matches!(self, TileType::DirtRoad | TileType::Asphalt)
    }
}

/// Large quarry resource type - determines what ore is primarily found at the quarry
#[derive(spacetimedb::SpacetimeType, Clone, Debug, PartialEq)]
pub enum LargeQuarryType {
    Stone,   // Stone quarry - primarily stone ore
    Sulfur,  // Sulfur quarry - primarily sulfur ore
    Metal,   // Metal quarry - primarily metal ore
}

#[derive(spacetimedb::SpacetimeType, Clone, Debug)]
pub struct WorldGenConfig {
    pub seed: u64,
    pub world_width_tiles: u32,   // 250
    pub world_height_tiles: u32,  // 250
    pub chunk_size: u32,          // 8
    pub island_border_width: u32, // Sea border thickness
    pub beach_width: u32,         // Beach border thickness
    pub river_frequency: f32,     // 0.0-1.0
    pub dirt_patch_frequency: f32,
    pub road_density: f32,
}

// ADD: Compressed chunk data table for efficient tile transmission
#[spacetimedb::table(
    accessor = world_chunk_data, 
    public,
    index(accessor = idx_chunk_coords, name = "idx_chunk_coords", btree(columns = [chunk_x, chunk_y]))
)]
#[derive(Clone, Debug)]
pub struct WorldChunkData {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub chunk_x: i32,
    pub chunk_y: i32,
    pub chunk_size: u32, // How many tiles per side (5x5 = 25 tiles)
    pub tile_types: Vec<u8>, // Compressed tile types (25 bytes instead of 25 objects)
    pub variants: Vec<u8>,   // Compressed variants (25 bytes)
    pub generated_at: Timestamp,
}

#[spacetimedb::table(
    accessor = world_tile, 
    public,
    index(accessor = idx_chunk_position, name = "idx_chunk_position", btree(columns = [chunk_x, chunk_y])),
    index(accessor = idx_world_position, name = "idx_world_position", btree(columns = [world_x, world_y]))
)]
#[derive(Clone, Debug)]
pub struct WorldTile {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub chunk_x: i32,
    pub chunk_y: i32,
    pub tile_x: i32,  // Local tile position within chunk
    pub tile_y: i32,  // Local tile position within chunk
    pub world_x: i32, // Global world position for easier queries
    pub world_y: i32, // Global world position for easier queries
    pub tile_type: TileType,
    pub variant: u8,  // For tile variations (0-255)
    pub biome_data: Option<String>, // JSON for future biome properties
}

/// Pre-computed coastal spawn points for fast respawn lookups.
/// These are beach tiles adjacent to water, used for player spawning.
/// Generated once during world initialization to avoid expensive runtime scanning.
#[spacetimedb::table(accessor = coastal_spawn_point, public)]
#[derive(Clone, Debug)]
pub struct CoastalSpawnPoint {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub world_x: f32,      // World pixel X coordinate (center of tile)
    pub world_y: f32,      // World pixel Y coordinate (center of tile)
    pub tile_x: i32,       // Tile X coordinate
    pub tile_y: i32,       // Tile Y coordinate
    #[index(btree)]
    pub chunk_index: u32,  // For spatial queries
    pub is_south_half: bool, // Whether this spawn point is in the south half of the map
}

/// Populates the coastal_spawn_point table with valid spawn locations.
/// Called once during world generation to pre-compute spawn points.
pub fn populate_coastal_spawn_points(ctx: &ReducerContext) -> Result<(), String> {
    use std::collections::HashMap;
    
    log::info!("Populating coastal spawn points...");
    
    let world_tiles = ctx.db.world_tile();
    let map_height_half = (WORLD_HEIGHT_TILES / 2) as i32;
    
    // Build a map of all tiles for efficient adjacency lookup
    let mut tile_map: HashMap<(i32, i32), TileType> = HashMap::new();
    for tile in world_tiles.iter() {
        tile_map.insert((tile.world_x, tile.world_y), tile.tile_type.clone());
    }
    
    let mut spawn_points_added = 0;
    let mut south_half_count = 0;
    
    // Find all coastal beach tiles
    for tile in world_tiles.iter() {
        if tile.tile_type != TileType::Beach {
            continue;
        }
        
        // Check if this beach tile is adjacent to water
        let mut is_coastal = false;
        for dx in -1..=1i32 {
            for dy in -1..=1i32 {
                if dx == 0 && dy == 0 { continue; }
                
                let adjacent_x = tile.world_x + dx;
                let adjacent_y = tile.world_y + dy;
                
                if let Some(adjacent_type) = tile_map.get(&(adjacent_x, adjacent_y)) {
                    if adjacent_type.is_water() {
                        is_coastal = true;
                        break;
                    }
                } else {
                    // Edge of map - consider coastal
                    is_coastal = true;
                    break;
                }
            }
            if is_coastal { break; }
        }
        
        if !is_coastal {
            continue;
        }
        
        // Convert tile coords to world pixel coords (center of tile)
        let world_x = (tile.world_x as f32 * TILE_SIZE_PX as f32) + (TILE_SIZE_PX as f32 / 2.0);
        let world_y = (tile.world_y as f32 * TILE_SIZE_PX as f32) + (TILE_SIZE_PX as f32 / 2.0);
        
        // Calculate chunk index
        let chunk_index = environment::calculate_chunk_index(world_x, world_y);
        
        // Determine if in south half (larger Y values)
        let is_south_half = tile.world_y >= map_height_half;
        if is_south_half {
            south_half_count += 1;
        }
        
        // Insert spawn point
        ctx.db.coastal_spawn_point().insert(CoastalSpawnPoint {
            id: 0, // auto_inc
            world_x,
            world_y,
            tile_x: tile.world_x,
            tile_y: tile.world_y,
            chunk_index,
            is_south_half,
        });
        
        spawn_points_added += 1;
    }
    
    log::info!("Coastal spawn points populated: {} total, {} in south half", 
               spawn_points_added, south_half_count);
    
    Ok(())
}

#[spacetimedb::table(accessor = minimap_cache, public)]
#[derive(Clone, Debug)]
pub struct MinimapCache {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub width: u32,
    pub height: u32,
    pub data: Vec<u8>, // Compressed minimap data as color values
    pub generated_at: Timestamp,
}

/// Monument type enum to distinguish different monument types
#[derive(spacetimedb::SpacetimeType, Clone, Debug, PartialEq)]
pub enum MonumentType {
    Shipwreck,
    FishingVillage,
    WhaleBoneGraveyard,
    HuntingVillage,
    AlpineVillage,
    CrashedResearchDrone,
    HotSpring,
    WeatherStation,
    WolfDen,
}

/// Unified monument part table for all monument types
/// Replaces separate shipwreck_part, fishing_village_part, and whale_bone_graveyard_part tables
#[spacetimedb::table(accessor = monument_part, public)]
#[derive(Clone, Debug)]
pub struct MonumentPart {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    /// Monument type to distinguish which monument this part belongs to
    pub monument_type: MonumentType,
    /// World X position in pixels
    pub world_x: f32,
    /// World Y position in pixels
    pub world_y: f32,
    /// Image filename (e.g., "hull1.png", "hv_hut2.png", "wbg_ribcage.png")
    pub image_path: String,
    /// Part type for identification (e.g., "hull", "campfire", "ribcage", "hut")
    /// Can be empty string for shipwreck parts that don't need specific part types
    pub part_type: String,
    /// Whether this is the center piece of the monument
    pub is_center: bool,
    /// Collision radius in pixels (0 = no collision)
    pub collision_radius: f32,
    /// Rotation in radians (0 = default orientation). Used for docks to face water.
    pub rotation_rad: f32,
}

/// Large quarry locations with resource type (displayed on minimap as landmarks)
#[spacetimedb::table(accessor = large_quarry, public)]
#[derive(Clone, Debug)]
pub struct LargeQuarry {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    /// World X position in pixels (center of quarry)
    pub world_x: f32,
    /// World Y position in pixels (center of quarry)
    pub world_y: f32,
    /// Radius of the quarry in tiles
    pub radius_tiles: i32,
    /// Type of resources primarily found at this quarry
    pub quarry_type: LargeQuarryType,
}

/// Reed Marsh zones - environmental monuments located in larger rivers
/// Contains reeds, water barrels, memory shards, and attracts terns
/// Building is restricted within these zones
#[spacetimedb::table(accessor = reed_marsh, public)]
#[derive(Clone, Debug)]
pub struct ReedMarsh {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    /// World X position in pixels (center of marsh)
    pub world_x: f32,
    /// World Y position in pixels (center of marsh)
    pub world_y: f32,
    /// Radius of the marsh in pixels
    pub radius_px: f32,
}

/// Tide Pool zones - coastal inlets on ocean beaches (never inland rivers/lakes)
/// Contains crabs, terns, reeds, coral fragments, plastic water jugs, vitamin drink (washed up)
/// Building is restricted within these zones
#[spacetimedb::table(accessor = tide_pool, public)]
#[derive(Clone, Debug)]
pub struct TidePool {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    /// World X position in pixels (center of tide pool inlet)
    pub world_x: f32,
    /// World Y position in pixels (center of tide pool inlet)
    pub world_y: f32,
    /// Radius of the tide pool zone in pixels
    pub radius_px: f32,
}

// ADD: Utility functions for tile compression
impl TileType {
    /// Convert TileType to u8 for compression
    pub fn to_u8(&self) -> u8 {
        match self {
            TileType::Grass => 0,
            TileType::Dirt => 1,
            TileType::DirtRoad => 2,
            TileType::Sea => 3,
            TileType::Beach => 4,
            TileType::Sand => 5,
            TileType::HotSpringWater => 6,
            TileType::Quarry => 7,
            TileType::Asphalt => 8,
            TileType::Forest => 9,
            TileType::Tundra => 10,
            TileType::Alpine => 11,
            TileType::TundraGrass => 12,
            TileType::Tilled => 13,
            TileType::DeepSea => 14,
        }
    }
    
    /// Convert u8 back to TileType for decompression
    pub fn from_u8(value: u8) -> Option<TileType> {
        match value {
            0 => Some(TileType::Grass),
            1 => Some(TileType::Dirt),
            2 => Some(TileType::DirtRoad),
            3 => Some(TileType::Sea),
            4 => Some(TileType::Beach),
            5 => Some(TileType::Sand),
            6 => Some(TileType::HotSpringWater),
            7 => Some(TileType::Quarry),
            8 => Some(TileType::Asphalt),
            9 => Some(TileType::Forest),
            10 => Some(TileType::Tundra),
            11 => Some(TileType::Alpine),
            12 => Some(TileType::TundraGrass),
            13 => Some(TileType::Tilled),
            14 => Some(TileType::DeepSea),
            _ => None,
        }
    }
    
    /// Returns true if this is a cold/arctic biome tile (Tundra, TundraGrass, or Alpine)
    pub fn is_arctic(&self) -> bool {
        matches!(self, TileType::Tundra | TileType::TundraGrass | TileType::Alpine)
    }
    
    /// Returns true if this is tundra (including TundraGrass)
    pub fn is_tundra(&self) -> bool {
        matches!(self, TileType::Tundra | TileType::TundraGrass)
    }
    
    /// Returns true if this is alpine terrain
    pub fn is_alpine(&self) -> bool {
        matches!(self, TileType::Alpine)
    }
    
    /// Returns true if this tile can support trees (not water, alpine, or paved)
    pub fn can_have_trees(&self) -> bool {
        !matches!(self, TileType::Sea | TileType::DeepSea | TileType::HotSpringWater | TileType::Asphalt | TileType::Alpine | TileType::Beach | TileType::Sand)
    }
    
    /// Returns true if this tile is prepared soil (Dirt or Tilled) for farming growth bonus
    pub fn is_prepared_soil(&self) -> bool {
        matches!(self, TileType::Dirt | TileType::Tilled)
    }
    
    /// Returns true if this tile can be tilled (converted to tilled soil)
    /// Water, roads, paved areas, and already-tilled tiles cannot be tilled
    pub fn can_be_tilled(&self) -> bool {
        !matches!(self, 
            TileType::Sea | 
            TileType::DeepSea | 
            TileType::HotSpringWater | 
            TileType::Asphalt | 
            TileType::DirtRoad | 
            TileType::Quarry |
            TileType::Dirt |      // Natural dirt doesn't need tilling
            TileType::Tilled |    // Already tilled
            TileType::Beach |     // Beach/sand shouldn't be tillable
            TileType::Sand
        )
    }
}

/// NEW: Manual reducer to generate compressed chunk data for testing/debugging
/// This can be called by clients to force regeneration of compressed chunk data
#[spacetimedb::reducer]
pub fn regenerate_compressed_chunks(ctx: &ReducerContext) -> Result<(), String> {
    log::info!("Manual regeneration of compressed chunk data requested by {:?}", ctx.sender());
    
    // Clear existing compressed chunk data
    let world_chunk_data = ctx.db.world_chunk_data();
    let chunks_to_delete: Vec<_> = world_chunk_data.iter().collect();
    for chunk in chunks_to_delete {
        world_chunk_data.id().delete(chunk.id);
    }
    
    // Regenerate compressed chunk data
    match crate::world_generation::generate_compressed_chunk_data(ctx) {
        Ok(_) => {
            let new_chunk_count = world_chunk_data.iter().count();
            log::info!("Successfully regenerated {} compressed chunks", new_chunk_count);
            Ok(())
        }
        Err(e) => {
            log::error!("Failed to regenerate compressed chunk data: {}", e);
            Err(format!("Failed to regenerate compressed chunks: {}", e))
        }
    }
}

/// Mark SOVA intro as seen - called by client when the intro audio finishes
/// This persists server-side so clearing browser cache won't replay the intro
#[spacetimedb::reducer]
pub fn mark_sova_intro_seen(ctx: &ReducerContext) -> Result<(), String> {
    mark_tutorial_seen_by_id(ctx, TUTORIAL_ID_CRASH_INTRO)
}

#[spacetimedb::reducer]
pub fn mark_tutorial_seen(ctx: &ReducerContext, tutorial_id: String) -> Result<(), String> {
    mark_tutorial_seen_by_id(ctx, &tutorial_id)
}

fn mark_tutorial_seen_by_id(ctx: &ReducerContext, tutorial_id: &str) -> Result<(), String> {
    let player_id = ctx.sender();
    let players = ctx.db.player();
    
    if let Some(mut player) = players.identity().find(&player_id) {
        if mark_tutorial_seen_in_player(&mut player, tutorial_id) {
            players.identity().update(player);
            log::info!("[SOVA] Player {:?} marked tutorial '{}' as seen", player_id, tutorial_id);
        }
        Ok(())
    } else {
        Err("Player not found".to_string())
    }
}

/// Mark SOVA tutorial hint ("Press V to Talk") as seen
#[spacetimedb::reducer]
pub fn mark_tutorial_hint_seen(ctx: &ReducerContext) -> Result<(), String> {
    mark_tutorial_seen_by_id(ctx, TUTORIAL_ID_TUTORIAL_HINT)
}

/// Mark hostile encounter tutorial (night apparitions) as seen
#[spacetimedb::reducer]
pub fn mark_hostile_encounter_tutorial_seen(ctx: &ReducerContext) -> Result<(), String> {
    mark_tutorial_seen_by_id(ctx, TUTORIAL_ID_FIRST_HOSTILE_ENCOUNTER)
}

/// Mark rune stone tutorial as seen
#[spacetimedb::reducer]
pub fn mark_rune_stone_tutorial_seen(ctx: &ReducerContext) -> Result<(), String> {
    mark_tutorial_seen_by_id(ctx, TUTORIAL_ID_RUNE_STONE)
}

/// Mark ALK station tutorial as seen
#[spacetimedb::reducer]
pub fn mark_alk_station_tutorial_seen(ctx: &ReducerContext) -> Result<(), String> {
    mark_tutorial_seen_by_id(ctx, TUTORIAL_ID_ALK_STATION)
}

/// Mark crashed drone tutorial as seen
#[spacetimedb::reducer]
pub fn mark_crashed_drone_tutorial_seen(ctx: &ReducerContext) -> Result<(), String> {
    mark_tutorial_seen_by_id(ctx, TUTORIAL_ID_CRASHED_DRONE)
}
