import { gameConfig } from '../config/gameConfig';
import {
    Player as SpacetimeDBPlayer,
    Tree as SpacetimeDBTree,
    Stone as SpacetimeDBStone,
    Campfire as SpacetimeDBCampfire,
    Mushroom as SpacetimeDBMushroom,
    DroppedItem as SpacetimeDBDroppedItem,
    WoodenStorageBox as SpacetimeDBWoodenStorageBox,
    ItemDefinition as SpacetimeDBItemDefinition,
    Corn as SpacetimeDBCorn,
} from '../generated';
import * as SpacetimeDB from '../generated';
import {
    isPlayer, isTree, isStone, isCampfire, isMushroom, isWoodenStorageBox, isDroppedItem, isCorn
} from './typeGuards';
// Import individual rendering functions
import { renderMushroom } from './mushroomRenderingUtils';
import { renderDroppedItem } from './droppedItemRenderingUtils';
import { renderCampfire } from './campfireRenderingUtils';
import { renderTree } from './treeRenderingUtils';
import { renderStone } from './stoneRenderingUtils';
import { renderWoodenStorageBox } from './woodenStorageBoxRenderingUtils';
import { renderEquippedItem } from './equippedItemRenderingUtils'; // Needed for player rendering logic
import { renderCorn } from './cornRenderingUtils';
// Import specific constants from gameConfig
import {
    MOVEMENT_POSITION_THRESHOLD,
    JUMP_DURATION_MS,
    JUMP_HEIGHT_PX,
} from '../config/gameConfig';

// --- Constants --- 
const IDLE_FRAME_INDEX = 1; // Second frame is idle
const PLAYER_SHAKE_DURATION_MS = 200; // How long the shake lasts
const PLAYER_SHAKE_AMOUNT_PX = 3;   // Max pixels to offset
// Defined here as it depends on spriteWidth from config
const playerRadius = gameConfig.spriteWidth / 2;

// --- Helper Functions --- 

// Calculates sx, sy for the spritesheet
export const getSpriteCoordinates = (
  player: SpacetimeDBPlayer,
  isMoving: boolean,
  currentAnimationFrame: number
): { sx: number, sy: number } => {
  let spriteRow = 2; // Default Down
  switch (player.direction) {
    case 'up':    spriteRow = 0; break;
    case 'right': spriteRow = 1; break;
    case 'down':  spriteRow = 2; break;
    case 'left':  spriteRow = 3; break;
    default:      spriteRow = 2; break;
  }
  const frameIndex = isMoving ? currentAnimationFrame : IDLE_FRAME_INDEX;
  const sx = frameIndex * gameConfig.spriteWidth;
  const sy = spriteRow * gameConfig.spriteHeight;
  return { sx, sy };
};

// Checks if the mouse is hovering over the player
export const isPlayerHovered = (
  worldMouseX: number | null,
  worldMouseY: number | null,
  player: SpacetimeDBPlayer
): boolean => {
  // Skip hover detection if mouse coordinates are null
  if (worldMouseX === null || worldMouseY === null) return false;
  
  const hoverDX = worldMouseX - player.positionX;
  const hoverDY = worldMouseY - player.positionY;
  const distSq = hoverDX * hoverDX + hoverDY * hoverDY;
  const radiusSq = playerRadius * playerRadius;
  
  return distSq < radiusSq;
};

// Draws the styled name tag (Make exportable)
export const drawNameTag = (
  ctx: CanvasRenderingContext2D,
  player: SpacetimeDBPlayer,
  spriteTopY: number, // dy from drawPlayer calculation
  spriteX: number, // Added new parameter for shaken X position
  showLabel: boolean = true // Add parameter to control visibility
) => {
  if (!showLabel) return; // Skip rendering if not showing label
  
  ctx.font = '12px Arial';
  ctx.textAlign = 'center';
  const textWidth = ctx.measureText(player.username).width;
  const tagPadding = 4;
  const tagHeight = 16;
  const tagWidth = textWidth + tagPadding * 2;
  const tagX = spriteX - tagWidth / 2;
  const tagY = spriteTopY - tagHeight + 4;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.beginPath();
  ctx.roundRect(tagX, tagY, tagWidth, tagHeight, 5);
  ctx.fill();

  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(player.username, spriteX, tagY + tagHeight / 2 + 4);
};

