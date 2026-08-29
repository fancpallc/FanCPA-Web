# Client Portal + Admin Extensions – PR Breakdown (10 PRs, each <200k tokens) – Compact

> Each PR uses `---prompt---` for AI input (what to implement) and `---verify---` for Docker + manual test.
> Original: `CLIENT_PORTAL_PLAN.md`. Features: GDrive per email+year (owner+client only), link in confirmation email, public client portal (email+Turnstile→email), admin search by email/first/last, editable drive link, send upcoming meetings, time range filter, admin add manual booking (auto gdrive + auto meet + calendar blocking + optional email), admin delete + optional cancel.
> **PR-10 (Rev 2)** closes the gaps found reviewing PR-1..PR-9 against intent: Drive link is 1:1 with the client and rendered once at the top of the client card, admin lookup by Drive link, checkbox selection of which meetings to forward, client portal email carries upcoming meetings + cancel links, cancellation notifies the client — plus the missing admin auth check on `DELETE /api/admin/bookings/:id`.
> **Auth**: Option B OAuth single client `fancpa-all` with scopes `calendar + calendar.events + drive.file`. CLIENT_ID/SECRET same, only REFRESH_TOKEN regenerated with drive scope. Drive root folder via Cloudflare env var `GOOGLE_DRIVE_ROOT_FOLDER_ID` (no admin UI scan needed – per compact request).

**Stack**: Vite React SPA, Cloudflare Pages Functions (D1 fancpa-db, R2), Resend, GCal SA+OAuth. `docker-compose.yml`: frontend 5173, backend 8788, tests (lint+build+vitest).

**Global Docker**:
```bash
docker compose run --rm tests                                   # full CI
docker compose run --rm tests sh -c "npm run test:workers -- --run"
docker compose run --rm tests sh -c "npm run test:workers -- --run functions/_lib/google-drive.test.ts"
docker compose run --rm tests sh -c "npm test -- --run src/pages/ClientPortal.test.tsx"
docker compose up -d backend frontend
curl http://localhost:8788/api/health
docker compose logs -f backend
docker compose down
```

---

## PR-1: DB Migration + Env + Email Foundation

**Token**: ~12k – well under 200k

---prompt---

**Goal**: Unblock all. Create table + columns + env getters + backward-compatible email templates. No runtime change.

**Files**:

1. NEW `migrations/0014_client_drive_folders.sql`
```sql
CREATE TABLE client_drive_folders (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  year INTEGER NOT NULL CHECK (year >= 2000 AND year <= 2100),
  folder_id TEXT NOT NULL,
  folder_url TEXT NOT NULL,
  parent_folder_id TEXT,
  parent_folder_url TEXT,
  is_manual INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(contact_id, year)
);
CREATE INDEX idx_cdf_email ON client_drive_folders(email);
CREATE INDEX idx_cdf_contact_year ON client_drive_folders(contact_id, year);
ALTER TABLE bookings ADD COLUMN meet_link TEXT;
ALTER TABLE bookings ADD COLUMN time_zone TEXT;
ALTER TABLE bookings ADD COLUMN drive_folder_url TEXT;
```

2. MOD `functions/_lib/env.ts`
```diff
+const DRIVE_ROOT_ALIASES = ['GOOGLE_DRIVE_ROOT_FOLDER_ID','DRIVE_ROOT_FOLDER_ID','GDRIVE_ROOT_FOLDER_ID']
+const DRIVE_KEY_ALIASES = ['GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY','DRIVE_SERVICE_ACCOUNT_KEY','GCAL_SERVICE_ACCOUNT_KEY']
+const DRIVE_OWNER_ALIASES = ['GOOGLE_DRIVE_OWNER_EMAIL']
+export function getDriveRootFolderId(env){ return resolveEnvVar(env, DRIVE_ROOT_ALIASES) }
+export function getDriveServiceKey(env){ return resolveEnvVar(env, DRIVE_KEY_ALIASES) }
+export function getDriveOwnerEmail(env){ return resolveEnvVar(env, DRIVE_OWNER_ALIASES) }
+export async function getEffectiveDriveRootFolderId(env, db){ /* try admin_settings if exists else env else undefined */ }
```

3. MOD `functions/_lib/email.ts`
- `buildConfirmationEmail` add optional `driveLink?, driveYear?` → renders drive block when present (backward compatible)
- Add `buildClientPortalDriveEmail({firstName, driveLinks:{year,url}[]})`, `buildAdminDriveEmail({firstName, driveLink, meetings:[]})`
- Add `sendClientPortalDriveEmail`, `sendAdminDriveEmail` (same Resend pattern as existing)

**Tests**:
- `env.test.ts`: drive root alias resolve, key fallback to GCAL
- `email.test.ts`: confirmation includes drive link when provided, client portal lists multiple years

**Acceptance**: migration applies, getters work, email still works without driveLink.

---verify---

**Docker**:
```bash
docker compose run --rm tests sh -c "npm run lint && npm run test:workers -- --run functions/_lib/env.test.ts functions/_lib/email.test.ts"
docker compose run --rm backend sh -c "npm run migrate:local && npx wrangler d1 execute fancpa-db --local --command \"SELECT sql FROM sqlite_master WHERE name='client_drive_folders'\""
docker compose run --rm tests
```

**Manual**:
1. `docker compose up -d backend`
2. `curl http://localhost:8788/api/health` → db ok
3. Frontend http://localhost:5173 unchanged
4. D1 table exists

