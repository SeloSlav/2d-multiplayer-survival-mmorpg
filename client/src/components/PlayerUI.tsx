import React, { useState, useEffect, useCallback } from 'react';
import { Player, InventoryItem, ItemDefinition, DbConnection, ActiveEquipment, Campfire as SpacetimeDBCampfire, WoodenStorageBox as SpacetimeDBWoodenStorageBox, Recipe, CraftingQueueItem, PlayerCorpse } from '../generated';
import { Identity } from '@clockworklabs/spacetimedb-sdk';
import InventoryUI, { PopulatedItem } from './InventoryUI';
import Hotbar from './Hotbar';
import { itemIcons } from '../utils/itemIconUtils';
// Import drag/drop types from shared file
import { DragSourceSlotInfo, DraggedItemInfo } from '../types/dragDropTypes';
// NEW: Import placement types
import { PlacementItemInfo, PlacementState, PlacementActions } from '../hooks/usePlacementManager';
import { InteractionTarget } from '../hooks/useInteractionManager';

// Define the StatusBar component inline for simplicity
interface StatusBarProps {
  label: string;
  icon: string; // Placeholder for icon, e.g., emoji or text
  value: number;
  maxValue: number;
  barColor: string;
}

const StatusBar: React.FC<StatusBarProps> = ({ label, icon, value, maxValue, barColor }) => {
  const percentage = Math.max(0, Math.min(100, (value / maxValue) * 100));

  return (
    <div style={{ marginBottom: '4px', display: 'flex', alignItems: 'center' }}>
      <span style={{ marginRight: '5px', minWidth: '18px', textAlign: 'center', fontSize: '14px' }}>{icon}</span>
      <div style={{ flexGrow: 1 }}>
        <div style={{
          height: '8px',
          backgroundColor: '#555',
          borderRadius: '2px',
          overflow: 'hidden',
          border: '1px solid #333',
        }}>
          <div style={{
            height: '100%',
            width: `${percentage}%`,
            backgroundColor: barColor,
          }}></div>
        </div>
      </div>
      <span style={{ marginLeft: '5px', fontSize: '10px', minWidth: '30px', textAlign: 'right' }}>
        {value.toFixed(0)}
      </span>
    </div>
  );
};

interface PlayerUIProps {
  identity: Identity | null;
  players: Map<string, Player>;
  inventoryItems: Map<string, InventoryItem>;
  itemDefinitions: Map<string, ItemDefinition>;
  connection: DbConnection | null;
  onItemDragStart: (info: DraggedItemInfo) => void;
  onItemDrop: (targetSlotInfo: DragSourceSlotInfo | null) => void;
  draggedItemInfo: DraggedItemInfo | null;
  activeEquipments: Map<string, ActiveEquipment>;
  campfires: Map<string, SpacetimeDBCampfire>;
  onSetInteractingWith: (target: InteractionTarget) => void;
  interactingWith: InteractionTarget;
  startPlacement: (itemInfo: PlacementItemInfo) => void;
  cancelPlacement: () => void;
  placementInfo: PlacementItemInfo | null;
  currentStorageBox?: SpacetimeDBWoodenStorageBox | null;
  recipes: Map<string, Recipe>;
  craftingQueueItems: Map<string, CraftingQueueItem>;
  woodenStorageBoxes: Map<string, SpacetimeDBWoodenStorageBox>;
  playerCorpses: Map<string, PlayerCorpse>;
}

