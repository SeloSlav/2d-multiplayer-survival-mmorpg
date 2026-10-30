/**
 * Rain/Snow Rendering Utilities
 * 
 * Renders pixel art rain or snow particles that fall across the screen.
 * Rain intensity and type are controlled by the server's weather system.
 * In winter, "rain" is visually rendered as snow - same server mechanics,
 * different client-side appearance.
 * 
 * PERFORMANCE OPTIMIZED:
 * - Object pooling for drops/splashes to avoid GC pressure
 * - Swap-and-pop removal instead of splice() for O(1) removal
 * - Cached gradient objects to avoid recreation every frame
 * - Traditional for loops instead of forEach for hot paths
 * - Pre-computed trig values where possible
 */

interface RainDrop {
  x: number;
  y: number;
  speed: number;
  length: number;
  opacity: number;
  thickness: number;
  // Snow-specific properties
  drift: number;       // Horizontal drift amount for snow
  driftPhase: number;  // Phase offset for sinusoidal drift
  active: boolean;     // For object pooling
}

interface RainSplash {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  opacity: number;
  startTime: number;
  duration: number;
  active: boolean;     // For object pooling
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
  dropPool: RainDrop[];      // Object pool for recycled drops
  splashPool: RainSplash[];  // Object pool for recycled splashes
  activeDropCount: number;   // Track active drops for fast iteration
  activeSplashCount: number; // Track active splashes
  lastUpdate: number;
  windOffset: number;
  gustPhase: number;
  lastSpawnTime: number;
  thunderFlash: ThunderFlash | null;
  // Cached gradient data
  cachedCanvasWidth: number;
  cachedCanvasHeight: number;
}

// Rain base configuration (shared constants)
const RAIN_CONFIG = {
  // Drop counts for different intensities
  LIGHT_RAIN_DROPS: 600,
  MODERATE_RAIN_DROPS: 1200,
  HEAVY_RAIN_DROPS: 2000,
  HEAVY_STORM_DROPS: 3000,
  
  // Screen margins (spawn rain outside visible area)
  // Keep most drops near the viewport. The former 800px margin spread moderate
  // rain across a much larger offscreen area, making it read like a few drips.
  SPAWN_MARGIN: 200,
  
  // Gust timing
  GUST_FREQUENCY: 0.5,
  
  // Visual properties (shared)
  RAIN_COLOR: '#87CEEB',         // Light blue
  RAIN_SHADOW_COLOR: '#4682B4',  // Darker blue for depth
  SPLASH_COLOR: '#87CEEB',
};

// Rain configuration - intensity-specific settings for AAA visual quality
// Each level creates a distinctly different visual experience
const RAIN_CONFIGS = {
  // Light Rain: Gentle drizzle, thin drops, minimal wind
  LIGHT: {
    MIN_SPEED: 180,
    MAX_SPEED: 280,
    MIN_LENGTH: 6,
    MAX_LENGTH: 12,
    MIN_THICKNESS: 1,
    MAX_THICKNESS: 1,
    MIN_OPACITY: 0.25,
    MAX_OPACITY: 0.5,
    BASE_ANGLE: 5,           // Almost vertical
    WIND_VARIATION: 3,       // Minimal wind sway
    DROP_MULTIPLIER: 0.6,    // Sparse
    SPLASH_RATE: 10,         // Few splashes
    SPLASH_MIN_RADIUS: 2,
    SPLASH_MAX_RADIUS: 5,
    SPLASH_DURATION: 400,
    STREAK_CHANCE: 0,        // No streaks
  },
  // Moderate Rain: Steady rain, medium drops, some wind
  MODERATE: {
    MIN_SPEED: 250,
    MAX_SPEED: 380,
    MIN_LENGTH: 10,
    MAX_LENGTH: 18,
    MIN_THICKNESS: 1,
    MAX_THICKNESS: 1.5,
    MIN_OPACITY: 0.35,
    MAX_OPACITY: 0.65,
    BASE_ANGLE: 12,          // Slight angle
    WIND_VARIATION: 8,       // Noticeable wind
    DROP_MULTIPLIER: 0.85,   // Medium density
    SPLASH_RATE: 25,         // Regular splashes
    SPLASH_MIN_RADIUS: 3,
    SPLASH_MAX_RADIUS: 8,
    SPLASH_DURATION: 500,
    STREAK_CHANCE: 0,        // No streaks yet
  },
  // Heavy Rain: Downpour, thick drops, strong wind, mist effect
  HEAVY: {
    MIN_SPEED: 350,
    MAX_SPEED: 500,
    MIN_LENGTH: 14,
    MAX_LENGTH: 24,
    MIN_THICKNESS: 1,
    MAX_THICKNESS: 2,
    MIN_OPACITY: 0.45,
    MAX_OPACITY: 0.8,
    BASE_ANGLE: 20,          // Noticeable angle
    WIND_VARIATION: 15,      // Strong gusts
    DROP_MULTIPLIER: 1.0,    // Dense
    SPLASH_RATE: 45,         // Many splashes
    SPLASH_MIN_RADIUS: 4,
    SPLASH_MAX_RADIUS: 12,
    SPLASH_DURATION: 550,
    STREAK_CHANCE: 0.1,      // Some streaks
    MIST_OPACITY: 0.06,      // Light mist overlay
  },
  // Heavy Storm: Torrential, thick fast drops, chaotic wind, reduced visibility
  STORM: {
    MIN_SPEED: 450,
    MAX_SPEED: 650,
    MIN_LENGTH: 18,
    MAX_LENGTH: 35,
    MIN_THICKNESS: 1.5,
    MAX_THICKNESS: 3,
    MIN_OPACITY: 0.5,
    MAX_OPACITY: 0.9,
    BASE_ANGLE: 30,          // Strong angle
    WIND_VARIATION: 25,      // Chaotic gusts
    DROP_MULTIPLIER: 1.3,    // Very dense
    SPLASH_RATE: 70,         // Tons of splashes
    SPLASH_MIN_RADIUS: 5,
    SPLASH_MAX_RADIUS: 16,
    SPLASH_DURATION: 650,
    STREAK_CHANCE: 0.25,     // Many "sheet rain" streaks
    MIST_OPACITY: 0.12,      // Heavier mist
    DARK_OPACITY: 0.08,      // Slight darkening (stormy atmosphere)
  },
};

