use crate::alk::alk_station as AlkStationTableTrait;
use spacetimedb::{table, reducer, SpacetimeType, Identity, Timestamp, ReducerContext, Table, TimeDuration, ScheduleAt};
use std::f32::consts::PI;
use rand::{Rng, SeedableRng};

// Import the PlayerLastAttackTimestamp struct from root crate
use crate::PlayerLastAttackTimestamp;

// Import table accessor traits
use crate::player;
use crate::monument_part;
use crate::building::foundation_cell;
use crate::cairn::cairn;
use crate::sea_stack::sea_stack;
use crate::road_lamppost::road_lamppost;
use crate::active_equipment::active_equipment;
use crate::items::item_definition;
use crate::items::inventory_item as inventory_item_table_accessor;
use crate::ranged_weapon_stats::ranged_weapon_stats;
use crate::player_last_attack_timestamp;
use crate::combat; // Import the combat module to use damage_player
use crate::dropped_item; // Import the dropped item module for creating dropped items
use crate::active_effects; // Import the active effects module for applying ammunition-based effects
use crate::active_effects::active_consumable_effect; // Import the trait for the table
use crate::shelter; // Import shelter module for collision detection
use crate::shelter::shelter as ShelterTableTrait; // Import shelter table trait
use crate::sound_events; // Import sound events for arrow hit sounds

// Import deployable entity modules for collision detection
use crate::campfire::{Campfire, CAMPFIRE_COLLISION_RADIUS, CAMPFIRE_COLLISION_Y_OFFSET, campfire as CampfireTableTrait};
use crate::wooden_storage_box::{WoodenStorageBox, BOX_COLLISION_RADIUS, BOX_COLLISION_Y_OFFSET, wooden_storage_box as WoodenStorageBoxTableTrait};
use crate::stash::{Stash, stash as StashTableTrait};
use crate::sleeping_bag::{SleepingBag, SLEEPING_BAG_COLLISION_RADIUS, SLEEPING_BAG_COLLISION_Y_OFFSET, sleeping_bag as SleepingBagTableTrait};
use crate::barrel::{Barrel, barrel as BarrelTableTrait};
use crate::player_corpse::{PlayerCorpse, CORPSE_COLLISION_RADIUS, CORPSE_COLLISION_Y_OFFSET, player_corpse as PlayerCorpseTableTrait};
use crate::rain_collector::{RainCollector, RAIN_COLLECTOR_COLLISION_RADIUS, RAIN_COLLECTOR_COLLISION_Y_OFFSET, rain_collector as RainCollectorTableTrait};
use crate::furnace::{Furnace, FURNACE_COLLISION_RADIUS, FURNACE_COLLISION_Y_OFFSET, furnace as FurnaceTableTrait};
use crate::lantern::{Lantern, lantern as LanternTableTrait};
use crate::barbecue::{BARBECUE_COLLISION_RADIUS, BARBECUE_COLLISION_Y_OFFSET, barbecue as BarbecueTableTrait};
use crate::coral::{LIVING_CORAL_RADIUS, LIVING_CORAL_COLLISION_Y_OFFSET, living_coral as LivingCoralTableTrait};
// Lantern collision constants (not exported from lantern.rs, so define here)
const PROJECTILE_LANTERN_HIT_RADIUS: f32 = 25.0; // Generous radius for lanterns
const PROJECTILE_LANTERN_Y_OFFSET: f32 = 0.0; // No Y offset needed
use crate::homestead_hearth::{HomesteadHearth, HEARTH_COLLISION_RADIUS, HEARTH_COLLISION_Y_OFFSET, homestead_hearth as HomesteadHearthTableTrait};
use crate::wild_animal_npc::animal_corpse::{AnimalCorpse, ANIMAL_CORPSE_COLLISION_RADIUS, ANIMAL_CORPSE_COLLISION_Y_OFFSET, animal_corpse as AnimalCorpseTableTrait};

const PROJECTILE_RESOLVED_EVENT_RETENTION_MICROS: i64 = 5_000_000;

// Import natural obstacle modules for collision detection
use crate::tree::{Tree, tree as TreeTableTrait};
use crate::stone::{Stone, stone as StoneTableTrait};
use crate::rune_stone::rune_stone as RuneStoneTableTrait;
use crate::basalt_column::{BasaltColumn, basalt_column as BasaltColumnTableTrait};

// Import wild animal module for collision detection
use crate::wild_animal_npc::{wild_animal as WildAnimalTableTrait};
use crate::turret::{self, TALLOW_PROJECTILE_DAMAGE};
use crate::turret::turret as TurretTableTrait;
use crate::environment::{calculate_chunk_index, CHUNK_SIZE_PX, WORLD_WIDTH_CHUNKS, WORLD_HEIGHT_CHUNKS};
pub use crate::shared_config::{
    NPC_PROJECTILE_NONE,
    NPC_PROJECTILE_SPECTRAL_BOLT,
    NPC_PROJECTILE_SPECTRAL_SHARD,
    NPC_PROJECTILE_VENOM_SPITTLE,
    PROJECTILE_FIREARM_GRAVITY_MULTIPLIER,
    PROJECTILE_GRAVITY as GRAVITY,
    PROJECTILE_NPC_PLAYER_HIT_RADIUS,
    PROJECTILE_PLAYER_HIT_RADIUS,
    PROJECTILE_SOURCE_MONUMENT_TURRET,
    PROJECTILE_SOURCE_NPC,
    PROJECTILE_SOURCE_PLAYER,
    PROJECTILE_SOURCE_TURRET,
    PROJECTILE_STRAIGHT_LINE_GRAVITY_MULTIPLIER,
};

// NPC ranged attack constants
pub const NPC_RANGED_COUNTER_COOLDOWN_MS: i64 = 2000; // 2 second cooldown between ranged counter-attacks
pub const SHARDKIN_PROJECTILE_DAMAGE: f32 = 8.0;   // Low damage, but swarm multiple shards
pub const SHARDKIN_PROJECTILE_SPEED: f32 = 550.0;  // Fast shards - hard to dodge
pub const SHOREBOUND_PROJECTILE_DAMAGE: f32 = 15.0; // Moderate damage
pub const SHOREBOUND_PROJECTILE_SPEED: f32 = 500.0; // Medium-fast ghostly bolt
pub const VIPER_PROJECTILE_DAMAGE: f32 = 5.0;       // Low impact, but applies venom
pub const VIPER_PROJECTILE_SPEED: f32 = 450.0;      // Fast venom spittle

/// Helper function to check if a line segment intersects with a circle
/// Returns true if the line from (x1,y1) to (x2,y2) intersects with circle at (cx,cy) with radius r
pub fn line_intersects_circle(x1: f32, y1: f32, x2: f32, y2: f32, cx: f32, cy: f32, radius: f32) -> bool {
    // Vector from line start to circle center
    let ac_x = cx - x1;
    let ac_y = cy - y1;
    
    // Vector of the line segment
    let ab_x = x2 - x1;
    let ab_y = y2 - y1;
    
    // Length squared of the line segment
    let ab_length_sq = ab_x * ab_x + ab_y * ab_y;
    
    // If line segment has zero length, check point-to-circle distance
    if ab_length_sq < 1e-8 {
        let dist_sq = ac_x * ac_x + ac_y * ac_y;
        return dist_sq <= radius * radius;
    }
    
    // Project AC onto AB to find the closest point on the line segment
    let t = (ac_x * ab_x + ac_y * ab_y) / ab_length_sq;
    
    // Clamp t to [0, 1] to stay within the line segment
    let t_clamped = t.max(0.0).min(1.0);
    
    // Find the closest point on the line segment
    let closest_x = x1 + t_clamped * ab_x;
    let closest_y = y1 + t_clamped * ab_y;
    
    // Check if the closest point is within the circle
    let dist_x = cx - closest_x;
    let dist_y = cy - closest_y;
    let dist_sq = dist_x * dist_x + dist_y * dist_y;
    
    dist_sq <= radius * radius
}

/// Keep server sampling in step with the client for every projectile source.
fn projectile_gravity_multiplier(source: u8, weapon: Option<&str>, self_ammo: bool) -> f32 {
    use crate::projectile_geometry::ProjectileSource;
    let kind = match source {
        PROJECTILE_SOURCE_NPC => ProjectileSource::Npc,
        PROJECTILE_SOURCE_MONUMENT_TURRET => ProjectileSource::Monument,
        PROJECTILE_SOURCE_TURRET => ProjectileSource::Turret,
        _ => ProjectileSource::Player,
    };
    crate::projectile_geometry::planar_gravity_multiplier(kind, weapon, self_ammo,
        PROJECTILE_STRAIGHT_LINE_GRAVITY_MULTIPLIER, PROJECTILE_FIREARM_GRAVITY_MULTIPLIER)
}

/// Returns the first impact point (closest to segment start) where the segment
/// intersects the circle, or None if there is no intersection on [0, 1].
pub fn line_circle_first_impact_point(
    x1: f32,
    y1: f32,
    x2: f32,
    y2: f32,
    cx: f32,
    cy: f32,
    radius: f32,
) -> Option<(f32, f32)> {
    let start = crate::projectile_geometry::Point3 { x: x1, y: y1, height: 0.0 };
    let end = crate::projectile_geometry::Point3 { x: x2, y: y2, height: 0.0 };
    let t = crate::projectile_geometry::cylinder_impact(start, end, (cx, cy), radius, 0.0, 0.0)?;
    Some((x1 + t * (x2 - x1), y1 + t * (y2 - y1)))
}

fn clip_segment_to_range(previous: (f32, f32), current: (f32, f32), origin: (f32, f32), range: f32) -> (f32, f32) {
    let t = crate::projectile_geometry::range_exit(previous, current, origin, range).unwrap_or(0.0);
    (previous.0 + t * (current.0 - previous.0), previous.1 + t * (current.1 - previous.1))
}

#[table(accessor = projectile, public)]
#[derive(Clone, Debug)]
pub struct Projectile {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub client_shot_id: String,
    pub owner_id: Identity,
    pub item_def_id: u64,
    pub ammo_def_id: u64, // NEW: The ammunition type that was fired (e.g., Wooden Arrow)
    pub source_type: u8,  // 0 = player weapon, 1 = turret, 2 = NPC
    pub npc_projectile_type: u8, // 0 = none, 1 = spectral shard, 2 = spectral bolt, 3 = venom spittle
    pub start_time: Timestamp,
    pub start_pos_x: f32,
    pub start_pos_y: f32,
    pub velocity_x: f32,
    pub velocity_y: f32,
    pub max_range: f32,
    #[default(false)]
    pub flight_3d: bool,
    #[default(0.0)]
    pub start_height: f32,
    #[default(0.0)]
    pub velocity_height: f32,
    #[default(0.0)]
    pub gravity_height: f32,
}

#[table(accessor = projectile_runtime_state)]
#[derive(Clone, Debug)]
pub struct ProjectileRuntimeState {
    #[primary_key]
    pub projectile_id: u64,
    pub last_sample_elapsed_secs: f32,
}

/// Instance-specific data belongs to the thrown weapon, not its definition.
#[table(accessor = thrown_projectile_item)]
#[derive(Clone, Debug)]
pub struct ThrownProjectileItem {
    #[primary_key]
    pub projectile_id: u64,
    pub item_data: Option<String>,
}

fn is_throwable_melee(item: &crate::items::ItemDefinition) -> bool {
    item.category == crate::items::ItemCategory::Weapon ||
        (item.category == crate::items::ItemCategory::Tool && item.pvp_damage_max.unwrap_or(0) > 0
            && !matches!(item.name.as_str(), "Torch" | "Repair Hammer" | "Flashlight"))
}

/// Vertical bounds use the same 48-pixel scene scale as the 3D presentation.
fn ground_height_at(ctx: &ReducerContext, x: f32, y: f32) -> f32 {
    let size = crate::shared_config::FOUNDATION_TILE_SIZE_PX as f32;
    let cx = (x / size).floor() as i32;
    let cy = (y / size).floor() as i32;
    let lx = x - (cx as f32 + 0.5) * size;
    let ly = y - (cy as f32 + 0.5) * size;
    for foundation in ctx.db.foundation_cell().idx_cell_coords().filter((cx, cy)) {
        if foundation.is_destroyed { continue; }
        let inside = match foundation.shape { 1 => true, 2 => lx + ly <= 0.0, 3 => lx >= ly, 4 => lx + ly >= 0.0, 5 => lx <= ly, _ => false };
        if inside { return 7.68; }
    }
    0.0
}

fn player_vertical_bounds(ctx: &ReducerContext, player: &crate::Player, now: Timestamp) -> (f32, f32) {
    let now_ms = (now.to_micros_since_unix_epoch() / 1000).max(0) as u64;
    let elapsed = now_ms.saturating_sub(player.jump_start_time_ms);
    let jump = if player.jump_start_time_ms > 0 && elapsed < 500 {
        (elapsed as f32 / 500.0 * std::f32::consts::PI).sin() * 43.2
    } else { 0.0 };
    let bottom = jump + ground_height_at(ctx, player.position_x, player.position_y);
    (bottom, bottom + if player.is_crouching { 63.0 } else { 90.0 })
}

fn animal_projectile_profile(animal: &crate::wild_animal_npc::WildAnimal) -> crate::wildlife_projectile_geometry::WildlifeProjectileProfile {
    use crate::wild_animal_npc::AnimalSpecies::*;
    crate::wildlife_projectile_geometry::profile(match animal.species {
        CinderFox => "CinderFox", TundraWolf => "TundraWolf", Wolverine => "Wolverine",
        PolarBear => "PolarBear", Caribou => "Caribou", Hare => "Hare", Vole => "Vole",
        ArcticWalrus => "ArcticWalrus", Crow => "Crow", Tern => "Tern", SnowyOwl => "SnowyOwl",
        Bee => "Bee", BeachCrab => "BeachCrab", CableViper => "CableViper", SalmonShark => "SalmonShark",
        Jellyfish => "Jellyfish", Shorebound => "Shorebound", Shardkin => "Shardkin", DrownedWatch => "DrownedWatch",
    })
}

fn animal_vertical_bounds(ctx: &ReducerContext, animal: &crate::wild_animal_npc::WildAnimal) -> (f32, f32) {
    animal_projectile_profile(animal).vertical_bounds(ground_height_at(ctx, animal.pos_x, animal.pos_y), animal.is_flying)
}

fn animal_projectile_direction(animal: &crate::wild_animal_npc::WildAnimal) -> (f32, f32) {
    crate::wildlife_projectile_geometry::direction_or_facing((animal.direction_x, animal.direction_y), &animal.facing_direction)
}

