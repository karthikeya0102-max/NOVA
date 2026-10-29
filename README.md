# NOVA — complete local AI assistant

## Run on Windows
1. Extract this folder.
2. Double-click `start.bat`. First run creates `.venv`, installs dependencies, and opens `.env` in Notepad.
3. Add your NVIDIA Build API key to `NEBIUS_API_KEY` in `.env`. Set `NEBIUS_MODEL` to `nvidia/nemotron-3.5-bolt-e4b` and `NEBIUS_BASE_URL` to `https://integrate.api.nvidia.com/v1`. `TAVILY_API_KEY` is optional and is only needed for web research.
4. Save `.env` and double-click `start.bat` again.
5. Open http://127.0.0.1:8000 and use the live provider test buttons.

## Included
- Responsive chat UI
- NVIDIA Build hosted inference / Nemotron chat
- Optional Tavily search + research synthesis with source links
- SQLite persistent chat history and saved memory notes
- Safe arithmetic calculator
- Provider diagnostics and clear error messages
- Local-only server binding; API keys never enter browser JavaScript

The configured model ID must be exact and available to your NVIDIA Build account. Valid code cannot bypass missing credits or permissions. Ordinary chat works without a Tavily key; web research requires one. Do not expose the local server publicly without authentication and rate limiting.
