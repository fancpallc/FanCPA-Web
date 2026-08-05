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