// Renders a complete player (sprite, shadow, and conditional name tag)
export const renderPlayer = (
  ctx: CanvasRenderingContext2D,
  player: SpacetimeDBPlayer,
  heroImg: CanvasImageSource,
  isMoving: boolean,
  isHovered: boolean,
  currentAnimationFrame: number,
  nowMs: number, // <-- Added current time in ms
  jumpOffsetY: number = 0,
  shouldShowLabel: boolean = false // New parameter to control label visibility
) => {
  const { sx, sy } = getSpriteCoordinates(player, isMoving, currentAnimationFrame);
  
  // --- Calculate Shake Offset (Only if alive) ---
  let shakeX = 0;
  let shakeY = 0;
  if (!player.isDead && player.lastHitTime) { // Check !player.isDead
    const lastHitMs = Number(player.lastHitTime.microsSinceUnixEpoch / 1000n);
    const elapsedSinceHit = nowMs - lastHitMs;
    if (elapsedSinceHit >= 0 && elapsedSinceHit < PLAYER_SHAKE_DURATION_MS) {
      shakeX = (Math.random() - 0.5) * 2 * PLAYER_SHAKE_AMOUNT_PX;
      shakeY = (Math.random() - 0.5) * 2 * PLAYER_SHAKE_AMOUNT_PX;
    }
  }
  // --- End Shake Offset ---

  const drawWidth = gameConfig.spriteWidth * 2;
  const drawHeight = gameConfig.spriteHeight * 2;
  const spriteBaseX = player.positionX - drawWidth / 2 + shakeX; // Includes shake if applicable
  const spriteBaseY = player.positionY - drawHeight / 2 + shakeY; // Includes shake if applicable
  const spriteDrawY = spriteBaseY - jumpOffsetY;

  // --- Draw Shadow (Only if alive) --- 
  if (!player.isDead) { // Check !player.isDead
      const shadowBaseRadiusX = drawWidth * 0.3;
      const shadowBaseRadiusY = shadowBaseRadiusX * 0.4;
      const shadowMaxJumpOffset = 10; 
      // Use the local playerRadius constant here too
      const shadowYOffsetFromJump = jumpOffsetY * (shadowMaxJumpOffset / playerRadius); 
      const shadowBaseYOffset = drawHeight * 0.4; 
      // And here
      const jumpProgress = Math.min(1, jumpOffsetY / playerRadius); 
      const shadowScale = 1.0 - jumpProgress * 0.4; 
      const shadowOpacity = 0.5 - jumpProgress * 0.3; 

      ctx.fillStyle = `rgba(0, 0, 0, ${Math.max(0, shadowOpacity)})`;
      ctx.beginPath();
      ctx.ellipse(
        player.positionX, // Use original player X for shadow center
        player.positionY + shadowBaseYOffset + shadowYOffsetFromJump, // Use original player Y for shadow center
        shadowBaseRadiusX * shadowScale, 
        shadowBaseRadiusY * shadowScale, 
        0, 
        0, 
        Math.PI * 2 
      );
      ctx.fill();
  }
  // --- End Draw Shadow ---

  // --- Draw Sprite --- 
  ctx.save();
  try {
    // Calculate center point for rotation (based on shaken position if alive)
    const centerX = spriteBaseX + drawWidth / 2;
    const centerY = spriteDrawY + drawHeight / 2;

    if (player.isDead) {
      // Determine rotation angle based on direction
      let rotationAngleRad = 0;
      switch (player.direction) {
        case 'up':    // Facing up, rotate CCW
        case 'right': // Facing right, rotate CCW
          rotationAngleRad = -Math.PI / 2; // -90 degrees
          break;
        case 'down':  // Facing down, rotate CW
        case 'left':  // Facing left, rotate CW
        default:
          rotationAngleRad = Math.PI / 2; // +90 degrees
          break;
      }
      
      // Translate origin to sprite center, rotate, translate back
      ctx.translate(centerX, centerY);
      ctx.rotate(rotationAngleRad);
      ctx.translate(-centerX, -centerY);
    }

    // Draw the sprite (respecting rotation if applied)
    ctx.drawImage(
      heroImg, 
      sx, sy, gameConfig.spriteWidth, gameConfig.spriteHeight, // Source
      spriteBaseX, spriteDrawY, drawWidth, drawHeight // Destination (includes shake if alive)
    );

  } finally {
      ctx.restore(); // Restore context state (removes rotation)
  }
  // --- End Draw Sprite ---

  // Draw name tag if player is alive and either currently hovered or in the tracked hover state
  if (!player.isDead) {
    // Show label based on the passed shouldShowLabel parameter
    const showingDueToCurrentHover = isHovered;
    const showingDueToPersistentState = shouldShowLabel;
    const willShowLabel = showingDueToCurrentHover || showingDueToPersistentState;
    
    drawNameTag(ctx, player, spriteDrawY, spriteBaseX + drawWidth / 2, willShowLabel);
  }
};

