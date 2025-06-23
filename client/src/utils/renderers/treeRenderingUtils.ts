import { Tree } from '../../generated'; // Import generated types
import aleppoPineImage from '../../assets/doodads/aleppo_pine_b.png';
import mannaAshImage from '../../assets/doodads/manna_ash_b.png';
import downyOakImage from '../../assets/doodads/downy_oak_b.png';
import stonePineImage from '../../assets/doodads/stone_pine_b.png'; // New import for stone pine
// import treeOakImage from '../assets/doodads/tree.png'; // REMOVED
// import treeStumpImage from '../assets/doodads/tree_stump.png'; // REMOVED
import { drawDynamicGroundShadow } from './shadowUtils'; // Import new ground shadow util
import { applyStandardDropShadow } from './shadowUtils'; // Import new shadow util
import { GroundEntityConfig, renderConfiguredGroundEntity } from './genericGroundRenderer'; // Import generic renderer
import { imageManager } from './imageManager'; // Import image manager

// Define constants for tree rendering
const TARGET_TREE_WIDTH_PX = 480; // Target width on screen (doubled from 240, originally 160)
const TREE_HEIGHT = 120;
const SHAKE_DURATION_MS = 500;
const SHAKE_INTENSITY_PX = 8;

// --- Client-side animation tracking for tree shakes ---
const clientTreeShakeStartTimes = new Map<string, number>(); // treeId -> client timestamp when shake started
const lastKnownServerTreeShakeTimes = new Map<string, number>(); // treeId -> last known server timestamp

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
                case 'StonePine':
                    return stonePineImage;
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
                case 'StonePine':
                    return stonePineImage;
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

    getShadowParams: undefined, // No longer using this for trees

    drawCustomGroundShadow: (ctx, entity, entityImage, entityPosX, entityPosY, imageDrawWidth, imageDrawHeight, cycleProgress) => {
        drawDynamicGroundShadow({
            ctx,
            entityImage,
            entityCenterX: entityPosX,
            entityBaseY: entityPosY,
            imageDrawWidth,
            imageDrawHeight,
            cycleProgress,
            maxStretchFactor: 1.8,
            minStretchFactor: 0.15,
            shadowBlur: 2,
            pivotYOffset: 15
        });
    },

    applyEffects: (ctx, entity, nowMs, _baseDrawX, _baseDrawY, _cycleProgress) => { // cycleProgress not needed here now
        let shakeOffsetX = 0;
        let shakeOffsetY = 0;

        if (entity.lastHitTime) { 
            const treeId = entity.id.toString();
            const serverShakeTime = Number(entity.lastHitTime.microsSinceUnixEpoch / 1000n);
            
            // Check if this is a NEW shake by comparing server timestamps
            const lastKnownServerTime = lastKnownServerTreeShakeTimes.get(treeId) || 0;
            
            if (serverShakeTime !== lastKnownServerTime) {
                // NEW shake detected! Record both server time and client time
                lastKnownServerTreeShakeTimes.set(treeId, serverShakeTime);
                clientTreeShakeStartTimes.set(treeId, nowMs);
            }
            
            // Calculate animation based on client time
            const clientStartTime = clientTreeShakeStartTimes.get(treeId);
            if (clientStartTime) {
                const elapsedSinceShake = nowMs - clientStartTime;
                
                if (elapsedSinceShake >= 0 && elapsedSinceShake < SHAKE_DURATION_MS) {
                    const shakeFactor = 1.0 - (elapsedSinceShake / SHAKE_DURATION_MS); 
                    const currentShakeIntensity = SHAKE_INTENSITY_PX * shakeFactor;
                    shakeOffsetX = (Math.random() - 0.5) * 2 * currentShakeIntensity;
                    shakeOffsetY = (Math.random() - 0.5) * 2 * currentShakeIntensity;
                }
            }
        } else {
            // Clean up tracking when tree is not being hit
            const treeId = entity.id.toString();
            clientTreeShakeStartTimes.delete(treeId);
            lastKnownServerTreeShakeTimes.delete(treeId);
        }
        
        return { offsetX: shakeOffsetX, offsetY: shakeOffsetY };
    },

    fallbackColor: 'darkgreen',
};

// Preload using the imported URL
imageManager.preloadImage(aleppoPineImage);
imageManager.preloadImage(mannaAshImage);
imageManager.preloadImage(downyOakImage);
imageManager.preloadImage(stonePineImage);
// TODO: Preload other variants if added

