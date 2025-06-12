@echo off
echo Starting SOVA Voice Proxy Server...

REM Optional: Set environment variables here (uncomment and modify as needed)
REM set KIKASHI_API_KEY=your-kikashi-api-key-here
REM set PROXY_PORT=3001

REM Check if Node.js is installed
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Error: Node.js is not installed or not in PATH
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

REM Check if proxy dependencies are installed
if not exist node_modules (
    echo Installing proxy server dependencies...
    npm install express cors node-fetch
    if %errorlevel% neq 0 (
        echo Error: Failed to install dependencies
        pause
        exit /b 1
    )
)

REM Start the proxy server in background
echo Starting proxy server on port 3001...
start "SOVA Voice Proxy" cmd /k "node proxy-server.cjs"

REM Wait a moment for proxy to start
timeout /t 3 /nobreak >nul

echo Proxy server started! You can now use voice synthesis in the game.
echo.
echo To start your main application:
echo   npm run dev
echo.
echo To stop the proxy server, close the "SOVA Voice Proxy" window.
echo.
pause 