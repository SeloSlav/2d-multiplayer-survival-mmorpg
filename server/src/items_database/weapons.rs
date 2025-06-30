use super::builders::{ItemBuilder, basic_weapon};
use crate::items::{ItemDefinition, ItemCategory, CostIngredient};
use crate::models::TargetType;

pub fn get_weapon_definitions() -> Vec<ItemDefinition> {
    vec![
        // === SOVIET MILITARY WEAPONS (BARREL LOOT) ===
        // High-tier weapons found only in barrels, not craftable

        // Naval Cutlass - Ceremonial sword, highest single-hit damage
        ItemBuilder::new("Naval Cutlass", "A ceremonial naval sword from the old Soviet Pacific Fleet. Tarnished but still deadly sharp. Slower strikes but devastating damage.", ItemCategory::Weapon)
            .icon("naval_cutlass.png")
            .weapon(48, 52, 1.0) // Highest melee damage, slow deliberate strikes
            .bleed_effect(3.0, 12.0, 1.0) // Standard bleed, longer duration
            .build(),

        // AK74 Bayonet - Fast, precise military blade
        ItemBuilder::new("AK74 Bayonet", "A detached bayonet from an AK-74 rifle. Compact, balanced, and brutally effective in close combat. Lightning-fast strikes with vicious bleeding.", ItemCategory::Weapon)
            .icon("soviet_bayonet.png")
            .weapon(30, 34, 0.55) // Lower per-hit damage, FASTEST weapon
            .bleed_effect(4.0, 12.0, 1.0) // High bleed damage, long duration
            .build(),

        // Engineers Maul - Heavy demolition hammer
        ItemBuilder::new("Engineers Maul", "A heavy demolition hammer used by Soviet military engineers. Built for breaking through concrete and steel, it's devastatingly effective in combat.", ItemCategory::Weapon)
            .icon("engineers_maul.png")
            .weapon(40, 45, 0.85) // High damage, slow but powerful
            .bleed_effect(2.5, 10.0, 1.0) // Moderate bleed
            .build(),

        // Military Crowbar - Ultimate blunt weapon
        ItemBuilder::new("Military Crowbar", "A heavy-duty crowbar from Soviet military engineering corps. Built for breaching and demolition, it delivers devastating blows in combat.", ItemCategory::Weapon)
            .icon("military_crowbar.png")
            .weapon(55, 60, 1.2) // HIGHEST damage in game, SLOWEST weapon
            .bleed_effect(1.5, 8.0, 1.0) // Lower bleed (blunt force trauma)
            .build(),

        // === IMPROVISED/GRIM WEAPONS ===
        // Makeshift weapons with unique characteristics

        // Human Skull - Grim improvised weapon
        ItemBuilder::new("Human Skull", "The surprisingly intact skull of a former human. Grim, but effective in a pinch.", ItemCategory::Weapon)
            .icon("skull.png")
            .weapon(30, 30, 2.0) // Fixed damage, very slow
            .build(),

        // Fox Skull - Light but cunning weapon
        ItemBuilder::new("Fox Skull", "A fox skull. A trophy from a successful hunt, and proof of your prowess against cunning prey. Lighter than other skulls.", ItemCategory::Weapon)
            .icon("fox_skull.png")
            .stackable(10)
            .weapon(25, 25, 1.8) // Lighter/faster than human skull
            .build(),

        // Wolf Skull - Fierce predator weapon
        ItemBuilder::new("Wolf Skull", "A wolf skull. A fearsome trophy from a dangerous hunt, showing your ability to defeat apex predators. Heavy and intimidating.", ItemCategory::Weapon)
            .icon("wolf_skull.png")
            .stackable(10)
            .weapon(35, 35, 2.2) // Stronger but slower than human skull
            .build(),

        // Viper Skull - Venomous weapon with bleed effect
        ItemBuilder::new("Viper Skull", "A viper skull with intact fangs. A deadly trophy that proves your survival against venomous predators. The fangs still carry traces of venom.", ItemCategory::Weapon)
            .icon("viper_skull.png")
            .stackable(10)
            .weapon(28, 28, 1.9) // Moderate damage and speed
            .bleed_effect(2.0, 6.0, 1.0) // Venom effect - moderate bleed
            .build(),

        // === CRAFTABLE SPEARS ===
        // Ranged melee weapons with reach advantage

        // Wooden Spear - Basic spear, longest reach
        ItemBuilder::new("Wooden Spear", "A sharpened stick. Better than throwing rocks.", ItemCategory::Weapon)
            .icon("spear.png")
            .weapon(25, 25, 1.5) // Fixed moderate damage, very slow due to reach
            .bleed_effect(2.0, 8.0, 1.0) // Standard bleed
            .crafting_cost(vec![
                CostIngredient { item_name: "Wood".to_string(), quantity: 300 },
            ])
            .crafting_output(1, 30)
            .respawn_time(300)
            .build(),

        // Stone Spear - Improved spear with stone tip
        ItemBuilder::new("Stone Spear", "A basic spear tipped with sharpened stone. Has a longer reach and causes bleeding.", ItemCategory::Weapon)
            .icon("stone_spear.png")
            .weapon(35, 35, 1.3) // Fixed higher damage, slow but faster than wooden spear
            .bleed_effect(3.0, 8.0, 1.0) // Better bleed
            .crafting_cost(vec![
                CostIngredient { item_name: "Wood".to_string(), quantity: 300 },
                CostIngredient { item_name: "Stone".to_string(), quantity: 100 },
            ])
            .crafting_output(1, 30)
            .respawn_time(420)
            .build(),

        // === RANGED WEAPONS ===
        // Projectile-firing weapons that use ammunition

        // Hunting Bow - Basic ranged weapon
        ItemBuilder::new("Hunting Bow", "A sturdy wooden bow for hunting game and self-defense. Requires arrows to fire.", ItemCategory::RangedWeapon)
            .icon("bow.png")
            .stackable(1)
            .weapon(50, 50, 0.0) // 50 base damage, no melee speed (ranged only)
            .equippable(None) // RangedWeapons are equippable
            .crafting_cost(vec![
                CostIngredient { item_name: "Wood".to_string(), quantity: 400 },
                CostIngredient { item_name: "Plant Fiber".to_string(), quantity: 50 },
                CostIngredient { item_name: "Rope".to_string(), quantity: 2 },
            ])
            .crafting_output(1, 60)
            .respawn_time(900)
            .build(),

        // Crossbow - Advanced ranged weapon
        ItemBuilder::new("Crossbow", "A mechanical crossbow with superior accuracy and power. Fires bolts in straight lines with minimal gravity effect.", ItemCategory::RangedWeapon)
            .icon("crossbow.png")
            .stackable(1)
            .weapon(75, 75, 0.0) // 75 base damage, no melee speed (ranged only)
            .equippable(None) // RangedWeapons are equippable
            .crafting_cost(vec![
                CostIngredient { item_name: "Wood".to_string(), quantity: 600 },
                CostIngredient { item_name: "Metal Fragments".to_string(), quantity: 150 },
                CostIngredient { item_name: "Rope".to_string(), quantity: 3 },
                CostIngredient { item_name: "Cloth".to_string(), quantity: 20 },
            ])
            .crafting_output(1, 120)
            .respawn_time(1200)
            .build(),
    ]
}
