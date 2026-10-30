export default {
  slug: "broth-bullets-may-2026-update",
  title: "Faster First Steps: May 2026 Development Update",
  subtitle: "A cleaner path into the island, diegetic loading, sharper performance, and more tactile survival feedback",
  date: "2026-05-06",
  author: "Martin Erlic",
  authorImage: "/images/blog/author-marty.jpg",
  authorTwitter: "metalhorse233",
  excerpt: "The old login gate is gone, first-load assets now materialize through your ocular implant, and the client has picked up a round of rendering, caching, and particle polish.",
  coverImage: "/images/blog/may-2026-update-cover.png",
  content: `
    <p>It's been a while since the last development update, and the work since then has been less about one giant headline feature and more about making Broth & Bullets feel faster, stranger, and easier to get into. A survival game can have all the systems in the world, but if the first thirty seconds feel like paperwork, people bounce.</p>

    <p>So this update is about flow. We removed friction from the front door, moved more of the loading experience into the fiction of the world, and spent a lot of time on the unglamorous parts of performance that make the island feel better moment to moment.</p>

    <h2>👁️ No More Front-Door Login Screen</h2>

    <p>The old login screen was causing more pain than it was worth. I liked the presentation, and I still have a soft spot for the SOVA survival tips that used to sit there while you loaded in, but in practice it was getting between players and the game.</p>

    <p>Broth & Bullets is already a weird enough pitch: a top-down multiplayer survival game on a hostile Aleutian island, with ocular implants, Memory Shards, haunted logistics infrastructure, and cooking systems that keep mutating. The first interaction shouldn't be "please wait on a marketing screen." It should be "you are waking up in the world."</p>

    <p>So we cut the ceremony. The game now treats connection, registration, and first asset readiness as part of the boot sequence instead of a separate lobby moment. The goal is simple: less waiting, less second-guessing, and fewer places for authentication state to confuse players before they have even seen the tundra.</p>

    <h2>🧠 Diegetic Loading Through the Ocular Implant</h2>

    <p>The bigger change is how loading feels. Instead of blocking on a big static screen full of tips, the world can now reveal itself as your implant resolves the scene. Objects look like they're materializing through your ocular hardware over time: first the critical world, then more detailed props, icons, and effects as the cache warms up.</p>

    <p>This fits the fiction better. Your character already sees the world through SOVA and the hardlight map. If a tree, workstation, or item appears a fraction of a second after the ground does, that shouldn't feel like a browser failing to keep up. It should feel like the implant is acquiring a lock.</p>

    <p>The first visit still has to pull assets over the network, but repeat visits are much faster because the browser cache and our internal image caches are doing their job. Critical canvas assets get priority so gameplay can begin sooner, while less urgent item icons and secondary visuals warm in the background.</p>

    <h2>⚡ Performance Work You Can Feel</h2>

    <p>A lot of the recent work has been boring in exactly the right way. Less wasted sorting. Fewer React re-render cascades. More direct caches. Better spatial lookups. The kind of changes that don't read like features but make every feature less annoying.</p>

    <ul>
      <li><strong>Critical asset loading</strong> - The client now separates assets needed to render the game immediately from assets that can warm lazily after the world appears.</li>
      <li><strong>Particle refs instead of state churn</strong> - Furnace, barbecue, fire, and other particle systems can update through the frame loop without forcing React to re-render constantly.</li>
      <li><strong>Y-sort caching</strong> - Entity sorting has better invalidation rules, so buildings, walls, players, corpses, and props still layer correctly without re-sorting everything every frame.</li>
      <li><strong>Placement preview indexing</strong> - Building placement checks now lean on spatial indexes and short-lived caches instead of repeatedly walking large collections.</li>
      <li><strong>Viewport-aware filtering</strong> - The renderer keeps its attention on the part of the island you can actually see, with buffers large enough to avoid obvious pop-in.</li>
    </ul>

    <p>The aim isn't to hide the fact that Broth & Bullets is running a lot of systems at once. The aim is to make those systems feel like part of a living world instead of a pile of update loops competing for your frame time.</p>

    <h2>🔥 More Physical Feedback</h2>

    <p>Combat, crafting, and base defense have also picked up more visual feedback. This matters more than it sounds. In a top-down game, tiny effects carry a lot of the tactile information that 3D games get from camera shake, animation blending, and depth.</p>

    <ul>
      <li><strong>Barbecue and furnace particles</strong> - Cooking and smelting stations now have smoke, sparks, and heat cues that make a working base feel alive.</li>
      <li><strong>Structure impact sparks</strong> - Walls, doors, and shelters now show hit feedback when they take damage, especially useful during night attacks.</li>
      <li><strong>Hostile death effects</strong> - Apparitions and other hostile entities leave more readable death feedback instead of simply disappearing from the board.</li>
      <li><strong>Ward particles</strong> - Lantern variants like ancestral wards, signal disruptors, and memory beacons have more distinct active states.</li>
      <li><strong>Fire and projectile polish</strong> - Fire patches, torches, and fire arrows continue to get small visual improvements so danger reads faster.</li>
    </ul>

    <p>None of this changes the survival rules by itself, but it changes how legible those rules feel. If a furnace is burning, if a wall is getting hit, if a ward is active, if an apparition just broke apart - you should know immediately.</p>

    <h2>🏚️ Bases, Stations, and World Dressing</h2>

    <p>The world has also become denser since the ALK Central Compound post. The compound has more static building support, more collision-aware dressing, and a stronger eerie-light identity at night. The island's built spaces are becoming less like icons on a map and more like physical places you move through.</p>

    <p>On the player side, base rendering now has to handle more than tents and boxes. Foundations, walls, doors, fences, lanterns, turrets, hearths, furnaces, barbecues, stashes, and storage all need to sort correctly with players, animals, corpses, projectiles, and terrain features. A lot of recent performance work came from making that density possible without turning every camp into a frame-rate hazard.</p>

    <p>Environmental dressing has expanded too: fumaroles, basalt columns, sea stacks, living coral, road lampposts, monument parts, and ALK station pieces are all part of the visual language now. The island should feel geologically hostile, half-industrial, and only partially understood.</p>

    <h2>🛠️ Why This Update Matters</h2>

    <p>The funny thing about optimization is that it often sounds like retreat: cutting a login screen, loading fewer things up front, caching more aggressively, doing less work per frame. But for Broth & Bullets, this is what lets the stranger ideas breathe.</p>

    <p>If the world loads faster, then diegetic materialization feels intentional instead of broken. If particles don't thrash React, then furnaces, wards, fire arrows, and base attacks can be richer. If placement checks are cheaper, then base building can keep growing. If the front door is cleaner, then players are more likely to reach the systems we actually want feedback on.</p>

    <h2>🔜 Coming Next</h2>

    <p>The immediate focus is still the same: make the alpha easier to enter, easier to understand, and harder to put down once you're in.</p>

    <ul>
      <li><strong>More diegetic onboarding</strong> - Less menu explanation, more in-world SOVA guidance when it actually helps.</li>
      <li><strong>Continued render cleanup</strong> - More shared caches, fewer hot-path allocations, and tighter frame-loop ownership.</li>
      <li><strong>Base defense tuning</strong> - Better feedback around walls, doors, wards, hostile pressure, and nighttime threat readability.</li>
      <li><strong>Compound and monument polish</strong> - More places that feel authored without losing the procedural survival feel.</li>
      <li><strong>Loading polish</strong> - Smoother materialization, better cache behavior, and fewer moments where the browser shows through the fiction.</li>
    </ul>

    <h2>🎮 Play Broth & Bullets</h2>

    <p>If you tried the alpha before and bounced off the first-load flow, this is a good time to try again. The island should get out of its own way faster now.</p>

    <p><a href="/" class="cta-link">→ Play Broth & Bullets Alpha (Free)</a></p>

    <p><a href="https://discord.gg/tUcBzfAYfs" target="_blank" rel="noopener noreferrer" class="cta-link">→ Join the Discord Community</a></p>

    <p>As always, every bug report, performance note, and weird survival story helps. The tundra is still waiting - it just loads in a little more like it belongs to your implant now.</p>

    <h2>🔗 Related Articles</h2>

    <ul>
      <li><a href="/blog/alk-central-compound-admiralty-logistics-kernel">The ALK Central Compound</a> - The ghost logistics system at the heart of the island</li>
      <li><a href="/blog/broth-bullets-february-2026-update">The Living World: February 2026 Development Update</a> - Animals, predators, food systems, and monuments</li>
      <li><a href="/blog/diegetic-ui-design-sova">Diegetic UI and SOVA</a> - Why the interface belongs inside the fiction</li>
      <li><a href="/blog/minimap-spatial-subscriptions">The Hardlight Map</a> - Spatial awareness, performance, and SOVA's map overlay</li>
    </ul>
  `,
  tags: ["Development Update", "Broth & Bullets", "Performance", "Diegetic UI", "SOVA", "Loading", "Rendering", "Particles", "Survival Games", "Indie Game Development", "Alpha Testing"]
};
