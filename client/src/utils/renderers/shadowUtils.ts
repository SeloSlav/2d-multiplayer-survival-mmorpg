/**
 * Draws a simple elliptical shadow on the canvas.
 * @param ctx The rendering context.
 * @param centerX The horizontal center of the shadow.
 * @param baseY The vertical position where the shadow sits on the ground.
 * @param radiusX The horizontal radius of the shadow ellipse.
 * @param radiusY The vertical radius of the shadow ellipse.
 */
export function drawShadow(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  baseY: number, 
  radiusX: number,
  radiusY: number
) {
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)'; // 35% opacity black
  ctx.beginPath();
  // Draw an ellipse centered horizontally at centerX, vertically at baseY
  ctx.ellipse(centerX, baseY, radiusX, radiusY, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
} 

// Helper for linear interpolation
function lerp(a: number, b: number, t: number): number {
  return a * (1 - t) + b * t;
}

/**
 * Options for configuring the standard drop shadow.
 */
export interface StandardDropShadowOptions {
  color?: string; // Base RGB color string, e.g., '0,0,0'
  blur?: number;
  offsetX?: number; // Default/base offsetX if not fully dynamic
  offsetY?: number; // Default/base offsetY if not fully dynamic
  cycleProgress?: number; // Value from 0.0 (dawn) to 1.0 (end of night)
}

/**
 * Applies a standard set of shadow properties directly to the canvas context.
 * This is meant to be used when the image itself will have the shadow,
 * rather than drawing a separate shadow shape.
 * Assumes ctx.save() and ctx.restore() are handled elsewhere.
 * @param ctx The rendering context.
 * @param options Optional overrides for default shadow properties.
 */
export function applyStandardDropShadow(
  ctx: CanvasRenderingContext2D,
  options: StandardDropShadowOptions = {}
): void {
  const cycleProgress = options.cycleProgress ?? 0.375; // Default to "noonish" if not provided
  let alphaMultiplier: number;
  let currentOffsetX: number;
  let currentOffsetY: number;
  let currentBlur: number;

  const baseRGB = options.color ?? '0,0,0';
  const noonBlur = (options.blur ?? 5) - 1 > 0 ? (options.blur ?? 5) -1 : 1; // Sharper at noon
  const sunriseSunsetBlur = (options.blur ?? 5) + 2; // Softer, more diffused for long shadows
  const defaultDayBlur = options.blur ?? 5;

  const maxDayAlpha = 0.45; // Slightly more pronounced daytime shadow
  const minNightAlpha = 0.0; // Shadow alpha at deep night (can be > 0 for subtle night shadows)

  // Day: 0.0 (Dawn) to 0.75 (Dusk ends). Night: 0.75 to 1.0
  if (cycleProgress < 0.05) { // Dawn (0.0 - 0.05)
    const t = cycleProgress / 0.05;
    alphaMultiplier = lerp(minNightAlpha, maxDayAlpha, t);
    currentOffsetX = lerp(12, 4, t); // Flipped from -12, -4
    currentOffsetY = lerp(4, 2, t);    // Starts a bit further, moves closer
    currentBlur = lerp(sunriseSunsetBlur, defaultDayBlur, t);
  } else if (cycleProgress < 0.40) { // Morning to Pre-Noon (0.05 - 0.40)
    const t = (cycleProgress - 0.05) / (0.40 - 0.05);
    alphaMultiplier = maxDayAlpha;
    currentOffsetX = lerp(8, 0, t);  // Flipped from -8, 0
    currentOffsetY = lerp(3, 1, t);   // Shortening significantly
    currentBlur = defaultDayBlur;
  } else if (cycleProgress < 0.50) { // Noon-ish (0.40 - 0.50)
    // Shadow directly underneath or very slightly offset, shortest and sharper
    alphaMultiplier = maxDayAlpha;
    currentOffsetX = 0; // Directly underneath or slightly offset - Remains 0
    currentOffsetY = 1;   // Shortest
    currentBlur = noonBlur;
  } else if (cycleProgress < 0.70) { // Afternoon (0.50 - 0.70)
    const t = (cycleProgress - 0.50) / (0.70 - 0.50);
    alphaMultiplier = maxDayAlpha;
    currentOffsetX = lerp(0, -8, t);   // Flipped from 0, 8
    currentOffsetY = lerp(1, 3, t);   // Lengthening
    currentBlur = defaultDayBlur;
  } else if (cycleProgress < 0.75) { // Dusk (0.70 - 0.75)
    const t = (cycleProgress - 0.70) / 0.05;
    alphaMultiplier = lerp(maxDayAlpha, minNightAlpha, t);
    currentOffsetX = lerp(-4, -12, t);   // Flipped from 4, 12
    currentOffsetY = lerp(2, 4, t);
    currentBlur = lerp(defaultDayBlur, sunriseSunsetBlur, t);
  } else { // Night (0.75 - 1.0)
    alphaMultiplier = minNightAlpha;
    currentOffsetX = 0; // Offset doesn't matter much if alpha is 0
    currentOffsetY = 0;
    currentBlur = defaultDayBlur; // Blur doesn't matter if alpha is 0
  }
  ctx.shadowColor = `rgba(${baseRGB},${alphaMultiplier.toFixed(2)})`;
  ctx.shadowBlur = Math.round(currentBlur);
  ctx.shadowOffsetX = Math.round(currentOffsetX);
  ctx.shadowOffsetY = Math.round(currentOffsetY);
} 

