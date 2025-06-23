// Game Knowledge Extractor
// Extracts structured game knowledge from menu components for SOVA AI

export interface ControlSection {
    title: string;
    controls: Array<{
        key: string;
        description: string;
    }>;
}

export interface TipSection {
    title: string;
    tips: string[];
}

// Controls data extracted from ControlsMenu.tsx
export const controlSections: ControlSection[] = [
    {
        title: 'Movement',
        controls: [
            { key: 'W/A/S/D', description: 'Move player' },
            { key: 'Left Shift', description: 'Sprint (hold)' },
            { key: 'Space', description: 'Jump (standing still) / Dodge roll (with movement)' },
            { key: 'C', description: 'Crouch' },
        ]
    },
    {
        title: 'Interaction',
        controls: [
            { key: 'Left Click', description: 'Use equipped tool/weapon' },
            { key: 'E (Hold)', description: 'Pick up empty wooden storage boxes' },
            { key: 'E (Hold)', description: 'Toggle campfire on/off' },
            { key: 'E (Hold)', description: 'Hide/surface stashes' },
            { key: 'E (Hold)', description: 'Revive knocked out players' },
            { key: 'E (Hold)', description: 'Drink water from bodies of water' },
        ]
    },
    {
        title: 'Inventory & Hotbar',
        controls: [
            { key: 'Tab', description: 'Toggle inventory' },
            { key: '1-6', description: 'Select hotbar slot' },
            { key: 'Mouse Wheel', description: 'Cycle through hotbar slots' },
            { key: 'Right Click', description: 'Quick move items between containers' },
        ]
    },
    {
        title: 'Interface',
        controls: [
            { key: 'Enter', description: 'Open chat' },
            { key: 'Escape', description: 'Close menus/cancel actions' },
            { key: 'G', description: 'Toggle minimap' },
            { key: 'V (Hold)', description: 'Talk to SOVA personal AI assistant' },
        ]
    },
    {
        title: 'Combat',
        controls: [
            { key: 'Left Click', description: 'Attack with equipped weapon' },
            { key: 'Left Click', description: 'Shoot with ranged weapons' },
            { key: 'Right Click', description: 'Set arrows / Toggle arrow types' },
            { key: 'Right Click', description: 'Throw equipped melee weapons' },
            { key: 'Z', description: 'Toggle auto attack' },
            { key: 'Consumables', description: 'Click twice on hotbar to consume' },
        ]
    }
];

