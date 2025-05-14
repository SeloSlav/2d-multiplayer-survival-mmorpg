import { gameConfig } from '../config/gameConfig';
import { Player as SpacetimeDBPlayer, Tree, Stone as SpacetimeDBStone, PlayerPin, SleepingBag, Campfire as SpacetimeDBCampfire } from '../generated';

// --- Calculate Proportional Dimensions ---
const worldPixelWidth = gameConfig.worldWidth * gameConfig.tileSize;
const worldPixelHeight = gameConfig.worldHeight * gameConfig.tileSize;
const worldAspectRatio = worldPixelHeight / worldPixelWidth;

const BASE_MINIMAP_WIDTH = 400; // Base width for calculation
const calculatedMinimapHeight = BASE_MINIMAP_WIDTH * worldAspectRatio;

// Minimap constants
const MINIMAP_WIDTH = BASE_MINIMAP_WIDTH;
const MINIMAP_HEIGHT = Math.round(calculatedMinimapHeight); // Use calculated height
const MINIMAP_BG_COLOR_NORMAL = 'rgba(40, 40, 60, 0.2)';
const MINIMAP_BG_COLOR_HOVER = 'rgba(60, 60, 80, 0.2)';
const MINIMAP_BORDER_COLOR = '#a0a0c0';
const PLAYER_DOT_SIZE = 3;
const LOCAL_PLAYER_DOT_COLOR = '#FFFF00';
// Add colors for trees and rocks
const TREE_DOT_COLOR = '#008000'; // Green
const ROCK_DOT_COLOR = '#808080'; // Grey
const CAMPFIRE_DOT_COLOR = '#FFA500'; // Orange for campfires and lit players
const SLEEPING_BAG_DOT_COLOR = '#A0522D'; // Sienna (brownish)
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

// Updated pin styling
const PIN_COLOR = '#FFD700'; // Golden yellow for pin
const PIN_BORDER_COLOR = '#000000'; // Black border
const PIN_SIZE = 8; // Larger pin
const PIN_BORDER_WIDTH = 1; // Border width

// Grid Constants - Divisions will be calculated dynamically
const GRID_LINE_COLOR = 'rgba(200, 200, 200, 0.3)';
const GRID_TEXT_COLOR = 'rgba(255, 255, 255, 0.5)';
const GRID_TEXT_FONT = '10px Arial';

// Props required for drawing the minimap
interface MinimapProps {
  ctx: CanvasRenderingContext2D;
  players: Map<string, SpacetimeDBPlayer>; // Map of player identities to player data
  trees: Map<string, Tree>; // Map of tree identities/keys to tree data
  stones: Map<string, SpacetimeDBStone>; // Add stones prop
  campfires: Map<string, SpacetimeDBCampfire>; // Add campfires prop
  sleepingBags: Map<number, SleepingBag>; // Map of sleeping bag IDs to data
  localPlayer?: SpacetimeDBPlayer; // Pass the full local player object
  localPlayerId?: string; // Revert to string only, Identity type is not exported
  playerPin: PlayerPin | null; // Local player's pin data
  canvasWidth: number; // Width of the main game canvas
  canvasHeight: number; // Height of the main game canvas
  isMouseOverMinimap: boolean; // To change background on hover
  zoomLevel: number; // Current zoom level
  viewCenterOffset: { x: number; y: number }; // Panning offset from hook
  // --- New props for Death Screen ---
  isDeathScreen?: boolean; // Optional flag for death screen mode
  ownedSleepingBagIds?: Set<number>; // Set of owned sleeping bag IDs
  onSelectSleepingBag?: (bagId: number) => void; // Callback for clicking an owned bag (logic outside)
  sleepingBagImage?: HTMLImageElement | null; // Image asset for icons
}

/**
 * Draws the minimap overlay onto the provided canvas context.
 */
