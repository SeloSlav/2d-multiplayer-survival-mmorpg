// client/src/config/gameConfig.ts
// ------------------------------------
// Centralizes client-side configuration values primarily used for rendering.
// These values define how the game world *looks* on the client.
// The server maintains its own authoritative values for game logic and validation,
// so modifying these client-side values does not pose a security risk.
// ------------------------------------

// Define base values first
const TILE_SIZE = 48;
const MINIMAP_GRID_DIAGONAL_TILES = 101; // Use the user's desired value (tunable)

// --- Server World & Chunk Configuration (Client-Side Assumption - TODO: Make Server-Driven) ---
// These values MUST match the server's current world generation settings.
const SERVER_WORLD_WIDTH_TILES = 500; // Assumed width of the server world in tiles (matches lib.rs)
const SERVER_WORLD_HEIGHT_TILES = 500; // Assumed height of the server world in tiles (matches lib.rs)
const CHUNK_SIZE_TILES = 20;         // Number of tiles along one edge of a square chunk

// Calculate derived values
const CHUNK_SIZE_PX = CHUNK_SIZE_TILES * TILE_SIZE; // Size of a chunk in pixels (960)
const WORLD_WIDTH_CHUNKS = Math.ceil(SERVER_WORLD_WIDTH_TILES / CHUNK_SIZE_TILES); // Width of the world in chunks (25)
const WORLD_HEIGHT_CHUNKS = Math.ceil(SERVER_WORLD_HEIGHT_TILES / CHUNK_SIZE_TILES); // Height of the world in chunks (25)
// --- End Server World & Chunk Config ---

// Calculate derived values for minimap
const MINIMAP_GRID_CELL_SIZE_PIXELS = Math.round((MINIMAP_GRID_DIAGONAL_TILES / Math.SQRT2) * TILE_SIZE);

export const gameConfig = {
  // Visual size of each grid tile in pixels.
  // Used for drawing the background grid and scaling visual elements.
  tileSize: TILE_SIZE,

  // --- World & Chunk Configuration ---
  // Values below are based on server config assumptions - should ideally be server-driven.
  serverWorldWidthTiles: SERVER_WORLD_WIDTH_TILES,
  serverWorldHeightTiles: SERVER_WORLD_HEIGHT_TILES,
  chunkSizeTiles: CHUNK_SIZE_TILES,
  chunkSizePx: CHUNK_SIZE_PX,
  worldWidthChunks: WORLD_WIDTH_CHUNKS,
  worldHeightChunks: WORLD_HEIGHT_CHUNKS,
  worldWidth: 500,
  worldHeight: 500,
  // --- End World & Chunk Config ---

  // Intrinsic pixel dimensions of a single frame within player/entity spritesheets.
  // Essential for selecting and drawing the correct sprite visuals.
  spriteWidth: 48,
  spriteHeight: 48,

  // --- Minimap Configuration ---
  // Target diagonal distance (in tiles) a grid cell should represent.
  // Used to dynamically calculate grid cell pixel size.
  minimapGridCellDiagonalTiles: MINIMAP_GRID_DIAGONAL_TILES, // Assign the constant

  // Calculated grid cell size in pixels based on the diagonal tile target.
  // Avoids hardcoding pixel size directly.
  minimapGridCellSizePixels: MINIMAP_GRID_CELL_SIZE_PIXELS, // Assign the calculated value
};

// --- Rendering & Interaction Constants ---

export const MOVEMENT_POSITION_THRESHOLD = 0.1; // Small threshold to account for float precision

// --- Jump Constants ---
export const JUMP_DURATION_MS = 400; // Total duration of the jump animation
export const JUMP_HEIGHT_PX = 40; // Maximum height the player reaches

