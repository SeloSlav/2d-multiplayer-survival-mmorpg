import React, { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import {
  Player as SpacetimeDBPlayer,
  Tree as SpacetimeDBTree,
  Stone as SpacetimeDBStone,
  Campfire as SpacetimeDBCampfire,
  Mushroom as SpacetimeDBMushroom,
  WorldState as SpacetimeDBWorldState,
  ActiveEquipment as SpacetimeDBActiveEquipment,
  InventoryItem as SpacetimeDBInventoryItem,
  ItemDefinition as SpacetimeDBItemDefinition,
  DroppedItem as SpacetimeDBDroppedItem,
  WoodenStorageBox as SpacetimeDBWoodenStorageBox,
  PlayerPin as SpacetimeDBPlayerPin,
  ActiveConnection,
  Corn as SpacetimeDBCorn,
  Pumpkin as SpacetimeDBPumpkin,
  Hemp as SpacetimeDBHemp,
  SleepingBag as SpacetimeDBSleepingBag,
  PlayerCorpse as SpacetimeDBPlayerCorpse,
  Stash as SpacetimeDBStash,
  Cloud as SpacetimeDBCloud,
  ActiveConsumableEffect as SpacetimeDBActiveConsumableEffect
} from '../generated';

// --- Core Hooks ---
import { useAnimationCycle } from '../hooks/useAnimationCycle';
import { useAssetLoader } from '../hooks/useAssetLoader';
import { useGameViewport } from '../hooks/useGameViewport';
import { useMousePosition } from '../hooks/useMousePosition';
import { useDayNightCycle } from '../hooks/useDayNightCycle';
import { useInteractionFinder } from '../hooks/useInteractionFinder';
import { useGameLoop } from '../hooks/useGameLoop';
import { useInputHandler } from '../hooks/useInputHandler';
import { usePlayerHover } from '../hooks/usePlayerHover';
import { useMinimapInteraction } from '../hooks/useMinimapInteraction';
import { useEntityFiltering } from '../hooks/useEntityFiltering';
import { useSpacetimeTables } from '../hooks/useSpacetimeTables';
import { useCampfireParticles, Particle } from '../hooks/useCampfireParticles';
import { useTorchParticles } from '../hooks/useTorchParticles';
import { useCloudInterpolation, InterpolatedCloudData } from '../hooks/useCloudInterpolation';

// --- Rendering Utilities ---
import { renderWorldBackground } from '../utils/renderers/worldRenderingUtils';
import { renderYSortedEntities } from '../utils/renderers/renderingUtils.ts';
import { renderInteractionLabels } from '../utils/renderers/labelRenderingUtils.ts';
import { renderPlacementPreview } from '../utils/renderers/placementRenderingUtils.ts';
import { drawInteractionIndicator } from '../utils/interactionIndicator';
import { drawMinimapOntoCanvas } from './Minimap';
import { renderCampfire } from '../utils/renderers/campfireRenderingUtils';
import { renderMushroom } from '../utils/renderers/mushroomRenderingUtils';
import { renderCorn } from '../utils/renderers/cornRenderingUtils';
import { renderPumpkin } from '../utils/renderers/pumpkinRenderingUtils';
import { renderHemp } from '../utils/renderers/hempRenderingUtils';
import { renderDroppedItem } from '../utils/renderers/droppedItemRenderingUtils.ts';
import { renderSleepingBag } from '../utils/renderers/sleepingBagRenderingUtils';
import { renderPlayerCorpse } from '../utils/renderers/playerCorpseRenderingUtils';
import { renderStash } from '../utils/renderers/stashRenderingUtils';
import { renderPlayerTorchLight, renderCampfireLight } from '../utils/renderers/lightRenderingUtils';
import { renderTree } from '../utils/renderers/treeRenderingUtils';
import { renderCloudsDirectly } from '../utils/renderers/cloudRenderingUtils';
// --- Other Components & Utils ---
import DeathScreen from './DeathScreen.tsx';
import { itemIcons } from '../utils/itemIconUtils';
import { PlacementItemInfo, PlacementActions } from '../hooks/usePlacementManager';
import { HOLD_INTERACTION_DURATION_MS } from '../hooks/useInputHandler';
import {
    CAMPFIRE_HEIGHT, 
    SERVER_CAMPFIRE_DAMAGE_RADIUS, 
    SERVER_CAMPFIRE_DAMAGE_CENTER_Y_OFFSET
} from '../utils/renderers/campfireRenderingUtils';
import { BOX_HEIGHT } from '../utils/renderers/woodenStorageBoxRenderingUtils';
import { PLAYER_BOX_INTERACTION_DISTANCE_SQUARED } from '../hooks/useInteractionFinder';

// Define a placeholder height for Stash for indicator rendering
const STASH_HEIGHT = 40; // Adjust as needed to match stash sprite or desired indicator position

// --- Prop Interface ---
interface GameCanvasProps {
  players: Map<string, SpacetimeDBPlayer>;
  trees: Map<string, SpacetimeDBTree>;
  clouds: Map<string, SpacetimeDBCloud>;
  stones: Map<string, SpacetimeDBStone>;
  campfires: Map<string, SpacetimeDBCampfire>;
  mushrooms: Map<string, SpacetimeDBMushroom>;
  corns: Map<string, SpacetimeDBCorn>;
  pumpkins: Map<string, SpacetimeDBPumpkin>;
  hemps: Map<string, SpacetimeDBHemp>;
  droppedItems: Map<string, SpacetimeDBDroppedItem>;
  woodenStorageBoxes: Map<string, SpacetimeDBWoodenStorageBox>;
  sleepingBags: Map<string, SpacetimeDBSleepingBag>;
  playerCorpses: Map<string, SpacetimeDBPlayerCorpse>;
  stashes: Map<string, SpacetimeDBStash>;
  playerPins: Map<string, SpacetimeDBPlayerPin>;
  inventoryItems: Map<string, SpacetimeDBInventoryItem>;
  itemDefinitions: Map<string, SpacetimeDBItemDefinition>;
  activeConsumableEffects: Map<string, SpacetimeDBActiveConsumableEffect>;
  worldState: SpacetimeDBWorldState | null;
  activeConnections: Map<string, ActiveConnection> | undefined;
  localPlayerId?: string;
  connection: any | null;
  activeEquipments: Map<string, SpacetimeDBActiveEquipment>;
  placementInfo: PlacementItemInfo | null;
  placementActions: PlacementActions;
  placementError: string | null;
  onSetInteractingWith: (target: { type: string; id: number | bigint } | null) => void;
  updatePlayerPosition: (moveX: number, moveY: number) => void;
  callJumpReducer: () => void;
  callSetSprintingReducer: (isSprinting: boolean) => void;
  isMinimapOpen: boolean;
  setIsMinimapOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isChatting: boolean;
  messages: any;
  isSearchingCraftRecipes?: boolean;
  showInventory: boolean;
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
  mushrooms,
  corns,
  pumpkins,
  hemps,
  droppedItems,
  woodenStorageBoxes,
  sleepingBags,
  playerCorpses,
  stashes,
  playerPins,
  inventoryItems,
  itemDefinitions,
  activeConsumableEffects,
  worldState,
  localPlayerId,
  connection,
  activeEquipments,
  activeConnections,
  placementInfo,
  placementActions,
  placementError,
  onSetInteractingWith,
  updatePlayerPosition,
  callJumpReducer: jump,
  callSetSprintingReducer: setSprinting,
  isMinimapOpen,
  setIsMinimapOpen,
  isChatting,
  messages,
  isSearchingCraftRecipes,
  showInventory,
}) => {
 // console.log('[GameCanvas IS RUNNING] showInventory:', showInventory);

  // console.log("Cloud data in GameCanvas:", Array.from(clouds?.values() || []));

  // --- Refs ---
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastPositionsRef = useRef<Map<string, {x: number, y: number}>>(new Map());
  const placementActionsRef = useRef(placementActions);
  const prevPlayerHealthRef = useRef<number | undefined>(undefined);
  const [damagingCampfireIds, setDamagingCampfireIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    placementActionsRef.current = placementActions;
  }, [placementActions]);

  // --- Core Game State Hooks ---
  const localPlayer = useMemo(() => {
    if (!localPlayerId) return undefined;
    return players.get(localPlayerId);
  }, [players, localPlayerId]);

  const { canvasSize, cameraOffsetX, cameraOffsetY } = useGameViewport(localPlayer);
  const { heroImageRef, grassImageRef, itemImagesRef, cloudImagesRef } = useAssetLoader();
  const { worldMousePos, canvasMousePos } = useMousePosition({ canvasRef, cameraOffsetX, cameraOffsetY, canvasSize });

  // Lift deathMarkerImg definition here
  const deathMarkerImg = useMemo(() => itemImagesRef.current?.get('death_marker.png'), [itemImagesRef]);

  // Lift currentLocalPlayerCorpse calculation here
  const currentLocalPlayerCorpse = useMemo(() => {
    if (localPlayerId && playerCorpses instanceof Map && localPlayer && localPlayer.identity) {
      let latestTimeMicros: bigint = BigInt(-1);
      let foundCorpse: SpacetimeDBPlayerCorpse | null = null;

      playerCorpses.forEach(corpse => {
        if (corpse.playerIdentity.isEqual(localPlayer.identity)) {
          try {
            const corpseTimeMicros = (corpse.deathTime as any).__timestamp_micros_since_unix_epoch__;
            if (typeof corpseTimeMicros === 'bigint') {
              if (corpseTimeMicros > latestTimeMicros) {
                latestTimeMicros = corpseTimeMicros;
                foundCorpse = corpse;
              }
            } else {
              console.error(`[GameCanvas] Corpse ID ${corpse.id} deathTime.__timestamp_micros_since_unix_epoch__ was not a bigint. Actual type: ${typeof corpseTimeMicros}, value: ${corpseTimeMicros}. Timestamp structure:`, corpse.deathTime);
            }
          } catch (e) {
            console.error(`[GameCanvas] Error processing deathTime for corpse ID ${corpse.id}:`, e, "Full timestamp object:", corpse.deathTime);
          }
        }
      });

      if (foundCorpse) {
        // console.log(`[GameCanvas] Latest corpse for local player ${localPlayer.username} is ID ${(foundCorpse as SpacetimeDBPlayerCorpse).id} with time ${latestTimeMicros}`);
      } else {
        // console.log(`[GameCanvas] No corpse found for local player ${localPlayer.username} after checking all corpses.`);
      }
      return foundCorpse;
    } else {
      // console.log('[GameCanvas] Corpse finding skipped due to missing dependencies.');
      return null;
    }
  }, [localPlayerId, playerCorpses, localPlayer]);
  
  const { overlayRgba, maskCanvasRef } = useDayNightCycle({ 
    worldState, 
    campfires, 
    players, // Pass all players
    activeEquipments, // Pass all active equipments
    itemDefinitions, // Pass all item definitions
    cameraOffsetX, 
    cameraOffsetY, 
    canvasSize 
  });
  const {
    closestInteractableMushroomId,
    closestInteractableCornId,
    closestInteractablePumpkinId,
    closestInteractableHempId,
    closestInteractableCampfireId,
    closestInteractableDroppedItemId,
    closestInteractableBoxId,
    isClosestInteractableBoxEmpty,
    closestInteractableCorpseId,
    closestInteractableStashId,
    closestInteractableSleepingBagId,
  } = useInteractionFinder({
    localPlayer,
    mushrooms,
    corns,
    pumpkins,
    hemps,
    campfires,
    droppedItems,
    woodenStorageBoxes,
    playerCorpses,
    stashes,
    sleepingBags,
  });
  const animationFrame = useAnimationCycle(150, 4);
  const { 
    interactionProgress, 
    isActivelyHolding,
    processInputsAndActions,
    currentJumpOffsetY
  } = useInputHandler({
      canvasRef, connection, localPlayerId, localPlayer: localPlayer ?? null,
      activeEquipments, itemDefinitions,
      placementInfo, placementActions, worldMousePos,
      closestInteractableMushroomId, closestInteractableCornId, closestInteractablePumpkinId, closestInteractableHempId,
      closestInteractableCampfireId, closestInteractableDroppedItemId,
      closestInteractableBoxId, isClosestInteractableBoxEmpty, 
      woodenStorageBoxes,
      isMinimapOpen, setIsMinimapOpen,
      onSetInteractingWith, isChatting,
      closestInteractableCorpseId,
      closestInteractableStashId,
      stashes,
      isSearchingCraftRecipes,
      isInventoryOpen: showInventory,
  });

  // --- Use Entity Filtering Hook ---
  const {
    visibleSleepingBags,
    visibleMushrooms,
    visibleCorns,
    visiblePumpkins,
    visibleHemps,
    visibleDroppedItems,
    visibleCampfires,
    visibleMushroomsMap,
    visibleCampfiresMap,
    visibleDroppedItemsMap,
    visibleBoxesMap,
    visibleCornsMap,
    visiblePumpkinsMap,
    visibleHempsMap,
    visiblePlayerCorpses,
    visibleStashes,
    visiblePlayerCorpsesMap,
    visibleStashesMap,
    visibleSleepingBagsMap,
    visibleTrees,
    visibleTreesMap,
    ySortedEntities
  } = useEntityFiltering(
    players,
    trees,
    stones,
    campfires,
    mushrooms,
    corns,
    pumpkins,
    hemps,
    droppedItems,
    woodenStorageBoxes,
    sleepingBags,
    playerCorpses,
    stashes,
    cameraOffsetX,
    cameraOffsetY,
    canvasSize.width,
    canvasSize.height
  );

  // --- UI State ---
  const { hoveredPlayerIds, handlePlayerHover } = usePlayerHover();

  // --- Use the new Minimap Interaction Hook ---
  const { minimapZoom, isMouseOverMinimap, localPlayerPin, viewCenterOffset } = useMinimapInteraction({
      canvasRef,
      isMinimapOpen,
      connection,
      localPlayer,
      playerPins,
      localPlayerId,
      canvasSize,
  });

  // --- Should show death screen ---
  // Show death screen only based on isDead flag now
  const shouldShowDeathScreen = !!(localPlayer?.isDead && connection);
  
  // Set cursor style based on placement
  const cursorStyle = placementInfo ? 'cell' : 'crosshair';

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

  const lastFrameTimeRef = useRef<number>(performance.now());
  const [deltaTime, setDeltaTime] = useState<number>(0);

  // --- Use Cloud Interpolation Hook --- (NEW)
  const interpolatedClouds = useCloudInterpolation({ serverClouds: clouds, deltaTime });

  // Use the new hook for campfire particles
  const campfireParticles = useCampfireParticles({
    visibleCampfiresMap,
    deltaTime,
    damagingCampfireIds,
  });
  const torchParticles = useTorchParticles({
    players,
    activeEquipments,
    itemDefinitions,
    deltaTime,
  });

  // New function to render particles
  const renderParticlesToCanvas = useCallback((ctx: CanvasRenderingContext2D, particlesToRender: Particle[]) => {
    if (!particlesToRender.length) return;

    particlesToRender.forEach(p => {
        // Use p.x and p.y directly as ctx is already translated by camera offsets
        const screenX = Math.floor(p.x); 
        const screenY = Math.floor(p.y); 
        const size = Math.max(1, Math.floor(p.size)); 

        // --- ADDED: Debugging for smoke burst particles ---
        if (p.type === 'smoke' && p.color === "#000000") { // Check if it's a black smoke burst particle
            console.log(`[RenderParticles] Rendering SMOKE BURST particle: ID=${p.id}, X=${screenX}, Y=${screenY}, Size=${size}, Alpha=${p.alpha}, Color=${p.color}`);
        }
        // --- END ADDED ---

        ctx.globalAlpha = p.alpha;

        if (p.type === 'fire' && p.color) {
            ctx.fillStyle = p.color;
            ctx.fillRect(screenX - Math.floor(size / 2), screenY - Math.floor(size / 2), size, size);
        } else if (p.type === 'smoke') {
            // Regular smoke still uses the default light grey
            ctx.fillStyle = `rgba(160, 160, 160, 1)`; 
            ctx.fillRect(screenX - Math.floor(size / 2), screenY - Math.floor(size / 2), size, size);
        } else if (p.type === 'smoke_burst' && p.color) { // MODIFIED: Added condition for 'smoke_burst'
            ctx.fillStyle = p.color; // This will be black (#000000)
            ctx.fillRect(screenX - Math.floor(size / 2), screenY - Math.floor(size / 2), size, size);
        }
    });
    ctx.globalAlpha = 1.0; 
  }, []);

  const renderGame = useCallback(() => {
    const canvas = canvasRef.current;
    const maskCanvas = maskCanvasRef.current;
    if (!canvas || !maskCanvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

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
    ctx.fillStyle = '#000000'; // Should be black if no background, or ensure background draws over this
    ctx.fillRect(0, 0, currentCanvasWidth, currentCanvasHeight);

    ctx.save();
    ctx.translate(cameraOffsetX, cameraOffsetY);
    // Pass the necessary viewport parameters to the optimized background renderer
    renderWorldBackground(ctx, grassImageRef, cameraOffsetX, cameraOffsetY, currentCanvasWidth, currentCanvasHeight);

    let isPlacementTooFar = false;
    if (placementInfo && localPlayer && currentWorldMouseX !== null && currentWorldMouseY !== null) {
         const placeDistSq = (currentWorldMouseX - localPlayer.positionX)**2 + (currentWorldMouseY - localPlayer.positionY)**2;
         const clientPlacementRangeSq = PLAYER_BOX_INTERACTION_DISTANCE_SQUARED * 1.1;
         if (placeDistSq > clientPlacementRangeSq) {
             isPlacementTooFar = true;
         }
    }

    // --- Render Ground Items Individually --- 

    // First pass: Draw ONLY shadows for ground items that have custom shadows
    // Render Campfire Shadows
    visibleCampfires.forEach(campfire => {
        renderCampfire(ctx, campfire, now_ms, currentCycleProgress, true /* onlyDrawShadow */);
    });
    // Render Pumpkin Shadows
    visiblePumpkins.forEach(pumpkin => {
        renderPumpkin(ctx, pumpkin, now_ms, currentCycleProgress, true /* onlyDrawShadow */);
    });
    // Render Mushroom Shadows - RE-ADDED
    visibleMushrooms.forEach(mushroom => {
        renderMushroom(ctx, mushroom, now_ms, currentCycleProgress, true /* onlyDrawShadow */);
    });
    // --- BEGIN ADDED: Render Tree Shadows ---
    if (visibleTrees) {
      visibleTrees.forEach(tree => {
        renderTree(ctx, tree, now_ms, currentCycleProgress, true /* onlyDrawShadow */);
      });
    }
    // --- END ADDED: Render Tree Shadows ---
    // TODO: Add other ground items like mushrooms, crops here if they get custom dynamic shadows

    // --- Render Clouds on Canvas --- (MOVED HERE)
    // Clouds are rendered after all world entities and particles,
    // but before world-anchored UI like labels.
    // The context (ctx) should still be translated by cameraOffset at this point.
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
    // Render Mushrooms
    /*visibleMushrooms.forEach(mushroom => {
        renderMushroom(ctx, mushroom, now_ms, currentCycleProgress, false, true);
    });*/
    // Render Corn - Already removed
    // Render Pumpkins
    /*visiblePumpkins.forEach(pumpkin => {
        renderPumpkin(ctx, pumpkin, now_ms, currentCycleProgress, false, true );
    });*/
    // Render Hemp - Already removed
    // Render Sleeping Bags
    visibleSleepingBags.forEach(sleepingBag => {
        renderSleepingBag(ctx, sleepingBag, now_ms, currentCycleProgress);
    });
    // Render Stashes (Remove direct rendering as it's now y-sorted)
    /*visibleStashes.forEach(stash => {
        renderStash(ctx, stash, now_ms, currentCycleProgress);
    });*/
    // --- End Ground Items --- 

    // --- Render Y-Sorted Entities --- (Keep this logic)
    ySortedEntities.forEach(({ type, entity }) => {
        if (type === 'player') {
            const player = entity as SpacetimeDBPlayer;
            const playerId = player.identity.toHexString();

            // ##### ADD LOGGING HERE #####
            if (localPlayerId && playerId === localPlayerId) {
              console.log(`[GameCanvas] Rendering local player ${player.username} (ID: ${playerId}). ` +
                          `isDead: ${player.isDead}, ` +
                          `lastHitTime: ${player.lastHitTime ? player.lastHitTime.__timestamp_micros_since_unix_epoch__ : 'null'}`);
            }
            // ##########################

           const lastPos = lastPositionsRef.current.get(playerId);
           const lastPosX = lastPos?.x || 0;
           const lastPosY = lastPos?.y || 0;

           renderYSortedEntities({
               ctx,
               ySortedEntities,
               heroImageRef,
               lastPositionsRef,
               activeConnections,
               activeEquipments,
               activeConsumableEffects,
               itemDefinitions,
               itemImagesRef,
               worldMouseX: currentWorldMouseX,
               worldMouseY: currentWorldMouseY,
               localPlayerId: localPlayerId,
               animationFrame,
               nowMs: now_ms,
               hoveredPlayerIds,
               onPlayerHover: handlePlayerHover,
               cycleProgress: currentCycleProgress,
               renderPlayerCorpse: (props) => renderPlayerCorpse({...props, cycleProgress: currentCycleProgress, heroImageRef: heroImageRef })
           });
        }
    });
    // --- End Y-Sorted Entities ---

    // Render campfire particles here, after other world entities but before labels/UI
    if (ctx) { // Ensure context is still valid
        // Call without camera offsets, as ctx is already translated
        renderParticlesToCanvas(ctx, campfireParticles);
        renderParticlesToCanvas(ctx, torchParticles);
    }

    renderInteractionLabels({
        ctx,
        mushrooms: visibleMushroomsMap,
        corns: visibleCornsMap,
        pumpkins: visiblePumpkinsMap,
        hemps: visibleHempsMap,
        campfires: visibleCampfiresMap,
        droppedItems: visibleDroppedItemsMap,
        woodenStorageBoxes: visibleBoxesMap,
        playerCorpses: visiblePlayerCorpsesMap,
        stashes: stashes,
        sleepingBags: visibleSleepingBagsMap,
        players: players,
        itemDefinitions,
        closestInteractableMushroomId, 
        closestInteractableCornId, 
        closestInteractablePumpkinId,
        closestInteractableHempId,
        closestInteractableCampfireId,
        closestInteractableDroppedItemId, 
        closestInteractableBoxId, 
        isClosestInteractableBoxEmpty,
        closestInteractableCorpseId,
        closestInteractableStashId,
        closestInteractableSleepingBagId,
    });
    renderPlacementPreview({
        ctx, placementInfo, itemImagesRef, worldMouseX: currentWorldMouseX,
        worldMouseY: currentWorldMouseY, isPlacementTooFar, placementError,
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

    // --- Post-Processing (Day/Night, Indicators, Lights, Minimap) ---
    // Day/Night mask overlay
    if (overlayRgba !== 'transparent' && overlayRgba !== 'rgba(0,0,0,0.00)' && maskCanvas) {
         ctx.drawImage(maskCanvas, 0, 0);
    }

    // Interaction indicators - Draw only for visible entities that are interactable
    const drawIndicatorIfNeeded = (entityType: 'campfire' | 'wooden_storage_box' | 'stash' | 'player_corpse', entityId: number | bigint, entityPosX: number, entityPosY: number, entityHeight: number, isInView: boolean) => {
        // If interactionProgress is null (meaning no interaction is even being tracked by the state object),
        // or if the entity is not in view, do nothing.
        if (!isInView || !interactionProgress) {
            return;
        }
        
        const targetId = typeof entityId === 'bigint' ? BigInt(interactionProgress.targetId ?? 0) : Number(interactionProgress.targetId ?? 0);

        // Check if the current entity being processed is the target of the (potentially stale) interactionProgress object.
        if (interactionProgress.targetType === entityType && targetId === entityId) {
            
            // IMPORTANT: Only draw the indicator if the hold is *currently active* (isActivelyHolding is true).
            // If isActivelyHolding is false, it means the hold was just released/cancelled.
            // In this case, we don't draw anything for this entity, not even the background circle.
            // The indicator will completely disappear once interactionProgress becomes null in the next state update.
            if (isActivelyHolding) {
                const currentProgress = Math.min(Math.max((Date.now() - interactionProgress.startTime) / HOLD_INTERACTION_DURATION_MS, 0), 1);
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
    
    visibleBoxesMap.forEach((box: SpacetimeDBWoodenStorageBox) => { 
      // For boxes, the indicator is only relevant if a hold action is in progress (e.g., picking up an empty box)
      if (interactionProgress && interactionProgress.targetId === box.id && interactionProgress.targetType === 'wooden_storage_box') { 
        drawIndicatorIfNeeded('wooden_storage_box', box.id, box.posX, box.posY, BOX_HEIGHT, true); 
      } 
    });

    // Corrected: Iterate over the full 'stashes' map for drawing indicators for stashes
    // The 'isInView' check within drawIndicatorIfNeeded can be enhanced if needed,
    // but for interaction progress, if it's the target, we likely want to show it if player is close.
    if (stashes instanceof Map) { // Ensure stashes is a Map
        stashes.forEach((stash: SpacetimeDBStash) => {
            // Check if this stash is the one currently being interacted with for a hold action
            if (interactionProgress && interactionProgress.targetId === stash.id && interactionProgress.targetType === 'stash') {
                // For a hidden stash being surfaced, we want to draw the indicator.
                // The 'true' for isInView might need refinement if stashes can be off-screen 
                // but still the closest interactable (though unlikely for a hold interaction).
                // For now, assume if it's the interaction target, it's relevant to draw the indicator.
                drawIndicatorIfNeeded('stash', stash.id, stash.posX, stash.posY, STASH_HEIGHT, true); 
            }
        });
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

    // --- Render Torch Light for ALL players (Local and Remote) ---
    players.forEach(player => {
      renderPlayerTorchLight({
        ctx,
        player,
        activeEquipments,
        itemDefinitions,
        cameraOffsetX,
        cameraOffsetY,
      });
    });
    // --- End Torch Light ---

    ctx.restore();

    // Re-added Minimap drawing call
    if (isMinimapOpen) {
        // Ensure props are valid Maps before passing
        const validPlayers = players instanceof Map ? players : new Map();
        const validTrees = trees instanceof Map ? trees : new Map();
        const validStones = stones instanceof Map ? stones : new Map();
        const validSleepingBags = sleepingBags instanceof Map ? sleepingBags : new Map();
        const validCampfires = campfires instanceof Map ? campfires : new Map();

        drawMinimapOntoCanvas({ 
            ctx: ctx!, // Use non-null assertion if context is guaranteed here
            players: validPlayers, 
            trees: validTrees, 
            stones: validStones, 
            campfires: validCampfires,
            sleepingBags: validSleepingBags,
            localPlayer, // Pass localPlayer directly
            localPlayerId,
            viewCenterOffset, // Pass pan offset
            playerPin: localPlayerPin, // Pass pin data
            canvasWidth: currentCanvasWidth, 
            canvasHeight: currentCanvasHeight, 
            isMouseOverMinimap, // Pass hover state
            zoomLevel: minimapZoom, // Pass zoom level
            sleepingBagImage: itemImagesRef.current?.get('sleeping_bag.png'), // Pass image for regular map too
            // --- Pass Death Marker Props ---
            localPlayerCorpse: currentLocalPlayerCorpse, // Pass the found corpse
            deathMarkerImage: deathMarkerImg,      // Pass the loaded image
            worldState, // <-- Pass worldState for time of day
        });
    }
  }, [
      // Dependencies
      visibleMushrooms, visibleCorns, visiblePumpkins, visibleDroppedItems, visibleCampfires, visibleSleepingBags,
      ySortedEntities, visibleMushroomsMap, visibleCornsMap, visiblePumpkinsMap, visibleCampfiresMap, visibleDroppedItemsMap, visibleBoxesMap,
      players, itemDefinitions, trees, stones, 
      worldState, localPlayerId, localPlayer, activeEquipments, localPlayerPin, viewCenterOffset,
      itemImagesRef, heroImageRef, grassImageRef, cloudImagesRef, cameraOffsetX, cameraOffsetY,
      canvasSize.width, canvasSize.height, worldMousePos.x, worldMousePos.y,
      animationFrame, placementInfo, placementError, overlayRgba, maskCanvasRef,
      closestInteractableMushroomId, closestInteractableCornId, closestInteractablePumpkinId, closestInteractableCampfireId,
      closestInteractableDroppedItemId, closestInteractableBoxId, isClosestInteractableBoxEmpty,
      interactionProgress, hoveredPlayerIds, handlePlayerHover, messages,
      isMinimapOpen, isMouseOverMinimap, minimapZoom,
      activeConnections,
      activeConsumableEffects,
      visiblePlayerCorpses,
      visibleStashes,
      visibleSleepingBags,
      campfireParticles, 
      torchParticles,
      interpolatedClouds,
      isSearchingCraftRecipes,
      worldState?.cycleProgress, // Correct dependency for renderGame
      visibleTrees, // Added to dependency array
      visibleTreesMap, // Added to dependency array
      playerCorpses,
      showInventory,
  ]);

  const gameLoopCallback = useCallback(() => {
    const now = performance.now();
    const dt = now - lastFrameTimeRef.current;
    lastFrameTimeRef.current = now;
    setDeltaTime(dt > 0 ? dt : 0); // Ensure deltaTime is not negative

    processInputsAndActions(); 
    renderGame(); 
  }, [processInputsAndActions, renderGame]);
  useGameLoop(gameLoopCallback);

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
    return {
      minX: -cameraOffsetX,
      minY: -cameraOffsetY,
      maxX: -cameraOffsetX + canvasSize.width,
      maxY: -cameraOffsetY + canvasSize.height,
    };
  }, [cameraOffsetX, cameraOffsetY, canvasSize.width, canvasSize.height]);

  // Call useSpacetimeTables (replacing the previous faulty call)
  // Ignore return values for now using placeholder {}
  useSpacetimeTables({ 
      connection, 
      cancelPlacement: placementActions.cancelPlacement,
      viewport: worldViewport, // Pass calculated viewport (can be null)
  });

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
                console.log(`[GameCanvas] Player took damage near burning campfire ${id}. Health: ${prevHealth} -> ${currentHealth}`);
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

  return (
    <div style={{ position: 'relative', width: canvasSize.width, height: canvasSize.height, overflow: 'hidden' }}>
      <canvas
        ref={canvasRef}
        id="game-canvas"
        width={canvasSize.width}
        height={canvasSize.height}
        style={{ position: 'absolute', left: 0, top: 0, cursor: cursorStyle }}
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
          onRespawnRandomly={() => { console.log("Respawn Randomly Clicked"); connection?.reducers?.respawnRandomly(); }}
          onRespawnAtBag={(bagId) => { console.log("Respawn At Bag Clicked:", bagId); connection?.reducers?.respawnAtSleepingBag(bagId); }}
          localPlayerIdentity={localPlayerId ?? null}
          sleepingBags={sleepingBagsById} // Pass converted map
          // Pass other required props for minimap rendering within death screen
          players={players}
          trees={trees}
          stones={stones}
          campfires={campfires}
          playerPin={localPlayerPin}
          sleepingBagImage={itemImagesRef.current?.get('sleeping_bag.png')}
          // Pass the identified corpse and its image for the death screen minimap
          localPlayerCorpse={currentLocalPlayerCorpse} // Pass the found corpse
          deathMarkerImage={deathMarkerImg}      // Pass the loaded image
          worldState={worldState}
        />
      )}
    </div>
  );
};

export default React.memo(GameCanvas);