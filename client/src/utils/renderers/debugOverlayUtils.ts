/**
 * Debug Overlay Rendering Utilities
 * 
 * Consolidates all debug visualization rendering:
 * - Chunk boundaries
 * - Interior/building debug
 * - Collision shapes
 */

import { CollisionShape, COLLISION_OFFSETS, PLAYER_RADIUS } from '../clientCollision';
import { Player, Tree, Stone, RuneStone, Cairn, WoodenStorageBox, RainCollector, Furnace, Barbecue, Shelter, WildAnimal, Barrel, SeaStack, WallCell, FoundationCell, HomesteadHearth, BasaltColumn, Door, AlkStation, Campfire, Lantern, DroppedItem, HarvestableResource, PlayerCorpse, Stash, SleepingBag, PlantedSeed, BrothPot, AnimalCorpse, Fumarole, LivingCoral, Projectile } from '../../generated/types';
import type { YSortedEntityType, CompoundBuildingEntity } from '../../engine/runtime/entityFilteringRuntime';
import {
  NPC_PROJECTILE_SPECTRAL_BOLT,
  NPC_PROJECTILE_SPECTRAL_SHARD,
  NPC_PROJECTILE_VENOM_SPITTLE,
  PROJECTILE_GRAVITY,
  PROJECTILE_NPC_PLAYER_HIT_RADIUS,
  PROJECTILE_PLAYER_HIT_RADIUS,
  PROJECTILE_SOURCE_MONUMENT_TURRET,
  PROJECTILE_SOURCE_NPC,
  PROJECTILE_SOURCE_PLAYER,
  PROJECTILE_SOURCE_TURRET,
} from '../../config/projectileConstants';
import { sampleProjectileState } from '../projectileSampling';

// ===== TYPES =====

export interface ChunkBoundaryOptions {
  chunkSizePx: number;
  cameraOffsetX: number;
  cameraOffsetY: number;
  canvasWidth: number;
  canvasHeight: number;
}

export interface BuildingCluster {
  isEnclosed: boolean;
  cellCoords: Set<string>;
}

export interface InteriorDebugOptions {
  buildingClusters: Map<string, BuildingCluster>;
  playerBuildingClusterId: string | null;
  foundationTileSize: number;
}

export interface CollisionDebugEntities {
  trees: Map<string, Tree>;
  stones: Map<string, Stone>;
  runeStones: Map<string, RuneStone>;
  cairns: Map<string, Cairn>;
  boxes: Map<string, WoodenStorageBox>;
  rainCollectors: Map<string, RainCollector>;
  furnaces: Map<string, Furnace>;
  barbecues: Map<string, Barbecue>;
  shelters: Map<string, Shelter>;
  players: Map<string, Player>;
  wildAnimals: Map<string, WildAnimal>;
  barrels: Map<string, Barrel>;
  seaStacks: Map<string, SeaStack>;
  wallCells: Map<string, WallCell>;
  foundationCells: Map<string, FoundationCell>;
  homesteadHearths: Map<string, HomesteadHearth>;
  basaltColumns: Map<string, BasaltColumn>;
  doors: Map<string, Door>;
  alkStations: Map<string, AlkStation>;
}

export interface CollisionDebugOptions {
  playerX: number;
  playerY: number;
  localPlayerId: string;
  collisionShapes: CollisionShape[];
}

export interface YSortDebugOptions {
  playerX: number;
  playerY: number;
  ySortedEntities: YSortedEntityType[];
  viewMinX: number;
  viewMaxX: number;
  /** Local player identity (hex) - used to derive actual sort Y from ySortedEntities */
  localPlayerId?: string;
}

export interface ProjectileCollisionDebugOptions {
  projectiles: Map<string, Projectile>;
  playerX: number;
  playerY: number;
  currentTimeMs: number;
  /** When set, draw projectiles that intersect this world rect (expanded by margin) instead of only near the player. */
  viewBounds?: { minX: number; maxX: number; minY: number; maxY: number };
  /** Extra world px around viewBounds for projectile hit radii (default 400). */
  viewBoundsMargin?: number;
}

// ===== CHUNK BOUNDARIES =====

/**
 * Renders chunk boundary grid lines for debugging chunk-based systems
 */
