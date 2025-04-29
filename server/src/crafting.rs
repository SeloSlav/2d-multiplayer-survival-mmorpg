/*
 * server/src/crafting.rs
 *
 * Purpose: Defines crafting recipes and related data structures.
 */

use spacetimedb::{SpacetimeType, Table, ReducerContext};
use crate::items::ItemDefinition;
use crate::items::item_definition as ItemDefinitionTableTrait;

// Represents a single ingredient required for a recipe
#[derive(Clone, Debug, PartialEq, SpacetimeType)]
pub struct RecipeIngredient {
    pub item_def_id: u64, // ID of the required ItemDefinition
    pub quantity: u32,
}

// Defines a crafting recipe
#[spacetimedb::table(name = recipe, public)]
#[derive(Clone, Debug)]
pub struct Recipe {
    #[primary_key]
    #[auto_inc]
    pub recipe_id: u64,
    pub output_item_def_id: u64, // ID of the ItemDefinition crafted
    pub output_quantity: u32,    // How many items are crafted
    pub ingredients: Vec<RecipeIngredient>, // List of required ingredients
    pub crafting_time_secs: u32, // Time in seconds to craft
    // pub required_station: Option<String>, // Future extension: e.g., "Workbench"
}

// Function to get the initial set of recipes data (before resolving IDs)
// Returns: Vec<(Output Item Name, Output Qty, Vec<(Ingredient Name, Ingredient Qty)>, Crafting Time Secs)>
pub fn get_initial_recipes_data() -> Vec<(String, u32, Vec<(String, u32)>, u32)> {
    vec![
        // Output Name, Output Qty, Ingredients (Name, Qty), Time
        
        // Rock (Cost: 1 Stone, Time: 1s)
        ("Rock".to_string(), 1, vec![("Stone".to_string(), 1)], 1),
  
        // Stone Hatchet (Cost: 75 Wood, 150 Stone, Time: 20s)
        ("Stone Hatchet".to_string(), 1, vec![("Wood".to_string(), 75), ("Stone".to_string(), 150)], 20),
  
        // Stone Pickaxe (Cost: 75 Wood, 150 Stone, Time: 20s)
        ("Stone Pickaxe".to_string(), 1, vec![("Wood".to_string(), 75), ("Stone".to_string(), 150)], 20),
  
        // Camp Fire (Cost: 50 Wood, 5 Stone, Time: 10s)
        ("Camp Fire".to_string(), 1, vec![("Wood".to_string(), 50), ("Stone".to_string(), 5)], 10),
  
        // Wooden Storage Box (Cost: 100 Wood, Time: 15s)
        ("Wooden Storage Box".to_string(), 1, vec![("Wood".to_string(), 100)], 15),

        // Sleeping Bag (Cost: 50 Wood, Time: 15s) - Placeholder cost
        ("Sleeping Bag".to_string(), 1, vec![("Wood".to_string(), 100)], 15),
    ]
}

/// Seeds the Recipe table if it's empty.
#[spacetimedb::reducer]
pub fn seed_recipes(ctx: &ReducerContext) -> Result<(), String> {
    let recipe_table = ctx.db.recipe();
    if recipe_table.iter().count() > 0 {
        log::info!("Recipes already seeded. Skipping.");
        return Ok(());
    }

    log::info!("Seeding recipes...");
    let item_defs_table = ctx.db.item_definition();
    let initial_recipes_data = get_initial_recipes_data();

    // Helper closure to find ItemDefinition ID by name
    let find_def_id = |name: &str| -> Result<u64, String> {
        item_defs_table.iter()
            .find(|def| def.name == name)
            .map(|def| def.id)
            .ok_or_else(|| format!("Failed to find ItemDefinition for '{}'", name))
    };

    for (output_name, output_qty, ingredients_data, time_secs) in initial_recipes_data {
        // Resolve output item ID
        let output_def_id = find_def_id(&output_name)?;

        // Resolve ingredient item IDs
        let mut resolved_ingredients = Vec::new();
        for (ingredient_name, ingredient_qty) in ingredients_data {
            let ingredient_def_id = find_def_id(&ingredient_name)?;
            resolved_ingredients.push(RecipeIngredient {
                item_def_id: ingredient_def_id,
                quantity: ingredient_qty,
            });
        }

        // Create the recipe struct
        let recipe = Recipe {
            recipe_id: 0, // Auto-incremented
            output_item_def_id: output_def_id,
            output_quantity: output_qty,
            ingredients: resolved_ingredients,
            crafting_time_secs: time_secs,
        };

        // Insert the resolved recipe
        log::debug!("Inserting recipe for: {}", output_name);
        recipe_table.insert(recipe);
    }

    log::info!("Finished seeding recipes.");
    Ok(())
}
