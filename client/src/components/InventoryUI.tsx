/**
 * InventoryUI.tsx
 * 
 * Displays the player's inventory, equipment, and crafting panel.
 * Also handles displaying the contents of interacted containers (Campfire, WoodenStorageBox).
 * Allows players to drag/drop items between slots, equip items, and initiate crafting.
 * Typically rendered conditionally by PlayerUI when inventory is opened or a container is interacted with.
 */

import React, { useCallback, useMemo } from 'react';
import styles from './InventoryUI.module.css';
// Import Custom Components
import DraggableItem from './DraggableItem';
import DroppableSlot from './DroppableSlot';

// Import from shared location
import { DragSourceSlotInfo, DraggedItemInfo } from '../types/dragDropTypes'; // Import both from shared

// Import SpacetimeDB types needed for props and logic
import {
    Player,
    InventoryItem,
    ItemDefinition,
    DbConnection,
    ActiveEquipment,
    Campfire as SpacetimeDBCampfire,
    WoodenStorageBox as SpacetimeDBWoodenStorageBox,
    Recipe,
    CraftingQueueItem,
    PlayerCorpse,
    // Import the generated types for ItemLocation variants
    ItemLocation,
    InventoryLocationData, // Assuming this is the type for ItemLocation.Inventory.value
    EquippedLocationData,  // Assuming this is the type for ItemLocation.Equipped.value
    EquipmentSlotType    // Make sure this matches the actual exported name for the slot type enum/union
} from '../generated';
import { Identity } from '@clockworklabs/spacetimedb-sdk';
// NEW: Import placement types
import { PlacementItemInfo} from '../hooks/usePlacementManager';
// ADD: Import CraftingUI component
import CraftingUI from './CraftingUI';
// ADD: Import ExternalContainerUI component
import ExternalContainerUI from './ExternalContainerUI';

// --- Type Definitions ---
// Define props for InventoryUI component
interface InventoryUIProps {
    playerIdentity: Identity | null;
    onClose: () => void;
    inventoryItems: Map<string, InventoryItem>;
    itemDefinitions: Map<string, ItemDefinition>;
    connection: DbConnection | null;
    activeEquipments: Map<string, ActiveEquipment>;
    onItemDragStart: (info: DraggedItemInfo) => void;
    onItemDrop: (targetSlotInfo: DragSourceSlotInfo | null) => void;
    draggedItemInfo: DraggedItemInfo | null;
    // Add new props for interaction context
    interactionTarget: { type: string; id: number | bigint } | null;
    campfires: Map<string, SpacetimeDBCampfire>;
    woodenStorageBoxes: Map<string, SpacetimeDBWoodenStorageBox>; // <<< ADDED Prop Definition
    playerCorpses: Map<string, PlayerCorpse>; // <<< ADD prop definition for corpses
    currentStorageBox?: SpacetimeDBWoodenStorageBox | null; // <<< ADDED Prop Definition
    // NEW: Add Generic Placement Props
    startPlacement: (itemInfo: PlacementItemInfo) => void;
    cancelPlacement: () => void; // Assuming cancel might be needed (e.g., close button cancels placement)
    placementInfo: PlacementItemInfo | null; // To potentially disable actions while placing
    // ADD: Crafting related props
    recipes: Map<string, Recipe>;
    craftingQueueItems: Map<string, CraftingQueueItem>;
    onCraftingSearchFocusChange?: (isFocused: boolean) => void;
}

// Represents an item instance with its definition for rendering
export interface PopulatedItem {
    instance: InventoryItem;
    definition: ItemDefinition;
}

// --- Constants ---
const NUM_FUEL_SLOTS = 5; // For Campfire
const NUM_BOX_SLOTS = 18; // For Wooden Storage Box
const BOX_COLS = 6;
const INVENTORY_ROWS = 4;
const INVENTORY_COLS = 6;
const TOTAL_INVENTORY_SLOTS = INVENTORY_ROWS * INVENTORY_COLS;

// Define Equipment Slot Layout (matches enum variants/logical names)
const EQUIPMENT_SLOT_LAYOUT: { name: string, type: EquipmentSlotType | null }[] = [
    { name: 'Head', type: { tag: 'Head' } as EquipmentSlotType },
    { name: 'Chest', type: { tag: 'Chest' } as EquipmentSlotType },
    { name: 'Legs', type: { tag: 'Legs' } as EquipmentSlotType },
    { name: 'Feet', type: { tag: 'Feet' } as EquipmentSlotType },
    { name: 'Hands', type: { tag: 'Hands' } as EquipmentSlotType },
    { name: 'Back', type: { tag: 'Back' } as EquipmentSlotType },
];

