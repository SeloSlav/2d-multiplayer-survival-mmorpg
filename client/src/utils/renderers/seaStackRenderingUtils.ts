import seaStackImage1 from '../../assets/doodads/sea_stack.png';
import seaStackImage2 from '../../assets/doodads/sea_stack2.png';
import seaStackImage3 from '../../assets/doodads/sea_stack3.png';
import { drawDynamicGroundShadow } from './shadowUtils';

// Constants for sea stack rendering
const SEA_STACK_CONFIG = {
  // Size variation (relative to tallest trees at 480px)
  MIN_SCALE: 1.2, // Minimum 1.2x taller than tallest trees
  MAX_SCALE: 2.5,  // Maximum 2.5x taller than tallest trees  
  BASE_WIDTH: 400, // pixels - base sea stack size (towering over trees)
};

// Water line effect constants
const WATER_LINE_CONFIG = {
  HEIGHT_OFFSET: 55, // How high up from the base to place the water line (increased to 55 for better gradient coverage)
  WAVE_AMPLITUDE: 2, // How much the water line moves up/down (reduced for more subtle effect)
  WAVE_FREQUENCY: 0.002, // Speed of wave animation (slower for more realistic)
  SHIMMER_FREQUENCY: 0.005, // Speed of shimmer effect
  UNDERWATER_TINT: 'rgba(12, 62, 79, 0.6)', // Dark blue underwater tint using #0C3E4F
  CONTOUR_SAMPLE_DENSITY: 4, // Sample every 4 pixels for contour detection
};

// Sea stack images array for variation (all three variants available)
const SEA_STACK_IMAGES = [seaStackImage1, seaStackImage2, seaStackImage3];

// Cache for image contour data to avoid recalculating every frame
const imageContourCache = new Map<string, number[]>();

interface SeaStack {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
  imageIndex: number; // 0, 1, or 2 for different sea stack images
}

// Pre-loaded image cache to prevent lag spikes
let preloadedImages: HTMLImageElement[] = [];
let imagesLoaded = false;

/**
 * Pre-loads all sea stack images asynchronously to prevent lag spikes
 */
function preloadSeaStackImages(): void {
  if (imagesLoaded) return;
  
  let loadedCount = 0;
  const totalImages = SEA_STACK_IMAGES.length;
  
  SEA_STACK_IMAGES.forEach((imageSrc, index) => {
    if (!imageSrc) return;
    
    const img = new Image();
    img.onload = () => {
      preloadedImages[index] = img;
      loadedCount++;
      
      if (loadedCount === totalImages) {
        imagesLoaded = true;
        console.log('[SeaStacks] All images pre-loaded successfully');
      }
    };
    img.onerror = () => {
      console.error(`[SeaStacks] Failed to load image variant ${index + 1}`);
      loadedCount++; // Still increment to avoid hanging
      
      if (loadedCount === totalImages) {
        imagesLoaded = preloadedImages.length > 0; // Only mark loaded if we have at least one image
        console.log(`[SeaStacks] Image loading completed with ${preloadedImages.length}/${totalImages} successful`);
      }
    };
    img.src = imageSrc;
  });
}

/**
 * Analyzes image pixels to find the widest contour near the base
 * Samples multiple Y levels to ensure we get the full width
 * Returns an array of X positions where the image has content (not transparent)
 */
