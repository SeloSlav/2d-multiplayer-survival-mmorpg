import React, { useRef, useState, useEffect, useCallback } from 'react';
import { PopulatedItem } from './InventoryUI'; // Assuming type is exported from InventoryUI
import { DragSourceSlotInfo, DraggedItemInfo } from '../types/dragDropTypes'; // Correct import path
import { itemIcons, getItemIcon } from '../utils/itemIconUtils';
import styles from './DraggableItem.module.css'; // We'll create this CSS file

interface DraggableItemProps {
  item: PopulatedItem;
  sourceSlot: DragSourceSlotInfo; // Where the item currently is
  onItemDragStart: (info: DraggedItemInfo) => void; // Callback to notify parent
  onItemDrop: (targetSlotInfo: DragSourceSlotInfo | null) => void; // Allow null
  onContextMenu?: (event: React.MouseEvent<HTMLDivElement>, itemInfo: PopulatedItem) => void;
  onMouseEnter?: (event: React.MouseEvent<HTMLDivElement>, item: PopulatedItem) => void;
  onMouseLeave?: (event: React.MouseEvent<HTMLDivElement>) => void;
  onMouseMove?: (event: React.MouseEvent<HTMLDivElement>) => void;
  onClick?: (event: React.MouseEvent<HTMLDivElement>) => void;
}

