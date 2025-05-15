import { Player as SpacetimeDBPlayer } from '../../generated';
import { gameConfig } from '../../config/gameConfig';
import { drawShadow } from './shadowUtils';

// --- Constants --- 
const IDLE_FRAME_INDEX = 1; // Second frame is idle
const PLAYER_SHAKE_DURATION_MS = 200; // How long the shake lasts
const PLAYER_SHAKE_AMOUNT_PX = 3;   // Max pixels to offset
// Defined here as it depends on spriteWidth from config
const playerRadius = gameConfig.spriteWidth / 2;

// --- NEW: Knockback Interpolation Constants and State ---
const KNOCKBACK_INTERPOLATION_DURATION_MS = 150; // Duration of the smooth knockback visual
const PLAYER_HIT_FLASH_DURATION_MS = 100; // Duration of the white flash on hit

interface PlayerVisualKnockbackState {
  // Current visual position (result of last frame's interpolation)
  displayX: number;
  displayY: number;

  // Last known server position (used to detect changes)
  serverX: number;
  serverY: number;

  // Last known server hit time (to detect new hits)
  lastHitTimeMicros: bigint;

  // Interpolation state
  interpolationSourceX: number;
  interpolationSourceY: number;
  interpolationTargetX: number;
  interpolationTargetY: number;
  interpolationStartTime: number; // ms, 0 if not interpolating
}

const playerVisualKnockbackState = new Map<string, PlayerVisualKnockbackState>();

// Linear interpolation function
const lerp = (a: number, b: number, t: number): number => a * (1 - t) + b * t;

// --- NEW: Reusable Offscreen Canvas for Tinting ---
const offscreenCanvas = document.createElement('canvas');
const offscreenCtx = offscreenCanvas.getContext('2d');
if (!offscreenCtx) {
  console.error("Failed to get 2D context from offscreen canvas for player rendering.");
}
// --- END NEW ---

