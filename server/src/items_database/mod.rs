mod builders;
mod weapons;
mod tools;
mod consumables;
mod materials;
mod seeds;
mod armor;
mod placeables;
mod ammunition;

use crate::items::ItemDefinition;

pub fn get_initial_item_definitions() -> Vec<ItemDefinition> {
    let mut items = Vec::new();
    
    // Combine all category definitions
    items.extend(weapons::get_weapon_definitions());
    items.extend(tools::get_tool_definitions());
    items.extend(consumables::get_consumable_definitions());
    items.extend(materials::get_material_definitions());
    items.extend(seeds::get_seed_definitions());
    items.extend(armor::get_armor_definitions());
    items.extend(placeables::get_placeable_definitions());
    items.extend(ammunition::get_ammunition_definitions());
    
    items
}
