![Vibe Coding Starter Pack Banner](./github.png)

# Vibe Coding Starter Pack: 2D Multiplayer Survival 

![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)
![React](https://img.shields.io/badge/React-19-blue.svg)
![Vite](https://img.shields.io/badge/Vite-6-purple.svg)
![SpacetimeDB](https://img.shields.io/badge/SpacetimeDB-latest-orange.svg)

A lightweight 2D multiplayer survival game starter kit built with modern web technologies. Create interactive survival experiences with persistent player state, real-time multiplayer synchronization, and modular game logic.

![Gameplay Preview](preview.png)

## Table of Contents

*   [⚡ Quick Local Setup](#️-quick-local-setup)
*   [🗺️ Roadmap](#️-roadmap)
*   [🛠️ Tech Stack](#️-tech-stack)
*   [🔐 Authentication Setup](#-authentication-setup)
*   [📜 Cursor Rules & Code Maintainability](#-cursor-rules--code-maintainability)
*   [⚙️ Client Configuration](#️-client-configuration)
*   [🤖 SOVA AI Assistant Configuration](#-sova-ai-assistant-configuration)
*   [🌍 World Configuration](#-world-configuration-tile-size--map-dimensions)
*   [📁 Project Structure](#-project-structure)
*   [🔧 Troubleshooting Local Setup](#-troubleshooting-local-setup)
*   [🔄 Development Workflow](#-development-workflow)
*   [🚀 Deployment Scripts](#-deployment-scripts)
*   [🎨 Art Generation Prompts](#-art-generation-prompts)
*   [🤝 Contributing](#-contributing)
*   [📜 License](#-license)

## ⚡ Quick Local Setup

For experienced users familiar with Node.js, Rust, and SpacetimeDB. See detailed sections below for troubleshooting or authentication specifics.

**0. Install SpacetimeDB CLI:**
Follow the instructions for your OS: [https://spacetimedb.com/install](https://spacetimedb.com/install)
(e.g., `curl -sSf https://install.spacetimedb.com | sh` on macOS/Linux)

**1. Clone & Install Dependencies:**
```bash
git clone https://github.com/SeloSlav/vibe-coding-starter-pack-2d-multiplayer-survival.git
cd vibe-coding-starter-pack-2d-multiplayer-survival
npm install
```

**2. Generate Auth Keys:**
```bash
# Ensure OpenSSL is installed (https://www.openssl.org/source/)
mkdir keys
openssl genpkey -algorithm RSA -out keys/private.pem -pkeyopt rsa_keygen_bits:2048
openssl rsa -pubout -in keys/private.pem -out keys/public.pem
```

**3. Start All Services (3 Terminals):**

**Terminal 1 - Auth Server:**
```bash
cd auth-server-openauth/
npm install
npm run dev
# Auth Server running on http://localhost:4001
```

**Terminal 2 - SpacetimeDB Server:**
```bash
cd server/
spacetime start
# SpacetimeDB Server running on http://localhost:3000
```

**Terminal 3 - Client:**
```bash
npm run dev
# Client running on http://localhost:3008 (or similar)
```

**4. Deploy Database (First Time Setup):**
```bash
# In server/ directory - choose one:
./deploy-local-clean.ps1     # Windows - Fresh database
./deploy-local.ps1           # Windows - Update existing database
# Or manually:
spacetime publish broth-bullets-local
spacetime generate --lang typescript --out-dir ../client/src/generated --project-path .
```

*   **For Multiplayer Testing:** Open a **new terminal** and run `npm run dev` again. The second client will open on a different port. Open this URL in a separate browser tab.

**Updating Server Code:**
*   **Quick Updates:** Use deployment scripts in `server/` directory:
    ```bash
    cd server/
    ./deploy-local.ps1           # Update local database
    ./deploy-local-clean.ps1     # Fresh local database (wipes data)
    ./deploy-production.ps1      # Update production database
    ./deploy-production-clean.ps1 # Fresh production database (wipes data)
    ```
*   **Manual Deployment:**
    ```bash
    cd server/
    spacetime publish broth-bullets-local  # Local
    # OR
    spacetime publish --server maincloud broth-bullets  # Production
    spacetime generate --lang typescript --out-dir ../client/src/generated --project-path .
    ```

## 🗺️ Roadmap

**Completed (✅):**
*   🌐 Real-time Multiplayer: Basic player movement synchronization
*   🌓 Environment Systems: Day/night cycle, Full moon nights, Rain system that affects gameplay and atmosphere
*   🪓 Survival Mechanics: Basic resource harvesting
*   🌱 Resource Respawning: Trees, Stones, Plants
*   ❤️ Survival Systems: Health, Hunger, Thirst, Warmth, Death/Respawn
*   🗺️ World Discovery: Minimap
*   🎮 Hotbar: Item selection, weapon cooldown indicators
*   🎒 Inventory Management: Moving, swapping, stacking, stack splitting
*   ⚔️ Armor: Defense bonuses, warmth protection
*   🔥 Placeables: Campfire (Multi-slot placement & interaction)
*   🛠️ Crafting System: Item recipes
*   📦 Storage Containers (Chests)
*   💰 Looting Mechanics (Containers)
*   🔐 Authentication/Account System
*   🍳 Cooking System: Food preparation using campfire with raw, cooked and burnt states
*   ⚔️ Combat System: Multiple weapon types (melee, thrown, ranged), improved hit detection, PvP balancing
*   🏹 Ranged Weapons & Ammunition: Bow combat with different arrow types (stone, iron, fire arrows), arrow cycling system
*   🩸 Active Effects System: Bleed damage, burn damage, and other status effects
*   💀 Player Corpses: Harvestable corpses that yield primitive resources when players die
*   😵 Knock Out System: Combat state with temporary incapacitation and a chance to spontaneously recover
*   🏠 Player Shelter: Personal shelter system where only the owner can enter and keep their campfire safe from the rain
*   🛏️ Sleeping Bags: Placeable respawn points that persist between deaths

**Planned (📋):** 
*   **Core Systems & World:**
    *   🌍 World Generation: Procedural generation, biomes, monuments
    *   🎨 Terrain Autotiling: Edge detection, Wang tiles, seamless transitions between biomes
    *   🤖 Advanced AI: Hostile NPCs behaviors, pathfinding
    *   👥 Team/Social Features: Shared map markers, team chat, private messaging, player notes, and group formation
*   **Gameplay Loops & Interaction:**
    *   🏗️ Construction System: Base building (walls, floors, etc.)
    *   🌱 Farming System: Planting, growing, harvesting crops
    *   🦌 Hunting System: NPC animals (deer, wolves, etc.), tracking, hunting mechanics
*   **Combat & Items:**
    *   ⚔️ Tool/Weapon Durability
    *   🔫 Firearm System: Guns with ammo types, reloading mechanics, and recoil

> **Note:** I'm currently spending most of my time working on a personal fork of this project, focusing on optimizing existing systems and refactoring for better performance. If you're interested in contributing to the main project, the planned features listed above would be fantastic starting points! I'd love to see what the community builds with this foundation. 🎮

*   🛒 **Selo Olive Oil Discount:** Use code `VIBE15` for 15% off at [seloolive.com/discount/VIBE15](https://seloolive.com/discount/VIBE15)


## 🛠️ Tech Stack

| Layer       | Technologies                |
|-------------|----------------------------|
| Frontend    | React 19, Vite 6, TypeScript |
| Multiplayer | SpacetimeDB                |
| Backend     | Rust (WebAssembly)         |
| Development | Node.js 22+                |

## 🔐 Authentication Setup

This project implements user authentication using a custom Node.js authentication server built with OpenAuthJS and Hono, bridged to SpacetimeDB via standard OpenID Connect (OIDC) JWTs.

**Approach:**

1.  **Client:** Initiates an OIDC Authorization Code Flow with PKCE, manually constructing the `/authorize` URL for the custom auth server and specifying `acr_values=pwd` to request the password flow.
2.  **Auth Server (`auth-server-openauth/`):** A Node.js/Hono server that:
    *   Intercepts the `/authorize` request.
    *   If `acr_values=pwd`, redirects the user to custom HTML login/registration forms, forwarding OIDC parameters (`client_id`, `redirect_uri`, `state`, `code_challenge`, etc.).
    *   Handles POST submissions from these forms, verifying user credentials against a local user store (`data/users.json`).
    *   On successful login/registration, generates a one-time authorization `code` and stores it along with the user ID and PKCE challenge.
    *   Redirects the user back to the client's specified `redirect_uri` with the `code` and `state`.
3.  **Client:** Receives the redirect at its `/callback` URI, extracts the `code`.
4.  **Client:** Makes a `fetch` POST request to the auth server's custom `/token` endpoint, sending the `code`, PKCE `code_verifier`, `client_id`, and `redirect_uri`.
5.  **Auth Server (`/token`):**
    *   Receives the code exchange request.
    *   Looks up the code, retrieves the associated user ID and PKCE challenge.
    *   Verifies the `code_verifier` against the stored `code_challenge`.
    *   If valid, mints a new JWT `id_token` and `access_token`, signed using a **private RSA key** (RS256 algorithm).
    *   Returns the tokens to the client.
6.  **Client:** Receives the tokens, stores the `id_token` (used as the `spacetimeToken`).
7.  **Client:** Connects to the main SpacetimeDB game server (`server/`) using the `id_token`.
8.  **SpacetimeDB Server (`server/`):**
    *   Configured with the `issuer` URL of the auth server.
    *   Fetches the OIDC discovery document (`/.well-known/openid-configuration`) and then the public keys (`/.well-known/jwks.json`) from the auth server.
    *   Verifies the `id_token`'s signature using the fetched public key and validates the `iss` (issuer) and `aud` (audience) claims.
    *   Grants the connection access based on the identity (`sub` claim) in the validated token.

This approach uses standard OIDC practices with asymmetric key signing (RS256), allowing SpacetimeDB to securely verify tokens without needing a shared secret.

### Running Authentication Locally

To get authentication working during local development, follow these steps:

1.  **Generate RSA Keys:** You need an RSA key pair for signing and verifying tokens. Use OpenSSL:
    *   Open a terminal in the **project root** directory.
    *   Run the following commands:
        ```bash
        # Create a directory for keys if it doesn't exist
        mkdir keys
        # Generate a 2048-bit RSA private key
        openssl genpkey -algorithm RSA -out keys/private.pem -pkeyopt rsa_keygen_bits:2048
        # Extract the public key from the private key
        openssl rsa -pubout -in keys/private.pem -out keys/public.pem
        ```
    *   This creates `keys/private.pem` (keep secret, used by auth server) and `keys/public.pem` (used for verification).
    *   **Important:** The `.gitignore` file is configured to prevent these keys from being committed to Git.

2.  **Configure Auth Server (`auth-server-openauth/`):**
    *   No `.env` file is strictly required for basic local operation, as defaults are set in `index.ts`.
    *   The server automatically loads `keys/private.pem` and `keys/public.pem` for signing tokens and serving the JWKS endpoint.
    *   It manages user data in `data/users.json` (which will be created automatically if it doesn't exist). The `.gitignore` also prevents this file from being committed.

3.  **Run Auth Server:**
    *   Open a terminal in the `auth-server-openauth/` directory.
    *   Run `npm install` if you haven't already.
    *   Run `npm start`.
    *   Keep this terminal running. You should see `🚀 Auth server → http://localhost:4001`. Logs for authentication steps will appear here.

4.  **Configure SpacetimeDB Server (`server/data/config.toml`):**
    *   Ensure the `server/data/config.toml` file has the following `[auth]` configuration to trust your auth server:
        ```toml
        [auth]
        [[identity_provider]]
        type     = "oidc"
        issuer   = "http://localhost:4001"       # URL of our OpenAuth server
        jwks_uri = "http://localhost:4001/.well-known/jwks.json" # Explicitly point to the JWKS endpoint
        audience = "vibe-survival-game-client" # Must match 'aud' claim in tokens
        ```

5.  **Run Main SpacetimeDB Server (`server/`):**
    *   Open a **separate terminal**.
    *   Run `spacetime start`.
    *   Keep this terminal running.

6.  **Client Configuration:** No changes are needed in the client code. `AuthContext.tsx` is configured to use the auth server at `http://localhost:4001`.

7.  **Run Client:**
    *   Open a terminal in the project **root** directory.
    *   Run `npm run dev`.

Now, when you sign in via the client's login screen, the full authentication flow using your custom OpenAuthJS server and RS256 keys should execute.

### Production Deployment

*   **Auth Server:** Deploy the `auth-server-openauth` Node.js application to a hosting provider. Ensure the `keys/private.pem` and `keys/public.pem` files are securely deployed alongside the application (or manage keys via environment variables/secrets management if your host supports it). Ensure it's served over HTTPS.
*   **Client:** Update `AUTH_SERVER_URL` in `client/src/contexts/AuthContext.tsx` to point to your *deployed* auth server URL (using HTTPS).
*   **SpacetimeDB:** Configure your SpacetimeDB Maincloud/Enterprise instance with the *production* `issuer` and `jwks_uri` of your deployed auth server, and the correct `audience`.

### Limitations & Future Improvements

*   **Basic Forms:** The login/register forms served by the auth server are very basic HTML. They could be enhanced or replaced with a proper frontend framework if desired.
*   **Error Handling:** Error handling in the manual auth routes could be more user-friendly.
*   **No Refresh Token Handling:** This setup doesn't implement refresh tokens. If the `id_token` expires, the user would need to log in again.

## 📜 Cursor Rules & Code Maintainability

### Cursor Rules (`.cursor/rules/`)

This project utilizes [Cursor](https://cursor.sh/)'s AI features, including **Rules**, to aid development. Rules are markdown files (`.mdc`) that provide context and guidelines to the AI assistant.
*   `guide.mdc`: Contains general architectural guidelines, technology choices, and development workflow information.
*   `resources.mdc`: Outlines the specific steps for adding new resources or gatherable nodes consistently.

As the project grows, more specific rules will be added for core features (e.g., crafting, building, combat) to ensure the AI can provide consistent and relevant assistance.

### Code Maintainability

While the project is still evolving, a key goal is maintainability. As features are added, we aim to:
*   Keep individual file sizes manageable (ideally under ~600 lines where practical).
*   Refactor logic into reusable helper functions and potentially dedicated modules (like the planned `inventory_logic.rs`).
*   Utilize abstraction to avoid code duplication, especially for common interactions like container management.

## ⚙️ Client Configuration

### SpacetimeDB Connection (`client/src/App.tsx`)

To connect the client to your SpacetimeDB instance, configure the following constants near the top of `client/src/App.tsx`:

```typescript
const SPACETIME_DB_ADDRESS = 'ws://localhost:3000';
const SPACETIME_DB_NAME = 'vibe-survival-game';
```

*   **For Local Development:** Use the default values (`ws://localhost:3000` and your module name).
*   **For Maincloud Deployment:** Replace `SPACETIME_DB_ADDRESS` with your Maincloud WebSocket URI (e.g., `wss://maincloud.spacetimedb.net`) and `SPACETIME_DB_NAME` with your Maincloud database name (e.g., `your-identity/your-database-name`).

## 🤖 SOVA AI Assistant Configuration

This project includes SOVA (Sentient Ocular Virtual Assistant), an intelligent AI assistant with voice synthesis capabilities. SOVA provides tactical advice, game tips, and responds with a military-themed personality.

### Quick Setup

1. **AI Personality (OpenAI API):**
   ```bash
   # Create client/.env file
   echo "OPENAI_API_KEY=sk-your-openai-api-key-here" > client/.env
   ```

2. **Voice Synthesis (ElevenLabs API - Optional):**
   ```bash
   # Add to client/.env file
   echo "ELEVENLABS_API_KEY=your-elevenlabs-api-key-here" >> client/.env
   ```

### Features
- 🎤 **Voice Synthesis:** High-quality voice responses using ElevenLabs API
- 🎙️ **Voice Commands:** Hold V key for speech-to-text input (OpenAI Whisper)
- 🧠 **AI Personality:** Intelligent responses powered by OpenAI GPT-4o
- 🎯 **Game Knowledge:** Contextual survival tips and tactical advice
- 🎪 **Easter Eggs:** Special responses (try asking "What does SOVA stand for?")
- 🔄 **Fallback System:** Works without API keys using predefined responses

### Voice Interface
- **Push-to-Talk:** Hold **V** key to activate voice recording
- **Cyberpunk UI:** Animated recording interface with status indicators
- **Speech-to-Text:** OpenAI Whisper converts speech to text
- **Chat Integration:** Voice messages appear in chat like typed messages
- **AI Response:** SOVA responds intelligently with voice synthesis

### Documentation
- **[ENVIRONMENT_SETUP.md](./ENVIRONMENT_SETUP.md)** - Complete environment variable guide
- **[OPENAI_SETUP.md](./OPENAI_SETUP.md)** - AI personality configuration

## 🌍 World Configuration (Tile Size & Map Dimensions)

Changing the tile size, chunk configuration, or overall world dimensions requires coordinated modifications in **both** the client and server code to ensure consistency between rendering, collision detection, game logic, and world generation.

### Core Configuration Values

#### 1. **Client Configuration (`client/src/config/gameConfig.ts`):**

**Tile & World Size:**
*   `TILE_SIZE`: Visual pixel size of each grid tile (e.g., `48`). Must match server's `TILE_SIZE_PX`.
*   `SERVER_WORLD_WIDTH_TILES`: Assumed width of the server's world in tiles (e.g., `500`). Must match server's `WORLD_WIDTH_TILES`.
*   `SERVER_WORLD_HEIGHT_TILES`: Assumed height of the server's world in tiles (e.g., `500`). Must match server's `WORLD_HEIGHT_TILES`.

**Chunk Configuration:**
*   `CHUNK_SIZE_TILES`: Number of tiles along one edge of a square chunk (e.g., `10`). Must match server's `CHUNK_SIZE_TILES`.

**Legacy/Compatibility Values:**
*   `worldWidth` and `worldHeight`: Should match `SERVER_WORLD_WIDTH_TILES` and `SERVER_WORLD_HEIGHT_TILES`.
*   `spriteWidth` and `spriteHeight`: Player/entity sprite dimensions, typically match `TILE_SIZE`.

#### 2. **Server Configuration (`server/src/lib.rs`):**

**Primary Constants:**
*   `TILE_SIZE_PX`: Size of each tile in pixels (e.g., `pub const TILE_SIZE_PX: u32 = 48;`).
*   `WORLD_WIDTH_TILES`: World width in tiles (e.g., `pub const WORLD_WIDTH_TILES: u32 = 500;`).
*   `WORLD_HEIGHT_TILES`: World height in tiles (e.g., `pub const WORLD_HEIGHT_TILES: u32 = 500;`).

**Derived Values (automatically calculated):**
*   `WORLD_WIDTH_PX`: World width in pixels (`(WORLD_WIDTH_TILES * TILE_SIZE_PX) as f32`).
*   `WORLD_HEIGHT_PX`: World height in pixels (`(WORLD_HEIGHT_TILES * TILE_SIZE_PX) as f32`).

#### 3. **Server Environment Configuration (`server/src/environment.rs`):**

**Chunk System:**
*   `CHUNK_SIZE_TILES`: Size of a chunk in tiles (e.g., `pub const CHUNK_SIZE_TILES: u32 = 10;`). Must match client.
*   `WORLD_WIDTH_CHUNKS`: Number of chunks across world width (auto-calculated).
*   `CHUNK_SIZE_PX`: Size of a chunk in pixels (auto-calculated).

#### 4. **World Generation Configuration (`server/src/world_generation.rs`):**

The `WorldGenConfig` struct controls procedural world generation:
*   `world_width_tiles`: Should match `WORLD_WIDTH_TILES` in `lib.rs`.
*   `world_height_tiles`: Should match `WORLD_HEIGHT_TILES` in `lib.rs`.
*   `chunk_size`: Should match `CHUNK_SIZE_TILES` in `environment.rs`.
*   Other generation parameters: `seed`, `island_border_width`, `beach_width`, `river_frequency`, etc.

### Recommended Configuration Steps

**When changing world dimensions or tile size:**

1.  **Update Server Core (`server/src/lib.rs`):**
    ```rust
    pub const TILE_SIZE_PX: u32 = 48;        // Your desired tile size
    pub const WORLD_WIDTH_TILES: u32 = 500;   // Your desired world width
    pub const WORLD_HEIGHT_TILES: u32 = 500;  // Your desired world height
    ```

2.  **Update Server Environment (`server/src/environment.rs`):**
    ```rust
    pub const CHUNK_SIZE_TILES: u32 = 10;     // Your desired chunk size
    ```

3.  **Update World Generation Config (in `init_module` or world generation):**
    ```rust
    WorldGenConfig {
        world_width_tiles: 500,    // Match WORLD_WIDTH_TILES
        world_height_tiles: 500,   // Match WORLD_HEIGHT_TILES  
        chunk_size: 10,           // Match CHUNK_SIZE_TILES
        // ... other generation settings
    }
    ```

4.  **Update Client Config (`client/src/config/gameConfig.ts`):**
    ```typescript
    const TILE_SIZE = 48;                      // Match server TILE_SIZE_PX
    const SERVER_WORLD_WIDTH_TILES = 500;     // Match server WORLD_WIDTH_TILES
    const SERVER_WORLD_HEIGHT_TILES = 500;    // Match server WORLD_HEIGHT_TILES
    const CHUNK_SIZE_TILES = 10;              // Match server CHUNK_SIZE_TILES
    ```

5.  **Rebuild and Republish:**
    ```bash
    cd server
    spacetime publish vibe-survival-game --clear-database  # Clear DB for schema changes
    spacetime generate --lang typescript --out-dir ../client/src/generated --project-path .
    cd ..
    ```

**Important:** Ensure the `TILE_SIZE` (in `gameConfig.ts`) / `TILE_SIZE_PX` (in `lib.rs`) and the `SERVER_WORLD_WIDTH_TILES`/`SERVER_WORLD_HEIGHT_TILES` (in `gameConfig.ts`) / `WORLD_WIDTH_TILES`/`WORLD_HEIGHT_TILES` (in `lib.rs`) values are kept consistent between the client and server configuration files. The `gameConfig.worldWidth` and `gameConfig.worldHeight` should also mirror these tile dimension values.

After making server-side changes, remember to **re-publish** the module:

```bash
# From the server/ directory
spacetime publish vibe-survival-game
# No need to regenerate client bindings for changing only these constants
```

## 📁 Project Structure

```
vibe-coding-starter-pack-2d-survival/
├── .cursor/                # Cursor AI configuration
│   └── rules/              # *.mdc rule files for AI context
├── auth-server-openauth/   # Authentication server (Node.js/Hono)
│   ├── data/              # User storage (users.json)
│   ├── index.ts           # Main auth server logic
│   └── package.json       # Node.js dependencies
├── client/                # React frontend (UI, rendering, input)
│   ├── public/            # Static files (index.html, favicons)
│   ├── src/
│   │   ├── assets/        # Sprites, textures, sounds
│   │   │   ├── doodads/   # Decorative game objects
│   │   │   ├── environment/ # Environmental assets (clouds, etc.)
│   │   │   ├── items/     # Item sprites and assets
│   │   │   ├── states/    # UI state assets
│   │   │   └── tiles/     # Tile textures
│   │   ├── components/    # React components (UI, Canvas)
│   │   ├── config/        # Client-side game configuration
│   │   ├── contexts/      # React contexts (Auth, Game state)
│   │   ├── effects/       # Visual effects and animations
│   │   ├── generated/     # Auto-generated SpacetimeDB bindings
│   │   ├── hooks/         # Custom React hooks
│   │   ├── types/         # Shared TypeScript types
│   │   └── utils/         # Helper functions (rendering, logic)
│   │       ├── auth/      # Authentication utilities
│   │       └── renderers/ # Rendering utilities
│   └── package.json
├── server/                # SpacetimeDB server logic (Rust)
│   ├── data/             # Server data and configuration
│   │   ├── cache/        # Runtime caches and temp files
│   │   ├── control-db/   # SpacetimeDB control database
│   │   ├── logs/         # Server logs
│   │   └── program-bytes/ # Compiled WASM modules
│   ├── src/              # Rust source code
│   │   ├── lib.rs        # Main server module entry point
│   │   ├── environment.rs # World generation and resource spawning
│   │   ├── player_movement.rs # Player physics and movement
│   │   ├── combat.rs     # Combat system and weapons
│   │   ├── crafting.rs   # Crafting recipes and logic
│   │   ├── world_generation.rs # Procedural world generation
│   │   └── [other modules] # Additional game systems
│   ├── target/           # Rust build artifacts
│   └── Cargo.toml        # Rust dependencies and configuration
├── components/            # Shared/reusable components (legacy)
├── data/                 # Shared game data files
├── keys/                 # RSA keys for authentication (generated)
│   ├── private.pem       # Private key (keep secret)
│   └── public.pem        # Public key for verification
├── eslint.config.js      # ESLint configuration
├── github.png            # Banner image
├── guide.mdc             # Development guide (Cursor rules)
├── index.html            # Root HTML file
├── LICENSE               # MIT License
├── package.json          # Root package.json with client scripts
├── preview.png           # Gameplay preview image
├── README.md             # This file
├── recording.mp4         # Demo video
├── tsconfig.*.json       # TypeScript configurations
└── vite.config.ts        # Vite build configuration
```

## 🔧 Troubleshooting Local Setup

*   **`Cannot find module './generated'` error in client:**
    *   Ensure you ran `spacetime generate --lang typescript --out-dir ../client/src/generated --project-path .` from the `server` directory *after* the last `spacetime publish` was **successful**. Check the publish output for errors.
    *   Make sure the `client/src/generated` folder was actually created and contains `.ts` files, including `index.ts`.
    *   Restart the Vite dev server (`npm run dev`). Sometimes Vite needs a restart after significant file changes.
*   **Client connects but game doesn't load / players don't appear:**
    *   Check the browser console (F12) for JavaScript errors (e.g., subscription failures, rendering issues).
    *   Check the terminal running `spacetime start` for server-side Rust errors (e.g., reducer panics, assertion failures).
*   **Old players/data still appearing after disconnect/refresh:**
    *   Verify the `identity_disconnected` logic in `server/src/lib.rs` is correctly deleting the player, inventory, and equipment.
    *   For a guaranteed clean slate during development, delete and recreate the local database:
        ```bash
        # Stop spacetime start (Ctrl+C in its terminal)
        spacetime delete vibe-survival-game # Run from any directory
        spacetime start # Restart the server
        # Then re-publish and re-generate (Step 4 above)
        ```
*   **`spacetime publish` tries to publish to Maincloud instead of local:**
    *   Ensure you are logged out: `spacetime logout`.
    *   Ensure the `spacetime start` server is running *before* you publish.
    *   Check your SpacetimeDB config file (`%LOCALAPPDATA%/SpacetimeDB/config/cli.toml` on Windows, `~/.local/share/spacetime/config/cli.toml` on Linux/macOS) and make sure `default_server` is set to `local` or commented out.

## 🔄 Development Workflow

1.  **Server Development (`server/src`)**:
    *   Modify Rust code (add features, fix bugs).
    *   **Deploy changes using scripts:**
        ```bash
        cd server/
        ./deploy-local.ps1           # Quick local update
        ./deploy-local-clean.ps1     # Fresh local database (for schema changes)
        ```
2.  **Client Development (`client/src`)**:
    *   Modify React/TypeScript code.
    *   The Vite dev server (`npm run dev`) provides Hot Module Replacement (HMR) for fast updates.

## 🚀 Deployment Scripts

The project includes PowerShell scripts in the `server/` directory for streamlined deployment:

### Local Development Scripts
- **`deploy-local.ps1`** - Updates existing local database
  - Publishes to `broth-bullets-local`
  - Regenerates client bindings
  - Preserves existing data

- **`deploy-local-clean.ps1`** - Fresh local database deployment
  - Deletes existing `broth-bullets-local` database
  - Creates fresh database with latest schema
  - Regenerates client bindings
  - **⚠️ Wipes all data** - use for schema changes

### Production Scripts
- **`deploy-production.ps1`** - Updates production database
  - Publishes to `broth-bullets` on maincloud
  - Regenerates client bindings
  - **Commits from root directory** to capture all changes (server + client)
  - Pushes to trigger Vercel deployment
  - Preserves existing data

- **`deploy-production-clean.ps1`** - Fresh production deployment
  - Deletes existing `broth-bullets` database on maincloud
  - Creates fresh database with latest schema
  - Regenerates client bindings
  - **Commits from root directory** to capture all changes (server + client)
  - Pushes to trigger Vercel deployment
  - **⚠️ Wipes all production data** - use carefully

### Usage Examples
```bash
# Local development - quick update
cd server/
./deploy-local.ps1

# Local development - schema changes
cd server/
./deploy-local-clean.ps1

# Production deployment - safe update
cd server/
./deploy-production.ps1

# Production deployment - major schema changes
cd server/
./deploy-production-clean.ps1  # ⚠️ Use with caution!
```

**📝 Important Note:** Production scripts automatically navigate to the root directory before committing to ensure all changes (both server and client bindings) are captured in the git commit. This ensures Vercel deployments include the latest generated client bindings.

## 🎨 Art Generation Prompts

This section contains the prompts used for generating game assets with AI tools like GPT-4o.

### Item Icons

For generating game item icons (weapons, tools, consumables, etc.):

```
A pixel art style SUBJECT (i.e., hammer) with consistent pixel width and clean black outlines, designed as a game item icon. Rendered with a transparent background, PNG format. The object should have a clear silhouette, sharp pixel-level detail, and fit naturally in a top-down RPG game like Secret of Mana. No background, no shadows outside the object. Stylized with a warm palette and light dithering where appropriate.
```

**Usage**: Replace "SUBJECT" with the specific item (e.g., "hammer", "health potion", "wooden sword")

### Environment Assets / Doodads

For generating environment objects, structures, and decorative elements:

```
Pixel art sprite in a 16-bit RPG style, 3/4 top-down view (slightly angled perspective), clean outlines, vibrant color palette, soft shading with no directional highlights (shading handled via in-game shaders), set on a transparent background. Focus on a blocky, detailed silhouette with depth visible in the form. Centered and properly grounded in the scene.

Subject: SUBJECT, i.e. Oak Tree
```

**Usage**: Replace "SUBJECT" with the specific environment object (e.g., "Oak Tree", "Stone Boulder", "Wooden Campfire", "Small Bush")

### Spritesheets

For generating character animations and complex sprite sequences, use **[retrodiffusion.ai](https://retrodiffusion.ai)** to generate spritesheets.

This specialized tool is designed specifically for creating pixel art spritesheets with consistent character designs across multiple frames, making it ideal for:
- Character walking animations
- Idle animations
- Object state variations
- Multi-directional sprites

The tool maintains consistency between frames and generates properly formatted spritesheets that can be directly imported into game engines.

## 🤝 Contributing

We welcome contributions to this project! To contribute, please follow the standard GitHub Fork & Pull Request workflow:

1.  **Fork the Repository**: Click the 'Fork' button on the top right of the main repository page (`SeloSlav/vibe-coding-starter-pack-2d-multiplayer-survival`) to create your personal copy under your GitHub account.
2.  **Clone Your Fork**: Clone *your forked repository* to your local machine:
    ```bash
    git clone https://github.com/YOUR_USERNAME/vibe-coding-starter-pack-2d-multiplayer-survival.git
    cd vibe-coding-starter-pack-2d-multiplayer-survival
    ```
    (Replace `YOUR_USERNAME` with your actual GitHub username).
3.  **Create a Branch**: Create a new branch for your feature or fix:
    ```bash
    git checkout -b feature/your-feature-name
    ```
4.  **Implement Your Changes**: Make your code changes, following project style guidelines.
5.  **Test Thoroughly**: Ensure your changes work as expected and don't break existing functionality.
6.  **Commit Your Changes**: Commit your work with a clear message:
    ```bash
    git commit -m "feat: Add awesome new feature"
    ```
7.  **Push Your Branch**: Push your changes *to your fork*:
    ```bash
    git push origin feature/your-feature-name
    ```
8.  **Open a Pull Request**: Go back to the *original* repository (`SeloSlav/vibe-coding-starter-pack-2d-multiplayer-survival`) on GitHub. You should see a prompt to create a Pull Request from your recently pushed branch. Click it, or navigate to the "Pull Requests" tab and click "New Pull Request".
9.  **Configure the PR**: Ensure the base repository is `SeloSlav/vibe-coding-starter-pack-2d-multiplayer-survival` and the base branch is typically `main` (or the relevant development branch). Ensure the head repository is your fork and the compare branch is your feature branch (`feature/your-feature-name`).
10. **Describe Your Changes**: Provide a clear title and description for your Pull Request, explaining the changes and their purpose.

Whether you're interested in adding new gameplay mechanics, improving existing systems, or enhancing the codebase, your contributions are valuable to making this starter pack even better!

For questions or discussions about potential contributions, feel free to open an issue first to discuss your ideas.

## 📜 License

This project is licensed under the MIT License - see the LICENSE file for details.

---

Created by SeloSlav