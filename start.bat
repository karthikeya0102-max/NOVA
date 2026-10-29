@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  py -3 -m venv .venv
  if errorlevel 1 (echo Install Python 3.11+ and retry.& pause & exit /b 1)
)
".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -r requirements.txt
if errorlevel 1 (echo Dependency installation failed.& pause & exit /b 1)
if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo Created .env. Add your API keys and model ID, save, then run start.bat again.
  notepad ".env"
  pause
  exit /b 0
)
".venv\Scripts\python.exe" -m uvicorn app:app --host 127.0.0.1 --port 8000
pause
