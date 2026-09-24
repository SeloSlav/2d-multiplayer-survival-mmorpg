import { Door as SpacetimeDBDoor } from '../../generated/types';
import { FOUNDATION_TILE_SIZE } from '../../config/gameConfig';

// Door rendering dimensions
export const DOOR_RENDER_WIDTH = FOUNDATION_TILE_SIZE; // 96px to span foundation edge
export const DOOR_RENDER_HEIGHT = FOUNDATION_TILE_SIZE; // 96px

// Door types (match server constants)
export const DOOR_TYPE_WOOD = 0;
export const DOOR_TYPE_METAL = 1;

// Door edges (match server BuildingEdge enum)
export const DOOR_EDGE_NORTH = 0;
export const DOOR_EDGE_EAST = 1;
export const DOOR_EDGE_SOUTH = 2;
export const DOOR_EDGE_WEST = 3;
export const SIDE_DOOR_WIDTH = 24;

// Door interaction distance (matches server-side, same as other building objects)
export const PLAYER_DOOR_INTERACTION_DISTANCE = 96.0; // Standard interaction distance (matches campfire, storage box, etc.)
export const PLAYER_DOOR_INTERACTION_DISTANCE_SQUARED = PLAYER_DOOR_INTERACTION_DISTANCE * PLAYER_DOOR_INTERACTION_DISTANCE;

// Door rendering offset (doors are rendered 44px higher than their actual position)
export const DOOR_RENDER_Y_OFFSET = 44;

// Interaction highlight colors
const HIGHLIGHT_COLOR = 'rgba(100, 180, 255, 0.4)'; // Blue tint for interactable
const HIGHLIGHT_BORDER_COLOR = 'rgba(100, 180, 255, 0.8)';

interface RenderDoorProps {
  ctx: CanvasRenderingContext2D;
  door: SpacetimeDBDoor;
  woodDoorImage: HTMLImageElement | null;
  metalDoorImage: HTMLImageElement | null;
  isHighlighted?: boolean;
  nowMs?: number;
  localPlayerPosition?: { x: number; y: number } | null; // Player position for transparency logic
}

/**
 * Get the sprite image for a door based on its type
 */
export function getDoorImage(
  door: SpacetimeDBDoor,
  woodDoorImage: HTMLImageElement | null,
  metalDoorImage: HTMLImageElement | null
): HTMLImageElement | null {
  switch (door.doorType) {
    case DOOR_TYPE_WOOD:
      return woodDoorImage;
    case DOOR_TYPE_METAL:
      return metalDoorImage;
    default:
      return woodDoorImage;
  }
}

/** A profile view for doors set into east/west wall gaps. Shared by preview and placed doors. */
export function renderSideDoorProfile(
  ctx: CanvasRenderingContext2D,
  edge: number,
  doorType: number,
  centerX: number,
  centerY: number,
): void {
  const x = centerX - SIDE_DOOR_WIDTH / 2;
  const y = centerY - FOUNDATION_TILE_SIZE / 2;
  const metal = doorType === DOOR_TYPE_METAL;
  const frame = metal ? '#273245' : '#352318';
  const face = metal ? '#71879b' : '#81542f';
  const shade = metal ? '#43586f' : '#55351f';
  const light = metal ? '#a7bfce' : '#ae7a45';
  const hardware = metal ? '#c6d2d6' : '#c4a875';
  const hingeX = edge === DOOR_EDGE_EAST ? x + 3 : x + SIDE_DOOR_WIDTH - 5;
  const latchX = edge === DOOR_EDGE_EAST ? x + SIDE_DOOR_WIDTH - 7 : x + 5;

  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
  ctx.fillRect(x + 3, y + 4, SIDE_DOOR_WIDTH, FOUNDATION_TILE_SIZE - 4);
  ctx.fillStyle = frame;
  ctx.fillRect(x, y, SIDE_DOOR_WIDTH, FOUNDATION_TILE_SIZE);
  ctx.fillStyle = face;
  ctx.fillRect(x + 3, y + 4, SIDE_DOOR_WIDTH - 6, FOUNDATION_TILE_SIZE - 8);
  ctx.fillStyle = shade;
  ctx.fillRect(x + 3, y + 4, 4, FOUNDATION_TILE_SIZE - 8);
  ctx.fillStyle = light;
  ctx.fillRect(x + SIDE_DOOR_WIDTH - 7, y + 5, 2, FOUNDATION_TILE_SIZE - 10);

  // Panel seams read as a door rather than a plain side wall strip.
  ctx.strokeStyle = shade;
  ctx.lineWidth = 2;
  for (const panelY of [y + 12, y + 45, y + 78]) {
    ctx.strokeRect(x + 7, panelY, SIDE_DOOR_WIDTH - 14, 22);
  }
  ctx.fillStyle = hardware;
  ctx.fillRect(hingeX, y + 18, 3, 8);
  ctx.fillRect(hingeX, y + 70, 3, 8);
  ctx.fillRect(latchX, y + 47, 3, 5);
  ctx.strokeStyle = metal ? '#1d2736' : '#26180f';
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, SIDE_DOOR_WIDTH - 2, FOUNDATION_TILE_SIZE - 2);
  ctx.restore();
}

/**
 * Render a door entity
 */
