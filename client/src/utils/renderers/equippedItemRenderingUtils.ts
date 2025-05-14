import { Player as SpacetimeDBPlayer, ActiveEquipment as SpacetimeDBActiveEquipment, ItemDefinition as SpacetimeDBItemDefinition } from '../../generated';
import { gameConfig } from '../../config/gameConfig';

// --- Constants (copied from GameCanvas for now, consider moving to config) ---
const SWING_DURATION_MS = 150;
const SWING_ANGLE_MAX_RAD = Math.PI / 2.5;
const SLASH_COLOR = 'rgba(255, 255, 255, 0.4)';
const SLASH_LINE_WIDTH = 4;
const PLAYER_HIT_SHAKE_DURATION_MS = 200; // Copied from renderingUtils.ts
const PLAYER_HIT_SHAKE_AMOUNT_PX = 3;   // Copied from renderingUtils.ts

// --- Helper Function for Rendering Equipped Item ---
export const renderEquippedItem = (
  ctx: CanvasRenderingContext2D,
  player: SpacetimeDBPlayer, 
  equipment: SpacetimeDBActiveEquipment,
  itemDef: SpacetimeDBItemDefinition,
  itemImgFromCaller: HTMLImageElement,
  now_ms: number,
  jumpOffset: number,
  itemImages: Map<string, HTMLImageElement>
) => {
  // --- Calculate Shake Offset (Only if alive) ---
  let shakeX = 0;
  let shakeY = 0;
  if (!player.isDead && player.lastHitTime) { // Check if alive and hit time exists
    const lastHitMs = Number(player.lastHitTime.microsSinceUnixEpoch / 1000n);
    const elapsedSinceHit = now_ms - lastHitMs;
    if (elapsedSinceHit >= 0 && elapsedSinceHit < PLAYER_HIT_SHAKE_DURATION_MS) {
      shakeX = (Math.random() - 0.5) * 2 * PLAYER_HIT_SHAKE_AMOUNT_PX;
      shakeY = (Math.random() - 0.5) * 2 * PLAYER_HIT_SHAKE_AMOUNT_PX;
    }
  }
  // --- End Shake Offset ---

  // --- Item Size and Position ---
  const scale = 0.05; // User's value
  const itemWidth = itemImgFromCaller.width * scale;
  const itemHeight = itemImgFromCaller.height * scale;
  let itemOffsetX = 0; 
  let itemOffsetY = 0; 
  let rotation = 0;
  let isSwinging = false;

  let pivotX = player.positionX + shakeX;
  let pivotY = player.positionY - jumpOffset + shakeY; 
  
  const handOffsetX = gameConfig.spriteWidth * 0.2; 
  const handOffsetY = gameConfig.spriteHeight * 0.05;

  switch (player.direction) {
      case 'up': 
          itemOffsetX = -handOffsetX * -2.5;
          itemOffsetY = handOffsetY * -1.0;
          pivotX += itemOffsetX;
          pivotY += itemOffsetY; 
          break;
      case 'down': 
          itemOffsetX = handOffsetX * -2.5;
          itemOffsetY = handOffsetY * 1.0; 
          pivotX += itemOffsetX;
          pivotY += itemOffsetY; 
          break;
      case 'left': 
          itemOffsetX = -handOffsetX * 1.5; 
          itemOffsetY = handOffsetY;
          pivotX += itemOffsetX; 
          pivotY += itemOffsetY; 
          break;
      case 'right': 
          itemOffsetX = handOffsetX * 0.5; 
          itemOffsetY = handOffsetY;
          pivotX += itemOffsetX;
          pivotY += itemOffsetY; 
          break;
  }

  // --- Swing Animation --- 
  const swingStartTime = Number(equipment.swingStartTimeMs);
  const elapsedSwingTime = now_ms - swingStartTime;
  let currentAngle = 0;
  if (elapsedSwingTime < SWING_DURATION_MS) {
      isSwinging = true;
      const swingProgress = elapsedSwingTime / SWING_DURATION_MS;
      currentAngle = Math.sin(swingProgress * Math.PI) * SWING_ANGLE_MAX_RAD;
      
      if (player.direction === 'right' || player.direction === 'up') {
        rotation = currentAngle; 
      } else {
        rotation = -currentAngle; 
      }
  }
  
  // --- Resolve the correct image to render ---
  let imageToRender: HTMLImageElement | undefined = itemImgFromCaller;
  if (itemDef.name === "Torch" && equipment.iconAssetName) {
    const specificTorchImage = itemImages.get(equipment.iconAssetName);
    if (specificTorchImage) {
      imageToRender = specificTorchImage;
    } else {
      console.warn(`[renderEquippedItem] Image for torch state '${equipment.iconAssetName}' not found in itemImages map. Falling back.`);
      // Fallback to itemImgFromCaller if specific one isn't found (shouldn't happen if preloaded)
    }
  }

  if (!imageToRender) {
    // console.warn("[renderEquippedItem] No image resolved for rendering equipped item.");
    return; // Don't attempt to render if no image
  }
  // --- End Image Resolution ---

  // Apply transformations
  ctx.save();
  ctx.translate(pivotX, pivotY);
  ctx.rotate(rotation);

  // Flip horizontally based on direction
  if (player.direction === 'right' || player.direction === 'up') {
      ctx.scale(-1, 1); 
  }

  // Draw image centered AT the pivot point
  ctx.drawImage(imageToRender, -itemWidth / 2, -itemHeight / 2, itemWidth, itemHeight);
  ctx.restore();

  // --- Draw Slash Effect --- 
  if (isSwinging) {
    ctx.save();
    try {
        // Calculate radius based on item size, adjust multiplier as needed
        const slashRadius = Math.max(itemWidth, itemHeight) * 0.5; 
        let slashStartAngle = 0;
        
        // Determine base start angle based on player direction
        switch(player.direction) {
            case 'up':    slashStartAngle = -Math.PI / 2; break; // Starts pointing up
            case 'down':  slashStartAngle = Math.PI / 2;  break; // Starts pointing down
            case 'left':  slashStartAngle = Math.PI;      break; // Starts pointing left
            case 'right': slashStartAngle = 0;            break; // Starts pointing right
        }

        // End angle is the start angle plus the calculated rotation for the item
        const slashEndAngle = slashStartAngle + rotation;
        // Arc direction depends on the sign of the rotation
        const counterClockwise = rotation < 0;

        ctx.beginPath();
        // Draw arc centered on the item's pivot point
        ctx.arc(pivotX, pivotY, slashRadius, slashStartAngle, slashEndAngle, counterClockwise);
        ctx.strokeStyle = SLASH_COLOR;
        ctx.lineWidth = SLASH_LINE_WIDTH;
        ctx.stroke();
    } finally {
        ctx.restore();
    }
  }
  // --- End Slash Effect ---
}; 