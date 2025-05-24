/**
 * ItemInteractionPanel.tsx
 * 
 * Displays an item interaction panel that appears when a player left-clicks an item.
 * Shows the item's icon, name, description, and context-specific action buttons.
 * Supports actions like "Crush" for bones/skulls, "Consume" for consumables,
 * and stack splitting for all stackable items.
 */

import React, { useCallback, useState, useEffect } from 'react';
import styles from './ItemInteractionPanel.module.css';
import { PopulatedItem } from './InventoryUI';
import { DbConnection } from '../generated';
import { getItemIcon } from '../utils/itemIconUtils';

interface ItemInteractionPanelProps {
    selectedItem: PopulatedItem;
    connection: DbConnection | null;
    onClose: () => void;
    onStartSplitDrag?: (itemInfo: PopulatedItem, quantity: number) => void;
}

interface ItemAction {
    label: string;
    action: string;
    description: string;
    buttonStyle?: string; // Optional class name for button styling
}

const ItemInteractionPanel: React.FC<ItemInteractionPanelProps> = ({ 
    selectedItem, 
    connection, 
    onClose,
    onStartSplitDrag
}) => {
    const [isProcessing, setIsProcessing] = useState(false);
    const [currentItemQuantity, setCurrentItemQuantity] = useState(selectedItem.instance.quantity);
    const [splitQuantity, setSplitQuantity] = useState(1);

    // Update quantity and reset split quantity when selected item changes
    useEffect(() => {
        setCurrentItemQuantity(selectedItem.instance.quantity);
        setSplitQuantity(1);
    }, [selectedItem]);

    // Subscribe to inventory updates to track item quantity
    useEffect(() => {
        if (!connection) return;

        const handleInventoryUpdate = (ctx: any, oldRow: any, newRow: any) => {
            if (newRow.instanceId === selectedItem.instance.instanceId) {
                setCurrentItemQuantity(newRow.quantity);
                if (newRow.quantity === 0) {
                    // Item stack is depleted, close panel
                    onClose();
                }
            }
        };

        const handleInventoryDelete = (ctx: any, row: any) => {
            if (row.instanceId === selectedItem.instance.instanceId) {
                // Item was deleted, close panel
                onClose();
            }
        };

        // Subscribe to inventory updates
        connection.db.inventoryItem.onUpdate(handleInventoryUpdate);
        connection.db.inventoryItem.onDelete(handleInventoryDelete);

        return () => {
            // Cleanup subscriptions
            connection.db.inventoryItem.removeOnUpdate(handleInventoryUpdate);
            connection.db.inventoryItem.removeOnDelete(handleInventoryDelete);
        };
    }, [connection, selectedItem.instance.instanceId, onClose]);

    // Determine available actions based on item definition
    const getAvailableActions = useCallback((item: PopulatedItem): ItemAction[] => {
        const actions: ItemAction[] = [];
        const def = item.definition;

        // Check if item is crushable (specific items only)
        const itemName = def.name;
        if (itemName === "Animal Bone" || itemName === "Human Skull") {
            actions.push({
                label: 'Crush',
                action: 'crush',
                description: 'Crush into bone fragments',
                buttonStyle: 'crushButton'
            });
        }

        // Check if item is consumable (but not a bandage)
        if (itemName !== "Bandage" && (
            def.category.tag === 'Consumable' || 
            def.consumableHealthGain !== undefined ||
            def.consumableHungerSatiated !== undefined ||
            def.consumableThirstQuenched !== undefined ||
            def.consumableStaminaGain !== undefined)) {
            actions.push({
                label: 'Consume',
                action: 'consume',
                description: 'Use this item',
                buttonStyle: 'consumeButton'
            });
        }

        return actions;
    }, []);

    const handleAction = useCallback(async (action: string) => {
        if (!connection?.reducers || isProcessing) return;

        setIsProcessing(true);
        try {
            const itemInstanceId = BigInt(selectedItem.instance.instanceId);
            
            switch (action) {
                case 'crush':
                    // console.log(`Crushing item ${itemInstanceId}: ${selectedItem.definition.name}`);
                    connection.reducers.crushBoneItem(itemInstanceId);
                    break;
                case 'consume':
                    // console.log(`Consuming item ${itemInstanceId}: ${selectedItem.definition.name}`);
                    connection.reducers.consumeItem(itemInstanceId);
                    break;
                default:
                    console.warn(`Unknown action: ${action}`);
            }
        } catch (error) {
            console.error(`Error performing action ${action}:`, error);
        } finally {
            setIsProcessing(false);
        }
    }, [connection, selectedItem, isProcessing]);

    const handleSplitQuantityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = parseInt(e.target.value, 10);
        if (!isNaN(value) && value >= 1 && value <= currentItemQuantity) {
            // console.log('[Split] Quantity changed to:', value);
            setSplitQuantity(value);
        }
    };

    const handleSplitClick = () => {
        // console.log('[Split] Split button clicked:', {
        //     item: selectedItem.definition.name,
        //     itemId: selectedItem.instance.instanceId,
        //     quantity: splitQuantity,
        //     maxQuantity: currentItemQuantity
        // });
        if (onStartSplitDrag && splitQuantity > 0 && splitQuantity <= currentItemQuantity) {
            onStartSplitDrag(selectedItem, splitQuantity);
        } else {
            console.warn('[Split] Invalid split conditions:', {
                hasCallback: !!onStartSplitDrag,
                quantity: splitQuantity,
                maxQuantity: currentItemQuantity
            });
        }
    };

    const availableActions = getAvailableActions(selectedItem);

    return (
        <div className={styles.itemInteractionPanel}>
            <div className={styles.interactionHeader}>
                <button className={styles.closeInteractionButton} onClick={onClose}>×</button>
            </div>
            
            <div className={styles.interactionContent}>
                <div className={styles.interactionItemIcon}>
                    <img 
                        src={getItemIcon(selectedItem.definition.iconAssetName)}
                        alt={selectedItem.definition.name}
                        className={styles.itemIcon}
                    />
                    {currentItemQuantity > 1 && (
                        <div className={styles.itemQuantity}>{currentItemQuantity}</div>
                    )}
                </div>
                
                <div className={styles.interactionItemDetails}>
                    <h4 className={styles.interactionItemName}>{selectedItem.definition.name}</h4>
                    {selectedItem.definition.description && (
                        <p className={styles.interactionItemDescription}>
                            {selectedItem.definition.description}
                        </p>
                    )}
                    <div className={styles.interactionActions}>
                        {availableActions.map((actionInfo) => (
                            <button
                                key={actionInfo.action}
                                className={`${styles.actionButton} ${styles[actionInfo.buttonStyle || '']}`}
                                onClick={() => handleAction(actionInfo.action)}
                                disabled={isProcessing}
                                title={actionInfo.description}
                            >
                                {isProcessing ? 'Processing...' : actionInfo.label}
                            </button>
                        ))}
                        {selectedItem.definition.isStackable && currentItemQuantity > 1 && (
                            <div className={styles.splitControls}>
                                <input
                                    type="number"
                                    min={1}
                                    max={currentItemQuantity}
                                    value={splitQuantity}
                                    onChange={handleSplitQuantityChange}
                                    className={styles.splitInput}
                                />
                                <button
                                    className={`${styles.actionButton} ${styles.splitButton}`}
                                    onClick={handleSplitClick}
                                    disabled={splitQuantity <= 0 || splitQuantity > currentItemQuantity}
                                >
                                    Split
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ItemInteractionPanel; 