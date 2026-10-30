/******************************************************************************
 *                                                                            *
 * Building Enclosure Detection System                                        *
 *                                                                            *
 * Determines if a position is "inside" a building by:                        *
 * 1. Finding connected foundation clusters                                   *
 * 2. Calculating the perimeter of the building                               *
 * 3. Checking what percentage of the perimeter has walls                     *
 *                                                                            *
 * This enables rain protection, campfire lighting, and other mechanics       *
 * that depend on being "inside" vs "outside".                                *
 *                                                                            *
 ******************************************************************************/

use spacetimedb::{ReducerContext, Table};
use std::collections::{HashSet, VecDeque};
use crate::collision_geometry::{foundation_contains, foundation_edges, foundation_edge_key, foundation_perimeter};
use crate::building::{
    foundation_cell as FoundationCellTableTrait,
    wall_cell as WallCellTableTrait,
    FoundationCell,
    WallCell,
    FOUNDATION_TILE_SIZE_PX,
};
use crate::models::BuildingEdge;

// --- Constants ---

/// Minimum percentage of perimeter that must have walls to be considered "inside"
/// 0.70 = 70% coverage allows for 30% door/window gaps
pub const ENCLOSURE_THRESHOLD: f32 = 0.70;


// --- Core Data Structures ---

/// Represents an edge of a foundation that is on the building's perimeter
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct PerimeterEdge {
    cell_x: i32,
    cell_y: i32,
    edge: BuildingEdge,
}

/// Result of enclosure analysis
#[derive(Debug)]
pub struct EnclosureAnalysis {
    pub is_enclosed: bool,
    pub wall_coverage_ratio: f32,
    pub total_perimeter_edges: usize,
    pub covered_perimeter_edges: usize,
    pub foundation_count: usize,
}

// --- Public API ---

/// Checks if a player position is inside an enclosed building
/// 
/// Returns true if:
/// - Player is standing on a foundation that is part of a building cluster
/// - The building cluster has >= 70% wall coverage on its perimeter
pub fn is_player_inside_building(
    ctx: &ReducerContext,
    player_x: f32,
    player_y: f32,
) -> bool {
    is_position_inside_building(ctx, player_x, player_y)
}

/// Checks if any position (player, campfire, etc.) is inside an enclosed building
/// 
/// Returns true if position is inside a building with sufficient wall coverage
pub fn is_position_inside_building(
    ctx: &ReducerContext,
    world_x: f32,
    world_y: f32,
) -> bool {
    // Convert world position to foundation cell coordinates
    let cell_x = (world_x / FOUNDATION_TILE_SIZE_PX as f32).floor() as i32;
    let cell_y = (world_y / FOUNDATION_TILE_SIZE_PX as f32).floor() as i32;
    
    // Find the foundation at this position (if any)
    let foundation_opt = ctx.db.foundation_cell().idx_cell_coords().filter((cell_x, cell_y))
        .find(|f| !f.is_destroyed && foundation_contains(f.shape, world_x / FOUNDATION_TILE_SIZE_PX as f32 - cell_x as f32, world_y / FOUNDATION_TILE_SIZE_PX as f32 - cell_y as f32));
    
    let foundation = match foundation_opt {
        Some(f) => f,
        None => {
            // No foundation at this position, not inside a building
            return false;
        }
    };
    
    // Analyze the building cluster this foundation belongs to
    let analysis = analyze_building_enclosure(ctx, foundation.id);
    
    log::debug!(
        "[BuildingEnclosure] Position ({:.1}, {:.1}) on foundation ({}, {}) - Enclosed: {}, Coverage: {:.1}%, Foundations: {}",
        world_x, world_y, cell_x, cell_y,
        analysis.is_enclosed,
        analysis.wall_coverage_ratio * 100.0,
        analysis.foundation_count
    );
    
    analysis.is_enclosed
}

