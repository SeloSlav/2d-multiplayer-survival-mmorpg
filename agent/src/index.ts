/**
 * Broth & Bullets — NPC Agent Runtime Entry Point
 *
 * This process manages ~20 NPC agents that connect to SpacetimeDB
 * as real clients, register as players, and behave autonomously.
 *
 * Architecture:
 *   - Each NPC has its own SpacetimeDB connection + Identity
 *   - NPCs call the SAME reducers as human players (zero server changes)
 *   - Fast loop (10 Hz): deterministic movement/combat/gather, NO LLM
 *   - Slow loop (~30s): configured OpenAI planner for goal setting
 *   - ElizaOS plugin wraps providers/actions/evaluators
 *
 * Usage:
 *   npm run dev    # Start with hot-reload
 *   npm run start  # Production start
 *
 * Prerequisites:
 *   1. SpacetimeDB server running locally
 *   2. Server module published: spacetime publish --project-path ./server broth-bullets-local
 *   3. Bindings generated: npm run generate
 *   4. OPENAI_API_KEY set for planner LLM calls
 */

import 'dotenv/config';
import { loadConfig } from './config.js';
import { NpcManager } from './npc-manager.js';

async function main(): Promise<void> {
  console.log('=== Broth & Bullets NPC Agent Runtime ===');
  console.log(`Time: ${new Date().toISOString()}`);

  const config = loadConfig();
  console.log(`Config: ${config.npcCount} NPCs, ${config.fastLoopHz} Hz fast loop, ${config.plannerIntervalMs}ms planner`);
  console.log(`SpacetimeDB: ${config.spacetimedbUri} / ${config.spacetimedbModule}`);
  console.log(`LLM Model: ${config.llmModel}`);

  const manager = new NpcManager(config);

  // Graceful shutdown on SIGINT/SIGTERM
  const shutdown = async () => {
    console.log('\nReceived shutdown signal...');
    await manager.shutdown();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Boot all NPC agents (staggered connections)
  await manager.bootAll();

  // Start fast loops and planner loops
  manager.startAll();

  console.log(`\n✓ ${manager.agentCount} NPC agents active. Press Ctrl+C to stop.\n`);

  // Keep the process alive
  await new Promise<void>(() => {});
}

main().catch((err) => {
  console.error('Fatal error in NPC agent runtime:', err);
  process.exit(1);
});
