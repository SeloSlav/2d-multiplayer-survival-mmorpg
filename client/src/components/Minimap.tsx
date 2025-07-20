import { gameConfig } from '../config/gameConfig';
import { Player as SpacetimeDBPlayer, Tree, Stone as SpacetimeDBStone, Barrel as SpacetimeDBBarrel, PlayerPin, SleepingBag as SpacetimeDBSleepingBag, Campfire as SpacetimeDBCampfire, PlayerCorpse as SpacetimeDBCorpse, WorldState, DeathMarker as SpacetimeDBDeathMarker, MinimapCache } from '../generated';
import { useRef, useCallback } from 'react';

// --- Calculate Proportional Dimensions ---
const worldPixelWidth = gameConfig.worldWidth * gameConfig.tileSize;
const worldPixelHeight = gameConfig.worldHeight * gameConfig.tileSize;
const worldAspectRatio = worldPixelHeight / worldPixelWidth;

const BASE_MINIMAP_WIDTH = 600; // Base width for calculation
const calculatedMinimapHeight = BASE_MINIMAP_WIDTH * worldAspectRatio;

// Minimap constants - UPDATED TO CYBERPUNK THEME
const MINIMAP_WIDTH = BASE_MINIMAP_WIDTH;
const MINIMAP_HEIGHT = Math.round(calculatedMinimapHeight); // Use calculated height

// Cyberpunk color scheme
const MINIMAP_BG_COLOR_NORMAL = 'rgba(15, 23, 35, 0.95)'; // Dark blue-black
const MINIMAP_BG_COLOR_HOVER = 'rgba(20, 30, 45, 0.98)'; // Slightly lighter on hover
const MINIMAP_BORDER_COLOR = '#00d4ff'; // Bright cyan border
const MINIMAP_BORDER_WIDTH = 2;
const MINIMAP_INNER_BORDER_COLOR = '#7c3aed'; // Purple inner border
const MINIMAP_INNER_BORDER_WIDTH = 1;
const MINIMAP_GLOW_COLOR = '#00d4ff'; // Cyan glow effect

// Tab and X button functionality now handled by React components
const PLAYER_DOT_SIZE = 3;
const LOCAL_PLAYER_DOT_COLOR = '#FFFF00';
// Player icon constants - Updated for directional triangular icons
const PLAYER_ICON_SIZE = 12; // Much larger than tree/stone icons (which are 4px)
const PLAYER_ICON_OUTLINE_COLOR = '#333333'; // Dark grey outline for visibility
const PLAYER_ICON_OUTLINE_WIDTH = 2; // Thicker outline for better visibility
const REMOTE_PLAYER_DOT_COLOR = '#00AAFF'; // Light blue for other players
// Add colors for trees and rocks - UPDATED to be much darker and more visible
const TREE_DOT_COLOR = '#37ff7a'; // Bright emerald green with excellent visibility
const ROCK_DOT_COLOR = '#bbbbff'; // Light slate blue for rocks
const BARREL_DOT_COLOR = '#ff4444'; // Bright red for barrels - high visibility

const RESOURCE_ICON_OUTLINE_COLOR = '#000000'; // Black outline for resource icons
const RESOURCE_ICON_OUTLINE_WIDTH = 1; // 1-pixel outline width
const CAMPFIRE_DOT_COLOR = '#FF6600'; // Bright orange for campfires and lit players
const CAMPFIRE_GLOW_COLOR = '#FF8800'; // Orange glow effect
const CAMPFIRE_ICON_SIZE = 8; // Larger size for better visibility
const SLEEPING_BAG_DOT_COLOR = '#A0522D'; // Sienna (brownish)
// Water tile rendering on minimap
const WATER_TILE_COLOR = '#1E90FF'; // Bright blue for water features
const BEACH_TILE_COLOR = '#F4A460'; // Sandy beach color
const DIRT_ROAD_COLOR = '#8B7355'; // Brown for dirt roads
const DIRT_COLOR = '#8B4513'; // Slightly lighter brown for regular dirt
const ENTITY_DOT_SIZE = 2; // Slightly smaller dot size for world objects
const LIT_ENTITY_DOT_SIZE = 4; // Larger size for lit campfires and players with torches
const OWNED_BAG_DOT_SIZE = 24; // Make owned bags larger
const REGULAR_BAG_ICON_SIZE = 24; // Increased size considerably
const REGULAR_BAG_BORDER_WIDTH = 2;
const REGULAR_BAG_BORDER_COLOR = '#FFFFFF'; // White border for regular bags
const REGULAR_BAG_BG_COLOR = 'rgba(0, 0, 0, 0.3)'; // Slightly transparent black bg
// Unused constants removed
const MINIMAP_WORLD_BG_COLOR = 'rgba(52, 88, 52, 0.2)';
const OUT_OF_BOUNDS_COLOR = 'rgba(20, 35, 20, 0.2)'; // Darker shade for outside world bounds

// Updated pin styling - Simple classic design
const PIN_COLOR = '#FFD700'; // Bright yellow for pin body
const PIN_BORDER_COLOR = '#000000'; // Black border
const PIN_SIZE = 24; // Standard size
const PIN_BORDER_WIDTH = 1; // Thin border width

// Grid Constants - Divisions will be calculated dynamically
const GRID_LINE_COLOR = 'rgba(200, 200, 200, 0.3)';
const GRID_TEXT_COLOR = 'rgba(255, 255, 255, 0.5)';
const GRID_TEXT_FONT = '10px Arial';

// Death Marker Constants (New)
const DEATH_MARKER_ICON_SIZE = 24;
const DEATH_MARKER_BORDER_WIDTH = 2;
const DEATH_MARKER_BORDER_COLOR = '#FFFFFF'; // White border, same as regular bags
const DEATH_MARKER_BG_COLOR = 'rgba(139, 0, 0, 0.5)'; // Dark red, semi-transparent

// Opacity animation constants
const OPACITY_TRANSITION_SPEED = 0.08; // Higher = faster transition
const OPACITY_HIDDEN = 0.5; // 30% opacity when not hovered
const OPACITY_VISIBLE = 1.0; // 100% opacity when hovered

