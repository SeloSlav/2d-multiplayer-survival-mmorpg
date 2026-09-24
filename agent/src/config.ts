/**
 * Agent runtime configuration.
 * Loaded from environment variables with sensible defaults.
 */

export interface AgentConfig {
  /** SpacetimeDB WebSocket URI */
  spacetimedbUri: string;
  /** SpacetimeDB module (database) name */
  spacetimedbModule: string;
  /** OpenAI API key for planner calls */
  openaiApiKey: string;
  /** Number of NPC agents to spawn */
  npcCount: number;
  /** Planner (slow) loop interval in ms. Each NPC runs ± 20% jitter. */
  plannerIntervalMs: number;
  /** Fast loop tick rate in Hz (ticks per second) */
  fastLoopHz: number;
  /** LLM model to use */
  llmModel: string;
  /** Max planner retries on invalid JSON */
  maxPlannerRetries: number;
  /** Directory for persisting NPC auth tokens */
  tokenDir: string;
}

export function loadConfig(): AgentConfig {
  const openaiApiKey = process.env.OPENAI_API_KEY ?? '';
  if (!openaiApiKey) {
    console.warn('[AgentConfig] OPENAI_API_KEY is not set. Planner will be disabled.');
  }

  return {
    spacetimedbUri: process.env.SPACETIMEDB_URI ?? 'ws://localhost:3000',
    spacetimedbModule: process.env.SPACETIMEDB_MODULE ?? 'broth-bullets-local',
    openaiApiKey,
    npcCount: parseInt(process.env.NPC_COUNT ?? '20', 10),
    plannerIntervalMs: parseInt(process.env.PLANNER_INTERVAL_MS ?? '30000', 10),
    fastLoopHz: parseInt(process.env.FAST_LOOP_HZ ?? '10', 10),
    llmModel: process.env.LLM_MODEL ?? 'gpt-6-luna',
    maxPlannerRetries: 2,
    tokenDir: process.env.TOKEN_DIR ?? './.npc-tokens',
  };
}
