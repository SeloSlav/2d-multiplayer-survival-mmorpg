/**
 * Planner — slow LLM loop for high-level NPC decision-making.
 *
 * Schedule: ~every 30 seconds per NPC, OR on significant events.
 * Uses the configured OpenAI model via direct API calls.
 *
 * The planner:
 *   1. Receives a compact world-state summary (< 500 tokens)
 *   2. Outputs a strict JSON plan (3–5 steps max)
 *   3. References ONLY known actions
 *   4. No narration, no explanations
 *
 * On invalid JSON, retries up to maxPlannerRetries times.
 */

import { AgentConfig } from './config.js';
import {
  AgentWorldState,
  NpcCharacter,
  Plan,
  PlanStep,
  ActionType,
  Blackboard,
} from './types.js';
import { summarizeForPlanner } from './world-state.js';

const VALID_ACTIONS: Set<ActionType> = new Set([
  'MOVE_TO',
  'ATTACK',
  'GATHER',
  'CRAFT',
  'EQUIP',
  'SAY',
  'IDLE',
  'FLEE',
  'EAT',
  'DRINK',
]);

/**
 * Determine whether the planner should run this tick.
 * Runs on timer OR when significant events are pending.
 */
export function shouldRunPlanner(
  bb: Blackboard,
  worldState: AgentWorldState,
  config: AgentConfig
): boolean {
  const now = Date.now();
  const timeSinceLastRun = now - bb.lastPlannerRunMs;

  // Always run if enough time has passed
  if (timeSinceLastRun >= config.plannerIntervalMs) return true;

  // Run early on significant events
  const hasUrgentEvents = bb.pendingEvents.some(
    (e) =>
      e.type === 'attacked' ||
      e.type === 'low_health' ||
      e.type === 'died' ||
      e.type === 'chat_mention'
  );
  if (hasUrgentEvents && timeSinceLastRun >= 5000) return true;

  // Run if plan is exhausted
  if (!bb.currentPlan || bb.currentStepIndex >= (bb.currentPlan?.plan.length ?? 0)) {
    if (timeSinceLastRun >= 10000) return true;
  }

  return false;
}

/**
 * Call the LLM to produce a plan.
 * Returns a validated Plan or null on failure.
 */
export async function runPlanner(
  worldState: AgentWorldState,
  character: NpcCharacter,
  config: AgentConfig
): Promise<Plan | null> {
  const summary = summarizeForPlanner(worldState);
  const systemPrompt = buildSystemPrompt(character);
  const userPrompt = buildUserPrompt(summary, worldState);

  for (let attempt = 0; attempt <= config.maxPlannerRetries; attempt++) {
    try {
      const raw = await callLLM(systemPrompt, userPrompt, config);
      const plan = parsePlan(raw);
      if (plan) return plan;

      console.warn(
        `[Planner:${character.username}] Invalid plan (attempt ${attempt + 1}): ${raw.slice(0, 200)}`
      );
    } catch (err: any) {
      const msg = err?.cause?.code ?? err?.message ?? String(err);
      // Suppress noisy transient network errors
      if (msg === 'ECONNREFUSED' || msg.includes('ECONNREFUSED')) {
        if (attempt === 0) {
          console.debug(`[Planner:${character.username}] LLM endpoint unavailable, skipping plan cycle.`);
        }
        return null; // Don't retry if proxy is down
      }
      console.error(
        `[Planner:${character.username}] LLM call failed (attempt ${attempt + 1}):`,
        msg
      );
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

function buildSystemPrompt(character: NpcCharacter): string {
  return `You are an AI controlling an NPC in a multiplayer survival game.
Your character: "${character.username}" — a ${character.role}.
Personality: ${character.personality}
Priorities: ${character.priorities.join(', ')}
Preferred resources: ${character.preferredResources.join(', ')}

You must output ONLY a valid JSON object with this schema:
{
  "goal": "<short description of your goal>",
  "plan": [
    { "action": "<ACTION_TYPE>", "args": { ... } }
  ]
}

RULES:
- Max 5 steps per plan.
- Valid actions: MOVE_TO, ATTACK, GATHER, CRAFT, EQUIP, SAY, IDLE, FLEE, EAT, DRINK
- MOVE_TO args: { "x": number, "y": number }
- ATTACK args: { "targetId": string }
- GATHER args: { "nodeId": number }
- CRAFT args: { "recipeId": number }
- EQUIP args: { "itemId": number }
- SAY args: { "message": string } (max 100 chars, in-character)
- FLEE args: {} (flee from nearest threat)
- EAT args: {} (consume food from inventory)
- DRINK args: {} (consume water from inventory)
- IDLE args: {} (wander randomly)
- Only reference entities and resources that appear in the world state.
- If health < 30 and threats exist, FLEE first.
- If hunger < 20 or thirst < 20, prioritize eating/drinking.
- NO narration, NO explanation — ONLY the JSON object.`;
}

function buildUserPrompt(summary: string, worldState: AgentWorldState): string {
  return `Current world state:\n${summary}\n\nWhat is your plan?`;
}

// ---------------------------------------------------------------------------
// LLM call via direct OpenAI API
// ---------------------------------------------------------------------------

async function callLLM(
  systemPrompt: string,
  userPrompt: string,
  config: AgentConfig
): Promise<string> {
  if (!config.openaiApiKey) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  const modelSettings = config.llmModel.startsWith('gpt-6-')
    ? { reasoning_effort: config.llmModel === 'gpt-6-astra' ? 'low' : 'none' }
    : { temperature: 0.7 };

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.openaiApiKey}`,
    },
    body: JSON.stringify({
      model: config.llmModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      ...modelSettings,
      max_completion_tokens: 300,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(15000), // 15s timeout
  });

  if (!response.ok) {
    throw new Error(`OpenAI returned ${response.status}: ${await response.text()}`);
  }

  const data = (await response.json()) as any;

  const content = data.choices?.[0]?.message?.content ?? '';

  if (typeof content !== 'string' || content.length === 0) {
    throw new Error('Empty response from LLM');
  }

  return content;
}

// ---------------------------------------------------------------------------
// Plan parsing + validation
// ---------------------------------------------------------------------------

function parsePlan(raw: string): Plan | null {
  try {
    // Strip markdown code fences if present
    let cleaned = raw.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    }

    const obj = JSON.parse(cleaned);

    // Validate structure
    if (typeof obj.goal !== 'string' || !Array.isArray(obj.plan)) {
      return null;
    }

    // Validate and filter steps
    const validSteps: PlanStep[] = [];
    for (const step of obj.plan) {
      if (
        typeof step.action === 'string' &&
        VALID_ACTIONS.has(step.action as ActionType) &&
        typeof step.args === 'object'
      ) {
        validSteps.push({
          action: step.action as ActionType,
          args: step.args ?? {},
        });
      }
    }

    if (validSteps.length === 0) return null;
    if (validSteps.length > 5) validSteps.length = 5; // Enforce max

    return {
      goal: obj.goal.slice(0, 200),
      plan: validSteps,
    };
  } catch {
    return null;
  }
}
