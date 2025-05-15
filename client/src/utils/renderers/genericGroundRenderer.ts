import { imageManager } from './imageManager';
import { drawShadow } from './shadowUtils';
import { gameConfig } from '../../config/gameConfig';

interface BaseEntity {
    posX: number;
    posY: number;
    isDestroyed?: boolean; // Optional because not all entities that use this will be destructible
    destroyed_at?: { microsSinceUnixEpoch: bigint } | null; // For destruction animation timing
    health?: number; // Optional: For health bar
    maxHealth?: number; // Optional: For health bar
    lastHitTime?: { microsSinceUnixEpoch: bigint } | null; // Optional: For shake effect and health bar visibility
    // Add other common fields if necessary, e.g., id, lastHitTime etc. if they become common
}

/**
 * Configuration for rendering a specific type of ground entity.
 */
export interface GroundEntityConfig<T extends BaseEntity> {
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
     * @param cycleProgress Cycle progress (time-of-day dependent effects).
     * @returns Object with offsetX and offsetY to apply to the final drawImage call.
     */
    applyEffects?: (
        ctx: CanvasRenderingContext2D, 
        entity: T, 
        nowMs: number, 
        baseDrawX: number, 
        baseDrawY: number,
        cycleProgress: number) => 
        { offsetX: number; offsetY: number };
    
    /**
     * Optional callback to draw a custom shadow on the ground before the entity image.
     * This is for shadows that are separate shapes, not context effects on the image itself.
     * It's called after ctx.save() and before applyEffects/drawImage.
     */
    drawCustomGroundShadow?: (
        ctx: CanvasRenderingContext2D,
        entity: T,
        entityImage: HTMLImageElement,
        entityPosX: number, 
        entityPosY: number, 
        imageDrawWidth: number,
        imageDrawHeight: number,
        cycleProgress: number
    ) => void;

    /**
     * Optional callback to draw an overlay (like a health bar) on top of the entity image.
     * It's called after drawImage and ctx.restore().
     */
    drawOverlay?: (
        ctx: CanvasRenderingContext2D,
        entity: T,
        // The final draw coordinates and dimensions, including effects:
        finalDrawX: number, 
        finalDrawY: number, 
        finalDrawWidth: number,
        finalDrawHeight: number,
        nowMs: number,
        // Base draw coordinates BEFORE any effects (shake, etc.)
        baseDrawX: number,
        baseDrawY: number
    ) => void;

    /**
     * Optional fallback fill style if image fails to load.
     * Defaults to 'grey'.
     */
    fallbackColor?: string;
}

export interface RenderConfiguredGroundEntityParams<T extends BaseEntity> {
    ctx: CanvasRenderingContext2D;
    entity: T;
    config: GroundEntityConfig<T>;
    nowMs: number;
    entityPosX: number;
    entityPosY: number;
    cycleProgress: number;
    onlyDrawShadow?: boolean;
    skipDrawingShadow?: boolean;
}

/**
 * Generic function to render a ground-based entity using a configuration object.
 */
export function renderConfiguredGroundEntity<T extends BaseEntity>({ 
    ctx, 
    entity, 
    config, 
    nowMs,
    entityPosX, 
    entityPosY,
    cycleProgress,
    onlyDrawShadow,
    skipDrawingShadow
}: RenderConfiguredGroundEntityParams<T>): void {
    const imgSrc = config.getImageSource(entity);
    if (!imgSrc && !entity.isDestroyed) { // Allow rendering overlay even if image source is null (e.g. for destroyed state)
        return;
    }
    const img = imgSrc ? imageManager.getImage(imgSrc) : null;

    if ((img && img.complete && img.naturalHeight !== 0) || (entity.isDestroyed && config.drawOverlay)) {
        const { width: targetImgWidth, height: targetImgHeight } = img ? config.getTargetDimensions(img, entity) : {width: 0, height: 0};
        const { drawX: baseDrawX, drawY: baseDrawY } = config.calculateDrawPosition(entity, targetImgWidth, targetImgHeight);

        if (onlyDrawShadow) {
            if (config.drawCustomGroundShadow && img) {
                config.drawCustomGroundShadow(ctx, entity, img, entityPosX, entityPosY, targetImgWidth, targetImgHeight, cycleProgress);
            }
            return;
        }

        ctx.save();

        if (config.drawCustomGroundShadow && img && !skipDrawingShadow) {
            config.drawCustomGroundShadow(ctx, entity, img, entityPosX, entityPosY, targetImgWidth, targetImgHeight, cycleProgress);
        }

        let effectOffsetX = 0;
        let effectOffsetY = 0;
        if (config.applyEffects) {
            const effectsResult = config.applyEffects(ctx, entity, nowMs, baseDrawX, baseDrawY, cycleProgress);
            effectOffsetX = effectsResult.offsetX;
            effectOffsetY = effectsResult.offsetY;
        }
        
        const finalDrawX = baseDrawX + effectOffsetX;
        const finalDrawY = baseDrawY + effectOffsetY;

        if (img && !entity.isDestroyed) { // Don't draw main image if destroyed
            ctx.drawImage(
                img, 
                finalDrawX, 
                finalDrawY, 
                targetImgWidth, 
                targetImgHeight
            );
        }

        ctx.restore(); // Restore before drawing overlay so overlay isn't affected by image effects

        // Draw overlay if defined (e.g., health bar or destruction effect)
        if (config.drawOverlay) {
            // For destroyed state, calculate fallback dimensions if no image
            const overlayWidth = img ? targetImgWidth : config.getTargetDimensions({naturalWidth: 64, naturalHeight: 64} as HTMLImageElement, entity).width; // Provide dummy image for dimensions
            const overlayHeight = img ? targetImgHeight : config.getTargetDimensions({naturalWidth: 64, naturalHeight: 64} as HTMLImageElement, entity).height;
            const overlayDrawX = img ? finalDrawX : entity.posX - overlayWidth / 2; // Recalculate if no img
            const overlayDrawY = img ? finalDrawY : entity.posY - overlayHeight;    // Recalculate if no img
            
            config.drawOverlay(ctx, entity, overlayDrawX, overlayDrawY, overlayWidth, overlayHeight, nowMs, baseDrawX, baseDrawY);
        }

    } else if (config.fallbackColor && !entity.isDestroyed) {
        const fallbackWidth = 32;
        const fallbackHeight = 32;
        const { drawX: baseDrawX, drawY: baseDrawY } = config.calculateDrawPosition(entity, fallbackWidth, fallbackHeight);
        ctx.fillStyle = config.fallbackColor;
        ctx.fillRect(baseDrawX, baseDrawY, fallbackWidth, fallbackHeight);
    }
} 