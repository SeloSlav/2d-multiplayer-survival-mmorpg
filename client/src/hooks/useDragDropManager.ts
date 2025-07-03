import { useState, useRef, useCallback, useEffect } from 'react';
import { DraggedItemInfo, DragSourceSlotInfo } from '../types/dragDropTypes';
import { DbConnection, InventoryItem } from '../generated'; // Import connection type and InventoryItem
import { Identity } from '@clockworklabs/spacetimedb-sdk'; // Ensure Identity is imported
// Import location data types if not already present
import { InventoryLocationData, HotbarLocationData } from '../generated'; 
// Import the new container utilities
import { 
    handleWorldDrop, 
    handleContainerToPlayerMove, 
    handlePlayerToContainerMove, 
    handleWithinContainerMove,
    handlePlayerToContainerSplit,
    handleContainerToPlayerSplit,
    handleWithinContainerSplit,
    getContainerTypeFromSlotType 
} from '../utils/containerUtils';

// Props for the hook
interface UseDragDropManagerProps {
    connection: DbConnection | null;
    interactingWith: { type: string; id: number | bigint } | null;
    playerIdentity: Identity | null; // Added playerIdentity
}

// Return type of the hook
interface DragDropManager {
    draggedItemInfo: DraggedItemInfo | null;
    dropError: string | null; // Specific error from drop actions
    handleItemDragStart: (info: DraggedItemInfo) => void;
    handleItemDrop: (targetSlot: DragSourceSlotInfo | null) => void;
}

