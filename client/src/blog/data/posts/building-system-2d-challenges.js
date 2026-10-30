export default {
  slug: "building-system-2d-challenges",
  title: "Building in 2D: Solving the Shelter Problem",
  subtitle: "How we implemented a functional building system without a Z-axis",
  date: "2025-11-14",
  author: "Martin Erlic",
  authorImage: "/images/blog/author-marty.jpg",
  authorTwitter: "metalhorse233",
  excerpt: "Creating a building system for a 2D survival game presents unique challenges. We dive into the algorithms, design decisions, and gameplay implications of constructing shelter in a flat world.",
  coverImage: "/images/blog/building-interior-screenshot.jpg",
  content: `
    <p>When we started implementing the building system for Broth & Bullets, we knew we were facing a fundamental challenge: how do you create meaningful shelter mechanics in a 2D game where there's no true vertical dimension?</p>
    
    <p>In 3D survival games like Rust or Valheim, building is intuitive. You place walls, add a roof, and you're inside. The Z-axis handles everything. But in 2D, we needed to get creative.</p>
    
    <h2>The "Inside" Problem</h2>
    
    <p>The first major challenge was determining what actually constitutes being "inside" a structure. In a top-down 2D game, everything is rendered on the same plane. How do you tell if a player is inside or outside when there's no physical concept of "under a roof"?</p>
    
    <h3>Our Enclosure Detection Algorithm</h3>
    
    <p>We developed a boundary-tracing algorithm that runs every time a player moves or a wall is placed/destroyed:</p>
    
    <ol>
      <li><strong>Wall Graph Construction</strong> - We treat all placed walls as edges in a graph, with corners as vertices</li>
      <li><strong>Flood Fill Detection</strong> - Starting from the player's position, we perform a flood fill in all directions</li>
      <li><strong>Boundary Intersection</strong> - If the flood fill hits the world edge before completing a full circuit, the player is outside</li>
      <li><strong>Enclosure Validation</strong> - If the flood fill completes a closed loop bounded entirely by walls, the player is inside</li>
    </ol>
    
    <p>This approach handles complex building shapes - L-shaped structures, multiple rooms, even buildings with courtyards. The algorithm runs efficiently enough that we can check it in real-time as players move through the world.</p>
    
    <div class="image-container text-center mb-4">
      <img src="/images/blog/building-walls-construction-screenshot.jpg" alt="Building Walls Construction" class="blog-image-full mx-auto" />
      <p class="image-caption text-sm text-gray-600 mt-2">Constructing the walls of a shelter - the foundation of any structure</p>
    </div>
    
    <h2>The Ceiling Conundrum</h2>
    
    <p>In 3D games, roofs are structural elements you build piece by piece. But in our 2D world, we had to make a design decision: should players manually place ceiling tiles, or should we handle it automatically?</p>
    
    <p>We chose automation for several reasons:</p>
    
    <ul>
      <li><strong>Tedium Reduction</strong> - Manually filling every ceiling tile would be incredibly tedious in a top-down view</li>
      <li><strong>Visual Clarity</strong> - We needed a way to clearly show "this area is enclosed" without cluttering the view</li>
      <li><strong>Resource Balance</strong> - Ceiling tiles are essentially aesthetic - the real investment is in walls and foundations</li>
    </ul>
    
    <p>When our enclosure algorithm detects a fully enclosed space, we automatically fill it with ceiling tiles. This provides immediate visual feedback that you've successfully created shelter, and it looks great from the top-down perspective.</p>
    
    <div class="image-container text-center mb-4">
      <img src="/images/blog/building-exterior-screenshot.jpg" alt="Building Exterior View" class="blog-image-full mx-auto" />d
      <p class="image-caption text-sm text-gray-600 mt-2">Outside a completed structure with automatically generated ceiling tiles</p>
    </div>
    
    <h2>Foundations and Structural Integrity</h2>
    
    <p>Unlike ceiling tiles, foundations are a real investment. We implemented a foundation system where:</p>
    
    <ul>
      <li>Walls can only be placed on foundations</li>
      <li>Foundations require significant resources (stone, wood, time)</li>
      <li>Upgrading to stronger materials (wood → stone → metal) requires replacing foundations</li>
      <li>Foundation durability affects the entire structure's health</li>
    </ul>
    
    <p>This creates meaningful progression - your first shelter might be flimsy wooden walls on basic foundations, but over time you'll invest in stone fortifications that can withstand serious attacks.</p>
    
    <h2>Status Effects: Why Building Matters</h2>
    
    <p>Being inside isn't just cosmetic - it provides tangible gameplay benefits:</p>
    
    <ul>
      <li><strong>Weather Protection</strong> - Rain no longer affects you, preventing the "Wet" status and its associated penalties</li>
      <li><strong>Temperature Regulation</strong> - Your warmth stat decays significantly slower indoors, reducing the need for constant fire management</li>
      <li><strong>Rest Bonus</strong> - Sleeping inside provides better rest quality and faster health regeneration</li>
      <li><strong>Crafting Benefits</strong> - Certain advanced crafting stations require indoor placement for optimal results</li>
    </ul>
    
    <p>These benefits make building worthwhile beyond just storing items - your shelter becomes a genuine survival advantage in the harsh tundra environment.</p>
    
    <div class="image-container text-center mb-4">
      <img src="/images/blog/building-weather-protection-screenshot.jpg" alt="Weather Protection Inside Building" class="blog-image-full mx-auto" />
      <p class="image-caption text-sm text-gray-600 mt-2">Taking shelter from the rain - notice the status effects changing as you enter</p>
    </div>
    
    <h2>The Challenges of 2D Building</h2>
    
    <p>Let's be honest - building in 2D will never match the complexity of games like Rust or Minecraft. You can't build skyward, create multi-story fortresses, or design elaborate vertical raid defenses.</p>
    
    <p>But that's not necessarily a bad thing. The constraints of 2D force us to think differently about base building:</p>
    
    <ul>
      <li><strong>Horizontal Expansion</strong> - Bases grow outward rather than upward, creating sprawling compounds</li>
      <li><strong>Wall Placement Strategy</strong> - Defensive positioning matters more when you can't build towers</li>
      <li><strong>Trap Systems</strong> - Without vertical defenses, traps and turrets become more important</li>
      <li><strong>Chokepoint Design</strong> - Creating effective defensive corridors requires careful planning</li>
    </ul>
    
    <h2>Building Meta: Walls, Traps, and Turrets</h2>
    
    <p>Early testing has revealed interesting patterns in how players approach base building. Since you can't build elaborate multi-story bases, the meta is evolving around:</p>
    
    <ul>
      <li><strong>Perimeter Walls</strong> - Creating large enclosed areas with strategic entry points</li>
      <li><strong>Trap Corridors</strong> - Funneling attackers through trapped pathways</li>
      <li><strong>Turret Placement</strong> - Automated defenses covering key approaches</li>
      <li><strong>Decoy Structures</strong> - Building fake storage buildings to mislead raiders</li>
    </ul>
    
    <p>The 2D perspective actually makes base layout more tactical in some ways - attackers can see your entire base layout from above, so deception and misdirection become valuable tools.</p>
    
    <h2>Where Building Fits in the Bigger Picture</h2>
    
    <p>As we continue developing Broth & Bullets, we're finding that the 2D building limitations might actually push the game in interesting directions. Since we can't compete with Rust's elaborate building system, we're leaning into other aspects:</p>
    
    <ul>
      <li><strong>Farming Systems</strong> - Protected greenhouses for growing crops</li>
      <li><strong>Trading Outposts</strong> - Player-run shops and markets</li>
      <li><strong>Specialized Workshops</strong> - Buildings designed for specific crafting purposes</li>
      <li><strong>Community Structures</strong> - Shared buildings that benefit multiple players</li>
    </ul>
    
    <p>We're seeing players in our alpha tests treat buildings less as fortresses and more as functional spaces - workshops, farms, trading posts, and communal gathering areas. This might be the natural evolution of building in a 2D survival game.</p>
    
    <h2>The Future of Building</h2>
    
    <p>We're still iterating on the building system, and player feedback has been invaluable. Some features we're considering:</p>
    
    <ul>
      <li>Building upgrade paths (wood → stone → metal)</li>
      <li>Specialized wall types (defensive, insulated, decorative)</li>
      <li>Door and window systems for controlled access</li>
      <li>Building damage and repair mechanics</li>
      <li>Clan-owned structures with shared permissions</li>
    </ul>
    
    <p>The beauty of a 2D building system is that it's more accessible than complex 3D building - new players can create functional shelters quickly without getting overwhelmed by vertical building mechanics. This lower barrier to entry might actually be an advantage for attracting players who find games like Rust intimidating.</p>
    
    <div class="image-container text-center mb-4">
      <img src="/images/blog/base-sprawl-screenshot.jpg" alt="Sprawling Base Layout" class="blog-image-full mx-auto" />
      <p class="image-caption text-sm text-gray-600 mt-2">A player's sprawling base showing horizontal expansion - multiple buildings, farms, and defensive structures spread across the landscape</p>
    </div>
    
    <h2>Embracing the Constraints</h2>
    
    <p>Building in 2D isn't about trying to replicate 3D building systems - it's about finding what works uniquely well in a top-down perspective. The automatic ceiling generation, the enclosure detection algorithm, the emphasis on horizontal layout strategy - these are solutions that only make sense in 2D.</p>

    <p>As we continue development, we're excited to see how players push the building system in unexpected directions. Maybe the future of Broth & Bullets isn't about towering fortresses, but about sprawling farming communes and intricate trap mazes. We'll find out together.</p>

    <p>And honestly? That's the fun part of game development - discovering what your game wants to be, even when it's different from what you initially imagined.</p>

    <h2>🔗 Related Articles</h2>

    <p>Learn more about Broth & Bullets' interconnected survival systems:</p>

    <ul>
      <li><a href="/blog/how-we-built-broth-bullets-multiplayer-survival-game">How We Built Broth & Bullets</a> - The complete development story</li>
      <li><a href="/blog/armor-system-design">Armor System: More Than Just Protection</a> - Another example of meaningful survival mechanics</li>
      <li><a href="/blog/building-2d-multiplayer-survival-games-guide">Complete Guide to Building 2D Multiplayer Survival Games</a> - Comprehensive tutorial</li>
      <li><a href="/blog/broth-bullets-spacetimedb-architecture">Why Broth & Bullets Uses SpacetimeDB</a> - Technical architecture enabling real-time building</li>
    </ul>
  `,
  tags: ["Development", "Building System", "Game Design", "Technical", "2D Challenges", "Algorithms"]
};

