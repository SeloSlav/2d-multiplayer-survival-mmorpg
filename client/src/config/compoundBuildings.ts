// client/src/config/compoundBuildings.ts
// ------------------------------------
// Static compound building definitions for the central compound area.
// Buildings are positioned relative to the world center and rendered client-side.
// Server mirrors collision data for movement validation.
// ------------------------------------

import { gameConfig } from './gameConfig';
import { alkBuildingFootprint } from './alkGeometry';
import type { AlkBuildingAsset } from './alkGeometry';

function compoundFootprint(asset:AlkBuildingAsset) {
  const {width,height,y}=alkBuildingFootprint(asset,0,0);
  return {width,height,centerYOffset:y};
}

/**
 * Light source definition for buildings that emit light at night.
 * Light punches through the day/night overlay like a street lamp.
 */
export interface BuildingLightSource {
  /** Light radius in pixels */
  radius: number;
  /** 
   * X-offset from building center (default 0 = centered).
   * Positive = east, negative = west.
   */
  offsetX?: number;
  /** 
   * Y-offset from building anchor point.
   * Positive values move the light UP (toward top of sprite).
   */
  offsetY: number;
  /** 
   * Light color for atmospheric tint (optional).
   * Format: { r, g, b } with values 0-255.
   * If not provided, creates a pure cutout (white/neutral light).
   */
  color?: { r: number; g: number; b: number };
  /** 
   * Light intensity multiplier (default 1.0).
   * Higher values = brighter light that cuts through more darkness.
   */
  intensity?: number;
}

/**
 * Definition for a static compound building.
 * Each building has unique visual and collision properties.
 */
export interface CompoundBuilding {
  /** Unique identifier for this building */
  id: string;
  
  // === POSITION (relative to world center in pixels) ===
  /** X offset from world center (negative = west, positive = east) */
  offsetX: number;
  /** Y offset from world center (negative = north, positive = south) */
  offsetY: number;
  
  // === VISUAL PROPERTIES ===
  /** Image filename (loaded from assets/doodads/) */
  imagePath: string;
  /** Display width in pixels */
  width: number;
  /** Display height in pixels */
  height: number;
  /** 
   * Y-offset for the visual anchor point (pixels up from sprite bottom).
   * This determines where the building's "feet" are for Y-sorting.
   * Higher values = sprite is anchored lower on its image.
   */
  anchorYOffset: number;
  
  // === COLLISION ===
  /** Collision radius in pixels (used when collisionAabb is not set) */
  collisionRadius: number;
  /** 
   * Y-offset for collision center (pixels up from visual anchor).
   * Adjusts where the collision circle is positioned relative to the building.
   */
  collisionYOffset: number;
  /**
   * Optional AABB collision (like compound water facility).
   * When set, overrides circular collision with rectangular bounds.
   */
  collisionAabb?: {
    /** AABB width in pixels */
    width: number;
    /** AABB height in pixels */
    height: number;
    /** Y-offset from anchor to AABB center (positive = down) */
    centerYOffset: number;
  };
  
  // === MONUMENT CENTER (optional) ===
  /**
   * For monuments (shipwrecks, fishing villages): marks the center piece.
   * Used for building restriction overlay rendering.
   */
  isCenter?: boolean;
  
  // === ROTATION (optional) ===
  /**
   * Rotation in radians for monument parts with custom orientation.
   * Default 0 = no rotation.
   */
  rotationRad?: number;
  
  // === MONUMENT METADATA (optional, for monument parts only) ===
  monumentType?: string;
  partType?: string;
  
  // === LIGHT SOURCE (optional) ===
  /** 
   * Light source for buildings that emit light at night.
   * Only buildings with this property will have light cutouts rendered.
   */
  lightSource?: BuildingLightSource;
}

/**
 * Calculate the world center coordinates in pixels.
 * Buildings are positioned relative to this point.
 */
export function getWorldCenter(): { x: number; y: number } {
  return {
    x: (gameConfig.worldWidthTiles * gameConfig.tileSize) / 2,
    y: (gameConfig.worldHeightTiles * gameConfig.tileSize) / 2,
  };
}

/**
 * Check if a world position is within the central ALK compound area.
 * Used to distinguish compound-specific monument placeables (ALK images, larger sizes)
 * from regular monument placeables at other monuments (crashed drone, fishing village, etc.)
 * 
 * The compound asphalt area is roughly ±960px from center (20 tiles × 48px).
 * We use a generous radius to ensure all compound buildings are captured.
 */
const COMPOUND_RADIUS_SQ = 1100 * 1100; // Slightly larger than compound area for safety margin
export function isWithinCompound(posX: number, posY: number): boolean {
  const center = getWorldCenter();
  const dx = posX - center.x;
  const dy = posY - center.y;
  return (dx * dx + dy * dy) < COMPOUND_RADIUS_SQ;
}

