import { TILE_SIZE } from '../../config/gameConfig';

/**
 * Water Overlay Rendering Utilities
 * 
 * Renders bright teal horizontal lines that oscillate up and down to simulate
 * water surface reflections and light patterns on water tiles.
 */

interface WaterLine {
  startX: number; // Starting point of the line
  y: number;
  angle: number; // Slight rotation for natural look
  targetLength: number; // Final length when fully grown
  currentLength: number; // Current animated length
  opacity: number;
  thickness: number;
  growthSpeed: number; // How fast the line grows
  growthPhase: number; // Current growth animation phase
  growthPattern: 'center' | 'left-to-right' | 'right-to-left' | 'random'; // How line appears
  isMainLine: boolean; // Whether this is the main line or a parallel line
  parentId?: number; // ID of the parent line group for parallel lines
  lifetime: number; // How long this line should exist (in seconds)
  age: number; // How long this line has existed (in seconds)
  baseOpacity: number; // Original opacity before fading
  isGrowing: boolean; // Whether line is still in growth phase
  flickerPhase: number; // For subtle opacity variation
}

interface WaterOverlayState {
  lines: WaterLine[];
  lastUpdate: number;
  globalPhaseOffset: number;
  worldTiles: Map<string, any> | null;
}

// Water overlay configuration constants
const WATER_CONFIG = {
  // Line density - increased for better coverage
  LINES_PER_SCREEN_AREA: 1.2, // line groups per 1000x1000 pixel area (increased for better coverage)
  
  // Line properties - much shorter like in screenshot
  MIN_LENGTH: 8,   // Much shorter lines
  MAX_LENGTH: 25,  // Maximum still quite short
  MIN_OPACITY: 0.15, // More subtle
  MAX_OPACITY: 0.4,  // Reduced for subtlety
  MIN_THICKNESS: 1,
  MAX_THICKNESS: 1, // Keep thickness consistent
  
  // Growth animation properties - organic water reflection timing
  MIN_GROWTH_SPEED: 2.0, // more natural, varied speed
  MAX_GROWTH_SPEED: 8.0, // varied growth creates organic feel
  GROWTH_DURATION: 0.3, // slightly longer for more natural appearance
  
  // Line lifetime properties - organic timing like real water
  MIN_LIFETIME: 0.8, // natural pause before fading
  MAX_LIFETIME: 1.5, // varied lifetime for organic feel
  FADE_DURATION: 0.4, // gentle fade like real reflections
  
  // Visual variety for natural look
  MAX_ANGLE_DEVIATION: 0.1, // slight rotation in radians (about 6 degrees)
  FLICKER_SPEED: 2.0, // subtle opacity variation speed
  
  // Multi-line cluster properties
  MIN_LINES_PER_GROUP: 1, // Sometimes just single lines
  MAX_LINES_PER_GROUP: 3, // Sometimes up to 3 lines per group
  LINE_SPACING: 1, // Vertical spacing between parallel lines (pixels)
  HORIZONTAL_OFFSET_RANGE: 8, // Reduced horizontal offset
  
  // Visual properties - light/white for visibility against blue water
  WATER_LINE_COLOR: '#E2E8F0', // Light gray/white for good contrast
  WATER_LINE_GLOW_COLOR: '#F7FAFC', // Very light white for subtle glow
  
  // Screen margins (spawn lines across much larger area for seamless coverage)
  SPAWN_MARGIN: 800, // Increased from 200 to 800 for much better coverage
  
  // Global wave effect - slower for more realistic water motion
  GLOBAL_WAVE_SPEED: 0.15, // Global phase shift speed (slower)
};

let waterSystem: WaterOverlayState = {
  lines: [],
  lastUpdate: 0,
  globalPhaseOffset: 0,
  worldTiles: null,
};

/**
 * Converts world pixel coordinates to tile coordinates (same as placement system)
 */
