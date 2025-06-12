// Game Context Builder for SOVA AI
// Builds comprehensive game state context for AI responses

export interface GameContext {
  timeOfDay: string;
  currentWeather: string;
  rainIntensity: number;
  cycleProgress: number;
  isFullMoon: boolean;
  playerHealth: number;
  playerWarmth: number;
  playerHunger: number;
  playerThirst: number;
  currentEquipment: string;
  craftableItems: string[];
  nearbyItems: string[];
  currentResources: string[];
  // New detailed inventory/hotbar data for SOVA
  inventorySlots: InventorySlotInfo[];
  hotbarSlots: HotbarSlotInfo[];
  totalInventorySlots: number;
  totalHotbarSlots: number;
}

export interface InventorySlotInfo {
  slotIndex: number;
  itemName: string | null;
  quantity: number;
  isEmpty: boolean;
}

export interface HotbarSlotInfo {
  slotIndex: number;
  itemName: string | null;
  quantity: number;
  isEmpty: boolean;
  isActiveItem: boolean;
}

export interface GameContextBuilderProps {
  worldState?: any;
  localPlayer?: any;
  itemDefinitions?: Map<string, any>;
  activeEquipments?: Map<string, any>;
  inventoryItems?: Map<string, any>;
  localPlayerIdentity?: string;
}

/**
 * Convert time of day enum to readable string
 */
const getTimeOfDayString = (timeOfDay: any): string => {
  if (!timeOfDay) return 'Unknown';
  if (typeof timeOfDay === 'string') return timeOfDay;
  
  // Handle enum values
  switch (timeOfDay) {
    case 'Dawn': return 'Dawn';
    case 'TwilightMorning': return 'Morning Twilight';
    case 'Morning': return 'Morning';
    case 'Noon': return 'Noon';
    case 'Afternoon': return 'Afternoon';
    case 'Dusk': return 'Dusk';
    case 'TwilightEvening': return 'Evening Twilight';
    case 'Night': return 'Night';
    case 'Midnight': return 'Midnight';
    default: return 'Unknown';
  }
};

/**
 * Convert weather enum to readable string
 */
const getWeatherString = (weather: any): string => {
  if (!weather) return 'Clear';
  
  // Handle string values directly
  if (typeof weather === 'string') return weather;
  
  // Handle tagged union pattern from SpacetimeDB
  if (weather.tag) {
    switch (weather.tag) {
      case 'Clear': return 'Clear';
      case 'LightRain': return 'Light Rain';
      case 'ModerateRain': return 'Moderate Rain';
      case 'HeavyRain': return 'Heavy Rain';
      case 'HeavyStorm': return 'Heavy Storm';
      default: return weather.tag || 'Clear';
    }
  }
  
  // Handle direct enum values (fallback)
  switch (weather) {
    case 'Clear': return 'Clear';
    case 'LightRain': return 'Light Rain';
    case 'ModerateRain': return 'Moderate Rain';
    case 'HeavyRain': return 'Heavy Rain';
    case 'HeavyStorm': return 'Heavy Storm';
    default: return 'Clear';
  }
};

/**
 * Get current equipment name for the player
 */
const getCurrentEquipment = (
  activeEquipments?: Map<string, any>,
  localPlayerIdentity?: string,
  itemDefinitions?: Map<string, any>
): string => {
  if (!activeEquipments || !localPlayerIdentity) return 'None';
  
  const playerEquipment = activeEquipments.get(localPlayerIdentity);
  if (!playerEquipment || !playerEquipment.itemDefId || !itemDefinitions) {
    return 'None';
  }
  
  const equipmentDef = itemDefinitions.get(playerEquipment.itemDefId.toString());
  return equipmentDef?.name || 'Unknown Equipment';
};

/**
 * Get list of craftable items with exact resource costs from SpacetimeDB
 */
