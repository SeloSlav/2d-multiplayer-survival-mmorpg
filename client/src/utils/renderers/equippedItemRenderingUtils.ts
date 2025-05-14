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
  let isSpearThrusting = false;

  // --- Define spear-specific orientation variables ---
  let spearRotation = 0; // This will be the primary rotation for the spear
  let spearScaleX = 1;
  let spearScaleY = 1;
  // --- End spear-specific orientation variables ---

  let pivotX = player.positionX + shakeX;
  let pivotY = player.positionY - jumpOffset + shakeY; 
  
  const handOffsetX = gameConfig.spriteWidth * 0.2; 
  const handOffsetY = gameConfig.spriteHeight * 0.05;

  if (itemDef.name === "Wooden Spear") {
    // Base rotations to make spear point in player's direction
    // (assuming spear asset points horizontally to the right by default)
    switch (player.direction) {
      case 'up':
        spearRotation = -Math.PI / 2; // Points asset 'up'
        itemOffsetX = 0; 
        itemOffsetY = -gameConfig.spriteHeight * 0.1; 
        break;
      case 'down':
        spearRotation = Math.PI / 2;  // Points asset 'down'
        itemOffsetX = 0;
        itemOffsetY = gameConfig.spriteHeight * 0.1;
        break;
      case 'left':
        spearRotation = Math.PI;      // Points asset 'left'
        itemOffsetX = -gameConfig.spriteWidth * 0.15;
        itemOffsetY = 0; 
        break;
      case 'right':
        spearRotation = 0;            // Points asset 'right' (default asset orientation)
        itemOffsetX = gameConfig.spriteWidth * 0.15;
        itemOffsetY = 0;
        break;
    }

    // Apply user-specified distinct transformations for each direction
    // This switch can override spearRotation from the first switch, set scaling,
    // and now also fine-tune itemOffsetX/Y for each specific spear orientation.
    switch (player.direction) {
      case 'up':
        spearRotation = (Math.PI / 4) + (Math.PI / 2) + (Math.PI / 2); 
        spearScaleX = -1; 
        spearScaleY = -1; 
        // Initial offset from first switch for 'up': itemOffsetX = 0; itemOffsetY = -gameConfig.spriteHeight * 0.1;
        itemOffsetX = 0 + 15; // adjust X for up
        itemOffsetY = (-gameConfig.spriteHeight * 0.1) -20; // adjust Y for up
        break;
      case 'down':
        spearRotation = (Math.PI / 4) + (Math.PI / 2);
        spearScaleX = -1; 
        spearScaleY = 1;
        // Initial offset from first switch for 'down': itemOffsetX = 0; itemOffsetY = gameConfig.spriteHeight * 0.1;
        itemOffsetX = 0 - 15; // adjust X for down (e.g., move left by 5px)
        itemOffsetY = (gameConfig.spriteHeight * 0.1) + 25; // adjust Y for down (e.g., move down by 5px)
        break;
      case 'left':
        spearRotation = Math.PI + (Math.PI / 4);
        spearScaleX = -1; 
        spearScaleY = 1;
        // Initial offset from first switch for 'left': itemOffsetX = -gameConfig.spriteWidth * 0.15; itemOffsetY = 0;
        itemOffsetX = (-gameConfig.spriteWidth * 0.15) - 15; // adjust X for left
        itemOffsetY = 0 + 0; // adjust Y for left
        break;
      case 'right':
        spearRotation = Math.PI / 4; 
        spearScaleX = -1; 
        spearScaleY = 1;
        // Initial offset from first switch for 'right': itemOffsetX = gameConfig.spriteWidth * 0.15; itemOffsetY = 0;
        itemOffsetX = (gameConfig.spriteWidth * 0.15) + 5; // adjust X for right
        itemOffsetY = 0 + 15; // adjust Y for right
        break;
    }
    
    // The pivotX and pivotY are now based on these potentially fine-tuned offsets.
    // The initial calculation of pivotX/Y before this switch might need to be re-evaluated
    // if we don't want to ADD to player.positionX/Y + shakeX/Y + itemOffsetX/Y from the *first* switch.
    // For now, we effectively override the first switch's itemOffset by re-assigning itemOffsetX/Y here.
    // So, the final pivot calculation should directly use these values.

    // Recalculate pivotX, pivotY based on the final itemOffsetX/Y for the spear
    pivotX = player.positionX + shakeX + itemOffsetX;
    pivotY = player.positionY - jumpOffset + shakeY + itemOffsetY;
    
    rotation = spearRotation; // Use the calculated spear rotation

  } else {
    // Original logic for other items' pivot and default orientation
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
  }
  // --- End Item Size and Position adjustments ---

  // Store the pivot before animation for the thrust line visual and arc effects
  const preAnimationPivotX = pivotX;
  const preAnimationPivotY = pivotY;

  // --- Swing/Thrust Animation --- 
  const swingStartTime = Number(equipment.swingStartTimeMs);
  const elapsedSwingTime = now_ms - swingStartTime;
  let currentAngle = 0; 
  let thrustDistance = 0; 

  if (elapsedSwingTime < SWING_DURATION_MS) {
      isSwinging = true; 
      const swingProgress = elapsedSwingTime / SWING_DURATION_MS;
      
      if (itemDef.name === "Wooden Spear") {
          isSpearThrusting = true;
          const SPEAR_MAX_THRUST_EXTENSION = (itemDef as any).attackRange || 100; 
          thrustDistance = Math.sin(swingProgress * Math.PI) * SPEAR_MAX_THRUST_EXTENSION;
          
          // Apply thrust directly to pivotX/pivotY based on world direction
          // The `rotation` variable (which is spearRotation) is for the visual angle.
          switch (player.direction) {
            case 'up':    pivotY -= thrustDistance; break;
            case 'down':  pivotY += thrustDistance; break;
            case 'left':  pivotX -= thrustDistance; break;
            case 'right': pivotX += thrustDistance; break;
          }
          // `rotation` (which is spearRotation) is already set for the spear's pointing direction from earlier logic.
      } else {
          // Original swing animation for other items - rotation is dynamic here
          currentAngle = Math.sin(swingProgress * Math.PI) * SWING_ANGLE_MAX_RAD;
          if (player.direction === 'right' || player.direction === 'up') {
            rotation = currentAngle; 
          } else {
            rotation = -currentAngle; 
          }
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
    }
  }

  if (!imageToRender) {
    return;
  }
  // --- End Image Resolution ---

  // Apply transformations
  ctx.save();
  ctx.translate(pivotX, pivotY); 
  ctx.rotate(rotation); // For spear, this is spearRotation. For others, it's dynamic swing or 0.

  // Apply scaling (flipping)
  if (itemDef.name === "Wooden Spear") {
    ctx.scale(spearScaleX, spearScaleY);
  } else {
    // Revert to original flip logic for non-spear items
    if (player.direction === 'right' || player.direction === 'up') {
       ctx.scale(-1, 1); // Original: Flip horizontally
    }
    // If not (right or up), no scale is applied for other items (original behavior)
  }

  // Draw image centered at the (potentially additionally translated and rotated) pivot point
  ctx.drawImage(imageToRender, -itemWidth / 2, -itemHeight / 2, itemWidth, itemHeight);
  ctx.restore();

  // --- Draw Attack Visual Effect --- 
  if (isSwinging) { 
    if (itemDef.name === "Wooden Spear") {
        // Draw a "thrust line" effect for the spear
        ctx.save();
        try {
            ctx.beginPath();
            const spearLength = Math.max(itemWidth, itemHeight); 
            
            const lineStartX = preAnimationPivotX; // Start from the hand position
            const lineStartY = preAnimationPivotY;

            // Endpoint calculation needs to use the final spearRotation and the current thrusted pivot
            // The line should go from the hand to the spear's current (thrusted) base.
            const lineEndX = pivotX; // Current base of the spear after thrust
            const lineEndY = pivotY;
            
            ctx.moveTo(lineStartX, lineStartY);
            ctx.lineTo(lineEndX, lineEndY);
            
            ctx.strokeStyle = 'rgba(220, 220, 255, 0.65)'; 
            ctx.lineWidth = SLASH_LINE_WIDTH - 1.5; 
            ctx.stroke();
        } finally {
            ctx.restore();
        }
    } else {
      // Original slash arc effect for non-spear weapons
      ctx.save();
      try {
          const slashRadius = Math.max(itemWidth, itemHeight) * 0.5; 
          let slashStartAngle = 0;
          
          switch(player.direction) {
              case 'up':    slashStartAngle = -Math.PI / 2; break;
              case 'down':  slashStartAngle = Math.PI / 2;  break;
              case 'left':  slashStartAngle = Math.PI;      break;
              case 'right': slashStartAngle = 0;            break;
          }
          // `rotation` here is the dynamic currentAngle of the swing for non-spears
          const slashEndAngle = slashStartAngle + rotation; 
          const counterClockwise = rotation < 0;

          ctx.beginPath();
          // Draw arc centered on the item's pre-swing pivot point (hand position)
          ctx.arc(preAnimationPivotX, preAnimationPivotY, slashRadius, slashStartAngle, slashEndAngle, counterClockwise);
          ctx.strokeStyle = SLASH_COLOR;
          ctx.lineWidth = SLASH_LINE_WIDTH;
          ctx.stroke();
      } finally {
          ctx.restore();
      }
    }
  }
  // --- End Attack Visual Effect ---
}; 