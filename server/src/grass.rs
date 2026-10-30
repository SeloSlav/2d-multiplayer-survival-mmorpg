use spacetimedb::{SpacetimeType, Timestamp, Table, ReducerContext, Identity, TimeDuration};
use rand::Rng;

// Import table traits
use crate::player as PlayerTableTrait;
use crate::items::item_definition as ItemDefinitionTableTrait;
use crate::tree::tree as TreeTableTrait;
use crate::stone::stone as StoneTableTrait;
use crate::building::foundation_cell as FoundationCellTableTrait;
use crate::fence::fence as FenceTableTrait;
use crate::sound_events::{emit_sound_at_position, SoundType};

// Self table traits for split tables
use crate::grass::grass as GrassTableTrait;
use crate::grass::grass_state as GrassStateTableTrait;

// --- Grass-Specific Constants ---

// Plant Fiber Drop Constants
// Boosted to make grass cutting a more viable fiber source
// At 8% chance with 12-18 drop, ~100 grass cuts = ~120 fiber (meaningful but still less than dedicated plants)
pub(crate) const PLANT_FIBER_DROP_CHANCE: f32 = 0.08; // 8% chance to drop fiber (was 4%)
pub(crate) const PLANT_FIBER_MIN_DROP: u32 = 12; // Minimum fiber dropped (was 8)
pub(crate) const PLANT_FIBER_MAX_DROP: u32 = 18; // Maximum fiber dropped (was 12)
pub(crate) const GRASS_INTERACTION_DISTANCE: f32 = 80.0; // Max distance to interact with grass
pub(crate) const GRASS_INTERACTION_DISTANCE_SQ: f32 = GRASS_INTERACTION_DISTANCE * GRASS_INTERACTION_DISTANCE;

// Grass Spawning Parameters - Optimized for dense "seas" of grass
pub(crate) const GRASS_DENSITY_PERCENT: f32 = 0.18; // Used for noise-based density calculation
pub(crate) const GRASS_SPAWN_NOISE_FREQUENCY: f64 = 1.2; // Much lower frequency = HUGE contiguous patches/regions (was 2.5, originally 10.0)
pub(crate) const GRASS_SPAWN_NOISE_THRESHOLD: f64 = 0.30; // Much lower threshold = very easy spawning, creates massive "seas" (was 0.45, originally 0.65)
pub(crate) const GRASS_SPAWN_WORLD_MARGIN_TILES: u32 = 2; // Margin from world edges
pub(crate) const MAX_GRASS_SEEDING_ATTEMPTS_FACTOR: u32 = 4; // Reduced from 5 to 4 for faster seeding
pub(crate) const MIN_GRASS_DISTANCE_PX: f32 = 3.0; // Reduced from 10.0 to 3.0 for much denser patches
pub(crate) const MIN_GRASS_DISTANCE_SQ: f32 = MIN_GRASS_DISTANCE_PX * MIN_GRASS_DISTANCE_PX;
// Distances from other objects
pub(crate) const MIN_GRASS_TREE_DISTANCE_PX: f32 = 50.0; 
pub(crate) const MIN_GRASS_TREE_DISTANCE_SQ: f32 = MIN_GRASS_TREE_DISTANCE_PX * MIN_GRASS_TREE_DISTANCE_PX;
pub(crate) const MIN_GRASS_STONE_DISTANCE_PX: f32 = 40.0;
pub(crate) const MIN_GRASS_STONE_DISTANCE_SQ: f32 = MIN_GRASS_STONE_DISTANCE_PX * MIN_GRASS_STONE_DISTANCE_PX;


pub(crate) const GRASS_INITIAL_HEALTH: u32 = 1; // Changed to 1 for one-hit destruction
pub(crate) const MIN_GRASS_RESPAWN_TIME_SECS: u64 = 60; // 1 minute
pub(crate) const MAX_GRASS_RESPAWN_TIME_SECS: u64 = 180; // 3 minutes

