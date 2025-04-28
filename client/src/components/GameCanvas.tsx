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
  Corn as SpacetimeDBCorn
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
import { usePlayerActions } from '../contexts/PlayerActionsContext';

// --- Rendering Utilities ---
import { renderWorldBackground } from '../utils/worldRenderingUtils';
import { renderGroundEntities, renderYSortedEntities } from '../utils/renderingUtils';
import { renderInteractionLabels } from '../utils/labelRenderingUtils';
import { renderPlacementPreview } from '../utils/placementRenderingUtils';
import { drawInteractionIndicator } from '../utils/interactionIndicator';
import { drawMinimapOntoCanvas } from './Minimap';

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
import {
    isPlayer, isWoodenStorageBox, isTree, isStone, isCampfire, isMushroom, isDroppedItem, isCorn
} from '../utils/typeGuards';

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
  const respawnTimestampMs = useMemo(() => {
    if (localPlayer?.isDead && localPlayer.respawnAt) {
      return Number(localPlayer.respawnAt.microsSinceUnixEpoch / 1000n);
    }
    return 0;
  }, [localPlayer?.isDead, localPlayer?.respawnAt]);

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
  const shouldShowDeathScreen = !!(localPlayer?.isDead && respawnTimestampMs > 0 && connection);
  
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
  }, [itemDefinitions]);

  // --- Viewport Calculation ---
  const getViewportBounds = useCallback(() => {
    const buffer = gameConfig.tileSize * 2;
    const viewMinX = -cameraOffsetX - buffer;
    const viewMaxX = -cameraOffsetX + canvasSize.width + buffer;
    const viewMinY = -cameraOffsetY - buffer;
    const viewMaxY = -cameraOffsetY + canvasSize.height + buffer;
    return { viewMinX, viewMaxX, viewMinY, viewMaxY };
  }, [cameraOffsetX, cameraOffsetY, canvasSize.width, canvasSize.height]);

  // --- Entity Filtering ---
  const isEntityInView = useCallback((entity: any, bounds: { viewMinX: number, viewMaxX: number, viewMinY: number, viewMaxY: number }) => {
    let x: number | undefined;
    let y: number | undefined;
    let width: number = gameConfig.tileSize;
    let height: number = gameConfig.tileSize;

    if (isPlayer(entity)) {
        x = entity.positionX;
        y = entity.positionY;
        width = 64; // Approx player size
        height = 64;
    } else if (isTree(entity)) {
        x = entity.posX;
        y = entity.posY;
        width = 96; // Approx tree size
        height = 128;
    } else if (isStone(entity)) {
        x = entity.posX;
        y = entity.posY;
        width = 64;
        height = 64;
    } else if (isCampfire(entity)) {
        x = entity.posX;
        y = entity.posY;
        width = 64;
        height = 64;
    } else if (isMushroom(entity)) {
        x = entity.posX;
        y = entity.posY;
        width = 32;
        height = 32;
    } else if (isCorn(entity)) {
        x = entity.posX;
        y = entity.posY;
        width = 32;
        height = 48; // Corn is a bit taller than mushrooms
    } else if (isDroppedItem(entity)) {
        x = entity.posX;
        y = entity.posY;
        width = 32;
        height = 32;
    } else if (isWoodenStorageBox(entity)) {
        x = entity.posX;
        y = entity.posY;
        width = 64;
        height = 64;
    } else {
        return false; // Unknown entity type
    }

    if (x === undefined || y === undefined) return false;

    // AABB overlap check
    return (
        x + width / 2 > bounds.viewMinX &&
        x - width / 2 < bounds.viewMaxX &&
        y + height / 2 > bounds.viewMinY &&
        y - height / 2 < bounds.viewMaxY
    );
  }, []);

  // --- Memoized Filtered Entities ---
  const viewBounds = useMemo(() => getViewportBounds(), [getViewportBounds]);

  const visibleMushrooms = useMemo(() => 
    Array.from(mushrooms.values())
      .filter(e => (e.respawnAt === null || e.respawnAt === undefined) && isEntityInView(e, viewBounds))
      .map(mushroom => ({...mushroom, __entityType: 'mushroom' as const})),
    [mushrooms, isEntityInView, viewBounds]
  );
  
  const visibleCorns = useMemo(() => 
    Array.from(corns.values())
      .filter(e => (e.respawnAt === null || e.respawnAt === undefined) && isEntityInView(e, viewBounds))
      .map(corn => ({...corn, __entityType: 'corn' as const})),
    [corns, isEntityInView, viewBounds]
  );
  
  const visibleDroppedItems = useMemo(() => 
    Array.from(droppedItems.values()).filter(e => isEntityInView(e, viewBounds)),
    [droppedItems, isEntityInView, viewBounds]
  );
  const visibleCampfires = useMemo(() => 
    Array.from(campfires.values()).filter(e => isEntityInView(e, viewBounds)),
    [campfires, isEntityInView, viewBounds]
  );
  const visibleTrees = useMemo(() => 
    Array.from(trees.values()).filter(e => e.health > 0 && isEntityInView(e, viewBounds)),
    [trees, isEntityInView, viewBounds]
  );
  const visibleStones = useMemo(() => 
    Array.from(stones.values()).filter(e => e.health > 0 && isEntityInView(e, viewBounds)),
    [stones, isEntityInView, viewBounds]
  );
  const visibleWoodenStorageBoxes = useMemo(() => 
    Array.from(woodenStorageBoxes.values()).filter(e => isEntityInView(e, viewBounds)),
    [woodenStorageBoxes, isEntityInView, viewBounds]
  );
  const visiblePlayers = useMemo(() => 
    Array.from(players.values()).filter(p => !p.isDead && isEntityInView(p, viewBounds)),
    [players, isEntityInView, viewBounds]
  );

  // Filtered Maps (dependent on filtered arrays)
  const visibleMushroomsMap = useMemo(() => new Map(visibleMushrooms.map(m => [m.id.toString(), m])), [visibleMushrooms]);
  const visibleCornsMap = useMemo(() => new Map(visibleCorns.map(c => [c.id.toString(), c])), [visibleCorns]);
  const visibleCampfiresMap = useMemo(() => new Map(visibleCampfires.map(c => [c.id.toString(), c])), [visibleCampfires]);
  const visibleDroppedItemsMap = useMemo(() => new Map(visibleDroppedItems.map(i => [i.id.toString(), i])), [visibleDroppedItems]);
  const visibleBoxesMap = useMemo(() => new Map(visibleWoodenStorageBoxes.map(b => [b.id.toString(), b])), [visibleWoodenStorageBoxes]);

  // Memoized list for ground items
  const groundItems = useMemo(() => [
    ...visibleMushrooms,
    ...visibleCorns,
    ...visibleDroppedItems,
    ...visibleCampfires
  ], [visibleMushrooms, visibleCorns, visibleDroppedItems, visibleCampfires]);
  

  // Memoized and sorted list for Y-sorted entities
  const ySortedEntities = useMemo(() => {
    const entities = [
        ...visiblePlayers,
        ...visibleTrees,
        ...visibleStones,
        ...visibleWoodenStorageBoxes
    ];
    entities.sort((a, b) => {
        const yA = isPlayer(a) ? a.positionY : (isWoodenStorageBox(a) ? a.posY : a.posY);
        const yB = isPlayer(b) ? b.positionY : (isWoodenStorageBox(b) ? b.posY : b.posY);
        return yA - yB;
    });
    return entities;
  }, [visiblePlayers, visibleTrees, visibleStones, visibleWoodenStorageBoxes]);

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

    // Pass filtered lists to rendering functions
    renderGroundEntities({ ctx, groundItems: groundItems as any, itemDefinitions, itemImagesRef, nowMs: now_ms });
    renderYSortedEntities({
        ctx, ySortedEntities, heroImageRef, lastPositionsRef,
        activeConnections,
        activeEquipments,
        itemDefinitions, itemImagesRef, worldMouseX: currentWorldMouseX, worldMouseY: currentWorldMouseY,
        animationFrame, nowMs: now_ms, hoveredPlayerIds, onPlayerHover: handlePlayerHover
    });

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

    // Iterate through visible entities for indicators
    visibleCampfires.forEach((fire) => { 
      drawIndicatorIfNeeded('campfire', fire.id, fire.posX, fire.posY, CAMPFIRE_HEIGHT, true); 
    });
    
    visibleWoodenStorageBoxes.forEach((box) => { 
      if (interactionProgress && interactionProgress.targetId === box.id && isClosestInteractableBoxEmpty) { 
        drawIndicatorIfNeeded('wooden_storage_box', box.id, box.posX, box.posY, BOX_HEIGHT, true); 
      } 
    });

    // Campfire Lights - Only draw for visible campfires
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    visibleCampfires.forEach((fire) => {
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
        drawMinimapOntoCanvas({ 
            ctx: ctx!, // Use non-null assertion if context is guaranteed here
            players, 
            trees, 
            stones, 
            localPlayer, // Pass localPlayer directly
            localPlayerId,
            viewCenterOffset, // Pass pan offset
            playerPin: localPlayerPin, // Pass pin data
            canvasWidth: currentCanvasWidth, 
            canvasHeight: currentCanvasHeight, 
            isMouseOverMinimap, // Pass hover state
            zoomLevel: minimapZoom // Pass zoom level
        });
    }
  }, [
      // Dependencies
      getViewportBounds, isEntityInView,
      groundItems, ySortedEntities, visibleMushroomsMap, visibleCornsMap, visibleCampfiresMap, visibleDroppedItemsMap, visibleBoxesMap,
      visibleCampfires, visibleWoodenStorageBoxes, // Added for indicators and lights
      players, itemDefinitions, trees, stones, 
      worldState, localPlayerId, localPlayer, activeEquipments, localPlayerPin, viewCenterOffset, // Add viewCenterOffset dependency
      itemImagesRef, heroImageRef, grassImageRef, cameraOffsetX, cameraOffsetY,
      canvasSize.width, canvasSize.height, worldMousePos.x, worldMousePos.y,
      animationFrame, placementInfo, placementError, overlayRgba, maskCanvasRef,
      closestInteractableMushroomId, closestInteractableCornId, closestInteractableCampfireId,
      closestInteractableDroppedItemId, closestInteractableBoxId, isClosestInteractableBoxEmpty,
      interactionProgress, hoveredPlayerIds, handlePlayerHover, messages,
      isMinimapOpen, isMouseOverMinimap, minimapZoom, // Added zoom state dependency
      activeConnections
  ]);

  const gameLoopCallback = useCallback(() => {
    processInputsAndActions();
    renderGame();
  }, [processInputsAndActions, renderGame]);
  useGameLoop(gameLoopCallback);

  return (
    <>
      {shouldShowDeathScreen && (
        <DeathScreen
          respawnAt={respawnTimestampMs}
          onRespawn={handleRespawnRequest}
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