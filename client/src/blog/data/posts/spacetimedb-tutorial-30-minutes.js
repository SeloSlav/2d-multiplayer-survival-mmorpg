export default {
  slug: 'spacetimedb-tutorial-build-multiplayer-game-30-minutes',
  title: 'SpacetimeDB Tutorial: Build a Real-Time Multiplayer Game in 30 Minutes',
  subtitle: 'Learn how to build a real-time multiplayer game from scratch using SpacetimeDB',
  date: '2025-11-17',
  author: 'Martin Erlic',
  authorImage: '/images/blog/author-marty.jpg',
  authorTwitter: 'metalhorse233',
  excerpt: 'Complete tutorial with code examples, common pitfalls, and production-ready patterns for building multiplayer games with SpacetimeDB.',
  tags: ['SpacetimeDB', 'Tutorial', 'Multiplayer', 'WebAssembly', 'Rust', 'React'],
  coverImage: '/images/blog/spacetimedb-revolution-cover.jpg',
  content: `
    <p>If you're looking to build a real-time multiplayer game without the complexity of traditional game servers, SpacetimeDB is a game-changer. In this comprehensive tutorial, we'll build a functional multiplayer game from scratch in just 30 minutes. For a deeper comparison with traditional backends, check out our <a href="/blog/spacetimedb-vs-firebase-comparison">SpacetimeDB vs Firebase comparison</a>.</p>

    <h2>What is SpacetimeDB?</h2>

    <p>SpacetimeDB is a revolutionary database that runs your game logic directly inside the database itself. Instead of building separate web servers, REST APIs, and managing complex state synchronization, you write your game logic in Rust or C#, compile it to WebAssembly, and deploy it directly to SpacetimeDB.</p>

    <h3>Why SpacetimeDB for Multiplayer Games?</h3>

    <ul>
      <li><strong>Zero Backend Code</strong>: Your game logic runs in the database</li>
      <li><strong>Automatic State Sync</strong>: Clients automatically receive updates</li>
      <li><strong>Built-in Multiplayer</strong>: No need for complex networking code</li>
      <li><strong>Type-Safe</strong>: Generated client bindings ensure type safety</li>
      <li><strong>Low Latency</strong>: Optimized for real-time applications</li>
      <li><strong>Spatial Queries</strong>: Built-in support for game world queries</li>
    </ul>

    <h2>Prerequisites</h2>

    <p>Before we start, make sure you have:</p>

    <ul>
      <li>Rust installed (rustup.rs)</li>
      <li>Node.js 18+ installed</li>
      <li>Basic knowledge of Rust and React</li>
      <li>30 minutes of focused time</li>
    </ul>

    <h2>Step 1: Install SpacetimeDB CLI</h2>

    <p>First, install the SpacetimeDB command-line tool:</p>

    <pre><code class="language-bash"># macOS/Linux
curl -sSf https://install.spacetimedb.com | sh

# Windows (PowerShell)
iwr https://windows.spacetimedb.com -useb | iex</code></pre>

    <p>Verify the installation:</p>

    <pre><code class="language-bash">spacetime version
# Should show version 1.0+</code></pre>

    <h2>Step 2: Create Your Server Module</h2>

    <p>Initialize a new SpacetimeDB module:</p>

    <pre><code class="language-bash">spacetime init --lang rust multiplayer-game-server
cd multiplayer-game-server</code></pre>

    <p>This creates a Rust project with the SpacetimeDB SDK pre-configured.</p>

    <h2>Step 3: Define Your Game Schema</h2>

    <p>Open <code>src/lib.rs</code> and define your game tables. We'll create a simple multiplayer position-tracking game:</p>

    <pre><code class="language-rust">use spacetimedb::{table, reducer, ReducerContext, Identity, Timestamp};

// Player table - stores player state
#[table(name = player, public)]
pub struct Player {
    #[primary_key]
    pub identity: Identity,
    pub name: String,
    pub x: f32,
    pub y: f32,
    pub online: bool,
    pub last_update: Timestamp,
}

// Message table - for chat functionality
#[table(name = message, public)]
pub struct Message {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub sender: Identity,
    pub text: String,
    pub timestamp: Timestamp,
}</code></pre>

    <p><strong>Key Concepts:</strong></p>

    <ul>
      <li><code>#[table(name = player, public)]</code>: Defines a database table that clients can subscribe to</li>
      <li><code>#[primary_key]</code>: Ensures uniqueness and enables efficient lookups</li>
      <li><code>#[auto_inc]</code>: Automatically generates sequential IDs</li>
      <li><code>public</code>: Makes the table visible to clients (private by default)</li>
    </ul>

    <h2>Step 4: Implement Game Logic with Reducers</h2>

    <p>Reducers are functions that modify your game state. They're atomic, transactional, and automatically synchronized to all clients:</p>

    <pre><code class="language-rust">use spacetimedb::{log, Table};

// Called when a player connects
#[reducer(client_connected)]
pub fn client_connected(ctx: &ReducerContext) {
    log::info!("Player connected: {}", ctx.sender);
    
    // Check if player already exists
    if ctx.db.player().identity().find(&ctx.sender).is_none() {
        // Create new player at spawn point
        ctx.db.player().insert(Player {
            identity: ctx.sender,
            name: format!("Player_{}", ctx.sender.to_hex().chars().take(8).collect::<String>()),
            x: 0.0,
            y: 0.0,
            online: true,
            last_update: ctx.timestamp,
        });
    } else {
        // Update existing player to online
        if let Some(mut player) = ctx.db.player().identity().find(&ctx.sender) {
            player.online = true;
            player.last_update = ctx.timestamp;
            ctx.db.player().identity().update(player);
        }
    }
}

// Update player position
#[reducer]
pub fn update_position(ctx: &ReducerContext, x: f32, y: f32) -> Result<(), String> {
    let mut player = ctx.db.player().identity().find(&ctx.sender)
        .ok_or("Player not found")?;
    
    // Validate movement (prevent teleporting)
    let distance = ((x - player.x).powi(2) + (y - player.y).powi(2)).sqrt();
    if distance > 100.0 {
        return Err("Movement too large - possible cheating".to_string());
    }
    
    player.x = x;
    player.y = y;
    player.last_update = ctx.timestamp;
    ctx.db.player().identity().update(player);
    
    Ok(())
}</code></pre>

    <h2>Step 5: Build and Publish Your Module</h2>

    <p>Build your server module:</p>

    <pre><code class="language-bash">spacetime build --project-path .</code></pre>

    <p>Start a local SpacetimeDB instance:</p>

    <pre><code class="language-bash">spacetime start</code></pre>

    <p>Publish your module to the local database:</p>

    <pre><code class="language-bash">spacetime publish --project-path . multiplayer-game-local</code></pre>

    <h2>Step 6: Generate Client Bindings</h2>

    <p>SpacetimeDB automatically generates type-safe client code:</p>

    <pre><code class="language-bash"># Create React client project
npx create-react-app multiplayer-game-client
cd multiplayer-game-client

# Install SpacetimeDB SDK
npm install spacetimedb

# Generate bindings
spacetime generate --lang typescript \\
  --out-dir src/module_bindings \\
  --project-path ../multiplayer-game-server</code></pre>

    <h2>Step 7: Build the React Client</h2>

    <p>Create <code>src/Game.tsx</code>:</p>

    <pre><code class="language-typescript">import { useEffect, useState, useRef } from 'react';
import { DbConnection, Player, Message } from './module_bindings';
import { Identity } from 'spacetimedb';

export default function Game() {
  const [conn, setConn] = useState<DbConnection | null>(null);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [players, setPlayers] = useState<Map<string, Player>>(new Map());
  
  // Connect to SpacetimeDB
  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    
    const connection = DbConnection.builder()
      .withUri('ws://localhost:3000')
      .withModuleName('multiplayer-game-local')
      .withToken(token)
      .onConnect((conn, id, token) => {
        console.log('Connected with identity:', id.toHexString());
        localStorage.setItem('auth_token', token);
        setIdentity(id);
        
        // Subscribe to all game data
        conn.subscriptionBuilder()
          .onApplied(() => console.log('Subscription applied'))
          .subscribe(['SELECT * FROM player', 'SELECT * FROM message']);
      })
      .build();
    
    setConn(connection);
  }, []);

  return (
    <div>
      <h1>Multiplayer Game</h1>
      <p>Players Online: {players.size}</p>
    </div>
  );
}</code></pre>

    <h2>Step 8: Run Your Multiplayer Game</h2>

    <p>Start the React client:</p>

    <pre><code class="language-bash">npm start</code></pre>

    <p>Open multiple browser windows to <code>http://localhost:3000</code> and watch them sync in real-time!</p>

    <h2>Common Issues and Solutions</h2>

    <h3>Issue: "Connection refused"</h3>
    <p><strong>Solution:</strong> Make sure SpacetimeDB is running (<code>spacetime start</code>)</p>

    <h3>Issue: "Module not found"</h3>
    <p><strong>Solution:</strong> Verify module is published (<code>spacetime list</code>)</p>

    <h3>Issue: "Type errors in generated bindings"</h3>
    <p><strong>Solution:</strong> Regenerate bindings after server changes</p>

    <h2>Performance Optimization Tips</h2>

    <h3>1. Use Spatial Subscriptions for Large Worlds</h3>

    <p>Instead of subscribing to all players, use chunk-based queries:</p>

    <pre><code class="language-typescript">// Only subscribe to nearby players
conn.subscriptionBuilder()
  .subscribe([
    \`SELECT * FROM player WHERE 
     x BETWEEN \${playerX - 500} AND \${playerX + 500} AND
     y BETWEEN \${playerY - 500} AND \${playerY + 500}\`
  ]);</code></pre>

    <h3>2. Throttle Position Updates</h3>

    <p>Don't send updates every frame:</p>

    <pre><code class="language-typescript">let lastUpdate = 0;
const UPDATE_INTERVAL = 50; // 20 updates per second

const handleMouseMove = (e: React.MouseEvent) => {
  const now = Date.now();
  if (now - lastUpdate < UPDATE_INTERVAL) return;
  lastUpdate = now;
  
  // Send update
  conn.reducers.updatePosition(x, y);
};</code></pre>

    <h2>Next Steps</h2>

    <p>Congratulations! You've built a real-time multiplayer game with SpacetimeDB. Here's what to explore next:</p>

    <ol>
      <li><strong>Add Game Mechanics</strong>: Implement health, inventory, combat</li>
      <li><strong>Improve Security</strong>: Add anti-cheat validation in reducers</li>
      <li><strong>Scale Up</strong>: Deploy to SpacetimeDB Cloud for production</li>
      <li><strong>Add Persistence</strong>: Implement save/load functionality</li>
      <li><strong>Optimize Rendering</strong>: Use canvas layers and sprite batching</li>
    </ol>

    <h2>Production Deployment</h2>

    <p>When you're ready to deploy:</p>

    <pre><code class="language-bash"># Publish to SpacetimeDB Cloud
spacetime publish --server maincloud --project-path . my-game-prod

# Update client to use production URL
const connection = DbConnection.builder()
  .withUri('wss://maincloud.spacetimedb.com')
  .withModuleName('my-game-prod')
  // ...</code></pre>

    <h2>Conclusion</h2>

    <p>SpacetimeDB eliminates the complexity of traditional multiplayer game development. No backend servers, no REST APIs, no complex state synchronization - just write your game logic and let SpacetimeDB handle the rest.</p>

    <p>The patterns shown in this tutorial scale from simple prototypes to production games with thousands of concurrent players. We use these exact patterns in Broth & Bullets, our 2D multiplayer survival game.</p>

    <h3>Key Takeaways</h3>

    <ul>
      <li><strong>Tables</strong> store your game state</li>
      <li><strong>Reducers</strong> modify state atomically</li>
      <li><strong>Subscriptions</strong> keep clients in sync automatically</li>
      <li><strong>Type-safe bindings</strong> prevent runtime errors</li>
      <li><strong>Built-in multiplayer</strong> requires zero networking code</li>
    </ul>

    <p>Ready to build something amazing? Check out our other tutorials:</p>

    <ul>
      <li><a href="/blog/spacetimedb-vs-firebase-comparison">SpacetimeDB vs Firebase: Complete Comparison</a></li>
      <li><a href="/blog/spatial-subscriptions-multiplayer-games">Implementing Spatial Subscriptions in Multiplayer Games</a></li>
      <li><a href="/blog/building-2d-multiplayer-survival-games-guide">Building 2D Multiplayer Survival Games: Complete Guide</a></li>
    </ul>

    <h2>Resources</h2>

    <ul>
      <li><a href="https://spacetimedb.com/docs" target="_blank" rel="noopener noreferrer">SpacetimeDB Documentation</a></li>
      <li><a href="https://github.com/clockworklabs/broth-bullets" target="_blank" rel="noopener noreferrer">Broth & Bullets Source Code</a></li>
      <li><a href="https://discord.gg/tUcBzfAYfs" target="_blank" rel="noopener noreferrer">SpacetimeDB Discord Community</a></li>
    </ul>

    <p>Happy coding! 🚀</p>
  `
};
