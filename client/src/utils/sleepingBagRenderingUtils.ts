import { SleepingBag as SpacetimeDBSleepingBag } from '../generated';
import { drawShadow } from './shadowUtils';
import { SLEEPING_BAG_WIDTH, SLEEPING_BAG_HEIGHT } from '../config/gameConfig'; // Import defined constants

let sleepingBagImage: HTMLImageElement | null = null;

export function preloadSleepingBagImage(itemImagesRef: React.RefObject<Map<string, HTMLImageElement>>) {
    const img = itemImagesRef.current?.get('sleeping_bag.png');
    if (img) {
        sleepingBagImage = img;
        console.log('Sleeping Bag image preloaded successfully.');
    } else {
        console.error('Failed to preload Sleeping Bag image asset: sleeping_bag.png');
        // Optionally load a fallback image or handle the error
        // For now, we'll rely on the check within renderSleepingBag
    }
}

interface RenderSleepingBagParams {
    ctx: CanvasRenderingContext2D;
    sleepingBag: SpacetimeDBSleepingBag;
    itemImagesRef: React.RefObject<Map<string, HTMLImageElement>>; // Keep ref for potential dynamic loading
    nowMs: number; // Added for potential future animation
}

/**
 * Renders a single sleeping bag entity onto the canvas.
 */
export function renderSleepingBag({
    ctx,
    sleepingBag,
    itemImagesRef,
    nowMs,
}: RenderSleepingBagParams): void {
    const { posX, posY } = sleepingBag;

    // Use the preloaded image if available, otherwise try to get it from the ref
    const currentSleepingBagImage = sleepingBagImage || itemImagesRef.current?.get('sleeping_bag.png');

    if (currentSleepingBagImage && currentSleepingBagImage.complete && currentSleepingBagImage.naturalHeight !== 0) {
        // Draw shadow first
        // drawShadow(ctx, posX, posY + SLEEPING_BAG_HEIGHT * 0.2, SLEEPING_BAG_WIDTH * 0.2, SLEEPING_BAG_HEIGHT * 0.2);

        // Draw the sleeping bag image
        // Adjust drawing position based on the desired registration point (e.g., center)
        ctx.drawImage(
            currentSleepingBagImage,
            posX - SLEEPING_BAG_WIDTH / 2,
            posY - SLEEPING_BAG_HEIGHT / 2,
            SLEEPING_BAG_WIDTH,
            SLEEPING_BAG_HEIGHT
        );
    } else {
        // Fallback rendering if the image isn't loaded
        ctx.fillStyle = 'purple'; // Use a distinct color for missing assets
        ctx.fillRect(
            posX - SLEEPING_BAG_WIDTH / 4, 
            posY - SLEEPING_BAG_HEIGHT / 4,
            SLEEPING_BAG_WIDTH / 2,
            SLEEPING_BAG_HEIGHT / 2
        );
        // Log error only once or manage loading state properly elsewhere
        // console.error(`Sleeping Bag image not loaded for ID: ${sleepingBag.id}`);
    }
} 