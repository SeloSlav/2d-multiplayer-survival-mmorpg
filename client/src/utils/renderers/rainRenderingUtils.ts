/**
 * Rain Rendering Utilities
 * 
 * Renders pixel art rain particles that fall diagonally across the screen.
 * Rain intensity and type are controlled by the server's weather system.
 */

interface RainDrop {
  x: number;
  y: number;
  speed: number;
  length: number;
  opacity: number;
  thickness: number;
}

interface RainSplash {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  opacity: number;
  startTime: number;
  duration: number;
}

interface ThunderFlash {
  startTime: number;
  duration: number;
  intensity: number;
  opacity: number;
}

interface RainSystemState {
  drops: RainDrop[];
  splashes: RainSplash[];
  lastUpdate: number;
  windOffset: number;
  gustPhase: number;
  lastSpawnTime: number;
  thunderFlash: ThunderFlash | null;
}

// Rain configuration constants
const RAIN_CONFIG = {
  // Drop counts for different intensities - INCREASED for better coverage
  LIGHT_RAIN_DROPS: 600,    // Increased further
  MODERATE_RAIN_DROPS: 1200, // Increased further
  HEAVY_RAIN_DROPS: 2000,   // Increased further
  HEAVY_STORM_DROPS: 3000,  // Maximum drops for heavy storm
  
  // Continuous spawning rates (drops per second)
  LIGHT_RAIN_SPAWN_RATE: 100,   // drops per second
  MODERATE_RAIN_SPAWN_RATE: 200, // drops per second  
  HEAVY_RAIN_SPAWN_RATE: 350,   // drops per second
  HEAVY_STORM_SPAWN_RATE: 500,  // drops per second
  
  // Drop properties
  MIN_SPEED: 200, // pixels per second
  MAX_SPEED: 400,
  MIN_LENGTH: 8,
  MAX_LENGTH: 20,
  MIN_OPACITY: 0.3,
  MAX_OPACITY: 0.8,
  
  // Rain angle and wind
  BASE_ANGLE: 15, // degrees from vertical
  WIND_VARIATION: 10, // degrees of wind sway
  GUST_FREQUENCY: 0.5, // how often wind gusts occur
  
  // Visual properties
  RAIN_COLOR: '#87CEEB', // Light blue color
  RAIN_SHADOW_COLOR: '#4682B4', // Darker blue for depth
  
  // Screen margins (spawn rain outside visible area) - MASSIVELY INCREASED
  SPAWN_MARGIN: 800, // Increased from 500 - even larger coverage area
  
  // Splash effects
  SPLASH_PROBABILITY: 0.3, // Increased from 0.2 - more frequent splashes
  SPLASH_MIN_RADIUS: 4,     // Increased from 2 - larger splashes
  SPLASH_MAX_RADIUS: 12,    // Increased from 6 - much larger splashes
  SPLASH_DURATION: 600,     // Increased from 400 - longer to see them
  SPLASH_COLOR: '#87CEEB',  // Same as rain color for consistency
};

let rainSystem: RainSystemState = {
  drops: [],
  splashes: [],
  lastUpdate: 0,
  windOffset: 0,
  gustPhase: 0,
  lastSpawnTime: 0,
  thunderFlash: null,
};

/**
 * Creates a splash effect when a raindrop hits the ground
 */
function createSplash(x: number, y: number): RainSplash {
  const maxRadius = RAIN_CONFIG.SPLASH_MIN_RADIUS + 
    Math.random() * (RAIN_CONFIG.SPLASH_MAX_RADIUS - RAIN_CONFIG.SPLASH_MIN_RADIUS);
  
  const splash = {
    x,
    y,
    radius: 0,
    maxRadius,
    opacity: 0.8 + Math.random() * 0.2, // 0.8 to 1.0 - higher base opacity
    startTime: performance.now(),
    duration: RAIN_CONFIG.SPLASH_DURATION * (0.8 + Math.random() * 0.4), // Vary duration slightly
  };
  
  // Debug logging removed for production
  
  return splash;
}

