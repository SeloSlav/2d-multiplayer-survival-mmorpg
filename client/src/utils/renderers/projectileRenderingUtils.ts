import { Projectile as SpacetimeDBProjectile } from '../../generated';

const ARROW_SCALE = 0.04; // Small size for arrows
const THROWN_ITEM_SCALE = 0.06; // Moderately larger size for thrown weapons (1.5x arrow size)
const ARROW_SPRITE_OFFSET_X = 0; // Pixels to offset drawing from calculated center, if sprite isn't centered
const ARROW_SPRITE_OFFSET_Y = 0; // Pixels to offset drawing from calculated center, if sprite isn't centered

const GRAVITY: number = 600.0; // Same as server-side

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

  // More precise timing calculation with microsecond precision
  const startTimeMicros = Number(projectile.startTime.microsSinceUnixEpoch);
  const currentTimeMicros = currentTimeMs * 1000; // Convert ms to microseconds
  const elapsedTimeSeconds = (currentTimeMicros - startTimeMicros) / 1_000_000.0;
  
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