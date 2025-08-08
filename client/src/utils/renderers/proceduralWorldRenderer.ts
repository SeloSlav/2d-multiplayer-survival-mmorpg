import { gameConfig } from '../../config/gameConfig';
import { TILE_ASSETS, hasAutotileSupport, getAutotileConfig } from './tileRenderingUtils';
import { WorldTile } from '../../generated/world_tile_type';
import { shouldUseAutotiling, getAutotileSpriteCoords, getDebugTileInfo, AutotileConfig, AUTOTILE_CONFIGS } from '../autotileUtils';
// Import autotile images directly
import grassDirtAutotile from '../../assets/tiles/tileset_grass_dirt_autotile.png';
import grassBeachAutotile from '../../assets/tiles/tileset_grass_beach_autotile.png';
import beachSeaAutotile from '../../assets/tiles/tileset_beach_sea_autotile.png';

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
            
            // Load autotile sheets if they exist
            if (config.autotileSheet) {
                promises.push(this.loadImage(config.autotileSheet, `${tileType}_autotile`));
            }
        });

        // Load specific autotile images using the imported assets
        // Grass-Dirt transition
        promises.push(this.loadImage(grassDirtAutotile, 'transition_Grass_Dirt'));
        // Grass-Beach transition  
        promises.push(this.loadImage(grassBeachAutotile, 'transition_Grass_Beach'));
        // Beach-Sea transition
        promises.push(this.loadImage(beachSeaAutotile, 'transition_Beach_Sea'));
        
        try {
            await Promise.all(promises);
            this.isInitialized = true;
            console.log('[ProceduralWorldRenderer] Loaded transition autotiles: Grass_Dirt, Grass_Beach, Beach_Sea');
        } catch (error) {
            // console.error('[ProceduralWorldRenderer] Failed to preload tile assets:', error);
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
                // console.error(`[ProceduralWorldRenderer] Failed to load image ${key} from ${src}:`, error);
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
        // Only log significant cache updates
        if (this.tileCache.tiles.size % 1000 === 0) {
            console.log(`[TILES] Cache now contains ${this.tileCache.tiles.size} tiles`);
        }
    }
    
    public renderProceduralWorld(
        ctx: CanvasRenderingContext2D,
        cameraOffsetX: number,
        cameraOffsetY: number,
        canvasWidth: number,
        canvasHeight: number,
        deltaTime: number,
        showDebugOverlay: boolean = false
    ) {
        if (!this.isInitialized) {
            // Fallback to simple grass color if assets not loaded yet
            ctx.fillStyle = '#8FBC8F';
            ctx.fillRect(0, 0, canvasWidth, canvasHeight);
            return;
        }
        
        // Enable pixel-perfect rendering for crisp autotiles
        ctx.imageSmoothingEnabled = false;
        if ('webkitImageSmoothingEnabled' in ctx) {
            (ctx as any).webkitImageSmoothingEnabled = false;
        }
        if ('mozImageSmoothingEnabled' in ctx) {
            (ctx as any).mozImageSmoothingEnabled = false;
        }
        if ('msImageSmoothingEnabled' in ctx) {
            (ctx as any).msImageSmoothingEnabled = false;
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
                this.renderTileAt(ctx, x, y, tileSize, showDebugOverlay);
                tilesRendered++;
            }
        }
    }
    
    private renderTileAt(
        ctx: CanvasRenderingContext2D, 
        tileX: number, 
        tileY: number, 
        tileSize: number,
        showDebugOverlay: boolean = false
    ) {
        const tileKey = `${tileX}_${tileY}`;
        const tile = this.tileCache.tiles.get(tileKey);
        
        // Calculate pixel-perfect positions - use exact pixel alignment
        const pixelX = Math.floor(tileX * tileSize);
        const pixelY = Math.floor(tileY * tileSize);
        const pixelSize = Math.floor(tileSize) + 1; // Add 1 pixel to eliminate gaps between tiles
        
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
            // Disabled excessive logging - was running every frame
            // if (!(window as any).missingTileCount) (window as any).missingTileCount = 0;
            // (window as any).missingTileCount++;
            // if ((window as any).missingTileCount % 50 === 0) {
            //     console.log(`[TILES] ${(window as any).missingTileCount} missing tiles rendered as grass`);
            // }
            return;
        }
        
        // Check if this tile should use autotiling
        const tileTypeName = tile.tileType.tag;
        const autotileResult = shouldUseAutotiling(tileTypeName, this.tileCache.tiles, tileX, tileY);
        
        if (autotileResult && hasAutotileSupport(tileTypeName)) {
            // Render autotile
            this.renderAutotile(ctx, tile, autotileResult, pixelX, pixelY, pixelSize, showDebugOverlay);
        } else {
            // Render regular tile
            const image = this.getTileImage(tile);
            if (image && image.complete && image.naturalHeight !== 0) {
                ctx.drawImage(image, pixelX, pixelY, pixelSize, pixelSize);
            } else {
                // Fallback based on tile type
                // Disabled excessive logging for failed image loads
                // if (!(window as any).failedImageCount) (window as any).failedImageCount = 0;
                // (window as any).failedImageCount++;
                // if ((window as any).failedImageCount % 20 === 0) {
                //     console.log(`[TILES] ${(window as any).failedImageCount} tiles using fallback colors (images not loaded)`);
                // }
                this.renderFallbackTile(ctx, tile, pixelX, pixelY, pixelSize);
            }
        }
    }
    
    private renderAutotile(
        ctx: CanvasRenderingContext2D,
        tile: WorldTile,
        autotileResult: { config: AutotileConfig; bitmask: number },
        pixelX: number,
        pixelY: number,
        pixelSize: number,
        showDebugOverlay: boolean = false
    ) {
        const tileTypeName = tile.tileType.tag;
        
        // Find which specific transition this autotile config represents
        let transitionKey = '';
        for (const [key, config] of Object.entries(AUTOTILE_CONFIGS)) {
            if (config.primaryType === autotileResult.config.primaryType && 
                config.secondaryType === autotileResult.config.secondaryType &&
                config.tilesetPath === autotileResult.config.tilesetPath) {
                transitionKey = key;
                break;
            }
        }
        
        // Get the specific transition autotile image
        let autotileImg = this.tileCache.images.get(`transition_${transitionKey}`);
        
        // Fallback to legacy single autotile if transition not found
        if (!autotileImg) {
            autotileImg = this.tileCache.images.get(`${tileTypeName}_autotile`);
        }
        
        if (!autotileImg || !autotileImg.complete || autotileImg.naturalHeight === 0) {
            console.warn(`[Autotile] No image found for transition: ${transitionKey} (${autotileResult.config.primaryType}→${autotileResult.config.secondaryType})`);
            // Fallback to regular tile if autotile image not available
            const regularImg = this.getTileImage(tile);
            if (regularImg && regularImg.complete && regularImg.naturalHeight !== 0) {
                ctx.drawImage(regularImg, pixelX, pixelY, pixelSize, pixelSize);
            } else {
                this.renderFallbackTile(ctx, tile, pixelX, pixelY, pixelSize);
            }
            return;
        }
        
        const autotileConfig = getAutotileConfig(tileTypeName);
        if (!autotileConfig) {
            console.warn(`[ProceduralWorldRenderer] No autotile config for ${tileTypeName}`);
            return;
        }
        
        // Get sprite coordinates from the autotile sheet
        const spriteCoords = getAutotileSpriteCoords(autotileResult.config, autotileResult.bitmask);
        
        // Debug logging for autotile rendering (enable for debugging)
        // if (false) { // Temporarily disabled
        //     console.log(`[Autotile] ${tileTypeName} at (${tile.worldX}, ${tile.worldY}): ${debugAutotileBitmask(autotileResult.bitmask)}`);
        //     console.log(`[Autotile] Sprite coords:`, spriteCoords);
        //     console.log(`[Autotile] Autotile config:`, autotileConfig);
        //     console.log(`[Autotile] Autotile image dimensions:`, autotileImg.naturalWidth, 'x', autotileImg.naturalHeight);
        // }
        
        // Render the specific sprite from the autotile sheet with pixel-perfect alignment
        // Use exact source dimensions and destination dimensions
        ctx.drawImage(
            autotileImg,
            Math.floor(spriteCoords.x), Math.floor(spriteCoords.y), 
            Math.floor(spriteCoords.width), Math.floor(spriteCoords.height), // Source rectangle (16x16 from autotile sheet)
            Math.floor(pixelX), Math.floor(pixelY), 
            Math.floor(pixelSize), Math.floor(pixelSize) // Destination rectangle (game tile size)
        );
        
        // DEBUG: Draw bitmask and tile info on tile for easy debugging
        if (showDebugOverlay) { // Enable visual debugging
            const debugInfo = getDebugTileInfo(autotileResult.bitmask);
            
            ctx.save();
            ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.font = '10px monospace';
            ctx.textAlign = 'center';
            
            // Show bitmask number
            ctx.fillText(
                `${autotileResult.bitmask}`,
                Math.floor(pixelX + pixelSize/2), 
                Math.floor(pixelY + pixelSize/4)
            );
            
            // Show tile index and row/col
            ctx.fillText(
                `T${debugInfo.tileIndex}`,
                Math.floor(pixelX + pixelSize/2), 
                Math.floor(pixelY + pixelSize/2)
            );
            
            // Show row,col  
            ctx.fillText(
                `${debugInfo.row},${debugInfo.col}`,
                Math.floor(pixelX + pixelSize/2), 
                Math.floor(pixelY + 3*pixelSize/4)
            );
            
            ctx.restore();
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
                ctx.fillStyle = '#8B7355';
                break;
            case 'DirtRoad':
                ctx.fillStyle = '#6B4E3D';
                break;
            case 'Sea':
                ctx.fillStyle = '#1E90FF';
                break;
            case 'Beach':
                ctx.fillStyle = '#F5DEB3';
                break;
            case 'Sand':
                ctx.fillStyle = '#F4A460';
                break;
            default:
                ctx.fillStyle = '#808080'; // Gray fallback
        }
        
        ctx.fillRect(x, y, size, size);
    }
    
    public getCacheStats() {
        return {
            tileCount: this.tileCache.tiles.size,
            imageCount: this.tileCache.images.size,
            lastUpdate: this.tileCache.lastUpdate,
            initialized: this.isInitialized
        };
    }
} 