const getCraftableItems = (itemDefinitions?: Map<string, any>): string[] => {
  if (!itemDefinitions) {
    return [];
  }
  
  const craftableItems: string[] = [];
  
  // Iterate through all item definitions to find craftable items
  itemDefinitions.forEach((itemDef, itemId) => {
    // Check if item has crafting cost (meaning it's craftable)
    // Handle both snake_case (from Rust) and camelCase (from TypeScript) field names
    const craftingCost = itemDef.craftingCost || itemDef.crafting_cost;
    const craftingTimeSecs = itemDef.craftingTimeSecs || itemDef.crafting_time_secs;
    const craftingOutputQuantity = itemDef.craftingOutputQuantity || itemDef.crafting_output_quantity;
    
    if (craftingCost && Array.isArray(craftingCost) && craftingCost.length > 0) {
      const itemName = itemDef.name || 'Unknown Item';
      const outputQuantity = craftingOutputQuantity || 1;
      const craftTime = craftingTimeSecs || 0;
      
      // Format crafting cost - access item_name and quantity directly from CostIngredient structure
      const costStrings = craftingCost.map((cost: any) => {
        // Handle both snake_case and camelCase field names
        const resourceName = cost.item_name || cost.itemName || 'Unknown Resource';
        const quantity = cost.quantity || 0;
        return `${quantity} ${resourceName}`;
      });
      
      const costString = costStrings.join(', ');
      const timeString = craftTime > 0 ? ` (takes ${craftTime}s)` : '';
      const outputString = outputQuantity > 1 ? ` → ${outputQuantity}x` : '';
      
      const finalString = `${itemName}${timeString}: ${costString}${outputString}`;
      craftableItems.push(finalString);
    }
  });
  
  // Sort alphabetically for consistent output
  return craftableItems.sort();
};

/**
 * Get nearby items (simplified - these are commonly available resources)
 */
const getNearbyItems = (): string[] => {
  return ['Wood', 'Stone', 'Plant Fiber', 'Mushrooms'];
};

/**
 * Get current inventory resources for crafting advice
 */
const getCurrentInventoryResources = (inventoryItems?: Map<string, any>, itemDefinitions?: Map<string, any>, localPlayerIdentity?: string): string[] => {
  if (!inventoryItems || !itemDefinitions || !localPlayerIdentity) return [];
  
  const resources: string[] = [];
  const resourceCounts = new Map<string, number>();
  
  // Aggregate quantities by item type
  inventoryItems.forEach(item => {
    if (item.ownerId?.toHexString() === localPlayerIdentity) {
      const itemDef = itemDefinitions.get(item.itemDefId.toString());
      if (itemDef) {
        const itemName = itemDef.name || 'Unknown Item';
        const currentCount = resourceCounts.get(itemName) || 0;
        resourceCounts.set(itemName, currentCount + item.quantity);
      }
    }
  });
  
  // Format without "x" - just show quantities
  resourceCounts.forEach((quantity, itemName) => {
    resources.push(`${quantity} ${itemName}`);
  });
  
  return resources;
};

/**
 * Get detailed inventory slot information (24 slots total)
 */
