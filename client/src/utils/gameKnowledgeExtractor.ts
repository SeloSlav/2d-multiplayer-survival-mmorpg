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

// Tips data extracted from GameTipsMenu.tsx
export const tipSections: TipSection[] = [
    {
        title: 'Getting Started',
        tips: [
            'Start by collecting basic resources like wood from trees and stone from rocks.',
            'Craft a wooden axe and pickaxe as your first tools for efficient gathering.',
            'Build a campfire early for cooking food and providing light at night.',
            'Place a sleeping bag to set your respawn point.',
        ]
    },
    {
        title: 'Survival Tips',
        tips: [
            'Keep an eye on your health, hunger, and thirst meters.',
            'Cooked food provides better nutrition than raw food.',
            'Stay near light sources at night - darkness can be dangerous.',
            'Heavy rain will extinguish campfires, so build shelters for protection.',
            'You can use plant fibers in campfire but they burn twice as fast as wood.',
        ]
    },
    {
        title: 'Water Sources',
        tips: [
            'Hold E over any water body to drink and restore thirst.',
            'Coastal waters (beaches, bays, ocean inlets) are salty and cause dehydration.',
            'Inland waters (mountain lakes, forest ponds, deep rivers) are fresh and restore thirst.',
            'There is a 2-second cooldown between drinking attempts.',
            'Salty water decreases thirst by 25 points - avoid drinking from the ocean.',
            'Fresh water increases thirst by 75 points - seek out inland lakes and rivers.',
            'Water near map edges tends to be salty due to ocean influence.',
            'Deep inland areas usually have fresh water sources for survival.',
        ]
    },
    {
        title: 'Combat & Safety',
        tips: [
            'Craft weapons early - even a wooden spear is better than fighting with a wooden spoon.',
            'Keep bandages in your hotbar for quick healing during combat.',
            'Stay near light sources at night, but be aware that darkness can hide threats.',
            'Build sleeping bags to set respawn points in safe locations.',
            'Torches and campfires provide warmth and light at night, but make you visible to other players on the minimap at long distances.',
            'Consider the tactical trade-off: warmth and visibility vs. stealth when using torches.',
            'In nighttime PvP situations, extinguish torches when you need to move unseen.',
        ]
    },
    {
        title: 'Building & Crafting',
        tips: [
            'Use the crafting menu (Tab) to see available recipes.',
            'Some recipes require specific tools or stations to craft.',
            'Build shelters to protect your campfires from rain.',
            'Stashes can be hidden underground - useful for secret storage.',
            'Shelters provide an ambient warmth bonus so you wont freeze as quickly during the night.',
        ]
    },
    {
        title: 'Food',
        tips: [
            'Mushrooms can be found scattered around the world.',
            'Cooked food provides better health and hunger restoration.',
            'Corn grows naturally in grassy areas - look for tall green stalks.',
            'Pumpkins provide substantial nutrition and can be cooked for better effects.',
            'Hemp plants grow in clusters and provide fiber for crafting.',
            'Hemp is essential for making rope and other advanced crafting materials.',
        ]
    },
    {
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
        ]
    },
    {
        title: 'Multiplayer Tips',
        tips: [
            'Cooperation with other players can help you survive longer.',
            'Use the chat system to communicate.',
            'Be careful who you trust - not all players are friendly.',
            'Consider building in groups for better defense and resource sharing.',
        ]
    }
];

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