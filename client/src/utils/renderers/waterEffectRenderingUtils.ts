/**
 * Water Effect Rendering Utilities
 * 
 * Renders animated water lines that appear over water tiles (Sea type).
 * Lines move up and down to create a dynamic water surface effect.
 * Only renders over water tiles and stays stationary relative to the world.
 */

import { WorldTile } from '../../generated/world_tile_type';
import { gameConfig } from '../../config/gameConfig';

interface WaterLine {
  x: number;
  y: number;
  length: number;
  opacity: number;
  speed: number;
  amplitude: number;
  phase: number;
  baseX: number;
}

interface WaterEffectState {
  lines: WaterLine[];
  lastUpdate: number;
  lastRegenerate: number;
  animationTime: number;
  lastCameraX: number;
  lastCameraY: number;
}

// Water effect configuration constants
const WATER_CONFIG = {
  // Line density and spawning (reduced since we generate for entire world)
  LINES_PER_TILE: 1, // Only 1 line per water tile for performance
  LINE_SPACING: 16, // Larger spacing between lines
  
  // Line visual properties
  MIN_LENGTH: 8,
  MAX_LENGTH: 32,
  MIN_OPACITY: 0.3,
  MAX_OPACITY: 0.8,
  LINE_WIDTH: 1,
  
  // Animation properties
  MIN_SPEED: 0.001, // Horizontal movement speed multiplier (slower for subtle effect)
  MAX_SPEED: 0.003,
  MIN_AMPLITUDE: 1, // Horizontal movement amplitude in pixels
  MAX_AMPLITUDE: 3,
  
  // Water line color
  WATER_LINE_COLOR: '#4AB7B4',
  
  // Performance settings
  UPDATE_THRESHOLD: 200, // Much larger threshold - only regenerate when camera moves very far
  MAX_LINES: 5000, // Higher limit since we generate for entire world but fewer per tile
  REGENERATE_INTERVAL: 10000, // Regenerate lines every 10 seconds regardless of camera
  
  // Tile detection
  TILE_SIZE: gameConfig.tileSize, // Use actual game config tile size
};

let waterEffectState: WaterEffectState = {
  lines: [],
  lastUpdate: 0,
  lastRegenerate: 0,
  animationTime: 0,
  lastCameraX: 0,
  lastCameraY: 0,
};

/**
 * Converts world pixel coordinates to tile coordinates (same logic as server)
 */
function worldPosToTileCoords(worldPixelX: number, worldPixelY: number): { tileX: number; tileY: number } {
  const tileX = Math.floor(worldPixelX / WATER_CONFIG.TILE_SIZE);
  const tileY = Math.floor(worldPixelY / WATER_CONFIG.TILE_SIZE);
  return { tileX, tileY };
}

/**
 * Checks if a pixel position is on a water tile (mirrors server logic)
 */
function isPixelOnWater(worldTiles: Map<string, WorldTile>, worldPixelX: number, worldPixelY: number): boolean {
  // Convert pixel position to tile coordinates (same as server)
  const { tileX, tileY } = worldPosToTileCoords(worldPixelX, worldPixelY);
  
  // Look up tile by tile coordinates (same key format as server)
  const tileKey = `${tileX}_${tileY}`;
  const tile = worldTiles.get(tileKey);
  
  return tile?.tileType.tag === 'Sea';
}

/**
 * Creates a new water line with random properties
 */
function createWaterLine(
  baseX: number,
  baseY: number,
  tileX: number,
  tileY: number
): WaterLine {
  // Random position within the tile
  const offsetX = Math.random() * WATER_CONFIG.TILE_SIZE;
  const offsetY = Math.random() * WATER_CONFIG.TILE_SIZE;
  
  const x = tileX * WATER_CONFIG.TILE_SIZE + offsetX;
  const y = tileY * WATER_CONFIG.TILE_SIZE + offsetY;
  
  // Random line properties
  const length = WATER_CONFIG.MIN_LENGTH + Math.random() * (WATER_CONFIG.MAX_LENGTH - WATER_CONFIG.MIN_LENGTH);
  const opacity = WATER_CONFIG.MIN_OPACITY + Math.random() * (WATER_CONFIG.MAX_OPACITY - WATER_CONFIG.MIN_OPACITY);
  const speed = WATER_CONFIG.MIN_SPEED + Math.random() * (WATER_CONFIG.MAX_SPEED - WATER_CONFIG.MIN_SPEED);
  const amplitude = WATER_CONFIG.MIN_AMPLITUDE + Math.random() * (WATER_CONFIG.MAX_AMPLITUDE - WATER_CONFIG.MIN_AMPLITUDE);
  const phase = Math.random() * Math.PI * 2; // Random starting phase
  
  return {
    x,
    y,
    length,
    opacity,
    speed,
    amplitude,
    phase,
    baseX: x,
  };
}

/**
 * Updates water lines for the visible area around the camera
 */
