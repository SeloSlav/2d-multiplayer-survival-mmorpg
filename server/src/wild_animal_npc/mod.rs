// Wild Animal NPC System - Module Organization
// Core AI and shared functionality with species-specific behaviors

pub mod core;
pub mod fox;
pub mod wolf;
pub mod viper;
pub mod respawn;

// Re-export core types and functionality
pub use core::*;

// Re-export species-specific traits
pub use fox::FoxBehavior;
pub use wolf::WolfBehavior;
pub use viper::ViperBehavior; 