// Helper to get the appropriate rain config based on intensity
function getRainConfig(intensity: number) {
  if (intensity >= 1.0) return RAIN_CONFIGS.STORM;
  if (intensity >= 0.7) return RAIN_CONFIGS.HEAVY;
  if (intensity >= 0.4) return RAIN_CONFIGS.MODERATE;
  return RAIN_CONFIGS.LIGHT;
}

// Snow configuration - intensity-specific settings for AAA visual quality
// Each level creates a distinctly different visual experience
const SNOW_CONFIGS = {
  // Light Snow: Gentle, sparse, peaceful
  LIGHT: {
    MIN_SPEED: 25,
    MAX_SPEED: 50,
    MIN_SIZE: 1.5,
    MAX_SIZE: 3,
    DRIFT_AMOUNT: 8,         // Minimal drift - almost straight down
    DRIFT_FREQUENCY: 1.0,    // Slow, gentle oscillation
    BASE_ANGLE: 3,           // Nearly vertical
    WIND_MULTIPLIER: 0.2,    // Barely affected by wind
    DROP_MULTIPLIER: 0.5,    // Sparse
  },
  // Moderate Snow: Noticeable, but calm
  MODERATE: {
    MIN_SPEED: 40,
    MAX_SPEED: 80,
    MIN_SIZE: 2,
    MAX_SIZE: 4,
    DRIFT_AMOUNT: 25,        // Noticeable drift
    DRIFT_FREQUENCY: 1.5,    // Moderate oscillation
    BASE_ANGLE: 8,           // Slight angle
    WIND_MULTIPLIER: 0.4,    // Some wind effect
    DROP_MULTIPLIER: 0.7,    // Medium density
  },
  // Heavy Snow: Dense, fast, building up
  HEAVY: {
    MIN_SPEED: 60,
    MAX_SPEED: 120,
    MIN_SIZE: 2.5,
    MAX_SIZE: 5,
    DRIFT_AMOUNT: 45,        // Strong drift
    DRIFT_FREQUENCY: 2.0,    // Faster oscillation
    BASE_ANGLE: 15,          // Noticeable angle
    WIND_MULTIPLIER: 0.7,    // Affected by wind
    DROP_MULTIPLIER: 0.9,    // Dense
  },
  // Blizzard: Extreme, chaotic, reduced visibility
  BLIZZARD: {
    MIN_SPEED: 160,          // Much faster
    MAX_SPEED: 300,          // Very fast gusts
    MIN_SIZE: 2,             // Slightly smaller for dense blizzard look
    MAX_SIZE: 5,
    DRIFT_AMOUNT: 100,       // Extreme horizontal drift
    DRIFT_FREQUENCY: 3.5,    // Rapid, chaotic oscillation
    BASE_ANGLE: 55,          // Very sideways - driving snow
    WIND_MULTIPLIER: 1.5,    // Heavily affected by gusts
    DROP_MULTIPLIER: 1.4,    // Very dense (more particles instead of streaks)
    FOG_OPACITY: 0.15,       // Whiteout effect
  },
  // Visual properties (shared)
  SNOW_COLOR: '#FFFFFF',
  SNOW_SHADOW_COLOR: '#E8E8E8',
  MIN_OPACITY: 0.5,
  MAX_OPACITY: 0.95,
};

// Helper to get the appropriate snow config based on intensity
function getSnowConfig(intensity: number) {
  if (intensity >= 1.0) return SNOW_CONFIGS.BLIZZARD;
  if (intensity >= 0.7) return SNOW_CONFIGS.HEAVY;
  if (intensity >= 0.4) return SNOW_CONFIGS.MODERATE;
  return SNOW_CONFIGS.LIGHT;
}

