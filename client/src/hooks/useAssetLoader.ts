import { useState, useEffect, useRef } from 'react';

// Import asset paths
import heroSpriteSheet from '../assets/hero2.png';
import grassTexture from '../assets/tiles/grass.png';
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
  const grassImageRef = useRef<HTMLImageElement | null>(null);
  const campfireImageRef = useRef<HTMLImageElement | null>(null);
  const burlapSackImageRef = useRef<HTMLImageElement | null>(null);
  const itemImagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const cloudImagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const shelterImageRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    let loadedCount = 0;
    const totalStaticAssets = 4 + 5 + 1;
    let allStaticLoaded = false;

    const checkLoadingComplete = () => {
      if (!allStaticLoaded && loadedCount === totalStaticAssets) {
        allStaticLoaded = true;
        setIsLoadingAssets(false);
      }
    };

    const loadImage = (src: string, ref?: React.MutableRefObject<HTMLImageElement | null>, mapRef?: React.MutableRefObject<Map<string, HTMLImageElement>>, mapKey?: string) => {
      const img = new Image();
      img.src = src;
      img.onload = () => {
        if (ref) ref.current = img;
        if (mapRef && mapKey) mapRef.current.set(mapKey, img);
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

    // --- Preload Entity Sprites (Fire-and-forget) ---
    // These don't block the main isLoadingAssets state
    try {
        // console.log('Entity preloading initiated by hook.');
    } catch (error) {
        console.error("Error during entity preloading:", error);
    }

    // ADDED: Preload shelter image
    const shelterImg = new Image();
    shelterImg.onload = () => {
      shelterImageRef.current = shelterImg;
      console.log('Shelter image loaded successfully.');
    };
    shelterImg.onerror = () => console.error('Failed to load shelter image.');
    shelterImg.src = shelterSpritePath; // Assuming shelterSpritePath is defined or imported

  }, []); // Runs once on mount

  // Return the refs and loading state
  return {
    heroImageRef,
    grassImageRef,
    campfireImageRef,
    burlapSackImageRef,
    itemImagesRef, 
    cloudImagesRef,
    shelterImageRef,
    isLoadingAssets,
  };
} 