function worldPosToTileCoords(worldX: number, worldY: number): { tileX: number; tileY: number } {
  const tileX = Math.floor(worldX / TILE_SIZE);
  const tileY = Math.floor(worldY / TILE_SIZE);
  return { tileX, tileY };
}

/**
 * Checks if a world position is on a water tile (Sea type) - same logic as placement system
 */
function isPositionOnWaterTile(worldTiles: Map<string, any>, worldX: number, worldY: number): boolean {
  if (!worldTiles || worldTiles.size === 0) return false;
  
  const { tileX, tileY } = worldPosToTileCoords(worldX, worldY);
  
  // Check all world tiles to find the one at this position (same as placement system)
  for (const tile of worldTiles.values()) {
    if (tile.worldX === tileX && tile.worldY === tileY) {
      // Found the tile at this position, check if it's water
      return tile.tileType && tile.tileType.tag === 'Sea';
    }
  }
  
  // No tile found at this position, assume it's not water
  return false;
}

/**
 * Get all water tiles in the visible camera area for more efficient spawning
 */
function getVisibleWaterTiles(
  worldTiles: Map<string, any>,
  cameraX: number,
  cameraY: number,
  canvasWidth: number,
  canvasHeight: number
): Array<{x: number, y: number}> {
  const waterTiles: Array<{x: number, y: number}> = [];
  
  // Calculate visible tile bounds
  const leftBound = cameraX - canvasWidth / 2 - WATER_CONFIG.SPAWN_MARGIN;
  const rightBound = cameraX + canvasWidth / 2 + WATER_CONFIG.SPAWN_MARGIN;
  const topBound = cameraY - canvasHeight / 2 - WATER_CONFIG.SPAWN_MARGIN;
  const bottomBound = cameraY + canvasHeight / 2 + WATER_CONFIG.SPAWN_MARGIN;
  
  let seaTileCount = 0;
  let visibleSeaTileCount = 0;
  let sampleSeaTiles = 0;
  
  // Check all tiles in the area using the correct coordinate system
  for (const tile of worldTiles.values()) {
    if (tile.tileType && tile.tileType.tag === 'Sea') {
      seaTileCount++;
      
      // Calculate world position of this tile using correct coordinate system
      // worldX and worldY are already in tile coordinates, convert to world pixels
      const worldX = tile.worldX * TILE_SIZE + TILE_SIZE / 2; // Center of tile
      const worldY = tile.worldY * TILE_SIZE + TILE_SIZE / 2;
      
      // Check if tile is in visible area
      if (worldX >= leftBound && worldX <= rightBound && 
          worldY >= topBound && worldY <= bottomBound) {
        waterTiles.push({x: worldX, y: worldY});
        visibleSeaTileCount++;
      }
    }
  }
  
  return waterTiles;
}

/**
 * Creates a group of water lines (main line + parallel lines) with random properties in world space
 * Only spawns lines on water tiles
 */
