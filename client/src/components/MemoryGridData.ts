// Memory Grid Tech Tree Data Structure
// Based on MEMORY_GRID_TECH_TREE.md specification

export interface MemoryGridNode {
  id: string;
  name: string;
  description: string;
  cost: number;
  tier: number;
  faction?: string; // undefined for main grid nodes
  prerequisites: string[]; // IDs of required nodes
  position: { x: number; y: number }; // Grid coordinates
  category: 'tool' | 'weapon' | 'armor' | 'crafting' | 'vehicle' | 'technology' | 'passive';
  icon?: string; // Icon identifier
  status: 'locked' | 'available' | 'purchased'; // Player progression state
}

export interface MemoryGridFaction {
  id: string;
  name: string;
  description: string;
  color: string; // Theme color for the faction
  philosophy: string;
  unlockCost: number;
  totalCost: number;
}

// Faction definitions
export const FACTIONS: Record<string, MemoryGridFaction> = {
  'black-wolves': {
    id: 'black-wolves',
    name: 'Black Wolves',
    description: 'Enforcer Branch',
    color: '#ef4444', // Red
    philosophy: 'Brutal efficiency through superior firepower',
    unlockCost: 2000,
    totalCost: 89000
  },
  'hive': {
    id: 'hive',
    name: 'Hive',
    description: 'Chem-Industrial Branch',
    color: '#f59e0b', // Yellow/Amber
    philosophy: 'Evolution through chemical mastery',
    unlockCost: 2000,
    totalCost: 89000
  },
  'university': {
    id: 'university',
    name: 'University',
    description: 'Robotics & Fabrication Branch',
    color: '#3b82f6', // Blue
    philosophy: 'Knowledge is the ultimate weapon',
    unlockCost: 2000,
    totalCost: 89000
  },
  'data-angels': {
    id: 'data-angels',
    name: 'Data Angels',
    description: 'Cyber & Stealth Branch',
    color: '#8b5cf6', // Purple
    philosophy: 'Information warfare in the digital age',
    unlockCost: 2000,
    totalCost: 89000
  },
  'battalion': {
    id: 'battalion',
    name: 'Battalion',
    description: 'Conventional Military Branch',
    color: '#22c55e', // Green
    philosophy: 'Disciplined force multipliers',
    unlockCost: 2000,
    totalCost: 89000
  },
  'admiralty': {
    id: 'admiralty',
    name: 'Admiralty',
    description: 'Weather & Coastal Mastery Branch',
    color: '#06b6d4', // Cyan
    philosophy: 'Masters of sea and storm',
    unlockCost: 2000,
    totalCost: 89000
  }
};

// Helper function to calculate radial positions
const getRadialPosition = (angle: number, radius: number): { x: number; y: number } => ({
  x: Math.cos(angle) * radius,
  y: Math.sin(angle) * radius
});

// Helper function to distribute nodes evenly around a circle
const distributeNodesInCircle = (count: number, radius: number, startAngle: number = 0): { x: number; y: number }[] => {
  const angleStep = (2 * Math.PI) / count;
  return Array.from({ length: count }, (_, i) => 
    getRadialPosition(startAngle + (i * angleStep), radius)
  );
};

// Helper function to determine category from node ID
const getCategoryFromId = (nodeId: string): 'tool' | 'weapon' | 'armor' | 'crafting' | 'vehicle' | 'technology' | 'passive' => {
  // Passive abilities
  if (nodeId.includes('stims') || nodeId.includes('durability') || nodeId.includes('surge') || 
      nodeId.includes('speed') || nodeId.includes('resistance') || nodeId.includes('bloom') ||
      nodeId.includes('yield') || nodeId.includes('burst') || nodeId.includes('movement') ||
      nodeId.includes('overclock') || nodeId.includes('hp') || nodeId.includes('damage') ||
      nodeId.includes('rally') || nodeId.includes('regen') || nodeId.includes('tempest') ||
      nodeId.includes('command')) {
    return 'passive';
  }
  
  // Armor items
  if (nodeId.includes('vest') || nodeId.includes('shield') || nodeId.includes('boots') ||
      nodeId.includes('harness') || nodeId.includes('cloak') || nodeId.includes('scrubber') ||
      nodeId.includes('armor')) {
    return 'armor';
  }
  
  // Weapons
  if (nodeId.includes('pike') || nodeId.includes('hammer') || nodeId.includes('knife') ||
      nodeId.includes('coating') || nodeId.includes('pulse') || nodeId.includes('hijack') ||
      nodeId.includes('rifle') || nodeId.includes('mortar') || nodeId.includes('turret') ||
      nodeId.includes('drone') || nodeId.includes('cannon') || nodeId.includes('sprayer') ||
      nodeId.includes('smg')) {
    return 'weapon';
  }
  
  // Vehicles
  if (nodeId.includes('raft')) {
    return 'vehicle';
  }
  
  // Technology (default for most complex items)  
  if (nodeId.includes('tower') || nodeId.includes('uplink') || nodeId.includes('leech') ||
      nodeId.includes('decryptor') || nodeId.includes('yard') || nodeId.includes('beacon') ||
      nodeId.includes('field') || nodeId.includes('buoy') || nodeId.includes('solar') ||
      nodeId.includes('barricades') || nodeId.includes('optics') || nodeId.includes('cache') || 
      nodeId.includes('radio') || nodeId.includes('locker') || nodeId.includes('bunker')) {
    return 'technology';
  }
  
  // Crafting items
  if (nodeId.includes('barbecue') || nodeId.includes('refrigerator') || nodeId.includes('factory')) {
    return 'crafting';
  }
  
  // Default to crafting for everything else
  return 'crafting';
};

