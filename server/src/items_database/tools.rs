use crate::items::{ItemDefinition, ItemCategory, CostIngredient};
use crate::models::{EquipmentSlotType, TargetType};
use crate::items_database::builders::{ItemBuilder, basic_tool};

pub fn get_tool_definitions() -> Vec<ItemDefinition> {
    vec![
        // GATHERING TOOLS - Migrated from original items_database.rs

        // Bush Knife - Versatile tool for wood cutting
        ItemBuilder::new("Bush Knife", "A heavy-duty clearing blade used for cutting brush and light timber around military installations. Versatile in combat and useful for woodcutting, though less efficient than a proper hatchet.", ItemCategory::Tool)
            .icon("machete.png")
            .equippable(None)

            .primary_target_damage(30, 40)
            .primary_target_yield(9, 14)
            .primary_target_type(TargetType::Tree)
            .primary_yield_resource("Wood")
            .pvp_damage(35, 35)
            .bleed_effect(3.5, 10.0, 1.0)
            .crafting_cost(vec![
                CostIngredient { item_name: "Wood".to_string(), quantity: 200 },
                CostIngredient { item_name: "Metal Fragments".to_string(), quantity: 30 },
                CostIngredient { item_name: "Cloth".to_string(), quantity: 10 },
            ])
            .crafting_output(1, 45)
            .respawn_time(900)
            .attack_interval(0.6)
            .build(),

        // Corpse Processing Tools 
        ItemBuilder::new("Bone Club", "A heavy club made from a large bone and bindings. Good for crushing corpses and extracting resources.", ItemCategory::Tool)
            .icon("bone_club.png")
            .equippable(None)
            
            .primary_target_damage(20, 20)
            .primary_target_yield(3, 3)
            .primary_target_type(TargetType::PlayerCorpse)
            .primary_yield_resource("Corpse Parts")
            .pvp_damage(25, 25)
            .crafting_cost(vec![
                CostIngredient { item_name: "Bone Fragments".to_string(), quantity: 125 },
                CostIngredient { item_name: "Plant Fiber".to_string(), quantity: 10 },
            ])
            .crafting_output(1, 20)
            .attack_interval(0.8)
            .build(),

        ItemBuilder::new("Bone Knife", "A sharp knife crafted from bone. Quick but not very durable. Excellent for harvesting corpses.", ItemCategory::Tool)
            .icon("bone_knife.png")
            .equippable(None)
            
            .primary_target_damage(25, 25)
            .primary_target_yield(5, 5)
            .primary_target_type(TargetType::PlayerCorpse)
            .primary_yield_resource("Corpse Parts")
            .pvp_damage(15, 20)
            .bleed_effect(1.0, 5.0, 1.0)
            .crafting_cost(vec![
                CostIngredient { item_name: "Bone Fragments".to_string(), quantity: 50 },
                CostIngredient { item_name: "Plant Fiber".to_string(), quantity: 5 },
            ])
            .crafting_output(1, 10)
            .attack_interval(0.5)
            .build(),

        // Repair Tool
        ItemBuilder::new("Repair Hammer", "A simple hammer for repairing structures and maintaining equipment.", ItemCategory::Tool)
            .icon("repair_hammer.png")
            .equippable(None)
            
            .pvp_damage(5, 5)
            .crafting_cost(vec![
                CostIngredient { item_name: "Wood".to_string(), quantity: 150 },
            ])
            .crafting_output(1, 20)
            .respawn_time(420)
            .attack_interval(1.0)
            .build(),

        // Primary Gathering Tools
        basic_tool("Stone Hatchet", "A simple hatchet for chopping wood.", 
                  TargetType::Tree, 60, 80, 25, 35, "Wood")
            .icon("wood_hatchet.png")
            .pvp_damage(15, 20)
            .crafting_cost(vec![
                CostIngredient { item_name: "Wood".to_string(), quantity: 200 },
                CostIngredient { item_name: "Stone".to_string(), quantity: 100 },
            ])
            .crafting_output(1, 30)
            .respawn_time(600)
            .attack_interval(0.8)
            .build(),

        ItemBuilder::new("Combat Ladle", "A surprisingly sturdy ladle, ready for a culinary confrontation. Also works as a basic gathering tool.", ItemCategory::Tool)
            .icon("combat_ladle.png")
            .equippable(None)
            
            .primary_target_damage(3, 7)
            .pvp_damage(10, 10)
            .crafting_cost(vec![
                CostIngredient { item_name: "Wood".to_string(), quantity: 50 },
            ])
            .crafting_output(1, 10)
            .respawn_time(300)
            .attack_interval(0.7)
            .build(),

        basic_tool("Stone Pickaxe", "A simple pickaxe for breaking rocks.",
                  TargetType::Stone, 60, 120, 13, 22, "Stone")
            .icon("pick_axe.png")
            .equippable(None)
            .pvp_damage(18, 25)
            .crafting_cost(vec![
                CostIngredient { item_name: "Wood".to_string(), quantity: 200 },
                CostIngredient { item_name: "Stone".to_string(), quantity: 100 },
            ])
            .crafting_output(1, 30)
            .respawn_time(600)
            .attack_interval(1.2)
            .build(),

        ItemBuilder::new("Rock", "A basic tool for gathering.", ItemCategory::Tool)
            .icon("rock_item.png")
            .equippable(None)
            
            .primary_target_damage(3, 7)
            .pvp_damage(5, 5)
            .crafting_cost(vec![
                CostIngredient { item_name: "Stone".to_string(), quantity: 5 },
            ])
            .crafting_output(1, 1)
            .respawn_time(30)
            .attack_interval(1.2)
            .build(),

        // Light Sources
        ItemBuilder::new("Torch", "Provides light and some warmth when lit. Can be used as a makeshift weapon.", ItemCategory::Tool)
            .icon("torch.png")
            .equippable(None)
            
            .pvp_damage(5, 5)
            .crafting_cost(vec![
                CostIngredient { item_name: "Wood".to_string(), quantity: 20 },
                CostIngredient { item_name: "Plant Fiber".to_string(), quantity: 10 },
            ])
            .crafting_output(1, 5)
            .respawn_time(30)
            .attack_interval(0.5)
            .build(),

        ItemBuilder::new("Flashlight", "A handheld electric light source. Provides bright, focused illumination but requires batteries to operate.", ItemCategory::Tool)
            .icon("flashlight.png")
            .equippable(None)
            
            .crafting_cost(vec![
                CostIngredient { item_name: "Metal Fragments".to_string(), quantity: 50 },
                CostIngredient { item_name: "Cloth".to_string(), quantity: 10 },
                CostIngredient { item_name: "Scrap Batteries".to_string(), quantity: 1 },
            ])
            .crafting_output(1, 30)
            .respawn_time(600)
            .build(),

        // Medical Tools
        ItemBuilder::new("Bandage", "A simple bandage to patch up wounds. Stops bleeding and restores health.", ItemCategory::Tool)
            .icon("bandage.png")
            .stackable(10)
            .equippable(None)
            
            .consumable(25.0, 0.0, 0.0)
            .consumable_duration(5.0)
            .crafting_cost(vec![
                CostIngredient { item_name: "Cloth".to_string(), quantity: 2 },
            ])
            .crafting_output(1, 3)
            .respawn_time(300)
            .build(),

        ItemBuilder::new("Selo Olive Oil", "Premium olive oil with miraculous healing properties. Restores health, stamina, warmth, hunger, and thirst.", ItemCategory::Tool)
            .icon("selo_olive_oil.png")
            .stackable(5)
            .equippable(None)
            
            .consumable(100.0, 100.0, 100.0)
            .consumable_duration(2.0)
            .warmth_bonus(100.0)
            .respawn_time(1800)
            .build(),

        // Utility Tools
        // ItemBuilder::new("Blueprint", "A blueprint that allows you to build structures.", ItemCategory::Tool)
        //     .icon("blueprint.png")
        //     .equippable(None)
            
        //     .crafting_cost(vec![
        //         CostIngredient { item_name: "Wood".to_string(), quantity: 50 },
        //     ])
        //     .crafting_output(1, 10)
        //     .respawn_time(300)
        //     .build(),

        // Reed-based Tools
        ItemBuilder::new("Primitive Reed Snorkel", "A basic underwater breathing device made from a hollow reed sealed with tallow. Allows limited underwater exploration and resource gathering.", ItemCategory::Tool)
            .icon("reed_snorkel.png")
            .equippable(None)
            
            .crafting_cost(vec![
                CostIngredient { item_name: "Common Reed Stalk".to_string(), quantity: 3 },
                CostIngredient { item_name: "Rope".to_string(), quantity: 1 },
                CostIngredient { item_name: "Tallow".to_string(), quantity: 2 },
            ])
            .crafting_output(1, 25)
            .respawn_time(480)
            .build(),

        ItemBuilder::new("Primitive Reed Fishing Rod", "A basic fishing rod crafted from a sturdy reed stalk and simple line. Allows for catching small fish and other aquatic resources.", ItemCategory::Tool)
            .icon("reed_fishing_rod.png")
            .equippable(None)
            
            .primary_target_damage(5, 8)
            .pvp_damage(8, 12)
            .crafting_cost(vec![
                CostIngredient { item_name: "Common Reed Stalk".to_string(), quantity: 3 },
                CostIngredient { item_name: "Plant Fiber".to_string(), quantity: 15 },
                CostIngredient { item_name: "Bone Gaff Hook".to_string(), quantity: 1 },
            ])
            .crafting_output(1, 25)
            .respawn_time(360)
            .attack_interval(1.2)
            .build(),

        ItemBuilder::new("Bone Gaff Hook", "A sharp, curved bone hook that can be used as a fishing gaff or improvised weapon. A component for crafting fishing rods.", ItemCategory::Tool)
            .icon("fishing_gaff_hook.png")
            .equippable(None)

            .primary_target_damage(10, 15)
            .pvp_damage(18, 22)
            .bleed_effect(2.0, 6.0, 1.0)
            .crafting_cost(vec![
                CostIngredient { item_name: "Bone Fragments".to_string(), quantity: 35 },
                CostIngredient { item_name: "Plant Fiber".to_string(), quantity: 8 },
            ])
            .crafting_output(1, 15)
            .respawn_time(300)
            .attack_interval(0.6)
            .build(),

        ItemBuilder::new("Reed Bellows", "A primitive bellows crafted from reed stalks and animal hide. When placed in a campfire, it provides better airflow, making fuel burn slower while cooking food faster.", ItemCategory::Tool)
            .icon("reed_bellows.png")
            .crafting_cost(vec![
                CostIngredient { item_name: "Common Reed Stalk".to_string(), quantity: 8 },
                CostIngredient { item_name: "Animal Fat".to_string(), quantity: 3 },
                CostIngredient { item_name: "Rope".to_string(), quantity: 2 },
                CostIngredient { item_name: "Cloth".to_string(), quantity: 5 },
            ])
            .crafting_output(1, 45)
            .respawn_time(720)
            .build(),

        // Water Storage Tools
        ItemBuilder::new("Reed Water Bottle", "A portable water container crafted from hollow reed segments sealed with tallow. Can be filled from water sources. Capacity: 2L.", ItemCategory::Tool)
            .icon("reed_water_bottle.png")
            .equippable(None)
            .crafting_cost(vec![
                CostIngredient { item_name: "Common Reed Stalk".to_string(), quantity: 4 },
                CostIngredient { item_name: "Tallow".to_string(), quantity: 3 },
                CostIngredient { item_name: "Rope".to_string(), quantity: 1 },
            ])
            .crafting_output(1, 20)
            .respawn_time(480)
            .build(),

        ItemBuilder::new("Plastic Water Jug", "A large plastic container for storing water. Durable and lightweight with excellent capacity. Can be filled from water sources. Capacity: 5L.", ItemCategory::Tool)
            .icon("water_jug.png")
            .equippable(None)
            .respawn_time(720)
            .build(),
    ]
}
