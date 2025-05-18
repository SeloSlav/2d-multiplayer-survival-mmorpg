import React, { useState, useEffect, useCallback } from 'react';
import { Player, InventoryItem, ItemDefinition, DbConnection, ActiveEquipment, Campfire as SpacetimeDBCampfire, WoodenStorageBox as SpacetimeDBWoodenStorageBox, Recipe, CraftingQueueItem, PlayerCorpse, StatThresholdsConfig, Stash as SpacetimeDBStash, ActiveConsumableEffect } from '../generated';
import { Identity } from '@clockworklabs/spacetimedb-sdk';
import InventoryUI, { PopulatedItem } from './InventoryUI';
import Hotbar from './Hotbar';
import StatusBar from './StatusBar';
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
  activeConsumableEffects: Map<string, ActiveConsumableEffect>;
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
    activeConsumableEffects,
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
    const FADE_OUT_ANIMATION_DURATION = 500; // ms for fade-out animation
    const MAX_NOTIFICATIONS_DISPLAYED = 5;
    // --- END NEW STATE ---

    // Determine if there's an active health regen effect for the local player
    const isHealthHealingOverTime = React.useMemo(() => {
        if (!localPlayer || !activeConsumableEffects || activeConsumableEffects.size === 0) return false;
        
        const localPlayerIdHex = localPlayer.identity.toHexString();
        // console.log(`[PlayerUI] Checking active effects for player: ${localPlayerIdHex}`);

        let foundMatch = false;
        activeConsumableEffects.forEach((effect, key) => {
            const effectPlayerIdHex = effect.playerId.toHexString();
            const effectTypeTag = effect.effectType ? (effect.effectType as any).tag : 'undefined';
            
            // console.log(`[PlayerUI] Effect ID ${key}: player ID matches: ${effectPlayerIdHex === localPlayerIdHex}, type tag: ${effectTypeTag}`);

            if (effectPlayerIdHex === localPlayerIdHex && effectTypeTag === 'HealthRegen') {
                // console.log(`[PlayerUI] Found matching HealthRegen effect:`, effect);
                foundMatch = true;
            }
        });

        return foundMatch;
    }, [localPlayer, activeConsumableEffects]);

    // Determine if there's an active bleed effect for the local player
    const isPlayerBleeding = React.useMemo(() => {
        if (!localPlayer || !activeConsumableEffects || activeConsumableEffects.size === 0) return false;

        const localPlayerIdHex = localPlayer.identity.toHexString();
        let foundMatch = false;
        activeConsumableEffects.forEach((effect) => {
            const effectPlayerIdHex = effect.playerId.toHexString();
            const effectTypeTag = effect.effectType ? (effect.effectType as any).tag : 'undefined';

            // console.log(`[PlayerUI - isPlayerBleeding] Checking effect: PlayerID=${effectPlayerIdHex}, LocalPlayerID=${localPlayerIdHex}, EffectTypeTag='${effectTypeTag}'`);

            if (effectPlayerIdHex === localPlayerIdHex && effectTypeTag === 'Bleed') {
                foundMatch = true;
                // console.log("[PlayerUI - isPlayerBleeding] Bleed effect FOUND for local player.");
            }
        });
        return foundMatch;
    }, [localPlayer, activeConsumableEffects]);

    // Determine if there's an active BandageBurst effect and its potential heal amount
    const pendingBandageHealAmount = React.useMemo(() => {
        if (!localPlayer || !activeConsumableEffects || activeConsumableEffects.size === 0) return 0;

        const localPlayerIdHex = localPlayer.identity.toHexString();
        let potentialHeal = 0;
        activeConsumableEffects.forEach((effect) => {
            const effectPlayerIdHex = effect.playerId.toHexString();
            const effectTypeTag = effect.effectType ? (effect.effectType as any).tag : 'undefined';

            if (effectPlayerIdHex === localPlayerIdHex && effectTypeTag === 'BandageBurst') {
                potentialHeal = effect.totalAmount || 0; // Use totalAmount from the effect
            }
        });
        return potentialHeal;
    }, [localPlayer, activeConsumableEffects]);

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
        if (!itemDefinitions || quantityChange <= 0 || !connection || !identity) return;

        const def = itemDefinitions.get(itemDefId.toString());
        if (!def) {
            console.warn(`No item definition found for ID: ${itemDefId}`);
            return;
        }

        let currentTotalInInventory: number | undefined = undefined;

        if (def.category.tag === 'Material') {
            let total = 0;
            const playerIdentityHex = identity.toHexString();
            for (const invItem of connection.db.inventoryItem.iter()) {
                if (invItem.itemDefId === itemDefId) {
                    if (invItem.location.tag === 'Inventory' && invItem.location.value.ownerId.toHexString() === playerIdentityHex) {
                        total += invItem.quantity;
                    } else if (invItem.location.tag === 'Hotbar' && invItem.location.value.ownerId.toHexString() === playerIdentityHex) {
                        total += invItem.quantity;
                    }
                }
            }
            currentTotalInInventory = total;
        }

        const newNotification: NotificationItem = {
            id: `${Date.now()}-${Math.random()}`, // Simple unique ID
            itemDefId: itemDefId,
            itemName: def.name,
            itemIcon: def.iconAssetName,
            quantityChange: quantityChange,
            currentTotalInInventory: currentTotalInInventory, // Add the calculated total here
            timestamp: Date.now(),
            isFadingOut: false, // Initialize as not fading out
        };

        setAcquisitionNotifications(prevNotifications => {
            const updatedNotifications = [...prevNotifications, newNotification];
            return updatedNotifications; 
        });

        // First timeout: Mark for fade-out
        setTimeout(() => {
            setAcquisitionNotifications(prev =>
                prev.map(n => 
                    n.id === newNotification.id ? { ...n, isFadingOut: true } : n
                )
            );
            // Second timeout: Actually remove after fade-out animation completes
            setTimeout(() => {
                setAcquisitionNotifications(prev => prev.filter(n => n.id !== newNotification.id));
            }, FADE_OUT_ANIMATION_DURATION);
        }, NOTIFICATION_DURATION);

    }, [itemDefinitions, connection, identity]);
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
                <StatusBar 
                    label="HP" 
                    icon="❤️" 
                    value={localPlayer.health} 
                    maxValue={100} 
                    barColor="#ff4040" 
                    hasActiveEffect={isHealthHealingOverTime}
                    hasBleedEffect={isPlayerBleeding}
                    pendingHealAmount={pendingBandageHealAmount}
                    glow={localPlayer.health < lowNeedThreshold}
                />
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

            {/* Hotbar Area */}
            {!placementInfo && (
                <Hotbar
                    playerIdentity={identity}
                    localPlayer={localPlayer}
                    itemDefinitions={itemDefinitions}
                    inventoryItems={inventoryItems}
                    connection={connection}
                    onItemDragStart={onItemDragStart}
                    onItemDrop={onItemDrop}
                    draggedItemInfo={draggedItemInfo}
                    interactingWith={interactingWith}
                    campfires={campfires}
                    stashes={stashes}
                    startPlacement={startPlacement}
                    cancelPlacement={cancelPlacement}
                />
            )}

            {/* Drag Overlay is removed - ghost handled by DraggableItem */}
       </>
      // </DndContext...> // Remove wrapper
    );
};

export default React.memo(PlayerUI);
