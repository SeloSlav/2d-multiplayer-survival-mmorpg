use spacetimedb::{reducer, table, Identity, SpacetimeType, Timestamp, Table};
use crate::items::{InventoryItem, inventory_item, item_definition};

/// Represents a player's progress in the Memory Grid tech tree
#[table(name = memory_grid_progress, public)]
#[derive(Clone, Debug)]
pub struct MemoryGridProgress {
    #[primary_key]
    pub player_id: Identity,
    /// Comma-separated list of purchased node IDs (e.g., "center,pistol,barbecue")
    pub purchased_nodes: String,
    /// Total memory shards spent (for statistics/achievements)
    pub total_shards_spent: u64,
    /// Last updated timestamp
    pub last_updated: Timestamp,
}

/// Individual memory grid node purchase record for detailed tracking
#[table(name = memory_grid_purchases, public)]
#[derive(Clone, Debug)]
pub struct MemoryGridPurchase {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub player_id: Identity,
    pub node_id: String,
    pub node_name: String,
    pub cost: u64,
    pub purchased_at: Timestamp,
}

/// Get a player's current memory grid progress
pub fn get_player_memory_progress(ctx: &spacetimedb::ReducerContext, player_id: Identity) -> Option<MemoryGridProgress> {
    ctx.db.memory_grid_progress().player_id().find(&player_id).map(|p| p.clone())
}

/// Initialize memory grid progress for a new player
pub fn initialize_memory_grid_progress(ctx: &spacetimedb::ReducerContext, player_id: Identity) {
    // Check if player already has progress
    if ctx.db.memory_grid_progress().player_id().find(&player_id).is_some() {
        return; // Already initialized
    }
    
    // Create new progress with just the center node unlocked
    let progress = MemoryGridProgress {
        player_id,
        purchased_nodes: "center".to_string(), // Start with Neural Interface unlocked
        total_shards_spent: 0,
        last_updated: ctx.timestamp,
    };
    
    ctx.db.memory_grid_progress().insert(progress);
    spacetimedb::log::info!("Initialized memory grid progress for player {}", player_id);
}

/// Count memory shards in player's inventory
fn count_memory_shards_in_inventory(ctx: &spacetimedb::ReducerContext, player_id: Identity) -> u64 {
    let mut total_shards = 0u64;
    
    // Memory Shard item name from materials.rs
    let memory_shard_name = "Memory Shard";
    
    // First, find the item definition ID for Memory Shard
    let memory_shard_def_id = ctx.db.item_definition().iter()
        .find(|def| def.name == memory_shard_name)
        .map(|def| def.id);
    
    if let Some(def_id) = memory_shard_def_id {
        // Query all inventory items for this player
        for inventory_item in ctx.db.inventory_item().iter() {
            if let Some(owner) = inventory_item.location.is_player_bound() {
                if owner == player_id && inventory_item.item_def_id == def_id {
                    total_shards += inventory_item.quantity as u64;
                }
            }
        }
    }
    
    total_shards
}

/// Remove memory shards from player's inventory
fn consume_memory_shards(ctx: &spacetimedb::ReducerContext, player_id: Identity, amount: u64) -> Result<(), String> {
    let mut remaining_to_consume = amount;
    let mut items_to_update = Vec::new();
    let mut items_to_delete = Vec::new();
    
    // Memory Shard item name from materials.rs
    let memory_shard_name = "Memory Shard";
    
    // First, find the item definition ID for Memory Shard
    let memory_shard_def_id = ctx.db.item_definition().iter()
        .find(|def| def.name == memory_shard_name)
        .map(|def| def.id);
    
    if let Some(def_id) = memory_shard_def_id {
        // Find all memory shard stacks in inventory
        for inventory_item in ctx.db.inventory_item().iter() {
            if let Some(owner) = inventory_item.location.is_player_bound() {
                if owner == player_id && 
                   inventory_item.item_def_id == def_id && 
                   remaining_to_consume > 0 {
                    
                    if inventory_item.quantity as u64 >= remaining_to_consume {
                        // This stack has enough to complete the consumption
                        let new_quantity = inventory_item.quantity as u64 - remaining_to_consume;
                        if new_quantity == 0 {
                            items_to_delete.push(inventory_item.instance_id);
                        } else {
                            let mut updated_item = inventory_item.clone();
                            updated_item.quantity = new_quantity as u32;
                            items_to_update.push(updated_item);
                        }
                        remaining_to_consume = 0;
                        break;
                    } else {
                        // Consume entire stack
                        remaining_to_consume -= inventory_item.quantity as u64;
                        items_to_delete.push(inventory_item.instance_id);
                    }
                }
            }
        }
    }
    
    if remaining_to_consume > 0 {
        return Err(format!("Insufficient memory shards. Need {} more.", remaining_to_consume));
    }
    
    // Apply the changes
    for item in items_to_update {
        ctx.db.inventory_item().instance_id().update(item);
    }
    
    for item_id in items_to_delete {
        ctx.db.inventory_item().instance_id().delete(&item_id);
    }
    
    Ok(())
}

