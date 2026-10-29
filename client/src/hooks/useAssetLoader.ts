import { useState, useEffect, useRef } from 'react';
import { itemIcons } from '../utils/itemIconUtils';
import { isWebGpuWorldEnabled } from '../engine/presentation/world3d/rendererRollout';

// Import asset paths
import heroSpriteSheet from '../assets/hero_walk.png';
import heroSprintSpriteSheet from '../assets/hero_sprint.png';
import heroIdleSpriteSheet from '../assets/hero_idle.png';
import heroWaterSpriteSheet from '../assets/hero_swim.png';
import heroCrouchSpriteSheet from '../assets/hero_crouch.png';
import heroDodgeSpriteSheet from '../assets/hero_dodge.png';
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
import droneTexture from '../assets/drone.png';

// Define the hook's return type for clarity
interface AssetLoaderResult {
  heroImageRef: React.RefObject<HTMLImageElement | null>;
  heroSprintImageRef: React.RefObject<HTMLImageElement | null>;
  heroIdleImageRef: React.RefObject<HTMLImageElement | null>;
  heroWaterImageRef: React.RefObject<HTMLImageElement | null>;
  heroCrouchImageRef: React.RefObject<HTMLImageElement | null>;
  heroDodgeImageRef: React.RefObject<HTMLImageElement | null>;
  campfireImageRef: React.RefObject<HTMLImageElement | null>;
  itemImagesRef: React.RefObject<Map<string, HTMLImageElement>>;
  burlapSackImageRef: React.RefObject<HTMLImageElement | null>;
  cloudImagesRef: React.RefObject<Map<string, HTMLImageElement>>;
  droneImageRef: React.RefObject<HTMLImageElement | null>;
  shelterImageRef: React.RefObject<HTMLImageElement | null>;
  isLoadingAssets: boolean;
}

export function useAssetLoader(worldSprites = !isWebGpuWorldEnabled()): AssetLoaderResult {
  const [isLoadingAssets, setIsLoadingAssets] = useState<boolean>(true);

  // Refs for the loaded images
  const heroImageRef = useRef<HTMLImageElement | null>(null);
  const heroSprintImageRef = useRef<HTMLImageElement | null>(null);
  const heroIdleImageRef = useRef<HTMLImageElement | null>(null);
  const heroWaterImageRef = useRef<HTMLImageElement | null>(null);
  const heroCrouchImageRef = useRef<HTMLImageElement | null>(null);
  const heroDodgeImageRef = useRef<HTMLImageElement | null>(null);
  const campfireImageRef = useRef<HTMLImageElement | null>(null);
  const burlapSackImageRef = useRef<HTMLImageElement | null>(null);
  const itemImagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const cloudImagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const droneImageRef = useRef<HTMLImageElement | null>(null);
  const shelterImageRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    let disposed = false;
    let loadedCount = 0;
    const totalStaticAssets = worldSprites ? 16 : 2;

    const itemIconEntries = Object.entries(itemIcons).filter(([, iconPath]) => iconPath);

    console.log(`[useAssetLoader] Loading ${totalStaticAssets} critical canvas assets; ${itemIconEntries.length} item icons will warm lazily`);

    const checkLoadingComplete = () => {
      if (!disposed && loadedCount === totalStaticAssets) {
        console.log(`[useAssetLoader] Critical canvas assets loaded; gameplay can render while remaining assets warm`);
        setIsLoadingAssets(false);
      }
    };

    const loadImage = (
      src: string,
      ref?: React.MutableRefObject<HTMLImageElement | null>,
      mapRef?: React.MutableRefObject<Map<string, HTMLImageElement>>,
      mapKey?: string,
      countForReady: boolean = true,
    ) => {
      if (mapRef && mapKey && mapRef.current.has(mapKey)) {
        if (countForReady) {
          loadedCount++;
          checkLoadingComplete();
        }
        return;
      }

      const img = new Image();
      img.onload = () => {
        if (disposed) return;
        if (ref) ref.current = img;
        if (mapRef && mapKey) {
          mapRef.current.set(mapKey, img);
          // console.log(`[useAssetLoader] Successfully loaded image: ${mapKey}`);
        }
        if (countForReady) {
          loadedCount++;
          checkLoadingComplete();
        }
      };
      img.onerror = () => {
        if (disposed) return;
        console.error(`Failed to load image: ${mapKey || src}`);
        if (countForReady) {
          loadedCount++;
          checkLoadingComplete();
        }
      };
      img.decoding = 'async';
      img.loading = 'eager';
      img.src = src;
    };

    const warmItemIconsInBackground = () => {
      let index = 0;
      const batchSize = 4;
      const delayMs = 80;

      const loadNextBatch = () => {
        if (disposed || index >= itemIconEntries.length) {
          return;
        }

        const batchEnd = Math.min(index + batchSize, itemIconEntries.length);
        for (; index < batchEnd; index++) {
          const [key, iconPath] = itemIconEntries[index];
          if (iconPath) {
            loadImage(iconPath, undefined, itemImagesRef, key, false);
          }
        }

        window.setTimeout(loadNextBatch, delayMs);
      };

      window.setTimeout(loadNextBatch, 0);
    };

    // UI item icons remain available without loading world sprites.
    loadImage(burlapSackUrl, burlapSackImageRef, itemImagesRef, 'burlap_sack.png');
    loadImage(deathMarkerUrl, undefined, itemImagesRef, 'death_marker.png');
    warmItemIconsInBackground();
    if (!worldSprites) return () => { disposed = true; };

    // --- Load Static Images --- 
    loadImage(heroSpriteSheet, heroImageRef);
    loadImage(heroSprintSpriteSheet, heroSprintImageRef);
    loadImage(heroIdleSpriteSheet, heroIdleImageRef);
    loadImage(heroWaterSpriteSheet, heroWaterImageRef);
    loadImage(heroCrouchSpriteSheet, heroCrouchImageRef);
    loadImage(heroDodgeSpriteSheet, heroDodgeImageRef);
    loadImage(campfireSprite, campfireImageRef);

    // Load Cloud Images
    loadImage(cloud1Texture, undefined, cloudImagesRef, 'cloud1.png');
    loadImage(cloud2Texture, undefined, cloudImagesRef, 'cloud2.png');
    loadImage(cloud3Texture, undefined, cloudImagesRef, 'cloud3.png');
    loadImage(cloud4Texture, undefined, cloudImagesRef, 'cloud4.png');
    loadImage(cloud5Texture, undefined, cloudImagesRef, 'cloud5.png');
    loadImage(droneTexture, droneImageRef);

    // Load Shelter Image
    const shelterImg = new Image();
    shelterImg.onload = () => {
      if (disposed) return;
      shelterImageRef.current = shelterImg;
      loadedCount++;
      checkLoadingComplete();
    };
    shelterImg.onerror = () => {
      if (disposed) return;
      console.error('Failed to load shelter image.');
      loadedCount++;
      checkLoadingComplete();
    };
    shelterImg.decoding = 'async';
    shelterImg.src = shelterSpritePath;


    return () => {
      disposed = true;
    };
  }, [worldSprites]);

  // Return the refs and loading state
  return {
    heroImageRef,
    heroSprintImageRef,
    heroIdleImageRef,
    heroWaterImageRef,
    heroCrouchImageRef,
    heroDodgeImageRef,
    campfireImageRef,
    burlapSackImageRef,
    itemImagesRef, 
    cloudImagesRef,
    droneImageRef,
    shelterImageRef,
    isLoadingAssets,
  };
}
