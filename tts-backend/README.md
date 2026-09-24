# Kokoro TTS Backend Service

Python FastAPI service for local text-to-speech with Kokoro-82M and speech-to-text with faster-whisper.

## Prerequisites

- **Python 3.10 - 3.12** (Python 3.13 is not yet supported by kokoro package)
- The Python packages include `espeakng-loader` on Windows. Install the standalone
  **espeak-ng** program only if your platform reports a missing eSpeak library.

### Check Your Python Version

```powershell
# Windows PowerShell
python --version

# Should show Python 3.10.x, 3.11.x, or 3.12.x
# If you have Python 3.13, you'll need to install Python 3.12 instead
```

If you have Python 3.13, you can:
1. **Install Python 3.12** alongside Python 3.13
2. **Use pyenv** (Windows) or **pyenv-win** to manage multiple Python versions
3. **Create virtual environment with Python 3.12:**
   ```powershell
   # If Python 3.12 is installed as python3.12 or py -3.12
   py -3.12 -m venv venv
   # or
   python3.12 -m venv venv
   ```

---

## Local Development Setup

### 1. Install Python Dependencies

**Windows (PowerShell):**
```powershell
cd tts-backend
.\start.bat
```

**Windows (Command Prompt):**
```cmd
cd tts-backend
start.bat
```

**Linux/macOS:**
```bash
# Create virtual environment
python3.12 -m venv .venv

# Activate virtual environment
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### 2. System Dependencies

**Linux/macOS:**
```bash
sudo apt-get install espeak-ng  # Ubuntu/Debian
# or
brew install espeak-ng  # macOS
```

**Windows:**
- `espeakng-loader` is installed with Kokoro's Python dependencies. If Kokoro
  reports a missing eSpeak library, install eSpeak NG from its official releases.

### 3. Run the Service

```bash
python app.py
```

Or with uvicorn directly:
```bash
uvicorn app:app --host 0.0.0.0 --port 8001
```

The service will be available at `http://localhost:8001`

`POST /synthesize-stream` accepts the same JSON body as `/synthesize` and
returns newline-delimited JSON. Each `audio` event contains one independently
decodable 24 kHz WAV chunk (`wav` is base64); a final `done` event marks a
complete stream. A midstream `error` event reports synthesis failure. The SOVA
client plays each chunk as it arrives and can abort playback when a new turn
starts.

`POST /respond-stream` is the OpenAI voice path. It accepts SOVA messages plus
the signed game login token, streams model text as it arrives, and starts Kokoro
on the first complete phrase while OpenAI continues generating. The response is
newline-delimited JSON with `text`, `audio`, `text_done`, and `done` events. It
uses the same local `OPENAI_API_KEY` from the ignored root `.env`, or the voice
service's own environment variables when hosted. Set `SOVA_AUTH_ISSUER` to the
game auth server's issuer URL if it differs from `VITE_AUTH_SERVER_URL`. Hosted
voice services must receive `OPENAI_API_KEY` and `SOVA_AUTH_ISSUER` in their
private environment; never set either as a `VITE_` client secret.

The first `/transcribe` request downloads the `base.en` faster-whisper model once. Set
`SOVA_WHISPER_MODEL` to a different installed model if needed. The model runs on CPU
with int8 inference. This voice path makes no metered speech API calls. SOVA's
text replies still use the selected OpenAI, Gemini, or Grok provider.

---

## Production Deployment (Railway)

### Step 1: Deploy as a New Service

1. In Railway Dashboard, click **"New"** → **"Deploy from GitHub repo"**
2. Select your repository
3. After deployment, click on the service and go to **Settings**
4. Set **Root Directory** to: `tts-backend`
5. Railway will auto-detect the Dockerfile and rebuild

### Step 2: Generate Public Domain

1. Go to **Settings** → **Networking** → **Public Networking**
2. Click **"Generate Domain"**
3. Note the URL (e.g., `https://your-service.up.railway.app`)

### Step 3: Configure CORS (Important!)

Before deploying, update `allow_origins` in `app.py` to include your production domain:

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://www.yourdomain.com",
        "https://yourdomain.com",
        "http://localhost:5173",  # Keep for local dev
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

### Step 4: Configure Client Environment Variables

Set in your **client** deployment (Railway/Vercel):

| Variable | Value |
|----------|-------|
| `VITE_KOKORO_BASE_URL` | `https://your-tts-service.up.railway.app` |
| `VITE_TTS_PROVIDER` | `kokoro` |

**⚠️ Include `https://` prefix!**

### Step 5: Prevent Cold Starts (Recommended)

Railway may "sleep" the service after inactivity, causing 30-90 second delays on first request.

**Solution: Set up free monitoring with UptimeRobot:**

1. Go to [uptimerobot.com](https://uptimerobot.com/) (free)
2. Create account and add monitor:
   - **Monitor Type:** HTTP(s)
   - **URL:** `https://your-tts-service.up.railway.app/health`
   - **Interval:** 5 minutes
3. This keeps the service warm by pinging it regularly

---

## Resource Requirements

⚠️ **Important:** Kokoro TTS requires:
- **Memory:** At least 1GB RAM (2GB recommended)
- **CPU:** Model inference is CPU-bound
- **Disk:** ~500MB for model weights (downloaded on first run)

Railway's free tier may not have sufficient resources. Consider:
- Using a paid Railway plan ($5/month Developer tier minimum)
- Or keeping the service warm with external monitoring

---

## API Endpoints

### POST /synthesize
Synthesize speech from text.

**Request:**
```json
{
  "text": "Hello, this is a test.",
  "voice": "af_heart",
  "lang_code": "a"
}
```

**Response:**
- WAV audio file (24kHz sample rate)
- Content-Type: `audio/wav`

### POST /transcribe

Upload a recorded audio file as multipart form field `audio`. Returns JSON
`{"text":"..."}`. The file limit is 10 MB. The first call loads the local
faster-whisper model; it can take longer than later calls.

### GET /voices
List available voices.

### GET /health
Health check endpoint. Returns `{"status": "healthy"}`.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8001` | Server port (Railway auto-sets this) |
| `SOVA_WHISPER_MODEL` | `base.en` | Local transcription model |

---

## Troubleshooting

### Cold Start Issues
- First request loads the model into memory (can take 30-90 seconds on Railway)
- Set up UptimeRobot to keep service warm
- The client plays `sova_thinking.mp3` while waiting

### CORS Errors
- Ensure your production domain is in `allow_origins` in `app.py`
- Include `https://` prefix in all URLs
- Redeploy after CORS changes

### 405 Method Not Allowed
- Service may not be fully initialized
- Wait for logs to show "Application startup complete"
- Check the URL is correct

### Memory Issues on Railway
- Check Railway logs for OOM (Out of Memory) errors
- Consider upgrading to Developer tier ($5/month)

---

## Files

| File | Purpose |
|------|---------|
| `app.py` | FastAPI server with Kokoro TTS integration |
| `Dockerfile` | Docker container for deployment |
| `requirements.txt` | Python dependencies |
| `railway.toml` | Railway-specific configuration |

---

## Notes

- First request may take longer as the model loads
- Audio is generated at 24kHz sample rate
- Supports up to 5000 characters per request
- See Kokoro documentation for full voice list: https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md
