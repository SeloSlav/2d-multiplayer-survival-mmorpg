import { DroppedItem as SpacetimeDBDroppedItem, ItemDefinition as SpacetimeDBItemDefinition } from '../../generated';
import burlapSackImage from '../../assets/doodads/burlap_sack.png'; // Import the sack image as fallback
import { GroundEntityConfig, renderConfiguredGroundEntity } from './genericGroundRenderer';
import { imageManager } from './imageManager'; 
import { getItemIcon } from '../itemIconUtils'; // Import item icon utility

// --- Constants --- 
const DRAW_WIDTH = 48;
const DRAW_HEIGHT = 48;

// --- Config --- 
const droppedItemConfig: GroundEntityConfig<SpacetimeDBDroppedItem & { itemDef?: SpacetimeDBItemDefinition }> = {
    // Always try to show the actual item sprite, fall back to burlap sack if not found
    getImageSource: (entity) => {
        // If we have item definition, try to get the actual item icon
        if (entity.itemDef && entity.itemDef.iconAssetName) {
            const itemIconUrl = getItemIcon(entity.itemDef.iconAssetName);
            if (itemIconUrl) {
                return itemIconUrl;
            }
        }
        
        // Fallback: use burlap sack if item icon isn't available
        return burlapSackImage;
    },

    getTargetDimensions: (_img, entity) => {
        // If we have the actual item sprite, use a smaller size for better visibility
        if (entity.itemDef && entity.itemDef.iconAssetName) {
            const itemIconUrl = getItemIcon(entity.itemDef.iconAssetName);
            if (itemIconUrl) {
                // Actual item sprites are typically smaller and more detailed
                return {
                    width: 48,  // Good size for actual item sprites
                    height: 48,
                };
            }
        }
        
        // Default size for burlap sack fallback
        return {
            width: DRAW_WIDTH,
            height: DRAW_HEIGHT,
        };
    },

    calculateDrawPosition: (entity, drawWidth, drawHeight) => ({
        // Center the image
        drawX: entity.posX - drawWidth / 2,
        drawY: entity.posY - drawHeight / 2, 
    }),

    getShadowParams: undefined, // No shadow params needed for glow effect

    applyEffects: (ctx, entity, nowMs, baseDrawX, baseDrawY, cycleProgress) => {
        // Save the current context state
        ctx.save();
        
        // Create a soft glow effect with pulsing animation
        const time = nowMs * 0.003; // Slow pulse animation
        const pulseIntensity = 0.3 + 0.2 * Math.sin(time); // Pulse between 0.3 and 0.5
        
        // Set up the glow effect
        ctx.shadowColor = `rgba(255, 255, 255, ${pulseIntensity})`;
        ctx.shadowBlur = 15;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        
        // Draw multiple glow layers for a more intense effect
        // Outer glow (larger, more transparent)
        ctx.save();
        ctx.shadowColor = `rgba(100, 200, 255, ${pulseIntensity * 0.4})`;
        ctx.shadowBlur = 25;
        
        // Create a temporary canvas for the outline effect
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        if (tempCtx) {
            tempCanvas.width = 60; // Slightly larger than item
            tempCanvas.height = 60;
            
            // Draw a rounded rectangle outline
            tempCtx.strokeStyle = `rgba(255, 255, 255, ${pulseIntensity * 0.8})`;
            tempCtx.lineWidth = 2;
            tempCtx.lineCap = 'round';
            tempCtx.lineJoin = 'round';
            
            const outlineSize = 50;
            const radius = 8;
            const x = 5;
            const y = 5;
            
            // Draw rounded rectangle outline
            tempCtx.beginPath();
            tempCtx.moveTo(x + radius, y);
            tempCtx.lineTo(x + outlineSize - radius, y);
            tempCtx.quadraticCurveTo(x + outlineSize, y, x + outlineSize, y + radius);
            tempCtx.lineTo(x + outlineSize, y + outlineSize - radius);
            tempCtx.quadraticCurveTo(x + outlineSize, y + outlineSize, x + outlineSize - radius, y + outlineSize);
            tempCtx.lineTo(x + radius, y + outlineSize);
            tempCtx.quadraticCurveTo(x, y + outlineSize, x, y + outlineSize - radius);
            tempCtx.lineTo(x, y + radius);
            tempCtx.quadraticCurveTo(x, y, x + radius, y);
            tempCtx.closePath();
            tempCtx.stroke();
            
            // Draw the outline on the main canvas with glow
            ctx.drawImage(tempCanvas, baseDrawX - 6, baseDrawY - 6);
        }
        
        ctx.restore();
        
        // Inner glow (smaller, more intense)
        ctx.shadowColor = `rgba(255, 255, 255, ${pulseIntensity * 0.6})`;
        ctx.shadowBlur = 8;
        
        // Reset to the saved state
        ctx.restore();
        
        // Return no additional offsets since we want the glow centered
        return { offsetX: 0, offsetY: 0 };
    },

    fallbackColor: '#A0522D', // Brown fallback color if image fails to load
};

// Preload the burlap sack fallback image
imageManager.preloadImage(burlapSackImage);

// --- Interface for new renderer function ---
interface RenderDroppedItemParamsNew {
    ctx: CanvasRenderingContext2D;
    item: SpacetimeDBDroppedItem;
    itemDef: SpacetimeDBItemDefinition | undefined;
    nowMs: number; // Keep nowMs for consistency, even if unused
    cycleProgress: number; // Added for shadow
}

// --- Rendering Function (Refactored) ---
export function renderDroppedItem({
    ctx,
    item,
    itemDef,
    nowMs,
    cycleProgress, // Added
}: RenderDroppedItemParamsNew): void {
    // Combine item and itemDef for the generic renderer config
    const entityWithDef = { ...item, itemDef };

    renderConfiguredGroundEntity({
        ctx,
        entity: entityWithDef, // Pass combined object
        config: droppedItemConfig,
        nowMs, 
        entityPosX: item.posX,
        entityPosY: item.posY,
        cycleProgress, // Added
    });
} 