/// Analyzes a building cluster to determine if it's enclosed
/// 
/// This is the core function that performs:
/// 1. Foundation cluster discovery (flood fill)
/// 2. Perimeter edge calculation
/// 3. Wall coverage checking
pub fn analyze_building_enclosure(
    ctx: &ReducerContext,
    starting_foundation_id: u64,
) -> EnclosureAnalysis {
    // Step 1: Find all connected foundations (the building cluster)
    let foundation_cluster = find_connected_foundations(ctx, starting_foundation_id);
    
    if foundation_cluster.is_empty() {
        return EnclosureAnalysis {
            is_enclosed: false,
            wall_coverage_ratio: 0.0,
            total_perimeter_edges: 0,
            covered_perimeter_edges: 0,
            foundation_count: 0,
        };
    }
    
    // Step 2: Calculate perimeter edges (edges that face outside the building)
    let perimeter_edges = calculate_perimeter_edges(ctx, &foundation_cluster);
    
    if perimeter_edges.is_empty() {
        return EnclosureAnalysis {
            is_enclosed: false,
            wall_coverage_ratio: 0.0,
            total_perimeter_edges: 0,
            covered_perimeter_edges: 0,
            foundation_count: foundation_cluster.len(),
        };
    }
    
    // Step 3: Check how many perimeter edges have walls
    let covered_edges = count_covered_perimeter_edges(ctx, &perimeter_edges);
    
    // Step 4: Calculate coverage ratio
    let coverage_ratio = covered_edges as f32 / perimeter_edges.len() as f32;
    let is_enclosed = coverage_ratio >= ENCLOSURE_THRESHOLD;
    
    EnclosureAnalysis {
        is_enclosed,
        wall_coverage_ratio: coverage_ratio,
        total_perimeter_edges: perimeter_edges.len(),
        covered_perimeter_edges: covered_edges,
        foundation_count: foundation_cluster.len(),
    }
}

// --- Core Algorithm Functions ---

/// Finds all foundations connected to the starting foundation using flood fill
/// 
/// Two foundations are considered connected if they are adjacent (within 1 cell)
fn find_connected_foundations(
    ctx: &ReducerContext,
    starting_foundation_id: u64,
) -> Vec<FoundationCell> {
    let mut cluster = Vec::new();
    let mut visited = HashSet::new();
    let mut to_visit = VecDeque::new();
    
    // Start with the initial foundation
    to_visit.push_back(starting_foundation_id);
    
    while let Some(current_id) = to_visit.pop_front() {
        // Skip if already visited
        if visited.contains(&current_id) {
            continue;
        }
        visited.insert(current_id);
        
        // Get the current foundation
        let current_foundation = match ctx.db.foundation_cell().id().find(&current_id) {
            Some(f) if !f.is_destroyed => f,
            _ => continue, // Skip destroyed or missing foundations
        };
        
        // Add to cluster
        cluster.push(current_foundation.clone());
        
        // Find all adjacent foundations and add them to the queue
        for dx in -1..=1 { for dy in -1..=1 { for other_foundation in ctx.db.foundation_cell().idx_cell_coords().filter((current_foundation.cell_x+dx, current_foundation.cell_y+dy)) {
            // Skip if already visited or destroyed
            if visited.contains(&other_foundation.id) || other_foundation.is_destroyed {
                continue;
            }
            
            // Check if foundations are adjacent
            if are_foundations_adjacent(&current_foundation, &other_foundation) {
                to_visit.push_back(other_foundation.id);
            }
        }}}
    }
    
    log::debug!(
        "[BuildingEnclosure] Found foundation cluster of {} foundations starting from foundation {}",
        cluster.len(),
        starting_foundation_id
    );
    
    cluster
}

/// Checks if two foundations are adjacent (share an edge or are within 1 cell)
fn are_foundations_adjacent(a: &FoundationCell, b: &FoundationCell) -> bool {
    foundation_edges(a.shape).iter().any(|&edge| {
        let key=foundation_edge_key(a.cell_x,a.cell_y,a.shape,edge);
        foundation_edges(b.shape).iter().any(|&other| key==foundation_edge_key(b.cell_x,b.cell_y,b.shape,other))
    })
}

