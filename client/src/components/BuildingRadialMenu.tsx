/**
 * Building Radial Menu Component
 * 
 * Shows a radial menu when right-clicking with Blueprint equipped.
 * Allows selection of building pieces (foundations, walls, doors, etc.)
 * Shows resource requirements and greys out unavailable options.
 * 
 * Styled with cyberpunk theme - cyan/blue colors, gradients, glows.
 */

import React, { useState, useEffect, useRef } from 'react';
import { BuildingMode, BuildingTier, FoundationShape } from '../engine/runtime/buildingPlacementRuntime';
import { DbConnection } from '../generated';
import { InventoryItem, ItemDefinition } from '../generated/types';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faCube, 
  faShapes, 
  faGripLinesVertical,
  faBorderAll,
  IconDefinition 
} from '@fortawesome/free-solid-svg-icons';
import { playImmediateSound } from '../hooks/useSoundSystem';

interface BuildingRadialMenuProps {
  isVisible: boolean;
  mouseX: number;
  mouseY: number;
  connection: DbConnection | null;
  inventoryItems: Map<string, InventoryItem>;
  itemDefinitions: Map<string, ItemDefinition>;
  onSelect: (mode: BuildingMode, tier: BuildingTier, initialShape?: FoundationShape) => void; // ADDED: initialShape parameter
  onCancel: () => void;
}

interface BuildingOption {
  mode: BuildingMode;
  name: string;
  icon: IconDefinition;
  description: string;
  requirements: {
    wood?: number;
    stone?: number;
    metal?: number;
  };
  available: boolean;
  reason?: string; // Why it's unavailable
  isTriangle?: boolean; // ADDED: Flag to indicate triangle foundation
}

const RADIUS = 260; // Outer radius of the radial menu (increased for better visibility)
const INNER_RADIUS = 160; // Inner radius (center area - increased to accommodate text)
const MENU_SIZE = RADIUS * 2;

