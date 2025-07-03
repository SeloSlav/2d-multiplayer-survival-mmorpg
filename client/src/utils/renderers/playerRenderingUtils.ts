import { Player as SpacetimeDBPlayer, ActiveEquipment as SpacetimeDBActiveEquipment, ItemDefinition as SpacetimeDBItemDefinition, ActiveConsumableEffect, EffectType } from '../../generated';
import { gameConfig } from '../../config/gameConfig';
import { drawShadow, drawDynamicGroundShadow } from './shadowUtils';
import { JUMP_DURATION_MS } from '../../config/gameConfig'; // Import the constant

// --- Constants --- 
export const IDLE_FRAME_INDEX = 1; // Second frame is idle
const PLAYER_SHAKE_DURATION_MS = 200; // How long the shake lasts
const PLAYER_SHAKE_AMOUNT_PX = 3;   // Max pixels to offset
const PLAYER_HIT_FLASH_DURATION_MS = 100; // Duration of the white flash on hit
const PLAYER_WALKING_SPRITE_SWITCH_INTERVAL_MS = 400; // Switch sprite every 400ms while walking

// OPTIMIZATION: Prioritize performance during sprinting
const SPRINT_OPTIMIZED_SHAKE_AMOUNT_PX = 2; // Reduced shake during sprinting for smoother movement

// --- NEW: Combat effect timing compensation ---
const COMBAT_EFFECT_LATENCY_BUFFER_MS = 300; // Extra time to account for network latency
const MAX_REASONABLE_SERVER_LAG_MS = 1000; // Ignore hits that seem too old (probably stale data)

// Defined here as it depends on spriteWidth from config
const playerRadius = gameConfig.spriteWidth / 2;

// --- NEW: Knockback Interpolation Constants and State ---
const KNOCKBACK_INTERPOLATION_DURATION_MS = 150; // Duration of the smooth knockback visual

interface PlayerVisualKnockbackState {
  displayX: number;
  displayY: number;
  serverX: number;
  serverY: number;
  lastHitTimeMicros: bigint; // Still used to detect *new* hit events for starting interpolation
  interpolationSourceX: number;
  interpolationSourceY: number;
  interpolationTargetX: number;
  interpolationTargetY: number;
  interpolationStartTime: number; 
  clientHitDetectionTime: number; // NEW: Track when we detected the hit on client
}

// --- NEW: Track hit states for reliable effect timing ---
interface PlayerHitState {
  lastProcessedHitTime: bigint;
  clientDetectionTime: number;
  effectStartTime: number;
}

const playerHitStates = new Map<string, PlayerHitState>();

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

const PLAYER_NAME_FONT = '12px "Courier New", Consolas, Monaco, monospace'; // 🎯 CYBERPUNK: Match interaction label styling

// --- Client-side animation tracking ---
const clientJumpStartTimes = new Map<string, number>(); // playerId -> client timestamp when jump started
const lastKnownServerJumpTimes = new Map<string, number>(); // playerId -> last known server timestamp

// --- Helper Functions --- 

