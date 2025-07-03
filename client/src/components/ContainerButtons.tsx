/**
 * ContainerButtons Component
 * 
 * Simple component that eliminates the repetitive button logic in ExternalContainerUI.tsx
 * Handles toggle/light/extinguish operations for fuel containers.
 */

import React from 'react';
import { ContainerType, ContainerEntity, getContainerConfig, isFuelContainer } from '../utils/containerUtils';
import { PopulatedItem } from './InventoryUI';
import { Campfire, Furnace, Lantern } from '../generated';
import styles from './InventoryUI.module.css';

interface ContainerButtonsProps {
    containerType: ContainerType;
    containerEntity: ContainerEntity | null;
    items: (PopulatedItem | null)[];
    onToggle: () => void;
    
    // Special props for lantern light/extinguish
    onLight?: () => void;
    onExtinguish?: () => void;
    
    // Optional additional buttons
    children?: React.ReactNode;
}

const ContainerButtons: React.FC<ContainerButtonsProps> = ({
    containerType,
    containerEntity,
    items,
    onToggle,
    onLight,
    onExtinguish,
    children
}) => {
    const config = getContainerConfig(containerType);
    
    // Only render buttons for fuel containers
    if (!isFuelContainer(containerType) || !containerEntity) {
        return children ? <>{children}</> : null;
    }
    
    const isActive = (containerEntity as any).isBurning || false;
    
    // Check if container has valid fuel
    const hasValidFuel = items.some(item => 
        item && 
        item.definition.fuelBurnDurationSecs !== undefined && 
        item.definition.fuelBurnDurationSecs > 0 && 
        item.instance.quantity > 0
    );
    
    // For lanterns, only check for tallow
    const hasValidLanternFuel = containerType === 'lantern' && items.some(item => 
        item && 
        item.definition.name === 'Tallow' && 
        item.instance.quantity > 0
    );
    
    const isDisabled = !isActive && (containerType === 'lantern' ? !hasValidLanternFuel : !hasValidFuel);
    
    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
            {/* Toggle/Light/Extinguish Button */}
            {config.hasToggle && (
                <button
                    onClick={onToggle}
                    disabled={isDisabled}
                    className={`${styles.interactionButton} ${
                        isActive ? styles.extinguishButton : styles.lightFireButton
                    }`}
                >
                    {getButtonText(containerType, isActive)}
                </button>
            )}
            
            {/* Lantern Light/Extinguish Buttons */}
            {config.hasLightExtinguish && (
                <div style={{ display: 'flex', gap: '4px' }}>
                    <button
                        onClick={onLight || onToggle}
                        disabled={isActive || !hasValidLanternFuel}
                        className={`${styles.interactionButton} ${styles.lightFireButton}`}
                    >
                        Light Lantern
                    </button>
                    <button
                        onClick={onExtinguish || onToggle}
                        disabled={!isActive}
                        className={`${styles.interactionButton} ${styles.extinguishButton}`}
                    >
                        Extinguish
                    </button>
                </div>
            )}
            
            {/* Additional buttons passed as children */}
            {children}
        </div>
    );
};

/**
 * Get button text based on container type and state
 */
function getButtonText(containerType: ContainerType, isActive: boolean): string {
    if (isActive) {
        switch (containerType) {
            case 'campfire': return 'Extinguish';
            case 'furnace': return 'Extinguish';
            case 'lantern': return 'Extinguish';
            default: return 'Stop';
        }
    } else {
        switch (containerType) {
            case 'campfire': return 'Light Fire';
            case 'furnace': return 'Light Furnace';
            case 'lantern': return 'Light Lantern';
            default: return 'Start';
        }
    }
}

export default ContainerButtons; 