/**
 * Creates a new raindrop with random properties in world space
 */
function createRainDrop(
  cameraX: number, 
  cameraY: number, 
  canvasWidth: number, 
  canvasHeight: number, 
  intensity: number
): RainDrop {
  // Calculate world space bounds for spawning (larger area around camera)
  const worldSpawnWidth = canvasWidth + RAIN_CONFIG.SPAWN_MARGIN * 8; // Increased from 4 to 8
  const worldSpawnHeight = canvasHeight + RAIN_CONFIG.SPAWN_MARGIN * 8; // Increased from 4 to 8
  
  // Spawn drops in world space around the camera
  const spawnX = cameraX - worldSpawnWidth / 2 + Math.random() * worldSpawnWidth;
  const spawnY = cameraY - worldSpawnHeight / 2 - Math.random() * RAIN_CONFIG.SPAWN_MARGIN;
  
  // Speed varies with intensity
  const speedMultiplier = 0.5 + intensity * 0.5; // 0.5x to 1.0x based on intensity
  const speed = (RAIN_CONFIG.MIN_SPEED + Math.random() * (RAIN_CONFIG.MAX_SPEED - RAIN_CONFIG.MIN_SPEED)) * speedMultiplier;
  
  // Length varies with intensity and speed
  const lengthMultiplier = 0.7 + intensity * 0.3;
  const length = (RAIN_CONFIG.MIN_LENGTH + Math.random() * (RAIN_CONFIG.MAX_LENGTH - RAIN_CONFIG.MIN_LENGTH)) * lengthMultiplier;
  
  // Opacity varies with intensity
  const opacity = RAIN_CONFIG.MIN_OPACITY + (RAIN_CONFIG.MAX_OPACITY - RAIN_CONFIG.MIN_OPACITY) * intensity * (0.8 + Math.random() * 0.4);
  
  // Thickness for heavy rain
  const thickness = intensity > 0.7 ? (Math.random() > 0.7 ? 2 : 1) : 1;
  
  return {
    x: spawnX,
    y: spawnY,
    speed,
    length,
    opacity,
    thickness,
  };
}

/**
 * Updates rain drop positions and removes drops that have fallen off screen
 */