// Calculates sx, sy for the spritesheet
export const getSpriteCoordinates = (
  player: SpacetimeDBPlayer,
  isMoving: boolean,
  currentAnimationFrame: number,
  isUsingItem: boolean,
  totalFrames: number = 6, // Total frame count (6 for walking, 8 for sprinting, 16 for idle)
  isIdle: boolean = false // NEW: Flag to indicate idle animation
): { sx: number, sy: number } => {
  // Handle idle animation (4x4 grid layout)
  if (isIdle && !isMoving && !isUsingItem) {
    const idleFrame = currentAnimationFrame % totalFrames; // Ensure frame is within bounds
    const spriteCol = idleFrame % 4; // Cycle through 4 columns (frames) on the row
    
    // Calculate row based on player's facing direction (same logic as movement)
    let spriteRow = 2; // Default Down
    switch (player.direction) {
      case 'up':         spriteRow = 3; break;
      case 'up_right':   spriteRow = 1; break; // Use right sprite for diagonal up-right
      case 'right':      spriteRow = 1; break;
      case 'down_right': spriteRow = 1; break; // Use right sprite for diagonal down-right
      case 'down':       spriteRow = 0; break;
      case 'down_left':  spriteRow = 2; break; // Use left sprite for diagonal down-left
      case 'left':       spriteRow = 2; break;
      case 'up_left':    spriteRow = 2; break; // Use left sprite for diagonal up-left
      default:           spriteRow = 0; break; // Default fallback
    }
    
    const sx = spriteCol * gameConfig.spriteWidth;
    const sy = spriteRow * gameConfig.spriteHeight;
    return { sx, sy };
  }

  // Handle movement animations (walking/sprinting - directional sprite sheets)
  let spriteRow = 2; // Default Down
  switch (player.direction) {
    case 'up':         spriteRow = 3; break;
    case 'up_right':   spriteRow = 1; break; // Use right sprite for diagonal up-right
    case 'right':      spriteRow = 1; break;
    case 'down_right': spriteRow = 1; break; // Use right sprite for diagonal down-right
    case 'down':       spriteRow = 0; break;
    case 'down_left':  spriteRow = 2; break; // Use left sprite for diagonal down-left (FIXED)
    case 'left':       spriteRow = 2; break;
    case 'up_left':    spriteRow = 2; break; // Use left sprite for diagonal up-left
    default:           spriteRow = 0; break; // Default fallback
  }

  // Calculate sprite column
  let spriteCol: number;
  if (isMoving && !isUsingItem) {
    // Use the current animation frame for walking/sprinting (0 to totalFrames-1)
    spriteCol = currentAnimationFrame % totalFrames;
  } else {
    // Static/idle sprite - use frame 1 as the neutral position for all sprite sheets
    spriteCol = 1;
  }

  const sx = spriteCol * gameConfig.spriteWidth;
  const sy = spriteRow * gameConfig.spriteHeight;
  return { sx, sy };
};

