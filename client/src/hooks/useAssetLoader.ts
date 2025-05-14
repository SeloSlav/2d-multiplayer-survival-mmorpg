import { useState, useEffect, useRef } from 'react';

// Import asset paths
import heroSpriteSheet from '../assets/hero2.png';
import grassTexture from '../assets/tiles/grass.png';
import campfireSprite from '../assets/doodads/campfire.png';
import burlapSackUrl from '../assets/Items/burlap_sack.png';

// Define the hook's return type for clarity
interface AssetLoaderResult {
  heroImageRef: React.RefObject<HTMLImageElement | null>;
  grassImageRef: React.RefObject<HTMLImageElement | null>;
  campfireImageRef: React.RefObject<HTMLImageElement | null>;
  itemImagesRef: React.RefObject<Map<string, HTMLImageElement>>;
  burlapSackImageRef: React.RefObject<HTMLImageElement | null>;
  isLoadingAssets: boolean;
}

export function useAssetLoader(): AssetLoaderResult {
  const [isLoadingAssets, setIsLoadingAssets] = useState<boolean>(true);

  // Refs for the loaded images
  const heroImageRef = useRef<HTMLImageElement | null>(null);
  const grassImageRef = useRef<HTMLImageElement | null>(null);
  const campfireImageRef = useRef<HTMLImageElement | null>(null);
  const burlapSackImageRef = useRef<HTMLImageElement | null>(null);
  // Ref for the map that will store item icons (populated externally)
  const itemImagesRef = useRef<Map<string, HTMLImageElement>>(new Map());

  useEffect(() => {
    let loadedCount = 0;
    const totalStaticAssets = 4; // hero, grass, campfire sprite, burlap sack
    let allStaticLoaded = false;

    const checkLoadingComplete = () => {
      if (!allStaticLoaded && loadedCount === totalStaticAssets) {
        allStaticLoaded = true;
        // console.log('Essential static assets loaded.');
        setIsLoadingAssets(false); // Set loading to false only when hero, grass, campfire, and burlap sack are done
      }
    };

    // --- Load Static Images --- 

    // Load Hero
    const heroImg = new Image();
    heroImg.src = heroSpriteSheet;
    heroImg.onload = () => {
      heroImageRef.current = heroImg;
      // console.log('Hero spritesheet loaded by hook.');
      loadedCount++;
      checkLoadingComplete();
    };
    heroImg.onerror = () => {
      console.error('Failed to load hero spritesheet.');
      loadedCount++; // Count as loaded (failed) to not block forever
      checkLoadingComplete();
    };

    // Load Grass
    const grassImg = new Image();
    grassImg.src = grassTexture;
    grassImg.onload = () => {
       grassImageRef.current = grassImg;
       // console.log('Grass texture loaded by hook.');
       loadedCount++;
       checkLoadingComplete();
    };
    grassImg.onerror = () => {
       console.error('Failed to load grass texture.');
       loadedCount++;
       checkLoadingComplete();
    };

    // Load Campfire sprite (for placement preview)
    const fireImg = new Image();
    fireImg.src = campfireSprite;
    fireImg.onload = () => {
       campfireImageRef.current = fireImg;
       // console.log('Campfire sprite loaded by hook.');
       loadedCount++;
       checkLoadingComplete();
    };
    fireImg.onerror = () => {
      console.error('Failed to load campfire sprite.');
      loadedCount++;
      checkLoadingComplete();
    };

    // Load Burlap Sack
    const sackImg = new Image();
    sackImg.src = burlapSackUrl;
    sackImg.onload = () => {
      burlapSackImageRef.current = sackImg;
      itemImagesRef.current.set('burlap_sack.png', sackImg);
      loadedCount++;
      checkLoadingComplete();
    };
    sackImg.onerror = () => {
      console.error('Failed to load burlap sack image.');
      loadedCount++;
      checkLoadingComplete();
    };

    // --- Preload Entity Sprites (Fire-and-forget) ---
    // These don't block the main isLoadingAssets state
    try {
    
        // console.log('Entity preloading initiated by hook.');
    } catch (error) {
        console.error("Error during entity preloading:", error);
    }

  }, []); // Runs once on mount

  // Return the refs and loading state
  return {
    heroImageRef,
    grassImageRef,
    campfireImageRef,
    burlapSackImageRef,
    itemImagesRef, // Provide the ref for item icons
    isLoadingAssets,
  };
} 