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
    ItemDefinition,
    InventoryItem,
    DbConnection,
    EquipmentSlot as BackendEquipmentSlot, // Keep alias if used
    ActiveEquipment,
    Campfire as SpacetimeDBCampfire, // Import Campfire type
    WoodenStorageBox as SpacetimeDBWoodenStorageBox, // <<< Import Box type
    Recipe,
    CraftingQueueItem,
    PlayerCorpse
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
const EQUIPMENT_SLOT_LAYOUT: { name: string, type: BackendEquipmentSlot | null }[] = [
    { name: 'Head', type: { tag: 'Head' } },
    { name: 'Chest', type: { tag: 'Chest' } },
    { name: 'Legs', type: { tag: 'Legs' } },
    { name: 'Feet', type: { tag: 'Feet' } },
    { name: 'Hands', type: { tag: 'Hands' } },
    { name: 'Back', type: { tag: 'Back' } },
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
}) => {
    const isPlacingItem = placementInfo !== null;

    // --- Derived State & Data Preparation --- 

    // Player Inventory & Equipment Data
    const { itemsByInvSlot, itemsByEquipSlot } = useMemo(() => {
        const invMap = new Map<number, PopulatedItem>();
        const equipMap = new Map<string, PopulatedItem>();
        if (!playerIdentity) return { itemsByInvSlot: invMap, itemsByEquipSlot: equipMap };

        // Map inventory items
        inventoryItems.forEach(itemInstance => {
            if (itemInstance.playerIdentity.isEqual(playerIdentity)) {
                const definition = itemDefinitions.get(itemInstance.itemDefId.toString());
                if (definition) {
                    const populatedItem = { instance: itemInstance, definition };
                    if (itemInstance.inventorySlot !== null && itemInstance.inventorySlot !== undefined) {
                        invMap.set(itemInstance.inventorySlot, populatedItem);
                    }
                    // Note: Hotbar items are handled separately by Hotbar component
                }
            }
        });

        // Map equipped items
        const playerEquipment = activeEquipments.get(playerIdentity.toHexString());
        if (playerEquipment) {
            const equipMapping: { field: keyof ActiveEquipment; logicalSlot: string }[] = [
                { field: 'headItemInstanceId', logicalSlot: 'Head' }, { field: 'chestItemInstanceId', logicalSlot: 'Chest' },
                { field: 'legsItemInstanceId', logicalSlot: 'Legs' }, { field: 'feetItemInstanceId', logicalSlot: 'Feet' },
                { field: 'handsItemInstanceId', logicalSlot: 'Hands' }, { field: 'backItemInstanceId', logicalSlot: 'Back' },
            ];
            equipMapping.forEach(({ field, logicalSlot }) => {
                const instanceId = playerEquipment[field];
                if (instanceId) {
                    const foundItem = inventoryItems.get(instanceId.toString()); // More direct lookup
                    if (foundItem) {
                        const definition = itemDefinitions.get(foundItem.itemDefId.toString());
                        if (definition) {
                            equipMap.set(logicalSlot, { instance: foundItem, definition });
                        }
                    }
                }
            });
        }
        return { itemsByInvSlot: invMap, itemsByEquipSlot: equipMap };
    }, [playerIdentity, inventoryItems, itemDefinitions, activeEquipments]);

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

        if (currentBoxId !== null) {
            try { connection.reducers.quickMoveToBox(currentBoxId, itemInstanceId); } catch (e: any) { console.error("[Inv CtxMenu Inv->Box]", e); /* TODO: setUiError */ }
        } else if (currentCampfireId !== null) {
            try { connection.reducers.quickMoveToCampfire(currentCampfireId, itemInstanceId); } catch (e: any) { console.error("[Inv CtxMenu Inv->Campfire]", e); /* TODO: setUiError */ }
        } else {
            const isArmor = itemInfo.definition.category.tag === 'Armor' && itemInfo.definition.equipmentSlot !== null;
            if (isArmor) {
                try { connection.reducers.equipArmorFromInventory(itemInstanceId); } catch (e: any) { console.error("[Inv CtxMenu EquipArmor]", e); /* TODO: setUiError */ }
            } else {
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

                {/* Render the External Container UI */} 
                <ExternalContainerUI
                    interactionTarget={interactionTarget}
                    inventoryItems={inventoryItems}
                    itemDefinitions={itemDefinitions}
                    campfires={campfires}
                    currentStorageBox={currentStorageBox}
                    connection={connection}
                    onItemDragStart={onItemDragStart}
                    onItemDrop={onItemDrop}
                    woodenStorageBoxes={woodenStorageBoxes}
                    playerCorpses={playerCorpses}
                />
            </div>

            {/* Right Pane: Crafting */} 
            <CraftingUI
                playerIdentity={playerIdentity}
                recipes={recipes}
                craftingQueueItems={craftingQueueItems}
                itemDefinitions={itemDefinitions}
                inventoryItems={inventoryItems}
                connection={connection}
            />
        </div>
    );
};

export default InventoryUI;