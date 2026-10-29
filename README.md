# NOVA — complete local AI assistant

## Run on Windows
1. Extract this folder.
2. Double-click `start.bat`. First run creates `.venv`, installs dependencies, and opens `.env` in Notepad.
3. Add your NVIDIA Build API key to `NEBIUS_API_KEY` in `.env`. Set `NEBIUS_MODEL` to `nvidia/nemotron-3.5-bolt-e4b` and `NEBIUS_BASE_URL` to `https://integrate.api.nvidia.com/v1`. `TAVILY_API_KEY` is optional and is only needed for web research.
4. Save `.env` and double-click `start.bat` again.
5. Open http://127.0.0.1:8000 and use the live provider test buttons.

## Run the cinematic Next.js frontend
Keep the FastAPI server running at http://127.0.0.1:8000. In a second PowerShell terminal:

```powershell
cd C:\path\to\NOVA-Complete\frontend
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

Open http://localhost:3000. The frontend connects to the local backend on startup through a same-origin Next.js API route proxy, which also forwards mission SSE events without buffering; no FastAPI CORS changes are needed. To use a different backend, enter its URL in Settings; direct cross-origin connections may require that backend to allow the frontend origin. To point the proxy at a different backend, set `NOVA_API_BASE_URL` before starting the development server or production server. The original `nova-system-development` folder is kept separately from this integrated copy.

The frontend includes browser-based voice input/output and a single-task Mission Mode. Missions use the `/api/mission` SSE endpoint to drive an interactive 3D task graph from backend-confirmed context preparation, actual Tavily search activity when research is enabled, model inference, and the final answer. Ordinary chat continues to use `/api/chat`. Voice recognition requires explicit confirmation, microphone permission, and a visible open page; the browser may process microphone audio using its speech service. NOVA receives recognized text, not microphone audio. “Hey NOVA” wake listening is configurable, uses fresh browser recognition sessions with bounded recovery, and is not a background service. Wake listening pauses after a command and while NOVA speaks to prevent audio feedback; use the microphone for one-shot voice input if wake recognition is unsupported.

## Included
- Responsive chat UI
- NVIDIA Build hosted inference / Nemotron chat
- Optional Tavily search + research synthesis with source links
- SQLite persistent chat history and saved memory notes
- Safe arithmetic calculator
- Provider diagnostics and clear error messages
- Local-only server binding; API keys never enter browser JavaScript

The configured model ID must be exact and available to your NVIDIA Build account. Valid code cannot bypass missing credits or permissions. Ordinary chat works without a Tavily key; web research requires one. Do not expose the local server publicly without authentication and rate limiting.
