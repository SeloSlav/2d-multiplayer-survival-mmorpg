# 🤖 SOVA AI Setup Guide

This guide explains how to set up OpenAI integration to give SOVA an intelligent personality.

## 🔑 Getting Your OpenAI API Key

1. **Sign up for OpenAI:**
   - Go to [https://platform.openai.com/](https://platform.openai.com/)
   - Create an account or sign in

2. **Generate API Key:**
   - Navigate to [API Keys](https://platform.openai.com/api-keys)
   - Click "Create new secret key"
   - Copy the key (starts with `sk-...`)

3. **Add Billing Information:**
   - Go to [Billing](https://platform.openai.com/account/billing)
   - Add a payment method
   - Set usage limits if desired

## ⚙️ Configuration

### **Option A: Environment Variable (Recommended)**
1. **Create environment file:**
   - Create a `.env` file in the `client/` directory:
   ```bash
   # client/.env
   OPENAI_API_KEY=sk-your-actual-api-key-here
   ```

2. **The service automatically uses the environment variable:**
   ```typescript
   const OPENAI_API_KEY = import.meta.env.OPENAI_API_KEY || 'your-openai-api-key-here';
   ```

### **Option B: Direct Configuration (Not Recommended)**
   - Open `client/src/services/openaiService.ts`
   - Replace `'your-openai-api-key-here'` with your actual API key
   - **Note:** This exposes your API key in source code

## 🎮 SOVA's Personality Features

### 🎯 **Core Personality:**
- **Professional & Tactical:** Military-focused AI assistant
- **Helpful:** Provides game tips and survival advice
- **Concise:** Keeps responses under 2 sentences
- **Loyal:** Addresses players as "Operative" or "Agent"

### 🎪 **Easter Eggs & Special Responses:**

**Ask about SOVA's name:**
- *"What does SOVA stand for?"*
- *"What's your name mean?"*
- **Response:** *"SOVA stands for Sentient Ocular Virtual Assistant, Operative."*

**Ask for help:**
- *"Can you help me?"*
- *"Give me some tips"*
- **Response:** *"Priority one: secure shelter and water. Gather wood and stone for basic tools, Agent."*

**Greetings:**
- *"Hello SOVA"*
- *"Hi there"*
- **Response:** *"Tactical systems online, Operative. How can I assist your mission?"*

**Game-specific questions:**
- *"What should I do at night?"*
- *"I need food"*
- *"How do I fight?"*

### 🎯 **Game Knowledge:**
- 2D multiplayer survival mechanics
- Resource gathering (wood, stone, food, water)
- Day/night cycle dangers
- Crafting and building systems
- Tactical survival advice

## 🔧 Fallback System

If OpenAI is unavailable or not configured:
- SOVA automatically uses predefined responses
- Still includes easter eggs and basic game tips
- No interruption to gameplay experience

## 💰 Cost Considerations

**GPT-4o Pricing (as of 2024):**
- Input: ~$5 per 1M tokens
- Output: ~$15 per 1M tokens
- Average SOVA response: ~100-200 tokens
- **Estimated cost:** $0.002-0.003 per response

**Usage Tips:**
- Set billing limits in OpenAI dashboard
- Monitor usage in OpenAI account
- Consider using GPT-3.5-turbo for lower costs (change model in `openaiService.ts`)

## 🛠️ Customization

### **Modify SOVA's Personality:**
Edit the system prompt in `openaiService.ts` → `buildSOVASystemPrompt()`

### **Add More Easter Eggs:**
Update the fallback responses in `getFallbackResponse()`

### **Change Response Length:**
Adjust `max_tokens` in the OpenAI API call (currently 150)

### **Adjust Personality:**
Modify `temperature` (0.7 = balanced, 0.3 = more focused, 1.0 = more creative)

## 🧪 Testing

1. **Start your proxy server:** `node proxy-server.cjs`
2. **Launch your game:** `npm run dev`
3. **Test SOVA responses:**
   - *"Hello SOVA"*
   - *"What does your name stand for?"*
   - *"Give me some survival tips"*
   - *"What should I do at night?"*

## 🐛 Troubleshooting

### **"OpenAI API error: 401"**
- Check your API key is correct
- Ensure billing is set up in OpenAI account

### **"OpenAI API error: 429"**
- You've hit rate limits
- Wait a moment and try again
- Consider upgrading your OpenAI plan

### **No AI responses, only fallbacks**
- Check browser console for errors
- Verify API key is configured
- Check OpenAI account has available credits

### **Responses are too long/short**
- Adjust `max_tokens` in `openaiService.ts`
- Modify the system prompt instructions

## 🚀 Ready to Go!

Once configured, SOVA will:
- ✅ Respond intelligently to player messages
- ✅ Provide contextual game advice
- ✅ Show personality and humor
- ✅ Include lore-based easter eggs
- ✅ Fall back gracefully if AI is unavailable

Your tactical AI assistant is ready for deployment, Operative! 🎖️ 