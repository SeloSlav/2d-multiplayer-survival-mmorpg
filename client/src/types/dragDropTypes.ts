import { PopulatedItem } from '../components/InventoryUI'; // Assuming PopulatedItem stays in InventoryUI for now

// Define the possible sources/targets for drag and drop
export type SlotType = 
    | 'inventory' 
    | 'hotbar' 
    | 'equipment' 
    | 'campfire_fuel'
    | 'wooden_storage_box'
    | 'player_corpse'
    // Add more types as needed (e.g., 'furnace_input', 'furnace_fuel', 'crafting_output')

// Type definition for the source/target of a drag/drop operation
export interface DragSourceSlotInfo {
    type: SlotType;
    index: number | string; // number for inventory/hotbar/fuel, string for equipment
    parentId?: number | bigint; // e.g., Campfire ID for fuel slots
}

// Type definition for the item being dragged
export interface DraggedItemInfo {
    item: PopulatedItem;
    sourceSlot: DragSourceSlotInfo;
    sourceContainerType?: string; // e.g., 'player_inventory', 'wooden_storage_box', 'campfire'
    sourceContainerEntityId?: number | string | bigint; // ID of the container entity if applicable
    splitQuantity?: number;
    // Add split info later if needed
} 