function getImageContourAtLevel(
  image: HTMLImageElement,
  waterLineY: number,
  width: number,
  height: number
): number[] {
  const cacheKey = `${image.src}_${WATER_LINE_CONFIG.HEIGHT_OFFSET}_${width}_${height}`;
  
  // Check cache first
  if (imageContourCache.has(cacheKey)) {
    return imageContourCache.get(cacheKey)!;
  }
  
  // Create a temporary canvas to analyze the image
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];
  
  canvas.width = width;
  canvas.height = height;
  
  // Draw the image to analyze its pixels
  ctx.drawImage(image, 0, 0, width, height);
  
  let widestContour: number[] = [];
  let maxWidth = 0;
  
  // Sample multiple Y levels around the water line to find the widest part
  const baseY = height - WATER_LINE_CONFIG.HEIGHT_OFFSET;
  const scanRange = 25; // Scan 25 pixels above and below the water line (increased for higher water line)
  
  for (let yOffset = -scanRange; yOffset <= scanRange; yOffset += 3) {
    const checkY = baseY + yOffset;
    
    if (checkY >= 0 && checkY < height) {
      try {
        const imageData = ctx.getImageData(0, checkY, width, 1);
        const data = imageData.data;
        
        const currentContour: number[] = [];
        
        // Sample across the width to find where the image has content
        for (let x = 0; x < width; x += 2) { // Sample every 2 pixels for better coverage
          const pixelIndex = x * 4; // RGBA
          const alpha = data[pixelIndex + 3]; // Alpha channel
          
          if (alpha > 5) { // Not transparent (low threshold to catch edges)
            currentContour.push(x - width / 2); // Convert to centered coordinates
          }
        }
        
        // If this contour is wider than our current widest, use it
        if (currentContour.length > 0) {
          const contourWidth = Math.max(...currentContour) - Math.min(...currentContour);
          if (contourWidth > maxWidth) {
            maxWidth = contourWidth;
            widestContour = currentContour;
          }
        }
      } catch (error) {
        console.warn('[SeaStacks] Could not analyze image pixels for contour at Y offset:', yOffset, error);
      }
    }
  }
  
  // If we still don't have a good contour, create a fallback based on a reasonable base width
  if (widestContour.length === 0) {
    console.warn('[SeaStacks] No contour found, using fallback width');
    const fallbackWidth = width * 0.8; // Use 80% of the total width as fallback (increased for higher water line)
    for (let x = -fallbackWidth / 2; x <= fallbackWidth / 2; x += 6) { // Smaller increments for better coverage
      widestContour.push(x);
    }
  }
  
  // Cache the result
  imageContourCache.set(cacheKey, widestContour);
  return widestContour;
}

/**
 * Draws animated water line effects that follow the actual sea stack contour
 */
