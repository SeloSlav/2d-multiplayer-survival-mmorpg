use crate::items::ItemDefinition;
use crate::items::{ItemCategory, CostIngredient};
use super::builders::*;

/// All consumable items in the game - food, medicine, and survival items
pub fn get_consumable_definitions() -> Vec<ItemDefinition> {
    vec![
        // === CROPS & VEGETABLES ===
        ItemBuilder::new("Corn", "Raw corn. A bit tough and not very satisfying.", ItemCategory::Consumable)
            .icon("corn.png")
            .stackable(20)
            .consumable(4.0, 12.0, 8.0)
            .cookable(25.0, "Cooked Corn")
            .respawn_time(180)
            .build(),

        ItemBuilder::new("Cooked Corn", "Sweet and satisfying. A good source of energy.", ItemCategory::Consumable)
            .icon("cooked_corn.png")
            .stackable(20)
            .consumable(18.0, 35.0, 20.0)
            .stamina_gain(10.0)
            .cookable(35.0, "Burnt Corn")
            .respawn_time(240)
            .build(),

        ItemBuilder::new("Burnt Corn", "Charred and disappointing. Mostly carbon now, but can be processed into charcoal.", ItemCategory::Consumable)
            .icon("burnt_corn.png")
            .stackable(20)
            .consumable(-5.0, 5.0, -20.0)
            .crafting_output(15, 0) // 15 charcoal output
            .cookable(50.0, "Charcoal")
            .respawn_time(60)
            .build(),

        ItemBuilder::new("Pumpkin", "A large, raw pumpkin. Can be cooked.", ItemCategory::Consumable)
            .icon("pumpkin.png")
            .stackable(5)
            .consumable(8.0, 20.0, 10.0)
            .cookable(40.0, "Cooked Pumpkin")
            .respawn_time(300)
            .build(),

        ItemBuilder::new("Cooked Pumpkin", "Soft, sweet, and nutritious cooked pumpkin chunks.", ItemCategory::Consumable)
            .icon("cooked_pumpkin.png")
            .stackable(10)
            .consumable(30.0, 50.0, 30.0)
            .stamina_gain(15.0)
            .cookable(45.0, "Burnt Pumpkin")
            .respawn_time(360)
            .build(),

        ItemBuilder::new("Burnt Pumpkin", "A blackened, mushy mess. Not recommended for eating, but can be processed into charcoal.", ItemCategory::Consumable)
            .icon("burnt_pumpkin.png")
            .stackable(10)
            .consumable(-8.0, 8.0, -10.0)
            .crafting_output(18, 0)
            .cookable(60.0, "Charcoal")
            .respawn_time(30)
            .build(),

        ItemBuilder::new("Potato", "A raw potato. Starchy and filling when cooked.", ItemCategory::Consumable)
            .icon("potato.png")
            .stackable(20)
            .consumable(6.0, 15.0, 2.0)
            .cookable(30.0, "Cooked Potato")
            .respawn_time(200)
            .build(),

        ItemBuilder::new("Cooked Potato", "Fluffy and satisfying. A hearty source of energy.", ItemCategory::Consumable)
            .icon("cooked_potato.png")
            .stackable(20)
            .consumable(20.0, 60.0, 12.0)
            .stamina_gain(20.0)
            .cookable(40.0, "Burnt Potato")
            .respawn_time(260)
            .build(),

        ItemBuilder::new("Burnt Potato", "Charred and bitter. Barely edible, but can be processed into charcoal.", ItemCategory::Consumable)
            .icon("burnt_potato.png")
            .stackable(20)
            .consumable(-4.0, 10.0, -12.0)
            .crafting_output(13, 0)
            .cookable(40.0, "Charcoal")
            .respawn_time(80)
            .build(),

        // === HUMAN FLESH ===
        ItemBuilder::new("Raw Human Flesh", "A chunk of human flesh. Edible but not very appetizing raw. Better when cooked.", ItemCategory::Consumable)
            .icon("human_meat.png")
            .stackable(10)
            .consumable(3.0, 15.0, -10.0)
            .cookable(45.0, "Cooked Human Flesh")
            .respawn_time(180)
            .build(),

        ItemBuilder::new("Cooked Human Flesh", "Cooked human flesh. Still morally questionable, but at least it won't make you sick.", ItemCategory::Consumable)
            .icon("cooked_human_meat.png")
            .stackable(10)
            .consumable(10.0, 40.0, -5.0)
            .stamina_gain(5.0)
            .cookable(30.0, "Burnt Human Flesh")
            .respawn_time(240)
            .build(),

        ItemBuilder::new("Burnt Human Flesh", "Overcooked human flesh. Charred and inedible, but can be processed into charcoal.", ItemCategory::Consumable)
            .icon("burnt_human_meat.png")
            .stackable(10)
            .consumable(-5.0, 5.0, -15.0)
            .crafting_output(14, 0)
            .cookable(55.0, "Charcoal")
            .respawn_time(30)
            .build(),

        // === FISH ===
        ItemBuilder::new("Raw Twigfish", "A small, bony fish that can be cooked for food. Not very filling on its own.", ItemCategory::Consumable)
            .icon("raw_twigfish.png")
            .stackable(10)
            .consumable(5.0, 5.0, 0.0)
            .stamina_gain(0.0)
            .cookable(45.0, "Cooked Twigfish")
            .respawn_time(180)
            .build(),

        ItemBuilder::new("Cooked Twigfish", "A cooked twigfish. Provides better nutrition than the raw version.", ItemCategory::Consumable)
            .icon("cooked_twigfish.png")
            .stackable(10)
            .consumable(15.0, 20.0, 5.0)
            .stamina_gain(10.0)
            .cookable(30.0, "Burnt Twigfish")
            .build(),

        ItemBuilder::new("Burnt Twigfish", "A badly overcooked twigfish. Not very appetizing, but can be processed into charcoal.", ItemCategory::Consumable)
            .icon("burnt_twigfish.png")
            .stackable(10)
            .consumable(2.0, 5.0, 0.0)
            .stamina_gain(0.0)
            .crafting_output(8, 0)
            .cookable(35.0, "Charcoal")
            .build(),

        // === ANIMAL MEAT ===
        ItemBuilder::new("Raw Fox Meat", "Lean meat from a fox. Light and gamey, provides some nutrition even when raw.", ItemCategory::Consumable)
            .icon("fox_meat.png")
            .stackable(15)
            .consumable(8.0, 12.0, -3.0)
            .cookable(35.0, "Cooked Fox Meat")
            .build(),

        ItemBuilder::new("Cooked Fox Meat", "Properly cooked fox meat. Lean and flavorful with good nutritional value.", ItemCategory::Consumable)
            .icon("cooked_fox_meat.png")
            .stackable(15)
            .consumable(22.0, 32.0, 8.0)
            .stamina_gain(15.0)
            .cookable(25.0, "Burnt Fox Meat")
            .build(),

        ItemBuilder::new("Burnt Fox Meat", "Overcooked fox meat. Tough and charred, but can be processed into charcoal.", ItemCategory::Consumable)
            .icon("burnt_fox_meat.png")
            .stackable(15)
            .consumable(-4.0, 8.0, -12.0)
            .crafting_output(10, 0)
            .cookable(35.0, "Charcoal")
            .build(),

        ItemBuilder::new("Raw Wolf Meat", "Dense, dark meat from a wolf. Tough and gamy, but provides substantial nutrition even when raw.", ItemCategory::Consumable)
            .icon("wolf_meat.png")
            .stackable(12)
            .consumable(10.0, 18.0, -5.0)
            .cookable(45.0, "Cooked Wolf Meat")
            .build(),

        ItemBuilder::new("Cooked Wolf Meat", "Well-cooked wolf meat. Dense and protein-rich, providing substantial nutrition.", ItemCategory::Consumable)
            .icon("cooked_wolf_meat.png")
            .stackable(12)
            .consumable(28.0, 45.0, 5.0)
            .stamina_gain(22.0)
            .cookable(30.0, "Burnt Wolf Meat")
            .build(),

        ItemBuilder::new("Burnt Wolf Meat", "Charred wolf meat. Ruined by overcooking, but can be processed into charcoal.", ItemCategory::Consumable)
            .icon("burnt_wolf_meat.png")
            .stackable(12)
            .consumable(-6.0, 12.0, -18.0)
            .crafting_output(16, 0)
            .cookable(45.0, "Charcoal")
            .build(),

        ItemBuilder::new("Raw Viper Meat", "Stringy snake meat. Lean and nutritious, though it's much better when cooked.", ItemCategory::Consumable)
            .icon("viper_meat.png")
            .stackable(20)
            .consumable(6.0, 8.0, -8.0)
            .cookable(25.0, "Cooked Viper Meat")
            .build(),

        ItemBuilder::new("Cooked Viper Meat", "Tender snake meat, properly cooked to neutralize toxins. Surprisingly delicious and nutritious.", ItemCategory::Consumable)
            .icon("cooked_viper_meat.png")
            .stackable(20)
            .consumable(25.0, 20.0, 12.0)
            .stamina_gain(18.0)
            .cookable(20.0, "Burnt Viper Meat")
            .build(),

        ItemBuilder::new("Burnt Viper Meat", "Overcooked snake meat. Tough and unappetizing, but can be processed into charcoal.", ItemCategory::Consumable)
            .icon("burnt_viper_meat.png")
            .stackable(20)
            .consumable(-3.0, 5.0, -10.0)
            .crafting_output(8, 0)
            .cookable(30.0, "Charcoal")
            .build(),

        // === SPECIALTY FOODS & MISC ===
        ItemBuilder::new("Tallow", "Rendered animal fat. High in calories and can be used as a slow-burning fuel source for lanterns. Can be eaten in a pinch to stave off hunger, but it's not very appetizing and will make you thirsty.", ItemCategory::Consumable)
            .icon("tallow.png")
            .stackable(1000)
            .consumable(0.0, 20.0, -7.0)
            .stamina_gain(10.0)
            .respawn_time(300)
            .build(),

        ItemBuilder::new("Tin of Sprats in Oil", "Small oily fish preserved in a tin. Provides good nutrition and a slight health boost from the omega oils.", ItemCategory::Consumable)
            .icon("tin_of_sprats.png")
            .stackable(10)
            .consumable(15.0, 35.0, -5.0)
            .stamina_gain(8.0)
            .respawn_time(900)
            .build(),

        ItemBuilder::new("Fermented Cabbage Jar", "Sour, salty fermented cabbage. High in salt content - will make you very thirsty but provides some nutrition.", ItemCategory::Consumable)
            .icon("fermented_cabbage_jar.png")
            .stackable(5)
            .consumable(8.0, 20.0, -25.0)
            .stamina_gain(5.0)
            .respawn_time(720)
            .build(),

        ItemBuilder::new("Old Hardtack Biscuits", "Rock-hard military biscuits that could break a tooth. Barely edible but they last forever and provide sustenance.", ItemCategory::Consumable)
            .icon("old_hardtack_biscuits.png")
            .stackable(15)
            .consumable(-8.0, 45.0, -15.0)
            .stamina_gain(12.0)
            .respawn_time(600)
            .build(),

        ItemBuilder::new("Expired Soviet Chocolate", "Old chocolate bar with Cyrillic text. Provides a morale boost but shows signs of age - consume at your own risk.", ItemCategory::Consumable)
            .icon("expired_soviet_chocolate.png")
            .stackable(8)
            .consumable(-3.0, 15.0, 5.0)
            .stamina_gain(25.0)
            .respawn_time(1200)
            .build(),

        ItemBuilder::new("Mystery Can (Label Missing)", "A dented can with no readable label. Could be delicious stew, could be pet food. Only one way to find out...", ItemCategory::Consumable)
            .icon("mystery_can.png")
            .stackable(5)
            .consumable(0.0, 30.0, 0.0)
            .stamina_gain(0.0)
            .respawn_time(800)
            .build(),

        // === MEDICINE ===
        ItemBuilder::new("Anti-Venom", "A specialized medical serum that neutralizes Cable Viper venom. Instantly cures all venom effects. Essential for surviving in viper territory.", ItemCategory::Consumable)
            .icon("anti_venom.png")
            .stackable(5)
            .crafting_cost(vec![CostIngredient { item_name: "Cable Viper Gland".to_string(), quantity: 1 }])
            .crafting_output(1, 60)
            .build(),
    ]
}
