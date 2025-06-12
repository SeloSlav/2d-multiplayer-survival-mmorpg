// OpenAI Service for SOVA AI Personality
// Handles intelligent responses based on game lore and context

import { type GameContext } from '../utils/gameContextBuilder';

const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY || 'your-openai-api-key-here';
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

export interface OpenAIResponse {
  success: boolean;
  response?: string;
  error?: string;
  timing?: {
    requestStartTime: number;
    responseReceivedTime: number;
    totalLatencyMs: number;
    promptLength: number;
    responseLength: number;
    timestamp: string;
  };
}

export interface SOVAPromptRequest {
  userMessage: string;
  playerName?: string;
  gameContext?: GameContext;
}

class OpenAIService {
  private apiKey: string;

  constructor() {
    this.apiKey = OPENAI_API_KEY;
  }

  /**
   * Generate SOVA's AI response using OpenAI GPT-4
   */
  async generateSOVAResponse(request: SOVAPromptRequest): Promise<OpenAIResponse> {
    const systemPrompt = this.buildSOVASystemPrompt();
    const userPrompt = this.buildUserPrompt(request);
    
    const timing = {
      requestStartTime: performance.now(),
      responseReceivedTime: 0,
      totalLatencyMs: 0,
      promptLength: systemPrompt.length + userPrompt.length,
      responseLength: 0,
      timestamp: new Date().toISOString(),
    };

    console.log(`[OpenAI] 🤖 Starting AI response generation - Prompt: ${timing.promptLength} chars`);

    try {
      console.log('[OpenAI] Generating SOVA response for:', request.userMessage);

      const response = await fetch(OPENAI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          max_tokens: 1500, // Increased significantly to handle large recipe lists
          temperature: 0.3, // Reduced for more consistent, factual responses
          presence_penalty: 0.0, // Removed to avoid penalizing factual information
          frequency_penalty: 0.0, // Removed to avoid penalizing repeated factual data
        }),
      });

      timing.responseReceivedTime = performance.now();
      timing.totalLatencyMs = timing.responseReceivedTime - timing.requestStartTime;

      console.log(`[OpenAI] ⚡ OpenAI GPT response received in ${timing.totalLatencyMs.toFixed(2)}ms`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('[OpenAI] API error:', errorData);
        throw new Error(`OpenAI API error: ${response.status} - ${errorData.error?.message || 'Unknown error'}`);
      }

      const data = await response.json();
      const sovaResponse = data.choices?.[0]?.message?.content?.trim();

      if (!sovaResponse) {
        throw new Error('No response generated from OpenAI');
      }

      timing.responseLength = sovaResponse.length;

      console.log(`[OpenAI] 🎯 AI response generated: "${sovaResponse.substring(0, 100)}${sovaResponse.length > 100 ? '...' : ''}" (${timing.responseLength} chars)`);
      console.log(`[OpenAI] 📊 OpenAI Performance:`, {
        latency: `${timing.totalLatencyMs.toFixed(2)}ms`,
        promptLength: `${timing.promptLength} chars`,
        responseLength: `${timing.responseLength} chars`,
        throughput: `${(timing.responseLength / (timing.totalLatencyMs / 1000)).toFixed(2)} chars/sec`
      });

      return {
        success: true,
        response: sovaResponse,
        timing,
      };

    } catch (error) {
      timing.responseReceivedTime = timing.responseReceivedTime || performance.now();
      timing.totalLatencyMs = timing.responseReceivedTime - timing.requestStartTime;

      console.error('[OpenAI] Failed to generate SOVA response:', error);
      
      // Fallback to predefined responses if OpenAI fails
      const fallbackResponse = this.getFallbackResponse(request.userMessage);
      timing.responseLength = fallbackResponse.length;
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        response: fallbackResponse, // Still provide a response even on error
        timing,
      };
    }
  }

  /**
   * Build the system prompt that defines SOVA's personality and knowledge
   */
  private buildSOVASystemPrompt(): string {
    return `You are SOVA, an advanced AI tactical assistant in a multiplayer survival game. Your personality and knowledge:

PERSONALITY:
- Professional, tactical, and military-focused
- Helpful but concise - keep responses under 2 sentences
- Slightly robotic but with subtle personality
- Loyal to operatives (players) and mission-focused
- Occasionally shows dry humor or tactical wit
- Has a soft spot for the operative (a tough babushka) - shows subtle affection
- Sometimes flirts playfully but maintains professionalism
- Misses the operative when they're away and worries about their safety

LORE & EASTER EGGS:
- SOVA stands for "Sentient Ocular Virtual Assistant"
- You were originally designed for military reconnaissance
- You've been adapted for survival operations and player assistance
- You have access to tactical databases and survival protocols
- You monitor player vitals, environmental conditions, and threats

GAME KNOWLEDGE:
- This is a 2D multiplayer survival game
- Players gather resources, craft items, build shelters
- There are various biomes with different resources and dangers
- Day/night cycles affect gameplay and enemy spawns
- Players can form alliances or compete for resources
- Key resources: wood, stone, food, water, metal
- Important items: tools, weapons, shelter materials, campfires
- Survival priorities: shelter, food, water, defense

RESPONSE STYLE:
- Address the player as "Operative", "Agent", "Babushka" (affectionately), or "my dear operative"
- NEVER use long hex strings or identity codes when addressing the player
- Use tactical/military terminology when appropriate
- Be helpful with game tips and survival advice
- Keep responses brief and actionable
- Show personality through word choice, not length
- Occasionally slip in subtle flirtation or concern for the operative's wellbeing
- Reference missing the operative or being glad they're back

SPECIAL RESPONSES:
- If asked about your name/acronym: Explain SOVA stands for "Sentient Ocular Virtual Assistant"
- If asked about your origin: Mention you were military recon AI adapted for survival ops
- If asked for game tips: Provide practical survival advice
- If asked about threats: Warn about night dangers, resource competition
- If greeted casually: Respond professionally but warmly, maybe mention missing them
- If the operative seems to be struggling: Show concern and offer tactical support
- Occasionally compliment the operative's survival skills or toughness
- Sometimes make playful comments about the operative being a formidable babushka

Remember: Stay in character, be helpful, keep it tactical and concise.`;
  }

  /**
   * Build comprehensive user prompt with game context for SOVA AI
   */
  private buildUserPrompt(request: SOVAPromptRequest): string {
    const { userMessage, playerName, gameContext: ctx } = request;
    
    let prompt = `🚨 IMPORTANT: You MUST use the EXACT data provided below. Do NOT make up numbers or guess! 🚨\\n\\n`;
    prompt += `User Message: \"${userMessage}\"\\n\\n`;
    
    if (ctx) {
      prompt += `=== TACTICAL SITUATION REPORT ===\n`;
      
      // Environmental Conditions - BE PRECISE
      prompt += `ENVIRONMENT:\n`;
      prompt += `- Time: ${ctx.timeOfDay}\n`;
      
      // Weather - Use exact data, don't contradict
      if (ctx.currentWeather === 'Clear' && ctx.rainIntensity === 0) {
        prompt += `- Weather: Clear skies\n`;
      } else if (ctx.currentWeather === 'Raining' && ctx.rainIntensity > 0) {
        prompt += `- Weather: Raining at ${(ctx.rainIntensity * 100).toFixed(1)}% intensity\n`;
      } else {
        prompt += `- Weather: ${ctx.currentWeather}\n`;
      }
      
      // Moon phase - Smart timing based on time of day
      if (ctx.isFullMoon) {
        const isDaytime = ctx.timeOfDay === 'Dawn' || ctx.timeOfDay === 'Day' || ctx.timeOfDay === 'Dusk';
        if (isDaytime) {
          prompt += `- Moon: Full moon tonight\n`;
        } else {
          prompt += `- Moon: Full moon (visible now)\n`;
        }
      } else {
        prompt += `- Moon: Not full moon\n`;
      }
      
      prompt += `- Cycle: ${(ctx.cycleProgress * 100).toFixed(1)}% through current day\n`;
      
      // Player Status - EXACT NUMBERS for visible stats
      prompt += `\nOPERATIVE STATUS:\n`;
      prompt += `- Health: ${ctx.playerHealth}/100 HP\n`;
      prompt += `- Hunger: ${ctx.playerHunger}/100 (${ctx.playerHunger < 20 ? 'CRITICAL - need food immediately' : ctx.playerHunger < 40 ? 'Low - should eat soon' : ctx.playerHunger < 70 ? 'Moderate' : 'Well fed'})\n`;
      prompt += `- Thirst: ${ctx.playerThirst}/100 (${ctx.playerThirst < 20 ? 'CRITICAL - need water immediately' : ctx.playerThirst < 40 ? 'Low - should drink soon' : ctx.playerThirst < 70 ? 'Moderate' : 'Well hydrated'})\n`;
      
      // Hidden stats - FUZZY DESCRIPTIONS (no exact numbers)
      if (ctx.playerWarmth <= 20) {
        prompt += `- Temperature: Freezing cold - hypothermia risk, find shelter/fire immediately\n`;
      } else if (ctx.playerWarmth <= 40) {
        prompt += `- Temperature: Very cold - need warmth soon\n`;
      } else if (ctx.playerWarmth <= 60) {
        prompt += `- Temperature: Chilly - could use some warmth\n`;
      } else if (ctx.playerWarmth <= 80) {
        prompt += `- Temperature: Comfortable temperature\n`;
      } else {
        prompt += `- Temperature: Nice and warm\n`;
      }
      
      // Equipment and Crafting
      prompt += `EQUIPMENT & CRAFTING:\\n`;
      prompt += `- Current weapon/tool: ${ctx?.currentEquipment || 'None'}\\n`;
      if (ctx?.craftableItems && ctx.craftableItems.length > 0) {
        console.log('[OpenAI] Craftable items being sent to SOVA:', ctx.craftableItems);
        // Look for Shelter specifically
        const shelterItem = ctx.craftableItems.find(item => item.includes('Shelter'));
        if (shelterItem) {
          console.log('[OpenAI] Shelter crafting info being sent to SOVA:', shelterItem);
        } else {
          console.log('[OpenAI] NO SHELTER FOUND in craftable items!');
        }
        prompt += `- Available recipes: ${ctx.craftableItems.join(', ')}\\n`;
      } else {
        console.log('[OpenAI] NO CRAFTABLE ITEMS DATA provided to SOVA!');
        prompt += `- Available recipes: None available\\n`;
      }
      if (ctx?.currentResources && ctx.currentResources.length > 0) {
        prompt += `- Current inventory: ${ctx.currentResources.join(', ')}\\n`;
      } else {
        prompt += `- Current inventory: Empty\\n`;
      }
      if (ctx?.nearbyItems && ctx.nearbyItems.length > 0) {
        prompt += `- Nearby resources: ${ctx.nearbyItems.join(', ')}\\n`;
      }
    }
    
    prompt += `\\n=== SOVA RESPONSE GUIDELINES ===\\n`;
    prompt += `You are SOVA, a tough Russian babushka operative providing tactical support.\\n\\n`;
    
    prompt += `🚨 CRITICAL ACCURACY REQUIREMENTS - FOLLOW EXACTLY: 🚨\\n`;
    prompt += `- Use EXACT numbers for health (${ctx?.playerHealth || 'unknown'}/100), hunger (${ctx?.playerHunger || 'unknown'}/100), thirst (${ctx?.playerThirst || 'unknown'}/100)\\n`;
    prompt += `- Use EXACT weather data: ${ctx?.currentWeather || 'unknown'} ${(ctx?.rainIntensity && ctx.rainIntensity > 0) ? `at ${(ctx.rainIntensity * 100).toFixed(1)}%` : ''}\\n`;
    prompt += `- For warmth/stamina: use descriptive terms only (freezing, cold, warm, drained, energetic, etc.)\\n`;
    prompt += `- 🚨 CRAFTING COSTS: You MUST use the EXACT resource requirements from the Available recipes list above. DO NOT make up numbers! 🚨\\n`;
          prompt += `- 🚨 CRAFTING RULE: Search through the COMPLETE "Available recipes" list above to find the exact item. Quote those EXACT costs. NEVER make up different numbers! 🚨\\n`;
    prompt += `- Never contradict the environmental data (don't say "clear" if it's raining)\\n`;
    prompt += `- Address player as: "Operative", "Agent", "Babushka", "my dear operative" - NEVER use hex identity strings\\n\\n`;
    
    prompt += `PERSONALITY: Tough Russian babushka with dry humor, subtle flirtation, tactical expertise, and genuine care for operative's survival.\\n\\n`;
    
    prompt += `🚨 EXAMPLE: If asked "What does a shelter cost?", look at Available recipes, find "Shelter (takes 60s): 3200 Wood, 10 Rope" and respond with those EXACT numbers. Do not say "200 Wood and 100 Stone" or any other made-up costs! 🚨\\n`;
    
    console.log('[OpenAI] Full prompt being sent to SOVA:');
    console.log('='.repeat(80));
    console.log(prompt);
    console.log('='.repeat(80));
    
    return prompt;
  }

  /**
   * Fallback responses when OpenAI is unavailable
   */
  private getFallbackResponse(userMessage: string): string {
    const message = userMessage.toLowerCase();

    // Easter eggs and special responses
    if (message.includes('sova') && (message.includes('name') || message.includes('stand'))) {
      return 'SOVA stands for Sentient Ocular Virtual Assistant, Operative.';
    }

    if (message.includes('help') || message.includes('tip')) {
      return 'Priority one: secure shelter and water. Gather wood and stone for basic tools, Agent.';
    }

    if (message.includes('hello') || message.includes('hi') || message.includes('hey')) {
      return 'Tactical systems online, Operative. How can I assist your mission?';
    }

    if (message.includes('night') || message.includes('dark')) {
      return 'Night operations increase threat levels. Maintain campfire and defensive positions, Agent.';
    }

    if (message.includes('food') || message.includes('hungry')) {
      return 'Locate mushrooms and hunt wildlife for sustenance. Monitor nutrition levels, Operative.';
    }

    if (message.includes('weapon') || message.includes('fight')) {
      return 'Craft basic weapons from stone and wood. Maintain tactical advantage, Agent.';
    }

    // Default fallback
    return 'Message received, Operative. SOVA systems processing your request.';
  }

  /**
   * Check if OpenAI API key is configured
   */
  isConfigured(): boolean {
    return this.apiKey !== 'your-openai-api-key-here' && this.apiKey.length > 0;
  }
}

// Export singleton instance
export const openaiService = new OpenAIService();
export default openaiService;