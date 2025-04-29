import {
  Player as SpacetimeDBPlayer,
  Tree as SpacetimeDBTree,
  Stone as SpacetimeDBStone,
  Campfire as SpacetimeDBCampfire,
  Mushroom as SpacetimeDBMushroom,
  DroppedItem as SpacetimeDBDroppedItem,
  WoodenStorageBox as SpacetimeDBWoodenStorageBox,
  Corn as SpacetimeDBCorn,
  SleepingBag as SpacetimeDBSleepingBag,
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