---

## PR-2: Google Drive Core Lib (OAuth Option B)

**Token**: ~25k

---prompt---

**Goal**: Drive lib isolated, stubbed for local, prefers OAuth when `hasOAuthConfig()` true (your Option B). No callers yet.

**Files**:

1. NEW `functions/_lib/google-drive.ts` (mirrors `google-calendar.ts` JWT/ OAuth pattern):
```ts
export interface DriveFolderResult { emailFolderId,emailFolderUrl,yearFolderId,yearFolderUrl,source:'live'|'stub' }
async function getDriveAccessToken(env){
  if(hasOAuthConfig(env)){ // Option B: refresh token already has drive.file scope from new consent
    const {accessToken}=await getOAuthAccessToken(env) // same function as calendar, returns token with calendar+drive scopes
    return {token:accessToken, source:'live'}
  }
  // fallback SA JWT scope https://www.googleapis.com/auth/drive
}
export function extractFolderId(url){ return /\/folders\/([A-Za-z0-9-_]+)/.exec(url)?.[1]||null }
export async function searchFolder(name,parentId,token){ q=`mimeType='application/vnd.google-apps.folder' and name='${name}' and '${parentId}' in parents and trashed=false`; fetch drive v3 files }
export async function createFolder(name,parentId,token){ POST drive v3 files {name,mimeType:folder,parents:[parentId]} }
export async function ensurePermission(folderId,email,token,role='writer'){ list permissions, POST if not exists, skip owner }
export async function ensureClientDriveFolder(env,emailRaw,yearRaw){
  normalize email, year 4-digit 2000-2100 else current year
  if ENVIRONMENT local/test or STUB or missing OAuth/SA -> stub fake ids `fake-${email}-${year}`, url `https://drive.google.com/drive/folders/fake-...`, source stub
  else token, rootId = await getEffectiveDriveRootFolderId(env, db) || getDriveRootFolderId(env) || 'root'  // root configurable via Cloudflare env var (compact, no admin UI scan)
  emailFolder = searchFolder(email,rootId) || createFolder(email,rootId); ensurePermission(emailFolder.id,email)
  yearFolder = searchFolder(String(year),emailFolder.id) || createFolder(String(year),emailFolder.id); ensurePermission(yearFolder.id,email)
  return {emailFolderId,emailFolderUrl:`https://drive.google.com/drive/folders/${emailFolder.id}`,yearFolderId,yearFolderUrl}
}
```

2. `.dev.vars` instruction (local Docker): add to repo root `.dev.vars` (gitignored):
```
GOOGLE_OAUTH_CLIENT_ID=xxx.apps.googleusercontent.com      # new fancpa-all client
GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-...
GOOGLE_OAUTH_REFRESH_TOKEN=1//0g...  # new with drive.file scope from Step 4
GOOGLE_DRIVE_ROOT_FOLDER_ID=1A2b...  # optional organizing folder ID from Step 5b
ENVIRONMENT=local
```

**Tests NEW `functions/_lib/google-drive.test.ts`**:
- stub returns fake id, source stub, year validation
- extractFolderId parses drive URL
- searchFolder null when files []
- createFolder returns id+link

**Acceptance**: stub doesn't throw, year always 4 digits, root configurable via env var fallback chain (DB if exists else env else root).

---verify---

**Docker**:
```bash
docker compose run --rm tests sh -c "npm run test:workers -- --run functions/_lib/google-drive.test.ts"
docker compose run --rm tests
```

**Manual**:
1. `docker compose up -d backend`
2. Stub: `docker compose run --rm backend sh -c "node --input-type=module -e \"import {ensureClientDriveFolder} from './functions/_lib/google-drive.ts'; const r=await ensureClientDriveFolder({ENVIRONMENT:'local'},'stubtest@example.com',2026); console.log(r);\""` → source stub
3. Live (with real OAuth new token, optional): set `.dev.vars` with new OAuth, then curl manual booking from PR-8 test will create real folder in `GOOGLE_DRIVE_ROOT_FOLDER_ID / email / year`, shared Writer with client

---

## PR-3: Booking Confirm Integration (auto Drive + persist meet/link)

**Token**: ~20k

---prompt---

**Goal**: On double opt-in confirm, create Drive folder, persist meet_link/time_zone/drive_folder_url, include drive link in confirmation email. Non-blocking – booking succeeds even if Drive fails. Don't delete on cancel.

**Files**:

MOD `functions/api/booking/confirm/[token].ts`
```diff
+import { ensureClientDriveFolder } from '../../../_lib/google-drive'
 ...
