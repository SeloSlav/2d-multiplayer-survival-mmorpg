/******************************************************************************
 * ExternalContainerUI.tsx                                                     *
 * -------------------------------------------------------------------------- *
 * Manages the UI for external containers like campfires, wooden storage      *
 * boxes, player corpses, and stashes. Displays items, handles               *
 * drag-and-drop interactions, and context menus for these containers.        *
 ******************************************************************************/

import React, { useCallback, useMemo, useRef } from 'react';
import styles from './InventoryUI.module.css'; // Reuse styles for now

// Import Custom Components
import DraggableItem from './DraggableItem';
import DroppableSlot from './DroppableSlot';

// Import Types
import { 
    ItemDefinition, InventoryItem, DbConnection, 
    Campfire as SpacetimeDBCampfire,
    Lantern as SpacetimeDBLantern, 
    WoodenStorageBox as SpacetimeDBWoodenStorageBox, 
    PlayerCorpse, 
    Stash as SpacetimeDBStash, // Added Stash type
    Shelter as SpacetimeDBShelter, // Added Shelter type
    Tree as SpacetimeDBTree, // Added Tree type
    WorldState
} from '../generated';
import { InteractionTarget } from '../hooks/useInteractionManager';
import { DragSourceSlotInfo, DraggedItemInfo } from '../types/dragDropTypes';
import { PopulatedItem } from './InventoryUI';

// Constants
const NUM_FUEL_SLOTS = 5;
const NUM_LANTERN_FUEL_SLOTS = 2; // Lanterns have 2 fuel slots
const NUM_BOX_SLOTS = 18;
const NUM_CORPSE_SLOTS = 30;
const NUM_STASH_SLOTS = 6; // Added for Stash
const BOX_COLS = 6;
const CORPSE_COLS = 6;
const STASH_COLS = 6; // Stash layout: 1 row of 6

interface ExternalContainerUIProps {
    interactionTarget: InteractionTarget;
    inventoryItems: Map<string, InventoryItem>;
    itemDefinitions: Map<string, ItemDefinition>;
    campfires: Map<string, SpacetimeDBCampfire>;
    lanterns: Map<string, SpacetimeDBLantern>;
    woodenStorageBoxes: Map<string, SpacetimeDBWoodenStorageBox>;
    playerCorpses: Map<string, PlayerCorpse>;
    stashes: Map<string, SpacetimeDBStash>; // Added stashes
    shelters?: Map<string, SpacetimeDBShelter>; // Added shelters (optional)
    trees?: Map<string, SpacetimeDBTree>; // Added trees (optional)
    currentStorageBox?: SpacetimeDBWoodenStorageBox | null;
    // currentStash will be derived like currentCampfire/currentCorpse
    connection: DbConnection | null;
    onItemDragStart: (info: DraggedItemInfo) => void;
    onItemDrop: (targetSlotInfo: DragSourceSlotInfo | null) => void;
    playerId: string | null; // Need player ID to check ownership for hiding stash
    onExternalItemMouseEnter: (item: PopulatedItem, event: React.MouseEvent<HTMLDivElement>) => void;
    onExternalItemMouseLeave: () => void;
    onExternalItemMouseMove: (event: React.MouseEvent<HTMLDivElement>) => void;
    worldState: WorldState | null;
}