/// The pointer is projected onto the ground plane. Compensate for the visual
/// elevation of nearby characters. Wildlife preserves the reticle's projected
/// point so a deliberate lead is not snapped back to a moving animal's centre.
fn auto_aim_target(ctx: &ReducerContext, owner: Identity, x: f32, y: f32, fallback_height: f32) -> crate::projectile_geometry::Point3 {
    use crate::projectile_geometry::{Point3, swept_chunks};
    let mut target = Point3 { x, y, height: fallback_height };
    let mut best = 42.0f32.powi(2);
    let consider = |cx: f32, cy: f32, bottom: f32, top: f32, best: &mut f32, target: &mut Point3| {
        let h = (bottom + top) * 0.5;
        let dx = x - cx;
        let ground_dy = y - cy;
        let projected_dy = y - (cy - h * 0.8660254);
        let score = (dx * dx + ground_dy * ground_dy).min(dx * dx + projected_dy * projected_dy);
        if score < *best { *best = score; *target = Point3 { x: cx, y: cy, height: h }; }
    };
    for player in ctx.db.player().iter() {
        if player.identity == owner || player.is_dead || !player.is_online { continue; }
        let (bottom, top) = player_vertical_bounds(ctx, &player, ctx.timestamp);
        consider(player.position_x, player.position_y, bottom, top, &mut best, &mut target);
    }
    for chunk in swept_chunks((x, y), (x, y), crate::wildlife_projectile_geometry::AIM_SEARCH_PADDING, CHUNK_SIZE_PX, WORLD_WIDTH_CHUNKS, WORLD_HEIGHT_CHUNKS) {
        for animal in ctx.db.wild_animal().chunk_index().filter(chunk) {
            if animal.health <= 0.0 || animal.state == crate::wild_animal_npc::AnimalState::Burrowed { continue; }
            if animal.species.is_hostile_npc() {
                let (bottom, top) = animal_vertical_bounds(ctx, &animal);
                consider(animal.pos_x, animal.pos_y, bottom, top, &mut best, &mut target);
            } else if let Some((score, aim)) = animal_projectile_profile(&animal).aim_target(
                (x, y), (animal.pos_x, animal.pos_y), animal_projectile_direction(&animal),
                ground_height_at(ctx, animal.pos_x, animal.pos_y), animal.is_flying,
            ) {
                if score < best { best = score; target = aim; }
            }
        }
    }
    target
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum FlightHit { Entity(&'static str, u64), Player(Identity), World, Ground }

/// Find the first physical contact before running any damage handlers.
fn first_flight_hit(ctx: &ReducerContext, projectile: &Projectile, start: crate::projectile_geometry::Point3,
    end: crate::projectile_geometry::Point3, chunks: &[u32], village_parts: &[crate::MonumentPart]) -> Option<(FlightHit, f32)> {
    use crate::projectile_geometry::cylinder_impact;
    let mut best: Option<(FlightHit, f32)> = None;
    let mut add = |key, t: Option<f32>| {
        if let Some(t) = t {
            if best.as_ref().map_or(true, |(_, old)| t < *old) { best = Some((key, t)); }
        }
    };
    let segment_length = (end.x - start.x).hypot(end.y - start.y);
    for (key, hit) in [
        ("door", crate::door::check_door_projectile_collision_3d(ctx, start.x, start.y, end.x, end.y, start.height, end.height)),
        ("fence", crate::fence::check_projectile_fence_collision_3d(ctx, start.x, start.y, end.x, end.y, start.height, end.height)),
        ("wall", crate::building::check_projectile_wall_collision_3d(ctx, start.x, start.y, end.x, end.y, start.height, end.height)),
        ("shelter", crate::shelter::check_projectile_shelter_collision_3d(ctx, start, end).map(|(id, x, y)| (id as u64, x, y))),
    ] {
        if let Some((id, x, y)) = hit {
            let t = if segment_length > 1e-6 { (x - start.x).hypot(y - start.y) / segment_length } else { 0.0 };
            add(FlightHit::Entity(key, id), Some(t));
        }
    }
    // Village walls share the authored segment geometry with their models,
    // including openings and rotation. They are indestructible world cover.
    let bounds = (start.x.min(end.x) - 600.0, start.x.max(end.x) + 600.0,
        start.y.min(end.y) - 600.0, start.y.max(end.y) + 600.0);
    for part in village_parts {
        if part.world_x < bounds.0 || part.world_x > bounds.1 || part.world_y < bounds.2 || part.world_y > bounds.3 { continue; }
        for segment in crate::collision_geometry::village_wall_segments(&part.image_path, part.world_x, part.world_y, part.rotation_rad) {
            add(FlightHit::World, crate::projectile_geometry::wall_segment_impact(start, end,
                (segment.ax, segment.ay), (segment.bx, segment.by), 8.0, 0.0, 130.0));
        }
    }
    macro_rules! circle { ($kind:expr, $id:expr, $x:expr, $y:expr, $radius:expr, $bottom:expr, $top:expr) => {
        add(FlightHit::Entity($kind, $id as u64), cylinder_impact(start, end, ($x, $y), $radius, $bottom, $top));
    }; }
    for chunk in chunks {
        for stone in ctx.db.cairn().chunk_index().filter(*chunk) {
            add(FlightHit::World, cylinder_impact(start, end, (stone.pos_x, stone.pos_y - 24.0), 28.0, 0.0, 75.0));
        }
        for stack in ctx.db.sea_stack().chunk_index().filter(*chunk) {
            add(FlightHit::World, cylinder_impact(start, end, (stack.pos_x, stack.pos_y - 70.0 * stack.scale), 60.0 * stack.scale, 0.0, 180.0 * stack.scale));
        }
        for lamp in ctx.db.road_lamppost().chunk_index().filter(*chunk) {
            add(FlightHit::World, cylinder_impact(start, end, (lamp.pos_x, lamp.pos_y - 90.0), 5.0, 0.0, 190.0));
        }
        for tree in ctx.db.tree().chunk_index().filter(*chunk) {
            if tree.respawn_at <= Timestamp::UNIX_EPOCH {
                let x_offset = if tree.tree_type == crate::tree::TreeType::KrummholzSpruce { -40.0 } else { 0.0 };
                let y_offset = if tree.tree_type == crate::tree::TreeType::RowanberryTree { -88.0 } else { -68.0 };
                let height = match tree.tree_type { crate::tree::TreeType::ArcticWillow => 90.0, crate::tree::TreeType::DwarfPine => 110.0, _ => 250.0 };
                circle!("tree", tree.id, tree.pos_x + x_offset, tree.pos_y + y_offset, 30.0, 0.0, height);
            }
        }
        for stone in ctx.db.stone().chunk_index().filter(*chunk) {
            if stone.respawn_at <= Timestamp::UNIX_EPOCH { circle!("stone", stone.id, stone.pos_x, stone.pos_y - 36.0, 32.0, 0.0, 50.0); }
        }
        for stone in ctx.db.rune_stone().chunk_index().filter(*chunk) { circle!("rune", stone.id, stone.pos_x, stone.pos_y - 24.0, 40.0, 0.0, 110.0); }
        for rock in ctx.db.basalt_column().chunk_index().filter(*chunk) { circle!("basalt", rock.id, rock.pos_x, rock.pos_y - 40.0, 35.0, 0.0, 140.0); }
        for coral in ctx.db.living_coral().chunk_index().filter(*chunk) {
            if coral.respawn_at <= Timestamp::UNIX_EPOCH { circle!("coral", coral.id, coral.pos_x, coral.pos_y - LIVING_CORAL_COLLISION_Y_OFFSET, LIVING_CORAL_RADIUS, 0.0, 70.0); }
        }
        for item in ctx.db.campfire().chunk_index().filter(*chunk) {
            if !item.is_destroyed { circle!("campfire", item.id, item.pos_x, item.pos_y + 5.0, 32.0, 0.0, 24.0); }
        }
        for item in ctx.db.wooden_storage_box().chunk_index().filter(*chunk) {
            if item.is_destroyed || item.box_type == crate::wooden_storage_box::BOX_TYPE_BACKPACK { continue; }
            if item.is_monument && [3, 5, 6].contains(&item.box_type) && crate::environment::is_position_in_central_compound(item.pos_x, item.pos_y) {
                let asset=match item.box_type {3=>"compost",5=>"weapons",_=>"food"};
                let b=crate::collision_geometry::alk_building_bounds(asset,item.pos_x,item.pos_y).unwrap();
                add(FlightHit::Entity("box", item.id as u64), alk_box_impact(start,end,b));
            } else {
                let offset = match item.box_type { 11 | 12 => 82.0, 14..=17 => 48.0, _ => 50.0 };
                circle!("box", item.id, item.pos_x, item.pos_y - offset, 28.0, 0.0, 45.0);
            }
        }
        for item in ctx.db.stash().chunk_index().filter(*chunk) {
            if !item.is_destroyed { circle!("stash", item.id, item.pos_x, item.pos_y - 24.0, 25.0, 0.0, 20.0); }
        }
        for item in ctx.db.sleeping_bag().chunk_index().filter(*chunk) {
            if !item.is_destroyed { circle!("bag", item.id, item.pos_x, item.pos_y - 48.0, 28.0, 0.0, 12.0); }
        }
        for item in ctx.db.barrel().chunk_index().filter(*chunk) {
            if item.health <= 0.0 { continue; }
            let (radius, offset, height) = if item.variant == crate::barrel::BUOY_VARIANT { (32.0, 110.0, 60.0) }
                else if item.variant == 4 { (64.0, 96.0, 95.0) } else { (32.0, 48.0, 52.0) };
            circle!("barrel", item.id, item.pos_x, item.pos_y - offset, radius, 0.0, height);
        }
        for item in ctx.db.player_corpse().chunk_index().filter(*chunk) {
            if item.health != 0 { circle!("corpse", item.id, item.pos_x, item.pos_y - CORPSE_COLLISION_Y_OFFSET, 25.0, 0.0, 20.0); }
        }
        for item in ctx.db.rain_collector().chunk_index().filter(*chunk) {
            if !item.is_destroyed {
                if item.is_monument && crate::environment::is_position_in_central_compound(item.pos_x,item.pos_y) {
                    let b=crate::collision_geometry::alk_building_bounds("water",item.pos_x,item.pos_y).unwrap();
                    add(FlightHit::Entity("collector",item.id as u64),alk_box_impact(start,end,b));
                } else {circle!("collector", item.id, item.pos_x, item.pos_y - RAIN_COLLECTOR_COLLISION_Y_OFFSET, 35.0, 0.0, 75.0);}
            }
        }
        for item in ctx.db.furnace().chunk_index().filter(*chunk) {
            if !item.is_destroyed {
                if item.is_monument && item.furnace_type==1 && crate::environment::is_position_in_central_compound(item.pos_x,item.pos_y) {
                    let b=crate::collision_geometry::alk_building_bounds("furnace",item.pos_x,item.pos_y).unwrap();
                    add(FlightHit::Entity("furnace",item.id as u64),alk_box_impact(start,end,b));
                } else {circle!("furnace", item.id, item.pos_x, item.pos_y - FURNACE_COLLISION_Y_OFFSET, 40.0, 0.0, 70.0);}
            }
        }
        for item in ctx.db.lantern().chunk_index().filter(*chunk) {
            if !item.is_destroyed { circle!("lantern", item.id, item.pos_x, item.pos_y - 34.0, PROJECTILE_LANTERN_HIT_RADIUS, 0.0, 45.0); }
        }
        for item in ctx.db.homestead_hearth().chunk_index().filter(*chunk) { circle!("hearth", item.id, item.pos_x, item.pos_y - HEARTH_COLLISION_Y_OFFSET, 60.0, 0.0, 100.0); }
        for item in ctx.db.turret().chunk_index().filter(*chunk) {
            if !item.is_destroyed {
                let b=crate::collision_geometry::alk_turret_bounds(item.is_monument,item.pos_x,item.pos_y);
                circle!("turret",item.id,b.x,b.y,b.half_width,0.0,b.height);
            }
        }
        for item in ctx.db.barbecue().chunk_index().filter(*chunk) {
            if !item.is_destroyed { circle!("barbecue", item.id, item.pos_x, item.pos_y - BARBECUE_COLLISION_Y_OFFSET, BARBECUE_COLLISION_RADIUS + 8.0, 0.0, 55.0); }
        }
        for item in ctx.db.animal_corpse().chunk_index().filter(*chunk) {
            if item.health != 0 { circle!("animal_corpse", item.id, item.pos_x, item.pos_y - ANIMAL_CORPSE_COLLISION_Y_OFFSET, 20.0, 0.0, 20.0); }
        }
        for animal in ctx.db.wild_animal().chunk_index().filter(*chunk) {
            if animal.health <= 0.0 || animal.state == crate::wild_animal_npc::AnimalState::Burrowed { continue; }
            if animal.species.is_hostile_npc() {
                let (bottom, top) = animal_vertical_bounds(ctx, &animal);
                circle!("animal", animal.id, animal.pos_x, animal.pos_y, 32.0, bottom, top);
            } else {
                add(FlightHit::Entity("animal", animal.id as u64), animal_projectile_profile(&animal).impact(
                    start, end, (animal.pos_x, animal.pos_y), animal_projectile_direction(&animal),
                    ground_height_at(ctx, animal.pos_x, animal.pos_y), animal.is_flying,
                ));
            }
        }
    }
    for station in ctx.db.alk_station().iter().filter(|station| station.is_active) {
        let b=crate::collision_geometry::alk_building_bounds(if station.station_id==0 {"central"} else {"station"},station.world_pos_x,station.world_pos_y).unwrap();
        add(FlightHit::World,alk_box_impact(start,end,b));
    }
    let (cx,cy)=crate::compound_buildings::get_world_center();
    for landmark in &crate::collision_geometry::COLLISION_GEOMETRY.alk.landmarks {
        let b=crate::collision_geometry::alk_building_bounds(&landmark.asset,cx+landmark.offset_x,cy+landmark.offset_y).unwrap();
        add(FlightHit::World,alk_box_impact(start,end,b));
    }
    for player in ctx.db.player().iter() {
        if player.identity == projectile.owner_id || player.is_dead { continue; }
        let (bottom, top) = player_vertical_bounds(ctx, &player, ctx.timestamp);
        add(FlightHit::Player(player.identity), cylinder_impact(start, end, (player.position_x, player.position_y), PROJECTILE_PLAYER_HIT_RADIUS, bottom, top));
    }
    // Enclosed foundation clusters render a roof at this height. Only run
    // enclosure analysis when the shot actually crosses the roof plane.
    const ROOF_HEIGHT: f32 = 100.8;
    if (start.height > ROOF_HEIGHT && end.height <= ROOF_HEIGHT) || (start.height < ROOF_HEIGHT && end.height >= ROOF_HEIGHT) {
        let t = (ROOF_HEIGHT - start.height) / (end.height - start.height);
        let x = start.x + (end.x - start.x) * t;
        let y = start.y + (end.y - start.y) * t;
        if ground_height_at(ctx, x, y) > 0.0 && crate::building_enclosure::is_position_inside_building(ctx, x, y) {
            add(FlightHit::World, Some(t));
        }
    }
    if start.height > 7.68 && end.height <= 7.68 {
        let t = (start.height - 7.68) / (start.height - end.height);
        let x = start.x + (end.x - start.x) * t;
        let y = start.y + (end.y - start.y) * t;
        if ground_height_at(ctx, x, y) > 0.0 { add(FlightHit::Ground, Some(t)); }
    }
    if start.height > 0.0 && end.height <= 0.0 { add(FlightHit::Ground, Some(start.height / (start.height - end.height))); }
    best
}

fn alk_box_impact(start:crate::projectile_geometry::Point3,end:crate::projectile_geometry::Point3,b:crate::collision_geometry::AlkBounds) -> Option<f32> {
    use crate::projectile_geometry::{Point3,box_surface_impact};
    box_surface_impact(start,end,Point3{x:b.x-b.half_width,y:b.y-b.half_depth,height:0.0},
        Point3{x:b.x+b.half_width,y:b.y+b.half_depth,height:b.height})
}

fn selected_impact(flight_3d: bool, x: f32, y: f32, legacy: Option<(f32, f32)>) -> Option<(f32, f32)> {
    if flight_3d { Some((x, y)) } else { legacy }
}

/// Bound the error of the parabolic height approximation even when the
/// scheduler stalls. Fast projectiles still sweep each whole time slice.
fn first_flight_hit_interval(ctx: &ReducerContext, projectile: &Projectile, start_time: f32, end_time: f32,
    village_parts: &[crate::MonumentPart]) -> Option<(FlightHit, f32)> {
    use crate::projectile_geometry::Point3;
    let duration = (end_time - start_time).max(0.0);
    let steps = ((duration / 0.075).ceil() as usize).max(1);
    let at = |t: f32| Point3 {
        x: projectile.start_pos_x + projectile.velocity_x * t,
        y: projectile.start_pos_y + projectile.velocity_y * t,
        height: projectile.start_height + projectile.velocity_height * t - 0.5 * projectile.gravity_height * t * t,
    };
    for step in 0..steps {
        let from = start_time + duration * step as f32 / steps as f32;
        let to = start_time + duration * (step + 1) as f32 / steps as f32;
        let a = at(from);
        let b = at(to);
        let chunks = crate::projectile_geometry::swept_chunks((a.x, a.y), (b.x, b.y), 200.0, CHUNK_SIZE_PX, WORLD_WIDTH_CHUNKS, WORLD_HEIGHT_CHUNKS);
        if let Some((hit, t)) = first_flight_hit(ctx, projectile, a, b, &chunks, village_parts) {
            let fraction = if duration > 1e-6 { (from + (to - from) * t - start_time) / duration } else { 0.0 };
            return Some((hit, fraction.clamp(0.0, 1.0)));
        }
    }
    None
}

#[reducer]
pub fn set_throw_aim(ctx: &ReducerContext, aiming: bool) -> Result<(), String> {
    let mut player = ctx.db.player().identity().find(ctx.sender()).ok_or("Player not found")?;
    if aiming {
        if player.is_dead || player.is_knocked_out { return Err("Cannot throw while incapacitated".into()); }
        let equipment = ctx.db.active_equipment().player_identity().find(ctx.sender()).ok_or("No equipped weapon")?;
        let item = equipment.equipped_item_def_id.and_then(|id| ctx.db.item_definition().id().find(id)).ok_or("No equipped weapon")?;
        if !is_throwable_melee(&item) { return Err("Only melee weapons can be thrown".into()); }
    }
    player.is_aiming_throw = aiming;
    ctx.db.player().identity().update(player);
    Ok(())
}

#[reducer]
pub fn throw_melee_weapon(ctx: &ReducerContext, item_instance_id: u64, target_x: f32, target_y: f32, client_shot_id: String) -> Result<(), String> {
    if !target_x.is_finite() || !target_y.is_finite() { return Err("Invalid target".into()); }
    let player_id = ctx.sender();
    let player = ctx.db.player().identity().find(player_id).ok_or("Player not found")?;
    if player.is_dead || player.is_knocked_out || !player.is_aiming_throw { return Err("Player is not ready to throw".into()); }
    let equipment = ctx.db.active_equipment().player_identity().find(player_id).ok_or("No equipped weapon")?;
    if equipment.equipped_item_instance_id != Some(item_instance_id) { return Err("Equipped weapon changed".into()); }
    let mut item = ctx.db.inventory_item().instance_id().find(item_instance_id).ok_or("Weapon not found")?;
    let owned = match &item.location {
        crate::models::ItemLocation::Inventory(data) => data.owner_id == player_id,
        crate::models::ItemLocation::Hotbar(data) => data.owner_id == player_id,
        _ => false,
    };
    if !owned || item.quantity == 0 { return Err("Weapon is not in your inventory".into()); }
    let def = ctx.db.item_definition().id().find(item.item_def_id).ok_or("Weapon definition not found")?;
    if !is_throwable_melee(&def) || equipment.equipped_item_def_id != Some(def.id) {
        return Err("Only the equipped melee weapon can be thrown".into());
    }
    if crate::durability::has_durability_system(&def) && crate::durability::is_item_broken(&item) {
        return Err("This weapon is broken".into());
    }
    let aim = auto_aim_target(ctx, player_id, target_x, target_y, 0.0);
    let dx = aim.x - player.position_x;
    let dy = aim.y - player.position_y;
    let distance = dx.hypot(dy);
    if !distance.is_finite() || distance < 1.0 { return Err("Target too close".into()); }
    const THROW_SPEED: f32 = 650.0;
    const THROW_RANGE: f32 = 550.0;
    let (bottom, _) = player_vertical_bounds(ctx, &player, ctx.timestamp);
    let launch_height = bottom + if player.is_crouching { 52.0 } else { 68.0 };
    let trajectory = crate::projectile_geometry::Trajectory3::aim_at(
        crate::projectile_geometry::Point3 { x: player.position_x, y: player.position_y, height: launch_height },
        aim, THROW_SPEED, 300.0,
    ).ok_or("Invalid throw trajectory")?;
    let projectile = insert_projectile_with_runtime_state(ctx, Projectile {
        id: 0, client_shot_id, owner_id: player_id, item_def_id: def.id, ammo_def_id: def.id,
        source_type: PROJECTILE_SOURCE_PLAYER, npc_projectile_type: NPC_PROJECTILE_NONE,
        start_time: ctx.timestamp, start_pos_x: player.position_x, start_pos_y: player.position_y,
        velocity_x: trajectory.velocity.x, velocity_y: trajectory.velocity.y,
        max_range: distance.min(THROW_RANGE),
        flight_3d: true, start_height: trajectory.start.height, velocity_height: trajectory.velocity.height, gravity_height: trajectory.gravity,
    });
    ctx.db.thrown_projectile_item().insert(ThrownProjectileItem { projectile_id: projectile.id, item_data: item.item_data.clone() });
    if item.quantity > 1 {
        item.quantity -= 1;
        ctx.db.inventory_item().instance_id().update(item);
    } else {
        ctx.db.inventory_item().instance_id().delete(item_instance_id);
    }
    crate::active_equipment::clear_active_item_reducer(ctx, player_id)?;
    let mut player = ctx.db.player().identity().find(player_id).ok_or("Player not found")?;
    player.is_aiming_throw = false;
    ctx.db.player().identity().update(player);
    sound_events::emit_item_thrown_sound(ctx, projectile.start_pos_x, projectile.start_pos_y, player_id);
    Ok(())
}

// Scheduled table for projectile updates
#[table(accessor = projectile_update_schedule, scheduled(update_projectiles))]
#[derive(Clone, Debug)]
pub struct ProjectileUpdateSchedule {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub scheduled_at: ScheduleAt,
}

#[table(accessor = arrow_break_event, public)]
#[derive(Clone, Debug)]
pub struct ArrowBreakEvent {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub pos_x: f32,
    pub pos_y: f32,
    pub timestamp: Timestamp,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, SpacetimeType)]
pub enum ProjectileResolvedReason {
    Impact,
    RangeExpired,
    Broken,
    Dissipated,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, SpacetimeType)]
pub enum ProjectileResolvedTargetKind {
    None,
    World,
    Structure,
    Deployable,
    Animal,
    Player,
    Corpse,
}

#[table(accessor = projectile_resolved_event, public)]
#[derive(Clone, Debug)]
pub struct ProjectileResolvedEvent {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub projectile_id: u64,
    pub client_shot_id: String,
    pub pos_x: f32,
    pub pos_y: f32,
    pub reason: ProjectileResolvedReason,
    pub target_kind: ProjectileResolvedTargetKind,
    pub target_id: u64,
    pub created_dropped_item: bool,
    pub timestamp: Timestamp,
}

#[derive(Clone, Debug)]
struct PendingProjectileResolution {
    projectile_id: u64,
    client_shot_id: String,
    pos_x: f32,
    pos_y: f32,
    reason: ProjectileResolvedReason,
    target_kind: ProjectileResolvedTargetKind,
    target_id: u64,
}

fn insert_projectile_with_runtime_state(ctx: &ReducerContext, projectile: Projectile) -> Projectile {
    let inserted = ctx.db.projectile().insert(projectile);
    ctx.db.projectile_runtime_state().insert(ProjectileRuntimeState {
        projectile_id: inserted.id,
        last_sample_elapsed_secs: 0.0,
    });
    inserted
}

fn queue_projectile_resolution(
    resolutions: &mut Vec<PendingProjectileResolution>,
    projectile: &Projectile,
    pos_x: f32,
    pos_y: f32,
    reason: ProjectileResolvedReason,
    target_kind: ProjectileResolvedTargetKind,
    target_id: u64,
) {
    resolutions.push(PendingProjectileResolution {
        projectile_id: projectile.id,
        client_shot_id: projectile.client_shot_id.clone(),
        pos_x,
        pos_y,
        reason,
        target_kind,
        target_id,
    });
}

/// Create a projectile fired by an NPC (hostile apparitions, vipers, etc.)
/// This is called from NPC behavior code when they counter-attack ranged players
pub fn fire_npc_projectile(
    ctx: &ReducerContext,
    npc_id: u64,
    npc_pos_x: f32,
    npc_pos_y: f32,
    target_player_x: f32,
    target_player_y: f32,
    projectile_type: u8,
    damage: f32,
    speed: f32,
    max_range: f32,
) -> Result<u64, String> {
    // Calculate direction to target
    let dx = target_player_x - npc_pos_x;
    let dy = target_player_y - npc_pos_y;
    let distance = (dx * dx + dy * dy).sqrt();
    
    if distance < 1.0 {
        return Err("Target too close to fire projectile".to_string());
    }
    
    // Normalize direction
    let norm_x = dx / distance;
    let norm_y = dy / distance;
    
    // SPAWN OFFSET: Start projectile 48 pixels in front of the NPC (outside collision range)
    // This prevents projectiles from spawning inside or behind the player when NPC is close
    const NPC_PROJECTILE_SPAWN_OFFSET: f32 = 48.0;
    let spawn_x = npc_pos_x + norm_x * NPC_PROJECTILE_SPAWN_OFFSET;
    let spawn_y = npc_pos_y + norm_y * NPC_PROJECTILE_SPAWN_OFFSET;
    
    // Apply speed to normalized direction
    let velocity_x = norm_x * speed;
    let velocity_y = norm_y * speed;
    
    // Adjust max_range to account for spawn offset
    let adjusted_max_range = (max_range - NPC_PROJECTILE_SPAWN_OFFSET).max(100.0);
    
    // Use a dummy item_def_id (0) since NPC projectiles don't use items
    // The damage is determined by projectile_type, not weapon definitions
    let projectile = Projectile {
        id: 0, // auto_inc
        client_shot_id: String::new(),
        owner_id: ctx.identity(), // Module identity for NPC projectiles
        item_def_id: npc_id, // Store NPC ID for tracking (not an actual item)
        ammo_def_id: (damage * 100.0) as u64, // Encode damage * 100 for retrieval (e.g., 8.0 -> 800)
        source_type: PROJECTILE_SOURCE_NPC,
        npc_projectile_type: projectile_type,
        start_time: ctx.timestamp,
        start_pos_x: spawn_x,
        start_pos_y: spawn_y,
        velocity_x,
        velocity_y,
        max_range: adjusted_max_range,
        flight_3d: false, start_height: 0.0, velocity_height: 0.0, gravity_height: 0.0,
    };
    
    let inserted = insert_projectile_with_runtime_state(ctx, projectile);
    log::info!("[NPC Projectile] NPC {} fired type {} projectile from ({:.1}, {:.1}) toward ({:.1}, {:.1}) with speed {:.1}", 
              npc_id, projectile_type, spawn_x, spawn_y, target_player_x, target_player_y, speed);
    
    Ok(inserted.id)
}

/// Get the damage amount from an NPC projectile's encoded ammo_def_id
pub fn get_npc_projectile_damage(projectile: &Projectile) -> f32 {
    if projectile.source_type == PROJECTILE_SOURCE_NPC {
        // Damage is encoded as ammo_def_id * 100
        (projectile.ammo_def_id as f32) / 100.0
    } else {
        0.0
    }
}

#[reducer]
pub fn init_projectile_system(ctx: &ReducerContext) -> Result<(), String> {
    // Only schedule if not already scheduled
    let schedule_table = ctx.db.projectile_update_schedule();
    if schedule_table.iter().count() == 0 {
        // Schedule projectile collision detection every 75ms (13.3 tx/sec)
        // 75ms balances performance with combat feel; segment length matches tick to avoid tunneling
        let update_interval = TimeDuration::from_micros(75_000); // 75ms = 0.075 seconds
        crate::try_insert_schedule!(
            schedule_table,
            ProjectileUpdateSchedule {
                id: 0,
                scheduled_at: ScheduleAt::Interval(update_interval),
            },
            "Projectile collision detection"
        );
    }
    Ok(())
}

#[reducer]
pub fn fire_projectile(
    ctx: &ReducerContext, 
    target_world_x: f32, 
    target_world_y: f32,
    client_player_x: f32,  // Client's predicted position
    client_player_y: f32,
    client_shot_id: String,
) -> Result<(), String> {
    let player_id = ctx.sender();

    if !target_world_x.is_finite() || !target_world_y.is_finite()
        || !client_player_x.is_finite() || !client_player_y.is_finite() {
        return Err("Projectile coordinates must be finite".to_string());
    }
    
    // Find the player
    let player = ctx.db.player().identity().find(&player_id)
        .ok_or("Player not found")?;
    
    if player.is_dead {
        return Err("Dead players cannot fire projectiles".to_string());
    }
    
    // CLIENT-AUTHORITATIVE PROJECTILE SPAWNING for PvP responsiveness
    // Always trust client position for projectile spawn - this ensures bullets spawn from where
    // the player sees themselves, not where the laggy server thinks they are.
    // 
    // Only validate against impossible positions (teleporting) - use same tolerance as movement system
    // Movement system uses BASE_MAX_MOVEMENT_SPEED * 6.0 = 4800 px/s buffer for client prediction
    // With 200ms latency: 4800 * 0.2 = 960 pixels maximum reasonable desync
    // Dodge rolls can move 450 pixels instantly, so we need generous tolerance
    const MAX_POSITION_DESYNC: f32 = 2000.0; // Very generous - only catches actual teleporting
    const MAX_POSITION_DESYNC_SQ: f32 = MAX_POSITION_DESYNC * MAX_POSITION_DESYNC;
    
    let dx = client_player_x - player.position_x;
    let dy = client_player_y - player.position_y;
    let desync_sq = dx * dx + dy * dy;
    
    // CLIENT-AUTHORITATIVE: Always use client position unless it's clearly impossible
    // This matches the movement system's client-authoritative approach and ensures
    // bullets spawn accurately during sprinting, dodge rolling, and high-latency situations
    let (spawn_x, spawn_y) = if desync_sq <= MAX_POSITION_DESYNC_SQ {
        (client_player_x, client_player_y)
    } else {
        // Only reject if position is impossibly far (likely cheating/teleporting)
        log::warn!("Player {:?} fire_projectile position desync suspiciously large ({:.1} units), rejecting shot", 
            player_id, desync_sq.sqrt());
        return Err(format!("Position validation failed: desync too large ({:.1} units)", desync_sq.sqrt()));
    };

    // Get the equipped item and its definition
    let mut equipment = ctx.db.active_equipment().player_identity().find(&player_id)
        .ok_or("No active equipment record found for player.")?;
    
    let equipped_item_def_id = equipment.equipped_item_def_id
        .ok_or("No item definition ID in active equipment.")?;
    
    let item_def = ctx.db.item_definition().id().find(equipped_item_def_id)
        .ok_or("Equipped item definition not found.")?;

    // --- Check if it's a Ranged Weapon and if it's ready to fire ---
    if item_def.category != crate::items::ItemCategory::RangedWeapon {
        return Err("Equipped item is not a ranged weapon.".to_string());
    }
    
    // Get the equipped item instance for durability check
    let equipped_item_instance_id = equipment.equipped_item_instance_id
        .ok_or("No item instance ID in active equipment.")?;
    let equipped_item = ctx.db.inventory_item().instance_id().find(equipped_item_instance_id)
        .ok_or("Equipped item instance not found.")?;
    
    // --- Check if weapon is broken (durability depleted) ---
    if crate::durability::has_durability_system(&item_def) && crate::durability::is_item_broken(&equipped_item) {
        log::warn!("[FireProjectile] Player {:?} tried to fire broken weapon {} (Instance: {})", 
            player_id, item_def.name, equipped_item_instance_id);
        return Err("This weapon is broken and cannot be used.".to_string());
    }

    if !equipment.is_ready_to_fire {
        return Err("Weapon is not loaded. Right-click to load ammunition.".to_string());
    }

    let loaded_ammo_def_id = equipment.loaded_ammo_def_id
        .ok_or("Weapon is not loaded correctly (missing ammo def ID).")?;

    // Get weapon stats for magazine capacity and fire rate
    let weapon_stats_for_magazine = ctx.db.ranged_weapon_stats().item_name().find(&item_def.name);
    let magazine_capacity = weapon_stats_for_magazine.as_ref().map(|s| s.magazine_capacity).unwrap_or(0);
    let magazine_reload_time_secs = weapon_stats_for_magazine.as_ref().map(|s| s.magazine_reload_time_secs).unwrap_or(0.0);

    // --- Check if currently reloading (reload cooldown in progress) ---
    // Prevents firing during magazine reload animation
    // This check MUST happen before fire rate check to avoid confusion
    if magazine_reload_time_secs > 0.0 && equipment.reload_start_time_ms > 0 {
        let current_time_ms = (ctx.timestamp.to_micros_since_unix_epoch() / 1000) as u64;
        let reload_time_ms = (magazine_reload_time_secs * 1000.0) as u64;
        let elapsed_ms = current_time_ms.saturating_sub(equipment.reload_start_time_ms);
        
        if elapsed_ms < reload_time_ms {
            let remaining_ms = reload_time_ms - elapsed_ms;
            return Err(format!("Still reloading... ({:.1}s remaining)", remaining_ms as f32 / 1000.0));
        }
    }

    // --- Fire Rate / Reload Cooldown Check ---
    // ALL ranged weapons now have a fire rate cooldown (reload_time_secs)
    // This prevents spam-clicking for instant fire and makes semi-auto weapons feel distinct
    // This check MUST happen before ammo consumption to avoid wasting ammo on rejected shots
    if let Some(weapon_stats) = &weapon_stats_for_magazine {
        if let Some(last_attack_record) = ctx.db.player_last_attack_timestamp().player_id().find(&player_id) {
            let time_since_last_attack = ctx.timestamp.to_micros_since_unix_epoch() - last_attack_record.last_attack_timestamp.to_micros_since_unix_epoch();
            let required_reload_time_micros = (weapon_stats.reload_time_secs * 1_000_000.0) as i64;
            
            if time_since_last_attack < required_reload_time_micros {
                return Err("Weapon is still cooling down".to_string());
            }
        }
    }

    // --- Consume Ammunition based on weapon type ---
    if magazine_capacity > 0 {
        // Magazine-based weapon (e.g., pistol) - ammo already consumed during load
        // Just decrement the loaded count
        if equipment.loaded_ammo_count == 0 {
            equipment.is_ready_to_fire = false;
            equipment.loaded_ammo_def_id = None;
            ctx.db.active_equipment().player_identity().update(equipment);
            return Err("Magazine is empty. Press R to reload.".to_string());
        }
        
        // Decrement loaded ammo count
        equipment.loaded_ammo_count -= 1;
        
        // Only set is_ready_to_fire = false when magazine is empty
        if equipment.loaded_ammo_count == 0 {
            equipment.is_ready_to_fire = false;
            equipment.loaded_ammo_def_id = None;
        }
        
        // Update swing_start_time_ms for weapon cooldown tracking (fire rate)
        equipment.swing_start_time_ms = (ctx.timestamp.to_micros_since_unix_epoch() / 1000) as u64;
        ctx.db.active_equipment().player_identity().update(equipment.clone());
        
        log::info!("[FireProjectile] Player {:?} fired {} (magazine: {}/{}).", 
            player_id, item_def.name, equipment.loaded_ammo_count, magazine_capacity);
    } else {
        // Single-shot weapon (bow, crossbow) - consume ammo from inventory on fire
        let inventory_items_table = ctx.db.inventory_item();
        
        log::info!("[FireProjectile] Player {:?} firing with loaded_ammo_def_id={}", player_id, loaded_ammo_def_id);
        
        let mut ammo_item_instance_id_to_consume: Option<u64> = None;
        let mut matching_items_found = 0;
        let mut items_in_wrong_location = 0;

        for item_instance in inventory_items_table.iter() {
            if item_instance.item_def_id == loaded_ammo_def_id && item_instance.quantity > 0 {
                matching_items_found += 1;
                let is_player_owned = match &item_instance.location {
                    crate::models::ItemLocation::Inventory(data) => data.owner_id == player_id,
                    crate::models::ItemLocation::Hotbar(data) => data.owner_id == player_id,
                    _ => false,
                };
                
                if is_player_owned {
                    ammo_item_instance_id_to_consume = Some(item_instance.instance_id);
                    log::debug!("Found ammunition for player {:?}: instance_id={}, quantity={}, location={:?}", 
                        player_id, item_instance.instance_id, item_instance.quantity, item_instance.location);
                    break;
                } else {
                    items_in_wrong_location += 1;
                }
            }
        }

        if let Some(instance_id) = ammo_item_instance_id_to_consume {
            if let Some(mut item_to_update) = inventory_items_table.instance_id().find(instance_id) {
                if item_to_update.quantity > 1 {
                    item_to_update.quantity -= 1;
                    let remaining_quantity = item_to_update.quantity;
                    inventory_items_table.instance_id().update(item_to_update);
                    log::info!("Player {:?} consumed 1 ammunition (def_id: {}). {} remaining.", 
                        player_id, loaded_ammo_def_id, remaining_quantity);
                } else {
                    inventory_items_table.instance_id().delete(instance_id);
                    log::info!("Player {:?} consumed last ammunition (def_id: {}). Item instance deleted.", 
                        player_id, loaded_ammo_def_id);
                }
            } else {
                equipment.is_ready_to_fire = false;
                equipment.loaded_ammo_def_id = None;
                equipment.loaded_ammo_count = 0;
                ctx.db.active_equipment().player_identity().update(equipment);
                return Err("No loaded ammunition found in inventory to consume (item disappeared). Weapon unloaded.".to_string());
            }
        } else {
            let error_msg = if matching_items_found > 0 {
                format!("No loaded ammunition found in inventory to consume (found {} matching item(s) but {} in wrong location). Weapon unloaded.", 
                    matching_items_found, items_in_wrong_location)
            } else {
                format!("No loaded ammunition found in inventory to consume (def_id: {}). Weapon unloaded.", loaded_ammo_def_id)
            };
            
            log::warn!("Player {:?} tried to fire but ammunition not found. Matching items: {}, Wrong location: {}", 
                player_id, matching_items_found, items_in_wrong_location);
            
            equipment.is_ready_to_fire = false;
            equipment.loaded_ammo_def_id = None;
            equipment.loaded_ammo_count = 0;
            ctx.db.active_equipment().player_identity().update(equipment);
            return Err(error_msg);
        }

        // Single-shot weapon - unload after firing (requires right-click to reload)
        // Same behavior for bow and crossbow - manual reload required
        equipment.is_ready_to_fire = false;
        equipment.loaded_ammo_def_id = None;
        equipment.loaded_ammo_count = 0;
        equipment.swing_start_time_ms = (ctx.timestamp.to_micros_since_unix_epoch() / 1000) as u64;
        ctx.db.active_equipment().player_identity().update(equipment.clone());
    }
 
    let weapon_stats = ctx.db.ranged_weapon_stats().item_name().find(&item_def.name)
        .ok_or(format!("Ranged weapon stats not found for: {}", item_def.name))?;

    // Get ammunition item definition for special projectile properties
    let ammo_item_def = ctx.db.item_definition().id().find(loaded_ammo_def_id)
        .ok_or("Loaded ammunition definition not found.")?;

    // NOTE: Fire rate / reload cooldown check is now done at the top of this function
    // BEFORE ammo consumption to avoid wasting ammo on rejected shots.
    // Magazine-based weapons (like Reed Harpoon Gun) fire instantly when loaded.

    // --- NEW: Check shelter protection rule for ranged attacks ---
    // Players inside their own shelter cannot fire projectiles outside
    // Use spawn position (client-predicted with validation) for consistency
    if let Some(shelter_id) = shelter::is_owner_inside_shelter(ctx, player_id, spawn_x, spawn_y) {
        // Check if target is outside the shelter
        if !shelter::is_player_inside_shelter(target_world_x, target_world_y, &ctx.db.shelter().id().find(shelter_id).unwrap()) {
            return Err("Cannot fire from inside your shelter to targets outside. Leave your shelter to attack.".to_string());
        }
        log::debug!("Player {:?} firing from inside their shelter {} to target inside same shelter - allowed", player_id, shelter_id);
    }

    // Legacy grenade and flare checks remain until those thrown consumables
    // move to the 3D flight system. Physical shots hit nearby cover instead.
    if item_def.name == "Grenade" || item_def.name == "Flare" {
    // These checks only reject cover within 80 pixels; avoid scanning the
    // entire cursor distance for each structure on a long-range shot.
    let proximity_dx = target_world_x - spawn_x;
    let proximity_dy = target_world_y - spawn_y;
    let proximity_distance = proximity_dx.hypot(proximity_dy);
    let proximity_scale = if proximity_distance > 80.0 { 80.0 / proximity_distance } else { 1.0 };
    let proximity_x = spawn_x + proximity_dx * proximity_scale;
    let proximity_y = spawn_y + proximity_dy * proximity_scale;

    // --- Check if projectile path would immediately hit a wall very close to player ---
    if let Some((wall_id, collision_x, collision_y)) = crate::building::check_projectile_wall_collision(
        ctx,
        spawn_x,
        spawn_y,
        proximity_x,
        proximity_y,
    ) {
        let collision_distance = ((collision_x - spawn_x).powi(2) + (collision_y - spawn_y).powi(2)).sqrt();
        const MIN_FIRING_DISTANCE: f32 = 80.0; // About 2 tiles
        
        if collision_distance < MIN_FIRING_DISTANCE {
            return Err(format!("Cannot fire projectile - wall too close ({:.1} units)", collision_distance));
        }
    }
    
    // --- Check if projectile path would immediately hit a closed door very close to player ---
    if let Some((door_id, collision_x, collision_y)) = crate::door::check_door_projectile_collision(ctx, spawn_x, spawn_y, proximity_x, proximity_y) {
        let collision_distance = ((collision_x - spawn_x).powi(2) + (collision_y - spawn_y).powi(2)).sqrt();
        const MIN_FIRING_DISTANCE: f32 = 80.0;
        
        if collision_distance < MIN_FIRING_DISTANCE {
            return Err(format!("Cannot fire projectile - closed door too close ({:.1} units)", collision_distance));
        }
    }
    
    // --- Check if projectile path would immediately hit a fence very close to player ---
    if let Some((fence_id, collision_x, collision_y)) = crate::fence::check_projectile_fence_collision(ctx, spawn_x, spawn_y, proximity_x, proximity_y) {
        let collision_distance = ((collision_x - spawn_x).powi(2) + (collision_y - spawn_y).powi(2)).sqrt();
        const MIN_FIRING_DISTANCE: f32 = 80.0;
        
        if collision_distance < MIN_FIRING_DISTANCE {
            return Err(format!("Cannot fire projectile - fence too close ({:.1} units)", collision_distance));
        }
    }
    
    // --- Check if projectile path would immediately hit a shelter wall very close to player ---
    if let Some((shelter_id, collision_x, collision_y)) = shelter::check_projectile_shelter_collision(
        ctx,
        spawn_x,
        spawn_y,
        proximity_x,
        proximity_y,
    ) {
        // Only block the shot if the collision happens very close to the player
        // This allows intentional targeting of shelters while preventing immediate wall hits
        let collision_distance = ((collision_x - spawn_x).powi(2) + (collision_y - spawn_y).powi(2)).sqrt();
        const MIN_FIRING_DISTANCE: f32 = 80.0; // About 2 tiles
        
        if collision_distance < MIN_FIRING_DISTANCE {
            return Err(format!("Cannot fire projectile - shelter wall too close ({:.1} units)", collision_distance));
        }
        
        // If collision is far enough away, allow the shot (player is intentionally targeting the shelter)
        log::info!("Player {:?} targeting shelter {} at distance {:.1} - shot allowed", player_id, shelter_id, collision_distance);
    }
    }

    // --- Physics Calculation for Initial Velocity to Hit Target ---
    // Use spawn position (client-predicted with anti-cheat validation)
    let uses_3d = item_def.name != "Grenade" && item_def.name != "Flare";
    let (bottom, _) = player_vertical_bounds(ctx, &player, ctx.timestamp);
    let launch_height = bottom + if player.is_crouching { 36.0 } else { 50.0 };
    let aim = if uses_3d { auto_aim_target(ctx, player_id, target_world_x, target_world_y, launch_height) }
        else { crate::projectile_geometry::Point3 { x: target_world_x, y: target_world_y, height: 0.0 } };
    let delta_x = aim.x - spawn_x;
    let delta_y = aim.y - spawn_y;
    
    // Apply ammunition-specific speed modifications
    let mut v0 = weapon_stats.projectile_speed;
    let mut max_range = weapon_stats.weapon_range;
    
    // Hollow Reed Arrows: +25% speed (lighter, more aerodynamic)
    // Applies to both bows and crossbows - only the physics differ, not ammo compatibility
    if ammo_item_def.name == "Hollow Reed Arrow" {
        v0 *= 1.25; // 25% faster
        log::debug!("Hollow Reed Arrow: Enhanced speed ({:.1}) for weapon '{}'", v0, item_def.name);
    }
    
    let g = GRAVITY; // GRAVITY const defined at the top of the file
    
    let distance_sq = delta_x * delta_x + delta_y * delta_y;
    if !distance_sq.is_finite() || distance_sq < 1.0 || !v0.is_finite() || v0 <= 0.0 {
        return Err("Invalid projectile target or speed".to_string());
    }

    let final_vx: f32;
    let final_vy: f32;

    // Crossbow and Hunting Bow now share straight-line projectile physics.
    // Hunting Bow keeps its shorter range via weapon stats/max_range, not extra gravity arc.
    if uses_3d {
        let distance = distance_sq.sqrt();
        final_vx = delta_x / distance * v0;
        final_vy = delta_y / distance * v0;
    } else if item_def.name == "Crossbow" || item_def.name == "Hunting Bow" || item_def.name == "Grenade" || item_def.name == "Flare" {
        let distance = distance_sq.sqrt();
        let time_to_target = distance / v0;
        
        // Direct line calculation - no gravity
        final_vx = delta_x / time_to_target;
        final_vy = delta_y / time_to_target;
        
        log::info!("{} fired: straight-line trajectory. Distance: {:.1}, Time: {:.3}s", item_def.name, distance, time_to_target);
    } else if item_def.name == "Makarov PM" || item_def.name == "PP-91 KEDR" {
        // Firearms use fast arc physics - very fast projectile with reduced gravity (0.15 multiplier)
        let firearm_gravity = g * PROJECTILE_FIREARM_GRAVITY_MULTIPLIER;
        let distance = distance_sq.sqrt();
        
        // For firearms, use simplified arc calculation with reduced gravity
        // This creates a very fast, nearly-straight trajectory with slight drop
        let time_to_target = distance / v0;
        
        // Calculate velocity with pre-compensation for reduced gravity drop
        final_vx = delta_x / time_to_target;
        // Compensate for the small amount of gravity that will be applied during flight
        final_vy = (delta_y / time_to_target) - 0.5 * firearm_gravity * time_to_target;
        
        log::info!("{} fired: fast-arc trajectory. Distance: {:.1}, Time: {:.3}s, Gravity: {:.1}", 
            item_def.name, distance, time_to_target, firearm_gravity);
    } else {
        // Existing bow physics with full gravity arc
        if delta_x.abs() < 1e-6 { // Target is (almost) vertically aligned
            final_vx = 0.0;
            if delta_y == 0.0 { // Target is at player's exact location (already handled by distance_sq < 1.0)
                 return Err("Target is at player position".to_string());
            }
            // Time to fall/rise delta_y: delta_y = v0y*T + 0.5*g*T^2
            // If shooting straight up/down, v0x = 0, so |v0y| = v0
            let discriminant_vertical = v0.powi(2) + 2.0 * g * delta_y; // For T = (v0y +/- sqrt(v0y^2 + 2g*delta_y))/g , if v0y is +/- v0
                                                                     // Simplified: check if target is reachable vertically
            if delta_y > 0.0 { // Target below
                final_vy = v0; // Shoot straight down
                // Check if it can even reach if v0 is too small against gravity for upward component
                // For purely downward, it will always reach if T > 0.
                // T = (-v0 + sqrt(v0^2 + 2g*delta_y))/g
                if v0.powi(2) + 2.0 * g * delta_y < 0.0 { // Should not happen for delta_y > 0
                     return Err("Error in vertical aiming (down)".to_string());
                }

            } else { // Target above (delta_y < 0)
                if discriminant_vertical < 0.0 {
                    return Err("Target vertically unreachable (too high or gravity too strong)".to_string());
                }
                final_vy = -v0; // Shoot straight up
            }
        } else {
            // Quadratic equation for T^2: A_z * (T^2)^2 + B_z * T^2 + C_z = 0
            // A_z = 0.25 * g^2
            // B_z = -(v0^2 + g * delta_y)
            // C_z = delta_x^2 + delta_y^2
            let a_z = 0.25 * g * g;
            let b_z = -(v0.powi(2) + g * delta_y);
            let c_z = distance_sq;

            let discriminant_t_sq = b_z.powi(2) - 4.0 * a_z * c_z;

            if discriminant_t_sq < 0.0 {
                return Err(format!("Target is unreachable with current weapon arc (discriminant: {:.2})", discriminant_t_sq));
            }

            let sqrt_discriminant_t_sq = discriminant_t_sq.sqrt();
            
            // Two potential solutions for T^2
            let t_sq1 = (-b_z + sqrt_discriminant_t_sq) / (2.0 * a_z);
            let t_sq2 = (-b_z - sqrt_discriminant_t_sq) / (2.0 * a_z);

            let mut chosen_t_sq = -1.0;

            // Prefer the smaller positive T^2 (shorter time of flight, usually lower arc)
            if t_sq2 > 1e-6 {
                chosen_t_sq = t_sq2;
            } else if t_sq1 > 1e-6 {
                chosen_t_sq = t_sq1;
            }

            if chosen_t_sq < 1e-6 { // Ensure chosen_t_sq is positive and not extremely small
                return Err(format!("Target is unreachable (no positive time of flight, T^2: {:.2})", chosen_t_sq));
            }
            
            let t = chosen_t_sq.sqrt();
            if t < 1e-3 { // Avoid division by very small T
                 return Err("Target too close for stable arc calculation".to_string());
            }

            final_vx = delta_x / t;
            final_vy = (delta_y / t) - 0.5 * g * t;
            
            // Sanity check: ensure calculated speed is close to v0
            let calculated_speed_sq = final_vx.powi(2) + final_vy.powi(2);
            if (calculated_speed_sq - v0.powi(2)).abs() > 1.0 { // Allow some tolerance
                // This might indicate an issue if chosen_t_sq was at limits or g=0 etc.
                // but with g being non-zero and checks on T, this should hold.
                log::warn!(
                    "Calculated speed ({:.2}) differs from v0 ({:.2}). dx:{:.1},dy:{:.1},T:{:.2},vX:{:.1},vY:{:.1}",
                    calculated_speed_sq.sqrt(), v0, delta_x, delta_y, t, final_vx, final_vy
                );
                // Optionally, could return an error here if strict speed adherence is critical
                // return Err("Physics calculation resulted in inconsistent speed.".to_string());
            }
        }
    }
    // --- End Physics Calculation ---


    // Create projectile using validated spawn position
    let gravity_height = if item_def.name == "Makarov PM" || item_def.name == "PP-91 KEDR" { 0.0 } else { 240.0 };
    let vertical_velocity = if uses_3d {
        let travel_time = distance_sq.sqrt() / v0;
        (aim.height - launch_height) / travel_time + 0.5 * gravity_height * travel_time
    } else { 0.0 };
    let projectile = Projectile {
        id: 0, // auto_inc
        client_shot_id,
        owner_id: player_id,
        item_def_id: equipped_item_def_id,
        ammo_def_id: loaded_ammo_def_id,
        source_type: PROJECTILE_SOURCE_PLAYER, // Player weapon
        npc_projectile_type: NPC_PROJECTILE_NONE, // Not an NPC projectile
        start_time: ctx.timestamp,
        start_pos_x: spawn_x,  // Use client-predicted position (with anti-cheat)
        start_pos_y: spawn_y,
        velocity_x: final_vx, // Use calculated velocity
        velocity_y: final_vy, // Use calculated velocity
        max_range: max_range, // Use modified max_range for ammunition-specific flight limit
        flight_3d: uses_3d, start_height: launch_height, velocity_height: vertical_velocity, gravity_height: if uses_3d { gravity_height } else { 0.0 },
    };

    insert_projectile_with_runtime_state(ctx, projectile);

    // Play weapon-specific shooting sound at spawn position
    if item_def.name == "Crossbow" {
        sound_events::emit_shoot_crossbow_sound(ctx, spawn_x, spawn_y, player_id);
    } else if item_def.name == "Hunting Bow" {
        sound_events::emit_shoot_bow_sound(ctx, spawn_x, spawn_y, player_id);
    } else if item_def.name == "Makarov PM" || item_def.name == "PP-91 KEDR" {
        sound_events::emit_shoot_pistol_sound(ctx, spawn_x, spawn_y, player_id);
    } else if item_def.name == "Reed Harpoon Gun" {
        // Use crossbow sound as placeholder for harpoon gun (mechanical projectile)
        sound_events::emit_shoot_crossbow_sound(ctx, spawn_x, spawn_y, player_id);
    } else if item_def.name == "Grenade" || item_def.name == "Flare" {
        sound_events::emit_item_thrown_sound(ctx, spawn_x, spawn_y, player_id);
    }

    // Update last attack timestamp
    let timestamp_record = PlayerLastAttackTimestamp {
        player_id,
        last_attack_timestamp: ctx.timestamp,
    };
    
    if ctx.db.player_last_attack_timestamp().player_id().find(&player_id).is_some() {
        ctx.db.player_last_attack_timestamp().player_id().update(timestamp_record);
    } else {
        ctx.db.player_last_attack_timestamp().insert(timestamp_record);
    }
    
    // --- Reduce durability on the ranged weapon after successful fire ---
    if crate::durability::has_durability_system(&item_def) {
        match crate::durability::reduce_durability_on_hit(ctx, equipped_item_instance_id) {
            Ok(item_broke) => {
                if item_broke {
                    log::info!("[Projectile] Player {:?}'s {} broke after firing!", player_id, item_def.name);
                }
            }
            Err(e) => {
                log::error!("[Projectile] Failed to reduce durability for weapon {}: {}", equipped_item_instance_id, e);
            }
        }
    }

    log::info!("Projectile fired from player {} towards ({:.1}, {:.1}) with initial V_x={:.1}, V_y={:.1}", 
        player_id.to_string(), target_world_x, target_world_y, final_vx, final_vy);
    Ok(())
}

// --- BEGIN NEW HELPER FUNCTION ---
fn apply_projectile_bleed_effect(
    ctx: &ReducerContext,
    target_player_id: Identity,
    ammo_item_def: &crate::items::ItemDefinition, // Pass the ammo definition
    _current_time: Timestamp,
) -> Result<(), String> {
    // Fire arrows should NOT cause bleed effects - they only cause burn effects
    if ammo_item_def.name == "Fire Arrow" {
        log::debug!("Fire Arrow does not cause bleed effects - skipping bleed application");
        return Ok(());
    }
    
    // Venom arrows/darts should NOT cause bleed effects - they apply venom instead
    if ammo_item_def.name == "Venom Arrow" || ammo_item_def.name == "Venom Harpoon Dart" {
        log::debug!("{} does not cause bleed effects - applies venom instead", ammo_item_def.name);
        return Ok(());
    }

    // <<< CHECK BLEED IMMUNITY FROM ARMOR >>>
    if crate::armor::has_armor_immunity(ctx, target_player_id, crate::models::ImmunityType::Bleed) {
        log::info!("Player {:?} is immune to bleed effects (armor immunity) from ammo '{}'", target_player_id, ammo_item_def.name);
        return Ok(());
    }
    // <<< END BLEED IMMUNITY CHECK >>>
    
    if let (Some(bleed_damage_per_tick), Some(bleed_duration_seconds), Some(bleed_tick_interval_seconds)) = (
        ammo_item_def.bleed_damage_per_tick,
        ammo_item_def.bleed_duration_seconds,
        ammo_item_def.bleed_tick_interval_seconds,
    ) {
        if bleed_duration_seconds <= 0.0 || bleed_tick_interval_seconds <= 0.0 {
            log::warn!("Projectile bleed for ammo '{}' has non-positive duration or interval. Skipping.", ammo_item_def.name);
            return Ok(());
        }

        let total_ticks = (bleed_duration_seconds / bleed_tick_interval_seconds).ceil();
        let total_bleed_damage = bleed_damage_per_tick * total_ticks;

        // Use centralized apply_bleeding_effect function which respects MAX_BLEED_STACKS
        active_effects::apply_bleeding_effect(
            ctx,
            target_player_id,
            total_bleed_damage,
            bleed_duration_seconds,
            bleed_tick_interval_seconds,
        )?;
        
        log::info!(
            "Applied Bleed effect on player {:?} from ammo '{}': {:.1} total damage over {:.1}s (tick every {:.1}s)",
            target_player_id,
            ammo_item_def.name,
            total_bleed_damage,
            bleed_duration_seconds,
            bleed_tick_interval_seconds
        );
        Ok(())
    } else {
        log::debug!(
            "Ammo '{}' does not have complete bleed parameters defined. No bleed applied.",
            ammo_item_def.name
        );
        Ok(())
    }
}

// --- NEW HELPER FUNCTION FOR FIRE ARROW BURN EFFECTS ---
fn apply_projectile_burn_effect(
    ctx: &ReducerContext,
    target_player_id: Identity,
    ammo_item_def: &crate::items::ItemDefinition,
    current_time: Timestamp,
) -> Result<(), String> {
    // Only apply burn effects to fire arrows
    if ammo_item_def.name != "Fire Arrow" {
        return Ok(());
    }

    // Check if the target player is wet - wet players are immune to fire arrow burns
    if crate::active_effects::player_has_wet_effect(ctx, target_player_id) {
        log::info!(
            "Fire Arrow hit wet player {:?} - burn effect blocked by wet status",
            target_player_id
        );
        return Ok(());
    }

    // Apply burn effect similar to stepping on a campfire (3 seconds, 5 damage total)
    const FIRE_ARROW_BURN_DAMAGE: f32 = 5.0; // Same as campfire
    const FIRE_ARROW_BURN_DURATION: f32 = 3.0; // 3 seconds like campfire
    const FIRE_ARROW_BURN_TICK_INTERVAL: f32 = 1.0; // Every 1 second

    match active_effects::apply_burn_effect(
        ctx,
        target_player_id,
        FIRE_ARROW_BURN_DAMAGE,
        FIRE_ARROW_BURN_DURATION,
        FIRE_ARROW_BURN_TICK_INTERVAL,
        ammo_item_def.id, // Use the fire arrow def ID as the source
    ) {
        Ok(()) => {
            log::info!(
                "Applied Fire Arrow burn effect to player {:?}: {:.1} damage over {:.1}s",
                target_player_id,
                FIRE_ARROW_BURN_DAMAGE,
                FIRE_ARROW_BURN_DURATION
            );
            Ok(())
        }
        Err(e) => {
            log::error!(
                "Failed to apply Fire Arrow burn effect to player {:?}: {}",
                target_player_id,
                e
            );
            Err(e)
        }
    }
}
// --- END NEW HELPER FUNCTION ---

// --- NEW HELPER FUNCTION FOR VENOM ARROW/DART EFFECTS ---
fn apply_projectile_venom_effect(
    ctx: &ReducerContext,
    target_player_id: Identity,
    ammo_item_def: &crate::items::ItemDefinition,
    _current_time: Timestamp,
) -> Result<(), String> {
    // Only apply venom effects to Venom Arrow and Venom Harpoon Dart
    if ammo_item_def.name != "Venom Arrow" && ammo_item_def.name != "Venom Harpoon Dart" {
        return Ok(());
    }

    // Check if player has poison resistance (from brews) - reduces venom damage
    let has_poison_resistance = crate::active_effects::player_has_poison_resistance_effect(ctx, target_player_id);
    
    // Get venom parameters from the bleed fields (we repurpose them for venom)
    let venom_damage_per_tick = ammo_item_def.bleed_damage_per_tick.unwrap_or(2.5);
    let venom_duration = ammo_item_def.bleed_duration_seconds.unwrap_or(12.0);
    let venom_tick_interval = ammo_item_def.bleed_tick_interval_seconds.unwrap_or(1.0);
    
    // Apply poison resistance reduction (50% less damage if resistant)
    let final_damage_per_tick = if has_poison_resistance {
        venom_damage_per_tick * 0.5
    } else {
        venom_damage_per_tick
    };
    
    let total_ticks = (venom_duration / venom_tick_interval).ceil();
    let total_venom_damage = final_damage_per_tick * total_ticks;
    
    // Apply venom effect using the dedicated venom function (requires anti-venom to cure)
    match active_effects::apply_venom_effect(
        ctx,
        target_player_id,
        total_venom_damage,
        venom_duration,
        venom_tick_interval,
    ) {
        Ok(()) => {
            log::info!(
                "Applied {} venom effect to player {:?}: {:.1} damage over {:.1}s{}",
                ammo_item_def.name,
                target_player_id,
                total_venom_damage,
                venom_duration,
                if has_poison_resistance { " (reduced by poison resistance)" } else { "" }
            );
            Ok(())
        }
        Err(e) => {
            log::error!(
                "Failed to apply {} venom effect to player {:?}: {}",
                ammo_item_def.name,
                target_player_id,
                e
            );
            Err(e)
        }
    }
}
// --- END VENOM EFFECT HELPER ---

// --- NEW HELPER FUNCTION FOR DAMAGE CALCULATION ---
fn calculate_projectile_damage(
    weapon_item_def: &crate::items::ItemDefinition,
    ammo_item_def: &crate::items::ItemDefinition,
    projectile: &Projectile,
    rng: &mut rand::rngs::StdRng,
) -> f32 {
    // Monument turret projectiles one-shot kill any target
    if projectile.source_type == PROJECTILE_SOURCE_MONUMENT_TURRET {
        return crate::turret::MONUMENT_TURRET_DAMAGE;
    }
    
    // Turret tallow projectiles explode on impact and deal fixed high damage
    if projectile.source_type == PROJECTILE_SOURCE_TURRET {
        return TALLOW_PROJECTILE_DAMAGE;
    }
    
    // Calculate base weapon damage
    let weapon_damage_min = weapon_item_def.pvp_damage_min.unwrap_or(0) as f32;
    let weapon_damage_max = weapon_item_def.pvp_damage_max.unwrap_or(weapon_damage_min as u32) as f32;
    let weapon_damage = if weapon_damage_min == weapon_damage_max {
        weapon_damage_min
    } else {
        rng.gen_range(weapon_damage_min..=weapon_damage_max)
    };

    // Calculate ammunition damage
    let ammo_damage_min = ammo_item_def.pvp_damage_min.unwrap_or(0) as f32;
    let ammo_damage_max = ammo_item_def.pvp_damage_max.unwrap_or(ammo_damage_min as u32) as f32;
    let ammo_damage = if ammo_damage_min == ammo_damage_max {
        ammo_damage_min
    } else {
        rng.gen_range(ammo_damage_min..=ammo_damage_max)
    };

    if ammo_item_def.name == "Fire Arrow" {
        ammo_damage
    } else if ammo_item_def.name == "Hollow Reed Arrow" {
        // Hollow Reed Arrows: Subtract ammo damage from weapon damage due to light construction
        (weapon_damage - ammo_damage).max(1.0) // Minimum 1 damage
    } else {
        weapon_damage + ammo_damage
    }
}
// --- END NEW HELPER FUNCTION ---

// --- HELPER FUNCTION FOR FIRE PATCH CREATION ---
/// Create fire patch if this is a turret tallow projectile (25% chance)
fn create_fire_patch_if_turret_tallow(
    ctx: &ReducerContext,
    projectile: &Projectile,
    pos_x: f32,
    pos_y: f32,
) -> bool {
    // Check if this is a turret projectile (player turret with Tallow ammo, or monument turret)
    if projectile.source_type == PROJECTILE_SOURCE_MONUMENT_TURRET {
        // Monument turrets always have a chance to create fire patches
        use rand::{Rng, SeedableRng};
        let mut rng = rand::rngs::StdRng::seed_from_u64(ctx.timestamp.to_micros_since_unix_epoch() as u64);
        if rng.gen_range(0..100) < crate::turret::FIRE_PATCH_CHANCE_PERCENT {
            match crate::fire_patch::create_fire_patch(ctx, pos_x, pos_y, projectile.owner_id, false, None, None) {
                Ok(_) => {
                    log::info!("[MonumentTurret] Created fire patch at ({:.1}, {:.1})", pos_x, pos_y);
                    return true;
                }
                Err(e) => {
                    log::warn!("[MonumentTurret] Failed to create fire patch: {}", e);
                }
            }
        }
        return false;
    }
    
    if projectile.source_type != PROJECTILE_SOURCE_TURRET {
        return false;
    }
    
    // Check if ammo is Tallow
    let item_defs_table = ctx.db.item_definition();
    if let Some(ammo_def) = item_defs_table.id().find(projectile.ammo_def_id) {
        if ammo_def.name != "Tallow" {
            return false;
        }
        
        // 25% chance to create fire patch
        use rand::{Rng, SeedableRng};
        let mut rng = rand::rngs::StdRng::seed_from_u64(ctx.timestamp.to_micros_since_unix_epoch() as u64);
        if rng.gen_range(0..100) < crate::turret::FIRE_PATCH_CHANCE_PERCENT {
            // Create fire patch at hit location
            match crate::fire_patch::create_fire_patch(ctx, pos_x, pos_y, projectile.owner_id, false, None, None) {
                Ok(_) => {
                    log::info!("[TurretTallow] Created fire patch at ({:.1}, {:.1}) from turret projectile {}", pos_x, pos_y, projectile.id);
                    return true;
                }
                Err(e) => {
                    log::error!("[TurretTallow] Failed to create fire patch: {}", e);
                    return false;
                }
            }
        }
    }
    
    false
}

fn create_fire_patch_if_fire_arrow(
    ctx: &ReducerContext,
    ammo_item_def: &crate::items::ItemDefinition,
    pos_x: f32,
    pos_y: f32,
    owner_id: Identity,
) -> bool {
    if ammo_item_def.name != "Fire Arrow" {
        return false;
    }

    // Check if it hit a wooden structure (wall or foundation).
    // Use 3x3 chunk filtering around impact to avoid full-table scans.
    use crate::building::{wall_cell, foundation_cell, FOUNDATION_TILE_SIZE_PX};
    let mut hit_wooden_structure = false;
    let mut attached_wall_id = None;
    let mut attached_foundation_id = None;

    let center_chunk = calculate_chunk_index(pos_x, pos_y);
    let center_cx = center_chunk % WORLD_WIDTH_CHUNKS;
    let center_cy = center_chunk / WORLD_WIDTH_CHUNKS;
    let mut nearby_chunks = [0u32; 9];
    let mut nearby_count = 0usize;

    for dy in -1i32..=1 {
        for dx in -1i32..=1 {
            let cx = (center_cx as i32 + dx).max(0).min(WORLD_WIDTH_CHUNKS as i32 - 1) as u32;
            let cy = (center_cy as i32 + dy).max(0).min(WORLD_HEIGHT_CHUNKS as i32 - 1) as u32;
            nearby_chunks[nearby_count] = cy * WORLD_WIDTH_CHUNKS + cx;
            nearby_count += 1;
        }
    }

    // Check walls in nearby chunks first.
    'wall_chunks: for chunk_idx in &nearby_chunks[..nearby_count] {
        for wall in ctx.db.wall_cell().idx_chunk().filter(*chunk_idx) {
            if wall.is_destroyed {
                continue;
            }

            let wall_world_x = (wall.cell_x as f32 * FOUNDATION_TILE_SIZE_PX as f32) + (FOUNDATION_TILE_SIZE_PX as f32 / 2.0);
            let wall_world_y = (wall.cell_y as f32 * FOUNDATION_TILE_SIZE_PX as f32) + (FOUNDATION_TILE_SIZE_PX as f32 / 2.0);
            let dx = wall_world_x - pos_x;
            let dy = wall_world_y - pos_y;
            let dist_sq = dx * dx + dy * dy;

            if dist_sq < (40.0 * 40.0) {
                hit_wooden_structure = true;
                attached_wall_id = Some(wall.id);
                break 'wall_chunks;
            }
        }
    }

    // Check foundations only if no wall was hit.
    if !hit_wooden_structure {
        'foundation_chunks: for chunk_idx in &nearby_chunks[..nearby_count] {
            for foundation in ctx.db.foundation_cell().idx_chunk().filter(*chunk_idx) {
                if foundation.is_destroyed {
                    continue;
                }

                let foundation_world_x = (foundation.cell_x as f32 * FOUNDATION_TILE_SIZE_PX as f32) + (FOUNDATION_TILE_SIZE_PX as f32 / 2.0);
                let foundation_world_y = (foundation.cell_y as f32 * FOUNDATION_TILE_SIZE_PX as f32) + (FOUNDATION_TILE_SIZE_PX as f32 / 2.0);
                let dx = foundation_world_x - pos_x;
                let dy = foundation_world_y - pos_y;
                let dist_sq = dx * dx + dy * dy;

                if dist_sq < (40.0 * 40.0) {
                    hit_wooden_structure = true;
                    attached_foundation_id = Some(foundation.id);
                    break 'foundation_chunks;
                }
            }
        }
    }
    
    // Create fire patch (100% chance for fire arrows)
    match crate::fire_patch::create_fire_patch(
        ctx,
        pos_x,
        pos_y,
        owner_id,
        hit_wooden_structure,
        attached_wall_id,
        attached_foundation_id,
    ) {
        Ok(fire_id) => {
            log::info!("[FireArrow] Created fire patch {} at ({:.1}, {:.1}) (on_wood: {})", 
                      fire_id, pos_x, pos_y, hit_wooden_structure);
            true
        }
        Err(e) => {
            log::warn!("[FireArrow] Failed to create fire patch at ({:.1}, {:.1}): {}", pos_x, pos_y, e);
            false
        }
    }
}
// --- END HELPER FUNCTION ---

