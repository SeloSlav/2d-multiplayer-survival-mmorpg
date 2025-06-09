import { Player as SpacetimeDBPlayer, ActiveEquipment as SpacetimeDBActiveEquipment, ItemDefinition as SpacetimeDBItemDefinition, ActiveConsumableEffect, EffectType } from '../../generated';
import { gameConfig } from '../../config/gameConfig';

// --- Constants (copied from GameCanvas for now, consider moving to config) ---
const SWING_DURATION_MS = 300;
const SWING_ANGLE_MAX_RAD = Math.PI / 2.5;
const SLASH_COLOR = 'rgba(255, 255, 255, 0.4)';
const SLASH_LINE_WIDTH = 4;
const PLAYER_HIT_SHAKE_DURATION_MS = 200; // Copied from renderingUtils.ts
const PLAYER_HIT_SHAKE_AMOUNT_PX = 3;   // Copied from renderingUtils.ts

// --- Bandage Animation Constants ---
const BANDAGING_ANIMATION_DURATION_MS = 5000; // Duration of the bandaging animation (MATCHES SERVER: 5 seconds)
const BANDAGING_MAX_ROTATION_RAD = Math.PI / 12; // Max rotation angle (e.g., 15 degrees)
const BANDAGING_WOBBLES = 20; // Number of full back-and-forth wobbles (10 * 2 for twice as fast)

// Selo Olive Oil animation constants
const SELO_OLIVE_OIL_ANIMATION_DURATION_MS = 2000; // Duration of the Selo Olive Oil animation (MATCHES SERVER: 2 seconds)
const SELO_OLIVE_OIL_MAX_ROTATION_RAD = Math.PI / 16; // Much gentler rotation than bandage (was Math.PI / 10)
const SELO_OLIVE_OIL_WOBBLES = 8; // Fewer wobbles for a gentler shake (was 15)

