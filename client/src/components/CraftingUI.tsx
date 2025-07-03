import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
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
    ItemCategory,
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
    onItemMouseEnter: (item: PopulatedItem, event: React.MouseEvent<HTMLDivElement>) => void;
    onItemMouseLeave: () => void;
    onItemMouseMove: (event: React.MouseEvent<HTMLDivElement>) => void;
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
    onItemMouseEnter,
    onItemMouseLeave,
    onItemMouseMove,
}) => {
    const [currentTime, setCurrentTime] = useState(Date.now());
    const [craftQuantities, setCraftQuantities] = useState<Map<string, number>>(new Map()); // State for quantity input
    // Initialize searchTerm from localStorage, fallback to empty string
    const [searchTerm, setSearchTerm] = useState<string>(() => {
        return localStorage.getItem('craftingSearchTerm') || '';
    });
    // Initialize selectedCategory from localStorage, fallback to 'All'
    const [selectedCategory, setSelectedCategory] = useState<string>(() => {
        return localStorage.getItem('craftingCategoryFilter') || 'All';
    });
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

    // Tooltip handlers for resource icons - delegate to parent like ExternalContainerUI
    const handleResourceIconMouseEnter = useCallback((resourceName: string, event: React.MouseEvent<HTMLDivElement>) => {
        // Prevent browser tooltip
        event.currentTarget.removeAttribute('title');
        
        // Create minimal item object with just the name for tooltip
        const resourceItem: PopulatedItem = {
            instance: {
                instanceId: BigInt(0),
                itemDefId: BigInt(0),
                quantity: 0,
                location: { tag: 'Inventory', value: null as any },
                durability: null,
                waterContent: null
            } as any,
            definition: {
                id: BigInt(0),
                itemDefId: BigInt(0),
                name: resourceName,
                description: '',
                category: '',
                iconAssetName: '',
                rarity: undefined,
                maxStackSize: 1
            } as any
        };
        
        onItemMouseEnter(resourceItem, event);
    }, [onItemMouseEnter]);

    const handleResourceIconMouseLeave = useCallback(() => {
        onItemMouseLeave();
    }, [onItemMouseLeave]);

    const handleResourceIconMouseMove = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
        onItemMouseMove(event);
    }, [onItemMouseMove]);

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

    // --- Search Handler with localStorage persistence ---
    const handleSearchChange = (newSearchTerm: string) => {
        setSearchTerm(newSearchTerm);
        // Save to localStorage for persistence
        localStorage.setItem('craftingSearchTerm', newSearchTerm);
    };

    // --- Category Filter Handler with localStorage persistence ---
    const handleCategoryChange = (category: string) => {
        setSelectedCategory(category);
        // Save to localStorage for persistence
        localStorage.setItem('craftingCategoryFilter', category);
    };

    // Helper function to check if a recipe matches the selected category
    const matchesCategory = (recipe: Recipe): boolean => {
        if (selectedCategory === 'All') return true;
        
        const outputDef = itemDefinitions.get(recipe.outputItemDefId.toString());
        if (!outputDef) return false;
        
        return outputDef.category.tag === selectedCategory;
    };

    // State for filtered recipes from the search bar
    const [filteredRecipes, setFilteredRecipes] = useState<Array<{
        recipe: Recipe;
        score: number;
    }>>([]);

    // Convert recipes to the format expected by CraftingSearchBar
    const recipeList = useMemo(() => {
        return Array.from(recipes.values()).map(recipe => {
            const outputDef = itemDefinitions.get(recipe.outputItemDefId.toString());
            return {
                id: recipe.recipeId.toString(),
                name: outputDef?.name || 'Unknown',
                category: outputDef?.category || { tag: 'Material' },
                materials: recipe.ingredients.map(ing => {
                    const ingDef = itemDefinitions.get(ing.itemDefId.toString());
                    return {
                        itemId: ingDef?.name || ing.itemDefId.toString(),
                        quantity: ing.quantity
                    };
                }),
                output: {
                    itemId: outputDef?.name || recipe.outputItemDefId.toString(),
                    quantity: recipe.outputQuantity
                }
            };
        });
    }, [recipes, itemDefinitions]);

    // Convert player inventory to the format expected by CraftingSearchBar  
    const inventoryForFiltering = useMemo(() => {
        const inventory: Record<string, number> = {};
        Array.from(itemDefinitions.values()).forEach(itemDef => {
            const quantity = playerInventoryResources.get(itemDef.id.toString()) || 0;
            inventory[itemDef.name] = quantity;
        });
        

        
        return inventory;
    }, [playerInventoryResources, itemDefinitions]);

    // Handle filtered recipes from the search bar
    const handleFilteredRecipesChange = (filteredRecipes: any[]) => {
        const recipesWithScores = filteredRecipes.map(filterResult => {
            const originalRecipe = Array.from(recipes.values()).find(r => r.recipeId.toString() === filterResult.id);
            return {
                recipe: originalRecipe!,
                score: 0 // Score is already calculated in the filter
            };
        }).filter(item => item.recipe); // Remove any undefined recipes
        
        setFilteredRecipes(recipesWithScores);
    };

    // Initialize filtered recipes to empty - let CraftingSearchBar handle ALL filtering
    useEffect(() => {
        // Don't manually initialize - let the CraftingSearchBar algorithm do its work
        if (recipeList.length === 0) {
            setFilteredRecipes([]);
        }
    }, [recipeList]);

    return (
        <div className={styles.rightPane}> {/* Use existing right pane style */}
            {/* CSS to hide webkit number input spinners */}
            <style>{`
                .craft-quantity-input::-webkit-outer-spin-button,
                .craft-quantity-input::-webkit-inner-spin-button {
                    -webkit-appearance: none;
                    margin: 0;
                }
            `}</style>
            {/* Craftable Items Section - Now a List */}
            <div className={styles.craftingHeader}>
                <h3 className={styles.sectionTitle}>CRAFTING</h3>
            </div>
            {/* Add Search Bar with Category Filter */}
            <CraftingSearchBar 
                searchTerm={searchTerm}
                onSearchChange={handleSearchChange}
                selectedCategory={selectedCategory}
                onCategoryChange={handleCategoryChange}
                placeholder="Search by item or ingredient name..."
                onFocus={() => onCraftingSearchFocusChange?.(true)}
                onBlur={() => onCraftingSearchFocusChange?.(false)}
                recipes={recipeList}
                playerInventory={inventoryForFiltering}
                onFilteredRecipesChange={handleFilteredRecipesChange}
            />
            {/* Added scrollable class and data-attribute */}
            <div data-scrollable-region="crafting-items" className={`${styles.craftableItemsSection} ${styles.scrollableSection}`}> 
                {/* Recipe list container */}
                <div className={styles.craftableItemsList}> 
                    {filteredRecipes.map((recipeData) => {
                        const recipe = recipeData.recipe;
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
                            // Two-column layout: Icon | Content (Name, Resources, Buttons)
                            <div key={recipe.recipeId.toString()} className={styles.craftingRecipeRow} style={{ 
                                padding: '12px', 
                                marginBottom: '8px', 
                                backgroundColor: 'rgba(0, 0, 0, 0.3)', 
                                borderRadius: '6px',
                                border: isCraftable ? '1px solid #4a4a4a' : '1px solid #333',
                                display: 'flex',
                                gap: '12px'
                            }}>
                                {/* Left Column: Recipe Icon */}
                                <div style={{ width: '48px', height: '48px', flexShrink: 0 }}>
                                    <img
                                        src={getItemIcon(outputDef.iconAssetName)}
                                        alt={outputDef.name}
                                        style={{ width: '100%', height: '100%', objectFit: 'contain', imageRendering: 'pixelated' }}
                                    />
                                </div>

                                {/* Right Column: Content (3 rows) */}
                                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    
                                    {/* Row 1: Recipe Name */}
                                    <div style={{ 
                                        fontSize: '16px', 
                                        fontWeight: 'bold', 
                                        color: '#fff',
                                        wordBreak: 'break-word',
                                        lineHeight: '1.2',
                                        textAlign: 'left'
                                    }}>
                                        {outputDef.name}
                                    </div>

                                    {/* Row 2: Resources */}
                                    <div style={{ 
                                        display: 'flex', 
                                        flexWrap: 'wrap',
                                        gap: '6px'
                                    }}>
                                        {recipe.ingredients.map((ing, index) => {
                                            const ingDef = itemDefinitions.get(ing.itemDefId.toString());
                                            const available = playerInventoryResources.get(ing.itemDefId.toString()) || 0;
                                            const neededTotal = ing.quantity * currentQuantity;
                                            const hasEnough = available >= neededTotal;
                                            return (
                                                                                                <div key={index} style={{ 
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '4px',
                                                    backgroundColor: 'rgba(0,0,0,0.2)',
                                                    padding: '4px 6px',
                                                    borderRadius: '3px',
                                                    border: `1px solid ${hasEnough ? '#4a4a4a' : '#664444'}`,
                                                    color: hasEnough ? '#90EE90' : '#FFB6C1',
                                                    cursor: 'pointer',
                                                    transition: 'transform 0.1s ease-out',
                                                    transform: 'scale(1)'
                                                }}
                                                onMouseEnter={(e) => {
                                                    e.currentTarget.style.transform = 'scale(1.05)';
                                                    handleResourceIconMouseEnter(ingDef?.name || 'Unknown Resource', e);
                                                }}
                                                onMouseLeave={(e) => {
                                                    e.currentTarget.style.transform = 'scale(1)';
                                                    handleResourceIconMouseLeave();
                                                }}
                                                onMouseMove={handleResourceIconMouseMove}
                                                >
                                                    <div 
                                                        style={{ 
                                                            width: '16px', 
                                                            height: '16px', 
                                                            flexShrink: 0
                                                        }}
                                                    >
                                                        <img
                                                            src={getItemIcon(ingDef?.iconAssetName || '')}
                                                            alt={ingDef?.name || 'Unknown'}
                                                            style={{ 
                                                                width: '100%', 
                                                                height: '100%', 
                                                                objectFit: 'contain', 
                                                                imageRendering: 'pixelated'
                                                            }}
                                                        />
                                                    </div>
                                                    <span style={{ fontSize: '13px', fontWeight: 'bold' }}>
                                                        {ing.quantity}
                                                    </span>
                                                    <span style={{ fontSize: '11px', color: '#ccc' }}>
                                                        ({available})
                                                    </span>
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {/* Row 3: Actions (Quantity + Craft Button) */}
                                    <div style={{ 
                                        display: 'flex', 
                                        alignItems: 'center', 
                                        justifyContent: 'space-between',
                                        gap: '8px'
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                                            {/* Decrease Button */}
                                            <button 
                                                onClick={() => {
                                                    const newQuantity = Math.max(1, currentQuantity - 1);
                                                    setCraftQuantities(prev => new Map(prev).set(recipe.recipeId.toString(), newQuantity));
                                                }}
                                                disabled={currentQuantity <= 1}
                                                style={{
                                                    width: '24px',
                                                    height: '24px',
                                                    padding: '0',
                                                    fontSize: '14px',
                                                    fontWeight: 'bold',
                                                    backgroundColor: currentQuantity > 1 ? '#444' : '#222',
                                                    color: currentQuantity > 1 ? '#fff' : '#666',
                                                    border: '1px solid #555',
                                                    borderRadius: '3px 0 0 3px',
                                                    cursor: currentQuantity > 1 ? 'pointer' : 'not-allowed',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center'
                                                }}
                                            >
                                                −
                                            </button>
                                            
                                            {/* Quantity Input */}
                                            <input 
                                                type="number" 
                                                value={currentQuantity}
                                                onChange={handleQuantityChange}
                                                className="craft-quantity-input"
                                                style={{
                                                    width: '40px',
                                                    height: '24px',
                                                    padding: '0',
                                                    fontSize: '13px',
                                                    textAlign: 'center',
                                                    backgroundColor: 'rgba(255, 255, 255, 0.1)',
                                                    border: '1px solid #555',
                                                    borderLeft: 'none',
                                                    borderRight: 'none',
                                                    color: '#fff',
                                                    outline: 'none',
                                                    // Hide default number input spinners
                                                    MozAppearance: 'textfield'
                                                }}
                                                min="1"
                                                max={maxCraftableForThisRecipe > 0 ? maxCraftableForThisRecipe : 1}
                                                onKeyDown={(e) => {
                                                    // Block + and - keys since we have custom buttons
                                                    if (e.key === '+' || e.key === '-') {
                                                        e.preventDefault();
                                                    }
                                                }}
                                            />
                                            
                                            {/* Increase Button */}
                                            <button 
                                                onClick={() => {
                                                    const newQuantity = Math.min(maxCraftableForThisRecipe > 0 ? maxCraftableForThisRecipe : 1, currentQuantity + 1);
                                                    setCraftQuantities(prev => new Map(prev).set(recipe.recipeId.toString(), newQuantity));
                                                }}
                                                disabled={currentQuantity >= (maxCraftableForThisRecipe > 0 ? maxCraftableForThisRecipe : 1)}
                                                style={{
                                                    width: '24px',
                                                    height: '24px',
                                                    padding: '0',
                                                    fontSize: '14px',
                                                    fontWeight: 'bold',
                                                    backgroundColor: currentQuantity < (maxCraftableForThisRecipe > 0 ? maxCraftableForThisRecipe : 1) ? '#444' : '#222',
                                                    color: currentQuantity < (maxCraftableForThisRecipe > 0 ? maxCraftableForThisRecipe : 1) ? '#fff' : '#666',
                                                    border: '1px solid #555',
                                                    borderRadius: '0 3px 3px 0',
                                                    cursor: currentQuantity < (maxCraftableForThisRecipe > 0 ? maxCraftableForThisRecipe : 1) ? 'pointer' : 'not-allowed',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center'
                                                }}
                                            >
                                                +
                                            </button>
                                            
                                            {/* MAX Button */}
                                            <button 
                                                onClick={handleMaxClick}
                                                disabled={maxCraftableForThisRecipe <= 0}
                                                style={{
                                                    padding: '4px 6px',
                                                    fontSize: '10px',
                                                    backgroundColor: maxCraftableForThisRecipe > 0 ? '#444' : '#222',
                                                    color: maxCraftableForThisRecipe > 0 ? '#fff' : '#666',
                                                    border: '1px solid #555',
                                                    borderRadius: '3px',
                                                    cursor: maxCraftableForThisRecipe > 0 ? 'pointer' : 'not-allowed',
                                                    marginLeft: '4px'
                                                }}
                                            >
                                                MAX
                                            </button>
                                        </div>
                                        
                                        <button
                                            onClick={() => handleCraftItem(recipe.recipeId, currentQuantity)}
                                            disabled={!isCraftable}
                                            style={{
                                                padding: '8px 16px',
                                                fontSize: '13px',
                                                fontWeight: 'bold',
                                                backgroundColor: isCraftable ? '#4CAF50' : '#333',
                                                color: isCraftable ? '#fff' : '#666',
                                                border: isCraftable ? '1px solid #5CBF60' : '1px solid #444',
                                                borderRadius: '4px',
                                                cursor: isCraftable ? 'pointer' : 'not-allowed',
                                                minWidth: '70px',
                                                textTransform: 'uppercase',
                                                letterSpacing: '0.5px'
                                            }}
                                        >
                                            CRAFT
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Crafting Queue Section (Moved down, potentially needs own scroll later) */}
            <div className={styles.craftingQueueSection}>
                <h4 style={{ fontSize: '16px', fontWeight: 'bold', color: '#fff', margin: '16px 0 12px 0' }}>
                    CRAFTING QUEUE ({playerQueue.length})
                </h4>
                 {/* Added scrollable class and data-attribute */}
                <div data-scrollable-region="crafting-queue" className={`${styles.craftingQueueList} ${styles.scrollableSection}`}> 
                    {playerQueue.map((item) => {
                        const outputDef = itemDefinitions.get(item.outputItemDefId.toString());
                        const remainingTime = calculateRemainingTime(Number(item.finishTime.microsSinceUnixEpoch / 1000n), currentTime);

                        return (
                            <div key={item.queueItemId.toString()} style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '12px',
                                padding: '12px',
                                backgroundColor: 'rgba(0, 0, 0, 0.2)',
                                borderRadius: '4px',
                                marginBottom: '8px',
                                border: '1px solid #333'
                            }}>
                                <div style={{ width: '40px', height: '40px', flexShrink: 0 }}>
                                    {outputDef && (
                                        <img
                                            src={getItemIcon(outputDef.iconAssetName)}
                                            alt={outputDef?.name || 'Crafting'}
                                            style={{ width: '100%', height: '100%', objectFit: 'contain', imageRendering: 'pixelated' }}
                                        />
                                                    )}
                                  </div>
                                  <div style={{ flex: 1 }}>
                                    <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#fff' }}>
                                        {outputDef?.name || 'Unknown Item'}
                                    </div>
                                    <div style={{ fontSize: '14px', color: '#ccc' }}>
                                        {remainingTime > 0 ? `${remainingTime}s remaining` : 'Completing...'}
                                    </div>
                                </div>
                                <button
                                    onClick={() => handleCancelCraft(item.queueItemId)}
                                    style={{
                                        padding: '8px 16px',
                                        fontSize: '14px',
                                        backgroundColor: '#d32f2f',
                                        color: '#fff',
                                        border: '1px solid #f44336',
                                        borderRadius: '4px',
                                        cursor: 'pointer'
                                    }}
                                    title="Cancel Craft"
                                >
                                    CANCEL
                                </button>
                            </div>
                        );
                    })}
                    {playerQueue.length === 0 && 
                        <div style={{ 
                            fontSize: '14px', 
                            color: '#888', 
                            textAlign: 'center', 
                            padding: '20px' 
                        }}>
                            No items in queue
                        </div>
                    }
                </div>
                {/* Add Cancel All Button Here */}
                {playerQueue.length > 0 && (
                    <button 
                        onClick={handleCancelAllCrafting}
                        style={{
                            width: '100%',
                            padding: '12px',
                            fontSize: '14px',
                            fontWeight: 'bold',
                            backgroundColor: '#d32f2f',
                            color: '#fff',
                            border: '1px solid #f44336',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            marginTop: '8px'
                        }}
                        title="Cancel all items in queue and refund resources"
                    >
                        CANCEL ALL QUEUE
                    </button>
                )}
            </div>

        </div>
    );
};

export default CraftingUI; 