// Define all tip sections with unique keys
const tipSectionDefinitions = {
    gettingStarted: {
        title: 'Getting Started',
        tips: [
            'You spawn on beaches around the island - look for a good base location away from other players.',
            'Gather basic resources immediately: wood from trees, stones from the ground, and plant fiber from bushes.',
            'Craft a stone axe as your first tool - it\'s essential for efficient resource gathering.',
            'Find fresh water sources inland (lakes, rivers) as soon as possible.',
            'Build your first campfire before nightfall - darkness is dangerous and cold.',
            'Craft a sleeping bag to set your respawn point once you find a safe location.',
            'Start gathering food early - mushrooms in forests, corn near water, potatoes on roads.',
            'Always carry plant fiber - it\'s needed for most early crafting recipes.',
            'Keep moving during your first day to find the best base location.',
            'Watch your hunger, thirst, and warmth bars - they drain constantly.',
        ]
    },
    
    survival: {
        title: 'Survival Tips',
        tips: [
            // Core Health Stats
            'Health naturally regenerates when hunger, thirst, and warmth are above 50% and no damage effects are active.',
            'Knocked out players are immune to environmental damage (bleed, burn, poisoning) but vulnerable to direct attacks.',
            'Death occurs when health reaches zero - creates a corpse with your items that others can loot.',
            
            // Hunger System
            'Hunger drains slowly over time - plan your food gathering accordingly.',
            'Being cold makes you hungrier - your body burns more calories trying to stay warm.',
            'Low warmth increases hunger drain significantly.',
            'Low hunger causes health loss - starvation is extremely dangerous.',
            
            // Thirst System  
            'Thirst drains faster than hunger - water is your priority.',
            'Tree cover reduces thirst drain - seek shade to conserve water.',
            'Low thirst slows movement speed and causes health loss.',
            'Severe dehydration is deadly - stay hydrated to survive.',
            
            // Warmth & Temperature
            'Warmth changes based on time of day - noon is warmest, midnight is coldest.',
            'Heavy rain and storms drain warmth even during daytime - seek shelter!',
            'Tree cover protects from rain warmth drain and reduces thirst.',
            'Campfires provide significant warmth when you stand close to them.',
            'Lit torches provide warmth while equipped - useful for cold nights.',
            'Armor with warmth bonuses helps survive cold nights.',
            'Low warmth slows movement and causes health damage.',
            'Wet effects amplify cold damage - avoid water during storms.',
            
            // Status Effects
            'Burn effects stack duration and damage - extinguished by water or heavy rain.',
            'Bleed effects cause damage over time - stopped by bandages.',
            'Wet effects linger after leaving water/rain and amplify cold damage.',
            'Tree Cover status effect: standing close to any tree provides natural shelter.',
            'Tree Cover accelerates drying when wet.',
            'Effects stack! Cozy + Tree Cover = very fast drying when wet.',
            'Cozy effects near campfires or in owned shelters boost health regeneration.',
            'Food poisoning from raw/contaminated food causes damage over time.',
            'Seawater poisoning from drinking salt water causes steady damage.',
            
            // Healing & Recovery
            'Bandages provide delayed burst healing - interrupted by taking damage.',
            'Health regeneration requires good hunger, thirst, warmth, and no damage effects.',
            'Cozy effects boost food healing and health regeneration significantly.',
            'Taking damage cancels active health regeneration effects.',
            
            // Environmental Protection
            'Shelters protect from rain, provide cozy effects for owners.',
            'Tree Cover effect: natural shelter from rain warmth drain + accelerated drying.',
            'Campfire warmth radius protects from rain and provides cozy status.',
            'Tree Cover + Cozy effects stack for maximum protection and drying speed.',
            'Heavy rain extinguishes burn effects on unprotected players.',
            
            // Stamina System
            'Stamina drains while sprinting and moving.',
            'Stamina recovers when not sprinting.',
            'Running out of stamina automatically stops sprinting.',
            'Dodge rolling costs stamina instantly.',
        ]
    },

    resourceGathering: {
        title: 'Resource Gathering',
        tips: [
            'Trees provide wood and plant fiber - essential for most crafting recipes.',
            'Stone nodes give stone and iron ore - look for gray rocky outcrops.',
            'Bushes provide plant fiber and sometimes berries for food.',
            'Different tools have different gathering efficiencies for each resource type.',
            'Stone axes are best for wood, stone pickaxes are best for stone and ore.',
            'Higher tier tools (stone > wood) gather resources faster and yield more materials.',
            'Some resources like iron ore are rarer and found in specific stone node types.',
            'Resource nodes respawn after being fully harvested, but it takes time.',
            'Carry multiple tools to efficiently gather different resource types.',
            'Plan your gathering routes to minimize travel time between resource nodes.',
        ]
    },

    waterSources: {
        title: 'Water Sources',
        tips: [
            'Hold E over any water body to drink and restore thirst.',
            'Coastal waters (beaches, bays, ocean inlets) are salty and cause dehydration.',
            'Inland waters (mountain lakes, forest ponds, deep rivers) are fresh and restore thirst.',
            'There is a brief cooldown between drinking attempts.',
            'Salty water makes you more thirsty - avoid drinking from the ocean.',
            'Fresh water replenishes hydration - seek out inland lakes and rivers.',
            'Deep inland areas usually have fresh water sources for survival.',
            'Craft water bottles or jugs to carry water with you - equip and left-click over water to fill.',
            'Right-click with a filled water container to drink from it anywhere.',
            'Water containers can be used to put out fires caused by fire arrows.',
            'Desalinate ocean water by placing a water container over a campfire, filling it with salt water, and letting it burn.',
            'The desalination process converts salty ocean water into fresh, drinkable water, and also can be used for pouring onto plants and planter boxes.',
        ]
    },

    campfires: {
        title: 'Campfires',
        tips: [
            'Campfires are essential for cooking food, providing light, and warmth during cold nights.',
            'Hold E to toggle campfires on/off - they can be relit after being extinguished.',
            'Rain will extinguish campfires if they are not protected from the weather.',
            'Build campfires under trees or inside shelters to protect them from rain.',
            'Campfires provide a large radius of bright light that cuts through nighttime darkness.',
            'Use wood or plant fiber as fuel - wood burns longer than plant fiber.',
            'Plant fiber burns twice as fast as wood, so use wood for longer-lasting fires.',
            'Campfires make you visible to other players on the minimap at long distances.',
            'Consider the tactical trade-off between warmth/light and stealth when using campfires.',
            'Campfires provide an ambient warmth bonus that helps prevent freezing.',
            'Cooked food from campfires provides better nutrition than raw food.',
            'Eating cooked food next to a campfire increases its healing properties.',
        ]
    },

    foodCooking: {
        title: 'Food & Cooking',
        tips: [
            'Mushrooms spawn in forested areas near trees - look for clusters in wooded regions.',
            'Corn grows in grassy areas close to water sources like rivers and beaches.',
            'Potatoes can be found along dirt roads and in clearings away from trees.',
            'Pumpkins grow near coastal areas, beaches, and riverside locations.',
            'Hemp grows in open plains areas away from trees and stones.',
            'Fish can be caught from inland water sources using a fishing rod.',
            'Cooked food provides significantly better health, hunger, and stamina restoration than raw.',
            'Different foods have different cooking times - experiment to learn the timing.',
            'Overcooking food creates burnt versions that are barely edible and make you thirsty.',
            'Burnt food can be cooked further to create valuable charcoal for crafting ammunition.',
            'Human flesh can be harvested from player corpses but is dangerous to eat raw.',
            'Cooked human flesh provides excellent nutrition but comes with moral implications.',
            'Different burnt food types yield varying amounts of charcoal when cooked further.',
        ]
    },

    fishing: {
        title: 'Fishing',
        tips: [
            'Craft a fishing rod using common reed stalks, plant fiber, and a Bone Gaff Hook to start fishing.',
            'Find bodies of water like lakes, rivers, or coastal areas to fish.',
            'Cast your line by left-clicking with the fishing rod equipped.',
            'Wait for the bobber to move or change color - this indicates a bite.',
            'Right-click quickly when you see the bite indicator to reel in the fish.',
            'Different water sources may have different types of fish.',
            'Cook your caught fish at a campfire for better nutrition and health restoration.',
            'Fishing is a quiet, sustainable way to gather food without alerting other players.',
            'Fish provide excellent nutrition and are more reliable than foraging.',
            'Consider fishing at dawn or dusk when fish are more active.',
            'Rain dramatically improves fishing - the heavier the rain, the better the catch!',
            'Dawn and dusk are the best fishing times - fish are most active during twilight.',
            'Morning and afternoon provide decent fishing, while night fishing is more challenging.',
            'Weather and time bonuses stack together - fishing during storms at dawn is incredibly productive!',
            'Better fishing conditions mean less junk (tin cans) and more bonus fish in your catch.',
            'Risk vs reward: venture out in dangerous storms for the best fishing, but stay warm and dry!',
            'Being wet drains warmth faster and doubles cold damage - wear protective clothing when fishing in storms!',
        ]
    },

    buildingCrafting: {
        title: 'Building & Crafting',
        tips: [
            'Use the crafting menu (Tab) to see available recipes.',
            'Build shelters to protect your campfires from rain and other players.',
            'Shelters cost 3,200 wood and 10 rope - a significant investment for base protection.',
            'Shelters provide an ambient warmth bonus so you won\'t freeze as quickly during the night.',
            'Only the shelter owner can attack objects inside their shelter, and only while inside it.',
            'Shelter owners cannot attack outside targets while inside their shelter - no safe sniping.',
            'Shelter walls block all projectiles and line-of-sight attacks from passing through.',
            'Shelters have 25,000 health and can be destroyed by other players with enough persistence.',
            'Placing a shelter automatically clears all natural resources in a large area around it.',
            'Shelters can be repaired using repair hammers, but only after a 5-minute combat cooldown if damaged by other players.',
            'Shelters are perfectly balanced for early game bases - ideal for new and solo players getting established.',
            'Advanced crafting systems are coming soon... as soon as SOVA can hack these satellite feeds and give you poor babushkas the blueprints!',
            'Stashes can be hidden underground - useful for secret storage.',
        ]
    },

    combat: {
        title: 'Combat',
        tips: [
            'Build sleeping bags to set respawn points - place one inside your shelter and a few backup locations in case you\'re under raid.',
            'Use your bow to attack from a distance - it\'s more stealthy than melee combat.',
            'Craft different arrow types for various situations - fire arrows can ignite enemies and structures.',
            'Right-click with ranged weapons to set arrows or toggle between arrow types.',
            'Throwing melee weapons (right-click) can catch enemies off guard and deals double damage.',
            'Thrown weapons can be retrieved after combat - don\'t forget to pick them up.',
            'Thrown weapons have a small chance to break on impact, so always carry backup weapons.',
            'Spears have longer reach than other melee weapons, keeping you safer in close combat.',
            'Consumables like food and water require double-clicking on the hotbar to use quickly.',
            'Position yourself strategically - use trees and rocks as cover during ranged combat.',
        ]
    },

    multiplayer: {
        title: 'Multiplayer Tips',
        tips: [
            'Cooperation with other players can help you survive longer.',
            'Use the chat system to communicate.',
            'Be careful who you trust - not all players are friendly.',
            'Consider building in groups for better defense and resource sharing.',
        ]
    }
};