function updateRainDrops(
  deltaTime: number, 
  cameraX: number,
  cameraY: number,
  canvasWidth: number, 
  canvasHeight: number, 
  intensity: number
): void {
  const currentTime = performance.now();
  
  // Update wind effects
  rainSystem.gustPhase += deltaTime * RAIN_CONFIG.GUST_FREQUENCY;
  const windGust = Math.sin(rainSystem.gustPhase) * RAIN_CONFIG.WIND_VARIATION;
  rainSystem.windOffset = windGust;
  
  // Calculate fall angle with wind
  const fallAngle = (RAIN_CONFIG.BASE_ANGLE + rainSystem.windOffset) * (Math.PI / 180);
  const horizontalSpeed = Math.sin(fallAngle);
  const verticalSpeed = Math.cos(fallAngle);
  
  // Calculate world space bounds for culling (larger area around camera)
  const cullMargin = RAIN_CONFIG.SPAWN_MARGIN * 2; // Reduced for better performance
  const leftBound = cameraX - canvasWidth / 2 - cullMargin;
  const rightBound = cameraX + canvasWidth / 2 + cullMargin;
  const topBound = cameraY - canvasHeight / 2 - cullMargin;
  const bottomBound = cameraY + canvasHeight / 2 + cullMargin;
  
  // Update existing drops
  for (let i = rainSystem.drops.length - 1; i >= 0; i--) {
    const drop = rainSystem.drops[i];
    
    // Move drop in world space
    drop.x += drop.speed * horizontalSpeed * deltaTime;
    drop.y += drop.speed * verticalSpeed * deltaTime;
    
    // Remove drops that have moved too far from camera (world space culling)
    if (drop.x > rightBound || 
        drop.x < leftBound ||
        drop.y < topBound ||
        drop.y > bottomBound) {
      rainSystem.drops.splice(i, 1);
    }
  }
  
  // Create random splashes across the entire visible area
  if (intensity > 0) {
    const splashRate = intensity * 30; // Further increased - more splashes per second
    const splashesToCreate = Math.max(1, Math.floor(splashRate * deltaTime)); // Ensure at least 1 splash attempt
    
    for (let i = 0; i < splashesToCreate; i++) {
      // Always create splash (remove probability check for testing)
      // Create splash at random position within visible area
      const splashX = cameraX - canvasWidth / 2 + Math.random() * canvasWidth;
      const splashY = cameraY - canvasHeight / 2 + Math.random() * canvasHeight;
      rainSystem.splashes.push(createSplash(splashX, splashY));
      
      // Debug logging removed for production
    }
  }
  
  // Update splash effects
  for (let i = rainSystem.splashes.length - 1; i >= 0; i--) {
    const splash = rainSystem.splashes[i];
    const elapsed = currentTime - splash.startTime;
    const progress = elapsed / splash.duration;
    
    if (progress >= 1.0) {
      rainSystem.splashes.splice(i, 1);
    } else {
      // Animate splash: radius grows, opacity fades
      splash.radius = Math.max(0, splash.maxRadius * progress); // Ensure radius is never negative
      splash.opacity = Math.max(0, (0.8 + Math.random() * 0.2) * (1.0 - progress)); // Ensure opacity is never negative
    }
  }
  
  // Determine target drop count based on intensity
  let targetDropCount = 0;
  if (intensity > 0) {
    if (intensity <= 0.4) {
      targetDropCount = Math.floor(RAIN_CONFIG.LIGHT_RAIN_DROPS * intensity / 0.4);
    } else if (intensity <= 0.7) {
      targetDropCount = RAIN_CONFIG.LIGHT_RAIN_DROPS + 
        Math.floor(RAIN_CONFIG.MODERATE_RAIN_DROPS * (intensity - 0.4) / 0.3);
    } else if (intensity < 1.0) {
      targetDropCount = RAIN_CONFIG.LIGHT_RAIN_DROPS + RAIN_CONFIG.MODERATE_RAIN_DROPS +
        Math.floor(RAIN_CONFIG.HEAVY_RAIN_DROPS * (intensity - 0.7) / 0.3);
    } else {
      // Heavy Storm (intensity = 1.0)
      targetDropCount = RAIN_CONFIG.LIGHT_RAIN_DROPS + RAIN_CONFIG.MODERATE_RAIN_DROPS + 
        RAIN_CONFIG.HEAVY_RAIN_DROPS + RAIN_CONFIG.HEAVY_STORM_DROPS;
    }
  }
  
  // INSTANT FILL: If we have significantly fewer drops than needed, instantly spawn them
  const currentDropCount = rainSystem.drops.length;
  if (currentDropCount < targetDropCount * 0.7) { // If we're below 70% of target
    const dropsNeeded = targetDropCount - currentDropCount;
    // Debug logging removed for production
    
    for (let i = 0; i < dropsNeeded; i++) {
      // Spawn drops across the entire coverage area instantly
      const newDrop = createRainDrop(cameraX, cameraY, canvasWidth, canvasHeight, intensity);
      
      // Randomize Y position across the entire fall area for instant coverage
      const spawnAreaHeight = canvasHeight + RAIN_CONFIG.SPAWN_MARGIN * 4;
      newDrop.y = cameraY - canvasHeight / 2 - RAIN_CONFIG.SPAWN_MARGIN + Math.random() * spawnAreaHeight;
      
      rainSystem.drops.push(newDrop);
    }
  }
  
  // Continuous spawning for new drops at the top
  const spawnRate = intensity * 50; // Simplified spawn rate
  const dropsToSpawn = Math.floor(spawnRate * deltaTime);
  
  for (let i = 0; i < dropsToSpawn && rainSystem.drops.length < targetDropCount * 1.2; i++) {
    const newDrop = createRainDrop(cameraX, cameraY, canvasWidth, canvasHeight, intensity);
    // Force spawn at top of area
    newDrop.y = cameraY - canvasHeight / 2 - RAIN_CONFIG.SPAWN_MARGIN;
    rainSystem.drops.push(newDrop);
  }
  
  // Remove excess drops if intensity decreased
  while (rainSystem.drops.length > targetDropCount * 1.3) {
    rainSystem.drops.pop();
  }
}

