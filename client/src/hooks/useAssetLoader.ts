import { useState, useEffect, useRef } from 'react';
import { imageManager } from '../utils/renderers/imageManager';
import { itemIcons } from '../utils/itemIconUtils';

// Import asset paths
import heroSpriteSheet from '../assets/hero2.png';
import heroWaterSpriteSheet from '../assets/hero2_water.png';
import heroCrouchSpriteSheet from '../assets/hero2_crouch.png';
import grassTexture from '../assets/tiles/grass2.png';
import campfireSprite from '../assets/doodads/campfire.png';
import burlapSackUrl from '../assets/items/burlap_sack.png';
import deathMarkerUrl from '../assets/items/death_marker.png';
import shelterSpritePath from '../assets/doodads/shelter.png';

// Import cloud image paths
import cloud1Texture from '../assets/environment/clouds/cloud1.png';
import cloud2Texture from '../assets/environment/clouds/cloud2.png';
import cloud3Texture from '../assets/environment/clouds/cloud3.png';
import cloud4Texture from '../assets/environment/clouds/cloud4.png';
import cloud5Texture from '../assets/environment/clouds/cloud5.png';

// Define the hook's return type for clarity
interface AssetLoaderResult {
  heroImageRef: React.RefObject<HTMLImageElement | null>;
  heroWaterImageRef: React.RefObject<HTMLImageElement | null>;
  heroCrouchImageRef: React.RefObject<HTMLImageElement | null>;
  grassImageRef: React.RefObject<HTMLImageElement | null>;
  campfireImageRef: React.RefObject<HTMLImageElement | null>;
  itemImagesRef: React.RefObject<Map<string, HTMLImageElement>>;
  burlapSackImageRef: React.RefObject<HTMLImageElement | null>;
  cloudImagesRef: React.RefObject<Map<string, HTMLImageElement>>;
  shelterImageRef: React.RefObject<HTMLImageElement | null>;
  isLoadingAssets: boolean;
}

export function useAssetLoader(): AssetLoaderResult {
  const [isLoadingAssets, setIsLoadingAssets] = useState<boolean>(true);

  // Refs for the loaded images
  const heroImageRef = useRef<HTMLImageElement | null>(null);
  const heroWaterImageRef = useRef<HTMLImageElement | null>(null);
  const heroCrouchImageRef = useRef<HTMLImageElement | null>(null);
  const grassImageRef = useRef<HTMLImageElement | null>(null);
  const campfireImageRef = useRef<HTMLImageElement | null>(null);
  const burlapSackImageRef = useRef<HTMLImageElement | null>(null);
  const itemImagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const cloudImagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const shelterImageRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    let loadedCount = 0;
    const totalStaticAssets = 6 + 5 + 1; // hero images + clouds + shelter
    
    // Count total item icons to preload
    const itemIconEntries = Object.entries(itemIcons).filter(([key, iconPath]) => iconPath);
    const totalItemIcons = itemIconEntries.length;
    const totalAssets = totalStaticAssets + totalItemIcons;
    
    console.log(`[useAssetLoader] Starting to load ${totalAssets} assets (${totalStaticAssets} static + ${totalItemIcons} item icons)`);

    const checkLoadingComplete = () => {
      if (loadedCount === totalAssets) {
        console.log(`[useAssetLoader] All ${totalAssets} assets loaded successfully!`);
        setIsLoadingAssets(false);
      }
    };

    const loadImage = (src: string, ref?: React.MutableRefObject<HTMLImageElement | null>, mapRef?: React.MutableRefObject<Map<string, HTMLImageElement>>, mapKey?: string) => {
      const img = new Image();
      img.src = src;
      img.onload = () => {
        if (ref) ref.current = img;
        if (mapRef && mapKey) {
          mapRef.current.set(mapKey, img);
          // console.log(`[useAssetLoader] Successfully loaded image: ${mapKey}`);
        }
        loadedCount++;
        checkLoadingComplete();
      };
      img.onerror = () => {
        console.error(`Failed to load image: ${mapKey || src}`);
        loadedCount++; 
        checkLoadingComplete();
      };
    };

    // --- Load Static Images --- 
    loadImage(heroSpriteSheet, heroImageRef);
    loadImage(heroWaterSpriteSheet, heroWaterImageRef);
    loadImage(heroCrouchSpriteSheet, heroCrouchImageRef);
    loadImage(grassTexture, grassImageRef);
    loadImage(campfireSprite, campfireImageRef);
    loadImage(burlapSackUrl, burlapSackImageRef, itemImagesRef, 'burlap_sack.png');
    loadImage(deathMarkerUrl, undefined, itemImagesRef, 'death_marker.png');

    // Load Cloud Images
    loadImage(cloud1Texture, undefined, cloudImagesRef, 'cloud1.png');
    loadImage(cloud2Texture, undefined, cloudImagesRef, 'cloud2.png');
    loadImage(cloud3Texture, undefined, cloudImagesRef, 'cloud3.png');
    loadImage(cloud4Texture, undefined, cloudImagesRef, 'cloud4.png');
    loadImage(cloud5Texture, undefined, cloudImagesRef, 'cloud5.png');

    // Load Shelter Image
    const shelterImg = new Image();
    shelterImg.onload = () => {
      shelterImageRef.current = shelterImg;
      loadedCount++;
      checkLoadingComplete();
    };
    shelterImg.onerror = () => {
      console.error('Failed to load shelter image.');
      loadedCount++;
      checkLoadingComplete();
    };
    shelterImg.src = shelterSpritePath;

    // Preload ALL item icons using ImageManager - this blocks completion until done
    console.log('[useAssetLoader] Preloading item icons via ImageManager...');
    itemIconEntries.forEach(([key, iconPath]) => {
      if (!iconPath) return; // Skip undefined paths
      
      // Preload with ImageManager for in-game access
      imageManager.preloadImage(iconPath);
      
      // Also count towards our loading completion
      const img = new Image();
      img.onload = () => {
        loadedCount++;
        checkLoadingComplete();
      };
      img.onerror = () => {
        console.error(`Failed to preload item icon: ${key} -> ${iconPath}`);
        loadedCount++;
        checkLoadingComplete();
      };
      img.src = iconPath;
    });

  }, []); // Runs once on mount

  // Return the refs and loading state
  return {
    heroImageRef,
    heroWaterImageRef,
    heroCrouchImageRef,
    grassImageRef,
    campfireImageRef,
    burlapSackImageRef,
    itemImagesRef, 
    cloudImagesRef,
    shelterImageRef,
    isLoadingAssets,
  };
} 