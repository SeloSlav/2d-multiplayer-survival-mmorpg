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
  WAVE_AMPLITUDE: 1.5, // How much the water line moves up/down (even more subtle for cozy feel)
  WAVE_FREQUENCY: 0.0008, // Much slower for cozy, atmospheric feel (was 0.002)
  SHIMMER_FREQUENCY: 0.002, // Slower shimmer for atmospheric feel (was 0.005)
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
        // console.log('[SeaStacks] All images pre-loaded successfully');
      }
    };
    img.onerror = () => {
      console.error(`[SeaStacks] Failed to load image variant ${index + 1}`);
      loadedCount++; // Still increment to avoid hanging
      
      if (loadedCount === totalImages) {
        imagesLoaded = preloadedImages.length > 0; // Only mark loaded if we have at least one image
        //console.log(`[SeaStacks] Image loading completed with ${preloadedImages.length}/${totalImages} successful`);
      }
    };
    img.src = imageSrc;
  });
}

/**
 * Analyzes image pixels to find the widest contour near the base
 * Samples multiple Y levels to ensure we get the full width, including the very bottom
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
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];
  
  canvas.width = width;
  canvas.height = height;
  
  // Draw the image to analyze its pixels
  ctx.drawImage(image, 0, 0, width, height);
  
  let widestContour: number[] = [];
  let maxWidth = 0;
  
  // console.log(`[SeaStacks] Image dimensions: ${width}x${height}`);
  
  // First pass: scan entire image to see what alpha values we actually have
  let minAlpha = null, maxAlpha = null, totalPixels = 0, opaquePixels = 0;
  
  // Sample a few rows to analyze alpha values
  for (let y = 0; y < height; y += Math.floor(height / 20)) { // Sample ~20 rows across the image
    try {
      const imageData = ctx.getImageData(0, y, width, 1);
      const data = imageData.data;
      
      for (let x = 0; x < width; x++) {
        const alpha = data[x * 4 + 3];
        if (alpha !== undefined && !isNaN(alpha)) {
          if (minAlpha === null || alpha < minAlpha) minAlpha = alpha;
          if (maxAlpha === null || alpha > maxAlpha) maxAlpha = alpha;
          totalPixels++;
          if (alpha > 0) opaquePixels++;
        }
      }
    } catch (error) {
      console.warn(`[SeaStacks] Error reading row ${y}:`, error);
    }
  }
  
  // Fallback if no valid alpha values found
  if (minAlpha === null || maxAlpha === null) {
    // console.log(`[SeaStacks] Could not read alpha values, using fallback`);
    minAlpha = 0;
    maxAlpha = 255;
  }
  
  // console.log(`[SeaStacks] Alpha range: ${minAlpha}-${maxAlpha}, ${opaquePixels}/${totalPixels} pixels have alpha > 0`);
  
  // Use a simple threshold that should work
  const alphaThreshold = 30; // Fixed threshold that should catch solid pixels
  // console.log(`[SeaStacks] Using alpha threshold: ${alphaThreshold}`);
  
    // Scan the image for contours, focusing on the bottom portion where sea stacks are widest
  const startY = Math.floor(height * 0.2); // Start from 20% down
  const endY = Math.floor(height * 0.98);  // Scan almost to the very bottom (98%)
  // console.log(`[SeaStacks] Scanning rows ${startY} to ${endY}`);
  
  let rowsWithPixels = 0;
  let debugRowCount = 0;
  
  for (let y = startY; y < endY; y += 2) { // Every 2nd row for better accuracy
    try {
      const imageData = ctx.getImageData(0, y, width, 1);
      const data = imageData.data;
      
      let leftEdge = -1;
      let rightEdge = -1;
      let pixelsInRow = 0;
      
      // Count pixels in this row and find edges
      for (let x = 0; x < width; x++) {
        const alpha = data[x * 4 + 3];
        if (alpha > 0) pixelsInRow++;
        
        if (alpha > alphaThreshold) {
          if (leftEdge === -1) leftEdge = x;
          rightEdge = x; // Keep updating to get the rightmost
        }
      }
      
      if (pixelsInRow > 0) rowsWithPixels++;
      
      // Debug first few rows
      if (debugRowCount < 3 && pixelsInRow > 0) {
        // console.log(`[SeaStacks] Row ${y} debug: ${pixelsInRow} pixels with alpha>0, left=${leftEdge}, right=${rightEdge}, threshold=${alphaThreshold}`);
        // Sample a few pixel values
        for (let x = 0; x < Math.min(width, 10); x++) {
          const alpha = data[x * 4 + 3];
          if (alpha > 0) {
            // console.log(`[SeaStacks] Pixel at (${x}, ${y}) has alpha=${alpha}`);
          }
        }
        debugRowCount++;
      }
      
      // If we found both edges, check if this is the widest
      if (leftEdge !== -1 && rightEdge !== -1) {
        const contourWidth = rightEdge - leftEdge + 1;
        
        if (contourWidth > maxWidth) {
          maxWidth = contourWidth;
          widestContour = [];
          
          // console.log(`[SeaStacks] New widest contour at Y=${y}: width=${contourWidth}, left=${leftEdge}, right=${rightEdge}, pixelsInRow=${pixelsInRow}`);
          
          // Create contour points every 2 pixels for performance
          for (let x = leftEdge; x <= rightEdge; x += 2) {
            widestContour.push(x - width / 2); // Convert to centered coordinates
          }
        }
      }
    } catch (error) {
      console.warn(`[SeaStacks] Error reading row ${y}:`, error);
    }
  }
  
  // console.log(`[SeaStacks] Found ${rowsWithPixels} rows with pixels out of ${Math.floor((endY - startY) / 2)} scanned rows`);
    
    // console.log(`[SeaStacks] Final contour: width=${maxWidth}, points=${widestContour.length}`);
    
    // If still no contour found, try a more aggressive approach
    if (maxWidth === 0) {
      // console.log(`[SeaStacks] No contour found with threshold ${alphaThreshold}, trying lower threshold`);
      
      // Try with a much lower threshold
      const lowThreshold = 5;
      for (let y = startY; y < endY; y += 3) {
        try {
          const imageData = ctx.getImageData(0, y, width, 1);
          const data = imageData.data;
          
          let leftEdge = -1, rightEdge = -1;
          
          for (let x = 0; x < width; x++) {
            const alpha = data[x * 4 + 3];
            if (alpha > lowThreshold) {
              leftEdge = x;
              break;
            }
          }
          
          for (let x = width - 1; x >= 0; x--) {
            const alpha = data[x * 4 + 3];
            if (alpha > lowThreshold) {
              rightEdge = x;
              break;
            }
          }
          
          if (leftEdge !== -1 && rightEdge !== -1) {
            const contourWidth = rightEdge - leftEdge + 1;
            if (contourWidth > maxWidth) {
              maxWidth = contourWidth;
              widestContour = [];
              // console.log(`[SeaStacks] Found contour with low threshold at Y=${y}: width=${contourWidth}`);
              for (let x = leftEdge; x <= rightEdge; x += 2) {
                widestContour.push(x - width / 2);
              }
            }
          }
        } catch (error) {
          // Skip
        }
      }
    }
  

  
  // If we still don't have a good contour, create a fallback based on a reasonable base width
  if (widestContour.length === 0) {
    console.warn('[SeaStacks] No contour found, using fallback width');
    const fallbackWidth = width * 0.15; // Use only 15% of the total width as fallback (much smaller!)
    for (let x = -fallbackWidth / 2; x <= fallbackWidth / 2; x += 6) { // Smaller increments for better coverage
      widestContour.push(x);
    }
    // console.log(`[SeaStacks] Using fallback width: ${fallbackWidth} (${widestContour.length} points)`);
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
    // Find leftmost and rightmost points to ensure we cover the full detected width
    const leftMost = Math.min(...contourPoints);
    const rightMost = Math.max(...contourPoints);
    
    // Create a simple rectangular clipping area that covers the full detected width
    // This ensures we don't miss any parts of the sea stack base
    const waveOffset1 = baseWaveOffset + Math.sin(time * WATER_LINE_CONFIG.WAVE_FREQUENCY * 2) * 1;
    const waveOffset2 = baseWaveOffset + Math.sin(time * WATER_LINE_CONFIG.WAVE_FREQUENCY * 2 + 1) * 1;
    
    // Create a clipping path that's constrained to the sea stack bounds
    const stackBounds = {
      left: -width / 2,
      right: width / 2,
      top: -height,
      bottom: 0
    };
    
    // Constrain the clipping area to not extend beyond the sea stack image bounds
    const constrainedLeft = Math.max(leftMost, stackBounds.left);
    const constrainedRight = Math.min(rightMost, stackBounds.right);
    
    // Create a rectangular clipping path that's bounded by the sea stack image
    ctx.moveTo(constrainedLeft, waterLineY + waveOffset1);
    ctx.lineTo(constrainedRight, waterLineY + waveOffset2);
    ctx.lineTo(constrainedRight, Math.min(waterLineY + 100, stackBounds.bottom)); // Don't extend beyond image bottom
    ctx.lineTo(constrainedLeft, Math.min(waterLineY + 100, stackBounds.bottom)); // Don't extend beyond image bottom
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
    ctx.fillRect(constrainedLeft, waterLineY, constrainedRight - constrainedLeft, Math.min(100, stackBounds.bottom - waterLineY));
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
  currentTimeMs?: number,
  renderHalfMode?: 'top' | 'bottom' | 'full'
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
  
    // Draw the sea stack centered (simple and clean) with optional half-rendering
  const halfMode = renderHalfMode || 'full';
  
  if (halfMode === 'bottom') {
    // Render only bottom 50% of sea stack (underwater portion)
    const halfHeight = height / 2;
    ctx.drawImage(
      image,
      0, image.naturalHeight / 2, image.naturalWidth, image.naturalHeight / 2, // Source: bottom half
      -width / 2, -halfHeight, width, halfHeight // Destination: bottom half
    );
  } else if (halfMode === 'top') {
    // Render only top 50% of sea stack (above water portion)
    const halfHeight = height / 2;
    ctx.drawImage(
      image,
      0, 0, image.naturalWidth, image.naturalHeight / 2, // Source: top half  
      -width / 2, -height, width, halfHeight // Destination: top half
    );
  } else {
    // Render full sea stack (default behavior)
    ctx.drawImage(
      image,
      -width / 2,
      -height,
      width,
      height
    );
  }
  
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
  currentTimeMs?: number, // Current time for animations
  renderHalfMode?: 'top' | 'bottom' | 'full' // NEW: Control which half to render
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
    renderSeaStack(ctx, clientStack, stackImage, cycleProgress, false, false, currentTimeMs || Date.now(), renderHalfMode);
  }
}

// Removed clearSeaStackCache function - no longer needed since sea stacks are server-authoritative 