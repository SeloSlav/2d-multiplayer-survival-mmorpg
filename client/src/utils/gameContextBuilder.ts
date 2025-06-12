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
    return slots;
  }
  
  // Fill slots with actual items
  inventoryItems.forEach(item => {
    // Check if item belongs to the player and is in inventory location
    if (item.ownerId?.toHexString() === localPlayerIdentity && 
        item.location && 
        item.location.tag === 'Inventory') {
      
      const slotIndex = item.location.value?.slotIndex;
      if (slotIndex !== undefined && slotIndex >= 0 && slotIndex < TOTAL_INVENTORY_SLOTS) {
        const itemDef = itemDefinitions.get(item.itemDefId.toString());
        const itemName = itemDef?.name || 'Unknown Item';
        
        slots[slotIndex] = {
          slotIndex,
          itemName,
          quantity: item.quantity || 0,
          isEmpty: false,
        };
      }
    }
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
    return slots;
  }
  
  // Get active item instance ID
  const playerEquipment = activeEquipments?.get(localPlayerIdentity);
  const activeItemInstanceId = playerEquipment?.equippedItemInstanceId;
  
  // Fill slots with actual items
  inventoryItems.forEach(item => {
    // Check if item belongs to the player and is in hotbar location
    if (item.ownerId?.toHexString() === localPlayerIdentity && 
        item.location && 
        item.location.tag === 'Hotbar') {
      
      const slotIndex = item.location.value?.slotIndex;
      if (slotIndex !== undefined && slotIndex >= 0 && slotIndex < TOTAL_HOTBAR_SLOTS) {
        const itemDef = itemDefinitions.get(item.itemDefId.toString());
        const itemName = itemDef?.name || 'Unknown Item';
        const isActiveItem = activeItemInstanceId === item.instanceId;
        
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
  
  return slots;
};

/**
 * Build comprehensive game context for SOVA AI responses
 */
export const buildGameContext = (props: GameContextBuilderProps): GameContext => {
  const { worldState, localPlayer, itemDefinitions, activeEquipments, inventoryItems, localPlayerIdentity } = props;

  // Get current inventory resources for crafting advice
  const currentResources = getCurrentInventoryResources(inventoryItems, itemDefinitions, localPlayerIdentity);

  return {
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
    inventorySlots: getInventorySlots(inventoryItems, itemDefinitions, localPlayerIdentity),
    hotbarSlots: getHotbarSlots(inventoryItems, itemDefinitions, activeEquipments, localPlayerIdentity),
    totalInventorySlots: 24,
    totalHotbarSlots: 6,
  };
};

export default buildGameContext; 