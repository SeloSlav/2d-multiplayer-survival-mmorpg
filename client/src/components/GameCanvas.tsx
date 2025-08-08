import React, { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import {
  Player as SpacetimeDBPlayer,
  Tree as SpacetimeDBTree,
  Stone as SpacetimeDBStone,
  Campfire as SpacetimeDBCampfire,
  Furnace as SpacetimeDBFurnace, // ADDED: Furnace import
  Lantern as SpacetimeDBLantern,
  WorldState as SpacetimeDBWorldState,
  ActiveEquipment as SpacetimeDBActiveEquipment,
  InventoryItem as SpacetimeDBInventoryItem,
  ItemDefinition as SpacetimeDBItemDefinition,
  DroppedItem as SpacetimeDBDroppedItem,
  WoodenStorageBox as SpacetimeDBWoodenStorageBox,
  PlayerPin as SpacetimeDBPlayerPin,
  ActiveConnection,
  SleepingBag as SpacetimeDBSleepingBag,
  PlayerCorpse as SpacetimeDBPlayerCorpse,
  Stash as SpacetimeDBStash,
  RainCollector as SpacetimeDBRainCollector,
  WaterPatch as SpacetimeDBWaterPatch,
  Cloud as SpacetimeDBCloud,
  ActiveConsumableEffect as SpacetimeDBActiveConsumableEffect,
  Grass as SpacetimeDBGrass,
  Projectile as SpacetimeDBProjectile,
  DeathMarker as SpacetimeDBDeathMarker,
  Shelter as SpacetimeDBShelter,
  MinimapCache as SpacetimeDBMinimapCache,
  WorldChunkData as SpacetimeDBWorldChunkData,
  FishingSession,
  PlantedSeed as SpacetimeDBPlantedSeed,
  PlantType as SpacetimeDBPlantType,
  PlayerDrinkingCooldown as SpacetimeDBPlayerDrinkingCooldown,
  WildAnimal as SpacetimeDBWildAnimal,
  ViperSpittle as SpacetimeDBViperSpittle,
  AnimalCorpse as SpacetimeDBAnimalCorpse,
  Barrel as SpacetimeDBBarrel,
  HarvestableResource as SpacetimeDBHarvestableResource,
} from '../generated';

// --- Core Hooks ---
import { useAnimationCycle, useWalkingAnimationCycle, useSprintAnimationCycle, useIdleAnimationCycle } from '../hooks/useAnimationCycle';
import { useAssetLoader } from '../hooks/useAssetLoader';
import { useGameViewport } from '../hooks/useGameViewport';
import { useMousePosition } from '../hooks/useMousePosition';
import { useDayNightCycle } from '../hooks/useDayNightCycle';
import { useInteractionFinder } from '../hooks/useInteractionFinder';
import { useGameLoop } from '../hooks/useGameLoop';
import type { FrameInfo } from '../hooks/useGameLoop';
import { usePlayerHover } from '../hooks/usePlayerHover';
import { useMinimapInteraction } from '../hooks/useMinimapInteraction';
import { useEntityFiltering, YSortedEntityType } from '../hooks/useEntityFiltering';
import { useSpacetimeTables } from '../hooks/useSpacetimeTables';
import { useCampfireParticles, Particle } from '../hooks/useCampfireParticles';
import { useTorchParticles } from '../hooks/useTorchParticles';
import { useResourceSparkleParticles } from '../hooks/useResourceSparkleParticles';
import { useCloudInterpolation, InterpolatedCloudData } from '../hooks/useCloudInterpolation';
import { useGrassInterpolation, InterpolatedGrassData } from '../hooks/useGrassInterpolation';
import { useArrowBreakEffects } from '../hooks/useArrowBreakEffects';
import { useThunderEffects } from '../hooks/useThunderEffects';
import { useFireArrowParticles } from '../hooks/useFireArrowParticles';
import { useWorldTileCache } from '../hooks/useWorldTileCache';
import { useAmbientSounds } from '../hooks/useAmbientSounds';
import { useFurnaceParticles } from '../hooks/useFurnaceParticles';

// --- Rendering Utilities ---
import { renderWorldBackground } from '../utils/renderers/worldRenderingUtils';
import { renderCyberpunkGridBackground } from '../utils/renderers/cyberpunkGridBackground';
import { renderYSortedEntities } from '../utils/renderers/renderingUtils.ts';
import { renderInteractionLabels } from '../utils/renderers/labelRenderingUtils.ts';
import { renderPlacementPreview, isPlacementTooFar } from '../utils/renderers/placementRenderingUtils.ts';
import { drawInteractionIndicator } from '../utils/interactionIndicator';
import { drawMinimapOntoCanvas } from './Minimap';
import { renderCampfire } from '../utils/renderers/campfireRenderingUtils';
import { renderDroppedItem } from '../utils/renderers/droppedItemRenderingUtils.ts';
import { renderSleepingBag } from '../utils/renderers/sleepingBagRenderingUtils';
import { renderPlayerCorpse } from '../utils/renderers/playerCorpseRenderingUtils';
import { renderStash } from '../utils/renderers/stashRenderingUtils';
import { renderPlayerTorchLight, renderCampfireLight, renderLanternLight, renderFurnaceLight } from '../utils/renderers/lightRenderingUtils';
import { renderTree } from '../utils/renderers/treeRenderingUtils';
import { renderCloudsDirectly } from '../utils/renderers/cloudRenderingUtils';
import { renderProjectile } from '../utils/renderers/projectileRenderingUtils';
import { renderShelter } from '../utils/renderers/shelterRenderingUtils';
import { setShelterClippingData } from '../utils/renderers/shadowUtils';
import { renderRain } from '../utils/renderers/rainRenderingUtils';
import { renderWaterOverlay } from '../utils/renderers/waterOverlayUtils';
import { renderPlayer, isPlayerHovered } from '../utils/renderers/playerRenderingUtils';
import { renderSeaStackSingle } from '../utils/renderers/seaStackRenderingUtils';
import { renderWaterPatches } from '../utils/renderers/waterPatchRenderingUtils';
import { renderWildAnimal, preloadWildAnimalImages } from '../utils/renderers/wildAnimalRenderingUtils';
import { renderViperSpittle } from '../utils/renderers/viperSpittleRenderingUtils';
import { renderAnimalCorpse, preloadAnimalCorpseImages } from '../utils/renderers/animalCorpseRenderingUtils';
import { renderEquippedItem } from '../utils/renderers/equippedItemRenderingUtils';

// --- Other Components & Utils ---
import DeathScreen from './DeathScreen.tsx';
import InterfaceContainer from './InterfaceContainer';
import { itemIcons } from '../utils/itemIconUtils';
import { PlacementItemInfo, PlacementActions } from '../hooks/usePlacementManager';
import { HOLD_INTERACTION_DURATION_MS, REVIVE_HOLD_DURATION_MS } from '../config/gameConfig';
import {
  CAMPFIRE_HEIGHT,
  SERVER_CAMPFIRE_DAMAGE_RADIUS,
  SERVER_CAMPFIRE_DAMAGE_CENTER_Y_OFFSET
} from '../utils/renderers/campfireRenderingUtils';
// V2 system removed due to performance issues
import { BOX_HEIGHT } from '../utils/renderers/woodenStorageBoxRenderingUtils';
import { useInputHandler } from '../hooks/useInputHandler';
import { useRemotePlayerInterpolation } from '../hooks/useRemotePlayerInterpolation';


// Define a placeholder height for Stash for indicator rendering
const STASH_HEIGHT = 40; // Adjust as needed to match stash sprite or desired indicator position

// Import cut grass effect renderer
import { renderCutGrassEffects } from '../effects/cutGrassEffect';
import { renderArrowBreakEffects } from '../effects/arrowBreakEffect';

// --- Prop Interface ---
interface GameCanvasProps {
  players: Map<string, SpacetimeDBPlayer>;
  trees: Map<string, SpacetimeDBTree>;
  clouds: Map<string, SpacetimeDBCloud>;
  stones: Map<string, SpacetimeDBStone>;
  campfires: Map<string, SpacetimeDBCampfire>;
  furnaces: Map<string, SpacetimeDBFurnace>; // ADDED: Furnaces prop
  lanterns: Map<string, SpacetimeDBLantern>;
  harvestableResources: Map<string, SpacetimeDBHarvestableResource>;
  droppedItems: Map<string, SpacetimeDBDroppedItem>;
  woodenStorageBoxes: Map<string, SpacetimeDBWoodenStorageBox>;
  sleepingBags: Map<string, SpacetimeDBSleepingBag>;
  playerCorpses: Map<string, SpacetimeDBPlayerCorpse>;
  stashes: Map<string, SpacetimeDBStash>;
  rainCollectors: Map<string, SpacetimeDBRainCollector>;
  waterPatches: Map<string, SpacetimeDBWaterPatch>;
  playerPins: Map<string, SpacetimeDBPlayerPin>;
  inventoryItems: Map<string, SpacetimeDBInventoryItem>;
  itemDefinitions: Map<string, SpacetimeDBItemDefinition>;
  activeConsumableEffects: Map<string, SpacetimeDBActiveConsumableEffect>;
  worldState: SpacetimeDBWorldState | null;
  activeConnections: Map<string, ActiveConnection> | undefined;
  localPlayerId?: string;
  connection: any | null;
  predictedPosition: { x: number; y: number } | null;
  activeEquipments: Map<string, SpacetimeDBActiveEquipment>;
  grass: Map<string, SpacetimeDBGrass>;
  placementInfo: PlacementItemInfo | null;
  placementActions: PlacementActions;
  placementError: string | null;
  onSetInteractingWith: (target: { type: string; id: number | bigint } | null) => void;
  isMinimapOpen: boolean;
  setIsMinimapOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isChatting: boolean;
  messages: any;
  isSearchingCraftRecipes?: boolean;
  showInventory: boolean;
  gameCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  projectiles: Map<string, SpacetimeDBProjectile>;
  deathMarkers: Map<string, SpacetimeDBDeathMarker>;
  shelters: Map<string, SpacetimeDBShelter>;
  showAutotileDebug: boolean;
  minimapCache: any; // Add this for minimapCache
  isGameMenuOpen: boolean; // Add this prop
  onAutoActionStatesChange?: (isAutoAttacking: boolean) => void;
  isFishing: boolean;
  plantedSeeds: Map<string, SpacetimeDBPlantedSeed>;
  playerDrinkingCooldowns: Map<string, SpacetimeDBPlayerDrinkingCooldown>; // Add player drinking cooldowns
  wildAnimals: Map<string, SpacetimeDBWildAnimal>;
    viperSpittles: Map<string, SpacetimeDBViperSpittle>;
    animalCorpses: Map<string, SpacetimeDBAnimalCorpse>; // Add viper spittles
  barrels: Map<string, SpacetimeDBBarrel>; // Add barrels
  seaStacks: Map<string, any>; // Add sea stacks
  setMusicPanelVisible: React.Dispatch<React.SetStateAction<boolean>>;
  // Add ambient sound volume control
  environmentalVolume?: number; // 0-1 scale for ambient/environmental sounds
  movementDirection: { x: number; y: number };
  playerDodgeRollStates: Map<string, any>; // PlayerDodgeRollState from generated types
  // ADD: Local facing direction for instant visual feedback (client-authoritative)
  localFacingDirection?: string;
  // NEW: Visual cortex module setting for tree shadows
  treeShadowsEnabled?: boolean;
}

/**
 * GameCanvas Component
 *
 * The main component responsible for rendering the game world, entities, UI elements,
 * and handling the game loop orchestration. It integrates various custom hooks
 * to manage specific aspects like input, viewport, assets, day/night cycle, etc.
 */
const GameCanvas: React.FC<GameCanvasProps> = ({
  players,
  trees,
  clouds,
  stones,
  campfires,
  furnaces, // ADDED: Furnaces destructuring
  lanterns,
  harvestableResources,
  droppedItems,
  woodenStorageBoxes,
  sleepingBags,
  playerCorpses,
  stashes,
  rainCollectors,
  waterPatches,
  playerPins,
  inventoryItems,
  itemDefinitions,
  activeConsumableEffects,
  worldState,
  localPlayerId,
  connection,
  predictedPosition,
  activeEquipments,
  activeConnections,
  placementInfo,
  placementActions,
  placementError,
  onSetInteractingWith,
  isMinimapOpen,
  setIsMinimapOpen,
  isChatting,
  messages,
  isSearchingCraftRecipes,
  showInventory,
  grass,
  gameCanvasRef,
  projectiles,
  deathMarkers,
  shelters,
  showAutotileDebug,
  minimapCache,
  isGameMenuOpen,
  onAutoActionStatesChange,
  isFishing,
  plantedSeeds,
  playerDrinkingCooldowns,
  wildAnimals,
  viperSpittles,
  animalCorpses,
  barrels,
  seaStacks,
  setMusicPanelVisible,
  environmentalVolume,
  movementDirection,
  playerDodgeRollStates,
  localFacingDirection, // ADD: Destructure local facing direction for client-authoritative direction changes
  treeShadowsEnabled, // NEW: Destructure treeShadowsEnabled for visual cortex module setting
}) => {
  // console.log('[GameCanvas IS RUNNING] showInventory:', showInventory);

  // console.log("Cloud data in GameCanvas:", Array.from(clouds?.values() || []));

  // --- Refs ---
  const frameNumber = useRef(0);
  const lastPositionsRef = useRef<Map<string, { x: number, y: number }>>(new Map());
  const placementActionsRef = useRef(placementActions);
  const prevPlayerHealthRef = useRef<number | undefined>(undefined);
  const [damagingCampfireIds, setDamagingCampfireIds] = useState<Set<string>>(new Set());
  
  // Minimap canvas ref for the InterfaceContainer
  const minimapCanvasRef = useRef<HTMLCanvasElement>(null);

  // Particle system refs
  const campfireParticlesRef = useRef<Particle[]>([]);
  const torchParticlesRef = useRef<Particle[]>([]);

  useEffect(() => {
    placementActionsRef.current = placementActions;
  }, [placementActions]);

  // --- Core Game State Hooks ---
  const localPlayer = useMemo(() => {
    if (!localPlayerId) {
      // console.log('[GameCanvas DEBUG] localPlayerId is falsy:', localPlayerId);
      return undefined;
    }
    const player = players.get(localPlayerId);
    // console.log('[GameCanvas DEBUG] localPlayerId:', localPlayerId, 'found player:', !!player, 'players.size:', players.size);
    if (player) {
      // console.log('[GameCanvas DEBUG] player position:', player.positionX, player.positionY);
      // console.log('[GameCanvas DEBUG] predicted position:', predictedPosition);
    } else {
      // console.log('[GameCanvas DEBUG] Player not found in players map. Available player IDs:', Array.from(players.keys()));
    }
    return player;
  }, [players, localPlayerId, predictedPosition]);

  // Initialize remote player interpolation
  const remotePlayerInterpolation = useRemotePlayerInterpolation();

  const { canvasSize, cameraOffsetX, cameraOffsetY } = useGameViewport(localPlayer, predictedPosition);
  // console.log('[GameCanvas DEBUG] Camera offsets:', cameraOffsetX, cameraOffsetY, 'canvas size:', canvasSize);
  
  const { heroImageRef, heroSprintImageRef, heroIdleImageRef, heroWaterImageRef, heroCrouchImageRef, heroDodgeImageRef, grassImageRef, itemImagesRef, cloudImagesRef, shelterImageRef } = useAssetLoader();
  const doodadImagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const { worldMousePos, canvasMousePos } = useMousePosition({ canvasRef: gameCanvasRef, cameraOffsetX, cameraOffsetY, canvasSize });

  // Add a state to track when images are loaded to trigger re-renders
  const [imageLoadTrigger, setImageLoadTrigger] = useState(0);

  // Effect to trigger re-render when images are loaded
  useEffect(() => {
    const checkImages = () => {
      if (itemImagesRef.current && itemImagesRef.current.size > 0) {
        setImageLoadTrigger(prev => prev + 1);
      }
    };

    // Check immediately
    checkImages();

    // Set up an interval to check periodically (will be cleaned up when images are loaded)
    const interval = setInterval(checkImages, 100);

    // Clean up interval when we have images
    if (itemImagesRef.current && itemImagesRef.current.size > 0) {
      clearInterval(interval);
    }

    return () => clearInterval(interval);
  }, []);

  // Lift deathMarkerImg definition here - reactive to image loading
  const deathMarkerImg = useMemo(() => {
    const img = itemImagesRef.current?.get('death_marker.png');
    // console.log('[GameCanvas] Computing deathMarkerImg. itemImagesRef keys:', Array.from(itemImagesRef.current?.keys() || []), 'death_marker.png found:', !!img, 'trigger:', imageLoadTrigger);
    return img;
  }, [itemImagesRef, imageLoadTrigger]);

  // Minimap icon images loading using imports (Vite way)
  const [pinMarkerImg, setPinMarkerImg] = useState<HTMLImageElement | null>(null);
  const [campfireWarmthImg, setCampfireWarmthImg] = useState<HTMLImageElement | null>(null);
  const [torchOnImg, setTorchOnImg] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    // Load pin marker image using dynamic import
    import('../assets/ui/marker.png').then((module) => {
      const pinImg = new Image();
      pinImg.onload = () => {
        // console.log('[GameCanvas] Pin marker image loaded successfully');
        setPinMarkerImg(pinImg);
      };
      pinImg.onerror = () => console.error('Failed to load pin marker image');
      pinImg.src = module.default;
    });

    // Load campfire warmth image using dynamic import
    import('../assets/ui/warmth.png').then((module) => {
      const warmthImg = new Image();
      warmthImg.onload = () => {
        // console.log('[GameCanvas] Campfire warmth image loaded successfully');
        setCampfireWarmthImg(warmthImg);
      };
      warmthImg.onerror = () => console.error('Failed to load campfire warmth image');
      warmthImg.src = module.default;
    });

    // Load torch image using dynamic import
    import('../assets/items/torch_on.png').then((module) => {
      const torchImg = new Image();
      torchImg.onload = () => {
        // console.log('[GameCanvas] Torch image loaded successfully');
        setTorchOnImg(torchImg);
      };
      torchImg.onerror = () => console.error('Failed to load torch image');
      torchImg.src = module.default;
    });
  }, []);

  const { overlayRgba, maskCanvasRef } = useDayNightCycle({
    worldState,
    campfires,
    lanterns,
    furnaces, // Add furnaces for darkness cutouts
    players, // Pass all players
    activeEquipments, // Pass all active equipments
    itemDefinitions, // Pass all item definitions
    cameraOffsetX,
    cameraOffsetY,
    canvasSize,
    // Add interpolation parameters for smooth torch light cutouts
    localPlayerId,
    predictedPosition,
    remotePlayerInterpolation,
  });

  // useInteractionFinder moved after visibleWorldTiles definition

  // useInputHandler moved after unifiedInteractableTarget definition

  const animationFrame = useWalkingAnimationCycle(); // Faster, smoother walking animation
  const sprintAnimationFrame = useSprintAnimationCycle(); // Even faster animation for sprinting
  const idleAnimationFrame = useIdleAnimationCycle(); // Slower, relaxed animation for idle state

  // Use ref instead of state to avoid re-renders every frame
  const deltaTimeRef = useRef<number>(0);

  const interpolatedClouds = useCloudInterpolation({ serverClouds: clouds, deltaTime: deltaTimeRef.current });
  const interpolatedGrass = useGrassInterpolation({ serverGrass: grass, deltaTime: deltaTimeRef.current });

  // --- Use Entity Filtering Hook ---
  const {
    visibleSleepingBags,
    visibleHarvestableResources,
    visibleDroppedItems,
    visibleCampfires,
    visibleFurnaces, // ADDED: Furnaces visible array
    visibleHarvestableResourcesMap,
    visibleCampfiresMap,
    visibleFurnacesMap, // ADDED: Furnaces visible map
    visibleLanternsMap,
    visibleDroppedItemsMap,
    visibleBoxesMap,
    visiblePlayerCorpses,
    visibleStashes,
    visiblePlayerCorpsesMap,
    visibleStashesMap,
    visibleSleepingBagsMap,
    visibleTrees,
    visibleTreesMap,
    ySortedEntities,
    visibleGrass,
    visibleGrassMap,
    visibleShelters,
    visibleSheltersMap,
    visibleLanterns,
    visibleWildAnimals,
    visibleWildAnimalsMap,
    visibleViperSpittles,
    visibleViperSpittlesMap,
    visibleAnimalCorpses,
    visibleAnimalCorpsesMap,
    visibleBarrels,
    visibleBarrelsMap,
    visibleSeaStacks,
    visibleSeaStacksMap,
  } = useEntityFiltering(
    players,
    trees,
    stones,
    campfires,
    furnaces, // ADDED: Furnaces to useEntityFiltering
    lanterns,
    harvestableResources,
    droppedItems,
    woodenStorageBoxes,
    sleepingBags,
    playerCorpses,
    stashes,
    cameraOffsetX,
    cameraOffsetY,
    canvasSize.width,
    canvasSize.height,
    interpolatedGrass,
    projectiles,
    shelters,
    clouds,
    plantedSeeds,
    rainCollectors,
    wildAnimals,
    viperSpittles,
    animalCorpses,
    barrels,
    seaStacks,
  );

  // --- UI State ---
  const { hoveredPlayerIds, handlePlayerHover } = usePlayerHover();

  // --- Use the new Minimap Interaction Hook ---
  const { minimapZoom, isMouseOverMinimap, isMouseOverXButton, localPlayerPin, viewCenterOffset } = useMinimapInteraction({
    canvasRef: minimapCanvasRef, // Use minimap canvas instead of game canvas
    localPlayer,
    isMinimapOpen,
    connection,
    playerPins,
    localPlayerId,
    canvasSize: { width: 650, height: 650 }, // Use updated minimap dimensions
    setIsMinimapOpen
  });

  // --- Procedural World Tile Management ---
  const { proceduralRenderer, isInitialized: isWorldRendererInitialized, updateTileCache } = useWorldTileCache();

  // Compressed chunk cache (avoids per-tile subscriptions)
  const chunkCacheRef = useRef<Map<string, SpacetimeDBWorldChunkData>>(new Map());
  const chunkSizeRef = useRef<number>(8);
  const [chunkCacheVersion, setChunkCacheVersion] = useState(0);

  // Subscribe once to all compressed chunks (small row count, stable; avoids spatial churn)
  useEffect(() => {
    if (!connection) return;

    // Row callbacks
    const handleChunkInsert = (_ctx: any, row: SpacetimeDBWorldChunkData) => {
      const key = `${row.chunkX},${row.chunkY}`;
      chunkCacheRef.current.set(key, row);
      chunkSizeRef.current = row.chunkSize || chunkSizeRef.current;
      setChunkCacheVersion(v => v + 1);
    };
    const handleChunkUpdate = (_ctx: any, _oldRow: SpacetimeDBWorldChunkData, row: SpacetimeDBWorldChunkData) => {
      const key = `${row.chunkX},${row.chunkY}`;
      chunkCacheRef.current.set(key, row);
      chunkSizeRef.current = row.chunkSize || chunkSizeRef.current;
      setChunkCacheVersion(v => v + 1);
    };
    const handleChunkDelete = (_ctx: any, row: SpacetimeDBWorldChunkData) => {
      const key = `${row.chunkX},${row.chunkY}`;
      chunkCacheRef.current.delete(key);
      setChunkCacheVersion(v => v + 1);
    };

    // Register callbacks
    connection.db.worldChunkData.onInsert(handleChunkInsert);
    connection.db.worldChunkData.onUpdate(handleChunkUpdate);
    connection.db.worldChunkData.onDelete(handleChunkDelete);

    // Subscribe to the entire table once (hundreds of rows, lightweight)
    const handle = connection
      .subscriptionBuilder()
      .onError((err: any) => console.error('[WORLD_CHUNK_DATA Sub Error]:', err))
      .subscribe('SELECT * FROM world_chunk_data');

    return () => {
      try { handle?.unsubscribe?.(); } catch {}
    };
  }, [connection]);

  // Build a lightweight worldTiles map only for the current viewport from compressed chunks
  const visibleWorldTiles = useMemo(() => {
    const map = new Map<string, any>();
    const tileSize = 48; // matches server TILE_SIZE_PX
    const chunkSize = chunkSizeRef.current;

    const viewMinX = Math.floor((-cameraOffsetX) / tileSize);
    const viewMinY = Math.floor((-cameraOffsetY) / tileSize);
    const viewMaxX = Math.ceil((-cameraOffsetX + canvasSize.width) / tileSize);
    const viewMaxY = Math.ceil((-cameraOffsetY + canvasSize.height) / tileSize);

    // Small buffer to avoid popping at edges
    const minTileX = Math.max(0, viewMinX - 2);
    const minTileY = Math.max(0, viewMinY - 2);
    const maxTileX = viewMaxX + 2;
    const maxTileY = viewMaxY + 2;

    const typeFromU8 = (v: number): string => {
      switch (v) {
        case 0: return 'Grass';
        case 1: return 'Dirt';
        case 2: return 'DirtRoad';
        case 3: return 'Sea';
        case 4: return 'Beach';
        case 5: return 'Sand';
        default: return 'Grass';
      }
    };

    for (let ty = minTileY; ty < maxTileY; ty++) {
      for (let tx = minTileX; tx < maxTileX; tx++) {
        const cx = Math.floor(tx / chunkSize);
        const cy = Math.floor(ty / chunkSize);
        const chunk = chunkCacheRef.current.get(`${cx},${cy}`);
        if (!chunk) continue;

        const localX = tx % chunkSize;
        const localY = ty % chunkSize;
        if (localX < 0 || localY < 0) continue;
        const idx = localY * chunk.chunkSize + localX;
        if (idx < 0 || idx >= chunk.tileTypes.length) continue;

        const t = chunk.tileTypes[idx];
        const v = chunk.variants?.[idx] ?? 0;
        const key = `${tx}_${ty}`;
        map.set(key, {
          worldX: tx,
          worldY: ty,
          tileType: { tag: typeFromU8(t) },
          variant: v,
        });
      }
    }
    return map;
  }, [cameraOffsetX, cameraOffsetY, canvasSize.width, canvasSize.height, chunkCacheVersion]);

  // Feed the renderer with only the visible tiles
  useEffect(() => {
    if (visibleWorldTiles && visibleWorldTiles.size > 0) {
      updateTileCache(visibleWorldTiles);
    }
  }, [visibleWorldTiles, updateTileCache]);

  // --- Interaction Finding System ---
  const {
    closestInteractableTarget,
    closestInteractableHarvestableResourceId,
    closestInteractableCampfireId,
    closestInteractableDroppedItemId,
    closestInteractableBoxId,
    isClosestInteractableBoxEmpty,
    closestInteractableCorpseId,
    closestInteractableStashId,
    closestInteractableSleepingBagId,
    closestInteractableKnockedOutPlayerId,
    closestInteractableWaterPosition,
  } = useInteractionFinder({
    localPlayer,
    campfires,
    furnaces, // ADDED: Furnaces to useInteractionFinder
    droppedItems,
    woodenStorageBoxes,
    playerCorpses,
    stashes,
    sleepingBags,
    players,
    shelters,
    connection,
    lanterns,
    inventoryItems,
    itemDefinitions,
    playerDrinkingCooldowns,
    rainCollectors,
    harvestableResources,
    worldTiles: visibleWorldTiles,
  });

  // Synthesize unified target including water when no other target exists
  const unifiedInteractableTarget = useMemo(() => {
    // If we have a regular target, use it
    if (closestInteractableTarget) return closestInteractableTarget;
    
    // If no regular target but we have water position, create water target
    if (closestInteractableWaterPosition) {
      return {
        type: 'water' as const,
        id: 'water',
        position: { x: closestInteractableWaterPosition.x, y: closestInteractableWaterPosition.y },
        distance: 0,
        data: undefined,
      };
    }
    
    return null;
  }, [closestInteractableTarget, closestInteractableWaterPosition]);

  // --- Action Input Handler ---
  const {
    interactionProgress: holdInteractionProgress,
    isActivelyHolding,
    currentJumpOffsetY,
    isAutoAttacking,
    isCrouching: localPlayerIsCrouching,
    processInputsAndActions,
  } = useInputHandler({
    canvasRef: gameCanvasRef,
    connection,
    localPlayerId: localPlayer?.identity?.toHexString(),
    localPlayer,
    activeEquipments,
    itemDefinitions,
    inventoryItems,
    placementInfo,
    placementActions,
    worldMousePos,
    // UNIFIED INTERACTION TARGET - single source of truth (includes water fallback)
    closestInteractableTarget: unifiedInteractableTarget,
    // Essential entity maps for validation and data lookup
    woodenStorageBoxes,
    stashes,
    players,
    onSetInteractingWith: onSetInteractingWith,
    isMinimapOpen,
    setIsMinimapOpen,
    isChatting: isChatting,
    isInventoryOpen: showInventory,
    isGameMenuOpen,
    isSearchingCraftRecipes,
    isFishing,
    setMusicPanelVisible,
    movementDirection,
    // Individual entity IDs for consistency and backward compatibility
  });

  // Define camera and canvas dimensions for rendering
  const camera = { x: cameraOffsetX, y: cameraOffsetY };
  const currentCanvasWidth = canvasSize.width;
  const currentCanvasHeight = canvasSize.height;

  // Audio enabled state
  const audioEnabled = true; // You can make this configurable later

  // --- Should show death screen ---
  // Show death screen only based on isDead flag now
  const shouldShowDeathScreen = !!(localPlayer?.isDead && connection);

  // Set cursor style based on placement, but don't override if game menu is open
  const cursorStyle = isGameMenuOpen ? 'default' : (placementInfo ? 'cell' : 'crosshair');

  // CORRECTLY DERIVE localPlayerDeathMarker from the deathMarkers prop
  const localPlayerDeathMarker = useMemo(() => {
    // console.log('[GameCanvas] Computing localPlayerDeathMarker. localPlayer:', localPlayer?.identity?.toHexString(), 'deathMarkers size:', deathMarkers?.size, 'all markers:', Array.from(deathMarkers?.keys() || []));
    if (localPlayer && localPlayer.identity && deathMarkers) {
      const marker = deathMarkers.get(localPlayer.identity.toHexString());
      // console.log('[GameCanvas] Found death marker for player:', marker);
      return marker || null;
    }
    return null;
  }, [localPlayer, deathMarkers]);

  // Add debug logging for death screen
  // console.log('[GameCanvas] Death screen check:', {
  //   localPlayerIsDead: localPlayer?.isDead,
  //   hasConnection: !!connection,
  //   shouldShowDeathScreen,
  //   localPlayerDeathMarker: localPlayerDeathMarker ? 'present' : 'null',
  //   deathMarkerImg: deathMarkerImg ? 'loaded' : 'null'
  // });

  // --- Effects ---
  useEffect(() => {
    // Iterate over all known icons in itemIconUtils.ts to ensure they are preloaded
    Object.entries(itemIcons).forEach(([assetName, iconSrc]) => {
      // Ensure iconSrc is a string (path) and not already loaded
      if (iconSrc && typeof iconSrc === 'string' && !itemImagesRef.current.has(assetName)) {
        const img = new Image();
        img.src = iconSrc; // iconSrc is the imported image path
        img.onload = () => {
          itemImagesRef.current.set(assetName, img); // Store with assetName as key
        };
        img.onerror = () => console.error(`Failed to preload item image asset: ${assetName} (Source: ${iconSrc})`);
      }
    });
  }, [itemImagesRef]); // itemIcons is effectively constant from import, so run once on mount based on itemImagesRef

  // Load doodad images
  useEffect(() => {
    import('../assets/doodads/planted_seed.png').then((module) => {
      const img = new Image();
      img.onload = () => {
        doodadImagesRef.current.set('planted_seed.png', img);
      };
      img.onerror = () => console.error('Failed to load planted_seed.png');
      img.src = module.default;
    });

    import('../assets/doodads/reed_rain_collector.png').then((module) => {
      const img = new Image();
      img.onload = () => {
        doodadImagesRef.current.set('reed_rain_collector.png', img);
      };
      img.onerror = () => console.error('Failed to load reed_rain_collector.png');
      img.src = module.default;
    });
  }, []);

  // Preload wild animal images
  useEffect(() => {
    preloadWildAnimalImages();
    preloadAnimalCorpseImages();
  }, []);

  // Use arrow break effects hook
  useArrowBreakEffects({ connection });

  // Notify parent component of auto-action state changes
  useEffect(() => {
    if (onAutoActionStatesChange) {
      onAutoActionStatesChange(isAutoAttacking);
    }
  }, [isAutoAttacking, onAutoActionStatesChange]);

  // Use the particle hooks - they now run independently
  const campfireParticles = useCampfireParticles({
    visibleCampfiresMap,
    deltaTime: 0, // Not used anymore, but kept for compatibility
  });

  const torchParticles = useTorchParticles({
    players,
    activeEquipments,
    itemDefinitions,
    deltaTime: 0, // Not used anymore, but kept for compatibility
  });

  // Fire arrow particle effects
  const fireArrowParticles = useFireArrowParticles({
    players,
    activeEquipments,
    itemDefinitions,
    projectiles,
    deltaTime: 0 // Not used anymore, but kept for compatibility
  });

  // Furnace particle effects - industrial forge sparks and flames
  const furnaceParticles = useFurnaceParticles({
    visibleFurnacesMap,
  });

  // Resource sparkle particle effects - shows sparkles on harvestable resources (viewport-culled)
  const resourceSparkleParticles = useResourceSparkleParticles({
    harvestableResources: visibleHarvestableResourcesMap,
  });

  // 🌊 AMBIENT SOUND SYSTEM - Seamless atmospheric audio for the Aleutian island
  const ambientSoundSystem = useAmbientSounds({
    masterVolume: 1.0, // Master volume (could be made configurable later)
    environmentalVolume: environmentalVolume ?? 0.7, // Use environmental volume from settings or default
    timeOfDay: worldState?.timeOfDay, // Pass actual server time of day
    weatherCondition: worldState?.currentWeather, // Pass actual server weather condition
  });

  // 🧪 DEBUG: Expose ambient sound test function to window for debugging
  React.useEffect(() => {
    (window as any).testAmbientVariants = ambientSoundSystem.testAllVariants;
    return () => {
      delete (window as any).testAmbientVariants;
    };
  }, [ambientSoundSystem.testAllVariants]);

  // Simple particle renderer function
  const renderParticlesToCanvas = (ctx: CanvasRenderingContext2D, particles: any[]) => {
    particles.forEach(particle => {
      ctx.save();
      ctx.globalAlpha = particle.alpha || 1;
      
      if (particle.type === 'fire') {
        // Render fire particles as circles with slight glow for more realistic flames
        ctx.fillStyle = particle.color || '#ff4500';
        ctx.shadowColor = particle.color || '#ff4500';
        ctx.shadowBlur = particle.size * 0.5; // Slight glow effect
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.size / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0; // Reset shadow
      } else {
        // Render other particles (smoke, etc.) as squares
        ctx.fillStyle = particle.color || '#ff4500';
        ctx.fillRect(
          particle.x - particle.size / 2,
          particle.y - particle.size / 2,
          particle.size,
          particle.size
        );
      }
      
      ctx.restore();
    });
  };

  // Used to trigger cloud fetching and updating -- keep this logic at the top level
  useEffect(() => {
    if (connection) {
      // Update viewport in the database so server knows what's visible to this client
      // This informs the server about the client's view bounds for cloud generation
      const viewportMinX = camera.x - currentCanvasWidth / 2;
      const viewportMinY = camera.y - currentCanvasHeight / 2;
      const viewportMaxX = camera.x + currentCanvasWidth / 2;
      const viewportMaxY = camera.y + currentCanvasHeight / 2;

      // Call reducer to update the server-side viewport
      try {
        connection.reducers.updateViewport(viewportMinX, viewportMinY, viewportMaxX, viewportMaxY);
      } catch (error) {
        console.error('[GameCanvas] Failed to update viewport on server:', error);
      }
    }
  }, [connection, camera.x, camera.y, currentCanvasWidth, currentCanvasHeight]);

  // Hook for thunder effects
  useThunderEffects({ connection });

  // Helper function to convert shelter data for shadow clipping
  const shelterClippingData = useMemo(() => {
    if (!shelters) return [];
    return Array.from(shelters.values()).map(shelter => ({
      posX: shelter.posX,
      posY: shelter.posY,
      isDestroyed: shelter.isDestroyed,
    }));
  }, [shelters]);

  // Performance monitoring - detect lag spikes
  const checkPerformance = useCallback((frameStartTime: number) => {
    const frameTime = performance.now() - frameStartTime;
    // Emergency mode removed; retain frame time tracking only
    performanceMode.current.lastFrameTime = frameTime;
  }, []);

  const renderGame = useCallback(() => {
    const frameStartTime = performance.now();
    const canvas = gameCanvasRef.current;
    const maskCanvas = maskCanvasRef.current;
    if (!canvas || !maskCanvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Emergency performance mode removed

    const now_ms = Date.now();
    const currentWorldMouseX = worldMousePos.x;
    const currentWorldMouseY = worldMousePos.y;
    const currentCanvasWidth = canvasSize.width;
    const currentCanvasHeight = canvasSize.height;

    // Get current cycle progress for dynamic shadows
    // Default to "noonish" (0.375) if worldState or cycleProgress is not yet available.
    const currentCycleProgress = worldState?.cycleProgress ?? 0.375;

    // --- ADD THESE LOGS for basic renderGame entry check ---
    // console.log(
    //     `[GameCanvas renderGame ENTRY] localPlayerId: ${localPlayerId}, ` +
    //     `playerCorpses type: ${typeof playerCorpses}, isMap: ${playerCorpses instanceof Map}, size: ${playerCorpses?.size}, ` +
    //     `localPlayer defined: ${!!localPlayer}, localPlayer.identity defined: ${!!localPlayer?.identity}`
    // );
    // --- END ADDED LOGS ---

    // --- Rendering ---
    ctx.clearRect(0, 0, currentCanvasWidth, currentCanvasHeight);
    
    // 🎯 CYBERPUNK: Render SOVA simulation grid background instead of plain black
    // This creates the lore-consistent illusion that the game world exists within a cyberpunk simulation
    renderCyberpunkGridBackground(
      ctx,
      currentCanvasWidth,
      currentCanvasHeight,
      cameraOffsetX,
      cameraOffsetY
    );

    ctx.save();
    ctx.translate(cameraOffsetX, cameraOffsetY);
    
    // Set shelter clipping data for shadow rendering
    setShelterClippingData(shelterClippingData);
    
    // Pass the necessary viewport parameters to the optimized background renderer
    // console.log('[GameCanvas DEBUG] Rendering world background at camera offset:', cameraOffsetX, cameraOffsetY, 'worldTiles size:', worldTiles?.size || 0);
    renderWorldBackground(ctx, grassImageRef, cameraOffsetX, cameraOffsetY, currentCanvasWidth, currentCanvasHeight, visibleWorldTiles, showAutotileDebug);

    // MOVED: Swimming shadows now render after water overlay to appear above sea stack underwater zones

    // MOVED: Water overlay now renders after players to appear on top

    // --- Render Water Patches ---
    // Water patches show as transparent black circles on the ground that boost plant growth
    // Note: Context is already translated by cameraOffset, so we pass the actual camera world position
    renderWaterPatches(
      ctx,
      waterPatches,
      -cameraOffsetX, // Camera world X position
      -cameraOffsetY, // Camera world Y position
      currentCanvasWidth,
      currentCanvasHeight
    );
    // --- End Water Patches ---

    // --- Render Sea Stacks (SERVER-AUTHORITATIVE SYSTEM) ---
    // DISABLED: Sea stacks are now rendered through the Y-sorted entities system for proper depth layering
    // This ensures players can walk behind and in front of sea stacks based on Y position
    // renderSeaStacks(
    //   ctx,
    //   -cameraOffsetX, // Camera world X position
    //   -cameraOffsetY, // Camera world Y position
    //   currentCanvasWidth,
    //   currentCanvasHeight,
    //   seaStacks // Pass server-provided sea stack entities
    // );
    // --- End Sea Stacks ---

    const isPlacementTooFarValue = (placementInfo && localPlayer && currentWorldMouseX !== null && currentWorldMouseY !== null)
      ? isPlacementTooFar(placementInfo, localPlayer.positionX, localPlayer.positionY, currentWorldMouseX, currentWorldMouseY)
      : false;

    // --- Render Ground Items Individually --- 

    // First pass: Draw ONLY shadows for ground items that have custom shadows
    // Render Campfire Shadows
    visibleCampfires.forEach(campfire => {
      renderCampfire(ctx, campfire, now_ms, currentCycleProgress, true /* onlyDrawShadow */);
    });
    // Note: Pumpkin and Mushroom shadows are now handled by the unified resource renderer
    // through the Y-sorted entities system
    // Tree shadows are now handled by the Y-sorted entity system for proper shadow layering
    // TODO: Add other ground items like mushrooms, crops here if they get custom dynamic shadows

    // --- Render Clouds on Canvas --- (MOVED HERE)
    // Clouds are rendered after all world entities and particles,
    // but before world-anchored UI like labels.
    // The context (ctx) should still be translated by cameraOffset at this point.
    /* REMOVING THIS FIRST CALL TO RENDER CLOUDS
    if (clouds && clouds.size > 0 && cloudImagesRef.current) {
      renderCloudsDirectly({ 
        ctx, 
        clouds: interpolatedClouds,
        cloudImages: cloudImagesRef.current,
        worldScale: 1, // Use a scale of 1 for clouds
        cameraOffsetX, // Pass camera offsets so clouds move with the world view
        cameraOffsetY  
      });
    }
    */
    // --- End Render Clouds on Canvas ---

    // Second pass: Draw the actual entities for ground items
    // Render Campfires (actual image, skip shadow as it's already drawn if burning)
    /*visibleCampfires.forEach(campfire => {
        renderCampfire(ctx, campfire, now_ms, currentCycleProgress, false, !campfire.isBurning );
    });*/
    // Render Dropped Items
    visibleDroppedItems.forEach(item => {
      const itemDef = itemDefinitions.get(item.itemDefId.toString());
      renderDroppedItem({ ctx, item, itemDef, nowMs: now_ms, cycleProgress: currentCycleProgress });
    });
    // Note: Mushrooms, Corn, Pumpkins, and Hemp are now handled by the unified resource renderer
    // through the Y-sorted entities system
    // Render Sleeping Bags
    visibleSleepingBags.forEach(sleepingBag => {
      renderSleepingBag(ctx, sleepingBag, now_ms, currentCycleProgress);
    });
    // Render Stashes (Remove direct rendering as it's now y-sorted)
    /*visibleStashes.forEach(stash => {
        renderStash(ctx, stash, now_ms, currentCycleProgress);
    });*/
    // --- End Ground Items --- 

    // --- STEP 1: Render ONLY swimming player bottom halves ---
    // Filter out swimming players and render them manually with exact same logic as renderYSortedEntities
    const swimmingPlayersForBottomHalf = Array.from(players.values())
      .filter(player => player.isOnWater && !player.isDead && !player.isKnockedOut);

    // Render swimming player bottom halves using exact same logic as renderYSortedEntities
    swimmingPlayersForBottomHalf.forEach(player => {
      const playerId = player.identity.toHexString();
      const isLocalPlayer = localPlayerId === playerId;

      // EXACT same position logic as renderYSortedEntities
      let playerForRendering = player;
      if (isLocalPlayer && predictedPosition) {
        playerForRendering = {
          ...player,
          positionX: predictedPosition.x,
          positionY: predictedPosition.y
        };
      } else if (!isLocalPlayer && remotePlayerInterpolation) {
        const interpolatedPosition = remotePlayerInterpolation.updateAndGetSmoothedPosition(player, localPlayerId);
        playerForRendering = {
          ...player,
          positionX: interpolatedPosition.x,
          positionY: interpolatedPosition.y
        };
      }

      // EXACT same movement detection logic as renderYSortedEntities  
      const lastPos = lastPositionsRef.current?.get(playerId);
      let isPlayerMoving = false;
      
      if (lastPos) {
        const positionThreshold = 0.1;
        const dx = Math.abs(playerForRendering.positionX - lastPos.x);
        const dy = Math.abs(playerForRendering.positionY - lastPos.y);
        isPlayerMoving = dx > positionThreshold || dy > positionThreshold;
      }
      
      // EXACT same animation frame logic as renderYSortedEntities
      let currentAnimFrame: number;
      if (playerForRendering.isOnWater) {
        // Swimming animations - ALL swimming uses idle animation frames from water sprite
        currentAnimFrame = idleAnimationFrame; // Swimming sprite uses idle frames for all swimming movement
      } else {
        // Land animation
        if (!isPlayerMoving) {
          currentAnimFrame = idleAnimationFrame;
        } else if (playerForRendering.isSprinting) {
          currentAnimFrame = sprintAnimationFrame;
        } else {
          currentAnimFrame = animationFrame;
        }
      }

      // Update last positions (same as renderYSortedEntities)
      lastPositionsRef.current?.set(playerId, { x: playerForRendering.positionX, y: playerForRendering.positionY });

      // Choose correct sprite image
      let heroImg: HTMLImageElement | null = heroWaterImageRef.current;

      if (heroImg) {
        const isOnline = activeConnections ? activeConnections.has(playerId) : false;
        const isHovered = worldMousePos ? isPlayerHovered(worldMousePos.x, worldMousePos.y, playerForRendering) : false;
        
        renderPlayer(
          ctx,
          playerForRendering,
          heroImg,
          heroSprintImageRef.current || heroImg,
          heroIdleImageRef.current || heroImg,
          heroCrouchImageRef.current || heroImg,
          heroWaterImageRef.current || heroImg, // heroSwimImg
          heroDodgeImageRef.current || heroImg, // heroDodgeImg
          isOnline,
          isPlayerMoving,
          isHovered,
          currentAnimFrame,
          now_ms,
          0, // no jump offset for swimming players
          false, // not persistently hovered
          activeConsumableEffects,
          localPlayerId,
          false, // not corpse
          currentCycleProgress,
          localPlayerIsCrouching,
          'bottom' // Render only bottom half
        );
      }
    });

    // Render all non-swimming players normally
    const nonSwimmingEntities = ySortedEntities.filter(entity => 
      !(entity.type === 'player' && entity.entity.isOnWater && !entity.entity.isDead && !entity.entity.isKnockedOut)
    );
    
    if (nonSwimmingEntities.length > 0) {
      renderYSortedEntities({
        ctx,
        ySortedEntities: nonSwimmingEntities,
        heroImageRef,
        heroSprintImageRef,
        heroIdleImageRef,
                  heroWaterImageRef,
          heroCrouchImageRef,
        heroDodgeImageRef,
        lastPositionsRef,
        activeConnections,
        activeEquipments,
        activeConsumableEffects,
        itemDefinitions,
        inventoryItems,
        itemImagesRef,
        doodadImagesRef,
        shelterImage: shelterImageRef.current,
        worldMouseX: currentWorldMouseX,
        worldMouseY: currentWorldMouseY,
        localPlayerId: localPlayerId,
        animationFrame,
        sprintAnimationFrame,
        idleAnimationFrame,
        nowMs: now_ms,
        hoveredPlayerIds,
        onPlayerHover: handlePlayerHover,
        cycleProgress: currentCycleProgress,
        renderPlayerCorpse: (props) => renderPlayerCorpse({ ...props, cycleProgress: currentCycleProgress, heroImageRef: heroImageRef, heroWaterImageRef: heroWaterImageRef, heroCrouchImageRef: heroCrouchImageRef }),
        localPlayerPosition: predictedPosition ?? { x: localPlayer?.positionX ?? 0, y: localPlayer?.positionY ?? 0 },
        playerDodgeRollStates,
        remotePlayerInterpolation,
        localPlayerIsCrouching,
        closestInteractableCampfireId,
        closestInteractableBoxId,
        closestInteractableStashId,
        closestInteractableSleepingBagId,
        closestInteractableHarvestableResourceId,
        closestInteractableDroppedItemId,
        closestInteractableTarget,
        shelterClippingData,
        localFacingDirection, // ADD: Pass local facing direction for instant client-authoritative direction changes
        treeShadowsEnabled, // NEW: Pass visual cortex module setting for tree shadows
      });
    }



    // --- STEP 2: Render water overlay (appears over underwater shadows and below visible sprites) ---
    renderWaterOverlay(
      ctx,
      -cameraOffsetX, // Convert camera offset to world camera position
      -cameraOffsetY,
      canvasSize.width,
      canvasSize.height,
      deltaTimeRef.current / 1000, // Convert ms to seconds
      visibleWorldTiles
    );
    // --- END WATER OVERLAY ---



    // --- STEP 3: Render ALL entities together in proper Y-sorted order (except swimming player bottom halves) ---

    // Create swimming player top half entities
    const swimmingPlayers = Array.from(players.values())
      .filter(player => player.isOnWater && !player.isDead && !player.isKnockedOut)
      .map(player => {
        const playerId = player.identity?.toHexString();
        if (!playerId) return null;
        
        // Use same position logic as Y-sorted entities for consistent positioning
        let playerForRendering = player;
        if (localPlayerId === playerId && predictedPosition) {
          playerForRendering = {
            ...player,
            positionX: predictedPosition.x,
            positionY: predictedPosition.y
          };
        } else if (localPlayerId !== playerId && remotePlayerInterpolation) {
          const interpolatedPosition = remotePlayerInterpolation.updateAndGetSmoothedPosition(player, localPlayerId);
          playerForRendering = {
            ...player,
            positionX: interpolatedPosition.x,
            positionY: interpolatedPosition.y
          };
        }
        
        return {
          type: 'swimmingPlayerTopHalf' as const,
          entity: playerForRendering,
          yPosition: playerForRendering.positionY,
          playerId
        };
      })
      .filter(item => item !== null);

    // Get all entities except swimming player bottom halves
    const allEntitiesExceptSwimmingBottoms = ySortedEntities.filter(entity => 
      !(entity.type === 'player' && entity.entity.isOnWater && !entity.entity.isDead && !entity.entity.isKnockedOut)
    );

    // EMERGENCY: Aggressive entity culling in dense areas
    frameNumber.current++;
    const entityCount = allEntitiesExceptSwimmingBottoms.length + swimmingPlayers.length;
    const maxEntities = 100;
    
    // Aggressively limit entities if too many
    let limitedEntitiesExceptSwimming = allEntitiesExceptSwimmingBottoms;
    if (entityCount > maxEntities) {
      // Sort by distance to player and only render closest entities
      const playerPos = predictedPosition || { x: localPlayer?.positionX || 0, y: localPlayer?.positionY || 0 };
      limitedEntitiesExceptSwimming = allEntitiesExceptSwimmingBottoms
        .map(entity => {
          const dx = (entity.entity.positionX || entity.entity.posX || 0) - playerPos.x;
          const dy = (entity.entity.positionY || entity.entity.posY || 0) - playerPos.y;
          return { ...entity, distanceToPlayer: dx * dx + dy * dy };
        })
        .sort((a, b) => a.distanceToPlayer - b.distanceToPlayer)
        .slice(0, maxEntities)
        .map(({ distanceToPlayer, ...entity }) => entity);
    }
    
    const sortInterval = entityCount > 100 ? 5 : 1; // Sort even less frequently
    
    // Combine Y-sorted entities with swimming player top halves
    let combinedEntities: any[] = [
      ...limitedEntitiesExceptSwimming.map(entity => ({ ...entity, isSwimmingPlayerTopHalf: false })),
      ...swimmingPlayers.map(player => ({ ...player, isSwimmingPlayerTopHalf: true }))
    ];
    
    // CRITICAL FIX: Don't re-sort! The ySortedEntities are already properly sorted by useEntityFiltering
    // Re-sorting here was overriding the shelter priority and Y-position adjustments
    // Just insert swimming players at the correct position based on their Y coordinate
    if (entityCount <= 150 && frameNumber.current % sortInterval === 0) {
      // Only sort swimming players into the existing sorted array
      swimmingPlayers.forEach(swimmingPlayer => {
        const playerY = swimmingPlayer.yPosition;
        
        // Find the correct insertion point to maintain Y-sort order
        let insertIndex = 0;
        for (let i = 0; i < limitedEntitiesExceptSwimming.length; i++) {
          const entity = limitedEntitiesExceptSwimming[i].entity;
          let entityY: number;
          
          if (entity.positionY !== undefined) {
            entityY = entity.positionY + 48; // Player foot position
          } else if (entity.posY !== undefined) {
            entityY = entity.posY;
          } else {
            entityY = 0;
          }
          
          if (playerY <= entityY) {
            insertIndex = i;
            break;
          }
          insertIndex = i + 1;
        }
        
                 // Insert swimming player at correct position with proper flag
         limitedEntitiesExceptSwimming.splice(insertIndex, 0, {
           ...swimmingPlayer,
           isSwimmingPlayerTopHalf: true
         } as any);
      });
      
      combinedEntities = limitedEntitiesExceptSwimming;
    } else {
      // Too many entities - just combine without sorting
      if (entityCount > 150) {
        // Skipping Y-sort for performance
      }
      combinedEntities = [
        ...limitedEntitiesExceptSwimming.map(entity => ({ ...entity, isSwimmingPlayerTopHalf: false })),
        ...swimmingPlayers.map(player => ({ ...player, isSwimmingPlayerTopHalf: true }))
      ];
    }

    // Render all combined entities in proper Y-sorted order
    combinedEntities.forEach(item => {
      if (item.isSwimmingPlayerTopHalf && item.type === 'swimmingPlayerTopHalf') {
        // Render swimming player top half
        const player = item.entity;
        const playerId = item.playerId;
        
        // Use SAME animation logic as bottom half
        const lastPos = lastPositionsRef.current?.get(playerId);
        let isPlayerMoving = false;
        
        if (lastPos) {
          const positionThreshold = 0.1;
          const dx = Math.abs(player.positionX - lastPos.x);
          const dy = Math.abs(player.positionY - lastPos.y);
          isPlayerMoving = dx > positionThreshold || dy > positionThreshold;
        }
        
        let currentAnimFrame: number;
        if (player.isOnWater) {
          // Swimming animation - same logic as bottom half
          if (!isPlayerMoving) {
            currentAnimFrame = idleAnimationFrame; // Floating idle
          } else if (player.isSprinting) {
            currentAnimFrame = sprintAnimationFrame; // Fast swimming
          } else {
            currentAnimFrame = animationFrame; // Normal swimming
          }
        } else {
          // Land animation
          if (!isPlayerMoving) {
            currentAnimFrame = idleAnimationFrame;
          } else if (player.isSprinting) {
            currentAnimFrame = sprintAnimationFrame;
          } else {
            currentAnimFrame = animationFrame;
          }
        }
        
        // Choose correct sprite image
        let heroImg: HTMLImageElement | null;
        if (player.isOnWater) {
          heroImg = heroWaterImageRef.current;
        } else if (player.isCrouching) {
          heroImg = heroCrouchImageRef.current;
        } else {
          heroImg = heroImageRef.current;
        }
        
        if (heroImg) {
          const isOnline = activeConnections ? activeConnections.has(playerId) : false;
          const isHovered = worldMousePos ? isPlayerHovered(worldMousePos.x, worldMousePos.y, player) : false;
          
          renderPlayer(
            ctx,
            player,
            heroImg,
            heroSprintImageRef.current || heroImg,
            heroIdleImageRef.current || heroImg,
            heroCrouchImageRef.current || heroImg,
            heroWaterImageRef.current || heroImg, // heroSwimImg
            heroDodgeImageRef.current || heroImg, // heroDodgeImg
            isOnline,
            isPlayerMoving,
            isHovered,
            currentAnimFrame,
            now_ms,
            0, // no jump offset for swimming players
            false, // not persistently hovered
            activeConsumableEffects,
            localPlayerId,
            false, // not corpse
            currentCycleProgress,
            localPlayerIsCrouching,
            'top' // Render only top half (above water portion)
          );
          
          // CRITICAL FIX: Render equipped items for swimming players
          // Swimming players are excluded from normal Y-sorted rendering, so we need to render their equipped items separately
          const equipment = activeEquipments.get(playerId);
          let itemDef: SpacetimeDBItemDefinition | null = null;
          let itemImg: HTMLImageElement | null = null;

          if (equipment && equipment.equippedItemDefId && equipment.equippedItemInstanceId) {
            // Validate that the equipped item instance actually exists in inventory
            const equippedItemInstance = inventoryItems.get(equipment.equippedItemInstanceId.toString());
            if (equippedItemInstance && equippedItemInstance.quantity > 0) {
              itemDef = itemDefinitions.get(equipment.equippedItemDefId.toString()) || null;
              itemImg = (itemDef ? itemImagesRef.current.get(itemDef.iconAssetName) : null) || null;
            }
          }
          
          const canRenderItem = itemDef && itemImg && itemImg.complete && itemImg.naturalHeight !== 0;
          if (canRenderItem && equipment) {
            renderEquippedItem(ctx, player, equipment, itemDef!, itemDefinitions, itemImg!, now_ms, 0, itemImagesRef.current, activeConsumableEffects, localPlayerId);
          }
        }
      } else {
        // Render regular Y-sorted entity (including sea stacks, players, wild animals, etc.)
        renderYSortedEntities({
          ctx,
          ySortedEntities: [item],
          heroImageRef,
          heroSprintImageRef,
          heroIdleImageRef,
          heroWaterImageRef,
          heroCrouchImageRef,
          heroDodgeImageRef,
          lastPositionsRef,
          activeConnections,
          activeEquipments,
          activeConsumableEffects,
          itemDefinitions,
          inventoryItems,
          itemImagesRef,
          doodadImagesRef,
          shelterImage: shelterImageRef.current,
          worldMouseX: currentWorldMouseX,
          worldMouseY: currentWorldMouseY,
          localPlayerId: localPlayerId,
          animationFrame,
          sprintAnimationFrame,
          idleAnimationFrame,
          nowMs: now_ms,
          hoveredPlayerIds,
          onPlayerHover: handlePlayerHover,
          cycleProgress: currentCycleProgress,
          renderPlayerCorpse: (props) => renderPlayerCorpse({ ...props, cycleProgress: currentCycleProgress, heroImageRef: heroImageRef, heroWaterImageRef: heroWaterImageRef, heroCrouchImageRef: heroCrouchImageRef }),
          localPlayerPosition: predictedPosition ?? { x: localPlayer?.positionX ?? 0, y: localPlayer?.positionY ?? 0 },
          playerDodgeRollStates,
          remotePlayerInterpolation,
          localPlayerIsCrouching,
          closestInteractableCampfireId,
          closestInteractableBoxId,
          closestInteractableStashId,
          closestInteractableSleepingBagId,
          closestInteractableHarvestableResourceId,
          closestInteractableDroppedItemId,
          closestInteractableTarget,
          shelterClippingData,
          localFacingDirection, // ADD: Pass local facing direction for instant client-authoritative direction changes
          treeShadowsEnabled, // NEW: Pass visual cortex module setting for tree shadows
        });
      }
    });
    // --- End Y-Sorted Entities ---

    // REMOVED: Top half rendering now integrated into Y-sorted system above
    // REMOVED: Swimming shadows now render earlier, before sea stacks

    // REMOVED: Swimming players now render normally in Y-sorted entities for proper depth sorting

    // REMOVED: Sea stacks now render fully in Y-sorted entities
    // Water overlay will be clipped to only appear over underwater zones

    // Wild animals are now rendered through the Y-sorted entities system for proper layering

    // Render particle systems
    if (ctx) {
      // Call without camera offsets, as ctx is already translated
      renderParticlesToCanvas(ctx, campfireParticles);
      renderParticlesToCanvas(ctx, torchParticles);
      renderParticlesToCanvas(ctx, fireArrowParticles);
      renderParticlesToCanvas(ctx, furnaceParticles);
      renderParticlesToCanvas(ctx, resourceSparkleParticles);

      // Render cut grass effects
      renderCutGrassEffects(ctx, now_ms);

      // Render arrow break effects
      renderArrowBreakEffects(ctx, now_ms);

      // Render other players' fishing lines and bobbers
      if (typeof window !== 'undefined' && (window as any).renderOtherPlayersFishing) {
        // console.log('[FISHING RENDER] Calling renderOtherPlayersFishing from GameCanvas');
        (window as any).renderOtherPlayersFishing(ctx);
      } else {
        // console.log('[FISHING RENDER] renderOtherPlayersFishing not available on window');
      }
    }

    renderInteractionLabels({
      ctx,
      harvestableResources: visibleHarvestableResourcesMap,
      campfires: visibleCampfiresMap,
      furnaces: visibleFurnacesMap, // ADDED: furnaces parameter
      droppedItems: visibleDroppedItemsMap,
      woodenStorageBoxes: visibleBoxesMap,
      playerCorpses: visiblePlayerCorpsesMap,
      stashes: stashes,
      sleepingBags: visibleSleepingBagsMap,
      players: players,
      itemDefinitions,
      closestInteractableTarget: closestInteractableTarget as any,
      lanterns: visibleLanternsMap,
      rainCollectors: rainCollectors,
    });
    renderPlacementPreview({
      ctx, placementInfo, itemImagesRef, shelterImageRef, worldMouseX: currentWorldMouseX,
      worldMouseY: currentWorldMouseY, isPlacementTooFar: isPlacementTooFarValue, placementError, connection,
      doodadImagesRef,
    });

    // --- Render Clouds on Canvas --- (NEW POSITION)
    // Clouds are rendered after all other world-anchored entities and UI,
    // so they appear on top of everything in the world space.
    if (clouds && clouds.size > 0 && cloudImagesRef.current) {
      renderCloudsDirectly({
        ctx,
        clouds: interpolatedClouds,
        cloudImages: cloudImagesRef.current,
        worldScale: 1,
        cameraOffsetX,
        cameraOffsetY
      });
    }
    // --- End Render Clouds on Canvas ---

    ctx.restore(); // This is the restore from translate(cameraOffsetX, cameraOffsetY)

    // --- Render Rain Before Color Overlay ---
    // Rain should be rendered before the day/night overlay so it doesn't show above the darkness at night
    const rainIntensity = worldState?.rainIntensity ?? 0.0;
    if (rainIntensity > 0) {
      renderRain(
        ctx,
        -cameraOffsetX, // Convert screen offset to world camera position
        -cameraOffsetY, // Convert screen offset to world camera position
        currentCanvasWidth,
        currentCanvasHeight,
        rainIntensity,
        deltaTimeRef.current / 1000 // Convert milliseconds to seconds
      );
    }
    // --- End Rain Rendering ---

    // --- Post-Processing (Day/Night, Indicators, Lights, Minimap) ---
    // Day/Night mask overlay
    if (overlayRgba !== 'transparent' && overlayRgba !== 'rgba(0,0,0,0.00)' && maskCanvas) {
      ctx.drawImage(maskCanvas, 0, 0);
    }

    // Interaction indicators - Draw only for visible entities that are interactable
    const drawIndicatorIfNeeded = (entityType: 'campfire' | 'furnace' | 'lantern' | 'box' | 'stash' | 'corpse' | 'knocked_out_player' | 'water', entityId: number | bigint | string, entityPosX: number, entityPosY: number, entityHeight: number, isInView: boolean) => {
      // If holdInteractionProgress is null (meaning no interaction is even being tracked by the state object),
      // or if the entity is not in view, do nothing.
      if (!isInView || !holdInteractionProgress) {
        return;
      }

      let targetId: number | bigint | string;
      if (typeof entityId === 'string') {
        targetId = entityId; // For knocked out players (hex string) or water ('water')
      } else if (typeof entityId === 'bigint') {
        targetId = BigInt(holdInteractionProgress.targetId ?? 0);
      } else {
        targetId = Number(holdInteractionProgress.targetId ?? 0);
      }

      // Check if the current entity being processed is the target of the (potentially stale) holdInteractionProgress object.
      if (holdInteractionProgress.targetType === entityType && targetId === entityId) {

        // IMPORTANT: Only draw the indicator if the hold is *currently active* (isActivelyHolding is true).
        // If isActivelyHolding is false, it means the hold was just released/cancelled.
        // In this case, we don't draw anything for this entity, not even the background circle.
        // The indicator will completely disappear once holdInteractionProgress becomes null in the next state update.
        if (isActivelyHolding) {
          // Use appropriate duration based on interaction type
          const interactionDuration = entityType === 'knocked_out_player' ? REVIVE_HOLD_DURATION_MS : HOLD_INTERACTION_DURATION_MS;
          const currentProgress = Math.min(Math.max((Date.now() - holdInteractionProgress.startTime) / interactionDuration, 0), 1);
          drawInteractionIndicator(
            ctx,
            entityPosX + cameraOffsetX,
            entityPosY + cameraOffsetY - (entityHeight / 2) - 15,
            currentProgress
          );
        }
      }
    };

    // Iterate through visible entities MAPS for indicators
    visibleCampfiresMap.forEach((fire: SpacetimeDBCampfire) => {
      drawIndicatorIfNeeded('campfire', fire.id, fire.posX, fire.posY, CAMPFIRE_HEIGHT, true);
    });

    // Furnace interaction indicators (for hold actions like toggle burning)
    visibleFurnacesMap.forEach((furnace: SpacetimeDBFurnace) => {
      drawIndicatorIfNeeded('furnace', furnace.id, furnace.posX, furnace.posY, 96, true); // 96px height for standard furnace size
    });

    // Lantern interaction indicators
    visibleLanternsMap.forEach((lantern: SpacetimeDBLantern) => {
      // For lanterns, the indicator is only relevant if a hold action is in progress (e.g., picking up an empty lantern)
      if (holdInteractionProgress && holdInteractionProgress.targetId === lantern.id && holdInteractionProgress.targetType === 'lantern') {
        drawIndicatorIfNeeded('lantern', lantern.id, lantern.posX, lantern.posY, 56, true); // 56px height for lanterns
      }
    });

    visibleBoxesMap.forEach((box: SpacetimeDBWoodenStorageBox) => {
      // For boxes, the indicator is only relevant if a hold action is in progress (e.g., picking up an empty box)
      if (holdInteractionProgress && holdInteractionProgress.targetId === box.id && holdInteractionProgress.targetType === 'box') {
        drawIndicatorIfNeeded('box', box.id, box.posX, box.posY, BOX_HEIGHT, true);
      }
    });

    // Corrected: Iterate over the full 'stashes' map for drawing indicators for stashes
    // The 'isInView' check within drawIndicatorIfNeeded can be enhanced if needed,
    // but for interaction progress, if it's the target, we likely want to show it if player is close.
    if (stashes instanceof Map) { // Ensure stashes is a Map
      stashes.forEach((stash: SpacetimeDBStash) => {
        // Check if this stash is the one currently being interacted with for a hold action
        if (holdInteractionProgress && holdInteractionProgress.targetId === stash.id && holdInteractionProgress.targetType === 'stash') {
          // For a hidden stash being surfaced, we want to draw the indicator.
          // The 'true' for isInView might need refinement if stashes can be off-screen 
          // but still the closest interactable (though unlikely for a hold interaction).
          // For now, assume if it's the interaction target, it's relevant to draw the indicator.
          drawIndicatorIfNeeded('stash', stash.id, stash.posX, stash.posY, STASH_HEIGHT, true);
        }
      });
    }

    // Knocked Out Player Indicators
    if (closestInteractableKnockedOutPlayerId && players instanceof Map) {
      const knockedOutPlayer = players.get(closestInteractableKnockedOutPlayerId);
      if (knockedOutPlayer && knockedOutPlayer.isKnockedOut && !knockedOutPlayer.isDead) {
        // Check if this knocked out player is the one currently being revived
        if (holdInteractionProgress && holdInteractionProgress.targetId === closestInteractableKnockedOutPlayerId && holdInteractionProgress.targetType === 'knocked_out_player') {
          const playerHeight = 48; // Approximate player sprite height
          drawIndicatorIfNeeded('knocked_out_player', closestInteractableKnockedOutPlayerId, knockedOutPlayer.positionX, knockedOutPlayer.positionY, playerHeight, true);
        }
      }
    }

    // Water Drinking Indicators
    if (closestInteractableWaterPosition && holdInteractionProgress && holdInteractionProgress.targetType === 'water') {
      // Draw indicator at the water position
      drawIndicatorIfNeeded('water', 'water', closestInteractableWaterPosition.x, closestInteractableWaterPosition.y, 0, true);
    }

    // Campfire Lights - Only draw for visible campfires
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    visibleCampfiresMap.forEach((fire: SpacetimeDBCampfire) => {
      renderCampfireLight({
        ctx,
        campfire: fire,
        cameraOffsetX,
        cameraOffsetY,
      });
    });

    // Lantern Lights - Only draw for visible lanterns
    visibleLanternsMap.forEach((lantern: SpacetimeDBLantern) => {
      renderLanternLight({
        ctx,
        lantern: lantern,
        cameraOffsetX,
        cameraOffsetY,
      });
    });

    // Furnace Lights - Only draw for visible furnaces with industrial red glow
    visibleFurnacesMap.forEach((furnace: SpacetimeDBFurnace) => {
      renderFurnaceLight({
        ctx,
        furnace: furnace,
        cameraOffsetX,
        cameraOffsetY,
      });
    });

    // --- Render Torch Light for ALL players (Local and Remote) ---
    players.forEach(player => {
      const playerId = player.identity?.toHexString();
      if (!playerId) return;
      
      // Use the same position logic as player sprites
      let renderPositionX = player.positionX;
      let renderPositionY = player.positionY;
      
      if (playerId === localPlayerId && predictedPosition) {
        // For local player, use predicted position
        renderPositionX = predictedPosition.x;
        renderPositionY = predictedPosition.y;
      } else if (playerId !== localPlayerId && remotePlayerInterpolation) {
        // For remote players, use interpolated position
        const interpolatedPos = remotePlayerInterpolation.updateAndGetSmoothedPosition(player, localPlayerId);
        if (interpolatedPos) {
          renderPositionX = interpolatedPos.x;
          renderPositionY = interpolatedPos.y;
        }
      }
      
      renderPlayerTorchLight({
        ctx,
        player,
        activeEquipments,
        itemDefinitions,
        cameraOffsetX,
        cameraOffsetY,
        renderPositionX,
        renderPositionY,
      });
    });
    // --- End Torch Light ---



    ctx.restore();

    // Performance monitoring - check frame time at end
    checkPerformance(frameStartTime);

    // Minimap now rendered as React component overlay, not on game canvas

  }, [checkPerformance,
    // Dependencies
    visibleHarvestableResources,
    visibleHarvestableResourcesMap,
    visibleDroppedItems, visibleCampfires, visibleSleepingBags,
    ySortedEntities, visibleCampfiresMap, visibleDroppedItemsMap, visibleBoxesMap,
    players, itemDefinitions, inventoryItems, trees, stones,
    worldState, localPlayerId, localPlayer, activeEquipments, localPlayerPin, viewCenterOffset,
         itemImagesRef, heroImageRef, heroSprintImageRef, heroWaterImageRef, heroCrouchImageRef, heroDodgeImageRef, grassImageRef, cloudImagesRef, cameraOffsetX, cameraOffsetY,
    canvasSize.width, canvasSize.height, worldMousePos.x, worldMousePos.y,
    animationFrame, placementInfo, placementError, overlayRgba, maskCanvasRef,
    closestInteractableHarvestableResourceId,
    closestInteractableCampfireId, closestInteractableDroppedItemId, closestInteractableBoxId, isClosestInteractableBoxEmpty,
    closestInteractableWaterPosition,
    holdInteractionProgress, hoveredPlayerIds, handlePlayerHover, messages,
    isMinimapOpen, isMouseOverMinimap, minimapZoom,
    activeConnections,
    activeConsumableEffects,
    visiblePlayerCorpses,
    visibleStashes,
    visibleSleepingBags,
    interpolatedClouds,
    isSearchingCraftRecipes,
    worldState?.cycleProgress, // Correct dependency for renderGame
    visibleTrees, // Added to dependency array
    visibleTreesMap, // Added to dependency array
    playerCorpses,
    showInventory,
    gameCanvasRef,
    projectiles,
    deathMarkerImg,
    localPlayerDeathMarker,
    shelters,
    visibleShelters,
    visibleSheltersMap,
    shelterImageRef.current,
    minimapCache,
    visibleHarvestableResourcesMap,
     // Viewport-culled resource maps for sparkles
  ]);

  const gameLoopCallback = useCallback((frameInfo: FrameInfo) => {
    // Update deltaTime ref directly to avoid re-renders
    // Clamp deltaTime to reasonable bounds for consistent particle behavior
    if (frameInfo.deltaTime > 0 && frameInfo.deltaTime < 100) {
      deltaTimeRef.current = frameInfo.deltaTime;
    } else {
      // Use fallback deltaTime for extreme cases (pause/resume, tab switching, etc.)
      deltaTimeRef.current = 16.667; // 60fps fallback
    }

    renderGame();
  }, [renderGame]);

  // Use the updated hook with optimized performance settings
  useGameLoop(gameLoopCallback, {
    targetFPS: 60,
    maxFrameTime: 33, // More lenient threshold to reduce console spam
    enableProfiling: false // Disable profiling in production for maximum performance
  });

  // Convert sleepingBags map key from string to number for DeathScreen
  const sleepingBagsById = useMemo(() => {
    const mapById = new Map<number, SpacetimeDBSleepingBag>();
    if (sleepingBags instanceof Map) {
      sleepingBags.forEach(bag => {
        mapById.set(bag.id, bag);
      });
    }
    return mapById;
  }, [sleepingBags]);

  // Calculate the viewport bounds needed by useSpacetimeTables
  const worldViewport = useMemo(() => {
    // Return null if canvas size is zero to avoid issues
    if (canvasSize.width === 0 || canvasSize.height === 0) {
      return null;
    }
    
    // 🚨 FIX: Cap viewport size to prevent subscription overload
    // Max viewport should cover ~1920x1080 pixels to keep chunk subscriptions reasonable
    const maxViewportWidth = 1920;
    const maxViewportHeight = 1080;
    const effectiveWidth = Math.min(canvasSize.width, maxViewportWidth);
    const effectiveHeight = Math.min(canvasSize.height, maxViewportHeight);
    
    return {
      minX: -cameraOffsetX,
      minY: -cameraOffsetY,
      maxX: -cameraOffsetX + effectiveWidth,
      maxY: -cameraOffsetY + effectiveHeight,
    };
  }, [cameraOffsetX, cameraOffsetY, canvasSize.width, canvasSize.height]);



  // --- Logic to detect player damage from campfires and trigger effects ---
  useEffect(() => {
    if (localPlayer && visibleCampfiresMap) {
      const currentHealth = localPlayer.health;
      const prevHealth = prevPlayerHealthRef.current;

      if (prevHealth !== undefined) { // Only proceed if prevHealth is initialized
        if (currentHealth < prevHealth) { // Health decreased
          const newlyDamagingIds = new Set<string>();
          visibleCampfiresMap.forEach((campfire, id) => {
            if (campfire.isBurning && !campfire.isDestroyed) {
              const dx = localPlayer.positionX - campfire.posX;
              const effectiveCampfireY = campfire.posY - SERVER_CAMPFIRE_DAMAGE_CENTER_Y_OFFSET;
              const dy = localPlayer.positionY - effectiveCampfireY;
              const distSq = dx * dx + dy * dy;
              const damageRadiusSq = SERVER_CAMPFIRE_DAMAGE_RADIUS * SERVER_CAMPFIRE_DAMAGE_RADIUS;

              if (distSq < damageRadiusSq) {
                newlyDamagingIds.add(id.toString());
                // console.log(`[GameCanvas] Player took damage near burning campfire ${id}. Health: ${prevHealth} -> ${currentHealth}`);
              }
            }
          });
          // Set the IDs if any were found, otherwise, this will be an empty set if health decreased but not by a known campfire.
          setDamagingCampfireIds(newlyDamagingIds);
        } else {
          // Health did not decrease (or increased / stayed same). Clear any damaging IDs from previous tick.
          if (damagingCampfireIds.size > 0) {
            setDamagingCampfireIds(new Set());
          }
        }
      }
      prevPlayerHealthRef.current = currentHealth; // Always update prevHealth
    } else {
      // No localPlayer or no visibleCampfiresMap
      if (damagingCampfireIds.size > 0) { // Clear if there are lingering IDs
        setDamagingCampfireIds(new Set());
      }
      if (!localPlayer) { // If player becomes null (e.g. disconnect), reset prevHealth
        prevPlayerHealthRef.current = undefined;
      }
    }
  }, [localPlayer, visibleCampfiresMap]); // Dependencies: localPlayer (for health) and campfires map
  // Note: damagingCampfireIds is NOT in this dependency array. We set it, we don't react to its changes here.

  // --- Register respawn reducer callbacks ---
  useEffect(() => {
    if (!connection) return;

    const handleRespawnRandomlyResult = (ctx: any) => {
      console.log('[GameCanvas] Respawn randomly result:', ctx);
      if (ctx.event?.status === 'Committed') {
        console.log('[GameCanvas] Respawn randomly successful!');
      } else if (ctx.event?.status?.Failed) {
        console.error('[GameCanvas] Respawn randomly failed:', ctx.event.status.Failed);
      }
    };

    const handleRespawnAtBagResult = (ctx: any, bagId: number) => {
      console.log('[GameCanvas] Respawn at bag result:', ctx, 'bagId:', bagId);
      if (ctx.event?.status === 'Committed') {
        console.log('[GameCanvas] Respawn at bag successful!');
      } else if (ctx.event?.status?.Failed) {
        console.error('[GameCanvas] Respawn at bag failed:', ctx.event.status.Failed);
      }
    };

    // Register the callbacks
    connection.reducers?.onRespawnRandomly?.(handleRespawnRandomlyResult);
    connection.reducers?.onRespawnAtSleepingBag?.(handleRespawnAtBagResult);

    // Cleanup function to remove callbacks
    return () => {
      connection.reducers?.removeOnRespawnRandomly?.(handleRespawnRandomlyResult);
      connection.reducers?.removeOnRespawnAtSleepingBag?.(handleRespawnAtBagResult);
    };
  }, [connection]);

  // --- Minimap rendering effect ---
  useEffect(() => {
    if (!isMinimapOpen || !minimapCanvasRef.current) return;

    const canvas = minimapCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear the canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Ensure props are valid Maps before passing
    const validPlayers = players instanceof Map ? players : new Map();
    const validTrees = trees instanceof Map ? trees : new Map();
    const validStones = stones instanceof Map ? stones : new Map();
    const validSleepingBags = sleepingBags instanceof Map ? sleepingBags : new Map();
    const validCampfires = campfires instanceof Map ? campfires : new Map();

    drawMinimapOntoCanvas({
      ctx,
      players: validPlayers,
      trees: validTrees,
      stones: validStones,
      barrels: barrels instanceof Map ? barrels : new Map(),
      campfires: validCampfires,
      sleepingBags: validSleepingBags,
      localPlayer,
      localPlayerId,
      viewCenterOffset,
      playerPin: localPlayerPin,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      isMouseOverMinimap,
      zoomLevel: minimapZoom,
      sleepingBagImage: itemImagesRef.current?.get('sleeping_bag.png'),
      localPlayerDeathMarker: localPlayerDeathMarker,
      deathMarkerImage: deathMarkerImg,
      worldState: worldState,
      minimapCache: minimapCache,
      // Add the new minimap icon images
      pinMarkerImage: pinMarkerImg,
      campfireWarmthImage: campfireWarmthImg,
      torchOnImage: torchOnImg,
    });
  }, [
    isMinimapOpen,
    players,
    trees,
    stones,
    sleepingBags,
    campfires,
    localPlayer,
    localPlayerId,
    viewCenterOffset,
    localPlayerPin,
    isMouseOverMinimap,
    isMouseOverXButton,
    minimapZoom,
    itemImagesRef,
    localPlayerDeathMarker,
    deathMarkerImg,
    worldState,
    minimapCache,
    // Add new image dependencies
    pinMarkerImg,
    campfireWarmthImg,
    torchOnImg,
  ]);

  // Game loop for processing actions
  useGameLoop(processInputsAndActions);

  // Performance tracking (emergency mode removed)
  const performanceMode = useRef({ 
    lastFrameTime: 0
  });

  return (
    <div style={{ position: 'relative', width: canvasSize.width, height: canvasSize.height, overflow: 'hidden' }}>
      <canvas
        ref={gameCanvasRef}
        id="game-canvas"
        width={canvasSize.width}
        height={canvasSize.height}
        style={{ 
          position: 'absolute', 
          left: 0, 
          top: 0, 
          cursor: cursorStyle,
          pointerEvents: isGameMenuOpen ? 'none' : 'auto' // Don't capture events when menu is open
        }}
        onContextMenu={(e) => {
          if (placementInfo) {
            e.preventDefault();
          }
        }}
      />

      {shouldShowDeathScreen && (
        <DeathScreen
          // Remove respawnAt prop, add others later
          // respawnAt={respawnTimestampMs}
          // onRespawn={handleRespawnRequest} // We'll wire new callbacks later
          onRespawnRandomly={() => {
            console.log("Respawn Randomly Clicked");
            connection?.reducers?.respawnRandomly();
          }}
          onRespawnAtBag={(bagId) => {
            console.log("Respawn At Bag Clicked:", bagId);
            connection?.reducers?.respawnAtSleepingBag(bagId);
          }}
          localPlayerIdentity={localPlayerId ?? null}
          sleepingBags={sleepingBagsById} // Pass converted map
          // Pass other required props for minimap rendering within death screen
          players={players}
          trees={trees}
          stones={stones}
          barrels={barrels}
          campfires={campfires}
          playerPin={localPlayerPin}
          sleepingBagImage={itemImagesRef.current?.get('sleeping_bag.png')}
          // Pass the identified corpse and its image for the death screen minimap
          localPlayerDeathMarker={localPlayerDeathMarker}
          deathMarkerImage={deathMarkerImg}
          worldState={worldState}
          minimapCache={minimapCache} // Add minimapCache prop
          // Add the new minimap icon images
          pinMarkerImage={pinMarkerImg}
          campfireWarmthImage={campfireWarmthImg}
          torchOnImage={torchOnImg}
        />
      )}

      {isMinimapOpen && (
        <>
          {/* Subtle overlay to indicate interface is blocking interaction */}
          <div 
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              backgroundColor: 'rgba(0, 0, 0, 0.2)',
              zIndex: 999,
              pointerEvents: 'none', // Don't block interface interactions
            }}
          />
          <InterfaceContainer
            canvasWidth={canvasSize.width}
            canvasHeight={canvasSize.height}
            style={{
              zIndex: 1000,
            }}
            onClose={() => setIsMinimapOpen(false)}

          >
            <canvas
              ref={minimapCanvasRef}
              width={650}
              height={650}
              style={{ width: '100%', height: '100%' }}
            />
          </InterfaceContainer>
        </>
      )}
    </div>
  );
};

export default React.memo(GameCanvas);