+ let driveResult=null, driveLink=null, meetingYear=new Date().getFullYear()
+ try{
+   meetingYear=new Date(pending.slot_start).getFullYear()
+   driveResult=await ensureClientDriveFolder(env, pending.email, meetingYear)
+   driveLink=driveResult?.yearFolderUrl
+   const upsert=db.prepare(`INSERT INTO client_drive_folders (contact_id,email,year,folder_id,folder_url,parent_folder_id,parent_folder_url) VALUES (?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(contact_id,year) DO UPDATE SET folder_url=excluded.folder_url, updated_at=datetime('now')`)
+   await upsert.bind(contactId, pending.email.toLowerCase(), meetingYear, driveResult.yearFolderId, driveResult.yearFolderUrl, driveResult.emailFolderId, driveResult.emailFolderUrl).run()
+   await db.prepare('UPDATE contacts SET drive_folder_url=?1 WHERE id=?2').bind(driveResult.emailFolderUrl, contactId).run()
+   await db.prepare('UPDATE bookings SET meet_link=?1, time_zone=?2, drive_folder_url=?3 WHERE id=?4').bind(meetLink, pending.time_zone||null, driveLink, bookingId).run()
+ }catch(e){ console.log(`!!! CONFIRM_DRIVE_ERROR ${e.message}`) }
- const emailResult=await sendConfirmationEmail({to:..., meetLink, cancelUrl, dateTime, purpose, env})
+ const emailResult=await sendConfirmationEmail({to:..., meetLink, cancelUrl, dateTime, purpose, driveLink, driveYear:meetingYear, env})
```

**Tests NEW `functions/api/booking/confirm/drive.test.ts`**:
- creates drive entry + email contains link
- non-blocking when drive throws → still 200 confirmed

---verify---

**Docker**:
```bash
docker compose run --rm tests sh -c "npm run test:workers -- --run functions/api/booking/confirm"
docker compose run --rm tests
```

**Manual**:
1. `docker compose up -d backend frontend`
2. Book `e2e-drive-new@example.com` via UI → logs show `PENDING_EMAIL... confirmUrl=http://localhost:8788/api/booking/confirm/<token>` → visit confirm → logs `CONFIRM_DRIVE_CREATE_RESULT source=stub`
3. D1: `docker compose run --rm backend sh -c "npx wrangler d1 execute fancpa-db --local --command \"SELECT email,year,folder_url FROM client_drive_folders\""`
4. Same email same year → upsert, not duplicate; different year → 2 rows
5. Cancel `http://localhost:8788/api/cancel/<token>` → D1 folders remain

---

## PR-4: Public Client Portal (email lookup + Turnstile)

**Token**: ~30k

---prompt---

**Goal**: `/client-portal` email lookup protected by Turnstile → email with drive link. Anti-enumeration generic success.

**Files**:

1. NEW `functions/api/client-portal/lookup.ts`
```ts
export const onRequestPost=async({request,env})=>{
  verifyTurnstile(turnstileToken, secret)
  lower=email
  SELECT contacts WHERE email=lower
  if(!contact) return {success:true, message:'If your email exists, we sent a link'}
  SELECT year,folder_url FROM client_drive_folders WHERE contact_id=? ORDER BY year DESC
  if(driveLinks.length) await sendClientPortalDriveEmail({to:contact.email, firstName:contact.first_name, driveLinks, env})
  return {success:true}
}
```

2. NEW `src/pages/ClientPortal.tsx` – input email, turnstile widget `#client-portal-turnstile-widget`, fetch POST lookup, generic success UI.

3. MOD `src/App.tsx` – route `/client-portal`

4. MOD `src/components/common/Nav.tsx` – add `Client Portal` link desktop + hamburger

5. MOD `src/lib/api.ts` – `lookupClientPortal`

**Tests**:
- `lookup.test.ts`: generic success when not found, email sent when found, 400 Turnstile invalid in prod
- `ClientPortal.test.tsx`: renders input + widget, disabled without token

---verify---

**Docker**:
```bash
docker compose run --rm tests sh -c "npm test -- --run src/pages/ClientPortal.test.tsx && npm run test:workers -- --run functions/api/client-portal/lookup.test.ts"
docker compose run --rm tests
```

**Manual**:
1. `docker compose up -d backend frontend`
2. http://localhost:5173/client-portal – form visible, Turnstile stub passes
3. Existing `e2e-drive-new@example.com` → generic success, logs Resend stub
4. Unknown → same generic success, no leak
5. Navbar link visible

---

## PR-5: Admin Client Portal Backend (search/edit/send)

**Token**: ~35k

---prompt---

**Goal**: Admin search by email/first/last, editable drive link, send upcoming meetings. Auth via `isAdminAuthenticated`.

**Files**:

1. NEW `functions/api/admin/clients/search.ts`
```ts
GET /api/admin/clients/search?q=
auth, if !q return {results:[]}
SELECT c.id as contact_id, c.first_name, c.last_name, c.email, b.id, b.meet_link, b.purpose, b.slot_start, b.time_zone, cdf.year, cdf.folder_url as year_folder_url
FROM contacts c LEFT JOIN bookings b ON b.contact_id=c.id AND status='confirmed' LEFT JOIN client_drive_folders cdf ON ...
WHERE lower(c.email) LIKE ?1 OR lower(c.first_name) LIKE ?1 OR lower(c.last_name) LIKE ?1 ORDER BY b.slot_start DESC LIMIT 100
```

2. NEW `functions/api/admin/clients/drive-folder.ts`
- GET `?contact_id=&year=` → row
- PATCH `{contact_id,year,folder_url}` → validate year `/^\d{4}$/`, URL regex `^https://drive.google.com/(drive/folders|file/d)/`, extract id, UPSERT is_manual=1

3. NEW `functions/api/admin/clients/send-email.ts`
- POST `{contact_id}` → future bookings `slot_start >= now()`, latest drive folder, sendAdminDriveEmail

4. MOD `src/lib/api.ts` – `AdminClientRow`, `searchAdminClients`, `updateAdminDriveFolder`, `sendAdminClientEmail`

**Tests**:
- `search.test.ts`: 401, filters case-insensitive, returns required fields, empty when q empty
- `drive-folder.test.ts`: 400 invalid URL, 404 contact, PATCH is_manual
- `send-email.test.ts`: 404, future only, sends even when no future

