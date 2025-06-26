import React, { useRef, useState } from 'react';
import styles from './InventoryUI.module.css'; // Reuse existing styles if applicable, or create new ones
import { ItemCategory } from '../generated';

// Category mappings with pretty names
const CATEGORY_LABELS: Record<string, string> = {
  'All': 'All Items',
  'Tool': 'Tools',
  'Material': 'Materials',
  'Placeable': 'Placeables',
  'Armor': 'Armor',
  'Consumable': 'Consumables',
  'Ammunition': 'Ammunition',
  'Weapon': 'Melee Weapons',
  'RangedWeapon': 'Ranged Weapons',
};

// Category multipliers for different situations
const CATEGORY_MULTIPLIERS: Record<string, number> = {
  'Tool': 1.5,
  'Weapon': 1.4,
  'Armor': 1.2,
  'Consumable': 1.1,
  'Material': 0.8,
  'Placeable': 0.9,
  'Ammunition': 1.0,
};

interface Recipe {
  id: string;
  name: string;
  category: ItemCategory;
  materials: { itemId: string; quantity: number }[];
  output: { itemId: string; quantity: number };
}

interface PlayerInventory {
  [itemId: string]: number; // itemId -> quantity
}

// Advanced prediction scoring system
export const calculateRecipePredictionScore = (
  recipe: Recipe,
  playerInventory: PlayerInventory,
  playerHotbar: PlayerInventory = {}
): number => {
  // Category multiplier (base score)
  const categoryMultiplier = CATEGORY_MULTIPLIERS[recipe.category.tag] || 1.0;
  

  
  // Craftability score (0-1): how much of the materials we have
  const craftabilityScore = recipe.materials.reduce((score, material) => {
    const available = playerInventory[material.itemId] || 0;
    const needed = material.quantity;
    const materialRatio = Math.min(available / needed, 1.0);
    return score * materialRatio;
  }, 1.0);
  
  // Need multiplier: boost if we don't have this item
  const inventoryQuantity = playerInventory[recipe.output.itemId] || 0;
  const hotbarQuantity = playerHotbar[recipe.output.itemId] || 0;
  const totalOwned = inventoryQuantity + hotbarQuantity;
  
  // Exponential decay for items we already have
  const needMultiplier = Math.exp(-totalOwned * 0.5) + 0.1; // Never goes to 0
  
  // High-value item boost: expensive items get priority when perfectly craftable
  const totalMaterialCost = recipe.materials.reduce((sum, material) => sum + material.quantity, 0);
  const expensiveItemMultiplier = craftabilityScore === 1.0 ? 
    Math.min(1 + (totalMaterialCost / 500), 4.0) : // More aggressive scaling, cap at 4x
    1.0;
  
  // Tools and weapons: higher boost when we have 0, but reduced if item is very expensive
  const isToolOrWeapon = recipe.category.tag === 'Tool' || recipe.category.tag === 'Weapon';
  const toolBoost = isToolOrWeapon && totalOwned === 0 ? 
    Math.max(1.5, 3.0 - (expensiveItemMultiplier - 1.0)) : // Reduce tool boost for expensive items
    1.0;
  
  // Perfect craft bonus: much bigger boost for expensive items you can craft exactly
  const perfectCraftBonus = craftabilityScore === 1.0 ? 
    Math.min(10.0 + (totalMaterialCost / 100), 50.0) : // Much bigger bonus, scale with cost
    0;
  
  // Rare materials multiplier: huge boost for items requiring uncommon materials
  const rareMaterialsMultiplier = recipe.materials.reduce((multiplier, material) => {
    const available = playerInventory[material.itemId] || 0;
    const needed = material.quantity;
    
    // Only consider if we can actually craft it
    if (available < needed) return multiplier;
    
    // Calculate rarity based on how much we have relative to what we need
    // If we have exactly what we need, it's rare. If we have tons extra, it's common.
    const ratio = available / needed;
    const rarityBonus = ratio <= 2.0 ? 3.0 :  // Very rare: we have ≤2x what we need
                       ratio <= 5.0 ? 2.0 :  // Somewhat rare: we have ≤5x what we need  
                       ratio <= 10.0 ? 1.5 : // Common: we have ≤10x what we need
                       1.0;               // Very common: we have >10x what we need
    
    return Math.max(multiplier, rarityBonus); // Take the highest rarity bonus from any material
  }, 1.0);
  
  // Material availability bonus: small bonus for excess, but prioritize exact matches
  const materialExcessBonus = recipe.materials.reduce((bonus, material) => {
    const available = playerInventory[material.itemId] || 0;
    const needed = material.quantity;
    const excess = Math.max(0, available - needed);
    // Much smaller bonus for excess, and cap it to prevent overwhelming other factors
    return bonus + Math.min(excess * 0.001, 2.0); // Capped at 2 points max
  }, 0);
  
  // Combine all factors
  const finalScore = (
    categoryMultiplier * 
    (craftabilityScore ** 1.2) * // Slightly less emphasis on partial craftability
    needMultiplier * 
    toolBoost *
    expensiveItemMultiplier *
    rareMaterialsMultiplier       // HUGE boost for rare materials
  ) + perfectCraftBonus + materialExcessBonus;
  

  
  return finalScore;
};