function createWaterLineGroup(
  cameraX: number,
  cameraY: number,
  canvasWidth: number,
  canvasHeight: number,
  worldTiles: Map<string, any>
): WaterLine[] {
  // Get all visible water tiles for spawning
  const visibleWaterTiles = getVisibleWaterTiles(worldTiles, cameraX, cameraY, canvasWidth, canvasHeight);
  
  // If no water tiles visible, don't spawn any lines
  if (visibleWaterTiles.length === 0) {
    return [];
  }
  
  // Pick a random water tile to spawn on
  const randomWaterTile = visibleWaterTiles[Math.floor(Math.random() * visibleWaterTiles.length)];
  const mainSpawnX = randomWaterTile.x + (Math.random() - 0.5) * TILE_SIZE * 0.8; // Small random offset within tile
  const mainSpawnY = randomWaterTile.y + (Math.random() - 0.5) * TILE_SIZE * 0.8;
  
  // Shared properties for the group
  const baseLength = WATER_CONFIG.MIN_LENGTH + Math.random() * (WATER_CONFIG.MAX_LENGTH - WATER_CONFIG.MIN_LENGTH);
  const baseOpacity = WATER_CONFIG.MIN_OPACITY + Math.random() * (WATER_CONFIG.MAX_OPACITY - WATER_CONFIG.MIN_OPACITY);
  const thickness = WATER_CONFIG.MIN_THICKNESS + Math.random() * (WATER_CONFIG.MAX_THICKNESS - WATER_CONFIG.MIN_THICKNESS);
  
  // Shared growth properties for synchronized animation
  const growthSpeed = WATER_CONFIG.MIN_GROWTH_SPEED + 
    Math.random() * (WATER_CONFIG.MAX_GROWTH_SPEED - WATER_CONFIG.MIN_GROWTH_SPEED);
  
  const parentId = Math.floor(Math.random() * 1000000); // Random ID for the group
  const lines: WaterLine[] = [];
  
  // Randomly determine how many lines in this group (1 to 3)
  const linesInGroup = WATER_CONFIG.MIN_LINES_PER_GROUP + 
    Math.floor(Math.random() * (WATER_CONFIG.MAX_LINES_PER_GROUP - WATER_CONFIG.MIN_LINES_PER_GROUP + 1));
  
  // Create the main line and parallel lines
  for (let i = 0; i < linesInGroup; i++) {
    const isMainLine = i === 0;
    
    // Calculate starting position for this line
    let startX = mainSpawnX;
    let lineY = mainSpawnY + (i * WATER_CONFIG.LINE_SPACING);
    
    // Add horizontal offset for non-main lines to create staggered effect
    if (!isMainLine) {
      startX += (Math.random() - 0.5) * WATER_CONFIG.HORIZONTAL_OFFSET_RANGE;
      
      // Validate that the offset position is still on water
      if (!isPositionOnWaterTile(worldTiles, startX, lineY)) {
        continue; // Skip this line if it's not on water
      }
    }
    
    // Vary target length slightly for each line
    const lengthVariation = 0.8 + Math.random() * 0.4; // 80% to 120% of base length
    let targetLength = baseLength * lengthVariation;
    
    // Validate that the line end is still on water
    const endX = startX + targetLength;
    if (!isPositionOnWaterTile(worldTiles, endX, lineY)) {
      // Try shorter lengths until we find one that ends on water
      for (let len = targetLength * 0.5; len >= WATER_CONFIG.MIN_LENGTH; len *= 0.8) {
        if (isPositionOnWaterTile(worldTiles, startX + len, lineY)) {
          targetLength = len;
          break;
        }
      }
      // If even short lines don't work, skip this line
      if (targetLength < WATER_CONFIG.MIN_LENGTH) {
        continue;
      }
    }
    
    // Vary opacity slightly for each line  
    const opacityVariation = 0.7 + Math.random() * 0.6; // 70% to 130% of base opacity
    const opacity = Math.min(WATER_CONFIG.MAX_OPACITY, baseOpacity * opacityVariation);
    
    // Slightly vary the growth speed for each line
    const speedVariation = 0.8 + Math.random() * 0.4; // 80% to 120% of base speed
    const lineGrowthSpeed = growthSpeed * speedVariation;
    
    // Random lifetime for this line - lines in a group will fade at different times
    const lifetime = WATER_CONFIG.MIN_LIFETIME + Math.random() * (WATER_CONFIG.MAX_LIFETIME - WATER_CONFIG.MIN_LIFETIME);
    
    // Add organic visual variety
    const angle = (Math.random() - 0.5) * WATER_CONFIG.MAX_ANGLE_DEVIATION;
    const growthPatterns: Array<'center' | 'left-to-right' | 'right-to-left' | 'random'> = 
      ['center', 'left-to-right', 'right-to-left', 'random'];
    const growthPattern = growthPatterns[Math.floor(Math.random() * growthPatterns.length)];
    
    lines.push({
      startX,
      y: lineY,
      angle,
      targetLength,
      currentLength: 0, // Start with length 0 and grow
      opacity,
      thickness,
      growthSpeed: lineGrowthSpeed,
      growthPhase: 0, // Start at beginning of growth
      growthPattern,
      isMainLine,
      parentId,
      lifetime,
      age: 0, // Start with age 0
      baseOpacity: opacity, // Store original opacity
      isGrowing: true, // Start in growing state
      flickerPhase: Math.random() * Math.PI * 2, // Random flicker start
    });
  }
  
  return lines;
}

