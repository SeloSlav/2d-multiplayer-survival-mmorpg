import React, { useRef, useEffect, useState } from 'react';
import InterfaceTabs from './InterfaceTabs';
import MemoryGrid from './MemoryGrid';
import { MemoryGridNode } from './MemoryGridData';
import { MINIMAP_DIMENSIONS } from './Minimap';
import './InterfaceContainer.css';

interface InterfaceContainerProps {
  children: React.ReactNode;
  canvasWidth: number;
  canvasHeight: number;
  style?: React.CSSProperties;
  onClose: () => void;
}

const InterfaceContainer: React.FC<InterfaceContainerProps> = ({
  children,
  canvasWidth,
  canvasHeight,
  style,
  onClose,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [currentView, setCurrentView] = useState<'minimap' | 'encyclopedia' | 'memory-grid'>('minimap');
  const [isMinimapLoading, setIsMinimapLoading] = useState(false);
  
  // Memory Grid state for testing (client-side only)
  const [playerShards, setPlayerShards] = useState(100000);
  const [purchasedNodes, setPurchasedNodes] = useState<Set<string>>(new Set(['center']));

  // Handle node purchases (client-side testing only)
  const handleNodePurchase = (node: MemoryGridNode) => {
    if (playerShards >= node.cost && !purchasedNodes.has(node.id)) {
      // Deduct shards
      setPlayerShards(prev => prev - node.cost);
      
      // Add node to purchased set
      setPurchasedNodes(prev => new Set([...prev, node.id]));
      
      console.log(`✅ Purchased ${node.name} for ${node.cost} shards! Remaining: ${playerShards - node.cost}`);
    } else {
      console.log(`❌ Cannot purchase ${node.name}: ${playerShards < node.cost ? 'Not enough shards' : 'Already purchased'}`);
    }
  };

  // Handle view changes with loading state for minimap
  const handleViewChange = (view: 'minimap' | 'encyclopedia' | 'memory-grid') => {
    if (view === 'minimap' && currentView !== 'minimap') {
      // Show loading when switching TO minimap from another tab
      setIsMinimapLoading(true);
      setCurrentView(view);
      
      // Hide loading after a short delay to allow minimap to render
      setTimeout(() => {
        setIsMinimapLoading(false);
      }, 800); // Adjust timing as needed
    } else {
      // No loading needed for other tabs
      setCurrentView(view);
    }
  };

  // Add global CSS for smooth animations
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      @keyframes cyberpunk-spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
      
      @keyframes cyberpunk-spin-reverse {
        0% { transform: translate(-50%, -50%) rotate(0deg); }
        100% { transform: translate(-50%, -50%) rotate(-360deg); }
      }
      
      @keyframes cyberpunk-pulse {
        0%, 100% { 
          opacity: 1; 
          transform: scale(1);
        }
        50% { 
          opacity: 0.6; 
          transform: scale(1.1);
        }
      }
      
      @keyframes cyberpunk-text-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.7; }
      }
      
      .cyberpunk-spinner-outer {
        will-change: transform;
        animation: cyberpunk-spin 1.5s linear infinite;
        transform-origin: center;
      }
      
      .cyberpunk-spinner-inner {
        will-change: transform;
        animation: cyberpunk-spin-reverse 1s linear infinite;
        transform-origin: center;
      }
      
      .cyberpunk-pulse-dot {
        will-change: transform, opacity;
        animation: cyberpunk-pulse 1.2s ease-in-out infinite;
      }
      
      .cyberpunk-text-pulse {
        will-change: opacity;
        animation: cyberpunk-text-pulse 2s ease-in-out infinite;
      }
    `;
    document.head.appendChild(style);
    
    return () => {
      document.head.removeChild(style);
    };
  }, []);

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  // Block specific mouse events from reaching the game, but allow input interactions
  const handleMouseEvent = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    
    // Don't block events on input elements
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
      return;
    }
    
    // Don't block events on canvas elements (let the minimap handle them)
    if (target.tagName === 'CANVAS') {
      return;
    }
    
    e.stopPropagation();
    // Don't call preventDefault on all events - causes issues with passive listeners
  };

  // Separate handler for wheel events to avoid passive listener issues
  const handleWheelEvent = (e: React.WheelEvent) => {
    const target = e.target as HTMLElement;
    
    // Don't block wheel events on input elements
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
      return;
    }
    
    // Don't block wheel events on canvas elements
    if (target.tagName === 'CANVAS') {
      return;
    }
    
    e.stopPropagation();
    // Don't call preventDefault - causes passive listener issues
  };

  // Separate handler for context menu events
  const handleContextMenuEvent = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    
    // Don't block context menu on input elements
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
      return;
    }
    
    e.stopPropagation();
    e.preventDefault(); // Safe to call preventDefault on context menu events
  };

  // Base content container style to maintain consistent dimensions
  const contentContainerStyle: React.CSSProperties = {
    width: `${MINIMAP_DIMENSIONS.width}px`,
    height: `${MINIMAP_DIMENSIONS.height}px`,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden', // Prevent content from breaking the fixed dimensions
  };

  // Loading overlay spinner component
  const LoadingOverlay = () => (
    <div style={{
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(15, 23, 35, 0.85)', // Semi-transparent overlay
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 10, // Ensure it's on top
      backdropFilter: 'blur(2px)', // Subtle blur effect
    }}>
      {/* Outer rotating ring */}
      <div 
        className="cyberpunk-spinner-outer"
        style={{
          width: '80px',
          height: '80px',
          border: '3px solid transparent',
          borderTop: '3px solid #00d4ff',
          borderRight: '3px solid #7c3aed',
          borderRadius: '50%',
          position: 'relative',
        }}
      >
        {/* Inner rotating ring */}
        <div 
          className="cyberpunk-spinner-inner"
          style={{
            width: '60px',
            height: '60px',
            border: '2px solid transparent',
            borderTop: '2px solid #7c3aed',
            borderLeft: '2px solid #00d4ff',
            borderRadius: '50%',
            position: 'absolute',
            top: '50%',
            left: '50%',
          }}
        >
          {/* Center dot */}
          <div 
            className="cyberpunk-pulse-dot"
            style={{
              width: '8px',
              height: '8px',
              background: '#00d4ff',
              borderRadius: '50%',
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              boxShadow: '0 0 8px #00d4ff',
            }} 
          />
        </div>
      </div>
      
      {/* Loading text */}
      <div style={{
        marginTop: '20px',
        color: '#00d4ff',
        fontSize: '14px',
        fontWeight: 'bold',
        textAlign: 'center',
        fontFamily: 'monospace',
        letterSpacing: '1px',
      }}>
        <div className="cyberpunk-text-pulse">
          INITIALIZING GRU MAPS
        </div>
        <div style={{ 
          marginTop: '8px', 
          fontSize: '12px', 
          color: '#7c3aed',
          opacity: '0.8'
        }}>
          Scanning neural pathways...
        </div>
      </div>
    </div>
  );

  // Render content based on current view
  const renderContent = () => {
    switch (currentView) {
      case 'minimap':
        return (
          <div style={{ ...contentContainerStyle, position: 'relative' }}>
            {children}
            {/* Show loading overlay on top of minimap content */}
            {isMinimapLoading && <LoadingOverlay />}
          </div>
        );
      case 'encyclopedia':
        return (
          <div className="encyclopedia-content" style={{ 
            ...contentContainerStyle,
            padding: '20px', 
            textAlign: 'center',
            color: '#ffffff',
            background: 'rgba(15, 23, 35, 0.95)', // Match minimap background
            border: `2px solid #00d4ff`, // Match minimap border
            borderRadius: '4px',
            boxSizing: 'border-box', // Include padding in dimensions
          }}>
            <h2 style={{ 
              color: '#00d4ff', 
              marginBottom: '20px',
              fontSize: '24px',
              fontWeight: 'bold'
            }}>
              📚 ENCYCLOPEDIA
            </h2>
            <p style={{ 
              fontSize: '16px', 
              lineHeight: '1.6',
              maxWidth: '500px',
              opacity: '0.9',
              overflowY: 'auto', // Allow scrolling if content is too tall
              maxHeight: '80%', // Limit content height
            }}>
              Welcome to the Encyclopedia! This will be your comprehensive guide to the world of survival.
              <br /><br />
              Here you'll find detailed information about:
              <br />• Items and their crafting recipes
              <br />• Creatures and their behaviors  
              <br />• Environmental hazards and how to survive them
              <br />• Advanced gameplay mechanics
              <br /><br />
              <em>Content coming soon...</em>
            </p>
          </div>
        );
      case 'memory-grid':
        return (
          <div className="memory-grid-content" style={{ 
            ...contentContainerStyle,
            padding: '0', // Remove padding to let MemoryGrid use full space
            background: 'transparent', // MemoryGrid has its own background
            border: 'none', // MemoryGrid has its own border
          }}>
            <MemoryGrid
              playerShards={playerShards}
              purchasedNodes={purchasedNodes}
              onNodePurchase={handleNodePurchase}
            />
          </div>
        );
      default:
        return (
          <div style={contentContainerStyle}>
            {children}
          </div>
        );
    }
  };

  return (
    <div
      ref={containerRef}
      className="interface-container"
      style={{
        position: 'absolute',
        left: '50%',
        top: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 1000,
        ...style,
      }}
      onMouseDown={handleMouseEvent}
      onMouseUp={handleMouseEvent}
      onClick={handleMouseEvent}
      onWheel={handleWheelEvent}
      onContextMenu={handleContextMenuEvent}
    >
      <InterfaceTabs
        currentView={currentView}
        onViewChange={handleViewChange}
        className="interface-tabs"
      />
      
      <button
        className="close-button"
        onClick={onClose}
        style={{
          position: 'absolute',
          top: '-40px',
          right: '0px',
          width: '40px',
          height: '40px',
          background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
          border: '2px solid #ef4444',
          borderRadius: '8px 8px 0 0',
          color: '#ffffff',
          fontSize: '18px',
          fontWeight: 'bold',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1001,
          transition: 'all 0.2s ease',
          boxShadow: '0 0 8px rgba(239, 68, 68, 0.5)',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)';
          e.currentTarget.style.boxShadow = '0 0 12px rgba(239, 68, 68, 0.7)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';
          e.currentTarget.style.boxShadow = '0 0 8px rgba(239, 68, 68, 0.5)';
        }}
      >
        ×
      </button>
      
      <div className="interface-content">
        {renderContent()}
      </div>
    </div>
  );
};

export default InterfaceContainer;