export default {
  slug: 'broth-bullets-spacetimedb-architecture',
  title: 'Why Broth & Bullets Uses SpacetimeDB Instead of Traditional Game Servers',
  subtitle: 'How we cut development time by 70% and eliminated an entire class of bugs',
  date: '2025-11-17',
  author: 'Martin Erlic',
  authorImage: '/images/blog/author-marty.jpg',
  authorTwitter: 'metalhorse233',
  excerpt: 'The technical story of migrating Broth & Bullets from a traditional Node.js backend to SpacetimeDB, including real metrics, lessons learned, and why we\'ll never go back.',
  tags: ['Broth & Bullets', 'SpacetimeDB', 'Game Development', 'Architecture', 'Technical', 'Case Study'],
  coverImage: '/images/blog/broth-bullets-spacetimedb-cover.jpg',
  content: `
    <p>When we started building Broth & Bullets, we did what most developers do: Node.js + Socket.io + PostgreSQL. It worked, but barely. After months of fighting state synchronization bugs and scaling issues, we made a radical decision: migrate everything to SpacetimeDB. Here's why it was the best technical decision we ever made. For the complete game development story, see <a href="/blog/how-we-built-broth-bullets-multiplayer-survival-game">how we built Broth & Bullets</a>.</p>

    <h2>🔥 The Problem: Traditional Game Server Hell</h2>

    <h3>Our Original Stack</h3>

    <p>Like many multiplayer games, we started with the "standard" approach:</p>

    <ul>
      <li><strong>Server</strong>: Node.js with Express</li>
      <li><strong>Real-Time</strong>: Socket.io for WebSocket connections</li>
      <li><strong>Database</strong>: PostgreSQL for persistence</li>
      <li><strong>State Management</strong>: Custom synchronization logic</li>
      <li><strong>Deployment</strong>: Docker containers on AWS</li>
    </ul>

    <h3>What Went Wrong</h3>

    <p>After 3 months of development, we had a "working" prototype. But the problems were mounting:</p>

    <p><strong>1. State Synchronization Bugs</strong></p>
    <ul>
      <li>Players seeing different game states</li>
      <li>Items duplicating or disappearing</li>
      <li>Position desync causing "teleporting" players</li>
      <li>Race conditions in resource gathering</li>
      <li>Inventory inconsistencies after crafting</li>
    </ul>

    <p><strong>2. Code Complexity</strong></p>
    <ul>
      <li>15,000 lines of synchronization logic</li>
      <li>Custom diff algorithms for state updates</li>
      <li>Manual conflict resolution everywhere</li>
      <li>Separate validation on client and server</li>
      <li>Complex event ordering requirements</li>
    </ul>

    <p><strong>3. Performance Issues</strong></p>
    <ul>
      <li>150ms average latency (too high for combat)</li>
      <li>Database queries blocking game logic</li>
      <li>Memory leaks in Socket.io connections</li>
      <li>CPU spikes during player movement</li>
      <li>Couldn't support more than 20 concurrent players</li>
    </ul>

    <p><strong>4. Development Velocity</strong></p>
    <ul>
      <li>Every new feature required sync logic</li>
      <li>Bugs took days to reproduce and fix</li>
      <li>Testing required complex multi-client setups</li>
      <li>Refactoring was terrifying</li>
      <li>New developers took weeks to understand the codebase</li>
    </ul>

    <h2>🔍 Discovering SpacetimeDB</h2>

    <h3>The Pitch That Caught Our Attention</h3>

    <p>We stumbled across SpacetimeDB while researching alternatives. The pitch sounded too good to be true:</p>

    <ul>
      <li>"Write your game logic in Rust, compile to WebAssembly"</li>
      <li>"Runs directly in the database - no separate server needed"</li>
      <li>"Automatic state synchronization to all clients"</li>
      <li>"Built-in spatial queries for large game worlds"</li>
      <li>"Sub-50ms latency out of the box"</li>
    </ul>

    <p>We were skeptical. But desperate. So we built a prototype.</p>

    <h3>The Two-Week Prototype</h3>

    <p>We gave ourselves two weeks to rebuild core Broth & Bullets mechanics in SpacetimeDB:</p>

    <p><strong>Week 1: Learning Rust and SpacetimeDB</strong></p>
    <ul>
      <li>Followed SpacetimeDB tutorials</li>
      <li>Learned Rust basics (neither of us knew Rust)</li>
      <li>Defined player and resource tables</li>
      <li>Implemented basic movement reducers</li>
      <li>Generated TypeScript client bindings</li>
    </ul>

    <p><strong>Week 2: Implementing Game Logic</strong></p>
    <ul>
      <li>Resource gathering system</li>
      <li>Inventory management</li>
      <li>Basic crafting</li>
      <li>Player combat</li>
      <li>Building placement</li>
    </ul>

    <p><strong>The Results Shocked Us:</strong></p>
    <ul>
      <li>✅ 1,200 lines of Rust vs 15,000 lines of JavaScript</li>
      <li>✅ Zero synchronization bugs</li>
      <li>✅ 35ms average latency (down from 150ms)</li>
      <li>✅ 50+ concurrent players in testing (up from 20)</li>
      <li>✅ New features took hours instead of days</li>
    </ul>

    <p>We were sold. The migration decision was made.</p>

    <h2>🚀 The Migration</h2>

    <h3>Migration Strategy</h3>

    <p>We couldn't afford a complete rewrite, so we migrated incrementally:</p>

    <p><strong>Phase 1: Core Systems (2 weeks)</strong></p>
    <ul>
      <li>Player state and movement</li>
      <li>Resource spawning and gathering</li>
      <li>Basic inventory</li>
    </ul>

    <p><strong>Phase 2: Gameplay Systems (3 weeks)</strong></p>
    <ul>
      <li>Crafting and recipes</li>
      <li>Building placement</li>
      <li>Combat and damage</li>
    </ul>

    <p><strong>Phase 3: Advanced Features (2 weeks)</strong></p>
    <ul>
      <li>Field Cauldron cooking</li>
      <li>Weather system</li>
      <li>Spatial subscriptions</li>
    </ul>

    <p><strong>Phase 4: Polish and Optimization (1 week)</strong></p>
    <ul>
      <li>Performance tuning</li>
      <li>Bug fixes</li>
      <li>Client UI updates</li>
    </ul>

    <p><strong>Total Migration Time: 8 weeks</strong></p>

    <h3>Key Challenges</h3>

    <p><strong>1. Learning Rust</strong></p>
    <ul>
      <li><strong>Challenge</strong>: Neither of us had Rust experience</li>
      <li><strong>Solution</strong>: Focused on game logic patterns, not advanced Rust features</li>
      <li><strong>Outcome</strong>: Productive within a week, proficient within a month</li>
    </ul>

    <p><strong>2. Rethinking Architecture</strong></p>
    <ul>
      <li><strong>Challenge</strong>: SpacetimeDB requires different thinking than traditional servers</li>
      <li><strong>Solution</strong>: Embraced reducers as the core abstraction</li>
      <li><strong>Outcome</strong>: Simpler, more maintainable code</li>
    </ul>

    <p><strong>3. Client Binding Integration</strong></p>
    <ul>
      <li><strong>Challenge</strong>: Generated TypeScript bindings were unfamiliar</li>
      <li><strong>Solution</strong>: Built custom React hooks wrapping SpacetimeDB subscriptions</li>
      <li><strong>Outcome</strong>: Clean, type-safe client code</li>
    </ul>

    <h2>📊 Before & After: Real Metrics</h2>

    <h3>Code Complexity</h3>

    <table class="comparison-table">
      <thead>
        <tr>
          <th>Metric</th>
          <th>Before (Node.js)</th>
          <th>After (SpacetimeDB)</th>
          <th>Improvement</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Backend Lines of Code</td>
          <td>15,000</td>
          <td>1,500</td>
          <td>90% reduction</td>
        </tr>
        <tr>
          <td>Sync Logic Lines</td>
          <td>8,000</td>
          <td>0</td>
          <td>100% elimination</td>
        </tr>
        <tr>
          <td>Files</td>
          <td>120</td>
          <td>15</td>
          <td>87% reduction</td>
        </tr>
        <tr>
          <td>Dependencies</td>
          <td>45 npm packages</td>
          <td>1 Rust crate</td>
          <td>98% reduction</td>
        </tr>
      </tbody>
    </table>

    <h3>Performance</h3>

    <table class="comparison-table">
      <thead>
        <tr>
          <th>Metric</th>
          <th>Before</th>
          <th>After</th>
          <th>Improvement</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Average Latency</td>
          <td>150ms</td>
          <td>35ms</td>
          <td>77% faster</td>
        </tr>
        <tr>
          <td>P99 Latency</td>
          <td>450ms</td>
          <td>80ms</td>
          <td>82% faster</td>
        </tr>
        <tr>
          <td>Concurrent Players</td>
          <td>20</td>
          <td>50+</td>
          <td>2.5x increase</td>
        </tr>
        <tr>
          <td>Memory Usage</td>
          <td>2.5 GB</td>
          <td>800 MB</td>
          <td>68% reduction</td>
        </tr>
        <tr>
          <td>CPU Usage (avg)</td>
          <td>65%</td>
          <td>25%</td>
          <td>62% reduction</td>
        </tr>
      </tbody>
    </table>

    <h3>Development Velocity</h3>

    <table class="comparison-table">
      <thead>
        <tr>
          <th>Task</th>
          <th>Before</th>
          <th>After</th>
          <th>Improvement</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Add New Item Type</td>
          <td>4 hours</td>
          <td>30 minutes</td>
          <td>87% faster</td>
        </tr>
        <tr>
          <td>New Crafting Recipe</td>
          <td>2 hours</td>
          <td>15 minutes</td>
          <td>87% faster</td>
        </tr>
        <tr>
          <td>Combat Mechanic</td>
          <td>3 days</td>
          <td>1 day</td>
          <td>67% faster</td>
        </tr>
        <tr>
          <td>Bug Fix (avg)</td>
          <td>4 hours</td>
          <td>45 minutes</td>
          <td>81% faster</td>
        </tr>
      </tbody>
    </table>

    <h3>Costs</h3>

    <table class="comparison-table">
      <thead>
        <tr>
          <th>Service</th>
          <th>Before</th>
          <th>After</th>
          <th>Savings</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Server Hosting</td>
          <td>$180/mo</td>
          <td>$80/mo</td>
          <td>$100/mo</td>
        </tr>
        <tr>
          <td>Database</td>
          <td>$120/mo</td>
          <td>$0</td>
          <td>$120/mo</td>
        </tr>
        <tr>
          <td>Monitoring</td>
          <td>$50/mo</td>
          <td>$20/mo</td>
          <td>$30/mo</td>
        </tr>
        <tr>
          <td><strong>Total</strong></td>
          <td><strong>$350/mo</strong></td>
          <td><strong>$100/mo</strong></td>
          <td><strong>$250/mo (71%)</strong></td>
        </tr>
      </tbody>
    </table>

    <h2>🎯 Key Technical Wins</h2>

    <h3>1. Automatic State Synchronization</h3>

    <p><strong>The Old Way (Node.js):</strong></p>

    <pre><code class="language-javascript">// Gather resource - manually sync to all clients
async function gatherResource(playerId, resourceId) {
  const resource = await db.query('SELECT * FROM resources WHERE id = $1', [resourceId]);
  const player = await db.query('SELECT * FROM players WHERE id = $1', [playerId]);
  
  // Validate distance
  const distance = Math.sqrt(
    Math.pow(player.x - resource.x, 2) + 
    Math.pow(player.y - resource.y, 2)
  );
  if (distance > 100) throw new Error('Too far');
  
  // Update resource
  await db.query('UPDATE resources SET health = health - $1 WHERE id = $2', [10, resourceId]);
  
  // Add to inventory
  await db.query('INSERT INTO inventory (player_id, item_type, quantity) VALUES ($1, $2, $3)', 
    [playerId, resource.type, 1]);
  
  // Manually broadcast to all nearby players
  const nearbyPlayers = await findNearbyPlayers(player.x, player.y);
  nearbyPlayers.forEach(p => {
    io.to(p.socketId).emit('resource_updated', { resourceId, health: resource.health - 10 });
    io.to(p.socketId).emit('inventory_updated', { playerId, items: [...] });
  });
}</code></pre>

    <p><strong>The SpacetimeDB Way:</strong></p>

    <pre><code class="language-rust">// Gather resource - automatic sync to all subscribed clients
#[reducer]
pub fn gather_resource(ctx: &ReducerContext, resource_id: u64) -> Result<(), String> {
    let mut resource = ctx.db.resource().id().find(&resource_id)
        .ok_or("Resource not found")?;
    
    let player = ctx.db.player().identity().find(&ctx.sender)
        .ok_or("Player not found")?;
    
    // Validate distance
    let distance = ((player.pos_x - resource.pos_x).powi(2) + 
                   (player.pos_y - resource.pos_y).powi(2)).sqrt();
    if distance > 100.0 {
        return Err("Too far".to_string());
    }
    
    // Update resource
    resource.health -= 10;
    ctx.db.resource().id().update(resource);
    
    // Add to inventory
    add_to_inventory(ctx, &ctx.sender, &resource.resource_type, 1)?;
    
    Ok(())
    // SpacetimeDB automatically syncs changes to all subscribed clients!
}</code></pre>

    <p><strong>Benefits:</strong></p>
    <ul>
      <li>70% less code</li>
      <li>Zero manual synchronization</li>
      <li>No broadcast logic needed</li>
      <li>Impossible to have sync bugs</li>
      <li>Type-safe at compile time</li>
    </ul>

    <h3>2. Spatial Subscriptions</h3>

    <p>One of SpacetimeDB's killer features for games is built-in spatial queries. In Broth & Bullets, players only subscribe to chunks near them:</p>

    <pre><code class="language-typescript">// Client automatically subscribes to nearby chunks
const visibleChunks = calculateVisibleChunks(playerX, playerY, viewportWidth, viewportHeight);
const chunkList = visibleChunks.join(',');

conn.subscriptionBuilder()
  .subscribe([
    \`SELECT * FROM player WHERE chunk_index IN (\${chunkList})\`,
    \`SELECT * FROM resource WHERE chunk_index IN (\${chunkList})\`,
    \`SELECT * FROM building WHERE chunk_index IN (\${chunkList})\`
  ]);</code></pre>

    <p><strong>Results:</strong></p>
    <ul>
      <li>94% reduction in bandwidth per player</li>
      <li>86% reduction in client memory usage</li>
      <li>Enabled 10,000×10,000 unit world</li>
      <li>Smooth 60 FPS even with hundreds of entities</li>
    </ul>

    <h3>3. Transactional Game Logic</h3>

    <p>Every reducer runs in a transaction. If it fails, everything rolls back:</p>

    <pre><code class="language-rust">#[reducer]
pub fn craft_item(ctx: &ReducerContext, recipe_id: String) -> Result<(), String> {
    // Check materials
    check_has_materials(ctx, &recipe_id)?;
    
    // Remove materials
    consume_materials(ctx, &recipe_id)?;
    
    // Add crafted item
    add_to_inventory(ctx, &ctx.sender, &get_output(&recipe_id), 1)?;
    
    // If ANY step fails, ENTIRE transaction rolls back
    // No partial crafting, no lost items, no duplication bugs
    Ok(())
}</code></pre>

    <p><strong>This eliminated entire classes of bugs:</strong></p>
    <ul>
      <li>Item duplication exploits</li>
      <li>Partial crafting failures</li>
      <li>Race conditions in resource gathering</li>
      <li>Inventory desync issues</li>
    </ul>

    <h2>🎓 Lessons Learned</h2>

    <h3>What Surprised Us</h3>

    <p><strong>1. Rust Wasn't That Hard</strong></p>
    <p>We expected Rust to be a major blocker. It wasn't. For game logic, you mostly need structs, enums, and basic control flow. The borrow checker actually helped catch bugs.</p>

    <p><strong>2. Less Code = Fewer Bugs</strong></p>
    <p>Going from 15,000 to 1,500 lines wasn't just satisfying - it dramatically reduced our bug count. Fewer lines = fewer places for bugs to hide.</p>

    <p><strong>3. Compile-Time Errors > Runtime Errors</strong></p>
    <p>Rust catches errors at compile time that would be runtime crashes in JavaScript. This saved us countless hours of debugging.</p>

    <p><strong>4. Automatic Sync is Magical</strong></p>
    <p>Not having to think about state synchronization freed our minds to focus on gameplay. It's like having a superpower.</p>

    <h3>What We'd Do Differently</h3>

    <ul>
      <li><strong>Start with SpacetimeDB</strong>: If we could do it over, we'd skip the Node.js prototype entirely</li>
      <li><strong>Learn Rust First</strong>: Spending a week on Rust fundamentals upfront would have saved time</li>
      <li><strong>Spatial Subscriptions from Day 1</strong>: We added these later - should have been there from the start</li>
      <li><strong>Better Testing</strong>: SpacetimeDB makes testing easier, but we didn't take full advantage initially</li>
    </ul>

    <h2>🚫 When NOT to Use SpacetimeDB</h2>

    <p>SpacetimeDB isn't perfect for everything. Here's when you might want alternatives:</p>

    <ul>
      <li><strong>Turn-Based Games</strong>: Firebase might be simpler for low-frequency updates</li>
      <li><strong>Single-Player</strong>: Overkill if you don't need multiplayer</li>
      <li><strong>Existing Large Codebase</strong>: Migration cost might not be worth it</li>
      <li><strong>Need Specific Language</strong>: Currently only Rust and C# for server logic</li>
      <li><strong>Complex External Integrations</strong>: Traditional servers might be easier</li>
    </ul>

    <h2>✅ When SpacetimeDB Shines</h2>

    <p>SpacetimeDB is perfect for:</p>

    <ul>
      <li><strong>Real-Time Multiplayer</strong>: Fast-paced games requiring low latency</li>
      <li><strong>Large Persistent Worlds</strong>: Spatial queries make this feasible</li>
      <li><strong>Complex Game Logic</strong>: Transactional reducers prevent bugs</li>
      <li><strong>Small Teams</strong>: Less code = faster development</li>
      <li><strong>Survival/Crafting Games</strong>: Perfect fit for Broth & Bullets-style games</li>
    </ul>

    <h2>🎮 The Results in Broth & Bullets</h2>

    <h3>What Players Experience</h3>

    <ul>
      <li><strong>Responsive Combat</strong>: 35ms latency makes gunfights feel fair</li>
      <li><strong>Smooth Movement</strong>: No more teleporting players</li>
      <li><strong>Reliable Crafting</strong>: Items never duplicate or disappear</li>
      <li><strong>Large World</strong>: 10,000×10,000 map with no performance issues</li>
      <li><strong>Stable Servers</strong>: Fewer crashes, faster recovery</li>
    </ul>

    <h3>What We Experience as Developers</h3>

    <ul>
      <li><strong>Faster Features</strong>: New mechanics in hours instead of days</li>
      <li><strong>Fewer Bugs</strong>: Sync bugs are literally impossible</li>
      <li><strong>Easier Debugging</strong>: Logs are clear, state is consistent</li>
      <li><strong>Confident Refactoring</strong>: Rust compiler catches mistakes</li>
      <li><strong>Better Sleep</strong>: No 3am pages about sync bugs</li>
    </ul>

    <h2>🔮 The Future</h2>

    <p>We're all-in on SpacetimeDB for Broth & Bullets. Our roadmap includes:</p>

    <ul>
      <li><strong>Clan System</strong>: Shared bases and resources</li>
      <li><strong>Territory Control</strong>: Persistent world ownership</li>
      <li><strong>NPC AI</strong>: Hostile creatures and wildlife</li>
      <li><strong>Quests</strong>: Dynamic objectives and rewards</li>
      <li><strong>Trading</strong>: Player-to-player economy</li>
    </ul>

    <p>All of these would have been nightmares with our old architecture. With SpacetimeDB, they're straightforward.</p>

    <h2>💡 Advice for Other Developers</h2>

    <h3>Should You Use SpacetimeDB?</h3>

    <p>Ask yourself these questions:</p>

    <ol>
      <li>Are you building a real-time multiplayer game?</li>
      <li>Do you need low latency (&lt;50ms)?</li>
      <li>Are you a small team (1-5 developers)?</li>
      <li>Do you want to focus on gameplay, not infrastructure?</li>
      <li>Are you comfortable learning Rust or C#?</li>
    </ol>

    <p>If you answered yes to 3+, seriously consider SpacetimeDB.</p>

    <h3>How to Get Started</h3>

    <ol>
      <li><strong>Learn Rust Basics</strong>: Spend a week on fundamentals</li>
      <li><strong>Follow Tutorials</strong>: SpacetimeDB docs are excellent</li>
      <li><strong>Build a Prototype</strong>: 2 weeks to validate the approach</li>
      <li><strong>Join Discord</strong>: The community is incredibly helpful</li>
      <li><strong>Start Small</strong>: Migrate one system at a time</li>
    </ol>

    <h2>🎯 Conclusion</h2>

    <p>Migrating Broth & Bullets to SpacetimeDB was the best technical decision we made. It:</p>

    <ul>
      <li>Cut our backend code by 90%</li>
      <li>Reduced latency by 77%</li>
      <li>Eliminated an entire class of bugs</li>
      <li>Increased development velocity by 70%</li>
      <li>Saved us $250/month in hosting costs</li>
      <li>Made the game more fun to play</li>
    </ul>

    <p>If you're building a multiplayer game and haven't looked at SpacetimeDB, you're missing out.</p>

    <h2>🔗 Resources</h2>

    <ul>
      <li><strong>Play Broth & Bullets</strong>: <a href="https://brothbullets.com" target="_blank" rel="noopener noreferrer">brothbullets.com</a></li>
      <li><strong>SpacetimeDB Docs</strong>: <a href="https://spacetimedb.com/docs" target="_blank" rel="noopener noreferrer">spacetimedb.com/docs</a></li>
      <li><strong>Join Our Discord</strong>: <a href="https://discord.gg/tUcBzfAYfs" target="_blank" rel="noopener noreferrer">Discuss technical details</a></li>
      <li><strong>Follow Development</strong>: <a href="https://twitter.com/metalhorse233" target="_blank" rel="noopener noreferrer">@metalhorse233 on Twitter</a></li>
    </ul>

    <h2>📚 Related Articles</h2>

    <ul>
      <li><a href="/blog/how-we-built-broth-bullets-multiplayer-survival-game">How We Built Broth & Bullets: A 2D Multiplayer Survival Game</a></li>
      <li><a href="/blog/minimap-spatial-subscriptions">The Hardlight Map: Spatial Awareness in a 2D World</a></li>
      <li><a href="/blog/field-cauldron-mechanics">The Field Cauldron: Brewing Innovation in Survival Gameplay</a></li>
    </ul>

    <p>Questions about our architecture? Join our <a href="https://discord.gg/tUcBzfAYfs" target="_blank" rel="noopener noreferrer">Discord</a> and ask the dev team!</p>
  `
};