export function renderChunkBoundaries(
  ctx: CanvasRenderingContext2D,
  options: ChunkBoundaryOptions
): void {
  const { chunkSizePx, cameraOffsetX, cameraOffsetY, canvasWidth, canvasHeight } = options;

  ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)'; // Black with transparency
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 5]); // Dashed line pattern

  // Calculate visible chunk range based on camera position
  const cameraWorldX = -cameraOffsetX;
  const cameraWorldY = -cameraOffsetY;
  const startChunkX = Math.floor((cameraWorldX - chunkSizePx) / chunkSizePx);
  const endChunkX = Math.ceil((cameraWorldX + canvasWidth + chunkSizePx) / chunkSizePx);
  const startChunkY = Math.floor((cameraWorldY - chunkSizePx) / chunkSizePx);
  const endChunkY = Math.ceil((cameraWorldY + canvasHeight + chunkSizePx) / chunkSizePx);

  // Draw vertical lines
  for (let chunkX = startChunkX; chunkX <= endChunkX; chunkX++) {
    const worldX = chunkX * chunkSizePx;
    ctx.beginPath();
    ctx.moveTo(worldX, startChunkY * chunkSizePx);
    ctx.lineTo(worldX, endChunkY * chunkSizePx);
    ctx.stroke();
  }

  // Draw horizontal lines
  for (let chunkY = startChunkY; chunkY <= endChunkY; chunkY++) {
    const worldY = chunkY * chunkSizePx;
    ctx.beginPath();
    ctx.moveTo(startChunkX * chunkSizePx, worldY);
    ctx.lineTo(endChunkX * chunkSizePx, worldY);
    ctx.stroke();
  }

  // Draw chunk coordinates at intersections (only for visible chunks)
  ctx.font = '12px monospace';
  ctx.fillStyle = 'rgba(0, 0, 0, 0.9)'; // Black for better visibility
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.setLineDash([]); // Reset dash pattern

  for (let chunkX = startChunkX; chunkX < endChunkX; chunkX++) {
    for (let chunkY = startChunkY; chunkY < endChunkY; chunkY++) {
      const worldX = chunkX * chunkSizePx + 5; // Offset from corner
      const worldY = chunkY * chunkSizePx + 5;
      ctx.fillText(`(${chunkX}, ${chunkY})`, worldX, worldY);
    }
  }

  ctx.setLineDash([]); // Reset dash pattern for other rendering
}

// ===== INTERIOR DEBUG =====

/**
 * Renders interior/building cluster debug visualization
 */
export function renderInteriorDebug(
  ctx: CanvasRenderingContext2D,
  options: InteriorDebugOptions
): void {
  const { buildingClusters, playerBuildingClusterId, foundationTileSize } = options;

  // Loop through all building clusters
  for (const [clusterId, cluster] of buildingClusters) {
    // Only render enclosed buildings
    if (!cluster.isEnclosed) continue;

    // Determine color based on whether player is inside this cluster
    const isPlayerInside = playerBuildingClusterId === clusterId;
    const fillColor = isPlayerInside
      ? 'rgba(0, 255, 136, 0.35)' // Green for player's current building
      : 'rgba(0, 212, 255, 0.25)'; // Cyan for other enclosed buildings
    const strokeColor = isPlayerInside
      ? 'rgba(0, 255, 136, 0.8)'
      : 'rgba(0, 212, 255, 0.6)';

    ctx.fillStyle = fillColor;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2;

    // Loop through all cells in the cluster
    for (const cellKey of cluster.cellCoords) {
      const [cellXStr, cellYStr] = cellKey.split(',');
      const cellX = parseInt(cellXStr, 10);
      const cellY = parseInt(cellYStr, 10);

      // Convert cell coordinates to world pixels
      const worldX = cellX * foundationTileSize;
      const worldY = cellY * foundationTileSize;

      // Draw filled rectangle
      ctx.fillRect(worldX, worldY, foundationTileSize, foundationTileSize);
      // Draw border for visibility
      ctx.strokeRect(worldX, worldY, foundationTileSize, foundationTileSize);
    }

    // Draw cluster info label at the first cell of each cluster
    const firstCellKey = cluster.cellCoords.values().next().value;
    if (firstCellKey) {
      const [firstCellXStr, firstCellYStr] = firstCellKey.split(',');
      const labelX = parseInt(firstCellXStr, 10) * foundationTileSize + 4;
      const labelY = parseInt(firstCellYStr, 10) * foundationTileSize + 16;

      ctx.font = '10px monospace';
      ctx.fillStyle = isPlayerInside ? 'rgba(0, 255, 136, 1)' : 'rgba(0, 212, 255, 1)';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      const label = isPlayerInside ? 'INSIDE' : 'ENCLOSED';
      ctx.fillText(label, labelX, labelY);
    }
  }
}

