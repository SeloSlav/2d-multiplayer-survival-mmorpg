/**
 * Plant and seed utilities that work with SpacetimeDB generated data
 * This eliminates hardcoding of plant names by using the actual item definitions
 * and inferring rules from patterns in names and descriptions.
 * 
 * ALL SEEDS are now in seeds.rs as Placeable category items.
 * Only RAW seeds can be planted - cooked/burnt/toasted variants cannot be planted.
 */

import { ItemDefinition } from '../generated';

/**
 * Determines if an item is plantable (seeds, cuttings, bulbs, etc.) based on SpacetimeDB item definitions
 * Only RAW plantable items can be planted - cooked/burnt/toasted variants cannot be planted
 */
export function isPlantableSeed(itemDef: ItemDefinition): boolean {
  // All seeds are categorized as Placeable in the database
  if (itemDef.category.tag !== 'Placeable') {
    return false;
  }
  
  const name = itemDef.name.toLowerCase();
  const description = itemDef.description.toLowerCase();
  
  // Exclude cooked/burnt/toasted variants - only raw seeds can be planted
  if (name.includes('cooked') || name.includes('burnt') || name.includes('toasted') || name.includes('roasted')) {
    return false;
  }
  
  // Check if the item name or description indicates it's plantable (seeds, cuttings, bulbs, etc.)
  return (
    name.includes('seed') ||
    name.includes('spore') ||
    name.includes('rhizome') ||
    name.includes('cuttings') || // "Mint Cuttings"
    name.includes('bulbs') || // "Bear Garlic Bulbs"
    name.includes('potato') || // "Seed Potato"
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
  
  // Specific exclusions for items that contain "reed" but aren't water-requiring plants
  if (name.includes('rain collector') || name.includes('collector')) {
    return false;
  }
  
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
 * Check if a plantable item is valid for planting based on item name patterns
 * Only RAW plantable items can be planted - cooked/burnt/toasted variants cannot be planted
 */
export function isSeedItemValid(itemName: string, itemDefinitions?: Map<string, ItemDefinition>): boolean {
  // If we have full item definitions, use the complete check
  if (itemDefinitions) {
    const itemDef = itemDefinitions.get(itemName);
    return itemDef ? isPlantableSeed(itemDef) : false;
  }
  
  // Fallback: use name patterns (for when itemDefinitions not available)
  const name = itemName.toLowerCase();
  
  // Exclude cooked/burnt variants
  if (name.includes('cooked') || name.includes('burnt') || name.includes('toasted') || name.includes('roasted')) {
    return false;
  }
  
  return (
    name.includes('seed') ||
    name.includes('spore') ||
    name.includes('rhizome') ||
    name.includes('cuttings') || // "Mint Cuttings"
    name.includes('bulbs') || // "Bear Garlic Bulbs"
    name.includes('potato') // "Seed Potato"
  );
} 