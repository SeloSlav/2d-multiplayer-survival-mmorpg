import { Tree } from '../../generated'; // Import generated types
import aleppoPineImage from '../../assets/doodads/siberian_birch_b.png';
import mannaAshImage from '../../assets/doodads/mountain_hemlock_b.png';
import downyOakImage from '../../assets/doodads/sitka_spruce_b.png';
import stonePineImage from '../../assets/doodads/sitka_alder_b.png'; // New import for stone pine
// import treeOakImage from '../assets/doodads/tree.png'; // REMOVED
// import treeStumpImage from '../assets/doodads/tree_stump.png'; // REMOVED
import { drawDynamicGroundShadow, calculateShakeOffsets } from './shadowUtils'; // Import shadow utils
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
        // Calculate shake offsets for shadow synchronization using helper function
        const { shakeOffsetX, shakeOffsetY } = calculateShakeOffsets(
            entity,
            entity.id.toString(),
            {
                clientStartTimes: clientTreeShakeStartTimes,
                lastKnownServerTimes: lastKnownServerTreeShakeTimes
            },
            SHAKE_DURATION_MS,
            SHAKE_INTENSITY_PX
        );

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
            pivotYOffset: 15,
            // NEW: Pass shake offsets so shadow moves with the tree
            shakeOffsetX,
            shakeOffsetY
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
    // We need to check if player is behind ANY portion of the tree image
    
    // First get the actual tree image dimensions to calculate the real tree bounds
    const imageSource = treeConfig.getImageSource(tree);
    const image = imageSource ? imageManager.getImage(imageSource) : null;
    const actualTreeHeight = image ? (image.naturalHeight * (TARGET_TREE_WIDTH_PX / image.naturalWidth)) : (TARGET_TREE_WIDTH_PX * 0.8);
    
    const treeImageTop = tree.posY - actualTreeHeight; // Actual top of the tree image
    const treeImageBottom = tree.posY; // Tree base position
    
    const shouldApplyTransparency = localPlayerPosition && 
                                   localPlayerPosition.y >= treeImageTop && // Player is below the actual top of tree image
                                   localPlayerPosition.y <= treeImageBottom && // Player is above the tree base
                                   Math.abs(localPlayerPosition.x - tree.posX) < (TARGET_TREE_WIDTH_PX * 0.6); // Within reasonable tree width

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

// Helper function to render tree with partial transparency using a smooth opacity gradient
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

    // Define transparency gradient zones
    const gradientStartRatio = 0.8; // Start fading at 80% of tree height (only bottom 20% stays opaque)
    const gradientEndRatio = 0.1;   // Maximum transparency at 10% from top
    const gradientStartY = finalY + (dimensions.height * gradientStartRatio);
    const gradientEndY = finalY + (dimensions.height * gradientEndRatio);

    // Render tree in horizontal slices with varying opacity for smooth gradient
    const numSlices = 20; // More slices = smoother gradient
    const sliceHeight = dimensions.height / numSlices;

    ctx.save();

    for (let i = 0; i < numSlices; i++) {
        const sliceY = finalY + (i * sliceHeight);
        const sliceCenterY = sliceY + (sliceHeight / 2);
        
        // Calculate opacity based on position in the gradient zone
        let opacity = 1.0; // Default fully opaque
        
        if (sliceCenterY <= gradientStartY && sliceCenterY >= gradientEndY) {
            // We're in the gradient zone - calculate smooth opacity transition
            const gradientProgress = (gradientStartY - sliceCenterY) / (gradientStartY - gradientEndY);
            // Use a smooth curve for more natural transition
            const easedProgress = 1 - Math.pow(1 - gradientProgress, 2); // Ease-out curve
            opacity = 1.0 - (easedProgress * 0.6); // Maximum 60% transparency at top
        } else if (sliceCenterY < gradientEndY) {
            // Above gradient zone - maximum transparency
            opacity = 0.4; // 60% transparent
        }
        // Below gradient zone stays fully opaque (opacity = 1.0)

        ctx.globalAlpha = opacity;
        
        // Clip to current slice and draw
        ctx.save();
        ctx.beginPath();
        ctx.rect(finalX, sliceY, dimensions.width, sliceHeight);
        ctx.clip();
        ctx.drawImage(image, finalX, finalY, dimensions.width, dimensions.height);
        ctx.restore();
    }

    ctx.restore();
}