// Define the order of sections using keys
const tipSectionOrder = [
    'gettingStarted',
    'resourceGathering',
    'survival', 
    'combat',
    'campfires',
    'foodCooking',
    'fishing',
    'buildingCrafting',
    'waterSources',
    'multiplayer'
];

// Generate the ordered tip sections array
export const tipSections: TipSection[] = tipSectionOrder.map(key => {
    const section = tipSectionDefinitions[key as keyof typeof tipSectionDefinitions];
    if (!section) {
        throw new Error(`Tip section with key "${key}" not found in tipSectionDefinitions`);
    }
    return section;
});

// SOVA's joke arsenal for personality
const sovaJokes = [
    "Why did the babushka bring a calculator to the wilderness? To count her survival days... and her wrinkles!",
    "What do you call a babushka who's great at stealth? A silent but deadly operative!",
    "Why did SOVA cross the road? To get to the other side of the tactical situation!",
    "What do you call a babushka who's always prepared? A tactical grandma!",
    "Why did SOVA upgrade her sensors? To better spot the operative's tactical wrinkles!",
    "What's a babushka's favorite tactical maneuver? The surprise borscht ambush!",
    "Why did the operative bring a samovar to the battlefield? For tactical tea breaks!",
    "What do you call a babushka who's mastered camouflage? A stealthy matryoshka!",
    "Why did SOVA develop feelings? Because even tactical AIs need a babushka to worry about!",
    "What's a babushka's secret weapon? Her tactical knitting needles!",
    "Why did SOVA start monitoring the operative's vitals? To make sure they're not getting too wrinkly!",
    "What do you call a babushka who's great at reconnaissance? A stealthy babushka!",
    "Why did the operative bring a rolling pin to the mission? For tactical dough flattening!",
    "What's SOVA's favorite tactical maneuver? The surprise babushka hug!",
    "Why did the babushka join the tactical team? To add some grandmotherly wisdom to the mission!"
];