/**
 * Parameters for drawing a dynamic ground shadow.
 */
export interface DynamicGroundShadowParams {
  ctx: CanvasRenderingContext2D;
  entityImage: HTMLImageElement; // The actual image for silhouette
  entityCenterX: number;      // World X-coordinate of the entity's center
  entityBaseY: number;        // World Y-coordinate of the entity's ground base
  imageDrawWidth: number;    // The width the entity image is drawn on screen
  imageDrawHeight: number;   // The height the entity image is drawn on screen
  cycleProgress: number;      // Day/night cycle progress (0.0 to 1.0)
  baseShadowColor?: string;   // RGB string for shadow color, e.g., '0,0,0'
  maxShadowAlpha?: number;    // Base opacity of the shadow color itself (before day/night fading)
  maxStretchFactor?: number;  // How many times its height the shadow can stretch (e.g., 2.5 for 2.5x)
  minStretchFactor?: number;  // Shortest shadow length factor (e.g., 0.1 for 10% of height at noon)
  shadowBlur?: number;        // Blur radius for the shadow
  pivotYOffset?: number;      // Vertical offset for the shadow pivot point
}

// Cache for pre-rendered silhouettes
const silhouetteCache = new Map<string, HTMLCanvasElement>();

/**
 * Draws a dynamic shadow on the ground, simulating a cast shadow from an entity.
 * The shadow length, direction, and opacity change based on the time of day (cycleProgress).
 * Assumes ctx.save() and ctx.restore() are handled by the caller if multiple shadows are drawn.
 */
