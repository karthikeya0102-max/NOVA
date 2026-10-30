# NOVA deployment and account-data security

This repository is configured for a Next.js frontend on Vercel and the existing FastAPI/NVIDIA backend on Render, with Supabase providing password-based accounts and PostgreSQL. Deployment is manual; no service has been created or deployed by this change.

## Architecture

```text
Browser
  ├─ Supabase Auth client (public publishable/anon key; persisted user session)
  └─ Same-origin Next.js API proxy on Vercel
       ├─ forwards only Authorization, Content-Type, and Accept
       ├─ streams Mission Mode SSE without buffering
       └─ sends the verified-by-backend bearer token to FastAPI on Render
            ├─ verifies Supabase JWT signature via the project's public JWKS
            ├─ enforces per-user data ownership and request limits
            ├─ keeps desktop/tray endpoints local-only
            └─ persists messages and memories in Supabase PostgreSQL
```

Only `/healthz` is public in production; the legacy backend HTML root and API documentation are disabled. Every `/api/*` route requires a valid Supabase access token; the backend verifies the signature, issuer, audience, authenticated-user role, expiry, and UUID subject. API keys and the database connection string remain on Render. The browser never receives a database password, NVIDIA key, or Supabase service-role/secret key.

Production tables use `user_id` ownership filters. PostgreSQL Row Level Security is enabled with no direct-client policies, so the Supabase Data API cannot read or modify the tables; all data access goes through the authenticated FastAPI API. The browser sends bearer tokens only to its same-origin Vercel proxy. User chat and memories are isolated, and existing history is reloaded after sign-in.

Local development remains unauthenticated when no Supabase or PostgreSQL URL is configured, preserving `RUN_NOVA.bat`, SQLite, the desktop assistant, and direct local backend use. Do not expose a server running in development mode to the public internet.

## Create and configure services

### 1. Supabase

1. Create a Supabase project and set up Email/Password authentication. Enable email confirmation and configure the allowed redirect URL to the eventual Vercel origin.
2. Use an asymmetric JWT signing key (ES256 or RS256) for user access tokens. The FastAPI verifier uses the Supabase JWKS endpoint; it intentionally rejects legacy HS256 tokens and service-role tokens.
3. Copy the project URL and the public publishable/legacy anon key. These go to the locations below. Do **not** copy a `service_role` or secret key.
4. In **Connect**, choose the **Session pooler** connection string for the persistent Render backend. The shared session pooler is IPv4-compatible; Supabase direct connections are IPv6-only on the Free plan. Keep the database password private and require TLS (`sslmode=require` is enforced by NOVA).

On its first start, NOVA creates the `messages` and `memories` tables and enables RLS. No table data is exposed through the Supabase REST/Data API.

### 2. Render FastAPI service

1. Create a Render Web Service from this repository using `render.yaml` (Blueprint), or configure the same commands manually:
   - Root directory: repository root (`NOVA-Complete`)
   - Build: `pip install -r requirements-render.txt`
   - Start: `uvicorn app:app --host 0.0.0.0 --port $PORT --proxy-headers --forwarded-allow-ips=*`
   - Health check: `/healthz`
2. Set the prompted secret/environment values:
   - `DATABASE_URL`: Supabase **Session pooler** connection string
   - `SUPABASE_URL`: Supabase project URL
   - `NOVA_CORS_ORIGINS`: exact HTTPS Vercel origin, for example `https://your-project.vercel.app` (no path, no wildcard)
   - `NEBIUS_API_KEY`: existing NVIDIA Build key
3. `NOVA_ENV`, `NEBIUS_MODEL`, and `NEBIUS_BASE_URL` are configured in the blueprint. Keep `NOVA_ENV=production`. Startup refuses production without PostgreSQL, Supabase, HTTPS CORS, and the existing model credentials. Production API docs are disabled.

`requirements-render.txt` deliberately omits desktop microphone, tray, and ONNX model packages. The desktop application remains a separate local Windows companion and is not exposed by the hosted backend.

### 3. Vercel frontend

1. Import the repository into Vercel and set **Root Directory** to `frontend`.
2. Set these environment variables for the deployment:
   - `NEXT_PUBLIC_SUPABASE_URL`: Supabase project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Supabase public publishable/anon key
   - `NOVA_API_BASE_URL`: Render backend origin, e.g. `https://nova-api.onrender.com` (server-side only)
3. Deploy the frontend, then update Render's `NOVA_CORS_ORIGINS` to the exact Vercel production origin and restart/redeploy the backend.
4. In Supabase Auth URL settings, set the Site URL and allowed redirect URL to the exact Vercel origin. If using a custom domain, add that origin to both Supabase and Render CORS.

