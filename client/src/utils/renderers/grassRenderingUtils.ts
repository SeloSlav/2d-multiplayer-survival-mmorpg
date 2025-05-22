import {
    Grass,
    GrassAppearanceType
} from '../../generated'; // Import generated Grass type and AppearanceType
import { drawDynamicGroundShadow } from './shadowUtils';
import { GroundEntityConfig, renderConfiguredGroundEntity } from './genericGroundRenderer';
import { imageManager } from './imageManager';

// Import grass assets directly using @ alias
import grass1TextureUrl from '../../assets/doodads/grass1.png';
import grass2TextureUrl from '../../assets/doodads/grass2.png';
import grass3TextureUrl from '../../assets/doodads/grass3.png';
import tallGrassATextureUrl from '../../assets/doodads/tall_grass_a.png';
import tallGrassBTextureUrl from '../../assets/doodads/tall_grass_a.png';
import bushRoundedTextureUrl from '../../assets/doodads/grass1.png';
import bushSpikyTextureUrl from '../../assets/doodads/grass1.png';
import bushFloweringTextureUrl from '../../assets/doodads/grass1.png';
import bramblesATextureUrl from '../../assets/doodads/tall_grass_a.png';
import bramblesBTextureUrl from '../../assets/doodads/tall_grass_a.png';


// --- Constants for Grass Rendering ---
// const TARGET_GRASS_WIDTH_PX = 48; // Old constant, now part of grassSizeConfig
const SWAY_SPEED = 0.02;
const SWAY_AMPLITUDE = 3; // Max sway in pixels
const SWAY_VARIATION_FACTOR = 0.5; // How much individual sway can vary
const Y_SORT_OFFSET_GRASS = 5; // Fine-tune Y-sorting position relative to base
const MAX_POSITION_OFFSET_PX = 4; // Max random pixel offset for X and Y
const MAX_ROTATION_DEG = 5; // Max random rotation in degrees (+/-)
const SCALE_VARIATION_MIN = 0.95; // Min random scale factor
const SCALE_VARIATION_MAX = 1.05; // Max random scale factor

// Asset paths for different grass appearances and their animation frames
const grassAssetPaths: Record<string, string[]> = {
    [GrassAppearanceType.PatchA.tag]: [grass1TextureUrl],
    [GrassAppearanceType.PatchB.tag]: [grass2TextureUrl],
    [GrassAppearanceType.PatchC.tag]: [grass3TextureUrl],
    [GrassAppearanceType.TallGrassA.tag]: [tallGrassATextureUrl],
    [GrassAppearanceType.TallGrassB.tag]: [tallGrassBTextureUrl],
    [GrassAppearanceType.BushRounded.tag]: [bushRoundedTextureUrl],
    [GrassAppearanceType.BushSpiky.tag]: [bushSpikyTextureUrl],
    [GrassAppearanceType.BushFlowering.tag]: [bushFloweringTextureUrl],
    [GrassAppearanceType.BramblesA.tag]: [bramblesATextureUrl],
    [GrassAppearanceType.BramblesB.tag]: [bramblesBTextureUrl],
};

// --- NEW: Configuration for target sizes (width only, height will be scaled) ---
interface GrassSizeConfig {
    targetWidth: number;
    // Add other type-specific rendering params here later if needed (e.g., custom sway)
}

const grassSizeConfig: Record<string, GrassSizeConfig> = {
    [GrassAppearanceType.PatchA.tag]: { targetWidth: 48 },
    [GrassAppearanceType.PatchB.tag]: { targetWidth: 48 },
    [GrassAppearanceType.PatchC.tag]: { targetWidth: 48 },
    [GrassAppearanceType.TallGrassA.tag]: { targetWidth: 72 }, // Approx 1.5x
    [GrassAppearanceType.TallGrassB.tag]: { targetWidth: 96 }, // Approx 2x
    [GrassAppearanceType.BushRounded.tag]: { targetWidth: 80 },
    [GrassAppearanceType.BushSpiky.tag]: { targetWidth: 70 },
    [GrassAppearanceType.BushFlowering.tag]: { targetWidth: 75 },
    [GrassAppearanceType.BramblesA.tag]: { targetWidth: 100 },
    [GrassAppearanceType.BramblesB.tag]: { targetWidth: 120 },
    // Default fallback if a new type is added to enum but not here (should be avoided)
    default: { targetWidth: 48 },
};


// Preload all grass images
Object.values(grassAssetPaths).flat().forEach(path => imageManager.preloadImage(path));

