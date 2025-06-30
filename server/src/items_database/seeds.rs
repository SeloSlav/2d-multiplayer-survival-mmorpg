use super::builders::{ItemBuilder, basic_seed};
use crate::items::{ItemDefinition, ItemCategory};

pub fn get_seed_definitions() -> Vec<ItemDefinition> {
    vec![
        // === EXISTING SEEDS ===
        // Migrated from original items_database.rs - only existing seeds, no new plant types

        // Seed Potato - Rare, valuable food crop
        ItemBuilder::new("Seed Potato", "Seeds for planting potatoes. Can be deployed to grow potato plants.", ItemCategory::Placeable)
            .icon("seed_potato.png")
            .stackable(20)
            .respawn_time(900) // 15 minutes - rare seeds
            .build(),

        // Corn Seeds - Long-term valuable crop
        ItemBuilder::new("Corn Seeds", "Seeds for planting corn. Can be deployed to grow corn stalks.", ItemCategory::Placeable)
            .icon("corn_seeds.png")
            .stackable(20)
            .respawn_time(1200) // 20 minutes - valuable crop seeds
            .build(),

        // Boreal Nettle Seeds - Converted from Hemp Seeds (faster growing fiber crop)
        ItemBuilder::new("Boreal Nettle Seeds", "Seeds for planting boreal nettle. Can be deployed to grow nettle plants for fiber and medicinal leaves.", ItemCategory::Placeable)
            .icon("nettle_seeds.png") // Updated icon name
            .stackable(30)
            .respawn_time(600) // 10 minutes - common fiber crop
            .build(),

        // Pumpkin Seeds - Large, slow-growing crop
        ItemBuilder::new("Pumpkin Seeds", "Large seeds for planting pumpkins. Can be deployed to grow pumpkin vines.", ItemCategory::Placeable)
            .icon("pumpkin_seeds.png")
            .stackable(10)
            .respawn_time(1800) // 30 minutes - large, valuable crop
            .build(),

        // Reed Rhizome - Water-specific plant propagation
        ItemBuilder::new("Reed Rhizome", "Root cutting from reed plants. Can be deployed to grow reed stalks near water.", ItemCategory::Placeable)
            .icon("reed_rhizome.png")
            .stackable(15)
            .respawn_time(720) // 12 minutes - useful for water tools
            .build(),

        // Note: Mushroom Spores excluded - we removed Mushroom plant type in favor of specific mushroom varieties
    ]
}
