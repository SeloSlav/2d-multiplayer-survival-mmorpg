/******************************************************************************
 *                                                                            *
 * Storm Debris Spawning System                                               *
 *                                                                            *
 * Heavy storms (HeavyStorm weather type) spawn debris on beach tiles:        *
 * - Driftwood (HarvestableResource) - 20% chance                             *
 * - Seaweed (DroppedItem) - 30% chance                                       *
 * - Coral Fragments (DroppedItem) - 35% chance                               *
 * - Shells (DroppedItem) - 10% chance                                        *
 * - Memory Shards (DroppedItem) - 5% RARE chance                             *
 *                                                                            *
 * Only spawns on Beach tiles in shore chunks (actual coastlines).            *
 * Only spawns if chunk is "picked clean" of existing storm debris.           *
 * Spawns both when HeavyStorm ends AND periodically during HeavyStorm.       *
 *                                                                            *
 ******************************************************************************/

use spacetimedb::{ReducerContext, Timestamp, Table};
use rand::Rng;

use crate::environment::{calculate_chunk_index, CHUNK_SIZE_TILES};

/// Check if a chunk is a "shore chunk" - has coastal beach tiles (near water)
/// This ensures storm debris only spawns on actual coastlines, not inland beach areas
/// 
/// OPTIMIZED: Uses pre-computed coastal_spawn_point table - O(log n) btree lookup
/// The coastal_spawn_point table contains beach tiles adjacent to water,
/// so if ANY exist in this chunk, it's definitionally a shore chunk.
fn is_shore_chunk(ctx: &ReducerContext, chunk_index: u32) -> bool {
    use crate::coastal_spawn_point as CoastalSpawnPointTableTrait;
    
    // O(log n) btree index lookup - checks if ANY coastal spawn points exist in this chunk
    // coastal_spawn_point.chunk_index has a btree index
    ctx.db.coastal_spawn_point()
        .chunk_index()
        .filter(chunk_index)
        .next()
        .is_some()
}