---verify---

**Docker**:
```bash
docker compose run --rm tests sh -c "npm run test:workers -- --run functions/api/admin/clients/"
docker compose run --rm tests
```

**Manual**:
```bash
curl "http://localhost:8788/api/admin/clients/search?q=e2e-drive"
curl -X PATCH http://localhost:8788/api/admin/clients/drive-folder -d '{"contact_id":"<id>","year":2026,"folder_url":"https://drive.google.com/drive/folders/edited123"}'
curl -X POST http://localhost:8788/api/admin/clients/send-email -d '{"contact_id":"<id>"}'
# D1: SELECT folder_url,is_manual FROM client_drive_folders WHERE year=2026
```

---

## PR-6: Admin Client Portal Frontend + Time Range Filter (compact)

**Token**: ~40k – merges previous PR-6 + PR-7 (time filter) to be compact, still <200k

---prompt---

**Goal**: Admin UI search + editable drive link + send + time range filter (Feature 3). Time filter applies to meeting start.

**Files**:

1. MOD `functions/api/admin/clients/search.ts` (extend from PR-5 to add date filter):
```diff
 const url=new URL(request.url); const q=..., startDate=url.searchParams.get('start_date'), endDate=url.searchParams.get('end_date')
 let query=`SELECT ... WHERE (lower(c.email) LIKE ?1 OR ...) `
 const binds=[like]; let idx=2
 if(startDate){ query+=` AND datetime(b.slot_start) >= datetime(?${idx}) `; binds.push(startDate); idx++ }
 if(endDate){ query+=` AND datetime(b.slot_start) <= datetime(?${idx}) `; binds.push(endDate); idx++ }
 query+=` ORDER BY b.slot_start DESC LIMIT 100`
 const {results}=await env.DB.prepare(query).bind(...binds).all()
```
Support POST body `{q, start_date, end_date}`.

2. MOD `src/lib/api.ts`
```ts
export async function searchAdminClients(q:string, opts?:{startDate?:string,endDate?:string}){
  const params=new URLSearchParams({q}); if(opts?.startDate) params.set('start_date',opts.startDate); if(opts?.endDate) params.set('end_date',opts.endDate)
  return fetchJson(`/api/admin/clients/search?${params}`)
}
```

3. NEW `src/pages/AdminClients.tsx` (now includes time filter):
- useAdminAuth, q, startDate, endDate (inputs type="date"), results, editing map, toast
- Sticky toolbar: Admin Client Portal, Back to Admin, View site
- Search card: input q (placeholder "Search by email, first name or last name") + From date + To date + Search button (calls searchAdminClients(q,{startDate,endDate}))
- Table columns: First, Last, Email, Meeting Time (formatted time_zone), Meeting URL (meet_link truncated), GDrive Link (input + Save), Purpose, Timezone, Actions Send
- Save → updateAdminDriveFolder, Send → sendAdminClientEmail
- Drive Settings note: shows current effective root from Cloudflare env var (read-only for now, configurable via Cloudflare `GOOGLE_DRIVE_ROOT_FOLDER_ID` – compact, no scan UI). Optional: show effectiveId fetched from `/api/admin/drive/config` if you keep config endpoint, but for compact we just display env var.

4. MOD `src/pages/Admin.tsx` – add button link to `/admin/clients`

5. MOD `src/App.tsx` – route `/admin/clients` if not already

**Tests**:
- `search.test.ts` add: filters by time range (Jan, Jun, Dec bookings, filter May-Jul → only Jun), returns all when no date
- `AdminClients.test.tsx`: renders search input + From/To date inputs, calls search with dates, table with required columns, editable save, Send triggers

**Acceptance**: Search with From/To filters by slot_start, without filters returns all, editable drive persists, Send works.

---verify---

**Docker**:
```bash
docker compose run --rm tests sh -c "npm test -- --run src/pages/AdminClients.test.tsx && npm run test:workers -- --run functions/api/admin/clients/search.test.ts"
docker compose run --rm tests
```

**Manual**:
1. `docker compose up -d backend frontend`
2. http://localhost:5173/admin/clients → shows From/To date pickers
3. Create bookings Jan, Jun, Dec via manual API, set From 2026-05-01 To 2026-07-01 → only Jun appears
4. Clear dates → all appear
5. Edit GDrive → Save → D1 is_manual=1
6. Send → toast + logs

---

## PR-7: Admin Add Record Backend + Frontend (auto GDrive + auto Meet) – compact

**Token**: ~50k – merges previous PR-8 + PR-9, still <200k

---prompt---

**Goal**: Admin can add new record: first name, last name, email, gdrive link auto generated, time start/end, meet link auto generated based on time, invitation + calendar blocking, ask if email should be sent.

**Files**:

1. MOD `functions/_lib/google-calendar.ts` – add `deleteBookingEvent(env, eventId, calendarId)` helper: DELETE `/calendars/{calendarId}/events/{eventId}` with Bearer token.

