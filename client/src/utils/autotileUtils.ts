import { WorldTile } from '../generated/world_tile_type';

/**
 * Autotile system for handling seamless transitions between different tile types
 * using bitmask-based tile selection from a 3x3 minimal autotile set.
 * 
 * This system supports the standard RPG Maker/Godot autotile format with 47 total tiles.
 */

// 8-directional neighbors for bitmask calculation
const NEIGHBOR_OFFSETS = [
    { x: -1, y: -1 }, // Top-left
    { x:  0, y: -1 }, // Top
    { x:  1, y: -1 }, // Top-right
    { x: -1, y:  0 }, // Left
    { x:  1, y:  0 }, // Right
    { x: -1, y:  1 }, // Bottom-left
    { x:  0, y:  1 }, // Bottom
    { x:  1, y:  1 }, // Bottom-right
];

// Bit positions for each neighbor (following Wang tiles convention)
const NEIGHBOR_BITS = [128, 1, 2, 8, 4, 64, 32, 16]; // TL, T, TR, L, R, BL, B, BR

/**
 * Autotile configuration for different tile type combinations
 */
export interface AutotileConfig {
    primaryType: string;      // The main tile type (e.g., 'Grass')
    secondaryType: string;    // The transition tile type (e.g., 'Dirt')
    tilesetPath: string;      // Path to the autotile tileset image
    tileSize: number;         // Size of each tile in pixels (16x16)
    columns: number;          // Number of columns in the tileset (typically 6 for minimal set)
    rows: number;             // Number of rows in the tileset (typically 8 for minimal set)
}

/**
 * DEBUG OVERRIDE SYSTEM
 * Use this to test different tile positions for specific bitmask patterns
 * Format: bitmask -> tile index (0-35 for 6x6 grid)
 */
const DEBUG_OVERRIDES: { [bitmask: number]: number } = {
    200: 18,  // Test: bitmask 200 uses tile 12 (row 2, col 0)
    72: 18,
    136: 18,
    128: 3,
    201: 12,
    137: 12,
    64: 9,
    22: 20,
    16: 11,
    54: 26,
    52: 26,
    116: 26,
    23: 14,
    2: 5,
    6: 20,
    129: 13,
    112: 25,
    131: 13,
    3: 13,
    135: 14,
    139: 12,
    7: 14,
    24: 9,
    120: 24,
    96: 25,
    104: 24,
    80: 25,
    48: 25,
    124: 2,
    4: 20,
    36: 11,
    32: 25,
    232: 24,
    1: 13,
    5: 14,
    17: 14,
    18: 20,
    55: 2,
    21: 14,
    73: 12,
    118: 26,
    11: 12,
    203: 12,
    133: 14,
    233: 2,
    192: 18,
    143: 2,
    130: 13,
    151: 14,
    176: 24,
    134: 14,
    159: 2,
    219: 2,
    156: 2,
    150: 14,
    181: 2,
    191: 2,
    252: 2,
    187: 2,
    247: 2,
    255: 2,
    223: 2,
    254: 2,
    222: 2,
    207: 2,
    138: 12,
    251: 2,
    225: 2,
    67: 12,
    227: 2,
    199: 2,
    98: 20,
    74: 12,
    114: 26,
    115: 2,
    66: 26,
    248: 24,
    183: 2,
    147: 14,
    224: 24,
    249: 2,
    86: 26,
    126: 2,
    51: 2,
    149: 14,
    168: 24,
    158: 2,
    239: 2,
    75: 12,
    // Add your test overrides here!
};

/**
 * Helper to convert row/col to tile index
 * Row 0-7, Col 0-5 -> Tile Index 0-47
 */
export function rowColToTileIndex(row: number, col: number): number {
    return Math.min(47, Math.max(0, row * 6 + col));
}

/**
 * Helper to convert tile index to row/col
 * Tile Index 0-47 -> {row: 0-7, col: 0-5}
 */
export function tileIndexToRowCol(tileIndex: number): {row: number, col: number} {
    const safeTileIndex = Math.min(47, Math.max(0, tileIndex));
    return {
        row: Math.floor(safeTileIndex / 6),
        col: safeTileIndex % 6
    };
}

/**
 * Minimal autotile mapping based on 3x3 Wang tiles / RPG Maker format
 * This maps bitmask values to tile positions in the autotile sheet
 * 
 * Using the canonical 47-tile system with proper normalization
 */

// Canonical 47-tile lookup table (6x8 grid)
// Each index corresponds to a bitmask, value is the tile index in spritesheet
const TILE_BY_MASK: number[] = new Array(256);

// Initialize with tile 18 (isolated) as default
TILE_BY_MASK.fill(18);

