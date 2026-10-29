import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { isWebGpuWorldEnabled } from '../engine/presentation/world3d/rendererRollout';
import { preloadMonumentImages } from '../utils/renderers/monumentRenderingUtils';
import { preloadAlkStationImages } from '../utils/renderers/alkStationRenderingUtils';
import { preloadCairnImages } from '../utils/renderers/cairnRenderingUtils';
import { preloadRoadLamppostImages } from '../utils/renderers/roadLamppostRenderingUtils';
import { preloadWildAnimalImages } from '../utils/renderers/wildAnimalRenderingUtils';
import { preloadAnimalCorpseImages } from '../utils/renderers/animalCorpseRenderingUtils';
import { preloadFumaroleImages } from '../utils/renderers/fumaroleRenderingUtils';
import { preloadBasaltColumnImages } from '../utils/renderers/basaltColumnRenderingUtils';
import { touchCampfireFireWebGLInit } from '../utils/renderers/campfireFireOverlayUtils';
import foundationWoodTileUrl from '../assets/tiles/foundation_wood.png';
import foundationTwigTileUrl from '../assets/tiles/foundation_twig.png';
import foundationStoneTileUrl from '../assets/tiles/foundation_stone.png';
import foundationMetalTileUrl from '../assets/tiles/foundation_metal.png';
import wallTwigTileUrl from '../assets/tiles/wall_twig.png';
import wallWoodTileUrl from '../assets/tiles/wall_wood.png';
import wallStoneTileUrl from '../assets/tiles/wall_stone.png';
import wallMetalTileUrl from '../assets/tiles/wall_metal.png';
import ceilingTwigTileUrl from '../assets/tiles/ceiling_twig.png';
import pinMarkerUrl from '../assets/ui/marker.png';
import campfireWarmthUrl from '../assets/ui/warmth.png';
import torchOnUrl from '../assets/items/torch_on.png';

interface UseGameCanvasAssetPreloadOptions {
  itemImagesRef: RefObject<Map<string, HTMLImageElement>>;
  worldSprites?: boolean;
}

interface LoadedOverlayImages {
  pinMarkerImg: HTMLImageElement | null;
  campfireWarmthImg: HTMLImageElement | null;
  torchOnImg: HTMLImageElement | null;
}

export function useGameCanvasAssetPreload({
  itemImagesRef,
  worldSprites = !isWebGpuWorldEnabled(),
}: UseGameCanvasAssetPreloadOptions) {
  const foundationTileImagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const [imageLoadTrigger, setImageLoadTrigger] = useState(0);
  const [overlayImages, setOverlayImages] = useState<LoadedOverlayImages>({
    pinMarkerImg: null,
    campfireWarmthImg: null,
    torchOnImg: null,
  });
  const lastTriggeredSizeRef = useRef(0);

  useEffect(() => {
    const checkImages = () => {
      const currentSize = itemImagesRef.current?.size ?? 0;
      if (currentSize > lastTriggeredSizeRef.current && currentSize > 0) {
        lastTriggeredSizeRef.current = currentSize;
        setImageLoadTrigger((prev) => prev + 1);
      }
    };

    checkImages();
    const interval = setInterval(checkImages, 100);
    return () => clearInterval(interval);
  }, [itemImagesRef]);

  const deathMarkerImg = useMemo(() => {
    return itemImagesRef.current?.get('death_marker.png');
  }, [imageLoadTrigger, itemImagesRef]);

  useEffect(() => {
    if (!worldSprites) return;
    touchCampfireFireWebGLInit();
    void preloadAlkStationImages();
    preloadMonumentImages();
    preloadCairnImages();
    preloadRoadLamppostImages();
  }, [worldSprites]);

  useEffect(() => {
    if (!worldSprites) return;
    const tileAssets = [
      ['foundation_wood.png', foundationWoodTileUrl],
      ['foundation_twig.png', foundationTwigTileUrl],
      ['foundation_stone.png', foundationStoneTileUrl],
      ['foundation_metal.png', foundationMetalTileUrl],
      ['wall_twig.png', wallTwigTileUrl],
      ['wall_wood.png', wallWoodTileUrl],
      ['wall_stone.png', wallStoneTileUrl],
      ['wall_metal.png', wallMetalTileUrl],
      ['ceiling_twig.png', ceilingTwigTileUrl],
    ] as const;

    tileAssets.forEach(([assetName, assetUrl]) => {
      const img = new Image();
      img.onload = () => {
        foundationTileImagesRef.current.set(assetName, img);
      };
      img.onerror = () => console.error(`Failed to load ${assetName}`);
      img.src = assetUrl;
    });
  }, [worldSprites]);

  useEffect(() => {
    if (!worldSprites) return;
    preloadWildAnimalImages();
    preloadAnimalCorpseImages();
    preloadFumaroleImages();
    preloadBasaltColumnImages();
  }, [worldSprites]);

  useEffect(() => {
    const loadOverlayImage = (
      assetUrl: string,
      onLoad: (image: HTMLImageElement) => void,
      errorLabel: string,
    ) => {
      const img = new Image();
      img.onload = () => onLoad(img);
      img.onerror = () => console.error(`Failed to load ${errorLabel}`);
      img.src = assetUrl;
    };

    loadOverlayImage(pinMarkerUrl, (img) => {
      setOverlayImages((current) => ({ ...current, pinMarkerImg: img }));
    }, 'pin marker image');

    loadOverlayImage(campfireWarmthUrl, (img) => {
      setOverlayImages((current) => ({ ...current, campfireWarmthImg: img }));
    }, 'campfire warmth image');

    loadOverlayImage(torchOnUrl, (img) => {
      setOverlayImages((current) => ({ ...current, torchOnImg: img }));
    }, 'torch image');
  }, []);

  return {
    foundationTileImagesRef,
    deathMarkerImg,
    pinMarkerImg: overlayImages.pinMarkerImg,
    campfireWarmthImg: overlayImages.campfireWarmthImg,
    torchOnImg: overlayImages.torchOnImg,
  };
}
