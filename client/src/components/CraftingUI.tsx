import React, { useState, useEffect, useMemo, useRef } from 'react';
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
import CraftingSearchBar from './CraftingSearchBar'; // Import the new component

interface CraftingUIProps {
    playerIdentity: Identity | null;
    recipes: Map<string, Recipe>;
    craftingQueueItems: Map<string, CraftingQueueItem>;
    itemDefinitions: Map<string, ItemDefinition>;
    inventoryItems: Map<string, InventoryItem>; // Needed to check resource availability
    connection: DbConnection | null;
    onCraftingSearchFocusChange?: (isFocused: boolean) => void;
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
    onCraftingSearchFocusChange,
}) => {
    const [currentTime, setCurrentTime] = useState(Date.now());
    const [craftQuantities, setCraftQuantities] = useState<Map<string, number>>(new Map()); // State for quantity input
    const [searchTerm, setSearchTerm] = useState(''); // State for the search term
    const [craftedRecipeIdsThisSession, setCraftedRecipeIdsThisSession] = useState<Set<string>>(new Set()); // New state

    // Timer to update queue times
    useEffect(() => {
        const timerId = setInterval(() => {
            setCurrentTime(Date.now());
        }, 1000); // Update every second
        return () => clearInterval(timerId);
    }, []);

    // Defensive cleanup to ensure game controls are restored on unmount
    useEffect(() => {
        return () => {
            // Always restore game controls when component unmounts
            onCraftingSearchFocusChange?.(false);
        };
    }, [onCraftingSearchFocusChange]);

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
    const handleCraftItem = (recipeId: bigint, quantity: number) => {
        if (!connection?.reducers) return;
        // console.log(`Attempting to craft recipe ID: ${recipeId}, quantity: ${quantity}`);
        try {
            if (quantity > 0) { // Ensure quantity is positive
                // Call the new reducer
                connection.reducers.startCraftingMultiple(recipeId, quantity);
                // Optimistically add to crafted this session
                setCraftedRecipeIdsThisSession(prev => new Set(prev).add(recipeId.toString()));
            } else {
                console.warn("Attempted to craft with quantity 0 or less.");
            }
        } catch (err) {
            console.error("Error calling startCraftingMultiple reducer:", err);
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

    const handleCancelAllCrafting = () => {
        if (!connection?.reducers) return;
        // console.log("Attempting to cancel all crafting items.");
        try {
            connection.reducers.cancelAllCrafting();
        } catch (err) {
            console.error("Error calling cancelAllCrafting reducer:", err);
            // TODO: Show user-friendly error feedback
        }
    };

    // --- Helper to calculate max craftable quantity ---
    const calculateMaxCraftable = (recipe: Recipe): number => {
        if (!recipe.ingredients || recipe.ingredients.length === 0) return 0; // Cannot craft if no ingredients

        let maxPossible = Infinity;
        for (const ingredient of recipe.ingredients) {
            const available = playerInventoryResources.get(ingredient.itemDefId.toString()) || 0;
            if (ingredient.quantity === 0) continue; // Should not happen, but avoid division by zero
            maxPossible = Math.min(maxPossible, Math.floor(available / ingredient.quantity));
        }
        return maxPossible === Infinity ? 0 : maxPossible; // If loop didn't run (e.g. no ingredients with quantity > 0), return 0
    };

    // --- Helper to check craftability ---
    const canCraft = (recipe: Recipe, quantity: number = 1): boolean => {
        for (const ingredient of recipe.ingredients) {
            const available = playerInventoryResources.get(ingredient.itemDefId.toString()) || 0;
            if (available < ingredient.quantity * quantity) { // Check against total needed
                return false;
            }
        }
        return recipe.ingredients.length > 0; // Also ensure there are ingredients
    };

    // --- Search Handler ---
    const handleSearchChange = (newSearchTerm: string) => {
        setSearchTerm(newSearchTerm);
    };

    // Filter recipes based on search term
    const filteredRecipes = useMemo(() => {
        if (!searchTerm.trim()) {
            // If no search term, sort all recipes
            return Array.from(recipes.values()).sort((a, b) => {
                const canCraftA = canCraft(a);
                const canCraftB = canCraft(b);
                const notCraftedThisSessionA = !craftedRecipeIdsThisSession.has(a.recipeId.toString());
                const notCraftedThisSessionB = !craftedRecipeIdsThisSession.has(b.recipeId.toString());

                // Priority 1: Craftable items
                if (canCraftA && !canCraftB) return -1;
                if (!canCraftA && canCraftB) return 1;

                if (canCraftA && canCraftB) {
                    // Priority 2: Within craftable, "new" (not crafted this session) items first
                    if (notCraftedThisSessionA && !notCraftedThisSessionB) return -1;
                    if (!notCraftedThisSessionA && notCraftedThisSessionB) return 1;
                }

                // Fallback: Alphabetical by output item name
                const outputDefA = itemDefinitions.get(a.outputItemDefId.toString());
                const outputDefB = itemDefinitions.get(b.outputItemDefId.toString());
                const nameA = outputDefA?.name.toLowerCase() || '';
                const nameB = outputDefB?.name.toLowerCase() || '';
                return nameA.localeCompare(nameB);
            });
        }
        const lowerSearchTerm = searchTerm.toLowerCase();
        return Array.from(recipes.values()).filter(recipe => {
            const outputDef = itemDefinitions.get(recipe.outputItemDefId.toString());
            if (outputDef && outputDef.name.toLowerCase().includes(lowerSearchTerm)) {
                return true;
            }
            for (const ingredient of recipe.ingredients) {
                const ingDef = itemDefinitions.get(ingredient.itemDefId.toString());
                if (ingDef && ingDef.name.toLowerCase().includes(lowerSearchTerm)) {
                    return true;
                }
            }
            // TODO: Add search by description if item definitions get a description field
            return false;
        }).sort((a, b) => {
            const canCraftA = canCraft(a);
            const canCraftB = canCraft(b);
            const notCraftedThisSessionA = !craftedRecipeIdsThisSession.has(a.recipeId.toString());
            const notCraftedThisSessionB = !craftedRecipeIdsThisSession.has(b.recipeId.toString());

            // Priority 1: Craftable items
            if (canCraftA && !canCraftB) return -1;
            if (!canCraftA && canCraftB) return 1;

            if (canCraftA && canCraftB) {
                // Priority 2: Within craftable, "new" (not crafted this session) items first
                if (notCraftedThisSessionA && !notCraftedThisSessionB) return -1;
                if (!notCraftedThisSessionA && notCraftedThisSessionB) return 1;
            }

            // Fallback: Alphabetical by output item name
            const outputDefA = itemDefinitions.get(a.outputItemDefId.toString());
            const outputDefB = itemDefinitions.get(b.outputItemDefId.toString());
            const nameA = outputDefA?.name.toLowerCase() || '';
            const nameB = outputDefB?.name.toLowerCase() || '';
            return nameA.localeCompare(nameB);
        });
    }, [recipes, itemDefinitions, searchTerm, playerInventoryResources, craftedRecipeIdsThisSession]);

    return (
        <div className={styles.rightPane}> {/* Use existing right pane style */}
            {/* Craftable Items Section - Now a List */}
            <div className={styles.craftingHeader}>
                <h3 className={styles.sectionTitle}>CRAFTING</h3>
            </div>
            {/* Add Search Bar */}
            <CraftingSearchBar 
                searchTerm={searchTerm}
                onSearchChange={handleSearchChange}
                placeholder="Search by item or ingredient name..."
                onFocus={() => onCraftingSearchFocusChange?.(true)}
                onBlur={() => onCraftingSearchFocusChange?.(false)}
            />
            {/* Added scrollable class and data-attribute */}
            <div data-scrollable-region="crafting-items" className={`${styles.craftableItemsSection} ${styles.scrollableSection}`}> 
                {/* Changed grid to list */}
                <div className={styles.craftableItemsList}> 
                    {filteredRecipes.map((recipe) => {
                        const outputDef = itemDefinitions.get(recipe.outputItemDefId.toString());
                        if (!outputDef) return null;

                        const currentQuantity = craftQuantities.get(recipe.recipeId.toString()) || 1;
                        const maxCraftableForThisRecipe = calculateMaxCraftable(recipe);
                        const isCraftable = canCraft(recipe, currentQuantity) && currentQuantity <= maxCraftableForThisRecipe && currentQuantity > 0;

                        const handleQuantityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
                            let newQuantity = parseInt(e.target.value, 10);
                            if (isNaN(newQuantity) || newQuantity < 1) {
                                newQuantity = 1; // Default to 1 if invalid or less than 1
                            }
                            const clampedQuantity = Math.min(newQuantity, maxCraftableForThisRecipe > 0 ? maxCraftableForThisRecipe : 1);
                            setCraftQuantities(prev => new Map(prev).set(recipe.recipeId.toString(), clampedQuantity));
                        };

                        const handleMaxClick = () => {
                            const maxVal = calculateMaxCraftable(recipe);
                            setCraftQuantities(prev => new Map(prev).set(recipe.recipeId.toString(), maxVal > 0 ? maxVal : 1));
                        };
                        
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
                                            const neededTotal = ing.quantity * currentQuantity;
                                            const color = available >= neededTotal ? '#aaffaa' : '#ffaaaa';
                                            return (
                                                <span key={index} style={{ color: color, display: 'block' }}>
                                                    {ing.quantity} x {ingDef?.name || 'Unknown'} ({available})
                                                </span>
                                            );
                                        })}
                                    </div>
                                    <div className={styles.recipeTime}>Time: {recipe.craftingTimeSecs}s</div>
                                </div>
                                {/* New Input, Max Button, and Craft Button Area */}
                                <div className={styles.craftingControls}>
                                    <input 
                                        type="number" 
                                        value={currentQuantity}
                                        onChange={handleQuantityChange}
                                        className={styles.quantityInput}
                                        min="1"
                                        max={maxCraftableForThisRecipe > 0 ? maxCraftableForThisRecipe : 1} // Set HTML max attribute
                                    />
                                    <button 
                                        onClick={handleMaxClick}
                                        className={styles.maxButton}
                                    >
                                        Max
                                    </button>
                                    <button
                                        onClick={() => handleCraftItem(recipe.recipeId, currentQuantity)}
                                        disabled={!isCraftable}
                                        className={styles.craftButton}
                                    >
                                        Craft
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Crafting Queue Section (Moved down, potentially needs own scroll later) */}
            <div className={styles.craftingQueueSection}>
                <h4 className={styles.queueTitle}>CRAFTING QUEUE ({playerQueue.length})</h4>
                 {/* Added scrollable class and data-attribute */}
                <div data-scrollable-region="crafting-queue" className={`${styles.craftingQueueList} ${styles.scrollableSection}`}> 
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
                {/* Add Cancel All Button Here */}
                {playerQueue.length > 0 && (
                    <button 
                        onClick={handleCancelAllCrafting}
                        className={styles.cancelAllButton} // Will need a new style
                        title="Cancel all items in queue and refund resources"
                    >
                        Cancel All Queue
                    </button>
                )}
            </div>
        </div>
    );
};

export default CraftingUI; 