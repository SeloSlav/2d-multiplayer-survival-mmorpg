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

  const maxDayAlpha = 0.6; // More visible daytime shadow (increased from 0.45)
  const minNightAlpha = 0.15; // Subtle night shadows (increased from 0.0)

  // Day: 0.0 (Dawn) to 0.75 (Dusk ends). Night: 0.75 to 1.0
  if (cycleProgress < 0.05) { // Dawn (0.0 - 0.05)
    const t = cycleProgress / 0.05;
    alphaMultiplier = lerp(minNightAlpha, maxDayAlpha, t);
    currentOffsetX = lerp(8, 12, t); // Behind and to the right (positive X)
    currentOffsetY = lerp(8, 6, t);  // Behind (positive Y)
    currentBlur = lerp(sunriseSunsetBlur, defaultDayBlur, t);
  } else if (cycleProgress < 0.40) { // Morning to Pre-Noon (0.05 - 0.40)
    const t = (cycleProgress - 0.05) / (0.40 - 0.05);
    alphaMultiplier = maxDayAlpha;
    currentOffsetX = lerp(12, 6, t);  // Moving from far right to closer right
    currentOffsetY = lerp(6, 3, t);   // Moving from far behind to closer behind
    currentBlur = defaultDayBlur;
  } else if (cycleProgress < 0.50) { // Noon-ish (0.40 - 0.50)
    // Shadow slightly behind and to the right, shortest
    alphaMultiplier = maxDayAlpha;
    currentOffsetX = 6; // Slightly to the right
    currentOffsetY = 3; // Slightly behind
    currentBlur = noonBlur;
  } else if (cycleProgress < 0.70) { // Afternoon (0.50 - 0.70)
    const t = (cycleProgress - 0.50) / (0.70 - 0.50);
    alphaMultiplier = maxDayAlpha;
    currentOffsetX = lerp(6, 12, t);   // Moving from closer right to far right
    currentOffsetY = lerp(3, 6, t);    // Moving from closer behind to far behind
    currentBlur = defaultDayBlur;
  } else if (cycleProgress < 0.75) { // Dusk (0.70 - 0.75)
    const t = (cycleProgress - 0.70) / 0.05;
    alphaMultiplier = lerp(maxDayAlpha, minNightAlpha, t);
    currentOffsetX = lerp(12, 8, t);   // Moving back towards dawn position
    currentOffsetY = lerp(6, 8, t);    // Moving back towards dawn position
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
  entityImage: HTMLImageElement | HTMLCanvasElement; // Accept both image and canvas
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
  // NEW: Shelter clipping support
  shelters?: Array<{
    posX: number;
    posY: number;
    isDestroyed: boolean;
  }>;
  // NEW: Shake effect support for impact animations
  shakeOffsetX?: number;      // Horizontal shake offset when entity is hit
  shakeOffsetY?: number;      // Vertical shake offset when entity is hit
}

// Shelter collision constants (adjusted for visual clipping)
const SHELTER_COLLISION_WIDTH = 300.0; // Reduced from 300.0 to better match visual shelter
const SHELTER_COLLISION_HEIGHT = 125.0;
const SHELTER_AABB_CENTER_Y_OFFSET_FROM_POS_Y = 200.0;

/**
 * Creates a clipping path that excludes shelter interiors from shadow rendering.
 * This prevents shadows from being cast inside enclosed structures.
 */
