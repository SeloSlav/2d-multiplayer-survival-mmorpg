use crate::items::{ItemDefinition, ItemCategory, CostIngredient};
use crate::models::{EquipmentSlotType, TargetType};

pub struct ItemBuilder {
    inner: ItemDefinition,
}

impl ItemBuilder {
    pub fn new(name: &str, description: &str, category: ItemCategory) -> Self {
        Self {
            inner: ItemDefinition {
                id: 0, // Will be auto-generated
                name: name.to_string(),
                description: description.to_string(),
                category,
                icon_asset_name: String::new(), // Will be set with .icon()
                is_stackable: false,
                stack_size: 1,
                is_equippable: false,
                equipment_slot_type: None,
                fuel_burn_duration_secs: None,
                primary_target_damage_min: None,
                primary_target_damage_max: None,
                primary_target_yield_min: None,
                primary_target_yield_max: None,
                primary_target_type: None,
                primary_yield_resource_name: None,
                pvp_damage_min: None,
                pvp_damage_max: None,
                bleed_damage_per_tick: None,
                bleed_duration_seconds: None,
                bleed_tick_interval_seconds: None,
                crafting_cost: None,
                crafting_output_quantity: None,
                crafting_time_secs: None,
                consumable_health_gain: None,
                consumable_hunger_satiated: None,
                consumable_thirst_quenched: None,
                consumable_duration_secs: None,
                cook_time_secs: None,
                cooked_item_def_name: None,
                damage_resistance: None,
                warmth_bonus: None,
                respawn_time_seconds: None,
                attack_interval_secs: None,
            }
        }
    }
    
    pub fn icon(mut self, icon_name: &str) -> Self {
        self.inner.icon_asset_name = icon_name.to_string();
        self
    }
    
    pub fn stackable(mut self, stack_size: u32) -> Self {
        self.inner.is_stackable = true;
        self.inner.stack_size = stack_size;
        self
    }
    
    pub fn equippable(mut self, equipment_slot: Option<EquipmentSlotType>) -> Self {
        self.inner.is_equippable = true;
        self.inner.equipment_slot_type = equipment_slot;
        self
    }
    
    pub fn fuel(mut self, burn_duration: f32) -> Self {
        self.inner.fuel_burn_duration_secs = Some(burn_duration);
        self
    }
    
    pub fn consumable(mut self, health: f32, hunger: f32, thirst: f32) -> Self {
        self.inner.consumable_health_gain = Some(health);
        self.inner.consumable_hunger_satiated = Some(hunger);
        self.inner.consumable_thirst_quenched = Some(thirst);
        self
    }
    

    
    pub fn consumable_duration(mut self, duration: f32) -> Self {
        self.inner.consumable_duration_secs = Some(duration);
        self
    }
    
    pub fn primary_target_damage(mut self, min: u32, max: u32) -> Self {
        self.inner.primary_target_damage_min = Some(min);
        self.inner.primary_target_damage_max = Some(max);
        self
    }
    
    pub fn pvp_damage(mut self, min: u32, max: u32) -> Self {
        self.inner.pvp_damage_min = Some(min);
        self.inner.pvp_damage_max = Some(max);
        self
    }
    
    pub fn primary_target(mut self, target_type: TargetType, yield_min: u32, yield_max: u32, resource_name: &str) -> Self {
        self.inner.primary_target_type = Some(target_type);
        self.inner.primary_target_yield_min = Some(yield_min);
        self.inner.primary_target_yield_max = Some(yield_max);
        self.inner.primary_yield_resource_name = Some(resource_name.to_string());
        self
    }
    
    pub fn bleed_effect(mut self, damage_per_tick: f32, duration: f32, tick_interval: f32) -> Self {
        self.inner.bleed_damage_per_tick = Some(damage_per_tick);
        self.inner.bleed_duration_seconds = Some(duration);
        self.inner.bleed_tick_interval_seconds = Some(tick_interval);
        self
    }
    
    pub fn crafting_cost(mut self, ingredients: Vec<CostIngredient>) -> Self {
        self.inner.crafting_cost = Some(ingredients);
        self
    }
    
    pub fn crafting_output(mut self, quantity: u32, time_secs: u32) -> Self {
        self.inner.crafting_output_quantity = Some(quantity);
        self.inner.crafting_time_secs = Some(time_secs);
        self
    }
    
    pub fn cook_time(mut self, time_secs: f32) -> Self {
        self.inner.cook_time_secs = Some(time_secs);
        self
    }
    
    pub fn cooked_item(mut self, cooked_item_name: &str) -> Self {
        self.inner.cooked_item_def_name = Some(cooked_item_name.to_string());
        self
    }
    
