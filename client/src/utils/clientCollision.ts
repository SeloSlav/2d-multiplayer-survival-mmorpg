// AAA-Quality Client-side Collision Detection System
import { Player, Tree, Stone, WoodenStorageBox, Shelter, RainCollector, WildAnimal, Barrel, Furnace } from '../generated';
import { gameConfig } from '../config/gameConfig';

// Add at top after imports:
// Spatial filtering constants
const COLLISION_QUERY_EXPANSION = 100; // Extra padding around movement path for safety

// Helper to check if shape intersects with query box
function shapeIntersectsBox(shape: CollisionShape, minX: number, minY: number, maxX: number, maxY: number): boolean {
  if (shape.radius) {
    // Circle check
    const centerX = shape.x;
    const centerY = shape.y;
    const closestX = Math.max(minX, Math.min(centerX, maxX));
    const closestY = Math.max(minY, Math.min(centerY, maxY));
    const dx = centerX - closestX;
    const dy = centerY - closestY;
    return (dx * dx + dy * dy) <= (shape.radius * shape.radius);
  } else if (shape.width && shape.height) {
    // AABB check
    const shapeMinX = shape.x - shape.width / 2;
    const shapeMinY = shape.y - shape.height / 2;
    const shapeMaxX = shape.x + shape.width / 2;
    const shapeMaxY = shape.y + shape.height / 2;
    return !(shapeMaxX < minX || shapeMinX > maxX || shapeMaxY < minY || shapeMinY > maxY);
  }
  return false;
}

// ===== COLLISION PERFORMANCE LOGGING =====
let lastCollisionLog = 0;
const COLLISION_LOG_INTERVAL = 1000; // Log every 1 second
const COLLISION_LAG_THRESHOLD = 30; // Log if collision check takes more than 30ms

function logCollisionPerformance(
  processingTime: number,
  entityCount: number,
  playerPos: { x: number; y: number },
  collisionShapes: number,
  isEmergency: boolean
) {
  const now = Date.now();
  const isLagSpike = processingTime > COLLISION_LAG_THRESHOLD;
  const shouldLog = isLagSpike || (now - lastCollisionLog > COLLISION_LOG_INTERVAL);
  
  if (shouldLog) {
    const prefix = isLagSpike ? "🔥 [COLLISION LAG]" : "🚀 [COLLISION]";
    console.log(`${prefix} ${entityCount} entities, ${collisionShapes} collision shapes, ${processingTime.toFixed(2)}ms`);
    // console.log(`  📍 Player position: (${playerPos.x.toFixed(0)}, ${playerPos.y.toFixed(0)})`);
    // console.log(`  🚨 Emergency mode: ${isEmergency ? 'ACTIVE' : 'INACTIVE'}`);
    
    if (isLagSpike) {
      console.log(`  ⚠️ COLLISION LAG SPIKE! Processing time: ${processingTime.toFixed(2)}ms`);
    }
    
    lastCollisionLog = now;
  }
}

// ===== CONFIGURATION CONSTANTS =====
const WORLD_WIDTH_PX = gameConfig.worldWidthPx;
const WORLD_HEIGHT_PX = gameConfig.worldHeightPx;
const PLAYER_RADIUS = 32;

// ===== PERFORMANCE OPTIMIZATION CONSTANTS =====
const COLLISION_PERF = {
  // Aggressive distance-based culling (squared for performance)
  PLAYER_CULL_DISTANCE_SQ: 200 * 200,    // Only check players within 200px
  TREE_CULL_DISTANCE_SQ: 250 * 250,      // Only check trees within 250px
  STONE_CULL_DISTANCE_SQ: 150 * 150,     // Only check stones within 150px
  ANIMAL_CULL_DISTANCE_SQ: 300 * 300,    // Only check animals within 300px
  STRUCTURE_CULL_DISTANCE_SQ: 200 * 200, // Only check structures within 200px
  
  // Entity limiting for performance
  MAX_PLAYERS_TO_CHECK: 20,
  MAX_TREES_TO_CHECK: 30,
  MAX_STONES_TO_CHECK: 20,
  MAX_ANIMALS_TO_CHECK: 15,
  MAX_STRUCTURES_TO_CHECK: 25,
  
  // Emergency mode thresholds
  EMERGENCY_TOTAL_ENTITIES: 100,
  EMERGENCY_CULL_DISTANCE_SQ: 100 * 100,
  EMERGENCY_MAX_ENTITIES: 10,
};

