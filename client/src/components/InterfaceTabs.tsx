import React, { useState } from 'react';
import './InterfaceTabs.css';

interface InterfaceTabsProps {
  currentView: 'minimap' | 'encyclopedia' | 'memory-grid';
  onViewChange: (view: 'minimap' | 'encyclopedia' | 'memory-grid') => void;
  className?: string;
  hideEncyclopedia?: boolean;
}

const InterfaceTabs: React.FC<InterfaceTabsProps> = ({ 
  currentView, 
  onViewChange, 
  className = '',
  hideEncyclopedia = false
}) => {
  const [hoveredTab, setHoveredTab] = useState<string | null>(null);

  const isMinimapActive = currentView === 'minimap';
  const isEncyclopediaActive = currentView === 'encyclopedia';
  const isMemoryGridActive = currentView === 'memory-grid';

  return (
    <div className={`interface-tabs ${className}`}>
      {/* GRU MAPS Tab */}
      <button
        className={`tab ${isMinimapActive ? 'active' : 'inactive'} ${hoveredTab === 'minimap' ? 'hovered' : ''}`}
        onClick={() => onViewChange('minimap')}
        onMouseEnter={() => setHoveredTab('minimap')}
        onMouseLeave={() => setHoveredTab(null)}
      >
        GRU MAPS
      </button>
      
      {/* Encyclopedia Tab - conditionally rendered */}
      {!hideEncyclopedia && (
        <button
          className={`tab encyclopedia-tab ${isEncyclopediaActive ? 'active' : 'inactive'} ${hoveredTab === 'encyclopedia' ? 'hovered' : ''}`}
          onClick={() => onViewChange('encyclopedia')}
          onMouseEnter={() => setHoveredTab('encyclopedia')}
          onMouseLeave={() => setHoveredTab(null)}
        >
          ENCYCLOPEDIA
        </button>
      )}
      
      {/* Memory Grid Tab */}
      <button
        className={`tab memory-grid-tab ${isMemoryGridActive ? 'active' : 'inactive'} ${hoveredTab === 'memory-grid' ? 'hovered' : ''}`}
        onClick={() => onViewChange('memory-grid')}
        onMouseEnter={() => setHoveredTab('memory-grid')}
        onMouseLeave={() => setHoveredTab(null)}
      >
        MEMORY GRID
      </button>
    </div>
  );
};

export default InterfaceTabs; 