// Global ref to track animated opacity (shared across all minimap instances)
let animatedOpacity = OPACITY_HIDDEN;
let targetOpacity = OPACITY_HIDDEN;
let animationFrameId: number | null = null;

// Function to smoothly animate opacity
const animateOpacity = () => {
  const diff = targetOpacity - animatedOpacity;
  if (Math.abs(diff) > 0.01) {
    animatedOpacity += diff * OPACITY_TRANSITION_SPEED;
    animationFrameId = requestAnimationFrame(animateOpacity);
  } else {
    animatedOpacity = targetOpacity;
    animationFrameId = null;
  }
};

// Function to set target opacity and start animation if needed
const setTargetOpacity = (newTarget: number) => {
  targetOpacity = newTarget;
  if (animationFrameId === null && Math.abs(targetOpacity - animatedOpacity) > 0.01) {
    animateOpacity();
  }
};

// Add helper to check if it's night/evening
function isNightTimeOfDay(tag: string): boolean {
  return (
    tag === 'Dusk' ||
    tag === 'TwilightEvening' ||
    tag === 'Night' ||
    tag === 'Midnight'
  );
}

// Helper function to draw a directional triangular player icon
function drawPlayerIcon(
  ctx: CanvasRenderingContext2D, 
  x: number, 
  y: number, 
  rotation: number, 
  fillColor: string, 
  size: number = PLAYER_ICON_SIZE
) {
  ctx.save();
  
  // Move to the player position and rotate
  ctx.translate(x, y);
  ctx.rotate(rotation);
  
  const halfSize = size / 2;
  const cornerRadius = size * 0.15; // Small corner radius for slight rounding
  
  // Draw the triangular caret pointing right (will be rotated to correct direction)
  ctx.beginPath();
  
  // Start at the tip (right point)
  ctx.moveTo(halfSize, 0);
  
  // Draw to bottom-left with slight rounding
  ctx.lineTo(-halfSize * 0.6, halfSize * 0.8);
  ctx.arcTo(-halfSize, halfSize * 0.8, -halfSize, 0, cornerRadius);
  
  // Draw to top-left with slight rounding  
  ctx.lineTo(-halfSize, -halfSize * 0.8);
  ctx.arcTo(-halfSize * 0.6, -halfSize * 0.8, halfSize, 0, cornerRadius);
  
  ctx.closePath();
  
  // Draw outline first
  ctx.strokeStyle = PLAYER_ICON_OUTLINE_COLOR;
  ctx.lineWidth = PLAYER_ICON_OUTLINE_WIDTH;
  ctx.stroke();
  
  // Fill with player color
  ctx.fillStyle = fillColor;
  ctx.fill();
  
  ctx.restore();
}

// Props required for drawing the minimap
interface MinimapProps {
  ctx: CanvasRenderingContext2D;
  players: Map<string, SpacetimeDBPlayer>; // Map of player identities to player data
  trees: Map<string, Tree>; // Map of tree identities/keys to tree data
  stones: Map<string, SpacetimeDBStone>; // Add stones
  barrels: Map<string, SpacetimeDBBarrel>; // Add barrels
  campfires: Map<string, SpacetimeDBCampfire>; // Add campfires
  sleepingBags: Map<string, SpacetimeDBSleepingBag>; // Add sleeping bags

  localPlayer: SpacetimeDBPlayer | undefined; // Extracted local player
  localPlayerId?: string;
  viewCenterOffset: { x: number; y: number }; // pan offset
  playerPin: PlayerPin | null; // Player pin
  canvasWidth: number; // Canvas width for calculating minimap position
  canvasHeight: number; // Canvas height for calculating minimap position
  isMouseOverMinimap: boolean; // Whether the mouse is over the minimap
  zoomLevel: number; // Zoom level for minimap
  minimapCache: MinimapCache | null; // Cached minimap data
  // Add new props with defaults
  isDeathScreen?: boolean; // Whether this is being rendered in the death screen
  ownedSleepingBagIds?: Set<number>; // IDs of sleeping bags owned by the player
  onSelectSleepingBag?: (bagId: number) => void; // Callback when a sleeping bag is selected
  sleepingBagImage?: HTMLImageElement | null; // Sleeping bag image for rendering
  // Add new death marker props
  localPlayerDeathMarker?: SpacetimeDBDeathMarker | null; // Death marker for the local player
  deathMarkerImage?: HTMLImageElement | null; // Death marker image for rendering
  worldState?: WorldState | null; // World state for various info
  // Add pin marker image prop
  pinMarkerImage?: HTMLImageElement | null; // Pin marker image for rendering
  // Add campfire and torch image props
  campfireWarmthImage?: HTMLImageElement | null; // Warmth image for campfires
  torchOnImage?: HTMLImageElement | null; // Torch image for torch-lit players
  // Tab functionality now handled by React components
}

// Helper function to map color values to terrain colors (UPDATED with Rust-style colors)
function getTerrainColor(colorValue: number): [number, number, number] {
  switch (colorValue) {
    case 0:   // Sea - Darker, more realistic ocean blue
      return [19, 69, 139]; // Dark blue like Rust's ocean
    case 64:  // Beach - More muted sandy color
      return [194, 154, 108]; // Muted sand brown
    case 96:  // Sand - Slightly different from beach
      return [180, 142, 101]; // Darker sand
    case 128: // Grass - More realistic forest green  
      return [76, 110, 72]; // Muted forest green like Rust
    case 192: // Dirt - Realistic brown dirt
      return [101, 67, 33]; // Dark brown dirt
    case 224: // DirtRoad - Even darker brown for roads
      return [71, 47, 24]; // Very dark brown roads
    default:  // Fallback for unknown values
      return [76, 110, 72]; // Default to grass green
  }
}

/**
 * Draws the minimap overlay onto the provided canvas context.
 */
