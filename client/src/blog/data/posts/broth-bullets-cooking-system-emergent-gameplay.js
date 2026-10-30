export default {
  slug: 'broth-bullets-cooking-system-emergent-gameplay',
  title: 'Creating Emergent Gameplay: The Broth & Bullets Cooking System',
  subtitle: 'How AI-generated recipes and environmental interactions create endless discovery',
  date: '2025-11-17',
  author: 'Martin Erlic',
  authorImage: '/images/blog/author-marty.jpg',
  authorTwitter: 'metalhorse233',
  excerpt: 'Deep dive into Broth & Bullets\' signature Field Cauldron system - from AI recipe generation to environmental interactions that create emergent survival gameplay.',
  tags: ['Broth & Bullets', 'Game Design', 'AI', 'Cooking System', 'Emergent Gameplay', 'Game Mechanics'],
  coverImage: '/images/blog/broth-bullets-cooking-system-cover.jpg',
  content: `
    <p>The Field Cauldron isn't just a crafting station - it's the heart of Broth & Bullets' survival gameplay and the inspiration behind our name. This sophisticated cooking system combines AI-generated recipes, environmental interactions, and player experimentation to create truly emergent gameplay. Here's how we built it. For more on our overall game design philosophy, read <a href="/blog/how-we-built-broth-bullets-multiplayer-survival-game">how we built Broth & Bullets</a>.</p>

    <h2>🍲 Why "Broth" & Bullets?</h2>

    <p>The name "Broth & Bullets" reflects our core design philosophy: survival depends as much on what you cook as what you carry. While other survival games treat food as a simple hunger meter, we wanted cooking to be a deep, rewarding system that players actively engage with.</p>

    <h3>The Design Goals</h3>

    <ul>
      <li><strong>Meaningful Choices</strong>: Different foods provide different benefits</li>
      <li><strong>Experimentation</strong>: Players discover recipes through trial and error</li>
      <li><strong>Knowledge as Power</strong>: Experienced players have competitive advantages</li>
      <li><strong>Environmental Integration</strong>: Weather and world state affect cooking</li>
      <li><strong>Infinite Variety</strong>: AI generates unique items from ingredient combinations</li>
    </ul>

    <h2>⚗️ The Field Cauldron System</h2>

    <h3>Core Components</h3>

    <p>The Field Cauldron system consists of several interconnected mechanics:</p>

    <ul>
      <li><strong>Cauldron Placement</strong>: Must be positioned on a burning campfire</li>
      <li><strong>Water Management</strong>: Freshwater, seawater, and desalination</li>
      <li><strong>Ingredient Slots</strong>: Combine up to 3 ingredients per recipe</li>
      <li><strong>Cooking Process</strong>: Time-based preparation with fuel consumption</li>
      <li><strong>AI Recipe Generation</strong>: Claude AI creates unique food items</li>
      <li><strong>Environmental Interactions</strong>: Rain, tree cover, temperature effects</li>
    </ul>

    <h3>The Cauldron-Campfire Connection</h3>

    <p>Unlike traditional survival games where cooking stations exist independently, our Field Cauldron integrates seamlessly with the campfire system:</p>

    <ul>
      <li><strong>Smart Positioning</strong>: Cauldron automatically snaps above nearby campfires</li>
      <li><strong>Fuel Dependency</strong>: Only functions when campfire is actively burning</li>
      <li><strong>Portable Design</strong>: Pick up and move to different campfires (water spills)</li>
      <li><strong>Visual Feedback</strong>: Y-sorting ensures proper rendering above ground entities</li>
    </ul>

    <h2>💧 Water: The Foundation</h2>

    <h3>Water Sources</h3>

    <p>Every recipe begins with water, but not all water is created equal:</p>

    <ul>
      <li><strong>Freshwater</strong>: Collected from rain collectors, rivers, inland water patches</li>
      <li><strong>Seawater</strong>: Abundant along Kamchatka's coastline but requires processing</li>
      <li><strong>Container System</strong>: Plastic water jugs, bottles, and containers for transport</li>
    </ul>

    <h3>Desalination Mechanics</h3>

    <p>One of the cauldron's most crucial functions is converting seawater into drinkable freshwater:</p>

    <ul>
      <li>Pour seawater into cauldron and light campfire beneath</li>
      <li>Boiling process gradually converts seawater to freshwater over time</li>
      <li>Fuel consumption increases during desalination</li>
      <li>Strategic placement near coastal areas makes seawater viable for bases</li>
    </ul>

    <p><strong>Game Design Impact:</strong> This mechanic enables coastal base building despite lack of freshwater sources, creating strategic location decisions.</p>

    <h3>Automatic Rain Collection</h3>

    <p>Exposed cauldrons automatically fill with rainwater during storms:</p>

    <ul>
      <li>Cauldrons collect rainwater even under tree cover</li>
      <li>Tree cover protects campfires from extinguishing in rain</li>
      <li>Best placement: under trees to get both rain collection AND fire protection</li>
      <li>Players discover "rain kitchens" with multiple cauldrons under tree cover for auto-filling</li>
    </ul>

    <h2>🤖 AI Recipe Generation</h2>

    <h3>The Problem with Traditional Crafting</h3>

    <p>Most survival games have fixed recipes:</p>

    <ul>
      <li>Limited variety (maybe 50-100 recipes total)</li>
      <li>Players memorize everything quickly</li>
      <li>No room for creativity or experimentation</li>
      <li>Wikis ruin discovery</li>
    </ul>

    <p>We wanted something different: <strong>contextual recipes that reward experimentation while converging toward environmentally appropriate results</strong>.</p>

    <h3>How AI Recipe Generation Works</h3>

    <p>When a player combines ingredients in the cauldron, we use Claude AI to generate a unique food item:</p>

    <p><strong>Step 1: Gather Context</strong></p>
    <pre><code class="language-javascript">const context = {
  ingredients: ["mushroom", "wild_garlic", "salt"],
  waterType: "freshwater",
  cookingTime: 120, // seconds
  campfireTemp: "high",
  weather: "rainy",
  biome: "forest"
};</code></pre>

    <p><strong>Step 2: Send to Claude AI</strong></p>
    <pre><code class="language-javascript">const prompt = \`You are a survival game chef creating a recipe.

Ingredients: \${context.ingredients.join(", ")}
Water: \${context.waterType}
Cooking time: \${context.cookingTime}s
Environment: \${context.biome}, \${context.weather}

Generate a unique food item with:
- Creative name (2-4 words)
- Description (1-2 sentences)
- Health restoration (10-50)
- Stamina boost (5-30)
- Special effect (optional)
- Flavor profile

Format as JSON.\`;

const recipe = await claude.generate(prompt);</code></pre>

    <p><strong>Step 3: Create Unique Item</strong></p>
    <pre><code class="language-json">{
  "name": "Forager's Warming Broth",
  "description": "A hearty mushroom soup infused with wild garlic, perfect for cold rainy nights in the forest.",
  "health": 35,
  "stamina": 20,
  "effects": ["cold_resistance_10min"],
  "flavor": "Earthy and pungent with a warming finish"
}</code></pre>

    <h3>Why This Works</h3>

    <ul>
      <li><strong>Experimentation with Convergence</strong>: Same ingredients produce contextually appropriate results that fit the game's environmental design</li>
      <li><strong>Meaningful Differences</strong>: AI considers environment and creates effects that make sense for the situation</li>
      <li><strong>Discovery</strong>: Players experiment to find what works in different contexts</li>
      <li><strong>Storytelling</strong>: Each item has flavor text that fits the world and moment</li>
      <li><strong>Emergent Meta</strong>: Community shares discoveries about which combinations work best in which situations</li>
    </ul>

    <h3>Balancing AI Generation</h3>

    <p>We constrain AI output to maintain game balance:</p>

    <ul>
      <li><strong>Health Caps</strong>: 10-50 based on ingredient rarity</li>
      <li><strong>Effect Duration</strong>: 5-15 minutes maximum</li>
      <li><strong>Effect Strength</strong>: Percentage-based limits</li>
      <li><strong>Validation</strong>: Server checks AI output before creating item</li>
      <li><strong>Fallbacks</strong>: If AI fails, use deterministic recipe system</li>
    </ul>

    <h2>🌧️ Environmental Interactions</h2>

    <h3>Weather System Integration</h3>

    <p>The cauldron doesn't exist in isolation - it interacts with Broth & Bullets' dynamic weather:</p>

    <p><strong>During Rain:</strong></p>
    <ul>
      <li>Cauldrons fill with rainwater automatically (even under tree cover)</li>
      <li>Exposed campfires extinguish (cauldron stops cooking)</li>
      <li>Tree coverage protects campfires from extinguishing</li>
      <li>Optimal placement: under trees for both rain collection AND fire protection</li>
    </ul>

    <p><strong>Temperature Effects:</strong></p>
    <ul>
      <li>Cold weather slows cooking times</li>
      <li>Hot weather increases evaporation (water loss)</li>
      <li>Cooking provides warmth to nearby players</li>
      <li>Hot foods provide temporary cold resistance</li>
    </ul>

    <h3>Tree Coverage Mechanics</h3>

    <p>One of our favorite emergent interactions:</p>

    <ul>
      <li>Trees provide overhead coverage in a radius</li>
      <li>Covered campfires stay lit during rain</li>
      <li>Cauldrons collect rainwater regardless of tree cover</li>
      <li>Players build "rain kitchens" under trees for optimal setup</li>
      <li>Deforestation affects base functionality (campfires extinguish in rain)</li>
    </ul>

    <p><strong>Emergent Strategy:</strong> Players discovered that placing cauldrons under tree coverage gives the best of both worlds - passive rain collection while keeping campfires burning during storms.</p>

    <h2>🎯 Gameplay Implications</h2>

    <h3>Survival Loop</h3>

    <p>The cauldron creates a compelling gameplay loop:</p>

    <ol>
      <li><strong>Gather Ingredients</strong>: Forage mushrooms, berries, herbs</li>
      <li><strong>Collect Water</strong>: Fill containers from rain collectors or coast</li>
      <li><strong>Build Campfire</strong>: Place and fuel fire</li>
      <li><strong>Position Cauldron</strong>: Strategic placement for coverage/rain</li>
      <li><strong>Experiment</strong>: Try ingredient combinations</li>
      <li><strong>Discover</strong>: Learn what works through trial and error</li>
      <li><strong>Share Knowledge</strong>: Trade recipes with other players</li>
    </ol>

    <h3>PvP Dynamics</h3>

    <p>The cooking system affects competitive play:</p>

    <ul>
      <li><strong>Pre-Battle Preparation</strong>: Buff yourself with specialized foods before fights</li>
      <li><strong>Healing Economy</strong>: Skilled cooks create valuable healing items for trade</li>
      <li><strong>Poison Warfare</strong>: Offensive preparations add tactical depth</li>
      <li><strong>Knowledge Advantage</strong>: Effective recipes become competitive secrets</li>
      <li><strong>Base Raiding</strong>: Destroying enemy cauldrons disrupts their preparation</li>
    </ul>

    <h3>Social Gameplay</h3>

    <p>Cooking encourages player interaction:</p>

    <ul>
      <li><strong>Recipe Trading</strong>: Players share successful combinations</li>
      <li><strong>Cooking Specialization</strong>: Some players become known as expert chefs</li>
      <li><strong>Clan Kitchens</strong>: Shared cooking facilities for teams</li>
      <li><strong>Food Economy</strong>: Prepared meals become valuable trade goods</li>
    </ul>

    <h2>📊 Player Behavior & Discovery</h2>

    <h3>Unexpected Strategies</h3>

    <p>Players discovered tactics we never anticipated:</p>

    <p><strong>The "Rain Kitchen"</strong></p>
    <ul>
      <li>Multiple cauldrons placed in exposed areas</li>
      <li>Automatically fill during storms</li>
      <li>Move to covered campfires for cooking</li>
      <li>Eliminates manual water hauling</li>
    </ul>

    <p><strong>The "Coastal Desalination Plant"</strong></p>
    <ul>
      <li>Bases built on coastline for infinite seawater</li>
      <li>Multiple cauldrons running desalination 24/7</li>
      <li>Freshwater becomes export commodity</li>
      <li>Creates economic specialization</li>
    </ul>

    <p><strong>The "Mobile Kitchen"</strong></p>
    <ul>
      <li>Portable campfire + cauldron + ingredients</li>
      <li>Cook on the move during exploration</li>
      <li>Enables long-distance expeditions</li>
      <li>Risk vs reward (exposed while cooking)</li>
    </ul>

    <h3>Community Knowledge Sharing</h3>

    <p>Players created their own systems for recipe documentation:</p>

    <ul>
      <li><strong>Discord Recipe Channels</strong>: Community-maintained databases</li>
      <li><strong>In-Game Notes</strong>: Players write down successful combinations</li>
      <li><strong>Recipe Trading</strong>: Valuable information becomes currency</li>
      <li><strong>Clan Cookbooks</strong>: Teams compile their best discoveries</li>
    </ul>

    <h2>⚙️ Technical Implementation</h2>

    <h3>Server-Side (SpacetimeDB)</h3>

    <p>The cauldron system uses SpacetimeDB reducers for game logic:</p>

    <pre><code class="language-rust">#[table(name = broth_pot, public)]
pub struct BrothPot {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub pos_x: f32,
    pub pos_y: f32,
    pub chunk_index: u32,
    pub owner: Identity,
    pub water_level: u32,      // 0-100
    pub water_type: String,    // "fresh" or "sea"
    pub campfire_id: Option<u64>,
    pub ingredient_1: Option<String>,
    pub ingredient_2: Option<String>,
    pub ingredient_3: Option<String>,
    pub cooking_progress: u32, // 0-100
    pub is_cooking: bool,
}

#[reducer]
pub fn add_ingredient_to_cauldron(
    ctx: &ReducerContext,
    cauldron_id: u64,
    ingredient: String,
    slot: u32
) -> Result<(), String> {
    let mut cauldron = ctx.db.broth_pot().id().find(&cauldron_id)
        .ok_or("Cauldron not found")?;
    
    // Validate ownership
    if cauldron.owner != ctx.sender {
        return Err("Not your cauldron".to_string());
    }
    
    // Check if campfire is burning
    if let Some(campfire_id) = cauldron.campfire_id {
        let campfire = ctx.db.campfire().id().find(&campfire_id)
            .ok_or("Campfire not found")?;
        if !campfire.is_burning {
            return Err("Campfire not burning".to_string());
        }
    }
    
    // Add ingredient to slot
    match slot {
        1 => cauldron.ingredient_1 = Some(ingredient),
        2 => cauldron.ingredient_2 = Some(ingredient),
        3 => cauldron.ingredient_3 = Some(ingredient),
        _ => return Err("Invalid slot".to_string()),
    }
    
    ctx.db.broth_pot().id().update(cauldron);
    Ok(())
}</code></pre>

    <h3>Client-Side (React)</h3>

    <p>The cauldron UI provides intuitive drag-and-drop interaction:</p>

    <pre><code class="language-typescript">export function CauldronInterface({ cauldronId }: Props) {
  const [cauldron, setCauldron] = useState<BrothPot | null>(null);
  
  // Subscribe to cauldron updates
  useEffect(() => {
    if (!conn) return;
    
    conn.db.BrothPot.onUpdate((ctx, oldCauldron, newCauldron) => {
      if (newCauldron.id === cauldronId) {
        setCauldron(newCauldron);
      }
    });
  }, [conn, cauldronId]);
  
  const handleIngredientDrop = (ingredient: string, slot: number) => {
    conn.reducers.addIngredientToCauldron(cauldronId, ingredient, slot);
  };
  
  return (
    <div className="cauldron-interface">
      <WaterLevel level={cauldron?.water_level} type={cauldron?.water_type} />
      <IngredientSlot slot={1} ingredient={cauldron?.ingredient_1} onDrop={handleIngredientDrop} />
      <IngredientSlot slot={2} ingredient={cauldron?.ingredient_2} onDrop={handleIngredientDrop} />
      <IngredientSlot slot={3} ingredient={cauldron?.ingredient_3} onDrop={handleIngredientDrop} />
      <CookingProgress progress={cauldron?.cooking_progress} />
      <StartCookingButton cauldronId={cauldronId} />
    </div>
  );
}</code></pre>

    <h2>🎨 Visual Design</h2>

    <h3>Cauldron Aesthetics</h3>

    <p>The Field Cauldron's visual design reinforces its importance:</p>

    <ul>
      <li><strong>Traditional Shape</strong>: Cast-iron cauldron silhouette players recognize</li>
      <li><strong>Military Branding</strong>: "Cerametal Field Cauldron Mk. II" designation</li>
      <li><strong>Weathered Details</strong>: Rivets, scratches, and wear patterns</li>
      <li><strong>Animated Contents</strong>: Bubbling water, steam, visible ingredients</li>
      <li><strong>Folk Art Accents</strong>: Subtle decorative elements matching game aesthetic</li>
    </ul>

    <h3>Animation States</h3>

    <ul>
      <li><strong>Empty</strong>: Clean interior, no steam</li>
      <li><strong>Filled</strong>: Water level visible, gentle ripples</li>
      <li><strong>Cooking</strong>: Bubbling animation, rising steam</li>
      <li><strong>Complete</strong>: Glowing effect, ready indicator</li>
    </ul>

    <h2>🔮 Future Development</h2>

    <h3>Planned Features</h3>

    <ul>
      <li><strong>Advanced Recipes</strong>: Multi-stage preparations requiring specific sequences</li>
      <li><strong>Preservation</strong>: Create preserved foods with extended shelf life</li>
      <li><strong>Poison Crafting</strong>: Dangerous preparations for PvP applications</li>
      <li><strong>Fermentation</strong>: Time-delayed recipes that improve with age</li>
      <li><strong>Recipe Cards</strong>: Shareable items that teach other players discoveries</li>
      <li><strong>Cooking Skill System</strong>: Experience improves success rates and effects</li>
    </ul>

    <h3>Community Requests</h3>

    <p>Players have suggested features we're considering:</p>

    <ul>
      <li>Larger cauldrons for batch cooking</li>
      <li>Cauldron upgrades (faster cooking, better effects)</li>
      <li>Ingredient quality tiers affecting output</li>
      <li>Seasonal ingredients with unique properties</li>
      <li>Cooking minigames for bonus effects</li>
    </ul>

    <h2>🎓 Design Lessons</h2>

    <h3>What Worked</h3>

    <ul>
      <li><strong>AI Generation</strong>: Creates genuine discovery and experimentation</li>
      <li><strong>Environmental Integration</strong>: Weather interactions feel natural and strategic</li>
      <li><strong>Simplicity</strong>: Core mechanics are easy to understand, depth emerges from combinations</li>
      <li><strong>Player Agency</strong>: Freedom to experiment leads to creative strategies</li>
    </ul>

    <h3>What We'd Do Differently</h3>

    <ul>
      <li><strong>Earlier Implementation</strong>: Should have been in from day one</li>
      <li><strong>Better Tutorials</strong>: Players needed more guidance on basics</li>
      <li><strong>Recipe Persistence</strong>: Should save successful recipes automatically</li>
      <li><strong>More Feedback</strong>: Visual/audio cues for successful combinations</li>
    </ul>

    <h2>🎮 Experience the System</h2>

    <p>The Field Cauldron is best experienced firsthand. Join Broth & Bullets and discover your own recipes:</p>

    <ul>
      <li><strong>Play Now</strong>: <a href="https://brothbullets.com" target="_blank" rel="noopener noreferrer">brothbullets.com</a></li>
      <li><strong>Join Discord</strong>: <a href="https://discord.gg/tUcBzfAYfs" target="_blank" rel="noopener noreferrer">Share recipes and strategies</a></li>
      <li><strong>Follow Development</strong>: <a href="https://twitter.com/metalhorse233" target="_blank" rel="noopener noreferrer">@metalhorse233 on Twitter</a></li>
    </ul>

    <h2>🔗 Related Articles</h2>

    <ul>
      <li><a href="/blog/how-we-built-broth-bullets-multiplayer-survival-game">How We Built Broth & Bullets: A 2D Multiplayer Survival Game</a></li>
      <li><a href="/blog/field-cauldron-mechanics">The Field Cauldron: Brewing Innovation in Survival Gameplay</a></li>
      <li><a href="/blog/field-cauldron-ai-recipe-generation">AI-Powered Recipe Generation in Broth & Bullets</a></li>
    </ul>

    <p>Questions about the cooking system? Join our <a href="https://discord.gg/tUcBzfAYfs" target="_blank" rel="noopener noreferrer">Discord</a> and chat with the dev team!</p>
  `
};