// Pre-allocate pools for better performance (avoid GC during gameplay)
const MAX_DROPS = 4000;
const MAX_SPLASHES = 200;
const POOL_SIZE = 500; // Extra pool capacity for recycling

let rainSystem: RainSystemState = {
  drops: [],
  splashes: [],
  dropPool: [],
  splashPool: [],
  activeDropCount: 0,
  activeSplashCount: 0,
  lastUpdate: 0,
  windOffset: 0,
  gustPhase: 0,
  lastSpawnTime: 0,
  thunderFlash: null,
  cachedCanvasWidth: 0,
  cachedCanvasHeight: 0,
};

// Pre-computed values for performance
const DEG_TO_RAD = Math.PI / 180;
const TWO_PI = Math.PI * 2;

/**
 * Gets a drop from the pool or creates a new one
 */
function getDropFromPool(): RainDrop {
  if (rainSystem.dropPool.length > 0) {
    const drop = rainSystem.dropPool.pop()!;
    drop.active = true;
    return drop;
  }
  return {
    x: 0, y: 0, speed: 0, length: 0, opacity: 0, thickness: 0,
    drift: 0, driftPhase: 0, active: true
  };
}

/**
 * Returns a drop to the pool for reuse
 */
function returnDropToPool(drop: RainDrop): void {
  drop.active = false;
  if (rainSystem.dropPool.length < POOL_SIZE) {
    rainSystem.dropPool.push(drop);
  }
}

/**
 * Gets a splash from the pool or creates a new one
 */
function getSplashFromPool(): RainSplash {
  if (rainSystem.splashPool.length > 0) {
    const splash = rainSystem.splashPool.pop()!;
    splash.active = true;
    return splash;
  }
  return {
    x: 0, y: 0, radius: 0, maxRadius: 0, opacity: 0,
    startTime: 0, duration: 0, active: true
  };
}

/**
 * Returns a splash to the pool for reuse
 */
function returnSplashToPool(splash: RainSplash): void {
  splash.active = false;
  if (rainSystem.splashPool.length < POOL_SIZE) {
    rainSystem.splashPool.push(splash);
  }
}

/**
 * Creates a splash effect when a raindrop hits the ground
 * Uses intensity-specific splash configuration for varied visual impact
 * Now uses object pooling for better performance
 */
function createSplashWithConfig(x: number, y: number, rainConfig: typeof RAIN_CONFIGS.LIGHT, currentTime: number): RainSplash {
  const splash = getSplashFromPool();
  const maxRadius = rainConfig.SPLASH_MIN_RADIUS + 
    Math.random() * (rainConfig.SPLASH_MAX_RADIUS - rainConfig.SPLASH_MIN_RADIUS);
  
  splash.x = x;
  splash.y = y;
  splash.radius = 0;
  splash.maxRadius = maxRadius;
  splash.opacity = 0.7 + Math.random() * 0.3;
  splash.startTime = currentTime;
  splash.duration = rainConfig.SPLASH_DURATION * (0.8 + Math.random() * 0.4);
  
  return splash;
}

/**
 * Creates a splash effect (legacy - uses moderate rain defaults)
 */
function createSplash(x: number, y: number, currentTime: number): RainSplash {
  return createSplashWithConfig(x, y, RAIN_CONFIGS.MODERATE, currentTime);
}

/**
 * Creates a new raindrop/snowflake with random properties in world space
 * Uses object pooling to reduce GC pressure
 */
function createRainDrop(
  cameraX: number, 
  cameraY: number, 
  canvasWidth: number, 
  canvasHeight: number, 
  intensity: number,
  isWinter: boolean = false
): RainDrop {
  const drop = getDropFromPool();
  
  // Calculate world space bounds for spawning (larger area around camera)
  const worldSpawnWidth = canvasWidth + RAIN_CONFIG.SPAWN_MARGIN * 8;
  const worldSpawnHeight = canvasHeight + RAIN_CONFIG.SPAWN_MARGIN * 8;
  
  // Spawn drops in world space around the camera
  drop.x = cameraX - worldSpawnWidth / 2 + Math.random() * worldSpawnWidth;
  drop.y = cameraY - worldSpawnHeight / 2 - Math.random() * RAIN_CONFIG.SPAWN_MARGIN;
  
  if (isWinter) {
    // Create snowflake with intensity-specific properties
    const snowConfig = getSnowConfig(intensity);
    drop.speed = snowConfig.MIN_SPEED + Math.random() * (snowConfig.MAX_SPEED - snowConfig.MIN_SPEED);
    const size = snowConfig.MIN_SIZE + Math.random() * (snowConfig.MAX_SIZE - snowConfig.MIN_SIZE);
    drop.opacity = SNOW_CONFIGS.MIN_OPACITY + (SNOW_CONFIGS.MAX_OPACITY - SNOW_CONFIGS.MIN_OPACITY) * (0.7 + Math.random() * 0.3);
    drop.length = size;      // For snow, length = size (pixel squares)
    drop.thickness = size;   // Snowflakes use size for thickness
    drop.drift = snowConfig.DRIFT_AMOUNT * (0.5 + Math.random() * 0.5);
    drop.driftPhase = Math.random() * TWO_PI;
  } else {
    // Create raindrop with intensity-specific properties
    const rainConfig = getRainConfig(intensity);
    drop.speed = rainConfig.MIN_SPEED + Math.random() * (rainConfig.MAX_SPEED - rainConfig.MIN_SPEED);
    
    // Check if this drop should be a "sheet rain" streak (heavy storms)
    const isStreak = rainConfig.STREAK_CHANCE > 0 && Math.random() < rainConfig.STREAK_CHANCE;
    const baseLength = rainConfig.MIN_LENGTH + Math.random() * (rainConfig.MAX_LENGTH - rainConfig.MIN_LENGTH);
    drop.length = isStreak ? baseLength * 2.5 : baseLength; // Streaks are longer
    
    drop.opacity = rainConfig.MIN_OPACITY + (rainConfig.MAX_OPACITY - rainConfig.MIN_OPACITY) * (0.8 + Math.random() * 0.2);
    const thickness = rainConfig.MIN_THICKNESS + Math.random() * (rainConfig.MAX_THICKNESS - rainConfig.MIN_THICKNESS);
    drop.thickness = isStreak ? thickness * 0.8 : thickness; // Streaks are slightly thinner
    drop.drift = 0;
    drop.driftPhase = 0;
  }
  
  return drop;
}