function drawWaterLineEffects(
  ctx: CanvasRenderingContext2D,
  stack: SeaStack,
  image: HTMLImageElement,
  width: number,
  height: number,
  currentTimeMs: number
): void {
  const waterLineY = -WATER_LINE_CONFIG.HEIGHT_OFFSET;
  const time = currentTimeMs;
  
  // Get contour points at the water line level
  const contourPoints = getImageContourAtLevel(image, waterLineY, width, height);
  
  if (contourPoints.length === 0) return; // No contour found
  
  // Create animated wave offset
  const baseWaveOffset = Math.sin(time * WATER_LINE_CONFIG.WAVE_FREQUENCY + stack.x * 0.01) * WATER_LINE_CONFIG.WAVE_AMPLITUDE;
  const shimmerIntensity = (Math.sin(time * WATER_LINE_CONFIG.SHIMMER_FREQUENCY * 2) + 1) * 0.5;
  
  ctx.save();
  
  // 1. Draw underwater tinting using a clipping path that follows the image shape
  ctx.save();
  ctx.beginPath();
  
  // Create clipping path that follows the contour and extends downward
  if (contourPoints.length > 0) {
    // Find leftmost and rightmost points
    const leftMost = Math.min(...contourPoints);
    const rightMost = Math.max(...contourPoints);
    
    // Start from left side of water line
    ctx.moveTo(leftMost, waterLineY + baseWaveOffset);
    
    // Follow the contour points with subtle wave animation
    contourPoints.forEach((x, index) => {
      const localWaveOffset = baseWaveOffset + Math.sin(time * WATER_LINE_CONFIG.WAVE_FREQUENCY * 2 + index * 0.5) * 1;
      ctx.lineTo(x, waterLineY + localWaveOffset);
    });
    
    // Complete the underwater area
    ctx.lineTo(rightMost, waterLineY + baseWaveOffset + 100); // Extend down
    ctx.lineTo(leftMost, waterLineY + baseWaveOffset + 100); // Extend down
    ctx.closePath();
    
    // Apply clipping and fill with gradient underwater tint
    ctx.clip();
    
    // Create aggressive gradient that quickly covers the sea stack
    const underwaterGradient = ctx.createLinearGradient(0, waterLineY, 0, waterLineY + 60);
    underwaterGradient.addColorStop(0, 'rgba(12, 62, 79, 0.7)'); // Strong tint right at water line
    underwaterGradient.addColorStop(0.2, 'rgba(12, 62, 79, 0.9)'); // Very strong tint quickly
    underwaterGradient.addColorStop(0.5, 'rgba(12, 62, 79, 1)'); // Fully opaque halfway down
    underwaterGradient.addColorStop(1, 'rgba(12, 62, 79, 1)'); // Stay fully opaque to bottom
    
    ctx.fillStyle = underwaterGradient;
    ctx.fillRect(-width / 2, waterLineY, width, 100);
  }
  
  ctx.restore();
  
  // 2. Draw the animated water line following the contour
  if (contourPoints.length > 0) {
    ctx.strokeStyle = `rgba(100, 200, 255, ${0.6 + shimmerIntensity * 0.3})`;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    ctx.beginPath();
    
    // Draw water line segments following the contour
    contourPoints.forEach((x, index) => {
      const localWaveOffset = baseWaveOffset + Math.sin(time * WATER_LINE_CONFIG.WAVE_FREQUENCY * 3 + index * 0.3) * 1;
      const y = waterLineY + localWaveOffset;
      
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    
    ctx.stroke();
    
    // Add shimmer highlights on the water line
    if (shimmerIntensity > 0.7) {
      ctx.strokeStyle = `rgba(255, 255, 255, ${(shimmerIntensity - 0.7) * 2})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  
  ctx.restore();
}



/**
 * Renders a single sea stack with dynamic ground shadow and water effects
 */
function renderSeaStack(
  ctx: CanvasRenderingContext2D,
  stack: SeaStack,
  image: HTMLImageElement,
  cycleProgress?: number,
  onlyDrawShadow?: boolean,
  skipDrawingShadow?: boolean,
  currentTimeMs?: number
): void {
  if (!image || !image.complete) return;
  
  const width = SEA_STACK_CONFIG.BASE_WIDTH * stack.scale;
  const height = (image.naturalHeight / image.naturalWidth) * width;
  
  // Draw dynamic ground shadow first (before the sea stack)
  if (!skipDrawingShadow && cycleProgress !== undefined) {
    // Adjust shadow position to the water line (visual base) instead of image bottom
    const shadowBaseY = stack.y - WATER_LINE_CONFIG.HEIGHT_OFFSET;
    
    drawDynamicGroundShadow({
      ctx,
      entityImage: image,
      entityCenterX: stack.x - 30,
      entityBaseY: shadowBaseY + 30, // Shadow positioned at water line level
      imageDrawWidth: width,
      imageDrawHeight: height,
      cycleProgress,
      maxStretchFactor: 2.0, // Sea stacks cast substantial shadows
      minStretchFactor: 0.2,  // Decent minimum shadow
      shadowBlur: 3,
      pivotYOffset: 20, // Sea stacks are tall, shadow slightly forward
    });
  }
  
  // If only drawing shadow, stop here
  if (onlyDrawShadow) return;
  
  ctx.save();
  
  // Apply transformations
  ctx.translate(stack.x, stack.y);
  ctx.rotate(stack.rotation);
  ctx.globalAlpha = stack.opacity;
  
    // Draw the sea stack centered (simple and clean)
  ctx.drawImage(
    image,
    -width / 2,
    -height,
    width,
    height
  );
  
  // Add simple water line effect if time is provided
  if (currentTimeMs !== undefined) {
    drawWaterLineEffects(ctx, stack, image, width, height, currentTimeMs);
  }
  
  ctx.restore();
}

/**
 * Renders a single sea stack entity for the Y-sorted rendering system
 * This function is used when sea stacks are rendered individually through the Y-sorted entities
 */
export function renderSeaStackSingle(
  ctx: CanvasRenderingContext2D,
  seaStack: any, // Server-provided sea stack entity
  doodadImages: Map<string, HTMLImageElement> | null,
  cycleProgress?: number, // Day/night cycle for dynamic shadows
  currentTimeMs?: number // Current time for animations
): void {
  // Trigger image preloading on first call
  preloadSeaStackImages();
  
  // Early exit if images not loaded yet
  if (!imagesLoaded || preloadedImages.length === 0) return;
    
    // Map server variant to image index
    let imageIndex = 0;
    if (seaStack.variant && seaStack.variant.tag) {
      switch (seaStack.variant.tag) {
        case 'Tall': imageIndex = 0; break;
        case 'Medium': imageIndex = 1; break;
        case 'Wide': imageIndex = 2; break;
        default: imageIndex = 0; break;
      }
    }
    
    // Ensure valid image index
    imageIndex = Math.min(imageIndex, preloadedImages.length - 1);
    const stackImage = preloadedImages[imageIndex];
    
  if (stackImage && stackImage.complete) {
      // Create client-side rendering object from server data
    const clientStack: SeaStack = {
        x: seaStack.posX,
        y: seaStack.posY,
        scale: seaStack.scale || 1.0,
        rotation: 0.0, // Keep sea stacks upright (no rotation)
        opacity: seaStack.opacity || 1.0,
        imageIndex: imageIndex
      };
      
    // Render with water effects (pass current time for animations)
    renderSeaStack(ctx, clientStack, stackImage, cycleProgress, false, false, currentTimeMs || Date.now());
  }
}

// Removed clearSeaStackCache function - no longer needed since sea stacks are server-authoritative 