/**
 * Check if a monument entity should use ALK compound-specific rendering.
 * Returns true only if the entity is both a monument AND within the central compound.
 * 
 * This is the key distinction: isMonument alone means "indestructible/non-pickupable",
 * but isCompoundMonument means "use ALK-specific images, sizes, and names".
 */
export function isCompoundMonument(isMonument: boolean, posX: number, posY: number): boolean {
  return isMonument && isWithinCompound(posX, posY);
}

/**
 * Get a building's absolute world position.
 * @param building - The building definition
 * @returns World coordinates { x, y } for the building's anchor point
 */
export function getBuildingWorldPosition(building: CompoundBuilding): { x: number; y: number } {
  const center = getWorldCenter();
  return {
    x: center.x + building.offsetX,
    y: center.y + building.offsetY,
  };
}

/**
 * Get a building's Y-sort position for depth ordering.
 * @param building - The building definition
 * @returns Y coordinate used for depth sorting
 */
export function getBuildingYSortPosition(building: CompoundBuilding): number {
  const worldPos = getBuildingWorldPosition(building);
  // Y-sort position is at the building's "feet" (anchor point)
  return worldPos.y;
}

/**
 * Static compound buildings array.
 * 
 * TO ADD A NEW BUILDING:
 * 1. Add your image to client/src/assets/doodads/
 * 2. Add an entry below with unique id and your desired properties
 * 3. Mirror the collision values (offsetX, offsetY, collisionRadius, collisionYOffset) 
 *    in server/src/compound_buildings.rs
 * 
 * COORDINATE SYSTEM:
 * - offsetX: negative = west of center, positive = east of center
 * - offsetY: negative = north of center, positive = south of center
 * - The central compound asphalt area is roughly ±960px from center (20 tiles × 48px)
 * 
 * IMAGE LOADING:
 * - Buildings without image files will show colored placeholder overlays with collision circles
 * - Yellow dot = anchor point (where building "feet" are for Y-sorting)
 * - Red dashed circle = collision radius
 * - Once image files are added to assets/doodads/, they will automatically display
 */
export const COMPOUND_BUILDINGS: CompoundBuilding[] = [
  // ===== GUARD POSTS (4 corners - symmetrically positioned) =====
  // Collision at anchor point (worldY) - where building visually touches ground
  // ===== ALL GUARD POSTS / STREETLIGHTS REMOVED =====
  // Replaced by compound eerie lights (COMPOUND_EERIE_LIGHTS below)
  // which render as nanobot-style blue/purple ambient glows at night.
  
  // ===== BARRACKS =====
  {
    id: 'barracks',
    offsetX: 450,
    offsetY: -300,
    imagePath: 'barracks.png',
    width: 480,
    height: 480,
    anchorYOffset: 96,
    collisionRadius: 0,
    collisionAabb: compoundFootprint('barracks'),
    collisionYOffset: 0,
  },
  
  // ===== FUEL DEPOT =====
  {
    id: 'fuel_depot',
    offsetX: 450,
    offsetY: 400,
    imagePath: 'fuel_depot.png',
    width: 480,
    height: 480,
    anchorYOffset: 96,
    collisionRadius: 0,
    collisionAabb: compoundFootprint('fuel_depot'),
    collisionYOffset: 0,
  },
  
  // ===== GARAGE ===== (north-west area of compound)
  {
    id: 'garage',
    offsetX: -350,
    offsetY: -680,
    imagePath: 'garage.png',
    width: 480,
    height: 480,
    anchorYOffset: 84,
    collisionRadius: 0,
    collisionAabb: compoundFootprint('garage'),
    collisionYOffset: 0,
  },
  
  // ===== UTILITY SHED ===== (north-east area, symmetric with garage)
  {
    id: 'shed',
    offsetX: 350,
    offsetY: -680,
    imagePath: 'shed.png',
    width: 384,
    height: 480,
    anchorYOffset: 84,
    collisionRadius: 0,
    collisionAabb: compoundFootprint('shed'),
    collisionYOffset: 0,
  },
  
  // ALK Food Processor and ALK Weapons Depot are NOT compound buildings.
  // They are monument placeables (WoodenStorageBox entities) that render themselves
  // at the larger 384x384 size, similar to the monument rain collector/large furnace pattern.
  
];

// ═══════════════════════════════════════════════════════════════════════════
// COMPOUND EERIE LIGHTS - Nanobot-style ambient lights (replaces street lamps)
// These render as eerie blue/purple glows similar to shipwreck Lagunov ghost lights.
// No physical structure - just floating light sources giving the compound an
// otherworldly, nanobot-infused atmosphere at night.
// ═══════════════════════════════════════════════════════════════════════════

