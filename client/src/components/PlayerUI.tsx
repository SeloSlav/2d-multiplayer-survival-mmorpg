import React, { useState, useEffect, useCallback } from 'react';
import { Player, InventoryItem, ItemDefinition, DbConnection, ActiveEquipment, Campfire as SpacetimeDBCampfire, WoodenStorageBox as SpacetimeDBWoodenStorageBox, Recipe, CraftingQueueItem, PlayerCorpse, StatThresholdsConfig, Stash as SpacetimeDBStash } from '../generated';
import { Identity } from '@clockworklabs/spacetimedb-sdk';
import InventoryUI, { PopulatedItem } from './InventoryUI';
import Hotbar from './Hotbar';
import { itemIcons } from '../utils/itemIconUtils';
// Import drag/drop types from shared file
import { DragSourceSlotInfo, DraggedItemInfo } from '../types/dragDropTypes';
// NEW: Import placement types
import { PlacementItemInfo, PlacementState, PlacementActions } from '../hooks/usePlacementManager';
import { InteractionTarget } from '../hooks/useInteractionManager';

// --- NEW IMPORTS ---
import { NotificationItem } from '../types/notifications';
import ItemAcquisitionNotificationUI from './ItemAcquisitionNotificationUI';
// --- END NEW IMPORTS ---

// Define the StatusBar component inline for simplicity
interface StatusBarProps {
  label: string;
  icon: string; // Placeholder for icon, e.g., emoji or text
  value: number;
  maxValue: number;
  barColor: string;
  glow?: boolean; // If true, show glow/pulse effect
}

// --- LOW NEED THRESHOLD (matches server logic for stat penalties/health loss) ---
// const LOW_NEED_THRESHOLD = 20.0; // If thirst/hunger/warmth < this, special effects kick in

