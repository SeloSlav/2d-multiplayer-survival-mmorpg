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

interface CraftingSearchBarProps {
  searchTerm: string;
  onSearchChange: (newSearchTerm: string) => void;
  placeholder?: string;
  onFocus?: () => void;
  onBlur?: () => void;
  // New props for category filtering
  selectedCategory?: string;
  onCategoryChange?: (category: string) => void;
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
  } = props;

  const inputRef = useRef<HTMLInputElement>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key.toLowerCase() === 'g' || event.key === ' ') {
      // Prevent 'g' and 'spacebar' from triggering game actions
      // but still allow typing them into the input.
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
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={handleKeyDown}
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