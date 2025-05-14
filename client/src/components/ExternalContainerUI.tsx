/******************************************************************************
 * ExternalContainerUI.tsx                                                     *
 * -------------------------------------------------------------------------- *
 * Manages the UI for external containers like campfires and wooden storage   *
 * boxes. Displays items, handles drag-and-drop interactions, and context   *
 * menus for these containers.                                                *
 ******************************************************************************/

import React, { useCallback, useMemo } from 'react';
import styles from './InventoryUI.module.css'; // Reuse styles for now

// Import Custom Components
import DraggableItem from './DraggableItem';
import DroppableSlot from './DroppableSlot';

// Import Types
import { 
    ItemDefinition, InventoryItem, DbConnection, 
    Campfire as SpacetimeDBCampfire, WoodenStorageBox as SpacetimeDBWoodenStorageBox, PlayerCorpse 
} from '../generated';
import { InteractionTarget } from '../hooks/useInteractionManager';
import { DragSourceSlotInfo, DraggedItemInfo } from '../types/dragDropTypes';
import { PopulatedItem } from './InventoryUI'; // Assuming exported from InventoryUI

// Constants (can be moved/shared later)
const NUM_FUEL_SLOTS = 5;
const NUM_BOX_SLOTS = 18;
const NUM_CORPSE_SLOTS = 30; // 24 inv + 6 hotbar
const BOX_COLS = 6;
const CORPSE_COLS = 6; // Same layout as inventory

interface ExternalContainerUIProps {
    interactionTarget: InteractionTarget;
    inventoryItems: Map<string, InventoryItem>;
    itemDefinitions: Map<string, ItemDefinition>;
    campfires: Map<string, SpacetimeDBCampfire>;
    woodenStorageBoxes: Map<string, SpacetimeDBWoodenStorageBox>;
    playerCorpses: Map<string, PlayerCorpse>;
    currentStorageBox?: SpacetimeDBWoodenStorageBox | null; // The specific box being interacted with
    connection: DbConnection | null;
    onItemDragStart: (info: DraggedItemInfo) => void;
    onItemDrop: (targetSlotInfo: DragSourceSlotInfo | null) => void;
    // Consider a more generic context menu handler if patterns emerge
}