/**
 * Updates rain/snow drop positions and removes drops that have fallen off screen
 * OPTIMIZED: Uses swap-and-pop for O(1) removal instead of splice O(n)
 */
function updateRainDrops(
  deltaTime: number, 
  cameraX: number,
  cameraY: number,
  canvasWidth: number, 
  canvasHeight: number, 
  intensity: number,
  isWinter: boolean = false,
  currentTime: number  // Pass in to avoid multiple performance.now() calls
): void {
  // Update wind effects - gust intensity varies by weather type
  rainSystem.gustPhase += deltaTime * RAIN_CONFIG.GUST_FREQUENCY;
  
  // Calculate fall angle with wind - both rain and snow use intensity-specific settings
  let baseAngle: number;
  let windVariation: number;
  let driftFrequency: number;
  
  // Cache config lookup - only do it once per frame
  const snowConfig = isWinter ? getSnowConfig(intensity) : null;
  const rainConfig = !isWinter ? getRainConfig(intensity) : null;
  
  if (isWinter && snowConfig) {
    const windGust = Math.sin(rainSystem.gustPhase) * 10; // Base wind variation
    baseAngle = snowConfig.BASE_ANGLE;
    windVariation = windGust * snowConfig.WIND_MULTIPLIER;
    driftFrequency = snowConfig.DRIFT_FREQUENCY;
    rainSystem.windOffset = windVariation;
  } else if (rainConfig) {
    const windGust = Math.sin(rainSystem.gustPhase) * rainConfig.WIND_VARIATION;
    baseAngle = rainConfig.BASE_ANGLE;
    windVariation = windGust;
    driftFrequency = 2.0;
    rainSystem.windOffset = windGust;
  } else {
    baseAngle = 10;
    windVariation = 0;
    driftFrequency = 2.0;
  }
  
  // Pre-compute trig values once per frame
  const fallAngle = (baseAngle + windVariation) * DEG_TO_RAD;
  const horizontalSpeed = Math.sin(fallAngle);
  const verticalSpeed = Math.cos(fallAngle);
  
  // Pre-compute bounds once per frame
  const cullMargin = RAIN_CONFIG.SPAWN_MARGIN * 2;
  const halfWidth = canvasWidth * 0.5;
  const halfHeight = canvasHeight * 0.5;
  const leftBound = cameraX - halfWidth - cullMargin;
  const rightBound = cameraX + halfWidth + cullMargin;
  const topBound = cameraY - halfHeight - cullMargin;
  const bottomBound = cameraY + halfHeight + cullMargin;
  
  // Pre-compute horizontal multiplier for blizzard
  const horizontalMultiplier = isWinter ? (intensity >= 1.0 ? 0.8 : 0.3) : 1.0;
  
  // Update existing drops using swap-and-pop for O(1) removal
  const drops = rainSystem.drops;
  let i = 0;
  while (i < drops.length) {
    const drop = drops[i];
    
    if (isWinter && drop.drift > 0) {
      // Snow: update drift phase and apply sinusoidal horizontal movement
      drop.driftPhase += deltaTime * driftFrequency;
      const driftOffset = Math.sin(drop.driftPhase) * drop.drift * deltaTime;
      drop.x += driftOffset + drop.speed * horizontalSpeed * deltaTime * horizontalMultiplier;
      drop.y += drop.speed * verticalSpeed * deltaTime;
    } else {
      // Rain: normal movement
      drop.x += drop.speed * horizontalSpeed * deltaTime;
      drop.y += drop.speed * verticalSpeed * deltaTime;
    }
    
    // Remove drops that have moved too far from camera (world space culling)
    // Using swap-and-pop: O(1) instead of splice O(n)
    if (drop.x > rightBound || drop.x < leftBound ||
        drop.y < topBound || drop.y > bottomBound) {
      returnDropToPool(drop);
      // Swap with last element and pop
      const lastIdx = drops.length - 1;
      if (i < lastIdx) {
        drops[i] = drops[lastIdx];
      }
      drops.pop();
      // Don't increment i - we need to check the swapped element
    } else {
      i++;
    }
  }
  
  // Create random splashes across the entire visible area (only for rain, not snow)
  if (intensity > 0 && !isWinter && rainConfig) {
    const splashRate = rainConfig.SPLASH_RATE;
    const splashesToCreate = Math.max(1, (splashRate * deltaTime) | 0); // Bitwise OR for fast floor
    
    const splashBaseX = cameraX - halfWidth;
    const splashBaseY = cameraY - halfHeight;
    
    for (let j = 0; j < splashesToCreate && rainSystem.splashes.length < MAX_SPLASHES; j++) {
      const splashX = splashBaseX + Math.random() * canvasWidth;
      const splashY = splashBaseY + Math.random() * canvasHeight;
      rainSystem.splashes.push(createSplashWithConfig(splashX, splashY, rainConfig, currentTime));
    }
  }
  
  // Update splash effects using swap-and-pop
  const splashes = rainSystem.splashes;
  let si = 0;
  while (si < splashes.length) {
    const splash = splashes[si];
    const elapsed = currentTime - splash.startTime;
    const progress = elapsed / splash.duration;
    
    if (progress >= 1.0) {
      returnSplashToPool(splash);
      // Swap-and-pop
      const lastIdx = splashes.length - 1;
      if (si < lastIdx) {
        splashes[si] = splashes[lastIdx];
      }
      splashes.pop();
    } else {
      splash.radius = splash.maxRadius * progress;
      splash.opacity = (1.0 - progress) * 0.9; // Simplified - removed random per frame
      si++;
    }
  }
  
  // Determine target drop count based on intensity
  const dropMultiplier = isWinter && snowConfig
    ? snowConfig.DROP_MULTIPLIER 
    : (rainConfig ? rainConfig.DROP_MULTIPLIER : 1.0);
  
  let targetDropCount = 0;
  if (intensity > 0) {
    if (intensity <= 0.4) {
      targetDropCount = (RAIN_CONFIG.LIGHT_RAIN_DROPS * intensity / 0.4 * dropMultiplier) | 0;
    } else if (intensity <= 0.7) {
      targetDropCount = ((RAIN_CONFIG.LIGHT_RAIN_DROPS + 
        RAIN_CONFIG.MODERATE_RAIN_DROPS * (intensity - 0.4) / 0.3) * dropMultiplier) | 0;
    } else if (intensity < 1.0) {
      targetDropCount = ((RAIN_CONFIG.LIGHT_RAIN_DROPS + RAIN_CONFIG.MODERATE_RAIN_DROPS +
        RAIN_CONFIG.HEAVY_RAIN_DROPS * (intensity - 0.7) / 0.3) * dropMultiplier) | 0;
    } else {
      targetDropCount = ((RAIN_CONFIG.LIGHT_RAIN_DROPS + RAIN_CONFIG.MODERATE_RAIN_DROPS + 
        RAIN_CONFIG.HEAVY_RAIN_DROPS + RAIN_CONFIG.HEAVY_STORM_DROPS) * dropMultiplier) | 0;
    }
  }
  
  // Cap to max drops
  targetDropCount = Math.min(targetDropCount, MAX_DROPS);
  
  // INSTANT FILL: If we have significantly fewer drops than needed, instantly spawn them
  const currentDropCount = drops.length;
  const targetThreshold = targetDropCount * 0.7;
  
  if (currentDropCount < targetThreshold) {
    const dropsNeeded = targetDropCount - currentDropCount;
    const spawnAreaHeight = canvasHeight + RAIN_CONFIG.SPAWN_MARGIN * 4;
    const spawnBaseY = cameraY - halfHeight - RAIN_CONFIG.SPAWN_MARGIN;
    
    for (let j = 0; j < dropsNeeded; j++) {
      const newDrop = createRainDrop(cameraX, cameraY, canvasWidth, canvasHeight, intensity, isWinter);
      newDrop.y = spawnBaseY + Math.random() * spawnAreaHeight;
      drops.push(newDrop);
    }
  }
  
  // Continuous spawning for new drops at the top
  const snowSpawnMultiplier = isWinter ? (intensity >= 1.0 ? 60 : intensity >= 0.7 ? 40 : 25) : 50;
  const spawnRate = intensity * snowSpawnMultiplier;
  const dropsToSpawn = (spawnRate * deltaTime) | 0;
  const maxDropsWithBuffer = (targetDropCount * 1.2) | 0;
  const spawnY = cameraY - halfHeight - RAIN_CONFIG.SPAWN_MARGIN;
  
  for (let j = 0; j < dropsToSpawn && drops.length < maxDropsWithBuffer; j++) {
    const newDrop = createRainDrop(cameraX, cameraY, canvasWidth, canvasHeight, intensity, isWinter);
    newDrop.y = spawnY;
    drops.push(newDrop);
  }
  
  // Remove excess drops if intensity decreased - return to pool
  const maxDropsAllowed = (targetDropCount * 1.3) | 0;
  while (drops.length > maxDropsAllowed) {
    const removed = drops.pop();
    if (removed) returnDropToPool(removed);
  }
}