// ===== COLLISION DEBUG =====

/**
 * Gets color configuration for a collision shape type
 */
function getShapeColors(shapeType: string): { fillColor: string; strokeColor: string } {
  const fillAlpha = 0.15;
  const strokeAlpha = 0.8;
  
  // Default magenta
  let fillColor = `rgba(255, 0, 128, ${fillAlpha})`;
  let strokeColor = `rgba(255, 0, 128, ${strokeAlpha})`;

  // Different colors for different entity types
  if (shapeType.startsWith('player-')) {
    fillColor = `rgba(0, 255, 255, ${fillAlpha})`; // Cyan for players
    strokeColor = `rgba(0, 255, 255, ${strokeAlpha})`;
  } else if (shapeType.startsWith('tree-')) {
    fillColor = `rgba(0, 255, 0, ${fillAlpha})`; // Green for trees
    strokeColor = `rgba(0, 255, 0, ${strokeAlpha})`;
  } else if (shapeType.startsWith('stone-') || shapeType.startsWith('runeStone-') || shapeType.startsWith('basalt_column-')) {
    fillColor = `rgba(128, 128, 128, ${fillAlpha})`; // Gray for stones
    strokeColor = `rgba(160, 160, 160, ${strokeAlpha})`;
  } else if (shapeType.startsWith('cairn-')) {
    fillColor = `rgba(200, 150, 100, ${fillAlpha})`; // Brown for cairns
    strokeColor = `rgba(200, 150, 100, ${strokeAlpha})`;
  } else if (shapeType.startsWith('animal-')) {
    fillColor = `rgba(255, 165, 0, ${fillAlpha})`; // Orange for animals
    strokeColor = `rgba(255, 165, 0, ${strokeAlpha})`;
  } else if (shapeType.startsWith('animal_corpse-')) {
    fillColor = `rgba(255, 99, 71, ${fillAlpha})`; // Tomato for animal corpses
    strokeColor = `rgba(255, 99, 71, ${strokeAlpha})`;
  } else if (shapeType.startsWith('wall-') || shapeType.startsWith('door-')) {
    fillColor = `rgba(139, 69, 19, ${fillAlpha})`; // Saddle brown for walls/doors
    strokeColor = `rgba(139, 69, 19, ${strokeAlpha})`;
  } else if (shapeType.startsWith('shelter-')) {
    fillColor = `rgba(70, 130, 180, ${fillAlpha})`; // Steel blue for shelters
    strokeColor = `rgba(70, 130, 180, ${strokeAlpha})`;
  } else if (shapeType.startsWith('compound_building-')) {
    fillColor = `rgba(255, 215, 0, ${fillAlpha})`; // Gold for compound buildings
    strokeColor = `rgba(255, 215, 0, ${strokeAlpha})`;
  } else if (shapeType.startsWith('alk_station-')) {
    fillColor = `rgba(138, 43, 226, ${fillAlpha})`; // Blue violet for ALK stations
    strokeColor = `rgba(138, 43, 226, ${strokeAlpha})`;
  } else if (shapeType.startsWith('living_coral-')) {
    fillColor = `rgba(255, 127, 200, ${fillAlpha})`; // Pink for living coral (underwater)
    strokeColor = `rgba(255, 127, 200, ${strokeAlpha})`;
  }

  return { fillColor, strokeColor };
}

/**
 * Gets offset info string for entity type label
 */
