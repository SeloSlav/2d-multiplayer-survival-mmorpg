# Environment Variables Setup

This guide explains the environment variables required for SOVA chat, voice, and brewing after the procedure-based migration.

## Required Variables

Set these in the project root `.env` file:

```bash
# Optional: required only when VITE_STT_PROVIDER=openai or AI provider is openai
OPENAI_API_KEY=sk-your-openai-api-key-here

# Optional model providers for SOVA responses
GROK_API_KEY=xai-your-grok-api-key-here
GEMINI_API_KEY=your-gemini-api-key-here

# Client-side provider selector: openai | gemini | grok (defaults to grok)
VITE_AI_PROVIDER=grok

# Kokoro local TTS backend
VITE_KOKORO_BASE_URL=http://localhost:8001
# Default is local faster-whisper; openai opts into paid transcription
VITE_STT_PROVIDER=local
```

Notes:
- Local voice transcription does not require an OpenAI key. Install `tts-backend/requirements.txt` and start the backend.
- OpenAI transcription still works when explicitly selected with `VITE_STT_PROVIDER=openai`.
- You can use OpenAI for Whisper while using Grok or Gemini for SOVA responses.
- API keys remain server-side and are not exposed to the browser.

## Quick Setup

1. Create `.env` from the template:

```bash
copy .env.example .env   # Windows
# cp .env.example .env   # macOS/Linux
```

2. Fill in API keys in `.env`.
3. Start Kokoro TTS backend:

```bash
cd tts-backend
python app.py
```

4. Start the app stack (server/client/auth).

## Services Needed For Voice

- SpacetimeDB module/server (handles SOVA procedures).
- Client (`npm run dev`).
- Local voice backend (`http://localhost:8001`) for faster-whisper transcription and Kokoro TTS.

No separate AI gateway service is required for runtime chat/voice/brewing flows.

## Troubleshooting

### "API key not found"
- Ensure `.env` exists in project root.
- Confirm variable names exactly match (`OPENAI_API_KEY`, `GROK_API_KEY`, `GEMINI_API_KEY`).
- Restart running services after editing `.env`.

### "Kokoro service not available"
- Ensure Kokoro is running: `cd tts-backend && python app.py`.
- Check `VITE_KOKORO_BASE_URL` matches the running port.

### "Wrong AI model/provider behavior"
- Check `VITE_AI_PROVIDER` is one of: `openai`, `grok`, `gemini`.
- If using `openai`, ensure `OPENAI_API_KEY` is valid.
- If using `grok` or `gemini`, ensure the corresponding key is set.

## Quick Reference

| Variable | Location | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | server config | OpenAI SOVA replies or optional paid transcription |
| `GROK_API_KEY` | root `.env` | SOVA responses via Grok |
| `GEMINI_API_KEY` | root `.env` | SOVA responses via Gemini |
| `VITE_AI_PROVIDER` | root `.env` | SOVA provider selector |
| `VITE_KOKORO_BASE_URL` | root `.env` | Kokoro backend URL |
| `VITE_STT_PROVIDER` | root `.env` | `local` by default; `openai` opts into hosted transcription |