The Next.js proxy does not fall back to localhost in production, forwards only required request headers, caps request bodies, and returns generic network errors. Authenticated requests cannot be redirected to a user-entered backend URL.

### Environment variable placement

| Variable | Set in | Secret? |
|---|---|---|
| `DATABASE_URL` | Render only | **Yes** |
| `SUPABASE_URL` | Render; frontend URL is also used in Vercel | No |
| `NOVA_CORS_ORIGINS` | Render only | No |
| `NOVA_API_BASE_URL` | Vercel only | No |
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel only | No |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel only | Public client key; never use the service-role key |
| `NEBIUS_API_KEY` | Render only | **Yes** |
| `NEBIUS_MODEL` | Render | No |
| `NEBIUS_BASE_URL` | Render | No |

`NEBIUS_*` is the project's existing configuration naming; the endpoint remains NVIDIA's OpenAI-compatible API. No new AI provider or paid service was added. Actual inference and optional existing Tavily research can incur the account's existing provider charges; automated tests do not call either provider.

## Optional SQLite history migration

The current local SQLite file contains existing history. It is not uploaded or changed by deployment. To preserve it in PostgreSQL, first create the Supabase Auth account that will own the local records, then copy that user's UUID from **Authentication → Users**. The migration is explicitly single-owner, refuses a non-empty PostgreSQL target, creates a new SQLite backup, retains the source file, and never overwrites an existing backup.

Run this **before sending any chat requests** to the hosted NOVA instance. From the repository root in PowerShell:

```powershell
$secureUrl = Read-Host "Supabase PostgreSQL Session pooler connection string" -AsSecureString
$env:DATABASE_URL = [System.Net.NetworkCredential]::new("", $secureUrl).Password
$ownerId = Read-Host "UUID of the existing Supabase Auth user who owns this local history"
.\.venv\Scripts\python.exe .\tools\migrate_sqlite_to_postgres.py `
  --sqlite .\data\nova.db `
  --backup "$env:USERPROFILE\Documents\nova-before-postgres.sqlite3" `
  --owner-user-id $ownerId
Remove-Item Env:DATABASE_URL
```

If that backup path already exists, choose another path; the migration refuses to overwrite it. Review the printed row counts only. No message contents are printed. If the hosted database is already in use, the script stops rather than merging data; do not delete hosted data to force migration.

## Verification after deployment

1. `GET https://<render-service>.onrender.com/healthz` should return `{"status":"ok"}`. This endpoint reveals no provider configuration or secrets.
2. Open the Vercel origin. Confirm that signed-out users see the account screen; create/sign in with an email account and verify the email if prompted.
3. Send a normal chat and a Mission Mode request. Confirm both work, Mission Mode SSE streams through the proxy, and the conversation reloads after refreshing.
4. Create a memory as one account, then sign in as another account and confirm that the history and memory are not visible. Do not use shared accounts for this check.
5. Confirm an unauthenticated request to `/api/history` receives HTTP 401, an unauthenticated `/healthz` still works, and hosted `/api/desktop/status` returns 404.
6. Confirm the production browser never calls a backend origin other than the Vercel origin. The Vercel proxy forwards to the configured Render URL server-side.

## Cost, free-tier, and remaining operational limits

- **Supabase Free** currently includes 500 MB of database storage; projects pause after one week of inactivity and the plan has no automatic backups. Back up important data separately. See [Supabase pricing](https://supabase.com/pricing).
- **Render Free** web services sleep after 15 minutes without inbound traffic and have ephemeral disks; they are suitable for previews, not production availability. NOVA therefore stores no production data on Render's filesystem. Render Free PostgreSQL expires after 30 days, so this configuration does not use it. See [Render free services](https://render.com/docs/free).
- **Vercel Hobby** is for personal, non-commercial use. Use an eligible paid plan for commercial use. See [Vercel Hobby](https://vercel.com/docs/plans/hobby).
- These free services can sleep, pause, or become unavailable. For a production deployment, use plans with availability guarantees and backups before storing important user data.
- Rate limits are process-local (10 combined AI/research requests per user per minute; 120 other API requests per user per minute). They are effective for a single backend instance but are not shared across multiple replicas; use a shared limiter before scaling horizontally.
- Supabase JWT verification depends on network access to the project's JWKS endpoint when the signing key is not cached. If the project rotates keys, the verifier refreshes its key set.
- The hosted service intentionally disables Windows tray/microphone controls. Wake-word detection and Windows SAPI remain local desktop functionality; browser voice and Mission Mode remain available in the web UI.
- No live Supabase, Render, Vercel, NVIDIA, or Tavily deployment/API call was performed for this implementation. A real PostgreSQL integration and account sign-in must be verified by the operator after provisioning the services.