// Refactored rendering function
export function renderTree(
    ctx: CanvasRenderingContext2D, 
    tree: Tree, 
    now_ms: number, 
    cycleProgress: number,
    onlyDrawShadow?: boolean, // New flag
    skipDrawingShadow?: boolean, // New flag
    localPlayerPosition?: { x: number; y: number } | null // Player position for transparency
) {
    // Check if player is behind this tree's foliage area
    // Tree base is at tree.posY, but the visual tree extends upward significantly
    // We need to check if player is behind the upper portion of the tree (foliage area)
    const treeVisualHeight = TARGET_TREE_WIDTH_PX * 0.8; // Approximate tree height based on width
    const treeFoliageTop = tree.posY - treeVisualHeight; // Top of the tree foliage
    const treeFoliageBottom = tree.posY - (treeVisualHeight * 0.4); // Bottom 40% is trunk area
    
    const shouldApplyTransparency = localPlayerPosition && 
                                   localPlayerPosition.y > treeFoliageTop && // Player is below the top of foliage
                                   localPlayerPosition.y < treeFoliageBottom && // Player is above the trunk area
                                   Math.abs(localPlayerPosition.x - tree.posX) < 120; // Within tree width

    // Apply transparency by modifying canvas global alpha if needed
    if (shouldApplyTransparency && !onlyDrawShadow) {
        ctx.save();
        // Render the tree in two parts: bottom opaque, top transparent
        renderTreeWithPartialTransparency(ctx, tree, now_ms, cycleProgress, skipDrawingShadow);
        ctx.restore();
    } else {
        // Normal rendering
        renderConfiguredGroundEntity({
            ctx,
            entity: tree,
            config: treeConfig,
            nowMs: now_ms,
            entityPosX: tree.posX,
            entityPosY: tree.posY,
            cycleProgress,
            onlyDrawShadow,    // Pass flag
            skipDrawingShadow  // Pass flag
        });
    }
}

// Helper function to render tree with partial transparency
function renderTreeWithPartialTransparency(
    ctx: CanvasRenderingContext2D,
    tree: Tree,
    now_ms: number,
    cycleProgress: number,
    skipDrawingShadow?: boolean
) {
    // First render the shadow normally (if not skipped)
    if (!skipDrawingShadow) {
        renderConfiguredGroundEntity({
            ctx,
            entity: tree,
            config: treeConfig,
            nowMs: now_ms,
            entityPosX: tree.posX,
            entityPosY: tree.posY,
            cycleProgress,
            onlyDrawShadow: true,
            skipDrawingShadow: false
        });
    }

    // Get the image and calculate dimensions
    const imageSource = treeConfig.getImageSource(tree);
    if (!imageSource) return;
    
    const image = imageManager.getImage(imageSource);
    if (!image) return;

    const dimensions = treeConfig.getTargetDimensions(image, tree);
    const position = treeConfig.calculateDrawPosition(tree, dimensions.width, dimensions.height);
    const effects = treeConfig.applyEffects?.(ctx, tree, now_ms, position.drawX, position.drawY, cycleProgress, dimensions.width, dimensions.height) || { offsetX: 0, offsetY: 0 };

    const finalX = position.drawX + effects.offsetX;
    const finalY = position.drawY + effects.offsetY;

    // Define split point (where transparency begins - top 35% of tree becomes transparent)
    const splitRatio = 0.65; // Bottom 65% stays opaque, top 35% becomes transparent
    const splitY = finalY + (dimensions.height * splitRatio);

    // Render bottom part (trunk and lower foliage) - fully opaque
    ctx.save();
    ctx.beginPath();
    ctx.rect(finalX, splitY, dimensions.width, dimensions.height * (1 - splitRatio));
    ctx.clip();
    ctx.drawImage(image, finalX, finalY, dimensions.width, dimensions.height);
    ctx.restore();

    // Render top part (upper foliage) - less aggressive transparency
    ctx.save();
    ctx.globalAlpha = 0.6; // 60% opacity for top part (less aggressive than 30%)
    ctx.beginPath();
    ctx.rect(finalX, finalY, dimensions.width, dimensions.height * splitRatio);
    ctx.clip();
    ctx.drawImage(image, finalX, finalY, dimensions.width, dimensions.height);
    ctx.restore();
}