const StatusBar: React.FC<StatusBarProps> = ({ label, icon, value, maxValue, barColor, glow }) => {
  const percentage = Math.max(0, Math.min(100, (value / maxValue) * 100));

  // Inline keyframes for pulse animation (self-contained)
  // Only inject once per page
  React.useEffect(() => {
    if (glow && !document.getElementById('status-bar-glow-keyframes')) {
      const style = document.createElement('style');
      style.id = 'status-bar-glow-keyframes';
      style.innerHTML = `
        @keyframes statusBarGlowPulse {
          0% { box-shadow: 0 0 8px 2px rgba(255,255,255,0.25), 0 0 0 0 ${barColor}; transform: scale(1); }
          50% { box-shadow: 0 0 16px 6px ${barColor}, 0 0 0 0 ${barColor}; transform: scale(1.04); }
          100% { box-shadow: 0 0 8px 2px rgba(255,255,255,0.25), 0 0 0 0 ${barColor}; transform: scale(1); }
        }
      `;
      document.head.appendChild(style);
    }
  }, [glow, barColor]);

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
            transition: 'box-shadow 0.2s, transform 0.2s',
            boxShadow: glow ? `0 0 16px 6px ${barColor}` : undefined,
            animation: glow ? 'statusBarGlowPulse 1.2s infinite' : undefined,
            zIndex: 1,
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
  stashes: Map<string, SpacetimeDBStash>;
  onCraftingSearchFocusChange?: (isFocused: boolean) => void;
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
    playerCorpses,
    stashes,
    onCraftingSearchFocusChange
 }) => {
    const [localPlayer, setLocalPlayer] = useState<Player | null>(null);
    const [isInventoryOpen, setIsInventoryOpen] = useState(false);
    const [lowNeedThreshold, setLowNeedThreshold] = useState<number>(20.0);
    // --- NEW STATE FOR NOTIFICATIONS ---
    const [acquisitionNotifications, setAcquisitionNotifications] = useState<NotificationItem[]>([]);
    const NOTIFICATION_DURATION = 3000; // ms
    const MAX_NOTIFICATIONS_DISPLAYED = 5;
    // --- END NEW STATE ---
    
    useEffect(() => {
        if (!identity) {
            setLocalPlayer(null);
            return;
        }
        const player = players.get(identity.toHexString());
        setLocalPlayer(player || null);
    }, [identity, players]);

    useEffect(() => {
        if (!connection) return;

        const handleStatThresholdsConfig = (config: StatThresholdsConfig | null | undefined) => {
            if (config && typeof config.lowNeedThreshold === 'number') {
                setLowNeedThreshold(config.lowNeedThreshold);
                console.log('StatThresholdsConfig: low_need_threshold set to', config.lowNeedThreshold);
            }
        };

        const configIterable = connection.db.statThresholdsConfig.iter();
        const initialConfigArray = Array.from(configIterable);
        const initialConfig = initialConfigArray.length > 0 ? initialConfigArray[0] : undefined;
        
        if (initialConfig) {
            handleStatThresholdsConfig(initialConfig);
        }

        const onInsertConfigCallback = (ctx: any, config: StatThresholdsConfig) => handleStatThresholdsConfig(config);
        const onUpdateConfigCallback = (ctx: any, oldConfig: StatThresholdsConfig, newConfig: StatThresholdsConfig) => handleStatThresholdsConfig(newConfig);
        const onDeleteConfigCallback = () => {
            console.warn('StatThresholdsConfig row deleted from server. Reverting to default low_need_threshold (20.0).');
            setLowNeedThreshold(20.0);
        };

        connection.db.statThresholdsConfig.onInsert(onInsertConfigCallback);
        connection.db.statThresholdsConfig.onUpdate(onUpdateConfigCallback);
        connection.db.statThresholdsConfig.onDelete(onDeleteConfigCallback);

        return () => {
            connection.db.statThresholdsConfig.removeOnInsert(onInsertConfigCallback);
            connection.db.statThresholdsConfig.removeOnUpdate(onUpdateConfigCallback);
            connection.db.statThresholdsConfig.removeOnDelete(onDeleteConfigCallback);
        };
    }, [connection]);

    // --- NEW: HELPER TO ADD ACQUISITION NOTIFICATIONS ---
    const addAcquisitionNotification = useCallback((itemDefId: bigint, quantityChange: number) => {
        if (!itemDefinitions || quantityChange <= 0) return;

        const def = itemDefinitions.get(itemDefId.toString());
        if (!def) {
            console.warn(`No item definition found for ID: ${itemDefId}`);
            return;
        }

        const newNotification: NotificationItem = {
            id: `${Date.now()}-${Math.random()}`, // Simple unique ID
            itemDefId: itemDefId,
            itemName: def.name,
            itemIcon: def.iconAssetName,
            quantityChange: quantityChange,
            timestamp: Date.now(),
        };

        setAcquisitionNotifications(prevNotifications => {
            const updatedNotifications = [...prevNotifications, newNotification];
            return updatedNotifications; 
        });

        setTimeout(() => {
            setAcquisitionNotifications(prev => prev.filter(n => n.id !== newNotification.id));
        }, NOTIFICATION_DURATION);

    }, [itemDefinitions]);
    // --- END NEW HELPER ---

    // --- NEW: EFFECT FOR INVENTORY ITEM CHANGES (ACQUISITION NOTIFICATIONS) ---
    useEffect(() => {
        if (!connection || !identity || !itemDefinitions) return;

        const localPlayerIdentityHex = identity.toHexString();

        const handleItemInsert = (ctx: any, newItem: InventoryItem) => {
            let isPlayerItem = false;
            if (newItem.location.tag === 'Inventory' && newItem.location.value.ownerId.toHexString() === localPlayerIdentityHex) {
                isPlayerItem = true;
            } else if (newItem.location.tag === 'Hotbar' && newItem.location.value.ownerId.toHexString() === localPlayerIdentityHex) {
                isPlayerItem = true;
            }
            
            if (isPlayerItem) {
                // For inserts, we assume it's a new item to the player's direct possession.
                // This covers harvesting, crafting outputs directly to inventory, picking up world drops.
                // It might also catch items moved from a container if the container management deletes
                // the old item and inserts a new one (less common, usually it's an update).
                addAcquisitionNotification(newItem.itemDefId, newItem.quantity);
            }
        };

        const handleItemUpdate = (ctx: any, oldItem: InventoryItem, newItem: InventoryItem) => {
            let isNewItemPlayerOwned = false;
            let isOldItemPlayerOwned = false;
            let newItemPlayerLocationType: 'Inventory' | 'Hotbar' | null = null;

            if (newItem.location.tag === 'Inventory' && newItem.location.value.ownerId.toHexString() === localPlayerIdentityHex) {
                isNewItemPlayerOwned = true;
                newItemPlayerLocationType = 'Inventory';
            } else if (newItem.location.tag === 'Hotbar' && newItem.location.value.ownerId.toHexString() === localPlayerIdentityHex) {
                isNewItemPlayerOwned = true;
                newItemPlayerLocationType = 'Hotbar';
            }

            if (oldItem.location.tag === 'Inventory' && oldItem.location.value.ownerId.toHexString() === localPlayerIdentityHex) {
                isOldItemPlayerOwned = true;
            } else if (oldItem.location.tag === 'Hotbar' && oldItem.location.value.ownerId.toHexString() === localPlayerIdentityHex) {
                isOldItemPlayerOwned = true;
            }
            
            // Scenario 1: Item quantity increased in player's inventory/hotbar (stacking)
            if (isNewItemPlayerOwned && isOldItemPlayerOwned && 
                newItem.itemDefId === oldItem.itemDefId && 
                newItem.location.tag === oldItem.location.tag && // Ensure it's the same slot type
                newItem.quantity > oldItem.quantity) {
                const quantityChange = newItem.quantity - oldItem.quantity;
                addAcquisitionNotification(newItem.itemDefId, quantityChange);
            } 
            // Scenario 2: Item moved into player's inventory/hotbar
            else if (isNewItemPlayerOwned && newItemPlayerLocationType) {
                // Check the OLD location. If it was a container, DO NOT notify.
                const oldLocationTag = oldItem.location.tag;
                if (oldLocationTag === 'Container') {
                    // Further check the containerType if it's a generic container
                    const containerData = oldItem.location.value as any; // Cast to any to access containerType, or use specific generated type if known
                    if (containerData.containerType?.tag === 'Campfire' || 
                        containerData.containerType?.tag === 'WoodenStorageBox' || 
                        containerData.containerType?.tag === 'PlayerCorpse') {
                        // Item came from one of these specific container types, so don't notify.
                        // console.log('Item moved from specific container, no notification', oldItem, newItem);
                        return;
                    }
                }
                // If it wasn't in player possession before OR it came from a non-container location (e.g. Dropped, Unknown, or different player)
                // then it's a new acquisition for the player's direct inventory.
                if (!isOldItemPlayerOwned || (oldLocationTag !== 'Inventory' && oldLocationTag !== 'Hotbar' && oldLocationTag !== 'Container')) {
                    addAcquisitionNotification(newItem.itemDefId, newItem.quantity);
                }
            }
        };
        
        connection.db.inventoryItem.onInsert(handleItemInsert);
        connection.db.inventoryItem.onUpdate(handleItemUpdate);

        return () => {
            connection.db.inventoryItem.removeOnInsert(handleItemInsert);
            connection.db.inventoryItem.removeOnUpdate(handleItemUpdate);
        };
    }, [connection, identity, itemDefinitions, addAcquisitionNotification]);
    // --- END NEW EFFECT ---

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
            {/* --- NEW: Render Item Acquisition Notifications --- */}
            <ItemAcquisitionNotificationUI notifications={acquisitionNotifications.slice(-MAX_NOTIFICATIONS_DISPLAYED)} />
            {/* --- END NEW --- */}

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
                {/*
                  Glow/pulse effect for Thirst, Hunger, Warmth when below LOW_NEED_THRESHOLD (20.0),
                  matching server logic for stat penalties/health loss. This helps players realize
                  why they're thirsty/hungry/cold and should take action soon.
                */}
                <StatusBar label="Thirst" icon="💧" value={localPlayer.thirst} maxValue={100} barColor="#40a0ff" glow={localPlayer.thirst < lowNeedThreshold} />
                <StatusBar label="Hunger" icon="🍖" value={localPlayer.hunger} maxValue={100} barColor="#ffa040" glow={localPlayer.hunger < lowNeedThreshold} />
                <StatusBar label="Warmth" icon="🔥" value={localPlayer.warmth} maxValue={100} barColor="#ffcc00" glow={localPlayer.warmth < lowNeedThreshold} />
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
                    woodenStorageBoxes={woodenStorageBoxes}
                    playerCorpses={playerCorpses}
                    stashes={stashes}
                    startPlacement={startPlacement}
                    cancelPlacement={cancelPlacement}
                    placementInfo={placementInfo}
                    currentStorageBox={currentStorageBox}
                    recipes={recipes}
                    craftingQueueItems={craftingQueueItems}
                    onCraftingSearchFocusChange={onCraftingSearchFocusChange}
                 />
             )}

            {/* Drag Overlay is removed - ghost handled by DraggableItem */}
       </>
      // </DndContext...> // Remove wrapper
    );
};

export default React.memo(PlayerUI);
