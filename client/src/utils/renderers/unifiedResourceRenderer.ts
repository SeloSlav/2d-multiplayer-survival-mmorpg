// Unified Resource Renderer - Consolidates all harvestable resource rendering
import { 
  HarvestableResource, 
  ResourceType, 
  TypedHarvestableResource,
  addResourceTypeMarker
} from '../../types/resourceTypes';
import { 
  createResourceGroundConfig, 
  getResourceConfig,
  RESOURCE_CONFIGS 
} from './resourceConfigurations';
import { renderConfiguredGroundEntity } from './genericGroundRenderer';
import { imageManager } from './imageManager';

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
  // Since all resource types have identical structures, we need to determine
  // the type from the calling context. For now, we'll throw an error to indicate
  // that the type-specific functions should be used instead.
  throw new Error('renderHarvestableResource requires explicit resource type. Use renderCorn, renderHemp, renderMushroom, or renderPumpkin instead.');
}

// Enhanced rendering function that accepts explicit resource type
export function renderHarvestableResourceWithType(
  ctx: CanvasRenderingContext2D,
  entity: HarvestableResource,
  resourceType: ResourceType,
  nowMs: number,
  cycleProgress: number,
  onlyDrawShadow?: boolean,
  skipDrawingShadow?: boolean
) {
  // Add type marker to the entity
  const typedEntity = addResourceTypeMarker(entity, resourceType);
  
  // Get the appropriate configuration
  const groundConfig = getCachedGroundConfig(resourceType);
  
  // Render using the generic ground renderer
  renderConfiguredGroundEntity({
    ctx,
    entity: typedEntity,
    config: groundConfig,
    nowMs,
    entityPosX: entity.posX,
    entityPosY: entity.posY,
    cycleProgress,
    onlyDrawShadow,
    skipDrawingShadow
  });
}

// Type-specific convenience functions for backward compatibility
export function renderCorn(
  ctx: CanvasRenderingContext2D,
  corn: HarvestableResource,
  nowMs: number,
  cycleProgress: number,
  onlyDrawShadow?: boolean,
  skipDrawingShadow?: boolean
) {
  renderHarvestableResourceWithType(ctx, corn, 'corn', nowMs, cycleProgress, onlyDrawShadow, skipDrawingShadow);
}

export function renderHemp(
  ctx: CanvasRenderingContext2D,
  hemp: HarvestableResource,
  nowMs: number,
  cycleProgress: number,
  onlyDrawShadow?: boolean,
  skipDrawingShadow?: boolean
) {
  renderHarvestableResourceWithType(ctx, hemp, 'hemp', nowMs, cycleProgress, onlyDrawShadow, skipDrawingShadow);
}

export function renderMushroom(
  ctx: CanvasRenderingContext2D,
  mushroom: HarvestableResource,
  nowMs: number,
  cycleProgress: number,
  onlyDrawShadow?: boolean,
  skipDrawingShadow?: boolean
) {
  renderHarvestableResourceWithType(ctx, mushroom, 'mushroom', nowMs, cycleProgress, onlyDrawShadow, skipDrawingShadow);
}

export function renderPotato(
  ctx: CanvasRenderingContext2D,
  potato: HarvestableResource,
  nowMs: number,
  cycleProgress: number,
  onlyDrawShadow?: boolean,
  skipDrawingShadow?: boolean
) {
  renderHarvestableResourceWithType(ctx, potato, 'potato', nowMs, cycleProgress, onlyDrawShadow, skipDrawingShadow);
}

export function renderPumpkin(
  ctx: CanvasRenderingContext2D,
  pumpkin: HarvestableResource,
  nowMs: number,
  cycleProgress: number,
  onlyDrawShadow?: boolean,
  skipDrawingShadow?: boolean
) {
  renderHarvestableResourceWithType(ctx, pumpkin, 'pumpkin', nowMs, cycleProgress, onlyDrawShadow, skipDrawingShadow);
}

export function renderReed(
  ctx: CanvasRenderingContext2D,
  reed: HarvestableResource,
  nowMs: number,
  cycleProgress: number,
  onlyDrawShadow?: boolean,
  skipDrawingShadow?: boolean
) {
  renderHarvestableResourceWithType(ctx, reed, 'reed', nowMs, cycleProgress, onlyDrawShadow, skipDrawingShadow);
}

// Export the main function as default
export default renderHarvestableResourceWithType; 