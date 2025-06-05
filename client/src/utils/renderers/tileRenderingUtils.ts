import grassTile from '../../assets/tiles/grass2.png';
import dirtTile from '../../assets/tiles/dirt.png';
import dirtRoadTile from '../../assets/tiles/dirt_road.png';
import seaTile from '../../assets/tiles/sea2.png';
import beachTile from '../../assets/tiles/beach3.png';
// Import autotile assets
import grassDirtAutotile from '../../assets/tiles/tileset_grass_dirt_autotile.png';
import beachSeaAutotile from '../../assets/tiles/tileset_beach_sea_autotile.png';

export interface TileAssetConfig {
    baseTexture: string;
    variants?: string[]; // For tile variations
    animationFrames?: string[]; // For animated tiles like water
    animationSpeed?: number; // Animation speed in ms per frame
    // New: Autotile support
    autotileSheet?: string; // Path to autotile sheet for transitions
    autotileSize?: number;  // Size of each autotile in pixels
    autotileColumns?: number; // Number of columns in autotile sheet
    autotileRows?: number;    // Number of rows in autotile sheet
}

export const TILE_ASSETS: Record<string, TileAssetConfig> = {
    'Grass': { 
        baseTexture: grassTile,
        // Autotile configuration for grass-dirt transitions
        autotileSheet: grassDirtAutotile,
        autotileSize: 213, // 1280 ÷ 6 ≈ 213 pixels per sprite
        autotileColumns: 6,
        autotileRows: 6,
        // Could add grass variants here later
        // variants: ['../../assets/tiles/grass_variant1.png']
    },
    'Dirt': { 
        baseTexture: dirtTile,
        // Could add dirt variants here later
        // variants: ['../../assets/tiles/dirt_variant1.png']
    },
    'DirtRoad': { 
        baseTexture: dirtRoadTile,
    },
    'Sea': { 
        baseTexture: seaTile,
        // Could add water animation frames here later
        // animationFrames: [
        //     '../../assets/tiles/sea_frame1.png',
        //     '../../assets/tiles/sea_frame2.png',
        // ],
        // animationSpeed: 1000, // 1 second per frame
    },
    'Beach': { 
        baseTexture: beachTile,
        // Autotile configuration for beach-sea transitions
        autotileSheet: beachSeaAutotile,
        autotileSize: 213, // 1280 ÷ 6 ≈ 213 pixels per sprite
        autotileColumns: 6,
        autotileRows: 8,
        // Could add beach variants here later
    },
    'Sand': {
        baseTexture: beachTile, // Use beach texture for sand for now
    },
};

export function getTileAssetKey(tileTypeName: string, variant?: number, frameIndex?: number, autotileKey?: string): string {
    if (autotileKey) {
        return `${tileTypeName}_autotile_${autotileKey}`;
    }
    if (frameIndex !== undefined) {
        return `${tileTypeName}_frame${frameIndex}`;
    }
    if (variant !== undefined && variant > 128) {
        return `${tileTypeName}_variant${variant}`;
    }
    return `${tileTypeName}_base`;
}

export function getAllTileAssetPaths(): string[] {
    const paths: string[] = [];
    
    Object.entries(TILE_ASSETS).forEach(([tileType, config]) => {
        paths.push(config.baseTexture);
        
        if (config.variants) {
            paths.push(...config.variants);
        }
        
        if (config.animationFrames) {
            paths.push(...config.animationFrames);
        }
        
        // Add autotile sheets
        if (config.autotileSheet) {
            paths.push(config.autotileSheet);
        }
    });
    
    return paths;
}

/**
 * Check if a tile type supports autotiling
 */
export function hasAutotileSupport(tileTypeName: string): boolean {
    const config = TILE_ASSETS[tileTypeName];
    return config && !!config.autotileSheet;
}

/**
 * Get autotile configuration for a tile type
 */
export function getAutotileConfig(tileTypeName: string): {
    sheet: string;
    size: number;
    columns: number;
    rows: number;
} | null {
    const config = TILE_ASSETS[tileTypeName];
    if (!config || !config.autotileSheet) {
        return null;
    }
    
    return {
        sheet: config.autotileSheet,
        size: config.autotileSize || 16,
        columns: config.autotileColumns || 6,
        rows: config.autotileRows || 8
    };
} 