// --- Grass Enums and Structs ---

// Define different types/visuals of grass if needed later
#[derive(Clone, Debug, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize, SpacetimeType)]
pub enum GrassAppearanceType {
    // Land foliage
    PatchA, // Default patch
    PatchB, // Another variant
    PatchC, // Yet another variant
    PatchD, // Additional variant (grass4.png)
    PatchE, // Additional variant (grass5.png)
    TallGrassA,
    TallGrassB,
    BushRounded,
    BushSpiky,
    BushFlowering,
    BramblesA,
    BramblesB,
    
    // Tundra foliage
    TundraPatchA,      // grass1_tundra.png
    TundraPatchB,      // grass2_tundra.png
    TundraPatchC,      // grass_tundra3.png
    TundraPatchD,      // grass_tundra4.png
    TallGrassTundraA,  // tall_grass_tundra_a.png
    TallGrassTundraB,  // tall_grass_tundra_b.png
    
    // Alpine foliage
    AlpinePatchA,      // grass_alpine1.png
    AlpinePatchB,      // grass_alpine2.png
    AlpinePatchC,      // grass_alpine3.png
    AlpinePatchD,      // grass_alpine4.png
    TallGrassAlpineA,  // tall_grass_alpine_a.png
    TallGrassAlpineB,  // tall_grass_alpine_b.png
    
    // Beach foliage
    BeachGrassA,     // Coastal dune grass
}

// --- NEW: Helper function to check if grass type is a bramble (indestructible) ---
impl GrassAppearanceType {
    /// Returns true if this grass type is a bramble and should be indestructible
    pub fn is_bramble(&self) -> bool {
        matches!(self, GrassAppearanceType::BramblesA | GrassAppearanceType::BramblesB)
    }
    
    /// Returns true if this grass type is beach foliage that should spawn on beach tiles
    pub fn is_beach_foliage(&self) -> bool {
        matches!(self, GrassAppearanceType::BeachGrassA)
    }
}

// Helper function for backwards compatibility and external use
pub fn is_grass_type_bramble(appearance_type: &GrassAppearanceType) -> bool {
    appearance_type.is_bramble()
}

// ============================================================================
// TABLE NORMALIZATION: Split into static geometry + dynamic state
// ============================================================================
// SpacetimeDB sends entire rows on any field change. By splitting:
// - Grass (static): ~28 bytes, written ONCE at spawn, never updated
// - GrassState (dynamic): ~24 bytes, updated on damage/respawn
// 
// This reduces network traffic by ~40% when grass state changes frequently.
// ============================================================================

/// Static grass geometry - NEVER updated after spawn
/// Contains all visual/positional data that doesn't change
#[spacetimedb::table(accessor = grass, public)]
#[derive(Clone, Debug)]
pub struct Grass {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub pos_x: f32,
    pub pos_y: f32,
    pub appearance_type: GrassAppearanceType, // For different sprites/sway
    #[index(btree)]
    pub chunk_index: u32,
    // For client-side sway animation, to give each patch a unique offset
    pub sway_offset_seed: u32, 
    pub sway_speed: f32,
}

/// Dynamic grass state - updated when damaged or respawning
/// Linked to Grass via grass_id (1:1 relationship)
/// 
/// SUBSCRIPTION INDEX OPTIMIZATION:
/// SpacetimeDB subscription queries don't efficiently use range conditions like `health > 0`
/// in compound queries. We use `is_alive: bool` with composite index `[chunk_index, is_alive]`
/// for efficient subscription filtering: `WHERE chunk_index = X AND is_alive = true`
#[spacetimedb::table(accessor = grass_state, public, index(accessor = idx_chunk_alive, name = "idx_chunk_alive", btree(columns = [chunk_index, is_alive])))]
#[derive(Clone, Debug)]
pub struct GrassState {
    #[primary_key]
    pub grass_id: u64,  // References Grass.id (NOT auto_inc - must match grass.id)
    pub health: u32,
    #[index(btree)]
    pub chunk_index: u32,  // Denormalized for efficient chunk-based queries
    /// Boolean for efficient subscription queries. Updated whenever health changes.
    /// Use `is_alive = true` in subscriptions instead of `health > 0` for better index usage.
    #[index(btree)]
    pub is_alive: bool,
    pub last_hit_time: Option<Timestamp>, // When it was last "chopped"
    /// When this grass should respawn. Use Timestamp::UNIX_EPOCH (0) for "not respawning".
    /// This allows efficient btree index range queries: .respawn_at().filter(1..=now)
    #[index(btree)]
    pub respawn_at: Timestamp,
} 

