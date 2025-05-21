import { Player as SpacetimeDBPlayer, ActiveConsumableEffect, EffectType } from '../../generated';
import { gameConfig } from '../../config/gameConfig';
import { drawShadow } from './shadowUtils';

// --- Constants --- 
export const IDLE_FRAME_INDEX = 1; // Second frame is idle
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
  currentAnimationFrame: number,
  isUsingItem: boolean
): { sx: number, sy: number } => {
  let spriteRow = 2; // Default Down
  switch (player.direction) {
    case 'up':    spriteRow = 0; break;
    case 'right': spriteRow = 1; break;
    case 'down':  spriteRow = 2; break;
    case 'left':  spriteRow = 3; break;
    default:      spriteRow = 2; break;
  }
  let frameIndex = isMoving ? currentAnimationFrame : IDLE_FRAME_INDEX;
  if (isUsingItem) {
    // Simple 2-frame rocking animation using frame 0 and 1 of the current direction row
    frameIndex = currentAnimationFrame % 2; 
  }
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
  activeConsumableEffects?: Map<string, ActiveConsumableEffect>,
  localPlayerId?: string,
  isCorpse?: boolean // New flag for corpse rendering
) => {
  // REMOVE THE NAME TAG RENDERING BLOCK FROM HERE
  // const { positionX, positionY, direction, color, username } = player;
  // const drawX = positionX - gameConfig.spriteWidth / 2;
  // const drawY = positionY - gameConfig.spriteHeight / 2 - jumpOffsetY;
  // ctx.save();
  // ... (removed name tag code) ...
  // ctx.restore();

  // --- Hide player if dead (unless it's a corpse being rendered) ---
  if (!isCorpse && player.isDead) {
    // console.log(`Skipping render for dead player: ${player.username}`);
    // Clean up visual state if player is dead
    if (player.identity) {
        playerVisualKnockbackState.delete(player.identity.toHexString());
    }
    return; // Don't render anything if dead
  }

  // --- Knockback Interpolation Logic (Skip for corpses) ---
  let currentDisplayX: number = player.positionX;
  let currentDisplayY: number = player.positionY;
  let visualState = playerVisualKnockbackState.get(player.identity.toHexString());

  if (!isCorpse) {
    const serverX = player.positionX;
    const serverY = player.positionY;
    const serverLastHitMicros = player.lastHitTime?.microsSinceUnixEpoch ?? 0n;

    // @ts-ignore - Conditional logging for debugging
    if (window.enablePlayerHitDebugging && player.identity.toHexString() === window.debugPlayerIdForHit) {
      console.log(`[PlayerRenderDebug] Player: ${player.username}, serverLastHitMicros: ${serverLastHitMicros}, visualState before:`, visualState ? { ...visualState } : null);
    }

    if (!visualState) {
      visualState = {
        displayX: serverX, displayY: serverY,
        serverX, serverY,
        lastHitTimeMicros: serverLastHitMicros,
        interpolationSourceX: serverX, interpolationSourceY: serverY,
        interpolationTargetX: serverX, interpolationTargetY: serverY,
        interpolationStartTime: 0,
      };
      playerVisualKnockbackState.set(player.identity.toHexString(), visualState);
      currentDisplayX = serverX;
      currentDisplayY = serverY;
      // @ts-ignore
      if (window.enablePlayerHitDebugging && player.identity.toHexString() === window.debugPlayerIdForHit) {
        console.log(`[PlayerRenderDebug] Initialized visualState. Current display: (${currentDisplayX}, ${currentDisplayY})`);
      }
    } else {
      if (serverLastHitMicros > visualState.lastHitTimeMicros) {
        // @ts-ignore
        if (window.enablePlayerHitDebugging && player.identity.toHexString() === window.debugPlayerIdForHit) {
          console.log(`[PlayerRenderDebug] New hit DETECTED for ${player.username}! serverLastHitMicros (${serverLastHitMicros}) > visualState.lastHitTimeMicros (${visualState.lastHitTimeMicros}). Setting interpolationStartTime to ${nowMs}.`);
        }
        visualState.interpolationSourceX = visualState.displayX;
        visualState.interpolationSourceY = visualState.displayY;
        visualState.interpolationTargetX = serverX;
        visualState.interpolationTargetY = serverY;
        visualState.interpolationStartTime = nowMs;
        visualState.lastHitTimeMicros = serverLastHitMicros;
      }

      if (visualState.interpolationStartTime > 0 && nowMs < visualState.interpolationStartTime + KNOCKBACK_INTERPOLATION_DURATION_MS) {
        const elapsed = nowMs - visualState.interpolationStartTime;
        const t = Math.min(1, elapsed / KNOCKBACK_INTERPOLATION_DURATION_MS);
        currentDisplayX = lerp(visualState.interpolationSourceX, visualState.interpolationTargetX, t);
        currentDisplayY = lerp(visualState.interpolationSourceY, visualState.interpolationTargetY, t);
      } else {
        currentDisplayX = serverX;
        currentDisplayY = serverY;
        if (visualState.interpolationStartTime > 0) {
          visualState.interpolationStartTime = 0;
        }
      }
    }
    visualState.displayX = currentDisplayX;
    visualState.displayY = currentDisplayY;
    visualState.serverX = serverX;
    visualState.serverY = serverY;
  } else { // For corpses, use direct position and clear any existing visual state
    currentDisplayX = player.positionX;
    currentDisplayY = player.positionY;
    if (visualState) {
        playerVisualKnockbackState.delete(player.identity.toHexString());
    }
  }
  // --- End Knockback Interpolation Logic ---

  let isUsingItem = false;
  if (!isCorpse && activeConsumableEffects) {
    for (const effect of activeConsumableEffects.values()) {
      if (player.identity && effect.playerId.toHexString() === player.identity.toHexString() && effect.effectType.tag === "BandageBurst") { 
        isUsingItem = true;
        break;
      }
    }
  }

  const finalIsMoving = isCorpse ? false : isMoving;
  const finalAnimationFrame = isCorpse ? IDLE_FRAME_INDEX : currentAnimationFrame;

  const { sx, sy } = getSpriteCoordinates(player, finalIsMoving, finalAnimationFrame, isUsingItem);
  
  // --- Calculate Shake Offset (Skip for corpses) ---
  let shakeX = 0;
  let shakeY = 0;
  if (!isCorpse && !player.isDead && player.lastHitTime) {
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
  const spriteBaseX = currentDisplayX - drawWidth / 2 + shakeX;
  const spriteBaseY = currentDisplayY - drawHeight / 2 + shakeY;
  const finalJumpOffsetY = isCorpse ? 0 : jumpOffsetY;
  const spriteDrawY = spriteBaseY - finalJumpOffsetY;

  // --- Determine if flashing (Skip for corpses) ---
  const isFlashing = !isCorpse && visualState && visualState.interpolationStartTime > 0 &&
                     nowMs < visualState.interpolationStartTime + PLAYER_HIT_FLASH_DURATION_MS;
  // --- End Determine if flashing ---

  // @ts-ignore
  if (window.enablePlayerHitDebugging && player.identity.toHexString() === window.debugPlayerIdForHit && visualState) {
    console.log(`[PlayerRenderDebug] ${player.username} - isFlashing: ${isFlashing}, interpolationStartTime: ${visualState.interpolationStartTime}, nowMs: ${nowMs}, flashEndsAt: ${visualState.interpolationStartTime + PLAYER_HIT_FLASH_DURATION_MS}`);
  }

  // Define shadow base offset here to be used by both online/offline
  const shadowBaseYOffset = drawHeight * 0.4; 
  const finalIsOnline = isCorpse ? false : isOnline;

  // --- Draw Offline Shadow (or Corpse Shadow) --- 
  if (!finalIsOnline) { // This covers corpses (finalIsOnline = false) and offline players
      const shadowBaseRadiusX = drawWidth * 0.3;
      const shadowBaseRadiusY = shadowBaseRadiusX * 0.4;
      drawShadow(
          ctx,
          currentDisplayX, 
          currentDisplayY + drawHeight * 0.1, 
          shadowBaseRadiusX, 
          shadowBaseRadiusY  
      );
  }
  // --- End Shadow ---

  // --- Draw Shadow (Only if alive and online, and not a corpse) ---
  if (!isCorpse && !player.isDead && finalIsOnline) {
      const shadowBaseRadiusX = drawWidth * 0.3;
      const shadowBaseRadiusY = shadowBaseRadiusX * 0.4;
      const shadowMaxJumpOffset = 10; 
      const shadowYOffsetFromJump = finalJumpOffsetY * (shadowMaxJumpOffset / playerRadius); 
      const jumpProgress = Math.min(1, finalJumpOffsetY / playerRadius); 
      const shadowScale = 1.0 - jumpProgress * 0.4; 

      drawShadow(
        ctx, 
        currentDisplayX, 
        currentDisplayY + shadowBaseYOffset + shadowYOffsetFromJump, 
        shadowBaseRadiusX * shadowScale, 
        shadowBaseRadiusY * shadowScale  
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
    if (!finalIsOnline) { 
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

  if (!isCorpse && !player.isDead) {
    // Restore the logic using both hover and shouldShowLabel
    const showingDueToCurrentHover = isHovered; // Use the direct hover state
    const showingDueToPersistentState = shouldShowLabel; // Restore persistent state check
    const willShowLabel = showingDueToCurrentHover || showingDueToPersistentState;
    
    drawNameTag(ctx, player, spriteDrawY, currentDisplayX + shakeX, finalIsOnline, willShowLabel); 
  }
}; 