const getInventorySlots = (inventoryItems?: Map<string, any>, itemDefinitions?: Map<string, any>, localPlayerIdentity?: string): InventorySlotInfo[] => {
  const TOTAL_INVENTORY_SLOTS = 24;
  const slots: InventorySlotInfo[] = [];
  
  console.log('[GameContext] getInventorySlots called with:', {
    inventoryItemsSize: inventoryItems?.size || 0,
    itemDefinitionsSize: itemDefinitions?.size || 0,
    localPlayerIdentity,
  });
  
  // Initialize all slots as empty
  for (let i = 0; i < TOTAL_INVENTORY_SLOTS; i++) {
    slots.push({
      slotIndex: i,
      itemName: null,
      quantity: 0,
      isEmpty: true,
    });
  }
  
  if (!inventoryItems || !itemDefinitions || !localPlayerIdentity) {
    console.log('[GameContext] Missing required data for inventory extraction:', {
      hasInventoryItems: !!inventoryItems,
      hasItemDefinitions: !!itemDefinitions,
      hasLocalPlayerIdentity: !!localPlayerIdentity,
    });
    return slots;
  }
  
  let itemsProcessed = 0;
  let playerItems = 0;
  let inventoryItems_found = 0;
  
  // Fill slots with actual items
  inventoryItems.forEach((item, key) => {
    itemsProcessed++;
    
    // Debug: Log first few items to see structure
    if (itemsProcessed <= 3) {
      console.log(`[GameContext] Processing inventory item ${itemsProcessed}:`, {
        key,
        item: {
          ownerId: item.ownerId?.toHexString ? item.ownerId.toHexString() : item.ownerId,
          instanceId: item.instanceId,
          itemDefId: item.itemDefId,
          quantity: item.quantity,
          location: item.location,
          // Log the full item to see all properties
          fullItem: item,
        }
      });
    }
    
    // Check if item belongs to the player - handle multiple possible ownerId formats
    let itemOwnerId: string | undefined;
    
    // First, try to get owner ID from the location data (based on server structure)
    if (item.location?.value?.owner_id?.toHexString) {
      itemOwnerId = item.location.value.owner_id.toHexString();
    } else if (typeof item.location?.value?.owner_id === 'string') {
      itemOwnerId = item.location.value.owner_id;
    } else if (item.location?.value?.ownerId?.toHexString) {
      // Try camelCase variant
      itemOwnerId = item.location.value.ownerId.toHexString();
    } else if (typeof item.location?.value?.ownerId === 'string') {
      itemOwnerId = item.location.value.ownerId;
    } else if (item.ownerId?.toHexString) {
      // Fallback to direct ownerId property
      itemOwnerId = item.ownerId.toHexString();
    } else if (typeof item.ownerId === 'string') {
      itemOwnerId = item.ownerId;
    } else if (item.owner_id?.toHexString) {
      // Try alternative property name
      itemOwnerId = item.owner_id.toHexString();
    } else if (typeof item.owner_id === 'string') {
      itemOwnerId = item.owner_id;
    } else {
      // If no ownerId found, check if this might be a player item by other means
      // For now, log this case for debugging
      if (itemsProcessed <= 3) {
        console.log(`[GameContext] Item ${itemsProcessed} has no recognizable ownerId:`, {
          ownerId: item.ownerId,
          owner_id: item.owner_id,
          locationValue: item.location?.value,
          allKeys: Object.keys(item),
          locationKeys: item.location ? Object.keys(item.location) : 'no location',
          locationValueKeys: item.location?.value ? Object.keys(item.location.value) : 'no location.value',
        });
      }
    }
    
    if (itemOwnerId === localPlayerIdentity) {
      playerItems++;
      
      // Check if item is in inventory location
      if (item.location && item.location.tag === 'Inventory') {
        inventoryItems_found++;
        
        const slotIndex = item.location.value?.slotIndex;
        console.log(`[GameContext] Found inventory item in slot ${slotIndex}:`, {
          itemDefId: item.itemDefId,
          quantity: item.quantity,
          slotIndex,
        });
        
        if (slotIndex !== undefined && slotIndex >= 0 && slotIndex < TOTAL_INVENTORY_SLOTS) {
          const itemDef = itemDefinitions.get(item.itemDefId.toString());
          const itemName = itemDef?.name || 'Unknown Item';
          
          console.log(`[GameContext] Placing item in slot ${slotIndex}:`, {
            itemName,
            quantity: item.quantity,
            itemDef: itemDef ? 'found' : 'missing',
          });
          
          slots[slotIndex] = {
            slotIndex,
            itemName,
            quantity: item.quantity || 0,
            isEmpty: false,
          };
        }
      } else {
        // Debug: Log non-inventory locations for player items
        if (itemsProcessed <= 5) {
          console.log(`[GameContext] Player item not in inventory:`, {
            location: item.location,
            itemDefId: item.itemDefId,
          });
        }
      }
    } else if (itemsProcessed <= 3) {
      // Debug: Log why item doesn't match player
      console.log(`[GameContext] Item ${itemsProcessed} doesn't match player:`, {
        itemOwnerId,
        localPlayerIdentity,
        matches: itemOwnerId === localPlayerIdentity,
      });
    }
  });
  
  const occupiedSlots = slots.filter(slot => !slot.isEmpty).length;
  console.log('[GameContext] Inventory extraction summary:', {
    totalItemsProcessed: itemsProcessed,
    playerItems,
    inventoryItemsFound: inventoryItems_found,
    occupiedSlots,
    totalSlots: TOTAL_INVENTORY_SLOTS,
  });
  
  return slots;
};

