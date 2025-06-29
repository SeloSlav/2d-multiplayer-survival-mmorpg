// Unified Resource Renderer - Uses server-side PlantType enum
import { HarvestableResource } from '../../generated';
import { ResourceType, getResourceType } from '../../types/resourceTypes';
import { 
  createResourceGroundConfig, 
  RESOURCE_CONFIGS 
} from './resourceConfigurations';
import { renderConfiguredGroundEntity } from './genericGroundRenderer';
import { imageManager } from './imageManager';

// Helper function to get resource type from server's plantType.tag
function getResourceTypeFromPlantType(entity: HarvestableResource): ResourceType {
  // Use the existing helper from resourceTypes.ts that handles the server's plantType
  return getResourceType(entity);
}

// Preload all resource images
Object.values(RESOURCE_CONFIGS).forEach(config => {
  imageManager.preloadImage(config.imageSource);
});

// Cache for ground configurations to avoid recreating them
const configCache = new Map<ResourceType, ReturnType<typeof createResourceGroundConfig>>();

// Get or create cached ground configuration for a resource type
function getCachedGroundConfig(resourceType: ResourceType) {
  if (!configCache.has(resourceType)) {
    configCache.set(resourceType, createResourceGroundConfig(resourceType));
  }
  return configCache.get(resourceType)!;
}

// Main unified rendering function for any harvestable resource
export function renderHarvestableResource(
  ctx: CanvasRenderingContext2D,
  entity: HarvestableResource,
  nowMs: number,
  cycleProgress: number,
  onlyDrawShadow?: boolean,
  skipDrawingShadow?: boolean
) {
  try {
    // Get the resource type from the server's plantType.tag
    const resourceType = getResourceTypeFromPlantType(entity);
    
    // Get the appropriate configuration
    const groundConfig = getCachedGroundConfig(resourceType);
    
    // Render using the generic ground renderer
    renderConfiguredGroundEntity({
      ctx,
      entity,
      config: groundConfig,
      nowMs,
      entityPosX: entity.posX,
      entityPosY: entity.posY,
      cycleProgress,
      onlyDrawShadow,
      skipDrawingShadow
    });
    
  } catch (error) {
    console.error('[HARVESTABLE_RESOURCE_ERROR] Failed to render harvestable resource:', {
      error: error instanceof Error ? error.message : String(error),
      entity: entity,
      entityId: entity.id,
      plantType: entity.plantType
    });
    
    // Fallback: render a simple placeholder to prevent total rendering failure
    ctx.fillStyle = 'red';
    ctx.fillRect(entity.posX - 8, entity.posY - 8, 16, 16);
    ctx.fillStyle = 'white';
    ctx.fillText('?', entity.posX - 4, entity.posY + 4);
  }
}


// Export the main function as default
export default renderHarvestableResource; 