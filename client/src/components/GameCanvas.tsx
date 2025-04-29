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
  SleepingBag as SpacetimeDBSleepingBag
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
import { renderDroppedItem } from '../utils/renderers/droppedItemRenderingUtils.ts';
import { renderSleepingBag } from '../utils/renderers/sleepingBagRenderingUtils';

// --- Other Components & Utils ---
import DeathScreen from './DeathScreen.tsx';
import { itemIcons } from '../utils/itemIconUtils';
import { PlacementItemInfo, PlacementActions } from '../hooks/usePlacementManager';
import {
    gameConfig, // Import gameConfig
    CAMPFIRE_LIGHT_RADIUS_BASE,
    CAMPFIRE_FLICKER_AMOUNT,
    HOLD_INTERACTION_DURATION_MS,
    CAMPFIRE_HEIGHT,
    BOX_HEIGHT,
    CAMPFIRE_LIGHT_INNER_COLOR,
    CAMPFIRE_LIGHT_OUTER_COLOR,
    PLAYER_BOX_INTERACTION_DISTANCE_SQUARED
} from '../config/gameConfig';

// --- Prop Interface ---
interface GameCanvasProps {
  players: Map<string, SpacetimeDBPlayer>;
  trees: Map<string, SpacetimeDBTree>;
  stones: Map<string, SpacetimeDBStone>;
  campfires: Map<string, SpacetimeDBCampfire>;
  mushrooms: Map<string, SpacetimeDBMushroom>;
  corns: Map<string, SpacetimeDBCorn>;
  droppedItems: Map<string, SpacetimeDBDroppedItem>;
  woodenStorageBoxes: Map<string, SpacetimeDBWoodenStorageBox>;
  sleepingBags: Map<string, SpacetimeDBSleepingBag>;
  playerPins: Map<string, SpacetimeDBPlayerPin>;
  inventoryItems: Map<string, SpacetimeDBInventoryItem>;
  itemDefinitions: Map<string, SpacetimeDBItemDefinition>;
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
  stones,
  campfires,
  mushrooms,
  corns,
  droppedItems,
  woodenStorageBoxes,
  sleepingBags,
  playerPins,
  inventoryItems,
  itemDefinitions,
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
}) => {

  // --- Refs ---
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastPositionsRef = useRef<Map<string, {x: number, y: number}>>(new Map());
  const placementActionsRef = useRef(placementActions);
  useEffect(() => {
    placementActionsRef.current = placementActions;
  }, [placementActions]);

  // --- Core Game State Hooks ---
  const localPlayer = useMemo(() => {
    if (!localPlayerId) return undefined;
    return players.get(localPlayerId);
  }, [players, localPlayerId]);

  const { canvasSize, cameraOffsetX, cameraOffsetY } = useGameViewport(localPlayer);
  const { heroImageRef, grassImageRef, itemImagesRef } = useAssetLoader();
  const { worldMousePos, canvasMousePos } = useMousePosition({ canvasRef, cameraOffsetX, cameraOffsetY, canvasSize });
  const { overlayRgba, maskCanvasRef } = useDayNightCycle({ worldState, campfires, cameraOffsetX, cameraOffsetY, canvasSize });
  const {
    closestInteractableMushroomId,
    closestInteractableCornId,
    closestInteractableCampfireId,
    closestInteractableDroppedItemId,
    closestInteractableBoxId,
    isClosestInteractableBoxEmpty,
  } = useInteractionFinder({ localPlayer, mushrooms, corns, campfires, droppedItems, woodenStorageBoxes });
  const animationFrame = useAnimationCycle(150, 4);
  const { interactionProgress, processInputsAndActions } = useInputHandler({
      canvasRef, connection, localPlayerId, localPlayer: localPlayer ?? null,
      activeEquipments, placementInfo, placementActions, worldMousePos,
      closestInteractableMushroomId, closestInteractableCornId, closestInteractableCampfireId, closestInteractableDroppedItemId,
      closestInteractableBoxId, isClosestInteractableBoxEmpty, 
      woodenStorageBoxes,
      isMinimapOpen, setIsMinimapOpen,
      onSetInteractingWith, isChatting
  });

  // --- Use Entity Filtering Hook ---
  const {
    visiblePlayers,
    visibleTrees,
    visibleStones,
    visibleWoodenStorageBoxes,
    visibleSleepingBags,
    visibleMushrooms,
    visibleCorns,
    visibleDroppedItems,
    visibleCampfires,
    visibleMushroomsMap,
    visibleCampfiresMap,
    visibleDroppedItemsMap,
    visibleBoxesMap,
    visibleCornsMap,
    ySortedEntities
  } = useEntityFiltering(
    players,
    trees,
    stones,
    campfires,
    mushrooms,
    corns,
    droppedItems,
    woodenStorageBoxes,
    sleepingBags,
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

  // --- Derived State ---
  // Removed respawnTimestampMs calculation as respawn_at is removed
  // const respawnTimestampMs = useMemo(() => {
  //   if (localPlayer?.isDead && localPlayer.respawnAt) {
  //     return Number(localPlayer.respawnAt.microsSinceUnixEpoch / 1000n);
  //   }
  //   return 0;
  // }, [localPlayer?.isDead, localPlayer?.respawnAt]);

  // --- Handle respawn ---
  const handleRespawnRequest = useCallback(() => {
    if (!connection?.reducers) {
      console.error("Connection or reducers not available for respawn request.");
      return;
    }
    try {
      connection.reducers.requestRespawn();
    } catch (err) {
      console.error("Error calling requestRespawn reducer:", err);
    }
  }, [connection]);

  // --- Should show death screen ---
  // Show death screen only based on isDead flag now
  const shouldShowDeathScreen = !!(localPlayer?.isDead && connection);
  
  // Set cursor style based on placement
  const cursorStyle = placementInfo ? 'cell' : 'crosshair';

  // --- Effects ---
  useEffect(() => {
    itemDefinitions.forEach(itemDef => {
      const iconSrc = itemIcons[itemDef.iconAssetName];
      if (itemDef && iconSrc && typeof iconSrc === 'string' && !itemImagesRef.current.has(itemDef.iconAssetName)) {
        const img = new Image();
        img.src = iconSrc;
        img.onload = () => {
          itemImagesRef.current.set(itemDef.iconAssetName, img);
        };
        img.onerror = () => console.error(`Failed to preload item image asset: ${itemDef.iconAssetName} (Expected path/source: ${iconSrc})`);
        itemImagesRef.current.set(itemDef.iconAssetName, img);
      }
    });
  }, [itemDefinitions, itemImagesRef]);

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

    // --- Rendering ---
    ctx.clearRect(0, 0, currentCanvasWidth, currentCanvasHeight);
    ctx.fillStyle = '#000000';
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
    // Render Campfires
    visibleCampfires.forEach(campfire => {
        renderCampfire(ctx, campfire, now_ms);
    });
    // Render Dropped Items
    visibleDroppedItems.forEach(item => {
        const itemDef = itemDefinitions.get(item.itemDefId.toString());
        // Use the new signature: ctx, item, itemDef, nowMs
        renderDroppedItem({ ctx, item, itemDef, nowMs: now_ms }); 
    });
    // Render Mushrooms
    visibleMushrooms.forEach(mushroom => {
        renderMushroom(ctx, mushroom, now_ms);
    });
    // Render Corn
    visibleCorns.forEach(corn => {
        renderCorn(ctx, corn, now_ms);
    });
    // Render Sleeping Bags
    visibleSleepingBags.forEach(sleepingBag => {
        renderSleepingBag({ ctx, sleepingBag, nowMs: now_ms });
    });
    // --- End Ground Items --- 

    // --- Render Y-Sorted Entities --- (Keep this logic)
    renderYSortedEntities({
        ctx, ySortedEntities, heroImageRef, lastPositionsRef,
        activeConnections,
        activeEquipments,
        itemDefinitions, itemImagesRef, worldMouseX: currentWorldMouseX, worldMouseY: currentWorldMouseY,
        animationFrame, nowMs: now_ms, hoveredPlayerIds, onPlayerHover: handlePlayerHover
    });
    // --- End Y-Sorted Entities ---

    renderInteractionLabels({
        ctx,
        mushrooms: visibleMushroomsMap,
        corns: visibleCornsMap,
        campfires: visibleCampfiresMap,
        droppedItems: visibleDroppedItemsMap,
        woodenStorageBoxes: visibleBoxesMap,
        itemDefinitions,
        closestInteractableMushroomId, closestInteractableCornId, closestInteractableCampfireId,
        closestInteractableDroppedItemId, closestInteractableBoxId, isClosestInteractableBoxEmpty,
    });
    renderPlacementPreview({
        ctx, placementInfo, itemImagesRef, worldMouseX: currentWorldMouseX,
        worldMouseY: currentWorldMouseY, isPlacementTooFar, placementError,
    });

    ctx.restore();

    // --- Post-Processing (Day/Night, Indicators, Lights, Minimap) ---
    // Day/Night mask overlay
    if (overlayRgba !== 'transparent' && overlayRgba !== 'rgba(0,0,0,0.00)') {
         ctx.drawImage(maskCanvas, 0, 0);
    }

    // Interaction indicators - Draw only for visible entities that are interactable
    const drawIndicatorIfNeeded = (entityType: 'campfire' | 'wooden_storage_box', entityId: number, entityPosX: number, entityPosY: number, entityHeight: number, isInView: boolean) => {
        if (!isInView) return; // Don't draw indicator if entity isn't visible
        if (interactionProgress && interactionProgress.targetId === entityId && interactionProgress.targetType === entityType) {
            const screenX = entityPosX + cameraOffsetX;
            const screenY = entityPosY + cameraOffsetY;
            const interactionDuration = Date.now() - interactionProgress.startTime;
            const progressPercent = Math.min(interactionDuration / HOLD_INTERACTION_DURATION_MS, 1);
            drawInteractionIndicator(ctx, screenX, screenY - (entityHeight / 2) - 15, progressPercent);
        }
    };

    // Iterate through visible entities MAPS for indicators
    visibleCampfiresMap.forEach((fire: SpacetimeDBCampfire) => { 
      drawIndicatorIfNeeded('campfire', fire.id, fire.posX, fire.posY, CAMPFIRE_HEIGHT, true); 
    });
    
    visibleBoxesMap.forEach((box: SpacetimeDBWoodenStorageBox) => { 
      if (interactionProgress && interactionProgress.targetId === box.id && interactionProgress.targetType === 'wooden_storage_box') { 
        drawIndicatorIfNeeded('wooden_storage_box', box.id, box.posX, box.posY, BOX_HEIGHT, true); 
      } 
    });

    // Campfire Lights - Only draw for visible campfires
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    visibleCampfiresMap.forEach((fire: SpacetimeDBCampfire) => {
        if (fire.isBurning) {
            const lightScreenX = fire.posX + cameraOffsetX;
            const lightScreenY = fire.posY + cameraOffsetY;
            const flicker = (Math.random() - 0.5) * 2 * CAMPFIRE_FLICKER_AMOUNT;
            const currentLightRadius = Math.max(0, CAMPFIRE_LIGHT_RADIUS_BASE + flicker);
            const lightGradient = ctx.createRadialGradient(lightScreenX, lightScreenY, 0, lightScreenX, lightScreenY, currentLightRadius);
            lightGradient.addColorStop(0, CAMPFIRE_LIGHT_INNER_COLOR);
            lightGradient.addColorStop(1, CAMPFIRE_LIGHT_OUTER_COLOR);
            ctx.fillStyle = lightGradient;
            ctx.beginPath();
            ctx.arc(lightScreenX, lightScreenY, currentLightRadius, 0, Math.PI * 2);
            ctx.fill();
        }
    });
    ctx.restore();

    // Re-added Minimap drawing call
    if (isMinimapOpen) {
        // Ensure props are valid Maps before passing
        const validPlayers = players instanceof Map ? players : new Map();
        const validTrees = trees instanceof Map ? trees : new Map();
        const validStones = stones instanceof Map ? stones : new Map();
        const validSleepingBags = sleepingBags instanceof Map ? sleepingBags : new Map();

        drawMinimapOntoCanvas({ 
            ctx: ctx!, // Use non-null assertion if context is guaranteed here
            players: validPlayers, 
            trees: validTrees, 
            stones: validStones, 
            sleepingBags: validSleepingBags, // Pass validated map
            localPlayer, // Pass localPlayer directly
            localPlayerId,
            viewCenterOffset, // Pass pan offset
            playerPin: localPlayerPin, // Pass pin data
            canvasWidth: currentCanvasWidth, 
            canvasHeight: currentCanvasHeight, 
            isMouseOverMinimap, // Pass hover state
            zoomLevel: minimapZoom, // Pass zoom level
            sleepingBagImage: itemImagesRef.current?.get('sleeping_bag.png') // Pass image for regular map too
        });
    }
  }, [
      // Dependencies
      visibleMushrooms, visibleCorns, visibleDroppedItems, visibleCampfires, visibleSleepingBags,
      ySortedEntities, visibleMushroomsMap, visibleCornsMap, visibleCampfiresMap, visibleDroppedItemsMap, visibleBoxesMap,
      players, itemDefinitions, trees, stones, 
      worldState, localPlayerId, localPlayer, activeEquipments, localPlayerPin, viewCenterOffset,
      itemImagesRef, heroImageRef, grassImageRef, cameraOffsetX, cameraOffsetY,
      canvasSize.width, canvasSize.height, worldMousePos.x, worldMousePos.y,
      animationFrame, placementInfo, placementError, overlayRgba, maskCanvasRef,
      closestInteractableMushroomId, closestInteractableCornId, closestInteractableCampfireId,
      closestInteractableDroppedItemId, closestInteractableBoxId, isClosestInteractableBoxEmpty,
      interactionProgress, hoveredPlayerIds, handlePlayerHover, messages,
      isMinimapOpen, isMouseOverMinimap, minimapZoom,
      activeConnections
  ]);

  const gameLoopCallback = useCallback(() => {
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

  return (
    <>
      {shouldShowDeathScreen && (
        <DeathScreen
          // Remove respawnAt prop, add others later
          // respawnAt={respawnTimestampMs}
          // onRespawn={handleRespawnRequest} // We'll wire new callbacks later
          // Dummy props for now, replace in next step
          onRespawnRandomly={() => { console.log("Respawn Randomly Clicked"); connection?.reducers?.respawnRandomly(); }}
          onRespawnAtBag={(bagId) => { console.log("Respawn At Bag Clicked:", bagId); connection?.reducers?.respawnAtSleepingBag(bagId); }}
          localPlayerIdentity={localPlayerId}
          sleepingBags={sleepingBagsById} // Pass converted map
          // Pass other required props for minimap rendering within death screen
          players={players}
          trees={trees}
          stones={stones}
          playerPin={localPlayerPin}
          sleepingBagImage={itemImagesRef.current?.get('sleeping_bag.png')}
        />
      )}

      <canvas
        ref={canvasRef}
        id="game-canvas"
        width={canvasSize.width}
        height={canvasSize.height}
        style={{ cursor: cursorStyle }}
        onContextMenu={(e) => {
            if (placementInfo) {
                 e.preventDefault();
            }
        }}
      />
    </>
  );
};

export default React.memo(GameCanvas);