fn consume_projectile_on_impact(
    ctx: &ReducerContext,
    projectile: &Projectile,
    ammo_item_def_cached: Option<&crate::items::ItemDefinition>,
    impact_x: f32,
    impact_y: f32,
    missed_projectiles_for_drops: &mut Vec<(u64, u64, f32, f32)>,
    projectiles_to_delete: &mut Vec<u64>,
    pending_resolutions: &mut Vec<PendingProjectileResolution>,
) {
    if let Some(ammo_item_def) = ammo_item_def_cached {
        create_fire_patch_if_fire_arrow(ctx, ammo_item_def, impact_x, impact_y, projectile.owner_id);
    }
    queue_projectile_resolution(
        pending_resolutions,
        projectile,
        impact_x,
        impact_y,
        ProjectileResolvedReason::Impact,
        ProjectileResolvedTargetKind::None,
        0,
    );
    missed_projectiles_for_drops.push((projectile.id, projectile.ammo_def_id, impact_x, impact_y));
    projectiles_to_delete.push(projectile.id);
}

#[reducer]
pub fn update_projectiles(ctx: &ReducerContext, _args: ProjectileUpdateSchedule) -> Result<(), String> {
    // Security check - only allow scheduler to call this
    if ctx.sender() != ctx.identity() {
        return Err("Only the scheduler can update projectiles".to_string());
    }

    // PERFORMANCE: Early exit if no projectiles exist
    if ctx.db.projectile().iter().next().is_none() {
        return Ok(());
    }

    let current_time = ctx.timestamp;
    let item_defs_table = ctx.db.item_definition(); // Get item definitions table
    let mut rng = rand::rngs::StdRng::from_seed(ctx.rng().gen::<[u8; 32]>()); // Explicitly generate a [u8; 32] seed

    let mut projectiles_to_delete = Vec::new();
    let mut missed_projectiles_for_drops = Vec::new(); // Store missed projectiles for drop creation
    let mut pending_resolutions = Vec::new();
    let village_parts: Vec<_> = if ctx.db.projectile().iter().any(|projectile| projectile.flight_3d) {
        ctx.db.monument_part().iter().filter(|part| crate::collision_geometry::COLLISION_GEOMETRY.village.buildings.contains_key(&part.image_path)).collect()
    } else { Vec::new() };

    for projectile in ctx.db.projectile().iter() {
        let start_time_secs = projectile.start_time.to_micros_since_unix_epoch() as f64 / 1_000_000.0;
        let current_time_secs = current_time.to_micros_since_unix_epoch() as f64 / 1_000_000.0; // Moved here for correct scope
        let elapsed_time = current_time_secs - start_time_secs;
        let weapon_item_def_cached = item_defs_table.id().find(projectile.item_def_id);
        let ammo_item_def_cached = item_defs_table.id().find(projectile.ammo_def_id);
        
        let final_gravity_multiplier = if projectile.flight_3d { 0.0 } else { projectile_gravity_multiplier(
            projectile.source_type,
            weapon_item_def_cached.as_ref().map(|weapon| weapon.name.as_str()),
            projectile.item_def_id == projectile.ammo_def_id,
        ) };
        
        // Clamp the last segment to the lifetime before checking impacts.
        let sample_time = elapsed_time.max(0.0).min(10.0);
        let mut current_x = projectile.start_pos_x + projectile.velocity_x * sample_time as f32;
        let mut current_y = projectile.start_pos_y + projectile.velocity_y * sample_time as f32 + 0.5 * GRAVITY * final_gravity_multiplier * (sample_time as f32).powi(2);
        
        let runtime_state = ctx.db.projectile_runtime_state().projectile_id().find(&projectile.id);
        let prev_time = runtime_state
            .as_ref()
            .map(|state| (state.last_sample_elapsed_secs as f64).min(sample_time))
            .unwrap_or(0.0)
            .max(0.0);
        let prev_x = projectile.start_pos_x + projectile.velocity_x * prev_time as f32;
        let prev_y = projectile.start_pos_y + projectile.velocity_y * prev_time as f32 + 0.5 * GRAVITY * final_gravity_multiplier * (prev_time as f32).powi(2);
        
        let travel_distance = ((current_x - projectile.start_pos_x).powi(2) + (current_y - projectile.start_pos_y).powi(2)).sqrt();
        
        let expired = travel_distance > projectile.max_range || elapsed_time > 10.0;
        if travel_distance > projectile.max_range {
            // Test the portion still inside range; an impact just before the
            // range limit must not disappear when a scheduler tick crosses it.
            (current_x, current_y) = clip_segment_to_range(
                (prev_x, prev_y), (current_x, current_y),
                (projectile.start_pos_x, projectile.start_pos_y), projectile.max_range,
            );
        }

        let chunk_indices = crate::projectile_geometry::swept_chunks(
            (prev_x, prev_y), (current_x, current_y), 200.0,
            CHUNK_SIZE_PX, WORLD_WIDTH_CHUNKS, WORLD_HEIGHT_CHUNKS,
        );
        let chunk_count = chunk_indices.len();
        let full_dx = projectile.start_pos_x + projectile.velocity_x * sample_time as f32 - prev_x;
        let full_dy = projectile.start_pos_y + projectile.velocity_y * sample_time as f32 - prev_y;
        let full_length = full_dx.hypot(full_dy);
        let clipped_length = (current_x - prev_x).hypot(current_y - prev_y);
        let range_fraction = if full_length > 1e-6 { (clipped_length / full_length).clamp(0.0, 1.0) } else { 1.0 };
        let clipped_time = prev_time as f32 + (sample_time as f32 - prev_time as f32) * range_fraction;
        let first_hit = if projectile.flight_3d { first_flight_hit_interval(ctx, &projectile, prev_time as f32, clipped_time, &village_parts) } else { None };
        if let Some((_, t)) = first_hit {
            // Advance a negligible distance into the selected shape to avoid
            // floating-point disagreement with the legacy 2D hit handlers.
            let t = (t + 0.00001).min(1.0);
            current_x = prev_x + (current_x - prev_x) * t;
            current_y = prev_y + (current_y - prev_y) * t;
        }
        if matches!(first_hit.map(|hit| hit.0), Some(FlightHit::Ground | FlightHit::World)) {
            consume_projectile_on_impact(ctx, &projectile, ammo_item_def_cached.as_ref(), current_x, current_y,
                &mut missed_projectiles_for_drops, &mut projectiles_to_delete, &mut pending_resolutions);
            continue;
        }
        let allows = |kind: &'static str, id: u64| !projectile.flight_3d || first_hit.map(|hit| hit.0) == Some(FlightHit::Entity(kind, id));
        
        // Monument turret projectiles pass through structures (doors, fences, walls, shelters)
        // to ensure they reach their targeted animals/players
        if projectile.source_type != PROJECTILE_SOURCE_MONUMENT_TURRET {

        // Compare the actual contacts across these construction types before
        // applying damage. Table order must not make a farther door beat a
        // nearer fence or wall on a long swept segment.
        let selected_structure = |kind: &str| first_hit.and_then(|(hit, _)| match hit {
            FlightHit::Entity(name, id) if name == kind => Some((id, current_x, current_y)), _ => None,
        });
        let door_hit = if projectile.flight_3d { selected_structure("door") }
            else { crate::door::check_door_projectile_collision(ctx, prev_x, prev_y, current_x, current_y) };
        let door_hit = door_hit.filter(|(id, _, _)| allows("door", *id));
        let fence_hit = if projectile.flight_3d { selected_structure("fence") } else { crate::fence::check_projectile_fence_collision(ctx, prev_x, prev_y, current_x, current_y) };
        let wall_hit = if projectile.flight_3d { selected_structure("wall") } else { crate::building::check_projectile_wall_collision(ctx, prev_x, prev_y, current_x, current_y) };
        let closest_structure = [(0u8, door_hit), (1u8, fence_hit), (2u8, wall_hit)]
            .into_iter()
            .filter_map(|(kind, hit)| hit.map(|(_, x, y)| (kind, (x - prev_x).powi(2) + (y - prev_y).powi(2))))
            .min_by(|a, b| a.1.total_cmp(&b.1).then_with(|| a.0.cmp(&b.0)))
            .map(|(kind, _)| kind);
        
        // Check for door collision (closed doors block projectiles)
        if let Some((door_id, collision_x, collision_y)) = door_hit.filter(|_| closest_structure == Some(0)) {
            log::info!(
                "[ProjectileUpdate] Projectile {} from owner {:?} hit Door {} at ({:.1}, {:.1})",
                projectile.id, projectile.owner_id, door_id, collision_x, collision_y
            );
            
            // Apply damage to the door
            if let Some(weapon_item_def) = weapon_item_def_cached.as_ref() {
                if let Some(ammo_item_def) = ammo_item_def_cached.as_ref() {
                    let final_damage = calculate_projectile_damage(&weapon_item_def, &ammo_item_def, &projectile, &mut rng);
                    
                    if final_damage > 0.0 {
                        match crate::door::damage_door(
                            ctx,
                            projectile.owner_id,
                            door_id,
                            final_damage,
                            current_time,
                        ) {
                            Ok(_) => {
                                log::info!(
                                    "[ProjectileUpdate] Projectile {} (weapon: {} + ammo: {}) dealt {:.1} damage to Door {}",
                                    projectile.id, weapon_item_def.name, ammo_item_def.name, final_damage, door_id
                                );
                            }
                            Err(e) => {
                                log::error!(
                                    "[ProjectileUpdate] Error applying projectile damage to Door {}: {}",
                                    door_id, e
                                );
                            }
                        }
                    }
                    
                    // Create fire patch if this is a fire arrow (100% chance)
                    create_fire_patch_if_fire_arrow(ctx, &ammo_item_def, collision_x, collision_y, projectile.owner_id);
                }
            }
            
            // Projectile hit door - stop it and create dropped item
            queue_projectile_resolution(
                &mut pending_resolutions,
                &projectile,
                collision_x,
                collision_y,
                ProjectileResolvedReason::Impact,
                ProjectileResolvedTargetKind::Structure,
                door_id,
            );
            missed_projectiles_for_drops.push((projectile.id, projectile.ammo_def_id, collision_x, collision_y));
            projectiles_to_delete.push(projectile.id);
            continue;
        }
        
        // Check for fence collision (fences block projectiles)
        if let Some((fence_id, collision_x, collision_y)) = fence_hit.filter(|_| closest_structure == Some(1)) {
            log::info!(
                "[ProjectileUpdate] Projectile {} from owner {:?} hit Fence {} at ({:.1}, {:.1})",
                projectile.id, projectile.owner_id, fence_id, collision_x, collision_y
            );
            
            // Apply damage to the fence
            if let Some(weapon_item_def) = weapon_item_def_cached.as_ref() {
                if let Some(ammo_item_def) = ammo_item_def_cached.as_ref() {
                    let final_damage = calculate_projectile_damage(&weapon_item_def, &ammo_item_def, &projectile, &mut rng);
                    
                    if final_damage > 0.0 {
                        match crate::fence::damage_fence(
                            ctx,
                            projectile.owner_id,
                            fence_id,
                            final_damage,
                            current_time,
                        ) {
                            Ok(_) => {
                                log::info!(
                                    "[ProjectileUpdate] Projectile {} (weapon: {} + ammo: {}) dealt {:.1} damage to Fence {}",
                                    projectile.id, weapon_item_def.name, ammo_item_def.name, final_damage, fence_id
                                );
                            }
                            Err(e) => {
                                log::error!(
                                    "[ProjectileUpdate] Error applying projectile damage to Fence {}: {}",
                                    fence_id, e
                                );
                            }
                        }
                    }
                    
                    // Create fire patch if this is a fire arrow (100% chance)
                    create_fire_patch_if_fire_arrow(ctx, &ammo_item_def, collision_x, collision_y, projectile.owner_id);
                }
            }
            
            // Projectile hit fence - stop it and create dropped item
            queue_projectile_resolution(
                &mut pending_resolutions,
                &projectile,
                collision_x,
                collision_y,
                ProjectileResolvedReason::Impact,
                ProjectileResolvedTargetKind::Structure,
                fence_id,
            );
            missed_projectiles_for_drops.push((projectile.id, projectile.ammo_def_id, collision_x, collision_y));
            projectiles_to_delete.push(projectile.id);
            continue;
        }
        
        // Check for wall collision first (before shelter)
        if let Some((wall_id, collision_x, collision_y)) = wall_hit.filter(|_| closest_structure == Some(2)) {
            log::info!(
                "[ProjectileUpdate] Projectile {} from owner {:?} hit Wall {} at ({:.1}, {:.1})",
                projectile.id, projectile.owner_id, wall_id, collision_x, collision_y
            );
            
            // Apply damage to the wall before handling the projectile
            if let Some(weapon_item_def) = weapon_item_def_cached.as_ref() {
                if let Some(ammo_item_def) = ammo_item_def_cached.as_ref() {
                    let final_damage = calculate_projectile_damage(&weapon_item_def, &ammo_item_def, &projectile, &mut rng);

                    if final_damage > 0.0 {
                        match crate::building::damage_wall(
                            ctx,
                            projectile.owner_id,
                            wall_id,
                            final_damage,
                            current_time,
                        ) {
                            Ok(_) => {
                                log::info!(
                                    "[ProjectileUpdate] Projectile {} (weapon: {} + ammo: {}) dealt {:.1} damage to Wall {}",
                                    projectile.id, weapon_item_def.name, ammo_item_def.name, final_damage, wall_id
                                );
                            }
                            Err(e) => {
                                log::error!(
                                    "[ProjectileUpdate] Error applying projectile damage to Wall {}: {}",
                                    wall_id, e
                                );
                            }
                        }
                    } else {
                        log::debug!(
                            "[ProjectileUpdate] Combined damage from weapon '{}' and ammunition '{}' is 0, no damage applied to Wall {}",
                            weapon_item_def.name, ammo_item_def.name, wall_id
                        );
                    }
                } else {
                    log::warn!(
                        "[ProjectileUpdate] ItemDefinition not found for projectile's ammunition (ID: {}). Cannot apply wall damage.",
                        projectile.ammo_def_id
                    );
                }
            } else {
                log::warn!(
                    "[ProjectileUpdate] ItemDefinition not found for projectile's weapon (ID: {}). Cannot apply wall damage.",
                    projectile.item_def_id
                );
            }
            
            // Create fire patch if this is a fire arrow (100% chance)
            if let Some(ammo_item_def) = ammo_item_def_cached.as_ref() {
                create_fire_patch_if_fire_arrow(ctx, &ammo_item_def, collision_x, collision_y, projectile.owner_id);
            }
            
            // Projectile hit wall - stop it and create dropped item
            queue_projectile_resolution(
                &mut pending_resolutions,
                &projectile,
                collision_x,
                collision_y,
                ProjectileResolvedReason::Impact,
                ProjectileResolvedTargetKind::Structure,
                wall_id,
            );
            missed_projectiles_for_drops.push((projectile.id, projectile.ammo_def_id, collision_x, collision_y));
            projectiles_to_delete.push(projectile.id);
            continue;
        }
        
        // Check for shelter wall collision
        let shelter_hit = if projectile.flight_3d {
            selected_structure("shelter").map(|(id, x, y)| (id as u32, x, y))
        } else {
            shelter::check_projectile_shelter_collision(ctx, projectile.start_pos_x, projectile.start_pos_y, current_x, current_y)
        };
        if let Some((shelter_id, collision_x, collision_y)) = shelter_hit.filter(|(id, _, _)| allows("shelter", *id as u64)) {
            // NEW: Check if player is attacking their own shelter - prevent self-damage
            if let Some(shelter) = ctx.db.shelter().id().find(shelter_id) {
                if shelter.placed_by == projectile.owner_id {
                    // Check if the projectile was fired from inside the shelter
                    if shelter::is_player_inside_shelter(projectile.start_pos_x, projectile.start_pos_y, &shelter) {
                        log::info!(
                            "[ProjectileUpdate] Projectile {} from owner {:?} hit their own Shelter {} from inside - NO DAMAGE (self-protection)",
                            projectile.id, projectile.owner_id, shelter_id
                        );
                        
                        // Projectile hit own shelter from inside - consume projectile but don't damage shelter
                        // Create fire patch if this is a fire arrow (100% chance)
                        if let Some(ammo_item_def) = ammo_item_def_cached.as_ref() {
                            create_fire_patch_if_fire_arrow(ctx, &ammo_item_def, collision_x, collision_y, projectile.owner_id);
                        }
                        
                        queue_projectile_resolution(
                            &mut pending_resolutions,
                            &projectile,
                            collision_x,
                            collision_y,
                            ProjectileResolvedReason::Impact,
                            ProjectileResolvedTargetKind::Structure,
                            shelter_id.into(),
                        );
                        missed_projectiles_for_drops.push((projectile.id, projectile.ammo_def_id, collision_x, collision_y));
                        projectiles_to_delete.push(projectile.id);
                        continue;
                    } else {
                        log::info!(
                            "[ProjectileUpdate] Projectile {} from owner {:?} hit their own Shelter {} from outside - DAMAGE ALLOWED",
                            projectile.id, projectile.owner_id, shelter_id
                        );
                        // Allow damage to own shelter if fired from outside (e.g., accidentally)
                    }
                }
            }
            
            log::info!(
                "[ProjectileUpdate] Projectile {} from owner {:?} hit Shelter {} wall at ({:.1}, {:.1})",
                projectile.id, projectile.owner_id, shelter_id, collision_x, collision_y
            );
            
                            // Apply damage to the shelter before handling the projectile
                if let Some(weapon_item_def) = weapon_item_def_cached.as_ref() {
                    if let Some(ammo_item_def) = ammo_item_def_cached.as_ref() {
                        let final_damage = calculate_projectile_damage(&weapon_item_def, &ammo_item_def, &projectile, &mut rng);

                    if final_damage > 0.0 {
                        match crate::shelter::damage_shelter(
                            ctx, 
                            projectile.owner_id, 
                            shelter_id, 
                            final_damage, 
                            current_time, 
                            &mut rng
                        ) {
                            Ok(attack_result) => {
                                if attack_result.hit {
                                    log::info!(
                                        "[ProjectileUpdate] Projectile {} (weapon: {} + ammo: {}) dealt {:.1} damage to Shelter {}",
                                        projectile.id, weapon_item_def.name, ammo_item_def.name, final_damage, shelter_id
                                    );
                                }
                            }
                            Err(e) => {
                                log::error!(
                                    "[ProjectileUpdate] Error applying projectile damage to Shelter {}: {}",
                                    shelter_id, e
                                );
                            }
                        }
                    } else {
                        log::debug!(
                            "[ProjectileUpdate] Combined damage from weapon '{}' and ammunition '{}' is 0, no damage applied to Shelter {}",
                            weapon_item_def.name, ammo_item_def.name, shelter_id
                        );
                    }
                } else {
                    log::error!(
                        "[ProjectileUpdate] ItemDefinition not found for projectile's ammunition (ID: {}). Cannot apply shelter damage.",
                        projectile.ammo_def_id
                    );
                }
            } else {
                log::error!(
                    "[ProjectileUpdate] ItemDefinition not found for projectile's weapon (ID: {}). Cannot apply shelter damage.",
                    projectile.item_def_id
                );
            }
            
            // Create fire patch if this is a fire arrow (100% chance)
            if let Some(ammo_item_def) = ammo_item_def_cached.as_ref() {
                create_fire_patch_if_fire_arrow(ctx, &ammo_item_def, collision_x, collision_y, projectile.owner_id);
            }
            
            // Projectile hit shelter wall - store info for dropped item creation
            queue_projectile_resolution(
                &mut pending_resolutions,
                &projectile,
                collision_x,
                collision_y,
                ProjectileResolvedReason::Impact,
                ProjectileResolvedTargetKind::Structure,
                shelter_id.into(),
            );
            missed_projectiles_for_drops.push((projectile.id, projectile.ammo_def_id, collision_x, collision_y));
            projectiles_to_delete.push(projectile.id);
            continue;
        }
        
        } // End of structure collision skip for monument turret projectiles
        
        
        // Check for natural obstacle collisions (trees and stones)
        let mut hit_natural_obstacle_this_tick = false;
        
        // Check tree collisions (chunk-filtered)
        'tree_chunks: for chunk_idx in &chunk_indices[..chunk_count] {
            for tree in ctx.db.tree().chunk_index().filter(*chunk_idx) {
                if !allows("tree", tree.id as u64) { continue; }
                // Skip dead/respawning trees (respawn_at > UNIX_EPOCH when tree is destroyed)
                if tree.respawn_at > Timestamp::UNIX_EPOCH {
                    continue;
                }
                
                // Trees have a generous collision radius for projectiles
                const PROJECTILE_TREE_HIT_RADIUS: f32 = 30.0; // Generous radius for tree trunks
                const PROJECTILE_TREE_Y_OFFSET: f32 = 10.0; // Slight offset for tree base
                
                let tree_hit_y = tree.pos_y - PROJECTILE_TREE_Y_OFFSET;
                
                // Use line segment collision detection for trees
                if let Some((impact_x, impact_y)) = selected_impact(projectile.flight_3d, current_x, current_y, line_circle_first_impact_point(
                    prev_x,
                    prev_y,
                    current_x,
                    current_y,
                    tree.pos_x,
                    tree_hit_y,
                    PROJECTILE_TREE_HIT_RADIUS,
                )) {
                    let (impact_x, impact_y) = if projectile.flight_3d { (current_x, current_y) } else { (impact_x, impact_y) };
                    log::info!(
                        "[ProjectileUpdate] Projectile {} from owner {:?} hit Tree {} along path from ({:.1}, {:.1}) to ({:.1}, {:.1})",
                        projectile.id, projectile.owner_id, tree.id, prev_x, prev_y, current_x, current_y
                    );
                    
                    // Create fire patch if this is a fire arrow (100% chance)
                    if let Some(ammo_item_def) = ammo_item_def_cached.as_ref() {
                        create_fire_patch_if_fire_arrow(ctx, &ammo_item_def, impact_x, impact_y, projectile.owner_id);
                    }
                    
                    // Trees block projectiles but don't take damage - projectile becomes dropped item
                    queue_projectile_resolution(
                        &mut pending_resolutions,
                        &projectile,
                        impact_x,
                        impact_y,
                        ProjectileResolvedReason::Impact,
                        ProjectileResolvedTargetKind::World,
                        tree.id,
                    );
                    missed_projectiles_for_drops.push((projectile.id, projectile.ammo_def_id, impact_x, impact_y));
                    projectiles_to_delete.push(projectile.id);
                    hit_natural_obstacle_this_tick = true;
                    break 'tree_chunks;
                }
            }
        }
        
        if hit_natural_obstacle_this_tick {
            continue;
        }
        
        // Check stone collisions (chunk-filtered)
        'stone_chunks: for chunk_idx in &chunk_indices[..chunk_count] {
            for stone in ctx.db.stone().chunk_index().filter(*chunk_idx) {
                if !allows("stone", stone.id as u64) { continue; }
                // Skip dead/respawning stones (respawn_at > UNIX_EPOCH when stone is destroyed)
                if stone.respawn_at > Timestamp::UNIX_EPOCH {
                    continue;
                }
                
                // Stones have a generous collision radius for projectiles
                const PROJECTILE_STONE_HIT_RADIUS: f32 = 25.0; // Generous radius for stone rocks
                const PROJECTILE_STONE_Y_OFFSET: f32 = 5.0; // Slight offset for stone base
                
                let stone_hit_y = stone.pos_y - PROJECTILE_STONE_Y_OFFSET;
                
                // Use line segment collision detection for stones
                if let Some((impact_x, impact_y)) = selected_impact(projectile.flight_3d, current_x, current_y, line_circle_first_impact_point(
                    prev_x,
                    prev_y,
                    current_x,
                    current_y,
                    stone.pos_x,
                    stone_hit_y,
                    PROJECTILE_STONE_HIT_RADIUS,
                )) {
                    let (impact_x, impact_y) = if projectile.flight_3d { (current_x, current_y) } else { (impact_x, impact_y) };
                    log::info!(
                        "[ProjectileUpdate] Projectile {} from owner {:?} hit Stone {} along path from ({:.1}, {:.1}) to ({:.1}, {:.1})",
                        projectile.id, projectile.owner_id, stone.id, prev_x, prev_y, current_x, current_y
                    );
                    
                    // Create fire patch if this is a fire arrow (100% chance)
                    if let Some(ammo_item_def) = ammo_item_def_cached.as_ref() {
                        create_fire_patch_if_fire_arrow(ctx, &ammo_item_def, impact_x, impact_y, projectile.owner_id);
                    }
                    
                    // Stones block projectiles but don't take damage - projectile becomes dropped item
                    queue_projectile_resolution(
                        &mut pending_resolutions,
                        &projectile,
                        impact_x,
                        impact_y,
                        ProjectileResolvedReason::Impact,
                        ProjectileResolvedTargetKind::World,
                        stone.id,
                    );
                    missed_projectiles_for_drops.push((projectile.id, projectile.ammo_def_id, impact_x, impact_y));
                    projectiles_to_delete.push(projectile.id);
                    hit_natural_obstacle_this_tick = true;
                    break 'stone_chunks;
                }
            }
        }

        if hit_natural_obstacle_this_tick {
            continue;
        }
        
        // Check rune stone collisions (chunk-filtered)
        'rune_chunks: for chunk_idx in &chunk_indices[..chunk_count] {
            for rune_stone in ctx.db.rune_stone().chunk_index().filter(*chunk_idx) {
                if !allows("rune", rune_stone.id as u64) { continue; }
                // Rune stones have a generous collision radius for projectiles (doubled to match visual size)
                const PROJECTILE_RUNE_STONE_HIT_RADIUS: f32 = 80.0; // Doubled from 40.0 to match doubled visual size
                const PROJECTILE_RUNE_STONE_Y_OFFSET: f32 = 100.0; // Doubled from 50.0 to match doubled visual size
                
                let rune_stone_hit_y = rune_stone.pos_y - PROJECTILE_RUNE_STONE_Y_OFFSET;
                
                // Use line segment collision detection for rune stones
                if projectile.flight_3d || line_intersects_circle(prev_x, prev_y, current_x, current_y, rune_stone.pos_x, rune_stone_hit_y, PROJECTILE_RUNE_STONE_HIT_RADIUS) {
                    log::info!(
                        "[ProjectileUpdate] Projectile {} from owner {:?} hit RuneStone {} along path from ({:.1}, {:.1}) to ({:.1}, {:.1})",
                        projectile.id, projectile.owner_id, rune_stone.id, prev_x, prev_y, current_x, current_y
                    );
                    
                    // Create fire patch if this is a fire arrow (100% chance)
                    if let Some(ammo_item_def) = ammo_item_def_cached.as_ref() {
                        create_fire_patch_if_fire_arrow(ctx, &ammo_item_def, current_x, current_y, projectile.owner_id);
                    }
                    
                    // Rune stones block projectiles but don't take damage - projectile becomes dropped item
                    queue_projectile_resolution(
                        &mut pending_resolutions,
                        &projectile,
                        current_x,
                        current_y,
                        ProjectileResolvedReason::Impact,
                        ProjectileResolvedTargetKind::World,
                        rune_stone.id,
                    );
                    missed_projectiles_for_drops.push((projectile.id, projectile.ammo_def_id, current_x, current_y));
                    projectiles_to_delete.push(projectile.id);
                    hit_natural_obstacle_this_tick = true;
                    break 'rune_chunks;
                }
            }
        }
        
        if hit_natural_obstacle_this_tick {
            continue;
        }
        
        // Check basalt column collisions (chunk-filtered, permanent rock obstacles in quarries)
        'basalt_chunks: for chunk_idx in &chunk_indices[..chunk_count] {
            for basalt in ctx.db.basalt_column().chunk_index().filter(*chunk_idx) {
                if !allows("basalt", basalt.id as u64) { continue; }
                // Basalt columns are permanent obstacles (no health/respawn check needed)
                const PROJECTILE_BASALT_HIT_RADIUS: f32 = 35.0;
                const PROJECTILE_BASALT_Y_OFFSET: f32 = 40.0;
                
                let basalt_hit_y = basalt.pos_y - PROJECTILE_BASALT_Y_OFFSET;
                
                // Use line segment collision detection for basalt columns
                if projectile.flight_3d || line_intersects_circle(prev_x, prev_y, current_x, current_y, basalt.pos_x, basalt_hit_y, PROJECTILE_BASALT_HIT_RADIUS) {
                    log::info!(
                        "[ProjectileUpdate] Projectile {} from owner {:?} hit BasaltColumn {} along path from ({:.1}, {:.1}) to ({:.1}, {:.1})",
                        projectile.id, projectile.owner_id, basalt.id, prev_x, prev_y, current_x, current_y
                    );
                    
                    // Create fire patch if this is a fire arrow (100% chance)
                    if let Some(ammo_item_def) = ammo_item_def_cached.as_ref() {
                        create_fire_patch_if_fire_arrow(ctx, &ammo_item_def, current_x, current_y, projectile.owner_id);
                    }
                    
                    // Basalt columns block projectiles but don't take damage - projectile becomes dropped item
                    queue_projectile_resolution(
                        &mut pending_resolutions,
                        &projectile,
                        current_x,
                        current_y,
                        ProjectileResolvedReason::Impact,
                        ProjectileResolvedTargetKind::World,
                        basalt.id,
                    );
                    missed_projectiles_for_drops.push((projectile.id, projectile.ammo_def_id, current_x, current_y));
                    projectiles_to_delete.push(projectile.id);
                    hit_natural_obstacle_this_tick = true;
                    break 'basalt_chunks;
                }
            }
        }

        if hit_natural_obstacle_this_tick {
            continue;
        }

        // Check living coral collisions (chunk-filtered, underwater obstacles)
        'living_coral_chunks: for chunk_idx in &chunk_indices[..chunk_count] {
            for coral in ctx.db.living_coral().chunk_index().filter(*chunk_idx) {
                if !allows("coral", coral.id as u64) { continue; }
                // Skip destroyed/respawning coral
                if coral.respawn_at > Timestamp::UNIX_EPOCH {
                    continue;
                }

                let coral_hit_y = coral.pos_y - LIVING_CORAL_COLLISION_Y_OFFSET;
                if let Some((impact_x, impact_y)) = selected_impact(projectile.flight_3d, current_x, current_y, line_circle_first_impact_point(
                    prev_x,
                    prev_y,
                    current_x,
                    current_y,
                    coral.pos_x,
                    coral_hit_y,
                    LIVING_CORAL_RADIUS,
                )) {
                    let (impact_x, impact_y) = if projectile.flight_3d { (current_x, current_y) } else { (impact_x, impact_y) };
                    log::info!(
                        "[ProjectileUpdate] Projectile {} from owner {:?} hit LivingCoral {} along path from ({:.1}, {:.1}) to ({:.1}, {:.1})",
                        projectile.id, projectile.owner_id, coral.id, prev_x, prev_y, current_x, current_y
                    );

                    if let Some(ammo_item_def) = ammo_item_def_cached.as_ref() {
                        create_fire_patch_if_fire_arrow(ctx, &ammo_item_def, impact_x, impact_y, projectile.owner_id);
                    }

                    // Coral blocks projectiles. We intentionally do not route projectile
                    // hits through coral harvesting combat; ammo should drop at impact.
                    queue_projectile_resolution(
                        &mut pending_resolutions,
                        &projectile,
                        impact_x,
                        impact_y,
                        ProjectileResolvedReason::Impact,
                        ProjectileResolvedTargetKind::World,
                        coral.id,
                    );
                    missed_projectiles_for_drops.push((projectile.id, projectile.ammo_def_id, impact_x, impact_y));
                    projectiles_to_delete.push(projectile.id);
                    hit_natural_obstacle_this_tick = true;
                    break 'living_coral_chunks;
                }
            }
        }
        
        if hit_natural_obstacle_this_tick {
            continue;
        }
        
        // Check deployable entity collisions (campfires, boxes, stashes, sleeping bags)
        let mut hit_deployable_this_tick = false;
        
        // Check campfire collisions (chunk-filtered)
        'campfire_chunks: for chunk_idx in &chunk_indices[..chunk_count] {
            for campfire in ctx.db.campfire().chunk_index().filter(*chunk_idx) {
            if !allows("campfire", campfire.id as u64) { continue; }
            if campfire.is_destroyed {
                continue;
            }
            
            // Use a more generous hit radius for projectiles and reduce Y offset for easier targeting
            const PROJECTILE_CAMPFIRE_HIT_RADIUS: f32 = 32.0; // Larger than collision radius (20.0)
            const PROJECTILE_CAMPFIRE_Y_OFFSET: f32 = -5.0; // Slight upward offset for easier hits
            
            let campfire_hit_y = campfire.pos_y - PROJECTILE_CAMPFIRE_Y_OFFSET;
            
            // Use line segment collision detection instead of just checking current position
            if projectile.flight_3d || line_intersects_circle(prev_x, prev_y, current_x, current_y, campfire.pos_x, campfire_hit_y, PROJECTILE_CAMPFIRE_HIT_RADIUS) {
                log::info!(
                    "[ProjectileUpdate] Projectile {} from owner {:?} hit Campfire {} along path from ({:.1}, {:.1}) to ({:.1}, {:.1})",
                    projectile.id, projectile.owner_id, campfire.id, prev_x, prev_y, current_x, current_y
                );
                
                // Apply damage using existing combat system
                if let Some(weapon_item_def) = weapon_item_def_cached.as_ref() {
                    if let Some(ammo_item_def) = ammo_item_def_cached.as_ref() {
                        let final_damage = calculate_projectile_damage(&weapon_item_def, &ammo_item_def, &projectile, &mut rng);

                        if final_damage > 0.0 {
                            match combat::damage_campfire(ctx, projectile.owner_id, campfire.id, final_damage, current_time, &mut rng) {
                                Ok(attack_result) => {
                                    if attack_result.hit {
                                        log::info!(
                                            "[ProjectileUpdate] Projectile {} dealt {:.1} damage to Campfire {}",
                                            projectile.id, final_damage, campfire.id
                                        );
                                    }
                                }
                                Err(e) => {
                                    log::error!(
                                        "[ProjectileUpdate] Error applying projectile damage to Campfire {}: {}",
                                        campfire.id, e
                                    );
                                }
                            }
                        }
                    }
                }
                
                // Create fire patch if this is a fire arrow (100% chance)
                if let Some(ammo_item_def) = ammo_item_def_cached.as_ref() {
                    create_fire_patch_if_fire_arrow(ctx, &ammo_item_def, current_x, current_y, projectile.owner_id);
                }
                
                // Add projectile to dropped item system (with break chance) like shelters
                queue_projectile_resolution(
                    &mut pending_resolutions,
                    &projectile,
                    current_x,
                    current_y,
                    ProjectileResolvedReason::Impact,
                    ProjectileResolvedTargetKind::Deployable,
                    campfire.id.into(),
                );
                missed_projectiles_for_drops.push((projectile.id, projectile.ammo_def_id, current_x, current_y));
                projectiles_to_delete.push(projectile.id);
                hit_deployable_this_tick = true;
                break 'campfire_chunks;
            }
            }
        }
        
        if hit_deployable_this_tick {
            continue;
        }
        
        // Check wooden storage box collisions (chunk-filtered)
        'storage_box_chunks: for chunk_idx in &chunk_indices[..chunk_count] {
            for storage_box in ctx.db.wooden_storage_box().chunk_index().filter(*chunk_idx) {
                if !allows("box", storage_box.id as u64) { continue; }
                if storage_box.is_destroyed {
                    continue;
                }
                if storage_box.box_type == crate::wooden_storage_box::BOX_TYPE_BACKPACK {
                    continue;
                }
                
                // Use a more generous hit radius for projectiles
                const PROJECTILE_BOX_HIT_RADIUS: f32 = 28.0; // Larger than collision radius (18.0)
                const PROJECTILE_BOX_Y_OFFSET: f32 = 5.0; // Reduced from 10.0 for easier hits
                
                let box_hit_y = storage_box.pos_y - PROJECTILE_BOX_Y_OFFSET;
                
                // Use line segment collision detection instead of just checking current position
                if projectile.flight_3d || line_intersects_circle(prev_x, prev_y, current_x, current_y, storage_box.pos_x, box_hit_y, PROJECTILE_BOX_HIT_RADIUS) {
                    log::info!(
                        "[ProjectileUpdate] Projectile {} from owner {:?} hit Wooden Storage Box {} along path from ({:.1}, {:.1}) to ({:.1}, {:.1})",
                        projectile.id, projectile.owner_id, storage_box.id, prev_x, prev_y, current_x, current_y
                    );
                    
                    // Apply damage using existing combat system
                    if let Some(weapon_item_def) = weapon_item_def_cached.as_ref() {
                        if let Some(ammo_item_def) = ammo_item_def_cached.as_ref() {
                            let final_damage = calculate_projectile_damage(&weapon_item_def, &ammo_item_def, &projectile, &mut rng);

                            if final_damage > 0.0 {
                                match combat::damage_wooden_storage_box(ctx, projectile.owner_id, storage_box.id, final_damage, current_time, &mut rng) {
                                    Ok(attack_result) => {
                                        if attack_result.hit {
                                            log::info!(
                                                "[ProjectileUpdate] Projectile {} dealt {:.1} damage to Wooden Storage Box {}",
                                                projectile.id, final_damage, storage_box.id
                                            );
                                        }
                                    }
                                    Err(e) => {
                                        log::error!(
                                            "[ProjectileUpdate] Error applying projectile damage to Wooden Storage Box {}: {}",
                                            storage_box.id, e
                                        );
                                    }
                                }
                            }
                        }
                    }
                    
                    // Create fire patch if this is a fire arrow (100% chance)
                    if let Some(ammo_item_def) = ammo_item_def_cached.as_ref() {
                        create_fire_patch_if_fire_arrow(ctx, &ammo_item_def, current_x, current_y, projectile.owner_id);
                    }
                    
                    // Add projectile to dropped item system (with break chance) like shelters
                    queue_projectile_resolution(
                        &mut pending_resolutions,
                        &projectile,
                        current_x,
                        current_y,
                        ProjectileResolvedReason::Impact,
                        ProjectileResolvedTargetKind::Deployable,
                        storage_box.id.into(),
                    );
                    missed_projectiles_for_drops.push((projectile.id, projectile.ammo_def_id, current_x, current_y));
                    projectiles_to_delete.push(projectile.id);
                    hit_deployable_this_tick = true;
                    break 'storage_box_chunks;
                }
            }
        }
        
        if hit_deployable_this_tick {
            continue;
        }
        
        // Check stash collisions (chunk-filtered)
        'stash_chunks: for chunk_idx in &chunk_indices[..chunk_count] {
            for stash in ctx.db.stash().chunk_index().filter(*chunk_idx) {
                if !allows("stash", stash.id as u64) { continue; }
                if stash.is_destroyed {
                    continue;
                }
                
                // Stashes don't have collision radius since they're walkable, use a generous hit radius for projectiles
                const PROJECTILE_STASH_HIT_RADIUS: f32 = 25.0; // Larger radius for easier hits
                
                // Use line segment collision detection instead of just checking current position
                if projectile.flight_3d || line_intersects_circle(prev_x, prev_y, current_x, current_y, stash.pos_x, stash.pos_y, PROJECTILE_STASH_HIT_RADIUS) {
                    log::info!(
                        "[ProjectileUpdate] Projectile {} from owner {:?} hit Stash {} along path from ({:.1}, {:.1}) to ({:.1}, {:.1})",
                        projectile.id, projectile.owner_id, stash.id, prev_x, prev_y, current_x, current_y
                    );
                    
                    // Apply damage using existing combat system
                    if let Some(weapon_item_def) = weapon_item_def_cached.as_ref() {
                        if let Some(ammo_item_def) = ammo_item_def_cached.as_ref() {
                            let final_damage = calculate_projectile_damage(&weapon_item_def, &ammo_item_def, &projectile, &mut rng);

                            if final_damage > 0.0 {
                                match combat::damage_stash(ctx, projectile.owner_id, stash.id, final_damage, current_time, &mut rng) {
                                    Ok(attack_result) => {
                                        if attack_result.hit {
                                            log::info!(
                                                "[ProjectileUpdate] Projectile {} dealt {:.1} damage to Stash {}",
                                                projectile.id, final_damage, stash.id
                                            );
                                        }
                                    }
                                    Err(e) => {
                                        log::error!(
                                            "[ProjectileUpdate] Error applying projectile damage to Stash {}: {}",
                                            stash.id, e
                                        );
                                    }
                                }
                            }
                        }
                    }
                    
                    consume_projectile_on_impact(
                        ctx,
                        &projectile,
                        ammo_item_def_cached.as_ref(),
                        current_x,
                        current_y,
                        &mut missed_projectiles_for_drops,
                        &mut projectiles_to_delete,
                        &mut pending_resolutions,
                    );
                    hit_deployable_this_tick = true;
                    break 'stash_chunks;
                }
            }
        }
        
        if hit_deployable_this_tick {
            continue;
        }
        
        // Check sleeping bag collisions (chunk-filtered)
        'sleeping_bag_chunks: for chunk_idx in &chunk_indices[..chunk_count] {
            for sleeping_bag in ctx.db.sleeping_bag().chunk_index().filter(*chunk_idx) {
                if !allows("bag", sleeping_bag.id as u64) { continue; }
                if sleeping_bag.is_destroyed {
                    continue;
                }
                
                // Use a more generous hit radius for projectiles and reduce Y offset
                const PROJECTILE_SLEEPING_BAG_HIT_RADIUS: f32 = 28.0; // Larger than collision radius (18.0)
                const PROJECTILE_SLEEPING_BAG_Y_OFFSET: f32 = 0.0; // No Y offset for easier hits on low-profile items
                
                let bag_hit_y = sleeping_bag.pos_y - PROJECTILE_SLEEPING_BAG_Y_OFFSET;
                
                // Use line segment collision detection instead of just checking current position
                if projectile.flight_3d || line_intersects_circle(prev_x, prev_y, current_x, current_y, sleeping_bag.pos_x, bag_hit_y, PROJECTILE_SLEEPING_BAG_HIT_RADIUS) {
                    log::info!(
                        "[ProjectileUpdate] Projectile {} from owner {:?} hit Sleeping Bag {} along path from ({:.1}, {:.1}) to ({:.1}, {:.1})",
                        projectile.id, projectile.owner_id, sleeping_bag.id, prev_x, prev_y, current_x, current_y
                    );
                    
                    // Apply damage using existing combat system
                    if let Some(weapon_item_def) = weapon_item_def_cached.as_ref() {
                        if let Some(ammo_item_def) = ammo_item_def_cached.as_ref() {
                            let final_damage = calculate_projectile_damage(&weapon_item_def, &ammo_item_def, &projectile, &mut rng);

                            if final_damage > 0.0 {
                                match combat::damage_sleeping_bag(ctx, projectile.owner_id, sleeping_bag.id, final_damage, current_time, &mut rng) {
                                    Ok(attack_result) => {
                                        if attack_result.hit {
                                            log::info!(
                                                "[ProjectileUpdate] Projectile {} dealt {:.1} damage to Sleeping Bag {}",
                                                projectile.id, final_damage, sleeping_bag.id
                                            );
                                        }
                                    }
                                    Err(e) => {
                                        log::error!(
                                            "[ProjectileUpdate] Error applying projectile damage to Sleeping Bag {}: {}",
                                            sleeping_bag.id, e
                                        );
                                    }
                                }
                            }
                        }
                    }
                    
                    consume_projectile_on_impact(
                        ctx,
                        &projectile,
                        ammo_item_def_cached.as_ref(),
                        current_x,
                        current_y,
                        &mut missed_projectiles_for_drops,
                        &mut projectiles_to_delete,
                        &mut pending_resolutions,
                    );
                    hit_deployable_this_tick = true;
                    break 'sleeping_bag_chunks;
                }
            }
        }
        
        // Check barrel collisions (chunk-filtered)
        'barrel_chunks: for chunk_idx in &chunk_indices[..chunk_count] {
            for barrel in ctx.db.barrel().chunk_index().filter(*chunk_idx) {
                if !allows("barrel", barrel.id as u64) { continue; }
                if barrel.health <= 0.0 {
                    continue; // Skip destroyed barrels
                }
                
                let (projectile_barrel_hit_radius, projectile_barrel_y_offset) = if barrel.variant == crate::barrel::BUOY_VARIANT {
                    (32.0, 110.0) // Buoy - standard hit radius, offset moved down a bit
                } else if barrel.variant == 4 {
                    (64.0, 96.0) // Variant 4 (barrel5.png) 2x larger
                } else {
                    (32.0, 48.0) // Standard
                };
                
                let barrel_hit_y = barrel.pos_y - projectile_barrel_y_offset;
                
                // Use line segment collision detection instead of just checking current position
                if let Some((impact_x, impact_y)) = selected_impact(projectile.flight_3d, current_x, current_y, line_circle_first_impact_point(
                    prev_x,
                    prev_y,
                    current_x,
                    current_y,
                    barrel.pos_x,
                    barrel_hit_y,
                    projectile_barrel_hit_radius,
                )) {
                    let (impact_x, impact_y) = if projectile.flight_3d { (current_x, current_y) } else { (impact_x, impact_y) };
                    log::info!(
                        "[ProjectileUpdate] Projectile {} from owner {:?} hit Barrel {} along path from ({:.1}, {:.1}) to ({:.1}, {:.1})",
                        projectile.id, projectile.owner_id, barrel.id, prev_x, prev_y, current_x, current_y
                    );
                    
                    // Apply damage using existing barrel combat system
                    if let Some(weapon_item_def) = weapon_item_def_cached.as_ref() {
                        if let Some(ammo_item_def) = ammo_item_def_cached.as_ref() {
                            let final_damage = calculate_projectile_damage(&weapon_item_def, &ammo_item_def, &projectile, &mut rng);

                            if final_damage > 0.0 {
                                match crate::barrel::damage_barrel(ctx, projectile.owner_id, barrel.id, final_damage, current_time, &mut rng) {
                                    Ok(()) => {
                                        log::info!(
                                            "[ProjectileUpdate] Projectile {} dealt {:.1} damage to Barrel {}",
                                            projectile.id, final_damage, barrel.id
                                        );
                                    }
                                    Err(e) => {
                                        log::error!(
                                            "[ProjectileUpdate] Error applying projectile damage to Barrel {}: {}",
                                            barrel.id, e
                                        );
                                    }
                                }
                            }
                        }
                    }
                    
                    // Create fire patch if this is a fire arrow (100% chance)
                    if let Some(ammo_item_def) = ammo_item_def_cached.as_ref() {
                        create_fire_patch_if_fire_arrow(ctx, &ammo_item_def, impact_x, impact_y, projectile.owner_id);
                    }
                    
                    // Add projectile to dropped item system (with break chance) like other hits
                    queue_projectile_resolution(
                        &mut pending_resolutions,
                        &projectile,
                        impact_x,
                        impact_y,
                        ProjectileResolvedReason::Impact,
                        ProjectileResolvedTargetKind::Deployable,
                        barrel.id,
                    );
                    missed_projectiles_for_drops.push((projectile.id, projectile.ammo_def_id, impact_x, impact_y));
                    projectiles_to_delete.push(projectile.id);
                    hit_deployable_this_tick = true;
                    break 'barrel_chunks;
                }
            }
        }
        
        if hit_deployable_this_tick {
            continue;
        }
        
        // Check player corpse collisions (chunk-filtered)
        'player_corpse_chunks: for chunk_idx in &chunk_indices[..chunk_count] {
            for corpse in ctx.db.player_corpse().chunk_index().filter(*chunk_idx) {
                if !allows("corpse", corpse.id as u64) { continue; }
                if corpse.health == 0 {
                    continue; // Skip depleted corpses
                }
                
                // Use generous hit radius for corpses and account for Y offset
                const PROJECTILE_CORPSE_HIT_RADIUS: f32 = 25.0; // Generous radius for corpses
                let corpse_hit_y = corpse.pos_y - CORPSE_COLLISION_Y_OFFSET;
                
                // Use line segment collision detection for corpses
                if projectile.flight_3d || line_intersects_circle(prev_x, prev_y, current_x, current_y, corpse.pos_x, corpse_hit_y, PROJECTILE_CORPSE_HIT_RADIUS) {
                    log::info!(
                        "[ProjectileUpdate] Projectile {} from owner {:?} hit Player Corpse {} (player: {:?}) along path from ({:.1}, {:.1}) to ({:.1}, {:.1})",
                        projectile.id, projectile.owner_id, corpse.id, corpse.player_identity, prev_x, prev_y, current_x, current_y
                    );
                    
                    // Apply damage using existing combat system
                    if let Some(weapon_item_def) = weapon_item_def_cached.as_ref() {
                        if let Some(ammo_item_def) = ammo_item_def_cached.as_ref() {
                            let final_damage = calculate_projectile_damage(&weapon_item_def, &ammo_item_def, &projectile, &mut rng);

                            if final_damage > 0.0 {
                                match combat::damage_player_corpse(ctx, projectile.owner_id, corpse.id, final_damage, &weapon_item_def, current_time, &mut rng) {
                                    Ok(attack_result) => {
                                        if attack_result.hit {
                                            log::info!(
                                                "[ProjectileUpdate] Projectile {} dealt {:.1} damage to Player Corpse {}",
                                                projectile.id, final_damage, corpse.id
                                            );
                                            
                                            // Play arrow hit sound for corpse hits
                                            sound_events::emit_arrow_hit_sound(ctx, corpse.pos_x, corpse.pos_y, projectile.owner_id);
                                        }
                                    }
                                    Err(e) => {
                                        log::error!(
                                            "[ProjectileUpdate] Error applying projectile damage to Player Corpse {}: {}",
                                            corpse.id, e
                                        );
                                    }
                                }
                            }
                        }
                    }
                    
                    consume_projectile_on_impact(
                        ctx,
                        &projectile,
                        ammo_item_def_cached.as_ref(),
                        current_x,
                        current_y,
                        &mut missed_projectiles_for_drops,
                        &mut projectiles_to_delete,
                        &mut pending_resolutions,
                    );
                    hit_deployable_this_tick = true;
                    break 'player_corpse_chunks;
                }
            }
        }
        
        if hit_deployable_this_tick {
            continue;
        }
        
        // Check rain collector collisions (chunk-filtered)
        'rain_collector_chunks: for chunk_idx in &chunk_indices[..chunk_count] {
            for rain_collector in ctx.db.rain_collector().chunk_index().filter(*chunk_idx) {
                if !allows("collector", rain_collector.id as u64) { continue; }
                if rain_collector.is_destroyed {
                    continue;
                }
                
                const PROJECTILE_RAIN_COLLECTOR_HIT_RADIUS: f32 = 35.0; // Larger than collision radius (30.0)
                let collector_hit_y = rain_collector.pos_y - RAIN_COLLECTOR_COLLISION_Y_OFFSET;
                
                if projectile.flight_3d || line_intersects_circle(prev_x, prev_y, current_x, current_y, rain_collector.pos_x, collector_hit_y, PROJECTILE_RAIN_COLLECTOR_HIT_RADIUS) {
                    log::info!(
                        "[ProjectileUpdate] Projectile {} from owner {:?} hit Rain Collector {} along path from ({:.1}, {:.1}) to ({:.1}, {:.1})",
                        projectile.id, projectile.owner_id, rain_collector.id, prev_x, prev_y, current_x, current_y
                    );
                    
                    // Apply damage using existing combat system
                    if let Some(weapon_item_def) = weapon_item_def_cached.as_ref() {
                        if let Some(ammo_item_def) = ammo_item_def_cached.as_ref() {
                            let final_damage = calculate_projectile_damage(&weapon_item_def, &ammo_item_def, &projectile, &mut rng);

                            if final_damage > 0.0 {
                                match combat::damage_rain_collector(ctx, projectile.owner_id, rain_collector.id, final_damage, current_time, &mut rng) {
                                    Ok(attack_result) => {
                                        if attack_result.hit {
                                            log::info!(
                                                "[ProjectileUpdate] Projectile {} dealt {:.1} damage to Rain Collector {}",
                                                projectile.id, final_damage, rain_collector.id
                                            );
                                        }
                                    }
                                    Err(e) => {
                                        log::error!(
                                            "[ProjectileUpdate] Error applying projectile damage to Rain Collector {}: {}",
                                            rain_collector.id, e
                                        );
                                    }
                                }
                            }
                        }
                    }
                    
                    // Create fire patch if this is a fire arrow (100% chance)
                    if let Some(ammo_item_def) = ammo_item_def_cached.as_ref() {
                        create_fire_patch_if_fire_arrow(ctx, &ammo_item_def, current_x, current_y, projectile.owner_id);
                    }
                    
                    queue_projectile_resolution(
                        &mut pending_resolutions,
                        &projectile,
                        current_x,
                        current_y,
                        ProjectileResolvedReason::Impact,
                        ProjectileResolvedTargetKind::Deployable,
                        rain_collector.id.into(),
                    );
                    missed_projectiles_for_drops.push((projectile.id, projectile.ammo_def_id, current_x, current_y));
                    projectiles_to_delete.push(projectile.id);
                    hit_deployable_this_tick = true;
                    break 'rain_collector_chunks;
                }
            }
        }
        
        if hit_deployable_this_tick {
            continue;
        }
        
        // Check furnace collisions (chunk-filtered)
        'furnace_chunks: for chunk_idx in &chunk_indices[..chunk_count] {
            for furnace in ctx.db.furnace().chunk_index().filter(*chunk_idx) {
                if !allows("furnace", furnace.id as u64) { continue; }
                if furnace.is_destroyed {
                    continue; // Skip destroyed furnaces
                }
                
                const PROJECTILE_FURNACE_HIT_RADIUS: f32 = 40.0; // Larger than collision radius (35.0)
                let furnace_hit_y = furnace.pos_y - FURNACE_COLLISION_Y_OFFSET;
                
                if projectile.flight_3d || line_intersects_circle(prev_x, prev_y, current_x, current_y, furnace.pos_x, furnace_hit_y, PROJECTILE_FURNACE_HIT_RADIUS) {
                    log::info!(
                        "[ProjectileUpdate] Projectile {} from owner {:?} hit Furnace {} along path from ({:.1}, {:.1}) to ({:.1}, {:.1})",
                        projectile.id, projectile.owner_id, furnace.id, prev_x, prev_y, current_x, current_y
                    );
                    
                    // Apply damage using existing combat system
                    if let Some(weapon_item_def) = weapon_item_def_cached.as_ref() {
                        if let Some(ammo_item_def) = ammo_item_def_cached.as_ref() {
                            let final_damage = calculate_projectile_damage(&weapon_item_def, &ammo_item_def, &projectile, &mut rng);

                            if final_damage > 0.0 {
                                match combat::damage_furnace(ctx, projectile.owner_id, furnace.id, final_damage, current_time, &mut rng) {
                                    Ok(attack_result) => {
                                        if attack_result.hit {
                                            log::info!(
                                                "[ProjectileUpdate] Projectile {} dealt {:.1} damage to Furnace {}",
                                                projectile.id, final_damage, furnace.id
                                            );
                                        }
                                    }
                                    Err(e) => {
                                        log::error!(
                                            "[ProjectileUpdate] Error applying projectile damage to Furnace {}: {}",
                                            furnace.id, e
                                        );
                                    }
                                }
                            }
                        }
                    }
                    
                    // Create fire patch if this is a fire arrow (100% chance)
                    if let Some(ammo_item_def) = ammo_item_def_cached.as_ref() {
                        create_fire_patch_if_fire_arrow(ctx, &ammo_item_def, current_x, current_y, projectile.owner_id);
                    }
                    
                    queue_projectile_resolution(
                        &mut pending_resolutions,
                        &projectile,
                        current_x,
                        current_y,
                        ProjectileResolvedReason::Impact,
                        ProjectileResolvedTargetKind::Deployable,
                        furnace.id.into(),
                    );
                    missed_projectiles_for_drops.push((projectile.id, projectile.ammo_def_id, current_x, current_y));
                    projectiles_to_delete.push(projectile.id);
                    hit_deployable_this_tick = true;
                    break 'furnace_chunks;
                }
            }
        }
        
        if hit_deployable_this_tick {
            continue;
        }
        
        // Check lantern collisions (chunk-filtered)
        'lantern_chunks: for chunk_idx in &chunk_indices[..chunk_count] {
            for lantern in ctx.db.lantern().chunk_index().filter(*chunk_idx) {
                if !allows("lantern", lantern.id as u64) { continue; }
                if lantern.is_destroyed {
                    continue;
                }
                
                let lantern_hit_y = lantern.pos_y - PROJECTILE_LANTERN_Y_OFFSET;
                
                if projectile.flight_3d || line_intersects_circle(prev_x, prev_y, current_x, current_y, lantern.pos_x, lantern_hit_y, PROJECTILE_LANTERN_HIT_RADIUS) {
                    log::info!(
                        "[ProjectileUpdate] Projectile {} from owner {:?} hit Lantern {} along path from ({:.1}, {:.1}) to ({:.1}, {:.1})",
                        projectile.id, projectile.owner_id, lantern.id, prev_x, prev_y, current_x, current_y
                    );
                    
                    // Apply damage using existing combat system
                    if let Some(weapon_item_def) = weapon_item_def_cached.as_ref() {
                        if let Some(ammo_item_def) = ammo_item_def_cached.as_ref() {
                            let final_damage = calculate_projectile_damage(&weapon_item_def, &ammo_item_def, &projectile, &mut rng);

                            if final_damage > 0.0 {
                                match combat::damage_lantern(ctx, projectile.owner_id, lantern.id, final_damage, current_time, &mut rng) {
                                    Ok(attack_result) => {
                                        if attack_result.hit {
                                            log::info!(
                                                "[ProjectileUpdate] Projectile {} dealt {:.1} damage to Lantern {}",
                                                projectile.id, final_damage, lantern.id
                                            );
                                        }
                                    }
                                    Err(e) => {
                                        log::error!(
                                            "[ProjectileUpdate] Error applying projectile damage to Lantern {}: {}",
                                            lantern.id, e
                                        );
                                    }
                                }
                            }
                        }
                    }
                    
                    consume_projectile_on_impact(
                        ctx,
                        &projectile,
                        ammo_item_def_cached.as_ref(),
                        current_x,
                        current_y,
                        &mut missed_projectiles_for_drops,
                        &mut projectiles_to_delete,
                        &mut pending_resolutions,
                    );
                    hit_deployable_this_tick = true;
                    break 'lantern_chunks;
                }
            }
        }
        
        if hit_deployable_this_tick {
            continue;
        }
        
        // Check homestead hearth collisions (chunk-filtered)
        'hearth_chunks: for chunk_idx in &chunk_indices[..chunk_count] {
            for hearth in ctx.db.homestead_hearth().chunk_index().filter(*chunk_idx) {
                if !allows("hearth", hearth.id as u64) { continue; }
                // Check if hearth is destroyed (hearths don't have is_destroyed field, check health instead)
                // Note: HomesteadHearth might not have health field, so we'll check if it exists
                let hearth_hit_y = hearth.pos_y - HEARTH_COLLISION_Y_OFFSET;
                const PROJECTILE_HEARTH_HIT_RADIUS: f32 = 60.0; // Larger than collision radius (55.0)
                
                if projectile.flight_3d || line_intersects_circle(prev_x, prev_y, current_x, current_y, hearth.pos_x, hearth_hit_y, PROJECTILE_HEARTH_HIT_RADIUS) {
                    log::info!(
                        "[ProjectileUpdate] Projectile {} from owner {:?} hit Homestead Hearth {} along path from ({:.1}, {:.1}) to ({:.1}, {:.1})",
                        projectile.id, projectile.owner_id, hearth.id, prev_x, prev_y, current_x, current_y
                    );
                    
                    // Apply damage using existing combat system
                    if let Some(weapon_item_def) = weapon_item_def_cached.as_ref() {
                        if let Some(ammo_item_def) = ammo_item_def_cached.as_ref() {
                            let final_damage = calculate_projectile_damage(&weapon_item_def, &ammo_item_def, &projectile, &mut rng);

                            if final_damage > 0.0 {
                                match crate::homestead_hearth::damage_hearth(ctx, projectile.owner_id, hearth.id, final_damage, current_time) {
                                    Ok(_) => {
                                        log::info!(
                                            "[ProjectileUpdate] Projectile {} dealt {:.1} damage to Homestead Hearth {}",
                                            projectile.id, final_damage, hearth.id
                                        );
                                    }
                                    Err(e) => {
                                        log::error!(
                                            "[ProjectileUpdate] Error applying projectile damage to Homestead Hearth {}: {}",
                                            hearth.id, e
                                        );
                                    }
                                }
                            }
                        }
                    }
                    
                    consume_projectile_on_impact(
                        ctx,
                        &projectile,
                        ammo_item_def_cached.as_ref(),
                        current_x,
                        current_y,
                        &mut missed_projectiles_for_drops,
                        &mut projectiles_to_delete,
                        &mut pending_resolutions,
                    );
                    hit_deployable_this_tick = true;
                    break 'hearth_chunks;
                }
            }
        }
        
        if hit_deployable_this_tick {
            continue;
        }

        // Check turret collisions (chunk-filtered)
        // CRITICAL: Skip the firing turret - turret projectiles spawn AT the turret position,
        // so they would immediately hit themselves without this check.
        const TURRET_SELF_EXCLUSION_RADIUS_SQ: f32 = 80.0 * 80.0; // Skip turrets within 80px of spawn
        'turret_chunks: for chunk_idx in &chunk_indices[..chunk_count] {
            for turret_entity in ctx.db.turret().chunk_index().filter(*chunk_idx) {
                if !allows("turret", turret_entity.id as u64) { continue; }
                if turret_entity.is_destroyed {
                    continue;
                }
                // Turret/NPC projectiles spawn at turret pos - skip the firing turret
                if projectile.source_type == PROJECTILE_SOURCE_TURRET || projectile.source_type == PROJECTILE_SOURCE_MONUMENT_TURRET {
                    let dx = projectile.start_pos_x - turret_entity.pos_x;
                    let dy = projectile.start_pos_y - turret_entity.pos_y;
                    if dx * dx + dy * dy < TURRET_SELF_EXCLUSION_RADIUS_SQ {
                        continue; // This is the firing turret - don't hit ourselves
                    }
                }

                let turret_bounds=crate::collision_geometry::alk_turret_bounds(turret_entity.is_monument,turret_entity.pos_x,turret_entity.pos_y);
                let turret_hit_radius=turret_bounds.half_width;
                let turret_hit_y=turret_bounds.y;

                if projectile.flight_3d || line_intersects_circle(
                    prev_x,
                    prev_y,
                    current_x,
                    current_y,
                    turret_entity.pos_x,
                    turret_hit_y,
                    turret_hit_radius,
                ) {
                    log::info!(
                        "[ProjectileUpdate] Projectile {} from owner {:?} hit Turret {} along path from ({:.1}, {:.1}) to ({:.1}, {:.1})",
                        projectile.id, projectile.owner_id, turret_entity.id, prev_x, prev_y, current_x, current_y
                    );

                    if let Some(weapon_item_def) = weapon_item_def_cached.as_ref() {
                        if let Some(ammo_item_def) = ammo_item_def_cached.as_ref() {
                            let final_damage =
                                calculate_projectile_damage(&weapon_item_def, &ammo_item_def, &projectile, &mut rng);
                            if final_damage > 0.0 {
                                match combat::damage_turret(
                                    ctx,
                                    projectile.owner_id,
                                    turret_entity.id,
                                    final_damage,
                                    current_time,
                                    &mut rng,
                                ) {
                                    Ok(attack_result) => {
                                        if attack_result.hit {
                                            log::info!(
                                                "[ProjectileUpdate] Projectile {} dealt {:.1} damage to Turret {}",
                                                projectile.id, final_damage, turret_entity.id
                                            );
                                        }
                                    }
                                    Err(e) => {
                                        log::error!(
                                            "[ProjectileUpdate] Error applying projectile damage to Turret {}: {}",
                                            turret_entity.id, e
                                        );
                                    }
                                }
                            }
                        }
                    }

                    consume_projectile_on_impact(
                        ctx,
                        &projectile,
                        ammo_item_def_cached.as_ref(),
                        current_x,
                        current_y,
                        &mut missed_projectiles_for_drops,
                        &mut projectiles_to_delete,
                        &mut pending_resolutions,
                    );
                    hit_deployable_this_tick = true;
                    break 'turret_chunks;
                }
            }
        }

        if hit_deployable_this_tick {
            continue;
        }

        // Check barbecue collisions (chunk-filtered)
        'barbecue_chunks: for chunk_idx in &chunk_indices[..chunk_count] {
            for barbecue in ctx.db.barbecue().chunk_index().filter(*chunk_idx) {
                if !allows("barbecue", barbecue.id as u64) { continue; }
                if barbecue.is_destroyed {
                    continue;
                }

                const PROJECTILE_BARBECUE_HIT_RADIUS: f32 = BARBECUE_COLLISION_RADIUS + 8.0;
                let barbecue_hit_y = barbecue.pos_y - BARBECUE_COLLISION_Y_OFFSET;

                if projectile.flight_3d || line_intersects_circle(
                    prev_x,
                    prev_y,
                    current_x,
                    current_y,
                    barbecue.pos_x,
                    barbecue_hit_y,
                    PROJECTILE_BARBECUE_HIT_RADIUS,
                ) {
                    log::info!(
                        "[ProjectileUpdate] Projectile {} from owner {:?} hit Barbecue {} along path from ({:.1}, {:.1}) to ({:.1}, {:.1})",
                        projectile.id, projectile.owner_id, barbecue.id, prev_x, prev_y, current_x, current_y
                    );

                    if let Some(weapon_item_def) = weapon_item_def_cached.as_ref() {
                        if let Some(ammo_item_def) = ammo_item_def_cached.as_ref() {
                            let final_damage =
                                calculate_projectile_damage(&weapon_item_def, &ammo_item_def, &projectile, &mut rng);
                            if final_damage > 0.0 {
                                match combat::damage_barbecue(
                                    ctx,
                                    projectile.owner_id,
                                    barbecue.id,
                                    final_damage,
                                    current_time,
                                    &mut rng,
                                ) {
                                    Ok(attack_result) => {
                                        if attack_result.hit {
                                            log::info!(
                                                "[ProjectileUpdate] Projectile {} dealt {:.1} damage to Barbecue {}",
                                                projectile.id, final_damage, barbecue.id
                                            );
                                        }
                                    }
                                    Err(e) => {
                                        log::error!(
                                            "[ProjectileUpdate] Error applying projectile damage to Barbecue {}: {}",
                                            barbecue.id, e
                                        );
                                    }
                                }
                            }
                        }
                    }

                    consume_projectile_on_impact(
                        ctx,
                        &projectile,
                        ammo_item_def_cached.as_ref(),
                        current_x,
                        current_y,
                        &mut missed_projectiles_for_drops,
                        &mut projectiles_to_delete,
                        &mut pending_resolutions,
                    );
                    hit_deployable_this_tick = true;
                    break 'barbecue_chunks;
                }
            }
        }

        if hit_deployable_this_tick {
            continue;
        }
        
        // Check animal corpse collisions (chunk-filtered)
        'animal_corpse_chunks: for chunk_idx in &chunk_indices[..chunk_count] {
            for animal_corpse in ctx.db.animal_corpse().chunk_index().filter(*chunk_idx) {
                if !allows("animal_corpse", animal_corpse.id as u64) { continue; }
                if animal_corpse.health == 0 {
                    continue; // Skip depleted corpses
                }
                
                const PROJECTILE_ANIMAL_CORPSE_HIT_RADIUS: f32 = 20.0; // Generous radius for animal corpses
                let corpse_hit_y = animal_corpse.pos_y - ANIMAL_CORPSE_COLLISION_Y_OFFSET;
                
                if projectile.flight_3d || line_intersects_circle(prev_x, prev_y, current_x, current_y, animal_corpse.pos_x, corpse_hit_y, PROJECTILE_ANIMAL_CORPSE_HIT_RADIUS) {
                    log::info!(
                        "[ProjectileUpdate] Projectile {} from owner {:?} hit Animal Corpse {} along path from ({:.1}, {:.1}) to ({:.1}, {:.1})",
                        projectile.id, projectile.owner_id, animal_corpse.id, prev_x, prev_y, current_x, current_y
                    );
                    
                    // Apply damage using existing combat system
                    if let Some(weapon_item_def) = weapon_item_def_cached.as_ref() {
                        if let Some(ammo_item_def) = ammo_item_def_cached.as_ref() {
                            let final_damage = calculate_projectile_damage(&weapon_item_def, &ammo_item_def, &projectile, &mut rng);

                            if final_damage > 0.0 {
                                match combat::damage_animal_corpse(ctx, projectile.owner_id, animal_corpse.id, final_damage, &weapon_item_def, current_time, &mut rng) {
                                    Ok(attack_result) => {
                                        if attack_result.hit {
                                            log::info!(
                                                "[ProjectileUpdate] Projectile {} dealt {:.1} damage to Animal Corpse {}",
                                                projectile.id, final_damage, animal_corpse.id
                                            );
                                            
                                            // Play arrow hit sound for animal corpse hits
                                            sound_events::emit_arrow_hit_sound(ctx, animal_corpse.pos_x, animal_corpse.pos_y, projectile.owner_id);
                                        }
                                    }
                                    Err(e) => {
                                        log::error!(
                                            "[ProjectileUpdate] Error applying projectile damage to Animal Corpse {}: {}",
                                            animal_corpse.id, e
                                        );
                                    }
                                }
                            }
                        }
                    }
                    
                    consume_projectile_on_impact(
                        ctx,
                        &projectile,
                        ammo_item_def_cached.as_ref(),
                        current_x,
                        current_y,
                        &mut missed_projectiles_for_drops,
                        &mut projectiles_to_delete,
                        &mut pending_resolutions,
                    );
                    hit_deployable_this_tick = true;
                    break 'animal_corpse_chunks;
                }
            }
        }
        
        if hit_deployable_this_tick {
            continue;
        }

        log::debug!("DEBUG: Projectile {} checking wild animal collisions at ({:.1}, {:.1})", projectile.id, current_x, current_y);

        // Check wild animal collisions first
        let mut hit_wild_animal_this_tick = false;
        
        // NPC projectiles should NOT hit wild animals at all - they're meant for players only
        // This prevents self-collision and friendly fire issues
        if projectile.source_type != PROJECTILE_SOURCE_NPC {
        'wild_animal_chunks: for chunk_idx in &chunk_indices[..chunk_count] {
        for wild_animal in ctx.db.wild_animal().chunk_index().filter(*chunk_idx) {
            if !allows("animal", wild_animal.id as u64) { continue; }
            // Skip dead animals or animals that are burrowed
            if wild_animal.health <= 0.0 || wild_animal.state == crate::wild_animal_npc::AnimalState::Burrowed {
                continue;
            }
            
            // Use line segment collision detection for wild animals
            const WILD_ANIMAL_HIT_RADIUS: f32 = 32.0; // Legacy planar projectiles
            let collision_impact = selected_impact(projectile.flight_3d, current_x, current_y, line_circle_first_impact_point(
                prev_x,
                prev_y,
                current_x,
                current_y,
                wild_animal.pos_x,
                wild_animal.pos_y,
                WILD_ANIMAL_HIT_RADIUS,
            ));
            let collision_impact = if projectile.flight_3d && collision_impact.is_some() { Some((current_x, current_y)) } else { collision_impact };
            let collision_detected = collision_impact.is_some();
            
            // Debug logging for nearby collisions
            if (prev_x - wild_animal.pos_x).abs() < 100.0 && (prev_y - wild_animal.pos_y).abs() < 100.0 {
                log::debug!("DEBUG: Checking collision for projectile {} with wild animal {}. Path: ({:.1},{:.1}) -> ({:.1},{:.1}), Animal: ({:.1},{:.1}), Radius: {:.1}, Collision: {}", 
                    projectile.id, wild_animal.id, 
                    prev_x, prev_y, current_x, current_y, 
                    wild_animal.pos_x, wild_animal.pos_y, 
                    WILD_ANIMAL_HIT_RADIUS, collision_detected);
            }
            
            if collision_detected {
                log::info!("Projectile {} from owner {:?} hit wild animal {} along path from ({:.1}, {:.1}) to ({:.1}, {:.1})", 
                         projectile.id, projectile.owner_id, wild_animal.id, prev_x, prev_y, current_x, current_y);
                
                // Monument turret projectiles: instant-kill, no item def lookup needed
                if projectile.source_type == PROJECTILE_SOURCE_MONUMENT_TURRET {
                    let final_damage = crate::turret::MONUMENT_TURRET_DAMAGE;
                    log::info!("Monument turret projectile {} one-shot wild animal {} for {:.0} damage", projectile.id, wild_animal.id, final_damage);
                    
                    match crate::wild_animal_npc::damage_wild_animal_with_weapon(ctx, wild_animal.id, final_damage, projectile.owner_id, Some("Monument Turret")) {
                        Ok(_) => {
                            sound_events::emit_arrow_hit_sound(ctx, wild_animal.pos_x, wild_animal.pos_y, projectile.owner_id);
                        }
                        Err(e) => {
                            log::error!("Error applying monument turret damage to wild animal {}: {}", wild_animal.id, e);
                        }
                    }
                    
                    let (impact_x, impact_y) = collision_impact.unwrap_or((current_x, current_y));
                    create_fire_patch_if_turret_tallow(ctx, &projectile, impact_x, impact_y);
                    
                    // Monument turret projectiles don't create drops
                    queue_projectile_resolution(
                        &mut pending_resolutions,
                        &projectile,
                        impact_x,
                        impact_y,
                        ProjectileResolvedReason::Impact,
                        ProjectileResolvedTargetKind::Animal,
                        wild_animal.id,
                    );
                    projectiles_to_delete.push(projectile.id);
                    hit_wild_animal_this_tick = true;
                    break 'wild_animal_chunks;
                }
                
                // Get weapon and ammunition definitions for damage calculation
                let weapon_item_def = match weapon_item_def_cached.as_ref() {
                    Some(def) => def,
                    None => {
                        log::error!("[UpdateProjectiles] ItemDefinition not found for projectile's weapon (ID: {}). Cannot apply damage to wild animal.", projectile.item_def_id);
                        queue_projectile_resolution(
                            &mut pending_resolutions,
                            &projectile,
                            current_x,
                            current_y,
                            ProjectileResolvedReason::Dissipated,
                            ProjectileResolvedTargetKind::Animal,
                            wild_animal.id,
                        );
                        projectiles_to_delete.push(projectile.id);
                        hit_wild_animal_this_tick = true;
                        break 'wild_animal_chunks;
                    }
                };

                let ammo_item_def = match ammo_item_def_cached.as_ref() {
                    Some(def) => def,
                    None => {
                        log::error!("[UpdateProjectiles] ItemDefinition not found for projectile's ammunition (ID: {}). Cannot apply damage to wild animal.", projectile.ammo_def_id);
                        queue_projectile_resolution(
                            &mut pending_resolutions,
                            &projectile,
                            current_x,
                            current_y,
                            ProjectileResolvedReason::Dissipated,
                            ProjectileResolvedTargetKind::Animal,
                            wild_animal.id,
                        );
                        projectiles_to_delete.push(projectile.id);
                        hit_wild_animal_this_tick = true;
                        break;
                    }
                };

                // Calculate damage using the centralized helper function
                let final_damage = calculate_projectile_damage(&weapon_item_def, &ammo_item_def, &projectile, &mut rng);

                log::info!("Projectile damage to wild animal: Weapon '{}' + Ammo '{}' = {:.1} total damage",
                         weapon_item_def.name, ammo_item_def.name, final_damage);

                // Apply damage to wild animal (with weapon tracking for achievements)
                match crate::wild_animal_npc::damage_wild_animal_with_weapon(ctx, wild_animal.id, final_damage, projectile.owner_id, Some(&weapon_item_def.name)) {
                    Ok(_) => {
                        log::info!("Projectile from {:?} (weapon: {} + ammo: {}) dealt {:.1} damage to wild animal {}.", 
                                 projectile.owner_id, weapon_item_def.name, ammo_item_def.name, final_damage, wild_animal.id);
                        
                        // Play arrow hit sound for wild animal hits
                        sound_events::emit_arrow_hit_sound(ctx, wild_animal.pos_x, wild_animal.pos_y, projectile.owner_id);
                        
                        // NPC RANGED COUNTER-ATTACK: Certain hostile NPCs fire back when hit by ranged weapons
                        // This prevents players from safely griefing them from range
                        if let Some(attacker) = ctx.db.player().identity().find(&projectile.owner_id) {
                            if let Err(e) = crate::wild_animal_npc::try_npc_ranged_counter_attack(
                                ctx,
                                wild_animal.id,
                                attacker.position_x,
                                attacker.position_y,
                            ) {
                                log::error!("Error in NPC ranged counter-attack: {}", e);
                            }
                        }
                    }
                    Err(e) => {
                        log::error!("Error applying projectile damage to wild animal {}: {}", wild_animal.id, e);
                    }
                }

                // Create fire patch if this is a fire arrow (100% chance)
                let (impact_x, impact_y) = collision_impact.unwrap_or((current_x, current_y));
                create_fire_patch_if_fire_arrow(ctx, &ammo_item_def, impact_x, impact_y, projectile.owner_id);
                
                // Create fire patch if this is a turret tallow projectile (25% chance)
                create_fire_patch_if_turret_tallow(ctx, &projectile, impact_x, impact_y);

                // Turret projectiles (player + monument) explode on impact and don't become dropped items
                // Add projectile to dropped item system (with break chance) like other hits
                queue_projectile_resolution(
                    &mut pending_resolutions,
                    &projectile,
                    impact_x,
                    impact_y,
                    ProjectileResolvedReason::Impact,
                    ProjectileResolvedTargetKind::Animal,
                    wild_animal.id,
                );
                if projectile.source_type != PROJECTILE_SOURCE_TURRET && projectile.source_type != PROJECTILE_SOURCE_MONUMENT_TURRET {
                    missed_projectiles_for_drops.push((projectile.id, projectile.ammo_def_id, impact_x, impact_y));
                }
                projectiles_to_delete.push(projectile.id);
                hit_wild_animal_this_tick = true;
                break; // Projectile hits one animal and is consumed
            }
        }
        }
        } // End of NPC projectile exclusion block
        
        if hit_wild_animal_this_tick {
            continue; // Move to the next projectile if this one hit a wild animal
        }

        log::debug!("DEBUG: Projectile {} checking player collisions at ({:.1}, {:.1})", projectile.id, current_x, current_y);

        // Check living player collisions
        let mut hit_player_this_tick = false;
        for player_to_check in ctx.db.player().iter() {
            if projectile.flight_3d && first_hit.map(|hit| hit.0) != Some(FlightHit::Player(player_to_check.identity)) { continue; }
            if player_to_check.identity == projectile.owner_id || player_to_check.is_dead {
                continue; // Skip self and dead players (corpses handled above)
            }
            
            // Use line segment collision detection for players
            // NPC projectiles use a larger collision radius for reliable hits:
            // - Fast projectiles (450-550 px/s) can travel far between ticks
            // - Network latency means player positions may be slightly stale
            // - 64px radius = 2x normal player radius for forgiving but fair collision
            // Player-fired projectiles also use a slightly expanded hit radius for better PvP feel.
            let player_radius = if projectile.source_type == PROJECTILE_SOURCE_NPC {
                PROJECTILE_NPC_PLAYER_HIT_RADIUS
            } else {
                PROJECTILE_PLAYER_HIT_RADIUS
            };
            let collision_detected = projectile.flight_3d || line_intersects_circle(prev_x, prev_y, current_x, current_y, player_to_check.position_x, player_to_check.position_y, player_radius);
            
            // Debug logging for nearby collisions
            if (prev_x - player_to_check.position_x).abs() < 100.0 && (prev_y - player_to_check.position_y).abs() < 100.0 {
                log::debug!("DEBUG: Checking collision for projectile {} with living player {:?}. Path: ({:.1},{:.1}) -> ({:.1},{:.1}), Player: ({:.1},{:.1}), Radius: {:.1}, Collision: {}", 
                    projectile.id, player_to_check.identity, 
                    prev_x, prev_y, current_x, current_y, 
                    player_to_check.position_x, player_to_check.position_y, 
                    player_radius, collision_detected);
            }
            
            if collision_detected {
                // === NPC PROJECTILE HANDLING ===
                // NPC projectiles use a different damage system - damage is encoded in ammo_def_id
                if projectile.source_type == PROJECTILE_SOURCE_NPC {
                    log::info!("[NPC Projectile] Hit player {:?} at ({:.1}, {:.1})", 
                             player_to_check.identity, current_x, current_y);
                    
                    // <<< SAFE ZONE CHECK - Players in safe zones are immune to NPC projectile damage >>>
                    if crate::indoors::is_position_indoors(ctx, player_to_check.position_x, player_to_check.position_y)
                        || crate::active_effects::player_has_safe_zone_effect(ctx, player_to_check.identity) {
                        log::info!("[NPC Projectile] Blocked - Target player {:?} is in a safe zone", 
                            player_to_check.identity);
                        projectiles_to_delete.push(projectile.id);
                        hit_player_this_tick = true;
                        break;
                    }
                    // <<< END SAFE ZONE CHECK >>>
                    
                    // Get damage from encoded ammo_def_id
                    let npc_damage = get_npc_projectile_damage(&projectile);
                    
                    // Apply damage directly (NPC projectiles bypass armor for simplicity)
                    if let Some(mut target_player) = ctx.db.player().identity().find(&player_to_check.identity) {
                        if !target_player.is_dead {
                            target_player.health = (target_player.health - npc_damage).max(0.0);
                            target_player.last_hit_time = Some(current_time);
                            
                            // Check for death - use centralized death handler
                            if target_player.health <= 0.0 {
                                // Determine death cause from projectile type
                                let death_cause = match projectile.npc_projectile_type {
                                    NPC_PROJECTILE_SPECTRAL_SHARD => "The Shardkin",
                                    NPC_PROJECTILE_SPECTRAL_BOLT => "The Shorebound", 
                                    NPC_PROJECTILE_VENOM_SPITTLE => "Cable Viper",
                                    _ => "Unknown Creature",
                                };
                                
                                // Update health first (handle_player_death will set is_dead)
                                ctx.db.player().identity().update(target_player);
                                
                                // Use centralized death handler - handles everything
                                if let Err(e) = crate::player_corpse::handle_player_death(
                                    ctx,
                                    player_to_check.identity,
                                    death_cause,
                                    None, // No killer identity for NPC kills
                                ) {
                                    log::error!("[NPC Projectile] Death handling failed for player {:?}: {}", player_to_check.identity, e);
                                }
                            } else {
                                ctx.db.player().identity().update(target_player);
                            }
                            
                            // Play hit sound
                            sound_events::emit_arrow_hit_sound(ctx, player_to_check.position_x, player_to_check.position_y, ctx.identity());
                            
                            log::info!("[NPC Projectile] Dealt {:.1} damage to player {:?} (type: {})", 
                                     npc_damage, player_to_check.identity, projectile.npc_projectile_type);
                            
                            // VENOM SPITTLE: Apply venom effect if this is a viper projectile
                            if projectile.npc_projectile_type == NPC_PROJECTILE_VENOM_SPITTLE {
                                if let Err(e) = crate::active_effects::apply_venom_effect(
                                    ctx,
                                    player_to_check.identity,
                                    f32::MAX, // Infinite damage pool - only cured by Anti-Venom
                                    86400.0 * 365.0, // 1 year (effectively permanent)
                                    5.0, // Tick every 5 seconds
                                ) {
                                    log::error!("Failed to apply venom from NPC projectile: {}", e);
                                } else {
                                    log::info!("[NPC Projectile] Applied venom effect to player {:?} from viper spit", 
                                             player_to_check.identity);
                                }
                            }
                        }
                    }
                    
                    // NPC projectiles don't become dropped items
                    projectiles_to_delete.push(projectile.id);
                    hit_player_this_tick = true;
                    break;
                }
                // === END NPC PROJECTILE HANDLING ===
                
                // === PROJECTILE DIAGNOSTIC LOGGING ===
                // Calculate distance from shooter to target for fairness analysis
                if let Some(shooter) = ctx.db.player().identity().find(&projectile.owner_id) {
                    let shooter_to_target_dx = player_to_check.position_x - shooter.position_x;
                    let shooter_to_target_dy = player_to_check.position_y - shooter.position_y;
                    let shooter_to_target_distance = (shooter_to_target_dx * shooter_to_target_dx + shooter_to_target_dy * shooter_to_target_dy).sqrt();
                    
                    // Log the engagement distance for ranged combat analysis
                    log::info!(
                        "[COMBAT_DIAGNOSTIC] RANGED_HIT: Player {:?} hit {:?} with projectile at distance {:.1}px. Projectile traveled from ({:.1}, {:.1}) to ({:.1}, {:.1})",
                        projectile.owner_id, player_to_check.identity, shooter_to_target_distance,
                        prev_x, prev_y, current_x, current_y
                    );
                }
                // === END PROJECTILE DIAGNOSTIC LOGGING ===
                
                log::info!("Projectile {} from owner {:?} hit living player {:?} along path from ({:.1}, {:.1}) to ({:.1}, {:.1}) with collision radius ({:.1})", 
                         projectile.id, projectile.owner_id, player_to_check.identity, prev_x, prev_y, current_x, current_y, player_radius);
                
                // Monument turret projectiles: instant-kill players, no item def lookup needed
                if projectile.source_type == PROJECTILE_SOURCE_MONUMENT_TURRET {
                    // CRITICAL: Re-verify PvP status at projectile impact time.
                    // Only hit players who are EXPLICITLY PvP-flagged right now.
                    // If a player toggled PvP off between turret firing and projectile arrival, skip them.
                    if !crate::combat::is_pvp_active_for_player(&player_to_check, current_time) {
                        log::info!("[MonumentTurret] Projectile {} passed through non-PvP player {:?} (PvP disabled since firing)", 
                                 projectile.id, player_to_check.identity);
                        continue; // Skip this player, projectile continues traveling
                    }
                    
                    let final_damage = crate::turret::MONUMENT_TURRET_DAMAGE;
                    log::info!("Monument turret projectile {} one-shot PvP-flagged player {:?} for {:.0} damage", projectile.id, player_to_check.identity, final_damage);
                    
                    // Apply massive damage directly - will kill any player
                    if let Some(mut target_player) = ctx.db.player().identity().find(&player_to_check.identity) {
                        target_player.health = (target_player.health - final_damage).max(0.0);
                        target_player.last_hit_time = Some(current_time);
                        
                        if target_player.health <= 0.0 {
                            ctx.db.player().identity().update(target_player);
                            if let Err(e) = crate::player_corpse::handle_player_death(
                                ctx,
                                player_to_check.identity,
                                "Monument Defense Turret",
                                None, // No killer identity (system turret)
                            ) {
                                log::error!("[MonumentTurret] Death handling failed for player {:?}: {}", player_to_check.identity, e);
                            }
                        } else {
                            ctx.db.player().identity().update(target_player);
                        }
                        
                        sound_events::emit_arrow_hit_sound(ctx, player_to_check.position_x, player_to_check.position_y, projectile.owner_id);
                    }
                    
                    create_fire_patch_if_turret_tallow(ctx, &projectile, player_to_check.position_x, player_to_check.position_y);
                    
                    projectiles_to_delete.push(projectile.id);
                    hit_player_this_tick = true;
                    break;
                }
                
                // --- IMPROVED: Use combined weapon + ammunition damage ---
                // Get weapon definition for base damage
                let weapon_item_def = match weapon_item_def_cached.as_ref() {
                    Some(def) => def,
                    None => {
                        log::error!("[UpdateProjectiles] ItemDefinition not found for projectile's weapon (ID: {}). Cannot apply damage.", projectile.item_def_id);
                        queue_projectile_resolution(
                            &mut pending_resolutions,
                            &projectile,
                            current_x,
                            current_y,
                            ProjectileResolvedReason::Dissipated,
                            ProjectileResolvedTargetKind::Player,
                            0,
                        );
                        projectiles_to_delete.push(projectile.id); // Delete projectile if weapon def is missing
                        hit_player_this_tick = true; // Mark as handled to prevent further processing for this projectile
                        break; // Stop checking other players for this projectile
                    }
                };

                // Get ammunition definition for damage calculation
                let ammo_item_def = match ammo_item_def_cached.as_ref() {
                    Some(def) => def,
                    None => {
                        log::error!("[UpdateProjectiles] ItemDefinition not found for projectile's ammunition (ID: {}). Cannot apply damage.", projectile.ammo_def_id);
                        queue_projectile_resolution(
                            &mut pending_resolutions,
                            &projectile,
                            current_x,
                            current_y,
                            ProjectileResolvedReason::Dissipated,
                            ProjectileResolvedTargetKind::Player,
                            0,
                        );
                        projectiles_to_delete.push(projectile.id); // Delete projectile if ammo def is missing
                        hit_player_this_tick = true; // Mark as handled to prevent further processing for this projectile
                        break; // Stop checking other players for this projectile
                    }
                };

                // <<< SAFE ZONE CHECK - Players in safe zones are immune to projectile damage >>>
                if crate::active_effects::player_has_safe_zone_effect(ctx, player_to_check.identity) {
                    log::info!("Projectile from {:?} blocked - Target player {:?} is in a safe zone", 
                        projectile.owner_id, player_to_check.identity);
                    // Still delete the projectile since it hit (but didn't damage)
                    queue_projectile_resolution(
                        &mut pending_resolutions,
                        &projectile,
                        current_x,
                        current_y,
                        ProjectileResolvedReason::Impact,
                        ProjectileResolvedTargetKind::Player,
                        0,
                    );
                    if ctx.db.thrown_projectile_item().projectile_id().find(projectile.id).is_some() {
                        missed_projectiles_for_drops.push((projectile.id, projectile.ammo_def_id, current_x, current_y));
                    }
                    projectiles_to_delete.push(projectile.id);
                    hit_player_this_tick = true;
                    break; // Stop checking other players for this projectile
                }
                // <<< END SAFE ZONE CHECK >>>

                // Calculate damage using the centralized helper function
                let final_damage = calculate_projectile_damage(&weapon_item_def, &ammo_item_def, &projectile, &mut rng);

                log::info!("Projectile damage calculation: Weapon '{}' + Ammo '{}' = {:.1} total damage",
                         weapon_item_def.name, ammo_item_def.name, final_damage);

                // Apply combined damage via combat::damage_player
                // IMPORTANT: Pass weapon_item_def (not ammo) for damage type - bows/crossbows have DamageType::Projectile
                match combat::damage_player(ctx, projectile.owner_id, player_to_check.identity, final_damage, &weapon_item_def, current_time) {
                    Ok(attack_result) => {
                        if attack_result.hit {
                            log::info!("Projectile from {:?} (weapon: {} + ammo: {}) dealt {:.1} damage to player {:?}.", 
                                     projectile.owner_id, weapon_item_def.name, ammo_item_def.name, final_damage, player_to_check.identity);
                            
                            // Play arrow hit sound for living player hits
                            sound_events::emit_arrow_hit_sound(ctx, player_to_check.position_x, player_to_check.position_y, projectile.owner_id);
                            
                            // Apply ammunition-based bleed/burn effects
                            if let Err(e) = apply_projectile_bleed_effect(ctx, player_to_check.identity, &ammo_item_def, current_time) {
                                log::error!("Error applying projectile bleed effect for ammo '{}' on player {:?}: {}", 
                                    ammo_item_def.name, player_to_check.identity, e);
                            }

                            // Apply fire arrow burn effects (checks for wet immunity internally)
                            if let Err(e) = apply_projectile_burn_effect(ctx, player_to_check.identity, &ammo_item_def, current_time) {
                                log::error!("Error applying projectile burn effect for ammo '{}' on player {:?}: {}", 
                                    ammo_item_def.name, player_to_check.identity, e);
                            }
                            
                            // Apply venom arrow/dart effects (requires anti-venom to cure)
                            if let Err(e) = apply_projectile_venom_effect(ctx, player_to_check.identity, &ammo_item_def, current_time) {
                                log::error!("Error applying projectile venom effect for ammo '{}' on player {:?}: {}", 
                                    ammo_item_def.name, player_to_check.identity, e);
                            }
                            
                            // <<< STUN EFFECT: Thrown blunt weapons can stun targets >>>
                            if weapon_item_def.damage_type == Some(crate::models::DamageType::Blunt) {
                                let was_stunned = crate::active_effects::try_apply_blunt_weapon_stun(
                                    ctx,
                                    projectile.owner_id,
                                    player_to_check.identity,
                                    &weapon_item_def.name,
                                );
                                if was_stunned {
                                    log::info!(
                                        "[Stun] Player {:?} was STUNNED by thrown {} from {:?}!",
                                        player_to_check.identity, weapon_item_def.name, projectile.owner_id
                                    );
                                }
                            }
                            // <<< END STUN EFFECT >>>
                            
                            // Create fire patch if this is a fire arrow (100% chance)
                            create_fire_patch_if_fire_arrow(ctx, &ammo_item_def, player_to_check.position_x, player_to_check.position_y, projectile.owner_id);
                            
                            // Create fire patch if this is a turret tallow projectile (25% chance)
                            create_fire_patch_if_turret_tallow(ctx, &projectile, player_to_check.position_x, player_to_check.position_y);
                        } else {
                            log::info!("Projectile from {:?} (weapon: {} + ammo: {}) hit player {:?}, but combat::damage_player reported no effective damage (e.g., target already dead).", 
                                     projectile.owner_id, weapon_item_def.name, ammo_item_def.name, player_to_check.identity);
                        }
                    }
                    Err(e) => {
                        log::error!("Error calling combat::damage_player for projectile hit from {:?} on {:?}: {}", 
                                 projectile.owner_id, player_to_check.identity, e);
                        // Even if damage_player fails, we should consume the projectile.
                    }
                }
                // --- End Improved Combined Damage System ---

                // Turret projectiles (player + monument) explode on impact and don't become dropped items
                // Add projectile to dropped item system (with break chance) like other hits
                queue_projectile_resolution(
                    &mut pending_resolutions,
                    &projectile,
                    current_x,
                    current_y,
                    ProjectileResolvedReason::Impact,
                    ProjectileResolvedTargetKind::Player,
                    0,
                );
                if projectile.source_type != PROJECTILE_SOURCE_TURRET && projectile.source_type != PROJECTILE_SOURCE_MONUMENT_TURRET {
                    missed_projectiles_for_drops.push((projectile.id, projectile.ammo_def_id, current_x, current_y));
                }
                projectiles_to_delete.push(projectile.id);
                hit_player_this_tick = true;
                break; // Projectile hits one player and is consumed
            }
        }
        
        if hit_player_this_tick {
            continue; // Move to the next projectile if this one hit someone
        }

        if expired {
            if let Some(ammo_def) = ammo_item_def_cached.as_ref() {
                create_fire_patch_if_fire_arrow(ctx, ammo_def, current_x, current_y, projectile.owner_id);
            }
            queue_projectile_resolution(&mut pending_resolutions, &projectile, current_x, current_y,
                ProjectileResolvedReason::RangeExpired, ProjectileResolvedTargetKind::World, 0);
            missed_projectiles_for_drops.push((projectile.id, projectile.ammo_def_id, current_x, current_y));
            projectiles_to_delete.push(projectile.id);
            continue;
        }

        if let Some(mut runtime_state) = runtime_state {
            runtime_state.last_sample_elapsed_secs = elapsed_time as f32;
            ctx.db.projectile_runtime_state().projectile_id().update(runtime_state);
        } else {
            ctx.db.projectile_runtime_state().insert(ProjectileRuntimeState {
                projectile_id: projectile.id,
                last_sample_elapsed_secs: elapsed_time as f32,
            });
        }
    }

    let mut created_drop_projectiles = std::collections::HashSet::new();
    let mut broken_projectiles = std::collections::HashSet::new();

    // Create dropped items for missed projectiles (with different break chances)
    for (projectile_id, ammo_def_id, pos_x, pos_y) in missed_projectiles_for_drops {
        // Check if this is a turret projectile - they explode on impact and never become dropped items
        let projectile_record = ctx.db.projectile().id().find(&projectile_id);
        let is_turret_projectile = projectile_record
            .as_ref()
            .map(|p| p.source_type == PROJECTILE_SOURCE_TURRET || p.source_type == PROJECTILE_SOURCE_MONUMENT_TURRET)
            .unwrap_or(false);
        
        let is_npc_projectile = projectile_record
            .as_ref()
            .map(|p| p.source_type == PROJECTILE_SOURCE_NPC)
            .unwrap_or(false);
        
        if is_turret_projectile {
            // Turret tallow projectiles explode on impact - no dropped item created
            log::debug!("[ProjectileMiss] Turret projectile {} exploded on impact at ({:.1}, {:.1})", 
                projectile_id, pos_x, pos_y);
            continue; // Skip creating dropped item - tallow explodes
        }
        
        if is_npc_projectile {
            // NPC projectiles (spectral shards, venom, etc.) dissipate - no dropped item
            log::debug!("[ProjectileMiss] NPC projectile {} dissipated at ({:.1}, {:.1})", 
                projectile_id, pos_x, pos_y);
            continue; // Skip creating dropped item - NPC projectiles are magical/ethereal
        }
        
        // Get the ammunition definition for break chance calculation
        let ammo_item_def = item_defs_table.id().find(ammo_def_id);
        let ammo_name = ammo_item_def
            .as_ref()
            .map(|def| def.name.clone())
            .unwrap_or_else(|| format!("Unknown (ID: {})", ammo_def_id));
        
        // Check if this is a bullet (bullets always break on impact, never become dropped items)
        let is_bullet = ammo_item_def
            .as_ref()
            .map(|def| def.ammo_type == Some(crate::models::AmmoType::Bullet))
            .unwrap_or(false);
        
        if is_bullet {
            // Bullets always break on impact - no dropped item created
            log::debug!("[ProjectileMiss] Bullet '{}' (def_id: {}) broke on impact at ({:.1}, {:.1})", 
                ammo_name, ammo_def_id, pos_x, pos_y);
            broken_projectiles.insert(projectile_id);
            continue; // Skip creating dropped item - bullet is destroyed
        }
        
        let projectile_record = ctx.db.projectile().id().find(&projectile_id);
        
        // Grenade and Flare never break on impact - they always land as dropped items with timer metadata
        let is_grenade_or_flare = ammo_item_def
            .as_ref()
            .map(|def| def.name == "Grenade" || def.name == "Flare")
            .unwrap_or(false);

        // Different break chances: 0% for grenade/flare, 15% for arrows and other projectiles
        let break_chance = if is_grenade_or_flare {
            0.0
        } else {
            0.15 // 15% chance for arrows and other projectiles to break
        };
        
        if rng.gen::<f32>() < break_chance {
            log::info!("[ProjectileMiss] Projectile {} broke on impact - '{}' (def_id: {}) destroyed at ({:.1}, {:.1})", 
                     projectile_id, ammo_name, ammo_def_id, pos_x, pos_y);

            let sound_source_identity = projectile_record
                .as_ref()
                .map(|p| p.owner_id)
                .unwrap_or(ctx.identity());
            sound_events::emit_break_item_sound(ctx, pos_x, pos_y, sound_source_identity);
            
            // Create arrow break event for client particle effect
            let break_event = ArrowBreakEvent {
                id: 0, // auto_inc
                pos_x,
                pos_y,
                timestamp: ctx.timestamp,
            };
            ctx.db.arrow_break_event().insert(break_event);
            broken_projectiles.insert(projectile_id);
            
            continue; // Skip creating dropped item - projectile is destroyed
        }
        
        // Build item_data for Grenade (fuse) and Flare (light duration) - they become dropped items with timers
        let projectile_record_for_owner = ctx.db.projectile().id().find(&projectile_id);
        let grenade_owner_hex = projectile_record_for_owner
            .map(|p| p.owner_id.to_string())
            .unwrap_or_else(|| "unknown".to_string());
        let thrown_data = ctx.db.thrown_projectile_item().projectile_id().find(projectile_id);
        let is_thrown_weapon = thrown_data.is_some();
        let item_data = if let Some(thrown) = thrown_data {
            thrown.item_data
        } else if let Some(ref def) = ammo_item_def {
            if def.name == "Grenade" {
                let fuse_duration_secs = 5.0 + (rng.gen::<f32>() * 5.0); // 5-10 seconds
                let detonates_at = ctx.timestamp.to_micros_since_unix_epoch() as f64 / 1_000_000.0 + fuse_duration_secs as f64;
                Some(format!(
                    r#"{{"fuse_started_at":{},"fuse_duration_secs":{},"fuse_detonates_at":{},"fuse_thrower":"{}"}}"#,
                    ctx.timestamp.to_micros_since_unix_epoch() as f64 / 1_000_000.0,
                    fuse_duration_secs,
                    detonates_at,
                    grenade_owner_hex
                ))
            } else if def.name == "Flare" {
                const FLARE_DURATION_SECS: f64 = 120.0;
                let started_at = ctx.timestamp.to_micros_since_unix_epoch() as f64 / 1_000_000.0;
                let expires_at = started_at + FLARE_DURATION_SECS;
                Some(format!(
                    r#"{{"flare_started_at":{},"flare_duration_secs":{},"flare_expires_at":{}}}"#,
                    started_at,
                    FLARE_DURATION_SECS,
                    expires_at
                ))
            } else {
                None
            }
        } else {
            None
        };
        
        let create_result = if let Some(ref data) = item_data {
            dropped_item::create_dropped_item_entity_with_data(ctx, ammo_def_id, 1, pos_x, pos_y, Some(data.clone()))
        } else {
            dropped_item::create_dropped_item_entity(ctx, ammo_def_id, 1, pos_x, pos_y)
        };
        
        match create_result {
            Ok(_) => {
                log::info!("[ProjectileMiss] Created dropped '{}' (def_id: {}) at ({:.1}, {:.1}) for missed projectile {}", 
                         ammo_name, ammo_def_id, pos_x, pos_y, projectile_id);
                created_drop_projectiles.insert(projectile_id);
            }
            Err(e) => {
                if is_thrown_weapon { return Err(format!("Could not land thrown weapon: {e}")); }
                log::error!("[ProjectileMiss] Failed to create dropped '{}' for missed projectile {}: {}", 
                          ammo_name, projectile_id, e);
            }
        }
    }

    for resolution in &pending_resolutions {
        let reason = if broken_projectiles.contains(&resolution.projectile_id) {
            ProjectileResolvedReason::Broken
        } else {
            resolution.reason
        };

        ctx.db.projectile_resolved_event().insert(ProjectileResolvedEvent {
            id: 0,
            projectile_id: resolution.projectile_id,
            client_shot_id: resolution.client_shot_id.clone(),
            pos_x: resolution.pos_x,
            pos_y: resolution.pos_y,
            reason,
            target_kind: resolution.target_kind,
            target_id: resolution.target_id,
            created_dropped_item: created_drop_projectiles.contains(&resolution.projectile_id),
            timestamp: ctx.timestamp,
        });
    }

    let resolved_event_table = ctx.db.projectile_resolved_event();
    let resolved_event_cutoff = ctx.timestamp - TimeDuration::from_micros(PROJECTILE_RESOLVED_EVENT_RETENTION_MICROS);
    let expired_resolved_event_ids: Vec<u64> = resolved_event_table
        .iter()
        .filter(|event| event.timestamp < resolved_event_cutoff)
        .map(|event| event.id)
        .collect();
    for event_id in expired_resolved_event_ids {
        resolved_event_table.id().delete(event_id);
    }

    // Delete all projectiles that need to be removed
    for projectile_id in projectiles_to_delete {
        ctx.db.thrown_projectile_item().projectile_id().delete(&projectile_id);
        ctx.db.projectile_runtime_state().projectile_id().delete(&projectile_id);
        ctx.db.projectile().id().delete(&projectile_id);
    }

    Ok(())
}

