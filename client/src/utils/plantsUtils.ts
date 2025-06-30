/**
 * Plant and seed utilities that work with SpacetimeDB generated data
 * This eliminates hardcoding of plant names by using the actual item definitions
 * and inferring rules from patterns in names and descriptions.
 */

import { ItemDefinition } from '../generated';

/**
 * Determines if an item is a plantable seed based on SpacetimeDB item definitions
 * Uses item category and name patterns to identify seeds
 */
export function isPlantableSeed(itemDef: ItemDefinition): boolean {
  // All seeds are categorized as Placeable in the database
  if (itemDef.category.tag !== 'Placeable') {
    return false;
  }
  
  // Check if the item name or description indicates it's a seed
  const name = itemDef.name.toLowerCase();
  const description = itemDef.description.toLowerCase();
  
  return (
    name.includes('seed') ||
    name.includes('spore') ||
    name.includes('rhizome') ||
    description.includes('plant') ||
    description.includes('grow') ||
    description.includes('deploy')
  );
}

/**
 * Gets all plantable seeds from the item definitions
 * Returns the actual item definitions, not hardcoded names
 */
export function getPlantableSeeds(itemDefinitions: Map<string, ItemDefinition>): ItemDefinition[] {
  return Array.from(itemDefinitions.values())
    .filter(isPlantableSeed)
    .sort((a, b) => a.name.localeCompare(b.name)); // Sort alphabetically
}

/**
 * Gets just the names of plantable seeds for backwards compatibility
 * Use getPlantableSeeds() for the full data where possible
 */
export function getPlantableSeedNames(itemDefinitions: Map<string, ItemDefinition>): string[] {
  return getPlantableSeeds(itemDefinitions).map(item => item.name);
}

/**
 * Determines if a seed requires water placement (like Reed Rhizome)
 * Uses name/description patterns to infer water requirements
 */
export function requiresWaterPlacement(itemName: string, itemDef?: ItemDefinition): boolean {
  const name = itemName.toLowerCase();
  const description = itemDef?.description.toLowerCase() || '';
  
  return (
    name.includes('reed') ||
    name.includes('rhizome') ||
    description.includes('water') ||
    description.includes('near water')
  );
}

/**
 * Determines if a seed can be planted on land (most seeds)
 * Uses name/description patterns to infer land suitability
 */
export function canPlantOnLand(itemName: string, itemDef?: ItemDefinition): boolean {
  // Most seeds can be planted on land, except water-specific ones
  return !requiresWaterPlacement(itemName, itemDef);
}

/**
 * Gets the plant placement type for a seed
 */
export type PlantPlacementType = 'land' | 'water' | 'both';

export function getPlantPlacementType(itemName: string, itemDef?: ItemDefinition): PlantPlacementType {
  if (requiresWaterPlacement(itemName, itemDef)) {
    return 'water';
  }
  return 'land';
}

/**
 * Check if a seed item is valid for planting based on item name patterns
 * This replaces hardcoded seed name checks with pattern recognition
 */
export function isSeedItemValid(itemName: string, itemDefinitions?: Map<string, ItemDefinition>): boolean {
  // If we have full item definitions, use the complete check
  if (itemDefinitions) {
    const itemDef = itemDefinitions.get(itemName);
    return itemDef ? isPlantableSeed(itemDef) : false;
  }
  
  // Fallback: use name patterns (for when itemDefinitions not available)
  const name = itemName.toLowerCase();
  return (
    name.includes('seed') ||
    name.includes('spore') ||
    name.includes('rhizome') ||
    name.includes('potato') // "Seed Potato"
  );
} 