// --- Day/Night Constants (Must match server/world_state.rs) ---
export const FULL_MOON_CYCLE_INTERVAL = 3;
export const CAMPFIRE_LIGHT_RADIUS_BASE = 150;
export const CAMPFIRE_FLICKER_AMOUNT = 5; // Max pixels radius will change by
// Warmer light colors
export const CAMPFIRE_LIGHT_INNER_COLOR = 'rgba(255, 180, 80, 0.35)'; // Warmer orange/yellow, slightly more opaque
export const CAMPFIRE_LIGHT_OUTER_COLOR = 'rgba(255, 100, 0, 0.0)';  // Fade to transparent orange
export const CAMPFIRE_WIDTH_PREVIEW = 64;
export const CAMPFIRE_HEIGHT_PREVIEW = 64;
// Constants still referenced by GameCanvas or its utils (re-exported for clarity)
// Note: Ideally, these might live ONLY in their respective util files if not needed globally
export { CAMPFIRE_HEIGHT } from '../utils/renderers/campfireRenderingUtils'; // Example: Keep export for now
export { BOX_HEIGHT } from '../utils/renderers/woodenStorageBoxRenderingUtils'; // Example: Keep export for now

// --- Sleeping Bag Dimensions ---
export const SLEEPING_BAG_WIDTH = 64; // Define desired width
export const SLEEPING_BAG_HEIGHT = 64; // Define desired height

// --- Interaction Constants ---
export const PLAYER_MUSHROOM_INTERACTION_DISTANCE_SQUARED = 64.0 * 64.0; // Matches server constant (64px)
export const PLAYER_CAMPFIRE_INTERACTION_DISTANCE_SQUARED = 64.0 * 64.0; // Matches server constant (64px)
export const PLAYER_BOX_INTERACTION_DISTANCE_SQUARED = 64.0 * 64.0; // Matches server constant
export const PLAYER_DROPPED_ITEM_INTERACTION_DISTANCE_SQUARED = 64.0 * 64.0; // Reuse distance for now
export const PLAYER_CORPSE_INTERACTION_DISTANCE_SQUARED = 64.0 * 64.0; // Added for player corpses
export const PLAYER_STASH_INTERACTION_DISTANCE_SQUARED = 48.0 * 48.0;
export const PLAYER_STASH_SURFACE_INTERACTION_DISTANCE_SQUARED = 24.0 * 24.0;

// Stash dimensions (Added)
export const STASH_WIDTH = 48;
export const STASH_HEIGHT = 48;

export const HOLD_INTERACTION_DURATION_MS = 250;

// Day/Night Color Points (Needed for keyframes in colorUtils)
export interface ColorPoint {
  r: number; g: number; b: number; a: number;
}

// Default night: Dark, desaturated blue/grey
export const defaultPeakMidnightColor: ColorPoint = { r: 15, g: 20, b: 30, a: 0.92 };
export const defaultTransitionNightColor: ColorPoint = { r: 40, g: 50, b: 70, a: 0.75 };

// Full Moon night: Brighter, cooler grey/blue, less saturated
export const fullMoonPeakMidnightColor: ColorPoint =    { r: 90, g: 110, b: 130, a: 0.48 }; // Slightly brighter, less saturated blue-grey
export const fullMoonTransitionNightColor: ColorPoint = { r: 75, g: 100, b: 125, a: 0.58 }; // Slightly desaturated cooler transition

// Base keyframes (Will be used by colorUtils)
export const baseKeyframes: Record<number, ColorPoint> = {
  // Use default peak midnight color as the base for 0.00/1.00
  0.00: defaultPeakMidnightColor,
  // Use default transition night color as base for 0.20 and 0.95
  0.20: defaultTransitionNightColor,
  // Dawn: Soft pink/orange hues
  0.35: { r: 255, g: 180, b: 120, a: 0.25 },
  // Noon: Clear (transparent)
  0.50: { r: 0, g: 0, b: 0, a: 0.0 },
  // Afternoon: Warm golden tint
  0.65: { r: 255, g: 210, b: 150, a: 0.15 },
  // Dusk: Softer orange/purple hues
  0.75: { r: 255, g: 150, b: 100, a: 0.35 },
  // Fading Dusk: Muted deep purple/grey
  0.85: { r: 80, g: 70, b: 90, a: 0.60 },
  // Use default transition night color as base for 0.20 and 0.95
  0.95: defaultTransitionNightColor,
  // Use default peak midnight color as the base for 0.00/1.00
  1.00: defaultPeakMidnightColor,
};

// --- Stat Thresholds (must match server/player_stats.rs) ---