function getOffsetInfo(type: string): string {
  const typeUpper = type.toUpperCase();
  if (typeUpper === 'TREE') return `off:(variant/default)`;
  if (typeUpper === 'STONE') return `off:(${COLLISION_OFFSETS.STONE.x},${COLLISION_OFFSETS.STONE.y})`;
  if (typeUpper === 'RUNESTONE') return `off:(${COLLISION_OFFSETS.RUNE_STONE.x},${COLLISION_OFFSETS.RUNE_STONE.y})`;
  if (typeUpper === 'CAIRN') return `off:(${COLLISION_OFFSETS.CAIRN.x},${COLLISION_OFFSETS.CAIRN.y})`;
  if (typeUpper === 'BOX') return `off:(${COLLISION_OFFSETS.STORAGE_BOX.x},${COLLISION_OFFSETS.STORAGE_BOX.y})`;
  if (typeUpper === 'RAIN_COLLECTOR') return `off:(${COLLISION_OFFSETS.RAIN_COLLECTOR.x},${COLLISION_OFFSETS.RAIN_COLLECTOR.y})`;
  if (typeUpper === 'FURNACE') return `off:(${COLLISION_OFFSETS.FURNACE.x},${COLLISION_OFFSETS.FURNACE.y})`;
  if (typeUpper === 'BARBECUE') return `off:(0,0)`;
  if (typeUpper === 'SHELTER') return `off:(${COLLISION_OFFSETS.SHELTER.x},${COLLISION_OFFSETS.SHELTER.y})`;
  if (typeUpper === 'ANIMAL') return `off:(${COLLISION_OFFSETS.WILD_ANIMAL.x},${COLLISION_OFFSETS.WILD_ANIMAL.y})`;
  if (typeUpper === 'ANIMAL_CORPSE') return `off:(0,0)`;
  if (typeUpper === 'BARREL') return `off:(dynamic sea-aware)`;
  if (typeUpper === 'ALK_STATION') return `off:(${COLLISION_OFFSETS.ALK_STATION.x},${COLLISION_OFFSETS.ALK_STATION.y})`;
  if (typeUpper === 'SEA_STACK') return `off:(${COLLISION_OFFSETS.SEA_STACK.x},${COLLISION_OFFSETS.SEA_STACK.y})`;
  if (typeUpper === 'HOMESTEAD_HEARTH' || typeUpper === 'HEARTH') return `off:(${COLLISION_OFFSETS.HOMESTEAD_HEARTH.x},${COLLISION_OFFSETS.HOMESTEAD_HEARTH.y})`;
  if (typeUpper === 'BASALT_COLUMN') return `off:(${COLLISION_OFFSETS.BASALT_COLUMN.x},${COLLISION_OFFSETS.BASALT_COLUMN.y})`;
  if (typeUpper === 'LIVING_CORAL') return `off:(${COLLISION_OFFSETS.LIVING_CORAL.x},${COLLISION_OFFSETS.LIVING_CORAL.y})`;
  return 'off:(0,0)';
}

/**
 * Draws a debug label with black background
 */
function drawDebugLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): void {
  ctx.font = 'bold 12px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  // Measure text for background
  const metrics = ctx.measureText(text);
  const padding = 4;
  const bgWidth = metrics.width + padding * 2;
  const bgHeight = 16;

  // Draw black background
  ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
  ctx.fillRect(x - bgWidth / 2, y, bgWidth, bgHeight);

  // Draw white text
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, x, y + 2);
}

/**
 * Renders collision shapes debug visualization
 */
export function renderCollisionDebug(
  ctx: CanvasRenderingContext2D,
  options: CollisionDebugOptions
): void {
  const { playerX, playerY, collisionShapes } = options;

  // Render each collision shape
  for (const shape of collisionShapes) {
    const { fillColor, strokeColor } = getShapeColors(shape.type);
    
    ctx.fillStyle = fillColor;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2;

    // Extract entity type for label (remove ID suffix)
    const entityType = shape.type.split('-')[0];

    if (shape.radius !== undefined) {
      // Render circle collision
      ctx.beginPath();
      ctx.arc(shape.x, shape.y, shape.radius, 0, Math.PI * 2);
      ctx.fillStyle = fillColor;
      ctx.fill();
      ctx.strokeStyle = strokeColor;
      ctx.stroke();

      // Draw center point
      ctx.fillStyle = strokeColor;
      ctx.beginPath();
      ctx.arc(shape.x, shape.y, 4, 0, Math.PI * 2);
      ctx.fill();

      // Draw entity type label with radius and offset info
      const labelY = shape.y + shape.radius + 6;
      drawDebugLabel(ctx, `${entityType}`, shape.x, labelY);
      drawDebugLabel(ctx, `r:${shape.radius} ${getOffsetInfo(entityType)}`, shape.x, labelY + 18);
    } else if (shape.width !== undefined && shape.height !== undefined) {
      // Render AABB (rectangle) collision
      const halfWidth = shape.width / 2;
      const halfHeight = shape.height / 2;
      ctx.fillStyle = fillColor;
      ctx.fillRect(shape.x - halfWidth, shape.y - halfHeight, shape.width, shape.height);
      ctx.strokeStyle = strokeColor;
      ctx.strokeRect(shape.x - halfWidth, shape.y - halfHeight, shape.width, shape.height);

      // Draw center point
      ctx.fillStyle = strokeColor;
      ctx.beginPath();
      ctx.arc(shape.x, shape.y, 4, 0, Math.PI * 2);
      ctx.fill();

      // Draw entity type label with dimensions and offset info
      const labelY = shape.y + halfHeight + 6;
      drawDebugLabel(ctx, `${entityType}`, shape.x, labelY);
      drawDebugLabel(ctx, `${shape.width}x${shape.height} ${getOffsetInfo(entityType)}`, shape.x, labelY + 18);
    } else if (shape.lineStartX !== undefined && shape.lineStartY !== undefined &&
               shape.lineEndX !== undefined && shape.lineEndY !== undefined) {
      // Render line segment collision (for diagonal walls)
      ctx.beginPath();
      ctx.moveTo(shape.lineStartX, shape.lineStartY);
      ctx.lineTo(shape.lineEndX, shape.lineEndY);
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = shape.lineThickness || 8;
      ctx.stroke();
      ctx.lineWidth = 2; // Reset
    }
  }

  // Also render the local player's collision circle
  ctx.fillStyle = 'rgba(255, 255, 0, 0.2)'; // Yellow for local player
  ctx.strokeStyle = 'rgba(255, 255, 0, 0.9)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(playerX, playerY, PLAYER_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Draw center crosshair for local player
  ctx.strokeStyle = 'rgba(255, 255, 0, 1)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(playerX - 10, playerY);
  ctx.lineTo(playerX + 10, playerY);
  ctx.moveTo(playerX, playerY - 10);
  ctx.lineTo(playerX, playerY + 10);
  ctx.stroke();

  // Draw simple player radius label
  ctx.font = 'bold 12px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const labelText = `Player r:${PLAYER_RADIUS}`;
  const metrics = ctx.measureText(labelText);
  const padding = 4;
  const labelX = playerX;
  const labelY = playerY + PLAYER_RADIUS + 6;

  // Draw black background
  ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
  ctx.fillRect(labelX - metrics.width / 2 - padding, labelY, metrics.width + padding * 2, 16);

  // Draw white text
  ctx.fillStyle = '#ffffff';
  ctx.fillText(labelText, labelX, labelY + 2);
}

