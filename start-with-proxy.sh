#!/bin/bash

echo "🎤 Starting SOVA Voice Proxy Server..."

# Optional: Set environment variables here (uncomment and modify as needed)
# export KIKASHI_API_KEY="your-kikashi-api-key-here"
# export PROXY_PORT="3001"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Error: Node.js is not installed or not in PATH"
    echo "Please install Node.js from https://nodejs.org/"
    exit 1
fi

echo "✅ Node.js version: $(node --version)"

# Check if proxy dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing proxy server dependencies..."
    npm install express cors node-fetch
    if [ $? -ne 0 ]; then
        echo "❌ Error: Failed to install dependencies"
        exit 1
    fi
fi

# Start the proxy server in background
echo "🚀 Starting proxy server on port 3001..."
node proxy-server.cjs &
PROXY_PID=$!

# Wait a moment for proxy to start
sleep 3

echo "✅ Proxy server started with PID: $PROXY_PID"
echo ""
echo "🎮 You can now use voice synthesis in the game!"
echo ""
echo "To start your main application:"
echo "  npm run dev"
echo ""
echo "To stop the proxy server:"
echo "  kill $PROXY_PID"
echo ""
echo "Press Ctrl+C to stop the proxy server and exit."

# Keep script running and handle Ctrl+C
trap "echo ''; echo '🛑 Stopping proxy server...'; kill $PROXY_PID 2>/dev/null; echo '✅ Proxy server stopped.'; exit 0" INT

# Wait for the proxy process
wait $PROXY_PID 