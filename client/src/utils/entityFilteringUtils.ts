// entityFilteringUtils.ts
import { ViewportBounds } from '../hooks/useEntityFiltering';

export function isEntityInView(entity: any, bounds: ViewportBounds, currentTime: number): boolean {
  // Basic viewport check
  if (!entity || typeof entity.posX !== 'number' || typeof entity.posY !== 'number') {
    return false;
  }

  // Skip respawning entities
  if (entity.respawnAt !== null && entity.respawnAt !== undefined) {
    return false;
  }

  const entityX = entity.posX;
  const entityY = entity.posY;
  
  // Add some padding for entities near viewport edge
  const padding = 50;
  
  return entityX >= bounds.viewMinX - padding &&
         entityX <= bounds.viewMaxX + padding &&
         entityY >= bounds.viewMinY - padding &&
         entityY <= bounds.viewMaxY + padding;
}

export function filterVisibleTrees(trees: Map<string, any>, bounds: ViewportBounds, currentTime: number): any[] {
  if (!trees || !bounds) return [];
  
  return Array.from(trees.values()).filter(tree => 
    isEntityInView(tree, bounds, currentTime)
  );
}

export function filterVisibleEntities<T>(
  entities: Map<string, T>,
  bounds: ViewportBounds,
  currentTime: number
): T[] {
  if (!entities || !bounds) return [];
  
  return Array.from(entities.values()).filter(entity => 
    isEntityInView(entity, bounds, currentTime)
  );
} 