// Performance monitoring
let frameCounter = 0;
let lastPerformanceLog = 0;

// Spatial partitioning cache
const spatialCache = new Map<string, {
  entities: any[];
  lastUpdate: number;
  centerX: number;
  centerY: number;
}>();

// Helper function to efficiently filter and limit entities by distance
function filterEntitiesByDistance<T extends { posX?: number; posY?: number; positionX?: number; positionY?: number }>(
  entities: Map<string, T>,
  playerX: number,
  playerY: number,
  maxDistanceSq: number,
  maxCount: number,
  emergencyMode: boolean = false
): T[] {
  if (!entities || entities.size === 0) return [];
  
  const effectiveMaxDistance = emergencyMode ? COLLISION_PERF.EMERGENCY_CULL_DISTANCE_SQ : maxDistanceSq;
  const effectiveMaxCount = emergencyMode ? COLLISION_PERF.EMERGENCY_MAX_ENTITIES : maxCount;
  
  const withDistance = Array.from(entities.values())
    .map(entity => {
      const entityX = entity.posX ?? entity.positionX ?? 0;
      const entityY = entity.posY ?? entity.positionY ?? 0;
      const dx = entityX - playerX;
      const dy = entityY - playerY;
      return { entity, distanceSq: dx * dx + dy * dy, x: entityX, y: entityY };
    })
    .filter(item => item.distanceSq <= effectiveMaxDistance)
    .sort((a, b) => a.distanceSq - b.distanceSq) // Sort by distance (closest first)
    .slice(0, effectiveMaxCount)
    .map(item => item.entity);
  
  return withDistance;
}