/// Spawn storm debris on beaches after a Heavy Storm ends or during a Heavy Storm
/// Only HeavyStorm (the most intense weather) triggers this - called from world_state.rs
/// Only spawns if chunk has no existing storm debris (picked clean), Beach tiles only
/// Only spawns in SHORE CHUNKS (chunks that contain water) - not inland beach areas
pub fn spawn_storm_debris_on_beaches(ctx: &ReducerContext, chunk_index: u32) -> Result<(), String> {
    use crate::{TileType, world_pos_to_tile_coords, get_tile_type_at_position, WORLD_WIDTH_TILES, TILE_SIZE_PX};
    use crate::harvestable_resource::create_harvestable_resource;
    use crate::plants_database::PlantType;
    use crate::dropped_item::DroppedItem;
    use crate::items::item_definition as ItemDefinitionTableTrait;
    use crate::harvestable_resource::harvestable_resource as HarvestableResourceTableTrait;
    use crate::dropped_item::dropped_item as DroppedItemTableTrait;
    
    // FIRST: Check if this is a shore chunk (contains water tiles)
    // Storm debris only washes up on actual coastlines, not inland beach areas
    if !is_shore_chunk(ctx, chunk_index) {
        return Ok(()); // Silently skip non-coastal chunks
    }
    
    // Pre-fetch item definition IDs first (needed for debris check)
    let mut seaweed_id = None;
    let mut coral_frag_id = None;
    let mut shell_id = None;
    let mut memory_shard_id = None;
    
    for def in ctx.db.item_definition().iter() {
        match def.name.as_str() {
            "Seaweed" => seaweed_id = Some(def.id),
            "Coral Fragments" => coral_frag_id = Some(def.id),
            "Shell" => shell_id = Some(def.id),
            "Memory Shard" => memory_shard_id = Some(def.id),
            _ => {}
        }
        if seaweed_id.is_some() && coral_frag_id.is_some() && shell_id.is_some() && memory_shard_id.is_some() {
            break;
        }
    }
    
    let seaweed_id = seaweed_id.ok_or("Seaweed item definition not found")?;
    let coral_frag_id = coral_frag_id.ok_or("Coral Fragments item definition not found")?;
    let shell_id = shell_id.ok_or("Shell item definition not found")?;
    let memory_shard_id = memory_shard_id.ok_or("Memory Shard item definition not found")?;
    
    // Check if there's ANY existing storm debris in this chunk
    // This includes driftwood (BeachWoodPile) AND dropped items (seaweed, coral, shells)
    
    // Check for driftwood
    let existing_driftwood = ctx.db.harvestable_resource()
        .chunk_index()
        .filter(chunk_index)
        .any(|r| r.plant_type == PlantType::BeachWoodPile && r.respawn_at == Timestamp::UNIX_EPOCH);
    
    // Check for dropped storm debris items (seaweed, coral fragments, shells, memory shards)
    let existing_dropped_debris = ctx.db.dropped_item()
        .chunk_index()
        .filter(chunk_index)
        .any(|item| {
            item.item_def_id == seaweed_id || 
            item.item_def_id == coral_frag_id || 
            item.item_def_id == shell_id ||
            item.item_def_id == memory_shard_id
        });
    
    // If ANY storm debris exists, skip spawning - wait until picked clean
    if existing_driftwood || existing_dropped_debris {
        log::debug!("Storm debris skipped for chunk {} - existing debris present (driftwood: {}, items: {})", 
                   chunk_index, existing_driftwood, existing_dropped_debris);
        return Ok(());
    }
    
    let mut rng = ctx.rng();
    
    // Calculate chunk bounds in pixels
    let chunk_size = CHUNK_SIZE_TILES as f32;
    let chunks_per_row = WORLD_WIDTH_TILES / CHUNK_SIZE_TILES;
    let chunk_x = (chunk_index % chunks_per_row) as f32;
    let chunk_y = (chunk_index / chunks_per_row) as f32;
    
    let tile_size = TILE_SIZE_PX as f32;
    let chunk_start_x = chunk_x * chunk_size * tile_size;
    let chunk_start_y = chunk_y * chunk_size * tile_size;
    let chunk_end_x = chunk_start_x + (chunk_size * tile_size);
    let chunk_end_y = chunk_start_y + (chunk_size * tile_size);
    
    // Spawn 2-4 debris items per chunk when picked clean (rebalanced from 2-5)
    let spawn_count = rng.gen_range(2..=4);
    
    let mut spawned_driftwood = 0;
    let mut spawned_items = 0;
    let mut attempts = 0;
    const MAX_ATTEMPTS: u32 = 80;
    
    while (spawned_driftwood + spawned_items) < spawn_count && attempts < MAX_ATTEMPTS {
        attempts += 1;
        
        // Random position within chunk
        let pos_x = rng.gen_range(chunk_start_x..chunk_end_x);
        let pos_y = rng.gen_range(chunk_start_y..chunk_end_y);
        
        // Convert to tile coordinates to check tile type
        let (tile_x, tile_y) = world_pos_to_tile_coords(pos_x, pos_y);
        
        // Check if this is a beach tile (ONLY Beach, not Sand - storm debris washes up on shores)
        if let Some(tile_type) = get_tile_type_at_position(ctx, tile_x, tile_y) {
            if tile_type != TileType::Beach {
                continue;
            }
        } else {
            continue;
        }
        
        if crate::indoors::blocks_world_spawn(ctx, pos_x, pos_y) { continue; }
        // Determine what to spawn (REBALANCED with Memory Shards)
        // Distribution: 20% driftwood, 30% seaweed, 35% coral, 10% shell, 5% memory shard
        let spawn_roll = rng.gen::<f32>();
        let item_chunk = calculate_chunk_index(pos_x, pos_y);
        
        if spawn_roll < 0.20 {
            // 20% chance: Spawn driftwood
            let driftwood = create_harvestable_resource(
                PlantType::BeachWoodPile,
                pos_x,
                pos_y,
                item_chunk,
                false // Not player planted
            );
            ctx.db.harvestable_resource().insert(driftwood);
            spawned_driftwood += 1;
            log::info!("Storm spawned driftwood at ({:.1}, {:.1})", pos_x, pos_y);
        } else if spawn_roll < 0.50 {
            // 30% chance: Spawn seaweed
            let quantity = rng.gen_range(1..=3);
            ctx.db.dropped_item().insert(DroppedItem {
                id: 0,
                item_def_id: seaweed_id,
                quantity,
                pos_x,
                pos_y,
                chunk_index: item_chunk,
                created_at: ctx.timestamp,
                item_data: None,
                spawn_x: None,
                spawn_y: None,
            });
            spawned_items += 1;
            log::info!("Storm spawned {} seaweed at ({:.1}, {:.1})", quantity, pos_x, pos_y);
        } else if spawn_roll < 0.85 {
            // 35% chance: Spawn coral fragments
            let quantity = rng.gen_range(1..=3);
            ctx.db.dropped_item().insert(DroppedItem {
                id: 0,
                item_def_id: coral_frag_id,
                quantity,
                pos_x,
                pos_y,
                chunk_index: item_chunk,
                created_at: ctx.timestamp,
                item_data: None,
                spawn_x: None,
                spawn_y: None,
            });
            spawned_items += 1;
            log::info!("Storm spawned {} coral fragments at ({:.1}, {:.1})", quantity, pos_x, pos_y);
        } else if spawn_roll < 0.95 {
            // 10% chance: Spawn shell
            ctx.db.dropped_item().insert(DroppedItem {
                id: 0,
                item_def_id: shell_id,
                quantity: 1,
                pos_x,
                pos_y,
                chunk_index: item_chunk,
                created_at: ctx.timestamp,
                item_data: None,
                spawn_x: None,
                spawn_y: None,
            });
            spawned_items += 1;
            log::info!("Storm spawned shell at ({:.1}, {:.1})", pos_x, pos_y);
        } else {
            // 5% chance: Spawn Memory Shard (RARE technological debris)
            // Lore: Violent storms dislodge ancient cognitive archives from the seafloor
            ctx.db.dropped_item().insert(DroppedItem {
                id: 0,
                item_def_id: memory_shard_id,
                quantity: 1, // Always just 1 - these are precious
                pos_x,
                pos_y,
                chunk_index: item_chunk,
                created_at: ctx.timestamp,
                item_data: None,
                spawn_x: None,
                spawn_y: None,
            });
            spawned_items += 1;
            log::info!("⚡ Storm spawned Memory Shard at ({:.1}, {:.1})!", pos_x, pos_y);
        }
    }
    
    if spawned_driftwood > 0 || spawned_items > 0 {
        log::info!("Storm debris in chunk {}: {} driftwood, {} items", 
                   chunk_index, spawned_driftwood, spawned_items);
    }
    
    Ok(())
}