export function drawDynamicGroundShadow({
  ctx,
  entityImage,
  entityCenterX,
  entityBaseY,
  imageDrawWidth,
  imageDrawHeight,
  cycleProgress,
  baseShadowColor = '0,0,0',
  maxShadowAlpha = 0.35, // Default reduced from 0.45
  maxStretchFactor = 1.8, // Default reduced from 2.0
  minStretchFactor = 0.1, // Default reduced from 0.15
  shadowBlur = 0,
  pivotYOffset = 0,
}: DynamicGroundShadowParams): void {
  let overallAlpha: number;
  let currentStretch: number;
  let skewX: number;

  // Day: 0.0 (Dawn) to 0.75 (Dusk ends). Night: 0.75 to 1.0
  if (cycleProgress < 0.05) { // Dawn (0.0 - 0.05)
    const t = cycleProgress / 0.05;
    overallAlpha = lerp(0, maxShadowAlpha, t); // Fade in
    currentStretch = lerp(maxStretchFactor * 0.7, maxStretchFactor * 0.5, t); // Long, shortening
    skewX = lerp(-0.4, -0.2, t);
  } else if (cycleProgress < 0.40) { // Morning to Pre-Noon (0.05 - 0.40)
    const t = (cycleProgress - 0.05) / (0.40 - 0.05);
    overallAlpha = maxShadowAlpha;
    currentStretch = lerp(maxStretchFactor * 0.5, minStretchFactor, t); // Shortening
    skewX = lerp(-0.2, 0, t);
  } else if (cycleProgress < 0.50) { // Noon-ish (0.40 - 0.50)
    overallAlpha = maxShadowAlpha;
    currentStretch = minStretchFactor; // Shortest
    skewX = 0;
  } else if (cycleProgress < 0.70) { // Afternoon (0.50 - 0.70)
    const t = (cycleProgress - 0.50) / (0.70 - 0.50);
    overallAlpha = maxShadowAlpha;
    currentStretch = lerp(minStretchFactor, maxStretchFactor * 0.5, t); // Lengthening
    skewX = lerp(0, 0.2, t);
  } else if (cycleProgress < 0.75) { // Dusk (0.70 - 0.75)
    const t = (cycleProgress - 0.70) / 0.05;
    overallAlpha = lerp(maxShadowAlpha, 0, t); // Fade out
    currentStretch = lerp(maxStretchFactor * 0.5, maxStretchFactor * 0.7, t); // Lengthening
    skewX = lerp(0.2, 0.4, t);
  } else { // Night (0.75 - 1.0)
    overallAlpha = 0;
    currentStretch = maxStretchFactor * 0.7; // Doesn't matter if alpha is 0
    skewX = 0.4;
  }

  if (overallAlpha < 0.01 || currentStretch < 0.01) {
    return; // No shadow if invisible or too small
  }

  // Generate a cache key for the silhouette
  const cacheKey = `${entityImage.src}-${baseShadowColor}`;
  let offscreenCanvas = silhouetteCache.get(cacheKey);

  if (!offscreenCanvas) {
    // Create an offscreen canvas to prepare the sharp silhouette if not cached
    const newOffscreenCanvas = document.createElement('canvas');
    newOffscreenCanvas.width = imageDrawWidth;
    newOffscreenCanvas.height = imageDrawHeight;
    const offscreenCtx = newOffscreenCanvas.getContext('2d');

    if (!offscreenCtx) {
      console.error("Failed to get 2D context from offscreen canvas for shadow rendering.");
      return;
    }

    // 1. Draw the original image onto the offscreen canvas
    offscreenCtx.drawImage(entityImage, 0, 0, imageDrawWidth, imageDrawHeight);

    // 2. Create a sharp, tinted silhouette on the offscreen canvas using source-in
    offscreenCtx.globalCompositeOperation = 'source-in';
    offscreenCtx.fillStyle = `rgba(${baseShadowColor}, 1.0)`; // Tint with full opacity base color
    offscreenCtx.fillRect(0, 0, imageDrawWidth, imageDrawHeight);

    // Store in cache
    silhouetteCache.set(cacheKey, newOffscreenCanvas);
    offscreenCanvas = newOffscreenCanvas;
  }
  
  // Now, offscreenCanvas contains the perfect, sharp, tinted silhouette (either new or cached).

  // --- Render onto the main canvas --- 
  ctx.save();

  // Move origin to the entity's base center for easier shadow manipulation
  ctx.translate(entityCenterX, entityBaseY - pivotYOffset);

  // Apply vertical flip for reflection effect
  ctx.scale(-1, -1);

  // Apply transformations for skew and stretch
  ctx.transform(1, skewX, 0, currentStretch, 0, 0);

  // Apply blur to the drawing of the offscreen (silhouette) canvas
  if (shadowBlur > 0) {
    ctx.filter = `blur(${shadowBlur}px)`;
  }

  // Apply overallAlpha for day/night intensity
  ctx.globalAlpha = overallAlpha;
  
  // Draw the offscreen (silhouette) canvas onto the main canvas
  ctx.drawImage(
    offscreenCanvas,     // Source is now the prepared offscreen canvas
    -imageDrawWidth / 2, // Centered horizontally
    -imageDrawHeight,    // Adjusted Y for vertical flip to root base
    imageDrawWidth,
    imageDrawHeight
  );

  // Reset filter and alpha
  if (shadowBlur > 0) {
    ctx.filter = 'none';
  }
  ctx.globalAlpha = 1.0;
  ctx.globalCompositeOperation = 'source-over'; // Ensure composite mode is reset

  ctx.restore();
} 

// TEMPORARY DEBUG VERSION of drawDynamicGroundShadow
// export function drawDynamicGroundShadow({
//   ctx,
//   entityImage, // Unused in this debug version
//   entityCenterX,
//   entityBaseY,
//   imageDrawWidth, // Used for debug rect width
//   imageDrawHeight, // Unused
//   cycleProgress,
//   baseShadowColor = '0,0,0', // Unused
//   maxShadowAlpha = 0.35,
//   maxStretchFactor = 1.8, // Unused
//   minStretchFactor = 0.1, // Unused
// }: DynamicGroundShadowParams): void {

//   let overallAlpha: number;
//   // Simplified alpha calculation for debug
//   if (cycleProgress >= 0.75 || cycleProgress < 0.05) { // Night/Deep Dawn/Dusk
//     overallAlpha = 0;
//   } else {
//     overallAlpha = maxShadowAlpha * 0.5; // Fixed moderate alpha for debugging day
//   }

//   if (overallAlpha < 0.01) {
//     return;
//   }

//   ctx.save(); // Still use save/restore for isolation

//   const debugShadowWidth = imageDrawWidth * 0.8; 
//   const debugShadowHeight = 20; 

//   ctx.fillStyle = `rgba(50,50,50,${overallAlpha.toFixed(2)})`; 

//   ctx.fillRect(
//     entityCenterX - debugShadowWidth / 2,
//     entityBaseY - debugShadowHeight / 2, 
//     debugShadowWidth,
//     debugShadowHeight
//   );
  
//   ctx.globalAlpha = 1.0; 
//   ctx.restore();
// } 