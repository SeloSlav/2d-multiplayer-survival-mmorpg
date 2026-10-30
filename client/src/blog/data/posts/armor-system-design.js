export default {
  slug: "armor-system-design",
  title: "Armor System: More Than Just Protection",
  subtitle: "Building a nuanced armor system where every piece matters and specialization creates meaningful choices",
  date: "2025-11-16",
  author: "Martin Erlic",
  authorImage: "/images/blog/author-marty.jpg",
  authorTwitter: "metalhorse233",
  excerpt: "We've implemented a comprehensive armor system with seven distinct sets, each offering unique resistances, special abilities, and gameplay implications. Every piece matters, with per-piece accumulation that rewards mix-and-match experimentation.",
  coverImage: "/images/blog/armor-system-cover.jpg",
  content: `
    <p>When we started designing the armor system for Broth & Bullets, I wanted every piece of armor to feel meaningful on its own. Most survival games just have individual pieces with stats that accumulate - which is great - but I wanted to take it further by making each piece offer unique gameplay implications beyond just raw protection numbers.</p>
    
    <p>The result is seven distinct armor sets, each with their own identity, strengths, and weaknesses. No piece is just "better" than another - they're all tools for different situations.</p>
    
    <h2>The Philosophy: Per-Piece Accumulation</h2>
    
    <p>Like most survival games, stats accumulate per piece. But we've made sure every piece offers something unique:</p>
    
    <ul>
      <li><strong>Mix and Match</strong> - Want the speed of cloth boots with the protection of scale chestplate? Go for it</li>
      <li><strong>Gradual Progression</strong> - Each piece you craft feels impactful and offers immediate benefits</li>
      <li><strong>Specialization</strong> - You can focus on specific pieces that matter most for your playstyle</li>
      <li><strong>Meaningful Choices</strong> - Every piece has trade-offs and unique properties, not just stat differences</li>
    </ul>
    
    <p>Immunities work with thresholds - they require a certain number of pieces (like 5) to activate, but it's still per-piece accumulation. If you have 5 pieces that grant burn immunity, you're immune. Mix pieces from different sets? As long as 5 of them grant the immunity, you're good.</p>
    
    <h2>Typed Resistance System</h2>
    
    <p>Instead of a single "armor value," we've implemented a typed resistance system that makes combat more tactical:</p>
    
    <ul>
      <li><strong>Melee Resistance</strong> - Reduces damage from close-range attacks</li>
      <li><strong>Projectile Resistance</strong> - Protects against arrows and ranged weapons</li>
      <li><strong>Fire Resistance</strong> - Reduces burn damage (can be negative for wood armor!)</li>
      <li><strong>Blunt/Slash/Pierce Resistance</strong> - Specific protection against different weapon types</li>
      <li><strong>Cold Resistance</strong> - Reduces cold damage (health loss) when warmth is low</li>
    </ul>
    
    <p>This creates interesting choices. Do you prioritize projectile resistance because you're getting shot at a lot? Or focus on melee resistance for close-quarters combat? Maybe you need cold resistance more than anything else because you're spending time in the frozen tundra.</p>
    
    <div class="image-container text-center mb-4">
      <img src="/images/blog/armor-resistances-ui.jpg" alt="Armor Resistance UI" class="blog-image-full mx-auto" />
      <p class="image-caption text-sm text-gray-600 mt-2">The armor stats panel shows all accumulated resistances and bonuses from equipped pieces</p>
    </div>
    
    <div class="image-container text-center mb-4">
      <img src="/images/blog/armor-equipment-screen.jpg" alt="Armor Equipment Screen" class="blog-image-full mx-auto" />
      <p class="image-caption text-sm text-gray-600 mt-2">The equipment screen showing different armor pieces and their individual properties</p>
    </div>
    
    <h2>The Seven Armor Sets</h2>
    
    <h3>Cloth Armor: Speed and Utility</h3>
    
    <p>Cloth armor is your starting set - easy to craft, lightweight, and surprisingly useful:</p>
    
    <ul>
      <li><strong>Speed Bonus</strong> - +2% movement speed per piece (10% total for full set)</li>
      <li><strong>Fast Drying</strong> - Cloth dries faster when wet, reducing status effect duration</li>
      <li><strong>Minimal Protection</strong> - Basic resistances across the board</li>
      <li><strong>Warmth Bonus</strong> - Small warmth bonus helps in cold weather</li>
    </ul>
    
    <p>Cloth is perfect for players who prioritize mobility and quick resource gathering. The speed bonus might seem small, but over long distances it adds up. And the fast-drying property means you can sprint through rain without worrying about the wetness debuff lingering too long.</p>
    
    <div class="image-container text-center mb-4">
      <img src="/images/blog/cloth-armor-set.jpg" alt="Cloth Armor Set" class="blog-image-full mx-auto" />
      <p class="image-caption text-sm text-gray-600 mt-2">The basic cloth armor set - lightweight and fast, perfect for early game exploration</p>
    </div>
    
    <h3>Bone Armor: Projectile Defense Specialist</h3>
    
    <p>Bone armor is all about surviving ranged combat:</p>
    
    <ul>
      <li><strong>High Projectile Resistance</strong> - Excellent protection against arrows and ranged attacks</li>
      <li><strong>Burn Immunity</strong> - 5 pieces grants complete immunity to fire damage</li>
      <li><strong>Fire Vulnerability</strong> - But watch out - wood armor deals double fire damage to you</li>
      <li><strong>Moderate Melee Protection</strong> - Decent all-around defense</li>
    </ul>
    
    <p>Bone armor is the go-to choice for players who find themselves in PvP situations or dealing with ranged threats. The burn immunity is huge - it means you can walk through campfires, ignore torch attacks, and laugh at fire arrows. But that fire vulnerability creates an interesting rock-paper-scissors dynamic with wood armor users.</p>
    
    <h3>Wood Armor: Tanky but Risky</h3>
    
    <p>Wood armor is the definition of high risk, high reward:</p>
    
    <ul>
      <li><strong>Strong Melee Defense</strong> - Excellent protection against close-range attacks</li>
      <li><strong>Damage Reflection</strong> - Reflects 3% of melee damage back to attackers (15% total for full set)</li>
      <li><strong>Double Fire Damage</strong> - You take 2x damage from fire sources - a massive weakness</li>
      <li><strong>Speed Penalty</strong> - -4% movement speed per piece (-20% total)</li>
    </ul>
    
    <p>Wood armor turns you into a walking tank, but at a cost. The damage reflection means melee attackers hurt themselves attacking you, creating interesting combat dynamics. But that fire vulnerability means you need to be extremely careful around campfires, torches, and fire arrows. One wrong move and you're toast - literally.</p>
    
    <div class="image-container text-center mb-4">
      <img src="/images/blog/wood-armor-combat.jpg" alt="Wood Armor Combat" class="blog-image-full mx-auto" />
      <p class="image-caption text-sm text-gray-600 mt-2">Wood armor's damage reflection creates interesting combat dynamics - attackers take reflected damage</p>
    </div>
    
    <h3>Leather Armor: Balanced and Versatile</h3>
    
    <p>Leather is the "jack of all trades" set:</p>
    
    <ul>
      <li><strong>Balanced Resistances</strong> - Good protection across all damage types</li>
      <li><strong>Bleed Immunity</strong> - 3 pieces grants immunity to bleed effects</li>
      <li><strong>Stamina Regen</strong> - Small stamina regeneration bonus (though stamina system is currently removed)</li>
      <li><strong>No Major Weaknesses</strong> - Solid all-around choice</li>
    </ul>
    
    <p>Leather is perfect for players who want reliable protection without major trade-offs. The bleed immunity is particularly useful against certain weapons and animal attacks. It's not flashy, but it's dependable.</p>
    
    <h3>Scale Armor: Heavy Protection</h3>
    
    <p>Scale armor is made from viper scales - heavy, protective, but slow:</p>
    
    <ul>
      <li><strong>High Slash Resistance</strong> - Excellent against cutting weapons</li>
      <li><strong>Wetness Immunity</strong> - 5 pieces grants complete immunity to wetness effects</li>
      <li><strong>Knockback Immunity</strong> - 5 pieces prevents knockback from attacks</li>
      <li><strong>Speed Penalty</strong> - -3% movement speed per piece (-15% total)</li>
    </ul>
    
    <p>Scale armor is the ultimate defensive set. That knockback immunity is huge in PvP - you can't be pushed around, making you incredibly difficult to dislodge from positions. The wetness immunity means you can sprint through rain without any penalties. But the speed penalty means you're committing to a slower, more methodical playstyle.</p>
    
    <div class="image-container text-center mb-4">
      <img src="/images/blog/scale-armor-set.jpg" alt="Scale Armor Set" class="blog-image-full mx-auto" />
      <p class="image-caption text-sm text-gray-600 mt-2">Scale armor made from viper scales - heavy protection with immunities to wetness and knockback</p>
    </div>
    
    <h3>Fox Fur Armor: Stealth and Cold Resistance</h3>
    
    <p>Fox fur armor is all about surviving the cold and staying hidden:</p>
    
    <ul>
      <li><strong>Cold Resistance</strong> - 20% cold resistance per piece (reduces health damage when warmth is low)</li>
      <li><strong>Cold Immunity</strong> - 5 pieces grants complete immunity to cold damage</li>
      <li><strong>Warmth Bonus</strong> - Each piece provides warmth bonus that slows warmth drain</li>
      <li><strong>Stealth Bonus</strong> - Reduces animal detection radius by 10% per piece</li>
      <li><strong>Silent Movement</strong> - Fox fur boots completely silence your footsteps</li>
      <li><strong>Lightweight</strong> - No speed penalties, maintains mobility</li>
    </ul>
    
    <p>Fox fur is the stealth player's dream. The silent boots are game-changing - you can sprint past animals without alerting them, making hunting and exploration much easier. The warmth bonus helps slow warmth drain, while cold resistance reduces the health damage you take when warmth gets low. The detection radius reduction makes you harder to spot by both animals and other players.</p>
    
    <div class="image-container text-center mb-4">
      <img src="/images/blog/fox-fur-stealth.jpg" alt="Fox Fur Stealth" class="blog-image-full mx-auto" />
      <p class="image-caption text-sm text-gray-600 mt-2">Fox fur boots allow silent movement - perfect for sneaking past dangerous wildlife</p>
    </div>
    
    <h3>Wolf Fur Armor: Intimidation and Power</h3>
    
    <p>Wolf fur armor is for players who want to dominate:</p>
    
    <ul>
      <li><strong>Cold Resistance</strong> - Same 20% per piece as fox fur (reduces health damage when warmth is low)</li>
      <li><strong>Cold Immunity</strong> - 5 pieces grants complete immunity to cold damage</li>
      <li><strong>Warmth Bonus</strong> - Each piece provides warmth bonus that slows warmth drain</li>
      <li><strong>Animal Intimidation</strong> - Animals are less likely to attack you</li>
      <li><strong>Low Health Damage Bonus</strong> - +4% damage per piece when below 30% health (20% total)</li>
      <li><strong>Better Protection</strong> - Higher resistances than fox fur</li>
    </ul>
    
    <p>Wolf fur is the aggressive player's choice. That animal intimidation is huge - wolves and foxes will think twice before attacking you. And the low health damage bonus creates interesting risk-reward gameplay. Do you stay at low health to maximize damage, or play it safe? The choice is yours.</p>
    
    <div class="image-container text-center mb-4">
      <img src="/images/blog/wolf-fur-armor-set.jpg" alt="Wolf Fur Armor Set" class="blog-image-full mx-auto" />
      <p class="image-caption text-sm text-gray-600 mt-2">Wolf fur armor - intimidating to animals and powerful in combat when health is low</p>
    </div>
    
    <h2>Special Abilities and Interactions</h2>
    
    <p>Beyond resistances, armor pieces grant special abilities that create unique gameplay situations:</p>
    
    <h3>Silent Movement (Fox Fur Boots)</h3>
    
    <p>This was one of the more interesting features to implement. Fox fur boots completely silence your movement sounds - no footsteps, no sprinting sounds, nothing. This integrates directly with our animal AI system - animals can't hear you coming, making stealth approaches viable.</p>
    
    <p>It also affects PvP in interesting ways. Players rely on sound cues to detect threats, so silent movement creates genuine stealth gameplay opportunities.</p>
    
    <h3>Damage Reflection (Wood Armor)</h3>
    
    <p>The damage reflection mechanic creates interesting combat dynamics. When someone attacks you with melee weapons while you're wearing wood armor, they take reflected damage. This means:</p>
    
    <ul>
      <li>Aggressive melee attackers hurt themselves</li>
      <li>High-damage weapons become riskier to use</li>
      <li>Combat becomes more tactical - do you risk attacking the wood-armored player?</li>
    </ul>
    
    <h3>Animal Intimidation (Wolf Fur)</h3>
    
    <p>This integrates directly with our wildlife AI. Animals check if you're wearing wolf fur armor and adjust their behavior accordingly. Wolves that would normally attack might back off. It's not a guarantee - pack behavior can override it - but it creates meaningful risk reduction.</p>
    
    <h3>Cold Resistance vs Cold Immunity</h3>
    
    <p>This was an important distinction to get right:</p>
    
    <ul>
      <li><strong>Cold Resistance</strong> - Reduces health damage taken when warmth is low (graduated benefit)</li>
      <li><strong>Cold Immunity</strong> - Completely prevents cold damage when warmth is low</li>
      <li><strong>Warmth Bonus</strong> - Separate stat that adds warmth per second, slowing warmth drain</li>
    </ul>
    
    <p>So fur armor pieces provide two benefits: warmth bonus (which slows warmth drain) and cold resistance (which reduces health damage when warmth gets low). Even if you don't have full immunity, partial cold resistance still helps by reducing the health damage you take. This makes individual pieces valuable even before you complete a set.</p>
    
    <h2>Understanding Warmth vs Cold Protection</h2>
    
    <p>One of the most common questions we get is: "What's the difference between warmth and cold protection?" It's a crucial distinction that affects how you survive in the tundra, so let me break it down clearly.</p>
    
    <h3>The Two-Layer Cold System</h3>
    
    <p>Our cold survival system works in two stages:</p>
    
    <ol>
      <li><strong>Warmth Drain</strong> - Your warmth stat constantly drains over time, especially in cold biomes</li>
      <li><strong>Cold Damage</strong> - When your warmth gets too low, you start taking health damage</li>
    </ol>
    
    <p>Armor affects <em>both</em> of these stages, but in different ways:</p>
    
    <h3>Warmth Bonus: Slowing the Drain</h3>
    
    <p>When armor provides a <strong>warmth bonus</strong>, it's adding warmth points per second to your character. This doesn't prevent warmth drain - it just slows it down by counteracting some of the drain rate.</p>
    
    <p>Think of it like this:</p>
    
    <ul>
      <li>Base warmth drain in cold biome: -2 warmth/second</li>
      <li>Cloth armor warmth bonus: +0.5 warmth/second per piece</li>
      <li>With 5 pieces of cloth: -2 + 2.5 = +0.5 warmth/second (net gain!)</li>
    </ul>
    
    <p><strong>All armor types</strong> provide some warmth bonus - even cloth and leather. This means any armor helps you stay warm longer. The difference is in the magnitude:</p>
    
    <ul>
      <li><strong>Cloth/Leather/Bone/Wood/Scale</strong> - Small warmth bonuses (helps a bit)</li>
      <li><strong>Fox Fur/Wolf Fur</strong> - Large warmth bonuses (significantly slows drain)</li>
    </ul>
    
    <h3>Cold Resistance: Reducing the Damage</h3>
    
    <p>When armor provides <strong>cold resistance</strong>, it's reducing the health damage you take when your warmth gets low. This is a <em>separate</em> calculation that happens after warmth has already dropped.</p>
    
    <p>Here's how it works:</p>
    
    <ul>
      <li>Your warmth drops below the threshold (usually around 20%)</li>
      <li>The game calculates cold damage based on how low your warmth is</li>
      <li>Cold resistance reduces that damage by a percentage</li>
    </ul>
    
    <p>Example scenario:</p>
    
    <ul>
      <li>Your warmth is at 10% (very cold)</li>
      <li>Base cold damage: 5 health/second</li>
      <li>You're wearing 3 pieces of fox fur (60% cold resistance)</li>
      <li>Actual damage taken: 5 × (1 - 0.60) = 2 health/second</li>
    </ul>
    
    <p><strong>Only fur armor</strong> provides cold resistance - fox fur and wolf fur both give 20% cold resistance per piece. Other armor types (cloth, leather, bone, wood, scale) do NOT provide cold resistance, only warmth bonuses.</p>
    
    <h3>Why Both Matter</h3>
    
    <p>This two-layer system creates interesting strategic choices:</p>
    
    <ul>
      <li><strong>Warmth Bonus</strong> - Prevents the problem (keeps warmth high longer)</li>
      <li><strong>Cold Resistance</strong> - Mitigates the consequence (reduces damage when warmth is low)</li>
    </ul>
    
    <p>In practice, this means:</p>
    
    <ul>
      <li><strong>Any armor</strong> helps with cold survival by slowing warmth drain</li>
      <li><strong>Fur armor</strong> is specialized for cold - it both slows drain AND reduces damage</li>
      <li><strong>Mix and match</strong> strategies work - you can wear some fur pieces for cold resistance while keeping other armor for different bonuses</li>
    </ul>
    
    <h3>Practical Examples</h3>
    
    <p><strong>Scenario 1: Cloth Armor in Cold Biome</strong></p>
    <ul>
      <li>Warmth bonus: Moderate (slows drain)</li>
      <li>Cold resistance: 0% (no damage reduction)</li>
      <li>Result: You stay warm longer, but once warmth drops, you take full cold damage</li>
    </ul>
    
    <p><strong>Scenario 2: Fox Fur Armor in Cold Biome</strong></p>
    <ul>
      <li>Warmth bonus: High (significantly slows drain)</li>
      <li>Cold resistance: 100% with full set (no damage)</li>
      <li>Result: You stay warm much longer, and even if warmth drops, you take no cold damage</li>
    </ul>
    
    <p><strong>Scenario 3: Mixed Build (3 Fox Fur + 2 Scale)</strong></p>
    <ul>
      <li>Warmth bonus: Moderate-high (decent drain reduction)</li>
      <li>Cold resistance: 60% (significant damage reduction)</li>
      <li>Result: Good cold survival while maintaining scale armor's other benefits (slash resistance, wetness immunity)</li>
    </ul>
    
    <h3>The Bottom Line</h3>
    
    <p>When players say "I'm wearing armor but still taking cold damage," it's usually because they're wearing armor with warmth bonuses but no cold resistance. The armor IS helping - it's keeping their warmth higher for longer. But once warmth drops below the threshold, they need cold resistance to reduce the damage.</p>
    
    <p>This is why fur armor is so valuable in the tundra - it's the only armor that provides both layers of protection. But even without fur armor, any armor helps with cold survival by slowing warmth drain. You just need to be more careful about staying near heat sources and monitoring your warmth stat.</p>
    
    <h2>The Crafting Economy</h2>
    
    <p>We've balanced the crafting costs to make armor feel achievable without being trivial:</p>
    
    <ul>
      <li><strong>Cloth</strong> - Basic materials, easy to craft early game</li>
      <li><strong>Bone</strong> - Requires animal bones, moderate difficulty</li>
      <li><strong>Wood</strong> - Wood and rope, accessible mid-game</li>
      <li><strong>Leather</strong> - Animal leather, requires hunting</li>
      <li><strong>Scale</strong> - Viper scales (rare), 1-2 scales per piece</li>
      <li><strong>Fox Fur</strong> - Fox fur (moderate rarity), 1-2 fur per piece</li>
      <li><strong>Wolf Fur</strong> - Wolf fur (moderate rarity), 1-2 fur per piece</li>
    </ul>
    
    <p>We recently rebalanced the fur and scale costs after realizing the original numbers were way too high. With good tools, you get about 13-18 fur per fox corpse, so requiring 1-2 fur per piece means a full set takes roughly one good hunt. This feels rewarding without being grindy.</p>
    
    <h2>Mix and Match Strategies</h2>
    
    <p>The per-piece accumulation system encourages creative builds:</p>
    
    <ul>
      <li><strong>Speed Build</strong> - Cloth boots + cloth pants for maximum mobility</li>
      <li><strong>Stealth Build</strong> - Fox fur boots + fox fur hood for silent movement and reduced detection</li>
      <li><strong>Tank Build</strong> - Wood chestplate + scale leggings for maximum melee protection</li>
      <li><strong>Cold Survival</strong> - Mix fox/wolf fur pieces to reach cold immunity threshold</li>
      <li><strong>PvP Specialist</strong> - Bone armor for projectile protection + wood pieces for melee reflection</li>
    </ul>
    
    <p>There's no "best" build - it all depends on what you're doing and what threats you're facing. This creates meaningful choices and encourages experimentation.</p>
    
    <div class="image-container text-center mb-4">
      <img src="/images/blog/armor-mix-match.jpg" alt="Armor Mix and Match" class="blog-image-full mx-auto" />
      <p class="image-caption text-sm text-gray-600 mt-2">Players can mix pieces from different sets to create builds that match their playstyle</p>
    </div>
    
    <div class="image-container text-center mb-4">
      <img src="/images/blog/armor-stats-comparison.jpg" alt="Armor Stats Comparison" class="blog-image-full mx-auto" />
      <p class="image-caption text-sm text-gray-600 mt-2">Comparing different armor combinations and their accumulated stats</p>
    </div>
    
    <h2>Technical Implementation</h2>
    
    <p>From a technical perspective, implementing this system required several interesting challenges:</p>
    
    <ul>
      <li><strong>Typed Damage System</strong> - Weapons now have damage types (slash, blunt, pierce, projectile, fire) that interact with armor resistances</li  >
      <li><strong>Per-Piece Calculation</strong> - The system iterates through all equipped pieces and accumulates stats</li>
      <li><strong>Immunity Thresholds</strong> - Counting pieces that grant specific immunities and checking thresholds</li>
      <li><strong>Integration Points</strong> - Armor checks are integrated into combat, status effects, animal AI, and movement systems</li>
    </ul>
    
    <p>The most interesting integration was with the animal AI system. Animals check for intimidation and silent movement, adjusting their behavior dynamically. This creates emergent gameplay where armor choice directly affects how you interact with the world.</p>
    
    <div class="image-container text-center mb-4">
      <img src="/images/blog/armor-mix-match-gameplay.jpg" alt="Armor Mix and Match Gameplay" class="blog-image-full mx-auto" />
      <p class="image-caption text-sm text-gray-600 mt-2">Players experimenting with different armor combinations in actual gameplay</p>
    </div>
    
    <h2>Primitive Tier: Just the Beginning</h2>
    
    <p>It's worth noting that everything I've described here is just the <strong>primitive tier</strong> of armor in Broth & Bullets. We're currently in the "broth" phase of development - focusing on survival, crafting, and primitive technology.</p>
    
    <p>The "bullets" part of our name isn't just for show. We've got plans for higher technology tiers that will introduce completely different armor systems:</p>
    
    <ul>
      <li><strong>Modern Military Armor</strong> - Ballistic vests, tactical gear, and advanced protection systems</li>
      <li><strong>Advanced Materials</strong> - Kevlar, ceramic plates, and composite armors</li>
      <li><strong>Technology Integration</strong> - Armor with integrated systems, sensors, and advanced capabilities</li>
      <li><strong>Specialized Roles</strong> - Different armor sets for different combat roles and situations</li>
    </ul>
    
    <p>But we're taking it one step at a time. The primitive armor system we've built establishes the foundation - the philosophy of per-piece accumulation, meaningful choices, and mix-and-match builds. When we get to modern armor sets, we'll apply the same principles but with entirely different mechanics and capabilities.</p>
    
    <p>For now, players are working with what they can craft from the resources available in the tundra. Cloth, bone, wood, leather, scales, and fur - these are the materials of survival in a harsh environment. But as the game evolves and technology tiers unlock, we'll see how armor systems evolve alongside them.</p>
    
    <div class="image-container text-center mb-4">
      <img src="/images/blog/primitive-armor-crafting.jpg" alt="Primitive Armor Crafting" class="blog-image-full mx-auto" />
      <p class="image-caption text-sm text-gray-600 mt-2">Crafting primitive armor from materials found in the tundra - this is just the beginning</p>
    </div>
    
    <h2>Future Considerations</h2>
    
    <p>We're still iterating on the armor system based on player feedback. Some things we're considering:</p>
    
    <ul>
      <li>Armor durability and repair systems</li>
      <li>Visual customization options</li>
      <li>Additional special effects for different playstyles</li>
      <li>Armor set synergies (without requiring full sets)</li>
      <li>Modern armor tiers as we progress toward the "bullets" phase</li>
    </ul>
    
    <p>But the core philosophy remains: every piece should feel meaningful, and players should be able to create builds that match their playstyle without being forced into specific set combinations. This philosophy will carry forward as we expand into higher technology tiers.</p>
    
    <h2>The Result</h2>
    
    <p>What we've ended up with is an armor system that creates meaningful choices at every step. Do you prioritize speed, protection, or special abilities? Do you mix sets or focus on one? Do you craft early-game cloth armor or save resources for late-game fur sets?</p>

    <p>There's no single "best" answer - and that's exactly what we wanted. The armor system should support different playstyles, not dictate them. And from what we're seeing in alpha testing, players are finding creative ways to combine pieces that we didn't even anticipate.</p>

    <p>That's the sign of a good system - when players discover strategies you didn't plan for, you know you've created something with depth and flexibility.</p>

    <h2>🔗 Related Articles</h2>

    <p>Explore more of Broth & Bullets' interconnected survival systems:</p>

    <ul>
      <li><a href="/blog/how-we-built-broth-bullets-multiplayer-survival-game">How We Built Broth & Bullets</a> - The complete development story</li>
      <li><a href="/blog/resource-system-implementation">Resource System: From Harvest to Inventory</a> - Gathering materials for crafting armor</li>
      <li><a href="/blog/building-system-2d-challenges">Building in 2D: Solving the Shelter Problem</a> - Complementary survival mechanics</li>
      <li><a href="/blog/broth-bullets-spacetimedb-architecture">Why Broth & Bullets Uses SpacetimeDB</a> - Technical architecture enabling complex systems</li>
    </ul>
  `,
  tags: ["Development", "Armor System", "Game Design", "Combat", "Crafting", "Survival Mechanics", "Technical"]
};

