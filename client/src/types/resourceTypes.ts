// Unified Resource Type System for Harvestable Resources
import { HarvestableResource } from '../generated';

// Resource type discriminator based on the PlantType enum from the server
export type ResourceType = 'Corn' | 'Hemp' | 'Mushroom' | 'Potato' | 'Pumpkin' | 'Reed';

// Type guards for each resource type based on plantType
export function isCorn(entity: any): entity is HarvestableResource {
  return isHarvestableResource(entity) && entity.plantType?.tag === 'Corn';
}

export function isHemp(entity: any): entity is HarvestableResource {
  return isHarvestableResource(entity) && entity.plantType?.tag === 'Hemp';
}

export function isMushroom(entity: any): entity is HarvestableResource {
  return isHarvestableResource(entity) && entity.plantType?.tag === 'Mushroom';
}

export function isPotato(entity: any): entity is HarvestableResource {
  return isHarvestableResource(entity) && entity.plantType?.tag === 'Potato';
}

export function isPumpkin(entity: any): entity is HarvestableResource {
  return isHarvestableResource(entity) && entity.plantType?.tag === 'Pumpkin';
}

export function isReed(entity: any): entity is HarvestableResource {
  return isHarvestableResource(entity) && entity.plantType?.tag === 'Reed';
}

// Master type guard for any harvestable resource
export function isHarvestableResource(entity: any): entity is HarvestableResource {
  return entity && 
         typeof entity.posX === 'number' &&
         typeof entity.posY === 'number' &&
         typeof entity.id !== 'undefined' &&
         typeof entity.chunkIndex === 'number' &&
         entity.plantType &&
         typeof entity.plantType.tag === 'string' &&
         ['Corn', 'Hemp', 'Mushroom', 'Potato', 'Pumpkin', 'Reed'].includes(entity.plantType.tag) &&
         (entity.respawnAt === null || entity.respawnAt instanceof Date || typeof entity.respawnAt === 'undefined');
}

// Helper to get resource type from entity
export function getResourceType(entity: HarvestableResource): ResourceType {
  if (entity.plantType?.tag) {
    // The server's PlantType tags are already in the correct format for ResourceType
    const resourceType = entity.plantType.tag as ResourceType;
    return resourceType;
  }
  
  console.error('[RESOURCE_TYPE_ERROR] Unknown or missing plant type in harvestable resource:', entity);
  throw new Error('Unknown or missing plant type in harvestable resource');
}

// Planted seeds are separate from harvestable resources since they grow over time
// TODO: Replace 'any' with actual PlantedSeed type when bindings are available
export type PlantedSeedResource = any; // Will be defined by generated types

// Combined union for all resource-related entities
export type AllResourceEntities = HarvestableResource | PlantedSeedResource; 