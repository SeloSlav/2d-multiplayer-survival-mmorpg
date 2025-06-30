// Unified Resource Type System for Harvestable Resources
import { HarvestableResource, PlantType } from '../generated';

// Extract ResourceType from the generated PlantType - no more hard-coding!
// This automatically stays in sync with the server's PlantType enum
export type ResourceType = PlantType['tag'];

// Since Willow/BirchBark have been removed from server, ResourceType === HarvestableResourceType
export type HarvestableResourceType = ResourceType;

// NOTE: Individual type guards removed as they were not being used
// The unified system uses getResourceType(entity) which extracts from entity.plantType?.tag directly

// Master type guard for any harvestable resource
export function isHarvestableResource(entity: any): entity is HarvestableResource {
  return entity && 
         typeof entity.posX === 'number' &&
         typeof entity.posY === 'number' &&
         typeof entity.id !== 'undefined' &&
         typeof entity.chunkIndex === 'number' &&
         entity.plantType &&
         typeof entity.plantType.tag === 'string' &&
         // The plantType.tag should be a valid PlantType tag (automatically validated by TypeScript)
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