2. NEW `functions/api/admin/bookings/manual.ts`
```ts
Body: {first_name,last_name,email,phone?,purpose?,slot_start ISO, slot_end ISO, time_zone?, sendEmail?:boolean, drive_folder_url?:optional override}

Steps:
- auth admin, validate required, email regex, slot_start < slot_end, year 4-digit
- upsert contact (SELECT email, if exists UPDATE first/last/phone else INSERT id)
- Drive auto: meetingYear = new Date(slot_start).getFullYear(), driveResult=await ensureClientDriveFolder(env, email, meetingYear), driveLink = body.drive_folder_url || driveResult.yearFolderUrl, upsert client_drive_folders
- Calendar blocking + meet auto: createBookingEvent(env, {firstName,lastName,email,phone,purpose,slot:{start,end}, timeZone}) -> meetLink, calendarEventId; fallback fake meet link on stub
- Insert bookings: id, contact_id, calendar_event_id, meet_link, purpose, cancel_token, status confirmed, slot_start, slot_end, time_zone, drive_folder_url
- If sendEmail: sendConfirmationEmail with driveLink, meetLink, dateTime, cancelUrl
- Return {success, bookingId, meetLink, driveLink, calendarEventId}
```

3. MOD `src/pages/AdminClients.tsx` – add "+ Add Booking" button + modal:
- Form fields: first_name, last_name, email, phone, purpose, slot_start datetime-local, slot_end datetime-local, time_zone (default browser tz), checkbox sendEmail
- Note: "GDrive auto generated based on email+year, Meet auto generated from time"
- On Create: POST `/api/admin/bookings/manual` with slot_start.toISOString(), slot_end.toISOString(), sendEmail flag, shows result meetLink+driveLink, refreshes search
- Validation: required, start<end

4. MOD `src/lib/api.ts` – `createManualBooking(body)`

**Tests**:

- Backend `manual.test.ts`: 401 without auth, 400 missing fields, auto generates gdrive + meet link, blocks calendar (fetch called), sends email when sendEmail=true, uses override drive url when provided
- Frontend `AdminClients.test.tsx`: shows Add Booking button opens modal, calls createManualBooking, shows created result

---verify---

**Docker**:
```bash
docker compose run --rm tests sh -c "npm run test:workers -- --run functions/api/admin/bookings/manual.test.ts && npm test -- --run src/pages/AdminClients.test.tsx"
docker compose run --rm tests
```

**Manual**:
1. `docker compose up -d backend frontend`
2. http://localhost:5173/admin/clients → + Add Booking → fill Manual, manual-add@example.com, start 2030-03-15T13:00, end 14:00, purpose Tax, sendEmail unchecked → Create → result shows auto meet + drive, table refresh
3. D1: `npx wrangler d1 execute fancpa-db --local --command "SELECT email,year,folder_url FROM client_drive_folders WHERE email='manual-add@example.com'"`
4. With email checked → Create → logs Resend stub, calendar event created (if live OAuth, appears in Google Calendar)
5. Validation: empty email → 400

---

## PR-8: Admin Delete Record Backend + Frontend (optional cancel) – compact

**Token**: ~35k – merges previous PR-10 + PR-11, still <200k

---prompt---

**Goal**: Admin can delete record if no longer needed, confirm if meeting needs to be canceled, if so cancel meeting (delete calendar event + free slot).

**Files**:

1. MOD `functions/_lib/google-calendar.ts` – deleteBookingEvent already added in PR-7

2. NEW `functions/api/admin/bookings/[id].ts` (or `delete-booking.ts`):
```ts
DELETE /api/admin/bookings/:id?cancelMeeting=true/false
or POST body {booking_id, cancelMeeting}
Steps:
- auth admin, bookingId from params.id or query booking_id
- SELECT bookings WHERE id=?
- if cancelMeeting && calendar_event_id: delete from both booking calendar and personal calendar via deleteBookingEvent (ignore 404), log ADMIN_CANCEL_MEETING
- DELETE FROM bookings WHERE id=?
- Keep client_drive_folders (don't delete per requirement)
- Return {success, cancelled}
```

3. MOD `src/pages/AdminClients.tsx` – add Delete button per row + confirm modal:
- State deleteTarget, cancelMeetingChecked, deleteConfirmOpen
- Delete button → open modal with text "Delete booking for {first} {last} at {slot_start}? Drive folder will NOT be deleted." + checkbox "Also cancel meeting and free calendar?" + info
- Confirm → DELETE `/api/admin/bookings/${booking_id}?cancelMeeting=${cancelMeetingChecked}` → toast, refresh search

4. MOD `src/lib/api.ts` – `deleteBooking(bookingId, cancelMeeting)`

**Tests**:

- Backend `delete.test.ts`: 401, 404, deletes without cancelMeeting (fetch not called for calendar), deletes+cancel calls calendar delete, non-blocking when calendar delete fails
- Frontend: shows Delete per row, opens modal with cancel checkbox, calls deleteBooking with true/false

---verify---

**Docker**:
```bash
docker compose run --rm tests sh -c "npm run test:workers -- --run functions/api/admin/bookings/delete.test.ts && npm test -- --run src/pages/AdminClients.test.tsx"
docker compose run --rm tests
```

**Manual**:
1. `docker compose up -d backend frontend`
2. Create manual booking via UI Add → search it
3. Delete button → modal appears with cancel checkbox
4. Without cancel: Confirm → toast Deleted record → row gone → D1 booking gone, folders remain: `npx wrangler d1 execute ... SELECT * FROM client_drive_folders WHERE email='...'`
5. With cancel: Add new, Delete with checkbox checked → toast Deleted and cancelled → logs ADMIN_CANCEL_MEETING, slot becomes free in calendar http://localhost:5173
6. Edge: legacy booking no calendar_event_id → still deletes

---

## PR-9: Final Polish + .dev.vars instruction + E2E

**Token**: ~10k – docs + env var documentation, no major code

---prompt---

