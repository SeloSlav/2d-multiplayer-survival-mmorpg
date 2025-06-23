import { imageManager } from './imageManager';
import { getItemIcon } from '../itemIconUtils';
import { PlantedSeed } from '../../generated';

/**
 * Type alias for the actual generated PlantedSeed type
 */
export type PlantedSeedData = PlantedSeed;

/**
 * Get the appropriate seed icon based on seed type
 */
function getSeedIconForType(seedType: string): string {
    switch (seedType) {
        case 'Mushroom Spores':
            return 'mushroom_spore.png';
        case 'Hemp Seeds':
            return 'hemp_seeds.png';
        case 'Corn Seeds':
            return 'corn_seeds.png';
        case 'Potato Seeds':
        case 'Seed Potato':
            return 'seed_potato.png';
        case 'Reed Rhizome':
            return 'reed_rhizome.png';
        case 'Pumpkin Seeds':
            return 'pumpkin_seeds.png';
        default:
            console.warn(`Unknown seed type: ${seedType}, using default seed icon`);
            return 'mushroom_spore.png'; // Fallback
    }
}

/**
 * Calculate the growth progress (0.0 to 1.0) of a planted seed
 */
function getGrowthProgress(plantedAt: any, willMatureAt: any, currentTime: number): number {
    // Convert SpacetimeDB Timestamps to JavaScript timestamps
    const plantedTime = Number(plantedAt.microsSinceUnixEpoch) / 1000; // Convert microseconds to milliseconds
    const maturityTime = Number(willMatureAt.microsSinceUnixEpoch) / 1000; // Convert microseconds to milliseconds
    const progress = (currentTime - plantedTime) / (maturityTime - plantedTime);
    return Math.max(0, Math.min(1, progress)); // Clamp between 0 and 1
}

/**
 * Renders a planted seed on the ground
 */
export function renderPlantedSeed(
    ctx: CanvasRenderingContext2D,
    plantedSeed: PlantedSeedData,
    nowMs: number,
    cycleProgress: number
): void {
    const { posX, posY, seedType, plantedAt, willMatureAt } = plantedSeed;
    
    // Get the appropriate seed icon
    const seedIconName = getSeedIconForType(seedType);
    const seedImageSrc = getItemIcon(seedIconName);
    const seedImage = imageManager.getImage(seedImageSrc);
    
    if (!seedImage || !seedImage.complete) {
        // Draw a simple placeholder if image not loaded
        ctx.save();
        ctx.fillStyle = '#8B4513'; // Brown color for seed
        ctx.beginPath();
        ctx.arc(posX, posY, 4, 0, 2 * Math.PI);
        ctx.fill();
        ctx.restore();
        return;
    }
    
    // Calculate growth progress for visual effects
    const growthProgress = getGrowthProgress(plantedAt, willMatureAt, nowMs);
    
    ctx.save();
    
    // Apply subtle shadow effect
    ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;
    ctx.shadowBlur = 4;
    
    // Size grows slightly as the seed develops (32px to 48px)
    const baseSize = 32;
    const growthSizeBonus = 16 * growthProgress;
    const currentSize = baseSize + growthSizeBonus;
    
    // Slight subtle pulsing for recently planted seeds
    const plantedTime = Number(plantedAt.microsSinceUnixEpoch) / 1000; // Convert to milliseconds
    const timeSincePlanted = nowMs - plantedTime;
    const isPulsingPhase = timeSincePlanted < 10000; // Pulse for first 10 seconds
    let pulseScale = 1.0;
    
    if (isPulsingPhase) {
        const pulseSpeed = 2000; // 2 second pulse cycle
        const pulsePhase = (nowMs % pulseSpeed) / pulseSpeed;
        pulseScale = 1.0 + 0.1 * Math.sin(pulsePhase * Math.PI * 2);
    }
    
    // Add subtle green tint as it approaches maturity
    if (growthProgress > 0.5) {
        const greenTint = (growthProgress - 0.5) * 2; // 0 to 1 for second half of growth
        ctx.filter = `hue-rotate(${greenTint * 30}deg) brightness(${1 + greenTint * 0.2})`;
    }
    
    const finalSize = currentSize * pulseScale;
    
    // Draw the seed icon
    ctx.drawImage(
        seedImage,
        posX - finalSize / 2,
        posY - finalSize / 2,
        finalSize,
        finalSize
    );
    
    // Optional: Draw growth progress indicator for debugging (can be removed)
    if (process.env.NODE_ENV === 'development' && growthProgress > 0) {
        ctx.restore(); // Reset for clean drawing
        ctx.save();
        
        // Small progress circle around the seed
        const progressRadius = finalSize / 2 + 6;
        ctx.strokeStyle = `hsl(${120 * growthProgress}, 70%, 50%)`; // Red to green
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(posX, posY, progressRadius, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * growthProgress);
        ctx.stroke();
    }
    
    ctx.restore();
}

/**
 * Check if a planted seed should show interaction highlight
 */
export function isPlantedSeedInteractable(plantedSeed: PlantedSeedData, currentTime: number): boolean {
    // Seeds become "interactable" when they're fully grown (for debugging/info purposes)
    const growthProgress = getGrowthProgress(plantedSeed.plantedAt, plantedSeed.willMatureAt, currentTime);
    return growthProgress >= 1.0;
} 