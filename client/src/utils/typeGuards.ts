import {
  Player as SpacetimeDBPlayer,
  Tree as SpacetimeDBTree,
  Stone as SpacetimeDBStone,
  Campfire as SpacetimeDBCampfire,
  DroppedItem as SpacetimeDBDroppedItem,
  WoodenStorageBox as SpacetimeDBWoodenStorageBox,
  SleepingBag as SpacetimeDBSleepingBag,
  PlayerCorpse as SpacetimeDBPlayerCorpse,
  Stash as SpacetimeDBStash,
  Grass as SpacetimeDBGrass,
  Shelter, // ADDED Shelter type
  RainCollector as SpacetimeDBRainCollector, // ADDED RainCollector type
  WildAnimal as SpacetimeDBWildAnimal, // ADDED WildAnimal type
  AnimalCorpse as SpacetimeDBAnimalCorpse, // ADDED AnimalCorpse type
  Barrel as SpacetimeDBBarrel, // ADDED Barrel type
  SeaStack, // ADDED SeaStack type
  Player,
  Tree,
  Stone,
  Campfire,
  Lantern,
  PlantedSeed,
  DroppedItem,
  Cloud,
  HarvestableResource,
  WoodenStorageBox,
  SleepingBag,
  PlayerCorpse,
  Stash,
  Grass,
  RainCollector,
  WildAnimal,
  AnimalCorpse,
  Barrel
} from '../generated'; // Import necessary types
import { InterpolatedGrassData } from '../hooks/useGrassInterpolation';
import { isHarvestableResource } from '../types/resourceTypes';

// Type guard for Player
export function isPlayer(entity: any): entity is SpacetimeDBPlayer {
  return entity && typeof entity.identity !== 'undefined' && typeof entity.positionX === 'number'; // Added position check for robustness
}

// Type guard for Tree
export function isTree(entity: any): entity is Tree {
  return entity && 
         typeof entity.posX === 'number' &&
         typeof entity.posY === 'number' &&
         typeof entity.id !== 'undefined' &&
         typeof entity.chunkIndex === 'number' &&
         (entity.respawnAt === null || entity.respawnAt instanceof Date || typeof entity.respawnAt === 'undefined');
}

// Type guard for Stone
export function isStone(entity: any): entity is Stone {
  return entity && 
         typeof entity.posX === 'number' &&
         typeof entity.posY === 'number' &&
         typeof entity.id !== 'undefined' &&
         typeof entity.chunkIndex === 'number' &&
         (entity.respawnAt === null || entity.respawnAt instanceof Date || typeof entity.respawnAt === 'undefined');
}

// Type guard for Campfire
export function isCampfire(entity: any): entity is Campfire {       
  return entity && 
         typeof entity.posX === 'number' &&
         typeof entity.posY === 'number' &&
         typeof entity.id !== 'undefined' &&
         typeof entity.chunkIndex === 'number' &&
         typeof entity.fuel === 'number';
}

// Type guard for Lantern
export function isLantern(entity: any): entity is Lantern {
  return entity && 
         typeof entity.posX === 'number' &&
         typeof entity.posY === 'number' &&
         typeof entity.id !== 'undefined' &&
         typeof entity.chunkIndex === 'number' &&
         typeof entity.isBurning === 'boolean' &&
         typeof entity.fuelInstanceId0 !== 'undefined'; // Check for lantern-specific fuel properties
}

// Type guard for PlantedSeed
export function isPlantedSeed(entity: any): entity is PlantedSeed {
  return entity && 
         typeof entity.posX === 'number' &&
         typeof entity.posY === 'number' &&
         typeof entity.id !== 'undefined' &&
         typeof entity.chunkIndex === 'number' &&
         typeof entity.seedType === 'string' &&
         entity.plantedAt instanceof Date;
}

// Type guard for WoodenStorageBox
export function isWoodenStorageBox(entity: any): entity is WoodenStorageBox {
  return entity && 
         typeof entity.posX === 'number' &&
         typeof entity.posY === 'number' &&
         typeof entity.id !== 'undefined' &&
         typeof entity.chunkIndex === 'number';
}

// Type guard for DroppedItem
export function isDroppedItem(entity: any): entity is DroppedItem {
    return entity && 
           typeof entity.posX === 'number' &&
           typeof entity.posY === 'number' &&
           typeof entity.id !== 'undefined' &&
           typeof entity.chunkIndex === 'number' &&
           typeof entity.itemName === 'string' &&
           typeof entity.quantity === 'number' &&
           entity.droppedAt instanceof Date;
}

