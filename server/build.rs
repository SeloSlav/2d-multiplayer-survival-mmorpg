use serde::Deserialize;
use std::env;
use std::fs;
use std::path::PathBuf;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SharedGameConfig {
    world: WorldConfig,
    player: PlayerConfig,
    interaction: InteractionConfig,
    broth: BrothConfig,
    projectiles: ProjectileConfig,
    combat: CombatConfig,
    day_night: DayNightConfig,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorldConfig {
    tile_size_px: u32,
    foundation_tile_size_px: u32,
    width_tiles: u32,
    height_tiles: u32,
    chunk_size_tiles: u32,
    deep_sea_edge_tiles: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlayerConfig {
    radius_px: f32,
    speed_px_per_second: f32,
    sprint_multiplier: f32,
    crouch_radius_multiplier: f32,
    water_speed_penalty: f32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InteractionConfig {
    hold_duration_ms: u32,
    revive_hold_duration_ms: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BrothConfig {
    brewing_water_requirement_ml: u32,
    max_water_capacity_ml: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectileConfig {
    gravity: f32,
    straight_line_gravity_multiplier: f32,
    firearm_gravity_multiplier: f32,
    player_hit_radius: f32,
    npc_player_hit_radius: f32,
    source_types: ProjectileSourceTypes,
    npc_types: ProjectileNpcTypes,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectileSourceTypes {
    player: u8,
    turret: u8,
    npc: u8,
    monument_turret: u8,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectileNpcTypes {
    none: u8,
    spectral_shard: u8,
    spectral_bolt: u8,
    venom_spittle: u8,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CombatConfig {
    exhausted_speed_penalty: f32,
    remote_healing_range_px: f32,
    dodge_roll_distance_px: f32,
    dodge_roll_duration_ms: u64,
    dodge_roll_cooldown_ms: u64,
    default_melee_range_multiplier: f32,
    spear_melee_range_multiplier: f32,
    scythe_melee_range_multiplier: f32,
    default_melee_arc_degrees: f32,
    spear_melee_arc_degrees: f32,
    scythe_melee_arc_degrees: f32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DayNightConfig {
    day_duration_seconds: f32,
    night_duration_seconds: f32,
    full_moon_cycle_interval: u32,
    dawn_end_progress: f32,
    morning_clear_progress: f32,
    noon_start_progress: f32,
    afternoon_start_progress: f32,
    dusk_start_progress: f32,
    twilight_evening_start_progress: f32,
    night_start_progress: f32,
    midnight_start_progress: f32,
    twilight_morning_start_progress: f32,
    cycle_end_progress: f32,
}

fn rust_f32(value: f32) -> String {
    let mut formatted = value.to_string();
    if !formatted.contains('.') && !formatted.contains('e') && !formatted.contains('E') {
        formatted.push_str(".0");
    }
    formatted
}

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR missing"));
    let config_path = manifest_dir
        .join("..")
        .join("shared")
        .join("config")
        .join("gameConfig.json");

    println!("cargo:rerun-if-changed={}", config_path.display());

    let config_contents = fs::read_to_string(&config_path)
        .unwrap_or_else(|err| panic!("failed to read {}: {err}", config_path.display()));
    let config: SharedGameConfig = serde_json::from_str(&config_contents)
        .unwrap_or_else(|err| panic!("failed to parse {}: {err}", config_path.display()));

    let mut generated = format!(
        "\
pub const TILE_SIZE_PX: u32 = {tile_size_px};
pub const FOUNDATION_TILE_SIZE_PX: u32 = {foundation_tile_size_px};
pub const WORLD_WIDTH_TILES: u32 = {world_width_tiles};
pub const WORLD_HEIGHT_TILES: u32 = {world_height_tiles};
pub const CHUNK_SIZE_TILES: u32 = {chunk_size_tiles};
pub const DEEP_SEA_OUTER_RING_TILES: u32 = {deep_sea_edge_tiles};

pub const PLAYER_RADIUS: f32 = {player_radius};
pub const PLAYER_SPEED: f32 = {player_speed};
pub const PLAYER_SPRINT_MULTIPLIER: f32 = {player_sprint_multiplier};
pub const CROUCHING_RADIUS_MULTIPLIER: f32 = {crouch_radius_multiplier};
pub const WATER_SPEED_PENALTY: f32 = {water_speed_penalty};

pub const HOLD_INTERACTION_DURATION_MS: u32 = {hold_duration_ms};
pub const REVIVE_HOLD_DURATION_MS: u32 = {revive_hold_duration_ms};

pub const BREWING_WATER_REQUIREMENT_ML: u32 = {brewing_water_requirement_ml};
pub const BROTH_POT_MAX_WATER_CAPACITY_ML: u32 = {max_water_capacity_ml};

pub const PROJECTILE_GRAVITY: f32 = {projectile_gravity};
pub const PROJECTILE_STRAIGHT_LINE_GRAVITY_MULTIPLIER: f32 = {projectile_straight_line_gravity_multiplier};
pub const PROJECTILE_FIREARM_GRAVITY_MULTIPLIER: f32 = {projectile_firearm_gravity_multiplier};
pub const PROJECTILE_PLAYER_HIT_RADIUS: f32 = {projectile_player_hit_radius};
pub const PROJECTILE_NPC_PLAYER_HIT_RADIUS: f32 = {projectile_npc_player_hit_radius};
pub const PROJECTILE_SOURCE_PLAYER: u8 = {projectile_source_player};
pub const PROJECTILE_SOURCE_TURRET: u8 = {projectile_source_turret};
pub const PROJECTILE_SOURCE_NPC: u8 = {projectile_source_npc};
pub const PROJECTILE_SOURCE_MONUMENT_TURRET: u8 = {projectile_source_monument_turret};
pub const NPC_PROJECTILE_NONE: u8 = {npc_projectile_none};
pub const NPC_PROJECTILE_SPECTRAL_SHARD: u8 = {npc_projectile_spectral_shard};
pub const NPC_PROJECTILE_SPECTRAL_BOLT: u8 = {npc_projectile_spectral_bolt};
pub const NPC_PROJECTILE_VENOM_SPITTLE: u8 = {npc_projectile_venom_spittle};

pub const EXHAUSTED_SPEED_PENALTY: f32 = {exhausted_speed_penalty};
pub const REMOTE_HEALING_RANGE_PX: f32 = {remote_healing_range_px};
pub const DODGE_ROLL_DISTANCE_PX: f32 = {dodge_roll_distance_px};
pub const DODGE_ROLL_DURATION_MS: u64 = {dodge_roll_duration_ms};
pub const DODGE_ROLL_COOLDOWN_MS: u64 = {dodge_roll_cooldown_ms};
pub const DODGE_ROLL_SPEED_PX_PER_SEC: f32 = DODGE_ROLL_DISTANCE_PX / (DODGE_ROLL_DURATION_MS as f32 / 1000.0);
pub const DEFAULT_MELEE_RANGE_MULTIPLIER: f32 = {default_melee_range_multiplier};
pub const SPEAR_MELEE_RANGE_MULTIPLIER: f32 = {spear_melee_range_multiplier};
pub const SCYTHE_MELEE_RANGE_MULTIPLIER: f32 = {scythe_melee_range_multiplier};
pub const DEFAULT_MELEE_ARC_DEGREES: f32 = {default_melee_arc_degrees};
pub const SPEAR_MELEE_ARC_DEGREES: f32 = {spear_melee_arc_degrees};
pub const SCYTHE_MELEE_ARC_DEGREES: f32 = {scythe_melee_arc_degrees};

pub const DAY_DURATION_SECONDS: f32 = {day_duration_seconds};
pub const NIGHT_DURATION_SECONDS: f32 = {night_duration_seconds};
pub const FULL_CYCLE_DURATION_SECONDS: f32 = DAY_DURATION_SECONDS + NIGHT_DURATION_SECONDS;
pub const FULL_MOON_CYCLE_INTERVAL: u32 = {full_moon_cycle_interval};

pub const DAWN_END_PROGRESS: f32 = {dawn_end_progress};
pub const MORNING_CLEAR_PROGRESS: f32 = {morning_clear_progress};
pub const NOON_START_PROGRESS: f32 = {noon_start_progress};
pub const AFTERNOON_START_PROGRESS: f32 = {afternoon_start_progress};
pub const DUSK_START_PROGRESS: f32 = {dusk_start_progress};
pub const TWILIGHT_EVENING_START_PROGRESS: f32 = {twilight_evening_start_progress};
pub const NIGHT_START_PROGRESS: f32 = {night_start_progress};
pub const MIDNIGHT_START_PROGRESS: f32 = {midnight_start_progress};
pub const TWILIGHT_MORNING_START_PROGRESS: f32 = {twilight_morning_start_progress};
pub const CYCLE_END_PROGRESS: f32 = {cycle_end_progress};
",
        tile_size_px = config.world.tile_size_px,
        foundation_tile_size_px = config.world.foundation_tile_size_px,
        world_width_tiles = config.world.width_tiles,
        world_height_tiles = config.world.height_tiles,
        chunk_size_tiles = config.world.chunk_size_tiles,
        deep_sea_edge_tiles = config.world.deep_sea_edge_tiles,
        player_radius = rust_f32(config.player.radius_px),
        player_speed = rust_f32(config.player.speed_px_per_second),
        player_sprint_multiplier = rust_f32(config.player.sprint_multiplier),
        crouch_radius_multiplier = rust_f32(config.player.crouch_radius_multiplier),
        water_speed_penalty = rust_f32(config.player.water_speed_penalty),
        hold_duration_ms = config.interaction.hold_duration_ms,
        revive_hold_duration_ms = config.interaction.revive_hold_duration_ms,
        brewing_water_requirement_ml = config.broth.brewing_water_requirement_ml,
        max_water_capacity_ml = config.broth.max_water_capacity_ml,
        projectile_gravity = rust_f32(config.projectiles.gravity),
        projectile_straight_line_gravity_multiplier = rust_f32(config.projectiles.straight_line_gravity_multiplier),
        projectile_firearm_gravity_multiplier = rust_f32(config.projectiles.firearm_gravity_multiplier),
        projectile_player_hit_radius = rust_f32(config.projectiles.player_hit_radius),
        projectile_npc_player_hit_radius = rust_f32(config.projectiles.npc_player_hit_radius),
        projectile_source_player = config.projectiles.source_types.player,
        projectile_source_turret = config.projectiles.source_types.turret,
        projectile_source_npc = config.projectiles.source_types.npc,
        projectile_source_monument_turret = config.projectiles.source_types.monument_turret,
        npc_projectile_none = config.projectiles.npc_types.none,
        npc_projectile_spectral_shard = config.projectiles.npc_types.spectral_shard,
        npc_projectile_spectral_bolt = config.projectiles.npc_types.spectral_bolt,
        npc_projectile_venom_spittle = config.projectiles.npc_types.venom_spittle,
        exhausted_speed_penalty = rust_f32(config.combat.exhausted_speed_penalty),
        remote_healing_range_px = rust_f32(config.combat.remote_healing_range_px),
        dodge_roll_distance_px = rust_f32(config.combat.dodge_roll_distance_px),
        dodge_roll_duration_ms = config.combat.dodge_roll_duration_ms,
        dodge_roll_cooldown_ms = config.combat.dodge_roll_cooldown_ms,
        default_melee_range_multiplier = rust_f32(config.combat.default_melee_range_multiplier),
        spear_melee_range_multiplier = rust_f32(config.combat.spear_melee_range_multiplier),
        scythe_melee_range_multiplier = rust_f32(config.combat.scythe_melee_range_multiplier),
        default_melee_arc_degrees = rust_f32(config.combat.default_melee_arc_degrees),
        spear_melee_arc_degrees = rust_f32(config.combat.spear_melee_arc_degrees),
        scythe_melee_arc_degrees = rust_f32(config.combat.scythe_melee_arc_degrees),
        day_duration_seconds = rust_f32(config.day_night.day_duration_seconds),
        night_duration_seconds = rust_f32(config.day_night.night_duration_seconds),
        full_moon_cycle_interval = config.day_night.full_moon_cycle_interval,
        dawn_end_progress = rust_f32(config.day_night.dawn_end_progress),
        morning_clear_progress = rust_f32(config.day_night.morning_clear_progress),
        noon_start_progress = rust_f32(config.day_night.noon_start_progress),
        afternoon_start_progress = rust_f32(config.day_night.afternoon_start_progress),
        dusk_start_progress = rust_f32(config.day_night.dusk_start_progress),
        twilight_evening_start_progress = rust_f32(config.day_night.twilight_evening_start_progress),
        night_start_progress = rust_f32(config.day_night.night_start_progress),
        midnight_start_progress = rust_f32(config.day_night.midnight_start_progress),
        twilight_morning_start_progress = rust_f32(config.day_night.twilight_morning_start_progress),
        cycle_end_progress = rust_f32(config.day_night.cycle_end_progress),
    );

    let collision_path = manifest_dir.join("..").join("shared").join("config").join("collisionGeometry.json");
    println!("cargo:rerun-if-changed={}", collision_path.display());
    let collision: serde_json::Value = serde_json::from_str(&fs::read_to_string(&collision_path)
        .unwrap_or_else(|err| panic!("failed to read {}: {err}", collision_path.display())))
        .unwrap_or_else(|err| panic!("failed to parse {}: {err}", collision_path.display()));
    let shelter = &collision["shelter"];
    let number = |name: &str| shelter[name].as_f64().unwrap_or_else(|| panic!("missing shelter {name}")) as f32;
    generated.push_str(&format!("\npub const SHELTER_COLLISION_WIDTH: f32 = {};\npub const SHELTER_COLLISION_HEIGHT: f32 = {};\npub const SHELTER_CENTER_OFFSET_Y: f32 = {};\n",
        rust_f32(number("width")), rust_f32(number("height")), rust_f32(number("centerOffsetY"))));
    let fire_offset = collision["village"]["campfireOffsetY"].as_f64().expect("missing village campfireOffsetY") as f32;
    generated.push_str(&format!("pub const VILLAGE_CAMPFIRE_OFFSET_Y: f32 = {};\n", rust_f32(fire_offset)));
    let out_path = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR missing")).join("shared_game_config.rs");
    fs::write(&out_path, generated)
        .unwrap_or_else(|err| panic!("failed to write {}: {err}", out_path.display()));
}
