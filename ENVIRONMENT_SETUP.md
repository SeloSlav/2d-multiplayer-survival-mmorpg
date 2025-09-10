# 🔧 Environment Variables Setup

This guide explains how to configure environment variables for the game's AI systems.

## 📋 Required Environment Variables

### Client-Side Variables (Vite)
These variables are used by the React client application:

```bash
# client/.env
OPENAI_API_KEY=sk-your-openai-api-key-here
ELEVENLABS_API_KEY=your-elevenlabs-api-key-here
```

**Note:** 
- **OpenAI API key** is used for both GPT-4o (AI personality) and Whisper (speech-to-text)
- **ElevenLabs API key** is used for voice synthesis (optional)

## 🚀 Setup Methods

### Method 1: Environment Files (Recommended)

#### For Client (AI Services)
1. Create `client/.env`:
```bash
# client/.env
OPENAI_API_KEY=sk-your-actual-openai-api-key-here
ELEVENLABS_API_KEY=your-actual-elevenlabs-api-key-here
```

### Method 2: System Environment Variables

#### Windows (Command Prompt)
```cmd
set OPENAI_API_KEY=sk-your-openai-api-key-here
set ELEVENLABS_API_KEY=your-elevenlabs-api-key-here
```

#### Windows (PowerShell)
```powershell
$env:OPENAI_API_KEY="sk-your-openai-api-key-here"
$env:ELEVENLABS_API_KEY="your-elevenlabs-api-key-here"
```

#### macOS/Linux (Bash)
```bash
export OPENAI_API_KEY="sk-your-openai-api-key-here"
export ELEVENLABS_API_KEY="your-elevenlabs-api-key-here"
```

## 🔑 Getting API Keys

### OpenAI API Key
1. Go to [OpenAI Platform](https://platform.openai.com/)
2. Sign up/login and navigate to [API Keys](https://platform.openai.com/api-keys)
3. Click "Create new secret key"
4. Copy the key (starts with `sk-...`)

### ElevenLabs API Key (Optional)
1. Go to [ElevenLabs](https://elevenlabs.io/)
2. Sign up for an account
3. Navigate to your [Profile Settings](https://elevenlabs.io/profile)
4. Copy your API key from the "API Key" section

## 🛡️ Security Best Practices

### ✅ Do:
- Use environment variables for all API keys
- Add `.env` files to `.gitignore`
- Use different keys for development/production
- Set billing limits on API accounts
- Regularly rotate API keys

### ❌ Don't:
- Commit API keys to version control
- Share API keys in chat/email
- Use production keys in development
- Hardcode keys in source code

## 📁 File Structure

```
project-root/
├── .gitignore             # Should include .env files
├── client/
│   ├── .env               # Client environment variables
│   └── src/
│       └── services/
│           ├── openaiService.ts      # Reads OPENAI_API_KEY
│           └── elevenLabsService.ts  # Reads ELEVENLABS_API_KEY
```

## 🧪 Testing Configuration

### Test OpenAI Integration
1. Set `OPENAI_API_KEY` in `client/.env`
2. Start the client: `npm run dev`
3. Open chat and type: "Hello SOVA"
4. Should receive AI-generated response

### Test ElevenLabs Voice Synthesis (Optional)
1. Set `ELEVENLABS_API_KEY` in `client/.env`
2. Start the client: `npm run dev`
3. Type a message in chat
4. Should hear synthesized voice response

## 🐛 Troubleshooting

### "API key not found" Errors
- Check environment variable names (case-sensitive)
- Verify `.env` file location
- Restart applications after setting variables
- Check for typos in variable names

### Variables Not Loading
- Ensure `.env` files are in correct directories
- Check `.gitignore` isn't excluding `.env` files locally
- Verify environment variable syntax
- Restart development servers

## 📚 Related Documentation

- [OPENAI_SETUP.md](./OPENAI_SETUP.md) - OpenAI configuration details
- [Vite Environment Variables](https://vitejs.dev/guide/env-and-mode.html)

## 🎯 Quick Reference

| Variable | Location | Purpose | Example |
|----------|----------|---------|---------|
| `OPENAI_API_KEY` | `client/.env` | OpenAI API access | `sk-abc123...` |
| `ELEVENLABS_API_KEY` | `client/.env` | ElevenLabs voice API | `sk_abc123...` |

Your AI system is now configured for secure, environment-based API key management! 🎖️

## 🎯 What Each Service Does

### OpenAI GPT-4o (Client)
- **Purpose**: Generates intelligent SOVA responses based on game context
- **Usage**: Text chat and voice responses
- **Fallback**: Predefined tactical responses if API unavailable

### OpenAI Whisper (Client)
- **Purpose**: Converts speech to text for voice commands
- **Usage**: Hold V key to record voice, release to process
- **Features**: Real-time transcription with noise suppression

### ElevenLabs Voice Synthesis (Client)
- **Purpose**: Converts SOVA text responses to high-quality voice audio
- **Usage**: Automatic voice playback for SOVA responses
- **Features**: Advanced voice cloning and natural speech synthesis 