// --- NEW: Rendering Loop Functions ---

// Type alias for ground items for clarity
type GroundEntity = (SpacetimeDBMushroom | SpacetimeDBDroppedItem | SpacetimeDBCampfire | SpacetimeDBCorn) & {
    __entityType?: 'corn' | 'mushroom' | 'droppedItem' | 'campfire';
};

interface RenderGroundEntitiesProps {
    ctx: CanvasRenderingContext2D;
    groundItems: GroundEntity[];
    itemDefinitions: Map<string, SpacetimeDBItemDefinition>;
    itemImagesRef: React.MutableRefObject<Map<string, HTMLImageElement>>;
    nowMs: number;
}

/**
 * Renders entities that lie flat on the ground and don't require Y-sorting
 * against taller entities (Mushrooms, Dropped Items, Campfires, Corn).
 */
export const renderGroundEntities = ({
    ctx,
    groundItems,
    itemDefinitions,
    itemImagesRef,
    nowMs,
}: RenderGroundEntitiesProps) => {
    groundItems.forEach(entity => {
        // SPECIAL CASE: Always render entities explicitly marked as corn 
        // with the corn renderer, regardless of other checks
        if (entity.__entityType === 'corn') {
            // console.log('Rendering EXPLICITLY MARKED corn entity:', entity);
            renderCorn(ctx, entity as SpacetimeDBCorn, nowMs);
            return; // Skip other checks
        }
        
        // Check for DroppedItem FIRST
        if (isDroppedItem(entity)) {
            const itemDef = itemDefinitions.get(entity.itemDefId.toString());
            renderDroppedItem({ ctx, item: entity, itemDef, itemImagesRef });
        // Check for Corn SECOND (moved before mushroom check)
        } else if (isCorn(entity)) {
            // console.log('Rendering CORN entity:', entity);
            renderCorn(ctx, entity, nowMs);
        // Check for Mushroom THIRD (moved after corn check)
        } else if (isMushroom(entity)) {
            // Debug: Log if this entity might actually be corn
            if (Object.entries(entity as Record<string, any>).some(([key, value]) => 
                key.toLowerCase().includes('corn') || 
                (typeof value === 'string' && value.toLowerCase().includes('corn'))
            )) {
                console.warn('WARNING: Possible CORN entity being rendered as MUSHROOM:', entity);
            }
            renderMushroom(ctx, entity, nowMs);
        // Check for Campfire FOURTH
        } else if (isCampfire(entity)) {
            renderCampfire(ctx, entity.posX, entity.posY, entity.isBurning);
        }
    });
};

// Type alias for Y-sortable entities
type YSortableEntity = SpacetimeDBPlayer | SpacetimeDBTree | SpacetimeDBStone | SpacetimeDBWoodenStorageBox;

interface RenderYSortedEntitiesProps {
    ctx: CanvasRenderingContext2D;
    ySortedEntities: YSortableEntity[];
    heroImageRef: React.RefObject<HTMLImageElement | null>;
    lastPositionsRef: React.MutableRefObject<Map<string, { x: number; y: number; }>>;
    activeEquipments: Map<string, SpacetimeDB.ActiveEquipment>;
    itemDefinitions: Map<string, SpacetimeDBItemDefinition>;
    itemImagesRef: React.MutableRefObject<Map<string, HTMLImageElement>>;
    worldMouseX: number | null;
    worldMouseY: number | null;
    animationFrame: number;
    nowMs: number;
    hoveredPlayerIds?: Set<string>; // Optional set of tracked hovered player IDs 
    onPlayerHover?: (playerId: string, isHovered: boolean) => void; // Optional callback for hover state changes
}

/**
 * Renders entities that need to be sorted by their Y-coordinate to create
 * a sense of depth (Players, Trees, Stones, Storage Boxes).
 * Assumes the `ySortedEntities` array is already sorted.
 */
