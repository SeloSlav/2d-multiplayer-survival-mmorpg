/**
 * Client-side collision shapes for monument buildings.
 * Abstraction layer for monument-specific collision (village campfires, scarecrow, etc.).
 */
import type { MonumentPart } from '../generated/types';
import type { CollisionShape } from './clientCollision';
import { isVillageCampfire, villageWallSegments, VILLAGE_CAMPFIRE_RADIUS, VILLAGE_CAMPFIRE_Y_OFFSET, VILLAGE_WALL_THICKNESS } from '../config/villageGeometry';
import { VILLAGE_BUILDINGS, villageAsset } from '../engine/presentation/world3d/villagePlans';

// --- Monument scarecrow collision (matches wooden storage box - 20px radius, same position) ---
const MONUMENT_SCARECROW_CULL_DISTANCE_SQ = 200 * 200; // Only check within 200px
const MAX_MONUMENT_SCARECROWS_TO_CHECK = 3;
// Always use COLLISION_RADII.STORAGE_BOX (20) - ignore part.collisionRadius from DB (may be stale 64)
const MONUMENT_SCARECROW_COLLISION_RADIUS = 20;
/** Keep in sync with clientCollision COLLISION_DEBUG_VIEWPORT_MARGIN */
const COLLISION_DEBUG_VIEWPORT_MARGIN = 480;

type CollisionDebugViewportBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

function pointInDebugViewport(
  x: number,
  y: number,
  vp: CollisionDebugViewportBounds,
  margin: number = COLLISION_DEBUG_VIEWPORT_MARGIN
): boolean {
  return (
    x >= vp.minX - margin &&
    x <= vp.maxX + margin &&
    y >= vp.minY - margin &&
    y <= vp.maxY + margin
  );
}

function isMonumentScarecrowPart(part: MonumentPart): boolean {
  return part.monumentType?.tag === 'HuntingVillage' && part.partType === 'scarecrow' && (part.collisionRadius ?? 0) > 0;
}

/**
 * Returns collision shapes for hunting village monument scarecrow (matches wooden storage box).
 * Always uses radius 20 - same as COLLISION_RADII.STORAGE_BOX. Ignores part.collisionRadius.
 */
export function getMonumentScarecrowCollisionShapes(
  monumentParts: Map<string, MonumentPart> | undefined,
  playerX: number,
  playerY: number,
  collisionDebugViewport?: CollisionDebugViewportBounds
): CollisionShape[] {
  if (!monumentParts || monumentParts.size === 0) return [];

  const shapes: CollisionShape[] = [];
  let count = 0;

  for (const part of monumentParts.values()) {
    if (!collisionDebugViewport && count >= MAX_MONUMENT_SCARECROWS_TO_CHECK) break;
    if (!isMonumentScarecrowPart(part)) continue;

    if (collisionDebugViewport) {
      if (!pointInDebugViewport(part.worldX, part.worldY, collisionDebugViewport)) continue;
    } else {
      const dx = part.worldX - playerX;
      const dy = part.worldY - playerY;
      const distSq = dx * dx + dy * dy;
      if (distSq > MONUMENT_SCARECROW_CULL_DISTANCE_SQ) continue;
    }

    shapes.push({
      id: `monument_scarecrow_${part.id}`,
      type: `monument_scarecrow-${part.id}`,
      x: part.worldX,
      y: part.worldY,
      radius: MONUMENT_SCARECROW_COLLISION_RADIUS,
    });
    if (!collisionDebugViewport) count++;
  }

  return shapes;
}

// --- Village campfire collision ---
const VILLAGE_CAMPFIRE_CULL_DISTANCE_SQ = 250 * 250; // Only check within 250px
const MAX_VILLAGE_CAMPFIRES_TO_CHECK = 5;
// fv_campfire.png is 256x256, anchor at bottom; collision center at fire pit (half-height up)

/**
 * Returns collision shapes for fishing/hunting village campfires (70px radius circle).
 * Culled by distance from player for performance.
 */
export function getVillageCampfireCollisionShapes(
  monumentParts: Map<string, MonumentPart> | undefined,
  playerX: number,
  playerY: number,
  collisionDebugViewport?: CollisionDebugViewportBounds
): CollisionShape[] {
  if (!monumentParts || monumentParts.size === 0) return [];

  const shapes: CollisionShape[] = [];
  let count = 0;

  for (const part of monumentParts.values()) {
    if (!collisionDebugViewport && count >= MAX_VILLAGE_CAMPFIRES_TO_CHECK) break;
    if (!isVillageCampfire(part)) continue;

    const shapeCenterX = part.worldX;
    const shapeCenterY = part.worldY + VILLAGE_CAMPFIRE_Y_OFFSET;

    if (collisionDebugViewport) {
      if (!pointInDebugViewport(shapeCenterX, shapeCenterY, collisionDebugViewport)) continue;
    } else {
      const dx = shapeCenterX - playerX;
      const dy = shapeCenterY - playerY;
      const distSq = dx * dx + dy * dy;
      if (distSq > VILLAGE_CAMPFIRE_CULL_DISTANCE_SQ) continue;
    }

    shapes.push({
      id: `monument_campfire_${part.id}`,
      type: `monument_campfire-${part.id}`,
      x: shapeCenterX,
      y: shapeCenterY,
      radius: VILLAGE_CAMPFIRE_RADIUS,
    });
    if (!collisionDebugViewport) count++;
  }

  return shapes;
}

/** Hollow village structures: collision follows the 3D wall segments, with
 * a real doorway. Unrelated monument decorations remain unchanged. */
export function getVillageBuildingCollisionShapes(
  monumentParts:Map<string,MonumentPart>|undefined,playerX:number,playerY:number,collisionDebugViewport?:CollisionDebugViewportBounds
):CollisionShape[]{
  if(!monumentParts)return [];
  const shapes:CollisionShape[]=[];
  for(const part of monumentParts.values()){
    const plan=VILLAGE_BUILDINGS[villageAsset(part)];if(!plan)continue;
    if(collisionDebugViewport){if(!pointInDebugViewport(part.worldX,part.worldY,collisionDebugViewport))continue;}
    else{
      const reach=Math.hypot(plan.width/2,plan.depth)*48+250;
      if((part.worldX-playerX)**2+(part.worldY-playerY)**2>reach*reach)continue;
    }
    villageWallSegments(part).forEach((wall,index)=>shapes.push({
      id:`village_wall_${part.id}_${index}`,type:`village_wall-${part.id}-${index}`,
      x:(wall.ax+wall.bx)/2,y:(wall.ay+wall.by)/2,
      lineStartX:wall.ax,lineStartY:wall.ay,lineEndX:wall.bx,lineEndY:wall.by,lineThickness:VILLAGE_WALL_THICKNESS,
    }));
  }
  return shapes;
}