**Goal**: Document Cloudflare config for Drive root (compact, no admin UI scan) and finalize .dev.vars for Option B OAuth.

**Files**:

1. MOD `wrangler.toml` [vars] comment:
```
# Drive root folder where client email folders created. If empty, uses My Drive root.
# Set via Cloudflare Dashboard: GOOGLE_DRIVE_ROOT_FOLDER_ID = "1A2b..."
# With OAuth Option B, folders owned by you, shared Writer with client.
```

2. NEW/MOD `.dev.vars.example` (create if not exists):
```
# OAuth – new fancpa-all client with calendar + drive.file scopes (Option B)
GOOGLE_OAUTH_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-...
GOOGLE_OAUTH_REFRESH_TOKEN=1//0g...
GOOGLE_DRIVE_ROOT_FOLDER_ID=1A2b...  # optional organizing folder, get ID from https://drive.google.com/drive/folders/<ID>
RESEND_API_KEY=re_...
TURNSTILE_SECRET_KEY=0x4AAAA...
BOOKING_CALENDAR_ID=xxx@group.calendar.google.com
ENVIRONMENT=local
SITE_URL=http://localhost:8788
```

3. MOD `README.md` or `docs/SETUP_DRIVE.md` – add section "Drive setup Option B" with steps 1-5 from earlier conversation.

4. Ensure all previous PRs still under 200k – each PR file count: PR-1 3 files, PR-2 1 file + .dev.vars doc, PR-3 1 file, PR-4 2 files + 2 mods, PR-5 3 files, PR-6 1 mod + merge, PR-7 1 new + 1 mod, PR-8 1 new + 1 mod.

**Tests**: none new, just full suite green.

---verify---

**Docker – Full E2E**:
```bash
docker compose down && docker compose run --rm tests
# Should be green

# Live OAuth test with real Drive (requires .dev.vars with real new refresh token):
docker compose up -d backend frontend
curl -X POST http://localhost:8788/api/admin/bookings/manual -H "Content-Type: application/json" -d '{"first_name":"Final","last_name":"E2E","email":"final-e2e@example.com","slot_start":"2030-08-01T13:00:00Z","slot_end":"2030-08-01T14:00:00Z","purpose":"Final verification","sendEmail":false}'
# Check Drive UI: FanCPA Clients (or root) / final-e2e@example.com / 2030
# Check time filter: http://localhost:5173/admin/clients set From 2030-07-01 To 2030-08-15 → final-e2e appears
# Edit drive link → Save → Send → email
# Delete with cancel → calendar freed
# Client portal http://localhost:5173/client-portal → lookup final-e2e → generic success
# Navbar Client Portal link
```

**Manual final checklist (same as after PR-8 but including root config)**:

1. Cloudflare Preview+Production env vars set: `GOOGLE_OAUTH_CLIENT_ID`, `SECRET`, `REFRESH_TOKEN` (new with drive.file), optional `GOOGLE_DRIVE_ROOT_FOLDER_ID` (compact, no UI scan needed)
2. `.dev.vars` local has same 3 + optional root ID
3. All 8 previous PRs' manual tests still pass
4. Drive folders: `My Drive / <GOOGLE_DRIVE_ROOT_FOLDER_ID or root> / email / year` owned by you, shared Writer with client, only you+client have access
5. Confirmation email includes drive link (if Drive live)
6. No deletion on cancel or delete (drive remains)

---

## PR-10: Rev 2 – Client-level Drive Link, Meeting Forward Selection, Cancellation Email

**Token**: ~55k

> **Sequencing**: `docs/GDRIVE_STACK_GAP_ANALYSIS.md` audits PR-1..PR-9 as shipped and finds three
> blockers that PR-10 does not address — `PATCH /api/admin/clients/drive-folder` and
> `POST /api/admin/bookings/manual` both 500 on a NOT NULL violation against real D1, the client portal
> Turnstile fails open while its widget never renders, and the live Drive path duplicates folders instead
> of reusing them. Land those as **PR-10a** first; this PR is **PR-10b**.

---prompt---

**Goal**: Close the five gaps between the shipped stack (PR-1..PR-9) and the product intent, plus one
security fix. Reference: `CLIENT_PORTAL_PLAN.md` "Revision 2" sections.

1. The GDrive link is **1:1 with the client email** and belongs at the **top of the client card**, not in a
   per-meeting cell.
2. Admin can **look up a client by Drive link** as well as by email/first/last.
3. Admin **ticks checkboxes** to choose which meetings to forward.
4. The **client portal email** carries upcoming meetings + a cancel link per meeting, not just folders.
5. Cancelling a meeting **emails the client**.
6. `functions/api/admin/bookings/[id].ts` **has no auth check** — fix first.

**Do this one first — it is a live hole**:

`functions/api/admin/bookings/[id].ts` never calls `isAdminAuthenticated`. Add at the top of
`onRequestDelete`, matching every other admin endpoint:
```ts
const { authed } = isAdminAuthenticated(request, env)
if (!authed) return new Response('Unauthorized', { status: 401 })
```

**Files**:

1. NEW `migrations/0015_client_drive_link.sql`
```sql
ALTER TABLE contacts ADD COLUMN drive_folder_id TEXT;
ALTER TABLE contacts ADD COLUMN drive_is_manual INTEGER DEFAULT 0;
CREATE INDEX idx_contacts_drive_folder_id ON contacts(drive_folder_id);
CREATE INDEX idx_cdf_folder_id ON client_drive_folders(folder_id);
CREATE INDEX idx_cdf_parent_folder_id ON client_drive_folders(parent_folder_id);
```
Backfill: `UPDATE contacts SET drive_folder_id = (SELECT parent_folder_id FROM client_drive_folders WHERE contact_id = contacts.id ORDER BY year DESC LIMIT 1) WHERE drive_folder_id IS NULL;`

