export default {
  slug: "broth-bullets-january-2026-update",
  title: "Closing In: January 2026 Development Update",
  subtitle: "New monuments, tree planting, food preservation, auto turrets, and a complete game loop taking shape",
  date: "2026-01-26",
  author: "Martin Erlic",
  authorImage: "/images/blog/author-marty.jpg",
  authorTwitter: "metalhorse233",
  excerpt: "It's been a while since our last update. The production server has been wiped a few times as we add new systems, but we're closing in on something special. Here's what we've shipped recently and where Broth & Bullets is headed.",
  coverImage: "/images/blog/january-2026-update-cover.jpg",
  content: `
    <p>It's been a minute since our last development update, and a lot has happened. We've been heads-down building, breaking, and rebuilding systems as Broth & Bullets evolves from a promising alpha into something that's starting to feel like a complete game.</p>

    <p>The short version? <strong>We're closing in.</strong> The full game loop is taking shape, and we're getting excited about what comes next - more distribution, podcasts, YouTube shorts, gameplay clips, and opening up the beta to more players.</p>

    <h2>🔧 Production Server Status: Controlled Chaos</h2>

    <p>Let's address the elephant in the room: the production server has been unstable. We've wiped it several times over the past months as we've added new items, systems, and changed the database schema.</p>

    <p>This is expected with SpacetimeDB - when you change your data model significantly, sometimes a clean wipe is the cleanest path forward. It's not ideal for persistence, but it's let us iterate rapidly on core systems without being held back by legacy data structures.</p>

    <p>The good news? We're stabilizing. Each wipe gets us closer to a schema that won't need to change dramatically, and we're building confidence that the next major version will be the foundation for long-term persistence.</p>

    <h2>🏛️ New Monuments In Progress</h2>

    <p>Monuments are the backbone of exploration and progression in Broth & Bullets. Here's what we're building:</p>

    <h3>Completed This Sprint ✅</h3>

    <ul>
      <li><strong>Reed Marsh</strong> - Wetland areas along rivers and lakes. Lots of terns, reed spawns, water barrels, and Memory Shards. A great early-game foraging destination.</li>
      <li><strong>Whale Bone Graveyard</strong> - Beach monument featuring the skeletal remains of massive sea creatures. Atmospheric and full of scavengeable materials.</li>
      <li><strong>Hunting Village</strong> - Forest monument where you can acquire the Wild Animal Pheromone buff. This induces hostile spawning - but for wild animals instead of apparitions. Costs Memory Shards and lasts 5 minutes per buff. High risk, high reward hunting.</li>
    </ul>

    <h3>In Development ⏳</h3>

    <ul>
      <li><strong>Kelp Cathedral</strong> - An underwater monument shrouded in towering kelp forests. Mysterious and treacherous.</li>
      <li><strong>Underwater Lab</strong> - One per map, located in the main lake. What were they researching down there?</li>
      <li><strong>Crashed Research Plane</strong> - What cargo was this aircraft carrying when it went down?</li>
      <li><strong>Abandoned Weather Station</strong> - High-altitude monument with unique environmental interactions.</li>
      <li><strong>Burial Mound Field</strong> - Features unique apparition spawns at night. The dead don't rest easy here.</li>
      <li><strong>Abandoned Hot Springs Bath House</strong> - An addition to existing hot springs biomes with loot crates and atmosphere.</li>
    </ul>

    <h2>✅ Recently Shipped Systems</h2>

    <p>Beyond monuments, we've shipped a bunch of core systems over the past few weeks:</p>

    <h3>Loot Crates</h3>
    <p>Food and materials loot crates now spawn on roads and at monuments. They're openable containers that extend our wooden storage box system - when you empty one, it disappears. Creates natural looting loops and gives roads more purpose.</p>

    <h3>Fishing & Crab Traps</h3>
    <p>Passive fishing is finally here. Place a trap near the shore (must be reachable without swimming), bait it with food, and come back later for fish or crabs. It's a slower, more methodical form of fishing that rewards planning.</p>

    <h3>The Pantry</h3>
    <p>We've converted the fridge concept into a Pantry - a dedicated food preservation station that can keep items fresh for up to a real-world game week. Essential for long-term survival and planning ahead.</p>

    <h3>Tallow-Steam Bolt Launcher (Auto Turret)</h3>
    <p>Defend your base against nighttime raids with automated turrets. The Tallow-Steam Bolt Launcher uses steam pressure and animal fat to launch projectiles at hostile NPCs. It's not elegant, but it works.</p>

    <h3>Combat Readiness System</h3>
    <p>Nighttime hostile NPC spawn rates now scale based on your equipped weapons and inventory. The game watches what you're carrying and adjusts the challenge accordingly.</p>

    <h3>Item Interaction Panel Improvements</h3>
    <p>You can now access the ItemInteractionPanel directly from the Hotbar and ExternalContainerUI. Quality of life improvement that reduces menu friction.</p>

    <h3>Quarry Doodads</h3>
    <p>Large quarries now feature mine carts, crates, and other industrial set dressing. Small details that make the world feel more lived-in.</p>

    <h3>Tree Planting</h3>
    <p>You can now grow your own trees. Collect birch catkins or pinecones as secondary yields when harvesting trees, then plant them like any other seed. They grow through the same stages as harvestable crops, but when complete, they produce a full tree entity. Unlike wild trees, planted trees don't respawn when cut down - so plan your lumber operations carefully. Tree bark is also now a secondary yield from any tree harvest.</p>

    <h3>Storm Damage & Drying</h3>
    <p>Storms now destroy plants and leave behind soggy plant fiber. Rather than waste it, toss it in a furnace or campfire to dry it out. Same goes for fish, seaweed, and other perishables - dried items last dramatically longer in storage.</p>

    <h2>🔜 Coming Soon</h2>

    <p>The pipeline is full. Here's what's next on the roadmap:</p>

    <ul>
      <li><strong>Water Animals</strong> - King crabs in deeper waters (you'll need to swim for these), salmon sharks native to the Aleutian Islands, and jellyfish drifting through the coastal zones.</li>
      <li><strong>NPC Quest Givers</strong> - Stationed at existing monuments to extend tutorial quest lines and unlock new daily quest slots from monument-specific pools.</li>
      <li><strong>Ranged Apparition Attacks</strong> - If you're using a ranged weapon, apparitions will return fire. Same for snakes with venom spittle.</li>
      <li><strong>Bear Traps</strong> - Ground traps that damage hostile NPCs, animals, and PvP-enabled players. Re-engage with E, or hold E to pick up.</li>
      <li><strong>Grenades & Flares</strong> - Throwable tools that either explode/damage/leave fire patches or light up areas for a set duration.</li>
      <li><strong>Food Processing</strong> - Drying, pickling, and fermenting for vinegars, wines, and preserved foods.</li>
      <li><strong>Animal Husbandry</strong> - Chicken coops, bee hives, and caribou herding for sustainable food production.</li>
    </ul>

    <h2>🎮 The Game Loop is Real</h2>

    <p>We're almost at a complete game loop. Here's what that looks like right now:</p>

    <ul>
      <li><strong>Progression</strong> - Collect Memory Shards, unlock blueprints, advance through tech trees.</li>
      <li><strong>Farming</strong> - A huge variety of crops, seasonal planting, and animal husbandry options (soon).</li>
      <li><strong>Weather</strong> - Dynamic weather system that affects gameplay, farming, and survival.</li>
      <li><strong>Combat</strong> - Melee weapons, ranged weapons, and our first two guns are in-game.</li>
      <li><strong>Crafting</strong> - We've tuned crafting times and resource costs to feel lightweight - more fast-paced roguelike than slow Rust grind.</li>
      <li><strong>Building</strong> - Starter shelters and a tile-based building system exist, though we've learned that 2D games have better things to focus on than elaborate base building.</li>
      <li><strong>Events</strong> - Memory Beacon events spawn and last 90 minutes (3 game days), challenging players with larger waves of Memory Apparitions.</li>
      <li><strong>Scaling</strong> - Every night, apparitions appear and scale with player level, recently crafted equipment, and unlocks. The world grows with you.</li>
    </ul>

    <h2>📢 What's Next Beyond Development</h2>

    <p>We're not just building the game - we're preparing to share it more broadly. Over the coming months, expect:</p>

    <ul>
      <li><strong>Podcasts</strong> - We'll be talking about Broth & Bullets, SpacetimeDB, and indie game development on various shows.</li>
      <li><strong>YouTube Shorts</strong> - Quick gameplay clips showcasing the chaos of multiplayer survival.</li>
      <li><strong>Gameplay Sharing</strong> - More community content, streams, and player-generated clips.</li>
      <li><strong>Beta Distribution</strong> - Opening up access to more players as the core loop stabilizes.</li>
    </ul>

    <p>We're genuinely excited about where this is going. The foundation is solid, the systems are connecting, and the world is starting to feel alive.</p>

    <h2>🎮 Play Broth & Bullets</h2>

    <p>Want to see where we are right now? Broth & Bullets is playable in alpha. Jump in, experience the current state of the game, and help us shape what comes next.</p>

    <p><a href="/" class="cta-link">→ Play Broth & Bullets Alpha (Free)</a></p>

    <p><a href="https://discord.gg/tUcBzfAYfs" target="_blank" rel="noopener noreferrer" class="cta-link">→ Join the Discord Community</a></p>

    <p>Your feedback directly influences development. Every bug report, suggestion, and gameplay session helps us build a better game.</p>

    <p>Thanks for sticking with us. We're closing in.</p>

    <h2>🔗 Related Articles</h2>

    <ul>
      <li><a href="/blog/broth-bullets-alpha-launch">Broth & Bullets Alpha Now Live</a> - Our original alpha launch announcement</li>
      <li><a href="/blog/how-we-built-broth-bullets-multiplayer-survival-game">How We Built Broth & Bullets</a> - The complete development story</li>
      <li><a href="/blog/diegetic-ui-design-sova">Diegetic Design: Why Every UI Element Exists In-World</a> - Deep dive into our UI philosophy</li>
      <li><a href="/blog/broth-bullets-spacetimedb-architecture">Why Broth & Bullets Uses SpacetimeDB</a> - Technical architecture deep dive</li>
    </ul>
  `,
  tags: ["Development Update", "Broth & Bullets", "SpacetimeDB", "Survival Games", "Multiplayer Gaming", "Indie Game Development", "Alpha Testing", "Game Loop", "Monuments", "Tree Planting", "Crafting System", "Food Preservation", "Auto Turrets"]
};
