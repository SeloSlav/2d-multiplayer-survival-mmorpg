// Resource Configuration System for Harvestable Resources
import { GroundEntityConfig } from './genericGroundRenderer';
import { HarvestableResource } from '../../generated';
import { ResourceType, getResourceType } from '../../types/resourceTypes';
import { drawDynamicGroundShadow } from './shadowUtils';
import { RESOURCE_IMAGE_SOURCES } from './resourceImageConfigs';

// Resource-specific configuration interface
export interface ResourceConfig {
  // Visual properties
  imageSource: string;
  targetWidth: number;
  targetHeight?: number; // Optional, will use aspect ratio if not provided
  
  // Shadow properties
  shadowConfig: {
    maxStretchFactor: number;
    shadowBlur: number;
    pivotYOffset: number;
    opacity?: number;
  };
  
  // Rendering properties
  fallbackColor: string;
  
  // Animation properties (optional)
  animationConfig?: {
    bobAmplitude?: number;
    bobFrequency?: number;
    rotationAmplitude?: number;
  };
}

// Default configuration that most resources will use
const DEFAULT_RESOURCE_CONFIG: Omit<ResourceConfig, 'imageSource'> = {
  targetWidth: 48,
  shadowConfig: {
    maxStretchFactor: 1.7,
    shadowBlur: 8,
    pivotYOffset: 0.15,
    opacity: 0.4
  },
  fallbackColor: '#8B7355'
};

// Automatically generate configurations for all available resources
export const RESOURCE_CONFIGS: Record<ResourceType, ResourceConfig> = Object.keys(RESOURCE_IMAGE_SOURCES).reduce((configs, resourceType) => {
  configs[resourceType as ResourceType] = {
    ...DEFAULT_RESOURCE_CONFIG,
    imageSource: RESOURCE_IMAGE_SOURCES[resourceType as ResourceType]
  };
  return configs;
}, {} as Record<ResourceType, ResourceConfig>);

// Override specific resource configurations
RESOURCE_CONFIGS.BeachLymeGrass = {
  ...RESOURCE_CONFIGS.BeachLymeGrass,
  targetWidth: 120 // Double the default size (60 -> 120)
};

RESOURCE_CONFIGS.Potato = {
  ...RESOURCE_CONFIGS.Potato,
  targetWidth: 90
};

RESOURCE_CONFIGS.Hemp = {
  ...RESOURCE_CONFIGS.Hemp,
  targetWidth: 90
};

RESOURCE_CONFIGS.Corn = {
  ...RESOURCE_CONFIGS.Corn,
  targetWidth: 90
};

RESOURCE_CONFIGS.Pumpkin = {
  ...RESOURCE_CONFIGS.Pumpkin,
  targetWidth: 90
};

RESOURCE_CONFIGS.Reed = {
  ...RESOURCE_CONFIGS.Reed,
  targetWidth: 90
};




// Helper function to get configuration for a resource
export function getResourceConfig(resourceType: ResourceType): ResourceConfig {
  return RESOURCE_CONFIGS[resourceType];
}

// Helper function to get configuration from entity
export function getResourceConfigFromEntity(entity: HarvestableResource): ResourceConfig {
  return getResourceConfig(getResourceType(entity));
}

// Create GroundEntityConfig for a specific resource type
export function createResourceGroundConfig(resourceType: ResourceType): GroundEntityConfig<HarvestableResource> {
  const config = getResourceConfig(resourceType);
  
  return {
    getImageSource: (entity) => {
      // Don't render if respawning
      if (entity.respawnAt) return null;
      return config.imageSource;
    },
    
    getTargetDimensions: (img, entity) => {
      const aspectRatio = img.naturalWidth / img.naturalHeight;
      const width = config.targetWidth;
      const height = config.targetHeight || (width / aspectRatio);
      return { width, height };
    },
    
    calculateDrawPosition: (entity, drawWidth, drawHeight) => {
      return {
        drawX: entity.posX - drawWidth / 2,
        drawY: entity.posY - drawHeight
      };
    },
    
    drawCustomGroundShadow: (ctx, entity, entityImage, entityPosX, entityPosY, imageDrawWidth, imageDrawHeight, cycleProgress) => {
      const shadowConfig = config.shadowConfig;
      drawDynamicGroundShadow({
        ctx,
        entityImage,
        entityCenterX: entityPosX,
        entityBaseY: entityPosY,
        imageDrawWidth,
        imageDrawHeight,
        cycleProgress,
        maxStretchFactor: shadowConfig.maxStretchFactor,
        shadowBlur: shadowConfig.shadowBlur,
        pivotYOffset: shadowConfig.pivotYOffset,
        maxShadowAlpha: shadowConfig.opacity || 0.4
      });
    },
    
    applyEffects: (ctx, entity, nowMs, baseDrawX, baseDrawY, cycleProgress, targetImgWidth, targetImgHeight) => {
      let offsetX = 0;
      let offsetY = 0;
      
      // Apply animation if configured
      if (config.animationConfig) {
        const { bobAmplitude, bobFrequency, rotationAmplitude } = config.animationConfig;
        
        if (bobAmplitude && bobFrequency) {
          offsetY = Math.sin(nowMs * bobFrequency) * bobAmplitude;
        }
        
        if (rotationAmplitude) {
          // Subtle rotation animation
          const rotation = Math.sin(nowMs * 0.001) * rotationAmplitude * (Math.PI / 180);
          return { offsetX, offsetY, rotation };
        }
      }
      
      return { offsetX, offsetY };
    },
    
    fallbackColor: config.fallbackColor
  };
}

// Interaction distance constants (shared across all resources)
export const RESOURCE_INTERACTION_DISTANCE_SQUARED = 3600; // 60px squared 