/// Check if a node is available for purchase based on prerequisites
fn is_node_available(purchased_nodes: &str, node_id: &str, prerequisites: &[&str]) -> bool {
    if purchased_nodes.contains(node_id) {
        return false; // Already purchased
    }
    
    // Special case: Faction unlock nodes need ANY ONE tier 5 node
    if node_id.starts_with("unlock-") {
        let tier5_nodes = ["plasma-rifle", "automated-harvester", "teleporter", "mobile-shield", "drone-swarm", "fortified-bunker"];
        return tier5_nodes.iter().any(|tier5_node| purchased_nodes.contains(tier5_node));
    }
    
    // FFX-style logic: Need ANY ONE prerequisite (OR logic)
    prerequisites.iter().any(|prereq| purchased_nodes.contains(prereq))
}

/// Get the cost and prerequisites for a specific node ID
fn get_node_info(node_id: &str) -> Option<(u64, Vec<&'static str>)> {
    match node_id {
        // Center node (free)
        "center" => Some((0, vec![])),
        
        // Tier 1 nodes (100-280 shards)
        "pistol" => Some((200, vec!["center"])),
        "barbecue" => Some((220, vec!["center"])),
        "binoculars" => Some((180, vec!["center"])),
        "lockpick-set" => Some((250, vec!["center"])),
        "large-backpack" => Some((280, vec!["center"])),
        "mining-efficiency" => Some((200, vec!["center"])),
        
        // Tier 2 nodes (420-520 shards)
        "hunting-rifle" => Some((450, vec!["pistol", "mining-efficiency", "barbecue"])),
        "refrigerator" => Some((480, vec!["barbecue", "pistol", "binoculars"])),
        "security-cameras" => Some((420, vec!["binoculars", "barbecue", "lockpick-set"])),
        "metal-detector" => Some((460, vec!["lockpick-set", "binoculars", "large-backpack"])),
        "landmines" => Some((520, vec!["large-backpack", "lockpick-set", "mining-efficiency"])),
        "kevlar-vest" => Some((450, vec!["mining-efficiency", "large-backpack", "pistol"])),
        
        // Tier 3 nodes (720-850 shards)
        "shotgun" => Some((800, vec!["hunting-rifle", "kevlar-vest", "refrigerator"])),
        "repair-table" => Some((750, vec!["refrigerator", "hunting-rifle", "security-cameras"])),
        "night-vision" => Some((720, vec!["security-cameras", "refrigerator", "metal-detector"])),
        "bear-traps" => Some((780, vec!["metal-detector", "security-cameras", "landmines"])),
        "c4-explosives" => Some((850, vec!["landmines", "metal-detector", "kevlar-vest"])),
        "military-armor" => Some((800, vec!["kevlar-vest", "landmines", "hunting-rifle"])),
        
        // Tier 4 nodes (1200-1400 shards)
        "assault-rifle" => Some((1300, vec!["shotgun", "military-armor", "repair-table"])),
        "radio-tower" => Some((1400, vec!["repair-table", "shotgun", "night-vision"])),
        "solar-panels" => Some((1250, vec!["night-vision", "repair-table", "bear-traps"])),
        "barricades" => Some((1200, vec!["bear-traps", "night-vision", "c4-explosives"])),
        "rocket-launcher" => Some((1400, vec!["c4-explosives", "bear-traps", "military-armor"])),
        "weapons-locker" => Some((1350, vec!["military-armor", "c4-explosives", "shotgun"])),
        
        // Tier 5 nodes (2000-2400 shards)
        "plasma-rifle" => Some((2200, vec!["assault-rifle", "weapons-locker", "radio-tower"])),
        "automated-harvester" => Some((2400, vec!["radio-tower", "assault-rifle", "solar-panels"])),
        "teleporter" => Some((2100, vec!["solar-panels", "radio-tower", "barricades"])),
        "mobile-shield" => Some((2000, vec!["barricades", "solar-panels", "rocket-launcher"])),
        "drone-swarm" => Some((2300, vec!["rocket-launcher", "barricades", "weapons-locker"])),
        "fortified-bunker" => Some((2250, vec!["weapons-locker", "rocket-launcher", "plasma-rifle"])),
        
        // Faction unlock nodes (2000 shards each)
        "unlock-black-wolves" => Some((2000, vec!["plasma-rifle", "automated-harvester", "teleporter", "mobile-shield", "drone-swarm", "fortified-bunker"])),
        "unlock-hive" => Some((2000, vec!["plasma-rifle", "automated-harvester", "teleporter", "mobile-shield", "drone-swarm", "fortified-bunker"])),
        "unlock-university" => Some((2000, vec!["plasma-rifle", "automated-harvester", "teleporter", "mobile-shield", "drone-swarm", "fortified-bunker"])),
        "unlock-data-angels" => Some((2000, vec!["plasma-rifle", "automated-harvester", "teleporter", "mobile-shield", "drone-swarm", "fortified-bunker"])),
        "unlock-battalion" => Some((2000, vec!["plasma-rifle", "automated-harvester", "teleporter", "mobile-shield", "drone-swarm", "fortified-bunker"])),
        "unlock-admiralty" => Some((2000, vec!["plasma-rifle", "automated-harvester", "teleporter", "mobile-shield", "drone-swarm", "fortified-bunker"])),
        
        // Faction branch nodes (3000-15000 shards) - Black Wolves
        "riot-vest" => Some((3000, vec!["unlock-black-wolves"])),
        "shock-pike" => Some((6000, vec!["riot-vest"])),
        "slab-shield" => Some((9000, vec!["shock-pike"])),
        "flash-hammer" => Some((12000, vec!["slab-shield"])),
        "adrenal-surge" => Some((15000, vec!["flash-hammer"])),
        "combat-stims" => Some((3000, vec!["unlock-black-wolves"])),
        "suppressor-rig" => Some((6000, vec!["combat-stims"])),
        "grav-boots" => Some((9000, vec!["suppressor-rig"])),
        "field-interrogator" => Some((12000, vec!["grav-boots"])),
        "armor-durability" => Some((15000, vec!["field-interrogator"])),
        
        // HIVE FACTION NODES
        "spore-grain-vat" => Some((3000, vec!["unlock-hive"])),
        "slime-furnace" => Some((6000, vec!["spore-grain-vat"])),
        "chameleon-harness" => Some((9000, vec!["slime-furnace"])),
        "mealworm-factory" => Some((12000, vec!["chameleon-harness"])),
        "crafting-speed" => Some((15000, vec!["mealworm-factory"])),
        "venom-knife" => Some((3000, vec!["unlock-hive"])),
        "poison-resistance" => Some((6000, vec!["venom-knife"])),
        "acid-sprayer" => Some((9000, vec!["poison-resistance"])),
        "toxic-coating" => Some((12000, vec!["acid-sprayer"])),
        "toxic-bloom" => Some((15000, vec!["toxic-coating"])),
        
        // UNIVERSITY FACTION NODES
        "auto-turret" => Some((3000, vec!["unlock-university"])),
        "scanner-drone" => Some((6000, vec!["auto-turret"])),
        "repair-swarm" => Some((9000, vec!["scanner-drone"])),
        "stabilizer-field" => Some((12000, vec!["repair-swarm"])),
        "fabricator-burst" => Some((15000, vec!["stabilizer-field"])),
        "logic-furnace" => Some((3000, vec!["unlock-university"])),
        "bioprinter-table" => Some((6000, vec!["logic-furnace"])),
        "geneforge-vat" => Some((9000, vec!["bioprinter-table"])),
        "mining-yield-ii" => Some((12000, vec!["geneforge-vat"])),
        "crafting-speed-uni" => Some((15000, vec!["mining-yield-ii"])),
        
        // DATA ANGELS FACTION NODES
        "jammer-tower" => Some((3000, vec!["unlock-data-angels"])),
        "ghost-uplink" => Some((6000, vec!["jammer-tower"])),
        "neurochef-decryptor" => Some((9000, vec!["ghost-uplink"])),
        "drone-hijack" => Some((12000, vec!["neurochef-decryptor"])),
        "hacking-speed" => Some((15000, vec!["drone-hijack"])),
        "backdoor-cloak" => Some((3000, vec!["unlock-data-angels"])),
        "signal-scrubber" => Some((6000, vec!["backdoor-cloak"])),
        "memory-leech" => Some((9000, vec!["signal-scrubber"])),
        "movement-speed" => Some((12000, vec!["memory-leech"])),
        "overclock" => Some((15000, vec!["movement-speed"])),
        
        // BATTALION FACTION NODES
        "battalion-smg" => Some((3000, vec!["unlock-battalion"])),
        "mortar-nest" => Some((6000, vec!["battalion-smg"])),
        "fragment-armor" => Some((9000, vec!["mortar-nest"])),
        "ammo-press-battalion" => Some((12000, vec!["fragment-armor"])),
        "ranged-damage" => Some((15000, vec!["ammo-press-battalion"])),
        "tactical-optics" => Some((3000, vec!["unlock-battalion"])),
        "supply-cache" => Some((6000, vec!["tactical-optics"])),
        "field-ration-kit" => Some((9000, vec!["supply-cache"])),
        "max-hp" => Some((12000, vec!["field-ration-kit"])),
        "rally-cry" => Some((15000, vec!["max-hp"])),
        
        // ADMIRALTY FACTION NODES
        "tide-beacon" => Some((3000, vec!["unlock-admiralty"])),
        "storm-sail-raft" => Some((6000, vec!["tide-beacon"])),
        "net-cannon" => Some((9000, vec!["storm-sail-raft"])),
        "luminous-buoy" => Some((12000, vec!["net-cannon"])),
        "naval-command" => Some((15000, vec!["luminous-buoy"])),
        "saltwater-desal" => Some((3000, vec!["unlock-admiralty"])),
        "weathercock-tower" => Some((6000, vec!["saltwater-desal"])),
        "weather-resistance" => Some((9000, vec!["weathercock-tower"])),
        "tide-gauge" => Some((12000, vec!["weather-resistance"])),
        "tempest-call" => Some((15000, vec!["tide-gauge"])),
        
        _ => None, // Unknown node
    }
}

