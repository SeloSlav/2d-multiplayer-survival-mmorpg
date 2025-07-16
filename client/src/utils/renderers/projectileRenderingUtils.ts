import { Projectile as SpacetimeDBProjectile } from '../../generated';

const ARROW_SCALE = 0.04; // Small size for arrows
const THROWN_ITEM_SCALE = 0.06; // Moderately larger size for thrown weapons (1.5x arrow size)
const ARROW_SPRITE_OFFSET_X = 0; // Pixels to offset drawing from calculated center, if sprite isn't centered
const ARROW_SPRITE_OFFSET_Y = 0; // Pixels to offset drawing from calculated center, if sprite isn't centered

const GRAVITY: number = 600.0; // Same as server-side

// Client-side projectile lifetime limits for cleanup (in case server is slow)
const MAX_PROJECTILE_LIFETIME_MS = 12000; // 12 seconds max
const MAX_PROJECTILE_DISTANCE = 1200; // Max distance before client cleanup

// --- Client-side animation tracking for projectiles ---
const clientProjectileStartTimes = new Map<string, number>(); // projectileId -> client timestamp when projectile started
const lastKnownServerProjectileTimes = new Map<string, number>(); // projectileId -> last known server timestamp

interface RenderProjectileProps {
  ctx: CanvasRenderingContext2D;
  projectile: SpacetimeDBProjectile;
  arrowImage: HTMLImageElement;
  currentTimeMs: number;
  itemDefinitions?: Map<string, any>; // NEW: Add itemDefinitions to determine weapon type
}

export const renderProjectile = ({
  ctx,
  projectile,
  arrowImage,
  currentTimeMs,
  itemDefinitions, // NEW: Add itemDefinitions parameter
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
    // NEW projectile detected! Always start immediately for smooth gameplay
    console.log(`🏹 NEW projectile ${projectileId.substring(0, 8)}: immediate render`);
    lastKnownServerProjectileTimes.set(projectileId, serverStartTimeMs);
    clientProjectileStartTimes.set(projectileId, currentTimeMs); // Use current client time
    elapsedTimeSeconds = 0; // Always start at 0 for immediate rendering
  } else {
    // Use client-tracked time for smooth position calculation
    const clientStartTime = clientProjectileStartTimes.get(projectileId);
    if (clientStartTime) {
      const elapsedClientMs = currentTimeMs - clientStartTime;
      elapsedTimeSeconds = elapsedClientMs / 1000;
    } else {
      // Fallback: Use current time as start time for missing client tracking
      console.log(`🏹 FALLBACK: Starting projectile ${projectileId.substring(0, 8)} immediately`);
      clientProjectileStartTimes.set(projectileId, currentTimeMs);
      elapsedTimeSeconds = 0; // Start immediately
    }
  }
  
  // Always render projectiles (removed negative time check for immediate visibility)
  // This ensures projectiles appear immediately regardless of server/client time sync
  if (elapsedTimeSeconds < 0) {
    // Force to 0 for immediate visibility in production with network latency
    elapsedTimeSeconds = 0;
  }
  
  // Client-side safety checks to prevent projectiles from lingering indefinitely
  const distanceTraveled = Math.sqrt(
    Math.pow(projectile.startPosX - (projectile.startPosX + projectile.velocityX * elapsedTimeSeconds), 2) +
    Math.pow(projectile.startPosY - (projectile.startPosY + projectile.velocityY * elapsedTimeSeconds), 2)
  );
  
  // Don't render if projectile has exceeded reasonable limits (client-side cleanup)
  if (elapsedTimeSeconds > 15 || distanceTraveled > MAX_PROJECTILE_DISTANCE) {
    console.log(`🏹 [CLIENT CLEANUP] Projectile ${projectileId.substring(0, 8)} exceeded limits - Time: ${elapsedTimeSeconds.toFixed(1)}s, Distance: ${distanceTraveled.toFixed(1)}`);
    // Clean up tracking for this projectile
    clientProjectileStartTimes.delete(projectileId);
    lastKnownServerProjectileTimes.delete(projectileId);
    return;
  }
  
  // Check if this is a thrown item (ammo_def_id == item_def_id)
  const isThrown = projectile.ammoDefId === projectile.itemDefId;
  
  // FIXED: Determine gravity multiplier based on weapon type (matching server physics)
  let gravityMultiplier = 1.0; // Default for bows
  if (itemDefinitions) {
    const weaponDef = itemDefinitions.get(projectile.itemDefId.toString());
    if (weaponDef && weaponDef.name === "Crossbow") {
      gravityMultiplier = 0.0; // Crossbow projectiles have NO gravity effect (straight line)
    }
  }
  
  // Calculate current position with sub-pixel precision
  const currentX = projectile.startPosX + (projectile.velocityX * elapsedTimeSeconds);
  // FIXED: Apply gravity with correct multiplier based on weapon type
  const finalGravityMultiplier = isThrown ? 0.0 : gravityMultiplier;
  const gravityEffect = 0.5 * GRAVITY * finalGravityMultiplier * elapsedTimeSeconds * elapsedTimeSeconds;
  const currentY = projectile.startPosY + (projectile.velocityY * elapsedTimeSeconds) + gravityEffect;

  // Calculate rotation based on velocity vector
  let angle: number;
  if (isThrown) {
    // Thrown items spin while maintaining their trajectory
    const baseAngle = Math.atan2(projectile.velocityY, projectile.velocityX) + (Math.PI / 4);
    const spinSpeed = 8.0; // Rotations per second - adjust for desired spin rate
    const spinAngle = spinSpeed * 2 * Math.PI * elapsedTimeSeconds;
    angle = baseAngle + spinAngle;
  } else {
    // FIXED: Calculate rotation based on instantaneous velocity vector with correct gravity
    const instantaneousVelocityY = projectile.velocityY + GRAVITY * finalGravityMultiplier * elapsedTimeSeconds;
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

// Add cleanup function to prevent memory leaks
export const cleanupOldProjectileTracking = () => {
  const currentTime = performance.now();
  const toDelete = [];
  
  for (const [projectileId, startTime] of clientProjectileStartTimes.entries()) {
    if (currentTime - startTime > MAX_PROJECTILE_LIFETIME_MS) {
      toDelete.push(projectileId);
    }
  }
  
  for (const projectileId of toDelete) {
    clientProjectileStartTimes.delete(projectileId);
    lastKnownServerProjectileTimes.delete(projectileId);
  }
  
  if (toDelete.length > 0) {
    console.log(`🏹 [CLIENT CLEANUP] Removed ${toDelete.length} old projectile tracking entries`);
  }
};