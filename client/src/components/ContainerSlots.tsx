/**
 * ContainerSlots Component
 * 
 * Simple component that eliminates the repetitive slot rendering logic in ExternalContainerUI.tsx
 * Handles the DroppableSlot + DraggableItem pattern that's duplicated 7 times.
 */

import React from 'react';
import DroppableSlot from './DroppableSlot';
import DraggableItem from './DraggableItem';
import { PopulatedItem } from './InventoryUI';
import { DragSourceSlotInfo, DraggedItemInfo } from '../types/dragDropTypes';
import { ContainerType, getContainerConfig } from '../utils/containerUtils';
import { isWaterContainer, getWaterLevelPercentage } from '../utils/waterContainerHelpers';
import styles from './InventoryUI.module.css';

interface ContainerSlotsProps {
    containerType: ContainerType;
    items: (PopulatedItem | null)[];
    createSlotInfo: (index: number) => DragSourceSlotInfo | null;
    getSlotKey: (index: number) => string;
    
    // Drag and drop handlers
    onItemDragStart: (info: DraggedItemInfo) => void;
    onItemDrop: (targetSlotInfo: DragSourceSlotInfo | null) => void;
    
    // Context menu handler
    onContextMenu: (event: React.MouseEvent, itemInfo: PopulatedItem, slotIndex: number) => void;
    
    // Mouse event handlers for tooltips
    onItemMouseEnter: (item: PopulatedItem, event: React.MouseEvent<HTMLDivElement>) => void;
    onItemMouseLeave: () => void;
    onItemMouseMove: (event: React.MouseEvent<HTMLDivElement>) => void;
    
    // Optional styling
    className?: string;
    style?: React.CSSProperties;
}

const ContainerSlots: React.FC<ContainerSlotsProps> = ({
    containerType,
    items,
    createSlotInfo,
    getSlotKey,
    onItemDragStart,
    onItemDrop,
    onContextMenu,
    onItemMouseEnter,
    onItemMouseLeave,
    onItemMouseMove,
    className,
    style
}) => {
    const config = getContainerConfig(containerType);
    
    // Determine if this should render as a grid
    const isGridLayout = config.gridCols && config.gridCols > 1;
    
    // Container styles
    const containerStyle: React.CSSProperties = {
        ...style,
        ...(isGridLayout ? {
            display: 'grid',
            gridTemplateColumns: `repeat(${config.gridCols}, 1fr)`,
            gap: '4px'
        } : {
            display: 'flex',
            flexDirection: 'row',
            gap: '4px',
            // Center all containers
            justifyContent: 'center'
        })
    };
    
    const containerClassName = className || (isGridLayout ? styles.inventoryGrid : styles.multiSlotContainer);
    
    return (
        <div className={containerClassName} style={containerStyle}>
            {Array.from({ length: config.slots }).map((_, index) => {
                const itemInSlot = items[index] || null;
                const slotInfo = createSlotInfo(index);
                const slotKey = getSlotKey(index);
                
                if (!slotInfo) return null;
                
                return (
                    <DroppableSlot
                        key={slotKey}
                        slotInfo={slotInfo}
                        onItemDrop={onItemDrop}
                        className={styles.slot}
                        isDraggingOver={false} // Could be enhanced with actual drag state
                    >
                        {itemInSlot && (
                            <DraggableItem
                                item={itemInSlot}
                                sourceSlot={slotInfo}
                                onItemDragStart={onItemDragStart}
                                onItemDrop={onItemDrop}
                                onContextMenu={(event) => onContextMenu(event, itemInSlot, index)}
                                onMouseEnter={(e) => onItemMouseEnter(itemInSlot, e)}
                                onMouseLeave={onItemMouseLeave}
                                onMouseMove={onItemMouseMove}
                            />
                        )}
                        
                        {/* Water level indicator - same pattern used across all containers */}
                        {itemInSlot && isWaterContainer(itemInSlot.definition.name) && (
                            <WaterLevelIndicator item={itemInSlot} />
                        )}
                    </DroppableSlot>
                );
            })}
        </div>
    );
};

// Water level indicator component - extracted from repeated pattern
const WaterLevelIndicator: React.FC<{ item: PopulatedItem }> = ({ item }) => {
    const waterLevelPercentage = getWaterLevelPercentage(item.instance, item.definition.name);
    const hasWater = waterLevelPercentage > 0;
    
    return (
        <div
            style={{
                position: 'absolute',
                left: '4px',
                top: '4px',
                bottom: '4px',
                width: '3px',
                backgroundColor: 'rgba(0, 0, 0, 0.5)',
                borderRadius: '1px',
                zIndex: 4,
                pointerEvents: 'none',
            }}
        >
            {hasWater && (
                <div
                    style={{
                        position: 'absolute',
                        bottom: '0px',
                        left: '0px',
                        right: '0px',
                        height: `${waterLevelPercentage * 100}%`,
                        backgroundColor: 'rgba(0, 150, 255, 0.8)',
                        borderRadius: '1px',
                        transition: 'height 0.3s ease-in-out',
                    }}
                />
            )}
        </div>
    );
};

export default ContainerSlots; 