export interface CompoundEerieLight {
  id: string;
  offsetX: number;   // Offset from world center
  offsetY: number;   // Offset from world center
  radius: number;    // Light cutout radius
  intensity: number; // Light intensity (0-1)
}

export const COMPOUND_EERIE_LIGHTS: CompoundEerieLight[] = [
  // Scattered organically around the compound - intentionally asymmetric and irregular
  // These provide localized glow hotspots on top of the large compound-wide cutout
  // Spread across the full ±960px compound area
  { id: 'eerie_01', offsetX: -700, offsetY: -750, radius: 180, intensity: 0.75 },
  { id: 'eerie_02', offsetX:  650, offsetY: -800, radius: 160, intensity: 0.70 },
  { id: 'eerie_03', offsetX: -800, offsetY:  700, radius: 170, intensity: 0.72 },
  { id: 'eerie_04', offsetX:  700, offsetY:  850, radius: 150, intensity: 0.68 },
  { id: 'eerie_05', offsetX: -200, offsetY:  500, radius: 140, intensity: 0.65 },
  { id: 'eerie_06', offsetX:  280, offsetY:  580, radius: 130, intensity: 0.62 },
  { id: 'eerie_07', offsetX: -150, offsetY:  100, radius: 150, intensity: 0.70 },
  { id: 'eerie_08', offsetX:  200, offsetY:  -50, radius: 140, intensity: 0.65 },
  { id: 'eerie_09', offsetX: -600, offsetY:   30, radius: 160, intensity: 0.72 },
  { id: 'eerie_10', offsetX:  520, offsetY:  120, radius: 150, intensity: 0.68 },
  { id: 'eerie_11', offsetX: -420, offsetY: -450, radius: 140, intensity: 0.65 },
  { id: 'eerie_12', offsetX:  350, offsetY: -530, radius: 135, intensity: 0.63 },
  { id: 'eerie_13', offsetX:   50, offsetY: -850, radius: 160, intensity: 0.70 },
  { id: 'eerie_14', offsetX:  -40, offsetY:  850, radius: 155, intensity: 0.68 },
  { id: 'eerie_15', offsetX: -850, offsetY: -200, radius: 145, intensity: 0.66 },
  { id: 'eerie_16', offsetX:  880, offsetY: -150, radius: 140, intensity: 0.64 },
];

let cachedCompoundEerieLightsWithPositions: Array<CompoundEerieLight & { worldX: number; worldY: number }> | null = null;

/**
 * Get compound eerie lights with world positions.
 */
export function getCompoundEerieLightsWithPositions(): Array<CompoundEerieLight & { worldX: number; worldY: number }> {
  if (cachedCompoundEerieLightsWithPositions) {
    return cachedCompoundEerieLightsWithPositions;
  }

  const center = getWorldCenter();
  cachedCompoundEerieLightsWithPositions = COMPOUND_EERIE_LIGHTS.map(light => ({
    ...light,
    worldX: center.x + light.offsetX,
    worldY: center.y + light.offsetY,
  }));
  return cachedCompoundEerieLightsWithPositions;
}

/**
 * Get all compound buildings with their calculated world positions.
 * Useful for rendering and filtering.
 */
export function getCompoundBuildingsWithPositions(): Array<CompoundBuilding & { worldX: number; worldY: number; ySortY: number }> {
  return COMPOUND_BUILDINGS.map(building => {
    const worldPos = getBuildingWorldPosition(building);
    return {
      ...building,
      worldX: worldPos.x,
      worldY: worldPos.y,
      ySortY: getBuildingYSortPosition(building),
    };
  });
}


/**
 * Size configuration for monument part types.
 * Maps partType to display dimensions (width, height).
 * All monument images are typically 1024x1024, scaled down for visual balance.
 */
