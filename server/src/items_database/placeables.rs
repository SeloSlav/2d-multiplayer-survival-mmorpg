use super::builders::{ItemBuilder};
use crate::items::{ItemDefinition, ItemCategory, CostIngredient};

pub fn get_placeable_definitions() -> Vec<ItemDefinition> {
    vec![
        // === BASIC STRUCTURES ===
        // Essential deployable structures for survival

        // Camp Fire - Basic cooking and warmth
        ItemBuilder::new("Camp Fire", "A place to cook food and stay warm.", ItemCategory::Placeable)
            .icon("campfire.png")
            .stackable(5)
            .crafting_cost(vec![
                CostIngredient { item_name: "Wood".to_string(), quantity: 25 },
                CostIngredient { item_name: "Stone".to_string(), quantity: 10 },
            ])
            .crafting_output(1, 15)
            .respawn_time(300)
            .build(),

        // Stash - Small hidden storage
        ItemBuilder::new("Stash", "A small, concealable stash for hiding items. Fewer slots than a box, but can be hidden.", ItemCategory::Placeable)
            .icon("stash.png")
            .crafting_cost(vec![
                CostIngredient { item_name: "Cloth".to_string(), quantity: 5 },
            ])
            .crafting_output(1, 10)
            .respawn_time(300)
            .build(),

        // Wooden Storage Box - Large storage container
        ItemBuilder::new("Wooden Storage Box", "A simple container for storing items.", ItemCategory::Placeable)
            .icon("wooden_storage_box.png")
            .crafting_cost(vec![
                CostIngredient { item_name: "Wood".to_string(), quantity: 100 },
            ])
            .crafting_output(1, 15)
            .respawn_time(300)
            .build(),

        // === SHELTER & RESPAWN ===

        // Sleeping Bag - Portable respawn point
        ItemBuilder::new("Sleeping Bag", "A rolled-up bag for sleeping outdoors. Sets a respawn point.", ItemCategory::Placeable)
            .icon("sleeping_bag.png")
            .crafting_cost(vec![
                CostIngredient { item_name: "Cloth".to_string(), quantity: 25 },
            ])
            .crafting_output(1, 15)
            .respawn_time(420)
            .build(),

        // Shelter - Advanced protection structure
        ItemBuilder::new("Shelter", "A simple, sturdy shelter that provides a safe place to rest and warm up. Offers significant protection.", ItemCategory::Placeable)
            .icon("shelter.png")
            .crafting_cost(vec![
                CostIngredient { item_name: "Wood".to_string(), quantity: 3200 },
                CostIngredient { item_name: "Rope".to_string(), quantity: 10 },
            ])
            .crafting_output(1, 60)
            .respawn_time(600)
            .build(),

        // === LIGHTING ===

        // Lantern - Deployable light source
        ItemBuilder::new("Lantern", "A deployable lamp that burns tallow to provide light. Lasts longer than campfires.", ItemCategory::Placeable)
            .icon("lantern_off.png")
            .crafting_cost(vec![
                CostIngredient { item_name: "Wood".to_string(), quantity: 75 },
                CostIngredient { item_name: "Metal Fragments".to_string(), quantity: 15 }, // Added metal for frame and mechanism
                CostIngredient { item_name: "Tallow".to_string(), quantity: 10 },
                CostIngredient { item_name: "Cloth".to_string(), quantity: 5 },
            ])
            .crafting_output(1, 20)
            .respawn_time(420)
            .build(),

        // === UTILITY STRUCTURES ===

        // Reed Rain Collector - Water collection system
        ItemBuilder::new("Reed Rain Collector", "A small water collection device crafted from hollow reed stalks. Collects rainwater automatically during storms. Capacity: 40L.", ItemCategory::Placeable)
            .icon("reed_rain_collector.png")
            .crafting_cost(vec![
                CostIngredient { item_name: "Common Reed Stalk".to_string(), quantity: 15 },
                CostIngredient { item_name: "Rope".to_string(), quantity: 5 },
                CostIngredient { item_name: "Cloth".to_string(), quantity: 10 }, // For collection surface
                CostIngredient { item_name: "Wood".to_string(), quantity: 200 }, // For frame structure
                CostIngredient { item_name: "Stone".to_string(), quantity: 50 }, // For anchoring and stability
            ])
            .crafting_output(1, 60)
            .respawn_time(900) // 15 minutes - valuable water infrastructure
            .build(),

        // === TROPHY DECORATIONS ===
        // Display items for showing hunting achievements

        // Wolf Pelt - Rare hunting trophy
        ItemBuilder::new("Wolf Pelt", "A magnificent wolf pelt with thick, luxurious fur. This impressive trophy can be displayed as a rare decoration, showcasing your prowess against dangerous predators.", ItemCategory::Placeable)
            .icon("wolf_pelt.png")
            .build(), // No crafting cost - dropped by wolves

        // Fox Pelt - Hunting trophy
        ItemBuilder::new("Fox Pelt", "A beautiful fox pelt with rich, vibrant fur. This rare trophy makes an excellent display piece, demonstrating your skill at hunting elusive prey.", ItemCategory::Placeable)
            .icon("fox_pelt.png")
            .build(), // No crafting cost - dropped by foxes
    ]
}
