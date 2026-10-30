export default {
  slug: 'how-we-built-broth-bullets-multiplayer-survival-game',
  title: 'How We Built Broth & Bullets: A 2D Multiplayer Survival Game',
  subtitle: 'From concept to playable alpha - the complete development story',
  date: '2025-11-17',
  author: 'Martin Erlic',
  authorImage: '/images/blog/author-marty.jpg',
  authorTwitter: 'metalhorse233',
  excerpt: 'The complete story of building Broth & Bullets, a real-time multiplayer survival game set in the Aleutian Islands. Learn about our technical decisions, gameplay mechanics, and lessons learned.',
  tags: ['Broth & Bullets', 'Game Development', 'Multiplayer', 'Survival Games', 'Indie Games', 'Case Study'],
  coverImage: '/images/blog/how-we-built-broth-bullets-cover.jpg',
  content: `
    <p>Broth & Bullets is a 2D multiplayer survival game where genetically enhanced operatives fight to survive on a mysterious Aleutian island. After months of development, we're sharing the complete story of how we built it - the technical decisions, gameplay innovations, and hard lessons learned along the way.</p>

    <h2>🎮 What is Broth & Bullets?</h2>

    <p>Broth & Bullets combines the tension of survival games like Rust and DayZ with the accessibility of 2D top-down gameplay. Players scavenge resources, craft items, build bases, and fight for survival in a persistent multiplayer world where every decision matters.</p>

    <h3>Core Features</h3>

    <ul>
      <li><strong>Real-Time Multiplayer</strong>: Persistent world with dozens of concurrent players</li>
      <li><strong>Deep Crafting System</strong>: Over 100 craftable items including weapons, tools, and consumables</li>
      <li><strong>Field Cauldron Cooking</strong>: Unique cooking mechanics with AI-generated recipes</li>
      <li><strong>Base Building</strong>: Construct walls, doors, storage, and defensive structures</li>
      <li><strong>Dynamic Weather</strong>: Rain, storms, and environmental hazards affect gameplay</li>
      <li><strong>PvP Combat</strong>: Tactical gunplay with realistic ballistics and weapon variety</li>
      <li><strong>Resource Gathering</strong>: Chop trees, mine rocks, forage mushrooms and berries</li>
      <li><strong>Procedural World</strong>: 10,000×10,000 unit map with diverse biomes</li>
    </ul>

    <h2>🌍 The Setting: Kamchatka Peninsula</h2>

    <p>We chose the Aleutian Islands and Kamchatka Peninsula as our setting for several reasons:</p>

    <ul>
      <li><strong>Harsh Environment</strong>: Cold, rainy, and unforgiving - perfect for survival gameplay</li>
      <li><strong>Rich Flora</strong>: Diverse plant life enables our cooking and crafting systems</li>
      <li><strong>Military History</strong>: Cold War installations provide lore and exploration opportunities</li>
      <li><strong>Visual Aesthetic</strong>: Misty forests, rocky coastlines, and volcanic terrain create atmosphere</li>
      <li><strong>Isolation</strong>: Remote location justifies the "stranded survivors" premise</li>
    </ul>

    <h2>🎨 Art Direction: The Babushka Aesthetic</h2>

    <p>One of Broth & Bullets' most distinctive features is its unique art style. We call it the "Babushka aesthetic" - a blend of Eastern European folk art, Soviet-era industrial design, and modern pixel art techniques. For a deep dive into our art direction philosophy, read our article on <a href="/blog/babushka-art-direction-broth-bullets">the Babushka aesthetic</a>.</p>

    <h3>Character Design</h3>

    <p>Our player characters are genetically enhanced operatives called "Babushkas" - a playful reference to Russian grandmothers, but these are far from ordinary. They wear tactical gear with Eastern European flair, combining functionality with cultural identity.</p>

    <ul>
      <li><strong>Sprite Resolution</strong>: 32×32 base sprites with detailed animations</li>
      <li><strong>Color Palette</strong>: Muted earth tones with pops of Soviet red and military green</li>
      <li><strong>Animation States</strong>: Idle, walking (4 directions), gathering, combat, crafting</li>
      <li><strong>Equipment Layering</strong>: Visible armor, weapons, and accessories</li>
    </ul>

    <h3>World Design</h3>

    <p>The game world features hand-crafted tilesets that evoke the rugged beauty of the Aleutian Islands:</p>

    <ul>
      <li><strong>Terrain Types</strong>: Grass, dirt, sand, rock, snow, water</li>
      <li><strong>Vegetation</strong>: Pine trees, birch trees, berry bushes, mushrooms, wildflowers</li>
      <li><strong>Structures</strong>: Abandoned Soviet installations, fishing villages, military bunkers</li>
      <li><strong>Weather Effects</strong>: Rain particles, fog overlays, dynamic lighting</li>
    </ul>

    <h2>⚙️ Technical Architecture</h2>

    <p>Building a real-time multiplayer game requires careful technical decisions. Here's what we chose and why:</p>

    <h3>Server: SpacetimeDB</h3>

    <p>We chose SpacetimeDB as our backend, and it was one of the best decisions we made:</p>

    <ul>
      <li><strong>No Backend Code</strong>: Game logic runs directly in the database as Rust code compiled to WebAssembly</li>
      <li><strong>Automatic Sync</strong>: State changes automatically propagate to all connected clients</li>
      <li><strong>Built-in Spatial Queries</strong>: Chunk-based subscriptions make large worlds feasible</li>
      <li><strong>Sub-50ms Latency</strong>: Players experience responsive, real-time gameplay</li>
      <li><strong>Transactional Logic</strong>: All game actions are atomic and consistent</li>
    </ul>

    <p><strong>Why not traditional servers?</strong> We prototyped with Node.js + Socket.io + PostgreSQL first. It worked, but required 15,000 lines of synchronization code and constant bug fixes. SpacetimeDB reduced our backend to 1,500 lines with zero sync bugs.</p>

    <h3>Client: React + Canvas</h3>

    <p>For the client, we built a custom React-based game engine:</p>

    <ul>
      <li><strong>React</strong>: Component-based UI for inventory, crafting menus, and HUD</li>
      <li><strong>Canvas API</strong>: High-performance 2D rendering for the game world</li>
      <li><strong>TypeScript</strong>: Type safety prevents runtime errors</li>
      <li><strong>Custom Hooks</strong>: Reusable game logic (input handling, entity filtering, etc.)</li>
    </ul>

    <h3>Performance Optimizations</h3>

    <p>To maintain 60 FPS with dozens of players and thousands of entities, we implemented:</p>

    <ul>
      <li><strong>Spatial Subscriptions</strong>: Only load entities within viewport + buffer zone</li>
      <li><strong>Viewport Culling</strong>: Only render visible entities</li>
      <li><strong>Sprite Batching</strong>: Group similar sprites into single draw calls</li>
      <li><strong>Entity Pooling</strong>: Reuse objects instead of creating new ones</li>
      <li><strong>Throttled Updates</strong>: Position updates limited to 20/second per player</li>
    </ul>

    <h2>🎯 Core Gameplay Systems</h2>

    <h3>1. Resource Gathering</h3>

    <p>Players gather resources from the environment to survive:</p>

    <ul>
      <li><strong>Trees</strong>: Provide wood and sticks for crafting and fuel</li>
      <li><strong>Rocks</strong>: Yield stone and flint for tools and building</li>
      <li><strong>Mushrooms</strong>: Foraged for food and medicinal properties</li>
      <li><strong>Berry Bushes</strong>: Quick food source with respawn mechanics</li>
      <li><strong>Barrels</strong>: Scavenged for random loot and supplies</li>
    </ul>

    <p>Resources have health values and respawn after 60 seconds when depleted, creating strategic decisions about when and where to gather.</p>

    <h3>2. Crafting System</h3>

    <p>Over 100 craftable items organized into categories:</p>

    <ul>
      <li><strong>Tools</strong>: Axe, pickaxe, knife, fishing rod</li>
      <li><strong>Weapons</strong>: Pistols, rifles, shotguns, melee weapons</li>
      <li><strong>Armor</strong>: Helmets, vests, boots with damage reduction</li>
      <li><strong>Building</strong>: Walls, doors, chests, campfires, cauldrons</li>
      <li><strong>Consumables</strong>: Food, water, healing items, buffs</li>
      <li><strong>Containers</strong>: Water jugs, bottles, backpacks</li>
    </ul>

    <p>Each recipe requires specific ingredients and crafting stations, creating progression paths and specialization opportunities.</p>

    <h3>3. Field Cauldron Cooking</h3>

    <p>The signature feature of Broth & Bullets is the Field Cauldron - a sophisticated cooking system that brings the "Broth" in our name to life. Learn more in our <a href="/blog/broth-bullets-cooking-system-emergent-gameplay">cooking system deep dive</a>:</p>

    <ul>
      <li><strong>Water Management</strong>: Fill cauldrons with freshwater or desalinate seawater</li>
      <li><strong>Ingredient Slots</strong>: Combine up to 3 ingredients per recipe</li>
      <li><strong>AI Recipe Generation</strong>: Claude AI generates unique food items based on ingredients</li>
      <li><strong>Campfire Integration</strong>: Cauldrons must be placed on burning campfires</li>
      <li><strong>Rain Collection</strong>: Exposed cauldrons automatically fill during rainfall</li>
      <li><strong>Medicinal Preparations</strong>: Create healing potions and status effect remedies</li>
    </ul>

    <p>This system creates emergent gameplay where players discover recipes, share knowledge, and specialize in cooking for their team.</p>

    <h3>4. Base Building</h3>

    <p>Players construct bases to protect resources and establish territory:</p>

    <ul>
      <li><strong>Walls</strong>: Basic defensive structures with health and durability</li>
      <li><strong>Doors</strong>: Access control with ownership mechanics</li>
      <li><strong>Chests</strong>: Secure storage for items and resources</li>
      <li><strong>Campfires</strong>: Cooking, warmth, and light sources</li>
      <li><strong>Rain Collectors</strong>: Passive water gathering during storms</li>
    </ul>

    <p>Buildings can be damaged and destroyed in PvP, creating risk-reward decisions about base location and defense.</p>

    <h3>5. Combat System</h3>

    <p>PvP combat is tactical and skill-based:</p>

    <ul>
      <li><strong>Realistic Ballistics</strong>: Bullets have travel time and drop</li>
      <li><strong>Weapon Variety</strong>: Different guns with unique stats and handling</li>
      <li><strong>Armor System</strong>: Damage reduction based on equipped gear</li>
      <li><strong>Health Management</strong>: Healing requires consumables and time</li>
      <li><strong>Death Penalties</strong>: Drop inventory on death, respawn at spawn point</li>
    </ul>

    <h2>🌧️ Dynamic Weather System</h2>

    <p>Weather isn't just visual - it affects gameplay in meaningful ways:</p>

    <ul>
      <li><strong>Rain</strong>: Fills rain collectors and exposed cauldrons, extinguishes uncovered campfires</li>
      <li><strong>Tree Coverage</strong>: Trees protect campfires from rain, creating strategic placement decisions</li>
      <li><strong>Visibility</strong>: Fog and rain reduce sight distance, affecting combat</li>
      <li><strong>Temperature</strong>: Cold weather drains stamina faster, requiring warm clothing or fires</li>
    </ul>

    <h2>🗺️ World Generation</h2>

    <p>The 10,000×10,000 unit world is procedurally generated using Perlin noise:</p>

    <ul>
      <li><strong>Biomes</strong>: Forest, plains, desert, snow determined by elevation and moisture</li>
      <li><strong>Resource Distribution</strong>: Different biomes spawn different resources</li>
      <li><strong>Chunk System</strong>: World divided into 256×256 unit chunks for efficient loading</li>
      <li><strong>Points of Interest</strong>: Abandoned structures, resource clusters, strategic locations</li>
    </ul>

    <h2>📊 Development Metrics</h2>

    <p>Here's what we've built so far:</p>

    <ul>
      <li><strong>Development Time</strong>: 8 months from concept to alpha</li>
      <li><strong>Code Base</strong>: ~15,000 lines of Rust (server) + ~25,000 lines of TypeScript (client)</li>
      <li><strong>Assets</strong>: 500+ sprites, 50+ sound effects, custom tilesets</li>
      <li><strong>Items</strong>: 100+ craftable items with unique properties</li>
      <li><strong>Recipes</strong>: 50+ crafting recipes + infinite AI-generated cooking recipes</li>
      <li><strong>Map Size</strong>: 10,000×10,000 units (equivalent to ~2.5km²)</li>
      <li><strong>Concurrent Players</strong>: Currently supports 50+ players simultaneously</li>
    </ul>

    <h2>🎓 Lessons Learned</h2>

    <h3>What Worked</h3>

    <ul>
      <li><strong>SpacetimeDB</strong>: Eliminated entire categories of bugs and reduced backend code by 90%</li>
      <li><strong>Unique Art Style</strong>: The Babushka aesthetic makes us instantly recognizable</li>
      <li><strong>Field Cauldron</strong>: Players love the cooking system - it's our signature feature</li>
      <li><strong>Spatial Subscriptions</strong>: Enabled large worlds without performance issues</li>
      <li><strong>Early Alpha Testing</strong>: Player feedback shaped critical design decisions</li>
    </ul>

    <h3>What We'd Do Differently</h3>

    <ul>
      <li><strong>Start with Spatial Subscriptions</strong>: We initially loaded the entire world, causing performance issues</li>
      <li><strong>More Playtesting</strong>: Some balance issues only appeared with real players</li>
      <li><strong>Better Asset Pipeline</strong>: We rebuilt sprites multiple times - should have planned better</li>
      <li><strong>Earlier Combat Tuning</strong>: PvP balance took longer than expected to get right</li>
    </ul>

    <h2>🚀 Current Status & Roadmap</h2>

    <h3>Alpha Status (Now)</h3>

    <ul>
      <li>✅ Core gameplay loop complete</li>
      <li>✅ Multiplayer working with 50+ concurrent players</li>
      <li>✅ Resource gathering and crafting systems</li>
      <li>✅ Base building mechanics</li>
      <li>✅ PvP combat with multiple weapons</li>
      <li>✅ Field Cauldron cooking (in progress)</li>
      <li>✅ Dynamic weather system</li>
    </ul>

    <h3>Coming Soon</h3>

    <ul>
      <li><strong>AI Recipe Generation</strong>: Complete integration of Claude AI for cooking</li>
      <li><strong>More Weapons</strong>: Expanded arsenal with unique characteristics</li>
      <li><strong>Farming System</strong>: Plant seeds and grow crops</li>
      <li><strong>Fishing</strong>: Coastal and river fishing mechanics</li>
      <li><strong>Quests & Objectives</strong>: Structured goals beyond pure survival</li>
      <li><strong>Clan System</strong>: Team mechanics for cooperative play</li>
    </ul>

    <h2>🎮 Play Broth & Bullets</h2>

    <p>Broth & Bullets is currently in alpha testing. We're running regular test weekends where players can jump in, explore the island, and help shape the game's development.</p>

    <ul>
      <li><strong>Play Now</strong>: <a href="https://brothbullets.com" target="_blank" rel="noopener noreferrer">brothbullets.com</a></li>
      <li><strong>Join Discord</strong>: <a href="https://discord.gg/tUcBzfAYfs" target="_blank" rel="noopener noreferrer">Get alpha access and updates</a></li>
      <li><strong>Follow Development</strong>: <a href="https://twitter.com/metalhorse233" target="_blank" rel="noopener noreferrer">@metalhorse233 on Twitter</a></li>
    </ul>

    <h2>💡 For Other Developers</h2>

    <p>If you're building a multiplayer game, here are our key recommendations:</p>

    <ol>
      <li><strong>Choose the Right Tools</strong>: SpacetimeDB saved us months of work - pick tools that eliminate complexity</li>
      <li><strong>Start Small</strong>: We built core mechanics first, then expanded - don't try to build everything at once</li>
      <li><strong>Playtest Early</strong>: Real players find issues you never will - get feedback ASAP</li>
      <li><strong>Optimize from Day One</strong>: Spatial subscriptions should be built in from the start, not added later</li>
      <li><strong>Make Something Unique</strong>: The Field Cauldron and Babushka aesthetic set us apart - find your unique hook</li>
    </ol>

    <h2>🔗 Learn More</h2>

    <p>Interested in the technical details? Check out our other articles:</p>

    <ul>
      <li><a href="/blog/babushka-art-direction-broth-bullets">Babushka Art Direction: Creating Broth & Bullets' Unique Visual Style</a></li>
      <li><a href="/blog/field-cauldron-mechanics">The Field Cauldron: Brewing Innovation in Survival Gameplay</a></li>
      <li><a href="/blog/broth-bullets-spacetimedb-architecture">Why Broth & Bullets Uses SpacetimeDB Instead of Traditional Game Servers</a></li>
      <li><a href="/blog/minimap-spatial-subscriptions">The Hardlight Map: Spatial Awareness in a 2D World</a></li>
    </ul>

    <p>Questions about Broth & Bullets? Join our <a href="https://discord.gg/tUcBzfAYfs" target="_blank" rel="noopener noreferrer">Discord community</a> and chat with the dev team!</p>
  `
};