const PLAYER_NAME_FONT = '12px "Press Start 2P", cursive';

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

  ctx.font = PLAYER_NAME_FONT;
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
    // Clean up visual state if player is dead
    if (player.identity) {
        playerVisualKnockbackState.delete(player.identity.toHexString());
    }
    return; // Don't render anything if dead
  }

  // --- Knockback Interpolation Logic ---
  const identityHex = player.identity.toHexString();
  let visualState = playerVisualKnockbackState.get(identityHex);

  const serverX = player.positionX;
  const serverY = player.positionY;
  const serverLastHitMicros = player.lastHitTime?.microsSinceUnixEpoch ?? 0n;

  let currentDisplayX: number;
  let currentDisplayY: number;

  if (!visualState) {
    visualState = {
      displayX: serverX, displayY: serverY,
      serverX, serverY,
      lastHitTimeMicros: serverLastHitMicros,
      interpolationSourceX: serverX, interpolationSourceY: serverY,
      interpolationTargetX: serverX, interpolationTargetY: serverY,
      interpolationStartTime: 0,
    };
    playerVisualKnockbackState.set(identityHex, visualState);
    currentDisplayX = serverX;
    currentDisplayY = serverY;
  } else {
    // Detect new hit from server
    if (serverLastHitMicros > visualState.lastHitTimeMicros) {
      // Start new interpolation
      visualState.interpolationSourceX = visualState.displayX; // Start from current visual position
      visualState.interpolationSourceY = visualState.displayY;
      visualState.interpolationTargetX = serverX; // Target is the new server position
      visualState.interpolationTargetY = serverY;
      visualState.interpolationStartTime = nowMs;
      visualState.lastHitTimeMicros = serverLastHitMicros;
    }

    // If currently interpolating
    if (visualState.interpolationStartTime > 0 && nowMs < visualState.interpolationStartTime + KNOCKBACK_INTERPOLATION_DURATION_MS) {
      const elapsed = nowMs - visualState.interpolationStartTime;
      const t = Math.min(1, elapsed / KNOCKBACK_INTERPOLATION_DURATION_MS);
      currentDisplayX = lerp(visualState.interpolationSourceX, visualState.interpolationTargetX, t);
      currentDisplayY = lerp(visualState.interpolationSourceY, visualState.interpolationTargetY, t);
    } else {
      // Not interpolating or interpolation finished, snap to server position
      currentDisplayX = serverX;
      currentDisplayY = serverY;
      if (visualState.interpolationStartTime > 0) { // If it was interpolating, mark as finished
        visualState.interpolationStartTime = 0; 
      }
    }
  }
  
  // Update visual state for next frame's reference
  visualState.displayX = currentDisplayX;
  visualState.displayY = currentDisplayY;
  visualState.serverX = serverX; // Always track the latest server position
  visualState.serverY = serverY;
  // visualState.lastHitTimeMicros is updated when a new hit is detected.

  // --- End Knockback Interpolation Logic ---

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
  const spriteBaseX = currentDisplayX - drawWidth / 2 + shakeX; // MODIFIED: Use currentDisplayX
  const spriteBaseY = currentDisplayY - drawHeight / 2 + shakeY; // MODIFIED: Use currentDisplayY
  const spriteDrawY = spriteBaseY - jumpOffsetY;

  // --- Determine if flashing (based on knockback interpolation start time) ---
  const isFlashing = visualState.interpolationStartTime > 0 &&
                     nowMs < visualState.interpolationStartTime + PLAYER_HIT_FLASH_DURATION_MS;
  // --- End Determine if flashing ---

  // Define shadow base offset here to be used by both online/offline
  const shadowBaseYOffset = drawHeight * 0.4; 

  // --- Draw Offline Shadow --- 
  if (!isOnline) {
      // Use base shadow parameters consistent with online shadow
      const shadowBaseRadiusX = drawWidth * 0.3;
      const shadowBaseRadiusY = shadowBaseRadiusX * 0.4;
      drawShadow(
          ctx,
          currentDisplayX, // MODIFIED: Use currentDisplayX
          currentDisplayY + drawHeight * 0.1, // MODIFIED: Use currentDisplayY
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
        currentDisplayX, // MODIFIED: Use currentDisplayX
        currentDisplayY + shadowBaseYOffset + shadowYOffsetFromJump, // MODIFIED: Use currentDisplayY
        shadowBaseRadiusX * shadowScale, // Scaled Radius X
        shadowBaseRadiusY * shadowScale  // Scaled Radius Y
      );
  }
  // --- End Draw Shadow ---

  // --- Draw Sprite ---
  ctx.save(); // Save for rotation and flash effects
  try {
    const centerX = spriteBaseX + drawWidth / 2; // Uses spriteBaseX which is based on currentDisplayX
    const centerY = spriteDrawY + drawHeight / 2; // Uses spriteDrawY which is based on currentDisplayY

    // --- Prepare sprite on offscreen canvas (for tinting) ---
    if (offscreenCtx && heroImg) {
      offscreenCanvas.width = gameConfig.spriteWidth;
      offscreenCanvas.height = gameConfig.spriteHeight;
      offscreenCtx.clearRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);
      
      // Draw the original sprite frame to the offscreen canvas
      offscreenCtx.drawImage(
        heroImg as CanvasImageSource, // Cast because heroImg can be HTMLImageElement | null
        sx, sy, gameConfig.spriteWidth, gameConfig.spriteHeight,
        0, 0, gameConfig.spriteWidth, gameConfig.spriteHeight
      );

      // Apply white flash if active by tinting the offscreen canvas content
      if (isFlashing) {
        offscreenCtx.globalCompositeOperation = 'source-in'; // Key for tinting with original alpha
        offscreenCtx.fillStyle = 'rgba(255, 255, 255, 0.85)'; // Flash color
        offscreenCtx.fillRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);
        offscreenCtx.globalCompositeOperation = 'source-over'; // Reset for next use
      }
    } else if (!heroImg) {
      // console.warn("heroImg is null, cannot draw player sprite.");
      // Fallback or skip drawing if heroImg is not loaded - though asset loader should handle this.
      return; // Exit if no hero image
    }
    // --- End Prepare sprite on offscreen canvas ---

    // Apply rotation if player is offline (or dead, though dead players are skipped earlier)
    if (!isOnline) { 
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

    // Draw the (possibly tinted) offscreen canvas to the main canvas
    if (offscreenCtx) {
      ctx.drawImage(
        offscreenCanvas, 
        0, 0, gameConfig.spriteWidth, gameConfig.spriteHeight, // Source rect from offscreen canvas
        spriteBaseX, spriteDrawY, drawWidth, drawHeight // Destination rect on main canvas
      );
    }

  } finally {
      ctx.restore(); // Restores rotation and globalCompositeOperation
  }
  // --- End Draw Sprite ---

  if (!player.isDead) {
    // Restore the logic using both hover and shouldShowLabel
    const showingDueToCurrentHover = isHovered; // Use the direct hover state
    const showingDueToPersistentState = shouldShowLabel; // Restore persistent state check
    const willShowLabel = showingDueToCurrentHover || showingDueToPersistentState;
    
    drawNameTag(ctx, player, spriteDrawY, currentDisplayX + shakeX, isOnline, willShowLabel); // MODIFIED: Pass currentDisplayX + shakeX for name tag centering
  }
}; 