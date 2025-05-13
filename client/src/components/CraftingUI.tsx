import React, { useState, useEffect, useMemo } from 'react';
import styles from './InventoryUI.module.css'; // Reuse styles for consistency
import {
    Recipe,
    RecipeIngredient,
    CraftingQueueItem,
    ItemDefinition,
    InventoryItem,
    DbConnection,
    InventoryLocationData,
    HotbarLocationData,
} from '../generated';
import { Identity } from '@clockworklabs/spacetimedb-sdk';
import { PopulatedItem } from './InventoryUI'; // Reuse PopulatedItem type
import { getItemIcon } from '../utils/itemIconUtils';

interface CraftingUIProps {
    playerIdentity: Identity | null;
    recipes: Map<string, Recipe>;
    craftingQueueItems: Map<string, CraftingQueueItem>;
    itemDefinitions: Map<string, ItemDefinition>;
    inventoryItems: Map<string, InventoryItem>; // Needed to check resource availability
    connection: DbConnection | null;
}

// Helper to calculate remaining time
const calculateRemainingTime = (finishTime: number, now: number): number => {
    return Math.max(0, Math.ceil((finishTime - now) / 1000));
};

const CraftingUI: React.FC<CraftingUIProps> = ({
    playerIdentity,
    recipes,
    craftingQueueItems,
    itemDefinitions,
    inventoryItems,
    connection,
}) => {
    const [currentTime, setCurrentTime] = useState(Date.now());

    // Timer to update queue times
    useEffect(() => {
        const timerId = setInterval(() => {
            setCurrentTime(Date.now());
        }, 1000); // Update every second
        return () => clearInterval(timerId);
    }, []);

    // Memoize player inventory calculation
    const playerInventoryResources = useMemo(() => {
        const resources: Map<string, number> = new Map();
        if (!playerIdentity) return resources;

        // console.log('[CraftingUI DEBUG] Recalculating resources. inventoryItems prop:', new Map(inventoryItems)); // Log a clone

        Array.from(inventoryItems.values())
            .filter(item => {
                if (item.location.tag === 'Inventory') {
                    const inventoryData = item.location.value as InventoryLocationData;
                    return inventoryData.ownerId.isEqual(playerIdentity);
                } else if (item.location.tag === 'Hotbar') {
                    const hotbarData = item.location.value as HotbarLocationData;
                    return hotbarData.ownerId.isEqual(playerIdentity);
                }
                return false; // Not in player's inventory or hotbar
            })
            .forEach(item => {
                const defIdStr = item.itemDefId.toString();
                // console.log(`[CraftingUI DEBUG Sum] Adding ${item.quantity} of Def ${defIdStr} (Instance ${item.instanceId}) from slot Inv=${item.inventorySlot}/Hotbar=${item.hotbarSlot}`);
                resources.set(defIdStr, (resources.get(defIdStr) || 0) + item.quantity);
            });
            
        // console.log('[CraftingUI DEBUG] Calculated playerInventoryResources:', resources);
            
        return resources;
    }, [inventoryItems, playerIdentity]);

    // Filter and sort crafting queue for the current player
    const playerQueue = useMemo(() => {
        if (!playerIdentity) return [];
        return Array.from(craftingQueueItems.values())
            .filter(item => item.playerIdentity.isEqual(playerIdentity))
            .sort((a, b) => Number(a.finishTime.microsSinceUnixEpoch - b.finishTime.microsSinceUnixEpoch)); // Sort by finish time ASC
    }, [craftingQueueItems, playerIdentity]);

    // --- Crafting Handlers ---
    const handleCraftItem = (recipeId: bigint) => {
        if (!connection?.reducers) return;
        // console.log(`Attempting to craft recipe ID: ${recipeId}`);
        try {
            connection.reducers.startCrafting(recipeId);
        } catch (err) {
            console.error("Error calling startCrafting reducer:", err);
            // TODO: Show user-friendly error feedback
        }
    };

    const handleCancelCraft = (queueItemId: bigint) => {
        if (!connection?.reducers) return;
        // console.log(`Attempting to cancel craft queue item ID: ${queueItemId}`);
        try {
            connection.reducers.cancelCraftingItem(queueItemId);
        } catch (err) {
            console.error("Error calling cancelCraftingItem reducer:", err);
            // TODO: Show user-friendly error feedback
        }
    };

    // --- Helper to check craftability ---
    const canCraft = (recipe: Recipe): boolean => {
        for (const ingredient of recipe.ingredients) {
            const available = playerInventoryResources.get(ingredient.itemDefId.toString()) || 0;
            if (available < ingredient.quantity) {
                return false;
            }
        }
        return true;
    };

    return (
        <div className={styles.rightPane}> {/* Use existing right pane style */}
            {/* Craftable Items Section - Now a List */}
            <div className={styles.craftingHeader}>
                <h3 className={styles.sectionTitle}>CRAFTING</h3>
            </div>
            {/* Added scrollable class */}
            <div className={`${styles.craftableItemsSection} ${styles.scrollableSection}`}> 
                {/* Changed grid to list */}
                <div className={styles.craftableItemsList}> 
                    {Array.from(recipes.values()).map((recipe) => {
                        const outputDef = itemDefinitions.get(recipe.outputItemDefId.toString());
                        if (!outputDef) return null;

                        const isCraftable = canCraft(recipe);
                        
                        return (
                            // New recipe row structure
                            <div key={recipe.recipeId.toString()} className={styles.craftingRecipeRow}>
                                <div className={styles.recipeOutputIcon}>
                                    <img
                                        src={getItemIcon(outputDef.iconAssetName)}
                                        alt={outputDef.name}
                                        style={{ width: '100%', height: '100%', objectFit: 'contain', imageRendering: 'pixelated' }}
                                    />
                                </div>
                                <div className={styles.recipeDetails}>
                                    <div className={styles.recipeName}>{outputDef.name}</div>
                                    <div className={styles.recipeIngredients}>
                                        {recipe.ingredients.map((ing, index) => {
                                            const ingDef = itemDefinitions.get(ing.itemDefId.toString());
                                            const available = playerInventoryResources.get(ing.itemDefId.toString()) || 0;
                                            const color = available >= ing.quantity ? '#aaffaa' : '#ffaaaa'; // Light Green / Light Red (was yellow)
                                            return (
                                                <span key={index} style={{ color: color, display: 'block' }}>
                                                    {ing.quantity} x {ingDef?.name || 'Unknown'} ({available})
                                                </span>
                                            );
                                        })}
                                    </div>
                                    <div className={styles.recipeTime}>Time: {recipe.craftingTimeSecs}s</div>
                                </div>
                                <button
                                    onClick={() => handleCraftItem(recipe.recipeId)}
                                    disabled={!isCraftable}
                                    className={styles.craftButton} // New style for craft button
                                >
                                    Craft
                                </button>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Crafting Queue Section (Moved down, potentially needs own scroll later) */}
            <div className={styles.craftingQueueSection}>
                <h4 className={styles.queueTitle}>CRAFTING QUEUE ({playerQueue.length})</h4>
                 {/* Added scrollable class */}
                <div className={`${styles.craftingQueueList} ${styles.scrollableSection}`}> 
                    {playerQueue.map((item) => {
                        const outputDef = itemDefinitions.get(item.outputItemDefId.toString());
                        const remainingTime = calculateRemainingTime(Number(item.finishTime.microsSinceUnixEpoch / 1000n), currentTime);

                        return (
                            <div key={item.queueItemId.toString()} className={styles.queueItem}>
                                <div className={`${styles.slot} ${styles.queueItemSlot}`}>
                                    {outputDef && (
                                        <img
                                            src={getItemIcon(outputDef.iconAssetName)}
                                            alt={outputDef?.name || 'Crafting'}
                                            style={{ width: '80%', height: '80%', objectFit: 'contain', imageRendering: 'pixelated' }}
                                        />
                                    )}
                                </div>
                                <span className={styles.queueItemName}>{outputDef?.name || 'Unknown Item'} ({remainingTime}s)</span>
                                <button
                                    onClick={() => handleCancelCraft(item.queueItemId)}
                                    className={styles.cancelButton}
                                    title="Cancel Craft"
                                >
                                    X
                                </button>
                            </div>
                        );
                    })}
                    {playerQueue.length === 0 && <p className={styles.emptyQueueText}>Queue is empty</p>}
                </div>
            </div>
        </div>
    );
};

export default CraftingUI; 