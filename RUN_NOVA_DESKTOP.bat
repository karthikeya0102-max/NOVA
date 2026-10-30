@echo off
setlocal
set "NOVA_ROOT=%~dp0"
cd /d "%NOVA_ROOT%"

if not exist ".venv\Scripts\python.exe" (
  echo ERROR: NOVA's project Python environment was not found.
  echo Run start.bat once to create the environment, then retry.
  pause
  exit /b 1
)

".venv\Scripts\python.exe" -c "import fastapi,uvicorn,openai,tavily,dotenv,pydantic,openwakeword,sounddevice,pystray,PIL" >nul 2>&1
if errorlevel 1 (
  echo ERROR: Desktop assistant dependencies are missing from NOVA's Python environment.
  echo Run this command from "%NOVA_ROOT%":
  echo   .venv\Scripts\python.exe -m pip install -r requirements.txt
  pause
  exit /b 1
)

if exist ".venv\Scripts\pythonw.exe" (
  start "" ".venv\Scripts\pythonw.exe" desktop_assistant.py
  exit /b 0
)

".venv\Scripts\python.exe" desktop_assistant.py
if errorlevel 1 (
  echo.
  echo NOVA Desktop Assistant stopped with an error.
  pause
)
