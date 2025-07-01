import { TILE_SIZE } from '../../config/gameConfig';

/**
 * Water Overlay Rendering Utilities
 * 
 * Renders bright teal horizontal lines that oscillate up and down to simulate
 * water surface reflections and light patterns on water tiles.
 */

interface WaterLine {
  startX: number; // Starting point of the line
  y: number; // Base Y position (wave movement will be added to this)
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
  wavePhase: number; // Phase offset for wave movement (matches sea stack system)
  shimmerPhase: number; // Phase offset for shimmer intensity
}

interface WaterOverlayState {
  lines: WaterLine[];
  lastUpdate: number;
  globalPhaseOffset: number;
  worldTiles: Map<string, any> | null;
}

// Water overlay configuration constants - synchronized with sea stack water effects
const WATER_CONFIG = {
  // Line density - very subtle for cozy atmosphere
  LINES_PER_SCREEN_AREA: 0.3, // Further reduced for more atmospheric feel
  
  // Line properties - match sea stack visibility
  MIN_LENGTH: 12,   // Longer for better wave visibility
  MAX_LENGTH: 40,  // Longer lines for better wave effect
  MIN_OPACITY: 0.4, // Much more visible like sea stacks
  MAX_OPACITY: 0.7,  // Strong opacity like sea stacks
  MIN_THICKNESS: 1,
  MAX_THICKNESS: 1.5, // Slight thickness variation
  
  // Growth animation properties - much slower for cozy feel
  MIN_GROWTH_SPEED: 1.5, // Much slower growth
  MAX_GROWTH_SPEED: 4.0, // Much slower growth
  GROWTH_DURATION: 0.4, // Longer growth phase for smoother appearance
  
  // Line lifetime properties - longer lasting for atmospheric feel
  MIN_LIFETIME: 2.0, // Much longer lifetime
  MAX_LIFETIME: 4.0, // Longer maximum lifetime
  FADE_DURATION: 1.0, // Slower, gentler fade
  
  // Wave movement properties - synchronized with sea stacks
  WAVE_AMPLITUDE: 1.5, // Match sea stack amplitude
  WAVE_FREQUENCY: 0.0008, // Match sea stack frequency for consistency
  SHIMMER_FREQUENCY: 0.002, // Match sea stack shimmer frequency
  
  // Visual variety for natural look
  MAX_ANGLE_DEVIATION: 0.05, // Less rotation for cleaner horizontal lines
  FLICKER_SPEED: 0.8, // Slower, more gentle opacity variation
  
  // Multi-line cluster properties
  MIN_LINES_PER_GROUP: 1,
  MAX_LINES_PER_GROUP: 2,
  LINE_SPACING: 2, // Slightly more spacing for cleaner look
  HORIZONTAL_OFFSET_RANGE: 8,
  
  // Visual properties - match sea stack water colors for consistency
  WATER_LINE_COLOR: 'rgba(100, 200, 255, 0.8)', // Light blue matching sea stacks
  WATER_LINE_GLOW_COLOR: 'rgba(150, 220, 255, 0.3)', // Subtle blue glow
  
  // Screen margins
  SPAWN_MARGIN: 800,
  
  // Global wave effect - match sea stack speed for consistency
  GLOBAL_WAVE_SPEED: 0.0008, // Match sea stack wave frequency
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
  
  // Randomly determine how many lines in this group (1 to 2)
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
      wavePhase: Math.random() * Math.PI * 2, // Random wave phase offset for natural variation
      shimmerPhase: Math.random() * Math.PI * 2, // Random shimmer phase offset
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
 * Renders water lines on the canvas with wave movement and shimmer effects
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
  
  const currentTime = Date.now();
  
  // Render lines with wave movement and glow effect
  waterSystem.lines.forEach((line, index) => {
    // Calculate base wave movement (synchronized with sea stacks)
    const baseWaveOffset = Math.sin(currentTime * WATER_CONFIG.WAVE_FREQUENCY + line.wavePhase + line.startX * 0.01) * WATER_CONFIG.WAVE_AMPLITUDE;
    
    // Calculate shimmer intensity (synchronized with sea stacks)
    const shimmerIntensity = (Math.sin(currentTime * WATER_CONFIG.SHIMMER_FREQUENCY + line.shimmerPhase) + 1) * 0.5;
    
    // In world space, calculate line positions
    const lineStartX = line.startX;
    const lineEndX = line.startX + line.currentLength;
    const baseY = line.y;
    
    // Check if line is visible in the camera view (world space culling)
    const cullMargin = 800;
    const cameraLeft = cameraX - canvasWidth / 2 - cullMargin;
    const cameraRight = cameraX + canvasWidth / 2 + cullMargin;
    const cameraTop = cameraY - canvasHeight / 2 - cullMargin;
    const cameraBottom = cameraY + canvasHeight / 2 + cullMargin;
    
    if (lineEndX < cameraLeft || lineStartX > cameraRight || 
        baseY < cameraTop - 10 || baseY > cameraBottom + 10) {
      return; // Skip this line
    }
    
    // Create wavy line points (exactly like sea stacks)
    const wavePoints: Array<{x: number, y: number}> = [];
    const pointSpacing = 4; // Distance between wave points
    const numPoints = Math.floor(line.currentLength / pointSpacing) + 1;
    
    for (let i = 0; i < numPoints; i++) {
      const x = lineStartX + (i * pointSpacing);
      if (x > lineEndX) break;
      
      // Apply wave exactly like sea stacks: baseWaveOffset + local variation
      const localWaveOffset = baseWaveOffset + Math.sin(currentTime * WATER_CONFIG.WAVE_FREQUENCY * 3 + i * 0.3) * 1;
      const y = baseY + localWaveOffset;
      
      wavePoints.push({x, y});
    }
    
    // Ensure we have the end point
    if (wavePoints.length > 0 && wavePoints[wavePoints.length - 1].x < lineEndX) {
      const lastIndex = wavePoints.length;
      const localWaveOffset = baseWaveOffset + Math.sin(currentTime * WATER_CONFIG.WAVE_FREQUENCY * 3 + lastIndex * 0.3) * 1;
      wavePoints.push({x: lineEndX, y: baseY + localWaveOffset});
    }
    
    // Create glow effect (like sea stacks)
    const glowPasses = [
      { 
        color: WATER_CONFIG.WATER_LINE_GLOW_COLOR, 
        width: line.thickness + 1, 
        alpha: line.opacity * 0.3 
      },
      { 
        color: WATER_CONFIG.WATER_LINE_COLOR, 
        width: line.thickness, 
        alpha: line.opacity * (0.6 + shimmerIntensity * 0.3) 
      }
    ];
    
    // Add shimmer highlights (like sea stacks)
    if (shimmerIntensity > 0.7) {
      glowPasses.push({
        color: 'rgba(255, 255, 255, ' + ((shimmerIntensity - 0.7) * 2) + ')',
        width: 1,
        alpha: 1
      });
    }
    
    glowPasses.forEach(pass => {
      ctx.strokeStyle = pass.color;
      ctx.globalAlpha = pass.alpha;
      ctx.lineWidth = pass.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      
      // Draw the wavy line following the points (exactly like sea stacks)
      ctx.beginPath();
      wavePoints.forEach((point, index) => {
        if (index === 0) {
          ctx.moveTo(point.x, point.y);
        } else {
          ctx.lineTo(point.x, point.y);
        }
      });
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
  
  // Render water lines with consistent timing
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