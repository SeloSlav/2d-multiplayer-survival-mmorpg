// Wild Animal NPC System - Module Organization
// Core AI and shared functionality with species-specific behaviors

pub mod core;
pub mod alk_wildlife;
pub mod fox;
pub mod wolf;
pub mod viper;
pub mod walrus;
pub mod crab;
pub mod tern;
pub mod crow;
pub mod vole;
pub mod wolverine;
pub mod caribou;
pub mod salmon_shark;
pub mod jellyfish;
pub mod polar_bear;
pub mod hare;
pub mod snowy_owl;
pub mod respawn;
pub mod animal_corpse;

// Night hostile NPC behaviors
pub mod shorebound;
pub mod shardkin;
pub mod drowned_watch;
pub mod hostile_spawning;
pub mod bee;

// Re-export core types and functionality
pub use core::*;

// Re-export species-specific traits
pub use wolf::WolfBehavior;
pub use viper::ViperBehavior;
pub use walrus::WalrusBehavior;
pub use tern::TernBehavior;
pub use crow::CrowBehavior;
pub use vole::VoleBehavior;
pub use wolverine::WolverineBehavior;
pub use caribou::CaribouBehavior;
pub use caribou::{
    CaribouSex, CaribouAgeStage, CaribouBreedingData, CaribouBreedingSchedule, CaribouRutState,
    init_caribou_breeding_schedule, create_caribou_breeding_data, assign_caribou_sex_on_spawn,
    assign_caribou_sex_forced, cleanup_caribou_breeding_data, get_caribou_age_stage, get_caribou_sex,
    is_caribou_pregnant, get_caribou_drop_multipliers, get_caribou_age_health_multiplier,
};

// Re-export walrus breeding system
pub use walrus::{
    WalrusSex, WalrusAgeStage, WalrusBreedingData, WalrusBreedingSchedule, WalrusRutState,
    init_walrus_breeding_schedule, create_walrus_breeding_data, assign_walrus_sex_on_spawn,
    assign_walrus_sex_forced, cleanup_walrus_breeding_data, get_walrus_age_stage, get_walrus_sex,
    is_walrus_pregnant, get_walrus_drop_multipliers, get_walrus_age_health_multiplier,
};

// Re-export animal corpse functionality
pub use animal_corpse::*;

// Re-export hostile spawning initialization
pub use hostile_spawning::init_hostile_spawning_system;