const DraggableItem: React.FC<DraggableItemProps> = ({ 
  item, 
  sourceSlot,
  onItemDragStart,
  onItemDrop,
  onContextMenu,
  onMouseEnter,
  onMouseLeave,
  onMouseMove,
  onClick
}) => {
  const itemRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const currentSplitQuantity = useRef<number | null>(null); // Ref to hold split qty for ghost
  const [isDraggingState, setIsDraggingState] = useState(false); // State for component re-render/styling
  const isDraggingRef = useRef(false); // Ref for up-to-date state in document listeners
  const dragStartPos = useRef({ x: 0, y: 0 });
  const didDragRef = useRef(false);

  const createGhostElement = useCallback((e: MouseEvent | Touch, splitQuantity: number | null) => {
    console.log('[Ghost] Creating ghost element:', { splitQuantity, event: { x: e.clientX, y: e.clientY } });
    if (ghostRef.current && document.body.contains(ghostRef.current)) {
      document.body.removeChild(ghostRef.current);
    }

    const ghost = document.createElement('div');
    ghost.id = 'drag-ghost';
    ghost.className = styles.dragGhost;
    ghost.style.left = `${e.clientX + 10}px`;
    ghost.style.top = `${e.clientY + 10}px`;

    const imgEl = document.createElement('img');
    imgEl.src = getItemIcon(item.definition.iconAssetName) || '';
    imgEl.alt = item.definition.name;
    imgEl.style.width = '40px'; 
    imgEl.style.height = '40px';
    imgEl.style.objectFit = 'contain';
    imgEl.style.imageRendering = 'pixelated';
    ghost.appendChild(imgEl);

    // Display quantity: Either the split quantity or the original quantity
    const displayQuantity = splitQuantity ?? (item.definition.isStackable && item.instance.quantity > 1 ? item.instance.quantity : null);

    if (displayQuantity) {
        const quantityEl = document.createElement('div');
        quantityEl.textContent = displayQuantity.toString();
        quantityEl.className = styles.ghostQuantity;
        ghost.appendChild(quantityEl);
    }

    document.body.appendChild(ghost);
    ghostRef.current = ghost;
    console.log('[Ghost] Ghost element created and appended to body');
  }, [item]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    console.log('[Ghost] Mouse move event:', { 
      isDragging: isDraggingRef.current,
      hasGhost: !!ghostRef.current,
      pos: { x: e.clientX, y: e.clientY }
    });

    // Check if we've moved enough to start dragging
    const dx = e.clientX - dragStartPos.current.x;
    const dy = e.clientY - dragStartPos.current.y;
    const distSq = dx*dx + dy*dy;
    const thresholdSq = 2*2; // Compare squared distances

    if (distSq >= thresholdSq && !isDraggingRef.current) {
        console.log('[Ghost] Starting drag operation');
        // Only now do we start dragging
        isDraggingRef.current = true;
        didDragRef.current = true;
        setIsDraggingState(true);
        document.body.classList.add('item-dragging');
        if (itemRef.current) {
            itemRef.current.style.opacity = '0.5';
        }

        // Construct and send drag info
        const dragInfo: DraggedItemInfo = {
            item: item,
            sourceSlot: sourceSlot,
            sourceContainerType: sourceSlot.type,
            sourceContainerEntityId: sourceSlot.parentId,
            splitQuantity: currentSplitQuantity.current === null ? undefined : currentSplitQuantity.current,
        };
        onItemDragStart(dragInfo);

        // Create ghost element
        createGhostElement(e, currentSplitQuantity.current);
    }

    // Update ghost position if we're dragging
    if (isDraggingRef.current && ghostRef.current) {
        ghostRef.current.style.left = `${e.clientX + 10}px`;
        ghostRef.current.style.top = `${e.clientY + 10}px`;
    }
  }, [item, sourceSlot, onItemDragStart, createGhostElement]);

  const handleMouseUp = useCallback((e: MouseEvent) => {
    const wasDragging = isDraggingRef.current;

    // Clean up listeners first
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);

    // If we weren't dragging, this is a click
    if (!wasDragging) {
        if (e.button === 0 && onClick) { // Left click
            onClick(e as any);
        } else if (e.button === 2 && onContextMenu) { // Right click
            onContextMenu(e as any, item);
        }
        return;
    }

    // Handle drag end
    if (ghostRef.current) {
        ghostRef.current.style.display = 'none';
        const dropTargetElement = document.elementFromPoint(e.clientX, e.clientY);
        
        let targetSlotInfo: DragSourceSlotInfo | null = null;
        let isSameSlot = false;
        let dropHandledInternal = false; 
        if (dropTargetElement) {
            const droppableSlot = dropTargetElement.closest('[data-slot-type]');
            if (droppableSlot) {
                const targetType = droppableSlot.getAttribute('data-slot-type') as DragSourceSlotInfo['type'];
                const targetIndexAttr = droppableSlot.getAttribute('data-slot-index');
                const targetParentIdAttr = droppableSlot.getAttribute('data-slot-parent-id'); 

                if (targetType && targetIndexAttr !== null) {
                    const targetIndex: number | string = (targetType === 'inventory' || targetType === 'hotbar' || targetType === 'campfire_fuel' || targetType === 'wooden_storage_box') 
                                                    ? parseInt(targetIndexAttr, 10) 
                                                    : targetIndexAttr; 
                    
                    // Parse parentId: Attempt BigInt conversion, handle potential errors/NaN
                    let parentId: number | bigint | undefined = undefined;
                    if (targetParentIdAttr) {
                        try {
                            // Attempt BigInt conversion first (common case)
                            parentId = BigInt(targetParentIdAttr);
                        } catch (bigIntError) {
                            // If BigInt fails, try Number (maybe it was a regular number string?)
                            const numVal = Number(targetParentIdAttr);
                            if (!isNaN(numVal)) {
                                parentId = numVal;
                            } else {
                                console.warn(`Could not parse parentId attribute: ${targetParentIdAttr}`);
                            }
                        }
                    }
                    
                    if (!isNaN(targetIndex as number) || typeof targetIndex === 'string') { 
                        // Construct targetSlotInfo only if index is valid
                        const currentTargetSlotInfo: DragSourceSlotInfo = { 
                            type: targetType, 
                            index: targetIndex, 
                            parentId: parentId 
                        };
                        targetSlotInfo = currentTargetSlotInfo; // Assign to outer scope variable

                        // Check if dropping onto the same source slot (including parent)
                        isSameSlot = sourceSlot.type === currentTargetSlotInfo.type && 
                                    sourceSlot.index === currentTargetSlotInfo.index && 
                                    sourceSlot.parentId?.toString() === currentTargetSlotInfo.parentId?.toString();

                        if (!isSameSlot) { 
                            dropHandledInternal = true;
                        } else {
                            dropHandledInternal = true; 
                            targetSlotInfo = null; // Reset target if it was the source
                        }
                    }
                }
            } 
        }

        if (ghostRef.current && document.body.contains(ghostRef.current)) {
            document.body.removeChild(ghostRef.current);
        }
        ghostRef.current = null;

        // Clean up drag state
        isDraggingRef.current = false;
        setIsDraggingState(false);
        document.body.classList.remove('item-dragging');
        if (itemRef.current) {
            itemRef.current.style.opacity = '1';
        }

        // Call appropriate drop handler
        if (targetSlotInfo && !isSameSlot) {
            onItemDrop(targetSlotInfo);
        } else if (!targetSlotInfo) {
            onItemDrop(null);
        }
    } else {
        // console.log("[DraggableItem] MouseUp without significant drag/ghost.");
    }

  }, [handleMouseMove, item, sourceSlot, onItemDrop, onContextMenu, onClick]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    console.log('[Ghost] Mouse down event:', {
      button: e.button,
      pos: { x: e.clientX, y: e.clientY },
      splitQuantity: (e.currentTarget as any).currentSplitQuantity?.current
    });

    // Reset drag state
    didDragRef.current = false;
    isDraggingRef.current = false; // Start as not dragging
    
    // Store initial position for drag detection
    dragStartPos.current = { x: e.clientX, y: e.clientY };

    // Prevent default for right-click
    if (e.button === 2) {
        e.preventDefault();
    }

    // Check for split quantity from synthetic event
    const syntheticSplitQuantity = (e.currentTarget as any).currentSplitQuantity?.current;
    if (syntheticSplitQuantity !== undefined) {
        console.log('[Ghost] Using synthetic split quantity:', syntheticSplitQuantity);
        currentSplitQuantity.current = syntheticSplitQuantity;
    } else {
        // Normal mouse interaction split logic
        const canSplit = item.definition.isStackable && item.instance.quantity > 1;
        let splitQuantity: number | null = null;
        if (canSplit) {
            if (e.button === 1) { // Middle mouse button
                e.preventDefault(); 
                if (e.shiftKey) {
                    splitQuantity = Math.max(1, Math.floor(item.instance.quantity / 3));
                } else {
                    splitQuantity = Math.max(1, Math.floor(item.instance.quantity / 2));
                }
            } else if (e.button === 0 && e.ctrlKey) { // Ctrl + Left Click for splitting
                e.preventDefault();
                splitQuantity = Math.max(1, Math.floor(item.instance.quantity / 2));
            } else if (e.button === 2) { // Right mouse button (for drag-split)
                splitQuantity = 1;
            }
        }
        currentSplitQuantity.current = splitQuantity;
    }

    // Add temporary listeners to the document
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

  }, [item, handleMouseMove, handleMouseUp]);

  const handleDragStart = (event: React.DragEvent<HTMLDivElement>) => {
    // console.log("[DraggableItem] Drag Start, Item:", item, "Source Slot:", sourceSlot);
    const dragInfo: DraggedItemInfo = {
      item: item, // Corrected: pass the whole PopulatedItem
      sourceSlot: sourceSlot
    };
    onItemDragStart(dragInfo);
    // Minimal data for drag image, actual data transfer via state
    event.dataTransfer.setData('text/plain', item.instance.instanceId.toString());
    // Consider a custom drag image if desired
    // event.dataTransfer.setDragImage(event.currentTarget, 0, 0);
  };

  const handleContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    if (onContextMenu) {
      onContextMenu(event, item);
    }
  };

  // Basic rendering of the item
  return (
    <div 
      ref={itemRef}
      className={`${styles.draggableItem} ${isDraggingState ? styles.isDraggingFeedback : ''}`}
      onMouseDown={handleMouseDown}
      onDragStart={handleDragStart}
      onDragEnd={() => onItemDrop(null)}
      title={`${item.definition.name} (x${item.instance.quantity})`}
      onContextMenu={handleContextMenu}
      onMouseEnter={onMouseEnter ? (e) => onMouseEnter(e, item) : undefined}
      onMouseLeave={onMouseLeave}
      onMouseMove={onMouseMove}
    >
      <img
        src={getItemIcon(item.definition.iconAssetName)}
        alt={item.definition.name}
        className={styles.itemImage}
        draggable="false" // Prevent native image drag
      />
      {item.definition.isStackable && item.instance.quantity > 1 && (
        <div className={styles.itemQuantity}>{item.instance.quantity}</div>
      )}
    </div>
  );
};

export default DraggableItem;