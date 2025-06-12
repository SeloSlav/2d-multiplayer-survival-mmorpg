# Proxy Server Deployment Guide

## Overview
The voice proxy server needs to be deployed as a separate Railway service to handle TTS requests.

## Step-by-Step Deployment

### 1. Create New Railway Service for Proxy

1. Go to [Railway Dashboard](https://railway.app/dashboard)
2. Click "New Project" → "Deploy from GitHub repo"
3. Select this repository
4. **Important**: Create a NEW service (don't use existing one)
5. Name it something like "voice-proxy" or "tts-proxy"

### 2. Configure Railway Service

1. In the new service settings:
   - Set **Root Directory**: `/` (leave empty - Railway will find proxy-server.cjs)
   - Set **Build Command**: (leave empty - not needed for Node.js)
   - Set **Start Command**: `node proxy-server.cjs`

2. Add Environment Variables:
   ```
   OPENAI_API_KEY=your_actual_openai_api_key_here
   PORT=3001
   ```

### 3. Deploy the Proxy

1. Railway will automatically deploy using `proxy-railway.toml`
2. Wait for deployment to complete
3. Note the generated URL (e.g., `https://voice-proxy-abc123.railway.app`)

### 4. Update Main App Environment

1. In your MAIN Railway service (the game client), add:
   ```
   VITE_PROXY_URL=https://voice-proxy-abc123.railway.app
   ```
   (Replace with your actual proxy URL)

2. Redeploy the main service

### 5. Test the Setup

1. Open your deployed game
2. Try using SOVA voice features
3. Check Railway logs for both services if issues occur

## Local Development

For local development, keep using:
```
VITE_PROXY_URL=http://localhost:3001
```

## Files Involved

- `proxy-server.cjs` - The proxy server code
- `proxy-package.json` - Proxy dependencies
- `proxy-railway.toml` - Railway config for proxy
- `client/src/services/kikashiService.ts` - Updated to use env var

## Troubleshooting

1. **Proxy not found**: Check VITE_PROXY_URL is set correctly
2. **CORS errors**: Proxy should handle CORS automatically
3. **OpenAI errors**: Check OPENAI_API_KEY is set in proxy service
4. **Audio not playing**: Check browser console for detailed errors 