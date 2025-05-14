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
      />
    </div>
  );
};

export default CraftingSearchBar; 