/**
 * Updates water line positions and oscillations
 */
function updateWaterLines(
  deltaTime: number,
  cameraX: number,
  cameraY: number,
  canvasWidth: number,
  canvasHeight: number,
  worldTiles: Map<string, any> | null
): void {
  // Update global wave phase for subtle synchronized movement
  waterSystem.globalPhaseOffset += deltaTime * WATER_CONFIG.GLOBAL_WAVE_SPEED;
  
  // Calculate world space bounds for culling
  const cullMargin = WATER_CONFIG.SPAWN_MARGIN;
  const leftBound = cameraX - canvasWidth / 2 - cullMargin;
  const rightBound = cameraX + canvasWidth / 2 + cullMargin;
  const topBound = cameraY - canvasHeight / 2 - cullMargin;
  const bottomBound = cameraY + canvasHeight / 2 + cullMargin;
  
  // Update existing lines
  for (let i = waterSystem.lines.length - 1; i >= 0; i--) {
    const line = waterSystem.lines[i];
    
    // Update age
    line.age += deltaTime;
    
    // Update growth animation
    if (line.isGrowing) {
      line.growthPhase += line.growthSpeed * deltaTime;
      if (line.growthPhase >= 1.0) {
        line.growthPhase = 1.0;
        line.isGrowing = false;
      }
      // Smooth growth using ease-out curve
      const easedGrowth = 1.0 - Math.pow(1.0 - line.growthPhase, 3);
      line.currentLength = line.targetLength * easedGrowth;
    }
    
    // Handle fading based on age with smooth easing
    if (line.age > line.lifetime) {
      // Start fading
      const fadeProgress = (line.age - line.lifetime) / WATER_CONFIG.FADE_DURATION;
      if (fadeProgress >= 1.0) {
        // Completely faded, remove the line
        waterSystem.lines.splice(i, 1);
        continue;
      } else {
        // Smooth fade-out using ease-in-out curve
        const easedProgress = fadeProgress * fadeProgress * (3.0 - 2.0 * fadeProgress); // Smoothstep
        line.opacity = line.baseOpacity * (1.0 - easedProgress);
      }
    }
    
    // Remove lines that have moved too far from camera (world space culling)
    const lineLeft = line.startX;
    const lineRight = line.startX + line.currentLength;
    if (lineRight < leftBound || 
        lineLeft > rightBound ||
        line.y < topBound ||
        line.y > bottomBound) {
      waterSystem.lines.splice(i, 1);
    }
  }
  
  // Calculate target line count based on visible area
  const visibleArea = canvasWidth * canvasHeight;
  const targetLineCount = Math.floor((visibleArea / 1000000) * WATER_CONFIG.LINES_PER_SCREEN_AREA * 1000);
  
  // Spawn new line groups if needed
  const currentLineCount = waterSystem.lines.length;
  if (currentLineCount < targetLineCount) {
    const groupsToSpawn = Math.min(10, Math.ceil((targetLineCount - currentLineCount) / WATER_CONFIG.MAX_LINES_PER_GROUP)); // Spawn max 10 groups per frame for faster coverage
    
    for (let i = 0; i < groupsToSpawn; i++) {
      if (worldTiles && worldTiles.size > 0) {
        const newLineGroup = createWaterLineGroup(cameraX, cameraY, canvasWidth, canvasHeight, worldTiles);
        if (newLineGroup.length > 0) { // Only add if we successfully created lines on water
          waterSystem.lines.push(...newLineGroup);
        }
      }
    }
  }
  
  // Remove excess lines if we have too many
  while (waterSystem.lines.length > targetLineCount * 1.2) {
    waterSystem.lines.pop();
  }
}