// ===== Y-SORT DEBUG =====
// All Y-sort values come from _ySortKey on ySortedEntities (computed in EntityFilteringRuntime).
// No duplicate logic - debug overlay reflects actual sort data.

/**
 * Gets the entity's X position for drawing the line
 */
function getEntityX(item: YSortedEntityType): number {
  const { entity, type } = item;
  switch (type) {
    case 'player':
      return (entity as Player).positionX;
    case 'alk_station':
      return (entity as AlkStation).worldPosX;
    case 'compound_building':
    case 'monument_doodad':
      return (entity as CompoundBuildingEntity).worldX;
    case 'foundation_cell':
      return (entity as FoundationCell).cellX * 48 + 24;
    case 'wall_cell':
      return (entity as WallCell).cellX * 96 + 48;
    case 'door':
      return (entity as Door).cellX * 96 + 48;
    case 'grass':
      return (entity as any).serverPosX;
    case 'fog_overlay':
      return ((entity as any).bounds.minX + (entity as any).bounds.maxX) / 2;
    default:
      return (entity as any).posX ?? 0;
  }
}

/**
 * Gets the display width for the Y-sort line based on entity type
 */
function getEntityWidth(item: YSortedEntityType): number {
  switch (item.type) {
    case 'player': return 48;
    case 'tree': return 80;
    case 'stone': return 60;
    case 'rune_stone': return 80;
    case 'cairn': return 60;
    case 'wooden_storage_box': return 48;
    case 'shelter': return 120;
    case 'alk_station': return 160;
    case 'compound_building':
    case 'monument_doodad': return (item.entity as CompoundBuildingEntity).width;
    case 'wall_cell': return 96;
    case 'door': return 48;
    case 'foundation_cell': return 96;
    case 'sea_stack': return 100;
    case 'basalt_column': return 60;
    case 'furnace': return 48;
    case 'barbecue': return 48;
    case 'campfire': return 48;
    case 'lantern': return 24;
    case 'homestead_hearth': return 64;
    case 'barrel': return 40;
    case 'grass': return 24;
    case 'rain_collector': return 40;
    case 'broth_pot': return 36;
    case 'wild_animal': return 48;
    case 'fumarole': return 48;
    case 'living_coral': return 160; // Doubled coral size
    default: return 32;
  }
}

/**
 * Gets color for entity type Y-sort line
 */