// --- GRASS RESPAWN: BATCH SCHEDULER ---
// 
// PERFORMANCE OPTIMIZATION: Instead of creating one schedule entry per destroyed grass
// (which caused thousands of schedule rows), we use a single batch scheduler.
//
// How it works:
// - When grass is destroyed, we set health=0 and respawn_at=future_time (grass entity stays in table)
// - A single batch scheduler runs every few seconds and respawns all due grass
// - This eliminates thousands of schedule rows → just ONE scheduler row

/// Batch scheduler interval for grass respawn checks
const GRASS_RESPAWN_BATCH_INTERVAL_SECS: u64 = 5;

/// Radius around players to check for grass respawns (spatial gating)
const GRASS_RESPAWN_CHECK_RADIUS: f32 = 1500.0;
const GRASS_RESPAWN_CHECK_RADIUS_SQ: f32 = GRASS_RESPAWN_CHECK_RADIUS * GRASS_RESPAWN_CHECK_RADIUS;

/// Single batch schedule entry for grass respawn processing
#[spacetimedb::table(accessor = grass_respawn_batch_schedule, scheduled(process_grass_respawn_batch))]
#[derive(Clone, Debug)]
pub struct GrassRespawnBatchSchedule {
    #[primary_key]
    #[auto_inc]
    pub schedule_id: u64,
    pub scheduled_at: spacetimedb::ScheduleAt,
}

/// Initialize the batch grass respawn scheduler (called from init_module)
pub fn init_grass_respawn_scheduler(ctx: &spacetimedb::ReducerContext) {
    // Only create if not already present
    if ctx.db.grass_respawn_batch_schedule().iter().next().is_none() {
        if let Err(e) = ctx.db.grass_respawn_batch_schedule().try_insert(GrassRespawnBatchSchedule {
            schedule_id: 0,
            scheduled_at: spacetimedb::ScheduleAt::Interval(
                TimeDuration::from_micros((GRASS_RESPAWN_BATCH_INTERVAL_SECS * 1_000_000) as i64)
            ),
        }) {
            log::error!("Failed to create grass respawn batch scheduler: {}", e);
        } else {
            log::info!("Grass respawn batch scheduler initialized (every {}s)", GRASS_RESPAWN_BATCH_INTERVAL_SECS);
        }
    }
}