/**
 * Renders water lines on the canvas
 */
function renderWaterLines(
  ctx: CanvasRenderingContext2D,
  cameraX: number,
  cameraY: number,
  canvasWidth: number,
  canvasHeight: number
): void {
  if (waterSystem.lines.length === 0) return;
  
  ctx.save();
  
  // Set line cap for smoother lines
  ctx.lineCap = 'round';
  
  // Debug logging removed - system working correctly
  
  // Test removed - coordinate system is working
  
  // Render lines with glow effect
  // Note: Context is already translated to world space, so we render directly in world coordinates
  waterSystem.lines.forEach((line, index) => {
    // In world space, we render directly using the line's world coordinates
    const lineStartX = line.startX;
    const lineEndX = line.startX + line.currentLength;
    const lineY = line.y;
    

    
    // Check if line is visible in the camera view (world space culling)
    const cullMargin = 800;
    const cameraLeft = cameraX - canvasWidth / 2 - cullMargin;
    const cameraRight = cameraX + canvasWidth / 2 + cullMargin;
    const cameraTop = cameraY - canvasHeight / 2 - cullMargin;
    const cameraBottom = cameraY + canvasHeight / 2 + cullMargin;
    
    if (lineEndX < cameraLeft || lineStartX > cameraRight || 
        lineY < cameraTop || lineY > cameraBottom) {
      return; // Skip this line
    }
    
    // Create subtle glow effect by drawing the line multiple times
    const glowPasses = [
      { color: WATER_CONFIG.WATER_LINE_GLOW_COLOR, width: line.thickness + 2, alpha: line.opacity * 0.3 },
      { color: WATER_CONFIG.WATER_LINE_COLOR, width: line.thickness, alpha: line.opacity }
    ];
    
    glowPasses.forEach(pass => {
      ctx.strokeStyle = pass.color;
      ctx.globalAlpha = pass.alpha;
      ctx.lineWidth = pass.width;
      
      // Draw the horizontal water line in world coordinates
      ctx.beginPath();
      ctx.moveTo(lineStartX, lineY);
      ctx.lineTo(lineEndX, lineY);
      ctx.stroke();
    });
  });
  
  ctx.restore();
}

/**
 * Main water overlay rendering function to be called from the game loop
 */
export function renderWaterOverlay(
  ctx: CanvasRenderingContext2D,
  cameraX: number,
  cameraY: number,
  canvasWidth: number,
  canvasHeight: number,
  deltaTime: number, // in seconds
  worldTiles?: Map<string, any> // World tiles data for water detection
): void {
  // Update water system with worldTiles
  updateWaterLines(deltaTime, cameraX, cameraY, canvasWidth, canvasHeight, worldTiles || null);
  
  // Render water lines
  renderWaterLines(ctx, cameraX, cameraY, canvasWidth, canvasHeight);
}

/**
 * Clears all water lines (useful for immediate scene changes)
 */
export function clearWaterOverlay(): void {
  waterSystem.lines = [];
}

/**
 * Gets current water line count (for debugging)
 */
export function getWaterLineCount(): number {
  return waterSystem.lines.length;
}

/**
 * Sets water overlay intensity (for future use with dynamic water effects)
 */
export function setWaterOverlayIntensity(intensity: number): void {
  // Clamp intensity between 0 and 1
  const clampedIntensity = Math.max(0, Math.min(1, intensity));
  
  // Adjust line density based on intensity
  // This could be expanded to modify other properties like opacity, oscillation speed, etc.
  waterSystem.lines.forEach(line => {
    line.opacity = (WATER_CONFIG.MIN_OPACITY + 
      (WATER_CONFIG.MAX_OPACITY - WATER_CONFIG.MIN_OPACITY) * clampedIntensity) * 
      (0.8 + Math.random() * 0.4); // Add some variation
  });
} 