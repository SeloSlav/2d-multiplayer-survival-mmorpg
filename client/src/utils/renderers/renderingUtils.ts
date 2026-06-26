/**
 * renderingUtils - Y-sorted entity rendering and shared canvas utilities.
 *
 * This module is the main renderer for game entities, drawing them in correct depth order
 * (Y-sorting) so that entities overlap correctly (e.g., player behind a tree). It receives
 * pre-sorted entity arrays from EntityFilteringRuntime and renders each type via specialized
 * renderer modules (e.g., treeRenderingUtils, playerRenderingUtils).
 *
 * Responsibilities:
 * 1. RENDER Y-SORTED ENTITIES: Draws entities in Y-order—trees, stones, players, structures,
 *    walls, fog overlays, etc. Handles swimming split-render (top half above water, bottom
 *    half below) and batch rendering for performance.
 *
 * 2. SHARED UTILITIES: Caches (sprite coords, movement, dodge roll), object pools, and
 *    config used by render helpers. No direct SpacetimeDB subscriptions.
 *
 * 3. INTERACTION OUTLINES: Draws interaction outlines for closest interactable targets
 *    (doors, campfires, furnaces, animals, etc.) when passed from GameCanvas.
 */

import {
  Player as SpacetimeDBPlayer,
  Tree as SpacetimeDBTree,
  Stone as SpacetimeDBStone,
  RuneStone as SpacetimeDBRuneStone,
  WoodenStorageBox as SpacetimeDBWoodenStorageBox,
  SleepingBag as SpacetimeDBSleepingBag,
  ActiveConnection,
  ActiveEquipment as SpacetimeDBActiveEquipment,
  ItemDefinition as SpacetimeDBItemDefinition,
  InventoryItem as SpacetimeDBInventoryItem,
  Stash as SpacetimeDBStash,
  DroppedItem as SpacetimeDBDroppedItem,
  Campfire as SpacetimeDBCampfire,
  ActiveConsumableEffect,
  HarvestableResource as SpacetimeDBHarvestableResource,
  Grass as SpacetimeDBGrass,
  Projectile as SpacetimeDBProjectile,
  Shelter as SpacetimeDBShelter,
  PlayerDodgeRollState as SpacetimeDBPlayerDodgeRollState,
  PlantedSeed as SpacetimeDBPlantedSeed,
  RainCollector as SpacetimeDBRainCollector,
  WildAnimal as SpacetimeDBWildAnimal,
  AnimalCorpse as SpacetimeDBAnimalCorpse,
  FoundationCell as SpacetimeDBFoundationCell,
  WallCell as SpacetimeDBWallCell,
  Door as SpacetimeDBDoor,
  Fence as SpacetimeDBFence,
  HomesteadHearth as SpacetimeDBHomesteadHearth,
  BrothPot as SpacetimeDBBrothPot,
  Turret as SpacetimeDBTurret,
  Fumarole as SpacetimeDBFumarole,
  BasaltColumn as SpacetimeDBBasaltColumn,
  LivingCoral as SpacetimeDBLivingCoral,
  AlkStation as SpacetimeDBAlkStation,
  Cairn as SpacetimeDBCairn,
} from '../../generated/types';
import { DbConnection } from '../../generated';
import type { PlayerCorpse as SpacetimeDBPlayerCorpse } from '../../generated/types';
import { gameConfig, JUMP_DURATION_MS, JUMP_HEIGHT_PX } from '../../config/gameConfig';
import { COMPOUND_BUILDINGS, isCompoundMonument } from '../../config/compoundBuildings';
import type { CompoundBuildingEntity, YSortedEntityType } from '../../engine/runtime/entityFilteringRuntime';
import { InterpolatedGrassData } from '../../engine/runtime/grassInterpolationRuntime';

// --- Entity renderers ---
import { renderTree, renderTreeImpactEffects, renderTreeHitEffects } from './treeRenderingUtils';
import { renderStone, renderStoneDestructionEffects, renderStoneHitEffects } from './stoneRenderingUtils';
import { renderRuneStone } from './runeStoneRenderingUtils';
import { renderCairn } from './cairnRenderingUtils';
import { renderWoodenStorageBox, BOX_TYPE_COMPOST, BOX_TYPE_TANNING_RACK, BOX_TYPE_REFRIGERATOR, BOX_TYPE_REPAIR_BENCH, BOX_TYPE_COOKING_STATION, BOX_TYPE_SCARECROW, BOX_TYPE_MILITARY_RATION, BOX_TYPE_MILITARY_CRATE, BOX_TYPE_MINE_CART, BOX_TYPE_FISH_TRAP, BOX_TYPE_WILD_BEEHIVE, BOX_TYPE_PLAYER_BEEHIVE } from './woodenStorageBoxRenderingUtils';
import { renderEquippedItem, renderMeleeSwipeArcIfSwinging } from './equippedItemRenderingUtils';
import { renderPlayer, isPlayerHovered } from './playerRenderingUtils';
import { drawUnderwaterShadowOnly } from './swimmingEffectsUtils';
import { renderHarvestableResource } from './unifiedResourceRenderer';
import { renderPlantedSeed } from './plantedSeedRenderingUtils';
import { renderCampfire } from './campfireRenderingUtils';
import { renderFurnace } from './furnaceRenderingUtils';
import { renderBarbecue } from './barbecueRenderingUtils';
import { renderLantern, renderWardRadius, LANTERN_TYPE_LANTERN } from './lanternRenderingUtils';
import { renderTurret } from './turretRenderingUtils';
import { renderBrothPot } from './brothPotRenderingUtils';
import { renderFoundation, renderFogOverlay, renderFogOverlayCluster } from './foundationRenderingUtils';
import { renderWall, renderWallExteriorShadow, renderFence, buildFencePositionMap } from './foundationRenderingUtils';
import { renderDoor } from './doorRenderingUtils';
import { renderStash } from './stashRenderingUtils';
import { renderSleepingBag } from './sleepingBagRenderingUtils';
import { renderShelter } from './shelterRenderingUtils';
import { renderRainCollector } from './rainCollectorRenderingUtils';
import {
  renderWildAnimal,
  renderTamingThoughtBubbles,
  renderPregnancyIndicator,
  isWildAnimalOccludedWhenSnorkeling,
} from './wildAnimalRenderingUtils';
import type { CaribouBreedingData, WalrusBreedingData } from '../../generated/types';
import { renderAnimalCorpse, renderAnimalCorpseDestructionEffects } from './animalCorpseRenderingUtils';
import { renderPlayerCorpse, isCorpseHovered } from './playerCorpseRenderingUtils';
import { renderBarrel, renderBarrelDestructionEffects } from './barrelRenderingUtils';
import { renderRoadLamppost } from './roadLamppostRenderingUtils';
import { ENTITY_VISUAL_CONFIG, getInteractionOutlineParams } from '../entityVisualConfig';
import { renderFumarole } from './fumaroleRenderingUtils';
import { renderBasaltColumn } from './basaltColumnRenderingUtils';
import { renderLivingCoral, renderCoralDestructionEffects, renderCoralHitEffects } from './livingCoralRenderingUtils';
import { renderAlkStation } from './alkStationRenderingUtils';
import { renderMonument, getBuildingImage } from './monumentRenderingUtils';
import { renderBuildingRestrictionOverlay, renderMultipleBuildingRestrictionOverlays, BuildingRestrictionZoneConfig } from './buildingRestrictionOverlayUtils';
import {
  shouldShowBuildingRestrictionOverlay,
  getMonumentRestrictionRadius,
  buildLargeQuarryRestrictionZones,
  buildHotSpringRestrictionZones,
  buildSmallQuarryRestrictionZones,
} from './buildingRestrictionRulesUtils';
import { renderHealthBarOverlay } from './healthBarOverlayUtils';
import { renderSeaStackSingle } from './seaStackRenderingUtils';
import { renderHearth } from './hearthRenderingUtils';
import { renderGrass } from './grassRenderingUtils';
import { renderDroppedItem } from './droppedItemRenderingUtils';
import { renderProjectile, buildProjectileCollisionCircles, type ProjectileCollisionCircle } from './projectileRenderingUtils';

// --- Utilities ---
import { imageManager } from './imageManager';
const EMPTY_PROJECTILE_IMAGE = new Image();

import { getItemIcon } from '../itemIconUtils';
import { renderPlayerTorchLight, renderCampfireLight } from './lightRenderingUtils';
import { drawInteractionOutline, drawCircularInteractionOutline, getInteractionOutlineColor } from './outlineUtils';
import { drawDynamicGroundShadow } from './shadowUtils';
import { getTileTypeFromChunkData, worldPosToTileCoords } from './placementRenderingUtils';
import { updatePlayerFootprints } from './terrainTrailUtils';
import { isOceanTileTag, isWaterTileTag } from '../tileTypeGuards';

// Module-level caches
const playerDebugStateCache = new Map<string, { prevIsDead: boolean, prevLastHitTime: string | null }>();
const playerMovementCache = new Map<string, {
  lastMovementTime: number;
  isCurrentlyMoving: boolean;
  lastKnownPosition: { x: number; y: number } | null;
}>();
const playerRenderScratchCache = new Map<string, SpacetimeDBPlayer>();

function getPlayerRenderScratch(playerId: string, player: SpacetimeDBPlayer): SpacetimeDBPlayer {
  let scratch = playerRenderScratchCache.get(playerId);
  if (!scratch) {
    scratch = { ...player };
    playerRenderScratchCache.set(playerId, scratch);
    return scratch;
  }

  Object.assign(scratch, player);
  return scratch;
}

// Dodge roll visual effects cache
interface DodgeRollVisualState {
  startTime: number;
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  direction: string;
  ghostTrailPositions: Array<{ x: number, y: number, alpha: number, timestamp: number }>;
}

const dodgeRollVisualCache = new Map<string, DodgeRollVisualState>();

// Movement buffer duration - keep animation going for this long after movement stops
const MOVEMENT_BUFFER_MS = 150;
const REMOTE_DODGE_POSITION_BLEND = 0.8;

// --- MEMORY OPTIMIZATION: Object Pools ---
// Reduces garbage collection pressure by reusing objects instead of creating new ones

// Position object pool
const positionPool: Array<{ x: number; y: number }> = [];
const maxPoolSize = 100;

function getPooledPosition(x: number, y: number): { x: number; y: number } {
const pos = positionPool.pop() || { x: 0, y: 0 };
pos.x = x;
pos.y = y;
return pos;
}

function releasePooledPosition(pos: { x: number; y: number }): void {
if (positionPool.length < maxPoolSize) {
  positionPool.push(pos);
}
}

// Cached transform values to avoid recalculation
const transformCache = new Map<string, {
lastUpdate: number;
transforms: { x: number; y: number; rotation: number; scale: number };
}>();

// Render state cache to avoid object creation
const renderStateCache = {
lastViewportBounds: { minX: 0, maxX: 0, minY: 0, maxY: 0 },
lastCameraX: 0,
lastCameraY: 0,
lastFrameTime: 0,
boundsUpdateThreshold: 10, // Only update bounds if camera moved more than this
};

// PERFORMANCE: Cached sprite coordinate calculations
const spriteCoordCache = new Map<string, {
spriteCol: number;
spriteRow: number;
lastUpdate: number;
}>();

// PERFORMANCE: Reduce object creation in hot paths
function getCachedSpriteCoordinates(
playerId: string,
direction: string,
frameIndex: number,
isIdle: boolean
): { spriteCol: number; spriteRow: number } {
const cacheKey = `${playerId}_${direction}_${frameIndex}_${isIdle}`;
const cached = spriteCoordCache.get(cacheKey);

// Cache coordinates for 100ms to avoid recalculation
const now = performance.now();
if (cached && (now - cached.lastUpdate) < 100) {
  return { spriteCol: cached.spriteCol, spriteRow: cached.spriteRow };
}

// Calculate coordinates (original logic)
let spriteCol = 0;
let spriteRow = 0;

if (isIdle) {
  spriteCol = frameIndex % 4; // Cycle through 4 idle frames
  // Use direction to determine sprite row (maintain consistent facing)
  switch (direction) {
    case 'right': spriteRow = 0; break;
    case 'left': spriteRow = 1; break;
    case 'up': spriteRow = 2; break;
    case 'down': spriteRow = 3; break;
    default: spriteRow = 3; break;
  }
} else {
  spriteCol = frameIndex % 4; // Walking frames
  switch (direction) {
    case 'right': spriteRow = 4; break;
    case 'left': spriteRow = 5; break;
    case 'up': spriteRow = 6; break;
    case 'down': spriteRow = 7; break;
    default: spriteRow = 7; break;
  }
}

// Update cache
spriteCoordCache.set(cacheKey, {
  spriteCol,
  spriteRow,
  lastUpdate: now
});

return { spriteCol, spriteRow };
}

// PERFORMANCE: Optimize viewport bounds checking
function getOptimizedViewportBounds(
canvasWidth: number,
canvasHeight: number,
cameraX: number,
cameraY: number
): { minX: number; maxX: number; minY: number; maxY: number } {
// Check if we can reuse cached bounds
const deltaX = Math.abs(cameraX - renderStateCache.lastCameraX);
const deltaY = Math.abs(cameraY - renderStateCache.lastCameraY);

if (deltaX < renderStateCache.boundsUpdateThreshold && 
    deltaY < renderStateCache.boundsUpdateThreshold) {
  return renderStateCache.lastViewportBounds;
}

// Calculate new bounds
const buffer = 200; // Render buffer around viewport
const bounds = {
  minX: cameraX - canvasWidth / 2 - buffer,
  maxX: cameraX + canvasWidth / 2 + buffer,
  minY: cameraY - canvasHeight / 2 - buffer,
  maxY: cameraY + canvasHeight / 2 + buffer
};

// Update cache
renderStateCache.lastViewportBounds = bounds;
renderStateCache.lastCameraX = cameraX;
renderStateCache.lastCameraY = cameraY;

return bounds;
}