/**
 * Get detailed hotbar slot information (6 slots total)
 */
const getHotbarSlots = (
  inventoryItems?: Map<string, any>, 
  itemDefinitions?: Map<string, any>, 
  activeEquipments?: Map<string, any>,
  localPlayerIdentity?: string
): HotbarSlotInfo[] => {
  const TOTAL_HOTBAR_SLOTS = 6;
  const slots: HotbarSlotInfo[] = [];
  
  console.log('[GameContext] getHotbarSlots called with:', {
    inventoryItemsSize: inventoryItems?.size || 0,
    itemDefinitionsSize: itemDefinitions?.size || 0,
    activeEquipmentsSize: activeEquipments?.size || 0,
    localPlayerIdentity,
  });
  
  // Initialize all slots as empty
  for (let i = 0; i < TOTAL_HOTBAR_SLOTS; i++) {
    slots.push({
      slotIndex: i,
      itemName: null,
      quantity: 0,
      isEmpty: true,
      isActiveItem: false,
    });
  }
  
  if (!inventoryItems || !itemDefinitions || !localPlayerIdentity) {
    console.log('[GameContext] Missing required data for hotbar extraction:', {
      hasInventoryItems: !!inventoryItems,
      hasItemDefinitions: !!itemDefinitions,
      hasLocalPlayerIdentity: !!localPlayerIdentity,
    });
    return slots;
  }
  
  // Get active item instance ID
  const playerEquipment = activeEquipments?.get(localPlayerIdentity);
  const activeItemInstanceId = playerEquipment?.equippedItemInstanceId;
  
  console.log('[GameContext] Active equipment info:', {
    playerEquipment,
    activeItemInstanceId,
  });
  
  let hotbarItemsFound = 0;
  
  // Fill slots with actual items
  inventoryItems.forEach((item, key) => {
    // Check if item belongs to the player and is in hotbar location
    let itemOwnerId: string | undefined;
    
    // First, try to get owner ID from the location data (based on server structure)
    if (item.location?.value?.owner_id?.toHexString) {
      itemOwnerId = item.location.value.owner_id.toHexString();
    } else if (typeof item.location?.value?.owner_id === 'string') {
      itemOwnerId = item.location.value.owner_id;
    } else if (item.location?.value?.ownerId?.toHexString) {
      // Try camelCase variant
      itemOwnerId = item.location.value.ownerId.toHexString();
    } else if (typeof item.location?.value?.ownerId === 'string') {
      itemOwnerId = item.location.value.ownerId;
    } else if (item.ownerId?.toHexString) {
      // Fallback to direct ownerId property
      itemOwnerId = item.ownerId.toHexString();
    } else if (typeof item.ownerId === 'string') {
      itemOwnerId = item.ownerId;
    } else if (item.owner_id?.toHexString) {
      // Try alternative property name
      itemOwnerId = item.owner_id.toHexString();
    } else if (typeof item.owner_id === 'string') {
      itemOwnerId = item.owner_id;
    }
    
    if (itemOwnerId === localPlayerIdentity && 
        item.location && 
        item.location.tag === 'Hotbar') {
      
      hotbarItemsFound++;
      
      const slotIndex = item.location.value?.slotIndex;
      console.log(`[GameContext] Found hotbar item in slot ${slotIndex}:`, {
        itemDefId: item.itemDefId,
        quantity: item.quantity,
        instanceId: item.instanceId,
        slotIndex,
        isActive: activeItemInstanceId === item.instanceId,
      });
      
      if (slotIndex !== undefined && slotIndex >= 0 && slotIndex < TOTAL_HOTBAR_SLOTS) {
        const itemDef = itemDefinitions.get(item.itemDefId.toString());
        const itemName = itemDef?.name || 'Unknown Item';
        const isActiveItem = activeItemInstanceId === item.instanceId;
        
        console.log(`[GameContext] Placing hotbar item in slot ${slotIndex}:`, {
          itemName,
          quantity: item.quantity,
          isActiveItem,
          itemDef: itemDef ? 'found' : 'missing',
        });
        
        slots[slotIndex] = {
          slotIndex,
          itemName,
          quantity: item.quantity || 0,
          isEmpty: false,
          isActiveItem,
        };
      }
    }
  });
  
  const occupiedSlots = slots.filter(slot => !slot.isEmpty).length;
  console.log('[GameContext] Hotbar extraction summary:', {
    hotbarItemsFound,
    occupiedSlots,
    totalSlots: TOTAL_HOTBAR_SLOTS,
    activeItemInstanceId,
  });
  
  return slots;
};

