import { gameConfig } from '../../config/gameConfig';
import { TILE_ASSETS, getTileAssetKey } from './tileRenderingUtils';
import { WorldTile } from '../../generated/world_tile_type';
import { TileType } from '../../generated/tile_type_type';

interface TileCache {
    tiles: Map<string, WorldTile>;
    images: Map<string, HTMLImageElement>;
    lastUpdate: number;
}

export class ProceduralWorldRenderer {
    private tileCache: TileCache = {
        tiles: new Map(),
        images: new Map(),
        lastUpdate: 0
    };
    
    private animationTime = 0;
    private isInitialized = false;
    
    constructor() {
        this.preloadTileAssets();
    }
    
    private async preloadTileAssets() {
        const promises: Promise<void>[] = [];
        
        Object.entries(TILE_ASSETS).forEach(([tileType, config]) => {
            // Load base texture
            promises.push(this.loadImage(config.baseTexture, `${tileType}_base`));
            
            // Load variants if they exist
            config.variants?.forEach((variant, index) => {
                promises.push(this.loadImage(variant, `${tileType}_variant${index}`));
            });
            
            // Load animation frames if they exist
            config.animationFrames?.forEach((frame, index) => {
                promises.push(this.loadImage(frame, `${tileType}_frame${index}`));
            });
        });
        
        try {
            await Promise.all(promises);
            this.isInitialized = true;
            console.log('[ProceduralWorldRenderer] All tile assets preloaded successfully');
        } catch (error) {
            console.error('[ProceduralWorldRenderer] Failed to preload tile assets:', error);
        }
    }
    
    private loadImage(src: string, key: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                this.tileCache.images.set(key, img);
                resolve();
            };
            img.onerror = (error) => {
                console.error(`[ProceduralWorldRenderer] Failed to load image ${key} from ${src}:`, error);
                reject(error);
            };
            img.src = src;
        });
    }
    
    public updateTileCache(worldTiles: Map<string, WorldTile>) {
        this.tileCache.tiles.clear();
        
        // Convert the worldTiles map to use world coordinates as keys
        worldTiles.forEach((tile) => {
            const tileKey = `${tile.worldX}_${tile.worldY}`;
            this.tileCache.tiles.set(tileKey, tile);
        });
        
        this.tileCache.lastUpdate = Date.now();
    }
    
    public renderProceduralWorld(
        ctx: CanvasRenderingContext2D,
        cameraOffsetX: number,
        cameraOffsetY: number,
        canvasWidth: number,
        canvasHeight: number,
        deltaTime: number
    ) {
        if (!this.isInitialized) {
            // Fallback to simple grass color if assets not loaded yet
            ctx.fillStyle = '#8FBC8F';
            ctx.fillRect(0, 0, canvasWidth, canvasHeight);
            return;
        }
        
        this.animationTime += deltaTime;
        
        const { tileSize } = gameConfig;
        
        // Calculate visible tile range
        const viewMinX = -cameraOffsetX;
        const viewMinY = -cameraOffsetY;
        const viewMaxX = viewMinX + canvasWidth;
        const viewMaxY = viewMinY + canvasHeight;
        
        const startTileX = Math.max(0, Math.floor(viewMinX / tileSize));
        const endTileX = Math.min(gameConfig.worldWidth, Math.ceil(viewMaxX / tileSize));
        const startTileY = Math.max(0, Math.floor(viewMinY / tileSize));
        const endTileY = Math.min(gameConfig.worldHeight, Math.ceil(viewMaxY / tileSize));
        
        // Render tiles
        let tilesRendered = 0;
        for (let y = startTileY; y < endTileY; y++) {
            for (let x = startTileX; x < endTileX; x++) {
                this.renderTileAt(ctx, x, y, tileSize);
                tilesRendered++;
            }
        }
    }
    
    private renderTileAt(
        ctx: CanvasRenderingContext2D, 
        tileX: number, 
        tileY: number, 
        tileSize: number
    ) {
        const tileKey = `${tileX}_${tileY}`;
        const tile = this.tileCache.tiles.get(tileKey);
        
        // Calculate pixel-perfect positions to avoid gaps
        const pixelX = Math.floor(tileX * tileSize);
        const pixelY = Math.floor(tileY * tileSize);
        const pixelSize = Math.ceil(tileSize); // Ensure we cover the full tile area
        
        if (!tile) {
            // Fallback to grass if no tile data
            const grassImg = this.tileCache.images.get('Grass_base');
            if (grassImg && grassImg.complete && grassImg.naturalHeight !== 0) {
                ctx.drawImage(grassImg, pixelX, pixelY, pixelSize, pixelSize);
            } else {
                // Ultimate fallback - solid color
                ctx.fillStyle = '#8FBC8F';
                ctx.fillRect(pixelX, pixelY, pixelSize, pixelSize);
            }
            return;
        }
        
        const image = this.getTileImage(tile);
        if (image && image.complete && image.naturalHeight !== 0) {
            ctx.drawImage(image, pixelX, pixelY, pixelSize, pixelSize);
        } else {
            // Fallback based on tile type
            this.renderFallbackTile(ctx, tile, pixelX, pixelY, pixelSize);
        }
    }
    
    private getTileImage(tile: WorldTile): HTMLImageElement | null {
        // Handle the tile type (it's a tagged union with a .tag property)
        const tileTypeName = tile.tileType.tag;
        const config = TILE_ASSETS[tileTypeName];
        
        if (!config) {
            console.warn(`[ProceduralWorldRenderer] No asset config for tile type: ${tileTypeName}`);
            return null;
        }
        
        // Handle animated tiles (like water)
        if (config.animationFrames && config.animationFrames.length > 0) {
            const animSpeed = config.animationSpeed || 1000;
            const frameIndex = Math.floor(this.animationTime / animSpeed) % config.animationFrames.length;
            const frameImg = this.tileCache.images.get(`${tileTypeName}_frame${frameIndex}`);
            if (frameImg) return frameImg;
        }
        
        // Handle tile variants
        if (config.variants && config.variants.length > 0 && tile.variant > 128) {
            const variantIndex = tile.variant % config.variants.length;
            const variantImg = this.tileCache.images.get(`${tileTypeName}_variant${variantIndex}`);
            if (variantImg) return variantImg;
        }
        
        // Return base texture
        return this.tileCache.images.get(`${tileTypeName}_base`) || null;
    }
    
    private renderFallbackTile(
        ctx: CanvasRenderingContext2D, 
        tile: WorldTile, 
        x: number, 
        y: number, 
        size: number
    ) {
        const tileTypeName = tile.tileType.tag;
        
        // Fallback colors based on tile type
        switch (tileTypeName) {
            case 'Grass':
                ctx.fillStyle = '#8FBC8F';
                break;
            case 'Dirt':
            case 'DirtRoad':
                ctx.fillStyle = '#8B4513';
                break;
            case 'Sea':
                ctx.fillStyle = '#4682B4';
                break;
            case 'Beach':
            case 'Sand':
                ctx.fillStyle = '#F4A460';
                break;
            default:
                ctx.fillStyle = '#8FBC8F'; // Default to grass color
        }
        
        ctx.fillRect(x, y, size, size);
    }
    
    public getCacheStats() {
        return {
            tilesLoaded: this.tileCache.tiles.size,
            imagesLoaded: this.tileCache.images.size,
            isInitialized: this.isInitialized,
            lastUpdate: this.tileCache.lastUpdate
        };
    }
} 