/// Batch reducer: Process all grass due for respawn
/// Now works with split tables: reads GrassState for respawn logic, joins with Grass for position
#[spacetimedb::reducer]
pub fn process_grass_respawn_batch(ctx: &spacetimedb::ReducerContext, _schedule: GrassRespawnBatchSchedule) -> Result<(), String> {
    // Security check
    if ctx.sender() != ctx.identity() {
        return Err("process_grass_respawn_batch can only be called by the scheduler.".to_string());
    }

    // SPATIAL GATING: Only process grass near online players
    let player_positions: Vec<(f32, f32)> = ctx.db.player()
        .iter()
        .filter(|p| p.is_online)
        .map(|p| (p.position_x, p.position_y))
        .collect();
    
    // Early exit if no players online
    if player_positions.is_empty() {
        return Ok(());
    }

    let now = ctx.timestamp;
    let grass_table = ctx.db.grass();
    let grass_state_table = ctx.db.grass_state();
    let trees = ctx.db.tree();
    let stones = ctx.db.stone();
    let foundations = ctx.db.foundation_cell();
    
    let mut respawned_count = 0;
    
    // Find all grass states due for respawn
    // is_alive == false means destroyed, respawn_at > UNIX_EPOCH means scheduled
    for mut state in grass_state_table.iter() {
        // Skip grass not due for respawn
        if state.is_alive || state.respawn_at == Timestamp::UNIX_EPOCH || state.respawn_at > now {
            continue;
        }
        
        // Get the static grass data for position info
        let grass = match grass_table.id().find(state.grass_id) {
            Some(g) => g,
            None => {
                log::warn!("GrassState {} has no matching Grass entity, skipping", state.grass_id);
                continue;
            }
        };
        
        // Spatial gating: only process grass near players
        let near_player = player_positions.iter().any(|(px, py)| {
            let dx = grass.pos_x - *px;
            let dy = grass.pos_y - *py;
            dx * dx + dy * dy <= GRASS_RESPAWN_CHECK_RADIUS_SQ
        });
        
        if !near_player {
            continue;
        }
        
        // Check for blockers before respawning
        let mut blocked = crate::indoors::blocks_world_spawn(ctx, grass.pos_x, grass.pos_y);
        
        // Check trees
        for tree in trees.iter() {
            if tree.health > 0 {
                let dx = grass.pos_x - tree.pos_x;
                let dy = grass.pos_y - tree.pos_y;
                if dx * dx + dy * dy < MIN_GRASS_TREE_DISTANCE_SQ {
                    blocked = true;
                    break;
                }
            }
        }
        
        if !blocked {
            // Check stones
            for stone in stones.iter() {
                if stone.health > 0 {
                    let dx = grass.pos_x - stone.pos_x;
                    let dy = grass.pos_y - stone.pos_y;
                    if dx * dx + dy * dy < MIN_GRASS_STONE_DISTANCE_SQ {
                        blocked = true;
                        break;
                    }
                }
            }
        }
        
        // Calculate tile coordinates for foundation/fence checks
        let grass_tile_x = (grass.pos_x / crate::building::FOUNDATION_TILE_SIZE_PX as f32).floor() as i32;
        let grass_tile_y = (grass.pos_y / crate::building::FOUNDATION_TILE_SIZE_PX as f32).floor() as i32;
        
        if !blocked {
            // Check foundations
            const MIN_GRASS_FOUNDATION_DISTANCE_SQ: f32 = 48.0 * 48.0;
            
            'foundation_check: for offset_x in -2..=2 {
                for offset_y in -2..=2 {
                    let check_x = grass_tile_x + offset_x;
                    let check_y = grass_tile_y + offset_y;
                    
                    for foundation in foundations.idx_cell_coords().filter((check_x, check_y)) {
                        if !foundation.is_destroyed {
                            blocked = true;
                            break 'foundation_check;
                        }
                    }
                }
            }
        }
        
        // Check fences
        if !blocked {
            const MIN_GRASS_FENCE_DISTANCE_SQ: f32 = 48.0 * 48.0; // Same as foundation distance
            let fences = ctx.db.fence();
            
            for fence in fences.idx_cell_coords().filter((grass_tile_x, grass_tile_y)) {
                if !fence.is_destroyed {
                    let dx = grass.pos_x - fence.pos_x;
                    let dy = grass.pos_y - fence.pos_y;
                    if dx * dx + dy * dy < MIN_GRASS_FENCE_DISTANCE_SQ {
                        blocked = true;
                        break;
                    }
                }
            }
            
            // Also check adjacent cells for fences (fences can be on cell edges)
            if !blocked {
                'fence_check: for offset_x in -1..=1 {
                    for offset_y in -1..=1 {
                        if offset_x == 0 && offset_y == 0 { continue; }
                        let check_x = grass_tile_x + offset_x;
                        let check_y = grass_tile_y + offset_y;
                        
                        for fence in fences.idx_cell_coords().filter((check_x, check_y)) {
                            if !fence.is_destroyed {
                                let dx = grass.pos_x - fence.pos_x;
                                let dy = grass.pos_y - fence.pos_y;
                                if dx * dx + dy * dy < MIN_GRASS_FENCE_DISTANCE_SQ {
                                    blocked = true;
                                    break 'fence_check;
                                }
                            }
                        }
                    }
                }
            }
        }
        
        if blocked {
            // Blocked by something - delay respawn by another respawn cycle
            let new_respawn = now + TimeDuration::from_micros((MIN_GRASS_RESPAWN_TIME_SECS * 1_000_000) as i64);
            state.respawn_at = new_respawn;
            grass_state_table.grass_id().update(state);
            continue;
        }
        
        // Respawn the grass! Only update GrassState (dynamic data)
        state.health = GRASS_INITIAL_HEALTH;
        state.is_alive = true; // Mark as alive for subscription filtering
        state.respawn_at = Timestamp::UNIX_EPOCH;
        state.last_hit_time = None;
        grass_state_table.grass_id().update(state);
        respawned_count += 1;
    }
    
    if respawned_count > 0 {
        log::info!("Batch respawned {} grass entities", respawned_count);
    }
    
    Ok(())
}

