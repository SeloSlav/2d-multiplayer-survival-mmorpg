import React, { useState, useCallback, useRef } from 'react';
import { DragSourceSlotInfo } from '../types/dragDropTypes'; // Corrected import path
import styles from './DroppableSlot.module.css'; // We'll create this CSS file

interface DroppableSlotProps {
  children?: React.ReactNode; // Will contain DraggableItem if item exists
  className?: string; // Allow passing additional classes
  slotInfo: DragSourceSlotInfo; // Info about this slot (type, index)
  onItemDrop: (targetSlotInfo: DragSourceSlotInfo | null) => void; // Modified for null target
  // Add prop to check if currently dragging something
  isDraggingOver: boolean; // True if an item is being dragged over this slot
  style?: React.CSSProperties; // <-- Add style prop
  onClick?: (event: React.MouseEvent<HTMLDivElement>) => void; // <-- Add onClick prop
  // Overlay props for cooldowns
  overlayProgress?: number; // 0-1, progress of the overlay (0 = full overlay, 1 = no overlay)
  overlayColor?: string; // Color of the overlay
  overlayType?: 'consumable' | 'weapon'; // Type of overlay for styling
}

const DroppableSlot: React.FC<DroppableSlotProps> = ({
  children,
  className = '',
  slotInfo,
  onItemDrop,
  isDraggingOver,
  style,
  onClick, // <-- Destructure onClick
  overlayProgress,
  overlayColor = 'rgba(0, 0, 0, 0.4)',
  overlayType = 'consumable',
}) => {
  const slotRef = useRef<HTMLDivElement>(null);

  // Basic class construction
  const combinedClassName = `${styles.droppableSlot} ${className}`;

  // Prepare parentId attribute conditionally
  const parentIdAttr = slotInfo.parentId ? { 'data-slot-parent-id': slotInfo.parentId.toString() } : {};

  return (
    <div
      ref={slotRef}
      className={combinedClassName}
      style={style}
      data-slot-type={slotInfo.type}
      data-slot-index={slotInfo.index}
      {...parentIdAttr} // Spread the parentId attribute if it exists
      onClick={onClick} // <-- Pass onClick to the div
    >
      {children}
      
      {/* Render overlay directly in the slot */}
      {overlayProgress !== undefined && overlayProgress < 1 && (
        <div 
          style={{
            position: 'absolute',
            top: '0px',
            left: '0px',
            right: '0px',
            bottom: '0px',
            width: '100%',
            height: '100%',
            zIndex: overlayType === 'consumable' ? 99999 : 99998,
            pointerEvents: 'none',
            isolation: 'isolate',
            transform: 'translateZ(0)',
          }}
        >
          <div 
            style={{
              position: 'absolute',
              top: '0px',
              left: '0px',
              width: '100%',
              height: `${(1 - overlayProgress) * 100}%`, // Shrinks from top to bottom
              backgroundColor: overlayColor,
              borderRadius: '2px',
            }}
            title={`${overlayType === 'weapon' ? 'Weapon' : 'Consumable'} Cooldown: ${Math.round((1 - overlayProgress) * 100)}% remaining`} 
          />
        </div>
      )}
    </div>
  );
};

export default DroppableSlot; 