function getYSortColor(type: string): string {
  switch (type) {
    case 'player': return '#ffff00'; // Yellow for players
    case 'tree': return '#00ff00'; // Green for trees
    case 'stone': return '#888888'; // Gray for stones
    case 'rune_stone': return '#aa88ff'; // Purple for rune stones
    case 'cairn': return '#c89664'; // Brown for cairns
    case 'shelter': return '#4682b4'; // Steel blue for shelters
    case 'alk_station': return '#8a2be2'; // Blue violet for ALK
    case 'compound_building': return '#ffd700'; // Gold for compounds
    case 'monument_doodad': return '#daa520'; // Goldenrod for monument doodads
    case 'wall_cell': return '#8b4513'; // Saddle brown for walls
    case 'door': return '#a0522d'; // Sienna for doors
    case 'foundation_cell': return '#696969'; // Dim gray for foundations
    case 'sea_stack': return '#708090'; // Slate gray
    case 'basalt_column': return '#36454f'; // Charcoal
    case 'wild_animal': return '#ffa500'; // Orange for animals
    case 'living_coral': return '#ff7fc8'; // Pink for underwater coral
    case 'barrel': return '#ff69b4'; // Hot pink for barrels/buoys
    case 'grass': return '#90ee90'; // Light green for grass
    default: return '#ff00ff'; // Magenta for unknown
  }
}

/**
 * Renders Y-sort debug lines showing where each entity's Y-sort threshold is
 * This draws a horizontal line at the Y position used for depth sorting
 */
export function renderYSortDebug(
  ctx: CanvasRenderingContext2D,
  options: YSortDebugOptions
): void {
  const { playerX, playerY, ySortedEntities, localPlayerId } = options;

  // Derive player sort Y from actual sort data - no manual/hardcoded values
  let playerYSort: number;
  const localPlayerEntry = localPlayerId && ySortedEntities.find(
    (item) => (item.type === 'player' || item.type === 'swimmingPlayerTopHalf') &&
      (item.entity as { identity?: { toHexString?: () => string } })?.identity?.toHexString?.() === localPlayerId
  );
  const keyed = localPlayerEntry as (typeof localPlayerEntry) & { _ySortKey?: number };
  if (keyed?._ySortKey != null && !isNaN(keyed._ySortKey)) {
    playerYSort = keyed._ySortKey;
  } else {
    playerYSort = playerY + 48 + 2.0; // Fallback only when local player not in sorted list
  }

  const lineExtent = 300;
  // Draw player's Y-sort line prominently
  ctx.strokeStyle = '#ffff00';
  ctx.lineWidth = 3;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(playerX - lineExtent, playerYSort);
  ctx.lineTo(playerX + lineExtent, playerYSort);
  ctx.stroke();

  // Draw label for player
  ctx.font = 'bold 11px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
  const playerLabel = `PLAYER Y-SORT: ${playerYSort.toFixed(1)}`;
  const playerLabelWidth = ctx.measureText(playerLabel).width;
  ctx.fillRect(playerX + lineExtent + 5, playerYSort - 14, playerLabelWidth + 8, 16);
  ctx.fillStyle = '#ffff00';
  ctx.fillText(playerLabel, playerX + lineExtent + 9, playerYSort - 1);

  // Draw Y-sort lines for nearby entities (within render distance of player)
  const maxDistanceFromPlayer = 400; // Only show lines for entities within this distance

  for (const item of ySortedEntities) {
    // Skip player (already drawn) and certain types that don't need lines
    if (item.type === 'player' || item.type === 'swimmingPlayerTopHalf' || item.type === 'projectile' || item.type === 'dropped_item' || item.type === 'fog_overlay') {
      continue;
    }

    const entityX = getEntityX(item);
    // Use actual _ySortKey from sort data - no manual/duplicate logic
    const entityYSort = (item as { _ySortKey?: number })._ySortKey;
    if (entityYSort == null || isNaN(entityYSort)) continue;

    // Skip if too far from player
    const dx = entityX - playerX;
    const dy = entityYSort - playerYSort;
    const distSq = dx * dx + dy * dy;
    if (distSq > maxDistanceFromPlayer * maxDistanceFromPlayer) continue;

    const entityWidth = getEntityWidth(item);
    const halfWidth = entityWidth / 2;
    const color = getYSortColor(item.type);

    // Draw the Y-sort line for this entity
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]); // Dashed line for entities
    ctx.beginPath();
    ctx.moveTo(entityX - halfWidth - 20, entityYSort);
    ctx.lineTo(entityX + halfWidth + 20, entityYSort);
    ctx.stroke();

    // Draw small vertical tick marks at entity edges
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(entityX - halfWidth, entityYSort - 5);
    ctx.lineTo(entityX - halfWidth, entityYSort + 5);
    ctx.moveTo(entityX + halfWidth, entityYSort - 5);
    ctx.lineTo(entityX + halfWidth, entityYSort + 5);
    ctx.stroke();

    // Draw small label
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    
    // Background for label
    const label = `${item.type.replace(/_/g, ' ')} Y:${entityYSort.toFixed(0)}`;
    const labelWidth = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(entityX - labelWidth / 2 - 2, entityYSort - 18, labelWidth + 4, 12);
    
    ctx.fillStyle = color;
    ctx.fillText(label, entityX, entityYSort - 7);
  }

  ctx.setLineDash([]);
}