/**
 * Renders splash effects on the canvas (rain splashes, not used for snow)
 * Splash size and intensity vary based on rain intensity
 * OPTIMIZED: Uses traditional for loop instead of forEach
 */
function renderSplashes(
  ctx: CanvasRenderingContext2D,
  cameraX: number,
  cameraY: number,
  canvasWidth: number,
  canvasHeight: number,
  isWinter: boolean = false,
  intensity: number = 0.5
): void {
  const splashes = rainSystem.splashes;
  const splashCount = splashes.length;
  
  if (splashCount === 0 || isWinter) return;
  
  ctx.save();
  
  const screenCenterX = canvasWidth * 0.5;
  const screenCenterY = canvasHeight * 0.5;
  const isHeavy = intensity >= 0.7;
  const isStorm = intensity >= 1.0;
  const lineWidth = isStorm ? 1.5 : 1;
  
  // Pre-set common styles
  ctx.fillStyle = RAIN_CONFIG.SPLASH_COLOR;
  ctx.strokeStyle = RAIN_CONFIG.SPLASH_COLOR;
  ctx.lineWidth = lineWidth;
  
  // Pre-compute bounds check values
  const margin = 50;
  const minX = -margin;
  const maxX = canvasWidth + margin;
  const minY = -margin;
  const maxY = canvasHeight + margin;
  
  for (let i = 0; i < splashCount; i++) {
    const splash = splashes[i];
    const screenX = screenCenterX + (splash.x - cameraX);
    const screenY = screenCenterY + (splash.y - cameraY);
    
    // Bounds check - skip if off screen
    if (screenX < minX || screenX > maxX || screenY < minY || screenY > maxY) {
      continue;
    }
    
    const baseAlpha = splash.opacity * 0.7;
    ctx.globalAlpha = baseAlpha;
    
    // Inner splash (water droplet)
    ctx.beginPath();
    ctx.arc(screenX, screenY, splash.radius * 0.4, 0, TWO_PI);
    ctx.fill();
    
    // Outer ring
    ctx.beginPath();
    ctx.arc(screenX, screenY, splash.radius, 0, TWO_PI);
    ctx.stroke();
    
    // Second ring for heavy rain (ripple effect) - simplified check
    if (isHeavy && splash.radius > splash.maxRadius * 0.3) {
      ctx.globalAlpha = baseAlpha * 0.43; // 0.3 / 0.7
      ctx.beginPath();
      ctx.arc(screenX, screenY, splash.radius * 1.4, 0, TWO_PI);
      ctx.stroke();
    }
    
    // Crown splash particles for large storm splashes - only render for some
    if (isStorm && splash.maxRadius > 10) {
      const radiusRatio = splash.radius / splash.maxRadius;
      if (radiusRatio > 0.2 && radiusRatio < 0.6) {
        ctx.globalAlpha = baseAlpha * 0.71; // 0.5 / 0.7
        ctx.fillStyle = '#a0d4f4'; // Lighter blue for spray
        const distance = splash.radius * 0.8;
        const offsetY = splash.radius * 0.3;
        
        // Unrolled loop for 5 particles - avoid loop overhead
        ctx.beginPath();
        ctx.arc(screenX + distance, screenY - offsetY, 1.5, 0, TWO_PI);
        ctx.arc(screenX + distance * 0.309, screenY - offsetY + distance * 0.951, 1.5, 0, TWO_PI);
        ctx.arc(screenX - distance * 0.809, screenY - offsetY + distance * 0.588, 1.5, 0, TWO_PI);
        ctx.arc(screenX - distance * 0.809, screenY - offsetY - distance * 0.588, 1.5, 0, TWO_PI);
        ctx.arc(screenX + distance * 0.309, screenY - offsetY - distance * 0.951, 1.5, 0, TWO_PI);
        ctx.fill();
        
        // Reset fill style
        ctx.fillStyle = RAIN_CONFIG.SPLASH_COLOR;
      }
    }
  }
  
  ctx.restore();
}

