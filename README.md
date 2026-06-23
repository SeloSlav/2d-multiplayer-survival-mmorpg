![Broth & Bullets - Alpha Launch](https://www.brothandbullets.com/images/blog/systems.png)

> **Warning: Make sure to read the [license](#-license) before use.**

# 2D Multiplayer Survival MMORPG

🎮 **[Watch gameplay demo](https://x.com/SeloSlav/status/2023523837724221851?s=20)**

What started as an open source project for a generic 2D survival game is now a full-fledged game called **Broth & Bullets**. You can read more about it at [https://www.brothandbullets.com/blog](https://www.brothandbullets.com/blog).

I've committed to open sourcing the entire project and providing the best documentation possible to help you get up and running, fork the project, create your own games, or even contribute back to Broth & Bullets itself. This repository has evolved into an exhaustive, feature-rich project with almost every pattern you can think of—constantly in development and running on SpacetimeDB 2.0. A stripped-down true "starter kit" for 2D MMORPGs (all the main features without the bloat) is planned for release soon.

💬 **Want to chat?** Join the discussion on [Discord](https://discord.gg/tUcBzfAYfs)

## Table of Contents

- [⚡ Quick Local Setup](#️-quick-local-setup)
- [🐳 Docker Compose (Alternative)](#-docker-compose-alternative)
- [🗺️ Roadmap](#️-roadmap)
- [🛠️ Tech Stack](#️-tech-stack)
- [🔐 Authentication Setup](#-authentication-setup)
- [📜 Cursor Rules & Code Maintainability](#-cursor-rules--code-maintainability)
- [⚙️ Client Configuration](#️-client-configuration)
- [🤖 SOVA AI Assistant Configuration](#-sova-ai-assistant-configuration)
- [🌍 World Configuration](#-world-configuration-tile-size--map-dimensions)
- [📁 Project Structure](#-project-structure)
- [🔧 Troubleshooting Local Setup](#-troubleshooting-local-setup)
- [🔄 Development Workflow](#-development-workflow)
- [🚀 Deployment Scripts](#-deployment-scripts)
- [🎨 Art Generation Prompts](#-art-generation-prompts)
- [🤝 Contributing](#-contributing)
- [📜 License](#-license)

## ⚡ Quick Local Setup

For experienced users familiar with Node.js, Rust, and SpacetimeDB. See detailed sections below for troubleshooting or authentication specifics.

### 📦 Required Versions

This project uses:

- **SpacetimeDB CLI**: `2.0.x`
- **SpacetimeDB Rust Crate**: `2.0`
- **SpacetimeDB TypeScript SDK**: `spacetimedb@2.0.1` (npm package)

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

**3. Start Core Services (3 Terminals):**

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
spacetime publish --no-config -p . broth-bullets-local -y
spacetime generate --no-config --include-private -p . -l typescript -o ../client/src/generated -y
```

🎉 **That's it! Your multiplayer survival game is up and running!** 🎮✨

---

### 🐳 Docker Compose (Alternative)

For rapid local setup without managing multiple terminals. **Does not affect Railway deployments** (Railway uses per-service configs).

**Prerequisites:** Docker, Docker Compose, SpacetimeDB CLI (for database deploy step)

```bash
# 1. Clone & create .env
git clone https://github.com/SeloSlav/vibe-coding-starter-pack-2d-multiplayer-survival.git
cd vibe-coding-starter-pack-2d-multiplayer-survival
copy .env.example .env   # Windows (or cp .env.example .env on macOS/Linux)
# Add API keys to .env for SOVA (OPENAI_API_KEY, GROK_API_KEY, etc.)

# 2. Start all services
docker compose up --build

# 3. Deploy database (run in a new terminal, one-time or after server changes)
cd server
spacetime publish --no-config -p . broth-bullets-local -y
spacetime generate --no-config --include-private -p . -l typescript -o ../client/src/generated -y

# 4. Open http://localhost:3008
```

Services: SpacetimeDB (3000), Auth Server (4001), Client (3008), Kokoro TTS (8001).

Create `.env` from `.env.example` and add API keys before first run:

```bash
copy .env.example .env   # Windows
# cp .env.example .env   # macOS/Linux
```

---

### 🤖 Optional: SOVA AI Assistant Setup

**Only needed if you want to use the in-game AI assistant (SOVA).**

**1) Configure API keys in root `.env`:**

```bash
# Create .env file in project root first
# OpenAI API key is REQUIRED for Whisper (speech-to-text)
echo "OPENAI_API_KEY=sk-your-openai-api-key-here" > .env
# Add at least one AI provider key for SOVA responses:
echo "GROK_API_KEY=xai-your-grok-api-key-here" >> .env
# OR echo "GEMINI_API_KEY=your-gemini-api-key-here" >> .env
# Optional provider selection (defaults to grok)
echo "VITE_AI_PROVIDER=grok" >> .env
```

**2) Terminal 4 - Kokoro TTS Backend:**

```bash
cd tts-backend
python -m venv venv
.\venv\Scripts\Activate.ps1  # Windows PowerShell
pip install -r requirements.txt
python app.py
# Kokoro TTS running on http://localhost:8001
```

**3) Client environment variables (for AI assistant):**

```bash
# Add to .env file in project root
echo "VITE_KOKORO_BASE_URL=http://localhost:8001" >> .env
```

See the [SOVA AI Assistant Configuration](#-sova-ai-assistant-configuration) section below for details.

---

### 🎮 Multiplayer Testing

Open a **new terminal** and run `npm run dev` again. The second client will open on a different port. Open this URL in a separate browser tab to test multiplayer functionality!

### 🔄 Updating Server Code

**Quick Updates:** Use deployment scripts in `server/` directory:

```bash
cd server/
./deploy-local.ps1           # Update local database
./deploy-local-clean.ps1     # Fresh local database (wipes data)
./deploy-production.ps1      # Update production database
./deploy-production-clean.ps1 # Fresh production database (wipes data)
```

**Manual Deployment:**

```bash
cd server/
spacetime publish --no-config -p . broth-bullets-local -y  # Local
# OR
spacetime publish --server maincloud -p . broth-bullets  # Production
spacetime generate --no-config --include-private -p . -l typescript -o ../client/src/generated -y
```

## 🗺️ Roadmap

**Completed (✅):**

- 🌐 Real-time Multiplayer: Basic player movement synchronization
- 🌓 Environment Systems: Day/night cycle, Full moon nights, Rain system that affects gameplay and atmosphere
- 🪓 Survival Mechanics: Basic resource harvesting
- 🌱 Resource Respawning: Trees, Stones, Plants
- ❤️ Survival Systems: Health, Hunger, Thirst, Warmth, Death/Respawn
- 🗺️ World Discovery: Minimap
- 🎮 Hotbar: Item selection, weapon cooldown indicators
- 🎒 Inventory Management: Moving, swapping, stacking, stack splitting
- ⚔️ Armor: Defense bonuses, warmth protection
- 🔥 Placeables: Campfire (Multi-slot placement & interaction)
- 🛠️ Crafting System: Item recipes
- 📦 Storage Containers (Chests)
- 💰 Looting Mechanics (Containers)
- 🔐 Authentication/Account System
- 🍳 Cooking System: Food preparation using campfire with raw, cooked and burnt states
- ⚔️ Combat System: Multiple weapon types (melee, thrown, ranged), improved hit detection, PvP balancing
- 🏹 Ranged Weapons & Ammunition: Bow combat with different arrow types (stone, iron, fire arrows), arrow cycling system
- 🩸 Active Effects System: Bleed damage, burn damage, and other status effects
- 💀 Player Corpses: Harvestable corpses that yield primitive resources when players die
- 😵 Knock Out System: Combat state with temporary incapacitation and a chance to spontaneously recover
- 🏠 Player Shelter: Personal shelter system where only the owner can enter and keep their campfire safe from the rain
- 🛏️ Sleeping Bags: Placeable respawn points that persist between deaths
- 🏗️ Construction System: Base building (walls, floors, etc.)
- 🌱 Farming System: Planting, growing, harvesting crops
- 🦌 Hunting System: NPC animals (foxes, wolves, etc.), tracking, hunting mechanics
- 🎨 Terrain Autotiling: Edge detection, Wang tiles, seamless transitions between biomes
- 🛡️ Advanced Armor System: Damage resistance by type (melee, projectile, fire, blunt, slash, pierce), warmth bonuses, movement speed modifiers, set-based immunities (burn, cold, wetness, knockback, bleed), special effects (melee damage reflection, detection radius, low health damage bonus, silent movement, animal intimidation), cold resistance scaling, and drying speed modifiers
- 🌦️ Dynamic Chunk-Based Weather: Evolving weather patterns with chunk-level granularity, smooth transitions, and gameplay effects (rain intensity, temperature, visibility)
- 🌍 Procedural World Generation: Multi-biome terrain generation (grasslands, forests, beaches, rivers), island-based maps with configurable parameters, noise-based terrain shaping, and resource distribution
- 🤖 Advanced AI: Hostile NPC behaviors (wolves, foxes), state-based AI systems (idle, wander, chase, attack, flee), pathfinding, aggression mechanics, and animal-specific behaviors
- 🏛️ Monuments System: Pre-designed structures spawned in the world - abandoned buildings, caves, military outposts, research facilities with unique loot tables and environmental storytelling
- 🏢 Central NPC Compound: Neutral trading hub with shared crafting stations, vending machines, AI-driven auction house, and insurance pool system for collective resource sharing
- 👥 Team/Social Features: Shared map markers, team chat, private messaging, player notes, and group formation
- 🍲 Broth System: Placeable broth pots over campfires with water filling mechanics, multi-ingredient cooking, stirring mini-game, and recipe spoilage mechanics
- 🧱 Walls & Gates: Buildable wooden walls, lockable gates, lockable storage, fire arrow structure damage, and water-based fire extinguishing
- ⚔️ Tool/Weapon Durability
- 🔫 Firearm System: Guns with ammo types, reloading mechanics, and recoil

**Planned (📋):** 

- 🔫 Firearms & Advanced Combat: Need to add more gun types and maybe a "zoom" feature which will be tricky in 2D but I have some ideas (like partitioned viewport)
- 🤖 Neutral Faction & NPCs: Need to add AI NPCs in the monuments (add more monuments) that you can interact with or give quests
- 🔑 Social Auth (Steam, Discord, Twitch)
- 🔬 Advanced Tech Tree: The "faction" unlocks which I'll work on if the game gets traction but as of now the main survival tech tree is fully unlocked
- 🎨 Graphical Overhaul (Hiring Pixel Artists!)

> **Note:** Between this project and others, I might be away for some time - usually tending to olive trees or working on freelance projects. Feel free to contribute! If you're interested in contributing to the main project, the planned features listed above would be fantastic starting points! I'd love to see what the community builds with this foundation. 🎮
>
> **Support the Project:** If you find this starter kit helpful and want to support continued development, consider trying some premium olive oil from my family farm! 🫒

- 🛒 **Selo Olive Oil Discount:** Use code `VIBE15` for 15% off at [seloolive.com/discount/VIBE15](https://seloolive.com/discount/VIBE15) - available in the US

## 🛠️ Tech Stack


| Layer       | Technologies                 |
| ----------- | ---------------------------- |
| Frontend    | React 19, Vite 6, TypeScript |
| Multiplayer | SpacetimeDB 2.0              |
| Backend     | Rust (WebAssembly)           |
| Development | Node.js 22+                  |


## 🔐 Authentication Setup

This project implements user authentication using a custom Node.js authentication server built with OpenAuthJS and Hono, bridged to SpacetimeDB via standard OpenID Connect (OIDC) JWTs.

**Approach:**

1. **Client:** Initiates an OIDC Authorization Code Flow with PKCE, manually constructing the `/authorize` URL for the custom auth server and specifying `acr_values=pwd` to request the password flow.
2. **Auth Server (`auth-server-openauth/`):** A Node.js/Hono server that:
  - Intercepts the `/authorize` request.
  - If `acr_values=pwd`, redirects the user to custom HTML login/registration forms, forwarding OIDC parameters (`client_id`, `redirect_uri`, `state`, `code_challenge`, etc.).
  - Handles POST submissions from these forms, verifying user credentials against a local user store (`data/users.json`).
  - On successful login/registration, generates a one-time authorization `code` and stores it along with the user ID and PKCE challenge.
  - Redirects the user back to the client's specified `redirect_uri` with the `code` and `state`.
3. **Client:** Receives the redirect at its `/callback` URI, extracts the `code`.
4. **Client:** Makes a `fetch` POST request to the auth server's custom `/token` endpoint, sending the `code`, PKCE `code_verifier`, `client_id`, and `redirect_uri`.
5. **Auth Server (`/token`):**
  - Receives the code exchange request.
  - Looks up the code, retrieves the associated user ID and PKCE challenge.
  - Verifies the `code_verifier` against the stored `code_challenge`.
  - If valid, mints a new JWT `id_token` and `access_token`, signed using a **private RSA key** (RS256 algorithm).
  - Returns the tokens to the client.
6. **Client:** Receives the tokens, stores the `id_token` (used as the `spacetimeToken`).
7. **Client:** Connects to the main SpacetimeDB game server (`server/`) using the `id_token`.
8. **SpacetimeDB Server (`server/`):**
  - Configured with the `issuer` URL of the auth server.
  - Fetches the OIDC discovery document (`/.well-known/openid-configuration`) and then the public keys (`/.well-known/jwks.json`) from the auth server.
  - Verifies the `id_token`'s signature using the fetched public key and validates the `iss` (issuer) and `aud` (audience) claims.
  - Grants the connection access based on the identity (`sub` claim) in the validated token.

This approach uses standard OIDC practices with asymmetric key signing (RS256), allowing SpacetimeDB to securely verify tokens without needing a shared secret.

### Running Authentication Locally

To get authentication working during local development, follow these steps:

1. **Generate RSA Keys:** You need an RSA key pair for signing and verifying tokens. Use OpenSSL:
  - Open a terminal in the **project root** directory.
  - Run the following commands:
    ```bash
    # Create a directory for keys if it doesn't exist
    mkdir keys
    # Generate a 2048-bit RSA private key
    openssl genpkey -algorithm RSA -out keys/private.pem -pkeyopt rsa_keygen_bits:2048
    # Extract the public key from the private key
    openssl rsa -pubout -in keys/private.pem -out keys/public.pem
    ```
  - This creates `keys/private.pem` (keep secret, used by auth server) and `keys/public.pem` (used for verification).
  - **Important:** The `.gitignore` file is configured to prevent these keys from being committed to Git.
2. **Configure Auth Server (`auth-server-openauth/`):**
  - No `.env` file is strictly required for basic local operation, as defaults are set in `index.ts`.
  - The server automatically loads `keys/private.pem` and `keys/public.pem` for signing tokens and serving the JWKS endpoint.
  - It manages user data in `data/users.json` (which will be created automatically if it doesn't exist). The `.gitignore` also prevents this file from being committed.
3. **Run Auth Server:**
  - Open a terminal in the `auth-server-openauth/` directory.
  - Run `npm install` if you haven't already.
  - Run `npm start`.
  - Keep this terminal running. You should see `🚀 Auth server → http://localhost:4001`. Logs for authentication steps will appear here.
4. **Configure SpacetimeDB Server (`server/data/config.toml`):**
  - Ensure the `server/data/config.toml` file has the following `[auth]` configuration to trust your auth server:
5. **Run Main SpacetimeDB Server (`server/`):**
  - Open a **separate terminal**.
  - Run `spacetime start`.
  - Keep this terminal running.
6. **Client Configuration:** No changes are needed for default local play. Auth and Spacetime endpoints are resolved in `client/src/config/backendEnv.ts` (localhost + Vite dev use `http://localhost:4001` and `ws://localhost:3000`). See [Client Configuration](#️-client-configuration) for optional env overrides.
7. **Run Client:**
  - Open a terminal in the project **root** directory.
  - Run `npm run dev`.

Now, when you sign in via the client's login screen, the full authentication flow using your custom OpenAuthJS server and RS256 keys should execute.

### Production Deployment

- **Auth Server:** Deploy the `auth-server-openauth` Node.js application to a hosting provider. Ensure the `keys/private.pem` and `keys/public.pem` files are securely deployed alongside the application (or manage keys via environment variables/secrets management if your host supports it). Ensure it's served over HTTPS.
- **Client:** Set production auth and Spacetime defaults via Vite env at build time (see [Client Configuration](#️-client-configuration)), or use `VITE_AUTH_SERVER_URL` / `VITE_SPACETIME_*` overrides for your deployed auth server URL (HTTPS) and database.
- **SpacetimeDB:** Configure your SpacetimeDB Maincloud/Enterprise instance with the *production* `issuer` and `jwks_uri` of your deployed auth server, and the correct `audience`.

### Limitations & Future Improvements

- **Basic Forms:** The login/register forms served by the auth server are very basic HTML. They could be enhanced or replaced with a proper frontend framework if desired.
- **Error Handling:** Error handling in the manual auth routes could be more user-friendly.
- **No Refresh Token Handling:** This setup doesn't implement refresh tokens. If the `id_token` expires, the user would need to log in again.

## 📜 Cursor Rules & Code Maintainability

### Cursor Rules (`.cursor/rules/`)

This project utilizes [Cursor](https://cursor.sh/)'s AI features, including **Rules**, to aid development. Rules are markdown files (`.mdc`) that provide context and guidelines to the AI assistant.

- `guide.mdc`: Contains general architectural guidelines, technology choices, and development workflow information.
- `resources.mdc`: Outlines the specific steps for adding new resources or gatherable nodes consistently.

As the project grows, more specific rules will be added for core features (e.g., crafting, building, combat) to ensure the AI can provide consistent and relevant assistance.

### Code Maintainability

While the project is still evolving, a key goal is maintainability. As features are added, we aim to:

- Keep individual file sizes manageable (ideally under ~600 lines where practical).
- Refactor logic into reusable helper functions and potentially dedicated modules (like the planned `inventory_logic.rs`).
- Utilize abstraction to avoid code duplication, especially for common interactions like container management.

## ⚙️ Client Configuration

Auth and SpacetimeDB WebSocket URLs are resolved in [`client/src/config/backendEnv.ts`](client/src/config/backendEnv.ts) and consumed by `AuthContext.tsx` and `GameConnectionContext.tsx`.

**Default behavior**

- **Vite dev or `localhost`:** Auth `http://localhost:4001`, Spacetime `ws://localhost:3000`, database `broth-bullets-local`.
- **Deployed site (not localhost):** Auth `https://broth-and-bullets-production.up.railway.app`, Spacetime `wss://maincloud.spacetimedb.com`, database `broth-bullets`.

**Local UI with production backends (no local Spacetime or auth)**

Create `.env.local` in the **project root** (next to `vite.config.ts`) or set env vars before `npm run dev`:

```bash
VITE_USE_PRODUCTION_BACKENDS=true
```

Restart the dev server after changing env files. The client uses the production auth server and Maincloud; ensure the deployed auth server allows CORS from your dev origin (e.g. `http://localhost:5173`).

**Optional overrides** (highest precedence; use for forks or staging)

| Variable | Purpose |
|----------|---------|
| `VITE_AUTH_SERVER_URL` | Full auth issuer base URL. |
| `VITE_SPACETIME_WS_URL` | SpacetimeDB WebSocket URI. |
| `VITE_SPACETIME_DATABASE` | Database name. |

See [`.env.example`](.env.example) in the project root for commented templates (including backend overrides).

## 🤖 SOVA AI Assistant Configuration

This project includes SOVA (Sentient Ocular Virtual Assistant), an intelligent AI assistant with voice synthesis capabilities. SOVA provides tactical advice, game tips, and responds with a military-themed personality.

### Quick Setup

**All API keys are secured server-side - never exposed to the browser.**

1. **Set server-side API keys in root `.env`:**
  ```bash
   # Create .env file in project root
   # OpenAI API key is REQUIRED for Whisper (speech-to-text)
   echo "OPENAI_API_KEY=sk-your-openai-api-key-here" > .env
   # Add at least one AI provider key for SOVA responses:
   echo "GROK_API_KEY=xai-your-grok-api-key-here" >> .env
   # OR echo "GEMINI_API_KEY=your-gemini-api-key-here" >> .env
   # Optional provider selection (defaults to 'grok')
   echo "VITE_AI_PROVIDER=grok" >> .env
  ```
2. **Start Kokoro TTS Backend (Self-hosted, Free):**
  **Prerequisites:** Python 3.10-3.12 (Python 3.13 not supported yet)
   **See [KOKORO_INTEGRATION.md](./docs/audio/KOKORO_INTEGRATION.md) for detailed setup instructions, troubleshooting, and system requirements.**
3. **Configure Client (No API Keys Needed!):**
  ```bash
   # Add to .env file in project root
   echo "VITE_KOKORO_BASE_URL=http://localhost:8001" >> .env
  ```

### Features

- 🎤 **Voice Synthesis:** High-quality voice responses using Kokoro TTS (self-hosted, free)
- 🎙️ **Voice Commands:** Hold V key for speech-to-text input (OpenAI Whisper)
- 🧠 **AI Personality:** Intelligent responses powered by multiple providers (Grok/OpenAI/Gemini)
- 🔄 **Provider Switching:** Easy switching between AI providers via `VITE_AI_PROVIDER` environment variable
- 🔒 **Secure:** All API keys stay on server - never exposed to browser
- 🎯 **Game Knowledge:** Contextual survival tips and tactical advice
- 🎪 **Easter Eggs:** Special responses (try asking "What does SOVA stand for?")
- 🔄 **Fallback System:** Works without API keys using predefined responses

### Voice Interface

- **Push-to-Talk:** Hold **V** key to activate voice recording
- **Cyberpunk UI:** Animated recording interface with status indicators
- **Speech-to-Text:** OpenAI Whisper converts speech to text
- **Chat Integration:** Voice messages appear in chat like typed messages
- **AI Response:** SOVA responds intelligently with voice synthesis (Kokoro TTS)

### Services Required

You need **2 services running** for full voice functionality:

1. **Kokoro TTS Backend** (`tts-backend/`) - Local text-to-speech synthesis
2. **Game Client** (`npm run dev`) - React frontend

### Documentation

- **[docs/setup/ENVIRONMENT_SETUP.md](./docs/setup/ENVIRONMENT_SETUP.md)** - Complete AI environment variable guide
- **[KOKORO_INTEGRATION.md](./docs/audio/KOKORO_INTEGRATION.md)** - **Complete Kokoro TTS setup guide** (Python version requirements, troubleshooting, voice options, production deployment)
- **[WHISPER_OPTIMIZATION.md](./WHISPER_OPTIMIZATION.md)** - Speech-to-text optimization guide

## 🌍 World Configuration (Tile Size & Map Dimensions)

Changing the tile size, chunk configuration, or overall world dimensions requires coordinated modifications in **both** the client and server code to ensure consistency between rendering, collision detection, game logic, and world generation.

### Core Configuration Values

#### 1. **Client Configuration (`client/src/config/gameConfig.ts`):**

**Tile & World Size:**

- `TILE_SIZE`: Visual pixel size of each grid tile (e.g., `48`). Must match server's `TILE_SIZE_PX`.
- `SERVER_WORLD_WIDTH_TILES`: Assumed width of the server's world in tiles (e.g., `500`). Must match server's `WORLD_WIDTH_TILES`.
- `SERVER_WORLD_HEIGHT_TILES`: Assumed height of the server's world in tiles (e.g., `500`). Must match server's `WORLD_HEIGHT_TILES`.

**Chunk Configuration:**

- `CHUNK_SIZE_TILES`: Number of tiles along one edge of a square chunk (e.g., `10`). Must match server's `CHUNK_SIZE_TILES`.

**Legacy/Compatibility Values:**

- `worldWidth` and `worldHeight`: Should match `SERVER_WORLD_WIDTH_TILES` and `SERVER_WORLD_HEIGHT_TILES`.
- `spriteWidth` and `spriteHeight`: Player/entity sprite dimensions, typically match `TILE_SIZE`.

#### 2. **Server Configuration (`server/src/lib.rs`):**

**Primary Constants:**

- `TILE_SIZE_PX`: Size of each tile in pixels (e.g., `pub const TILE_SIZE_PX: u32 = 48;`).
- `WORLD_WIDTH_TILES`: World width in tiles (e.g., `pub const WORLD_WIDTH_TILES: u32 = 500;`).
- `WORLD_HEIGHT_TILES`: World height in tiles (e.g., `pub const WORLD_HEIGHT_TILES: u32 = 500;`).

**Derived Values (automatically calculated):**

- `WORLD_WIDTH_PX`: World width in pixels (`(WORLD_WIDTH_TILES * TILE_SIZE_PX) as f32`).
- `WORLD_HEIGHT_PX`: World height in pixels (`(WORLD_HEIGHT_TILES * TILE_SIZE_PX) as f32`).

#### 3. **Server Environment Configuration (`server/src/environment.rs`):**

**Chunk System:**

- `CHUNK_SIZE_TILES`: Size of a chunk in tiles (e.g., `pub const CHUNK_SIZE_TILES: u32 = 10;`). Must match client.
- `WORLD_WIDTH_CHUNKS`: Number of chunks across world width (auto-calculated).
- `CHUNK_SIZE_PX`: Size of a chunk in pixels (auto-calculated).

#### 4. **World Generation Configuration (`server/src/world_generation.rs`):**

The `WorldGenConfig` struct controls procedural world generation:

- `world_width_tiles`: Should match `WORLD_WIDTH_TILES` in `lib.rs`.
- `world_height_tiles`: Should match `WORLD_HEIGHT_TILES` in `lib.rs`.
- `chunk_size`: Should match `CHUNK_SIZE_TILES` in `environment.rs`.
- Other generation parameters: `seed`, `island_border_width`, `beach_width`, `river_frequency`, etc.

### Recommended Configuration Steps

**When changing world dimensions or tile size:**

1. **Update Server Core (`server/src/lib.rs`):**
  ```rust
    pub const TILE_SIZE_PX: u32 = 48;        // Your desired tile size
    pub const WORLD_WIDTH_TILES: u32 = 500;   // Your desired world width
    pub const WORLD_HEIGHT_TILES: u32 = 500;  // Your desired world height
  ```
2. **Update Server Environment (`server/src/environment.rs`):**
  ```rust
    pub const CHUNK_SIZE_TILES: u32 = 10;     // Your desired chunk size
  ```
3. **Update World Generation Config (in `init_module` or world generation):**
  ```rust
    WorldGenConfig {
        world_width_tiles: 500,    // Match WORLD_WIDTH_TILES
        world_height_tiles: 500,   // Match WORLD_HEIGHT_TILES  
        chunk_size: 10,           // Match CHUNK_SIZE_TILES
        // ... other generation settings
    }
  ```
4. **Update Client Config (`client/src/config/gameConfig.ts`):**
  ```typescript
    const TILE_SIZE = 48;                      // Match server TILE_SIZE_PX
    const SERVER_WORLD_WIDTH_TILES = 500;     // Match server WORLD_WIDTH_TILES
    const SERVER_WORLD_HEIGHT_TILES = 500;    // Match server WORLD_HEIGHT_TILES
    const CHUNK_SIZE_TILES = 10;              // Match server CHUNK_SIZE_TILES
  ```
5. **Rebuild and Republish:**
  ```bash
    cd server
    spacetime publish -c --no-config -p . broth-bullets-local -y  # Clear DB for schema changes
    spacetime generate --no-config --include-private -p . -l typescript -o ../client/src/generated -y
    cd ..
  ```

**Important:** Ensure the `TILE_SIZE` (in `gameConfig.ts`) / `TILE_SIZE_PX` (in `lib.rs`) and the `SERVER_WORLD_WIDTH_TILES`/`SERVER_WORLD_HEIGHT_TILES` (in `gameConfig.ts`) / `WORLD_WIDTH_TILES`/`WORLD_HEIGHT_TILES` (in `lib.rs`) values are kept consistent between the client and server configuration files. The `gameConfig.worldWidth` and `gameConfig.worldHeight` should also mirror these tile dimension values.

After making server-side changes, remember to **re-publish** the module:

```bash
# From the server/ directory
spacetime publish --no-config -p . broth-bullets-local -y
# No need to regenerate client bindings for changing only these constants
```

## 📁 Project Structure

```
vibe-coding-starter-pack-2d-survival/
├── .cursor/                # Cursor AI configuration
│   └── rules/              # *.mdc rule files for AI context
├── agent/                  # NPC AI agent system (TypeScript)
│   ├── src/               # Agent source code
│   │   ├── index.ts       # Agent entry point
│   │   ├── planner.ts     # AI planning logic
│   │   ├── config.ts      # Agent configuration
│   │   └── generated/     # Auto-generated SpacetimeDB bindings
│   └── package.json       # Node.js dependencies
├── auth-server-openauth/   # Authentication server (Node.js/Hono)
│   ├── data/              # User storage (users.json)
│   ├── index.ts           # Main auth server logic
│   └── package.json       # Node.js dependencies
├── tts-backend/            # Kokoro TTS backend (Python/FastAPI)
│   ├── app.py             # FastAPI server for text-to-speech
│   ├── requirements.txt  # Python dependencies
│   └── README.md          # Kokoro setup instructions
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
│   │   ├── engine/        # Runtime engine core (loop, adapters, snapshot store)
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
├── CONTRIBUTING.md       # Contribution guidelines
├── LICENSE               # Apache 2.0 License
├── NOTICE                # IP and attribution notices
├── package.json          # Root package.json with client scripts
├── preview.png           # Gameplay preview image
├── README.md             # This file
├── tsconfig.*.json       # TypeScript configurations
└── vite.config.ts        # Vite build configuration
```

## 🔧 Troubleshooting Local Setup

- `**Cannot find module './generated'` error in client:**
  - Ensure you ran `spacetime generate --lang typescript --out-dir ../client/src/generated -p .` from the `server` directory *after* the last `spacetime publish` was **successful**. Check the publish output for errors.
  - Make sure the `client/src/generated` folder was actually created and contains `.ts` files, including `index.ts`.
  - Restart the Vite dev server (`npm run dev`). Sometimes Vite needs a restart after significant file changes.
- **Client connects but game doesn't load / players don't appear:**
  - Check the browser console (F12) for JavaScript errors (e.g., subscription failures, rendering issues).
  - Check the terminal running `spacetime start` for server-side Rust errors (e.g., reducer panics, assertion failures).
- **Old players/data still appearing after disconnect/refresh:**
  - Verify the `identity_disconnected` logic in `server/src/lib.rs` is correctly deleting the player, inventory, and equipment.
  - For a guaranteed clean slate during development, delete and recreate the local database:
    ```bash
    # Stop spacetime start (Ctrl+C in its terminal)
    spacetime delete broth-bullets-local # Run from any directory
    spacetime start # Restart the server
    # Then re-publish and re-generate (Step 4 above)
    ```
- `**spacetime publish` tries to publish to Maincloud instead of local:**
  - Ensure you are logged out: `spacetime logout`.
  - Ensure the `spacetime start` server is running *before* you publish.
  - Check your SpacetimeDB config file (`%LOCALAPPDATA%/SpacetimeDB/config/cli.toml` on Windows, `~/.local/share/spacetime/config/cli.toml` on Linux/macOS) and make sure `default_server` is set to `local` or commented out.

## 🔄 Development Workflow

1. **Server Development (`server/src`)**:
  - Modify Rust code (add features, fix bugs).
  - **Deploy changes using scripts:**
    ```bash
    cd server/
    ./deploy-local.ps1           # Quick local update
    ./deploy-local-clean.ps1     # Fresh local database (for schema changes)
    ```
2. **Client Development (`client/src`)**:
  - Modify React/TypeScript code.
  - The Vite dev server (`npm run dev`) provides Hot Module Replacement (HMR) for fast updates.

## Runtime Ownership Boundary

- Engine (`client/src/engine/**`) owns frame timing, runtime snapshots, and SpacetimeDB adapter wiring.
- React UI owns rendering widgets, menu/chat panels, and dispatching user intents.
- `GameCanvas` is a render adapter: it consumes runtime state and emits interactions, but it does not directly subscribe to `world_chunk_data`.
- `useEngineSnapshot()` is the preferred way for UI components to read runtime state slices.

## 🚀 Deployment Scripts

The project includes PowerShell scripts in the `server/` directory for streamlined deployment:

### Local Development Scripts

- `**deploy-local.ps1`** - Updates existing local database
  - Publishes to `broth-bullets-local`
  - Seeds SOVA AI config from root `.env`
  - Regenerates client bindings
  - Preserves existing data
- `**deploy-local-clean.ps1**` - Fresh local database deployment
  - Clears and republishes `broth-bullets-local` database
  - Seeds SOVA AI config from root `.env`
  - Regenerates client bindings
  - **⚠️ Wipes all data** - use for schema changes

### Production Scripts

- `**deploy-production.ps1`** - Updates production database
  - Publishes to `broth-bullets` on maincloud
  - Seeds SOVA AI config from root `.env`
  - Regenerates client bindings
  - **Commits from root directory** to capture all changes (server + client)
  - Pushes to trigger Railway deployment
  - Preserves existing data
- `**deploy-production-clean.ps1`** - Fresh production deployment
  - Deletes existing `broth-bullets` database on maincloud
  - Creates fresh database with latest schema
  - Seeds SOVA AI config from root `.env`
  - Regenerates client bindings
  - **Commits from root directory** to capture all changes (server + client)
  - Pushes to trigger Railway deployment
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

**📝 Important Note:** Production scripts automatically navigate to the root directory before committing to ensure all changes (both server and client bindings) are captured in the git commit. This ensures Railway deployments include the latest generated client bindings.

## 🎨 Art Generation Prompts

This section contains the prompts used for generating game assets with AI tools like GPT-4o.

### Item Icons

For generating game item icons (weapons, tools, consumables, etc.):

```
A pixel art style icon with consistent pixel width and clean black outlines, designed as a game item icon. Rendered with a transparent background, PNG format. The object should have a clear silhouette, sharp pixel-level detail, and fit naturally in a top-down RPG game like Secret of Mana. No background, no shadows outside the object. Stylized with a warm palette and light dithering where appropriate.

Subject: SUBJECT, i.e. Rope
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

We welcome contributions that improve correctness, stability, or player experience!

Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for detailed guidelines on:

- What types of contributions are welcome
- How to set up your development environment
- The pull request process
- Code style guidelines
- How to report exploits (privately!)

**Quick Start:**

1. Fork the repository
2. Clone your fork and set up the development environment
3. Create a feature branch (`git checkout -b feature/your-feature-name`)
4. Make your changes and test thoroughly
5. Submit a Pull Request

Whether you're interested in adding new gameplay mechanics, improving existing systems, or enhancing the codebase, your contributions are valuable!

For questions or discussions, feel free to open an issue first or join our [Discord](https://discord.gg/tUcBzfAYfs).

## 📜 License

This project is licensed under the **Apache License 2.0** - see the [LICENSE](./LICENSE) file for details.

The game's assets and IP remain protected, and the official Broth & Bullets servers will continue to be operated by Martin Erlic. For more information see [NOTICE](./NOTICE).

### What you can and cannot do

To avoid any confusion, here is a clear summary of what is allowed and what is not:

**You can:**

- ✅ Read and study the code to better understand how the game works
- ✅ Modify and experiment with the code locally
- ✅ Run your own servers for experimentation and learning
- ✅ Use it as a reference for building your own projects
- ✅ Make a game similar to Broth & Bullets with your own IP (art and themes) using our code as a basis
- ✅ Contribute back to the project via Pull Requests

**You cannot:**

- ❌ Use Broth & Bullets' art, game content, music, or other protected assets
- ❌ Use the "Broth & Bullets" name, branding, or story for commercial purposes
- ❌ Present forks or derivative works as official Broth & Bullets
- ❌ Operate official, unofficial, private, or competing Broth & Bullets servers
- ❌ Use original character designs or hand-crafted assets without permission
- ❌ Do anything that violates the Apache 2.0 license

### Reporting Exploits

We truly appreciate any reporting of in-game exploits. To ensure that exploits are addressed quickly and not abused by other players, we ask that you submit them privately. **Do not** create public issues or share exploit details in Discord.

Contributors who report meaningful, previously unreported, and verified exploits may receive special recognition.

For licensing inquiries regarding Broth & Bullets intellectual property, please contact Martin Erlic.

---

**Created by [SeloSlav](https://x.com/seloslav)**

💬 **Want to chat?** Join the discussion on [Discord](https://discord.gg/tUcBzfAYfs)