# SOVA runtime and verification

SOVA is already embedded in the React multiplayer game. Hold **V** on desktop,
speak, and release to send a turn. The client records with `MediaRecorder`, sends
the clip to the local faster-whisper endpoint, builds game context, calls the
configured LLM through the SpacetimeDB `ask_sova` procedure, then plays the reply
through the local Kokoro voice backend. SOVA also has a text chat tab.

| Capability | Current implementation |
| --- | --- |
| Microphone capture and spoken replies | Yes, desktop push to talk, local faster-whisper and Kokoro. |
| Game aware AI responses | Yes, selected game context is included in the LLM prompt. |
| Conversation continuity | Yes, recent turns are held in client memory (up to six turns); they do not survive reloads. |
| ElevenLabs integration / React SDK | Inactive. SOVA uses local Kokoro for speech output. |
| Streaming audio | Yes, Kokoro's generated chunks are delivered as newline-delimited WAV events and played as they arrive. First-audio time and chunk count are logged in the browser console. |
| Interruption | Press and hold **V** during spoken playback to stop it and start a new recording. The previous TTS request is aborted; this does not interrupt STT or LLM generation. |
| Token streaming or live phone calls | No. Recording ends before transcription and the full LLM reply is generated before Kokoro starts. No telephony or WebRTC integration exists. |
| AI authority over multiplayer state | No general AI action executor. Recognized crafting commands go through the normal crafting reducer after local validation. |

## Run without paid voice APIs

1. On Windows, run `tts-backend\start.bat`. It creates or reuses `tts-backend\.venv` with Python 3.12 and installs missing packages. The older `tts-backend\venv` from this checkout is damaged and is not used.
2. Check `http://localhost:8001/health` for `pipeline_ready: true`. The first transcription downloads the local `base.en` model; later requests use the cache.
3. Set `VITE_STT_PROVIDER=local` (the default) and `VITE_KOKORO_BASE_URL=http://localhost:8001`, then run the SpacetimeDB server, auth server, and React client according to the root README. `npm run dev` starts the React client only; Kokoro is a separate Python service.
4. Publish the game module and seed `ai_http_config` from the root `.env` using `scripts/deploy-sova-database.ps1`. Re-run that script after changing an LLM key or provider. LLM calls can incur provider charges; the speech input and output do not.

On this Windows machine, ports 3000 and 4001 were already used by another project.
The ignored root `.env` now points the game to its own SpacetimeDB on port 3001
and auth server on port 4002. The database data is stored in the ignored
`.local-spacetimedb` directory. From the project root, run
`scripts/start-sova-database.ps1` in one terminal. Start auth with
`npm run dev` from `auth-server-openauth` in another, voice with
`tts-backend/start.bat` in a third, and the client with root `npm run dev` in
a fourth. Run `scripts/deploy-sova-database.ps1` after changes to server code
or the SOVA provider settings.

## Functional checks

1. Confirm `/health` returns `pipeline_ready: true` on port 8001.
2. Record with **V** in the signed-in game. The browser should POST a WebM/Opus clip to `/transcribe`, then call `ask_sova`, then POST the full answer to `/synthesize-stream`.
3. Confirm the answer appears in SOVA chat and audio plays. For a response spanning multiple Kokoro segments, the first segment should arrive before the final `done` event. Press **V** while it speaks to cancel playback and begin another turn.
4. If an AI reply fails, check the server's `ai_http_config` provider and key, then inspect the browser console and Kokoro terminal. The voice backend's health check alone does not prove the whole assistant is working.

For the Loom, describe the working SOVA feature as a **push-to-talk AI voice assistant with game context and local speech models**. Show a question about the current game state, the spoken response, and the SOVA chat transcript. Press **V** again while it speaks to demonstrate cancellation and a fresh turn. Open `VoiceInterface.tsx`, `kokoroService.ts`, and `tts-backend/app.py` to explain the flow. Show the browser console's STT, LLM, and first-audio timings if useful.

The key tradeoff: local speech avoids metered voice calls, and Kokoro streams generated segments to shorten the wait for playback. Transcription and the LLM response still complete before synthesis starts. Chunk boundaries can leave audible gaps because the browser plays each WAV segment separately. This is a game voice assistant, not a deployed phone agent or a call-data warehouse.

## Suggested 2–3 minute Loom

1. **Show the product (about 45 seconds):** Ask SOVA a game-context question, show the text answer and speech, then interrupt speech with **V** and ask another question.
2. **Show ownership (about 60 seconds):** Trace `MediaRecorder → faster-whisper → SpacetimeDB LLM procedure → Kokoro streaming endpoint → browser playback`. Point out the turn identifier that prevents an interrupted reply from updating the new turn.
3. **Explain tradeoffs (about 45 seconds):** Mention the local speech cost choice, staged latency, what the first-audio metric measures, and the remaining step toward live phone calls: telephony transport, streaming STT/LLM, persistent call events, and evals. Do not present those as implemented.