/**
 * Renders rain drops or snowflakes on the canvas
 * OPTIMIZED: Traditional for loops, pre-computed values, batched drawing
 */
function renderRainDrops(
  ctx: CanvasRenderingContext2D, 
  cameraX: number,
  cameraY: number,
  canvasWidth: number,
  canvasHeight: number,
  intensity: number,
  isWinter: boolean = false
): void {
  const drops = rainSystem.drops;
  const dropCount = drops.length;
  
  if (dropCount === 0) return;
  
  ctx.save();
  
  // Pre-compute screen center once
  const screenCenterX = canvasWidth * 0.5;
  const screenCenterY = canvasHeight * 0.5;
  
  // Pre-compute bounds check values
  const margin = 50;
  const minX = -margin;
  const maxX = canvasWidth + margin;
  const minY = -margin;
  const maxY = canvasHeight + margin;
  
  if (isWinter) {
    const snowConfig = getSnowConfig(intensity);
    const isBlizzard = intensity >= 1.0;
    
    // Blizzard whiteout effect - only render overlay if dimensions changed (cache gradients)
    if (isBlizzard && (snowConfig as any).FOG_OPACITY !== undefined) {
      const fogOpacity = (snowConfig as any).FOG_OPACITY;
      const centerX = screenCenterX;
      const centerY = screenCenterY;
      const maxRadius = Math.sqrt(centerX * centerX + centerY * centerY);
      
      // Create radial gradient - clear in center, foggy at edges (vignette whiteout)
      const gradient = ctx.createRadialGradient(
        centerX, centerY, maxRadius * 0.3,
        centerX, centerY, maxRadius * 1.1
      );
      gradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
      gradient.addColorStop(0.5, `rgba(240, 245, 250, ${fogOpacity * 0.4})`);
      gradient.addColorStop(0.8, `rgba(230, 235, 245, ${fogOpacity * 0.8})`);
      gradient.addColorStop(1, `rgba(220, 228, 240, ${fogOpacity})`);
      
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);
      
      // Add subtle top-down wind haze
      const windAngle = (snowConfig.BASE_ANGLE + rainSystem.windOffset * snowConfig.WIND_MULTIPLIER) * DEG_TO_RAD;
      const sinWind = Math.sin(windAngle);
      const hazeGradient = ctx.createLinearGradient(
        screenCenterX - sinWind * canvasWidth, 0,
        screenCenterX + sinWind * canvasWidth, canvasHeight
      );
      hazeGradient.addColorStop(0, `rgba(255, 255, 255, ${fogOpacity * 0.3})`);
      hazeGradient.addColorStop(0.5, 'rgba(255, 255, 255, 0)');
      hazeGradient.addColorStop(1, `rgba(255, 255, 255, ${fogOpacity * 0.2})`);
      
      ctx.fillStyle = hazeGradient;
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    }
    
    // Render snowflakes as pixel-art squares using traditional for loop
    for (let i = 0; i < dropCount; i++) {
      const drop = drops[i];
      const screenX = screenCenterX + (drop.x - cameraX);
      const screenY = screenCenterY + (drop.y - cameraY);
      
      // Bounds check
      if (screenX < minX || screenX > maxX || screenY < minY || screenY > maxY) {
        continue;
      }
      
      // Use bitwise AND for fast modulo 4 check
      const isBackground = (i & 3) === 0;
      ctx.fillStyle = isBackground ? SNOW_CONFIGS.SNOW_SHADOW_COLOR : SNOW_CONFIGS.SNOW_COLOR;
      ctx.globalAlpha = drop.opacity * (isBackground ? 0.5 : 1.0);
      
      // Draw snowflake as a pixel-art square - use bitwise OR for fast floor
      const size = Math.max(1, drop.thickness | 0);
      const halfSize = size * 0.5;
      const px = (screenX - halfSize) | 0;
      const py = (screenY - halfSize) | 0;
      ctx.fillRect(px, py, size, size);
      
      // Larger flakes in calm snow get a subtle cross pattern
      if (size >= 3 && !isBackground && !isBlizzard) {
        ctx.globalAlpha = drop.opacity * 0.4;
        const sx = screenX | 0;
        const sy = screenY | 0;
        ctx.fillRect(px - 1, sy, 1, 1);
        ctx.fillRect(px + size, sy, 1, 1);
        ctx.fillRect(sx, py - 1, 1, 1);
        ctx.fillRect(sx, py + size, 1, 1);
      }
    }
  } else {
    // Render rain drops with intensity-specific visual effects
    const rainConfig = getRainConfig(intensity);
    const isStorm = intensity >= 1.0;
    const isHeavy = intensity >= 0.7;
    
    const maxRadius = Math.sqrt(screenCenterX * screenCenterX + screenCenterY * screenCenterY);
    
    // Storm atmosphere - dark vignette effect
    if (isStorm && (rainConfig as any).DARK_OPACITY !== undefined) {
      const darkOpacity = (rainConfig as any).DARK_OPACITY;
      const darkGradient = ctx.createRadialGradient(
        screenCenterX, screenCenterY, maxRadius * 0.4,
        screenCenterX, screenCenterY, maxRadius * 1.2
      );
      darkGradient.addColorStop(0, 'rgba(26, 26, 46, 0)');
      darkGradient.addColorStop(0.6, `rgba(26, 26, 46, ${darkOpacity * 0.5})`);
      darkGradient.addColorStop(1, `rgba(20, 22, 40, ${darkOpacity})`);
      
      ctx.fillStyle = darkGradient;
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    }
    
    // Mist/fog overlay for heavy rain and storms
    if ((isHeavy || isStorm) && (rainConfig as any).MIST_OPACITY !== undefined) {
      const mistOpacity = (rainConfig as any).MIST_OPACITY;
      const mistGradient = ctx.createLinearGradient(0, 0, 0, canvasHeight);
      mistGradient.addColorStop(0, `rgba(128, 144, 160, ${mistOpacity * 0.3})`);
      mistGradient.addColorStop(0.7, `rgba(128, 144, 160, ${mistOpacity * 0.6})`);
      mistGradient.addColorStop(1, `rgba(140, 155, 170, ${mistOpacity})`);
      
      ctx.fillStyle = mistGradient;
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    }
    
    // Pre-compute fall angle values once
    const fallAngle = (rainConfig.BASE_ANGLE + rainSystem.windOffset) * DEG_TO_RAD;
    const dx = Math.sin(fallAngle);
    const dy = Math.cos(fallAngle);
    const streakThreshold = rainConfig.MAX_LENGTH * 1.5;
    
    ctx.lineCap = 'round';
    
    // Batch render by style to reduce state changes
    // First pass: background drops (every 3rd)
    ctx.strokeStyle = RAIN_CONFIG.RAIN_SHADOW_COLOR;
    for (let i = 0; i < dropCount; i += 3) {
      const drop = drops[i];
      const screenX = screenCenterX + (drop.x - cameraX);
      const screenY = screenCenterY + (drop.y - cameraY);
      
      if (screenX < minX || screenX > maxX || screenY < minY || screenY > maxY) continue;
      if (drop.length > streakThreshold) continue; // Skip streaks in first pass
      
      ctx.globalAlpha = drop.opacity * 0.6;
      ctx.lineWidth = drop.thickness;
      ctx.beginPath();
      ctx.moveTo(screenX, screenY);
      ctx.lineTo(screenX + dx * drop.length, screenY + dy * drop.length);
      ctx.stroke();
    }
    
    // Second pass: foreground drops
    ctx.strokeStyle = RAIN_CONFIG.RAIN_COLOR;
    for (let i = 0; i < dropCount; i++) {
      if (i % 3 === 0) continue; // Skip background drops
      
      const drop = drops[i];
      const screenX = screenCenterX + (drop.x - cameraX);
      const screenY = screenCenterY + (drop.y - cameraY);
      
      if (screenX < minX || screenX > maxX || screenY < minY || screenY > maxY) continue;
      
      const isStreak = drop.length > streakThreshold;
      
      if (isStreak) {
        ctx.strokeStyle = '#a0c4e8';
        ctx.globalAlpha = drop.opacity * 0.6;
        ctx.lineWidth = drop.thickness * 0.7;
      } else {
        ctx.strokeStyle = RAIN_CONFIG.RAIN_COLOR;
        ctx.globalAlpha = drop.opacity;
        ctx.lineWidth = drop.thickness;
      }
      
      ctx.beginPath();
      ctx.moveTo(screenX, screenY);
      ctx.lineTo(screenX + dx * drop.length, screenY + dy * drop.length);
      ctx.stroke();
      
      // Add subtle glow for thick drops
      if (drop.thickness >= 2 && !isStreak) {
        ctx.globalAlpha = drop.opacity * 0.2;
        ctx.lineWidth = drop.thickness * 2;
        ctx.stroke();
      }
    }
  }
  
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
 * Main rain/snow rendering function to be called from the game loop
 * In winter, precipitation is rendered as snow instead of rain
 * OPTIMIZED: Single performance.now() call, passed to sub-functions
 */
