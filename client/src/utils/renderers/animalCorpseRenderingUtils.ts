import { AnimalCorpse as SpacetimeDBAnimalCorpse } from '../../generated';
import { imageManager } from './imageManager';

// Import animal images directly from assets
import cinderFoxImg from '../../assets/cinder_fox.png';
import cinderFox2Img from '../../assets/cinder_fox2.png';
import tundraWolfImg from '../../assets/tundra_wolf.png';
import tundraWolf2Img from '../../assets/tundra_wolf2.png';
import cableViperImg from '../../assets/cable_viper.png';
import walrusImg from '../../assets/walrus.png';

// Animal corpse dimensions and rendering constants
export const ANIMAL_CORPSE_HEIGHT = 96; // Height for interaction indicators
export const ANIMAL_CORPSE_COLLISION_RADIUS = 16; // From server-side constant

// Helper function to get correct image variation (consistent with live animals)
function getCorpseImageSrc(species: any, animalId: bigint): string {
    switch (species.tag) {
        case 'CinderFox':
            // Use same variation logic as live animals
            const foxVariation = Number(animalId) % 2;
            return foxVariation === 0 ? cinderFoxImg : cinderFox2Img;
        case 'TundraWolf':
            // Use same variation logic as live animals
            const wolfVariation = Number(animalId) % 2;
            return wolfVariation === 0 ? tundraWolfImg : tundraWolf2Img;
        case 'CableViper':
            return cableViperImg;
        case 'ArcticWalrus':
            return walrusImg;
        default:
            return cinderFoxImg;
    }
}

// Preload animal corpse images using imageManager
export const preloadAnimalCorpseImages = () => {
  // console.log('[AnimalCorpse] Preloading animal corpse images with imageManager...');
  
  // Preload using imageManager for consistency with other assets
  imageManager.preloadImage(cinderFoxImg);
  imageManager.preloadImage(cinderFox2Img);  // Add new cinder fox variation
  imageManager.preloadImage(tundraWolfImg);
  imageManager.preloadImage(tundraWolf2Img);  // Add new variation
  imageManager.preloadImage(cableViperImg);
  imageManager.preloadImage(walrusImg);  // Add missing walrus image
  
  // console.log('[AnimalCorpse] Animal corpse images queued for preloading');
};

/**
 * Renders an animal corpse as a flipped animal sprite
 */
export const renderAnimalCorpse = (
  ctx: CanvasRenderingContext2D,
  corpse: SpacetimeDBAnimalCorpse,
  currentTime: number
) => {
  // console.log(`🦴 [ANIMAL CORPSE RENDER] Rendering corpse ${corpse.id} at (${corpse.posX}, ${corpse.posY}) species: ${corpse.animalSpecies.tag}`);
  
  // Canvas is already translated, so we use world coordinates directly
  const screenX = corpse.posX;
  const screenY = corpse.posY;

  // Get the appropriate animal image based on species and ID for consistent variations
  const imageSrc = getCorpseImageSrc(corpse.animalSpecies, corpse.animalId);
  
  // console.log(`[AnimalCorpse] Looking for image: ${imageSrc}`);
  const img = imageManager.getImage(imageSrc);
  
  if (!img) {
    // console.log(`[AnimalCorpse] Image not loaded, rendering fallback rectangle at (${screenX}, ${screenY})`);
    // Fallback: render a simple rectangle if image not loaded
    ctx.fillStyle = '#8B4513'; // Brown color for corpse
    ctx.fillRect(screenX - 48, screenY - 48, 96, 96);
    // console.log(`[AnimalCorpse] Drew fallback rectangle for corpse ${corpse.id}`);
    return;
    }
  
  // console.log(`[AnimalCorpse] Image loaded successfully, proceeding with sprite render`);

  ctx.save();

  // Calculate shaking offset if corpse was recently damaged
  let shakeX = 0;
  let shakeY = 0;
  
  // Check if corpse was damaged recently (within last 200ms)
  const timeSinceLastDamage = currentTime - Number(corpse.lastHitTime?.microsSinceUnixEpoch || 0n) / 1000;
  if (timeSinceLastDamage < 200) {
    const shakeIntensity = Math.max(0, 3 - (timeSinceLastDamage / 200) * 3);
    shakeX = (Math.random() - 0.5) * shakeIntensity * 2;
    shakeY = (Math.random() - 0.5) * shakeIntensity * 2;
  }

  // Move to corpse position with shake offset
  ctx.translate(screenX + shakeX, screenY + shakeY);
  
  // Flip the sprite both horizontally and vertically to indicate it's dead (upside down)
  ctx.scale(-1, -1);
  
  // Render the animal image (flipped) - same size as live animals
  const imgWidth = 96;
  const imgHeight = 96;
  ctx.drawImage(img, -imgWidth / 2, -imgHeight / 2, imgWidth, imgHeight);

  ctx.restore();
  // console.log(`[AnimalCorpse] Completed rendering corpse ${corpse.id}`);
};

// Export for use in interaction system
export const getAnimalCorpseInteractionBounds = (corpse: SpacetimeDBAnimalCorpse) => ({
  x: corpse.posX - ANIMAL_CORPSE_COLLISION_RADIUS,
  y: corpse.posY - ANIMAL_CORPSE_COLLISION_RADIUS,
  width: ANIMAL_CORPSE_COLLISION_RADIUS * 2,
  height: ANIMAL_CORPSE_COLLISION_RADIUS * 2,
}); 