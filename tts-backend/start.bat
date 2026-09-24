@echo off
setlocal
cd /d "%~dp0"

REM Use a fresh .venv; older checkouts may contain a broken relocated venv.
if not exist ".venv\Scripts\python.exe" (
    if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" (
        "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" -m venv .venv
    ) else (
        py -3.12 -m venv .venv
    )
    if errorlevel 1 (
        echo Python 3.12 is required to create the local voice environment.
        exit /b 1
    )
)

".venv\Scripts\python.exe" -c "import fastapi, soundfile, kokoro, faster_whisper" >nul 2>&1
if errorlevel 1 (
    echo Installing local Kokoro and faster-whisper dependencies...
    ".venv\Scripts\python.exe" -m pip install torch --index-url https://download.pytorch.org/whl/cpu
    if errorlevel 1 exit /b 1
    ".venv\Scripts\python.exe" -m pip install -r requirements.txt
    if errorlevel 1 exit /b 1
)

".venv\Scripts\python.exe" -u app.py

