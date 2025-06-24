/*
 * server/src/crafting.rs
 *
 * Purpose: Defines crafting recipes and related data structures.
 */

use spacetimedb::{SpacetimeType, Table, ReducerContext};
use crate::items::{ItemDefinition, ItemCategory};
use crate::models::{EquipmentSlotType, TargetType};
use crate::items::item_definition;
use crate::items::item_definition__TableHandle;

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
// REMOVED get_initial_recipes_data()

// Helper function to find ItemDefinition ID by name
// ACCEPTS A REFERENCE to the table handle now
fn find_def_id_by_name(name_to_find: &str, item_definitions_table: &item_definition__TableHandle) -> Result<u64, String> {
    item_definitions_table.iter() // .iter() works on &item_definition__TableHandle
        .find(|def| def.name == name_to_find)
        .map(|def| def.id)
        .ok_or_else(|| format!("Failed to find ItemDefinition for ingredient name '{}'", name_to_find))
}

/// Seeds the Recipe table if it's empty.
#[spacetimedb::reducer]
pub fn seed_recipes(ctx: &ReducerContext) -> Result<(), String> {
    let recipe_table = ctx.db.recipe();
    if recipe_table.iter().count() > 0 {
        // log::info!("Recipes already seeded. Skipping.");
        return Ok(());
    }

    // log::info!("Seeding recipes from ItemDefinitions...");
    let item_defs_table = ctx.db.item_definition();
    let mut recipes_created_count = 0;

    // item_defs_table.iter() takes &item_defs_table, so item_defs_table is borrowed for this loop
    for item_def_for_output in item_defs_table.iter() { 
        if let (Some(cost_ingredients), Some(output_qty), Some(time_secs)) = (
            &item_def_for_output.crafting_cost,
            item_def_for_output.crafting_output_quantity,
            item_def_for_output.crafting_time_secs,
        ) {
            if cost_ingredients.is_empty() {
                // log::debug!("Skipping item '{}' for recipe creation: crafting_cost is empty.", item_def_for_output.name);
                continue;
            }

            let mut resolved_ingredients_for_recipe = Vec::new();
            let mut ingredients_valid = true;
            for cost_ingredient in cost_ingredients {
                // Pass a reference to item_defs_table. This is fine as the original item_defs_table is still valid.
                match find_def_id_by_name(&cost_ingredient.item_name, &item_defs_table) { 
                    Ok(ingredient_def_id) => {
                        resolved_ingredients_for_recipe.push(RecipeIngredient {
                            item_def_id: ingredient_def_id,
                            quantity: cost_ingredient.quantity,
                        });
                    }
                    Err(e) => {
                        // log::error!("Error resolving ingredient '{}' for recipe '{}': {}. Skipping this recipe.", cost_ingredient.item_name, item_def_for_output.name, e);
                        ingredients_valid = false;
                        break;
                    }
                }
            }

            if ingredients_valid {
                let recipe = Recipe {
                    recipe_id: 0, // Auto-incremented
                    output_item_def_id: item_def_for_output.id,
                    output_quantity: output_qty,
                    ingredients: resolved_ingredients_for_recipe,
                    crafting_time_secs: time_secs,
                };

                // log::debug!("Inserting recipe for: {}", item_def_for_output.name);
                recipe_table.insert(recipe);
                recipes_created_count += 1;
            }
        } else {
            // log::debug!("Item '{}' does not have complete crafting information. Not creating recipe.", item_def_for_output.name);
        }
    }

    // log::info!("Finished seeding {} recipes from ItemDefinitions.", recipes_created_count);
    Ok(())
}