2. MOD `functions/_lib/email.ts`
- `export interface EmailMeeting { dateTime, timeZone?, purpose?, meetLink?, cancelUrl? }`
- `export function renderMeetingRows(meetings: EmailMeeting[]): string` — shared table markup, renders
  "Not recorded" for a null `meetLink` (legacy rows)
- `buildClientPortalDriveEmail({firstName, driveFolderUrl?, yearFolders, meetings})` — folder section then
  meetings section, each with its own empty state
- `buildAdminDriveEmail({firstName, driveLink, meetings: EmailMeeting[]})` — replaces `meetings.join(', ')`
  over raw ISO strings
- NEW `buildBookingCancelledEmail({firstName, dateTime, purpose?, driveFolderUrl?})` +
  `sendBookingCancelledEmail(...)` — no cancel link, no meet link, states the folder is unchanged
- **Restore the lost error handling**: PR-2 stripped the `!!! *_EMAIL_*` logs and the `if (!res.ok)` branch
  from `sendClientPortalDriveEmail` / `sendAdminDriveEmail`, so a Resend 4xx returns `{success:true}`.
  Restore both to match `sendConfirmationEmail`.

3. MOD `functions/_lib/google-drive.ts`
```diff
-export async function ensureClientDriveFolder(env, emailRaw, yearRaw)
+export async function ensureClientDriveFolder(env, emailRaw, yearRaw, opts?: {parentFolderId?: string})
+  // step 6: emailFolder = opts?.parentFolderId ? {id: opts.parentFolderId} : search||create
```
Without this an admin override is cosmetic — the link points at folder A while confirmations keep filing
into folder B.

4. MOD `functions/api/booking/confirm/[token].ts` + `functions/api/admin/bookings/manual.ts`
- read `contacts.drive_folder_id` / `drive_is_manual`, pass `{parentFolderId}` when manual
- also write `contacts.drive_folder_id` alongside the existing `drive_folder_url` update

5. MOD `functions/api/client-portal/lookup.ts`
- also SELECT upcoming confirmed bookings (`id, slot_start, slot_end, time_zone, purpose, meet_link, cancel_token`)
- `cancelUrl = ${new URL(request.url).origin}/api/cancel/${cancel_token}`
- **send whenever the contact exists** — drop the `if (driveLinks.results.length)` gate; today a client with
  meetings but no folder receives nothing

6. REWRITE `functions/api/admin/clients/search.ts`
- `q` also matches a Drive link / bare folder id via `extractFolderId(q)` against
  `contacts.drive_folder_id`, `client_drive_folders.folder_id`, `client_drive_folders.parent_folder_id`
- three queries (contacts → year folders → meetings), not one triple join. The shipped
  `LEFT JOIN client_drive_folders cdf ON cdf.contact_id = c.id` has no year correlation, so 3 folders ×
  4 meetings = 12 rows.
- date filter narrows **meetings only**; a matched client with no meetings in range still returns with an
  empty list
- response `{clients: [{...contact, drive_folder_url, drive_folder_id, drive_is_manual, year_folders[], meetings[]}]}`

7. MOD `functions/api/admin/clients/drive-folder.ts`
- PATCH **without** `year` (new default) → `UPDATE contacts SET drive_folder_url, drive_folder_id, drive_is_manual=1`
  + refresh `client_drive_folders.parent_folder_*` for that contact
- PATCH **with** `year` → existing per-year upsert, unchanged
- GET `?contact_id=` → client-level link + `year_folders[]`

8. MOD `functions/api/admin/clients/send-email.ts`
- body `{contact_id, booking_ids?}`; omitted → all upcoming (backward compatible)
- **validate every id is in this contact's upcoming set**, else 400 — otherwise one client's meeting can be
  forwarded into another client's email
- drive link from `contacts.drive_folder_url`, falling back to newest `client_drive_folders.folder_url`

9. MOD `functions/api/admin/bookings/[id].ts`
- auth (above), `?notifyClient=` defaulting to the value of `cancelMeeting`
- join contacts for email/first_name, `sendBookingCancelledEmail` **non-blocking** (log
  `!!! ADMIN_CANCEL_NOTIFY_ERROR`, never abort the delete)
- return `{success, cancelled, notified}`

10. NEW `src/components/admin/ClientCard.tsx` + REWRITE `src/pages/AdminClients.tsx`
- one card per client: header = name/email + **single Drive input + Save** + year folder chips +
  `Send selected (n)`; body = meetings table with a checkbox column
- header checkbox ticks all *upcoming* meetings; past rows unticked by default
- `selected: Record<contactId, Set<bookingId>>`, cleared on new search
- search placeholder → "Email, first name, last name, or Drive link"
- delete modal gains a "Notify client by email" checkbox
- Removes the per-row Drive input keyed by `contact_id` alone (editing one row changed every row for that
  client) and `handleSave`'s `r.year || new Date().getFullYear()` fallback, which wrote the link to the
  wrong year whenever `r.year` was undefined.