// ===== PROJECTILE COLLISION DEBUG =====

/**
 * Gets the color for projectile debug rendering based on source type and NPC projectile type
 */
function getProjectileDebugColor(sourceType: number, npcProjectileType: number): { fillColor: string; strokeColor: string; hitRadiusColor: string } {
  if (sourceType === PROJECTILE_SOURCE_NPC) {
    // NPC projectiles - different colors for different types
    switch (npcProjectileType) {
      case NPC_PROJECTILE_SPECTRAL_SHARD:
        // Shardkin - blue/ice
        return {
          fillColor: 'rgba(100, 180, 255, 0.6)',
          strokeColor: 'rgba(100, 180, 255, 1)',
          hitRadiusColor: 'rgba(100, 180, 255, 0.15)'
        };
      case NPC_PROJECTILE_SPECTRAL_BOLT:
        // Shorebound - white/ghostly
        return {
          fillColor: 'rgba(200, 230, 255, 0.6)',
          strokeColor: 'rgba(200, 230, 255, 1)',
          hitRadiusColor: 'rgba(200, 230, 255, 0.15)'
        };
      case NPC_PROJECTILE_VENOM_SPITTLE:
        // Viper - green/toxic
        return {
          fillColor: 'rgba(100, 200, 50, 0.6)',
          strokeColor: 'rgba(100, 200, 50, 1)',
          hitRadiusColor: 'rgba(100, 200, 50, 0.15)'
        };
      default:
        // Unknown NPC projectile - red
        return {
          fillColor: 'rgba(255, 50, 50, 0.6)',
          strokeColor: 'rgba(255, 50, 50, 1)',
          hitRadiusColor: 'rgba(255, 50, 50, 0.15)'
        };
    }
  } else if (sourceType === PROJECTILE_SOURCE_TURRET || sourceType === PROJECTILE_SOURCE_MONUMENT_TURRET) {
    // Turret - orange/molten
    return {
      fillColor: 'rgba(255, 140, 0, 0.6)',
      strokeColor: 'rgba(255, 140, 0, 1)',
      hitRadiusColor: 'rgba(255, 140, 0, 0.15)'
    };
  } else {
    // Player projectile - yellow/gold
    return {
      fillColor: 'rgba(255, 215, 0, 0.6)',
      strokeColor: 'rgba(255, 215, 0, 1)',
      hitRadiusColor: 'rgba(255, 215, 0, 0.15)'
    };
  }
}

/**
 * Gets the label text for a projectile type
 */
function getProjectileLabel(sourceType: number, npcProjectileType: number): string {
  if (sourceType === PROJECTILE_SOURCE_NPC) {
    switch (npcProjectileType) {
      case NPC_PROJECTILE_SPECTRAL_SHARD:
        return 'Shardkin Shard';
      case NPC_PROJECTILE_SPECTRAL_BOLT:
        return 'Shorebound Bolt';
      case NPC_PROJECTILE_VENOM_SPITTLE:
        return 'Viper Venom';
      default:
        return 'NPC Projectile';
    }
  } else if (sourceType === PROJECTILE_SOURCE_TURRET) {
    return 'Turret Tallow';
  } else if (sourceType === PROJECTILE_SOURCE_MONUMENT_TURRET) {
    return 'Monument Turret';
  } else {
    return 'Player Projectile';
  }
}

/**
 * Renders projectile collision debug visualization
 * Shows projectile positions with their hit radius for collision detection
 */
