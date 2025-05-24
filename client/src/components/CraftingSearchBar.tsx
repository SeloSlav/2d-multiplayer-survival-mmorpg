import React, { useRef } from 'react';
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

  const inputRef = useRef<HTMLInputElement>(null);

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
    </div>
  );
};

export default CraftingSearchBar; 