// PERFORMANCE: Reduce function call overhead in hot paths
function isEntityInViewportBounds(
entityX: number,
entityY: number,
bounds: { minX: number; maxX: number; minY: number; maxY: number }
): boolean {
return entityX >= bounds.minX && 
       entityX <= bounds.maxX && 
       entityY >= bounds.minY && 
       entityY <= bounds.maxY;
}

// PERFORMANCE: Cache frequently accessed player data
const playerDataCache = new Map<string, {
lastPosition: { x: number; y: number };
lastDirection: string;
lastUpdateTime: number;
isMoving: boolean;
}>();

// PERFORMANCE: Optimized player movement detection
function hasPlayerMoved(
playerId: string,
currentX: number,
currentY: number,
threshold: number = 1.0
): boolean {
const cached = playerDataCache.get(playerId);
if (!cached) {
  // First time seeing this player
  playerDataCache.set(playerId, {
    lastPosition: { x: currentX, y: currentY },
    lastDirection: 'down',
    lastUpdateTime: performance.now(),
    isMoving: false
  });
  return false;
}

const deltaX = Math.abs(currentX - cached.lastPosition.x);
const deltaY = Math.abs(currentY - cached.lastPosition.y);
const moved = deltaX > threshold || deltaY > threshold;

// Update cache
cached.lastPosition.x = currentX;
cached.lastPosition.y = currentY;
cached.lastUpdateTime = performance.now();
cached.isMoving = moved;

return moved;
}

// PERFORMANCE: Cleanup cached data periodically
let lastCleanupTime = 0;
const CLEANUP_INTERVAL = 10000; // 10 seconds

function cleanupCaches(): void {
const now = performance.now();
if (now - lastCleanupTime < CLEANUP_INTERVAL) {
  return;
}

// Clean up sprite coordinate cache
const spriteExpiration = 5000; // 5 seconds
for (const [key, value] of spriteCoordCache) {
  if (now - value.lastUpdate > spriteExpiration) {
    spriteCoordCache.delete(key);
  }
}

// Clean up player data cache
const playerExpiration = 30000; // 30 seconds
for (const [key, value] of playerDataCache) {
  if (now - value.lastUpdateTime > playerExpiration) {
    playerDataCache.delete(key);
  }
}

// Clean up transform cache
const transformExpiration = 15000; // 15 seconds
for (const [key, value] of transformCache) {
  if (now - value.lastUpdate > transformExpiration) {
    transformCache.delete(key);
  }
}

lastCleanupTime = now;
}

// Ghost trail constants
const GHOST_TRAIL_LENGTH = 8;
const GHOST_TRAIL_SPACING_MS = 15; // Add new ghost every 15ms
const GHOST_TRAIL_FADE_MS = 200; // Fade out over 200ms

// --- Client-side animation tracking ---
// Epoch-ms anchor for arc: optimistic press time (client) or server jump_start_time_ms (Unix).
const clientJumpStartTimes = new Map<string, number>();
const lastKnownServerJumpTimes = new Map<string, number>(); // playerId -> last known server timestamp