11. MOD `src/lib/api.ts` — `AdminClient` / `AdminClientMeeting` types, `searchAdminClients` reads
`json.clients`, `updateAdminDriveFolder(contactId, folderUrl, year?)`,
`sendAdminClientEmail(contactId, bookingIds?)`, `deleteBooking(id, cancelMeeting, notifyClient?)`

**Tests**: see `CLIENT_PORTAL_PLAN.md` §12 items 12–19. Highest value:
- `delete.test.ts`: **401 without auth** (fails before the fix)
- `search.test.ts`: 3 folders × 4 meetings → 1 client, 4 meetings (fan-out regression)
- `search.test.ts`: `q` as a Drive URL and as a bare folder id both match
- `send-email.test.ts`: 400 when a `booking_id` belongs to another contact
- `lookup.test.ts`: contact with meetings but zero folders still gets an email
- `email.test.ts`: `sendClientPortalDriveEmail` returns `success:false` on a Resend non-2xx

**Acceptance**: delete requires auth; one Drive link per client rendered once at the top; search by Drive
link works; only ticked meetings are forwarded; client portal email lists upcoming meetings with cancel
links; cancelling emails the client unless unticked; no Drive data is ever deleted.

---verify---

**Docker**:
```bash
docker compose run --rm backend sh -c "npm run migrate:local && npx wrangler d1 execute fancpa-db --local --command \"PRAGMA table_info(contacts)\""
docker compose run --rm tests sh -c "npm run test:workers -- --run functions/api/admin/ functions/api/client-portal/ functions/_lib/email.test.ts functions/_lib/google-drive.test.ts"
docker compose run --rm tests sh -c "npm test -- --run src/pages/AdminClients.test.tsx src/components/admin/ClientCard.test.tsx"
docker compose run --rm tests
```

**Manual**:
1. `docker compose up -d backend frontend`
2. **Auth hole closed**: `curl -X DELETE "http://localhost:8788/api/admin/bookings/<id>?cancelMeeting=false"`
   with no admin session → `401`. Confirm on `main` it returns `200` today.
3. Seed a client with 2 year folders and 3 bookings (one past, two upcoming) via `+ Add Booking`.
4. `/admin/clients`, search the email → **one card**, not 6 rows. One Drive input in the header,
   `2025 ↗ 2026 ↗` chips, 3 meeting rows.
5. Paste the client's Drive URL into search → same card returns. Repeat with the bare folder id.
6. Edit the header Drive link → Save →
   `SELECT drive_folder_url, drive_folder_id, drive_is_manual FROM contacts WHERE email='…'` → `is_manual=1`.
   Add another booking in a new year → the new year folder is created under the overridden parent
   (`SELECT year, parent_folder_id FROM client_drive_folders WHERE contact_id='…'`).
7. Tick **one** upcoming meeting → `Send selected (1)` → logs show `selected=1/2`, the email body lists one
   meeting with a cancel link. Untick all → button disabled.
8. Forged id: `curl -X POST …/send-email -d '{"contact_id":"A","booking_ids":["<booking of contact B>"]}'` → `400`.
9. `/client-portal`, look up the email → email contains the folder link, both year links, both upcoming
   meetings, and a working cancel link per meeting. Click one → booking cancels.
10. Contact with meetings but **no** Drive folder → still receives an email (folder section shows the
    "will be created with your first booking" empty state).
11. Delete a booking with "cancel meeting" + "notify client" → client gets the cancellation email, calendar
    slot frees, `client_drive_folders` rows survive. Repeat with notify unticked → no email.

---

## Summary Compact

- **10 PRs** (9 original – down from 12, removed scanning UI PR-12, merged add backend+frontend and delete backend+frontend, merged time filter into admin UI PR – plus PR-10 Rev 2)
- **Each PR <200k tokens**: PR-1 ~12k, PR-2 ~25k, PR-3 ~20k, PR-4 ~30k, PR-5 ~35k, PR-6 ~40k, PR-7 ~50k, PR-8 ~35k, PR-9 ~10k, PR-10 ~55k
- **Drive root** now configured via Cloudflare `GOOGLE_DRIVE_ROOT_FOLDER_ID` env var (plus `.dev.vars` for local), not via admin scan UI – simpler, still meets requirement "only me and client have access" because root folder is owned by you and subfolders inherit.
- **OAuth Option B** – CLIENT_ID/SECRET same, only REFRESH_TOKEN regenerated with `drive.file` scope, no SA needed.
- All features: creation logic (email folder + **meeting** year 4-digit, only me+client), link in confirmation email, don't delete on cancel, client portal email lookup with Turnstile, admin portal search email/first/last + time range filter, firstname/lastname/meeting time/meeting url/gdrive editable/purpose/timezone display, send button for upcoming, admin add manual (auto gdrive+auto meet+calendar blocking+optional email), admin delete with optional cancel.
- **PR-10 (Rev 2)** on top: `contacts.drive_folder_url|drive_folder_id|drive_is_manual` as the single 1:1 client Drive link rendered once per client card; admin lookup by Drive link/folder id; grouped `{clients:[{…, meetings:[]}]}` search response (fixes the folder×meeting fan-out); per-meeting checkboxes → `send-email {contact_id, booking_ids}`; client portal email = folders + upcoming meetings + per-meeting cancel links; `sendBookingCancelledEmail` on admin cancel behind a `notifyClient` flag; `ensureClientDriveFolder(…, {parentFolderId})` so an admin override actually redirects new year folders; **admin auth added to `DELETE /api/admin/bookings/:id`**.