// Complete Memory Grid nodes following MEMORY_GRID_TECH_TREE.md exactly
export const MEMORY_GRID_NODES = [
  // CENTER NODE - Starting point
  {
    id: 'center',
    name: 'Neuroveil™ Ocular Interface',
    description: 'OOO \"Rozhkov Neuroscience\" neural interface. Protects against hostile AI intrusion, processes Memory Shards for technological advancement, and provides environmental hazard detection with AI assistant.',
    cost: 0,
    tier: 0,
    prerequisites: [],
    position: { x: 0, y: 0 },
    category: 'technology' as const,
    status: 'purchased' as const
  },

  // CONCENTRIC CIRCLE GRID - Interconnected paths like FFX Sphere Grid
  // TIER 1 - First ring, all connected to center
  { id: 'pistol', name: 'Pistol', description: 'Basic sidearm with reliable damage', cost: 200, tier: 1, prerequisites: ['center'], position: getRadialPosition(0, 100), category: 'weapon' as const, status: 'available' as const },
  { id: 'barbecue', name: 'Barbecue', description: 'Cook meat for better nutrition and buffs', cost: 220, tier: 1, prerequisites: ['center'], position: getRadialPosition(Math.PI / 3, 100), category: 'crafting' as const, status: 'locked' as const },
  { id: 'binoculars', name: 'Binoculars', description: 'Extended vision range for scouting', cost: 180, tier: 1, prerequisites: ['center'], position: getRadialPosition(2 * Math.PI / 3, 100), category: 'tool' as const, status: 'locked' as const },
  { id: 'lockpick-set', name: 'Lockpick Set', description: 'Open locked containers and doors', cost: 250, tier: 1, prerequisites: ['center'], position: getRadialPosition(Math.PI, 100), category: 'tool' as const, status: 'locked' as const },
  { id: 'large-backpack', name: 'Large Backpack', description: 'Increases inventory capacity by 8 slots', cost: 280, tier: 1, prerequisites: ['center'], position: getRadialPosition(4 * Math.PI / 3, 100), category: 'tool' as const, status: 'locked' as const },
  { id: 'mining-efficiency', name: 'Mining Efficiency', description: 'Advanced techniques, +30% yield', cost: 200, tier: 1, prerequisites: ['center'], position: getRadialPosition(5 * Math.PI / 3, 100), category: 'tool' as const, status: 'locked' as const },

  // TIER 2 - Second ring, connected to tier 1 nodes + adjacent tier 1 nodes
  { id: 'hunting-rifle', name: 'Hunting Rifle', description: 'Long-range precision weapon', cost: 450, tier: 2, prerequisites: ['pistol', 'mining-efficiency', 'barbecue'], position: getRadialPosition(0, 180), category: 'weapon' as const, status: 'locked' as const },
  { id: 'refrigerator', name: 'Refrigerator', description: 'Preserves food and materials longer', cost: 480, tier: 2, prerequisites: ['barbecue', 'pistol', 'binoculars'], position: getRadialPosition(Math.PI / 3, 180), category: 'crafting' as const, status: 'locked' as const },
  { id: 'security-cameras', name: 'Security Cameras', description: 'Remote area surveillance', cost: 420, tier: 2, prerequisites: ['binoculars', 'barbecue', 'lockpick-set'], position: getRadialPosition(2 * Math.PI / 3, 180), category: 'technology' as const, status: 'locked' as const },
  { id: 'metal-detector', name: 'Metal Detector', description: 'Reveals buried shards and caches', cost: 460, tier: 2, prerequisites: ['lockpick-set', 'binoculars', 'large-backpack'], position: getRadialPosition(Math.PI, 180), category: 'tool' as const, status: 'locked' as const },
  { id: 'landmines', name: 'Landmines', description: 'Deployable area denial explosives', cost: 520, tier: 2, prerequisites: ['large-backpack', 'lockpick-set', 'mining-efficiency'], position: getRadialPosition(4 * Math.PI / 3, 180), category: 'weapon' as const, status: 'locked' as const },
  { id: 'kevlar-vest', name: 'Kevlar Vest', description: 'Lightweight bullet-resistant armor', cost: 450, tier: 2, prerequisites: ['mining-efficiency', 'large-backpack', 'pistol'], position: getRadialPosition(5 * Math.PI / 3, 180), category: 'armor' as const, status: 'locked' as const },

  // TIER 3 - Third ring, connected to tier 2 nodes + adjacent tier 2 nodes
  { id: 'shotgun', name: 'Shotgun', description: 'Close-range, high-damage spread weapon', cost: 800, tier: 3, prerequisites: ['hunting-rifle', 'kevlar-vest', 'refrigerator'], position: getRadialPosition(0, 270), category: 'weapon' as const, status: 'locked' as const },
  { id: 'repair-table', name: 'Repair Table', description: 'Advanced item repair and modification', cost: 750, tier: 3, prerequisites: ['refrigerator', 'hunting-rifle', 'security-cameras'], position: getRadialPosition(Math.PI / 3, 270), category: 'crafting' as const, status: 'locked' as const },
  { id: 'night-vision', name: 'Night Vision Goggles', description: 'See clearly in darkness', cost: 720, tier: 3, prerequisites: ['security-cameras', 'refrigerator', 'metal-detector'], position: getRadialPosition(2 * Math.PI / 3, 270), category: 'tool' as const, status: 'locked' as const },
  { id: 'bear-traps', name: 'Bear Traps', description: 'Hidden ground traps for defense', cost: 780, tier: 3, prerequisites: ['metal-detector', 'security-cameras', 'landmines'], position: getRadialPosition(Math.PI, 270), category: 'weapon' as const, status: 'locked' as const },
  { id: 'c4-explosives', name: 'C4 Explosives', description: 'Breaching charges for structures', cost: 850, tier: 3, prerequisites: ['landmines', 'metal-detector', 'kevlar-vest'], position: getRadialPosition(4 * Math.PI / 3, 270), category: 'weapon' as const, status: 'locked' as const },
  { id: 'military-armor', name: 'Military Armor Set', description: 'Full combat protection suite', cost: 800, tier: 3, prerequisites: ['kevlar-vest', 'landmines', 'hunting-rifle'], position: getRadialPosition(5 * Math.PI / 3, 270), category: 'armor' as const, status: 'locked' as const },

  // TIER 4 - Fourth ring, connected to tier 3 nodes + adjacent tier 3 nodes  
  { id: 'assault-rifle', name: 'Assault Rifle', description: 'Full-auto military weapon', cost: 1300, tier: 4, prerequisites: ['shotgun', 'military-armor', 'repair-table'], position: getRadialPosition(0, 370), category: 'weapon' as const, status: 'locked' as const },
  { id: 'radio-tower', name: 'Radio Tower', description: 'Long-range communication and coordination hub', cost: 1400, tier: 4, prerequisites: ['repair-table', 'shotgun', 'night-vision'], position: getRadialPosition(Math.PI / 3, 370), category: 'technology' as const, status: 'locked' as const },
  { id: 'solar-panels', name: 'Solar Panels', description: 'Generate renewable electricity for bases', cost: 1250, tier: 4, prerequisites: ['night-vision', 'repair-table', 'bear-traps'], position: getRadialPosition(2 * Math.PI / 3, 370), category: 'technology' as const, status: 'locked' as const },
  { id: 'barricades', name: 'Barricades', description: 'Deployable defensive structures and barriers', cost: 1200, tier: 4, prerequisites: ['bear-traps', 'night-vision', 'c4-explosives'], position: getRadialPosition(Math.PI, 370), category: 'technology' as const, status: 'locked' as const },
  { id: 'rocket-launcher', name: 'Rocket Launcher', description: 'High-explosive anti-vehicle weapon', cost: 1400, tier: 4, prerequisites: ['c4-explosives', 'bear-traps', 'military-armor'], position: getRadialPosition(4 * Math.PI / 3, 370), category: 'weapon' as const, status: 'locked' as const },
  { id: 'weapons-locker', name: 'Weapons Locker', description: 'Secure storage and quick access to team armaments', cost: 1350, tier: 4, prerequisites: ['military-armor', 'c4-explosives', 'shotgun'], position: getRadialPosition(5 * Math.PI / 3, 370), category: 'technology' as const, status: 'locked' as const },

  // TIER 5 - Final main grid tier with the best technologies
  { id: 'plasma-rifle', name: 'Plasma Rifle', description: 'Energy weapon with burn effects', cost: 2200, tier: 5, prerequisites: ['assault-rifle', 'weapons-locker', 'radio-tower'], position: getRadialPosition(0, 480), category: 'weapon' as const, status: 'locked' as const },
  { id: 'automated-harvester', name: 'Automated Harvester', description: 'Robotic resource collection', cost: 2400, tier: 5, prerequisites: ['radio-tower', 'assault-rifle', 'solar-panels'], position: getRadialPosition(Math.PI / 3, 480), category: 'technology' as const, status: 'locked' as const },
  { id: 'teleporter', name: 'Teleporter Beacon', description: 'Instant travel between points', cost: 2100, tier: 5, prerequisites: ['solar-panels', 'radio-tower', 'barricades'], position: getRadialPosition(2 * Math.PI / 3, 480), category: 'technology' as const, status: 'locked' as const },
  { id: 'mobile-shield', name: 'Mobile Shield Generator', description: 'Personal energy shielding', cost: 2000, tier: 5, prerequisites: ['barricades', 'solar-panels', 'rocket-launcher'], position: getRadialPosition(Math.PI, 480), category: 'technology' as const, status: 'locked' as const },
  { id: 'drone-swarm', name: 'Combat Drone', description: 'Autonomous robot army', cost: 2300, tier: 5, prerequisites: ['rocket-launcher', 'barricades', 'weapons-locker'], position: getRadialPosition(4 * Math.PI / 3, 480), category: 'technology' as const, status: 'locked' as const },
  { id: 'fortified-bunker', name: 'Fortified Bunker', description: 'Deployable armored stronghold with weapon ports', cost: 2250, tier: 5, prerequisites: ['weapons-locker', 'rocket-launcher', 'plasma-rifle'], position: getRadialPosition(5 * Math.PI / 3, 480), category: 'technology' as const, status: 'locked' as const },



  // FACTION UNLOCK NODES - Entry points to faction branches (Cost: 2,000 shards each)
  // ANY Tier 5 node can unlock ANY faction - true interconnected design!
  { id: 'unlock-black-wolves', name: 'Unlock Black Wolves', description: `Unlock access to the ${FACTIONS['black-wolves'].name} specialization branch. ${FACTIONS['black-wolves'].philosophy}`, cost: 2000, tier: 6, faction: 'black-wolves', prerequisites: ['plasma-rifle', 'automated-harvester', 'teleporter', 'mobile-shield', 'drone-swarm', 'fortified-bunker'], position: getRadialPosition(0, 600), category: 'technology' as const, status: 'locked' as const },
  { id: 'unlock-hive', name: 'Unlock Hive', description: `Unlock access to the ${FACTIONS['hive'].name} specialization branch. ${FACTIONS['hive'].philosophy}`, cost: 2000, tier: 6, faction: 'hive', prerequisites: ['plasma-rifle', 'automated-harvester', 'teleporter', 'mobile-shield', 'drone-swarm', 'fortified-bunker'], position: getRadialPosition(Math.PI / 3, 600), category: 'technology' as const, status: 'locked' as const },
  { id: 'unlock-university', name: 'Unlock University', description: `Unlock access to the ${FACTIONS['university'].name} specialization branch. ${FACTIONS['university'].philosophy}`, cost: 2000, tier: 6, faction: 'university', prerequisites: ['plasma-rifle', 'automated-harvester', 'teleporter', 'mobile-shield', 'drone-swarm', 'fortified-bunker'], position: getRadialPosition(2 * Math.PI / 3, 600), category: 'technology' as const, status: 'locked' as const },
  { id: 'unlock-data-angels', name: 'Unlock Data Angels', description: `Unlock access to the ${FACTIONS['data-angels'].name} specialization branch. ${FACTIONS['data-angels'].philosophy}`, cost: 2000, tier: 6, faction: 'data-angels', prerequisites: ['plasma-rifle', 'automated-harvester', 'teleporter', 'mobile-shield', 'drone-swarm', 'fortified-bunker'], position: getRadialPosition(Math.PI, 600), category: 'technology' as const, status: 'locked' as const },
  { id: 'unlock-battalion', name: 'Unlock Battalion', description: `Unlock access to the ${FACTIONS['battalion'].name} specialization branch. ${FACTIONS['battalion'].philosophy}`, cost: 2000, tier: 6, faction: 'battalion', prerequisites: ['plasma-rifle', 'automated-harvester', 'teleporter', 'mobile-shield', 'drone-swarm', 'fortified-bunker'], position: getRadialPosition(4 * Math.PI / 3, 600), category: 'technology' as const, status: 'locked' as const },
  { id: 'unlock-admiralty', name: 'Unlock Admiralty', description: `Unlock access to the ${FACTIONS['admiralty'].name} specialization branch. ${FACTIONS['admiralty'].philosophy}`, cost: 2000, tier: 6, faction: 'admiralty', prerequisites: ['plasma-rifle', 'automated-harvester', 'teleporter', 'mobile-shield', 'drone-swarm', 'fortified-bunker'], position: getRadialPosition(5 * Math.PI / 3, 600), category: 'technology' as const, status: 'locked' as const },

  // BLACK WOLVES FACTION BRANCH - Two paths: Assault & Stealth
  ...(() => {
    const baseAngle = 0; // Black Wolves branch angle
    
    // PATH 1: Assault Specialist (upper path)
    const assaultPath = [
      { id: 'riot-vest', name: 'Riot Vest', description: 'Light assault armor with high mobility', cost: 3000 },
      { id: 'shock-pike', name: 'Shock Pike', description: 'Electrified melee weapon, stuns targets', cost: 6000 },
      { id: 'slab-shield', name: 'Slab Shield', description: 'Heavy riot shield, blocks projectiles', cost: 9000 },
      { id: 'flash-hammer', name: 'Flash Hammer', description: 'Stun grenade launcher attachment', cost: 12000 },
      { id: 'adrenal-surge', name: 'Adrenal Surge', description: '5s sprint + 30% melee damage, 60s cooldown (Ultimate)', cost: 15000 }
    ];
    
    // PATH 2: Stealth Specialist (lower path)
    const stealthPath = [
      { id: 'combat-stims', name: 'Combat Stims', description: 'Enhanced movement and reaction time (Passive +10% Speed)', cost: 3000 },
      { id: 'suppressor-rig', name: 'Suppressor Rig', description: 'Stealth gear for silent takedowns', cost: 6000 },
      { id: 'grav-boots', name: 'Grav Boots', description: 'Dodge rolls become jumps with extended range, can go over players and obstacles', cost: 9000 },
      { id: 'field-interrogator', name: 'Field Interrogator', description: 'Portable information extraction station', cost: 12000 },
      { id: 'armor-durability', name: 'Armor Durability', description: 'All equipped armor lasts longer (Passive +25% Durability)', cost: 15000 }
    ];
    
    const nodes: any[] = [];
    
    // Add assault path (upper arc)
    assaultPath.forEach((node, i) => {
      nodes.push({
        id: node.id,
        name: node.name,
        description: node.description,
        cost: node.cost,
        tier: 7 + i,
        faction: 'black-wolves',
        prerequisites: i === 0 ? ['unlock-black-wolves'] : [assaultPath[i - 1].id],
        position: getRadialPosition(baseAngle - 0.3, 780 + (i * 80)), // Upper path
        category: getCategoryFromId(node.id),
        status: 'locked' as const
      });
    });
    
    // Add stealth path (lower arc)
    stealthPath.forEach((node, i) => {
      nodes.push({
        id: node.id,
        name: node.name,
        description: node.description,
        cost: node.cost,
        tier: 7 + i,
        faction: 'black-wolves',
        prerequisites: i === 0 ? ['unlock-black-wolves'] : [stealthPath[i - 1].id],
        position: getRadialPosition(baseAngle + 0.3, 780 + (i * 80)), // Lower path
        category: getCategoryFromId(node.id),
        status: 'locked' as const
      });
    });
    
    return nodes;
  })(),

  // HIVE FACTION BRANCH - Two paths: Bio-Engineering & Chemical Warfare
  ...(() => {
    const baseAngle = Math.PI / 3; // Hive branch angle
    
    // PATH 1: Bio-Engineering (upper path)
    const bioPath = [
      { id: 'spore-grain-vat', name: 'Spore Grain Vat', description: 'Produces specialized bio-materials', cost: 3000 },
      { id: 'slime-furnace', name: 'Slime Furnace', description: 'Process organic materials into fuel', cost: 6000 },
      { id: 'chameleon-harness', name: 'Chameleon Harness', description: 'Adaptive camouflage system', cost: 9000 },
      { id: 'mealworm-factory', name: 'Mealworm Factory', description: 'Compact bio-farm producing efficient protein from compost, bland but nutritious', cost: 12000 },
      { id: 'crafting-speed', name: 'Crafting Speed', description: 'All crafting operations faster (Passive +20% Speed)', cost: 15000 }
    ];
    
    // PATH 2: Chemical Warfare (lower path)
    const chemPath = [
      { id: 'venom-knife', name: 'Venom Knife', description: 'Poison-coated blade, DoT damage', cost: 3000 },
      { id: 'poison-resistance', name: 'Poison Resistance', description: 'Reduced toxin damage (Passive +15% Resistance)', cost: 6000 },
      { id: 'acid-sprayer', name: 'Acid Sprayer', description: 'Chemical weapon that melts through armor and structures', cost: 9000 },
      { id: 'toxic-coating', name: 'Toxic Coating', description: 'Apply poison coating to any arrows, bullets, or projectiles', cost: 12000 },
      { id: 'toxic-bloom', name: 'Toxic Bloom', description: 'AoE slowing mist for 8s, 60s cooldown (Ultimate)', cost: 15000 }
    ];
    
    const nodes: any[] = [];
    
    // Add bio-engineering path (upper arc)
    bioPath.forEach((node, i) => {
      nodes.push({
        id: node.id,
        name: node.name,
        description: node.description,
        cost: node.cost,
        tier: 7 + i,
        faction: 'hive',
        prerequisites: i === 0 ? ['unlock-hive'] : [bioPath[i - 1].id],
        position: getRadialPosition(baseAngle - 0.3, 780 + (i * 80)), // Upper path
        category: getCategoryFromId(node.id),
        status: 'locked' as const
      });
    });
    
    // Add chemical warfare path (lower arc)
    chemPath.forEach((node, i) => {
      nodes.push({
        id: node.id,
        name: node.name,
        description: node.description,
        cost: node.cost,
        tier: 7 + i,
        faction: 'hive',
        prerequisites: i === 0 ? ['unlock-hive'] : [chemPath[i - 1].id],
        position: getRadialPosition(baseAngle + 0.3, 780 + (i * 80)), // Lower path
        category: getCategoryFromId(node.id),
        status: 'locked' as const
      });
    });
    
    return nodes;
  })(),

  // UNIVERSITY FACTION BRANCH - Two paths: Robotics & Research
  ...(() => {
    const baseAngle = 2 * Math.PI / 3; // University branch angle
    
    // PATH 1: Robotics (upper path)
    const roboticsPath = [
      { id: 'auto-turret', name: 'Auto-Turret', description: 'Automated defense system', cost: 3000 },
      { id: 'scanner-drone', name: 'Scanner Drone', description: 'Autonomous resource detection', cost: 6000 },
      { id: 'repair-swarm', name: 'Repair Swarm', description: 'Deployable structure maintenance bots', cost: 9000 },
      { id: 'stabilizer-field', name: 'Stabilizer Field', description: 'Area protection from environmental damage', cost: 12000 },
      { id: 'fabricator-burst', name: 'Fabricator Burst', description: 'Complete next craft instantly (≤30s queue), 60s cooldown (Ultimate)', cost: 15000 }
    ];
    
    // PATH 2: Research (lower path)
    const researchPath = [
      { id: 'logic-furnace', name: 'Logic Furnace', description: 'AI-assisted material processing', cost: 3000 },
      { id: 'bioprinter-table', name: 'Bioprinter Table', description: '3D print organic materials and food', cost: 6000 },
      { id: 'geneforge-vat', name: 'GeneForge Vat', description: 'Advanced biological material synthesis', cost: 9000 },
      { id: 'mining-yield-ii', name: 'Mining Yield II', description: 'Extract even more resources from nodes (Passive +35% Yield)', cost: 12000 },
      { id: 'crafting-speed-uni', name: 'Crafting Speed', description: 'Enhanced manufacturing efficiency (Passive +25% Speed)', cost: 15000 }
    ];
    
    const nodes: any[] = [];
    
    // Add robotics path (upper arc)
    roboticsPath.forEach((node, i) => {
      nodes.push({
        id: node.id,
        name: node.name,
        description: node.description,
        cost: node.cost,
        tier: 7 + i,
        faction: 'university',
        prerequisites: i === 0 ? ['unlock-university'] : [roboticsPath[i - 1].id],
        position: getRadialPosition(baseAngle - 0.3, 780 + (i * 80)), // Upper path
        category: getCategoryFromId(node.id),
        status: 'locked' as const
      });
    });
    
    // Add research path (lower arc)
    researchPath.forEach((node, i) => {
      nodes.push({
        id: node.id,
        name: node.name,
        description: node.description,
        cost: node.cost,
        tier: 7 + i,
        faction: 'university',
        prerequisites: i === 0 ? ['unlock-university'] : [researchPath[i - 1].id],
        position: getRadialPosition(baseAngle + 0.3, 780 + (i * 80)), // Lower path
        category: getCategoryFromId(node.id),
        status: 'locked' as const
      });
    });
    
    return nodes;
  })(),

  // DATA ANGELS FACTION BRANCH - Two paths: Hacking & Stealth
  ...(() => {
    const baseAngle = Math.PI; // Data Angels branch angle
    
    // PATH 1: Hacking (upper path)
    const hackingPath = [
      { id: 'jammer-tower', name: 'Jammer Tower', description: 'Disable electronic devices in area', cost: 3000 },
      { id: 'ghost-uplink', name: 'Ghost Uplink', description: 'Remote access to electronic systems', cost: 6000 },
      { id: 'neurochef-decryptor', name: 'Neurochef Decryptor', description: 'Crack advanced security systems', cost: 9000 },
      { id: 'drone-hijack', name: 'Drone Hijack Pulse', description: 'Take control of enemy automated systems', cost: 12000 },
      { id: 'hacking-speed', name: 'Hacking Speed', description: 'Faster electronic infiltration (Passive +25% Speed)', cost: 15000 }
    ];
    
    // PATH 2: Stealth (lower path)
    const stealthPath = [
      { id: 'backdoor-cloak', name: 'Backdoor Cloak', description: '5-second invisibility device', cost: 3000 },
      { id: 'signal-scrubber', name: 'Signal Scrubber Backpack', description: 'Mobile electronic countermeasures', cost: 6000 },
      { id: 'memory-leech', name: 'Memory Leech Implant', description: 'Extract information from defeated enemies', cost: 9000 },
      { id: 'movement-speed', name: 'Movement Speed', description: 'Enhanced mobility systems (Passive +18% Speed)', cost: 12000 },
      { id: 'overclock', name: 'Overclock', description: '10s invisibility to turrets & drones, 60s cooldown (Ultimate)', cost: 15000 }
    ];
    
    const nodes: any[] = [];
    
    // Add hacking path (upper arc)
    hackingPath.forEach((node, i) => {
      nodes.push({
        id: node.id,
        name: node.name,
        description: node.description,
        cost: node.cost,
        tier: 7 + i,
        faction: 'data-angels',
        prerequisites: i === 0 ? ['unlock-data-angels'] : [hackingPath[i - 1].id],
        position: getRadialPosition(baseAngle - 0.3, 780 + (i * 80)), // Upper path
        category: getCategoryFromId(node.id),
        status: 'locked' as const
      });
    });
    
    // Add stealth path (lower arc)
    stealthPath.forEach((node, i) => {
      nodes.push({
        id: node.id,
        name: node.name,
        description: node.description,
        cost: node.cost,
        tier: 7 + i,
        faction: 'data-angels',
        prerequisites: i === 0 ? ['unlock-data-angels'] : [stealthPath[i - 1].id],
        position: getRadialPosition(baseAngle + 0.3, 780 + (i * 80)), // Lower path
        category: getCategoryFromId(node.id),
        status: 'locked' as const
      });
    });
    
    return nodes;
  })(),

  // BATTALION FACTION BRANCH - Two paths: Heavy Weapons & Support
  ...(() => {
    const baseAngle = 4 * Math.PI / 3; // Battalion branch angle
    
    // PATH 1: Heavy Weapons (upper path)
    const heavyWeaponsPath = [
      { id: 'battalion-smg', name: 'Battalion SMG', description: 'Military-grade submachine gun with rapid-fire capability', cost: 3000 },
      { id: 'mortar-nest', name: 'Mortar Nest', description: 'Indirect fire support weapon', cost: 6000 },
      { id: 'fragment-armor', name: 'Fragment Armor Plates', description: 'Heavy armor with explosive resistance', cost: 9000 },
      { id: 'ammo-press-battalion', name: 'Military Ammo Press', description: 'Specialized high-grade military ammunition production', cost: 12000 },
      { id: 'ranged-damage', name: 'Ranged Damage', description: 'All projectile weapons deal more damage (Passive +25% Damage)', cost: 15000 }
    ];
    
    // PATH 2: Support (lower path)
    const supportPath = [
      { id: 'tactical-optics', name: 'Tactical Optics', description: 'Extended weapon range and improved accuracy (Passive +25% Range)', cost: 3000 },
      { id: 'supply-cache', name: 'Supply Cache', description: 'Deployable ammunition and medical supply depot for team resupply', cost: 6000 },
      { id: 'field-ration-kit', name: 'Field Ration Kit', description: 'Efficient nutrition for extended operations', cost: 9000 },
      { id: 'max-hp', name: 'Max HP', description: 'Enhanced physical conditioning (Passive +20% Health)', cost: 12000 },
      { id: 'rally-cry', name: 'Rally Cry', description: 'Allies in 20m: +25% reload speed, -20% recoil for 20s, 60s cooldown (Ultimate)', cost: 15000 }
    ];
    
    const nodes: any[] = [];
    
    // Add heavy weapons path (upper arc)
    heavyWeaponsPath.forEach((node, i) => {
      nodes.push({
        id: node.id,
        name: node.name,
        description: node.description,
        cost: node.cost,
        tier: 7 + i,
        faction: 'battalion',
        prerequisites: i === 0 ? ['unlock-battalion'] : [heavyWeaponsPath[i - 1].id],
        position: getRadialPosition(baseAngle - 0.3, 780 + (i * 80)), // Upper path
        category: getCategoryFromId(node.id),
        status: 'locked' as const
      });
    });
    
    // Add support path (lower arc)
    supportPath.forEach((node, i) => {
      nodes.push({
        id: node.id,
        name: node.name,
        description: node.description,
        cost: node.cost,
        tier: 7 + i,
        faction: 'battalion',
        prerequisites: i === 0 ? ['unlock-battalion'] : [supportPath[i - 1].id],
        position: getRadialPosition(baseAngle + 0.3, 780 + (i * 80)), // Lower path
        category: getCategoryFromId(node.id),
        status: 'locked' as const
      });
    });
    
    return nodes;
  })(),

  // ADMIRALTY FACTION BRANCH - Two paths: Naval & Weather Control
  ...(() => {
    const baseAngle = 5 * Math.PI / 3; // Admiralty branch angle
    
    // PATH 1: Naval (upper path)
    const navalPath = [
      { id: 'tide-beacon', name: 'Tide Beacon', description: 'Maritime spawn point and navigation aid', cost: 3000 },
      { id: 'storm-sail-raft', name: 'Storm Sail Raft', description: 'Fast water transportation vehicle', cost: 6000 },
      { id: 'net-cannon', name: 'Net Cannon', description: 'Fishing enhancement and entanglement weapon', cost: 9000 },
      { id: 'luminous-buoy', name: 'Luminous Buoy', description: 'Mini-lighthouse for navigation and area lighting', cost: 12000 },
      { id: 'naval-command', name: 'Naval Command', description: 'Maritime supremacy: allied vessels gain speed, crew swim faster, cold immunity (Passive)', cost: 15000 }
    ];
    
    // PATH 2: Weather Control (lower path)
    const weatherPath = [
      { id: 'saltwater-desal', name: 'Saltwater Desal Unit', description: 'Convert seawater to clean drinking water', cost: 3000 },
      { id: 'weathercock-tower', name: 'Weathercock Tower', description: 'Force moderate rain in area, boosting crop yield temporarily', cost: 6000 },
      { id: 'weather-resistance', name: 'Weather Resistance', description: 'Reduced environmental damage (Passive +15% Resistance)', cost: 9000 },
      { id: 'tide-gauge', name: 'Tide Gauge', description: 'Boosts crop growth after rain events', cost: 12000 },
      { id: 'tempest-call', name: 'Tempest Call', description: 'Summon a heavy storm at targeted location, damages enemies and structures, 90s cooldown (Ultimate)', cost: 15000 }
    ];
    
    const nodes: any[] = [];
    
    // Add naval path (upper arc)
    navalPath.forEach((node, i) => {
      nodes.push({
        id: node.id,
        name: node.name,
        description: node.description,
        cost: node.cost,
        tier: 7 + i,
        faction: 'admiralty',
        prerequisites: i === 0 ? ['unlock-admiralty'] : [navalPath[i - 1].id],
        position: getRadialPosition(baseAngle - 0.3, 780 + (i * 80)), // Upper path
        category: getCategoryFromId(node.id),
        status: 'locked' as const
      });
    });
    
    // Add weather control path (lower arc)
    weatherPath.forEach((node, i) => {
      nodes.push({
        id: node.id,
        name: node.name,
        description: node.description,
        cost: node.cost,
        tier: 7 + i,
        faction: 'admiralty',
        prerequisites: i === 0 ? ['unlock-admiralty'] : [weatherPath[i - 1].id],
        position: getRadialPosition(baseAngle + 0.3, 780 + (i * 80)), // Lower path
        category: getCategoryFromId(node.id),
        status: 'locked' as const
      });
    });
    
    return nodes;
  })()
];

