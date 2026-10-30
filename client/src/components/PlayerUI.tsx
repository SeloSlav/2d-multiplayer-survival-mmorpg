import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { DbConnection } from '../generated';
import { Player, InventoryItem, ItemDefinition, ActiveEquipment, Campfire as SpacetimeDBCampfire, Furnace as SpacetimeDBFurnace, Barbecue as SpacetimeDBBarbecue, Fumarole as SpacetimeDBFumarole, Lantern as SpacetimeDBLantern, Turret as SpacetimeDBTurret, WoodenStorageBox as SpacetimeDBWoodenStorageBox, Recipe, CraftingQueueItem, PlayerCorpse, StatThresholdsConfig, Stash as SpacetimeDBStash, ActiveConsumableEffect, KnockedOutStatus, WorldState, RainCollector as SpacetimeDBRainCollector, BrothPot as SpacetimeDBBrothPot, HomesteadHearth as SpacetimeDBHomesteadHearth, RangedWeaponStats, MemoryGridProgress as SpacetimeDBMemoryGridProgress } from '../generated/types';
import { Identity } from 'spacetimedb';
import InventoryUI, { PopulatedItem } from './InventoryUI';
import Hotbar from './Hotbar';
import StatusBar from './StatusBar';
import StatusEffectsPanel from './StatusEffectsPanel';
// Import drag/drop types from shared file
import { DragSourceSlotInfo, DraggedItemInfo } from '../types/dragDropTypes';
// NEW: Import placement types
import { PlacementItemInfo, PlacementState, PlacementActions } from '../hooks/usePlacementManager';
import { InteractionTarget } from '../hooks/useInteractionManager';

// --- NEW IMPORTS ---
import { NotificationItem } from '../types/notifications';
import ItemAcquisitionNotificationUI from './ItemAcquisitionNotificationUI';
import ActiveCraftingQueueUI from './ActiveCraftingQueueUI';
import CyberpunkKnockedOutScreen from './CyberpunkKnockedOutScreen';
import CraftingScreen from './CraftingScreen';
import BoneCarvingPanel from './BoneCarvingPanel';
import RadioPanel from './RadioPanel';
// Hot loot hook
import { useHotLoot } from '../hooks/useHotLoot';
import { REMOTE_HEALING_RANGE_PX } from '../config/combatConstants';
// --- END NEW IMPORTS ---

// Import status icons for mobile UI
import heartIcon from '../assets/ui/heart.png';
import thirstIcon from '../assets/ui/thirst.png';
import hungerIcon from '../assets/ui/hunger.png';

interface PlayerUIProps {
  identity: Identity | null;
  players: Map<string, Player>;
  inventoryItems: Map<string, InventoryItem>;
  itemDefinitions: Map<string, ItemDefinition>;
  rangedWeaponStats: Map<string, RangedWeaponStats>;
  connection: DbConnection | null;
  onItemDragStart: (info: DraggedItemInfo) => void;
  onItemDrop: (targetSlotInfo: DragSourceSlotInfo | null) => void;
  draggedItemInfo: DraggedItemInfo | null;
  activeEquipments: Map<string, ActiveEquipment>;
  activeConsumableEffects: Map<string, ActiveConsumableEffect>;
  campfires: Map<string, SpacetimeDBCampfire>;
  furnaces: Map<string, SpacetimeDBFurnace>;
  barbecues: Map<string, SpacetimeDBBarbecue>; // ADDED: Barbecues
  fumaroles: Map<string, SpacetimeDBFumarole>; // ADDED: Fumaroles
  lanterns: Map<string, SpacetimeDBLantern>;
  turrets: Map<string, SpacetimeDBTurret>; // ADDED: Turrets prop
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
  rainCollectors: Map<string, SpacetimeDBRainCollector>;
  brothPots: Map<string, SpacetimeDBBrothPot>;
  homesteadHearths: Map<string, SpacetimeDBHomesteadHearth>; // ADDED: Homestead Hearths
  onCraftingSearchFocusChange?: (isFocused: boolean) => void;
  showInventory: boolean;
  onToggleInventory: () => void;
  knockedOutStatus: Map<string, KnockedOutStatus>;
  worldState: WorldState | null;
  isGameMenuOpen?: boolean;
  chunkWeather: Map<string, any>; // ADDED: Chunk-based weather
  memoryGridProgress?: Map<string, SpacetimeDBMemoryGridProgress>; // ADDED: Memory Grid unlocks
  playerStats?: Map<string, any>; // ADDED: Player XP, level, and stats (using any to avoid import issues)
  isMobile?: boolean; // ADDED: Mobile detection for responsive layout
  // Crafting Screen props
  showCraftingScreen: boolean;
  onToggleCraftingScreen: () => void;
  // Music system callbacks for RadioPanel
  onPauseBackgroundMusic?: () => void;
  onResumeBackgroundMusic?: () => void;
}