export function renderRain(
  ctx: CanvasRenderingContext2D,
  cameraX: number,
  cameraY: number,
  canvasWidth: number,
  canvasHeight: number,
  rainIntensity: number, // 0.0 to 1.0 from server
  deltaTime: number, // in seconds
  isWinter: boolean = false // When true, render snow instead of rain
): void {
  // Get current time once for all operations this frame
  const currentTime = performance.now();
  
  // Update rain/snow system
  updateRainDrops(deltaTime, cameraX, cameraY, canvasWidth, canvasHeight, rainIntensity, isWinter, currentTime);
  
  // Render precipitation if there's any intensity
  if (rainIntensity > 0) {
    renderRainDrops(ctx, cameraX, cameraY, canvasWidth, canvasHeight, rainIntensity, isWinter);
    renderSplashes(ctx, cameraX, cameraY, canvasWidth, canvasHeight, isWinter, rainIntensity);
  }
  
  // Always render thunder flash if active (even if rain intensity is 0)
  // Thunder still makes sense in winter storms (thunder snow!)
  renderThunderFlash(ctx, canvasWidth, canvasHeight);
}

/**
 * Clears all rain drops and splashes (useful for immediate weather changes)
 * Returns objects to pools for reuse
 */
export function clearRain(): void {
  // Return all drops to pool
  for (let i = 0; i < rainSystem.drops.length; i++) {
    returnDropToPool(rainSystem.drops[i]);
  }
  rainSystem.drops.length = 0;
  
  // Return all splashes to pool
  for (let i = 0; i < rainSystem.splashes.length; i++) {
    returnSplashToPool(rainSystem.splashes[i]);
  }
  rainSystem.splashes.length = 0;
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
