const express = require('express');
const cors = require('cors');

// Dynamic import for node-fetch (ES module)
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
const PORT = process.env.PROXY_PORT || 3001; // Different port from your main app

// Enable CORS for all routes
app.use(cors());

// Parse JSON bodies
app.use(express.json());

// Proxy endpoint for Kikashi TTS API
app.post('/api/tts', async (req, res) => {
  try {
    console.log('[Proxy] Received TTS request:', req.body);
    
    const { text, voiceStyle = 'robot2' } = req.body;
    
    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }

    const kikashiApiKey = process.env.KIKASHI_API_KEY || 'LtfpwqMwOx4oojH9YzpDtm6NYwt34hRIKWmWPwwH2Ax3I5YP6AjQolfAssVHL4zI';
    const kikashiUrl = `https://kikashi.io/api/tts?apiKey=${kikashiApiKey}`;
    
    console.log('[Proxy] Making request to Kikashi API...');
    
    const response = await fetch(kikashiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'SOVA-Game-Client/1.0'
      },
      body: JSON.stringify({
        text: text,
        voiceStyle: voiceStyle
      })
    });

    console.log('[Proxy] Kikashi API response status:', response.status);
    console.log('[Proxy] Kikashi API response headers:', Object.fromEntries(response.headers.entries()));

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Proxy] Kikashi API error:', errorText);
      return res.status(response.status).json({ 
        error: 'Kikashi API error', 
        details: errorText,
        status: response.status 
      });
    }

    // Check if response is audio
    const contentType = response.headers.get('content-type');
    console.log('[Proxy] Content-Type:', contentType);
    
    if (contentType && contentType.includes('audio')) {
      // Stream the audio response back to client
      res.set({
        'Content-Type': contentType,
        'Content-Length': response.headers.get('content-length')
      });
      
      response.body.pipe(res);
    } else {
      // If not audio, return as JSON (might be an error)
      const responseText = await response.text();
      console.log('[Proxy] Non-audio response:', responseText);
      
      try {
        const jsonResponse = JSON.parse(responseText);
        res.json(jsonResponse);
      } catch (e) {
        res.json({ error: 'Unexpected response format', response: responseText });
      }
    }

  } catch (error) {
    console.error('[Proxy] Server error:', error);
    res.status(500).json({ 
      error: 'Proxy server error', 
      details: error.message 
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`🎤 SOVA Voice Proxy Server running on http://localhost:${PORT}`);
  console.log(`📡 TTS endpoint: http://localhost:${PORT}/api/tts`);
  console.log(`❤️  Health check: http://localhost:${PORT}/health`);
}); 