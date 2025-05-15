import { Player as SpacetimeDBPlayer } from '../../generated';
import { gameConfig } from '../../config/gameConfig';
import { drawShadow } from './shadowUtils';

// --- Constants --- 
const IDLE_FRAME_INDEX = 1; // Second frame is idle
const PLAYER_SHAKE_DURATION_MS = 200; // How long the shake lasts
const PLAYER_SHAKE_AMOUNT_PX = 3;   // Max pixels to offset
// Defined here as it depends on spriteWidth from config
const playerRadius = gameConfig.spriteWidth / 2;

const PLAYER_NAME_FONT = '12px "Press Start 2P", cursive';
const PLAYER_NAME_FILL_STYLE = "white";
const PLAYER_NAME_STROKE_STYLE = "black";
const PLAYER_NAME_LINE_WIDTH = 2;
const PLAYER_NAME_TEXT_ALIGN = "center";
const PLAYER_NAME_Y_OFFSET = -50; // Offset above the player sprite

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
  isOnline: boolean, // <<< CHANGED: Pass explicit online status
  showLabel: boolean = true // Add parameter to control visibility
) => {
  if (!showLabel) return; // Skip rendering if not showing label
  
  // --- MODIFIED: Use passed isOnline flag ---
  const usernameText = isOnline
    ? player.username
    : `${player.username} (offline)`;
  // --- END MODIFICATION ---

  ctx.font = '12px Arial';
  ctx.textAlign = 'center';
  const textWidth = ctx.measureText(usernameText).width; // Use modified text
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
  ctx.fillText(usernameText, spriteX, tagY + tagHeight / 2 + 4); // Use modified text
};

// Renders a complete player (sprite, shadow, and conditional name tag)
export const renderPlayer = (
  ctx: CanvasRenderingContext2D,
  player: SpacetimeDBPlayer,
  heroImg: CanvasImageSource,
  isOnline: boolean,
  isMoving: boolean,
  isHovered: boolean,
  currentAnimationFrame: number,
  nowMs: number,
  jumpOffsetY: number = 0,
  shouldShowLabel: boolean = false,
  currentlyHovered: boolean = false
) => {
  // REMOVE THE NAME TAG RENDERING BLOCK FROM HERE
  // const { positionX, positionY, direction, color, username } = player;
  // const drawX = positionX - gameConfig.spriteWidth / 2;
  // const drawY = positionY - gameConfig.spriteHeight / 2 - jumpOffsetY;
  // ctx.save();
  // ... (removed name tag code) ...
  // ctx.restore();

  // --- Hide player if dead ---
  if (player.isDead) {
    // console.log(`Skipping render for dead player: ${player.username}`);
    return; // Don't render anything if dead
  }

  const { sx, sy } = getSpriteCoordinates(player, isMoving, currentAnimationFrame);
  
  // --- Calculate Shake Offset (Only if alive and online) ---
  let shakeX = 0;
  let shakeY = 0;
  // --- MODIFIED: Check passed isOnline flag ---
  if (!player.isDead && player.lastHitTime) {
  // --- END MODIFICATION ---
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

  // Define shadow base offset here to be used by both online/offline
  const shadowBaseYOffset = drawHeight * 0.4; 

  // --- Draw Offline Shadow --- 
  if (!isOnline) {
      // Use base shadow parameters consistent with online shadow
      const shadowBaseRadiusX = drawWidth * 0.3;
      const shadowBaseRadiusY = shadowBaseRadiusX * 0.4;
      drawShadow(
          ctx,
          player.positionX, // Center shadow below player's core position
          player.positionY + drawHeight * 0.1, // Adjusted Base Y (moved up)
          shadowBaseRadiusX, // Consistent base radius X
          shadowBaseRadiusY  // Consistent base radius Y
      );
  }
  // --- End Shadow ---

  // --- Draw Shadow (Only if alive and online) ---
  if (!player.isDead && isOnline) {
      const shadowBaseRadiusX = drawWidth * 0.3;
      const shadowBaseRadiusY = shadowBaseRadiusX * 0.4;
      const shadowMaxJumpOffset = 10; 
      const shadowYOffsetFromJump = jumpOffsetY * (shadowMaxJumpOffset / playerRadius); 
      // const shadowBaseYOffset = drawHeight * 0.4; // Already defined above
      const jumpProgress = Math.min(1, jumpOffsetY / playerRadius); 
      const shadowScale = 1.0 - jumpProgress * 0.4; 
      // const shadowOpacity = 0.5 - jumpProgress * 0.3; // drawShadow handles opacity

      // Use the imported drawShadow function
      drawShadow(
        ctx, 
        player.positionX, // Center X
        player.positionY + shadowBaseYOffset + shadowYOffsetFromJump, // Adjusted Base Y
        shadowBaseRadiusX * shadowScale, // Scaled Radius X
        shadowBaseRadiusY * shadowScale  // Scaled Radius Y
      );
  }
  // --- End Draw Shadow ---

  // --- Draw Sprite ---
  ctx.save();
  try {
    const centerX = spriteBaseX + drawWidth / 2;
    const centerY = spriteDrawY + drawHeight / 2;

    if (player.isDead || !isOnline) { 
      let rotationAngleRad = 0;
      switch (player.direction) {
        case 'up':    
        case 'right': 
          rotationAngleRad = -Math.PI / 2; 
          break;
        case 'down':  
        case 'left':  
        default:
          rotationAngleRad = Math.PI / 2; 
          break;
      }
      ctx.translate(centerX, centerY);
      ctx.rotate(rotationAngleRad);
      ctx.translate(-centerX, -centerY);
    }

    ctx.drawImage(
      heroImg, 
      sx, sy, gameConfig.spriteWidth, gameConfig.spriteHeight, 
      spriteBaseX, spriteDrawY, drawWidth, drawHeight 
    );

  } finally {
      ctx.restore(); 
  }
  // --- End Draw Sprite ---

  if (!player.isDead) {
    // Restore the logic using both hover and shouldShowLabel
    const showingDueToCurrentHover = isHovered; // Use the direct hover state
    const showingDueToPersistentState = shouldShowLabel; // Restore persistent state check
    const willShowLabel = showingDueToCurrentHover || showingDueToPersistentState;
    
    drawNameTag(ctx, player, spriteDrawY, spriteBaseX + drawWidth / 2, isOnline, willShowLabel);
  }
}; 