// Helper function to get nodes by tier
export const getNodesByTier = (tier: number): MemoryGridNode[] => {
  return MEMORY_GRID_NODES.filter(node => node.tier === tier) as MemoryGridNode[];
};

// Helper function to get nodes by faction
export const getNodesByFaction = (factionId?: string): MemoryGridNode[] => {
  return MEMORY_GRID_NODES.filter(node => (node as any).faction === factionId) as MemoryGridNode[];
};

// Helper function to check if a node is available for purchase
export const isNodeAvailable = (nodeId: string, purchasedNodes: Set<string>): boolean => {
  const node = MEMORY_GRID_NODES.find(n => n.id === nodeId);
  if (!node) return false;
  
  // Special case: Faction unlock nodes only need ANY ONE tier 5 node
  if (nodeId.includes('unlock-')) {
    const tier5Nodes = ['plasma-rifle', 'automated-harvester', 'teleporter', 'mobile-shield', 'drone-swarm', 'fortified-bunker'];
    return tier5Nodes.some((tier5Id: string) => purchasedNodes.has(tier5Id));
  }
  
  // FFX-style logic: Need ANY ONE prerequisite (OR logic), not all (AND logic)
  // This allows true sideways movement and branching like FFX Sphere Grid
  return node.prerequisites.some((prereqId: string) => purchasedNodes.has(prereqId));
}; 