// Type guard for SleepingBag
export function isSleepingBag(entity: any): entity is SleepingBag {
  return entity && 
         typeof entity.posX === 'number' &&
         typeof entity.posY === 'number' &&
         typeof entity.placedBy !== 'undefined' && // Has placedBy
         typeof entity.isBurning === 'undefined' && // Not a campfire
         typeof entity.slot_instance_id_0 === 'undefined'; // Not a storage box (check first slot)
}

// Type guard for PlayerCorpse
export function isPlayerCorpse(entity: any): entity is PlayerCorpse {
    return entity && 
           typeof entity.posX === 'number' &&
           typeof entity.posY === 'number' &&
           typeof entity.id !== 'undefined' &&
           typeof entity.chunkIndex === 'number' &&
           typeof entity.playerName === 'string' &&
           entity.deathTime instanceof Date;
}

export function isStash(entity: any): entity is Stash {
    // Check for properties unique to Stash or common identifiable ones
    // For example, `isHidden` and `ownerIdentity` might be good indicators.
    return entity && typeof entity.ownerIdentity === 'object' && typeof entity.posX === 'number' && typeof entity.posY === 'number' && typeof entity.isHidden === 'boolean';
}

// Type guard for Grass
export function isGrass(entity: any): entity is Grass {
  return entity && 
         typeof entity.posX === 'number' &&
         typeof entity.posY === 'number' &&
         typeof entity.id !== 'undefined' &&
         typeof entity.chunkIndex === 'number' &&
         (entity.respawnAt === null || entity.respawnAt instanceof Date || typeof entity.respawnAt === 'undefined');
}

export function isShelter(entity: any): entity is Shelter {
    return entity && typeof entity.posX === 'number' && typeof entity.posY === 'number' && typeof entity.id !== 'undefined' && typeof entity.chunkIndex === 'number' && typeof entity.structureType === 'string';
}

// Type guard for Cloud
export function isCloud(entity: any): entity is Cloud {
  return entity && 
         typeof entity.posX === 'number' &&
         typeof entity.posY === 'number' &&
         typeof entity.id !== 'undefined' &&
         typeof entity.speed === 'number' &&
         typeof entity.direction === 'number' &&
         typeof entity.shapeType === 'number' &&
         typeof entity.opacity === 'number';
}

// Type guard for RainCollector
export function isRainCollector(entity: any): entity is RainCollector {
    return entity && 
           typeof entity.posX === 'number' && 
           typeof entity.posY === 'number' && 
           typeof entity.id !== 'undefined' &&
           typeof entity.totalWaterCollected === 'number' && // Unique to rain collectors
           typeof entity.placedBy !== 'undefined' && // Has placedBy like other placed items
           typeof entity.isDestroyed === 'boolean' && // Has destruction state
           // Ensure it doesn't match other types
           typeof entity.identity === 'undefined' && // Not a Player
           typeof entity.treeType === 'undefined' && // Not a Tree
           typeof entity.health === 'undefined' && // Not a Stone
           typeof entity.isBurning === 'undefined' && // Not a Campfire
           typeof entity.itemDefId === 'undefined'; // Not a DroppedItem
}

// Type guard for WildAnimal
export function isWildAnimal(entity: any): entity is WildAnimal {
    return entity && 
           typeof entity.posX === 'number' && 
           typeof entity.posY === 'number' && 
           typeof entity.id !== 'undefined' &&
           typeof entity.chunkIndex === 'number' &&
           entity.species && typeof entity.species === 'object' && typeof entity.species.tag === 'string' &&
           typeof entity.health === 'number' &&
           entity.state && typeof entity.state === 'object' && typeof entity.state.tag === 'string';
}

// Type guard for AnimalCorpse
export function isAnimalCorpse(entity: any): entity is AnimalCorpse {
    return entity && 
           typeof entity.posX === 'number' && 
           typeof entity.posY === 'number' && 
           typeof entity.id !== 'undefined' &&
           typeof entity.animalSpecies === 'object' && // AnimalSpecies enum
           typeof entity.animalId === 'number' && // Original animal ID
           typeof entity.health === 'number' &&
           typeof entity.maxHealth === 'number' &&
           typeof entity.deathTime !== 'undefined' &&
           typeof entity.despawnAt !== 'undefined' &&
           // Ensure it doesn't match other types
           typeof entity.identity === 'undefined' && // Not a Player
           typeof entity.treeType === 'undefined' && // Not a Tree
           typeof entity.placedBy === 'undefined' && // Not a placed item
           typeof entity.itemDefId === 'undefined' && // Not a DroppedItem
           typeof entity.isBurning === 'undefined' && // Not a Campfire
           typeof entity.ownerIdentity === 'undefined' && // Not a PlayerCorpse or Stash
           typeof entity.state === 'undefined'; // Not a WildAnimal (has state)
}