export function renderProjectileCollisionDebug(
  ctx: CanvasRenderingContext2D,
  options: ProjectileCollisionDebugOptions
): void {
  const { projectiles, playerX, playerY, currentTimeMs, viewBounds, viewBoundsMargin = 400 } = options;

  // Render each projectile
  for (const [projectileId, projectile] of projectiles) {
    // Calculate elapsed time since projectile start
    const serverStartTimeMicros = Number(projectile.startTime.microsSinceUnixEpoch);
    const serverStartTimeMs = serverStartTimeMicros / 1000;
    const elapsedTimeMs = currentTimeMs - serverStartTimeMs;
    const elapsedTimeSeconds = Math.max(0, elapsedTimeMs / 1000);

    // Skip projectiles that are too old (probably stale data)
    if (elapsedTimeSeconds > 15) continue;

    const sampledState = sampleProjectileState(projectile, elapsedTimeSeconds);
    const currentX = sampledState.x;
    const currentY = sampledState.y;

    const distFromPlayer = Math.sqrt((currentX - playerX) ** 2 + (currentY - playerY) ** 2);
    if (viewBounds) {
      const m = viewBoundsMargin;
      if (
        currentX < viewBounds.minX - m ||
        currentX > viewBounds.maxX + m ||
        currentY < viewBounds.minY - m ||
        currentY > viewBounds.maxY + m
      ) {
        continue;
      }
    } else if (distFromPlayer > 800) {
      continue;
    }

    // Get colors based on projectile type
    const colors = getProjectileDebugColor(projectile.sourceType, projectile.npcProjectileType);
    
    // Determine hit radius based on projectile source type
    const hitRadius = projectile.sourceType === PROJECTILE_SOURCE_NPC 
      ? PROJECTILE_NPC_PLAYER_HIT_RADIUS
      : PROJECTILE_PLAYER_HIT_RADIUS;

    // Draw the hit radius circle (larger, faint circle showing collision area)
    ctx.fillStyle = colors.hitRadiusColor;
    ctx.strokeStyle = colors.strokeColor;
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 4]); // Dashed line for hit radius
    ctx.beginPath();
    ctx.arc(currentX, currentY, hitRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw the actual projectile position (small solid circle)
    ctx.fillStyle = colors.fillColor;
    ctx.strokeStyle = colors.strokeColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(currentX, currentY, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Draw center crosshair
    ctx.strokeStyle = colors.strokeColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(currentX - 12, currentY);
    ctx.lineTo(currentX + 12, currentY);
    ctx.moveTo(currentX, currentY - 12);
    ctx.lineTo(currentX, currentY + 12);
    ctx.stroke();

    // Draw velocity vector (direction line)
    const velocityMagnitude = Math.sqrt(projectile.velocityX ** 2 + projectile.velocityY ** 2);
    if (velocityMagnitude > 0) {
      const normalizedVx = projectile.velocityX / velocityMagnitude;
      const normalizedVy = projectile.velocityY / velocityMagnitude;
      const lineLength = 50;
      
      ctx.strokeStyle = colors.strokeColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(currentX, currentY);
      ctx.lineTo(currentX + normalizedVx * lineLength, currentY + normalizedVy * lineLength);
      ctx.stroke();
      
      // Draw arrowhead
      const arrowSize = 8;
      const endX = currentX + normalizedVx * lineLength;
      const endY = currentY + normalizedVy * lineLength;
      const angle = Math.atan2(normalizedVy, normalizedVx);
      
      ctx.beginPath();
      ctx.moveTo(endX, endY);
      ctx.lineTo(
        endX - arrowSize * Math.cos(angle - Math.PI / 6),
        endY - arrowSize * Math.sin(angle - Math.PI / 6)
      );
      ctx.lineTo(
        endX - arrowSize * Math.cos(angle + Math.PI / 6),
        endY - arrowSize * Math.sin(angle + Math.PI / 6)
      );
      ctx.closePath();
      ctx.fill();
    }

    // Draw label with type and hit radius info
    const label = getProjectileLabel(projectile.sourceType, projectile.npcProjectileType);
    const labelText = `${label} (r:${hitRadius})`;
    
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    
    // Measure text for background
    const metrics = ctx.measureText(labelText);
    const padding = 4;
    const labelX = currentX;
    const labelY = currentY + hitRadius + 8;
    
    // Draw black background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.fillRect(labelX - metrics.width / 2 - padding, labelY, metrics.width + padding * 2, 14);
    
    // Draw text with projectile color
    ctx.fillStyle = colors.strokeColor;
    ctx.fillText(labelText, labelX, labelY + 2);
    
    // Draw distance from player
    const distText = `dist: ${Math.round(distFromPlayer)}px`;
    const distMetrics = ctx.measureText(distText);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.fillRect(labelX - distMetrics.width / 2 - padding, labelY + 16, distMetrics.width + padding * 2, 14);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(distText, labelX, labelY + 18);
  }
}