// Standard 6x6 autotile mapping (row * 6 + col = tile index, max 35)
const CANONICAL_TILES: { [mask: number]: number } = {
    // Basic patterns
    0b00000000: 18, // 0   - isolated (row 3, col 0)
    0b00000001: 19, // 1   - N only (row 3, col 1) 
    0b00000100: 13, // 4   - E only (row 2, col 1)
    0b00010000: 25, // 16  - S only (row 4, col 1)
    0b01000000: 31, // 64  - W only (row 5, col 1)
    
    // Two edges
    0b00000101: 8,  // 5   - N + E (row 1, col 2)
    0b00010001: 26, // 17  - N + S (row 4, col 2) 
    0b01000001: 32, // 65  - N + W (row 5, col 2)
    0b00010100: 20, // 20  - E + S (row 3, col 2)
    0b01000100: 14, // 68  - E + W (row 2, col 2)
    0b01010000: 27, // 80  - S + W (row 4, col 3)
    
    // Three edges (T-junctions)
    0b00010101: 21, // 21  - N + E + S (row 3, col 3)
    0b01000101: 15, // 69  - N + E + W (row 2, col 3)
    0b01010001: 33, // 81  - N + S + W (row 5, col 3)
    0b01010100: 28, // 84  - E + S + W (row 4, col 4)
    
    // Four edges (cross)
    0b01010101: 22, // 85  - N + E + S + W (row 3, col 4)
    
    // Corners with context
    0b00000011: 6,  // 3   - N + NE (row 1, col 0)
    0b00000110: 9,  // 6   - NE + E (row 1, col 3)
    0b00001100: 16, // 12  - E + SE (row 2, col 4)
    0b00011000: 23, // 24  - SE + S (row 3, col 5)
    0b00110000: 29, // 48  - S + SW (row 4, col 5)
    0b01100000: 35, // 96  - SW + W (row 5, col 5)
    0b11000000: 34, // 192 - W + NW (row 5, col 4)
    0b10000001: 7,  // 129 - NW + N (row 1, col 1)
    
    // Complex corner patterns (limited to 6x6 grid)
    0b00000111: 5,  // 7   - N + NE + E (row 0, col 5)
    0b00001110: 11, // 14  - NE + E + SE (row 1, col 5)
    0b00011100: 17, // 28  - E + SE + S (row 2, col 5)
    0b00111000: 24, // 56  - SE + S + SW (row 4, col 0)
    0b01110000: 30, // 112 - S + SW + W (row 5, col 0)
    0b11100000: 12, // 224 - SW + W + NW (row 2, col 0) - moved to valid position
    0b11000001: 1,  // 193 - W + NW + N (row 0, col 1)
    0b10000011: 25, // 131 - NW + N + NE (row 4, col 1) - dirt above, grass below horizontal edge
};

// Populate the lookup table
Object.entries(CANONICAL_TILES).forEach(([mask, tileIndex]) => {
    TILE_BY_MASK[parseInt(mask)] = tileIndex;
});

/**
 * Normalize bitmask by removing invalid diagonal neighbors
 * Diagonals are only valid if their adjacent cardinals are present
 */
function canonicalMask(mask: number): number {
    // Remove diagonals that don't have their adjacent cardinals
    if ((mask & 2) && !(mask & 1) && !(mask & 4)) mask ^= 2;    // NE
    if ((mask & 8) && !(mask & 4) && !(mask & 16)) mask ^= 8;   // SE  
    if ((mask & 32) && !(mask & 16) && !(mask & 64)) mask ^= 32; // SW
    if ((mask & 128) && !(mask & 64) && !(mask & 1)) mask ^= 128; // NW
    
    return mask;
}

/**
 * Get tile index for a given bitmask
 */
function tileForMask(mask: number): number {
    // Check debug overrides first
    if (DEBUG_OVERRIDES[mask] !== undefined) {
        return DEBUG_OVERRIDES[mask];
    }
    
    const normalized = canonicalMask(mask);
    return TILE_BY_MASK[normalized] || 18; // Default to isolated tile
}

/**
 * DEBUG: Get detailed info about a bitmask and its tile mapping
 */
export function getDebugTileInfo(bitmask: number): {
    bitmask: number;
    tileIndex: number;
    row: number;
    col: number;
    coordinates: {x: number, y: number};
    isOverridden: boolean;
} {
    const isOverridden = DEBUG_OVERRIDES[bitmask] !== undefined;
    const tileIndex = tileForMask(bitmask);
    const {row, col} = tileIndexToRowCol(tileIndex);
    
    return {
        bitmask,
        tileIndex,
        row,
        col,
        coordinates: {
            x: col * 213,
            y: row * 213
        },
        isOverridden
    };
}

/**
 * Default autotile configurations for common tile combinations
 */
