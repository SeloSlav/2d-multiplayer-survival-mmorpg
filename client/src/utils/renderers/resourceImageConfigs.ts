// Resource Image Configuration
// Centralized location for all resource image imports and mappings

import type { ResourceType } from '../../types/resourceTypes';

// Import all resource images
import cornImageSource from '../../assets/doodads/corn_stalk_b.png';
import hempImageSource from '../../assets/doodads/hemp_c.png';
import mushroomImageSource from '../../assets/doodads/mushroom_b.png';
import potatoImageSource from '../../assets/doodads/potato_b.png';
import pumpkinImageSource from '../../assets/doodads/pumpkin_b.png';
import reedImageSource from '../../assets/doodads/reed_stalk_b.png';
import beachLymeGrassImageSource from '../../assets/doodads/beach_lyme_grass_c.png';

// Resource type to image source mapping
export const RESOURCE_IMAGE_SOURCES: Record<ResourceType, string> = {
  Corn: cornImageSource,
  Hemp: hempImageSource,
  Mushroom: mushroomImageSource,
  Potato: potatoImageSource,
  Pumpkin: pumpkinImageSource,
  Reed: reedImageSource,
  BeachLymeGrass: beachLymeGrassImageSource
};

// Helper function to get image source for a resource type
export function getResourceImageSource(resourceType: ResourceType): string {
  return RESOURCE_IMAGE_SOURCES[resourceType];
} 