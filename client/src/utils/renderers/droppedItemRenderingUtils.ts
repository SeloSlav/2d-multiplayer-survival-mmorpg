import { DroppedItem as SpacetimeDBDroppedItem, ItemDefinition as SpacetimeDBItemDefinition } from '../../generated';
import burlapSackImage from '../../assets/doodads/burlap_sack.png'; // Import the sack image
import { GroundEntityConfig, renderConfiguredGroundEntity } from './genericGroundRenderer';
import { imageManager } from './imageManager'; 

// --- Constants --- 
const DRAW_WIDTH = 48;
const DRAW_HEIGHT = 48;

// --- Config --- 
const droppedItemConfig: GroundEntityConfig<SpacetimeDBDroppedItem & { itemDef?: SpacetimeDBItemDefinition }> = {
    // Always return the burlap sack image URL
    getImageSource: (_entity) => burlapSackImage,

    getTargetDimensions: (_img, _entity) => ({
        width: DRAW_WIDTH,
        height: DRAW_HEIGHT,
    }),

    calculateDrawPosition: (entity, drawWidth, drawHeight) => ({
        // Center the image
        drawX: entity.posX - drawWidth / 2,
        drawY: entity.posY - drawHeight / 2, 
    }),

    getShadowParams: (entity, drawWidth, drawHeight) => {
        const shadowRadiusX = drawWidth * 0.4;
        const shadowRadiusY = shadowRadiusX * 0.6;
        const shadowOffsetY = drawHeight * 0.3; 
        return {
            offsetX: 0, 
            offsetY: shadowOffsetY,
            radiusX: shadowRadiusX,
            radiusY: shadowRadiusY,
        };
    },

    applyEffects: undefined,

    fallbackColor: '#A0522D', // Brown fallback for sack
};

// Preload the burlap sack image
imageManager.preloadImage(burlapSackImage);

// --- Interface for new renderer function ---
interface RenderDroppedItemParamsNew {
    ctx: CanvasRenderingContext2D;
    item: SpacetimeDBDroppedItem;
    itemDef: SpacetimeDBItemDefinition | undefined;
    nowMs: number; // Keep nowMs for consistency, even if unused
}

// --- Rendering Function (Refactored) ---
export function renderDroppedItem({
    ctx,
    item,
    itemDef,
    nowMs,
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
    });
} 