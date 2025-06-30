use crate::items::ItemDefinition;
use crate::items::{ItemCategory, CostIngredient};
use super::builders::*;

/// All consumable items in the game - food, medicine, and survival items
pub fn get_consumable_definitions() -> Vec<ItemDefinition> {
    vec![
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

        ItemBuilder::new("Carrot", "A fresh, white carrot. Crunchy and nutritious when eaten raw or cooked.", ItemCategory::Consumable)
            .icon("carrot.png")
            .stackable(15)
            .consumable(8.0, 12.0, 5.0)
            .cookable(35.0, "Cooked Carrot")
            .respawn_time(180)
            .build(),

        ItemBuilder::new("Cooked Carrot", "Tender and sweet cooked carrots. A healthy and delicious side dish.", ItemCategory::Consumable)
            .icon("cooked_carrot.png")
            .stackable(15)
            .consumable(25.0, 35.0, 15.0)
            .stamina_gain(12.0)
            .cookable(45.0, "Burnt Carrot")
            .respawn_time(240)
            .build(),

        ItemBuilder::new("Burnt Carrot", "Overcooked carrots that have turned black and bitter. Can be processed into charcoal.", ItemCategory::Consumable)
            .icon("burnt_carrot.png")
            .stackable(15)
            .consumable(-2.0, 8.0, -8.0)
            .crafting_output(12, 0)
            .cookable(50.0, "Charcoal")
            .respawn_time(60)
            .build(),

        // === NEW ARCTIC/SUBARCTIC PLANTS ===
        ItemBuilder::new("Scurvy Grass", "Arctic plant rich in vitamin C. Essential for preventing scurvy on long voyages. Grows year-round in coastal areas.", ItemCategory::Consumable)
            .icon("scurvy_grass.png")
            .stackable(20)
            .consumable(15.0, 8.0, 5.0) // High health (vitamin C), low hunger/thirst
            .stamina_gain(8.0)
            .cookable(25.0, "Burnt Scurvy Grass")
            .respawn_time(150)
            .build(),

        ItemBuilder::new("Burnt Scurvy Grass", "Overcooked scurvy grass. Vitamin C destroyed by heat, but still edible.", ItemCategory::Consumable)
            .icon("burnt_scurvy_grass.png")
            .stackable(20)
            .consumable(2.0, 5.0, -2.0)
            .crafting_output(8, 0)
            .cookable(30.0, "Charcoal")
            .respawn_time(40)
            .build(),

        ItemBuilder::new("Crowberry", "Small, dark berries from low-growing subarctic shrubs. Tart flavor with good nutrition.", ItemCategory::Consumable)
            .icon("crowberry.png")
            .stackable(25)
            .consumable(8.0, 12.0, 10.0)
            .stamina_gain(6.0)
            .cookable(22.0, "Burnt Crowberry")
            .respawn_time(180)
            .build(),

        ItemBuilder::new("Burnt Crowberry", "Overcooked crowberries. Dark and bitter, nutrients destroyed by heat.", ItemCategory::Consumable)
            .icon("burnt_crowberry.png")
            .stackable(25)
            .consumable(-1.0, 3.0, -3.0)
            .crafting_output(6, 0)
            .cookable(25.0, "Charcoal")
            .respawn_time(35)
            .build(),

        ItemBuilder::new("Sea Plantain", "Maritime plant with year-round edible leaves. Salty flavor from growing near the ocean.", ItemCategory::Consumable)
            .icon("sea_plantain.png")
            .stackable(18)
            .consumable(6.0, 10.0, -5.0) // Negative thirst due to salt content
            .stamina_gain(4.0)
            .cookable(20.0, "Burnt Sea Plantain")
            .respawn_time(140)
            .build(),

        ItemBuilder::new("Burnt Sea Plantain", "Charred sea plantain. Salt concentration increased by cooking, very thirsty-making.", ItemCategory::Consumable)
            .icon("burnt_sea_plantain.png")
            .stackable(18)
            .consumable(1.0, 4.0, -10.0) // Very negative thirst
            .crafting_output(5, 0)
            .cookable(28.0, "Charcoal")
            .respawn_time(30)
            .build(),

        ItemBuilder::new("Glasswort", "Salt-tolerant succulent with crunchy texture. Natural source of salt and minerals.", ItemCategory::Consumable)
            .icon("glasswort.png")
            .stackable(15)
            .consumable(4.0, 8.0, -8.0) // Good hunger, very negative thirst (salty)
            .stamina_gain(5.0)
            .cookable(30.0, "Burnt Glasswort")
            .respawn_time(160)
            .build(),

        ItemBuilder::new("Burnt Glasswort", "Cooked glasswort. Concentrates the salt even more, making it very thirsty-making.", ItemCategory::Consumable)
            .icon("burnt_glasswort.png")
            .stackable(15)
            .consumable(1.0, 5.0, -15.0) // Extremely negative thirst
            .crafting_output(7, 0)
            .cookable(35.0, "Charcoal")
            .respawn_time(40)
            .build(),





        ItemBuilder::new("Beet", "A deep red root vegetable with a sweet, earthy flavor. Nutritious and can be eaten raw or cooked.", ItemCategory::Consumable)
            .icon("beet.png")
            .stackable(12)
            .consumable(12.0, 18.0, 10.0)
            .cookable(40.0, "Cooked Beet")
            .respawn_time(240)
            .build(),

        ItemBuilder::new("Cooked Beet", "Tender and sweet cooked beet. A healthy side dish that provides excellent nutrition.", ItemCategory::Consumable)
            .icon("cooked_beet.png")
            .stackable(12)
            .consumable(30.0, 45.0, 25.0)
            .stamina_gain(20.0)
            .cookable(50.0, "Burnt Beet")
            .respawn_time(300)
            .build(),

        ItemBuilder::new("Burnt Beet", "Overcooked beet that has turned black and bitter. Can be processed into charcoal.", ItemCategory::Consumable)
            .icon("burnt_beet.png")
            .stackable(12)
            .consumable(-2.0, 8.0, -8.0)
            .crafting_output(12, 0)
            .cookable(55.0, "Charcoal")
            .respawn_time(100)
            .build(),







        ItemBuilder::new("Horseradish", "A pungent root vegetable with a sharp, spicy flavor. Can be eaten raw or cooked for better nutrition.", ItemCategory::Consumable)
            .icon("horseradish.png")
            .stackable(12)
            .consumable(5.0, 8.0, 3.0)
            .cookable(40.0, "Cooked Horseradish")
            .respawn_time(220)
            .build(),

        ItemBuilder::new("Cooked Horseradish", "Tender and flavorful cooked horseradish. A flavorful addition to meals that provides decent nutrition.", ItemCategory::Consumable)
            .icon("cooked_horseradish.png")
            .stackable(12)
            .consumable(15.0, 25.0, 12.0)
            .stamina_gain(8.0)
            .cookable(50.0, "Burnt Horseradish")
            .respawn_time(280)
            .build(),

        ItemBuilder::new("Burnt Horseradish", "Overcooked horseradish that has turned black and bitter. Can be processed into charcoal.", ItemCategory::Consumable)
            .icon("burnt_horseradish.png")
            .stackable(12)
            .consumable(-2.0, 5.0, -8.0)
            .crafting_output(12, 0)
            .cookable(55.0, "Charcoal")
            .respawn_time(90)
            .build(),

        ItemBuilder::new("Sunflower", "A bright yellow sunflower with edible seeds. Can be eaten raw or cooked for better nutrition.", ItemCategory::Consumable)
            .icon("sunflower.png")
            .stackable(12)
            .consumable(5.0, 8.0, 3.0)
            .cookable(40.0, "Cooked Sunflower")
            .respawn_time(220)
            .build(),

        ItemBuilder::new("Cooked Sunflower", "A tender and flavorful cooked sunflower. A nutritious addition to meals that provides decent nutrition.", ItemCategory::Consumable)
            .icon("cooked_sunflower.png")
            .stackable(12)
            .consumable(15.0, 25.0, 12.0)
            .stamina_gain(8.0)
            .cookable(50.0, "Burnt Sunflower")
            .respawn_time(280)
            .build(),

        ItemBuilder::new("Burnt Sunflower", "An overcooked sunflower that has turned black and bitter. Can be processed into charcoal.", ItemCategory::Consumable)
            .icon("burnt_sunflower.png")
            .stackable(12)
            .consumable(-2.0, 5.0, -8.0)
            .crafting_output(12, 0)
            .cookable(55.0, "Charcoal")
            .respawn_time(90)
            .build(),

        ItemBuilder::new("Salsify Root", "A root vegetable with a mild, oyster-like flavor. Can be eaten raw or cooked for better nutrition.", ItemCategory::Consumable)
            .icon("salsify.png")
            .stackable(12)
            .consumable(5.0, 8.0, 3.0)
            .cookable(40.0, "Cooked Salsify Root")
            .respawn_time(220)
            .build(),

        ItemBuilder::new("Cooked Salsify Root", "Tender and flavorful cooked salsify. A nutritious addition to meals that provides decent nutrition.", ItemCategory::Consumable)
            .icon("cooked_salsify.png")
            .stackable(12)
            .consumable(15.0, 25.0, 12.0)
            .stamina_gain(8.0)
            .cookable(50.0, "Burnt Salsify Root")
            .respawn_time(280)
            .build(),

        ItemBuilder::new("Burnt Salsify Root", "Overcooked salsify that has turned black and bitter. Can be processed into charcoal.", ItemCategory::Consumable)
            .icon("burnt_salsify.png")
            .stackable(12)
            .consumable(-2.0, 5.0, -8.0)
            .crafting_output(12, 0)
            .cookable(55.0, "Charcoal")
            .respawn_time(90)
            .build(),



        ItemBuilder::new("Chicory", "A bitter leafy green with a distinctive flavor. Can be eaten raw or cooked to reduce bitterness.", ItemCategory::Consumable)
            .icon("chicory.png")
            .stackable(12)
            .consumable(3.0, 6.0, 2.0)
            .cookable(40.0, "Cooked Chicory")
            .respawn_time(200)
            .build(),

        ItemBuilder::new("Cooked Chicory", "Cooked chicory with reduced bitterness. A nutritious green vegetable that provides decent nutrition.", ItemCategory::Consumable)
            .icon("cooked_chicory.png")
            .stackable(12)
            .consumable(12.0, 18.0, 8.0)
            .stamina_gain(6.0)
            .cookable(50.0, "Burnt Chicory")
            .respawn_time(260)
            .build(),

        ItemBuilder::new("Burnt Chicory", "Overcooked chicory that has turned black and bitter. Can be processed into charcoal.", ItemCategory::Consumable)
            .icon("burnt_chicory.png")
            .stackable(12)
            .consumable(-2.0, 3.0, -5.0)
            .crafting_output(12, 0)
            .cookable(55.0, "Charcoal")
            .respawn_time(90)
            .build(),

        ItemBuilder::new("Yarrow", "A flowering herb with feathery leaves and white flower clusters. Known for its medicinal properties and bitter taste.", ItemCategory::Consumable)
            .icon("yarrow.png")
            .stackable(12)
            .consumable(2.0, 4.0, 1.0)
            .cookable(40.0, "Cooked Yarrow")
            .respawn_time(180)
            .build(),

        ItemBuilder::new("Cooked Yarrow", "Cooked yarrow with reduced bitterness. A medicinal herb that provides some nutrition and healing properties.", ItemCategory::Consumable)
            .icon("cooked_yarrow.png")
            .stackable(12)
            .consumable(8.0, 12.0, 6.0)
            .stamina_gain(4.0)
            .cookable(50.0, "Burnt Yarrow")
            .respawn_time(240)
            .build(),

        ItemBuilder::new("Burnt Yarrow", "Overcooked yarrow that has lost its medicinal properties. Can be processed into charcoal.", ItemCategory::Consumable)
            .icon("burnt_yarrow.png")
            .stackable(12)
            .consumable(-1.0, 2.0, -3.0)
            .crafting_output(12, 0)
            .cookable(55.0, "Charcoal")
            .respawn_time(90)
            .build(),

        ItemBuilder::new("Chamomile", "A delicate herb with small white flowers and a sweet, apple-like fragrance. Known for its calming properties.", ItemCategory::Consumable)
            .icon("chamomile.png")
            .stackable(12)
            .consumable(1.0, 3.0, 2.0)
            .cookable(40.0, "Cooked Chamomile")
            .respawn_time(200)
            .build(),

        ItemBuilder::new("Cooked Chamomile", "Cooked chamomile that releases its calming properties. A soothing herb that provides gentle nutrition.", ItemCategory::Consumable)
            .icon("cooked_chamomile.png")
            .stackable(12)
            .consumable(6.0, 10.0, 8.0)
            .stamina_gain(3.0)
            .cookable(50.0, "Burnt Chamomile")
            .respawn_time(260)
            .build(),

        ItemBuilder::new("Burnt Chamomile", "Overcooked chamomile that has lost its beneficial properties. Can be processed into charcoal.", ItemCategory::Consumable)
            .icon("burnt_chamomile.png")
            .stackable(12)
            .consumable(-1.0, 2.0, -2.0)
            .crafting_output(12, 0)
            .cookable(55.0, "Charcoal")
            .respawn_time(90)
            .build(),

        ItemBuilder::new("Mint Leaves", "A refreshing herb with bright green leaves and a cool, menthol-like flavor. Known for its digestive properties.", ItemCategory::Consumable)
            .icon("mint.png")
            .stackable(12)
            .consumable(1.0, 3.0, 2.0)
            .cookable(40.0, "Cooked Mint Leaves")
            .respawn_time(200)
            .build(),

        ItemBuilder::new("Cooked Mint Leaves", "Cooked mint that enhances its refreshing properties. A soothing herb that provides gentle nutrition and cooling effects.", ItemCategory::Consumable)
            .icon("cooked_mint.png")
            .stackable(12)
            .consumable(6.0, 10.0, 8.0)
            .stamina_gain(3.0)
            .cookable(50.0, "Burnt Mint Leaves")
            .respawn_time(260)
            .build(),

        ItemBuilder::new("Burnt Mint Leaves", "Overcooked mint that has lost its refreshing properties. Can be processed into charcoal.", ItemCategory::Consumable)
            .icon("burnt_mint.png")
            .stackable(12)
            .consumable(-1.0, 2.0, -2.0)
            .crafting_output(12, 0)
            .cookable(55.0, "Charcoal")
            .respawn_time(90)
            .build(),

        // === MEDICINAL HERBS ===
        ItemBuilder::new("Valerian Root", "A calming herb known for its sedative properties. Helps restore stamina and provides a mild health boost.", ItemCategory::Consumable)
            .icon("valerian.png")
            .stackable(15)
            .consumable(8.0, 5.0, 3.0)
            .stamina_gain(15.0)
            .cookable(40.0, "Burnt Valerian Root")
            .respawn_time(240)
            .build(),

        ItemBuilder::new("Burnt Valerian Root", "Overheated valerian root. Has lost most of its calming properties but can be processed into charcoal.", ItemCategory::Consumable)
            .icon("burnt_valerian.png")
            .stackable(15)
            .consumable(-2.0, 1.0, -3.0)
            .crafting_output(8, 0)
            .cookable(55.0, "Charcoal")
            .respawn_time(60)
            .build(),

        ItemBuilder::new("Mugwort", "A bitter aromatic herb with digestive properties. Provides moderate hunger satisfaction and mild health benefits.", ItemCategory::Consumable)
            .icon("mugwort.png")
            .stackable(12)
            .consumable(6.0, 12.0, 2.0)
            .stamina_gain(8.0)
            .cookable(35.0, "Cooked Mugwort")
            .respawn_time(200)
            .build(),

        ItemBuilder::new("Cooked Mugwort", "Sautéed mugwort with mellowed bitterness. The cooking process enhances its digestive properties.", ItemCategory::Consumable)
            .icon("cooked_mugwort.png")
            .stackable(12)
            .consumable(12.0, 20.0, 4.0)
            .stamina_gain(15.0)
            .cookable(25.0, "Burnt Mugwort")
            .build(),

        ItemBuilder::new("Burnt Mugwort", "Charred mugwort leaves. Bitter and unpalatable, but can be processed into charcoal.", ItemCategory::Consumable)
            .icon("burnt_mugwort.png")
            .stackable(12)
            .consumable(-3.0, 2.0, -4.0)
            .crafting_output(6, 0)
            .cookable(50.0, "Charcoal")
            .respawn_time(40)
            .build(),

        ItemBuilder::new("Bear Garlic", "Wild garlic with a strong, pungent flavor. Provides good nutrition and natural antimicrobial properties.", ItemCategory::Consumable)
            .icon("bear_garlic.png")
            .stackable(16)
            .consumable(7.0, 10.0, 3.0)
            .stamina_gain(10.0)
            .cookable(38.0, "Roasted Bear Garlic")
            .respawn_time(280)
            .build(),

        ItemBuilder::new("Roasted Bear Garlic", "Caramelized wild garlic with a sweet, mellow flavor. Roasting reduces the pungency and enhances the nutrition.", ItemCategory::Consumable)
            .icon("roasted_bear_garlic.png")
            .stackable(16)
            .consumable(15.0, 18.0, 8.0)
            .stamina_gain(20.0)
            .cookable(28.0, "Burnt Bear Garlic")
            .build(),

        ItemBuilder::new("Burnt Bear Garlic", "Blackened wild garlic. The pungent aroma is replaced by the smell of char. Can be processed into charcoal.", ItemCategory::Consumable)
            .icon("burnt_bear_garlic.png")
            .stackable(16)
            .consumable(-3.0, 2.0, -5.0)
            .crafting_output(9, 0)
            .cookable(52.0, "Charcoal")
            .respawn_time(50)
            .build(),

        ItemBuilder::new("Siberian Ginseng", "Adaptogenic root known for boosting energy and resilience. Provides excellent stamina restoration.", ItemCategory::Consumable)
            .icon("siberian_ginseng.png")
            .stackable(8)
            .consumable(12.0, 8.0, 5.0)
            .stamina_gain(25.0)
            .cookable(45.0, "Burnt Siberian Ginseng")
            .respawn_time(360)
            .build(),

        ItemBuilder::new("Burnt Siberian Ginseng", "Charred ginseng root. All adaptogenic properties destroyed by excessive heat. Can be processed into charcoal.", ItemCategory::Consumable)
            .icon("burnt_siberian_ginseng.png")
            .stackable(8)
            .consumable(-5.0, 1.0, -8.0)
            .crafting_output(12, 0)
            .cookable(60.0, "Charcoal")
            .respawn_time(80)
            .build(),

        ItemBuilder::new("Nettle Leaves", "Raw stinging nettle leaves. Highly nutritious but painful to eat raw due to formic acid in the stinging hairs.", ItemCategory::Consumable)
            .icon("nettle_leaves.png")
            .stackable(25)
            .consumable(-8.0, 12.0, -15.0) // Damage and dehydration from stinging
            .stamina_gain(5.0) // Still some nutrition despite the pain
            .cookable(25.0, "Cooked Nettle Leaves")
            .respawn_time(180)
            .build(),

        ItemBuilder::new("Cooked Nettle Leaves", "Properly cooked nettle leaves. Cooking destroys the stinging hairs, revealing excellent nutrition and iron content.", ItemCategory::Consumable)
            .icon("cooked_nettle_leaves.png")
            .stackable(25)
            .consumable(15.0, 22.0, 8.0) // Great nutrition once cooked
            .stamina_gain(18.0)
            .cookable(20.0, "Burnt Nettle Leaves")
            .build(),

        ItemBuilder::new("Burnt Nettle Leaves", "Overcooked nettle leaves. Blackened and bitter, all the valuable nutrients destroyed by excess heat.", ItemCategory::Consumable)
            .icon("burnt_nettle_leaves.png")
            .stackable(25)
            .consumable(-3.0, 3.0, -5.0)
            .crafting_output(6, 0)
            .cookable(35.0, "Charcoal")
            .respawn_time(40)
            .build(),

        // === TEA HERBS (Raw → Burnt for future tea system) ===

        ItemBuilder::new("Chamomile", "Delicate chamomile flowers and leaves. Traditional calming tea herb.", ItemCategory::Consumable)
            .icon("chamomile.png")
            .stackable(30)
            .consumable(2.0, 4.0, 3.0)
            .stamina_gain(4.0)
            .cookable(20.0, "Burnt Chamomile")
            .respawn_time(140)
            .build(),

        ItemBuilder::new("Burnt Chamomile", "Overcooked chamomile. Calming properties destroyed by excess heat.", ItemCategory::Consumable)
            .icon("burnt_chamomile.png")
            .stackable(30)
            .consumable(-1.0, 2.0, -2.0)
            .crafting_output(3, 0)
            .cookable(25.0, "Charcoal")
            .respawn_time(30)
            .build(),

        ItemBuilder::new("Valerian Leaves", "Leaves from valerian plants. Traditional tea herb with mild sedative properties.", ItemCategory::Consumable)
            .icon("valerian_leaves.png")
            .stackable(25)
            .consumable(3.0, 6.0, 2.0)
            .stamina_gain(8.0)
            .cookable(25.0, "Burnt Valerian Leaves")
            .respawn_time(180)
            .build(),

        ItemBuilder::new("Burnt Valerian Leaves", "Charred valerian leaves. Sedative properties destroyed, leaving only bitter char.", ItemCategory::Consumable)
            .icon("burnt_valerian_leaves.png")
            .stackable(25)
            .consumable(-2.0, 2.0, -3.0)
            .crafting_output(5, 0)
            .cookable(30.0, "Charcoal")
            .respawn_time(35)
            .build(),

        ItemBuilder::new("Ginseng Leaves", "Leaves from rare Siberian ginseng plants. Traditional tea herb with mild adaptogenic properties.", ItemCategory::Consumable)
            .icon("ginseng_leaves.png")
            .stackable(15)
            .consumable(5.0, 6.0, 3.0)
            .stamina_gain(10.0)
            .cookable(30.0, "Burnt Ginseng Leaves")
            .respawn_time(240)
            .build(),

        ItemBuilder::new("Burnt Ginseng Leaves", "Charred ginseng leaves. Valuable adaptogenic compounds destroyed by overcooking.", ItemCategory::Consumable)
            .icon("burnt_ginseng_leaves.png")
            .stackable(15)
            .consumable(-3.0, 2.0, -4.0)
            .crafting_output(6, 0)
            .cookable(35.0, "Charcoal")
            .respawn_time(40)
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

        // === MUSHROOMS ===
        ItemBuilder::new("Chanterelle", "Golden trumpet-shaped mushrooms with a fruity aroma. Safe and delicious when cooked properly.", ItemCategory::Consumable)
            .icon("chanterelle.png")
            .stackable(20)
            .consumable(6.0, 8.0, 2.0)
            .stamina_gain(5.0)
            .cookable(25.0, "Cooked Chanterelle")
            .respawn_time(220)
            .build(),

        ItemBuilder::new("Cooked Chanterelle", "Perfectly sautéed chanterelles with enhanced flavor and nutrition. Golden and aromatic.", ItemCategory::Consumable)
            .icon("cooked_chanterelle.png")
            .stackable(20)
            .consumable(15.0, 18.0, 8.0)
            .stamina_gain(12.0)
            .cookable(20.0, "Burnt Chanterelle")
            .build(),

        ItemBuilder::new("Burnt Chanterelle", "Overcooked chanterelles, blackened and bitter. Can be processed into charcoal.", ItemCategory::Consumable)
            .icon("burnt_chanterelle.png")
            .stackable(20)
            .consumable(-4.0, 3.0, -6.0)
            .crafting_output(8, 0)
            .cookable(30.0, "Charcoal")
            .respawn_time(40)
            .build(),

        ItemBuilder::new("Porcini", "Prized mushrooms with a meaty texture and rich flavor. Excellent nutrition when prepared properly.", ItemCategory::Consumable)
            .icon("porcini.png")
            .stackable(15)
            .consumable(8.0, 12.0, 3.0)
            .stamina_gain(8.0)
            .cookable(30.0, "Cooked Porcini")
            .respawn_time(280)
            .build(),

        ItemBuilder::new("Cooked Porcini", "Expertly cooked porcini mushrooms. Rich, meaty texture with exceptional nutritional value.", ItemCategory::Consumable)
            .icon("cooked_porcini.png")
            .stackable(15)
            .consumable(20.0, 25.0, 12.0)
            .stamina_gain(18.0)
            .cookable(25.0, "Burnt Porcini")
            .build(),

        ItemBuilder::new("Burnt Porcini", "Charred porcini mushrooms. All the delicate flavors destroyed by excessive heat.", ItemCategory::Consumable)
            .icon("burnt_porcini.png")
            .stackable(15)
            .consumable(-5.0, 5.0, -8.0)
            .crafting_output(10, 0)
            .cookable(35.0, "Charcoal")
            .respawn_time(50)
            .build(),

        ItemBuilder::new("Shaggy Ink Cap", "Delicate mushrooms that must be cooked immediately after harvest. Edible when fresh but deteriorates quickly.", ItemCategory::Consumable)
            .icon("shaggy_ink_cap.png")
            .stackable(25)
            .consumable(4.0, 6.0, 1.0)
            .stamina_gain(3.0)
            .cookable(20.0, "Cooked Shaggy Ink Cap")
            .respawn_time(180)
            .build(),

        ItemBuilder::new("Cooked Shaggy Ink Cap", "Quickly cooked ink cap mushrooms. Light and nutritious with a delicate flavor.", ItemCategory::Consumable)
            .icon("cooked_shaggy_ink_cap.png")
            .stackable(25)
            .consumable(12.0, 15.0, 6.0)
            .stamina_gain(10.0)
            .cookable(15.0, "Burnt Shaggy Ink Cap")
            .build(),

        ItemBuilder::new("Burnt Shaggy Ink Cap", "Overcooked ink cap mushrooms. Turned to black mush, barely edible.", ItemCategory::Consumable)
            .icon("burnt_shaggy_ink_cap.png")
            .stackable(25)
            .consumable(-3.0, 2.0, -5.0)
            .crafting_output(6, 0)
            .cookable(25.0, "Charcoal")
            .respawn_time(30)
            .build(),

        ItemBuilder::new("Fly Agaric", "Iconic red mushroom with white spots. Highly toxic and psychoactive. Cooking does not remove the toxins.", ItemCategory::Consumable)
            .icon("fly_agaric.png")
            .stackable(10)
            .consumable(-15.0, 2.0, -20.0)
            .stamina_gain(-10.0)
            .cookable(30.0, "Burnt Fly Agaric")
            .respawn_time(400)
            .build(),

        ItemBuilder::new("Burnt Fly Agaric", "Charred toxic mushroom. Still dangerous even when burnt, but can be processed into charcoal.", ItemCategory::Consumable)
            .icon("burnt_fly_agaric.png")
            .stackable(10)
            .consumable(-8.0, 1.0, -12.0)
            .stamina_gain(-5.0)
            .crafting_output(12, 0)
            .cookable(40.0, "Charcoal")
            .respawn_time(70)
            .build(),

        ItemBuilder::new("Deadly Webcap", "Extremely dangerous mushroom containing deadly toxins. Even small amounts can be lethal. Avoid at all costs.", ItemCategory::Consumable)
            .icon("deadly_webcap.png")
            .stackable(8)
            .consumable(-25.0, 1.0, -30.0)
            .stamina_gain(-20.0)
            .cookable(35.0, "Burnt Deadly Webcap")
            .respawn_time(500)
            .build(),

        ItemBuilder::new("Burnt Deadly Webcap", "Charred deadly mushroom. Toxicity reduced but still harmful. Can be processed into charcoal.", ItemCategory::Consumable)
            .icon("burnt_deadly_webcap.png")
            .stackable(8)
            .consumable(-12.0, 1.0, -15.0)
            .stamina_gain(-8.0)
            .crafting_output(15, 0)
            .cookable(45.0, "Charcoal")
            .respawn_time(90)
            .build(),

        ItemBuilder::new("Destroying Angel", "Pure white mushroom of death. Contains lethal toxins that cause delayed but fatal poisoning. Extremely dangerous.", ItemCategory::Consumable)
            .icon("destroying_angel.png")
            .stackable(6)
            .consumable(-30.0, 1.0, -40.0)
            .stamina_gain(-25.0)
            .cookable(40.0, "Burnt Destroying Angel")
            .respawn_time(600)
            .build(),

        ItemBuilder::new("Burnt Destroying Angel", "Charred death cap. Even burnt, it retains dangerous toxins. Can be processed into charcoal.", ItemCategory::Consumable)
            .icon("burnt_destroying_angel.png")
            .stackable(6)
            .consumable(-15.0, 1.0, -20.0)
            .stamina_gain(-10.0)
            .crafting_output(18, 0)
            .cookable(50.0, "Charcoal")
            .respawn_time(110)
            .build(),

        // === BERRIES & NUTS ===
        ItemBuilder::new("Lingonberries", "Tart red berries with a slightly bitter taste. Rich in vitamins and antioxidants. Common in northern regions.", ItemCategory::Consumable)
            .icon("lingonberries.png")
            .stackable(25)
            .consumable(8.0, 12.0, 8.0)
            .stamina_gain(6.0)
            .cookable(20.0, "Burnt Lingonberries")
            .respawn_time(240)
            .build(),

        ItemBuilder::new("Burnt Lingonberries", "Overcooked lingonberries. Vitamins destroyed and taste ruined, but can be processed into charcoal.", ItemCategory::Consumable)
            .icon("burnt_lingonberries.png")
            .stackable(25)
            .consumable(-2.0, 2.0, -4.0)
            .crafting_output(6, 0)
            .cookable(25.0, "Charcoal")
            .respawn_time(45)
            .build(),

        ItemBuilder::new("Cloudberries", "Rare orange berries with a complex sweet-tart flavor. Highly prized for their exceptional nutritional value.", ItemCategory::Consumable)
            .icon("cloudberries.png")
            .stackable(20)
            .consumable(12.0, 15.0, 12.0)
            .stamina_gain(10.0)
            .cookable(22.0, "Burnt Cloudberries")
            .respawn_time(360)
            .build(),

        ItemBuilder::new("Burnt Cloudberries", "Charred cloudberries. The exceptional nutrition is lost to overcooking, but can be processed into charcoal.", ItemCategory::Consumable)
            .icon("burnt_cloudberries.png")
            .stackable(20)
            .consumable(-3.0, 3.0, -5.0)
            .crafting_output(8, 0)
            .cookable(28.0, "Charcoal")
            .respawn_time(50)
            .build(),

        ItemBuilder::new("Bilberries", "Small dark blue berries with intense flavor. Excellent source of antioxidants and natural sugars.", ItemCategory::Consumable)
            .icon("bilberries.png")
            .stackable(30)
            .consumable(6.0, 10.0, 6.0)
            .stamina_gain(8.0)
            .cookable(18.0, "Burnt Bilberries")
            .respawn_time(200)
            .build(),

        ItemBuilder::new("Burnt Bilberries", "Overcooked bilberries. Dark and bitter, antioxidants destroyed by heat.", ItemCategory::Consumable)
            .icon("burnt_bilberries.png")
            .stackable(30)
            .consumable(-2.0, 2.0, -3.0)
            .crafting_output(5, 0)
            .cookable(22.0, "Charcoal")
            .respawn_time(40)
            .build(),

        ItemBuilder::new("Wild Strawberries", "Tiny but intensely flavored wild strawberries. Much more aromatic than cultivated varieties.", ItemCategory::Consumable)
            .icon("wild_strawberries.png")
            .stackable(35)
            .consumable(5.0, 8.0, 5.0)
            .stamina_gain(5.0)
            .cookable(15.0, "Burnt Wild Strawberries")
            .respawn_time(180)
            .build(),

        ItemBuilder::new("Burnt Wild Strawberries", "Charred wild strawberries. The delicate flavor is completely destroyed by overcooking.", ItemCategory::Consumable)
            .icon("burnt_wild_strawberries.png")
            .stackable(35)
            .consumable(-1.0, 1.0, -2.0)
            .crafting_output(4, 0)
            .cookable(20.0, "Charcoal")
            .respawn_time(35)
            .build(),

        ItemBuilder::new("Rowan Berries", "Bright red berries with a bitter, astringent taste. Traditionally used for jellies and preserves.", ItemCategory::Consumable)
            .icon("rowan_berries.png")
            .stackable(25)
            .consumable(4.0, 6.0, 3.0)
            .stamina_gain(4.0)
            .cookable(18.0, "Burnt Rowan Berries")
            .respawn_time(220)
            .build(),

        ItemBuilder::new("Burnt Rowan Berries", "Charred rowan berries. Already bitter when raw, they're nearly inedible when burnt.", ItemCategory::Consumable)
            .icon("burnt_rowan_berries.png")
            .stackable(25)
            .consumable(-2.0, 1.0, -4.0)
            .crafting_output(5, 0)
            .cookable(22.0, "Charcoal")
            .respawn_time(40)
            .build(),

        ItemBuilder::new("Cranberries", "Tart, sour red berries. Rich in vitamin C and natural preservatives. Excellent for long-term storage.", ItemCategory::Consumable)
            .icon("cranberries.png")
            .stackable(25)
            .consumable(6.0, 8.0, 6.0)
            .stamina_gain(6.0)
            .cookable(20.0, "Burnt Cranberries")
            .respawn_time(250)
            .build(),

        ItemBuilder::new("Burnt Cranberries", "Overcooked cranberries. The natural preservatives can't save them from being ruined by excess heat.", ItemCategory::Consumable)
            .icon("burnt_cranberries.png")
            .stackable(25)
            .consumable(-2.0, 2.0, -3.0)
            .crafting_output(6, 0)
            .cookable(25.0, "Charcoal")
            .respawn_time(45)
            .build(),



        // === TOXIC/MEDICINAL ===
        ItemBuilder::new("Mandrake Root", "Mystical root with powerful but dangerous properties. Used in traditional medicine but highly toxic if misused.", ItemCategory::Consumable)
            .icon("mandrake_root.png")
            .stackable(5)
            .consumable(-10.0, 3.0, -15.0)
            .stamina_gain(20.0)
            .cookable(50.0, "Burnt Mandrake Root")
            .respawn_time(480)
            .build(),

        ItemBuilder::new("Burnt Mandrake Root", "Charred mandrake root. Medicinal properties destroyed, toxicity reduced but still harmful.", ItemCategory::Consumable)
            .icon("burnt_mandrake_root.png")
            .stackable(5)
            .consumable(-5.0, 1.0, -8.0)
            .stamina_gain(5.0)
            .crafting_output(15, 0)
            .cookable(55.0, "Charcoal")
            .respawn_time(85)
            .build(),

        ItemBuilder::new("Belladonna", "Beautiful but deadly nightshade berries. Extremely toxic. Even small amounts can be lethal.", ItemCategory::Consumable)
            .icon("belladonna.png")
            .stackable(8)
            .consumable(-20.0, 2.0, -25.0)
            .stamina_gain(-15.0)
            .cookable(35.0, "Burnt Belladonna")
            .respawn_time(520)
            .build(),

        ItemBuilder::new("Burnt Belladonna", "Charred nightshade berries. Still toxic even when burnt. Can be processed into charcoal.", ItemCategory::Consumable)
            .icon("burnt_belladonna.png")
            .stackable(8)
            .consumable(-10.0, 1.0, -12.0)
            .stamina_gain(-8.0)
            .crafting_output(12, 0)
            .cookable(45.0, "Charcoal")
            .respawn_time(95)
            .build(),

        ItemBuilder::new("Henbane", "Toxic plant with powerful psychoactive properties. Historically used in small doses for medicine, but dangerous.", ItemCategory::Consumable)
            .icon("henbane.png")
            .stackable(10)
            .consumable(-12.0, 3.0, -18.0)
            .stamina_gain(-8.0)
            .cookable(40.0, "Burnt Henbane")
            .respawn_time(420)
            .build(),

        ItemBuilder::new("Burnt Henbane", "Charred henbane. Psychoactive compounds mostly destroyed but still mildly toxic.", ItemCategory::Consumable)
            .icon("burnt_henbane.png")
            .stackable(10)
            .consumable(-6.0, 1.0, -9.0)
            .stamina_gain(-3.0)
            .crafting_output(10, 0)
            .cookable(42.0, "Charcoal")
            .respawn_time(75)
            .build(),

        ItemBuilder::new("Datura", "Trumpet-shaped flowers and seeds containing powerful alkaloids. Extremely dangerous hallucinogen.", ItemCategory::Consumable)
            .icon("datura.png")
            .stackable(6)
            .consumable(-18.0, 2.0, -30.0)
            .stamina_gain(-12.0)
            .cookable(45.0, "Burnt Datura")
            .respawn_time(560)
            .build(),

        ItemBuilder::new("Burnt Datura", "Charred datura seeds and flowers. Hallucinogenic properties reduced but still dangerous.", ItemCategory::Consumable)
            .icon("burnt_datura.png")
            .stackable(6)
            .consumable(-9.0, 1.0, -15.0)
            .stamina_gain(-6.0)
            .crafting_output(14, 0)
            .cookable(48.0, "Charcoal")
            .respawn_time(100)
            .build(),

        ItemBuilder::new("Wolfsbane", "Highly toxic plant also known as aconite. Beautiful purple flowers hide deadly poison. Avoid consumption.", ItemCategory::Consumable)
            .icon("wolfsbane.png")
            .stackable(8)
            .consumable(-22.0, 1.0, -35.0)
            .stamina_gain(-18.0)
            .cookable(50.0, "Burnt Wolfsbane")
            .respawn_time(600)
            .build(),

        ItemBuilder::new("Burnt Wolfsbane", "Charred wolfsbane flowers. Still contains dangerous toxins even when burnt.", ItemCategory::Consumable)
            .icon("burnt_wolfsbane.png")
            .stackable(8)
            .consumable(-11.0, 1.0, -18.0)
            .stamina_gain(-9.0)
            .crafting_output(16, 0)
            .cookable(52.0, "Charcoal")
            .respawn_time(105)
            .build(),

    ]
}
