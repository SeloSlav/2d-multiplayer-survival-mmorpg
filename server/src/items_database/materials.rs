use super::builders::{ItemBuilder, basic_material};
use crate::items::{ItemDefinition, ItemCategory, CostIngredient};

pub fn get_material_definitions() -> Vec<ItemDefinition> {
    vec![
        // === BASIC CRAFTING MATERIALS === 

        // Wood - Primary fuel and building material
        basic_material("Wood", "A sturdy piece of wood. Good for fuel.", 1000)
            .icon("wood.png")
            .fuel(5.0)
            .respawn_time(300)
            .build(),

        // Stone - Basic building material
        basic_material("Stone", "A chunk of stone ore.", 1000)
            .icon("stone.png")
            .respawn_time(300)
            .build(),

        // Plant Fiber - Basic textile material and fuel
        basic_material("Plant Fiber", "Fibrous material from plants, used for making cloth or as a quick, inefficient fuel.", 1000)
            .icon("plant_fiber.png")
            .fuel(2.5)
            .respawn_time(300)
            .build(),

        // Cloth - Crafted textile
        ItemBuilder::new("Cloth", "Woven fabric, used for basic clothing.", ItemCategory::Material)
            .icon("cloth.png")
            .stackable(1000)
            .crafting_cost(vec![
                CostIngredient { item_name: "Plant Fiber".to_string(), quantity: 5 },
            ])
            .crafting_output(1, 1)
            .respawn_time(300)
            .build(),

        // Charcoal - Essential for ammunition and advanced crafting
        basic_material("Charcoal", "Carbon residue from burnt organic matter. Essential crafting material for ammunition and advanced items.", 1000)
            .icon("charcoal.png")
            .respawn_time(300)
            .build(),

        // === BONE MATERIALS ===

        // Bone Fragments - From processing bones
        basic_material("Bone Fragments", "Sharp fragments of bone. Useful for crafting arrowheads.", 2000)
            .icon("bone_fragments.png")
            .build(),

        // Animal Bone - Whole bones
        basic_material("Animal Bone", "A sturdy animal bone. Useful for crafting basic tools and weapons.", 250)
            .icon("bone.png")
            .build(),

        // Animal Fat - Can be rendered into Tallow
        ItemBuilder::new("Animal Fat", "A slippery piece of animal fat. Can be rendered into tallow.", ItemCategory::Material)
            .icon("animal_fat.png")
            .stackable(100)
            .cook_time(15.0)
            .cooked_item("Tallow")
            .respawn_time(300)
            .build(),

        // === METAL MATERIALS ===

        // Scrap Batteries - Scavenged electronics
        basic_material("Scrap Batteries", "Damaged and partially depleted batteries. Can be used to craft basic electronics or as a power source in a pinch.", 10)
            .icon("scrap_batteries.png")
            .respawn_time(300)
            .build(),

        // Metal Ore - Raw metal resource
        ItemBuilder::new("Metal Ore", "Raw metallic ore extracted from the ground. Can be smelted into metal fragments.", ItemCategory::Material)
            .icon("metal_ore.png")
            .stackable(1000)
            .cook_time(4.0)
            .cooked_item("Metal Fragments")
            .respawn_time(600)
            .build(),

        // Metal Fragments - Processed metal
        basic_material("Metal Fragments", "Processed metal fragments smelted from metal ore. Used for crafting advanced tools and equipment.", 1000)
            .icon("metal_fragments.png")
            .respawn_time(300)
            .stackable(1000)
            .build(),

        // Tin Can - Can be smelted into metal fragments
        ItemBuilder::new("Tin Can", "An empty tin can. Could be useful for crafting or as a container.", ItemCategory::Material)
            .icon("tin_can.png")
            .stackable(5)
            .cook_time(15.0)
            .cooked_item("Metal Fragments")
            .crafting_output(4, 15) // 4 metal fragments per tin can
            .respawn_time(600)
            .build(),

        // === ADVANCED CRAFTING MATERIALS ===

        // Rope - Made from plant fiber
        ItemBuilder::new("Rope", "Strong rope made from twisted plant fibers. Essential for advanced crafting.", ItemCategory::Material)
            .icon("rope.png")
            .stackable(50)
            .crafting_cost(vec![
                CostIngredient { item_name: "Plant Fiber".to_string(), quantity: 20 },
            ])
            .crafting_output(1, 8)
            .respawn_time(360)
            .build(),

        // Common Reed Stalk - Water plant material
        basic_material("Common Reed Stalk", "A hollow reed stalk found near water sources. The natural tube makes it useful for crafting breathing apparatus.", 100)
            .icon("reed_stalk.png")
            .respawn_time(240)
            .build(),

        // Memory Shard - Common technological foundational resource
        basic_material("Memory Shard", "A rugged cognitive archive from the crashed Sovereign Tide flagship. These modular data chips stored tactical memory blocks and were designed to survive extreme conditions.", 5000)
            .icon("memory_shard.png")
            .respawn_time(600) // 10 minutes - common foundational resource
            .build(),

        // === ANIMAL MATERIALS ===

        // Cable Viper Gland - Poison gland
        basic_material("Cable Viper Gland", "A venomous gland extracted from a Cable Viper. Contains potent toxins that could be used for crafting specialized items or weapons.", 50)
            .icon("cable_viper_gland.png")
            .build(),

        // Fox Fur - Warm clothing material
        basic_material("Fox Fur", "Soft, warm fur from a fox. Valuable for crafting warm clothing and insulation.", 20)
            .icon("fox_fur.png")
            .build(),

        // Wolf Fur - Heavy-duty clothing material
        basic_material("Wolf Fur", "Dense, warm fur from a wolf. Excellent for crafting heavy-duty winter clothing and insulation.", 20)
            .icon("wolf_fur.png")
            .build(),

        // Viper Scale - Armor material
        basic_material("Viper Scale", "Tough, flexible scales from a viper. Useful for lightweight armor and water-resistant materials.", 20)
            .icon("viper_scale.png")
            .build(),

        // Animal Leather - Universal leather resource
        basic_material("Animal Leather", "Processed leather from various animal hides. A versatile material for crafting clothing, armor, and equipment.", 50)
            .icon("animal_leather.png")
            .build(),

        // NOTE: Animal skulls (Fox, Wolf, Viper) moved to weapons.rs as they are weapons like Human Skull

    ]
}
