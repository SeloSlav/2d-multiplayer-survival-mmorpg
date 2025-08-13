# 🔧 Environment Variables Setup

This guide explains how to configure environment variables for SOVA's (Sentient Ocular Virtual Assistant) voice and AI systems.

## 📋 Required Environment Variables

### Client-Side Variables (Vite)
These variables are used by the React client application:

```bash
# client/.env
OPENAI_API_KEY=sk-your-openai-api-key-here
```

**Note:** The same OpenAI API key is used for both:
- **GPT-4o**: AI personality and intelligent responses
- **Whisper**: Speech-to-text transcription for voice commands

### Server-Side Variables (Node.js Proxy)
These variables are used by the proxy server:

```bash
# Root directory or system environment
KIKASHI_API_KEY=your-kikashi-api-key-here
PROXY_PORT=3001
```

## 🚀 Setup Methods

### Method 1: Environment Files (Recommended)

#### For Client (OpenAI)
1. Create `client/.env`:
```bash
# client/.env
OPENAI_API_KEY=sk-your-actual-openai-api-key-here
```

#### For Proxy Server (Kikashi)
1. Create `.env` in project root:
```bash
# .env (project root)
KIKASHI_API_KEY=your-actual-kikashi-api-key-here
PROXY_PORT=3001
```

2. Install dotenv for the proxy server:
```bash
npm install dotenv
```

3. Update `proxy-server.cjs` to load environment variables:
```javascript
require('dotenv').config();
```

### Method 2: System Environment Variables

#### Windows (Command Prompt)
```cmd
set OPENAI_API_KEY=sk-your-openai-api-key-here
set KIKASHI_API_KEY=your-kikashi-api-key-here
set PROXY_PORT=3001
```

#### Windows (PowerShell)
```powershell
$env:OPENAI_API_KEY="sk-your-openai-api-key-here"
$env:KIKASHI_API_KEY="your-kikashi-api-key-here"
$env:PROXY_PORT="3001"
```

#### macOS/Linux (Bash)
```bash
export OPENAI_API_KEY="sk-your-openai-api-key-here"
export KIKASHI_API_KEY="your-kikashi-api-key-here"
export PROXY_PORT="3001"
```

## 🔑 Getting API Keys

### OpenAI API Key
1. Go to [OpenAI Platform](https://platform.openai.com/)
2. Sign up/login and navigate to [API Keys](https://platform.openai.com/api-keys)
3. Click "Create new secret key"
4. Copy the key (starts with `sk-...`)

### Kikashi API Key
1. Go to [Kikashi.io](https://kikashi.io/)
2. Sign up for an account
3. Navigate to your API dashboard
4. Copy your API key

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
├── .env                    # Proxy server environment variables
├── .gitignore             # Should include .env files
├── proxy-server.cjs       # Reads KIKASHI_API_KEY, PROXY_PORT
├── client/
│   ├── .env               # Client environment variables
│   └── src/
│       └── services/
│           ├── openaiService.ts    # Reads OPENAI_API_KEY
│           └── kikashiService.ts   # Uses proxy server
└── start-with-proxy.bat   # Startup script
```

## 🧪 Testing Configuration

### Test OpenAI Integration
1. Set `OPENAI_API_KEY` in `client/.env`
2. Start the client: `npm run dev`
3. Open chat and type: "Hello SOVA"
4. Should receive AI-generated response

### Test Kikashi Voice Synthesis
1. Set `KIKASHI_API_KEY` environment variable
2. Start proxy: `node proxy-server.cjs`
3. Start client: `npm run dev`
4. Type a message in chat
5. Should hear synthesized voice response

### Test Health Endpoints
```bash
# Test proxy server
curl http://localhost:3001/health

# Expected response:
# {"status":"OK","timestamp":"2024-01-01T12:00:00.000Z"}
```

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

### CORS Issues
- Ensure proxy server is running
- Check proxy port matches client configuration
- Verify no firewall blocking localhost connections

## 📚 Related Documentation

- [OPENAI_SETUP.md](./OPENAI_SETUP.md) - OpenAI configuration details
- [VOICE_PROXY_README.md](./VOICE_PROXY_README.md) - Voice proxy setup
- [Vite Environment Variables](https://vitejs.dev/guide/env-and-mode.html)
- [Node.js Environment Variables](https://nodejs.org/en/learn/command-line/how-to-read-environment-variables-from-nodejs)

## 🎯 Quick Reference

| Variable | Location | Purpose | Example |
|----------|----------|---------|---------|
| `OPENAI_API_KEY` | `client/.env` | OpenAI API access | `sk-abc123...` |
| `KIKASHI_API_KEY` | System/Root `.env` | Kikashi voice API | `LtfpwqMw...` |
| `PROXY_PORT` | System/Root `.env` | Proxy server port | `3001` |

Your SOVA system is now configured for secure, environment-based API key management! 🎖️

## 🎯 What Each Service Does

### OpenAI GPT-4o (Client)
- **Purpose**: Generates intelligent SOVA responses based on game context
- **Usage**: Text chat and voice responses
- **Fallback**: Predefined tactical responses if API unavailable

### OpenAI Whisper (Client)
- **Purpose**: Converts speech to text for voice commands
- **Usage**: Hold V key to record voice, release to process
- **Features**: Real-time transcription with noise suppression

### Kikashi Voice Synthesis (Proxy Server)
- **Purpose**: Converts SOVA text responses to robot voice audio
- **Usage**: Automatic voice playback for SOVA responses
- **Voice**: "robot2" - military/tactical sound profile 