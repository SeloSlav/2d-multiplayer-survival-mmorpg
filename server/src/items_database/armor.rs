use super::builders::{ItemBuilder};
use crate::items::{ItemDefinition, ItemCategory, CostIngredient};
use crate::models::EquipmentSlotType;

pub fn get_armor_definitions() -> Vec<ItemDefinition> {
    vec![
        // === CLOTH ARMOR SET ===
        // Complete set of basic cloth armor providing warmth and minimal protection

        // Cloth Hood - Head protection
        ItemBuilder::new("Cloth Hood", "Basic head covering.", ItemCategory::Armor)
            .icon("cloth_hood.png")
            .equippable(Some(EquipmentSlotType::Head))
            .armor(0.01, Some(0.2))
            .crafting_cost(vec![
                CostIngredient { item_name: "Cloth".to_string(), quantity: 20 },
            ])
            .crafting_time(10)
            .respawn_time(420)
            .build(),

        // Cloth Shirt - Chest protection
        ItemBuilder::new("Cloth Shirt", "Simple protection for the torso.", ItemCategory::Armor)
            .icon("cloth_shirt.png")
            .equippable(Some(EquipmentSlotType::Chest))
            .armor(0.01, Some(0.2))
            .crafting_cost(vec![
                CostIngredient { item_name: "Cloth".to_string(), quantity: 40 },
            ])
            .crafting_time(15)
            .respawn_time(420)
            .build(),

        // Cloth Pants - Leg protection
        ItemBuilder::new("Cloth Pants", "Simple protection for the legs.", ItemCategory::Armor)
            .icon("cloth_pants.png")
            .equippable(Some(EquipmentSlotType::Legs))
            .armor(0.01, Some(0.2))
            .crafting_cost(vec![
                CostIngredient { item_name: "Cloth".to_string(), quantity: 30 },
            ])
            .crafting_time(15)
            .respawn_time(420)
            .build(),

        // Cloth Gloves - Hand protection
        ItemBuilder::new("Cloth Gloves", "Basic hand coverings.", ItemCategory::Armor)
            .icon("cloth_gloves.png")
            .equippable(Some(EquipmentSlotType::Hands))
            .armor(0.01, Some(0.2))
            .crafting_cost(vec![
                CostIngredient { item_name: "Cloth".to_string(), quantity: 15 },
            ])
            .crafting_time(5)
            .respawn_time(420)
            .build(),

        // Cloth Boots - Foot protection
        ItemBuilder::new("Cloth Boots", "Simple footwear.", ItemCategory::Armor)
            .icon("cloth_boots.png")
            .equippable(Some(EquipmentSlotType::Feet))
            .armor(0.01, Some(0.2))
            .crafting_cost(vec![
                CostIngredient { item_name: "Cloth".to_string(), quantity: 15 },
            ])
            .crafting_time(5)
            .respawn_time(420)
            .build(),

        // Cloth Cape - Back protection with extra warmth
        ItemBuilder::new("Cloth Cape", "A simple cape made of cloth.", ItemCategory::Armor)
            .icon("burlap_cape.png")
            .equippable(Some(EquipmentSlotType::Back))
            .armor(0.01, Some(0.25))
            .crafting_cost(vec![
                CostIngredient { item_name: "Cloth".to_string(), quantity: 30 },
                CostIngredient { item_name: "Plant Fiber".to_string(), quantity: 10 },
            ])
            .crafting_time(20)
            .respawn_time(420)
            .build(),

        // === SPECIAL ARMOR ===

        // Headlamp - Head armor with light source functionality
        ItemBuilder::new("Headlamp", "A head-mounted lamp that provides hands-free lighting. Burns tallow or olive oil for fuel and offers basic head protection.", ItemCategory::Armor)
            .icon("tallow_head_lamp.png")
            .equippable(Some(EquipmentSlotType::Head))
            .armor(0.02, Some(0.3))
            .crafting_cost(vec![
                CostIngredient { item_name: "Cloth".to_string(), quantity: 15 },
                CostIngredient { item_name: "Tallow".to_string(), quantity: 5 },
                CostIngredient { item_name: "Plant Fiber".to_string(), quantity: 20 },
            ])
            .crafting_time(15)
            .respawn_time(480)
            .build(),
    ]
}
