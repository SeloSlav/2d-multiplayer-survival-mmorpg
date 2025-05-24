use spacetimedb::{table, Identity, Timestamp};

#[table(name = death_marker, public)]
#[derive(Clone, Debug)]
pub struct DeathMarker {
    #[primary_key]
    pub player_id: Identity,
    pub pos_x: f32,
    pub pos_y: f32,
    pub death_timestamp: Timestamp,
}

// The upsert logic is now handled directly in player_stats.rs and combat.rs
// when a player death occurs. A separate reducer here is not strictly needed
// for that core functionality.