/**
 * Renders splash effects on the canvas
 */
function renderSplashes(
  ctx: CanvasRenderingContext2D,
  cameraX: number,
  cameraY: number,
  canvasWidth: number,
  canvasHeight: number
): void {
  if (rainSystem.splashes.length === 0) return;
  
  // Debug logging removed for production
  
  ctx.save();
  
  // Calculate screen center
  const screenCenterX = canvasWidth / 2;
  const screenCenterY = canvasHeight / 2;
  
  let renderedCount = 0;
  
  rainSystem.splashes.forEach(splash => {
    // Convert world coordinates to screen coordinates
    const screenX = screenCenterX + (splash.x - cameraX);
    const screenY = screenCenterY + (splash.y - cameraY);
    
    // Only render splashes that are visible on screen
    const margin = 50;
    if (screenX < -margin || screenX > canvasWidth + margin || 
        screenY < -margin || screenY > canvasHeight + margin) {
      return; // Skip this splash
    }
    
    renderedCount++;
    
    ctx.globalAlpha = splash.opacity * 0.7; // More visible - 70% of calculated opacity
    
    // Draw main splash circle
    ctx.fillStyle = RAIN_CONFIG.SPLASH_COLOR;
    ctx.beginPath();
    ctx.arc(screenX, screenY, splash.radius * 0.4, 0, Math.PI * 2);
    ctx.fill();
    
    // Draw outer ring for better visibility
    ctx.strokeStyle = RAIN_CONFIG.SPLASH_COLOR;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(screenX, screenY, splash.radius, 0, Math.PI * 2);
    ctx.stroke();
  });
  
  ctx.restore();
}

/**
 * Renders rain drops on the canvas
 */
function renderRainDrops(
  ctx: CanvasRenderingContext2D, 
  cameraX: number,
  cameraY: number,
  canvasWidth: number,
  canvasHeight: number,
  intensity: number
): void {
  if (rainSystem.drops.length === 0) return;
  
  ctx.save();
  
  // Set line cap for better looking drops
  ctx.lineCap = 'round';
  
  // Calculate fall angle for rendering
  const fallAngle = (RAIN_CONFIG.BASE_ANGLE + rainSystem.windOffset) * (Math.PI / 180);
  const dx = Math.sin(fallAngle);
  const dy = Math.cos(fallAngle);
  
  // Calculate screen center
  const screenCenterX = canvasWidth / 2;
  const screenCenterY = canvasHeight / 2;
  
  // Render drops with slight depth effect
  rainSystem.drops.forEach((drop, index) => {
    // Convert world coordinates to screen coordinates
    const screenX = screenCenterX + (drop.x - cameraX);
    const screenY = screenCenterY + (drop.y - cameraY);
    
    // Only render drops that are visible on screen (with small margin)
    const margin = 50;
    if (screenX < -margin || screenX > canvasWidth + margin || 
        screenY < -margin || screenY > canvasHeight + margin) {
      return; // Skip this drop
    }
    
    // Alternate between main color and shadow color for depth
    const isBackground = index % 3 === 0;
    ctx.strokeStyle = isBackground ? RAIN_CONFIG.RAIN_SHADOW_COLOR : RAIN_CONFIG.RAIN_COLOR;
    ctx.globalAlpha = drop.opacity * (isBackground ? 0.6 : 1.0);
    ctx.lineWidth = drop.thickness;
    
    // Draw the raindrop as a line in screen space
    ctx.beginPath();
    ctx.moveTo(screenX, screenY);
    ctx.lineTo(
      screenX + dx * drop.length,
      screenY + dy * drop.length
    );
    ctx.stroke();
  });
  
  ctx.restore();
}

