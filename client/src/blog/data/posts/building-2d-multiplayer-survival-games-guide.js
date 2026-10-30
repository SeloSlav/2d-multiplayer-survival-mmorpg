export default {
  slug: 'building-2d-multiplayer-survival-games-guide',
  title: 'Complete Guide to Building 2D Multiplayer Survival Games in 2025',
  subtitle: 'From architecture and networking to game mechanics and deployment',
  date: '2025-11-17',
  author: 'Martin Erlic',
  authorImage: '/images/blog/author-marty.jpg',
  authorTwitter: 'metalhorse233',
  excerpt: 'A comprehensive guide covering every aspect of 2D multiplayer survival game development, based on our experience building Broth & Bullets.',
  tags: ['Game Development', 'Multiplayer', 'Survival Games', 'SpacetimeDB', 'Tutorial', 'React'],
  coverImage: '/images/blog/spacetimedb-revolution-cover.jpg',
  content: `
    <p>Building a multiplayer survival game is one of the most challenging yet rewarding projects in game development. This comprehensive guide covers everything you need to know, from architecture decisions to implementing core survival mechanics, based on our experience building <a href="/blog/how-we-built-broth-bullets-multiplayer-survival-game">Broth & Bullets</a>. For a deep dive into our tech stack, see our <a href="/blog/broth-bullets-spacetimedb-architecture">SpacetimeDB architecture article</a>.</p>

    <h2>Table of Contents</h2>

    <ol>
      <li><a href="#architecture">Architecture & Tech Stack</a></li>
      <li><a href="#world-generation">World Generation</a></li>
      <li><a href="#player-movement">Player Movement & Physics</a></li>
      <li><a href="#resource-system">Resource System</a></li>
      <li><a href="#crafting-inventory">Crafting & Inventory</a></li>
      <li><a href="#building-system">Building System</a></li>
      <li><a href="#combat-health">Combat & Health</a></li>
      <li><a href="#multiplayer-sync">Multiplayer Synchronization</a></li>
      <li><a href="#performance">Performance Optimization</a></li>
      <li><a href="#deployment">Deployment & Scaling</a></li>
    </ol>

    <h2 id="architecture">1. Architecture & Tech Stack</h2>

    <h3>Recommended Tech Stack (2025)</h3>

    <p><strong>Server:</strong></p>
    <ul>
      <li><strong>SpacetimeDB</strong>: Real-time database with built-in multiplayer (our choice)</li>
      <li><strong>Alternative</strong>: Node.js + Socket.io + PostgreSQL (traditional)</li>
    </ul>

    <p><strong>Client:</strong></p>
    <ul>
      <li><strong>React + TypeScript</strong>: Component-based UI with type safety</li>
      <li><strong>Canvas API</strong>: For 2D rendering (or Pixi.js for advanced graphics)</li>
      <li><strong>Alternative</strong>: Unity WebGL, Phaser, or Godot</li>
    </ul>

    <h3>Why SpacetimeDB?</h3>
    <ul>
      <li>No backend code needed (game logic runs in database)</li>
      <li>Automatic state synchronization</li>
      <li>Built-in spatial queries for large worlds</li>
      <li>70% less code than traditional stack</li>
      <li>Sub-50ms latency</li>
    </ul>

    <h2 id="world-generation">2. World Generation</h2>

    <h3>Procedural World with Perlin Noise</h3>

    <p>Generate a diverse world with biomes, resources, and terrain:</p>

    <pre><code class="language-rust">use spacetimedb::{table, reducer, ReducerContext};
use noise::{NoiseFn, Perlin};

pub const WORLD_WIDTH: f32 = 10000.0;
pub const WORLD_HEIGHT: f32 = 10000.0;
pub const CHUNK_SIZE: f32 = 256.0;

#[table(name = resource, public, index(btree(columns = [chunk_index])))]
pub struct Resource {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub resource_type: String,  // "tree", "rock", "mushroom", "berry_bush"
    pub pos_x: f32,
    pub pos_y: f32,
    pub chunk_index: u32,
    pub health: u32,
    pub max_health: u32,
    pub respawn_at: Option<u64>,  // Timestamp for respawn
}

#[reducer(init)]
pub fn initialize_world(ctx: &ReducerContext) {
    log::info!("Generating world...");
    
    let perlin_elevation = Perlin::new(12345);
    let perlin_moisture = Perlin::new(67890);
    
    // Generate resources across the world
    for chunk_y in 0..(WORLD_HEIGHT / CHUNK_SIZE) as u32 {
        for chunk_x in 0..(WORLD_WIDTH / CHUNK_SIZE) as u32 {
            let chunk_center_x = chunk_x as f32 * CHUNK_SIZE + CHUNK_SIZE / 2.0;
            let chunk_center_y = chunk_y as f32 * CHUNK_SIZE + CHUNK_SIZE / 2.0;
            
            // Sample noise at chunk center
            let elevation = perlin_elevation.get([
                chunk_center_x as f64 / 1000.0,
                chunk_center_y as f64 / 1000.0
            ]) as f32 * 0.5 + 0.5; // Normalize to 0-1
            
            let moisture = perlin_moisture.get([
                chunk_center_x as f64 / 800.0,
                chunk_center_y as f64 / 800.0
            ]) as f32 * 0.5 + 0.5;
            
            // Determine biome and spawn resources
            let biome = determine_biome(elevation, moisture);
            spawn_resources_for_biome(ctx, &biome, chunk_center_x, chunk_center_y);
        }
    }
    
    log::info!("World generation complete!");
}</code></pre>

    <h3>Resource Respawning</h3>

    <p>Implement automatic resource respawning using scheduled reducers:</p>

    <pre><code class="language-rust">#[table(name = resource_respawn_schedule, scheduled(respawn_resources), scheduled_at(scheduled_at))]
pub struct ResourceRespawnSchedule {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub scheduled_at: ScheduleAt,
}

#[reducer]
pub fn respawn_resources(ctx: &ReducerContext, _args: ResourceRespawnSchedule) {
    // Security: Only allow scheduler to call this
    if ctx.sender != ctx.identity() {
        return;
    }
    
    let current_time = ctx.timestamp.micros_since_epoch;
    
    // Find resources that need respawning
    for resource in ctx.db.resource().iter() {
        if let Some(respawn_time) = resource.respawn_at {
            if current_time >= respawn_time {
                // Respawn the resource
                let mut updated = resource.clone();
                updated.health = updated.max_health;
                updated.respawn_at = None;
                ctx.db.resource().id().update(updated);
            }
        }
    }
}</code></pre>

    <h2 id="player-movement">3. Player Movement & Physics</h2>

    <h3>Server-Side Player State</h3>

    <pre><code class="language-rust">#[table(name = player, public, index(btree(columns = [chunk_index])))]
pub struct Player {
    #[primary_key]
    pub identity: Identity,
    pub name: String,
    pub pos_x: f32,
    pub pos_y: f32,
    pub chunk_index: u32,
    pub direction: String,     // "up", "down", "left", "right"
    pub health: u32,
    pub max_health: u32,
    pub online: bool,
}

#[reducer]
pub fn move_player(
    ctx: &ReducerContext,
    new_x: f32,
    new_y: f32,
    direction: String
) -> Result<(), String> {
    let mut player = ctx.db.player().identity().find(&ctx.sender)
        .ok_or("Player not found")?;
    
    // Validate movement (anti-cheat)
    let distance = ((new_x - player.pos_x).powi(2) + (new_y - player.pos_y).powi(2)).sqrt();
    if distance > 10.0 {
        return Err("Movement too large".to_string());
    }
    
    // Update position
    player.pos_x = new_x.clamp(0.0, WORLD_WIDTH);
    player.pos_y = new_y.clamp(0.0, WORLD_HEIGHT);
    player.direction = direction;
    
    // Update chunk if needed
    let new_chunk = position_to_chunk_index(player.pos_x, player.pos_y);
    if new_chunk != player.chunk_index {
        player.chunk_index = new_chunk;
    }
    
    ctx.db.player().identity().update(player);
    Ok(())
}</code></pre>

    <h3>Client-Side Movement (React)</h3>

    <pre><code class="language-typescript">import { useEffect, useRef } from 'react';
import { DbConnection } from './module_bindings';

const MOVE_SPEED = 200; // pixels per second

export function usePlayerMovement(conn: DbConnection | null) {
  const keysPressed = useRef<Set<string>>(new Set());
  const lastUpdateRef = useRef<number>(Date.now());
  
  useEffect(() => {
    if (!conn) return;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['w', 'a', 's', 'd'].includes(e.key)) {
        keysPressed.current.add(e.key);
        e.preventDefault();
      }
    };
    
    const handleKeyUp = (e: KeyboardEvent) => {
      keysPressed.current.delete(e.key);
    };
    
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    
    // Movement update loop
    const updateMovement = () => {
      const now = Date.now();
      const deltaTime = (now - lastUpdateRef.current) / 1000;
      lastUpdateRef.current = now;
      
      let dx = 0, dy = 0;
      let direction = 'down';
      
      if (keysPressed.current.has('w')) { dy -= 1; direction = 'up'; }
      if (keysPressed.current.has('s')) { dy += 1; direction = 'down'; }
      if (keysPressed.current.has('a')) { dx -= 1; direction = 'left'; }
      if (keysPressed.current.has('d')) { dx += 1; direction = 'right'; }
      
      // Normalize diagonal movement
      if (dx !== 0 && dy !== 0) {
        const length = Math.sqrt(dx * dx + dy * dy);
        dx /= length;
        dy /= length;
      }
      
      if (dx !== 0 || dy !== 0) {
        const newX = positionRef.current.x + dx * MOVE_SPEED * deltaTime;
        const newY = positionRef.current.y + dy * MOVE_SPEED * deltaTime;
        
        conn.reducers.movePlayer(newX, newY, direction);
      }
      
      requestAnimationFrame(updateMovement);
    };
    
    updateMovement();
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [conn]);
}</code></pre>

    <h2 id="resource-system">4. Resource System</h2>

    <h3>Resource Gathering</h3>

    <pre><code class="language-rust">#[reducer]
pub fn gather_resource(
    ctx: &ReducerContext,
    resource_id: u64,
    damage: u32
) -> Result<(), String> {
    let mut resource = ctx.db.resource().id().find(&resource_id)
        .ok_or("Resource not found")?;
    
    // Check if resource is already depleted
    if resource.respawn_at.is_some() {
        return Err("Resource is depleted".to_string());
    }
    
    // Get player
    let player = ctx.db.player().identity().find(&ctx.sender)
        .ok_or("Player not found")?;
    
    // Check distance
    let distance = ((player.pos_x - resource.pos_x).powi(2) + 
                   (player.pos_y - resource.pos_y).powi(2)).sqrt();
    if distance > 100.0 {
        return Err("Too far from resource".to_string());
    }
    
    // Apply damage
    if resource.health <= damage {
        // Resource depleted - give items and set respawn
        resource.health = 0;
        resource.respawn_at = Some(ctx.timestamp.micros_since_epoch + 60_000_000); // 60 seconds
        
        // Give items to player
        let items = get_resource_drops(&resource.resource_type);
        for (item_type, quantity) in items {
            add_to_inventory(ctx, &ctx.sender, &item_type, quantity)?;
        }
    } else {
        resource.health -= damage;
    }
    
    ctx.db.resource().id().update(resource);
    Ok(())
}</code></pre>

    <h2 id="crafting-inventory">5. Crafting & Inventory</h2>

    <h3>Inventory System</h3>

    <pre><code class="language-rust">#[table(name = inventory_item, public)]
pub struct InventoryItem {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub owner: Identity,
    pub item_type: String,
    pub quantity: u32,
    pub slot: u32,  // Inventory slot (0-39)
}

#[reducer]
pub fn craft_item(ctx: &ReducerContext, recipe_id: String) -> Result<(), String> {
    let recipe = ctx.db.crafting_recipe().recipe_id().find(&recipe_id)
        .ok_or("Recipe not found")?;
    
    // Check if player has required items
    for (item_type, required_qty) in parse_required_items(&recipe.required_items) {
        let player_qty: u32 = ctx.db.inventory_item().iter()
            .filter(|i| i.owner == ctx.sender && i.item_type == item_type)
            .map(|i| i.quantity)
            .sum();
        
        if player_qty < required_qty {
            return Err(format!("Not enough {}", item_type));
        }
    }
    
    // Consume required items
    for (item_type, required_qty) in parse_required_items(&recipe.required_items) {
        remove_from_inventory(ctx, &ctx.sender, &item_type, required_qty)?;
    }
    
    // Give output item
    add_to_inventory(ctx, &ctx.sender, &recipe.output_item, recipe.output_quantity)?;
    
    Ok(())
}</code></pre>

    <h2 id="building-system">6. Building System</h2>

    <h3>Building Placement</h3>

    <pre><code class="language-rust">#[table(name = building, public, index(btree(columns = [chunk_index])))]
pub struct Building {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub building_type: String,  // "wall", "door", "chest", "campfire"
    pub pos_x: f32,
    pub pos_y: f32,
    pub chunk_index: u32,
    pub owner: Identity,
    pub health: u32,
    pub max_health: u32,
    pub rotation: u32,  // 0, 90, 180, 270
}

#[reducer]
pub fn place_building(
    ctx: &ReducerContext,
    building_type: String,
    x: f32,
    y: f32,
    rotation: u32
) -> Result<(), String> {
    // Check if player has required items
    let required_items = get_building_requirements(&building_type);
    for (item_type, qty) in &required_items {
        let player_qty: u32 = ctx.db.inventory_item().iter()
            .filter(|i| i.owner == ctx.sender && i.item_type == *item_type)
            .map(|i| i.quantity)
            .sum();
        
        if player_qty < *qty {
            return Err(format!("Need {} {}", qty, item_type));
        }
    }
    
    // Check for collisions
    let building_size = get_building_size(&building_type);
    for existing in ctx.db.building().iter() {
        let distance = ((existing.pos_x - x).powi(2) + (existing.pos_y - y).powi(2)).sqrt();
        if distance < building_size + get_building_size(&existing.building_type) {
            return Err("Too close to another building".to_string());
        }
    }
    
    // Consume items and place building
    for (item_type, qty) in &required_items {
        remove_from_inventory(ctx, &ctx.sender, item_type, *qty)?;
    }
    
    let (health, max_health) = get_building_health(&building_type);
    ctx.db.building().insert(Building {
        id: 0,
        building_type,
        pos_x: x,
        pos_y: y,
        chunk_index: position_to_chunk_index(x, y),
        owner: ctx.sender,
        health,
        max_health,
        rotation,
    });
    
    Ok(())
}</code></pre>

    <h2 id="combat-health">7. Combat & Health</h2>

    <h3>Damage System</h3>

    <pre><code class="language-rust">#[reducer]
pub fn attack_player(
    ctx: &ReducerContext,
    target_id: Identity,
    damage: u32
) -> Result<(), String> {
    let attacker = ctx.db.player().identity().find(&ctx.sender)
        .ok_or("Attacker not found")?;
    
    let mut target = ctx.db.player().identity().find(&target_id)
        .ok_or("Target not found")?;
    
    // Check distance
    let distance = ((attacker.pos_x - target.pos_x).powi(2) + 
                   (attacker.pos_y - target.pos_y).powi(2)).sqrt();
    if distance > 50.0 {
        return Err("Target too far".to_string());
    }
    
    // Apply damage
    if target.health <= damage {
        target.health = 0;
        handle_player_death(ctx, &target)?;
    } else {
        target.health -= damage;
    }
    
    ctx.db.player().identity().update(target);
    Ok(())
}</code></pre>

    <h2 id="multiplayer-sync">8. Multiplayer Synchronization</h2>

    <h3>Client-Side State Management</h3>

    <pre><code class="language-typescript">import { useState, useEffect } from 'react';
import { DbConnection, Player, Resource, Building } from './module_bindings';

export function useGameState(conn: DbConnection | null) {
  const [players, setPlayers] = useState<Map<string, Player>>(new Map());
  const [resources, setResources] = useState<Map<number, Resource>>(new Map());
  const [buildings, setBuildings] = useState<Map<number, Building>>(new Map());
  
  useEffect(() => {
    if (!conn) return;
    
    // Player callbacks
    conn.db.Player.onInsert((ctx, player) => {
      setPlayers(prev => new Map(prev).set(player.identity.toHexString(), player));
    });
    
    conn.db.Player.onUpdate((ctx, oldPlayer, newPlayer) => {
      setPlayers(prev => new Map(prev).set(newPlayer.identity.toHexString(), newPlayer));
    });
    
    // Resource callbacks
    conn.db.Resource.onInsert((ctx, resource) => {
      setResources(prev => new Map(prev).set(resource.id, resource));
    });
    
    conn.db.Resource.onUpdate((ctx, oldRes, newRes) => {
      setResources(prev => new Map(prev).set(newRes.id, newRes));
    });
  }, [conn]);
  
  return { players, resources, buildings };
}</code></pre>

    <h2 id="performance">9. Performance Optimization</h2>

    <h3>Key Optimization Techniques</h3>

    <ol>
      <li><strong>Spatial Subscriptions</strong> (covered in detail in <a href="/blog/spatial-subscriptions-multiplayer-games">our spatial subscriptions guide</a>)</li>
      <li><strong>Entity Culling</strong>: Only render entities in viewport</li>
      <li><strong>Sprite Batching</strong>: Batch similar sprites into single draw calls</li>
      <li><strong>Object Pooling</strong>: Reuse objects instead of creating new ones</li>
      <li><strong>Throttle Updates</strong>: Don't send position updates every frame</li>
    </ol>

    <h3>Client-Side Rendering Optimization</h3>

    <pre><code class="language-typescript">// Entity culling
function isEntityVisible(entity: { pos_x: number, pos_y: number }, camera: Camera): boolean {
  const buffer = 100; // pixels
  return (
    entity.pos_x >= camera.x - buffer &&
    entity.pos_x <= camera.x + camera.width + buffer &&
    entity.pos_y >= camera.y - buffer &&
    entity.pos_y <= camera.y + camera.height + buffer
  );
}

// Sprite batching
function renderEntities(ctx: CanvasRenderingContext2D, entities: Entity[]) {
  // Group by sprite sheet
  const batches = new Map<string, Entity[]>();
  
  for (const entity of entities) {
    const sheet = entity.spriteSheet;
    if (!batches.has(sheet)) {
      batches.set(sheet, []);
    }
    batches.get(sheet)!.push(entity);
  }
  
  // Render each batch
  for (const [sheet, batch] of batches) {
    const image = getImage(sheet);
    for (const entity of batch) {
      ctx.drawImage(image, /* ... */);
    }
  }
}</code></pre>

    <h2 id="deployment">10. Deployment & Scaling</h2>

    <h3>Production Deployment Checklist</h3>

    <p><strong>Server (SpacetimeDB):</strong></p>
    <ul>
      <li>✅ Optimize reducer performance</li>
      <li>✅ Add proper error handling</li>
      <li>✅ Implement rate limiting</li>
      <li>✅ Add anti-cheat validation</li>
      <li>✅ Set up monitoring and alerts</li>
      <li>✅ Configure backups</li>
      <li>✅ Load test with expected player count</li>
    </ul>

    <p><strong>Client:</strong></p>
    <ul>
      <li>✅ Minify and bundle assets</li>
      <li>✅ Implement asset lazy loading</li>
      <li>✅ Add error boundaries</li>
      <li>✅ Set up analytics</li>
      <li>✅ Optimize bundle size</li>
      <li>✅ Test on various devices/browsers</li>
      <li>✅ Configure CDN for assets</li>
    </ul>

    <h3>Deployment Commands</h3>

    <pre><code class="language-bash"># Build server module
cd server
spacetime build --project-path .

# Publish to SpacetimeDB Cloud
spacetime publish --server maincloud --project-path . my-survival-game-prod

# Build client
cd ../client
npm run build

# Deploy client to hosting (e.g., Vercel, Netlify)
vercel deploy --prod</code></pre>

    <h3>Scaling Considerations</h3>

    <p><strong>Up to 100 players:</strong></p>
    <ul>
      <li>Single SpacetimeDB instance</li>
      <li>Basic spatial subscriptions</li>
      <li>Standard server specs</li>
    </ul>

    <p><strong>100-500 players:</strong></p>
    <ul>
      <li>Implement chunk-based subscriptions</li>
      <li>Optimize reducer performance</li>
      <li>Increase server resources</li>
      <li>Add CDN for assets</li>
    </ul>

    <p><strong>500+ players:</strong></p>
    <ul>
      <li>Consider SpacetimeDB Enterprise (clustering)</li>
      <li>Implement advanced spatial partitioning</li>
      <li>Add load balancing</li>
      <li>Optimize database queries with indexes</li>
    </ul>

    <h2>Conclusion</h2>

    <p>Building a 2D multiplayer survival game is a complex but achievable project. The key is to:</p>

    <ol>
      <li><strong>Start simple</strong>: Get basic movement and multiplayer working first</li>
      <li><strong>Iterate quickly</strong>: Add features incrementally</li>
      <li><strong>Optimize early</strong>: Use spatial subscriptions from the start</li>
      <li><strong>Test continuously</strong>: Play with friends to find issues</li>
      <li><strong>Monitor performance</strong>: Track FPS, latency, and bandwidth</li>
    </ol>

    <p>With SpacetimeDB, you can build a production-ready multiplayer survival game in weeks instead of months. The automatic state synchronization and built-in spatial queries eliminate most of the complexity of traditional multiplayer development.</p>

    <h2>Resources & Next Steps</h2>

    <p><strong>Learn More:</strong></p>
    <ul>
      <li><a href="/blog/spacetimedb-tutorial-build-multiplayer-game-30-minutes">SpacetimeDB Tutorial: Build a Multiplayer Game in 30 Minutes</a></li>
      <li><a href="/blog/spatial-subscriptions-multiplayer-games">Implementing Spatial Subscriptions</a></li>
      <li><a href="/blog/spacetimedb-vs-firebase-comparison">SpacetimeDB vs Firebase Comparison</a></li>
    </ul>

    <p><strong>Broth & Bullets:</strong></p>
    <ul>
      <li><a href="https://brothbullets.com">Play Broth & Bullets</a></li>
      <li><a href="https://github.com/clockworklabs/broth-bullets" target="_blank" rel="noopener noreferrer">Source Code</a></li>
      <li><a href="/blog">Development Blog</a></li>
    </ul>

    <p><strong>Community:</strong></p>
    <ul>
      <li><a href="https://discord.gg/tUcBzfAYfs" target="_blank" rel="noopener noreferrer">SpacetimeDB Discord</a></li>
      <li><a href="https://spacetimedb.com/docs" target="_blank" rel="noopener noreferrer">SpacetimeDB Documentation</a></li>
    </ul>

    <p>Ready to start building? Follow our <a href="/blog/spacetimedb-tutorial-build-multiplayer-game-30-minutes">30-minute tutorial</a> to get started!</p>
  `
};