// Optimized spatial partitioning for collision detection
function getCollisionCandidates(
  entities: GameEntities,
  playerX: number,
  playerY: number,
  localPlayerId: string
): CollisionShape[] {
  frameCounter++;
  
  // Count total entities to determine emergency mode
  const totalEntities = entities.trees.size + entities.stones.size + 
                       entities.boxes.size + entities.players.size + 
                       entities.wildAnimals.size + entities.barrels.size;
  
  const emergencyMode = totalEntities > COLLISION_PERF.EMERGENCY_TOTAL_ENTITIES;
  
  // Performance logging (throttled)
  if (frameCounter % 300 === 0) { // Log every 5 seconds at 60fps
    const now = performance.now();
    if (now - lastPerformanceLog > 4000) { // Don't log more than once per 4 seconds
      console.log(`🚀 [COLLISION] ${totalEntities} entities, emergency=${emergencyMode}`);
      lastPerformanceLog = now;
    }
  }
  
  const shapes: CollisionShape[] = [];
  
  // PERFORMANCE: Aggressively filter each entity type
  
  // Filter other players
  const nearbyPlayers = filterEntitiesByDistance(
    entities.players,
    playerX,
    playerY,
    COLLISION_PERF.PLAYER_CULL_DISTANCE_SQ,
    COLLISION_PERF.MAX_PLAYERS_TO_CHECK,
    emergencyMode
  );
  
  for (const player of nearbyPlayers) {
    const playerId = player.identity.toHexString();
    if (playerId === localPlayerId || player.isDead) continue;
    
    shapes.push({
      id: playerId,
      type: `player-${playerId.substring(0, 8)}`,
      x: player.positionX,
      y: player.positionY,
      radius: COLLISION_RADII.PLAYER
    });
  }
  
  // Filter trees
  const nearbyTrees = filterEntitiesByDistance(
    entities.trees,
    playerX,
    playerY,
    COLLISION_PERF.TREE_CULL_DISTANCE_SQ,
    COLLISION_PERF.MAX_TREES_TO_CHECK,
    emergencyMode
  );
  
  for (const tree of nearbyTrees) {
    if (tree.health <= 0) continue;
    
    shapes.push({
      id: tree.id.toString(),
      type: `tree-${tree.id.toString()}`,
      x: tree.posX + COLLISION_OFFSETS.TREE.x,
      y: tree.posY + COLLISION_OFFSETS.TREE.y,
      radius: COLLISION_RADII.TREE
    });
  }
  
  // Filter stones
  const nearbyStones = filterEntitiesByDistance(
    entities.stones,
    playerX,
    playerY,
    COLLISION_PERF.STONE_CULL_DISTANCE_SQ,
    COLLISION_PERF.MAX_STONES_TO_CHECK,
    emergencyMode
  );
  
  for (const stone of nearbyStones) {
    if (stone.health <= 0) continue;
    
    shapes.push({
      id: stone.id.toString(),
      type: `stone-${stone.id.toString()}`,
      x: stone.posX + COLLISION_OFFSETS.STONE.x,
      y: stone.posY + COLLISION_OFFSETS.STONE.y,
      radius: COLLISION_RADII.STONE
    });
  }
  
  // Filter wild animals
  const nearbyAnimals = filterEntitiesByDistance(
    entities.wildAnimals,
    playerX,
    playerY,
    COLLISION_PERF.ANIMAL_CULL_DISTANCE_SQ,
    COLLISION_PERF.MAX_ANIMALS_TO_CHECK,
    emergencyMode
  );
  
  for (const animal of nearbyAnimals) {
    shapes.push({
      id: animal.id.toString(),
      type: `animal-${animal.id.toString()}`,
      x: animal.posX + COLLISION_OFFSETS.WILD_ANIMAL.x,
      y: animal.posY + COLLISION_OFFSETS.WILD_ANIMAL.y,
      radius: COLLISION_RADII.WILD_ANIMAL
    });
  }
  
  // Filter structures (boxes, barrels, etc.)
  const nearbyBoxes = filterEntitiesByDistance(
    entities.boxes,
    playerX,
    playerY,
    COLLISION_PERF.STRUCTURE_CULL_DISTANCE_SQ,
    COLLISION_PERF.MAX_STRUCTURES_TO_CHECK,
    emergencyMode
  );
  
  for (const box of nearbyBoxes) {
    shapes.push({
      id: box.id.toString(),
      type: `box-${box.id.toString()}`,
      x: box.posX + COLLISION_OFFSETS.STORAGE_BOX.x,
      y: box.posY + COLLISION_OFFSETS.STORAGE_BOX.y,
      radius: COLLISION_RADII.STORAGE_BOX
    });
  }
  
  const nearbyBarrels = filterEntitiesByDistance(
    entities.barrels,
    playerX,
    playerY,
    COLLISION_PERF.STRUCTURE_CULL_DISTANCE_SQ,
    COLLISION_PERF.MAX_STRUCTURES_TO_CHECK,
    emergencyMode
  );
  
  for (const barrel of nearbyBarrels) {
    if (barrel.respawnAt) continue; // Skip destroyed barrels
    
    shapes.push({
      id: barrel.id.toString(),
      type: `barrel-${barrel.id.toString()}`,
      x: barrel.posX + COLLISION_OFFSETS.BARREL.x,
      y: barrel.posY + COLLISION_OFFSETS.BARREL.y,
      radius: COLLISION_RADII.BARREL
    });
  }
  
  // Filter furnaces
  const nearbyFurnaces = filterEntitiesByDistance(
    entities.furnaces,
    playerX,
    playerY,
    COLLISION_PERF.STRUCTURE_CULL_DISTANCE_SQ,
    COLLISION_PERF.MAX_STRUCTURES_TO_CHECK,
    emergencyMode
  );
  
  for (const furnace of nearbyFurnaces) {
    if (furnace.isDestroyed) continue; // Skip destroyed furnaces
    
    shapes.push({
      id: furnace.id.toString(),
      type: `furnace-${furnace.id.toString()}`,
      x: furnace.posX + COLLISION_OFFSETS.FURNACE.x,
      y: furnace.posY + COLLISION_OFFSETS.FURNACE.y,
      radius: COLLISION_RADII.FURNACE
    });
  }
  
  return shapes;
}

