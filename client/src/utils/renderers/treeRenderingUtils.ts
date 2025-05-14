import { Tree } from '../../generated'; // Import generated types
import aleppoPineImage from '../../assets/doodads/aleppo_pine.png';
import mannaAshImage from '../../assets/doodads/manna_ash.png';
import downyOakImage from '../../assets/doodads/downy_oak.png';
// import treeOakImage from '../assets/doodads/tree.png'; // REMOVED
// import treeStumpImage from '../assets/doodads/tree_stump.png'; // REMOVED
import { GroundEntityConfig, renderConfiguredGroundEntity } from './genericGroundRenderer'; // Import generic renderer
import { imageManager } from './imageManager'; // Import image manager

// Define constants for tree rendering
const TARGET_TREE_WIDTH_PX = 240; // Target width on screen (doubled from 160)
const SHAKE_DURATION_MS = 150; // How long the shake effect lasts
const SHAKE_INTENSITY_PX = 10; // Maximum pixel offset for the shake

// Define the configuration for rendering trees
const treeConfig: GroundEntityConfig<Tree> = {
    // Use the imported URL from Vite
    getImageSource: (entity) => {
        // Assuming entity.tree_type will be an object with a `tag` property like { tag: "DownyOak" }
        // or a simple string after client type generation. This handles both.
        if (typeof entity.treeType === 'object' && entity.treeType !== null && 'tag' in entity.treeType) {
            switch ((entity.treeType as any).tag) {
                case 'AleppoPine':
                    return aleppoPineImage;
                case 'MannaAsh':
                    return mannaAshImage;
                case 'DownyOak':
                    return downyOakImage;
                default:
                    console.warn(`Unknown tree type tag: ${(entity.treeType as any).tag}, falling back to Downy Oak.`);
                    return downyOakImage;
            }
        } else if (typeof entity.treeType === 'string') { // Handle if it's just a string representation
             switch (entity.treeType) {
                case 'AleppoPine':
                    return aleppoPineImage;
                case 'MannaAsh':
                    return mannaAshImage;
                case 'DownyOak':
                    return downyOakImage;
                default:
                    console.warn(`Unknown tree type string: ${entity.treeType}, falling back to Downy Oak.`);
                    return downyOakImage;
            }
        }
        console.error('Unexpected treeType structure:', entity.treeType, 'Falling back to Downy Oak.');
        return downyOakImage; 
    },

    getTargetDimensions: (img, _entity) => {
        // Calculate scaling factor based on target width
        const scaleFactor = TARGET_TREE_WIDTH_PX / img.naturalWidth;
        return {
            width: TARGET_TREE_WIDTH_PX,
            height: img.naturalHeight * scaleFactor,
        };
    },

    calculateDrawPosition: (entity, _drawWidth, drawHeight) => ({
        // Top-left corner for image drawing, originating from entity's base Y
        drawX: entity.posX - TARGET_TREE_WIDTH_PX / 2, 
        drawY: entity.posY - drawHeight, 
    }),

    getShadowParams: (entity, drawWidth, drawHeight) => {
        const shadowRadiusX = drawWidth * 0.4;
        const shadowRadiusY = shadowRadiusX * 0.5;
        const shadowOffsetY = -drawHeight * 0.05; // Push shadow up slightly
        return {
            offsetX: 0, // Centered horizontally on entity.posX
            offsetY: shadowOffsetY, // Offset vertically from entity.posY
            radiusX: shadowRadiusX,
            radiusY: shadowRadiusY,
        };
    },

    applyEffects: (ctx, entity, nowMs, _baseDrawX, _baseDrawY) => {
        let shakeOffsetX = 0;
        let shakeOffsetY = 0;

        if (entity.lastHitTime) { 
            const lastHitTimeMs = Number(entity.lastHitTime.microsSinceUnixEpoch / 1000n);
            const elapsedSinceHit = nowMs - lastHitTimeMs;

            if (elapsedSinceHit >= 0 && elapsedSinceHit < SHAKE_DURATION_MS) {
                const shakeFactor = 1.0 - (elapsedSinceHit / SHAKE_DURATION_MS); 
                const currentShakeIntensity = SHAKE_INTENSITY_PX * shakeFactor;
                shakeOffsetX = (Math.random() - 0.5) * 2 * currentShakeIntensity;
                shakeOffsetY = (Math.random() - 0.5) * 2 * currentShakeIntensity;
            }
        }
        
        return { offsetX: shakeOffsetX, offsetY: shakeOffsetY };
    },

    fallbackColor: 'darkgreen',
};

// Preload using the imported URL
imageManager.preloadImage(aleppoPineImage);
imageManager.preloadImage(mannaAshImage);
imageManager.preloadImage(downyOakImage);
// TODO: Preload other variants if added

// Refactored rendering function
export function renderTree(ctx: CanvasRenderingContext2D, tree: Tree, now_ms: number) {
    renderConfiguredGroundEntity({
        ctx,
        entity: tree,
        config: treeConfig,
        nowMs: now_ms,
        entityPosX: tree.posX,
        entityPosY: tree.posY,
    });
}
