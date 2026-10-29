//! Shared authored collision geometry. This module does not enforce movement:
//! server enforcement must wait until prediction and reconciliation agree.
use std::collections::HashMap;
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollisionGeometry {
    pub version: u32,
    pub village: VillageGeometry,
    pub shelter: ShelterGeometry,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VillageGeometry {
    pub tile_pixels: f32,
    pub door_half_width: f32,
    pub wall_thickness: f32,
    pub campfire_radius: f32,
    pub campfire_offset_y: f32,
    pub buildings: HashMap<String, VillageBuilding>,
}

#[derive(Deserialize)]
pub struct VillageBuilding { pub form: String, pub width: f32, pub depth: f32 }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShelterGeometry { pub width: f32, pub height: f32, pub center_offset_y: f32 }

lazy_static::lazy_static! {
    pub static ref COLLISION_GEOMETRY: CollisionGeometry = serde_json::from_str(
        include_str!("../../shared/config/collisionGeometry.json")
    ).expect("shared collision geometry must be valid");
}

#[derive(Debug, Clone, Copy)]
pub struct Segment { pub ax: f32, pub ay: f32, pub bx: f32, pub by: f32 }

/// The same foundation-edge coordinates used by the 3D building models.
/// Doors and fences are centered on their stored edge position; walls are
/// anchored at their foundation-cell center.
pub fn construction_boundary(x: f32, y: f32, edge: u8, foundation_shape: u8, centered: bool) -> Option<Segment> {
    let h = crate::shared_config::FOUNDATION_TILE_SIZE_PX as f32 / 2.0;
    let (mut ax, mut ay, mut bx, mut by) = match edge {
        0 => (-h, -h, h, -h),
        1 => (h, -h, h, h),
        2 => (h, h, -h, h),
        3 => (-h, h, -h, -h),
        4 | 5 if foundation_shape == 2 || foundation_shape == 4 => (-h, h, h, -h),
        4 | 5 if foundation_shape == 3 || foundation_shape == 5 => (-h, -h, h, h),
        4 => (h, -h, -h, h),
        5 => (-h, -h, h, h),
        _ => return None,
    };
    if centered {
        let cx = (ax + bx) / 2.0;
        let cy = (ay + by) / 2.0;
        ax -= cx; bx -= cx; ay -= cy; by -= cy;
    }
    Some(Segment { ax: x + ax, ay: y + ay, bx: x + bx, by: y + by })
}

/// Match the 3D model's front-sill anchor, opening and optional rotation.
pub fn village_wall_segments(asset: &str, x: f32, y: f32, rotation: f32) -> Vec<Segment> {
    let g = &COLLISION_GEOMETRY.village;
    let Some(plan) = g.buildings.get(asset) else { return Vec::new() };
    let (s, c) = rotation.sin_cos();
    let world = |u: f32, v: f32| (x + g.tile_pixels * (u * c - v * s), y + g.tile_pixels * (u * s + v * c));
    let mut segments = Vec::new();
    let mut add = |ax, ay, bx, by| {
        let (ax, ay) = world(ax, ay);
        let (bx, by) = world(bx, by);
        segments.push(Segment { ax, ay, bx, by });
    };
    let half = plan.width / 2.0;
    if plan.form == "round" {
        let front = plan.depth / 2.0;
        let length = plan.width * std::f32::consts::PI / 28.0 + 0.02;
        for i in 3..=25 {
            let a = i as f32 / 28.0 * std::f32::consts::TAU;
            let (sin, cos) = a.sin_cos();
            let cx = sin * half;
            let cy = cos * front - front;
            let dx = cos * length / 2.0;
            let dy = -sin * length / 2.0;
            add(cx - dx, cy - dy, cx + dx, cy + dy);
        }
    } else {
        let door = g.door_half_width;
        add(-half, 0.0, -half, -plan.depth);
        add(half, 0.0, half, -plan.depth);
        add(-half, -plan.depth, half, -plan.depth);
        add(-half, 0.0, -door, 0.0);
        add(door, 0.0, half, 0.0);
    }
    segments
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn authored_plans_and_rotation_are_stable() {
        assert_eq!(COLLISION_GEOMETRY.version, 1);
        assert_eq!(COLLISION_GEOMETRY.village.buildings.len(), 13);
        let wall = village_wall_segments("av_lodge.png", 1000.0, 1000.0, 0.0);
        assert_eq!(wall.len(), 5);
        assert!((wall[0].ax - 841.6).abs() < 0.001);
        assert!((wall[0].by - 731.2).abs() < 0.001);
        let rotated = village_wall_segments("av_lodge.png", 1000.0, 1000.0, std::f32::consts::FRAC_PI_2);
        assert!((rotated[0].ax - 1000.0).abs() < 0.001);
        assert!((rotated[0].ay - 841.6).abs() < 0.001);
        assert_eq!(village_wall_segments("hv_hut2.png", 0.0, 0.0, 0.0).len(), 23);
        let round = village_wall_segments("hv_hut2.png", 0.0, 0.0, 0.0)[0];
        for (actual, expected) in [(round.ax, 58.773565), (round.ay, -12.398223), (round.bx, 78.892983), (round.by, -28.442924)] {
            assert!((actual - expected).abs() < 0.001);
        }
        assert!(village_wall_segments("unknown.png", 0.0, 0.0, 0.0).is_empty());
    }

    #[test]
    fn construction_edges_follow_model_geometry() {
        let expected = [(-48.0,-48.0,48.0,-48.0), (48.0,-48.0,48.0,48.0),
            (48.0,48.0,-48.0,48.0), (-48.0,48.0,-48.0,-48.0)];
        for (edge, (ax, ay, bx, by)) in expected.into_iter().enumerate() {
            let s = construction_boundary(0.0, 0.0, edge as u8, 1, false).unwrap();
            assert_eq!((s.ax, s.ay, s.bx, s.by), (ax, ay, bx, by));
            let centered = construction_boundary(100.0, 200.0, edge as u8, 1, true).unwrap();
            assert_eq!(((centered.ax+centered.bx)/2.0, (centered.ay+centered.by)/2.0), (100.0, 200.0));
        }
        for (shape, edge, expected) in [(2,5,(-48.0,48.0,48.0,-48.0)), (4,5,(-48.0,48.0,48.0,-48.0)),
            (3,4,(-48.0,-48.0,48.0,48.0)), (5,4,(-48.0,-48.0,48.0,48.0))] {
            let s = construction_boundary(0.0,0.0,edge,shape,false).unwrap();
            assert_eq!((s.ax,s.ay,s.bx,s.by),expected);
        }
        assert!(construction_boundary(0.0,0.0,6,1,false).is_none());
    }
}
