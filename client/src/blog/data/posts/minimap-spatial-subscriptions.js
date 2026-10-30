export default {
  slug: "minimap-spatial-subscriptions",
  title: "The Hardlight Map: Spatial Awareness in a 2D World",
  subtitle: "How SpacetimeDB's chunk-based subscriptions solve the visibility problem in top-down survival",
  date: "2025-11-17",
  author: "Martin Erlic",
  authorImage: "/images/blog/author-marty.jpg",
  authorTwitter: "metalhorse233",
  excerpt: "In 3D survival games you scan the horizon. In 2D top-down? Your viewport is your prison. Here's how we used SpacetimeDB's spatial subscriptions to give players the awareness they deserve.",
  coverImage: "/images/blog/minimap-cover.jpg",
  content: `
    <p>When we started building Broth & Bullets, we hit a fundamental problem that plagues every 2D top-down survival game: the viewport paradox. In a 3D game like Rust or DayZ, you can literally scan the horizon and spot resource nodes, bases, and threats in the distance. But in a 2D top-down game? You're locked to your viewport. What you see is all you get.</p>
    
    <p>Except that doesn't make sense, does it? Your character - a genetically enhanced operative with ocular implants and an on-board AI - should be able to see further than the arbitrary rectangle of your screen. That's where the minimap comes in, and it's not just a quality-of-life feature. It's a lore-consistent solution to a fundamental game design problem.</p>

    <h2>🧠 The Lore: SOVA's Hardlight Projection</h2>

    <p>In the Babushka universe, your character isn't just some random survivor. You're a bioelectrically enhanced operative whose ocular implants can project hardlight overlays directly into your field of vision. Before your ship crashed on this godforsaken Aleutian island, your on-board AI assistant SOVA (Sentient Ocular Virtual Assistant 🦉) managed to download a cached map from an old GRU satellite feed.</p>

    <p>That map lives in your neural implant now. When you open it, you're not pulling out a piece of paper - you're activating a hardlight projection that overlays your vision. It's opaque because it's literally blocking your view, just like looking at a real map would. You can't see yourself running around while the map is open because you're distracted, looking at the projection instead of the world around you.</p>

    <p>This, of course, is a deliberate design decision that creates tactical tension: opening your map makes you vulnerable.</p>

    <h2>🗺️ The Design Problem: What Should a 2D Map Show?</h2>

    <p>Obviously, a minimap should help you orient yourself around the island and show points of interest. But we made a crucial design decision early on: <strong>show nearby resource nodes</strong>.</p>

    <p>Think about it. In a 3D survival game, you can see that cluster of trees on the distant hill. You can spot the ore deposit glinting in the sunlight. You can identify barrels and loot containers from hundreds of meters away. But in a 2D top-down game, if it's not in your viewport, it doesn't exist.</p>

    <p>That's artificial difficulty. Your character, standing on that hill, would absolutely be able to see resources in the distance. So we show them on the map - trees, ore nodes, barrels, and more to come. A reasonable proximity around your position, representing what your character would realistically be able to observe.</p>

    <div class="image-container text-center mb-4">
      <img src="/images/blog/minimap-resources-screenshot.jpg" alt="Minimap showing nearby resources" class="blog-image-full mx-auto" />
      <p class="image-caption text-sm text-gray-600 mt-2">The minimap displays nearby trees (green triangles), ore nodes (blue squares), and barrels (red circles) within a reasonable radius</p>
    </div>

    <h2>⚡ The Technical Solution: SpacetimeDB Spatial Subscriptions</h2>

    <p>Here's where it gets interesting from a technical perspective. How do you efficiently stream resource data to the client without overwhelming the connection or causing lag spikes?</p>

    <p>Enter SpacetimeDB's chunk-based subscription system. Instead of subscribing to every single entity in the world (which would be insane), we subscribe to spatial chunks - grid squares that contain entities. As you move around the world, the client automatically subscribes to nearby chunks and unsubscribes from distant ones. For a detailed guide on implementing this pattern, see our <a href="/blog/spatial-subscriptions-multiplayer-games">spatial subscriptions tutorial</a>.</p>

    <p>Here's a peek at how we handle this in our codebase:</p>

    <pre><code class="language-typescript">// From useSpacetimeTables.ts - Chunk subscription system
const CHUNK_BUFFER_SIZE = 1; // Load chunks 1 grid square ahead
const CHUNK_UNSUBSCRIBE_DELAY_MS = 3000; // Keep chunks for 3s after leaving

// Calculate which chunks are visible based on viewport
const getChunkIndicesForViewportWithBuffer = (viewport, bufferChunks = 1) => {
  const minChunkX = Math.max(0, baseMinChunkX - bufferChunks);
  const maxChunkX = Math.min(worldWidthChunks - 1, baseMaxChunkX + bufferChunks);
  const minChunkY = Math.max(0, baseMinChunkY - bufferChunks);
  const maxChunkY = Math.min(worldHeightChunks - 1, baseMaxChunkY + bufferChunks);
  
  // Calculate 1D indices for all chunks in range
  for (let y = minChunkY; y <= maxChunkY; y++) {
    for (let x = minChunkX; x <= maxChunkX; x++) {
      const index = y * worldWidthChunks + x;
      indices.push(index);
    }
  }
  return indices;
};</code></pre>

    <p>This system gives us several critical advantages:</p>

    <ul>
      <li><strong>Efficient Data Streaming:</strong> Only load what's nearby, reducing bandwidth and memory usage</li>
      <li><strong>Smooth Transitions:</strong> Buffer chunks ahead of movement prevent lag when crossing boundaries</li>
      <li><strong>Hysteresis:</strong> Delayed unsubscription prevents rapid re-sub/unsub cycles during movement</li>
      <li><strong>Automatic Synchronization:</strong> SpacetimeDB handles all the real-time updates - when a tree is chopped down, it disappears from everyone's map instantly</li>
    </ul>

    <h2>🎯 Performance Optimization: The Battle Against Lag</h2>

    <p>Our initial implementation was a disaster. With a buffer of 3 chunks in each direction, we were creating 49 chunks × 12 subscriptions = 588 database calls every time the player moved. Frame times spiked to 200-300ms. The game was unplayable.</p>

    <p>We fought back with aggressive optimization:</p>

    <ul>
      <li><strong>Smart Buffer Size:</strong> Reduced to buffer=1 (optimal balance between smooth movement and chunk count)</li>
      <li><strong>Batched Subscriptions:</strong> Combined 12 individual queries per chunk into 3 batched calls (75% reduction)</li>
      <li><strong>Intelligent Throttling:</strong> Minimum 100ms between chunk updates, with adaptive throttling during fast movement</li>
      <li><strong>Chunk Count Limiting:</strong> Maximum 20 chunks processed per frame to prevent lag spikes</li>
    </ul>

    <p>The results? Frame times dropped to 0.01ms average, FPS jumped to 95-156, and chunk crossings became smooth and imperceptible. This is the power of SpacetimeDB's reducer architecture - complex spatial queries that would require custom server logic in traditional architectures just... work.</p>

    <h2>🎮 The Gameplay Impact</h2>

    <p>The minimap fundamentally changes how you play Broth & Bullets:</p>

    <ul>
      <li><strong>Resource Gathering:</strong> Spot clusters of trees or ore deposits without wandering aimlessly</li>
      <li><strong>Strategic Planning:</strong> Identify optimal base locations near multiple resource types</li>
      <li><strong>Tactical Awareness:</strong> See campfires (other players' bases) and plan your approach</li>
      <li><strong>Risk vs. Reward:</strong> Opening the map makes you vulnerable - use it wisely</li>
    </ul>

    <p>The minimap serves as a tactical tool that respects the player's intelligence and the character's capabilities - far more than just a convenience feature.</p>

    <h2>🚀 What's Next</h2>

    <p>We're planning to expand the minimap system with:</p>

    <ul>
      <li>Player-placed markers and waypoints</li>
      <li>Tracking for rare resources and points of interest</li>
      <li>Fog of war for unexplored areas</li>
      <li>Shared map data between squad members</li>
      <li>Craftable map upgrades that extend scanning range</li>
    </ul>

    <p>The foundation is solid, and SpacetimeDB's spatial subscription system makes all of this straightforward to implement. The reducer architecture handles the heavy lifting - clean, declarative queries that automatically stay in sync across all clients.</p>

    <h2>🔗 Related Articles</h2>

    <p>Want to learn more about the technical systems behind Broth & Bullets?</p>

    <ul>
      <li><a href="/blog/spatial-subscriptions-multiplayer-games">Implementing Spatial Subscriptions in Multiplayer Games</a> - Deep dive into the chunk-based subscription system</li>
      <li><a href="/blog/broth-bullets-spacetimedb-architecture">Why Broth & Bullets Uses SpacetimeDB</a> - Our complete technical architecture story</li>
      <li><a href="/blog/how-we-built-broth-bullets-multiplayer-survival-game">How We Built Broth & Bullets</a> - The complete development story</li>
      <li><a href="/blog/building-2d-multiplayer-survival-games-guide">Complete Guide to Building 2D Multiplayer Survival Games</a> - Comprehensive tutorial</li>
    </ul>

    <h2>💬 Join the Discussion</h2>

    <p>We're constantly iterating on the minimap system based on player feedback. Have ideas for how to improve spatial awareness in a 2D survival game? <a href="https://discord.gg/tUcBzfAYfs" target="_blank" rel="noopener noreferrer">Join our Discord</a> and let us know. We're building this game with the community, and your input shapes the final product.</p>

    <p>And if you're a developer curious about SpacetimeDB's spatial subscription system, the code is open source. Check out our <a href="https://github.com/SeloSlav/2d-multiplayer-survival-mmorpg?tab=readme-ov-file#-art-generation-prompts" target="_blank" rel="noopener noreferrer">GitHub repository</a> to see how we implemented chunk-based subscriptions and optimized for performance.</p>
  `,
  tags: ["Development", "Game Design", "Minimap", "SpacetimeDB", "Technical", "Performance", "Spatial Subscriptions", "Game Mechanics"]
};

