# 🎤 SOVA Voice Proxy Setup

This guide explains how to set up the local Node.js proxy server to enable SOVA voice synthesis using the Kikashi API.

## 🚀 Quick Start

### Windows
1. Double-click `start-with-proxy.bat`
2. Wait for the proxy server to start
3. Run your main application: `npm run dev`

### macOS/Linux
1. Run: `./start-with-proxy.sh`
2. Wait for the proxy server to start  
3. Run your main application: `npm run dev`

### Manual Setup
1. Install dependencies: `npm install express cors node-fetch`
2. Start proxy: `node proxy-server.cjs`
3. Start main app: `npm run dev`

## 🔧 How It Works

The local proxy server:
- Runs on `http://localhost:3001`
- Handles CORS issues between your browser and Kikashi API
- Forwards TTS requests to `https://kikashi.io/api/tts`
- Returns audio streams back to your game client

## 🎮 Usage in Game

1. Start the proxy server (see Quick Start above)
2. Launch your game application
3. Open chat and type a message
4. SOVA will respond with synthesized voice using the "robot2" voice style

## 🛠️ Configuration

### Voice Style
The default voice is "robot2" (military/tactical). You can modify this in:
- `client/src/services/kikashiService.ts` - Change `SOVA_VOICE` constant
- `proxy-server.js` - Change default `voiceStyle` parameter

### API Key
The proxy server now supports environment variables for the Kikashi API key:

**Option A: Environment Variable (Recommended)**
```bash
# Set environment variable
export KIKASHI_API_KEY="your-api-key-here"  # macOS/Linux
set KIKASHI_API_KEY=your-api-key-here       # Windows CMD
$env:KIKASHI_API_KEY="your-api-key-here"    # Windows PowerShell
```

**Option B: Direct Configuration**
The fallback API key is embedded in `proxy-server.cjs` for development convenience.

### Proxy Port
**Option A: Environment Variable**
```bash
export PROXY_PORT=3002  # Use a different port
```

**Option B: Direct Configuration**
- `proxy-server.cjs` - Change `PORT` constant
- `client/src/services/kikashiService.ts` - Change `LOCAL_PROXY_URL`

## 🐛 Troubleshooting

### "Failed to fetch" Error
- Ensure proxy server is running on port 3001
- Check console for proxy server logs
- Verify no other service is using port 3001

### "Text is required" Error
- Check that message text is not empty
- Verify request format in browser dev tools

### Audio Won't Play
- Check browser audio permissions
- Verify Content-Type is "audio/mpeg" in network tab
- Try a different browser

### Port Already in Use
```bash
# Find process using port 3001
netstat -ano | findstr :3001  # Windows
lsof -i :3001                 # macOS/Linux

# Kill the process
taskkill /PID <PID> /F        # Windows  
kill -9 <PID>                 # macOS/Linux
```

## 📝 API Endpoints

### POST /api/tts
Synthesize text to speech
```json
{
  "text": "Hello, this is SOVA",
  "voiceStyle": "robot2"
}
```

Response: Audio stream (audio/mpeg)

### GET /health
Check proxy server status
```json
{
  "status": "OK",
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

## 🔒 Security Notes

- API key is embedded in proxy server for development
- For production, use environment variables
- Consider rate limiting for public deployments
- Proxy server has no authentication - use only locally

## 🤖 AI Integration

SOVA now includes OpenAI GPT-4o integration for intelligent responses! See `OPENAI_SETUP.md` for configuration.

**Features:**
- Tactical military personality
- Game-specific advice and tips
- Easter eggs (ask "What does SOVA stand for?")
- Contextual responses based on game state
- Automatic fallback if AI is unavailable

## 📚 Related Files

- `proxy-server.cjs` - Main proxy server
- `client/src/services/kikashiService.ts` - Voice synthesis service
- `client/src/services/openaiService.ts` - AI personality service
- `client/src/components/Chat.tsx` - Chat integration
- `start-with-proxy.bat` - Windows startup script
- `start-with-proxy.sh` - Unix startup script
- `OPENAI_SETUP.md` - AI configuration guide 