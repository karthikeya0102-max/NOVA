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

The frontend includes browser-based voice input/output and a single-task Mission Mode. Missions use `/api/mission` SSE events carrying a mission ID, monotonically increasing sequence, stage/node IDs, dependencies, status, timestamp, and stage details. The graph adds nodes only when the backend emits them: request accepted, context preparation, optional Tavily search, NVIDIA model inference, and persisted response delivery. Intent classification, separate planning, and tool selection are not currently implemented and are not represented. The client also migrates the previously shipped `step_id` SSE format from a still-running backend process into the current event contract; unknown or malformed payloads remain explicit errors. Restart FastAPI after updating NOVA to use the current server event schema. Disconnects and cancellation stop later stages; an in-flight synchronous provider request may finish before the backend can observe cancellation. Ordinary chat continues to use `/api/chat`. Browser microphone recognition requires explicit confirmation, microphone permission, and a visible open page; it uses the browser Web Speech API and is unchanged by the desktop companion. Browser speech output uses device voices through `speechSynthesis`.

## Windows desktop companion

Install the project's Python requirements with `start.bat`, configure `.env` as above, and launch `RUN_NOVA_DESKTOP.bat`. The companion creates a Windows tray icon, starts or reuses the loopback FastAPI server, and offers Start, Pause, Resume, Open NOVA, and Exit controls. Its microphone remains off until Start is selected, unless the user separately consents to automatic wake listening at sign-in. The tray menu can add/remove a per-user Windows sign-in startup entry after a confirmation prompt. The desktop uses offline Windows SAPI for command transcription and spoken responses. The browser remains independently usable.

Equivalent PowerShell commands from the integrated project directory:

```powershell
.\.venv\Scripts\python.exe -m pip install -r .\requirements.txt
.\RUN_NOVA_DESKTOP.bat
```

The desktop wake engine is modular and uses openWakeWord + ONNX Runtime with local microphone capture. **A custom model is not yet available.** Upstream openWakeWord publishes no pre-trained “Hey NOVA” model; the “Hey Jarvis” model is not used as a substitute. Start therefore reports a missing-model error and does not claim to be listening until a trained `models/hey_nova.onnx` is supplied. No positive/negative audio samples or false-accept/false-reject measurements are included because representative consented recordings were not available. See [models/README.md](./models/README.md) for the dataset schema and evaluation command. Do not claim production reliability until that data is collected and evaluated.

The Voice Settings panel keeps `browserVoiceId`, `browserSpeechRate`, and `browserSpeechPitch` in browser local storage. Windows voice preferences (`windowsVoiceId` and `windowsSpeechRate`) are stored separately under `data/desktop/windows-voice.json`. Browser pitch is supported by Web Speech; Windows System.Speech does not expose a pitch setting in this implementation. A removed voice falls back to the provider default. Browser and Windows previews are independent.

### Desktop architecture and limitations

```text
Windows tray companion
  ├─ pystray/Pillow controls + per-user startup consent
  ├─ sounddevice capture → openWakeWord model (models/hey_nova.onnx)
  ├─ wake hit → microphone released → Windows SAPI dictation
  ├─ transcript → FastAPI /api/chat → existing NVIDIA Nemotron integration
  └─ answer → selected Windows SAPI voice

Next.js interface
  ├─ existing browser SpeechRecognition mic path → /api/chat (unchanged)
  ├─ browser speechSynthesis with independent saved voice/rate/pitch
  └─ desktop status/control and separate Windows voice settings → FastAPI
```

The desktop API is intended for the local server started by NOVA. Local development remains unauthenticated for compatibility and must not be exposed publicly. Production mode requires Supabase Auth bearer tokens and persistent PostgreSQL, scopes chat and memories by user, and disables hosted desktop controls. The tray process uses a Windows named mutex to prevent duplicate instances. Recognition/model/device errors are surfaced in the tray status and interface. The openWakeWord Python package is Apache-2.0; verify the license of any separately trained/downloaded model and its training data before redistribution. Porcupine was not integrated because its documented workflow requires a Picovoice AccessKey and custom keyword model.

## Production deployment

Vercel, Render, and Supabase setup, required environment variables, authenticated user isolation, optional SQLite migration, free-tier constraints, and post-deployment checks are documented in [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md). No deployment is triggered automatically by this repository configuration.

## Included
- Responsive chat UI
- NVIDIA Build hosted inference / Nemotron chat
- Optional Tavily search + research synthesis with source links
- SQLite-backed local chat history and memories; PostgreSQL-backed, account-isolated production history and memories
- Safe arithmetic calculator
- Provider diagnostics and clear error messages
- Local-only server binding; API keys never enter browser JavaScript
- Windows tray companion, native SAPI speech, and independent browser/Windows voice preferences (wake model still required)

The configured model ID must be exact and available to your NVIDIA Build account. Valid code cannot bypass missing credits or permissions. Ordinary chat works without a Tavily key; web research requires one. Desktop voice commands make ordinary `/api/chat` calls and therefore use the configured inference provider at runtime. Development tests do not invoke Nemotron. Do not expose the local server publicly without authentication and rate limiting.

Run the deterministic desktop/backend tests without making provider calls:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s .\tests -v
```

Run Mission Mode frontend event/reducer tests with Node.js 22.6 or newer, and run the strict frontend type check:

```powershell
cd .\frontend
corepack pnpm test:mission
corepack pnpm exec tsc --noEmit
```
