# SOVA demo: verified feature claims

SOVA is already embedded in the React multiplayer game. Hold **V** on desktop,
speak, and release to send a turn. The client records with `MediaRecorder`, sends
the clip to the local faster-whisper endpoint, builds game context, calls the
configured LLM through the SpacetimeDB `ask_sova` procedure, then plays the reply
through the local Kokoro voice backend. SOVA also has a text chat tab.

| Claim in the proposed application script | Current implementation |
| --- | --- |
| Microphone capture and spoken replies | Yes, desktop push to talk, local faster-whisper and Kokoro. |
| Game aware AI responses | Yes, selected game context is included in the LLM prompt. |
| Conversation continuity | Yes, recent turns are held in client memory (up to six turns); they do not survive reloads. |
| ElevenLabs integration / React SDK | No active ElevenLabs conversation integration. An unused ElevenLabs TTS service file exists. Do not claim the SDK or provider in the demo. |
| Streaming audio | Yes, Kokoro's generated chunks are delivered as newline-delimited WAV events and played as they arrive. First-audio time and chunk count are logged in the browser console. |
| Interruption | Press and hold **V** during spoken playback to stop it and start a new recording. The previous TTS request is aborted; this does not interrupt STT or LLM generation. |
| Token streaming or live phone calls | No. Recording ends before transcription and the full LLM reply is generated before Kokoro starts. No telephony or WebRTC integration exists. |
| AI authority over multiplayer state | No general AI action executor. Recognized crafting commands go through the normal crafting reducer after local validation. |

## Run without paid voice APIs

1. On Windows, run `tts-backend\start.bat`. It creates or reuses `tts-backend\.venv` with Python 3.12 and installs missing packages. The older `tts-backend\venv` from this checkout is damaged and is not used.
2. Check `http://localhost:8001/health` for `pipeline_ready: true`. The first transcription downloads the local `base.en` model; later requests use the cache.
3. Set `VITE_STT_PROVIDER=local` (the default) and `VITE_KOKORO_BASE_URL=http://localhost:8001`, then run the SpacetimeDB server, auth server, and React client according to the root README. `npm run dev` starts the React client only; Kokoro is a separate Python service.
4. Configure the existing SOVA LLM provider as before. LLM calls can still incur provider charges; the speech input and output do not.

For the Loom, describe SOVA as a **push-to-talk AI voice assistant with game context and local speech models**. Show a question about the current game state, the spoken response, and the SOVA chat transcript. Press **V** again while it speaks to demonstrate cancellation and a fresh turn. Open `VoiceInterface.tsx`, `kokoroService.ts`, and `tts-backend/app.py` to explain the flow. Show the browser console's STT, LLM, and first-audio timings if useful.

The key tradeoff: local speech avoids metered voice calls, and Kokoro streams generated segments to shorten the wait for playback. Transcription and the LLM response still complete before synthesis starts. Chunk boundaries can leave audible gaps because the browser plays each WAV segment separately. This is a game voice assistant, not a deployed phone agent or a call-data warehouse.

## Suggested 2–3 minute Loom

1. **Show the product (about 45 seconds):** Ask SOVA a game-context question, show the text answer and speech, then interrupt speech with **V** and ask another question.
2. **Show ownership (about 60 seconds):** Trace `MediaRecorder → faster-whisper → SpacetimeDB LLM procedure → Kokoro streaming endpoint → browser playback`. Point out the turn identifier that prevents an interrupted reply from updating the new turn.
3. **Explain tradeoffs (about 45 seconds):** Mention the local speech cost choice, staged latency, what the first-audio metric measures, and the remaining step toward live phone calls: telephony transport, streaming STT/LLM, persistent call events, and evals. Do not present those as implemented.
