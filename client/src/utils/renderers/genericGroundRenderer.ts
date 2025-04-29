import { imageManager } from './imageManager';
import { drawShadow } from './shadowUtils';
import { gameConfig } from '../../config/gameConfig';

/**
 * Configuration for rendering a specific type of ground entity.
 */
export interface GroundEntityConfig<T> {
    /**
     * Function to get the image source URL based on entity state.
     * Return null if no image should be drawn for this entity/state.
     */
    getImageSource: (entity: T) => string | null;

    /**
     * Function to calculate the desired drawing dimensions.
     * @param img The loaded HTMLImageElement.
     * @param entity The entity data.
     * @returns Object with width and height.
     */
    getTargetDimensions: (img: HTMLImageElement, entity: T) => { width: number; height: number };

    /**
     * Function to calculate the top-left draw position (for ctx.drawImage).
     * @param entity The entity data.
     * @param drawWidth The calculated draw width.
     * @param drawHeight The calculated draw height.
     * @returns Object with drawX and drawY.
     */
    calculateDrawPosition: (entity: T, drawWidth: number, drawHeight: number) => { drawX: number; drawY: number };

    /**
     * Function to get parameters for drawing the shadow.
     * Return null if no shadow should be drawn.
     * @param entity The entity data.
     * @param drawWidth The calculated draw width.
     * @param drawHeight The calculated draw height.
     * @returns Object with offsetX, offsetY (relative to entity pos), radiusX, radiusY, or null.
     */
    getShadowParams?: (entity: T, drawWidth: number, drawHeight: number) => 
        { offsetX?: number; offsetY?: number; radiusX: number; radiusY: number } | null;

    /**
     * Optional function to apply pre-render effects (like shaking) and return drawing offsets.
     * @param ctx Canvas rendering context.
     * @param entity The entity data.
     * @param nowMs Current timestamp.
     * @param baseDrawX Base calculated draw X.
     * @param baseDrawY Base calculated draw Y.
     * @returns Object with offsetX and offsetY to apply to the final drawImage call.
     */
    applyEffects?: (ctx: CanvasRenderingContext2D, entity: T, nowMs: number, baseDrawX: number, baseDrawY: number) => 
        { offsetX: number; offsetY: number };
    
    /**
     * Optional fallback fill style if image fails to load.
     * Defaults to 'grey'.
     */
    fallbackColor?: string;
}

interface RenderParams<T> {
    ctx: CanvasRenderingContext2D;
    entity: T;
    config: GroundEntityConfig<T>;
    nowMs: number;
    // Entity position properties expected (adjust if some entities use different names)
    entityPosX: number; 
    entityPosY: number;
}

/**
 * Generic function to render a ground-based entity using a configuration object.
 */
export function renderConfiguredGroundEntity<T>({ 
    ctx, 
    entity, 
    config, 
    nowMs,
    entityPosX, 
    entityPosY 
}: RenderParams<T>): void {
    
    const imgSrc = config.getImageSource(entity);
    if (!imgSrc) {
        return; // Config says not to draw anything for this entity/state
    }

    const img = imageManager.getImage(imgSrc);

    if (img) {
        // Image is loaded and valid
        const { width: drawWidth, height: drawHeight } = config.getTargetDimensions(img, entity);
        const { drawX: baseDrawX, drawY: baseDrawY } = config.calculateDrawPosition(entity, drawWidth, drawHeight);

        let effectOffsetX = 0;
        let effectOffsetY = 0;
        if (config.applyEffects) {
            const effects = config.applyEffects(ctx, entity, nowMs, baseDrawX, baseDrawY);
            effectOffsetX = effects.offsetX;
            effectOffsetY = effects.offsetY;
        }

        // Draw Shadow (before applying visual effects like shake to the main image)
        if (config.getShadowParams) {
            const shadowParams = config.getShadowParams(entity, drawWidth, drawHeight);
            if (shadowParams) {
                drawShadow(
                    ctx, 
                    entityPosX + (shadowParams.offsetX ?? 0),
                    entityPosY + (shadowParams.offsetY ?? 0),
                    shadowParams.radiusX, 
                    shadowParams.radiusY
                );
            }
        }

        // Draw the main image
        ctx.drawImage(
            img, 
            baseDrawX + effectOffsetX, 
            baseDrawY + effectOffsetY, 
            drawWidth, 
            drawHeight
        );

    } else {
        // Image not loaded, draw fallback
        // Calculate dimensions using a placeholder or default logic if possible
        // For simplicity, using fixed size fallback here. Config could provide fallback size too.
        const fallbackWidth = gameConfig.tileSize * 0.8;
        const fallbackHeight = gameConfig.tileSize * 0.8;
        const fallbackX = entityPosX - fallbackWidth / 2;
        const fallbackY = entityPosY - fallbackHeight / 2; 

        ctx.fillStyle = config.fallbackColor || 'grey';
        ctx.fillRect(fallbackX, fallbackY, fallbackWidth, fallbackHeight);
    }
} 