// Type guard for knocked out players
export function isKnockedOutPlayer(entity: any): entity is Player {
    return entity && 
           typeof entity.identity !== 'undefined' && 
           typeof entity.positionX === 'number' && 
           typeof entity.positionY === 'number' &&
           entity.isKnockedOut === true && 
           entity.isDead !== true && // Not dead, just knocked out
           // Ensure it's actually a player
           typeof entity.username === 'string' &&
           typeof entity.direction === 'string';
}

// Type guard for Barrel
export function isBarrel(entity: any): entity is Barrel {
    return entity && 
           typeof entity.posX === 'number' && 
           typeof entity.posY === 'number' && 
           typeof entity.id !== 'undefined' &&
           typeof entity.health === 'number' &&
           typeof entity.variant === 'number' && // Barrel variants (0, 1, 2)
           typeof entity.clusterId === 'number' && // Barrel cluster ID
           typeof entity.chunkIndex === 'number' &&
           // Ensure it doesn't match other types
           typeof entity.identity === 'undefined' && // Not a Player
           typeof entity.treeType === 'undefined' && // Not a Tree  
           typeof entity.placedBy === 'undefined' && // Not a placed item
           typeof entity.itemDefId === 'undefined' && // Not a DroppedItem
           typeof entity.isBurning === 'undefined' && // Not a Campfire
           typeof entity.ownerIdentity === 'undefined' && // Not a PlayerCorpse or Stash
           typeof entity.species === 'undefined' && // Not a WildAnimal
           typeof entity.animalSpecies === 'undefined'; // Not an AnimalCorpse
}

// Type guard for SeaStack
export function isSeaStack(entity: any): entity is SeaStack {
    return entity && 
           typeof entity.posX === 'number' && 
           typeof entity.posY === 'number' && 
           typeof entity.id !== 'undefined' &&
           typeof entity.chunkIndex === 'number' &&
           typeof entity.scale === 'number' && // Sea stack scale
           typeof entity.rotation === 'number' && // Sea stack rotation
           typeof entity.opacity === 'number' && // Sea stack opacity
           typeof entity.variant === 'object' && // SeaStackVariant enum
           // Ensure it doesn't match other types
           typeof entity.identity === 'undefined' && // Not a Player
           typeof entity.treeType === 'undefined' && // Not a Tree
           typeof entity.health === 'undefined' && // Not a Stone/Barrel
           typeof entity.placedBy === 'undefined' && // Not a placed item
           typeof entity.itemDefId === 'undefined' && // Not a DroppedItem
           typeof entity.isBurning === 'undefined' && // Not a Campfire
           typeof entity.ownerIdentity === 'undefined' && // Not a PlayerCorpse or Stash
           typeof entity.species === 'undefined' && // Not a WildAnimal
           typeof entity.animalSpecies === 'undefined'; // Not an AnimalCorpse
}

// Re-export harvestable resource type guards from resourceTypes
export { 
  isHarvestableResource, 
};

// Master type guard for all interactable entities
export function isInteractableEntity(entity: any): boolean {
  return isPlayer(entity) || 
         isTree(entity) || 
         isStone(entity) || 
         isHarvestableResource(entity) ||
         isWoodenStorageBox(entity) || 
         isCampfire(entity) || 
         isLantern(entity) || 
         isPlantedSeed(entity) || 
         isDroppedItem(entity) || 
         isShelter(entity) || 
         isGrass(entity) || 
         isWildAnimal(entity) || 
         isPlayerCorpse(entity);
}

// Helper function to get entity type string
export function getEntityTypeString(entity: any): string {
  if (isPlayer(entity)) return 'player';
  if (isTree(entity)) return 'tree';
  if (isStone(entity)) return 'stone';
  
  // Check harvestable resources (unified system)
  if (isHarvestableResource(entity)) {
    return 'harvestable_resource';
  }
  
  if (isWoodenStorageBox(entity)) return 'wooden_storage_box';
  if (isCampfire(entity)) return 'campfire';
  if (isLantern(entity)) return 'lantern';
  if (isPlantedSeed(entity)) return 'planted_seed';
  if (isDroppedItem(entity)) return 'dropped_item';
  if (isShelter(entity)) return 'shelter';
  if (isGrass(entity)) return 'grass';
  if (isCloud(entity)) return 'cloud';
  if (isWildAnimal(entity)) return 'wild_animal';
  if (isPlayerCorpse(entity)) return 'player_corpse';
  if (isBarrel(entity)) return 'barrel';
  if (isAnimalCorpse(entity)) return 'animal_corpse';
  if (isSeaStack(entity)) return 'sea_stack';
  
  return 'unknown';
} 