use spacetimedb::{SpacetimeType, Identity, Timestamp};
use serde::{Serialize, Deserialize};

/// Enum to differentiate between various types of world containers.
#[derive(SpacetimeType, Serialize, Deserialize, Copy, Clone, Debug, PartialEq)]
pub enum ContainerType {
    Campfire,
    WoodenStorageBox,
    PlayerCorpse,
    Stash,
    // Other container types can be added here
}

/// Enum to differentiate between various types of equipment slots.
#[derive(SpacetimeType, Serialize, Deserialize, Copy, Clone, Debug, PartialEq)]
pub enum EquipmentSlotType {
    Head,
    Chest,
    Legs,
    Feet,
    Hands,
    Back,
    // Removed MainHand as it's handled by ActiveEquipment.equipped_item_instance_id
}

// --- Data structs for ItemLocation variants ---

#[derive(SpacetimeType, Clone, Debug, PartialEq)] // No Serialize/Deserialize due to Identity
pub struct InventoryLocationData {
    pub owner_id: Identity,
    pub slot_index: u16,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)] // No Serialize/Deserialize due to Identity
pub struct HotbarLocationData {
    pub owner_id: Identity,
    pub slot_index: u8,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)] // No Serialize/Deserialize due to Identity
pub struct EquippedLocationData {
    pub owner_id: Identity,
    pub slot_type: EquipmentSlotType, // EquipmentSlotType is SType, S, D
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)] // ContainerType is SType, S, D
pub struct ContainerLocationData {
    pub container_type: ContainerType,
    pub container_id: u64, // Keep as u64, matches WoodenStorageBox and Campfire container_id methods
    pub slot_index: u8,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)] // Basic types, SType ok
pub struct DroppedLocationData {
    pub pos_x: f32,
    pub pos_y: f32,
}

/// Represents the specific location of an InventoryItem.
#[derive(SpacetimeType, Clone, Debug, PartialEq)] // No Serialize/Deserialize here
pub enum ItemLocation {
    Inventory(InventoryLocationData),
    Hotbar(HotbarLocationData),
    Equipped(EquippedLocationData),
    Container(ContainerLocationData),
    Dropped(DroppedLocationData),
    Unknown, // Represents an undefined or invalid location
}

// Helper methods for ItemLocation (optional, but can be useful)
impl ItemLocation {
    pub fn is_player_bound(&self) -> Option<Identity> {
        match self {
            ItemLocation::Inventory(data) => Some(data.owner_id),
            ItemLocation::Hotbar(data) => Some(data.owner_id),
            ItemLocation::Equipped(data) => Some(data.owner_id),
            _ => None,
        }
    }

    pub fn is_container_bound(&self) -> Option<(ContainerType, u64)> {
        match self {
            ItemLocation::Container(data) => Some((data.container_type.clone(), data.container_id)),
            _ => None,
        }
    }
}

// Add the TargetType enum here
#[derive(Debug, Clone, Copy, PartialEq, SpacetimeType, serde::Serialize, serde::Deserialize)]
pub enum TargetType {
    Tree,
    Stone,
    Player,
    Campfire,
    WoodenStorageBox,
    Stash,
    SleepingBag,
}