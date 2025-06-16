import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Player, InventoryItem, ItemDefinition, DbConnection, ActiveEquipment, Campfire as SpacetimeDBCampfire, WoodenStorageBox as SpacetimeDBWoodenStorageBox, Recipe, CraftingQueueItem, PlayerCorpse, StatThresholdsConfig, Stash as SpacetimeDBStash, ActiveConsumableEffect, KnockedOutStatus, WorldState } from '../generated';
import { Identity } from '@clockworklabs/spacetimedb-sdk';
import InventoryUI, { PopulatedItem } from './InventoryUI';
import Hotbar from './Hotbar';
import StatusBar from './StatusBar';
// Import drag/drop types from shared file
import { DragSourceSlotInfo, DraggedItemInfo } from '../types/dragDropTypes';
// NEW: Import placement types
import { PlacementItemInfo, PlacementState, PlacementActions } from '../hooks/usePlacementManager';
import { InteractionTarget } from '../hooks/useInteractionManager';

// --- NEW IMPORTS ---
import { NotificationItem } from '../types/notifications';
import ItemAcquisitionNotificationUI from './ItemAcquisitionNotificationUI';
import ActiveCraftingQueueUI from './ActiveCraftingQueueUI';
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
  showInventory: boolean;
  onToggleInventory: () => void;
  knockedOutStatus: Map<string, KnockedOutStatus>;
  worldState: WorldState | null;
  isGameMenuOpen?: boolean;
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
    onCraftingSearchFocusChange,
    showInventory,
    onToggleInventory,
    knockedOutStatus,
    worldState,
    isGameMenuOpen
 }) => {
    const [localPlayer, setLocalPlayer] = useState<Player | null>(null);
    const [lowNeedThreshold, setLowNeedThreshold] = useState<number>(20.0);
    // --- NEW STATE FOR NOTIFICATIONS ---
    const [acquisitionNotifications, setAcquisitionNotifications] = useState<NotificationItem[]>([]);
    const NOTIFICATION_DURATION = 3000; // ms
    const FADE_OUT_ANIMATION_DURATION = 500; // ms for fade-out animation
    const MAX_NOTIFICATIONS_DISPLAYED = 5;
    // --- END NEW STATE ---

    // Reference to store the previous state of inventory items for comparison
    const prevInventoryRef = useRef<Map<string, InventoryItem>>(new Map());

    // Determine if there's an active health regen effect for the local player
    const isHealthHealingOverTime = React.useMemo(() => {
        if (!localPlayer || !activeConsumableEffects || activeConsumableEffects.size === 0) return false;
        
        const localPlayerIdHex = localPlayer.identity.toHexString();
        let foundMatch = false;
        
        activeConsumableEffects.forEach((effect) => {
            const effectPlayerIdHex = effect.playerId.toHexString();
            const effectTypeTag = effect.effectType ? (effect.effectType as any).tag : 'undefined';
            const effectTargetPlayerIdHex = effect.targetPlayerId ? effect.targetPlayerId.toHexString() : null;
            
            // For RemoteBandageBurst, check if players are in range
            if (effectTypeTag === 'RemoteBandageBurst') {
                // Only check range if this player is involved (either as healer or target)
                if (effectPlayerIdHex === localPlayerIdHex || effectTargetPlayerIdHex === localPlayerIdHex) {
                    const healerIdHex = effectPlayerIdHex;
                    const targetIdHex = effectTargetPlayerIdHex;
                    
                    if (healerIdHex && targetIdHex) {
                        const healer = players.get(healerIdHex);
                        const target = players.get(targetIdHex);
                        
                        if (healer && target) {
                            const dx = healer.positionX - target.positionX;
                            const dy = healer.positionY - target.positionY;
                            const distance = Math.sqrt(dx * dx + dy * dy);
                            const HEALING_RANGE = 4.0 * 32.0; // Must match server's range (4 tiles)
                            
                            if (distance <= HEALING_RANGE) {
                                foundMatch = true;
                            }
                        }
                    }
                }
            } else if ((effectTypeTag === 'HealthRegen' && effectPlayerIdHex === localPlayerIdHex) || 
                      (effectTypeTag === 'BandageBurst' && effectPlayerIdHex === localPlayerIdHex)) {
                foundMatch = true;
            }
        });

        return foundMatch;
    }, [localPlayer, activeConsumableEffects, players]);

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
            const effectTargetPlayerIdHex = effect.targetPlayerId ? effect.targetPlayerId.toHexString() : null;

            // For RemoteBandageBurst, check if players are in range
            if (effectTypeTag === 'RemoteBandageBurst' && effectTargetPlayerIdHex === localPlayerIdHex) {
                const healer = players.get(effectPlayerIdHex);
                const target = players.get(localPlayerIdHex);
                
                if (healer && target) {
                    const dx = healer.positionX - target.positionX;
                    const dy = healer.positionY - target.positionY;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    const HEALING_RANGE = 4.0 * 32.0; // Must match server's range (4 tiles)
                    
                    // Only show ghost bar if players are in range
                    if (distance <= HEALING_RANGE) {
                        potentialHeal = effect.totalAmount || 0;
                    }
                }
            } else if (effectPlayerIdHex === localPlayerIdHex && effectTypeTag === 'BandageBurst') {
                potentialHeal = effect.totalAmount || 0;
            }
        });
        
        return potentialHeal;
    }, [localPlayer, activeConsumableEffects, players]);

    useEffect(() => {
        if (!identity) {
            setLocalPlayer(null);
            return;
        }
        const player = players.get(identity.toHexString());
        setLocalPlayer(player || null);
    }, [identity, players]);

    // --- NEW: Handle Knocked Out Status ---
    useEffect(() => {
        if (!connection || !localPlayer || !identity) return;

        let intervalId: NodeJS.Timeout | null = null;

        if (localPlayer.isKnockedOut) {
            // Call the reducer immediately when player becomes knocked out
            connection.reducers.getKnockedOutStatus();
            
            // Set up interval to call it every 2 seconds while knocked out
            intervalId = setInterval(() => {
                connection.reducers.getKnockedOutStatus();
            }, 2000);
        }

        return () => {
            if (intervalId) {
                clearInterval(intervalId);
            }
        };
    }, [connection, localPlayer?.isKnockedOut, identity]);

    // Get the current knocked out status for the local player
    const localPlayerKnockedOutStatus = React.useMemo(() => {
        if (!identity || !localPlayer?.isKnockedOut) return null;
        return knockedOutStatus.get(identity.toHexString()) || null;
    }, [identity, localPlayer?.isKnockedOut, knockedOutStatus]);
    // --- END NEW: Handle Knocked Out Status ---

    useEffect(() => {
        if (!connection) return;

        const handleStatThresholdsConfig = (config: StatThresholdsConfig | null | undefined) => {
            if (config && typeof config.lowNeedThreshold === 'number') {
                setLowNeedThreshold(config.lowNeedThreshold);
                // console.log('StatThresholdsConfig: low_need_threshold set to', config.lowNeedThreshold);
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

    // --- REVISED: EFFECT FOR INVENTORY ITEM CHANGES (ACQUISITION NOTIFICATIONS) ---
    useEffect(() => {
        if (!connection || !identity || !itemDefinitions || !inventoryItems) return;

        const localPlayerIdHex = identity.toHexString();
        const currentInventorySnapshot = new Map(inventoryItems);

        // If prevInventoryRef.current is empty, this is the initial load.
        // In this case, we just populate the ref and don't trigger notifications.
        if (prevInventoryRef.current.size === 0) {
            prevInventoryRef.current = currentInventorySnapshot;
            return;
        }

        const currentTotals = new Map<string, number>(); // itemDefId_str -> quantity
        const previousTotals = new Map<string, number>(); // itemDefId_str -> quantity

        // Calculate current totals for player from the live inventoryItems prop
        currentInventorySnapshot.forEach(item => {
            if ((item.location.tag === 'Inventory' || item.location.tag === 'Hotbar') && item.location.value.ownerId.toHexString() === localPlayerIdHex) {
                const defId = item.itemDefId.toString();
                currentTotals.set(defId, (currentTotals.get(defId) || 0) + item.quantity);
            }
        });

        // Calculate previous totals for player from the stored ref
        prevInventoryRef.current.forEach(item => {
            if ((item.location.tag === 'Inventory' || item.location.tag === 'Hotbar') && item.location.value.ownerId.toHexString() === localPlayerIdHex) {
                const defId = item.itemDefId.toString();
                previousTotals.set(defId, (previousTotals.get(defId) || 0) + item.quantity);
            }
        });

        // Find net gains and trigger notifications
        currentTotals.forEach((currentQty, defIdStr) => {
            const prevQty = previousTotals.get(defIdStr) || 0;
            const netChange = currentQty - prevQty;

            if (netChange > 0) {
                // Ensure itemDefId is valid before trying to parse and use it
                const itemDef = itemDefinitions.get(defIdStr);
                if (itemDef) {
                    addAcquisitionNotification(itemDef.id, netChange);
                } else {
                    console.warn(`[PlayerUI] Notification: Item definition not found for ID ${defIdStr} during net change calculation.`);
                }
            }
        });

        // Update the ref to the current snapshot for the next render/change detection
        prevInventoryRef.current = currentInventorySnapshot;

        // Note: The onInsert and onUpdate handlers for inventoryItem are no longer responsible
        // for triggering acquisition notifications directly. If they are still needed for other
        // side effects, they can be kept, otherwise they could be removed or simplified.
        // For this specific bug fix, we are moving the notification logic out of them.

        // Example: If you had specific logic in onInsert/onUpdate beyond notifications,
        // that would remain or be handled separately.
        // For now, we assume their primary role for *acquisition notifications* is superseded.

    }, [inventoryItems, identity, itemDefinitions, connection, addAcquisitionNotification]); // Added connection to deps
    // --- END REVISED EFFECT ---

    // Effect for inventory toggle keybind
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Tab') {
                event.preventDefault();
                // Toggle the inventory state
                onToggleInventory();
                // If closing, also clear the interaction target
                if (showInventory) {
                     onSetInteractingWith(null);
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [showInventory, onToggleInventory, onSetInteractingWith]);

    // Effect to disable background scrolling when inventory is open
    useEffect(() => {
        const preventBackgroundScroll = (event: WheelEvent) => {
            const target = event.target as Element;

            const inventoryPanel = document.querySelector('.inventoryPanel');

            if (!inventoryPanel || !showInventory) return;

            if (!inventoryPanel.contains(target)) {
                event.preventDefault();
                return;
            }

            // Check if the scroll event originated within a designated scrollable child
            const scrollableCrafting = target.closest('.craftableItemsSection');
            const scrollableQueue = target.closest('.craftingQueueList');
            // If you add more scrollable areas inside InventoryUI, add their selectors here:
            // const anotherScrollableArea = target.closest('.another-scrollable-class');

            if (scrollableCrafting || scrollableQueue /* || anotherScrollableArea */) {
                // If the event is within a known scrollable area, allow the default scroll behavior for that element.
                return;
            }

            // If the event is inside the inventory panel but not within a designated scrollable child,
            // prevent the default action to stop the main page from scrolling.
            event.preventDefault();
        };

        if (showInventory) {
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
    }, [showInventory]);

    // --- Open Inventory when Interaction Starts --- 
    useEffect(() => {
        // console.log('[PlayerUI] interactingWith changed:', interactingWith);
        if (interactingWith) {
            // console.log('[PlayerUI] Opening inventory for interaction:', interactingWith);
            if (!showInventory) {
                onToggleInventory();
            }
        }
    }, [interactingWith, showInventory, onToggleInventory]);

    // --- Handle Closing Inventory & Interaction --- 
    const handleClose = () => {
        if (showInventory) {
            onToggleInventory();
        }
        onSetInteractingWith(null); // Clear interaction state when closing
    };

    // Get the current player's active equipment
    const localPlayerActiveEquipment = React.useMemo(() => {
        if (!identity) return null;
        return activeEquipments.get(identity.toHexString()) || null;
    }, [identity, activeEquipments]);

    // Helper to determine if there's an active crafting item for positioning
    const hasActiveCrafting = React.useMemo(() => {
        if (!identity || !craftingQueueItems) return false;
        return Array.from(craftingQueueItems.values())
            .some(item => item.playerIdentity.isEqual(identity));
    }, [identity, craftingQueueItems]);

    // Calculate active status effects for display
    const activeStatusEffects = React.useMemo(() => {
        const effects: string[] = [];
        
        if (!localPlayer) return effects;

        // Check for cold status (warmth below 20)
        if (localPlayer.warmth < 20) {
            effects.push('Cold');
        }

        // Check active consumable effects if available
        if (activeConsumableEffects && identity) {
            const localPlayerIdHex = identity.toHexString();
            
            // Track effect names for display
            const effectNames = new Set<string>();
            
            activeConsumableEffects.forEach((effect) => {
                const effectPlayerIdHex = effect.playerId.toHexString();
                const effectTargetPlayerIdHex = effect.targetPlayerId ? effect.targetPlayerId.toHexString() : null;
                const effectTypeTag = effect.effectType ? (effect.effectType as any).tag : 'undefined';
                
                                 // Calculate remaining time using available fields
                 const now = Date.now();
                 const endsAtTime = effect.endsAt ? Number(effect.endsAt.microsSinceUnixEpoch / 1000n) : now;
                 const remainingTime = Math.max(0, (endsAtTime - now) / 1000);
                
                // Check if this effect applies to the local player
                let effectApplies = false;
                let effectName = '';
                
                if (effectPlayerIdHex === localPlayerIdHex) {
                    switch (effectTypeTag) {
                        case 'Bleed':
                            effectApplies = true;
                            effectName = remainingTime > 0 ? `Bleeding (${Math.ceil(remainingTime)}s)` : 'Bleeding';
                            break;
                        case 'Burn':
                            effectApplies = true;
                            effectName = remainingTime > 0 ? `Burning (${Math.ceil(remainingTime)}s)` : 'Burning';
                            break;
                        case 'HealthRegen':
                            effectApplies = true;
                            effectName = remainingTime > 0 ? `Regenerating (${Math.ceil(remainingTime)}s)` : 'Regenerating';
                            break;
                        case 'BandageBurst':
                            effectApplies = true;
                            effectName = remainingTime > 0 ? `Bandaged (${Math.ceil(remainingTime)}s)` : 'Bandaged';
                            break;
                    }
                } else if (effectTargetPlayerIdHex === localPlayerIdHex && effectTypeTag === 'RemoteBandageBurst') {
                    // Check if remote bandage healer is in range
                    const healer = players.get(effectPlayerIdHex);
                    const target = players.get(localPlayerIdHex);
                    
                    if (healer && target) {
                        const dx = healer.positionX - target.positionX;
                        const dy = healer.positionY - target.positionY;
                        const distance = Math.sqrt(dx * dx + dy * dy);
                        const HEALING_RANGE = 4.0 * 32.0; // Must match server's range
                        
                        if (distance <= HEALING_RANGE) {
                            effectApplies = true;
                            effectName = remainingTime > 0 ? `Being Bandaged (${Math.ceil(remainingTime)}s)` : 'Being Bandaged';
                        }
                    }
                }
                
                if (effectApplies && effectName) {
                    effectNames.add(effectName);
                }
            });
            
            // Add effects to display list
            effectNames.forEach((effectName) => {
                effects.push(effectName);
            });
        }

        return effects;
    }, [localPlayer, activeConsumableEffects, identity, players]);

    if (!localPlayer) {
        return null;
    }

    // --- Render without DndContext/Overlay ---
    return (
      // <DndContext...> // Remove wrapper
        <>
            {/* --- NEW: Render Item Acquisition Notifications --- */}
            <ItemAcquisitionNotificationUI 
                notifications={acquisitionNotifications.slice(-MAX_NOTIFICATIONS_DISPLAYED)} 
                hasActiveCrafting={hasActiveCrafting}
            />
            {/* --- END NEW --- */}

            {/* --- NEW: Active Crafting Queue UI --- */}
            <ActiveCraftingQueueUI 
                craftingQueueItems={craftingQueueItems}
                itemDefinitions={itemDefinitions}
                playerIdentity={identity}
            />
            {/* --- END NEW --- */}

            {/* --- NEW: Knocked Out Status Overlay --- */}
            {localPlayer?.isKnockedOut && (
                <div style={{
                    position: 'fixed',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    background: 'linear-gradient(135deg, rgba(40, 10, 20, 0.95), rgba(30, 5, 15, 0.98))',
                    color: '#ff6b6b',
                    padding: '25px 30px',
                    borderRadius: '12px',
                    border: '2px solid #ff4444',
                    fontFamily: '"Press Start 2P", cursive',
                    fontSize: '12px',
                    textAlign: 'center',
                    minWidth: '350px',
                    boxShadow: '0 0 30px rgba(255, 68, 68, 0.6), inset 0 0 20px rgba(255, 68, 68, 0.1)',
                    zIndex: 1000,
                    animation: 'pulse 2s ease-in-out infinite alternate',
                    backdropFilter: 'blur(8px)',
                }}>
                    <h2 style={{ 
                        margin: '0 0 15px 0', 
                        fontSize: '16px', 
                        color: '#ff4444',
                        textShadow: '2px 2px 4px rgba(0,0,0,0.8)'
                    }}>
                        ⚠️ YOU ARE WOUNDED ⚠️
                    </h2>
                    
                    {localPlayerKnockedOutStatus ? (
                        <div>
                            <div style={{ marginBottom: '10px', color: '#ffaa44' }}>
                                🏥 Recovery Chance: <span style={{ color: '#44ff44' }}>
                                    {localPlayerKnockedOutStatus.currentRecoveryChancePercent.toFixed(1)}%
                                </span>
                            </div>
                            
                            <div style={{ marginBottom: '10px', color: '#ffaa44' }}>
                                💀 Death Risk: <span style={{ color: '#ff4444' }}>
                                    {localPlayerKnockedOutStatus.currentDeathChancePercent.toFixed(1)}%
                                </span>
                            </div>
                            
                            {localPlayerKnockedOutStatus.timeUntilDeathRiskStartsSecs > 0 && (
                                <div style={{ marginBottom: '10px', color: '#44aaff' }}>
                                    ⏱️ Safe Time: {Math.ceil(localPlayerKnockedOutStatus.timeUntilDeathRiskStartsSecs)}s
                                </div>
                            )}
                            
                            <div style={{ marginBottom: '15px', color: '#aaaaaa', fontSize: '10px' }}>
                                Survival Factor: {localPlayerKnockedOutStatus.statMultiplier.toFixed(2)}x
                                <br />
                                (Based on hunger, thirst, stamina, warmth & armor)
                            </div>
                        </div>
                    ) : (
                        <div style={{ color: '#ffaa44' }}>
                            Calculating status...
                        </div>
                    )}
                    
                    <div style={{ 
                        fontSize: '10px', 
                        color: '#cccccc',
                        marginTop: '10px',
                        borderTop: '1px solid #444',
                        paddingTop: '10px'
                    }}>
                        💡 Another player can revive you!
                        <br />
                        Better stats = better survival chances
                    </div>
                </div>
            )}
            {/* --- END NEW: Knocked Out Status Overlay --- */}

            {/* Status Effects Text - appears above status bars */}
            {activeStatusEffects.length > 0 && (
                <div style={{
                    position: 'fixed',
                    bottom: '140px', // Position above status bars
                    right: '15px',
                    fontFamily: 'Courier New, Consolas, Monaco, monospace',
                    fontSize: '11px',
                    color: '#ffffff', // White text for better contrast
                    textShadow: '1px 1px 2px rgba(0, 0, 0, 0.8)',
                    backgroundColor: 'rgba(139, 69, 69, 0.9)', // Matte red background
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '2px solid rgba(180, 50, 50, 0.8)',
                    backdropFilter: 'blur(3px)',
                    minWidth: '220px',
                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
                    zIndex: 55, // Above status bars (50) but below other UI
                }}>
                    <div style={{ 
                        display: 'flex', 
                        alignItems: 'center',
                        gap: '8px'
                    }}>
                        <span style={{ fontWeight: 'bold' }}>
                            {activeStatusEffects.join(' | ')}
                        </span>
                    </div>
                </div>
            )}

            {/* Status Bars UI */}
            <div style={{
                position: 'fixed',
                bottom: '15px',
                right: '15px',
                background: 'linear-gradient(135deg, rgba(30, 15, 50, 0.9), rgba(20, 10, 40, 0.95))',
                color: '#00ffff',
                padding: '15px 18px',
                borderRadius: '10px',
                border: '2px solid #00aaff',
                fontFamily: '"Press Start 2P", cursive',
                minWidth: '220px',
                boxShadow: '0 0 25px rgba(0, 170, 255, 0.4), inset 0 0 15px rgba(0, 170, 255, 0.1)',
                zIndex: 50, // Keep below inventory/overlay
                textShadow: '0 0 6px rgba(0, 255, 255, 0.6)',
            }}>
                {/* Status Bars mapping */}
                <StatusBar 
                    label="HP" 
                    iconType="heart"
                    value={localPlayer.health} 
                    maxValue={100} 
                    barColor="#ff4040" 
                    hasActiveEffect={isHealthHealingOverTime}
                    hasBleedEffect={isPlayerBleeding}
                    pendingHealAmount={pendingBandageHealAmount}
                    glow={localPlayer.health < lowNeedThreshold}
                />
                {/* <StatusBar label="SP" iconType="stamina" value={localPlayer.stamina} maxValue={100} barColor="#40ff40" /> */}
                {/*
                  Glow/pulse effect for Thirst, Hunger, Warmth when below LOW_NEED_THRESHOLD (20.0),
                  matching server logic for stat penalties/health loss. This helps players realize
                  why they're thirsty/hungry/cold and should take action soon.
                */}
                <StatusBar label="Thirst" iconType="thirst" value={localPlayer.thirst} maxValue={250} barColor="#40a0ff" glow={localPlayer.thirst < lowNeedThreshold} />
                <StatusBar label="Hunger" iconType="hunger" value={localPlayer.hunger} maxValue={250} barColor="#ffa040" glow={localPlayer.hunger < lowNeedThreshold} />
                {/* <StatusBar label="Warmth" iconType="warmth" value={localPlayer.warmth} maxValue={100} barColor="#ffcc00" glow={localPlayer.warmth < lowNeedThreshold} /> */}
            </div>

            {/* Render Inventory UI conditionally - Pass props down */}
            {showInventory && (
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
                    worldState={worldState}
                 />
             )}

            {/* Hotbar Area */}
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
                activeConsumableEffects={activeConsumableEffects}
                activeEquipment={localPlayerActiveEquipment}
                isGameMenuOpen={isGameMenuOpen}
            />

            {/* Drag Overlay is removed - ghost handled by DraggableItem */}
       </>
      // </DndContext...> // Remove wrapper
    );
};

export default React.memo(PlayerUI);
