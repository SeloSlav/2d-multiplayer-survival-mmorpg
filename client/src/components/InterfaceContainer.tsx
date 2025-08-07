import React, { useRef, useEffect, useState, useCallback } from 'react';
import InterfaceTabs from './InterfaceTabs';
import MemoryGrid from './MemoryGrid';
import { MemoryGridNode } from './MemoryGridData';
import { MINIMAP_DIMENSIONS } from './Minimap';
import { useGameConnection } from '../contexts/GameConnectionContext';
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
  
  // Get SpacetimeDB connection
  const connection = useGameConnection();
  
  // Memory Grid server state
  const [playerShards, setPlayerShards] = useState(0);
  const [purchasedNodes, setPurchasedNodes] = useState<Set<string>>(new Set(['center']));
  const [isLoadingMemoryData, setIsLoadingMemoryData] = useState(false);

  // Update memory grid data from SpacetimeDB subscriptions
  const updateMemoryGridData = useCallback(() => {
    if (!connection.connection || !connection.isConnected || !connection.dbIdentity) return;
    
    setIsLoadingMemoryData(true);
    
    try {
      // Calculate memory shards from inventory using server-side pattern (like projectile.rs)
      let totalShards = 0;
      
      // First, find the Memory Shard item definition ID
      let memoryShardDefId: bigint | null = null;
      for (const itemDef of connection.connection.db.itemDefinition.iter()) {
        if (itemDef.name === 'Memory Shard') {
          memoryShardDefId = itemDef.id;
          console.log(`🔍 [Memory Grid Debug] Found Memory Shard definition ID: ${memoryShardDefId}`);
          break;
        }
      }
      
      if (!memoryShardDefId) {
        console.error(`❌ [Memory Grid Debug] Memory Shard item definition not found!`);
        setPlayerShards(0);
        setIsLoadingMemoryData(false);
        return;
      }
      
      console.log(`🔍 [Memory Grid Debug] Scanning inventory for Memory Shards (def_id: ${memoryShardDefId})`);
      console.log(`🔍 [Memory Grid Debug] Current player identity: ${connection.dbIdentity}`);
      
      // Use the exact same pattern as projectile.rs line 171-187
      for (const item of connection.connection.db.inventoryItem.iter()) {
        if (item.itemDefId === memoryShardDefId && item.quantity > 0) {
          console.log(`🔍 [Memory Grid Debug] Found Memory Shard item instance:`, {
            instanceId: item.instanceId,
            quantity: item.quantity,
            location: item.location,
            locationValue: item.location && 'value' in item.location ? item.location.value : null
          });
          
          // Match the exact pattern from projectile.rs
          const location = item.location;
          
          // Debug the identity comparison issue
          console.log(`🔍 [Memory Grid Debug] Identity comparison:`, {
            currentPlayer: connection.dbIdentity,
            currentPlayerString: connection.dbIdentity?.toString(),
            locationOwnerId: location && 'value' in location ? (location.value as any).ownerId : null,
            locationOwnerIdString: location && 'value' in location ? (location.value as any).ownerId?.toString() : null,
            areEqual: location && 'value' in location ? (location.value as any).ownerId === connection.dbIdentity : false,
            areEqualString: location && 'value' in location ? (location.value as any).ownerId?.toString() === connection.dbIdentity?.toString() : false
          });
          
          // Try both direct comparison and string comparison
          let isOwnedByPlayer = false;
          if (location && 'value' in location) {
            const locationOwnerId = (location.value as any).ownerId;
            // Try direct Identity comparison first
            isOwnedByPlayer = locationOwnerId === connection.dbIdentity;
            // If that fails, try string comparison as fallback
            if (!isOwnedByPlayer && locationOwnerId && connection.dbIdentity) {
              isOwnedByPlayer = locationOwnerId.toString() === connection.dbIdentity.toString();
            }
          }
          
          if ((location?.tag === 'Inventory' || location?.tag === 'Hotbar') && isOwnedByPlayer) {
            totalShards += item.quantity;
            console.log(`✅ [Memory Grid Debug] Added ${item.quantity} shards from ${location.tag} (total: ${totalShards})`);
          } else {
            let ownerId = 'N/A';
            if (location && 'value' in location) {
              ownerId = (location.value as any).ownerId?.toString() || 'N/A';
            }
            console.log(`❌ [Memory Grid Debug] Memory Shard not in player's inventory/hotbar:`, {
              locationTag: location?.tag,
              ownerId,
              expectedOwner: connection.dbIdentity?.toString(),
              isOwnedByPlayer
            });
          }
        }
      }
      setPlayerShards(totalShards);
      
      // Get purchased nodes from memory grid progress
      console.log(`🔍 [Memory Grid Debug] Looking for progress for player: ${connection.dbIdentity?.toString()}`);
      
      let progress = null;
      for (const p of connection.connection.db.memoryGridProgress.iter()) {
        console.log(`🔍 [Memory Grid Debug] Found progress entry:`, {
          playerId: p.playerId?.toString(),
          purchasedNodes: p.purchasedNodes,
          matches: p.playerId?.toString() === connection.dbIdentity?.toString()
        });
        
        if (p.playerId?.toString() === connection.dbIdentity?.toString()) {
          progress = p;
          break;
        }
      }
      
      if (progress) {
        const nodeIds = progress.purchasedNodes.split(',').filter((id: string) => id.trim() !== '');
        setPurchasedNodes(new Set(nodeIds));
        console.log(`✅ [Memory Grid Debug] Loaded ${nodeIds.length} purchased nodes:`, nodeIds);
        console.log(`📊 Memory Grid: ${totalShards} shards, ${nodeIds.length} nodes purchased`);
      } else {
        // Initialize if no progress found
        setPurchasedNodes(new Set(['center']));
        connection.connection.reducers.initializePlayerMemoryGrid();
        console.log(`📊 Memory Grid: ${totalShards} shards, initializing progress`);
      }
      
    } catch (error) {
      console.error('Failed to update memory grid data:', error);
      // Fallback to default values
      setPlayerShards(0);
      setPurchasedNodes(new Set(['center']));
    } finally {
      setIsLoadingMemoryData(false);
    }
  }, [connection]);

  // Handle node purchases through server
  const handleNodePurchase = useCallback(async (node: MemoryGridNode) => {
    if (!connection.connection) {
      console.error('❌ No connection to server');
      return;
    }
    
    try {
      // Call server reducer to purchase node
      connection.connection.reducers.purchaseMemoryGridNode(node.id);
      console.log(`✅ Attempting to purchase ${node.name} on server`);
      
      // The state will be updated automatically through SpacetimeDB subscriptions
      // We'll trigger an update manually for immediate feedback
      setTimeout(() => updateMemoryGridData(), 100);
    } catch (error) {
      console.error(`❌ Failed to purchase ${node.name}:`, error);
    }
  }, [connection, updateMemoryGridData]);

  // Update memory grid data when connection changes or data updates
  useEffect(() => {
    updateMemoryGridData();
  }, [updateMemoryGridData]);
  
  // Also update when SpacetimeDB data changes
  useEffect(() => {
    if (connection.connection && connection.isConnected) {
      // Set up listeners for inventory and memory grid changes
      const updateTimer = setInterval(updateMemoryGridData, 1000); // Update every second
      return () => clearInterval(updateTimer);
    }
  }, [connection.connection, connection.isConnected, updateMemoryGridData]);

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
            position: 'relative',
          }}>
            <MemoryGrid
              playerShards={playerShards}
              purchasedNodes={purchasedNodes}
              onNodePurchase={handleNodePurchase}
            />
            {/* Show loading overlay when fetching memory data */}
            {isLoadingMemoryData && (
              <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'rgba(15, 23, 35, 0.85)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'center',
                zIndex: 10,
                backdropFilter: 'blur(2px)',
              }}>
                <div style={{
                  color: '#7c3aed',
                  fontSize: '14px',
                  fontWeight: 'bold',
                  textAlign: 'center',
                  fontFamily: 'monospace',
                  letterSpacing: '1px',
                }}>
                  <div className="cyberpunk-text-pulse">
                    SYNCING NEURAL GRID
                  </div>
                  <div style={{ 
                    marginTop: '8px', 
                    fontSize: '12px', 
                    color: '#00d4ff',
                    opacity: '0.8'
                  }}>
                    Validating memory shards...
                  </div>
                </div>
              </div>
            )}
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
        hideEncyclopedia={true}
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