//! Run the production geometry's pure Rust tests without the SpacetimeDB host.
#[allow(dead_code)]
mod shared_config { include!(concat!(env!("OUT_DIR"), "/config.rs")); }
#[allow(dead_code)]
#[path = "../../../server/src/collision_geometry.rs"]
mod collision_geometry;