const ExternalContainerUI: React.FC<ExternalContainerUIProps> = ({
    interactionTarget,
    inventoryItems,
    itemDefinitions,
    campfires,
    lanterns,
    woodenStorageBoxes,
    playerCorpses,
    stashes, // Added stashes
    shelters, // Added shelters
    trees, // Added trees
    currentStorageBox,
    connection,
    onItemDragStart,
    onItemDrop,
    playerId,
    onExternalItemMouseEnter,
    onExternalItemMouseLeave,
    onExternalItemMouseMove,
    worldState,
}) => {
    // Add ref to track when drag operations complete
    const lastDragCompleteTime = useRef<number>(0);

    // Wrap the onItemDrop to track completion times
    const handleItemDropWithTracking = useCallback((targetSlotInfo: DragSourceSlotInfo | null) => {
        lastDragCompleteTime.current = Date.now();
        // console.log('[ExternalContainerUI] Drag operation completed at:', lastDragCompleteTime.current);
        onItemDrop(targetSlotInfo);
    }, [onItemDrop]);

    // --- Derived Data for Campfire ---
    const isCampfireInteraction = interactionTarget?.type === 'campfire';
    const campfireIdNum = isCampfireInteraction ? Number(interactionTarget!.id) : null;
    const currentCampfire = campfireIdNum !== null ? campfires.get(campfireIdNum.toString()) : undefined;
    const fuelItems = useMemo(() => {
        const items: (PopulatedItem | null)[] = Array(NUM_FUEL_SLOTS).fill(null);
        if (!isCampfireInteraction || !currentCampfire) return items;
        const instanceIds = [
            currentCampfire.fuelInstanceId0, currentCampfire.fuelInstanceId1, currentCampfire.fuelInstanceId2,
            currentCampfire.fuelInstanceId3, currentCampfire.fuelInstanceId4,
        ];
        instanceIds.forEach((instanceIdOpt, index) => {
            if (instanceIdOpt) {
                const instanceIdStr = instanceIdOpt.toString();
                const foundInvItem = inventoryItems.get(instanceIdStr);
                if (foundInvItem) {
                    const definition = itemDefinitions.get(foundInvItem.itemDefId.toString());
                    if (definition) {
                        items[index] = { instance: foundInvItem, definition };
                    }
                }
            }
        });
        return items;
    }, [isCampfireInteraction, currentCampfire, inventoryItems, itemDefinitions]);

    // --- Derived Data for Lantern ---
    const isLanternInteraction = interactionTarget?.type === 'lantern';
    const lanternIdNum = isLanternInteraction ? Number(interactionTarget!.id) : null;
    const currentLantern = lanternIdNum !== null ? lanterns.get(lanternIdNum.toString()) : undefined;
    const lanternFuelItems = useMemo(() => {
        const items: (PopulatedItem | null)[] = Array(NUM_LANTERN_FUEL_SLOTS).fill(null);
        if (!isLanternInteraction || !currentLantern) return items;
        const instanceIds = [
            currentLantern.fuelInstanceId0,
            currentLantern.fuelInstanceId1,
        ];
        instanceIds.forEach((instanceIdOpt, index) => {
            if (instanceIdOpt) {
                const instanceIdStr = instanceIdOpt.toString();
                const foundInvItem = inventoryItems.get(instanceIdStr);
                if (foundInvItem) {
                    const definition = itemDefinitions.get(foundInvItem.itemDefId.toString());
                    if (definition) {
                        items[index] = { instance: foundInvItem, definition };
                    }
                }
            }
        });
        return items;
    }, [isLanternInteraction, currentLantern, inventoryItems, itemDefinitions]);

    // --- Derived Data for Box ---
    const isBoxInteraction = interactionTarget?.type === 'wooden_storage_box';
    const boxIdNum = isBoxInteraction ? Number(interactionTarget!.id) : null;
    const boxItems = useMemo(() => {
        const items: (PopulatedItem | null)[] = Array(NUM_BOX_SLOTS).fill(null);
        if (!isBoxInteraction || !currentStorageBox) return items;
        const instanceIds = [
            currentStorageBox.slotInstanceId0, currentStorageBox.slotInstanceId1, currentStorageBox.slotInstanceId2,
            currentStorageBox.slotInstanceId3, currentStorageBox.slotInstanceId4, currentStorageBox.slotInstanceId5,
            currentStorageBox.slotInstanceId6, currentStorageBox.slotInstanceId7, currentStorageBox.slotInstanceId8,
            currentStorageBox.slotInstanceId9, currentStorageBox.slotInstanceId10, currentStorageBox.slotInstanceId11,
            currentStorageBox.slotInstanceId12, currentStorageBox.slotInstanceId13, currentStorageBox.slotInstanceId14,
            currentStorageBox.slotInstanceId15, currentStorageBox.slotInstanceId16, currentStorageBox.slotInstanceId17,
        ];
        instanceIds.forEach((instanceIdOpt, index) => {
            if (instanceIdOpt) {
                const instanceIdStr = instanceIdOpt.toString();
                const foundInvItem = inventoryItems.get(instanceIdStr);
                if (foundInvItem) {
                    const definition = itemDefinitions.get(foundInvItem.itemDefId.toString());
                    if (definition) {
                        items[index] = { instance: foundInvItem, definition };
                    }
                }
            }
        });
        return items;
    }, [isBoxInteraction, currentStorageBox, inventoryItems, itemDefinitions]);

    // --- Derived Data for Corpse --- 
    const isCorpseInteraction = interactionTarget?.type === 'player_corpse';
    const corpseIdBigInt = isCorpseInteraction ? BigInt(interactionTarget!.id) : null;
    const corpseIdStr = corpseIdBigInt?.toString() ?? null;
    const currentCorpse = corpseIdStr !== null ? playerCorpses.get(corpseIdStr) : undefined;
    const corpseItems = useMemo(() => {
        const items: (PopulatedItem | null)[] = Array(NUM_CORPSE_SLOTS).fill(null);
        if (!isCorpseInteraction || !currentCorpse) return items;
        // Need to dynamically access slot_instance_id_N fields
        for (let i = 0; i < NUM_CORPSE_SLOTS; i++) {
            const instanceIdKey = `slotInstanceId${i}` as keyof PlayerCorpse;
            const instanceIdOpt = currentCorpse[instanceIdKey] as bigint | null | undefined;

            if (instanceIdOpt) {
                const instanceIdStr = instanceIdOpt.toString();
                const foundInvItem = inventoryItems.get(instanceIdStr);
                if (foundInvItem) {
                    const definition = itemDefinitions.get(foundInvItem.itemDefId.toString());
                    if (definition) {
                        items[i] = { instance: foundInvItem, definition };
                    }
                }
            }
        }
        return items;
    }, [isCorpseInteraction, currentCorpse, inventoryItems, itemDefinitions]);

    // --- Derived Data for Stash ---
    const isStashInteraction = interactionTarget?.type === 'stash';
    const stashIdNum = isStashInteraction ? Number(interactionTarget!.id) : null;
    const currentStash = stashIdNum !== null ? stashes.get(stashIdNum.toString()) : undefined;
    const stashItems = useMemo(() => {
        const items: (PopulatedItem | null)[] = Array(NUM_STASH_SLOTS).fill(null);
        if (!isStashInteraction || !currentStash) return items;
        // Dynamically access slot_instance_id_N fields for Stash
        for (let i = 0; i < NUM_STASH_SLOTS; i++) {
            const instanceIdKey = `slotInstanceId${i}` as keyof SpacetimeDBStash;
            const instanceIdOpt = currentStash[instanceIdKey] as bigint | null | undefined;

            if (instanceIdOpt) {
                const instanceIdStr = instanceIdOpt.toString();
                const foundInvItem = inventoryItems.get(instanceIdStr);
                if (foundInvItem) {
                    const definition = itemDefinitions.get(foundInvItem.itemDefId.toString());
                    if (definition) {
                        items[i] = { instance: foundInvItem, definition };
                    }
                }
            }
        }
        return items;
    }, [isStashInteraction, currentStash, inventoryItems, itemDefinitions]);

    // --- Tooltip Handlers (simplified to call props) ---
    const handleItemMouseEnter = useCallback((item: PopulatedItem, event: React.MouseEvent<HTMLDivElement>) => {
        onExternalItemMouseEnter(item, event);
    }, [onExternalItemMouseEnter]);

    const handleItemMouseLeave = useCallback(() => {
        onExternalItemMouseLeave();
    }, [onExternalItemMouseLeave]);

    const handleItemMouseMove = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
        onExternalItemMouseMove(event);
    }, [onExternalItemMouseMove]);

    // --- Callbacks specific to containers ---
    const handleRemoveFuel = useCallback((event: React.MouseEvent<HTMLDivElement>, slotIndex: number) => {
        event.preventDefault();
        
        // Block context menu for 200ms after a drag operation completes
        const timeSinceLastDrag = Date.now() - lastDragCompleteTime.current;
        if (timeSinceLastDrag < 200) {
            // console.log('[ExternalContainerUI] Blocking campfire fuel context menu - recent drag completion:', timeSinceLastDrag, 'ms ago');
            return;
        }
        
        if (!connection?.reducers || campfireIdNum === null) return;
        // console.log('[ExternalContainerUI] Processing campfire fuel context menu for slot:', slotIndex);
        try { connection.reducers.autoRemoveFuelFromCampfire(campfireIdNum, slotIndex); } catch (e) { console.error("Error remove fuel:", e); }
    }, [connection, campfireIdNum]);

    const handleToggleBurn = useCallback(() => {
        if (!connection?.reducers || campfireIdNum === null) return;
        try { connection.reducers.toggleCampfireBurning(campfireIdNum); } catch (e) { console.error("Error toggle burn:", e); }
    }, [connection, campfireIdNum]);

    // Lantern-specific callbacks
    const handleRemoveLanternFuel = useCallback((event: React.MouseEvent<HTMLDivElement>, slotIndex: number) => {
        event.preventDefault();
        
        // Block context menu for 200ms after a drag operation completes
        const timeSinceLastDrag = Date.now() - lastDragCompleteTime.current;
        if (timeSinceLastDrag < 200) {
            return;
        }
        
        if (!connection?.reducers || lanternIdNum === null) return;
        // TODO: No auto remove for lanterns yet, just prevent context menu for now
        console.log('Lantern fuel removal not yet implemented');
    }, [connection, lanternIdNum]);

    const handleToggleLanternBurn = useCallback(() => {
        if (!connection?.reducers || lanternIdNum === null || !currentLantern) return;
        try { 
            if (currentLantern.isBurning) {
                connection.reducers.extinguishLantern(lanternIdNum);
            } else {
                connection.reducers.lightLantern(lanternIdNum);
            }
        } catch (e) { console.error("Error toggle lantern burn:", e); }
    }, [connection, lanternIdNum, currentLantern]);

    const handleBoxItemContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>, itemInfo: PopulatedItem, slotIndex: number) => {
        event.preventDefault();
        
        // Block context menu for 200ms after a drag operation completes
        const timeSinceLastDrag = Date.now() - lastDragCompleteTime.current;
        if (timeSinceLastDrag < 200) {
            // console.log('[ExternalContainerUI] Blocking box context menu - recent drag completion:', timeSinceLastDrag, 'ms ago');
            return;
        }
        
        // console.log('[ExtCont CtxMenu Box->Inv DEBUG PRE-GUARD]', { connectionExists: !!connection?.reducers, itemInfoExists: !!itemInfo, boxIdNum });
        if (!connection?.reducers || !itemInfo || boxIdNum === null) return; // Check boxIdNum null
        // console.log('[ExternalContainerUI] Processing box context menu for item:', itemInfo.definition.name, 'slot:', slotIndex);
        try { connection.reducers.quickMoveFromBox(boxIdNum, slotIndex); } catch (e: any) { console.error("[ExtCont CtxMenu Box->Inv]", e); }
    }, [connection, boxIdNum]);

    // --- NEW Callback for Corpse Context Menu ---
    const handleCorpseItemContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>, itemInfo: PopulatedItem, slotIndex: number) => {
        event.preventDefault();
        
        // Block context menu for 200ms after a drag operation completes
        const timeSinceLastDrag = Date.now() - lastDragCompleteTime.current;
        if (timeSinceLastDrag < 200) {
            // console.log('[ExternalContainerUI] Blocking corpse context menu - recent drag completion:', timeSinceLastDrag, 'ms ago');
            return;
        }
        
        // console.log('[ExtCont CtxMenu Corpse->Inv DEBUG PRE-GUARD]', { connectionExists
        if (!connection?.reducers || !itemInfo || !corpseIdBigInt) return;
        // Corpse ID is u32 on the server, need to convert BigInt
        const corpseIdU32 = Number(corpseIdBigInt); 
        // console.log('[ExternalContainerUI] Processing corpse context menu for item:', itemInfo.definition.name, 'slot:', slotIndex);
        try {
            connection.reducers.quickMoveFromCorpse(corpseIdU32, slotIndex);
        } catch (e: any) { 
            console.error("[ExtCont CtxMenu Corpse->Inv]", e); 
        }
    }, [connection, corpseIdBigInt]);

    // --- NEW Callback for Stash Context Menu (Quick Move from Stash) ---
    const handleStashItemContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>, itemInfo: PopulatedItem, slotIndex: number) => {
        event.preventDefault();
        
        // Block context menu for 200ms after a drag operation completes
        const timeSinceLastDrag = Date.now() - lastDragCompleteTime.current;
        if (timeSinceLastDrag < 200) {
            // console.log('[ExternalContainerUI] Blocking stash context menu - recent drag completion:', timeSinceLastDrag, 'ms ago');
            return;
        }
        
        if (!connection?.reducers || !itemInfo || stashIdNum === null || !currentStash || currentStash.isHidden) return;
        // console.log('[ExternalContainerUI] Processing stash context menu for item:', itemInfo.definition.name, 'slot:', slotIndex);
        try {
            connection.reducers.quickMoveFromStash(stashIdNum, slotIndex);
        } catch (e: any) { 
            console.error("[ExtCont CtxMenu Stash->Inv]", e); 
        }
    }, [connection, stashIdNum, currentStash]);

    // --- NEW Callback for Toggling Stash Visibility ---
    const handleToggleStashVisibility = useCallback(() => {
        if (!connection?.reducers || stashIdNum === null || !currentStash) return;
        // Permission to hide might be on server (placed_by or last_surfaced_by)
        // Permission to surface is based on proximity (handled by server) but client can always try.
        try {
            connection.reducers.toggleStashVisibility(stashIdNum);
        } catch (e: any) {
            console.error("Error toggling stash visibility:", e);
        }
    }, [connection, stashIdNum, currentStash]);

    // Helper function to check if it's raining heavily enough to prevent campfire lighting
    // Only heavy rain/storms prevent lighting, light/moderate rain should allow lighting
    const isHeavyRaining = useMemo(() => {
        if (!worldState?.rainIntensity || worldState.rainIntensity <= 0) return false;
        
        // Check the weather type if available, otherwise fall back to intensity threshold
        if (worldState.currentWeather) {
            // Only HeavyRain and HeavyStorm prevent lighting (matches server logic in world_state.rs)
            return worldState.currentWeather.tag === 'HeavyRain' || worldState.currentWeather.tag === 'HeavyStorm';
        }
        
        // Fallback: Use intensity threshold (>= 0.8 is heavy rain/storm range)
        return worldState.rainIntensity >= 0.8;
    }, [worldState]);

    // Helper function to check if campfire is protected from rain
    const campfireProtection = useMemo(() => {
        if (!isCampfireInteraction || !currentCampfire) return { isProtected: false, protectionType: null, hasData: false };
        
        // Check if we have shelter/tree data
        const hasShelterData = shelters && shelters.size >= 0; // Changed to >= 0 to include empty maps as "has data"
        const hasTreeData = trees && trees.size >= 0; // Changed to >= 0 to include empty maps as "has data"
        
        console.log(`[Campfire Protection Debug] Has shelter data: ${hasShelterData}, Has tree data: ${hasTreeData}`);
        console.log(`[Campfire Protection Debug] Shelter count: ${shelters?.size || 0}, Tree count: ${trees?.size || 0}`);
        console.log(`[Campfire Protection Debug] Campfire at: (${currentCampfire.posX}, ${currentCampfire.posY})`);
        
        // If we don't have any data at all, be strict and block lighting
        if (!hasShelterData && !hasTreeData) {
            console.log(`[Campfire Protection Debug] No shelter/tree data available - blocking lighting`);
            return { isProtected: false, protectionType: null, hasData: false };
        }
        
        // Check shelter protection (same logic as server)
        if (shelters) {
            for (const shelter of Array.from(shelters.values())) {
                if (shelter.isDestroyed) continue;
                
                // Shelter AABB collision detection (from server constants)
                const SHELTER_AABB_CENTER_Y_OFFSET_FROM_POS_Y = 25.0; // From server shelter.rs
                const SHELTER_AABB_HALF_WIDTH = 96.0; // From server shelter.rs  
                const SHELTER_AABB_HALF_HEIGHT = 64.0; // From server shelter.rs
                
                const shelterAabbCenterX = shelter.posX;
                const shelterAabbCenterY = shelter.posY - SHELTER_AABB_CENTER_Y_OFFSET_FROM_POS_Y;
                const aabbLeft = shelterAabbCenterX - SHELTER_AABB_HALF_WIDTH;
                const aabbRight = shelterAabbCenterX + SHELTER_AABB_HALF_WIDTH;
                const aabbTop = shelterAabbCenterY - SHELTER_AABB_HALF_HEIGHT;
                const aabbBottom = shelterAabbCenterY + SHELTER_AABB_HALF_HEIGHT;
                
                // Check if campfire position is inside shelter AABB
                if (currentCampfire.posX >= aabbLeft && currentCampfire.posX <= aabbRight &&
                    currentCampfire.posY >= aabbTop && currentCampfire.posY <= aabbBottom) {
                    console.log(`[Campfire Protection Debug] Protected by shelter at (${shelter.posX}, ${shelter.posY})`);
                    return { isProtected: true, protectionType: 'shelter', hasData: true };
                }
            }
        }
        
        // Check tree protection (within 100px of any tree)
        const TREE_PROTECTION_DISTANCE_SQ = 100.0 * 100.0; // 100px protection radius
        
        if (trees) {
            for (const tree of Array.from(trees.values())) {
                // Skip destroyed trees (respawnAt is set when tree is harvested)
                if (tree.respawnAt !== null && tree.respawnAt !== undefined) continue;
                
                // Calculate distance squared between campfire and tree
                const dx = currentCampfire.posX - tree.posX;
                const dy = currentCampfire.posY - tree.posY;
                const distanceSq = dx * dx + dy * dy;
                const distance = Math.sqrt(distanceSq);
                
                console.log(`[Campfire Protection Debug] Tree at (${tree.posX}, ${tree.posY}) - distance: ${distance.toFixed(1)}px`);
                
                // Check if campfire is within protection distance of this tree
                if (distanceSq <= TREE_PROTECTION_DISTANCE_SQ) {
                    console.log(`[Campfire Protection Debug] Protected by tree at (${tree.posX}, ${tree.posY}) - distance: ${distance.toFixed(1)}px`);
                    return { isProtected: true, protectionType: 'tree', hasData: true };
                }
            }
        }
        
        console.log(`[Campfire Protection Debug] No protection found`);
        return { isProtected: false, protectionType: null, hasData: true };
    }, [isCampfireInteraction, currentCampfire, shelters, trees]);

    // Calculate toggle button state for campfire
    const isToggleButtonDisabled = useMemo(() => {
        if (!isCampfireInteraction || !currentCampfire) return true;
        if (currentCampfire.isBurning) return false; // If already burning, can extinguish
        
        // Check if there's valid fuel first
        const hasValidFuel = fuelItems.some(item => 
            item && 
            item.definition.fuelBurnDurationSecs !== undefined && 
            item.definition.fuelBurnDurationSecs > 0 && 
            item.instance.quantity > 0
        );
        
        if (!hasValidFuel) return true; // No fuel = disabled
        
        // Let server handle rain protection validation - don't block client-side
        // if (isHeavyRaining && !campfireProtection.isProtected) return true;
        
        return false; // Has fuel and either no rain or protected = enabled
    }, [isCampfireInteraction, currentCampfire, fuelItems, isHeavyRaining, campfireProtection]);

    // Helper function to get weather warning message (informational only)
    const getWeatherWarningMessage = useMemo(() => {
        if (!worldState?.currentWeather || !isHeavyRaining) return null;
        
        switch (worldState.currentWeather.tag) {
            case 'HeavyRain':
                return "Heavy rain - May require shelter 🏠 or tree cover 🌳";
            case 'HeavyStorm':
                return "Heavy storm - May require shelter 🏠 or tree cover 🌳";
            default:
                return "Severe weather - May require shelter 🏠 or tree cover 🌳";
        }
    }, [worldState, isHeavyRaining]);

    // --- Render Logic ---
    if (!interactionTarget) {
        return null; // Don't render anything if no interaction target
    }

    let containerTitle = "External Container"; // Default title
    if (isCampfireInteraction) {
        containerTitle = "CAMPFIRE";
    } else if (isLanternInteraction) {
        containerTitle = "LANTERN";
    } else if (isBoxInteraction) {
        containerTitle = "WOODEN STORAGE BOX";
    } else if (isCorpseInteraction) {
        containerTitle = currentCorpse?.username ? `${currentCorpse.username}'s Backpack` : "Player Corpse";
    } else if (isStashInteraction) {
        containerTitle = currentStash?.isHidden ? "HIDDEN STASH (NEARBY)" : "STASH";
        if (currentStash?.isHidden && playerId !== currentStash?.placedBy?.toHexString() && playerId !== currentStash?.lastSurfacedBy?.toHexString()) {
            // If it's hidden and not our stash (placer/surfacer), don't show item UI, only surface button potentially.
            // For now, the generic title change is enough, actual slot rendering will be conditional.
        }
    }

    // Determine if the current player can operate the stash hide/surface button
    const canOperateStashButton = useMemo(() => {
        if (!isStashInteraction || !currentStash || !playerId) return false;
        if (currentStash.isHidden) {
            return true; // Anyone can attempt to surface if they are close enough (server validates proximity)
        }
        // If not hidden, only placer or last surfacer can hide it
        return currentStash.placedBy?.toHexString() === playerId || currentStash.lastSurfacedBy?.toHexString() === playerId;
    }, [isStashInteraction, currentStash, playerId]);

    return (
        <div className={styles.externalInventorySection}>
            {/* Dynamic Title */}
            <h3 className={styles.sectionTitle}>{containerTitle}</h3>

            {/* Campfire UI */} 
            {isCampfireInteraction && currentCampfire && (
                <>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <div className={styles.multiSlotContainer} style={{ display: 'flex', flexDirection: 'row', gap: '4px' }}>
                            {Array.from({ length: NUM_FUEL_SLOTS }).map((_, index) => {
                                const itemInSlot = fuelItems[index];
                                const currentCampfireSlotInfo: DragSourceSlotInfo = { type: 'campfire_fuel', index: index, parentId: campfireIdNum ?? undefined };
                                const slotKey = `campfire-fuel-${campfireIdNum ?? 'unknown'}-${index}`;
                                return (
                                    <DroppableSlot
                                        key={slotKey}
                                        slotInfo={currentCampfireSlotInfo}
                                        onItemDrop={handleItemDropWithTracking}
                                        className={styles.slot}
                                        isDraggingOver={false}
                                    >
                                        {itemInSlot && (
                                            <DraggableItem
                                                item={itemInSlot}
                                                sourceSlot={currentCampfireSlotInfo}
                                                onItemDragStart={onItemDragStart}
                                                onItemDrop={handleItemDropWithTracking}
                                                onContextMenu={(event) => handleRemoveFuel(event, index)}
                                                onMouseEnter={(e) => handleItemMouseEnter(itemInSlot, e)}
                                                onMouseLeave={handleItemMouseLeave}
                                                onMouseMove={handleItemMouseMove}
                                            />
                                        )}
                                    </DroppableSlot>
                                );
                            })}
                        </div>
                        <button
                            onClick={handleToggleBurn}
                            disabled={isToggleButtonDisabled}
                            className={`${styles.interactionButton} ${
                                currentCampfire.isBurning
                                    ? styles.extinguishButton
                                    : styles.lightFireButton
                            }`}
                            title={
                                isToggleButtonDisabled && !currentCampfire.isBurning 
                                    ? (() => {
                                        // Check fuel first
                                        const hasValidFuel = fuelItems.some(item => 
                                            item && 
                                            item.definition.fuelBurnDurationSecs !== undefined && 
                                            item.definition.fuelBurnDurationSecs > 0 && 
                                            item.instance.quantity > 0
                                        );
                                        if (!hasValidFuel) return "Requires Fuel > 0";
                                        
                                        // Note: Rain protection is now handled server-side only
                                        
                                        return ""; // Shouldn't reach here if button is disabled
                                    })()
                                    : ""
                            }
                        >
                            {currentCampfire.isBurning ? "Extinguish" : "Light Fire"}
                        </button>
                        {/* Rain warning message - informational only */}
                        {!!isHeavyRaining && !currentCampfire.isBurning && (
                            <div style={{ 
                                marginTop: '8px', 
                                color: '#87CEEB', 
                                fontSize: '12px', 
                                textAlign: 'center',
                                fontStyle: 'italic'
                            }}>
                                🌧️ {getWeatherWarningMessage}
                            </div>
                        )}
                    </div>
                </>
            )}
            {isCampfireInteraction && !currentCampfire && (
                 <div>Error: Campfire data missing.</div>
            )}

            {/* Lantern UI */} 
            {isLanternInteraction && currentLantern && (
                <>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <div className={styles.multiSlotContainer} style={{ display: 'flex', flexDirection: 'row', gap: '4px' }}>
                            {Array.from({ length: NUM_LANTERN_FUEL_SLOTS }).map((_, index) => {
                                const itemInSlot = lanternFuelItems[index];
                                const currentLanternSlotInfo: DragSourceSlotInfo = { type: 'lantern_fuel', index: index, parentId: lanternIdNum ?? undefined };
                                const slotKey = `lantern-fuel-${lanternIdNum ?? 'unknown'}-${index}`;
                                return (
                                    <DroppableSlot
                                        key={slotKey}
                                        slotInfo={currentLanternSlotInfo}
                                        onItemDrop={handleItemDropWithTracking}
                                        className={styles.slot}
                                        isDraggingOver={false}
                                    >
                                        {itemInSlot && (
                                            <DraggableItem
                                                item={itemInSlot}
                                                sourceSlot={currentLanternSlotInfo}
                                                onItemDragStart={onItemDragStart}
                                                onItemDrop={handleItemDropWithTracking}
                                                onContextMenu={(event) => handleRemoveLanternFuel(event, index)}
                                                onMouseEnter={(e) => handleItemMouseEnter(itemInSlot, e)}
                                                onMouseLeave={handleItemMouseLeave}
                                                onMouseMove={handleItemMouseMove}
                                            />
                                        )}
                                    </DroppableSlot>
                                );
                            })}
                        </div>
                        <button
                            onClick={handleToggleLanternBurn}
                            disabled={!currentLantern || (!currentLantern.isBurning && !lanternFuelItems.some(item => item && item.instance.quantity > 0))}
                            className={`${styles.interactionButton} ${
                                currentLantern.isBurning
                                    ? styles.extinguishButton
                                    : styles.lightFireButton
                            }`}
                        >
                            {currentLantern.isBurning ? "Extinguish" : "Light Lantern"}
                        </button>
                    </div>
                </>
            )}
            {isLanternInteraction && !currentLantern && (
                 <div>Error: Lantern data missing.</div>
            )}

            {/* Box UI */} 
            {isBoxInteraction && currentStorageBox && (
                <>
                    <div className={styles.inventoryGrid}>
                        {Array.from({ length: NUM_BOX_SLOTS }).map((_, index) => {
                            const itemInSlot = boxItems[index];
                            const currentBoxSlotInfo: DragSourceSlotInfo = { type: 'wooden_storage_box', index: index, parentId: boxIdNum ?? undefined };
                            const slotKey = `box-${boxIdNum ?? 'unknown'}-${index}`;
                            return (
                                <DroppableSlot
                                    key={slotKey}
                                    slotInfo={currentBoxSlotInfo}
                                    onItemDrop={handleItemDropWithTracking}
                                    className={styles.slot} 
                                    isDraggingOver={false} // Placeholder, real value from drag state needed
                                >
                                    {itemInSlot && (
                                        <DraggableItem
                                            item={itemInSlot}
                                            sourceSlot={currentBoxSlotInfo}
                                            onItemDragStart={onItemDragStart}
                                            onItemDrop={handleItemDropWithTracking} 
                                            onContextMenu={(event) => handleBoxItemContextMenu(event, itemInSlot, index)}
                                            onMouseEnter={(e) => handleItemMouseEnter(itemInSlot, e)}
                                            onMouseLeave={handleItemMouseLeave}
                                            onMouseMove={handleItemMouseMove}
                                        />
                                    )}
                                </DroppableSlot>
                            );
                        })}
                    </div>
                </>
            )}
            {isBoxInteraction && !currentStorageBox && (
                <div>Error: Wooden Storage Box data missing.</div>
            )}

            {/* Corpse UI */} 
            {isCorpseInteraction && currentCorpse && (
                <>
                    <div className={styles.inventoryGrid}>
                        {Array.from({ length: NUM_CORPSE_SLOTS }).map((_, index) => {
                            const itemInSlot = corpseItems[index];
                            // Ensure corpseIdBigInt is defined before creating slot info
                            const corpseIdForSlot = corpseIdBigInt ?? undefined; 
                            const currentCorpseSlotInfo: DragSourceSlotInfo = { type: 'player_corpse', index: index, parentId: corpseIdForSlot };
                            const slotKey = `corpse-${corpseIdStr ?? 'unknown'}-${index}`;
                            return (
                                <DroppableSlot
                                    key={slotKey}
                                    slotInfo={currentCorpseSlotInfo}
                                    onItemDrop={handleItemDropWithTracking}
                                    className={styles.slot}
                                    isDraggingOver={false} // Add state if needed
                                >
                                    {itemInSlot && (
                                        <DraggableItem
                                            item={itemInSlot}
                                            sourceSlot={currentCorpseSlotInfo}
                                            onItemDragStart={onItemDragStart}
                                            onItemDrop={handleItemDropWithTracking}
                                            onContextMenu={(event) => handleCorpseItemContextMenu(event, itemInSlot, index)}
                                            onMouseEnter={(e) => handleItemMouseEnter(itemInSlot, e)}
                                            onMouseLeave={handleItemMouseLeave}
                                            onMouseMove={handleItemMouseMove}
                                        />
                                    )}
                                </DroppableSlot>
                            );
                        })}
                    </div>
                </>
            )}
            {isCorpseInteraction && !currentCorpse && (
                <div>Error: Player Corpse data missing.</div>
            )}

            {/* Stash UI */}
            {isStashInteraction && currentStash && (
                <>
                    {!currentStash.isHidden && (
                        <div className={styles.inventoryGrid}>
                            {Array.from({ length: NUM_STASH_SLOTS }).map((_, index) => {
                                const itemInSlot = stashItems[index];
                                const currentStashSlotInfo: DragSourceSlotInfo = { type: 'stash', index: index, parentId: stashIdNum ?? undefined };
                                const slotKey = `stash-${stashIdNum ?? 'unknown'}-${index}`;
                                return (
                                    <DroppableSlot
                                        key={slotKey}
                                        slotInfo={currentStashSlotInfo}
                                        onItemDrop={handleItemDropWithTracking}
                                        className={styles.slot}
                                        isDraggingOver={false} // Add state if needed
                                    >
                                        {itemInSlot && (
                                            <DraggableItem
                                                item={itemInSlot}
                                                sourceSlot={currentStashSlotInfo}
                                                onItemDragStart={onItemDragStart}
                                                onItemDrop={handleItemDropWithTracking}
                                                onContextMenu={(event) => handleStashItemContextMenu(event, itemInSlot, index)}
                                                onMouseEnter={(e) => handleItemMouseEnter(itemInSlot, e)}
                                                onMouseLeave={handleItemMouseLeave}
                                                onMouseMove={handleItemMouseMove}
                                            />
                                        )}
                                    </DroppableSlot>
                                );
                            })}
                        </div>
                    )}
                    {canOperateStashButton && (
                         <button
                            onClick={handleToggleStashVisibility}
                            className={`${styles.interactionButton} ${
                                currentStash.isHidden
                                    ? styles.lightFireButton // Use a generic "positive action" style
                                    : styles.extinguishButton // Use a generic "negative action" style
                            }`}
                        >
                            {currentStash.isHidden ? "Surface Stash" : "Hide Stash"}
                        </button>
                    )}
                    {currentStash.isHidden && !canOperateStashButton && (
                        <p className={styles.infoText}>This stash is hidden. You might be able to surface it if you are on top of it.</p>
                    )}
                </>
            )}
            {isStashInteraction && !currentStash && (
                <div>Error: Stash data missing.</div>
            )}
        </div>
    );
};

export default ExternalContainerUI; 