function updateWaterLines(
  cameraX: number,
  cameraY: number,
  canvasWidth: number,
  canvasHeight: number,
  worldTiles: Map<string, WorldTile>,
  deltaTime: number
): void {
  const currentTime = performance.now();
  waterEffectState.animationTime += deltaTime;
  
  // Only regenerate on first load - never regenerate based on camera movement
  const needsInitialGeneration = waterEffectState.lines.length === 0;
  
  if (needsInitialGeneration) {
    // Clear existing lines
    waterEffectState.lines = [];
    
    // Generate lines by testing pixel positions across the visible world area (server-style)
    let linesGenerated = 0;
    let pixelsChecked = 0;
    let waterPixelsFound = 0;
    
    console.log('[WaterEffect] Starting generation using pixel-based water detection...');
    
    // Calculate world bounds (generate for entire world, not just visible area)
    const worldWidthPx = 500 * WATER_CONFIG.TILE_SIZE; // 500 tiles wide
    const worldHeightPx = 500 * WATER_CONFIG.TILE_SIZE; // 500 tiles tall
    
    // Generate test points across the world at tile intervals
    const step = WATER_CONFIG.TILE_SIZE; // Test at tile boundaries
    
    for (let worldY = 0; worldY < worldHeightPx; worldY += step) {
      for (let worldX = 0; worldX < worldWidthPx; worldX += step) {
        pixelsChecked++;
        
        // Use server-style water detection
        if (isPixelOnWater(worldTiles, worldX, worldY)) {
          waterPixelsFound++;
          
          // Generate lines within this water tile
          const lineCount = WATER_CONFIG.LINES_PER_TILE;
          
          for (let i = 0; i < lineCount; i++) {
            if (waterEffectState.lines.length < WATER_CONFIG.MAX_LINES) {
              // Convert to tile coordinates for createWaterLine
              const { tileX, tileY } = worldPosToTileCoords(worldX, worldY);
              
              const line = createWaterLine(
                worldX,
                worldY,
                tileX,
                tileY
              );
              waterEffectState.lines.push(line);
              linesGenerated++;
            }
          }
        }
      }
    }
    
    console.log('[WaterEffect] Initial generation complete:', {
      linesGenerated,
      waterPixelsFound,
      pixelsChecked,
      totalLines: waterEffectState.lines.length
    });
    
    // Only update these once, never again
    waterEffectState.lastCameraX = cameraX;
    waterEffectState.lastCameraY = cameraY;
    waterEffectState.lastRegenerate = currentTime;
  }
  
  // Update line positions (horizontal oscillation) - always animate, independent of regeneration
  const animationTime = performance.now();
  waterEffectState.lines.forEach(line => {
    const oscillation = Math.sin(animationTime * line.speed + line.phase) * line.amplitude;
    line.x = line.baseX + oscillation;
  });
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
  if (waterEffectState.lines.length === 0) return;
  
  ctx.save();
  
  // Set line properties
  ctx.strokeStyle = WATER_CONFIG.WATER_LINE_COLOR;
  ctx.lineWidth = WATER_CONFIG.LINE_WIDTH;
  ctx.lineCap = 'round';
  
  // Calculate screen center
  const screenCenterX = canvasWidth / 2;
  const screenCenterY = canvasHeight / 2;
  
  // Render each line
  let renderedCount = 0;
  waterEffectState.lines.forEach(line => {
    // Convert world coordinates to screen coordinates
    const screenX = screenCenterX + (line.x - cameraX);
    const screenY = screenCenterY + (line.y - cameraY);
    
    // Only render lines that are visible on screen (accounting for horizontal lines)
    const margin = 50;
    if (screenX < -margin - line.length || screenX > canvasWidth + margin || 
        screenY < -margin || screenY > canvasHeight + margin) {
      return; // Skip this line
    }
    
    renderedCount++;
    
    // Set opacity for this line
    ctx.globalAlpha = line.opacity;
    
    // Draw the water line as a horizontal line
    ctx.beginPath();
    ctx.moveTo(screenX, screenY);
    ctx.lineTo(screenX + line.length, screenY);
    ctx.stroke();
  });
  
  // No frequent logging - water effect is now static
  
  ctx.restore();
}

/**
 * Main water effect rendering function to be called from the game loop
 */
export function renderWaterEffect(
  ctx: CanvasRenderingContext2D,
  cameraX: number,
  cameraY: number,
  canvasWidth: number,
  canvasHeight: number,
  worldTiles: Map<string, WorldTile>,
  deltaTime: number // in seconds
): void {
  // Only log if we have no lines and there are tiles to process
  if (waterEffectState.lines.length === 0 && worldTiles.size > 0) {
    console.log('[WaterEffect] No lines exist yet. Will generate for', worldTiles.size, 'tiles');
  }
  
  // Update water lines
  updateWaterLines(cameraX, cameraY, canvasWidth, canvasHeight, worldTiles, deltaTime);
  
  // Render water lines
  renderWaterLines(ctx, cameraX, cameraY, canvasWidth, canvasHeight);
}

/**
 * Clears all water lines (useful for immediate updates)
 */
export function clearWaterEffect(): void {
  waterEffectState.lines = [];
  console.log('[WaterEffect] Cleared all water lines');
}

/**
 * Forces regeneration of water lines (useful for debugging/resetting)
 */
export function forceRegenerateWaterEffect(): void {
  waterEffectState.lines = [];
  waterEffectState.lastRegenerate = 0;
  console.log('[WaterEffect] Forced regeneration - lines will regenerate on next render');
}

/**
 * Gets current water line count (for debugging)
 */
export function getWaterLineCount(): number {
  return waterEffectState.lines.length;
} 