const PlayerUI: React.FC<PlayerUIProps> = ({
    identity,
    players,
    inventoryItems,
    itemDefinitions,
    connection,
    onItemDragStart,
    onItemDrop,
    draggedItemInfo,
    activeEquipments,
    campfires,
    onSetInteractingWith,
    interactingWith,
    startPlacement,
    cancelPlacement,
    placementInfo,
    currentStorageBox,
    recipes,
    craftingQueueItems,
    woodenStorageBoxes,
    playerCorpses
 }) => {
    const [localPlayer, setLocalPlayer] = useState<Player | null>(null);
    const [isInventoryOpen, setIsInventoryOpen] = useState(false);
    
    useEffect(() => {
        if (!identity) {
            setLocalPlayer(null);
            return;
        }
        const player = players.get(identity.toHexString());
        setLocalPlayer(player || null);
    }, [identity, players]);

    // Effect for inventory toggle keybind
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Tab') {
                event.preventDefault();
                // Toggle the inventory state
                const closingInventory = isInventoryOpen; // Check state BEFORE toggling
                setIsInventoryOpen(prev => !prev);
                // If closing, also clear the interaction target
                if (closingInventory) {
                     onSetInteractingWith(null);
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [isInventoryOpen, onSetInteractingWith]);

    // Effect to disable background scrolling when inventory is open
    useEffect(() => {
        const preventBackgroundScroll = (event: WheelEvent) => {
            const target = event.target as Element;

            // 1. Find the inventory panel itself
            const inventoryPanel = document.querySelector('.inventoryPanel'); // Use a more specific ID or ref if possible for reliability

            // 2. If the inventory panel doesn't exist, do nothing (shouldn't happen if listener is added correctly)
            if (!inventoryPanel) return;

            // 3. Check if the event target is *outside* the inventory panel entirely
            if (!inventoryPanel.contains(target)) {
                // If outside, prevent default (stops page scroll)
                // console.log("Scroll outside inventory, preventing.");
                event.preventDefault();
                return;
            }

            // 4. If inside the panel, check if it's within designated scrollable children
            const scrollableCrafting = target.closest('.craftableItemsSection');
            const scrollableQueue = target.closest('.craftingQueueList');

            // 5. If it IS within a designated scrollable child, allow the default behavior
            if (scrollableCrafting || scrollableQueue) {
                // console.log("Scroll inside designated scrollable area, allowing.");
                return; // Allow scroll within these areas
            }

            // 6. If it's inside the panel but *not* within a designated scrollable child, prevent default
            // console.log("Scroll inside inventory but outside scrollable areas, preventing.");
            event.preventDefault();
        };

        if (isInventoryOpen) {
            // Add the listener to the window
            window.addEventListener('wheel', preventBackgroundScroll, { passive: false });
            document.body.style.overflow = 'hidden'; // Hide body scrollbar
        } else {
            // Clean up listener and body style
            window.removeEventListener('wheel', preventBackgroundScroll);
            document.body.style.overflow = 'auto';
        }

        // Cleanup function
        return () => {
            window.removeEventListener('wheel', preventBackgroundScroll);
            document.body.style.overflow = 'auto';
        };
    }, [isInventoryOpen]);

    // --- Open Inventory when Interaction Starts --- 
    useEffect(() => {
        if (interactingWith) {
            setIsInventoryOpen(true);
        }
    }, [interactingWith]);

    // --- Handle Closing Inventory & Interaction --- 
    const handleClose = () => {
        setIsInventoryOpen(false);
        onSetInteractingWith(null); // Clear interaction state when closing
    };

    if (!localPlayer) {
        return null;
    }

    // --- Render without DndContext/Overlay ---
    return (
      // <DndContext...> // Remove wrapper
        <>
            {/* Status Bars UI */}
            <div style={{
                position: 'fixed',
                bottom: '15px',
                right: '15px',
                backgroundColor: 'rgba(40, 40, 60, 0.85)',
                color: 'white',
                padding: '10px',
                borderRadius: '4px',
                border: '1px solid #a0a0c0',
                fontFamily: '"Press Start 2P", cursive',
                minWidth: '200px',
                boxShadow: '2px 2px 0px rgba(0,0,0,0.5)',
                zIndex: 50, // Keep below inventory/overlay
            }}>
                {/* Status Bars mapping */}
                <StatusBar label="HP" icon="❤️" value={localPlayer.health} maxValue={100} barColor="#ff4040" />
                <StatusBar label="SP" icon="⚡" value={localPlayer.stamina} maxValue={100} barColor="#40ff40" />
                <StatusBar label="Thirst" icon="💧" value={localPlayer.thirst} maxValue={100} barColor="#40a0ff" />
                <StatusBar label="Hunger" icon="🍖" value={localPlayer.hunger} maxValue={100} barColor="#ffa040" />
                <StatusBar label="Warmth" icon="🔥" value={localPlayer.warmth} maxValue={100} barColor="#ffcc00" />
            </div>

            {/* Render Inventory UI conditionally - Pass props down */}
            {isInventoryOpen && (
                <InventoryUI
                    playerIdentity={identity}
                    onClose={handleClose}
                    inventoryItems={inventoryItems}
                    itemDefinitions={itemDefinitions}
                    connection={connection}
                    activeEquipments={activeEquipments}
                    onItemDragStart={onItemDragStart}
                    onItemDrop={onItemDrop}
                    draggedItemInfo={draggedItemInfo}
                    interactionTarget={interactingWith}
                    campfires={campfires}
                    startPlacement={startPlacement}
                    cancelPlacement={cancelPlacement}
                    placementInfo={placementInfo}
                    currentStorageBox={currentStorageBox}
                    recipes={recipes}
                    craftingQueueItems={craftingQueueItems}
                    woodenStorageBoxes={woodenStorageBoxes}
                    playerCorpses={playerCorpses}
                 />
             )}

            {/* Drag Overlay is removed - ghost handled by DraggableItem */}
       </>
      // </DndContext...> // Remove wrapper
    );
};

export default React.memo(PlayerUI);
