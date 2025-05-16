import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ItemDefinition, InventoryItem, DbConnection, Campfire as SpacetimeDBCampfire, HotbarLocationData, EquipmentSlotType, Stash, Player } from '../generated';
import { Identity, Timestamp } from '@clockworklabs/spacetimedb-sdk';

// Import Custom Components
import DraggableItem from './DraggableItem';
import DroppableSlot from './DroppableSlot';

// Import shared types
import { PopulatedItem } from './InventoryUI';
import { DragSourceSlotInfo, DraggedItemInfo } from '../types/dragDropTypes';
import { PlacementItemInfo } from '../hooks/usePlacementManager';

// Style constants similar to PlayerUI
const UI_BG_COLOR = 'rgba(40, 40, 60, 0.85)';
const UI_BORDER_COLOR = '#a0a0c0';
const UI_SHADOW = '2px 2px 0px rgba(0,0,0,0.5)';
const UI_FONT_FAMILY = '"Press Start 2P", cursive';
const SLOT_SIZE = 60; // Size of each hotbar slot in pixels
const SLOT_MARGIN = 6;
const SELECTED_BORDER_COLOR = '#ffffff';
const CONSUMPTION_COOLDOWN_MICROS = 1_000_000; // 1 second, matches server
const CLIENT_ANIMATION_DURATION_MS = CONSUMPTION_COOLDOWN_MICROS / 1000; // Duration for client animation

// Update HotbarProps
interface HotbarProps {
  playerIdentity: Identity | null;
  localPlayer: Player | null;
  itemDefinitions: Map<string, ItemDefinition>;
  inventoryItems: Map<string, InventoryItem>;
  connection: DbConnection | null;
  onItemDragStart: (info: DraggedItemInfo) => void;
  onItemDrop: (targetSlotInfo: DragSourceSlotInfo | null) => void;
  draggedItemInfo: DraggedItemInfo | null;
  interactingWith: { type: string; id: number | bigint } | null;
  campfires: Map<string, SpacetimeDBCampfire>;
  stashes: Map<string, Stash>;
  startPlacement: (itemInfo: PlacementItemInfo) => void;
  cancelPlacement: () => void;
}