// Checks if the mouse is hovering over the player
export const isPlayerHovered = (
  worldMouseX: number | null,
  worldMouseY: number | null,
  player: SpacetimeDBPlayer
): boolean => {
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
  heroSprintImg: CanvasImageSource,
  heroIdleImg: CanvasImageSource, // NEW: Add idle sprite parameter
  isOnline: boolean,
  isMoving: boolean,
  isHovered: boolean,
  currentAnimationFrame: number,
  nowMs: number,
  jumpOffsetY: number = 0,
  shouldShowLabel: boolean = false,
  activeConsumableEffects?: Map<string, ActiveConsumableEffect>,
  localPlayerId?: string,
  isCorpse?: boolean, // New flag for corpse rendering
  cycleProgress: number = 0.375 // Day/night cycle progress (0.0 to 1.0), default to noon-ish
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
    if (player.identity) {
        const playerHexIdForDelete = player.identity.toHexString();
        if (playerVisualKnockbackState.has(playerHexIdForDelete)) {
            // Removed log
            playerVisualKnockbackState.delete(playerHexIdForDelete);
        }
        // --- NEW: Also cleanup hit states for dead players ---
        if (playerHitStates.has(playerHexIdForDelete)) {
            playerHitStates.delete(playerHexIdForDelete);
        }
    }
    return;
  }

  let currentDisplayX: number = player.positionX;
  let currentDisplayY: number = player.positionY;
  const playerHexId = player.identity.toHexString();
  let visualState = playerVisualKnockbackState.get(playerHexId);

  const serverX = player.positionX;
  const serverY = player.positionY;
  const serverLastHitTimePropMicros = player.lastHitTime?.microsSinceUnixEpoch ?? 0n;
  
  // --- NEW: Improved hit detection and effect timing ---
  let hitState = playerHitStates.get(playerHexId);
  let isCurrentlyHit = false;
  let hitEffectElapsed = 0;
  
  if (serverLastHitTimePropMicros > 0n) {
    // --- IMPROVED: Use threshold-based comparison to prevent spurious re-detections ---
    const DETECTION_THRESHOLD_MICROS = 1000n; // 1ms threshold to account for minor server timing variations
    const isNewHit = !hitState || 
                    (serverLastHitTimePropMicros > hitState.lastProcessedHitTime && 
                     (serverLastHitTimePropMicros - hitState.lastProcessedHitTime) > DETECTION_THRESHOLD_MICROS);
    
    if (isNewHit) {
      // NEW HIT DETECTED! Set up effect timing based on client time
      const oldHitTime = hitState?.lastProcessedHitTime || 0n;
      hitState = {
        lastProcessedHitTime: serverLastHitTimePropMicros,
        clientDetectionTime: nowMs,
        effectStartTime: nowMs
      };
      playerHitStates.set(playerHexId, hitState);
      console.log(`🎯 [COMBAT] Hit detected for player ${playerHexId} at client time ${nowMs} (server: ${serverLastHitTimePropMicros}, old: ${oldHitTime}, diff: ${serverLastHitTimePropMicros - oldHitTime})`);
    }
    
    // Calculate effect timing based on when WE detected the hit
    if (hitState) {
      hitEffectElapsed = nowMs - hitState.effectStartTime;
      isCurrentlyHit = hitEffectElapsed < (PLAYER_SHAKE_DURATION_MS + COMBAT_EFFECT_LATENCY_BUFFER_MS);
      
      // --- DEBUGGING: Log potential infinite loops ---
      if (hitEffectElapsed < 5 && !isNewHit) {
        console.log(`🎯 [DEBUG] Potential infinite hit loop for player ${playerHexId}: elapsed=${hitEffectElapsed.toFixed(1)}ms, server=${serverLastHitTimePropMicros}, stored=${hitState.lastProcessedHitTime}, diff=${serverLastHitTimePropMicros - hitState.lastProcessedHitTime}`);
      }
    }
  } else {
    // No hit time from server - clear hit state
    if (hitState) {
      console.log(`🎯 [COMBAT] Clearing hit state for player ${playerHexId} (server hit time is 0)`);
      playerHitStates.delete(playerHexId);
    }
  }
  
  // Legacy calculation for fallback (but prioritize new system)
  const serverLastHitTimeMs = serverLastHitTimePropMicros > 0n ? Number(serverLastHitTimePropMicros / 1000n) : 0;
  const elapsedSinceServerHitMs = serverLastHitTimeMs > 0 ? (nowMs - serverLastHitTimeMs) : Infinity;
  
  // Use new hit detection if available, otherwise fall back to old system
  const effectiveHitElapsed = isCurrentlyHit ? hitEffectElapsed : elapsedSinceServerHitMs;
  const shouldShowCombatEffects = isCurrentlyHit || elapsedSinceServerHitMs < PLAYER_SHAKE_DURATION_MS;
  // --- END NEW hit detection ---

  // Only apply knockback interpolation for NON-local players
  // Local player position is handled by the prediction system
  const isLocalPlayer = localPlayerId && playerHexId === localPlayerId;

  if (!isCorpse && !isLocalPlayer) {
    // Knockback interpolation for other players only
    if (!visualState) {
      visualState = {
        displayX: serverX, displayY: serverY,
        serverX, serverY,
        lastHitTimeMicros: serverLastHitTimePropMicros,
        interpolationSourceX: serverX, interpolationSourceY: serverY,
        interpolationTargetX: serverX, interpolationTargetY: serverY, 
        interpolationStartTime: 0,
        clientHitDetectionTime: 0,
      };
      playerVisualKnockbackState.set(playerHexId, visualState);
    } else {
      // --- IMPROVED: Use new hit detection for knockback interpolation ---
      if (isCurrentlyHit && hitState && hitState.clientDetectionTime > visualState.clientHitDetectionTime) {
        // NEW HIT DETECTED - start knockback interpolation
        visualState.interpolationSourceX = visualState.displayX;
        visualState.interpolationSourceY = visualState.displayY;
        visualState.interpolationTargetX = serverX;
        visualState.interpolationTargetY = serverY;
        visualState.interpolationStartTime = nowMs;
        visualState.lastHitTimeMicros = serverLastHitTimePropMicros;
        visualState.clientHitDetectionTime = hitState.clientDetectionTime;
        console.log(`🎯 [KNOCKBACK] Starting interpolation for player ${playerHexId} from (${visualState.interpolationSourceX.toFixed(1)}, ${visualState.interpolationSourceY.toFixed(1)}) to (${serverX.toFixed(1)}, ${serverY.toFixed(1)})`);
      } else if (serverLastHitTimePropMicros > visualState.lastHitTimeMicros) {
        // FALLBACK: Old detection method for compatibility
        visualState.interpolationSourceX = visualState.displayX;
        visualState.interpolationSourceY = visualState.displayY;
        visualState.interpolationTargetX = serverX;
        visualState.interpolationTargetY = serverY;
        visualState.interpolationStartTime = nowMs;
        visualState.lastHitTimeMicros = serverLastHitTimePropMicros;
        visualState.clientHitDetectionTime = nowMs;
      }
      else if (!player.isDead && serverLastHitTimePropMicros === 0n && visualState.lastHitTimeMicros !== 0n) {
        visualState.lastHitTimeMicros = 0n;
      }
    }
    
    // Apply knockback interpolation
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
    
    visualState.displayX = currentDisplayX; 
    visualState.displayY = currentDisplayY;
    visualState.serverX = serverX; 
    visualState.serverY = serverY;

  } else if (!isCorpse && isLocalPlayer) {
    // For local player, clean up any knockback state and use position as-is
    // (position will be the predicted position passed from renderingUtils)
    if (visualState) {
        playerVisualKnockbackState.delete(playerHexId);
    }
    currentDisplayX = player.positionX;
    currentDisplayY = player.positionY;
  } else {
    // Corpses use direct position
    currentDisplayX = player.positionX;
    currentDisplayY = player.positionY;
    if (visualState) {
        playerVisualKnockbackState.delete(playerHexId);
    }
  }
  // --- End Knockback Interpolation Logic ---

  let isUsingItem = false;
  let isUsingSeloOliveOil = false;
  if (!isCorpse && activeConsumableEffects && player.identity) {
    const playerHexId = player.identity.toHexString();
    for (const effect of activeConsumableEffects.values()) {
      // Check if this player is using a bandage on themselves
      if (effect.effectType.tag === "BandageBurst" && effect.playerId.toHexString() === playerHexId) {
        isUsingItem = true;
        break;
      }
      // Check if this player is healing someone else
      if (effect.effectType.tag === "RemoteBandageBurst" && effect.playerId.toHexString() === playerHexId) {
        isUsingItem = true;
        break;
      }
      // Check if this player is using Selo Olive Oil (HealthRegen effect with 2-second duration)
      if (effect.effectType.tag === "HealthRegen" && effect.playerId.toHexString() === playerHexId) {
        // Check if this is a short-duration effect (2 seconds for Selo Olive Oil vs longer for other items)
        const effectDurationMs = Number(effect.endsAt.microsSinceUnixEpoch / 1000n) - Number(effect.startedAt.microsSinceUnixEpoch / 1000n);
        if (effectDurationMs <= 2500) { // 2.5 seconds to account for slight timing variations
          isUsingSeloOliveOil = true;
          break;
        }
      }
    }
  }

  const finalIsMoving = isCorpse ? false : isMoving;
  const finalAnimationFrame = isCorpse ? IDLE_FRAME_INDEX : currentAnimationFrame;

  // Calculate if player is currently jumping (same logic as sprite selection)
  let isCurrentlyJumping = false;
  if (!isCorpse && player.jumpStartTimeMs && player.jumpStartTimeMs > 0) {
    const jumpStartTime = Number(player.jumpStartTimeMs);
    const playerId = player.identity.toHexString();
    
    // Check if this is a NEW jump by comparing server timestamps
    const lastKnownServerTime = lastKnownServerJumpTimes.get(playerId) || 0;
    
    if (jumpStartTime !== lastKnownServerTime) {
      // NEW jump detected! Record both server time and client time
      lastKnownServerJumpTimes.set(playerId, jumpStartTime);
      clientJumpStartTimes.set(playerId, nowMs);
    }
    
    // Calculate animation based on client time
    const clientStartTime = clientJumpStartTimes.get(playerId);
    if (clientStartTime) {
      const elapsedJumpTime = nowMs - clientStartTime;
      if (elapsedJumpTime < JUMP_DURATION_MS) {
        isCurrentlyJumping = true;
      }
    }
  } else {
    // Clean up tracking for this player if no active jump
    const playerId = player.identity.toHexString();
    clientJumpStartTimes.delete(playerId);
    lastKnownServerJumpTimes.delete(playerId);
  }

  // Determine frame count and sprite type based on player state
  const isSprinting = (!isCorpse && player.isSprinting && finalIsMoving);
  const isIdleState = (!isCorpse && !finalIsMoving && !isUsingItem && !isUsingSeloOliveOil);
  const isSwimming = (!isCorpse && player.isOnWater && !isCurrentlyJumping);
  
  let totalFrames: number;
  let isIdleAnimation = false;
  
  if (isSwimming) {
    // PRIORITY: Swimming uses 6 frames regardless of other states
    totalFrames = 6; // 6 frames for swimming (same as walking)
  } else if (isIdleState) {
    totalFrames = 16; // 16 frames for idle animation (4x4)
    isIdleAnimation = true;
  } else if (isSprinting) {
    totalFrames = 8; // 8 frames for sprinting
  } else {
    totalFrames = 6; // 6 frames for walking
  }

  const { sx, sy } = getSpriteCoordinates(player, finalIsMoving, finalAnimationFrame, isUsingItem || isUsingSeloOliveOil, totalFrames, isIdleAnimation);
  
  // Shake Logic (directly uses elapsedSinceServerHitMs)
  let shakeX = 0;
  let shakeY = 0;
  if (!isCorpse && !player.isDead && effectiveHitElapsed < PLAYER_SHAKE_DURATION_MS) {
    // OPTIMIZATION: Reduce shake during sprinting for smoother movement
    const shakeAmount = player.isSprinting ? SPRINT_OPTIMIZED_SHAKE_AMOUNT_PX : PLAYER_SHAKE_AMOUNT_PX;
    shakeX = (Math.random() - 0.5) * 2 * shakeAmount;
    shakeY = (Math.random() - 0.5) * 2 * shakeAmount;
    
    // --- DEBUG: Log shake effect for troubleshooting ---
    if (effectiveHitElapsed < 50) { // Only log within first 50ms to avoid spam
      console.log(`🎯 [SHAKE] Player ${playerHexId} shaking: elapsed=${effectiveHitElapsed.toFixed(1)}ms, isCurrentlyHit=${isCurrentlyHit}, shakeAmount=${shakeAmount}`);
    }
  }
  
  // --- SAFETY: Force clear hit states that have been active too long ---
  if (hitState && isCurrentlyHit) {
    const MAX_HIT_EFFECT_DURATION_MS = 2000; // 2 seconds maximum
    const totalHitDuration = nowMs - hitState.clientDetectionTime;
    if (totalHitDuration > MAX_HIT_EFFECT_DURATION_MS) {
      console.log(`🎯 [SAFETY] Force clearing stuck hit state for player ${playerHexId} after ${totalHitDuration}ms`);
      playerHitStates.delete(playerHexId);
      isCurrentlyHit = false;
    }
  }

  const drawWidth = gameConfig.spriteWidth * 2;
  const drawHeight = gameConfig.spriteHeight * 2;
  const spriteBaseX = currentDisplayX - drawWidth / 2 + shakeX;
  const spriteBaseY = currentDisplayY - drawHeight / 2 + shakeY;
  const finalJumpOffsetY = isCorpse ? 0 : jumpOffsetY;
  const spriteDrawY = spriteBaseY - finalJumpOffsetY;

  // Flash Logic (directly uses elapsedSinceServerHitMs)
  const isFlashing = !isCorpse && !player.isDead && effectiveHitElapsed < PLAYER_HIT_FLASH_DURATION_MS;

  // Define shadow base offset here to be used by both online/offline
  const shadowBaseYOffset = drawHeight * 0.4; 
  const finalIsOnline = isCorpse ? false : isOnline;

  // --- Draw Dynamic Ground Shadow (for living players only) ---
  // Don't show shadow on water, but keep showing while jumping (same logic as sprite selection)
  const shouldShowShadow = !isCorpse && !(player.isOnWater && !isCurrentlyJumping);
  
  // NEW: Choose sprite based on player state
  let currentSpriteImg: CanvasImageSource;
  if (isCorpse) {
    currentSpriteImg = heroImg; // Corpses use walking sprite
  } else if (player.isOnWater && !isCurrentlyJumping) {
    // PRIORITY: Swimming takes precedence over all other animations (including sprinting)
    currentSpriteImg = heroImg; // This should be the water sprite selected in renderingUtils
  } else if (isIdleState) {
    currentSpriteImg = heroIdleImg; // Use idle sprite when not moving
  } else if (isSprinting) {
    currentSpriteImg = heroSprintImg; // Use sprint sprite when sprinting and moving
  } else {
    currentSpriteImg = heroImg; // Use walking sprite for normal movement
  }
  
  if (currentSpriteImg instanceof HTMLImageElement && shouldShowShadow) {
    // Extract the specific sprite frame for shadow rendering
    const { sx, sy } = getSpriteCoordinates(player, finalIsMoving, finalAnimationFrame, isUsingItem || isUsingSeloOliveOil, totalFrames, isIdleAnimation);
    
    // Create a temporary canvas with just the current sprite frame
    const spriteCanvas = document.createElement('canvas');
    spriteCanvas.width = gameConfig.spriteWidth;
    spriteCanvas.height = gameConfig.spriteHeight;
    const spriteCtx = spriteCanvas.getContext('2d');
    
    if (spriteCtx) {
      // Draw just the current sprite frame to the temporary canvas
      spriteCtx.drawImage(
        currentSpriteImg, // UPDATED: Use selected sprite
        sx, sy, gameConfig.spriteWidth, gameConfig.spriteHeight, // Source: specific frame from spritesheet
        0, 0, gameConfig.spriteWidth, gameConfig.spriteHeight    // Destination: full temporary canvas
      );
      
      // Adjust shadow parameters based on player state  
      const shadowAlpha = finalIsOnline ? 0.6 : 0.5; // Increased visibility for all cases
      const shadowStretchMax = 3.0; // More dramatic shadows
      const shadowStretchMin = 0.25; // Better minimum visibility
      
      // Calculate realistic shadow scaling based on jump height
      const jumpProgress = Math.min(1, finalJumpOffsetY / playerRadius);
      const shadowScale = 1.0 - jumpProgress * 0.5; // Shadow gets smaller as player jumps higher
      const shadowBlurAmount = 2 + jumpProgress * 4; // Shadow gets blurrier when higher
      const shadowAlphaReduction = shadowAlpha * (1.0 - jumpProgress * 0.3); // Shadow gets fainter when higher
      const shadowOffsetFromPlayer = jumpProgress * 8; // Shadow moves slightly away from player when higher
      
      drawDynamicGroundShadow({
        ctx,
        entityImage: spriteCanvas, // Use the extracted sprite frame instead of full spritesheet
        entityCenterX: currentDisplayX,
        entityBaseY: currentDisplayY + shadowBaseYOffset + shadowOffsetFromPlayer, // Shadow stays on ground, moves slightly away when jumping
        imageDrawWidth: drawWidth * shadowScale, // Shadow shrinks as player jumps higher
        imageDrawHeight: drawHeight * shadowScale, // Shadow shrinks as player jumps higher
        cycleProgress,
        baseShadowColor: '0,0,0',
        maxShadowAlpha: shadowAlphaReduction, // Shadow gets fainter when higher
        maxStretchFactor: shadowStretchMax,
        minStretchFactor: shadowStretchMin,
        shadowBlur: shadowBlurAmount, // Shadow gets blurrier when higher
        pivotYOffset: 0,
      });
    }
  }
  // --- End Dynamic Ground Shadow ---

  // --- Draw Offline Shadow (corpses excluded - they're flat on the ground) --- 
  if (!isCorpse && !finalIsOnline && shouldShowShadow) { // Exclude corpses from shadow rendering
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
  if (!isCorpse && !player.isDead && finalIsOnline && shouldShowShadow) {
      const shadowBaseRadiusX = drawWidth * 0.3;
      const shadowBaseRadiusY = shadowBaseRadiusX * 0.4;
      const shadowMaxJumpOffset = 10; 
      const shadowYOffsetFromJump = finalJumpOffsetY * (shadowMaxJumpOffset / playerRadius); 
      const jumpProgress = Math.min(1, finalJumpOffsetY / playerRadius); 
      const shadowScale = 1.0 - jumpProgress * 0.4; 
      
      // Apply realistic shadow effects based on jump height
      const shadowAlpha = 0.5 * (1.0 - jumpProgress * 0.3); // Shadow gets fainter when higher (darker base)
      const shadowBlur = 3 + jumpProgress * 4; // Shadow gets blurrier when higher (starts with base blur)
      
      ctx.save();
      // Apply blur and alpha effects
      if (shadowBlur > 0) {
          ctx.filter = `blur(${shadowBlur}px)`;
      }
      ctx.globalAlpha = shadowAlpha;
      
      drawShadow(
        ctx, 
        currentDisplayX, 
        currentDisplayY + shadowBaseYOffset + shadowYOffsetFromJump, 
        shadowBaseRadiusX * shadowScale, 
        shadowBaseRadiusY * shadowScale  
      );
      
      ctx.restore(); // Reset filter and alpha
  }
  // --- End Draw Shadow ---

  // --- Draw Sprite ---
  ctx.save(); // Save for rotation and flash effects
  try {
    const centerX = spriteBaseX + drawWidth / 2; 
    const centerY = spriteDrawY + drawHeight / 2; 

    // --- MODIFICATION: Knocked Out Glow/Pulse ---
    if (!isCorpse && player.isKnockedOut) {
      const pulseSpeed = 1500; // Duration of one pulse cycle in ms
      const minGlowAlpha = 0.4;
      const maxGlowAlpha = 0.8;
      // Create a sine wave that oscillates between 0 and 1
      const pulseFactor = (Math.sin(nowMs / pulseSpeed * Math.PI * 2) + 1) / 2; 
      const currentGlowAlpha = minGlowAlpha + (maxGlowAlpha - minGlowAlpha) * pulseFactor;

      ctx.shadowColor = `rgba(255, 0, 0, ${currentGlowAlpha})`;
      ctx.shadowBlur = 10 + (pulseFactor * 10); // Make blur also pulse slightly
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
    } else if (isUsingItem) { // Bandage glow
      const pulseSpeed = 1000; // Faster pulse for healing
      const minGlowAlpha = 0.3;
      const maxGlowAlpha = 0.7;
      const pulseFactor = (Math.sin(nowMs / pulseSpeed * Math.PI * 2) + 1) / 2; 
      const currentGlowAlpha = minGlowAlpha + (maxGlowAlpha - minGlowAlpha) * pulseFactor;

      ctx.shadowColor = `rgba(0, 255, 0, ${currentGlowAlpha})`; // Green glow
      ctx.shadowBlur = 8 + (pulseFactor * 8);
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
    } else if (isUsingSeloOliveOil) { // Selo Olive Oil glow
      const pulseSpeed = 800; // Slightly faster pulse for Selo Olive Oil
      const minGlowAlpha = 0.3;
      const maxGlowAlpha = 0.7;
      const pulseFactor = (Math.sin(nowMs / pulseSpeed * Math.PI * 2) + 1) / 2; 
      const currentGlowAlpha = minGlowAlpha + (maxGlowAlpha - minGlowAlpha) * pulseFactor;

      ctx.shadowColor = `rgba(255, 255, 0, ${currentGlowAlpha})`; // Yellow glow
      ctx.shadowBlur = 8 + (pulseFactor * 8);
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
    } else if (activeConsumableEffects) {
      // Check for water drinking effect
      let isDrinkingWater = false;
      for (const effect of activeConsumableEffects.values()) {
        if (effect.effectType.tag === 'WaterDrinking' && effect.playerId.toHexString() === player.identity.toHexString()) {
          isDrinkingWater = true;
          break;
        }
      }

            if (isDrinkingWater) {
        const pulseSpeed = 800; // Slightly faster pulse for water drinking
        const minGlowAlpha = 0.6;
        const maxGlowAlpha = 0.9;
        const pulseFactor = (Math.sin(nowMs / pulseSpeed * Math.PI * 2) + 1) / 2; 
        const currentGlowAlpha = minGlowAlpha + (maxGlowAlpha - minGlowAlpha) * pulseFactor;

        ctx.shadowColor = `rgba(0, 200, 255, ${currentGlowAlpha})`; // Brighter, more neon blue glow
        ctx.shadowBlur = 12 + (pulseFactor * 10);
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
      } else {
        // Check for active healing effects (both self-heal and remote heal)
        let isBeingHealed = false;
        let isHealing = false;
        let healingEffect = null;

        for (const effect of activeConsumableEffects.values()) {
          const effectTypeTag = effect.effectType.tag;
          const isPlayerHealer = effect.playerId.toHexString() === player.identity.toHexString();
          
          // Check if this player is being healed (self-heal)
          if (isPlayerHealer && effectTypeTag === 'BandageBurst') {
            isBeingHealed = true;
            healingEffect = effect;
            break;
          }
          
          // Check if this player is healing others
          if (isPlayerHealer && effectTypeTag === 'RemoteBandageBurst') {
            isHealing = true;
            healingEffect = effect;
            break;
          }

          // Check if this player is being healed by someone else
          if (effectTypeTag === 'RemoteBandageBurst' && effect.totalAmount && effect.totalAmount > 0) {
            // If this player is the target of a remote heal
            if (effect.targetPlayerId && effect.targetPlayerId.toHexString() === player.identity.toHexString()) {
              isBeingHealed = true;
              healingEffect = effect;
              break;
            }
          }
        }

        if ((isBeingHealed || isHealing) && healingEffect) {
          const pulseSpeed = 1000; // Match bandage application speed
          const minGlowAlpha = 0.3;
          const maxGlowAlpha = 0.7;
          const pulseFactor = (Math.sin(nowMs / pulseSpeed * Math.PI * 2) + 1) / 2;
          const currentGlowAlpha = minGlowAlpha + (maxGlowAlpha - minGlowAlpha) * pulseFactor;

          // Green glow for both healer and target
          ctx.shadowColor = `rgba(0, 255, 0, ${currentGlowAlpha})`;
          ctx.shadowBlur = isBeingHealed ? 12 + (pulseFactor * 10) : 8 + (pulseFactor * 8); // Stronger effect on target
          ctx.shadowOffsetX = 0;
          ctx.shadowOffsetY = 0;
        }
       }
    }
    // --- END MODIFICATION ---

    // --- Prepare sprite on offscreen canvas (for tinting) ---
    if (offscreenCtx && currentSpriteImg) {
      offscreenCanvas.width = gameConfig.spriteWidth;
      offscreenCanvas.height = gameConfig.spriteHeight;
      offscreenCtx.clearRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);
      
      // Draw the original sprite frame to the offscreen canvas
      offscreenCtx.drawImage(
        currentSpriteImg as CanvasImageSource, // UPDATED: Use selected sprite
        sx, sy, gameConfig.spriteWidth, gameConfig.spriteHeight,
        0, 0, gameConfig.spriteWidth, gameConfig.spriteHeight
      );

      if (isFlashing) {
        offscreenCtx.globalCompositeOperation = 'source-in';
        offscreenCtx.fillStyle = 'rgba(255, 255, 255, 0.85)'; 
        offscreenCtx.fillRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);
        offscreenCtx.globalCompositeOperation = 'source-over';
      }

    } else if (!currentSpriteImg) {
      // console.warn("currentSpriteImg is null, cannot draw player sprite.");
      // Fallback or skip drawing if sprite is not loaded - though asset loader should handle this.
      return; // Exit if no sprite image
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

    // --- MODIFICATION: Reset shadow properties after drawing the potentially glowing sprite ---
    let isDrinkingWater = false;
    if (activeConsumableEffects) {
      for (const effect of activeConsumableEffects.values()) {
        if (effect.effectType.tag === 'WaterDrinking' && effect.playerId.toHexString() === player.identity.toHexString()) {
          isDrinkingWater = true;
          break;
        }
      }
    }
    
    if ((!isCorpse && player.isKnockedOut) || isUsingItem || isUsingSeloOliveOil || isDrinkingWater || (activeConsumableEffects && activeConsumableEffects.size > 0)) {
      ctx.shadowColor = 'transparent'; // Or 'rgba(0,0,0,0)'
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
    }
    // --- END MODIFICATION ---

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
