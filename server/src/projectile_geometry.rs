//! Swept projectile intersections in world pixels. `height` is vertical;
//! x/y are the existing world-plane coordinates.
//! Player-fired arrows, bullets and thrown weapons use these primitives for
//! authoritative height-aware flight and first-contact resolution.

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Point3 {
    pub x: f32,
    pub y: f32,
    pub height: f32,
}

impl Point3 {
    fn is_finite(self) -> bool { self.x.is_finite() && self.y.is_finite() && self.height.is_finite() }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ProjectileSource { Player, Turret, Npc, Monument }

/// Match the existing client sampler until both sides switch to vertical 3D.
pub fn planar_gravity_multiplier(source: ProjectileSource, weapon: Option<&str>, self_ammo: bool, straight: f32, firearm: f32) -> f32 {
    match source {
        ProjectileSource::Npc | ProjectileSource::Monument => straight,
        ProjectileSource::Turret => 1.0,
        ProjectileSource::Player if self_ammo => straight,
        ProjectileSource::Player => match weapon {
            Some("Hunting Bow" | "Crossbow") => straight,
            Some("Makarov PM" | "PP-91 KEDR") => firearm,
            _ => 1.0,
        },
    }
}

#[derive(Clone, Copy, Debug)]
pub enum Collider3 {
    Cylinder { center: (f32, f32), radius: f32, bottom: f32, top: f32 },
    Box { min: Point3, max: Point3 },
}

/// Select the first physical contact, regardless of entity or table order.
pub fn first_impact(start: Point3, end: Point3, colliders: &[(u64, Collider3)]) -> Option<(u64, f32)> {
    colliders.iter().filter_map(|(id, collider)| {
        let hit = match *collider {
            Collider3::Cylinder { center, radius, bottom, top } => cylinder_impact(start, end, center, radius, bottom, top),
            Collider3::Box { min, max } => box_impact(start, end, min, max),
        }?;
        Some((*id, hit))
    }).min_by(|a, b| a.1.total_cmp(&b.1).then_with(|| a.0.cmp(&b.0)))
}

/// A trajectory has a fixed ground-plane velocity and independent vertical
/// motion. Speed is measured in world pixels per second, like weapon stats.
#[derive(Clone, Copy, Debug)]
pub struct Trajectory3 {
    pub start: Point3,
    pub velocity: Point3,
    pub gravity: f32,
}

impl Trajectory3 {
    /// Automatically lead a stationary target's height. Zero gravity gives a
    /// fast straight bullet; nonzero gravity gives an arrow a true vertical arc.
    pub fn aim_at(start: Point3, target: Point3, speed: f32, gravity: f32) -> Option<Self> {
        let dx = target.x - start.x;
        let dy = target.y - start.y;
        let distance = dx.hypot(dy);
        if !start.is_finite() || !target.is_finite() || !distance.is_finite() || !speed.is_finite() || !gravity.is_finite()
            || distance < 1e-4 || speed <= 0.0 || gravity < 0.0 { return None; }
        let travel_time = distance / speed;
        Some(Self {
            start,
            velocity: Point3 {
                x: dx / travel_time,
                y: dy / travel_time,
                height: (target.height - start.height) / travel_time + 0.5 * gravity * travel_time,
            },
            gravity,
        })
    }

