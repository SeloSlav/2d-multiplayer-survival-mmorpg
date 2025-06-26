export default {
  slug: "resource-system-implementation",
  title: "Resource System: From Harvest to Inventory",
  subtitle: "Building a seamless resource ecosystem for our survival game",
  date: "2025-04-01",
  author: "Martin Erlic",
  authorImage: "/images/blog/author-marty.jpg",
  authorTwitter: "seloslav",
  excerpt: "After five days of intensive development, we've implemented a fully functional resource system that spans from server-side node management to client-side harvesting and inventory interaction.",
  coverImage: "/images/blog/resource-system.jpg",
  content: `
    <p>Our goal with Broth & Bullets has always been to create a survival experience where resource gathering feels meaningful and integrated with the world. After an intense five-day development sprint, I'm excited to share that we've built a comprehensive resource system that handles everything from node spawning to inventory management.</p>
    
    <h2>Resource Nodes: The Foundation</h2>
    
    <p>The resource system begins with our node implementation, which has several key features:</p>
    
    <ul>
      <li>Server-side state management ensuring consistency across all clients</li>
      <li>WebSocket synchronization providing near-immediate updates to all players</li>
      <li>Optimized rendering based on player proximity</li>
      <li>Geographically accurate resource distribution</li>
      <li>Interactive harvesting with visual feedback</li>
    </ul>
    
    <p>When a player approaches a resource node, it becomes interactive. Pressing E initiates the harvesting process, with notifications appearing in the bottom-right corner of the screen detailing the items received.</p>
    
    <h2>Flora of the Subarctic</h2>
    
    <div class="image-container text-center mb-4">
      <img src="/images/icons/food/fireweed_shoots.png" alt="Fireweed Shoots" class="blog-icon mx-auto" />
    </div>
    
    <p>We've implemented our first set of harvestable plants, all carefully selected to match our game's setting in the Kamchatka subarctic region:</p>
    
    <ol>
      <li><strong>Beach Lyme Grass</strong> - A resilient coastal grass that yields rough fibers</li>
      <li><strong>Cottongrass</strong> - Provides fibers and edible seeds</li>
      <li><strong>Fireweed</strong> - Culturally significant plant with edible components and fiber yields</li>
      <li><strong>Boreal Nettle</strong> - Versatile plant offering fibers and medicinal properties</li>
    </ol>
    
    <p>Each plant drops "Rough Fibers" - our equivalent to cloth in other survival games - which forms the basis for crafting headwear, clothing, rope, bow strings, and other essential items. Beyond fibers, plants also yield unique secondary resources like edible sprouts, leaves for tea-making, and other components with varied uses.</p>
    
    <h2>Inventory Management System</h2>
    
    <div class="image-container text-center mb-4">
      <img src="/images/blog/inventory.jpg" alt="Inventory System Screenshot" class="blog-image-full mx-auto" />
      <p class="image-caption text-sm text-gray-600 mt-2">The in-game inventory system with stack management functionality</p>
    </div>
    
    <p>To complement our resource nodes, we've developed a robust inventory system with these features:</p>
    
    <ul>
      <li>Server-side in-memory caching for performance with periodic database synchronization</li>
      <li>Intuitive stack management with multiple splitting options:
        <ul>
          <li>Middle mouse button: Split stack in half</li>
          <li>Shift + drag: Split into thirds</li>
          <li>Shift + left click: Drag out a single item</li>
        </ul>
      </li>
      <li>Seamless WebSocket updates ensuring all inventory changes are reflected instantly</li>
      <li>Database persistence for inventory state between sessions</li>
    </ul>
    
    <h2>Expanding the Resource Ecosystem</h2>
    
    <p>With the core system in place, we're now focusing on expanding the variety of resource nodes. Our upcoming additions include:</p>
    
    <h3>Trees and Wood Resources</h3>
    
    <p>We're implementing approximately ten different tree species, each with unique properties:</p>
    
    <ul>
      <li>Different wood types with varying properties for crafting</li>
      <li>Bark that can be processed for additional fibers</li>
      <li>Integration with the tool system - different tools will have varying efficiency</li>
    </ul>
    
    <h3>Mineral Resources</h3>
    
    <p>Our geological features will include various harvestable minerals:</p>
    
    <ul>
      <li>Iron deposits in rocky outcrops</li>
      <li>Obsidian in volcanic ash plains</li>
      <li>Sulfur in geothermal areas</li>
      <li>Stone and flint for basic tools</li>
    </ul>
    
    <h2>Tools and Processing</h2>
    
    <div class="image-container text-center mb-4">
      <img src="/images/icons/tools/field_cauldron.png" alt="Field Cauldron" class="blog-icon mx-auto" />
    </div>
    
    <p>Resource gathering is just the beginning. Players will need to process raw materials to create useful items:</p>
    
    <ul>
      <li><strong>Crude Knife</strong> - Dual-purpose tool for skinning animals and harvesting bark</li>
      <li><strong>Wooden Pickaxe</strong> - Basic tool for mining stone and minerals</li>
      <li><strong>Stone Axe</strong> - Early-game tool for harvesting wood</li>
    </ul>
    
    <p>Processing will be a central gameplay element, offering multiple paths to convert raw materials into useful items with different efficiency rates based on tools and methods used.</p>
    
    <h2>The Field Cauldron: Resource Processing with AI</h2>
    
    <p>Perhaps the most innovative aspect of our resource system is the Field Cauldron - a tool every babushka carries from the cargo vessel that brought them to the island. This isn't just another crafting station but a truly generative gameplay element:</p>
    
    <ul>
      <li>Players can combine virtually any gathered materials to create unique items</li>
      <li>LLM-powered generation creates contextually appropriate results</li>
      <li>Temperature-controlled generation ensures game balance while maintaining creativity</li>
      <li>Self-hosted open-source models will provide consistent experiences without API dependencies</li>
    </ul>
    
    <p>The Field Cauldron introduces emergent gameplay where players might create:</p>
    
    <ul>
      <li><strong>Stone Soup</strong> - From just water and pebbles, creating a basic survival food</li>
      <li><strong>Nettle Tea</strong> - Using harvested nettle leaves for medicinal benefits</li>
      <li><strong>Advanced concoctions</strong> - By deploying cauldrons on geothermal vents for higher "temperatures"</li>
    </ul>
    
    <p>These geothermal vents will become strategic PvP hotspots as players compete for the best processing locations, adding another layer of territorial control to the gameplay.</p>
    
    <h2>Player-Driven Economy</h2>
    
    <p>All these systems converge to support our vision of a player-driven economy centered around a trading outpost. With our resource systems in place, players will be able to:</p>
    
    <ul>
      <li>Specialize in gathering specific resource types</li>
      <li>Master processing techniques for higher-quality outputs</li>
      <li>Trade unique cauldron-generated items with other players</li>
      <li>Form economic relationships and dependencies</li>
    </ul>
    
    <p>The generative aspect of our cauldron system means that every server wipe will result in slightly different item possibilities, keeping the economy fresh and encouraging experimentation.</p>
    
    <h2>Looking Ahead</h2>
    
    <p>With the core resource and inventory systems now fully functional, we're excited to expand the variety of harvestable nodes, refine the processing mechanics, and begin implementing the crafting recipes that will form the backbone of player progression.</p>
    
    <p>Our next development sprint will focus on the tools system and expanding the AI-driven cauldron mechanics to add more depth to the resource processing pipeline.</p>
  `,
  tags: ["Development", "Resource System", "Inventory", "Game Design", "Technical", "AI Integration"]
};