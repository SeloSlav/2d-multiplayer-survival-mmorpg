//! Run the production geometry's pure Rust tests without the SpacetimeDB host.
#[allow(dead_code)]
mod shared_config { include!(concat!(env!("OUT_DIR"), "/config.rs")); }
#[allow(dead_code)]
#[path = "../../../server/src/collision_geometry.rs"]
mod collision_geometry;
#[allow(dead_code)]
#[path = "../../../server/src/wild_animal_npc/alk_wildlife.rs"]
mod alk_wildlife;
#[allow(dead_code)]
#[path = "../../../server/src/wild_animal_npc/bird_motion.rs"]
mod bird_motion;
#[allow(dead_code)]
#[path = "../../../server/src/projectile_geometry.rs"]
mod projectile_geometry;
#[allow(dead_code)]
#[path = "../../../server/src/wildlife_projectile_geometry.rs"]
mod wildlife_projectile_geometry;
#[allow(dead_code)]
#[path = "../../../server/src/cover_geometry.rs"]
mod cover_geometry;