export const renderYSortedEntities = ({
    ctx,
    ySortedEntities,
    heroImageRef,
    lastPositionsRef,
    activeEquipments,
    itemDefinitions,
    itemImagesRef,
    worldMouseX,
    worldMouseY,
    animationFrame,
    nowMs,
    hoveredPlayerIds = new Set(), // Default to empty set
    onPlayerHover = () => {}, // Default to no-op function
}: RenderYSortedEntitiesProps) => {
    ySortedEntities.forEach(entity => {
        if (isPlayer(entity)) {
           // --- Player Rendering Logic (copied from GameCanvas, using passed refs/state) ---
           const playerId = entity.identity.toHexString();
           const lastPos = lastPositionsRef.current.get(playerId);
           let isPlayerMoving = false;
           if (lastPos) {
             const dx = Math.abs(entity.positionX - lastPos.x);
             const dy = Math.abs(entity.positionY - lastPos.y);
             // Use imported constant
             if (dx > MOVEMENT_POSITION_THRESHOLD || dy > MOVEMENT_POSITION_THRESHOLD) { 
               isPlayerMoving = true;
             }
           } else {
             isPlayerMoving = false;
           }
           lastPositionsRef.current.set(playerId, { x: entity.positionX, y: entity.positionY });

           let jumpOffset = 0;
           const jumpStartTime = entity.jumpStartTimeMs;
           if (jumpStartTime > 0) {
               const elapsedJumpTime = nowMs - Number(jumpStartTime);
               // Use imported constants
               if (elapsedJumpTime < JUMP_DURATION_MS) { 
                   const d = JUMP_DURATION_MS;
                   const h = JUMP_HEIGHT_PX;
                   const x = elapsedJumpTime;
                   jumpOffset = (-4 * h / (d * d)) * x * (x - d);
               }
           }
           
           // Check if mouse is currently hovering over this player
           const currentlyHovered = isPlayerHovered(worldMouseX, worldMouseY, entity);
           const isPersistentlyHovered = hoveredPlayerIds.has(playerId);
           
           // Call the callback if:
           // 1. Mouse is non-null and hover state changed
           // 2. Mouse became null and player was previously hovered
           if ((worldMouseX !== null && worldMouseY !== null && currentlyHovered !== isPersistentlyHovered) || 
               (worldMouseX === null && worldMouseY === null && isPersistentlyHovered)) {
             
             // When mouse is null, always set hovered to false
             const newHoverState = (worldMouseX === null || worldMouseY === null) ? false : currentlyHovered;
             onPlayerHover(playerId, newHoverState);
           }
           
           const heroImg = heroImageRef.current;

           // --- Get Equipment Data ---
           const equipment = activeEquipments.get(playerId);
           let itemDef: SpacetimeDBItemDefinition | null = null;
           let itemImg: HTMLImageElement | null = null;

           if (equipment && equipment.equippedItemDefId) {
             itemDef = itemDefinitions.get(equipment.equippedItemDefId.toString()) || null;
             itemImg = (itemDef ? itemImagesRef.current.get(itemDef.iconAssetName) : null) || null;
           }
           const canRenderItem = itemDef && itemImg && itemImg.complete && itemImg.naturalHeight !== 0;

           // --- Conditional Rendering Order ---
           if (entity.direction === 'left' || entity.direction === 'up') {
              // Draw Item BEHIND Player
              if (canRenderItem && equipment) {
                renderEquippedItem(ctx, entity, equipment, itemDef!, itemImg!, nowMs, jumpOffset);
              }
              // Draw Player
              if (heroImg) {
                renderPlayer(
                  ctx, entity, heroImg, isPlayerMoving, currentlyHovered, 
                  animationFrame, nowMs, jumpOffset, 
                  isPersistentlyHovered // Pass tracked hover state
                );
              }
           } else { // direction === 'right' or 'down'
              // Draw Player FIRST
              if (heroImg) {
                renderPlayer(
                  ctx, entity, heroImg, isPlayerMoving, currentlyHovered, 
                  animationFrame, nowMs, jumpOffset, 
                  isPersistentlyHovered // Pass tracked hover state
                );
              }
              // Draw Item IN FRONT of Player
              if (canRenderItem && equipment) {
                renderEquippedItem(ctx, entity, equipment, itemDef!, itemImg!, nowMs, jumpOffset);
              }
           }
           // --- End Conditional Rendering Order ---
        } else if (isTree(entity)) { 
           renderTree(ctx, entity, nowMs);
        } else if (isStone(entity)) { 
           renderStone(ctx, entity, nowMs);
        } else if (isWoodenStorageBox(entity)) {
            renderWoodenStorageBox(ctx, entity.posX, entity.posY);
        } 
    });
}; 