export function drawMinimapOntoCanvas({
  ctx,
  players,
  trees,
  stones,
  barrels,
  campfires,
  sleepingBags,

  localPlayer, // Destructure localPlayer
  localPlayerId,
  playerPin, // Destructure playerPin
  canvasWidth,
  canvasHeight,
  isMouseOverMinimap,
  // isMouseOverXButton removed - X button now handled by React components
  zoomLevel, // Destructure zoomLevel
  viewCenterOffset, // Destructure pan offset
  minimapCache, // Destructure minimapCache
  // Destructure new props with defaults
  isDeathScreen = false,
  ownedSleepingBagIds = new Set(),
  onSelectSleepingBag, // Callback is optional, only needed if interactive
  sleepingBagImage = null, // Default to null
  // Destructure new death marker props
  localPlayerDeathMarker = null,
  deathMarkerImage = null,
  worldState, // <-- Add this
  // Destructure pin marker image prop
  pinMarkerImage = null, // Default to null
  // Destructure campfire and torch image props
  campfireWarmthImage = null, // Default to null
  torchOnImage = null, // Default to null
}: MinimapProps) {
  const minimapWidth = MINIMAP_WIDTH;
  const minimapHeight = MINIMAP_HEIGHT;
  
  // Log the received localPlayerDeathMarker prop at the beginning of the function
  // console.log('[Minimap.tsx] drawMinimapOntoCanvas called. Received localPlayerDeathMarker:', JSON.stringify(localPlayerDeathMarker, (key, value) => typeof value === 'bigint' ? value.toString() : value));

  // Calculate top-left corner for centering the minimap UI element
  const minimapX = (canvasWidth - minimapWidth) / 2;
  const minimapY = (canvasHeight - minimapHeight) / 2;
  
  // DEBUG: Log drawing coordinate calculation values (commented out for performance)
  // console.log(`[Minimap] Drawing coordinate calculation:
  //   canvasSize: ${canvasWidth}x${canvasHeight}
  //   minimapSize: ${minimapWidth}x${minimapHeight}
  //   minimapPos: (${minimapX}, ${minimapY})`);

  // --- Calculate Base Scale (Zoom Level 1) ---
  const worldPixelWidth = gameConfig.worldWidth * gameConfig.tileSize;
  const worldPixelHeight = gameConfig.worldHeight * gameConfig.tileSize;
  const baseScaleX = minimapWidth / worldPixelWidth;
  const baseScaleY = minimapHeight / worldPixelHeight;
  const baseUniformScale = Math.min(baseScaleX, baseScaleY);

  // --- Calculate Current Scale based on Zoom ---
  const currentScale = baseUniformScale * zoomLevel;

  // --- Calculate Final View Center (incorporating pan offset) ---
  let viewCenterXWorld: number;
  let viewCenterYWorld: number;

  if (zoomLevel <= 1 || !localPlayer) {
    // At zoom 1 or if no local player, center on the world center
    viewCenterXWorld = worldPixelWidth / 2;
    viewCenterYWorld = worldPixelHeight / 2;
  } else {
    // When zoomed in, center on the local player
    viewCenterXWorld = localPlayer.positionX + viewCenterOffset.x; // Add offset
    viewCenterYWorld = localPlayer.positionY + viewCenterOffset.y; // Add offset
  }

  // Calculate the top-left world coordinate visible at the current zoom and center
  const viewWidthWorld = minimapWidth / currentScale;
  const viewHeightWorld = minimapHeight / currentScale;
  const viewMinXWorld = viewCenterXWorld - viewWidthWorld / 2;
  const viewMinYWorld = viewCenterYWorld - viewHeightWorld / 2;

  // The drawing offset needs to map the calculated viewMinX/YWorld to the minimapX/Y screen coordinates
  const drawOffsetX = minimapX - viewMinXWorld * currentScale;
  const drawOffsetY = minimapY - viewMinYWorld * currentScale;

  // Helper function to convert world coords to minimap screen coords
  const worldToMinimap = (worldX: number, worldY: number): { x: number; y: number } | null => {
    const screenX = drawOffsetX + worldX * currentScale;
    const screenY = drawOffsetY + worldY * currentScale;
    // Basic check if within minimap bounds (can be more precise)
    if (screenX >= minimapX && screenX <= minimapX + minimapWidth &&
        screenY >= minimapY && screenY <= minimapY + minimapHeight) {
      return { x: screenX, y: screenY };
    } else {
      return null; // Off the minimap at current zoom/pan
    }
  };

  // Determine if it's night/evening for minimap light rendering
  const timeOfDayTag = worldState?.timeOfDay?.tag;
  const showNightLights = timeOfDayTag ? isNightTimeOfDay(timeOfDayTag) : false;

  // --- Apply Retro Styling --- 
  ctx.save(); // Save context before applying shadow/styles

  // --- Apply Smooth Animated Transparency Based on Hover State ---
  // Set target opacity based on hover state
  setTargetOpacity(isMouseOverMinimap ? OPACITY_VISIBLE : OPACITY_HIDDEN);
  
  // Apply current animated opacity (smoothly transitioning)
  ctx.globalAlpha = animatedOpacity;

  // Apply cyberpunk glow shadow effect
  const shadowOffset = 4;
  ctx.shadowColor = MINIMAP_GLOW_COLOR;
  ctx.shadowBlur = 12;
  ctx.fillStyle = 'rgba(0,0,0,0.8)';
  ctx.fillRect(minimapX + shadowOffset, minimapY + shadowOffset, minimapWidth, minimapHeight);
  ctx.shadowBlur = 0; // Reset shadow

  // 1. Draw Overall Minimap Background with cyberpunk gradient
  const bgGradient = ctx.createLinearGradient(minimapX, minimapY, minimapX + minimapWidth, minimapY + minimapHeight);
  bgGradient.addColorStop(0, isMouseOverMinimap ? MINIMAP_BG_COLOR_HOVER : MINIMAP_BG_COLOR_NORMAL);
  bgGradient.addColorStop(1, 'rgba(30, 41, 59, 0.95)'); // Darker blue-slate at bottom
  ctx.fillStyle = bgGradient;
  ctx.fillRect(minimapX, minimapY, minimapWidth, minimapHeight);

  // Draw enhanced cyberpunk border with glow effect
  ctx.strokeStyle = MINIMAP_BORDER_COLOR;
  ctx.lineWidth = MINIMAP_BORDER_WIDTH;
  ctx.shadowColor = MINIMAP_GLOW_COLOR;
  ctx.shadowBlur = 8;
  ctx.strokeRect(minimapX, minimapY, minimapWidth, minimapHeight);
  ctx.shadowBlur = 0; // Reset shadow
  
  // Draw inner border for more definition with purple accent
  ctx.strokeStyle = MINIMAP_INNER_BORDER_COLOR;
  ctx.lineWidth = MINIMAP_INNER_BORDER_WIDTH;
  ctx.strokeRect(minimapX + MINIMAP_BORDER_WIDTH, minimapY + MINIMAP_BORDER_WIDTH, 
                 minimapWidth - MINIMAP_BORDER_WIDTH * 2, minimapHeight - MINIMAP_BORDER_WIDTH * 2);

  // Clip drawing to minimap bounds (optional, but good practice)
  ctx.beginPath();
  ctx.rect(minimapX, minimapY, minimapWidth, minimapHeight);
  ctx.clip();
  // --- End Initial Styling & Clip ---

  // 3. Draw Dark Background for the entire minimap area (including potential out-of-bounds)
  ctx.fillStyle = OUT_OF_BOUNDS_COLOR;
  ctx.fillRect(minimapX, minimapY, minimapWidth, minimapHeight);

  // Calculate the screen rectangle for the actual world bounds at current zoom/pan
  const worldRectScreenX = drawOffsetX + 0 * currentScale; // World X=0
  const worldRectScreenY = drawOffsetY + 0 * currentScale; // World Y=0
  const worldRectScreenWidth = worldPixelWidth * currentScale;
  const worldRectScreenHeight = worldPixelHeight * currentScale;

  // Draw the actual world background
  ctx.fillStyle = MINIMAP_WORLD_BG_COLOR; 
  ctx.fillRect(worldRectScreenX, worldRectScreenY, worldRectScreenWidth, worldRectScreenHeight);

  // --- Draw Cached Minimap Background ---
  if (minimapCache && minimapCache.data && minimapCache.data.length > 0) {
    // console.log(`[Minimap] Using cached minimap data: ${minimapCache.width}x${minimapCache.height}, ${minimapCache.data.length} bytes`);
    
    // Create an ImageData object from the cached minimap data
    const canvas = document.createElement('canvas');
    canvas.width = minimapCache.width;
    canvas.height = minimapCache.height;
    const tempCtx = canvas.getContext('2d');
    
    if (tempCtx) {
      const imageData = tempCtx.createImageData(minimapCache.width, minimapCache.height);
      
      // Convert color values to RGBA pixels
      for (let i = 0; i < minimapCache.data.length; i++) {
        const colorValue = minimapCache.data[i];
        const pixelIndex = i * 4;
        
        // Map color values to terrain colors
        const [r, g, b] = getTerrainColor(colorValue);
        imageData.data[pixelIndex] = r;     // Red
        imageData.data[pixelIndex + 1] = g; // Green  
        imageData.data[pixelIndex + 2] = b; // Blue
        imageData.data[pixelIndex + 3] = 255; // Alpha (fully opaque)
      }
      
      tempCtx.putImageData(imageData, 0, 0);
      
      // Calculate the world bounds within the minimap
      // The cached minimap represents the entire game world
      const worldWidthPx = gameConfig.worldWidthPx; // Derived from gameConfig
      const worldHeightPx = gameConfig.worldHeightPx; // Derived from gameConfig
      
      // Calculate where the world bounds appear in the current minimap view
      const worldRectScreenX = drawOffsetX + 0 * currentScale; // World X=0
      const worldRectScreenY = drawOffsetY + 0 * currentScale; // World Y=0
      const worldRectScreenWidth = worldPixelWidth * currentScale;
      const worldRectScreenHeight = worldPixelHeight * currentScale;
      
      // Draw the cached minimap scaled to fit the world bounds area
      ctx.drawImage(
        canvas,
        worldRectScreenX,
        worldRectScreenY, 
        worldRectScreenWidth,
        worldRectScreenHeight
      );
    }
  } else {
    // Debug: Show what we actually have
    // console.log(`[Minimap] No cached minimap data available. minimapCache:`, minimapCache);
    
    // Show a message that minimap cache is not ready
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    // ctx.fillText('Generating minimap...', minimapX + minimapWidth/2, minimapY + minimapHeight/2);
  }

  // --- Calculate Grid Divisions Dynamically (Based on current view) ---
  // Adjust grid rendering based on zoom level - maybe show finer grid when zoomed?
  // For now, keep it simple: calculate grid lines based on visible world area.
  const gridCellSizeWorld = gameConfig.minimapGridCellSizePixels > 0 ? gameConfig.minimapGridCellSizePixels : 1;

  const startGridXWorld = Math.floor(viewMinXWorld / gridCellSizeWorld) * gridCellSizeWorld;
  const endGridXWorld = Math.ceil((viewMinXWorld + viewWidthWorld) / gridCellSizeWorld) * gridCellSizeWorld;
  const startGridYWorld = Math.floor(viewMinYWorld / gridCellSizeWorld) * gridCellSizeWorld;
  const endGridYWorld = Math.ceil((viewMinYWorld + viewHeightWorld) / gridCellSizeWorld) * gridCellSizeWorld;

  // --- Draw Grid (MOVED AFTER TERRAIN) ---
  ctx.strokeStyle = GRID_LINE_COLOR;
  ctx.lineWidth = 0.5;
  ctx.fillStyle = GRID_TEXT_COLOR;
  ctx.font = GRID_TEXT_FONT;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  // Draw Vertical Lines & Labels
  for (let worldX = startGridXWorld; worldX <= endGridXWorld; worldX += gridCellSizeWorld) {
    const screenCoords = worldToMinimap(worldX, viewMinYWorld);
    if (screenCoords) {
      const screenX = screenCoords.x;
      ctx.beginPath();
      ctx.moveTo(screenX, minimapY);
      ctx.lineTo(screenX, minimapY + minimapHeight);
      ctx.stroke();
      // Optionally add world coordinate labels when zoomed
      // if (zoomLevel > 1.5) {
      //  ctx.fillText(Math.round(worldX).toString(), screenX + 2, minimapY + 2);
      // }
    }
  }

  // Draw Horizontal Lines & Labels
  for (let worldY = startGridYWorld; worldY <= endGridYWorld; worldY += gridCellSizeWorld) {
    const screenCoords = worldToMinimap(viewMinXWorld, worldY);
    if (screenCoords) {
      const screenY = screenCoords.y;
      ctx.beginPath();
      ctx.moveTo(minimapX, screenY);
      ctx.lineTo(minimapX + minimapWidth, screenY);
      ctx.stroke();
      // Optionally add world coordinate labels when zoomed
      // if (zoomLevel > 1.5) {
      //   ctx.fillText(Math.round(worldY).toString(), minimapX + 2, screenY + 2);
      // }
    }
  }

  // Draw Cell Labels (A1, B2 etc.) based on world grid cells visible
  const labelGridDivisionsX = Math.max(1, Math.round(worldPixelWidth / gridCellSizeWorld));
  const labelGridDivisionsY = Math.max(1, Math.round(worldPixelHeight / gridCellSizeWorld));

  for (let row = 0; row < labelGridDivisionsY; row++) {
    for (let col = 0; col < labelGridDivisionsX; col++) {
      // Calculate world coordinates of the top-left corner of this grid cell
      const cellWorldX = col * gridCellSizeWorld;
      const cellWorldY = row * gridCellSizeWorld;
      // Convert world corner to screen coordinates
      const screenCoords = worldToMinimap(cellWorldX, cellWorldY);
      if (screenCoords) {
          // Check if the label position is actually within the minimap bounds
          if (screenCoords.x + 2 < minimapX + minimapWidth && screenCoords.y + 12 < minimapY + minimapHeight) {
              const colLabel = String.fromCharCode(65 + col); // A, B, C...
              const rowLabel = (row + 1).toString(); // 1, 2, 3...
              const label = colLabel + rowLabel;
              ctx.fillText(label, screenCoords.x + 2, screenCoords.y + 2); // Draw label at scaled position
          }
      }
    }
  }
  // --- End Grid Drawing ---

  // --- Draw Death Marker ---
  // console.log('[Minimap] Checking for death marker. Marker data:', localPlayerDeathMarker, 'Image loaded:', deathMarkerImage && deathMarkerImage.complete && deathMarkerImage.naturalHeight !== 0, 'Image Element:', deathMarkerImage);
  if (localPlayerDeathMarker && deathMarkerImage && deathMarkerImage.complete && deathMarkerImage.naturalHeight !== 0) {
    // console.log('[Minimap] Corpse and loaded image found, attempting to draw death marker.'); // Changed 'Corpse' to 'Marker' for clarity
    const screenCoords = worldToMinimap(localPlayerDeathMarker.posX, localPlayerDeathMarker.posY);
    //console.log('[Minimap] Death marker worldPos:', { x: localPlayerDeathMarker.posX, y: localPlayerDeathMarker.posY }, 'screenCoords:', screenCoords, 'Zoom:', zoomLevel, 'Offset:', viewCenterOffset);
    if (screenCoords) {
      // console.log('[Minimap] Drawing death marker at:', screenCoords);
      const iconRadius = DEATH_MARKER_ICON_SIZE / 2;
      const iconDiameter = DEATH_MARKER_ICON_SIZE;
      const cx = screenCoords.x;
      const cy = screenCoords.y;

      ctx.save(); // Save before clipping/drawing

      // 1. Draw background circle (optional, for better visibility or style)
      ctx.fillStyle = DEATH_MARKER_BG_COLOR;
      ctx.beginPath();
      ctx.arc(cx, cy, iconRadius, 0, Math.PI * 2);
      ctx.fill();

      // 2. Clip to circle
      ctx.beginPath();
      ctx.arc(cx, cy, iconRadius, 0, Math.PI * 2);
      ctx.clip();

      // 3. Draw image centered in the circle
      ctx.drawImage(
        deathMarkerImage,
        cx - iconRadius, // Adjust x to center
        cy - iconRadius, // Adjust y to center
        iconDiameter,    // Draw at icon size
        iconDiameter
      );
      
      ctx.restore(); // Restore context after drawing image (removes clip)

      // 4. Draw border around the circle
      ctx.strokeStyle = DEATH_MARKER_BORDER_COLOR;
      ctx.lineWidth = DEATH_MARKER_BORDER_WIDTH;
      ctx.beginPath();
      ctx.arc(cx, cy, iconRadius, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // --- Draw Trees ---
  trees.forEach(tree => {
    // Only show trees that aren't destroyed or respawning
    if (tree.health <= 0 || tree.respawnAt !== undefined) return;
    
    const screenCoords = worldToMinimap(tree.posX, tree.posY);
    if (screenCoords) {
      const iconSize = ENTITY_DOT_SIZE * 2; // Make trees slightly larger for visibility
      const halfSize = iconSize / 2;
      const x = screenCoords.x;
      const y = screenCoords.y;
      
      // Draw triangular tree icon (▲)
      ctx.save();
      
      // Draw black outline first
      ctx.strokeStyle = RESOURCE_ICON_OUTLINE_COLOR;
      ctx.lineWidth = RESOURCE_ICON_OUTLINE_WIDTH;
      ctx.beginPath();
      ctx.moveTo(x, y - halfSize); // Top point
      ctx.lineTo(x - halfSize, y + halfSize); // Bottom left
      ctx.lineTo(x + halfSize, y + halfSize); // Bottom right
      ctx.closePath();
      ctx.stroke();
      
      // Fill with tree color
      ctx.fillStyle = TREE_DOT_COLOR;
      ctx.fill();
      
      ctx.restore();
    }
  });

  // --- Draw Stones ---
  stones.forEach(stone => { // Use stones prop (type SpacetimeDBStone)
    // Only show stones that aren't destroyed or respawning
    if (stone.health <= 0 || stone.respawnAt !== undefined) return;
    
    const screenCoords = worldToMinimap(stone.posX, stone.posY);
    if (screenCoords) {
      const iconSize = ENTITY_DOT_SIZE * 2; // Make stones slightly larger for visibility
      const halfSize = iconSize / 2;
      const x = screenCoords.x;
      const y = screenCoords.y;
      
      // Draw square stone icon (■)
      ctx.save();
      
      // Draw black outline first
      ctx.strokeStyle = RESOURCE_ICON_OUTLINE_COLOR;
      ctx.lineWidth = RESOURCE_ICON_OUTLINE_WIDTH;
      ctx.strokeRect(x - halfSize, y - halfSize, iconSize, iconSize);
      
      // Fill with stone color
      ctx.fillStyle = ROCK_DOT_COLOR;
      ctx.fillRect(x - halfSize, y - halfSize, iconSize, iconSize);
      
      ctx.restore();
    }
  });

  // --- Draw Barrels ---
  barrels.forEach(barrel => {
    // Only show barrels that aren't destroyed (health > 0)
    if (barrel.health <= 0) return;
    
    const screenCoords = worldToMinimap(barrel.posX, barrel.posY);
    if (screenCoords) {
      const iconSize = ENTITY_DOT_SIZE * 2; // Make barrels slightly larger for visibility
      const radius = iconSize / 2;
      const x = screenCoords.x;
      const y = screenCoords.y;
      
      // Draw circular barrel icon (●)
      ctx.save();
      
      // Draw black outline first
      ctx.strokeStyle = RESOURCE_ICON_OUTLINE_COLOR;
      ctx.lineWidth = RESOURCE_ICON_OUTLINE_WIDTH;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.stroke();
      
      // Fill with barrel color
      ctx.fillStyle = BARREL_DOT_COLOR;
      ctx.fill();
      
      ctx.restore();
    }
  });



  // --- Draw Campfires ---
  if (showNightLights) {
    campfires.forEach(campfire => {
      // Only draw burning campfires
      if (campfire.isBurning) {
        const screenCoords = worldToMinimap(campfire.posX, campfire.posY);
        if (screenCoords) {
          const x = screenCoords.x;
          const y = screenCoords.y;
          const size = CAMPFIRE_ICON_SIZE;
          
          ctx.save();
          
          // Use warmth image if available, otherwise fallback to drawn flame
          if (campfireWarmthImage && campfireWarmthImage.complete && campfireWarmthImage.naturalHeight !== 0) {
            // Draw the warmth image centered at the campfire location
            ctx.drawImage(
              campfireWarmthImage,
              x - size / 2,   // Center horizontally
              y - size / 2,   // Center vertically
              size,
              size
            );
          } else {
            // Fallback to drawn flame if image not loaded
            // Draw glow effect
            ctx.shadowColor = CAMPFIRE_GLOW_COLOR;
            ctx.shadowBlur = 8;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;
            
            // Draw flame-like shape (diamond with rounded top)
            ctx.beginPath();
            ctx.moveTo(x, y - size/2); // Top point
            ctx.quadraticCurveTo(x + size/3, y - size/4, x + size/2, y); // Right curve
            ctx.lineTo(x, y + size/2); // Bottom point
            ctx.lineTo(x - size/2, y); // Left point
            ctx.quadraticCurveTo(x - size/3, y - size/4, x, y - size/2); // Left curve back to top
            ctx.closePath();
            
            // Fill with bright orange
            ctx.fillStyle = CAMPFIRE_DOT_COLOR;
            ctx.fill();
            
            // Add inner flame detail
            ctx.shadowBlur = 0; // Remove shadow for inner detail
            ctx.beginPath();
            ctx.moveTo(x, y - size/3); // Smaller inner flame
            ctx.quadraticCurveTo(x + size/6, y - size/6, x + size/4, y);
            ctx.lineTo(x, y + size/4);
            ctx.lineTo(x - size/4, y);
            ctx.quadraticCurveTo(x - size/6, y - size/6, x, y - size/3);
            ctx.closePath();
            
            ctx.fillStyle = '#FFAA00'; // Brighter yellow-orange for inner flame
            ctx.fill();
            
            // Add black outline for definition
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 1;
            ctx.stroke();
          }
          
          ctx.restore();
        }
      }
    });
  }

  // --- Draw Remote Players ---
  // Remote players are only visible if they have torch lit AND it's night time
  if (showNightLights) {
    players.forEach((player, playerId) => {
      if (localPlayerId && playerId === localPlayerId) {
        return; // Skip local player, handled separately
      }
      
      // Only show remote players if they have torch lit
      if (player.isTorchLit) {
        const screenCoords = worldToMinimap(player.positionX, player.positionY);
        if (screenCoords) {
          const x = screenCoords.x;
          const y = screenCoords.y;
          const size = PLAYER_ICON_SIZE * 1.5; // Larger for torch-lit players
          
          ctx.save();
          
          // Use torch image if available, otherwise fallback to drawn player icon
          if (torchOnImage && torchOnImage.complete && torchOnImage.naturalHeight !== 0) {
            // Draw the torch image centered at the player location
            ctx.drawImage(
              torchOnImage,
              x - size / 2,   // Center horizontally
              y - size / 2,   // Center vertically
              size,
              size
            );
          } else {
            // Fallback to drawn player icon if image not loaded
            // Convert player direction to rotation angle (radians)
            let rotation = 0;
            switch (player.direction) {
              case 'right': rotation = 0; break;           // Point right (0°)
              case 'down': rotation = Math.PI / 2; break;  // Point down (90°)
              case 'left': rotation = Math.PI; break;      // Point left (180°)
              case 'up': rotation = -Math.PI / 2; break;   // Point up (-90°)
              default: rotation = 0; break;                // Default to right
            }
            
            // Draw torch-lit players with larger, orange icons for visibility
            drawPlayerIcon(
              ctx, 
              x, 
              y, 
              rotation, 
              CAMPFIRE_DOT_COLOR, 
              size
            );
          }
          
          ctx.restore();
        }
      }
    });
  }

  // --- Draw Sleeping Bags ---
  // Filter bags belonging to the local player before drawing
  sleepingBags.forEach(bag => {
    const isOwnedByLocalPlayer = localPlayerId && bag.placedBy.toHexString() === localPlayerId;

    // Skip drawing entirely if it's the death screen and the bag isn't owned.
    if (isDeathScreen && !isOwnedByLocalPlayer) {
        return;
    }
    // Also skip drawing non-owned bags on the regular minimap (existing logic)
    if (!isDeathScreen && !isOwnedByLocalPlayer) {
        return; 
    }

    const screenCoords = worldToMinimap(bag.posX, bag.posY);
    if (screenCoords) {
      const isOwned = ownedSleepingBagIds.has(bag.id);
      if (isDeathScreen && isOwned) {
        // Draw owned bags on death screen with yellow glow
        const iconRadius = OWNED_BAG_DOT_SIZE / 2; // Use owned size
        const iconDiameter = OWNED_BAG_DOT_SIZE;
        const cx = screenCoords.x;
        const cy = screenCoords.y;

        ctx.save(); // Save before drawing

        // 1. Draw yellow glow effect (multiple layers for stronger glow)
        ctx.shadowColor = '#ffeb3b'; // Bright yellow
        ctx.shadowBlur = 15;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        
        // Draw multiple glow layers for stronger effect
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.arc(cx, cy, iconRadius + (i * 2), 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255, 235, 59, ${0.3 - (i * 0.1)})`; // Fading yellow glow
          ctx.fill();
        }

        // Reset shadow for main icon
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;

        // 2. Clip to circle
        ctx.beginPath();
        ctx.arc(cx, cy, iconRadius, 0, Math.PI * 2);
        ctx.clip();

        // 3. Draw image centered in the circle
        if (sleepingBagImage && sleepingBagImage.complete && sleepingBagImage.naturalHeight !== 0) {
            ctx.drawImage(
                sleepingBagImage,
                cx - iconRadius, // Adjust x to center
                cy - iconRadius, // Adjust y to center
                iconDiameter,    // Draw at icon size
                iconDiameter
            );
        } 
        // No else needed here, background circle shows something if image fails
        
        ctx.restore(); // Restore context after drawing image (removes clip)

        // 4. Draw bright yellow border around the circle for extra visibility
        ctx.strokeStyle = '#ffeb3b'; // Bright yellow border instead of white
        ctx.lineWidth = REGULAR_BAG_BORDER_WIDTH + 1; // Slightly thicker
        ctx.beginPath();
        ctx.arc(cx, cy, iconRadius, 0, Math.PI * 2);
        ctx.stroke();

      } else if (!isDeathScreen && isOwnedByLocalPlayer) { // Refined condition for regular map
        // Draw normal OWNED sleeping bags using the image if available
        if (sleepingBagImage && sleepingBagImage.complete && sleepingBagImage.naturalHeight !== 0) {
            const iconRadius = REGULAR_BAG_ICON_SIZE / 2;
            const iconDiameter = REGULAR_BAG_ICON_SIZE;
            const cx = screenCoords.x;
            const cy = screenCoords.y;

            ctx.save(); // Save before clipping
            
            // 1. Draw background circle (optional)
            ctx.fillStyle = REGULAR_BAG_BG_COLOR;
            ctx.beginPath();
            ctx.arc(cx, cy, iconRadius, 0, Math.PI * 2);
            ctx.fill();

            // 2. Clip to circle
            ctx.beginPath();
            ctx.arc(cx, cy, iconRadius, 0, Math.PI * 2);
            ctx.clip();

            // 3. Draw image centered in the circle
            ctx.drawImage(
                sleepingBagImage,
                cx - iconRadius, // Adjust x to center
                cy - iconRadius, // Adjust y to center
                iconDiameter,    // Draw at icon size
                iconDiameter
            );
            
            ctx.restore(); // Restore context after drawing image (removes clip)

            // 4. Draw border around the circle
            ctx.strokeStyle = REGULAR_BAG_BORDER_COLOR;
            ctx.lineWidth = REGULAR_BAG_BORDER_WIDTH;
            ctx.beginPath();
            ctx.arc(cx, cy, iconRadius, 0, Math.PI * 2);
            ctx.stroke();

        } else {
            // Fallback to dot if image not loaded
            ctx.fillStyle = SLEEPING_BAG_DOT_COLOR;
            ctx.fillRect(
              screenCoords.x - ENTITY_DOT_SIZE / 2,
              screenCoords.y - ENTITY_DOT_SIZE / 2,
              ENTITY_DOT_SIZE,
              ENTITY_DOT_SIZE
            );
        }
      }
    }
  });

  // --- Draw Local Player --- 
  // The local player should ideally always be drawn (usually near the center when zoomed)
  if (localPlayer) {
    const screenCoords = worldToMinimap(localPlayer.positionX, localPlayer.positionY);
    if (screenCoords) { // Should generally be true unless player is somehow off-world
      // Convert player direction to rotation angle (radians)
      let rotation = 0;
      switch (localPlayer.direction) {
        case 'right': rotation = 0; break;           // Point right (0°)
        case 'down': rotation = Math.PI / 2; break;  // Point down (90°)
        case 'left': rotation = Math.PI; break;      // Point left (180°)
        case 'up': rotation = -Math.PI / 2; break;   // Point up (-90°)
        default: rotation = 0; break;                // Default to right
      }
      
      // Draw local player with directional triangular icon
      drawPlayerIcon(
        ctx, 
        screenCoords.x, 
        screenCoords.y, 
        rotation, 
        LOCAL_PLAYER_DOT_COLOR, 
        PLAYER_ICON_SIZE
      );
    }
  }

  // --- Draw Player Pin ---
  if (playerPin) {
      const pinScreenCoords = worldToMinimap(playerPin.pinX, playerPin.pinY);
      if (pinScreenCoords) {
          const x = pinScreenCoords.x;
          const y = pinScreenCoords.y;
          const size = PIN_SIZE;
          
          // console.log(`[Minimap] Drawing pin - World coords: (${playerPin.pinX}, ${playerPin.pinY}) -> Screen coords: (${x}, ${y})`);
          
          // Save context for styling
          ctx.save();
          
          // Use image if available, otherwise fallback to drawn pin
          if (pinMarkerImage && pinMarkerImage.complete && pinMarkerImage.naturalHeight !== 0) {
              // Draw the pin image centered at the world coordinates (no offset adjustments)
              // This ensures the pin appears exactly where the coordinate conversion places it
              const imageWidth = size;
              const imageHeight = size;
              
              // console.log('[Minimap] Drawing pin image at world coordinates - Screen pos:', x, y);
              ctx.drawImage(
                  pinMarkerImage,
                  x - imageWidth / 2,   // Center horizontally
                  y - imageHeight / 2,  // Center vertically (no special pin point offset)
                  imageWidth,
                  imageHeight
              );
          } else {
              // console.log('[Minimap] Pin image not available, using fallback. Image:', !!pinMarkerImage, 'complete:', pinMarkerImage?.complete, 'naturalHeight:', pinMarkerImage?.naturalHeight);
              // Fallback to drawn pin if image not loaded
              // Draw a classic map pin (long base with narrow triangle)
              const pinWidth = size * 0.4;   // Narrow width
              const pinHeight = size;        // Full height
              const baseHeight = size * 0.75; // Long base (75% of total height)
              const triangleHeight = size * 0.25; // Short triangle (25% of total height)
              
              // Calculate positions
              const baseTop = y - pinHeight;
              const baseBottom = y - triangleHeight;
              const triangleTop = baseBottom;
              const triangleBottom = y; // Point at the actual pin location
              
              ctx.beginPath();
              
              // Draw the rectangular base
              ctx.rect(
                x - pinWidth / 2,  // Left edge
                baseTop,           // Top edge
                pinWidth,          // Width
                baseHeight         // Height
              );
              
              // Draw the triangle point
              ctx.moveTo(x - pinWidth / 2, triangleTop);     // Bottom-left of base
              ctx.lineTo(x, triangleBottom);                 // Point at pin location
              ctx.lineTo(x + pinWidth / 2, triangleTop);     // Bottom-right of base
              ctx.lineTo(x - pinWidth / 2, triangleTop);     // Back to start
              
              ctx.closePath();
              
              // Fill with bright yellow
              ctx.fillStyle = PIN_COLOR;
              ctx.fill();
              
              // Draw thin black border
              ctx.strokeStyle = PIN_BORDER_COLOR;
              ctx.lineWidth = PIN_BORDER_WIDTH;
              ctx.stroke();
          }
          
          // Restore context after pin drawing
          ctx.restore();
      }
  }

  // X button now handled by React components, not canvas drawing
  ctx.restore(); // Restore context after drawing all elements

  // Tab bar now handled by React components, not canvas drawing
}

// Export the calculated dimensions for potential use elsewhere (e.g., mouse interaction checks)
export const MINIMAP_DIMENSIONS = {
  width: MINIMAP_WIDTH,
  height: MINIMAP_HEIGHT,
};

// Add worldToMinimap export if needed by DeathScreen click handling
// Export helper function to convert world coords to minimap screen coords
export const worldToMinimapCoords = (
  worldX: number, worldY: number,
  minimapX: number, minimapY: number, minimapWidth: number, minimapHeight: number,
  drawOffsetX: number, drawOffsetY: number, currentScale: number
): { x: number; y: number } | null => {
  const screenX = drawOffsetX + worldX * currentScale;
  const screenY = drawOffsetY + worldY * currentScale;
  // Basic check if within minimap bounds (can be more precise)
  if (screenX >= minimapX && screenX <= minimapX + minimapWidth &&
      screenY >= minimapY && screenY <= minimapY + minimapHeight) {
    return { x: screenX, y: screenY };
  } else {
    return null; // Off the minimap at current zoom/pan
  }
};

// Export calculation logic for draw offsets and scale if needed
export const calculateMinimapViewport = (
  minimapWidth: number, minimapHeight: number,
  worldPixelWidth: number, worldPixelHeight: number,
  zoomLevel: number,
  localPlayer: SpacetimeDBPlayer | undefined, // Use undefined for clarity
  viewCenterOffset: { x: number; y: number }
) => {
    const baseScaleX = minimapWidth / worldPixelWidth;
    const baseScaleY = minimapHeight / worldPixelHeight;
    const baseUniformScale = Math.min(baseScaleX, baseScaleY);
    const currentScale = baseUniformScale * zoomLevel;

    let viewCenterXWorld: number;
    let viewCenterYWorld: number;

    if (zoomLevel <= 1 || !localPlayer) {
      viewCenterXWorld = worldPixelWidth / 2;
      viewCenterYWorld = worldPixelHeight / 2;
    } else {
      viewCenterXWorld = localPlayer.positionX + viewCenterOffset.x;
      viewCenterYWorld = localPlayer.positionY + viewCenterOffset.y;
    }

    const viewWidthWorld = minimapWidth / currentScale;
    const viewHeightWorld = minimapHeight / currentScale;
    const viewMinXWorld = viewCenterXWorld - viewWidthWorld / 2;
    const viewMinYWorld = viewCenterYWorld - viewHeightWorld / 2;

    // Calculate draw offsets based on minimap's top-left screen position (assumed 0,0 for calculation)
    // Actual screen position (minimapX, minimapY) needs to be added separately when drawing.
    const drawOffsetX = -viewMinXWorld * currentScale;
    const drawOffsetY = -viewMinYWorld * currentScale;

    return { currentScale, drawOffsetX, drawOffsetY, viewMinXWorld, viewMinYWorld };
};

// X button functionality now handled by React components

// Helper function to check if a point is within the minimap bounds
export const isPointInMinimap = (
  mouseX: number,
  mouseY: number,
  canvasWidth: number,
  canvasHeight: number
): boolean => {
  const minimapX = (canvasWidth - MINIMAP_WIDTH) / 2;
  const minimapY = (canvasHeight - MINIMAP_HEIGHT) / 2;
  
  return mouseX >= minimapX && 
         mouseX <= minimapX + MINIMAP_WIDTH && 
         mouseY >= minimapY && 
         mouseY <= minimapY + MINIMAP_HEIGHT;
};

// Helper function to check if a click is outside the minimap (for closing)
export const isClickOutsideMinimap = (
  mouseX: number,
  mouseY: number,
  canvasWidth: number,
  canvasHeight: number
): boolean => {
  return !isPointInMinimap(mouseX, mouseY, canvasWidth, canvasHeight);
};

// Tab functionality moved to React components

export default drawMinimapOntoCanvas;