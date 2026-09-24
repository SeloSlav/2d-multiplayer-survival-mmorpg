"""
Kokoro TTS Backend Service
Provides REST API for text-to-speech synthesis using Kokoro model
"""
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel
import io
import base64
import json
import soundfile as sf
import torch
from kokoro import KPipeline
import logging
import os
import tempfile
import threading
import queue
import re
import httpx
import time
from pathlib import Path
from dotenv import load_dotenv
import jwt
from jwt import PyJWKClient
from fastapi import UploadFile, File

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Global pipeline instance (loaded on startup)
pipeline: KPipeline | None = None
speech_model = None
speech_model_lock = threading.Lock()
pipeline_lock = threading.Lock()

# Local development uses the existing ignored root .env. Hosted deployments use
# their own environment variables; no model key is ever sent to the browser.
load_dotenv(Path(__file__).resolve().parent.parent / ".env", override=False)
AUTH_ISSUER = os.getenv("SOVA_AUTH_ISSUER") or os.getenv("VITE_AUTH_SERVER_URL") or "https://broth-and-bullets-production.up.railway.app"
auth_jwks = PyJWKClient(f"{AUTH_ISSUER.rstrip('/')}/.well-known/jwks.json", cache_jwk_set=True, lifespan=300)


class SOVAStreamRequest(BaseModel):
    messages: list[dict[str, str]]
    voice: str = "af_heart"


def authorize_voice_request(authorization: str | None) -> None:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Sign in to use SOVA voice")
    try:
        token = authorization[7:]
        signing_key = auth_jwks.get_signing_key_from_jwt(token)
        jwt.decode(token, signing_key.key, algorithms=["RS256"], issuer=AUTH_ISSUER,
                   audience="vibe-survival-game-client")
    except (jwt.exceptions.MissingCryptographyError, jwt.exceptions.PyJWKClientConnectionError) as exc:
        logger.exception("SOVA voice authentication service unavailable")
        raise HTTPException(status_code=503, detail="SOVA authentication service unavailable") from exc
    except jwt.exceptions.InvalidTokenError as exc:
        logger.warning("SOVA voice authentication failed: %s", type(exc).__name__)
        raise HTTPException(status_code=401, detail="Invalid or expired login") from exc
    except Exception as exc:
        logger.exception("SOVA voice authentication service failed")
        raise HTTPException(status_code=503, detail="SOVA authentication service failed") from exc


def pop_speech_segment(buffer: str, final: bool = False) -> tuple[str, str]:
    """Cut at a sentence boundary, or at a word boundary to cap first-audio wait."""
    match = re.search(r"[.!?](?:[\"']?)(?=\s|$)", buffer)
    if match and match.end() >= 10:
        end = match.end()
        return buffer[:end].strip(), buffer[end:].lstrip()
    if len(buffer) >= 95:
        end = buffer.rfind(" ", 45, 95)
        if end > 0:
            return buffer[:end].strip(), buffer[end:].lstrip()
    if final and buffer.strip():
        return buffer.strip(), ""
    return "", buffer


def stream_openai_text(messages: list[dict[str, str]], api_key: str):
    """Yield model deltas; retry connection failures only before any text arrives."""
    body = {
        "model": "gpt-6-luna", "messages": messages,
        "max_completion_tokens": 300, "reasoning_effort": "none", "stream": True,
    }
    headers = {"Authorization": f"Bearer {api_key}"}
    for attempt in range(2):
        emitted_text = False
        try:
            with httpx.Client(timeout=httpx.Timeout(18.0, connect=8.0)) as client:
                with client.stream("POST", "https://api.openai.com/v1/chat/completions",
                                   headers=headers, json=body) as upstream:
                    upstream.raise_for_status()
                    for raw in upstream.iter_lines():
                        if not raw.startswith("data: "):
                            continue
                        payload = raw[6:].strip()
                        if payload == "[DONE]":
                            return
                        chunk = json.loads(payload)
                        choices = chunk.get("choices") or []
                        if not choices:
                            continue
                        delta = choices[0].get("delta", {}).get("content")
                        if delta:
                            emitted_text = True
                            yield delta
                    raise httpx.RemoteProtocolError("OpenAI stream ended before completion")
        except (httpx.TransportError, httpx.HTTPStatusError) as exc:
            retryable_status = isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code in {429, 502, 503, 504}
            retryable = isinstance(exc, httpx.TransportError) or retryable_status
            if emitted_text or attempt == 1 or not retryable:
                raise
            logger.warning("OpenAI stream connection failed before text (%s); retry %s/1",
                           type(exc).__name__, attempt + 1)
            time.sleep(0.4 * (attempt + 1))


