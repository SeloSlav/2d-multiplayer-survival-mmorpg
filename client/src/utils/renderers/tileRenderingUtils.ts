import grassTile from '../../assets/tiles/grass.png';
import dirtTile from '../../assets/tiles/dirt.png';
import seaTile from '../../assets/tiles/sea.png';
import beachTile from '../../assets/tiles/beach.png';

export interface TileAssetConfig {
    baseTexture: string;
    variants?: string[]; // For tile variations
    animationFrames?: string[]; // For animated tiles like water
    animationSpeed?: number; // Animation speed in ms per frame
}

export const TILE_ASSETS: Record<string, TileAssetConfig> = {
    'Grass': { 
        baseTexture: grassTile,
        // Could add grass variants here later
        // variants: ['../../assets/tiles/grass_variant1.png']
    },
    'Dirt': { 
        baseTexture: dirtTile,
        // Could add dirt variants here later
        // variants: ['../../assets/tiles/dirt_variant1.png']
    },
    'DirtRoad': { 
        baseTexture: dirtTile, // Use dirt texture for roads for now
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
        // Could add beach variants here later
    },
    'Sand': {
        baseTexture: beachTile, // Use beach texture for sand for now
    },
};

export function getTileAssetKey(tileTypeName: string, variant?: number, frameIndex?: number): string {
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
    });
    
    return paths;
} 