// Unified collision radii for consistency - match visual sprite sizes
const COLLISION_RADII = {
  TREE: 38,
  STONE: 28,       // Smaller radius for flattened stones
  STORAGE_BOX: 25, // Much tighter radius for boxes
  RAIN_COLLECTOR: 30, // Increased to match server-side for easier targeting
  FURNACE: 20, // Adjusted radius for easier bottom approach while keeping top collision
  PLAYER: PLAYER_RADIUS,
  WILD_ANIMAL: 40, // Add wild animal collision radius
  BARREL: 25, // Smaller barrel collision radius for better accuracy
} as const;

// Collision offsets for sprite positioning - align with visual sprite base
const COLLISION_OFFSETS = {
  TREE: { x: 0, y: -68 },      // Adjusted to keep top boundary similar while squishing from bottom
  STONE: { x: 0, y: -72 },     // Small circle positioned at visual stone base
  STORAGE_BOX: { x: 0, y: -70 }, // Small circle positioned at visual box base
  RAIN_COLLECTOR: { x: 0, y: 0 }, // Pushed down to align with visual base
  FURNACE: { x: 0, y: -50 }, // Adjusted center to extend collision below while keeping top boundary
  SHELTER: { x: 0, y: -200 },  // Shelter offset unchanged
  WILD_ANIMAL: { x: 0, y: 0 }, // No offset needed for animals
  BARREL: { x: 0, y: -48 }, // Barrel collision at visual center (matches server)
} as const;

// Shelter AABB dimensions
const SHELTER_DIMS = {
  WIDTH: 300,
  HEIGHT: 125,
} as const;

// Performance optimization - reduce debug in production
const DEBUG_ENABLED = false;

// ===== INTERFACES =====
export interface CollisionResult {
  x: number;
  y: number;
  collided: boolean;
  collidedWith: string[];
}

export interface GameEntities {
  trees: Map<string, Tree>;
  stones: Map<string, Stone>;
  boxes: Map<string, WoodenStorageBox>;
  rainCollectors: Map<string, RainCollector>;
  furnaces: Map<string, Furnace>;
  shelters: Map<string, Shelter>;
  players: Map<string, Player>;
  wildAnimals: Map<string, WildAnimal>; // Add wild animals
  barrels: Map<string, Barrel>; // Add barrels
}

interface CollisionShape {
  id: string;
  type: string;
  x: number;
  y: number;
  radius?: number; // For circular collision
  width?: number;  // For AABB collision
  height?: number; // For AABB collision
}

interface CollisionHit {
  shape: CollisionShape;
  normal: { x: number; y: number };
  penetration: number;
  distance: number;
}