/// Damage grass entity - called when player attacks grass
/// Destroys grass (1 HP), schedules respawn, and has 8% chance to drop 12-18 Plant Fiber
/// Now uses split tables: reads Grass for static data, updates GrassState for dynamic data
#[spacetimedb::reducer]
pub fn damage_grass(ctx: &ReducerContext, grass_id: u64) -> Result<(), String> {
    let sender_id = ctx.sender();
    let grass_table = ctx.db.grass();
    let grass_state_table = ctx.db.grass_state();
    let players = ctx.db.player();
    
    // 1. Validate player
    let player = players.identity().find(&sender_id)
        .ok_or_else(|| "Player not found".to_string())?;
    
    if player.is_dead {
        return Err("Cannot interact with grass while dead.".to_string());
    }
    
    if player.is_knocked_out {
        return Err("Cannot interact with grass while knocked out.".to_string());
    }
    
    // 2. Find the grass entity (static data for position and appearance)
    let grass = grass_table.id().find(grass_id)
        .ok_or_else(|| format!("Grass entity {} not found", grass_id))?;
    
    // 3. Find the grass state (dynamic data for health)
    let mut state = grass_state_table.grass_id().find(grass_id)
        .ok_or_else(|| format!("GrassState for grass {} not found", grass_id))?;
    
    // 4. Check if grass is alive
    if !state.is_alive {
        return Err("Grass is already destroyed.".to_string());
    }
    
    // 5. Check if grass is a bramble (indestructible)
    if grass.appearance_type.is_bramble() {
        return Err("Brambles cannot be destroyed.".to_string());
    }
    
    // NOTE: Distance check removed - combat system already validates attack range
    // with the weapon's actual attack_range (which varies by weapon type).
    
    // 6. Damage the grass (1 HP = instant destroy) - only update GrassState
    state.health = 0;
    state.is_alive = false; // Mark as dead for efficient subscription filtering
    state.last_hit_time = Some(ctx.timestamp);
    
    // 7. Set respawn time (batch scheduler will handle actual respawn)
    // PERFORMANCE: Only GrassState is updated, not the static Grass table
    let respawn_secs = ctx.rng().gen_range(MIN_GRASS_RESPAWN_TIME_SECS..=MAX_GRASS_RESPAWN_TIME_SECS);
    let respawn_time = ctx.timestamp + TimeDuration::from_micros(respawn_secs as i64 * 1_000_000);
    state.respawn_at = respawn_time;
    
    // 8. Store grass position (from static table)
    let grass_pos_x = grass.pos_x;
    let grass_pos_y = grass.pos_y;
    
    // Update only the GrassState entity (smaller payload than full Grass row)
    grass_state_table.grass_id().update(state);
    
    log::info!("Player {:?} destroyed grass {} at ({:.1}, {:.1})", sender_id, grass_id, grass_pos_x, grass_pos_y);
    
    // 9. Play grass cutting sound
    if let Err(e) = emit_sound_at_position(ctx, SoundType::GrassCut, grass_pos_x, grass_pos_y, 0.6, sender_id) {
        log::warn!("Failed to emit grass cut sound: {}", e);
    }
    
    // 10. Roll for Plant Fiber drop (8% chance)
    let drop_roll: f32 = ctx.rng().gen();
    if drop_roll < PLANT_FIBER_DROP_CHANCE {
        // Find Plant Fiber item definition
        let item_defs = ctx.db.item_definition();
        if let Some(fiber_def) = item_defs.iter().find(|def| def.name == "Plant Fiber") {
            // Random quantity between 12-18
            let fiber_quantity = ctx.rng().gen_range(PLANT_FIBER_MIN_DROP..=PLANT_FIBER_MAX_DROP);
            
            // Drop the fiber at grass position
            match crate::dropped_item::create_dropped_item_entity(
                ctx,
                fiber_def.id,
                fiber_quantity,
                grass_pos_x,
                grass_pos_y,
            ) {
                Ok(_) => {
                    log::info!("Lucky! Dropped {} Plant Fiber from grass at ({:.1}, {:.1})", 
                             fiber_quantity, grass_pos_x, grass_pos_y);
                }
                Err(e) => {
                    log::error!("Failed to drop Plant Fiber: {}", e);
                }
            }
        } else {
            log::warn!("Plant Fiber item definition not found, cannot drop fiber");
        }
    }
    
    Ok(())
}