const PlayerUI: React.FC<PlayerUIProps> = ({
    identity,
    players,
    inventoryItems,
    itemDefinitions,
    rangedWeaponStats,
    connection,
    onItemDragStart,
    onItemDrop,
    draggedItemInfo,
    activeEquipments,
    activeConsumableEffects,
    campfires,
    furnaces,
    barbecues,
    fumaroles,
    lanterns,
    turrets, // ADDED: Turrets prop
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
    rainCollectors,
    brothPots,
    homesteadHearths,
    onCraftingSearchFocusChange,
    showInventory,
    onToggleInventory,
    knockedOutStatus,
    worldState,
    isGameMenuOpen,
    chunkWeather,
    memoryGridProgress,
    playerStats,
    isMobile = false,
    showCraftingScreen,
    onToggleCraftingScreen,
    onPauseBackgroundMusic,
    onResumeBackgroundMusic,
}) => {
    const [localPlayer, setLocalPlayer] = useState<Player | null>(null);
    const [lowNeedThreshold, setLowNeedThreshold] = useState<number>(20.0);
    
    // Lifted state for ItemInteractionPanel - allows clicking items in Hotbar/ExternalContainerUI while inventory is open
    const [selectedInventoryItem, setSelectedInventoryItem] = useState<PopulatedItem | null>(null);
    
    // State for Bone Carving Panel
    const [showBoneCarvingPanel, setShowBoneCarvingPanel] = useState<boolean>(false);
    
    // State for Radio Panel
    const [showRadioPanel, setShowRadioPanel] = useState<boolean>(false);
    
    // Handler for selecting items from any source (InventoryUI, Hotbar, ExternalContainerUI)
    const handleSelectInventoryItem = useCallback((item: PopulatedItem | null) => {
        setSelectedInventoryItem(item);
    }, []);
    
    // Handler for closing the item interaction panel
    const handleCloseItemInteraction = useCallback(() => {
        setSelectedInventoryItem(null);
    }, []);
    
    // Handler for opening the Bone Carving Panel
    const handleOpenBoneCarving = useCallback(() => {
        setShowBoneCarvingPanel(true);
        // Close inventory when opening bone carving panel
        if (showInventory) {
            onToggleInventory();
        }
    }, [showInventory, onToggleInventory]);
    
    // Handler for closing the Bone Carving Panel
    const handleCloseBoneCarving = useCallback(() => {
        setShowBoneCarvingPanel(false);
    }, []);
    
    // Handler for opening the Radio Panel
    const handleOpenRadio = useCallback(() => {
        setShowRadioPanel(true);
        // Close inventory when opening radio panel
        if (showInventory) {
            onToggleInventory();
        }
        // Pause background music when radio panel opens
        if (onPauseBackgroundMusic) {
            onPauseBackgroundMusic();
        }
    }, [showInventory, onToggleInventory, onPauseBackgroundMusic]);
    
    // Handler for closing the Radio Panel
    const handleCloseRadio = useCallback(() => {
        setShowRadioPanel(false);
        // Resume background music when radio panel closes
        if (onResumeBackgroundMusic) {
            onResumeBackgroundMusic();
        }
    }, [onResumeBackgroundMusic]);
    
    // Clear selected item when inventory closes
    useEffect(() => {
        if (!showInventory) {
            setSelectedInventoryItem(null);
        }
    }, [showInventory]);
    
    // Get local player stats for XP bar
    const localPlayerStats = useMemo(() => {
        if (!identity || !playerStats) return null;
        return playerStats.get(identity.toHexString()) || null;
    }, [identity, playerStats]);
    
    // Calculate XP progress for current level
    const xpProgress = useMemo(() => {
        if (!localPlayerStats) return { current: 0, needed: 1, percent: 0, level: 1 };
        
        // XP formula: 100 * level^1.5 (matches server)
        const xpForLevel = (level: number) => Math.floor(100 * Math.pow(level, 1.5));
        
        const level = localPlayerStats.level || 1;
        const totalXp = Number(localPlayerStats.totalXp) || 0;
        const xpForCurrentLevel = level > 1 ? xpForLevel(level) : 0;
        const xpForNextLevel = xpForLevel(level + 1);
        const xpInCurrentLevel = totalXp - xpForCurrentLevel;
        const xpNeededForNext = xpForNextLevel - xpForCurrentLevel;
        
        const percent = xpNeededForNext > 0 ? Math.min(100, (xpInCurrentLevel / xpNeededForNext) * 100) : 0;
        
        return {
            current: xpInCurrentLevel,
            needed: xpNeededForNext,
            percent,
            level
        };
    }, [localPlayerStats]);
    // --- NEW STATE FOR NOTIFICATIONS ---
    const [acquisitionNotifications, setAcquisitionNotifications] = useState<NotificationItem[]>([]);
    const NOTIFICATION_DURATION = 3000; // ms
    const FADE_OUT_ANIMATION_DURATION = 500; // ms for fade-out animation
    const MAX_NOTIFICATIONS_DISPLAYED = 5;
    // --- END NEW STATE ---

    // Reference to store the previous state of inventory items for comparison
    const prevInventoryRef = useRef<Map<string, InventoryItem>>(new Map());

    // Hot loot hook - enables "hold H to quickly move items" feature
    const {
        isHotLootActive,
        indicators: hotLootIndicators,
        handleSlotHover: handleHotLootSlotHover,
        getSlotIndicator,
        setCurrentHover: setHotLootCurrentHover,
    } = useHotLoot({
        connection,
        playerIdentity: identity,
        interactingWith: interactingWith,
        // Pass container data for smart routing
        woodenStorageBoxes,
        stashes,
        campfires,
        fumaroles,
        brothPots,
    });

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
                            const HEALING_RANGE = REMOTE_HEALING_RANGE_PX;
                            
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

    // Determine if there's an active seawater poisoning effect for the local player
    const isPlayerSeawaterPoisoned = React.useMemo(() => {
        if (!localPlayer || !activeConsumableEffects || activeConsumableEffects.size === 0) return false;

        const localPlayerIdHex = localPlayer.identity.toHexString();
        let foundMatch = false;
        activeConsumableEffects.forEach((effect) => {
            const effectPlayerIdHex = effect.playerId.toHexString();
            const effectTypeTag = effect.effectType ? (effect.effectType as any).tag : 'undefined';

            if (effectPlayerIdHex === localPlayerIdHex && effectTypeTag === 'SeawaterPoisoning') {
                foundMatch = true;
            }
        });
        return foundMatch;
    }, [localPlayer, activeConsumableEffects]);

    // Determine if there's an active food poisoning effect for the local player
    const isPlayerFoodPoisoned = React.useMemo(() => {
        if (!localPlayer || !activeConsumableEffects || activeConsumableEffects.size === 0) return false;

        const localPlayerIdHex = localPlayer.identity.toHexString();
        let foundMatch = false;
        activeConsumableEffects.forEach((effect) => {
            const effectPlayerIdHex = effect.playerId.toHexString();
            const effectTypeTag = effect.effectType ? (effect.effectType as any).tag : 'undefined';

            if (effectPlayerIdHex === localPlayerIdHex && effectTypeTag === 'FoodPoisoning') {
                foundMatch = true;
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
                    const HEALING_RANGE = REMOTE_HEALING_RANGE_PX;
                    
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
            connection.reducers.getKnockedOutStatus({});
            
            // Set up interval to call it every 2 seconds while knocked out
            intervalId = setInterval(() => {
                connection.reducers.getKnockedOutStatus({});
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

        const configIterable = connection.db.stat_thresholds_config.iter();
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

        connection.db.stat_thresholds_config.onInsert(onInsertConfigCallback);
        connection.db.stat_thresholds_config.onUpdate(onUpdateConfigCallback);
        connection.db.stat_thresholds_config.onDelete(onDeleteConfigCallback);

        return () => {
            connection.db.stat_thresholds_config.removeOnInsert(onInsertConfigCallback);
            connection.db.stat_thresholds_config.removeOnUpdate(onUpdateConfigCallback);
            connection.db.stat_thresholds_config.removeOnDelete(onDeleteConfigCallback);
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
        for (const invItem of connection.db.inventory_item.iter()) {
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
                // Close crafting screen when opening inventory
                if (showCraftingScreen) {
                    onToggleCraftingScreen();
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [showInventory, onToggleInventory, onSetInteractingWith, showCraftingScreen, onToggleCraftingScreen]);

    // Effect for crafting screen toggle keybind (B key)
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'b' || event.key === 'B') {
                // Don't trigger if typing in an input field
                const target = event.target as HTMLElement;
                if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
                    return;
                }
                event.preventDefault();
                // Toggle crafting screen
                onToggleCraftingScreen();
                // Close inventory if open when opening crafting screen
                if (!showCraftingScreen && showInventory) {
                    onToggleInventory();
                    onSetInteractingWith(null);
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [showCraftingScreen, onToggleCraftingScreen, showInventory, onToggleInventory, onSetInteractingWith]);

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
    // CRITICAL: Don't open inventory for combo menu - only open after selection
    // CRITICAL: Don't open inventory for ALK stations - they have their own dedicated panel
    useEffect(() => {
        // console.log('[PlayerUI] interactingWith changed:', interactingWith);
        if (interactingWith) {
            // ALK stations have their own dedicated panel, don't open inventory
            if (interactingWith.type === 'alk_station') {
                return;
            }
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

    // Parse Memory Grid purchased nodes into a Set<string> for CraftingUI
    const purchasedMemoryNodes = useMemo(() => {
        if (!identity || !memoryGridProgress) return new Set(['center']);
        const progress = memoryGridProgress.get(identity.toHexString());
        if (!progress || !progress.purchasedNodes) return new Set(['center']);
        // Parse the comma-separated string into a Set
        const nodes = progress.purchasedNodes.split(',').map(node => node.trim()).filter(node => node.length > 0);
        return new Set(nodes.length > 0 ? nodes : ['center']);
    }, [identity, memoryGridProgress]);

    // Helper to determine if there's an active crafting item for positioning
    const hasActiveCrafting = React.useMemo(() => {
        if (!identity || !craftingQueueItems) return false;
        return Array.from(craftingQueueItems.values())
            .some(item => item.playerIdentity && item.playerIdentity.isEqual(identity));
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
                        case 'SeawaterPoisoning':
                            effectApplies = true;
                            effectName = remainingTime > 0 ? `Salt Sickness (${Math.ceil(remainingTime)}s)` : 'Salt Sickness';
                            break;
                        case 'FoodPoisoning':
                            effectApplies = true;
                            effectName = remainingTime > 0 ? `Food Poisoning (${Math.ceil(remainingTime)}s)` : 'Food Poisoning';
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
                        const HEALING_RANGE = REMOTE_HEALING_RANGE_PX;
                        
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

    // Memoize the notifications slice to prevent infinite re-renders
    const memoizedNotifications = React.useMemo(() => {
        return acquisitionNotifications.slice(-MAX_NOTIFICATIONS_DISPLAYED);
    }, [acquisitionNotifications]);

    // Convert status effects to format expected by StatusEffectsPanel
    const getStatusEffectsForPanel = () => {
        const effects: Array<{
            id: string;
            name: string;
            emoji: string;
            type: 'positive' | 'negative' | 'neutral';
            description: string;
            duration?: number; // Make duration optional for non-timed effects like cold
        }> = [];
        
        if (!localPlayer) return effects;
        
        // Add cold status if warmth is low (same threshold as status bar glow)
        if (localPlayer.warmth < 20) {
            effects.push({
                id: 'cold',
                name: 'Cold',
                emoji: '🥶',
                type: 'negative',
                description: 'Low body temperature.'
                // No duration - this is a persistent state based on warmth level
            });
        }
        
        // NEW: Add indoors status if player is inside a shelter or enclosed building
        if (localPlayer.isInsideBuilding) {
            effects.push({
                id: 'indoors',
                name: 'Indoors',
                emoji: '🏠',
                type: 'positive',
                description: 'Protected from rain. Warmth decay reduced.\nSafe from animal and apparition attacks. Outdoor sounds are muffled.'
                // No duration - this is instant on/off based on position (shelter or building)
            });
        }
        
        // Hot Combat Ladle: check if currently equipped item is a hot combat ladle
        if (identity && localPlayerActiveEquipment?.equippedItemInstanceId) {
            const equippedInstanceId = localPlayerActiveEquipment.equippedItemInstanceId.toString();
            const equippedItem = inventoryItems.get(equippedInstanceId);
            if (equippedItem) {
                const equippedDef = itemDefinitions.get(equippedItem.itemDefId.toString());
                if (equippedDef && equippedDef.name === 'Combat Ladle' && equippedItem.itemData) {
                    try {
                        const data = JSON.parse(equippedItem.itemData);
                        if (data?.is_hot === true && data?.heated_at_micros) {
                            const HOT_LADLE_DURATION_MS = 30 * 60 * 1000; // 30 minutes
                            const heatedAtMs = data.heated_at_micros / 1000;
                            const now = Date.now();
                            const remainingSecs = Math.max(0, (heatedAtMs + HOT_LADLE_DURATION_MS - now) / 1000);

                            if (remainingSecs > 0) {
                                const hasGloves = !!localPlayerActiveEquipment.handsItemInstanceId;
                                effects.push({
                                    id: 'hot_combat_ladle',
                                    name: 'Searing Ladle',
                                    emoji: '🥄',
                                    type: 'positive',
                                    description: hasGloves
                                        ? 'Your combat ladle glows with residual heat.\n• 2× damage vs wildlife & hostile NPCs\n• Inflicts burn on hit\n• Gloves protect from self-burn'
                                        : 'Your combat ladle glows with residual heat.\n• 2× damage vs wildlife & hostile NPCs\n• Inflicts burn on hit\n⚠️ No gloves — taking self-burn damage!',
                                    duration: remainingSecs
                                });
                            }
                        }
                    } catch { /* ignore parse errors */ }
                }
            }
        }
        
        if (!activeConsumableEffects || !identity) return effects;
        
        const localPlayerIdHex = identity.toHexString();
        const now = Date.now();
        
        // Extract effects with durations from activeConsumableEffects
        activeConsumableEffects.forEach((effect) => {
            const effectPlayerIdHex = effect.playerId.toHexString();
            const effectTargetPlayerIdHex = effect.targetPlayerId ? effect.targetPlayerId.toHexString() : null;
            const effectTypeTag = effect.effectType ? (effect.effectType as any).tag : 'undefined';
            
            // Calculate remaining time with small buffer to prevent flicker during updates
            const endsAtTime = effect.endsAt ? Number(effect.endsAt.microsSinceUnixEpoch / 1000n) : now;
            const remainingTime = Math.max(0, (endsAtTime - now) / 1000);
            // Add small buffer for effects that are being actively extended (like burn from campfire)
            const bufferedRemainingTime = remainingTime > 0 ? Math.max(0.5, remainingTime) : 0;
            
            // Check if this effect applies to the local player
            let effectApplies = false;
            let effectData = null;
            
            if (effectPlayerIdHex === localPlayerIdHex) {
                switch (effectTypeTag) {
                    case 'Bleed':
                        effectApplies = true;
                        const totalDamage = effect.totalAmount ?? 0;
                        const appliedDamage = effect.amountAppliedSoFar ?? 0;
                        const remainingDamage = totalDamage - appliedDamage;
                        effectData = {
                            id: 'bleeding',
                            name: 'Bleeding',
                            emoji: '🩸',
                            type: 'negative' as const,
                            description: `Losing blood from wounds. ${remainingDamage.toFixed(1)} damage remaining.`,
                            duration: bufferedRemainingTime
                        };
                        break;
                    case 'Venom':
                        effectApplies = true;
                        effectData = {
                            id: 'venom',
                            name: 'Venom',
                            emoji: '🐍',
                            type: 'negative' as const,
                            description: 'Deadly toxins coursing through your veins.',
                            duration: bufferedRemainingTime
                        };
                        break;
                    case 'Entrainment':
                        effectApplies = true;
                        effectData = {
                            id: 'entrainment',
                            name: 'Entrainment',
                            emoji: '🌀',
                            type: 'negative' as const,
                            description: 'The memory shards have consumed your mind. Reality fractures around you. This effect cannot be removed.',
                            // No duration - permanent effect until death
                        };
                        break;
                    case 'Burn':
                        effectApplies = true;
                        effectData = {
                            id: 'burning',
                            name: 'Burning',
                            emoji: '🔥',
                            type: 'negative' as const,
                            description: 'Taking fire damage over time.',
                            duration: bufferedRemainingTime
                        };
                        break;
                    case 'Stun':
                        effectApplies = true;
                        effectData = {
                            id: 'stunned',
                            name: 'Stunned',
                            emoji: '💫',
                            type: 'negative' as const,
                            description: 'Immobilized by a crushing blow!',
                            duration: bufferedRemainingTime
                        };
                        break;
                    case 'HealthRegen':
                    case 'BandageBurst':
                        effectApplies = true;
                        effectData = {
                            id: 'healing',
                            name: 'Healing',
                            emoji: '💚',
                            type: 'positive' as const,
                            description: 'Recovering health over time',
                            duration: bufferedRemainingTime
                        };
                        break;
                    case 'SeawaterPoisoning':
                        effectApplies = true;
                        effectData = {
                            id: 'seawater_poisoning',
                            name: 'Salt Sickness',
                            emoji: '🧂',
                            type: 'negative' as const,
                            description: 'Dehydration from drinking seawater',
                            duration: bufferedRemainingTime
                        };
                        break;
                    case 'FoodPoisoning':
                        effectApplies = true;
                        effectData = {
                            id: 'food_poisoning',
                            name: 'Food Poisoning',
                            emoji: '🤢',
                            type: 'negative' as const,
                            description: 'Nausea and sickness from bad food',
                            duration: bufferedRemainingTime
                        };
                        break;
                    case 'Cozy':
                        effectApplies = true;
                        effectData = {
                            id: 'cozy',
                            name: 'Cozy',
                            emoji: '🧣',
                            type: 'positive' as const,
                            description: 'Feeling warm and comfortable.',
                            // No duration - permanent effect
                        };
                        break;
                    case 'TreeCover':
                        effectApplies = true;
                        effectData = {
                            id: 'tree_cover',
                            name: 'Tree Cover',
                            emoji: '🌳',
                            type: 'positive' as const,
                            description: 'Protected by natural tree cover.',
                            // No duration - permanent effect based on proximity
                        };
                        break;
                    case 'Wet':
                        effectApplies = true;
                        // Wetness percentage is now stored in totalAmount (0.0 to 1.0)
                        // Convert to 0-60 range for StatusEffectsPanel display logic (60 = 100%)
                        const wetnessPercent = effect.totalAmount ?? 1.0; // Default to 100% if not set
                        const wetnessAsDuration = wetnessPercent * 60; // Scale to 0-60 for display
                        effectData = {
                            id: 'wet',
                            name: 'Wet',
                            emoji: '💧',
                            type: 'negative' as const,
                            description: 'Soaked from rain or water.',
                            duration: wetnessAsDuration
                        };
                        break;
                    case 'Exhausted':
                        effectApplies = true;
                        effectData = {
                            id: 'exhausted',
                            name: 'Withering',
                            emoji: '😵‍💫',
                            type: 'negative' as const,
                            description: 'Movement slowed by severe hunger or thirst. Body weakening from lack of sustenance.',
                            // No duration - permanent effect based on needs
                        };
                        break;
                    case 'ProductionRune':
                        effectApplies = true;
                        effectData = {
                            id: 'production_rune',
                            name: 'Production Zone',
                            emoji: '⚙️',
                            type: 'positive' as const,
                            description: 'The crimson runestone\'s power surges through your tools. Crafting stations hum with enhanced efficiency, bending metal and stone to your will with supernatural speed.',
                            // No duration - permanent while in zone
                        };
                        break;
                    case 'AgrarianRune':
                        effectApplies = true;
                        effectData = {
                            id: 'agrarian_rune',
                            name: 'Agrarian Zone',
                            emoji: '🌾',
                            type: 'positive' as const,
                            description: 'The emerald runestone pulses with primal life force. Seeds sprout faster, crops flourish with unnatural vigor, and the very earth yields its bounty more readily.',
                            // No duration - permanent while in zone
                        };
                        break;
                    case 'MemoryRune':
                        effectApplies = true;
                        effectData = {
                            id: 'blue_runestone',
                            name: 'Echoes Resonate',
                            emoji: '🔮',
                            type: 'neutral' as const,
                            description: 'The azure runestone whispers forgotten truths. When darkness falls, fragments of lost memories crystallize from the aether.',
                            // No duration - permanent while in zone
                        };
                        break;
                    case 'HotSpring':
                        effectApplies = true;
                        effectData = {
                            id: 'hot_spring',
                            name: 'Hot Spring',
                            emoji: '♨️',
                            type: 'positive' as const,
                            description: 'Soaking in healing hot spring waters.',
                            // No duration - permanent while in hot spring
                        };
                        break;
                    case 'Fumarole':
                        effectApplies = true;
                        effectData = {
                            id: 'fumarole',
                            name: 'Fumarole Warmth',
                            emoji: '🌋',
                            type: 'positive' as const,
                            description: 'Protected by volcanic heat.',
                            // No duration - permanent while near fumarole
                        };
                        break;
                    case 'SafeZone':
                        effectApplies = true;
                        effectData = {
                            id: 'safe_zone',
                            name: 'Safe Zone',
                            emoji: '🛡️',
                            type: 'positive' as const,
                            description: 'Protected from player, animal, and projectile damage.',
                            // No duration - permanent while in safe zone
                        };
                        break;
                    case 'FishingVillageBonus':
                        effectApplies = true;
                        effectData = {
                            id: 'fishing_village_bonus',
                            name: 'Aleut Fishing Waters',
                            emoji: '🎣',
                            type: 'positive' as const,
                            description: 'The waters teem with life, and the villagers share secret fishing spots to those who listen.',
                            // No duration - permanent while in fishing village zone
                        };
                        break;
                    case 'NearCookingStation':
                        effectApplies = true;
                        effectData = {
                            id: 'near_cooking_station',
                            name: 'Cooking Station',
                            emoji: '👨‍🍳',
                            type: 'positive' as const,
                            description: 'Near a cooking station. Advanced food recipes can now be crafted from the crafting menu.',
                            // No duration - permanent while near cooking station
                        };
                        break;
                    case 'LagunovGhost':
                        effectApplies = true;
                        effectData = {
                            id: 'lagunov_ghost',
                            name: "Lagunov's Ghost",
                            emoji: '⚓',
                            type: 'positive' as const,
                            description: "The spirit of Admiral Lagunov lingers after her recent sacrifice, shielding you from night terrors while you remain near the wreck. The bravery that doomed her ship now keeps others safe.",
                            // No duration - permanent while in shipwreck zone
                        };
                        break;
                    case 'MemoryBeaconSanity':
                        effectApplies = true;
                        effectData = {
                            id: 'memory_beacon_sanity',
                            name: 'Sanity Haven',
                            emoji: '🧠',
                            type: 'positive' as const,
                            description: 'The Memory Resonance Beacon creates a pocket of stable reality. Your mind is protected from shard-induced insanity while within its field.',
                            // No duration - permanent while in beacon zone
                        };
                        break;
                    case 'BuildingPrivilege':
                        // Only show building privilege status if player is within range of a hearth
                        const BUILDING_PRIVILEGE_RADIUS_SQUARED = 1000.0 * 1000.0; // 1000px radius (doubled from 500px)
                        let isWithinHearthRange = false;
                        
                        if (localPlayer && homesteadHearths) {
                            for (const hearth of homesteadHearths.values()) {
                                if (hearth.isDestroyed) continue;
                                
                                const dx = localPlayer.positionX - hearth.posX;
                                const dy = localPlayer.positionY - hearth.posY;
                                const distanceSquared = dx * dx + dy * dy;
                                
                                if (distanceSquared <= BUILDING_PRIVILEGE_RADIUS_SQUARED) {
                                    isWithinHearthRange = true;
                                    break;
                                }
                            }
                        }
                        
                        // Only show the effect if within range
                        if (isWithinHearthRange) {
                            effectApplies = true;
                            effectData = {
                                id: 'building_privilege',
                                name: 'Building Privilege',
                                emoji: '🏗️',
                                type: 'positive' as const,
                                description: 'Can upgrade structures near matron\'s chests.',
                                // No duration - effectively permanent until revoked
                            };
                        }
                        break;
                    // === NEW BREWING SYSTEM EFFECTS (stub UI - logic to be implemented) ===
                    case 'Intoxicated':
                        effectApplies = true;
                        effectData = {
                            id: 'intoxicated',
                            name: 'Intoxicated',
                            emoji: '🍺',
                            type: 'negative' as const,
                            description: 'Vision blurred, movement impaired from alcohol.',
                            duration: bufferedRemainingTime
                        };
                        break;
                    case 'Poisoned':
                        effectApplies = true;
                        effectData = {
                            id: 'poisoned',
                            name: 'Poisoned',
                            emoji: '☠️',
                            type: 'negative' as const,
                            description: 'Taking poison damage over time.',
                            duration: bufferedRemainingTime
                        };
                        break;
                    case 'SpeedBoost':
                        effectApplies = true;
                        effectData = {
                            id: 'speed_boost',
                            name: 'Speed Boost',
                            emoji: '⚡',
                            type: 'positive' as const,
                            description: 'Movement speed increased.',
                            duration: bufferedRemainingTime
                        };
                        break;
                    case 'StaminaBoost':
                        effectApplies = true;
                        effectData = {
                            id: 'stamina_boost',
                            name: 'Stamina Boost',
                            emoji: '💪',
                            type: 'positive' as const,
                            description: 'Hunger and thirst drain reduced.',
                            duration: bufferedRemainingTime
                        };
                        break;
                    case 'NightVision':
                        effectApplies = true;
                        effectData = {
                            id: 'night_vision',
                            name: 'Night Vision',
                            emoji: '👁️',
                            type: 'positive' as const,
                            description: 'Enhanced vision in darkness.',
                            duration: bufferedRemainingTime
                        };
                        break;
                    case 'WarmthBoost':
                        effectApplies = true;
                        effectData = {
                            id: 'warmth_boost',
                            name: 'Warmth Boost',
                            emoji: '🔥',
                            type: 'positive' as const,
                            description: 'Warmth protection increased.',
                            duration: bufferedRemainingTime
                        };
                        break;
                    case 'ColdResistance':
                        effectApplies = true;
                        effectData = {
                            id: 'cold_resistance',
                            name: 'Cold Resistance',
                            emoji: '🧊',
                            type: 'positive' as const,
                            description: 'Reduced cold damage.',
                            duration: bufferedRemainingTime
                        };
                        break;
                    case 'PoisonResistance':
                        effectApplies = true;
                        effectData = {
                            id: 'poison_resistance',
                            name: 'Poison Resistance',
                            emoji: '🛡️',
                            type: 'positive' as const,
                            description: 'Reduced poison and venom damage.',
                            duration: bufferedRemainingTime
                        };
                        break;
                    case 'FireResistance':
                        effectApplies = true;
                        effectData = {
                            id: 'fire_resistance',
                            name: 'Fire Resistance',
                            emoji: '🔥',
                            type: 'positive' as const,
                            description: 'Reduced fire and burn damage.',
                            duration: bufferedRemainingTime
                        };
                        break;
                    case 'PoisonCoating':
                        effectApplies = true;
                        effectData = {
                            id: 'poison_coating',
                            name: 'Poison Coating',
                            emoji: '💀',
                            type: 'positive' as const,
                            description: 'Weapons inflict poison on targets.',
                            duration: bufferedRemainingTime
                        };
                        break;
                    case 'PassiveHealthRegen':
                        effectApplies = true;
                        effectData = {
                            id: 'passive_health_regen',
                            name: 'Regeneration',
                            emoji: '💚',
                            type: 'positive' as const,
                            description: 'Slowly regenerating health over time.',
                            duration: bufferedRemainingTime
                        };
                        break;
                    case 'HarvestBoost':
                        effectApplies = true;
                        effectData = {
                            id: 'harvest_boost',
                            name: 'Harvest Boost',
                            emoji: '⚒️',
                            type: 'positive' as const,
                            description: 'Increased yield from mining and chopping.',
                            duration: bufferedRemainingTime
                        };
                        break;
                    case 'BrewCooldown':
                        effectApplies = true;
                        effectData = {
                            id: 'brew_cooldown',
                            name: 'Brew Cooldown',
                            emoji: '🍲',
                            type: 'negative' as const,
                            description: 'Cannot drink another broth pot brew until the cooldown expires.',
                            duration: bufferedRemainingTime
                        };
                        break;
                    case 'ChewingGum':
                        effectApplies = true;
                        effectData = {
                            id: 'chewing_gum',
                            name: 'Chewing Gum',
                            emoji: '🫧',
                            type: 'neutral' as const,
                            description: 'Stale but still minty. Others can hear you chewing.',
                            duration: bufferedRemainingTime
                        };
                        break;
                    // HotCombatLadle is handled above via equipped item state, not ActiveConsumableEffect
                }
            } else if (effectTargetPlayerIdHex === localPlayerIdHex && effectTypeTag === 'RemoteBandageBurst') {
                // Check if remote bandage healer is in range
                const healer = players.get(effectPlayerIdHex);
                const target = players.get(localPlayerIdHex);
                
                if (healer && target) {
                    const dx = healer.positionX - target.positionX;
                    const dy = healer.positionY - target.positionY;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    const HEALING_RANGE = REMOTE_HEALING_RANGE_PX;
                    
                    if (distance <= HEALING_RANGE) {
                        effectApplies = true;
                        effectData = {
                            id: 'being_bandaged',
                            name: 'Being Bandaged',
                            emoji: '🩹',
                            type: 'positive' as const,
                            description: 'Being healed by another player',
                            duration: bufferedRemainingTime
                        };
                    }
                }
            }
            
            // Show effect if it has remaining time OR is a permanent effect
            const isPermanentEffect = effectData && (
                effectData.id === 'cozy' || 
                effectData.id === 'tree_cover' || 
                effectData.id === 'exhausted' || 
                effectData.id === 'building_privilege' || 
                effectData.id === 'production_rune' || 
                effectData.id === 'agrarian_rune' || 
                effectData.id === 'safe_zone' || 
                effectData.id === 'fumarole' || 
                effectData.id === 'hot_spring' || 
                effectData.id === 'blue_runestone' ||
                effectData.id === 'lagunov_ghost'
            );
            
            if (effectApplies && effectData && (bufferedRemainingTime > 0 || isPermanentEffect)) {
                effects.push(effectData);
            }
        });
        
        // Check for equipped bone totems (back slot equipment)
        if (identity && activeEquipments && itemDefinitions && inventoryItems) {
            const playerEquipment = Array.from(activeEquipments.values())
                .find(eq => eq.playerIdentity && eq.playerIdentity.isEqual(identity));
            
            if (playerEquipment?.backItemInstanceId) {
                // Find the inventory item first, then look up the definition
                const backInventoryItem = Array.from(inventoryItems.values())
                    .find(item => item.instanceId === playerEquipment.backItemInstanceId);
                const backItemDef = backInventoryItem 
                    ? itemDefinitions.get(backInventoryItem.itemDefId.toString())
                    : undefined;
                if (backItemDef) {
                    // Bone totem name patterns and their status info
                    const boneTotemStatusMap: Record<string, { emoji: string; description: string }> = {
                        'Kayux Amulet': { emoji: '🦊', description: 'Fox spirit: -20% animal detection radius' },
                        'Sabaakax Totem': { emoji: '🐺', description: 'Wolf spirit: +15% damage when allies nearby' },
                        "Qax'aadax Totem": { emoji: '🐍', description: 'Viper spirit: +1 poison damage on melee hits' },
                        'Tugix Totem': { emoji: '🦭', description: 'Walrus spirit: +15% cold resistance, +10 max HP' },
                        'Tunux Charm': { emoji: '🐀', description: 'Vole spirit: +25% harvest yield' },
                        'Qilax Totem': { emoji: '🦡', description: 'Wolverine spirit: +30% damage when low health' },
                        'Tanuux Totem': { emoji: '🐻', description: 'Polar bear spirit: +15% melee damage, knockback immunity' },
                        'Ulax Charm': { emoji: '🐇', description: 'Hare spirit: +8% movement speed' },
                        'Angunax Totem': { emoji: '🦉', description: 'Owl spirit: permanent night vision' },
                        'Alax Totem': { emoji: '🦈', description: 'Shark spirit: +15% water speed, 10% bleed on melee' },
                        'Tayngax Totem': { emoji: '🐦', description: 'Tern spirit: -15% hunger/thirst drain' },
                    };
                    
                    const totemInfo = boneTotemStatusMap[backItemDef.name];
                    if (totemInfo) {
                        effects.push({
                            id: 'bone_totem',
                            name: backItemDef.name,
                            emoji: totemInfo.emoji,
                            type: 'positive' as const,
                            description: totemInfo.description,
                            // No duration - permanent while equipped
                        });
                    }
                }
            }
        }
        
        return effects;
    };

    if (!localPlayer) {
        return null;
    }

    // --- Render without DndContext/Overlay ---
    return (
      // <DndContext...> // Remove wrapper
        <>
            {/* --- NEW: Render Item Acquisition Notifications --- */}
            <ItemAcquisitionNotificationUI 
                notifications={memoizedNotifications} 
                hasActiveCrafting={hasActiveCrafting}
                hasActiveStatusEffects={getStatusEffectsForPanel().length > 0}
            />
            {/* --- END NEW --- */}

            {/* --- NEW: Active Crafting Queue UI --- */}
            <ActiveCraftingQueueUI 
                craftingQueueItems={craftingQueueItems}
                itemDefinitions={itemDefinitions}
                playerIdentity={identity}
                connection={connection}
            />
            {/* --- END NEW --- */}

            {/* --- NEW: Cyberpunk Knocked Out Screen --- */}
            {localPlayer?.isKnockedOut && (
                <CyberpunkKnockedOutScreen knockedOutStatus={localPlayerKnockedOutStatus} />
            )}
            {/* --- END NEW: Cyberpunk Knocked Out Screen --- */}

            {/* Status Effects Panel - positioned differently on mobile */}
            {!isMobile && <StatusEffectsPanel effects={getStatusEffectsForPanel()} />}

            {/* Mobile Status Display - TOP RIGHT corner, compact horizontal pill */}
            {isMobile ? (
                <>
                    {/* Status Bars - Fixed at top right */}
                    <div style={{
                        position: 'fixed',
                        top: '10px',
                        right: '10px',
                        display: 'flex',
                        gap: '6px',
                        background: 'linear-gradient(135deg, rgba(10, 5, 20, 0.92), rgba(20, 10, 40, 0.95))',
                        padding: '6px 10px',
                        borderRadius: '16px',
                        border: '1px solid rgba(0, 170, 255, 0.5)',
                        boxShadow: '0 2px 10px rgba(0, 0, 0, 0.5)',
                        zIndex: 9996,
                    }}>
                        {/* HP Bar */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                            <img src={heartIcon} alt="HP" style={{ width: '14px', height: '14px', imageRendering: 'pixelated' }} />
                            <div style={{
                                width: '36px',
                                height: '6px',
                                background: 'rgba(0,0,0,0.5)',
                                borderRadius: '3px',
                                overflow: 'hidden',
                            }}>
                                <div style={{
                                    width: `${(localPlayer.health / 100) * 100}%`,
                                    height: '100%',
                                    background: localPlayer.health < lowNeedThreshold 
                                        ? 'linear-gradient(90deg, #ff2020, #ff4040)' 
                                        : 'linear-gradient(90deg, #cc3030, #ff4040)',
                                    boxShadow: localPlayer.health < lowNeedThreshold ? '0 0 4px #ff4040' : 'none',
                                    transition: 'width 0.3s ease',
                                }} />
                            </div>
                        </div>
                        
                        {/* Thirst Bar */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                            <img src={thirstIcon} alt="Thirst" style={{ width: '14px', height: '14px', imageRendering: 'pixelated' }} />
                            <div style={{
                                width: '36px',
                                height: '6px',
                                background: 'rgba(0,0,0,0.5)',
                                borderRadius: '3px',
                                overflow: 'hidden',
                            }}>
                                <div style={{
                                    width: `${(localPlayer.thirst / 250) * 100}%`,
                                    height: '100%',
                                    background: localPlayer.thirst < lowNeedThreshold 
                                        ? 'linear-gradient(90deg, #2080ff, #40a0ff)' 
                                        : 'linear-gradient(90deg, #3080cc, #40a0ff)',
                                    boxShadow: localPlayer.thirst < lowNeedThreshold ? '0 0 4px #40a0ff' : 'none',
                                    transition: 'width 0.3s ease',
                                }} />
                            </div>
                        </div>
                        
                        {/* Hunger Bar */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                            <img src={hungerIcon} alt="Hunger" style={{ width: '14px', height: '14px', imageRendering: 'pixelated' }} />
                            <div style={{
                                width: '36px',
                                height: '6px',
                                background: 'rgba(0,0,0,0.5)',
                                borderRadius: '3px',
                                overflow: 'hidden',
                            }}>
                                <div style={{
                                    width: `${(localPlayer.hunger / 250) * 100}%`,
                                    height: '100%',
                                    background: localPlayer.hunger < lowNeedThreshold 
                                        ? 'linear-gradient(90deg, #ff8020, #ffa040)' 
                                        : 'linear-gradient(90deg, #cc7030, #ffa040)',
                                    boxShadow: localPlayer.hunger < lowNeedThreshold ? '0 0 4px #ffa040' : 'none',
                                    transition: 'width 0.3s ease',
                                }} />
                            </div>
                        </div>
                        
                        {/* XP Bar (Mobile) - Compact version */}
                        {localPlayerStats && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                                <span style={{ 
                                    fontSize: '10px', 
                                    color: '#00ff88', 
                                    fontWeight: 'bold',
                                    minWidth: '20px',
                                    textAlign: 'center',
                                }}>L{xpProgress.level}</span>
                                <div style={{
                                    width: '36px',
                                    height: '6px',
                                    background: 'rgba(0,0,0,0.5)',
                                    borderRadius: '3px',
                                    overflow: 'hidden',
                                }}>
                                    <div style={{
                                        width: `${xpProgress.percent}%`,
                                        height: '100%',
                                        background: 'linear-gradient(90deg, #00cc66, #00ff88)',
                                        transition: 'width 0.3s ease',
                                    }} />
                                </div>
                            </div>
                        )}
                    </div>
                    
                    {/* Status Effects - Positioned BELOW the Day/Night tracker with equal spacing */}
                    {getStatusEffectsForPanel().length > 0 && (
                        <div style={{
                            position: 'fixed',
                            top: '108px', // Below Day/Night tracker (~42px + ~56px) + 10px gap
                            right: '10px',
                            display: 'flex',
                            gap: '3px',
                            background: 'rgba(0, 0, 0, 0.7)',
                            padding: '4px 8px',
                            borderRadius: '10px',
                            zIndex: 9994,
                        }}>
                            {getStatusEffectsForPanel().slice(0, 5).map((effect) => (
                                <div
                                    key={effect.id}
                                    style={{
                                        fontSize: '12px',
                                        filter: `drop-shadow(0 0 2px ${effect.type === 'positive' ? '#00ff88' : effect.type === 'negative' ? '#ff4444' : '#ffaa00'})`,
                                    }}
                                    title={`${effect.name}${effect.duration ? ` - ${Math.ceil(effect.duration)}s` : ''}`}
                                >
                                    {effect.emoji}
                                </div>
                            ))}
                        </div>
                    )}
                </>
            ) : (
                /* Desktop Status Bars UI */
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
                        hasFoodPoisoningEffect={isPlayerFoodPoisoned}
                        pendingHealAmount={pendingBandageHealAmount}
                        glow={localPlayer.health < lowNeedThreshold}
                    />
                    {/* <StatusBar label="SP" iconType="stamina" value={localPlayer.stamina} maxValue={100} barColor="#40ff40" /> */}
                    {/*
                      Glow/pulse effect for Thirst, Hunger, Warmth when below LOW_NEED_THRESHOLD (20.0),
                      matching server logic for stat penalties/health loss. This helps players realize
                      why they're thirsty/hungry/cold and should take action soon.
                    */}
                    <StatusBar label="Thirst" iconType="thirst" value={localPlayer.thirst} maxValue={250} barColor="#40a0ff" glow={localPlayer.thirst < lowNeedThreshold} hasSeawaterPoisoningEffect={isPlayerSeawaterPoisoned} />
                    <StatusBar label="Hunger" iconType="hunger" value={localPlayer.hunger} maxValue={250} barColor="#ffa040" glow={localPlayer.hunger < lowNeedThreshold} />
                    {/* <StatusBar label="Warmth" iconType="warmth" value={localPlayer.warmth} maxValue={100} barColor="#ffcc00" glow={localPlayer.warmth < lowNeedThreshold} /> */}
                    {/* XP Bar moved to above Hotbar (WoW style) */}
                </div>
            )}

            {/* Render Inventory UI conditionally - Pass props down */}
            {showInventory && (
                <InventoryUI
                    playerIdentity={identity}
                    onClose={handleClose}
                    inventoryItems={inventoryItems}
                    itemDefinitions={itemDefinitions}
                    rangedWeaponStats={rangedWeaponStats}
                    connection={connection}
                    activeEquipments={activeEquipments}
                    onItemDragStart={onItemDragStart}
                    onItemDrop={onItemDrop}
                    draggedItemInfo={draggedItemInfo}
                    interactionTarget={interactingWith}
                    campfires={campfires}
                    furnaces={furnaces}
                    barbecues={barbecues}
                    fumaroles={fumaroles}
                    lanterns={lanterns}
                    turrets={turrets}
                    woodenStorageBoxes={woodenStorageBoxes}
                    playerCorpses={playerCorpses}
                    stashes={stashes}
                    rainCollectors={rainCollectors}
                    brothPots={brothPots}
                    homesteadHearths={homesteadHearths}
                    startPlacement={startPlacement}
                    cancelPlacement={cancelPlacement}
                    placementInfo={placementInfo}
                    currentStorageBox={currentStorageBox}
                    recipes={recipes}
                    craftingQueueItems={craftingQueueItems}
                    onCraftingSearchFocusChange={onCraftingSearchFocusChange}
                    worldState={worldState}
                    players={players}
                    activeConsumableEffects={activeConsumableEffects}
                    chunkWeather={chunkWeather}
                    purchasedMemoryNodes={purchasedMemoryNodes}
                    isHotLootActive={isHotLootActive}
                    getSlotIndicator={getSlotIndicator}
                    handleHotLootSlotHover={handleHotLootSlotHover}
                    setHotLootCurrentHover={setHotLootCurrentHover}
                    selectedInventoryItem={selectedInventoryItem}
                    onSelectInventoryItem={handleSelectInventoryItem}
                    onCloseItemInteraction={handleCloseItemInteraction}
                    onOpenBoneCarving={handleOpenBoneCarving}
                    onOpenRadio={handleOpenRadio}
                 />
             )}

            {/* Crafting Screen - Full screen crafting panel opened with B key */}
            {showCraftingScreen && (
                <CraftingScreen
                    playerIdentity={identity}
                    recipes={recipes}
                    craftingQueueItems={craftingQueueItems}
                    itemDefinitions={itemDefinitions}
                    inventoryItems={inventoryItems}
                    connection={connection}
                    onClose={onToggleCraftingScreen}
                    onSearchFocusChange={onCraftingSearchFocusChange}
                    purchasedMemoryNodes={purchasedMemoryNodes}
                    activeConsumableEffects={activeConsumableEffects}
                />
            )}

            {/* Bone Carving Panel - Opened via Bone Carving Kit item interaction */}
            {showBoneCarvingPanel && (
                <BoneCarvingPanel
                    playerIdentity={identity}
                    craftingQueueItems={craftingQueueItems}
                    itemDefinitions={itemDefinitions}
                    inventoryItems={inventoryItems}
                    connection={connection}
                    onClose={handleCloseBoneCarving}
                />
            )}

            {/* Radio Panel - Opened via Transistor Radio item interaction */}
            {showRadioPanel && (
                <RadioPanel
                    playerIdentity={identity}
                    connection={connection}
                    onClose={handleCloseRadio}
                />
            )}

            {/* Hotbar Area - Desktop only, hidden on mobile */}
            {!isMobile && (
                <Hotbar
                    playerIdentity={identity}
                    localPlayer={localPlayer}
                    rangedWeaponStats={rangedWeaponStats}
                    itemDefinitions={itemDefinitions}
                    inventoryItems={inventoryItems}
                    connection={connection}
                    onItemDragStart={onItemDragStart}
                    onItemDrop={onItemDrop}
                    draggedItemInfo={draggedItemInfo}
                    interactingWith={interactingWith}
                    brothPots={brothPots}
                    campfires={campfires}
                    fumaroles={fumaroles}
                    stashes={stashes}
                    startPlacement={startPlacement}
                    cancelPlacement={cancelPlacement}
                    activeConsumableEffects={activeConsumableEffects}
                    activeEquipment={localPlayerActiveEquipment}
                    isGameMenuOpen={isGameMenuOpen}
                    placementInfo={placementInfo}
                    isHotLootActive={isHotLootActive}
                    getSlotIndicator={getSlotIndicator}
                    handleHotLootSlotHover={handleHotLootSlotHover}
                    setHotLootCurrentHover={setHotLootCurrentHover}
                    playerStats={playerStats}
                    isInventoryOpen={showInventory}
                    onSelectInventoryItem={showInventory ? handleSelectInventoryItem : undefined}
                />
            )}

            {/* ItemInteractionPanel is now rendered inside InventoryUI to avoid duplication */}
            {/* It handles items selected from inventory, hotbar, and external containers */}

            {/* Drag Overlay is removed - ghost handled by DraggableItem */}
       </>
      // </DndContext...> // Remove wrapper
    );
};

export default React.memo(PlayerUI);
