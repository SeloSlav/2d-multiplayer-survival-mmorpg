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
const DEFAULT_CLIENT_ANIMATION_DURATION_MS = CONSUMPTION_COOLDOWN_MICROS / 1000; // Duration for client animation
const BANDAGE_CLIENT_ANIMATION_DURATION_MS = 5000; // 5 seconds for bandage visual cooldown

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
  // console.log('[Hotbar] Rendering. CLIENT_ANIMATION_DURATION_MS:', CLIENT_ANIMATION_DURATION_MS); // Added log
  const [selectedSlot, setSelectedSlot] = useState<number>(0);
  const [isVisualCooldownActive, setIsVisualCooldownActive] = useState<boolean>(false);
  const [visualCooldownStartTime, setVisualCooldownStartTime] = useState<number | null>(null);
  const [animationProgress, setAnimationProgress] = useState<number>(0);
  const visualCooldownTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const numSlots = 6;
  const prevLastConsumedAtRef = useRef<bigint | null>(null);

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

  // Find item for slot - MOVED UP (and should be before animation useEffect)
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

  // useEffect for the cooldown animation progress - MOVED AFTER findItemForSlot
  useEffect(() => {
    if (isVisualCooldownActive && visualCooldownStartTime !== null) {
      const selectedItemForAnim = findItemForSlot(selectedSlot);
      const animationDuration = selectedItemForAnim && selectedItemForAnim.definition.name === "Bandage" 
                                ? BANDAGE_CLIENT_ANIMATION_DURATION_MS 
                                : DEFAULT_CLIENT_ANIMATION_DURATION_MS;
      
      const animate = () => {
        if (visualCooldownStartTime === null) { 
            if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
            setIsVisualCooldownActive(false);
            setAnimationProgress(0);
            return;
        }
        const elapsedTimeMs = Date.now() - visualCooldownStartTime;
        const currentProgress = Math.min(1, elapsedTimeMs / animationDuration); 
        setAnimationProgress(currentProgress);

        if (currentProgress < 1) {
          animationFrameRef.current = requestAnimationFrame(animate);
        } else {
          setIsVisualCooldownActive(false);
          setVisualCooldownStartTime(null);
          setAnimationProgress(0); 
        }
      };
      animationFrameRef.current = requestAnimationFrame(animate);
    } else {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [isVisualCooldownActive, visualCooldownStartTime, selectedSlot, findItemForSlot]); // findItemForSlot is now defined

  // Trigger client cooldown animation - MOVED UP (already done, but ensure it's before the lastConsumedAt useEffect)
  const triggerClientCooldownAnimation = useCallback(() => {
    if (isVisualCooldownActive) {
      // console.log('[Hotbar] triggerClientCooldownAnimation called, but visual cooldown is ALREADY ACTIVE. Ignoring call.');
      return; 
    }
    // console.log('[Hotbar] triggerClientCooldownAnimation called. Setting visual cooldown active.');
    setIsVisualCooldownActive(true);
    setVisualCooldownStartTime(Date.now());
    setAnimationProgress(0); 

    if (visualCooldownTimeoutRef.current) {
      clearTimeout(visualCooldownTimeoutRef.current);
    }

    const selectedItemForTimeout = findItemForSlot(selectedSlot);
    const timeoutDuration = selectedItemForTimeout && selectedItemForTimeout.definition.name === "Bandage"
                            ? BANDAGE_CLIENT_ANIMATION_DURATION_MS
                            : DEFAULT_CLIENT_ANIMATION_DURATION_MS;

    visualCooldownTimeoutRef.current = setTimeout(() => {
      // console.log('[Hotbar] Visual cooldown timeout in triggerClientCooldownAnimation completed. Resetting visual cooldown.');
      setIsVisualCooldownActive(false);
      setVisualCooldownStartTime(null);
    }, timeoutDuration); // Use item-specific duration for the timeout as well
  }, [isVisualCooldownActive, selectedSlot, findItemForSlot]); // Added selectedSlot and findItemForSlot

  // Effect to trigger cooldown animation for Bandage when lastConsumedAt updates
  useEffect(() => {
    if (localPlayer && localPlayer.lastConsumedAt) { // Corrected field name
        const currentLastConsumedMicros = localPlayer.lastConsumedAt.microsSinceUnixEpoch; // Get bigint value
        const prevLastConsumedMicros = prevLastConsumedAtRef.current;

        // Check if it has actually changed and is more recent
        if (prevLastConsumedMicros === null || (currentLastConsumedMicros > prevLastConsumedMicros)) {
            const selectedItem = findItemForSlot(selectedSlot);
            if (selectedItem && selectedItem.definition.name === "Bandage") {
                console.log("[Hotbar] Bandage consumption detected via lastConsumedAt update. Triggering cooldown.");
                triggerClientCooldownAnimation();
            }
        }
        prevLastConsumedAtRef.current = currentLastConsumedMicros; // Update ref for next comparison
    }
  }, [localPlayer?.lastConsumedAt, selectedSlot, findItemForSlot, triggerClientCooldownAnimation]); // Corrected field name in dependency

  const activateHotbarSlot = useCallback((slotIndex: number, isMouseWheelScroll: boolean = false) => {
    const itemInSlot = findItemForSlot(slotIndex);
    if (!connection?.reducers) {
      if (!itemInSlot && playerIdentity) {
        cancelPlacement();
        try { connection?.reducers.clearActiveItemReducer(playerIdentity); } catch (err) { console.error("Error clearActiveItemReducer:", err); }
      }
      return;
    }

    if (!itemInSlot) {
      if (playerIdentity) {
        cancelPlacement();
        try { connection.reducers.clearActiveItemReducer(playerIdentity); } catch (err) { console.error("Error clearActiveItemReducer:", err); }
      }
      return;
    }

    const categoryTag = itemInSlot.definition.category.tag;
    const instanceId = BigInt(itemInSlot.instance.instanceId);

    if (categoryTag === 'Consumable') {
      cancelPlacement(); // Always cancel placement if activating a consumable slot
      // Always clear any active item when selecting a consumable
      if (playerIdentity) {
        try { connection.reducers.clearActiveItemReducer(playerIdentity); } catch (err) { console.error("Error clearActiveItemReducer when selecting consumable:", err); }
      }

      if (!isMouseWheelScroll) { // Only consume if not a mouse wheel scroll
        try {
          connection.reducers.consumeItem(instanceId);
          triggerClientCooldownAnimation();
        } catch (err) { console.error(`Error consuming item ${instanceId}:`, err); }
      }
      // If it is a mouse wheel scroll, the item is selected, but not consumed.
      // The rest of the logic in this function will determine if any other active item needs clearing.
    } else if (categoryTag === 'Armor') {
      cancelPlacement();
      try { connection.reducers.equipArmorFromInventory(instanceId); } catch (err) { console.error("Error equipArmorFromInventory:", err); }
    } else if (categoryTag === 'Placeable') {
      const placementInfoData: PlacementItemInfo = {
        itemDefId: BigInt(itemInSlot.definition.id),
        itemName: itemInSlot.definition.name,
        iconAssetName: itemInSlot.definition.iconAssetName,
        instanceId: BigInt(itemInSlot.instance.instanceId)
      };
      startPlacement(placementInfoData);
      // It's generally good practice to clear active item if starting placement,
      // unless the placement system specifically relies on it being active.
      // For now, let's assume placement implies it's the "active" intent.
      // If you still want to explicitly clear:
      // try { if (playerIdentity) connection.reducers.clearActiveItemReducer(playerIdentity); } catch (err) { console.error("Error clearActiveItemReducer:", err); }
    } else if (itemInSlot.definition.isEquippable) {
      cancelPlacement();
      try { connection.reducers.setActiveItemReducer(instanceId); } catch (err) { console.error("Error setActiveItemReducer:", err); }
    } else {
      // If item is not consumable, armor, placeable, or equippable,
      // it implies it's not directly "activatable" by selecting its hotbar slot.
      // Default behavior might be to clear any previously active item.
      cancelPlacement();
      try { if (playerIdentity) connection.reducers.clearActiveItemReducer(playerIdentity); } catch (err) { console.error("Error clearActiveItemReducer:", err); }
    }
  }, [findItemForSlot, connection, playerIdentity, cancelPlacement, startPlacement, triggerClientCooldownAnimation]);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    const inventoryPanel = document.querySelector('.inventoryPanel');
    if (inventoryPanel) return;

    // Use event.code to reliably detect number keys regardless of Shift state
    let keyNum = -1;
    if (event.code.startsWith('Digit')) {
      keyNum = parseInt(event.code.substring(5)); // "Digit1" -> 1
    } else if (event.code.startsWith('Numpad')) {
      keyNum = parseInt(event.code.substring(6)); // "Numpad1" -> 1
    }

    if (keyNum !== -1 && keyNum >= 1 && keyNum <= numSlots) {
      const newSlotIndex = keyNum - 1;
      setSelectedSlot(newSlotIndex);
      activateHotbarSlot(newSlotIndex);
    }
  }, [numSlots, activateHotbarSlot]); // Updated dependencies

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);

  const handleSlotClick = (index: number) => {
      setSelectedSlot(index);
      activateHotbarSlot(index);
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

  // console.log('[Hotbar] Render: animationProgress state:', animationProgress.toFixed(3)); // Added log

  // Added handleWheel and updated useEffect for listeners
  const handleWheel = useCallback((event: WheelEvent) => {
    const inventoryPanel = document.querySelector('[data-id="inventory-panel"]'); // Use the data-id selector
    
    // If inventory is open, or chat input is focused, or other UI elements that might use wheel scroll, do nothing.
    const chatInputIsFocused = document.activeElement?.matches('[data-is-chat-input="true"]');
    const craftSearchIsFocused = document.activeElement?.id === 'craftSearchInput'; // Example ID

    if (inventoryPanel || chatInputIsFocused || craftSearchIsFocused || event.deltaY === 0) {
      return; // Don't interfere if inventory/chat/search is open, or no vertical scroll
    }

    event.preventDefault(); // Prevent page scrolling (only if inventory is NOT open)

    setSelectedSlot(prevSlot => {
      let newSlot;
      if (event.deltaY < 0) { // Scroll up
        newSlot = (prevSlot - 1 + numSlots) % numSlots;
      } else { // Scroll down
        newSlot = (prevSlot + 1) % numSlots;
      }
      activateHotbarSlot(newSlot, true); // Activate the item in the new slot, pass true for isMouseWheelScroll
      return newSlot;
    });
  }, [numSlots, activateHotbarSlot]); // activateHotbarSlot is a dependency

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('wheel', handleWheel, { passive: false }); // Add wheel listener, not passive
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('wheel', handleWheel);
    };
  }, [handleKeyDown, handleWheel]); // Add handleWheel to dependencies

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
            {/* Cooldown Overlay - Show if active and selected slot is Consumable or Bandage */}
            {isVisualCooldownActive && populatedItem && selectedSlot === index && 
             (populatedItem.definition.category.tag === 'Consumable' || populatedItem.definition.name === 'Bandage') && (
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