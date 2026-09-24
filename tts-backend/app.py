"""
Kokoro TTS Backend Service
Provides REST API for text-to-speech synthesis using Kokoro model
"""
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
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
from fastapi import UploadFile, File

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Global pipeline instance (loaded on startup)
pipeline: KPipeline | None = None
speech_model = None
speech_model_lock = threading.Lock()

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
