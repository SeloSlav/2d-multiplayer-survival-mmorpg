//! Shared model geometry for client prediction and server collision consumers.
//! Player movement remains client-authoritative; this module also supplies the
//! server's placement overlap and projectile cover checks.
use std::collections::HashMap;
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollisionGeometry {
    pub version: u32,
    pub village: VillageGeometry,
    pub shelter: ShelterGeometry,
    pub alk: AlkGeometry,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlkGeometry {
    pub tile_pixels: f32,
    pub buildings: HashMap<String, AlkBuilding>,
    pub turrets: HashMap<String, AlkTurret>,
    pub landmarks: Vec<AlkLandmark>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlkBuilding { pub width:f32, pub depth:f32, pub height:f32, pub center_offset_y:f32 }
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlkTurret { pub diameter:f32, pub height:f32, pub center_offset_y:f32 }
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlkLandmark { pub asset:String, pub offset_x:f32, pub offset_y:f32 }

#[derive(Clone, Copy, Debug)]
pub struct AlkBounds { pub x:f32, pub y:f32, pub half_width:f32, pub half_depth:f32, pub height:f32 }

pub fn alk_building_bounds(asset:&str, x:f32, y:f32) -> Option<AlkBounds> {
    let g=&COLLISION_GEOMETRY.alk;
    let plan=g.buildings.get(asset)?;
    Some(AlkBounds {x,y:y+plan.center_offset_y,half_width:plan.width*g.tile_pixels/2.0,
        half_depth:plan.depth*g.tile_pixels/2.0,height:plan.height*g.tile_pixels})
}

pub fn alk_turret_bounds(monument:bool, x:f32, y:f32) -> AlkBounds {
    let g=&COLLISION_GEOMETRY.alk;
    let plan=&g.turrets[if monument {"monument"} else {"player"}];
    let radius=plan.diameter*g.tile_pixels/2.0;
    AlkBounds {x,y:y+plan.center_offset_y,half_width:radius,half_depth:radius,height:plan.height*g.tile_pixels}
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

pub fn foundation_contains(shape:u8, u:f32, v:f32) -> bool {
    if !(0.0..=1.0).contains(&u) || !(0.0..=1.0).contains(&v) { return false; }
    match shape { 1=>true, 2=>u+v<=1.0, 3=>v<=u, 4=>u+v>=1.0, 5=>v>=u, _=>false }
}
pub fn foundation_edges(shape:u8) -> &'static [u8] {
    match shape {1=>&[0,1,2,3],2=>&[0,3,5],3=>&[0,1,4],4=>&[1,2,5],5=>&[2,3,4],_=>&[]}
}
pub fn foundation_edge_key(cx:i32,cy:i32,shape:u8,edge:u8) -> [(i32,i32);2] {
    let tile=crate::shared_config::FOUNDATION_TILE_SIZE_PX as f32;
    let line=construction_boundary((cx as f32+0.5)*tile,(cy as f32+0.5)*tile,edge,shape,false).unwrap();
    let a=(line.ax.round() as i32,line.ay.round() as i32);let b=(line.bx.round() as i32,line.by.round() as i32);
    if a<b {[a,b]} else {[b,a]}
}

/// Exposed physical edges, including diagonal triangle walls. Complementary
/// triangles in one cell cancel their common diagonal exactly like neighbors.
pub fn foundation_perimeter(cells:&[(i32,i32,u8)]) -> Vec<(i32,i32,u8)> {
    let mut edges:HashMap<_,Vec<_>>=HashMap::new();
    for &(cx,cy,shape) in cells {for &edge in foundation_edges(shape) {
        edges.entry(foundation_edge_key(cx,cy,shape,edge)).or_default().push((cx,cy,edge));
    }}
    edges.into_values().filter(|owners| owners.len()==1).map(|owners| owners[0]).collect()
}

/// The ground footprint of the visible interior, anchored at its front sill.
/// Padding is only for world-spawn clearance, never for indoor protection.
pub fn village_contains(asset: &str, ax: f32, ay: f32, rotation: f32, x: f32, y: f32, padding: f32) -> bool {
    let g = &COLLISION_GEOMETRY.village;
    let Some(p) = g.buildings.get(asset) else { return false };
    let (s, c) = rotation.sin_cos();
    let (dx, dy) = (x - ax, y - ay);
    let (u, v) = (dx * c + dy * s, -dx * s + dy * c);
    let (half, depth) = (p.width * g.tile_pixels / 2.0, p.depth * g.tile_pixels);
    if p.form == "round" {
        (u / (half + padding)).powi(2) + ((v + depth / 2.0) / (depth / 2.0 + padding)).powi(2) < 1.0
    } else { u.abs() < half + padding && v < padding && v > -depth - padding }
}

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
    fn enclosed_foundation_shapes_use_real_edges_and_exclude_unoccupied_triangle_halves() {
        for shape in 2..=5 {assert_eq!(foundation_perimeter(&[(0,0,shape)]).len(),3);}
        for (a,b) in [(2,4),(3,5)] {assert_eq!(foundation_perimeter(&[(0,0,a),(0,0,b)]).len(),4);}
        assert_eq!(foundation_perimeter(&[(0,0,1),(1,0,1)]).len(),6);
        assert_eq!(foundation_perimeter(&[(0,0,1),(1,1,1)]).len(),8,"corner touching rooms have no shared edge");
        for (shape,inside,outside) in [(2,(0.1,0.1),(0.9,0.9)),(3,(0.9,0.1),(0.1,0.9)),(4,(0.9,0.9),(0.1,0.1)),(5,(0.1,0.9),(0.9,0.1))] {
            assert!(foundation_contains(shape,inside.0,inside.1));assert!(!foundation_contains(shape,outside.0,outside.1));
        }
    }
    #[test]
    fn village_interiors_use_rotated_model_footprints_not_legacy_clearance_radii() {
        for (asset, p) in &COLLISION_GEOMETRY.village.buildings {
            let depth = p.depth * COLLISION_GEOMETRY.village.tile_pixels;
            let half = p.width * COLLISION_GEOMETRY.village.tile_pixels / 2.0;
            for rotation in [0.0, std::f32::consts::FRAC_PI_2, 0.73] {
                let (s, c) = rotation.sin_cos();
                let contains = |u: f32, v: f32, pad| village_contains(asset, 1000.0, 2000.0, rotation,
                    1000.0 + u * c - v * s, 2000.0 + u * s + v * c, pad);
                assert!(contains(0.0, -depth / 2.0, 0.0), "{asset}: center indoors");
                assert!(!contains(0.0, 10.0, 0.0), "{asset}: doorstep outside");
                assert!(!contains(half + 5.0, -depth / 2.0, 0.0), "{asset}: beside wall outside");
                assert!(contains(half + 5.0, -depth / 2.0, 32.0), "{asset}: world spawns have clearance");
                if p.form == "round" { assert!(!contains(half * 0.9, -depth * 0.9, 0.0), "round corner outside"); }
            }
        }
        assert!(!village_contains("fv_drying_rack.png", 0.0, 0.0, 0.0, 0.0, -20.0, 0.0));
    }
    #[test]
    fn alk_collision_uses_model_dimensions_and_anchors() {
        let b=alk_building_bounds("food",1000.0,1000.0).unwrap();
        assert!((b.half_width-168.0).abs()<0.001);
        assert!((b.half_depth-74.4).abs()<0.001);
        assert_eq!(b.y,960.0);
        let central=alk_building_bounds("central",1000.0,1000.0).unwrap();
        assert_eq!(central.y,860.0);
        assert!((central.half_width-170.4).abs()<0.001);
        let turret=alk_turret_bounds(true,1000.0,1000.0);
        assert!((turret.half_width-67.2).abs()<0.001);
        assert_eq!(turret.y,1040.0);
        let player=alk_turret_bounds(false,1000.0,1000.0);
        assert_eq!(player.half_width,30.0);assert_eq!(player.y,1070.0);
        assert_eq!(COLLISION_GEOMETRY.alk.landmarks.len(),4);
        assert!(alk_building_bounds("warehouse",0.0,0.0).is_none());
    }
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
