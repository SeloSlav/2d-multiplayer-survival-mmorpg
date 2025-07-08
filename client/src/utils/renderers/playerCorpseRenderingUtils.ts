import { PlayerCorpse as SpacetimeDBPlayerCorpse } from '../../generated/player_corpse_type';
import { Player as SpacetimeDBPlayer } from '../../generated/player_type';
import { renderPlayer, IDLE_FRAME_INDEX } from './playerRenderingUtils';
import { Identity, Timestamp } from '@clockworklabs/spacetimedb-sdk';

// Constants for shake effect
const SHAKE_DURATION_MS = 150;     // How long the shake effect lasts
const SHAKE_INTENSITY_PX = 8;     // Max pixel offset for corpse shake

interface RenderPlayerCorpseProps {
  ctx: CanvasRenderingContext2D;
  corpse: SpacetimeDBPlayerCorpse;
  nowMs: number;
  itemImagesRef: React.RefObject<Map<string, HTMLImageElement>>;
  cycleProgress: number;
  heroImageRef: React.RefObject<HTMLImageElement | null>;
  heroWaterImageRef: React.RefObject<HTMLImageElement | null>;
  heroCrouchImageRef: React.RefObject<HTMLImageElement | null>;
  heroSwimImageRef: React.RefObject<HTMLImageElement | null>; // NEW: Add swim sprite ref
}

export const PLAYER_CORPSE_INTERACTION_DISTANCE_SQUARED = 64.0 * 64.0; // Reduced from 96px to 64px for tighter interaction range that matches server expectations

/**
 * Renders a player corpse entity onto the canvas using player sprite logic.
 */
export function renderPlayerCorpse({
  ctx,
  corpse,
  nowMs,
  itemImagesRef,
  cycleProgress,
  heroImageRef,
  heroWaterImageRef,
  heroCrouchImageRef,
  heroSwimImageRef,
}: RenderPlayerCorpseProps): void {
  
  // 1. Corpse Disappearance on Zero Health
  if (corpse.health === 0) {
    return; // Don't render if health is zero
  }

  // Revert to using __timestamp_micros_since_unix_epoch__ as per the linter error
  const defaultTimestamp: Timestamp = { __timestamp_micros_since_unix_epoch__: 0n } as Timestamp;
  // Added a cast to Timestamp to satisfy the type if it has other non-data properties or methods.

  let renderPosX = corpse.posX;
  let renderPosY = corpse.posY;

  // 2. Shake Effect
  if (corpse.lastHitTime && corpse.lastHitTime.__timestamp_micros_since_unix_epoch__) { // Check if lastHitTime and its property exist
    const lastHitTimeMs = Number(corpse.lastHitTime.__timestamp_micros_since_unix_epoch__ / 1000n);
    const elapsedSinceHit = nowMs - lastHitTimeMs;

    if (elapsedSinceHit >= 0 && elapsedSinceHit < SHAKE_DURATION_MS) {
      const shakeFactor = 1.0 - (elapsedSinceHit / SHAKE_DURATION_MS); 
      const currentShakeIntensity = SHAKE_INTENSITY_PX * shakeFactor;
      const shakeOffsetX = (Math.random() - 0.5) * 2 * currentShakeIntensity;
      const shakeOffsetY = (Math.random() - 0.5) * 2 * currentShakeIntensity;
      renderPosX += shakeOffsetX;
      renderPosY += shakeOffsetY;
    }
  }

  // For now, we'll assume corpses don't change their water status - they use normal sprite
  // In the future, we could add water detection logic for corpses if needed
  const isCorpseOnWater = false; // TODO: Implement water detection for corpses if needed

  const mockPlayerForCorpse: SpacetimeDBPlayer = {
    identity: corpse.playerIdentity as Identity,
    username: corpse.username,
    positionX: renderPosX, // Use potentially shaken position
    positionY: renderPosY, // Use potentially shaken position
    direction: 'up', // Corpses usually face up or a fixed direction
    health: 0, // Mock player health is 0 as it's a corpse
    isDead: true,
    lastHitTime: undefined, // Mock player doesn't have its own last hit time for rendering
    jumpStartTimeMs: 0n,
    isSprinting: false,
    hunger: 0,
    thirst: 0,
    stamina: 0,
    lastUpdate: defaultTimestamp,
    lastStatUpdate: defaultTimestamp,
    warmth: 0,
    deathTimestamp: corpse.deathTime,
    isOnline: false,
    isTorchLit: false,
    lastConsumedAt: defaultTimestamp,
    isCrouching: false,
    isKnockedOut: false,
    knockedOutAt: undefined,
    isOnWater: isCorpseOnWater, // ADD: Water status for sprite selection
  };

  // Choose the appropriate hero sprite based on water status (corpses don't crouch)
  const heroImg = isCorpseOnWater ? heroWaterImageRef.current : heroImageRef.current;
  
  if (!heroImg) {
    console.warn("[renderPlayerCorpse] Hero image not loaded, cannot render corpse sprite.");
    return;
  }

  renderPlayer(
    ctx,
    mockPlayerForCorpse,
    heroImg,
    heroImg, // heroSprintImg - corpses don't sprint
    heroImg, // heroIdleImg - corpses don't use idle animation
    heroCrouchImageRef.current || heroImg, // heroCrouchImg - corpses don't crouch but need parameter
    heroSwimImageRef.current || heroImg, // heroSwimImg - corpses don't swim but need parameter
    heroImg, // heroDodgeImg - corpses don't dodge but need parameter
    false, // isOnline
    false, // isMoving (corpse is static)
    false, // isHovered
    IDLE_FRAME_INDEX, // currentAnimationFrame
    nowMs,
    0, // jumpOffsetY (corpse doesn't jump)
    false, // shouldShowLabel
    undefined, // activeConsumableEffects
    undefined, // localPlayerId
    true, // isCorpse
    cycleProgress // cycleProgress
  );
} 