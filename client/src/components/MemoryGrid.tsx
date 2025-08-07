import React, { useState, useRef, useCallback, useEffect } from 'react';
import { MemoryGridNode, MEMORY_GRID_NODES, FACTIONS, isNodeAvailable } from './MemoryGridData';
import MemoryGridNodeComponent from './MemoryGridNode';
import './MemoryGrid.css';

interface MemoryGridProps {
  playerShards?: number; // Current player memory shards
  purchasedNodes?: Set<string>; // Set of purchased node IDs
  onNodePurchase?: (node: MemoryGridNode) => void;
}

const MemoryGrid: React.FC<MemoryGridProps> = ({
  playerShards = 1000, // Default for demo
  purchasedNodes = new Set(['center']), // Default with center node purchased
  onNodePurchase,
}) => {
  // Initialize with center node selected by default
  const [selectedNode, setSelectedNode] = useState<MemoryGridNode | null>(() => 
    MEMORY_GRID_NODES.find(n => n.id === 'center') || null
  );
  const [hoveredNode, setHoveredNode] = useState<MemoryGridNode | null>(null);
  const [scale, setScale] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [lastPanPoint, setLastPanPoint] = useState({ x: 0, y: 0 });
  const [hasPanned, setHasPanned] = useState(false);
  
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Grid dimensions
  const gridWidth = 600;
  const gridHeight = 600;
  const centerX = gridWidth / 2;
  const centerY = gridHeight / 2;

  // Handle node selection (just select, don't auto-purchase)
  const handleNodeClick = useCallback((node: MemoryGridNode, event?: React.MouseEvent) => {
    // Prevent event from bubbling up to SVG background
    if (event) {
      event.stopPropagation();
    }
    setSelectedNode(node);
  }, []);

  // Handle node hover
  const handleNodeHover = useCallback((node: MemoryGridNode | null) => {
    setHoveredNode(node);
  }, []);

  // Update node statuses based on purchased nodes
  const getUpdatedNodes = (): MemoryGridNode[] => {
    return MEMORY_GRID_NODES.map(node => {
      if (purchasedNodes.has(node.id)) {
        return { ...node, status: 'purchased' };
      } else if (isNodeAvailable(node.id, purchasedNodes)) {
        return { ...node, status: 'available' };
      } else {
        return { ...node, status: 'locked' };
      }
    }) as MemoryGridNode[];
  };

  const updatedNodes = getUpdatedNodes();

  // Generate branch labels for faction specialization paths
  const generateBranchLabels = (): React.ReactElement[] => {
    const labels: React.ReactElement[] = [];
    
    // Define branch information for each faction with lore-appropriate class names
    const branchInfo = [
      {
        faction: 'black-wolves',
        angle: 0,
        upperLabel: 'Berserker',
        lowerLabel: 'Assassin'
      },
      {
        faction: 'hive', 
        angle: Math.PI / 3,
        upperLabel: 'Industrialist',
        lowerLabel: 'Toxicologist'
      },
      {
        faction: 'university',
        angle: 2 * Math.PI / 3,
        upperLabel: 'Engineer',
        lowerLabel: 'Scholar'
      },
      {
        faction: 'data-angels',
        angle: Math.PI,
        upperLabel: 'Netrunner',
        lowerLabel: 'Phantom'
      },
      {
        faction: 'battalion',
        angle: 4 * Math.PI / 3,
        upperLabel: 'Colonel',
        lowerLabel: 'Tactician'
      },
      {
        faction: 'admiralty',
        angle: 5 * Math.PI / 3,
        upperLabel: 'Captain',
        lowerLabel: 'Storm Caller'
      }
    ];
    
    branchInfo.forEach(branch => {
      const factionColor = FACTIONS[branch.faction]?.color || '#7c3aed';
      const labelRadius = 690; // Further from nodes for better visual spacing
      
      // Upper path label
      const upperX = Math.cos(branch.angle - 0.3) * labelRadius * scale + panOffset.x;
      const upperY = Math.sin(branch.angle - 0.3) * labelRadius * scale + panOffset.y;
      
      labels.push(
        <text
          key={`${branch.faction}-upper-label`}
          x={upperX}
          y={upperY}
          textAnchor="middle"
          dy={4}
          fontSize={24 * scale}
          fill={factionColor}
          className={`branch-label ${branch.faction}-branch upper-path`}
          style={{ 
            fontWeight: 'bold',
            textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
            pointerEvents: 'none'
          }}
        >
          {branch.upperLabel}
        </text>
      );
      
      // Lower path label
      const lowerX = Math.cos(branch.angle + 0.3) * labelRadius * scale + panOffset.x;
      const lowerY = Math.sin(branch.angle + 0.3) * labelRadius * scale + panOffset.y;
      
      labels.push(
        <text
          key={`${branch.faction}-lower-label`}
          x={lowerX}
          y={lowerY}
          textAnchor="middle"
          dy={4}
          fontSize={24 * scale}
          fill={factionColor}
          className={`branch-label ${branch.faction}-branch lower-path`}
          style={{ 
            fontWeight: 'bold',
            textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
            pointerEvents: 'none'
          }}
        >
          {branch.lowerLabel}
        </text>
      );
    });
    
    return labels;
  };

  // Generate connection lines between prerequisite nodes (cleaned up and curved)
  const generateConnections = (): React.ReactElement[] => {
    const connections: React.ReactElement[] = [];
    
    // Add concentric circular connections for each tier (main grid only)
    const tierRadii = [100, 180, 270, 370, 480]; // Tier 1-5 radii
    tierRadii.forEach((radius, tierIndex) => {
      const tier = tierIndex + 1;
      const tierNodes = updatedNodes.filter(n => n.tier === tier && !n.faction);
      
      if (tierNodes.length > 1) {
        // Create circular path connecting all nodes in this tier
        const scaledRadius = radius * scale;
        const centerXAdjusted = centerX + panOffset.x;
        const centerYAdjusted = centerY + panOffset.y;
        
        // Determine opacity based on whether any nodes in this tier are purchased
        const anyPurchased = tierNodes.some(n => purchasedNodes.has(n.id));
        const strokeOpacity = anyPurchased ? 0.6 : 0.4;
        
        connections.push(
          <circle
            key={`tier-${tier}-circle`}
            cx={centerXAdjusted}
            cy={centerYAdjusted}
            r={scaledRadius}
            stroke="#6b7280"
            strokeWidth={1}
            strokeOpacity={strokeOpacity}
            fill="none"
            strokeDasharray="2,4" // Subtle dashed circle
          />
        );
      }
    });
    
    updatedNodes.forEach(node => {
      // Skip faction unlock nodes - they clutter the view with too many lines
      if (node.id.includes('unlock-')) {
        return;
      }
      
      // For main grid nodes (tiers 1-5), only show the primary radial connection
      // This creates clean "spokes" from center outward without horizontal clutter
      if (!node.faction && node.prerequisites.length > 0) {
        // Find the prerequisite that's closest to the center (lowest tier)
        const primaryPrereq = node.prerequisites.reduce((closest, prereqId) => {
          const prereqNode = updatedNodes.find(n => n.id === prereqId);
          const closestNode = updatedNodes.find(n => n.id === closest);
          if (!prereqNode) return closest;
          if (!closestNode) return prereqId;
          return prereqNode.tier < closestNode.tier ? prereqId : closest;
        }, node.prerequisites[0]);
        
        const prereqNode = updatedNodes.find(n => n.id === primaryPrereq);
        if (prereqNode) {
          const startX = (prereqNode.position.x * scale) + centerX + panOffset.x;
          const startY = (prereqNode.position.y * scale) + centerY + panOffset.y;
          const endX = (node.position.x * scale) + centerX + panOffset.x;
          const endY = (node.position.y * scale) + centerY + panOffset.y;
          
          // Determine line color
          let strokeColor = '#6b7280'; // Neutral gray for main grid
          let strokeOpacity = 0.4;
          
          // Status-based brightness adjustment
          if (purchasedNodes.has(primaryPrereq) && purchasedNodes.has(node.id)) {
            strokeOpacity = 0.8; // Brighter if both purchased
          } else if (purchasedNodes.has(primaryPrereq)) {
            strokeOpacity = 0.6; // Slightly brighter if prerequisite purchased
          }
          
          connections.push(
            <line
              key={`${primaryPrereq}-${node.id}`}
              x1={startX}
              y1={startY}
              x2={endX}
              y2={endY}
              stroke={strokeColor}
              strokeWidth={2}
              strokeOpacity={strokeOpacity}
            />
          );
        }
      }
      
      // For faction branch nodes, show linear progression within the branch
      if (node.faction && node.prerequisites.length > 0) {
        const prereqId = node.prerequisites[0]; // Linear progression, so just first prereq
        const prereqNode = updatedNodes.find(n => n.id === prereqId);
        
        if (prereqNode) {
          const startX = (prereqNode.position.x * scale) + centerX + panOffset.x;
          const startY = (prereqNode.position.y * scale) + centerY + panOffset.y;
          const endX = (node.position.x * scale) + centerX + panOffset.x;
          const endY = (node.position.y * scale) + centerY + panOffset.y;
          
          // Faction-specific coloring
          let strokeColor = FACTIONS[node.faction].color;
          let strokeOpacity = 0.6;
          
          // Status-based brightness adjustment
          if (purchasedNodes.has(prereqId) && purchasedNodes.has(node.id)) {
            strokeOpacity = 0.9; // Brighter if both purchased
          } else if (purchasedNodes.has(prereqId)) {
            strokeOpacity = 0.75; // Slightly brighter if prerequisite purchased
          }
          
          connections.push(
            <line
              key={`${prereqId}-${node.id}`}
              x1={startX}
              y1={startY}
              x2={endX}
              y2={endY}
              stroke={strokeColor}
              strokeWidth={2}
              strokeOpacity={strokeOpacity}
              strokeDasharray="3,3" // Dashed lines for faction branches
            />
          );
        }
      }
    });
    
    return connections;
  };

  // Handle zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const zoomFactor = 1.1;
    const newScale = e.deltaY > 0 ? scale / zoomFactor : scale * zoomFactor;
    setScale(Math.max(0.3, Math.min(3, newScale))); // Clamp scale between 0.3 and 3
  }, [scale]);

  // Handle pan start
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 0) { // Left mouse button
      setIsPanning(true);
      setHasPanned(false); // Reset pan tracking
      setLastPanPoint({ x: e.clientX, y: e.clientY });
    }
  }, []);

  // Handle pan move
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isPanning) {
      const deltaX = e.clientX - lastPanPoint.x;
      const deltaY = e.clientY - lastPanPoint.y;
      
      // Track if we actually moved (not just a tiny movement from click)
      if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) {
        setHasPanned(true);
      }
      
      setPanOffset(prev => ({
        x: prev.x + deltaX,
        y: prev.y + deltaY
      }));
      
      setLastPanPoint({ x: e.clientX, y: e.clientY });
    }
  }, [isPanning, lastPanPoint]);

  // Handle pan end
  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
    // Don't reset hasPanned here - let the click handler use it
  }, []);

  // Add global mouse up listener
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      setIsPanning(false);
      // Don't reset hasPanned here either
    };
    document.addEventListener('mouseup', handleGlobalMouseUp);
    return () => document.removeEventListener('mouseup', handleGlobalMouseUp);
  }, []);

  // Reset view to show whole grid (zoom out)
  const resetView = () => {
    setScale(0.4); // Zoom out to see the entire grid including faction branches
    setPanOffset({ x: 0, y: 0 });
  };

  // Focus on currently selected node
  const focusSelection = () => {
    if (selectedNode) {
      setScale(1.0); // Moderate zoom to see context around the selected node
      // Calculate pan offset to center the selected node
      const nodeX = selectedNode.position.x * 1.0;
      const nodeY = selectedNode.position.y * 1.0;
      setPanOffset({ x: -nodeX, y: -nodeY });
    }
  };

  // Handle clicking on empty space to clear selection
  const handleBackgroundClick = useCallback((e: React.MouseEvent) => {
    // Only clear selection if we didn't pan and didn't click on a node
    const target = e.target as Element;
    const isNodeClick = target.closest('.memory-grid-node-group') !== null;
    
    if (!hasPanned && !isNodeClick) {
      setSelectedNode(null);
    }
  }, [hasPanned]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        background: 'radial-gradient(circle at center, rgba(15, 23, 35, 0.95) 0%, rgba(7, 11, 17, 0.98) 100%)',
        border: '2px solid #7c3aed',
        borderRadius: '4px',
        overflow: 'hidden',
        cursor: isPanning ? 'grabbing' : 'grab'
      }}
    >
      {/* Control Panel */}
      <div
        style={{
          position: 'absolute',
          top: '10px',
          left: '10px',
          zIndex: 10,
          display: 'flex',
          flexDirection: 'column',
          gap: '8px'
        }}
      >
        {/* Player stats */}
        <div
          style={{
            background: 'rgba(0, 0, 0, 0.8)',
            color: '#ffffff',
            padding: '8px 12px',
            borderRadius: '4px',
            fontSize: '12px',
            fontFamily: 'monospace',
            border: '1px solid #7c3aed'
          }}
        >
          Memory Shards: {playerShards.toLocaleString()}
        </div>
        
        {/* Control buttons */}
        <div style={{ display: 'flex', gap: '4px' }}>
          <button
            onClick={resetView}
            style={{
              background: '#374151',
              color: '#ffffff',
              border: '1px solid #6b7280',
              borderRadius: '4px',
              padding: '4px 8px',
              fontSize: '10px',
              cursor: 'pointer'
            }}
          >
            Reset View
          </button>
          <button
            onClick={focusSelection}
            style={{
              background: '#7c3aed',
              color: '#ffffff',
              border: '1px solid #8b5cf6',
              borderRadius: '4px',
              padding: '4px 8px',
              fontSize: '10px',
              cursor: 'pointer'
            }}
          >
            Focus Selection
          </button>
        </div>
      </div>

      {/* Node Info Panel */}
      {(selectedNode || hoveredNode) && (
        <div
          style={{
            position: 'absolute',
            top: '10px',
            right: '10px',
            background: 'rgba(0, 0, 0, 0.9)',
            color: '#ffffff',
            padding: '12px',
            borderRadius: '4px',
            maxWidth: '250px',
            fontSize: '12px',
            border: '1px solid #7c3aed',
            zIndex: 10
          }}
        >
          {(() => {
            const baseNode = selectedNode || hoveredNode;
            if (!baseNode) return null;
            
            // Always get the most up-to-date node status from updatedNodes
            const displayNode = updatedNodes.find(n => n.id === baseNode.id) || baseNode;
            
            const faction = displayNode.faction ? FACTIONS[displayNode.faction] : null;
            const canAfford = playerShards >= displayNode.cost;
            
            return (
              <>
                <div style={{ 
                  color: faction ? faction.color : '#7c3aed', 
                  fontWeight: 'bold', 
                  marginBottom: '8px',
                  fontSize: '14px'
                }}>
                  {displayNode.name}
                </div>
                
                {faction && (
                  <div style={{ 
                    color: faction.color, 
                    fontSize: '10px', 
                    marginBottom: '4px',
                    fontStyle: 'italic'
                  }}>
                    {faction.name} - {faction.description}
                  </div>
                )}
                
                <div style={{ marginBottom: '8px', lineHeight: '1.4' }}>
                  {displayNode.description}
                </div>
                
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ 
                    color: displayNode.status === 'purchased' ? '#22c55e' : 
                          displayNode.status === 'available' ? '#3b82f6' : '#9ca3af'
                  }}>
                    {displayNode.status === 'purchased' 
                      ? 'INSTALLED' 
                      : displayNode.status.toUpperCase()}
                  </span>
                  
                  {displayNode.cost > 0 && displayNode.status !== 'purchased' && (
                    <span style={{ 
                      color: canAfford ? '#22c55e' : '#ef4444',
                      fontWeight: 'bold',
                      fontFamily: 'monospace'
                    }}>
                      {displayNode.cost} shards
                    </span>
                  )}
                </div>
                
                {/* Show prerequisites for locked nodes */}
                {displayNode.status === 'locked' && displayNode.prerequisites.length > 0 && (
                  <div style={{ 
                    marginTop: '8px', 
                    padding: '6px 8px', 
                    background: 'rgba(239, 68, 68, 0.1)', 
                    border: '1px solid #ef4444',
                    borderRadius: '4px',
                    fontSize: '11px'
                  }}>
                    <div style={{ color: '#ef4444', fontWeight: 'bold', marginBottom: '4px' }}>
                      {displayNode.id.includes('unlock-') 
                                                    ? 'Requires any one Tier 5 node:'
                        : displayNode.prerequisites.length === 1 
                          ? 'Requires:' 
                          : 'Requires any one of:'}
                    </div>
                    {displayNode.prerequisites.map(prereqId => {
                      const prereqNode = updatedNodes.find(n => n.id === prereqId);
                      return (
                        <div key={prereqId} style={{ 
                          color: purchasedNodes.has(prereqId) ? '#22c55e' : '#ef4444',
                          marginBottom: '2px'
                        }}>
                          • {prereqNode?.name || prereqId}
                          {purchasedNodes.has(prereqId) ? ' ✓' : ' ✗'}
                        </div>
                      );
                    })}
                  </div>
                )}
                
                {displayNode.status === 'available' && canAfford && onNodePurchase && (
                  <button
                    onClick={() => onNodePurchase(displayNode)}
                    style={{
                      width: '100%',
                      marginTop: '8px',
                      background: '#22c55e',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '4px',
                      padding: '6px',
                      cursor: 'pointer',
                      fontSize: '12px',
                      fontWeight: 'bold'
                    }}
                  >
                    PURCHASE
                  </button>
                )}
                
                {displayNode.status === 'available' && !canAfford && (
                  <div style={{ 
                    marginTop: '8px', 
                    padding: '6px', 
                    background: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid #ef4444',
                    borderRadius: '4px',
                    textAlign: 'center' as const,
                    fontSize: '11px',
                    color: '#ef4444'
                  }}>
                    Insufficient Memory Shards
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}

      {/* Main Grid SVG */}
      <svg
        ref={svgRef}
        width={gridWidth}
        height={gridHeight}
        style={{ width: '100%', height: '100%' }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onClick={handleBackgroundClick}
      >
        {/* Grid background pattern */}
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path
              d="M 40 0 L 0 0 0 40"
              fill="none"
              stroke="rgba(124, 58, 237, 0.1)"
              strokeWidth="1"
            />
          </pattern>
        </defs>
        
        <rect width="100%" height="100%" fill="url(#grid)" />
        
        {/* Connection lines */}
        <g>
          {generateConnections()}
        </g>
        
        {/* Nodes */}
        <g transform={`translate(${centerX + panOffset.x}, ${centerY + panOffset.y})`}>
          {updatedNodes.map(node => (
            <MemoryGridNodeComponent
              key={node.id}
              node={node}
              scale={scale}
              playerShards={playerShards}
              isSelected={selectedNode?.id === node.id}
              onNodeClick={handleNodeClick}
              onNodeHover={handleNodeHover}
            />
          ))}
        </g>
        
        {/* Branch Labels */}
        <g transform={`translate(${centerX}, ${centerY})`}>
          {generateBranchLabels()}
        </g>
        
        {/* Center crosshair */}
        <g transform={`translate(${centerX + panOffset.x}, ${centerY + panOffset.y})`} opacity={0.3}>
          <line x1="-10" y1="0" x2="10" y2="0" stroke="#7c3aed" strokeWidth={1} />
          <line x1="0" y1="-10" x2="0" y2="10" stroke="#7c3aed" strokeWidth={1} />
        </g>
      </svg>
      
      {/* Instructions */}
      <div
        style={{
          position: 'absolute',
          bottom: '10px',
          left: '10px',
          color: '#9ca3af',
          fontSize: '10px',
          fontFamily: 'monospace'
        }}
      >
        Mouse: Pan • Wheel: Zoom • Click: Select/Purchase
      </div>
    </div>
  );
};

export default MemoryGrid; 