export const useDragDropManager = ({
    connection,
    interactingWith,
    playerIdentity, // Destructure playerIdentity
}: UseDragDropManagerProps): DragDropManager => {
    const [draggedItemInfo, setDraggedItemInfo] = useState<DraggedItemInfo | null>(null);
    const [dropError, setDropError] = useState<string | null>(null);
    // Ref to hold the latest dragged item info, accessible in callbacks
    const draggedItemRef = useRef<DraggedItemInfo | null>(null);

    // Keep ref updated whenever state changes
    useEffect(() => {
        draggedItemRef.current = draggedItemInfo;
    }, [draggedItemInfo]);

    const handleItemDragStart = useCallback((info: DraggedItemInfo) => {
        // console.log("[useDragDropManager] Drag Start:", info);
        setDraggedItemInfo(info);
        setDropError(null); // Clear previous errors on new drag
        document.body.classList.add('item-dragging');
    }, []);

    const handleItemDrop = useCallback((targetSlot: DragSourceSlotInfo | null) => {
        // console.log("[useDragDropManager] Drop Target:", targetSlot);
        document.body.classList.remove('item-dragging');
        const sourceInfo = draggedItemRef.current;

        // Always clear drag state
        draggedItemRef.current = null;
        setDraggedItemInfo(null);
        setDropError(null); // Clear previous errors on new drop attempt

        if (!sourceInfo) {
            // console.log("[useDragDropManager Drop] No source info found, ignoring drop.");
            return;
        }
        if (!connection?.reducers) {
            // console.log("[useDragDropManager Drop] No reducers connection, ignoring drop.");
            setDropError("Cannot perform action: Not connected to server.");
            return;
        }

        const itemInstanceId = BigInt(sourceInfo.item.instance.instanceId);

        // --- Handle Dropping Item into the World ---
        if (targetSlot === null) {
            const quantityToDrop = sourceInfo.splitQuantity ?? sourceInfo.item.instance.quantity;

            try {
                // Try using the new pattern-based world drop handler first
                if (handleWorldDrop(connection, sourceInfo, setDropError)) {
                    return; // Successfully handled by pattern-based system
                }
                
                // Fall back to default player inventory drop
                    // console.log(`[useDragDropManager Drop] Calling drop_item (default/player inventory). Item: ${itemInstanceId}, Qty: ${quantityToDrop}`);
                    connection.reducers.dropItem(itemInstanceId, quantityToDrop);
                
            } catch (error) {
                console.error(`[useDragDropManager Drop] Error calling drop reducer:`, error);
                setDropError(`Failed to drop item: ${(error as any)?.message || error}`);
            }
            return; // Drop handled, exit
        }

        // --- Proceed with logic for dropping onto a slot ---
        // console.log(`[useDragDropManager Drop] Processing drop onto slot: Item ${itemInstanceId} from ${sourceInfo.sourceSlot.type}:${sourceInfo.sourceSlot.index} to ${targetSlot.type}:${targetSlot.index}`);

        try {
            // --- Handle Stack Splitting First ---
            if (sourceInfo.splitQuantity && sourceInfo.splitQuantity > 0) {
                const quantityToSplit = sourceInfo.splitQuantity;
                const sourceSlotType = sourceInfo.sourceSlot.type;
                const targetSlotType = targetSlot.type;
                const sourceInstanceId = BigInt(sourceInfo.item.instance.instanceId);

                // console.log(`[useDragDropManager Drop] Initiating SPLIT: Qty ${quantityToSplit} from ${sourceSlotType}:${sourceInfo.sourceSlot.index} to ${targetSlotType}:${targetSlot.index}`);

                // --- Split Logic ---
                if (sourceSlotType === 'inventory' || sourceSlotType === 'hotbar') {
                    let targetSlotIndexNum: number | null = null;
                    let targetContainerIdNum: number | null = null;

                    if (targetSlotType as string === 'inventory' || targetSlotType as string === 'hotbar') {
                        targetSlotIndexNum = typeof targetSlot.index === 'number' ? targetSlot.index : parseInt(targetSlot.index.toString(), 10);
                        if (isNaN(targetSlotIndexNum)) { setDropError("Invalid target slot index."); return; }

                        // START MODIFICATION: Check if target slot is occupied by a different item type
                        let targetItemInstance: InventoryItem | undefined = undefined;
                        if (connection && playerIdentity) {
                            const allPlayerItems = Array.from(connection.db.inventoryItem.iter());
                            if (targetSlotType === 'inventory') {
                                targetItemInstance = allPlayerItems.find(i =>
                                    i.location.tag === 'Inventory' &&
                                    i.location.value instanceof Object && 'ownerId' in i.location.value && 'slotIndex' in i.location.value && // Type guard
                                    (i.location.value as InventoryLocationData).ownerId.isEqual(playerIdentity) &&
                                    (i.location.value as InventoryLocationData).slotIndex === targetSlotIndexNum
                                );
                            } else { // hotbar
                                targetItemInstance = allPlayerItems.find(i =>
                                    i.location.tag === 'Hotbar' &&
                                    i.location.value instanceof Object && 'ownerId' in i.location.value && 'slotIndex' in i.location.value && // Type guard
                                    (i.location.value as HotbarLocationData).ownerId.isEqual(playerIdentity) &&
                                    (i.location.value as HotbarLocationData).slotIndex === targetSlotIndexNum
                                );
                            }
                        }

                        if (targetItemInstance && sourceInfo.item.definition.id !== targetItemInstance.itemDefId) {
                            // console.log(`[useDragDropManager Drop Split] Prevented split: Source item def ID '${sourceInfo.item.definition.id}' differs from target item def ID '${targetItemInstance.itemDefId}'.`);
                            // setDropError("Cannot stack different item types."); 
                            return; 
                        }
                        // END MODIFICATION

                        // console.log(`[useDragDropManager Drop Split] Calling splitStack (Inv/Hotbar -> Inv/Hotbar)`);
                        connection.reducers.splitStack(sourceInstanceId, quantityToSplit, targetSlotType, targetSlotIndexNum);
                    } else {
                        // Try pattern-based player to container split
                        if (handlePlayerToContainerSplit(connection, sourceInstanceId, quantityToSplit, targetSlot, setDropError)) {
                            return; // Successfully handled by pattern-based system
                        }
                        
                        console.warn(`[useDragDropManager Drop] Split ignored: Cannot split from ${sourceSlotType} to ${targetSlotType}`);
                        setDropError("Cannot split item to that location.");
                    }
                } else {
                    // Handle splits FROM containers (container -> player or container -> container)
                    
                    // Check if this is a within-container split first (same container type)
                    if (getContainerTypeFromSlotType(sourceSlotType) && 
                        sourceSlotType === targetSlotType) {
                        // Within same container type - use pattern-based utility
                        if (handleWithinContainerSplit(connection, sourceInfo, targetSlot, quantityToSplit, setDropError)) {
                            return; // Successfully handled
                        }
                    }
                    
                    if (targetSlotType === 'inventory' || targetSlotType === 'hotbar') {
                        // Container to player split - use pattern-based utility
                        const targetSlotIndexNum = typeof targetSlot.index === 'number' 
                            ? targetSlot.index 
                            : parseInt(targetSlot.index.toString(), 10);
                            
                        if (isNaN(targetSlotIndexNum)) {
                            setDropError("Invalid target slot index.");
                            return;
                        }
                        
                        if (handleContainerToPlayerSplit(connection, sourceInfo, quantityToSplit, targetSlotType, targetSlotIndexNum, setDropError)) {
                            return; // Successfully handled
                        }
                    } else {
                        // Cross-container splits not supported
                        console.warn(`[useDragDropManager Drop] Cross-container split ignored: ${sourceSlotType} -> ${targetSlotType}`);
                        setDropError("Cannot split between different container types.");
                        return;
                    }
                    
                    // If we get here, the split wasn't handled
                    console.warn(`[useDragDropManager Drop] Split not supported: ${sourceSlotType} -> ${targetSlotType}`);
                    setDropError("Split operation not supported for this container combination.");
                }
                return; // Split attempt handled
            }

            // --- Standard Item Move (Full Stack) ---
            if (targetSlot.type === 'inventory' || targetSlot.type === 'hotbar') {
                const targetIndexNum = typeof targetSlot.index === 'number' ? targetSlot.index : parseInt(targetSlot.index.toString(), 10);
                if (isNaN(targetIndexNum)) { 
                    console.error("Invalid slot index", targetSlot.index); 
                    setDropError("Invalid slot."); 
                    return; 
                }
                
                // Try pattern-based container to player move first
                if (handleContainerToPlayerMove(connection, sourceInfo, targetSlot.type, targetIndexNum, setDropError)) {
                    return; // Successfully handled by pattern-based system
                }
                
                // Fall back to default player moves (inv/hotbar/equip to inv/hotbar)
                if (targetSlot.type === 'inventory') {
                    connection.reducers.moveItemToInventory(itemInstanceId, targetIndexNum);
                } else { // hotbar
                    connection.reducers.moveItemToHotbar(itemInstanceId, targetIndexNum);
                }
                
            } else if (targetSlot.type === 'equipment' && typeof targetSlot.index === 'string') {
                connection.reducers.equipArmorFromDrag(itemInstanceId, targetSlot.index);
                
                } else {
                // Check if this is a within-container move first (same container type)
                if (getContainerTypeFromSlotType(sourceInfo.sourceSlot.type) && 
                    sourceInfo.sourceSlot.type === targetSlot.type) {
                    // Within same container type - use pattern-based utility
                    if (handleWithinContainerMove(connection, sourceInfo, targetSlot, setDropError)) {
                        return; // Successfully handled by pattern-based system
                    }
                }
                
                // Only try player to container move if source is actually from player
                if (sourceInfo.sourceSlot.type === 'inventory' || sourceInfo.sourceSlot.type === 'hotbar') {
                    // Try pattern-based player to container move
                    if (handlePlayerToContainerMove(connection, itemInstanceId, targetSlot, interactingWith, setDropError)) {
                        return; // Successfully handled by pattern-based system
                    }
                }
                
                // If we get here, it's an unsupported operation
                console.warn(`[useDragDropManager Drop] Unsupported drop operation: ${sourceInfo.sourceSlot.type} -> ${targetSlot.type}`);
                setDropError("Cannot move item to that location.");
            }
        } catch (error: any) {
            console.error("[useDragDropManager Drop] Error handling drop:", error);
            // Don't show technical errors to users - just log them for debugging
            // Most drop failures are due to validation or connection issues that don't need user notification
            return;
        }
    }, [connection, interactingWith, playerIdentity]);

    return { draggedItemInfo, dropError, handleItemDragStart, handleItemDrop };
};