// ===== MAIN COLLISION FUNCTION =====
export function resolveClientCollision(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  localPlayerId: string,
  entities: GameEntities
): CollisionResult {
  // Step 1: Clamp to world bounds
  const clampedTo = clampToWorldBounds(toX, toY);
  
  // Step 2: Check if we actually moved
  const movement = {
    x: clampedTo.x - fromX,
    y: clampedTo.y - fromY
  };
  const moveDistance = Math.sqrt(movement.x * movement.x + movement.y * movement.y);
  
  if (moveDistance < 0.01) {
    return { x: clampedTo.x, y: clampedTo.y, collided: false, collidedWith: [] };
  }

  // Step 3: Build collision shapes from entities - PERFORMANCE: Use optimized collision candidate system
  const collisionStartTime = performance.now();
  const collisionShapes = getCollisionCandidates(entities, fromX, fromY, localPlayerId);
  const collisionEndTime = performance.now();
  const collisionTime = collisionEndTime - collisionStartTime;
  
  // Log collision performance
  const entityCount = (entities.players?.size || 0) + (entities.trees?.size || 0) + 
                     (entities.stones?.size || 0) + (entities.boxes?.size || 0);
  logCollisionPerformance(
    collisionTime,
    entityCount,
    { x: fromX, y: fromY },
    collisionShapes.length,
    entityCount > COLLISION_PERF.EMERGENCY_TOTAL_ENTITIES
  );
  
  // Create query box around movement path
  const queryMinX = Math.min(fromX, toX) - COLLISION_QUERY_EXPANSION - PLAYER_RADIUS;
  const queryMinY = Math.min(fromY, toY) - COLLISION_QUERY_EXPANSION - PLAYER_RADIUS;
  const queryMaxX = Math.max(fromX, toX) + COLLISION_QUERY_EXPANSION + PLAYER_RADIUS;
  const queryMaxY = Math.max(fromY, toY) + COLLISION_QUERY_EXPANSION + PLAYER_RADIUS;

  // Filter shapes to only those intersecting the query box
  const nearbyShapes = collisionShapes.filter(shape =>
    shapeIntersectsBox(shape, queryMinX, queryMinY, queryMaxX, queryMaxY)
  );

  // PERFORMANCE: Reduced logging to prevent console spam
  const totalEntities = entities.trees.size + entities.stones.size + entities.boxes.size + entities.players.size + entities.wildAnimals.size + entities.barrels.size;
  if (totalEntities > 100 && collisionShapes.length > 20) { // Only log when significant optimization occurs
    console.log(`🚀 [COLLISION] Major optimization: ${totalEntities} total entities → ${collisionShapes.length} distance-filtered → ${nearbyShapes.length} final shapes (${Math.round(nearbyShapes.length / totalEntities * 100)}% of total)`);
  }

  // Step 4: Perform swept collision detection
  const result = performSweptCollision(
    { x: fromX, y: fromY },
    clampedTo,
    PLAYER_RADIUS,
    nearbyShapes // Changed from collisionShapes
  );
  
  // Step 5: Final world bounds check
  const finalPos = clampToWorldBounds(result.x, result.y);
  
  return {
    x: finalPos.x,
    y: finalPos.y,
    collided: result.collided,
    collidedWith: result.collidedWith
  };
}

// ===== COLLISION DETECTION CORE =====
function performSweptCollision(
  from: { x: number; y: number },
  to: { x: number; y: number },
  playerRadius: number,
  shapes: CollisionShape[]
): CollisionResult {
  const movement = { x: to.x - from.x, y: to.y - from.y };
  const moveLength = Math.sqrt(movement.x * movement.x + movement.y * movement.y);
  
  if (moveLength < 0.01) {
    return { x: to.x, y: to.y, collided: false, collidedWith: [] };
  }
  
  const moveDir = { x: movement.x / moveLength, y: movement.y / moveLength };
  
  // Find all potential collisions along the movement path
  const hits: CollisionHit[] = [];
  
  for (const shape of shapes) {
    const hit = checkCollisionWithShape(from, to, playerRadius, shape);
    if (hit) {
      hits.push(hit);
    }
  }
  
  if (hits.length === 0) {
    return { x: to.x, y: to.y, collided: false, collidedWith: [] };
  }
  
  // Sort hits by distance (closest first)
  hits.sort((a, b) => a.distance - b.distance);
  
  // Handle the closest collision with sliding
  const primaryHit = hits[0];
  const slideResult = calculateSlideResponse(from, to, moveDir, primaryHit);
  
  if (DEBUG_ENABLED) {
    console.log(`Collision with ${primaryHit.shape.type}, sliding to (${slideResult.x.toFixed(1)}, ${slideResult.y.toFixed(1)})`);
  }
  
  // Collision performance logged earlier in resolveClientCollision
  
  return {
    x: slideResult.x,
    y: slideResult.y,
    collided: true,
    collidedWith: hits.map(h => h.shape.type)
  };
}