export const AUTOTILE_CONFIGS: { [key: string]: AutotileConfig } = {
    'Grass_Dirt': {
        primaryType: 'Grass',
        secondaryType: 'Dirt', 
        tilesetPath: '/src/assets/tiles/tileset_grass_dirt_autotile.png',
        tileSize: 213, // Keep this for compatibility, but actual sprite size differs
        columns: 6,    // 6 columns: 1280 ÷ 6 ≈ 213.33 pixels wide
        rows: 8        // 8 rows: 1280 ÷ 8 = 160 pixels tall
    },
    'Grass_Beach': {
        primaryType: 'Grass',
        secondaryType: 'Beach',
        tilesetPath: '/src/assets/tiles/tileset_grass_beach_autotile.png',
        tileSize: 213, // Keep this for compatibility, but actual sprite size differs
        columns: 6,    // 6 columns: 1280 ÷ 6 ≈ 213.33 pixels wide
        rows: 8        // 8 rows: 1280 ÷ 8 = 160 pixels tall
    },
    'Beach_Sea': {
        primaryType: 'Beach',
        secondaryType: 'Sea',
        tilesetPath: '/src/assets/tiles/tileset_beach_sea_autotile.png',
        tileSize: 213, // Keep this for compatibility, but actual sprite size differs
        columns: 6,    // 6 columns: 1280 ÷ 6 ≈ 213.33 pixels wide
        rows: 8        // 8 rows: 1280 ÷ 8 = 160 pixels tall
    },
    // Future autotile sets can be added here
    // 'Grass_Sea': { ... },
    // 'Dirt_DirtRoad': { ... },
};

/**
 * Calculate bitmask for autotile selection based on neighboring tiles
 */
export function calculateAutotileBitmask(
    centerX: number,
    centerY: number,
    worldTiles: Map<string, WorldTile>,
    primaryType: string,
    secondaryType: string
): number {
    let bitmask = 0;
    
    NEIGHBOR_OFFSETS.forEach((offset, index) => {
        const neighborX = centerX + offset.x;
        const neighborY = centerY + offset.y;
        const neighborKey = `${neighborX}_${neighborY}`;
        const neighborTile = worldTiles.get(neighborKey);
        
        // Check if neighbor matches the secondary type (the type we're transitioning TO)
        if (neighborTile && neighborTile.tileType.tag === secondaryType) {
            bitmask |= NEIGHBOR_BITS[index];
        }
    });
    
    return bitmask;
}

/**
 * Get autotile position for rendering from a tile index
 */
export function getAutotilePosition(tileIndex: number, config: AutotileConfig): { x: number; y: number } {
    // Clamp to valid range for 6x8 grid (0-47)
    const safeTileIndex = Math.max(0, Math.min(47, tileIndex));
    
    const col = safeTileIndex % 6; // 6 columns in the grid
    const row = Math.floor(safeTileIndex / 6);
    
    // Use correct sprite dimensions: 213.33×160 pixels
    const spriteWidth = 1280 / 6;  // ≈ 213.33 pixels
    const spriteHeight = 1280 / 8; // = 160 pixels
    
    return {
        x: Math.floor(col * spriteWidth),
        y: Math.floor(row * spriteHeight)
    };
}

/**
 * Check if a tile type combination should use autotiling
 */
export function shouldUseAutotiling(
    tileType: string,
    worldTiles: Map<string, WorldTile>,
    x: number,
    y: number
): { config: AutotileConfig; bitmask: number } | null {
    // Check each autotile configuration to see if this tile should use autotiling
    for (const [configKey, config] of Object.entries(AUTOTILE_CONFIGS)) {
        // Check if this tile is the primary type and has neighbors of the secondary type
        if (tileType === config.primaryType) {
            const bitmask = calculateAutotileBitmask(x, y, worldTiles, config.primaryType, config.secondaryType);
            
            // Only use autotiling if there are neighboring secondary tiles
            if (bitmask > 0) {
                return { config, bitmask };
            }
        }
    }
    
    return null;
}

/**
 * Get the sprite sheet coordinates for a specific autotile
 */
export function getAutotileSpriteCoords(
    config: AutotileConfig,
    bitmask: number
): { x: number, y: number, width: number, height: number } {
    const tileIndex = tileForMask(bitmask);
    const position = getAutotilePosition(tileIndex, config);
    
    // Use correct sprite dimensions: 213.33×160 pixels
    const spriteWidth = 1280 / 6;  // ≈ 213.33 pixels
    const spriteHeight = 1280 / 8; // = 160 pixels
    
    return {
        x: position.x,
        y: position.y,
        width: Math.floor(spriteWidth),
        height: Math.floor(spriteHeight)
    };
}

/**
 * Helper function to debug autotile bitmasks
 */
export function debugAutotileBitmask(bitmask: number): string {
    const neighbors = [];
    if (bitmask & 128) neighbors.push('TL');
    if (bitmask & 1) neighbors.push('T');
    if (bitmask & 2) neighbors.push('TR');
    if (bitmask & 8) neighbors.push('L');
    if (bitmask & 4) neighbors.push('R');
    if (bitmask & 64) neighbors.push('BL');
    if (bitmask & 32) neighbors.push('B');
    if (bitmask & 16) neighbors.push('BR');
    
    return `Bitmask ${bitmask}: [${neighbors.join(', ')}]`;
} 