// --- Main Component ---
const InventoryUI: React.FC<InventoryUIProps> = ({
    playerIdentity,
    onClose,
    inventoryItems,
    itemDefinitions,
    connection,
    activeEquipments,
    onItemDragStart,
    onItemDrop,
    interactionTarget,
    campfires,
    woodenStorageBoxes,
    playerCorpses,
    currentStorageBox,
    cancelPlacement,
    placementInfo, // Read isPlacing state from this
    // ADD: Destructure crafting props
    recipes,
    craftingQueueItems,
    onCraftingSearchFocusChange,
}) => {
    const isPlacingItem = placementInfo !== null;

    // --- Derived State & Data Preparation --- 

    // Player Inventory & Equipment Data
    const { itemsByInvSlot, itemsByEquipSlot } = useMemo(() => {
        const invMap = new Map<number, PopulatedItem>();
        const equipMap = new Map<string, PopulatedItem>();
        if (!playerIdentity) return { itemsByInvSlot: invMap, itemsByEquipSlot: equipMap };

        inventoryItems.forEach(itemInstance => {
            const definition = itemDefinitions.get(itemInstance.itemDefId.toString());
            if (definition) {
                const populatedItem = { instance: itemInstance, definition };
                const location = itemInstance.location; // Get location once

                if (location.tag === 'Inventory') {
                    // No need for type assertion if TypeScript can infer from .tag, but explicit for clarity if needed
                    const inventoryData = location.value as InventoryLocationData;
                    if (inventoryData.ownerId.isEqual(playerIdentity)) {
                        invMap.set(inventoryData.slotIndex, populatedItem);
                    }
                } else if (location.tag === 'Equipped') {
                    // No need for type assertion if TypeScript can infer, but explicit for clarity
                    const equipmentData = location.value as EquippedLocationData;
                    if (equipmentData.ownerId.isEqual(playerIdentity)) {
                        // equipmentData.slotType will be like { tag: 'Head' } or { tag: 'Chest', value: ... }
                        // We need the string tag for the map key
                        equipMap.set(equipmentData.slotType.tag, populatedItem);
                    }
                }
            }
        });
        return { itemsByInvSlot: invMap, itemsByEquipSlot: equipMap };
    }, [playerIdentity, inventoryItems, itemDefinitions]);

    // --- Callbacks & Handlers ---
    const handleClose = useCallback(() => {
        if (isPlacingItem) {
            // console.log("[InventoryUI] Closing panel, cancelling placement mode.");
            cancelPlacement();
        }
        onClose();
    }, [isPlacingItem, cancelPlacement, onClose]);

    const handleInventoryItemContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>, itemInfo: PopulatedItem) => {
        event.preventDefault();
        if (!connection?.reducers || !itemInfo) return;
        const itemInstanceId = BigInt(itemInfo.instance.instanceId);

        // Get interaction context directly here
        const currentInteraction = interactionTarget;
        const currentBoxId = currentInteraction?.type === 'wooden_storage_box' ? Number(currentInteraction.id) : null;
        const currentCampfireId = currentInteraction?.type === 'campfire' ? Number(currentInteraction.id) : null;
        const currentCorpseId = currentInteraction?.type === 'player_corpse' ? Number(currentInteraction.id) : null;

        // --- PRIORITY 1: Open Corpse ---
        if (currentCorpseId !== null) {
            try {
                console.log(`[Inv CtxMenu Inv->Corpse] Corpse ${currentCorpseId} open. Calling quickMoveToCorpse for item ${itemInstanceId}`);
                connection.reducers.quickMoveToCorpse(currentCorpseId, itemInstanceId);
            } catch (e: any) { 
                console.error("[Inv CtxMenu Inv->Corpse] Error quick moving to corpse:", e); 
                // TODO: setUiError 
            }
            return; // Action handled
        }

        // --- PRIORITY 2: Open Box --- 
        if (currentBoxId !== null) {
            try { 
                // console.log(`[Inv CtxMenu Inv->Box] Box ${currentBoxId} open. Calling quickMoveToBox for item ${itemInstanceId}`);
                connection.reducers.quickMoveToBox(currentBoxId, itemInstanceId); 
            } catch (e: any) { 
                console.error("[Inv CtxMenu Inv->Box]", e); 
                // TODO: setUiError 
            }
            return; // Action handled
        } 
        // --- PRIORITY 3: Open Campfire --- 
        else if (currentCampfireId !== null) {
            try { 
                // console.log(`[Inv CtxMenu Inv->Campfire] Campfire ${currentCampfireId} open. Calling quickMoveToCampfire for item ${itemInstanceId}`);
                connection.reducers.quickMoveToCampfire(currentCampfireId, itemInstanceId); 
            } catch (e: any) { 
                console.error("[Inv CtxMenu Inv->Campfire]", e); 
                // TODO: setUiError 
            }
            return; // Action handled
        } 
        // --- DEFAULT ACTIONS (No relevant container open) --- 
        else {
            const isArmor = itemInfo.definition.category.tag === 'Armor' && itemInfo.definition.equipmentSlotType !== null;
            if (isArmor) {
                // console.log(`[Inv CtxMenu EquipArmor] No container open. Item ${itemInstanceId} is Armor. Calling equipArmorFromInventory.`);
                try { connection.reducers.equipArmorFromInventory(itemInstanceId); } catch (e: any) { console.error("[Inv CtxMenu EquipArmor]", e); /* TODO: setUiError */ }
            } else {
                // console.log(`[Inv CtxMenu Inv->Hotbar] No container open. Item ${itemInstanceId} not Armor. Calling moveToFirstAvailableHotbarSlot.`);
                try { connection.reducers.moveToFirstAvailableHotbarSlot(itemInstanceId); } catch (e: any) { console.error("[Inv CtxMenu Inv->Hotbar]", e); /* TODO: setUiError */ }
            }
        }
    }, [connection, interactionTarget]);

    // --- Render --- 
    return (
        <div className={styles.inventoryPanel}>
            <button className={styles.closeButton} onClick={handleClose}>X</button>

            {/* Left Pane: Equipment */} 
            <div className={styles.leftPane}>
                <h3 className={styles.sectionTitle}>EQUIPMENT</h3>
                <div className={styles.equipmentGrid}>
                    {EQUIPMENT_SLOT_LAYOUT.map(slotInfo => {
                        const item = itemsByEquipSlot.get(slotInfo.name);
                        const currentSlotInfo: DragSourceSlotInfo = { type: 'equipment', index: slotInfo.name };
                        return (
                            <DroppableSlot
                                key={`equip-${slotInfo.name}`}
                                slotInfo={currentSlotInfo}
                                onItemDrop={onItemDrop}
                                className={styles.slot}
                                isDraggingOver={false} // Add state if needed
                            >
                                {item && (
                                    <DraggableItem
                                        item={item}
                                        sourceSlot={currentSlotInfo}
                                        onItemDragStart={onItemDragStart}
                                        onItemDrop={onItemDrop}
                                        // No context menu needed for equipped items? Or move back to inv?
                                    />
                                )}
                            </DroppableSlot>
                        );
                    })}
                </div>
            </div>

            {/* Middle Pane: Inventory & Containers */} 
            <div className={styles.middlePane}>
                <h3 className={styles.sectionTitle}>INVENTORY</h3>
                <div className={styles.inventoryGrid}>
                    {Array.from({ length: TOTAL_INVENTORY_SLOTS }).map((_, index) => {
                        const item = itemsByInvSlot.get(index);
                        const currentSlotInfo: DragSourceSlotInfo = { type: 'inventory', index: index };
                        return (
                            <DroppableSlot
                                key={`inv-${index}`}
                                slotInfo={currentSlotInfo}
                                onItemDrop={onItemDrop}
                                className={styles.slot}
                                isDraggingOver={false} // Add state if needed
                            >
                                {item && (
                                    <DraggableItem
                                        item={item}
                                        sourceSlot={currentSlotInfo}
                                        onItemDragStart={onItemDragStart}
                                        onItemDrop={onItemDrop}
                                        onContextMenu={(event) => handleInventoryItemContextMenu(event, item)}
                                    />
                                )}
                            </DroppableSlot>
                        );
                    })}
                </div>
                </div>

            {/* Right Pane: Always shows External Container if interacting */}
            <div className={styles.rightPane}> {/* Ensure rightPane class exists if needed */}
                {interactionTarget ? (
                    // If interacting, show the external container
                <ExternalContainerUI
                    interactionTarget={interactionTarget}
                    inventoryItems={inventoryItems}
                    itemDefinitions={itemDefinitions}
                    campfires={campfires}
                        woodenStorageBoxes={woodenStorageBoxes}
                        playerCorpses={playerCorpses}
                    currentStorageBox={currentStorageBox}
                    connection={connection}
                    onItemDragStart={onItemDragStart}
                    onItemDrop={onItemDrop}
                />
                ) : (
                    // Otherwise, show the crafting UI
            <CraftingUI
                playerIdentity={playerIdentity}
                recipes={recipes}
                craftingQueueItems={craftingQueueItems}
                itemDefinitions={itemDefinitions}
                inventoryItems={inventoryItems}
                connection={connection}
                onCraftingSearchFocusChange={onCraftingSearchFocusChange}
            />
                )}
            </div>
        </div>
    );
};

export default InventoryUI;