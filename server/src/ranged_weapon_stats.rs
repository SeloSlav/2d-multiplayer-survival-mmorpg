use spacetimedb::{table, SpacetimeType, Timestamp};

// #[derive(SpacetimeType, Clone, Debug)] // Remove this if #[table] is used, or ensure SpacetimeType is not re-derived
#[table(name = ranged_weapon_stats, public)] // Use identifier, not string
#[derive(Clone, Debug)] // Keep Clone and Debug, SpacetimeType is handled by #[table]
pub struct RangedWeaponStats {
    #[primary_key]
    pub item_name: String,          // e.g., "Hunting Bow"
    pub weapon_range: f32,          // Max range in world units
    pub projectile_speed: f32,      // Speed in world units per second
    pub accuracy: f32,              // Value between 0.0 (wildly inaccurate) and 1.0 (perfectly accurate)
    pub reload_time_secs: f32,      // Time between shots
    // pub ammo_item_def_id: Option<u64>, // Future: if different ammo types are used
} 