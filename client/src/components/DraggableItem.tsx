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
}

const DraggableItem: React.FC<DraggableItemProps> = ({ 
  item, 
  sourceSlot,
  onItemDragStart,
  onItemDrop,
  onContextMenu
}) => {
  const itemRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const currentSplitQuantity = useRef<number | null>(null); // Ref to hold split qty for ghost
  const [isDraggingState, setIsDraggingState] = useState(false); // State for component re-render/styling
  const isDraggingRef = useRef(false); // Ref for up-to-date state in document listeners
  const dragStartPos = useRef({ x: 0, y: 0 });
  const didDragRef = useRef(false);

  const createGhostElement = useCallback((e: MouseEvent | Touch, splitQuantity: number | null) => {
    // console.log(`[DraggableItem] Creating ghost element... Split: ${splitQuantity}`);
    if (ghostRef.current && document.body.contains(ghostRef.current)) {
      document.body.removeChild(ghostRef.current);
    }

    const ghost = document.createElement('div');
    ghost.id = 'drag-ghost';
    ghost.className = styles.dragGhost; // Use CSS module class
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
        quantityEl.className = styles.ghostQuantity; // Use CSS module class
        ghost.appendChild(quantityEl);
    }

    document.body.appendChild(ghost);
    ghostRef.current = ghost;
    // console.log("[DraggableItem] Ghost element appended.");
  }, [item]); // Dependency: item (for definition and original quantity)

  const handleMouseMove = useCallback((e: MouseEvent) => {
    // Use the ref to check dragging status
    if (!isDraggingRef.current) return;

    // Basic movement threshold check
    const dx = e.clientX - dragStartPos.current.x;
    const dy = e.clientY - dragStartPos.current.y;
    const distSq = dx*dx + dy*dy;
    const thresholdSq = 2*2; // Compare squared distances. Lowered from 3*3 for more sensitivity.

    // Update ghost position IF it exists
    if (ghostRef.current) {
        ghostRef.current.style.left = `${e.clientX + 10}px`;
        ghostRef.current.style.top = `${e.clientY + 10}px`;
    }
    // Create ghost only if threshold is met AND ghost doesn't exist yet
    else if (distSq >= thresholdSq) {
        didDragRef.current = true;
        // console.log(`[DraggableItem] Drag threshold met, didDrag = true.`);
        createGhostElement(e, currentSplitQuantity.current);
    }
  }, [createGhostElement]);

  const handleMouseUp = useCallback((e: MouseEvent) => {
    // Capture drag state BEFORE removing listeners / resetting state
    const wasDragging = didDragRef.current;
    // console.log(`[DraggableItem MouseUp] Button: ${e.button}, wasDragging: ${wasDragging}`);

    if (!isDraggingRef.current) {
        // Safety check - mouseup when not dragging shouldn't happen often here
        // but ensure listeners are cleaned up if it does.
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        return; 
    }

    // --- Remove Listeners FIRST --- 
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);

    // --- Determine Drop Target --- 
    let targetSlotInfo: DragSourceSlotInfo | null = null;
    let dropHandledInternal = false; 
    if (ghostRef.current) {
      ghostRef.current.style.display = 'none'; 
      const dropTargetElement = document.elementFromPoint(e.clientX, e.clientY);
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
                      const isSameSlot = sourceSlot.type === currentTargetSlotInfo.type && 
                                       sourceSlot.index === currentTargetSlotInfo.index && 
                                       sourceSlot.parentId?.toString() === currentTargetSlotInfo.parentId?.toString();

                      if (!isSameSlot) { 
                           dropHandledInternal = true;
                      } else {
                          // console.log("[DraggableItem] Drop on source slot ignored (no action needed).");
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
    } else {
        // console.log("[DraggableItem] MouseUp without significant drag/ghost.");
    }
    // --- End Drop Target Determination ---

    // --- NEW Decision Logic --- 
    if (e.button === 2) { // Right Button Release
        if (wasDragging) {
            // Right-DRAG: Perform the drop action (split/merge)
            // console.log("[DraggableItem MouseUp] Right-DRAG detected. Calling onItemDrop.");
             if (dropHandledInternal) {
                onItemDrop(targetSlotInfo); 
            } else {
                onItemDrop(null); // Dropped outside
            }
        } else {
            // Right-CLICK: Perform the context menu action
            // console.log("[DraggableItem MouseUp] Right-CLICK detected. Calling onContextMenu prop.");
            if (onContextMenu) {
                // We might need to pass a simulated event if the handler expects it,
                // but for now, let's pass null or a minimal object. 
                // Pass the original mouse event `e` for position info if needed.
                onContextMenu(e as any, item); // Call the prop function
            }
        }
    } else { // Left or Middle Button Release
        // console.log("[DraggableItem MouseUp] Left/Middle mouse button released.");
        if (dropHandledInternal && targetSlotInfo) {
            // Valid drop onto different slot
            // console.log("[DraggableItem MouseUp] Valid L/M drop. Calling onItemDrop with target:", targetSlotInfo);
            onItemDrop(targetSlotInfo);
        } else if (wasDragging) {
            // Dragged, but ended outside or on source slot
            // Only call drop(null) if it ended outside a valid target altogether
            if (!targetSlotInfo) { // If targetSlotInfo is null (meaning not over a valid slot)
                 // console.log("[DraggableItem MouseUp] L/M Dragged outside. Calling onItemDrop(null).");
                 onItemDrop(null);
            } else {
                 // Dragged, but ended on source slot or invalid target. No action needed.
                 // console.log("[DraggableItem MouseUp] L/M Dragged to source/invalid. No drop action.");
                 // App state is cleared by App.handleItemDrop unconditionally.
            }
        } else {
            // Simple click without drag. No action needed.
            // console.log("[DraggableItem MouseUp] Simple left/middle click. No drop action.");
            // App state is cleared by App.handleItemDrop unconditionally.
        }
    }
    // --- End Decision Logic ---

    // Common Cleanup (Visuals, Dragging State)
    isDraggingRef.current = false;
    setIsDraggingState(false);
    document.body.classList.remove('item-dragging');
    if (itemRef.current) {
         itemRef.current.style.opacity = '1';
    }

  }, [handleMouseMove, item, sourceSlot, onItemDrop, onContextMenu]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // --- RESTORE Resetting didDrag flag --- 
    didDragRef.current = false;
    // --- END RESTORE ---

    // --- NEW: Prevent default for right-click --- 
    if (e.button === 2) {
        // console.log('[DraggableItem MouseDown] Right button pressed, preventing default.');
        e.preventDefault(); // Attempt to suppress native context menu
    }
    // --- END NEW ---

    // Check stackability and quantity for splitting possibility
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
            // If right-click and stackable, initiate drag with a split quantity of 1.
            splitQuantity = 1;
        }
    }
    currentSplitQuantity.current = splitQuantity;

    dragStartPos.current = { x: e.clientX, y: e.clientY };
    isDraggingRef.current = true;
    setIsDraggingState(true);
    document.body.classList.add('item-dragging');
    if (itemRef.current) {
      itemRef.current.style.opacity = '0.5'; // Make original item semi-transparent
    }
    
    // Construct the DraggedItemInfo
    const dragInfo: DraggedItemInfo = {
      item: item, 
      sourceSlot: sourceSlot,
      sourceContainerType: sourceSlot.type, // Use type from sourceSlot
      sourceContainerEntityId: sourceSlot.parentId, // Use parentId from sourceSlot
      splitQuantity: currentSplitQuantity.current === null ? undefined : currentSplitQuantity.current,
    };

    // console.log("[DraggableItem MouseDown] Starting drag. Info:", dragInfo);
    onItemDragStart(dragInfo);

    // Add temporary listeners to the document
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

  }, [item, sourceSlot, onItemDragStart, handleMouseMove, handleMouseUp, createGhostElement]);

  // Basic rendering of the item
  return (
    <div 
      ref={itemRef}
      className={`${styles.draggableItem} ${isDraggingState ? styles.isDraggingFeedback : ''}`}
      onMouseDown={handleMouseDown}
      title={`${item.definition.name}${item.definition.description ? ' - ' + item.definition.description : ''}`}
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