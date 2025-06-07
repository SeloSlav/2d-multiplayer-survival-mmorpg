// client/src/config/gameConfig.ts
// ------------------------------------
// Centralizes client-side configuration values primarily used for rendering.
// These values define how the game world *looks* on the client.
// The server maintains its own authoritative values for game logic and validation,
// so modifying these client-side values does not pose a security risk.
// ------------------------------------

// Define base values first
const TILE_SIZE = 48;
export { TILE_SIZE };
const MINIMAP_GRID_DIAGONAL_TILES = 51; // Use the user's desired value (tunable)

// --- Server World & Chunk Configuration (Client-Side Assumption - TODO: Make Server-Driven) ---
// These values MUST match the server's current world generation settings.
const SERVER_WORLD_WIDTH_TILES = 500; // Assumed width of the server world in tiles (matches lib.rs)
const SERVER_WORLD_HEIGHT_TILES = 500; // Assumed height of the server world in tiles (matches lib.rs)
const CHUNK_SIZE_TILES = 10;         // Number of tiles along one edge of a square chunk

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

// --- Stat Thresholds (must match server/player_stats.rs) ---
export const MAX_STAT_VALUE = 100;
export const MIN_STAT_VALUE = 0;

// --- Campfire & Torch Light Constants ---
export const CAMPFIRE_LIGHT_RADIUS_BASE = 100; // Base radius for campfire light
export const CAMPFIRE_FLICKER_AMOUNT = 0.1; // Amount of flicker for campfire light
export const CAMPFIRE_LIGHT_INNER_COLOR = '#ffaa00'; // Inner color of campfire light
export const CAMPFIRE_LIGHT_OUTER_COLOR = '#ff6600'; // Outer color of campfire light