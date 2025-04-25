import {
  Player as SpacetimeDBPlayer,
  Tree as SpacetimeDBTree,
  Stone as SpacetimeDBStone,
  Campfire as SpacetimeDBCampfire,
  Mushroom as SpacetimeDBMushroom,
  DroppedItem as SpacetimeDBDroppedItem,
  WoodenStorageBox as SpacetimeDBWoodenStorageBox,
  Corn as SpacetimeDBCorn,
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
    // Check for the explicit entity type marker first
    if (entity && entity.__entityType === 'mushroom') {
        return true;
    }
    
    const result = entity && 
           typeof entity.posX === 'number' && 
           typeof entity.posY === 'number' && 
           typeof entity.id !== 'undefined' && 
           // Ensure it doesn't match others
           typeof entity.identity === 'undefined' && 
           typeof entity.treeType === 'undefined' &&
           typeof entity.health === 'undefined' && 
           typeof entity.placedBy === 'undefined' &&
           typeof entity.itemDefId === 'undefined' &&
           // Don't match entities explicitly marked as corn
           entity.__entityType !== 'corn';

    return result;
}

// Type guard for Corn
export function isCorn(entity: any): entity is SpacetimeDBCorn {
    // Check for the explicit entity type marker first
    if (entity && entity.__entityType === 'corn') {
        return true;
    }
    
    // Only perform other checks if no explicit type marker is present
    const result = entity && 
           typeof entity.posX === 'number' && 
           typeof entity.posY === 'number' && 
           typeof entity.id !== 'undefined' && 
           // Ensure it doesn't match others
           typeof entity.identity === 'undefined' && 
           typeof entity.treeType === 'undefined' &&
           typeof entity.health === 'undefined' && 
           typeof entity.placedBy === 'undefined' &&
           typeof entity.itemDefId === 'undefined' &&
           // We can't rely on constructor name, so this is our fallback
           // but it will rarely be triggered now due to __entityType check
           entity.__entityType !== 'mushroom';
    
    // Always log corn entities to see if they're being found at all
    if (result) {
        console.log('Entity identified as Corn:', entity);
    }
    
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