export const renderDoor = ({
  ctx,
  door,
  woodDoorImage,
  metalDoorImage,
  isHighlighted = false,
  nowMs = Date.now(),
  localPlayerPosition,
}: RenderDoorProps) => {
  if (door.isDestroyed) {
    return;
  }

  const isSideDoor = door.edge === DOOR_EDGE_EAST || door.edge === DOOR_EDGE_WEST;
  const doorImage = getDoorImage(door, woodDoorImage, metalDoorImage);
  if (!isSideDoor && !doorImage) {
    return;
  }

  // Calculate draw position - door is centered on the edge
  const drawWidth = isSideDoor ? SIDE_DOOR_WIDTH : DOOR_RENDER_WIDTH;
  const drawHeight = DOOR_RENDER_HEIGHT; // Full foundation height (96px)
  
  // Door position is at the edge center, but offset 64px up to align with foundation
  let drawX = door.posX - drawWidth / 2;
  let drawY = door.posY - drawHeight / 2 - (isSideDoor ? 0 : 44);

  // Calculate transparency for SOUTH doors when player is behind them (similar to trees/walls)
  // South door: player is "behind" when NORTH of the door (player.y < door.y)
  const MIN_ALPHA = 0.3;
  const MAX_ALPHA = 1.0;
  let doorAlpha = MAX_ALPHA;

  // Only apply transparency to south doors (edge 2) when player is behind them
  if (localPlayerPosition && door.edge === DOOR_EDGE_SOUTH && !door.isOpen) {
    // Door bounding box for overlap detection
    const doorLeft = drawX;
    const doorRight = drawX + drawWidth;
    const doorTop = drawY;
    const doorBottom = drawY + drawHeight;
    
    // Player bounding box
    const playerSize = 48;
    const playerLeft = localPlayerPosition.x - playerSize / 2;
    const playerRight = localPlayerPosition.x + playerSize / 2;
    const playerTop = localPlayerPosition.y - playerSize;
    const playerBottom = localPlayerPosition.y;
    
    // Check if player overlaps with door visually
    const overlapsHorizontally = playerRight > doorLeft && playerLeft < doorRight;
    const overlapsVertically = playerBottom > doorTop && playerTop < doorBottom;
    
    // South door: player is behind if player.y < door.posY (player is NORTH of door, looking south)
    const isPlayerBehind = localPlayerPosition.y < door.posY;
    
    if (overlapsHorizontally && overlapsVertically && isPlayerBehind) {
      // Calculate depth difference for smooth fade
      const depthDifference = Math.abs(door.posY - localPlayerPosition.y);
      const maxDepthForFade = 100;
      
      if (depthDifference > 0 && depthDifference < maxDepthForFade) {
        const fadeFactor = 1 - (depthDifference / maxDepthForFade);
        doorAlpha = MAX_ALPHA - (fadeFactor * (MAX_ALPHA - MIN_ALPHA));
        doorAlpha = Math.max(MIN_ALPHA, Math.min(MAX_ALPHA, doorAlpha));
      } else if (depthDifference >= maxDepthForFade) {
        doorAlpha = MIN_ALPHA;
      }
    }
  }

  // Apply transparency if needed
  const needsTransparency = doorAlpha < MAX_ALPHA;
  if (needsTransparency) {
    ctx.save();
    ctx.globalAlpha = doorAlpha;
  } else {
    ctx.save();
  }

  // Draw highlight box if interactable (always draw, even when door is open/invisible)
  if (isHighlighted) {
    ctx.fillStyle = HIGHLIGHT_COLOR;
    ctx.strokeStyle = HIGHLIGHT_BORDER_COLOR;
    ctx.lineWidth = 2;
    
    // Draw highlight rectangle around door
    const highlightPadding = 4;
    ctx.fillRect(
      drawX - highlightPadding,
      drawY - highlightPadding,
      drawWidth + highlightPadding * 2,
      drawHeight + highlightPadding * 2
    );
    ctx.strokeRect(
      drawX - highlightPadding,
      drawY - highlightPadding,
      drawWidth + highlightPadding * 2,
      drawHeight + highlightPadding * 2
    );
  }

  // If door is open, don't render the sprite (invisible), but still show highlight
  if (door.isOpen) {
    ctx.restore();
    return;
  }

  // Closed door - draw normally
  if (isSideDoor) {
    renderSideDoorProfile(ctx, door.edge, door.doorType, door.posX, door.posY);
  } else if (doorImage) {
    ctx.drawImage(doorImage, drawX, drawY, drawWidth, drawHeight);
  }

  ctx.restore();

  // Health bar rendered via renderHealthBarOverlay (on top of world objects)
};

/**
 * Render E interaction label for door
 */
export function renderDoorInteractionLabel(
  ctx: CanvasRenderingContext2D,
  door: SpacetimeDBDoor,
  isOwner: boolean
) {
  const labelY = door.posY - DOOR_RENDER_HEIGHT / 2 - 25;
  const labelText = isOwner
    ? (door.isOpen ? 'E - Close Door' : 'E - Open Door')
    : (door.isOpen ? '' : 'Locked');

  if (!labelText) return;

  ctx.save();
  ctx.font = 'bold 14px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Draw text shadow
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.fillText(labelText, door.posX + 1, labelY + 1);

  // Draw text
  ctx.fillStyle = isOwner ? '#FFFFFF' : '#FF6666';
  ctx.fillText(labelText, door.posX, labelY);

  ctx.restore();
}

/**
 * Get the Y-sort position for a door (used for depth sorting)
 * Doors should be rendered at the same depth as walls on the same edge
 */
export function getDoorYSortPosition(door: SpacetimeDBDoor): number {
  // Use the door's Y position for sorting
  // Adjust slightly based on edge to ensure proper layering
  if (door.edge === DOOR_EDGE_NORTH) {
    return door.posY;
  } else {
    return door.posY;
  }
}

