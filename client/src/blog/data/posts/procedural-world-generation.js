export default {
  slug: "procedural-world-generation",
  title: "Building a Procedural Tundra",
  subtitle: "How we're generating a dynamic open world for babushka battles",
  date: "2025-03-28",
  author: "Martin Erlic",
  authorImage: "/images/blog/author-marty.jpg",
  authorTwitter: "seloslav",
  excerpt: "Creating a procedurally generated tundra environment presents unique challenges. In this post, we dive into our approach to world generation, biome diversity, and resource distribution.",
  coverImage: "/images/blog/procedural-world.jpg",
  content: `
    <p>When we first conceived Broth & Bullets, we knew the environment would be as much a character as the babushkas who inhabit it. The harsh tundra, with its unforgiving landscape, would need to feel both authentic and dynamic.</p>
    
    <h2>The Challenge of Procedural Generation</h2>
    
    <p>Procedural generation allows us to create vast, unique worlds for each gameplay session. However, it comes with challenges - particularly in creating landscapes that are both challenging and fair, varied yet consistent with our setting.</p>
    
    <p>Our approach uses a multi-layered noise algorithm that generates:</p>
    
    <ul>
      <li>Biome distribution (harsh tundra, sparse forests, frozen lakes)</li>
      <li>Resource node placement with weighted distribution</li>
      <li>Points of interest and potential base-building locations</li>
      <li>Geothermal feature placement creating strategic hotspots</li>
    </ul>
    
    <h2>Biome Diversity in a Tundra Setting</h2>
    
    <p>While "tundra" might evoke images of a monotonous frozen wasteland, we've worked to create diverse sub-biomes within our world:</p>
    
    <ol>
      <li><strong>Permafrost Plains</strong> - Open spaces with scattered resources, perfect for large-scale battles</li>
      <li><strong>Taiga Outskirts</strong> - Sparse woodlands providing cover and valuable lumber</li>
      <li><strong>Frozen Lakes</strong> - Dangerous but fast travel routes with unique fishing opportunities</li>
      <li><strong>Rocky Outcrops</strong> - Elevated positions offering defensive advantages and mining resources</li>
      <li><strong>Volcanic Regions</strong> - Dangerous but resource-rich areas with unique materials</li>
      <li><strong>Geothermal Zones</strong> - Strategic hotspots with survival advantages and rare resources</li>
    </ol>
    
    <h2>Resource Distribution</h2>
    
    <p>A key element of survival gameplay is resource gathering. Our algorithm ensures resources are:</p>
    
    <ul>
      <li>Distributed in a way that encourages exploration</li>
      <li>Placed logically (berries near forests, ore near mountains)</li>
      <li>Balanced to prevent "resource islands" that give unfair advantages</li>
      <li>Regenerating over time with realistic constraints</li>
    </ul>
    
    <h2>Geothermal Features</h2>
    
    <p>One of the most distinctive aspects of our tundra environment is the range of geothermal features inspired by Kamchatka's volcanic landscape:</p>
    
    <h3>Hot Springs</h3>
    
    <p>Our world features mineral-rich hot springs that provide healing benefits to players who brave their waters. These beautiful blue-green pools can restore health over time, but they come with risks:</p>
    
    <ul>
      <li>Steam reduces visibility, making you vulnerable to ambush</li>
      <li>The valuable healing properties make them contested territories</li>
      <li>Extended exposure can cause overheating effects</li>
    </ul>
    
    <h3>Fumaroles & Geothermal Vents</h3>
    
    <p>These steam vents scattered across the landscape aren't just for show - they're crucial survival elements:</p>
    
    <ul>
      <li>Can be used to heat your body in the bitter cold, preventing hypothermia</li>
      <li>Field cauldrons placed near vents can be used to create rare, powerful soups and broths</li>
      <li>The unique minerals around vents are ingredients for high-tier recipes</li>
      <li>These areas become strategic hotspots, fiercely contested by players seeking warmth and crafting advantages</li>
    </ul>
    
    <h3>Other Volcanic Features</h3>
    
    <p>The landscape is dotted with other unique elements that affect gameplay:</p>
    
    <ul>
      <li><strong>Silica Sinter</strong> - Mineral deposits with natural healing properties</li>
      <li><strong>Mud Volcanoes</strong> - Slow movement but provide slow healing effects</li>
      <li><strong>Sulfur Fields</strong> - Source of valuable crafting materials with movement penalties</li>
      <li><strong>Active Geysers</strong> - Periodic eruptions create danger and opportunity</li>
      <li><strong>Volcanic Ash Plains</strong> - Reduced visibility but rich in specific resources</li>
    </ul>
    
    <p>Players will need to weigh the strategic value of controlling these areas against the risks of conflict they attract. A babushka able to secure a geothermal vent gains significant advantages in cooking and survival, but will need to defend it against others seeking the same benefits.</p>
    
    <p>In our next development update, we'll dive deeper into how these procedural systems interact with player-built structures and the persistent elements of our world.</p>
  `,
  tags: ["Development", "World Generation", "Game Design", "Technical", "Terrain Features"]
}; 