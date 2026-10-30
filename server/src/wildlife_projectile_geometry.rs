//! Ranged hit volumes measured against the authored animal torsos and heads.
//! The small margin covers gait/lunge animation; tails, antlers and wing tips
//! are not used to inflate an animal's entire damage volume.
use std::collections::HashMap;
use serde::Deserialize;
use crate::projectile_geometry::{cylinder_impact, Point3};

// The oblique camera preserves ground pixels and projects height by cos(30°).
const HEIGHT_SCREEN_SCALE: f32 = 0.8660254;
const AIM_HEIGHT_MARGIN: f32 = 24.0;
pub const AIM_SEARCH_PADDING: f32 = 220.0;

pub fn direction_or_facing(direction: (f32, f32), facing: &str) -> (f32, f32) {
    if direction.0.hypot(direction.1) > 0.01 { return direction; }
    match facing {
        "left" => (-1.0, 0.0), "right" => (1.0, 0.0), "up" => (0.0, -1.0), _ => (0.0, 1.0),
    }
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WildlifeProjectileProfile {
    // Longitudinal radius in scene pixels. Width is independent so making a
    // long animal's head hittable does not enlarge empty space at its sides.
    pub radius: f32,
    #[serde(default)]
    pub half_width: Option<f32>,
    pub height: f32,
    pub aim_height: f32,
    #[serde(default)]
    pub hover_height: f32,
}

lazy_static::lazy_static! {
    static ref PROFILES: HashMap<String, WildlifeProjectileProfile> = serde_json::from_str(
        include_str!("../../shared/config/wildlifeProjectileGeometry.json")
    ).expect("valid wildlife projectile geometry");
}

pub fn profile(species: &str) -> WildlifeProjectileProfile {
    *PROFILES.get(species).expect("projectile geometry for every animal species")
}

impl WildlifeProjectileProfile {
    pub fn impact(self, start: Point3, end: Point3, center: (f32, f32), direction: (f32, f32), ground: f32, flying: bool) -> Option<f32> {
        let length = direction.0.hypot(direction.1);
        let (forward_x, forward_z) = if length > 0.001 { (direction.0 / length, direction.1 / length) } else { (0.0, 1.0) };
        let local = |p: Point3| {
            // worldToScene stretches world Y by 1/sin(30°). Match that here
            // before rotating into the animal's longitudinal/lateral axes.
            let (dx, dz) = (p.x - center.0, (p.y - center.1) * 2.0);
            Point3 {
                x: (dx * forward_z - dz * forward_x) * self.radius / self.half_width.unwrap_or(self.radius),
                y: dx * forward_x + dz * forward_z,
                height: p.height,
            }
        };
        let (bottom, top) = self.vertical_bounds(ground, flying);
        cylinder_impact(local(start), local(end), (0.0, 0.0), self.radius, bottom, top)
    }

    pub fn vertical_bounds(self, ground: f32, flying: bool) -> (f32, f32) {
        let lift = if flying { 52.8 } else { self.hover_height };
        // Flying models bob and dive toward their target during an attack.
        (ground + (lift - 24.0).max(0.0), ground + lift + self.height)
    }

    /// Resolve the height under the reticle without snapping its horizontal
    /// aim back to the animal's origin. This preserves intentional lead shots.
    /// A nearby miss may borrow height, but still has to physically hit a body.
    pub fn aim_target(self, pointer: (f32, f32), center: (f32, f32), direction: (f32, f32), ground: f32, flying: bool) -> Option<(f32, Point3)> {
        if !pointer.0.is_finite() || !pointer.1.is_finite() { return None; }
        let (bottom, top) = self.vertical_bounds(ground, flying);
        let lift = if flying { 52.8 } else { self.hover_height };
        let preferred_height = ground + lift + self.aim_height;
        let on_ray = |height: f32| Point3 { x: pointer.0, y: pointer.1 + height * HEIGHT_SCREEN_SCALE, height };
        let (ray_bottom, ray_top) = (on_ray(bottom), on_ray(top));
        let entry = self.impact(ray_bottom, ray_top, center, direction, ground, flying);
        let height = if let Some(entry) = entry {
            let exit = (1.0 - self.impact(ray_top, ray_bottom, center, direction, ground, flying).unwrap_or(0.0)).max(entry);
            preferred_height.clamp(bottom + entry * (top - bottom), bottom + exit * (top - bottom))
        } else {
            preferred_height
        };
        let nearest_y = pointer.1.clamp(center.1 - top * HEIGHT_SCREEN_SCALE, center.1 - bottom * HEIGHT_SCREEN_SCALE);
        let distance = (pointer.0 - center.0).hypot(pointer.1 - nearest_y);
        let gap = (distance - self.radius).max(0.0);
        if gap > AIM_HEIGHT_MARGIN { return None; }
        let center_distance_sq = (pointer.0 - center.0).powi(2)
            + (pointer.1 - (center.1 - preferred_height * HEIGHT_SCREEN_SCALE)).powi(2);
        Some((gap * gap + center_distance_sq * 0.001, on_ray(height)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::projectile_geometry::{first_impact, Collider3, Trajectory3};
    fn p(x: f32, y: f32, height: f32) -> Point3 { Point3 { x, y, height } }

    #[test]
    fn visible_wolf_upper_body_and_snout_are_hittable_from_every_side() {
        let wolf = profile("TundraWolf");
        for angle in [0.0_f32, 0.7, 1.57, 2.5, 3.14, 4.7] {
            let (x, y) = (angle.cos() * 50.0, angle.sin() * 50.0);
            assert!(wolf.impact(p(x - 100.0, y * 0.5, 56.0), p(x + 100.0, y * 0.5, 56.0), (0.0, 0.0), (angle.cos(), angle.sin()), 0.0, false).is_some());
        }
        assert!(cylinder_impact(p(-100.0, 0.0, 56.0), p(100.0, 0.0, 56.0), (0.0, 0.0), 32.0, 0.0, 40.0).is_none(), "old volume missed the upper body entirely");
    }

    #[test]
    fn shots_at_visible_body_points_reach_low_and_tall_wildlife() {
        for species in ["TundraWolf", "CinderFox", "PolarBear", "Vole", "Hare", "ArcticWalrus", "CableViper"] {
            let body = profile(species);
            for h in [body.aim_height, body.height - 5.0] {
                let pointer = (400.0, -h * HEIGHT_SCREEN_SCALE);
                let (_, aim) = body.aim_target(pointer, (400.0, 0.0), (0.0, 1.0), 0.0, false).unwrap();
                assert!((aim.y - aim.height * HEIGHT_SCREEN_SCALE - pointer.1).abs() < 0.001);
                for (speed, gravity) in [(800.0, 240.0), (3200.0, 0.0)] {
                    let flight = Trajectory3::aim_at(p(0.0, 0.0, 50.0), aim, speed, gravity).unwrap();
                    let t = (aim.x.hypot(aim.y)) / speed;
                    assert!(body.impact(flight.position(t * 0.9), flight.position(t), (400.0, 0.0), (0.0, 1.0), 0.0, false).is_some(), "{species} should be hit at visible height {h}");
                }
            }
        }
    }

    #[test]
    fn aiming_ahead_preserves_lead_instead_of_pulling_shots_behind_a_running_wolf() {
        let wolf = profile("TundraWolf");
        let pointer = (445.0, -wolf.aim_height * HEIGHT_SCREEN_SCALE);
        let (_, aim) = wolf.aim_target(pointer, (400.0, 0.0), (1.0, 0.0), 0.0, false).unwrap();
        assert_eq!(aim.x, pointer.0);
        assert!(aim.y.abs() < 0.001);
        let far_lead = (479.0, pointer.1);
        assert_eq!(wolf.aim_target(far_lead, (400.0, 0.0), (1.0, 0.0), 0.0, false).unwrap().1.x, far_lead.0);
        assert!(wolf.aim_target((510.0, pointer.1), (400.0, 0.0), (1.0, 0.0), 0.0, false).is_none());
    }

    #[test]
    fn forgiveness_does_not_remove_misses_or_shoot_through_cover() {
        let wolf = profile("TundraWolf");
        assert!(wolf.impact(p(0.0, 25.0, 40.0), p(500.0, 25.0, 40.0), (400.0, 0.0), (1.0, 0.0), 0.0, false).is_none(), "length allowance must not widen empty space beside the body");
        let body = Collider3::Cylinder { center: (400.0, 0.0), radius: wolf.radius, bottom: 0.0, top: wolf.height };
        assert!(first_impact(p(0.0, 90.0, 40.0), p(500.0, 90.0, 40.0), &[(2, body)]).is_none());
        assert!(first_impact(p(0.0, 0.0, 100.0), p(500.0, 0.0, 100.0), &[(2, body)]).is_none());
        let wall = Collider3::Box { min: p(180.0, -20.0, 0.0), max: p(200.0, 20.0, 130.0) };
        assert_eq!(first_impact(p(0.0, 0.0, 50.0), p(500.0, 0.0, 38.0), &[(2, body), (1, wall)]).unwrap().0, 1);
    }

    #[test]
    fn flight_and_apparition_profiles_remain_consistent() {
        for species in ["Crow", "Tern", "SnowyOwl", "Bee"] {
            let body = profile(species);
            let (bottom, top) = body.vertical_bounds(7.68, true);
            let (_, aim) = body.aim_target((400.0, -(60.48 + body.aim_height) * HEIGHT_SCREEN_SCALE), (400.0, 0.0), (0.0, 1.0), 7.68, true).unwrap();
            assert!(aim.height >= bottom && aim.height <= top);
        }
        for (species, height) in [("Shorebound", 76.0), ("Shardkin", 46.0), ("DrownedWatch", 98.0)] {
            let body = profile(species);
            assert_eq!((body.radius, body.height), (32.0, height));
        }
    }

    #[test]
    fn stationary_facing_and_chunk_search_match_the_rendered_body() {
        assert_eq!(direction_or_facing((0.0, 0.0), "left"), (-1.0, 0.0));
        assert_eq!(direction_or_facing((0.0, 0.0), "up"), (0.0, -1.0));
        assert_eq!(direction_or_facing((1.0, 0.0), "left"), (1.0, 0.0));
        for body in PROFILES.values() {
            // Include flying height and foundations at a chunk boundary.
            let (_, top) = body.vertical_bounds(7.68, true);
            if body.height <= 58.0 {
                assert!(body.radius + top * HEIGHT_SCREEN_SCALE + AIM_HEIGHT_MARGIN < AIM_SEARCH_PADDING);
            }
            assert!(body.radius + (body.height + 7.68) * HEIGHT_SCREEN_SCALE + AIM_HEIGHT_MARGIN < AIM_SEARCH_PADDING);
        }
    }
}
