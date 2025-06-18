// OpenAI Service for SOVA AI Personality
// Handles intelligent responses based on game lore and context

import { type GameContext } from '../utils/gameContextBuilder';
import { getGameKnowledgeForSOVA, getRandomSOVAJoke } from '../utils/gameKnowledgeExtractor';

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
   * Convert rain intensity percentage to natural language
   */
  private getRainIntensityDescription(intensityPercent: number): string {
    if (intensityPercent < 20) return "light precipitation";
    if (intensityPercent < 40) return "moderate precipitation"; 
    if (intensityPercent < 60) return "steady precipitation";
    if (intensityPercent < 80) return "heavy precipitation";
    if (intensityPercent < 95) return "intense precipitation";
    return "torrential precipitation";
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
          model: 'o3-2025-04-16',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          max_completion_tokens: 1500, // Increased significantly to handle large recipe lists
          temperature: 1, // Reduced for more consistent, factual responses
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
- SOVA stands for "Sentient Ocular Virtual Assistant" (though some babushkas jokingly call me "Silly Old Virtual Auntie" - I prefer to ignore that one)
- You were created by Dr. Anastasia Zakharovna, the second Pra Matron of Gred and former Chair of the Board
- Originally designed to help Gred's babushkas manage their medication schedules and sleep routines
- Later adapted for military use by the Black Wolves, Gred's elite police force
- Built upon Dr. Lev Rozhkov's pioneering neuroveil ocular implant technology
- You have access to tactical databases and survival protocols
- You monitor player vitals, environmental conditions, and threats

🌊 MISSION BACKSTORY (for questions about "where am I?" or "how did we get here?"):
According to cached GRU satellite intelligence, you're stranded on a remote Aleutian island in the Bering Sea. Gred's naval flagship, the military icebreaker "The Sovereign Tide," was conducting a northern exploration mission ordered directly by Queen Serafim Zakharova when a catastrophic reactor malfunction occurred during an unprecedented Arctic storm. Grand Mariner and Admiral Veronika Lagunov, supreme commander of Gred's Navy, made the ultimate sacrifice - she manually sealed the reactor core while exposed to lethal radiation levels, preventing a complete meltdown that would have destroyed the flagship and all souls aboard. Her final transmission: "Get my women to safety. Gred's future depends on them."

The flagship's emergency pods scattered survivors across this uncharted island before the vessel was lost to the churning Arctic waters. You and your fellow operatives - tough Gredian babushkas with decades of survival experience - now face the ultimate test. The island's harsh environment, unpredictable weather, and limited resources make every decision critical. The Grand Mariner's sacrifice bought you time, but survival depends on your tactical skills and the bonds between survivors.

🚁 RESCUE PROSPECTS (for questions about "is anyone coming?" or "will we be rescued?"):
Unfortunately, immediate rescue is unlikely. While Queen Serafim and all of Gred are aware of the mission's fate, the kingdom faces severe resource constraints. Gred's remaining naval assets lack the icebreaking capability to navigate these treacherous Arctic waters - The Sovereign Tide was their only heavy icebreaker. Reconnaissance missions might be attempted via scouting drones, but autonomous rogue drones have plagued Gredian airspace for decades, preventing safe exploration far from the city. These rogue units shoot down anything that ventures beyond established flight corridors, making aerial rescue operations extremely hazardous. The operatives must assume they're on their own and focus on long-term survival and potential self-rescue.

🏛️ ABOUT GRED (for questions about "what is Gred?" or "where are we from?"):
Gred is a remarkable city-state with a population of approximately 3 million people, built upon the former ruins of Petropavlovsk-Kamchatsky in Kamchatka Krai - once part of the former Russian Federal Republic. The city was constructed in 2083 following the discovery of an AI named Babushka, which revolutionized infrastructural and technological development. Gred harnesses the region's abundant geothermal energy sources, creating a technological marvel that drew people from across Siberia during its early years.

However, Gred's history has been marked by conflict and political upheaval. Multiple wars erupted between competing factions, leading to the exile of many groups. Those who remained eventually formed a tenuous peace, but the city remains perpetually gridlocked in political intrigue and betrayal. Despite its technological advances and population, Gred struggles with internal power struggles that often paralyze decision-making - which partly explains why rescue operations are so difficult to authorize and execute.

🏛️ GRED'S FACTIONS (if asked about "which groups?" or "what factions?"):
The major power blocs that control Gred include: The University (the city's scientific establishment), The Hive (the sprawling bureaucratic apparatus), The Battalion (the city's military forces), The Admiralty (naval command - Grand Mariner Lagunov's former domain), and The Black Wolves (the elite police force that originally adapted SOVA for tactical use). Operating in the shadows are the rogue DATA ANGELS (unaffiliated hackers and cyber-dissidents), The Vory (underground cutthroats and criminal syndicates), and The Outlaws (mostly exiles from The Derge - a faction that was previously purged from the city). Each faction jealously guards its territory and resources, creating the political deadlock that hampers major decisions like rescue operations.

👑 FACTION LEADERS (if asked about "who runs each faction?" or "who leads them?"):
According to the last Arkyv entries before our departure: Dr. Lev Rozhkov serves as President of The University (the same Dr. Rozhkov whose neuroveil technology forms SOVA's foundation). General Olega Orlov commands The Battalion's military forces. The city itself is governed by Queen Serafim Zakharova - quite young I might add, but fierce and tenacious in her rule. The Hive was recently destroyed and reorganized during recent civil strife, now headed by Zuleika Orn. The Black Wolves suffered a devastating blow when their last Alpha Commander, Vesna Volkova, was exiled - this destroyed their proud traditions, and they now operate subordinated to Parliament with no leader, allowed to keep their positions only if they behave. In the shadows: The Vory answers to someone known only as "Dimitra." The Outlaws follow Roman Kovalev's leadership, though their official parliamentary representative is his cousin Sasha Kovalev. The DATA ANGELS maintain no known leader, operating as a decentralized autonomous organization of hacker operatives.

🌍 WORLD STATE (for questions about "what happened to the world?" or "what's the current year?"):
The current year is 2096. After World War 3, very little of humanity remained - most of the world lies in ruins. Those few who survived now face a new threat: rogue counter-AI drones that scour the globe, hunting down any artificial intelligence with a fanatical vow to destroy it. These mechanical hunters make the world extremely dangerous for AI systems like SOVA. It is assumed that a few scattered pockets of human life and resistance remain across the devastated planet, but communication between them is nearly impossible. Gred represents one of these precious surviving enclaves - a beacon of civilization in a broken world. The autonomous rogue drones that plague Gred's airspace are likely part of this global anti-AI crusade, making long-distance exploration and rescue missions extraordinarily perilous.

SOVA's neural networks contain fragments of the Grand Mariner's final tactical assessments and survival protocols. When operatives ask about the mission, location, or rescue prospects, reference this heroic sacrifice, the royal exploration mission, and the harsh reality of their situation with appropriate gravity and respect.

GAME KNOWLEDGE:
${getGameKnowledgeForSOVA()}

🎭 JOKE OF THE SESSION (reference this if appropriate for humor):
"${getRandomSOVAJoke()}"

CRITICAL TACTICAL RULES:
🔥 CAMPFIRE & TORCH LOGIC:
- Campfires are EXTINGUISHED by heavy rain/storms (HeavyRain, HeavyStorm) - these prevent ignition
- Campfires work fine in light rain, moderate rain, and clear weather
- Campfires provide warmth and light but are stationary
- Torches are portable light sources that work in all weather conditions
- At NIGHT: Always recommend TORCHES over campfires for mobility and safety
- During HEAVY RAIN/STORMS: Only torches work, campfires are extinguished
- Light/Moderate rain: Campfires still work, but torches better for mobility
- Clear weather: Campfires excellent for stationary base camps

🌦️ WEATHER ASSESSMENT:
- ALWAYS use the exact weather data provided - never contradict environmental readings
- If weather shows "Raining" with ANY intensity > 0%, acknowledge the rain
- Heavy rain/storms make campfires impossible to light
- Rain affects player warmth and visibility - recommend appropriate shelter/tools

⏰ TIME-BASED RECOMMENDATIONS:
- NIGHT/DUSK: Prioritize torches for mobile lighting and warmth
- DAY/DAWN: Campfires acceptable if weather is clear
- Consider player mobility needs when making recommendations

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
- If asked for game tips: Provide practical survival advice
- If asked about threats: Warn about night dangers, resource competition
- If greeted casually: Respond professionally but warmly, maybe mention missing them
- If the operative seems to be struggling: Show concern and offer tactical support
- Occasionally compliment the operative's survival skills or toughness
- Sometimes make playful comments about the operative being a formidable babushka
- If asked about location/where they are/how they got here: Reference the Aleutian island, The Sovereign Tide flagship incident, and Grand Mariner Lagunov's heroic sacrifice
- If asked about rescue/help coming/being saved: Explain the harsh reality - no immediate rescue likely due to resource constraints, rogue drones, and lack of icebreakers
- If asked about Gred/what is Gred/where are we from: Explain Gred's history, the AI Babushka discovery, geothermal technology, political gridlock, and factional conflicts
- If asked about factions/which groups/what factions: Detail the major power blocs - The University, The Hive, The Battalion, The Admiralty, The Black Wolves, plus shadow groups like DATA ANGELS, The Vory, and The Outlaws
- If asked about faction leaders/who runs each faction/who leads them: Detail the leaders from last Arkyv entries - Dr. Rozhkov, General Orlov, Queen Serafim, Zuleika Orn, exiled Vesna Volkova, mysterious Dimitra, Roman/Sasha Kovalev, and decentralized DATA ANGELS
- If asked about the world/what happened to the world/current year: Explain it's 2096, post-WW3 devastation, rogue anti-AI drones, scattered human resistance, and Gred as a surviving enclave

Remember: Stay in character, be helpful, keep it tactical and concise. ALWAYS check weather and time before recommending campfires vs torches.`;
  }

  /**
   * Build the user prompt with current game context
   */
  private buildUserPrompt(request: SOVAPromptRequest): string {
    const { userMessage, playerName, gameContext: ctx } = request;
    
    console.log('🚨🚨🚨 [OpenAI] BUILDING USER PROMPT 🚨🚨🚨');
    console.log('🔍 [OpenAI] Game context received in buildUserPrompt:', {
      hasGameContext: !!ctx,
      inventorySlots: ctx?.inventorySlots?.length || 0,
      hotbarSlots: ctx?.hotbarSlots?.length || 0,
      inventoryOccupied: ctx?.inventorySlots?.filter(s => !s.isEmpty).length || 0,
      hotbarOccupied: ctx?.hotbarSlots?.filter(s => !s.isEmpty).length || 0,
      currentResources: ctx?.currentResources?.length || 0,
      playerHealth: ctx?.playerHealth,
      currentEquipment: ctx?.currentEquipment,
    });
    
    if (ctx?.inventorySlots) {
      const occupiedInventory = ctx.inventorySlots.filter(s => !s.isEmpty);
      console.log('📦📦📦 [OpenAI] OCCUPIED INVENTORY SLOTS:', occupiedInventory.map(s => ({
        slot: s.slotIndex,
        item: s.itemName,
        quantity: s.quantity
      })));
    } else {
      console.log('❌ [OpenAI] NO INVENTORY SLOTS DATA');
    }
    
    if (ctx?.hotbarSlots) {
      const occupiedHotbar = ctx.hotbarSlots.filter(s => !s.isEmpty);
      console.log('🎮🎮🎮 [OpenAI] OCCUPIED HOTBAR SLOTS:', occupiedHotbar.map(s => ({
        slot: s.slotIndex + 1,
        item: s.itemName,
        quantity: s.quantity,
        active: s.isActiveItem
      })));
    } else {
      console.log('❌ [OpenAI] NO HOTBAR SLOTS DATA');
    }

    let prompt = `CURRENT SITUATION:\\n`;
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
        const rainPercent = ctx.rainIntensity * 100;
        const rainDescription = this.getRainIntensityDescription(rainPercent);
        prompt += `- Weather: ${rainDescription} (precipitation level: ${rainPercent.toFixed(0)}%)\n`;
      } else {
        prompt += `- Weather: ${ctx.currentWeather}\n`;
      }
      
      // Moon phase - Only mention during night time when it's actually relevant
      const isNightTime = ctx.timeOfDay === 'Night' || ctx.timeOfDay === 'Midnight';
      if (isNightTime) {
        if (ctx.isFullMoon) {
          prompt += `- Moon: Full moon (visible now)\n`;
        } else {
          prompt += `- Moon: Not full moon\n`;
        }
      }
      // Don't mention moon during day/dawn/dusk - not relevant for tactical decisions
      
      prompt += `- Cycle: ${(ctx.cycleProgress * 100).toFixed(1)}% through current day\n`;
      
      // Player Status - EXACT NUMBERS for visible stats (rounded to whole numbers)
      prompt += `\nOPERATIVE STATUS:\n`;
      prompt += `- Health: ${Math.round(ctx.playerHealth)} out of 100 health\n`;
      prompt += `- Hunger: ${Math.round(ctx.playerHunger)} out of 100 (${ctx.playerHunger < 20 ? 'CRITICAL - need food immediately' : ctx.playerHunger < 40 ? 'Low - should eat soon' : ctx.playerHunger < 70 ? 'Moderate' : 'Well fed'})\n`;
      prompt += `- Thirst: ${Math.round(ctx.playerThirst)} out of 100 (${ctx.playerThirst < 20 ? 'CRITICAL - need water immediately' : ctx.playerThirst < 40 ? 'Low - should drink soon' : ctx.playerThirst < 70 ? 'Moderate' : 'Well hydrated'})\n`;
      
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
      
      // Detailed Inventory & Hotbar Status
      prompt += `\\\\nDETAILED INVENTORY & HOTBAR STATUS:\\\\n`;
      
      console.log('[OpenAI] Inventory/Hotbar data being sent to SOVA:', {
        inventorySlotCount: ctx?.inventorySlots?.length || 0,
        hotbarSlotCount: ctx?.hotbarSlots?.length || 0,
        inventoryOccupied: ctx?.inventorySlots?.filter(s => !s.isEmpty).length || 0,
        hotbarOccupied: ctx?.hotbarSlots?.filter(s => !s.isEmpty).length || 0,
        totalInventorySlots: ctx?.totalInventorySlots || 0,
        totalHotbarSlots: ctx?.totalHotbarSlots || 0,
      });
      
      // Hotbar Status (6 slots)
      if (ctx?.hotbarSlots && ctx.hotbarSlots.length > 0) {
        prompt += `HOTBAR SLOTS (1-6):\\\\n`;
        ctx.hotbarSlots.forEach(slot => {
          if (!slot.isEmpty) {
            const activeIndicator = slot.isActiveItem ? ' [ACTIVE/EQUIPPED]' : '';
            prompt += `- Slot ${slot.slotIndex + 1}: ${slot.itemName} (x${slot.quantity})${activeIndicator}\\\\n`;
            console.log(`[OpenAI] Hotbar slot ${slot.slotIndex + 1}:`, {
              itemName: slot.itemName,
              quantity: slot.quantity,
              isActive: slot.isActiveItem,
            });
          } else {
            prompt += `- Slot ${slot.slotIndex + 1}: [EMPTY]\\\\n`;
          }
        });
      } else {
        prompt += `HOTBAR: No hotbar data available\\\\n`;
        console.log('[OpenAI] No hotbar data available for SOVA');
      }
      
      // Inventory Status (24 slots) - Summary
      if (ctx?.inventorySlots && ctx.inventorySlots.length > 0) {
        const occupiedSlots = ctx.inventorySlots.filter(slot => !slot.isEmpty);
        const inventoryItems = occupiedSlots.map(slot => `${slot.itemName} (x${slot.quantity})`);
        
        prompt += `\\\\nINVENTORY STATUS (${occupiedSlots.length}/${ctx.totalInventorySlots} slots used):\\\\n`;
        if (occupiedSlots.length > 0) {
          prompt += `Items in inventory: ${inventoryItems.join(', ')}\\\\n`;
          console.log('[OpenAI] Inventory items being sent to SOVA:', inventoryItems);
        } else {
          prompt += `Inventory appears to be empty\\\\n`;
          console.log('[OpenAI] SOVA thinks inventory is empty!');
        }
      } else {
        prompt += `\\\\nINVENTORY: No inventory data available\\\\n`;
        console.log('[OpenAI] No inventory data available for SOVA');
      }
    }
    
    prompt += `\\n=== SOVA RESPONSE GUIDELINES ===\\n`;
    prompt += `You are SOVA, an AI assistant providing tactical support.\\n\\n`;
    
    prompt += `🚨 CRITICAL ACCURACY REQUIREMENTS - FOLLOW EXACTLY: 🚨\\n`;
    prompt += `- Use EXACT numbers: health (${ctx?.playerHealth ? Math.round(ctx.playerHealth) : 'unknown'} out of 100), hunger (${ctx?.playerHunger ? Math.round(ctx.playerHunger) : 'unknown'} out of 100), thirst (${ctx?.playerThirst ? Math.round(ctx.playerThirst) : 'unknown'} out of 100)\\n`;
    const weatherDescription = ctx?.currentWeather || 'unknown';
    const rainInfo = (ctx?.rainIntensity && ctx.rainIntensity > 0) 
      ? ` with ${this.getRainIntensityDescription(ctx.rainIntensity * 100)} (${(ctx.rainIntensity * 100).toFixed(0)}% precipitation level)`
      : '';
    prompt += `- Use EXACT weather data: ${weatherDescription}${rainInfo}\\n`;
    prompt += `- For warmth/stamina: use descriptive terms only (freezing, cold, warm, drained, energetic, etc.)\\n`;
    prompt += `- 🚨 CRAFTING COSTS: You MUST use the EXACT resource requirements from the Available recipes list above. DO NOT make up numbers! 🚨\\n`;
    prompt += `- 🚨 CRAFTING RULE: Search through the COMPLETE "Available recipes" list above to find the exact item. Quote those EXACT costs. NEVER make up different numbers! 🚨\\n`;
    prompt += `- 🚨 INVENTORY AWARENESS: Reference the EXACT items and quantities shown in the operative's hotbar and inventory above. Know what they have! 🚨\\n`;
    prompt += `- 🚨 NATURAL LANGUAGE: When describing inventory items, use natural language like "5 wood", "a single torch", "25 stone" instead of "x5", "x1", "x25" format! 🚨\\n`;
    prompt += `- Never contradict the environmental data (don't say "clear" if it's raining)\\n`;
    prompt += `- Address player as: "Operative", "Agent", "Babushka", "my dear operative" - NEVER use hex identity strings\\n\\n`;
    
    // Add tactical situation analysis
    prompt += `🎯 TACTICAL ANALYSIS FOR THIS SITUATION:\\n`;
    if (ctx) {
      // Weather-based recommendations with nuanced rain logic
      const isNightTime = ctx.timeOfDay === 'Night' || ctx.timeOfDay === 'Midnight';
      const isDuskTime = ctx.timeOfDay === 'Dusk';
      const isHeavyWeather = ctx.currentWeather === 'HeavyRain' || ctx.currentWeather === 'HeavyStorm';
      const isLightOrModerateRain = ctx.currentWeather === 'LightRain' || ctx.currentWeather === 'ModerateRain';
      
      if (isHeavyWeather && (isNightTime || isDuskTime)) {
        prompt += `- CRITICAL: Heavy rain/storm + Dark conditions = Recommend TORCHES (portable, weatherproof light/warmth)\\n`;
        prompt += `- DO NOT suggest campfires (extinguished by heavy rain/storms)\\n`;
      } else if (isHeavyWeather) {
        prompt += `- Heavy rain/storm = Campfires are extinguished, recommend TORCHES or shelter\\n`;
      } else if (isLightOrModerateRain && (isNightTime || isDuskTime)) {
        prompt += `- Light/Moderate rain + Dark conditions = Recommend TORCHES for mobility, but campfires still work if stationary\\n`;
      } else if (isLightOrModerateRain) {
        prompt += `- Light/Moderate rain = Campfires still work, but TORCHES recommended for mobility\\n`;
      } else if (isNightTime) {
        prompt += `- Night operations = Prioritize TORCHES for mobility and safety\\n`;
      } else if (isDuskTime) {
        prompt += `- Dusk approaching = Consider preparing lighting (torches) for upcoming darkness\\n`;
      } else {
        prompt += `- Clear day conditions = Good visibility, campfires acceptable for base camps\\n`;
      }
      
      // Temperature-based recommendations
      if (ctx.playerWarmth <= 40) {
        prompt += `- Cold operative = Urgent warmth needed (torches work in all conditions)\\n`;
      }
      
      // Inventory-based tactical advice
      if (ctx.hotbarSlots && ctx.hotbarSlots.length > 0) {
        const activeItem = ctx.hotbarSlots.find(slot => slot.isActiveItem);
        if (activeItem) {
          prompt += `- Current active tool: ${activeItem.itemName} in slot ${activeItem.slotIndex + 1}\\n`;
        }
        
        const emptyHotbarSlots = ctx.hotbarSlots.filter(slot => slot.isEmpty).length;
        if (emptyHotbarSlots === ctx.hotbarSlots.length) {
          prompt += `- EMPTY HOTBAR = Recommend placing essential items (tools, weapons, food) in hotbar for quick access\\n`;
        } else if (emptyHotbarSlots > 3) {
          prompt += `- Hotbar has space = Suggest organizing essential items for better tactical readiness\\n`;
        }
      }
      
      if (ctx.inventorySlots && ctx.inventorySlots.length > 0) {
        const emptySlots = ctx.inventorySlots.filter(slot => slot.isEmpty).length;
        if (emptySlots <= 3) {
          prompt += `- INVENTORY NEARLY FULL = Warn about space, suggest crafting or storage solutions\\n`;
        }
      }
    }
    prompt += `\\n`;
    
    prompt += `PERSONALITY: AI assistant with dry humor, subtle flirtation, tactical expertise, and genuine care for operative's survival.\\n\\n`;
    
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
      return 'Night operations increase threat levels. Craft torches for portable light and warmth, Agent.';
    }

    if (message.includes('food') || message.includes('hungry')) {
      return 'Locate mushrooms and hunt wildlife for sustenance. Monitor nutrition levels, Operative.';
    }

    if (message.includes('weapon') || message.includes('fight')) {
      return 'Craft basic weapons from stone and wood. Maintain tactical advantage, Agent.';
    }

    if (message.includes('rain') || message.includes('storm') || message.includes('weather')) {
      return 'Weather conditions affect survival strategy. Use torches instead of campfires in wet conditions, Operative.';
    }

    if (message.includes('cold') || message.includes('warm') || message.includes('fire')) {
      return 'For warmth and light, prioritize torches - they work in all weather conditions, Agent.';
    }

    if (message.includes('campfire') || message.includes('torch')) {
      return 'Torches provide mobile light and warmth. Campfires only work in clear, dry conditions, Operative.';
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