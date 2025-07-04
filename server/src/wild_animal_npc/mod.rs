// Wild Animal NPC System - Module Organization
// Core AI and shared functionality with species-specific behaviors

pub mod core;
pub mod fox;
pub mod wolf;
pub mod viper;
pub mod walrus;
pub mod respawn;
pub mod animal_corpse;

// Re-export core types and functionality
pub use core::*;

// Re-export species-specific traits
pub use wolf::WolfBehavior;
pub use viper::ViperBehavior;
pub use walrus::WalrusBehavior;

// Re-export animal corpse functionality
pub use animal_corpse::*; 