    pub fn armor(mut self, damage_resistance: f32, warmth_bonus: Option<f32>) -> Self {
        self.inner.damage_resistance = Some(damage_resistance);
        self.inner.warmth_bonus = warmth_bonus;
        self
    }
    
    pub fn respawn_time(mut self, seconds: u32) -> Self {
        self.inner.respawn_time_seconds = Some(seconds);
        self
    }
    
        pub fn attack_interval(mut self, interval_secs: f32) -> Self {
        self.inner.attack_interval_secs = Some(interval_secs);
        self
    }

    pub fn warmth_bonus(mut self, warmth: f32) -> Self {
        self.inner.warmth_bonus = Some(warmth);
        self
    }

    pub fn primary_target_yield(mut self, min: u32, max: u32) -> Self {
        self.inner.primary_target_yield_min = Some(min);
        self.inner.primary_target_yield_max = Some(max);
        self
    }

    pub fn primary_target_type(mut self, target_type: TargetType) -> Self {
        self.inner.primary_target_type = Some(target_type);
        self
    }

    pub fn primary_yield_resource(mut self, resource_name: &str) -> Self {
        self.inner.primary_yield_resource_name = Some(resource_name.to_string());
        self
    }

    pub fn weapon(mut self, min_dmg: u32, max_dmg: u32, attack_speed: f32) -> Self {
        self.inner.pvp_damage_min = Some(min_dmg);
        self.inner.pvp_damage_max = Some(max_dmg);
        self.inner.attack_interval_secs = Some(attack_speed);
        self.inner.is_equippable = true;
        self.inner.equipment_slot_type = None; // Tools don't use equipment slots
        self
    }

    pub fn cookable(mut self, cook_time: f32, cooked_item: &str) -> Self {
        self.inner.cook_time_secs = Some(cook_time);
        self.inner.cooked_item_def_name = Some(cooked_item.to_string());
        self
    }

    pub fn crafting_time(mut self, time_secs: u32) -> Self {
        // This was used in old system as separate from crafting_output time
        // We'll just adjust the existing crafting_time_secs
        self.inner.crafting_time_secs = Some(time_secs);
        self
    }

    pub fn build(self) -> ItemDefinition {
        self.inner
    }
}

// Helper functions for common item patterns
pub fn basic_tool(name: &str, description: &str, target_type: TargetType, 
                  damage_min: u32, damage_max: u32, yield_min: u32, yield_max: u32, 
                  resource_name: &str) -> ItemBuilder {
    ItemBuilder::new(name, description, ItemCategory::Tool)
        .equippable(None)
        .primary_target_damage(damage_min, damage_max)
        .primary_target(target_type, yield_min, yield_max, resource_name)
}

pub fn basic_material(name: &str, description: &str, stack_size: u32) -> ItemBuilder {
    ItemBuilder::new(name, description, ItemCategory::Material)
        .stackable(stack_size)
}

pub fn basic_consumable(name: &str, description: &str, stack_size: u32, 
                       health: f32, hunger: f32, thirst: f32) -> ItemBuilder {
    ItemBuilder::new(name, description, ItemCategory::Consumable)
        .stackable(stack_size)
        .consumable(health, hunger, thirst)
}

pub fn basic_weapon(name: &str, description: &str, pvp_min: u32, pvp_max: u32, 
                   attack_interval: f32) -> ItemBuilder {
    ItemBuilder::new(name, description, ItemCategory::Weapon)
        .equippable(None)
        .pvp_damage(pvp_min, pvp_max)
        .attack_interval(attack_interval)
}

pub fn basic_armor(name: &str, description: &str, slot: EquipmentSlotType, 
                  damage_resistance: f32, warmth: Option<f32>) -> ItemBuilder {
    ItemBuilder::new(name, description, ItemCategory::Armor)
        .equippable(Some(slot))
        .armor(damage_resistance, warmth)
}

pub fn basic_ammunition(name: &str, description: &str, stack_size: u32, 
                       damage_modifier_min: u32, damage_modifier_max: u32) -> ItemBuilder {
    ItemBuilder::new(name, description, ItemCategory::Ammunition)
        .stackable(stack_size)
        .pvp_damage(damage_modifier_min, damage_modifier_max)
}

pub fn basic_placeable(name: &str, description: &str) -> ItemBuilder {
    ItemBuilder::new(name, description, ItemCategory::Placeable)
        .stackable(1)
}

pub fn basic_seed(name: &str, description: &str, stack_size: u32) -> ItemBuilder {
    ItemBuilder::new(name, description, ItemCategory::Material)
        .stackable(stack_size)
}
