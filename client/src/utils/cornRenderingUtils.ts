import { Corn } from '../generated'; // Import generated Corn type
import cornImage from '../assets/doodads/corn_stalk.png'; // Use correct asset filename
import { drawShadow } from './shadowUtils'; // Import the shadow utility

// Define image sources map
export const cornImageSources: { [key: string]: string } = {
  Default: cornImage, // Only one type for now
};

// Simple cache for loaded images
const imageCache: { [key: string]: HTMLImageElement } = {};

// Preload images
export function preloadCornImages() {
  Object.values(cornImageSources).forEach((src) => {
    if (!imageCache[src]) {
      const img = new Image();
      img.src = src;
      imageCache[src] = img;
      // img.onload = () => console.log(`Loaded corn image: ${src}`);
      // img.onerror = () => console.error(`Failed to load corn image: ${src}`);
    }
  });
}

// Function to get the image for a corn plant
function getCornImage(corn: Corn): HTMLImageElement | null {
  // Only one type for now
  const src = cornImageSources.Default;

  if (!src) {
    console.error('Could not determine image source for corn:', corn);
    return null;
  }

  if (!imageCache[src]) {
    console.warn(`Corn image not preloaded: ${src}. Attempting load.`);
    const img = new Image();
    img.src = src;
    imageCache[src] = img;
  }

  return imageCache[src];
}

// Function to draw a single corn plant
const TARGET_CORN_WIDTH_PX = 64; // Target width on screen (adjust as needed)

export function renderCorn(ctx: CanvasRenderingContext2D, corn: Corn, now_ms: number) {
  const img = getCornImage(corn);
  if (!img || !img.complete || img.naturalWidth === 0) {
    return; // Image not loaded yet or failed
  }

  // Calculate scaling factor based on target width
  const scaleFactor = TARGET_CORN_WIDTH_PX / img.naturalWidth;
  const drawWidth = TARGET_CORN_WIDTH_PX;
  const drawHeight = img.naturalHeight * scaleFactor;

  const centerX = corn.posX;
  const baseY = corn.posY; // Shadow sits at the base Y coordinate
  const drawX = centerX - drawWidth / 2; // Top-left corner for image drawing
  const drawY = baseY - drawHeight; // Draw image upwards from base Y

  // Draw shadow first (small dot/ellipse)
  const shadowRadiusX = drawWidth * 0.3;
  const shadowRadiusY = shadowRadiusX * 0.4;
  const shadowOffsetY = -drawHeight * 0.05; // Push shadow up slightly less (15% of corn height)
  drawShadow(ctx, centerX, baseY + shadowOffsetY, shadowRadiusX, shadowRadiusY);

  ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);

  // No health bar or shake needed for corn currently
} 