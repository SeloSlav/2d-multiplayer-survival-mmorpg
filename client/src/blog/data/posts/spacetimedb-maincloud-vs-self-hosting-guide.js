export default {
  slug: "spacetimedb-maincloud-vs-self-hosting-guide",
  title: "SpacetimeDB Maincloud vs Self-Hosting: Complete Guide for Multiplayer Game Developers",
  subtitle: "Why Maincloud makes sense, how its optimization insights helped us, and when self-hosting might be right for you",
  date: "2026-02-15",
  author: "Martin Erlic",
  authorImage: "/images/blog/author-marty.jpg",
  authorTwitter: "metalhorse233",
  excerpt: "We're based in the EU and use SpacetimeDB Maincloud in the US — it doesn't have an EU region yet. Maincloud's dashboard and energy metering are giving us invaluable insights into reducer and transaction costs, helping us optimize our server code. Here's our complete guide.",
  coverImage: "/images/blog/broth-bullets-spacetimedb-cover.jpg",
  content: `
    <p>When building Broth & Bullets, we faced a choice every SpacetimeDB developer eventually confronts: deploy to <a href="https://spacetimedb.com/maincloud" target="_blank" rel="noopener noreferrer">SpacetimeDB Maincloud</a> — the fully managed, serverless platform — or run the open-source SpacetimeDB Standalone on our own infrastructure. We're based in the EU, and Maincloud doesn't currently offer a European region, so we may consider self-hosting there in the future. For now, we're on Maincloud in the US — and its dashboard and energy metering have been invaluable for optimizing our server code. In this guide, we'll cover why Maincloud makes sense for many teams, its standout features, how open-source hosting works, and how Maincloud's optimization insights are helping us build a leaner, faster game.</p>

    <h2>Why SpacetimeDB Maincloud Makes Sense</h2>

    <p>Maincloud is SpacetimeDB's fully managed, serverless platform. No maintenance, automatic scaling, and you pay only for what you use. For teams that want to focus on game logic instead of infrastructure, it's a compelling option.</p>

    <h3>Key Maincloud Features</h3>

    <ul>
      <li><strong>One-command deployment</strong> — <code>spacetime publish</code> and you're live. No Docker, no VPS setup, no reverse proxy configuration.</li>
      <li><strong>Scale-to-zero</strong> — If traffic dips, your costs dip too. No idle servers burning money.</li>
      <li><strong>Real-time dashboard</strong> — Track performance, energy usage, and even call reducers directly from an admin UI.</li>
      <li><strong>Energy-based pricing</strong> — Granular metering (bytes scanned, bytes written, WASM instructions, etc.) gives you exact visibility into what drives cost.</li>
      <li><strong>All-in-one architecture</strong> — Transactional storage, server-side compute, and real-time networking in a single platform.</li>
      <li><strong>Security built-in</strong> — Rust, WASM sandbox, TLS, OIDC auth. Multi-tenant by design.</li>
    </ul>

    <p>For a small team shipping a multiplayer game, Maincloud removes a huge class of operational headaches. You don't think about backups, scaling, or monitoring — you think about gameplay.</p>

    <h2>Maincloud's Optimization Insights: Reducers and Transactions</h2>

    <p>Here's where Maincloud really helps us: <strong>its energy metering and dashboard give us exact visibility into what drives cost — and that taught us how to write cheaper, faster reducers.</strong></p>

    <p>Maincloud bills by energy (eV/TeV) — a consolidated metric that includes:</p>

    <ul>
      <li>Bytes scanned and written</li>
      <li>Index seek operations</li>
      <li>WASM instructions executed</li>
      <li>Bytes sent to clients</li>
      <li>Storage and row counts over time</li>
    </ul>

    <p>When you're optimizing for cost on Maincloud, you're effectively optimizing for performance everywhere. The tips we picked up from their docs and dashboard:</p>

    <h3>1. Use Indexes, Not Full Table Scans</h3>

    <p>Use <code>filter()</code> on indexed columns and <code>find()</code> on primary/unique keys instead of <code>iter()</code> over entire tables. Fewer bytes scanned = cheaper and faster.</p>

    <h3>2. Batch Operations When Possible</h3>

    <p>One reducer that does five updates is cheaper than five reducers that each do one update. Fewer transactions, fewer round-trips, less overhead.</p>

    <h3>3. Avoid Expensive Reducers in Hot Paths</h3>

    <p>Player movement fires constantly. We moved validation and side effects out of the hottest reducers and used scheduled reducers for background work where appropriate.</p>

    <h3>4. Optimize Subscriptions</h3>

    <p>Spatial chunk-based subscriptions (which we use in Broth & Bullets) drastically reduce bytes sent to clients. Maincloud's metering made it obvious how much we saved.</p>

    <p>Applying these patterns has improved our server performance and kept our Maincloud costs low. The feedback loop is immediate: you see what's expensive, you optimize, and the bill reflects it.</p>

    <h2>Open Source Self-Hosting: SpacetimeDB Standalone</h2>

    <p>SpacetimeDB is <a href="https://github.com/clockworklabs/SpacetimeDB" target="_blank" rel="noopener noreferrer">open source</a>. You can run SpacetimeDB Standalone on your own infrastructure — a VPS, a bare-metal server, or a cloud VM in any region you choose.</p>

    <h3>When Self-Hosting Makes Sense</h3>

    <p>We're based in the EU. Maincloud doesn't currently offer an EU region, so we may consider self-hosting there in the future. If you need a specific region or data residency, Self-Hosting SpacetimeDB Standalone gives you:</p>

    <ul>
      <li><strong>Lower latency</strong> for players in your chosen region</li>
      <li><strong>Data residency</strong> (e.g. EU for GDPR and player trust)</li>
      <li><strong>Predictable costs</strong> — a fixed monthly VPS bill instead of variable energy usage</li>
      <li><strong>Full control</strong> over configuration, backups, and scaling</li>
    </ul>

    <h3>What Self-Hosting Involves</h3>

    <p>SpacetimeDB provides <a href="https://spacetimedb.com/docs/deploying/spacetimedb-standalone" target="_blank" rel="noopener noreferrer">documentation for self-hosting</a> on Ubuntu. The setup typically includes:</p>

    <ul>
      <li>Installing the SpacetimeDB binary (via a shell script or package)</li>
      <li>Configuring a systemd service for automatic startup</li>
      <li>Setting up a reverse proxy (e.g. Nginx) with HTTPS (Let's Encrypt)</li>
      <li>Publishing your module with <code>spacetime publish --host &lt;your-server&gt;</code></li>
    </ul>

    <p>For local development, <code>spacetime start</code> runs everything on localhost. The same module runs identically on Maincloud or Standalone — no code changes required.</p>

    <h2>Maincloud vs Self-Hosting: When to Choose What</h2>

    <table class="comparison-table">
      <thead>
        <tr>
          <th>Factor</th>
          <th>Maincloud</th>
          <th>Self-Hosted (Standalone)</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><strong>Setup time</strong></td>
          <td>Minutes</td>
          <td>Hours (VPS + proxy + SSL)</td>
        </tr>
        <tr>
          <td><strong>Maintenance</strong></td>
          <td>Zero — fully managed</td>
          <td>You handle updates, backups, monitoring</td>
        </tr>
        <tr>
          <td><strong>Scaling</strong></td>
          <td>Automatic, scale-to-zero</td>
          <td>Manual — resize VPS or add nodes</td>
        </tr>
        <tr>
          <td><strong>Cost model</strong></td>
          <td>Pay per energy (usage-based)</td>
          <td>Fixed VPS cost</td>
        </tr>
        <tr>
          <td><strong>Regions</strong></td>
          <td>US (no EU yet)</td>
          <td>Any region you choose</td>
        </tr>
        <tr>
          <td><strong>Dashboard & metrics</strong></td>
          <td>Built-in real-time dashboard</td>
          <td>Use <code>spacetime logs</code>, SQL, or your own tooling</td>
        </tr>
      </tbody>
    </table>

    <p><strong>Choose Maincloud if:</strong> You want zero ops, don't need EU latency/residency, and prefer usage-based pricing. Great for prototypes and teams that want to ship fast.</p>

    <p><strong>Choose self-hosting if:</strong> You need EU (or another specific region), want fixed costs, or need full control over infrastructure. Requires some DevOps comfort.</p>

    <h2>How Maincloud's Insights Are Helping Us Optimize</h2>

    <p>Broth & Bullets runs on Maincloud in the US. The dashboard and energy breakdown are eye-opening. We see which reducers burn the most energy, which tables were scanned heavily, and how subscription patterns affect egress — in real time.</p>

    <p>That feedback loop has led us to:</p>

    <ul>
      <li>Add indexes on frequently filtered columns</li>
      <li>Consolidate movement updates to reduce transaction count</li>
      <li>Refactor hot-path reducers to avoid unnecessary table scans</li>
      <li>Tighten spatial subscription queries to reduce bytes sent to clients</li>
    </ul>

    <p>Our server code is leaner and more efficient because Maincloud makes the cost of inefficiency visible. Even if you're considering self-hosting, running on Maincloud for a while can teach you a lot about optimization — and the same patterns apply everywhere.</p>

    <h2>Looking Ahead: EU Region and Our Plans</h2>

    <p>We're happy on Maincloud for now. The managed experience, dashboard, and scale-to-zero simplify our ops significantly. We're watching for an EU region — when it arrives, we'll evaluate staying on Maincloud. If we need EU latency or data residency sooner, we may self-host in the EU. Either way, the optimization habits we've learned from Maincloud's insights will continue to pay off.</p>

    <h2>Resources</h2>

    <ul>
      <li><a href="https://spacetimedb.com/maincloud" target="_blank" rel="noopener noreferrer">SpacetimeDB Maincloud</a> — Managed platform and pricing</li>
      <li><a href="https://spacetimedb.com/docs/deploying/spacetimedb-standalone" target="_blank" rel="noopener noreferrer">Self-Hosting SpacetimeDB</a> — Standalone deployment guide</li>
      <li><a href="https://spacetimedb.com/docs" target="_blank" rel="noopener noreferrer">SpacetimeDB Documentation</a> — Reducers, tables, subscriptions</li>
      <li><a href="/blog/broth-bullets-spacetimedb-architecture">Why Broth & Bullets Uses SpacetimeDB</a> — Our architecture deep dive</li>
    </ul>

    <h2>Related Articles</h2>

    <ul>
      <li><a href="/blog/broth-bullets-spacetimedb-architecture">Why Broth & Bullets Uses SpacetimeDB Instead of Traditional Game Servers</a></li>
      <li><a href="/blog/spacetimedb-vs-firebase-comparison">SpacetimeDB vs Firebase: Complete Comparison for Game Developers</a></li>
      <li><a href="/blog/spatial-subscriptions-multiplayer-games">Spatial Subscriptions for Multiplayer Games</a></li>
      <li><a href="/blog/how-we-built-broth-bullets-multiplayer-survival-game">How We Built Broth & Bullets</a></li>
    </ul>

    <p>Questions about Maincloud vs self-hosting? Join our <a href="https://discord.gg/tUcBzfAYfs" target="_blank" rel="noopener noreferrer">Discord</a> — we're happy to share our setup and optimization tips.</p>
  `,
  tags: [
    "SpacetimeDB",
    "Maincloud",
    "Self-Hosting",
    "Open Source",
    "Multiplayer",
    "Game Development",
    "EU",
    "Data Residency",
    "Optimization",
    "Broth & Bullets",
    "Reducers",
    "Performance"
  ]
};