def stream_sova_response(request: SOVAStreamRequest, authorization: str | None = Header(default=None)):
    """Stream OpenAI text and Kokoro WAV chunks concurrently as NDJSON."""
    authorize_voice_request(authorization)
    if pipeline is None:
        raise HTTPException(status_code=503, detail="Kokoro pipeline is unavailable")
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="OPENAI_API_KEY is missing from the voice backend")
    if not request.messages or len(request.messages) > 16:
        raise HTTPException(status_code=400, detail="Invalid SOVA prompt size")
    if any(m.get("role") not in {"system", "user", "assistant"} or not isinstance(m.get("content"), str) for m in request.messages):
        raise HTTPException(status_code=400, detail="Invalid SOVA messages")
    if sum(len(m["content"]) for m in request.messages) > 64000:
        raise HTTPException(status_code=400, detail="Invalid SOVA prompt size")

    def events():
        outgoing: queue.Queue[dict] = queue.Queue(maxsize=128)
        speech: queue.Queue[str | None] = queue.Queue(maxsize=16)
        stopped = threading.Event()

        def emit(item: dict):
            while not stopped.is_set():
                try:
                    outgoing.put(item, timeout=0.2)
                    return
                except queue.Full:
                    pass

        def enqueue_speech(segment: str | None):
            while not stopped.is_set():
                try:
                    speech.put(segment, timeout=0.2)
                    return
                except queue.Full:
                    pass

        def produce_text():
            pending = ""
            try:
                for delta in stream_openai_text(request.messages, api_key):
                    if stopped.is_set():
                        break
                    emit({"type": "text", "delta": delta})
                    pending += delta
                    while True:
                        segment, pending = pop_speech_segment(pending)
                        if not segment:
                            break
                        enqueue_speech(segment)
                segment, _ = pop_speech_segment(pending, final=True)
                if segment:
                    enqueue_speech(segment)
            except Exception as exc:
                logger.exception("OpenAI streaming response failed")
                message = "SOVA model connection interrupted" if isinstance(exc, httpx.TransportError) else "SOVA response stream failed"
                emit({"type": "error", "message": message})
            finally:
                enqueue_speech(None)
                emit({"type": "text_done"})

        def produce_audio():
            count = 0
            try:
                while not stopped.is_set():
                    try:
                        segment = speech.get(timeout=0.2)
                    except queue.Empty:
                        continue
                    if segment is None:
                        break
                    assert pipeline is not None
                    with pipeline_lock:
                        for _, _, audio in pipeline(segment, voice=request.voice):
                            if stopped.is_set():
                                break
                            if audio is None or len(audio) == 0:
                                continue
                            buffer = io.BytesIO()
                            sf.write(buffer, audio, 24000, format="WAV")
                            emit({"type": "audio", "sequence": count,
                                  "wav": base64.b64encode(buffer.getvalue()).decode("ascii")})
                            count += 1
            except Exception:
                logger.exception("Kokoro streaming response failed")
                emit({"type": "error", "message": "SOVA voice synthesis failed"})
            finally:
                emit({"type": "done", "chunks": count})

        threading.Thread(target=produce_text, daemon=True).start()
        threading.Thread(target=produce_audio, daemon=True).start()
        try:
            while True:
                item = outgoing.get()
                yield json.dumps(item) + "\n"
                if item["type"] == "done":
                    break
        finally:
            stopped.set()

    return StreamingResponse(events(), media_type="application/x-ndjson",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for startup/shutdown events"""
    global pipeline
    # Startup
    try:
        logger.info("Initializing Kokoro TTS pipeline...")
        # Initialize pipeline with default settings
        # Using lang_code='a' for English (see Kokoro docs for other codes)
        pipeline = KPipeline(lang_code='a')
        logger.info("✅ Kokoro pipeline initialized successfully")
    except Exception as e:
        logger.error(f"❌ Failed to initialize Kokoro pipeline: {e}")
        pipeline = None
    
    yield
    
    # Shutdown (cleanup if needed)
    logger.info("Shutting down Kokoro TTS service...")

app = FastAPI(title="Kokoro TTS Service", version="1.0.0", lifespan=lifespan)

# CORS middleware for browser access
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://www.brothandbullets.com",
        "https://brothandbullets.com",
        "http://localhost:5173",
        "http://localhost:3000",
    ],
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

app.post("/respond-stream")(stream_sova_response)

class TTSRequest(BaseModel):
    text: str
    voice: str = "af_heart"  # Default voice, can be changed
    lang_code: str = "a"  # Default language code (English)

class TTSResponse(BaseModel):
    success: bool
    message: str
    audio_size_bytes: int | None = None
    error: str | None = None


def validate_tts_request(request: TTSRequest):
    if pipeline is None:
        raise HTTPException(status_code=503, detail="TTS pipeline not initialized")
    if not request.text or not request.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")
    if len(request.text) > 5000:
        raise HTTPException(status_code=400, detail="Text too long (max 5000 characters)")


@app.post("/synthesize-stream")
def synthesize_speech_stream(request: TTSRequest):
    """Yield independently decodable WAV chunks as newline-delimited JSON."""
    validate_tts_request(request)

    def chunks():
        try:
            assert pipeline is not None
            count = 0
            for _, _, audio in pipeline(request.text, voice=request.voice):
                if audio is None or len(audio) == 0:
                    continue
                buffer = io.BytesIO()
                sf.write(buffer, audio, 24000, format="WAV")
                yield json.dumps({
                    "type": "audio",
                    "sequence": count,
                    "wav": base64.b64encode(buffer.getvalue()).decode("ascii"),
                }) + "\n"
                count += 1
            yield json.dumps({"type": "done", "chunks": count}) + "\n"
        except Exception:
            logger.exception("Streaming synthesis failed")
            yield json.dumps({"type": "error", "message": "Speech synthesis failed"}) + "\n"

    return StreamingResponse(
        chunks(), media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/transcribe")
def transcribe_speech(audio: UploadFile = File(...)):
    """Transcribe a push-to-talk recording on this machine with faster-whisper."""
    global speech_model
    content = audio.file.read(10 * 1024 * 1024 + 1)
    if not content or len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Audio must be between 1 byte and 10 MB")
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        raise HTTPException(status_code=503, detail="Local speech model is missing. Install faster-whisper in the TTS backend.")

    with speech_model_lock:
        try:
            if speech_model is None:
                speech_model = WhisperModel(
                    os.getenv("SOVA_WHISPER_MODEL", "base.en"), device="cpu", compute_type="int8"
                )
            suffix = os.path.splitext(audio.filename or "speech.webm")[1].lower()
            if suffix not in {".webm", ".ogg", ".mp4", ".wav", ".m4a"}:
                suffix = ".webm"
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as recording:
                recording.write(content)
                recording_path = recording.name
            try:
                segments, _ = speech_model.transcribe(recording_path, beam_size=3)
                text = " ".join(segment.text.strip() for segment in segments).strip()
            finally:
                os.unlink(recording_path)
        except Exception as exc:
            logger.exception("Local transcription failed")
            raise HTTPException(status_code=503, detail=f"Local transcription failed: {exc}") from exc
    return {"text": text}


@app.get("/")
async def root():
    """Health check endpoint"""
    return {
        "service": "Kokoro TTS",
        "status": "running",
        "pipeline_ready": pipeline is not None
    }

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy" if pipeline is not None else "unhealthy",
        "pipeline_ready": pipeline is not None
    }

@app.post("/synthesize", response_class=Response)
async def synthesize_speech(request: TTSRequest):
    """
    Synthesize speech from text using Kokoro TTS
    
    Args:
        request: TTS request containing text, voice, and lang_code
        
    Returns:
        WAV audio file (24kHz sample rate)
    """
    if not pipeline:
        raise HTTPException(
            status_code=503,
            detail="TTS pipeline not initialized. Please wait for service to start."
        )
    
    if not request.text or not request.text.strip():
        raise HTTPException(
            status_code=400,
            detail="Text cannot be empty"
        )
    
    if len(request.text) > 5000:
        raise HTTPException(
            status_code=400,
            detail="Text too long (max 5000 characters)"
        )
    
    try:
        logger.info(f"🎤 Synthesizing speech: {len(request.text)} characters, voice: {request.voice}")
        
        # Generate audio using Kokoro pipeline
        # The generator yields (gs, ps, audio) tuples
        # We collect all audio chunks
        audio_chunks = []
        
        generator = pipeline(request.text, voice=request.voice)
        
        for gs, ps, audio in generator:
            if audio is not None and len(audio) > 0:
                audio_chunks.append(audio)
        
        if not audio_chunks:
            raise HTTPException(
                status_code=500,
                detail="No audio generated from text"
            )
        
        # Concatenate all audio chunks
        import numpy as np
        full_audio = np.concatenate(audio_chunks)
        
        # Ensure audio is in the correct format (float32, mono)
        if full_audio.dtype != np.float32:
            full_audio = full_audio.astype(np.float32)
        
        # Kokoro outputs at 24kHz sample rate
        sample_rate = 24000
        
        # Convert to WAV format in memory
        audio_buffer = io.BytesIO()
        sf.write(audio_buffer, full_audio, sample_rate, format='WAV')
        audio_buffer.seek(0)
        
        audio_size = len(audio_buffer.getvalue())
        logger.info(f"✅ Audio generated successfully: {audio_size} bytes")
        
        # Return audio file
        return Response(
            content=audio_buffer.getvalue(),
            media_type="audio/wav",
            headers={
                "Content-Disposition": "attachment; filename=tts_output.wav",
                "Content-Length": str(audio_size)
            }
        )
        
    except Exception as e:
        logger.error(f"❌ Synthesis failed: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Speech synthesis failed: {str(e)}"
        )

@app.get("/voices")
async def list_voices():
    """List available voices"""
    # Kokoro v1.0 has 54 voices, see VOICES.md
    # Common voices: af_heart, af_bella, af_sarah, etc.
    # Return a subset of available voices
    return {
        "voices": [
            {"id": "af_heart", "name": "Heart (Default)", "description": "Default female voice"},
            {"id": "af_bella", "name": "Bella", "description": "Female voice"},
            {"id": "af_sarah", "name": "Sarah", "description": "Female voice"},
            {"id": "am_michael", "name": "Michael", "description": "Male voice"},
            {"id": "am_adam", "name": "Adam", "description": "Male voice"},
        ],
        "note": "See Kokoro VOICES.md for full list of 54 voices"
    }

if __name__ == "__main__":
    import uvicorn
    
    # Get port from environment or default to 8001 (to avoid conflict with main app)
    port = int(os.getenv("PORT", "8001"))
    
    logger.info(f"🚀 Starting Kokoro TTS service on port {port}")
    uvicorn.run(app, host="0.0.0.0", port=port)
