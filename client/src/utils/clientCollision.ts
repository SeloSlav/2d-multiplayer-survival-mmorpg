// AAA-Quality Client-side Collision Detection System
import { Player, Tree, Stone, WoodenStorageBox, Shelter } from '../generated';

// ===== CONFIGURATION CONSTANTS =====
const WORLD_WIDTH_PX = 24000;
const WORLD_HEIGHT_PX = 24000;
const PLAYER_RADIUS = 32;

// Unified collision radii for consistency - match visual sprite sizes
const COLLISION_RADII = {
  TREE: 25,        // Perfect radius for trees
  STONE: 25,       // Smaller radius for flattened stones
  STORAGE_BOX: 5, // Much tighter radius for boxes
  PLAYER: PLAYER_RADIUS,
} as const;

// Collision offsets for sprite positioning - align with visual sprite base
const COLLISION_OFFSETS = {
  TREE: { x: 0, y: -60 },      // Perfect Y position for tree base
  STONE: { x: 0, y: -72 },     // Small circle positioned at visual stone base  
  STORAGE_BOX: { x: 0, y: -70 }, // Small circle positioned at visual box base
  SHELTER: { x: 0, y: -200 },  // Shelter offset unchanged
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
  shelters: Map<string, Shelter>;
  players: Map<string, Player>;
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

  // Step 3: Build collision shapes from entities
  const collisionShapes = buildCollisionShapes(entities, localPlayerId);
  
  // Step 4: Perform swept collision detection
  const result = performSweptCollision(
    { x: fromX, y: fromY },
    { x: clampedTo.x, y: clampedTo.y },
    PLAYER_RADIUS,
    collisionShapes
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
  const originalMoveLength = Math.sqrt((to.x - from.x) ** 2 + (to.y - from.y) ** 2);
  
  // Start from the original position for smooth movement
  let resultPos = { x: from.x, y: from.y };
  
  // Calculate slide direction (remove component of movement that goes into surface)
  const dotProduct = moveDir.x * hit.normal.x + moveDir.y * hit.normal.y;
  
  if (dotProduct < 0) {
    // Moving into surface - calculate slide vector
    const slideDir = {
      x: moveDir.x - dotProduct * hit.normal.x,
      y: moveDir.y - dotProduct * hit.normal.y
    };
    
    const slideLength = Math.sqrt(slideDir.x ** 2 + slideDir.y ** 2);
    
    if (slideLength > 0.001) {
      // Apply full sliding motion for smooth movement
      const normalizedSlideDir = {
        x: slideDir.x / slideLength,
        y: slideDir.y / slideLength
      };
      
      resultPos.x += normalizedSlideDir.x * originalMoveLength;
      resultPos.y += normalizedSlideDir.y * originalMoveLength;
    }
  } else {
    // Not moving into surface - allow normal movement but stay just outside collision
    const safeDistance = 1.0; // Small buffer to prevent overlap
    resultPos.x = hit.shape.x - hit.normal.x * (hit.shape.radius || PLAYER_RADIUS) - hit.normal.x * safeDistance;
    resultPos.y = hit.shape.y - hit.normal.y * (hit.shape.radius || PLAYER_RADIUS) - hit.normal.y * safeDistance;
  }
  
  // If still penetrating after slide, apply minimal separation
  const finalDx = resultPos.x - hit.shape.x;
  const finalDy = resultPos.y - hit.shape.y;
  const finalDist = Math.sqrt(finalDx * finalDx + finalDy * finalDy);
  const minDistance = (hit.shape.radius || PLAYER_RADIUS) + PLAYER_RADIUS;
  
  if (finalDist < minDistance && finalDist > 0.001) {
    const separationNeeded = minDistance - finalDist + 0.5; // Small buffer
    resultPos.x += (finalDx / finalDist) * separationNeeded;
    resultPos.y += (finalDy / finalDist) * separationNeeded;
  }
  
  return resultPos;
}

// ===== ENTITY PROCESSING =====
function buildCollisionShapes(entities: GameEntities, localPlayerId: string): CollisionShape[] {
  const shapes: CollisionShape[] = [];
  
  // Add other players
  for (const [playerId, player] of entities.players) {
    if (playerId === localPlayerId || player.isDead) continue;
    
    shapes.push({
      id: playerId,
      type: `player-${playerId.substring(0, 8)}`,
      x: player.positionX,
      y: player.positionY,
      radius: COLLISION_RADII.PLAYER
    });
  }
  
  // Add trees
  for (const [treeId, tree] of entities.trees) {
    if (tree.health <= 0) continue;
    
    shapes.push({
      id: treeId,
      type: `tree-${treeId}`,
      x: tree.posX + COLLISION_OFFSETS.TREE.x,
      y: tree.posY + COLLISION_OFFSETS.TREE.y,
      radius: COLLISION_RADII.TREE
    });
  }
  
  // Add stones (back to circular collision)
  for (const [stoneId, stone] of entities.stones) {
    if (stone.health <= 0) continue;
    
    shapes.push({
      id: stoneId,
      type: `stone-${stoneId}`,
      x: stone.posX + COLLISION_OFFSETS.STONE.x,
      y: stone.posY + COLLISION_OFFSETS.STONE.y,
      radius: COLLISION_RADII.STONE
    });
  }
  
  // Add storage boxes (back to circular collision)
  for (const [boxId, box] of entities.boxes) {
    shapes.push({
      id: boxId,
      type: `storage-box-${boxId}`,
      x: box.posX + COLLISION_OFFSETS.STORAGE_BOX.x,
      y: box.posY + COLLISION_OFFSETS.STORAGE_BOX.y,
      radius: COLLISION_RADII.STORAGE_BOX
    });
  }
  
  // Add shelters (exclude owner's shelter)
  for (const [shelterId, shelter] of entities.shelters) {
    if (shelter.isDestroyed) continue;
    
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
  
  return shapes;
}

// ===== UTILITY FUNCTIONS =====
function clampToWorldBounds(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.max(PLAYER_RADIUS, Math.min(WORLD_WIDTH_PX - PLAYER_RADIUS, x)),
    y: Math.max(PLAYER_RADIUS, Math.min(WORLD_HEIGHT_PX - PLAYER_RADIUS, y))
  };
} 