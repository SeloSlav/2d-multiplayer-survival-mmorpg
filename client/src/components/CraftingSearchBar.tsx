import React from 'react';
import styles from './InventoryUI.module.css'; // Reuse existing styles if applicable, or create new ones

interface CraftingSearchBarProps {
  searchTerm: string;
  onSearchChange: (newSearchTerm: string) => void;
  placeholder?: string;
  onFocus?: () => void;
  onBlur?: () => void;
}

const CraftingSearchBar: React.FC<CraftingSearchBarProps> = (props) => {
  const {
    searchTerm,
    onSearchChange,
    placeholder = "Search recipes by name, ingredients...",
    onFocus,
    onBlur,
  } = props;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key.toLowerCase() === 'g' || event.key === ' ') {
      // Prevent 'g' and 'spacebar' from triggering game actions
      // but still allow typing them into the input.
      event.stopPropagation();
    }
    // If there's an onKeyDown prop passed from parent, call it too
    // This component doesn't define its own onKeyDown prop in CraftingSearchBarProps,
    // so we don't need to worry about calling a parent-supplied one for now.
  };

  return (
    <div className={styles.craftingSearchBarContainer}> {/* Will add style for this */}
      <input
        type="text"
        className={styles.craftingSearchInput} 
        value={searchTerm}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder={placeholder}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={handleKeyDown}
      />
    </div>
  );
};

export default CraftingSearchBar; 