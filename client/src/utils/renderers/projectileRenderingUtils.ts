import { Projectile as SpacetimeDBProjectile } from '../../generated';

const ARROW_SCALE = 0.04; // Small size for arrows
const THROWN_ITEM_SCALE = 0.06; // Moderately larger size for thrown weapons (1.5x arrow size)
const ARROW_SPRITE_OFFSET_X = 0; // Pixels to offset drawing from calculated center, if sprite isn't centered
const ARROW_SPRITE_OFFSET_Y = 0; // Pixels to offset drawing from calculated center, if sprite isn't centered

const GRAVITY: number = 600.0; // Same as server-side

// --- Client-side animation tracking for projectiles ---
const clientProjectileStartTimes = new Map<string, number>(); // projectileId -> client timestamp when projectile started
const lastKnownServerProjectileTimes = new Map<string, number>(); // projectileId -> last known server timestamp

interface RenderProjectileProps {
  ctx: CanvasRenderingContext2D;
  projectile: SpacetimeDBProjectile;
  arrowImage: HTMLImageElement;
  currentTimeMs: number;
}

export const renderProjectile = ({
  ctx,
  projectile,
  arrowImage,
  currentTimeMs,
}: RenderProjectileProps) => {
  if (!arrowImage || !arrowImage.complete || arrowImage.naturalHeight === 0) {
    console.warn('[DEBUG] Arrow image not loaded or invalid for projectile:', projectile.id);
    return;
  }

  const projectileId = projectile.id.toString();
  const serverStartTimeMicros = Number(projectile.startTime.microsSinceUnixEpoch);
  const serverStartTimeMs = serverStartTimeMicros / 1000;
  
  // Check if this is a NEW projectile by comparing server timestamps
  const lastKnownServerTime = lastKnownServerProjectileTimes.get(projectileId) || 0;
  let elapsedTimeSeconds = 0;
  
  if (serverStartTimeMs !== lastKnownServerTime) {
    // NEW projectile detected! Record both server time and client time
    console.log(`🏹 [CLIENT PROJECTILE] NEW projectile detected:`, {
      projectileId,
      serverStartTimeMs,
      clientTimeMs: currentTimeMs,
      timeDiff: currentTimeMs - serverStartTimeMs
    });
    lastKnownServerProjectileTimes.set(projectileId, serverStartTimeMs);
    clientProjectileStartTimes.set(projectileId, currentTimeMs);
    elapsedTimeSeconds = 0;
  } else {
    // Use client-tracked time for position calculation
    const clientStartTime = clientProjectileStartTimes.get(projectileId);
    if (clientStartTime) {
      const elapsedClientMs = currentTimeMs - clientStartTime;
      elapsedTimeSeconds = elapsedClientMs / 1000;
      
      console.log(`🏹 [CLIENT PROJECTILE] Animation check:`, {
        projectileId: projectileId.substring(0, 8),
        elapsedClientMs,
        elapsedTimeSeconds: elapsedTimeSeconds.toFixed(3),
        isVisible: elapsedTimeSeconds >= 0
      });
    } else {
      // Fallback to server time if no client tracking (shouldn't happen normally)
      console.warn(`🏹 [CLIENT PROJECTILE] No client tracking for projectile ${projectileId}, using server time`);
      const currentTimeMicros = currentTimeMs * 1000;
      elapsedTimeSeconds = (currentTimeMicros - serverStartTimeMicros) / 1_000_000.0;
    }
  }
  
  // Don't render if projectile hasn't started yet
  if (elapsedTimeSeconds < 0) {
    console.log(`🏹 [CLIENT PROJECTILE] Projectile ${projectileId.substring(0, 8)} not ready yet (${elapsedTimeSeconds.toFixed(3)}s)`);
    return;
  }
  
  // Check if this is a thrown item (ammo_def_id == item_def_id)
  const isThrown = projectile.ammoDefId === projectile.itemDefId;
  
  // Calculate current position with sub-pixel precision
  const currentX = projectile.startPosX + (projectile.velocityX * elapsedTimeSeconds);
  // Apply gravity only to non-thrown items (arrows, crossbow bolts)
  const gravityEffect = isThrown ? 0 : 0.5 * GRAVITY * elapsedTimeSeconds * elapsedTimeSeconds;
  const currentY = projectile.startPosY + (projectile.velocityY * elapsedTimeSeconds) + gravityEffect;

  // Calculate rotation based on velocity vector
  let angle: number;
  if (isThrown) {
    // Thrown items maintain their initial trajectory angle (no gravity to change it)
    angle = Math.atan2(projectile.velocityY, projectile.velocityX) + (Math.PI / 4);
  } else {
    // Calculate rotation based on instantaneous velocity vector considering gravity for arrows
    const instantaneousVelocityY = projectile.velocityY + GRAVITY * elapsedTimeSeconds;
    angle = Math.atan2(instantaneousVelocityY, projectile.velocityX) + (Math.PI / 4);
  }

  // Determine scale - thrown items are larger than arrows
  const scale = isThrown ? THROWN_ITEM_SCALE : ARROW_SCALE;
  
  const drawWidth = arrowImage.naturalWidth * scale;
  const drawHeight = arrowImage.naturalHeight * scale;

  ctx.save();
  // Use sub-pixel positioning for smoother movement
  ctx.translate(Math.round(currentX * 10) / 10 + ARROW_SPRITE_OFFSET_X, Math.round(currentY * 10) / 10 + ARROW_SPRITE_OFFSET_Y);
  ctx.rotate(angle);
  ctx.scale(-1, 1); // Flip horizontally for correct arrow orientation
  
  // Draw the image centered on its new origin
  ctx.drawImage(
    arrowImage,
    -drawWidth / 2, 
    -drawHeight / 2,
    drawWidth,
    drawHeight
  );
  
  ctx.restore();
}; 