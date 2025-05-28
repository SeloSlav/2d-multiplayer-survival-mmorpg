// Resource Configuration System for Harvestable Resources
import { GroundEntityConfig } from './genericGroundRenderer';
import { HarvestableResource, ResourceType, TypedHarvestableResource } from '../../types/resourceTypes';
import { drawDynamicGroundShadow } from './shadowUtils';

// Import all resource images
import cornImageSource from '../../assets/doodads/corn_stalk.png';
import hempImageSource from '../../assets/doodads/hemp.png';
import mushroomImageSource from '../../assets/doodads/mushroom.png';
import pumpkinImageSource from '../../assets/doodads/pumpkin.png';

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
  
  // Interaction properties
  interactionLabel: string;
  harvestAmount: {
    min: number;
    max: number;
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

// Configuration for each resource type
export const RESOURCE_CONFIGS: Record<ResourceType, ResourceConfig> = {
  corn: {
    imageSource: cornImageSource,
    targetWidth: 64,
    shadowConfig: {
      maxStretchFactor: 1.8,
      shadowBlur: 8,
      pivotYOffset: 0.15,
      opacity: 0.4
    },
    interactionLabel: "Press E to Harvest Corn",
    harvestAmount: { min: 1, max: 3 },
    fallbackColor: '#FFD700'
    // No animation config - corn is now static
  },
  
  hemp: {
    imageSource: hempImageSource,
    targetWidth: 68,
    shadowConfig: {
      maxStretchFactor: 2.0,
      shadowBlur: 10,
      pivotYOffset: 0.12,
      opacity: 0.35
    },
    interactionLabel: "Press E to Harvest Hemp",
    harvestAmount: { min: 2, max: 4 },
    fallbackColor: '#228B22'
    // No animation config - hemp is now static
  },
  
  mushroom: {
    imageSource: mushroomImageSource,
    targetWidth: 56,
    shadowConfig: {
      maxStretchFactor: 1.5,
      shadowBlur: 6,
      pivotYOffset: 0.2,
      opacity: 0.5
    },
    interactionLabel: "Press E to Pick Mushroom",
    harvestAmount: { min: 1, max: 2 },
    fallbackColor: '#8B4513'
    // No animation config - mushroom is now static
  },
  
  pumpkin: {
    imageSource: pumpkinImageSource,
    targetWidth: 64,
    shadowConfig: {
      maxStretchFactor: 1.6,
      shadowBlur: 12,
      pivotYOffset: 0.18,
      opacity: 0.45
    },
    interactionLabel: "Press E to Harvest Pumpkin",
    harvestAmount: { min: 1, max: 1 },
    fallbackColor: '#FF8C00'
    // No animation config - pumpkins are static
  }
};

// Helper function to get configuration for a resource
export function getResourceConfig(resourceType: ResourceType): ResourceConfig {
  return RESOURCE_CONFIGS[resourceType];
}

// Helper function to get configuration from entity
export function getResourceConfigFromEntity(entity: TypedHarvestableResource): ResourceConfig {
  return getResourceConfig(entity.__resourceType);
}

// Create GroundEntityConfig for a specific resource type
export function createResourceGroundConfig(resourceType: ResourceType): GroundEntityConfig<TypedHarvestableResource> {
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

// Helper to get interaction label for a resource
export function getResourceInteractionLabel(resourceType: ResourceType): string {
  return getResourceConfig(resourceType).interactionLabel;
}

// Helper to get harvest amount range for a resource
export function getResourceHarvestAmount(resourceType: ResourceType): { min: number; max: number } {
  return getResourceConfig(resourceType).harvestAmount;
} 