export const BuildingRadialMenu: React.FC<BuildingRadialMenuProps> = ({
  isVisible,
  mouseX,
  mouseY,
  connection,
  inventoryItems,
  itemDefinitions,
  onSelect,
  onCancel,
}) => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const isSelectingRef = useRef(false); // Prevent multiple selections

  // Calculate total wood in inventory (only local player's items)
  const getWoodCount = (): number => {
    if (!connection || !itemDefinitions || !connection.identity) return 0;
    
    const localPlayerIdentity = connection.identity;
    
    // Find Wood item definition
    let woodDefId: bigint | null = null;
    for (const def of itemDefinitions.values()) {
      if (def.name === 'Wood') {
        woodDefId = def.id;
        break;
      }
    }
    
    if (!woodDefId) return 0;
    
    // Sum up all wood items (inventory + hotbar - only local player's items)
    let total = 0;
    for (const item of inventoryItems.values()) {
      // Only count items in the local player's inventory or hotbar
      const isPlayerItem = (item.location.tag === 'Inventory' || item.location.tag === 'Hotbar') &&
                          item.location.value.ownerId && item.location.value.ownerId.isEqual(localPlayerIdentity);
      
      if (isPlayerItem && item.itemDefId === woodDefId) {
        total += item.quantity;
      }
    }
    
    return total;
  };

  const woodCount = getWoodCount();

  // Define building options
  // NOTE: Triangle Foundation is temporarily hidden until optimized
  const buildingOptions: BuildingOption[] = [
    {
      mode: BuildingMode.Foundation,
      name: 'Foundation',
      icon: faCube,
      description: 'Every house needs a foundation',
      requirements: { wood: 50 },
      available: woodCount >= 50,
      reason: woodCount < 50 ? `Need 50 wood (have ${woodCount})` : undefined,
    },
    // Triangle Foundation - temporarily disabled
    // {
    //   mode: BuildingMode.Foundation,
    //   name: 'Triangle Foundation',
    //   icon: faShapes,
    //   description: 'Triangular foundation piece',
    //   requirements: { wood: 25 },
    //   available: woodCount >= 25,
    //   reason: woodCount < 25 ? `Need 25 wood (have ${woodCount})` : undefined,
    //   isTriangle: true, // ADDED: Flag to indicate this is a triangle foundation
    // },
    {
      mode: BuildingMode.Wall,
      name: 'Wall',
      icon: faGripLinesVertical,
      description: 'Build walls between foundations',
      requirements: { wood: 15 }, // Wall cost: 15 wood
      available: woodCount >= 15,
      reason: woodCount < 15 ? `Need 15 wood (have ${woodCount})` : undefined,
    },
    {
      mode: BuildingMode.Fence,
      name: 'Fence',
      icon: faBorderAll,
      description: 'Build fences to protect crops and house animals',
      requirements: { wood: 15 }, // Fence cost: 15 wood (same as walls)
      available: woodCount >= 15,
      reason: woodCount < 15 ? `Need 15 wood (have ${woodCount})` : undefined,
    },
  ];

  // Calculate angle for each sector
  const getSectorAngles = (index: number, total: number) => {
    const sectorAngle = (2 * Math.PI) / total;
    const startAngle = (index * sectorAngle) - Math.PI / 2; // Start from top
    const endAngle = startAngle + sectorAngle;
    return { startAngle, endAngle, sectorAngle };
  };

  // Create SVG path for a pie slice sector
  const createSectorPath = (startAngle: number, endAngle: number, outerRadius: number, innerRadius: number): string => {
    const centerX = MENU_SIZE / 2;
    const centerY = MENU_SIZE / 2;

    // Outer arc
    const x1 = centerX + Math.cos(startAngle) * outerRadius;
    const y1 = centerY + Math.sin(startAngle) * outerRadius;
    const x2 = centerX + Math.cos(endAngle) * outerRadius;
    const y2 = centerY + Math.sin(endAngle) * outerRadius;

    // Inner arc
    const x3 = centerX + Math.cos(endAngle) * innerRadius;
    const y3 = centerY + Math.sin(endAngle) * innerRadius;
    const x4 = centerX + Math.cos(startAngle) * innerRadius;
    const y4 = centerY + Math.sin(startAngle) * innerRadius;

    const largeArcFlag = endAngle - startAngle > Math.PI ? 1 : 0;

    return [
      `M ${centerX} ${centerY}`, // Move to center
      `L ${x4} ${y4}`, // Line to inner start
      `A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 1 ${x3} ${y3}`, // Inner arc
      `L ${x2} ${y2}`, // Line to outer end
      `A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 0 ${x1} ${y1}`, // Outer arc
      `Z`, // Close path
    ].join(' ');
  };

  // Get the sector index from mouse position
  const getSectorFromMousePosition = (clientX: number, clientY: number): number | null => {
    if (!menuRef.current) return null;

    const rect = menuRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const clickX = clientX - centerX;
    const clickY = clientY - centerY;
    const distance = Math.sqrt(clickX * clickX + clickY * clickY);

    // Center area is no longer clickable for cancel
    // Check if clicked within the radial menu area
    if (distance >= INNER_RADIUS && distance <= RADIUS) {
      // Calculate angle
      const angle = Math.atan2(clickY, clickX);
      // Normalize angle to 0-2π and adjust for top start
      let normalizedAngle = angle + Math.PI / 2;
      if (normalizedAngle < 0) normalizedAngle += 2 * Math.PI;
      
      // Find which sector this angle corresponds to
      const sectorAngle = (2 * Math.PI) / buildingOptions.length;
      const index = Math.floor(normalizedAngle / sectorAngle);
      
      return index % buildingOptions.length;
    }

    return null; // Outside menu
  };

  // Get position for text/icon in the middle of a sector
  const getSectorCenterPosition = (index: number, total: number) => {
    const { startAngle, endAngle } = getSectorAngles(index, total);
    const midAngle = (startAngle + endAngle) / 2;
    const midRadius = (INNER_RADIUS + RADIUS) / 2;
    const centerX = MENU_SIZE / 2;
    const centerY = MENU_SIZE / 2;
    
    return {
      x: centerX + Math.cos(midAngle) * midRadius,
      y: centerY + Math.sin(midAngle) * midRadius,
      angle: midAngle,
    };
  };

  // Handle mouse release to select
  useEffect(() => {
    if (!isVisible) return;

    const handleMouseUp = (e: MouseEvent) => {
      if (!menuRef.current || isSelectingRef.current) return;
      
      // Only handle right mouse button release
      if (e.button !== 2) return;

      isSelectingRef.current = true;

      const sectorIndex = getSectorFromMousePosition(e.clientX, e.clientY);

      // Center click no longer cancels - only clicking outside does
      if (sectorIndex !== null && sectorIndex >= 0) {
        // Clicked on a sector
        const option = buildingOptions[sectorIndex];
        setSelectedIndex(sectorIndex);
        
        if (option.available) {
          // Small delay for visual feedback
          setTimeout(() => {
            if (option.isTriangle) {
              // Triangle foundation - pass TriNW as initial shape
              onSelect(option.mode, BuildingTier.Twig, FoundationShape.TriNW);
            } else {
              // Regular foundation or other building types
              onSelect(option.mode, BuildingTier.Twig);
            }
            isSelectingRef.current = false;
          }, 50);
        } else {
          // Option not available - play error sound and clear building selection
          playImmediateSound('error_resources', 1.0);
          setTimeout(() => {
            onCancel(); // This will clear building mode
            isSelectingRef.current = false;
          }, 50);
        }
      } else {
        // Clicked outside menu - clear building selection
        onCancel();
        isSelectingRef.current = false;
      }
    };

    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mouseup', handleMouseUp);
      isSelectingRef.current = false;
    };
  }, [isVisible, buildingOptions, onSelect, onCancel]);

  // Update hovered index based on mouse position
  useEffect(() => {
    if (!isVisible) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!menuRef.current) return;
      
      const sectorIndex = getSectorFromMousePosition(e.clientX, e.clientY);
      setHoveredIndex(sectorIndex);
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [isVisible]);

  if (!isVisible) return null;

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        left: mouseX - MENU_SIZE / 2,
        top: mouseY - MENU_SIZE / 2,
        width: MENU_SIZE,
        height: MENU_SIZE,
        pointerEvents: 'auto',
        zIndex: 10000,
        userSelect: 'none',
      }}
      onContextMenu={(e) => e.preventDefault()} // Prevent context menu
    >
      <svg
        ref={svgRef}
        width={MENU_SIZE}
        height={MENU_SIZE}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          pointerEvents: 'none',
        }}
      >
        {/* Cyberpunk glow effects */}
        <defs>
          <radialGradient id="cyberpunkGlow">
            <stop offset="0%" stopColor="rgba(0, 221, 255, 0.4)" />
            <stop offset="70%" stopColor="rgba(0, 150, 255, 0.1)" />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
          <linearGradient id="sectorHoverGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="rgba(0, 170, 255, 0.85)" />
            <stop offset="100%" stopColor="rgba(0, 100, 200, 0.9)" />
          </linearGradient>
          <linearGradient id="sectorNormalGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="rgba(20, 40, 80, 0.8)" />
            <stop offset="100%" stopColor="rgba(10, 30, 70, 0.9)" />
          </linearGradient>
          <linearGradient id="centerGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="rgba(30, 15, 50, 0.95)" />
            <stop offset="100%" stopColor="rgba(20, 10, 40, 0.98)" />
          </linearGradient>
          <filter id="cyberpunkGlowFilter">
            <feGaussianBlur stdDeviation="4" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Background circle with cyberpunk glow */}
        <circle
          cx={MENU_SIZE / 2}
          cy={MENU_SIZE / 2}
          r={RADIUS}
          fill="url(#cyberpunkGlow)"
          opacity="0.3"
        />

        {/* Render each sector */}
        {buildingOptions.map((option, index) => {
          const { startAngle, endAngle } = getSectorAngles(index, buildingOptions.length);
          const isHovered = hoveredIndex === index;
          const isSelected = selectedIndex === index;
          const isAvailable = option.available;
          
          const sectorPath = createSectorPath(startAngle, endAngle, RADIUS, INNER_RADIUS);

          return (
            <g key={index}>
              {/* Sector background */}
              <path
                d={sectorPath}
                fill={
                  isAvailable
                    ? isHovered || isSelected
                      ? 'url(#sectorHoverGradient)'
                      : 'url(#sectorNormalGradient)'
                    : 'rgba(80, 30, 30, 0.7)'
                }
                stroke={
                  isAvailable
                    ? isHovered || isSelected
                      ? '#00ffff'
                      : 'rgba(0, 170, 255, 0.5)'
                    : 'rgba(150, 60, 60, 0.6)'
                }
                strokeWidth={isHovered || isSelected ? 3 : 2}
                style={{
                  transition: 'all 0.15s ease',
                  filter: isHovered || isSelected ? 'url(#cyberpunkGlowFilter)' : 'none',
                  cursor: isAvailable ? 'pointer' : 'not-allowed',
                  pointerEvents: 'auto',
                }}
                opacity={isAvailable ? 1 : 0.7}
              />
            </g>
          );
        })}

        {/* Center circle - no cancel, just background */}
        <circle
          cx={MENU_SIZE / 2}
          cy={MENU_SIZE / 2}
          r={INNER_RADIUS}
          fill="url(#centerGradient)"
          stroke="#00ffff"
          strokeWidth={2}
          style={{
            transition: 'all 0.15s ease',
            pointerEvents: 'none',
          }}
        />
      </svg>

      {/* Text and icons overlay */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: MENU_SIZE,
          height: MENU_SIZE,
          pointerEvents: 'none',
        }}
      >
        {/* Center text - show selected option info */}
        {hoveredIndex !== null && hoveredIndex >= 0 && hoveredIndex < buildingOptions.length && (
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              textAlign: 'center',
              pointerEvents: 'none',
              width: INNER_RADIUS * 2.2, // Increased width for better text display
            }}
          >
            {/* Large icon */}
            <div style={{ marginBottom: '12px' }}>
              <FontAwesomeIcon
                icon={buildingOptions[hoveredIndex].icon}
                style={{
                  fontSize: '48px',
                  color: buildingOptions[hoveredIndex].available ? '#00ffff' : '#cc6666',
                  filter: buildingOptions[hoveredIndex].available 
                    ? 'drop-shadow(0 0 12px rgba(0, 255, 255, 0.8))' 
                    : 'drop-shadow(0 0 8px rgba(204, 102, 102, 0.6))',
                }}
              />
            </div>
            {/* Name */}
            <div
              style={{
                fontSize: '18px',
                fontFamily: '"Press Start 2P", cursive',
                color: '#ffffff',
                fontWeight: 'bold',
                textShadow: '0 0 10px rgba(0, 255, 255, 0.8), 0 0 20px rgba(0, 255, 255, 0.4)',
                marginBottom: '6px',
                lineHeight: '1.3',
              }}
            >
              {buildingOptions[hoveredIndex].name}
            </div>
            {/* Description */}
            <div
              style={{
                fontSize: '12px',
                fontFamily: '"Press Start 2P", cursive',
                color: '#6699cc',
                textShadow: '0 0 5px rgba(102, 153, 204, 0.6)',
                lineHeight: '1.4',
                marginBottom: '8px',
              }}
            >
              {buildingOptions[hoveredIndex].description}
            </div>
            {/* Cost */}
            {buildingOptions[hoveredIndex].requirements.wood && (
              <div
                style={{
                  fontSize: '11px',
                  fontFamily: '"Press Start 2P", cursive',
                  color: '#ffffff',
                  textShadow: '0 0 5px rgba(255, 255, 255, 0.6)',
                }}
              >
                {buildingOptions[hoveredIndex].requirements.wood} x Wood ({woodCount})
              </div>
            )}
          </div>
        )}

        {/* Sector labels and icons */}
        {buildingOptions.map((option, index) => {
          const pos = getSectorCenterPosition(index, buildingOptions.length);
          const isHovered = hoveredIndex === index;
          const isAvailable = option.available;

          return (
            <div
              key={index}
              style={{
                position: 'absolute',
                left: `${pos.x}px`,
                top: `${pos.y}px`,
                transform: `translate(-50%, -50%) ${isHovered ? 'scale(1.1)' : 'scale(1)'}`,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.15s ease',
                pointerEvents: 'none',
              }}
            >
              {/* Icon only - no text */}
              <div
                style={{
                  filter: isAvailable 
                    ? isHovered 
                      ? 'drop-shadow(0 0 12px rgba(0, 255, 255, 1))' 
                      : 'drop-shadow(0 0 6px rgba(0, 170, 255, 0.6))'
                    : 'drop-shadow(0 0 4px rgba(204, 102, 102, 0.5))',
                  transition: 'all 0.15s ease',
                }}
              >
                <FontAwesomeIcon
                  icon={option.icon}
                  style={{
                    fontSize: '32px',
                    color: isAvailable 
                      ? isHovered 
                        ? '#00ffff' 
                        : '#00aaff'
                      : '#cc6666',
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

