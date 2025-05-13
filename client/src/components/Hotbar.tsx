import React, { useState, useEffect, useCallback } from 'react';
import { ItemDefinition, InventoryItem, DbConnection, Campfire as SpacetimeDBCampfire, HotbarLocationData, EquipmentSlotType } from '../generated';
import { Identity } from '@clockworklabs/spacetimedb-sdk';

// Import Custom Components
import DraggableItem from './DraggableItem';
import DroppableSlot from './DroppableSlot';

// Import shared types
import { PopulatedItem } from './InventoryUI'; // Assuming PopulatedItem is exported from InventoryUI
import { DragSourceSlotInfo, DraggedItemInfo } from '../types/dragDropTypes'; // Updated import location
import { PlacementItemInfo } from '../hooks/usePlacementManager';

// Style constants similar to PlayerUI
const UI_BG_COLOR = 'rgba(40, 40, 60, 0.85)';
const UI_BORDER_COLOR = '#a0a0c0';
const UI_SHADOW = '2px 2px 0px rgba(0,0,0,0.5)';
const UI_FONT_FAMILY = '"Press Start 2P", cursive';
const SLOT_SIZE = 60; // Size of each hotbar slot in pixels
const SLOT_MARGIN = 6;
const SELECTED_BORDER_COLOR = '#ffffff';

// Update HotbarProps
interface HotbarProps {
  playerIdentity: Identity | null;
  itemDefinitions: Map<string, ItemDefinition>;
  inventoryItems: Map<string, InventoryItem>;
  connection: DbConnection | null;
  onItemDragStart: (info: DraggedItemInfo) => void;
  onItemDrop: (targetSlotInfo: DragSourceSlotInfo | null) => void;
  draggedItemInfo: DraggedItemInfo | null;
  interactingWith: { type: string; id: number | bigint } | null;
  campfires: Map<string, SpacetimeDBCampfire>;
  startPlacement: (itemInfo: PlacementItemInfo) => void;
  cancelPlacement: () => void;
}

