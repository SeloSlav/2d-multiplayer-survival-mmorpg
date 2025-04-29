import { PlayerCorpse as SpacetimeDBPlayerCorpse } from '../../generated/player_corpse_type';

interface RenderPlayerCorpseProps {
  ctx: CanvasRenderingContext2D;
  corpse: SpacetimeDBPlayerCorpse;
  nowMs: number;
  itemImagesRef: React.RefObject<Map<string, HTMLImageElement>>;
}

const CORPSE_WIDTH = 48;
const CORPSE_HEIGHT = 48;
const CORPSE_COLOR = '#888888'; // Grey placeholder color
const CORPSE_OUTLINE_COLOR = '#444444';
const CORPSE_IMAGE_NAME = 'burlap_sack.png';

/**
 * Renders a player corpse entity onto the canvas.
 * Uses burlap_sack.png if available, otherwise a placeholder rectangle.
 */
export function renderPlayerCorpse({
  ctx,
  corpse,
  nowMs,
  itemImagesRef,
}: RenderPlayerCorpseProps): void {
  const x = corpse.posX - CORPSE_WIDTH / 2;
  const y = corpse.posY - CORPSE_HEIGHT / 2;

  const corpseImage = itemImagesRef.current?.get(CORPSE_IMAGE_NAME);

  if (corpseImage && corpseImage.complete && corpseImage.naturalHeight !== 0) {
    // Draw the image
    ctx.drawImage(corpseImage, x, y, CORPSE_WIDTH, CORPSE_HEIGHT);
  } else {
    // Draw placeholder rectangle
    ctx.fillStyle = CORPSE_COLOR;
    ctx.fillRect(x, y, CORPSE_WIDTH, CORPSE_HEIGHT);

    // Optional: Add an outline
    ctx.strokeStyle = CORPSE_OUTLINE_COLOR;
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, CORPSE_WIDTH, CORPSE_HEIGHT);
  }
} 