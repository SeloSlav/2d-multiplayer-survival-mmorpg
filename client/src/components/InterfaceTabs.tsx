import React, { useState } from 'react';
import './InterfaceTabs.css';

interface InterfaceTabsProps {
  currentView: 'minimap';
  onViewChange: (view: 'minimap') => void;
  className?: string;
}

const InterfaceTabs: React.FC<InterfaceTabsProps> = ({ 
  currentView, 
  onViewChange, 
  className = '' 
}) => {
  const [hoveredTab, setHoveredTab] = useState<string | null>(null);

  const isMinimapActive = currentView === 'minimap';

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
      
      {/* Encyclopedia Tab - Disabled */}
      <button
        className={`tab encyclopedia-tab disabled ${hoveredTab === 'encyclopedia' ? 'hovered' : ''}`}
        disabled
        onMouseEnter={() => setHoveredTab('encyclopedia')}
        onMouseLeave={() => setHoveredTab(null)}
        title="Coming Soon"
      >
        ENCYCLOPEDIA <span className="coming-soon-indicator">(COMING SOON)</span>
      </button>
    </div>
  );
};

export default InterfaceTabs; 