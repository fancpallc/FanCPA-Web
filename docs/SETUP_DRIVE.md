# Drive Setup — Option B OAuth (current, verified 2026-08-29)

This is the canonical setup for the GDrive stack (PR-1..PR-9, Rev 3/4). The repo now uses **OAuth refresh-token** only — SA JWT fallback code exists as `DRIVE_*_KEY` alias for backward compat but does nothing in live path (see `functions/_lib/google-drive.ts:getDriveAccessToken` which throws on failure rather than fabricating `fake-*`).

## 1. Google Cloud Console

- Project (existing): `fancpa-all` (or create new)
- APIs → Enable:
  - Google Calendar API (`calendar-json.googleapis.com`)
  - Google Drive API (`drive.googleapis.com`)

## 2. OAuth consent

- OAuth consent screen → External or Internal
- Scopes → Add (all three required):
  - `https://www.googleapis.com/auth/calendar`
  - `https://www.googleapis.com/auth/calendar.events`
  - `https://www.googleapis.com/auth/drive.file`
- Test users → add the Drive owner email if External

## 3. Refresh token

- Credentials → Create OAuth 2.0 Client ID (Web app)
- Authorized redirect: `https://developers.google.com/oauthplayground`
- Go to OAuth Playground, select the three scopes above, authorize with the Drive owner account, Exchange → copy **refresh_token** (`1//0g...`)
- Any failure to include `drive.file` here → live bookings still create Calendar events but Drive returns stub and link is null (non-blocking, see `booking/confirm/[token].ts:222-244`).

## 4. Root folder (org unit)

- In My Drive of the OAuth owner, create folder e.g. `FanCPA Clients`
- Open it → URL `https://drive.google.com/drive/folders/<ID>` → copy `<ID>` → this is `GOOGLE_DRIVE_ROOT_FOLDER_ID`
- Do **not** share it. Clients get permission only on their `email / year` subfolder via `ensurePermission` (`google-drive.ts:63-103`) which skips owner-share.

## 5. Env vars

Cloudflare Dashboard → Pages → your project → Settings → Environment Variables (Production + Preview) and `.dev.vars` locally (copy from `.dev.vars.example`):

```
GOOGLE_OAUTH_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-...
GOOGLE_OAUTH_REFRESH_TOKEN=1//0g...
GOOGLE_DRIVE_ROOT_FOLDER_ID=1A2b...   # optional, defaults to My Drive root ("root" in API)
GOOGLE_DRIVE_OWNER_EMAIL=owner@example.com   # optional, makes ensurePermission skip owner-share (Drive errors 400 otherwise)

BOOKING_CALENDAR_ID=xxx@group.calendar.google.com  # secondary calendar — see Rev3 R4: its summary is shown as organizer
SITE_URL=https://your-domain
ENVIRONMENT=production|preview|alpha|local|test
RESEND_API_KEY=re_...
TURNSTILE_SECRET_KEY=...
```

Aliases honored at runtime (see `functions/_lib/env.ts`):
- Drive root: `GOOGLE_DRIVE_ROOT_FOLDER_ID`, `DRIVE_ROOT_FOLDER_ID`, `GDRIVE_ROOT_FOLDER_ID`, plus DB override via `admin_settings`/`settings` key `drive_root_folder_id` (checked by `getEffectiveDriveRootFolderId`).
- Owner email: `GOOGLE_DRIVE_OWNER_EMAIL`
- Drive SA key alias `GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY` exists but does nothing — OAuth is the live path.

Local/test/stub: `ENVIRONMENT=local|test` or `STUB=true` or missing OAuth config → returns `fake-<email>-<year>` (year id) and stable `fake-<email>` parent (L8) so `same email next year → reuse parent` can be exercised without real API.

## 6. Flow (what code does)

- `ensureClientDriveFolder(env, email, year, {parentFolderId?, db?})`:
  - Search `name=email` under `rootId` (escaped `'`, full `q` encoded) → if not found create.
  - Search `name=year` under email folder → create.
  - `ensurePermission(yearFolder, email, token, 'writer', ownerEmail)` + also on parent when `parentFolderId` override present (L4/AdminClients override via `contacts.drive_folder_id`).
  - Null guards: `if (!emailFolder.id) throw 'Failed to ensure email folder'` (H2 re-added).
  - Stub gate: checks `STUB` / `ENVIRONMENT` / missing creds (H3).
- Confirm flow (`booking/confirm/[token].ts`): Calendar event first (Google 200 required in live, 502 on stub leak C1), then Drive **non-blocking** — failure logs loudly but booking still succeeds and inserts without `drive_folder_url`, email sent without link.
- Admin update Drive link: `PATCH /api/admin/clients/drive-folder {contact_id, folder_url}` — no year (client-level, F4), writes `contacts.drive_folder_url`, `drive_folder_id`, `drive_is_manual=1`, refreshes `parent_folder_*` on year rows.
- Search: `search.ts` joins bookings by `contact_id IN (...)` + `deleted_at IS NULL` unless `showHidden=true`, includes cancelled rows so `client with only cancelled` doesn't vanish (S7).

## 7. Quota (R7)

- `GET /api/admin/r2-usage?checkQuota=true` → calls `getDriveStorageQuota` → `GET https://www.googleapis.com/drive/v3/about?fields=storageQuota`
- Returns account-wide `{usage, limit?, usageInDrive, usageInDriveTrash}` — 15GB free Gmail, not scoped to root folder. Label accordingly.
- `limit` absent on unlimited/pooled accounts — UI handles missing key.
- Cheap path (`checkQuota=false`) returns placeholder without R2 LIST or Drive call.

## 8. Verification

```bash
npm run lint
npm test -- --run
npm run test:workers -- --run
# full chain vs real SQLite (catches NOT NULL, missing columns like deleted_reason P0, S7 updated_at):
#   functions/_lib/gdrive-constraint.test.ts + full-schema.test.ts use node:sqlite (Node 22+/24 image)
docker compose run --rm tests
```

If any writer throws `NOT NULL constraint failed: client_drive_folders.email` — you missed 0014 binding; if `no such column: deleted_reason` — 0016 not applied (P0 that blanked admin table).
