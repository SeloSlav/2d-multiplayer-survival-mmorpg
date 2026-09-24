import { FOUNDATION_TILE_SIZE } from '../config/gameConfig';

export const DOOR_EDGE_NORTH = 0;
export const DOOR_EDGE_EAST = 1;
export const DOOR_EDGE_SOUTH = 2;
export const DOOR_EDGE_WEST = 3;

/** Choose the foundation side nearest the cursor; ties keep the front-facing edges. */
export function getDoorEdgeForCursor(cellX: number, cellY: number, worldX: number, worldY: number): number {
  const left = cellX * FOUNDATION_TILE_SIZE;
  const top = cellY * FOUNDATION_TILE_SIZE;
  const distances = [
    Math.abs(worldY - top),
    Math.abs(worldX - (left + FOUNDATION_TILE_SIZE)),
    Math.abs(worldY - (top + FOUNDATION_TILE_SIZE)),
    Math.abs(worldX - left),
  ];
  let edge = DOOR_EDGE_NORTH;
  let nearest = distances[edge];
  for (const candidate of [DOOR_EDGE_SOUTH, DOOR_EDGE_EAST, DOOR_EDGE_WEST]) {
    if (distances[candidate] < nearest) {
      edge = candidate;
      nearest = distances[candidate];
    }
  }
  return edge;
}

export function getDoorEdgePosition(cellX: number, cellY: number, edge: number): { x: number; y: number } {
  const left = cellX * FOUNDATION_TILE_SIZE;
  const top = cellY * FOUNDATION_TILE_SIZE;
  const half = FOUNDATION_TILE_SIZE / 2;
  switch (edge) {
    case DOOR_EDGE_NORTH: return { x: left + half, y: top };
    case DOOR_EDGE_EAST: return { x: left + FOUNDATION_TILE_SIZE, y: top + half };
    case DOOR_EDGE_SOUTH: return { x: left + half, y: top + FOUNDATION_TILE_SIZE };
    case DOOR_EDGE_WEST: return { x: left, y: top + half };
    default: return { x: left + half, y: top + half };
  }
}

export function getAdjacentDoorEdge(cellX: number, cellY: number, edge: number): { cellX: number; cellY: number; edge: number } {
  switch (edge) {
    case DOOR_EDGE_NORTH: return { cellX, cellY: cellY - 1, edge: DOOR_EDGE_SOUTH };
    case DOOR_EDGE_EAST: return { cellX: cellX + 1, cellY, edge: DOOR_EDGE_WEST };
    case DOOR_EDGE_SOUTH: return { cellX, cellY: cellY + 1, edge: DOOR_EDGE_NORTH };
    default: return { cellX: cellX - 1, cellY, edge: DOOR_EDGE_EAST };
  }
}

/** Triangle foundations only have two cardinal sides; their diagonal cannot hold a door. */
export function isDoorEdgeOnFoundation(shape: number, edge: number): boolean {
  switch (shape) {
    case 1: return true; // Full
    case 2: return edge === DOOR_EDGE_NORTH || edge === DOOR_EDGE_WEST;
    case 3: return edge === DOOR_EDGE_NORTH || edge === DOOR_EDGE_EAST;
    case 4: return edge === DOOR_EDGE_SOUTH || edge === DOOR_EDGE_EAST;
    case 5: return edge === DOOR_EDGE_SOUTH || edge === DOOR_EDGE_WEST;
    default: return false;
  }
}