const ExternalContainerUI: React.FC<ExternalContainerUIProps> = ({
    interactionTarget,
    inventoryItems,
    itemDefinitions,
    campfires,
    woodenStorageBoxes,
    playerCorpses,
    currentStorageBox,
    connection,
    onItemDragStart,
    onItemDrop,
}) => {

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

    // --- Callbacks specific to containers ---
    const handleRemoveFuel = useCallback((event: React.MouseEvent<HTMLDivElement>, slotIndex: number) => {
        event.preventDefault();
        if (!connection?.reducers || campfireIdNum === null) return;
        try { connection.reducers.autoRemoveFuelFromCampfire(campfireIdNum, slotIndex); } catch (e) { console.error("Error remove fuel:", e); }
    }, [connection, campfireIdNum]);

    const handleToggleBurn = useCallback(() => {
        if (!connection?.reducers || campfireIdNum === null) return;
        try { connection.reducers.toggleCampfireBurning(campfireIdNum); } catch (e) { console.error("Error toggle burn:", e); }
    }, [connection, campfireIdNum]);

    const handleBoxItemContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>, itemInfo: PopulatedItem, slotIndex: number) => {
        event.preventDefault();
        console.log('[ExtCont CtxMenu Box->Inv DEBUG PRE-GUARD]', { connectionExists: !!connection?.reducers, itemInfoExists: !!itemInfo, boxIdNum });
        if (!connection?.reducers || !itemInfo || boxIdNum === null) return; // Check boxIdNum null
        try { connection.reducers.quickMoveFromBox(boxIdNum, slotIndex); } catch (e: any) { console.error("[ExtCont CtxMenu Box->Inv]", e); }
    }, [connection, boxIdNum]);

    // --- NEW Callback for Corpse Context Menu ---
    const handleCorpseItemContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>, itemInfo: PopulatedItem, slotIndex: number) => {
        event.preventDefault();
        console.log('[ExtCont CtxMenu Corpse->Inv DEBUG PRE-GUARD]', { connectionExists: !!connection?.reducers, itemInfoExists: !!itemInfo, corpseIdBigInt });
        if (!connection?.reducers || !itemInfo || !corpseIdBigInt) return;
        // Corpse ID is u32 on the server, need to convert BigInt
        const corpseIdU32 = Number(corpseIdBigInt); 
        try {
            connection.reducers.quickMoveFromCorpse(corpseIdU32, slotIndex);
        } catch (e: any) { 
            console.error("[ExtCont CtxMenu Corpse->Inv]", e); 
        }
    }, [connection, corpseIdBigInt]);

    // Calculate toggle button state for campfire
    const isToggleButtonDisabled = useMemo(() => {
        if (!isCampfireInteraction || !currentCampfire) return true;
        if (currentCampfire.isBurning) return false;
        return !fuelItems.some(item => item && item.definition.name === 'Wood' && item.instance.quantity > 0);
    }, [isCampfireInteraction, currentCampfire, fuelItems]);

    // --- Render Logic ---
    if (!interactionTarget) {
        return null; // Don't render anything if no interaction target
    }

    let containerTitle = "External Container"; // Default title
    if (isCampfireInteraction) {
        containerTitle = "CAMPFIRE";
    } else if (isBoxInteraction) {
        containerTitle = "WOODEN STORAGE BOX";
    } else if (isCorpseInteraction) {
        containerTitle = currentCorpse?.username ? `${currentCorpse.username}'s Backpack` : "Player Corpse";
    }

    return (
        <div className={styles.externalInventorySection}>
            {/* Dynamic Title */}
            <h3 className={styles.sectionTitle}>{containerTitle}</h3>

            {/* Campfire UI */} 
            {isCampfireInteraction && currentCampfire && (
                <>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <div className={styles.multiSlotContainer} style={{ display: 'flex', flexDirection: 'row', gap: '5px' }}>
                            {Array.from({ length: NUM_FUEL_SLOTS }).map((_, index) => {
                                const itemInSlot = fuelItems[index];
                                const currentCampfireSlotInfo: DragSourceSlotInfo = { type: 'campfire_fuel', index: index, parentId: campfireIdNum ?? undefined };
                                const slotKey = `campfire-fuel-${campfireIdNum ?? 'unknown'}-${index}`;
                                return (
                                    <DroppableSlot
                                        key={slotKey}
                                        slotInfo={currentCampfireSlotInfo}
                                        onItemDrop={onItemDrop}
                                        className={styles.slot}
                                        isDraggingOver={false}
                                    >
                                        {itemInSlot && (
                                            <DraggableItem
                                                item={itemInSlot}
                                                sourceSlot={currentCampfireSlotInfo}
                                                onItemDragStart={onItemDragStart}
                                                onItemDrop={onItemDrop}
                                                onContextMenu={(event) => handleRemoveFuel(event, index)}
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
                            title={isToggleButtonDisabled && !currentCampfire.isBurning ? "Requires Wood > 0" : ""}
                        >
                            {currentCampfire.isBurning ? "Extinguish" : "Light Fire"}
                        </button>
                    </div>
                </>
            )}
            {isCampfireInteraction && !currentCampfire && (
                 <div>Error: Campfire data missing.</div>
            )}

            {/* Box UI */} 
            {isBoxInteraction && currentStorageBox && (
                <>
                    <div className={styles.inventoryGrid} style={{ gridTemplateColumns: `repeat(${BOX_COLS}, ${styles.slotSize || '60px'})` }}>
                        {Array.from({ length: NUM_BOX_SLOTS }).map((_, index) => {
                            const itemInSlot = boxItems[index];
                            const currentBoxSlotInfo: DragSourceSlotInfo = { type: 'wooden_storage_box', index: index, parentId: boxIdNum ?? undefined };
                            const slotKey = `box-${boxIdNum ?? 'unknown'}-${index}`;
                            return (
                                <DroppableSlot
                                    key={slotKey}
                                    slotInfo={currentBoxSlotInfo}
                                    onItemDrop={onItemDrop}
                                    className={styles.slot} 
                                    isDraggingOver={false} // Placeholder, real value from drag state needed
                                >
                                    {itemInSlot && (
                                        <DraggableItem
                                            item={itemInSlot}
                                            sourceSlot={currentBoxSlotInfo}
                                            onItemDragStart={onItemDragStart}
                                            onItemDrop={onItemDrop} 
                                            onContextMenu={(event) => handleBoxItemContextMenu(event, itemInSlot, index)}
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
                    <div className={styles.inventoryGrid} style={{ gridTemplateColumns: `repeat(${CORPSE_COLS}, ${styles.slotSize || '60px'})` }}>
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
                                    onItemDrop={onItemDrop}
                                    className={styles.slot}
                                    isDraggingOver={false} // Add state if needed
                                >
                                    {itemInSlot && (
                                        <DraggableItem
                                            item={itemInSlot}
                                            sourceSlot={currentCorpseSlotInfo}
                                            onItemDragStart={onItemDragStart}
                                            onItemDrop={onItemDrop}
                                            onContextMenu={(event) => handleCorpseItemContextMenu(event, itemInSlot, index)}
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
        </div>
    );
};

export default ExternalContainerUI; 