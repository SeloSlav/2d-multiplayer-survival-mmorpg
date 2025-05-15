import {
  Player as SpacetimeDBPlayer,
  Tree as SpacetimeDBTree,
  Stone as SpacetimeDBStone,
  Campfire as SpacetimeDBCampfire,
  Mushroom as SpacetimeDBMushroom,
  DroppedItem as SpacetimeDBDroppedItem,
  WoodenStorageBox as SpacetimeDBWoodenStorageBox,
  Corn as SpacetimeDBCorn,
  Hemp as SpacetimeDBHemp,
  SleepingBag as SpacetimeDBSleepingBag,
  PlayerCorpse as SpacetimeDBPlayerCorpse,
  Stash as SpacetimeDBStash
} from '../generated'; // Import necessary types

// Type guard for Player
export function isPlayer(entity: any): entity is SpacetimeDBPlayer {
  return entity && typeof entity.identity !== 'undefined' && typeof entity.positionX === 'number'; // Added position check for robustness
}

// Type guard for Tree
export function isTree(entity: any): entity is SpacetimeDBTree {
  return entity && typeof entity.treeType !== 'undefined' && typeof entity.posX === 'number'; // Added position check
}

// Type guard for Stone
export function isStone(entity: any): entity is SpacetimeDBStone {
  return entity && typeof entity.health === 'number' &&
         typeof entity.posX === 'number' && typeof entity.posY === 'number' &&
         // Ensure it doesn't match other types with similar fields
         typeof entity.identity === 'undefined' && typeof entity.treeType === 'undefined' &&
         typeof entity.placedBy === 'undefined' && typeof entity.itemDefId === 'undefined';
}

// Type guard for Campfire
export function isCampfire(entity: any): entity is SpacetimeDBCampfire {
    return entity && typeof entity.placedBy !== 'undefined' && typeof entity.posX === 'number' && typeof entity.posY === 'number' && typeof entity.isBurning === 'boolean'; // Added isBurning check
}

// Type guard for Mushroom
export function isMushroom(entity: any): entity is SpacetimeDBMushroom {
    const result = entity && 
           typeof entity.posX === 'number' && 
           typeof entity.posY === 'number' && 
           typeof entity.id !== 'undefined' && 
           // Ensure it doesn't match others
           typeof entity.identity === 'undefined' && 
           typeof entity.treeType === 'undefined' &&
           typeof entity.health === 'undefined' && 
           typeof entity.placedBy === 'undefined' &&
           typeof entity.itemDefId === 'undefined'
           ;

    return result;
}

// Type guard for Corn
export function isCorn(entity: any): entity is SpacetimeDBCorn {
    const result = entity && 
           typeof entity.posX === 'number' && 
           typeof entity.posY === 'number' && 
           typeof entity.id !== 'undefined' && 
           // Ensure it doesn't match others
           typeof entity.identity === 'undefined' && 
           typeof entity.treeType === 'undefined' &&
           typeof entity.health === 'undefined' && 
           typeof entity.placedBy === 'undefined' &&
           typeof entity.itemDefId === 'undefined'
           ;
    
    return result;
}

// Type guard for Hemp
export function isHemp(entity: any): entity is SpacetimeDBHemp {
    const result = entity && 
           typeof entity.posX === 'number' && 
           typeof entity.posY === 'number' && 
           typeof entity.id !== 'undefined' && 
           // Ensure it doesn't match other resource types or entities
           typeof entity.identity === 'undefined' && // Not a Player
           typeof entity.treeType === 'undefined' && // Not a Tree
           typeof entity.health === 'undefined' && // Not a Stone (or other entities with health like Player)
           typeof entity.placedBy === 'undefined' && // Not a Campfire, Box, or SleepingBag
           typeof entity.itemDefId === 'undefined' && // Not a DroppedItem
           typeof entity.isBurning === 'undefined' && // Not a Campfire
           // Differentiate from Corn/Mushroom by checking a non-existent unique field or by ensuring it IS hemp via a marker if added later
           // For now, relying on the specific structure and absence of other markers.
           // If Corn and Mushroom have a field that Hemp doesn't, that could be used.
           // This guard might need refinement if Hemp becomes structurally identical to Corn/Mushroom
           // without a specific type marker from the backend (like __entityType when mapped in client state).
           true; // Placeholder for further differentiation if needed
    
    return result;
}

// Type guard for WoodenStorageBox
export function isWoodenStorageBox(entity: any): entity is SpacetimeDBWoodenStorageBox {
  return entity && typeof entity.posX === 'number' &&
         typeof entity.posY === 'number' &&
         typeof entity.placedBy !== 'undefined' && // Check if placedBy exists
         typeof entity.isBurning === 'undefined'; // Differentiate from Campfire
}

// Type guard for DroppedItem
export function isDroppedItem(entity: any): entity is SpacetimeDBDroppedItem {
    return entity && typeof entity.posX === 'number' && typeof entity.posY === 'number' &&
           typeof entity.itemDefId !== 'undefined' && // Check for itemDefId
           // Ensure it doesn't match others
           typeof entity.identity === 'undefined' &&
           typeof entity.treeType === 'undefined' &&
           typeof entity.health === 'undefined' &&
           typeof entity.placedBy === 'undefined';
}

// Type guard for SleepingBag
export function isSleepingBag(entity: any): entity is SpacetimeDBSleepingBag {
  return entity && 
         typeof entity.posX === 'number' &&
         typeof entity.posY === 'number' &&
         typeof entity.placedBy !== 'undefined' && // Has placedBy
         typeof entity.isBurning === 'undefined' && // Not a campfire
         typeof entity.slot_instance_id_0 === 'undefined'; // Not a storage box (check first slot)
}

// Type guard for PlayerCorpse
export function isPlayerCorpse(entity: any): entity is SpacetimeDBPlayerCorpse {
    return entity && typeof entity.ownerIdentity === 'object' && typeof entity.posX === 'number' && typeof entity.posY === 'number' && typeof entity.despawnAt === 'bigint';
}

export function isStash(entity: any): entity is SpacetimeDBStash {
    // Check for properties unique to Stash or common identifiable ones
    // For example, `isHidden` and `ownerIdentity` might be good indicators.
    return entity && typeof entity.ownerIdentity === 'object' && typeof entity.posX === 'number' && typeof entity.posY === 'number' && typeof entity.isHidden === 'boolean';
} 