/// Reducer: Purchase a memory grid node
#[reducer]
pub fn purchase_memory_grid_node(ctx: &spacetimedb::ReducerContext, node_id: String) -> Result<(), String> {
    let player_id = ctx.sender;
    
    // Get node info (cost and prerequisites)
    let (cost, prerequisites) = get_node_info(&node_id)
        .ok_or_else(|| format!("Unknown memory grid node: {}", node_id))?;
    
    // Get player's current progress
    let mut progress = ctx.db.memory_grid_progress()
        .player_id()
        .find(&player_id)
        .map(|p| p.clone())
        .unwrap_or_else(|| {
            // Initialize if not exists
            MemoryGridProgress {
                player_id,
                purchased_nodes: "center".to_string(),
                total_shards_spent: 0,
                last_updated: ctx.timestamp,
            }
        });
    
    // Check if node is available for purchase
    if !is_node_available(&progress.purchased_nodes, &node_id, &prerequisites) {
        return Err("Node is not available for purchase. Check prerequisites.".to_string());
    }
    
    // Check if player has enough memory shards
    let available_shards = count_memory_shards_in_inventory(ctx, player_id);
    if available_shards < cost {
        return Err(format!("Insufficient memory shards. Need {} but only have {}.", cost, available_shards));
    }
    
    // Consume memory shards from inventory
    consume_memory_shards(ctx, player_id, cost)?;
    
    // Add node to purchased list
    if progress.purchased_nodes.is_empty() {
        progress.purchased_nodes = node_id.clone();
    } else {
        progress.purchased_nodes = format!("{},{}", progress.purchased_nodes, node_id);
    }
    progress.total_shards_spent += cost;
    progress.last_updated = ctx.timestamp;
    
    // Update progress in database
    ctx.db.memory_grid_progress().player_id().update(progress);
    
    // Record individual purchase
    let purchase_record = MemoryGridPurchase {
        id: 0, // Auto-increment
        player_id,
        node_id: node_id.clone(),
        node_name: get_node_display_name(&node_id),
        cost,
        purchased_at: ctx.timestamp,
    };
    ctx.db.memory_grid_purchases().insert(purchase_record);
    
    spacetimedb::log::info!("Player {} purchased memory grid node '{}' for {} shards", player_id, node_id, cost);
    Ok(())
}

