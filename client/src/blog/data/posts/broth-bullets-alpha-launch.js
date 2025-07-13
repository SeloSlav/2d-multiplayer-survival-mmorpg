export default {
  slug: "broth-bullets-alpha-launch",
  title: "Broth & Bullets Alpha Now Live: Survival in the Subarctic Tundra",
  subtitle: "Hunt, farm, craft, and fight for survival with seasonal crops, pack hunting wolves, and multiplayer PvP",
  date: "2025-01-15",
  author: "Martin Erlic",
  authorImage: "/images/blog/author-marty.jpg",
  authorTwitter: "seloslav",
  excerpt: "The Broth & Bullets alpha is now available! Featuring AI systems, 3D audio, seasonal farming mechanics, and SpacetimeDB integration. Play now at www.brothandbullets.com",
  coverImage: "/images/blog/alpha-launch-cover.jpg",
  content: `
    <h2>The Alpha is Here - Play Now at www.brothandbullets.com</h2>
    
    <p>After months of development, we're excited to announce that the Broth & Bullets alpha is now live and available to play at <strong><a href="http://www.brothandbullets.com" target="_blank" rel="noopener noreferrer">www.brothandbullets.com</a></strong>. We've been working on our take on survival games, focusing on features that make multiplayer survival feel more dynamic and engaging.</p>
    
    <p>The alpha includes a bunch of interconnected survival systems - from seasonal farming that changes throughout the year to wildlife that actually behaves like real animals. Everything from weather affecting your campfires to pack hunting wolves creates a world that feels alive and challenging.</p>
    
          <div class="image-container text-center mb-4">
        <img src="/images/blog/alpha-gameplay-overview.jpg" alt="Broth & Bullets Alpha Gameplay Overview" data-caption="Player starting their survival journey in a forest during rainfall" class="blog-image-full mx-auto" />
        <p class="image-caption text-sm text-gray-600 mt-2">Player starting their survival journey in a forest during rainfall</p>
      </div>
    
    <h2>Complete Inventory and Storage Systems</h2>
    
    <p>Our alpha features a fully implemented inventory management system that seamlessly integrates with world interactions. Players can:</p>
    
    <ul>
      <li><strong>Stack Management</strong> - Split items with intuitive mouse controls (middle-click to halve, shift-drag for thirds)</li>
      <li><strong>Wooden Storage Boxes</strong> - Persistent storage that survives server restarts and player sessions</li>
      <li><strong>Real-time Synchronization</strong> - All inventory changes are instantly reflected across all connected players</li>
      <li><strong>Drag-and-Drop Interface</strong> - Intuitive item management that feels natural and responsive</li>
    </ul>
    
          <div class="image-container text-center mb-4">
        <img src="/images/blog/inventory-system-screenshot.jpg" alt="Inventory Management System" data-caption="Inventory management with real-time multiplayer synchronization" class="blog-image-full mx-auto" />
        <p class="image-caption text-sm text-gray-600 mt-2">Inventory management with real-time multiplayer synchronization</p>
      </div>
    
    <h2>Functional Campfires and Furnaces</h2>
    
    <p>Survival mechanics come alive with our fully operational heating and cooking systems:</p>
    
    <ul>
      <li><strong>Working Campfires</strong> - Cook raw food, provide warmth, and serve as social gathering points</li>
      <li><strong>Furnace Systems</strong> - Smelt ores into usable materials for advanced crafting</li>
      <li><strong>Temperature Management</strong> - Fires provide crucial warmth during cold weather conditions</li>
      <li><strong>Fuel Systems</strong> - Manage wood and fuel resources to keep fires burning</li>
    </ul>
    
    <h2>Wildlife AI Systems</h2>
    
    <p>Our wildlife isn't just decorative - these animals have behavioral patterns that create interesting ecosystem dynamics:</p>
    
    <ul>
      <li><strong>Wolf Pack Formation</strong> - Wolves hunt in coordinated groups. Large enough packs will ignore your torches and campfires, attacking anyway</li>
      <li><strong>Opportunistic Foxes</strong> - Foxes scavenge and take advantage of situations, often appearing when you're distracted or vulnerable</li>
      <li><strong>Defensive Vipers</strong> - Vipers avoid confrontation until you get close, but don't let you cheese them from range - they'll spit poison at distant threats</li>
      <li><strong>Interactive Walruses</strong> - These massive creatures respond dynamically to feeding, creating opportunities for peaceful interaction or territorial conflicts</li>
      <li><strong>Predator-Prey Relationships</strong> - Animals interact with each other and the environment in realistic ways</li>
    </ul>
    
    <div class="image-container text-center mb-4">
      <img src="/images/blog/wildlife-ai-systems.jpg" alt="Advanced Wildlife AI in Action" data-caption="Feed a walrus and it may follow you — useful for distracting or defending against wolves" class="blog-image-full mx-auto" />
      <p class="text-sm text-gray-600 mt-2">
        Feed a walrus and it may follow you — useful for distracting or defending against wolves.
      </p>
    </div>
    
    <h2>3D Audio System</h2>
    
    <p>We've implemented positional audio to make the world feel more alive:</p>
    
    <ul>
      <li><strong>Positional Audio</strong> - Campfires emit realistic crackling sounds that fade naturally with distance</li>
      <li><strong>Player Activity Sounds</strong> - Hear other players chopping trees, walking through grass, or working with tools</li>
      <li><strong>Environmental Audio</strong> - Wind, water, and wildlife create a living soundscape</li>
      <li><strong>Tactical Audio Cues</strong> - Use sound to locate other players, assess threats, and navigate the world</li>
    </ul>
    
    <h2>SpacetimeDB: The Tech Behind the Game</h2>
    
    <p>We're using SpacetimeDB, which has made building multiplayer features much more straightforward than traditional approaches:</p>
    
    <ul>
      <li><strong>Built Entirely in React</strong> - Our entire client is a React application that talks directly to SpacetimeDB</li>
      <li><strong>Real-time State Synchronization</strong> - Every game state change is automatically synchronized across all connected players</li>
      <li><strong>Minimal Backend Code</strong> - Complex multiplayer features that usually require weeks of backend work now take hours</li>
      <li><strong>Persistent Game World</strong> - All player actions, item placements, and world changes persist across server restarts</li>
      <li><strong>Time Travel Capabilities</strong> - The database can roll back and replay any game state, which enables some pretty cool AI features</li>
    </ul>
    
    <p>This tech stack has let us focus on gameplay rather than infrastructure, which is why we've been able to build so many features so quickly.</p>
    
    <h2>Crafting and Survival Systems</h2>
    
    <div class="image-container text-center mb-4">
      <img src="/images/blog/crafting-systems-overview.jpg" alt="Crafting and Cooking Systems" data-caption="From basic tools to cooked meals - comprehensive survival crafting" class="blog-image-full mx-auto" />
      <p class="image-caption text-sm text-gray-600 mt-2">From basic tools to cooked meals - comprehensive survival crafting</p>
    </div>
    
    <p>Survival in the harsh tundra requires mastery of multiple interconnected systems:</p>
    
    <ul>
      <li><strong>Crafting System</strong> - Create tools, weapons, and survival equipment from gathered resources</li>
      <li><strong>Cooking System</strong> - Transform raw ingredients into nourishing meals that provide various benefits</li>
      <li><strong>Fishing System</strong> - Cast lines into pristine waters for fresh protein sources</li>
      <li><strong>Resource Processing</strong> - Convert raw materials into usable components for advanced crafting</li>
    </ul>
    
    <h2>Dynamic Fishing with Environmental Response</h2>
    
    <p>Our fishing system responds to environmental conditions in real-time:</p>
    
    <ul>
      <li><strong>Time-of-Day Effects</strong> - Fish behavior changes between dawn, noon, dusk, and night</li>
      <li><strong>Weather Responsiveness</strong> - Storms, rain, and clear skies all affect fish activity patterns</li>
      <li><strong>Seasonal Variations</strong> - Different fish species become available as weather patterns shift</li>
      <li><strong>Location-Based Catches</strong> - Various water bodies yield different fish types and sizes</li>
    </ul>
    
    <h2>Seasonal Plant Growth and Farming</h2>
    
    <p>One of the more interesting systems we've built is how weather and seasons affect plant growth patterns. We've got over 40 different plant species, each with their own growing seasons:</p>
    
    <ul>
      <li><strong>Year-Round Plants</strong> - Hardy species like Boreal Nettle and Scurvy Grass grow in all seasons</li>
      <li><strong>Spring/Summer Plants</strong> - Chamomile and Mint thrive in warmer months</li>
      <li><strong>Autumn Specialists</strong> - Toxic plants like Wolfsbane and Belladonna prefer cooler weather</li>
      <li><strong>Winter Survivors</strong> - Some berries like Rowan Berries and Cranberries persist through winter</li>
    </ul>
    
    <p>Each server wipe cycles through all four seasons at least 5 times, so players get multiple chances to learn optimal planting schedules. You might discover that planting potatoes in spring gives better yields than autumn planting, or that certain medicinal herbs are only available during specific seasons.</p>
    
    <div class="image-container text-center mb-4">
      <img src="/images/blog/seasonal-farming-system.jpg" alt="Seasonal Farming Calendar" data-caption="Different plants grow in different seasons, creating strategic farming decisions" class="blog-image-full mx-auto" />
      <p class="image-caption text-sm text-gray-600 mt-2">Different plants grow in different seasons, creating strategic farming decisions</p>
    </div>
    
    <p>This creates a natural rhythm where experienced players start planning their farming cycles, while newcomers can experiment and learn from multiple growing seasons within a single server lifespan.</p>
    
    <h2>AI Assistant: Your Personal Survival Companion</h2>
    
    <p>One of the cooler features we've implemented is an AI assistant that you can talk to by holding the V key:</p>
    
    <ul>
      <li><strong>Learning AI</strong> - The assistant learns from your gameplay patterns and progress</li>
      <li><strong>SpacetimeDB Integration</strong> - Thanks to SpacetimeDB's time travel capabilities, the AI can access your entire game history</li>
      <li><strong>Contextual Advice</strong> - Get tips based on your current situation and past experiences</li>
      <li><strong>Progress Tracking</strong> - The AI remembers your discoveries, failed attempts, and successful strategies</li>
      <li><strong>Dynamic Responses</strong> - Advice changes as you become more experienced in different aspects of survival</li>
    </ul>
    
    <p>It's not just a chatbot - since SpacetimeDB can roll back and time travel through the game's entire state history, the AI can reference specific moments in your playthrough to give you more personalized guidance.</p>
    
    <div class="image-container text-center mb-4">
      <img src="/images/blog/ai-assistant-interface.jpg" alt="AI Assistant Interface" data-caption="Your personal AI companion learns from your entire gameplay history" class="blog-image-full mx-auto" />
      <p class="image-caption text-sm text-gray-600 mt-2">Your personal AI companion learns from your entire gameplay history</p>
    </div>
    
    <h2>Combat System: Bows and Tactical Archery</h2>
    
    <p>Engage in tactical combat with our archery system:</p>
    
    <ul>
      <li><strong>Multiple Arrow Types</strong> - Different arrows for different situations and targets</li>
      <li><strong>Realistic Physics</strong> - Arrows follow realistic trajectories and can be recovered after firing</li>
      <li><strong>Durability System</strong> - Arrows can break on impact or become damaged with use</li>
      <li><strong>Tactical Gameplay</strong> - Plan your shots carefully, as ammunition is a valuable resource</li>
    </ul>
    
    <h2>Shelter Construction</h2>
    
    <p>While we don't yet have a full building system like Minecraft or Rust, players can create essential survival infrastructure:</p>
    
    <ul>
      <li><strong>Short-term Survival Shelters</strong> - Collect wood and craft rope to build temporary protection</li>
      <li><strong>Resource Requirements</strong> - Realistic material needs encourage exploration and resource management</li>
      <li><strong>Weather Protection</strong> - Shelters provide crucial protection from harsh environmental conditions</li>
      <li><strong>Strategic Placement</strong> - Choose shelter locations carefully for maximum survival advantage</li>
    </ul>
    
    <h2>PvP Hotspots and Resource Competition</h2>
    
    <div class="image-container text-center mb-4">
      <img src="/images/blog/pvp-hotspots-barrels.jpg" alt="PvP Hotspots with Barrels" data-caption="Compete for valuable resources at dangerous roadside barrel locations" class="blog-image-full mx-auto" />
      <p class="image-caption text-sm text-gray-600 mt-2">Compete for valuable resources at dangerous roadside barrel locations</p>
    </div>
    
    <p>Risk and reward define the most exciting aspects of survival:</p>
    
    <ul>
      <li><strong>Roadside Barrels</strong> - High-value loot spawns at dangerous PvP hotspot locations</li>
      <li><strong>Risk vs. Reward</strong> - Better resources come with higher chances of player encounters</li>
      <li><strong>Territorial Control</strong> - Groups may attempt to control valuable resource areas</li>
      <li><strong>Dynamic Spawning</strong> - Barrel contents and locations change to keep gameplay fresh</li>
    </ul>
    
    <h2>Hydration and Status Systems</h2>
    
    <p>Survival isn't just about avoiding death - it's about managing interconnected systems:</p>
    
    <ul>
      <li><strong>Water Bottles and Rain Collectors</strong> - Multiple sources ensure you never go thirsty</li>
      <li><strong>Status Effects</strong> - Interactions between health, hunger, hydration, and temperature</li>
      <li><strong>Environmental Interactions</strong> - Rain extinguishes fires but you can still light fires under trees</li>
      <li><strong>Wetness System</strong> - Getting wet accelerates health, hunger, and hydration decline</li>
      <li><strong>Poison and Antidotes</strong> - Viper bites require specific anti-venom to cure</li>
      <li><strong>Realistic Recovery</strong> - Status effects interact in logical, realistic ways</li>
    </ul>
    
          <div class="image-container text-center mb-4">
        <img src="/images/blog/status-effects-system.jpg" alt="Status Effects Interface" data-caption="Stay dry by taking shelter under trees — tree cover keeps you out of the rain and lets you safely place campfires even during storms" class="blog-image-full mx-auto" />
        <p class="image-caption text-sm text-gray-600 mt-2">Stay dry by taking shelter under trees — tree cover keeps you out of the rain and lets you safely place campfires even during storms.</p>
      </div>
    
    <h2>What's Coming Next: Areas Under Development</h2>
    
    <p>While our alpha has some pretty cool gameplay mechanics, several major systems are still in development:</p>
    
    <h3>Art Direction Evolution</h3>
    
    <p>Our terrain tilesets are intentionally incomplete as we finalize our unique artistic vision:</p>
    
    <ul>
      <li><strong>Hybrid Art Style</strong> - We're experimenting with a mix of pixel art for interactive game components combined with painterly environmental details</li>
      <li><strong>Soft Realistic Lighting</strong> - Terrain and backgrounds will feature better shading and lighting rather than strict pixel art commitment</li>
      <li><strong>Visual Distinction</strong> - Our goal is to create something that stands out in the crowded survival game market</li>
      <li><strong>Performance Optimization</strong> - Balancing visual fidelity with smooth multiplayer performance</li>
    </ul>
    
    <h3>The Missing Broth and Bullets</h3>
    
    <p>Despite our name, two major systems await implementation:</p>
    
    <h4>Field Cauldron System</h4>
    <ul>
      <li>While you can cook raw harvested resources, the AI-powered Field Cauldron system isn't yet implemented</li>
      <li>Future updates will introduce semantic recipe generation for unique soups and stews</li>
      <li>This system will allow players to experiment with ingredient combinations for emergent cooking gameplay</li>
    </ul>
    
    <h4>Higher Technology Tiers</h4>
    <ul>
      <li>Currently, only primitive technology tier is implemented - no guns yet!</li>
      <li>All core systems are in place, meaning development will accelerate rapidly</li>
      <li>We promise plenty of both broth AND bullets for our 1.0 release</li>
    </ul>
    
          <div class="image-container text-center mb-4">
        <p class="image-caption text-sm text-gray-600 mt-2">Higher technology tiers and the Field Cauldron system are coming soon</p>
      </div>
    
    <h2>Join the Alpha</h2>
    
    <p>The Broth & Bullets alpha showcases what we've been able to build using SpacetimeDB. Every system you experience has been developed much faster than we initially expected thanks to this tech stack.</p>
    
    <p><strong>Want to try it out? Head to <a href="http://www.brothandbullets.com" target="_blank" rel="noopener noreferrer">www.brothandbullets.com</a> and jump into the alpha.</strong></p>
    
    <p>Your feedback will directly shape development of features like the Field Cauldron system, combat mechanics, and expanded building systems. This is your chance to influence the direction of the game while it's still in early development.</p>
    
    <p>Thanks for checking out Broth & Bullets!</p>
  `,
  tags: ["Alpha Launch", "Broth & Bullets", "SpacetimeDB", "Survival Games", "Multiplayer Gaming", "AI Assistant", "React", "Game Development", "PvP", "Crafting System", "3D Audio", "Wildlife AI", "Alpha Testing", "Seasonal Farming"]
}; 