/**
 * Build comprehensive game context for SOVA AI responses
 */
export const buildGameContext = (props: GameContextBuilderProps): GameContext => {
  const { worldState, localPlayer, itemDefinitions, activeEquipments, inventoryItems, localPlayerIdentity } = props;

  console.log('[GameContext] buildGameContext called with props:', {
    hasWorldState: !!worldState,
    hasLocalPlayer: !!localPlayer,
    hasItemDefinitions: !!itemDefinitions,
    itemDefinitionsSize: itemDefinitions?.size || 0,
    hasActiveEquipments: !!activeEquipments,
    activeEquipmentsSize: activeEquipments?.size || 0,
    hasInventoryItems: !!inventoryItems,
    inventoryItemsSize: inventoryItems?.size || 0,
    localPlayerIdentity,
  });

  // Get current inventory resources for crafting advice
  const currentResources = getCurrentInventoryResources(inventoryItems, itemDefinitions, localPlayerIdentity);
  
  console.log('[GameContext] Current resources extracted:', currentResources);

  // Get detailed inventory and hotbar information
  const inventorySlots = getInventorySlots(inventoryItems, itemDefinitions, localPlayerIdentity);
  const hotbarSlots = getHotbarSlots(inventoryItems, itemDefinitions, activeEquipments, localPlayerIdentity);
  
  console.log('[GameContext] Slots extracted:', {
    inventorySlotsCount: inventorySlots.length,
    inventoryOccupied: inventorySlots.filter(s => !s.isEmpty).length,
    hotbarSlotsCount: hotbarSlots.length,
    hotbarOccupied: hotbarSlots.filter(s => !s.isEmpty).length,
  });

  const gameContext = {
    timeOfDay: getTimeOfDayString(worldState?.timeOfDay),
    currentWeather: getWeatherString(worldState?.currentWeather),
    rainIntensity: worldState?.rainIntensity || 0,
    cycleProgress: worldState?.cycleProgress || 0,
    isFullMoon: worldState?.isFullMoon || false,
    playerHealth: localPlayer?.health || 0,
    playerWarmth: localPlayer?.warmth || 0,
    playerHunger: localPlayer?.hunger || 0,
    playerThirst: localPlayer?.thirst || 0,
    currentEquipment: getCurrentEquipment(activeEquipments, localPlayerIdentity, itemDefinitions),
    craftableItems: getCraftableItems(itemDefinitions),
    nearbyItems: [], // Could be enhanced to show nearby dropped items
    currentResources, // Add current inventory resources
    inventorySlots,
    hotbarSlots,
    totalInventorySlots: 24,
    totalHotbarSlots: 6,
  };
  
  console.log('[GameContext] Final game context created:', {
    timeOfDay: gameContext.timeOfDay,
    currentWeather: gameContext.currentWeather,
    playerHealth: gameContext.playerHealth,
    currentEquipment: gameContext.currentEquipment,
    currentResourcesCount: gameContext.currentResources.length,
    inventorySlotsCount: gameContext.inventorySlots.length,
    hotbarSlotsCount: gameContext.hotbarSlots.length,
    craftableItemsCount: gameContext.craftableItems.length,
  });
  
  return gameContext;
};

export default buildGameContext; 