#[cfg(test)]
mod projectile_physics_tests {
    use super::*;

    #[test]
    fn source_and_weapon_sampling_matches_the_client() {
        assert_eq!(projectile_gravity_multiplier(PROJECTILE_SOURCE_NPC, Some("Makarov PM"), false), 0.0);
        assert_eq!(projectile_gravity_multiplier(PROJECTILE_SOURCE_MONUMENT_TURRET, None, true), 0.0);
        assert_eq!(projectile_gravity_multiplier(PROJECTILE_SOURCE_TURRET, None, true), 1.0);
        assert_eq!(projectile_gravity_multiplier(PROJECTILE_SOURCE_PLAYER, Some("Grenade"), true), 0.0);
        assert_eq!(projectile_gravity_multiplier(PROJECTILE_SOURCE_PLAYER, Some("Hunting Bow"), false), 0.0);
        assert_eq!(projectile_gravity_multiplier(PROJECTILE_SOURCE_PLAYER, Some("Makarov PM"), false), PROJECTILE_FIREARM_GRAVITY_MULTIPLIER);
    }

    #[test]
    fn last_segment_keeps_hits_inside_range_and_excludes_hits_beyond_it() {
        let end = clip_segment_to_range((90.0, 0.0), (110.0, 0.0), (0.0, 0.0), 100.0);
        assert_eq!(end, (100.0, 0.0));
        assert!(line_intersects_circle(90.0, 0.0, end.0, end.1, 98.0, 0.0, 1.0));
        assert!(!line_intersects_circle(90.0, 0.0, end.0, end.1, 105.0, 0.0, 1.0));
    }
}
