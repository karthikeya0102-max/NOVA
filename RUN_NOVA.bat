@echo off
setlocal
set "NOVA_ROOT=%~dp0"
if /i "%~1"=="--backend" goto backend
if /i "%~1"=="--frontend" goto frontend

cd /d "%NOVA_ROOT%"
echo.
echo  NOVA - local launcher
echo  --------------------

if not exist ".venv\Scripts\python.exe" (
  echo ERROR: NOVA's project Python environment was not found.
  echo Run these commands from "%NOVA_ROOT%":
  echo   py -3 -m venv .venv
  echo   .venv\Scripts\python.exe -m pip install -r requirements.txt
  goto failed
)

".venv\Scripts\python.exe" -c "import fastapi,uvicorn,openai,tavily,dotenv,pydantic" >nul 2>&1
if errorlevel 1 (
  echo ERROR: One or more FastAPI dependencies are missing from NOVA's virtual environment.
  echo Run this command from "%NOVA_ROOT%":
  echo   .venv\Scripts\python.exe -m pip install -r requirements.txt
  goto failed
)

if not exist ".env" (
  echo ERROR: The backend .env file is missing. Its contents will not be changed by this launcher.
  echo Run start.bat once to create and configure .env, then close that server before retrying.
  goto failed
)

if not exist "frontend\package.json" (
  echo ERROR: frontend\package.json was not found.
  echo Confirm the NOVA frontend is present under "%NOVA_ROOT%frontend".
  goto failed
)

if not exist "frontend\pnpm-lock.yaml" (
  echo ERROR: The expected frontend pnpm-lock.yaml was not found.
  echo This launcher uses the project's locked pnpm setup and will not select another package manager.
  goto failed
)

where corepack.cmd >nul 2>&1
if errorlevel 1 (
  echo ERROR: Corepack was not found on PATH; NOVA requires the pnpm version pinned by package.json.
  echo Install or enable Corepack with Node.js, then open a new terminal and retry.
  goto failed
)

if not exist "frontend\node_modules\next\package.json" (
  echo ERROR: Frontend dependencies are not installed.
  echo Run these commands:
  echo   cd /d "%NOVA_ROOT%frontend"
  echo   corepack pnpm install --frozen-lockfile
  goto failed
)

set "NOVA_BACKEND_RUNNING=0"
set "NOVA_FRONTEND_RUNNING=0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$c=Get-NetTCPConnection -State Listen -LocalPort 8000 -ErrorAction SilentlyContinue | Select-Object -First 1; if (!$c) { exit 0 }; $p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$c.OwningProcess); if ($p.Name -eq 'python.exe' -and $p.CommandLine -like '*.venv\Scripts\python.exe*' -and $p.CommandLine -like '*-m uvicorn app:app --host 127.0.0.1 --port 8000*') { exit 10 }; exit 20" >nul 2>&1
if errorlevel 20 (
  echo ERROR: Port 8000 is occupied by a process that does not match this NOVA backend.
  echo No services were started or stopped. Inspect the listener with:
  echo   netstat -ano ^| findstr ":8000"
  echo Do not terminate it unless you have confirmed it is safe to do so.
  goto failed
)
if errorlevel 10 set "NOVA_BACKEND_RUNNING=1"

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$root=[IO.Path]::GetFullPath($env:NOVA_ROOT).TrimEnd('\'); $c=Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue | Select-Object -First 1; if (!$c) { exit 0 }; $p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$c.OwningProcess); $expected=($root+'\frontend\node_modules\'); if ($p.Name -eq 'node.exe' -and $p.CommandLine -like ('*'+$expected+'*') -and $p.CommandLine -like '*next\dist\server\lib\start-server.js*') { exit 10 }; exit 20" >nul 2>&1
if errorlevel 20 (
  echo ERROR: Port 3000 is occupied by a process that does not match this NOVA frontend.
  echo No services were started or stopped. Inspect the listener with:
  echo   netstat -ano ^| findstr ":3000"
  echo Do not terminate it unless you have confirmed it is safe to do so.
  goto failed
)
if errorlevel 10 set "NOVA_FRONTEND_RUNNING=1"

if "%NOVA_BACKEND_RUNNING%"=="1" (
  echo Reusing the NOVA FastAPI service already running on port 8000.
) else (
  echo Starting FastAPI in a separate minimized window...
  start "NOVA FastAPI" /min "%ComSpec%" /k ""%~f0" --backend"
)

echo Waiting up to 30 seconds for FastAPI at http://127.0.0.1:8000 ...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$deadline=(Get-Date).AddSeconds(30); do { try { $response=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8000/api/status' -TimeoutSec 2; if ($response.StatusCode -eq 200) { exit 0 } } catch {}; Start-Sleep -Seconds 1 } while ((Get-Date) -lt $deadline); exit 1" >nul 2>&1
if errorlevel 1 (
  echo ERROR: FastAPI did not become ready at http://127.0.0.1:8000/api/status.
  echo Check the minimized NOVA FastAPI window for startup or configuration errors.
  echo Confirm .venv dependencies and the backend configuration in .env, then retry.
  goto failed
)

echo FastAPI is responding.
if "%NOVA_FRONTEND_RUNNING%"=="1" (
  echo Reusing the NOVA frontend already running on port 3000.
) else (
  echo Starting Next.js in a separate minimized window...
  start "NOVA Frontend" /min "%ComSpec%" /k ""%~f0" --frontend"
)

echo Waiting up to 60 seconds for the frontend and backend proxy ...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$deadline=(Get-Date).AddSeconds(60); do { try { $page=Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:3000' -TimeoutSec 3; $api=Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:3000/api/status' -TimeoutSec 3; if ($page.StatusCode -eq 200 -and $page.Content -match 'NOVA.*Personal Intelligence' -and $api.StatusCode -eq 200 -and $api.Content -match 'nebius_configured') { exit 0 } } catch {}; Start-Sleep -Seconds 1 } while ((Get-Date) -lt $deadline); exit 1" >nul 2>&1
if errorlevel 1 (
  echo ERROR: NOVA frontend or its FastAPI proxy did not respond successfully within 60 seconds.
  echo Check the NOVA Frontend and NOVA FastAPI windows for startup errors.
  echo If dependencies are missing, run:
  echo   cd /d "%NOVA_ROOT%frontend"
  echo   corepack pnpm install --frozen-lockfile
  goto failed
)

echo NOVA is ready. Opening http://localhost:3000 ...
start "" "http://localhost:3000"
exit /b 0

:backend
cd /d "%NOVA_ROOT%"
".venv\Scripts\python.exe" -m uvicorn app:app --host 127.0.0.1 --port 8000
if errorlevel 1 (
  echo.
  echo ERROR: FastAPI exited with an error. Check the message above and .env configuration.
  pause
)
exit /b

:frontend
cd /d "%NOVA_ROOT%frontend"
call corepack pnpm dev --hostname 127.0.0.1 --port 3000
if errorlevel 1 (
  echo.
  echo ERROR: Next.js exited with an error. Check the message above and frontend dependencies.
  echo If dependencies are missing, run: corepack pnpm install --frozen-lockfile
  pause
)
exit /b

:failed
echo.
echo NOVA was not fully started. Review the message above, resolve it, and run RUN_NOVA.bat again.
pause
exit /b 1