function applyShelterClipping(ctx: CanvasRenderingContext2D, shelters?: Array<{posX: number, posY: number, isDestroyed: boolean}>) {
  if (!shelters || shelters.length === 0) {
    return; // No clipping needed
  }

  // Create a clipping path that excludes all shelter interiors
  ctx.beginPath();
  
  // Start with the entire canvas area
  ctx.rect(-50000, -50000, 100000, 100000);
  
  // Subtract each shelter's interior AABB
  for (const shelter of shelters) {
    if (shelter.isDestroyed) continue;
    
    // Calculate shelter AABB bounds (same logic as shelter.rs)
    const shelterAabbCenterX = shelter.posX;
    const shelterAabbCenterY = shelter.posY - SHELTER_AABB_CENTER_Y_OFFSET_FROM_POS_Y;
    const aabbLeft = shelterAabbCenterX - SHELTER_COLLISION_WIDTH / 2;
    const aabbTop = shelterAabbCenterY - SHELTER_COLLISION_HEIGHT / 2;
    
    // Create a hole in the clipping path for this shelter's interior
    // We use counterclockwise winding to create a hole
    ctx.rect(aabbLeft + SHELTER_COLLISION_WIDTH, aabbTop, -SHELTER_COLLISION_WIDTH, SHELTER_COLLISION_HEIGHT);
  }
  
  // Apply the clipping path
  ctx.clip();
}

// Cache for pre-rendered silhouettes
const silhouetteCache = new Map<string, HTMLCanvasElement>();

// Global shelter clipping data - set by GameCanvas and used by all shadow rendering
let globalShelterClippingData: Array<{posX: number, posY: number, isDestroyed: boolean}> = [];

/**
 * Sets the global shelter clipping data for shadow rendering.
 * This should be called from GameCanvas before rendering entities.
 */