/**
 * Triggers a thunder flash effect (INTERNAL USE ONLY - not exported for safety)
 */
function triggerThunderFlash(intensity: number = 0.8): void {
  const duration = 150 + Math.random() * 100; // 150-250ms flash duration
  rainSystem.thunderFlash = {
    startTime: performance.now(),
    duration,
    intensity: Math.max(0.5, Math.min(1.0, intensity)),
    opacity: 1.0,
  };
  console.log(`⚡ Thunder flash triggered with intensity ${intensity.toFixed(2)}`);
}

/**
 * Updates and renders thunder flash overlay
 */
function renderThunderFlash(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number
): void {
  if (!rainSystem.thunderFlash) return;
  
  const flash = rainSystem.thunderFlash;
  const currentTime = performance.now();
  const elapsed = currentTime - flash.startTime;
  
  if (elapsed >= flash.duration) {
    rainSystem.thunderFlash = null;
    return;
  }
  
  // Flash animation: quick bright flash, then fade
  const progress = elapsed / flash.duration;
  let flashOpacity: number;
  
  if (progress < 0.1) {
    // Quick bright flash (first 10% of duration)
    flashOpacity = flash.intensity * (progress / 0.1);
  } else if (progress < 0.3) {
    // Hold at peak (10-30% of duration)
    flashOpacity = flash.intensity;
  } else {
    // Fade out (30-100% of duration)
    flashOpacity = flash.intensity * (1.0 - (progress - 0.3) / 0.7);
  }
  
  // Render white flash overlay
  ctx.save();
  ctx.globalAlpha = flashOpacity * 0.6; // Max 60% opacity to not completely blind
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  ctx.restore();
}

/**
 * Main rain rendering function to be called from the game loop
 */
export function renderRain(
  ctx: CanvasRenderingContext2D,
  cameraX: number,
  cameraY: number,
  canvasWidth: number,
  canvasHeight: number,
  rainIntensity: number, // 0.0 to 1.0 from server
  deltaTime: number // in seconds
): void {
  // Update rain system
  updateRainDrops(deltaTime, cameraX, cameraY, canvasWidth, canvasHeight, rainIntensity);
  
  // Render rain if there's any intensity
  if (rainIntensity > 0) {
    renderRainDrops(ctx, cameraX, cameraY, canvasWidth, canvasHeight, rainIntensity);
    renderSplashes(ctx, cameraX, cameraY, canvasWidth, canvasHeight);
  }
  
  // Always render thunder flash if active (even if rain intensity is 0)
  renderThunderFlash(ctx, canvasWidth, canvasHeight);
}

/**
 * Clears all rain drops and splashes (useful for immediate weather changes)
 */
export function clearRain(): void {
  rainSystem.drops = [];
  rainSystem.splashes = [];
}

/**
 * Gets current rain drop count (for debugging)
 */
export function getRainDropCount(): number {
  return rainSystem.drops.length;
}

/**
 * Gets current splash count (for debugging)
 */
export function getSplashCount(): number {
  return rainSystem.splashes.length;
}

/**
 * Safe function to handle server thunder events only (exported for legitimate use)
 * This validates the input and prevents abuse
 */
export function handleServerThunderEvent(serverThunderEvent: { intensity: number; timestamp: any }): void {
  // Validate that this looks like a legitimate server thunder event
  if (!serverThunderEvent || typeof serverThunderEvent.intensity !== 'number') {
    console.warn('[Thunder] Invalid thunder event received from server');
    return;
  }
  
  // Clamp intensity to safe range
  const safeIntensity = Math.max(0.3, Math.min(0.8, serverThunderEvent.intensity));
  
  // Call the internal thunder function
  triggerThunderFlash(safeIntensity);
} 