function checkCollisionWithShape(
  from: { x: number; y: number },
  to: { x: number; y: number },
  playerRadius: number,
  shape: CollisionShape
): CollisionHit | null {
  if (shape.radius !== undefined) {
    // Circle vs Circle collision
    return checkCircleCollision(from, to, playerRadius, shape);
  } else if (shape.width !== undefined && shape.height !== undefined) {
    // Circle vs AABB collision
    return checkAABBCollision(from, to, playerRadius, shape);
  }
  return null;
}

function checkCircleCollision(
  from: { x: number; y: number },
  to: { x: number; y: number },
  playerRadius: number,
  shape: CollisionShape
): CollisionHit | null {
  const totalRadius = playerRadius + shape.radius!;
  const shapePos = { x: shape.x, y: shape.y };
  
  // Check if we're moving towards the circle
  const toShape = { x: shapePos.x - to.x, y: shapePos.y - to.y };
  const distToShape = Math.sqrt(toShape.x * toShape.x + toShape.y * toShape.y);
  
  if (distToShape >= totalRadius) {
    return null; // No collision
  }
  
  // Calculate collision normal and penetration
  const normal = distToShape > 0.001 
    ? { x: toShape.x / distToShape, y: toShape.y / distToShape }
    : { x: 1, y: 0 }; // Fallback normal
    
  const penetration = totalRadius - distToShape;
  
  return {
    shape,
    normal,
    penetration,
    distance: distToShape
  };
}

function checkAABBCollision(
  from: { x: number; y: number },
  to: { x: number; y: number },
  playerRadius: number,
  shape: CollisionShape
): CollisionHit | null {
  const halfWidth = shape.width! / 2;
  const halfHeight = shape.height! / 2;
  
  const aabbMin = { x: shape.x - halfWidth, y: shape.y - halfHeight };
  const aabbMax = { x: shape.x + halfWidth, y: shape.y + halfHeight };
  
  // Expand AABB by player radius
  const expandedMin = { x: aabbMin.x - playerRadius, y: aabbMin.y - playerRadius };
  const expandedMax = { x: aabbMax.x + playerRadius, y: aabbMax.y + playerRadius };
  
  // Check if player center is inside expanded AABB
  if (to.x < expandedMin.x || to.x > expandedMax.x || 
      to.y < expandedMin.y || to.y > expandedMax.y) {
    return null; // No collision
  }
  
  // Find closest point on original AABB to player center
  const closestX = Math.max(aabbMin.x, Math.min(to.x, aabbMax.x));
  const closestY = Math.max(aabbMin.y, Math.min(to.y, aabbMax.y));
  
  const dx = to.x - closestX;
  const dy = to.y - closestY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  
  if (distance >= playerRadius) {
    return null; // No collision
  }
  
  // Calculate normal and penetration
  let normal: { x: number; y: number };
  let penetration: number;
  
  if (distance < 0.001) {
    // Player center is inside AABB - push to nearest edge
    const distToLeft = to.x - aabbMin.x;
    const distToRight = aabbMax.x - to.x;
    const distToTop = to.y - aabbMin.y;
    const distToBottom = aabbMax.y - to.y;
    
    const minDist = Math.min(distToLeft, distToRight, distToTop, distToBottom);
    
    if (minDist === distToLeft) {
      normal = { x: -1, y: 0 };
      penetration = distToLeft + playerRadius;
    } else if (minDist === distToRight) {
      normal = { x: 1, y: 0 };
      penetration = distToRight + playerRadius;
    } else if (minDist === distToTop) {
      normal = { x: 0, y: -1 };
      penetration = distToTop + playerRadius;
    } else {
      normal = { x: 0, y: 1 };
      penetration = distToBottom + playerRadius;
    }
  } else {
    // Normal collision - push away from closest point
    normal = { x: dx / distance, y: dy / distance };
    penetration = playerRadius - distance;
  }
  
  return {
    shape,
    normal,
    penetration,
    distance
  };
}