export function setShelterClippingData(shelters: Array<{posX: number, posY: number, isDestroyed: boolean}>) {
  globalShelterClippingData = shelters;
}

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
  maxShadowAlpha = 0.5, // Increased for better visibility (was 0.35)
  maxStretchFactor = 2.2, // Increased for more dramatic shadows (was 1.8)
  minStretchFactor = 0.15, // Increased minimum (was 0.1)
  shadowBlur = 0,
  pivotYOffset = 0,
  shelters,
  shakeOffsetX,
  shakeOffsetY,
}: DynamicGroundShadowParams): void {
  let overallAlpha: number;
  let shadowLength: number; // How far the shadow extends
  let shadowShearX: number; // Horizontal shear for shadow direction
  let shadowScaleY: number; // Vertical scaling for shadow length

  // Calculate sun position throughout the day
  // 0.0 = midnight, 0.25 = dawn, 0.5 = noon, 0.75 = dusk, 1.0 = midnight
  
  // Day: 0.0 (Dawn) to 0.75 (Dusk ends). Night: 0.75 to 1.0
  if (cycleProgress < 0.05) { // Dawn (0.0 - 0.05)
    const t = cycleProgress / 0.05;
    overallAlpha = lerp(0, maxShadowAlpha, t); // Fade in
    shadowLength = lerp(maxStretchFactor * 0.8, maxStretchFactor * 0.6, t); // Long shadows
    // Dawn: Sun low in the east, shadows point west (positive X direction)
    shadowShearX = lerp(1.2, 0.8, t); // Strong rightward lean
    shadowScaleY = lerp(0.3, 0.4, t); // Flattened shadow
  } else if (cycleProgress < 0.40) { // Morning to Pre-Noon (0.05 - 0.40)
    const t = (cycleProgress - 0.05) / (0.40 - 0.05);
    overallAlpha = maxShadowAlpha;
    shadowLength = lerp(maxStretchFactor * 0.6, minStretchFactor * 2, t); // Shortening
    // Morning: Sun rising, shadows moving from right to center
    shadowShearX = lerp(0.8, 0.1, t); // Reducing rightward lean
    shadowScaleY = lerp(0.4, 0.7, t); // Less flattened
  } else if (cycleProgress < 0.50) { // Noon-ish (0.40 - 0.50)
    overallAlpha = maxShadowAlpha;
    shadowLength = minStretchFactor; // Shortest
    // Noon: Sun overhead, shadow directly below
    shadowShearX = 0; // No horizontal lean
    shadowScaleY = 0.8; // Mostly vertical, minimal shadow
  } else if (cycleProgress < 0.70) { // Afternoon (0.50 - 0.70)
    const t = (cycleProgress - 0.50) / (0.70 - 0.50);
    overallAlpha = maxShadowAlpha;
    shadowLength = lerp(minStretchFactor * 2, maxStretchFactor * 0.6, t); // Lengthening
    // Afternoon: Sun moving west, shadows pointing east (negative X direction)
    shadowShearX = lerp(-0.1, -0.8, t); // Increasing leftward lean
    shadowScaleY = lerp(0.7, 0.4, t); // More flattened
  } else if (cycleProgress < 0.75) { // Dusk (0.70 - 0.75)
    const t = (cycleProgress - 0.70) / 0.05;
    overallAlpha = lerp(maxShadowAlpha, 0, t); // Fade out completely
    shadowLength = lerp(maxStretchFactor * 0.6, maxStretchFactor * 0.8, t); // Long shadows
    // Dusk: Sun low in the west, shadows continue pointing east (negative X direction)
    shadowShearX = lerp(-0.8, -1.2, t); // Continue strong leftward lean
    shadowScaleY = lerp(0.4, 0.3, t); // Very flattened
  } else if (cycleProgress < 0.85) { // Early Night (0.75 - 0.85)
    // Shadows should be completely invisible during early night
    overallAlpha = 0;
    shadowLength = 0;
    shadowShearX = 0;
    shadowScaleY = 0.5;
  } else { // Late Night to Midnight (0.85 - 1.0)
    // Shadows start to appear again as we approach dawn
    const t = (cycleProgress - 0.85) / 0.15;
    overallAlpha = lerp(0, maxShadowAlpha * 0.3, t); // Very subtle pre-dawn shadows
    shadowLength = lerp(0, maxStretchFactor * 0.9, t); // Long pre-dawn shadows
    // Pre-dawn: Preparing for sun to rise in east, shadows will point west
    shadowShearX = lerp(0, 1.3, t); // Building up rightward lean for dawn
    shadowScaleY = lerp(0.5, 0.25, t); // Very flattened pre-dawn shadows
  }

  if (overallAlpha < 0.01 || shadowLength < 0.01) {
    // Debug: Log when shadows are skipped
    // console.log(`[Dynamic Shadow] Skipped shadow - Alpha: ${overallAlpha.toFixed(3)}, Length: ${shadowLength.toFixed(3)}, CycleProgress: ${cycleProgress.toFixed(3)}`);
    return; // No shadow if invisible or too small
  }
  
  // Debug: Log when shadows are rendered (enabled for debugging)
  // console.log(`[Dynamic Shadow] Rendering shadow - Alpha: ${overallAlpha.toFixed(3)}, Length: ${shadowLength.toFixed(3)}, ShearX: ${shadowShearX.toFixed(2)}, ScaleY: ${shadowScaleY.toFixed(2)}, CycleProgress: ${cycleProgress.toFixed(3)}`);

  // Generate a cache key for the silhouette
  const cacheKey = entityImage instanceof HTMLImageElement 
    ? `${entityImage.src}-${baseShadowColor}`
    : null; // Don't cache canvas elements (they're already processed sprite frames)
  let offscreenCanvas = cacheKey ? silhouetteCache.get(cacheKey) : null;

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

    // Store in cache only for HTMLImageElement (not for canvas)
    if (cacheKey) {
      silhouetteCache.set(cacheKey, newOffscreenCanvas);
    }
    offscreenCanvas = newOffscreenCanvas;
  }
  
  // Now, offscreenCanvas contains the perfect, sharp, tinted silhouette (either new or cached).

  // --- Render onto the main canvas --- 
  ctx.save();

  // Apply shelter clipping to prevent shadows inside shelter interiors
  // Use global shelter data if not provided directly
  const sheltersToUse = shelters || globalShelterClippingData;
  applyShelterClipping(ctx, sheltersToUse);

  // Move origin to the entity's base center (this is the anchor point)
  // Apply shake offsets if the entity is being hit for responsive feedback
  const effectiveEntityCenterX = entityCenterX + (shakeOffsetX || 0);
  const effectiveEntityBaseY = entityBaseY + (shakeOffsetY || 0);
  
  ctx.translate(effectiveEntityCenterX, effectiveEntityBaseY - pivotYOffset);

  // Apply shadow transformation matrix to create realistic shadow casting
  // The shadow is anchored at the entity's base and stretches/leans based on sun position
  ctx.transform(
    1.0,                    // Scale X (keep original width)
    0,                      // Shear Y (no vertical shear)
    shadowShearX,           // Shear X (horizontal lean based on sun position)
    shadowScaleY,           // Scale Y (vertical compression/stretch)
    0,                      // Translate X (no additional translation - anchored)
    0                       // Translate Y (no additional translation - anchored)
  );

  // Apply blur to the drawing of the offscreen (silhouette) canvas
  if (shadowBlur > 0) {
    ctx.filter = `blur(${shadowBlur}px)`;
  }

  // Apply overallAlpha for day/night intensity
  ctx.globalAlpha = overallAlpha;
  
  // Draw the offscreen (silhouette) canvas onto the main canvas
  // The shadow is drawn from the anchor point (entity base)
  ctx.drawImage(
    offscreenCanvas,     // Source is now the prepared offscreen canvas
    -imageDrawWidth / 2, // Centered horizontally on the anchor
    -imageDrawHeight,    // Position so the bottom of the shadow aligns with the anchor
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

/**
 * Helper function to calculate shake offsets for shadow synchronization.
 * This reduces code duplication across all object rendering utilities.
 * @param entity The entity that might be shaking
 * @param entityId The string ID of the entity
 * @param shakeTrackingMaps Object containing the tracking maps for this entity type
 * @param shakeDurationMs Duration of the shake effect in milliseconds
 * @param shakeIntensityPx Maximum shake intensity in pixels
 * @returns Object with shakeOffsetX and shakeOffsetY values
 */
export function calculateShakeOffsets(
  entity: { lastHitTime?: { microsSinceUnixEpoch: bigint } | null },
  entityId: string,
  shakeTrackingMaps: {
    clientStartTimes: Map<string, number>;
    lastKnownServerTimes: Map<string, number>;
  },
  shakeDurationMs: number = 300,
  shakeIntensityPx: number = 6
): { shakeOffsetX: number; shakeOffsetY: number } {
  let shakeOffsetX = 0;
  let shakeOffsetY = 0;

  if (entity.lastHitTime) {
    const serverShakeTime = Number(entity.lastHitTime.microsSinceUnixEpoch / 1000n);
    
    // Check if this is a NEW shake by comparing server timestamps
    const lastKnownServerTime = shakeTrackingMaps.lastKnownServerTimes.get(entityId) || 0;
    
    if (serverShakeTime !== lastKnownServerTime) {
      // NEW shake detected! Record both server time and client time
      shakeTrackingMaps.lastKnownServerTimes.set(entityId, serverShakeTime);
      shakeTrackingMaps.clientStartTimes.set(entityId, Date.now());
    }
    
    // Calculate animation based on client time
    const clientStartTime = shakeTrackingMaps.clientStartTimes.get(entityId);
    if (clientStartTime) {
      const elapsedSinceShake = Date.now() - clientStartTime;
      
      if (elapsedSinceShake >= 0 && elapsedSinceShake < shakeDurationMs) {
        const shakeFactor = 1.0 - (elapsedSinceShake / shakeDurationMs);
        const currentShakeIntensity = shakeIntensityPx * shakeFactor;
        shakeOffsetX = (Math.random() - 0.5) * 2 * currentShakeIntensity;
        shakeOffsetY = (Math.random() - 0.5) * 2 * currentShakeIntensity;
      }
    }
  } else {
    // Clean up tracking when entity is not being hit
    shakeTrackingMaps.clientStartTimes.delete(entityId);
    shakeTrackingMaps.lastKnownServerTimes.delete(entityId);
  }

  return { shakeOffsetX, shakeOffsetY };
} 