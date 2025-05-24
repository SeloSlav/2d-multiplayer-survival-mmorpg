import { Projectile as SpacetimeDBProjectile } from '../../generated';

const ARROW_SCALE = 0.04; // Back to smaller size for better gameplay
const ARROW_SPRITE_OFFSET_X = 0; // Pixels to offset drawing from calculated center, if sprite isn't centered
const ARROW_SPRITE_OFFSET_Y = 0; // Pixels to offset drawing from calculated center, if sprite isn't centered

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
  
  // Calculate current position with sub-pixel precision
  const currentX = projectile.startPosX + (projectile.velocityX * elapsedTimeSeconds);
  const currentY = projectile.startPosY + (projectile.velocityY * elapsedTimeSeconds);

  // Calculate rotation based on velocity vector
  // Assumes arrow image points to the right (0 radians)
  // Add 45 degrees clockwise rotation for better visual appearance
  const angle = Math.atan2(projectile.velocityY, projectile.velocityX) + (Math.PI / 4);

  const drawWidth = arrowImage.naturalWidth * ARROW_SCALE;
  const drawHeight = arrowImage.naturalHeight * ARROW_SCALE;

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