function calculateSlideResponse(
    from: { x: number; y: number },
    to: { x: number; y: number },
    moveDir: { x: number; y: number },
    hit: CollisionHit
  ): { x: number; y: number } {
    // 🚀 GRAVITY WELL FIX: Ensure much larger separation to prevent trapping
    const MIN_SEPARATION = 8.0; // Minimum separation distance (was 1.5px, now 8px)
    
    // Always apply penetration correction for proper separation
    let correctedTo = { x: to.x, y: to.y };
    if (hit.penetration > 0.1) { // Much lower threshold (was 3.0)
      // Push player out by full penetration PLUS minimum separation
      const totalSeparation = hit.penetration + MIN_SEPARATION;
      correctedTo = {
        x: to.x + hit.normal.x * totalSeparation,
        y: to.y + hit.normal.y * totalSeparation,
      };
    }
  
    // Allowed movement vector
    const allowedMoveVec = {
      x: correctedTo.x - from.x,
      y: correctedTo.y - from.y
    };
  
    // Project onto normal
    const dotProduct = allowedMoveVec.x * hit.normal.x + allowedMoveVec.y * hit.normal.y;
  
    // Slide vector - only remove the component moving INTO the object
    let slideVec = {
      x: allowedMoveVec.x - (dotProduct > 0 ? 0 : dotProduct * hit.normal.x),
      y: allowedMoveVec.y - (dotProduct > 0 ? 0 : dotProduct * hit.normal.y)
    };
  
    // If slide vector is very small (stuck), use a larger nudge along the tangent
    const slideLen = Math.sqrt(slideVec.x * slideVec.x + slideVec.y * slideVec.y);
    if (slideLen < 0.1) {
      // Tangent to the normal (perpendicular direction)
      const tangent = { x: -hit.normal.y, y: hit.normal.x };
      const nudgeDistance = MIN_SEPARATION; // Much larger nudge (was 1.5px)
      slideVec.x += tangent.x * nudgeDistance;
      slideVec.y += tangent.y * nudgeDistance;
    }
  
    // Final position with guaranteed separation
    const finalX = from.x + slideVec.x;
    const finalY = from.y + slideVec.y;
    
    // 🛡️ SAFETY CHECK: Ensure we're actually separated from the object
    const finalDx = finalX - (hit.shape.x || 0);
    const finalDy = finalY - (hit.shape.y || 0);
    const finalDistance = Math.sqrt(finalDx * finalDx + finalDy * finalDy);
    const requiredDistance = PLAYER_RADIUS + (hit.shape.radius || 0) + MIN_SEPARATION;
    
    if (finalDistance < requiredDistance && hit.shape.radius) {
      // Force minimum separation
      const separationDirection = finalDistance > 0.001 
        ? { x: finalDx / finalDistance, y: finalDy / finalDistance }
        : { x: 1, y: 0 }; // Default direction if positions are identical
        
      return {
        x: hit.shape.x + separationDirection.x * requiredDistance,
        y: hit.shape.y + separationDirection.y * requiredDistance
      };
    }
    
    return { x: finalX, y: finalY };
  }

// ===== ENTITY PROCESSING =====
// PERFORMANCE: buildCollisionShapes has been replaced with getCollisionCandidates (see above)
// The new system provides:
// - Aggressive distance-based culling
// - Entity count limiting
// - Emergency mode for high-density areas
// - Spatial partitioning for better performance

// Legacy function kept for reference (replaced by getCollisionCandidates)
function buildCollisionShapes_DEPRECATED(entities: GameEntities, localPlayerId: string, playerX?: number, playerY?: number): CollisionShape[] {
  // This function has been replaced by getCollisionCandidates for better performance
  console.warn('buildCollisionShapes_DEPRECATED called - use getCollisionCandidates instead');
  return getCollisionCandidates(entities, playerX || 0, playerY || 0, localPlayerId);
}

// ===== UTILITY FUNCTIONS =====
function clampToWorldBounds(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.max(PLAYER_RADIUS, Math.min(WORLD_WIDTH_PX - PLAYER_RADIUS, x)),
    y: Math.max(PLAYER_RADIUS, Math.min(WORLD_HEIGHT_PX - PLAYER_RADIUS, y))
  };
} 