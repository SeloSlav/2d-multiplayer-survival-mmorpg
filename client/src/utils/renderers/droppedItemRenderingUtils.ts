import { DroppedItem as SpacetimeDBDroppedItem, ItemDefinition as SpacetimeDBItemDefinition } from '../../generated';
import burlapSackImage from '../../assets/doodads/burlap_sack.png'; // Import the sack image as fallback
import { GroundEntityConfig, renderConfiguredGroundEntity } from './genericGroundRenderer';
import { imageManager } from './imageManager'; 
import { applyStandardDropShadow } from './shadowUtils'; // Added import
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

    getShadowParams: undefined, // Removed to use applyEffects for shadow

    applyEffects: (ctx, entity, nowMs, baseDrawX, baseDrawY, cycleProgress) => {
        // Apply shadow
        applyStandardDropShadow(ctx, { cycleProgress, blur: 3, offsetY: 2 });
        // No other effects for now, so return default offsets
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