// ============================================================================
// GRASS SPAWNING HELPER
// ============================================================================
// Creates both Grass (static) and GrassState (dynamic) entries atomically.
// Used by environment.rs during world seeding.
// ============================================================================

/// Spawn a new grass entity with both static geometry and dynamic state.
/// Returns the grass ID on success, or an error message on failure.
/// 
/// This function creates entries in both tables:
/// - `Grass`: Static data (position, appearance, sway params) - never updated
/// - `GrassState`: Dynamic data (health, respawn) - updated on damage/respawn
pub fn spawn_grass_entity(
    ctx: &ReducerContext,
    pos_x: f32,
    pos_y: f32,
    appearance_type: GrassAppearanceType,
    chunk_index: u32,
    sway_offset_seed: u32,
    sway_speed: f32,
) -> Result<u64, String> {
    if crate::indoors::blocks_world_spawn(ctx, pos_x, pos_y) { return Err("Grass cannot spawn inside a building".into()); }
    let grass_table = ctx.db.grass();
    let grass_state_table = ctx.db.grass_state();
    
    // 1. Insert static Grass entity (with auto_inc id)
    let new_grass = Grass {
        id: 0, // auto_inc will assign
        pos_x,
        pos_y,
        appearance_type,
        chunk_index,
        sway_offset_seed,
        sway_speed,
    };
    
    let inserted_grass = grass_table.try_insert(new_grass)
        .map_err(|e| format!("Failed to insert Grass at ({}, {}): {}", pos_x, pos_y, e))?;
    
    let grass_id = inserted_grass.id;
    
    // 2. Insert corresponding GrassState entity (using the assigned grass_id)
    let new_state = GrassState {
        grass_id,
        health: GRASS_INITIAL_HEALTH,
        chunk_index, // Denormalized for efficient chunk queries
        is_alive: true, // Grass starts alive
        last_hit_time: None,
        respawn_at: Timestamp::UNIX_EPOCH, // 0 = not respawning
    };
    
    grass_state_table.try_insert(new_state)
        .map_err(|e| format!("Failed to insert GrassState for grass {}: {}", grass_id, e))?;
    
    Ok(grass_id)
} 