const renderCyberpunkPlayerPlaceholder = (
  ctx: CanvasRenderingContext2D,
  player: Pick<SpacetimeDBPlayer, 'positionX' | 'positionY' | 'direction'>,
  nowMs: number,
  jumpOffsetY: number = 0,
) => {
  const pulse = 0.55 + Math.sin(nowMs / 140) * 0.2;
  const x = player.positionX;
  const y = player.positionY - jumpOffsetY;

  ctx.save();
  ctx.shadowColor = 'rgba(0, 221, 255, 0.9)';
  ctx.shadowBlur = 12;
  ctx.strokeStyle = `rgba(0, 221, 255, ${pulse})`;
  ctx.fillStyle = 'rgba(8, 14, 32, 0.72)';
  ctx.lineWidth = 2;

  ctx.beginPath();
  ctx.ellipse(x, y + 18, 15, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.rect(x - 12, y - 22, 24, 36);
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255, 0, 255, 0.78)';
  ctx.beginPath();
  if (player.direction === 'up') {
    ctx.moveTo(x, y - 30);
    ctx.lineTo(x - 6, y - 18);
    ctx.lineTo(x + 6, y - 18);
  } else if (player.direction === 'left') {
    ctx.moveTo(x - 18, y - 4);
    ctx.lineTo(x - 6, y - 10);
    ctx.lineTo(x - 6, y + 2);
  } else if (player.direction === 'right') {
    ctx.moveTo(x + 18, y - 4);
    ctx.lineTo(x + 6, y - 10);
    ctx.lineTo(x + 6, y + 2);
  } else {
    ctx.moveTo(x, y + 20);
    ctx.lineTo(x - 6, y + 8);
    ctx.lineTo(x + 6, y + 8);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
};

interface RenderYSortedEntitiesProps {
  ctx: CanvasRenderingContext2D;
  ySortedEntities: YSortedEntityType[];
  heroImageRef: React.RefObject<HTMLImageElement | null>;
  heroWaterImageRef: React.RefObject<HTMLImageElement | null>;
  heroCrouchImageRef: React.RefObject<HTMLImageElement | null>;
  heroSprintImageRef: React.RefObject<HTMLImageElement | null>;
  heroIdleImageRef: React.RefObject<HTMLImageElement | null>;
  heroSwimImageRef?: React.RefObject<HTMLImageElement | null>; // Add swim sprite ref (optional)
  heroDodgeImageRef?: React.RefObject<HTMLImageElement | null>;
  lastPositionsRef: React.RefObject<Map<string, { x: number; y: number }>>;
  activeConnections: Map<string, ActiveConnection> | undefined;
  activeEquipments: Map<string, SpacetimeDBActiveEquipment>;
  activeConsumableEffects: Map<string, ActiveConsumableEffect>;
  itemDefinitions: Map<string, SpacetimeDBItemDefinition>;
  inventoryItems: Map<string, SpacetimeDBInventoryItem>; // Add inventory items for validation
  itemImagesRef: React.RefObject<Map<string, HTMLImageElement>>;
  doodadImagesRef: React.RefObject<Map<string, HTMLImageElement>>;
  shelterImage: HTMLImageElement | null;
  worldMouseX: number | null;
  worldMouseY: number | null;
  localPlayerId?: string;
  animationFrame: number;
  sprintAnimationFrame: number;
  idleAnimationFrame: number;
  nowMs: number;
  hoveredPlayerIds: Set<string>;
  onPlayerHover: (identity: string, hover: boolean) => void;
  cycleProgress: number;
  playerDodgeRollStates: Map<string, SpacetimeDBPlayerDodgeRollState>; // Add dodge roll states
  localPredictedDodgeRollVisualState?: { isDodgeRolling: boolean; progress: number; direction: string } | null;
  localOptimisticDodgeRollStartMs?: number;
  localOptimisticDodgeRollDurationMs?: number;
  /** Wall-clock ms when local player pressed jump (snapshot for this render batch). */
  localOptimisticJumpPressMs?: number;
  /** Cleared after merging server jump into client timeline (same frame as dodge ref pattern). */
  localOptimisticJumpPressMsRef?: { current: number };
  renderPlayerCorpse: (props: { 
      ctx: CanvasRenderingContext2D; 
      corpse: SpacetimeDBPlayerCorpse; 
      nowMs: number; 
      itemImagesRef: React.RefObject<Map<string, HTMLImageElement>>;
      heroImageRef: React.RefObject<HTMLImageElement | null>;
      heroWaterImageRef: React.RefObject<HTMLImageElement | null>;
      heroCrouchImageRef: React.RefObject<HTMLImageElement | null>;
      heroSwimImageRef: React.RefObject<HTMLImageElement | null>;
      isHovered?: boolean; // Whether this corpse is being hovered
  }) => void;
  localPlayerPosition?: { x: number; y: number } | null; // This is the predicted position
  remotePlayerInterpolation?: {
      updateAndGetSmoothedPosition: (player: any, localPlayerId?: string) => { x: number; y: number };
  };
  localPlayerIsCrouching?: boolean; // Local crouch state for immediate visual feedback
  // Closest interactable IDs for outline rendering
  closestInteractableCampfireId?: number | null;
  closestInteractableBoxId?: number | null;
  closestInteractableStashId?: number | null;
  closestInteractableSleepingBagId?: number | null;
  closestInteractableHarvestableResourceId?: bigint | null;
  closestInteractableDroppedItemId?: bigint | null;
  closestInteractableDoorId?: bigint | null;
  // New unified single target system (replaces individual resource IDs)
  closestInteractableTarget?: { type: string; id: bigint | number | string; position: { x: number; y: number }; distance: number; isEmpty?: boolean; } | null;
  shelterClippingData?: Array<{posX: number, posY: number, isDestroyed: boolean}>;
  localFacingDirection?: string;
  treeShadowsEnabled?: boolean;
  allShadowsEnabled?: boolean;
  isTreeFalling?: (treeId: string) => boolean;
  getFallProgress?: (treeId: string) => number;
  cameraOffsetX?: number;
  cameraOffsetY?: number;
  foundationTileImagesRef?: React.RefObject<Map<string, HTMLImageElement>>;
  allWalls?: Map<string, any>;
  allFoundations?: Map<string, any>;
  allFences?: any[];
  buildingClusters?: Map<string, any>;
  playerBuildingClusterId?: string | null;
  connection?: DbConnection | null;
  isLocalPlayerSnorkeling?: boolean;
  alwaysShowPlayerNames?: boolean;
  playerStats?: Map<string, any>;
  largeQuarries?: Map<string, any>;
  detectedHotSprings?: Array<{ id: string; posX: number; posY: number; radius: number }>;
  detectedQuarries?: Array<{ id: string; posX: number; posY: number; radius: number }>;
  placementInfo?: { itemDefId?: bigint; itemName?: string } | null;
  caribouBreedingData?: Map<string, CaribouBreedingData>;
  walrusBreedingData?: Map<string, WalrusBreedingData>;
  chunkWeather?: Map<string, { currentWeather?: { tag?: string } }>;
  /** When false, grass has no sway and animated beach grass uses strip frame 0 only. */
  grassAnimationEnabled?: boolean;
  seaTransitionTileLookup?: Map<string, boolean>; // Shore transition tiles (Beach/Sea, Beach/HotSpringWater, Asphalt/Sea): player renders as normal, not swimming
  waterTileLookup?: Map<string, boolean>; // Fast tile water lookup for immediate local land/sea sprite switching
  /** Collision circles for client-side projectile hit prediction (arrows stop at targets) */
  projectileCollisionCircles?: ProjectileCollisionCircle[];
  // Note: viewBounds for terrain footprints has been moved to GameCanvas.tsx
  // Footprints are now rendered once before any renderYSortedEntities calls
}

/**
* Renders entities that need to be sorted by their Y-coordinate for correct overlapping.
*/
export const renderYSortedEntities = ({
  ctx,
  ySortedEntities,
  heroImageRef,
  heroWaterImageRef,
  heroCrouchImageRef,
  heroSprintImageRef,
  heroIdleImageRef,
  heroSwimImageRef,
  heroDodgeImageRef,
  lastPositionsRef,
  activeConnections,
  activeEquipments,
  activeConsumableEffects,
  itemDefinitions,
  inventoryItems,
  itemImagesRef,
  doodadImagesRef,
  shelterImage,
  worldMouseX,
  worldMouseY,
  localPlayerId,
  animationFrame,
  sprintAnimationFrame,
  idleAnimationFrame,
  nowMs,
  hoveredPlayerIds,
  onPlayerHover,
  cycleProgress,
  playerDodgeRollStates,
  localPredictedDodgeRollVisualState = null,
  localOptimisticDodgeRollStartMs = 0,
  localOptimisticDodgeRollDurationMs = 500,
  localOptimisticJumpPressMs = 0,
  localOptimisticJumpPressMsRef,
  renderPlayerCorpse: renderCorpse,
  localPlayerPosition,
  remotePlayerInterpolation,
  localPlayerIsCrouching,
  // Closest interactable IDs for outline rendering
  closestInteractableCampfireId,
  closestInteractableBoxId,
  closestInteractableStashId,
  closestInteractableSleepingBagId,
  closestInteractableHarvestableResourceId,
  closestInteractableDroppedItemId,
  closestInteractableDoorId,
  // Unified target system (replaces individual resource IDs)
  closestInteractableTarget,
  shelterClippingData,
  localFacingDirection,
  treeShadowsEnabled = true,
  allShadowsEnabled = true,
  isTreeFalling,
  getFallProgress,
  cameraOffsetX = 0,
  cameraOffsetY = 0,
  foundationTileImagesRef,
  allWalls,
  allFoundations,
  allFences,
  buildingClusters,
  playerBuildingClusterId,
  connection,
  isLocalPlayerSnorkeling = false,
  alwaysShowPlayerNames = false,
  playerStats,
  largeQuarries,
  detectedHotSprings,
  detectedQuarries,
  placementInfo,
  caribouBreedingData,
  walrusBreedingData,
  chunkWeather,
  grassAnimationEnabled = true,
  seaTransitionTileLookup, // Sea transition tiles: player renders as normal, not swimming
  waterTileLookup, // Fast tile water lookup for immediate local land/sea sprite switching
  projectileCollisionCircles,
}: RenderYSortedEntitiesProps) => {
  // PERFORMANCE: Avoid calling cleanup function unless interval elapsed
  const nowForCleanup = performance.now();
  if (nowForCleanup - lastCleanupTime >= CLEANUP_INTERVAL) {
    cleanupCaches();
  }
  
  // Precompute mapping from foundation cell coordinates to building cluster IDs and enclosure status
  const cellCoordToClusterId = new Map<string, string>();
  const clusterEnclosureStatus = new Map<string, boolean>();
  if (buildingClusters) {
      buildingClusters.forEach((cluster, clusterId) => {
          if (cluster?.cellCoords) {
              cluster.cellCoords.forEach((coord: string) => {
                  cellCoordToClusterId.set(coord, clusterId);
              });
              // Store whether this cluster is enclosed
              clusterEnclosureStatus.set(clusterId, cluster.isEnclosed || false);
          }
      });
  }
  
  // Precompute entities used in later passes to avoid repeatedly scanning ySortedEntities
  const allEntranceWayFoundations = new Set<string>();
  const lanternEntities: any[] = [];
  const wallEntities: SpacetimeDBWallCell[] = [];
  const fogOverlayEntities: Array<{
    clusterId: string;
    bounds: { minX: number; minY: number; maxX: number; maxY: number };
    entranceWayFoundations?: string[];
    clusterFoundationCoords?: string[];
    northWallFoundations?: string[];
    southWallFoundations?: string[];
    entranceWayFoundationSet?: Set<string>;
    clusterFoundationCoordSet?: Set<string>;
    northWallFoundationSet?: Set<string>;
    southWallFoundationSet?: Set<string>;
  }> = [];
  const doorEntities: SpacetimeDBDoor[] = [];
  for (const { type, entity } of ySortedEntities) {
    if (type === 'lantern') {
      lanternEntities.push(entity);
      continue;
    }
    if (type === 'wall_cell') {
      wallEntities.push(entity as SpacetimeDBWallCell);
      continue;
    }
    if (type === 'fog_overlay') {
      const fogEntity = entity as {
        clusterId: string;
        bounds: { minX: number; minY: number; maxX: number; maxY: number };
        entranceWayFoundations?: string[];
        clusterFoundationCoords?: string[];
        northWallFoundations?: string[];
        southWallFoundations?: string[];
        entranceWayFoundationSet?: Set<string>;
        clusterFoundationCoordSet?: Set<string>;
        northWallFoundationSet?: Set<string>;
        southWallFoundationSet?: Set<string>;
      };
      const entranceWayFoundationSet = fogEntity.entranceWayFoundations ? new Set(fogEntity.entranceWayFoundations) : undefined;
      const clusterFoundationCoordSet = fogEntity.clusterFoundationCoords ? new Set(fogEntity.clusterFoundationCoords) : undefined;
      const northWallFoundationSet = fogEntity.northWallFoundations ? new Set(fogEntity.northWallFoundations) : undefined;
      const southWallFoundationSet = fogEntity.southWallFoundations ? new Set(fogEntity.southWallFoundations) : undefined;
      fogOverlayEntities.push(fogEntity);
      if (entranceWayFoundationSet) {
        for (const coord of entranceWayFoundationSet) {
          allEntranceWayFoundations.add(coord);
        }
      }
      fogEntity.entranceWayFoundationSet = entranceWayFoundationSet;
      fogEntity.clusterFoundationCoordSet = clusterFoundationCoordSet;
      fogEntity.northWallFoundationSet = northWallFoundationSet;
      fogEntity.southWallFoundationSet = southWallFoundationSet;
      continue;
    }
    if (type === 'door') {
      doorEntities.push(entity as SpacetimeDBDoor);
    }
  }
  
  // Build fence position map for smart sprite selection (neighbor detection)
  // This allows fences to show proper end caps, center pieces, and corners
  const fencePositionMap = allFences ? buildFencePositionMap(allFences) : new Map<string, any>();
  
  // PERF FIX: Pre-index activeConsumableEffects by player ID for O(1) lookup per player.
  // Without this, renderPlayer iterates ALL effects (potentially hundreds) for EACH rendered player,
  // costing O(N_players × N_effects) per frame. With the index, each player only sees its own effects.
  const effectsByPlayerId = new Map<string, Map<string, ActiveConsumableEffect>>();
  const EMPTY_EFFECTS_MAP = new Map<string, ActiveConsumableEffect>();
  if (activeConsumableEffects) {
    for (const [effectId, effect] of activeConsumableEffects) {
      // Index by initiator player ID
      const initiatorId = effect.playerId.toHexString();
      if (!effectsByPlayerId.has(initiatorId)) {
        effectsByPlayerId.set(initiatorId, new Map());
      }
      effectsByPlayerId.get(initiatorId)!.set(effectId, effect);
      
      // Also index by target player ID (for remote healing glow on the target)
      if (effect.targetPlayerId) {
        const targetId = effect.targetPlayerId.toHexString();
        if (!effectsByPlayerId.has(targetId)) {
          effectsByPlayerId.set(targetId, new Map());
        }
        effectsByPlayerId.get(targetId)!.set(effectId, effect);
      }
    }
  }
  
  // NOTE: Underwater shadows are now rendered separately in GameCanvas.tsx
  // before the water overlay, not here in renderYSortedEntities
  
  // RENDERING PASS ORDER:
  // Pass 1: All Y-sorted entities (players, trees, placeables, ALL walls including south)
  //         - Walls properly Y-sort with players/trees so entities south of walls render on top
  // Pass 2-4: North doors (before ceiling tiles)
  // Pass 5: Fog overlays / ceiling tiles (with exclusions for entrance ways and south walls)
  // Pass 6: South doors (after ceiling tiles)
  
  // Pre-Pass: Render ward deterrence radius circles BEHIND all entities
  // This shows players the safe zones created by wards (both active and inactive)
  for (const lantern of lanternEntities) {
    // Render radius for all wards (not regular lanterns) - both active and inactive states
    if (lantern.lanternType !== LANTERN_TYPE_LANTERN && !lantern.isDestroyed) {
      renderWardRadius(ctx, lantern, cycleProgress);
    }
  }
  
  // NOTE: Terrain footprints (snow/beach) are now rendered ONCE in GameCanvas.tsx before any
  // renderYSortedEntities calls. Previously they were here in Pre-Pass 2, but that
  // caused footprints to re-render on top of players when batched rendering splits
  // Y-sorted entities across multiple renderYSortedEntities calls (swimming players).
  
  // First Pass: Render all Y-sorted entities including ALL walls
  // ALL walls now render in Pass 1 for correct Y-sorting with players/placeables/trees
  // South walls still render in Pass 6 (after ceiling tiles) so they appear on the exterior
  ySortedEntities.forEach(({ type, entity }) => {
      // Skip fog overlays and doors - they render in later passes
      // NOTE: wall_cell is no longer skipped entirely - only south walls (edge 2) are skipped
      if (type === 'fog_overlay' || type === 'door') {
        return;
      }
      
      // Handle wall_cell: render ALL walls in Y-sorted order
      // CRITICAL FIX: South walls were previously in Pass 6 (after everything), causing them to 
      // always render on top of players/trees even when the player is south of the wall.
      // Now ALL walls render here in Pass 1, properly Y-sorted with other entities.
      // Ceiling tiles already exclude south wall foundations (via southWallFoundations set).
      if (type === 'wall_cell') {
          const wall = entity as SpacetimeDBWallCell;
          
          // Render ALL walls in their Y-sorted position
          const wallCellKey = `${wall.cellX},${wall.cellY}`;
          const wallClusterId = cellCoordToClusterId.get(wallCellKey);
          const playerInsideThisCluster = wallClusterId !== undefined && wallClusterId === playerBuildingClusterId;
          const isEnclosed = wallClusterId ? clusterEnclosureStatus.get(wallClusterId) || false : false;

          renderWall({
              ctx,
              wall: wall as any,
              worldScale: 1.0,
              viewOffsetX: -cameraOffsetX,
              viewOffsetY: -cameraOffsetY,
              foundationTileImagesRef: foundationTileImagesRef,
              allWalls: allWalls,
              cycleProgress: cycleProgress,
              localPlayerPosition: localPlayerPosition,
              playerInsideCluster: playerInsideThisCluster,
              isClusterEnclosed: isEnclosed,
              entranceWayFoundations: allEntranceWayFoundations,
          });
          return;
      }
      
      // Handle fence: render fences in Y-sorted order with smart sprite selection
      if (type === 'fence') {
          const fence = entity as SpacetimeDBFence;
          
          renderFence({
              ctx,
              fence: fence as any,
              worldScale: 1.0,
              viewOffsetX: -cameraOffsetX,
              viewOffsetY: -cameraOffsetY,
              foundationTileImagesRef: foundationTileImagesRef,
              cycleProgress: cycleProgress,
              localPlayerPosition: localPlayerPosition,
              fencePositionMap: fencePositionMap, // Pass for neighbor detection
              doodadImagesRef: doodadImagesRef, // Pass for fence sprite images
          });
          return;
      }
      
      // === UNDERWATER SNORKELING MODE ===
      // Hide surface world (land structures, NPCs, wildlife). Only subsurface-relevant entities.
      if (isLocalPlayerSnorkeling) {
        const isSeaweedBed = type === 'harvestable_resource' &&
          (entity as SpacetimeDBHarvestableResource).plantType?.tag === 'SeaweedBed';

        const isPlantedSeaweed = type === 'planted_seed' &&
          (entity as SpacetimeDBPlantedSeed).plantType?.tag === 'SeaweedBed';

        const isHumanPlayer = type === 'player' && !(entity as SpacetimeDBPlayer).isNpc;

        const isUnderwaterEntity =
          isHumanPlayer ||
          type === 'living_coral' ||
          type === 'dropped_item' ||
          type === 'projectile' ||
          isSeaweedBed ||
          isPlantedSeaweed ||
          (type === 'fumarole' && (entity as SpacetimeDBFumarole).isSubmerged);

        if (!isUnderwaterEntity) {
          return;
        }
      }
      
      if (type === 'player') {
          const player = entity as SpacetimeDBPlayer;
          const playerId = player.identity.toHexString();
          const isLocalPlayer = localPlayerId === playerId;

          // Create a modified player object with appropriate position system
          let playerForRendering = player;
          if (isLocalPlayer && localPlayerPosition) {
              // Local player uses predicted position AND local facing direction for instant visual feedback
              playerForRendering = getPlayerRenderScratch(playerId, player);
              playerForRendering.positionX = localPlayerPosition.x;
              playerForRendering.positionY = localPlayerPosition.y;
              // CLIENT-AUTHORITATIVE: Use local facing direction for instant direction changes (no server lag)
              playerForRendering.direction = localFacingDirection || player.direction;
          } else if (!isLocalPlayer && remotePlayerInterpolation) {
              // Remote players use interpolated position between server updates
              const interpolatedPosition = remotePlayerInterpolation.updateAndGetSmoothedPosition(player, localPlayerId);
              playerForRendering = getPlayerRenderScratch(playerId, player);
              playerForRendering.positionX = interpolatedPosition.x;
              playerForRendering.positionY = interpolatedPosition.y;
          }

          const lastPos = lastPositionsRef.current.get(playerId);
          let isPlayerMoving = false;
          let movementReason = 'none';

         
          // Get or create movement cache for this player
          let movementCache = playerMovementCache.get(playerId);
          if (!movementCache) {
              movementCache = {
                  lastMovementTime: 0,
                  isCurrentlyMoving: false,
                  lastKnownPosition: null
              };
              playerMovementCache.set(playerId, movementCache);
          }
         
          // Check for actual position changes (skip if already detected dodge rolling)
          let hasPositionChanged = false;
          
          // Compare current position with last known position
          if (movementCache.lastKnownPosition) {
              const positionThreshold = 0.1; // Small threshold to avoid floating point precision issues
              const dx = Math.abs(playerForRendering.positionX - movementCache.lastKnownPosition.x);
              const dy = Math.abs(playerForRendering.positionY - movementCache.lastKnownPosition.y);
              hasPositionChanged = dx > positionThreshold || dy > positionThreshold;
          } else {
              // First time seeing this player, initialize position
              movementCache.lastKnownPosition = { x: playerForRendering.positionX, y: playerForRendering.positionY };
              hasPositionChanged = false;
          }
          
          // Update movement cache if position changed
          if (hasPositionChanged) {
              movementCache.lastMovementTime = nowMs;
              movementCache.isCurrentlyMoving = true;
              if (movementCache.lastKnownPosition) {
                  movementCache.lastKnownPosition.x = playerForRendering.positionX;
                  movementCache.lastKnownPosition.y = playerForRendering.positionY;
              } else {
                  movementCache.lastKnownPosition = { x: playerForRendering.positionX, y: playerForRendering.positionY };
              }
              isPlayerMoving = true;
              movementReason = 'position_change';
          } else {
              // Check if we're still in the movement buffer period
              const timeSinceLastMovement = nowMs - movementCache.lastMovementTime;
              if (timeSinceLastMovement < MOVEMENT_BUFFER_MS) {
                  isPlayerMoving = true;
                  movementReason = `movement_buffer(${timeSinceLastMovement}ms)`;
              } else {
                  movementCache.isCurrentlyMoving = false;
              }
          }
         
          // If position-based detection fails, check if player is actively sprinting
          if (!isPlayerMoving && playerForRendering.isSprinting) {
              movementCache.lastMovementTime = nowMs;
              movementCache.isCurrentlyMoving = true;
              isPlayerMoving = true;
              movementReason = 'sprinting';
          }
          
          // Update terrain footprints for players walking on snow/beach
          // This creates footprint trails that fade out over time
          // Skip footprints when player is dodging
          updatePlayerFootprints(connection ?? null, playerForRendering, isPlayerMoving, nowMs, playerDodgeRollStates);
         
          const cachedLastPos = lastPositionsRef.current.get(playerId);
          if (cachedLastPos) {
              cachedLastPos.x = playerForRendering.positionX;
              cachedLastPos.y = playerForRendering.positionY;
          } else {
              lastPositionsRef.current.set(playerId, { x: playerForRendering.positionX, y: playerForRendering.positionY });
          }

         let jumpOffset = 0;
         let isCurrentlyJumping = false;
         const jumpStartTimeVal = playerForRendering.jumpStartTimeMs;

         // Local player: immediate arc from input (renderer used to wait only on server — full RTT delay).
         if (isLocalPlayer && localOptimisticJumpPressMs > 0) {
             const elapsedOpt = nowMs - localOptimisticJumpPressMs;
             if (elapsedOpt >= 0 && elapsedOpt < JUMP_DURATION_MS) {
                 const t = elapsedOpt / JUMP_DURATION_MS;
                 jumpOffset = Math.sin(t * Math.PI) * JUMP_HEIGHT_PX;
                 isCurrentlyJumping = true;
             }
         }

         if (jumpStartTimeVal > 0) {
             const serverJumpTime = Number(jumpStartTimeVal);
             const lastKnownServerTime = lastKnownServerJumpTimes.get(playerId) || 0;

             if (serverJumpTime !== lastKnownServerTime) {
                 lastKnownServerJumpTimes.set(playerId, serverJumpTime);
                 if (isLocalPlayer && localOptimisticJumpPressMs > 0) {
                     clientJumpStartTimes.set(playerId, localOptimisticJumpPressMs);
                     if (localOptimisticJumpPressMsRef) {
                         localOptimisticJumpPressMsRef.current = 0;
                     }
                 } else {
                     // Use server Unix ms, not reception time. Server keeps jump_start_time_ms after
                     // landing; if lastKnown was cleared, nowMs would restart the arc (phantom jump on move).
                     clientJumpStartTimes.set(playerId, serverJumpTime);
                 }
             }

             if (jumpOffset === 0) {
                 const clientStartTime = clientJumpStartTimes.get(playerId);
                 if (clientStartTime) {
                     const elapsedJumpTime = nowMs - clientStartTime;
                     if (elapsedJumpTime < JUMP_DURATION_MS) {
                         const t = elapsedJumpTime / JUMP_DURATION_MS;
                         jumpOffset = Math.sin(t * Math.PI) * JUMP_HEIGHT_PX;
                         isCurrentlyJumping = true;
                     }
                 }
             }
         } else {
             const optimisticMidAir =
                 isLocalPlayer &&
                 localOptimisticJumpPressMs > 0 &&
                 nowMs - localOptimisticJumpPressMs < JUMP_DURATION_MS;
             if (!optimisticMidAir) {
                 clientJumpStartTimes.delete(playerId);
                 lastKnownServerJumpTimes.delete(playerId);
             }
         }
         
         // Dodge roll detection logic (animation timeline only)
         // Local player uses ONE unified timeline to prevent accidental "double roll"
         // when optimistic and server states overlap.
         const dodgeRollState = playerDodgeRollStates.get(playerId);
         let isDodgeRolling = false;
         let dodgeRollProgress = 0;
         const serverClientReceptionTime = dodgeRollState
           ? ((dodgeRollState as any).clientReceptionTimeMs ?? Date.now())
           : 0;
         
         if (isLocalPlayer) {
           if (localPredictedDodgeRollVisualState) {
             isDodgeRolling = localPredictedDodgeRollVisualState.isDodgeRolling;
             dodgeRollProgress = localPredictedDodgeRollVisualState.progress;
             if (localPredictedDodgeRollVisualState.isDodgeRolling && localPredictedDodgeRollVisualState.direction) {
               if (playerForRendering === player) {
                 playerForRendering = getPlayerRenderScratch(playerId, player);
               }
               playerForRendering.direction = localPredictedDodgeRollVisualState.direction;
             }
           } else {
           const hasOptimistic = localOptimisticDodgeRollStartMs > 0;
           const hasServer = serverClientReceptionTime > 0;
           let unifiedStartMs = 0;
 
           if (hasOptimistic && hasServer) {
             const deltaMs = serverClientReceptionTime - localOptimisticDodgeRollStartMs;
             // Merge only when server update clearly belongs to this same local roll.
             // If server timestamp is from a stale prior roll (or far from optimistic),
             // keep optimistic start to prevent animation drop -> visible sliding.
             const sameRollWindow =
               deltaMs >= -150 &&
               deltaMs <= localOptimisticDodgeRollDurationMs;
             unifiedStartMs = sameRollWindow
               ? Math.min(localOptimisticDodgeRollStartMs, serverClientReceptionTime)
               : localOptimisticDodgeRollStartMs;
           } else if (hasOptimistic) {
             unifiedStartMs = localOptimisticDodgeRollStartMs;
           } else if (hasServer) {
             unifiedStartMs = serverClientReceptionTime;
           }
 
           if (unifiedStartMs > 0) {
             const elapsed = nowMs - unifiedStartMs;
             if (elapsed >= 0 && elapsed < localOptimisticDodgeRollDurationMs) {
               isDodgeRolling = true;
               dodgeRollProgress = elapsed / localOptimisticDodgeRollDurationMs;
             }
           }
           }
         } else if (serverClientReceptionTime > 0) {
           const elapsed = nowMs - serverClientReceptionTime;
           if (elapsed >= 0 && elapsed < 500) { // 500ms dodge roll duration (synced with server)
             isDodgeRolling = true;
             dodgeRollProgress = elapsed / 500.0;
            if (dodgeRollState) {
              // Remote polish: use authoritative dodge direction while roll is active.
              if (typeof (dodgeRollState as any).direction === 'string' && (dodgeRollState as any).direction.length > 0) {
                if (playerForRendering === player) {
                  playerForRendering = getPlayerRenderScratch(playerId, player);
                }
                playerForRendering.direction = (dodgeRollState as any).direction;
              }

              // Remote polish: bias interpolated position toward server dodge path.
              // This keeps remote roll motion coherent without touching local prediction.
              const sX = Number((dodgeRollState as any).startX);
              const sY = Number((dodgeRollState as any).startY);
              const tX = Number((dodgeRollState as any).targetX);
              const tY = Number((dodgeRollState as any).targetY);
              if (
                Number.isFinite(sX) &&
                Number.isFinite(sY) &&
                Number.isFinite(tX) &&
                Number.isFinite(tY)
              ) {
                const clampedProgress = Math.max(0, Math.min(1, dodgeRollProgress));
                const dodgePathX = sX + (tX - sX) * clampedProgress;
                const dodgePathY = sY + (tY - sY) * clampedProgress;
                const blendedX = playerForRendering.positionX + (dodgePathX - playerForRendering.positionX) * REMOTE_DODGE_POSITION_BLEND;
                const blendedY = playerForRendering.positionY + (dodgePathY - playerForRendering.positionY) * REMOTE_DODGE_POSITION_BLEND;
                if (playerForRendering === player) {
                  playerForRendering = getPlayerRenderScratch(playerId, player);
                }
                playerForRendering.positionX = blendedX;
                playerForRendering.positionY = blendedY;
              }
            }
           }
         }
         // No logging for players without dodge state - this is the normal case
         
         const currentlyHovered = isPlayerHovered(worldMouseX, worldMouseY, playerForRendering);
         const isPersistentlyHovered = alwaysShowPlayerNames || hoveredPlayerIds.has(playerId);
         
        // Players in this batch are rendered as full-body entities.
        // Snorkeling players are still underwater, so they must keep swim animation/tint,
        // but should NOT use split waterline rendering.
        const playerIsSnorkelingEarly = isLocalPlayer ? isLocalPlayerSnorkeling : playerForRendering.isSnorkeling;
        const tileX = Math.floor(playerForRendering.positionX / gameConfig.tileSize);
        const tileY = Math.floor(playerForRendering.positionY / gameConfig.tileSize);
        const tileKey = `${tileX},${tileY}`;
        const isOnSeaTransitionTile = seaTransitionTileLookup?.get(tileKey) ?? false;
        // Keep local player water-state in sync with predicted tile crossing to avoid
        // split-render desync (e.g., bottom-half-only frame when exiting sea).
        const localPredictedIsOnWater = isLocalPlayer
          ? (waterTileLookup?.get(tileKey) ?? playerForRendering.isOnWater)
          : playerForRendering.isOnWater;
        const effectiveIsOnWater = (localPredictedIsOnWater && !isOnSeaTransitionTile) || playerIsSnorkelingEarly;
        const tileTypeAtPlayer = connection
          ? getTileTypeFromChunkData(connection, tileX, tileY)
          : null;
        const isSwimmingInHotSpringWater =
          Boolean(effectiveIsOnWater && tileTypeAtPlayer === 'HotSpringWater');
         
         // Choose sprite based on priority: dodge roll > water > crouching > default
         let heroImg: HTMLImageElement | null;
         // For local player, use immediate local crouch state; for others, use server state
         const effectiveIsCrouching = isLocalPlayer && localPlayerIsCrouching !== undefined 
             ? localPlayerIsCrouching 
             : playerForRendering.isCrouching;
         
         // console.log(`[DEBUG] Player ${playerId} image selection - isDodgeRolling:`, isDodgeRolling, 'effectiveIsCrouching:`, effectiveIsCrouching, 'isOnWater:', playerForRendering.isOnWater, 'isCurrentlyJumping:', isCurrentlyJumping);
         // console.log(`[DEBUG] Image refs available - heroImageRef:`, !!heroImageRef.current, 'heroWaterImageRef:', !!heroWaterImageRef.current, 'heroCrouchImageRef:', !!heroCrouchImageRef.current, 'heroDodgeImageRef:', !!heroDodgeImageRef?.current);
         
        if (isDodgeRolling) {
            const dodgeImg = heroDodgeImageRef?.current;
            const dodgeUsable = dodgeImg && dodgeImg.complete && dodgeImg.naturalWidth > 0;
            heroImg = dodgeUsable ? dodgeImg : heroImageRef.current; // Use dodge sprite when loaded, fallback to normal to avoid invisibility
            // console.log(`[DEBUG] Using dodge roll sprite for ${playerId}:`, !!heroImg);
        } else if (effectiveIsOnWater && !isCurrentlyJumping) {
            // FIX: Add fallback to walking sprite if water sprite not loaded
            heroImg = heroWaterImageRef.current || heroImageRef.current; // Use water sprite when on actual water, fallback to walking sprite
           // console.log(`[DEBUG] Using water sprite for ${playerId}:`, !!heroImg);
        } else if (effectiveIsCrouching && !playerForRendering.isOnWater) {
            // FIX: Add fallback to walking sprite if crouch sprite not loaded
            heroImg = heroCrouchImageRef.current || heroImageRef.current; // Use crouch sprite when crouching, fallback to walking sprite
           // console.log(`[DEBUG] Using crouch sprite for ${playerId}:`, !!heroImg);
        } else {
            heroImg = heroImageRef.current; // DEFAULT: Use normal sprite otherwise
           // console.log(`[DEBUG] Using normal sprite for ${playerId}:`, !!heroImg);
        }
         const isOnline = activeConnections ? activeConnections.has(playerId) : false;

         const equipment = activeEquipments.get(playerId);
         let itemDef: SpacetimeDBItemDefinition | null = null;
         let itemImg: HTMLImageElement | null = null;

         if (equipment && equipment.equippedItemDefId) {
           const resolvedItemDef = itemDefinitions.get(equipment.equippedItemDefId.toString()) || null;
           // Local-player hotbar/equip switches should feel instant. Trust active_equipment
           // even if inventory replication for the equipped instance lands a moment later.
           if (isLocalPlayer) {
             itemDef = resolvedItemDef;
             itemImg = (resolvedItemDef ? itemImagesRef.current.get(resolvedItemDef.iconAssetName) : null) || null;
           } else if (equipment.equippedItemInstanceId) {
             // Keep strict validation for remote players to avoid stale "ghost held items"
             // after consumptions while their equipment row catches up.
             const equippedItemInstance = inventoryItems.get(equipment.equippedItemInstanceId.toString());
             if (equippedItemInstance && equippedItemInstance.quantity > 0) {
               itemDef = resolvedItemDef;
               itemImg = (resolvedItemDef ? itemImagesRef.current.get(resolvedItemDef.iconAssetName) : null) || null;
             }
           }
         } else if (localPlayerId && playerId === localPlayerId) {
           // Debug logging removed for performance (was spamming every frame)
         }
         const canRenderItem = itemDef && itemImg && itemImg.complete && itemImg.naturalHeight !== 0;
         
          // PERF FIX: Use pre-indexed effects for this specific player (O(1) lookup vs O(N) iteration)
          const playerEffects = effectsByPlayerId.get(playerId) || EMPTY_EFFECTS_MAP;
         
          // Determine if this player is swimming with split rendering (bottom half here, top half in GameCanvas).
          // If so, skip equipped item rendering here — it's handled in the swimming top half pass.
          // On sea transition tiles: no split render (player shows as normal).
          const isSwimmingSplitRender = effectiveIsOnWater && !playerForRendering.isDead && !playerForRendering.isKnockedOut && !playerIsSnorkelingEarly;

          // Determine rendering order based on player direction
          if (playerForRendering.direction === 'up' || playerForRendering.direction === 'left') {
              // For UP or LEFT, item should be rendered BENEATH the player
            
            // Ghost trail disabled for cleaner dodge roll experience
            // if (heroImg && isDodgeRolling) {
            //     renderGhostTrail(ctx, playerId, heroImg, playerForRendering);
            // }
            
            if (canRenderItem && equipment && !isSwimmingSplitRender) {
                  // Use the rendered direction so local held-item orientation matches the body instantly.
                  // Pass snorkeling state for underwater teal tint effect
                  const playerIsSnorkelingForItem = isLocalPlayer ? isLocalPlayerSnorkeling : playerForRendering.isSnorkeling;
                  const heldDodgeRollSpinTag = itemDef!.category?.tag;
                  const toolDodgeRollSpin =
                    isDodgeRolling &&
                    (heldDodgeRollSpinTag === 'Tool' ||
                      heldDodgeRollSpinTag === 'Weapon' ||
                      heldDodgeRollSpinTag === 'RangedWeapon')
                      ? { progress: dodgeRollProgress, direction: playerForRendering.direction }
                      : undefined;
                  renderEquippedItem(ctx, playerForRendering, equipment, itemDef!, itemDefinitions, itemImg!, nowMs, jumpOffset, itemImagesRef.current, playerEffects, localPlayerId, playerForRendering.direction, playerIsSnorkelingForItem, toolDodgeRollSpin);
            }
            
            // console.log(`[DEBUG] Rendering player ${playerId} - heroImg available:`, !!heroImg, 'direction:', playerForRendering.direction);
            if (heroImg) {
              // console.log(`[DEBUG] Calling renderPlayer for ${playerId}`);
              // Choose animation frame based on player state and environment
              // On sea transition tiles: use land animations (walking/idle/sprint)
              let currentAnimFrame: number;
              if (effectiveIsOnWater) {
                currentAnimFrame = isPlayerMoving ? animationFrame : idleAnimationFrame; // Use movement frames when moving, idle when still - for better sync
              } else {
                // Land animations
                if (!isPlayerMoving) {
                  currentAnimFrame = idleAnimationFrame; // Use idle animation when not moving
                } else if (playerForRendering.isSprinting) {
                  currentAnimFrame = sprintAnimationFrame; // Use sprint animation when sprinting
                } else {
                  currentAnimFrame = animationFrame; // Use walking animation for normal movement
                }
              }
              // Determine if this player should use snorkeling mode rendering
              // Local player: use isLocalPlayerSnorkeling (for optimistic/predicted state)
              // Remote player: use their synced isSnorkeling flag
              const playerIsSnorkeling = playerId === localPlayerId 
                ? isLocalPlayerSnorkeling 
                : playerForRendering.isSnorkeling;
              
              // For swimming players on actual water, render only the bottom half (underwater portion)
              // On sea transition tiles or snorkeling: render full sprite
              const renderHalf = (effectiveIsOnWater && !playerForRendering.isDead && !playerForRendering.isKnockedOut && !playerIsSnorkeling) ? 'bottom' : 'full';
              
              // Use normal player position (movement system handles dodge roll speed)
              const playerForRender = playerForRendering;
              
              // Get player's active title from playerStats
              const playerStatsEntry = playerStats?.get(playerId);
              const playerActiveTitle = playerStatsEntry?.activeTitleId || null;
              
              renderPlayer(
                      ctx, 
                      playerForRender, 
                      heroImg, 
                      heroSprintImageRef.current || heroImg, 
                      heroIdleImageRef.current || heroImg,
                      heroCrouchImageRef.current || heroImg, // crouch sprite
                      heroSwimImageRef?.current || heroImg, // swim sprite
                      heroDodgeImageRef?.current || heroImg,
                      isOnline, 
                      isPlayerMoving, 
                      currentlyHovered,
                currentAnimFrame, // Use appropriate animation frame
                nowMs, 
                jumpOffset,
                isPersistentlyHovered,
                playerEffects, // PERF FIX: Pre-indexed effects for this player only
                localPlayerId,
                false, // isCorpse
                cycleProgress, // cycleProgress
                localPlayerIsCrouching,
                renderHalf, // Render full player for normal Y-sorting (or full when snorkeling)
                isDodgeRolling,
                dodgeRollProgress,
                playerIsSnorkeling,
                isLocalPlayerSnorkeling,
                playerActiveTitle,
                effectiveIsOnWater,
                isOnSeaTransitionTile,
                isSwimmingInHotSpringWater
              );
            } else {
              renderCyberpunkPlayerPlaceholder(ctx, playerForRendering, nowMs, jumpOffset);
            }
            // Swipe arc drawn AFTER player so it's visible on top (up/left: item beneath player)
            if (canRenderItem && equipment && !isSwimmingSplitRender) {
              renderMeleeSwipeArcIfSwinging(ctx, playerForRendering, equipment, itemDef!, nowMs, jumpOffset, localPlayerId);
            }
          } else { // This covers 'down' or 'right'
              // For DOWN or RIGHT, item should be rendered ABOVE the player
            // console.log(`[DEBUG] Rendering player ${playerId} (down/right) - heroImg available:`, !!heroImg, 'direction:', playerForRendering.direction);
            if (heroImg) {
              // console.log(`[DEBUG] Calling renderPlayer for ${playerId} (down/right)`);
              // Choose animation frame based on player state and environment
              // On sea transition tiles: use land animations (walking/idle/sprint)
              let currentAnimFrame: number;
              if (effectiveIsOnWater) {
                currentAnimFrame = isPlayerMoving ? animationFrame : idleAnimationFrame; // Use movement frames when moving, idle when still - for better sync
              } else {
                // Land animations
                if (!isPlayerMoving) {
                  currentAnimFrame = idleAnimationFrame; // Use idle animation when not moving
                } else if (playerForRendering.isSprinting) {
                  currentAnimFrame = sprintAnimationFrame; // Use sprint animation when sprinting
                } else {
                  currentAnimFrame = animationFrame; // Use walking animation for normal movement
                }
              }
              // Determine if this player should use snorkeling mode rendering
              // Local player: use isLocalPlayerSnorkeling (for optimistic/predicted state)
              // Remote player: use their synced isSnorkeling flag
              const playerIsSnorkeling = playerId === localPlayerId 
                ? isLocalPlayerSnorkeling 
                : playerForRendering.isSnorkeling;
              
              // For swimming players on actual water, render only the bottom half (underwater portion)
              // On sea transition tiles or snorkeling: render full sprite
              const renderHalf = (effectiveIsOnWater && !playerForRendering.isDead && !playerForRendering.isKnockedOut && !playerIsSnorkeling) ? 'bottom' : 'full';
              
              // Use normal player position (movement system handles dodge roll speed)
              const playerForRender = playerForRendering;
              
              // Get player's active title from playerStats (same lookup as up/left case)
              const playerStatsEntry2 = playerStats?.get(playerId);
              const playerActiveTitle2 = playerStatsEntry2?.activeTitleId || null;
              
              renderPlayer(
                  ctx, 
                  playerForRender, 
                  heroImg, 
                  heroSprintImageRef.current || heroImg, 
                  heroIdleImageRef.current || heroImg,
                  heroCrouchImageRef.current || heroImg, // crouch sprite
                  heroSwimImageRef?.current || heroImg, // swim sprite  
                  heroDodgeImageRef?.current || heroImg, // NEW: dodge roll sprite
                  isOnline, 
                  isPlayerMoving, 
                  currentlyHovered,
                currentAnimFrame, // Use appropriate animation frame
                nowMs, 
                jumpOffset,
                isPersistentlyHovered,
                playerEffects, // PERF FIX: Pre-indexed effects for this player only
                localPlayerId,
                false, // isCorpse
                cycleProgress, // cycleProgress
                localPlayerIsCrouching,
                renderHalf, // Render full player for normal Y-sorting (or full when snorkeling)
                isDodgeRolling,
                dodgeRollProgress,
                playerIsSnorkeling,
                isLocalPlayerSnorkeling,
                playerActiveTitle2,
                effectiveIsOnWater,
                isOnSeaTransitionTile,
                isSwimmingInHotSpringWater
              );
            } else {
              renderCyberpunkPlayerPlaceholder(ctx, playerForRendering, nowMs, jumpOffset);
            }
            if (canRenderItem && equipment && !isSwimmingSplitRender) {
                  // Use the rendered direction so local held-item orientation matches the body instantly.
                  // Pass snorkeling state for underwater teal tint effect
                  const playerIsSnorkelingForItem = isLocalPlayer ? isLocalPlayerSnorkeling : playerForRendering.isSnorkeling;
                  const heldDodgeRollSpinTag = itemDef!.category?.tag;
                  const toolDodgeRollSpin =
                    isDodgeRolling &&
                    (heldDodgeRollSpinTag === 'Tool' ||
                      heldDodgeRollSpinTag === 'Weapon' ||
                      heldDodgeRollSpinTag === 'RangedWeapon')
                      ? { progress: dodgeRollProgress, direction: playerForRendering.direction }
                      : undefined;
                  renderEquippedItem(ctx, playerForRendering, equipment, itemDef!, itemDefinitions, itemImg!, nowMs, jumpOffset, itemImagesRef.current, playerEffects, localPlayerId, playerForRendering.direction, playerIsSnorkelingForItem, toolDodgeRollSpin);
                  renderMeleeSwipeArcIfSwinging(ctx, playerForRendering, equipment, itemDef!, nowMs, jumpOffset, localPlayerId);
            }
            
            // Ghost trail disabled for cleaner dodge roll experience
            // if (heroImg && isDodgeRolling) {
            //     renderGhostTrail(ctx, playerId, heroImg, playerForRendering);
            // }
         }

         // Check if this knocked out player is the closest interactable target
         const isTheClosestKnockedOutTarget = closestInteractableTarget?.type === 'knocked_out_player' && closestInteractableTarget?.id === playerId;

         // Draw outline for knocked out players who are the closest interactable target
         if (isTheClosestKnockedOutTarget && playerForRendering.isKnockedOut && !playerForRendering.isDead) {
             const outlineColor = getInteractionOutlineColor('revive');
             // Use an oval outline that's wider than tall to represent a lying down player
             drawCircularInteractionOutline(ctx, playerForRendering.positionX, playerForRendering.positionY, 40, cycleProgress, outlineColor);
         }
      } else if (type === 'tree') {
          // Render tree with its shadow in the normal order (shadow first, then tree)
          const tree = entity as SpacetimeDBTree;
          const treeId = tree.id.toString();
          const isFalling = isTreeFalling ? isTreeFalling(treeId) : false;
          const fallProgress = isFalling && getFallProgress ? getFallProgress(treeId) : undefined;
          
          // BUGFIX: Skip rendering destroyed trees that are no longer falling
          // This guards against cache race conditions where the tree is still in the
          // cached visible list after the falling animation ends
          if (tree.health === 0 && !isFalling) {
              return; // Skip this tree - it's destroyed and animation is done
          }
          
          // Render tree with its shadow in the normal order (shadow first, then tree)
          // NOTE: Canopy shadows are rendered via a separate overlay pass (renderTreeCanopyShadowsOverlay)
          // which runs AFTER all Y-sorted entities. This allows shadows to appear ON TOP of all entities
          // walking under trees, while respecting tree-to-tree Y-sorting (shadows from behind trees
          // don't appear on front tree canopies)
          renderTree(
            ctx,
            tree,
            nowMs,
            cycleProgress,
            false,
            false,
            localPlayerPosition,
            treeShadowsEnabled && allShadowsEnabled,
            isFalling,
            fallProgress
          );
      } else if (type === 'stone') {
          // Render stone with its shadow in the normal order (shadow first, then stone)
          renderStone(ctx, entity as SpacetimeDBStone, nowMs, cycleProgress, false, !allShadowsEnabled);
      } else if (type === 'rune_stone') {
          // Render rune stone with its shadow in the normal order (shadow first, then rune stone)
          const runeStone = entity as SpacetimeDBRuneStone;
          
          const showBuildingRestriction = shouldShowBuildingRestrictionOverlay(
              placementInfo,
              localPlayerId,
              activeEquipments,
              itemDefinitions
          );
          
          renderRuneStone(ctx, runeStone, nowMs, cycleProgress, false, !allShadowsEnabled, localPlayerPosition, showBuildingRestriction);
      } else if (type === 'cairn') {
          // Render cairn with interaction indicator if in range
          const cairn = entity as SpacetimeDBCairn;
          const isTheClosestTarget = closestInteractableTarget?.type === 'cairn' && 
                                       closestInteractableTarget?.id === cairn.id;
          // Note: renderCairn no longer draws its own indicator - we use the standard outline below
          renderCairn(ctx, cairn, cameraOffsetX, cameraOffsetY, connection ?? null, false, nowMs, cycleProgress);
          
          // Draw outline only if this is THE closest interactable target
          if (isTheClosestTarget) {
              const outlineColor = getInteractionOutlineColor('open');
              const config = ENTITY_VISUAL_CONFIG.cairn;
              const outline = getInteractionOutlineParams(cairn.posX, cairn.posY, config);
              drawInteractionOutline(ctx, outline.x, outline.y, outline.width, outline.height, cycleProgress, outlineColor);
          }
      } else if (type === 'shelter') {
          const shelter = entity as SpacetimeDBShelter;
          if (shelterImage) { 
              renderShelter({
                  ctx,
                  shelter,
                  shelterImage: shelterImage, 
                  nowMs,
                  cycleProgress,
                  localPlayerId,
                  localPlayerPosition,
              });
          } else {
              // console.warn('[renderYSortedEntities] Shelter image not available for shelter:', shelter.id); // DEBUG LOG
          }
      } else if (type === 'harvestable_resource') {
          const resource = entity as SpacetimeDBHarvestableResource;
          
          // Check if this is an underwater plant (SeaweedBed)
          const isSeaweedBed = resource.plantType?.tag === 'SeaweedBed';
          
          if (isSeaweedBed) {
            // SeaweedBed rendering with underwater visibility effects
            if (!isLocalPlayerSnorkeling) {
              // Above water view: render seaweed blurry (visible but hard to interact with)
              ctx.save();
              ctx.filter = 'blur(2px)';
              ctx.globalAlpha = 0.6;
              renderHarvestableResource(ctx, resource, nowMs, cycleProgress);
              ctx.restore();
            } else {
              // Underwater view - render clearly with teal underwater tint
              ctx.save();
              ctx.globalAlpha = 1.0;
              // Apply subtle teal tint for underwater ambiance (same as planted seaweed)
              ctx.filter = 'sepia(20%) hue-rotate(140deg) saturate(120%)';
              renderHarvestableResource(ctx, resource, nowMs, cycleProgress);
              ctx.restore();
            }
          } else {
            // Normal harvestable resources - use unified renderer
            renderHarvestableResource(ctx, resource, nowMs, cycleProgress);
          }
          
          // Note: Green circle outline removed - interaction indicators now handled by cyberpunk "E" labels only
      } else if (type === 'campfire') {
          const campfire = entity as SpacetimeDBCampfire;
          const isTheClosestTarget = closestInteractableTarget?.type === 'campfire' && closestInteractableTarget?.id === campfire.id;
          // Pass player position for health bar rendering on opposite side (like barrels)
          const playerX = localPlayerPosition?.x;
          const playerY = localPlayerPosition?.y;
          renderCampfire(ctx, campfire, nowMs, cycleProgress, false, !allShadowsEnabled, playerX, playerY);
          
          // Draw outline only if this is THE closest interactable target
          if (isTheClosestTarget) {
              const outlineColor = getInteractionOutlineColor('open');
              const config = ENTITY_VISUAL_CONFIG.campfire;
              const outline = getInteractionOutlineParams(campfire.posX, campfire.posY, config);
              drawInteractionOutline(ctx, outline.x, outline.y, outline.width, outline.height, cycleProgress, outlineColor);
          }
      } else if (type === 'furnace') {
          const furnace = entity as any;
          const isTheClosestTarget = closestInteractableTarget?.type === 'furnace' && closestInteractableTarget?.id === furnace.id;
          // Pass player position for health bar rendering on opposite side (like barrels)
          const playerX = localPlayerPosition?.x;
          const playerY = localPlayerPosition?.y;
          renderFurnace(ctx, furnace, nowMs, cycleProgress, false, !allShadowsEnabled, playerX, playerY, localPlayerPosition);
          
          // Draw outline only if this is THE closest interactable target
          if (isTheClosestTarget) {
              const outlineColor = getInteractionOutlineColor('open');
              // Select config based on furnace type and monument status
              let config;
              if (furnace.furnaceType === 1 && isCompoundMonument(furnace.isMonument, furnace.posX, furnace.posY)) {
                  config = ENTITY_VISUAL_CONFIG.monument_large_furnace;
              } else if (furnace.furnaceType === 1) {
                  config = ENTITY_VISUAL_CONFIG.large_furnace;
              } else {
                  config = ENTITY_VISUAL_CONFIG.furnace;
              }
              const outline = getInteractionOutlineParams(furnace.posX, furnace.posY, config);
              drawInteractionOutline(ctx, outline.x, outline.y, outline.width, outline.height, cycleProgress, outlineColor);
          }
      } else if (type === 'barbecue') {
          const barbecue = entity as any; // Barbecue type from generated types
          const isTheClosestTarget = closestInteractableTarget?.type === 'barbecue' && closestInteractableTarget?.id === barbecue.id;
          // Pass player position for health bar rendering on opposite side (like barrels)
          const playerX = localPlayerPosition?.x;
          const playerY = localPlayerPosition?.y;
          renderBarbecue(ctx, barbecue, nowMs, cycleProgress, false, !allShadowsEnabled, playerX, playerY);
          
          // Draw outline only if this is THE closest interactable target
          if (isTheClosestTarget) {
              const outlineColor = getInteractionOutlineColor('open');
              // Use centralized visual config for consistent bounds
              const config = ENTITY_VISUAL_CONFIG.barbecue;
              const outline = getInteractionOutlineParams(barbecue.posX, barbecue.posY, config);
              drawInteractionOutline(ctx, outline.x, outline.y, outline.width, outline.height, cycleProgress, outlineColor);
          }
      } else if (type === 'turret') {
          const turret = entity as SpacetimeDBTurret;
          const isTheClosestTarget = closestInteractableTarget?.type === 'turret' && closestInteractableTarget?.id === turret.id;
          
          // Use camera offsets from function parameters (passed from GameCanvas)
          const camX = cameraOffsetX ?? 0;
          const camY = cameraOffsetY ?? 0;
          // Pass player position for health bar rendering on opposite side (like barrels, campfires, furnaces)
          const playerX = localPlayerPosition?.x;
          const playerY = localPlayerPosition?.y;
          renderTurret(ctx, turret, camX, camY, cycleProgress, playerX, playerY, localPlayerPosition);
          
          if (isTheClosestTarget) {
              const config = ENTITY_VISUAL_CONFIG.turret;
              const outlineColor = getInteractionOutlineColor('turret');
              const outline = getInteractionOutlineParams(turret.posX, turret.posY, config);
              drawInteractionOutline(ctx, outline.x, outline.y, outline.width, outline.height, cycleProgress, outlineColor);
          }
      } else if (type === 'lantern') {
          const lantern = entity as any;
          const isTheClosestTarget = closestInteractableTarget?.type === 'lantern' && closestInteractableTarget?.id === lantern.id;
          // Pass localPlayerPosition for transparency occlusion (wards are tall and can block player view)
          // Also pass playerX/playerY for health bar rendering (shows on opposite side from player)
          renderLantern(ctx, lantern, nowMs, cycleProgress, undefined, undefined, localPlayerPosition?.x, localPlayerPosition?.y, localPlayerPosition);
          
          if (isTheClosestTarget) {
              const outlineColor = getInteractionOutlineColor('open');
              // Use appropriate config based on lantern type (wards have larger bounds)
              let config = ENTITY_VISUAL_CONFIG.lantern;
              if (lantern.lanternType === 1) { // LANTERN_TYPE_ANCESTRAL_WARD
                  config = ENTITY_VISUAL_CONFIG.ancestral_ward;
              } else if (lantern.lanternType === 2) { // LANTERN_TYPE_SIGNAL_DISRUPTOR
                  config = ENTITY_VISUAL_CONFIG.signal_disruptor;
              } else if (lantern.lanternType === 3) { // LANTERN_TYPE_MEMORY_BEACON
                  config = ENTITY_VISUAL_CONFIG.memory_beacon;
              }
              const outline = getInteractionOutlineParams(lantern.posX, lantern.posY, config);
              drawInteractionOutline(ctx, outline.x, outline.y, outline.width, outline.height, cycleProgress, outlineColor);
          }
      } else if (type === 'broth_pot') {
          const brothPot = entity as SpacetimeDBBrothPot;
          renderBrothPot(ctx, brothPot, nowMs, cycleProgress);
      } else if (type === 'dropped_item') {
          const droppedItem = entity as SpacetimeDBDroppedItem;
          const itemDef = itemDefinitions.get(droppedItem.itemDefId.toString());
          const isOnSeaTile = connection
              ? (worldX: number, worldY: number): boolean => {
                  const { tileX, tileY } = worldPosToTileCoords(worldX, worldY);
                  const tileType = getTileTypeFromChunkData(connection!, tileX, tileY);
                  return isOceanTileTag(tileType);
              }
              : undefined;
          // Apply underwater teal tint when snorkeling (items visible underwater)
          if (isLocalPlayerSnorkeling) {
              ctx.save();
              ctx.globalAlpha = 1.0;
              ctx.filter = 'sepia(20%) hue-rotate(140deg) saturate(120%)';
              renderDroppedItem({ ctx, item: droppedItem, itemDef, nowMs, cycleProgress, isOnSeaTile });
              ctx.restore();
          } else {
              renderDroppedItem({ ctx, item: droppedItem, itemDef, nowMs, cycleProgress, isOnSeaTile });
          }
      } else if (type === 'sleeping_bag') {
          const sleepingBag = entity as SpacetimeDBSleepingBag;
          renderSleepingBag(ctx, sleepingBag, nowMs, cycleProgress);
      } else if (type === 'stash') {
          const stash = entity as SpacetimeDBStash;
          const isTheClosestTarget = closestInteractableTarget?.type === 'stash' && closestInteractableTarget?.id === stash.id;
          
          // Always render the stash (will show nothing if hidden, but that's okay)
          renderStash(ctx, stash, nowMs, cycleProgress);
          
          // Draw outline if this is the closest target, even if stash is hidden
          if (isTheClosestTarget) {
              const outlineColor = getInteractionOutlineColor('open');
              const config = ENTITY_VISUAL_CONFIG.stash;
              const outline = getInteractionOutlineParams(stash.posX, stash.posY, config);
              drawInteractionOutline(ctx, outline.x, outline.y, outline.width, outline.height, cycleProgress, outlineColor);
          }
      } else if (type === 'wooden_storage_box') {
          const box = entity as SpacetimeDBWoodenStorageBox;
          const isTheClosestTarget = closestInteractableTarget?.type === 'box' && closestInteractableTarget?.id === box.id;
          // Pass player position for health bar rendering on opposite side (like barrels, campfires, furnaces)
          const playerX = localPlayerPosition?.x;
          const playerY = localPlayerPosition?.y;
          renderWoodenStorageBox(ctx, box, nowMs, cycleProgress, playerX, playerY, inventoryItems, itemDefinitions, localPlayerPosition ?? undefined);
          
          if (isTheClosestTarget) {
              const outlineColor = getInteractionOutlineColor('open');
              // Use appropriate config for each box type
              let config;
              const isCompound = isCompoundMonument(box.isMonument, box.posX, box.posY);
              if (box.boxType === BOX_TYPE_COMPOST) {
                  config = isCompound ? ENTITY_VISUAL_CONFIG.monument_compost : ENTITY_VISUAL_CONFIG.compost;
              } else if (box.boxType === BOX_TYPE_TANNING_RACK) {
                  config = ENTITY_VISUAL_CONFIG.compost;
              } else if (box.boxType === BOX_TYPE_REFRIGERATOR) {
                  config = ENTITY_VISUAL_CONFIG.refrigerator;
              } else if (box.boxType === BOX_TYPE_REPAIR_BENCH) {
                  config = isCompound ? ENTITY_VISUAL_CONFIG.monument_repair_bench : ENTITY_VISUAL_CONFIG.repair_bench;
              } else if (box.boxType === BOX_TYPE_COOKING_STATION) {
                  config = isCompound ? ENTITY_VISUAL_CONFIG.monument_cooking_station : ENTITY_VISUAL_CONFIG.cooking_station;
              } else if (box.boxType === BOX_TYPE_SCARECROW) {
                  config = ENTITY_VISUAL_CONFIG.scarecrow;
              } else if (box.boxType === BOX_TYPE_MILITARY_RATION) {
                  config = ENTITY_VISUAL_CONFIG.military_ration;
              } else if (box.boxType === BOX_TYPE_MILITARY_CRATE) {
                  config = ENTITY_VISUAL_CONFIG.military_crate;
              } else if (box.boxType === BOX_TYPE_MINE_CART) {
                  config = ENTITY_VISUAL_CONFIG.mine_cart;
              } else if (box.boxType === BOX_TYPE_FISH_TRAP) {
                  config = ENTITY_VISUAL_CONFIG.fish_trap;
              } else if (box.boxType === BOX_TYPE_WILD_BEEHIVE) {
                  config = ENTITY_VISUAL_CONFIG.wild_beehive;
              } else if (box.boxType === BOX_TYPE_PLAYER_BEEHIVE) {
                  config = ENTITY_VISUAL_CONFIG.player_beehive;
              } else {
                  config = ENTITY_VISUAL_CONFIG.wooden_storage_box;
              }
              const outline = getInteractionOutlineParams(box.posX, box.posY, config);
              drawInteractionOutline(ctx, outline.x, outline.y, outline.width, outline.height, cycleProgress, outlineColor);
          }
      } else if (type === 'player_corpse') {
          const corpse = entity as SpacetimeDBPlayerCorpse;
          
          // Check if mouse is hovering over this corpse (for nametag display)
          const isMouseHoveringCorpse = isCorpseHovered(worldMouseX, worldMouseY, corpse);
          
          // Check if this corpse is the closest interactable target (for blue outline)
          const isTheClosestTarget = closestInteractableTarget && 
                                   closestInteractableTarget.type === 'corpse' && 
                                   closestInteractableTarget.id.toString() === corpse.id.toString();
          
          renderCorpse({ 
              ctx, 
              corpse, 
              nowMs, 
              itemImagesRef,
              heroImageRef,
              heroWaterImageRef,
              heroCrouchImageRef,
              heroSwimImageRef: heroSwimImageRef || { current: null },
              isHovered: isMouseHoveringCorpse, // Show nametag when mouse hovers (not just closest target)
          });
          
          // Draw outline only if this is THE closest interactable target
          if (isTheClosestTarget) {
              const outlineColor = getInteractionOutlineColor('open');
              const config = ENTITY_VISUAL_CONFIG.player_corpse;
              const outline = getInteractionOutlineParams(corpse.posX, corpse.posY, config);
              drawInteractionOutline(ctx, outline.x, outline.y, outline.width, outline.height, cycleProgress, outlineColor);
          }
      } else if (type === 'grass') {
          // Grass rendered from Y-sorted entities - use 'near' LOD since it's already visibility filtered
          // Sway scales with chunk weather: Clear=minimal gentle sway, storms=dramatic
          renderGrass(ctx, entity as InterpolatedGrassData, nowMs, cycleProgress, false, true, 'near', chunkWeather, grassAnimationEnabled);
      } else if (type === 'projectile') {
          const projectile = entity as SpacetimeDBProjectile;
          
          // Check if this is a turret tallow projectile (source_type = 1 or 3 for monument turret)
          // Turret projectiles are rendered as primitives (glowing orange circles), not sprites
          const PROJECTILE_SOURCE_TURRET = 1;
          const PROJECTILE_SOURCE_NPC = 2;
          const PROJECTILE_SOURCE_MONUMENT_TURRET = 3;
          const isTurretTallow = projectile.sourceType === PROJECTILE_SOURCE_TURRET || projectile.sourceType === PROJECTILE_SOURCE_MONUMENT_TURRET;
          const isNpcProjectile = projectile.sourceType === PROJECTILE_SOURCE_NPC;
          
          if (isTurretTallow || isNpcProjectile) {
              // Turret and NPC projectiles are rendered as primitives - no image needed
              // Create a dummy image object for the renderProjectile function
              // (it will detect source_type and render as primitive instead)
              const dummyImage = new Image();
              dummyImage.width = 16;
              dummyImage.height = 16;
              
              renderProjectile({
                  ctx,
                  projectile,
                  arrowImage: dummyImage, // Dummy image - rendering uses source_type to render primitives
                  currentTimeMs: nowMs,
                  itemDefinitions,
                  applyUnderwaterTint: isLocalPlayerSnorkeling,
                  collisionCircles: projectileCollisionCircles,
              });
          } else {
              // Regular projectiles (arrows, bullets, thrown items) - use sprite images
              // Debug logging disabled for performance - uncomment to debug projectile rendering
              // console.log(`🏹 [RENDER] Projectile ${projectile.id} found in render queue`);
              
              // Check if this is a thrown weapon (ammo_def_id == item_def_id)
              const isThrown = projectile.ammoDefId === projectile.itemDefId;
              
              // Get the appropriate definition and image
              const ammoDef = itemDefinitions.get(projectile.ammoDefId.toString());
              let projectileImageName: string;
              
              if (isThrown && ammoDef) {
                  // For thrown weapons, use the weapon's icon
                  projectileImageName = ammoDef.iconAssetName;
              } else if (ammoDef) {
                  // For regular projectiles (arrows), use the ammunition's icon
                  projectileImageName = ammoDef.iconAssetName;
              } else {
                  // Fallback for missing definitions
                  projectileImageName = 'wooden_arrow.png';
                  console.warn(`🏹 [RENDER] No ammo definition found for projectile ${projectile.id}, using fallback`);
              }
              
              // Use imageManager to get the projectile image for production compatibility
              const projectileImageSrc = getItemIcon(projectileImageName);
              const projectileImage = imageManager.getImage(projectileImageSrc);
              
              renderProjectile({
                  ctx,
                  projectile,
                  // If sprite is still loading, renderProjectile will draw a primitive fallback.
                  arrowImage: projectileImage ?? EMPTY_PROJECTILE_IMAGE,
                  currentTimeMs: nowMs,
                  itemDefinitions, // FIXED: Add itemDefinitions for weapon type detection
                  applyUnderwaterTint: isLocalPlayerSnorkeling, // Teal tint when local player is underwater
                  collisionCircles: projectileCollisionCircles,
              });
          }
      } else if (type === 'planted_seed') {
          const plantedSeed = entity as SpacetimeDBPlantedSeed;
          const plantedSeedImg = doodadImagesRef.current?.get('planted_seed.png');
          
          // Check if this is an underwater planted seed (seaweed)
          const isUnderwaterPlant = plantedSeed.plantType?.tag === 'SeaweedBed';
          
          if (isUnderwaterPlant) {
              // Underwater seaweed rendering with visibility from both above and below water
              const viewingFromAbove = !isLocalPlayerSnorkeling;
              
              if (viewingFromAbove) {
                  // Viewing seaweed from above water - apply blur and transparency
                  const savedFilter = ctx.filter;
                  ctx.filter = 'blur(2px)';
                  ctx.globalAlpha = 0.6; // Semi-transparent when viewed from above
                  renderPlantedSeed(ctx, plantedSeed, nowMs, cycleProgress, plantedSeedImg);
                  ctx.filter = savedFilter;
                  ctx.globalAlpha = 1.0;
              } else {
                  // Underwater view - render clearly with teal underwater tint
                  ctx.save();
                  ctx.globalAlpha = 1.0;
                  // Apply subtle teal tint for underwater ambiance
                  ctx.filter = 'sepia(20%) hue-rotate(140deg) saturate(120%)';
                  renderPlantedSeed(ctx, plantedSeed, nowMs, cycleProgress, plantedSeedImg);
                  ctx.restore();
              }
          } else {
              // Normal land-based planted seeds
              renderPlantedSeed(ctx, plantedSeed, nowMs, cycleProgress, plantedSeedImg);
          }
      } else if (type === 'rain_collector') {
          const rainCollector = entity as SpacetimeDBRainCollector;
          renderRainCollector(ctx, rainCollector, nowMs, cycleProgress, undefined, undefined, localPlayerPosition ?? undefined);
          
          // Check if this rain collector is the closest interactable target
          const isTheClosestTarget = closestInteractableTarget && 
                                   closestInteractableTarget.type === 'rain_collector' && 
                                   closestInteractableTarget.id.toString() === rainCollector.id.toString();
          
          // Draw outline only if this is THE closest interactable target
          if (isTheClosestTarget) {
              const outlineColor = getInteractionOutlineColor('open');
              // Select config based on monument status
              const config = isCompoundMonument(rainCollector.isMonument, rainCollector.posX, rainCollector.posY)
                  ? ENTITY_VISUAL_CONFIG.monument_rain_collector
                  : ENTITY_VISUAL_CONFIG.rain_collector;
              const outline = getInteractionOutlineParams(rainCollector.posX, rainCollector.posY, config);
              drawInteractionOutline(ctx, outline.x, outline.y, outline.width, outline.height, cycleProgress, outlineColor);
          }
      } else if (type === 'wild_animal') {
          const wildAnimal = entity as SpacetimeDBWildAnimal;
          const skipWildAnimalUnderwater = isWildAnimalOccludedWhenSnorkeling(
              wildAnimal,
              Boolean(isLocalPlayerSnorkeling),
          );

          if (!skipWildAnimalUnderwater) {
              renderWildAnimal({
                  ctx,
                  animal: wildAnimal,
                  nowMs,
                  cycleProgress,
                  animationFrame,
                  localPlayerPosition: localPlayerPosition || { x: 0, y: 0 },
                  isLocalPlayerSnorkeling, // Pass snorkeling state for underwater rendering (sharks)
                  isOnWaterTile: (worldX: number, worldY: number) => {
                      if (!connection) return false;
                      const { tileX, tileY } = worldPosToTileCoords(worldX, worldY);
                      const tileType = getTileTypeFromChunkData(connection, tileX, tileY);
                      return isWaterTileTag(tileType);
                  },
                  caribouBreedingData, // Pass breeding data for age-based size scaling
                  walrusBreedingData, // Pass breeding data for age-based size scaling
              });

              // Render thought bubbles for tamed animals (hearts, crying, etc.)
              renderTamingThoughtBubbles({
                  ctx,
                  animal: wildAnimal,
                  nowMs,
              });

              // Render pregnancy indicator thought bubble for pregnant caribou/walrus (both wild and tamed)
              renderPregnancyIndicator({
                  ctx,
                  animal: wildAnimal,
                  nowMs,
                  caribouBreedingData,
                  walrusBreedingData,
              });

              // Check if this animal is the closest milkable target
              const isMilkableTarget = closestInteractableTarget?.type === 'milkable_animal' &&
                  closestInteractableTarget?.id === wildAnimal.id;
              if (isMilkableTarget) {
                  const outlineColor = getInteractionOutlineColor('open');
                  const config = ENTITY_VISUAL_CONFIG.milkable_animal;
                  const outline = getInteractionOutlineParams(wildAnimal.posX, wildAnimal.posY, config);
                  drawInteractionOutline(ctx, outline.x, outline.y, outline.width, outline.height, cycleProgress, outlineColor);
              }
          }
      } else if (type === 'animal_corpse') {
          const animalCorpse = entity as SpacetimeDBAnimalCorpse;
          if (isLocalPlayerSnorkeling) {
              // Underwater view - apply teal tint (shark/jellyfish corpses spawn in water)
              ctx.save();
              ctx.globalAlpha = 1.0;
              ctx.filter = 'sepia(20%) hue-rotate(140deg) saturate(120%)';
              renderAnimalCorpse(ctx, animalCorpse, nowMs);
              ctx.restore();
          } else {
              renderAnimalCorpse(ctx, animalCorpse, nowMs);
          }
      } else if (type === 'barrel') {
          const barrel = entity as any; // Use any for now, will be properly typed
          // Check if this barrel is the closest interactable target  
          const isTheClosestTarget = closestInteractableTarget?.type === 'barrel' && closestInteractableTarget?.id === barrel.id;
          
          // Create callback to check if barrel is on a sea tile
          // This prevents sea barrel water effects from rendering when barrels are on land (e.g., beach)
          const isOnOpenWaterTile = (worldX: number, worldY: number): boolean => {
              if (!connection) return false;
              const { tileX, tileY } = worldPosToTileCoords(worldX, worldY);
              const tileType = getTileTypeFromChunkData(connection, tileX, tileY);
              return isWaterTileTag(tileType);
          };

          // Render barrel - skip water shadow (drawn in early pass so swimming player bottom half renders on top)
          renderBarrel(ctx, barrel, nowMs, cycleProgress, isOnOpenWaterTile, localPlayerPosition?.x, localPlayerPosition?.y, true);
          
          // Draw outline only if this is THE closest interactable target
          if (isTheClosestTarget) {
              const outlineColor = getInteractionOutlineColor('open');
              const config = ENTITY_VISUAL_CONFIG.barrel;
              const outline = getInteractionOutlineParams(barrel.posX, barrel.posY, config);
              drawInteractionOutline(ctx, outline.x, outline.y, outline.width, outline.height, cycleProgress, outlineColor);
          }
      } else if (type === 'road_lamppost') {
          const lamppost = entity as any; // RoadLamppost from SpacetimeDB
          renderRoadLamppost(ctx, lamppost, cameraOffsetX, cameraOffsetY, nowMs, cycleProgress, localPlayerPosition);
      } else if (type === 'sea_stack') {
          const seaStack = entity as any; // Sea stack from SpacetimeDB
          // Skip top half rendering when snorkeling - underwater silhouettes are rendered elsewhere
          if (!isLocalPlayerSnorkeling) {
            // Render ONLY top half - bottom half is rendered separately before swimming players
            renderSeaStackSingle(ctx, seaStack, doodadImagesRef.current, cycleProgress, nowMs, 'top', localPlayerPosition);
          }
      } else if (type === 'homestead_hearth') {
          const hearth = entity as SpacetimeDBHomesteadHearth;
          // Check if this hearth is the closest interactable target
          const isTheClosestTarget = closestInteractableTarget?.type === 'homestead_hearth' && closestInteractableTarget?.id === hearth.id;
          // Render hearth using imported function
          renderHearth(ctx, hearth, nowMs, cycleProgress);
          
          // Draw outline only if this is THE closest interactable target
          if (isTheClosestTarget) {
              const outlineColor = getInteractionOutlineColor('open');
              const config = ENTITY_VISUAL_CONFIG.homestead_hearth;
              const outline = getInteractionOutlineParams(hearth.posX, hearth.posY, config);
              drawInteractionOutline(ctx, outline.x, outline.y, outline.width, outline.height, cycleProgress, outlineColor);
          }
      } else if (type === 'fumarole') {
          const fumarole = entity as SpacetimeDBFumarole;
          const isTheClosestTarget = closestInteractableTarget?.type === 'fumarole' && closestInteractableTarget?.id === fumarole.id;
          
          // Submerged fumaroles (underwater) - render with blur when viewed from above water
          const viewingSubmergedFromAbove = fumarole.isSubmerged && !isLocalPlayerSnorkeling;
          const applyUnderwaterTint = fumarole.isSubmerged && isLocalPlayerSnorkeling;
          
          if (viewingSubmergedFromAbove) {
              // Save current filter and apply underwater blur effect (viewing through water surface)
              const savedFilter = ctx.filter;
              ctx.filter = 'blur(2px)';
              ctx.globalAlpha = 0.7; // Slightly transparent when viewed from above
              renderFumarole(ctx, fumarole, nowMs, cycleProgress);
              ctx.filter = savedFilter;
              ctx.globalAlpha = 1.0;
          } else if (applyUnderwaterTint) {
              // Underwater view - render with CSS filter teal tint (consistent with other underwater entities)
              ctx.save();
              ctx.globalAlpha = 1.0;
              ctx.filter = 'sepia(20%) hue-rotate(140deg) saturate(120%)';
              renderFumarole(ctx, fumarole, nowMs, cycleProgress);
              ctx.restore();
          } else {
              // Normal rendering (non-submerged fumaroles)
              renderFumarole(ctx, fumarole, nowMs, cycleProgress);
          }
          
          if (isTheClosestTarget && !viewingSubmergedFromAbove) {
              const outlineColor = getInteractionOutlineColor('open');
              const config = ENTITY_VISUAL_CONFIG.fumarole;
              const outline = getInteractionOutlineParams(fumarole.posX, fumarole.posY, config);
              drawInteractionOutline(ctx, outline.x, outline.y, outline.width, outline.height, cycleProgress, outlineColor);
          }
      } else if (type === 'basalt_column') {
          const basaltColumn = entity as SpacetimeDBBasaltColumn;
          // console.log('🗿 [RENDER] Rendering basalt column', basaltColumn.id, 'at', basaltColumn.posX, basaltColumn.posY);
          renderBasaltColumn(ctx, basaltColumn, nowMs, cycleProgress, localPlayerPosition);
      } else if (type === 'living_coral') {
          const livingCoral = entity as SpacetimeDBLivingCoral;
          // Living coral - render with blur when viewed from above water (not snorkeling)
          const viewingCoralFromAbove = !isLocalPlayerSnorkeling;
          
          if (viewingCoralFromAbove) {
              // Save current filter and apply underwater blur effect (viewing through water surface)
              const savedFilter = ctx.filter;
              ctx.filter = 'blur(2px)';
              ctx.globalAlpha = 0.6; // More transparent when viewed from above water
              renderLivingCoral(ctx, livingCoral, nowMs, cycleProgress);
              ctx.filter = savedFilter;
              ctx.globalAlpha = 1.0;
          } else {
              // Underwater view - render with CSS filter teal tint (consistent with other underwater entities)
              ctx.save();
              ctx.globalAlpha = 1.0;
              ctx.filter = 'sepia(20%) hue-rotate(140deg) saturate(120%)';
              renderLivingCoral(ctx, livingCoral, nowMs, cycleProgress);
              ctx.restore();
          }
      } else if (type === 'alk_station') {
          const alkStation = entity as SpacetimeDBAlkStation;
          const isTheClosestTarget = closestInteractableTarget?.type === 'alk_station' && closestInteractableTarget?.id === alkStation.stationId;
          
          const showSafeZone = shouldShowBuildingRestrictionOverlay(
              placementInfo,
              localPlayerId,
              activeEquipments,
              itemDefinitions
          );
          
          // console.log('🏭 [RENDER] Rendering ALK station', alkStation.stationId, 'at', alkStation.worldPosX, alkStation.worldPosY);
          renderAlkStation(ctx, alkStation, cycleProgress, isTheClosestTarget, undefined, localPlayerPosition, showSafeZone);
          
          // Draw outline only if this is THE closest interactable target
          if (isTheClosestTarget) {
              const outlineColor = getInteractionOutlineColor('open');
              const config = ENTITY_VISUAL_CONFIG.alk_station;
              const outline = getInteractionOutlineParams(alkStation.worldPosX, alkStation.worldPosY, config);
              drawInteractionOutline(ctx, outline.x, outline.y, outline.width, outline.height, cycleProgress, outlineColor);
          }
      } else if (type === 'compound_building' || type === 'monument_doodad') {
          // compound_building: static ALK compound (barracks, garage, shed). monument_doodad: monument parts (shipwreck, fishing village, etc.)
          const buildingEntity = entity as CompoundBuildingEntity;
          
          // Draw all monument doodads (including village campfires) in main loop for correct Y-sorting with player.
          // Fire/smoke particles render in a separate pass and appear on top.
          // The entity already has all the data we need from EntityFilteringRuntime
          // Convert it to CompoundBuilding format for renderMonument
          const buildingForRendering = {
              id: buildingEntity.id,
              offsetX: 0, // Not used by renderMonument (uses worldX/worldY directly)
              offsetY: 0,
              imagePath: buildingEntity.imagePath,
              width: buildingEntity.width,
              height: buildingEntity.height,
              anchorYOffset: buildingEntity.anchorYOffset,
              collisionRadius: 0, // Not used for rendering
              collisionYOffset: 0,
              rotationRad: buildingEntity.rotationRad ?? 0,
          };
          
          // renderMonument expects world position, so we need to pass it directly
          // Override getBuildingWorldPosition by passing worldX/worldY in the building object
          const buildingWithWorldPos = {
              ...buildingForRendering,
              worldX: buildingEntity.worldX,
              worldY: buildingEntity.worldY,
          };
          
          // Skip sprite rendering for center-only parts with no image (e.g. weather station center)
          if (buildingEntity.imagePath && buildingEntity.imagePath.length > 0) {
              const isOnSeaTileForMonument = connection
                  ? (worldX: number, worldY: number): boolean => {
                      const { tileX, tileY } = worldPosToTileCoords(worldX, worldY);
                      const tileType = getTileTypeFromChunkData(connection!, tileX, tileY);
                      return isOceanTileTag(tileType);
                  }
                  : undefined;
              renderMonument(ctx, buildingWithWorldPos as any, cycleProgress, localPlayerPosition, doodadImagesRef, isOnSeaTileForMonument, nowMs);
          }
          
          // Runs for all monument_doodad, including center-only weather station markers.
          const showBuildingRestriction = shouldShowBuildingRestrictionOverlay(
              placementInfo,
              localPlayerId,
              activeEquipments,
              itemDefinitions
          );
          
          // Render building restriction overlay for monuments (shipwrecks, fishing villages, whale bone graveyards, hunting villages)
          if (showBuildingRestriction && buildingEntity.isCenter) {
              const restrictionRadius = getMonumentRestrictionRadius(buildingEntity.id);
              
              if (restrictionRadius > 0) {
                  const zoneConfig: BuildingRestrictionZoneConfig = {
                      centerX: buildingEntity.worldX,
                      centerY: buildingEntity.worldY,
                      radius: restrictionRadius,
                  };
                  renderBuildingRestrictionOverlay(ctx, zoneConfig);
              }
          }
      } else if (type === 'foundation_cell') {
          const foundation = entity as SpacetimeDBFoundationCell;
          // Foundations use cell coordinates directly - renderFoundation handles conversion
          renderFoundation({
              ctx,
              foundation: foundation,
              worldScale: 1.0,
              viewOffsetX: -cameraOffsetX, // Convert camera offset to view offset
              viewOffsetY: -cameraOffsetY,
              foundationTileImagesRef: foundationTileImagesRef,
              allFoundations: allFoundations, // Pass all foundations to check for adjacent foundations
          });
      } else if (type === 'swimmingPlayerTopHalf') {
          // Phase 3c: Rendered by GameCanvas before batching - never in renderYSortedEntities batch
          return;
      } else if (type === 'shelter') {
          // Shelters are fully rendered in the first pass, including shadows.
          // No action needed in this second (shadow-only) pass.
      } else {
          console.warn('Unhandled entity type for Y-sorting (first pass):', type, entity);
      } 
  });

  // PASS 1.5: Render particle effects (AFTER entities so particles appear on top)
  // Note: this function runs once per swim-split batch in renderEntityWorldPasses; tree/stone/coral
  // hit FX integrate physics by wall-clock delta so batches do not multiply simulation speed.

  // Hit impact effects (small chips flying off when attacking - triggered every hit)
  renderTreeHitEffects(ctx, nowMs);    // Bark chips, leaves, splinters
  renderStoneHitEffects(ctx, nowMs);   // Rock chips, sparks
  renderCoralHitEffects(ctx, nowMs);   // Coral fragments, bubbles
  
  // Destruction effects (big debris explosions when entity is fully destroyed)
  renderTreeImpactEffects(ctx, nowMs);     // Twigs, leaves, dirt, dust cloud from falling trees
  renderStoneDestructionEffects(ctx, nowMs); // Rock chunks, sparks, dust cloud from mined stones
  renderBarrelDestructionEffects(ctx, nowMs); // Barrel sprite chunks explode radially
  renderAnimalCorpseDestructionEffects(ctx, nowMs); // Corpse sprite chunks burst apart when fully harvested
  renderCoralDestructionEffects(ctx, nowMs); // Coral fragments, bubbles, sand cloud from harvested coral

  // PASS 2: REMOVED - North walls are now rendered in Pass 1 for correct Y-sorting with players/placeables
  // This fixes the issue where north walls would always render on top of entities on the tile south of the foundation
  // The Y-sort comparator correctly positions players/placeables after north walls when they're south of the wall
  // See Pass 1 above for the new wall_cell handling logic

  // PASS 2.5: Render north doors (edge 0) BEFORE ceiling tiles
  // North doors need to be covered by ceiling tiles to hide the interior
  for (const door of doorEntities) {
          // Only render north doors (edge 0) in this pass - they render before ceiling tiles
          if (door.edge !== 0) {
              continue;
          }
          
          // Get door sprite images based on type and edge (North)
          const doorType = door.doorType;
          
          // Select correct image based on door type
          let woodDoorImage: HTMLImageElement | null = null;
          let metalDoorImage: HTMLImageElement | null = null;
          
          if (doorType === 0) {
              // Wood door (north)
              woodDoorImage = doodadImagesRef?.current?.get('wood_door_north.png') || null;
          } else {
              // Metal door (north)
              metalDoorImage = doodadImagesRef?.current?.get('metal_door_north.png') || null;
          }
          
          // Check if this door is highlighted (closest interactable)
          const isHighlighted = closestInteractableDoorId !== null && closestInteractableDoorId !== undefined &&
              door.id.toString() === closestInteractableDoorId.toString();
          
          renderDoor({
              ctx,
              door,
              woodDoorImage,
              metalDoorImage,
              isHighlighted,
          });
  }

  // PASS 3: REMOVED - East/west/diagonal walls are now rendered in Pass 1 for correct Y-sorting
  // This ensures all non-south walls are rendered in their proper Y-sorted position relative to players/placeables
  // See Pass 1 above for the new wall_cell handling logic

  // PASS 4: Render exterior wall shadows BEFORE ceiling tiles so the tiles occlude them
  for (const wall of wallEntities) {
          // Skip triangle foundations - their exterior shadows are rendered in the first pass
          const isTriangleFoundation = wall.foundationShape >= 2 && wall.foundationShape <= 5;
          // Skip north walls (edge === 0) - their exterior shadows are rendered in the first pass
          const isNorthWall = wall.edge === 0;
          if (!isTriangleFoundation && !isNorthWall) {
              renderWallExteriorShadow({
                  ctx,
                  wall: wall as any,
                  worldScale: 1.0,
                  cycleProgress,
                  viewOffsetX: -cameraOffsetX,
                  viewOffsetY: -cameraOffsetY,
              });
          }
  }

  // PASS 5: Render ceiling tiles (AFTER east/west walls & exterior shadows, but BEFORE south walls)
  // CRITICAL: Ceiling tiles must render between east/west walls and south walls
  for (const fogEntity of fogOverlayEntities) {
          // Save context and ensure ceiling tiles render with full opacity on top
          ctx.save();
          ctx.globalAlpha = 1.0; // Ensure full opacity
          ctx.globalCompositeOperation = 'source-over'; // Ensure normal blending

          // Render fog overlay (ceiling tile image)
          // Note: renderFogOverlayCluster has its own save/restore, but we wrap it to ensure proper state
          renderFogOverlayCluster({
              ctx,
              bounds: fogEntity.bounds,
              worldScale: 1.0,
              viewOffsetX: -cameraOffsetX,
              viewOffsetY: -cameraOffsetY,
              foundationTileImagesRef: foundationTileImagesRef,
              entranceWayFoundations: fogEntity.entranceWayFoundationSet,
              clusterFoundationCoords: fogEntity.clusterFoundationCoordSet,
              northWallFoundations: fogEntity.northWallFoundationSet,
              southWallFoundations: fogEntity.southWallFoundationSet,
          });
          
          // Restore context
          ctx.restore();
  }

  // NOTE: Pass 6 (south walls) was removed - south walls now render in Pass 1 with proper Y-sorting
  // This fixes the bug where south walls would always render on top of players/trees regardless of Y-position

  // PASS 6: Render south doors (edge 2) AFTER ceiling tiles (so they appear ON TOP)
  // South doors need to render above ceiling tiles to be visible
  // NOTE: North doors (edge 0) were already rendered in PASS 2.5 before ceiling tiles
  for (const door of doorEntities) {
          // Only render south doors (edge 2) in this pass - north doors were rendered in PASS 2.5
          if (door.edge !== 2) {
              continue;
          }
          
          // Get door sprite images based on type (South)
          const doorType = door.doorType;
          
          // Select correct image based on door type
          let woodDoorImage: HTMLImageElement | null = null;
          let metalDoorImage: HTMLImageElement | null = null;
          
          if (doorType === 0) {
              // Wood door (south)
              woodDoorImage = doodadImagesRef?.current?.get('wood_door.png') || null;
          } else {
              // Metal door (south)
              metalDoorImage = doodadImagesRef?.current?.get('metal_door.png') || null;
          }
          
          // Check if this door is highlighted (closest interactable)
          const isHighlighted = closestInteractableDoorId !== null && closestInteractableDoorId !== undefined &&
              door.id.toString() === closestInteractableDoorId.toString();
          
          renderDoor({
              ctx,
              door,
              woodDoorImage,
              metalDoorImage,
              isHighlighted,
              localPlayerPosition,
          });
  }

  // PASS 7: Render large quarry building restriction zones when Blueprint equipped or placing a placeable item
  // Large quarries are monuments that should show restriction zones similar to ALK stations and rune stones
  if (largeQuarries && largeQuarries.size > 0) {
      const showBuildingRestriction = shouldShowBuildingRestrictionOverlay(
          placementInfo,
          localPlayerId,
          activeEquipments,
          itemDefinitions
      );
      
      if (showBuildingRestriction) {
          renderMultipleBuildingRestrictionOverlays(ctx, buildLargeQuarryRestrictionZones(largeQuarries));
      }
  }

  // PASS 8: Render hot spring building restriction zones when Blueprint equipped or placing a placeable item
  // Hot springs are monument areas with 800px restriction radius around their detected centers
  if (detectedHotSprings && detectedHotSprings.length > 0) {
      const showBuildingRestriction = shouldShowBuildingRestrictionOverlay(
          placementInfo,
          localPlayerId,
          activeEquipments,
          itemDefinitions
      );
      
      if (showBuildingRestriction) {
          renderMultipleBuildingRestrictionOverlays(ctx, buildHotSpringRestrictionZones(detectedHotSprings));
      }
  }

  // PASS 9: Render small quarry building restriction zones when Blueprint equipped or placing a placeable item
  // Small quarries are tile-based monument areas - server checks 800px from ANY quarry tile
  if (detectedQuarries && detectedQuarries.length > 0) {
      const showBuildingRestriction = shouldShowBuildingRestrictionOverlay(
          placementInfo,
          localPlayerId,
          activeEquipments,
          itemDefinitions
      );
      
      if (showBuildingRestriction) {
          renderMultipleBuildingRestrictionOverlays(ctx, buildSmallQuarryRestrictionZones(detectedQuarries));
      }
  }

  // PASS: Health bar overlay - render ON TOP of barrels, doodads, and other world objects
  const playerX = localPlayerPosition?.x ?? 0;
  const playerY = localPlayerPosition?.y ?? 0;
  renderHealthBarOverlay({ ctx, ySortedEntities, nowMs: nowMs, playerX, playerY });
};
