/// Keep wildlife ten tiles beyond the existing ALK safe-zone boundary.
pub const ALK_WILDLIFE_BUFFER_PX: f32 = 480.0;

#[derive(Clone, Copy, Debug)]
pub struct WildlifeExclusionZone {
    pub x: f32,
    pub y: f32,
    pub radius: f32,
}

impl WildlifeExclusionZone {
    pub fn new(x: f32, y: f32, safe_radius: f32) -> Self {
        Self { x, y, radius: safe_radius + ALK_WILDLIFE_BUFFER_PX }
    }

    pub fn contains(&self, x: f32, y: f32) -> bool {
        (x - self.x).powi(2) + (y - self.y).powi(2) < self.radius * self.radius
    }

    /// Check the whole movement segment, including fast flying animals.
    pub fn blocks_movement(&self, from: (f32, f32), to: (f32, f32)) -> bool {
        let dx = to.0 - from.0;
        let dy = to.1 - from.1;
        let length_sq = dx * dx + dy * dy;
        let t = if length_sq > 0.0 {
            (((self.x - from.0) * dx + (self.y - from.1) * dy) / length_sq).clamp(0.0, 1.0)
        } else { 0.0 };
        self.contains(from.0 + dx * t, from.1 + dy * t)
    }
}

/// Find nearby terrain outside every compound, preferring the closest direction.
pub fn find_clear_position(
    zones: &[WildlifeExclusionZone],
    from: (f32, f32),
    world_size: (f32, f32),
    suitable: impl Fn(f32, f32) -> bool,
) -> Option<(f32, f32)> {
    let zone = zones.iter().find(|zone| zone.contains(from.0, from.1))?;
    let base_angle = (from.1 - zone.y).atan2(from.0 - zone.x);
    for extra in [96.0, 192.0, 384.0, 768.0, 1536.0] {
        for i in 0..32 {
            let step = if i == 0 { 0.0 } else if i % 2 == 1 { ((i + 1) / 2) as f32 } else { -((i / 2) as f32) };
            let angle = base_angle + step * std::f32::consts::TAU / 32.0;
            let x = zone.x + angle.cos() * (zone.radius + extra);
            let y = zone.y + angle.sin() * (zone.radius + extra);
            if x < 50.0 || y < 50.0 || x >= world_size.0 - 50.0 || y >= world_size.1 - 50.0
                || zones.iter().any(|other| other.contains(x, y)) { continue; }
            if suitable(x, y) { return Some((x, y)); }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn boundary_includes_the_buffer_and_blocks_entry_or_crossing() {
        let zone = WildlifeExclusionZone::new(100.0, 200.0, 600.0);
        assert_eq!(zone.radius, 1080.0);
        assert!(zone.contains(100.0, 200.0));
        assert!(zone.contains(1179.0, 200.0));
        assert!(!zone.contains(1180.0, 200.0));
        assert!(zone.blocks_movement((1190.0, 200.0), (1170.0, 200.0)));
        assert!(zone.blocks_movement((-1000.0, 200.0), (1200.0, 200.0)));
        assert!(!zone.blocks_movement((1190.0, 200.0), (1200.0, 200.0)));
        assert!(!zone.blocks_movement((1180.0, 200.0), (1180.0, 300.0)));
    }

    #[test]
    fn relocation_avoids_overlapping_compounds_and_unsuitable_terrain() {
        let zones = [WildlifeExclusionZone::new(5000.0, 5000.0, 600.0), WildlifeExclusionZone::new(6200.0, 5000.0, 600.0)];
        let (x, y) = find_clear_position(&zones, (5100.0, 5000.0), (10000.0, 10000.0), |x, _| x < 5000.0).unwrap();
        assert!(x < 5000.0);
        assert!(zones.iter().all(|zone| !zone.contains(x, y)));
        assert!(find_clear_position(&zones, (5100.0, 5000.0), (10000.0, 10000.0), |_, _| false).is_none());
    }
}
