use super::builders::{ItemBuilder, basic_seed};
use crate::items::{ItemDefinition, ItemCategory};

pub fn get_seed_definitions() -> Vec<ItemDefinition> {
    vec![
        // === ALL SEEDS AND PLANTING MATERIALS ===
        // All seeds are Placeable (plantable) and also edible with varying nutritional values
        // Raw seeds provide better nutrition, cooked/toasted seeds are enhanced, burnt seeds are harmful

        // === LARGE NUTRITIOUS SEEDS ===
        
        // Pumpkin Seeds - Large, nutritious seeds
        ItemBuilder::new("Pumpkin Seeds", "Large edible seeds from pumpkins. Can be planted to grow pumpkin plants or eaten for nutrition.", ItemCategory::Placeable)
            .icon("pumpkin_seeds.png")
            .stackable(50)
            .respawn_time(720) // 12 minutes
            .consumable(2.0, 8.0, -2.0) // health, hunger, thirst
            .build(),

        // Toasted Pumpkin Seeds - Enhanced nutrition when toasted
        ItemBuilder::new("Toasted Pumpkin Seeds", "Toasted pumpkin seeds with enhanced flavor and nutrition. Cannot be planted.", ItemCategory::Consumable)
            .icon("toasted_pumpkin_seeds.png")
            .stackable(50)
            .respawn_time(0) // Made by cooking
            .consumable(5.0, 15.0, -1.0) // health, hunger, thirst
            .build(),

        // Burnt Pumpkin Seeds - Overcooked and bitter
        ItemBuilder::new("Burnt Pumpkin Seeds", "Overcooked pumpkin seeds that are bitter and less nutritious. Cannot be planted.", ItemCategory::Consumable)
            .icon("burnt_pumpkin_seeds.png")
            .stackable(50)
            .respawn_time(0)
            .consumable(-2.0, 2.0, 0.0) // health, hunger, thirst
            .build(),

        // Sunflower Seeds - Popular edible seeds
        ItemBuilder::new("Sunflower Seeds", "Nutritious edible seeds from sunflowers. Can be planted to grow sunflower plants or eaten as a healthy snack.", ItemCategory::Placeable)
            .icon("sunflower_seeds.png")
            .stackable(50)
            .respawn_time(600) // 10 minutes
            .consumable(3.0, 6.0, -3.0) // health, hunger, thirst
            .build(),

        // Toasted Sunflower Seeds - Enhanced when toasted
        ItemBuilder::new("Toasted Sunflower Seeds", "Toasted sunflower seeds with rich, nutty flavor. Cannot be planted.", ItemCategory::Consumable)
            .icon("toasted_sunflower_seeds.png")
            .stackable(50)
            .respawn_time(0)
            .consumable(6.0, 12.0, -2.0) // health, hunger, thirst
            .build(),

        // Burnt Sunflower Seeds - Bitter and acrid
        ItemBuilder::new("Burnt Sunflower Seeds", "Burnt sunflower seeds that taste bitter and acrid. Cannot be planted.", ItemCategory::Consumable)
            .icon("burnt_sunflower_seeds.png")
            .stackable(50)
            .respawn_time(0)
            .consumable(-3.0, 1.0, 0.0) // health, hunger, thirst
            .build(),

        // Fennel Seeds - Aromatic culinary seeds
        ItemBuilder::new("Fennel Seeds", "Aromatic seeds with a licorice-like flavor. Can be planted to grow fennel plants or used as seasoning.", ItemCategory::Placeable)
            .icon("fennel_seeds.png")
            .stackable(40)
            .respawn_time(540) // 9 minutes
            .consumable(1.0, 3.0, 2.0) // health, hunger, thirst
            .build(),

        // Toasted Fennel Seeds - Enhanced aromatic properties
        ItemBuilder::new("Toasted Fennel Seeds", "Toasted fennel seeds with intensified aroma and flavor. Cannot be planted.", ItemCategory::Consumable)
            .icon("toasted_fennel_seeds.png")
            .stackable(40)
            .respawn_time(0)
            .consumable(3.0, 6.0, 3.0) // health, hunger, thirst
            .build(),

        // Burnt Fennel Seeds - Bitter and unpalatable
        ItemBuilder::new("Burnt Fennel Seeds", "Burnt fennel seeds that are bitter and unpalatable. Cannot be planted.", ItemCategory::Consumable)
            .icon("burnt_fennel_seeds.png")
            .stackable(40)
            .respawn_time(0)
            .consumable(-1.0, 0.5, 0.0) // health, hunger, thirst
            .build(),

        // Flax Seeds - High in omega fatty acids
        ItemBuilder::new("Flax Seeds", "Tiny seeds rich in healthy oils. Can be planted to grow flax plants or eaten for nutrition.", ItemCategory::Placeable)
            .icon("flax_seeds.png")
            .stackable(60)
            .respawn_time(480) // 8 minutes
            .consumable(2.0, 4.0, -1.0) // health, hunger, thirst
            .build(),

        // Toasted Flax Seeds - Enhanced digestibility
        ItemBuilder::new("Toasted Flax Seeds", "Lightly toasted flax seeds that are easier to digest. Cannot be planted.", ItemCategory::Consumable)
            .icon("toasted_flax_seeds.png")
            .stackable(60)
            .respawn_time(0)
            .consumable(5.0, 8.0, 0.0) // health, hunger, thirst
            .build(),

        // Burnt Flax Seeds - Rancid and bitter
        ItemBuilder::new("Burnt Flax Seeds", "Burnt flax seeds with rancid oils. Cannot be planted.", ItemCategory::Consumable)
            .icon("burnt_flax_seeds.png")
            .stackable(60)
            .respawn_time(0)
            .consumable(-2.0, 1.0, 0.0) // health, hunger, thirst
            .build(),

        // === GRAIN SEEDS ===

        // Wheat Seeds - Basic grain crop
        ItemBuilder::new("Wheat Seeds", "Common grain seeds for growing wheat. Can be planted or eaten in emergencies.", ItemCategory::Placeable)
            .icon("wheat_seeds.png")
            .stackable(50)
            .respawn_time(600) // 10 minutes
            .consumable(0.0, 2.0, -1.0) // health, hunger, thirst
            .build(),

        // Buckwheat Seeds - Nutritious grain alternative
        ItemBuilder::new("Buckwheat Seeds", "Nutritious grain seeds for growing buckwheat. Can be planted or eaten for basic nutrition.", ItemCategory::Placeable)
            .icon("buckwheat_seeds.png")
            .stackable(50)
            .respawn_time(600)
            .consumable(1.0, 3.0, -1.0) // health, hunger, thirst
            .build(),

        // === VEGETABLE SEEDS ===

        // Tomato Seeds - Small emergency food
        ItemBuilder::new("Tomato Seeds", "Tiny seeds from tomatoes. Can be planted to grow tomato plants or eaten in desperation.", ItemCategory::Placeable)
            .icon("tomato_seeds.png")
            .stackable(80)
            .respawn_time(480) // 8 minutes
            .consumable(0.0, 0.5, 0.5) // health, hunger, thirst
            .build(),

        // Carrot Seeds - Minimal nutrition
        ItemBuilder::new("Carrot Seeds", "Tiny carrot seeds. Can be planted to grow carrots or eaten for minimal nutrition.", ItemCategory::Placeable)
            .icon("carrot_seeds.png")
            .stackable(80)
            .respawn_time(420) // 7 minutes
            .consumable(0.0, 0.5, -0.5) // health, hunger, thirst
            .build(),

        // Beet Seeds - Emergency food
        ItemBuilder::new("Beet Seeds", "Small beet seeds. Can be planted to grow beets or eaten in emergencies.", ItemCategory::Placeable)
            .icon("beet_seeds.png")
            .stackable(80)
            .respawn_time(420)
            .consumable(0.0, 0.5, 0.0) // health, hunger, thirst
            .build(),

        // Radish Seeds - Slightly spicy
        ItemBuilder::new("Radish Seeds", "Peppery radish seeds. Can be planted to grow radishes or eaten for a spicy kick.", ItemCategory::Placeable)
            .icon("radish_seeds.png")
            .stackable(80)
            .respawn_time(360) // 6 minutes - quick growing
            .consumable(0.5, 0.5, 1.0) // health, hunger, thirst
            .build(),

        // Cabbage Seeds - Mild nutrition
        ItemBuilder::new("Cabbage Seeds", "Small cabbage seeds. Can be planted to grow cabbage or eaten for minimal nutrition.", ItemCategory::Placeable)
            .icon("cabbage_seeds.png")
            .stackable(80)
            .respawn_time(480)
            .consumable(0.0, 0.5, 0.0) // health, hunger, thirst
            .build(),

        // Turnip Seeds - Root crop seeds
        ItemBuilder::new("Turnip Seeds", "Seeds for growing turnips. Can be planted or eaten for basic nutrition.", ItemCategory::Placeable)
            .icon("turnip_seeds.png")
            .stackable(80)
            .respawn_time(420)
            .consumable(0.0, 1.0, 0.0) // health, hunger, thirst
            .build(),

        // Onion Seeds - Pungent flavor
        ItemBuilder::new("Onion Seeds", "Pungent onion seeds. Can be planted to grow onions or eaten for their strong flavor.", ItemCategory::Placeable)
            .icon("onion_seeds.png")
            .stackable(80)
            .respawn_time(540)
            .consumable(1.0, 0.5, -1.0) // health, hunger, thirst
            .build(),

        // === ADDITIONAL VEGETABLE SEEDS ===

        // Onion Sets - Onion planting bulbs
        ItemBuilder::new("Onion Sets", "Small onion bulbs for planting. Can be eaten but have a strong, pungent flavor.", ItemCategory::Placeable)
            .icon("onion_sets.png")
            .stackable(60)
            .respawn_time(540) // 9 minutes
            .consumable(1.0, 0.5, -1.5) // health, hunger, thirst - strong antibacterial but harsh
            .build(),

        // Burnt Onion Sets - Charred onion bulbs
        ItemBuilder::new("Burnt Onion Sets", "Charred onion sets that are bitter and acrid. Cannot be planted.", ItemCategory::Consumable)
            .icon("burnt_onion_sets.png")
            .stackable(60)
            .respawn_time(0)
            .consumable(-2.0, 0.0, -1.0) // health, hunger, thirst
            .build(),

        // Garlic Cloves - Garlic planting material
        ItemBuilder::new("Garlic Cloves", "Individual garlic cloves for planting. Can be eaten raw but very pungent.", ItemCategory::Placeable)
            .icon("garlic_cloves.png")
            .stackable(40)
            .respawn_time(900) // 15 minutes
            .consumable(2.0, 1.0, -2.0) // health, hunger, thirst - strong medicinal properties
            .build(),

        // Burnt Garlic Cloves - Charred garlic
        ItemBuilder::new("Burnt Garlic Cloves", "Charred garlic cloves that are bitter and unpalatable. Cannot be planted.", ItemCategory::Consumable)
            .icon("burnt_garlic_cloves.png")
            .stackable(40)
            .respawn_time(0)
            .consumable(-1.0, 0.0, -1.0) // health, hunger, thirst
            .build(),

        // Parsnip Seeds - Root vegetable seeds
        ItemBuilder::new("Parsnip Seeds", "Seeds for growing parsnips. Can be eaten in emergencies for minimal nutrition.", ItemCategory::Placeable)
            .icon("parsnip_seeds.png")
            .stackable(80)
            .respawn_time(420) // 7 minutes
            .consumable(0.0, 0.5, 0.0) // health, hunger, thirst
            .build(),

        // Burnt Parsnip Seeds - Charred parsnip seeds
        ItemBuilder::new("Burnt Parsnip Seeds", "Charred parsnip seeds. Cannot be planted.", ItemCategory::Consumable)
            .icon("burnt_parsnip_seeds.png")
            .stackable(80)
            .respawn_time(0)
            .consumable(-1.0, 0.0, -0.5) // health, hunger, thirst
            .build(),

        // Chicory Seeds - Bitter herb seeds
        ItemBuilder::new("Chicory Seeds", "Seeds for growing chicory. Can be eaten but are quite bitter.", ItemCategory::Placeable)
            .icon("chicory_seeds.png")
            .stackable(70)
            .respawn_time(360) // 6 minutes
            .consumable(0.5, 1.0, -0.5) // health, hunger, thirst
            .build(),

        // Burnt Chicory Seeds - Charred chicory seeds
        ItemBuilder::new("Burnt Chicory Seeds", "Charred chicory seeds that are extremely bitter. Cannot be planted.", ItemCategory::Consumable)
            .icon("burnt_chicory_seeds.png")
            .stackable(70)
            .respawn_time(0)
            .consumable(-1.0, 0.0, -1.0) // health, hunger, thirst
            .build(),

        // Salsify Seeds - Root vegetable seeds
        ItemBuilder::new("Salsify Seeds", "Seeds for growing salsify root. Can be eaten for minimal nutrition.", ItemCategory::Placeable)
            .icon("salsify_seeds.png")
            .stackable(70)
            .respawn_time(480) // 8 minutes
            .consumable(0.0, 1.0, 0.0) // health, hunger, thirst
            .build(),

        // Burnt Salsify Seeds - Charred salsify seeds
        ItemBuilder::new("Burnt Salsify Seeds", "Charred salsify seeds. Cannot be planted.", ItemCategory::Consumable)
            .icon("burnt_salsify_seeds.png")
            .stackable(70)
            .respawn_time(0)
            .consumable(-1.0, 0.0, -0.5) // health, hunger, thirst
            .build(),

        // === HERB & MEDICINAL SEEDS ===

        // Yarrow Seeds - Medicinal herb seeds
        ItemBuilder::new("Yarrow Seeds", "Seeds for growing yarrow. Can be eaten but have a bitter, medicinal taste.", ItemCategory::Placeable)
            .icon("yarrow_seeds.png")
            .stackable(60)
            .respawn_time(480) // 8 minutes
            .consumable(1.0, 0.5, -0.5) // health, hunger, thirst - medicinal properties
            .build(),

        // Burnt Yarrow Seeds - Charred medicinal seeds
        ItemBuilder::new("Burnt Yarrow Seeds", "Charred yarrow seeds that have lost their medicinal properties. Cannot be planted.", ItemCategory::Consumable)
            .icon("burnt_yarrow_seeds.png")
            .stackable(60)
            .respawn_time(0)
            .consumable(-1.0, 0.0, -1.0) // health, hunger, thirst
            .build(),

        // Chamomile Seeds - Calming herb seeds
        ItemBuilder::new("Chamomile Seeds", "Seeds for growing chamomile. Can be eaten but are very small and provide little nutrition.", ItemCategory::Placeable)
            .icon("chamomile_seeds.png")
            .stackable(80)
            .respawn_time(360) // 6 minutes
            .consumable(0.5, 0.5, 0.5) // health, hunger, thirst - mild calming effect
            .build(),

        // Burnt Chamomile Seeds - Charred chamomile seeds
        ItemBuilder::new("Burnt Chamomile Seeds", "Charred chamomile seeds. Cannot be planted.", ItemCategory::Consumable)
            .icon("burnt_chamomile_seeds.png")
            .stackable(80)
            .respawn_time(0)
            .consumable(-1.0, 0.0, -0.5) // health, hunger, thirst
            .build(),

        // Valerian Seeds - Sedative herb seeds
        ItemBuilder::new("Valerian Seeds", "Seeds for growing valerian. Can be eaten but have a very strong, unpleasant taste.", ItemCategory::Placeable)
            .icon("valerian_seeds.png")
            .stackable(50)
            .respawn_time(600) // 10 minutes
            .consumable(1.0, -0.5, -1.0) // health, hunger, thirst - medicinal but unpalatable
            .build(),

        // Burnt Valerian Seeds - Charred valerian seeds
        ItemBuilder::new("Burnt Valerian Seeds", "Charred valerian seeds that smell terrible. Cannot be planted.", ItemCategory::Consumable)
            .icon("burnt_valerian_seeds.png")
            .stackable(50)
            .respawn_time(0)
            .consumable(-2.0, -1.0, -2.0) // health, hunger, thirst
            .build(),

        // Mugwort Seeds - Bitter herb seeds
        ItemBuilder::new("Mugwort Seeds", "Seeds for growing mugwort. Can be eaten but are quite bitter and aromatic.", ItemCategory::Placeable)
            .icon("mugwort_seeds.png")
            .stackable(60)
            .respawn_time(420) // 7 minutes
            .consumable(0.5, 0.5, -0.5) // health, hunger, thirst
            .build(),

        // Burnt Mugwort Seeds - Charred mugwort seeds
        ItemBuilder::new("Burnt Mugwort Seeds", "Charred mugwort seeds that are acrid and bitter. Cannot be planted.", ItemCategory::Consumable)
            .icon("burnt_mugwort_seeds.png")
            .stackable(60)
            .respawn_time(0)
            .consumable(-1.0, 0.0, -1.0) // health, hunger, thirst
            .build(),

        // Dill Seeds - Culinary herb seeds
        ItemBuilder::new("Dill Seeds", "Seeds for growing dill. Can be eaten and have a mild, pleasant flavor.", ItemCategory::Placeable)
            .icon("dill_seeds.png")
            .stackable(70)
            .respawn_time(300) // 5 minutes
            .consumable(0.5, 1.0, 1.0) // health, hunger, thirst - pleasant taste
            .build(),

        // Burnt Dill Seeds - Charred dill seeds
        ItemBuilder::new("Burnt Dill Seeds", "Charred dill seeds that have lost their pleasant flavor. Cannot be planted.", ItemCategory::Consumable)
            .icon("burnt_dill_seeds.png")
            .stackable(70)
            .respawn_time(0)
            .consumable(-1.0, 0.0, -0.5) // health, hunger, thirst
            .build(),

        // Ginseng Seeds - Rare medicinal seeds
        ItemBuilder::new("Ginseng Seeds", "Rare seeds for growing Siberian ginseng. Can be eaten but provide minimal nutrition.", ItemCategory::Placeable)
            .icon("ginseng_seeds.png")
            .stackable(20)
            .respawn_time(1800) // 30 minutes - very rare
            .consumable(2.0, 0.5, 0.0) // health, hunger, thirst - medicinal properties
            .build(),

        // Burnt Ginseng Seeds - Charred ginseng seeds
        ItemBuilder::new("Burnt Ginseng Seeds", "Charred ginseng seeds that have lost their valuable properties. Cannot be planted.", ItemCategory::Consumable)
            .icon("burnt_ginseng_seeds.png")
            .stackable(20)
            .respawn_time(0)
            .consumable(-1.0, 0.0, -1.0) // health, hunger, thirst
            .build(),

        // === SPECIAL PLANTING MATERIALS ===

        // Bear Garlic Bulbs - Wild garlic bulbs
        ItemBuilder::new("Bear Garlic Bulbs", "Wild garlic bulbs for planting. Can be eaten raw but have a very strong flavor.", ItemCategory::Placeable)
            .icon("bear_garlic_bulbs.png")
            .stackable(30)
            .respawn_time(720) // 12 minutes
            .consumable(1.5, 1.0, -1.5) // health, hunger, thirst - strong medicinal
            .build(),

        // Burnt Bear Garlic Bulbs - Charred wild garlic
        ItemBuilder::new("Burnt Bear Garlic Bulbs", "Charred bear garlic bulbs that are bitter and unpalatable. Cannot be planted.", ItemCategory::Consumable)
            .icon("burnt_bear_garlic_bulbs.png")
            .stackable(30)
            .respawn_time(0)
            .consumable(-1.0, 0.0, -1.0) // health, hunger, thirst
            .build(),

        // Mint Cuttings - Mint propagation material
        ItemBuilder::new("Mint Cuttings", "Fresh mint cuttings for planting. Can be eaten for a refreshing taste.", ItemCategory::Placeable)
            .icon("mint_cuttings.png")
            .stackable(40)
            .respawn_time(300) // 5 minutes - spreads fast
            .consumable(0.5, 0.5, 2.0) // health, hunger, thirst - refreshing
            .build(),

        // Burnt Mint Cuttings - Charred mint
        ItemBuilder::new("Burnt Mint Cuttings", "Charred mint cuttings that have lost their refreshing properties. Cannot be planted.", ItemCategory::Consumable)
            .icon("burnt_mint_cuttings.png")
            .stackable(40)
            .respawn_time(0)
            .consumable(-1.0, 0.0, -1.0) // health, hunger, thirst
            .build(),

        // Horseradish Root - Root cutting for planting
        ItemBuilder::new("Horseradish Root", "Root cutting for growing horseradish. Can be eaten but is extremely pungent and hot.", ItemCategory::Placeable)
            .icon("horseradish_root.png")
            .stackable(15)
            .respawn_time(1200) // 20 minutes
            .consumable(1.0, -1.0, -3.0) // health, hunger, thirst - very strong, reduces appetite
            .build(),

        // Burnt Horseradish Root - Charred horseradish
        ItemBuilder::new("Burnt Horseradish Root", "Charred horseradish root that is bitter and acrid. Cannot be planted.", ItemCategory::Consumable)
            .icon("burnt_horseradish_root.png")
            .stackable(15)
            .respawn_time(0)
            .consumable(-2.0, -1.0, -2.0) // health, hunger, thirst
            .build(),

        // === NUTS (WITH FULL COOKING PROGRESSION) ===

        // Hazelnut Seeds - Raw hazelnuts that can be planted
        ItemBuilder::new("Hazelnut Seeds", "Raw hazelnuts that can be planted to grow hazel trees or eaten for nutrition.", ItemCategory::Placeable)
            .icon("hazelnut_seeds.png")
            .stackable(30)
            .respawn_time(1200) // 20 minutes
            .consumable(3.0, 8.0, -1.0) // health, hunger, thirst - nutritious nuts
            .build(),

        // Toasted Hazelnut Seeds - Enhanced when toasted
        ItemBuilder::new("Toasted Hazelnut Seeds", "Toasted hazelnuts with enhanced flavor and nutrition. Cannot be planted.", ItemCategory::Consumable)
            .icon("toasted_hazelnut_seeds.png")
            .stackable(30)
            .respawn_time(0)
            .consumable(6.0, 15.0, 0.0) // health, hunger, thirst
            .build(),

        // Burnt Hazelnut Seeds - Overcooked and bitter
        ItemBuilder::new("Burnt Hazelnut Seeds", "Burnt hazelnuts that are bitter and charred. Cannot be planted.", ItemCategory::Consumable)
            .icon("burnt_hazelnut_seeds.png")
            .stackable(30)
            .respawn_time(0)
            .consumable(-2.0, 2.0, -1.0) // health, hunger, thirst
            .build(),

        // === FIBER PLANT SEEDS ===

        // Dogbane Seeds - Fiber plant seeds
        ItemBuilder::new("Dogbane Seeds", "Seeds for growing dogbane fiber plants. Can be eaten but provide minimal nutrition.", ItemCategory::Placeable)
            .icon("dogbane_seeds.png")
            .stackable(50)
            .respawn_time(600) // 10 minutes
            .consumable(0.0, 1.0, -0.5) // health, hunger, thirst
            .build(),

        // Burnt Dogbane Seeds - Charred fiber seeds
        ItemBuilder::new("Burnt Dogbane Seeds", "Charred dogbane seeds. Cannot be planted.", ItemCategory::Consumable)
            .icon("burnt_dogbane_seeds.png")
            .stackable(50)
            .respawn_time(0)
            .consumable(-1.0, 0.0, -1.0) // health, hunger, thirst
            .build(),

        // Bog Cotton Seeds - Water fiber plant seeds
        ItemBuilder::new("Bog Cotton Seeds", "Seeds for growing bog cotton. Can be eaten but are quite fibrous and hard to digest.", ItemCategory::Placeable)
            .icon("bog_cotton_seeds.png")
            .stackable(60)
            .respawn_time(480) // 8 minutes
            .consumable(0.0, 0.5, -1.0) // health, hunger, thirst
            .build(),

        // Burnt Bog Cotton Seeds - Charred cotton seeds
        ItemBuilder::new("Burnt Bog Cotton Seeds", "Charred bog cotton seeds. Cannot be planted.", ItemCategory::Consumable)
            .icon("burnt_bog_cotton_seeds.png")
            .stackable(60)
            .respawn_time(0)
            .consumable(-1.0, 0.0, -1.0) // health, hunger, thirst
            .build(),

        // === MUSHROOM SPORES ===

        // Chanterelle Spores - Edible mushroom spores
        ItemBuilder::new("Chanterelle Spores", "Spores for growing chanterelle mushrooms. Can be eaten but provide minimal nutrition.", ItemCategory::Placeable)
            .icon("mushroom_spore.png")
            .stackable(20)
            .respawn_time(900) // 15 minutes
            .consumable(0.5, 1.0, 0.0) // health, hunger, thirst
            .build(),

        // Burnt Chanterelle Spores - Charred spores
        ItemBuilder::new("Burnt Chanterelle Spores", "Charred chanterelle spores. Cannot be planted.", ItemCategory::Consumable)
            .icon("burnt_mushroom_spore.png")
            .stackable(20)
            .respawn_time(0)
            .consumable(-1.0, 0.0, -0.5) // health, hunger, thirst
            .build(),

        // Porcini Spores - Premium mushroom spores
        ItemBuilder::new("Porcini Spores", "Spores for growing porcini mushrooms. Can be eaten but are very small.", ItemCategory::Placeable)
            .icon("mushroom_spore.png")
            .stackable(15)
            .respawn_time(1200) // 20 minutes
            .consumable(1.0, 1.0, 0.0) // health, hunger, thirst
            .build(),

        // Burnt Porcini Spores - Charred premium spores
        ItemBuilder::new("Burnt Porcini Spores", "Charred porcini spores. Cannot be planted.", ItemCategory::Consumable)
            .icon("burnt_mushroom_spore.png")
            .stackable(15)
            .respawn_time(0)
            .consumable(-1.0, 0.0, -0.5) // health, hunger, thirst
            .build(),

        // Shaggy Ink Cap Spores - Common mushroom spores
        ItemBuilder::new("Shaggy Ink Cap Spores", "Spores for growing shaggy ink cap mushrooms. Can be eaten but are very small.", ItemCategory::Placeable)
            .icon("mushroom_spore.png")
            .stackable(30)
            .respawn_time(600) // 10 minutes
            .consumable(0.5, 0.5, 0.0) // health, hunger, thirst
            .build(),

        // Burnt Shaggy Ink Cap Spores - Charred common spores
        ItemBuilder::new("Burnt Shaggy Ink Cap Spores", "Charred shaggy ink cap spores. Cannot be planted.", ItemCategory::Consumable)
            .icon("burnt_mushroom_spore.png")
            .stackable(30)
            .respawn_time(0)
            .consumable(-1.0, 0.0, -0.5) // health, hunger, thirst
            .build(),

        // Fly Agaric Spores - Toxic mushroom spores
        ItemBuilder::new("Fly Agaric Spores", "Spores for growing fly agaric mushrooms. Toxic if eaten.", ItemCategory::Placeable)
            .icon("mushroom_spore.png")
            .stackable(20)
            .respawn_time(800) // 13 minutes
            .consumable(-3.0, -1.0, -2.0) // health, hunger, thirst - toxic
            .build(),

        // Burnt Fly Agaric Spores - Charred toxic spores
        ItemBuilder::new("Burnt Fly Agaric Spores", "Charred fly agaric spores that are still toxic. Cannot be planted.", ItemCategory::Consumable)
            .icon("burnt_mushroom_spore.png")
            .stackable(20)
            .respawn_time(0)
            .consumable(-5.0, -2.0, -3.0) // health, hunger, thirst - more toxic
            .build(),

        // Deadly Webcap Spores - Extremely toxic spores
        ItemBuilder::new("Deadly Webcap Spores", "Spores for growing deadly webcap mushrooms. Extremely toxic if eaten.", ItemCategory::Placeable)
            .icon("mushroom_spore.png")
            .stackable(10)
            .respawn_time(1800) // 30 minutes - very rare
            .consumable(-8.0, -3.0, -5.0) // health, hunger, thirst - extremely toxic
            .build(),

        // Burnt Deadly Webcap Spores - Charred deadly spores
        ItemBuilder::new("Burnt Deadly Webcap Spores", "Charred deadly webcap spores that remain extremely toxic. Cannot be planted.", ItemCategory::Consumable)
            .icon("burnt_mushroom_spore.png")
            .stackable(10)
            .respawn_time(0)
            .consumable(-12.0, -5.0, -8.0) // health, hunger, thirst - even more toxic
            .build(),

        // Destroying Angel Spores - Lethal mushroom spores
        ItemBuilder::new("Destroying Angel Spores", "Spores for growing destroying angel mushrooms. Lethal if eaten.", ItemCategory::Placeable)
            .icon("mushroom_spore.png")
            .stackable(5)
            .respawn_time(2400) // 40 minutes - extremely rare
            .consumable(-15.0, -5.0, -10.0) // health, hunger, thirst - lethal
            .build(),

        // Burnt Destroying Angel Spores - Charred lethal spores
        ItemBuilder::new("Burnt Destroying Angel Spores", "Charred destroying angel spores that remain lethal. Cannot be planted.", ItemCategory::Consumable)
            .icon("burnt_mushroom_spore.png")
            .stackable(5)
            .respawn_time(0)
            .consumable(-20.0, -8.0, -15.0) // health, hunger, thirst - even more lethal
            .build(),

        // === BERRY SEEDS ===

        // Lingonberry Seeds - Tart berry seeds
        ItemBuilder::new("Lingonberry Seeds", "Seeds for growing lingonberry bushes. Can be eaten but are very small and tart.", ItemCategory::Placeable)
            .icon("lingonberry_seeds.png")
            .stackable(80)
            .respawn_time(900) // 15 minutes
            .consumable(0.5, 1.0, 1.0) // health, hunger, thirst - small but refreshing
            .build(),

        // Burnt Lingonberry Seeds - Charred berry seeds
        ItemBuilder::new("Burnt Lingonberry Seeds", "Charred lingonberry seeds. Cannot be planted.", ItemCategory::Consumable)
            .icon("burnt_lingonberry_seeds.png")
            .stackable(80)
            .respawn_time(0)
            .consumable(-1.0, 0.0, -0.5) // health, hunger, thirst
            .build(),

        // Cloudberry Seeds - Rare arctic berry seeds
        ItemBuilder::new("Cloudberry Seeds", "Seeds for growing cloudberry plants. Can be eaten but are very small.", ItemCategory::Placeable)
            .icon("cloudberry_seeds.png")
            .stackable(60)
            .respawn_time(1200) // 20 minutes
            .consumable(1.0, 1.0, 1.0) // health, hunger, thirst - nutritious but small
            .build(),

        // Burnt Cloudberry Seeds - Charred arctic seeds
        ItemBuilder::new("Burnt Cloudberry Seeds", "Charred cloudberry seeds. Cannot be planted.", ItemCategory::Consumable)
            .icon("burnt_cloudberry_seeds.png")
            .stackable(60)
            .respawn_time(0)
            .consumable(-1.0, 0.0, -0.5) // health, hunger, thirst
            .build(),

        // Bilberry Seeds - Wild blueberry seeds
        ItemBuilder::new("Bilberry Seeds", "Seeds for growing bilberry bushes. Can be eaten but are very tiny.", ItemCategory::Placeable)
            .icon("bilberry_seeds.png")
            .stackable(100)
            .respawn_time(600) // 10 minutes
            .consumable(0.5, 0.5, 1.0) // health, hunger, thirst - sweet but tiny
            .build(),

        // Burnt Bilberry Seeds - Charred blueberry seeds
        ItemBuilder::new("Burnt Bilberry Seeds", "Charred bilberry seeds. Cannot be planted.", ItemCategory::Consumable)
            .icon("burnt_bilberry_seeds.png")
            .stackable(100)
            .respawn_time(0)
            .consumable(-1.0, 0.0, -0.5) // health, hunger, thirst
            .build(),

        // Wild Strawberry Seeds - Small strawberry seeds
        ItemBuilder::new("Wild Strawberry Seeds", "Seeds for growing wild strawberry plants. Can be eaten but are extremely small.", ItemCategory::Placeable)
            .icon("wild_strawberry_seeds.png")
            .stackable(120)
            .respawn_time(480) // 8 minutes
            .consumable(0.5, 0.5, 0.5) // health, hunger, thirst - very small
            .build(),

        // Burnt Wild Strawberry Seeds - Charred strawberry seeds
        ItemBuilder::new("Burnt Wild Strawberry Seeds", "Charred wild strawberry seeds. Cannot be planted.", ItemCategory::Consumable)
            .icon("burnt_wild_strawberry_seeds.png")
            .stackable(120)
            .respawn_time(0)
            .consumable(-1.0, 0.0, -0.5) // health, hunger, thirst
            .build(),

        // Rowan Seeds - Mountain ash seeds
        ItemBuilder::new("Rowan Seeds", "Seeds for growing rowan trees. Can be eaten but are quite bitter.", ItemCategory::Placeable)
            .icon("rowan_seeds.png")
            .stackable(50)
            .respawn_time(1800) // 30 minutes
            .consumable(0.5, 1.0, -1.0) // health, hunger, thirst - bitter
            .build(),

        // Burnt Rowan Seeds - Charred mountain ash seeds
        ItemBuilder::new("Burnt Rowan Seeds", "Charred rowan seeds that are extremely bitter. Cannot be planted.", ItemCategory::Consumable)
            .icon("burnt_rowan_seeds.png")
            .stackable(50)
            .respawn_time(0)
            .consumable(-1.0, 0.0, -1.5) // health, hunger, thirst
            .build(),

        // Cranberry Seeds - Bog berry seeds
        ItemBuilder::new("Cranberry Seeds", "Seeds for growing cranberry plants. Can be eaten but are very tart and small.", ItemCategory::Placeable)
            .icon("cranberry_seeds.png")
            .stackable(80)
            .respawn_time(900) // 15 minutes
            .consumable(1.0, 1.0, 0.5) // health, hunger, thirst - tart but healthy
            .build(),

        // Burnt Cranberry Seeds - Charred bog seeds
        ItemBuilder::new("Burnt Cranberry Seeds", "Charred cranberry seeds. Cannot be planted.", ItemCategory::Consumable)
            .icon("burnt_cranberry_seeds.png")
            .stackable(80)
            .respawn_time(0)
            .consumable(-1.0, 0.0, -0.5) // health, hunger, thirst
            .build(),

        // === TOXIC PLANT SEEDS ===

        // Mandrake Seeds - Extremely rare and dangerous
        ItemBuilder::new("Mandrake Seeds", "Rare seeds for growing mandrake plants. Highly toxic if eaten.", ItemCategory::Placeable)
            .icon("mandrake_seeds.png")
            .stackable(5)
            .respawn_time(3600) // 60 minutes - extremely rare
            .consumable(-10.0, -2.0, -5.0) // health, hunger, thirst - very toxic
            .build(),

        // Burnt Mandrake Seeds - Charred toxic seeds
        ItemBuilder::new("Burnt Mandrake Seeds", "Charred mandrake seeds that remain toxic. Cannot be planted.", ItemCategory::Consumable)
            .icon("burnt_mandrake_seeds.png")
            .stackable(5)
            .respawn_time(0)
            .consumable(-15.0, -4.0, -8.0) // health, hunger, thirst - more toxic
            .build(),

        // Belladonna Seeds - Deadly nightshade seeds
        ItemBuilder::new("Belladonna Seeds", "Seeds for growing belladonna plants. Deadly if eaten.", ItemCategory::Placeable)
            .icon("belladonna_seeds.png")
            .stackable(10)
            .respawn_time(2400) // 40 minutes
            .consumable(-12.0, -3.0, -6.0) // health, hunger, thirst - deadly
            .build(),

        // Burnt Belladonna Seeds - Charred deadly seeds
        ItemBuilder::new("Burnt Belladonna Seeds", "Charred belladonna seeds that remain deadly. Cannot be planted.", ItemCategory::Consumable)
            .icon("burnt_belladonna_seeds.png")
            .stackable(10)
            .respawn_time(0)
            .consumable(-18.0, -5.0, -10.0) // health, hunger, thirst - even more deadly
            .build(),

        // Henbane Seeds - Toxic herb seeds
        ItemBuilder::new("Henbane Seeds", "Seeds for growing henbane plants. Toxic if eaten.", ItemCategory::Placeable)
            .icon("henbane_seeds.png")
            .stackable(15)
            .respawn_time(1800) // 30 minutes
            .consumable(-8.0, -2.0, -4.0) // health, hunger, thirst - toxic
            .build(),

        // Burnt Henbane Seeds - Charred toxic herb seeds
        ItemBuilder::new("Burnt Henbane Seeds", "Charred henbane seeds that remain toxic. Cannot be planted.", ItemCategory::Consumable)
            .icon("burnt_henbane_seeds.png")
            .stackable(15)
            .respawn_time(0)
            .consumable(-12.0, -4.0, -6.0) // health, hunger, thirst - more toxic
            .build(),

        // Datura Seeds - Hallucinogenic plant seeds
        ItemBuilder::new("Datura Seeds", "Seeds for growing datura plants. Highly toxic and hallucinogenic if eaten.", ItemCategory::Placeable)
            .icon("datura_seeds.png")
            .stackable(10)
            .respawn_time(2100) // 35 minutes
            .consumable(-10.0, -3.0, -5.0) // health, hunger, thirst - toxic and hallucinogenic
            .build(),

        // Burnt Datura Seeds - Charred hallucinogenic seeds
        ItemBuilder::new("Burnt Datura Seeds", "Charred datura seeds that remain toxic. Cannot be planted.", ItemCategory::Consumable)
            .icon("burnt_datura_seeds.png")
            .stackable(10)
            .respawn_time(0)
            .consumable(-15.0, -5.0, -8.0) // health, hunger, thirst - more toxic
            .build(),

        // Wolfsbane Seeds - Extremely toxic flower seeds
        ItemBuilder::new("Wolfsbane Seeds", "Seeds for growing wolfsbane plants. Extremely toxic if eaten.", ItemCategory::Placeable)
            .icon("wolfsbane_seeds.png")
            .stackable(8)
            .respawn_time(2700) // 45 minutes
            .consumable(-15.0, -4.0, -8.0) // health, hunger, thirst - extremely toxic
            .build(),

        // Burnt Wolfsbane Seeds - Charred extremely toxic seeds
        ItemBuilder::new("Burnt Wolfsbane Seeds", "Charred wolfsbane seeds that remain extremely toxic. Cannot be planted.", ItemCategory::Consumable)
            .icon("burnt_wolfsbane_seeds.png")
            .stackable(8)
            .respawn_time(0)
            .consumable(-22.0, -6.0, -12.0) // health, hunger, thirst - even more toxic
            .build(),

        // === NON-EDIBLE PLANTING MATERIALS ===

        // Seed Potato - Not technically a seed, but plantable
        ItemBuilder::new("Seed Potato", "Potato tuber for planting. Not recommended for eating raw.", ItemCategory::Placeable)
            .icon("seed_potato.png")
            .stackable(20)
            .respawn_time(900) // 15 minutes - rare
            .consumable(-1.0, -2.0, -2.0) // health, hunger, thirst
            .build(),

        // Corn Seeds - Large seeds
        ItemBuilder::new("Corn Seeds", "Large seeds for planting corn. Can be eaten but are quite hard.", ItemCategory::Placeable)
            .icon("corn_seeds.png")
            .stackable(20)
            .respawn_time(1200) // 20 minutes - valuable crop
            .consumable(0.0, 1.0, -2.0) // health, hunger, thirst
            .build(),

        // Nettle Seeds - Fiber crop seeds
        ItemBuilder::new("Nettle Seeds", "Seeds for growing nettle plants. Edible but can cause mouth irritation.", ItemCategory::Placeable)
            .icon("nettle_seeds.png")
            .stackable(30)
            .respawn_time(600) // 10 minutes
            .consumable(-0.5, 1.0, -1.0) // health, hunger, thirst
            .build(),

        // Reed Rhizome - Water plant propagation (NOT a seed, but plantable)
        ItemBuilder::new("Reed Rhizome", "Root cutting from reed plants. Can be deployed to grow reed stalks near water. Not edible.", ItemCategory::Placeable)
            .icon("reed_rhizome.png")
            .stackable(15)
            .respawn_time(720) // 12 minutes
            .consumable(-3.0, -5.0, -5.0) // health, hunger, thirst
            .build(),
    ]
}