const MONUMENT_PART_SIZES: Record<string, { width: number; height: number }> = {
  // Shipwreck parts (default size for ship parts)
  'hull': { width: 512, height: 512 },
  'bow': { width: 512, height: 512 },
  'stern': { width: 512, height: 512 },
  'mast': { width: 512, height: 512 },
  
  // Fishing Village parts
  'campfire': { width: 256, height: 256 },
  'hut': { width: 512, height: 512 },
  'dock': { width: 384, height: 384 },
  'fv_drying_rack': { width: 256, height: 256 },
  'kayak': { width: 320, height: 320 },
  
  // Whale Bone Graveyard parts
  'ribcage': { width: 640, height: 640 },
  'skull': { width: 480, height: 480 },
  'spine': { width: 512, height: 512 },
  'jawbone': { width: 384, height: 384 },
  'hermit_hut': { width: 400, height: 400 },
  
  // Hunting Village parts
  'lodge': { width: 512, height: 512 },
  'hv_drying_rack': { width: 256, height: 256 },
  'scarecrow': { width: 160, height: 160 }, // Monument scarecrow by the crops
  
  // Alpine Village: lodge uses 'lodge' key above; new buildings + scatter doodads
  'av_hut': { width: 384, height: 384 },
  'av_banya': { width: 384, height: 384 },
  'av_drying_rack': { width: 256, height: 256 },
  'av_weather_station_mast': { width: 384, height: 384 }, // Square dimensions (was 192x384)
  
  // Crashed Research Drone parts
  'drone': { width: 512, height: 512 },
  'skeleton': { width: 192, height: 192 }, // Tiny skeleton - dead researcher
  
  // Weather Station parts (ALPINE - main building + radar dishes)
  'station': { width: 640, height: 640 }, // Central operations building (ws_station.png)
  'radar': { width: 512, height: 512 }, // Radar dish outpost
  
  // Wolf Den parts (TUNDRA - wolf pack spawn point)
  'mound': { width: 384, height: 384 },
  
  // Hot Spring parts
  'shack': { width: 512, height: 512 }, // Increased from 384x384 to match huts/lodges
  
  // Default fallback
  'default': { width: 512, height: 512 },
};

/** Anchor Y-offset for monument parts - affects y-sorting (visual base). Drying racks share same offset for consistent layering. */
const MONUMENT_PART_ANCHOR_Y_OFFSETS: Record<string, number> = {
  'hv_drying_rack': 0,
  'fv_drying_rack': 0,
  'av_drying_rack': 0,
};

function getMonumentPartAnchorYOffset(partType: string): number {
  return MONUMENT_PART_ANCHOR_Y_OFFSETS[partType] ?? 0;
}

/**
 * Get the display size for a monument part based on its partType.
 * Falls back to default size if partType is not found.
 */
function getMonumentPartSize(partType: string): { width: number; height: number } {
  return MONUMENT_PART_SIZES[partType] || MONUMENT_PART_SIZES['default'];
}

/**
 * Monument part from database (unified format for all monument types).
 */
export interface MonumentPartData {
  id: bigint;
  worldX: number;
  worldY: number;
  imagePath: string;
  partType: string;
  isCenter: boolean;
  collisionRadius: number;
  monumentType: string; // Tag from MonumentType enum (e.g., 'Shipwreck', 'FishingVillage')
  rotationRad?: number; // Rotation in radians (for docks to face water)
}

/**
 * Convert ALL monument parts from database to compound building format in a single pass.
 * This is more efficient than filtering by type separately.
 * Handles: Shipwreck, FishingVillage, WhaleBoneGraveyard, HuntingVillage, and any future monuments.
 */
export function getMonumentBuildings(monumentParts: MonumentPartData[]): CompoundBuilding[] {
  const center = getWorldCenter();
  
  return monumentParts
    .filter(part => (part.imagePath && part.imagePath.length > 0) || part.isCenter) // Include center parts (e.g. weather station) for restriction overlay even when no image
    .map((part, index) => {
      // Calculate offset from world center (matching compound building pattern)
      const offsetX = part.worldX - center.x;
      const offsetY = part.worldY - center.y;
      
      // Get size based on part type
      const { width, height } = getMonumentPartSize(part.partType);
      
      // Generate unique ID based on monument type
      // Convert CamelCase to snake_case: WhaleBoneGraveyard -> whale_bone_graveyard
      // IMPORTANT: Insert underscores BEFORE converting to lowercase
      const idPrefix = part.monumentType.replace(/([A-Z])/g, '_$1').replace(/^_/, '').toLowerCase();
      
      return {
        id: `${idPrefix}_${part.id}_${index}`,
        imagePath: part.imagePath,
        offsetX,
        offsetY,
        width,
        height,
        anchorYOffset: getMonumentPartAnchorYOffset(part.partType),
        collisionRadius: part.collisionRadius,
        collisionYOffset: 0,
        isCenter: part.isCenter,
        rotationRad: part.rotationRad ?? 0,
        monumentType: part.monumentType,
        partType: part.partType,
      };
    });
}

/**
 * Get all compound buildings including static buildings and all monument parts.
 * Monument parts are processed in a single efficient pass.
 * This matches the compound buildings pattern: client-side rendering, server-side collision only.
 */
export function getAllCompoundBuildings(monumentParts?: MonumentPartData[]): CompoundBuilding[] {
  const staticBuildings = COMPOUND_BUILDINGS;
  const monumentBuildings = monumentParts ? getMonumentBuildings(monumentParts) : [];
  return [...staticBuildings, ...monumentBuildings];
}