// --- Hotbar Component ---
const Hotbar: React.FC<HotbarProps> = ({
    playerIdentity,
    localPlayer,
    itemDefinitions,
    inventoryItems,
    connection,
    onItemDragStart,
    onItemDrop,
    interactingWith,
    stashes,
    startPlacement,
    cancelPlacement,
}) => {
  console.log('[Hotbar] Rendering. CLIENT_ANIMATION_DURATION_MS:', CLIENT_ANIMATION_DURATION_MS); // Added log
  const [selectedSlot, setSelectedSlot] = useState<number>(0);
  const [isVisualCooldownActive, setIsVisualCooldownActive] = useState<boolean>(false);
  const [visualCooldownStartTime, setVisualCooldownStartTime] = useState<number | null>(null);
  const [animationProgress, setAnimationProgress] = useState<number>(0);
  const visualCooldownTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const numSlots = 6;

  // Cleanup refs on unmount
  useEffect(() => {
    return () => {
      if (visualCooldownTimeoutRef.current) {
        clearTimeout(visualCooldownTimeoutRef.current);
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  // Dedicated effect for the cooldown animation progress
  useEffect(() => {
    if (isVisualCooldownActive && visualCooldownStartTime !== null) {
      console.log('[Hotbar Animation] Starting animation loop. visualCooldownStartTime:', visualCooldownStartTime); // Added log
      const animate = () => {
        if (visualCooldownStartTime === null) { // Guard against null startTime
            console.log('[Hotbar Animation] animate: visualCooldownStartTime is null, stopping.');
            if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
            setIsVisualCooldownActive(false);
            setAnimationProgress(0);
            return;
        }
        const elapsedTimeMs = Date.now() - visualCooldownStartTime;
        const currentProgress = Math.min(1, elapsedTimeMs / CLIENT_ANIMATION_DURATION_MS);
        console.log(`[Hotbar Animation] animate: elapsedTimeMs=${elapsedTimeMs}, currentProgress=${currentProgress.toFixed(3)}`); // Added log
        setAnimationProgress(currentProgress);

        if (currentProgress < 1) {
          animationFrameRef.current = requestAnimationFrame(animate);
        } else {
          // Animation finished
          console.log('[Hotbar Animation] Animation loop finished. Progress reached 1.'); // Added log
          setIsVisualCooldownActive(false);
          setVisualCooldownStartTime(null);
          setAnimationProgress(0); // Ensure progress is reset
        }
      };
      animationFrameRef.current = requestAnimationFrame(animate);
    } else {
      // Ensure animation stops if not active
      console.log('[Hotbar Animation] Effect: Cooldown not active or startTime is null. Cancelling animation frame if any.'); // Added log
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      if (animationProgress !== 0) { // Only set if it's not already 0 to avoid potential loop
        // setAnimationProgress(0); // Reset progress if cooldown becomes inactive -- This might be redundant if a new animation starts immediately
      }
    }

    return () => {
      console.log('[Hotbar Animation] Effect cleanup. Cancelling animation frame:', animationFrameRef.current); // Added log
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [isVisualCooldownActive, visualCooldownStartTime]);

  const findItemForSlot = useCallback((slotIndex: number): PopulatedItem | null => {
    if (!playerIdentity) return null;
    for (const itemInstance of inventoryItems.values()) {
      if (itemInstance.location.tag === 'Hotbar') {
        const hotbarData = itemInstance.location.value as HotbarLocationData;
        if (hotbarData.ownerId.isEqual(playerIdentity) && hotbarData.slotIndex === slotIndex) {
          const definition = itemDefinitions.get(itemInstance.itemDefId.toString());
          if (definition) {
              return { instance: itemInstance, definition };
          }
        }
      }
    }
    return null;
  }, [playerIdentity, inventoryItems, itemDefinitions]);

  const triggerClientCooldownAnimation = useCallback(() => {
    if (isVisualCooldownActive) {
      console.log('[Hotbar] triggerClientCooldownAnimation called, but visual cooldown is ALREADY ACTIVE. Ignoring call.');
      return; // Do not restart if already active
    }
    console.log('[Hotbar] triggerClientCooldownAnimation called. Setting visual cooldown active.'); // Modified log
    setIsVisualCooldownActive(true);
    setVisualCooldownStartTime(Date.now());
    setAnimationProgress(0); // Start progress from 0

    if (visualCooldownTimeoutRef.current) {
      clearTimeout(visualCooldownTimeoutRef.current);
    }
    visualCooldownTimeoutRef.current = setTimeout(() => {
      console.log('[Hotbar] Visual cooldown timeout in triggerClientCooldownAnimation completed. Resetting visual cooldown.'); // Modified log
      setIsVisualCooldownActive(false);
      setVisualCooldownStartTime(null);
      // setAnimationProgress(0); // Handled by useEffect or animation completion
    }, CLIENT_ANIMATION_DURATION_MS);
  }, [isVisualCooldownActive]); // Added isVisualCooldownActive to dependency array

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    const inventoryPanel = document.querySelector('.inventoryPanel');
    if (inventoryPanel) return;
    const keyNum = parseInt(event.key);
    if (!isNaN(keyNum) && keyNum >= 1 && keyNum <= numSlots) {
      const newSlotIndex = keyNum - 1;
      setSelectedSlot(newSlotIndex);
      const itemInNewSlot = findItemForSlot(newSlotIndex);
      if (!connection?.reducers) return;
      if (itemInNewSlot) {
          const categoryTag = itemInNewSlot.definition.category.tag;
          const instanceId = BigInt(itemInNewSlot.instance.instanceId);
          if (categoryTag === 'Consumable') {
              cancelPlacement();
              try {
                  connection.reducers.consumeItem(instanceId);
                  triggerClientCooldownAnimation();
              } catch (err) { console.error(`[Hotbar KeyDown] Error consuming item ${instanceId}:`, err); }
          } else if (categoryTag === 'Armor') {
              cancelPlacement();
              try { connection.reducers.equipArmorFromInventory(instanceId); } catch (err) { console.error("Error equipArmorFromInventory:", err); }
          } else if (categoryTag === 'Placeable') {
              const placementInfo: PlacementItemInfo = {
                  itemDefId: BigInt(itemInNewSlot.definition.id),
                  itemName: itemInNewSlot.definition.name,
                  iconAssetName: itemInNewSlot.definition.iconAssetName,
                  instanceId: BigInt(itemInNewSlot.instance.instanceId)
              };
              startPlacement(placementInfo);
              try { if (playerIdentity) connection.reducers.clearActiveItemReducer(playerIdentity); } catch (err) { console.error("Error clearActiveItemReducer:", err); }
          } else if (itemInNewSlot.definition.isEquippable) {
              cancelPlacement();
              try { connection.reducers.setActiveItemReducer(instanceId); } catch (err) { console.error("Error setActiveItemReducer:", err); }
          } else {
              cancelPlacement();
              try { if (playerIdentity) connection.reducers.clearActiveItemReducer(playerIdentity); } catch (err) { console.error("Error clearActiveItemReducer:", err); }
          }
      } else {
          cancelPlacement();
          try { if (playerIdentity) connection.reducers.clearActiveItemReducer(playerIdentity); } catch (err) { console.error("Error clearActiveItemReducer:", err); }
      }
    }
  }, [numSlots, findItemForSlot, connection, cancelPlacement, startPlacement, playerIdentity, triggerClientCooldownAnimation]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);

  const handleSlotClick = (index: number) => {
      setSelectedSlot(index);
      const clickedItem = findItemForSlot(index);
      if (!connection?.reducers) {
        if (!clickedItem && playerIdentity) {
             cancelPlacement();
             try { connection?.reducers.clearActiveItemReducer(playerIdentity); } catch (err) { console.error("Error clearActiveItemReducer:", err); }
         }
         return; 
      }
      if (!clickedItem) { 
        if (playerIdentity) {
            cancelPlacement();
            try { connection.reducers.clearActiveItemReducer(playerIdentity); } catch (err) { console.error("Error clearActiveItemReducer:", err); }
        }
        return;
      }
      const categoryTag = clickedItem.definition.category.tag;
      const instanceId = BigInt(clickedItem.instance.instanceId);
      if (categoryTag === 'Consumable') {
          cancelPlacement();
          try {
              connection.reducers.consumeItem(instanceId);
              triggerClientCooldownAnimation();
          } catch (err) { console.error(`Error consuming item ${instanceId}:`, err); }
      } else if (categoryTag === 'Armor') {
          cancelPlacement();
          try { connection.reducers.equipArmorFromInventory(instanceId); } catch (err) { console.error("Error equipArmorFromInventory:", err); }
      } else if (categoryTag === 'Placeable') {
          const placementInfo: PlacementItemInfo = {
              itemDefId: BigInt(clickedItem.definition.id),
              itemName: clickedItem.definition.name,
              iconAssetName: clickedItem.definition.iconAssetName,
              instanceId: BigInt(clickedItem.instance.instanceId)
          };
          startPlacement(placementInfo);
          try { if (playerIdentity) connection.reducers.clearActiveItemReducer(playerIdentity); } catch (err) { console.error("Error clearActiveItemReducer:", err); }
      } else if (clickedItem.definition.isEquippable) {
          cancelPlacement();
          try { connection.reducers.setActiveItemReducer(instanceId); } catch (err) { console.error("Error setActiveItemReducer:", err); }
      } else {
          cancelPlacement();
          try { if (playerIdentity) connection.reducers.clearActiveItemReducer(playerIdentity); } catch (err) { console.error("Error clearActiveItemReducer:", err); }
      }
  };

  const handleHotbarItemContextMenu = (event: React.MouseEvent<HTMLDivElement>, itemInfo: PopulatedItem) => {
      event.preventDefault();
      event.stopPropagation();
      if (itemInfo.instance.location.tag === 'Hotbar') {
        const hotbarData = itemInfo.instance.location.value as HotbarLocationData;
        console.log(`[Hotbar ContextMenu] Right-clicked on: ${itemInfo.definition.name} in slot ${hotbarData.slotIndex}`);
      } else {
        console.log(`[Hotbar ContextMenu] Right-clicked on: ${itemInfo.definition.name} (not in hotbar)`);
      }

      if (!connection?.reducers) return;
      const itemInstanceId = BigInt(itemInfo.instance.instanceId);

      if (interactingWith?.type === 'wooden_storage_box') {
          const boxIdNum = Number(interactingWith.id);
          try {
              connection.reducers.quickMoveToBox(boxIdNum, itemInstanceId);
          } catch (error: any) {
              console.error("[Hotbar ContextMenu Hotbar->Box] Failed to call quickMoveToBox reducer:", error);
          }
          return;
      } 
      else if (interactingWith?.type === 'campfire') {
          const campfireIdNum = Number(interactingWith.id);
           try {
               connection.reducers.quickMoveToCampfire(campfireIdNum, itemInstanceId);
           } catch (error: any) {
               console.error("[Hotbar ContextMenu Hotbar->Campfire] Failed to call quickMoveToCampfire reducer:", error);
           }
           return;
      } 
      else if (interactingWith?.type === 'player_corpse') {
           const corpseId = Number(interactingWith.id);
           try {
               connection.reducers.quickMoveToCorpse(corpseId, itemInstanceId);
           } catch (error: any) {
               console.error("[Hotbar ContextMenu Hotbar->Corpse] Failed to call quickMoveToCorpse reducer:", error);
           }
           return;
      } else if (interactingWith?.type === 'stash') {
          const stashId = Number(interactingWith.id);
          const currentStash = stashes.get(interactingWith.id.toString());
          if (currentStash && !currentStash.isHidden) {
            try {
                connection.reducers.quickMoveToStash(stashId, itemInstanceId);
            } catch (error: any) {
                console.error("[Hotbar ContextMenu Hotbar->Stash] Failed to call quickMoveToStash reducer:", error);
            }
          } else {
            console.log(`[Hotbar ContextMenu Hotbar->Stash] Stash ${stashId} is hidden or not found. Cannot quick move.`);
          }
          return;
      }
      else {
          const isArmor = itemInfo.definition.category.tag === 'Armor';
          const hasEquipSlot = itemInfo.definition.equipmentSlotType !== null && itemInfo.definition.equipmentSlotType !== undefined;
          
          if (isArmor && hasEquipSlot) {
               try {
                   connection.reducers.equipArmorFromInventory(itemInstanceId);
               } catch (error: any) {
                   console.error("[Hotbar ContextMenu Equip] Failed to call equipArmorFromInventory reducer:", error);
              }
              return;
          }
      }
  };

  console.log('[Hotbar] Render: animationProgress state:', animationProgress.toFixed(3)); // Added log
  return (
    <div style={{
      position: 'fixed',
      bottom: '15px',
      left: '50%',
      transform: 'translateX(-50%)',
      display: 'flex',
      backgroundColor: UI_BG_COLOR,
      padding: `${SLOT_MARGIN}px`,
      borderRadius: '4px',
      border: `1px solid ${UI_BORDER_COLOR}`,
      boxShadow: UI_SHADOW,
      fontFamily: UI_FONT_FAMILY,
      zIndex: 100,
    }}>
      {Array.from({ length: numSlots }).map((_, index) => {
        const populatedItem = findItemForSlot(index);
        const currentSlotInfo: DragSourceSlotInfo = { type: 'hotbar', index: index };

        return (
          <DroppableSlot
            key={`hotbar-${index}`}
            slotInfo={currentSlotInfo}
            onItemDrop={onItemDrop}
            className={undefined}
            onClick={() => handleSlotClick(index)}
            style={{
                position: 'relative',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                width: `${SLOT_SIZE}px`,
                height: `${SLOT_SIZE}px`,
                border: `2px solid ${index === selectedSlot ? SELECTED_BORDER_COLOR : UI_BORDER_COLOR}`,
                backgroundColor: 'rgba(0, 0, 0, 0.3)',
                borderRadius: '3px',
                marginLeft: index > 0 ? `${SLOT_MARGIN}px` : '0px',
                transition: 'border-color 0.1s ease-in-out',
                boxSizing: 'border-box',
                cursor: 'pointer',
            }}
            isDraggingOver={false}
          >
            <span
                style={{ position: 'absolute', bottom: '2px', right: '4px', fontSize: '10px', color: 'rgba(255, 255, 255, 0.7)', userSelect: 'none', pointerEvents: 'none', zIndex: 3 }}
            >
              {index + 1}
            </span>

            {populatedItem && (
                <DraggableItem
                    item={populatedItem}
                    sourceSlot={currentSlotInfo}
                    onItemDragStart={onItemDragStart}
                    onItemDrop={onItemDrop}
                    onContextMenu={(event) => handleHotbarItemContextMenu(event, populatedItem)}
                 />
            )}
            {/* Cooldown Overlay - Robust Animation Logic */}
            {populatedItem && populatedItem.definition.category.tag === 'Consumable' && isVisualCooldownActive && (
                <div style={{
                  position: 'absolute',
                  bottom: '0px',
                  left: '0px',
                  width: '100%',
                  height: `${animationProgress * 100}%`,
                  backgroundColor: 'rgba(0, 0, 0, 0.65)',
                  borderRadius: '2px',
                  zIndex: 2,
                  pointerEvents: 'none',
                  // transition: 'height 0.05s linear', // REMOVED: CSS transition conflicts with requestAnimationFrame
                }}></div>
            )}
          </DroppableSlot>
        );
      })}
    </div>
  );
};

export default React.memo(Hotbar);