/// Calculates all perimeter edges of a building cluster
/// 
/// A perimeter edge is an edge of a foundation that does NOT have an adjacent foundation
fn calculate_perimeter_edges(
    ctx: &ReducerContext,
    foundation_cluster: &[FoundationCell],
) -> Vec<PerimeterEdge> {
    let cells:Vec<_>=foundation_cluster.iter().map(|f|(f.cell_x,f.cell_y,f.shape)).collect();
    foundation_perimeter(&cells).into_iter().map(|(cell_x,cell_y,edge)|PerimeterEdge {
        cell_x,cell_y,edge:match edge {0=>BuildingEdge::N,1=>BuildingEdge::E,2=>BuildingEdge::S,3=>BuildingEdge::W,4=>BuildingEdge::DiagNE_SW,_=>BuildingEdge::DiagNW_SE}
    }).collect()
}

/// Gets the cell coordinates of the adjacent cell in a given direction
fn get_adjacent_cell_coords(cell_x: i32, cell_y: i32, edge: BuildingEdge) -> (i32, i32) {
    match edge {
        BuildingEdge::N => (cell_x, cell_y - 1), // North is -Y
        BuildingEdge::E => (cell_x + 1, cell_y),  // East is +X
        BuildingEdge::S => (cell_x, cell_y + 1), // South is +Y
        BuildingEdge::W => (cell_x - 1, cell_y),  // West is -X
        _ => (cell_x, cell_y), // Diagonal edges don't have simple adjacent cells
    }
}

/// Counts how many perimeter edges have walls on them
fn count_covered_perimeter_edges(
    ctx: &ReducerContext,
    perimeter_edges: &[PerimeterEdge],
) -> usize {
    let mut covered_count = 0;
    
    // Get all non-destroyed walls for quick lookup
    let walls: Vec<WallCell> = ctx.db.wall_cell().iter()
        .filter(|w| !w.is_destroyed)
        .collect();
    
    // Check each perimeter edge
    for edge in perimeter_edges {
        // Check if a wall exists at this position and edge
        let has_wall = walls.iter().any(|wall| {
            wall.cell_x == edge.cell_x &&
            wall.cell_y == edge.cell_y &&
            building_edge_matches(wall.edge, edge.edge)
        });
        
        if has_wall {
            covered_count += 1;
        }
    }
    
    log::debug!(
        "[BuildingEnclosure] {} out of {} perimeter edges have walls ({:.1}% coverage)",
        covered_count,
        perimeter_edges.len(),
        (covered_count as f32 / perimeter_edges.len() as f32) * 100.0
    );
    
    covered_count
}

/// Checks if a wall edge value matches a BuildingEdge
fn building_edge_matches(wall_edge: u8, perimeter_edge: BuildingEdge) -> bool {
    let wall_edge_enum = match wall_edge {
        0 => BuildingEdge::N,
        1 => BuildingEdge::E,
        2 => BuildingEdge::S,
        3 => BuildingEdge::W,
        4 => BuildingEdge::DiagNE_SW,
        5 => BuildingEdge::DiagNW_SE,
        _ => return false, // Invalid edge value
    };
    
    wall_edge_enum == perimeter_edge
}

// --- Debug / Utility Functions ---

/// Gets detailed enclosure information for debugging (can be called from reducers)
pub fn get_enclosure_info(
    ctx: &ReducerContext,
    world_x: f32,
    world_y: f32,
) -> Option<EnclosureAnalysis> {
    let cell_x = (world_x / FOUNDATION_TILE_SIZE_PX as f32).floor() as i32;
    let cell_y = (world_y / FOUNDATION_TILE_SIZE_PX as f32).floor() as i32;
    
    let foundation = ctx.db.foundation_cell().idx_cell_coords().filter((cell_x,cell_y))
        .find(|f| !f.is_destroyed && foundation_contains(f.shape,world_x / FOUNDATION_TILE_SIZE_PX as f32-cell_x as f32,world_y / FOUNDATION_TILE_SIZE_PX as f32-cell_y as f32))?;
    
    Some(analyze_building_enclosure(ctx, foundation.id))
}