export function drawMinimapOntoCanvas({
  ctx,
  players,
  trees,
  stones,
  campfires,
  sleepingBags,
  localPlayer, // Destructure localPlayer
  localPlayerId,
  playerPin, // Destructure playerPin
  canvasWidth,
  canvasHeight,
  isMouseOverMinimap,
  zoomLevel, // Destructure zoomLevel
  viewCenterOffset, // Destructure pan offset
  // Destructure new props with defaults
  isDeathScreen = false,
  ownedSleepingBagIds = new Set(),
  onSelectSleepingBag, // Callback is optional, only needed if interactive
  sleepingBagImage = null, // Default to null
}: MinimapProps) {
  const minimapWidth = MINIMAP_WIDTH;
  const minimapHeight = MINIMAP_HEIGHT;
  
  // Calculate top-left corner for centering the minimap UI element
  const minimapX = (canvasWidth - minimapWidth) / 2;
  const minimapY = (canvasHeight - minimapHeight) / 2;

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

  // --- Apply Retro Styling --- 
  ctx.save(); // Save context before applying shadow/styles

  // Apply shadow (draw rectangle slightly offset first, then the main one)
  const shadowOffset = 2;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(minimapX + shadowOffset, minimapY + shadowOffset, minimapWidth, minimapHeight);

  // 1. Draw Overall Minimap Background (Dark UI Color)
  ctx.fillStyle = isMouseOverMinimap ? MINIMAP_BG_COLOR_HOVER : MINIMAP_BG_COLOR_NORMAL;
  ctx.fillRect(minimapX, minimapY, minimapWidth, minimapHeight);

  // Draw border
  ctx.strokeStyle = MINIMAP_BORDER_COLOR;
  ctx.lineWidth = 1; // Match PlayerUI border style
  ctx.strokeRect(minimapX, minimapY, minimapWidth, minimapHeight);

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

  // --- Calculate Grid Divisions Dynamically (Based on current view) ---
  // Adjust grid rendering based on zoom level - maybe show finer grid when zoomed?
  // For now, keep it simple: calculate grid lines based on visible world area.
  const gridCellSizeWorld = gameConfig.minimapGridCellSizePixels > 0 ? gameConfig.minimapGridCellSizePixels : 1;

  const startGridXWorld = Math.floor(viewMinXWorld / gridCellSizeWorld) * gridCellSizeWorld;
  const endGridXWorld = Math.ceil((viewMinXWorld + viewWidthWorld) / gridCellSizeWorld) * gridCellSizeWorld;
  const startGridYWorld = Math.floor(viewMinYWorld / gridCellSizeWorld) * gridCellSizeWorld;
  const endGridYWorld = Math.ceil((viewMinYWorld + viewHeightWorld) / gridCellSizeWorld) * gridCellSizeWorld;

  // --- Draw Grid ---
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

  // --- Draw Trees ---
  ctx.fillStyle = TREE_DOT_COLOR;
  trees.forEach(tree => {
    const screenCoords = worldToMinimap(tree.posX, tree.posY);
    if (screenCoords) {
      ctx.fillRect(
        screenCoords.x - ENTITY_DOT_SIZE / 2,
        screenCoords.y - ENTITY_DOT_SIZE / 2,
        ENTITY_DOT_SIZE,
        ENTITY_DOT_SIZE
      );
    }
  });

  // --- Draw Stones ---
  ctx.fillStyle = ROCK_DOT_COLOR; // Use ROCK_DOT_COLOR
  stones.forEach(stone => { // Use stones prop (type SpacetimeDBStone)
    const screenCoords = worldToMinimap(stone.posX, stone.posY);
    if (screenCoords) {
        ctx.fillRect(
          screenCoords.x - ENTITY_DOT_SIZE / 2,
          screenCoords.y - ENTITY_DOT_SIZE / 2,
          ENTITY_DOT_SIZE,
          ENTITY_DOT_SIZE
        );
      }
  });

  // --- Draw Campfires ---
  ctx.fillStyle = CAMPFIRE_DOT_COLOR;
  campfires.forEach(campfire => {
    // Only draw burning campfires
    if (campfire.isBurning) {
      const screenCoords = worldToMinimap(campfire.posX, campfire.posY);
      if (screenCoords) {
        ctx.fillRect(
          screenCoords.x - LIT_ENTITY_DOT_SIZE / 2,
          screenCoords.y - LIT_ENTITY_DOT_SIZE / 2,
          LIT_ENTITY_DOT_SIZE,
          LIT_ENTITY_DOT_SIZE
        );
      }
    }
  });

  // --- Draw Remote Players with Torch ON ---
  players.forEach((player, playerId) => {
    if (localPlayerId && playerId === localPlayerId) {
      return; // Skip local player, handled separately
    }
    if (player.isTorchLit) {
      const screenCoords = worldToMinimap(player.positionX, player.positionY);
      if (screenCoords) {
        ctx.fillStyle = CAMPFIRE_DOT_COLOR; // Use shared color
        ctx.fillRect(
          screenCoords.x - LIT_ENTITY_DOT_SIZE / 2, // Use shared larger size
          screenCoords.y - LIT_ENTITY_DOT_SIZE / 2,
          LIT_ENTITY_DOT_SIZE,
          LIT_ENTITY_DOT_SIZE
        );
      }
    }
  });

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
        // Draw owned bags on death screen - USE SAME LOGIC as regular bags but potentially different size
        const iconRadius = OWNED_BAG_DOT_SIZE / 2; // Use owned size
        const iconDiameter = OWNED_BAG_DOT_SIZE;
        const cx = screenCoords.x;
        const cy = screenCoords.y;

        ctx.save(); // Save before clipping

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

        // 4. Draw border around the circle (Ensure it's the white one)
        ctx.strokeStyle = REGULAR_BAG_BORDER_COLOR; 
        ctx.lineWidth = REGULAR_BAG_BORDER_WIDTH;
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
        ctx.fillStyle = LOCAL_PLAYER_DOT_COLOR;
        ctx.fillRect(
          screenCoords.x - PLAYER_DOT_SIZE / 2,
          screenCoords.y - PLAYER_DOT_SIZE / 2,
          PLAYER_DOT_SIZE,
          PLAYER_DOT_SIZE
        );
    }
  }

  // --- Draw Player Pin ---
  if (playerPin) {
      const pinScreenCoords = worldToMinimap(playerPin.pinX, playerPin.pinY);
      if (pinScreenCoords) {
          // Draw a better marker (simple marker icon with black outline)
          const x = pinScreenCoords.x;
          const y = pinScreenCoords.y;
          const size = PIN_SIZE;
          
          // Save context for styling
          ctx.save();
          
          // Draw the pin as a filled circle with border
          ctx.beginPath();
          ctx.arc(x, y, size/2, 0, Math.PI * 2);
          ctx.fillStyle = PIN_COLOR;
          ctx.fill();
          ctx.lineWidth = PIN_BORDER_WIDTH;
          ctx.strokeStyle = PIN_BORDER_COLOR;
          ctx.stroke();
          
          // Draw a small triangle on top pointing down to make it look like a location pin
          ctx.beginPath();
          ctx.moveTo(x, y - size/2); // Top of circle
          ctx.lineTo(x - size/3, y - size);  // Left point
          ctx.lineTo(x + size/3, y - size);  // Right point
          ctx.closePath();
          ctx.fillStyle = PIN_COLOR;
          ctx.fill();
          ctx.stroke();
          
          // Restore context after pin drawing
          ctx.restore();
      }
  }

  // Restore context after drawing clipped content
  ctx.restore(); // Re-enable restore
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

export default drawMinimapOntoCanvas;