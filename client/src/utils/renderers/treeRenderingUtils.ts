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
const TARGET_TREE_WIDTH_PX = 480; // Target width on screen (base size for tallest tree - Sitka Spruce)
const TREE_HEIGHT = 120;
const SHAKE_DURATION_MS = 500;
const SHAKE_INTENSITY_PX = 8;

// --- Client-side animation tracking for tree shakes ---
const clientTreeShakeStartTimes = new Map<string, number>(); // treeId -> client timestamp when shake started
const lastKnownServerTreeShakeTimes = new Map<string, number>(); // treeId -> last known server timestamp

// PERFORMANCE: Cache tree type results to avoid repeated runtime checks
const treeTypeCache = new Map<string, { imageSource: string; targetWidth: number }>();

// PERFORMANCE: Helper to get cached tree type info
function getCachedTreeTypeInfo(entity: Tree): { imageSource: string; targetWidth: number } {
    const treeTypeKey = typeof entity.treeType === 'object' && entity.treeType !== null && 'tag' in entity.treeType
        ? (entity.treeType as any).tag
        : entity.treeType;
    
    let cached = treeTypeCache.get(treeTypeKey);
    if (!cached) {
        // Calculate once and cache
        let imageSource: string;
        let targetWidth: number;
        
        switch (treeTypeKey) {
            case 'AleppoPine':
                imageSource = aleppoPineImage;
                targetWidth = 320; // 33% shorter than Sitka Spruce
                break;
            case 'MannaAsh':
                imageSource = mannaAshImage;
                targetWidth = 400; // 17% shorter than Sitka Spruce
                break;
            case 'DownyOak':
                imageSource = downyOakImage;
                targetWidth = 480; // Full size (same as old uniform height)
                break;
            case 'StonePine':
                imageSource = stonePineImage;
                targetWidth = 360; // 25% shorter than Sitka Spruce
                break;
            default:
                imageSource = downyOakImage;
                targetWidth = TARGET_TREE_WIDTH_PX; // Fallback to Sitka Spruce size
        }
        
        cached = { imageSource, targetWidth };
        treeTypeCache.set(treeTypeKey, cached);
    }
    
    return cached;
}

// Define the configuration for rendering trees
const treeConfig: GroundEntityConfig<Tree> = {
    getImageSource: (entity) => {
        return getCachedTreeTypeInfo(entity).imageSource;
    },

    getTargetDimensions: (img, entity) => {
        const { targetWidth } = getCachedTreeTypeInfo(entity);
        const scaleFactor = targetWidth / img.naturalWidth;
        return {
            width: targetWidth,
            height: img.naturalHeight * scaleFactor,
        };
    },

    calculateDrawPosition: (entity, drawWidth, drawHeight) => ({
        // Top-left corner for image drawing, originating from entity's base Y
        drawX: entity.posX - drawWidth / 2, 
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
    localPlayerPosition?: { x: number; y: number } | null, // Player position (unused but kept for compatibility)
    treeShadowsEnabled: boolean = true // NEW: Visual cortex module setting
) {
    // PERFORMANCE: Skip shadow rendering entirely if disabled in visual settings
    const shouldSkipShadows = !treeShadowsEnabled || skipDrawingShadow;
    
    renderConfiguredGroundEntity({
        ctx,
        entity: tree,
        config: treeConfig,
        nowMs: now_ms,
        entityPosX: tree.posX,
        entityPosY: tree.posY,
        cycleProgress,
        onlyDrawShadow,    // Pass flag
        skipDrawingShadow: shouldSkipShadows  // Use computed shadow skip flag
    });
}