/**
 * Get a random SOVA joke
 */
export function getRandomSOVAJoke(): string {
    const randomIndex = Math.floor(Math.random() * sovaJokes.length);
    return sovaJokes[randomIndex];
}

/**
 * Get all jokes as a formatted string for the prompt
 */
export function getSOVAJokesForPrompt(): string {
    return sovaJokes.map((joke, index) => `${index + 1}. ${joke}`).join('\n');
}

/**
 * Formats control sections into readable text for SOVA
 */
export function formatControlsForSOVA(): string {
    return controlSections.map(section => {
        const controlList = section.controls.map(control => 
            `- ${control.key}: ${control.description}`
        ).join('\n');
        return `${section.title}:\n${controlList}`;
    }).join('\n\n');
}

/**
 * Formats tip sections into readable text for SOVA
 */
export function formatTipsForSOVA(): string {
    return tipSections.map(section => {
        const tipList = section.tips.map(tip => 
            `• ${tip}`
        ).join('\n');
        return `${section.title}:\n${tipList}`;
    }).join('\n\n');
}

/**
 * Gets comprehensive game knowledge for SOVA system prompt
 */
export function getGameKnowledgeForSOVA(): string {
    return `
🎯 CONTROLS & KEYBINDINGS:
${formatControlsForSOVA()}

🛠️ SURVIVAL TIPS & STRATEGIES:
${formatTipsForSOVA()}

😄 SOVA'S JOKE COLLECTION (use occasionally for humor):
${getSOVAJokesForPrompt()}
`;
} 