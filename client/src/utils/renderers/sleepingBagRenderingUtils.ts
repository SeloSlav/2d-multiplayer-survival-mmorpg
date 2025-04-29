import { SleepingBag as SpacetimeDBSleepingBag } from '../../generated';
import sleepingBagImage from '../../assets/doodads/sleeping_bag.png'; // Direct import
import { drawShadow } from './shadowUtils';
import { SLEEPING_BAG_WIDTH, SLEEPING_BAG_HEIGHT } from '../../config/gameConfig';
import { GroundEntityConfig, renderConfiguredGroundEntity } from './genericGroundRenderer';
import { imageManager } from './imageManager';

// Define the configuration for rendering sleeping bags
const sleepingBagConfig: GroundEntityConfig<SpacetimeDBSleepingBag> = {
    getImageSource: (_entity) => sleepingBagImage, // Use imported URL

    getTargetDimensions: (_img, _entity) => ({
        width: SLEEPING_BAG_WIDTH,
        height: SLEEPING_BAG_HEIGHT,
    }),

    calculateDrawPosition: (_entity, drawWidth, drawHeight) => ({
        // Center the image on the entity's position
        drawX: _entity.posX - drawWidth / 2,
        drawY: _entity.posY - drawHeight / 2,
    }),

    // We need to draw the rotated shadow manually inside applyEffects 
    // because getShadowParams doesn't support rotation directly.
    getShadowParams: undefined, // Shadow drawing is handled in applyEffects

    applyEffects: (ctx, entity, _nowMs, baseDrawX, baseDrawY) => {
        // --- Draw Rotated Shadow ---
        ctx.save(); // Save context state before transforming
        
        // Translate to the shadow's center position 
        const shadowCenterX = entity.posX; // Centered on entity X
        const shadowCenterY = entity.posY + SLEEPING_BAG_HEIGHT * 0.05; // Slightly below entity Y
        ctx.translate(shadowCenterX, shadowCenterY);
        
        // Rotate the context 45 degrees clockwise (PI / 4 radians)
        ctx.rotate(Math.PI / 4);
        
        // Draw the shadow centered at the new (0, 0) origin
        // The width/height params control the size of the rotated ellipse
        drawShadow(ctx, 0, 0, SLEEPING_BAG_WIDTH * 0.3, SLEEPING_BAG_HEIGHT * 0.5);
        
        ctx.restore(); // Restore the context to its pre-transformation state
        // --- End Shadow ---
        
        // No positional offset needed from effects themselves
        return { offsetX: 0, offsetY: 0 };
    },

    fallbackColor: 'purple',
};

// Preload using imported URL
imageManager.preloadImage(sleepingBagImage);

interface RenderSleepingBagParams {
    ctx: CanvasRenderingContext2D;
    sleepingBag: SpacetimeDBSleepingBag;
    nowMs: number; // Added for potential future animation
}

/**
 * Renders a single sleeping bag entity onto the canvas using the generic renderer.
 */
export function renderSleepingBag({
    ctx,
    sleepingBag,
    nowMs,
}: RenderSleepingBagParams): void {
    renderConfiguredGroundEntity({
        ctx,
        entity: sleepingBag,
        config: sleepingBagConfig,
        nowMs,
        entityPosX: sleepingBag.posX,
        entityPosY: sleepingBag.posY,
    });
} 