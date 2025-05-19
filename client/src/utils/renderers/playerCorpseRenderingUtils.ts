import { PlayerCorpse as SpacetimeDBPlayerCorpse } from '../../generated/player_corpse_type';
import { Player as SpacetimeDBPlayer } from '../../generated/player_type';
import { renderPlayer, IDLE_FRAME_INDEX } from './playerRenderingUtils';
import { Identity, Timestamp } from '@clockworklabs/spacetimedb-sdk';

interface RenderPlayerCorpseProps {
  ctx: CanvasRenderingContext2D;
  corpse: SpacetimeDBPlayerCorpse;
  nowMs: number;
  itemImagesRef: React.RefObject<Map<string, HTMLImageElement>>;
  cycleProgress: number;
  heroImageRef: React.RefObject<HTMLImageElement | null>;
}

export const PLAYER_CORPSE_INTERACTION_DISTANCE_SQUARED = 64.0 * 64.0;

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
}: RenderPlayerCorpseProps): void {
  
  const heroImg = heroImageRef.current;
  if (!heroImg) {
    console.warn("[renderPlayerCorpse] Hero image not loaded, cannot render corpse sprite.");
    return;
  }

  // Revert to using __timestamp_micros_since_unix_epoch__ as per the linter error
  const defaultTimestamp: Timestamp = { __timestamp_micros_since_unix_epoch__: 0n } as Timestamp;
  // Added a cast to Timestamp to satisfy the type if it has other non-data properties or methods.

  const mockPlayerForCorpse: SpacetimeDBPlayer = {
    identity: corpse.playerIdentity as Identity,
    username: corpse.username,
    positionX: corpse.posX,
    positionY: corpse.posY,
    direction: 'up',
    color: '#CCCCCC',
    health: 0,
    isDead: true,
    lastHitTime: undefined,
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
  };

  renderPlayer(
    ctx,
    mockPlayerForCorpse,
    heroImg,
    false,
    false,
    false,
    IDLE_FRAME_INDEX,
    nowMs,
    0,
    false,
    undefined,
    undefined,
    true
  );
} 