// Unified Resource Type System for Harvestable Resources
import { Corn, Hemp, Mushroom, Potato, Pumpkin } from '../generated';

// Union type for all harvestable resources
export type HarvestableResource = Corn | Hemp | Mushroom | Potato | Pumpkin;

// Resource type discriminator
export type ResourceType = 'corn' | 'hemp' | 'mushroom' | 'potato' | 'pumpkin';

// Enhanced entity with type marker for type-safe rendering
export type TypedHarvestableResource = HarvestableResource & {
  __resourceType: ResourceType;
};

// Type guards for each resource type
export function isCorn(entity: any): entity is Corn {
  return entity && 
         typeof entity.posX === 'number' &&
         typeof entity.posY === 'number' &&
         typeof entity.id !== 'undefined' &&
         typeof entity.chunkIndex === 'number' &&
         (entity.respawnAt === null || entity.respawnAt instanceof Date || typeof entity.respawnAt === 'undefined') &&
         (entity.__resourceType === 'corn' || 
          // Fallback property-based detection if no type marker
          (entity.hasOwnProperty('posX') && !entity.hasOwnProperty('health')));
}

export function isHemp(entity: any): entity is Hemp {
  return entity && 
         typeof entity.posX === 'number' &&
         typeof entity.posY === 'number' &&
         typeof entity.id !== 'undefined' &&
         typeof entity.chunkIndex === 'number' &&
         (entity.respawnAt === null || entity.respawnAt instanceof Date || typeof entity.respawnAt === 'undefined') &&
         (entity.__resourceType === 'hemp' || 
          // Fallback property-based detection if no type marker
          (entity.hasOwnProperty('posX') && !entity.hasOwnProperty('health')));
}

export function isMushroom(entity: any): entity is Mushroom {
  return entity && 
         typeof entity.posX === 'number' &&
         typeof entity.posY === 'number' &&
         typeof entity.id !== 'undefined' &&
         typeof entity.chunkIndex === 'number' &&
         (entity.respawnAt === null || entity.respawnAt instanceof Date || typeof entity.respawnAt === 'undefined') &&
         (entity.__resourceType === 'mushroom' || 
          // Fallback property-based detection if no type marker
          (entity.hasOwnProperty('posX') && !entity.hasOwnProperty('health')));
}

export function isPotato(entity: any): entity is Potato {
  return entity && 
         typeof entity.posX === 'number' &&
         typeof entity.posY === 'number' &&
         typeof entity.id !== 'undefined' &&
         typeof entity.chunkIndex === 'number' &&
         (entity.respawnAt === null || entity.respawnAt instanceof Date || typeof entity.respawnAt === 'undefined') &&
         (entity.__resourceType === 'potato' || 
          // Fallback property-based detection if no type marker
          (entity.hasOwnProperty('posX') && !entity.hasOwnProperty('health')));
}

export function isPumpkin(entity: any): entity is Pumpkin {
  return entity && 
         typeof entity.posX === 'number' &&
         typeof entity.posY === 'number' &&
         typeof entity.id !== 'undefined' &&
         typeof entity.chunkIndex === 'number' &&
         (entity.respawnAt === null || entity.respawnAt instanceof Date || typeof entity.respawnAt === 'undefined') &&
         (entity.__resourceType === 'pumpkin' || 
          // Fallback property-based detection if no type marker
          (entity.hasOwnProperty('posX') && !entity.hasOwnProperty('health')));
}

// Master type guard for any harvestable resource
export function isHarvestableResource(entity: any): entity is TypedHarvestableResource {
  return isCorn(entity) || isHemp(entity) || isMushroom(entity) || isPotato(entity) || isPumpkin(entity);
}

// Helper to get resource type from entity
export function getResourceType(entity: HarvestableResource): ResourceType {
  if ('__resourceType' in entity) {
    return (entity as TypedHarvestableResource).__resourceType;
  }
  
  // Fallback detection based on properties or other distinguishing features
  // This is a simplified approach - you might need more sophisticated detection
  if (isCorn(entity)) return 'corn';
  if (isHemp(entity)) return 'hemp';
  if (isMushroom(entity)) return 'mushroom';
  if (isPotato(entity)) return 'potato';
  if (isPumpkin(entity)) return 'pumpkin';
  
  throw new Error('Unknown resource type');
}

// Helper to add type marker to resource entities
export function addResourceTypeMarker<T extends HarvestableResource>(
  entity: T, 
  resourceType: ResourceType
): T & { __resourceType: ResourceType } {
  return { ...entity, __resourceType: resourceType };
} 