// Sort recipes by prediction score
export const sortRecipesByPrediction = (
  recipes: Recipe[],
  playerInventory: PlayerInventory,
  playerHotbar?: PlayerInventory
): Recipe[] => {
  return recipes
    .map(recipe => ({
      recipe,
      score: calculateRecipePredictionScore(recipe, playerInventory, playerHotbar)
    }))
    .sort((a, b) => b.score - a.score)
    .map(item => item.recipe);
};

// Filter recipes with smart prediction scoring
export const filterAndSortRecipes = (
  recipes: Recipe[],
  searchTerm: string,
  selectedCategory: string,
  playerInventory: PlayerInventory,
  playerHotbar?: PlayerInventory
): Recipe[] => {
  let filtered = recipes;
  
  // Category filter
  if (selectedCategory !== 'All') {
    filtered = filtered.filter(recipe => recipe.category.tag === selectedCategory);
  }
  
  // Search term filter
  if (searchTerm.trim()) {
    const term = searchTerm.toLowerCase();
    filtered = filtered.filter(recipe => 
      recipe.name.toLowerCase().includes(term) ||
      recipe.materials.some(mat => mat.itemId.toLowerCase().includes(term))
    );
  }
  
  // Apply prediction sorting
  return sortRecipesByPrediction(filtered, playerInventory, playerHotbar);
};

interface CraftingSearchBarProps {
  searchTerm: string;
  onSearchChange: (newSearchTerm: string) => void;
  placeholder?: string;
  onFocus?: () => void;
  onBlur?: () => void;
  // New props for category filtering
  selectedCategory?: string;
  onCategoryChange?: (category: string) => void;
  // New props for prediction
  recipes?: Recipe[];
  playerInventory?: PlayerInventory;
  playerHotbar?: PlayerInventory;
  onFilteredRecipesChange?: (filteredRecipes: Recipe[]) => void;
}

const CraftingSearchBar: React.FC<CraftingSearchBarProps> = (props) => {
  const {
    searchTerm,
    onSearchChange,
    placeholder = "Search recipes by name, ingredients...",
    onFocus,
    onBlur,
    selectedCategory = 'All',
    onCategoryChange,
    recipes = [],
    playerInventory = {},
    playerHotbar = {},
    onFilteredRecipesChange,
  } = props;

  const inputRef = useRef<HTMLInputElement>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

    // Apply filtering and sorting whenever inputs change
  React.useEffect(() => {
    if (recipes.length > 0 && Object.keys(playerInventory).length > 0) {
      const filteredAndSorted = filterAndSortRecipes(
        recipes, 
        searchTerm, 
        selectedCategory, 
        playerInventory, 
        playerHotbar
      );
      onFilteredRecipesChange?.(filteredAndSorted);
    }
  }, [recipes, searchTerm, selectedCategory, playerInventory, playerHotbar]); // Removed onFilteredRecipesChange from deps

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    // Prevent ALL game control keys from bubbling up to the game
    const gameControlKeys = ['f', 'g', ' ', 'e', 'w', 'a', 's', 'd', 'z', 'c', 'm'];
    const key = event.key.toLowerCase();
    
    if (gameControlKeys.includes(key)) {
      // Prevent game actions but allow typing in the input
      event.stopPropagation();
    }
    
    // Handle Escape key to blur the input and ensure game controls are restored
    if (event.key === 'Escape') {
      event.preventDefault();
      inputRef.current?.blur();
      setIsDropdownOpen(false);
    }
  };

  const handleFilterClick = () => {
    setIsDropdownOpen(!isDropdownOpen);
  };

  const handleCategorySelect = (category: string) => {
    onCategoryChange?.(category);
    setIsDropdownOpen(false);
  };

  // Close dropdown when clicking outside
  const handleDropdownBlur = (event: React.FocusEvent) => {
    // Check if the new focus target is inside the dropdown
    if (!event.currentTarget.contains(event.relatedTarget as Node)) {
      setIsDropdownOpen(false);
    }
  };

  return (
    <div className={styles.craftingSearchBarContainer}>
      <input
        ref={inputRef}
        type="text"
        className={styles.craftingSearchInput} 
        value={searchTerm}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder={placeholder}
        onFocus={() => {
          console.log('[CraftingSearchBar] Input focused - should block game controls');
          onFocus?.();
        }}
        onBlur={() => {
          console.log('[CraftingSearchBar] Input blurred - should unblock game controls');
          onBlur?.();
        }}
        onKeyDown={handleKeyDown}
        data-is-chat-input="true"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck="false"
      />
      <div className={styles.filterButtonContainer}>
        <button
          className={styles.filterButton}
          onClick={handleFilterClick}
          title="Filter by category"
        >
          🔽
        </button>
        {isDropdownOpen && (
          <div 
            className={styles.filterDropdown}
            onBlur={handleDropdownBlur}
            tabIndex={-1}
          >
            {Object.entries(CATEGORY_LABELS).map(([categoryKey, label]) => (
              <div
                key={categoryKey}
                className={`${styles.filterOption} ${selectedCategory === categoryKey ? styles.filterOptionSelected : ''}`}
                onClick={() => handleCategorySelect(categoryKey)}
              >
                {label}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default CraftingSearchBar; 