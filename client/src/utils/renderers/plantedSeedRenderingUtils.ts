import { PlantedSeed } from '../../generated';

/**
 * Type alias for the actual generated PlantedSeed type
 */
export type PlantedSeedData = PlantedSeed;

/**
 * Get the growth progress from the server-calculated value
 * The server now handles sophisticated growth calculations based on weather and time of day
 */
function getGrowthProgress(plantedSeed: PlantedSeedData): number {
    // Use the server-calculated growth progress directly
    return Math.max(0, Math.min(1, plantedSeed.growthProgress || 0));
}

/**
 * Renders a planted seed on the ground
 */
export function renderPlantedSeed(
    ctx: CanvasRenderingContext2D,
    plantedSeed: PlantedSeedData,
    nowMs: number,
    cycleProgress: number,
    plantedSeedImage?: HTMLImageElement | null
): void {
    const { posX, posY, seedType } = plantedSeed;
    
    if (!plantedSeedImage || !plantedSeedImage.complete) {
        // Draw a simple placeholder if image not loaded
        ctx.save();
        ctx.fillStyle = '#8B4513'; // Brown color for seed
        ctx.beginPath();
        ctx.arc(posX, posY, 4, 0, 2 * Math.PI);
        ctx.fill();
        ctx.restore();
        return;
    }
    
    // Get growth progress from server-calculated value
    const growthProgress = getGrowthProgress(plantedSeed);
    
    ctx.save();
    
    // Apply subtle shadow effect
    ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;
    ctx.shadowBlur = 4;
    
    // Constant size for planted seed (dirt patch)
    const finalSize = 48;
    
    // Draw the planted seed image
    ctx.drawImage(
        plantedSeedImage,
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
export function isPlantedSeedInteractable(plantedSeed: PlantedSeedData): boolean {
    // Seeds become "interactable" when they're fully grown (for debugging/info purposes)
    const growthProgress = getGrowthProgress(plantedSeed);
    return growthProgress >= 1.0;
} 