// Water container helper functions for client-side
import { InventoryItem } from '../generated';

/**
 * Get water content from a water container item
 */
export function getWaterContent(item: InventoryItem): number | null {
    if (!item.itemData) {
        return null;
    }

    try {
        const data = JSON.parse(item.itemData);
        return data.water_liters || null;
    } catch (error) {
        console.error('Failed to parse item data:', error);
        return null;
    }
}

/**
 * Check if an item is a water container type
 */
export function isWaterContainer(itemName: string): boolean {
    return itemName === 'Reed Water Bottle' || itemName === 'Plastic Water Jug';
}

/**
 * Check if a water container has water content
 */
export function hasWaterContent(item: InventoryItem): boolean {
    return getWaterContent(item) !== null;
}

/**
 * Get water capacity for a water container type
 */
export function getWaterCapacity(itemName: string): number {
    switch (itemName) {
        case 'Reed Water Bottle':
            return 2.0; // 2 liters
        case 'Plastic Water Jug':
            return 5.0; // 5 liters
        default:
            return 0;
    }
}

/**
 * Format water content for display
 */
export function formatWaterContent(item: InventoryItem, itemName: string): string {
    const waterContent = getWaterContent(item);
    const capacity = getWaterCapacity(itemName);
    
    if (waterContent === null) {
        return 'Empty';
    }
    
    return `${waterContent.toFixed(1)}L / ${capacity.toFixed(1)}L`;
}

/**
 * Calculates the water level percentage (0-1) for visual indicators
 */
export function getWaterLevelPercentage(item: InventoryItem, itemName: string): number {
    const waterContent = getWaterContent(item);
    const capacity = getWaterCapacity(itemName);
    
    if (capacity === 0 || waterContent === null) {
        return 0;
    }
    
    return Math.min(1, waterContent / capacity);
} 