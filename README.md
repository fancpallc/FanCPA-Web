# FanCPA-Web

CPA web application built with React (Vite) and Cloudflare Pages Functions (Workers).

## Stack

- **Frontend:** React + TypeScript + Vite (`src/`)
- **Backend:** Cloudflare Pages Functions (`functions/`) — each file maps to an API route
- **Config:** `wrangler.toml` — environment vars and Pages build settings
- **Containerization:** Docker Compose for local dev; separate Dockerfiles for frontend/backend

## Project structure

```
├── src/                  # React frontend
├── functions/            # Cloudflare Pages Functions (API)
│   └── api/
│       └── health.ts     # GET /api/health
├── wrangler.toml         # Cloudflare Pages + Workers config
├── docker-compose.yml    # Local dev (frontend + backend)
├── Dockerfile.frontend
├── Dockerfile.backend
└── index.html
```

## Quick start (Docker)

```bash
docker compose up
```

- Frontend: http://localhost:5173
- Backend (Pages dev): http://localhost:8788
- Health check: http://localhost:8788/api/health

## Quick start (local)

Requires Node 20+.

```bash
npm install
npm run build
npx wrangler pages dev dist --local --port 8788   # terminal 1
npm run dev                                        # terminal 2
```

## Tests

```bash
npm test              # frontend tests
npm run test:workers  # API / worker tests

# Or via Docker:
docker compose run --rm tests
```

## Cloudflare deployment

1. Create a Cloudflare Pages project linked to this repo.
2. Build command: `npm run build`
3. Build output directory: `dist`
4. Functions are auto-deployed from the `functions/` folder.
5. Set environment variables in the Cloudflare dashboard (`ENVIRONMENT`, `SITE_URL`, etc.).

## Slice 3 — Booking Meeting (core) ✅

- **Email**: Resend `api.resend.com/emails` verified domain `bookings@yourdomain.com` (Env: `EMAIL_FROM`) — Includes Meet + cancel + purpose + dateTime ET. **Gmail API fallback** (`sendViaGmail`) via OAuth `GOOGLE_OAUTH_*` if Resend unavailable.

## Drive setup — Option B OAuth (current)

1. Google Cloud Console → project `fancpa-all` → APIs: enable Calendar + Drive.
2. OAuth consent screen → add scope `https://www.googleapis.com/auth/drive.file` alongside `calendar` and `calendar.events`.
3. Credentials → OAuth 2.0 Client → regenerate **refresh token** with the new drive scope (offline access).
4. Create a root folder in My Drive (e.g. "FanCPA Clients") → share nothing; copy its ID from URL `https://drive.google.com/drive/folders/<ID>` → `GOOGLE_DRIVE_ROOT_FOLDER_ID`.
5. Set env vars in Cloudflare Dashboard (production/preview) and in `.dev.vars` locally:
   ```
   GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN,
   GOOGLE_DRIVE_ROOT_FOLDER_ID (optional, defaults to My Drive root),
   GOOGLE_DRIVE_OWNER_EMAIL (optional, skip sharing when email equals owner)
   ```
6. Flow: `email / year` folder created under root, shared Writer with client; new years filed under same email parent; admin override via `contacts.drive_folder_id` moves future year folders.

Local/test/stub: returns `fake-*` Drive links; no real API calls (`ENVIRONMENT=local|test` or `STUB=true` or missing OAuth config → stub).

## API

### `GET /api/health`

Returns JSON:

```json
{
  "status": "ok",
  "message": "FanCPA API is running",
  "timestamp": "2026-08-01T00:00:00.000Z",
  "env": "local"
}
```
