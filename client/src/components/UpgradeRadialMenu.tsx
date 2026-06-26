/**
 * Upgrade Radial Menu Component
 * 
 * Generic upgrade menu for any building tile type (foundations, walls, doors, etc.).
 * Shows a radial menu when right-clicking with Repair Hammer equipped on a building tile.
 * Allows selection of upgrade tiers (Wood, Stone, Metal) based on available resources.
 * Shows resource requirements and greys out unavailable options.
 * 
 * Styled with cyberpunk theme - cyan/blue colors, gradients, glows.
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { BuildingTier } from '../engine/runtime/buildingPlacementRuntime';
import { DbConnection } from '../generated';
import { InventoryItem, ItemDefinition, ActiveConsumableEffect } from '../generated/types';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faTree, 
  faMountain, 
  faCog, 
  faTrash,
  IconDefinition 
} from '@fortawesome/free-solid-svg-icons';
import { playImmediateSound } from '../hooks/useSoundSystem';

/**
 * Generic interface for any upgradable building tile
 */
export interface UpgradableBuildingTile {
  id: bigint;
  tier: number; // BuildingTier enum (0-3: Twig, Wood, Stone, Metal)
  isDestroyed?: boolean;
  // Optional: shape for cost multiplier (foundations have shape, walls don't)
  shape?: number; // FoundationShape enum (0-5)
  owner?: any; // Identity of the player who placed this tile
}

interface UpgradeRadialMenuProps {
  isVisible: boolean;
  mouseX: number;
  mouseY: number;
  connection: DbConnection | null;
  inventoryItems: Map<string, InventoryItem>;
  itemDefinitions: Map<string, ItemDefinition>;
  tile: UpgradableBuildingTile | null; // Generic building tile
  tileType: 'foundation' | 'wall' | 'door' | 'fence'; // Tile type for cost calculation
  onSelect: (tier: BuildingTier) => void;
  onCancel: () => void;
  onDestroy?: () => void; // Destroy callback (only shown for Twig tier, or always for fences)
  activeConsumableEffects?: Map<string, ActiveConsumableEffect>; // ADDED: For building privilege check
  localPlayerId?: string | null; // ADDED: Local player ID for privilege check
  homesteadHearths?: Map<string, any>; // ADDED: For checking if privilege is required (no hearths = free for all)
}

interface UpgradeOption {
  tier: BuildingTier;
  name: string;
  icon: IconDefinition;
  description: string;
  requirements: {
    wood?: number;
    stone?: number;
    metal?: number;
  };
  available: boolean;
  reason?: string;
}

const RADIUS = 260; // Outer radius of the radial menu (increased for better visibility)
const INNER_RADIUS = 160; // Inner radius (center area - increased to accommodate text)
const MENU_SIZE = RADIUS * 2;

/**
 * Calculate cost multiplier based on tile type and shape
 */
function getCostMultiplier(tileType: string, shape?: number): number {
  if (tileType === 'foundation') {
    // Foundations: full = 1.0, triangle = 0.5
    const isTriangle = shape !== undefined && shape >= 2 && shape <= 5;
    return isTriangle ? 0.5 : 1.0;
  }
  // Walls, doorframes, doors: always 1.0 (no shape multiplier)
  return 1.0;
}

/**
 * Get upgrade costs for a specific tier and tile type
 */
function getUpgradeCosts(tier: BuildingTier, tileType: string, multiplier: number): { wood?: number; stone?: number; metal?: number } {
  switch (tier) {
    case BuildingTier.Wood:
      // Wood tier costs depend on tile type
      if (tileType === 'wall' || tileType === 'fence') {
        return { wood: Math.ceil(20 * multiplier) };
      }
      // Foundation, door: 10 wood (reduced from 50 - minimal since aesthetic)
      return { wood: Math.ceil(10 * multiplier) };
    
    case BuildingTier.Stone:
      // Stone tier costs depend on tile type
      if (tileType === 'wall' || tileType === 'fence') {
        return { stone: Math.ceil(20 * multiplier) };
      }
      // Foundation, door: 20 stone (reduced from 100 - minimal since aesthetic)
      return { stone: Math.ceil(20 * multiplier) };
    
    case BuildingTier.Metal:
      // Metal tier costs depend on tile type
      if (tileType === 'wall' || tileType === 'fence') {
        return { metal: Math.ceil(20 * multiplier) };
      }
      // Foundation, door: 10 metal fragments (reduced from 50 - minimal since aesthetic)
      return { metal: Math.ceil(10 * multiplier) };
    
    default:
      return {};
  }
}