// Configuration for rendering grass using the generic renderer
const grassConfig: GroundEntityConfig<Grass> = {
    getImageSource: (entity: Grass) => {
        const appearance = entity.appearanceType;
        const paths = grassAssetPaths[appearance.tag];
        if (!paths || paths.length === 0) {
            console.warn(`[grassRenderingUtils] No asset path found for grass type: ${appearance.tag}`);
            return null; // Or a fallback image path
        }
        const swaySeed = entity.swayOffsetSeed;
        // Basic animation frame selection (can be expanded)
        const frameIndex = Math.floor((Date.now() / 200) + swaySeed) % paths.length;
        return paths[frameIndex];
    },

    getTargetDimensions: (img, entity) => {
        const appearanceTag = entity.appearanceType.tag;
        const sizeConf = grassSizeConfig[appearanceTag] || grassSizeConfig.default;
        const targetWidth = sizeConf.targetWidth;

        const scaleFactor = targetWidth / img.naturalWidth;
        return {
            width: targetWidth,
            height: img.naturalHeight * scaleFactor,
        };
    },

    calculateDrawPosition: (entity, drawWidth, drawHeight) => {
        // Use swayOffsetSeed for deterministic randomness
        const seed = entity.swayOffsetSeed;
        // Generate offsets between -MAX_POSITION_OFFSET_PX and +MAX_POSITION_OFFSET_PX
        const randomOffsetX = ((seed % (MAX_POSITION_OFFSET_PX * 2 + 1)) - MAX_POSITION_OFFSET_PX);
        const randomOffsetY = (((seed >> 8) % (MAX_POSITION_OFFSET_PX * 2 + 1)) - MAX_POSITION_OFFSET_PX);

        return {
            drawX: entity.posX - drawWidth / 2 + randomOffsetX,
            drawY: entity.posY - drawHeight + Y_SORT_OFFSET_GRASS + randomOffsetY, // Apply Y-sort offset and random offset
        };
    },

    getShadowParams: undefined, 

    drawCustomGroundShadow: (ctx, entity, entityImage, entityPosX, entityBaseY, imageDrawWidth, imageDrawHeight, cycleProgress) => {
        // No-op to prevent any shadow drawing from this path
    },

    applyEffects: (ctx: CanvasRenderingContext2D, entity: Grass, nowMs: number, baseDrawX: number, baseDrawY: number, cycleProgress: number) => {
        // Sway effect for X position
        const swaySeed = entity.swayOffsetSeed;
        const individualSwayOffset = (swaySeed % 1000) / 1000.0; // Normalize seed to 0-1
        const swayCycle = (nowMs / 1000) * SWAY_SPEED * Math.PI * 2 + individualSwayOffset * Math.PI * 2 * SWAY_VARIATION_FACTOR;
        const offsetX = Math.sin(swayCycle) * SWAY_AMPLITUDE * (1 + (individualSwayOffset - 0.5) * SWAY_VARIATION_FACTOR);
        
        let offsetY = 0;
        const appearanceTag = entity.appearanceType.tag;
        if (
            appearanceTag === GrassAppearanceType.TallGrassA.tag ||
            appearanceTag === GrassAppearanceType.TallGrassB.tag ||
            appearanceTag === GrassAppearanceType.BushRounded.tag ||
            appearanceTag === GrassAppearanceType.BushSpiky.tag ||
            appearanceTag === GrassAppearanceType.BushFlowering.tag ||
            appearanceTag === GrassAppearanceType.BramblesA.tag ||
            appearanceTag === GrassAppearanceType.BramblesB.tag
        ) {
            const ySwayCycle = (nowMs / 1000) * SWAY_SPEED * 0.8 * Math.PI * 2 + (individualSwayOffset * 1.5) * Math.PI * 2 * SWAY_VARIATION_FACTOR;
            offsetY = Math.cos(ySwayCycle) * SWAY_AMPLITUDE * 0.5 * (1 + (individualSwayOffset - 0.5) * SWAY_VARIATION_FACTOR * 0.5);
        }

        // Deterministic random rotation based on seed (using different bits for variety)
        const rotationSeedPart = (swaySeed >> 16) % 360; // Use different part of the seed
        const randomRotation = ((rotationSeedPart / 359.0) * (MAX_ROTATION_DEG * 2)) - MAX_ROTATION_DEG; // Range: -MAX_ROTATION_DEG to +MAX_ROTATION_DEG

        // Deterministic random scale based on seed
        const scaleSeedPart = (swaySeed >> 24) % 1000; // Yet another part of the seed
        const randomScale = SCALE_VARIATION_MIN + (scaleSeedPart / 999.0) * (SCALE_VARIATION_MAX - SCALE_VARIATION_MIN);

        return {
            offsetX: offsetX,
            offsetY: offsetY, 
            rotation: randomRotation * (Math.PI / 180), // Convert to radians for canvas
            scale: randomScale,
        };
    },

    fallbackColor: 'rgba(34, 139, 34, 0.7)', 
};

// Function to render a single grass entity using the generic renderer
export function renderGrass(
    ctx: CanvasRenderingContext2D,
    grass: Grass,
    nowMs: number,
    cycleProgress: number,
    onlyDrawShadow?: boolean,
    skipDrawingShadow?: boolean
) {
    if (grass.health <= 0) return; 

    renderConfiguredGroundEntity<Grass>({
        ctx,
        entity: grass,
        config: grassConfig,
        nowMs,
        entityPosX: grass.posX,
        entityPosY: grass.posY,
        cycleProgress,
        onlyDrawShadow,
        skipDrawingShadow,
    });
}