// --- Hotbar Component ---
const Hotbar: React.FC<HotbarProps> = ({
    playerIdentity,
    itemDefinitions,
    inventoryItems,
    connection,
    onItemDragStart,
    onItemDrop,
    interactingWith,
    startPlacement,
    cancelPlacement,
}) => {
  // console.log("Hotbar Props:", { playerIdentity, itemDefinitions, inventoryItems }); // Log received props
  const [selectedSlot, setSelectedSlot] = useState<number>(0); // 0-indexed (0-5)
  const numSlots = 6;

  // Updated findItemForSlot to return PopulatedItem, wrapped in useCallback
  const findItemForSlot = useCallback((slotIndex: number): PopulatedItem | null => {
    if (!playerIdentity) return null;
    // Use props directly inside useCallback dependencies
    for (const itemInstance of inventoryItems.values()) { 
      // Check if the item is in a Hotbar location
      if (itemInstance.location.tag === 'Hotbar') {
        // Access the Hotbar-specific data using the imported type
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
  }, [playerIdentity, inventoryItems, itemDefinitions]); // Dependencies for useCallback

  // Define handleKeyDown with useCallback
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    const inventoryPanel = document.querySelector('.inventoryPanel');
    if (inventoryPanel) return;
    const keyNum = parseInt(event.key);
    if (!isNaN(keyNum) && keyNum >= 1 && keyNum <= numSlots) {
      const newSlotIndex = keyNum - 1;
      setSelectedSlot(newSlotIndex); // Select the slot regardless of action

      const itemInNewSlot = findItemForSlot(newSlotIndex);
      if (!connection?.reducers) {
          console.warn("No connection/reducers for keydown action");
          return;
      }
      
      // --- Determine Action Based on Item in Slot --- 
      if (itemInNewSlot) {
          const categoryTag = itemInNewSlot.definition.category.tag;
          const name = itemInNewSlot.definition.name;
          const instanceId = BigInt(itemInNewSlot.instance.instanceId);

          if (categoryTag === 'Consumable') {
              // console.log(`Hotbar Key ${keyNum}: Consuming item instance ${instanceId} (${name})`);
              cancelPlacement(); // Cancel placement if consuming
              try {
                  connection.reducers.consumeItem(instanceId);
              } catch (err) { 
                  console.error(`[Hotbar KeyDown] Error consuming item ${instanceId}:`, err);
              }
              // No equip/unequip needed after consuming
          } else if (categoryTag === 'Armor') {
              // console.log(`Hotbar Key ${keyNum}: Equipping ARMOR instance ${instanceId} (${name})`);
              cancelPlacement();
              try { connection.reducers.equipArmorFromInventory(instanceId); } catch (err) { console.error("Error equipArmorFromInventory:", err); }
          } else if (categoryTag === 'Placeable') {
              // console.log(`Hotbar Key ${keyNum}: Starting placement for ${name}.`);
              const placementInfo: PlacementItemInfo = {
                  itemDefId: BigInt(itemInNewSlot.definition.id),
                  itemName: name,
                  iconAssetName: itemInNewSlot.definition.iconAssetName,
                  instanceId: BigInt(itemInNewSlot.instance.instanceId)
              };
              startPlacement(placementInfo);
              try { if (playerIdentity) connection.reducers.clearActiveItemReducer(playerIdentity); } catch (err) { console.error("Error clearActiveItemReducer:", err); }
          } else if (itemInNewSlot.definition.isEquippable) {
              // console.log(`Hotbar Key ${keyNum}: Equipping item instance ${instanceId} (${name})`);
              cancelPlacement();
              try { connection.reducers.setActiveItemReducer(instanceId); } catch (err) { console.error("Error setActiveItemReducer:", err); }
          } else {
              // Item exists but isn't consumable, armor, campfire, or equippable - treat as selecting non-actionable (unequip current)
              // console.log(`Hotbar Key ${keyNum}: Selected non-actionable item (${name}), unequipping.`);
              cancelPlacement();
              try { if (playerIdentity) connection.reducers.clearActiveItemReducer(playerIdentity); } catch (err) { console.error("Error clearActiveItemReducer:", err); }
          }
      } else {
          // Slot is empty - Unequip current item
          // console.log(`Hotbar Key ${keyNum}: Slot empty, unequipping.`);
          cancelPlacement();
          try { if (playerIdentity) connection.reducers.clearActiveItemReducer(playerIdentity); } catch (err) { console.error("Error clearActiveItemReducer:", err); }
      }
    }
  }, [numSlots, findItemForSlot, connection, cancelPlacement, startPlacement, playerIdentity]);

  // Effect for handling hotbar interaction (keyboard only now)
  useEffect(() => {
    // Add the memoized listener
    window.addEventListener('keydown', handleKeyDown);

    // Remove the memoized listener on cleanup
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
    // Only depend on the memoized handler function
  }, [handleKeyDown]);

  // --- Click Handler for Slots --- 
  const handleSlotClick = (index: number) => {
      setSelectedSlot(index);
      const clickedItem = findItemForSlot(index);
      if (!connection?.reducers || !clickedItem) { // Check for item early
         if (!clickedItem) {
             // console.log(`Hotbar Click: Slot ${index + 1} empty, unequipping.`);
             cancelPlacement(); // Cancel placement if slot empty
             try { if (playerIdentity) connection?.reducers.clearActiveItemReducer(playerIdentity); } catch (err) { console.error("Error clearActiveItemReducer:", err); }
         }
         return; 
      }

      // Check item category
      const categoryTag = clickedItem.definition.category.tag;
      const name = clickedItem.definition.name;
      const instanceId = BigInt(clickedItem.instance.instanceId);

      if (categoryTag === 'Consumable') {
          // console.log(`Hotbar Click: Consuming item instance ${instanceId} (${name}) in slot ${index + 1}`);
          cancelPlacement(); // Should not be placing and consuming
          try {
              connection.reducers.consumeItem(instanceId);
          } catch (err) {
              console.error(`Error consuming item ${instanceId}:`, err);
          }
      } else if (categoryTag === 'Armor') {
          // console.log(`Hotbar Click: Equipping ARMOR instance ${instanceId} (${name}) in slot ${index + 1}`);
          cancelPlacement();
          try { connection.reducers.equipArmorFromInventory(instanceId); } catch (err) { console.error("Error equipArmorFromInventory:", err); }
      } else if (categoryTag === 'Placeable') {
          // console.log(`Hotbar Click: Starting placement for ${name} (Slot ${index + 1}).`);
          const placementInfo: PlacementItemInfo = {
              itemDefId: BigInt(clickedItem.definition.id),
              itemName: name,
              iconAssetName: clickedItem.definition.iconAssetName,
              instanceId: BigInt(clickedItem.instance.instanceId)
          };
          startPlacement(placementInfo);
          try { if (playerIdentity) connection.reducers.clearActiveItemReducer(playerIdentity); } catch (err) { console.error("Error clearActiveItemReducer:", err); }
      } else if (clickedItem.definition.isEquippable) {
          // console.log(`Hotbar Click: Equipping item instance ${instanceId} (${name}) in slot ${index + 1}`);
          cancelPlacement();
          try { connection.reducers.setActiveItemReducer(instanceId); } catch (err) { console.error("Error setActiveItemReducer:", err); }
      } else {
          // Default: If not consumable, armor, campfire, or equippable, treat as selecting non-actionable item (unequip current hand item)
          // console.log(`Hotbar Click: Slot ${index + 1} contains non-actionable item (${name}), unequipping.`);
          cancelPlacement();
          try { if (playerIdentity) connection.reducers.clearActiveItemReducer(playerIdentity); } catch (err) { console.error("Error clearActiveItemReducer:", err); }
      }
  };

  // --- Context Menu Handler for Hotbar Items ---
  const handleHotbarItemContextMenu = (event: React.MouseEvent<HTMLDivElement>, itemInfo: PopulatedItem) => {
      event.preventDefault();
      event.stopPropagation();
      // console.log(`[Hotbar ContextMenu] Right-clicked on: ${itemInfo.definition.name} in slot ${itemInfo.instance.hotbarSlot}`);
      // Update to use location for slot identification if necessary, or remove if PopulatedItem now gets slot from findItemForSlot correctly
      // If itemInfo.instance.location.tag === 'Hotbar', then use itemInfo.instance.location.value.slot_index
      if (itemInfo.instance.location.tag === 'Hotbar') {
        const hotbarData = itemInfo.instance.location.value as HotbarLocationData;
        console.log(`[Hotbar ContextMenu] Right-clicked on: ${itemInfo.definition.name} in slot ${hotbarData.slotIndex}`);
      } else {
        console.log(`[Hotbar ContextMenu] Right-clicked on: ${itemInfo.definition.name} (not in hotbar)`);
      }

      if (!connection?.reducers) return;

      const itemInstanceId = BigInt(itemInfo.instance.instanceId);

      // --- REORDERED LOGIC: Prioritize Open Containers --- 

      // 1. Check if interacting with a storage box
      if (interactingWith?.type === 'wooden_storage_box') {
          const boxIdNum = Number(interactingWith.id); // Box ID is u32, safe to Number
          // console.log(`[Hotbar ContextMenu Hotbar->Box] Box ${boxIdNum} open. Calling quick_move_to_box for item ${itemInstanceId}`);
          try {
              connection.reducers.quickMoveToBox(boxIdNum, itemInstanceId);
          } catch (error: any) {
              console.error("[Hotbar ContextMenu Hotbar->Box] Failed to call quickMoveToBox reducer:", error);
              // TODO: Show user feedback? (e.g., "Box full")
          }
          return; // Action handled
      } 
      // 2. Else, check if interacting with campfire
      else if (interactingWith?.type === 'campfire') {
          const campfireIdNum = Number(interactingWith.id);
          // console.log(`[Hotbar ContextMenu Hotbar->Campfire] Campfire ${campfireIdNum} open. Calling quick_move_to_campfire for item ${itemInstanceId}`);
           try {
               connection.reducers.quickMoveToCampfire(campfireIdNum, itemInstanceId);
           } catch (error: any) {
               console.error("[Hotbar ContextMenu Hotbar->Campfire] Failed to call quickMoveToCampfire reducer:", error);
           }
           return; // Action handled
      } 
      // --- ADD THIS --- 
      else if (interactingWith?.type === 'player_corpse') {
           const corpseId = Number(interactingWith.id); // Assuming corpse ID fits in number
            // console.log(`[Hotbar ContextMenu Hotbar->Corpse] Corpse ${corpseId} open. Calling quickMoveToCorpse for item ${itemInstanceId}`);
           try {
               connection.reducers.quickMoveToCorpse(corpseId, itemInstanceId);
           } catch (error: any) {
               console.error("[Hotbar ContextMenu Hotbar->Corpse] Failed to call quickMoveToCorpse reducer:", error);
               // TODO: Show user feedback?
           }
           return; // Action handled
      }
      // --- END ADDITION ---
      // 3. Else (no container open), check if it's armor to equip
      else {
          const isArmor = itemInfo.definition.category.tag === 'Armor';
          const hasEquipSlot = itemInfo.definition.equipmentSlotType !== null && itemInfo.definition.equipmentSlotType !== undefined;
          
          if (isArmor && hasEquipSlot) {
              // console.log(`[Hotbar ContextMenu Equip] No container open. Item is Armor. Calling equip_armor for item ${itemInstanceId}`);
               try {
                   // Hotbar already has a specific equipArmor reducer call, let's keep it for now
                   connection.reducers.equipArmorFromInventory(itemInstanceId);
               } catch (error: any) {
                   console.error("[Hotbar ContextMenu Equip] Failed to call equipArmorFromInventory reducer:", error);
              }
              return; // Action handled
          }
      }

      // 4. Default: If not handled above, do nothing for now
      // console.log("[Hotbar ContextMenu] No specific interaction context or non-armor item. Default action (none).");
  };

  // console.log(`[Hotbar Render] selectedSlot is: ${selectedSlot}`);

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
      zIndex: 100, // Ensure hotbar can be dropped onto
    }}>
      {Array.from({ length: numSlots }).map((_, index) => {
        const populatedItem = findItemForSlot(index);
        const currentSlotInfo: DragSourceSlotInfo = { type: 'hotbar', index: index };

        return (
          <DroppableSlot
            key={`hotbar-${index}`}
            slotInfo={currentSlotInfo}
            onItemDrop={onItemDrop}
            // Use a generic slot style class if available, or rely on inline style
            className={undefined} // Example: styles.slot if imported
            onClick={() => handleSlotClick(index)}
            style={{ // Apply Hotbar specific layout/border styles here
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
            isDraggingOver={false} // TODO: Logic needed
          >
            {/* Slot Number */}
            <span
                style={{ position: 'absolute', bottom: '2px', right: '4px', fontSize: '10px', color: 'rgba(255, 255, 255, 0.7)', userSelect: 'none', pointerEvents: 'none'}}
            >
              {index + 1}
            </span>

            {/* Render Draggable Item if present */}
            {populatedItem && (
                <DraggableItem
                    item={populatedItem}
                    sourceSlot={currentSlotInfo}
                    onItemDragStart={onItemDragStart}
                    onItemDrop={onItemDrop}
                    // Pass the NEW hotbar-specific context menu handler
                    onContextMenu={(event) => handleHotbarItemContextMenu(event, populatedItem)}
                 />
            )}
          </DroppableSlot>
        );
      })}
    </div>
  );
};

export default React.memo(Hotbar); 