// --- Helper Function for Rendering Equipped Item ---
export const renderEquippedItem = (
  ctx: CanvasRenderingContext2D,
  player: SpacetimeDBPlayer, 
  equipment: SpacetimeDBActiveEquipment,
  itemDef: SpacetimeDBItemDefinition,
  itemDefinitions: Map<string, SpacetimeDBItemDefinition>,
  itemImgFromCaller: HTMLImageElement,
  now_ms: number,
  jumpOffset: number,
  itemImages: Map<string, HTMLImageElement>,
  activeConsumableEffects?: Map<string, ActiveConsumableEffect>,
  localPlayerId?: string
) => {
  // DEBUG: Log item being rendered
  // if (localPlayerId && player.identity.toHexString() === localPlayerId) {
  //   console.log(`[DEBUG] renderEquippedItem called for:`, {
  //     itemName: itemDef.name,
  //     category: itemDef.category,
  //     categoryTag: itemDef.category?.tag,
  //     categoryType: typeof itemDef.category,
  //     hasInstanceId: !!equipment.equippedItemInstanceId
  //   });
  // }

  // Early validation: if no equipped item instance ID, don't render anything
  if (!equipment.equippedItemInstanceId) {
    return;
  }
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

  let displayItemWidth = itemWidth;
  let displayItemHeight = itemHeight;

  // Make repair hammer twice as small
  if (itemDef.name === "Repair Hammer") {
    displayItemWidth = itemWidth * 0.5;
    displayItemHeight = itemHeight * 0.5;
  }

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

  if (itemDef.name === "Wooden Spear" || itemDef.name === "Stone Spear") {
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

  } else if (itemDef.name === "Hunting Bow") {

    // TEST: Increase scale for bows
    const bowScale = 0.05; // Reverted from 0.25 to match default weapon/tool scale
    displayItemWidth = itemImgFromCaller.width * bowScale;
    displayItemHeight = itemImgFromCaller.height * bowScale;

    switch (player.direction) {
      case 'up':
        itemOffsetX = gameConfig.spriteWidth * 0.3;
        itemOffsetY = -gameConfig.spriteHeight * 0.0;
        rotation = -Math.PI / 2; // Point bow upward
        break;
      case 'down':
        itemOffsetX = gameConfig.spriteWidth * -0.3;
        itemOffsetY = gameConfig.spriteHeight * 0.2;
        rotation = Math.PI / 2; // Point bow downward
        break;
      case 'left':
        itemOffsetX = -gameConfig.spriteWidth * 0.2;
        itemOffsetY = 0;
        rotation = Math.PI / 2; // Rotate bow 270 degrees counterclockwise
        break;
      case 'right':
        itemOffsetX = gameConfig.spriteWidth * -0.2;
        itemOffsetY = 4.0;
        rotation = 0; // Point bow right (default)
        break;
    }
    
    pivotX = player.positionX + shakeX + itemOffsetX;
    pivotY = player.positionY - jumpOffset + shakeY + itemOffsetY;

  } else if (itemDef.name === "Crossbow") {

    // Crossbow scale - slightly larger than bow to show its more substantial nature
    const crossbowScale = 0.06; // Slightly larger than bow scale
    displayItemWidth = itemImgFromCaller.width * crossbowScale;
    displayItemHeight = itemImgFromCaller.height * crossbowScale;

    switch (player.direction) {
      case 'up':
        itemOffsetX = gameConfig.spriteWidth * 0.25;
        itemOffsetY = -gameConfig.spriteHeight * 0.05;
        rotation = -Math.PI / 2; // Point crossbow upward
        break;
      case 'down':
        itemOffsetX = gameConfig.spriteWidth * -0.25;
        itemOffsetY = gameConfig.spriteHeight * 0.25;
        rotation = Math.PI / 2; // Point crossbow downward
        break;
      case 'left':
        itemOffsetX = -gameConfig.spriteWidth * 0.25;
        itemOffsetY = 0;
        rotation = Math.PI / 2; // Rotate crossbow 270 degrees counterclockwise
        break;
      case 'right':
        itemOffsetX = gameConfig.spriteWidth * -0.25;
        itemOffsetY = 2.0;
        rotation = 0; // Point crossbow right (default)
        break;
    }
    
    pivotX = player.positionX + shakeX + itemOffsetX;
    pivotY = player.positionY - jumpOffset + shakeY + itemOffsetY;

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

  // --- NEW: Arrow Rendering for Loaded Bow/Crossbow ---
  let loadedArrowImage: HTMLImageElement | undefined = undefined;
  if ((itemDef.name === "Hunting Bow" || itemDef.name === "Crossbow") && equipment.isReadyToFire && equipment.loadedAmmoDefId && itemDefinitions) {
    const ammoDef = itemDefinitions.get(String(equipment.loadedAmmoDefId));
    if (ammoDef && ammoDef.iconAssetName) {
        loadedArrowImage = itemImages.get(ammoDef.iconAssetName); // Use ammo's icon
        if (!loadedArrowImage) {
            // console.warn(`[RenderEquipped] Image for loaded arrow '${ammoDef.iconAssetName}' not found.`);
        }
    }
  }
  // --- END NEW ---

  // --- Swing/Thrust Animation --- 
  const swingStartTime = Number(equipment.swingStartTimeMs);
  const elapsedSwingTime = now_ms - swingStartTime;
  let currentAngle = 0; 
  let thrustDistance = 0; 

  // Debug logging for production issues
  if (localPlayerId && player.identity.toHexString() === localPlayerId && swingStartTime > 0) {
    console.log(`[DEBUG] Swing animation check:`, {
      swingStartTime,
      elapsedSwingTime,
      now_ms,
      isWithinDuration: elapsedSwingTime < SWING_DURATION_MS,
      itemName: itemDef.name
    });
  }

  if (elapsedSwingTime < SWING_DURATION_MS) {
      isSwinging = true; 
      const swingProgress = elapsedSwingTime / SWING_DURATION_MS;
      
      if (itemDef.name === "Wooden Spear" || itemDef.name === "Stone Spear") {
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
          // Swing animation for other items. 
          // currentAngle will be negative or zero, representing a CCW swing if positive was CW (and backwards).
          currentAngle = -(Math.sin(swingProgress * Math.PI) * SWING_ANGLE_MAX_RAD);
          // The 'rotation' variable is used for the slash arc. It should match the item's swing direction.
          rotation = currentAngle; 
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

  ctx.save(); // Overall item rendering context save (applies to pivot translation and general orientation)
  ctx.translate(pivotX, pivotY); 

  // Apply general orientation/scaling based on player direction (and spear specifics)
  if (itemDef.name === "Wooden Spear" || itemDef.name === "Stone Spear") {
    ctx.rotate(rotation); // `rotation` is pre-calculated spearRotation
    ctx.scale(spearScaleX, spearScaleY);
  } else if (itemDef.name === "Hunting Bow") {
    ctx.rotate(rotation); // Apply calculated bow rotation
    ctx.scale(-1, 1); // Flip horizontally
  } else if (itemDef.name === "Crossbow") {
    ctx.rotate(rotation); // Apply calculated crossbow rotation
    ctx.scale(-1, 1); // Flip horizontally
  } else {
    // Non-spear items might have a different base orientation/flip before animation
    // Ensure this scale doesn't affect bandage animation logic if it's drawn separately with its own save/restore
    if (player.direction === 'right' || player.direction === 'up') {
       if (itemDef.name !== "Bandage" && itemDef.name !== "Selo Olive Oil") { // Don't apply this generic flip if it's a bandage or Selo Olive Oil that will handle its own drawing
            ctx.scale(-1, 1); 
       }
    }
  }

  // --- BANDAGE ANIMATION & DRAWING --- 
  let bandageDrawnWithAnimation = false;
  let bandagingStartTimeMs: number | null = null;

  // Only show bandage animation if we have both an active effect AND the bandage is actually equipped
  if (itemDef.name === "Bandage" && activeConsumableEffects && player.identity) {
    const playerHexId = player.identity.toHexString();
    for (const effect of activeConsumableEffects.values()) {
      // Show animation if player is healing themselves or someone else with this equipped bandage
      if ((effect.effectType.tag === "BandageBurst" && effect.playerId.toHexString() === playerHexId) ||
          (effect.effectType.tag === "RemoteBandageBurst" && effect.playerId.toHexString() === playerHexId)) {
        bandagingStartTimeMs = Number(effect.startedAt.microsSinceUnixEpoch / 1000n);
        break;
      }
    }
  }

  if (itemDef.name === "Bandage" && bandagingStartTimeMs !== null) {
    const elapsedBandagingTime = now_ms - bandagingStartTimeMs;
    if (elapsedBandagingTime >= 0 && elapsedBandagingTime < BANDAGING_ANIMATION_DURATION_MS) {
      const animationProgress = elapsedBandagingTime / BANDAGING_ANIMATION_DURATION_MS;
      const bandagingRotation = Math.sin(animationProgress * Math.PI * BANDAGING_WOBBLES * 2) * BANDAGING_MAX_ROTATION_RAD;
      
      ctx.save(); // Save for bandage specific animation transforms
      // Bandage rotation is applied here. Pivot is already at item center due to prior ctx.translate(pivotX, pivotY)
      // and items are drawn relative to -itemWidth/2, -itemHeight/2.
      ctx.rotate(bandagingRotation); // Apply the wobble
      ctx.drawImage(imageToRender, -itemWidth / 2, -itemHeight / 2, itemWidth, itemHeight); // Draw centered & rotated bandage
      ctx.restore(); // Restore from bandage specific animation
      bandageDrawnWithAnimation = true;
    }
  }
  // --- END BANDAGE ANIMATION & DRAWING --- 

  // --- SELO OLIVE OIL ANIMATION & DRAWING --- 
  let seloOliveOilDrawnWithAnimation = false;
  let seloOliveOilStartTimeMs: number | null = null;

  // Only show Selo Olive Oil animation if we have both an active effect AND the Selo Olive Oil is actually equipped
  if (itemDef.name === "Selo Olive Oil" && activeConsumableEffects && player.identity) {
    const playerHexId = player.identity.toHexString();
    for (const effect of activeConsumableEffects.values()) {
      // Show animation if player is using Selo Olive Oil (HealthRegen effect with 2-second duration)
      if (effect.effectType.tag === "HealthRegen" && effect.playerId.toHexString() === playerHexId) {
        // Check if this is a short-duration effect (2 seconds for Selo Olive Oil vs longer for other items)
        const effectDurationMs = Number(effect.endsAt.microsSinceUnixEpoch / 1000n) - Number(effect.startedAt.microsSinceUnixEpoch / 1000n);
        if (effectDurationMs <= 2500) { // 2.5 seconds to account for slight timing variations
          seloOliveOilStartTimeMs = Number(effect.startedAt.microsSinceUnixEpoch / 1000n);
          break;
        }
      }
    }
  }

  if (itemDef.name === "Selo Olive Oil" && seloOliveOilStartTimeMs !== null) {
    const elapsedSeloOliveOilTime = now_ms - seloOliveOilStartTimeMs;
    if (elapsedSeloOliveOilTime >= 0 && elapsedSeloOliveOilTime < SELO_OLIVE_OIL_ANIMATION_DURATION_MS) {
      const animationProgress = elapsedSeloOliveOilTime / SELO_OLIVE_OIL_ANIMATION_DURATION_MS;
      const seloOliveOilRotation = Math.sin(animationProgress * Math.PI * SELO_OLIVE_OIL_WOBBLES * 2) * SELO_OLIVE_OIL_MAX_ROTATION_RAD;
      
      ctx.save(); // Save for Selo Olive Oil specific animation transforms
      // Selo Olive Oil rotation is applied here. Pivot is already at item center due to prior ctx.translate(pivotX, pivotY)
      // and items are drawn relative to -itemWidth/2, -itemHeight/2.
      ctx.rotate(seloOliveOilRotation); // Apply the wobble
      ctx.drawImage(imageToRender, -itemWidth / 2, -itemHeight / 2, itemWidth, itemHeight); // Draw centered & rotated Selo Olive Oil
      ctx.restore(); // Restore from Selo Olive Oil specific animation
      seloOliveOilDrawnWithAnimation = true;
    }
  }
  // --- END SELO OLIVE OIL ANIMATION & DRAWING ---

  // --- REGULAR ITEM DRAWING (AND SWING FOR NON-SPEAR/NON-BANDAGE-ANIMATING) --- 
  if (!bandageDrawnWithAnimation && !seloOliveOilDrawnWithAnimation) {
    ctx.save(); // Save for regular item drawing / swing
    if (itemDef.name !== "Wooden Spear" && itemDef.name !== "Stone Spear" && itemDef.name !== "Bandage" && itemDef.name !== "Selo Olive Oil"
        && itemDef.name?.toLowerCase() !== "hunting bow" && itemDef.category?.tag !== "RangedWeapon") {
      ctx.rotate(currentAngle); 
    }
    
    ctx.drawImage(imageToRender, -displayItemWidth / 2, -displayItemHeight / 2, displayItemWidth, displayItemHeight); // Draw centered

    // --- NEW: Draw Loaded Arrow on Bow ---
    if (loadedArrowImage && itemDef.name === "Hunting Bow") {
        const arrowScale = 0.045; // Adjust as needed
        const arrowWidth = loadedArrowImage.width * arrowScale;
        const arrowHeight = loadedArrowImage.height * arrowScale;
        // Arrow position and rotation settings per player direction
        let arrowOffsetX = 0; // Independent arrow position
        let arrowOffsetY = 0;
        let arrowRotation = 0; // Independent arrow rotation
        
        switch (player.direction) {
            case 'up':
                arrowOffsetX = -displayItemWidth * 0.15; 
                arrowOffsetY = -displayItemHeight * -0.15; // Arrow nocked further up
                arrowRotation = -Math.PI / 2; // Point arrow upward
                break;
            case 'down':
                arrowOffsetX = displayItemWidth * -0.15;  // Mirrored horizontally
                arrowOffsetY = -displayItemHeight * -0.15; // Mirrored vertically
                arrowRotation = -Math.PI / 2; // Mirrored rotation
                break;
            case 'left':
                arrowOffsetX = displayItemWidth * 0.0; 
                arrowOffsetY = -displayItemHeight * -0.15;
                arrowRotation = Math.PI + (Math.PI / 2); // Point arrow left and rotate 45 degrees counterclockwise
                break;
            case 'right':
                arrowOffsetX = -displayItemWidth * 0.0; 
                arrowOffsetY = -displayItemHeight * 0.0;
                arrowRotation = Math.PI + (Math.PI / 2); // Point arrow left and rotate 45 degrees counterclockwise
                break;
        }
        
        // Draw arrow with independent rotation
        ctx.save(); // Save current context for arrow-specific transforms
        ctx.translate(arrowOffsetX, arrowOffsetY); // Move to arrow position
        ctx.rotate(arrowRotation); // Apply independent arrow rotation
        ctx.drawImage(loadedArrowImage, -arrowWidth / 2, -arrowHeight / 2, arrowWidth, arrowHeight);
        ctx.restore(); // Restore context
    }
    
    // --- NEW: Draw Loaded Arrow on Crossbow ---
    if (loadedArrowImage && itemDef.name === "Crossbow") {
        const arrowScale = 0.04; // Slightly smaller for crossbow bolts
        const arrowWidth = loadedArrowImage.width * arrowScale;
        const arrowHeight = loadedArrowImage.height * arrowScale;
        // Arrow position and rotation settings per player direction
        let arrowOffsetX = 0; // Independent arrow position
        let arrowOffsetY = 0;
        let arrowRotation = 0; // Independent arrow rotation
        
        switch (player.direction) {
            case 'up':
                arrowOffsetX = -displayItemWidth * 0.15; 
                arrowOffsetY = -displayItemHeight * -0.15; // Arrow nocked further up
                arrowRotation = -Math.PI / 2; // Point arrow upward
                break;
            case 'down':
                arrowOffsetX = displayItemWidth * -0.15;  // Mirrored horizontally
                arrowOffsetY = -displayItemHeight * -0.15; // Mirrored vertically
                arrowRotation = -Math.PI / 2; // Mirrored rotation
                break;
            case 'left':
                arrowOffsetX = displayItemWidth * 0.0; 
                arrowOffsetY = -displayItemHeight * -0.15;
                arrowRotation = Math.PI + (Math.PI / 2); // Point arrow left and rotate 45 degrees counterclockwise
                break;
            case 'right':
                arrowOffsetX = -displayItemWidth * 0.0; 
                arrowOffsetY = -displayItemHeight * 0.0;
                arrowRotation = Math.PI + (Math.PI / 2); // Point arrow left and rotate 45 degrees counterclockwise
                break;
        }
        
        // Draw bolt with independent rotation
        ctx.save(); // Save current context for bolt-specific transforms
        ctx.translate(arrowOffsetX, arrowOffsetY); // Move to bolt position
        ctx.rotate(arrowRotation); // Apply independent bolt rotation
        ctx.drawImage(loadedArrowImage, -arrowWidth / 2, -arrowHeight / 2, arrowWidth, arrowHeight);
        ctx.restore(); // Restore context
    }
    // --- END NEW ---

    ctx.restore(); // Restore from regular item drawing / swing
  }

  ctx.restore(); // Restore overall item rendering context (matches the first ctx.save() in this block)

  // --- Draw Attack Visual Effect --- 
  if (isSwinging) { 
    if (itemDef.name === "Wooden Spear" || itemDef.name === "Stone Spear") {
        // Draw a "thrust line" effect for the spear
        ctx.save();
        try {
            ctx.beginPath();
            const spearLength = Math.max(displayItemWidth, displayItemHeight); 
            
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
          const slashRadius = Math.max(displayItemWidth, displayItemHeight) * 0.5; 
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