export const UpgradeRadialMenu: React.FC<UpgradeRadialMenuProps> = ({
  isVisible,
  mouseX,
  mouseY,
  connection,
  inventoryItems,
  itemDefinitions,
  tile,
  tileType,
  onSelect,
  onCancel,
  onDestroy,
  activeConsumableEffects,
  localPlayerId,
  homesteadHearths,
}) => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const isSelectingRef = useRef(false);

  // Check if any non-destroyed Homestead Hearths exist in the world
  const anyHearthsExist = useMemo(() => {
    if (!homesteadHearths) return false;
    return Array.from(homesteadHearths.values()).some((hearth) => !hearth.isDestroyed);
  }, [homesteadHearths]);

  // Check if player has building privilege
  // EARLY GAME: If no hearths exist, anyone can upgrade (free for all)
  // LATE GAME: Once hearths exist, require building privilege
  const hasBuildingPrivilege = useMemo(() => {
    // If no hearths exist, privilege is NOT required - allow anyone to upgrade
    if (!anyHearthsExist) return true;
    
    // Hearths exist - need to check for building privilege effect
    if (!activeConsumableEffects || !localPlayerId || !connection) return false;
    
    // Convert localPlayerId string to Identity for comparison
    const localPlayerIdentity = connection.identity;
    if (!localPlayerIdentity) return false;
    
    return Array.from(activeConsumableEffects.values()).some((effect) => {
      const effectTypeTag = effect.effectType ? (effect.effectType as any).tag : 'undefined';
      const effectPlayerId = effect.playerId;
      return effectTypeTag === 'BuildingPrivilege' && effectPlayerId && effectPlayerId.isEqual(localPlayerIdentity);
    });
  }, [anyHearthsExist, activeConsumableEffects, localPlayerId, connection]);

  // Get resource counts (from inventory and hotbar - only local player's items)
  const getResourceCount = (resourceName: string): number => {
    if (!connection || !itemDefinitions || !connection.identity) return 0;
    
    const localPlayerIdentity = connection.identity;
    
    let resourceDefId: bigint | null = null;
    for (const def of itemDefinitions.values()) {
      if (def.name === resourceName) {
        resourceDefId = def.id;
        break;
      }
    }
    
    if (!resourceDefId) return 0;
    
    let total = 0;
    for (const item of inventoryItems.values()) {
      // Only count items in the local player's inventory or hotbar
      const isPlayerItem = (item.location.tag === 'Inventory' || item.location.tag === 'Hotbar') &&
                          item.location.value.ownerId && item.location.value.ownerId.isEqual(localPlayerIdentity);
      
      if (isPlayerItem && item.itemDefId === resourceDefId) {
        total += item.quantity;
      }
    }
    
    return total;
  };

  const woodCount = getResourceCount('Wood');
  const stoneCount = getResourceCount('Stone');
  const metalCount = getResourceCount('Metal Fragments');

  // Determine current tier
  const currentTier = tile ? (tile.tier as BuildingTier) : BuildingTier.Twig;
  
  // Calculate cost multiplier based on tile type and shape
  const costMultiplier = getCostMultiplier(tileType, tile?.shape);

  // Check if player owns this tile (for destroy option)
  // Note: We check ownership but still show the option - server will validate
  const playerOwnsTile = useMemo(() => {
    if (!tile?.owner || !connection) return false;
    const localPlayerIdentity = connection.identity;
    if (!localPlayerIdentity) return false;
    try {
      return tile.owner && tile.owner.isEqual(localPlayerIdentity);
    } catch (e) {
      console.warn('[UpgradeRadialMenu] Error checking ownership:', e);
      return false;
    }
  }, [tile?.owner, connection]);

  // Define upgrade options (always show all 3 tiers for non-fences, grey out unavailable ones)
  const upgradeOptions: UpgradeOption[] = [];

  // Fences start at Wood tier, so the radial should reflect the current wood state
  // and the direct next upgrade path to Metal.
  if (tileType === 'fence') {
    const isFenceAtWoodTier = currentTier === BuildingTier.Wood;
    upgradeOptions.push({
      tier: BuildingTier.Wood,
      name: 'Wood',
      icon: faTree,
      description: isFenceAtWoodTier ? 'Current tier' : 'Lower than current tier',
      requirements: {},
      available: false,
      reason: isFenceAtWoodTier ? 'Already at current tier' : 'Already above this tier',
    });

    // Fences upgrade directly from Wood to Metal.
    const metalCosts = getUpgradeCosts(BuildingTier.Metal, tileType, costMultiplier);
    const requiredMetal = metalCosts.metal || 0;
    const hasResourcesForMetal = metalCount >= requiredMetal;
    const canUpgradeToMetal = currentTier < BuildingTier.Metal && hasBuildingPrivilege && hasResourcesForMetal;
    upgradeOptions.push({
      tier: BuildingTier.Metal,
      name: 'Metal',
      icon: faCog,
      description: 'Upgrade to metal tier',
      requirements: metalCosts,
      available: canUpgradeToMetal,
      reason: currentTier >= BuildingTier.Metal 
        ? 'Already at or above this tier' 
        : !hasBuildingPrivilege
          ? 'Building privilege required'
          : !hasResourcesForMetal
            ? `Need ${requiredMetal} metal fragments (have ${metalCount})` 
            : undefined,
    });

    // Destroy option for fences (always show)
    if (onDestroy) {
      upgradeOptions.push({
        tier: BuildingTier.Twig, // Not used for destroy
        name: 'Destroy',
        icon: faTrash,
        description: 'Destroy this fence',
        requirements: {},
        available: true, // Always available - server validates ownership
        reason: !playerOwnsTile ? 'You can only destroy fences you built' : undefined,
      });
    }
  } else {
    // Non-fence buildings - show upgrade tiers
    
    // Wood upgrade (Twig -> Wood)
    const woodCosts = getUpgradeCosts(BuildingTier.Wood, tileType, costMultiplier);
    const requiredWood = woodCosts.wood || 0;
    const hasResourcesForWood = woodCount >= requiredWood;
    const canUpgradeToWood = currentTier < BuildingTier.Wood && hasBuildingPrivilege && hasResourcesForWood;
    upgradeOptions.push({
      tier: BuildingTier.Wood,
      name: 'Wood',
      icon: faTree,
      description: 'Upgrade to wood tier',
      requirements: woodCosts,
      available: canUpgradeToWood,
      reason: currentTier >= BuildingTier.Wood 
        ? 'Already at or above this tier' 
        : !hasBuildingPrivilege
          ? 'Building privilege required'
          : !hasResourcesForWood
            ? `Need ${requiredWood} wood (have ${woodCount})` 
            : undefined,
    });

    // Stone upgrade (-> Stone)
    const stoneCosts = getUpgradeCosts(BuildingTier.Stone, tileType, costMultiplier);
    const requiredStone = stoneCosts.stone || 0;
    const hasResourcesForStone = stoneCount >= requiredStone;
    const canUpgradeToStone = currentTier < BuildingTier.Stone && hasBuildingPrivilege && hasResourcesForStone;
    upgradeOptions.push({
      tier: BuildingTier.Stone,
      name: 'Stone',
      icon: faMountain,
      description: 'Upgrade to stone tier',
      requirements: stoneCosts,
      available: canUpgradeToStone,
      reason: currentTier >= BuildingTier.Stone 
        ? 'Already at or above this tier' 
        : !hasBuildingPrivilege
          ? 'Building privilege required'
          : !hasResourcesForStone
            ? `Need ${requiredStone} stone (have ${stoneCount})` 
            : undefined,
    });

    // Metal upgrade (-> Metal)
    const metalCosts = getUpgradeCosts(BuildingTier.Metal, tileType, costMultiplier);
    const requiredMetal = metalCosts.metal || 0;
    const hasResourcesForMetal = metalCount >= requiredMetal;
    const canUpgradeToMetal = currentTier < BuildingTier.Metal && hasBuildingPrivilege && hasResourcesForMetal;
    upgradeOptions.push({
      tier: BuildingTier.Metal,
      name: 'Metal',
      icon: faCog,
      description: 'Upgrade to metal tier',
      requirements: metalCosts,
      available: canUpgradeToMetal,
      reason: currentTier >= BuildingTier.Metal 
        ? 'Already at or above this tier' 
        : !hasBuildingPrivilege
          ? 'Building privilege required'
          : !hasResourcesForMetal
            ? `Need ${requiredMetal} metal fragments (have ${metalCount})` 
            : undefined,
    });

    // Foundations can always be destroyed with the hammer. Other building pieces
    // keep their existing destroy gating.
    if ((tileType === 'foundation' || currentTier === BuildingTier.Twig) && onDestroy) {
      // PERFORMANCE FIX: Removed debug logging that ran every render frame
      
      upgradeOptions.push({
        tier: BuildingTier.Twig, // Not used for destroy
        name: 'Destroy',
        icon: faTrash,
        description: 'Destroy this building piece',
        requirements: {},
        available: true, // Always available - server validates ownership
        reason: !playerOwnsTile ? 'You can only destroy buildings you built' : undefined,
      });
    }
  }

  // Calculate total number of options for sector calculations
  const totalOptions = upgradeOptions.length;

  // Calculate angle for each sector
  const getSectorAngles = (index: number, total: number) => {
    const sectorAngle = (2 * Math.PI) / total;
    const startAngle = (index * sectorAngle) - Math.PI / 2;
    const endAngle = startAngle + sectorAngle;
    return { startAngle, endAngle, sectorAngle };
  };

  // Create SVG path for a pie slice sector
  const createSectorPath = (startAngle: number, endAngle: number, outerRadius: number, innerRadius: number): string => {
    const centerX = MENU_SIZE / 2;
    const centerY = MENU_SIZE / 2;

    const x1 = centerX + Math.cos(startAngle) * outerRadius;
    const y1 = centerY + Math.sin(startAngle) * outerRadius;
    const x2 = centerX + Math.cos(endAngle) * outerRadius;
    const y2 = centerY + Math.sin(endAngle) * outerRadius;

    const x3 = centerX + Math.cos(endAngle) * innerRadius;
    const y3 = centerY + Math.sin(endAngle) * innerRadius;
    const x4 = centerX + Math.cos(startAngle) * innerRadius;
    const y4 = centerY + Math.sin(startAngle) * innerRadius;

    const largeArcFlag = endAngle - startAngle > Math.PI ? 1 : 0;

    return [
      `M ${centerX} ${centerY}`,
      `L ${x4} ${y4}`,
      `A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 1 ${x3} ${y3}`,
      `L ${x2} ${y2}`,
      `A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 0 ${x1} ${y1}`,
      `Z`,
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
      const angle = Math.atan2(clickY, clickX);
      let normalizedAngle = angle + Math.PI / 2;
      if (normalizedAngle < 0) normalizedAngle += 2 * Math.PI;
      
      // Use dynamic number of sectors based on options (3 or 4)
      const sectorAngle = (2 * Math.PI) / upgradeOptions.length;
      const index = Math.floor(normalizedAngle / sectorAngle);
      
      return index % upgradeOptions.length;
    }

    return null;
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
      if (sectorIndex !== null && sectorIndex >= 0 && sectorIndex < upgradeOptions.length) {
        const option = upgradeOptions[sectorIndex];
        setSelectedIndex(sectorIndex);
        
        if (option.available) {
          setTimeout(() => {
            // Check if this is the destroy option
            if (option.name === 'Destroy' && onDestroy) {
              onDestroy();
            } else {
              onSelect(option.tier);
            }
            isSelectingRef.current = false;
          }, 50);
        } else {
          // Option not available - play appropriate error sound based on reason
          if (option.reason?.includes('Building privilege') || option.reason?.includes('building privilege')) {
            playImmediateSound('error_building_privilege', 1.0);
          } else if (option.reason?.includes('Already at or above this tier') || option.reason?.includes('already at')) {
            playImmediateSound('error_tier_upgrade', 1.0);
          } else {
            playImmediateSound('error_resources', 1.0);
          }
          setTimeout(() => {
            onCancel();
            isSelectingRef.current = false;
          }, 50);
        }
      } else {
        // Clicked outside menu - close it
        onCancel();
        isSelectingRef.current = false;
      }
    };

    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mouseup', handleMouseUp);
      isSelectingRef.current = false;
    };
  }, [isVisible, upgradeOptions, onSelect, onCancel, onDestroy]); // ADDED: onDestroy to deps

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
      onContextMenu={(e) => e.preventDefault()}
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
        <defs>
          <radialGradient id="upgradeCyberpunkGlow">
            <stop offset="0%" stopColor="rgba(0, 221, 255, 0.4)" />
            <stop offset="70%" stopColor="rgba(0, 150, 255, 0.1)" />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
          <linearGradient id="upgradeSectorHoverGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="rgba(0, 170, 255, 0.85)" />
            <stop offset="100%" stopColor="rgba(0, 100, 200, 0.9)" />
          </linearGradient>
          <linearGradient id="upgradeSectorNormalGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="rgba(20, 40, 80, 0.8)" />
            <stop offset="100%" stopColor="rgba(10, 30, 70, 0.9)" />
          </linearGradient>
          <linearGradient id="upgradeCenterGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="rgba(30, 15, 50, 0.95)" />
            <stop offset="100%" stopColor="rgba(20, 10, 40, 0.98)" />
          </linearGradient>
          <filter id="upgradeCyberpunkGlowFilter">
            <feGaussianBlur stdDeviation="4" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <circle
          cx={MENU_SIZE / 2}
          cy={MENU_SIZE / 2}
          r={RADIUS}
          fill="url(#upgradeCyberpunkGlow)"
          opacity="0.3"
        />

        {upgradeOptions.map((option, index) => {
          const { startAngle, endAngle } = getSectorAngles(index, upgradeOptions.length); // Use dynamic total
          const isHovered = hoveredIndex === index;
          const isSelected = selectedIndex === index;
          const isAvailable = option.available;
          
          const sectorPath = createSectorPath(startAngle, endAngle, RADIUS, INNER_RADIUS);

          return (
            <g key={index}>
              <path
                d={sectorPath}
                fill={
                  isAvailable
                    ? isHovered || isSelected
                      ? 'url(#upgradeSectorHoverGradient)'
                      : 'url(#upgradeSectorNormalGradient)'
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
                  filter: isHovered || isSelected ? 'url(#upgradeCyberpunkGlowFilter)' : 'none',
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
          fill="url(#upgradeCenterGradient)"
          stroke="#00ffff"
          strokeWidth={2}
          style={{
            transition: 'all 0.15s ease',
            pointerEvents: 'none',
          }}
        />
      </svg>

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
        {hoveredIndex !== null && hoveredIndex >= 0 && hoveredIndex < upgradeOptions.length && (
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
                icon={upgradeOptions[hoveredIndex].icon}
                style={{
                  fontSize: '48px',
                  color: upgradeOptions[hoveredIndex].available ? '#00ffff' : '#cc6666',
                  filter: upgradeOptions[hoveredIndex].available 
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
              {upgradeOptions[hoveredIndex].name}
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
              {upgradeOptions[hoveredIndex].description}
            </div>
            {/* Cost */}
            {upgradeOptions[hoveredIndex].requirements.wood && (
              <div
                style={{
                  fontSize: '11px',
                  fontFamily: '"Press Start 2P", cursive',
                  color: '#ffffff',
                  textShadow: '0 0 5px rgba(255, 255, 255, 0.6)',
                }}
              >
                {upgradeOptions[hoveredIndex].requirements.wood} x Wood ({woodCount})
              </div>
            )}
            {upgradeOptions[hoveredIndex].requirements.stone && (
              <div
                style={{
                  fontSize: '11px',
                  fontFamily: '"Press Start 2P", cursive',
                  color: '#ffffff',
                  textShadow: '0 0 5px rgba(255, 255, 255, 0.6)',
                }}
              >
                {upgradeOptions[hoveredIndex].requirements.stone} x Stone ({stoneCount})
              </div>
            )}
            {upgradeOptions[hoveredIndex].requirements.metal && (
              <div
                style={{
                  fontSize: '11px',
                  fontFamily: '"Press Start 2P", cursive',
                  color: '#ffffff',
                  textShadow: '0 0 5px rgba(255, 255, 255, 0.6)',
                }}
              >
                {upgradeOptions[hoveredIndex].requirements.metal} x Metal ({metalCount})
              </div>
            )}
          </div>
        )}

        {upgradeOptions.map((option, index) => {
          const pos = getSectorCenterPosition(index, upgradeOptions.length); // Use dynamic total
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