    pub fn position(&self, time: f32) -> Point3 {
        Point3 {
            x: self.start.x + self.velocity.x * time,
            y: self.start.y + self.velocity.y * time,
            height: self.start.height + self.velocity.height * time - 0.5 * self.gravity * time * time,
        }
    }
}

/// Restrict an interval of segment parameters to one axis of a slab.
fn intersect_slab(start: f32, delta: f32, min: f32, max: f32, entry: &mut f32, exit: &mut f32) -> bool {
    if delta.abs() < 1e-8 {
        return start >= min && start <= max;
    }
    let a = (min - start) / delta;
    let b = (max - start) / delta;
    *entry = entry.max(a.min(b));
    *exit = exit.min(a.max(b));
    *entry <= *exit
}

/// Earliest contact with a vertical cylinder, including a segment that starts
/// inside it. This combines the ground footprint and the height interval.
pub fn cylinder_impact(start: Point3, end: Point3, center: (f32, f32), radius: f32, bottom: f32, top: f32) -> Option<f32> {
    if !start.is_finite() || !end.is_finite() || !center.0.is_finite() || !center.1.is_finite()
        || !radius.is_finite() || !bottom.is_finite() || !top.is_finite() || radius < 0.0 || bottom > top { return None; }
    let dx = end.x - start.x;
    let dy = end.y - start.y;
    let fx = start.x - center.0;
    let fy = start.y - center.1;
    let a = dx * dx + dy * dy;
    let c = fx * fx + fy * fy - radius * radius;
    let (mut entry, mut exit): (f32, f32) = (0.0, 1.0);
    if a < 1e-8 {
        if c > 0.0 { return None; }
    } else {
        let b = 2.0 * (fx * dx + fy * dy);
        let discriminant = b * b - 4.0 * a * c;
        if discriminant < 0.0 { return None; }
        let root = discriminant.sqrt();
        entry = entry.max((-b - root) / (2.0 * a));
        exit = exit.min((-b + root) / (2.0 * a));
    }
    if entry > exit || !intersect_slab(start.height, end.height - start.height, bottom, top, &mut entry, &mut exit) {
        return None;
    }
    (entry <= exit && exit >= 0.0 && entry <= 1.0).then_some(entry.max(0.0))
}

/// The exit from a range circle, used to clip the final segment before
/// collision checks. This is distinct from first contact with solid cover.
pub fn range_exit(start: (f32, f32), end: (f32, f32), center: (f32, f32), radius: f32) -> Option<f32> {
    if !start.0.is_finite() || !start.1.is_finite() || !end.0.is_finite() || !end.1.is_finite()
        || !center.0.is_finite() || !center.1.is_finite() || !radius.is_finite() || radius < 0.0 { return None; }
    let (dx, dy) = (end.0 - start.0, end.1 - start.1);
    let (fx, fy) = (start.0 - center.0, start.1 - center.1);
    let a = dx * dx + dy * dy;
    let c = fx * fx + fy * fy - radius * radius;
    if c > 0.0 { return Some(0.0); }
    if a < 1e-8 { return None; }
    let b = 2.0 * (fx * dx + fy * dy);
    let discriminant = b * b - 4.0 * a * c;
    if discriminant < 0.0 { return None; }
    let exit = (-b + discriminant.sqrt()) / (2.0 * a);
    (0.0..=1.0).contains(&exit).then_some(exit)
}

/// Chunks whose contents may intersect a swept segment. The padding accounts
/// for colliders whose indexed position is away from their collision shape.
pub fn swept_chunks(start: (f32, f32), end: (f32, f32), padding: f32, chunk_size: f32, width: u32, height: u32) -> Vec<u32> {
    if !start.0.is_finite() || !start.1.is_finite() || !end.0.is_finite() || !end.1.is_finite()
        || !padding.is_finite() || padding < 0.0 || !chunk_size.is_finite() || chunk_size <= 0.0 || width == 0 || height == 0 {
        return Vec::new();
    }
    let bounds = |a: f32, b: f32, limit: u32| {
        let low = (((a.min(b) - padding) / chunk_size).floor() as i64).clamp(0, limit as i64 - 1) as u32;
        let high = (((a.max(b) + padding) / chunk_size).floor() as i64).clamp(0, limit as i64 - 1) as u32;
        (low, high)
    };
    let (min_x, max_x) = bounds(start.0, end.0, width);
    let (min_y, max_y) = bounds(start.1, end.1, height);
    let mut chunks = Vec::new();
    for y in min_y..=max_y {
        for x in min_x..=max_x { chunks.push(y * width + x); }
    }
    chunks
}

/// Earliest contact with a 3D axis-aligned box, for solid cover and targets.
pub fn box_impact(start: Point3, end: Point3, min: Point3, max: Point3) -> Option<f32> {
    let (mut entry, mut exit): (f32, f32) = (0.0, 1.0);
    if !start.is_finite() || !end.is_finite() || !min.is_finite() || !max.is_finite()
        || min.x > max.x || min.y > max.y || min.height > max.height { return None; }
    for (a, b, lo, hi) in [
        (start.x, end.x, min.x, max.x),
        (start.y, end.y, min.y, max.y),
        (start.height, end.height, min.height, max.height),
    ] {
        if !intersect_slab(a, b - a, lo, hi, &mut entry, &mut exit) { return None; }
    }
    (entry <= exit && exit >= 0.0 && entry <= 1.0).then_some(entry.max(0.0))
}

/// Contact with the surface of an enclosed box. Shots starting inside do not
/// hit until they actually leave it; a wholly internal segment has no contact.
pub fn box_surface_impact(start: Point3, end: Point3, min: Point3, max: Point3) -> Option<f32> {
    let inside = |p: Point3| p.x >= min.x && p.x <= max.x && p.y >= min.y && p.y <= max.y && p.height >= min.height && p.height <= max.height;
    if !inside(start) { return box_impact(start, end, min, max); }
    if inside(end) { return None; }
    let (mut entry, mut exit): (f32, f32) = (0.0, 1.0);
    for (a, b, lo, hi) in [(start.x, end.x, min.x, max.x), (start.y, end.y, min.y, max.y), (start.height, end.height, min.height, max.height)] {
        if !intersect_slab(a, b - a, lo, hi, &mut entry, &mut exit) { return None; }
    }
    Some(exit.clamp(0.0, 1.0))
}

/// Sweep a point through a vertical wall segment with finite thickness.
pub fn wall_segment_impact(start: Point3, end: Point3, a: (f32, f32), b: (f32, f32), thickness: f32, bottom: f32, top: f32) -> Option<f32> {
    let dx = b.0 - a.0;
    let dy = b.1 - a.1;
    let length = dx.hypot(dy);
    if length < 1e-6 || !length.is_finite() || !thickness.is_finite() || thickness < 0.0 { return None; }
    let ux = dx / length;
    let uy = dy / length;
    let local = |p: Point3| Point3 { x: (p.x - a.0) * ux + (p.y - a.1) * uy,
        y: -(p.x - a.0) * uy + (p.y - a.1) * ux, height: p.height };
    box_impact(local(start), local(end), Point3 { x: 0.0, y: -thickness / 2.0, height: bottom },
        Point3 { x: length, y: thickness / 2.0, height: top })
}

pub fn box_impact_2d(start: (f32, f32), end: (f32, f32), min: (f32, f32), max: (f32, f32)) -> Option<f32> {
    box_impact(
        Point3 { x: start.0, y: start.1, height: 0.0 },
        Point3 { x: end.0, y: end.1, height: 0.0 },
        Point3 { x: min.0, y: min.1, height: 0.0 },
        Point3 { x: max.0, y: max.1, height: 0.0 },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    fn p(x: f32, y: f32, height: f32) -> Point3 { Point3 { x, y, height } }

    #[test]
    fn vertical_cover_blocks_only_at_its_height() {
        let low_cover = (p(20.0, -5.0, 0.0), p(30.0, 5.0, 40.0));
        assert_eq!(box_impact(p(0.0, 0.0, 20.0), p(100.0, 0.0, 20.0), low_cover.0, low_cover.1), Some(0.2));
        assert_eq!(box_impact(p(0.0, 0.0, 60.0), p(100.0, 0.0, 60.0), low_cover.0, low_cover.1), None);
        assert_eq!(cylinder_impact(p(0.0, 0.0, 60.0), p(100.0, 0.0, 60.0), (25.0, 0.0), 5.0, 0.0, 150.0), Some(0.2));
    }

    #[test]
    fn crossing_height_and_footprint_must_overlap_at_the_same_time() {
        let start = p(0.0, 0.0, 100.0);
        let end = p(100.0, 0.0, 0.0);
        assert_eq!(cylinder_impact(start, end, (25.0, 0.0), 5.0, 0.0, 40.0), None);
        assert_eq!(cylinder_impact(start, end, (75.0, 0.0), 5.0, 0.0, 40.0), Some(0.7));
    }

    #[test]
    fn first_contact_is_independent_of_candidate_order() {
        let start = p(0.0, 0.0, 50.0);
        let end = p(100.0, 0.0, 50.0);
        let behind = (10, Collider3::Cylinder { center: (80.0, 0.0), radius: 5.0, bottom: 0.0, top: 90.0 });
        let cover = (20, Collider3::Box { min: p(30.0, -5.0, 0.0), max: p(35.0, 5.0, 100.0) });
        assert_eq!(first_impact(start, end, &[behind, cover]), Some((20, 0.3)));
        assert_eq!(first_impact(start, end, &[cover, behind]), Some((20, 0.3)));
    }

    #[test]
    fn planar_structure_contact_lies_on_the_path_in_both_directions() {
        let min = (30.0, 10.0);
        let max = (40.0, 30.0);
        let forward = box_impact_2d((0.0, 0.0), (100.0, 50.0), min, max).unwrap();
        assert!((forward - 0.3).abs() < 1e-6);
        let reverse = box_impact_2d((100.0, 50.0), (0.0, 0.0), min, max).unwrap();
        assert!((reverse - 0.6).abs() < 1e-6);
        assert_eq!(box_impact_2d((0.0, 50.0), (100.0, 50.0), min, max), None);
    }

    #[test]
    fn shelter_surface_does_not_block_a_shot_entirely_inside() {
        let min = p(0.0, 0.0, 0.0);
        let max = p(100.0, 100.0, 100.0);
        assert_eq!(box_surface_impact(p(50.0, 50.0, 50.0), p(75.0, 50.0, 50.0), min, max), None);
        assert_eq!(box_surface_impact(p(50.0, 50.0, 50.0), p(150.0, 50.0, 50.0), min, max), Some(0.5));
        assert_eq!(box_surface_impact(p(-50.0, 50.0, 50.0), p(50.0, 50.0, 50.0), min, max), Some(0.5));
    }

    #[test]
    fn diagonal_wall_respects_height_and_actual_boundary() {
        let hit = wall_segment_impact(p(0.0, 50.0, 50.0), p(100.0, 50.0, 50.0), (0.0, 0.0), (100.0, 100.0), 4.0, 0.0, 100.0);
        assert!(hit.is_some_and(|t| t > 0.46 && t < 0.5));
        assert_eq!(wall_segment_impact(p(0.0, 50.0, 120.0), p(100.0, 50.0, 120.0), (0.0, 0.0), (100.0, 100.0), 4.0, 0.0, 100.0), None);
    }

    #[test]
    fn stationary_and_inside_segments_are_handled() {
        assert_eq!(cylinder_impact(p(0.0, 0.0, 5.0), p(0.0, 0.0, 5.0), (0.0, 0.0), 5.0, 0.0, 10.0), Some(0.0));
        assert_eq!(box_impact(p(1.0, 1.0, 5.0), p(1.0, 1.0, 5.0), p(0.0, 0.0, 0.0), p(2.0, 2.0, 10.0)), Some(0.0));
        assert_eq!(cylinder_impact(p(10.0, 0.0, 5.0), p(10.0, 0.0, 5.0), (0.0, 0.0), 5.0, 0.0, 10.0), None);
    }

    #[test]
    fn range_exit_clips_the_final_segment_without_losing_earlier_impacts() {
        let exit = range_exit((90.0, 0.0), (110.0, 0.0), (0.0, 0.0), 100.0).unwrap();
        assert_eq!(exit, 0.5);
        let clipped_end = 90.0 + 20.0 * exit;
        assert!(cylinder_impact(p(90.0, 0.0, 20.0), p(clipped_end, 0.0, 20.0), (98.0, 0.0), 1.0, 0.0, 40.0).is_some());
        assert!(cylinder_impact(p(90.0, 0.0, 20.0), p(clipped_end, 0.0, 20.0), (105.0, 0.0), 1.0, 0.0, 40.0).is_none());
        assert_eq!(range_exit((101.0, 0.0), (110.0, 0.0), (0.0, 0.0), 100.0), Some(0.0));
    }

    #[test]
    fn swept_chunk_query_covers_long_segments_and_collision_padding_without_duplicates() {
        let chunks = swept_chunks((50.0, 150.0), (650.0, 150.0), 20.0, 100.0, 10, 10);
        assert_eq!(chunks, vec![10, 11, 12, 13, 14, 15, 16]);
        let boundary = swept_chunks((105.0, 105.0), (105.0, 105.0), 10.0, 100.0, 3, 3);
        assert_eq!(boundary, vec![0, 1, 3, 4]);
        assert_eq!(swept_chunks((-20.0, -20.0), (1.0, 1.0), 20.0, 100.0, 3, 3), vec![0]);
        assert!(swept_chunks((f32::NAN, 0.0), (0.0, 0.0), 0.0, 100.0, 3, 3).is_empty());
    }

    #[test]
    fn automatic_aim_reaches_target_height_with_distinct_bullet_and_arrow_flights() {
        let start = p(0.0, 0.0, 50.0);
        let target = p(400.0, 0.0, 30.0);
        let arrow = Trajectory3::aim_at(start, target, 800.0, 320.0).unwrap();
        let bullet = Trajectory3::aim_at(start, target, 3200.0, 0.0).unwrap();
        assert!((arrow.position(0.5).height - target.height).abs() < 1e-4);
        assert!((bullet.position(0.125).height - target.height).abs() < 1e-4);
        assert!(arrow.position(0.25).height > (start.height + target.height) / 2.0);
        assert!((bullet.position(0.0625).height - (start.height + target.height) / 2.0).abs() < 1e-4);
        assert!(Trajectory3::aim_at(start, start, 800.0, 320.0).is_none());
        assert!(Trajectory3::aim_at(start, p(400.0, 0.0, f32::NAN), 800.0, 320.0).is_none());
    }

    #[test]
    fn swept_flights_all_stop_at_tall_cover_but_clear_low_cover() {
        let start = p(0.0, 0.0, 60.0);
        let target = p(400.0, 0.0, 60.0);
        let tall = Collider3::Cylinder { center: (200.0, 0.0), radius: 12.0, bottom: 0.0, top: 200.0 };
        let low = Collider3::Cylinder { center: (200.0, 0.0), radius: 12.0, bottom: 0.0, top: 30.0 };
        for (speed, gravity) in [(650.0, 300.0), (800.0, 240.0), (3200.0, 0.0)] {
            let flight = Trajectory3::aim_at(start, target, speed, gravity).unwrap();
            let end_time = 400.0 / speed;
            let mut tall_hit = false;
            let mut low_hit = false;
            let mut t = 0.0;
            while t < end_time {
                let next = (t + 0.075f32).min(end_time);
                let (a, b) = (flight.position(t), flight.position(next));
                tall_hit |= first_impact(a, b, &[(1, tall)]).is_some();
                low_hit |= first_impact(a, b, &[(1, low)]).is_some();
                t = next;
            }
            assert!(tall_hit, "speed {speed} missed the tall obstacle");
            assert!(!low_hit, "speed {speed} should clear the low obstacle");
        }
    }

    #[test]
    fn existing_client_and_server_use_the_same_planar_gravity_rules() {
        let sample = |source, weapon, self_ammo| planar_gravity_multiplier(source, weapon, self_ammo, 0.0, 0.15);
        assert_eq!(sample(ProjectileSource::Npc, Some("Makarov PM"), false), 0.0);
        assert_eq!(sample(ProjectileSource::Monument, None, true), 0.0);
        assert_eq!(sample(ProjectileSource::Turret, None, true), 1.0);
        assert_eq!(sample(ProjectileSource::Player, Some("Grenade"), true), 0.0);
        assert_eq!(sample(ProjectileSource::Player, Some("Hunting Bow"), false), 0.0);
        assert_eq!(sample(ProjectileSource::Player, Some("Makarov PM"), false), 0.15);
    }
}