/// Reducer: Initialize memory grid progress for current player (called from client)
#[reducer]
pub fn initialize_player_memory_grid(ctx: &spacetimedb::ReducerContext) {
    initialize_memory_grid_progress(ctx, ctx.sender);
}

/// Helper function to get display name for a node ID
fn get_node_display_name(node_id: &str) -> String {
    match node_id {
        "center" => "Neural Interface".to_string(),
        "pistol" => "Pistol".to_string(),
        "barbecue" => "Barbecue".to_string(),
        "binoculars" => "Binoculars".to_string(),
        "lockpick-set" => "Lockpick Set".to_string(),
        "large-backpack" => "Large Backpack".to_string(),
        "mining-efficiency" => "Mining Efficiency".to_string(),
        "unlock-black-wolves" => "Unlock Black Wolves".to_string(),
        "unlock-hive" => "Unlock Hive".to_string(),
        "unlock-university" => "Unlock University".to_string(),
        "unlock-data-angels" => "Unlock Data Angels".to_string(),
        "unlock-battalion" => "Unlock Battalion".to_string(),
        "unlock-admiralty" => "Unlock Admiralty".to_string(),
        _ => node_id.replace('-', " ").split(' ').map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                None => String::new(),
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
            }
        }).collect::<Vec<_>>().join(" "),
    }
}


