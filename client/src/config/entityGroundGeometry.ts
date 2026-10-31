import collisionGeometry from '../../../shared/config/collisionGeometry.json';
import { combatCoverProfile } from './combatCover';

/** Shared existing client collision anchors. These preserve current prediction behavior;
 * server disagreements are recorded in docs/webgpu-migration.md, not corrected here.
 * Pure data only: the WebGPU renderer must not import the legacy sprite graph. */
// Collision offsets for sprite positioning - align with visual sprite base
// Exported for debug rendering
export const COLLISION_OFFSETS = {
  TREE: { x: 0, y: -68 },      // Adjusted to keep top boundary similar while squishing from bottom
  STONE: { x: 0, y: -36 },     // Small circle positioned at visual stone base (pushed down from -72)
  RUNE_STONE: { x: 0, y: -24 }, // Y offset for 48x48 AABB collision center (matches server-side)
  CAIRN: { x: 0, y: -24 },     // Y offset for 96x48 AABB collision center (matches server-side CAIRN_COLLISION_Y_OFFSET)
  STORAGE_BOX: { x: 0, y: -50 }, // Match small furnace collision offset (starts lower for better approach)
  RAIN_COLLECTOR: { x: 0, y: -30 }, // Pushed up to align with stone base (matches server offset of 0.0)
  // MONUMENT_RAIN_COLLECTOR removed - uses MONUMENT_BUILDING_COLLISION AABB instead
  FURNACE: { x: 0, y: -50 }, // Adjusted center to extend collision below while keeping top boundary
  LARGE_FURNACE: { x: 0, y: -80 }, // Matches server-side LARGE_FURNACE_COLLISION_Y_OFFSET (80.0)
  BARBECUE: { x: 0, y: 0 }, // Collision at posY (matches server-side BARBECUE_COLLISION_Y_OFFSET: 0.0)
  SHELTER: { x: 0, y: -200 },  // Shelter offset unchanged
  WILD_ANIMAL: { x: 0, y: 0 }, // No offset needed for animals
  BARREL: { x: 0, y: -48 }, // Barrel collision at visual center (matches server)
  ALK_STATION: { x: 0, y: -170 }, // ALK station collision offset - moved UP to center on building (allows walking behind for Y-sorting)
  SEA_STACK: { x: 0, y: -120 }, // Offset up to position collision higher on the structure
  HOMESTEAD_HEARTH: { x: 0, y: -72.5 }, // Homestead hearth collision offset (matches server-side HEARTH_COLLISION_Y_OFFSET)
  BASALT_COLUMN: { x: 0, y: -40 }, // Basalt column collision offset
  ROAD_LAMPPOST: { x: 0, y: -90 }, // Road lamppost collision base pushed up (128x192 sprite, pole center)
  WARD: { x: 0, y: -80 }, // Ward collision offset (matches server-side WARD_COLLISION_Y_OFFSET)
  TURRET: { x: 0, y: 70 }, // Turret collision at wooden base/platform - player-placed only; monument turrets use AABB
  // STORM_PILE removed - storms now spawn HarvestableResources and DroppedItems directly
  LIVING_CORAL: { x: 0, y: -60 }, // Living coral collision offset (doubled to match visual size)
} as const;

const TREE_COLLISION_VARIANT_OFFSETS: Record<string, { x: number; y: number }> = {
  // Rowanberry collision should sit a bit higher than the default tree anchor.
  RowanberryTree: { x: 0, y: -20 },
  // Twisted spruce trunk is visually left-biased.
  KrummholzSpruce: { x: -40, y: 0 },
};

export function getTreeCollisionOffset(tree: { treeType?: unknown }): { x: number; y: number } {
  const treeTypeKey = typeof tree.treeType === 'object' && tree.treeType !== null && 'tag' in tree.treeType
    ? String(tree.treeType.tag)
    : String(tree.treeType ?? '');
  const variantOffset = TREE_COLLISION_VARIANT_OFFSETS[treeTypeKey];
  if (!variantOffset) return COLLISION_OFFSETS.TREE;

  return {
    x: COLLISION_OFFSETS.TREE.x + variantOffset.x,
    y: COLLISION_OFFSETS.TREE.y + variantOffset.y,
  };
}

// Shelter AABB dimensions (must match server-side constants in shelter.rs)
// These are tuned to match the interior collision rectangle (black debug box)
// drawn in `shelterRenderingUtils.ts`, so what you see is exactly what you
// collide with as a non-owner.
// Exported for debug rendering
export const SHELTER_DIMS = {
  WIDTH: collisionGeometry.shelter.width,
  HEIGHT: collisionGeometry.shelter.height,
  HALF_WIDTH: collisionGeometry.shelter.width / 2,
  HALF_HEIGHT: collisionGeometry.shelter.height / 2,
  AABB_CENTER_Y_OFFSET_FROM_POS_Y: -collisionGeometry.shelter.centerOffsetY,
} as const;


/** Keep the existing water-barrel translation shared with prediction. */
export function getBarrelCollisionOffset(barrel: { variant?: number }, onSea = false): { x: number; y: number } {
  const variant = Number(barrel.variant ?? 0);
  if (combatCoverProfile(variant)) return { x: 0, y: 0 };
  if (variant === 6) return { x: 0, y: -110 };
  if (variant < 3 && onSea) return { x: 52, y: 0 };
  return { x: 0, y: COLLISION_OFFSETS.BARREL.y * (variant === 4 ? 2 : 1) };
}

export const MONUMENT_BUILDING_COLLISION = {
  WIDTH: 350,   // Same as ALK substations
  HEIGHT: 160,  // Same as ALK substations (480 / 3)
  // Y offset from entity posY to collision center
  // spriteBottom = posY + anchorOffset, then center at spriteBottom - height/2
  // Monument placeables (96px anchor): posY + 96 - 80 = posY + 16
  // ALK compound (0px anchor):         pushed up 60px from base (sprite at worldPosY)
  // Compound rain collector:           pushed up 60px from standard (16 - 60 = -44)
  CENTER_Y_OFFSET: 16,           // For monument placeables (96px anchor offset)
  ALK_CENTER_Y_OFFSET: -140,     // For ALK compound (0px anchor, pushed up 60px from -80)
  RAIN_COLLECTOR_CENTER_Y_OFFSET: -44,  // For compound rain collector (pushed up 60px from 16)
} as const;

