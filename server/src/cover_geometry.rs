//! Dimensions and durability shared with the rendered cover and client collision.
use crate::projectile_geometry::{box_impact, Point3};
use serde::Deserialize;
use std::collections::HashMap;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverConfig {
    pub health: f32,
    pub max_damage_per_hit: f32,
    pub respawn_seconds: i64,
    pub respawn_player_clearance: f32,
    pub profiles: HashMap<String, CoverProfile>,
}

#[derive(Deserialize)]
pub struct CoverProfile {
    pub name: String,
    pub material: String,
    pub width: f32,
    pub depth: f32,
    pub height: f32,
}

lazy_static::lazy_static! {
    pub static ref COVER: CoverConfig = serde_json::from_str(
        include_str!("../../shared/config/combatCover.json")
    ).expect("valid combat cover configuration");
}

pub fn profile(variant: u8) -> Option<&'static CoverProfile> {
    COVER.profiles.get(match variant {
        7 => "7",
        8 => "8",
        9 => "9",
        10 => "10",
        11 => "11",
        _ => return None,
    })
}

pub fn damage_after_hit(health: f32, damage: f32) -> f32 {
    if !damage.is_finite() || damage <= 0.0 {
        return health;
    }
    (health - damage.min(COVER.max_damage_per_hit)).max(0.0)
}

impl CoverProfile {
    pub fn impact(&self, start: Point3, end: Point3, x: f32, y: f32, padding: f32) -> Option<f32> {
        box_impact(
            start,
            end,
            Point3 {
                x: x - self.width / 2.0 - padding,
                y: y - self.depth / 2.0 - padding,
                height: 0.0,
            },
            Point3 {
                x: x + self.width / 2.0 + padding,
                y: y + self.depth / 2.0 + padding,
                height: self.height,
            },
        )
    }

    pub fn nearest_point(&self, x: f32, y: f32, from_x: f32, from_y: f32) -> (f32, f32) {
        (
            from_x.clamp(x - self.width / 2.0, x + self.width / 2.0),
            from_y.clamp(y - self.depth / 2.0, y + self.depth / 2.0),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn p(x: f32, y: f32, height: f32) -> Point3 {
        Point3 { x, y, height }
    }

    #[test]
    fn heavy_weapons_and_explosives_need_four_hits() {
        for damage in [150.0, 375.0, 1000.0, 10000.0] {
            let mut health = COVER.health;
            for _ in 0..3 {
                health = damage_after_hit(health, damage);
                assert!(health > 0.0);
            }
            assert_eq!(damage_after_hit(health, damage), 0.0);
        }
        assert_eq!(damage_after_hit(COVER.health, 25.0), COVER.health - 25.0);
        assert_eq!(damage_after_hit(COVER.health, f32::NAN), COVER.health);
    }

    #[test]
    fn cover_blocks_body_height_but_allows_shots_over_and_around_it() {
        for cover in COVER.profiles.values() {
            assert!(cover
                .impact(p(0.0, -200.0, 52.0), p(0.0, 200.0, 52.0), 0.0, 0.0, 0.0)
                .is_some());
            assert!(cover
                .impact(p(0.0, -200.0, 63.0), p(0.0, 200.0, 63.0), 0.0, 0.0, 0.0)
                .is_some());
            assert!(cover
                .impact(p(0.0, -200.0, 100.0), p(0.0, 200.0, 100.0), 0.0, 0.0, 0.0)
                .is_none());
            let side = cover.width / 2.0 + 1.0;
            assert!(cover
                .impact(p(side, -200.0, 52.0), p(side, 200.0, 52.0), 0.0, 0.0, 0.0)
                .is_none());
            assert!(cover
                .impact(p(side, -200.0, 1.0), p(side, 200.0, 1.0), 0.0, 0.0, 32.0)
                .is_some());
        }
    }
}
