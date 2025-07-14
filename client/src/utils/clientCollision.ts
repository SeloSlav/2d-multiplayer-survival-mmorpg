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

// ===== CONFIGURATION CONSTANTS =====
const WORLD_WIDTH_PX = gameConfig.worldWidthPx;
const WORLD_HEIGHT_PX = gameConfig.worldHeightPx;
const PLAYER_RADIUS = 32;

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

  // Step 3: Build collision shapes from entities - PERFORMANCE: Pass player position for distance filtering
  const collisionShapes = buildCollisionShapes(entities, localPlayerId, fromX, fromY);
  
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
function buildCollisionShapes(entities: GameEntities, localPlayerId: string, playerX?: number, playerY?: number): CollisionShape[] {
  const shapes: CollisionShape[] = [];
  
  // PERFORMANCE FIX: Pre-filter entities by distance to reduce collision calculations
  // Only check entities within a reasonable collision range instead of the entire world
  const COLLISION_RANGE_SQUARED = 400 * 400; // 400px radius should be more than enough for collision detection
  
  const shouldIncludeEntity = (entityX: number, entityY: number): boolean => {
    if (playerX === undefined || playerY === undefined) return true; // Fallback to include all if no player position
    const dx = entityX - playerX;
    const dy = entityY - playerY;
    return (dx * dx + dy * dy) <= COLLISION_RANGE_SQUARED;
  };
  
  // Add other players
  for (const [playerId, player] of entities.players) {
    if (playerId === localPlayerId || player.isDead) continue;
    if (!shouldIncludeEntity(player.positionX, player.positionY)) continue; // PERFORMANCE: Skip distant players
    
    shapes.push({
      id: playerId,
        type: `player-${playerId.substring(0, 8)}`,
      x: player.positionX,
      y: player.positionY,
      radius: COLLISION_RADII.PLAYER
    });
  }
  
  // Add trees - PERFORMANCE: Pre-filter by distance
  for (const [treeId, tree] of entities.trees) {
    if (tree.health <= 0) continue;
    if (!shouldIncludeEntity(tree.posX, tree.posY)) continue; // PERFORMANCE: Skip distant trees
    
    shapes.push({
      id: treeId,
        type: `tree-${treeId}`,
      x: tree.posX + COLLISION_OFFSETS.TREE.x,
      y: tree.posY + COLLISION_OFFSETS.TREE.y,
      radius: COLLISION_RADII.TREE
    });
  }
  
  // Add stones - PERFORMANCE: Pre-filter by distance
  for (const [stoneId, stone] of entities.stones) {
    if (stone.health <= 0) continue;
    if (!shouldIncludeEntity(stone.posX, stone.posY)) continue; // PERFORMANCE: Skip distant stones
    
    shapes.push({
      id: stoneId,
        type: `stone-${stoneId}`,
      x: stone.posX + COLLISION_OFFSETS.STONE.x,
      y: stone.posY + COLLISION_OFFSETS.STONE.y,
      radius: COLLISION_RADII.STONE
    });
  }
  
  // Add storage boxes - PERFORMANCE: Pre-filter by distance
  for (const [boxId, box] of entities.boxes) {
    if (!shouldIncludeEntity(box.posX, box.posY)) continue; // PERFORMANCE: Skip distant boxes
    
    shapes.push({
      id: boxId,
        type: `storage-box-${boxId}`,
      x: box.posX + COLLISION_OFFSETS.STORAGE_BOX.x,
      y: box.posY + COLLISION_OFFSETS.STORAGE_BOX.y,
      radius: COLLISION_RADII.STORAGE_BOX
    });
  }

  // Add rain collectors - PERFORMANCE: Pre-filter by distance
  for (const [rainCollectorId, rainCollector] of entities.rainCollectors) {
    if (rainCollector.isDestroyed) continue;
    if (!shouldIncludeEntity(rainCollector.posX, rainCollector.posY)) continue; // PERFORMANCE: Skip distant rain collectors
    
    shapes.push({
      id: rainCollectorId,
      type: `rain-collector-${rainCollectorId}`,
      x: rainCollector.posX + COLLISION_OFFSETS.RAIN_COLLECTOR.x,
      y: rainCollector.posY + COLLISION_OFFSETS.RAIN_COLLECTOR.y,
      radius: COLLISION_RADII.RAIN_COLLECTOR
    });
  }
  
  // Add furnaces - PERFORMANCE: Pre-filter by distance
  for (const [furnaceId, furnace] of entities.furnaces) {
    if (furnace.isDestroyed) continue;
    if (!shouldIncludeEntity(furnace.posX, furnace.posY)) continue; // PERFORMANCE: Skip distant furnaces
    
    shapes.push({
      id: furnaceId,
      type: `furnace-${furnaceId}`,
      x: furnace.posX + COLLISION_OFFSETS.FURNACE.x,
      y: furnace.posY + COLLISION_OFFSETS.FURNACE.y,
      radius: COLLISION_RADII.FURNACE
    });
  }
  
  // Add shelters - PERFORMANCE: Pre-filter by distance
  for (const [shelterId, shelter] of entities.shelters) {
    if (shelter.isDestroyed) continue;
    if (!shouldIncludeEntity(shelter.posX, shelter.posY)) continue; // PERFORMANCE: Skip distant shelters
    
    // Skip collision for shelter owner
    if (localPlayerId && shelter.placedBy.toHexString() === localPlayerId) {
      continue;
    }
    
    shapes.push({
      id: shelterId,
          type: `shelter-${shelterId}`,
      x: shelter.posX + COLLISION_OFFSETS.SHELTER.x,
      y: shelter.posY + COLLISION_OFFSETS.SHELTER.y,
      width: SHELTER_DIMS.WIDTH,
      height: SHELTER_DIMS.HEIGHT
    });
  }
  
  // Add wild animals - PERFORMANCE: Pre-filter by distance
  for (const [animalId, animal] of entities.wildAnimals) {
    if (!shouldIncludeEntity(animal.posX, animal.posY)) continue; // PERFORMANCE: Skip distant animals
    
    shapes.push({
      id: animalId,
      type: `wild-animal-${animalId}`,
      x: animal.posX + COLLISION_OFFSETS.WILD_ANIMAL.x,
      y: animal.posY + COLLISION_OFFSETS.WILD_ANIMAL.y,
      radius: COLLISION_RADII.WILD_ANIMAL
    });
  }
  
  // Add barrels - PERFORMANCE: Pre-filter by distance
  for (const [barrelId, barrel] of entities.barrels) {
    if (barrel.health <= 0) continue; // Skip destroyed barrels
    if (!shouldIncludeEntity(barrel.posX, barrel.posY)) continue; // PERFORMANCE: Skip distant barrels
    
    shapes.push({
      id: barrelId,
      type: `barrel-${barrelId}`,
      x: barrel.posX + COLLISION_OFFSETS.BARREL.x,
      y: barrel.posY + COLLISION_OFFSETS.BARREL.y,
      radius: COLLISION_RADII.BARREL
    });
  }
  
  return shapes;
}

// ===== UTILITY FUNCTIONS =====
function clampToWorldBounds(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.max(PLAYER_RADIUS, Math.min(WORLD_WIDTH_PX - PLAYER_RADIUS, x)),
    y: Math.max(PLAYER_RADIUS, Math.min(WORLD_HEIGHT_PX - PLAYER_RADIUS, y))
  };
} 