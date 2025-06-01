import { gameConfig } from '../../config/gameConfig';
import { ProceduralWorldRenderer } from './proceduralWorldRenderer';

// Global instance for now - can be optimized later
let globalProceduralRenderer: ProceduralWorldRenderer | null = null;

/**
 * Renders the tiled world background onto the canvas, optimized to draw only visible tiles.
 * @param ctx - The CanvasRenderingContext2D to draw on.
 * @param grassImageRef - Ref to the loaded grass texture image.
 * @param cameraOffsetX - The camera's X offset in pixels.
 * @param cameraOffsetY - The camera's Y offset in pixels.
 * @param canvasWidth - The width of the canvas.
 * @param canvasHeight - The height of the canvas.
 * @param worldTiles - Optional procedural world tiles data.
 * @param showDebugOverlay - Whether to show a debug overlay.
 */
export function renderWorldBackground(
    ctx: CanvasRenderingContext2D,
    grassImageRef: React.RefObject<HTMLImageElement | null>,
    cameraOffsetX: number,
    cameraOffsetY: number,  
    canvasWidth: number,
    canvasHeight: number,
    worldTiles?: Map<string, any>,
    showDebugOverlay: boolean = false
): void {
    // Enable pixel-perfect rendering for all tile rendering
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

    // Try to use procedural world renderer if world tiles are available
    if (worldTiles && worldTiles.size > 0) {
        if (!globalProceduralRenderer) {
            globalProceduralRenderer = new ProceduralWorldRenderer();
        }
        
        // Update the tile cache if needed
        globalProceduralRenderer.updateTileCache(worldTiles);
        
        // Try to render with procedural renderer
        try {
            globalProceduralRenderer.renderProceduralWorld(
                ctx, 
                cameraOffsetX, 
                cameraOffsetY, 
                canvasWidth, 
                canvasHeight, 
                16.67, // default deltaTime
                showDebugOverlay
            );
            return; // Successfully rendered procedural world
        } catch (error) {
            console.warn('[renderWorldBackground] Procedural renderer failed, falling back to grass tiles:', error);
        }
    }

    // Fallback to original grass tile rendering
    const grassImg = grassImageRef.current;
    const { tileSize } = gameConfig;

    if (!grassImg || !grassImg.complete || grassImg.naturalHeight === 0) {
        // Draw fallback color if image not loaded or invalid
        ctx.fillStyle = '#8FBC8F'; // Medium Aquamarine fallback
        // Only fill the visible area for the fallback
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        // console.warn("[renderWorldBackground] Grass image not ready, drawing fallback for visible area.");
        return;
    }

    // Calculate the visible world coordinates
    const viewMinX = -cameraOffsetX;
    const viewMinY = -cameraOffsetY;
    const viewMaxX = viewMinX + canvasWidth;
    const viewMaxY = viewMinY + canvasHeight;

    // Calculate the range of tile indices to draw
    const startTileX = Math.max(0, Math.floor(viewMinX / tileSize));
    const endTileX = Math.min(gameConfig.worldWidth, Math.ceil(viewMaxX / tileSize));
    const startTileY = Math.max(0, Math.floor(viewMinY / tileSize));
    const endTileY = Math.min(gameConfig.worldHeight, Math.ceil(viewMaxY / tileSize));

    const drawGridLines = false; // Keep grid lines off

    // console.log(`Drawing tiles X: ${startTileX}-${endTileX}, Y: ${startTileY}-${endTileY}`);

    // --- Draw ONLY visible tiles with pixel-perfect alignment --- 
    for (let y = startTileY; y < endTileY; y++) {
        for (let x = startTileX; x < endTileX; x++) {
            ctx.drawImage(
                grassImg,
                Math.floor(x * tileSize),
                Math.floor(y * tileSize),
                Math.floor(tileSize),
                Math.floor(tileSize)
            );
        }
    }
    // --- End visible tile drawing ---

    // Optional: Draw grid lines only for visible area
    if (drawGridLines) {
        ctx.strokeStyle = 'rgba(221, 221, 221, 0.5)';
        ctx.lineWidth = 1;
        for (let y = startTileY; y < endTileY; y++) {
            for (let x = startTileX; x < endTileX; x++) {
                ctx.strokeRect(x * tileSize, y * tileSize, tileSize, tileSize);
            }
        }
    }
} 